/**
 * SA6 红灯契约测试 — 完整 envelope 编译对 `sc1-` 内容寻址 schema ID 的强校验
 * （issue #266，功能开发；ADR 0015「内容寻址 schema ID」+ ADR 0007 指纹语义）。
 *
 * 契约来源：
 * - 任务简报 wiki/raw/task_issue-266.md + SA8 冲突门禁
 *   wiki/raw/task_issue-266_conflict_report.md（verdict clear；B3：新码落
 *   envelope 层 `VFSL-ENV-E<码>:` 码空间，不触方言层 21 码冻结表）；
 * - ADR 0015 L144：任何使用 `sc1-` 前缀的输入 envelope，完整 envelope 编译
 *   （compileSchemaEnvelope）必须验证 canonical 格式及其与 text semantic
 *   fingerprint 的精确匹配；格式错误与语义不匹配各用一个稳定 issue code
 *   （具体编号由实施时按错误注册表分配——本契约不预锁具体数字，只锁
 *   「两模式各自稳定、互不相同、envelope 码空间、不与既有码别名」）；
 * - ADR 0007 L17 指纹语义：semantic fingerprint 忽略空白/普通注释、保留
 *   JSDoc/声明顺序、排除 id → `sc1-` 匹配语义同源（trivia 变体仍匹配，
 *   JSDoc 变体必然不匹配）；旧式 SCHEMA id（非 `sc1-` 前缀）继续兼容。
 *
 * 敏感度规则（ADR 0015 L137-138）经 compileSchemaEnvelope 既有语义指纹路径
 * 逐字落实——本文件不重测 fingerprint 算法本身（compile-schema-envelope.test.ts
 * AC3/AC4 已绿），只测 `sc1-` 作为信封 `id` 值格式时的新增 envelope 校验面。
 *
 * 状态（iteration 0，当前 HEAD 无任何 sc1- 实现——全仓 grep 仅 CONTEXT.md 与
 * ADR 0015 出现）：
 * - 红灯组（describe 2/3/4）：当前实现把 `id` 当不透明标签（envelope.ts 形状
 *   校验只查 string 类型），任意 `sc1-` id 都编译成功（ok:true）——目标断言
 *   ok:false 在旧实现上**行为级失败**（非 import/环境/入口错误），已亲跑验证；
 * - 负控/绿锚组（describe 5/6/7）：旧式 id 兼容、匹配 canonical id 接受、
 *   parse 失败不被误报为语义不匹配——当前即绿，实现后必须保持绿。
 *
 * 参考件：sc1-base32-ref.ts（独立 RFC 4648 实现，与生产实现无共享路径；digest
 * 本身取自既有 compileSchemaEnvelope 的 semanticFingerprint——fingerprint 语义
 * 由 ADR 0007/#72 已冻结，`sc1-` 只是同一 digest 的另一个 canonical 编码）。
 *
 * 关键设计假设（供 SA1/SA3 对照；若设计另有裁决，须回写本文件并走修订轮）：
 * - H1：两校验落在 envelope 层，失败形状 = `{ kind:'envelope', issue }` 单条
 *   （compileSchemaEnvelope 既有 envelope 阶段恒单条纪律，issue #72 AC2）；
 * - H2：格式校验是信封 `id` 值的**形状/值域规则**（envelope 相位，先于 parse）；
 *   语义不匹配需要 text 的规范 IR → 只能在 parse 成功之后判定；parse 失败文本
 *   天然先出 vfsl 问题（H3 锚）；
 * - H3：code 具体数字由实施分配（ADR 0015「编号由实施时按错误注册表分配」），
 *   本文件只锁稳定/互异/envelope 空间/非既有码别名（describe 4 单测自足）；
 * - H4：`sc1-` 前缀大小写敏感（冻结格式逐字 `sc1-`）；payload 全小写、52 位、
 *   无 `=`、pad 位为零（RFC 4648 §3.2——末字符只能为 `a`/`q`）。
 */
import { describe, expect, it } from 'vitest';
import { compileSchemaEnvelope, parseVfsl } from '../src/index.js';
import {
  canonicalBase32FromHex,
  digestHexFromFingerprint,
  digestHexFromSc1Id,
  hexFromCanonicalBase32,
  sc1IdFromFingerprint,
} from './sc1-base32-ref.js';
import type { SchemaParseIssue } from '../src/index.js';

// ---------------------------------------------------------------------------
// fixtures（经既有 parse/compile 通道自检：全部 parse ok + compile ok）
// ---------------------------------------------------------------------------

const TEXT_A = 'type ROOT = { a: string; };';
/** 语义指纹与 TEXT_A 不同的独立文本。 */
const TEXT_B = 'type ROOT = { b: number; };';
/** 仅内部空白差异（trivia）：与 TEXT_A 同指纹。 */
const TEXT_A_WS = 'type  ROOT = { a: string; };';
/** 仅普通 `//` 行注释差异（trivia）：与 TEXT_A 同指纹。 */
const TEXT_A_COMMENT_SLASH = 'type ROOT = { a: string; }; // trailing';
/** 仅普通 `/*` 块注释差异（trivia）：与 TEXT_A 同指纹。 */
const TEXT_A_COMMENT_BLOCK = 'type ROOT = { /* mid */ a: string; };';
/** JSDoc 差异：docs 原文进入 IR → 与 TEXT_A 指纹不同（ADR 0007）。 */
const TEXT_A_JSDOC = 'type ROOT = { /** doc-a */ a: string; };';
/** 语法错误文本（parse 阶段原生失败）。 */
const TEXT_BAD = 'type ROOT = { a: ; };';

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

/** 取 text 的既有语义指纹（经 compileSchemaEnvelope + 任意旧式 id——指纹排除 id）。
 *  2026-09-08 SA6 契约修订轮（SA1 设计 §14.1 / SA2 F6 / SA8 N3 路由，总控派发 SA3 执行）：
 *  锚 id 由 `sc1-fixture-anchor` 更名 `fixture-anchor`——原值以精确 `sc1-` 前缀开头且
 *  payload 非 canonical，与本契约自身的 16 条红灯语义（任何 `sc1-` 前缀 id 必须强校验）
 *  结构性互斥（实现落地后模块收集期即失败）；更名后语义指纹逐字节不变（id 排除在
 *  语义指纹外，ADR 0007/#72 已冻结）。零断言语义变化。 */
function semanticFingerprintOf(text: string): string {
  const r = compile({ lang: 'vfsl', version: 1, id: 'fixture-anchor', text });
  expect(r.ok).toBe(true);
  if (!r.ok) {
    throw new Error(`fixture 自检失败（compileSchemaEnvelope）: ${JSON.stringify(r.issues)}`);
  }
  return r.semanticFingerprint;
}

/** 契约 fixture 基准：TEXT_A 的 canonical sc1- id（来自既有语义指纹 + 独立 Base32 参考件）。 */
const FP_A = semanticFingerprintOf(TEXT_A);
const ID_A = sc1IdFromFingerprint(FP_A);
const FP_B = semanticFingerprintOf(TEXT_B);
const ID_B = sc1IdFromFingerprint(FP_B);
const FP_JSDOC = semanticFingerprintOf(TEXT_A_JSDOC);
const ID_JSDOC = sc1IdFromFingerprint(FP_JSDOC);

/** envelope 单 issue 收窄断言助手（compileSchemaEnvelope envelope 阶段恒单条，issue #72 AC2）。 */
function expectSingleEnvelopeIssue(r: CompileResult): { code: string; message: string } {
  expect(r.ok).toBe(false);
  if (r.ok) {
    throw new Error('fixture 应为 ok:false（sc1- 校验失败目标）');
  }
  expect(r.issues).toHaveLength(1);
  const first = r.issues[0] as SchemaParseIssue;
  expect(first.kind).toBe('envelope');
  if (first.kind !== 'envelope') {
    throw new Error(`sc1- 校验失败应为 kind:'envelope'，实际 ${JSON.stringify(r.issues)}`);
  }
  return first.issue;
}

/** 断言 envelope issue 落在 VFSL-ENV-E 码空间（前缀 + 纯数字 code + 非既有码别名）。 */
const EXISTING_ENVELOPE_CODES = new Set(['1', '2', '3', '4', '5', '100']);
function expectEnvelopeCodeShape(issue: { code: string; message: string }): void {
  expect(issue.message).toMatch(/^VFSL-ENV-E\d+: /);
  expect(issue.code).toMatch(/^\d+$/);
  expect(EXISTING_ENVELOPE_CODES.has(issue.code)).toBe(false);
}

function envelopeWithId(id: string, text: string): object {
  return { lang: 'vfsl', version: 1, id, text };
}

// ---------------------------------------------------------------------------
// 参考件自检（RFC 4648 §10 KAT + 256-bit digest canonical 特性）——本组恒绿，
// 保证上述 sc1- fixture 的编码/解码参考可信（防参考件漂移造成循环论证）。
// ---------------------------------------------------------------------------

describe('sc1- envelope 校验 — 参考件自检（RFC 4648 §10 KAT + 256-bit canonical）', () => {
  it('RFC 4648 §10 KAT：小写去 padding 编码逐字命中', () => {
    const kat: Array<[string, string]> = [
      ['', ''],
      ['66', 'my'], // 'f'
      ['666f', 'mzxq'], // 'fo'
      ['666f6f', 'mzxw6'], // 'foo'
      ['666f6f62', 'mzxw6yq'], // 'foob'
      ['666f6f6261', 'mzxw6ytb'], // 'fooba'
      ['666f6f626172', 'mzxw6ytboi'], // 'foobar'
    ];
    for (const [hex, expected] of kat) {
      expect(canonicalBase32FromHex(hex)).toBe(expected);
    }
  });

  it('解码往返：KAT 编码解回原 hex；非 canonical 输入（大写/`=`/非法字符/pad 位非零）拒绝', () => {
    for (const hex of ['', '66', '666f', '666f6f', '666f6f62', '666f6f6261', '666f6f626172']) {
      const enc = canonicalBase32FromHex(hex);
      expect(hexFromCanonicalBase32(enc)).toBe(hex);
    }
    expect(hexFromCanonicalBase32('MZXW6YTBOI')).toBeNull(); // 大写非 canonical
    expect(hexFromCanonicalBase32('mzxw6ytboi=')).toBeNull(); // '=' 非字母表
    expect(hexFromCanonicalBase32('mzxw6ytbo0')).toBeNull(); // '0' 非字母表
    expect(hexFromCanonicalBase32('mzxw6ytboj')).toBeNull(); // 'j'=01001：pad 位非零
  });

  it('256-bit digest canonical：32 bytes → 恰 52 字无 padding，往返恒真；末字符 ∈ {a,q}', () => {
    for (const text of [TEXT_A, TEXT_B, TEXT_A_JSDOC, TEXT_A_WS, TEXT_A_COMMENT_BLOCK]) {
      const fp = semanticFingerprintOf(text);
      const digest = digestHexFromFingerprint(fp);
      expect(digest).not.toBeNull();
      if (digest === null) throw new Error('fingerprint 格式异常');
      const id = sc1IdFromFingerprint(fp);
      expect(id.length).toBe(56); // 'sc1-' + 52
      expect(id.endsWith('=')).toBe(false);
      expect(id.slice(4)).toMatch(/^[a-z2-7]{52}$/);
      const last = id[55] as string;
      expect(['a', 'q'].includes(last)).toBe(true); // pad 位为零 ⇒ 末字符 0/16
      expect(digestHexFromSc1Id(id)).toBe(digest);
    }
    // 极端 digest 形状钉位（位序与 RFC 4648 一致性的硬锚）
    expect(canonicalBase32FromHex('00'.repeat(32))).toBe('a'.repeat(52));
    expect(canonicalBase32FromHex('ff'.repeat(32))).toBe(`${'7'.repeat(51)}q`);
  });
});

// ---------------------------------------------------------------------------
// 红灯 1：语义不匹配必须拒绝——canonical 格式正确但 digest ≠ text 语义指纹
// ---------------------------------------------------------------------------

describe('sc1- envelope 校验 — 语义不匹配拒绝（红灯：当前实现放行 ok:true）', () => {
  it('红灯：canonical sc1- id 编码了另一文本的 digest（ID_B + TEXT_A）→ ok:false 单条 envelope issue', () => {
    expect(FP_A).not.toBe(FP_B); // fixture 前提：两文本指纹确实不同
    const r = compile(envelopeWithId(ID_B, TEXT_A));
    const issue = expectSingleEnvelopeIssue(r); // 当前实现 ok:true → 此处红灯
    expectEnvelopeCodeShape(issue);
  });

  it('红灯：canonical sc1- id 编码了裸文本 digest，但 text 带 JSDoc（ID_A + TEXT_A_JSDOC）→ ok:false', () => {
    expect(FP_JSDOC).not.toBe(FP_A); // JSDoc 保留在指纹中（ADR 0007）→ digest 必不同
    const r = compile(envelopeWithId(ID_A, TEXT_A_JSDOC));
    const issue = expectSingleEnvelopeIssue(r); // 当前实现 ok:true → 此处红灯
    expectEnvelopeCodeShape(issue);
  });
});

// ---------------------------------------------------------------------------
// 红灯 2：sc1- 前缀的 canonical 格式错误必须拒绝（含大小写/padding/长度/pad 位）
// ---------------------------------------------------------------------------

describe('sc1- envelope 校验 — canonical 格式错误拒绝（红灯：当前实现放行 ok:true）', () => {
  it.each([
    ['前缀大小写错误 SC1-', `SC1-${ID_A.slice(4)}`],
    ['前缀大小写错误 Sc1-', `Sc1-${ID_A.slice(4)}`],
    ['前缀大小写错误 sC1-', `sC1-${ID_A.slice(4)}`],
    ['格式版本错误 sc2-', `sc2-${ID_A.slice(4)}`],
    ['空 payload', 'sc1-'],
    ['payload 过短（51 字符）', `sc1-${ID_A.slice(4).slice(0, 51)}`],
    ['payload 过长（53 字符）', `sc1-${ID_A.slice(4)}a`],
    ['payload 大写（非 canonical）', `sc1-${ID_A.slice(4).toUpperCase()}`],
    ['payload 带 = padding', `sc1-${ID_A.slice(4)}====`],
    ['payload 非法字符 1/0/8/-', 'sc1-'.concat('1'.repeat(52))],
    ['payload 内嵌空白', `sc1-${ID_A.slice(4).slice(0, 26)} ${ID_A.slice(4).slice(26)}`],
    ['payload pad 位非零（末字符 m=01100）', `sc1-${'a'.repeat(51)}m`],
  ])('红灯：%s → ok:false 单条 envelope issue（格式码）', (_label, id) => {
    const r = compile(envelopeWithId(id, TEXT_A));
    const issue = expectSingleEnvelopeIssue(r); // 当前实现 ok:true → 此处红灯
    expectEnvelopeCodeShape(issue);
  });

  it('红灯：canonical 格式错误与文本内容无关——合法文本 + 格式错 id 仍拒绝（ID_A payload 改一字）', () => {
    const payload = ID_A.slice(4);
    const mutated = `sc1-${payload.slice(0, 20)}x${payload.slice(21)}`; // 'x' 非字母表
    const r = compile(envelopeWithId(mutated, TEXT_A));
    const issue = expectSingleEnvelopeIssue(r); // 当前实现 ok:true → 此处红灯
    expectEnvelopeCodeShape(issue);
  });
});

// ---------------------------------------------------------------------------
// 红灯 3：格式错误与语义不匹配各产生一个稳定且互异的 envelope issue code
// （具体编号由实施按注册表分配——本组只锁稳定性/互异性/码空间，不锁数字）
// ---------------------------------------------------------------------------

describe('sc1- envelope 校验 — 稳定互异 issue code（红灯：当前实现无此失败路径）', () => {
  it('红灯：格式错与语义不匹配两模式各自 code 稳定（重复调用相等）、互不相同、非既有码别名', () => {
    const formatA = expectSingleEnvelopeIssue(compile(envelopeWithId('sc1-NotBase32!!', TEXT_A)));
    const formatB = expectSingleEnvelopeIssue(compile(envelopeWithId('sc1-NotBase32!!', TEXT_A)));
    const mismatchA = expectSingleEnvelopeIssue(compile(envelopeWithId(ID_B, TEXT_A)));
    const mismatchB = expectSingleEnvelopeIssue(compile(envelopeWithId(ID_B, TEXT_A)));
    // 稳定性：同模式重复运行 code 一致（确定性 issue）
    expect(formatB.code).toBe(formatA.code);
    expect(mismatchB.code).toBe(mismatchA.code);
    // 互异性：格式错误与语义不匹配是两个不同 issue code
    expect(formatA.code).not.toBe(mismatchA.code);
    // 码空间：envelope 注册表纯数字 code + 既有 21 码方言表零触 + 既有 ENV_1..5/100 不别名
    for (const issue of [formatA, formatB, mismatchA, mismatchB]) {
      expectEnvelopeCodeShape(issue);
    }
    // 稳定 message 前缀（冻结通道：VFSL-ENV-E<码>:）
    expect(formatA.message.startsWith(`VFSL-ENV-E${formatA.code}: `)).toBe(true);
    expect(mismatchA.message.startsWith(`VFSL-ENV-E${mismatchA.code}: `)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 负控：旧式 SCHEMA id（非 sc1- 前缀）继续兼容——当前绿，实现后必须保持绿
// ---------------------------------------------------------------------------

describe('sc1- envelope 校验 — 旧式 SCHEMA id 兼容（负控，恒绿）', () => {
  it('旧式 id（仓内真实形态/ADR 0006 例举/普通测试 id）全部照常编译成功', () => {
    const legacyIds = [
      'vfs3-assets@1', // 仓内 domains/@id 真实形态
      'compile-fixture', // 既有测试形态
      '命名空间@schema版本', // ADR 0006 谱系标签例举
      'legacy-2026@v1/with-slashes', // 任意旧式标签
    ];
    const fp = FP_A;
    for (const id of legacyIds) {
      const r = compile(envelopeWithId(id, TEXT_A));
      expect(r.ok).toBe(true);
      if (!r.ok) {
        throw new Error(`旧式 id 应编译成功: ${JSON.stringify(r.issues)}`);
      }
      expect(r.semanticFingerprint).toBe(fp); // id 不参与语义指纹（ADR 0007/0005）
    }
  });

  it('含 `sc1` 子串但非 `sc1-` 前缀的 id 仍走旧式路径（前缀匹配精确）', () => {
    const r = compile(envelopeWithId('mysc1-provisional-id', TEXT_A));
    expect(r.ok).toBe(true);
    if (!r.ok) {
      throw new Error(`非 sc1- 前缀 id 应编译成功: ${JSON.stringify(r.issues)}`);
    }
    expect(r.semanticFingerprint).toBe(FP_A);
  });
});

// ---------------------------------------------------------------------------
// 验收正例：canonical sc1- id 与 text 语义指纹精确匹配 → 编译成功（目标行为；
// 当前 id 不参与校验亦绿——红/绿对照由红灯 1/2 组证明 id 确实被强校验）
// ---------------------------------------------------------------------------

describe('sc1- envelope 校验 — canonical 匹配正例（验收锚）', () => {
  it('逐字匹配：ID_A + TEXT_A → ok:true，指纹与 id payload 的 digest 一一对应', () => {
    const r = compile(envelopeWithId(ID_A, TEXT_A));
    expect(r.ok).toBe(true);
    if (!r.ok) {
      throw new Error(`匹配 canonical id 应编译成功: ${JSON.stringify(r.issues)}`);
    }
    expect(r.envelope.id).toBe(ID_A); // id 原样回显
    expect(r.semanticFingerprint).toBe(FP_A);
    const digest = digestHexFromFingerprint(r.semanticFingerprint);
    expect(digest).not.toBeNull();
    // 一一重编码：id payload 解码 == 指纹 digest；指纹 digest 重编码 == id payload
    expect(digestHexFromSc1Id(ID_A)).toBe(digest);
    expect(canonicalBase32FromHex(digest as string)).toBe(ID_A.slice(4));
  });

  it('trivia 稳定：空白/普通注释变体文本与 ID_A 语义指纹一致 → 编译成功（ADR 0015 L137）', () => {
    for (const variant of [TEXT_A_WS, TEXT_A_COMMENT_SLASH, TEXT_A_COMMENT_BLOCK]) {
      const fp = semanticFingerprintOf(variant);
      expect(fp).toBe(FP_A); // fixture 前提：trivia 不改变语义指纹
      const r = compile(envelopeWithId(ID_A, variant));
      expect(r.ok).toBe(true);
      if (!r.ok) {
        throw new Error(`trivia 变体应匹配 ID_A: ${JSON.stringify(r.issues)}`);
      }
      expect(r.semanticFingerprint).toBe(FP_A);
    }
  });

  it('JSDoc 敏感自洽：ID_JSDOC + TEXT_A_JSDOC 匹配成功（与红灯 1 的交叉验证）', () => {
    const r = compile(envelopeWithId(ID_JSDOC, TEXT_A_JSDOC));
    expect(r.ok).toBe(true);
    if (!r.ok) {
      throw new Error(`JSDoc 文本与其自身 digest 应匹配: ${JSON.stringify(r.issues)}`);
    }
    expect(r.semanticFingerprint).toBe(FP_JSDOC);
  });
});

// ---------------------------------------------------------------------------
// 绿锚：parse 失败文本先出 vfsl 问题，不得被误报为 sc1- 语义不匹配
// （语义指纹需要规范 IR → 判定只能在 parse 成功之后；H3）
// ---------------------------------------------------------------------------

describe('sc1- envelope 校验 — parse 失败不被误报为语义不匹配（绿锚）', () => {
  it('TEXT_BAD + canonical ID_A → ok:false，原生 vfsl issues 与 parseVfsl 同输入深相等，零 envelope 码', () => {
    const native = parseVfsl(TEXT_BAD);
    expect(native.ok).toBe(false);
    if (native.ok) {
      throw new Error('fixture 自检失败：TEXT_BAD 应 parse 失败');
    }
    const r = compile(envelopeWithId(ID_A, TEXT_BAD));
    expect(r.ok).toBe(false);
    if (r.ok) {
      throw new Error('TEXT_BAD 应编译失败');
    }
    for (const item of r.issues) {
      expect(item.kind).toBe('vfsl'); // parse 原生通道零损保留
    }
    const unwrapped = r.issues.map((item) =>
      item.kind === 'vfsl' ? item.issue : { message: item.issue.message, line: -1, column: -1 },
    );
    expect(unwrapped).toEqual(native.issues);
  });
});
