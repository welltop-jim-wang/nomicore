/**
 * issue #222 — `@nomicore/vfsl-codegen` 无分号输出模式（semicolonFree / `--semicolon-free`）。
 *
 * 契约来源（issue #222 验收标准）：
 * - 一种受支持的输出模式满足 semicolon-free `@stylistic/member-delimiter-style`
 *   （对象类型字面量成员与接口成员零分号分隔）；
 * - 覆盖多字段别名、嵌套对象字段、可选字段、ROOT 接口成员；
 * - 覆盖 emitAlias / emitInterfaceMember / emitObjectMembers 三处分隔符源（含嵌套字面量）；
 * - 重复生成逐字节一致；
 * - `--check` 接受所选格式，无需消费端后处理。
 *
 * 实测锚点（issue 复现，MABF Center 消费仓 Oxlint）：semicolon-free 消费配置同时拒绝
 * 成员分隔符（`@stylistic/member-delimiter-style` multiline none——单行 `; ` 连接同样命中）
 * 与语句分号（`@stylistic/semi`——import 行、别名声明终止符），故本模式要求**全文零分号**，
 * 而非仅成员分隔符替换。对象字面量多行化（成员逐行无分隔符）是唯一同时满足
 * 「multiline none」与「singleline semi」双档消费配置的合法 TS 形态。
 *
 * 默认模式（分号版）字节稳定性由既有测试锚定（generate-mapping-table 等断言 `; ` 连接与
 * 终止符在场），本文件只锚 semicolonFree=true 的行为。
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseVfsl, evaluate } from '@nomicore/vfsl';
import { generateProjection } from '@nomicore/vfsl-codegen';
import { preEmitDiagnostics, formatDiagnostics, repoRoot } from './tsc-helper.js';

/**
 * 覆盖 fixture：多字段别名（Meta/Entity）、嵌套对象字段（meta 内联 YMap）、可选字段（note?）、
 * ROOT 接口成员（label/meta/entityList/tags）、判别联合 map 成员（emitUnionBodyMembers 的
 * map×object 内联字面量路径）、leaf/Record/array 载体。fieldDocs 三处（别名/字段/标记）同时在场。
 */
const FIXTURE = `/** 根文档 */
type ROOT = YMap<{
  label: YLeaf<string>;
  /**
   * 多行字段文档第一行
   * 第二行（解析层保留源换行，条目以 \\n 起始）
   */
  meta: YMap<{ count: YLeaf<number>; note?: YLeaf<string> }>;
  entityList: YArray<Entity>;
  tags: YLeaf<string>[];
  byId: Record<Id, Meta>;
}>;

/** 实体的判别联合 */
type Entity =
  | { kind: "image"; url: YLeaf<string> }
  | { kind: "text"; title: YLeaf<string>; brief?: YLeaf<string> };

/** 多字段别名 */
type Meta = YMap<{ m: YLeaf<number>; n: YLeaf<string> }>;

/** Pattern 键 */
type Id = string & Pattern<"^[A-Za-z0-9_]{1,16}$">;
`;

function derive(): import('@nomicore/vfsl').DerivedSchema {
  const parsed = parseVfsl(FIXTURE);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(`parseVfsl 失败：${JSON.stringify(parsed.issues)}`);
  const result = evaluate(parsed.module);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`evaluate 失败：${JSON.stringify(result.issues)}`);
  return result.derived;
}

function emitSf(): string {
  return generateProjection(derive(), { sourceText: FIXTURE, semicolonFree: true });
}

describe('issue #222 — semicolonFree 发射：全文零分号', () => {
  it('生成物不含任何分号（语句终止符 + 成员分隔符全灭）', () => {
    expect(emitSf()).not.toContain(';');
  });

  it('协议接线行剥尾分号（PROTOCOL_IMPORT_LINE 派生，非另存副本）', () => {
    const out = emitSf();
    expect(out).toContain("import type { PathSchema } from '@nomicore/vfsl-protocol'\n");
    expect(out).not.toContain("import type { PathSchema } from '@nomicore/vfsl-protocol';");
  });

  it('emitAlias：多字段别名多行化、成员逐行无分隔符、声明无终止分号', () => {
    const out = emitSf();
    // 多字段别名 Meta：{ 起行、成员逐行、} 收行，成员间无分隔符
    expect(out).toMatch(
      /export type Meta = \{\n {2}'m': PathSchema<number, 'leaf'>\n {2}'n': PathSchema<string, 'leaf'>\n\}\n/,
    );
  });

  it('emitAlias：判别联合 map 成员多行化（emitUnionBodyMembers 的 map×object 路径不遗漏分隔符）', () => {
    const out = emitSf();
    expect(out).toMatch(
      /export type Entity =\n {2}\| \{\n {4}'kind': PathSchema<'image', 'leaf'>\n {4}'url': PathSchema<string, 'leaf'>\n {2}\}\n {2}\| \{/,
    );
    // 联合成员内可选字段（brief?）
    expect(out).toMatch(/'brief'\?: PathSchema<string, 'leaf'>/);
  });

  it('emitObjectMembers：嵌套对象字段多行化且逐层缩进（内联 YMap 非别名引用路径）', () => {
    const out = emitSf();
    // ROOT.meta 的内联 map：PathSchema<{ 起行，内层成员缩进 +2，闭括号对齐成员行
    expect(out).toMatch(
      /meta: PathSchema<\{\n {6}'count': PathSchema<number, 'leaf'>\n {6}'note'\?: PathSchema<string, 'leaf'>\n {4}\}, 'map'>/,
    );
  });

  it('emitInterfaceMember：ROOT 接口成员逐行无分隔符（含可选成员）', () => {
    const out = emitSf();
    expect(out).toMatch(/interface VfslPathMap \{\n {4}label: PathSchema<string, 'leaf'>\n/);
    // 接口体内任何成员行不得以 ; 收尾
    const iface = out.slice(out.indexOf('interface VfslPathMap'));
    expect(iface).not.toMatch(/;\s*$/m);
  });

  it('多行 doc 块渲染无行尾空格（`/**` 后不垫空格；@stylistic/no-trailing-spaces 门禁链）', () => {
    const out = emitSf();
    // 生成物任何行不得带行尾空格（含多行 TSDoc 块的首行/续行/闭星行）
    expect(out).not.toMatch(/ +$/m);
    // 多行 doc 逐字保留源换行与源缩进：首行干净 `/**`，续行 `   * ...` 在场
    expect(out).toMatch(/\/\*\*\n {3}\* 多行字段文档第一行\n {3}\* 第二行/);
  });

  it('重复生成逐字节一致（确定性：同输入同输出）', () => {
    expect(emitSf()).toBe(emitSf());
  });

  it('默认模式回归锚：不开启 semicolonFree 时保持既有分号与多行 doc 字节', () => {
    const out = generateProjection(derive(), { sourceText: FIXTURE });
    expect(out).toContain("import type { PathSchema } from '@nomicore/vfsl-protocol';");
    expect(out).toMatch(/export type Meta = \{ 'm': PathSchema<number, 'leaf'>; 'n': PathSchema<string, 'leaf'> \};/);
    // 默认模式仍保留多行 doc 开头 `/** ` 的既有字节；仅无分号模式清理该行尾空格。
    expect(out).toMatch(/\/\*\* \n {3}\* 多行字段文档第一行/);
  });
});

describe('issue #222 — semicolonFree 生成物孤立 tsc 可编译（ASI 安全性实证）', () => {
  it('生成文本写盘后 pre-emit 诊断为零（含多行字面量/联合/可选字段/接口成员的 ASI 边界）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vfsl-codegen-sf-'));
    const file = join(dir, 'generated.ts');
    await writeFile(file, emitSf(), 'utf8');
    const diags = preEmitDiagnostics([file]);
    expect(formatDiagnostics(diags)).toBe('');
    expect(diags).toHaveLength(0);
  });
});

describe('issue #222 — CLI --semicolon-free：生成与 --check 同格式闭环', () => {
  async function makeFixture(): Promise<{ dir: string }> {
    const dir = await mkdtemp(join(tmpdir(), 'vfsl-codegen-sf-cli-'));
    const domainsDir = join(dir, 'domains', 'demo');
    await mkdir(domainsDir, { recursive: true });
    await writeFile(
      join(domainsDir, 'schema.vfsl'),
      `// @lang: vfsl\n// @id: demo@1\n// @version: 1\n${FIXTURE}`,
      'utf8',
    );
    return { dir };
  }

  function run(args: string[], cwd: string): { status: number | null; stderr: string } {
    const r = spawnSync('pnpm', args, { cwd, encoding: 'utf8', shell: false });
    return { status: r.status, stderr: r.stderr ?? '' };
  }

  it('generate --semicolon-free 写盘产物零分号；--check --semicolon-free 新鲜退出 0（无消费端后处理）', async () => {
    const fx = await makeFixture();
    const gen = run(['generate', '--domains', fx.dir, '--semicolon-free'], repoRoot);
    expect(gen.status, gen.stderr).toBe(0);
    const text = await readFile(join(fx.dir, 'domains', 'demo', 'generated.ts'), 'utf8');
    expect(text).not.toContain(';');
    const check = run(['generate', '--check', '--domains', fx.dir, '--semicolon-free'], repoRoot);
    expect(check.status, check.stderr).toBe(0);
  });

  it('格式错配必报过期：semicolon-free 产物用默认 --check 比较 → 退出 1（两格式字节互斥，防混用静默）', async () => {
    const fx = await makeFixture();
    expect(run(['generate', '--domains', fx.dir, '--semicolon-free'], repoRoot).status).toBe(0);
    const check = run(['generate', '--check', '--domains', fx.dir], repoRoot);
    expect(check.status).toBe(1);
  });
});
