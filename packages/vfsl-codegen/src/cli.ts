/**
 * CLI（§5）：`pnpm generate` / `pnpm generate --check`。
 *
 * 启动精简（R2/SA2 #8b）：模块级零重活（无顶层 await/大对象构造）、参数解析与错误
 * 早出先行；`@nomicore/vfsl` 全量导入（tsx 现场转译）是主要启动成本，不得再叠加
 * 启动期 I/O。
 *
 * 退出码语义（§5.4）：写盘成功 0；--check 新鲜 0 / 过期、缺失、孤儿 1；
 * 零领域集（无 --allow-empty-domains）2；硬错误（SchemaSourceError / ENOTDIR /
 * EACCES / parse/evaluate 失败 / UnsupportedRootShapeError / idBase 约定破坏 /
 * 同目录多 id）→ 顶层 catch 结构化 stderr + 2。
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { SchemaSourceError } from '@nomicore/vfsl';
import { collectProjections } from './collect.js';
import type { ProjectionOutput } from './collect.js';

interface CliArgs {
  domains: string;
  check: boolean;
  allowEmptyDomains: boolean;
}

class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliUsageError';
  }
}

/** 参数解析先行（启动精简）：--domains <root>（默认 cwd）/ --check / --allow-empty-domains。 */
function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { domains: process.cwd(), check: false, allowEmptyDomains: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === '--check') {
      args.check = true;
    } else if (a === '--allow-empty-domains') {
      args.allowEmptyDomains = true;
    } else if (a === '--domains') {
      const v = argv[i + 1];
      if (v === undefined) {
        throw new CliUsageError('--domains 缺少参数（用法：--domains <包含 domains/ 的根目录>）');
      }
      args.domains = v;
      i++;
    } else if (a.startsWith('--domains=')) {
      args.domains = a.slice('--domains='.length);
    } else {
      throw new CliUsageError(`未知参数: ${a}`);
    }
  }
  return args;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const outputs = await collectProjections(args.domains);

  // 空领域集阶段门（§5.5，R2/SA2 #4）：F1 将 domains/ 缺失（ENOENT）设计为合法空集——
  // 「G 尚未落地」与「--domains 路径打错」在接缝层不可区分，无 flag 一律响亮 exit 2。
  if (outputs.length === 0) {
    if (args.allowEmptyDomains) return 0;
    process.stderr.write(
      'vfsl-codegen: 零领域集：domains/ 不存在或为空——若 G 尚未落地属预期，请加 --allow-empty-domains；' +
        '若非预期请检查 --domains 路径\n',
    );
    return 2;
  }

  if (args.check) return checkFreshness(outputs, args.domains);

  // 全量重新生成 + 写盘（幂等：同输入重写同字节）
  for (const o of outputs) {
    await mkdir(dirname(o.outPath), { recursive: true });
    await writeFile(o.outPath, o.text, 'utf8');
  }
  return 0;
}

/** §5.4 --check：全量重生成 → 与盘上逐字节 diff（+ 孤儿生成物检测）；任何不一致 → 1。 */
async function checkFreshness(outputs: ProjectionOutput[], root: string): Promise<number> {
  const problems: string[] = [];
  for (const o of outputs) {
    let disk: string | null = null;
    try {
      disk = await readFile(o.outPath, 'utf8');
    } catch {
      disk = null; // 缺失（含 ENOENT）→ stale
    }
    if (disk === null) {
      problems.push(`生成物缺失：${o.outPath}`);
    } else if (disk !== o.text) {
      problems.push(`生成物过期（diff 非空）：${o.outPath}`);
    }
  }
  for (const p of await findOrphanGenerated(root, outputs)) {
    problems.push(`孤儿生成物：${p}`);
  }
  if (problems.length === 0) return 0;
  for (const p of problems) process.stderr.write(`vfsl-codegen: --check 失败 — ${p}\n`);
  return 1;
}

/** 盘上 domains/**&#47;generated.ts 中不在本次输出集合的 = 孤儿（源漂移/生成器漂移双抓的第三类）。 */
async function findOrphanGenerated(root: string, outputs: ProjectionOutput[]): Promise<string[]> {
  const expected = new Set(outputs.map((o) => o.outPath));
  const orphans: string[] = [];
  let top;
  try {
    top = await readdir(join(root, 'domains'), { withFileTypes: true });
  } catch (err) {
    if ((err as { code?: unknown }).code === 'ENOENT') return orphans; // domains/ 缺失（输出非空时不应发生，防御）
    throw err;
  }
  for (const d of top) {
    if (!d.isDirectory() || d.name.startsWith('.')) continue;
    let files;
    try {
      files = await readdir(join(root, 'domains', d.name), { withFileTypes: true });
    } catch (err) {
      if ((err as { code?: unknown }).code === 'ENOENT') continue;
      throw err;
    }
    for (const f of files) {
      if (!f.isFile() || f.name !== 'generated.ts') continue;
      const p = join(root, 'domains', d.name, f.name);
      if (!expected.has(p)) orphans.push(p);
    }
  }
  return orphans.sort();
}

/** 顶层 catch（§5.3 步骤 7）：SchemaSourceError 与接缝冒泡错误 → 结构化 stderr + exit 2。 */
function printStructuredError(err: unknown): void {
  if (err instanceof SchemaSourceError) {
    const ctx = [err.id !== undefined ? `id=${err.id}` : '', err.path !== undefined ? `path=${err.path}` : '']
      .filter((s) => s !== '')
      .join(' ');
    process.stderr.write(
      `vfsl-codegen: SchemaSourceError [${err.code}]: ${err.message}${ctx === '' ? '' : `（${ctx}）`}\n`,
    );
    return;
  }
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    const prefix = typeof code === 'string' ? `[${code}] ` : '';
    process.stderr.write(`vfsl-codegen: ${prefix}${err.message}\n`);
    return;
  }
  process.stderr.write(`vfsl-codegen: ${String(err)}\n`);
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    printStructuredError(err);
    process.exit(2);
  });
