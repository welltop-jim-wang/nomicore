# 冲突门禁报告 — Issue #175 主动 reauthentication 生命周期

## 任务标识

- 任务：Issue #175 — 主动 reauthentication 生命周期（Bug 修复）
- 简报：`wiki/raw/task_active-reauthentication-lifecycle.md`
- Worktree：`/home/wangjian/nomicore-fix-issue-175`（branch `fix/issue-175-on-fix-issue-138-on-docs-phase-5-websocket-`）
- 阶段：前置冲突门禁（SA 派发前）
- 裁决人：SA8 Conflict Gatekeeper

## 检查范围

- 冲突基准：`docs/adr/` 全集 **10 个 ADR（0001–0010），逐个全读，无抽样** + 根目录 `CONTEXT.md` 全读。
- 被审对象：任务简报 Problem 与 Acceptance Criteria 1–8 全文。
- 辅助核验（不构成独立基准）：`docs/protocols/instance-replication-v1.md` 中 REAUTH/GOAWAY/1001/blocked 相关条款——该文档被 ADR-0010 正文明文收录为唯一 wire contract（「连接与namespace状态、消息码、payload字段、错误码、timeout、close code、backpressure和完整时序以`docs/protocols/instance-replication-v1.md`为唯一wire contract」），故按 ADR 收录关系核验。代码与 wiki 其他文档未作为阻塞依据。
- 被任一 ADR 标记 superseded 的条款（ADR-0007 的 open/read 编排与 schema-aware read，已被 ADR-0008 取代）不计入约束。

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0001 | VFSL 文本是 schema 的唯一真相源 | accepted | 否 | 任务不触及 schema 文本/信封/方言；无冲突 |
| ADR-0002 | nomicore 是全新重写，authority 出范围 | accepted | 否 | 任务不涉及旧 authority 规则；无冲突 |
| ADR-0003 | 求值器与派生 schema | accepted | 否 | 任务不触及求值/ROOT/联合表示；无冲突 |
| ADR-0004 | vfsl-protocol 类型投影 | accepted | 否 | 任务不触及类型投影；无冲突 |
| ADR-0005 | 投影生成管线 | accepted | 否 | 任务不触及生成管线/SchemaSource；无冲突 |
| ADR-0006 | 持久化 DocPersistence 与 docstore | accepted（含 #64/#79/#131/#133 修订） | 否 | 任务不改持久化契约；无冲突 |
| ADR-0007 | 逻辑校验与 Yjs Runtime Bridge | accepted（open/read 条款被 ADR-0008 取代） | 否 | 残余有效条款（mutation 管线/零写入/observer）与本任务无交集；无冲突 |
| ADR-0008 | NamespaceRuntime 读写能力与单序列器 | accepted（含 #93/#132/#134 修订） | 是（边界约束） | AC5 的 blocked 状态须留在复制插件/WS 层，符合「`replication` 域仅含持久 identity/epoch 两态……不含 session、网络、队列或 sync 状态」；任务未要求扩 Runtime status；无冲突 |
| ADR-0009 | NamespaceRegistry、租约与 Host 生命周期 | accepted（含 #131/#134 修订） | 是（次序约束） | AC6 竞态收口复用既有「先关 session 再释放 Lease」「shutdown 停止接纳」纪律；任务与之一致；无冲突 |
| ADR-0010 | Hub/Peer WebSocket Y.Doc 复制与最终一致 | accepted（含 #134/#133/#161 修订） | 是（核心） | 任务全部 AC 是对该 ADR 及其收录 wire 契约的**兑现**而非修订（逐条见下）；无冲突 |

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| — | — | — | — | — | 无冲突项（hard-violation 0 / override-declared 0 / evolution 0） |

无冲突项。逐项对照说明（非冲突，供 SA1/SA2 参考）：

1. **AC1/AC2（认证 Adapter reauth seam / Hub 发送 GOAWAY(REAUTH_REQUIRED)）vs ADR-0010**：ADR-0010 认证节已确立「WebSocket upgrade 使用 bearer token 认证实例身份」「framing、认证等连接级错误才关闭整条连接」；其收录的 wire 契约明文「已建立连接只有在认证/授权 Adapter主动发 reauth/revoke事件时关闭」（instance-replication-v1.md L450）。任务要补的 Hub 侧 seam 正是该既有语义的实现缺口（PR #173 已做 Peer 侧识别）——属 ADR 框架内的缺陷修复，不新增决策、不推翻条款。裁决 no-conflict。
2. **AC3（只影响所需连接）vs ADR-0010 L158「权限撤销关闭对应 channel，不必关闭整条 WS」**：两条款互补不冲突——L158 约束 namespace 级 authz 撤销（channel 级最小影响），L165 约束认证级失效（连接级）；reauth 属认证级，收口整条该实例连接、不波及其他实例/namespace 连接，与两条均一致。裁决 no-conflict。
3. **AC4（GOAWAY drain/deadline 后 WS 1001 关闭）vs ADR-0010 L147/L151 与 #161 修订**：「GOAWAY提供相对drain timeout」、wire 契约 L149「现有 namespace 到 deadline 前自然收口，之后发送方以 WS 1001 关闭」、#161 修订「peer pong 超时 close(1001)」「GOAWAY/blocked/连接收口同步静默订阅先于异步 drain」——任务要求即既有条款原文。裁决 no-conflict。
4. **AC5（Peer blocked，token/config 明确变化后恢复）vs ADR-0008 #132 修订 5 / ADR-0010 L90**：blocked 恢复语义已被 wire 契约状态机收录（L439「`REAUTH_REQUIRED`：blocked，等待 token/config变化」）；状态归属约束（不进 Runtime status）任务未违反，留作 SA1 设计红线。裁决 no-conflict。
5. **AC6（幂等、无 unhandled rejection、与 disconnect/hub.close 竞态）vs ADR-0009/ADR-0010**：与「连接断开即close sessions/release Leases」「停止顺序：复制插件停止接纳连接/target……不无限等待网络 ACK」一致，是既有收口纪律的强化测试要求。裁决 no-conflict。
6. **AC7（不暴露 token）vs ADR-0010 L159**：「Token、Yjs update、SCHEMA/ROOT 内容……不得出现在默认日志或高基数指标标签中」——AC7 是该条款在错误/observer/wire 面的等价强化。裁决 no-conflict。
7. **AC8（动态测试）**：测试要求，无 ADR 条款禁止；观测走既有 observer seam。裁决 no-conflict。

## 结论

- Verdict 为 **clear**：任务简报 8 条 AC 与 ADR-0001–0010 全集及 CONTEXT.md 无任何直接违反；无 override 声明需求、无需 Jim 裁决的演进项。
- 任务性质是在 ADR-0010（及其收录的 instance-replication-v1 wire 契约）既有框架内补全 Hub 主动 reauth 生命周期——契约语义（GOAWAY 原因码、blocked 恢复条件、1001 收口、reauth/revoke 事件触发关闭）均已明文存在，本任务为兑现缺口而非修订决策。
- 给下游 SA 的红线提醒（非冲突）：blocked/dialing 等连接态不得进入 Runtime/Registry status（ADR-0008 #132 修订 5、ADR-0010 L90）；reauth 不得触碰 META 复制保留字段（ADR-0010「只能由 hub 的显式复制管理操作修改」）；不得引入 durable outbox 等 ADR-0010 非目标能力。
- 信息充分性：ADR 全集与 CONTEXT.md 已全读，任务简报完整；wire 契约相关条款已按 ADR 收录关系核验。无信息不足。

Verdict: clear
