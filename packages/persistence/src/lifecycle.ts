import * as Y from 'yjs'
import {
  DocArchiveActiveHandleError,
  DocArchiveDuplicateError,
  DocArchiveFatalError,
  DocArchiveIdentityError,
  DocArchiveOperationalError,
  DocCreateFatalError,
  DocCreateOperationalError,
  DocDuplicateError,
  DocImportIdentityError,
  DocLoadOperationalError,
  DocPersistedIdentityProbeCorruptError,
  DocPersistedIdentityProbeFatalError,
  DocPersistedIdentityProbeOperationalError,
  resolvePersistenceSchedule,
  type CheckedReplicationIdentity,
  type DocHandle,
  type DocHandleStatus,
  type PersistedIdentityProbeResult,
  type PersistenceSchedule,
  type PersistenceScheduler,
  type ReplicationIdentityRef,
  type User,
} from './contract.js'

/**
 * The adapter I/O seam shared by every persistence adapter.
 *
 * Observable-channel axiom (design §3.1): `committed` is judged against the
 * store this instance's READ path trusts.
 *
 * - `write` resolve ⟺ the trusted store already holds this snapshot — the
 *   commit segment has fully executed (Memory: flat-hook side effects + the
 *   private mirror set; File: temp→rename completed). A write must never
 *   resolve without having executed its commit segment (no silent no-op
 *   resolve).
 * - `write` reject ⟹ this write did not change the trusted store. Abort
 *   semantics are carried by an ENTRY gate: once `signal.aborted` is set, the
 *   write must not enter its pipeline at all (Memory: entry `throwIfAborted`
 *   before any flat hook; File: entry + after-mkdir + after-writeFile gates,
 *   all before rename). A write that has passed the entry gate runs to
 *   completion (hook side effects + commit segment; File's rename, once
 *   executed, completes) — completion ⇒ resolve ⇒ committed.
 * - Seam-violation definition (an adapter bug the lifecycle declares but does
 *   not defend against): ① a write that rejects after partially committing;
 *   ② a synchronous throw from `read`/`write` — PersistenceIO methods must
 *   NEVER throw synchronously: every failure goes through the returned
 *   promise's rejection.
 * - `read` must honor `signal` the same way: abort ⇒ rejection through the
 *   returned promise, never a fabricated verdict, never a synchronous throw.
 */
export interface PersistenceIO {
  read(key: string, signal: AbortSignal): Promise<Uint8Array | undefined>
  write(key: string, snapshot: Uint8Array, signal: AbortSignal): Promise<void>
  /**
   * Phase 5 归档重定位写：把 snapshot 持久放入该 key 的受控归档位（File：
   * 归档区 mkdir→writeFile tmp→rename；Memory：独立 archiveSnapshots 分区——
   * 不经 writeSnapshot hook，§4.10.1）。公理与 write 同款：resolve ⟺ 归档区
   * 已持有该字节；reject ⟹ 归档区不变；禁同步 throw。**不触碰主键存储**。
   * Optional（§4.4）：Memory/File 恒提供；wrapIo 包装方缺席时 lifecycle 归档
   * 路径 loud 拒绝（契约违约通道，非四分类）。
   */
  writeArchive?(key: string, snapshot: Uint8Array, signal: AbortSignal): Promise<void>
  /**
   * Phase 5 主键移除（归档重定位第二段）：移除该 key 的主 committed snapshot
   * （File：rm .snapshot（ENOENT 容忍）；Memory：deleteSnapshot hook + mirror）。
   * resolve ⟺ 主键此后缺席；reject ⟹ 移除未完成（状态可能两者之一——由
   * archiveDoc 归入 committed:true fatal，重试收敛，§4.5.5）。不触碰归档区。
   */
  remove?(key: string, signal: AbortSignal): Promise<void>
}

export type PersistenceStatus = 'ready' | 'persistence-degraded' | 'disposed'

interface LiveEntry {
  readonly key: string
  readonly owner: User
  readonly docId: string
  readonly doc: Y.Doc
  readonly handles: Set<PersistenceHandle>
  /** Phase 5 归档 settle 排空通知面（§4.5.2）：仅 settleEntryForArchive 填充；
   *  非归档路径恒空 ⟹ flush finally / dispose 的 splice no-op、零观测差异。 */
  readonly archiveWaiters: Array<() => void>
  degraded: boolean
  dirtyGeneration: number
  savedGeneration: number
  flushing: boolean
  retryDelayMs: number
  debounceTimer?: unknown
  maxDirtyTimer?: unknown
  retryTimer?: unknown
}

interface StoredSnapshot { readonly snapshot: Uint8Array }

/** A store-read error carried through the driver as a value. */
class ReadError {
  constructor(readonly err: unknown) {}
}

/**
 * One in-flight store read. Exactly one driver settles `completion` (through
 * the deferred's exactly-once mutual exclusion), unless a winning createDoc
 * adopts the read first in its completion block.
 */
interface ReadTicket {
  readonly startedBy: 'load' | 'create'
  readonly rawPromise: Promise<Uint8Array | undefined>
  readonly completion: Promise<LiveEntry | null>
  readonly settleOnce: (value: LiveEntry | null) => void
  readonly rejectOnce: (err: unknown) => void
}

interface KeyClaim {
  /** Settles exactly once on both outcomes of the create/archive operation (U8). */
  promise: Promise<void>
}

type Cell =
  | { state: 'reading'; read: ReadTicket }
  | { state: 'creating'; claim: KeyClaim }
  | { state: 'live'; entry: LiveEntry }
  | { state: 'archiving'; claim: KeyClaim } // Phase 5：归档排他 claim（settle 后置位，commit 段持守）

const HANDLE_OWNER = new WeakMap<PersistenceHandle, PersistenceLifecycle>()
const RELEASE = new WeakMap<PersistenceLifecycle, (handle: PersistenceHandle) => void>()

class PersistenceHandle implements DocHandle {
  private released = false

  constructor(
    private readonly persistence: PersistenceLifecycle,
    public readonly owner: User,
    public readonly docId: string,
    public readonly doc: Y.Doc,
    readonly entryKey: string,
  ) {
    HANDLE_OWNER.set(this, persistence)
  }

  async release(): Promise<void> {
    if (this.released) return
    this.released = true
    RELEASE.get(this.persistence)!(this)
  }

  get isReleased(): boolean { return this.released }

  getStatus(): DocHandleStatus {
    return this.persistence.handleStatusOf(this)
  }
}

/**
 * The per-key coordinated persistence lifecycle shared by all adapters.
 *
 * Cells coordinate create/load for one `(owner.userId, docId)` key; the flush
 * scheduler (debounce/max-dirty/retry/generation single-flight), eviction,
 * epoch/dispose and handle-lease identity all live here so that adapters never
 * copy the state machine.
 */
export class PersistenceLifecycle {
  private readonly schedule: PersistenceSchedule
  private readonly scheduler: PersistenceScheduler
  private readonly cells = new Map<string, Cell>()
  private readonly inFlight = new Set<Promise<unknown>>()
  private readonly abortController = new AbortController()
  private closed = false
  private epoch = 0

  constructor(
    private readonly io: PersistenceIO,
    options: { schedule?: Partial<PersistenceSchedule> | undefined; scheduler: PersistenceScheduler },
  ) {
    this.schedule = resolvePersistenceSchedule(options.schedule)
    this.scheduler = options.scheduler
    RELEASE.set(this, (handle) => this.releaseHandle(handle))
  }

  getStatus(): PersistenceStatus {
    if (this.closed) return 'disposed'
    for (const cell of this.cells.values()) {
      if (cell.state === 'live' && cell.entry.degraded) return 'persistence-degraded'
    }
    return 'ready'
  }

  /** Entry-level status resolution for a handle this lifecycle issued (issue #79). */
  handleStatusOf(handle: PersistenceHandle): DocHandleStatus {
    if (this.closed) return 'disposed'
    if (handle.isReleased) return 'released'
    const cell = this.cells.get(handle.entryKey)
    if (cell?.state !== 'live' || !cell.entry.handles.has(handle)) {
      // Lease invariant: an unreleased handle on an open lifecycle always has
      // a live entry that still counts it — maybeEvict requires
      // handles.size === 0, and dispose is caught by the closed check above.
      // Reaching this branch is an integrity bug: loud, never a silent
      // fallback status.
      throw new Error(`persistence integrity: unreleased handle has no live entry (${handle.entryKey})`)
    }
    return cell.entry.degraded ? 'persistence-degraded' : 'ready'
  }

  async loadDoc(owner: User, docId: string): Promise<DocHandle | null> {
    this.assertReadable()
    const key = toKey(owner, docId)
    const cached = this.cells.get(key)
    if (cached?.state === 'live') return this.issueHandle(cached.entry)
    return this.loadSlowPath(owner, docId, key)
  }

  async createDoc(owner: User, docId: string, doc: Y.Doc): Promise<DocHandle> {
    return this.exclusiveCreate(owner, docId, doc, 'create')
  }

  /** Phase 5 受控复制导入（§4.3）：语义 = createDoc 同管线（排他 claim / 提交点 /
   * handle.doc === doc / 失败不接管 doc）；唯一差异 = META.docId 违约以
   * DocImportIdentityError 稳定分类（createDoc 保持既有 bare error，零回归）。 */
  async importDoc(owner: User, docId: string, doc: Y.Doc): Promise<DocHandle> {
    return this.exclusiveCreate(owner, docId, doc, 'import')
  }

  /**
   * createDoc / importDoc 的共享 per-key 排他管线（§4.3，D-3）：claim 环 +
   * 提交段逐字节同源——两 Adapter 不得复制状态机（ADR 0006:157-159）。唯一差异位 =
   * 身份校验单点分叉（均先于 claim、先于任何 io 访问——IMP「零持久化写入」锚）：
   *   op==='create' → validateCreateDoc（既有 bare Error，lifecycle.ts:456-461，零回归）
   *   op==='import' → validateImportDoc（META.docId !== docId → DocImportIdentityError）
   */
  private async exclusiveCreate(
    owner: User,
    docId: string,
    doc: Y.Doc,
    op: 'create' | 'import',
  ): Promise<DocHandle> {
    this.assertWritable()
    if (op === 'create') this.validateCreateDoc(doc, docId)
    else this.validateImportDoc(doc, docId)
    const key = toKey(owner, docId)
    const epoch = this.epoch
    // ---- claim acquisition ----
    acquire: while (true) {
      const cell = this.cells.get(key)
      if (cell?.state === 'live') throw this.duplicateError(owner, key)
      if (cell?.state === 'creating') throw this.duplicateError(owner, key)
      if (cell?.state === 'archiving') {
        // Phase 5（§4.5.1）：归档在途 → 等待 claim 后重评估——主键已删则正常创建
        //（create/import 探读），绝不因归档在途而制造伪 duplicate。
        await cell.claim.promise
        continue acquire
      }
      if (cell?.state === 'reading') {
        // A pending load may reveal an already committed snapshot. Wait for the
        // evidence before creating: createDoc must never overwrite a document
        // merely because its existence read was late.
        let raw: Uint8Array | undefined
        try {
          raw = await cell.read.rawPromise
          this.assertCurrentEpoch(epoch)
        } catch (err) {
          // R1/R2/R3 (design §2.2): probe-read failure. On a current epoch this
          // is an operational store failure (the create wrote nothing, so
          // committed:false is authoritative); once the lifecycle ended
          // (dispose race) the same rejection is a probe-read fatal — AC6
          // forbids reporting a store-health fact the lifecycle can no longer
          // verify. The disposed-epoch Error survives as the exact `cause`.
          throw this.classifyCreateStoreFailure('probe-read', err, epoch)
        }
        if (raw !== undefined) throw this.duplicateError(owner, key)
        continue acquire
      }
      // Empty: this create must probe the store itself.
      const read = this.startReadTicket(key, owner, docId, 'create', epoch)
      let raw: Uint8Array | undefined
      try {
        raw = await read.rawPromise
        this.assertCurrentEpoch(epoch)
      } catch (err) {
        // R1/R2/R3 rationale 同上（design §2.2）：probe-read 拒绝按 epoch
        // current/stale 分类；assertCurrentEpoch 失败恒 stale ⇒ 走 fatal 分支。
        throw this.classifyCreateStoreFailure('probe-read', err, epoch)
      }
      if (raw !== undefined) throw this.duplicateError(owner, key)
      const now = this.cells.get(key)
      if (now === undefined) break acquire
      continue acquire
    }

    // ---- perform create (the cell is creating before any write) ----
    const claim: KeyClaim = { promise: undefined! }
    this.cells.set(key, { state: 'creating', claim })
    const op2 = this.track((async () => {
      try {
        // W1: pre-commit encoding — a Yjs internal failure is fatal, never
        // downgraded to operational (AC6); nothing was written, and the
        // committed:false fact is authoritative (the write path never ran).
        let snapshot: Uint8Array
        try {
          snapshot = Y.encodeStateAsUpdate(doc)
        } catch (err) {
          throw new DocCreateFatalError('snapshot-encode', err)
        }
        // W2/W3: store-level write rejection. On a current epoch this is the
        // store's own operational failure (committed:false per the
        // observable-channel axiom: reject ⟹ the trusted store unchanged);
        // once the lifecycle ended (dispose abort), the rejection means the
        // commit segment never ran — a store-write fatal, never operational.
        try {
          await this.io.write(key, snapshot, this.abortController.signal)
        } catch (err) {
          throw this.classifyCreateStoreFailure('store-write', err, epoch)
        }
        // W4/W5: the commit point is crossed the moment write resolved
        // (resolve ⟺ committed) — every failure from here on is post-commit
        // committed:true. No rollback is claimed, promised, or performed.
        try {
          this.assertCurrentEpoch(epoch)
          const entry = this.createEntry(owner, docId, key, doc)
          this.cells.set(key, { state: 'live', entry })
          return this.issueHandle(entry)
        } catch (err) {
          throw new DocCreateFatalError('post-commit', err)
        }
      } catch (err) {
        const cur = this.cells.get(key)
        if (cur?.state === 'creating' && cur.claim === claim) {
          this.cells.delete(key)
        }
        throw err
      }
    })())
    // U8: the claim settles on both outcomes through this derived wiring —
    // the try/catch above performs no claim settlement of its own.
    claim.promise = op2.then(() => undefined, () => undefined)
    return op2
  }

  /**
   * Phase 5 受身份前置条件保护的归档（§4.5，D-5）。仅在无有效 handle（且在途 dirty
   * 已排空——§4.5.2 settle 段）时执行；身份核对以持久快照复制事实为权威（单一谓词
   * §4.5.4）。成功 ⟹ 主键 snapshot 移入受控归档区、loadDoc → null、slot 可重建。
   * 拒绝经 typed rejection 四分类 + committed-aware fatal（§4.5.6 矩阵）。
   *
   * 全程 inFlight 记账（BLOCKER-1 ③）：dispose 的 allSettled 覆盖归档全程且
   * 不自等待——dispose 同步段对 archiveWaiters 的通知（通知点 2）先于 allSettled。
   */
  async archiveDoc(
    owner: User,
    docId: string,
    expectedReplicationIdentity: ReplicationIdentityRef,
  ): Promise<Readonly<{ ok: true }>> {
    this.assertWritable()
    this.assertArchiveIo() // io capability gate（§4.4 放置点表：入口同步段、track/settle
    // 之前；writeArchive/remove 任一缺席 → bare loud Error；op 体内的
    // io.writeArchive!/io.remove! 非空断言由此背书——io 构造期成型不可变）
    const key = toKey(owner, docId)
    return this.track(this.runArchiveDoc(key, owner, docId, expectedReplicationIdentity))
  }

  /**
   * R2 只读 committed-snapshot identity probe（设计 §3.3/§3.3.1）：
   * - 经 io.read 直读已提交主快照（owner 分区 key、abort signal 同款纪律）；
   * - detached 临时 Y.Doc 解码 → META.docId 校验（违约 = corrupt）→ 复制事实
   *   判据族（readPersistedReplicaFacts，判据单点同归档 verify）→ 合规返回
   *   `{kind:'found', identity}`（identity.ok 分支与判据面一致），不合规返回
   *   `{kind:'found', identity:{ok:false}}`（合法读取、无匹配 enabled 事实）；
   * - 主快照缺席 → `{kind:'missing'}`；
   * - io.read reject：epoch 仍有效 → DocPersistedIdentityProbeOperationalError
   *   （唯一普通映射）；epoch 已终结（dispose 竞态）→ fatal('read-aborted')；
   * - 生命周期入口已 disposed → fatal('lifecycle-disposed')；
   * - io.read **同步 throw**（PersistenceIO 契约违约，禁同步 throw）→
   *   fatal('adapter-violation')；
   * - **零副作用**：不建 live cell、不签 handle、不调用 saveDoc、不排空 dirty、
   *   不写/flush/archive/所有权转移——Registry reset preflight 的唯一持久真相源。
   */
  async readPersistedReplicationIdentity(
    owner: User,
    docId: string,
  ): Promise<PersistedIdentityProbeResult> {
    if (this.closed) {
      throw new DocPersistedIdentityProbeFatalError(
        'lifecycle-disposed',
        new Error('persistence lifecycle is disposed'),
      )
    }
    const key = toKey(owner, docId)
    const epoch = this.epoch
    let readPromise: Promise<Uint8Array | undefined>
    try {
      // 同步 throw（adapter 契约违背）与 Promise rejection 分流——契约违约 loud
      readPromise = this.io.read(key, this.abortController.signal)
    } catch (err) {
      throw new DocPersistedIdentityProbeFatalError('adapter-violation', err)
    }
    let bytes: Uint8Array | undefined
    try {
      bytes = await readPromise
    } catch (err) {
      throw this.isCurrent(epoch)
        ? new DocPersistedIdentityProbeOperationalError(err)
        : new DocPersistedIdentityProbeFatalError('read-aborted', err)
    }
    if (bytes === undefined) return { kind: 'missing' }

    const scratch = new Y.Doc()
    try {
      try {
        Y.applyUpdate(scratch, bytes)
      } catch (err) {
        // 字节无法解码为 Yjs → 主快照不可信（loud，绝不折叠为 mismatch/load-failed）
        throw new DocPersistedIdentityProbeCorruptError(err)
      }
      // META 载体异型（同名 Y.Text 等）→ getMap throw → CorruptError（设计 §3.3.1）
      let meta: Y.Map<unknown>
      try {
        meta = scratch.getMap('META')
      } catch (err) {
        throw new DocPersistedIdentityProbeCorruptError(err)
      }
      const metaDocId = meta.get('docId')
      if (metaDocId !== docId) {
        throw new DocPersistedIdentityProbeCorruptError(new Error('META.docId mismatch'))
      }
      const facts = readPersistedReplicaFacts(scratch)
      const identity: CheckedReplicationIdentity = facts.ok
        ? { ok: true, value: { replicationId: facts.replicationId, replicationEpoch: facts.replicationEpoch } }
        : { ok: false }
      return { kind: 'found', identity }
    } finally {
      scratch.destroy()
    }
  }

  /** 归档主体（§4.5.3）：settle 环 → claim 环 → op 体（guard-read/verify/relocate），
   *  成功与失败路径全部以 identity 守卫清理 archiving cell（INV-14/§4.5.3）。 */
  private async runArchiveDoc(
    key: string,
    owner: User,
    docId: string,
    expected: ReplicationIdentityRef,
  ): Promise<Readonly<{ ok: true }>> {
    const epoch = this.epoch
    for (;;) {
      await this.settleEntryForArchive(key)
      this.assertWritable() // dispose 竞态收口：settle 苏醒后、置 archiving cell 前重检
      // （closed ⟹ bare Error('persistence is disposed')，无 cell 可清理）
      const cell = this.cells.get(key)
      if (cell?.state === 'reading') {
        await cell.read.completion.catch(() => {})
        continue
      }
      if (cell?.state === 'creating' || cell?.state === 'archiving') {
        await cell.claim.promise
        continue
      }
      break // cell === undefined
    }
    const claim: KeyClaim = { promise: undefined! }
    this.cells.set(key, { state: 'archiving', claim })
    const op = (async () => {
      try {
        // guard-read：身份核对读经 io.read（SA6 边缘提示 2；§4.6）
        let bytes: Uint8Array | undefined
        try {
          bytes = await this.io.read(key, this.abortController.signal)
        } catch (err) {
          throw this.isCurrent(epoch)
            ? new DocArchiveOperationalError(err)
            : new DocArchiveFatalError('guard-read', err)
        }
        if (bytes === undefined) throw new DocArchiveDuplicateError()

        // verify：scratch 解码 + 单一身份谓词（字节复用——归档写回写「已核对的同一份
        // 字节」，不重编码；§4.5.4）
        const scratch = new Y.Doc()
        try {
          Y.applyUpdate(scratch, bytes)
          const metaDocId = scratch.getMap('META').get('docId')
          if (metaDocId !== docId) throw new Error('docId') // 0006:50 规则的归档侧应用
          const facts = readPersistedReplicaFacts(scratch)
          // readReplicationFacts 判据族复刻（REPLICATION_ID_PATTERN 本地副本 #2；
          // 结构守卫副本三处互引：runtime replication-write.ts / registry.ts /
          // 本文件）
          if (
            !facts.ok ||
            facts.replicationId !== expected.replicationId ||
            facts.replicationEpoch !== expected.replicationEpoch
          ) {
            throw new Error('identity')
          }
        } catch {
          // 错 id / 错 epoch / 两键缺席 / 恰一键 / undefined 值 / 格式违约 / 载体异型 /
          // META.docId 不符 / 字节损坏 → 统一 DOC_ARCHIVE_IDENTITY_MISMATCH（单一谓词裁决）
          throw new DocArchiveIdentityError()
        } finally {
          scratch.destroy()
        }

        // relocate：提交点 = 归档写 resolve（§4.5.5）
        try {
          await this.io.writeArchive!(key, bytes, this.abortController.signal)
        } catch (err) {
          throw this.isCurrent(epoch)
            ? new DocArchiveOperationalError(err)
            : new DocArchiveFatalError('relocate-write', err)
        }
        // —— 提交点跨越：归档区已持有已核对字节 ——
        try {
          await this.io.remove!(key, this.abortController.signal)
        } catch (err) {
          throw new DocArchiveFatalError('relocate-remove', err) // committed:true
        }
        // 成功路径善后（§4.5.3 identity 守卫）：cells.get(key) 仍为本 claim 才删——
        // 绝不误删后来者建立的新 cell（镜像 lifecycle.ts create 范型）。
        const done = this.cells.get(key)
        if (done?.state === 'archiving' && done.claim === claim) this.cells.delete(key)
        return Object.freeze({ ok: true as const })
      } catch (err) {
        // 失败路径善后（BLOCKER-2，§4.5.3）：逐字节镜像 createDoc 范型——identity 守卫
        // 防 ABA；rethrow 原拒绝（分类不变）。
        const cur = this.cells.get(key)
        if (cur?.state === 'archiving' && cur.claim === claim) {
          this.cells.delete(key)
        }
        throw err
      }
    })()
    claim.promise = op.then(() => undefined, () => undefined)
    return op
  }

  /**
   * Phase 5 settle 段（§4.5.2）：「无有效 handle / Runtime generation」的完整语义——
   * 零-handle-but-dirty entry 若直接归档，pending flush 会在归档后把主键 snapshot
   * 写回（复活文档 + 击穿后续 importDoc 排他），故把该窗口显式排空：
   *  - live 且 handles>0 → DocArchiveActiveHandleError（诚实拒绝，调用方释放后重试）；
   *  - 干净零-handle entry → 镜像 maybeEvict（590-596）当场驱逐；
   *  - dirty 零-handle → 强制即时 flush（跳过 debounce 定时器；retryTimer 武装 ⟺
   *    degraded 回退窗——尊重回退、被动等待、不热循环失败 store）；
   *  - 等待经 archiveWaiters 通知面解除：flush().finally 首位无条件通知（通知点 1）
   *    + dispose 同步段通知（通知点 2）。
   */
  private async settleEntryForArchive(key: string): Promise<void> {
    for (;;) {
      const cell = this.cells.get(key)
      if (cell === undefined || cell.state !== 'live') return // reading/creating/archiving 由调用环处理
      const entry = cell.entry
      if (entry.handles.size > 0) throw new DocArchiveActiveHandleError()
      if (entry.retryTimer === undefined) {
        if (!entry.flushing && entry.savedGeneration === entry.dirtyGeneration) {
          this.clearTimers(entry)
          this.cells.delete(key)
          entry.doc.destroy() // 干净零-handle entry：镜像 maybeEvict（590-596）当场驱逐
          return
        }
        if (!entry.flushing) this.startFlush(entry) // ★ 强制即时 flush——跳过 debounce 定时器
      } //（retryTimer 在武装 ⟺ degraded 回退窗——尊重回退，被动等待，不热循环失败 store）
      await new Promise<void>((resolve) => {
        entry.archiveWaiters.push(resolve)
      })
    } // flush().finally 无条件通知 waiters（含 dispose-abort 轮，§4.5.2 通知点 1/2）
  }

  /**
   * Phase 5 io capability gate（§4.4 放置点表：lifecycle gate——archiveDoc 公共入口
   * 同步段）：writeArchive/remove 任一缺席 → 整体拒绝（不写半归档）——bare loud Error
   * （稳定 message，io seam 契约违约通道——与「persistence is disposed」同款非四分类
   * 通道；不伪装为 operational）。生产 Memory/File 恒具备；13 个旧 stub 永不触达
   * 导入/重置路径 ⟹ 永不触发 gate ⟹ 零回归。
   */
  private assertArchiveIo(): void {
    if (typeof this.io.writeArchive !== 'function' || typeof this.io.remove !== 'function') {
      throw new Error(
        'persistence adapter 缺少归档能力（writeArchive/remove）——归档编排要求支持 ReplicaPersistence 级 I/O seam',
      )
    }
  }

  async saveDoc(handle: DocHandle): Promise<void> {
    this.assertWritable()
    const owned = this.assertOwnedHandle(handle)
    const cell = this.cells.get(owned.entryKey)
    if (cell?.state !== 'live' || !cell.entry.handles.has(owned)) throw new Error('foreign or released DocHandle')
    // (issue #79) degraded is NOT a rejection reason: saveDoc is the
    // post-mutation dirty notification. The entry's pending retry covers the
    // new dirty generation with the full live Y.Doc.
    cell.entry.dirtyGeneration += 1
    this.scheduleFlush(cell.entry)
  }

  /** Synchronous test seed: reuses a live cell, otherwise registers a new doc without writing the store. */
  seedForTest(owner: User, docId: string): DocHandle {
    this.assertWritable()
    const key = toKey(owner, docId)
    const cell = this.cells.get(key)
    if (cell?.state === 'live') {
      // (issue #79) degraded is not a rejection reason on the read/lease path
      // (ADR-0006 keeps reads while degraded): a twin lease on a degraded
      // entry is legal and reports the entry status.
      return this.issueHandle(cell.entry)
    }
    // Phase 5（SA2 MEDIUM-3）：archiving 态同样封死——归档在途时 seed 以 cells.set
    // 覆写 archiving cell 会令 relocate 继续 remove 主键而 live entry 仍在
    // （击穿 phase:63 前置「仅在无有效 handle 时执行」）。
    if (cell?.state === 'reading' || cell?.state === 'creating' || cell?.state === 'archiving') {
      throw new Error('test seed requires an idle key cell')
    }
    const entry = this.createEntry(owner, docId, key, new Y.Doc())
    this.cells.set(key, { state: 'live', entry })
    return this.issueHandle(entry)
  }

  /**
   * Abort I/O, clear local resources, then await every tracked operation.
   * Adapter I/O implementations must honor the supplied AbortSignal; this makes
   * plugin unload wait for all restore/flush/create work to settle without
   * real-time polling or a hidden timeout policy.
   */
  async dispose(): Promise<void> {
    if (this.closed) {
      await Promise.allSettled([...this.inFlight])
      return
    }
    this.closed = true
    this.epoch += 1
    this.abortController.abort()
    for (const cell of this.cells.values()) {
      if (cell.state === 'live') {
        const entry = cell.entry
        this.clearTimers(entry)
        // Phase 5 通知点 2（§4.5.2）：归档 settle 的 waiters 同步唤醒——不依赖任何
        // 未来 flush（degraded retry 武装 + 零在途 flush 的交错下，retry timer 刚被
        // clearTimers 取消、flush finally 永不再运行，waiter 仍被此路径唤醒）；
        // waiter 续体是微任务，本同步段（含 cells.clear()）先完成 ⟹ settle 重检见
        // cell 缺席而退出循环，claim 段以 bare disposed 错误收口（INV-15）。
        const waiters = entry.archiveWaiters.splice(0)
        for (const w of waiters) w()
        entry.handles.clear()
        entry.doc.destroy()
      }
    }
    this.cells.clear()
    await Promise.allSettled([...this.inFlight])
  }

  private async loadSlowPath(owner: User, docId: string, key: string): Promise<DocHandle | null> {
    const epoch = this.epoch
    let sawEntry = false
    while (true) {
      const entry = await this.resolveLoad(key, epoch, owner, docId)
      this.assertReadable()
      if (entry === null) {
        if (sawEntry) {
          console.error('[persistence] integrity violation: resolved entry had committed store content, but a fresh read found none', { key })
          throw new Error(`persistence integrity: fresh store read found no snapshot after a resolved entry was evicted (${key})`)
        }
        return null
      }
      sawEntry = true
      // Ownership re-validation in the same synchronous block as issuance:
      // never sign a handle for a destroyed/evicted document (I6).
      const cell = this.cells.get(key)
      if (cell?.state === 'live' && cell.entry === entry) {
        return this.issueHandle(entry)
      }
    }
  }

  private async resolveLoad(key: string, epoch: number, owner: User, docId: string): Promise<LiveEntry | null> {
    while (true) {
      const cell = this.cells.get(key)
      if (cell?.state === 'live') return cell.entry
      if (cell?.state === 'creating') {
        await cell.claim.promise
        continue
      }
      if (cell?.state === 'archiving') {
        // Phase 5（§4.5.1）：归档在途 → 等待 claim 后重评估（load 重读 → 归档后得
        // null——「归档后 loadDoc → null」跨实例成立）；绝不因归档在途而制造伪数据。
        await cell.claim.promise
        continue
      }
      if (cell?.state === 'reading') return await cell.read.completion
      this.startReadTicket(key, owner, docId, 'load', epoch)
      continue
    }
  }

  private startReadTicket(key: string, owner: User, docId: string, startedBy: 'load' | 'create', epoch: number): ReadTicket {
    const read = this.createReadTicket(key, startedBy)
    this.cells.set(key, { state: 'reading', read })
    const driver = this.driveLoadRead(key, owner, docId, read, epoch).then(
      (value) => { read.settleOnce(value) },
      (err: unknown) => { read.rejectOnce(err) },
    )
    void this.track(driver)
    return read
  }

  private createReadTicket(key: string, startedBy: 'load' | 'create'): ReadTicket {
    let completionResolve: (value: LiveEntry | null) => void = () => {}
    let completionReject: (reason?: unknown) => void = () => {}
    const completion = new Promise<LiveEntry | null>((resolve, reject) => {
      completionResolve = resolve
      completionReject = reject
    })
    // (issue #108 §4.2.6) The create path awaits `rawPromise` directly; when a
    // create-started read rejects with no concurrent load attached, `completion`
    // would otherwise be a forever-unhandled rejection. Awaited consumers
    // (concurrent loads routed through `resolveLoad`) still observe it.
    completion.catch(() => {})
    let settled = false
    const rawPromise = this.io.read(key, this.abortController.signal)
    const read: ReadTicket = {
      startedBy,
      rawPromise,
      completion,
      settleOnce(value) {
        if (settled) return
        settled = true
        completionResolve(value)
      },
      rejectOnce(err) {
        if (settled) return
        settled = true
        completionReject(err)
      },
    }
    return read
  }

  /** The single driver per read ticket, which exclusively routes its evidence. */
  private async driveLoadRead(key: string, owner: User, docId: string, read: ReadTicket, epoch: number): Promise<LiveEntry | null> {
    let snapshot: Uint8Array | undefined | ReadError
    try {
      snapshot = await read.rawPromise
    } catch (err) {
      snapshot = new ReadError(err)
    }
    return this.routeOwnedRead(key, owner, docId, snapshot, epoch)
  }

  /** Classic owner routing; the caller holds the reading cell with this ticket. */
  private async routeOwnedRead(key: string, owner: User, docId: string, snapshot: Uint8Array | undefined | ReadError, epoch: number): Promise<LiveEntry | null> {
    if (!this.isCurrent(epoch)) {
      this.cells.delete(key)
      throw new Error('persistence is disposed')
    }
    if (snapshot instanceof ReadError) {
      this.cells.delete(key)
      // L1 (design §2.1): store-level read failure on a current epoch is the
      // one operational classification for the load path. The exact original
      // rejection (identity-stable) is preserved on `cause`; the stable
      // message never concatenates it. The cell cleanup above stays first, so
      // the failed ticket self-heals on the next load.
      throw new DocLoadOperationalError(snapshot.err)
    }
    if (snapshot === undefined) {
      this.cells.delete(key)
      return null
    }
    let entry: LiveEntry
    try {
      entry = this.restoreAndValidate(snapshot, owner, docId, key)
    } catch (err) {
      // No reading residue: the next load re-reads the store (self-heals).
      this.cells.delete(key)
      throw err
    }
    this.cells.set(key, { state: 'live', entry })
    return entry
  }

  private validateCreateDoc(doc: Y.Doc, docId: string): void {
    const metaDocId = doc.getMap('META').get('docId')
    if (metaDocId !== docId) {
      throw new Error(`doc META.docId ${String(metaDocId)} does not match requested docId ${docId}`)
    }
  }

  /** 导入身份校验（§4.3）：Persistenced 持久层校验面冻结为「仅 META.docId === docId」
   *  （ADR 0006:132）——复制身份核对的权威在受信 Registry 路径（§4.2），本门是
   *  第二道独立 docId 门；违约 → typed DocImportIdentityError（稳定分类）。 */
  private validateImportDoc(doc: Y.Doc, docId: string): void {
    const metaDocId = doc.getMap('META').get('docId')
    if (metaDocId !== docId) {
      throw new DocImportIdentityError()
    }
  }

  private duplicateError(owner: User, key: string): DocDuplicateError {
    return new DocDuplicateError(`createDoc duplicate: owner ${owner.userId} already has this docId (${key})`)
  }

  /**
   * The one classifier for every store-level create failure before the commit
   * point, shared by the claim probe-read sites (R1/R2/R3) and the write
   * segment (W2/W3). On a current epoch the store rejection is an operational
   * failure — the create wrote nothing, so committed:false is authoritative;
   * once the lifecycle ended (dispose race) the same rejection is a `phase`
   * fatal — AC6 forbids reporting a store-health fact the lifecycle can no
   * longer verify. The original failure survives as the exact `cause`. The
   * R3 branch (assertCurrentEpoch rejection) always lands on the fatal side
   * here: it throws only when `isCurrent(epoch)` is already false. Post-commit
   * failures (W4/W5) never pass through this classifier: write resolved ⟹
   * committed:true unconditionally.
   */
  private classifyCreateStoreFailure(
    phase: 'probe-read' | 'store-write',
    err: unknown,
    epoch: number,
  ): DocCreateOperationalError | DocCreateFatalError {
    return this.isCurrent(epoch)
      ? new DocCreateOperationalError(err)
      : new DocCreateFatalError(phase, err)
  }

  private restoreAndValidate(snapshot: Uint8Array, owner: User, docId: string, key: string): LiveEntry {
    const doc = new Y.Doc()
    Y.applyUpdate(doc, snapshot)
    const metaDocId = doc.getMap('META').get('docId')
    if (metaDocId !== docId) {
      doc.destroy()
      throw new Error(`persisted META.docId ${String(metaDocId)} does not match requested docId ${docId}`)
    }
    return this.createEntry(owner, docId, key, doc)
  }

  private createEntry(owner: User, docId: string, key: string, doc: Y.Doc): LiveEntry {
    return {
      key,
      owner,
      docId,
      doc,
      handles: new Set(),
      archiveWaiters: [],
      degraded: false,
      dirtyGeneration: 0,
      savedGeneration: 0,
      flushing: false,
      retryDelayMs: this.schedule.debounceMs || 1,
    }
  }

  private issueHandle(entry: LiveEntry): DocHandle {
    const handle = new PersistenceHandle(this, entry.owner, entry.docId, entry.doc, entry.key)
    entry.handles.add(handle)
    return handle
  }

  private releaseHandle(handle: PersistenceHandle): void {
    const cell = this.cells.get(handle.entryKey)
    if (cell?.state !== 'live' || !cell.entry.handles.has(handle)) return
    cell.entry.handles.delete(handle)
    this.maybeEvict(cell.entry)
  }

  private scheduleFlush(entry: LiveEntry): void {
    if (entry.flushing || this.closed) return
    // Single-scheduler discipline (issue #79): while a retry timer is pending
    // (degraded window), the retry backoff IS the flush schedule — its next
    // flush captures the CURRENT dirtyGeneration from the full live Y.Doc, and
    // the backoff is capped at maxDirtyMs, preserving the max-dirty attempt
    // guarantee. Arming debounce/maxDirty here would stack a second schedule
    // whose stale timers outlive the retry (the retry's success path sees
    // savedGeneration === dirtyGeneration and never cancels them).
    if (entry.retryTimer !== undefined) return
    if (entry.maxDirtyTimer === undefined) entry.maxDirtyTimer = this.scheduler.setTimeout(() => this.onMaxDirty(entry), this.schedule.maxDirtyMs)
    if (entry.debounceTimer !== undefined) this.scheduler.clearTimeout(entry.debounceTimer)
    entry.debounceTimer = this.scheduler.setTimeout(() => this.onDebounce(entry), this.schedule.debounceMs)
  }

  private onDebounce(entry: LiveEntry): void {
    entry.debounceTimer = undefined
    this.cancelMaxDirty(entry)
    this.startFlush(entry)
  }

  private onMaxDirty(entry: LiveEntry): void {
    entry.maxDirtyTimer = undefined
    this.cancelDebounce(entry)
    this.startFlush(entry)
  }

  private startFlush(entry: LiveEntry): void {
    if (entry.flushing || this.closed) return
    void this.track(this.flush(entry, this.epoch)).catch(() => {})
  }

  private async flush(entry: LiveEntry, epoch: number): Promise<void> {
    if (entry.flushing || entry.savedGeneration === entry.dirtyGeneration || !this.isCurrent(epoch)) return
    entry.flushing = true
    const generation = entry.dirtyGeneration
    const snapshot = Y.encodeStateAsUpdate(entry.doc)
    try {
      await this.io.write(entry.key, snapshot, this.abortController.signal)
      if (!this.isCurrent(epoch)) return
      entry.savedGeneration = generation
      entry.retryDelayMs = this.schedule.debounceMs || 1
      entry.degraded = false
    } catch {
      if (!this.isCurrent(epoch)) return
      entry.degraded = true
      this.scheduleRetry(entry)
    } finally {
      // Phase 5 通知点 1（§4.5.2，R2 规格化）：无条件置于 finally 首位——先于
      // isCurrent 早退、先于 flushing=false/reschedule/maybeEvict。非归档路径
      // archiveWaiters 恒空（仅 settle 填充）⟹ splice 空数组为 no-op、零观测差异；
      // 归档路径下 waiter 续体仅排入微任务队列，finally 其余语句在同步段先行完成
      // ⟹ waiter 观察到的是 flush 终态，settle 重检正确。
      const waiters = entry.archiveWaiters.splice(0)
      for (const w of waiters) w()
      if (!this.isCurrent(epoch)) return
      entry.flushing = false
      // A save during the previous flush belongs to a fresh dirty window. The
      // old generation's timers have already fired/cancelled, so schedule the
      // next debounce only after the single-flight lock is released.
      if (entry.savedGeneration !== entry.dirtyGeneration && entry.retryTimer === undefined) {
        this.cancelDebounce(entry)
        this.cancelMaxDirty(entry)
        this.scheduleFlush(entry)
      }
      this.maybeEvict(entry)
    }
  }

  private scheduleRetry(entry: LiveEntry): void {
    if (entry.retryTimer !== undefined || this.closed) return
    const delay = entry.retryDelayMs
    entry.retryDelayMs = Math.min(Math.max(delay * 2, 1), this.schedule.maxDirtyMs)
    entry.retryTimer = this.scheduler.setTimeout(() => {
      entry.retryTimer = undefined
      this.startFlush(entry)
    }, delay)
  }

  private maybeEvict(entry: LiveEntry): void {
    if (entry.handles.size || entry.flushing || entry.savedGeneration !== entry.dirtyGeneration) return
    this.clearTimers(entry)
    const cell = this.cells.get(entry.key)
    if (cell?.state === 'live' && cell.entry === entry) this.cells.delete(entry.key)
    entry.doc.destroy()
  }

  private cancelDebounce(entry: LiveEntry): void {
    if (entry.debounceTimer !== undefined) this.scheduler.clearTimeout(entry.debounceTimer)
    entry.debounceTimer = undefined
  }

  private cancelMaxDirty(entry: LiveEntry): void {
    if (entry.maxDirtyTimer !== undefined) this.scheduler.clearTimeout(entry.maxDirtyTimer)
    entry.maxDirtyTimer = undefined
  }

  private clearTimers(entry: LiveEntry): void {
    this.cancelDebounce(entry)
    this.cancelMaxDirty(entry)
    if (entry.retryTimer !== undefined) this.scheduler.clearTimeout(entry.retryTimer)
    entry.retryTimer = undefined
  }

  private track<T>(promise: Promise<T>): Promise<T> {
    this.inFlight.add(promise)
    void promise.then(() => this.inFlight.delete(promise), () => this.inFlight.delete(promise))
    return promise
  }

  private assertOwnedHandle(handle: DocHandle): PersistenceHandle {
    if (!(handle instanceof PersistenceHandle) || HANDLE_OWNER.get(handle) !== this || handle.isReleased) throw new Error('foreign or released DocHandle')
    return handle
  }

  private assertReadable(): void { if (this.closed) throw new Error('persistence is disposed') }

  private assertWritable(): void {
    this.assertReadable()
  }

  private assertCurrentEpoch(epoch: number): void {
    if (!this.isCurrent(epoch)) throw new Error('createDoc rejected: persistence is disposed')
  }

  private isCurrent(epoch: number): boolean { return !this.closed && this.epoch === epoch }
}

/**
 * 复制事实判据的 persistence 侧结构守卫副本 #2（§4.5.4）：跨包 import 对方模块级
 * 常量不可达（runtime 的 REPLICATION_ID_PATTERN 是值导出——从 index 导出会击穿
 * runtime-acceptance-exports-audit.test.ts「值导出恰一键」冻结审计；registry 侧
 * 同款副本见 registry.ts REPLICATION_ID_PATTERN）。两份副本互为结构守卫
 * （注释互相引用对方落点）：
 *   runtime 侧：packages/namespace-runtime/src/replication-write.ts REPLICATION_ID_PATTERN
 *   registry 侧：packages/namespace-registry/src/registry.ts REPLICATION_ID_PATTERN
 */
const REPLICATION_ID_PATTERN = /^[0-9a-f]{32}$/

/**
 * 持久快照复制事实读取器（§4.5.4，判据单点的落地形态）。判据逐条复刻
 * readReplicationFacts（replication-write.ts:213-240 语义源；结构守卫副本三处
 * 互引注释）：META 载体缺席 / 两键真缺席 / 恰一键 / 键存在而值 undefined /
 * id 格式违约 / epoch 格式违约 / 载体异型 → { ok:false }（归档侧统一收入
 * DocArchiveIdentityError 单一谓词——§4.5.4 裁决）。
 */
function readPersistedReplicaFacts(
  scratch: Y.Doc,
): { ok: true; replicationId: string; replicationEpoch: number } | { ok: false } {
  try {
    if (!scratch.share.has('META')) return { ok: false }
    let meta: Y.Map<unknown>
    try {
      meta = scratch.getMap('META') // 载体异型（同名 Y.Text 等）→ throw 收编
    } catch {
      return { ok: false }
    }
    const hasId = meta.has('replicationId')
    const hasEpoch = meta.has('replicationEpoch')
    if (!hasId && !hasEpoch) return { ok: false } // 两键真缺席
    if (!hasId || !hasEpoch) return { ok: false } // 恰一键
    const id = meta.get('replicationId')
    const epoch = meta.get('replicationEpoch')
    if (id === undefined || epoch === undefined) return { ok: false } // 显式 undefined 值
    if (typeof id !== 'string' || !REPLICATION_ID_PATTERN.test(id)) return { ok: false }
    if (typeof epoch !== 'number' || !Number.isSafeInteger(epoch) || epoch < 1) return { ok: false }
    return { ok: true, replicationId: id, replicationEpoch: epoch }
  } catch {
    return { ok: false }
  }
}

function toKey(owner: User, docId: string): string { return `${owner.userId}\u0000${docId}` }
