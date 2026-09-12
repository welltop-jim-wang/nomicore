# SA8 前置门禁 — issue #300 相关决策摘录（relevant decisions）

- **任务**: issue #300「feat(#295 切片 2): chunked snapshot / sync-diff 端到端：R1/R3 收敛绿灯」
- **简报快照**: `wiki/raw/task_issue-300.md`（与 GitHub issue body 逐字一致，2026-09-11 经 `gh issue view 300` 实测核对；comments 数组为空）
- **本文只摘录与 #300 相关的决策、条款与关联点**；不改写原义、不做业务设计。冲突裁决见同号 `_conflict_report.md`。

## 0. 决策集合与效力状态

基准 = `CONTEXT.md` + `docs/adr/`（17 篇）+ 规范协议文档 + 模块 AGENTS 明确收录的决策。分支 `mabf/issue-300`（基点 `605a48f` = #299/PR #321 合并点；origin/main 额外领先一个 VFSL 系 squash 提交 `b158f98`，不在本任务基线内，见冲突报告 N6）。

- **无任何 ADR 处于 ADR 级整体 superseded 状态**；唯一的条款级取代已显式登记：ADR 0013 非目标 #4 被划除并注明「已由 ADR 0022 接替」（`docs/adr/0013-chunked-live-update-transfer.md` L117）。
- wire 冻结值唯一权威 = `docs/protocols/instance-replication-v1.md`（ADR 0013 L4 / ADR 0022 L4 两层权威边界；root AGENTS.md「Instance replication」节同指）。
- `wiki/raw/`、`artifacts/` 一律为 evidence、非规范契约（docs/AGENTS.md「Authority」节）。

## 1. 主决策：ADR 0022（chunked sync transfer，已接受，2026-09-15 冻结）

`docs/adr/0022-chunked-sync-transfer.md` —— #300 是其**传输层实现票**：

| 条款 | 位置 | 与 #300 的关联点 |
|---|---|---|
| 决策：恒用机制（非协商能力），超单帧上限的 snapshot / diff 一律分块 | L12 | 改道触发条件；简报「触发条件，非兼容回落」同源 |
| 部署假设：同版本部署、无向前兼容义务；sync 段不新增 capability bit、不做协商、不做发送端 gating（ADR 0013 的 CAP_CHUNKED_UPDATE 协商既有内容不在修订范围） | L14–18 | 发送端无新增 gating 面 |
| 0x42 kind 首字段单形态（kind ∈ {0,1,2}；绑定块仅 kind≠0 ∧ chunkIndex=0） | L20–37 | codec 基座已由 #299 落地；#300 只消费 |
| round/epoch 绑定：kind=1 首 chunk 携 replicationId+replicationEpoch（epoch 不符 → REPLICATION_EPOCH_MISMATCH）；kind=2 首 chunk 携 syncRoundId（不符 → SYNC_STATE_VIOLATION，§9.3 语义不动）；后续 chunk 凭 (连接,方向,namespaceId,transferId) 归属 | L39–43 | 简报「首 chunk 绑定块核对」；replicationId 不符码在协议 §8.1 L202 显式为 REPLICATION_ID_MISMATCH |
| ACK / 发送端 / 接收端 / 记账「逐条平移 ADR 0013」：重组+长度校验+一次 sequenced apply/排他复制导入后才发 BOOTSTRAP_ACK/SYNC_APPLIED；chunk 逐帧经 data 路径（独立 sequence、dataGateOpen、RR、整笔占 1 in-flight 槽、队列持完整载荷惰性切片）；control reserve 不承载任何 chunk；接收端首 chunk 校验后按已验证上界一次性分配 detached buffer；重组失败先于 apply、live Y.Doc 零写入；assembly 作用域与并发上限逐字沿用；bootstrap 期无 Lease、namespaceId 自 OPEN_NAMESPACE 起已知 | L45–51 | 简报 What-to-build 主体逐句对应 |
| 配置链：`maxChunkedBootstrapBytes`/`maxChunkedSyncDiffBytes`（各 4 MiB）+ 三机制键 kind 无关键名不变；`maxQueuedControlBytes ≥ maxBootstrapBytes + 开销` 校验原样保留；超限判定在首 chunk 声明校验 | L52–64 | 配置面已由 #299 落地（`defaults.ts`/`types.ts`/`validate.ts`） |
| 错误码（append-only）：四码 SNAPSHOT/SYNC_TRANSFER_{VIOLATION,TOO_LARGE}（fatal、retryable no/config、terminal failed）+ `RESYNC_REQUIRED.reasonCode` 追加 `SYNC_TRANSFER_EXPIRED`；超时按段收口（bootstrap → BOOTSTRAP_FAILED 族终局；sync → RESYNC 非终态） | L66–70 | 简报错误映射；超时收口面按切片归属 #301 |
| Observer seam：8 型（chunked-snapshot/sync-{sent,applied,acked,aborted}） | L72–83 | 发射点接线归切片 #301（`gh issue view 301` 实测正文「observer seam」段） |
| 后果：`BOOTSTRAP_TOO_LARGE`/`SYNC_DIFF_TOO_LARGE` 成死码但保留注册表；R1/R3 刻画测试保留为现状基线、实现落地后新增收敛绿灯测试、不改刻画文件 | L96–103 | 简报端到端绿灯 + AC5 |
| 落地修订清单：协议 §1/§5/§8/§9/§10.3/§13.2/§16/§17/§18/§22/§23 + CONTEXT.md 词汇——**已由 docs 提交 `2ca06f6` + `eb380d7` 兑现**（本分支 HEAD 实测协议文档已是目标契约） | L101 | 无待修订规范文档 |
| 取代与关联：扩展 ADR 0013、显式移除其非目标 #4、显式登记对「未协商端逐字节不变」纪律的限定偏离（仅 sync 段）；基线 ADR 0010 不变 | L114–116 | override 链条完备性 |

## 2. 机制来源：ADR 0013（chunked live update transfer，已接受）

`docs/adr/0013-chunked-live-update-transfer.md`：

- 发送端规则（L48–54）：出队时刻惰性切片、队列持完整 update、每帧独立 sequence/dataGateOpen/RR「每轮每 ns 一帧」、整笔占 1 in-flight 槽、ACK 计时锚 = 末 chunk 出站、中止复用既有机制——ADR 0022 L48 声明「逐字同构」平移到 kind=1/2。
- 接收端规则（L56–63）：assembly 纯易失、作用域 (连接,方向,namespaceId,transferId)；首 chunk 分配前校验（totalBytes ≤ 聚合上限 ∧ chunkCount ≤ maxChunksPerUpdate ∧ totalBytes ≤ chunkCount × maxUpdateBytes ∧ chunkCount ≥ 1）后一次性分配 detached buffer；后续 chunk 严格递增 + 逐字节一致；收齐 Σbytes === totalBytes ⇒ 一次 sequenced apply ⇒ 单 ACK（末 chunk 帧序）；并发上限每 (ns,方向) 1 + 连接级 `maxConcurrentAssembliesPerConnection`；丢弃触发面（断连/close/GOAWAY/epoch fence/RESYNC）。
- 协商（L20–25）：`CAP_CHUNKED_UPDATE`（bit 0x00000001）协商与 v1 回落**为已实现既有内容**；ADR 0022 非目标 #5（L111）明确不在修订范围——0x42 消息族的既有协商门对三 kind 一体适用（协议 §5 L114、§10.3 L345）。
- 非目标 #4（SYNC_STEP2/BOOTSTRAP_SNAPSHOT 分块）已划除，由 ADR 0022 接替（L117）——**不再构成约束**。

## 3. 基线架构：ADR 0010（Hub/Peer WebSocket Y.Doc 复制，已接受）

`docs/adr/0010-hub-peer-websocket-ydoc-replication.md`：ADR 0022 L116 自述「基线架构 ADR 0010 不变」，关系为扩展。相关不变面：ACK = sequenced live apply + dirty notification（非 flush/quorum）；identity fencing（§11）；排他复制导入与受身份前置条件保护的归档 seam（L57、L283）；backpressure 分层与停机顺序。snapshot 传输层的帧级上限（`maxBootstrapBytes`）由协议文档承载，ADR 0010 无单帧冻结条款与 #300 相抵。

## 4. 协议规范（wire 唯一权威）：`docs/protocols/instance-replication-v1.md`

HEAD 现状（含 `2ca06f6`+`eb380d7`+`605a48f` 修订）已冻结的目标契约节选：

- **§5 L112/L114/L116**：0x42 注册表项（direction either）；CAP_CHUNKED_UPDATE 协商门对 0x42 一体适用、v1 代际端永不分块并 fatal 拒绝；payload 恒为 kind 首字段单形态、三 kind 共用同一 transferId 计数器。
- **§8.1 L198–204**：单帧路径保留（未超 `maxBootstrapBytes` 走本路径）；超限改道 kind=1 经 data 路径（发送端规则与 §10.3 逐字同构、control 保留额度零 chunk、整笔 1 in-flight 槽直至 BOOTSTRAP_ACK）；接收端 assembly 纯易失、bootstrap 期无 Lease/ReplicationSession、记账挂 namespaceId 与连接级并发上限；首 chunk 分配前校验（`maxChunkedBootstrapBytes`/`maxChunksPerUpdate`，超限 → `SNAPSHOT_TRANSFER_TOO_LARGE` fatal/config/failed；几何不一致或跨帧违例 → `SNAPSHOT_TRANSFER_VIOLATION` fatal/no/failed）；绑定块不符 → 既有 `REPLICATION_ID_MISMATCH`/`REPLICATION_EPOCH_MISMATCH`；收齐精确核对后**一次**排他复制导入（与单帧路径同一导入语义）再 BOOTSTRAP_ACK；assembly 停滞 → `BOOTSTRAP_FAILED` 语义族终局；`BOOTSTRAP_TOO_LARGE` 保留注册表、单帧路径不再触发。
- **§8.2 L206–213**：BOOTSTRAP_ACK `ackedSequence`（分块 snapshot 时为末 chunk 帧序）；durability 含义不变；安装后竞态修复沿用、epoch fence 于传输期 → partial 整体丢弃。
- **§9.2 L236–238**：单帧路径保留；超 `maxSyncDiffBytes` 改道 kind=2（双向、发送端规则与 §10.3 同构、占 1 in-flight 槽直至 SYNC_APPLIED）；首 chunk 绑定块 `syncRoundId` 不符 → `SYNC_STATE_VIOLATION`（既有码）；接收端校验/错误码（`SYNC_TRANSFER_TOO_LARGE`/`SYNC_TRANSFER_VIOLATION`）；收齐核对后 sequencer 一次 apply + dirty 再 SYNC_APPLIED；停滞 → 弃 partial + `RESYNC_REQUIRED{SYNC_TRANSFER_EXPIRED}`（非终态）；不 fallback bootstrap、不做无界拆分；`SYNC_DIFF_TOO_LARGE` 保留注册表、不再触发。
- **§9.3 L246**：SYNC_APPLIED `ackedSequence`（分块 diff 时为末 chunk 帧序，单 ACK 对齐 §10.3）。
- **§10.3 L307–345**：UPDATE_CHUNK 单形态字段表与 codec 单帧规则（含 `kind ∈ {0,1,2}`、绑定块当且仅当 kind≠0 ∧ chunkIndex=0、违者 MALFORMED_FRAME）；transfer 身份（uint32、≥1、三 kind 共用计数器、逐字节一致声明）；发送端规则（触发 `bytes > maxUpdateBytes` ∧ 已协商 ∧ channel live、惰性切片、独立 sequence/dataGateOpen/RR、1 in-flight 槽、ACK 锚 = 末 chunk 出站、中止复用既有机制）；接收端规则（作用域、首 chunk 二维声明上界 + 几何一致校验、一次性分配、后续帧跨帧一致、收齐一次 apply + UPDATE_ACK(末 chunk 帧序)、错误三分类映射——kind=1/2 时 `UPDATE_*` 码按 §8.1/§9.2 替换为 `SNAPSHOT_*`/`SYNC_*`、聚合上限按 kind 取值）；解码侧未协商 pre-parse `UNSUPPORTED_MESSAGE_TYPE`（对 0x42 不分 kind）。
- **§13.2 L445–448/L450–452**：四新码注册（SNAPSHOT_TRANSFER_VIOLATION yes/no/failed、SNAPSHOT_TRANSFER_TOO_LARGE yes/config/failed、SYNC_TRANSFER_VIOLATION yes/no/failed、SYNC_TRANSFER_TOO_LARGE yes/config/failed）；发射面（声明超聚合上限 / 跨 chunk 元数据违例、几何不一致、连接级并发 assembly 超额按 kind）；连接级 registry 零新增。
- **§16 L556**：`bootstrapping`/`reconciling` 可承载分块 snapshot/diff 传输；**分块不新增状态、assembly 进度对状态机不可见**。
- **§17 L575–615**：分块配置族（含 #295 两键 + 三机制键 kind 无关推广、内存上界公式）；控制保留额度定义与 `maxQueuedControlBytes ≥ maxBootstrapBytes + 开销` 校验**原样保留**（静态纪律、不因运行期行为路径条件化）；chunk 经 data 路径、不占 control 保留额度；链②校验与非追溯性纪律。
- **§18 L628**：`assemblyTimeoutMs` 进度滑动 deadline、kind 无关；按 kind 收口（snapshot → BOOTSTRAP_FAILED 族；sync-diff → RESYNC{SYNC_TRANSFER_EXPIRED}）。
- **§22 L701**：分块 sync 传输测试要求——传输层 kind=1/2 测试资产「由 §8.1/§9.2 后续切片交付，本规范不预设其存在」（= #300 的收敛绿灯测试义务）；v1 代际端 0x42 照旧 fatal。
- **§23.1 L749–754/L783–784**：第 29–36 型 observer 事件已登记（sent/applied/acked/aborted × snapshot/sync；R21 改道 = 分块窗口内普通族归零；发射点纪律）；§23.3 L814：hub `send-failed` 行改挂 `SNAPSHOT_TRANSFER_TOO_LARGE`（本端资源超限、非对端违例），原 BOOTSTRAP_TOO_LARGE 触发面失效，「回归锚场景 14 由实现 ticket 改写」。

## 5. CONTEXT.md 词条

- **分块复制传输**（L153–154）：kind 三态、恒用机制（snapshot/sync-diff 无协商）、(连接,方向,namespaceId,transferId) 作用域、三 kind 共用计数器、完整重组后一次 sequenced trusted apply（snapshot 为排他复制导入）+ 单 ACK、partial 绝不写 live Y.Doc。
- **同版本部署假设**（L165–166）：sync 段分块不设协商、恒用启用；跨版本非互破译由既有消息码/版本握手承载。

## 6. 模块 AGENTS 收录的契约（package architecture 面）

- `packages/ws-replication/AGENTS.md`：改 wire 行为前必读 ADR 0010/0012 + 协议文档；拓扑静态；FSM 不变量（sequence/sync-round 计数器不回绕、终态 channel 仅新连接重开）；**transport 层不得直入 Runtime/Persistence/snapshot/live Y.Doc 内部**——namespace 所有权与原始 Yjs 操作必须经公共 Registry lease 与 ReplicationSession；ACK = sequenced live apply + dirty 注册；准入有界（control/data 记账为可观测并发契约）；observer/adapter 失败隔离；插件只拥有 listener/dialer/controller/connection/自身 service。
- `packages/replication-protocol/AGENTS.md`：codec 为协议文档的字节层实现；一 WS message = 一完整 frame（20-byte envelope）；fail-closed 解码；消息码/capability bit/错误码/close 分类为 append-only 注册表，**不得重编号或静默重释既有值**；codec 与 transport/Registry 无关；公共 API 仅经 `src/index.ts`。

## 7. 其余 ADR 关联扫描（零交集确认）

ADR 0001–0009（VFSL/投影/持久化/运行时/Registry/Host 生命周期）、0011/0014（诊断日志）、0012（实例身份与 plugin 所有权——#300 不改 plugin 装配与所有权）、0016/0017（readData/schema 生命周期）、0018（peer schema re-arm——分块 apply 沿 §20 保护检查，re-arm fatal 语义不动）：与 #300 的传输层改道无条款交集；其中 ADR 0008（单序列器——「一次 sequenced apply」）与 ADR 0009（Registry/lease——bootstrap 记账显式无 Lease，不涉租约变更）为相邻但无冲突面。

## 8. 当前实现事实（evidence，非决策；用于「尚未实现」判定）

- #299（切片 1，PR #321 = commit `605a48f`，本分支基点）：0x42 kind 首字段单形态 codec + 绑定块编解码 + `maxChunkedBootstrapBytes`/`maxChunkedSyncDiffBytes` 配置链与启动校验已落地（`packages/replication-protocol/src/payloads.ts` L653+、`packages/ws-replication/src/{defaults,types,validate,hub-connection,peer-connection}.ts`）；golden vectors 已改写单形态（`codec-messages-golden.test.ts`、`codec-issue299-ac-red.test.ts`）。commit 标题残留「CAP_CHUNKED_SYNC 协商、双形态」措辞，实际内容为修订后单形态（全库 `CAP_CHUNKED_SYNC` 零命中，#299 门禁 R32 已裁定标题废弃、正文为准）。
- kind=0 live-update 分块传输已落地（issue #243–#246：`update-channel.ts` 发送端 / `update-transfer.ts` 接收端 assembler——`ChunkedTransferPiece` 现无 kind 字段，传输层 kind 泛化即 #300 工作）。
- bootstrap 超限现状仍为单帧终局：`hub-namespace.ts` L521–524（「不分块、不 fallback」→ `BOOTSTRAP_TOO_LARGE`）；SYNC_STEP2 仍单帧（`round-engine.ts` L187；`frame-io.ts` L87 decode 面分类 `SYNC_DIFF_TOO_LARGE`）——R1/R3 现状由 `packages/ws-replication/test/ws-replication-issue233-repro.test.ts` 刻画（文件在库、未改）。
- 切片分工（`gh issue view 301` 实测）：#301（blocked by #300）承接生命周期完备性（丢帧/重复/错序/超时/close/GOAWAY/断线/epoch fence 丢弃矩阵、超时两向收口、恶意声明负例、公平调度回归）与 observer seam 8 型接线。
