/**
 * SA6 红灯测试 — DocScope getCompiled 作用域绑定与编译缓存（issue #54 / H3，功能开发）。
 *
 * 契约来源：
 * - 任务简报 wiki/raw/task_docscope-compile-cache.md（Issue #54）：公共入口
 *   `getCompiled(input)`（信封或文本）→ `{ module, derived }`；按**文本内容哈希**
 *   （sha-256）缓存；同一文本一次 `parseVfsl + evaluate`、处处取用同一对象引用；
 *   不同文本完全隔离；未知方言经 H1 断言通道拒绝、不进入缓存；evaluate 失败不污染
 *   缓存（可重试语义）；纯引擎、零新运行时依赖、同步或 async 由 SA1 依 H1 接缝形态定；
 * - docs/adr/0001（编译缓存条款：按内容哈希的性能依赖）、ADR-0003 §1（evaluate
 *   可失败结果联合——缓存只存 ok 分支）、ADR-0005 §1（id 是标签不是键——缓存键
 *   是文本内容哈希而非 id；消费方首动作 = 方言断言）；
 * - 冲突门禁报告 wiki/raw/task_docscope-compile-cache_conflict_report.md：
 *   getCompiled 是组合既有公共接缝（parseSchemaEnvelope / parseVfsl / evaluate）的
 *   缓存门面，不得取代或收窄它们；缓存键保持文本内容哈希、不引入 id 键控。
 *
 * 验收锚点（AC1–AC6 逐条对应）：
 * - AC1 同文本两次调用返回同一对象引用（缓存命中可证）：module/derived/返回容器
 *   三者引用同一；命中不再触发 evaluate（spy 计数为证——比引用同一更强的「可证」）；
 *   信封与文本两种输入形式、不同 id 均命中同一缓存项（键 = 文本内容，非 id/载体）；
 * - AC2 仅空白差异的文本 = 不同键：深相等（语义一致）但引用互异（内容哈希纪律：
 *   正确重算，不去重）；前缀共享文本同样不同键（全文哈希，非前缀/规范化去重）；
 * - AC3 多文本并存互不影响（隔离性）：交错调用下各文本内部引用稳定、跨文本互异、
 *   派生物各自对应自身文本；
 * - AC4 未知方言输入经 H1 通道拒绝、不产生缓存项：拒绝 issues 与 parseSchemaEnvelope
 *   同输入全等（H1 断言通道零损透传）；拒绝路径 evaluate 从未被调用；拒绝后同文本
 *   合法信封仍正常编译（拒绝未污染/未占用缓存键）；
 * - AC5 evaluate 失败（合法文本但求值失败）不污染缓存：失败经返回值通道（不抛错、
 *   非 ok:true）；同文本重试（evaluate 恢复正常）→ 重新求值成功，第三次命中同一
 *   引用——缓存只存 ok 分支、可重试语义；
 * - AC6 纯引擎、零新运行时依赖：packages/vfsl/package.json 无运行时 `dependencies`
 *   （清单契约，非源码文本断言）；getCompiled 为包公共导出。
 *
 * 同步/async 形态：简报 AC6 将裁定权交给 SA1（依 H1 接缝形态——parseSchemaEnvelope
 * 为同步接缝，倾向同步）。本文件不预锁形态：compiledOf() 对 thenable 统一 await，
 * 全部断言锚定 await 后的可观察结果（对象引用同一性在 await 下保持），SA1 任取一形
 * 均成立；SA3 必须保持「ok 返回 { module, derived }、失败返回 { ok:false, issues }」
 * 的可观察契约。
 *
 * evaluate 失败注入（AC5 / AC1 命中证明）：vi.mock('../src/evaluate.js') 以
 * vi.fn(原实现) 包裹被冻结的公共求值接缝（ADR-0003 §1）——默认透传真实实现，仅
 * AC5 与 AC1 命中用例以 mockImplementationOnce 注入一次性失败。这是对「未来求值期
 * 失败模式（ADR-0003：展开资源预算）」的唯一行为级模拟（当前引擎对 parseVfsl 合法
 * 文本恒求值成功），且 mock 挂在模块图上：getCompiled 无论从哪个文件组合 evaluate
 * 都必经该接缝。断言只锚定可观察行为与 spy 计数，不触碰源码文本。
 *
 * 本文件状态演进：
 * - Phase 1（验收锚定）：`getCompiled` 尚不存在 → 静态 import 失败，全部用例红
 *   （构造性红灯，同 parse-schema-envelope.test.ts / schemasource-seam.test.ts 先例）；
 * - 2026-08-21 R1 修订（依 SA1 设计 wiki/raw/task_docscope-compile-cache_design.md §11
 *   最小修正案，总控核实）：三处 fixture 级修正，AC 覆盖语义不变——AC4.1 case-3
 *   `lang` 由 'vfsl' 改 'wml'（原 case 是「已知方言 + 语法错误文本」，与自身 H1 对照
 *   基准矛盾：任何实现无法同时满足 kind:'envelope'/ENV-4 与 toEqual(h1.issues)）；
 *   AC1.2 改用专属 TEXT_HIT、AC5 改用专属 TEXT_RETRY（模块级缓存跨 it 存续，共享
 *   TEXT_A 会被前序用例缓存成热条目，命中计数断言与失败注入不可达）；
 * - 2026-08-21 R2 修订（验收测试 fixture 修订轮，总控亲验 + SA3 上报：11/13 绿，
 *   剩余 2 红为该文件自身 mock 卫生缺陷，任何正确实现下均红——AC1.3 单独跑绿、
 *   全文件跑红 = 顺序依赖）：两处 fixture 级最小修正，AC 覆盖语义不变——
 *   D1：AC1.2 一次性失败武装在收尾处显式消费并复位（缓存命中路径不调用 evaluate，
 *   武装从不被消费而泄漏进 AC1.3 的 freshDerived 直调 → expect(e.ok).toBe(true) 红）；
 *   D2：AC5「重试重算」计数断言移至 freshDerived 对照直调之前（freshDerived 直调
 *   evaluate 计 1 次，原位置恒 3≠2 红），末段「命中不再触发 evaluate」计数相应调为 3
 *   并注释 freshDerived 的一次直调；
 * - Phase 2（SA3 实现后）：用例转绿，作为 #54 的验收锚。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { evaluate, getCompiled, parseSchemaEnvelope, parseVfsl } from '../src/index.js';

/** 求值接缝包裹（唯一 mock 面）：默认透传真实 evaluate，测试注入一次性失败。 */
vi.mock('../src/evaluate.js', async (importOriginal) => {
  const mod = (await importOriginal()) as typeof import('../src/evaluate.js');
  return { ...mod, evaluate: vi.fn(mod.evaluate) };
});

/** PRD #3 / ADR 0003 冻结的文本错误形状（evaluate 失败通道同款）。 */
interface VfslIssue {
  message: string;
  line: number;
  column: number;
}

/** H1 信封层 issue（未知方言拒绝的身份锚：code '4' / readOnly）。 */
interface SchemaEnvelopeIssue {
  code: string;
  message: string;
  readOnly: boolean;
}

type SchemaParseIssue =
  | { kind: 'envelope'; issue: SchemaEnvelopeIssue }
  | { kind: 'vfsl'; issue: VfslIssue };

/** getCompiled 可观察结果形状（不预锁失败 issue 的具体包装——各通道断言各自收窄）。 */
interface CompiledOk {
  ok: true;
  module: { kind: 'vfsl-module'; aliases: unknown[] };
  derived: unknown;
}
type CompiledResult = CompiledOk | { ok: false; issues: unknown[] };

// ---------------------------------------------------------------------------
// fixtures（已用当前引擎逐条自检：全部 parse ok、evaluate ok）
// ---------------------------------------------------------------------------

/** 合法文本 A：map 形 ROOT（E310/E311 必要条件）。 */
const TEXT_A = 'type ROOT = { a: string; };';
/** 仅空白差异变体（内部空白 / 尾随换行）：语义等价、内容不同。 */
const TEXT_A_WS = 'type  ROOT = { a: string; };';
const TEXT_A_WS2 = 'type ROOT = { a: string; };\n';
/** 前缀共享变体（TEXT_A 是它的真前缀）：全文哈希纪律的边界。 */
const TEXT_A_SUFFIX = 'type ROOT = { a: string; }; // trailing comment';
/** 合法文本 B：与 A 结构同形、字段不同（隔离性对照）。 */
const TEXT_B = 'type ROOT = { b: number; };';
/** 语法错误文本（VFSL-E100 意外记号）。 */
const TEXT_BAD = 'type ROOT = { a: ; };';
/** AC1.2 专属文本（设计 §11.2）：缓存命中不重算用例须冷启动——模块级缓存跨 it
 *  存续，共享 TEXT_A 会被 AC1.1 缓存成热条目，命中计数断言与失败注入均不可达。 */
const TEXT_HIT = 'type ROOT = { hit: string; };';
/** AC5 专属文本（设计 §11.3）：可重试用例同因须冷启动，一次性求值失败注入才能
 *  到达 evaluate（TEXT_A 已热，调用直接命中 ok 条目，注入永远不触发）。 */
const TEXT_RETRY = 'type ROOT = { retry: number; };';

function envelopeOf(text: string, over: Partial<{ lang: string; version: number; id: string }> = {}): object {
  return { lang: 'vfsl', version: 1, id: 'docscope-fixture', text, ...over };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * 经公共入口调用被测接缝（当前导出尚不存在 → import 为 error 类型；SA3 实现后
 * 签名一致）。同步/async 不预锁：thenable 统一 await，非 thenable 原样返回——
 * await 保持对象引用同一性，AC1 的引用断言在两种形态下均成立。
 */
async function compiledOf(input: unknown): Promise<CompiledResult> {
  const r = getCompiled(input) as unknown;
  if (
    r !== null &&
    typeof r === 'object' &&
    typeof (r as { then?: unknown }).then === 'function'
  ) {
    return (await r) as CompiledResult;
  }
  return r as CompiledResult;
}

/** 断言拒绝并返回 issues（ok:false + 非空 issues）。 */
function expectRejected(r: CompiledResult): { issues: unknown[] } {
  expect(r.ok).toBe(false);
  const issues = (r as { ok: false; issues: unknown[] }).issues;
  expect(Array.isArray(issues)).toBe(true);
  expect(issues.length).toBeGreaterThan(0);
  return { issues };
}

/** 断言 ok 并返回收窄结果。 */
function expectOk(r: CompiledResult): CompiledOk {
  expect(r.ok).toBe(true);
  if (!r.ok) {
    throw new Error(`fixture 应为 ok:true: ${JSON.stringify(r.issues)}`);
  }
  return r;
}

/** 断言文本合法并返回 module（fixture 自检 + 缓存产物对照）。 */
function parseVfslOk(text: string): { kind: 'vfsl-module'; aliases: unknown[] } {
  const r = parseVfsl(text);
  expect(r.ok).toBe(true);
  if (!r.ok) {
    throw new Error(`fixture 自检失败（parseVfsl）: ${JSON.stringify(r.issues)}`);
  }
  return r.module;
}

/** 新鲜直编（不经缓存）：getCompiled 产物的正确性对照基准。 */
function freshDerived(text: string): unknown {
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

/** 派生物结构树首层字段名（隔离性断言：派生物确实对应自身文本）。 */
function rootFieldNames(derived: unknown): string[] {
  const node = (derived as {
    structure?: { node?: { fields?: Array<{ name?: string }> } };
  })?.structure?.node;
  if (node === undefined || !Array.isArray(node.fields)) {
    return [];
  }
  return node.fields.map((f) => f.name ?? '');
}

const evaluateMock = vi.mocked(evaluate);

// ---------------------------------------------------------------------------
// AC1 同文本两次调用返回同一对象引用（缓存命中可证）
// ---------------------------------------------------------------------------

describe('getCompiled — AC1 同文本同一对象引用（缓存命中可证）', () => {
  it('同文本两次调用（独立信封对象、不同 id）→ module/derived/容器同一对象引用，且派生正确', async () => {
    // 两次调用用不同的信封对象与不同 id：命中只可能由文本内容键控达成
    // （id 是标签不是键，ADR-0005 §1）。
    const r1 = expectOk(await compiledOf(envelopeOf(TEXT_A, { id: 'first-id' })));
    const r2 = expectOk(await compiledOf(envelopeOf(TEXT_A, { id: 'second-id' })));
    expect(r1).toBe(r2); // 返回容器同一引用
    expect(r1.module).toBe(r2.module); // module 同一引用
    expect(r1.derived).toBe(r2.derived); // derived 同一引用
    // 正确性：派生物与新鲜直编（parseVfsl + evaluate）深相等——缓存不是垃圾占位
    expect(r1.derived).toEqual(freshDerived(TEXT_A));
    expect(r1.module).toEqual(parseVfslOk(TEXT_A));
    // 纯数据纪律（ADR-0003）：派生物可 JSON 序列化往返
    expect(JSON.parse(JSON.stringify(r1.derived))).toEqual(r1.derived);
  });

  it('缓存命中不重算：注入 evaluate 失败后，同文本再次调用仍 ok、同引用，且 evaluate 未被再次调用', async () => {
    evaluateMock.mockClear();
    // 专属文本 TEXT_HIT 冷启动（设计 §11.2：共享 TEXT_A 会被 AC1.1 缓存成热条目，
    // 首个调用即成命中，计数 0≠1 与失败注入均不可达）
    const first = expectOk(await compiledOf(envelopeOf(TEXT_HIT)));
    expect(evaluateMock).toHaveBeenCalledTimes(1);
    // 武装一次性求值失败：若缓存命中路径重新求值，本次必返回失败——命中即证明
    evaluateMock.mockImplementationOnce(() => ({
      ok: false as const,
      issues: [{ message: 'VFSL-E100: 求值期失败模式（测试注入）: 展开资源预算', line: 1, column: 1 }],
    }));
    const hit = expectOk(await compiledOf(envelopeOf(TEXT_HIT)));
    expect(hit).toBe(first);
    expect(hit.module).toBe(first.module);
    expect(hit.derived).toBe(first.derived);
    // 命中不触发 evaluate（spy 计数不增）——引用同一之外的「缓存命中可证」
    expect(evaluateMock).toHaveBeenCalledTimes(1);
    // 收尾卫生（R2 D1 修正）：缓存命中路径不调用 evaluate，上述一次性失败武装
    // 从未被消费，会泄漏进后续用例——AC1.3 的 freshDerived 直调 evaluate 时误吞该
    // 武装返回 ok:false，其 expect(e.ok).toBe(true) 恒红（AC1.3 单独跑绿、全文件跑红
    // = 顺序依赖）。此处显式消费剩余武装（结果弃置，仅清队列）并清空调用史，
    // 消除跨用例状态泄漏。
    evaluateMock(); // 消费剩余的一次性失败武装（结果弃置）
    evaluateMock.mockClear();
  });

  it('信封形式与文本形式（同一文本）→ 同一缓存项（键 = 文本内容哈希，非信封载体）', async () => {
    const viaEnvelope = expectOk(await compiledOf(envelopeOf(TEXT_A)));
    const viaText = expectOk(await compiledOf(TEXT_A));
    expect(viaEnvelope).toBe(viaText);
    expect(viaEnvelope.module).toBe(viaText.module);
    expect(viaEnvelope.derived).toBe(viaText.derived);
    expect(viaText.derived).toEqual(freshDerived(TEXT_A));
  });
});

// ---------------------------------------------------------------------------
// AC2 仅空白差异的文本 = 不同键（内容哈希纪律：正确重算，不去重）
// ---------------------------------------------------------------------------

describe('getCompiled — AC2 仅空白差异 = 不同键（内容哈希纪律）', () => {
  it('空白差异变体（内部空白 / 尾随换行）→ 各自独立缓存项：语义深相等、引用全异', async () => {
    const base = expectOk(await compiledOf(envelopeOf(TEXT_A)));
    for (const variant of [TEXT_A_WS, TEXT_A_WS2]) {
      const v = expectOk(await compiledOf(envelopeOf(variant)));
      // 语义一致（空白是 trivia）……
      expect(v.derived).toEqual(freshDerived(variant));
      expect(v.derived).toEqual(base.derived);
      // ……但内容不同 → 键不同 → 独立缓存项（不去重，各自重算）
      expect(v).not.toBe(base);
      expect(v.module).not.toBe(base.module);
      expect(v.derived).not.toBe(base.derived);
      // 变体自身也稳定命中
      const v2 = expectOk(await compiledOf(envelopeOf(variant)));
      expect(v2).toBe(v);
    }
  });

  it('前缀共享文本（base 是变体的真前缀）→ 不同键（全文哈希，非前缀/规范化去重）', async () => {
    const base = expectOk(await compiledOf(envelopeOf(TEXT_A)));
    const suffixed = expectOk(await compiledOf(envelopeOf(TEXT_A_SUFFIX)));
    expect(suffixed.derived).toEqual(freshDerived(TEXT_A_SUFFIX));
    expect(suffixed).not.toBe(base);
    expect(suffixed.module).not.toBe(base.module);
    expect(suffixed.derived).not.toBe(base.derived);
  });
});

// ---------------------------------------------------------------------------
// AC3 多文本并存互不影响（隔离性）
// ---------------------------------------------------------------------------

describe('getCompiled — AC3 多文本并存互不影响（隔离性）', () => {
  it('交错调用 A、B、A、B → 各文本内部引用稳定、跨文本互异、派生物各自对应自身文本', async () => {
    const a1 = expectOk(await compiledOf(envelopeOf(TEXT_A)));
    const b1 = expectOk(await compiledOf(envelopeOf(TEXT_B)));
    const a2 = expectOk(await compiledOf(envelopeOf(TEXT_A)));
    const b2 = expectOk(await compiledOf(envelopeOf(TEXT_B)));
    // 内部稳定：混入其他文本后仍命中各自缓存项
    expect(a2).toBe(a1);
    expect(a2.module).toBe(a1.module);
    expect(a2.derived).toBe(a1.derived);
    expect(b2).toBe(b1);
    expect(b2.module).toBe(b1.module);
    expect(b2.derived).toBe(b1.derived);
    // 跨文本隔离：互不串引用
    expect(a1).not.toBe(b1);
    expect(a1.module).not.toBe(b1.module);
    expect(a1.derived).not.toBe(b1.derived);
    // 派生物各自对应自身文本（a 字段只在 A、b 字段只在 B）
    expect(rootFieldNames(a1.derived)).toEqual(['a']);
    expect(rootFieldNames(b1.derived)).toEqual(['b']);
    expect(a1.derived).toEqual(freshDerived(TEXT_A));
    expect(b1.derived).toEqual(freshDerived(TEXT_B));
  });
});

// ---------------------------------------------------------------------------
// AC4 未知方言经 H1 断言通道拒绝、不产生缓存项
// ---------------------------------------------------------------------------

describe('getCompiled — AC4 未知方言经 H1 通道拒绝、不产生缓存项', () => {
  it('未知方言（lang 非 vfsl / version 非 1）→ ok:false，issues 与 parseSchemaEnvelope 同输入全等', async () => {
    const cases: Array<{ lang: string; version: number; id: string; text: string }> = [
      { lang: 'wml', version: 1, id: 'x', text: TEXT_A },
      { lang: 'vfsl', version: 2, id: 'x', text: TEXT_A },
      // 设计 §11.1 修正：未知方言 + 语法错误文本并存 → 方言拒绝先赢（先于文本解释）。
      // （原 lang:'vfsl' 为已知方言，坏文本走 kind:'vfsl' 通道，与下方 ENV-4/kind:'envelope'
      //   断言逻辑合取不可满足——任何正确实现二选一必红）
      { lang: 'wml', version: 1, id: 'x', text: TEXT_BAD },
    ];
    for (const input of cases) {
      const r = await compiledOf(input);
      const { issues } = expectRejected(r);
      // H1 断言通道零损透传：与 parseSchemaEnvelope 对同一输入完全一致
      const h1 = parseSchemaEnvelope(input);
      expect(h1.ok).toBe(false);
      if (!h1.ok) {
        expect(issues).toEqual(h1.issues);
      }
      const first = issues[0] as SchemaParseIssue;
      expect(first.kind).toBe('envelope');
      if (first.kind === 'envelope') {
        expect(first.issue.code).toBe('4'); // ENV-4 未知方言
        expect(first.issue.readOnly).toBe(true);
        expect(first.issue.message).toMatch(/^VFSL-ENV-E4: 未知方言/);
      }
    }
  });

  it('拒绝不产生缓存项：同文本合法信封随后正常编译（拒绝未污染/未占用缓存键）', async () => {
    evaluateMock.mockClear();
    const rejected = await compiledOf(envelopeOf(TEXT_A, { lang: 'wml' }));
    expectRejected(rejected);
    // 拒绝路径不触发求值（方言断言先于解析/求值——只读 loud-fail 不解释 text）
    expect(evaluateMock).toHaveBeenCalledTimes(0);
    // 同文本（但合法方言）→ 正常编译成功，且派生物正确
    const ok1 = expectOk(await compiledOf(envelopeOf(TEXT_A)));
    expect(ok1.derived).toEqual(freshDerived(TEXT_A));
    // 该合法条目可再命中（此前拒绝未留下任何按文本键控的痕迹）
    const ok2 = expectOk(await compiledOf(envelopeOf(TEXT_A)));
    expect(ok2).toBe(ok1);
    // 重复拒绝幂等
    const rejectedAgain = await compiledOf(envelopeOf(TEXT_A, { lang: 'wml' }));
    expectRejected(rejectedAgain);
  });
});

// ---------------------------------------------------------------------------
// AC5 evaluate 失败（合法文本但求值失败）不污染缓存（可重试语义）
// ---------------------------------------------------------------------------

describe('getCompiled — AC5 evaluate 失败不污染缓存（可重试语义）', () => {
  it('evaluate 失败 → 失败经返回值通道（不抛错、非 ok:true）；同文本重试 → 重新求值成功并可命中', async () => {
    evaluateMock.mockClear();
    // 专属文本 TEXT_RETRY 冷启动（设计 §11.3：共享 TEXT_A 已被前序用例缓存成热条目，
    // 注入失败后调用直接命中 ok 条目，expectRejected 恒红；重算计数同样落空）
    // 注入一次性求值失败（合法文本，仅求值期失败——ADR-0003 前向兼容失败模式）
    evaluateMock.mockImplementationOnce(() => ({
      ok: false as const,
      issues: [{ message: 'VFSL-E100: 求值期失败模式（测试注入）: 展开资源预算', line: 1, column: 1 }],
    }));
    const failed = await compiledOf(envelopeOf(TEXT_RETRY));
    const { issues } = expectRejected(failed);
    // 失败原因确实来自求值通道（注入标记透传，未被吞掉/改写/外抛）
    const joined = JSON.stringify(issues);
    expect(joined).toContain('求值期失败模式（测试注入）');
    // 可重试语义：同文本再次调用（evaluate 恢复正常）→ 真实重新求值，不再失败
    const retried = expectOk(await compiledOf(envelopeOf(TEXT_RETRY)));
    // 「重试重算发生」计数断言（R2 D2 修正）：须置于下方 freshDerived 对照直调
    // 之前——freshDerived 会直接调用 evaluate（对照基准，非 getCompiled 路径），
    // 若在其之后再断言，恒为 3≠2 而红：第一次失败 + 重试重算 = 2
    expect(evaluateMock).toHaveBeenCalledTimes(2); // 第一次失败 + 重试重算
    expect(retried.derived).toEqual(freshDerived(TEXT_RETRY));
    // 重试成功后缓存持有好条目：第三次同引用且不再触发 evaluate
    const third = expectOk(await compiledOf(envelopeOf(TEXT_RETRY)));
    expect(third).toBe(retried);
    expect(third.module).toBe(retried.module);
    expect(third.derived).toBe(retried.derived);
    // 命中不再触发 evaluate：计数保持 3 = 2 次 getCompiled 求值（第一次失败 +
    // 重试重算）+ freshDerived 对照直调 1 次（不计入 getCompiled 求值行为——
    // 若命中路径重算，此处将 >3）
    expect(evaluateMock).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// AC6 纯引擎、零新运行时依赖
// ---------------------------------------------------------------------------

describe('getCompiled — AC6 纯引擎、零新运行时依赖', () => {
  it('packages/vfsl/package.json 无运行时 dependencies（清单契约：不得新增运行时依赖）', () => {
    const pkg = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    // 清单契约（非源码文本断言）：运行时依赖集合保持为空集；
    // vitest/typescript 等属 devDependencies（构建期），不在本契约内。
    expect(pkg.dependencies ?? {}).toEqual({});
  });

  it('getCompiled 是包公共导出函数（引擎公共面），可经公共入口直接调用', async () => {
    expect(typeof getCompiled).toBe('function');
    const ok = expectOk(await compiledOf(TEXT_B));
    expect(ok.derived).toEqual(freshDerived(TEXT_B));
  });
});

// ---------------------------------------------------------------------------
// 边界：非法文本（语法错误）拒绝且不落缓存
// ---------------------------------------------------------------------------

describe('getCompiled — 边界：非法文本（语法错误）拒绝且不落缓存', () => {
  it('语法错误文本（信封与文本两种形式）→ ok:false，kind:vfsl 文本通道、VFSL-E 前缀', async () => {
    for (const input of [envelopeOf(TEXT_BAD), TEXT_BAD]) {
      const r = await compiledOf(input);
      const { issues } = expectRejected(r);
      const first = issues[0] as SchemaParseIssue;
      expect(first.kind).toBe('vfsl');
      if (first.kind === 'vfsl') {
        expect(first.issue.message).toMatch(/^VFSL-E\d+:/);
      }
    }
  });

  it('非法文本拒绝不污染缓存：其后合法文本正常编译、坏文本重复拒绝幂等', async () => {
    const bad1 = await compiledOf(envelopeOf(TEXT_BAD));
    expectRejected(bad1);
    const good = expectOk(await compiledOf(envelopeOf(TEXT_A)));
    expect(good.derived).toEqual(freshDerived(TEXT_A));
    const good2 = expectOk(await compiledOf(envelopeOf(TEXT_A)));
    expect(good2).toBe(good);
    const bad2 = await compiledOf(envelopeOf(TEXT_BAD));
    expectRejected(bad2);
  });
});
