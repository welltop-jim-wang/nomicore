import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  provideDocPersistence,
  type DocHandle,
  type DocPersistence,
  type PersistenceSchedule,
  type PersistenceTimer,
  type User,
} from './contract.js'
import {
  PersistenceLifecycle,
  type PersistenceIO,
  type PersistenceStatus,
} from './lifecycle.js'

export interface FilePersistenceOptions {
  /**
   * Directory root for this adapter. One active FilePersistence instance owns a
   * rootDir at a time; HMR must dispose and drain the old instance first.
   */
  readonly rootDir: string
  readonly schedule?: Partial<PersistenceSchedule>
  readonly timer?: PersistenceTimer
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
    const io: PersistenceIO = {
      read: (key, signal) => this.readCommittedSnapshot(key, signal),
      write: (key, snapshot, signal) => this.writeCommittedSnapshot(key, snapshot, signal),
    }
    this.core = new PersistenceLifecycle(io, {
      ...(options.schedule !== undefined ? { schedule: options.schedule } : {}),
      ...(options.timer !== undefined ? { timer: options.timer } : {}),
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
    ctx.effect(() => {
      provideDocPersistence(ctx, this)
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

export function createFilePersistencePlugin(options: FilePersistenceOptions) {
  let instance: FilePersistence | undefined
  return {
    apply(ctx: Context) {
      instance = new FilePersistence(options)
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
