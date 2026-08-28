# 冲突门禁报告

- 被审对象：`wiki/raw/task_ws-replication-hardening.md`（issue #161 任务简报，Phase 0 前置门禁）
- 冲突基准：`docs/adr/` 全集 10 篇（逐个全读，未抽样）+ `CONTEXT.md`
- SA8 产出时间：Phase 0 / round 1

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| 0001 | VFSL 文本是 schema 的唯一真相源 | accepted（2026-08-19 修订节生效） | 无关 | 任务不触及 schema 文本/信封/方言；无冲突 |
| 0002 | nomicore 是全新重写，authority 出范围 | accepted | 无关 | 任务不涉及 authority 规则；无冲突 |
| 0003 | 求值器与派生 schema | accepted | 无关 | 不触及求值/派生 schema/ROOT 约定；无冲突 |
| 0004 | vfsl-protocol 类型协议包 | accepted | 无关 | 不触及编译期投影；无冲突 |
| 0005 | 投影生成管线 | accepted | 无关 | 不触及 SchemaSource/codegen/domains；无冲突 |
| 0006 | Cordis 持久化插件 | accepted（#64/#79/#131/#133 增量修订） | 弱相关 | 任务不动 Persistence 契约；reset/bootstrap 走既有 seam；无冲突 |
| 0007 | 逻辑验证与 Yjs Runtime Bridge | accepted（Runtime/open/read 条款被 0008 取代；被取代部分不构成约束） | 无关 | 不触及校验管线；raw update 例外面已由 0010 定界且本任务不扩大；无冲突 |
| 0008 | NamespaceRuntime 读写能力与单序列器 | accepted（#93/#132 修订节） | 相关 | 任务全部要求与唯一 sequencer、close barrier「无条件排空」、`RUNTIME_WRITE_DISABLED` 码族、status replication 域不含网络/队列状态等条款方向一致；无冲突 |
| 0009 | NamespaceRegistry、租约与 Host 生命周期 | accepted（#131/#134 修订节） | 相关 | Lease release 同步停 session 接纳、release 不追踪已接纳 apply 槽、closing 不可逆、外部 Clock/Timer 与确定性测试纪律均被任务要求落实而非修改；无冲突 |
| 0010 | Hub/Peer WebSocket Y.Doc 复制与最终一致 | accepted（#134/#133 修订节） | 高度相关 | 任务 21 条要求全部是对本 ADR（尤其 L143–179）既有条款的落实/加固，或属其明文委托给 `docs/protocols/instance-replication-v1.md` 的 wire-contract 实现细节；无冲突 |

## 冲突点

无。逐条对照结果（任务简报 21 条要求 → 四级裁决全部 `no-conflict`）：

| # | 任务简报要求（摘要） | 对照 ADR 条款 | 裁决 | 依据 |
|---|---|---|---|---|
| 1 | accept() 绑定 Upgrade bearer-token 认证上下文 | ADR-0010 L147「Bearer token在HTTP Upgrade前认证」、L155「token 映射到……instanceId 与 namespace 权限」 | no-conflict | 落实 ADR 字面条款 |
| 2 | 拒绝 peerInstanceId ≠ Upgrade 身份的 HELLO；不以 wire 帧身份授权 | ADR-0010 L147「Upgrade后Peer发送HELLO，Hub回复HELLO_ACK并绑定Peer/Hub instance identity」、L157 | no-conflict | wire 断言身份不构成授权来源，正是 ADR 认证模型的语义 |
| 3 | Peer 回调绑定活跃 transport/连接代际，防旧 socket 迟到回调污染 | ADR-0010 L143「同一连接内同一 namespace只允许一个生命周期，关闭后重开必须重建连接」、L151「连接断开即close sessions/release Leases，不保留outbox」 | no-conflict | 跨代隔离是既有代际纪律的目的面 |
| 4 | BOOTSTRAP_ACK.ackedSequence 必须匹配已发 BOOTSTRAP_SNAPSHOT 序列 | ADR-0010 L147「每方向sequence从1严格递增……gap、repeat或错误ACK关联关闭连接」 | no-conflict | 字面落实 |
| 5 | CLOSE_OK.ackedSequence 匹配；无效关联不得完成 close | 同上 L147 | no-conflict | 字面落实 |
| 6 | Hub UPDATE ACK 超时 → memoized RESYNC_REQUIRED，Peer 发起恢复 round | ADR-0010 L151 恢复纪律（「重连重新OPEN并reconcile」、needs-resync）；CONTEXT「ReplicationSession」「needs-resync（sticky）——transport 须 reset/bootstrap」 | no-conflict | 恢复方向一致；RESYNC_REQUIRED 帧名属 L151 明文委托给 wire contract 文档的域，不构成 ADR 约束面 |
| 7 | 部分窗口推进后 ACK 超时正确 re-arm | wire contract 实现细节（L151 委托）；ADR 无相反条款 | no-conflict | — |
| 8 | UPDATE/数据帧走真实 per-namespace 队列 | ADR-0010 L151「Per-namespace有界队列溢出时丢弃未发送增量并进入needs-resync」（per-namespace 队列为 ADR 前提） | no-conflict | 落实 |
| 9 | 连接级 round-robin：control/error/ACK 优先 + 每 namespace 每轮至多一个数据帧 | ADR-0010 L151「connection按namespace round-robin公平发送，control/ACK保留额度」 | no-conflict | 字面落实 |
| 10 | maxQueuedBytesPerConnection 强制；shed 最大队列 namespace、标 needs-resync、回低水位 | ADR-0010 L165「per-channel/连接待发送字节」上限为插件配置、L151 溢出→needs-resync 纪律 | no-conflict | 落实 |
| 11 | 控制帧保留有界容量，耗尽以 CONNECTION_BACKPRESSURE 终止 | ADR-0010 L151「control/ACK保留额度」、L165 上限与稳定错误条款 | no-conflict | 错误码细节属 wire contract 域；方向一致 |
| 12 | 观察 bufferedAmount 高低水位，用注入 Cordis timer | ADR-0010 L165/L174（背压属 ws-replication 插件）；ADR-0009 L83「依赖外部 Clock 与 Cordis Timer，不各自实现或 fallback 到系统 timer」纪律同构 | no-conflict | 落实 |
| 13 | CLOSE 同步停 namespace/session 接纳后再 await 排空 | ADR-0010 L90「channel 关闭先关闭 session，再释放 Lease」、#134 R2-2 同步段纪律；CONTEXT「停接纳」同构 | no-conflict | 字面落实 |
| 14 | CLOSE 前接纳的 apply 全部进 drain 并在 session/Lease 释放前 settle | ADR-0010 L179「等待已被 Runtime 接纳的 apply 槽完成……释放 replication leases」；ADR-0008 L93「此前已接纳任务无条件排空，不取消、不设内部 timeout」 | no-conflict | 字面落实 |
| 15 | 防迟到 round 结算复活 closing/terminal/disconnected 到 live（双侧） | ADR-0009 L48「该转换不可逆」；#134 L245「closed/conflicted 皆终态并释放槽位」 | no-conflict | 终态不可逆纪律的落实 |
| 16 | GOAWAY/blocked 同步 quiesce 全部 namespace channel 与订阅 | ADR-0010 L147「GOAWAY提供相对drain timeout」、L151「连接断开即close sessions/release Leases」 | no-conflict | 落实 |
| 17 | namespace 关闭时 flush/settle 重复 OPEN waiters | ADR-0010 L143「同一连接内同一 namespace只允许一个生命周期」（重复 OPEN 属违约情形，妥善结算等待者不违反任何条款） | no-conflict | — |
| 18 | WS ping/pong 活性接线，不引入应用层 PING/PONG 帧 | ADR-0010 L147「WS ping/pong负责活性」 | no-conflict | 字面一致 |
| 19 | 替换生产 queueMicrotask delay loop 为显式确定性测试 seam | ADR-0009 L83「确定性测试使用 manual Clock 状态与 fake timer协调推进」（方向一致）；注意边界：#134 R2-3 冻结的「自延伸微任务泵」属 namespace-runtime session fanout 域，非本要求对象（见边界注记 1） | no-conflict | 落实确定性测试纪律 |
| 20 | 移除/使用死的 per-namespace 队列/生命周期抽象，收敛唯一权威机制 | ADR-0008 唯一 sequencer、ADR-0010 L151「网络背压不得进入Runtime sequencer」分层纪律——消除 ws-replication 内死抽象不触碰 ADR 冻结面 | no-conflict | 实现域清理 |
| 21 | 澄清 resetReplica/结构化 observability/app 组合是否后续切片交付 | ADR-0010 L57/L167/L175 均为 Phase 5 首版范围条款；切片划分以 `docs/phases/phase-5-websocket-replication.md` 为准（非 ADR/CONTEXT 约束面）；仅澄清与建票，不修改承诺 | no-conflict | 无条款被推翻或修订 |

四级裁决分布：no-conflict × 21；override-declared × 0；evolution × 0；hard-violation × 0。

## 结论

**Verdict: clear —— 放行，无需 override，无需 Jim 裁决。**

任务简报自述为「PR #160 post-review 协议/生命周期缺陷加固」，逐条核对证实：全部要求都是把实现向 ADR-0010（L143–179 认证、序列、恢复、公平发送、背压、停止顺序）及 ADR-0008/0009 相应生命周期纪律**收敛**的修复动作，没有任何条款要求推翻、绕过或实质修订既有 ADR 决策；wire 层新增细节（如 RESYNC_REQUIRED、CONNECTION_BACKPRESSURE）落在 ADR-0010 L151 明文委托给 `docs/protocols/instance-replication-v1.md` 的域内，属 wire contract 演进而非 ADR 演进。

### 边界注记（非冲突，供 SA1/SA2 守住不越界）

1. **fanout 微任务泵域界**：#134 R2-3 冻结的「容量 16 队列 + 每项让步 20 次微任务泵」位于 `packages/namespace-runtime/src/replication-session.ts`（session fanout 域），是 ADR 收录的冻结词汇。任务要求 19/20 的对象是 ws-replication 传输层的测试可观测 delay loop 与死抽象——实现时不得顺手替换/移除 runtime 侧冻结泵常量与让步区间。
2. **needs-resync 双层语义**：connection 层 per-namespace 发送队列的 needs-resync（ADR-0010 L151）与 session fanout 队列的 `status.needsResync` sticky 标记（CONTEXT「ReplicationSession」+#134 R2-3）是两个域；加固不得把 transport 背压状态塞进 Runtime/Session status（CONTEXT _Avoid_：「把网络状态塞进 Runtime capability status」）。
3. **raw apply 例外面不得扩大**：加固 CLOSE/ACK/背压时不得给 trusted raw update 加 VFSL 校验或「apply 失败回滚」（ADR-0010 L94–107、CONTEXT「复制未校验」）。
4. **错误码域**：连接/channel 层新增稳定错误码（如 CONNECTION_BACKPRESSURE）注册于 wire contract 与 ws-replication 包，不得挤占 Runtime 域码族（`RUNTIME_WRITE_DISABLED` 等按 ADR-0008 #93 修订节域界使用）。
