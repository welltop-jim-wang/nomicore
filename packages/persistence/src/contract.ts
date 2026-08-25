import type { Context } from '@deepseek-ai/cordis'
import type * as Y from 'yjs'

/** A host-issued partition key. Persistence does not authenticate it. */
export interface User {
  readonly userId: string
}

/**
 * Entry-level persistence status of one DocHandle lease (issue #79).
 * Frozen vocabulary — rendered part of the ADR-0006 revision contract.
 */
export type DocHandleStatus = 'ready' | 'persistence-degraded' | 'released' | 'disposed'

/** A short-lived, adapter-owned lease of a live document. */
export interface DocHandle {
  /** The storage owner of this document (partition key), not the current accessor. */
  readonly owner: User
  readonly docId: string
  readonly doc: Y.Doc
  /**
   * Synchronous, entry-level status of THIS handle's (owner.userId, docId)
   * entry at the instant of the call — never the adapter aggregate.
   * Point-in-time observation only: it is not a promise that any subsequent
   * flush will succeed (same no-durability-promise discipline as saveDoc).
   * Precedence: disposed > released > entry state.
   */
  getStatus(): DocHandleStatus
  release(): Promise<void>
}

/**
 * The persistence seam shared by all adapters.
 *
 * The Cordis service name exposed by this interface is `nomicorePersistence`
 * (`NOMICORE_PERSISTENCE_SERVICE`).
 */
export interface DocPersistence {
  createDoc(owner: User, docId: string, doc: Y.Doc): Promise<DocHandle>
  loadDoc(owner: User, docId: string): Promise<DocHandle | null>
  saveDoc(handle: DocHandle): Promise<void>
}

/** Stable duplicate-creation error. Callers branch on code, never message text. */
export class DocDuplicateError extends Error {
  readonly code: 'DOC_DUPLICATE' = 'DOC_DUPLICATE'
  constructor(message = 'createDoc duplicate: the (owner, docId) already exists') {
    super(message)
    this.name = 'DocDuplicateError'
  }
}

/**
 * Stable typed load operational error (issue #108, ADR-0009 §Persistence
 * 错误演进).
 *
 * Thrown only when the underlying store READ rejected (I/O unavailable,
 * permission, sweep failure …) while the lifecycle is current. The exact
 * original failure is preserved on `cause` (identity-stable); the stable
 * `message` never concatenates the cause, identifiers, or store paths.
 * Corruption/validate failures and disposed-race failures are NOT this type
 * (they stay loud non-operational channels — see design §2).
 */
export class DocLoadOperationalError extends Error {
  readonly code: 'DOC_LOAD_OPERATIONAL' = 'DOC_LOAD_OPERATIONAL'
  /** The exact original store-read failure. Never concatenated into message. */
  override readonly cause: unknown
  constructor(cause: unknown, message = 'loadDoc operational failure: the underlying store read rejected') {
    super(message)
    this.name = 'DocLoadOperationalError'
    this.cause = cause
  }
}

/**
 * Stable typed create operational error (issue #108, ADR-0009 §Persistence
 * 错误演进).
 *
 * Thrown only when a store-level I/O operation the create itself performed
 * rejected (probe read or the initial snapshot write) while the lifecycle is
 * current. `committed` is the authoritative literal fact: an operational
 * create failure ALWAYS predates the commit point, so the store is unchanged.
 *
 * Boundary note: this classification TRUSTS the PersistenceIO contract
 * (§3.1). The lifecycle cannot re-verify the store after a rejection (re-read
 * verification was rejected as TOCTOU-prone, §3.2 (c)). If an adapter or a
 * wired write hook VIOLATES the contract by partially committing and then
 * rejecting, this error's committed:false would be wrong for the violated
 * portion — that is an adapter bug (seam violation), NOT an operational
 * failure misclassification. AC6 is conserved by CONTRACT (§3.1 obligations:
 * no synchronous throw, no reject-after-partial-commit, resolve ⟺ committed),
 * not by mechanism.
 */
export class DocCreateOperationalError extends Error {
  readonly code: 'DOC_CREATE_OPERATIONAL' = 'DOC_CREATE_OPERATIONAL'
  /** Authoritative: nothing was committed (the failure predates the commit point). */
  readonly committed: false = false
  /** The exact original store failure. Never concatenated into message. */
  override readonly cause: unknown
  constructor(cause: unknown, message = 'createDoc operational failure: the store rejected before commit') {
    super(message)
    this.name = 'DocCreateOperationalError'
    this.cause = cause
  }
}

/**
 * Stable phase vocabulary for create fatal failures — Persistence create
 * pipeline stages (issue #108). Layered SEPARATELY from the Registry fatal
 * phases of ADR-0009 §Fatal、错误与 observability (runtime-construction /
 * create-document-internal / lifecycle-slot-internal), which describe
 * Registry-side construction stages; these describe where the Persistence
 * create pipeline failed.
 */
export type DocCreateFatalPhase =
  | 'probe-read'        // claim 阶段 store 读证据获取被生命周期终结（committed:false）
  | 'snapshot-encode'   // Y.encodeStateAsUpdate 内部失败，pre-commit（committed:false）
  | 'store-write'       // 提交写被生命周期终结（abort），提交段未执行（committed:false）
  | 'post-commit'       // 提交点跨越之后的任何失败（committed:true）

/**
 * Frozen phase → authoritative commit fact. post-commit is the only true.
 * Exported (additive): 测试套件与未来消费方可直接锁定映射表本身，无需逐
 * phase 构造实例反推。
 */
export const DOC_CREATE_FATAL_PHASE_COMMITTED: Readonly<Record<DocCreateFatalPhase, boolean>> = Object.freeze({
  'probe-read': false,
  'snapshot-encode': false,
  'store-write': false,
  'post-commit': true,
})

/**
 * Committed-aware create fatal (issue #108, ADR-0009 §Persistence 错误演进,
 * ADR-0008 §Fatal 与失败通道 同款纪律). Carries the stable pipeline phase, the
 * AUTHORITATIVE commit fact (derived from the frozen phase map — callers can
 * trust it and must never re-derive or second-guess), and the exact original
 * cause. Never claims, promises, or performs rollback: a committed:true fatal
 * leaves the committed snapshot in the store; the caller must not retry
 * create (a retry observes DOC_DUPLICATE).
 */
export class DocCreateFatalError extends Error {
  readonly code: 'DOC_CREATE_FATAL' = 'DOC_CREATE_FATAL'
  readonly phase: DocCreateFatalPhase
  /** Authoritative commit fact for the initial snapshot (derived from phase). */
  readonly committed: boolean
  /** The exact original failure. Never concatenated into message. */
  override readonly cause: unknown
  constructor(phase: DocCreateFatalPhase, cause: unknown, message = 'createDoc fatal: internal create failure') {
    super(message)
    this.name = 'DocCreateFatalError'
    this.phase = phase
    this.committed = DOC_CREATE_FATAL_PHASE_COMMITTED[phase]
    this.cause = cause
  }
}

export const NOMICORE_PERSISTENCE_SERVICE = 'nomicorePersistence' as const

export interface PersistenceSchedule {
  readonly debounceMs: number
  readonly maxDirtyMs: number
}

export const DEFAULT_PERSISTENCE_SCHEDULE: Readonly<PersistenceSchedule> = Object.freeze({
  debounceMs: 500,
  maxDirtyMs: 5_000,
})

/**
 * The delayed-scheduling seam injected into every adapter (property-signature
 * form so the AC4 static guard can distinguish host-global timer APIs from
 * injected seam members). Scheduling only: wall-clock observation belongs to
 * `ctx.clock`, never to this seam.
 */
export interface PersistenceScheduler {
  readonly setTimeout: (callback: () => void, delayMs: number) => unknown
  readonly clearTimeout: (handle: unknown) => void
}

export function resolvePersistenceSchedule(
  config: Partial<PersistenceSchedule> = {},
): PersistenceSchedule {
  const schedule: PersistenceSchedule = {
    debounceMs: config.debounceMs ?? DEFAULT_PERSISTENCE_SCHEDULE.debounceMs,
    maxDirtyMs: config.maxDirtyMs ?? DEFAULT_PERSISTENCE_SCHEDULE.maxDirtyMs,
  }

  for (const [name, value] of Object.entries(schedule)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`persistence schedule ${name} must be a finite non-negative number`)
    }
  }

  return Object.freeze(schedule)
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    nomicorePersistence: DocPersistence
  }
}

export function provideNomicorePersistence(ctx: Context, persistence: DocPersistence): () => void {
  return ctx.provide(NOMICORE_PERSISTENCE_SERVICE, persistence)
}

export function requireNomicorePersistence(ctx: Context): DocPersistence {
  const persistence = ctx.get(NOMICORE_PERSISTENCE_SERVICE)
  if (persistence === undefined) {
    throw new Error('required Cordis service "nomicorePersistence" is unavailable')
  }
  return persistence
}
