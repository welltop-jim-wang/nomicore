/**
 * SA6 红灯测试 — `@nomicore/vfsl-codegen` CLI：`pnpm generate` / `generate --check` 退出码契约
 * （issue #26 AC4「generate --check 对过期生成物退出非零」+ ADR 0005 §4「CI regen-diff」）。
 *
 * 执行载体注记（SA5 锚点 8）：仓库零构建产物、ESM `.js` 后缀 TS 源码，CLI 如何在不引入重
 * 依赖前提下执行 TS（tsc 出 dist / tsx / 其他）归 SA1 设计定夺。本文件只锚 CLI 的**可观测
 * 行为**（退出码/diff 语义），不锁执行载体。
 *
 * 契约（AC4 + ADR 0005 §4）：
 * - `pnpm generate`：全量重新生成 + 写盘，成功退出 0（幂等：重复运行不失败）；
 * - `pnpm generate --check`：全量重新生成 → 与仓内生成物 diff；
 *   - diff 为空（当前生成物新鲜）→ 退出 0；
 *   - diff 非空（生成物过期/缺失，即「源漂移或生成器逻辑漂移」）→ **退出非零**（√ AC4）。
 *
 * 红灯现状：根 package.json 无 `generate`/`generate --check` 脚本、codegen 包无 bin → 
 * `pnpm generate` 命令不存在（shell 127 / ENOENT）→ 退出码 ≠ 0 → 本文件契约断言必红
 * （"测 CLI 不存在" 的真红，非伪红）。
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 仓根（settings fixture 与命令执行 cwd）。 */
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

/** 运行 `pnpm <args...>`（cwd 可指定；返回退出码 / 信号）。 */
function runPnpm(args: string[], cwd: string): { status: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string } {
  const r = spawnSync('pnpm', args, { cwd, encoding: 'utf8', shell: false });
  return { status: r.status, signal: r.signal, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** 在临时目录构造一个只含单个 .vfsl 的 domains 领域 fixture（不依赖仓内 domains/，G 票范围外）。 */
async function makeStaleFixture(): Promise<{ dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'vfsl-codegen-cli-'));
  const domainsDir = join(dir, 'domains', 'demo');
  await mkdir(domainsDir, { recursive: true });
  await writeFile(
    join(domainsDir, 'schema.vfsl'),
    `// @lang: vfsl\n// @id: demo@1\n// @version: 1\n/** demo 根 */\ntype ROOT = { label: string };\n`,
    'utf8',
  );
  return { dir };
}

describe('AC4 — pnpm generate 存在且幂等（全量重新生成 + 写盘）', () => {
  it('pnpm generate 命令存在且成功退出（退出码 0）——被测 CLI 存在的事实锚点', async () => {
    const fx = await makeStaleFixture();
    const r = runPnpm(['generate', '--domains', fx.dir], repoRoot);
    expect(r.status).toBe(0);
  });
});

describe('单领域自定义输出', () => {
  it('将指定领域生成到宿主 package 路径，内容与默认 projection 逐字节相同', async () => {
    const fx = await makeStaleFixture();
    expect(runPnpm(['generate', '--domains', fx.dir], repoRoot).status).toBe(0);
    const custom = join(fx.dir, 'packages', 'consumer', 'src', 'generated', 'nomicore-schema.ts');
    const generated = runPnpm([
      'generate', '--domains', fx.dir, '--domain', 'demo', '--out',
      'packages/consumer/src/generated/nomicore-schema.ts',
    ], repoRoot);
    expect(generated.status).toBe(0);
    expect(await readFile(custom, 'utf8')).toBe(
      await readFile(join(fx.dir, 'domains', 'demo', 'generated.ts'), 'utf8'),
    );
  });
});

describe('单领域自定义输出参数与 freshness', () => {
  it('自定义输出 --check：fresh=0；stale/missing=1 且不写盘', async () => {
    const fx = await makeStaleFixture();
    const rel = 'packages/consumer/src/generated/nomicore-schema.ts';
    const custom = join(fx.dir, rel);
    const args = ['generate', '--domains', fx.dir, '--domain', 'demo', '--out', rel];
    expect(runPnpm(args, repoRoot).status).toBe(0);
    expect(runPnpm([...args, '--check'], repoRoot).status).toBe(0);
    await writeFile(custom, 'stale\n', 'utf8');
    expect(runPnpm([...args, '--check'], repoRoot).status).toBe(1);
    expect(await readFile(custom, 'utf8')).toBe('stale\n');
    const missing = join(fx.dir, 'packages', 'consumer', 'src', 'generated', 'missing.ts');
    const missingArgs = ['generate', '--domains', fx.dir, '--domain', 'demo', '--out', missing, '--check'];
    expect(runPnpm(missingArgs, repoRoot).status).toBe(1);
    await expect(readFile(missing, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([
    [['generate', '--domain', 'demo'], '--domain 与 --out 必须同时提供'],
    [['generate', '--out', 'x.ts'], '--domain 与 --out 必须同时提供'],
    [['generate', '--domain', 'missing', '--out', 'x.ts'], '领域不存在'],
  ] as const)('无效参数响亮失败：%j', async (tail, message) => {
    const fx = await makeStaleFixture();
    const r = runPnpm([...tail, '--domains', fx.dir], repoRoot);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(message);
  });
});

describe('AC4 — generate --check 对过期生成物退出非零，对新鲜生成物退出 0', () => {
  it('generate 后再 --check → diff 为空 → 退出 0（新鲜生成物）', async () => {
    const fx = await makeStaleFixture();
    const gen = runPnpm(['generate', '--domains', fx.dir], repoRoot);
    // 前置：generate 必须成功（若 CLI 不存在则前置红，本 it 一并红）
    expect(gen.status).toBe(0);
    const check = runPnpm(['generate', '--check', '--domains', fx.dir], repoRoot);
    expect(check.status).toBe(0);
  });

  it('源漂移后 --check → 退出非零（源改动 → 重新生成后 diff 非空）', async () => {
    const fx = await makeStaleFixture();
    const gen = runPnpm(['generate', '--domains', fx.dir], repoRoot);
    expect(gen.status).toBe(0);
    // 漂移源：在 .vfsl 追加字段，改变派生 schema → 现有生成物过期
    await appendFile(join(fx.dir, 'domains', 'demo', 'schema.vfsl'), `\ntype Extra = { x: number };\n`, 'utf8');
    const check = runPnpm(['generate', '--check', '--domains', fx.dir], repoRoot);
    expect(check.status).not.toBe(0);
  });
});
