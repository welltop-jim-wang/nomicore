/**
 * @nomicore/doc-runtime — committed-aware branded fatal 契约（ADR-0008 演进条目 2，issue #87）。
 *
 * 只携带事实（W4）：`DocRuntimeFatalError` 不经由此文件执行任何 Runtime 层动作——
 * 不调用 notifyDirty、不关闭写能力、没有任何对 Runtime/持久层的 import。fatal 的
 * 分类权 100% 归 doc-runtime（catch 位置 = 管线位置事实），不归抛错方（含公共导出类
 * 被调用方数据伪造的实例——一律按捕获位置的管线事实重分级，cause 原样保留）。
 */
import * as Y from 'yjs';

/** fatal phase 取值集（v1 冻结，见 SA1 设计 §3.2）。一经发布只增不改不删。 */
export type DocRuntimeFatalPhase =
  | 'observer-cleanup-throw' // 事务调用栈异常逃逸（可达面 = observer cleanup 派发期抛错）
  | 'post-commit-verification' // ⑤ verifyInstall / ⑥ verifySnapshotIntact 偏离或无法完成
  | 'pre-commit-internal'; // 写前 internal 不变量破坏（派生物畸形），零写入

/**
 * ADR-0008 原文命名的 branded fatal（W2'）。只携带事实（W4）：
 * 不调用 notifyDirty、不关闭写能力、不执行任何 Runtime 层动作。
 *
 * - `committed`：诚实提交事实——true = 事务已提交或保守视为已提交（W3 不得降格 false）；
 *   false = 确定零写入。
 * - `phase`：稳定管线阶段标识（冻结表 SA1 设计 §3.2），由 throw 点位置决定。
 * - `cause`（ES2022 ErrorOptions）：原始异常实例（Error 或任意 thrown 值）零信息损失保留。
 */
export class DocRuntimeFatalError extends Error {
  readonly committed: boolean;
  readonly phase: DocRuntimeFatalPhase;

  constructor(
    phase: DocRuntimeFatalPhase,
    committed: boolean,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'DocRuntimeFatalError';
    this.committed = committed;
    this.phase = phase;
  }
}

/**
 * 派生物不变量破坏 sentinel（包内）：仅由「合规调用者不可达」的手造派生物诊断点抛出。
 * 自身不携带 committed/phase——由捕获点按管线位置分类（prepare → pre-commit-internal；
 * ⑥ scratch 侧 → E201 变体 D）。extends Error：extract 侧崩溃边界（E100）行为零变化。
 */
export class DerivedInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DerivedInvariantError';
  }
}

/**
 * ④/写事务统一包装器：materializeRoot 与 applyValidatedMutation 共用（exact identity 的
 * 结构性保证）。逃逸异常**无条件**包装为 DocRuntimeFatalError('observer-cleanup-throw',
 * true, E203, { cause: 原值 })——无 instanceof 透传：分类权归 doc-runtime，不归抛错方
 * （ADR-0007「事务开始后若未知 observer 抛错，视为 Runtime internal/fatal」的「视为」义务）。
 * 事务体仅含 copyJsonDomain 产物 + detached 类型上的 set/clear（D10），物理上不可能抛出
 * 内部 branded——无条件包装永不双重包装；外来/伪造 branded 被诚实分类为 committed:true
 * （捕获位置 = 事务已提交的事实），cause 零信息损失保留。
 */
export function transactGuarded(doc: Y.Doc, body: () => void): void {
  try {
    doc.transact(body);
  } catch (err) {
    throw new DocRuntimeFatalError(
      'observer-cleanup-throw',
      true,
      `DOCRT-E203: Yjs 事务调用栈异常（observer cleanup 派发期抛错；写入已提交，不回滚、不补偿，` +
        `doc 保持事务留下的实际状态；未识别异常保守视为已提交）；原始异常原样携带（证据引用，非本 fatal 自述）：` +
        `「${errDetailOf(err)}」`,
      { cause: err },
    );
  }
}

/** 错误详情（message 或 String 兜底——证据引用文本，非本 fatal 自述 claims）。 */
function errDetailOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
