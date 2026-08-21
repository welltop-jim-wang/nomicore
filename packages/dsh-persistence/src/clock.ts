import type { PersistenceTimer } from '@nomicore/persistence'

/**
 * 探针时钟契约（决策 D）：`advanceBy` 使记录只含虚拟刻度，跨运行逐字节一致。
 * 传入的裸 `PersistenceTimer` 缺 `advanceBy` → 探针启动即 loud TypeError
 * （`clock-not-drivable`，不产生 record）。
 */
export interface ProbeClock extends PersistenceTimer {
  advanceBy(milliseconds: number): Promise<void>
}

/** 排空微任务：flush 链（≤2-3 hop）在 advance 后结算的独立兜底（§6.3）。 */
export async function settle(ticks = 32): Promise<void> {
  for (let index = 0; index < ticks; index += 1) await Promise.resolve()
}

/**
 * 确定性虚拟时钟：机制与 persistence testkit `createTestTimer` 同族（testing.ts:100-132）——
 * 按到期刻度序触发回调，每次触发后与 advance 收尾各排空若干微任务；`now` 从 0 起。
 * 附带 `pending()` 供 file 通道识别「本次 retry 尝试是否已结算」（失败 → 内核已排下一
 * retry 计时器；成功 → 无残留计时器）。
 */
export function createDeterministicClock(): ProbeClock {
  let now = 0
  let nextId = 0
  const timers = new Map<number, { at: number, callback: () => void }>()
  const clock: ProbeClock & { pending: () => number } = {
    now: () => now,
    setTimeout(callback, delayMs) {
      const id = nextId++
      timers.set(id, { at: now + delayMs, callback })
      return id
    },
    clearTimeout(timer) {
      timers.delete(timer as number)
    },
    pending: () => timers.size,
    async advanceBy(milliseconds) {
      const deadline = now + milliseconds
      while (true) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= deadline)
          .sort(([, left], [, right]) => left.at - right.at)[0]
        if (due === undefined) break
        const [id, timer] = due
        timers.delete(id)
        now = timer.at
        timer.callback()
        await settle(3)
      }
      now = deadline
      await settle(3)
    },
  }
  return clock
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
