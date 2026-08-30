import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  type DocHandle,
  type DocPersistence,
  type PersistedIdentityProbeResult,
  type PersistenceSchedule,
  type PersistenceScheduler,
  type ReplicationIdentityRef,
  type User,
} from './contract.js'
import {
  PersistenceLifecycle,
  type PersistenceIO,
  type PersistenceStatus,
} from './lifecycle.js'
import {
  assertPersistenceHostDependencies,
  bindPersistenceAdapterLifecycle,
  createCordisPersistenceScheduler,
} from './service.js'

export interface FilePersistenceOptions {
  /**
   * Directory root for this adapter. One active FilePersistence instance owns a
   * rootDir at a time; HMR must dispose and drain the old instance first.
   */
  readonly rootDir: string
  readonly schedule?: Partial<PersistenceSchedule> | undefined
  /**
   * Adapter-owned scheduling seam, injected by the host (the production plugin
   * path derives it from `ctx.timeout` via `createCordisPersistenceScheduler`).
   * Required: the adapter never provides or falls back to a system timer.
   */
  readonly scheduler: PersistenceScheduler
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

export type FilePersistenceStatus = PersistenceStatus

const SAFE_PATH_SEGMENT = /^[a-z][a-z0-9-]{0,62}$/

interface SnapshotPaths {
  readonly userDir: string
  readonly snapshotPath: string
  readonly tmpPath: string
}

/** Filesystem adapter over the shared create/load/flush lifecycle. */
export class FilePersistence implements DocPersistence {
  private readonly core: PersistenceLifecycle

  constructor(private readonly options: FilePersistenceOptions) {
    if (typeof options.rootDir !== 'string' || options.rootDir.length === 0) {
      throw new TypeError('FilePersistence requires a non-empty rootDir string')
    }
    const baseIo: PersistenceIO = {
      read: (key, signal) => this.readCommittedSnapshot(key, signal),
      write: (key, snapshot, signal) => this.writeCommittedSnapshot(key, snapshot, signal),
      // Phase 5（§4.9）：归档重定位写——archive/ 子树 + 同款 mkdir→tmp→rename 原子提交
      //（归档文件的出现是原子的，与既有 flush 提交同构——0006:52 纪律）；
      // 同名重复归档 = 单槽 latest-wins 原子覆盖。不触碰主键区。
      writeArchive: (key, snapshot, signal) => this.writeArchiveSnapshot(key, snapshot, signal),
      // Phase 5（§4.9）：主键移除（ENOENT 容忍——fsp.rm force:true 幂等底座）；
      // 归档区路径子树分离，结构性不误删。
      remove: (key, signal) => this.removeCommittedSnapshot(key, signal),
    }
    const io = options.wrapIo !== undefined ? options.wrapIo(baseIo) : baseIo
    this.core = new PersistenceLifecycle(io, {
      ...(options.schedule !== undefined ? { schedule: options.schedule } : {}),
      scheduler: options.scheduler,
    })
  }

  getStatus(): FilePersistenceStatus { return this.core.getStatus() }

  async loadDoc(owner: User, docId: string): Promise<DocHandle | null> {
    this.validateIdentity(owner, docId)
    return await this.core.loadDoc(owner, docId)
  }

  async createDoc(owner: User, docId: string, doc: import('yjs').Doc): Promise<DocHandle> {
    this.validateIdentity(owner, docId)
    return await this.core.createDoc(owner, docId, doc)
  }

  /** Phase 5 受控复制导入委托（§4.3）：与 createDoc 同管线 + META.docId 违约 →
   *  DocImportIdentityError；File 侧入口沿用 SAFE_PATH_SEGMENT 双段守卫。 */
  async importDoc(owner: User, docId: string, doc: import('yjs').Doc): Promise<DocHandle> {
    this.validateIdentity(owner, docId)
    return await this.core.importDoc(owner, docId, doc)
  }

  /** Phase 5 受身份前置条件保护的归档委托（§4.5）：入口先 validateIdentity
   *  （SAFE_PATH_SEGMENT 双段，file.ts:128-131 同款）。 */
  async archiveDoc(
    owner: User,
    docId: string,
    expectedReplicationIdentity: ReplicationIdentityRef,
  ): Promise<Readonly<{ ok: true }>> {
    this.validateIdentity(owner, docId)
    return await this.core.archiveDoc(owner, docId, expectedReplicationIdentity)
  }

  /** R2 只读 committed-snapshot identity probe 委托（§3.3）：入口先 validateIdentity
   *  （SAFE_PATH_SEGMENT 双段同款）；零写/零 flush/零 handle。 */
  async readPersistedReplicationIdentity(
    owner: User,
    docId: string,
  ): Promise<PersistedIdentityProbeResult> {
    this.validateIdentity(owner, docId)
    return await this.core.readPersistedReplicationIdentity(owner, docId)
  }

  async saveDoc(handle: DocHandle): Promise<void> {
    this.validateIdentity(handle.owner, handle.docId)
    await this.core.saveDoc(handle)
  }

  apply(ctx: Context): void {
    // AC2: loud fail on missing clock/timer before ANY service is provided.
    assertPersistenceHostDependencies(ctx)
    bindPersistenceAdapterLifecycle(ctx, this, 'file-persistence: service')
  }

  dispose(): Promise<void> { return this.core.dispose() }

  /** Package-internal test seam; never exported from the package root. */
  seedForTest(owner: User, docId: string): DocHandle {
    this.validateIdentity(owner, docId)
    return this.core.seedForTest(owner, docId)
  }

  private async readCommittedSnapshot(key: string, signal: AbortSignal): Promise<Uint8Array | undefined> {
    const { snapshotPath, tmpPath } = this.resolveSnapshotPaths(key)
    let snapshot: Uint8Array | undefined
    try {
      snapshot = await fsp.readFile(snapshotPath, { signal })
    } catch (error) {
      if (!isErrnoException(error) || error.code !== 'ENOENT') throw error
    }
    await fsp.rm(tmpPath, { force: true, recursive: true })
    return snapshot
  }

  private async writeCommittedSnapshot(key: string, snapshot: Uint8Array, signal: AbortSignal): Promise<void> {
    const { userDir, snapshotPath, tmpPath } = this.resolveSnapshotPaths(key)
    signal.throwIfAborted()
    await fsp.mkdir(userDir, { recursive: true })
    signal.throwIfAborted()
    await fsp.writeFile(tmpPath, snapshot, { signal })
    signal.throwIfAborted()
    await fsp.rename(tmpPath, snapshotPath)
  }

  /**
   * Phase 5 归档重定位写（§4.9）：`{rootDir}/archive/users/<userId>/<docId>.snapshot`
   * 受控子树 + 同款 tmp→rename 原子提交（mkdir → writeFile tmp → rename；
   * abort 门位 entry/after-mkdir/after-writeFile，镜像 writeCommittedSnapshot）。
   * 同名重复归档 = tmp→rename 原子覆盖（单槽 latest-wins）；tmp 永非提交态。
   */
  private async writeArchiveSnapshot(key: string, snapshot: Uint8Array, signal: AbortSignal): Promise<void> {
    const { userDir, snapshotPath, tmpPath } = this.resolveArchivePaths(key)
    signal.throwIfAborted()
    await fsp.mkdir(userDir, { recursive: true })
    signal.throwIfAborted()
    await fsp.writeFile(tmpPath, snapshot, { signal })
    signal.throwIfAborted()
    await fsp.rename(tmpPath, snapshotPath)
  }

  /** Phase 5 主键移除（§4.9）：rm 主键 .snapshot（ENOENT 容忍——force:true）；与
   *  归档区路径子树分离，主键区读路径的 tmp 清理（readCommittedSnapshot）不触及归档区。
   *  入口 abort 门（同 writeCommittedSnapshot 纪律）；已进入的 rm 完整执行
   *  （resolve ⟺ 主键此后缺席——remove 契约）。 */
  private async removeCommittedSnapshot(key: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    const { snapshotPath } = this.resolveSnapshotPaths(key)
    await fsp.rm(snapshotPath, { force: true })
  }

  private validateIdentity(owner: User, docId: string): void {
    assertSafePathSegment('userId', owner.userId)
    assertSafePathSegment('namespaceId', docId)
  }

  private resolveSnapshotPaths(key: string): SnapshotPaths {
    const separator = key.indexOf('\u0000')
    if (separator < 0) throw new Error('FilePersistence received an invalid persistence key')
    const userId = key.slice(0, separator)
    const docId = key.slice(separator + 1)
    assertSafePathSegment('userId', userId)
    assertSafePathSegment('namespaceId', docId)
    const userDir = path.join(this.options.rootDir, 'users', userId)
    const snapshotPath = path.join(userDir, `${docId}.snapshot`)
    return { userDir, snapshotPath, tmpPath: `${snapshotPath}.tmp` }
  }

  /** Phase 5 归档路径解析（§4.9）：`{rootDir}/archive/users/<userId>/<docId>.snapshot`
   *  （+ 同名 `.tmp` 暂存）——rootDir 内受控子树（phase:64「同 rootDir 内受控 archive
   *  路径」）；SAFE_PATH_SEGMENT 双段守卫复用（与主键路径同级安全文法纪律）。 */
  private resolveArchivePaths(key: string): SnapshotPaths {
    const separator = key.indexOf('\u0000')
    if (separator < 0) throw new Error('FilePersistence received an invalid persistence key')
    const userId = key.slice(0, separator)
    const docId = key.slice(separator + 1)
    assertSafePathSegment('userId', userId)
    assertSafePathSegment('namespaceId', docId)
    const userDir = path.join(this.options.rootDir, 'archive', 'users', userId)
    const snapshotPath = path.join(userDir, `${docId}.snapshot`)
    return { userDir, snapshotPath, tmpPath: `${snapshotPath}.tmp` }
  }
}

function assertSafePathSegment(kind: 'userId' | 'namespaceId', value: string): void {
  if (typeof value !== 'string' || !SAFE_PATH_SEGMENT.test(value)) {
    throw new Error(
      `FilePersistence rejected unsafe ${kind} ${JSON.stringify(value)}: must match ^[a-z][a-z0-9-]{0,62}$`,
    )
  }
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && typeof (error as NodeJS.ErrnoException).code === 'string'
}

export function createFilePersistencePlugin(options: Omit<FilePersistenceOptions, 'scheduler' | 'wrapIo'>) {
  let instance: FilePersistence | undefined
  return {
    apply(ctx: Context) {
      instance = new FilePersistence({
        ...options,
        scheduler: createCordisPersistenceScheduler(ctx),
      })
      instance.apply(ctx)
    },
    get instance(): FilePersistence | undefined { return instance },
  }
}

export async function createFileHandleForTest(
  persistence: FilePersistence, owner: User, docId: string,
): Promise<DocHandle> {
  return persistence.seedForTest(owner, docId)
}
