/**
 * strict reader 读会话与短期可续租租约（issue #154 / SA2 §2.3/§4.3/§5 INV-4/9）。
 *
 * 纯 TS（零 fs）：枚举经 reader 内部导出 `enumerateSegmentGroups`（与 reader/sweep
 * 同源——防双份漂移）；路径派生经 paths.ts（`node:path` 绑定面已声明）。
 *
 * 契约要点：
 * - 租约注册表**进程内**按 `(rootDir, namespaceId)` 分区共享——正确性依赖 ADR 0012
 *   「File adapter 沿用单进程独占根目录的部署约束，不实现跨进程锁」（INV-9）。
 * - 租约是 retention 的**劝告锁**，不是数据持久性承诺：过期窗口内数据可能已被裁剪；
 *   `renew() === true` 不保证快照仍完整（调用方仍须容忍 ENOENT/裁剪）。
 * - 过期条目惰性判定（`leasedUntil > now` 才算活跃）；**过期租约永不阻塞删除**（INV-4）。
 * - namespace 逻辑删除释放整个分区：全部会话置 closed、条目清除（INV-12）。
 */
import { isSafeNamespaceId, isSafeStreamId, streamLayoutPaths } from './paths.js'
import { enumerateSegmentGroups } from './reader.js'

/** 会话请求（SA2 §2.3）。 */
export interface DiagnosticReadSessionRequest {
  rootDir: string
  namespaceId: string
  streamId: string
  /** 单次租期 ms；默认 15_000；须 ≥1 的 safe integer。 */
  ttlMs?: number | undefined
  /** 会话最长可续租总时长（自 open 起）；默认 null = 显式续租模式（ADR 允许
   *  「长期 reader 必须有最大 lease 时长**或**显式续租」——取后者为默认）。 */
  maxLifetimeMs?: number | null | undefined
  clock?: { now(): number } | undefined
}

/** 读会话（快照租用：租约覆盖 open 时刻枚举的整个 segment 集，升序）。 */
export interface DiagnosticReadSession {
  readonly rootDir: string
  readonly namespaceId: string
  readonly streamId: string
  /** open 时刻枚举的 segment 快照（升序；§4.3 快照语义）。 */
  readonly segments: readonly string[]
  /** 当前租期到期时刻（epoch ms；close 后无意义）。 */
  readonly leasedUntil: number
  readonly closed: boolean
  /** 续租：已 close 或超出 maxLifetimeMs → false；否则全员续 ttl 并 true。 */
  renew(): boolean
  /** 立即释放全部租约（幂等）。 */
  close(): void
}

/** 注册表条目（leasedUntil 随 renew 更新——sweep 惰性读取）。 */
interface LeaseEntry {
  leasedUntil: number
  owner: DiagnosticReadSessionImpl
}

/** nsKey = rootDir + '\0' + namespaceId（跨实例共享 = INV-9 正确性要求）。 */
function nsKeyOf(rootDir: string, namespaceId: string): string {
  return `${rootDir}\u0000${namespaceId}`
}

/** leaseKey = streamId + '\0' + segment。 */
function leaseKeyOf(streamId: string, segment: string): string {
  return `${streamId}\u0000${segment}`
}

const registry = new Map<string, Map<string, LeaseEntry[]>>()
const sessionsByNs = new Map<string, Set<DiagnosticReadSessionImpl>>()

/** 会话实现（对象形状经接口公开；closed/leasedUntil 为运行时可变读视图）。 */
class DiagnosticReadSessionImpl implements DiagnosticReadSession {
  readonly rootDir: string
  readonly namespaceId: string
  readonly streamId: string
  readonly segments: readonly string[]
  private readonly openAt: number
  private readonly ttlMs: number
  private readonly maxLifetimeMs: number | null
  private readonly clock: { now(): number }
  private leasedUntilValue: number
  private closedValue = false

  constructor(req: {
    rootDir: string
    namespaceId: string
    streamId: string
    segments: readonly string[]
    openAt: number
    leasedUntil: number
    ttlMs: number
    maxLifetimeMs: number | null
    clock: { now(): number }
  }) {
    this.rootDir = req.rootDir
    this.namespaceId = req.namespaceId
    this.streamId = req.streamId
    this.segments = req.segments
    this.openAt = req.openAt
    this.leasedUntilValue = req.leasedUntil
    this.ttlMs = req.ttlMs
    this.maxLifetimeMs = req.maxLifetimeMs
    this.clock = req.clock
  }

  get leasedUntil(): number {
    return this.leasedUntilValue
  }

  get closed(): boolean {
    return this.closedValue
  }

  renew(): boolean {
    if (this.closedValue) return false
    const now = this.clock.now()
    if (this.maxLifetimeMs !== null && now > this.openAt + this.maxLifetimeMs) return false
    const next = this.leasedUntilValue + this.ttlMs
    // 解释性裁决（SA6 报告 §4.1）：越界即拒——续租后租期不得超出 open 起
    // maxLifetimeMs 总时长（与「当前时刻已超」互斥覆盖）。
    if (this.maxLifetimeMs !== null && next > this.openAt + this.maxLifetimeMs) return false
    this.leasedUntilValue = next
    // 同步注册表条目（sweep 惰性读取 leasedUntil——续租必须生效）
    const map = registry.get(nsKeyOf(this.rootDir, this.namespaceId))
    if (map !== undefined) {
      for (const segment of this.segments) {
        const list = map.get(leaseKeyOf(this.streamId, segment))
        if (list === undefined) continue
        for (const entry of list) {
          if (entry.owner === this) entry.leasedUntil = next
        }
      }
    }
    return true
  }

  close(): void {
    if (this.closedValue) return
    this.closedValue = true
    removeEntriesOf(this)
  }
}

/** 移除某个会话的全部注册表条目（close 用；nsKey 分区随空清）。 */
function removeEntriesOf(session: DiagnosticReadSessionImpl): void {
  const key = nsKeyOf(session.rootDir, session.namespaceId)
  const map = registry.get(key)
  if (map !== undefined) {
    for (const segment of session.segments) {
      const lk = leaseKeyOf(session.streamId, segment)
      const list = map.get(lk)
      if (list === undefined) continue
      const remaining = list.filter((entry) => entry.owner !== session)
      if (remaining.length === 0) map.delete(lk)
      else map.set(lk, remaining)
    }
    if (map.size === 0) registry.delete(key)
  }
  sessionsByNs.get(key)?.delete(session)
}

/** 打开会话：枚举快照（与 reader/sweep 同源；`.deleting` 组整体剔除）→ 全员注册租约。 */
export function openDiagnosticReadSession(req: DiagnosticReadSessionRequest): DiagnosticReadSession {
  if (!isSafeNamespaceId(req.namespaceId) || !isSafeStreamId(req.streamId)) {
    throw new Error('openDiagnosticReadSession: invalid namespaceId/streamId')
  }
  const ttlMs = req.ttlMs ?? 15_000
  if (typeof ttlMs !== 'number' || !Number.isSafeInteger(ttlMs) || ttlMs < 1) {
    throw new Error('openDiagnosticReadSession: ttlMs must be a safe integer >= 1')
  }
  const maxLifetimeMs = req.maxLifetimeMs === undefined || req.maxLifetimeMs === null ? null : req.maxLifetimeMs
  if (
    maxLifetimeMs !== null &&
    (typeof maxLifetimeMs !== 'number' || !Number.isSafeInteger(maxLifetimeMs) || maxLifetimeMs < 1)
  ) {
    throw new Error('openDiagnosticReadSession: maxLifetimeMs must be a safe integer >= 1 or null')
  }
  const clock = req.clock ?? { now: () => Date.now() }
  const paths = streamLayoutPaths(req.rootDir, req.namespaceId, req.streamId)
  let segments: string[] = []
  try {
    segments = [...enumerateSegmentGroups(paths.segmentsDir).live]
  } catch {
    segments = [] // segments/ 缺失/不可读 → 空快照（无租约——不保护任何组）
  }
  const openAt = clock.now()
  const leasedUntil = Math.min(openAt + ttlMs, maxLifetimeMs === null ? Infinity : openAt + maxLifetimeMs)
  const session = new DiagnosticReadSessionImpl({
    rootDir: req.rootDir,
    namespaceId: req.namespaceId,
    streamId: req.streamId,
    segments,
    openAt,
    leasedUntil,
    ttlMs,
    maxLifetimeMs,
    clock,
  })
  const key = nsKeyOf(req.rootDir, req.namespaceId)
  let map = registry.get(key)
  if (map === undefined) {
    map = new Map()
    registry.set(key, map)
  }
  for (const segment of segments) {
    const lk = leaseKeyOf(req.streamId, segment)
    const list = map.get(lk)
    const entry: LeaseEntry = { leasedUntil, owner: session }
    if (list === undefined) map.set(lk, [entry])
    else list.push(entry)
  }
  let nsSessions = sessionsByNs.get(key)
  if (nsSessions === undefined) {
    nsSessions = new Set()
    sessionsByNs.set(key, nsSessions)
  }
  nsSessions.add(session)
  return session
}

/** sweep 查询：任意未过期条目覆盖 (nsKey, streamId, segment) ⇒ 该组 leased（过期视同无租约）。 */
export function segmentLeased(rootDir: string, namespaceId: string, streamId: string, segment: string, now: number): boolean {
  const list = registry.get(nsKeyOf(rootDir, namespaceId))?.get(leaseKeyOf(streamId, segment))
  if (list === undefined) return false
  return list.some((entry) => entry.leasedUntil > now)
}

/** namespace 逻辑删除：释放整个分区（全部会话置 closed、条目清除——INV-12）。 */
export function releaseNamespaceLeasePartition(rootDir: string, namespaceId: string): void {
  const key = nsKeyOf(rootDir, namespaceId)
  const sessions = sessionsByNs.get(key)
  if (sessions !== undefined) {
    for (const session of [...sessions]) session.close()
  }
  registry.delete(key)
  sessionsByNs.delete(key)
}
