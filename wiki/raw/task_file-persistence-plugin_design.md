# SA1 架构设计 — FilePersistence Cordis 插件：用户分区、缓存与崩溃恢复（Issue #58, P3）

> 阶段：Phase 2 架构设计（R2 文档债修订——落实 SA4 静态验尸回流件 F-1/F-2，见文末「SA4 回流文档债回应」；R1 的 SA2 5 项修订与架构决策 A–F 均未变）
> 任务简报：`wiki/raw/task_file-persistence-plugin.md`
> ADR 约束基准：`wiki/raw/task_file-persistence-plugin_relevant_decisions.md`（ADR-0006 为核心 ADR，条款全部为直接约束）
> 红灯锚点：`packages/persistence/test/file-persistence.test.ts`（SA6 已锚定，EXIT=1；`Test Files 1 failed | 32 passed`，其余 480 用例全绿）
> 基线：`adr/server-design` ← `fix/issue-58-on-adr-server-design`（P2 已随 653af45 / 37561ac 落地）
> worktree：`/home/wangjian/nomicore-fix-issue-58`

---

## §1. 需求推演（Feature）

**任务本质**：ADR-0006 的第二个真实 Adapter。P2 已把「cache/handle/lease/调度/单飞 flush/generation/degraded-retry」整套 lifecycle 完整实现了一遍——但它是作为 `MemoryPersistence` 的**私有成员内嵌**在 `src/memory.ts` 里的，没有可复用的形态。本任务的真实工程动作是两步：

1. **把 P2 lifecycle core 从 `MemoryPersistence` 中抽取为共享内核**（`src/lifecycle.ts`，包内内部模块），行为逐字保持不变；
2. **新建 `src/file.ts`**：`FilePersistence` 继承该内核，仅提供文件系统 I/O 后端（用户分区路径、tmp+rename 原子提交、遗留 tmp 清扫、身份文法校验），不含任何第二套调度/lease 逻辑。

简报验收标准「复用 P2 lifecycle core …… 不得复制第二套」的**可审计判据**：`src/file.ts` 中不允许出现任何 debounce/max-dirty/retry/generation/degraded/eviction/WeakMap-lease 逻辑；这些代码在 `src/lifecycle.ts` 中只存在一份。`describeDocPersistenceContract(FilePersistence 工厂)` 双 Adapter 行为一致即复用证明（SA6 已接线）。

**关键边界（来自 ADR-0006，实现不可越界）**：
- 持久层只看 Y.Doc，不看 SCHEMA/META/ROOT 语义（META 仅校验 `docId` 一项，其余透传）；
- v1 无 fsync、无 WAL、无文件锁（单进程）、无 list；
- flush = `Y.encodeStateAsUpdate` 全量快照 + tmp + 原子 rename，rename 成功即一次 flush 完成；
- `saveDoc` 是脏通知不是落盘承诺；创建 = 首个 `saveDoc`。

## §2. 现状资产盘点（设计起点）

| 资产 | 位置 | 状态 | 本任务处置 |
|---|---|---|---|
| `DocPersistence`/`DocHandle`/`User` 契约、schedule 默认值、`PersistenceTimer`、Cordis service 注册 | `src/index.ts` | P1 已锁定，SA6 契约测试绿色 | 仅追加 4 个 re-export（§4.4），既有导出一个不动 |
| 共享契约套件 `describeDocPersistenceContract` | `src/testing.ts` | P1 落地 | **不动**；SA6 已用它接线 FilePersistence |
| lifecycle core（Entry/DocHandle/handle 归属 WeakMap/并发合流 loading/调度/单飞 flush/generation/degraded-retry/evict/dispose-epoch） | `src/memory.ts`（`MemoryPersistence` 私有内嵌） | P2 落地，测试全绿 | **整体搬迁**至新 `src/lifecycle.ts`，`memory.ts` 瘦身为子类（§4.1–4.2） |
| `MemoryPersistenceOptions.readSnapshot/writeSnapshot` 注入式 I/O 缝 | `src/memory.ts` | P2 落地（仅测试使用） | 签名逐字保持；经 adapter 桥接到新内核缝（§4.2） |
| `createMemoryHandleForTest`（test-only 创建路径，不入公共导出） | `src/memory.ts` + `test/memory-testkit.ts` | P2 惯例 | `file.ts` 镜像同惯例（§4.3.4） |

**caller 审计（grep 证实）**：`@nomicore/persistence` 当前无任何包外消费者（`apps/`、其他 `packages/` 均未引用）；`MemoryPersistence` 的全部 caller 在本包 `src/index.ts`（re-export）与 `test/` 内。重构半径完全收敛于包内。

## §3. 架构决策

### 决策 A：抽取共享内核 `src/lifecycle.ts`（继承模型），而非组合/复制

**选定**：新建内部模块 `src/lifecycle.ts`，导出抽象基类 `PersistenceLifecycleCore`。`MemoryPersistence` 与 `FilePersistence` 均继承它。内核持有 P2 的全部机制：Entry 缓存、`loading` 并发合流、handle 归属 WeakMap（lease 身份不可伪造）、debounce/max-dirty/retry 三计时器、单飞 flush + dirtyGeneration/savedGeneration 保序、degraded→retry→ready 状态机、epoch 防复活、dispose 语义、Cordis `apply` 注册。Adapter 只实现两个受保护抽象 I/O 方法 + 可选钩子。

**为何不是组合（`FilePersistence` 内部包一个注入了文件回调的 `MemoryPersistence`）**：
1. `MemoryPersistence.writeSnapshot` 无条件把快照写进内部 `snapshots` Map（memory.ts:253-258）——组合会让 FilePersistence 双写（磁盘 + 内存全量副本），这是内存泄漏级别的缺陷；修它就得给 MemoryPersistenceOptions 加"关掉内部存储"的开关，把文件适配器的关注点污染进内存适配器的公共 options。
2. handle 归属校验 `HANDLE_OWNER.get(handle) !== this` 以持久层实例为身份——组合对象与内核实例身份不一致，需要再包一层转发，公共面（`ctx.get('docPersistence') === plugin.instance`）也要转发 5 个方法，复杂度反超继承。
3. 继承模型让「不得复制第二套」变成可 grep 的事实：调度/generation/degraded 代码物理上只存在于 `lifecycle.ts`。

**为何不是给 `MemoryPersistence` 加文件能力**：ADR-0006 明文「`MemoryPersistence` 与 `FilePersistence` 是两个真实 Adapter（两个 Adapter 证明 seam 不是假想抽象）」。合并成一个类推翻该 ADR 条款，无充分理由。

### 决策 B：内核 I/O 缝的形态——`(user, docId, signal)` 三参，非 `key` 单参

现有 memory 私有缝是 `(key, snapshot, signal)`，`key = userId\0docId`。文件适配器要分别用 `userId`（目录段）和 `docId`（文件名段）构造路径，拆 `\0` 是丑陋且易错的。内核的 `readCommittedSnapshot`/`writeCommittedSnapshot` 直接以 `(user, docId, signal)` 为参（Entry 本就持有 user/docId）。`MemoryPersistence` 在桥接层把 `toPersistenceKey(user, docId)` 折回 `key` 传给既有公共回调，**公共回调签名逐字不变**（P2 测试断言不变绿的前提）。

### 决策 C：身份文法校验放在 `validateIdentity` 钩子（file 专属，memory 不启用）

`^[a-z][a-z0-9-]{0,62}$` 是 ADR-0006 对 userId/namespaceId 共用的安全文法（「不允许特殊字符/路径分隔符」，标识符由 NomicoreServer 分配的**受控**路径段）。这是文件系统的路径安全约束，属于 file adapter 的领地；内存适配器的 key 无路径语义，不该被迫校验（其 P2 测试用 `contract-user` 等 id 仍合法，但内核不该越权替所有适配器立法）。

内核在 `loadDoc`/`saveDoc`/test 工厂入口统一调用 `this.validateIdentity(user, docId)`（默认 no-op）；`FilePersistence` 覆写为对两段各做一次文法断言，**违例即 loud throw**（拒绝虚假降级：非法标识符不是"降级返回 null"的场景，是上游 bug/攻击，必须响亮失败——SA6 用 `rejects.toThrow()` 钉死）。

**纵深防御**：`resolveSnapshotPaths()` 内部再次调用同一校验后才 `path.join`——即使未来出现绕过入口校验的新调用路径，路径构造也永远见不到未验证段。双保险成本是一次正则，收益是"路径穿越不可能性"不依赖单一调用点纪律。

### 决策 D：公共 API 面严格等于 SA6 假设清单，零增项

SA6 简报附录已锚定公共契约：`FilePersistence`、`createFilePersistencePlugin`、`FilePersistenceOptions`、`FilePersistenceStatus`（经 `src/index.ts` re-export）+ `createFileHandleForTest`（仅 `src/file.js` 模块路径，不入包公共导出）。**不加** `createFilePersistence`（对应 `createMemoryPersistence` 的对称工厂）：SA6 未锚定、无消费者，YAGNI；将来需要时是纯增量导出。`FilePersistenceStatus` 是 `'ready' | 'persistence-degraded' | 'disposed'` 的别名（单一来源：内核 `PersistenceStatus`，包内可见）。

### 决策 E：遗留 `.tmp` 的清扫时机——load 路径惰性清扫（含 ENOENT 分支），不做启动全树扫描

ADR-0006：「启动发现遗留 `.tmp` 时一律忽略并删除」。本设计落地为：**`loadDoc` cache-miss 的还原路径中，无论 `.snapshot` 命中与否，一律 best-effort 删除该 namespace 的 `.tmp`**。理由：

1. 「忽略」是无条件的（`.tmp` 永不被读取）——本设计在所有路径上满足；
2. **启动全树清扫破坏 HMR/reload 下的单写者前提**（R1 重写论据，SA2 #1）：ADR-0006 插件条款明文「插件采用工厂/实例模型……以支持测试隔离、不同 rootDir 与 HMR/reload」。HMR 场景中新旧实例可能短暂共存且共享同一 rootDir：新实例的启动清扫会 unlink 旧活跃实例**在途 flush** 的 `.tmp`，旧实例随后 `rename(tmp, snapshot)` 得到 ENOENT → 按异常路径进入 `persistence-degraded` → 活链路上的 WS/REST 写被拒——一次卫生清扫把健康的写路径打挂。惰性清扫不存在该竞态：单实例内 cache-miss ⇒ 该 namespace 无 Entry ⇒ 无在途 flush（`maybeEvict` 以 `!flushing` 为前置，Entry 驱逐必晚于 flush 完成），清扫不可能与自身 flush 相碰（SA2 复审已独立论证此点并列入「攻击后确认无漏洞的面」）；
3. 惰性清扫被 SA6 两个用例精确钉死：tmp-only → load 返回 null 且 tmp 被删；snapshot+tmp → snapshot 胜出且 tmp 被删。**清扫的真实覆盖面 = 重启后再次被 `loadDoc` 访问的 namespace**（见决策 E.1 残留披露）；flush 的 `writeFile(tmp, flag 'w')` 对遗留 tmp 的截断**没有边际覆盖**——生产路径再次 flush 某 namespace 前必先经 `loadDoc` 取得 handle，而 loadDoc 已先行清扫，截断只是同一条清扫面的重复表述（R1 勘误：R0 的「清扫面自然闭合」为错误论证）；
4. 删除失败（如用户目录只读）**不阻断 load**：`.tmp` 是惰性无害文件，读权限与删权限可能不一致；同一磁盘状况会在下一次 flush 的 `writeFile` 上**响亮**浮出（degraded→retry），不会静默丢失信号（该论证的 POSIX 平台限定见 §4.5 矩阵对应行）。

#### 决策 E.1：ADR 解释与残留披露（解释性偏离，供 owner 复核；R1 新增，SA2 #1）

- **解释性偏离**：ADR-0006 文本是「**启动**发现遗留 `.tmp` 时一律忽略并删除」；本设计把「删除」的时点解释为「该 namespace 被 `loadDoc` 时」（「忽略」仍无条件立即满足——`.tmp` 在任何路径上永不被读取）。依据：① 任务简报验收条款本身即 load 时点表述（「load 只认 `.snapshot`；遗留 `.tmp` 一律忽略并删除」被 SA6 锚定到 loadDoc 用例，见简报映射表）；② 启动清扫存在理由 2 的 HMR 单写者竞态。该偏离为**解释性、非机制性**，记录于此供 owner / ADR 维护者复核。
- **残留集合**：设崩溃瞬间在途 flush 的 namespace 集合为 S。重启后残留 `.tmp` 仅在对应 namespace 再次 `loadDoc` 时被删除；S 中**从未再被访问**的子集，其 `.tmp` 将**永久滞留**——体积为快照级（≈ 该 doc 全量 `encodeStateAsUpdate` 字节数），跨多次崩溃单调只增不减，上界 ≈ namespace 数 × 各自快照大小。滞留 tmp 对运行时无影响（永不被读、不阻塞任何读写路径），但会误导运维（看似 pending 写入）。
- **回收途径**：v1 不内置（启动清扫即理由 2 的竞态来源）；运维侧离线清理（停机后 `find {rootDir}/users -name '*.snapshot.tmp' -delete`）或 v2 引入带 `apply()` 时机 + `track()` + epoch 防护的单写者启动清扫。若 owner 判定 v1 必须启动期全量卫生清扫，须另行评估上述方案并显式接受 HMR 竞态风险——SA2 评审与本设计均不推荐。

### 决策 F：不引入 fsync / 文件锁 / 目录预热，全部沿用 ADR-0006 v1 边界

- rename 成功即 flush 完成，无 file/dir fsync（ADR 明文）；
- 单进程假设，跨实例指向同一 rootDir 属调用方错误，v1 不做文件锁（ADR「v1 限制：单进程（无文件锁）」）——SA6 只钉死**不同** rootDir 互不影响；
- `users/{userId}` 目录在**首次 flush 时** `mkdir recursive` 惰性创建；load 路径只读（除 tmp 清扫的 unlink），不创建任何目录——「load miss 不留痕迹」。

---

## §4. 详细设计

### §4.1 新建 `src/lifecycle.ts` —— 共享 lifecycle 内核（包内内部模块）

**搬迁原则**：除决策 B/C 列明的缝改造外，代码从 `memory.ts` **逐字搬迁**。搬迁不改行为，是 480 个既有用例保持全绿的结构性保证。TS 配置为 `strict + exactOptionalPropertyTypes + noImplicitOverride + verbatimModuleSyntax`（`tsconfig.base.json`），伪代码按此约束书写（R1 勘误：`PersistenceCoreOptions` 两个桥接字段显式标注 `| undefined`，消除 SA2 #2 实测的 TS2379）。

```ts
// src/lifecycle.ts — internal shared lifecycle core (NOT re-exported from index.ts)
import type { Context } from '@deepseek-ai/cordis'
import * as Y from 'yjs'
import {
  provideDocPersistence,
  resolvePersistenceSchedule,
  systemPersistenceTimer,
  type DocHandle, type DocPersistence,
  type PersistenceSchedule, type PersistenceTimer, type User,
} from './index.js'

export type PersistenceStatus = 'ready' | 'persistence-degraded' | 'disposed'

/** Internal test-only creation seam; module-private to the package. */
export const CORE_TEST_FACTORY = Symbol('persistence core test factory')

export interface PersistenceCoreOptions {
  /** Adapter name for loud error messages, e.g. 'FilePersistence is disposed'. */
  readonly name: string
  /**
   * R1（SA2 #2）：`| undefined` 在 exactOptionalPropertyTypes 下是必需的——
   * 子类桥接 `super({ schedule: options.schedule, timer: options.timer })` 时，
   * 读取可选属性得到的类型是 `Partial<PersistenceSchedule> | undefined`，
   * 赋给不带 `| undefined` 的 `schedule?:` 会触发 TS2379（SA2 已用仓库锁定
   * typescript@5.9.3 + 同套旗标实测复现，EXIT=2）。
   */
  readonly schedule?: Partial<PersistenceSchedule> | undefined
  readonly timer?: PersistenceTimer | undefined
}

interface CoreEntry {                       // == 现 memory.ts Entry，逐字
  readonly key: string; readonly user: User; readonly docId: string
  readonly doc: Y.Doc; readonly handles: Set<CoreDocHandle>
  dirtyGeneration: number; savedGeneration: number; flushing: boolean; retryDelayMs: number
  debounceTimer?: unknown; maxDirtyTimer?: unknown; retryTimer?: unknown
}

const HANDLE_OWNER = new WeakMap<CoreDocHandle, PersistenceLifecycleCore>()
const RELEASE = new WeakMap<PersistenceLifecycleCore, (handle: CoreDocHandle) => void>()

export class CoreDocHandle implements DocHandle {   // == 现 MemoryDocHandle，逐字
  private released = false
  constructor(
    private readonly persistence: PersistenceLifecycleCore,
    public readonly user: User, public readonly docId: string,
    public readonly doc: Y.Doc, readonly entryKey: string,
  ) { HANDLE_OWNER.set(this, persistence) }
  async release(): Promise<void> {
    if (this.released) return
    this.released = true
    RELEASE.get(this.persistence)!(this)
  }
  get isReleased(): boolean { return this.released }
}

export abstract class PersistenceLifecycleCore implements DocPersistence {
  protected readonly schedule: PersistenceSchedule
  protected readonly timer: PersistenceTimer
  protected readonly entries = new Map<string, CoreEntry>()
  protected readonly loading = new Map<string, Promise<CoreEntry | null>>()
  private readonly inFlight = new Set<Promise<unknown>>()
  private readonly abortController = new AbortController()
  protected status: PersistenceStatus = 'ready'
  private closed = false
  private epoch = 0

  protected constructor(protected readonly coreOptions: PersistenceCoreOptions) {
    this.schedule = resolvePersistenceSchedule(coreOptions.schedule)
    this.timer = coreOptions.timer ?? systemPersistenceTimer
    RELEASE.set(this, (handle) => this.releaseHandle(handle))
  }

  getStatus(): PersistenceStatus { return this.status }

  async loadDoc(user: User, docId: string): Promise<DocHandle | null> {
    this.assertReadable()
    this.validateIdentity(user, docId)                 // ← 决策 C 新增（默认 no-op）
    // ……与现 memory.ts loadDoc 完全一致：entries 命中 → 发 handle；
    // 未命中 → loading 合流（单 loading Promise，所有并发 load await 同一还原），
    // restoreEntry 成功建 Entry，null 则返回 null。
  }

  async saveDoc(handle: DocHandle): Promise<void> {
    this.assertWritable()
    this.validateIdentity(handle.user, handle.docId)   // ← 决策 C 新增（防御纵深，成本一次正则）
    // ……与现 memory.ts saveDoc 完全一致：assertOwnedHandle（foreign/released → loud throw
    // 'foreign or released DocHandle'）→ dirtyGeneration += 1 → scheduleFlush。
  }

  /** Cordis owns service registration cleanup; this effect closes only adapter resources. */
  apply(ctx: Context): void {
    ctx.effect(() => {
      provideDocPersistence(ctx, this)
      return () => this.dispose()
    }, `${this.coreOptions.name}: service`)            // label 参数化：'FilePersistence: service'
  }

  async dispose(): Promise<void> {
    // ……与现 memory.ts dispose 完全一致：幂等（closed → 仅 allSettled(inFlight)）；
    // 同步段：closed=true、epoch+=1、status='disposed'、abortController.abort()、
    // 逐 entry clearTimers + handles.clear + doc.destroy、entries/loading 清空，
    // 然后调用 this.disposeAdapterState()（← 新增受保护钩子，见下），最后 await allSettled(inFlight)。
  }

  [CORE_TEST_FACTORY](user: User, docId: string): DocHandle {
    // == 现 memory.ts [TEST_FACTORY]：assertWritable → validateIdentity（← 新增）→
    // 命中 Entry 或新建 Entry(new Y.Doc()) → issueHandle。同步。
  }

  // ---- adapter seams -------------------------------------------------------
  /** Identity/path-safety gate; loud throw on violation. Default: no-op. */
  protected validateIdentity(user: User, docId: string): void { void user; void docId }
  /** Read the committed snapshot, or undefined when nothing was committed. */
  protected abstract readCommittedSnapshot(
    user: User, docId: string, signal: AbortSignal,
  ): Promise<Uint8Array | undefined>
  /** Durably commit a full-state snapshot; adapter defines atomicity. */
  protected abstract writeCommittedSnapshot(
    user: User, docId: string, snapshot: Uint8Array, signal: AbortSignal,
  ): Promise<void>
  /** Called by the core AFTER the epoch guard, before status='ready'. */
  protected onSnapshotCommitted(user: User, docId: string, snapshot: Uint8Array): void { void user; void docId; void snapshot }
  /** Synchronous adapter-resource release inside dispose's teardown section. */
  protected disposeAdapterState(): void {}

  // ---- 以下成员自 memory.ts 逐字搬迁，签名不变，仅可见性为 private/protected ----
  // releaseHandle / restoreEntry / createEntry / issueHandle / scheduleFlush /
  // onDebounce / onMaxDirty / startFlush / flush / scheduleRetry / maybeEvict /
  // cancelDebounce / cancelMaxDirty / clearTimers / track / assertOwnedHandle /
  // assertReadable / assertWritable / isCurrent
}

export function toPersistenceKey(user: User, docId: string): string {
  return `${user.userId}\u0000${docId}`               // == 现 memory.ts toKey
}
```

**`flush` 的两处结构性改动**（搬迁中唯一触及 I/O 缝的地方，行为不变）：

```ts
private async flush(entry: CoreEntry, epoch: number): Promise<void> {
  if (entry.flushing || entry.savedGeneration === entry.dirtyGeneration || !this.isCurrent(epoch)) return
  entry.flushing = true
  const generation = entry.dirtyGeneration
  const snapshot = Y.encodeStateAsUpdate(entry.doc)          // 全量快照，flush 启动时一次性捕获
  try {
    await this.writeCommittedSnapshot(entry.user, entry.docId, snapshot, this.abortController.signal)
    if (!this.isCurrent(epoch)) return
    this.onSnapshotCommitted(entry.user, entry.docId, snapshot)  // memory: 写内部 map；file: 无操作
    entry.savedGeneration = generation
    entry.retryDelayMs = this.schedule.debounceMs || 1
    this.status = 'ready'                                   // 退避成功后恢复可写
  } catch {
    if (!this.isCurrent(epoch)) return
    this.status = 'persistence-degraded'
    this.scheduleRetry(entry)
  } finally {
    // ……与现 memory.ts 完全一致：flushing 释放锁后，若 flush 期间有新 saveDoc
    //（dirtyGeneration 更大）且无 retry 挂起，则重排下一轮 debounce；maybeEvict。
  }
}
```

**`restoreEntry` 的缝改动**（其余逐字，含 META.docId 校验与 loud throw）：

```ts
private async restoreEntry(user: User, docId: string, key: string, epoch: number): Promise<CoreEntry | null> {
  const snapshot = await this.readCommittedSnapshot(user, docId, this.abortController.signal)
  if (!this.isCurrent(epoch)) return null
  if (!snapshot) return null                                // 无提交态 → loadDoc 返回 null
  const doc = new Y.Doc()
  Y.applyUpdate(doc, snapshot)                              // 损坏字节 → throw → loadDoc 响亮拒绝
  const metaDocId = doc.getMap('META').get('docId')
  if (metaDocId !== docId) {
    doc.destroy()
    throw new Error(`persisted META.docId ${String(metaDocId)} does not match requested docId ${docId}`)  // 匹配 /META\.docId/
  }
  if (!this.isCurrent(epoch)) { doc.destroy(); return null }
  const entry = this.createEntry(user, docId, key, doc)
  this.entries.set(key, entry)
  return entry
}
```

`assertReadable` 消息参数化为 `` `${this.coreOptions.name} is disposed` ``（FilePersistence 侧匹配测试的 `/disposed/`；MemoryPersistence 侧消息与现状逐字相同）。

### §4.2 `src/memory.ts` 重构为内核子类（公共行为逐字不变）

```ts
// src/memory.ts — diff 后形态（344 行 → 约 120 行）
import {
  PersistenceLifecycleCore, CORE_TEST_FACTORY, toPersistenceKey,
  type PersistenceStatus,
} from './lifecycle.js'

export interface MemoryPersistenceOptions { /* 逐字保持，含 readSnapshot/writeSnapshot 的 (key, signal) 签名 */ }
export type MemoryPersistenceStatus = PersistenceStatus

interface StoredSnapshot { readonly snapshot: Uint8Array }

/** In-memory reference adapter; lifecycle machinery is inherited, not duplicated. */
export class MemoryPersistence extends PersistenceLifecycleCore {
  private readonly snapshots = new Map<string, StoredSnapshot>()

  constructor(private readonly options: MemoryPersistenceOptions = {}) {
    super({ name: 'MemoryPersistence', schedule: options.schedule, timer: options.timer })
  }

  protected override async readCommittedSnapshot(
    user: User, docId: string, signal: AbortSignal,
  ): Promise<Uint8Array | undefined> {
    const key = toPersistenceKey(user, docId)
    // 语义逐字等价现 memory.ts:171 的同一表达式（`??` 作用于回调的**立即返回值**，
    // 在 await 之前求值）——R1 勘误（SA2 #3），三分支精确语义：
    //   ① 无回调            → 直接读内部 map；
    //   ② 回调同步返回 null/undefined（如未写 return 的同步回调）→ **回落内部 map**；
    //   ③ 回调返回 Promise（async 回调，P2 测试的全部 5 处用法）→ Promise 对象
    //     本身 non-nullish，**不回落**，await 其解析值（即使解析为 undefined 也按
    //     miss 处理，不再读 map）。
    // ②③ 已用 node 探针验证（同步 undefined → 'MAP-BYTES'；async undefined → undefined）。
    // 注意：该 `??` 回落语义当前**无任何 P2 用例钉死**（5 处 readSnapshot 测试均返回
    // 实值或显式 settle）——本注释即搬迁期间的唯一护栏，SA4 静态核对以注释与实现一致为准。
    return this.options.readSnapshot?.(key, signal) ?? this.snapshots.get(key)?.snapshot
  }

  protected override async writeCommittedSnapshot(
    user: User, docId: string, snapshot: Uint8Array, signal: AbortSignal,
  ): Promise<void> {
    await this.options.writeSnapshot?.(toPersistenceKey(user, docId), snapshot, signal)
  }

  protected override onSnapshotCommitted(user: User, docId: string, snapshot: Uint8Array): void {
    // 由内核在 epoch 防护之后调用 —— dispose 后迟到完成的 flush 不会复活已清空的 map
    //（语义等价现 memory.ts writeSnapshot 中 callback 与 map.set 之间的 epoch 检查）。
    this.snapshots.set(toPersistenceKey(user, docId), { snapshot: snapshot.slice() })
  }

  protected override disposeAdapterState(): void {
    this.snapshots.clear()                                 // dispose 同步段清空（时序等价现状）
  }
}

// createMemoryPersistence / createMemoryPersistencePlugin / createMemoryHandleForTest
// —— 逐字保持（后者改调 CORE_TEST_FACTORY）。
```

**搬迁映射总表**（memory.ts 现成员 → 去向；SA4/SA2 可按行核对）：

| 现 memory.ts 成员 | 去向 |
|---|---|
| `MemoryPersistenceOptions` / `MemoryPersistenceStatus` / `StoredSnapshot` + `snapshots` map / `createMemoryPersistence` / `createMemoryPersistencePlugin` / `createMemoryHandleForTest` | 留在 `memory.ts` |
| `Entry` → `CoreEntry`；`MemoryDocHandle` → `CoreDocHandle`；`HANDLE_OWNER`/`RELEASE`/`TEST_FACTORY` → `CORE_TEST_FACTORY`；`toKey` → `toPersistenceKey` | `lifecycle.ts` |
| `loadDoc`/`saveDoc`/`apply`/`dispose`/`getStatus`/`[TEST_FACTORY]`/`releaseHandle`/`restoreEntry`/`createEntry`/`issueHandle`/`scheduleFlush`/`onDebounce`/`onMaxDirty`/`startFlush`/`flush`/`scheduleRetry`/`maybeEvict`/`cancelDebounce`/`cancelMaxDirty`/`clearTimers`/`track`/`assertOwnedHandle`/`assertReadable`/`assertWritable`/`isCurrent` | `lifecycle.ts`（逐字，仅 §4.1 标注的 4 处缝改动） |
| 私有 `writeSnapshot(key, snapshot, epoch)` | **消解**：拆为 `writeCommittedSnapshot`（纯 I/O）+ 内核 epoch 检查 + `onSnapshotCommitted`（map 写入） |

### §4.3 新建 `src/file.ts` —— FilePersistence 适配器

#### §4.3.1 选项与类型

```ts
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { CORE_TEST_FACTORY, PersistenceLifecycleCore, type PersistenceStatus } from './lifecycle.js'
import type { DocHandle, PersistenceSchedule, PersistenceTimer, User } from './index.js'

export interface FilePersistenceOptions {
  /** Directory root; each plugin instance owns its own layout below {rootDir}/users/. */
  readonly rootDir: string
  readonly schedule?: Partial<PersistenceSchedule>
  readonly timer?: PersistenceTimer
}

export type FilePersistenceStatus = PersistenceStatus   // 'ready' | 'persistence-degraded' | 'disposed'

/** ADR-0006 shared safe grammar for userId and namespaceId (also used by REST path/WS room/META). */
const SAFE_PATH_SEGMENT = /^[a-z][a-z0-9-]{0,62}$/

interface SnapshotPaths {
  readonly userDir: string       // {rootDir}/users/{userId}
  readonly snapshotPath: string  // {userDir}/{namespaceId}.snapshot      —— 唯一提交态
  readonly tmpPath: string       // `${snapshotPath}.tmp`                 —— 唯一暂态
}
```

#### §4.3.2 类主体

```ts
export class FilePersistence extends PersistenceLifecycleCore {
  constructor(private readonly options: FilePersistenceOptions) {
    super({ name: 'FilePersistence', schedule: options.schedule, timer: options.timer })
    // loud fail：空/非字符串 rootDir 是配置缺陷，不是可降级场景
    if (typeof this.options.rootDir !== 'string' || this.options.rootDir.length === 0) {
      throw new TypeError('FilePersistence requires a non-empty rootDir string')
    }
  }

  /** ADR-0006 path-segment gate; loud throw, never a silent null. */
  protected override validateIdentity(user: User, docId: string): void {
    assertSafePathSegment('userId', user.userId)
    assertSafePathSegment('namespaceId', docId)
  }

  protected override async readCommittedSnapshot(
    user: User, docId: string, signal: AbortSignal,
  ): Promise<Uint8Array | undefined> {
    const { snapshotPath, tmpPath } = this.resolveSnapshotPaths(user, docId)
    let snapshot: Uint8Array | undefined
    try {
      snapshot = await fsp.readFile(snapshotPath, { signal })   // Abortable（TS 类型已含）
    } catch (error) {
      if (isErrnoException(error) && error.code === 'ENOENT') {
        // 无提交态：仍落入下方 tmp 清扫 —— tmp-only 场景（SA6 用例 a）。
      } else {
        throw error                                            // EACCES/EISDIR 等 → loadDoc 响亮拒绝
      }
    }
    await this.sweepLeftoverTmp(tmpPath)                       // 决策 E：无论命中与否一律清扫
    return snapshot                                            // ENOENT 分支保持 undefined
  }

  protected override async writeCommittedSnapshot(
    user: User, docId: string, snapshot: Uint8Array, signal: AbortSignal,
  ): Promise<void> {
    const { userDir, snapshotPath, tmpPath } = this.resolveSnapshotPaths(user, docId)
    signal.throwIfAborted()
    await fsp.mkdir(userDir, { recursive: true })  // MakeDirectoryOptions 类型无 signal（§7 已验证）→ 手工防护
    signal.throwIfAborted()
    await fsp.writeFile(tmpPath, snapshot, { signal })  // flag 'w'（默认）截断同名遗留 tmp；Abortable
    signal.throwIfAborted()
    await fsp.rename(tmpPath, snapshotPath)   // POSIX 原子覆盖；只需父目录写权限（§7 实测）；签名无 options
    // rename 成功即本次 flush 完成（ADR-0006：v1 无 fsync）。
    // dispose 竞态说明：throwIfAborted 与 rename 之间存在极窄窗口——abort 恰好落其间时
    // rename 仍可能提交一个“有效旧状态”快照。这不是损坏（tmp+rename 只会安装一致状态），
    // 且内核 epoch 防护保证迟到的结果不会推进 savedGeneration/status。接受并记录。
  }

  // ---- 路径与安全 ----------------------------------------------------------
  private resolveSnapshotPaths(user: User, docId: string): SnapshotPaths {
    this.validateIdentity(user, docId)   // 纵深防御：路径构造永不接受未验证段（决策 C）
    const userDir = path.join(this.options.rootDir, 'users', user.userId)
    const snapshotPath = path.join(userDir, `${docId}.snapshot`)
    return { userDir, snapshotPath, tmpPath: `${snapshotPath}.tmp` }
  }

  private async sweepLeftoverTmp(tmpPath: string): Promise<void> {
    // best-effort by contract：惰性 .tmp 无害（永不被读），删除失败不得阻断读已提交快照；
    // 同一磁盘状况会在下一次 flush 的 writeFile 上响亮浮出（degraded→retry），信号不丢失。
    await fsp.rm(tmpPath, { force: true }).catch(() => undefined)
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
```

**文件 I/O 语义要点**：
- **只读 load**：load 路径不 `mkdir`、不写任何文件（唯一写动作是 tmp 的 unlink）——grammar 测试后 rootDir 保持空。
- **并发 mkdir**：同用户多 doc 并发首刷 → `mkdir recursive` 幂等（Node 契约：existing 目录非错误），无 EEXIST 竞态面。
- **`readFile` 返回 Buffer**（`Uint8Array` 子类）直接喂 `Y.applyUpdate`；`writeFile` 直接接受 `Uint8Array`——磁盘字节即完整 Yjs update（SA6 用 `Y.applyUpdate(restored, fs.readFileSync(snapshotPath))` 反向钉死）。

#### §4.3.3 Cordis 插件工厂（工厂/实例模型，镜像 memory 惯例）

```ts
/** Cordis plugin factory; each invocation owns an isolated adapter instance. */
export function createFilePersistencePlugin(options: FilePersistenceOptions) {
  let instance: FilePersistence | undefined
  return {
    apply(ctx: Context) {
      instance = new FilePersistence(options)
      instance.apply(ctx)          // ctx.effect: provideDocPersistence(ctx, instance) + dispose 清理
    },
    get instance(): FilePersistence | undefined { return instance },
  }
}
```

#### §4.3.4 test-only 创建路径（模块路径导出，不入包公共导出）

```ts
/**
 * Test-only helper on the module's non-package export path
 * (`@nomicore/persistence/src/file.js`), mirroring src/memory.js's
 * createMemoryHandleForTest. Deliberately absent from package public exports.
 * Async 形态：SA6 直接 `await createFileHandleForTest(...)` 使用（file-persistence.test.ts:99），
 * 且保留创建路径未来做 I/O 的余地。
 */
export async function createFileHandleForTest(
  persistence: FilePersistence, user: User, docId: string,
): Promise<DocHandle> {
  return persistence[CORE_TEST_FACTORY](user, docId)
}
```

### §4.4 `src/index.ts` 导出追加（唯一既有文件改动）

```ts
export {
  FilePersistence,
  createFilePersistencePlugin,
  type FilePersistenceOptions,
  type FilePersistenceStatus,
} from './file.js'
```

既有 memory 导出与全部契约类型逐字不动。`src/lifecycle.ts` **不**经 index.ts 导出（内部模块）。

### §4.5 错误处理矩阵（拒绝虚假降级）

| 条件 | 分类 | 行为 | 依据 |
|---|---|---|---|
| userId/namespaceId 违反安全文法 | 上游缺陷/注入 | **loud throw**（loadDoc/saveDoc/创建路径全入口），不落任何盘 | ADR-0006 受控路径段；SA6 grammar 用例 `rejects.toThrow()` |
| `.snapshot` 的 `META.docId` ≠ 请求 namespaceId | 存储损坏 | **loud throw** `/META\.docId/`，doc.destroy 后抛 | ADR-0006「视为持久化损坏并响亮失败」 |
| `.snapshot` 字节非合法 Yjs update（含 0 字节） | 存储损坏 | `Y.applyUpdate` throw（实测：`Unexpected end of array` / `Invalid typed array length`，均可捕获）→ loadDoc 响亮拒绝 | §7 设计期实测；与本设计"`.snapshot` 即提交态"不变式一致——只有外部篡改能造出此态 |
| `readFile` ENOENT | 正常 miss | 返回 undefined → loadDoc 返回 null；仍清扫 tmp | ADR-0006 创建=首个 saveDoc |
| `readFile` 非 ENOENT 错误（EACCES 等） | 异常路径 | **向上抛**（loadDoc 拒绝）；不静默吞 | 磁盘故障必须可见 |
| flush 链路任何一步失败（mkdir/writeFile/rename，如 ENOSPC/EACCES） | 异常路径 | 内核 degraded：状态 `persistence-degraded`、拒绝后续 saveDoc/创建、保留内存事务、指数退避重试至成功恢复 `ready`——**降级半径为整个适配器实例，见矩阵下方「degraded 全局语义」** | ADR-0006 save 失败降级条款；内核逐字继承 |
| tmp 清扫失败（如目录只读） | 可恢复惰性 | **best-effort 吞掉**（`.tmp` 无害且永不被读）；同一磁盘状况在下次 flush 响亮浮出。**平台限定（R1，SA2 #5）**：该信号闭合论证依赖「unlink 与 writeFile 同需目录 w+x」的 POSIX 本地文件系统语义（与 §7 P1 同款平台假设）；NFS root-squash 等远端语义可能分离 unlink/create 权限，届时吞掉清扫失败不再保证信号浮出 | §3 决策 E 第 4 条 |
| 空/非字符串 rootDir | 配置缺陷 | 构造期 **TypeError** | loud fail |
| disposed 后调用任何入口 | 生命周期 | **throw `/disposed/`**；saveDoc 在 degraded 下 throw `/persistence-degraded/` | SA6 dispose 用例；内核逐字 |
| foreign/released handle 传入 saveDoc | 身份伪造 | **throw `foreign or released DocHandle`** | ADR-0006 引用计数+身份校验；契约套件 |

**degraded 的适配器全局语义（P2 继承行为披露，R1 新增，SA2 #4）**：

- **降级半径 = 整个适配器实例，而非单个 namespace**。任一 namespace 的一次 flush 失败（ENOSPC/EACCES 等）即把实例整体置为 `persistence-degraded`，**跨用户、跨 namespace** 拒绝所有 `saveDoc` 与创建路径（P2 已钉死：`test/memory-persistence.test.ts:285` 断言 doc1 降级期间另一 doc `'other'` 的创建路径同样被拒）。FilePersistence 使该半径跨**用户分区**生效——任一用户的一个 namespace flush 失败即拒绝全部用户的写（ENOSPC 场景下语义合理：磁盘满是整盘事件；EACCES 场景下偏保守但安全——v1 接受）。
- **恢复条件 = 任一 flush 成功，不必然是失败的那个**。内核成功路径无条件执行 `this.status = 'ready'`：无关 doc 的 flush 成功即可把状态翻回 `ready`，此时失败 doc 可能仍在 dirty 退避重试中，写已重新被接受——该 doc 的内存事务不丢、由其自身 retry 兜底（dirtyGeneration 保序保证不误标已保存）。
- **与 ADR-0006 措辞的解释关系**：ADR 文本是「失败后 **namespace** 进入 `persistence-degraded`」；P2 内核实现为**适配器单状态**（v1 已接受的简化）。本设计逐字继承该行为——改动它等于修改 P2 已被测试钉死的行为，超出本任务边界；按 namespace 细分降级状态留待 v2 评估（需内核状态机改造，另立任务）。

### §4.6 并发与时序（全部由内核继承，file 侧零新增并发代码）

| 场景 | 机制 | 来源 |
|---|---|---|
| 同 `(user, docId)` 并发 load（cache miss） | 单 `loading` Promise 合流，单次磁盘读 + 单次 tmp 清扫，各获独立 handle 共享同一 live Y.Doc | 内核（P2 已测） |
| 同 doc 并发 flush | `flushing` 单飞锁；flush 启动捕获 generation，成功仅标记该 generation；期间新 saveDoc → 保持 dirty 重排下一轮 | 内核（P2 已测） |
| flush 进行中 dispose | epoch 防护：迟到的完成不推进 savedGeneration/status/timers；abort signal 取消 `readFile/writeFile`；`mkdir/rename` 手工防护 | 内核 + §4.3.2 |
| 释放后 load | 引用归零仅成可驱逐候选；dirty 未落盘的 entry 保留在缓存由内部 retry/flush 兜底 | 内核（P2 已测） |
| 同实例 flush 与 load 并发 | flush 进行中 entry 必在缓存（evict 仅在 flush 完成且 clean 后）→ load 走 cache hit，不触盘 | 内核 maybeEvict 前置条件 |
| 多实例不同 rootDir | 实例状态完全隔离（无共享可变全局；WeakMap 以实例为键） | SA6 双实例用例 |
| 多实例同 rootDir | v1 单进程无文件锁，属调用方错误，显式不处理 | ADR-0006 v1 限制 |
| 任一 flush 失败 → 全适配器 degraded；无关 doc 的 flush 成功 → 翻回 `ready` | 内核单 `status` 字段（适配器全局，跨用户跨 namespace；失败 doc 仍 dirty-retry 中，内存事务由其自身 retry 兜底）——完整披露见 §4.5「degraded 全局语义」 | P2 继承（`memory-persistence.test.ts:285` 钉死） |

### §4.7 dispose 语义（验收：取消 timer、处理在途、拒绝后续、幂等）

内核 dispose（逐字继承）：同步段清空全部计时器（fake timer 下 `pending() === 0`）、abort I/O、销毁缓存 Y.Doc、`status='disposed'`、调用 `disposeAdapterState()`（file 侧无持久句柄——fsPromises 无状态调用，无 fd 需要关），随后 `await allSettled(inFlight)` 等待在途还原/flush 结算。重复 dispose 幂等。dispose 时 pending 未触发的 flush **不落任何字节**（计时器被清 → flush 从未启动 → mkdir 也不会发生——SA6 用例断言 rootDir 无文件）。Cordis 路径：fiber dispose → effect 清理 → `instance.dispose()` + 服务注销（memory 侧同模式已被 `unloads one Cordis service exactly once` 用例钉死）。

---

## §5. 红灯测试 → 设计机制映射（全绿路径逐一核对）

| # | SA6 用例（`test/file-persistence.test.ts`） | 走绿机制 |
|---|---|---|
| 0 | 契约套件 `describeDocPersistenceContract(FilePersistence 工厂)` | §4.3.4 创建路径 + 内核 lease/handle 归属（两个 FilePersistence 实例 → `HANDLE_OWNER` 按实例校验 foreign）；fake timer 下 saveDoc 只排程不落盘，release 后 dirty entry 保留 → load 走 cache hit 返回共享 doc |
| 1 | `writes the ADR disk layout ...` | flush → `writeCommittedSnapshot`：`mkdir users/alice` → `writeFile doc1.snapshot.tmp`（encodeStateAsUpdate 全量字节）→ `rename`。`.tmp` 不存在（已改名）；磁盘字节经 `Y.applyUpdate` 还原 META+ROOT（Buffer ⊂ Uint8Array 直通） |
| 2 | `fully restores SCHEMA/META/ROOT through a brand-new instance` | writer dispose → entry 驱逐销毁；reader 新实例 load → cache miss → `readFile` → `Y.applyUpdate` 全量还原（SCHEMA 标量/META 两键/ROOT 标量+嵌套 Y.Map+Y.Text——encodeStateAsUpdate 保类型）；`restored.doc !== writerDoc`（新 Y.Doc 实例） |
| 3 | `isolates users: same docId under different users` | key/路径均按 userId 分区：`users/alice/doc1.snapshot` 与 `users/bob/doc1.snapshot`；各自 Entry → 各自 Y.Doc |
| 4 | `keeps plugin instances with different rootDir fully independent` | 实例级 `options.rootDir`；B 实例 load → B 树 readFile ENOENT → null；B 树无文件 |
| 5 | `ignores and deletes leftover .tmp files on load` | (a) tmp-only：readFile ENOENT → 清扫 tmp → null；(b) snapshot+tmp：read 命中 → 清扫 tmp → 还原 committed |
| 6 | `META.docId mismatch → corruption, fails loudly` | 内核 `restoreEntry` 校验 → throw `/META\.docId/` |
| 7 | `validates userId/namespaceId ... never escapes rootDir` | `validateIdentity` 入口 loud throw（11×6 全拒）；'a'/63×'a' 边界通过 → ENOENT → null；路径构造前双重校验 → 无任何越界写入 |
| 8 | `atomic rename: read-only committed file does not block next flush` | chmod 444 只封直写 `.snapshot`；本设计写新 tmp（0644）后 `rename` 覆盖——POSIX rename 只需父目录写权限（§7 实测 chmod 444 场景成功）；status 全程 `ready` |
| 9 | `dispose cancels pending flush timers, leaves nothing written, rejects further use` | fake timer：pending>0 → dispose 清计时器 → pending=0；flush 未启动 → mkdir/写盘从未发生；`status='disposed'`；`loadDoc` throw `/disposed/`；`saveDoc` throw；二次 dispose 幂等 |
| 10 | `registers as a Cordis service through the plugin factory` | §4.3.3 工厂 → `instance.apply(ctx)` → `ctx.get('docPersistence') === plugin.instance`（instanceof FilePersistence）；`ctx.fiber.dispose()` → effect 清理 → dispose + 服务注销 |

收集期失败（`Cannot find module '../src/file.js'`、缺失导出）由 §4.3/§4.4 的存在性直接消除。

## §6. 全局兼容保障（480 既有用例必须保持全绿）

1. **搬迁不变式**：`lifecycle.ts` 除 §4.1 标注的 4 处缝改动（`validateIdentity`×2、I/O 三参化、`onSnapshotCommitted`/`disposeAdapterState` 钩子）外逐字搬迁；错误消息逐字保留（`/disposed/`、`/persistence-degraded/`、`/META\.docId/`、`foreign or released DocHandle`）。
   - **无测试钉死的缝隙（R1 补录，SA2 #3）**：memory 桥接 `readCommittedSnapshot` 的 `??` 回落语义（回调同步返回 undefined → 回落内部 map；async 回调解析 undefined → 不回落）**没有任何 P2 用例覆盖**（grep 证实 5 处 `readSnapshot` 测试用法均返回实值或显式 settle）。若搬迁时表达式形态漂移（如改为先 await 再 `??`），480 绿灯不会变色而行为已变。迁移护栏 = §4.2 内的精确语义注释；**SA4 静态核对项：实现必须保留与 `memory.ts:171` 逐字同构的表达式形态，且注释与实现一致**。
2. **memory 公共面零变化**：`MemoryPersistenceOptions`（含 readSnapshot/writeSnapshot 的 `(key, signal)` 签名）、四个导出名、`createMemoryHandleForTest` 同步签名——`test/memory-persistence.test.ts`、`test/memory-testkit.ts`、`test/persistence-contract.test.ts` 无一字需改。
3. **epoch 语义保持**：map 写入移入 `onSnapshotCommitted` 后仍处于 epoch 防护之后（等价原 `writeSnapshot` 内部 callback→epoch→map.set 的次序），dispose 迟到完成不复活状态。
4. **循环依赖与入口次序不变式**（R2 勘误，SA4 F-1 实测证伪 R1 论据之一半）：值环为 `lifecycle.ts --值导入(provideDocPersistence/resolvePersistenceSchedule/systemPersistenceTimer)--> index.ts --re-export--> memory.ts/file.ts --extends 值--> lifecycle.ts`。
   - **入口次序不变式（唯一正确论据）**：模块求值起点**经过 `src/index.js`**（直接导入，或任何先于深路径模块传递导入它）时循环安全——index.js 会先于 memory/file 的 `extends` 求值前完成 `lifecycle.ts` 类声明；且该方向上 `lifecycle.ts`/`memory.ts` 的模块顶层不读取 index.js 的值绑定（构造函数体才读，`systemPersistenceTimer` 为 `export const`、`src/index.ts:63`，存在 TDZ 也只在构造期已初始化后访问）。R0「值导入均为函数声明」与 R1「file.ts 顶层从不读取循环绑定」均为事实错误——**`class FilePersistence extends PersistenceLifecycleCore` 的 extends 子句本身就是模块体求值期的值读取**（adapter→lifecycle.js 方向）；lifecycle.ts→index.js 方向的「顶层不读」论据仍成立。`index ⇄ memory` 循环 P2 全绿是 index-first 方向的运行先例。
   - **已知限制披露（MEDIUM，非阻断）**：若消费者**不经 index.js** 直接深导入 `src/memory.js` / `src/file.js` / `src/lifecycle.js`，将触发模块初始化期 `TypeError: Class extends value undefined is not a constructor or null`（SA4 vitest 探针实测：仅 memory.js 入口崩于 file.ts:33、仅 file.js/lifecycle.js 入口崩于 memory.ts:24 extends；index-first 全部正常，含全部 493 用例）。半径评估：① 包 `exports` map 仅暴露 `.`——包外深导入被 Node `ERR_PACKAGE_PATH_NOT_EXPORTED` 直接拒绝（包外不可达）；② 包内全部测试与公共入口均 index-first；③ 失败模式是导入期响亮崩溃（fail-fast），无静默错行为。P2 无此雷（原为 `implements DocPersistence`，类型擦除、无运行时 extends）——系决策 A 继承式内核新引入，由设计伪代码决定、非实现偏差。
   - **入口纪律（包内消费者与 SA7 须遵守）**：任何深路径消费者必须先（直接或传递）导入 `src/index.js`；动态验证脚本见 `Class extends value undefined` 即入口次序问题，**不是**实现缺陷（SA4 §8.4 已列为动态审核重点）。
   - **加固候选（follow-up，非本任务范围）**：把 `provideDocPersistence`/`resolvePersistenceSchedule`/`systemPersistenceTimer`/`DOC_PERSISTENCE_SERVICE` 下沉为无环叶子模块，`index.ts` 纯 re-export 保持 P1 公共面不变——可根除入口次序依赖，另立任务评估。
5. **类型门禁**：`pnpm typecheck` 与 `vitest run --typecheck`（`tsconfig.typecheck.json` 含 `packages/*/test/**`）对全包生效；伪代码按 strict/`exactOptionalPropertyTypes`（R1：`PersistenceCoreOptions` 桥接字段显式 `| undefined`，消除 SA2 #2 实测的 TS2379）/`noImplicitOverride`（子类覆写必须 `override`）/`verbatimModuleSyntax`（type-only import）书写。

## §7. 协议假设依据 (Protocol Assumption Evidence)

设计期实测环境：worktree 内 Node v24.13.0、`@types/node` 与仓库锁定版本（`node_modules/@types/node`）。

| # | 假设 | 依据类型 | 依据内容（具体引用） | 风险 |
|---|---|---|---|---|
| P1 | `fsPromises.rename(tmp, snapshot)` 可覆盖 chmod 444 的已提交文件（只需父目录写权限） | 设计期实测 + 源码引用 | 实测脚本（/tmp，mkdtemp）：writeFile snap 'gen1' → chmodSync 0444 → writeFile tmp 'gen2' → `await fsp.rename(tmp, snap)` **成功**，读到 'gen2'，tmp 不存在。`@types/node` `rename(oldPath, newPath): Promise<void>`（无 options 参数）。POSIX rename(2) 权限检查作用于两个父目录 | 低（Linux CI；SA6 用例 8 本身即平台行为锚点） |
| P2 | `fsp.writeFile`/`fsp.readFile` options 支持 `signal`（TS 类型层面） | 源码引用 + 设计期实测 | `node_modules/@types/node/fs/promises.d.ts:1024` writeFile options `= ObjectEncodingOptions & {mode/flag/flush} & Abortable`；`:1121` readFile options `{encoding?: null, flag?} & Abortable → Promise<NonSharedBuffer>`。实测 `{signal}` 传入被接受；abort 后 writeFile 以 AbortError 拒绝 | 无 |
| P3 | `mkdir` options（`MakeDirectoryOptions = {recursive?, mode?}`）**无** `signal`；`rm`（`RmOptions = {force?, maxRetries?, recursive?, retryDelay?}`）**无** `signal` | 源码引用 | `node_modules/@types/node/fs.d.ts:1666`（MakeDirectoryOptions）、`:1620`（RmOptions）。运行时虽忽略多余属性（实测 mkdir `{recursive,signal}` 不报错），但 strict TS 对象字面量多余属性检查会拒绝 → 设计采用**不传 signal + `signal.throwIfAborted()` 手工防护** | 无（已在 §4.3.2 编码） |
| P4 | 缺失文件 `readFile` → `error.code === 'ENOENT'`；`rm(path, {force:true})` 对缺失路径 resolve | 设计期实测 | 实测输出：`readFile missing -> ENOENT`；`rm force on missing tmp: resolves OK`；`rename missing src -> ENOENT` | 无 |
| P5 | abort 中断 writeFile 以 AbortError 拒绝（dispose 等待在途 I/O 结算的前提） | 设计期实测 | 实测：`aborted writeFile: rejected AbortError` | 无 |
| P6 | `Y.applyUpdate` 对垃圾/空字节抛可捕获错误（损坏快照 → loadDoc 响亮拒绝，而非静默空 doc） | 设计期实测 | 实测（ESM, yjs 13.6.30）：`garbage: THROWS -> Invalid typed array length`；`empty: THROWS -> Unexpected end of array` | 无 |
| P7 | Cordis `ctx.effect` + `ctx.provide` + fiber dispose 注销服务且仅一次 | 现有测试引用 | `test/memory-persistence.test.ts:476` `unloads one Cordis service exactly once across repeated fiber disposal`（同 `apply` 模式在 P2 已绿）；`src/index.ts:101` provideDocPersistence 即 `ctx.provide` | 无 |
| P8 | vitest `--typecheck` 会因任一测试文件 import 缺失模块而失败（收集期） | 现有测试引用 + 源码引用 | SA6 红灯记录：`TypeCheckError: Cannot find module '../src/file.js'`（file-persistence.test.ts:33）；`tsconfig.typecheck.json` include `packages/*/test/**/*.ts`；`vitest.config.ts:7-11` | 无 |
| P9 | `Y.encodeStateAsUpdate`/`applyUpdate` 往返保留嵌套 Y.Map/Y.Text 与标量 | 现有测试引用 | SA6 用例 2（`file-persistence.test.ts:153-186`）全量断言 SCHEMA/META/ROOT 含 `Y.Text('line one')`、嵌套 `Y.Map`——验收即证据；P2 memory 快照路径同函数已绿 | 无 |
| P10 | `mkdir(userDir, {recursive:true})` 幂等，existing 非错误；同进程并发调用安全 | 官方文档引用 | Node docs `fsPromises.mkdir`：recursive true 时已存在不报 EEXIST（`MakeDirectoryOptions.recursive`：`Indicates whether parent folders should be created`；docs: “Calling fs.mkdir() when a path … exists results in an error only when recursive is false”）；本设计内同 doc 的 mkdir 不并发（单飞），跨 doc 并发幂等 | 低 |
| P11 | 包内 ESM 值环的求值安全性依赖**入口次序**：index-first 正常；深路径直入（不经 index.js）在模块初始化期崩溃 | 设计期实测（SA4 静态验尸探针） | SA4 vitest 探针（同 worktree，跑毕即删）：仅 `../src/memory.js` 入口 → `file.ts:33` `TypeError: Class extends value undefined`；仅 `../src/file.js` 或 `../src/lifecycle.js` 入口 → `memory.ts:24` 同错；`../src/index.js` 在前 → 全部正常（493 用例 + CI）。机制与入口纪律见 §6.4-4 | 低（包 `exports` 仅暴露 `.`，包外深导入被 `ERR_PACKAGE_PATH_NOT_EXPORTED` 拒绝；失败为响亮 crash） |

除上表外无其他协议级假设：本设计不涉及网络端口、跨进程锁、第三方服务。P11 为 R2 补录（SA4 F-1 要求把入口次序不变式显式入档）。

## §8. 契约改动连锁审计 (Contract Change Caller Audit)

**结论：无公共契约改动。** 本设计仅涉及 [内部重构（私有成员搬迁）+ 新增类/导出（纯增量）]，不改变任何既有函数的签名、返回类型、throw 行为或时序。逐项声明：

### 改动函数（内部搬迁，非公共契约）

| 函数/成员 | 文件 | 改动前 | 改动后 |
|---|---|---|---|
| `MemoryPersistence` 全部私有成员（loadDoc/saveDoc/flush/…/`[TEST_FACTORY]`） | `src/memory.ts` | 类内私有实现 | 搬至 `PersistenceLifecycleCore`（`src/lifecycle.ts`），`MemoryPersistence` 继承；对外行为与错误消息逐字不变 |
| `MemoryPersistence` 私有 `writeSnapshot(key, snapshot, epoch)` | `src/memory.ts:253` | 私有方法 | 消解为受保护缝 `writeCommittedSnapshot` + `onSnapshotCommitted` 钩子（§4.1–4.2）；无外部 caller（私有） |
| `MemoryPersistence.apply` 的 effect label | `src/memory.ts:118-123` | `'memory-persistence: service'` | `'MemoryPersistence: service'`（label 仅诊断用途，非 API） |

### 既有 caller 清单（全部，grep 证实无包外消费者）

| Caller | 文件:行号 | 是否 await | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---|---|---|---|---|
| 包公共导出 | `src/index.ts:123-129`（re-export memory 四名） | N/A | N/A | N/A | 逐字不动 |
| 契约套件 | `src/testing.ts`（仅引用 `DocPersistence` 接口类型） | N/A | N/A | N/A | 不动 |
| P2 测试 | `test/memory-persistence.test.ts`（约 20 处构造/调用） | await | 各用例自带 expect 捕获 | N/A | **不改一字**，全绿即兼容证明 |
| P1 测试 | `test/persistence-contract.test.ts:18-25`（stubPersistence） | N/A | N/A | N/A | 不动 |
| testkit | `test/memory-testkit.ts:2-11` | await | N/A | N/A | 不动（同步签名保持） |
| 包外（apps/其他 packages） | 无 | — | — | — | grep 证实零引用 |

### 新增契约（纯增量，无既有 caller 可破坏）

| 新符号 | 导出路径 | caller |
|---|---|---|
| `FilePersistence` / `createFilePersistencePlugin` / `FilePersistenceOptions` / `FilePersistenceStatus` | `@nomicore/persistence`（`src/index.ts` 追加） | SA6 红灯测试（`file-persistence.test.ts:25-32`） |
| `createFileHandleForTest` | 仅 `@nomicore/persistence/src/file.js`（**不**入包导出） | SA6 红灯测试（`:33`） |

**遗漏 caller 的代价评估**：不适用（无契约修改）；若 SA2/SA4 发现新 caller，本表只增不删。

## §9. 文件清单（File Scope）

### ALLOW LIST

- `packages/persistence/src/lifecycle.ts` — 新建（~320 行，其中 ~300 行自 memory.ts 逐字搬迁 + §4.1 四处缝改动），共享 lifecycle 内核，满足“不得复制第二套”
- `packages/persistence/src/file.ts` — 新建（~170 行），FilePersistence 适配器 + 插件工厂 + `createFileHandleForTest`（§4.3）
- `packages/persistence/src/memory.ts` — 修改（344 → ~120 行），瘦身为内核子类，公共面逐字不变（§4.2）
- `packages/persistence/src/index.ts` — 修改（+6 行），追加 file 四个 re-export（§4.4）
- `packages/persistence/test/file-persistence.test.ts` — `[SA6 owned]` SA6 红灯验收测试（已存在于工作区）。SA3 不改断言逻辑；仅当测试基础设施故障（hook/fixture 隔离等）才允许最小修复并注明原因
- `packages/persistence/package.json` — 修改（**R2 追认**，SA4 F-2 / 硬门禁 9）：仅 `"version"` 一行 `0.1.0` → `0.1.1`（本任务新增 4 个公共导出属行为变更，HG9「行为变更包 patch bump」为总控级立法、高于设计文件清单；SA4 实测 diff 恰 1 行、结构性字段零改动，裁定合规，先例 `task_vfsl-codegen-hardening_sa4_review.md`）

### DENY LIST

- `packages/persistence/src/testing.ts` — P1 共享契约套件，双 Adapter 复用的基座，不动
- `packages/persistence/test/memory-persistence.test.ts` — P2 既有测试，本任务必须保持全绿，不得修改
- `packages/persistence/test/persistence-contract.test.ts` — P1 契约测试，不动
- `packages/persistence/test/memory-testkit.ts` — P2 testkit，签名依赖，不动
- `packages/persistence/package.json` 的**结构性字段**（`dependencies`/`devDependencies`/`exports`/`scripts`/`type` 等）— 不动（依赖确无新增：`node:fs/promises`/`node:path` 为内建，yjs/cordis/@types/node 已有）；唯一例外为 `version` patch 位，经 HG9 授权移入 ALLOW（R2 收窄原 DENY 措辞——原「无新依赖」表述与真实意图不符，见 SA4 §2.2）
- `packages/persistence/tsconfig.json`、根 `vitest.config.ts`、根 `tsconfig.*.json` — 构建配置不动
- `packages/vfsl/**`、`packages/vfsl-protocol/**`、`packages/vfsl-codegen/**`、`domains/**`、`apps/**` — 与持久化 Adapter 无关
- `docs/adr/**` — ADR 为已接受立法，本任务只实现不修改

## §10. 实现顺序与验证计划（给 SA3）

1. **抽取**：新建 `src/lifecycle.ts`（§4.1），`memory.ts` 同步瘦身为子类（§4.2）→ `pnpm --filter @nomicore/persistence test` 确认 memory/contract 套件全绿（此步不动 file 任何代码，红灯仍应仅为 file 用例）。
2. **适配**：新建 `src/file.ts`（§4.3）→ `src/index.ts` 追加导出（§4.4）。
3. **验证**：worktree 根 `pnpm typecheck`（tsc 全包）+ `pnpm test`（`vitest run --typecheck`）→ 预期 `Test Files 33 passed`（480 既有 + file 红灯转绿），EXIT=0。
4. 若出现用例失败：优先怀疑 §4.1 缝改动的次序语义（epoch/onSnapshotCommitted）与 §4.3 的 ENOENT-仍清扫分支；对照 §5 映射表逐用例定位。禁止为转绿修改 SA6 断言。

---

## SA2 反馈逐条回应

评审报告：`wiki/raw/task_file-persistence-plugin_sa2_review.md`（verdict = reject，5 项修订要求；R1 修订均为文档/伪代码级，架构决策 A–F 未动）。

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| R1: 重写决策 E 理由 2（删「list 能力」偷换概念，换 HMR/单写者竞态论据）；修正「清扫面自然闭合」；新增 ADR 解释与残留披露小节 | ✅ | §3 决策 E 理由 2/3；新增 §3 决策 E.1 | 理由 2 替换为 HMR 场景论证：新实例启动清扫 unlink 旧活跃实例在途 tmp → rename ENOENT → 虚假 degraded → 活链路写被拒；并引 SA2 独立论证的「cache-miss ⇒ 无 Entry ⇒ 无在途 flush」竞态不可能性。理由 3 删除「清扫面自然闭合」，改为准确表述（flush 截断无边际覆盖；覆盖面 = 重启后再次被访问的 namespace）。新增决策 E.1：解释性偏离声明（依据 = 简报验收条款即 load 时点表述 + HMR 竞态）、残留集合定义（S 中不再被访问子集永久滞留）、体积上界（≈ namespace 数 × 快照大小）、回收途径（离线 find -delete / v2 单写者启动清扫）及 owner 翻转决策路径 |
| R2: `PersistenceCoreOptions.schedule/timer` 加 `\| undefined` 消除 TS2379 | ✅ | §4.1 `PersistenceCoreOptions`（§4.2/§4.3 的 `super({...})` 桥接随动生效）；§4.1 引言、§6.5 勘误注记 | 两字段改为 `readonly schedule?: Partial<PersistenceSchedule> \| undefined`、`readonly timer?: PersistenceTimer \| undefined`，附注释说明 exactOptionalPropertyTypes 下读取可选属性得 `\| undefined`、赋给不带 `\| undefined` 的可选字段即 TS2379（引 SA2 typescript@5.9.3 实测）；§4.1 引言与 §6.5 的「伪代码已按约束书写」自述同步勘误 |
| R3: 改正「回调优先（即使其返回 undefined）」反义注释；§6 标注该缝隙无测试钉死 | ✅ | §4.2 `readCommittedSnapshot` 注释；§6.1 新增子项 | 注释重写为探针验证的三分支精确语义（无回调→读 map；同步返回 undefined→**回落 map**；async 回调→`??` 作用于 non-nullish Promise 对象**不回落**，解析 undefined 按 miss 处理——node 探针输出已引注释内）；§6.1 新增「无测试钉死的缝隙」子项：声明 5 处 readSnapshot 测试无一覆盖回落语义、表达式形态漂移时 480 绿灯不变色、迁移护栏 = 注释 + SA4 静态核对项（实现须与 memory.ts:171 逐字同构） |
| R4: 补披露 degraded 适配器全局语义（跨用户半径 + 无关 flush 成功即恢复 ready） | ✅ | §4.5 矩阵 flush 行加指引 + 矩阵后新增「degraded 的适配器全局语义」段；§4.6 并发表新增一行 | 披露三要点：降级半径 = 整个适配器实例（跨用户跨 namespace，P2 `:285` 钉死，FilePersistence 使其跨用户分区生效）；恢复条件 = 任一 flush 成功（无条件 `status='ready'`，失败 doc 仍 dirty-retry 中、事务由其自身 retry 兜底）；与 ADR「namespace 进入 degraded」措辞的解释关系（P2 适配器单状态为 v1 已接受简化，逐字继承，按 namespace 细分留 v2） |
| R5: 改正「值导入均为函数声明」论据；§4.5 sweep 行补 POSIX 平台限定 | ✅ | §6.4 改写；§4.5 矩阵 sweep 行 | §6.4 改写为准确论据：`systemPersistenceTimer` 为 `export const`（index.ts:63，存在 TDZ，R0「函数声明」为事实错误），TDZ 安全来自「模块顶层从不读取循环导入绑定、仅在子类构造函数体执行时访问（此时两条循环边顶层求值完毕）」+ `index⇄memory` 同构循环 P2 全绿先例**（R2 注：本行所述论据的 adapter→lifecycle.js 方向后经 SA4 F-1 实测证伪并再勘误，现行论据见 §6.4-4「入口次序不变式」）**；§4.5 sweep 行补平台限定（信号闭合论证依赖 POSIX 本地文件系统 unlink/create 同权限语义，与 §7 P1 同款平台假设；NFS root-squash 等远端语义下不保证） |

## SA4 回流文档债回应（R2）

静态验尸报告：`wiki/raw/task_file-persistence-plugin_sa4_review.md`（verdict = pass，commit `359a030`；§6.4-① R1 论据被 SA4 探针证伪一半 + HG9 版本 bump 需设计追认，两项文档债回流）。

| # | 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|---|------|:--:|------|------|
| F-1 | §6.4-① 勘误：R1「file.ts 模块顶层从不读取循环绑定」被实测证伪（深路径入口 `TypeError: Class extends value undefined`）；补入口次序不变式与已知限制披露 | ✅ | §6.4-4 整节重写；§7 新增 P11 | 论据替换为**入口次序不变式**（index-first 求值安全 + 该方向顶层不读/构造期读的完整机制）；明确指出 `class X extends PersistenceLifecycleCore` 的 extends 子句即模块体求值期值读取（R1 对 adapter→lifecycle.js 方向错误、lifecycle→index 方向仍成立）；披露已知限制（三深路径入口崩溃点引 SA4 实测表、包外不可达依据 `exports` map、fail-fast、P2 无此雷系决策 A 新引入）；写入口纪律（深路径消费者必须 index-first；SA7 见 `Class extends value undefined` 勿误报）；登记加固候选（值导入下沉无环叶子模块，follow-up 另立任务）；P11 把入口次序行为入档协议假设（依据 = SA4 探针实测） |
| F-2 | §9 ALLOW LIST 增补 package.json version 行（HG9 高于设计 DENY）；DENY 措辞收窄 | ✅ | §9 ALLOW LIST 新增一条；DENY LIST 对应条目改写 | ALLOW 增 `packages/persistence/package.json`（R2 追认，标注仅 `"version"` 0.1.0→0.1.1 一行、HG9 依据、SA4 实测 diff 恰 1 行 + 先例）；DENY 收窄为「结构性字段不动」并显式注明 version patch 位例外已移入 ALLOW（原「无新依赖」措辞与真实意图不符，按 SA4 §2.2 澄清） |

**注**：本节为 SA4 回流件登记，不触发 SA2 反馈修订协议的修订计数；架构决策 A–F、R1 的 5 项修订内容均未变更。SA7 动态验证探针请遵守 §6.4-4 入口纪律（index-first 导入）。
