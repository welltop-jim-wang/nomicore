/**
 * SA6 哨兵测试 — compileSchemaEnvelope 攻击评审红线补锚（issue #72，Phase 3）。
 *
 * 契约来源：wiki/raw/task_issue-72_sa2_review.md「红线测试思路」RT-1b / RT-1c /
 * RT-2 / RT-3 / RT-4 原文逐条（SA2 R1 pass 附带的 MAJOR(M1c)/MINOR(M2,M3)/NOTE(N2)
 * 加固项，经总控排入本修订轮，新内部测试文件承载——vitest include 覆盖
 * `packages/vfsl/test/**`）。
 *
 * 与 owned 文件（compile-schema-envelope.test.ts，断言禁改）的关系：本文件只承载
 * SA2 评审排队的新哨兵契约，不复述既有 28 用例锚点；corpus fixture（TEXT_A /
 * TEXT_REF / TEXT_JSDOC_1）复用 owned 文件同名单定义。实现已就位（SA3 commit
 * 7033490 已转绿）——本文件五条应全绿；若红，说明实现违反哨兵契约，如实报告、
 * 不改实现。
 *
 * RT 清单与锚点（全部为运行时行为断言，零源码 grep）：
 * - RT-1b（M1c round-trip 保序哨兵）：直连 ../src/fingerprint.js 的
 *   semanticFingerprintOf（同 sha256Hex KAT 直连先例），对 corpus 断言
 *   JSON round-trip 后指纹不变——未来换序列化器或引入非保序第二生产者时先红，
 *   先于任何跨生产者不一致出厂；
 * - RT-1c（M1c 边界钉死）：手工以异序键构造同值 module（alias 键插入序反转）→
 *   指纹 ≠ parser 产物指纹——把「不支持跨序归一」从隐式变显式契约（若未来有人
 *   误以为有归一化，此锚先红）；
 * - RT-2（M2 数值闸门锚）：parseVfsl('type ROOT = { a: 1e999; };') → ok:false
 *   （当前 tokenizes 为 number(1)+ident(e999) 落语法错；若未来 tokenizer 静默接受
 *   指数记号，parser Number.isFinite E100 仍应拦截 Infinity）；400 位超双精度数字
 *   串 → ok:false 且锚 E100 拒绝路径——防「非有限值进 IR → JSON "null" 坍缩面」
 *   被未来方言票无声打开；
 * - RT-3（M3 谎报键集两向）：隐藏向 → 编译 ok:true 且产物恰四键无隐藏键（重建
 *   回显 = 数据面安全边界，多余数据不可达产物）；伪造向 → ENV-5 单条保守拒绝、
 *   绝不外抛；
 * - RT-4（N2 不可枚举键）：Object.defineProperty 不可枚举字符串自有键 → ENV-5
 *   单条且消息含键名——锚 §3.4「不可枚举字符串键计入（getOwnPropertyNames 语义）」
 *   契约。
 *
 * trap 名勘误（对 SA2 原文的工程性修正，契约语义不变）：RT-3 的「getOwnPropertyNames
 * trap」在 Proxy handler 中并不存在——Object.getOwnPropertyNames / Object.keys /
 * Reflect.ownKeys 均走 `ownKeys` trap。若按原文把 `getOwnPropertyNames` 当作
 * handler 键书写，会静默落默认行为（隐藏向无法藏键、伪造向无法加键），哨兵将
 * 测不到「谎报键集」契约；本文件一律用 `ownKeys` trap 行使该契约。
 */
import { describe, expect, it } from 'vitest';
import { compileSchemaEnvelope, parseVfsl } from '../src/index.js';
import { semanticFingerprintOf } from '../src/fingerprint.js';
import type { SchemaParseIssue, VfslModule } from '../src/index.js';

// ---------------------------------------------------------------------------
// fixtures（复用 owned 文件 compile-schema-envelope.test.ts 同名单定义：
// corpus 全部 parse ok，见 owned 文件头自检注记）
// ---------------------------------------------------------------------------

const TEXT_A = 'type ROOT = { a: string; };';
/** ref 按名引用不内联（ADR-0003 §4）：ROOT.a 为 ref A，A 为 map 形别名。 */
const TEXT_REF = 'type ROOT = { a: A; b: string; }; type A = { x: number; };';
/** JSDoc 差异：字段级文档注释原文进入 IR（ADR-0001：JSDoc 保留）。 */
const TEXT_JSDOC_1 = 'type ROOT = { /** doc-a */ a: string; };';

/** 断言文本合法并返回 module（corpus 自检 + RT-1b/1c 的 parser 产物基准）。 */
function parseVfslOk(text: string): VfslModule {
  const r = parseVfsl(text);
  expect(r.ok).toBe(true);
  if (!r.ok) {
    throw new Error(`fixture 自检失败（parseVfsl）: ${JSON.stringify(r.issues)}`);
  }
  return r.module;
}

// ---------------------------------------------------------------------------
// RT-1b / RT-1c：fingerprint.ts 直连（M1c 守卫可执行化的两条哨兵）
// ---------------------------------------------------------------------------

describe('RT-1b — semantic 指纹 JSON round-trip 保插入序（单一生产者不变式哨兵）', () => {
  it('corpus（TEXT_A / TEXT_REF / TEXT_JSDOC_1）round-trip 后指纹不变', () => {
    for (const text of [TEXT_A, TEXT_REF, TEXT_JSDOC_1]) {
      const module = parseVfslOk(text);
      // JSON.parse 按文本序建键、JSON.stringify 按插入序发射；IR 键均非整数样
      // 字符串 ⇒ round-trip 保插入序 ⇒ 反序列化产物指纹与新鲜产物一致（SA2 证据 #8）
      const roundTripped = JSON.parse(JSON.stringify(module)) as VfslModule;
      expect(semanticFingerprintOf('vfsl', 1, roundTripped)).toBe(
        semanticFingerprintOf('vfsl', 1, module),
      );
    }
  });
});

describe('RT-1c — 不支持跨序归一：异序键同值 module 指纹 ≠ parser 产物指纹', () => {
  it('手工异序构造（alias 键插入序反转）→ 值深相等但指纹不同', () => {
    const module = parseVfslOk(TEXT_A);
    const alias = module.aliases[0] as VfslModule['aliases'][number];
    // 同值异序：键集与键值完全一致，仅插入序反转（JSON.stringify 发射序即插入序）
    const reordered: Record<string, unknown> = {};
    for (const key of Object.keys(alias).reverse()) {
      reordered[key] = (alias as unknown as Record<string, unknown>)[key];
    }
    const reorderedModule: VfslModule = {
      kind: 'vfsl-module',
      aliases: [reordered as unknown as VfslModule['aliases'][number]],
    };
    // 前提自检：值与 parser 产物深相等（toEqual 忽略键序）——差异只在插入序
    expect(reorderedModule).toEqual(module);
    // 契约：指纹不跨序归一——同值异序 → 不同指纹（若未来有人误以为有归一化，
    // 此锚先红；「不支持跨序归一」从此为显式契约）
    expect(semanticFingerprintOf('vfsl', 1, reorderedModule)).not.toBe(
      semanticFingerprintOf('vfsl', 1, module),
    );
  });
});

// ---------------------------------------------------------------------------
// RT-2：数值闸门（M2——防「非有限值进 IR → JSON "null" 坍缩面」被未来方言票打开）
// ---------------------------------------------------------------------------

describe('RT-2 — 数值闸门：非有限/超双精度字面量不得进 IR', () => {
  it('指数记号 1e999 → parseVfsl ok:false（当前 tokenizes 为 number(1)+ident(e999) 落语法错；未来若 tokenizer 静默接受指数记号，parser isFinite E100 仍应拦截）', () => {
    const r = parseVfsl('type ROOT = { a: 1e999; };');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues[0]?.message).toMatch(/^VFSL-E\d+:/);
      expect(typeof r.issues[0]?.line).toBe('number');
      expect(typeof r.issues[0]?.column).toBe('number');
    }
  });

  it('400 位超双精度数字串 → ok:false 且锚 E100 拒绝路径（Number.isFinite 闸门，防 Infinity 进 IR）', () => {
    const r = parseVfsl(`type ROOT = { a: ${'9'.repeat(400)}; };`);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // E100 拒绝路径的可观测输出：超双精度不进 IR——若未来方言票静默放开
      // 数值语法，此锚先红（D2 升级触发器已登记该情形）
      expect(r.issues[0]?.message).toMatch(/^VFSL-E100: 数字字面量超出可序列化数值域/);
    }
  });
});

// ---------------------------------------------------------------------------
// RT-3：Proxy 谎报键集两向（M3——数据面安全边界 = 重建回显而非 ENV-5 扫描）
// ---------------------------------------------------------------------------

describe('RT-3 — Proxy 谎报键集两向（重建回显 = 数据面安全边界）', () => {
  it('隐藏向：ownKeys 谎报恰四键（target 含多余键 evil）→ 编译 ok:true 且产物恰四键、无隐藏键', () => {
    // 隐藏多余键的输入可骗过 ENV-5 扫描（getOwnPropertyNames 走 ownKeys trap），
    // 但 validateEnvelopeShape 重建回显只抄四键单读物化值——多余数据不可达产物
    const hidden = new Proxy({ lang: 'vfsl', version: 1, id: 'x', text: TEXT_A, evil: 1 }, {
      ownKeys: () => ['lang', 'version', 'id', 'text'],
    });
    const r = compileSchemaEnvelope(hidden);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // 产物恰四键：重建回显对象（表序插入）——JSON.stringify 恰四键无 evil
      expect(Object.keys(r.envelope)).toEqual(['lang', 'version', 'id', 'text']);
      expect(JSON.stringify(r.envelope)).toBe(
        JSON.stringify({ lang: 'vfsl', version: 1, id: 'x', text: TEXT_A }),
      );
    }
  });

  it('伪造向：ownKeys 谎报含假键 → ENV-5 单条保守拒绝、绝不外抛', () => {
    const fake = new Proxy({ lang: 'vfsl', version: 1, id: 'x', text: TEXT_A }, {
      ownKeys: () => ['lang', 'version', 'id', 'text', 'fake'],
    });
    const r = compileSchemaEnvelope(fake);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues).toHaveLength(1); // 单条契约（AC2：envelope 域恒单 issue）
      const first = r.issues[0] as SchemaParseIssue;
      expect(first.kind).toBe('envelope');
      if (first.kind === 'envelope') {
        expect(first.issue.code).toBe('5'); // ENV-5 多余键（严格封闭）
        expect(first.issue.readOnly).toBe(false); // 形状域错误非只读
        expect(first.issue.message).toMatch(/^VFSL-ENV-E5: /);
        expect(first.issue.message).toContain('fake');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// RT-4：不可枚举字符串自有键计入 ENV-5（N2——§3.4 契约锚）
// ---------------------------------------------------------------------------

describe('RT-4 — 不可枚举字符串自有键计入 ENV-5（getOwnPropertyNames 语义）', () => {
  it('Object.defineProperty 不可枚举键 → ENV-5 单条且消息含键名', () => {
    const input: Record<string, unknown> = { lang: 'vfsl', version: 1, id: 'x', text: TEXT_A };
    Object.defineProperty(input, 'hidden', { value: 1, enumerable: false });
    const r = compileSchemaEnvelope(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues).toHaveLength(1); // 单条契约
      const first = r.issues[0] as SchemaParseIssue;
      expect(first.kind).toBe('envelope');
      if (first.kind === 'envelope') {
        expect(first.issue.code).toBe('5'); // ENV-5：不可枚举 own 键仍计入多余键
        expect(first.issue.readOnly).toBe(false);
        expect(first.issue.message).toMatch(/^VFSL-ENV-E5: /);
        expect(first.issue.message).toContain('hidden'); // 诊断含该键名
      }
    }
  });
});
