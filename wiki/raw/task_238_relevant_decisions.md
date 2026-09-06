# 相关决议 (Relevant Decisions) — Issue #238 冲突门禁

> 冲突门禁前置产出。只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。

## 任务标识

- 任务：Issue #238 — BUG investigation: Hub→Peer UPDATE apply 延迟呈阶梯累积，最高 11 秒
- 简报来源：`TASK.md`（Repository: welltop-jim-wang/nomicore, Issue: #238）+ Issue #238 正文 + Owner 评论
  `IC_kwDOT8JVvs8AAAABS2CyWg`（welltop-jim-wang，created/updated 2026-09-06T13:39:25Z，当前唯一评论）
- Worktree：`/home/wangjian/nomicore-fix-issue-238`（branch `mabf/issue-238`，HEAD `9e3f0bf`）
- 冲突基准：`docs/adr/` 全部现存文件（0001–0010、0012 共 **11 个**，逐个全读；**0011 编号空缺，文件不存在**，全仓无引用）+ 根目录 `CONTEXT.md` 全读
- 辅助核验（不构成独立基准）：`docs/protocols/instance-replication-v1.md`（尤其 §3/§10/§17/§23）——该文档被 ADR-0010 正文明文收录为唯一 wire contract（「连接与namespace状态、消息码、payload字段、错误码、timeout、close code、backpressure和完整时序以`docs/protocols/instance-replication-v1.md`为唯一wire contract」），§23 observability seam 又被 ADR-0010 L167（结构化 observer seam）收录，故按收录关系核验。

## Owner 要求摘要（被审对象）

1. 已有确定性复现（Peer 同 namespace write sequencer 被慢 dirty notification 占槽 → 五笔 Hub→Peer 小 UPDATE 排队，`applyLatencyMs = [5000,4000,3000,2000,1000]`，连接持续 live、无重连、无 namespace error，5 笔全部 apply/ACK）。
2. 后续工作须增加**分段观测**，区分：event-loop stall、sequencer queue wait、protected check/live apply、dirty notification。
3. 须增加可靠的 **sent/applied/acked 跨阶段关联 ID**。
4. 复现测试与可选时钟注入是**基线**；不得将其视为生产 11 秒长阶段的证明。

（与 Issue #238 正文的 Observability requirements / Acceptance criteria 一致：分段单调时差、queue wait/depth、event-loop delay、apply source（live UPDATE / sync Step2）、protected-check 与 dirty-notification 时长；安全字段纪律；更新 protocol §23；确认并修复至少一个根因。）

## 相关 ADR

### ADR-0010 Hub/Peer WebSocket Y.Doc 复制与最终一致（accepted；含 #134/#133/#161/#172 修订节）— 核心

`docs/adr/0010-hub-peer-websocket-ydoc-replication.md`

- 与本任务的关联点：Peer 侧 apply 管线、observer seam、安全字段与 wire 契约全部冻结于本 ADR 及其收录的 protocol。
- 核心条款（原文摘录）：
  1. L96–103 Trusted raw update 六步管线：「远端 update 仍必须进入该 namespace 的唯一 write sequencer：1. lifecycle、角色、身份和 epoch gate；2. 必要的受保护字段检查；3. 一次 `Y.applyUpdate`；4. Runtime observer 产出 owned update 与受控 origin；5. `await saveDoc(handle)` 登记 dirty；6. 释放 sequencer 槽。」——分段观测的 stage 分解对象。
  2. L105：「Hub 接收 peer update 前，在 scratch clone 上确认 update 不改变 SCHEMA……该检查执行角色权限，不等同于 VFSL ROOT 校验。」——protected check 的语义来源。
  3. L113：「队列溢出只把 channel 标记为 `needs-resync`，不得阻塞 write sequencer。」——fanout 观测/背压纪律。
  4. L151：「连接与namespace状态……以`docs/protocols/instance-replication-v1.md`为唯一wire contract……Per-namespace有界队列溢出时丢弃未发送增量并进入needs-resync；connection按namespace round-robin公平发送，control/ACK保留额度，**网络背压不得进入Runtime sequencer**。」
  5. L159：「Token、Yjs update、SCHEMA/ROOT 内容以及未经控制的 owner/namespace 不得出现在默认日志或高基数指标标签中。」——观测字段安全清单的 ADR 级来源。
  6. L163–167 资源限制与 observability：「复制插件提供结构化 observer seam 给日志/metrics/trace Adapter，不提供业务公共 update events。最小观测面包括：……apply/ACK latency……」——分段观测扩展的指定落点。
  7. L213 非目标：「durable outbox、增量 WAL 或跨重连 update ID 表」——关联 ID 必须连接局部，不得跨重连持久化。
  8. #134 修订节 L241（O-11）：`session.getStatus()` 形状冻结（state + 冻结四域 + direction + currentEpoch + rootValidation + durability + observerFailures + needsResync）；「session 状态绝不入 Runtime status」。
  9. #134 修订节 L251–255（O-12）：受保护字段判据 = scratch clone 上「内容投影相等」；「**已知成本登记**：scratch 预演 O(doc)/apply……增量检查（仅比对 diff 触达容器）**留作后续演进，非过早优化，不得在未评审情况下预写**」。
  10. #134 round-2 修订 L267：fanout 投递异步化——observer 内只做谓词/复制/入队，「listener 调用全部移出 transaction 栈」；队列容量 16 冻结常量；溢出 → `needs-resync`（sticky）。
  11. L220：「trusted raw update 明确不继承普通业务写的完整 VFSL zero-write 保证。」（replication-unvalidated 语义，观测不得伪装成校验失败。）
- 对本任务影响：分段观测是六步管线与 observer seam 的既有方向内扩展；关联 ID 可由 protocol 既有 per-frame sequence 派生（见 protocol 条目 2）；修改受保护判据/槽序/ wire 字段均属演进门（见冲突报告 G1–G4）。

### ADR-0008 NamespaceRuntime 读写能力与单序列器（accepted；含 #93/#132/#134 修订节）— 核心

`docs/adr/0008-namespace-runtime-read-write-capabilities-and-sequencer.md`

- 与本任务的关联点：写序列器槽序、dirty notification 位置、status 公共面边界——复现机制的契约层与观测数据的合法落点。
- 核心条款（原文摘录）：
  1. L40：「同一 namespace 内所有受控 Y.Doc 写共享唯一严格 FIFO write sequencer；不同 namespace 可并行。」
  2. L51：「每个真正写任务的槽依次执行：lifecycle/fatal gate、`DocHandle.getStatus()` writable gate、输入快照、领域校验和 detached 构造、一次 Yjs transaction、`await notifyDirty()`，然后才释放给下一任务。」——慢 dirty notification 占槽即本条款的字面行为。
  3. L101：「status 不暴露队列长度、任务类型或 sequence。v1 不提供公共事件订阅；**队列进度和内部事件属于日志、metrics 与 trace**。」——queue wait/queue depth 字段的指定落点（非 status）。
  4. #132 修订节 4（L140）：`enableReplication()` / `bumpReplicationEpoch()` 「四者均进入同一严格 FIFO write sequencer，**完整槽序（……）不变**」。
  5. #132 修订节 5（L141）：Runtime status `replication` 域「仅含持久 identity/epoch 的两态联合……**不含 session、网络、队列或 sync 状态**」。
  6. L97：「测试通过包内确定性 seam 注入可控 P0、dirty notifier、handle 与 fault。」——复现所用 saveGate 式注入的契约依据。
  7. L99：close barrier 前「已接纳任务无条件排空，不取消、不设内部 timeout」。
- 对本任务影响：复现机制 = 契约内行为（见 CONTEXT「写序列器」词条）；任何以打破 FIFO/移动 `await notifyDirty()` 为手段的修复均冲突（演进门 G1）。

### ADR-0006 Cordis 持久化插件——DocPersistence 接口与 doc 三条目内容布局（accepted；含 #64/#79/#131/#133 修订）— 支撑

`docs/adr/0006-server-persistence-docstore.md`

- 与本任务的关联点：dirty notification（`saveDoc`）的语义边界——「慢 dirty notification」根因判定的契约基准。
- 核心条款（原文摘录）：
  1. L33：「saveDoc = 脏状态通知，不是同步落盘……saveDoc 返回仅表示脏状态已登记，不构成该次写入已落盘的承诺。」
  2. L34：「持久层内部调度……第一次 dirty 启动 max-dirty 计时器（默认 5s）；每次 saveDoc 重置 debounce 计时器（默认 500ms）……flush/retry 同属持久层内部。」
  3. #79 修订 2（L192）：「saveDoc 是 mutation 后的 dirty notification：只要租约有效……saveDoc 必须递增 dirtyGeneration 并 **resolve**——entry 处于 `persistence-degraded` 不构成拒绝理由。」
- 对本任务影响：若生产慢 dirty 阶段源自 Persistence 在 resolve 前做重活（违背「登记即返回」），修复方向是回归本契约，不构成演进；观测 dirty-notification 时长不改变该语义。

### ADR-0007 逻辑验证与 Yjs Runtime Bridge 分层（accepted；open/read 条款已被 ADR-0008 取代）— 支撑

`docs/adr/0007-logical-validation-and-yjs-runtime-bridge.md`

- 与本任务的关联点：observer 隔离纪律与「优化须保留行为等价测试」先例。
- 核心条款（原文摘录）：
  1. L54：「Yjs observer 不得向事务调用栈抛异常；Runtime 自有 observer 必须记录或异步上报。」
  2. L59：「继续优化完整校验成本时**必须保留行为等价测试**。」
- 对本任务影响：槽内采样/探针不得向事务栈抛错；若修复选择降低 O(doc) 成本（scratch clone 或完整 ROOT 校验），行为等价测试是硬要求。

### ADR-0009 NamespaceRegistry、调用方租约与 Host 生命周期（accepted；含 #131/#134 修订节）— 支撑

`docs/adr/0009-namespace-registry-leases-and-host-lifecycle.md`

- 与本任务的关联点：Clock/Timer 纪律与确定性测试模式——复现的手动时钟注入、观测的单调时源。
- 核心条款（原文摘录）：
  1. L26：Registry 依赖「`@nomicore/clock` 提供的通用 `ctx.clock`，其 `now()` 返回**可跳变**的 Unix epoch milliseconds」。
  2. L83：「Persistence 和 Registry 都依赖外部 Clock 与 Cordis Timer，不各自实现或 fallback 到系统 timer。**确定性测试使用 manual Clock 状态与 fake timer协调推进**。」
  3. L95：Registry 核心「通过内部结构化 observer seam上报生命周期与故障……v1不提供公共事件订阅」——包内观测 seam 的既有形态。
- 对本任务影响：event-loop delay / 分段时差探针必须走注入时源（单调），禁止 `Date.now()`/`performance.now()` 回退（protocol §23.4 同款明文）；复现的手动单调时钟与 ADR 纪律一致。

### ADR-0012 实例身份单一真相与 WebSocket plugin 所有权（accepted；issue #204 已实现）— 边界

`docs/adr/0012-instance-identity-and-websocket-plugin-ownership.md`

- 与本任务的关联点：观测数据属主与泄漏面边界。
- 核心条款（原文摘录）：
  1. L22：「status、observer 与错误不得泄漏 token、Authorization、owner 完整值、Schema/Data、Yjs bytes 或 stack。」
  2. L16：Peer/Hub 配置域拥有「observer 与 adapter overrides」——观测 seam 属 WS 插件配置域。
- 对本任务影响：新增分段字段/关联 ID 落在 ws-replication/复数插件 observer 配置域；安全清单与 ADR-0010 L159、protocol §23.3 三重一致。

### 其余 ADR（与本任务无关联，仅盘点登记）

ADR-0001（VFSL 单一真相源）、ADR-0002（重写定位/authority 出范围）、ADR-0003（求值器/派生 schema/ROOT）、ADR-0004（vfsl-protocol 类型投影）、ADR-0005（投影生成管线）——均属 VFSL schema/代码生成域，不触及复制 apply 管线、sequencer、observability 或 persistence 调度；无对本任务的约束。（ADR-0011 编号空缺：`docs/adr/` 无该文件，全仓 `docs/`、README 无引用。）

## 被收录 protocol 的关键条款（经 ADR-0010 L151/L167 收录核验）

`docs/protocols/instance-replication-v1.md`

1. §3（L56–57）：固定 envelope 含「sequence | uint32，正常 frame 从 `1` 严格递增」（per-direction）；§10.2（L279）：UPDATE_ACK 携带「ackedSequence | varUint | UPDATE sequence」——**sent/applied/acked 关联可由既有 wire sequence 派生，无需新 wire 字段**。
2. §10.1（L267）：Hub 接收 update「在同一 sequencer槽完成 epoch/role gate、scratch保护检查、live apply和 dirty notification」——分段观测与 wire 契约槽描述一致。
3. §23.1（L606–654）：20 型事件词汇（`update-sent`/`update-applied`/`update-acked`/`sync-diff-applied` 等）＋ apply 成功路径互斥规则（每笔成功 apply 恰一事件，live UPDATE / Step2 / degraded 三选一）——「apply source」区分的既有载体。
4. §23.3（L670–683）：Safe-field 允许/禁止清单——「`applyLatencyMs`/`ackLatencyMs` 是**差值**非绝对时间戳」；禁止 token/owner/Yjs bytes/SCHEMA/ROOT/原始 cause/wire 自由文本/不受控高基数字段。
5. §23.4（L685–703）：事件在「决策已落定之后」发射，「发射点……**永不位于 Registry write sequencer 槽内**」；`clock?: ReplicationClock`（单调）；「实现内禁止 `Date.now()`/`performance.now()` 回退」；「无 observer = 零事件、零状态投影读取、零时钟调用」；`applyLatencyMs` = apply 成功续体 − 进入 apply「**含 write sequencer 排队等待**」。
6. §23.6（L731–733）：「`namespaceId`/`connectionId` 是事件 payload……**默认不绑 metric label**」——关联 ID 仅 trace/受控日志可用。
7. §23 开头（L600–604）：seam「**不改变任何 wire 字节**……append-only：事件类型、reason/cause/via 词表、稳定码表只增不改」。

## CONTEXT.md 相关术语

- **写序列器（write sequencer）**（L77–79）：「每个 NamespaceRuntime 独有的严格 FIFO：P0 与同一 namespace 的全部受控 Y.Doc 写共享顺序，**前项完成 dirty notification 后下一项才执行**；读取不进入该序列。」→ 复现机制（慢 dirty notification 阻塞后续 remote apply）是**词汇层已文档化的不变量**，不是缺陷本身；打破它是术语/契约变更。
- **ReplicationSession**（L133–135）：「……提供……进入本地唯一 write sequencer 的 trusted apply（`applyRemoteUpdate`）……fanout 投递有界队列溢出将 session 标记 `needs-resync`」。
- **复制未校验（replication-unvalidated）**（L137–139）：raw apply 成功 ≠ VFSL 合法——分段观测不得把 protected check 描述为 VFSL 校验。
- **Hub / Peer**（L113–119）、**实例身份**（L109–111）、**namespaceId**（L121–123）：身份与安全文法；观测标识沿用受控词汇。
