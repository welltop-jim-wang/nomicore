/**
 * SA6 红灯测试 — compileSchemaEnvelope：严格封闭信封 + 双指纹 + 冻结产物（issue #72，功能开发）。
 *
 * 契约来源：
 * - 任务简报 wiki/raw/task_issue-72.md（六条 AC）+ 约束清单
 *   wiki/raw/task_issue-72_relevant_decisions.md（ADR-0007 直接治理条款 + ADR-0001/0003/0005
 *   支撑条款 + 冲突门禁 N2「指纹域分离」收紧点）；
 * - 成功产物五件套（ADR-0007）：冻结的 envelope、IR module、DerivedSchema、
 *   envelopeFingerprint、semanticFingerprint；五阶段结果联合：envelope → dialect →
 *   parse → evaluate → internal；
 * - 指纹：SHA-256 + UTF-8 + canonical JSON + 版本化域分离格式 `sha256:v1:<hex>`；
 *   信封指纹覆盖四键；语义指纹覆盖 lang+version+规范 IR，忽略空白/普通注释、保留
 *   JSDoc/声明顺序、排除 id（ADR-0005：id 是标签不是键）；
 * - envelope/module/derived 递归深冻结且共享引用关系不被复制破坏
 *   （ADR-0003 §4：ref 按名引用不内联展开——菱形引用靠 ref 共享，深冻结不得内联复制）；
 * - 无模块级 cache / Host 生命周期状态（ADR-0007：缓存生命周期留给
 *   NamespaceRuntime/Registry——本函数为纯函数，重复调用产出新对象引用）。
 *
 * 关键设计假设（供 SA1 设计对照；若设计另有裁决，须回写本文件并走修订轮）：
 * - H1：envelope 指纹的 canonical JSON = 四键按 v1-spec §7 冻结表序
 *   （lang, version, id, text——envelope.ts ENVELOPE_KEYS 注释「表序冻结」）紧凑序列化
 *   （JSON.stringify 语义：无空白、键序 = 表序、值原样）；hex 段 =
 *   sha256Hex(canonical 文档)。「覆盖四键」中 lang/version 两键无法经成功路径直接
 *   变体验证（方言门禁只放行 vfsl@1），由该精确摘要断言间接锚定（摘要覆盖全部四键）。
 * - H2：semantic 指纹不锁定精确字节（规范 IR 的 canonical 形态属 SA1 设计自由度），
 *   以格式 + 确定性 + 行为敏感性（空白/普通注释忽略；JSDoc/声明顺序保留；id 排除）
 *   锚定；域分离（N2）以两域内容不同源（信封 JSON 文档 vs lang+version+IR 文档）+
 *   双指纹互异锚定。
 * - H3：失败联合的阶段区分以可观测 issue 内容判别（envelope/dialect/internal 为
 *   kind:'envelope' 单 issue，code 区分；parse/evaluate 为原生 VfslIssue 形状数组），
 *   不要求显式 stage 字段（SA1 可加，本文件不强锁）。
 *
 * 锚点纪律：
 * - 全部断言锚定运行时行为（返回形状、指纹格式与敏感性、冻结态、引用同一性、
 *   mock 观测的求值接缝调用），无任何源码文本 grep；
 * - evaluate 失败注入经 vi.mock('../src/evaluate.js') 包裹被冻结的公共求值接缝
 *   （ADR-0003 §1），默认透传真实实现（同 docscope-getcompiled.test.ts 先例）——
 *   编译入口无论从哪个文件组合 evaluate 都必经该接缝；
 * - 本文件状态演进：
 *   - Phase 1（验收锚定）：compileSchemaEnvelope 尚不存在 → 静态 import 失败，全部
 *     用例红（构造性红灯，同 docscope-getcompiled.test.ts / parse-schema-envelope.test.ts
 *     先例）；
 *   - Phase 2（SA3 实现后）：用例转绿，作为 #72 的验收锚。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { evaluate, parseSchemaEnvelope, parseVfsl, compileSchemaEnvelope } from '../src/index.js';
import { sha256Hex } from '../src/sha256.js';
import type {
  DerivedSchema,
  MapField,
  SchemaEnvelope,
  SchemaParseIssue,
  StructureNode,
  VfslIssue,
  VfslModule,
} from '../src/index.js';

/** 求值接缝包裹（唯一 mock 面）：默认透传真实 evaluate，AC2-evaluate 用例注入一次性失败。 */
vi.mock('../src/evaluate.js', async (importOriginal) => {
  const mod = (await importOriginal()) as typeof import('../src/evaluate.js');
  return { ...mod, evaluate: vi.fn(mod.evaluate) };
});

const evaluateMock = vi.mocked(evaluate);

// ---------------------------------------------------------------------------
// fixtures（已用当前引擎逐条自检：全部 parse ok + evaluate ok，除 TEXT_BAD）
// ---------------------------------------------------------------------------

const TEXT_A = 'type ROOT = { a: string; };';
/** 独立文本（公共导出可用性对照）。 */
const TEXT_B = 'type ROOT = { b: number; };';
/** 仅内部空白差异变体（trivia）：语义与 TEXT_A 完全一致。 */
const TEXT_A_WS = 'type  ROOT = { a: string; };';
/** 仅普通注释差异变体（`//` 行注释）：trivia。 */
const TEXT_A_COMMENT_SLASH = 'type ROOT = { a: string; }; // trailing';
/** 仅普通注释差异变体（`/*` 块注释）：trivia。 */
const TEXT_A_COMMENT_BLOCK = 'type ROOT = { /* mid */ a: string; };';
/** 声明顺序差异：字段序 a,b vs b,a（语义等价、IR 不同）。 */
const TEXT_ORDER_1 = 'type ROOT = { a: string; b: number; };';
const TEXT_ORDER_2 = 'type ROOT = { b: number; a: string; };';
/** JSDoc 差异：字段级文档注释原文进入 IR（ADR-0001：JSDoc 保留）。 */
const TEXT_JSDOC_1 = 'type ROOT = { /** doc-a */ a: string; };';
const TEXT_JSDOC_2 = 'type ROOT = { /** doc-b */ a: string; };';
/** ref 按名引用不内联（ADR-0003 §4）：ROOT.a 为 ref A，A 为 map 形别名。 */
const TEXT_REF = 'type ROOT = { a: A; b: string; }; type A = { x: number; };';
/** 语法错误文本（parse 阶段原生失败）。 */
const TEXT_BAD = 'type ROOT = { a: ; };';
/** AC2-evaluate 专属文本（求值失败注入用，避免与其他用例的 mock 计数纠缠）。 */
const TEXT_EVAL_FAIL = 'type ROOT = { evalFail: string; };';

function envelopeOf(text: string, over: Partial<{ lang: string; version: number; id: string }> = {}): object {
  return { lang: 'vfsl', version: 1, id: 'compile-fixture', text, ...over };
}

// ---------------------------------------------------------------------------
// helpers（本地结构类型 + 收窄断言；不预锁 SA1 的结果联合成员形态——H3）
// ---------------------------------------------------------------------------

interface CompileOkShape {
  ok: true;
  envelope: SchemaEnvelope;
  module: VfslModule;
  derived: DerivedSchema;
  envelopeFingerprint: string;
  semanticFingerprint: string;
}
interface CompileFailShape {
  ok: false;
  issues: SchemaParseIssue[];
}
type CompileResult = CompileOkShape | CompileFailShape;

/**
 * 经公共入口调用被测接缝（当前导出尚不存在 → import 为 error 类型，构造性红灯；
 * SA3 实现后签名一致）。同步/async 不预锁：thenable 统一 await。
 */
async function compile(input: unknown): Promise<CompileResult> {
  return (await compileSchemaEnvelope(input)) as unknown as CompileResult;
}

/** 断言 ok 并返回收窄结果。 */
function expectOk(r: CompileResult): CompileOkShape {
  expect(r.ok).toBe(true);
  if (!r.ok) {
    throw new Error(`fixture 应为 ok:true: ${JSON.stringify(r.issues)}`);
  }
  return r;
}

/** 断言 envelope 域单条 issue 并返回之（AC2：envelope/dialect/internal 返回单 issue）。 */
function expectSingleEnvelopeIssue(r: CompileResult): Extract<SchemaParseIssue, { kind: 'envelope' }>['issue'] {
  expect(r.ok).toBe(false);
  if (r.ok) {
    throw new Error('fixture 应为 ok:false');
  }
  expect(r.issues).toHaveLength(1); // 单 issue 契约（AC2）
  const first = r.issues[0] as SchemaParseIssue;
  expect(first.kind).toBe('envelope');
  if (first.kind !== 'envelope') {
    throw new Error('envelope 域失败应为 kind:envelope');
  }
  return first.issue;
}

/** 断言文本合法并返回 module（fixture 自检 + 编译产物对照基准）。 */
function parseVfslOk(text: string): VfslModule {
  const r = parseVfsl(text);
  expect(r.ok).toBe(true);
  if (!r.ok) {
    throw new Error(`fixture 自检失败（parseVfsl）: ${JSON.stringify(r.issues)}`);
  }
  return r.module;
}

/** 新鲜直编（不经 compileSchemaEnvelope）：编译产物正确性对照基准。 */
function freshDerived(text: string): DerivedSchema {
  const p = parseVfsl(text);
  expect(p.ok).toBe(true);
  if (!p.ok) {
    throw new Error(`fixture 自检失败（parseVfsl）: ${JSON.stringify(p.issues)}`);
  }
  const e = evaluate(p.module);
  expect(e.ok).toBe(true);
  if (!e.ok) {
    throw new Error(`fixture 自检失败（evaluate）: ${JSON.stringify(e.issues)}`);
  }
  return e.derived;
}

/** 解 kind:'vfsl' 包装并断言全为 vfsl 域（parse/evaluate 原生数组保留断言助手）。 */
function unwrapVfslIssues(issues: SchemaParseIssue[]): VfslIssue[] {
  const out: VfslIssue[] = [];
  for (const item of issues) {
    expect(item.kind).toBe('vfsl');
    if (item.kind === 'vfsl') {
      out.push(item.issue);
    }
  }
  return out;
}

/** 递归深冻结遍历断言（WeakSet 防环——共享引用图下必须可重入）。 */
function expectDeepFrozen(value: unknown, seen: Set<object> = new Set<object>()): void {
  if (value === null || typeof value !== 'object') {
    return;
  }
  const obj = value as object;
  if (seen.has(obj)) {
    return;
  }
  seen.add(obj);
  expect(Object.isFrozen(obj)).toBe(true);
  for (const child of Object.values(obj)) {
    expectDeepFrozen(child, seen);
  }
}

/** 双指纹统一格式：`sha256:v1:` + 64 位小写 hex（SHA-256 摘要长度）。 */
const FINGERPRINT_FORMAT = /^sha256:v1:[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------
// AC1 信封严格封闭（恰含 lang/version/id/text）：缺失、多余、类型错误在 envelope
// 阶段 fail-fast；AC2 的 envelope 单 issue 契约并入各用例
// ---------------------------------------------------------------------------

describe('compileSchemaEnvelope — AC1 信封严格封闭（恰四键）envelope 阶段 fail-fast', () => {
  it('缺失任一四键 → ok:false，单条 envelope issue（ENV-2）', async () => {
    const full: Record<string, unknown> = { lang: 'vfsl', version: 1, id: 'x', text: TEXT_A };
    for (const key of ['lang', 'version', 'id', 'text']) {
      const input = { ...full };
      delete input[key];
      const issue = expectSingleEnvelopeIssue(await compile(input));
      expect(issue.code).toBe('2'); // ENV-2 必需键缺失
      expect(issue.readOnly).toBe(false); // 形状域错误非只读
      expect(issue.message).toMatch(/^VFSL-ENV-E2: /);
    }
  });

  it('四键类型错误（各键逐一）→ ok:false，单条 envelope issue（ENV-3）', async () => {
    const cases: object[] = [
      { lang: 42, version: 1, id: 'x', text: TEXT_A },
      { lang: 'vfsl', version: '1', id: 'x', text: TEXT_A },
      { lang: 'vfsl', version: 1, id: null, text: TEXT_A },
      { lang: 'vfsl', version: 1, id: 'x', text: { not: 'string' } },
    ];
    for (const input of cases) {
      const issue = expectSingleEnvelopeIssue(await compile(input));
      expect(issue.code).toBe('3'); // ENV-3 键类型错误
      expect(issue.readOnly).toBe(false);
      expect(issue.message).toMatch(/^VFSL-ENV-E3: /);
    }
  });

  it('多余键（严格封闭：恰含四键）→ ok:false 单条 envelope issue——严于 H1 的多余键容忍', async () => {
    const input = { lang: 'vfsl', version: 1, id: 'x', text: TEXT_A, extra: true };
    const issue = expectSingleEnvelopeIssue(await compile(input));
    expect(issue.readOnly).toBe(false); // 形状域错误：非 dialect 的 ENV-4
    expect(issue.code).not.toBe('4');
    // 对照：H1 parseSchemaEnvelope 对多余键是容忍的（重建恰四键回显，不夹带）——
    // 本票「恰含四键 / 严格封闭」在信封校验纪律上严于 H1（AC1 的增量契约锚）
    const h1 = parseSchemaEnvelope(input);
    expect(h1.ok).toBe(true);
  });

  it('非对象输入（null/undefined/原始值/数组/函数）→ ok:false，单条 envelope issue（ENV-1）', async () => {
    const cases: unknown[] = [null, undefined, 42, 'text', [], () => {}];
    for (const input of cases) {
      const issue = expectSingleEnvelopeIssue(await compile(input));
      expect(issue.code).toBe('1'); // ENV-1 非对象输入门
      expect(issue.readOnly).toBe(false);
      expect(issue.message).toMatch(/^VFSL-ENV-E1: /);
    }
  });

  it('AC2 envelope 单 issue 契约：缺失与类型错误并存也只回一条（严于 H1 的同类聚合）', async () => {
    const input = { version: '1', id: 'x', text: TEXT_A }; // 缺 lang + version 类型错误
    const issue = expectSingleEnvelopeIssue(await compile(input));
    expect(issue.readOnly).toBe(false);
    // 对照：H1 对同输入聚合两条（ENV-2 + ENV-3）——compile 的 envelope 恒单 issue
    // 是 AC2 明文契约（envelope/dialect/internal 返回单 issue）
    const h1 = parseSchemaEnvelope(input);
    expect(h1.ok).toBe(false);
    if (!h1.ok) {
      expect(h1.issues.length).toBeGreaterThan(1);
    }
  });

  it('fail-fast 顺序：形状错误先于方言裁决、方言先于文本解释（envelope → dialect → parse）', async () => {
    // 形状错（version 类型错）+ 方言错（lang=wml）+ 语法错并存 → envelope 形状错误先赢
    const mixedShape = { lang: 'wml', version: '1', id: 'x', text: TEXT_BAD };
    const shapeIssue = expectSingleEnvelopeIssue(await compile(mixedShape));
    expect(shapeIssue.code).toBe('3');
    // 方言错 + 语法错并存 → dialect 先赢（未知方言只读 loud-fail，不解释 text）
    const mixedDialect = { lang: 'wml', version: 1, id: 'x', text: TEXT_BAD };
    const dialectIssue = expectSingleEnvelopeIssue(await compile(mixedDialect));
    expect(dialectIssue.code).toBe('4');
    expect(dialectIssue.readOnly).toBe(true);
    expect(dialectIssue.message).toMatch(/^VFSL-ENV-E4: 未知方言/);
  });
});

// ---------------------------------------------------------------------------
// AC2 五阶段结果联合：dialect/parse/evaluate/internal
// ---------------------------------------------------------------------------

describe('compileSchemaEnvelope — AC2 分阶段结果联合（单 issue vs 原生 issues 数组）', () => {
  it('dialect 阶段：未知方言（lang≠vfsl / version≠1）→ 单条 ENV-4（readOnly loud-fail）', async () => {
    const cases: object[] = [
      { lang: 'wml', version: 1, id: 'x', text: TEXT_A },
      { lang: 'vfsl', version: 2, id: 'x', text: TEXT_A },
    ];
    for (const input of cases) {
      const issue = expectSingleEnvelopeIssue(await compile(input));
      expect(issue.code).toBe('4');
      expect(issue.readOnly).toBe(true);
      expect(issue.message).toMatch(/^VFSL-ENV-E4: 未知方言/);
    }
  });

  it('parse 阶段：语法错误 → 原生 VfslIssue 数组零损保留（与 parseVfsl 同输入 issues 深相等）', async () => {
    const native = parseVfsl(TEXT_BAD);
    expect(native.ok).toBe(false);
    if (native.ok) {
      throw new Error('fixture 自检失败：TEXT_BAD 应 parse 失败');
    }
    const r = await compile(envelopeOf(TEXT_BAD));
    expect(r.ok).toBe(false);
    if (r.ok) {
      throw new Error('TEXT_BAD 应编译失败');
    }
    // 原生数组保留：内容与条数与 parseVfsl 输出完全一致（kind:'vfsl' 包装层解掉）
    const unwrapped = unwrapVfslIssues(r.issues);
    expect(unwrapped).toEqual(native.issues);
    // 原生 VfslIssue 形状（line/column，而非 envelope 的 code/readOnly）
    for (const issue of unwrapped) {
      expect(issue.message).toMatch(/^VFSL-E\d+:/);
      expect(typeof issue.line).toBe('number');
      expect(typeof issue.column).toBe('number');
    }
  });

  it('evaluate 阶段：求值失败 → 原生 issues 数组保留（mock 注入一次性失败，经返回值通道）', async () => {
    const injected = [
      { message: 'VFSL-E100: 求值期失败模式（测试注入）: 展开资源预算', line: 1, column: 1 },
    ];
    evaluateMock.mockClear();
    evaluateMock.mockImplementationOnce(() => ({ ok: false as const, issues: injected }));
    const r = await compile(envelopeOf(TEXT_EVAL_FAIL));
    // 收尾卫生（getcompiled R2 教训）：若编译路径未消费该一次性武装，drain 显式消费，
    // 防泄漏进后续用例（drain 结果弃置；若已消费，此调用透传真实求值，无害）
    evaluateMock({ kind: 'vfsl-module', aliases: [] });
    evaluateMock.mockClear();
    // 失败经返回值通道：不抛错、非 ok:true
    expect(r.ok).toBe(false);
    if (r.ok) {
      throw new Error('注入求值失败应编译失败');
    }
    // 原生数组保留：注入的 VfslIssue 逐条原样（未被吞掉/改写/重包装）
    expect(unwrapVfslIssues(r.issues)).toEqual(injected);
  });

  it('internal 阶段：对抗 getter/Proxy 输入 → 绝不外抛，单条内部 issue（ENV-100）', async () => {
    const target = { lang: 'vfsl', version: 1, id: 'x', text: TEXT_A };
    const adversarial = new Proxy(target, {
      get() {
        throw new Error('adversarial getter');
      },
    });
    // 若实现违反「绝不外抛」，await 会以 rejection 失败本用例（正是锚点）；
    // 对抗 getter 在信封键读取时抛出 → 顶层崩溃边界收编为单条 internal issue
    const r = await compile(adversarial);
    const issue = expectSingleEnvelopeIssue(r);
    expect(issue.code).toBe('100'); // ENV-100 崩溃边界
    expect(issue.message).toMatch(/^VFSL-ENV-E100: /);
  });
});

// ---------------------------------------------------------------------------
// AC3 双指纹：SHA-256 + UTF-8 + canonical JSON + `sha256:v1:<hex>` 格式
// ---------------------------------------------------------------------------

describe('compileSchemaEnvelope — AC3 指纹算法与格式', () => {
  it('sha256Hex 参考实现锚定真实 SHA-256（FIPS 180-4 标准 KAT 向量，防循环论证）', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('成功产物双指纹均匹配 `sha256:v1:<hex>` 格式（64 位小写 hex = SHA-256 摘要长度）', async () => {
    const r = expectOk(await compile(envelopeOf(TEXT_A)));
    expect(r.envelopeFingerprint).toMatch(FINGERPRINT_FORMAT);
    expect(r.semanticFingerprint).toMatch(FINGERPRINT_FORMAT);
  });

  it('envelope 指纹 = `sha256:v1:` + SHA-256(四键 canonical JSON)（§7 冻结表序紧凑序列化，覆盖四键）', async () => {
    // H1：canonical JSON = 四键按 v1-spec §7 冻结表序（lang, version, id, text）紧凑
    // 序列化（JSON.stringify 语义）。精确摘要断言同时锚定 lang/version 两键参与
    // 覆盖——方言门禁只放行 vfsl@1，lang/version 无法经成功路径变体验证。
    const canonical = JSON.stringify({ lang: 'vfsl', version: 1, id: 'compile-fixture', text: TEXT_A });
    const expected = `sha256:v1:${sha256Hex(canonical)}`;
    const r = expectOk(await compile(envelopeOf(TEXT_A)));
    expect(r.envelopeFingerprint).toBe(expected);
  });

  it('确定性 + canonical 归一化：键序打乱的同内容输入 → 同一 envelope 指纹；重复编译双指纹稳定', async () => {
    const base = expectOk(await compile(envelopeOf(TEXT_A)));
    // 输入键序打乱（text 在前）：canonical 归一化后指纹不变
    const shuffled = { text: TEXT_A, id: 'compile-fixture', version: 1, lang: 'vfsl' };
    const r2 = expectOk(await compile(shuffled));
    expect(r2.envelopeFingerprint).toBe(base.envelopeFingerprint);
    expect(r2.semanticFingerprint).toBe(base.semanticFingerprint);
    // 重复编译（全新输入对象）→ 双指纹稳定
    const r3 = expectOk(await compile(envelopeOf(TEXT_A)));
    expect(r3.envelopeFingerprint).toBe(base.envelopeFingerprint);
    expect(r3.semanticFingerprint).toBe(base.semanticFingerprint);
  });

  it('域分离（冲突门禁 N2）：同输入下 envelope 指纹与 semantic 指纹互异，两域不同源', async () => {
    const r = expectOk(await compile(envelopeOf(TEXT_A)));
    expect(r.envelopeFingerprint).not.toBe(r.semanticFingerprint);
  });
});

// ---------------------------------------------------------------------------
// AC4 指纹覆盖与敏感性：envelope 覆盖四键；semantic 忽略空白/普通注释、
// 保留 JSDoc/声明顺序、排除 id
// ---------------------------------------------------------------------------

describe('compileSchemaEnvelope — AC4 指纹敏感性', () => {
  it('semantic 排除 id；envelope 覆盖 id：仅 id 不同 → envelope 指纹变、semantic 指纹不变', async () => {
    const a = expectOk(await compile(envelopeOf(TEXT_A, { id: 'id-A' })));
    const b = expectOk(await compile(envelopeOf(TEXT_A, { id: 'id-B' })));
    expect(a.envelopeFingerprint).not.toBe(b.envelopeFingerprint); // id 是四键之一
    expect(a.semanticFingerprint).toBe(b.semanticFingerprint); // id 是谱系标签非语义键（ADR-0005）
  });

  it('semantic 忽略空白与普通注释；envelope 覆盖 text：仅文本 trivia 差异 → envelope 变、semantic 不变', async () => {
    const base = expectOk(await compile(envelopeOf(TEXT_A)));
    for (const variant of [TEXT_A_WS, TEXT_A_COMMENT_SLASH, TEXT_A_COMMENT_BLOCK]) {
      const v = expectOk(await compile(envelopeOf(variant)));
      expect(v.envelopeFingerprint).not.toBe(base.envelopeFingerprint); // text 键内容不同
      expect(v.semanticFingerprint).toBe(base.semanticFingerprint); // 规范 IR 相同
    }
  });

  it('semantic 保留 JSDoc：仅文档注释差异 → semantic 指纹不同（ADR-0001：JSDoc 必须影响语义指纹）', async () => {
    const bare = expectOk(await compile(envelopeOf(TEXT_A)));
    const docA = expectOk(await compile(envelopeOf(TEXT_JSDOC_1)));
    const docB = expectOk(await compile(envelopeOf(TEXT_JSDOC_2)));
    expect(docA.semanticFingerprint).not.toBe(bare.semanticFingerprint); // 无 doc vs 有 doc
    expect(docB.semanticFingerprint).not.toBe(bare.semanticFingerprint);
    expect(docA.semanticFingerprint).not.toBe(docB.semanticFingerprint); // doc 原文不同
    // 对照基准：IR 确实不同（docs 原文进入 IR）
    expect(parseVfslOk(TEXT_JSDOC_1)).not.toEqual(parseVfslOk(TEXT_A));
  });

  it('semantic 保留声明顺序：字段序 a,b vs b,a → semantic 指纹不同（其余语义等价）', async () => {
    const o1 = expectOk(await compile(envelopeOf(TEXT_ORDER_1)));
    const o2 = expectOk(await compile(envelopeOf(TEXT_ORDER_2)));
    expect(o1.semanticFingerprint).not.toBe(o2.semanticFingerprint);
    // 对照基准：派生物确实因顺序不同而不同（IR 字段序保留）
    expect(freshDerived(TEXT_ORDER_1)).not.toEqual(freshDerived(TEXT_ORDER_2));
  });
});

// ---------------------------------------------------------------------------
// AC5 envelope/module/derived 递归深冻结；共享引用关系不被复制破坏
// ---------------------------------------------------------------------------

describe('compileSchemaEnvelope — AC5 递归深冻结与共享引用', () => {
  it('envelope/module/derived 及其全部嵌套对象递归深冻结（isFrozen 全遍历）', async () => {
    const r = expectOk(await compile(envelopeOf(TEXT_REF)));
    expect(Object.isFrozen(r.envelope)).toBe(true);
    expectDeepFrozen(r.envelope);
    expectDeepFrozen(r.module);
    expectDeepFrozen(r.derived);
  });

  it('深冻结不改写共享引用：index 条目 node 与结构树节点仍为同一对象（复制式冻结会破坏）', async () => {
    const r = expectOk(await compile(envelopeOf(TEXT_REF)));
    const d = r.derived;
    // 求值器既有共享引用（evaluate.ts：index['ROOT'] 条目与 structure 为同一 rootNode；
    // 字段条目 node 与树内字段节点同一对象）——深冻结必须原地冻结、不得复制
    const rootEntry = d.index['ROOT'];
    expect(rootEntry).toBeDefined();
    if (rootEntry) {
      expect(rootEntry.node).toBe(d.structure);
    }
    const rootMap = (d.structure as { kind: 'root'; node: StructureNode }).node as {
      kind: 'map';
      fields: MapField[];
    };
    const bField = rootMap.fields.find((f) => f.name === 'b');
    const bEntry = d.index['ROOT.b'];
    expect(bField).toBeDefined();
    expect(bEntry).toBeDefined();
    if (bField && bEntry) {
      expect(bEntry.node).toBe(bField.node);
    }
  });

  it('ref 按名引用不内联（ADR-0003 §4）：结构树与 IR 中 ROOT.a 均为 {kind:ref, name:A}', async () => {
    const r = expectOk(await compile(envelopeOf(TEXT_REF)));
    const d = r.derived;
    const rootMap = (d.structure as { kind: 'root'; node: StructureNode }).node as {
      kind: 'map';
      fields: MapField[];
    };
    const aField = rootMap.fields.find((f) => f.name === 'a');
    expect(aField).toBeDefined();
    if (aField) {
      expect(aField.node).toEqual({ kind: 'ref', name: 'A' }); // 不内联展开为 A 的 map 拷贝
      const aEntry = d.index['ROOT.a'];
      expect(aEntry).toBeDefined();
      if (aEntry) {
        expect(aEntry.node).toEqual({ kind: 'ref', name: 'A' });
      }
    }
    // IR 同构：ROOT 的字段 a 类型为 ref（不内联）
    const ro = r.module.aliases.find((a) => a.name === 'ROOT');
    expect(ro?.type.kind).toBe('object');
    if (ro?.type.kind === 'object') {
      const fa = ro.type.fields.find((f) => f.name === 'a');
      expect(fa?.type).toEqual({ kind: 'ref', name: 'A' });
    }
  });

  it('冻结是行为事实：对冻结产物赋值/变更在严格模式下抛 TypeError（loud，非静默）', async () => {
    const r = expectOk(await compile(envelopeOf(TEXT_REF)));
    expect(() => {
      (r.envelope as unknown as { text: string }).text = 'hacked';
    }).toThrow(TypeError);
    expect(() => {
      (r.module as unknown as { aliases: unknown }).aliases = [];
    }).toThrow(TypeError);
    expect(() => {
      (r.derived as unknown as { structure: unknown }).structure = null;
    }).toThrow(TypeError);
    expect(() => {
      ((r.derived.structure as unknown as { node: { fields: unknown[] } }).node).fields = [];
    }).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// AC6 无模块级 cache / Host 生命周期状态（纯函数）：重复调用产出新对象引用，
// 值确定；无调用顺序依赖；零新运行时依赖
// ---------------------------------------------------------------------------

describe('compileSchemaEnvelope — AC6 无缓存、纯函数、零新依赖', () => {
  it('同文本两次编译 → 产物引用互异（无缓存：不返回共享对象），值完全一致（确定性）', async () => {
    const r1 = expectOk(await compile(envelopeOf(TEXT_A)));
    const r2 = expectOk(await compile(envelopeOf(TEXT_A)));
    expect(r1.envelope).not.toBe(r2.envelope);
    expect(r1.module).not.toBe(r2.module);
    expect(r1.derived).not.toBe(r2.derived);
    expect(r1.envelope).toEqual(r2.envelope);
    expect(r1.module).toEqual(r2.module);
    expect(r1.derived).toEqual(r2.derived);
    expect(r1.envelopeFingerprint).toBe(r2.envelopeFingerprint);
    expect(r1.semanticFingerprint).toBe(r2.semanticFingerprint);
  });

  it('无调用顺序依赖（无 Host 生命周期状态）：失败编译不改变后续编译的可观察结果', async () => {
    const first = expectOk(await compile(envelopeOf(TEXT_A)));
    const failed = await compile(envelopeOf(TEXT_BAD));
    expect(failed.ok).toBe(false);
    const again = expectOk(await compile(envelopeOf(TEXT_A)));
    expect(again.envelopeFingerprint).toBe(first.envelopeFingerprint);
    expect(again.semanticFingerprint).toBe(first.semanticFingerprint);
    expect(again.module).toEqual(first.module);
    expect(again.derived).toEqual(first.derived);
  });

  it('packages/vfsl/package.json 无运行时 dependencies（清单契约：编译入口零新运行时依赖）', () => {
    const pkg = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    expect(pkg.dependencies ?? {}).toEqual({});
  });

  it('compileSchemaEnvelope 是包公共导出函数（引擎公共面），可经公共入口直接调用', async () => {
    expect(typeof compileSchemaEnvelope).toBe('function');
    const ok = expectOk(await compile(envelopeOf(TEXT_B)));
    expect(ok.derived).toEqual(freshDerived(TEXT_B));
  });
});

// ---------------------------------------------------------------------------
// 幸福路径：成功产物五件套与既有公共接缝（parseVfsl / evaluate）产物一致
// ---------------------------------------------------------------------------

describe('compileSchemaEnvelope — 幸福路径', () => {
  it('ok:true 返回冻结的 envelope/module/derived + 双指纹，且与 parseVfsl+evaluate 直编一致', async () => {
    const r = expectOk(await compile(envelopeOf(TEXT_A)));
    expect(r.envelope).toEqual({ lang: 'vfsl', version: 1, id: 'compile-fixture', text: TEXT_A });
    expect(r.module).toEqual(parseVfslOk(TEXT_A));
    expect(r.derived).toEqual(freshDerived(TEXT_A));
    expect(r.envelopeFingerprint).toMatch(FINGERPRINT_FORMAT);
    expect(r.semanticFingerprint).toMatch(FINGERPRINT_FORMAT);
  });
});
