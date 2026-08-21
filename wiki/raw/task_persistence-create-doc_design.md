# SA1 设计文档 — DocPersistence createDoc：排他创建、owner 语义与首快照提交（issue #64）

- Worktree: `/home/wangjian/nomicore-fix-issue-64`（分支 `fix/issue-64-on-adr-server-design`，base `adr/server-design`）
- 任务类型: 功能开发（Phase 2 架构设计）
- 修订: R3（2026-08-21）——SA2 R2 节窄幅 reject：R2-1 门禁（claim 结算机制唯一化 + U8 不变式）
  + R2-2（可达性归因补全）/ R2-3（TS 草图自洽）全部处置，回应见 §17 R3 节；R1 六点已经 SA2 R2 节
  核验为全部封死；SA8 设计后复审 verdict=clear（备注 2 已随 R2 #2② 落实）。前一版：R2（SA2 R1 六攻击点全处置）
- 验收基准: SA6 红灯套件 `describeDocCreateContract`（`packages/persistence/src/testing.ts`）+ 既有 25 条绿灯（零回归红线）
- ADR 基准: `docs/adr/0006-server-persistence-docstore.md`（含下述 C1/C2 已放行演进）+ ADR-0001/0002/0003（边界条款，no-conflict）

---

## §0. ADR-0006 演进声明（C1/C2）——本设计的约束基准

> 本节是 SA8 前置门禁（`task_persistence-create-doc_conflict_report.md`）与总控 dispatch 的强制要求：
> 「SA1 设计须显式引用 ADR-0006 演进（conflict_report §结论2），设计后 SA8 复审二次核对。」

本任务对 ADR-0006 含**两条已被 Jim 裁决放行的有意演进**（dispatch 记录：「均为 issue #64 本身的
有意演进诉求，daemon 恢复指令即放行裁决；不停机」）。本设计**不以 ADR-0006 旧接口文本为现行契约**，
而以如下演进后条款为基准；§12 给出 SA3 需逐字落地到 ADR-0006 的修订节草案。

### C1（high）——独立 `createDoc` 取代「创建 = 首个 saveDoc」

- **旧条款（被演进取代，不再作为现行契约引用）**：「创建 = 首个 saveDoc：loadDoc 不存在返回
  null，调用方自建 Y.Doc 写入初始内容后以有效 handle 首次 saveDoc 即完成创建（无独立 createDoc）」。
- **演进后条款（本设计实现）**：`DocPersistence` 新增
  `createDoc(owner: User, docId: string, doc: Y.Doc): Promise<DocHandle>`，对 `(owner.userId, docId)`
  排他创建：cache/store 已存在或并发创建 → 稳定错误码 `DOC_DUPLICATE`（专用类型 `DocDuplicateError`），
  **在 duplicate 判定路径上（cache 命中 / store 存在性读见快照 / 并发 claim）绝不覆盖已提交内容**
  ——三条判定路径都在进入写路径之前拒绝（R2 限定式表述；supersede 路径的已知覆盖窗口单独成文，
  见 §4.3）；创建成功前初始完整 snapshot 已同步提交（FilePersistence 以 temp→rename 完成点
  为准，不新增 fsync）；成功签发 lease 且 `handle.doc === doc`（持久层接管 doc 生命周期）；失败不返回
  handle、不缓存、不销毁传入 doc。create/create 与 create/load 共享 per-key coordination；并发 create
  恰好一个成功；**create 对同 key in-flight load 的竞态采取「create 胜出（supersede）」线性化**——
  create 取得创建权后，在其同步收尾块内采纳被取代的 load：pending load 不得错误返回 null，而是共享
  created live entry（§4.3；该窗口内 create 可覆盖既有提交，loud 告警为事后检测而非防护——同 §4.3）。
- **保留不变**：`loadDoc` 对不存在 key 仍返回 null（用例 7）；`saveDoc` 仍仅登记 dirty、异步调度
  （用例 2），首个 saveDoc 仍是合法写入路径——演进只是把「创建」的规范入口从隐式首个 saveDoc 改为
  显式排他 createDoc。

### C2（medium）——`DocHandle.user` → `DocHandle.owner` 契约改名

- **旧条款（被演进取代）**：接口代码块 `interface DocHandle { readonly user: User; ... }` 与
  `loadDoc(user: User, ...)`。
- **演进后条款（本设计实现）**：`readonly owner: User` + `loadDoc(owner, docId)` +
  `createDoc(owner, docId, doc)`。owner = 文档的**存储所有者**（分区键），不是当前访问者；访问者授权
  不进入 Persistence Interface（与 ADR-0006「user 仅作分区键：本层不鉴权」语义一致，ADR-0006 自身
  存储节已使用 owner 术语「owner 仍不写入 META」——属术语对齐式契约演进）。内部 Entry 参数/字段、
  契约测试、JSDoc 全链同步迁移（§9）。

### 与 ADR-0006 其余条款的关系

冲突门禁已逐条判定 13 项 no-conflict，本设计直接按
`task_persistence-create-doc_relevant_decisions.md` 摘录执行，特别锚定：
「仅校验 META.docId」「temp→rename 提交点、不新增 fsync」「saveDoc = 脏通知 + debounce 500ms /
max-dirty 5s 内部调度 + 内部 retry」「单飞 flush + generation 保序」「共享 doc 独立 handle + lease
身份校验」「插件工厂/实例模型、dispose 释放后台任务与缓存」「v1 单进程无文件锁」。

---

## §1. 输入完整性与任务范围

- 简报引用的 PRD `docs/prd/persistence-create-doc.md` 在本 worktree 与 base 分支均不存在（SA8 已
  备案）；以 TASK.md（= issue #64 body）+ SA6 红灯套件为唯一验收基准。
- **In scope**：`createDoc` 排他语义 + 首快照提交、per-key create/load 协调（共享 lifecycle core）、
  `DocHandle.user → owner` 全链迁移、`DocDuplicateError`、ADR-0006 修订节落地。
- **Out of scope**（简报明列）：accessor/ACL/sharing/auth、SCHEMA/META/ROOT 初始化、list/delete/
  owner transfer、persistence health Cordis events；另加：**FilePersistence 本体（P3 #58）不实现**，
  本票只交付它必须复用的 lifecycle core 与 IO seam（§5.4）。

---

## §2. 现状盘点（代码基线，commit 37561ac + SA6 红灯改动）

| 文件 | 现状 | 本任务动作 |
|---|---|---|
| `src/index.ts` | `DocHandle{user}`、`DocPersistence{loadDoc,saveDoc}`、schedule/timer contracts、Cordis 注册 | 改：owner 迁移 + `createDoc` 入接口 + `DocDuplicateError` 导出（§9/§10） |
| `src/memory.ts` | `MemoryPersistence` 单体：entries/loading 两个 Map、flush 调度（debounce/max-dirty/retry/generation）、eviction、epoch/dispose、`MemoryDocHandle` + WeakMap 身份 | **拆**：状态机整体移入 `src/lifecycle.ts`，memory.ts 瘦壳化（§5） |
| `src/testing.ts` | SA6 已完成：`describeDocCreateContract`（10 用例）、`DocCreateContractFixture`、`TestTimer`、`DocStoreHooks`、`withTimeout`；lease 套件已迁移 `createHandle(owner, docId)` | 不再改动（SA6 owned，已完成） |
| `test/memory-persistence.test.ts` | SA6 已完成：接入 createDoc 套件 + lease 套件 seeding 走 createDoc；19 条既有测试用 `createMemoryHandleForTest`（行为不变） | 不再改动（SA6 owned，已完成） |
| `test/persistence-contract.test.ts` | SA6 已完成 owner 迁移 + createDoc 模块契约测试；但 `stubPersistence()` 未实现 `createDoc` | SA3 机械补 stub（§16 caller 清单；接口加宽后 typecheck 必需） |
| `test/memory-testkit.ts` | 包装 `createMemoryHandleForTest(persistence, user, docId)` | 参数名 `user → owner`（机械改名） |

红灯独立复现（SA1 运行，2026-08-21）：
`node_modules/.bin/vitest run packages/persistence/test/memory-persistence.test.ts packages/persistence/test/persistence-contract.test.ts`
→ `Test Files 2 failed | Tests 14 failed | 25 passed`，与 SA6 记录逐条一致（13× `createDoc is not a
function` + 1× `expected 'undefined' to be 'function'`）。

外部消费面：`git grep -rn "nomicore/persistence" -- '*.ts' '*.json'` 排除包自身与 node_modules 后
**零命中**——接口演进波及面完全封闭在本包内（唯一 implementor：`MemoryPersistence` + 测试 stub）。

---

## §3. 需求推演：从红灯契约反推机制

### 3.1 关键死锁分析——用例 5 强制「supersede」语义（本设计最核心的推演）

用例 5（`does not return null for a load that is still pending when create wins the key`）的 store
门控是**全局的**：`store.read` 被替换为「只在对侧手动 `releaseRead` 后才 settle」的 Promise，且
`releaseRead` 变量会被**每次 read 调用重新赋值**。时序：

```
loadDoc(K)            → store.read 调用 #1 → P1，releaseRead = R1
await readStarted     （测试确认 read #1 已进入）
store.write = 空实现
await createDoc(K)    ← 【必须在此完成】
releaseRead(undefined)
await loading         ← load 必须拿到 created entry（loaded.doc === created.doc）
```

推演结论（穷举 create 的可选策略）：

| create 面对同 key in-flight load 的策略 | 结果 |
|---|---|
| 等待 in-flight read 的结果再判定 duplicate | **死锁**：read #1 只在 create 完成后才被 release，create 永不 resolve，测试挂死 |
| abort 旧 read 后自己再发一次 read | **死锁**：新 read 调用 #2 重新赋值 `releaseRead = R2`，而测试只调一次 `releaseRead()`（且在 create 之后）→ create 等待的 P2 永不 settle |
| **supersede：不等任何 read，凭内存协调状态直接取得创建权**（本设计） | create 立即 claim → 直写 → live；pending load 由 create 的结局驱动（胜出 → 采纳 entry）✓ |

因此**契约正文强制**：create 遇到「由 load 发起的 in-flight 读」时必须 supersede——不等待、不重发
read、不删除该 read（load waiter 还要靠它回退）。同时用例 4（`enteredWrites === 1`）强制：create
遇到「in-flight create claim」时必须在进入写路径**之前**以 duplicate 拒绝。两条合起来得到 §4 的
per-key 单元状态机。

### 3.2 其余用例反推的机制清单

| 用例 | 强制的机制 |
|---|---|
| 1 | create resolve 前初始快照已提交（fresh 实例直读可见）；成功后 `timer.pending() === 0` → **初始提交不走 flush 机器、成功后 entry 为 clean（dirty=saved=0）、不安排任何 timer** |
| 2 | saveDoc 语义原样保留：登记 dirty + debounce 500ms（499 不写 / 500 写 1 次） |
| 3 | duplicate 双路径：cache 命中（live entry）+ store 命中（fresh 实例 cache miss 时**必须查 store**）→ 契约固定点 4 |
| 4 | 并发 create 恰一成功，loser 在写路径前被拒（claim 检查先于任何 io.write） |
| 5 | §3.1 supersede + load 采纳 created entry（采纳时机 = create 胜出收尾块，§4.3 规则 1，R2 统一） |
| 6 | 初始写失败：**原始 I/O 错误原样上抛**（message 含 `io down`）、不缓存、不销毁 doc、无 timer（**不进 retry 循环**）、claim 回滚后同 key 可重试且 `handle.doc === doc` |
| 7 | 排他键含 `owner.userId`（`toKey` 现状保留）；未知 key load → null |
| 8 | per-key 协调，无全局锁（不同 key 的 create 互不串行） |
| 9 | 仅校验 `META.docId === docId`（缺失/不匹配 → message 含 `META.docId`）；不校验 SCHEMA/ROOT/createdAt |
| 10 | dispose 竞态：in-flight create 以**真实 rejection** 收束；`timer.pending()===0`；此后 loadDoc/createDoc 拒绝且 message 含 `disposed` |

---

## §4. 核心：per-key 协调单元（Cell）状态机

### 4.1 状态与字段

替换现状的 `entries` + `loading` 两个 Map，统一为 `cells: Map<string, Cell>`（key =
`` `${owner.userId}\u0000${docId}` ``，`toKey` 现状保留）：

```ts
// lifecycle.ts 内部（示意）
interface ReadTicket {
  startedBy: 'load' | 'create'
  rawPromise: Promise<Uint8Array | undefined>   // 恰一次 io.read；create 的存在性检查与 load 还原共用
  // R2：completion 由 deferred 驱动——create 胜出可在 driver 终点之外「提前采纳」结算
  completion: Promise<LiveEntry | null>         // 所有 load waiter await 它；恰 settle 一次（见 I2）
  settleOnce(value: LiveEntry | null): void     // deferred 结算句柄（内部恰一次互斥）
  rejectOnce(err: unknown): void
  supersededBy?: CreateClaim                    // supersede 时由 create 的同步获取块回填（R2 反向引用）
  adoptedByCreate?: boolean                     // create 胜出收尾块同步置位；driver 见此标志只做观测
  adoptedEntry?: LiveEntry                      // 采纳时记录，供 driver 返回值对称
}
interface CreateClaim {
  promise: Promise<void>                        // settle 即 create 定局（成功后 cell 已是 live）
  supersededRead?: ReadTicket                   // 仅 supersede 路径持有：失败时恢复原 reading 态
}
type Cell =
  | undefined                                    // 'empty'：无 entry、无 in-flight 操作
  | { state: 'reading'; read: ReadTicket }
  | { state: 'creating'; claim: CreateClaim }
  | { state: 'live'; entry: LiveEntry }          // LiveEntry 即现状 Entry（owner 语义，§9）
```

不变式：

- **I1**：一个 key 任一时刻至多一个 Cell；`live` 的 entry 至多一个 live Y.Doc 实例（同一 key 的所有
  成功 load/create 共享它——ADR「共享 doc，独立 handle」）。
- **I2**：一张 ReadTicket 恰好发起一次 `io.read`、恰一个 driver、`completion` 恰好 settle 一次——
  结算方为 **driver 终点** 或 **create 胜出采纳** 二者之一，由 deferred 的恰一次互斥保证（R2）。
- **I3**：一个 create claim 存续期间，任何后到 create 在**进入 io.write 之前**被拒（用例 4）。
- **I4**：entry 注册（`cells.set(live)`）只能由「当前拥有 cell 的操作」执行：reading driver 在自己
  仍拥有 read ticket 时、create 在 commit 成功后；被接手的操作一律委托 `resolveLoad`，绝不注册第二个
  entry（I1）。
- **I5**（R2）：create 胜出 ⟺ 其 supersededRead 已被采纳（`adoptedByCreate === true`）——二者在
  create 的同一同步收尾块内完成，先于 claim settle；因此被取代读的结局**永不参与路由**（§4.3
  规则 3），也不存在「create 胜出但 cell 已因驱逐回到 empty」的歧义态（§4.3 规则 4 的复验兜底）。
- **I6**（R2）：handle 签发（loadDoc 慢路径/createDoc/seedForTest）与「cell 仍持有目标 entry」的
  所有权复验处于**同一同步块**（无 await 间隙）；`issueHandle` 同步加入 `entry.handles`，自此 entry
  不可被驱逐（§4.3 规则 4，根除 ghost handle）。

### 4.2 转移表

| 当前态 | 事件 | 动作 → 新态 |
|---|---|---|
| empty | loadDoc | 发起 ReadTicket(`load`)，启动 driver → **reading** |
| empty | createDoc | 发起 ReadTicket(`create`) 存在性检查，启动 driver → **reading**；read settle 后：快照存在 → duplicate（driver 负责还原成 live）；undefined 且 cell 仍空 → claim → **creating** |
| reading(`load` 发起) | createDoc 到达 | **SUPERSEDE**：不等待/不重发 read，保留 ticket 引用 → **creating**（claim.supersededRead = ticket） |
| reading(`create` 发起) | createDoc 到达 | **并入同一份存在性证据**：`await rawPromise`（不重发 read）→ settle 后重评估 cell（creating → duplicate；live → duplicate；empty → 自己 claim） |
| reading | read settle（未被 supersede） | driver 经典路由：I/O 错误 → 清 cell 后上抛；undefined → 清 cell、completion=null；快照 → 还原+校验 META.docId（**校验失败同样先清 cell 再上抛**——R2 #3，不留 reading 残留）→ **live** |
| creating | io.write 成功且 epoch 当前 | 注册 entry（clean）→ **live**；**同步采纳 superseded read**（`settleOnce(entry)` + `adoptedByCreate`，先于 claim settle——R2 §4.3 规则 1）→ 签发 handle |
| creating | io.write 失败 / epoch 过期 | claim 回滚：supersededRead 未 settle → 恢复 **reading**（waiter 继续等读证据回退）；否则 → **empty**；原始错误上抛给 create 调用方 |
| live | loadDoc | 同步快路径直接签发独立 handle（共享 entry.doc，与现行 cache 命中一致）；慢路径经 resolveLoad + 签发侧复验（§7 R2） |
| live | createDoc | **duplicate**（cache 路径，不触 store、不写） |
| live | release 归零 + clean + 非 flushing | eviction：清 cell → **empty**，destroy doc（现状 maybeEvict 保留）。已采纳但尚未签发 handle 的 waiter 由 §4.3 规则 4 复验保护：复验失败 → 重走 resolveLoad → 重读 store 必得 create 提交内容（U7），绝不 null、绝不复活旧内容 |
| 任意 | dispose | epoch++、abort、清全部 cell/timer、destroy live docs；in-flight 操作由各自 continuation 以 disposed 错误收束（§8） |

### 4.3 supersede 的线性化语义与诚实边界（R2 重写：采纳机制 × eviction 交互已完整定义）

**规则**：create 遇到「由 load 发起、尚未 settle 的同 key 读」时，create 取得创建权（supersede），
不等待该读；pending load 的结局绑定 create 的结局：

1. **create 胜出 → 同步采纳**：create 的同步收尾块（`cells.set(live)` 之后、claim settle 之前）
   以 `settleOnce(entry)` 采纳被取代读——load waiter **立即**获得 created live entry
   （`loaded.doc === created.doc`，同一实例），**不等 read settle**（R2 与 §7 伪代码逐字一致：
   采纳发生在 create 收尾块，read settle 后的 driver 仅做观测）。hung read 下 waiter 同样照常返回。
2. **create 失败 → 回退读证据**：load waiter 回退到自己的读证据：undefined → null；快照 → 正常
   还原；I/O 错误 → 上抛。失败 create 未触提交点（IO seam 承诺 store 不变，§5.2），证据仍有效。
3. **晚到的读结局永不参与路由**（I5）：create 定局后，被取代读的 settle 只用于观测——非空快照 →
   lost-update **loud 告警**（检测，非防护）；READ_ERR → debug 级日志（#5 决策：观测不阻断，采纳
   的操作本身已成功）；undefined → 无事。R1 缺陷「§4.3 称丢弃、§7 却恢复」的规格矛盾随采纳机制
   消失：**fallback（证据路由）从构造上仅在 create 失败分支可达**，create 胜出分支无任何证据路由。
4. **签发侧所有权复验**（R2，根除 ghost handle）：任何经 await 取得的 entry 在签发 handle 前必须
   与「cell 仍持有该 entry」的复验处于同一同步块（I6）；复验失败（await 间隙内被驱逐/替换）→ 重走
   `resolveLoad`——create 已提交 ⇒ store 必含其快照 ⇒ 重读必得 create 提交内容（U7），绝不 null、
   绝不把被驱逐实例的已销毁 doc 签发给调用方。

**supersede × eviction 交互（R2 补全，SA2 #1 的三个派生缺陷逐条封死）**：

- **假 null（#1a）**：create 胜出 → 调用方 release create handle → clean entry 立即 evict（cell 回
  empty）→ 被取代读 settle（证据为先于 create 写入的 undefined）→ driver 见 `adoptedByCreate` →
  **不路由证据**；waiter 早已经采纳拿到 entry，若签发复验发现 entry 已被驱逐 → 重走 resolveLoad →
  新读得 create 提交快照 → 非 null ✓。
- **静默旧内容复活（#1b）**：同链路但证据是被覆盖前的旧快照 → 采纳机制使旧快照**永不被还原**
  （无证据路由）；晚到旧快照触发 `observeLateReadOutcome` 的 lost-update **console.error** ✓
  （R1 只有 live 分支告警的缺口已补全覆盖）；cache/store 撕裂不存在，后续 flush 不会以旧覆新 ✓。
- **ghost handle（#1c）**：采纳返回与 waiter 签发之间的 await 间隙内 create handle 被 release →
  evict → `doc.destroy()` → 签发复验（I6）失败 → 重走 resolveLoad → 新 entry（新 Y.Doc 实例，
  内容 = create 提交）→ 签发的 handle 指向未销毁 doc ✓。

**为什么 load-发起 与 create-发起 的读区别对待**（§3.1 表的对称问题）：create-发起 的读已有义务方
在做存在性检查，并入等待是安全且有界的（生产中读延迟即 I/O 延迟，无门控死锁）；load-发起 的读没有
claim 方，且用例 5 证明等待它不可行。

**lost-update 窗口的诚实分析**：supersede 意味着 create 在「store 可能已有同 key 提交内容但读尚未
返回」的窗口内凭内存状态直接提交，**该窗口内 create 可覆盖既有提交**（「绝不覆盖」的效力范围 =
duplicate 判定路径，§0/§12 已限定）。窗口可达性：

- **单实例内**（v1 契约域，ADR「v1 限制：单进程」）：store 有内容 ⇔ 本实例曾 flush/create 提交且
  entry 已被驱逐。此后 load(K) 的读 in-flight 期间 create(K) 到达 → supersede → 覆盖。触发前提是
  **对同一 key 存在与 create 并发的 in-flight load**——它可能是调用方显式发起的 loadDoc
  （check-then-create 竞态），**也可能是持久层内部的复验重读**（R3，SA2 R2-2：§7 `loadSlowPath`
  复验循环使 core 自身成为 load 发起方——create#1 胜出→驱逐→waiter 复验重读 in-flight 期间，调用方
  的 create#2 即可 supersede 该内部重读，此时调用方并未显式并发 load+create）；按 createDoc 的排他
  契约，正确调用方模式是「先 createDoc，duplicate 再 loadDoc，且不与任何未决 load（含内部）并发」。
- **跨实例共享同一 store**（测试构造 / 多进程）：v1 明确不支持（无文件锁），不做保证。

处置（遵循「拒绝虚假降级」立法——这是异常路径而非降级场景，**不静默**）：`observeLateReadOutcome`
在被取代读晚到返回**非空快照**时记录 loud integrity 告警（覆盖采纳路径全部晚到快照，R2 全分支生效）：

```ts
console.error('[persistence] lost-update anomaly: createDoc superseded a pending load whose store read returned a pre-existing snapshot', { key })
```

同时被采纳的 created entry 保持为权威结果（create 已提交，是确定性 tie-break；不改结果、不进入
degraded——写入本身成功，degraded 是 flush 失败语义，不得滥用）。**告警是事后检测而非防护**：它能
让运维看到 lost-update 发生，不能阻止该窗口内的覆盖；阻止手段是调用方模式约束（上文）。
设计文档明示该窗口与正确调用方模式，供上层 namespace lifecycle 约束。

### 4.4 逐用例路径（设计自证，SA7 动态验证对照表）

| # | 用例（简） | 设计路径 |
|---|---|---|
| 1 | owner lease + 首快照先提交 | empty →(create) 存在性读 undefined → claim → `Y.encodeStateAsUpdate(doc)` 直写 → live(clean) → handle；无 timer；fresh 实例 read → 快照 → 还原可见 |
| 2 | saveDoc 仅登记 dirty | create 后 entry clean；saveDoc → dirtyGen=1 → debounce 500ms → flush 写 1 次（§11 不变量） |
| 3 | duplicate 双路径不覆盖 | cache：live → 立即拒；store：fresh 实例 empty → 存在性读返回快照 → 拒（不写）；内容保持 winner |
| 4 | 并发 create 恰一成功 | 双方并入同一存在性读（`startedBy:'create'`）；read=undefined 后 FIFO 微任务序先到者 claim → **creating**；后到者见 creating → 在 io.write 前拒 → `enteredWrites === 1` |
| 5 | pending load 不返回 null | load 发起 reading → create supersede（不发/不等 read）→ 写成功 → 收尾块**同步采纳**（`settleOnce(entry)`，§4.3 规则 1）→ waiter 立即拿 entry；`releaseRead(undefined)` 后 driver 仅观测（无事）；签发复验通过 → `loaded.doc === created.doc` |
| 6 | 初始写失败零残留 | claim → io.write 抛 `io down` → 回滚 cell → empty、无 entry、无 timer（不进 scheduleRetry）、doc 未销毁；同 key 再 create：empty → 读 undefined → 成功，`doc` 同一实例 |
| 7 | A/B 隔离 + 未知 null | `toKey(userId, docId)` 分区；carol 的读 undefined → completion=null |
| 8 | 不同 key 不串行 | cells 按 key 独立；key1 的 io.write in-flight 不阻塞 key2 的 create（无全局锁/队列） |
| 9 | 仅校验 META.docId | create 前置同步校验（见 §6），message 含 `META.docId`；不校验 ROOT 类型/SCHEMA/createdAt |
| 10 | dispose 竞态真实 rejection | io.write 因 abort settle → epoch 过期 → 回滚 + `throw Error('createDoc rejected: persistence is disposed')`；dispose `allSettled(inFlight)` 等 create 收束；无 timer；后续调用 assertReadable 拒 `/disposed/` |

R2 补充用例（SA2 红线测试 1–4 的设计路径对照；位于共享套件覆盖之外的交互，SA6/SA7 可按此落地）：

| # | 场景（SA2 红线测试） | 设计路径 | 断言落点 |
|---|---|---|---|
| 5a | 假 null 防护（测试 1）：门控读 → create 胜出 → **立即 release create handle**（clean entry evict）→ releaseRead(undefined) | 收尾块已采纳（waiter 早已拿 entry）；签发复验发现 entry 被驱逐 → 重走 resolveLoad → 新读得 create 提交快照 → 还原 | loaded 非 null 且内容 = create 提交内容（U7：重读若得 null → loud integrity throw） |
| 5b | 静默复活防护（测试 2）：OLD 已提交 → 门控读（将返 OLD）→ create 胜出提交 NEW → release handle → releaseRead(OLD) | 采纳机制使 OLD 永不被还原（无证据路由，§4.3 规则 3）；`observeLateReadOutcome`：非空快照 → lost-update console.error | load 得到的 doc 内容 = **NEW**；console.error spy 捕获告警 |
| 5c | ghost handle 防护（测试 3）：create 胜出采纳后、releaseRead 前 release create handle | 签发复验（I6）失败 → 重走 resolveLoad → 新 entry（新 Y.Doc，内容 = create 提交）→ 签发 | `loaded.doc.isDestroyed === false` 且 `saveDoc(loaded)` 可用 |
| 5d | 采纳时机的规格选择（测试 4）：门控读 + create 胜出 + **永不 release 门控** | 采纳在 create 收尾块同步完成（§4.3 规则 1），completion 早已 settle | `await withTimeout(loading, 2000)` 正常返回 entry（读悬挂不阻塞 waiter）——早期采纳规格的判定性测试 |

既有 25 条绿灯的保持：flush/debounce/max-dirty/generation/retry/eviction/degraded/Cordis 卸载等逻辑
**逐字搬移**进 core（§5.3 迁移纪律），行为面不变；`restoreEntry` 的 META.docId 校验消息原文保留
（`/META\.docId.*doc1/` 依赖）。

---

## §5. 共享 lifecycle core（`src/lifecycle.ts` 新建）

### 5.1 模块边界与 IO seam

```ts
// packages/persistence/src/lifecycle.ts —— 包内共享，不进公共导出（index.ts 不 re-export）
export interface PersistenceIO {
  read(key: string, signal: AbortSignal): Promise<Uint8Array | undefined>
  write(key: string, snapshot: Uint8Array, signal: AbortSignal): Promise<void>
}
export type PersistenceStatus = 'ready' | 'persistence-degraded' | 'disposed'

export class PersistenceLifecycle {
  constructor(io: PersistenceIO, options?: { schedule?: Partial<PersistenceSchedule>; timer?: PersistenceTimer })
  loadDoc(owner: User, docId: string): Promise<DocHandle | null>
  createDoc(owner: User, docId: string, doc: Y.Doc): Promise<DocHandle>
  saveDoc(handle: DocHandle): Promise<void>          // 含 lease 身份校验（handle 类移入 core）
  seedForTest(owner: User, docId: string): DocHandle // 同步种子（TEST_FACTORY 语义，见 §5.3）
  dispose(): Promise<void>
  getStatus(): PersistenceStatus
}
```

core 拥有（自 memory.ts 整体搬移）：cells/entries 协调（§4）、flush 调度（debounce/max-dirty/
generation 单飞/retry 退避）、eviction、epoch + AbortController + inFlight 追踪、status、
`PersistenceHandle` 内部类 + `HANDLE_OWNER`/`RELEASE` WeakMap（lease 不可伪造身份）。

**为什么把 flush 机器一并搬入 core**（而非只搬 create/load 协调）：`maybeEvict` 同时被 release 与
flush 终态调用，eviction 又直接改写 cells——协调态与 flush 态共享同一份 entry 结构，切开必然互相
穿透私有状态；#58 FilePersistence 按 ADR 必须具备完全相同的 flush/eviction 语义，若留在 memory.ts，
#58 只能复制状态机，正面违反简报「不得复制并发状态机」。

### 5.2 IO seam 契约（对 #58 的接口承诺）

- `io.write` 必须**尊重 signal**（dispose 可等待收束——现状注释契约原文保留）；`io.read` 同。
- **提交段原子性（R2 #4）**：`io.write` 实现在 `await` 返回后若 `signal.aborted` 已置位，**不得执行
  提交段**——memory 实现指私有 `snapshots.set`，#58 的 temp→rename 实现指 rename 步。这是现行
  `writeSnapshot` 内 `isCurrent(epoch)` 守卫（memory.ts:255）被拆入 IO 闭包后的 **seam 级等价替代**：
  保证 dispose 已 `clear()` 的私有存储不被复活、#58 不产生「createDoc 已以 disposed 拒绝、文件却已
  rename」的幽灵提交。同理，失败的 `io.write`（抛错）必须保持 store 内容不变（未触提交段）——这是
  §4.3 规则 2「失败 create 的读证据仍有效」的前提。
- `status = 'ready'`（degraded → ready 恢复的唯一通道）**移入 core flush 成功路径、置于
  `isCurrent(epoch)` 守卫之后**（R2 #4 明示落点）：与现行「writeSnapshot 守卫后置」语义等价——
  绿灯 `memory-persistence.test.ts:307-309`（retry 成功恢复 ready）保持绿、`:471/:492`（dispose
  during flush 保持 disposed）保持绿。create 初始提交不触碰 status（`assertWritable` 已排除
  degraded，无观测差异）。
- FilePersistence（#58）以 `read = fs 读 {userId}/{docId}.snapshot`、`write = 写 .tmp → rename`
  实现同一 seam，即自动获得本票全部 createDoc 语义与共享契约套件（契约固定点 5）。
- 初始提交**直写** `io.write`（fail-fast、无 retry）；常规 flush 也走 `io.write`——语义差异在
  调度层（flush 有 debounce/retry，create 没有），不在 IO 层。

### 5.3 MemoryPersistence 瘦壳化与迁移纪律

```ts
// memory.ts 重构后（示意）
export class MemoryPersistence implements DocPersistence {
  private readonly core: PersistenceLifecycle
  constructor(private readonly options: MemoryPersistenceOptions = {}) {
    const snapshots = new Map<string, StoredSnapshot>()
    const core = new PersistenceLifecycle({
      // 与现状 writeSnapshot/restoreEntry 的读写字节序严格一致（微任务预算，§11）
      // R3（SA2 R2-3）：async 化以匹配 PersistenceIO.read 的 Promise 返回类型（无 hook 时裸值
      // 也可返回）。read 侧的额外一跳不违反 §11 同深约束——该约束的适用范围 = write/flush 链。
      read: async (key, signal) => options.readSnapshot?.(key, signal) ?? snapshots.get(key)?.snapshot,
      write: async (key, snapshot, signal) => {
        if (options.writeSnapshot) await options.writeSnapshot(key, snapshot, signal)
        if (signal.aborted) return        // R2 #4：替代被拆掉的 isCurrent(epoch) 守卫——abort 后不得
                                          // 复活 dispose 已 clear() 的私有存储（提交段原子性，§5.2）
        snapshots.set(key, { snapshot: snapshot.slice() })
      },
    }, { schedule: options.schedule, timer: options.timer })   // 显式投影，不透传 IO 字段
    this.core = core
  }
  loadDoc(owner, docId) { return this.core.loadDoc(owner, docId) }
  createDoc(owner, docId, doc) { return this.core.createDoc(owner, docId, doc) }
  saveDoc(handle) { return this.core.saveDoc(handle) }   // 身份校验随 handle 类一起在 core
  dispose() { return this.core.dispose() }
  getStatus(): MemoryPersistenceStatus { return this.core.getStatus() }
  apply(ctx: Context) { /* 原样 */ }
  [TEST_FACTORY](owner, docId) { return this.core.seedForTest(owner, docId) }
}
export type MemoryPersistenceStatus = PersistenceStatus   // 公共别名保持导出形状
```

迁移纪律（SA3 执行约束）：

1. **逐字搬移**：`scheduleFlush/onDebounce/onMaxDirty/startFlush/flush/writeSnapshot(→io+状态)/
   scheduleRetry/maybeEvict/cancel*/clearTimers/track/assertOwnedHandle/assertReadable/assertWritable/
   isCurrent/dispose` 的控制流与 await 层数不得改动（§11 微任务预算）。
2. `MemoryDocHandle` 类删除，改用 core 的 `PersistenceHandle`（构造参数 owner 语义）；`HANDLE_OWNER/
   RELEASE` WeakMap 随迁。`'foreign or released DocHandle'`、`'persistence-degraded: writes are
   rejected until retry succeeds'` 错误消息原文保留（既有测试正则锚定）；disposed 类消息统一为含
   `disposed` 字样（现行 `'MemoryPersistence is disposed'` 可保留为 core 消息 `'persistence is
   disposed'`——既有测试仅断言 `/disposed/`，已核对）。
3. `seedForTest` 语义 = 现状 `[TEST_FACTORY]`：cell 为 live → 复用 entry 签发 handle；cell 为空 →
   new Y.Doc + live 注册（**不写 store**——现状行为）；cell 为 reading/creating → **loud 抛错**
   （`'test seed requires an idle key cell'`）：测试工厂撞上协调态属测试误用，不静默覆盖（拒绝虚假
   降级立法）。既有 19 条测试均在空实例上 seed，不受影响。
4. `entry.user → entry.owner`、`restoreEntry/createEntry/issueHandle` 参数与字段同步改名（§9）。
5. **entries → cells 显式改写点清单（R2 #6）**——「逐字搬移」在数据结构替换处的全部适配点，
   SA3 不得自行推断：
   - `saveDoc` 的 `entries.get(owned.entryKey)` → `cells.get(key)` 且 `state === 'live'` 才取
     entry；cell 为 reading/creating/empty（含 entry 已被驱逐）一律 `'foreign or released
     DocHandle'`——与现行「entry 不存在」同语义，handle 校验行为不因协调态存在而放宽；
   - `maybeEvict` 的 `entries.delete(entry.key)` → 仅当 `cells.get(key)` 为**持有该 entry** 的
     live 才 delete（不得误删 reading/creating 态的 cell）；
   - `releaseHandle`、flush 终态（`maybeEvict` 调用点）、`dispose` 遍历销毁的 entry 寻址 → 一律
     改为 live-cell 查询/遍历（`cell.state === 'live'` 提取 entry）；
   - `assertOwnedHandle` **不依赖 cell**（WeakMap 身份 + `isReleased`），维持现状；
   - `writeSnapshot` 拆解落点：hook 调用留在 IO 闭包；`isCurrent(epoch)` 守卫由 seam 的
     `signal.aborted` 承诺替代（§5.2，memory 侧即闭包内的 aborted 早退）；`snapshots.set` 落 IO
     闭包（aborted 守卫之后）；`status = 'ready'` 落 core flush 成功路径（`isCurrent` 守卫之后）。

### 5.4 与 P3 #58 的依赖顺序（Coordination 节落地）

- 本票先落 `lifecycle.ts` + MemoryPersistence 接入 + 共享套件全绿；**#58 rebase 后**以 FS IO 实例化
  同一 core，接入同一 `describeDocCreateContract`（fixture 提供真实 rootDir 的 makeFresh/dispose），
  temp→rename 提交点与遗留 `.tmp` 清理由 #58 专测锚定——**不得 fork 状态机、不得复制 flush 机器**。
- 本票不创建 `src/file.ts`（DENY LIST 明示），防止偷渡 #58 范围。
- `testing.ts` 的 `DocPersistenceWithCreate` 在接口加宽后结构上冗余（`DocPersistence` 已含
  createDoc），保持不动（SA6 领地），是否收敛由 #58 与 SA6 另行决定。

---

## §6. createDoc 算法（伪代码，SA3 按此实现）

```ts
createDoc(owner: User, docId: string, doc: Y.Doc): Promise<DocHandle> {
  assertWritable()                       // disposed / persistence-degraded → 响亮拒绝（message 含对应字样）
  validateCreateDoc(doc, docId)          // 同步、任何 I/O 之前：doc.getMap('META').get('docId') === docId
                                         // 不匹配/缺失 → throw Error(`doc META.docId ${x} does not match requested docId ${docId}`)
  const key = toKey(owner.userId, docId)
  const epoch = this.epoch               // 捕获纪元
  let supersededRead: ReadTicket | undefined

  // —— 单元获取（claim acquisition）——
  acquire: while (true) {
    const cell = this.cells.get(key)
    if (cell?.state === 'live')     throw duplicate(key, owner)   // 用例 3 cache 路径
    if (cell?.state === 'creating') throw duplicate(key, owner)   // 用例 4：写路径之前
    if (cell?.state === 'reading') {
      if (cell.read.startedBy === 'create') {
        const raw = await cell.read.rawPromise          // 并入存在性证据，绝不重发 io.read
        this.assertCurrentEpoch(epoch)                  // dispose 竞态 → Error(…disposed…)
        if (raw !== undefined) throw duplicate(key, owner)
        continue acquire                                 // 重评估（此刻通常 empty / 被对方 claim）
      }
      supersededRead = cell.read                         // §3.1：supersede，不等、不重发、不删 read
      break acquire                                      // → performCreate
    }
    // empty：自己发起存在性检查（契约固定点 4：cache miss 必查 store）
    const read = this.startReadTicket(key, 'create', epoch)   // rawPromise = io.read(key, signal)（tracked）
    const raw = await read.rawPromise
    this.assertCurrentEpoch(epoch)
    if (raw !== undefined) throw duplicate(key, owner)   // driver 会把快照还原为 live（并入的 load 受益）
    const now = this.cells.get(key)
    if (now === undefined) break acquire                 // driver 已路由 null 并清 cell → 自己 claim
    continue acquire                                     // cell 被接手（creating/live/新 reading）→ 重评估
  }

  // —— 执行创建（cell 原子置为 creating 后才进入写路径）——
  const claim: CreateClaim = { promise: undefined! }
  if (supersededRead) supersededRead.supersededBy = claim   // R2：反向引用同步回填，driver 据此等待定局
  this.cells.set(key, { state: 'creating', claim, supersededRead })
  const op = this.track((async () => {
    try {
      const snapshot = Y.encodeStateAsUpdate(doc)        // 创建时刻完整状态（含 META/ROOT/SCHEMA，原样）
      await this.io.write(key, snapshot, this.abortSignal)  // 直写：fail-fast，无 debounce/retry（用例 2/6）
      this.assertCurrentEpoch(epoch)                     // 用例 10：dispose 竞态 → 真实 rejection
      const entry = this.createEntry(owner, docId, key, doc)  // clean：dirty=0 saved=0，无 timer
      this.cells.set(key, { state: 'live', entry })
      // R2 §4.3 规则 1：create 胜出的同步收尾块内「提前采纳」被取代读（不等 read settle）。
      // 与 cells.set 同一同步块；deferred 恰一次互斥（I2）；此后 op 才 settle → claim.promise
      // 经文末派生式结算（U8：claim 无独立 deferred，收尾块不直接结算 claim）。
      if (supersededRead && !supersededRead.adoptedByCreate) {
        supersededRead.adoptedByCreate = true
        supersededRead.adoptedEntry = entry
        supersededRead.settleOnce(entry)                 // load waiter 立即获得 created live entry
      }
      return this.issueHandle(entry)                     // handle.owner === owner && handle.doc === doc
                                                          // 签发与 cells.set 同块（I6，无 ghost handle 窗口）
    } catch (err) {
      const cur = this.cells.get(key)
      if (cur?.state === 'creating' && cur.claim === claim) {
        if (supersededRead && !isSettled(supersededRead.rawPromise)) {
          this.cells.set(key, { state: 'reading', read: supersededRead })  // waiter 回退到读证据（§4.3 规则 2）
        } else {
          this.cells.delete(key)                         // 用例 6：无 stale claim，可重试
        }
      }
      throw err                                          // 原始 I/O 错误原样上抛（message 含 'io down'）
    }
  })())
  // R3（U8）：claim 结算的唯一机制——派生式双 handler，op 成败两态均 settle（失败路径不得遗漏：
  // catch 块不做任何 claim 结算，正因如此两态 settle 由本行保证）。CreateClaim 无 deferred 字段。
  claim.promise = op.then(() => undefined, () => undefined)
  return op
}

duplicate(key, owner) => new DocDuplicateError(`createDoc duplicate: owner ${owner.userId} already has this docId (${key})`)
```

实现注意（TS strict：`noUncheckedIndexedAccess`/`exactOptionalPropertyTypes`）：
`isSettled` 可用附加布尔标志实现（不依赖 promise 状态窥探）；`claim.promise` 的赋值时序保证
「cells.set(creating) 先于任何 await」使并发 create 同步可见。**claim 结算机制唯一化（R3，SA2 R2-1）**：
`claim.promise` 只经上文 `op.then(…, …)` 派生接线结算——try/catch 块内没有任何显式 claim 结算调用
（收尾块只做采纳 + 签发；catch 只做回滚 + 上抛）；因此 op 无论成败 claim.promise 必 settle（U8），
§7 `resolveLoad` creating 分支与 driver 分支 B 两处 `await claim.promise` 的活性由此保证。

## §7. loadDoc 算法与 read driver（伪代码，R2 重写）

```ts
async loadDoc(owner, docId): Promise<DocHandle | null> {   // R3（SA2 R2-3）：保持 async——同步快路径
  assertReadable()                                          // 返回裸 handle 由 async 语义自动包裹
  const key = toKey(owner.userId, docId)
  // 同步快路径：现行 cache 命中语义，无 await 间隙（与 R1 前行为逐字一致）
  const cached = this.cells.get(key)
  if (cached?.state === 'live') return this.issueHandle(cached.entry)
  return this.loadSlowPath(key)
}

private async loadSlowPath(key): Promise<DocHandle | null> {
  let sawEntry = false
  while (true) {
    const entry = await this.resolveLoad(key, this.epoch)
    assertReadable()                          // await 后复检（现行行为，dispose 测试依赖）
    if (entry === null) {
      if (sawEntry) {                         // R2 U7 loud 守卫：前一轮已解析出 entry（restore 自 store
                                              // 快照或 create 采纳 ⇒ store 必含其提交），本轮重读为空
                                              // = 完整性破坏。单进程内不可达；不做静默 null（拒绝虚假降级）
        console.error('[persistence] integrity violation: resolved entry had committed store content, but a fresh read found none', { key })
        throw new Error(`persistence integrity: fresh store read found no snapshot after a resolved entry was evicted (${key})`)
      }
      return null                             // 首轮 null = 合法 not-found（用例 7）
    }
    sawEntry = true
    // —— R2 #1c 签发侧所有权复验（I6）：与签发同一同步块，消除 await 间隙的 ghost handle ——
    const cell = this.cells.get(key)
    if (cell?.state === 'live' && cell.entry === entry) {
      return this.issueHandle(entry)          // issueHandle 同步加入 entry.handles → 本刻起不可驱逐
    }
    // entry 在 await 间隙被驱逐/替换（如 create handle 被 release 触发 evict）→ 重走 resolveLoad：
    // store 必含该 entry 的提交快照 ⇒ 重读非 null（下轮若 null 即触发上方 U7 守卫）；循环有界
  }
}

private async resolveLoad(key, epoch): Promise<LiveEntry | null> {
  while (true) {
    const cell = this.cells.get(key)
    if (cell?.state === 'live')     return cell.entry
    if (cell?.state === 'creating') { await cell.claim.promise; continue }  // settle 后重评：live→entry；失败→empty/reading
    if (cell?.state === 'reading')  return await cell.read.completion      // 唯一 driver（I2），绝不并发还原
    this.startReadTicket(key, 'load', epoch); continue                     // empty → 发起读 + driver
  }
}

// 每张 ReadTicket 恰一个 driver；tracked。driver 的 promise 在 startReadTicket 内经
// `.then(read.settleOnce, read.rejectOnce)` 接入 deferred——与采纳路径互斥，completion 恰
// settle 一次（I2）。三分支扁平结构（R2）：read settle 后，adopted / superseded / 其余
// 恰居其一；分支 B 内含所有权复验，防自环（见文末防死锁自证）。
private async driveLoadRead(key, read, epoch): Promise<LiveEntry | null> {
  let snapshot: Uint8Array | undefined | READ_ERR
  try { snapshot = await read.rawPromise } catch (err) { snapshot = READ_ERR(err) }

  if (read.adoptedByCreate) {                 // 分支 A：create 已胜出并提前采纳（§4.3 规则 1）
      this.observeLateReadOutcome(key, snapshot)   // 仅观测：快照→lost-update 告警；READ_ERR→debug 日志
      return read.adoptedEntry!               // completion 已 settle；返回值仅为对称
  }

  const claim = read.supersededBy
  if (claim !== undefined) {                  // 分支 B：被取代——等 create 定局（I5：胜出⟺已采纳）
      await claim.promise
      if (read.adoptedByCreate) {             // 定局 = 胜出（收尾块已采纳）
          this.observeLateReadOutcome(key, snapshot)
          return read.adoptedEntry!
      }
      // 定局 = 失败：读证据仍有效（失败 create 未触提交点，store 未变——§5.2 seam 承诺）。
      // R2 所有权复验：失败回滚可能已把 cell 恢复为 reading(本 ticket)（§6 rollback）——此时必须
      // 以单元主人身份走经典路由；若直接 routeEvidence→resolveLoad 会 await 本 driver 自己的
      // completion，构成自环死锁（R2 自检发现并修复）。
      const cell = this.cells.get(key)
      if (cell?.state === 'reading' && cell.read === read) {
          return this.ownerRoute(key, snapshot, epoch)
      }
      return this.routeEvidence(key, snapshot, epoch)   // cell 为 empty 或已被他人接手
  }

  // 分支 C：未被取代 → 拥有 cell，经典路由
  // （时序保证：supersede 的 cells.set 与 supersededBy 回填在同一同步块，先于本 continuation
  //   运行——见 §6 acquire；故到达此处且无 supersededBy 时 cell 必为 reading(本 ticket)）
  return this.ownerRoute(key, snapshot, epoch)
}

// 经典 owner 路由：调用前提 = cell 为 reading 且持有本 ticket（分支 B 复验通过或分支 C 直达）
private async ownerRoute(key, snapshot, epoch): Promise<LiveEntry | null> {
  if (!this.isCurrent(epoch)) { this.cells.delete(key); throw disposedErr() }
  if (snapshot instanceof READ_ERR) { this.cells.delete(key); throw snapshot.err }
  if (snapshot === undefined)    { this.cells.delete(key); return null }
  let entry: LiveEntry
  try { entry = this.restoreAndValidate(snapshot, key) }   // 现行 restoreEntry 逻辑/消息原样
  catch (err) { this.cells.delete(key); throw err }        // R2 #3：META 损坏不留 reading 残留，
                                                           // 下次 load 重读 store（瞬时损坏可自愈）
  this.cells.set(key, { state: 'live', entry })
  return entry
}

// create-失败 fallback：证据路由（R2：仅在 create 失败且本 ticket 未复得 cell 所有权时可达）
private async routeEvidence(key, snapshot, epoch): Promise<LiveEntry | null> {
  if (!this.isCurrent(epoch)) throw disposedErr()
  if (snapshot instanceof READ_ERR) throw snapshot.err
  if (snapshot === undefined) return null
  const entry = this.restoreAndValidate(snapshot, key)     // 抛错时 cell 无本 ticket 残留，无需清理
  if (this.cells.get(key) === undefined) {
    this.cells.set(key, { state: 'live', entry }); return entry
  }
  entry.doc.destroy()                       // R2：单元被他人接手 → 销毁未注册的候选实例（防泄漏；
                                            // 等价内容由现持有者的还原产生），再委托
  return await this.resolveLoad(key, epoch) // 委托（I4：绝不注册第二个 entry）；被委托的 cell
                                            // 必不属于本 ticket，无自环
}

// R2 #5：被取代读晚到结局的观测——不影响任何状态，不参与路由（I5）
private observeLateReadOutcome(key, snapshot): void {
  if (snapshot instanceof Uint8Array) {
    console.error('[persistence] lost-update anomaly: createDoc superseded a pending load whose store read returned a pre-existing snapshot', { key })
  } else if (snapshot instanceof READ_ERR) {
    console.warn('[persistence] superseded store read failed after createDoc won the key; ignoring stale read error', { key })
  } // undefined → 无事（create 前 store 本空）
}
```

防死锁自证（R2 更新，含自检发现并修复的自环）：driver 分支 B 的 `await claim.promise` 与 claim 的
收束互不依赖（claim 由 io.write 的 settle 驱动——**其活性前提即 U8**：op 成败两态均 settle，失败
路径经 §6 派生式双 handler 保证，被取代 load waiter 不会因 create 失败而悬置）；分支 A 不等待任何
Promise（采纳已发生）。被取代
且 create 失败、supersededRead 未 settle 时，claim 回滚把 cell 恢复为 `reading(同 ticket)`——driver
在分支 B 的**所有权复验**中识别这一态并转入 `ownerRoute` 经典路由（同步完成，不经过 completion）；
只有 cell 为 empty 或已被他人接手时才走 `routeEvidence`，其委托的 `resolveLoad` 所见的 cell 必不
属于本 ticket，不构成自环。（R2 初稿曾让分支 B 无条件走 routeEvidence，会在该态经 resolveLoad
await 本 driver 自己的 completion 造成死锁——自检发现后以所有权复验修复，规格与代码现一致。）
`loadSlowPath` 复验循环每轮需一次外部 release+evict 才能重复，有界终止。

## §8. 失败、dispose 竞态与清理不变式

**createDoc 失败路径统一清单**（用例 6/9/10 + 简报「不遗留 timer、in-flight、cache entry 或隐藏
lease」）：

| 失败源 | 拒绝值 | cell 终态 | doc | timer | inFlight |
|---|---|---|---|---|---|
| META.docId 不匹配/缺失 | `Error`（message 含 `META.docId`），claim 前 | 不变 | 不销毁 | 0 | 无 |
| cache 已存在（live） | `DocDuplicateError`，无 I/O | live 不变 | 不销毁（challenger 归调用方） | 0 | 无 |
| store 已存在（存在性读返回快照） | `DocDuplicateError`，不写 | driver 还原为 live | 同上 | 0 | 无 |
| 并发 create（creating） | `DocDuplicateError`，写路径之前 | 不变 | 不销毁 | 0 | 无 |
| 初始 io.write 抛错 | **原始错误原样上抛** | empty（或恢复 reading） | 不销毁 | 0（不进 retry） | 收束 |
| dispose 于写 in-flight | `Error('createDoc rejected: persistence is disposed')` | 随 dispose 清空 | 不销毁（未注册 entry，不受 dispose destroy 影响） | 0 | dispose `allSettled` 等待 |

load 侧失败路径（R2 #3 补行）：

| 失败源 | 拒绝值 | cell 终态 | 备注 |
|---|---|---|---|
| store 快照 META.docId 校验失败（restore 侧，owner 路由） | `Error`（message 含 `META.docId`，现行消息原文） | **清 cell → empty**（R2 #3：与 READ_ERR 处理对齐，不留 reading 残留） | 候选 doc 在 `restoreAndValidate` 内销毁（现行行为）；下次 load **重读 store**——瞬时损坏可自愈（现行 loading-Promise-settle-即删语义的等价保留，不重放缓存 rejection） |
| 同上（routeEvidence 回退路径） | 同上 | empty 或已被他人接手——均无本 ticket 残留；候选实例若未注册则销毁（§7） | — |
| U7 完整性破坏（重读丢内容） | `Error('persistence integrity: …')` + console.error | 不变（loud assert，单进程内不可达） | §7 loadSlowPath 的 sawEntry 守卫 |

**dispose 语义**（core，结构照搬现状 + cells 化）：幂等；`closed=true; epoch+=1; status='disposed';
abort()`；对每个 live entry：clearTimers + handles.clear + doc.destroy；cells.clear；`await
Promise.allSettled(inFlight)`。pending read driver / create continuation 在其驱动 Promise settle 后
由 `isCurrent` 检查以 disposed 错误收束——不提前 reject waiter（延续现行「continuation 驱动结算」
模型，既有 4 条 dispose 竞态测试的断言路径不变）。

**不变式汇总**（SA4 静态评审锚点）：
- U1 create 成功 ⇒ resolve 前 io.write 已成功且 epoch 当前（用例 1/10）。
- U2 create 失败 ⇒ 无 handle、cell 无残留 claim、无 timer、传入 doc 未销毁、所有权归调用方（用例 6）。
- U3 任意时刻 `cells` 中同 key 至多一个 live entry；`handle.doc` 恒为该 entry 的 doc（I1）；
  **任何 handle 签发前经所有权复验（I6）——绝不向已销毁/被驱逐的 doc 签发**（R2）。
- U4 初始提交永不调用 `scheduleFlush/scheduleRetry`（用例 2/6 的 `timer.pending()===0`）。
- U5 `DocDuplicateError` 是 duplicate 的唯一拒绝类型（code 恒 `DOC_DUPLICATE`）。
- U6（R2）被取代读的结局永不参与路由（I5）；其 `completion` 恰 settle 一次（I2）；晚到非空快照必
  触发 lost-update 告警、晚到 I/O 错误触发 debug 日志（全分支覆盖，无静默吞）。
- U7（R2）create 胜出 ⇒ store 必含其提交快照（io.write 成功先于 claim settle）；已解析出 entry 的
  key 重读得 null = 完整性破坏 ⇒ loud integrity 错误（console.error + throw），不静默返回 null。
- U8（R3，SA2 R2-1）`claim.promise` 在 op **成败两态均 settle**（失败路径不得遗漏结算）——它是 §7
  两处 `await claim.promise`（resolveLoad creating 分支、driver 分支 B）的**活性前提**：create 失败而
  claim 悬置 ⇒ 被取代 load waiter 永久挂起（静默活性丢失）。机制保证 = §6 的派生式唯一结算
  （`op.then(…, …)` 双 handler；CreateClaim 无 deferred 字段，try/catch 内无显式结算调用）。

## §9. owner 语义迁移（C2 落地清单，逐处枚举）

| 位置 | 改动 |
|---|---|
| `src/index.ts:17` | `readonly user: User` → `readonly owner: User`；JSDoc 改述：「the storage owner of this document (partition key), not the current accessor」 |
| `src/index.ts:31` | `loadDoc(user…` → `loadDoc(owner…`（位置参数，非破坏） |
| `src/index.ts` `DocPersistence` | 新增 `createDoc(owner: User, docId: string, doc: Y.Doc): Promise<DocHandle>`（§10）+ 接口 JSDoc：排他创建、失败所有权、首快照提交点 |
| `src/lifecycle.ts`（新） | `LiveEntry.owner`、`PersistenceHandle.owner`、`createEntry(owner,…)`、`issueHandle`、`restoreAndValidate` 全部 owner 命名 |
| `src/memory.ts` | `Entry.user`、`MemoryDocHandle.user`（类删除并入 core）、`[TEST_FACTORY](owner,…)`、`createMemoryHandleForTest(persistence, owner, docId)` 参数名 |
| `test/memory-testkit.ts` | 包装函数参数 `user → owner`（机械，无逻辑） |
| `src/testing.ts` / 两个测试文件 | SA6 已完成迁移（`createHandle(owner, docId)`、`handle.owner` 断言、`user` 不存在断言）——SA3 不再触碰 |

命名保留：`User` 接口名不变（host-issued partition key 语义，ADR 术语）；仅 handle/参数/字段语义
收敛为 owner。`toKey(owner.userId, docId)` 不变（用例 7 锚定）。

## §10. `DocDuplicateError` 契约（固定点 2）

```ts
// src/index.ts 导出（契约层符号）
export class DocDuplicateError extends Error {
  readonly code: 'DOC_DUPLICATE' = 'DOC_DUPLICATE'   // 类字段初始化 → 自有可枚举属性
  constructor(message = 'createDoc duplicate: the (owner, docId) already exists') {
    super(message)
    this.name = 'DocDuplicateError'
  }
}
```

- 套件锚定：`rejects.toMatchObject({ code: 'DOC_DUPLICATE' })` 恒真；包导出后
  `toBeInstanceOf(DocDuplicateError)` 恒真——两者同时满足。
- 抛点统一携带上下文 message（含 userId/docId 派生信息），调用方**无需解析 message** 即可分支
  （`instanceof` 或 `code`）。

## §11. saveDoc / flush 语义保留与微任务预算约束

- `saveDoc`：身份校验 → `dirtyGeneration += 1` → `scheduleFlush`（debounce 500 / max-dirty 5000 /
  重置语义）逐字保留；degraded 拒写、retry 退避、generation 单飞、flush 后补调度、eviction 条件
  全部不变（25 条既有绿灯即回归网）。
- **微任务预算硬约束**（SA2/SA7 重点）：SA6 fixture 的 fake timer `advanceBy` 每 tick 只排空
  2–3 个微任务；`用例 2`（499/500ms 断言）与既有 debounce 测试通过依赖 flush 链路 await 层数与
  现状一致。因此 §5.3 迁移纪律 1 要求 `io.write` 调用结构（`await io.write → snapshots.set →
  status`）与现行 `writeSnapshot` **同深**；core 化不得在 flush 路径插入额外 async 包装层。
  依据：现行 `memory-persistence.test.ts:164-167`（同款 fake timer、同结构）今日为绿。
- createDoc 初始提交在 flush 机器之外（U4），不与 flush 争 `entry.flushing` 锁；成功后 entry clean，
  后续 saveDoc 从 dirty=1 起步（用例 2 路径）。

## §12. ADR-0006 修订节草案（SA3 逐字追加到 `docs/adr/0006-server-persistence-docstore.md` 末尾）

> 依据 conflict_report §结论 2 与 dispatch 放行记录；落地后 SA8 复审以本节为现行契约文本。
> （外层使用四反引号围栏以容纳内嵌代码块；SA3 落地 ADR 时只取围栏内正文。）

````markdown
### createDoc 与 owner 语义修订（2026-08-21，issue #64；演进经 owner 裁决放行）

本节修订上方两处早期决策条款，取代关系如下；未提及的条款维持原文效力。

**1. 创建语义（取代「创建 = 首个 saveDoc（无独立 createDoc）」）**：`DocPersistence` 提供
`createDoc(owner, docId, doc): Promise<DocHandle>`，对 `(owner.userId, docId)` 排他创建：

- cache/store 已存在或并发创建 → 拒绝 `DocDuplicateError`（稳定错误码 `DOC_DUPLICATE`）；
  **在 duplicate 判定路径上绝不覆盖已提交内容**——cache 命中即拒、store 存在性读见快照即拒、
  并发 claim 即拒，三条判定都在进入写路径之前；并发 create 恰好一个成功，落败者在进入写路径前被拒；
- 创建成功前初始完整 snapshot 已提交（`Y.encodeStateAsUpdate(doc)` 直写；FilePersistence 以
  temp→rename 完成为提交点；不新增 fsync 保证）；成功签发有效 lease 且 `handle.doc === doc`，
  持久层接管该 doc 生命周期（eviction/dispose 时销毁）；
- 失败时不返回 handle、不缓存、不销毁传入 doc，所有权仍归调用方；原始 I/O 错误原样上抛；
- create/create 与 create/load 共享 per-key coordination；create 对同 key in-flight load
  **胜出（supersede）**：取得创建权后在创建收尾块内同步采纳被取代的 load——pending load 不得
  返回 null，而是共享 created live entry；此后对该 key 的重读必得 create 提交内容（不得假 null、
  不得复活被覆盖的旧内容、不得向已驱逐实例签发 lease）。**已知代价：该窗口内 create 可覆盖既有
  提交**（读未返回使 duplicate 判定不可见）——loud 告警（lost-update）是**事后检测而非防护**，
  覆盖被取代读晚到返回既有快照的全部路径；规范调用方模式为先 create、duplicate 再 load，
  不应对同 key 并发 load+create；单实例内该窗口仅由上述调用方竞态触发；
- 持久层仍仅校验 `META.docId === docId`，不校验 VFSL/ROOT/createdAt；`saveDoc` 的
  「脏通知 + 内部调度」语义不变，首个 saveDoc 仍是合法写入路径。

**2. 接口契约（取代本文上方接口代码块的 `DocHandle.user` 与二方法签名）**：

```ts
interface User { userId: string }

interface DocHandle {
  readonly owner: User;   // 文档的存储所有者（分区键），非当前访问者
  readonly docId: string;
  readonly doc: Y.Doc;
  release(): Promise<void>;
}

interface DocPersistence {
  createDoc(owner: User, docId: string, doc: Y.Doc): Promise<DocHandle>;
  loadDoc(owner: User, docId: string): Promise<DocHandle | null>;
  saveDoc(handle: DocHandle): Promise<void>;
}
```

`owner` 仅作分区键，本层不鉴权（与「user 仅作分区键」条款同义，术语对齐）；访问者授权
不进入 Persistence Interface。内部 Entry、契约测试与文档随接口统一 owner 语义。

**3. 实施注记**：create/load 同键协调与 flush 调度收敛为 adapter 共享的 persistence
lifecycle core（MemoryPersistence 与 FilePersistence 共用，不得复制状态机）；两 Adapter
必须通过同一组 createDoc shared contract tests。
````

## §13. 影响评估与兼容性

- **公共 API**：`@nomicore/persistence` 导出面仅增量（`DocDuplicateError`）+ 字段改名
  （`DocHandle.user → owner`）+ 接口加宽（`createDoc`）。仓内无外部消费者（grep 证据 §2），破坏面
  为零；`DocPersistenceWithCreate`/`MemoryPersistenceStatus` 等既有导出形状不变。
- **行为兼容**：25 条既有绿灯全保留（§5.3 迁移纪律 + §11 预算约束）；唯一新增行为面 = createDoc
  及其协调，均被 10 条新用例锚定。
- **风险登记**：
  1. core 抽取的搬移回归风险 → 以既有套件为回归网 + 逐字搬移纪律 + §5.3 R2 显式改写点清单缓解；
  2. supersede×eviction 交互（R2 已修复：提前采纳 + 证据路由仅限 create-失败分支 + 签发侧复验 +
     U7 守卫——SA2 #1 三缺陷封死）→ 残余风险 = lost-update 覆盖窗口本身，靠 loud 告警（检测）+
     调用方模式指引（防护）缓解，且「绝不覆盖」的效力范围已在 §0/§12 限定到 duplicate 判定路径；
  3. 微任务预算（§11）→ 同深约束 + 用例 2 既有锚定；
  4. `stubPersistence` 接口加宽后的 typecheck 破口 → §16 caller 清单明示补桩；
  5. `status='ready'`/提交段守卫迁移（R2 #4）→ 落点已在 §5.2 明示并绑定三条既有绿灯锚定
     （:307-309 / :471 / :492）。
- **给上层的契约提示**（不入本票代码）：namespace lifecycle 的正确创建模式为
  「createDoc → duplicate 则 loadDoc」，禁止对同 key 并发 load+create（§4.3）；**被并发的 load 不限
  于调用方显式发起**（R3，SA2 R2-2）——持久层内部复验重读（§7 loadSlowPath）同样是 in-flight load，
  create 与任何未决 load（含内部）并发都会打开 §4.3 的覆盖窗口，指引按此执行。

---

## §14. 文件清单（File Scope）

### ALLOW LIST

- `packages/persistence/src/lifecycle.ts` — **新建**，共享 lifecycle core：cell 状态机（§4）+
  createDoc/loadDoc/saveDoc 算法（§6/§7）+ flush/eviction/dispose 机器自 memory.ts 逐字搬移
  （§5.3），约 +340 行
- `packages/persistence/src/memory.ts` — 修改，瘦壳化：IO wiring + 委托 + owner 改名 +
  `createDoc`，净约 -180 行（状态机外移）
- `packages/persistence/src/index.ts` — 修改，`DocHandle.owner` + `DocPersistence.createDoc` +
  `DocDuplicateError` 导出 + JSDoc owner 语义，约 ±30 行（§9/§10）
- `packages/persistence/test/persistence-contract.test.ts` — `[SA6 owned]` SA6 已完成 owner 迁移
  与 createDoc 模块契约测试；SA3 仅机械补 `stubPersistence` 的 `createDoc` 桩（§16 caller 清单，
  ~3 行，无断言改动）
- `packages/persistence/test/memory-testkit.ts` — `[SA6 owned]` 参数名 `user → owner` 机械改名
  （~2 行，无逻辑）
- `docs/adr/0006-server-persistence-docstore.md` — 修改，追加 §12 修订节草案（conflict_report
  §结论 2 / dispatch 放行要求的落地）
- `packages/persistence/src/testing.ts` — `[SA6 owned]` **已完成**（红灯 harness），SA3 不再改动；
  列于此仅为 SA4 的 base→HEAD diff 对账
- `packages/persistence/test/memory-persistence.test.ts` — `[SA6 owned]` **已完成**（红灯测试），
  SA3 不再改动；对账同上
- MABF 流程工件（对账项，非代码）：`wiki/raw/task_persistence-create-doc*.md`、`TASK.md`、
  `.mabf-bg/*`（若派发系统产生）——均为门禁/简报/设计/评审记录

### DENY LIST

- `packages/persistence/src/file.ts`（及任何 FilePersistence 实现）— P3 #58 领地，本票只交付其
  复用的 lifecycle core（§5.4）
- `packages/vfsl/**`、`packages/vfsl-protocol/**`、`packages/vfsl-codegen/**`、`domains/**` — 与
  持久化 seam 无交集（ADR-0004/0005 领地）
- `vitest.config.ts`、根 `package.json`、`tsconfig.base.json`、`tsconfig.typecheck.json`、
  `packages/persistence/{package.json,tsconfig.json}` — 无新增测试包/端口/编译配置需求（SA6 已
  确认 `scripts/test-lock.sh` 不存在）
- `packages/persistence/src/index.ts` 既有公共符号的行为契约（`DEFAULT_PERSISTENCE_SCHEDULE`、
  `PersistenceTimer`/`systemPersistenceTimer`、`resolvePersistenceSchedule`、
  `provideDocPersistence`/`requireDocPersistence`、`DOC_PERSISTENCE_SERVICE`）— 签名与语义冻结，
  本票只做 owner 语义的文档性更新
- 测试断言逻辑（三个测试文件内任何 `expect`/用例结构）— SA6 owned；SA3 仅允许 §16 caller 清单
  列明的两处机械改动

---

## §15. 协议假设依据 (Protocol Assumption Evidence)

本任务为纯进程内代码（无 HTTP/WS/端口/跨进程资源假设），但含以下**库行为与调度假设**，逐条给出
已知行为依据：

| 假设 | 依据类型 | 依据内容（具体引用） | 风险 |
|---|---|---|---|
| `doc.getMap('META')` 对缺失 root 自动创建空 Map，`.get('docId')` 返回 `undefined` → bare doc 走 mismatch 拒绝 | 现有测试引用 + 源码引用 | 现行生产代码 `src/memory.ts:176` 自 P2 起同一模式；红灯用例 9（`testing.ts:496-499`）锚定 bare → `/META\.docId/` | 低 |
| `Y.encodeStateAsUpdate(doc)` 捕获含 META/ROOT/SCHEMA 的完整状态，`Y.applyUpdate` 可原样还原 | 现有测试引用 | `memory-persistence.test.ts:349-365`（evict 后还原等价内容）与红灯用例 1（fresh 实例直读 `ROOT.who==='hello'`）；现行 flush 即此编码 | 低 |
| `doc.destroy()` / `doc.isDestroyed` 语义如 Yjs 文档 | 源码引用 + 现有测试引用 | `src/memory.ts:143,274` 现行使用；红灯用例 3/4/6 断言 `isDestroyed === false` | 低 |
| AbortSignal 传递可被 IO 实现观测（dispose 等待收束） | 现有测试引用 | `memory-persistence.test.ts:383-494` 五条 dispose 竞态测试（restore/flush/write 悬置各路径）现行为绿；`MemoryPersistenceOptions` 注释「must honor signal」 | 低 |
| fake timer `advanceBy` 的 2–3 微任务排空预算足够覆盖 flush 链 | 现有测试引用 | `memory-persistence.test.ts:164-167` 与 `testing.ts` 用例 2 的同结构链路今日为绿；§11 同深约束封住回归 | 中（已立约束） |
| 并发 `await` 同一 Promise 的 continuation 按注册序执行（create#1 先于 create#2 驱动） | 设计期推演 + 无害兜底 | 即使序不保证，claim 为同步 check-then-set，最坏互换胜者，仍恰一成功（用例 4 只断言数量与 `enteredWrites===1`） | 低 |
| `signal.aborted` ⟺ epoch 过期（R2 #4 守卫替换的等价前提） | 源码引用 | 现行 `src/memory.ts:136-139`：`closed/epoch+=1/status/abort()` 在 dispose 的同一同步块内置位，二者无单独变更点；故 IO 闭包内以 `signal.aborted` 早退替代被拆走的 `isCurrent(epoch)` 守卫属等价替换（§5.2） | 低 |

无其他协议级假设：不涉端口占用、进程时序、CI 资源生命周期或未验证的第三方端点行为。

---

## §16. 契约改动连锁审计 (Contract Change Caller Audit)

### 改动函数/类型

| 符号 | 文件 | 改动前契约 | 改动后契约 |
|---|---|---|---|
| `DocHandle.user` | `src/index.ts:17` | `readonly user: User` | `readonly owner: User`（字段改名，破坏性） |
| `DocPersistence` | `src/index.ts:30` | `{ loadDoc, saveDoc }` | `{ createDoc, loadDoc, saveDoc }`（接口加宽，implementor 破坏性） |
| `DocPersistence.loadDoc` | `src/index.ts:31` | `loadDoc(user, docId)` | `loadDoc(owner, docId)`（仅参数名，非破坏） |
| `MemoryDocHandle.user` | `src/memory.ts:51` | `public readonly user` | 删除该类，core `PersistenceHandle.owner` 取代 |
| `Entry.user` | `src/memory.ts:31` | `readonly user: User` | `LiveEntry.owner`（内部字段改名） |
| `createMemoryHandleForTest` | `src/memory.ts:338` / `test/memory-testkit.ts` | `(persistence, user, docId)` | `(persistence, owner, docId)`（仅参数名，非破坏） |
| `DocDuplicateError` | `src/index.ts`（新） | — | 新增导出类（additive） |
| `MemoryPersistence.createDoc` | `src/memory.ts`（新） | — | 新增方法（additive） |

**行为契约改动（throw/return 语义）**：**无**。既有函数（`loadDoc/saveDoc/dispose/flush 链`）的
返回类型、throw 条件、时序全部不变；全部改动为类型面（改名/加宽）与新增符号。

### Caller / implementor 清单

| Caller / implementor | 文件:行号 | 是否 await | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---|---|---|---|---|
| `MemoryPersistence`（implementor） | `src/memory.ts:69` | — | — | — | 本票实现 `createDoc`（委托 core） |
| `stubPersistence`（implementor，测试桩） | `test/persistence-contract.test.ts:19-26` | — | — | — | **SA3 机械补桩**：加 `async createDoc(): Promise<DocHandle> { throw new Error('stub persistence does not implement createDoc') }`（接口加宽后 typecheck 必需；无断言改动） |
| `provideDocPersistence` / `requireDocPersistence`（类型透传） | `src/index.ts:101,110` | 否（同步） | 自带 absent 抛错 | N/A | 不受影响（pass-through） |
| lease 套件 fixture `createHandle` | `test/memory-persistence.test.ts:79-81` | await | 否（测试断言 rejects） | vitest | SA6 已迁移为 `createDoc` 路径，红灯即此 |
| createDoc 套件 fixture | `test/memory-persistence.test.ts:85-104` | await | 否 | vitest | SA6 已完成 |
| `handle.user` 读点 | 全仓 grep：仅 `src/testing.ts:246`（断言不存在，SA6 已完成）与 `src/index.ts:17`/`src/memory.ts`（定义点，本票改名） | — | — | — | 无其他读点（grep 证据 §2/§9） |
| `loadDoc(user…)` 具名参数调用 | 无（全部位置参数：`memory.ts` 内部 + 三个测试文件） | — | — | — | 参数改名零波及 |
| `Entry.user`/`MemoryDocHandle.user` 读点 | `src/memory.ts:195`（issueHandle）唯一 | — | — | — | 随类迁移到 core 改名 |
| `createMemoryHandleForTest` 调用点 | `test/memory-testkit.ts:11`、`test/memory-persistence.test.ts`（15 处，全部位置参数） | await | 否 | vitest | 参数改名零波及 |

抓全方法复核（SA4 可重跑）：

```bash
git grep -n "\.user\b" -- 'packages/**/*.ts'          # 仅定义点 + SA6 断言
git grep -n "loadDoc\s*(" -- 'packages/**/*.ts'       # 全部 caller 已列
git grep -rn "nomicore/persistence" -- '*.ts' '*.json' # 外部消费 = 0
```

风险评估：接口演进波及面封闭在本包（外部消费零命中）；唯一 typecheck 破口（stub）已在清单内；
行为契约无改动，不存在 uncaught-rippling 类风险。

---

## §17. SA2 反馈逐条回应（R2 + R3 修订）

> 被回应评审：`wiki/raw/task_persistence-create-doc_sa2_review.md`（verdict=reject，6 攻击点）。
> 修法核心：采纳机制重构为「create 胜出收尾块同步采纳（提前采纳）」——同时消解 #1 的三个派生
> 缺陷与 #2① 的规格矛盾（采纳 SA2 推荐方案）；证据路由（fallback）从构造上**仅在 create 失败
> 分支可达**，「create 胜出但 cell 回 empty」的歧义态不复存在。

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| R2-#1（CRITICAL）supersede×eviction 交互未定义；派生 假 null／静默旧内容复活／ghost handle | ✅ | §4.1（I2/I5/I6、ReadTicket deferred+`supersededBy`+`adoptedByCreate`）、§4.2（转移表 3 行）、§4.3（规则 1/3/4 + 「supersede × eviction 交互」小节逐缺陷封死）、§6（胜出块同步采纳）、§7（driver 三分支扁平结构 + `routeEvidence` 仅限 create-失败 + `loadSlowPath` 签发侧复验循环 + U7 sawEntry 守卫）、§8（U3/U6/U7）、§4.4（R2 补充用例 5a–5c） | ① create 胜出 ⟺ 已采纳（I5，同一同步块，先于 claim settle）：被取代读的结局**永不参与路由**，fallback 仅在 create 失败分支可达——(a) 假 null 与 (b) 旧内容复活从构造上不可达；(b) 的告警缺口由 `observeLateReadOutcome` 全分支补齐（采纳路径晚到非空快照必 console.error）；② 签发侧所有权复验与签发同一同步块（I6）+ 复验失败重走 resolveLoad → 重读得 create 提交内容——(c) ghost handle 消除；重读得 null 由 U7 loud integrity 守卫拦截（sawEntry 跨轮检测，首轮 null 仍为合法 not-found）。未选「pin 住 entry 不可 evict」方案：hung read 下 pin 成为无界驻留，且 pin 不能单独修复 (c) |
| R2-#2（HIGH）①§4.3「立即采纳」与 §7 伪代码相反；②§12「绝不覆盖」绝对化 | ✅ | ①§4.3 规则 1 精确化（采纳=收尾块内 `settleOnce`，不等 read settle）+ §7 伪代码重写对齐（分支 A 即采纳出口）+ §4.4 用例 5d（判定性测试：hung read 下 waiter 照常返回）；②§0 C1 与 §12 bullet 1 限定为「在 duplicate 判定路径上绝不覆盖——三条判定都在写路径之前」、§12 bullet 4 显式注明「该窗口内 create 可覆盖既有提交；loud 告警是事后检测而非防护，覆盖被取代读晚到返回既有快照的全部路径」+ 规范调用方模式 | 二选一取「claimResolve 同步采纳」（SA2 推荐项，与 #1 修法一致）；§4.3 与 §7 逐字一致，SA3 无歧义。bullet 4 的告警承诺在 #1(b) 修复后真正全覆盖（采纳路径全部晚到快照均触发） |
| R2-#3（MEDIUM）restore 校验失败 cell 残留 reading 态 | ✅ | §7 分支 C（owner 路由）：`restoreAndValidate` 抛错 → `cells.delete(key)` 再 throw（try/catch 包裹）；§8 补「load 侧失败路径」表首行 | 与 READ_ERR 处理对齐；下次 load 重读 store，瞬时损坏可自愈（现行 loading-Promise-settle-即删语义等价保留，不重放缓存 rejection） |
| R2-#4（MEDIUM）io.write seam 丢失 isCurrent 守卫；`status='ready'` 落点未指明 | ✅ | §5.2（新增「提交段原子性」承诺 + `status='ready'` 落点明示并绑定 :307-309/:471/:492 三条绿灯）、§5.3 代码草图（`if (signal.aborted) return` 守卫）+ 迁移纪律 5（`writeSnapshot` 拆解落点逐项：hook→IO 闭包、isCurrent→seam aborted 承诺、snapshots.set→守卫后、status→core flush isCurrent 后）、§15（补 aborted⟺epoch 等价性依据行） | 幽灵提交（#58 rename 于 abort 后）与私有存储复活被 seam 级承诺封死；degraded→ready 恢复通道与 dispose-during-flush 的 status 保持均有既有绿灯锚定；失败的 io.write 保持 store 不变（§4.3 规则 2 的前提） |
| R2-#5（LOW）superseded read 以 I/O 错误 settle 被完全吞掉 | ✅ | §7 `observeLateReadOutcome`（READ_ERR → `console.warn` debug 级日志，明示设计决策：观测不阻断——采纳的操作本身已成功，错误属于已失效的读）+ §8 U6 | 补日志而非豁免：I/O 故障可观测，与「不静默」精神一致 |
| R2-#6（LOW）entries→cells「逐字搬移」适配点未点名 | ✅ | §5.3 迁移纪律 5（显式映射清单）：saveDoc 的 entry 寻址→live-cell 查询、maybeEvict 的 delete→持该 entry 的 live 才删、release/flush 终态/dispose 遍历寻址、assertOwnedHandle 不依赖 cell、writeSnapshot 拆解落点 | SA3 无需自行推断；creating/reading 态下 handle 校验维持 `'foreign or released DocHandle'` 语义明示 |

### R3 回应（2026-08-21，SA2 R2 节窄幅 reject：R2-1 门禁 + R2-2/R2-3 随轮）

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| R3-1（=SA2 R2-1，MEDIUM 门禁）claim 结算机制唯一化 + U8 不变式 | ✅ | §6（删除收尾块未定义符号 `claimResolve()`；L485 派生式成为唯一结算机制，附双 handler 注释；实现注意补「唯一化」段——try/catch 内无任何显式 claim 结算调用）、§8（新增 U8：claim.promise 成败两态均 settle，失败路径不得遗漏——§7 两处 await 的活性前提）、§7 防死锁自证段（补引 U8：claim 由 io.write settle 驱动，其活性前提即 U8） | 取 SA2 二选一中的**派生式方案**（删 `claimResolve()`）：`claim.promise = op.then(→undefined, →undefined)` 为唯一机制，catch 块不做结算——两态 settle 由双 handler 结构性保证，无「只在 try 块 resolve 的 deferred」误读空间（该误读的后果链——supersede + 写失败 + waiter 永久挂起——已作为 U8 的反例写入不变式） |
| R3-2（=SA2 R2-2，LOW）§4.3 可达性归因「调用方自己」过窄 | ✅ | §4.3（单实例内 bullet：触发前提改写为「对同一 key 存在与 create 并发的 in-flight load」，显式列出持久层内部复验重读这一发起方及完整触发链）、§13（契约提示补一句：被并发的 load 不限于调用方显式发起，create 与任何未决 load（含内部）并发都打开覆盖窗口） | loadSlowPath 复验循环使 core 自身成为 load 发起方的事实入册；指引升级为「不与任何未决 load（含内部）并发」。无新静默路径（窗口已被披露 + 告警覆盖），纯披露完整性修订 |
| R3-3（=SA2 R2-3，NIT）两处 TS 草图自洽 | ✅ | §5.3（io.read 闭包 async 化 + 注释：read 侧额外一跳不违反 §11 同深约束——该约束适用范围 = write/flush 链）、§7（loadDoc 补 `async` 关键字与 `Promise<DocHandle \| null>` 返回类型注记：快路径裸 handle 由 async 语义自动包裹，与现行 loadDoc 一致） | `pnpm typecheck` 即钉的两处编译面问题在草图层面消除；§11 约束的适用范围边界同时显式化 |

R3 修订范围声明：仅动 §4.3 / §5.3 / §6 / §7（防死锁段与 loadDoc 签名）/ §8（U8）/ §13 / §17 与文档头
修订标记，其余章节未触碰——与 SA2「增量重审」预期对齐（R2 已核验结论不重开）。

**一致性自检（R3 后全文重跑）**：supersede/采纳/复验/证据路由/claim 结算 五组术语全文表述一致
（「采纳」恒指收尾块 `settleOnce`；「证据路由/fallback」恒指 create-失败分支的 `routeEvidence`，
其可达前提含「未复得 cell 所有权」）。自检过程中发现并修复一处 R2 初稿缺陷：分支 B（create 失败）
若在失败回滚恢复 `reading(同 ticket)` 后无条件走 routeEvidence，会经 resolveLoad await 本 driver
自己的 completion 构成自环死锁——已以**所有权复验**（复得 → ownerRoute）修复，§7 代码与防死锁
自证段落现逐字一致。§4.3 与 §7 伪代码对齐；§0/§12 的「绝不覆盖」恒为限定式（duplicate 判定
路径）；I2/I5/I6 与 U3/U6/U7 交叉引用闭合；§4.4 新增 5a–5d 与 SA2 红线测试 1–4 一一对应。
R2 修订未触碰 ALLOW/DENY LIST（文件范围不变，立法「只增不删」满足——无新增文件需求）。
