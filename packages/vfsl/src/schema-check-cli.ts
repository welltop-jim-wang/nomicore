import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { evaluate } from './evaluate.js';
import { parseVfsl } from './index.js';
import { validateLogicalSnapshot } from './validate.js';
import type { ValidateIssue } from './validate.js';

interface CliArgs {
  schemaPath: string;
  dataPath?: string;
}

class UsageError extends Error {}

function usage(): string {
  return 'Usage: pnpm schema:check <schema.vfsl> [--data <root.json|->]';
}

function parseArgs(argv: string[]): CliArgs {
  let schemaPath: string | undefined;
  let dataPath: string | undefined;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] as string;
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    if (arg === '--data') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new UsageError('--data requires a JSON file path or - for stdin');
      }
      if (dataPath !== undefined) throw new UsageError('--data may be specified only once');
      dataPath = value;
      index++;
      continue;
    }
    if (arg.startsWith('--data=')) {
      if (dataPath !== undefined) throw new UsageError('--data may be specified only once');
      dataPath = arg.slice('--data='.length);
      if (dataPath === '') throw new UsageError('--data requires a JSON file path or - for stdin');
      continue;
    }
    if (arg.startsWith('-')) throw new UsageError(`Unknown option: ${arg}`);
    if (schemaPath !== undefined) throw new UsageError(`Unexpected argument: ${arg}`);
    schemaPath = arg;
  }

  if (schemaPath === undefined) throw new UsageError('Missing schema.vfsl path');
  return dataPath === undefined ? { schemaPath } : { schemaPath, dataPath };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readData(path: string): Promise<string> {
  return path === '-' ? readStdin() : readFile(resolve(path), 'utf8');
}

function renderPath(path: Array<string | number>): string {
  let rendered = '$';
  for (const segment of path) {
    if (typeof segment === 'number') {
      rendered += `[${segment}]`;
    } else if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment)) {
      rendered += `.${segment}`;
    } else {
      rendered += `[${JSON.stringify(segment)}]`;
    }
  }
  return rendered;
}

function printDataIssues(issues: ValidateIssue[]): void {
  process.stderr.write('ROOT data invalid:\n');
  for (const issue of issues) {
    process.stderr.write(`  ${renderPath(issue.path)}: ${issue.message}\n`);
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const schemaPath = resolve(args.schemaPath);
  const schemaText = await readFile(schemaPath, 'utf8');

  const parsed = parseVfsl(schemaText);
  if (!parsed.ok) {
    process.stderr.write(`Schema invalid: ${schemaPath}\n`);
    for (const issue of parsed.issues) {
      process.stderr.write(`  ${issue.line}:${issue.column} ${issue.message}\n`);
    }
    return 1;
  }

  const evaluated = evaluate(parsed.module);
  if (!evaluated.ok) {
    process.stderr.write(`Schema invalid: ${schemaPath}\n`);
    for (const issue of evaluated.issues) {
      process.stderr.write(`  ${issue.line}:${issue.column} ${issue.message}\n`);
    }
    return 1;
  }

  if (args.dataPath === undefined) {
    process.stdout.write(`Schema valid: ${schemaPath}\n`);
    return 0;
  }

  const source = args.dataPath === '-' ? 'stdin' : resolve(args.dataPath);
  const dataText = await readData(args.dataPath);
  let data: unknown;
  try {
    data = JSON.parse(dataText) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new UsageError(`Invalid JSON from ${source}: ${detail}`);
  }

  const result = validateLogicalSnapshot(evaluated.derived, data);
  if (!result.ok) {
    printDataIssues(result.issues);
    return 1;
  }

  process.stdout.write(`Schema valid: ${schemaPath}\nROOT data valid: ${source}\n`);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    if (error instanceof UsageError) {
      process.stderr.write(`schema:check: ${error.message}\n${usage()}\n`);
      process.exitCode = 2;
      return;
    }
    const detail = error instanceof Error ? error.message : String(error);
    process.stderr.write(`schema:check: ${detail}\n`);
    process.exitCode = 2;
  });
