import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  provideNomicorePersistence,
  type DocHandle,
  type DocPersistence,
  type PersistenceSchedule,
  type PersistenceScheduler,
  type User,
} from './contract.js'
import {
  PersistenceLifecycle,
  type PersistenceIO,
  type PersistenceStatus,
} from './lifecycle.js'
import { assertPersistenceHostDependencies, createCordisPersistenceScheduler } from './service.js'

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

  async saveDoc(handle: DocHandle): Promise<void> {
    this.validateIdentity(handle.owner, handle.docId)
    await this.core.saveDoc(handle)
  }

  apply(ctx: Context): void {
    // AC2: loud fail on missing clock/timer before ANY service is provided.
    assertPersistenceHostDependencies(ctx)
    ctx.effect(() => {
      provideNomicorePersistence(ctx, this)
      return () => this.dispose()
    }, 'file-persistence: service')
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
