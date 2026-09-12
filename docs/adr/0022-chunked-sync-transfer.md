# ADR 0022：BOOTSTRAP_SNAPSHOT 与 SYNC_STEP2 的有界分块复制传输

日期：2026-09-15
状态：已接受（issue #295 设计冻结；wire 冻结值——0x42 单形态字段序、错误码/reason 词表锁定值——以 `docs/protocols/instance-replication-v1.md` 为唯一权威；配置语义与设计理据权威保留于本文。）

## 背景

ADR 0013 冻结了 live UPDATE 的分块传输，并把 SYNC_STEP2 diff 与 BOOTSTRAP_SNAPSHOT 分块显式列为非目标（「同一 transfer 机制可平移，列为后续独立 capability」）。issue #295 是该尾部：peer 从 0 同步或恢复同步时数据以单个完整 frame 传输且明确不分块，超过 `maxBootstrapBytes` / `maxSyncDiffBytes` 即 terminal failed——大于上限的合法文档使 namespace 永久失同步，直到人工改配置。实测证据（`packages/ws-replication/test/ws-replication-issue233-repro.test.ts`）：R1 显示 20KB 恢复 diff 以单个 SYNC_STEP2 控制帧绕开 data 路径 backpressure 记账并占用 control 保留额度；R3 显示 100KB 写在 `maxSyncDiffBytes=32KiB` 下触发 SYNC_DIFF_TOO_LARGE 终局。

## 决策

将 ADR 0013 的 transfer 机制平移到 bootstrap 与 sync round 路径，作为**恒用机制**（不新增协商能力）：同版本部署组合中，超过单帧上限的 snapshot / diff 一律分块传输。发送端复用 ADR 0013 既有 `CAP_CHUNKED_UPDATE` 协商交集位作为改道门（落地裁决，见下）——未协商组合保留既有终局码行为，同版本部署下该位恒置位、门控不改变目标行为。

### 部署假设：同版本部署，无向前兼容义务

- Hub 与 Peer 按**同版本部署**运行；本 ADR 不承诺与任何历史 wire 形态互通。ADR 0013 引入的 `CAP_CHUNKED_UPDATE` 协商与 v1 回落行为是已实现的既有内容，不在本 ADR 修订范围；sync 段分块**不新增 capability bit、不新增协商面**。
- **落地裁决（issue #299–#301，对本节初稿「不做发送端 gating」措辞的显式修订）**：发送端复用既有 `CAP_CHUNKED_UPDATE` 交集位作为改道门——超限 ∧ 未协商时保留 `BOOTSTRAP_TOO_LARGE`/`SYNC_DIFF_TOO_LARGE` 既有终局。这是零新增复杂度的纵深防御（位与判据均为 ADR 0013 既有物），顺带保持 v1 组合逐字节不变（#295 原 AC2）与刻画测试基线不动；同版本部署假设下该位恒置位，门控不影响目标部署形态的行为。
- 依据：PR #241（v2 代际）尚未合入 main，支持旧六字段形态 0x42 的实现从未部署——不存在新旧混跑的存量。为不存在的部署矩阵维护双形态切换与 gating 是纯设计税。
- 跨版本混跑的非互破译仍由既有机制承载（未知消息码 connection fatal、protocolVersions 握手），不需要为本 ADR 新增任何兼容面。

### 消息形态：0x42 恒为 kind 首字段单形态（拒绝新增消息码、拒绝双形态切换）

UPDATE_CHUNK（0x42）payload 恒为：

```text
0x42 UPDATE_CHUNK (namespace)
  kind         varUint          // 0=live-update, 1=snapshot, 2=sync-diff
  namespaceId  varString        // 以下五字段序与 ADR 0013 冻结形态一致
  transferId   varUint          // 三种 kind 共用同一 (连接, 方向, namespace) 域计数器
  chunkIndex   varUint
  chunkCount   varUint
  totalBytes   varUint
  [绑定块]                      // 仅 kind≠0 且 chunkIndex=0：kind=1 为 replicationId varString + replicationEpoch varUint；kind=2 为 syncRoundId varUint
  bytes        varUint8Array    // ≤ maxUpdateBytes（复用为 maxChunkBytes）
```

- ADR 0013 冻结的六字段形态作废：该形态随 PR #241 同分支演进、从未发布，golden vectors 在本分支内改写为单形态，无兼容代价。
- kind 放首位对齐「首 chunk 自描述、恶意声明在第一个字节流入前即可拒绝」的既有精神；codec 单帧规则追加 `kind ∈ {0,1,2}`、绑定块当且仅当 `kind≠0 ∧ chunkIndex=0` 时存在（违者 `MALFORMED_FRAME`）。

### round / epoch 绑定：首 chunk 自描述绑定块

- kind=2 首 chunk 携 `syncRoundId`，与该 round 的 SYNC_STEP1 一致；不符即 `SYNC_STATE_VIOLATION`（既有码，§9.3 语义不动）。后续 chunk 仅凭 (连接, 方向, namespaceId, transferId) 归属——WS 有序可靠 + 每 (namespace, 方向) 单 assembly 上限使归属无歧义。
- kind=1 首 chunk 携 `replicationId + replicationEpoch`，与 OPEN_OK 一致；epoch 不符即 `REPLICATION_EPOCH_MISMATCH`（既有码）。
- 快照基线竞态不新增协议内容：沿用 §8.2——Peer 安装基线后以新 syncRoundId 发起双向 reconciliation 补齐编码与安装之间的增量；epoch fence 于传输期间发生则 assembly 整体丢弃重来。

### ACK、发送端、接收端、记账：逐条平移 ADR 0013

- ACK：重组 + 长度校验 + 一次 sequenced apply / 排他复制导入完成后才发 BOOTSTRAP_ACK / SYNC_APPLIED——ACK = 已落 live Y.Doc 的 durability 含义逐字不变；整笔 transfer 一次 ACK。
- 发送端：chunk 逐帧经 data 路径出站（独立 sequence、dataGateOpen 与 round-robin 调度、整笔占 1 个 in-flight 窗口槽、队列持完整载荷出队惰性切片）；control reserve 不承载任何 chunk——R1 揭示的 control 路径绕行消除。未超单帧上限的 snapshot / diff 仍走单帧 BOOTSTRAP_SNAPSHOT / SYNC_STEP2 路径（触发条件，非兼容回落）。超限 ∧ 未协商 `CAP_CHUNKED_UPDATE` → 保留既有 `BOOTSTRAP_TOO_LARGE`/`SYNC_DIFF_TOO_LARGE` 终局（落地裁决，见「部署假设」节）。
- 接收端：首 chunk 校验（totalBytes ≤ 按 kind 的聚合上限、chunkCount ≤ maxChunksPerUpdate、totalBytes ≤ chunkCount × maxUpdateBytes、chunkCount ≥ 1）通过后按已验证上界一次性分配 detached buffer；重组失败一律发生在 apply 之前，live Y.Doc 零写入；assembly 纯易失，丢弃触发面与 ADR 0013 相同。
- 记账：assembly 作用域与并发上限的定义逐字沿用（每 (namespace, 方向) 至多 1 个 + 连接级 `maxConcurrentAssembliesPerConnection`）。bootstrap 期间虽无 Lease，namespaceId 自 OPEN_NAMESPACE 起已知，协议层按 namespaceId 记账不需要 Lease 存在。

### 资源上限与配置链

新增配置均有安全缺省、启动期响亮验证、绝不运行时 clamp：

| 配置 | 缺省 | 约束 |
|---|---|---|
| `maxChunkedBootstrapBytes` | 4 MiB | ≤ `maxChunksPerUpdate × maxUpdateBytes` |
| `maxChunkedSyncDiffBytes` | 4 MiB | ≤ `maxChunksPerUpdate × maxUpdateBytes` |

- `maxChunksPerUpdate` / `maxConcurrentAssembliesPerConnection` / `assemblyTimeoutMs` 三个机制键语义推广为 kind 无关，**键名不变**（存量配置兼容；`maxChunksPerUpdate` 名留 "Update" 是兼容代价，语义见协议 §17）。
- chunk 大小继续复用 `maxUpdateBytes`（零新 frame 级上限）。内存上界 = `maxConcurrentAssembliesPerConnection × max(maxChunkedUpdateBytes, maxChunkedBootstrapBytes, maxChunkedSyncDiffBytes)`。
- `maxQueuedControlBytes ≥ maxBootstrapBytes + 协议开销` 的启动校验**原样保留**：未超上限的 snapshot 仍以单帧 control 帧承载，该不变量对单帧路径仍然必要。
- 超限判定在首 chunk 声明校验（聚合上限）完成；`maxBootstrapBytes` / `maxSyncDiffBytes` 保持单帧路径上限语义。

### 错误码与词表（append-only）

- namespace error registry 追加四码，按协议段分族：`SNAPSHOT_TRANSFER_VIOLATION`（fatal、retryable no、terminal failed）、`SNAPSHOT_TRANSFER_TOO_LARGE`（fatal、retryable config、terminal failed）、`SYNC_TRANSFER_VIOLATION`（fatal、retryable no、terminal failed）、`SYNC_TRANSFER_TOO_LARGE`（fatal、retryable config、terminal failed）。连接级 registry 零新增。
- `RESYNC_REQUIRED.reasonCode` 词表追加 `SYNC_TRANSFER_EXPIRED`（非终态，对齐 `UPDATE_TRANSFER_EXPIRED` 先例）。
- 超时语义继承两段状态机各自的既有终局规则，不是新设计：bootstrap 段 assembly 超时 ⇒ `BOOTSTRAP_FAILED` 族终局（failed + §18 连接重建——此刻尚无可 reconcile 的 session）；sync 段 assembly 超时 ⇒ 丢弃 + `RESYNC_REQUIRED{SYNC_TRANSFER_EXPIRED}`（needs-resync 非终态）。

### Observer seam（append-only，对齐 §23 纪律）

新增 8 型，字段集分别对齐既有 chunked-update-* 四型（safe-field 同 §23.3，只报长度/计数/有界标识）：

| type | 字段 |
|---|---|
| `chunked-snapshot-sent` / `chunked-sync-sent` | `connectionId?`、`namespaceId`、`transferId`、`chunkCount`、`totalBytes`（sync 族另携 `syncRoundId`） |
| `chunked-snapshot-applied` / `chunked-sync-applied` | `connectionId?`、`namespaceId`、`bytes`、`chunkCount`、`applyLatencyMs?`（sync 族另携 `syncRoundId`） |
| `chunked-snapshot-acked` / `chunked-sync-acked` | `connectionId?`、`namespaceId`、`bytes`、`ackLatencyMs?` |
| `chunked-snapshot-aborted` / `chunked-sync-aborted` | `namespaceId`、`transferId`、`reason`（复用既有枚举，零新词）、`receivedChunks`、`receivedBytes` |

throw 隔离、决策落定后发射、无 observer 逐字节等价——沿用 §23.4。

### 明确拒绝的备选方案

1. **`CAP_CHUNKED_SYNC` capability 协商 + 0x42 双形态切换**（本 ADR 初稿方案）：全部复杂度为「新旧混跑逐字节不变」服务，而 PR #241 未合 main、旧形态从未部署——为不存在的部署矩阵付设计税。同版本部署假设下单形态恒用即可，跨版本非互破译由既有消息码/版本握手承载。（落地时保留的既有 `CAP_CHUNKED_UPDATE` 交集位复用门是 ADR 0013 已有物的零成本纵深防御，不属于本备选的新增协商面，见「部署假设」节落地裁决。）
2. **新增 SNAPSHOT_CHUNK / SYNC_CHUNK 消息码**：新增码位会让同一套重组/记账/配置机制在 spec 里重复表述三遍；复用 0x42 + kind 保持单一 transfer 机制的唯一权威表述，生命周期差异由首 chunk 绑定块承载。
3. **通用 TRANSFER_CHUNK 码（kind 含 live-update）**：给已实现的 live-update 路径开第二入口，无收益。
4. **kind 追加为尾字段 / 隐式编码进既有字段**：尾字段位置违反「恶意声明在第一个字节流入前即可拒绝」的拒绝路径精神；隐式编码违反 wire 值自描述纪律。
5. **snapshot/diff 各立开关**：实现差为零——两者共享同一套切片器/重组器/配置链。
6. **chunk 逐帧携带 round/epoch，或纯顺序绑定**：逐帧重复语义冗余；纯顺序绑定使帧归属依赖解析上下文，与自描述精神相悖。
7. **重定义 `maxBootstrapBytes` / `maxSyncDiffBytes` 为聚合上限**：旧键保持单帧路径上限语义，聚合上限另立新键，两类上限各司其职、配置链可读。
8. **复用 UPDATE_TRANSFER_* 错误码跨 kind**：bootstrap 与 update 语境的排障路径不同，协议码位本按主题分段，分族保持 §13.2 可读。

## 后果

- 大于单帧上限、不超过新聚合上限的 snapshot / sync diff 可完成初始同步与恢复同步，「上限内合法文档永久失同步」的终局失败路径消除（issue #295 核心验收）。
- snapshot/diff 分块传输字节纳入 data 路径 backpressure 记账，control reserve 只承载纯控制帧与小载荷单帧路径——R1 的结构性绕行修复。
- 协议面：0 个新消息码（0x42 单形态改写）、0 个新 capability bit、4 个 namespace 错误码、1 个 RESYNC reason、8 个 observer 事件类型；#242 的 0x42 golden vectors 在本分支内改写为单形态。
- 落地时修订 `docs/protocols/instance-replication-v1.md`（§1、§5、§8、§9、§10.3、§13.2、§16、§17、§18、§22、§23）与 CONTEXT.md「分块复制传输」词汇；golden vectors 随实现 ticket 补齐。
- **`BOOTSTRAP_TOO_LARGE` / `SYNC_DIFF_TOO_LARGE` 在同版本（已协商）组合成为死码**：超限载荷改道分块后已协商组合的单帧路径不再触发两码；两码保留于错误码注册表（append-only，不删除），未协商组合保留其既有触发路径（v1 组合逐字节不变）——§23 `namespace-failed` 覆盖矩阵的对应行改挂 `SNAPSHOT_TRANSFER_TOO_LARGE`。
- 复现刻画测试（R1/R3）保留为现状基线；实现落地后以分块构型新增收敛绿灯测试，不改刻画文件。

## 非目标

- 向前/向后兼容与新旧互通矩阵：同版本部署假设下显式放弃，不为历史 wire 形态保留任何实现或测试面；
- 以提高 `maxBootstrapBytes` / `maxSyncDiffBytes` 代替协议设计；
- 跨进程重启持久化 partial chunks（沿用 ADR 0013）；
- 逐片 apply 到 live Y.Doc（沿用 ADR 0013）；
- 修订 ADR 0013 已实现的 `CAP_CHUNKED_UPDATE` 协商与 v1 回落行为（既有内容，不在本 ADR 范围）；
- awareness/presence、多 hub、客户端 y-websocket 兼容（沿用 ADR 0010 非目标）。

## 取代与关联

本 ADR 扩展 ADR 0013 的 transfer 机制到 bootstrap 与 sync round 路径，并将其非目标条款「SYNC_STEP2 diff 与 BOOTSTRAP_SNAPSHOT 分块」显式移除（该条款由本文接替）；ADR 0013 的 ACK durability 语义、assembly 易失性纪律、配置链模式、observer 纪律全部沿用，关系为扩展而非修订。按「部署假设」节落地裁决，未协商组合的既有终局码行为保留，故本 ADR 最终不偏离 ADR 0013 的「未协商端逐字节不变」纪律——同版本部署假设使该保留在目标部署形态下零代价，且保住了 #295 原 AC2 与刻画测试基线。与 `docs/protocols/instance-replication-v1.md` 的两层权威边界同 ADR 0013：wire 冻结值以协议文档为唯一权威，配置语义与设计理据权威保留于本文。关联 issue：#295（本设计来源与验收标准，其中 AC2「未协商组合逐字节不变」经落地裁决保留）、#233 / PR #241（live UPDATE 分块，本 ADR 的机制来源）；基线架构 ADR 0010 不变。现状实测证据：`packages/ws-replication/test/ws-replication-issue233-repro.test.ts`（R1/R3）。
