# 冲突门禁报告（设计后复审）

**被审对象**：SA1 设计 `wiki/raw/task_ws-replication-close-peer-transport-synchronously_design.md`（SA1 R0 初版；issue #168：peer 侧 HELLO 超时同步关闭旧 transport）
**门禁类型**：设计后复审（SA1 设计产出后，SA2 攻击评审前）
**产出时间**：2026-08-30（SA8）
**对照基准**：ADR 全集（worktree `docs/adr/0001–0010`，10 份全文逐份读取，禁止抽样）+ CONTEXT.md（全文）+ 经 ADR-0010 正文「唯一 wire contract」条款纳入基准的 `docs/protocols/instance-replication-v1.md`（关键节 §13.1/§14/§15.1/§15.2/§18/§23.1/§23.2 已逐行核对原文）
**基线核实**：worktree HEAD = `ffca4f6`（PR #185），与设计声明基线一致；`packages/ws-replication/src/peer-connection.ts` 与 SA6 两个锚测试文件在场。前置门禁报告的「worktree 基线错位」事项**已解决**——ADR-0010、CONTEXT.md 复制术语块、协议文档现均在 worktree 内（本次复审直接读取 worktree 版本核实，未再依赖分支线读取）。

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| 0001 | VFSL 单一真相源 | accepted（2026-08-19/21 修订） | 否 | schema 引擎域；设计不触及 schema 文本/信封/方言；无冲突 |
| 0002 | 重写定位、authority 出范围 | accepted | 弱 | 后果实「同步协议细节…PRD 必须显式划定」——ws-replication 行为由 ADR-0010 管辖；设计未越权划界；无冲突 |
| 0003 | 求值器与派生 schema | accepted | 否 | 无关联 |
| 0004 | vfsl-protocol 类型投影 | accepted | 否 | 无关联 |
| 0005 | 投影生成管线 | accepted | 否 | 无关联 |
| 0006 | 持久化 DocPersistence | accepted（#64/#79/#133 修订） | 否 | DocHandle/flush/archive 域；transport close 不经 persistence seam；无冲突 |
| 0007 | 逻辑校验与 Yjs runtime bridge | accepted（Runtime/open/read 条款被 0008 取代） | 否 | 剩余有效条款（零写/校验/detached 构造/observer no-rollback）与 WS transport 生命周期无交集；无冲突 |
| 0008 | NamespaceRuntime 读写能力与单序列器 | accepted（#93/#132 修订） | 否 | 其 close()/停接纳/`RUNTIME_*` 码域是 Runtime 生命周期词汇；设计改动全部位于 `peer-connection.ts` 连接 FSM 域，未借用/未冲突这些码；无冲突 |
| 0009 | Registry、租约与 Host 生命周期 | accepted（entry key 条款被 0010 取代） | 否 | 无关联（含被 supersede 的条款亦无关）；无冲突 |
| 0010 | Hub/Peer WebSocket Y.Doc 复制 | accepted（修订至 issue #172） | **是** | 唯一管辖 ADR。设计逐决策点对照见下「冲突点」表后的正向核对——全部为**对齐既有决策**，无冲突 |

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| （无） | — | — | — | — | — |

无冲突点。设计全部实质决策点的正向核对（裁决均为 no-conflict）：

1. **hello 超时同步关闭 = 对齐 wire contract §18 明文**（经 ADR-0010 正文「以`docs/protocols/instance-replication-v1.md`为唯一wire contract」纳入基准）。§18 :526 原文：「HELLO/pong timeout关闭连接。Open/bootstrap/reconcile/close/ACK timeout只收口 namespace……」。设计 §4.3 在 hello 超时回调进入 backoff 前同步执行 detach-close——是对该条款的字面兑现（现状实现的偏差由本修复收口，前置门禁已裁定任务方向为对齐而非推翻）。
2. **共享 helper 的四步次序 = 对齐 §18 R4 次序纪律**。§18 :524 原文：「pong 超时按临时失败处理：先停止旧 liveness、退订旧 transport listener 并使 connection epoch 失效，再关闭传输（close code 1001）并经 backoff 重连；**epoch 必须在调用可能同步重入的 transport `close()` 前失效**」。设计 §4.1 helper 序列 `stopLivenessNow → unsubscribeTransport → epoch+1 → close(1001)` 与该权威次序逐步一致；epoch 递增位于 close 之前，次序纪律单点结构化保持。
3. **`close(1001, 'hello-timeout')` = 对齐 §14 粗分类 + §15.1 backoff 分类 + ADR-0010 #161 round 2 修订先例**。§14 :387「1001：GOAWAY、计划重启或服务停止」；§15.1 :440「网络断开或无明确 GOAWAY的 1001：普通 backoff」；ADR-0010 修订节 :302-303 登记「**peer pong 超时 close(1001) + 代际安全脱离后重连**」。hello 超时属本地超时主动断开稍后重连，正落 1001 粗类；设计 §6 的裁决论证与三处基准一致。
4. **零 wire ERROR 帧 = 对齐内部路径注册姿势**。§13.1 :346 的 `HELLO_TIMEOUT | yes | yes | 1002` 是连接级 wire ERROR 注册行（hub 侧 `connectionFatal` 消费，设计保留 hub 侧该行为零改动）；§23.2 :656 `PONG_TIMEOUT`（「hub 活性失联；无 wire 帧——本地内部路径」）确立本地超时无 wire 帧的注册姿势。设计 §3.2「不发明新观测词、新 close code、新 wire 帧」与 §14「framing 仍可信时 best-effort 发 ERROR」不冲突——§18 R4 权威序列本身即无 ERROR 帧步骤，且 peer 若向 hub 发 `HELLO_TIMEOUT` ERROR（close 1002/blocked 语义）将与自身 backoff 重连意图及 §15.1 分类相悖；设计 §6 论证 2 的码域归属分析成立。
5. **临时失败 → backoff = 对齐 §15.1 状态机**。§15.1 :410「handshaking ├─ timeout/temporary-close → backoff」；设计 G1–G4、§5 R9（恰好一次 `connection-backoff-scheduled`、零 `connection-failed`）保持该迁移与分类。
6. **观测面零新词 = 对齐 §23.1/§23.2 append-only 纪律**。§23.1 :610 `connection-backoff-scheduled` 的 reason 词表已含 `hello-timeout`；close reason 复用观测词表既有词。设计不扩任何注册表。
7. **hub 侧零改动、兜底保留 = 对齐 §15.2 与 §18 hub 侧要求**。§15.2 hub 状态机（无 dial/backoff）不变；hub 等 HELLO 超时仍 `connectionFatal('HELLO_TIMEOUT', 1002)` 关闭（§18 对 hub 的要求保留为纵深防御，迟到 fire 撞 state 守卫幂等 no-op——设计 §4.5 论证）。
8. **pong-timeout 路径机械提取 = 复用已登记机制而非修订**。ADR-0010 #161 round 2 修订登记的 detach-close 序列被提取为共享 helper，行为字节等价（设计 §4.2，守卫原样保留、次序不变），且有 6 个既有绿测试文件锁定（设计 §7.2）——是决策的**实现收敛**，非决策变更。
9. **恢复链不变 = 对齐 ADR-0010 正文恢复纪律**。「关键恢复纪律为：连接断开即close sessions/release Leases，不保留outbox；重连重新OPEN并reconcile」——设计 G4/§5 R8 的重拨链（backoff → wire2 → ready → live）与该纪律同向，无 outbox 引入。
10. **冻结面（dial-throw/onClose 行为字节不变）= 任务域约束，非 ADR 契约**。其出处为 PR #165 round 2 任务冻结（wiki/raw）；按 ADR-0010 #172 修订第 2 条「`wiki/raw` 非规范」以任务约束对待——设计 G5 保持两入口零改动，与 ADR 无冲突亦无强制。
11. **不改 `docs/protocols` / `docs/adr`（设计 §3.2 非目标）= 定性正确**。修复是对齐 §18 既有条款，不构成对任何条款的修订意图——因此**无 evolution 情形**（不存在「意图修订决策但未走 supersede」的状态），亦无 override 声明需求。
12. **CONTEXT.md 术语**：设计通篇使用 hub/peer 术语（_Avoid_: master/leader/slave/follower 无违例）；不触及复制谱系/epoch/ReplicationSession/实例角色等术语域。无冲突。

## 结论

**放行（clear）。** SA1 设计与 ADR 全集 + CONTEXT.md + 纳入基准的 wire contract 无任何冲突；四级裁决分布：

- no-conflict × 12（上述正向核对全数）
- override-declared × 0
- evolution × 0（设计显式声明不改协议/ADR 条款，修复定性为对齐）
- hard-violation × 0

设计的关键结构选择（共享 guarded helper 承载 §18 R4 次序纪律、close 签名 `{1001,'hello-timeout'}`、hub 侧零改动保留兜底、观测面零新词）全部落在既有决策的延长线上，已登记至相关决议文档「设计后复审追加」节供 SA2/SA3/SA4 复用。

### 需总控注意的非冲突事项

1. **【引用编号勘误·建议 SA1 下轮或 SA2 顺带更正】**设计 §6 论证 2 与 §10 假设 A1 引用「§25 `PONG_TIMEOUT`」——协议文档**无 §24/§25**（章节止于 §23.7）；该摘引实际位于 **§23.2 稳定码闭联合**（`docs/protocols/instance-replication-v1.md:656`）。摘引文字本身属实（「无 wire 帧——本地内部路径」逐字核对一致），仅章节号失准（前置门禁的相关决议文档同源笔误，一并勘误）；裁决基于实文，不受影响。
2. **【轻微摘引省略·无需动作】**设计 §6 论证 1 摘引 §15.1 为「无明确 GOAWAY 的 1001：普通 backoff」，原文 :440 为「网络断开或无明确 GOAWAY的 1001：普通 backoff」——省略「网络断开或」前缀，语义兼容，不影响论证。
3. **【状态更新】**前置门禁报告「需总控注意」第 1 条（worktree 基线错位：main @ `b264aae` 不含 `packages/ws-replication`/ADR-0010）**已解决**：worktree 已重定基于 `ffca4f6`（= PR #185，phase-5 分支线 head），全部基准文档与被改文件在场，SA1/SA2/SA3 可直接在本 worktree 工作。
4. 设计优劣与攻击面充分性（如 §5 R1–R12 推演质量、方案 A/B 取舍）属 SA2 评审职权，本报告不越界判断。

### 产出文件

- 相关决议（全链 SA 复用，本次追加「设计后复审追加」节）：`wiki/raw/task_ws-replication-close-peer-transport-synchronously_relevant_decisions.md`
- 本报告：`wiki/raw/task_ws-replication-close-peer-transport-synchronously_design_conflict_report.md`
