# Phase 5：Hub/Peer WebSocket Y.Doc 复制

Phase 5 在 NamespaceRegistry 之上交付可部署的多实例 Nomicore：一个静态 hub 与多个 peer 通过 WebSocket 形成星型拓扑；每个实例使用独立 Persistence，所选 namespace 允许断线本地写，并在恢复后通过 Yjs state vector/diff 最终收敛。

## 设计基准

- ADR 0006：Persistence、DocHandle、完整 snapshot、dirty notification、degraded/retry 与单 rootDir owner。
- ADR 0007：逻辑校验、Yjs Runtime bridge、普通业务写 zero-write 与 raw update 受控通道预留。
- ADR 0008：单 NamespaceRuntime、唯一 write sequencer、ROOT/SCHEMA 写和 lifecycle gate。
- ADR 0009：NamespaceRegistry、NamespaceLease、本地唯一 Runtime generation 与 Host shutdown。
- ADR 0010：hub/peer拓扑、namespace identity、复制谱系、ReplicationSession与可信raw update决策。
- `docs/protocols/instance-replication-v1.md`：固定wire envelope、payload、消息/错误注册表、连接/namespace/sync状态机和恢复语义。
- `CONTEXT.md`：namespaceId、write sequencer、复制谱系、hub/peer和复制状态词汇。

本阶段接续 Phase 4 中明确排除的 WS/raw Yjs sync 和多机部署，但仍不实现分布式 Registry、文件锁或 leader election。

## 交付模型

```text
Hub instance
├── Clock / Timer
├── independent Persistence
├── NamespaceRegistry
├── @nomicore/ws-replication server
└── apps/yjs-server composition root
       ▲
       │ one authenticated, multiplexed WebSocket per peer
       │
Peer instance × N
├── Clock / Timer
├── independent Persistence
├── NamespaceRegistry
├── @nomicore/ws-replication client
└── apps/yjs-server composition root
```

每个 namespace channel 对应本地 Registry Lease 与 duplex ReplicationSession。Transport 不取得裸 Y.Doc；state vector、diff、update subscription 和 trusted apply 都通过 Lease 的正式高级 API 完成。

## 实施切片

按依赖顺序实施；每个切片必须先冻结窄 contract 和稳定错误，再接入下一层。

### 1. Namespace identity、复制身份与受控随机源

- Registry entry key由`(owner.userId, namespaceId)`改为仅namespaceId；open/create仍接收并核对owner，owner mismatch统一not found。
- 普通create不接受调用方namespaceId；受控128-bit CSPRNG生成`ns-`+32位小写hex，碰撞最多重试8次。
- Persistence继续按owner分区，不增加跨owner catalog；复制内部导入保留Hub namespaceId。
- 为Host增加可测试的随机字节/ID capability；核心不得直接调用不受控全局crypto。
- `META.replicationId`与`META.replicationEpoch`投影、严格格式校验和保留字段定义。
- Hub管理操作：`enableReplication()`与`bumpReplicationEpoch()`。

**Slice 1 Runtime/Lease 基础合同（本 slice 的验收锚；与 ADR 0008 issue #132 修订节、ADR 0010 一致）**：

- 两个管理操作与 ROOT/SCHEMA 写共享**唯一严格 FIFO write sequencer**；enable 在单 transaction 内原子安装 identity + epoch 1；bump 单调递增、达 `MAX_SAFE_INTEGER` 拒绝提升不回绕；identity 一经安装不可改写（字段格式、不可变性、epoch 上限与 hub-only 管理权以 ADR 0010 为权威）。
- Runtime status 新增 `replication` 域，两态投影持久事实：`{state:'disabled'}` 或 `{state:'enabled'; replicationId; replicationEpoch}`；**不含** session、网络、队列或 sync 状态（后者属 ReplicationSession，切片 3）。
- 构造期（对外发布前）**仅**读取 `META.replicationId` / `META.replicationEpoch` 两保留字段：双键真缺席 → disabled；双键均存在且合规 → enabled；恰一键、键存在而 `undefined`、格式违约或 META 载体异型 → 构造 loud 拒绝（runtime-construction，committed:false），绝不伪装 disabled、绝不自动补写新 lineage——这是普通 open 不执行 schema / ROOT 载体 / logical validation 的窄例外（ADR 0008 issue #132 修订节）。
- 写成功 = live commit + dirty notification 已登记，**不等于已落盘**（ADR 0006）；notify failure 后 committed facts 不回滚、fatal 后读取与 status 保留最后已提交事实；fatal 只表述为 **committed-state recovery**，不作 durable restart 承诺。
- **本 slice 不实现** ReplicationSession、WebSocket / hub-peer 拓扑或 `resetReplica`（属切片 3–8）。

### 2. Persistence 复制导入与归档

- 增加从 detached、已核对身份的完整 Y.Doc 排他创建副本的受控 seam。
- 增加 `archiveDoc(owner, docId, expectedReplicationIdentity)`：仅在无有效 handle/Runtime generation 时执行。
- FilePersistence 使用同 rootDir 内受控 archive 路径和原子 rename；MemoryPersistence 提供行为等价、可测试的归档语义。
- duplicate、identity mismatch、operational failure 与 committed-aware fatal 使用稳定分类；不得由 WS 插件直接操作文件。

### 3. NamespaceLease ReplicationSession

- `NamespaceLease.openReplicationSession(options)` 与每 Lease 最多一个 session 的生命周期。
- Session 冻结 local role、remote instance、replication identity/epoch。
- 窄能力：state vector、diff、owned update subscription、sequenced trusted apply、status、close。
- 本地 transaction origin 与远端 connection/channel origin。
- Observer failure 隔离和 `needs-resync` 通知；不暴露 Y.Doc、DocHandle 或 live shared type。

**切片 3/4 落地锚定（冻结词汇）**：

- 方法名（冻结）：`openReplicationSession(options)` + session 六能力 `encodeStateVector` / `encodeDiff` / `subscribeOwnedUpdates` / `applyRemoteUpdate` / `getStatus` / `close`；open 输入两域 `{ localRole, remoteInstanceId }`（remoteInstanceId 采用 ADR 0010 L156 instanceId 安全文法）；replicationId/replicationEpoch 由 Runtime 投影链冻结、非调用方输入。
- 角色注入：Registry 构造 `options.role`（`'hub'|'peer'`，可选、缺省 `'hub'`；非法值构造期 TypeError）；生产 `CreateNamespaceRegistryOptions` 与 testing overrides 同形。peer 的 `replaceSchema`/`enableReplication`/`bumpReplicationEpoch` 以稳定角色权限错误拒绝（`REPLICATION_ROLE_PERMISSION`）；session `localRole` 必须等于实例 role。**切片 9 注记：生产 composition root 必须显式传 `role`（缺省 'hub' 仅零回归面，不构成生产配置）**。
- Session status 词汇（冻结）：`state('open'|'closed'|'conflicted')` + `direction` + 冻结四域 + `currentEpoch` + `rootValidation('none'|'replication-unvalidated')` + `durability{memoryCaughtUp（初值 false）, diskCaughtUp:false}` + `observerFailures`；Runtime status 的 replication 域仍只含两态持久事实。
- 受保护常量（冻结，raw caller 不可逐次自定义）：hub 侧（接收 peer→hub）`SCHEMA 全容器 + META 全键`；peer 侧（接收 hub→peer）`META 全键`，SCHEMA/ROOT 放行；peer 允许的 META 白名单**首版 = 空集**。判据 = 内容投影相等（scratch clone 预演；删后同值重写 = 内容未变 = 允许）。
- **needs-resync 通知归属**：needs-resync 于切片 3 落地——fanout 投递队列为切片 3 属主（每 session 有界 **16** 项冻结常量、溢出弃新置 `status.needsResync`——sticky、标记后继续投递）；WS 发送队列/连接级背压属切片 6（ADR 0010 L151 域）。

**切片 3/4 冻结词汇（补充）**：fanout 投递异步化 = observer 内只复制 owned bytes + 每 session 有界队列（16）+ 自延伸微任务泵（每项投递前让步 20——慢 listener 零阻塞 transaction/sequencer 槽）；`getStatus()` 第 11 字段 `needsResync: boolean`（sticky、继续投递、无清除 API）；epoch fence 触发面 = bump 槽 E5.5 主动 fence（conflicted + fanout 摘除 + 排队项取消——旧 session 对 bump 写零投递）与 apply 槽 R2 被动 fence **共用同一 finalize**；Runtime close 同步段 terminateAll → 终态 `closed`（其后 apply → `RUNTIME_WRITE_DISABLED`；已接纳 apply 槽无条件排空）；受保护字段判据 = 规范化深比较（合法结构值放行、契约外容器保守拒、白名单容器内嵌套契约外子值投影摊平）；apply 异常 committed 精确二分（beforeTransaction 探针——零 mutation → false，否则保守 true）。

### 4. Trusted apply 与角色权限

- 所有远端 apply 进入唯一 write sequencer，并在槽内完成 dirty notification。
- Hub 对 peer update执行 scratch clone 检查：SCHEMA 与复制身份 META 字段不得变化。
- Peer 接收 hub ROOT/SCHEMA/允许 META update。
- Peer 本地 `replaceSchema()` 使用稳定角色权限错误拒绝。
- Raw apply 不执行 VFSL ROOT 预校验；可能产生的状态标记为 `replication-unvalidated`。
- Hub degraded 拒绝复制写；peer degraded 只允许 hub→peer 内存 apply并继续 `saveDoc()`。

### 5. `@nomicore/replication-protocol`

- 严格实现`docs/protocols/instance-replication-v1.md`：20-byte大端envelope、一WS message一frame、namespaceId直接寻址、lib0 canonical payload。
- 显式envelope/protocol版本与capability协商，绝不依赖消息数值猜测。
- 实现append-only消息/错误注册表、direction-local sequence、专用ACK和统一ERROR。
- 显式直接依赖并锁定兼容的`yjs`、`y-protocols`、`lib0`组合。
- Byte-level golden、canonical roundtrip、截断/越界/尾随、版本矩阵与fuzz/property tests。
- 纯包不依赖Cordis、WebSocket、Registry或Node server。

### 6. `@nomicore/ws-replication` namespace状态机

- Peer target为精确`{ namespaceId, localOwner }`并支持幂等add/remove；wire不传owner。
- 实现connection、namespace与sync-round状态机及blocked/backoff/full-jitter恢复。
- 本地不存在时单frame完整snapshot bootstrap；同源时Peer发起双向state-vector round。
- identity/epoch mismatch稳定冲突且不自动覆盖；在线epoch bump发送IDENTITY_CHANGED fencing。
- Origin回声抑制、专用ACK、RESYNC_REQUIRED和Hub单observer多session fan-out。
- Per-namespace滑动窗口、有界队列、round-robin公平调度与connection control保留额度；溢出丢弃未发送增量并重新diff，不阻塞Runtime sequencer。

### 7. WebSocket 连接、认证与授权

- 一个 peer→hub 长连接 multiplex 多个 namespace。
- Peer 指数退避并带抖动重连；hub 不反向拨号。
- Bearer token upgrade authentication、instanceId 验证和 hub/peer 双向身份约束。
- Hub namespace 级 read/submit authorization；撤销只关闭对应 channel。
- 结构化认证/授权错误；日志与 metrics 不输出 token、update、SCHEMA/ROOT 内容。
- Nomicore 不终止 TLS；配置和部署文档必须声明生产环境由网关、代理或 service mesh 提供 TLS。

### 8. Reset、配置和 observability

- Peer `resetReplica(owner, namespaceId, expectedLocalIdentity)` 编排 close→archive→允许 bootstrap。
- Targets 支持运行时 add/remove；hubUrl、token 和授权规则通过插件 update/restart 生效。
- 结构化 observer seam：连接/channel 状态、重连、bootstrap/reconcile 字节、updates、ACK/apply latency、backpressure resync、auth/authz、identity conflict、degraded bypass 与稳定错误。
- 默认指标不以原始 owner、namespace、token 或 update 内容作为标签。

### 9. `apps/yjs-server` 与部署验收

- 最小 Cordis Host：Clock、Timer、Memory/File Persistence、NamespaceRegistry、WS replication。
- 配置加载：role、instanceId、listen/hub URL、token、精确 targets、资源上限和 Persistence 参数。
- 停机顺序：停止接纳并发送 GOAWAY → 真实 drain（拒绝新 namespace 工作、现有 channel 自然 CLOSE、已接纳 apply 排空）→ 全部 channel 终态提前关闭或 deadline 以 WS 1001 硬收口 → 异常安全的 channel teardown/session close/lease release → Registry shutdown → Persistence dispose → Timer/Clock；网络 deadline 不取消 Runtime barrier。
- 提供 hub + 两 peer 的本机多进程及跨机器部署说明；每个实例必须使用独立 FilePersistence rootDir。
- **role 注记（切片 3/4 落地）**：生产 composition root（本切片）必须显式向 Registry 构造传 `role`（hub/peer 与部署配置一致）；缺省 `'hub'` 只是未声明时的一致性零回归面，不作为生产配置遗漏的豁免。

### 10. 最终集成与审查

- Memory/File Persistence 上运行共享复制验收套件。
- 对包公共 exports、稳定错误注册表、CONTEXT、ADR、Phase 文档和应用配置做一致性收口。
- 执行 Standards/Spec 两轴审查后才合入主线。

## 协议与状态机验收

### Connection状态

```text
stopped → disconnected → connecting → handshaking → ready → draining
                         ↘ backoff      ↘ blocked
```

临时网络错误进入full-jitter backoff；认证、版本、身份或policy永久错误进入blocked并等待配置变化。Hub入站连接只走`upgraded → handshaking → ready → draining → closed`。

### Namespace状态

```text
targeted → opening → bootstrapping | reconciling → live
                                      ↑              ↓
                                      └─ needs-resync
          → closing → closed
identity/epoch mismatch → conflicted
terminal failure → failed
```

每轮reconciliation由Peer以syncRoundId发起，两个方向的Step2都收到SYNC_APPLIED才进入live。完整转移、timeout、ERROR终态与GOAWAY规则以protocol v1规范为准。

## 必须通过的场景

1. 一个 hub、两个 peer 在三处并发 ROOT 写，最终 Y.Doc 状态收敛；
2. peer 断线期间本地写，重连后双向 state-vector diff；
3. 本地不存在的新 peer 通过完整 update bootstrap，并补齐 bootstrap 竞态窗口；
4. replicationId 或 epoch 不一致稳定拒绝且不覆盖本地副本；
5. peer→hub SCHEMA 或复制身份 META 篡改在 live apply 前拒绝；
6. hub 的合法 SCHEMA replacement 单向传播到 peers；
7. hub persistence-degraded 拒绝 peer update，恢复后 diff 补齐；
8. peer persistence-degraded 拒绝本地业务写但继续 hub update 内存 apply，retry 后保存最新完整状态；
9. peer 在 degraded apply 后崩溃，从旧 snapshot 重启并由 hub 自动补齐；
10. 慢消费者触发 `needs-resync`，不阻塞本地业务 write sequencer；
11. 重复、乱序和重连 update 依靠 Yjs 幂等/state vector 收敛；
12. bearer token、namespace authorization、权限撤销和日志脱敏；
13. frame/update/channel/queue 上限按 channel 或连接正确隔离；
14. hub/peer 进程重启和各自 snapshot 恢复；
15. 复制管理写与恢复：
    - 15a（本阶段 Runtime/Lease 基础合同）：`enableReplication` 与 epoch bump 的 FIFO 槽序、dirty-not-durable 边界（dirty 登记 ≠ 已落盘）、File bump 至 epoch 2 后以 durable snapshot 重启恢复；fatal 只验收 committed-state recovery，不作 durable restart 承诺；
    - 15b（后续切片 3–8）：replication identity conflict 与 `resetReplica` archive 流程。
16. 优雅停机在 GOAWAY 后拒绝新 namespace 工作，允许现有 channel 自然 CLOSE；网络 deadline 不无限等待 ACK，Runtime barrier 继续完成停机前已接纳 apply，并在 session close 异常时仍 teardown、release lease；deadline 后迟到 apply resolve/reject 零 wire 副作用；
17. 第三方 Host 可直接基于 NamespaceLease/ReplicationSession 构造可信 transport；
18. Node 支持矩阵下所有 public types、async disposal 与 Cordis ordered shutdown 一致。

## 测试 seam

- Protocol 包使用 byte-level golden tests、截断/越界输入 tests、版本协商矩阵和 fuzz/property tests。
- ReplicationSession 使用确定性 Runtime/Persistence seam 覆盖 sequencer、origin、observer failure、degraded bypass 和 close。
- WS 层使用内存双端 transport/fake socket 覆盖连接与 channel 状态机，不用真实时间等待。
- 真实 WebSocket + MemoryPersistence 做快速多实例集成；FilePersistence 做进程重启、归档和恢复验收。
- 故障注入覆盖丢帧、重复帧、乱序、连接中断、队列溢出、flush failure、认证撤销和 shutdown race。

## 参考实现纪律

调研过的 `film-studio-fe` 项目 `apps/yjs-server` 实现可作为标准 sync/state-vector、multiplex、origin 和 bootstrap gate 的历史证据，但它不是本仓库规范依赖。Nomicore 不得复制其以下行为：裸 Y.Doc transport 写入、全局文档缓存、REST rebuild、手写 GC timer、token 日志泄漏、缺少资源级授权、非结构化错误、不一致控制帧或隐式协议版本识别。

## 非目标

- hub 自动选举、自动晋升、故障切换或从 peer 自动恢复；
- 多 hub、hub 级联、peer-to-peer、peer 同时连接多个 hub；
- 分布式 Registry、共享 FilePersistence rootDir 或文件锁；
- awareness/presence；
- REST/普通客户端 API 与 y-websocket 兼容端点；
- quorum durability、线性一致、全局递增更新序号；
- raw update 的完整 VFSL 校验或自动 rollback；
- identity/epoch conflict 自动覆盖；
- namespace list/discovery、通配 selector；
- durable outbox、增量 WAL、跨重连 update ID 去重表；
- 第二种 transport 及提前抽取 transport-independent replication seam。

## 阶段门禁

Phase 5 收口要求：

- ADR 0010、CONTEXT、package docs、public types、配置 schema 和稳定错误词汇一致；
- hub + 两 peer 的三实例端到端验收在 MemoryPersistence 和 FilePersistence 路径通过；
- 所有 frame/update/queue/channel 上限有确定性失败测试；
- 默认日志和 metrics 通过敏感信息/高基数审查；
- 每个实例独立 rootDir，生产 TLS 外置要求在部署文档中醒目标注；
- `pnpm typecheck`、全量 `pnpm test`、聚合 `tsc --noEmit` 和 `git diff --check` 通过；
- 所有实施 tickets 关闭，不存在 merge blocker；
- 对最终 integration PR 执行 Standards/Spec 两轴审查。
