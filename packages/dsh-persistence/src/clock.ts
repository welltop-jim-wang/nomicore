import type { Context } from '@deepseek-ai/cordis'
import { createManualClock, createManualClockPlugin, type ManualClock } from '@nomicore/clock/testing'
import type { PersistenceScheduler } from '@nomicore/persistence'
import { createFakeTimerPlugin } from '@nomicore/persistence/testing'

/** Cordis 能力插件形状（clock/timer 注入缝）。 */
export interface DshCordisPlugin {
  apply(ctx: Context): void
}

/**
 * 探针时间线契约（裁决 6，R1/B3 不变式 ③）：`advanceBy` 协调推进**同一虚拟时间线**——
 * manual Clock（观测）+ fake timer（调度）由 timeline 闭包独占的两状态槽驱动。
 * 因此事件只含虚拟刻度、跨运行逐字节一致。
 *
 * - `now()` = wall-clock 观测（manual clock 状态）；
 * - `pending()` = 已武装未到期计时器数（触发即删，语义同旧 ProbeClock.pending）；
 * - `advanceBy` = 到期序触发 timer + 同步 manual clock；
 * - `clockPlugin`/`timerPlugin` = 同一时间线的两个能力插件（同一 `manual` /
 *   同一 `timers` 登记表，**禁止**注入带独立内部时钟的 scheduler——见
 *   createFakeTimerPlugin 视图契约）。
 */
export interface ProbeTimeline {
  now(): number
  pending(): number
  advanceBy(milliseconds: number): Promise<void>
  readonly clockPlugin: DshCordisPlugin
  readonly timerPlugin: DshCordisPlugin
}

/** 排空微任务：flush 链（≤2-3 hop）在 advance 后结算的独立兜底（§6.3）。 */
export async function settle(ticks = 32): Promise<void> {
  for (let index = 0; index < ticks; index += 1) await Promise.resolve()
}

/**
 * 确定性虚拟时间线（R1/B3）：timer 登记表与虚拟刻度由 timeline 闭包独占——
 * `manual`（createManualClock(0)，非负仅前进）与 `timers` 是同一闭包内的两个状态槽；
 * `timerPlugin` 注入 createFakeTimerPlugin 的 scheduler **是**（不是委托于）该表的
 * 视图，其 `setTimeout` 的到期刻度以 `manual.now()` 为基：
 *
 * ```ts
 * setTimeout: (callback, delayMs) => {
 *   const id = nextId++
 *   timers.set(id, { at: manual.now() + delayMs, callback })  // ★ 基线 = manual.now()
 *   return id
 * }
 * ```
 *
 * ⚠️（R3，SA2 R2-2b 提醒）`advanceBy` 只做**纯微任务排空**（`settle(3)`），不得含
 * 宏任务（setImmediate/setTimeout）：真实文件 I/O 在 libuv 线程池结算、须经宏任务
 * 轮转才落地——若 advanceBy 内含宏任务，I/O 可能在 advanceBy 期间结算，破坏
 * 「advanceBy 返回瞬间 = 同步基线（base=0）」的快照语义。
 *
 * `pending()` 语义（R3 §6.3）：返回已武装未到期计数；advanceBy 触发回调前先从
 * 登记表移除该计时器（已触发已删除不计）。
 */
export function createProbeTimeline(): ProbeTimeline {
  const manual: ManualClock = createManualClock(0)
  let nextId = 0
  const timers = new Map<number, { at: number, callback: () => void }>()

  // ★ 不变式 ③：timers/manual/nextId 同闭包；fake timer 是登记表 + manual.now() 的视图。
  const schedulerView: PersistenceScheduler = {
    setTimeout: (callback, delayMs) => {
      const id = nextId++
      timers.set(id, { at: manual.now() + delayMs, callback })
      return id
    },
    clearTimeout: (handle) => { timers.delete(handle as number) },
  }

  async function advanceBy(milliseconds: number): Promise<void> {
    const deadline = manual.now() + milliseconds
    while (true) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= deadline)
        .sort(([, left], [, right]) => left.at - right.at)[0]
      if (due === undefined) break
      const [id, timer] = due
      timers.delete(id)        // 不变式 ①：触发前删除——advanceBy 返回瞬间到期腿已消耗（base=0 算术保持）
      manual.set(timer.at)     // 不变式 ②：wall clock 先行到刻度，再触发回调——事件 t 与旧实现逐字节同值
      timer.callback()
      await settle(3)
    }
    manual.set(deadline)
    await settle(3)
  }

  return {
    now: () => manual.now(),
    pending: () => timers.size,
    advanceBy,
    clockPlugin: createManualClockPlugin(manual),
    timerPlugin: createFakeTimerPlugin(schedulerView),
  }
}

/** 结构化超时错误：reason 取自封闭词表（§6.2），不内插 err.message / 绝对路径。 */
export class ProbeTimeoutError extends Error {
  constructor(readonly reason: string) {
    super(`probe wait timed out: ${reason}`)
    this.name = 'ProbeTimeoutError'
  }
}

/**
 * 真实时间轮询等待（file 通道专用，§6.2）：轮询不推进虚拟时钟、不产生事件。
 * 内部用系统 setTimeout；超时 → `ProbeTimeoutError(file-settle-timeout:…)`，loud。
 */
export async function waitFor(predicate: () => boolean, timeoutMs: number, reason: string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (predicate()) return
    if (Date.now() >= deadline) throw new ProbeTimeoutError(reason)
    await new Promise<void>((resolve) => { setTimeout(resolve, 10) })
  }
}
