import type { PersistenceTimer } from '@nomicore/persistence'

/**
 * 探针时钟契约（决策 D + R3 §6.3）：`advanceBy` 使记录只含虚拟刻度，跨运行逐字节一致。
 * 传入的裸 `PersistenceTimer` 缺 `advanceBy` → 探针启动即 loud TypeError
 * （`clock-not-drivable`，不产生 record）。
 */
export interface ProbeClock extends PersistenceTimer {
  advanceBy(milliseconds: number): Promise<void>
  /**
   * （R3，R2-2b）已武装、未到期的计时器个数；**已触发已删除的计时器不计**
   * （触发即从登记表移除——SA6 FakeTimer 同语义）。这是 §6.2 A-arming /
   * advance 驱动腿基线算术的前提：advanceBy 返回瞬间到期计时器已同步消耗（base=0）。
   */
  pending(): number
}

/** 排空微任务：flush 链（≤2-3 hop）在 advance 后结算的独立兜底（§6.3）。 */
export async function settle(ticks = 32): Promise<void> {
  for (let index = 0; index < ticks; index += 1) await Promise.resolve()
}

/**
 * 确定性虚拟时钟：机制与 persistence testkit `createTestTimer` 同族（testing.ts:100-132）——
 * 按到期刻度序触发回调，每次触发后与 advance 收尾各排空若干微任务；`now` 从 0 起。
 *
 * ⚠️ （R3，SA2 R2-2b 提醒）`advanceBy` 只做**纯微任务排空**（`settle(3)`），不得含宏任务
 * （setImmediate/setTimeout）：真实文件 I/O 在 libuv 线程池结算、须经宏任务轮转才落地——
 * 若 advanceBy 内含宏任务，I/O 可能在 advanceBy 期间结算，破坏 §6.2「advanceBy 返回瞬间
 * = 同步基线（base=0）」的快照语义。
 *
 * `pending()` 语义（R3 §6.3）：返回已武装未到期计数；advanceBy 触发回调前先从登记表
 * 移除该计时器（已触发已删除不计）。
 */
export function createDeterministicClock(): ProbeClock {
  let now = 0
  let nextId = 0
  const timers = new Map<number, { at: number, callback: () => void }>()
  const clock: ProbeClock = {
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
