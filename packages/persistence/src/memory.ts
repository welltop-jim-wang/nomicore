import type { Context } from '@deepseek-ai/cordis'
import type * as Y from 'yjs'
import { PersistenceLifecycle, type PersistenceIO, type PersistenceStatus } from './lifecycle.js'
import {
  type DocHandle,
  type DocPersistence,
  type PersistenceSchedule,
  type PersistenceScheduler,
  type ReplicationIdentityRef,
  type User,
} from './contract.js'
import {
  assertPersistenceHostDependencies,
  bindPersistenceAdapterLifecycle,
  createCordisPersistenceScheduler,
} from './service.js'

const TEST_FACTORY = Symbol('MemoryPersistence test factory')

export interface MemoryPersistenceOptions {
  readonly schedule?: Partial<PersistenceSchedule> | undefined
  /**
   * Adapter-owned scheduling seam, injected by the host (the production plugin
   * path derives it from `ctx.timeout` via `createCordisPersistenceScheduler`).
   * Required: the adapter never provides or falls back to a system timer.
   */
  readonly scheduler: PersistenceScheduler
  /**
   * Optional flat write hook. Contract (design §4.3.4/§3.1): a hook that has
   * entered runs to completion — all of its own side effects — or rejects
   * before any side effect begins; it must never reject AFTER partially
   * committing (that is a seam violation, an adapter bug the lifecycle
   * declares but does not defend against). Abort checks are the adapter
   * entry gate's job (the gate sits at io.write ENTRY, before this hook):
   * the hook may consult `signal` but is not required to.
   */
  readonly writeSnapshot?: (key: string, snapshot: Uint8Array, signal: AbortSignal) => Promise<void> | void
  /** Implementations must honor `signal` to make in-flight I/O cancellable. */
  readonly readSnapshot?: (key: string, signal: AbortSignal) => Promise<Uint8Array | undefined> | Uint8Array | undefined
  /**
   * Phase 5（§4.10）：归档 remove 段的主键删除 hook。契约 = 从 readSnapshot /
   * writeSnapshot 所接外部 store 中删除该 key 的 committed snapshot（仅主键直传——
   * writeArchive 不经本 hook、独立 archiveSnapshots 分区，§4.10.1）；缺省（未接线
   * readSnapshot 的实例）= 仅 mirror 删除。read hook 接线而本 hook 缺席的实例在
   * 归档时 loud 拒绝（配置缺陷，非静默——§4.10 loud 配置门；构造期门禁会使全部既有
   * hook 接线实例构造即炸，违反零回归，故为运行时门）。
   */
  readonly deleteSnapshot?: (key: string, signal: AbortSignal) => Promise<void> | void
  /**
   * Around-seam over this adapter's real I/O (fault injection / composition).
   * Receives the adapter's default io (Memory: entry-abort-gate → writeSnapshot
   * hook → mirror set, per §3.5 方案 (a); File: mkdir → writeFile tmp → rename)
   * and returns the io the lifecycle will use. The returned io MUST uphold the
   * PersistenceIO contract: write resolves ⟺ committed; rejects leave the
   * store unchanged; no synchronous throw.
   */
  readonly wrapIo?: ((io: PersistenceIO) => PersistenceIO) | undefined
}

export type MemoryPersistenceStatus = PersistenceStatus

interface StoredSnapshot { readonly snapshot: Uint8Array }

/**
 * In-memory reference adapter with cancellable I/O and a separate snapshot store.
 *
 * Isolation rules (R4, design §5.3.1): the snapshot mirror is instance-private
 * (IO-1 — no module-level mutable state); when a read hook is wired it is the
 * sole read authority, and the `??` short-circuit means the mirror is never
 * evaluated for hooked instances (IO-2); dispose clears the instance mirror
 * after the core has settled all in-flight I/O (IO-3).
 */
export class MemoryPersistence implements DocPersistence {
  private readonly core: PersistenceLifecycle
  private readonly snapshots = new Map<string, StoredSnapshot>()
  /** Phase 5 归档副本独立分区（R2 修订，§4.10.1）：以主键为键、与主 mirror 结构性
   *  分区——任意 userId/docId 组合的主键写不可能触及归档域，反之亦然；writeArchive
   *  不经 writeSnapshot hook（hook store 不再收到任何归档键）。实例私有、无恢复面
   *  （恢复面按 phase:183 由 File 承担）。 */
  private readonly archiveSnapshots = new Map<string, StoredSnapshot>()

  constructor(private readonly options: MemoryPersistenceOptions) {
    const baseIo: PersistenceIO = {
      // Byte-order and await-depth identical to the pre-core restore/flush
      // paths; the abort gate sits at io.write ENTRY (before any hook side
      // effect); a write that has entered runs to completion — hook side
      // effects + mirror set — and resolving means committed (§3.5/ADR
      // observable-channel axiom). Read is verbatim-isomorphic with base
      // restoreEntry: the `??` short-circuits at the Promise-object level, so
      // a wired read hook is the only read authority and the mirror is never
      // consulted for hooked instances.
      read: async (key, signal) => options.readSnapshot?.(key, signal) ?? this.snapshots.get(key)?.snapshot,
      write: async (key, snapshot, signal) => {
        signal.throwIfAborted()
        if (options.writeSnapshot) await options.writeSnapshot(key, snapshot, signal)
        this.snapshots.set(key, { snapshot: snapshot.slice() })
      },
      // Phase 5（§4.10）：归档写——独立 archiveSnapshots 分区（不经 writeSnapshot
      // hook，§4.10.1 碰撞消解：hook store 中任何键都不可能被归档写触达）。公理与
      // write 同款：resolve ⟺ 归档区已持有该字节；reject ⟹ 归档区不变；禁同步 throw。
      writeArchive: async (key, snapshot, signal) => {
        signal.throwIfAborted()
        this.archiveSnapshots.set(key, { snapshot: snapshot.slice() })
      },
      // Phase 5（§4.10 R2 形态）：主键移除——loud 配置门（read hook 接线时 hook
      // store 是唯一读权威，无 delete hook 则「主键移除」对外部 store 虚假 no-op：
      // 归档后 hook 仍吐旧字节 ⟹ 文档复活 + store.has(key) 撒谎）→ deleteSnapshot
      // hook（仅主键直传）→ 主 mirror 删除（归档域不触碰——remove 契约：仅主键）。
      remove: async (key, signal) => {
        signal.throwIfAborted()
        if (options.readSnapshot !== undefined && options.deleteSnapshot === undefined) {
          throw new Error(
            'MemoryPersistence archive requires the deleteSnapshot hook when readSnapshot is wired: an external read authority without an external delete path cannot be archived honestly',
          )
        }
        await options.deleteSnapshot?.(key, signal)
        this.snapshots.delete(key)
      },
    }
    const io = options.wrapIo !== undefined ? options.wrapIo(baseIo) : baseIo
    const core = new PersistenceLifecycle(io, {
      ...(options.schedule !== undefined ? { schedule: options.schedule } : {}),
      scheduler: options.scheduler,
    })
    this.core = core
  }

  getStatus(): MemoryPersistenceStatus { return this.core.getStatus() }

  loadDoc(owner: User, docId: string): Promise<DocHandle | null> {
    return this.core.loadDoc(owner, docId)
  }

  createDoc(owner: User, docId: string, doc: Y.Doc): Promise<DocHandle> {
    return this.core.createDoc(owner, docId, doc)
  }

  /** Phase 5 受控复制导入委托（§4.3）：语义与 createDoc 同管线，META.docId 违约 →
   *  DocImportIdentityError。 */
  importDoc(owner: User, docId: string, doc: Y.Doc): Promise<DocHandle> {
    return this.core.importDoc(owner, docId, doc)
  }

  /** Phase 5 受身份前置条件保护的归档委托（§4.5）：settle 排空 → claim →
   *  guard-read → 身份核对 → relocate（writeArchive 独立分区 + remove）。 */
  archiveDoc(
    owner: User,
    docId: string,
    expectedReplicationIdentity: ReplicationIdentityRef,
  ): Promise<Readonly<{ ok: true }>> {
    return this.core.archiveDoc(owner, docId, expectedReplicationIdentity)
  }

  saveDoc(handle: DocHandle): Promise<void> {
    return this.core.saveDoc(handle)
  }

  /** Ordered Cordis lifecycle (rev1 问题 3): service revocation → dependent-fiber settle → adapter dispose. */
  apply(ctx: Context): void {
    // AC2: loud fail on missing clock/timer before ANY service is provided.
    assertPersistenceHostDependencies(ctx)
    bindPersistenceAdapterLifecycle(ctx, this, 'memory-persistence: service')
  }

  /**
   * Settle all in-flight I/O through the core first — `core.dispose()` drains
   * every tracked operation (each write runs inside a tracked op), so a mirror
   * set from a write that had already entered its entry gate happens BEFORE
   * `allSettled` returns and is cleared by the `snapshots.clear()` below —
   * then clear the instance mirror: a disposed instance's data must never be
   * resurrected by a later instance (ADR-0006 factory/instance model). The
   * invariant mechanism is drain-then-clear, not an abort guard (design
   * §4.3.2: the abort gate sits at io.write ENTRY and cannot prevent the
   * committed mirror set of a write that was already in flight).
   */
  async dispose(): Promise<void> {
    await this.core.dispose()
    this.snapshots.clear()
    // Phase 5（§4.10 R2 形态）：归档分区同款 drain-then-clear——core.dispose 的
    // allSettled 先结算被 track 的归档提交段（writeArchive 已进入的写入先于
    // clear() 生效），clear 后置（与既有 mirror 同款纪律，MEMORY.ts:124-127）。
    this.archiveSnapshots.clear()
  }

  [TEST_FACTORY](owner: User, docId: string): DocHandle {
    return this.core.seedForTest(owner, docId)
  }
}

export function createMemoryPersistence(options: MemoryPersistenceOptions): MemoryPersistence {
  return new MemoryPersistence(options)
}

/** Cordis plugin factory; each invocation owns an isolated adapter instance. */
export function createMemoryPersistencePlugin(options: Omit<MemoryPersistenceOptions, 'scheduler' | 'wrapIo'> = {}) {
  let instance: MemoryPersistence | undefined
  return {
    apply(ctx: Context) {
      instance = new MemoryPersistence({
        ...options,
        scheduler: createCordisPersistenceScheduler(ctx),
      })
      instance.apply(ctx)
    },
    get instance(): MemoryPersistence | undefined { return instance },
  }
}

/**
 * Test-only helper export. It lives on the module's non-package export path
 * (`@nomicore/persistence/src/memory.js`) and is deliberately absent from
 * `@nomicore/persistence` public exports.
 */
export function createMemoryHandleForTest(
  persistence: MemoryPersistence,
  owner: User,
  docId: string,
): DocHandle {
  return persistence[TEST_FACTORY](owner, docId)
}
