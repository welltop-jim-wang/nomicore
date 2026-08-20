/**
 * SA6 红灯测试 — `@nomicore/vfsl-codegen` 生成器：判别式联合发射（AC3 文案级）+ 头注/哈希 +
 * `declare module` 增广载体（ADR 0005 §4）。
 *
 * 契约来源（ADR 0005 §4「生成文件入仓，头注 GENERATED … DO NOT EDIT + 源文本哈希」+ 任务简报
 * 工作内容 3 + issue #26 AC3 + SA5 锚点 6/7）：
 * - 生成文件头起注 `GENERATED … DO NOT EDIT` + 源文本哈希（确定性、可 diff）；
 * - 判别式联合（有 discriminator 的 union 节点）必须发射为**可窄化的 TS 判别联合**：
 *   各成员共享一个精确字面量判别字段（`kind`），成员互异、值 = 声明序；
 *   联合键空间 = 成员字段键集并集；成员独有字段 read → `T | undefined`（D2，本例文案级
 *   断言成员字段名在场；`T|undefined` 宽度在 test-d 的 read 投影断言）；
 * - 联合节点 kind = `'map'` 载体，Value = 判别联合（成员为 object-like map 类型）。
 *
 * 文案级 vs 编译级分工：本文件断言发射**文案**是可窄化判别联合的形状（判别字段字面量 +
 * 成员互异 + map 载体的结构）；"经 tsc 真正窄化" 的编译级断言与 `T|undefined` 宽度
 * 由 `generate-discriminated-narrow.test-d.ts` 承担（vitest typecheck）。两个文件配合锚定
 * AC3。
 *
 * 红灯现状：`@nomicore/vfsl-codegen` 模块不存在 → import 即红（真红根因）。
 */
import { describe, expect, it } from 'vitest';
/** @nomicore/vfsl 既有包（前置依赖，svc 绿）：相对导入避免依赖 workspace 软链（新包未接线）。 */
import { parseVfsl, evaluate } from '../../vfsl/src/index.js';
/** 被测导出尚不存在 → module-not-found → 整文件红灯（真红根因，非语法/转译错误）。 */
import { generateProjection } from '@nomicore/vfsl-codegen';

/** 判别联合 fixture：member 0（image）独有 url；member 1（text）独有 richBody/title。 */
const FIXTURE = `/** 根 */
type ROOT = YMap<{
  entityList: YArray<Entity>;
}>;

/** 实体的判别联合 */
type Entity =
  | { kind: "image"; url: YLeaf<string> }
  | { kind: "text"; richBody: YLeaf<string>; title: YLeaf<string> };
`;

function evaluateFixture(): import('../../vfsl/src/index.js').DerivedSchema {
  const parsed = parseVfsl(FIXTURE);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(`parseVfsl 失败：${JSON.stringify(parsed.issues)}`);
  const result = evaluate(parsed.module);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`evaluate 失败：${JSON.stringify(result.issues)}`);
  return result.derived;
}

function emit(): string {
  return generateProjection(evaluateFixture(), { sourceText: FIXTURE });
}

describe('ADR 0005 §4 — 生成文件头注 GENERATED + 源文本哈希（确定性）', () => {
  it('头注含 GENERATED 与 DO NOT EDIT 与源文本哈希', () => {
    const out = emit();
    expect(out).toMatch(/GENERATED/);
    expect(out).toMatch(/DO NOT EDIT/);
    // 源文本哈希锚点：确定性输入 → 输出稳定；非空哈希标记在场
    expect(out).toMatch(/hash/i);
    // 确定性：同输入两次发射逐字节一致（纯发射器可复现性，CI regen-diff 前提）
    expect(emit()).toBe(out);
  });

  it('确定性可复现：两次调用生成文本逐字节一致（regen-diff 差异唯一来源 = 源/生成器漂移）', () => {
    expect(emit()).toBe(emit());
  });
});

describe('AC3 — 判别式联合发射为可窄化 TS 判别联合（文案级）', () => {
  it('判别字段 kind 以精确字面量发射（image/text），供 tsc 逐成员窄化', () => {
    const out = emit();
    expect(out).toMatch(/['"]kind['"]\s*:\s*PathSchema<['"]image['"],\s*['"]leaf['"]/);
    expect(out).toMatch(/['"]kind['"]\s*:\s*PathSchema<['"]text['"],\s*['"]leaf['"]/);
  });

  it('union 节点 kind = \'map\'（判别联合是 map 载体）', () => {
    const out = emit();
    // entityList 元素 = Entity 判别联合 → map 载体，含两个互异成员
    expect(out).toMatch(/['"]image['"][\s\S]*['"]text['"]/);
    expect(out).toMatch(/['"]map['"]/);
  });

  it('成员互异字段按声明类型发射（url / richBody / title），联合键空间 = 并集', () => {
    const out = emit();
    expect(out).toMatch(/\burl\b/);
    expect(out).toMatch(/\brichBody\b/);
    expect(out).toMatch(/\btitle\b/);
  });
});

describe('§3.2.1 — ROOT 形态范围限界（R4/C：设计文本升为契约）', () => {
  it('联合形 ROOT（含前导 |）经 parse+evaluate ok 后，generateProjection 抛 UnsupportedRootShapeError', () => {
    // 设计 §10 行 11 实测：联合 ROOT parse+evaluate 均 ok，structure = root → union——
    // 范围限界必须在发射器侧响亮拒绝，而非静默错发射（顶层接口丢 D2 read 宽度）
    const UNION_ROOT = `type ROOT = | { a: YLeaf<string> } | { b: YLeaf<number> };`;
    const parsed = parseVfsl(UNION_ROOT);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(`parseVfsl 失败：${JSON.stringify(parsed.issues)}`);
    const result = evaluate(parsed.module);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`evaluate 失败：${JSON.stringify(result.issues)}`);
    // UnsupportedRootShapeError 的消息前缀契约（命名化错误，CLI → exit 2）
    expect(() => generateProjection(result.derived)).toThrow(/ROOT 形态不支持/);
  });
});
