/**
 * 测试显式注入的真实计时器 PersistenceScheduler（issue #107 迁移裁决）。
 *
 * 背景：issue #107 后 @nomicore/persistence 不再提供默认 system timer
 * （AC4——旧默认计时器接口的 now/setTimeout/clearTimeout 默认实现已删除，
 * `MemoryPersistenceOptions`/`FilePersistenceOptions` 的 `scheduler: PersistenceScheduler`
 * 成为必填注入项，host 负责从 `ctx.timeout` 派生；adapter 永不回退到宿主全局 timer）。
 *
 * 本模块是从测试侧显式注入的**受控替身**：无状态、逐秒等价于 persistence 旧默认
 * system timer 实现（全局 setTimeout/clearTimeout 直通，无虚拟调度、无 fake
 * timer、无时间加速）——仅供本目录遵循真实 sleep 纪律（如 schedule
 * { debounceMs: 5, maxDirtyMs: 60 } + sleep(100) 等）的测试在构造点注入。
 *
 * 注意：本文件名不匹配 vitest include 的 `*.test.ts`/`*.test-d.ts` 模式，
 * 不被当作测试文件收集；仅作为测试助手模块被 import。
 */
import type { PersistenceScheduler } from '@nomicore/persistence';

/** 无状态真实计时器调度器：直通宿主全局 timer（与旧默认行为逐秒等价）。 */
export const realPersistenceScheduler: PersistenceScheduler = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) =>
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};
