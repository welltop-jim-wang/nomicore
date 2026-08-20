/**
 * SA6 红灯测试 — Issue #45 契约②（AC-3）：领域别名与协议导出名（`@nomicore/vfsl-protocol`
 * 实测导出面 12 名）碰撞时，生成器以**独立错误码**响亮失败（非静默、非归并进既有错误），
 * CLI 端到端 exit 2 + 结构化 stderr。
 *
 * 缺陷实证（SA5 报告 §Reproduction 步骤 1/3，本 worktree 复现确认）：`type PathSchema =
 * YMap<{ x: YLeaf<string> }>` 在解析层合法（VFSL 保留名仅 ROOT + 标记类型，协议名不在其列），
 * 一路绿灯直达发射 → 生成物自碰撞（TS2315/TS2314），生成器与 CLI **均无守卫、均 exit 0
 * 静默产出**不可编译生成物。修复契约（Owner 裁定 2）：生成器段② 发射前对别名名 × 协议
 * 导出面做碰撞检查，命中即独立错误码响亮失败，CLI 顶层 catch → 结构化 stderr + exit 2；
 * 不依赖 G 票命名规约。
 *
 * 红灯现状（实测，probe6）：协议导出面 12 名逐一作碰撞别名，parse/evaluate 全部放行、
 * `generateProjection` 全部 **NO-THROW** 静默产出 → 本文件全部断言红；CLI 对碰撞域
 * exit 0（SA5 E5）→ CLI 断言红。
 *
 * 守卫对象域 = 协议包**实测导出面**（经 tsc API 枚举，见 tsc-helper.ts）：协议包是纯类型
 * 模块（零运行时值），运行时取不到键，枚举走 checker.getExportsOfModule——导出面漂移时
 * 测试自动跟随，不靠手工名单同步。
 *
 * 断言对象 = `generateProjection` 的抛错行为 / 错误对象属性 / CLI 退出码与 stderr
 * （可观测运行时行为），不读生成器源码、不 grep 源码文本。
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluate, parseVfsl } from '@nomicore/vfsl';
import { generateProjection } from '@nomicore/vfsl-codegen';
import { protocolExportNames, repoRoot } from './tsc-helper.js';

/** 接缝层既有错误码全集（SchemaSourceErrorCode）——新守卫码必须与其互异（「独立错误码」的否定侧锚）。 */
const EXISTING_SCHEMA_SOURCE_CODES = ['missing-directive', 'dialect-mismatch', 'unknown-id'] as const;

/** 碰撞 fixture：域内声明与协议导出名同名的别名，并在 ROOT 字段位引用它（SA5 n3 fixture 同构）。 */
function collisionFixture(name: string): string {
  return `type ROOT = YMap<{ x: ${name} }>;\ntype ${name} = YMap<{ x: YLeaf<string> }>;\n`;
}

function derive(fixture: string): import('@nomicore/vfsl').DerivedSchema {
  const parsed = parseVfsl(fixture);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(`parseVfsl 失败：${JSON.stringify(parsed.issues)}`);
  const result = evaluate(parsed.module);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`evaluate 失败：${JSON.stringify(result.issues)}`);
  return result.derived;
}

/** 捕获 generateProjection 对碰撞 fixture 的抛错（不抛 → err 保持 null）。 */
function captureCollisionError(name: string): { err: unknown; out: string } {
  const fixture = collisionFixture(name);
  const derived = derive(fixture);
  let err: unknown = null;
  let out = '';
  try {
    out = generateProjection(derived, { sourceText: fixture });
  } catch (e) {
    err = e;
  }
  return { err, out };
}

describe('AC-3 — 领域别名 × 协议导出名碰撞 → generateProjection 响亮失败（生成器级，非静默产出）', () => {
  const exportNames = protocolExportNames();

  it(`协议导出面实测 ${exportNames.length} 名逐一作碰撞别名 → 生成器抛错（不静默产出不可编译生成物）`, () => {
    expect(exportNames.length).toBeGreaterThan(0);
    const silent: string[] = [];
    for (const name of exportNames) {
      const { err } = captureCollisionError(name);
      if (err === null) silent.push(name);
    }
    expect(silent, `以下协议导出名碰撞后生成器未抛错（静默产出）：${silent.join(', ')}`).toHaveLength(0);
  });

  it('碰撞错误携带独立错误码：code 为字符串且不属于既有 schema-source 错误码（非归并、非泛化）', () => {
    const { err } = captureCollisionError('PathSchema');
    expect(err).not.toBeNull();
    const code = (err as { code?: unknown }).code;
    expect(typeof code).toBe('string');
    expect((code as string).length).toBeGreaterThan(0);
    expect(EXISTING_SCHEMA_SOURCE_CODES).not.toContain(code);
  });

  it('碰撞错误消息指明碰撞别名（诊断可定位，非静默）', () => {
    const name = 'PathSchema';
    const { err } = captureCollisionError(name);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain(name);
  });
});

describe('AC-3 — CLI 端到端：碰撞域响亮失败（exit 2 + 结构化 stderr，非 exit 0 静默产出）', () => {
  it('pnpm generate 对碰撞域 → exit 2，stderr 含独立错误码与碰撞别名', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vfsl-codegen-collide-'));
    const domainDir = join(dir, 'domains', 'collide');
    await mkdir(domainDir, { recursive: true });
    await writeFile(
      join(domainDir, 'schema.vfsl'),
      `// @lang: vfsl\n// @id: collide@1\n// @version: 1\n${collisionFixture('PathSchema')}`,
      'utf8',
    );
    const r = spawnSync('pnpm', ['generate', '--domains', dir], { cwd: repoRoot, encoding: 'utf8' });
    const stderr = r.stderr ?? '';
    expect(r.status, `exit 应为 2（硬错误通道），实际 ${String(r.status)}；stderr: ${stderr}`).toBe(2);
    // CLI 顶层 catch 对带 code 的错误打印 `[<code>]` 前缀（cli.ts printStructuredError）
    expect(stderr).toMatch(/\[[A-Za-z0-9_-]+\]/);
    expect(stderr).toContain('PathSchema');
  });
});
