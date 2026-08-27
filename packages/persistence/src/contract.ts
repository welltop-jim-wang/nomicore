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

/** Y.Doc 的跨包引用别名（Phase 5）：registry 主入口可达声明图禁止出现 `Y.Doc`
 *  标识符文本（registry-surface.test.ts:42-47 冻结审计），故由本包给出中性命名别名。
 *  类型上恒等于 Y.Doc（别名，非结构复制）。 */
export type YjsDoc = Y.Doc

/**
 * 复制身份引用（N-1 冻结形状）：ADR 0010:46-48 冻结字段的包装。
 *  replicationId 恒 32 位小写 hex；replicationEpoch 恒 >=1 的安全整数
 *  （由各读取器的格式门保证——本类型自身不携带运行时校验）。
 */
export interface ReplicationIdentityRef {
  readonly replicationId: string
  readonly replicationEpoch: number
}

/**
 * 已核对复制身份的 checked 表达（R2 严格双真相源 preflight，设计 §3.2/§3.3.1）：
 * `{ok:false}` 是「合法读取但无匹配的 enabled 复制身份」——两键缺席/恰一键/
 * 显式 undefined/格式违约均为该分支（**不带任何字段值**，零泄露）；
 * `{ok:true, value}` 携带已验证合规的 {replicationId, replicationEpoch}。
 */
export type CheckedReplicationIdentity =
  | Readonly<{ ok: true; value: ReplicationIdentityRef }>
  | Readonly<{ ok: false }>

/**
 * 只读 committed-snapshot identity probe 的公共可见结果（R2，设计 §3.3.1）：
 * - `{kind:'found', identity}`：主快照存在且解码成功（id 合规）——identity 的
 *   ok 分支表达「复制事实合规的上报」；
 * - `{kind:'missing'}`：主快照不存在（独立于 live cell 的持久化存在性事实）。
 * 读取失败/损坏/终结/违约经 typed rejection（不必达本联合）。
 */
export type PersistedIdentityProbeResult =
  | Readonly<{ kind: 'found'; identity: CheckedReplicationIdentity }>
  | Readonly<{ kind: 'missing' }>

/**
 * The persistence seam shared by all adapters.
 *
 * The Cordis service name exposed by this interface is `nomicorePersistence`
 * (`NOMICORE_PERSISTENCE_SERVICE`).
 *
 * Phase 5（issue #133）扩展（设计 §4.4 optional 成员裁决）：复制导入与归档为
 * optional 成员——13 个既有测试 stub 类与三成员字面量绿守卫在 required 形态下将
 * 全部编译红（>10 caller 契约改动立法）；required 保证面由派生接口
 * `ReplicaPersistence` 表达。第三方 Adapter 可不具备复制能力；复制编排方
 * （Registry）必须 typeof 窄化并对缺席 loud 拒绝，不得静默降级（INV-13）。
 */
export interface DocPersistence {
  createDoc(owner: User, docId: string, doc: Y.Doc): Promise<DocHandle>
  loadDoc(owner: User, docId: string): Promise<DocHandle | null>
  saveDoc(handle: DocHandle): Promise<void>
  /**
   * Phase 5 受控复制导入（ADR 0010:65/218）：从 detached、已由调用方核对身份的
   * 完整 Y.Doc 排他创建持久副本。语义 = createDoc 同管线（claim 排他 / 提交点 /
   * handle.doc === doc / 失败不接管 doc）；唯一差异 = META.docId 违约以
   * DocImportIdentityError 稳定分类（createDoc 保持既有 bare error，零回归）。
   *
   * Optional 成员建模（§4.4）：Memory/File 恒提供；第三方 Adapter 可不支持——
   * 复制编排方（Registry）必须 typeof 窄化并对缺席 loud 拒绝，不得静默降级。
   */
  readonly importDoc?: (owner: User, docId: string, doc: Y.Doc) => Promise<DocHandle>
  /**
   * Phase 5 受身份前置条件保护的归档（ADR 0010:57 / phase:63）。仅在无有效
   * handle（且在途 dirty 已排空）时执行；身份核对以持久快照复制事实为权威。
   * 成功 ⟹ 主键 snapshot 移入受控归档区、loadDoc → null、slot 可重建。
   * 拒绝经 typed rejection 四分类 + committed-aware fatal（§4.5 矩阵）。
   */
  readonly archiveDoc?: (
    owner: User,
    docId: string,
    expectedReplicationIdentity: ReplicationIdentityRef,
  ) => Promise<Readonly<{ ok: true }>>
  /**
   * R2 只读 committed-identity probe（设计 §3.3/§3.3.1，内部 ReplicaPersistence
   * capability；第三方 Adapter 可不具备——Registry 在任何破坏性动作前必须
   * `typeof` 窄化并对缺席 loud 拒绝，不得 fallback 到 loadDoc/live）。
   *
   * 契约：读取**已提交主快照**（owner 分区 key + io.read）并在 detached 临时
   * Y.Doc 解码；验证 META.docId === docId；按复制事实判据族读取身份。不签发
   * handle、不建 live cell、不调用 saveDoc、不排空 dirty、不写/flush/archive。
   * 返回/拒绝面见 PersistedIdentityProbeResult 与 probe 错误三分类。
   */
  readonly readPersistedReplicationIdentity?: (
    owner: User,
    docId: string,
  ) => Promise<PersistedIdentityProbeResult>
}

/** 具备复制生命周期能力的 Persistence 面（required 形态）：Memory/File 实现；
 *  消费方（测试锚 / 未来 ws-replication）以此表达「必然可达」。 */
export interface ReplicaPersistence extends DocPersistence {
  readonly importDoc: (owner: User, docId: string, doc: Y.Doc) => Promise<DocHandle>
  readonly archiveDoc: (
    owner: User,
    docId: string,
    expectedReplicationIdentity: ReplicationIdentityRef,
  ) => Promise<Readonly<{ ok: true }>>
  readonly readPersistedReplicationIdentity: (
    owner: User,
    docId: string,
  ) => Promise<PersistedIdentityProbeResult>
}

/** 受控复制导入的身份违约（稳定分类，phase:65「identity mismatch」导入位）。
 *  导入面唯一新增 typed 拒绝；duplicate 复用冻结 DocDuplicateError，
 *  operational/fatal 复用冻结 create 族（§4.3 论证）。 */
export class DocImportIdentityError extends Error {
  readonly code: 'DOC_IMPORT_IDENTITY_MISMATCH' = 'DOC_IMPORT_IDENTITY_MISMATCH'
  constructor(message = 'importDoc identity mismatch: doc META.docId does not match the requested docId') {
    super(message)
    this.name = 'DocImportIdentityError'
  }
}

/** 归档身份前置条件拒绝（单一谓词，§4.5.4：错 id / 错 epoch / 缺失 / 损坏 /
 *  META.docId 不符 统一归本类——SA6 边缘提示 8 裁决为 identity mismatch 族，
 *  不另立第五类 corrupt 码）。 */
export class DocArchiveIdentityError extends Error {
  readonly code: 'DOC_ARCHIVE_IDENTITY_MISMATCH' = 'DOC_ARCHIVE_IDENTITY_MISMATCH'
  constructor(message = 'archiveDoc identity mismatch: the persisted replication identity does not match the expected identity') {
    super(message)
    this.name = 'DocArchiveIdentityError'
  }
}

/** 归档前置违约：key 仍持有 live handle（phase:63「仅在无有效 handle 时执行」）。 */
export class DocArchiveActiveHandleError extends Error {
  readonly code: 'DOC_ARCHIVE_ACTIVE_HANDLE' = 'DOC_ARCHIVE_ACTIVE_HANDLE'
  constructor(message = 'archiveDoc rejected: the document still has live handles') {
    super(message)
    this.name = 'DocArchiveActiveHandleError'
  }
}

/** 归档重复：守卫读取时主键无 committed snapshot（覆盖「已归档后二次归档」与
 *  「从未存在」两形态——SA6 stub 同款语义）。 */
export class DocArchiveDuplicateError extends Error {
  readonly code: 'DOC_ARCHIVE_DUPLICATE' = 'DOC_ARCHIVE_DUPLICATE'
  constructor(message = 'archiveDoc duplicate: no committed snapshot exists under this key') {
    super(message)
    this.name = 'DocArchiveDuplicateError'
  }
}

/** 归档运营失败（guard-read / relocate-write 的 store 级拒绝；committed:false 权威——
 *  两阶段均在提交点之前）。cause 保留 exact 原始失败；message 恒不拼接。 */
export class DocArchiveOperationalError extends Error {
  readonly code: 'DOC_ARCHIVE_OPERATIONAL' = 'DOC_ARCHIVE_OPERATIONAL'
  readonly committed: false = false
  override readonly cause: unknown
  constructor(cause: unknown, message = 'archiveDoc operational failure: the store rejected before the archive commit') {
    super(message)
    this.name = 'DocArchiveOperationalError'
    this.cause = cause
  }
}

/** 归档 fatal phase 词表（镜像 DocCreateFatalPhase 纪律，contract.ts:115-131）。 */
export type DocArchiveFatalPhase =
  | 'guard-read'       // 身份核对读被生命周期终结（committed:false）
  | 'relocate-write'   // 归档写被生命周期终结（写公理：reject ⟹ 归档区未变，committed:false）
  | 'relocate-remove'  // 归档写已 resolve（提交点跨越）后，主键移除段失败（committed:true）

/** 冻结 phase → 权威 commit 事实（relocate-remove 是唯一 true）。导出（additive），
 *  沿 DOC_CREATE_FATAL_PHASE_COMMITTED 先例供测试/消费方锁定映射本身。 */
export const DOC_ARCHIVE_FATAL_PHASE_COMMITTED: Readonly<Record<DocArchiveFatalPhase, boolean>> = Object.freeze({
  'guard-read': false,
  'relocate-write': false,
  'relocate-remove': true,
})

export class DocArchiveFatalError extends Error {
  readonly code: 'DOC_ARCHIVE_FATAL' = 'DOC_ARCHIVE_FATAL'
  readonly phase: DocArchiveFatalPhase
  /** Authoritative commit fact (derived from the frozen phase map). */
  readonly committed: boolean
  /** The exact original failure. Never concatenated into message. */
  override readonly cause: unknown
  constructor(phase: DocArchiveFatalPhase, cause: unknown, message = 'archiveDoc fatal: internal archive failure') {
    super(message)
    this.name = 'DocArchiveFatalError'
    this.phase = phase
    this.committed = DOC_ARCHIVE_FATAL_PHASE_COMMITTED[phase]
    this.cause = cause
  }
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
 * R2 只读 identity probe 的**运营失败**（设计 §3.3.1）：io.read 在生命周期
 * epoch 仍然有效时拒绝——唯一普通运营映射（Registry → NAMESPACE_LOAD_FAILED）。
 * `committed:false` 是强制性事实：本 seam 从不写入/转移所有权（INV-12）。
 * cause 保留 exact 原始失败；message 恒为稳定常量、零 owner/identity/bytes 回显。
 */
export class DocPersistedIdentityProbeOperationalError extends Error {
  readonly code: 'DOC_PERSISTED_IDENTITY_PROBE_OPERATIONAL' = 'DOC_PERSISTED_IDENTITY_PROBE_OPERATIONAL'
  readonly committed: false = false
  override readonly cause: unknown
  constructor(
    cause: unknown,
    message = 'persisted identity probe operational failure: the trusted store read rejected',
  ) {
    super(message)
    this.name = 'DocPersistedIdentityProbeOperationalError'
    this.cause = cause
  }
}

/**
 * R2 只读 identity probe 的**损坏分类**（设计 §3.3.1）：快照字节无法解码为
 * Yjs、META 载体非法、或 META.docId !== 请求 docId——主快照不可信，loud
 * committed:false fatal（Registry 不得折叠为 mismatch 或 load-failed）。
 */
export class DocPersistedIdentityProbeCorruptError extends Error {
  readonly code: 'DOC_PERSISTED_IDENTITY_PROBE_CORRUPT' = 'DOC_PERSISTED_IDENTITY_PROBE_CORRUPT'
  readonly committed: false = false
  override readonly cause: unknown
  constructor(
    cause: unknown,
    message = 'persisted identity probe corrupt: the committed snapshot cannot be trusted',
  ) {
    super(message)
    this.name = 'DocPersistedIdentityProbeCorruptError'
    this.cause = cause
  }
}

/** R2 只读 identity probe fatal phase 词表（镜像 DocArchiveFatalPhase 纪律）。 */
export type DocPersistedIdentityProbeFatalPhase =
  | 'read-aborted'        // io.read 因 dispose/epoch 终结被 abort（committed:false）
  | 'decode'              // 生命周期终结后的解码损坏（commit 事实不可验证）
  | 'lifecycle-disposed'  // 入口时 lifecycle 已 dispose（committed:false）
  | 'adapter-violation'   // io.read 同步 throw（PersistenceIO 契约违约）

/** R2 只读 identity probe 的**终结/违约 fatal**（设计 §3.3.1）：dispose 竞态、
 *  契约违约等——committed:false 恒成立（本 seam 从不写/转移所有权）。 */
export class DocPersistedIdentityProbeFatalError extends Error {
  readonly code: 'DOC_PERSISTED_IDENTITY_PROBE_FATAL' = 'DOC_PERSISTED_IDENTITY_PROBE_FATAL'
  readonly committed: false = false
  readonly phase: DocPersistedIdentityProbeFatalPhase
  override readonly cause: unknown
  constructor(
    phase: DocPersistedIdentityProbeFatalPhase,
    cause: unknown,
    message = 'persisted identity probe fatal: internal probe failure',
  ) {
    super(message)
    this.name = 'DocPersistedIdentityProbeFatalError'
    this.phase = phase
    this.cause = cause
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
