import type { ProbeEvent } from './events.js'

export interface ProbeRecordMeta {
  readonly adapter: 'memory' | 'file'
  readonly schedule: { readonly debounceMs: number; readonly maxDirtyMs: number }
  readonly failFirstFlushes: number
  readonly ok: boolean
  /** 封闭词表 reason（§6.2）；仅 ok=false 时存在。 */
  readonly failureReason?: string
}

/**
 * 记录确定性硬规范（§8）：每事件一行、行序 = 事件序、`t` 为虚拟刻度；
 * 禁止墙钟时间戳 / rootDir 绝对路径 / pid / 随机数。entries 以规范序
 * SCHEMA,META,ROOT 渲染（多余条目按字典序追加），rootKeys 字典序。
 */
export function renderProbeRecord(events: readonly ProbeEvent[], meta: ProbeRecordMeta): string {
  const lines: string[] = [
    '# dsh persistence probe',
    `# adapter=${meta.adapter} schedule=debounceMs:${meta.schedule.debounceMs},maxDirtyMs:${meta.schedule.maxDirtyMs} failFirstFlushes:${meta.failFirstFlushes}`,
  ]
  for (const event of events) lines.push(renderEvent(event))
  if (meta.failureReason !== undefined) lines.push(`probe-failed ${meta.failureReason}`)
  lines.push(`probe ok=${meta.ok ? 'true' : 'false'} events=${events.length}`)
  return `${lines.join('\n')}\n`
}

function renderEvent(event: ProbeEvent): string {
  switch (event.type) {
    case 'create':
      return `create ${event.owner}/${event.docId} handle=${event.handle} instance=${event.docInstance} t=${event.t}`
    case 'load':
      return `load ${event.owner}/${event.docId} handle=${event.handle} instance=${event.docInstance} t=${event.t}`
    case 'dirty':
      return `dirty ${event.docId} generation=${event.generation} t=${event.t}`
    case 'flush':
      return `flush ${event.docId} generation=${event.generation} ok=${event.ok ? 'true' : 'false'} t=${event.t}`
    case 'release':
      return `release ${event.docId} refs=${event.refs} t=${event.t}`
    case 'evict':
      return `evict ${event.docId} t=${event.t}`
    case 'observed':
      return `observed ${event.owner}/${event.docId} entries=${event.entries.join(',')} metaDocId=${event.metaDocId} rootKeys=${event.rootKeys.join(',')} t=${event.t}`
    case 'degraded':
      return `degraded ${event.docId} t=${event.t}`
    case 'save-degraded':
      return `save-degraded ${event.docId} t=${event.t}`
    case 'recovered':
      return `recovered ${event.docId} t=${event.t}`
    case 'duplicate':
      return `duplicate ${event.owner}/${event.docId} code=${event.code} t=${event.t}`
    case 'meta-mismatch':
      return `meta-mismatch ${event.owner}/${event.docId} expected=${event.expected} actual=${event.actual} t=${event.t}`
  }
}
