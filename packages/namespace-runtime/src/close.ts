/**
 * @nomicore/namespace-runtime —— close barrier 槽体（设计 §4 D3，issue #92）：
 * 队列终节点，只做「release 恰一次 → lifecycle 终态迁移 / 失败双通道」。
 *
 * - barrier 经 sequencer.enqueue 挂接 → 必然在全部已接纳任务 settle 之后执行
 *   （promise-chain FIFO，INV-C4）；
 * - barrier 只调用一次 handle.release()（close 幂等保证入队一次，INV-C2/C4）；
 * - 无论 release 成败，lifecycle 都进入 'closed'（INV-C5）：失败时 closeIssue 冻结
 *   注册 + reject 稳定 NamespaceRuntimeCloseError（cause 零信息损失保留原始异常）；
 * - 不取消、不设内部 timeout（ADR 原文；release 永不 settle → close Promise 永挂起，
 *   属 ADR 契约行为）；
 * - release 返回非 thenable = adapter 契约违背（DocHandle.release(): Promise<void>，
 *   contract.ts:29）——拒绝虚假降级立法：不静默当成功，收敛为同一失败通道（INV-C12）。
 *   【R1 修订，SA2 #4/R-4】thenable 判定与 ECMAScript 一致：**对象形态与函数形态**
 *   （带可调用 `.then` 的 function）均为 thenable——后者接收并正常 await（拒绝它会把
 *   实际可能成功的 release 误报为失败通道，违反诚实报告）；仅「非 object 且非
 *   function」「null」「`.then` 不可调用」三形判为契约违背。
 */
import type { DocHandle } from '@nomicore/persistence';
import { CLOSE_RELEASE_FAILED_CODE, CLOSE_RELEASE_FAILED_MESSAGE, NamespaceRuntimeCloseError } from './errors.js';
import type { RuntimeState } from './p0.js';
import type { WriteSequencer } from './sequencer.js';

/** barrier 运行时环境（构造栈一次成型——纯数据闭包，槽体零读 seam 输入）。 */
export interface CloseEnv {
  readonly handle: DocHandle;
  readonly state: RuntimeState;
}

/**
 * close barrier 的**入队封装**（R2，设计 §3.4/§3.5）：普通 `close()` 首调用与
 * reset fence 的 lazy `startCloseAfterFence()` 共用同一入队路径——barrier 经
 * sequencer.enqueue 挂接（必然在队尾、排空此前全部已接纳任务），FIFO/无 timeout/
 * 已接纳任务无条件排空语义零改动。调用方的 closePromise 幂等缓存仍归 runtime.ts
 * （单 `closePromise` 变量——fence lazy continuation 与公共 close() 共用同一实例，
 * 保证「普通 close 返回同一 lazy-created promise」）。
 */
export function enqueueCloseBarrier(sequencer: WriteSequencer, env: CloseEnv): Promise<void> {
  return sequencer.enqueue(() => runCloseBarrier(env));
}

/**
 * close barrier 槽体（ADR-0008「生命周期、状态与所有权」节逐句兑现；细节见文件头）。
 * async 全 catch：release 同步 throw / reject / 非 thenable 三路全部收敛（INV-C12）；
 * 本函数的 rejection 由 sequencer 链尾 noop 消化（队列无影响）+ closePromise 送达调用方。
 */
export async function runCloseBarrier(env: CloseEnv): Promise<void> {
  try {
    const releaseResult: unknown = env.handle.release();
    if (
      (typeof releaseResult !== 'object' && typeof releaseResult !== 'function') || // 【R1 修订，SA2 #4】：function-thenable 同为 thenable（ECMAScript），接收
      releaseResult === null ||
      typeof (releaseResult as { then?: unknown }).then !== 'function'
    ) {
      throw new TypeError('handle.release() 必须返回 Promise<void>（DocHandle 契约）——非 thenable 返回属 adapter 契约违背');
    }
    await releaseResult;
    env.state.lifecycle = 'closed'; // 成功路：唯一迁移点（INV-C1）
  } catch (err) {
    env.state.lifecycle = 'closed'; // 失败路：closed 恒达（ADR「无论 release 成败」）
    env.state.closeIssue = Object.freeze({
      // 稳定摘要（恒定文案，不插值原始异常——INV-C5/C8）
      code: CLOSE_RELEASE_FAILED_CODE,
      message: CLOSE_RELEASE_FAILED_MESSAGE,
    });
    env.state.closeCause = err; // 包内诊断锚点（不进任何公共面）
    throw new NamespaceRuntimeCloseError(err === undefined ? undefined : { cause: err });
  }
}
