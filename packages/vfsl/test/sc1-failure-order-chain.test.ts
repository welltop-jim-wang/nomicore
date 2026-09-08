/**
 * SA3 顺序链 + 边缘钉位测试（issue #266）——SA2 独立攻击评审的**约束性交付条件**：
 *
 * - C1（F1，MAJOR→约束性）：SA1 设计 §8.5 把可观察失败优先级链
 *   `ENV-1/2/3（形状）→ ENV-5（封闭）→ ENV-4（方言）→ ENV-6（sc1- 格式）→
 *   vfsl parse issues → ENV-7（sc1- 语义不匹配）→ vfsl evaluate issues → ENV-100`
 *   固化为兼容行为（包 AGENTS.md：「issue ordering + envelope strictness =
 *   compatibility behavior」），但 SA6 契约两端各自只锁单态——组合态零锚。本文件
 *   按 SA2 §4-T1 场景（T1.1–T1.5）补 ≥4 条顺序链测试，含 evaluate mock 注入手法：
 *   - T1.1 ENV-6 先于 parse（malformed sc1- id × 语法错误文本 → 单条 ENV_6、
 *     零 kind:'vfsl'，证 parse 未运行）；
 *   - T1.2 ENV-7 先于 evaluate（canonical-but-mismatched id × 可求值文本 +
 *     evaluate 失败注入 → 单条 ENV_7 且 evaluate **未被调用**，证 mismatch 早出
 *     省去注定失败的求值）；
 *   - T1.3 ENV-5 先于 ENV-6（多余键 × sc1- 族 id → 单条 ENV_5，非 ENV_6）；
 *   - T1.4 ENV-4 先于 ENV-6（SC1- 族 id × 未知方言 → 单条 ENV_4、readOnly=true，
 *     非 ENV_6——未知方言 = 全盘只读拒收，先于 id 值域裁定）；
 *   - T1.5 正交诚实边界（匹配 canonical id × evaluate 失败注入 → evaluate 的
 *     vfsl issues 零损透传、ENV_7 不触发——「真实性校验 ≠ 可求值性」，设计 §9）。
 * - C3（F3，MINOR）：保留族触发器的 Unicode/边缘形态钉位（T2）——全角数字
 *   `sc１-`（不在 ASCII `[0-9]` 族内 → 旧式路径放行）、前导零 `sc01-`（族内非
 *   canonical → ENV_6）、`sc-`（无数字，族外 → 放行）。
 *
 * 手法（同 compile-schema-envelope.test.ts / docscope-getcompiled.test.ts 先例）：
 * evaluate 失败注入经 vi.mock('../src/evaluate.js') 包裹公共求值接缝（默认透传
 * 真实实现），以 mockImplementationOnce 注入一次性失败 + 收尾 drain（未消费的
 * 一次性武装显式消费，防泄漏进后续用例）。代码识别经 envelope.ts 注册表常量
 * `EnvelopeErrCode`（稳定码 = 兼容面；与 SA6 文件 1 describe 4 的行为级锁定互补）。
 * 本文件不重复 SA6 两契约文件的单态断言，只锁组合态顺序链与族触发器边缘。
 */
import { describe, expect, it, vi } from 'vitest';
import { compileSchemaEnvelope, deriveSchemaIdentity, evaluate } from '../src/index.js';
import { EnvelopeErrCode } from '../src/envelope.js';
import type { SchemaParseIssue } from '../src/index.js';

/** 求值接缝包裹（唯一 mock 面，同 #72/#54 先例）：默认透传真实 evaluate。 */
vi.mock('../src/evaluate.js', async (importOriginal) => {
  const mod = (await importOriginal()) as typeof import('../src/evaluate.js');
  return { ...mod, evaluate: vi.fn(mod.evaluate) };
});

const evaluateMock = vi.mocked(evaluate);

// ---------------------------------------------------------------------------
// fixtures（指纹/id 经窄接口 deriveSchemaIdentity 派生——parse-only，不依赖
// evaluate；与 compileSchemaEnvelope 成功路径同一条语义指纹生产者）
// ---------------------------------------------------------------------------

const TEXT_A = 'type ROOT = { a: string; };';
const TEXT_B = 'type ROOT = { b: number; };';
const TEXT_BAD = 'type ROOT = { a: ; };';

interface DerivedOkShape {
  ok: true;
  semanticFingerprint: string;
  schemaId: string;
}
interface DerivedFailShape {
  ok: false;
  issues: Array<{ message: string; line: number; column: number }>;
}
type DerivedResult = DerivedOkShape | DerivedFailShape;

function deriveOk(text: string): DerivedOkShape {
  const r = deriveSchemaIdentity(text) as unknown as DerivedResult;
  expect(r.ok).toBe(true);
  if (!r.ok) {
    throw new Error(`fixture 自检失败（deriveSchemaIdentity）: ${JSON.stringify(r.issues)}`);
  }
  return r;
}

/** FP_A/ID_A：TEXT_A 的语义指纹与 canonical sc1- id；ID_B：TEXT_B 的 id（≠ ID_A）。 */
const FP_A = deriveOk(TEXT_A).semanticFingerprint;
const ID_A = deriveOk(TEXT_A).schemaId;
const ID_B = deriveOk(TEXT_B).schemaId;

interface CompileOkShape {
  ok: true;
  envelope: { lang: string; version: number; id: string; text: string };
  semanticFingerprint: string;
}
interface CompileFailShape {
  ok: false;
  issues: SchemaParseIssue[];
}
type CompileResult = CompileOkShape | CompileFailShape;

function compile(input: unknown): CompileResult {
  return compileSchemaEnvelope(input) as unknown as CompileResult;
}

function envelopeWithId(id: string, text: string): object {
  return { lang: 'vfsl', version: 1, id, text };
}

/** envelope 单 issue 收窄断言助手（compileSchemaEnvelope envelope 阶段恒单条，#72 AC2）。 */
function expectSingleEnvelopeIssue(r: CompileResult): { code: string; message: string; readOnly: boolean } {
  expect(r.ok).toBe(false);
  if (r.ok) {
    throw new Error('组合序测试应为 ok:false（期望 envelope 相位失败）');
  }
  expect(r.issues).toHaveLength(1);
  const first = r.issues[0] as SchemaParseIssue;
  expect(first.kind).toBe('envelope');
  if (first.kind !== 'envelope') {
    throw new Error(`期望单条 kind:'envelope'，实际 ${JSON.stringify(r.issues)}`);
  }
  // 冻结 message 前缀（envelope.ts 唯一构造点纪律）
  expect(first.issue.message.startsWith(`VFSL-ENV-E${first.issue.code}: `)).toBe(true);
  return first.issue;
}

/** 收尾卫生（getcompiled R2 教训）：未消费的一次性武装显式 drain，防泄漏进后续用例。 */
function drainEvaluateMock(): void {
  evaluateMock({ kind: 'vfsl-module', aliases: [] });
  evaluateMock.mockClear();
}

// ---------------------------------------------------------------------------
// C1：失败优先级链组合态（设计 §8.5）——SA2 F1 约束性交付条件
// ---------------------------------------------------------------------------

describe('sc1- envelope 校验 — 失败优先级链（ENV-6 先于 parse / ENV-7 先于 evaluate / ENV-5、ENV-4 先于 ENV-6）', () => {
  it('T1.1 ENV-6 先于 parse：malformed sc1- id + 语法错误文本 → 恰 1 条 ENV_6（envelope），零 vfsl issue', () => {
    const r = compile(envelopeWithId('sc1-NotBase32!!', TEXT_BAD));
    // expectSingleEnvelopeIssue 断言恰 1 条且 kind:'envelope'——若有任何 vfsl issue
    // 混入（parse 已运行），长度断言即失败（TEXT_BAD parse 失败会产 vfsl issue）
    const issue = expectSingleEnvelopeIssue(r);
    expect(issue.code).toBe(EnvelopeErrCode.ENV_6); // 格式码先出，证 parse 未运行
  });

  it('T1.2 ENV-7 先于 evaluate：canonical-but-mismatched id + 可求值文本 + evaluate 失败注入 → 单条 ENV_7 且 evaluate 未被调用', () => {
    expect(ID_B).not.toBe(ID_A); // fixture 前提：两文本 digest 确实不同
    const injected = [
      { message: 'VFSL-E100: 求值期失败模式（测试注入）: 展开资源预算', line: 1, column: 1 },
    ];
    evaluateMock.mockClear();
    evaluateMock.mockImplementationOnce(() => ({ ok: false as const, issues: injected }));
    const r = compile(envelopeWithId(ID_B, TEXT_A));
    // 断言先于 drain（drain 会触发一次 evaluate）
    const issue = expectSingleEnvelopeIssue(r);
    expect(issue.code).toBe(EnvelopeErrCode.ENV_7); // 语义不匹配码先出
    expect(evaluateMock).not.toHaveBeenCalled(); // 证 mismatch 在 evaluate 前裁定（早出省去注定失败的求值）
    drainEvaluateMock();
  });

  it('T1.3 ENV-5 先于 ENV-6：多余键 + sc1- 族 id → 单条 ENV_5（严格封闭先于格式步）', () => {
    const r = compile({ lang: 'vfsl', version: 1, id: 'sc1-!!', text: TEXT_A, extra: 1 });
    const issue = expectSingleEnvelopeIssue(r);
    expect(issue.code).toBe(EnvelopeErrCode.ENV_5);
    expect(issue.code).not.toBe(EnvelopeErrCode.ENV_6);
  });

  it('T1.4 ENV-4 先于 ENV-6：SC1- 族 id + 未知方言 → 单条 ENV_4（readOnly=true，非 ENV_6）', () => {
    const r = compile({ lang: 'wml', version: 1, id: `SC1-${'a'.repeat(52)}`, text: TEXT_A });
    const issue = expectSingleEnvelopeIssue(r);
    expect(issue.code).toBe(EnvelopeErrCode.ENV_4);
    expect(issue.readOnly).toBe(true); // 未知方言 = 全盘只读 loud-fail
    expect(issue.code).not.toBe(EnvelopeErrCode.ENV_6);
  });

  it('T1.5 正交诚实边界：匹配 canonical id + evaluate 失败注入 → evaluate 的 vfsl issues 零损透传（ENV_7 不触发）', () => {
    const injected = [
      { message: 'VFSL-E100: 求值期失败模式（测试注入）: 展开资源预算', line: 1, column: 1 },
    ];
    evaluateMock.mockClear();
    evaluateMock.mockImplementationOnce(() => ({ ok: false as const, issues: injected }));
    const r = compile(envelopeWithId(ID_A, TEXT_A));
    // 断言先于 drain
    expect(evaluateMock).toHaveBeenCalledTimes(1); // 匹配 id → mismatch 不触发 → evaluate 被调用
    expect(r.ok).toBe(false);
    if (r.ok) {
      throw new Error('注入求值失败应编译失败');
    }
    expect(r.issues).toHaveLength(1);
    const first = r.issues[0] as SchemaParseIssue;
    expect(first.kind).toBe('vfsl'); // evaluate 原生 issues 通道（非 ENV_7 envelope 码）
    expect(r.issues.every((item) => item.kind === 'vfsl')).toBe(true);
    if (first.kind !== 'vfsl') {
      throw new Error(`期望 kind:'vfsl' 透传，实际 ${JSON.stringify(r.issues)}`);
    }
    expect(first.issue).toEqual(injected[0]);
    drainEvaluateMock();
  });
});

// ---------------------------------------------------------------------------
// C3：保留族触发器 Unicode/边缘形态钉位（SA2 F3；设计 §7 D3 边界语义推演钉位）
// ---------------------------------------------------------------------------

describe('sc1- 保留族边界形态（族内非 canonical 拒、族外旧式放行）', () => {
  it('T2 钉位：Unicode 数字不在保留族——全角 `sc１-<52 字>` 走旧式路径 → ok:true，指纹不变', () => {
    const r = compile(envelopeWithId(`sc１-${ID_A.slice(4)}`, TEXT_A)); // '１' = U+FF11
    expect(r.ok).toBe(true);
    if (!r.ok) {
      throw new Error(`族外 id 应编译成功: ${JSON.stringify(r.issues)}`);
    }
    expect(r.semanticFingerprint).toBe(FP_A);
  });

  it('T2 钉位：前导零 `sc01-<52 字>` 族内非 canonical → ENV_6 单条；`sc-`（无数字）族外 → ok:true', () => {
    const family = compile(envelopeWithId(`sc01-${ID_A.slice(4)}`, TEXT_A));
    const issue = expectSingleEnvelopeIssue(family);
    expect(issue.code).toBe(EnvelopeErrCode.ENV_6);
    const bare = compile(envelopeWithId('sc-', TEXT_A));
    expect(bare.ok).toBe(true);
    if (!bare.ok) {
      throw new Error(`sc-（族外）应编译成功: ${JSON.stringify(bare.issues)}`);
    }
    expect(bare.semanticFingerprint).toBe(FP_A);
  });
});
