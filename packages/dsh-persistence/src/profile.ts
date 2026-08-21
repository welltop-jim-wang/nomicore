import { Context } from '@deepseek-ai/cordis'
import {
  createFilePersistencePlugin,
  createMemoryPersistencePlugin,
  FilePersistence,
  MemoryPersistence,
  type DocPersistence,
  type PersistenceSchedule,
  type PersistenceTimer,
} from '@nomicore/persistence'

/** DSH profile 的 dev/test 注入缝形状（简报 §2）；profile 展平透传给 MemoryPersistence 选项。 */
export interface DshPersistenceMemoryIo {
  readonly writeSnapshot?: (key: string, snapshot: Uint8Array, signal: AbortSignal) => Promise<void> | void
  readonly readSnapshot?: (key: string, signal: AbortSignal) => Promise<Uint8Array | undefined> | Uint8Array | undefined
}

export interface DshPersistenceProfileOptions {
  readonly adapter: 'memory' | 'file'
  /** 仅 adapter='file' 必需；memory + rootDir 属配置冲突，loud reject（决策 E）。 */
  readonly rootDir?: string
  readonly schedule?: Partial<PersistenceSchedule>
  readonly timer?: PersistenceTimer
  /** 仅 adapter='memory' 合法；file + memoryIo 属配置冲突，loud reject（决策 E）。 */
  readonly memoryIo?: DshPersistenceMemoryIo
}

export interface DshPersistenceProfile {
  readonly ctx: Context
  /** 与 `ctx.get('docPersistence')` 恒等的真实 adapter 实例（决策 A）。 */
  readonly persistence: DocPersistence
  getStatus(): 'ready' | 'persistence-degraded' | 'disposed'
  dispose(): Promise<void>
}

/**
 * DSH 开发宿主装配（决策 A/E/F）：唯一分支点是选插件工厂；`ctx.effect` 注册的
 * service 清理 + dispose 由 profile 显式按序执行（adapter 先、Cordis fiber 后，幂等）。
 */
export function createDshPersistenceProfile(options: DshPersistenceProfileOptions): DshPersistenceProfile {
  let apply: (ctx: Context) => void
  let instance: MemoryPersistence | FilePersistence | undefined
  switch (options.adapter) {
    case 'memory': {
      if (options.rootDir !== undefined) {
        throw new TypeError('rootDir is only valid with adapter "file"')
      }
      const plugin = createMemoryPersistencePlugin({
        ...(options.schedule !== undefined ? { schedule: options.schedule } : {}),
        ...(options.timer !== undefined ? { timer: options.timer } : {}),
        // R1 勘误（§7/P18）：注入缝是 MemoryPersistenceOptions 顶层字段，必须展平。
        ...(options.memoryIo?.writeSnapshot !== undefined ? { writeSnapshot: options.memoryIo.writeSnapshot } : {}),
        ...(options.memoryIo?.readSnapshot !== undefined ? { readSnapshot: options.memoryIo.readSnapshot } : {}),
      })
      apply = (ctx) => { plugin.apply(ctx); instance = plugin.instance }
      break
    }
    case 'file': {
      if (options.memoryIo !== undefined) {
        throw new TypeError('memoryIo is only valid with adapter "memory"')
      }
      if (typeof options.rootDir !== 'string' || options.rootDir.length === 0) {
        throw new TypeError('adapter "file" requires a non-empty rootDir')
      }
      const plugin = createFilePersistencePlugin({
        rootDir: options.rootDir,
        ...(options.schedule !== undefined ? { schedule: options.schedule } : {}),
        ...(options.timer !== undefined ? { timer: options.timer } : {}),
      })
      apply = (ctx) => { plugin.apply(ctx); instance = plugin.instance }
      break
    }
    default: {
      const adapter = (options as { adapter: unknown }).adapter
      throw new TypeError(`unknown adapter ${JSON.stringify(adapter)}: expected "memory" or "file"`)
    }
  }
  const ctx = new Context()
  apply(ctx)
  const persistence = instance
  if (persistence === undefined) {
    throw new Error('createDshPersistenceProfile: adapter plugin produced no persistence instance')
  }
  let disposed = false
  return {
    ctx,
    persistence,
    getStatus: () => persistence.getStatus(),
    async dispose() {
      if (disposed) return
      disposed = true
      // ① adapter 先：settle 全部 in-flight I/O、清三计时器、销毁 live Y.Doc；
      // ② Cordis fiber 后：effect cleanup（再次 dispose adapter，幂等）→ service 注销。
      await persistence.dispose()
      await ctx.fiber.dispose()
    },
  }
}
