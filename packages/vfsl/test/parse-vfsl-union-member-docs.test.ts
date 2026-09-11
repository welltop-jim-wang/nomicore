/**
 * SA6 红灯契约 — issue #306（M4 联合成员文档注释：解析挂载 + IR `memberDocs`）。
 *
 * 契约来源：ADR 0019 决策 1/2/3/4/9（docs/adr/0019-vfsl-union-member-docs.md）+
 * issue #306 What-to-build / AC1 / AC2 / AC4。v1-spec §5 现行「三锚位 + E305」文本由
 * ADR 0019 显式授权修订（#309 与实现同支落地）——本文件断言的是 ADR 决策面的目标行为，
 * 不是现文行为。
 *
 * 基线（录制于实现前 HEAD 91c4add，`parseVfsl` 现行为）：
 * - M4 全部正例当前 ok:false VFSL-E305（成员 doc 无锚位回收）→ 本文件相应用例红；
 * - 坍缩 / `|` 夹缝（非标记成员）/ M3 优先 / 存量 IR 与指纹金样本当前即绿 → 实现后必须
 *   保持（ADR 0019 决策 9「只增不改」的正负对照）。
 *
 * 断言一律经公共入口 parseVfsl 观察运行时 IR；semantic 指纹经 fingerprint 接缝
 * （既有 compile-schema-envelope-sentinel.test.ts 先例）。断言不读源码、不 skip、
 * 不软化：M4 正例在实现前必须红。
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseVfsl } from '../src/index.js';
import type { VfslAlias, VfslModule } from '../src/index.js';
import { semanticFingerprintOf } from '../src/fingerprint.js';
import { FIXTURE_B, SPEC_FIXTURE } from './union-member-docs-fixture.js';

/** ADR 0019 决策 4 目标形状：union 节点条件键 `memberDocs?: string[][]`（与 members 等长）。 */
interface UnionWithMemberDocs {
  kind: 'union';
  members: unknown[];
  memberDocs?: string[][];
}

/** 存量稳定金样本（E-1）：录制于实现前 HEAD 91c4add 的 parseVfsl 现行为。 */
const SPEC_FIXTURE_IR_SHA256 = '325cf923c4de04b72920699fab0ce33ef381c72fe5e2c6fe801394894d4f3ffc';
const SPEC_FIXTURE_FINGERPRINT = 'sha256:v1:b71be76e3d3579670236b14a36373716db6238d86a15da440f44aecbb9b0631c';
const FIXTURE_B_IR_SHA256 = '78332590a86d3b2bb084fb377182fec5f161dd62e82d8d8cb136c33cafb4be71';
const FIXTURE_B_FINGERPRINT = 'sha256:v1:55095e88e08a923ec64c3fbe006d533fb735684a0987e7b974c5ab4cf5b5144d';

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function parseOk(text: string): VfslModule {
  const result = parseVfsl(text);
  if (!result.ok) {
    // 红灯诊断：失败信息携带实际 issues——证明红因是能力缺口（成员 doc 落 E305），
    // 而非 fixture / 测试入口错误。
    throw new Error(`期望 ok:true（M4 成员 doc 应合法挂载），实际 issues: ${JSON.stringify(result.issues)}`);
  }
  return result.module;
}

/** E305 维持面断言：恰一条、冻结前缀、锚注释起始（ADR 0019 决策 2/1 与 v1-spec §4）。 */
function parseE305(text: string, line: number, column: number): string {
  const result = parseVfsl(text);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('期望 ok:false（E305），实际 ok:true');
  expect(result.issues).toHaveLength(1);
  const issue = result.issues[0]!;
  expect(issue.message).toMatch(/^VFSL-E305: /);
  expect([issue.line, issue.column]).toEqual([line, column]);
  return issue.message;
}

function aliasOf(module: VfslModule, name: string): VfslAlias {
  const alias = module.aliases.find((a) => a.name === name);
  if (alias === undefined) throw new Error(`测试前提失败：IR 中无别名 '${name}'`);
  return alias;
}

function unionOf(type: unknown, where: string): UnionWithMemberDocs {
  const union = type as UnionWithMemberDocs;
  expect(union.kind, `${where} 应为 union 节点`).toBe('union');
  return union;
}

/** 整键在场性：ADR 0019 决策 4 要求「全体成员均无 doc 时整键不存在」（非空表、非 undefined 值）。 */
function hasMemberDocsKey(node: object): boolean {
  return Object.prototype.hasOwnProperty.call(node, 'memberDocs');
}

/** 子串出现次数（「不双挂」断言的可观察口径）。 */
function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('issue #306 / ADR 0019 — M4 联合成员 doc 解析挂载与 IR memberDocs', () => {
  it('多行前导 | 布局：doc 挂到 | 之后的成员，memberDocs 与 members 等长对齐（AC1 / 决策 1）', () => {
    const text =
      'type ROOT = {};\n' +
      'type Status =\n' +
      '  /** 草稿：可继续编辑 */\n' +
      '  | "draft"\n' +
      '  /** 已提交：只可追加备注 */\n' +
      '  | "submitted"\n' +
      '  | "archived";';
    const status = aliasOf(parseOk(text), 'Status');
    const union = unionOf(status.type, 'Status');
    expect(union.members).toHaveLength(3);
    expect(union.memberDocs).toEqual([[' 草稿：可继续编辑 '], [' 已提交：只可追加备注 '], []]);
    expect(union.memberDocs).toHaveLength(union.members.length);
    // IR 可 JSON 序列化（内容哈希缓存前提）
    expect(JSON.parse(JSON.stringify(status))).toEqual(status);

    // 负控（当前即绿）：同布局剥离成员 doc → ok:true；红灯不来自多行布局本身
    const control = parseVfsl(
      'type ROOT = {};\ntype Status =\n  | "draft"\n  | "submitted"\n  | "archived";',
    );
    expect(control.ok).toBe(true);
  });

  it('单行首成员布局：doc 紧邻成员起始记号 → 挂 member 0（AC1 / 决策 1）', () => {
    const union = unionOf(aliasOf(parseOk('type ROOT = {};\ntype T = /** 甲 */ "a" | "b";'), 'T').type, 'T');
    expect(union.members).toHaveLength(2);
    expect(union.memberDocs).toEqual([[' 甲 '], []]);

    // 负控（当前即绿）：同布局无 doc
    expect(parseVfsl('type ROOT = {};\ntype T = "a" | "b";').ok).toBe(true);
  });

  it('doc 紧邻 | 之前 → 挂 | 之后的成员（无前导 | 的成员亦然）（AC1 / 决策 1）', () => {
    const union = unionOf(
      aliasOf(parseOk('type ROOT = {};\ntype T = "a" /** 乙 */ | "b";'), 'T').type,
      'T',
    );
    expect(union.memberDocs).toEqual([[], [' 乙 ']]);
  });

  it('连续多条 doc 按出现顺序全部挂同一成员（换行 / 内部 * / @tag 逐字保留）（AC1）', () => {
    const text =
      'type ROOT = {};\n' +
      'type T =\n' +
      '  /** 一 */\n' +
      '  /** 二\n' +
      ' * @tag */\n' +
      '  | "a"\n' +
      '  | "b";';
    const union = unionOf(aliasOf(parseOk(text), 'T').type, 'T');
    expect(union.memberDocs).toEqual([[' 一 ', ' 二\n * @tag '], []]);
  });

  it('逐节点条件附加（负控，当前即绿）：无成员 doc 的联合节点不携带 memberDocs 键（决策 4）', () => {
    const plain = aliasOf(parseOk('type ROOT = { plain: Plain };\ntype Plain = YPlainArray<"x" | "y">;'), 'Plain');
    const marker = plain.type as unknown as { kind: string; arg: unknown };
    expect(marker.kind).toBe('marker');
    const inner = unionOf(marker.arg, 'Plain.<item>');
    expect(inner.members).toHaveLength(2);
    expect(hasMemberDocsKey(inner)).toBe(false);
    expect(JSON.stringify(inner)).not.toContain('memberDocs');
  });

  it('逐节点条件附加：同模块内有 doc 的联合携带键、无 doc 的联合仍不携带（AC4 / 决策 4）', () => {
    const text =
      'type ROOT = { pair: Pair; plain: Plain };\n' +
      'type Plain = YPlainArray<"x" | "y">;\n' +
      'type Pair = /** 甲 */ | "a" | "b";';
    const module = parseOk(text);
    const pair = unionOf(aliasOf(module, 'Pair').type, 'Pair');
    expect(pair.memberDocs).toEqual([[' 甲 '], []]);
    const marker = aliasOf(module, 'Plain').type as unknown as { arg: unknown };
    expect(hasMemberDocsKey(unionOf(marker.arg, 'Plain.<item>'))).toBe(false);
  });

  it('M3 优先于 M4（不双挂）：| 夹缝 doc 挂标记节点、| 前 doc 挂成员（AC2 / 决策 3）', () => {
    const text =
      'type ROOT = {};\ntype T = /** 成员口径 */ | /** 载体口径 */ YLeaf<"a"> | YLeaf<"b">;';
    const union = unionOf(aliasOf(parseOk(text), 'T').type, 'T');
    expect(union.memberDocs).toEqual([[' 成员口径 '], []]);

    const first = union.members[0] as unknown as { kind: string; docs: string[] };
    expect(first.kind).toBe('marker');
    expect(first.docs).toEqual([' 载体口径 ']);
    // 同一 doc 不双挂：载体口径 只在标记节点出现一次，不进入成员 doc 表
    expect(JSON.stringify(first).split('载体口径').length - 1).toBe(1);
    expect(JSON.stringify(union.memberDocs)).not.toContain('载体口径');
  });

  it('坍缩两形态维持 E305，锚注释起始（AC2 / 决策 2）', () => {
    // 与现行行为逐字节一致：两种坍缩写法均 E305 @ (2,10)
    for (const text of [
      'type ROOT = {};\ntype T = /** d */ "a";',
      'type ROOT = {};\ntype T = /** d */ | "a";',
    ]) {
      parseE305(text, 2, 10);
    }
  });

  it('| 夹缝 doc（非标记成员）维持 E305，锚注释起始（AC2 / 决策 1）', () => {
    parseE305('type ROOT = {};\ntype T = "a" | /** d */ "b";', 2, 16);
    // 多行形态同判：夹缝 doc 在非标记成员上不挂载
    parseE305('type ROOT = {};\ntype T =\n  | "a"\n  | /** d */ "b";', 4, 5);
  });

  it('M3 优先的坍缩形态（负控，当前即绿）：doc 挂标记节点、不产生成员挂载（决策 2/3）', () => {
    const alias = aliasOf(parseOk('type ROOT = {};\ntype T = | /** d */ YLeaf<"a">;'), 'T');
    expect(alias.type.kind).toBe('marker');
    const marker = alias.type as unknown as { docs: string[] };
    expect(marker.docs).toEqual([' d ']);
    expect(occurrences(JSON.stringify(alias), ' d ')).toBe(1);
    expect(JSON.stringify(alias)).not.toContain('memberDocs');
  });

  it('E305 消息正文补「联合成员」可挂载节点枚举（AC2 / 决策 9.3；§4 前缀冻结）', () => {
    const message = parseE305('type ROOT = {};\ntype T = /** d */ "a";', 2, 10);
    expect(message).toMatch(/^VFSL-E305: /);
    // 前缀冻结（v1-spec §4）；正文由 ADR 0019 决策 9.3 授权：可挂载节点枚举补「联合成员」
    expect(message).toMatch(/联合.{0,6}成员/);
  });

  it('存量稳定金样本 A（E-1）：v1-spec §10 fixture 的 IR JSON 与 semantic 指纹逐字节不变（AC4）', () => {
    expectStableIr('SPEC_FIXTURE', SPEC_FIXTURE, SPEC_FIXTURE_IR_SHA256, SPEC_FIXTURE_FINGERPRINT);
  });

  it('存量稳定金样本 B（E-1）：联合密集 fixture 的 IR JSON 与 semantic 指纹逐字节不变（AC4）', () => {
    expectStableIr('FIXTURE_B', FIXTURE_B, FIXTURE_B_IR_SHA256, FIXTURE_B_FINGERPRINT);
  });
});

/** E-1：存量（无成员 doc）文本的 IR 紧凑 JSON 与 semantic 指纹逐字节不变 + 域前缀不升级。 */
function expectStableIr(name: string, text: string, irDigest: string, fingerprint: string): void {
  const module = parseOk(text);
  expect(sha256(JSON.stringify(module)), `${name}: IR 紧凑 JSON 逐字节不变`).toBe(irDigest);
  const actual = semanticFingerprintOf('vfsl', 1, module);
  expect(actual, `${name}: semantic 指纹逐字节不变`).toBe(fingerprint);
  expect(actual.startsWith('sha256:v1:'), `${name}: 域前缀保持 v1（D2 升级触发器不命中）`).toBe(true);
  expect(JSON.stringify(module), `${name}: 存量 IR 不得出现 memberDocs 键`).not.toContain('memberDocs');
}
