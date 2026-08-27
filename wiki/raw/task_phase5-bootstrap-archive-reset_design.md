# 冻结设计 — issue #133「Phase 5: bootstrap import, archive, and guarded replica reset」（Phase 2 架构设计）

- **修订状态**: **R4**（2026-05-30）——SA4 静态验尸 **pass** 后的注记轮（零 D-x 裁决变动）：F-1 §4.0.3 ImportReplicaIssue 补列 NAMESPACE_NOT_FOUND 成员（R1-R3 漏列与 §4.2 伪码矛盾的内部调和，SA3 已 additive 落位、SA4 裁决接受）；F-3 §4.5.6 行 9 善后归属与 R3 §4.4 放置点表同步（io-gate 在置 cell 前 → 无 cell 可清）；F-4 §9 计数按实测更正（git-grep 域 16 / 文件系统域 17，口径差异注明；§4.11.2「七类」→「六类」）；偏差 2（import-red File 夹具 +6 行 ENOENT 容错管道）§4.14.1/§7 声称同步（已登记 SA6）。R3：SA2 R2 pass 后轻量修订（LOW-R2-1 gate 放置点表 + §4.5.3 入口 assertArchiveIo；LOW-R2-2 forceReleasing 跨 key 注记；INFO-R2-2/1 计数更正与 SA7 登记）。R2 主体：落实 SA2 R1 reject 全部修订条件（BLOCKER-1 settle×dispose → dispose 同步通知 + finally 首位通知 + 全程 track；BLOCKER-2 archiving claim 失败善后 identity 守卫清理；MEDIUM-3 seedForTest；MEDIUM-4 Memory 独立 Map 分区；LOW-5 fatal code-first；LOW-6 import 接纳段；INFO-9 forceReleasing 抑制）——逐条表 + BLOCKER 推演见文末修订记录。D-1..D-14 主体裁决零回退（SA2 §四 已逐项验证闭合）。
- **Issue**: #133（welltop-jim-wang/nomicore）
- **Task Type**: 功能开发（feature）——Persistence 受控复制导入/归档 seam + Registry 受信 bootstrap 路径与 resetReplica 编排
- **Branch / Worktree**: `fix/issue-133-on-docs-phase-5-websocket-replication` @ ebc5419 ／ `/home/wangjian/nomicore-fix-issue-133`
- **流水线 slug**: `phase5-bootstrap-archive-reset`
- **设计输入**: 任务简报（task_phase5-bootstrap-archive-reset.md，AC-1..AC-6）；SA8 冲突门禁报告（verdict: clear，观察项 N-1..N-9 逐条回应见 §4 各节与 §10）；SA6 红灯报告 + 5 个红灯测试文件（可执行契约锚）
- **权威基准**: docs/adr/0010、docs/phases/phase-5-websocket-replication.md、docs/adr/0006（含 #64/#79/#131 修订节）、docs/adr/0008（含 #132 修订节）、docs/adr/0009（含 #131 修订节）、CONTEXT.md:113-127

---

## §1 任务类型与需求推演

### 1.1 任务类型

Feature。本票交付 ADR 0010 §复制谱系与 epoch / §Bootstrap 与重连授权的**本地生命周期**四个缺席面（SA6 红灯报告 §1 逐条 grep 实证基线全缺失）：

1. Persistence 受控复制导入 seam（排他创建持久副本）；
2. Persistence 受身份前置条件保护的归档 seam（`archiveDoc`）；
3. Registry 内部受信任 bootstrap 导入路径（保留 Hub namespaceId）；
4. Registry `resetReplica` 编排（close→archive→允许 bootstrap）。

非目标（简报「边界提示」+ N-7）：WS transport / ReplicationSession / wire 状态机 / 认证授权（切片 3–7）、apps/yjs-server 装配（切片 9）、切片 8 的 targets 运行时 add/remove 与结构化 observer seam（phase:114-116，属 ws-replication 插件域）、在线 epoch bump fencing 与 degraded bypass 复制写（切片 4/6）、Persistence 跨 owner catalog（ADR 0010:218 明令不增加）。

### 1.2 需求推演（从权威条款到设计负载）

| 权威条款 | 设计负载 |
|---|---|
| ADR 0010:28「复制 bootstrap 使用内部受信任导入保留 Hub namespaceId，不是普通 create」 | Registry 新增一条**不生成 namespaceId** 的导入入口（D-1/D-2）；普通 create 接纳（`acceptCreateIdentity`，identity.ts:175-198）零改动 |
| ADR 0010:65「peer 在 detached Y.Doc 应用基线、严格核对 META 身份，再通过 Persistence 的受控复制导入能力排他创建」 | 核对次序冻结：Registry 在**调用任何 Persistence 方法之前**核对 `META.docId === namespaceId` 与复制事实两键（D-2）；Persistence 导入 seam 为排他创建（D-3） |
| ADR 0010:57「Registry 先关闭本地 Runtime generation，再通过 Persistence 归档旧副本，最后允许重新 bootstrap。Persistence 为此增加受身份前置条件保护的归档 seam；WS 层不得直接读写 snapshot 文件」 | Registry resetReplica 编排（D-8）+ Persistence archiveDoc 身份守卫（D-5）；文件移动封闭在 persistence 包内（D-9/D-13） |
| phase:63「`archiveDoc(owner, docId, expectedReplicationIdentity)` 仅在无有效 handle/Runtime generation 时执行」 | archiveDoc 前置：live entry 有 handle → 拒绝；零 handle 但 dirty → **排空后归档**（D-5 状态机——「无有效 Runtime generation」含在途 flush 的排空） |
| phase:64「FilePersistence 使用同 rootDir 内受控 archive 路径和原子 rename；MemoryPersistence 提供行为等价、可测试的归档语义」 | File `archive/` 子树 + tmp→rename 提交（D-9）；Memory hook-store 等价删除面（D-10） |
| phase:65「duplicate、identity mismatch、operational failure 与 committed-aware fatal 使用稳定分类」 | Persistence 归档四分类 + 导入复用 create 冻结族（D-11）；Registry 结果联合 issue 码（D-11） |
| ADR 0006:118-133（#64 修订节）排他创建三判定 + 「在 duplicate 判定路径上绝不覆盖已提交内容」 | importDoc **复用** createDoc 的 per-key claim 机械（D-3），不另立第二套排他逻辑 |
| ADR 0008:131-137（#132 修订节）构造期复制事实窄例外 + 两态判据 | 导入后 Runtime 走**同一构造路径**（D-12）；Registry/Persistence 的复制事实判据以 `readReplicationFacts`（replication-write.ts:213-240）的判据族为唯一语义源（D-2/D-5） |
| ADR 0009:32 旧异步操作只能按 entry identity/generation 清理自己 | reset 编排沿用 removeOnlySelf 双守卫与 carrier FIFO（D-8） |

### 1.3 关键现状张力（驱动接口形态裁决的事实）

设计前实证（grep 证据见 §9）：

1. **13 个既有测试类 `implements DocPersistence`**（packages/namespace-registry/test/ 13 个文件）——若在 `DocPersistence` 上加**必需**成员 `importDoc`/`archiveDoc`，全部 TS2420 编译红（tsconfig.typecheck.json 覆盖 packages/*/test/**）；
2. **registry-surface.test.ts:57-70 冻结 registry 主入口值导出恰九键**、**:42-47 声明图禁词**（`NamespaceRuntime`/`DocHandle`/`Y.Doc`/internal subpath 不得出现在主入口可达声明图文本）、**:180-208 可达 d.ts 审计**；
3. **registry-sa7-phase5-dynamic.test.ts:312-351 既有 wrapIo 包装字面量**只含 `{read, write}`——若 `PersistenceIO` 加**必需**成员同样编译红。

这三条事实 + 技能立法「caller 数 > 10 应反思是否改契约」决定了 D-4 的 optional-成员 + 派生接口裁决（详见 §4.4）。

---

## §2 设计决策总表（D-1..D-14）

| # | 决策（一行） | 详节 | 主要依据 |
|---|---|---|---|
| D-1 | 受信 bootstrap 路径 = `NamespaceRegistry` 公共方法 `importReplica(owner, namespaceId, doc)` / `resetReplica(owner, namespaceId, expectedLocalIdentity)`；信任模型按 ADR 0010:79「Host 搭建方负责只把能力交给可信代码」文档化，不做 capability-token | §4.1 | 0010:28/57/65/79/222；phase:62/113；N-4 |
| D-2 | `importReplica` 输入 = detached 完整 `Y.Doc`（registry 公共面经 `YjsDoc` 别名引用，规避声明图禁词）；槽内核对次序冻结：`META.docId === namespaceId` →（不符 `NAMESPACE_IMPORT_IDENTITY_MISMATCH`）→ 复制事实两键合规且 enabled（否则 `NAMESPACE_IMPORT_INVALID_IDENTITY`）→ 才调用 Persistence；判据复刻 `readReplicationFacts` 单点判据族 | §4.2 | 0010:65；phase:62；ADR 0008:131-132；N-1；AC-1 |
| D-3 | Persistence `importDoc(owner, docId, doc): Promise<DocHandle>`：**复用** createDoc 同一条 per-key 排他 claim 管线（probe-read 证据等待 → creating claim → encode → io.write → live entry），仅身份拒绝改为 typed `DocImportIdentityError`（code `DOC_IMPORT_IDENTITY_MISMATCH`）；duplicate 复用冻结 `DocDuplicateError`；operational/fatal 复用冻结 create 族（`DOC_CREATE_OPERATIONAL`/`DOC_CREATE_FATAL` + 既有 phase 词表） | §4.3 | ADR 0006:118-133/132；phase:62/65；SA6 IMP 全锚 |
| D-4 | `DocPersistence` 以 **optional 成员**（`importDoc?`/`archiveDoc?`）建模复制能力，另出**派生接口 `ReplicaPersistence`**（required 成员）由 Memory/File 实现；`PersistenceIO` 同款 optional 扩展 `writeArchive?`/`remove?`；Registry/lifecycle 以 `typeof` 窄化 + loud 拒绝（无静默降级）。配套 SA6 回流 R-2（surface 两个类型锚改锚 `ReplicaPersistence`） | §4.4 | 技能「>10 caller」立法；§1.3 三条事实；0010:218（能力授权）；ADR 0006:86-92（第三方 Adapter 演进位） |
| D-5 | `archiveDoc(owner, docId, expected): Promise<Readonly<{ok:true}>>`（拒绝走 typed rejection）：状态机 = **settle（排空零-handle dirty entry，强制即时 flush、尊重 degraded retry 回退）→ claim（新 cell 态 `archiving`，与 reading/creating 互斥）→ guard-read（io.read 主键）→ 身份核对（持久快照复制事实 === expected，单一谓词覆盖错 id/错 epoch/缺失/损坏/docId 不符）→ relocate（io.writeArchive → io.remove）**；四分类 + committed-aware fatal（phase 词表 guard-read/relocate-write/relocate-remove，committed 映射 false/false/true） | §4.5 | phase:63/65；0010:57；ADR 0006:52 写公理；SA6 ARC 全锚；N-5 |
| D-6 | 归档提交段路由裁决（SA6 边缘提示 2）：**归档写经 `io.writeArchive` 且 fault seam 将其并入既有 write 故障/hold 槽**（`holdNextWriteBeforeCommit`/`failNextWrite` 可注入归档提交段）；**主键移除经 `io.remove`**（seam 透传）；`PersistenceIO` 不引入魔法 key 命名空间 | §4.6 | SA6 ARC hold/fail-write 两用例（强制锚）；phase:64 原子 rename；N-6 |
| D-7 | `expectedLocalIdentity` 与 `expectedReplicationIdentity` 是**同一形状** `ReplicationIdentityRef = Readonly<{ replicationId: string; replicationEpoch: number }>`（冻结）；Registry **纯传递**（不在 close 前读本地事实做预检）；守卫权威 = 持久快照复制事实（archiveDoc 内部、settle 排空后读取）；同 id 不同 epoch **算 mismatch** | §4.7 | phase:63/113；0010:46-48/55/57；N-1；SA6 §6.1 |
| D-8 | `resetReplica` 编排（carrier FIFO 槽内）：owner 核对（零存在性泄露）→ **强制失效该 entry 全部未决 lease**（SA6 冻结观测：`lease:'released'`）→ 取消 idle 武装 → close（复用 closePromise/移除机械）→ 存在性探针（loadDoc；null → `NAMESPACE_NOT_FOUND` 且**不触达归档 seam**）→ `archiveDoc`（期望身份纯传递）→ 映射矩阵；bootstrap 资格 = key 缺席（无显式标记、无新状态枚举）；stale 身份重放由同一守卫天然拒绝 | §4.8 | 0010:57；phase:113；ADR 0009:32/50/114；N-2；SA6 REG AC-4 全锚 |
| D-9 | File 归档布局冻结：`{rootDir}/archive/users/{userId}/{docId}.snapshot`（+ 同名 `.tmp` 暂存）；SAFE_PATH_SEGMENT 双段守卫；同名重复归档 = **单槽 latest-wins 覆盖**（tmp→rename 原子覆盖）；归档 tmp 与启动 `.tmp` 清理规则协调：每 key 至多一份 tmp、下次归档覆盖式清理、tmp 永非提交态 | §4.9 | phase:64；ADR 0006:39/50/52；N-6；SA6 ARC File 专属锚 |
| D-10 | Memory 归档等价（R2 修订：消解归档键与主键空间同池碰撞）：`writeArchive` = abort gate → **专属 `archiveSnapshots` 独立 Map**（以主键为键、与主 mirror 结构性分区；不经 `writeSnapshot` hook——锚定兼容性论证见 §4.10.2）；`remove` = abort gate → **新 optional `deleteSnapshot` hook** + 主 mirror 删除；受 readSnapshot 钩子接线且缺 deleteSnapshot 的实例在归档时 **loud 拒绝**（配置缺陷，非静默）；等价面 = loadDoc→null + slot 重建 + 守卫/拒绝路径共享矩阵（ADR 0006:157-159 平行验收）；恢复面按 phase:183 由 File 承担。配套 SA6 回流 R-1（两个 Memory fixture 补 `deleteSnapshot`） | §4.10 | phase:64/183；ADR 0006:157-159/30-39；N-8；拒绝虚假降级立法；SA2 MEDIUM-4 |
| D-11 | 错误分类学：Persistence 新增 `DocImportIdentityError` + 归档四类（Identity/ActiveHandle/Duplicate/Operational）+ `DocArchiveFatalError`（三 phase + 冻结 committed 映射导出）；SA6 临时拼写**全部原样冻结**（零改名）；Registry 新增 5 个稳定 message 常量 + 结果联合；`NamespaceRegistryFatalError.operation` append-only 扩展 `'reset' | 'import'`（授权链 = ADR 0010:222 对 ADR 0009:107-114 的演进，类比 #131 `namespace-id-generation` phase 先例）；phase 词表零新增 | §4.11 | phase:65；ADR 0009:89-93/139；0010:222；N-3 |
| D-12 | 导入后 Runtime 构造走**既有单一构造路径**（`factory(handle, () => persistence.saveDoc(handle))`，与 open/create 步⑤同款）；factory throw → handle best-effort release + `NamespaceRegistryFatalError('import', 'runtime-construction', committed:true)`（镜像 create DQ-7）；namespace-runtime 包**零改动** | §4.12 | ADR 0010:66；ADR 0009:68 先例；ADR 0008:131-132；N-9 |
| D-13 | File Scope：ALLOW = persistence 6 文件 + registry 5 文件 + SA6 5 个测试文件（回流 R-1/R-2 落位）；DENY = `packages/namespace-runtime/src/**`、`packages/replication-protocol/**`、`docs/**`（零文档改动，对照 #132 D-12 先例论证）、其余全部包 | §7 | 技能 File Scope 立法；scope-creep 防护 |
| D-14 | 测试迁移面：SA6 52 红用例中 50 个直接转绿；2 处 fixture/锚回流（R-1/R-2，共 ~5 行）；既有 28 文件 313 用例（persistence+registry）与全仓 1599 例零回归的静态论证 | §4.14 | SA6 §2/§5；零回归门禁 |

---

## §3 现状关键事实（代码锚点）

### 3.1 packages/persistence

| 事实 | 锚点 |
|---|---|
| `DocPersistence` 公共面恰三方法 | `src/contract.ts:38-42` |
| `DocDuplicateError`（code `DOC_DUPLICATE`，message 恒定） | `src/contract.ts:44-51` |
| `DocCreateOperationalError`（`committed: false` 字面量；cause 保留；message 不拼接 cause） | `src/contract.ts:94-105` |
| create fatal phase 词表（probe-read/snapshot-encode/store-write/post-commit）+ 冻结 committed 映射导出 | `src/contract.ts:115-131` |
| `DocCreateFatalError`（committed 由 phase 派生，权威不重推导） | `src/contract.ts:142-156` |
| `PersistenceIO` seam：read/write + AbortSignal 契约 + 「write resolve ⟺ committed / reject ⟹ store 不变 / 禁同步 throw」公理 | `src/lifecycle.ts:15-44` |
| cell 状态机 `reading/creating/live`；ReadTicket/CreateClaim；per-key 协调全部收敛于 lifecycle（两 Adapter 不得复制状态机） | `src/lifecycle.ts:89-92`、`76-87`；ADR 0006:157-159 |
| createDoc claim 环：reading 等待 raw 证据 → 见快照即拒 → creating claim 先于任何写 | `src/lifecycle.ts:187-230` |
| 提交点 = `io.write` resolve（W4/W5 post-commit committed:true） | `src/lifecycle.ts:247-262` |
| `validateCreateDoc`（META.docId 校验，bare loud Error） | `src/lifecycle.ts:456-461` |
| `restoreAndValidate`（loadDoc 侧 META.docId 校验） | `src/lifecycle.ts:490-499` |
| flush 单飞 + generation 保序 + retry 回退；`maybeEvict`（0 handle + 非 flushing + saved===dirty 才驱逐） | `src/lifecycle.ts:550-596` |
| epoch/dispose：`abortController` + `epoch += 1` + inFlight 排空 | `src/lifecycle.ts:314-332`、`632-636` |
| Memory：writeSnapshot/readSnapshot flat hook；read hook 接线时为唯一读权威（`??` 短路）；mirror 实例私有 | `src/memory.ts:36-47`、`68-90` |
| File：`SAFE_PATH_SEGMENT = /^[a-z][a-z0-9-]{0,62}$/`；`users/<userId>/<docId>.snapshot` 布局；mkdir→writeFile tmp→rename 提交；读路径 rm 自身 tmp | `src/file.ts:48`、`106-143` |
| fault seam（wrapIo around-seam）：failNextRead/failNextWrite/holdNextWriteBeforeCommit/AfterCommit/holdNextReadThen；wrap 只拦截 `{read, write}` | `src/testing.ts:702-775` |
| `PersistenceIO` 类型自 index 导出；wrapIo 使用面（仓内）：memory/file/testing + registry-sa7-phase5-dynamic.test.ts:312-351 | `src/index.ts:21`；§9 |

### 3.2 packages/namespace-registry

| 事实 | 锚点 |
|---|---|
| `NamespaceRegistry` 公共面 open/create/getStatus/shutdown；无任何 `implements NamespaceRegistry` 测试 stub（grep 实证） | `src/types.ts:364-385`；§9 |
| 稳定 message 单一真相源常量（types.ts const，不经 index 转出）；主入口值导出**冻结恰九键** | `src/types.ts:47-83`；test/registry-surface.test.ts:57-70 |
| 声明图禁词审计：主入口可达 d.ts 不得含 `NamespaceRuntime`/`DocHandle`/`Y.Doc`/internal subpath | test/registry-surface.test.ts:42-47、180-208 |
| `NamespaceRegistryFatalPhase`（runtime-construction/create-document-internal/lifecycle-slot-internal/namespace-id-generation）；operation 词表 `'open'|'create'|'shutdown'` | `src/types.ts:105-112`；`src/errors.ts:23` |
| entry（generation 永不复用、phase active/idle/closing、I1/I2 不变量）+ carrier FIFO + removeOnlySelf 双守卫 | `src/registry.ts:217-235`、`300-308` |
| open 槽：owner mismatch 第一谓词 → NOT_FOUND（零存在性泄露）；closing 等待 closePromise 后 recheck；loadDoc operational → LOAD_FAILED；factory throw → runtime-construction fatal + handle release 恰一次 | `src/registry.ts:847-924` |
| create attempt 槽：entry 碰撞（任意 phase）→ 重生成；Persistence 错误映射矩阵（DOC_DUPLICATE→retry；operational→CREATE_FAILED；fatal→传播 committed；unknown→fatal false） | `src/registry.ts:1012-1153` |
| lease release 同步失效 + onReleased → idle 武装；idle timer I4 token 判别 | `src/lease.ts:100-114`；`src/registry.ts:720-792` |
| shutdown：carrier tails 等待 + admittedCreates 屏障 + 全量 close 聚合 | `src/registry.ts:1171-1220` |
| `REPLICATION_ID_PATTERN` 本地结构守卫副本（与 runtime 侧互为守卫、注释互引——跨包值导出不可达的既有先例） | `src/registry.ts:147-154` |
| identity：`validateOpenIdentity`（最小安全文法 + key=namespaceId）/`validateOwnerIdentity`/`acceptCreateIdentity`（owner-only，namespaceId 键出现即拒） | `src/identity.ts:109-198` |
| observer 事件联合（11 形，append-only；测试侧仅 push/find，无穷尽 switch——grep 实证） | `src/observer.ts:17-44`；§9 |
| testing 工厂：runtimeFactory/observer/diagnostics/clock/createDocumentFactory/scheduler/idleTimeoutMs/randomBytes 注入面 | `src/testing.ts:29-51` |

### 3.3 packages/namespace-runtime（只读依赖，零改动）

| 事实 | 锚点 |
|---|---|
| `readReplicationFacts`：META 载体缺席/两键真缺席 → disabled；恰一键/undefined 值/格式违约/载体异型 → `ReplicationMetaCorruptError`；双键合规 → enabled | `src/replication-write.ts:213-240` |
| 构造期 V2.5 复制事实预投影（发布前同步读取；损坏 → 构造 throw 零副作用） | `src/runtime.ts:203-217` |
| `REPLICATION_ID_PATTERN = /^[0-9a-f]{32}$/`；公共入口值导出冻结恰一键（`RuntimeWriteFatalError`）——registry/persistence **不可 import** 该函数 | `src/replication-write.ts:54-59`；`src/index.ts:12-22` |
| close barrier：排空已接纳写 → release 恰一次 → 无论成败 lifecycle='closed'；不设内部 timeout | `src/close.ts:34-55`；ADR 0008:93 |

---

## §4 详细设计

### §4.0 公共类型与导出总览（本票新增的完整签名）

#### 4.0.1 packages/persistence/src/contract.ts 新增

```ts
/** Y.Doc 的跨包引用别名（Phase 5）：registry 主入口可达声明图禁止出现 `Y.Doc`
 *  标识符文本（registry-surface.test.ts:42-47 冻结审计），故由本包给出中性命名别名。
 *  类型上恒等于 Y.Doc（别名，非结构复制）。 */
export type YjsDoc = Y.Doc

/** 复制身份引用（N-1 冻结形状）：ADR 0010:46-48 冻结字段的包装。
 *  replicationId 恒 32 位小写 hex；replicationEpoch 恒 >=1 的安全整数
 *  （由各读取器的格式门保证——本类型自身不携带运行时校验）。 */
export interface ReplicationIdentityRef {
  readonly replicationId: string;
  readonly replicationEpoch: number;
}

/** 受控复制导入的身份违约（稳定分类，phase:65「identity mismatch」导入位）。
 *  导入面唯一新增 typed 拒绝；duplicate 复用冻结 DocDuplicateError，
 *  operational/fatal 复用冻结 create 族（§4.3 论证）。 */
export class DocImportIdentityError extends Error {
  readonly code: 'DOC_IMPORT_IDENTITY_MISMATCH' = 'DOC_IMPORT_IDENTITY_MISMATCH';
  constructor(message = 'importDoc identity mismatch: doc META.docId does not match the requested docId') {
    super(message);
    this.name = 'DocImportIdentityError';
  }
}

/** 归档身份前置条件拒绝（单一谓词，§4.5.4：错 id / 错 epoch / 缺失 / 损坏 /
 *  META.docId 不符 统一归本类——SA6 边缘提示 8 裁决为 identity mismatch 族，
 *  不另立第五类 corrupt 码）。 */
export class DocArchiveIdentityError extends Error {
  readonly code: 'DOC_ARCHIVE_IDENTITY_MISMATCH' = 'DOC_ARCHIVE_IDENTITY_MISMATCH';
  constructor(message = 'archiveDoc identity mismatch: the persisted replication identity does not match the expected identity') { /* … */ }
}

/** 归档前置违约：key 仍持有 live handle（phase:63「仅在无有效 handle 时执行」）。 */
export class DocArchiveActiveHandleError extends Error {
  readonly code: 'DOC_ARCHIVE_ACTIVE_HANDLE' = 'DOC_ARCHIVE_ACTIVE_HANDLE';
  constructor(message = 'archiveDoc rejected: the document still has live handles') { /* … */ }
}

/** 归档重复：守卫读取时主键无 committed snapshot（覆盖「已归档后二次归档」与
 *  「从未存在」两形态——SA6 stub 同款语义）。 */
export class DocArchiveDuplicateError extends Error {
  readonly code: 'DOC_ARCHIVE_DUPLICATE' = 'DOC_ARCHIVE_DUPLICATE';
  constructor(message = 'archiveDoc duplicate: no committed snapshot exists under this key') { /* … */ }
}

/** 归档运营失败（guard-read / relocate-write 的 store 级拒绝；committed:false 权威——
 *  两阶段均在提交点之前）。cause 保留 exact 原始失败；message 恒不拼接。 */
export class DocArchiveOperationalError extends Error {
  readonly code: 'DOC_ARCHIVE_OPERATIONAL' = 'DOC_ARCHIVE_OPERATIONAL';
  readonly committed: false = false;
  override readonly cause: unknown;
  constructor(cause: unknown, message = 'archiveDoc operational failure: the store rejected before the archive commit') { /* … */ }
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
});

export class DocArchiveFatalError extends Error {
  readonly code: 'DOC_ARCHIVE_FATAL' = 'DOC_ARCHIVE_FATAL';
  readonly phase: DocArchiveFatalPhase;
  readonly committed: boolean;   // 由冻结映射派生，调用方不得重推导
  override readonly cause: unknown;
  constructor(phase: DocArchiveFatalPhase, cause: unknown, message = 'archiveDoc fatal: internal archive failure') { /* … */ }
}
```

`DocPersistence` 扩展（optional 成员，§4.4 裁决）：

```ts
export interface DocPersistence {
  createDoc(owner: User, docId: string, doc: Y.Doc): Promise<DocHandle>;
  loadDoc(owner: User, docId: string): Promise<DocHandle | null>;
  saveDoc(handle: DocHandle): Promise<void>;
  /**
   * Phase 5 受控复制导入（ADR 0010:65/218）：从 detached、已由调用方核对身份的
   * 完整 Y.Doc 排他创建持久副本。语义 = createDoc 同管线（claim 排他 / 提交点 /
   * handle.doc === doc / 失败不接管 doc）；唯一差异 = META.docId 违约以
   * DocImportIdentityError 稳定分类（createDoc 保持既有 bare error，零回归）。
   *
   * Optional 成员建模（§4.4）：Memory/File 恒提供；第三方 Adapter 可不支持——
   * 复制编排方（Registry）必须 typeof 窄化并对缺席 loud 拒绝，不得静默降级。
   */
  readonly importDoc?: (owner: User, docId: string, doc: Y.Doc) => Promise<DocHandle>;
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
  ) => Promise<Readonly<{ ok: true }>>;
}

/** 具备复制生命周期能力的 Persistence 面（required 形态）：Memory/File 实现；
 *  消费方（测试锚 / 未来 ws-replication）以此表达「必然可达」。 */
export interface ReplicaPersistence extends DocPersistence {
  readonly importDoc: (owner: User, docId: string, doc: Y.Doc) => Promise<DocHandle>;
  readonly archiveDoc: (
    owner: User,
    docId: string,
    expectedReplicationIdentity: ReplicationIdentityRef,
  ) => Promise<Readonly<{ ok: true }>>;
}
```

#### 4.0.2 packages/persistence/src/lifecycle.ts：PersistenceIO 扩展（optional）

```ts
export interface PersistenceIO {
  read(key: string, signal: AbortSignal): Promise<Uint8Array | undefined>;
  write(key: string, snapshot: Uint8Array, signal: AbortSignal): Promise<void>;
  /**
   * Phase 5 归档重定位写：把 snapshot 持久放入该 key 的受控归档位（File：
   * 归档区 mkdir→writeFile tmp→rename；Memory：独立 archiveSnapshots 分区——
   * 不经 writeSnapshot hook，§4.10.1）。公理与 write 同款：resolve ⟺ 归档区
   * 已持有该字节；reject ⟹ 归档区不变；禁同步 throw。**不触碰主键存储**。
   * Optional（§4.4）：Memory/File 恒提供；wrapIo 包装方缺席时 lifecycle 归档
   * 路径 loud 拒绝（契约违约通道，非四分类）。
   */
  writeArchive?(key: string, snapshot: Uint8Array, signal: AbortSignal): Promise<void>;
  /**
   * Phase 5 主键移除（归档重定位第二段）：移除该 key 的主 committed snapshot
   * （File：rm .snapshot（ENOENT 容忍）；Memory：deleteSnapshot hook + mirror）。
   * resolve ⟺ 主键此后缺席；reject ⟹ 移除未完成（状态可能两者之一——由
   * archiveDoc 归入 committed:true fatal，重试收敛，§4.5.5）。不触碰归档区。
   */
  remove?(key: string, signal: AbortSignal): Promise<void>;
}
```

#### 4.0.3 packages/namespace-registry/src/types.ts 新增（含 message 单点表）

```ts
// —— 稳定 message 冻结常量（单一真相源；零插值、零 identity/输入回显）——
export const NAMESPACE_IMPORT_INVALID_IDENTITY_MESSAGE =
  'NAMESPACE_IMPORT_INVALID_IDENTITY: 导入文档缺少合规的复制身份（replicationId/replicationEpoch）';
export const NAMESPACE_IMPORT_IDENTITY_MISMATCH_MESSAGE =
  'NAMESPACE_IMPORT_IDENTITY_MISMATCH: 导入文档 META.docId 与请求 namespaceId 不一致';
export const NAMESPACE_IMPORT_FAILED_MESSAGE =
  'NAMESPACE_IMPORT_FAILED: namespace 受信导入发生运营故障';
export const NAMESPACE_RESET_IDENTITY_MISMATCH_MESSAGE =
  'NAMESPACE_RESET_IDENTITY_MISMATCH: 本地副本复制身份与期望不一致，拒绝重置';
export const NAMESPACE_RESET_FAILED_MESSAGE =
  'NAMESPACE_RESET_FAILED: namespace 重置编排发生运营故障';

/** 复制身份引用（N-1 冻结形状）：自 @nomicore/persistence 转出（类型别名）。 */
export type { ReplicationIdentityRef } from '@nomicore/persistence';

export type ImportReplicaIssue =
  | InvalidIdentityIssue
  | RegistryNotAcceptingIssue
  // R4 注记（SA4 F-1）：NAMESPACE_NOT_FOUND 成员为 R4 补列——R1-R3 文本漏列而 §4.2 伪码
  // owner-mismatch 分支 `return NOT_FOUND_ISSUE` 实际产出该码（设计内部矛盾，发现于 SA3
  // 实现期；SA3 已 additive 追加落位，SA4 F-1 裁决接受该最小调和——INV-10 零存在性泄露优先）。
  // 语义：import 对「他人 live entry 持有该 namespaceId」的 owner mismatch 与 open/reset 同款
  // 零泄露判存（§4.2 ① 第一谓词）。
  | Readonly<{ ok: false; code: 'NAMESPACE_NOT_FOUND'; message: typeof NAMESPACE_NOT_FOUND_MESSAGE }>
  | Readonly<{ ok: false; code: 'NAMESPACE_ALREADY_EXISTS'; message: typeof NAMESPACE_ALREADY_EXISTS_MESSAGE }>
  | Readonly<{ ok: false; code: 'NAMESPACE_IMPORT_INVALID_IDENTITY'; message: typeof NAMESPACE_IMPORT_INVALID_IDENTITY_MESSAGE }>
  | Readonly<{ ok: false; code: 'NAMESPACE_IMPORT_IDENTITY_MISMATCH'; message: typeof NAMESPACE_IMPORT_IDENTITY_MISMATCH_MESSAGE }>
  | Readonly<{ ok: false; code: 'NAMESPACE_IMPORT_FAILED'; message: typeof NAMESPACE_IMPORT_FAILED_MESSAGE }>;

export type ImportReplicaResult =
  | Readonly<{ ok: true; lease: NamespaceLease }>
  | ImportReplicaIssue;

export type ResetReplicaIssue =
  | InvalidIdentityIssue
  | RegistryNotAcceptingIssue
  | Readonly<{ ok: false; code: 'NAMESPACE_NOT_FOUND'; message: typeof NAMESPACE_NOT_FOUND_MESSAGE }>
  | Readonly<{ ok: false; code: 'NAMESPACE_RESET_IDENTITY_MISMATCH'; message: typeof NAMESPACE_RESET_IDENTITY_MISMATCH_MESSAGE }>
  | Readonly<{ ok: false; code: 'NAMESPACE_RESET_FAILED'; message: typeof NAMESPACE_RESET_FAILED_MESSAGE }>
  | Readonly<{ ok: false; code: 'NAMESPACE_LOAD_FAILED'; message: typeof NAMESPACE_LOAD_FAILED_MESSAGE }>;

export type ResetReplicaResult =
  | Readonly<{ ok: true }>
  | ResetReplicaIssue;
```

`NamespaceRegistry` 接口追加（required 成员——registry 无任何测试 stub 实现者，§9）：

```ts
export interface NamespaceRegistry {
  open(owner: NamespaceOwner, namespaceId: string): Promise<OpenNamespaceResult>;
  create(input: CreateNamespaceInput): Promise<CreateNamespaceResult>;
  /**
   * Phase 5 内部受信任 bootstrap 导入（ADR 0010:28/65；phase:62）。保留 Hub
   * namespaceId（不生成、不改写）；在 persistence ownership 转移之前严格核对
   * META 复制身份；排他创建（live entry / committed snapshot / 并发 →
   * NAMESPACE_ALREADY_EXISTS，绝不覆盖/合并）。
   *
   * 信任模型（ADR 0010:79 同款纪律，文档化而非 capability 化）：本入口允许调用
   * 方指定 namespaceId，是「复制 bootstrap 保留 Hub 身份」的授权例外；Host
   * 搭建方负责只把 Registry（及本方法可达面）交给可信复制编排代码，不得把它
   * 暴露为普通客户端写入口。本入口不改变普通 create 的 owner-only 接纳与
   * CSPRNG 生成纪律（SA6 保持性守卫锚）。
   */
  importReplica(owner: NamespaceOwner, namespaceId: string, doc: YjsDoc): Promise<ImportReplicaResult>;
  /**
   * Phase 5 Peer 冲突恢复编排（ADR 0010:57；phase:113）：串行化
   * close → archive → 允许 bootstrap。期望身份由调用方（复制插件）供给、
   * 纯传递给 Persistence 归档守卫（§4.7）；owner/identity race → 稳定拒绝且
   * 零部分删除。成功 ⟹ 该 key 的全部未决 lease 已失效、本地副本已归档、
   * 随后 importReplica 可成功（bootstrap 资格 = key 缺席，无显式标记）。
   */
  resetReplica(owner: NamespaceOwner, namespaceId: string, expectedLocalIdentity: ReplicationIdentityRef): Promise<ResetReplicaResult>;
  getStatus(): NamespaceRegistryStatus;
  shutdown(): Promise<void>;
}
```

`NamespaceRegistryFatalError.operation` 扩展（append-only）：`'open' | 'create' | 'shutdown' | 'reset' | 'import'`（errors.ts:23/29 同步；授权链论证见 §4.11.3）。

`RegistryObserverEvent` 扩展（append-only）：
- `lifecycle-slot-failed` 的 `operation` 字段联合扩为 `'open' | 'create' | 'reset' | 'import'`（observer.ts:27）；
- 新增 `{ type: 'reset-archive-failed'; identity; cause: DocArchiveOperationalError }`（镜像 `create-persist-failed`）；
- 新增 `{ type: 'import-persist-failed'; identity; cause: DocCreateOperationalError }`；
- 新增 `{ type: 'import-runtime-construction-failed'; identity; cause: unknown }`（镜像 `create-runtime-construction-failed`）。

#### 4.0.4 导出面变更

- `packages/persistence/src/index.ts`：+7 值（DocImportIdentityError、DocArchive{Identity,ActiveHandle,Duplicate,Operational,Fatal}Error、DOC_ARCHIVE_FATAL_PHASE_COMMITTED）+4 类型（YjsDoc、ReplicationIdentityRef、ReplicaPersistence、DocArchiveFatalPhase）。persistence 主入口无「恰 N 键」冻结审计（grep 实证；module-graph 仅冻结 barrel 反向引用，test/module-graph-regression.test.ts:39-40）。
- `packages/namespace-registry/src/index.ts`：type-only 追加 `ImportReplicaIssue/ImportReplicaResult/ResetReplicaIssue/ResetReplicaResult/ReplicationIdentityRef`（自 types.js）。**零新增值导出**——registry-surface.test.ts:57-70 九值冻结清单不动。

---

### §4.1（D-1）受信 bootstrap 导入路径的暴露面（N-4）

**裁决：`importReplica` 与 `resetReplica` 是 `NamespaceRegistry` 公共接口的 required 方法**（签名见 §4.0.3）。

依据：
- ADR 0010:222「Registry 仍负责本地 Runtime generation、Lease、**reset/archive 编排**和 Host 生命周期」——编排归属 Registry；`importReplica` 需要完整 Registry 状态（entries/carriers/carrier FIFO），结构上不可能做成独立函数或 internal subpath 工厂。
- phase:62/113 将两能力列为本切片 Registry 侧交付；SA6 类型锚（registry-phase5-bootstrap-reset-surface.test-d.ts:43-61）锚定在 `NamespaceRegistry` 接口上。
- ADR 0009:114「v1 不公开 list、entry status、按 key close」的公共面纪律**不被触碰**：`importReplica`/`resetReplica` 是 ADR 0010:57/65 授权的新编排入口，不是通用按 key 管理面（SA6 surface 绿守卫「无 removeNamespace/deleteNamespace/evict/closeNamespace/forceClose/listNamespaces」逐名核对通过——本设计不新增任何该类成员）。

**信任模型（文档化，ADR 0010:79 同款纪律）**：

ADR 0010:79 对 `lease.openReplicationSession` 冻结的纪律原文是「所有 Lease 都可调用该入口，**不设置不可伪造 capability**；Host 搭建方负责只把 Lease 交给可信代码。API 文档必须明确 raw replication 会绕过 VFSL 业务校验」。受信 bootstrap 导入面对称适用：
1. `importReplica` 允许调用方指定 namespaceId——这是「复制 bootstrap 保留 Hub namespaceId」（0010:28）的**授权例外**，其身份核对（META.docId === namespaceId + 复制事实两键合规）比普通 create 更严；
2. 「受信任」的边界由 **seam 位置**（Registry 公共面，仅 Host 装配可达）+ API 文档表述，而非运行时 capability token；
3. 它不提供任何绕过面：普通 `create` 的 owner-only 接纳（identity.ts:175-198）与 CSPRNG 生成纪律零改动（SA6 保持性守卫「create 恒三键」「ns-+32hex 生成」绿锚）；Persistence 侧 `importDoc` 的 META.docId 校验是第二道独立门。

**被淘汰方案**：
- *internal subpath*（类比 `createNamespaceRuntimeForRegistry`，ADR 0009:18）：导入/reset 需要绑定 Registry 实例闭包（entries/carriers），static 工厂不可行；且 SA6 锚定公共接口名。
- *capability token 参数*（如必须传入仅 internal 可构造的 token）：无任何权威文档要求；引入不可伪造对象机械与 ADR 0010:79 已冻结的「不设置不可伪造 capability」方向相反；迫使 SA6 全部调用面改写。
- *testing 注入面*：受信导入是生产路径而非测试缝，归属错误。

**N-4 回应**：暴露面 = Registry 公共方法 + 文档化信任纪律；防绕过 = ①普通 create 接纳零改动；②导入自身核对严于 create；③Persistence 二道门；④公共面不新增任何通用按 key 管理/删除/枚举成员（SA6 surface 负向守卫）。

### §4.2（D-2）importReplica 输入形态与核对次序（AC-1）

**输入形态裁决：detached 完整 `Y.Doc`**（公共面经 `YjsDoc` 别名，§4.0.1）。谁做 `Y.applyUpdate`？——**不在本票任何 seam 内**：基线字节 → detached Y.Doc 的物化发生在未来 WS 复制插件（切片 6）经 ReplicationSession 的受控读取；本票的 Registry/Persistence 接收已物化的完整 Y.Doc（phase:62「从 detached、已核对身份的完整 Y.Doc 排他创建副本的受控 seam」——seam 的输入就是 Y.Doc 本身）。Registry 全程不做 raw apply（SA8 报告：「本票不做 raw apply，0007 zero-write 管线不受触碰」）。

被淘汰：`Uint8Array` 输入 + Registry 内部 apply——会把字节物化塞进 Registry、模糊 seam，且 SA6 锚（`doc: Y.Doc`，SA6 边缘提示 4 已言明字节输入「仅接口声明与测试调用处微调」）无需改动的路径优先。

**接纳段（R2 增补冻结，SA2 LOW-6）**：`importReplica` 公共入口同步段与 open/reset 同款——`acceptance !== 'running'` → `NOT_ACCEPTING_ISSUE`（零输入访问）→ `validateOpenIdentity(owner, namespaceId)`（复用，identity.ts:109-125）失败 → `NAMESPACE_INVALID_IDENTITY`（零 entries/carriers/Persistence/Runtime 访问）→ 经该 key 的 carrier FIFO 接纳槽。此前置是 File 侧 `validateIdentity`（SAFE_PATH_SEGMENT）在 persistence 层的第二道门的编排侧对应物：invalid 身份在两层的任何一层都被拦截，且都先于任何存储访问。

**核对次序（冻结，全部先于任何 Persistence 调用）**：

```ts
async function runImportReplicaSlot(identity: InternalIdentity, docRef: Y.Doc): Promise<ImportReplicaResult> {
  // ① entry 碰撞（owner 先核对——零存在性泄露，镜像 runOpenSlot:854-856 第一谓词）
  const current = entries.get(identity.key);
  if (current !== undefined && current.owner.userId !== identity.owner.userId) {
    return NOT_FOUND_ISSUE;                    // 复用冻结常量（registry.ts:237-241）
  }
  if (current !== undefined) {
    return ALREADY_EXISTS_ISSUE;               // live entry 形态；active/idle/closing 一律碰撞
  }                                            // （镜像 runCreateAttempt ①，不等待 closePromise）
  // ② 受信身份核对 —— 「persistence ownership 转移之前」（AC-1；ADR 0010:65）
  //   ②a META.docId === namespaceId（0006:50 冻结规则；先于事实核对——
  //       「文档自称是谁」先于「文档的复制身份」）
  if (readMetaDocId(docRef) !== identity.namespaceId) {
    return IMPORT_IDENTITY_MISMATCH_ISSUE;
  }
  //   ②b 复制事实两键（readReplicationFacts 判据族复刻，§4.2.1）
  const facts = readImportedReplicaFacts(docRef);
  if (!facts.ok) {
    return IMPORT_INVALID_IDENTITY_ISSUE;      // 双键缺席（disabled）/ 恰一键 / undefined 值 /
  }                                            // 格式违约 / 载体异型 一律本码
  // ③ 受控复制导入（排他创建）——此后才发生 ownership 转移
  …（§4.3 映射矩阵 + §4.12 构造）
}
```

拒绝时零持久化写入：②在③之前 ⇒ `importCalls === []`、`loadDoc === null`、store 零残留（SA6 REG 四个核对失败用例 + IMP「META.docId ≠ docId → 零持久化写入」锚）。

**docId-先/事实-后的次序论证**：SA6 用例「与期望不符」（foreign docId + 合法事实）→ MISMATCH；「缺失/格式违约」（正确 docId + 坏事实）→ INVALID——本次序对两组用例均产出锚定码；foreign-docId-且-坏事实的组合无锚，冻结为 docId 先行（身份锚定先于身份质量）。

#### 4.2.1 Registry 侧复制事实读取器（判据单点的落地形态，N-1）

`readReplicationFacts`（replication-write.ts:213-240）**不可 import**：runtime 公共入口值导出冻结恰一键（runtime/src/index.ts:12-22；runtime-acceptance-exports-audit.test.ts 审计）。落地 = registry.ts 新增私有读取器 `readImportedReplicaFacts(doc): { ok: true; replicationId: string; replicationEpoch: number } | { ok: false }`，**判据逐条复刻** readReplicationFacts：

- `doc.share.has('META')` 缺席 → ok:false（导入要求 enabled；载体缺席属「无复制身份」）；
- `meta.has('replicationId')` / `meta.has('replicationEpoch')` 键存在性判别（Yjs `set(k, undefined)` 后 `has()===true` 的可持续损坏形态不得与键缺席同判——replication-write.ts:200-208 冻结判据）；两键真缺席 → ok:false；恰一键 → ok:false；
- `replicationId` 非 string 或不匹配 `REPLICATION_ID_PATTERN`（registry.ts:153 本地副本复用）→ ok:false；
- `replicationEpoch` 非 number / 非 `Number.isSafeInteger` / `< 1` → ok:false（含 `Number.NaN` 用例）；
- `getMap('META')` 载体异型（throw 收编）→ ok:false。

**单一事实源纪律**：判据的**语义源**是 readReplicationFacts（ADR 0008:132 冻结两态/损坏判据）；实现上是与 `REPLICATION_ID_PATTERN` 同款的「结构守卫副本」（registry.ts:147-154 既有先例：跨包值导出不可达 ⟹ 本地副本 + 注释互引）。本票在该先例下新增第二处消费（persistence 侧归档守卫，§4.5.4），三处副本互引注释；测试面由 SA6 的格式违约三分支用例（'z'×32 / epoch 0 / NaN）锚定不漂移。被淘汰：从 runtime 包导出 readReplicationFacts（击穿值导出恰一键冻结审计 + 扩张 namespace-runtime 包——DENY 清单文件）。

**TOCTOU 声明（诚实边界，非降级）**：输入 `Y.Doc` 是调用方拥有的活对象；核对是时点读，`encodeStateAsUpdate` 在 Persistence claim 内另取一次字节——两次读之间调用方变异 META 的窗口与既有 `createDoc`（validateCreateDoc → encode，lifecycle.ts:181-241）完全同构，属既有接受面；防御纵深 = Persistence `importDoc` 入口二次校验 META.docId（§4.3）+ `loadDoc.restoreAndValidate`（lifecycle.ts:490-499）对持久字节的最终校验。本设计不承诺输入快照原子性（与 createDoc 同一诚实边界，文档化而非伪称消除）。

### §4.3（D-3）Persistence 导入 seam：importDoc（AC-2）

**签名（冻结）**：`importDoc(owner: User, docId: string, doc: Y.Doc): Promise<DocHandle>`（接口上 optional，§4.4；Memory/File 实现为真实方法）。

**与 createDoc 的关系 = 同一管线的复用，不是镜像重写**：ADR 0006:157-159「两 Adapter 不得复制状态机」。lifecycle.ts 将 createDoc 的 claim 环 + 提交段抽出为私有 `exclusiveCreate(owner, docId, doc, op: 'create' | 'import')`：

```ts
private async exclusiveCreate(owner, docId, doc, op): Promise<DocHandle> {
  this.assertWritable();
  // 身份校验单点分叉（唯一差异位）：
  //   op==='create' → validateCreateDoc（既有 bare Error，lifecycle.ts:456-461，零回归）
  //   op==='import' → validateImportDoc（META.docId !== docId → DocImportIdentityError）
  // ——均先于 claim、先于任何 io 访问（IMP「零持久化写入」锚）
  // claim 环（187-226 逐字节复用）：live/creating → duplicate；reading → await raw 证据
  //   （见快照即拒——绝不覆盖已提交内容，0006:121-123）；空 → 自探读
  // 提交段（229-274 逐字节复用）：creating claim 先置 → snapshot-encode fatal 分类 →
  //   io.write（store-write 分类）→ 提交点（write resolve）→ entry 落位 → handle
}
async createDoc(owner, docId, doc) { return this.exclusiveCreate(owner, docId, doc, 'create'); }
async importDoc(owner, docId, doc) { return this.exclusiveCreate(owner, docId, doc, 'import'); }
```

**错误分类（完整通道）**：

| 阶段 | 拒绝值 | 分类依据 |
|---|---|---|
| META.docId ≠ docId | `DocImportIdentityError`（code `DOC_IMPORT_IDENTITY_MISMATCH`） | phase:65 identity mismatch 稳定分类；006:50 冻结规则；SA6 IMP 锚 `rejects.toMatchObject({code})`；失败不接管 doc、零缓存、零 store 写入 |
| cache 命中 / store 见快照 / 并发 claim | `DocDuplicateError`（code `DOC_DUPLICATE`，冻结类复用） | 0006:121-123 三判定；SA6 IMP 三用例 `rejects.toThrow(DocDuplicateError)`；「duplicate 分类对齐 DOC_DUPLICATE 先例」= SA6 §4.2 建议 |
| encode 内部失败 | `DocCreateFatalError('snapshot-encode')`（committed:false） | 既有冻结族复用 |
| store 写拒绝（current epoch） | `DocCreateOperationalError`（committed:false） | 既有冻结族复用 |
| store 写被 dispose 终结 | `DocCreateFatalError('store-write')`（committed:false） | 既有冻结族复用 |
| 提交点后失败 | `DocCreateFatalError('post-commit')`（committed:true） | 既有冻结族复用 |

**create 族复用的取舍理由（被淘汰：平行 import 族）**：导入在文档词汇里就是「排他创建」（phase:62「排他创建副本」；0006 修订节同族），管线逐字节相同 ⟹ 失败拓扑相同；并行 DocImportOperational/DocImportFatal 族只会复制 4 个类与 phase 词表，零锚定需求（SA6 import 用例对 operational/fatal 零断言）。代价 = 该族 message 文本含「createDoc」字样——仓库纪律是「callers branch on code, never message text」（contract.ts:44），code（`DOC_CREATE_OPERATIONAL` 等）语义对导入同样成立；message 冻结不可改（EC3/EC5/EC7 用例逐字断言）。接受并文档化。Registry 侧将其映射为 `NAMESPACE_IMPORT_FAILED`（§4.11），公共面不外泄 create 字样歧义。

**是否校验导入 doc 的复制身份（防御纵深，设计点 3 子问）**：**否**——Persistence 持久层校验面冻结为「仅 META.docId === docId」（ADR 0006:132「持久层仍仅校验 META.docId === docId，不校验 VFSL/ROOT/createdAt」；0010/phase 均未扩张）。复制身份核对的权威在受信 Registry 路径（AC-1 把核对放在 ownership 转移之前的编排层）；Persistence 低于 Registry 的复制纪律层，不是其执行点（「Persistence 不增加跨 owner catalog」同款层级谦抑）。两道独立 docId 门（Registry ②a + Persistence validateImportDoc）即防御纵深；读到损坏身份（Persistence 视角不存在——它不读复制键）不产生新分类。

**排他机械的并发性**：importDoc 与 createDoc/loadDoc 共享同一 cell 协调——「import 后 createDoc 仍 DOC_DUPLICATE」「同 key 并发两导入恰一成功」「create 探读等待在途 load 证据」全部由既有机械免费成立（SA6 IMP 三用例）。

### §4.4（D-4）接口扩展形态：optional 成员 + 派生接口 + loud capability gate

**裁决**：`DocPersistence` 与 `PersistenceIO` 的新成员均为 **optional**；保证面由派生接口 `ReplicaPersistence`（required）表达；消费方以 `typeof` 窄化并对缺席 loud 拒绝。

**理由（三条硬事实 + 一条立法）**：

1. **13 个既有测试类 `implements DocPersistence`**（§1.3-1，grep 清单见 §9）：required 成员 ⟹ 全部 TS2420 ⟹ tsconfig.typecheck.json 红 ⟹ 既有套件回归。技能「契约改动连锁审计」立法原文：「若 caller 数 > 10，应反思是否应改契约（可能更适合**新建函数/类型**而非修改原函数契约）」——13 > 10，立法直接指向本裁决。
2. **SA6 surface 绿守卫字面量**（persistence-phase5-archive-surface.test-d.ts:77-86 以三成员字面量满足 `DocPersistence`）：required 成员 ⟹ TS2741 ⟹ 该「基线已绿、预期保持绿」的守卫变红——违反 SA6 §4.3 保持性声明。optional 成员下三成员字面量仍合法，守卫零改动。
3. **registry-sa7-phase5-dynamic.test.ts:312-351 既有 wrapIo 字面量**只含 `{read, write}`：PersistenceIO required 成员 ⟹ 编译红。optional 下该字面量仍满足接口（成员可缺席）。
4. **语义正当性**：第三方 Persistence Adapter 是 ADR 0006:86-92 冻结的演进位（「以不改变 DocPersistence Interface 的 Adapter 内部替换实现」）；复制导入/归档是 Phase 5 新能力——「Adapter 可不具备复制能力、复制编排方必须显式应对缺席」是比「全体 Adapter 强制实现」更诚实的模型（与 DocHandle 可选能力、ADR 0010:79 信任纪律同构）。

**Anchor 兼容性代价与回流（R-2，必须）**：optional 成员使 SA6 的两个类型红锚 `HasArchiveDoc<DocPersistence>` / `HasImportDoc<DocPersistence>`（`T extends {readonly archiveDoc: …}` 对 optional 成员不可赋值）**无法转绿**——锚必须改指 `ReplicaPersistence`。这是锚与「13 stub + 三成员绿守卫零回归」的内在冲突（锚文件自身同时要求「DocPersistence 有两方法」与「三成员字面量是合法 DocPersistence」——required 形态下二者矛盾）。权威文档（phase:62-63、0010:218）从未指名接口，故按总控规则提出 **SA6 回流 R-2** 而非改设计迁就锚：persistence-phase5-archive-surface.test-d.ts 两个红锚的类型参数 `DocPersistence` → `ReplicaPersistence`（+ 一行 `import type { ReplicaPersistence }`；运行时锚 `asArchive(...)` 全部不变）。

**loud capability gate（拒绝虚假降级立法的落地）**：

```ts
// registry.ts —— 槽内（已过 acceptance/identity 检查）：
const importDocFn = persistence.importDoc;            // 类型：((…)=>…) | undefined
if (typeof importDocFn !== 'function' || typeof persistence.archiveDoc !== 'function') {
  dispatchObserver(observer, { type: 'lifecycle-slot-failed', identity, operation: 'import' /* 或 'reset' */, cause });
  throw new NamespaceRegistryFatalError('import' /* 'reset' */, 'lifecycle-slot-internal', false,
    new Error('persistence adapter 缺少复制生命周期能力（importDoc/archiveDoc）——受信导入/重置编排要求 ReplicaPersistence 级 Adapter'));
}
// typeof 窄化后调用（TS 属性窄化成立，无 cast）：
const handle = await importDocFn.call(persistence, owner, namespaceId, docRef);
```

三处 loud capability gate 的**精确放置点（R3 对齐，SA2 LOW-R2-1——消除 §4.4 与 §4.5.5 的放置歧义）**：

| gate | 精确位置 | 时机语义 |
|---|---|---|
| Registry gate | `importReplica`/`resetReplica` **槽内同步段**（acceptance/identity 检查之后、首次 Persistence 调用之前，上伪码） | 编排层前置：capability 缺席时零 Persistence 触达（含 reset 的 close 段——gate 先于槽内一切持久化动作） |
| lifecycle gate | `archiveDoc` **公共入口同步段**（`assertWritable()` 之后、`track`/settle 之前，§4.5.3 伪码入口行） | capability 缺席**立即**拒绝（bare loud Error）——不进入 settle 排空等待、不建 archiving cell；op 体内的 `this.io.writeArchive!`/`this.io.remove!` 非空断言由该入口 gate 背书：`io` 于 adapter 构造期成型、运行期不可变（memory.ts:68-90/file.ts:64-73），入口单查覆盖整个调用全程，无需 op 体内重查 |
| Memory gate | `baseIo.remove` **体内**（归档移除段执行时，§4.10 伪码） | 最晚到达点：`readSnapshot` 接线且 `deleteSnapshot` 缺席才可能命中（晚于 writeArchive），命中即该实例归档路径的诚实终局 |

lifecycle gate 细则：`archiveDoc` 入口检查 `this.io.writeArchive`/`this.io.remove`（二者任一缺席 → 整体拒绝，不写半归档），缺席 → **bare loud Error**（稳定 message，io seam 契约违约通道——与「persistence is disposed」同款非四分类通道；不伪装为 operational）。生产 Memory/File 恒具备；13 个旧 stub 永不触达导入/重置路径 ⟹ 永不触发 gate ⟹ 零回归。

### §4.5（D-5）archiveDoc 生命周期语义与状态机（AC-3/AC-5/AC-6）

**签名（冻结）**：`archiveDoc(owner: User, docId: string, expectedReplicationIdentity: ReplicationIdentityRef): Promise<Readonly<{ ok: true }>>`——拒绝经 typed rejection（SA6 ARC 全部以 `rejects.toMatchObject({code})` 锚定）。File 侧入口先 `validateIdentity`（SAFE_PATH_SEGMENT 双段，file.ts:128-131 同款）；Memory 直接委托。

#### 4.5.1 cell 状态机扩展

```ts
type Cell =
  | { state: 'reading'; read: ReadTicket }
  | { state: 'creating'; claim: KeyClaim }      // CreateClaim 更名 KeyClaim（create/import 共用后名副其实）
  | { state: 'live'; entry: LiveEntry }
  | { state: 'archiving'; claim: KeyClaim };    // 新增：归档排他 claim（settle 后置位，commit 段持守）
```

- `resolveLoad`（lifecycle.ts:357-369）与 `exclusiveCreate` claim 环各新增 `archiving` 分支：**等待 claim.promise 后重评估**（load 重读 → 归档后得 null；create/import 探读 → 主键已删则正常创建）。绝不因归档在途而制造伪 duplicate。
- LiveEntry 新增 `archiveWaiters: Array<() => void>`（§4.5.2 的排空通知面）。

#### 4.5.2 settle 段（「无有效 handle / Runtime generation」的完整语义）

phase:63「仅在无有效 handle/Runtime generation 时执行」必须涵盖**在途 dirty flush 窗口**：零-handle-but-dirty entry 若直接归档，pending flush 会在归档后把主键 snapshot **写回**（复活文档 + 击穿后续 importDoc 排他）。settle 段把该窗口显式排空：

```ts
private async settleEntryForArchive(key: string): Promise<void> {
  for (;;) {
    const cell = this.cells.get(key);
    if (cell?.state !== 'live') return;                       // reading/creating/archiving 由调用环处理
    const entry = cell.entry;
    if (entry.handles.size > 0) throw new DocArchiveActiveHandleError();
    if (entry.retryTimer === undefined) {
      if (!entry.flushing && entry.savedGeneration === entry.dirtyGeneration) {
        this.clearTimers(entry); this.cells.delete(key); entry.doc.destroy();   // 干净零-handle entry：镜像 maybeEvict（590-596）当场驱逐
        return;
      }
      if (!entry.flushing) this.startFlush(entry);            // ★ 强制即时 flush——跳过 debounce 定时器
    }                                                          //（retryTimer 在武装 ⟺ degraded 回退窗——尊重回退，被动等待，不热循环失败 store）
    await new Promise<void>((resolve) => { entry.archiveWaiters.push(resolve); });
  }                                                            // flush().finally 无条件通知 waiters（含 dispose-abort 轮）
}
```

- **排空通知机制（R2 规格化，SA2 BLOCKER-1）——两个无条件通知点 + 全程 track**：
  1. **flush() 的 finally 追加通知语句，无条件置于 finally 首位**（先于 `if (!this.isCurrent(epoch)) return` 早退，先于 `flushing=false`/reschedule/maybeEvict）：`const waiters = entry.archiveWaiters.splice(0); for (const w of waiters) w();`。更正 R1 文本「先于 isCurrent 早退、在 maybeEvect 之后」的矛盾表述——现行 finally（lifecycle.ts:565-577）中早退**先于** maybeEvict，单条语句无法同时满足；置于首位是唯一同时覆盖「正常轮」与「dispose-abort 早退轮」的位置。零回归论证：非归档路径 `archiveWaiters` 恒空（仅 settle 填充）⟹ splice 空数组为 no-op、零观测差异；归档路径下 resolve 仅把 waiter 续体排入微任务队列，finally 其余语句在同一同步段先行完成 ⟹ waiter 醒来时观察到的是 flush 终态（flushing=false、已/未驱逐），settle 重检正确。
  2. **dispose()（lifecycle.ts:314-332）同步段增补**：在 `abortController.abort()` 之后的 live-entry 清理循环内（`clearTimers(entry)` 之后、`cells.clear()` 之前的同一同步块），对每个 live entry 执行同款 `archiveWaiters.splice(0).forEach(w => w())`。该通知**不依赖任何未来 flush**——degraded retry 武装 + 零在途 flush 的交错下（retry timer 刚被 clearTimers 取消、flush finally 永不再运行），waiter 仍被此路径唤醒；waiter 续体是微任务，运行时 dispose 同步段（含 `cells.clear()`）已完成 ⟹ settle 重检见 cell 缺席而退出循环，claim 段以 bare disposed 错误收口（见 §4.5.3 的 assertWritable 位置）。
  3. **归档全程纳入 inFlight 记账**：`archiveDoc` 公共入口把「settle 环 → claim 环 → op 体」整体包进 `this.track(...)`（§4.5.3 重写后的结构）——dispose 的 `await Promise.allSettled([...inFlight])` 因此覆盖归档全程；由于通知点 2 在 dispose 同步段（allSettled 之前）执行，被跟踪的 archiveDoc promise 必然在 allSettled 等待期间结算，**无自等待死锁**（dispose 等 archiveDoc 结算 ⟸ archiveDoc 等 dispose 的通知 ⟸ 通知先于等待发生）。
- **debounce 跳过的确定性论证**：强制路径直调 `startFlush`（不经 `scheduler.setTimeout`）⟹ fake-scheduler 测试无需 advanceBy 即可排空；degraded（retryTimer 武装）时被动等待回退轮（真实 timer 驱动）——诚实 pending，不绕过 retry（N-5：「不得以 reset 之名绕过 retry」）；dispose 打断该 pending 的机制即上述通知点 2。
- **归档内容 = 写后终态**：settle 排空 ⟹ guard-read 读到的字节含全部已接纳写的最终 flush（SA6 REG「在途 ROOT 写 + reset」锚的语义在真实 persistence 下的保证；stub 侧由 doc 引用共享直接满足）。

#### 4.5.3 claim 段（R2 重写：全程 track + dispose 竞态收口 + 失败路径善后）

```ts
async archiveDoc(owner, docId, expected): Promise<Readonly<{ ok: true }>> {
  this.assertWritable();
  this.assertArchiveIo();               // ★ io capability gate（§4.4 放置点表：入口同步段、track/settle 之前；
                                        //   writeArchive/remove 任一缺席 → bare loud Error；op 体内的
                                        //   io.writeArchive!/io.remove! 非空断言由此背书——io 构造期成型不可变）
  const key = toKey(owner, docId);
  return this.track(this.runArchiveDoc(key, owner, docId, expected));   // ★ 全程 inFlight 记账（BLOCKER-1 ③）
}

private async runArchiveDoc(key, owner, docId, expected): Promise<Readonly<{ ok: true }>> {
  const epoch = this.epoch;
  for (;;) {
    await this.settleEntryForArchive(key);
    this.assertWritable();               // ★ dispose 竞态收口：settle 苏醒后、置 archiving cell 前重检
                                          //   （closed ⟹ bare Error('persistence is disposed')，无 cell 可清理）
    const cell = this.cells.get(key);
    if (cell?.state === 'reading') { await cell.read.completion.catch(() => {}); continue; }
    if (cell?.state === 'creating' || cell?.state === 'archiving') { await cell.claim.promise; continue; }
    break;                                                     // cell === undefined
  }
  const claim: KeyClaim = { promise: undefined! };
  this.cells.set(key, { state: 'archiving', claim });
  const op = (async () => {
    try {
      /* guard-read → verify → relocate（§4.5.4/§4.5.5 逐字） */
      const done = this.cells.get(key);                                    // 成功路径善后
      if (done?.state === 'archiving' && done.claim === claim) this.cells.delete(key);
      return Object.freeze({ ok: true as const });
    } catch (err) {                                                         // ★ 失败路径善后（BLOCKER-2）
      const cur = this.cells.get(key);                                      //   逐字节镜像 createDoc 范型
      if (cur?.state === 'archiving' && cur.claim === claim) {              //   （lifecycle.ts:263-268：
        this.cells.delete(key);                                             //    identity 守卫防 ABA——绝不误删
      }                                                                     //    后来者建立的新 cell）
      throw err;                                                            //   rethrow 原拒绝（分类不变）
    }
  })();
  claim.promise = op.then(() => undefined, () => undefined);
  return op;
}
```

**失败善后的机械保证（SA2 BLOCKER-2）**：任何拒绝（identity/operational/fatal/disposed 后续段/seam 违约 bare error）与成功返回**都**以 `cur?.state === 'archiving' && cur.claim === claim` 守卫清理 archiving cell 后才结算——此后 `cells` 不残留已结算 claim 的 archiving 态，`resolveLoad`/`exclusiveCreate` 的 archiving 分支「await claim.promise 后重评估」不会陷入「await 已 settle 的 promise × cell 仍在」的无限微任务循环；同 key 后续 `loadDoc` 正常建 entry、`createDoc/importDoc` 正常探读（见快照即 DOC_DUPLICATE、见缺席即创建）。ARC 五锚（:280/:305/:331/:442/:549——归档拒绝后立即 loadDoc 断言非 null）由此机械转绿；INV-6「identity mismatch 后文档完好可 open」在真实 persistence 下成立。前置入口 `assertWritable`（两处）在**置 cell 之前**抛出，无 cell 需要清理；`settleEntryForArchive` 抛 `DocArchiveActiveHandleError` 时 cell 仍是原 live 态（无 archiving cell 被建立）——同样无毒化面。

#### 4.5.4 guard-read 与身份核对（单一谓词，SA6 边缘提示 8 裁决）

```ts
// guard-read：身份核对读经 io.read（SA6 边缘提示 2 的最低要求之上——本设计归档写也经 seam，§4.6）
let bytes: Uint8Array | undefined;
try { bytes = await this.io.read(key, this.abortController.signal); }
catch (err) { throw this.isCurrent(epoch) ? new DocArchiveOperationalError(err)
                                          : new DocArchiveFatalError('guard-read', err); }
if (bytes === undefined) throw new DocArchiveDuplicateError();

// verify：scratch 解码 + 单一身份谓词（字节复用——归档写回写「已核对的同一份字节」，不重编码）
const scratch = new Y.Doc();
try { Y.applyUpdate(scratch, bytes); } catch (err) { throw /* 损坏 → */ new DocArchiveIdentityError(/* cause: err */); }
try {
  const metaDocId = scratch.getMap('META').get('docId');
  if (metaDocId !== docId) throw new Error('docId');                    // 0006:50 规则的归档侧应用
  const facts = readPersistedReplicaFacts(scratch);                      // readReplicationFacts 判据族复刻（REPLICATION_ID_PATTERN 本地副本 #2）
  if (!facts.ok
    || facts.replicationId !== expected.replicationId
    || facts.replicationEpoch !== expected.replicationEpoch) throw new Error('identity');
} catch { throw new DocArchiveIdentityError(); }
finally { scratch.destroy(); }
```

**单一谓词裁决**：错 id / 错 epoch / 两键缺席 / 恰一键 / undefined 值 / 格式违约 / 载体异型 / META.docId 不符 → **统一 `DOC_ARCHIVE_IDENTITY_MISMATCH`**。理由：①phase:65 冻结**四**分类，不另立第五 corrupt 码；②调用方补救动作同一（检查/修复，绝不归档）；③SA6 损坏用例只锚「拒绝 + 零改动」（`.rejects.toThrow()`），identity 族满足。**同 id 不同 epoch 算 mismatch**（CONTEXT:121-123「相同复制谱系但 epoch 不同 ⟹ 冲突，必须显式 reset」——epoch 是身份谓词的组成分量；SA6 ARC「epoch 不符同拒」锚）。

#### 4.5.5 relocate 段（提交点 = 归档写 resolve）

```ts
try { await this.io.writeArchive!(key, bytes, this.abortController.signal); }
catch (err) { throw this.isCurrent(epoch) ? new DocArchiveOperationalError(err)
                                          : new DocArchiveFatalError('relocate-write', err); }
// —— 提交点跨越：归档区已持有已核对字节 ——
try { await this.io.remove!(key, this.abortController.signal); }
catch (err) { throw new DocArchiveFatalError('relocate-remove', err); }   // committed:true
// 成功路径善后：cells.get(key) 仍为本 claim 才删（§4.5.3 catch 同款 identity 守卫）；resolve Object.freeze({ ok: true })
```

**remove 失败的 committed:true 论证**：归档写已 resolve（写公理 ⟹ 归档区不变式成立），主键移除未完成 ⟹ 状态 = 双副本并存。`DocCreateOperationalError` 族的 `committed` 是 `false` 字面量（contract.ts:97）——committed 的运营错误在该族形状上不可表达 ⟹ 归入 fatal 族（与 create 的 post-commit 纪律同构：W4/W5 一切失败 committed:true）。**收敛性**：重试 archiveDoc 是安全且收敛的（主键仍在 ⟹ 非 DUPLICATE；身份复验通过 ⟹ 归档写幂等覆盖 ⟹ 再删主键），在 fatal 文档中明示「调用方可重试收敛」——这不违反「上层不得自动重试非幂等写」纪律（archiveDoc 幂等）。

#### 4.5.6 失败通道矩阵（archiveDoc 全集；R2 增补「archiving cell 善后」列——SA2 BLOCKER-2）

| 触发 | 拒绝值 | store 状态 | archiving cell 善后（identity 守卫清理，§4.5.3） |
|---|---|---|---|
| settle：live entry 有 handle | `DocArchiveActiveHandleError` | 零变化 | 未建立（cell 保持原 live 态） |
| 前置/竞态：persistence disposed（settle 苏醒后 assertWritable） | bare Error('persistence is disposed') | — | 未建立（置 cell 前抛出） |
| guard-read：主键无快照（已归档/从未存在） | `DocArchiveDuplicateError` | 零变化；首次归档事实完整保留 | **已清理**（catch 侧守卫删除） |
| guard-read：store 读拒绝（current epoch） | `DocArchiveOperationalError`（committed:false，cause 保留） | 零变化（SA6 failNextRead 锚） | **已清理**（同上） |
| verify：任何身份偏差（4.5.4 单一谓词） | `DocArchiveIdentityError` | 零变化（逐字节断言锚） | **已清理**（同上） |
| relocate-write 拒绝（current epoch） | `DocArchiveOperationalError`（committed:false） | 零变化（写公理；SA6 failNextWrite 锚） | **已清理**（同上） |
| guard-read / relocate-write 被 dispose 终结 | `DocArchiveFatalError(guard-read \| relocate-write, committed:false)` | 零变化 | **已清理**（同上） |
| relocate-remove 失败/被终结 | `DocArchiveFatalError(relocate-remove, committed:true)` | 归档副本在、主键可能仍在；重试收敛 | **已清理**（同上——key 不毒化是「重试收敛」可达的前提） |
| io seam 缺 writeArchive/remove | bare loud Error（契约违约通道） | 零变化 | **无 cell 可清**（R4 更正 SA4 F-3：lifecycle gate 位于入口同步段、置 cell **之前**——§4.4 放置点表；R2/R3 文本「已清理（同上）」与放置点表失同步，按表更正） |
| 成功返回 | `{ ok: true }`（冻结） | 主键移除 + 归档区持有已核对字节 | **已清理**（成功路径守卫删除，key 缺席 = bootstrap 资格） |

「已清理」一律指 `cur?.state === 'archiving' && cur.claim === claim` 守卫命中才删（镜像 lifecycle.ts:263-268；守卫失配 = 已有后来者建立新 cell，不删）。**推论（INV-14）**：任何结算路径退出后 `cells` 不残留已结算 claim 的 archiving 态 ⟹ 同 key 后续 loadDoc/createDoc/importDoc 的 archiving 分支 await 后重评估必然见到非 archiving 态（undefined/live/reading），无无限循环面。

#### 4.5.7 并发矩阵（archiveDoc × 其它操作）

| 交错 | 行为与依据 |
|---|---|
| archive ∥ loadDoc（在途 reading） | claim 环等待 read.completion 后重评估；归档完成后 load 重探 → null（「归档后 loadDoc → null」跨实例成立） |
| archive ∥ createDoc/importDoc（在途 creating） | 等待 claim 后重评估；归档先 ⟹ 探读 undefined ⟹ 正常创建（reset→bootstrap 的 persistence 侧闭环）；创建先 ⟹ archive 探读见快照 → 身份核对裁决 |
| archive ∥ archive | 第二个等待 archiving claim → guard-read undefined → `DOC_ARCHIVE_DUPLICATE`（首次归档完整保留，SA6 锚） |
| archive ∥ saveDoc/flush（零-handle dirty） | settle 强制排空（跳 debounce、尊重 retry 回退）→ 归档字节 = 写后终态 |
| archive ∥ 新 loadDoc 取得 handle | settle 循环重检 handles>0 → `DOC_ARCHIVE_ACTIVE_HANDLE`（诚实拒绝，调用方释放后重试） |
| archive ∥ dispose | 同步段通知 waiters（§4.5.2 通知点 2）+ flush finally 首位通知（通知点 1）+ 全程 track（通知点 3）⟹ archiveDoc 必然有限结算（bare disposed 或 epoch fatal），dispose/registry shutdown 不挂起；推演见修订记录 B1 |
| registry reset ∥ open（同 key） | Registry carrier FIFO 串行（§4.8.4）；persistence 侧无交错窗口 |
| registry reset ∥ idle timer / shutdown | §4.8.4 |

### §4.6（D-6）归档提交段的 io seam 路由（SA6 边缘提示 2 裁决）

**裁决：归档写 = `io.writeArchive`（独立方法），fault seam 将其并入既有 write 故障/hold 槽；主键移除 = `io.remove`（seam 透传）。**

SA6 的 hold/fail-write 两用例**强制**归档提交写经 seam 的 write 通道（`holdNextWriteBeforeCommit` 必须 engage；`failNextWrite` 必须使归档以 `DOC_ARCHIVE_OPERATIONAL` 拒绝且目录树零变化）。满足方式二选一：

- (a) 魔法 archive key + 复用 `io.write`：lifecycle 以派生 key（如 `archive\0…`）调 write，adapter 解析 key 命名空间——被淘汰：字符串命名空间是隐式契约，File/Memory/wrapIo 包装方都要解析魔法前缀；PersistenceIO 公理文档（lifecycle.ts:15-44）会复杂化；
- (b) **显式 `writeArchive` 方法 + seam 内并入 write 故障槽**（采纳）：契约显式（「不触碰主键」是方法级承诺）；testing.ts 的 wrap 对 writeArchive 走与 write 相同的 `failWrite`/`holdWriteBeforeCommit`/`holdWriteAfterCommit` 槽位（含 `signal.throwIfAborted()` 自检后转调内层 io）；remove 透传（本票不新增 remove 故障槽——无锚定需求，未来按需 append）。

**SA6 建议方案 (a')「移除为 adapter 内提交段（不经 io）」被淘汰的理由**：remove 若内联在 writeArchive 的提交段内，其失败必须被写公理吞为 resolve（completion ⇒ resolve）——主键残留被静默吞掉 = 虚报「归档完成」（拒绝虚假降级立法）；独立 `io.remove` 让移除失败诚实地浮出为 committed:true fatal（§4.5.5）。

**「原子 rename」语义（phase:64）**：File 的 writeArchive 内部 = mkdir → writeFile(tmp) → rename(tmp → 归档 .snapshot)——归档文件的出现是原子的（tmp→rename 纪律，ADR 0006:52 同款），与既有 flush 提交同构；跨「归档写 + 主键删」两步不声称单文件系统操作原子性（由失败分类 + 收敛重试保证，4.5.5）。

### §4.7（D-7）expectedLocalIdentity ↔ expectedReplicationIdentity 映射（N-1）

1. **形状冻结**：两者是同一类型 `ReplicationIdentityRef = Readonly<{ replicationId: string; replicationEpoch: number }>`（字段与域由 ADR 0010:46-48 冻结：32 位小写 hex / ≥1 安全整数）。单一类型定义于 persistence contract.ts，registry types.ts 转出——两个参数名是同一形状的两个角色名，不引入第二种包装。
2. **推导关系冻结：Registry 纯传递，不做 close 前本地事实预检**。`resetReplica` 把调用方（复制插件——它知道自己管理的身份）供给的 `expectedLocalIdentity` 原样传给 `archiveDoc.expectedReplicationIdentity`。理由：
   - 守卫的**权威比对对象**是持久快照的复制事实（archiveDoc 内部、settle 排空后读取）——这是唯一能安全放行删除的判据点；
   - 若 Registry 在 close 前另比 live 投影（entry.runtime status.replication），live 事实可能领先持久事实（dirty 未 flush）⟹ 预检通过与守卫拒绝仍可先后发生 ⟹ 预检不能取消守卫，只是冗余的第二判据点（N-1 明令「不得另立第二套判据」）；
   - settle 排空（§4.5.2）使「close 后 Runtime 已不可读、事实取自何处」的问题消解：守卫读的是**排空后的持久快照**，其事实 = 最后已提交的 live 事实。SA6 §6.1 的双读法前置（enable 后 kick/waitDurableSnapshot 或 store 解码验证）在持久读法下确定性成立；若 SA3 未来选内存读法（不采纳），该前置亦无害。
3. **epoch 在谓词中的角色**：同 id 不同 epoch = mismatch（§4.5.4；CONTEXT:121-123 冲突定义）。
4. **race 语义**：调用方观察身份 t₀ 与归档守卫执行 t₁ 之间，若本地副本被换（并发 import/bump 后 flush），守卫以 t₁ 的持久事实拒绝 ⟹ `NAMESPACE_RESET_IDENTITY_MISMATCH` + 零删除（AC-4「identity races without partial deletion」的精确机制——拒绝即未删）。

### §4.8（D-8）resetReplica 编排（AC-4，N-2）

**接纳段（公共入口同步段，镜像 open）**：`acceptance !== 'running'` → `NOT_ACCEPTING_ISSUE`；`validateOpenIdentity(owner, namespaceId)`（复用，identity.ts:109-125）失败 → `NAMESPACE_INVALID_IDENTITY`；随后经该 key 的 carrier FIFO 接纳槽（与 open/create 同一串行域）。

**槽内编排（冻结次序）**：

```ts
async function runResetReplicaSlot(identity, expected): Promise<ResetReplicaResult> {
  // ① owner 核对（零存在性泄露；镜像 runOpenSlot:854-856 第一谓词）
  const current = entries.get(identity.key);
  if (current !== undefined && current.owner.userId !== identity.owner.userId) return NOT_FOUND_ISSUE;

  // ② close：关闭本地 Runtime generation（ADR 0010:57 次序第 1 步）
  if (current !== undefined) {
    if (current.phase === 'closing' && current.closePromise !== undefined) {
      try { await current.closePromise; }
      catch (cause) { dispatchObserver(observer, { type: 'lifecycle-slot-failed', identity, operation: 'reset', cause });
                      throw new NamespaceRegistryFatalError('reset', 'lifecycle-slot-internal', false, cause); }
    } else {
      forceReleaseOutstandingLeases(current);   // §4.8.2：快照迭代 release()（SA6 冻结观测 lease:'released'）
      cancelIdleArm(current);                   // phase==='idle'（onReleased 武装后）：clearTimeout + idleTimerHandle=undefined
      const closePromise = beginCloseCurrent(current);  // runtime.close()（同步 throw → rejected Promise）
      current.closePromise = closePromise;      // I2：closing ⟹ closePromise 定义（先赋值后翻相，镜像 beginIdleClose ①-③）
      current.phase = 'closing';                // 不可逆翻相（token 判别使在途 idle timer 回调 no-op）
      try { await closePromise; }               // barrier 排空已接纳写（含在途 ROOT 写的完整结算）
      catch (cause) { dispatchObserver(…lifecycle-slot-failed reset…);
                      throw new NamespaceRegistryFatalError('reset', 'lifecycle-slot-internal', false, cause); }
      // settle 处理器（closePromise.then 挂接，先于本 await 恢复执行）已 removeEntryAfterClose
    }
  }

  // ③ 存在性探针：entry 缺席时经 loadDoc 判存在——NOT_FOUND 路径不触达归档 seam（SA6 锚 archiveCalls === []）
  if (entries.get(identity.key) === undefined) {
    let probe: DocHandle | null;
    try { probe = await persistence.loadDoc(identity.owner, identity.namespaceId); }
    catch (e) { if (e instanceof DocLoadOperationalError) { dispatchObserver(observer, { type: 'open-load-failed', identity, cause: e });
                                                             return LOAD_FAILED_ISSUE; }
                dispatchObserver(…lifecycle-slot-failed reset…); throw new NamespaceRegistryFatalError('reset', 'lifecycle-slot-internal', false, e); }
    if (probe === null) return NOT_FOUND_ISSUE;
    try { await probe.release(); }              // 干净 restore entry 同步驱逐（maybeEvict）——归档前置成立
    catch (e) { dispatchObserver(observer, { type: 'handle-release-failed', identity, cause: e }); }
  }

  // ④ archive（ADR 0010:57 次序第 2 步；期望身份纯传递——§4.7）
  const archiveDocFn = capabilityGate('reset');  // typeof 窄化，缺席 → fatal（§4.4）
  try { await archiveDocFn.call(persistence, identity.owner, identity.namespaceId, expected); }
  catch (cause) { /* §4.8.3 映射矩阵 */ }

  // ⑤ 允许重新 bootstrap（第 3 步）：无显式动作——entry 已清 + 主键已归档 ⟹ key 缺席即资格（§4.8.5）
  return Object.freeze({ ok: true });
}
```

#### 4.8.1 close 失败分类（裁决）

close rejection（`NamespaceRuntimeCloseError`，release 失败）→ `NamespaceRegistryFatalError('reset', 'lifecycle-slot-internal', committed:false, cause)`——归档未发生 ⟹ committed:false 诚实；零删除成立（文档完好）。归为 internal fatal 而非结果 issue：close 失败不是领域拒绝也不是持久化运营故障，是编排内部失败（phase 词表零新增，`lifecycle-slot-internal` 语义吻合）。

#### 4.8.2 强制失效未决 lease（SA6 冻结观测的机制化；R2 增补观测噪声抑制——SA2 INFO-9）

SA6「成功闭环」与「并发 open + reset」均断言 `lease:'released'`。机制：快照迭代 `entry.leases`，逐个调用其 `release()`（公共方法；同步置 released、从 entry.leases 删除、observer `lease-released`、onReleased 回调）。次序细节：
- 逐个 release 会触发 `handleLeaseReleased`（最后一个 release 后 leases.size===0 → 武装 idle timer + phase='idle' + observer `entry-idle`）——**观测噪声抑制（R2 采纳）**：reset 槽在 release 循环前置 registry 闭包旗标 `let forceReleasing: Entry | undefined`（registry.ts 内部变量，零 lease.ts 改动——`handleLeaseReleased` 本就是 registry.ts:720-755 的闭包），其首语句增加 `if (forceReleasing === entry) return`——**仅抑制 idle 武装与 `entry-idle` 事件**（该 entry 事实上从未进入 idle——径直走向 closing，抑制是更诚实的观测）；`lease-released` 事件照发（lease 失效是真实事实）。槽以 try/finally 置位/清位旗标；循环与 close 发起之间零 await ⟹ 旗标窗口内无其它路径触发该 entry 的 handleLeaseReleased。被淘汰：phase 预翻 'closing'（违反 I2「closePromise 先赋值后翻相」纪律）；不改（噪声虽槽内有界，但 `entry-idle` 对从未 idle 的 entry 是可观测的虚假事件，未来 observer 计数测试会被误伤）。
- **单变量旗标的跨 key 并发覆写安全性（R3 注记，SA2 LOW-R2-2）**：不同 key 的并发 reset 槽共享同一闭包变量，其安全性由三层保证——①**查阅窗口是无 await 的单一同步块**：旗标置位 → release 循环 → cancelIdleArm → close 发起在同一同步段内完成（首次 yield 是 `await closePromise`），他槽的覆写/finally 清位只能经微任务插入，微任务永不打断同步块 ⟹ 本槽查阅期内旗标值不可能被改写；②**判别按 entry identity**：即使旗标被（结构性不可达的交错）覆写为他人 entry，失配仅退化为「不抑制」——落回 R1 原路径：release 循环后的同步 `cancelIdleArm` + idle timer 的 I4 token 与 `beginIdleClose` phase 守卫（registry.ts:733/767-768）兜底，正确性不受影响，仅观测噪声回到 R1 形态；③**每 key carrier FIFO**：同 key 的两个 reset 槽串行（后者在前者 tail 上），不存在同 key 旗标竞争面。缩作用域替代（`WeakSet<Entry>` / 每 entry 旗标）**评估后不采纳**：上述 ①② 已使单变量充分安全，WeakSet 需在 finally 手动 delete 防跨代际判漂移（entry generation 复用判据复杂化）、每 entry 旗标需改 Entry 结构——两者都在「零 lease.ts 改动 + 最小可变结构」约束下劣于闭包变量，收益为零。
- **本槽在 release 循环后同步 `cancelIdleArm`**（clearTimeout + idleTimerHandle=undefined；抑制旗标生效时此步为 no-op，保留为防御层——旗标与取消互为冗余兜底）；循环与取消之间零 await ⟹ timer（真实或 fake）无触发窗口；
- 随后 `runtime.close()` 的 barrier 释放 handle——Runtime 排空已接纳写（ADR 0009:42「release 不追踪或等待此前已经由 Runtime 接纳的写」：lease 失效不取消已接纳写槽；close barrier 保证其在归档前完整结算——SA6「在途 ROOT 写」用例的机制）。
- 语义论证与 shutdown 的差异：reset 把 key 交给**新 generation**（bootstrap 资格），旧 lease 不得再观察/回入该 namespace——失效是受信破坏性编排的诚实面；shutdown 终止整个 Registry（ADR 0009:99 冻结「不等待外部 lease release」），无回入面——差异记录于 §6-R5。

#### 4.8.3 archive 结果映射矩阵（Registry 侧；R2 修订 fatal 判别为 code-first——SA2 LOW-5）

按 **code 字符串判别**（对 duck-typed Persistence 实现稳健——SA6 stub 以 `Object.assign(new Error, {code})` 抛归档拒绝，非真实类实例；`instanceof` 判别会使 stub 用例落入 unknown→fatal 而红。persistence 契约自身宣示「callers branch on code, never message text」，contract.ts:44——code 即契约分支面）。**fatal 分支同款 code-first（R2）**：`code === 'DOC_ARCHIVE_FATAL'`（或 instanceof 双保险命中）时，committed 取 `typeof cause.committed === 'boolean' ? cause.committed : false`——duck-typed 第三方 Adapter 的 relocate-remove fatal（code 正确、非真实类实例）不再落入 unknown 分支而把 committed:true 改写为 false（INV-12「committed 事实原样传播」对 duck-typed 实现同样成立）；`committed` 字段缺席/非布尔时保守 false（镜像 create unknown 分支的保守方向）：

| Persistence 拒绝 | Registry 结果 |
|---|---|
| code `DOC_ARCHIVE_IDENTITY_MISMATCH` | `NAMESPACE_RESET_IDENTITY_MISMATCH` issue + observer `lifecycle-slot-failed(reset)`（本地文档完好——零部分删除） |
| code `DOC_ARCHIVE_DUPLICATE`（跨实例归档竞态等） | `NAMESPACE_NOT_FOUND`（本地副本已不在 ⟹ 语义同 not-found） |
| code `DOC_ARCHIVE_ACTIVE_HANDLE`（跨 Registry/进程共享 store 的 live handle） | `NAMESPACE_RESET_FAILED` + observer |
| code `DOC_ARCHIVE_OPERATIONAL` | `NAMESPACE_RESET_FAILED` + observer `reset-archive-failed` |
| code `DOC_ARCHIVE_FATAL`（instanceof 双保险；committed 按 cause.committed 布尔读取，缺席保守 false） | reject `NamespaceRegistryFatalError('reset', 'lifecycle-slot-internal', committed, cause)` |
| unknown throw（无识别 code 且非已知类） | reject `NamespaceRegistryFatalError('reset', 'lifecycle-slot-internal', false, cause)`（镜像 create unknown 分支） |

importReplica 的 Persistence 映射（同款纪律）：`DocDuplicateError`（instanceof——SA6 stub 抛真实类）→ `NAMESPACE_ALREADY_EXISTS`；code `DOC_IMPORT_IDENTITY_MISMATCH` → `NAMESPACE_IMPORT_IDENTITY_MISMATCH`（结构性不可达的防御映射）；`DocCreateOperationalError`/code `DOC_CREATE_OPERATIONAL` → `NAMESPACE_IMPORT_FAILED` + observer `import-persist-failed`；`DocCreateFatalError`/code `DOC_CREATE_FATAL`（committed 按 cause.committed 布尔读取）→ fatal('import','lifecycle-slot-internal', committed 传播)；unknown → fatal false。

#### 4.8.4 与三相（idle/closing/shutdown）的交互

| 状态 | 行为 |
|---|---|
| entry active | 强制 lease 失效 → cancelIdleArm（no-op）→ close |
| entry idle（timer 武装） | 强制 lease 失效（idle 时 leases 已空）→ cancelIdleArm（clearTimeout + token 失配使迟爆回调 no-op，registry.ts:733 I4）→ close |
| entry closing（idle-close 在途） | await 既有 closePromise（I2/AC10 复用同一实例；reject → 4.8.1）后进入 ③ |
| shutdown running→shutting-down | 停接纳（NOT_ACCEPTING）；已接纳 reset 槽经 carrier tail 被 runShutdown 等待（registry.ts:1173）——归档先于 Registry 关闭全集 |
| idle timer 回调 vs reset 槽 | 回调在 timer 栈不进 carrier；token + phase!=='idle' 双守卫 no-op（beginIdleClose:767-768） |

**并发 open + reset 串行（SA6 用例两序皆绿）**：reset 先 ⟹ open 槽在其后见 entry 缺席 + loadDoc null → NOT_FOUND；open 先 ⟹ reset 槽强制失效该 lease（断言 `lease:'released'` 的分支）→ close → archive。carrier FIFO 是唯一仲裁者，无部分状态窗口。

#### 4.8.5 「允许重新 bootstrap」的机制（N-2 裁决）

**资格判据 = key 缺席（归档完成 + entry 清理），无显式 eligibility 标记、无新状态枚举、无 wire 可见面**（N-2 建议；ADR 0009:114 v1 公共面纪律）。成立性：
- entry 已 removeEntryAfterClose；持久主键已归档 ⟹ `open → NAMESPACE_NOT_FOUND`、`loadDoc → null`（SA6 断言对）；
- `importReplica` 对同 key 立即可成功（entry 碰撞检查通过 + store 探读 undefined → 排他创建）——完整 reset→bootstrap 闭环；
- **stale expectedLocalIdentity 重放拒绝**：reset 成功并重新 bootstrap（如 epoch 前进）后，旧身份的重放 reset 在 ④ 被归档守卫拒绝（新持久事实 ≠ 旧期望 → `NAMESPACE_RESET_IDENTITY_MISMATCH`）——同一守卫天然覆盖，零额外机械（INV-8）。

被淘汰：显式 eligibility 标记（Registry/Persistence 新增可观察状态——违反 0009:114 公共面纪律且权威文档无此要求）；「reset 后 key 缺席即资格」的最小实现即权威文本（0010:57「最后允许重新 bootstrap」）的充分操作化。

### §4.9（D-9）File 归档路径布局与 tmp 协调（AC-5，N-6）

**布局冻结**：

```text
{rootDir}/
  users/{userId}/{namespaceId}.snapshot          # 主键区（不变）
  archive/
    users/{userId}/{namespaceId}.snapshot        # 归档区（本票新增；同布局镜像）
    users/{userId}/{namespaceId}.snapshot.tmp    # 归档暂存（writeArchive 提交段）
```

- 受控路径：`rootDir` 内 `archive/` 子树（phase:64「同 rootDir 内受控 archive 路径」）；SA6 模块纪律锚（专用父目录前后对比 rootDir 外零新增）结构性满足。
- 安全文法：`assertSafePathSegment('userId'/'namespaceId')` 双段复用（file.ts:146-152）——归档路径与主键路径同级纪律（N-6「维持 SAFE_PATH_SEGMENT 同级的安全文法纪律」）。
- 原子提交：`writeArchive` = mkdir（recursive）→ `writeFile(archivePath.tmp)` → `rename(tmp → archivePath)`——归档文件原子出现（0006:52 tmp→rename 纪律同构；abort 门位 entry/after-mkdir/after-writeFile，镜像 writeCommittedSnapshot:118-126）。
- **同名重复归档（`DOC_ARCHIVE_DUPLICATE` 的语义边界 + 覆盖裁决）**：DUPLICATE 码 = 「守卫读取时主键无 committed snapshot」（已归档后二次归档 / 从未存在，两形态一码——SA6 stub 同款语义）。若主键在（重新 create/import 后再归档），归档写以 tmp→rename **原子覆盖**旧归档副本——**单槽 latest-wins**。论证：ADR 0010:57 只要求「归档旧副本」（移出活槽），无保留历史承诺；覆盖使归档区每 key 恰一份文件（无枚举/编址需求，防 catalog 蔓延——0010:218「不增加跨 owner catalog」精神）。被淘汰：代际后缀/时间戳归档名（`<docId>.<n>.snapshot`）——发明保留语义、引入列举面与清理策略，零权威要求。归档历史的灾难恢复定位由 Hub 备份承担（0010:201）。
- **tmp 协调（N-6）**：①每 key 至多一份 tmp（writeFile 截断覆盖）；②下次同 key 归档以覆盖写清理（lazy——对齐 ADR 0006:52 启动清理规则在实现上的 per-read lazy 形态：主键区 tmp 由 readCommittedSnapshot 顺带 rm，file.ts:114；归档区无生产读路径，故以覆盖写为清理点）；③tmp 永非提交态——归档区的提交态唯 `.snapshot`（与主键区同判据）；④主键区读路径的 tmp 清理**不触及**归档区（路径子树分离，结构性不误删一半写入态）；⑤FilePersistence dispose 不做 tmp 清扫（现状不变，文档化）。残留上界：崩溃窗口内每未竟归档 key 一份 tmp——有界、无害、下次归档自愈。

### §4.10（D-10）Memory 归档行为等价操作化（AC-3，N-8；R2 修订——SA2 MEDIUM-4 碰撞消解）

**存储形态（R2 裁决：专属独立 Map 分区，不经 writeSnapshot hook）**：归档副本存于 Memory 实例专属的**独立 `archiveSnapshots: Map<string, StoredSnapshot>`**（以主键 `userId\0docId` 为键），与主 mirror `snapshots` 结构性分区；`writeArchive` **不路由经 `writeSnapshot` hook**。

#### 4.10.1 碰撞分析与裁决（R2 新增，SA2 MEDIUM-4）

- **被攻击的 R1 形态**：归档键 = ``archive\0{primaryKey}`` 与主键 `${userId}\0${docId}` **同池**（同一 mirror Map / 同一 hook store）。直接调用方（`createMemoryPersistence` 是包公共面）以 `userId='archive'`、`docId='u-alice\0ns-…'` 执行 createDoc，其主键字符串 = ``archive\0u-alice\0ns-…`` **精确命中** (u-alice, ns-…) 的归档槽位——任一方向的写静默覆写另一方向：归档副本被普通 doc 快照覆盖（INV-4 在 Memory 上可被第三方破坏），或反之归档写毁掉 'archive' 用户的文档。Memory 无身份文法（对照 file.ts:128-131），该 pathology 在 R1 文本下可达（registry 路径不可达——identity.ts:88-99 最小安全文法拒 U+0000；暴露面 = persistence 包直接调用方）。
- **裁决（SA2 修复方向 ① 的强化变体 ①′）**：独立 `archiveSnapshots` Map **且 hook 旁路**。结构上：归档区与主键区是两个不相交的存储域（不同 Map 对象、同主键键名）——任意 userId/docId 组合的主键写**不可能**触及归档域，反之亦然；hook store（外部唯一读权威）不再收到任何归档键 ⟹ 碰撞面在 mirror 与 hook store 两处同时消解（仅分区 Map 而保留 hook 路由的变体 ① 只消解 mirror 侧——hook store 中的 `archive\0…` 键仍可与病态主键碰撞，故必须叠加旁路）。
- **hook 旁路的锚定兼容性论证**：逐一核对 SA6 Memory 断言——ARC「成功归档」断言 loadDoc→null + slot 重建（无归档副本在场断言）；「duplicate」断言 loadDoc→null；「hold-before-commit」仅在 hold 期间断言 store 逐字节不变（归档尚未提交）+ 完成后 loadDoc→null；「failNextRead」断言拒绝 + 零变化；「owner 分区」断言双分区内容/身份原样与各自可归档；REG Memory 闭环断言 `store.has(primary) === false` + loadDoc null + 随后 import 成功——**无任何断言要求归档副本出现在 hook store**。Memory 归档副本的实例私有性与「Memory 无重启恢复面」的既有裁决（下文本节末）一致。
- **被淘汰的修复方向 ②（baseIo 入口拒绝 `\u0000` 段）**：会为 Memory 新增输入文法收窄（破坏「Memory 接受任意 string 键」的现状契约，需逐一排查既有测试零回归）；①′ 以 ~3 行实现同等结构性消解且零输入面变化。Memory mirror 既有的「`('x','y\0z')` vs `('x\0y','z')`」二义为**前存量**（SA2 定性），本票不扩权修复（记录在案；File 侧由 SAFE_PATH_SEGMENT 结构性免疫）。

**Memory baseIo 扩展（R2 形态）**：

```ts
// memory.ts 构造器内：
const baseIo: PersistenceIO = {
  read: …（不变）, write: …（不变）,
  writeArchive: async (key, snapshot, signal) => {
    signal.throwIfAborted();                                   // 入口 abort 门（与 write 同款，memory.ts:79）
    this.archiveSnapshots.set(key, { snapshot: snapshot.slice() });   // 独立分区；不经 writeSnapshot hook（§4.10.1）
  },
  remove: async (key, signal) => {
    signal.throwIfAborted();
    if (options.readSnapshot !== undefined && options.deleteSnapshot === undefined) {
      throw new Error('MemoryPersistence archive requires the deleteSnapshot hook when readSnapshot is wired: an external read authority without an external delete path cannot be archived honestly');
    }
    await options.deleteSnapshot?.(key, signal);
    this.snapshots.delete(key);                                // 主 mirror 删除（归档域不触碰——remove 契约：仅主键）
  },
};
// dispose()：core.dispose()（drain 全部 tracked op，含 writeArchive 提交段）之后
//           `this.snapshots.clear(); this.archiveSnapshots.clear();`（与既有 drain-then-clear 同款纪律，memory.ts:124-127）
```

**SA7 动态验证登记（R3，INFO-R2-1 指针）**：Memory dispose 的 drain-then-clear 窗口（在途 `writeArchive` 已进入提交段的 archiveSnapshots 写入是否先于 `clear()` 生效）已登记 SA7 动态验证覆盖——机制依据与既有 mirror 同款（core.dispose 的 allSettled 先结算 tracked 写、clear 后置，memory.ts:113-122 既有注释论证），本设计不展开、不新增断言面。

**`MemoryPersistenceOptions.deleteSnapshot?: (key, signal) => Promise<void> | void`（新增 optional hook）**：契约 = 从 readSnapshot/writeSnapshot 所接外部 store 中删除该 key 的 committed snapshot；缺省（未接线 readSnapshot 的实例）= 仅 mirror 删除。

**loud 配置门（拒绝虚假降级）**：read hook 接线时 hook store 是**唯一读权威**（memory.ts:77 `??` 短路，IO-2 纪律）——无 delete hook 则归档的「主键移除」对外部 store 虚假 no-op（归档后 hook 仍吐旧字节 ⟹ 文档复活 + `store.has(key)` 撒谎）。裁决：**该配置缺陷在 archiveDoc 运行时 loud 拒绝**（bare Error，稳定 message），而非构造期门禁——构造期门禁会使**全部既有 hook 接线实例**（含从不归档的 persistence-contract/issue-79/import-red 既有夹具）构造即炸，违反零回归；运行时门只在真实归档路径触发，命中者即配置错误，响亮失败。**该裁决与 SA6 两个 Memory 夹具（只接 read/write hook）冲突 ⟹ SA6 回流 R-1（必须）**：两夹具各补一行 `deleteSnapshot: async (key) => { store.delete(key); }`（persistence-phase5-archive-red.test.ts `makeMemoryArchiveFixture` 与 registry-phase5-bootstrap-reset-red.test.ts「Memory 真实全链闭环」writer 夹具；后者断言 `store.has(key) === false`，无删除钩子则任何设计都无法诚实地满足——hook store 的 Map.delete 只能由夹具提供的能力触达，这是锚的前置缺口而非设计保守）。

**行为等价的操作化（ADR 0006:157-159 双 Adapter 平行验收纪律）**：等价面 = SA6 ARC 共享矩阵九组用例在双 adapter 上**同一组断言**（成功归档 loadDoc→null + slot 重建 / 身份不匹配两式 / 损坏 / active handle / duplicate / hold-before-commit 诚实 / 读失败 fault / owner 分区独立）——全部经真实持久化面（Memory hook store 字节级、File 真实 fs）。**恢复面（归档内容可 decode 恢复）按 phase:183 测试 seam 由 File 承担**（重启语义）；Memory 不新造公共恢复读取 seam（SA6 边缘提示 7：Memory 等价面 = 公共可观察语义，恢复面未锚）——被淘汰：Memory 归档 store 探针公共面（新增公共可观测面，违反 0009:114/0010:218 精神，零锚定需求；R2 的独立 Map 分区下归档副本停留实例私有域，与该裁决一致——外部 store 不可见归档副本不削弱任何已锚断言，见 §4.10.1 兼容性论证）。

### §4.11（D-11）错误分类学与词表扩展（N-3）

#### 4.11.1 SA6 临时契约名/拼写冻结对照表（裁决：全部原样冻结，零改名）

| SA6 临时项 | 裁决 | 落位 |
|---|---|---|
| `importReplica(owner, namespaceId, doc: Y.Doc)` → `{ok:true; lease} \| {ok:false; code; message}` | **冻结**（名与结果面同锚） | types.ts `ImportReplicaResult`；公共面参数类型经 `YjsDoc` 别名（锚的可赋值性不变，§4.0.1） |
| `importDoc(owner, docId, doc): Promise<DocHandle>` | **冻结** | contract.ts（optional）+ ReplicaPersistence（required）+ Memory/File 实现 |
| `ReplicationIdentityRef = { replicationId; replicationEpoch }` | **冻结** | contract.ts 定义、types.ts 转出 |
| `NAMESPACE_IMPORT_INVALID_IDENTITY` | **冻结** | types.ts issue 码 + message 常量 |
| `NAMESPACE_IMPORT_IDENTITY_MISMATCH` | **冻结** | 同上 |
| `NAMESPACE_RESET_IDENTITY_MISMATCH` | **冻结** | 同上 |
| `DOC_ARCHIVE_IDENTITY_MISMATCH` / `DOC_ARCHIVE_ACTIVE_HANDLE` / `DOC_ARCHIVE_DUPLICATE` / `DOC_ARCHIVE_OPERATIONAL` | **冻结** | contract.ts 四类 + 稳定 message |
| `DOC_IMPORT_IDENTITY_MISMATCH` | **冻结** | contract.ts `DocImportIdentityError` |
| duplicate 复用 `DOC_DUPLICATE`（导入）与 `NAMESPACE_ALREADY_EXISTS`（Registry） | **冻结**（SA6 §4.1 已按冻结词汇锚） | 既有冻结词汇复用 |
| 归档损坏身份分类（未钉 code） | **裁决归 identity mismatch 族**（§4.5.4） | SA6 用例按 `.rejects.toThrow()` 成立 |
| `waitDurableSnapshot` 正式模式 | 沿用（File 闭环既有前置） | 测试侧，无 src 落位 |

新码（无 SA6 临时对应、本票新增）：`DOC_ARCHIVE_FATAL`（+ 三 phase 与冻结 committed 映射）、`NAMESPACE_IMPORT_FAILED`、`NAMESPACE_RESET_FAILED`。

#### 4.11.2 稳定文案单点表

- Persistence：沿用本包「constructor 默认 message 内联冻结」先例（DocDuplicateError 形态，contract.ts:47）——**六类** message 见 §4.0.1（R4 更正 SA4 F-4：DocImportIdentityError + 归档五类，原「七类」系误记——DOC_ARCHIVE_FATAL_PHASE_COMMITTED 是冻结映射常量非错误类），恒定、零回显、零 cause 拼接（N3 纪律，testing.ts:811-829 断言族同款适用）。
- Registry：types.ts message 常量单点（§4.0.3），零插值、零 identity/cause 回显；issue 对象 `Object.freeze`（沿 NOT_FOUND_ISSUE 形态，registry.ts:237-253）。

#### 4.11.3 词表 append-only 扩展的授权链

- `NamespaceRegistryFatalError.operation: + 'reset' | 'import'`：授权 = ADR 0010:222「Registry 仍负责……reset/archive 编排」（对 ADR 0009:89-93 fatal 词表与 0009:107-114 公共面清单的演进）；程序先例 = ADR 0009 #131 修订节 2 增补 `namespace-id-generation` phase（0009:139）——append-only，既有三值语义不变。
- Registry observer 事件联合 +3 形、`lifecycle-slot-failed.operation` +2 值：observer 是内部 seam（ADR 0009:95「v1 不提供公共事件订阅」），append-only；消费方（测试）无穷尽 switch（§9 grep 证据）。
- Persistence 新错误类/码：授权 = ADR 0010:218「为 Persistence 增加复制导入与归档所需的受控能力」+ phase:65 四分类要求；ADR 0008:125 注册表归属条款（「以包内各稳定码定义处的 append-only 注册表为准」）同构适用。
- **phase 词表零新增**：Registry fatal phase 四值不动（reset/import 的失败落 `lifecycle-slot-internal`/`runtime-construction` 既有值）；Persistence 侧新增 `DocArchiveFatalPhase`（新族自有词表，不触碰 DocCreateFatalPhase）。

### §4.12（D-12，N-9）导入后 Runtime 构造（AC-1 末段）

**裁决：单一构造路径复用，零旁路**。importReplica 第 ④ 步与 open/create 步⑤完全同款：`factory(handle, () => persistence.saveDoc(handle))`（registry.ts:907/1140 同一行）→ makeEntry → entries.set → issueLease。

- **构造期 V2.5 与导入核对的关系（N-9）**：Registry 槽内核对（§4.2）保证导入文档必为 enabled 态 ⟹ Runtime 构造期 `readReplicationFacts(doc)`（runtime.ts:203-208）投影 enabled——既定期望与导入路径核对**同一判据族**（§4.2.1/§4.5.4 三处结构守卫副本），两处读的是同一 live doc 的同一字段，enabled 是不变式（INV-R1：身份一经安装不可改写）。TOCTOU 窗口（核对与构造之间调用方变异）下构造 throw `ReplicationMetaCorruptError` → Registry 收编为 `NamespaceRegistryFatalError('import', 'runtime-construction', committed:true, cause)`——**committed:true**（importDoc 已 resolve ⟹ 快照已提交，镜像 create DQ-7：registry.ts:1145-1152 逐句同款：handle best-effort release、entry 不登记、不补偿删除）。
- **普通 open 对 enabled 文档零回归**：namespace-runtime 零改动（DENY），open 的构造路径与 #132 冻结行为逐字节不变。
- 授权：ADR 0010:66「Registry 打开新 Runtime generation」+ ADR 0009:68 create 后走普通 P0 启动路径的先例（「v1 接受 create compile 与 P0 compile 重复，以换取单一 Runtime 构造路径」——同款取舍在此重申：导入路径不因「已核对过身份」而跳过构造期预投影）。

### §4.13 reset→bootstrap 全链闭环（真实持久化，SA6 REG 两用例的机制核对）

Memory：enable → kick flush → store 字节含身份（测试前置）→ reset：close → release（entry 或 dirty → archiveDoc settle 强制排空——测试前置已排空则直通）→ guard-read（hook store）→ 身份匹配 → writeArchive（R2：独立 archiveSnapshots 分区，hook store 不触）→ remove（deleteSnapshot hook：store 删主键 + 主 mirror 删）→ `{ok:true}` ⟹ `store.has(primary) === false`、`loadDoc → null`、`open → NOT_FOUND`；import（epoch+1）→ 排他创建 → lease。File：同链 + `waitDurableSnapshot` 前置 + 归档文件在 `archive/users/<u>/<nsId>.snapshot` + 重启后新实例 open 恢复导入副本。

### §4.14（D-14）测试迁移面与零回归静态论证

#### 4.14.1 SA6 五文件转绿对照

| 文件 | 红→绿 | 需回流 |
|---|---|---|
| persistence-phase5-archive-red.test.ts | 22 红全绿：方法存在后，成功归档/身份两式/损坏（identity 族 `toThrow()`）/active handle/duplicate/hold（writeArchive 经 seam write 槽 engage）/failNextRead（guard-read 经 io.read）/failNextWrite（writeArchive 经 write 槽拒绝）/owner 分区 + File 四例（落点/原子零变化/重启恢复/模块纪律）逐一由 §4.5/§4.9 机制满足 | **R-1**：`makeMemoryArchiveFixture` 补 `deleteSnapshot`（1 行） |
| persistence-phase5-import-red.test.ts | 13 红全绿：exclusiveCreate('import') + DocImportIdentityError + DocDuplicateError 复用；fixture 无 wrapIo（import 不触归档）。R4 注记（SA4 裁决接受的偏差 2）：File 夹具的 walk 增补 ENOENT 容错 6 行管道代码（零断言改动）——「零改动」声称就此不再精确，准确表述为「零断言/契约面改动，夹具管道 +6 行」；该偏差经 SA4 F-2 建议并入 SA6 回流档案、已转 SA6 登记 | 无（契约面）；夹具管道偏差 2 已登记 SA6 |
| registry-phase5-bootstrap-reset-red.test.ts | 17 红全绿：§4.2/§4.8 编排 + §4.8.3 code 判别映射（stub 的 plain-error-with-code 归档拒绝 → `NAMESPACE_RESET_IDENTITY_MISMATCH`）+ 强制 lease 失效（成功闭环/并发 open+reset 的 `lease:'released'`）+ 在途写经 close barrier 排空（stub doc 引用共享）+ Memory/File 真实闭环（§4.13） | **R-1**：Memory 闭环 writer 夹具补 `deleteSnapshot`（1 行） |
| persistence-phase5-archive-surface.test-d.ts | 4 锚中 2 红锚经 **R-2** 改锚 `ReplicaPersistence` 后绿；2 绿守卫（无删除/枚举面、三主方法字面量）**零改动保持绿**（optional 成员下三成员字面量仍合法） | **R-2**：两红锚类型参数 `DocPersistence`→`ReplicaPersistence` + 1 行 import |
| registry-phase5-bootstrap-reset-surface.test-d.ts | 2 红锚（`HasResetReplica`/`HasImportReplica` 于 `NamespaceRegistry` required 成员）直接绿；2 绿守卫（无通用按 key 管理面、create 恒三键）零改动绿 | 无 |

#### 4.14.2 零回归静态论证（既有 28 文件/313 用例（persistence+registry）+ 全仓 1599 例；R2 增补 9-11）

1. **createDoc/loadDoc/saveDoc 语义零改动**：exclusiveCreate 抽取是私有重构，create 路径的类/message/次序逐字节保持（`op==='create'` 分支即原文）；flush/evict/idle/claim 环既有行为不动。
2. **DocPersistence optional 扩展**：13 个 stub 类与三成员字面量合法（§4.4）；DocPersistenceWithCreate 等派生接口不受影响。
3. **PersistenceIO optional 扩展**：registry-sa7-phase5-dynamic.test.ts:312 字面量合法；testing.ts seam 由本票同步扩展（ALLOW 内）。
4. **NamespaceRegistry required +2**：唯一实现者 = registry.ts 生产对象（grep 实证零测试 stub/字面量）；open/create/getStatus/shutdown 行为零改动。
5. **operation/observer 词表 append-only**：测试仅断言既有字面量（grep 实证），无穷尽 switch。
6. **registry 主入口九值冻结**：零新增值导出（§4.0.4）；声明图禁词审计：新公共签名只用 `NamespaceOwner`/`NamespaceLease`/`YjsDoc`/`ReplicationIdentityRef`/结果联合——禁词零出现（`YjsDoc` 别名即为此而设）。
7. **namespace-runtime / replication-protocol / docs / 其余包零改动**（§7 DENY）。
8. **message 常量与既有断言**：零改动既有常量；新常量不进 persistence 既有 message 断言面。
9. **flush finally 首位通知（R2）**：非归档路径 `archiveWaiters` 恒空（仅 settle 填充）⟹ splice 空数组为 no-op，finally 其余语句次序/语义零变化（§4.5.2 通知点 1 零回归论证）；既有 issue-79/#108 用例对 finally 行为的观测面（degraded/reschedule/evict）逐项不动。
10. **dispose 同步段通知（R2）**：追加语句位于既有 live-entry 清理循环内，仅触达 `archiveWaiters`（非归档生命周期恒空）⟹ 既有 dispose 用例（create-dispose 竞态、adapter dispose 幂等）观测面零变化；inFlight 记账扩展只增不改（track 既有签名/语义复用）。
11. **seedForTest 守卫扩展（R2）**：仅把 `archiving` 加入既有抛错条件（'test seed requires an idle key cell' 文本不变）——archiving 态在基线不存在 ⟹ 既有 seed 用例零变化；forceReleasing 旗标（R2）仅 reset 槽内置位，正常 release 路径（idle 用例族）不经旗标分支，`entry-idle` 事件在既有 idle 用例中照发。

### §4.15 AC 覆盖表

| AC | 设计节 | 覆盖机制摘要 |
|---|---|---|
| AC-1 受信导入保留 Hub namespaceId + detached 完整应用 + META 核对先于 ownership 转移 | §4.1/§4.2/§4.12 | importReplica 不生成/不改写身份（D-1）；核对次序冻结且先于一切 Persistence 调用（§4.2 ②）；导入后走单一 Runtime 构造路径（§4.12） |
| AC-2 排他不覆盖不合并 | §4.3/§4.8.3 | importDoc 复用 createDoc 排他 claim 机械（三判定永不覆盖）；entry/live、committed snapshot、并发三形态统一 `NAMESPACE_ALREADY_EXISTS`/`DOC_DUPLICATE`；跨面排他（import↔create 共享 cell） |
| AC-3 Memory/File 行为等价归档 + 身份守卫 | §4.5/§4.10 | archiveDoc 单一 lifecycle 实现（双 adapter 共享状态机，0006:157-159）；身份单一谓词（§4.5.4）；Memory hook 等价面（§4.10） |
| AC-4 resetReplica 串行化 + race 拒绝零部分删除 | §4.8 | carrier FIFO 串行 close→archive→资格；owner mismatch NOT_FOUND 零归档触达；identity mismatch 稳定拒绝 + 文档完好（守卫拒绝⟹未删）；并发 open+reset 两序皆确定 |
| AC-5 File 受控路径 + 原子 rename + WS 不触文件 | §4.9/§4.6/§7 | `archive/` 子树 + SAFE_PATH_SEGMENT + tmp→rename；文件移动封闭于 persistence 包（DENY namespace-runtime/replication-protocol；ws 层未建，seam 设计即禁令载体） |
| AC-6 测试面六要素 | §4.14 | duplicate（ARC/IMP/REG）/crash·error committed（hold/fail + fatal 映射）/active handle/identity mismatch/恢复（File 重启）/owner 分区（ARC/IMP/REG）——SA6 锚逐位对位 |

---

## §5 不变量清单（INV-1..INV-15；R2 增补 INV-14/INV-15）

- **INV-1（排他永不让步）**：任一 `(owner.userId, docId)` 的首次持久化恰经一个成功创建者；createDoc 与 importDoc 共享同一 per-key claim 链，duplicate 三判定（cache 命中/store 见快照/并发 claim）在跨面并发下不变（ADR 0006:121-123）。
- **INV-2（核对先于所有权转移）**：importReplica 的全部 META 核对（docId → 复制事实）先于任何 Persistence 调用；任何核对拒绝 ⟹ `importCalls === []`、store 零残留、`loadDoc === null`（AC-1）。
- **INV-3（导入字节原样继承）**：importDoc 经 `Y.encodeStateAsUpdate(doc)` 直写，不生成/不改写 META 任何字段（含 createdAt/复制身份）——「首次 bootstrap 继承 hub 的完整 META 身份」（0010:54）。
- **INV-4（归档提交不变式）**：`archiveDoc` resolve `{ok:true}` ⟺ 归档区持有**已核对的同一份字节**且主键已移除；此前任何拒绝 ⟹ 主键与归档区逐字节不变（guard-read/verify 全部只读；relocate-write 的写公理；remove 后置于 write 之后）。R2 强化：Memory 归档区为独立 Map 分区（§4.10.1），主键空间任意写**结构性不可达**归档副本。
- **INV-5（身份守卫单点）**：归档放行的唯一判据 = 持久快照复制事实与 expected 在 id、epoch、格式合法三者上全等；任何偏差（含损坏与 docId 不符）→ `DOC_ARCHIVE_IDENTITY_MISMATCH` 且零改动；判据语义源唯一（readReplicationFacts 判据族，结构守卫副本三处互引）。
- **INV-6（零部分删除）**：resetReplica 的任何拒绝路径（INVALID_IDENTITY/NOT_ACCEPTING/NOT_FOUND/RESET_IDENTITY_MISMATCH/RESET_FAILED/LOAD_FAILED/fatal）下本地持久副本完好——可 open 且 META/ROOT 零改动（守卫/探针先于一切存储变更；close-only 路径不动存储）。R2 强化：「可 open」由 INV-14 机械保证（归档拒绝不毒化 key）。
- **INV-7（close→archive 次序与写完整结算）**：归档仅在 Runtime generation 已关、handle 已释放、在途写已结算、零-handle dirty 已排空后执行；归档字节含全部已接纳写的终态（ADR 0010:57 次序 + §4.5.2 settle）。
- **INV-8（bootstrap 资格 = key 缺席）**：reset 成功 ⟺ entry 清理 + 主键归档；无显式标记/新状态枚举/wire 可见面；随后 importReplica 对同 key 必可成功（N-2）。
- **INV-9（stale 身份重放拒绝）**：reset 成功且重新 bootstrap 后，旧 `expectedLocalIdentity` 的重放 reset 被同一守卫拒绝（新持久事实 ≠ 旧期望）。
- **INV-10（owner 分区隔离）**：import/archive/reset 全部以 `(owner.userId, docId)` 分区寻址与判存；owner mismatch 统一 NOT_FOUND 零存在性泄露（0010:30；0009:138）；A 的操作零影响 B 同名分区。
- **INV-11（文件访问封闭）**：snapshot/归档文件的一切移动仅发生在 `@nomicore/persistence` 内部；Registry 经 archiveDoc seam 间接操作；WS 层（未来）只能经该 seam（0010:57「WS 层不得直接读写 snapshot 文件」）。
- **INV-12（词表 append-only + 零回显）**：公共错误码、operation/phase 词表只增不改；全部新 message 恒定单点、零 identity/cause/输入回显；committed 事实由冻结映射派生、调用方不得重推导；duck-typed 实现的 fatal committed 事实经 code-first 判别原样传播（§4.8.3，R2）。
- **INV-13（capability 显式化）**：DocPersistence/PersistenceIO 的复制能力缺席不得静默降级——Registry typeof gate → fatal；lifecycle io gate → bare loud Error；Memory 受钩实例缺 deleteSnapshot → 归档 loud 拒绝。
- **INV-14（key 无毒化，R2/SA2 BLOCKER-2）**：archiveDoc 的任何结算路径（成功/identity/operational/fatal/disposed/seam 违约）退出时，`cells` 不残留已结算 claim 的 `archiving` 态——失败/成功善后一律以 `cur?.state === 'archiving' && cur.claim === claim` 守卫删除（镜像 lifecycle.ts:263-268）；置 cell 之前的抛出点（入口/settle/assertWritable）无 cell 可毒化。推论：同 key 后续 loadDoc/createDoc/importDoc 无限循环结构性不可达。
- **INV-15（归档必然结算，R2/SA2 BLOCKER-1）**：archiveDoc 的 promise 在任何交错下有限结算——dispose 经同步段 waiter 通知（§4.5.2 通知点 2）与 flush finally 首位通知（通知点 1）解除 settle 等待，claim 段 assertWritable 收口；归档全程 track（通知点 3）使 dispose 的 allSettled 排空覆盖归档且不自等待。store 长期 degraded 而无 dispose 时为诚实 pending（ADR 0008:93「不设内部 timeout」同款契约行为，非不变量违反）。

## §6 风险与防御（含 SA2 预答区）

| # | 风险/预判攻击 | 防御 |
|---|---|---|
| R1 | **optional 成员是否削弱契约**（「ReplicaPersistence 没人强制实现」） | 能力缺席三处 loud gate（INV-13）；派生接口给出 required 面；13 stub + 绿守卫 + 既有 wrapper 零回归的硬证据（§4.4/§9）；被淘汰方案与理由显式记录 |
| R2 | **TOCTOU：doc 在核对与 encode 间被变异** | 与 createDoc 既有暴露面同构（§4.2 声明）；防御纵深 = Registry ②a + Persistence validateImportDoc 两道 docId 门 + loadDoc restoreAndValidate 终检；不伪称快照原子性 |
| R3 | **relocate-remove 半状态（双副本并存）** | committed:true fatal（诚实）+ 幂等收敛重试（§4.5.5）；不吞错、不回滚声称 |
| R4 | **settle 等待可能长挂（degraded retry 回退/远端 store 不恢复）** | 诚实 pending（无内部 timeout——ADR 0008:93 close barrier「不设内部 timeout」同款契约行为）；**R2 规格化 dispose 解除机制**：dispose 同步段 waiter 通知 + flush finally 首位通知 + 归档全程 track（§4.5.2 三通知点，INV-15）——R1 文本的「无条件通知」由机制承载，场景推演见修订记录 B1；debounce 跳过使正常路径零 timer 依赖 |
| R5 | **强制失效 lease 是否越权**（shutdown 不失效，reset 失效的不对称） | SA6 双用例冻结观测（`lease:'released'`）；语义论证：reset 交出 key 给新 generation，旧 lease 不得回入；shutdown 是进程终局无回入面（§4.8.2）；差异显式记录非隐藏 |
| R6 | **归档 latest-wins 覆盖丢旧归档** | 单槽语义论证（§4.9）：无保留承诺；Hub 备份是灾难恢复权威（0010:201）；被淘汰方案（代际命名）理由在案 |
| R7 | **三份判据副本漂移**（runtime/registry/persistence 的 facts 判据） | 结构守卫副本先例（registry.ts:147-154）+ 三处注释互引 + SA6 格式违约三分支用例锚定；被淘汰：导出 readReplicationFacts（击穿 runtime 值导出冻结审计） |
| R8 | **归档 tmp 残留** | 每 key 至多一份 + 覆盖式清理 + tmp 永非提交态 + 与主键区清理路径结构性分离（§4.9） |
| R9 | **Memory 无恢复面 ≠ 行为不等价** | phase:183 明确 File 承担重启/归档/恢复验收；Memory 等价面 = 九组共享断言（公共可观察语义）；恢复面语义由 File 双向锚（归档文件 decode + 重启 open） |
| R10 | **code 字符串判别（非 instanceof）被指脆弱** | persistence 契约自宣示 code 为分支面（contract.ts:44）；SA6 stub 即 duck-typed 实现（code-carrying error）——判别面对第三方 Adapter 开放是 seam 的诚实属性；真实类同时满足 instanceof（双保险非依赖） |
| R11 | **reset 在 identity mismatch 时已拆除 Runtime generation（churn）** | 观测面零差异（文档完好可 open——SA6 用例锚）；被淘汰的「Registry 预检 live 投影」因 dirty 领先持久事实而不能取消守卫、反立第二判据（§4.7-2）；churn 成本（一次 generation 重建）记录在案 |
| R12 | **importReplica 被普通调用方滥用指定任意 namespaceId** | N-4 信任模型（§4.1）：ADR 0010:79 同款纪律（文档化非 capability 化）；核对严于 create；普通 create 接纳零改动；无新增通用管理面 |

## §7 文件清单（File Scope）

### ALLOW LIST

**packages/persistence/src（6 文件）**

- `packages/persistence/src/contract.ts` — 修改：+`YjsDoc`/`ReplicationIdentityRef`/`ReplicaPersistence` 类型、DocPersistence optional +2 成员、`DocImportIdentityError` + 归档四类 + `DocArchiveFatalError`/phase/committed 映射（§4.0.1；约 +150 行）
- `packages/persistence/src/lifecycle.ts` — 修改：PersistenceIO optional +`writeArchive`/`remove`；cell +`archiving` 态与 KeyClaim 更名；createDoc 抽取为 exclusiveCreate + importDoc；archiveDoc 全编排（settle/claim/guard/verify/relocate + **失败/成功路径 identity 守卫善后**，§4.5.3）；resolveLoad/claim 环 archiving 分支；LiveEntry.archiveWaiters；**flush finally 首位无条件通知**（§4.5.2 通知点 1）；**dispose 同步段 waiter 通知**（§4.5.2 通知点 2）；**归档全程 track**（通知点 3）；**seedForTest 守卫扩 archiving**（`reading/creating/archiving` 一律抛 'test seed requires an idle key cell'，SA2 MEDIUM-3）（§4.3/§4.5；约 +275 行，其中 ~80 行为 createDoc 原文搬运）
- `packages/persistence/src/memory.ts` — 修改：baseIo +writeArchive（**独立 `archiveSnapshots` Map 分区，不经 writeSnapshot hook**，§4.10.1）/remove；options +deleteSnapshot hook + loud 配置门；dispose 增 `archiveSnapshots.clear()`（§4.10；约 +45 行）
- `packages/persistence/src/file.ts` — 修改：baseIo +writeArchive（archive/ 子树 tmp→rename）/remove；归档路径解析 + SAFE_PATH_SEGMENT 复用；importDoc/archiveDoc 委托 + validateIdentity（§4.9；约 +55 行）
- `packages/persistence/src/index.ts` — 修改：+7 值 +4 类型导出（§4.0.4；约 +15 行）
- `packages/persistence/src/testing.ts` — 修改：fault seam wrap +writeArchive（并入 write 故障/hold 槽）+remove 透传（§4.6；约 +25 行）

**packages/namespace-registry/src（5 文件）**

- `packages/namespace-registry/src/types.ts` — 修改：+5 message 常量、Import/Reset 结果联合、NamespaceRegistry +importReplica/resetReplica、ReplicationIdentityRef 转出（§4.0.3；约 +110 行）
- `packages/namespace-registry/src/registry.ts` — 修改：importReplica/resetReplica 入口与槽（含 forceReleaseOutstandingLeases/beginCloseCurrent/探针/映射矩阵；**forceReleasing 闭包旗标抑制 reset 强制释放路径的 idle 武装与 entry-idle 事件**，§4.8.2）、readImportedReplicaFacts 私有读取器、capability gate（§4.2/§4.8；约 +225 行）
- `packages/namespace-registry/src/errors.ts` — 修改：operation 联合 +`'reset' | 'import'`（2 行）
- `packages/namespace-registry/src/observer.ts` — 修改：operation 联合扩展 + 3 事件形（约 +15 行）
- `packages/namespace-registry/src/index.ts` — 修改：type-only +5 导出（约 +6 行）

**SA6 owned 测试文件（回流 R-1/R-2 落位；SA3 不得改断言逻辑，仅按本设计回流清单微调）**

- `packages/persistence/test/persistence-phase5-archive-red.test.ts` — `[SA6 owned]` 回流 R-1：`makeMemoryArchiveFixture` 补 `deleteSnapshot`（+1 行）
- `packages/namespace-registry/test/registry-phase5-bootstrap-reset-red.test.ts` — `[SA6 owned]` 回流 R-1：Memory 闭环 writer 夹具补 `deleteSnapshot`（+1 行）
- `packages/persistence/test/persistence-phase5-archive-surface.test-d.ts` — `[SA6 owned]` 回流 R-2：两红锚 `DocPersistence`→`ReplicaPersistence` + import（+2 行）
- `packages/persistence/test/persistence-phase5-import-red.test.ts` — `[SA6 owned]` 零断言/契约面改动转绿（R4 同步：File 夹具 walk ENOENT 容错 +6 行管道代码，SA4 裁决接受的偏差 2、已登记 SA6）
- `packages/namespace-registry/test/registry-phase5-bootstrap-reset-surface.test-d.ts` — `[SA6 owned]` 零改动转绿

### DENY LIST

- `packages/namespace-runtime/src/**` — 零改动：构造路径/readReplicationFacts/sequencer 不触（N-9 经单一构造路径在 Registry 侧满足）；导出 readReplicationFacts 会击穿 runtime-acceptance-exports-audit 值导出恰一键冻结
- `packages/namespace-runtime/test/**` — 不动（durable-snapshot-wait.ts 只读引用）
- `packages/replication-protocol/**` — 切片 5 已冻结交付，本票零交集
- `docs/**` — **零文档改动**（论证：ADR 0010:57/62-65/218/222 与 phase:62-65/113 已完备授权本票全部能力与四分类——实现是对已接受 ADR 的落地而非新决策；稳定码注册表按 ADR 0008:125 归属包内定义处（append-only 注册表），不入 ADR；CONTEXT.md 无新词汇（reset/archive/bootstrap/复制谱系/epoch 均已定义）。先例：issue #132 D-12 零文档改动——Runtime/Lease 复制管理面同样在 ADR 已授权下零文档落地）
- `packages/persistence/src/service.ts` — Cordis 接线零变化（capability 与装配无关）
- `packages/namespace-registry/src/{identity,lease,plugin,testing,create-document}.ts` — 零改动：identity 复用 validateOpenIdentity；lease 无新方法（reset 的强制失效走公共 release()）；plugin/testing 面无新注入需求（SA6 夹具现造可用）；create-document 不参与导入路径
- `packages/{doc-runtime,vfsl,vfsl-protocol,vfsl-codegen,clock,dsh-persistence}/**`、`apps/**`、`domains/**` — 无交集

## §8 协议假设依据 (Protocol Assumption Evidence)

**本设计无 HTTP/WS 端点、端口、跨进程资源生命周期类协议级假设**（WS transport 属切片 6-7，本票为本地生命周期）。仅含两类底层行为假设，逐条给出依据：

| 假设 | 依据类型 | 依据内容 | 风险等级 |
|---|---|---|---|
| 同目录树内 `fsp.rename` 原子性（归档 tmp→rename、与主键 flush 同款） | 源码引用（既有生产行为） | `packages/persistence/src/file.ts:118-126` writeCommittedSnapshot 已以 mkdir→writeFile tmp→rename 提交主键快照并在全部既有 File 测试（file-persistence.test.ts、issue-79-file-entry-status.test.ts）通过；归档区在同一 rootDir 子树（同文件系统）⟹ 同款 rename 语义 | 低 |
| TS 可赋值性：`(d: YjsDoc) => R` / `(d: unknown) => R` 满足锚的 `(d: Y.Doc) => R`；optional 成员使三成员字面量合法、使 `T extends {archiveDoc: F}` 不成立 | 源码引用 + 设计期类型事实 | 锚文本：persistence-phase5-archive-surface.test-d.ts:33-47、registry-phase5-bootstrap-reset-surface.test-d.ts:43-61；YjsDoc 为 `= Y.Doc` 别名（恒等可赋值）；R-2 回流即由此假设导出 | 低 |
| fault seam 的 write 槽可覆盖 writeArchive（归档提交段可被 hold/fail 注入） | 现有测试引用 | persistence/src/testing.ts:747-771 wrap 的 write 槽是单一 armed 位；本票在 ALLOW 内扩展 wrap 将 writeArchive 并入同槽——SA6 hold/fail-write 用例即该假设的验收锚 | 低 |
| Node `fsp.rm(path, {force:true})` 容忍 ENOENT（remove 的幂等底座） | 官方文档引用 + 既有先例 | Node fs 文档 `force: true` ⟹ ENOENT 视为成功；file.ts:114 已用 `fsp.rm(tmpPath, { force: true })` 同款语义 | 低 |

## §9 契约改动连锁审计 (Contract Change Caller Audit)

### 改动契约清单

| 契约 | 文件 | 改动前 | 改动后 |
|---|---|---|---|
| `DocPersistence` | persistence/src/contract.ts:38-42 | 恰三方法 | +optional `importDoc`/`archiveDoc`（§4.0.1） |
| `PersistenceIO` | persistence/src/lifecycle.ts:41-44 | read/write | +optional `writeArchive`/`remove`（§4.0.2） |
| `NamespaceRegistry` | registry/src/types.ts:364-385 | 四方法 | +required `importReplica`/`resetReplica`（§4.0.3） |
| `NamespaceRegistryFatalError.operation` | registry/src/errors.ts:23/29 | `'open'\|'create'\|'shutdown'` | +`'reset'\|'import'`（append-only） |
| `RegistryObserverEvent` | registry/src/observer.ts:17-41 | 11 形；operation `'open'\|'create'` | +3 形；operation +`'reset'\|'import'`（append-only） |
| `MemoryPersistenceOptions` | persistence/src/memory.ts:19-48 | 5 键 | +optional `deleteSnapshot` |

**说明**：本票无「return 改 throw / Promise\<T\> 改 never / 同步变 async / catch 改 rethrow / nullable 改 non-null」类既有函数契约改写——createDoc 经 exclusiveCreate 抽取后 `op==='create'` 分支行为逐字节保持；全部新增面为**新增成员/新增类型/联合 append**。

### 实现者/调用者清单（含三栏判定；grep 命令与证据）

`git grep -n "implements DocPersistence" -- 'packages/**/*.ts'`（**16 命中**——R4 按文中自载命令重新实测：13 个既有测试 stub 类 + Memory + File 两实现 + file-persistence.test.ts:10 一行文档注释；git grep 只搜**已跟踪**文件）与 `git grep -n "PersistenceIO" -- 'packages/**/*.ts'`（6 文件）。**计数口径差异（R4 注记，SA4 F-4）**：文件系统全量检索（`grep -rn --include='*.ts' packages/`，含未跟踪的 SA6 新文件 registry-phase5-bootstrap-reset-red.test.ts 之 StubReplicaPersistence）为 **17 命中**——SA2 R2 的 16 与 SA4 实测的 17 分别对应 git-grep 域与全文件系统域，两数皆真、口径不同；SA6 新 stub 属本票锚定面（§9 表中单列），不计入「13 个既有冻结 stub」的零回归论证域。R1 原文本的「17 命中」按 git-grep 口径为误记（其中 1 命中实为注释行）。

| 实现者/调用者 | 位置 | await | 直接 try/catch | 顶层 catch-all | 处置 |
|---|---|---|---|---|---|
| MemoryPersistence | memory.ts:63 | — | — | — | 本票 +importDoc/archiveDoc/writeArchive/remove/deleteSnapshot（ALLOW） |
| FilePersistence | file.ts:57 | — | — | — | 同上（ALLOW） |
| 13 个既有测试 stub（StubPersistence/MapPersistence/CreateStubPersistence/PluginStubPersistence/Sa7StubPersistence/ChannelPersistence/Phase5StubPersistence/StubReplicationPersistence…） | registry/test/{open,create,shutdown,idle,node-dispose,plugin,sa7-concurrency,sa7-cordis,sa7-hostile,sa7-rev1,phase5-identity-red,phase5-replication-red,phase5-replication-channels}.test.ts | — | — | — | **零改动**（optional 成员 ⟹ 缺席合法；这些 stub 不触导入/归档路径） |
| SA6 StubReplicaPersistence | registry/test/registry-phase5-bootstrap-reset-red.test.ts:257 | — | — | — | 已实现 importDoc/archiveDoc（SA6 自建）；零改动 |
| surface 三成员字面量 | persistence/test/persistence-phase5-archive-surface.test-d.ts:77 | — | — | — | **零改动**（optional ⟹ 合法；保持绿守卫） |
| fault seam wrap | persistence/src/testing.ts:731-772 | — | — | — | 本票扩展（ALLOW）：writeArchive 并入 write 槽、remove 透传 |
| 既有 wrapIo 字面量 | registry/test/registry-sa7-phase5-dynamic.test.ts:312-351 | 是（io 转发） | 否（透传） | 测试顶层 | **零改动**（optional ⟹ `{read,write}` 字面量仍满足 PersistenceIO） |
| registry 生产调用（新） | registry/src/registry.ts（新槽） | 是 | 是（映射矩阵 §4.8.3） | fatal 通道 | 本票新增（ALLOW）：importDoc/archiveDoc 调用点全部 try/catch 分类 |
| NamespaceRegistry 实现 | registry/src/registry.ts:1222-1275 冻结对象 | — | — | — | 本票 +2 方法（唯一实现者；grep 证零 `implements NamespaceRegistry`/类型字面量） |
| operation/observer 消费 | registry/test（断言既有字面量，registry-create.test.ts:1163 等） | — | — | — | **零改动**（append-only；grep 证无穷尽 switch/never 检查） |
| DocPersistenceWithCreate 等派生 | persistence/src/testing.ts:221 | — | — | — | 接口继承自动兼容，零改动 |

### 风险评估

- 遗漏实现者的代价 = tsc 编译红（TS2420/TS2741）——tsconfig.typecheck.json 覆盖 packages/*/test/**，`pnpm typecheck`（persistence 包含 test/）+ SA6 验收命令（`npx tsc -p tsconfig.typecheck.json --noEmit`）双门禁兜底。
- 抓全方法：`git grep -n "implements DocPersistence\|implements PersistenceIO\|: DocPersistence = {\|PersistenceIO) : PersistenceIO\|=> PersistenceIO" -- 'packages/**/*.ts'`——清单即上表，无第 18 处。

## §10 SA8 观察项 N-1..N-9 回应索引

| 观察项 | 回应节 |
|---|---|
| N-1 两身份参数关系 | §4.7（同形状/纯传递/守卫权威=排空后持久快照/判据单点经结构守卫副本） |
| N-2 bootstrap eligibility 机制 | §4.8.5（key 缺席即资格；无标记/无枚举；stale 重放由守卫拒绝） |
| N-3 词表与授权链 | §4.11.3（append-only；0010:222 授权 + #131 phase 先例；phase 零新增） |
| N-4 受信路径暴露面 | §4.1（公共方法 + 0010:79 信任纪律 + 防绕过四层） |
| N-5 degraded entry 交互 | §4.5.2/§4.5.6（dirty 排空等待；degraded-clean 放行归档已提交字节；degraded-dirty 诚实 pending 尊重 retry；分类：guard/relocate-write 拒绝=operational，relocate-remove=fatal committed:true） |
| N-6 归档路径与 .tmp 清理协调 | §4.9（archive/ 子树；每 key 至多一份 tmp；覆盖式清理；tmp 永非提交态；与主键区清理结构性分离） |
| N-7 切片归位 | §1.1（切片 8 第 2/3 条、15b wire 侧、切片 3-7/9 均不在本票；不顺手实现） |
| N-8 Memory 行为等价操作化 | §4.10（等价面=九组共享断言；恢复面归 File（phase:183）；deleteSnapshot hook + loud 配置门；R-1 回流） |
| N-9 导入后 Runtime 构造 | §4.12（单一构造路径；V2.5 预投影期望与导入核对同判据族；TOCTOU 收编 fatal committed:true；open 零回归） |

## §11 SA6 回流需求清单（交总控转 SA6；非阻塞设计，阻塞转绿）

| # | 文件 | 改动 | 理由 |
|---|---|---|---|
| **R-1**（必须） | `packages/persistence/test/persistence-phase5-archive-red.test.ts`（makeMemoryArchiveFixture）与 `packages/namespace-registry/test/registry-phase5-bootstrap-reset-red.test.ts`（Memory 真实全链闭环 writer 夹具） | 各补一行：`deleteSnapshot: async (key) => { store.delete(key); },` | hook store 是唯一读权威（memory.ts:77 IO-2）；无删除钩子则「归档后主键移除」对外部 store 必然虚假——registry 用例显式断言 `store.has(key) === false`，任何诚实设计都需要夹具提供删除能力。这是锚的前置缺口（SA6 未建模 Memory 的删除面），非设计迁就 |
| **R-2**（必须） | `packages/persistence/test/persistence-phase5-archive-surface.test-d.ts` | 两红锚类型参数 `HasArchiveDoc<DocPersistence>`/`HasImportDoc<DocPersistence>` → `HasArchiveDoc<ReplicaPersistence>`/`HasImportDoc<ReplicaPersistence>`，+`import type { ReplicaPersistence } from '@nomicore/persistence';` | 锚自身内在冲突：同文件的绿守卫（三成员字面量满足 DocPersistence）与「required 成员于 DocPersistence」不可同时成立；required 形态另将击穿 13 个既有冻结测试 stub（tsconfig.typecheck 门禁红）。权威文档未指名接口（phase:62-63/0010:218 只说「Persistence 增加能力」），改锚 `ReplicaPersistence` 后语义等价且更强（required 面） |
| R-3 | 无 | 全部临时拼写原样冻结（§4.11.1 对照表），名/形状零回流 | — |

## 附：SA2 预答区（预判攻击与前置防御）

| 预判攻击 | 前置防御 |
|---|---|
| 「optional 成员 = 契约弱化，SA6 锚明确要 DocPersistence」 | §4.4 三条硬事实（13 stub/三成员绿守卫/既有 wrapIo 字面量）+ 技能 >10-caller 立法 + ReplicaPersistence required 面 + 三处 loud gate；R-2 回流保持锚语义（更强：required 面）。反问预案：required 形态下 SA2 需解释为何修改 13 个冻结测试文件是更优解 |
| 「settle 强制 flush 是否绕过 debounce/retry 纪律」 | 仅跳过 debounce（时序优化，非语义）；retry 回退窗（retryTimer 武装）被动等待、零绕过（N-5 条款「不得以 reset 之名绕过 retry」逐字满足）；排空是「归档含写后值」的唯一诚实途径 |
| 「remove 失败的双副本状态是不变量破坏」 | INV-4 的边界即 relocate-write 提交点；committed:true fatal 诚实陈述；收敛重试幂等论证（§4.5.5）；对比被淘汰的「remove 内联吞错」= 虚假降级 |
| 「强制 lease 失效未获 ADR 授权」 | ADR 0010:57「关闭本地 Runtime generation」+ N-2「entry 清理」的必要组成；SA6 双用例是冻结观测；与 shutdown 差异论证（§6-R5） |
| 「Registry 本地 facts 读取器 = 第二套判据（N-1 违约）」 | N-1 原文「判据应复用 readReplicationFacts 单点（replication-write.ts:213）」——不可 import 的包边界事实 + REPLICATION_ID_PATTERN 双守卫副本先例 ⟹ 判据**语义**单点（同判据族三处副本互引 + 用例锚定），非另立判据 |
| 「归档区 latest-wins 丢数据」 | §4.9/§6-R6：无保留承诺；Hub 备份权威（0010:201）；SA6 无反向锚 |
| 「code 判别取代 instanceof 是类型不安全」 | contract.ts:44 契约自宣示；stub 即 duck-typed（SA6 事实）；真实类双保险；§6-R10 |
| 「回流 R-1 是设计缺陷转嫁」 | `store.has===false` 断言 + 只读 hook 权威 = 夹具必缺删除能力的数学事实（Map.delete 只能来自夹具提供的函数）；SA6 自身改写成本提示（§4.2「每个约 1-3 处」）已预留此类微调 |
| 「13 个 stub 零改动的静态论证靠什么兜底」 | tsc 双门禁（pnpm typecheck + tsconfig.typecheck 全程序）在 SA3 落地即验证；§9 清单 grep 可复现 |
| 「import 复用 create 错误族，message 说 createDoc 误导」 | §4.3 取舍论证：code 为分支面（契约纪律）；message 冻结不可改（EC 用例逐字锚）；Registry 映射后公共面无歧义 |

---

## SA2 R1 反馈逐条回应（R2 修订记录）

评审基线：SA2 攻击评审报告 `wiki/raw/task_phase5-bootstrap-archive-reset_sa2_review.md`（verdict: reject；§五 修订条件 1-4 必须、5 建议）。本修订**只触及报告点名的条目**；D-1..D-14 主体裁决零回退（SA2 §四 已逐项验证闭合）。

### R2-1 逐条落实表

| SA2 条目 | 严重度 | 是否落实 | 修订位置 | 修订内容摘要 |
|---|---|---|---|---|
| #1 settle 排空环 × dispose 永久挂起 | BLOCKER | ✅ 落实 | §4.5.2（通知机制三点规格化 + 矛盾文本更正）、§4.5.3（全程 track + 置 cell 前 assertWritable）、§5 INV-15、§6-R4、§7 lifecycle.ts 清单、§4.14.2 第 9/10 条、本节推演 B1 | ① dispose() 同步段（abort 后的 live-entry 清理循环内、cells.clear() 前同同步块）对每个 live entry `archiveWaiters.splice(0).forEach(w=>w())`——不依赖任何未来 flush；② flush finally 通知语句冻结为**无条件置于 finally 首位**（先于 isCurrent 早退），更正 R1「先于早退、在 maybeEvict 之后」的不可满足表述（现行 finally 早退先于 maybeEvict——单条语句无法两全；首位是唯一同时覆盖正常轮与 dispose-abort 轮的位置），零回归论证在案（非归档路径 waiter 恒空 ⟹ no-op；归档路径 waiter 微任务续体在 finally 同步段完成后运行，观察到 flush 终态）；③ archiveDoc 全程（settle 环 + claim 环 + op 体）包进 track——dispose 的 allSettled 覆盖归档全程且不自等待（通知点 2 先于 allSettled 执行） |
| #2 archiving claim 失败路径清理缺失（key 毒化 + 5 ARC 锚红 + INV-6 不成立） | BLOCKER | ✅ 落实 | §4.5.3（op 闭包 try/catch 全包 + 双路径 identity 守卫清理伪码）、§4.5.5（成功路径善后注释）、§4.5.6（矩阵增「archiving cell 善后」列——全部 10 行逐行补善后状态）、§5 INV-14、本节推演 B2 | op 闭包以 try/catch 全包：catch 侧与成功返回前**同款**执行 `const cur = this.cells.get(key); if (cur?.state === 'archiving' && cur.claim === claim) this.cells.delete(key)` 后 rethrow/返回——逐字节镜像 createDoc 范型（lifecycle.ts:263-268：identity 守卫防 ABA，绝不误删后来者 cell）；置 cell 之前的抛出点（入口 assertWritable/settle 抛 ActiveHandle/claim 环 assertWritable）无 cell 可清理，矩阵逐行注明 |
| #3 seedForTest × archiving 态 | MEDIUM | ✅ 落实 | §7 lifecycle.ts ALLOW 清单（明文列入） | 守卫扩为 `reading/creating/archiving` 一律抛 `'test seed requires an idle key cell'`（文本不变）——堵死「归档在途 seed 以 cells.set 覆写 archiving cell → relocate 继续 remove 主键而 live entry 仍在」的测试缝击穿（phase:63 前置）；零回归：基线无 archiving 态（§4.14.2 第 11 条） |
| #4 Memory 归档键与主键空间同池碰撞 | MEDIUM | ✅ 落实（采纳 SA2 方向 ① 的强化变体 ①′） | §4.10 头部 + 新增 §4.10.1（碰撞分析/裁决/锚定兼容性/被淘汰方向 ②）、§2 D-10 行、§4.13、§5 INV-4 强化、§7 memory.ts 清单 | 归档副本存**独立 `archiveSnapshots: Map`**（以主键为键、与主 mirror 结构性分区）且 `writeArchive` **不经 writeSnapshot hook**（hook store 不再收到任何归档键）——mirror 与 hook store 两处碰撞面同时结构性消解（仅分区 Map 而保留 hook 路由的变体 ① 不充分：hook store 内 `archive\0…` 键仍可被病态主键命中）。锚定兼容性逐一核对：SA6 Memory 断言无一要求归档副本出现在 hook store。被淘汰方向 ②（baseIo 入口拒 `\u0000` 段）：为 Memory 新增输入文法收窄（破坏现状契约、需全量排查既有测试），①′ 以 ~3 行零输入面变化实现同等消解；mirror 既有二义为前存量，记录不扩权修复 |
| #5 归档 fatal 判别通道混用（duck-typed fatal 的 committed 被改写） | LOW（建议随修） | ✅ 采纳 | §4.8.3（fatal 分支改 code-first + committed 布尔读取规则）、import 映射段同步、§5 INV-12 强化 | fatal 分支同样 code-first：`code === 'DOC_ARCHIVE_FATAL'`（instanceof 双保险）时 committed 取 `typeof cause.committed === 'boolean' ? cause.committed : false`——duck-typed 第三方 Adapter 的 relocate-remove committed:true 不再落入 unknown 分支被改写为 false；缺席/非布尔保守 false（镜像 create unknown 分支方向）；import 侧 DOC_CREATE_FATAL 同款 |
| #6 importReplica 接纳段未显式规格化 | LOW（建议随修） | ✅ 采纳 | §4.2「接纳段（R2 增补冻结）」 | 补一句冻结：acceptance 检查（零输入访问）→ validateOpenIdentity（零 entries/carriers/Persistence/Runtime 访问）→ carrier FIFO 接纳——与 open/reset 同款同步段；File 侧 SAFE_PATH_SEGMENT 第二道门的编排侧对应物显式在案 |
| #7 import 对 closing entry 不等待 | INFO | ⛔ 维持原设计（留档） | 本节 R2-2 | 有意镜像 create ① 的碰撞策略（active/idle/closing 一律 ALREADY_EXISTS、不等待 closePromise）：外来 idle-close 在途时 import 得稳定拒绝、调用方重试即成功——与 ADR 0009:34「open/create 互相排序，但后项不继承前项失败」同族；等待反而引入「import 依赖他人 close 结算」的新耦合。SA2 定性「稳定且诚实，记录即可」 |
| #8 TOCTOU（复制字段在 ②b 与 encode 间变异） | INFO | ⛔ 维持原设计（留档） | §4.2 TOCTOU 声明（原文） | SA2 独立核实成立（「createDoc 从不校验复制字段，import 的可逃逸核对不劣于既有暴露面；受信调用方模型 0010:79 内闭合」）——零改动 |
| #9 强制 lease 失效的观测噪声（entry-idle 假事件） | INFO | ✅ 采纳轻量抑制 | §4.8.2（forceReleasing 闭包旗标）、§7 registry.ts 清单、§4.14.2 第 11 条 | registry.ts 闭包旗标 `forceReleasing`（槽内置位/finally 清位，零 lease.ts 改动——handleLeaseReleased 本就是 registry.ts 闭包）：命中即跳过 idle 武装与 entry-idle 事件（该 entry 事实上从未 idle，抑制是**更诚实**的观测）；`lease-released` 事件照发（真实事实）。被淘汰：phase 预翻 'closing'（违反 I2 先赋值后翻相）；不处理（假 idle 事件会误伤未来 observer 计数测试） |

### R2-2 BLOCKER 场景在修订机制下的逐步推演（SA2 §二 脚本重放）

**B1（对应 #1）：degraded retry 武装 + 零在途 flush + dispose**

SA2 脚本前 3 步照演：saveDoc → flush 失败 → degraded、retryTimer 武装、flushing=false、handles=0；archiveDoc → settle 见 `retryTimer !== undefined` → 不 startFlush → `await archiveWaiters`（此时 op 未建，但 **R2 的 track 已在 archiveDoc 公共入口包住全程**——settle 等待在 inFlight 内）。第 4 步起按修订机制重放：

4′. `dispose()` 同步段：`closed=true; epoch+=1; abortController.abort()` → live-entry 清理循环：`clearTimers(entry)`（retry timer 取消）→ **`entry.archiveWaiters.splice(0).forEach(w=>w())`（R2 通知点 2）** → `cells.clear()` → `await Promise.allSettled([...inFlight])`（inFlight 含被 track 的 archiveDoc 全程）。
5′. waiter 的 resolve 把 settle 循环续体排入微任务；dispose 同步段（含 cells.clear()）先完成。
6′. settle 续体运行：`cells.get(key)` → undefined（已 clear）→ 退出循环 → claim 环入口 **`assertWritable()`（R2 新增置 cell 前重检）** → `closed===true` → throw `Error('persistence is disposed')`。
7′. 被跟踪的 archiveDoc promise 以该错误 reject → inFlight 移除 → dispose 的 allSettled 返回（dispose 不挂起——通知点 2 先于 allSettled，无自等待）。
8′. Registry 链：reset 槽 await archiveDoc → 捕获 bare error（unknown，无 code）→ `NamespaceRegistryFatalError('reset','lifecycle-slot-internal', false, cause)` reject → 槽结算 → carrier.tail 结算 → runShutdown 的 `await carrier.tail` 返回（registry shutdown 不挂起）。

**结论：SA2 场景在修订机制下每一步都有确定的结算路径，「永久挂起」不成立（INV-15）。** 附带覆盖：dispose 撞在途 flush 时的同构推演——flush 被 abort → 其 finally **首位**通知（通知点 1，先于 isCurrent 早退）→ settle 醒 → cells 已 clear → 同 6′-8′ 收口；两通知点互为冗余兜底。

**B2（对应 #2）：identity-mismatch 归档拒绝后的 key 状态**

SA2 脚本照演至第 2 步：claim 环置 `{state:'archiving', claim}` → op 内 verify 抛 `DocArchiveIdentityError`。按修订机制重放：

3′. op 闭包 catch 侧（R2）：`cur = cells.get(key)` → `archiving` 且 `cur.claim === claim` → `cells.delete(key)` → rethrow 原拒绝 → op reject → `claim.promise` 结算为绿尾。
4′. 随后 `loadDoc`（ARC:280 断言点）：fast path 非 live → `resolveLoad` → `cells.get(key)` → **undefined**（3′ 已删）→ 走全新 read ticket → 读到 committed snapshot → live entry → 返回非 null handle——有限微任务内结算，**无限循环结构性不可达**（循环的前提「cell 仍是 archiving 且 claim 已 settle」被 3′ 消除）。
5′. 同 key `createDoc/importDoc`：claim 环见 undefined → 正常探读 → 见快照 → `DOC_DUPLICATE`（SA2 §六.2 建议的补充锚形态）。
6′. Registry 侧：`code === 'DOC_ARCHIVE_IDENTITY_MISMATCH'` → `NAMESPACE_RESET_IDENTITY_MISMATCH` issue；随后 `open`（SA6 REG identity-mismatch 用例）→ entry 缺席 → loadDoc 正常 → 新 generation → META/ROOT 零改动可读——**INV-6 在真实 persistence 下成立**。

**结论：五个 ARC 锚（:280/:305/:331/:442/:549）机械转绿、key 零毒化（INV-14）。** 其余拒绝分支（operational/fatal/disposed 后续段/seam 违约）与成功路径走同一 catch/成功善后或「置 cell 前无 cell」入口，§4.5.6 矩阵逐行注明。

### R2-3 其余留痕

- **修订范围自检（技能「一致性自检」）**：全文检索 `archive\0`/archive-scoped key——仅存于 §4.10.1 被攻击形态的引述与被淘汰论证（不再有任何落位）；`先于 isCurrent(epoch) 早退、在 maybeEvect` 旧表述已替换；D-10（§2 表）与 §4.10/§4.13/§5-INV-4/§7 四处 Memory 表述一致（独立 Map 分区 + hook 旁路）；§4.5.3/§4.5.5/§4.5.6 三处善后表述同源（identity 守卫删除）；§7 lifecycle.ts/memory.ts/registry.ts 三条 ALLOW 行已同步 R2 增项。
- **SA2 §六 红灯测试思路对接**：B1/B2 推演与 SA2 建议 1/2 的断言形态一致（有限微任务结算 race 判定 / 拒绝后 loadDoc 非 null + createDoc 得 DUPLICATE）；建议 3（seedForTest×archiving）由守卫扩展直接满足；建议 4（Memory 碰撞）在 ①′ 分区下成立（同池实现才红）；建议 5（duck-typed fatal committed 传播）由 code-first 判别满足——均可作为 SA4/SA6 的补充锚输入，不改变本设计的回流清单（R-1/R-2 之外零新增测试回流）。
- **行数变化**：R1 = 1053 行 → R2 = 本文件现行行数（修订净增约 130 行：§4.2 接纳段 3 行、§4.5.2 通知机制 16 行、§4.5.3 重写 +26 行、§4.5.6 矩阵 +10 行、§4.8.2/§4.8.3 +18 行、§4.10.1 +16 行、§5 +6 行、§6/§7/§4.14.2 微调 +12 行、本修订记录节 ~45 行）。
