import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-timer'
import { requireClock } from '@nomicore/clock'
import { provideNomicorePersistence, type DocPersistence, type PersistenceScheduler } from './contract.js'

/**
 * Cordis wiring leaf for the persistence adapters (module-graph DAG: this
 * module imports `context`-level dependencies only; `lifecycle.ts` never
 * imports it).
 *
 * ⚠️ 宿主接线契约（R1/#15）——timer fiber 生命周期必须 ⊇ persistence adapter
 * 生命周期：宿主必须**先装 timer、后停 persistence**（本任务 DSH profile 的
 * clock → timer → persistence 装配序与 adapter → fiber dispose 序即满足）。
 * 若宿主先拆 timer fiber 再使用 persistence adapter，`scheduleRetry` →
 * `ctx.timeout` 会在 native 回调续体里抛 INACTIVE_EFFECT（uncaught）——该顺序
 * 是宿主接线契约，不在 persistence 内部防御（adapter `closed` 标志只覆盖自身
 * dispose 路径）。
 */

/**
 * 插件启动强依赖断言（AC2）：在 provide service **之前**同步执行；缺失任一
 * 依赖即 loud throw（不 fallback、不 console.error 后继续）。检验经
 * `ctx.get(name)` 安全探针（cordis 已核实：缺失返回 `undefined`、从不
 * throw），文案稳定、单句、含 service 名与安装指引。
 */
export function assertPersistenceHostDependencies(ctx: Context): void {
  requireClock(ctx) // 缺失 → throw 'required Cordis service "clock" is unavailable'（@nomicore/clock 现有文案）
  const timer = ctx.get('timer') as { timeout?: unknown } | undefined
  if (timer === undefined || typeof timer.timeout !== 'function') {
    throw new Error(
      'required Cordis service "timer" is unavailable: '
      + 'install @deepseek-ai/cordis-plugin-timer before the persistence plugin',
    )
  }
}

/**
 * 派生 plugin 路径的唯一 PersistenceScheduler 来源（AC3）：内部先执行
 * `assertPersistenceHostDependencies`（订单保证：断言失败时任何 service
 * 都未提供），再桥接 `ctx.timeout`。
 *
 * `ctx.timeout(cb, ms)` 返回幂等 disposer（timer 插件源码已核实：effect
 * wrapper 单次守卫；timer 触发时先 `dispose()` 再 `callback()`），故
 * disposer 即 handle——`clearTimeout(handle) === handle()`：触发前调用取消
 * 底层 native timer，触发后调用是无害清理，与 `clearTimeout(handle)` 语义
 * 精确对齐。
 */
export function createCordisPersistenceScheduler(ctx: Context): PersistenceScheduler {
  assertPersistenceHostDependencies(ctx)
  return {
    setTimeout: (callback, delayMs) => ctx.timeout(callback, delayMs),
    clearTimeout: (handle) => { (handle as () => void)() },
  }
}

/**
 * 绑定 persistence adapter 的 Cordis 生命周期（rev1 问题 3，ADR-0006 :86 宿主逆序
 * 停止职责 + ADR-0009 :103 Plugin dispose 有序 disposer）：service 撤销与 adapter
 * dispose 纳入同一个**有序** effect——
 *
 *   卸载序（effect 本地 disposables 逆序串行执行）：
 *     drainStep（先执行）：await revoke() —— 撤服务（调用路径，设计 §5#5①：revoke 的
 *                          类型签名是 `() => void`（provideNomicorePersistence 的返回
 *                          类型），运行时实为 cordis effect wrapper——先调用、后 await
 *                          其返回值：wrapper 调用体在未启动态 finalizeDisposal 启动处置
 *                          任务并返回 inFlight promise，await 等的是该返回值（全程
 *                          等待）；「delete store → notify → await 全部依赖 fiber
 *                          卸载完成」是该处置任务**自身的执行内容**，不是 await
 *                          revoke() 直接执行的次序；且完整 join 语义只在 runDisposable
 *                          路径（§5#5，effectInertia 恒返 inFlight）——join 完整性由
 *                          yield re-parent + 串行链保证，不依赖裸 await 的 join）；
 *                          finally 兜底 await adapter.dispose()（撤销链异常也不漏资源
 *                          释放）；
 *     revoke（后执行）  ：runDisposable 经 effectInertia join 到同一处置任务（no-op）。
 *
 * 由此 adapter dispose（文件句柄/后台任务/Y.Doc 缓存释放）严格晚于
 * nomicorePersistence 全部依赖方（如 NamespaceRegistry plugin：其 shutdown 排空
 * 期间的 handle.release / saveDoc 的 entry 断言全程面对未 disposed 的 adapter
 * ——「close 撞已销毁 handle」聚合失败被消灭）——AC11「先于 Persistence dispose」
 * 从 fiber 级提升为 adapter 级真实保证。
 *
 * ⚠️ 宿主接线契约（R5′，生产 timer 限定）：本 fiber 处于 UNLOADING 的 drain 窗口内，
 * 经 `ctx.timeout` 的**新 flush/retry timer 武装**会抛 CordisError('INACTIVE_EFFECT')
 * （真实 TimerService 语义：副作用绑定调用方 fiber，fiber.effect 对 UNLOADING 态
 * 显式 throw）→ 窗口内到达 saveDoc 的在途写收到响亮 rejection（交付写调用方）。
 * 需要写排空完整落盘的宿主应先 settle 依赖方（await registry shutdown/fiber 卸载）
 * 再拆 persistence fiber。fake-timer 测试 seam（testing.ts）不经 ctx.effect，对该
 * 窗口结构性失明。详见设计 rev1 §8 R5′。
 *
 * 直接调用 adapter.dispose() 的宿主编排（不经 fiber 卸载）不受影响：dispose 语义
 * 与幂等性零变化（宿主职责，ADR-0006 :86）。
 */
export function bindPersistenceAdapterLifecycle(
  ctx: Context,
  adapter: DocPersistence & { dispose(): Promise<void> },
  label: string,
): void {
  ctx.effect(function* () {
    // yield 收集序 [revoke, drainStep] → 逆序执行 [drainStep, revoke]。
    // yield revoke 同时把嵌套 provide wrapper 从 fiber 级并发清单 re-parent 进本
    // 有序表——否则它与 drainStep 在 fiber _unload 的 Promise.all 中并发（round 1
    // 缺陷根源，§5#1/#6）。
    const revoke = provideNomicorePersistence(ctx, adapter)
    yield revoke
    yield async () => {
      try {
        await revoke() // 撤服务 → 级联依赖 fiber 卸载并 settle
        // （await revoke() = 先调用后 await 返回值：直接调用体在未启动态
        //  finalizeDisposal 启动 disposal 并返回 inFlight——await 等的是该返回值，
        //  全程等待；归因区分见设计 §5#5）
      } finally {
        await adapter.dispose() // 依赖方 settle 后才释放 adapter 资源；revoke 异常亦不漏
      }
    }
  }, label)
}
