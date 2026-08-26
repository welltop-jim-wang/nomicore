import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

function runSchemaCheck(
  args: string[],
  options: { input?: string; cwd?: string } = {},
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('pnpm', ['schema:check', ...args], {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    input: options.input,
    shell: false,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

async function fixture(schema: string): Promise<{ dir: string; schemaPath: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'vfsl-schema-check-'));
  const schemaPath = join(dir, 'schema.vfsl');
  await writeFile(schemaPath, schema, 'utf8');
  return { dir, schemaPath };
}

const validSchema = `type ROOT = YMap<{
  title: YLeaf<string>;
  count?: YLeaf<number>;
}>;
`;

describe('pnpm schema:check schema validation', () => {
  it('accepts a valid schema without requiring a domain layout', async () => {
    const fx = await fixture(validSchema);
    const result = runSchemaCheck([fx.schemaPath]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Schema valid');
    expect(result.stderr).toBe('');
  });

  it('rejects an invalid schema with line and column diagnostics', async () => {
    const fx = await fixture('type ROOT = YLeaf<string>;\n');
    const result = runSchemaCheck([fx.schemaPath]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('VFSL-E311');
    expect(result.stderr).toMatch(/1:\d+/);
  });
});

describe('pnpm schema:check ROOT data validation', () => {
  it('validates ROOT data read from a JSON file', async () => {
    const fx = await fixture(validSchema);
    const dataPath = join(fx.dir, 'valid.json');
    await writeFile(dataPath, JSON.stringify({ title: 'hello', count: 2 }), 'utf8');

    const result = runSchemaCheck([fx.schemaPath, '--data', dataPath]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('ROOT data valid');
  });

  it('validates ROOT data read from stdin', async () => {
    const fx = await fixture(validSchema);
    const result = runSchemaCheck([fx.schemaPath, '--data', '-'], {
      input: JSON.stringify({ title: 'hello' }),
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('ROOT data valid');
  });

  it('reports JSON-path issues for invalid ROOT data', async () => {
    const fx = await fixture(validSchema);
    const result = runSchemaCheck([fx.schemaPath, '--data', '-'], {
      input: JSON.stringify({ title: 42, extra: true }),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('ROOT data invalid');
    expect(result.stderr).toContain('$.title');
    expect(result.stderr).toContain('$.extra');
  });

  it('rejects malformed JSON input as a usage error', async () => {
    const fx = await fixture(validSchema);
    const result = runSchemaCheck([fx.schemaPath, '--data', '-'], { input: '{' });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Invalid JSON');
  });
});
