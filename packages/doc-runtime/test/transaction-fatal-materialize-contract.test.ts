/**
 * SA6 红灯测试 — @nomicore/doc-runtime committed-aware transaction fatal 契约
 * （issue #87 / 任务简报 wiki/raw/task_doc-runtime-transaction-fatal.md，功能开发）。
 *
 * 契约来源（逐条对应简报 AC-1~AC-6）：
 * - docs/adr/0008（NamespaceRuntime 读写能力与单序列器，Fatal 与失败通道节——本任务
 *   直接授权来源，演进条目 2：「transaction helper 提供 committed-aware branded fatal
 *   contract」）：
 *   - 「`@nomicore/doc-runtime` 必须提供 branded `DocRuntimeFatalError`，至少包含
 *     `committed` 与稳定 `phase`。」（AC-1）
 *   - 「`committed:false` 不调用 dirty notifier；`committed:true` 或未知异常保守视为
 *     可能已提交……」（AC-5；dirty notifier 属 Runtime 层职责，doc-runtime 只携带事实）
 *   - 「不补偿、不 fallback、不声称 rollback」（AC-4）
 *   - 「普通、可预期且零写入的读取或写入失败使用领域化结果联合」（AC-3）
 * - docs/adr/0007（失败边界节，仍有效条款）：「事务开始后若未知 observer 抛错，视为
 *   Runtime internal/fatal，不虚假声称自动回滚，也不尝试 fallback」；「零写入承诺覆盖
 *   所有验证失败和 detached 构造失败」。
 * - wiki/raw/task_doc-runtime-transaction-fatal_conflict_report.md：
 *   - W1：写后 fatal 唯一相容形态 = throw/reject；committed:true 面不得开 ok:false 后门、
 *     不得补偿修复写入、不得声称已回滚。
 *   - W2'：公共 fatal 类型名与最小字段面按 ADR-0008 原文——`DocRuntimeFatalError` +
 *     `committed` + 稳定 `phase`；phase 取值集一经发布即冻结；不侵占 Runtime 层
 *     `RuntimeWriteFatalError` 命名（本包不导出该名——分层红线 W4）。
 *   - W3：写前/committed:false fatal 回归测试锚 0 update 与 state 字节不变；
 *     committed:true 不得被降格为 false；未识别异常一律保守归 committed:true。
 *   - W4：doc-runtime fatal 只携带事实（committed/phase），不执行 Runtime 层动作
 *     （notifyDirty / 永久关闭写能力是 Runtime 层槽内职责）。
 *   - W5：领域结果联合面（ok:false + issues）不得被改道进 fatal 通道。
 *
 * 指示灯现状（红灯，行为性——非收集失败）：
 * - `DocRuntimeFatalError` 尚未实现/未从公共入口导出（全仓 grep 0 命中）：本文件用
 *   动态 import 取该成员，`expect(fatalCtor).toBeTypeOf('function')` 红；
 * - `materializeRoot` 现行写后偏离抛出的是裸 `Error`（DOCRT-E201 家族消息前缀）、
 *   observer 抛错原样 loud 传播（裸 Error / 裸任意值），均无 `committed`/`phase` 字段：
 *   本文件全部场景用例的 instanceof / committed / phase 断言红（真实失败证据见运行输出）。
 * - 说明：本文件不预设 phase 的具体取值与 DocRuntimeFatalError 的构造签名（均为
 *   ADR-0008 留白实现空间、归 SA1 设计定稿）；测试只锚契约可观察面——branded 类存在、
 *   committed 字段诚实、phase 非空且（a）重复触发稳定（b）三相两两互异（AC-2 可机读
 *   区分）。SA1 设计不得收窄下列可观测契约，仅可补充。
 * - 现有 materialize-root.test.ts / -rev2.test.ts 的 /DOCRT-E201/、/DOCRT-E202/ 前缀
 *   断言与「observer-boom 原样传播」精确匹配断言（U13）与本契约的关系：E201/E202
 *   前缀保留即可兼容前者；U13 的「message 精确匹配原始 observer 错误」与「branded
 *   fatal 交付」存在面冲突（branded 必须包装才能携带 committed/phase），按本任务
 *   AC-1/AC-2/AC-6 以 branded fatal 为准，U13 的演进方式列为 SA1 设计输入
 *   （本文件不动 U13——避免在 SA1 定稿包装形态前锁死；AC 门禁复核）。
 *
 * 范围治理说明：
 * - O2（E202 归类语义重量）：现行 E202（写前活动 transaction 语境拒绝）是调用方契约
 *   破坏而非引擎 internal failure，若归入 DocRuntimeFatalError 将触发 Runtime 层
 *   「永久关闭写能力」处置——归类归 SA1/SA2，本文件**不锚 E202 的 fatal 化**。
 * - 本文件的「明确 pre-commit internal failure」锚 = 手造派生物（derived.structure
 *   非 root 形）：它非「普通、可预期」失败（合规调用者不可达），是 internal/意外异常
 *   类，零写入——按冲突报告重点裁决三 3 归 committed:false fatal 面（W3 锚）。
 * - AC-3 护栏用例（describe 7）当前为绿（fatal 通道尚不存在，领域失败本就未被吞并）；
 *   它们守护的是「SA3 引入 fatal 通道后不得反向吞并领域联合」（W5）——若实现把
 *   领域失败改道 fatal 通道即变红。主锚（describe 1–6）为行为性红灯。
 */
import { describe, expect, it, beforeAll } from 'vitest';
import * as Y from 'yjs';
import { evaluate, parseVfsl, validateLogicalSnapshot } from '@nomicore/vfsl';
import type { DerivedSchema } from '@nomicore/vfsl';
// baseline 已实现并导出（issue #74 / PR #84）：静态具名导入合法。
import { materializeRoot, readLogicalValueAtPath } from '../src/index.js';
import type { MaterializeResult } from '../src/index.js';

// —— 契约类型（测试侧声明；不依赖生产类型导出，避免「类型先行」掩盖行为断言）——

/** 本任务契约的 fatal 最小字段面（ADR-0008 原文：committed + 稳定 phase；仅事实面）。 */
interface FatalShape {
  committed: boolean;
  phase: string;
}

type FatalCtor = new (...args: unknown[]) => Error;

interface MaterializeIssue {
  message: string;
  path: Array<string | number>;
}

type LocalMaterializeResult =
  | { ok: true }
  | { ok: false; issues: MaterializeIssue[] };

// —— DocRuntimeFatalError（当前未实现/未导出：动态 import + 运行时断言 → 行为性红灯）——
// 不用静态具名 import：会让 vitest 收集阶段整体失败、掩盖每个用例的行为红因；
// 动态 import 让「成员缺失」以 `undefined` 形态落到每个用例的断言上（红因可读）。
let fatalCtor: FatalCtor | undefined;
beforeAll(async () => {
  const mod = (await import('../src/index.js')) as Record<string, unknown>;
  fatalCtor = mod['DocRuntimeFatalError'] as FatalCtor | undefined;
});

// —— 测试辅助 ——

function derivedOf(text: string): DerivedSchema {
  const parsed = parseVfsl(text);
  if (!parsed.ok) throw new Error(`前置 parseVfsl 失败（fixture 缺陷）：${JSON.stringify(parsed.issues)}`);
  const evaluated = evaluate(parsed.module);
  if (!evaluated.ok) throw new Error(`前置 evaluate 失败（fixture 缺陷）：${JSON.stringify(evaluated.issues)}`);
  return evaluated.derived;
}

/** doc 当前状态快照（encodeStateAsUpdate 字节序列；零写入断言用逐字节比较，W3）。 */
function stateBytes(doc: Y.Doc): number[] {
  return [...Y.encodeStateAsUpdate(doc)];
}

/** 'update' 事件计数器（零写入 / 已提交锚）。 */
function countUpdates(doc: Y.Doc): { count: number } {
  const counter = { count: 0 };
  doc.on('update', () => {
    counter.count += 1;
  });
  return counter;
}

/** 捕获同步调用抛出的任意值（Error / 任意 throw 值）；未抛 → undefined。 */
function capture(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return undefined;
}

function phaseOf(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const p = (err as { phase?: unknown }).phase;
  return typeof p === 'string' ? p : undefined;
}

function committedOf(err: unknown): boolean | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const c = (err as { committed?: unknown }).committed;
  return typeof c === 'boolean' ? c : undefined;
}

/** AC-4 文本负面锚：fatal message 不得「声称已回滚/自动回滚/rolled back」（W1 三禁之三）。
 *  注意：负词「不回滚、不补偿」等声明本身不违反（禁止的是**声称**——断言的是声称形态）。 */
const ROLLBACK_CLAIM = /(已|已经|正在|将)\s*回滚|(?:已|已经)自动回滚|自动回滚|回滚(?:已|)完成|rolled\s*-?\s*back/i;

function expectNoRollbackClaim(thrown: unknown): void {
  const msg = thrown instanceof Error ? thrown.message : String(thrown);
  expect(msg).not.toMatch(ROLLBACK_CLAIM);
}

// —— 场景触发器（独立 doc；one-shot observer——G8 纪律：无 guard 的重入写 → 引擎无限递归）——

const DERIVED_TWO = derivedOf('type ROOT = { title: string; count: number };');

/** 场景 A：post-transaction verification ⑤ 顶层偏离——observer 事务内 delete 计划键。 */
function runVerifyDeleteDeviation(): { thrown: unknown; doc: Y.Doc; root: Y.Map<unknown> } {
  const doc = new Y.Doc();
  const root = doc.getMap('ROOT');
  let done = false;
  root.observe(() => {
    if (done) return;
    done = true;
    root.delete('title'); // ⑤ 主线：size 期望 2、实际 1 → E201
  });
  return { thrown: capture(() => materializeRoot(DERIVED_TWO, { title: 't', count: 7 }, doc)), doc, root };
}

/** 场景 B：observer 事务内 insert 额外键（size 增大变体）。 */
function runVerifyInsertDeviation(): { thrown: unknown; doc: Y.Doc; root: Y.Map<unknown> } {
  const doc = new Y.Doc();
  const root = doc.getMap('ROOT');
  let done = false;
  root.observe(() => {
    if (done) return;
    done = true;
    root.set('extra', 1); // ⑤ 主线：size 期望 2、实际 3 → E201
  });
  return { thrown: capture(() => materializeRoot(DERIVED_TWO, { title: 't', count: 7 }, doc)), doc, root };
}

/** 场景 C：observer 覆写计划键值（值不同一性变体——size 不变也须检测，G5）。 */
function runVerifyOverwriteDeviation(): { thrown: unknown; doc: Y.Doc; root: Y.Map<unknown> } {
  const doc = new Y.Doc();
  const root = doc.getMap('ROOT');
  let done = false;
  root.observe(() => {
    if (done) return;
    done = true;
    root.set('title', 'changed'); // ⑤ 值支：与安装值不同一 → E201
  });
  return { thrown: capture(() => materializeRoot(DERIVED_TWO, { title: 't', count: 7 }, doc)), doc, root };
}

const DERIVED_NESTED = derivedOf('type ROOT = { u: { n: number; s: string } };');

/** 场景 D：⑥ 语义偏离——observer 原地修改嵌套子树（ROOT 顶层引用不变，仅 ⑥ 可见）。 */
function runVerifyNestedDeviation(): { thrown: unknown; doc: Y.Doc; root: Y.Map<unknown> } {
  const doc = new Y.Doc();
  const root = doc.getMap('ROOT');
  let done = false;
  root.observe(() => {
    if (done) return;
    done = true;
    const u = root.get('u') as Y.Map<unknown>;
    u.set('n', 2); // 声明值 1 → 2：extract(real) ≠ extract(scratch) → ⑥ 偏离
  });
  return { thrown: capture(() => materializeRoot(DERIVED_NESTED, { u: { n: 1, s: 'x' } }, doc)), doc, root };
}

/** 场景 E：observer cleanup throw（已识别形态——抛 Error 实例）。 */
function runObserverThrowError(): {
  thrown: unknown;
  doc: Y.Doc;
  root: Y.Map<unknown>;
  updateCount: number;
  observeCalls: number;
} {
  const doc = new Y.Doc();
  const root = doc.getMap('ROOT');
  let observeCalls = 0;
  root.observe(() => {
    observeCalls += 1;
    throw new Error('observer-boom');
  });
  const events = countUpdates(doc);
  const thrown = capture(() => materializeRoot(DERIVED_TWO, { title: 't', count: 7 }, doc));
  return { thrown, doc, root, updateCount: events.count, observeCalls };
}

/** 场景 F：未识别 transaction 异常——observer 抛非 Error 值（string），未知形态。 */
function runObserverThrowNonError(): { thrown: unknown; doc: Y.Doc; root: Y.Map<unknown> } {
  const doc = new Y.Doc();
  const root = doc.getMap('ROOT');
  let done = false;
  root.observe(() => {
    if (done) return;
    done = true;
    throw 'observer-string-boom'; // 非 Error 实例 → 未识别
  });
  return { thrown: capture(() => materializeRoot(DERIVED_TWO, { title: 't', count: 7 }, doc)), doc, root };
}

/** 场景 G：明确 pre-commit internal failure——手造派生物（structure 非 root 形）。 */
function runPreCommitInternal(): { thrown: unknown; doc: Y.Doc; events: { count: number }; before: number[] } {
  const derived = derivedOf('type ROOT = { title: string };');
  // 结构树非 root（可观察的畸形派生物：任何合规 VFSL 求值产物 structure 恒为 root）。
  // 现行实现将其收敛为 DOCRT-E200 单 issue（ok:false 领域联合）——契约要求 internal
  // 性质的写前异常以 committed:false fatal 交付（冲突报告重点裁决三 3 + W3）。
  const broken = {
    ...derived,
    structure: { kind: 'array', element: { kind: 'leaf' } },
  } as unknown as DerivedSchema;
  const doc = new Y.Doc();
  const events = countUpdates(doc);
  const before = stateBytes(doc);
  const thrown = capture(() => materializeRoot(broken, { title: 't' }, doc));
  return { thrown, doc, events, before };
}

// —— AC-1：branded 形状与公共导出面 ——

describe('AC-1 — branded DocRuntimeFatalError 公共导出面（ADR-0008 原文命名）', () => {
  it('包公共入口导出 DocRuntimeFatalError 且为构造函数（branded 类存在）', () => {
    // 红因（当前基线）：@nomicore/doc-runtime 无 DocRuntimeFatalError（全仓 grep 0 命中）
    expect(fatalCtor).toBeTypeOf('function');
  });

  it('doc-runtime 不导出 Runtime 层 RuntimeWriteFatalError（W2\'/W4 分层：两层命名互不侵占）', async () => {
    // 模块级导出断言（非源码 grep）：Runtime 层类型不得经由 doc-runtime 公共面泄露
    const mod = (await import('../src/index.js')) as Record<string, unknown>;
    expect(mod['RuntimeWriteFatalError']).toBeUndefined();
    expect(mod['DocRuntimeFatalError']).toBeTypeOf('function'); // 本包 fatal 面 = 仅 DocRuntimeFatalError
  });
});

// —— AC-2 / AC-4 / AC-6：post-transaction verification → committed:true branded fatal ——

describe('AC-2/AC-4/AC-6 — post-transaction verification 偏离 → committed:true branded fatal（不补偿、不声称回滚）', () => {
  it('observer 事务内 delete 计划键（⑤ size 偏离）→ throw DocRuntimeFatalError：committed:true、phase 非空；Y.Doc 保持 observer 留下状态（无补偿写）', () => {
    expect(fatalCtor).toBeTypeOf('function'); // 红因①：branded 类缺失
    const { thrown, doc, root } = runVerifyDeleteDeviation();
    expect(thrown).toBeInstanceOf(fatalCtor as FatalCtor); // 红因②：现行裸 Error（DOCRT-E201 前缀）非 branded 实例
    expect(committedOf(thrown)).toBe(true); // 红因③：现行无 committed 字段；事务已提交不得降格 false（W3）
    expect(phaseOf(thrown)).toBeTypeOf('string'); // 红因④：现行无 phase 字段
    // AC-4 行为锚（不补偿写）：fatal 后 doc 保持 observer 留下的实际状态——不把 title 补回
    expect(root.has('title')).toBe(false);
    expect(root.get('count')).toBe(7);
    // AC-4 文本锚（不声称 rollback）
    expectNoRollbackClaim(thrown);
  });

  it('observer 事务内 insert 额外键（⑤ size 增大变体）→ throw DocRuntimeFatalError：committed:true、phase 非空；插键仍留存（不撤销）', () => {
    expect(fatalCtor).toBeTypeOf('function');
    const { thrown, root } = runVerifyInsertDeviation();
    expect(thrown).toBeInstanceOf(fatalCtor as FatalCtor);
    expect(committedOf(thrown)).toBe(true);
    expect(phaseOf(thrown)).toBeTypeOf('string');
    expect(root.get('extra')).toBe(1); // 不补偿：observer 插入的键保留
    expect(root.get('title')).toBe('t');
    expectNoRollbackClaim(thrown);
  });

  it('observer 覆写计划键值（⑤ 值不同一性变体）→ throw DocRuntimeFatalError：committed:true、phase 非空；覆写值保留（不恢复安装值）', () => {
    expect(fatalCtor).toBeTypeOf('function');
    const { thrown, root } = runVerifyOverwriteDeviation();
    expect(thrown).toBeInstanceOf(fatalCtor as FatalCtor);
    expect(committedOf(thrown)).toBe(true);
    expect(phaseOf(thrown)).toBeTypeOf('string');
    expect(root.get('title')).toBe('changed'); // 不补偿：observer 覆写值保留
    expectNoRollbackClaim(thrown);
  });

  it('observer 原地修改嵌套子树（⑥ 语义偏离）→ throw DocRuntimeFatalError：committed:true、phase 非空；偏离值保留（不恢复）', () => {
    expect(fatalCtor).toBeTypeOf('function');
    const { thrown, root } = runVerifyNestedDeviation();
    expect(thrown).toBeInstanceOf(fatalCtor as FatalCtor);
    expect(committedOf(thrown)).toBe(true);
    expect(phaseOf(thrown)).toBeTypeOf('string');
    const u = root.get('u') as Y.Map<unknown>;
    expect(u.get('n')).toBe(2); // 不补偿：observer 写下的嵌套值保留
    expectNoRollbackClaim(thrown);
  });
});

// —— AC-2 / AC-4 / AC-6：observer cleanup throw → committed:true branded fatal（不虚假回滚）——

describe('AC-2/AC-4/AC-6 — observer cleanup throw → committed:true branded fatal', () => {
  it('ROOT observer 抛 Error（已识别 observer 故障）→ throw DocRuntimeFatalError：committed:true、phase 非空；写入已提交（不虚假回滚：update 已发出、值已落盘）', () => {
    expect(fatalCtor).toBeTypeOf('function');
    const { thrown, root, updateCount, observeCalls } = runObserverThrowError();
    expect(thrown).toBeInstanceOf(fatalCtor as FatalCtor); // 红因：现行原样 loud 传播裸 Error('observer-boom')
    expect(committedOf(thrown)).toBe(true); // yjs 实证：observer 抛错不触发事务回滚——committed 必须诚实（W3：不得降格 false）
    expect(phaseOf(thrown)).toBeTypeOf('string');
    expect(observeCalls).toBe(1); // 单事务恰一次 type-observer 回调
    expect(updateCount).toBe(1); // update 已实际发出（不虚假回滚）
    expect(root.get('title')).toBe('t'); // 写入已实际提交
    expectNoRollbackClaim(thrown);
  });

  it('exact error identity（AC-6）：fatal 的构造器名恒为 DocRuntimeFatalError（instances 与导出类同一）', () => {
    expect(fatalCtor).toBeTypeOf('function');
    const { thrown } = runObserverThrowError();
    expect(thrown).toBeInstanceOf(fatalCtor as FatalCtor);
    expect((thrown as Error).constructor?.name).toBe('DocRuntimeFatalError'); // 红因：现行构造器名 = 'Error'
  });
});

// —— AC-2 / AC-6 / W3：明确 pre-commit internal failure → committed:false fatal + 零写入 ——

describe('AC-2/AC-6 — 明确 pre-commit internal failure → committed:false branded fatal + 零写入（W3）', () => {
  it('手造派生物（structure 非 root）→ throw DocRuntimeFatalError：committed:false、phase 非空；0 update、state 字节不变、ROOT 空置', () => {
    expect(fatalCtor).toBeTypeOf('function');
    const { thrown, doc, events, before } = runPreCommitInternal();
    // 红因：现行实现把它收敛为 DOCRT-E200 单 issue 的 ok:false 返回（未 throw、非 branded）
    expect(thrown).toBeInstanceOf(fatalCtor as FatalCtor);
    expect(committedOf(thrown)).toBe(false); // 写前 internal failure：committed 诚实为 false
    expect(phaseOf(thrown)).toBeTypeOf('string');
    // W3 零写入锚：0 update 事件 + state 逐字节不变 + ROOT 空置
    expect(events.count).toBe(0);
    expect(stateBytes(doc)).toEqual(before);
    expect(doc.getMap('ROOT').size).toBe(0);
    expectNoRollbackClaim(thrown);
  });
});

// —— AC-5：未识别 transaction 异常保守语义（回归锚）——

describe('AC-5 — 未识别 transaction 异常保守语义（未识别一律保守归 committed:true，W3）', () => {
  it('observer 抛非 Error 值（string，未识别形态）→ throw DocRuntimeFatalError：committed 保守为 true（不得降格 false）、phase 非空', () => {
    expect(fatalCtor).toBeTypeOf('function');
    const { thrown, root } = runObserverThrowNonError();
    // 红因：现行原样传播原始 string（非 branded、无 committed/phase）
    expect(thrown).toBeInstanceOf(fatalCtor as FatalCtor);
    expect(committedOf(thrown)).toBe(true); // 保守语义：未知异常视为可能已提交
    expect(phaseOf(thrown)).toBeTypeOf('string');
    expect(root.get('title')).toBe('t'); // 不虚假回滚：提交后的状态保留
    expectNoRollbackClaim(thrown);
  });

  it('回归锚：同一未识别异常场景重复触发，committed 恒为 true（保守语义稳定，不因偶发降格为 false）', () => {
    expect(fatalCtor).toBeTypeOf('function');
    for (let i = 0; i < 3; i++) {
      const { thrown } = runObserverThrowNonError();
      expect(thrown).toBeInstanceOf(fatalCtor as FatalCtor);
      expect(committedOf(thrown)).toBe(true);
    }
  });
});

// —— AC-2：三相 phase 可机读区分 + 稳定 ——

describe('AC-2 — phase 稳定且三相可机读区分（陈述事实：observer throw / post-transaction verification / pre-commit internal）', () => {
  it('同一场景（post-transaction verification 偏离）两次独立触发 → phase 相同（稳定 phase，AC-1）', () => {
    expect(fatalCtor).toBeTypeOf('function');
    const p1 = phaseOf(runVerifyDeleteDeviation().thrown);
    const p2 = phaseOf(runVerifyDeleteDeviation().thrown);
    expect(p1).toBeTypeOf('string'); // 红因：现行无 phase 字段（undefined）
    expect(p2).toBe(p1);
  });

  it('三相 phase 两两互异（observer cleanup throw / post-transaction verification / pre-commit internal failure 可被准确区分，AC-2）', () => {
    expect(fatalCtor).toBeTypeOf('function');
    const pThrow = phaseOf(runObserverThrowError().thrown);
    const pVerify = phaseOf(runVerifyDeleteDeviation().thrown);
    const pPreCommit = phaseOf(runPreCommitInternal().thrown);
    expect(pThrow).toBeTypeOf('string');
    expect(pVerify).toBeTypeOf('string');
    expect(pPreCommit).toBeTypeOf('string');
    expect(pThrow).not.toBe(pVerify); // 三种 internal fatal 必须以稳定 phase 区分
    expect(pThrow).not.toBe(pPreCommit);
    expect(pVerify).not.toBe(pPreCommit);
  });
});

// —— AC-3：领域结果联合不吞并（护栏：fatal 通道引入后该面不得改道/吞并，W5）——

// 说明：本 describe 用例当前为**绿**——fatal 通道尚不存在，领域失败本就走结果联合；
// 它们是「fatal 通道引入后仍成立」的回归护栏（若实现把领域失败改道 throw fatal
// 或吞并 issues 则变红），不是本任务的主红灯锚（主锚 = 上面 describe 1–6）。
describe('AC-3 — 普通 logical/path/materialization 失败继续使用领域结果联合，不进 fatal 通道（护栏）', () => {
  it('logical 校验失败 → 返回 ok:false + issues（引用完整），未 throw；0 update、state 字节不变', () => {
    const derived = derivedOf('type ROOT = { title: string };');
    const doc = new Y.Doc();
    const events = countUpdates(doc);
    const before = stateBytes(doc);
    const result = materializeRoot(derived, { title: 42 }, doc) as LocalMaterializeResult;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues[0]?.message).toBeTypeOf('string');
    }
    expect(events.count).toBe(0);
    expect(stateBytes(doc)).toEqual(before);
  });

  it('materialization 领域失败（目标 ROOT 非空）→ 返回 ok:false + 恰 1 issue；0 update、不覆盖', () => {
    const derived = derivedOf('type ROOT = { title: string };');
    const doc = new Y.Doc();
    doc.getMap('ROOT').set('title', 'existing');
    const events = countUpdates(doc);
    const result = materializeRoot(derived, { title: 't' }, doc) as LocalMaterializeResult;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toHaveLength(1);
    }
    expect(events.count).toBe(0);
    expect(doc.getMap('ROOT').get('title')).toBe('existing'); // 不覆盖、不合并、不 fallback
  });

  it('path 领域失败（readLogicalValueAtPath 不允许路径）→ 返回 ok:false 联合，未 throw，非 fatal 形态', () => {
    const derived = derivedOf('type ROOT = { title: string };');
    const doc = new Y.Doc();
    const r = readLogicalValueAtPath(derived, doc, ['title', 'nested']); // leaf 不可下钻 → PATH_NOT_ALLOWED
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('PATH_NOT_ALLOWED');
    }
  });
});
