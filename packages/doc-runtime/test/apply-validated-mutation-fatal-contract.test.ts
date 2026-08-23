/**
 * SA6 红灯测试 — @nomicore/doc-runtime applyValidatedMutation 的 committed-aware
 * transaction fatal 契约面（issue #87 / 任务简报 AC-6「applyValidatedMutation 的相关
 * 测试覆盖 exact error identity、commit 状态和 Y.Doc 最终状态」）。
 *
 * ⚠️ 范围治理（冲突报告观察项 O1，本文件落地方案）：
 * - `applyValidatedMutation` **尚未实现**（生产代码 grep 0 命中；仅存在于
 *   docs/adr/0007、docs/adr/0008 与 PRD wiki/prd/0060-doc-runtime-validation-prd.md §6
 *   的规划面）。本任务 = ADR-0008 演进条目 2（transaction helper 提供 committed-aware
 *   branded fatal contract），**不扩范围实现完整 validated mutation 管线**（首版
 *   set/delete/array-insert/array-delete 语义属独立任务面，O1 明文）。
 * - 因此本文件只锚 applyValidatedMutation 的 **fatal 契约面**（与 materializeRoot
 *   共享 DocRuntimeFatalError 的 exact identity / committed / Y.Doc 最终状态承诺），
 *   不锚 mutation 语义细节（路径语义、数组边界、optional 规则等——独立任务面）。
 * - mutation 参数形状：ADR-0007/PRD 只冻结语义（set/delete/array-insert/array-delete、
 *   `set([])` 允许整体替换 ROOT、成功只返回 {ok:true} 等），**未逐字冻结类型字段名**。
 *   本文件采用对冻结语义的最小直译 `{ op: 'set', path, value }`；若 SA1 设计对字段
 *   命名有不同定稿，SA1 应在设计中登记本测试的对齐方式（SA6 锚定的是契约面：
 *   fatal 形态与 committed/phase/最终状态，不是 mutation 字段名）。
 * - 本文件的 TODO 落点：applyValidatedMutation 存在且可被触发事务提交后（observer
 *   抛错）→ 全部用例转绿；不存在（当前基线）→ 全部用例红（红因见各用例注释）。
 *
 * 契约来源：
 * - docs/adr/0007：「`applyValidatedMutation(derived, doc, mutation)`：同步完成当前
 *   ROOT 结构/逻辑检查、在普通 JSON 副本中模拟 mutation、完整 ROOT 逻辑校验、detached
 *   子树构造和单次 Yjs transaction」；「成功只返回 `{ ok:true }`，不返回 snapshot、
 *   Yjs update 或内部类型」；失败边界：「事务开始后若未知 observer 抛错，视为 Runtime
 *   internal/fatal，不虚假声称自动回滚，也不尝试 fallback」。
 * - docs/adr/0008（Fatal 与失败通道节）：branded `DocRuntimeFatalError`（committed +
 *   稳定 phase）；「不补偿、不 fallback、不声称 rollback」；「普通、可预期且零写入的
 *   …失败使用领域化结果联合」（W5：mutation 领域失败必须留在 ok:false 联合面）。
 * - wiki/raw/task_doc-runtime-transaction-fatal_conflict_report.md 边界条件
 *   W1（committed:true 唯一相容形态 throw/reject）/ W2'（命名与字段面）/ W3（零写入锚 +
 *   诚实 committed）/ W4（doc-runtime 只携带事实）。
 *
 * 指示灯现状（红灯，构造性 + 行为性）：
 * - `applyValidatedMutation` 未实现/未从公共入口导出（同样适用 DocRuntimeFatalError）：
 *   本文件以动态 import 取成员，`expect(typeof applyValidatedMutation).toBe('function')`
 *   红（成员缺失 → undefined）；DocRuntimeFatalError 同理（红因：全仓 grep 0 命中）。
 * - behavior 型用例（调用 applyValidatedMutation 触发 committed fatal）在成员缺失时
 *   以 `applyValidatedMutation(...)` 抛 TypeError（not a function）红；SA3 实现后
 *   转为对 fatal 契约面（instanceof DocRuntimeFatalError / committed:true /
 *   Y.Doc 最终状态）的行为断言。
 */
import { describe, expect, it, beforeAll } from 'vitest';
import * as Y from 'yjs';
import type { DerivedSchema } from '@nomicore/vfsl';
import { evaluate, parseVfsl } from '@nomicore/vfsl';
// baseline 已实现并导出（issue #74 / PR #84）：静态具名导入合法（用于铺底 ROOT）。
import { materializeRoot } from '../src/index.js';

// —— 契约类型（测试侧声明）——

interface FatalShape {
  committed: boolean;
  phase: string;
}

type FatalCtor = new (...args: unknown[]) => Error;

interface MutationIssue {
  message: string;
  path: Array<string | number>;
}

type ApplyMutationResult =
  | { ok: true }
  | { ok: false; issues: MutationIssue[] };

// —— 动态取成员（applyValidatedMutation / DocRuntimeFatalError 当前均未导出 → 行为性红灯）——

type ApplyValidatedMutation = (derived: DerivedSchema, doc: Y.Doc, mutation: unknown) => ApplyMutationResult;

let applyValidatedMutation: ApplyValidatedMutation | undefined;
let fatalCtor: FatalCtor | undefined;
beforeAll(async () => {
  const mod = (await import('../src/index.js')) as Record<string, unknown>;
  applyValidatedMutation = mod['applyValidatedMutation'] as ApplyValidatedMutation | undefined;
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

function stateBytes(doc: Y.Doc): number[] {
  return [...Y.encodeStateAsUpdate(doc)];
}

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

const ROLLBACK_CLAIM = /(已|已经|正在|将)\s*回滚|(?:已|已经)自动回滚|自动回滚|回滚(?:已|)完成|rolled\s*-?\s*back/i;

function expectNoRollbackClaim(thrown: unknown): void {
  const msg = thrown instanceof Error ? thrown.message : String(thrown);
  expect(msg).not.toMatch(ROLLBACK_CLAIM);
}

// —— fixture 常量 ——

const DERIVED_TWO = derivedOf('type ROOT = { title: string; count: number };');

/** mutation：ADR-0007 冻结语义的最小直译——set 非空路径单键（形状字段名见文件头范围治理说明）。 */
const SET_TITLE_MUTATION = { op: 'set', path: ['title'], value: 't2' } as const;

// —— 用例 ——

describe('applyValidatedMutation — 公共导出面（AC-6 前置：fatal 契约面的载体必须面世）', () => {
  it('applyValidatedMutation 经包公共入口导出为函数', () => {
    // 红因（当前基线）：@nomicore/doc-runtime 未实现/未导出 applyValidatedMutation
    expect(typeof applyValidatedMutation).toBe('function');
  });
});

describe('applyValidatedMutation — committed fatal 契约面（AC-6：exact identity / commit 状态 / Y.Doc 最终状态）', () => {
  it('mutation 事务提交后 observer 抛错 → throw DocRuntimeFatalError（与 materializeRoot 同一 branded 类）：committed:true、phase 非空、Y.Doc 保持提交后状态（不虚假回滚）', () => {
    // 前置：applyValidatedMutation 与 DocRuntimeFatalError 必须已面世（红因①：成员缺失）
    expect(typeof applyValidatedMutation).toBe('function');
    expect(fatalCtor).toBeTypeOf('function');
    // fixture：先经 materializeRoot 铺底合法 ROOT（独立入口，基线已实现）；**再**在 ROOT
    // 上挂 one-shot 抛错 observer——mutation 事务提交后（cleanup 期）触发 observer 故障。
    // 时序纪律（SA1 设计 §8 对齐）：observer 必须挂在 seed 事务**之后**——挂载先于首次
    // 事务 ⇒ seed 安装事务本身即触发 one-shot 抛错 ⇒ expect(seed.ok) 恒不可达、任何
    // 正确实现下恒红（node+yjs@13.6.32 实证）。
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    const seed = materializeRoot(DERIVED_TWO, { title: 't', count: 7 }, doc);
    expect(seed.ok).toBe(true); // 前置：铺底成功（否则本用例前置失败、无 faker 语义）
    let done = false;
    root.observe(() => {
      if (done) return;
      done = true;
      throw new Error('mutation-observer-boom');
    });
    // 调用被测入口（红因②：当前成员缺失 → TypeError not a function；SA3 后：若 fatal
    // 契约未实现 → 非 branded / 无 committed / 无 phase 的各断言红）
    const thrown = capture(() => (applyValidatedMutation as ApplyValidatedMutation)(DERIVED_TWO, doc, SET_TITLE_MUTATION));
    expect(thrown).toBeInstanceOf(fatalCtor as FatalCtor); // exact identity：doc-runtime 公共 fatal 类
    expect(committedOf(thrown)).toBe(true); // 事务已提交：committed 诚实为 true（W3：不得降格 false）
    expect(phaseOf(thrown)).toBeTypeOf('string'); // 稳定 phase（非空字符串）
    // AC-4 / Y.Doc 最终状态：mutation 已提交（不补偿、不 fallback、不声称回滚）——
    // observer 抛错前 mutation 的 set 已落盘（yjs 实证：observer 抛错不触发事务回滚）
    expect(doc.getMap('ROOT').get('title')).toBe('t2');
    expect(doc.getMap('ROOT').get('count')).toBe(7);
    expectNoRollbackClaim(thrown);
  });

  it('fatal 契约面的一致性：applyValidatedMutation 抛出的 fatal 与 materializeRoot 的 fatal 为同一构造器（exact identity，AC-6）', () => {
    expect(typeof applyValidatedMutation).toBe('function');
    expect(fatalCtor).toBeTypeOf('function');
    // mutation 侧 fixture（时序同用例 2：observer 挂 seed 之后，SA1 设计 §8）
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    const seed = materializeRoot(DERIVED_TWO, { title: 't', count: 7 }, doc);
    expect(seed.ok).toBe(true);
    let done = false;
    root.observe(() => {
      if (done) return;
      done = true;
      throw new Error('mutation-observer-boom');
    });
    const thrownMutation = capture(() => (applyValidatedMutation as ApplyValidatedMutation)(DERIVED_TWO, doc, SET_TITLE_MUTATION));
    // 与 materializeRoot 的 observer-throw 场景对照（同一 doc 已被 mutation 修改：
    // 以新 doc 重新取得 materializeRoot 侧的 fatal 实例，比较构造器同一性）——
    // refDoc 侧 observer 挂载后首个事务即 materializeRoot 安装事务（正是被测场景，无 seed 前置）
    const refDoc = new Y.Doc();
    const refRoot = refDoc.getMap('ROOT');
    let doneRef = false;
    refRoot.observe(() => {
      if (doneRef) return;
      doneRef = true;
      throw new Error('observer-boom');
    });
    const thrownMaterialize = capture(() => materializeRoot(DERIVED_TWO, { title: 't', count: 7 }, refDoc));
    expect(thrownMutation).toBeInstanceOf(fatalCtor as FatalCtor);
    expect(thrownMaterialize).toBeInstanceOf(fatalCtor as FatalCtor);
    expect((thrownMutation as Error).constructor).toBe((thrownMaterialize as Error).constructor); // 同类的同一构造器
  });
});

describe('applyValidatedMutation — 领域失败面不进入 fatal 通道（AC-3/W5 护栏）', () => {
  it('ROOT 已损坏（逻辑不合法）→ 普通 mutation 失败：返回 ok:false + issues（领域联合），不 throw、非 fatal 形态', () => {
    expect(typeof applyValidatedMutation).toBe('function');
    // 绕过验证通道直接以 Yjs 写入损坏 ROOT（模拟外部注入/历史脏数据）——ADR-0007：
    // 「当前 ROOT 已损坏时普通 mutation 失败，不承担 recovery」→ 领域失败必须是
    // ok:false 联合（W5：不被 fatal 通道吞并）。
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    root.set('title', 't');
    root.set('count', 'not-a-number'); // 逻辑不合法（期望 number）
    const before = stateBytes(doc);
    const result = (applyValidatedMutation as ApplyValidatedMutation)(DERIVED_TWO, doc, SET_TITLE_MUTATION);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.length).toBeGreaterThan(0);
    }
    expect(stateBytes(doc)).toEqual(before); // 零写入：失败不留下痕迹（W3）
  });
});
