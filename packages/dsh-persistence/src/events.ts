import type { PersistenceSchedule, PersistenceTimer } from '@nomicore/persistence'

/**
 * 探针事件判别联合（与任务简报 §2 契约面逐字对齐）。
 *
 * 全部成员携带虚拟时钟刻度 `t` 与 `owner`/`docId`；调度类事件（dirty/flush/
 * release/evict/degraded/save-degraded/recovered）在记录渲染时只呈现 docId，
 * create/load/observed/duplicate/meta-mismatch 呈现 owner/docId 前缀（§8 规范）。
 */
interface ProbeEventBase {
  readonly t: number
  readonly owner: string
  readonly docId: string
}

export type ProbeEvent =
  | ProbeEventBase & { readonly type: 'create'; readonly handle: string; readonly docInstance: string }
  | ProbeEventBase & { readonly type: 'load'; readonly handle: string; readonly docInstance: string }
  | ProbeEventBase & { readonly type: 'dirty'; readonly generation: number }
  | ProbeEventBase & { readonly type: 'flush'; readonly generation: number; readonly ok: boolean }
  | ProbeEventBase & { readonly type: 'release'; readonly refs: number }
  | ProbeEventBase & { readonly type: 'evict' }
  | ProbeEventBase & {
      readonly type: 'observed'
      readonly metaDocId: string
      readonly entries: readonly string[]
      readonly rootKeys: readonly string[]
    }
  | ProbeEventBase & { readonly type: 'degraded' }
  | ProbeEventBase & { readonly type: 'save-degraded' }
  | ProbeEventBase & { readonly type: 'recovered' }
  | ProbeEventBase & { readonly type: 'duplicate'; readonly code: string }
  | ProbeEventBase & { readonly type: 'meta-mismatch'; readonly expected: string; readonly actual: string }

export interface ProbeRunOptions {
  readonly adapter: 'memory' | 'file'
  readonly rootDir?: string
  readonly schedule?: Partial<PersistenceSchedule>
  readonly timer?: PersistenceTimer
  readonly failFirstFlushes?: number
}

export interface ProbeRunResult {
  readonly ok: boolean
  readonly events: readonly ProbeEvent[]
  readonly record: string
  /** 封闭词表 reason（§6.2）；仅 ok=false 时存在，永不携带环境痕迹。 */
  readonly failureReason?: string
}
