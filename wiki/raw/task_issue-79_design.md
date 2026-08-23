# 设计文档 — Persistence：DocHandle entry status 与 degraded 期间 dirty registration（issue #79）

- 任务类型：**feature**（任务简报 `wiki/raw/task_issue-79.md`）
- 设计版本：**R1（修订版）**，SA1，2026-08-22。R1 依据 SA2 攻击评审（`wiki/raw/task_issue-79_sa2_review.md`，verdict=reject）与总控 R1 修订指令逐条落实：#1 补 §0 爆炸半径第 9 点（persistence-contract.test.ts:122 结构字面量，CRITICAL——R0 按清单实施则 CI typecheck 必红）；#2 如实改写 §3.4 证据 #1 反证（R0 推演事实错误）+ 补单一调度器纪律红灯锚点；#3 如实改写 §4.3 失败模式（真实后果=静默弱化，非 ProbeFailure）+ 补决策 C/返回值红灯锚点；#4 不变式措辞「任一时刻」→「任一可观察时刻」；#5 ADR 修订节放行依据措辞对齐（issue #79 AC1/AC8 明文授权，SA8 R1 备注）。修订明细：§5「R1 追加处置」、§11「R1 修订追加」、§12 逐条回应表。
- 输入基线：
  - 红灯验收（SA6，Phase 1）：`packages/persistence/test/issue-79-entry-status.test.ts`（Memory，6 用例）+ `packages/persistence/test/issue-79-file-entry-status.test.ts`（File，2 用例）；红灯证据：`Test Files 2 failed (2)`、`Tests 8 failed (8)`、`Type Errors: no errors`，既有 65 用例全绿（简报 §红灯运行证据，总控 14:07 独立复验）。
  - 相关决议：`wiki/raw/task_issue-79_relevant_decisions.md`（ADR 0006 / ADR 0007 约束基准；ADR 0006 内两处早期条款已废止，禁止引用）。
  - 冲突裁决：`wiki/raw/task_issue-79_conflict_report.md` — verdict `conflict`，0 hard-violation、1 evolution（冲突点 #1）。**演进已放行**：owner 在 issue #79 验收标准第 1/8 条中**明文要求**该演进（AC1：DocHandle 提供同步 entry 级 `getStatus()`；AC8：ADR 0006 补充职责条款）——issue 即 owner 授权；总控 dispatch #4 循 `task_persistence-create-doc` 先例（evolution 不停机）放行，SA8 R1 备注要求标注措辞与此对齐。本设计显式承载该演进：§2 扩展 DocHandle 接口 + §6 给出 ADR 0006 修订节草案（体例参照 ADR 0006 既有「createDoc 与 owner 语义修订」节，标注「演进经 owner 裁决放行——issue #79 AC1/AC8 明文授权」）。
- 全部源码路径相对 worktree 根 `/home/wangjian/nomicore-fix-issue-79`。

---

## §0. 范围发现：契约收窄的全仓爆炸半径（超出 SA3 提示清单）

「degraded 拒绝 saveDoc」这一旧契约**不止**锚定在 SA3 提示列出的 3 处（memory-persistence.test.ts L307/L350、file-persistence-sa7-dynamic.test.ts L188）。全仓 grep（`saveDoc` / `persistence-degraded` / `write-rejected`，apps/ domains/ tests/ packages/ 全扫描）+ 类型层核查（R1，SA2 #1）证实完整锚点集——#1–#8 为**行为锚点**（旧契约语义），#9 为**类型层锚点**（§2.1 接口扩展引致的结构义务，与 saveDoc 契约无关但同属 CI 必红面）：

| # | 位置 | 性质 | 旧契约依赖 |
|---|------|------|-----------|
| 1 | `packages/persistence/src/lifecycle.ts:200` | 生产代码 | saveDoc 在 `entry.degraded` 时 throw（**改动本体**） |
| 2 | `packages/persistence/src/lifecycle.ts:211` | 生产代码（test seam） | `seedForTest` 在 degraded entry 上 throw |
| 3 | `packages/persistence/test/memory-persistence.test.ts:307,350` | 测试 | `saveDoc(...).rejects.toThrow(/persistence-degraded/)` |
| 4 | `packages/persistence/test/file-persistence-sa7-dynamic.test.ts:188,189,207` | 测试 | L188/L207 同上；L189 `createFileHandleForTest` 在 degraded entry 上 rejects |
| 5 | `packages/dsh-persistence/src/probe.ts:435-445`（S4 场景） | 生产代码（DSH 探针） | 探针以「saveDoc 被 degraded 拒绝」为降级观察哨兵：若 saveDoc resolve → `throw new Error('saveDoc unexpectedly accepted while persistence-degraded')` → 探针 `ok=false` |
| 6 | `packages/dsh-persistence/src/events.ts:30` + `record.ts:46-47` | 生产代码 | `write-rejected` 事件类型与记录渲染 |
| 7 | `packages/dsh-persistence/test/dsh-profile-acceptance.test.ts:349-371,373-402,404-435` | 测试 | L392/L421 `saveDoc rejects /persistence-degraded/`；L356/L361/L369 `write-rejected` 事件断言 |
| 8 | `packages/dsh-persistence/test/dsh-probe-cli.test.ts:105-112` | 测试 | `--fail-first-flushes 1` 记录含 `write-rejected doc-degraded` |
| 9 | `packages/persistence/test/persistence-contract.test.ts:120-133`（`const handle: DocHandle = {…}` @ L122） | 测试（**类型层结构义务**，R1 补——SA2 #1） | 非行为锚点：该字面量**直接类型标注** `DocHandle`（非 cast），对接口形状负有结构义务。§2.1 给 `DocHandle` 加 `getStatus()` 后 `tsc -p packages/persistence/tsconfig.json` 报 `TS2741: Property 'getStatus' is missing` → CI `pnpm typecheck` 步骤必红，直接违反 AC9。行为上该用例锚定公共 handle 契约面（`handle.doc` 同一性、无 `evict`/`list` 泄露成员），接口扩展后应继续充当契约探针 |

依据：AC 第 9 条要求「全量 test/typecheck、Node 20/24 CI 通过」。CI（`.github/workflows/ci.yml`）的 `pnpm test` = `vitest run --typecheck`，include `packages/*/test/**`（**含 dsh-persistence**）；`pnpm typecheck` 显式含 `packages/dsh-persistence/tsconfig.json`。**#5–#8 若不处置，SA3 实现后 CI 测试步骤必红**（探针 S4 会以 `scenario-error:S4-degradation` 失败、两个 dsh 测试文件断言反转）；**#9 若不处置，typecheck 步骤必红**（SA2 /tmp 端态实测：`tsc … persistence-contract.test.ts(122,11): error TS2741`，exit 2）。本设计 §4/§5（含 R1 追加处置）给出全部处置方案。

`@nomicore/persistence` 的仓库级消费者**只有** `packages/dsh-persistence`（apps/ 现仅 README+资产，domains/、tests/ 无引用；grep 证实）。爆炸半径封闭于上述 9 点；`DocHandle` 的全仓结构实现者共两处（`PersistenceHandle` 与 #9 的字面量，SA2 已穷尽 grep，R1 复核认可）。

---

## §1. 需求推演（Feature）：职责重排的三个缺口

### 1.1 缺口 A：DocHandle 没有 entry 级状态查询面

现状只有两层状态：`PersistenceLifecycle.getStatus()`（L125-131，**Adapter 聚合**：任一 entry degraded 即整体 degraded）与 entry 私有 `degraded: boolean`（L34）。ADR 0006「save 失败按 doc **只**读降级」+ CONTEXT.md「namespace = 一个 Y.Doc …」决定了降级粒度是 per-`(owner, docId)` entry；聚合状态对「写前 gate」不可用——用聚合状态 gate 会误伤无关 namespace 的写入（AC2 明确禁止）。写前 gate（ADR 0007：NamespaceRuntime「轮到 mutation 时先检查 writable gate」）需要一个**同步、entry 级、瞬间性**的查询面，它只能挂在 handle 上（handle 是 Runtime 唯一持有的租约凭据）。

### 1.2 缺口 B：saveDoc 的 degraded 拒绝是代码对 ADR 原义的偏离

ADR 0006 原文从未规定 saveDoc 因 degraded 拒绝：「saveDoc = 脏状态通知……返回仅表示脏状态已登记」「失败事务保留在同一 live Y.Doc 中，由持久层内部 retry 持久化」。降级拒绝面条款写的是「拒绝**后续** REST/WS 写入」——那是**业务编排层**（Runtime gate）的职责。`lifecycle.ts:200` 把业务层拒绝面下沉进了持久层，造成一个真实缺陷：**mutation 已通过 gate 检查并提交进 live Y.Doc 之后，若恰逢 flush 失败转 degraded，该 mutation 的 saveDoc 被拒 → 脏登记丢失 → 该 mutation 只能寄望于「上一个 generation 的 flush 恰好在失败前已覆盖它」——generation 保序条款恰不保证这一点（flush 启动时捕获 generation，旧 snapshot 不得将新状态误标为已保存）**。这正是 AC7 竞态序列钉死的红灯核心（`lifecycle.ts:200` 拒绝 → mutation 2 无脏登记）。

### 1.3 缺口 C：写前检查信号缺失的语义钉子

`getStatus()` 的语义陷阱是「检查后状态翻转」：gate 读到 `ready` → mutation 提交 → flush 失败 → degraded。这不是 gate 的 bug，是**正常 degraded/retry 路径**：已提交内存事务保留、后续业务写入被 gate 拒、retry 成功恢复。因此契约必须钉死「getStatus 只表示调用瞬间状态，不承诺后续 flush 成功」（与 saveDoc「不构成落盘承诺」同款纪律，ADR 0006「rename 成功即完成一次 flush」条款同源）。

### 1.4 职责重排后的不变式

| 角色 | 时刻 | 职责 | 拒绝面 |
|---|---|---|---|
| **Runtime 写前 gate**（ADR 0007，本任务只提供查询面） | mutation **前** | 读 `handle.getStatus()`；`persistence-degraded` → 拒绝开始新写入（zero-write：文档不变、响亮拒绝，CONTEXT.md 零写入纪律） | degraded |
| **saveDoc**（持久层） | mutation **后** | 登记 dirty（递增 dirtyGeneration）；resolve 仅代表已登记 | 仅租约身份失效：foreign / released / 身份失配 / Persistence disposed |

---

## §2. 契约面设计：`DocHandleStatus` + `DocHandle.getStatus()`

### 2.1 `contract.ts` 改动

```ts
/**
 * Entry-level persistence status of one DocHandle lease (issue #79).
 * Frozen vocabulary — rendered part of the ADR-0006 revision contract.
 */
export type DocHandleStatus = 'ready' | 'persistence-degraded' | 'released' | 'disposed'

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
```

`index.ts` 追加 `export { type DocHandleStatus } from './contract.js'`（纯增量导出；`module-graph-regression.test.ts` 只审 reverse-barrel import，不受影响）。

### 2.2 四态语义表（冻结措辞，随 ADR 0006 修订节一并冻结——冲突报告边界提醒）

| 状态 | 语义 | 进入条件 | 证据锚点 |
|---|---|---|---|
| `ready` | 该 entry 调用瞬间无未决降级（flush 在途也算 ready——失败尚未发生） | entry.degraded === false | AC1/AC7 步骤 3（flush 在途观察 ready） |
| `persistence-degraded` | 该 entry 最近一次 flush 失败，脏数据由内部 retry 承接 | entry flush 失败且尚未 retry 成功 | AC1/AC3/AC7 步骤 5 |
| `released` | 本租约已 release（persistence 仍开放） | `handle.released === true` 且 `!lifecycle.closed` | AC1（Memory L78 / File L88） |
| `disposed` | 签发本 handle 的 persistence 已 dispose | `lifecycle.closed === true` | AC1（File L91：**已 released 的 handle 在 dispose 后也报 disposed**） |

**优先级：`disposed` > `released` > entry 状态**。File 红灯测试 AC1 用同一个 handle 先后断言 `released`（L88）→ `disposed`（L91），钉死 disposed 必须先于 released 判定。

**粒度与对照**：`getStatus()` 恒答**本 handle 的 entry**；Adapter 级 `MemoryPersistence/FilePersistence.getStatus()`（聚合，`'ready' | 'persistence-degraded' | 'disposed'`，无 `released`）**保持原样不动**，仅供运维粗粒度健康观测（AC2 测试 L108 以聚合 degraded 反衬 entry 粒度）。

**边界判读**（冲突报告转交提醒，写入 ADR 修订节）：状态查询 = 持久层 flush/retry 管理状态的**只读暴露**，属 ADR 0007「Persistence 仍只管理 Y.Doc 存储、cache、flush 与 retry」边界内的读侧能力；不引入任何外部 flush/cron 协调器（ADR 0006「不设外部 flush/cron 协调器」），不携带 schema 语义。

---

## §3. 核心设计（`lifecycle.ts`，单一状态机，两 Adapter 共用）

ADR 0006 createDoc 修订节实施注记：「create/load 同键协调与 flush 调度收敛为 adapter 共享的 persistence lifecycle core（不得复制状态机）」。entry status 的实现**必须**同样收敛在 lifecycle core —— `MemoryPersistence`/`FilePersistence`（`memory.ts`/`file.ts`）零改动（saveDoc/getStatus 纯透传，见 §11 DENY LIST）。

### 3.1 entry 状态解析：`PersistenceHandle.getStatus()` → `PersistenceLifecycle.handleStatusOf()`

```ts
// lifecycle.ts
import { /* …, */ type DocHandleStatus } from './contract.js'

class PersistenceHandle implements DocHandle {
  // …(既有字段不变)…
  getStatus(): DocHandleStatus {
    return this.persistence.handleStatusOf(this)
  }
}

export class PersistenceLifecycle {
  // …
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
}
```

设计要点：

1. **同步**（AC1）：纯内存读取，无 await、无 I/O。
2. **不可达分支响亮失败**（SKILL「拒绝虚假降级」立法）：「unreleased handle + open lifecycle + 无 live entry」破坏租约不变式，属 bug 场景 → throw，绝不静默返回某个 fallback 状态。不变式论证：handle 只由 live entry 签发（`issueHandle`）；entry 被移除仅三条路径——`maybeEvict`（要求 `handles.size===0`，本 handle 在场即阻断）、dispose（`closed=true` 已被首行截获）、reading/creating cell 的清理（只发生在尚无 handle 的 cell）。外部伪造对象无 `PersistenceHandle.getStatus` 方法可言（TypeError 即天然拒绝）。
3. **同 entry 多 handle 一致**：twin handle 走同一 cell → 同状态（AC1 Memory L73-74）。
4. **跨 Adapter 无串扰**：handle 委托**签发它的** lifecycle（构造器注入），foreign lifecycle 不参与。

### 3.2 `saveDoc` 契约收窄（红灯核心点之二）

```ts
async saveDoc(handle: DocHandle): Promise<void> {
  this.assertWritable()                                   // disposed → 'persistence is disposed'（AC6，顺序不变）
  const owned = this.assertOwnedHandle(handle)            // foreign / released / 伪造身份 → 响亮拒绝（AC6，不变）
  const cell = this.cells.get(owned.entryKey)
  if (cell?.state !== 'live' || !cell.entry.handles.has(owned)) throw new Error('foreign or released DocHandle')
  // (issue #79) degraded is NOT a rejection reason: saveDoc is the
  // post-mutation dirty notification. The entry's pending retry covers the
  // new dirty generation with the full live Y.Doc.
  cell.entry.dirtyGeneration += 1
  this.scheduleFlush(cell.entry)
}
```

**唯一改动 = 删除 L200 的 `if (cell.entry.degraded) throw …`**。判定顺序（disposed → 身份 → 登记）保持不变，AC6 的四类非 degraded 拒绝逐条复验：

- foreign：`HANDLE_OWNER` WeakMap 不匹配（Memory AC6 L302）✓
- 伪造身份：`instanceof PersistenceHandle` 失败（L306）✓
- released：`isReleased`（L311）✓
- disposed：`assertWritable` 先于身份判定（L318-319，已 released 的 handle 在 disposed persistence 上仍报 `/disposed/`）✓

### 3.3 `seedForTest` 同步收窄（红灯测试 AC1 直接要求，非可选）

删除 `lifecycle.ts:211` 的 `if (cell.entry.degraded) throw new Error('persistence-degraded: …')`。

**这不是顺手的清理，是 AC1 的硬性要求**：Memory 红灯测试 L73 `const twin = await createMemoryHandleForTest(persistence, owner, 'status-doc')` 在 entry 已 degraded 时调用（L70 已断言 degraded），**必须 resolve 并签发 twin**（L74 断言 twin 也报 degraded）。语义依据：seed/load 是**读路径**租约签发，ADR 0006 降级条款明文「保留读/查询」——degraded entry 上签发租约合法；degraded 从来不是持久层读/租约路径的拒绝理由。连带处置见 §5（file-sa7-dynamic L189）。

### 3.4 调度纪律：单一调度器不变式（`scheduleFlush` 增加 retry guard）

```ts
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
  if (entry.maxDirtyTimer === undefined) entry.maxDirtyTimer = this.timer.setTimeout(() => this.onMaxDirty(entry), this.schedule.maxDirtyMs)
  if (entry.debounceTimer !== undefined) this.timer.clearTimeout(entry.debounceTimer)
  entry.debounceTimer = this.timer.setTimeout(() => this.onDebounce(entry), this.schedule.debounceMs)
}
```

**为什么加这个 guard（R1 如实改写——R0 的反证推演有事实错误，SA2 #2 /tmp 实测证伪）：**

1. **计时器卫生（可测维度，须显式钉住）**：不加 guard 时泄漏**确实存在**——degraded 窗口 saveDoc 会武装多余的 maxDirty/debounce 计时器（SA2 variant B 实测：degraded saveDoc 后 pending=5，retry 成功后仍余 2 个无人认领）。**但 R0 声称的「L159 断言失败」不成立**：`release()` → `maybeEvict`（retry 成功后 `savedGeneration === dirtyGeneration` 成立）→ `clearTimers` 会把泄漏计时器清掉，而 issue-79-file L159 与 sa7-dynamic L225 两处 `expect(timer.pending).toBe(0)` 都位于 release+dispose **之后**——**这两条断言对 guard 无判别力**（无 guard 也照样通过；同 variant 下 8 条 issue-79 红灯测试全部照样转绿）。guard 的可测价值窗口**只在「retry 成功后、任何 release 之前」**，因此本设计 R1 显式增设红灯锚点把它钉进 CI（见下），否则该纪律无任何测试保护、guard 被未来维护者当冗余删除时静默通过。
2. **单一调度器纪律（时序正确性，定性维度）**：degraded 窗口里 retry 是**已承诺**的下一轮 flush（退避上限 `maxDirtyMs`，`scheduleRetry` L456：`Math.min(Math.max(delay*2,1), maxDirtyMs)`），retry flush 启动时捕获**当下** dirtyGeneration 并以 `Y.encodeStateAsUpdate(live doc)` 全量编码——degraded 窗口的 saveDoc 天然被覆盖。再叠一对 debounce/maxDirty 只制造与 retry 竞争的第二调度源（真实时钟下 debounce 500ms 先于 retry 退避触发，制造无意义重复 I/O 尝试）。

**红灯锚点（R1 新增，SA2 #2 修订要求②，总控 R1 指令明示授权）**：`packages/persistence/test/issue-79-file-entry-status.test.ts` AC3 在 bob retry 成功断言 `expect(statusOf(bobHandle)).toBe('ready')`（L146）之后、fresh 实例块与**任何 release 之前**，插入：

```ts
// 单一调度器纪律锚点（issue #79 设计 §3.4）：retry 成功闭合脏窗口后，该 entry
// 不得残留任何无人认领的调度计时器。判别力（SA2 R1 /tmp 实测）：guard 在=0 /
// guard 无=2（degraded 窗口 saveDoc 泄漏的 maxDirty+debounce 对）。
expect(timer.pending).toBe(0)
```

实测判别力：guard 在 → 0（绿）；guard 无 → 2（红）。这是全仓唯一能把三态互斥/单一调度器纪律钉进 CI 的观察点（release 之后的 pending 断言因 eviction 清理而失明）。登记见 §5 R1 追加处置、§11 R1 修订追加。

**不变式陈述（R1 措辞修正，SA2 #4）**：任一**可观察**时刻一个 entry 至多有一个活跃调度源——健康态 = debounce+maxDirty 对；降级等待态 = retry 计时器；单飞态 = flush 持锁（`flushing`）。瞬态说明：`flush()` 的 catch→finally 同一同步续体内，catch 里 `scheduleRetry` 武装 retryTimer 时 `flushing` 尚未释放（单飞态与降级等待态并存一瞬）；该窗口为纯同步代码、无外部观察者可插入、无行为后果（finally 随后同步释放 `flushing`）。可观察互斥：`scheduleRetry` 只在 flush catch（此时 debounce/maxDirty 已被 onDebounce/onMaxDirty 自清）；`scheduleFlush` 的 flushing/retryTimer 两个 guard 分别覆盖单飞态与降级等待态；retry fire 时同步置 `retryTimer=undefined` 再 `startFlush`。既有 `flush()` finally 的重排条件（`savedGeneration !== dirtyGeneration && retryTimer === undefined`，L444）与本 guard 完全自洽——两个 guard 是同一不变式的两端。

**max-dirty 保证不降级**：ADR 0006「持续高频写入最多 5s 必定尝试一次保存」。健康态由 maxDirty 计时器承担；降级态由 retry 退避承担（≤ `maxDirtyMs`）。degraded 窗口的 saveDoc 无需另设时限——retry 必然到来且全量覆盖。

### 3.5 全部其余状态机逻辑零改动

flush/generation 保序、retry 退避、eviction（degraded+dirty entry 不可驱逐：`savedGeneration !== dirtyGeneration` 阻断，等待 retry 落盘后才可逐出——与 ADR「仅在保存成功后才真正释放实例」一致）、dispose（`clearTimers` 清含 retryTimer，先于 `cells.clear`）、create/load 合流、epoch 守卫——全部保持现状。改动面收敛为：**1 个新类型 + 1 个新接口成员 + 2 个方法实现 + 删 2 处 throw + 加 1 个 guard**。

---

## §4. dsh-persistence 探针适配（§0 #5–#6 的生产代码处置）

探针是旧契约的**观察者**：S4 场景以「saveDoc 被 degraded 拒绝」为哨兵（probe.ts L435-445）。契约翻转后哨兵语义反转，观察面必须随之演进——这不是 scope creep，是 AC9「全量 CI 通过」的必要条件（§0 已证）。

### 4.1 事件词表：`write-rejected` → `save-degraded`

- `events.ts`：联合成员 `{ readonly type: 'write-rejected' }` → `{ readonly type: 'save-degraded' }`（L30）；L7 注释词表同步。事件形状（`ProbeEventBase`，只呈现 docId）不变。
- `record.ts`：`case 'save-degraded': return \`save-degraded ${event.docId} t=${event.t}\``（替换 L46-47；switch 穷尽性由 TS 保证）。
- 语义：degraded 窗口内 saveDoc **成功登记 dirty**（新契约的正向观察），取代旧的「写入被拒」。

### 4.2 S4 哨兵块重写（probe.ts L435-445）

```ts
// issue #79 契约：degraded 不再拒绝 saveDoc。观察面改为 (a) entry 级状态 +
// (b) degraded 窗口 saveDoc resolve（dirty 登记成功）。哨兵不得被同一 catch
// 吞掉：若内核回归为 degraded 拒绝 saveDoc（或 entry 状态错答），此处 loud
// 失败（scenario-error）而非记一条假事件（与 S3 处理一致）。
if (h6.getStatus() !== 'persistence-degraded') {
  throw new ProbeFailure('status-divergence:doc-degraded')
}
await svc.saveDoc(h6) // degraded 窗口 dirty 登记 —— resolve 即契约；拒绝 → 冒泡为 scenario-error:S4-degradation
const degradedKey = toProbeKey('user-a', 'doc-degraded')
savedByKey.set(degradedKey, (savedByKey.get(degradedKey) ?? 0) + 1) // 决策 C：resolve 后才计数
emit({ type: 'save-degraded', owner: 'user-a', docId: 'doc-degraded', t: now() })
```

要点：

1. **entry 级状态成为探针断言面**（AC1/AC3 语义的端到端覆盖）；分歧走既有封闭词表 `status-divergence:doc-degraded`。
2. **决策 C 完整性**：探针 generation 记账规则是「generation 仅在 saveDoc resolve 后递增；被拒的 saveDoc 从未进入计数」。degraded saveDoc 现在 resolve → **必须**递增 `savedByKey`，否则 memoryIo 钩子的 flush 事件 generation 与真实脏代数分歧。
3. **degraded 窗口哨兵不经过 `saveAndEmit`**（保持现状的裸 `svc.saveDoc`）：`saveAndEmit` 的 file 通道「武装证明」等待（`waitFor(filePendingCount() > base)`）依赖「saveDoc resolve ⟺ scheduleFlush 武装」——§3.4 的单一调度器纪律在降级等待态刻意**不武装**（retry 已是调度器）。该等待只在健康窗口成立；S4 哨兵位于降级窗口，必须绕开（现状即如此，此处明文化）。
4. 记录时间线变化（n≥1 通道）：retry flush 事件 generation 1→2、恢复后 g2→g3（哨兵占掉一个 generation，SA2 /tmp 端态实测时间线与本预测逐字一致：`flush … generation=2 ok=true t=2008` ← retry 腿、`dirty … generation=3`、`flush … generation=3 ok=true` ← 恢复腿）；n=0 通道完全不变（哨兵在 `if (failFirstFlushes > 0)` 块内）。R0 时点无测试 pin 这些 generation 值；**R1 起由 dsh-profile AC4 追加的三条 record 断言钉死**（见 §4.3 红灯锚点），n=0 钉死值（events=28 等）不受影响（§7.2 论证）。

### 4.3 `saveAndEmit` 返回探针 generation（n=0/n≥1 双路径安全的关键）

```ts
const saveAndEmit = async (handle: DocHandle, docId: string): Promise<number> => {
  // …(既有逻辑不变)…
  savedByKey.set(key, (savedByKey.get(key) ?? 0) + 1)
  emit({ type: 'dirty', owner, docId, generation: savedByKey.get(key)!, t: now() })
  // …(file 通道武装等待不变)…
  return savedByKey.get(key)!
}
```

S4 尾部「恢复可写证明」（L497-502）的 `observeFlush('user-a', 'doc-degraded', 2, { snapshotRev: 2 })` 中硬编码 `2` 改用返回值：

```ts
degradedDoc.getMap('ROOT').set('rev', 2)
const recoveryGeneration = await saveAndEmit(h6, 'doc-degraded')
await clock.advanceBy(schedule.debounceMs)
await settle()
await observeFlush('user-a', 'doc-degraded', recoveryGeneration, { snapshotRev: 2 })
```

**为什么必须改（R1 如实改写失败模式——R0 声称的 ProbeFailure 失败不成立，SA2 #3 /tmp 实测证伪）**：memory 通道 `observeFlush` 以 `events.some(flush && generation===N && ok)` 定位事件。决策 C 落实后若保留硬编码 `2`，n≥1 通道的 retry flush 事件**恰为** `generation=2 ok=true`（决策 C 使哨兵把 savedByKey 推到 2）→ `observeFlush(2)` **空转命中错误事件**（retry 腿而非恢复腿）→ 探针 `ok=true` 全绿、**不抛 ProbeFailure**。真实后果是**恢复腿验证的静默弱化**：恢复 flush（g3）永不被观察——断言面名存实亡，且无任何红灯信号。返回值方案两通道皆准（n=0 → 2；n≥1 → 3），使 observeFlush 恒指恢复腿本体，且 n=0 行为逐字节不变。

**同构缺口（SA2 #3 指出）**：决策 C 本身也无测试钉死——若 SA3 漏做决策 C（哨兵不递增 savedByKey），retry 事件回 g1、恢复事件回 g2，硬编码 `2` 恰好命中恢复 flush → 一切照绿，而探针记账从此与内核 dirtyGeneration 失同步。两条失败路径（漏做决策 C / 漏做 §4.3）**都是静默的**，必须以 record 级精确断言钉死。

**红灯锚点（R1 新增，SA2 #3 修订要求②）**：`packages/dsh-persistence/test/dsh-profile-acceptance.test.ts` AC4 探针级用例（§5 已在编辑该用例）追加三条 record 精确断言：

```ts
// retry 腿（钉死决策 C：哨兵递增 savedByKey → retry flush 记 generation=2）
expect(result.record).toContain('flush doc-degraded generation=2 ok=true')
// 恢复腿（钉死 §4.3 返回值路径 + 决策 C：saveAndEmit 记 g3、恢复 flush 记 g3）
expect(result.record).toContain('dirty doc-degraded generation=3')
expect(result.record).toContain('flush doc-degraded generation=3 ok=true')
```

三个值是设计正确实现的确定产物（SA2 /tmp 端态实测时间线，见其评审附录 A；与 §4.2 要点 4 预测逐字一致），可安全钉死。判别力：漏做决策 C → 恢复腿回 g2、无 g3 事件 → **第二/三条断言红**（第一条会空转命中恢复腿，属已知盲区）；漏做 §4.3 → memory 通道 record 不变、本组断言不判别——其残余风险由第三条断言（恢复 flush 存在性）与决策 C 锚点联合覆盖；如需彻底钉死 §4.3，须补 file n≥1 探针 record 断言（后续任务）。n=0 通道不受影响（哨兵在 `if (failFirstFlushes > 0)` 块内），`events=28` 钉死值安全。登记见 §5 R1 追加处置、§11 R1 修订追加。

### 4.4 不改动的探针面

`profile.ts`（`DshPersistenceProfile.getStatus()` 是 Adapter 聚合透传，保持）、`cli.ts`（只打印 record 字符串）、`clock.ts`、`index.ts` 导出面、S1/S2/S3 场景、S4 的失败注入/退避循环/恢复腿结构、file 通道 `ensureBlocked`/`unblock`/`readSnapshotRev` 观察通道。

---

## §5. 旧契约测试转红处置（SA3 实现后同步更新；含 SA3 提示 3 处 + R0 补充 6 处 + R1 追加 3 处）

| 文件:行 | 现断言（旧契约） | 改为（新契约） | 理由 |
|---|---|---|---|
| `packages/persistence/test/memory-persistence.test.ts:307` | `await expect(persistence.saveDoc(handle)).rejects.toThrow(/persistence-degraded/)` | `expect(handle.getStatus()).toBe('persistence-degraded'); await expect(persistence.saveDoc(handle)).resolves.toBeUndefined()` | AC5；同测试后续 `advanceBy(500)` 后 L316 `ready` / L317 resolve 断言在 §3.4 纪律下依旧成立（retry 于 t=1000 捕获含哨兵增量的最新代，落盘后 saved===dirty） |
| `packages/persistence/test/memory-persistence.test.ts:350` | 同上（`restored` handle） | 同上模式（`restored!.getStatus()` degraded + saveDoc resolve） | 同上；该测试 L346 先 release（degraded+dirty entry 不驱逐）→ L347 loadDoc 命中同一 live entry → 状态延续 degraded |
| `packages/persistence/test/file-persistence-sa7-dynamic.test.ts:188` | `saveDoc(bobHandle)).rejects.toThrow(/persistence-degraded/)` | `expect(bobHandle.getStatus()).toBe('persistence-degraded'); await expect(persistence.saveDoc(bobHandle)).resolves.toBeUndefined()` | AC5（file 面） |
| `packages/persistence/test/file-persistence-sa7-dynamic.test.ts:189` | `createFileHandleForTest(persistence, BOB, 'doomed')).rejects.toThrow(/persistence-degraded/)` | `const twin = await createFileHandleForTest(persistence, BOB, 'doomed'); expect(twin.getStatus()).toBe('persistence-degraded'); await twin.release()` | §3.3 seedForTest 收窄（与 Memory AC1 twin 同一要求）；twin release 后 entry 仍被 bobHandle 持有，不触发驱逐 |
| `packages/persistence/test/file-persistence-sa7-dynamic.test.ts:207` | `saveDoc(bobHandle)).rejects.toThrow(/persistence-degraded/)` | `expect(bobHandle.getStatus()).toBe('persistence-degraded'); await expect(persistence.saveDoc(bobHandle)).resolves.toBeUndefined()` | Coverage 3 的语义从「Bob 仍被拒」转为「Bob 仍降级（entry 状态）」——不变的断言目标是「Alice 的成功 flush 不恢复 Bob」，改以 entry 状态为观察面后语义更强且不依赖旧拒绝行为 |
| `packages/dsh-persistence/test/dsh-profile-acceptance.test.ts:349-371` | 标题「后续写拒绝」+ L356/L361/L364 `rejected`（`write-rejected` 事件）+ L369 `toContain('write-rejected doc-degraded')` | 标题改为「…degraded 窗口 saveDoc 登记（save-degraded）→ retry 成功恢复」；事件类型/变量名改 `save-degraded` / `saveDegraded`；L369 改 `toContain('save-degraded doc-degraded')`；时序断言结构（L364 排序）不变 | §4.1 词表演进；事件仍位于 `degraded` 之后、`recovered` 之前，排序断言保持 |
| `packages/dsh-persistence/test/dsh-profile-acceptance.test.ts:392` | `saveDoc(handle)).rejects.toThrow(/persistence-degraded/)` | `expect(handle.getStatus()).toBe('persistence-degraded'); await expect(profile.persistence.saveDoc(handle)).resolves.toBeUndefined()` | AC5（service 级，memory）；后续 retry/ready/resolve 断言（L394-396）在 §3.4 下依旧成立 |
| `packages/dsh-persistence/test/dsh-profile-acceptance.test.ts:421` | 同上（file） | 同上模式 | 同上（file；L426 `waitFor(ready)` 已是 deadline 式真实结算） |
| `packages/dsh-persistence/test/dsh-probe-cli.test.ts:105-112` | 标题「degraded → write-rejected → recovered」+ L110 `toContain('write-rejected doc-degraded')`（L11 注释词表） | 标题与断言改 `save-degraded`；L108 `flush doc-degraded generation=1 ok=false`、L109 `degraded`、L111 `recovered` 三条断言**不变** | §4.1；失败 flush 的 generation=1 不受哨兵影响（哨兵在其后） |

SA6 红灯测试两文件（`issue-79-entry-status.test.ts` / `issue-79-file-entry-status.test.ts`）的**既有断言**不需要任何改动即可转绿：本地 cast `(handle as unknown as HandleWithStatus).getStatus()` 在接口扩展后仍是合法的结构超集收窄；全部断言锚定运行时行为。R1 对 file 文件追加一条锚点插入，见下表。

### R1 追加处置（SA2 R1 #1/#2/#3 修订要求）

| 文件:行 | 处置 | 理由与授权依据 |
|---|---|---|
| `packages/persistence/test/persistence-contract.test.ts:120-133`（L122 字面量） | 字面量补成员 `getStatus() { return 'ready' }`；并在用例内追加 `expect(handle.getStatus()).toBe('ready')` | **SA2 R1 #1（CRITICAL）**：该字面量直接类型标注 `DocHandle`（结构义务，非 cast）——不补则 `tsc` `TS2741`、CI typecheck 必红（§0 #9）。补行为断言使该用例继续充当公共契约面探针（接口扩展后 `handle.doc` 同一性、无 `evict`/`list` 泄露成员等既有断言全部保留）。原 DENY 解除，移入 ALLOW（§11） |
| `packages/persistence/test/issue-79-file-entry-status.test.ts` AC3（L146 `expect(statusOf(bobHandle)).toBe('ready')` 之后、fresh 实例块与任何 release 之前） | 插入单一调度器纪律锚点 `expect(timer.pending).toBe(0)`（完整代码见 §3.4 红灯锚点块） | **SA2 R1 #2 修订要求② + 总控 R1 修订指令明示授权**。授权依据：该文件为 `[SA6 owned]`，本次插入属**设计明示的测试基建许可**——SKILL 文件清单规则允许设计明示的基建级修正；本插入为**新增锚点**，不修改、不删除、不弱化任何既有 SA6 断言（L159 既有 pending 断言原样保留）。判别力（SA2 /tmp variant B 实测）：§3.4 guard 在=0（绿）/ 无=2（红）——release 之后的 pending 断言因 eviction 清理而失明，此点是唯一可判别观察位 |
| `packages/dsh-persistence/test/dsh-profile-acceptance.test.ts` AC4 探针级用例（L349-371，§5 主表已在编辑该用例） | 追加三条 record 精确断言：`toContain('flush doc-degraded generation=2 ok=true')`、`toContain('dirty doc-degraded generation=3')`、`toContain('flush doc-degraded generation=3 ok=true')`（完整代码见 §4.3 红灯锚点块） | **SA2 R1 #3 修订要求②**：决策 C 与 §4.3 返回值路径的两条失败路径均静默（§4.3 如实改写后的论证），须以确定产物钉死（SA2 /tmp 端态实测时间线）。n=0 钉死值不受影响 |

---

## §6. ADR 0006 修订节草案（AC8；体例参照既有「createDoc 与 owner 语义修订」节）

以下为 SA3 落回 `docs/adr/0006-server-persistence-docstore.md` 文末的修订节全文（追加于「supersede 裁决撤销」节之后）：

> ### DocHandle entry status 与 saveDoc 职责修订（2026-08-22，issue #79；演进经 owner 裁决放行——issue #79 AC1/AC8 明文授权）
>
> 本节为**增量演进**：扩展 DocHandle 接口形状（新增 `getStatus()`），并修订「save 失败按 doc 只读降级」条款中 degraded 拒绝面的归属。除下列明示条款外，未提及的条款（含「createDoc 与 owner 语义修订」节全部条款）维持原文效力。
>
> **1. 接口契约（在「createDoc 与 owner 语义修订」节的接口代码块上追加 `getStatus` 成员，其余成员不变）**：
>
> ```ts
> type DocHandleStatus = 'ready' | 'persistence-degraded' | 'released' | 'disposed'
>
> interface DocHandle {
>   readonly owner: User;   // 文档的存储所有者（分区键），非当前访问者
>   readonly docId: string;
>   readonly doc: Y.Doc;
>   /** 同步返回本 handle 所属 (owner.userId, docId) entry 的持久层状态。 */
>   getStatus(): DocHandleStatus;
>   release(): Promise<void>;
> }
> ```
>
> - 状态查询是 **entry 级**的：恒答该 handle 自己的 `(owner.userId, docId)` entry 状态，不得以 Adapter 聚合状态代替（Adapter 级 `getStatus` 是粗粒度健康汇总，仅供运维观测，不构成写前 gate 依据）；
> - 状态词与优先级冻结：`disposed`（签发方已 dispose）> `released`（本租约已释放）> entry 状态（`persistence-degraded`：该 entry 最近一次 flush 失败且尚未 retry 成功；`ready`：其余情形，含 flush 在途）；
> - `getStatus()` 只表示**调用瞬间**状态，不承诺后续 flush 成功——写前状态检查不是持久化成功保证（与「saveDoc 返回仅表示脏状态已登记」「rename 成功即完成一次 flush，不承诺掉电级持久性」同款无承诺纪律）。
>
> **2. saveDoc 职责（修订「saveDoc = 脏状态通知」与「save 失败按 doc 只读降级」条款的边界）**：
>
> - saveDoc 是 **mutation 后的 dirty notification**：只要租约有效（未 released、非 foreign、身份匹配、Persistence 未 disposed），saveDoc 必须递增 dirtyGeneration 并 resolve——entry 处于 `persistence-degraded` **不构成拒绝理由**；已提交进 live Y.Doc 的事务由持久层内部 retry 以完整 Y.Doc 状态最终持久化；
> - 「失败后 namespace 进入 `persistence-degraded`……拒绝**后续** REST/WS 写入」的拒绝面归属**业务编排层**：Runtime（ADR 0007 NamespaceRuntime 写前 gate）在业务 mutation 前读取 `handle.getStatus()`，已 degraded 则拒绝开始新写入（零写入：文档不变、响亮拒绝）。持久层自身仅在租约身份失效（foreign/released/身份失配）或 disposed 时响亮拒绝；
> - gate 检查通过后才转为 degraded 的 mutation 不属「后续」写入：其内存事务保留、saveDoc 正常登记、由 retry 覆盖最新完整 live Y.Doc；
> - 降级等待期内（任一可观察时刻）retry 退避即该 entry 的唯一 flush 调度源（退避上限 max-dirty 间隔；flush 记账的 catch→finally 同步续体内允许瞬态并存，无外部可观察后果），「不设外部 flush/cron 协调器」不变。
>
> **3. 实施注记**：entry 状态解析收敛于 adapter 共享的 persistence lifecycle core（两 Adapter 不得复制状态机）；MemoryPersistence 与 FilePersistence 以平行验收套件覆盖同一状态契约（`issue-79-entry-status.test.ts` / `issue-79-file-entry-status.test.ts`）。

---

## §7. 架构一致性与全局兼容保障

### 7.1 与 ADR/CONTEXT 逐条对照（承接冲突报告「逐条一致性对照」+ evolution 放行）

| 设计决策 | ADR 条款（relevant_decisions 摘录） | 关系 |
|---|---|---|
| saveDoc degraded 不拒绝（§3.2） | 「saveDoc = 脏状态通知……不构成落盘承诺」「失败事务……由持久层内部 retry 持久化」 | 收窄回归原义（冲突报告 L39 已裁：代码偏离不构成 ADR 冲突基准） |
| entry 级 getStatus（§2/§3.1） | 「save 失败按 **doc** 只读降级」；CONTEXT「namespace = 一个 Y.Doc…」 | 降级粒度本就是 entry，查询面与粒度对齐 |
| Runtime 写前 gate 语义（§1.4/§6） | ADR 0007「轮到 mutation 时先检查 writable gate……成功后立即调用 saveDoc 标脏」+ ADR 0006「拒绝**后续** REST/WS 写入」 | 互为具体化；gate≠本任务实现项（本任务只供查询面） |
| retry 覆盖最新完整 live Y.Doc（§3.4） | 「单飞 flush + generation 保序……flush 启动时捕获 generation」「以 `Y.encodeStateAsUpdate(doc)` 编码完整 Y.Doc 状态」 | 既有机制，零改动，AC7 即其确定性重放 |
| 非 degraded 错误继续响亮拒绝（§3.2） | 「foreign handle、已释放 handle 的 saveDoc 都响亮拒绝」「dispose 时释放……」 | 判定顺序不变 |
| 状态查询=flush/retry 管理状态只读暴露（§2.2） | ADR 0007「Persistence 仍只管理 Y.Doc 存储、cache、flush 与 retry」+ ADR 0006「不设外部 flush/cron 协调器」 | 边界内读侧能力，冲突报告 L25/L57 判读一致 |
| evolution：DocHandle 接口扩展 + ADR 修订（§2/§6） | ADR 0006 冻结接口契约（createDoc 修订节） | **冲突点 #1，演进已放行**：owner 在 issue #79 AC1/AC8 中明文要求该演进（issue 即 owner 授权，SA8 R1 备注对齐），总控 dispatch #4 循 issue #64 先例放行；纯增量（不删不改既有成员），落地面=修订节 + owner 裁决标注（标注措辞见 §6 标题行） |
| 两 Adapter 同组覆盖（§6 注记 3） | 「两 Adapter 必须通过同一组 createDoc shared contract tests」 | 状态机单点实现于 lifecycle core；两 Adapter 套件平行锚定同一契约（SA6 已交付 Memory+File 双文件）；如未来需晋升为 shared contract suite，属 SA6 后续任务，不在本任务 ALLOW LIST |

### 7.2 既有 65 绿用例不受影响的分类论证

| 测试文件 | 耦合点 | 结论 |
|---|---|---|
| `persistence-contract.test.ts`（service 注册/schedule/timer seam） | **R1 修正（SA2 #1）**：除 `stubPersistence`（实现未改动的 `DocPersistence`，无义务）外，L120-133 存在**直接类型标注 `DocHandle` 的结构字面量**（§0 #9）——接口扩展使其负有 `getStatus` 结构义务 | **受影响（类型层）**：字面量补 `getStatus() { return 'ready' }` + 行为断言（§5 R1 追加处置）；其余用例不受影响 |
| `testing.ts` 两个 shared suite（经 memory/file/contract 各处 invoke） | 全部 saveDoc 调用都在健康 entry 上 | 不受影响 |
| `memory-persistence.test.ts` 其余用例（含 generation 保序 L243-280、驱逐、隔离、META 校验） | 不触 degraded-saveDoc；调度路径未变 | 不受影响（§5 仅改 2 行） |
| `file-persistence.test.ts` / `sa7-supplementary.test.ts` / `core-dsh-boundary.test.ts` / `module-graph-regression.test.ts` | grep 无 `persistence-degraded` 锚点；module-graph 只审 reverse-barrel import（新导出为增量） | 不受影响 |
| `file-persistence-sa7-dynamic.test.ts` 其余用例（tmp sweeping 等） | 无 degraded 锚点 | 不受影响（§5 仅改 1 个用例内 3 行） |
| dsh 探针 **n=0** 路径（`dsh-file-probe-determinism.test.ts` 全部：`events=28` 钉死值；`dsh-profile-acceptance` AC2/AC3/AC6） | 哨兵在 `if (failFirstFlushes > 0)` 块内，n=0 不执行；§4.3 返回值方案使 post-recovery observeFlush 的 generation 在 n=0 下仍为 2（行为逐字节不变） | **钉死值安全**——这是 §4.3 选择「返回值」而非「硬编码 3」的原因 |
| dsh 探针 n≥1 路径（`dsh-probe-cli` L105-112、`dsh-profile-acceptance` L349-371） | 词表/哨兵演进；n≥1 时间线 generation 偏移（retry g2/恢复 g3） | §4/§5 显式更新；R1 起追加三条 generation record 精确断言钉死决策 C 与 §4.3（§4.3 红灯锚点） |

### 7.3 兼容矩阵：新契约 × 旧调用形态

| 调用形态 | 旧行为 | 新行为 | 兼容性 |
|---|---|---|---|
| 健康窗口 saveDoc | 登记 dirty + 武装 | 不变 | 逐字节相同 |
| degraded 窗口 saveDoc | throw | 登记 dirty，retry 覆盖 | **预期变更**（AC5/AC7 红灯点） |
| released/foreign/伪造/disposed saveDoc | 响亮拒绝 | 不变（AC6 护栏） | 逐字节相同 |
| Adapter 聚合 getStatus | 三态聚合 | 不变 | 逐字节相同 |
| 健康/降级窗口 loadDoc、seedForTest 复用、release、evict、dispose | — | 不变（seedForTest 仅去掉 degraded throw） | 兼容 |
| 未持有 handle 直接读状态 | 不可能 | 仍不可能（状态面只随租约暴露，符合 lease 模型） | — |

---

## §8. 竞态与边界条件矩阵

### 8.1 AC7 确定性竞态全 trace（Memory，fake timer；验证 §3.2+§3.4 联合正确性）

| 步 | 动作 | 内核状态（dirtyGen/savedGen/degraded/timers） | 断言 |
|---|---|---|---|
| 1 | seed `race-doc`；`ROOT.generation=1`；saveDoc | 1/0/false；武装 maxDirty=id0, debounce=id1 | — |
| 2 | `advanceBy(500)` → debounce 火 → flush 启动，write 停在 gate | 1/0/false；flushing=true；snapshot=gen1 | `writes===1` |
| 3 | **写前观察** | degraded 尚未翻转 | `getStatus()==='ready'` ✓（瞬间性） |
| 4 | mutation 2 入 live Y.Doc | （doc 层面；内核计数不变） | — |
| 5 | 释放 gate 且 reject → flush catch | 1/0/**true**；retry=id2(delay 500→t=1000)；finally：saved(0)≠dirty(1) 但 retryTimer 在 → 不重排 | `getStatus()==='persistence-degraded'` ✓ |
| 6 | **degraded saveDoc** | **2**/0/true；§3.4 guard：retry 在 → 不另武装 | **resolve** ✓（红灯核心点） |
| 7 | `advanceBy(500)` → retry 火 → flush 捕获 gen2、全量编码 live doc（含 mutation 2）→ write 成功 | 2/2/**false**；finally：saved===dirty → 不重排；handles>0 不驱逐 | `writes===2`、`getStatus()==='ready'` ✓ |
| 8 | 新 Persistence 实例（共享 store hooks）loadDoc | — | `ROOT.generation===2` ✓ |

### 8.2 边界枚举

| # | 边界 | 设计行为 | 依据 |
|---|---|---|---|
| E1 | flush 在途（未失败）时 getStatus | `ready`（degraded 只在 catch 翻转） | AC7 步 3 |
| E2 | degraded entry 的 twin handle | 同 entry → `persistence-degraded` | Memory AC1 L73-74 |
| E3 | released handle + 开放 persistence → dispose | `released` → 后 `disposed`（closed 先判） | Memory/File AC1 |
| E4 | 未 release handle + dispose | `disposed`（不触碰已销毁 entry） | Memory AC1 keeper |
| E5 | released+degraded-entry handle | `released`（租约态优先于 entry 态） | 优先级序（§2.2） |
| E6 | degraded 窗口内 saveDoc 两次 | 每次递增 dirtyGen；retry 一次全量覆盖 | dirty 通知幂等语义 |
| E7 | retry flush 在途再 saveDoc | flushing guard 挡武装；flush finally 按需重排（retryTimer 已消耗 → 走 debounce 重排） | 既有 finally 条件 |
| E8 | retry 再失败 | scheduleRetry 退避重排（上限 maxDirtyMs），循环至成功或 dispose | ADR「退避直到成功或插件停止」 |
| E9 | degraded+dirty entry 全部 handle release | 不可驱逐（saved≠dirty），retry 落盘后才逐出 | 既有 maybeEvict，ADR「保存成功后才真正释放」 |
| E10 | degraded 窗口 dispose | clearTimers 清 retryTimer，drain in-flight，closed 置位 | 既有 dispose |
| E11 | handle 查询时 entry 竟不存在（不变式破坏） | **loud throw**，绝不静默降级 | SKILL 虚假降级立法（§3.1 论证不可达） |
| E12 | 无 mutation 的 degraded saveDoc（探针哨兵） | 合法 dirty 通知：递增代数并 resolve | ADR「saveDoc=脏通知」无 mutation 前置要求 |
| E13 | 同 Adapter 另一 entry flush 成功 | 不恢复降级 entry（entry 独立）；聚合 getStatus 仍 degraded | AC4（Memory L141-144 / File L138） |
| E14 | retry 成功闭合脏窗口后、任何 release 之前（guard 判别窗口） | entry 无残留调度计时器：guard 在 → `pending===0`；guard 无 → 泄漏的 maxDirty+debounce 对残留（`pending===2`）。release 之后因 `maybeEvict → clearTimers` 失明（R1 修正认知，SA2 #2） | §3.4 红灯锚点（issue-79-file AC3 R1 插入断言） |

---

## §9. 协议假设依据 (Protocol Assumption Evidence)

**无协议级假设**：本设计仅涉及进程内 TypeScript 接口扩展、类型与调度逻辑（timer seam 为既有 `PersistenceTimer` 注入面），无 HTTP/WS 端点、端口占用、跨进程资源生命周期或第三方库未验证行为假设。

为完备起见，列出两项**测试机械学**前提（均非本设计新引入，属 SA6 已交付红灯测试的运行前提）：

| 假设 | 依据类型 | 依据内容 | 风险等级 |
|---|---|---|---|
| chmod 0o500 目录上 `fsp.writeFile` 以 EACCES 失败（File 红灯测试 AC3 注入法） | 类比已有测试验证 | `packages/persistence/test/file-persistence-sa7-dynamic.test.ts:158-229`（当前 65 绿之一）采用同一 `chmodSync(bobDir, 0o500)` 注入法并在本类 runner 通过；探针 file 通道（`dsh-profile-acceptance.test.ts:404-435`）亦然 | 低 |
| ManualTimer 插入序确定性（fireOldest = 最低 id 先火） | 现有测试引用 | `file-persistence-sa7-dynamic.test.ts` ManualTimer（L164 起）现有绿灯即依赖该语义；`issue-79-file-entry-status.test.ts` 复用同款 | 低 |

---

## §10. 契约改动连锁审计 (Contract Change Caller Audit)

### 改动函数/接口

| 函数/接口 | 文件 | 改动前契约 | 改动后契约 |
|---|---|---|---|
| `PersistenceLifecycle.saveDoc` | `packages/persistence/src/lifecycle.ts:195` | degraded entry → `throw Error('persistence-degraded: …')` | degraded entry → resolve（递增 dirtyGeneration，§3.4 纪律下由 retry 覆盖）；foreign/released/身份失配/disposed 拒绝不变 |
| `PersistenceLifecycle.seedForTest` | `packages/persistence/src/lifecycle.ts:206` | 复用 degraded live cell → throw | 复用 degraded live cell → 正常签发 handle（报 degraded） |
| `DocHandle`（接口） | `packages/persistence/src/contract.ts:10` | 4 成员 | +`getStatus(): DocHandleStatus`（纯增量；结构实现者共两处：生产 `PersistenceHandle` + 测试 `persistence-contract.test.ts:122` 类型标注字面量——后者负有结构义务，须同步补成员，见 §0 #9 / §5 R1） |
| `ProbeEvent` 判别联合 | `packages/dsh-persistence/src/events.ts:30` | 含 `{type:'write-rejected'}` | 改 `{type:'save-degraded'}`（记录词表演进，dev 工具输出面，非冻结公共 API） |

### Caller 清单（`git grep -n "saveDoc\s*(" -- 'packages/**/*.ts'` 全集，apps/domains/tests 零命中）

| Caller | 文件:行号 | 是否 await | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---|---|---|---|---|
| `MemoryPersistence.saveDoc` | `packages/persistence/src/memory.ts:75` | 透传 | ❌ | ❌ | 纯透传，无需改 |
| `FilePersistence.saveDoc` | `packages/persistence/src/file.ts:68` | await | ❌（前置 validateIdentity） | ❌ | 纯透传，无需改 |
| `describeDocPersistenceContract` ×3 调用点 | `packages/persistence/src/testing.ts:37,55,65,75,77` | await | ❌（vitest 断言） | vitest | 全部健康 entry 调用，行为不变 |
| `describeDocCreateContract` 调用点 | `packages/persistence/src/testing.ts:278` 等 | await | ❌ | vitest | 健康 entry，不变 |
| `memory-persistence.test.ts` | L298 等 + **L307/L350** | await | ❌ | vitest | L307/L350 按 §5 反转；其余健康调用不变 |
| `file-persistence-sa7-dynamic.test.ts` | L172/L176/L196 + **L188/L207** | await | ❌ | vitest | §5 处置 |
| `issue-79-*` 红灯测试（SA6） | 两文件多处 | await | ❌ | vitest | 设计目标：转绿，既有断言零改动；R1 对 file 文件追加 1 条设计明示锚点（§3.4/§5 R1，SA2 #2 + 总控授权） |
| `probe.ts saveAndEmit` | `packages/dsh-persistence/src/probe.ts:248` | await | ❌（step 包装：scenario-error） | 探针 step catch | 健康/恢复窗口调用，武装等待不变（§4.2-3 明文化 degraded 窗口不适用） |
| `probe.ts S4 哨兵` | `packages/dsh-persistence/src/probe.ts:438` | await | ❌（冒泡 scenario-error） | step catch | §4.2 重写：resolve 为契约，reject→loud |
| `dsh-profile-acceptance.test.ts` | L186/L317/L318/L389/L396/L414/L428 + **L392/L421** | await | ❌ | vitest | §5 处置两处，其余健康调用不变 |

**seedForTest caller**：`memory.ts:98`（`[TEST_FACTORY]`，经 `test/memory-testkit.ts` 与红灯测试）、`file.ts:83`（经 `createFileHandleForTest`，sa7-dynamic L189 与 File 红灯测试）——行为变化=degraded cell 上从 throw 变签发，处置见 §3.3/§5。

**DocHandle.getStatus caller（新面）**：Runtime 写前 gate 为未来消费者（ADR 0007，本任务不实现）；本任务内消费者=红灯测试（经 cast）+ 探针 S4（§4.2）+ `persistence-contract.test.ts:122` 字面量（实现者兼消费者，§5 R1 补成员与行为断言）。**R1 修正（SA2 #1）**：`DocHandle` 的结构实现者共两处——`PersistenceHandle`（生产）与 persistence-contract.test.ts:122 的**直接类型标注字面量**（R0 曾误判「伪造对象经 `as unknown as` 强转，无结构义务」——该误判只适用于红灯测试的 forged 对象，不适用于此字面量；字面量对接口形状负有结构义务，接口加成员即 TS2741）。`stubPersistence` 实现的是未改动的 `DocPersistence`，无义务。

**风险评估**：改动无新增 throw 路径（只删 throw），无同步变异步，无返回类型 nullable 翻转——caller 侧唯一可观察差异是「原先 reject 的 degraded 调用现在 resolve」。全部此类 caller 已在 §5 逐行处置；漏列 caller 的代价上限=CI 红灯（断言期望 reject 实际 resolve），无生产 P0 面（apps/ 无消费者）。

---

## §11. 文件清单（File Scope）

### ALLOW LIST

- `packages/persistence/src/contract.ts` — 修改，新增 `DocHandleStatus` 类型 + `DocHandle.getStatus()` 成员（§2.1，约 +20 行）
- `packages/persistence/src/lifecycle.ts` — 修改，`PersistenceHandle.getStatus` + `PersistenceLifecycle.handleStatusOf`（§3.1）；删 saveDoc degraded throw（§3.2，-1 行）；删 seedForTest degraded throw（§3.3，-2 行）；`scheduleFlush` 加 retry guard（§3.4，+8 行含注释）
- `packages/persistence/src/index.ts` — 修改，追加导出 `type DocHandleStatus`（§2.1，+1 行）
- `packages/dsh-persistence/src/events.ts` — 修改，`write-rejected` → `save-degraded` 联合成员与注释（§4.1，2 行）
- `packages/dsh-persistence/src/record.ts` — 修改，渲染分支改名（§4.1，2 行）
- `packages/dsh-persistence/src/probe.ts` — 修改，S4 哨兵块重写（§4.2）、`saveAndEmit` 返回 generation、post-recovery `observeFlush` 改用返回值（§4.3）、相关注释（合计约 ±25 行）
- `docs/adr/0006-server-persistence-docstore.md` — 修改，文末追加修订节（§6 全文，AC8）
- `packages/persistence/test/memory-persistence.test.ts` — 修改，L307/L350 断言反转 + 状态断言（§5；含用例标题措辞更新）
- `packages/persistence/test/file-persistence-sa7-dynamic.test.ts` — 修改，L188/L189/L207 断言反转 + 状态断言（§5）
- `packages/dsh-persistence/test/dsh-profile-acceptance.test.ts` — 修改，L349-371 事件词表/变量、L392/L421 断言反转（§5）
- `packages/dsh-persistence/test/dsh-probe-cli.test.ts` — 修改，L105-112 词表与标题（§5）
- `packages/persistence/test/issue-79-entry-status.test.ts` — `[SA6 owned]` 验收红灯测试（Memory，6 用例）。SA3 不改断言逻辑；仅允许测试基础设施级修正（如超时/hook 配置），违者 SA4 scope 审查拒绝
- `packages/persistence/test/issue-79-file-entry-status.test.ts` — `[SA6 owned]` 验收红灯测试（File，2 用例）。同上约束；R1 追加一条设计明示锚点插入（见下方 R1 修订追加）

### ALLOW LIST（R1 修订追加）

- `packages/persistence/test/persistence-contract.test.ts` — 修改，L122 `DocHandle` 类型标注字面量补 `getStatus() { return 'ready' }` + 追加 `expect(handle.getStatus()).toBe('ready')` 行为断言（SA2 R1 #1，CRITICAL：不补则 CI typecheck `TS2741` 必红；§0 #9 / §5 R1）。**原 DENY 解除**——R0 误判「无旧契约锚点」，实际负有接口结构义务
- `packages/persistence/test/issue-79-file-entry-status.test.ts` — `[SA6 owned]`（原 ALLOW 条目描述扩展）：AC3 追加单一调度器纪律锚点 `expect(timer.pending).toBe(0)`（retry 成功后、release 前；SA2 R1 #2 + 总控 R1 指令明示授权的测试基建许可；§3.4/§5 R1）。不改任何既有断言
- `packages/dsh-persistence/test/dsh-profile-acceptance.test.ts` — （原 ALLOW 条目描述扩展）：AC4 探针级用例追加三条 record 精确断言 `flush doc-degraded generation=2 ok=true` / `dirty doc-degraded generation=3` / `flush doc-degraded generation=3 ok=true`（SA2 R1 #3；钉死决策 C 与 §4.3 返回值路径；§4.3/§5 R1）

### DENY LIST

- `packages/persistence/src/memory.ts` — saveDoc/getStatus 纯透传、`[TEST_FACTORY]` 纯透传，本任务不动（§3 收敛于 lifecycle core）
- `packages/persistence/src/file.ts` — 同上（seedForTest 仅 validateIdentity+透传）
- `packages/persistence/src/testing.ts` — shared contract suites 全部锚定健康路径；entry-status shared suite 化属 SA6 后续任务，本任务不新增测试基础设施
- `packages/dsh-persistence/src/profile.ts` — `DshPersistenceProfile.getStatus()` 为 Adapter 聚合透传，保持三态
- `packages/dsh-persistence/src/cli.ts`、`clock.ts`、`index.ts` — CLI 只打印 record；clock/index 无事件耦合
- `packages/dsh-persistence/test/dsh-file-probe-determinism.test.ts` — n=0 钉死值（events=28）必须原样保持绿色（§7.2），不改
- `packages/persistence/test/sa7-supplementary.test.ts`、`core-dsh-boundary.test.ts`、`module-graph-regression.test.ts`、`file-persistence.test.ts` — 无旧契约锚点（R1 复核：亦无 `DocHandle` 结构实现者），不动。（`persistence-contract.test.ts` 原列于此，R1 因 SA2 #1 结构义务发现移入 ALLOW——见上方 R1 修订追加）
- `CONTEXT.md` — 无新领域术语（DocHandleStatus 属接口细节）；本任务不动
- `apps/**`、`domains/**`、`tests/**`、`.github/**`、`pnpm-*.yaml` — 无消费者/无 CI 配置变更需求

---

## §12. SA2 反馈逐条回应（R1，对照 `wiki/raw/task_issue-79_sa2_review.md` 攻击点清单 + 总控 R1 修订指令）

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|---|---|---|---|
| #1（CRITICAL）补 §0 爆炸半径第 9 点：persistence-contract.test.ts:122 结构字面量；§5 追加处置行；§11 移入 ALLOW；§10 caller 审计句修正 | ✅ | §0 表第 9 行 + 尾段；§5「R1 追加处置」第 1 行；§7.2 persistence-contract 行；§10 接口表 DocHandle 行 + getStatus caller 段 + caller 表红灯测试行；§11「ALLOW LIST（R1 修订追加）」+ DENY 行修订 | 第 9 点登记（类型层结构义务，TS2741 证据）；处置=字面量补 `getStatus() { return 'ready' }` + 行为断言使其继续充当公共契约面探针；原 DENY 解除并注明理由；§10「无其他结构实现者」误判修正为「两处实现者」并区分 cast（无义务）与类型标注（有义务） |
| #2（MAJOR）修正 §3.4 证据 #1 反证（实测 L159/L225 照样过）；如实改写 guard 价值论证；补红灯锚点（issue-79-file AC3 retry 成功后、release 前插 `expect(timer.pending).toBe(0)`） | ✅ | §3.4「为什么加这个 guard」整段重写 + 红灯锚点块；§8.2 E14；§5 R1 表第 2 行；§11 R1 追加；§12 本行 | 如实承认 R0 反证错误：泄漏存在（degraded saveDoc 后 pending=5、retry 后余 2）但被 `release → maybeEvict → clearTimers` 清理，两处既有 pending 断言无判别力（附 SA2 variant B 实测数）；guard 价值改写为「计时器卫生（可测，须显式钉住）+ 单一调度器纪律（定性）」；锚点插入含授权依据（SA6 owned 文件的设计明示测试基建许可，不改既有断言），判别力 guard 在=0 / 无=2 |
| #3（MAJOR）修正 §4.3 失败模式（真实后果=恢复腿失验证的静默弱化，非 ProbeFailure）；补红灯锚点（dsh-profile AC4 三条 record 精确断言） | ✅ | §4.3「为什么必须改」整段重写 + 同构缺口段 + 红灯锚点块；§4.2 要点 4 同步修正（「无测试 pin」→「R1 起钉死」）；§7.2 n≥1 行；§5 R1 表第 3 行；§11 R1 追加 | 如实承认 R0 失败模式错误：决策 C 落实后硬编码 2 会空转命中 retry flush 事件（generation=2 ok=true）→ 探针全绿、恢复腿（g3）永不被验证；补「决策 C 本身亦无锚点」同构缺口；三条断言钉死 retry 腿 g2 / 恢复腿 dirty g3 + flush g3（漏做决策 C → 第一条红；g3 缺失/错号 → 第三条红） |
| #4（MINOR）§3.4/§6 措辞：「任一时刻」→「任一可观察时刻」或加瞬态说明 | ✅ | §3.4 不变式陈述（含 catch→finally 同步续体瞬态并存说明）；§6 修订节草案条款 2 末条（「降级等待期内（任一可观察时刻）……允许瞬态并存，无外部可观察后果」） | 冻结条款不再含可挑刺表述 |
| #5（总控顺带，SA8 R1 备注）ADR 修订节标题/标注措辞对齐实际放行依据（issue 即 owner 授权） | ✅ | §6 修订节草案标题行（「演进经 owner 裁决放行——issue #79 AC1/AC8 明文授权」）；§0 输入基线冲突裁决段；§7.1 evolution 行 | 放行依据从「总控先例放行」精确化为「owner 在 issue #79 AC1/AC8 明文要求该演进（issue 即 owner 授权）+ 总控 dispatch #4 循先例放行」，与 dispatch 记录及 SA8 备注一致 |

**一致性自检（R1）**：全量复核 R0 旧论证的连带引用——§4.2 要点 4（generation pin 声明）、§7.2 两行（persistence-contract、n≥1 探针）、§8.2（E14 新增）、§10（三处）、§5 主表「两文件零改动」表述（改为「既有断言零改动 + R1 一条锚点插入」）均已同步；「任一时刻」全仓检索仅存于「任一可观察时刻」表述中。
