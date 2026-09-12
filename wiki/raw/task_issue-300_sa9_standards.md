# SA9 Standards 审查报告 — Issue #300（feat：#295 切片 2：chunked BOOTSTRAP_SNAPSHOT / SYNC_STEP2 端到端）

> SA9（独立 Standards 审查者）standards-review 轮产物。dispatch
> `sa-65ef53a3-8e31-4032-a044-2c84d4862aeb`，phase standards-review，iteration 0。
> **Worktree**: `/home/wangjian/nomicore-fix-issue-300`。
> **被审对象**: 已提交 HEAD `749de8e8a40a133ec3ed2118deb7efa349307317`
> （`feat(replication): chunk oversized snapshots and sync diffs`）的完整交付 diff
> `605a48f..749de8e`——25 文件 +4780/−221（`git show --stat` 本轮亲证）：9 个生产源文件
> （含新增 `bulk-transfer.ts`）、5 个测试文件（含 SA6 契约新增 + bulk-edge 探针新增 +
> 场景 14 改写 + driver 旋钮 + issue242 注册表同步）、1 行协议文档 §22 收口、
> 9 个 wiki/raw 流水线产物。父提交 `git rev-parse HEAD~1` = `605a48f284c856033761cd2320fa937d1e8c9f0a`，
> 与 dispatch 声明的 stable parent PR #298 head 逐字一致（亲证）。
> **Issue 评论输入**: dispatch 明示 REST comments 读 = 无；简报 §Comments 空、
> SA6 §2、SA2 §4、SA3、SA4 §1 同口径——无 Owner 追加要求需并入。
> **输入产物（全部亲读）**: `task_issue-300.md`（简报，What to build + AC1–AC5）、
> `task_issue-300_relevant_decisions.md`（SA8 前置摘录 R42–R47/N6）、
> `task_issue-300_design.md`（SA1 r1 全文 568 行，D0–D12 + §11 验收矩阵 + §12 ALLOW/DENY
> + §14 修订映射 + §15 复查焦点）、`task_issue-300_sa2_review.md`（approve r1 复审，
> B1/M1–M5 全部落实）、`task_issue-300_sa3_impl.md`（含 iteration 3 格式化修复记录）、
> `task_issue-300_sa4_review.md`（approve，0 BLOCKER/MAJOR，5 非阻塞观察 + 4 动态验证项）、
> `task_issue-300_sa6_contract.md`（approve，8 红 + 4 负控，§13 转绿判据）、
> `task_issue-300_sa7_report.md`（approve）、SA8 门禁两份（前置 clear；implementation
> 复查 clear，R48/R49/N7 非阻塞）、规范基线 ADR 0022 全文、ADR 0010/0013 相关节、
> 协议 §8.1/§8.2/§9.2/§9.4/§10.3/§13.2/§17/§18/§22/§23 原文、根 `AGENTS.md`、
> `docs/AGENTS.md`、两包 `AGENTS.md`、`REPORT.md` L229 whitespace 门定义。
> **审查方式**: 独立取证，非结论复用——交付 diff 全量亲读（生产 9 文件逐行 +
> 测试/doc 逐行）；四码冻结值与协议 §13.2 L445–448 逐值比对；DENY 清单用
> `git diff 605a48f..749de8e --stat -- <路径>` 反向亲证（零输出）；`.only/.skip/.todo`
> 扫描（4 个触及测试文件全零）；过期术语扫描（`后续切片交付`/`本切片唯一 kind`/
> `不预设其存在` 规范面零命中）；`git diff 605a48f..749de8e --check`（干净 exit 0）；
> 公共导出面（`src/index.ts` × 2 包零 diff，`chunkedUpdate` 为 #243 既有公共旋钮）；
> `as any`/活 Y.Doc 扫描（零命中）；vitest include 收集入口亲读。未运行测试、未启动
> 服务（SA9 纪律）；零代码/设计/测试改动；零 commit/push/PR；唯一写入 = 本文件。
> **职责面**: 只判断实现是否符合仓库 AGENTS、ADR、模块责任、既有架构惯例、单一事实源、
> 生命周期对称性、文件范围与测试质量标准；Issue 需求完整实现归属 SA10。

---

## Verdict

**approve**（`requiresConflictRecheck: false`）

- **0 BLOCKER / 0 MAJOR / 0 MINOR**。交付在 AGENTS 链、ADR 保真、模块责任、
  架构惯例、单一事实源、生命周期对称性、文件范围、测试质量八个 standards 面全部
  合规（§1–§8）。残留 6 条非阻断观察见 §9（含 1 条 nit、2 条流程面、3 条既有登记项）。
- 交付 diff 与设计 r1 §12 ALLOW 台账**逐条一致**（§6 亲证）：16 个代码/测试/文档路径
  全部落 ALLOW；DENY 全清单零触碰（含刻画文件、契约文件、codec 形态面、配置链、
  error-mapping/frame-io/backpressure、registry/runtime、docs/adr、CONTEXT.md）。
- D0–D12 全部按批准设计落地且与 ADR 0022、协议冻结文本同向；四码注册表首登逐值 =
  §13.2 L445–448 冻结行（append-only，既有行零改动）。
- 流程面合规：SA6 契约 approve → SA8 前置门禁 clear → SA1 设计 → SA2 approve（r1）→
  SA3 实现（含 iteration 3 格式化修复披露）→ SA8 implementation 复查 clear →
  SA4 approve → SA7 approve——审查链完整，无跳级、无未决阻断项。

---

## 1. AGENTS.md 链合规

| 规约 | 本轮亲证 | 判定 |
|---|---|---|
| 根 AGENTS「Module guidance：读最近嵌套 AGENTS」 | 两包 AGENTS + docs/AGENTS 均亲读并逐条对照（下行各表） | ✅ |
| replication-protocol AGENTS「compatibility registries append-only；never renumber or silently reinterpret」 | `errors.ts`：`_namespaceErrors` 尾部 append 四行（SNAPSHOT/SYNC_TRANSFER_{VIOLATION,TOO_LARGE}），既有 22 行零改动（diff 亲证）；四值与协议 §13.2 L445–448 逐字一致（VIOLATION=yes/no/failed、TOO_LARGE=yes/config/failed 逐值比对）；`NamespaceErrorCode` 联合同步 +4 字面量；计数注释 22→26 三处 | ✅ |
| replication-protocol AGENTS「strict, fail-closed decoding」 | codec 形态面（payloads/messages/index.ts、golden、issue299）零 diff（DENY 反向亲证）；四码由注册表首登获得可编码性，ERROR 帧 encode↔decode 往返断言新增于 issue242 测试（契约 R4/R6/R7 的 wire 码断言路径成立）；未注册码仍 fail-closed | ✅ |
| replication-protocol AGENTS「Add public APIs only through `src/index.ts`；exported types and runtime codec behavior must evolve together」 | `src/index.ts` 零 diff；联合类型（既有导出类型的成员扩展）与注册表运行时行为同提交同步演化 | ✅ |
| replication-protocol AGENTS「Wire changes require old/new interoperability evidence + root typecheck/test」 | wire 形态零变化（本票只消费 #299 冻结的 kind 首字段单形态）；v1 代际端 0x42 照旧 pre-parse `UNSUPPORTED_MESSAGE_TYPE`（负控 N3 + 互通矩阵锚保持绿，SA3/SA7 日志）；root `pnpm typecheck` exit 0、root `pnpm test` 3486 绿（SA3/SA7 双轮） | ✅ |
| ws-replication AGENTS「Preserve protocol ordering and FSM invariants」 | 零新 namespace 状态（协议 §16：分块不新增状态、assembly 进度对状态机不可见——实现经 busyKind/载体相位承载，state 字段零新增）；sequence/sync-round 计数器不回绕（`transferIdAvailable()` uint32 守卫 + ownStep2Seq 锚同一同步栈赋值）；终态 channel 仅新连接重开（未触碰） | ✅ |
| ws-replication AGENTS「transport 层不得直入 Runtime/Persistence/snapshot/live Y.Doc」 | 重组交付 = detached buffer → 既有 `applyRemoteUpdate`（trusted sequenced apply）/ `finishBootstrapImport` → `registry.importReplica`（排他导入，与单帧路径同一导入语义）→ `tryOpenReplicationSession`——全部经公共 Registry lease/ReplicationSession seam；diff 面 `Y.Doc` 仅出现于注释与既有单帧路径抽取（detached scratch doc，基线同款）；grep 活 Y.Doc 内部访问零命中 | ✅ |
| ws-replication AGENTS「ACK = sequenced live apply + dirty registration」 | BOOTSTRAP_ACK/SYNC_APPLIED 均在「收齐 → 长度精确核对 → **一次** apply/排他导入成功」之后结算，ackedSequence = 末 chunk 帧序；重组失败先于 apply（live 零写入） | ✅ |
| ws-replication AGENTS「admission bounded…observable concurrency contracts」 | 窗口/闸门/队列/assembly 槽全部复用既有单点：bulk 首 chunk 判据含 `effectiveInFlightCount() < maxInFlightUpdates` 与 `dataGateOpen()`；facet `queuedBytes/queuedCount` 聚合 bulk 载体（shed 账本可见）；接收端 per-kind 聚合上限 + `maxChunksPerUpdate` + 连接级并发槽全四条首 chunk 校验；control reserve 结构性零 chunk | ✅ |
| ws-replication AGENTS「Export production APIs through `src/index.ts`」 | `BulkTransferSender`/`chunkedViolationCode`/新 seam（`hasBulkTransferWork`、`RoundHost.sendStep2`、`allocateTransferId`）均包内私有——两包 `src/index.ts` 零 diff（grep 亲证零导出命中）；driver 透传的 `chunkedUpdate` 为 #243 既有公共选项（peer-connection.ts L396 基线即在） | ✅ |
| docs/AGENTS「code behavior changes → update every normative document whose stated contract changed；wording changes must not invent implementation behavior」 | 规范契约已在父 base 冻结；本票义务面 = §22 L701 一行收口：传输层 kind=1/2 资产支从「后续切片交付…不预设其存在」改写为引用**同提交内在仓**的三资产（契约文件/bulk-edge 探针/场景 14 锚——三路径本轮实测存在）；§13.2/§23.3 表本体零 diff（diff 上下文亲证） | ✅ |
| docs/AGENTS「Use repository vocabulary exactly」 | 新注释/文档用词（绑定块、单形态、改道、族中性、刻画文件、整笔占 1 个 in-flight 窗口槽、有效占用口径）全部取自 CONTEXT.md 词条与协议既有表述；零新术语发明，CONTEXT.md 同改义务不触发（DENY 与实测一致） | ✅ |

## 2. ADR 保真（交付逐条对照 ADR 0022 决策节）

| ADR 0022 / 协议决策 | 交付落点 | 判定 |
|---|---|---|
| 恒用机制：超单帧上限的 snapshot/diff 一律分块；未超上限仍走单帧（触发条件，非兼容回落） | hub `startBootstrap` 三分叉（L573–604）与双侧 `sendStep2` 三态裁决：`≤ maxBootstrapBytes`/`≤ maxSyncDiffBytes` 走既有单帧路径（sendChecked + observer 逐字节不变，HB3/PN11 锚原位保留）；超限 ∧ 已协商 ∧ ≤ 聚合上限 → kind=1/2 enqueue；负控 N1/N2 锁定界内零 0x42 | ✅ |
| 同版本部署：sync 段不新增 capability bit、不协商、不 gating；v1 门保持 | 零新 capability/协商面 diff；未协商 ∧ 超限 → 既有 `BOOTSTRAP_TOO_LARGE`/`SYNC_DIFF_TOO_LARGE` 终局原样（D0）；解码侧 pre-parse 门零改动（frame-io DENY） | ✅ |
| 首 chunk 绑定块：kind=1 replicationId/epoch 对 OPEN_OK；kind=2 syncRoundId 对 round | peer `admitBootstrapChunk`：状态门（bootstrapping ∧ openOkIdentity）→ 逐字段核对 → `REPLICATION_ID_MISMATCH`/`REPLICATION_EPOCH_MISMATCH` + failed/protocol-violation（R5 裁定）；双侧 `admitChunkedStep2`：`hasActiveRound ∧ syncRoundId === currentRound ∧ ownStep1Seq ≠ undefined ∧ !receivedStep2`，不符 → `SYNC_STATE_VIOLATION` + failed（§9.3 语义不动）；绑定块先于一切资源判定 | ✅ |
| 发送端规则与 §10.3 逐字同构：惰性切片、独立 sequence、dataGateOpen、RR、整笔 1 in-flight 槽、ACK 锚 = 末 chunk | `BulkTransferSender`：入队持完整载荷（facet 账本可见）、`pullOne()` 出队时刻 `chunkBounds` 切片（复用 update-transfer 纯函数）、每调用恰一帧经 `sendChunk → sendUpdateChunk → tryEmitData`（独立 sequence/ready 门/水位闸门）、首 chunk 判窗口空位、中段不复查（同构 ③a）、`onLastChunkSent` 同一同步栈回填锚（hub `bootstrapSnapshotSeq` / round `noteChunkedStep2Outbound`） | ✅ |
| control reserve 零 chunk | 结构性成立：bulk 出站只经 data 路径（`sender.tryEmitData`），control 队列零触碰；`maxQueuedControlBytes ≥ maxBootstrapBytes + 开销` 校验零 diff（validate.ts DENY 保持） | ✅ |
| 接收端：首 chunk 分配前全四条校验（按 kind 聚合上限、chunkCount、几何、≥1）→ 一次性 detached buffer；跨帧逐字节一致；收齐精确核对后一次 apply；失败零写入 | `UpdateChunkAssembler` kind 泛化：`validateFirst` 按 kind 取聚合上限（`aggregateLimitFor`，未配置 = 响亮编程错）；busy 跨帧规则增 `transferKind` 逐字节一致（族按在途 kind）；`completeIfExact` Σbytes 精确核对；控制器侧 chunkCount 门 + 连接级槽前置（既有 #244 门原样扩展错误族）；complete → 恰一次 `applyRemoteUpdate` / `completeChunkedStep2` / `finishBootstrapImport` | ✅ |
| assembly 作用域/并发上限逐字沿用；bootstrap 期无 Lease 按 namespaceId 记账 | 单 assembler per (ns,方向) 不变量保持（facet 仲裁使跨 kind 互斥，busy∧异 id/kind → violation 兜底）；连接级 `tryBeginInboundAssembly` 槽与 kind 无关；bootstrap 期接纳只依 OPEN_OK 身份 + namespaceId | ✅ |
| 配置链：两聚合键 + 三机制键 kind 无关键名不变；零新配置 | defaults/types/validate 零 diff（DENY）；实现只消费 `host.limits.maxChunkedBootstrapBytes/maxChunkedSyncDiffBytes`；`assemblyTimeoutMs` kind 无关滑动 deadline 复用既有 assembly timer | ✅ |
| 错误码 append-only 四码 + `SYNC_TRANSFER_EXPIRED` reason；超时按段收口 | 四码首登（§1 已证）；`onAssemblyTimeout` 按 `busyKind` 选路：kind=0 → `UPDATE_TRANSFER_EXPIRED`（原样）、kind=2 → `RESYNC_REQUIRED{SYNC_TRANSFER_EXPIRED}` 非终态（§9.4 L270 已登记词表）、kind=1 → `BOOTSTRAP_FAILED` + `finalize('failed','bootstrap-timeout', assemblyTimeoutMs)` 终局（§8.1/§18） | ✅ |
| `BOOTSTRAP_TOO_LARGE`/`SYNC_DIFF_TOO_LARGE` 死码保留；刻画文件不动 | 两码注册表行零改动；v1 触发面保持（ac3-bootstrap L92 锚、互通矩阵、issue233 刻画文件三件套零 diff 亲证）；场景 14 按 §23.3 L814 授权改写为协商 + 超聚合构型（SNAPSHOT_TRANSFER_TOO_LARGE + 零回落断言） | ✅ |
| Observer seam 8 型归 #301（R46）；改道窗口普通族归零 | 8 型零发射（接线归 #301）；归零机制本票落实：kind=1 路径 `emitImported=false`（零 `bootstrap-imported`）、M1 `syncChunked` 门（kind=2 完成点零 `sync-diff-applied`）、单帧路径 HB3/PN11/HB10 逐字节保留、`clearInboundAssembly` aborted 事件 `busyKind === 0` 门 | ✅ |
| ADR 0010 基线：排他导入/identity fencing/停机顺序 | `finishBootstrapImport` 为单帧路径逐字节抽取（importReplica → epoch 判别 → tryOpenSession → ACK → reconciling + startRound 次序不变）；fence-watchdog/lifecycle-queue/error-mapping 零 diff | ✅ |

## 3. 模块责任与既有架构惯例

| 检查项 | 本轮亲证 | 判定 |
|---|---|---|
| kind=1/2 发送端载体归属命名空间通道域 | 新 `bulk-transfer.ts` 与 `UpdateChannel` 刻意分离（文件头注释载明 D1 备选①拒绝理由：结算帧/失败族/记账语义不同构）；宿主 seam 只读判据（窗口/闸门/计数器/计时器）全部委托既有单点 | ✅ |
| 接收端 assembly 单一归属 | `update-transfer.ts` 仍为接收端唯一事实源；族中性原因 × kind → 冻结码的映射单点 `chunkedViolationCode` 同模块；控制器只透传结果码 | ✅ |
| round 语义归属 RoundEngine | `admitChunkedStep2`/`completeChunkedStep2`/`noteChunkedStep2Outbound` 三 seam 在引擎内；宿主裁决三态（`Step2SendOutcome`）；refused → `RoundAborted` 沿用既有「宿主已收编」纪律；`void completeChunkedStep2` 与既有 `void applyStep2Safely` 同款 fire-and-forget | ✅ |
| hub/peer 镜像对称惯例 | facet 三段仲裁、`admitUpdateChunk` 后段、`handleAssemblerResult` kind 分派、`onAssemblyTimeout` busyKind 选路、resync 三族挂点、teardown 追加——双侧逐义对称（角色差异仅 declareHubResync/declareLocalResync 与 kind=1 上下文有无，与既有镜像惯例一致） | ✅ |
| 连接层镜像对称惯例 | `sendUpdateChunk` 双侧同形透传（kind 首字段 + 绑定块 iff 展开；kind=0 字段集与 wire 字节逐字节同构；缺失绑定成员由 codec MALFORMED_FRAME 响亮拒绝 → M5 收口） | ✅ |
| cast/`any` 纪律 | diff 面 `as any` 零命中；新增 3 处 `as`：2× `'UPDATE_CHUNK' as const`（字面量收窄惯例）+ 1× 模板串 `as ChunkedTransferViolationCode`（六组合全在联合内、单点映射、codec 对未注册码 fail-closed 兜底） | ✅ |
| 相似能力对照 | M5 出站被拒镜像 #243 send-failed 族（采样先于弃置 → 弃置 → kind 收口）；M2 resync 边沿与 channel 同一挂点三族；shed 处置 kind=1 → BOOTSTRAP_FAILED 族 / kind=2 → resync 边沿族（与既有 live shed 行合流） | ✅ |

## 4. 单一事实源

| 事实 | 权威源 | 派生面 | 漂移风险 |
|---|---|---|---|
| transferId 计数器 | `UpdateChannel.nextTransferId`（R42） | `allocateTransferId()` 包内单点被 kind=0 `startTransfer` 与 `BulkTransferSender` 共用；teardown 归 1 单点不变 | 无（R2 跨 kind 严格递增断言常驻） |
| 切片几何 | `chunkBounds`/`chunkCountOf`/`geometryConsistent`（update-transfer） | 两发送器共用，零复制 | 无 |
| 违例码族映射 | `chunkedViolationCode` | 双侧控制器首 chunk 门/残渣门/assembler 结果全经同一映射 | 无 |
| 错误码注册表 | `errors.ts`（§13.2 字节层） | `fixtures.ts` 镜像 +4（codec-registries 键集等价断言 fail-loud 兜底）；issue242 计数 26 | 无 |
| 配置缺省/校验 | `defaults.ts`/`validate.ts`（#299 基线） | 零 diff；实现只读 `host.limits` | 无 |
| wire 冻结值 | 协议文档 | 注释为指针（§8.1/§9.2/§10.3/§13.2 锚），非规则副本 | 无 |

无第二计数器/第二调度器/第二 assembly/第二 ACK 记账面引入。

## 5. 生命周期对称性

| Start/acquire | Stop/release | 对称性亲证 |
|---|---|---|
| `bulkTransfer` 构造（与 channel 同点） | `teardown()` 三调用点（hub `closeSessionAndRelease`；peer `tryOpen` 新代 session 建立 + `cleanupResources`）——与 `channel.teardown()` 逐点并列 | ✅ |
| enqueue（载体在位） | `settle(1)`（hub onBootstrapAck）/ `settle(2)`（双侧 onSyncApplied）——无载体 no-op；abort 面 = teardown/shed/resync-declared 三族/出站被拒（M5）/kind=2 ACK 超时自弃 | ✅ |
| kind=2 自持 ACK timer（末 chunk 出站武装） | `disposeCurrent()` 全出口拆除（settle/abort/被拒/超时回调内） | ✅ |
| kind=1 等待期 | 不武装自持 timer（结构性负控）：宿主 bootstrap timer 武装点前移至 enqueue（覆盖排队+传输+ACK 等待），`onAckTimeout` 回调不可达 | ✅ |
| 连接级 assembly 槽（`tryBeginInboundAssembly`） | `endAssemblyScope` 唯一归还点 + `assemblySlotHeld` 镜像旗标（既有 #244 闭环原样，首 chunk 违例/单 chunk 收齐同一同步段归还） | ✅ |
| `bootstrapChunkBinding`（kind=1 admit 置位） | complete 消费即清 + `clearInboundAssembly` 全出口复位 | ✅ |
| `chunkedStep2RoundId`（admit 捕获） | complete 消费即清 + `resetState`/`teardown` 全出口复位 | ✅ |
| in-flight 窗口槽（首 chunk 判据） | 整笔占 1 槽至结算 ACK：facet 仲裁 ② 持位（awaiting-ack 仍 `hasWork()`）+ M3 `onAck` 唤醒扩展（空队列 ∨ bulk 待发 → drain）；设计 D1 明示以仲裁落地（非 channel 裸 inFlight 注册），SA2 S6 并发攻击核验单 transfer 不变量结构性成立 | ✅ |

## 6. 文件范围（ALLOW/DENY 对照提交 diff）

| 交付路径面 | 设计 r1 ALLOW/DENY | 本轮亲证 | 判定 |
|---|---|---|---|
| `replication-protocol/src/errors.ts` | ALLOW 行 1（D12） | append-only 四行 + 联合 + 注释 ×3；既有行零改动 | ✅ |
| `replication-protocol/test/{fixtures.ts, codec-issue242-ac-red.test.ts}` | ALLOW 行 2/3 | 镜像 +4 + 计数 26 + 四码元数据/作用域/往返断言；golden/消息 fixtures 零触碰；抽样锚保留（20→22→26 既定维护路径） | ✅ |
| `ws-replication/src/bulk-transfer.ts`（新增） | ALLOW 行 4 | D1 载体 + M5/M2 abort 面；包内私有 | ✅ |
| `ws-replication/src/{update-transfer,update-channel,round-engine,hub-namespace,peer-namespace,hub-connection,peer-connection}.ts` | ALLOW 行 5–11 | diff 逐行吻合 D2/D3/D5/D6/D7 + M1/M3；加法式扩展，kind=0/单帧/else 路径逐字节保持 | ✅ |
| `ws-replication/test/driver.ts` | ALLOW 行 12（M4） | 可选 `chunkedUpdate?` 条件展开、undefined 零传 | ✅ |
| `ws-replication/test/ws-replication-issue256-namespace-failed.test.ts` | ALLOW 行 13 | 仅场景 14 改写（三要素齐备）；文件其余场景零 diff | ✅ |
| `ws-replication/test/ws-replication-issue300-bulk-edge-ac.test.ts`（新增） | ALLOW 行 14 | M1/M2/M3/M5 六探针 | ✅ |
| `docs/protocols/instance-replication-v1.md` | ALLOW 行 15 | 恰 §22 L701 一行替换；表本体/邻行零触碰 | ✅ |
| SA6 契约 `ws-replication-issue300-chunked-sync-ac-red.test.ts`（新增入库） | DENY（实现不得改断言） | 1085 行 / 12 `it(` / 用例名 R1–R7 + N1–N4 与 SA6 §12.1/12.2 逐条对应；零 skip/only/todo/env；SA3/SA4/SA7 三轮「未改一行」独立 attest（SA6 本票未锁 sha256，结构签名比对代替） | ✅ |
| DENY 面：刻画文件 `issue233-repro`、`issue137-driver`、codec 形态面（payloads/messages/index/golden/issue299）、`{frame-io,error-mapping,backpressure,defaults,types,validate,plugin,liveness,fence-watchdog,lifecycle-queue,observer,testing,index}.ts`、`namespace-registry/**`、`namespace-runtime/**`、`docs/adr/**`、`CONTEXT.md`、`apps/**`、`domains/**`、`scripts/**`、根配置 | 冻结 | `git diff 605a48f..749de8e --stat -- <全清单>` 零输出亲证 | ✅ |
| wiki/raw 9 产物 | 流水线固定产物 | 与 #299/#246 等合并先例一致（证据面非规范契约） | ✅ |
| whitespace 门（REPORT.md L229） | — | `git diff 605a48f..749de8e --check` exit 0；committed sa6_contract.md L81 尾随空格修复已入库（grep `[ \t]+$` 零命中） | ✅ |

## 7. 测试质量标准

| 检查项 | 本轮亲证 | 判定 |
|---|---|---|
| 削弱标记 | 4 个触及测试文件 `.only/.skip/.todo` 零命中；零 env override、零 fallback（纪律头注 + 扫描） | ✅ |
| 断言强度 | 契约 R1–R7：wire 帧 decode 结构断言（kind/transferId/chunkIndex 序列/Σbytes/几何/每帧上限）、namespace 状态、live Y.Doc 值逐字收敛、dirty 计数、恰一 ACK 锚末 chunk 帧序、边界恰在上界接纳（off-by-one 双向敏感）；负控 N1–N4 锁定触发条件/协商门/kind=0 等价；零源码字符串/正则断言 | ✅ |
| bulk-edge 探针质量 | M3/M5 用真实包内类 + 确定性 fake host（`UpdateChannel`/`BulkTransferSender` 直接实例化，字段级 `toEqual` 失败明细 + 恰一次回调 + 零自旋断言）；M1/M2 真实 harness（observer 在场注入 + wire 解码 + 收敛值）；M3-b 为 R47 等价负控（无 bulk 工作零 drain/照旧 drain） | ✅ |
| 场景 14 改写合规 | §23.3 L814 冻结授权（「回归锚场景 14 由实现 ticket 改写」）；三要素齐备（协商前提 = driver 旋钮、超聚合构型、新码 + `send-failed` + **零 BOOTSTRAP_TOO_LARGE 回落**断言）；v1 路径独立锚 `ac3-bootstrap.test.ts` L92 保留可测 | ✅ |
| 内部 src 导入惯例 | bulk-edge 的 `../src/*` 导入与仓内 9+ 既有测试文件同款（issue169/issue238/issue243-sa7 等先例） | ✅ |
| 收集入口真实性 | 两新测试命中根 vitest `include: packages/*/test/**/*.test.ts`（config 亲读） | ✅ |
| 执行证据 | SA3：契约 12/12 绿（8 红转绿）、ws-replication 70 文件 499、replication-protocol 12 文件 206、两包 tsc + 根 typecheck + 根 pnpm test 3486 全绿；SA7 独立复跑（含探针在场 507、post-removal 499 + 22/22 聚焦）互证。SA9 按纪律不复跑测试，静态面本轮独立复核全部成立 | ✅ |

## 8. SA4/SA7 批准面 == 已提交 HEAD（一致性核验）

SA4 于工作树批准实现（0 BLOCKER/MAJOR）；SA7 approve 后工作树变更集合 = SA3 声明
（13 M + bulk-transfer.ts + 2 测试新增 + wiki 输入）。本轮核验提交 `749de8e`：
`git diff --name-only` 25 路径与 SA3 §Changed paths + 流水线产物逐条一致；
SA7 §9「tracked diff 零 [SA7-DATAFLOW]」亲证临时探针未入库。
**批准面与提交面零偏差**（SA3 报告 iteration 3 节与 SA7 证据日志的未跟踪状态见 §9 O-2，
属 Controller 统一 staging 面，不构成代码面偏差）。

## 9. Findings 与 Non-blocking observations

**0 BLOCKER / 0 MAJOR / 0 MINOR 修订项。** 以下为非阻断观察（无 Required action）：

- **O-1（nit，风格）**：`update-transfer.ts` 在 `chunkedViolationCode` 函数后新增一个
  多余空行（连续两空行）。`.editorconfig` 只 gate 尾随空格/终行换行，whitespace 门
  exit 0；纯外观，非文档化标准违规。
- **O-2（流程，与 #299 SA9 O-3 同款）**：committed `sa3_impl.md` 缺 iteration 3 节
  （SA3 已披露该节**故意**留工作树由 Controller 统一 staging）；SA7 证据日志
  （`artifacts/sa7-issue300-*.log` ×5）与任务简报 `task_issue-300.md` 未跟踪，而引用
  它们的 sa7 报告已入库——证据收纳节奏轻微不对称；wiki/raw 与 artifacts 均为证据面
  非规范契约（docs/AGENTS「Authority」节），属 Controller finalize 面。
- **O-3（既有登记）**：`types.ts` L274–277 过期计数注释（「全 20 码」，基线 22、
  本票后 26）——**基线即漂移**，文件在 DENY、本票零触碰；SA8 N7 已登记转
  owner/总控一行注释同步，非本票引入。
- **O-4（既有登记）**：`completeChunkedStep2` 的 `chunkedStep2RoundId ?? currentRound`
  回退分支——合法 wire 序静态不可达（round 推进恒先经 RESYNC 边沿清 assembly）；
  SA4 观察 1 + SA7 偏差 3（协议外注入可触发但 apply 幂等零损坏）已路由 #301 改
  fail-loud。非本票缺口。
- **O-5（流程，与 #299 SA9 O-1 同款）**：提交标题未携带 issue 引用（SA3 建议消息为
  `feat(#295 切片 2): …(#300)`）；根/docs AGENTS 均未规定提交消息格式——非文档化
  标准违规，仅记观察。
- **O-6（正向确认）**：bulk 窗口槽「整笔占 1 槽」以 facet 仲裁落地（首 chunk 空位判据
  + ②位持槽至结算 + M3 唤醒），而非注册 channel 裸 inFlight——设计 D1 明示该等价
  机制并经 SA2 S6 并发攻击核验（跨 kind 单 transfer 不变量结构性成立）；kind=0 的
  「有效占用口径」数值记账不被污染（R47 等价面保持）。

## 10. requiresConflictRecheck

**false。** 设计 §15 自报 true 的七个复查焦点（D12 首登逐值/R42 计数器/R43 v1 门/
R45 预检+场景 14/R47 冻结面/R5 终态裁定/M5 入口面读法）已由 SA8 implementation
复查逐项闭合并裁 **clear**（0 hard-conflict / 0 evolution-required）；本轮对其中
D12 逐值、场景 14 三要素、DENY 冻结面、R5 裁定四面独立复证一致。规范面（ADR、
协议 §5/§8/§9/§10.3/§13.2/§16/§17/§18/§23、CONTEXT）零触碰；无新公共 API/配置键/
持久化面；残余 R48/R49/N7 为已登记非阻塞收尾项（归 #301/doc commit/owner）。

## 11. 本轮独立取证命令留痕

```
git log --oneline -5 && git rev-parse HEAD HEAD~1        # HEAD=749de8e；parent=605a48f=dispatch base
git show --stat 749de8e                                  # 25 文件 +4780/−221
git diff 605a48f..749de8e --check                        # exit 0（whitespace 门）
git diff 605a48f..749de8e --name-only                    # 25 路径全量（ALLOW 逐条对照）
git diff 605a48f..749de8e --stat -- <DENY 全清单>          # 零输出（exit 0，空 diff）
git diff 605a48f..749de8e -- <生产 9 文件/测试 5 文件/docs>  # 交付全文亲读
sed -n '435,460p' docs/protocols/instance-replication-v1.md   # §13.2 L445–448 冻结行逐值比对
grep -c "it(" ws-replication-issue300-chunked-sync-ac-red.test.ts   # 12（R1–R7+N1–N4）
wc -l <契约文件>                                          # 1085（SA6 §12 签名一致）
grep -n "\.only(\|\.skip(\|\.todo(" <4 测试文件>           # 全零
grep -n "后续切片交付\|本切片唯一 kind\|不预设其存在" docs/protocols/instance-replication-v1.md
                                                           # 零命中（exit 1）
grep -n "chunkedUpdate\|BulkTransfer\|update-transfer" packages/*/src/index.ts
                                                           # 零命中（公共面零变化）
git diff 605a48f..749de8e -- packages/ | grep "as any\|: any"       # 零命中
git status --porcelain                                   # 未跟踪=SA7 日志×5+简报；M=sa3_impl（§9 O-2）
```
