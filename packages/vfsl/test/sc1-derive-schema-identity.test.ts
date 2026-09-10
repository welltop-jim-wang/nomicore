/**
 * SA6 红灯契约测试 — @nomicore/vfsl 窄 Module interface：VFSL text →
 * semantic fingerprint + `sc1-` 内容寻址 schema ID（issue #266；ADR 0015
 * L119-133「窄派生接口」+ ADR 0007 指纹语义）。
 *
 * 契约来源：
 * - 任务简报 wiki/raw/task_issue-266.md AC1/AC2/AC4 + SA8 冲突门禁
 *   wiki/raw/task_issue-266_conflict_report.md（verdict clear；冲突点 1/3 逐字
 *   对应 ADR 0015 L119-133）；
 * - ADR 0015 L119-125：窄 Module interface 输入 lang=vfsl、version=1、VFSL
 *   text；不接收 provisional envelope ID；不暴露 IR、派生 schema、validator；
 *   复用现有编译 pipeline；返回 semantic fingerprint 与 schema ID，或 VFSL
 *   issues；不是 REST endpoint。
 * - ADR 0015 L127-133：schema ID 冻结格式 `sc1-<52 位小写 RFC 4648 Base32>`，
 *   payload = semantic fingerprint 完整 256-bit SHA-256 digest（不截断、无
 *   padding），与 `sha256:v1:<64 lowercase hex>` 携带相同 digest 信息；
 * - ADR 0015 L137-138 + ADR 0007 L17：空白/普通注释不改变 ID；JSDoc、声明
 *   顺序及其他 VFSL 语义变化会改变 ID。
 *
 * 关键设计假设（供 SA1/SA3 对照；若设计另有裁决，须回写本文件并走修订轮）：
 * - H1（接口形状）：公共导出单函数
 *   `deriveSchemaIdentity(text: string)` →
 *   `{ ok: true; semanticFingerprint: string; schemaId: string } |
 *    { ok: false; issues: VfslIssue[] }`。
 *   命名取 ADR 0015「派生 schema 身份」动词 + 包内函数命名风格（parseVfsl /
 *   compileSchemaEnvelope）。lang=vfsl、version=1 是接口上下文常量（简报
 *   「输入 VFSL text（lang=vfsl、version=1）」），不进入参数表——text-only
 *   签名是「窄」的最窄读法；`fn.length === 1` 同时锚「不接受 provisional
 *   envelope ID」（AC4）；
 * - H2（ok 分支形状）：恰两值 semanticFingerprint + schemaId，无 module /
 *   derived / validator / envelope / id 键（AC4「不暴露 IR、派生 schema、
 *   validator」的可观察锚 = ok 分支精确键集）；
 * - H3（失败面）：parse 失败 → ok:false，issues = 原生 VfslIssue 数组
 *   （与 parseVfsl 同输入深相等——复用现有编译 pipeline 的失败通道，
 *   ADR 0015 L125「或 VFSL issues」）；
 * - H4（语义一致）：fingerprint 与既有 compileSchemaEnvelope 的
 *   semanticFingerprint 逐字节相等（同一条编译 pipeline；id 排除在指纹外——
 *   ADR 0007 已冻结），`sc1-` id = 同一 digest 的 canonical Base32 编码
 *   （独立参考件 sc1-base32-ref.ts 双向验证，防与实现同源循环论证）。
 *
 * 状态（iteration 0）：当前 HEAD 无该导出（全仓 grep 无任何 sc1- 实现）。
 * 本文件经公共入口静态 import 尚不存在的导出 → 当前整文件红（构造性红灯，
 * 同 compile-schema-envelope.test.ts Phase 1 先例：模块实例化失败
 * "does not provide an export named 'deriveSchemaIdentity'"）；SA3 按 H1 落
 * 地导出后整文件转绿，作为 #266 AC1/AC2/AC4 的验收锚。全部断言锚运行时
 * 行为（返回形状/格式/值/键集/确定性/敏感性），无任何源码文本断言。
 * 绿灯可信度预验证：本文件每条期望的取值逻辑已按既有 pipeline
 * （compileSchemaEnvelope + 独立 Base32 参考件）在 scratch probe 全量演算
 * 通过（见 SA6 报告 §13），失败只可能来自导出缺失本身。
 */
import { describe, expect, it } from 'vitest';
import {
  compileSchemaEnvelope,
  deriveSchemaIdentity,
  parseVfsl,
} from '../src/index.js';
import {
  canonicalBase32FromHex,
  digestHexFromFingerprint,
  digestHexFromSc1Id,
  hexFromCanonicalBase32,
  isSc1Shape,
} from './sc1-base32-ref.js';
import type { VfslIssue } from '../src/index.js';

// ---------------------------------------------------------------------------
// fixtures（同 sc1-schema-id-envelope-validation.test.ts；经既有通道自检）
// ---------------------------------------------------------------------------

const TEXT_A = 'type ROOT = { a: string; };';
const TEXT_A_WS = 'type  ROOT = { a: string; };';
const TEXT_A_COMMENT_SLASH = 'type ROOT = { a: string; }; // trailing';
const TEXT_A_COMMENT_BLOCK = 'type ROOT = { /* mid */ a: string; };';
const TEXT_A_JSDOC_1 = 'type ROOT = { /** doc-a */ a: string; };';
const TEXT_A_JSDOC_2 = 'type ROOT = { /** doc-b */ a: string; };';
const TEXT_ORDER_1 = 'type ROOT = { a: string; b: number; };';
const TEXT_ORDER_2 = 'type ROOT = { b: number; a: string; };';
const TEXT_BAD = 'type ROOT = { a: ; };';

interface DerivedOk {
  ok: true;
  semanticFingerprint: string;
  schemaId: string;
}
interface DerivedFail {
  ok: false;
  issues: VfslIssue[];
}
type DerivedResult = DerivedOk | DerivedFail;

/** 收窄断言 helper（结果形状按 H2；导出存在后全部断言执行）。 */
function expectDerivedOk(r: DerivedResult): DerivedOk {
  expect(r.ok).toBe(true);
  if (!r.ok) {
    throw new Error(`fixture 应为 ok:true: ${JSON.stringify(r.issues)}`);
  }
  expect(Object.keys(r).sort()).toEqual(['ok', 'schemaId', 'semanticFingerprint']); // AC4：无 IR/派生/validator
  return r;
}

/** 既有 pipeline 参照：compileSchemaEnvelope（任意旧式 id）的语义指纹。 */
function referenceFingerprint(text: string): string {
  const r = compileSchemaEnvelope({ lang: 'vfsl', version: 1, id: 'narrow-interface-anchor', text });
  expect(r.ok).toBe(true);
  if (!r.ok) {
    throw new Error(`fixture 自检失败（compileSchemaEnvelope）: ${JSON.stringify(r.issues)}`);
  }
  return r.semanticFingerprint;
}

const FP_A = referenceFingerprint(TEXT_A);
const FP_JSDOC_1 = referenceFingerprint(TEXT_A_JSDOC_1);
const FP_JSDOC_2 = referenceFingerprint(TEXT_A_JSDOC_2);
const FP_ORDER_1 = referenceFingerprint(TEXT_ORDER_1);
const FP_ORDER_2 = referenceFingerprint(TEXT_ORDER_2);

// ---------------------------------------------------------------------------
// AC1/AC2/AC4：窄接口公共导出、确定性派生、形状与不暴露纪律
// ---------------------------------------------------------------------------

describe('deriveSchemaIdentity — 窄接口形状与确定性派生（红灯：导出尚不存在）', () => {
  it('红灯：@nomicore/vfsl 公共导出单参函数（不接受 provisional envelope ID：fn.length === 1）', () => {
    expect(typeof deriveSchemaIdentity).toBe('function'); // 当前 import 即红（导出缺失）
    expect(deriveSchemaIdentity.length).toBe(1); // text-only 签名（H1）
  });

  it('红灯：合法 text → ok:true，恰 {ok, semanticFingerprint, schemaId} 三键，双值格式冻结', () => {
    const r = expectDerivedOk(deriveSchemaIdentity(TEXT_A) as unknown as DerivedResult);
    expect(r.semanticFingerprint).toMatch(/^sha256:v1:[0-9a-f]{64}$/); // ADR 0007 域分离格式
    expect(r.schemaId).toMatch(/^sc1-[a-z2-7]{52}$/); // ADR 0015 冻结格式（小写、52 位、无 =）
    expect(r.schemaId.length).toBe(56); // 'sc1-' + 52
    expect(isSc1Shape(r.schemaId)).toBe(true);
    // ok 分支绝不携带 IR/派生 schema/validator/envelope（AC4 键集锚已在 expectDerivedOk）
    expect('module' in r).toBe(false);
    expect('derived' in r).toBe(false);
    expect('envelope' in r).toBe(false);
  });

  it('红灯：schemaId payload = semanticFingerprint digest 的 canonical Base32（一一重编码，独立参考件双向）', () => {
    const r = expectDerivedOk(deriveSchemaIdentity(TEXT_A) as unknown as DerivedResult);
    const digest = digestHexFromFingerprint(r.semanticFingerprint);
    expect(digest).not.toBeNull();
    // ① id payload 解码 == 指纹 digest；② digest 重编码 == id payload；
    // ③ 与既有 pipeline 语义指纹同 digest 信息（ADR 0015 L133）
    expect(digestHexFromSc1Id(r.schemaId)).toBe(digest);
    expect(canonicalBase32FromHex(digest as string)).toBe(r.schemaId.slice(4));
    expect(r.semanticFingerprint).toBe(FP_A); // 同一条编译 pipeline 的既有指纹（H4）
  });

  it('红灯：确定性——同 text 重复调用产出逐字节一致的 fingerprint/schemaId', () => {
    const a = expectDerivedOk(deriveSchemaIdentity(TEXT_A) as unknown as DerivedResult);
    const b = expectDerivedOk(deriveSchemaIdentity(TEXT_A) as unknown as DerivedResult);
    expect(b.schemaId).toBe(a.schemaId);
    expect(b.semanticFingerprint).toBe(a.semanticFingerprint);
  });
});

// ---------------------------------------------------------------------------
// ADR 0015 L137-138 敏感度规则：空白/普通注释稳定，JSDoc/声明顺序敏感
// ---------------------------------------------------------------------------

describe('deriveSchemaIdentity — 空白/普通注释稳定，JSDoc/声明顺序敏感（红灯：导出尚不存在）', () => {
  it('红灯：空白与普通注释（// 与 /* */）不改变 fingerprint 与 schemaId', () => {
    const base = expectDerivedOk(deriveSchemaIdentity(TEXT_A) as unknown as DerivedResult);
    expect(referenceFingerprint(TEXT_A_WS)).toBe(FP_A); // fixture 前提（既有 pipeline 已冻）
    for (const variant of [TEXT_A_WS, TEXT_A_COMMENT_SLASH, TEXT_A_COMMENT_BLOCK]) {
      const v = expectDerivedOk(deriveSchemaIdentity(variant) as unknown as DerivedResult);
      expect(v.semanticFingerprint).toBe(base.semanticFingerprint);
      expect(v.schemaId).toBe(base.schemaId);
    }
  });

  it('红灯：JSDoc 变化改变 fingerprint 与 schemaId（ADR 0007：docs 原文进入 IR）', () => {
    const bare = expectDerivedOk(deriveSchemaIdentity(TEXT_A) as unknown as DerivedResult);
    const docA = expectDerivedOk(deriveSchemaIdentity(TEXT_A_JSDOC_1) as unknown as DerivedResult);
    const docB = expectDerivedOk(deriveSchemaIdentity(TEXT_A_JSDOC_2) as unknown as DerivedResult);
    expect(FP_JSDOC_1).not.toBe(FP_A); // fixture 前提
    expect(docA.schemaId).not.toBe(bare.schemaId);
    expect(docB.schemaId).not.toBe(bare.schemaId);
    expect(docA.schemaId).not.toBe(docB.schemaId); // docs 原文不同 → ID 不同
    expect(docA.semanticFingerprint).not.toBe(docB.semanticFingerprint);
  });

  it('红灯：声明顺序变化改变 fingerprint 与 schemaId（其余语义等价）', () => {
    const o1 = expectDerivedOk(deriveSchemaIdentity(TEXT_ORDER_1) as unknown as DerivedResult);
    const o2 = expectDerivedOk(deriveSchemaIdentity(TEXT_ORDER_2) as unknown as DerivedResult);
    expect(FP_ORDER_1).not.toBe(FP_ORDER_2); // fixture 前提
    expect(o1.schemaId).not.toBe(o2.schemaId);
    expect(o1.semanticFingerprint).not.toBe(o2.semanticFingerprint);
  });
});

// ---------------------------------------------------------------------------
// ADR 0015 L125：或返回 VFSL issues（复用现有 pipeline 失败面）
// ---------------------------------------------------------------------------

describe('deriveSchemaIdentity — parse 失败返回原生 VFSL issues（红灯：导出尚不存在）', () => {
  it('红灯：非法 text → ok:false 且恰 {ok, issues} 两键，issues 与 parseVfsl 深相等', () => {
    const native = parseVfsl(TEXT_BAD);
    expect(native.ok).toBe(false); // fixture 前提
    if (native.ok) {
      throw new Error('fixture 自检失败：TEXT_BAD 应 parse 失败');
    }
    const r = deriveSchemaIdentity(TEXT_BAD) as unknown as DerivedResult;
    expect(r.ok).toBe(false);
    if (r.ok) {
      throw new Error('非法 text 应返回 ok:false');
    }
    expect(Object.keys(r).sort()).toEqual(['issues', 'ok']);
    expect(r.issues).toEqual(native.issues); // 原生 VfslIssue 数组零损（无 envelope 包装）
    for (const issue of r.issues) {
      expect(issue.message).toMatch(/^VFSL-E\d+: /);
      expect(typeof issue.line).toBe('number');
      expect(typeof issue.column).toBe('number');
    }
  });
});
