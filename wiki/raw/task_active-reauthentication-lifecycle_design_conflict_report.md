# 冲突门禁报告（设计后复审）— Issue #175 主动 reauthentication 生命周期

## 任务标识

- 任务：Issue #175 — 主动 reauthentication 生命周期（Bug 修复）
- 被审对象：SA1 设计 `wiki/raw/task_active-reauthentication-lifecycle_design.md`（§1–§15 全文，2026-08-30）
- 简报：`wiki/raw/task_active-reauthentication-lifecycle.md`
- Worktree：`/home/wangjian/nomicore-fix-issue-175`（branch `fix/issue-175-on-fix-issue-138-on-docs-phase-5-websocket-`）
- 阶段：设计后冲突复审（SA2 全维度攻击评审前的前置一致性门禁）
- 裁决人：SA8 Conflict Gatekeeper
- 前置基线：前置门禁报告（`_conflict_report.md`，Verdict: clear）——本次不重复全量盘点，聚焦设计新引入决策点

## 检查范围

- 冲突基准：`docs/adr/` 全集 **10 个 ADR（0001–0010），逐个全读，无抽样** + 根目录 `CONTEXT.md` 全读（本工作树本轮全量复核）。
- 辅助核验（不构成独立基准）：`docs/protocols/instance-replication-v1.md` §5/§6.3/§15.1/§15.2/§18 相关条款（L91/L96/L141/L147–149/L435–442/L447/L450/L524）——该文档被 ADR-0010 L151 正文明文收录为唯一 wire contract，按收录关系核验；已实读原文比对设计的引用。
- 被任何 ADR 标记 superseded 的条款（ADR-0007 open/read 编排与 schema-aware read，被 ADR-0008 取代）不计入约束。
- 代码（含 `src/types.ts` 的「SA6 冻结」头部注记）与 wiki 其他文档不作为阻塞依据——按技能边界，只有 ADR/CONTEXT 收录的才是约束。

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0001 | VFSL 文本是 schema 的唯一真相源 | accepted（含 2026-08-19/21 修订） | 否 | 设计零涉及 schema 文本/信封/方言/codegen；无冲突 |
| ADR-0002 | nomicore 全新重写，authority 出范围 | accepted | 否 | 设计零涉及旧 authority 规则；无冲突 |
| ADR-0003 | 求值器与派生 schema | accepted | 否 | 设计零涉及求值/ROOT/联合表示；无冲突 |
| ADR-0004 | vfsl-protocol 类型投影 | accepted | 否 | 设计零涉及类型投影；无冲突 |
| ADR-0005 | 投影生成管线 | accepted | 否 | 设计零涉及生成管线/SchemaSource；无冲突 |
| ADR-0006 | 持久化 DocPersistence 与 docstore | accepted（含 #64/#79/#131/#133 修订） | 否 | 设计零触碰持久化契约（§13 DENY LIST 不含 persistence 面）；无冲突 |
| ADR-0007 | 逻辑校验与 Yjs Runtime Bridge | accepted（open/read 条款被 ADR-0008 取代） | 否 | 残余有效条款（mutation 管线/零写入/observer）与设计无交集；无冲突 |
| ADR-0008 | NamespaceRuntime 读写能力与单序列器 | accepted（含 #93/#132/#134 修订） | 是（边界约束） | 设计 §2/§13：blocked/dialing 留在复制插件层（`PeerConnectionState`），零 Runtime status 扩形、零公共事件订阅新增——符合 #132 修订 5「`replication` 域仅含持久 identity/epoch 两态……不含 session、网络、队列或 sync 状态」与正文「v1 不提供公共事件订阅」；无冲突 |
| ADR-0009 | NamespaceRegistry、租约与 Host 生命周期 | accepted（含 #131/#134 修订） | 是（次序约束） | 设计 §2/§4.6：reauth 收口复用「先关 session（`close()` → quiesce + cleanupAll → channel `onConnectionClosed`）」既有次序；与 `hub.close()` 竞态双序均收敛（cleanupAll 清 reauth deadline）；幂等与既有幂等 close/release 同构；无冲突 |
| ADR-0010 | Hub/Peer WebSocket Y.Doc 复制与最终一致 | accepted（含 #134/#133/#161 修订） | 是（核心） | 设计全部决策点为该 ADR 及其收录 wire 契约的**兑现**（逐条见冲突点表下方说明）；零新帧型、零新错误码、零 outbox、零协议文本修改、零角色切换；无冲突 |

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| — | — | — | — | — | 无冲突项（hard-violation 0 / override-declared 0 / evolution 0） |

无冲突项。设计新引入决策点逐条对照说明（均裁决 no-conflict，供 SA2/总控复核）：

1. **接口扩展 `requestReauth` / `notifyAuthChanged`（§3）vs 无 ADR 冻结插件接口成员清单**：ADR-0010 L174 只规定 `@nomicore/ws-replication` 职责域（含「认证授权」），未冻结 `HubReplication`/`PeerReplication` 成员清单；两项为纯新增（既有成员零变化、零签名变更、零 caller 连锁——§12 审计）。`src/types.ts` 头部「SA6 冻结，逐字段」注记属代码层冻结，且本任务 SA6 冻结契约（简报 §SA6 + `test/driver.ts` 镜像）明文要求该扩展并要求「实现后逐字段一致」。裁决 no-conflict。
2. **定位键 `authenticatedInstanceId`、绝不用 token 值（§4.1）vs ADR-0010 L155/L156/L159**：token 映射 instanceId（L155）、instanceId 文法与受控用途（L156）、token 不入日志/指标（L159）——设计以 accept 期绑定身份为键、close reason 为静态字符串、GOAWAY 帧零凭据字段，为条款的严格执行。未知/畸形身份无副作用 resolve 是查询语义的合法降级（§9 自检），ADR 未要求响亮失败。裁决 no-conflict。
3. **认证级 reauth 收口整条连接（§4）vs ADR-0010 L158「权限撤销关闭对应 channel，不必关闭整条 WS」**：两条款互补——L158 管 namespace 级 authz 撤销（channel 级），L165「framing、认证等连接级错误才关闭整条连接」管认证级；设计不触碰 `revoke` 语义（§2），reauth 是连接级认证事件，与收录协议 L450「已建立连接只有在认证/授权 Adapter主动发 reauth/revoke事件时关闭」逐字对应。裁决 no-conflict。
4. **GOAWAY(REAUTH_REQUIRED, drain>0) + 发送方 deadline 后 `close(1001)`（§4.2/§4.3）vs ADR-0010 L147/L151 + 协议 §6.3 L148–149**：「GOAWAY提供相对drain timeout」（L147）、「之后发送方以 WS 1001 关闭」（L149）——设计即该发送方义务的字面实现；drain 预算复用 `closeTimeoutMs` 属实现选择，ADR L165 只要求上限为插件配置并提供安全默认值，未禁止复用既有 knob。裁决 no-conflict。
5. **receiver 侧本地 elapsed deadline（§6）vs 协议 §6.3 L141（经 ADR-0010 收录）+ #161 修订**：「接收时开始计算本地 elapsed deadline」（L141）——`armBlockedDeadline` 即接收方义务；满期本端 `close(1001)` 是发送方死亡/注入形态下的 wire 不无限开放保证（AC4）；武装在 `enterBlocked` 同步收口之后，与 #161「GOAWAY/blocked/连接收口同步静默订阅先于异步 drain」次序一致。裁决 no-conflict。
6. **`drainTimeoutMs === 0` 不武装（§6.3，load-bearing 决策）vs 协议 §6.3**：协议未定义 0 值的接收方行为（varUint 合法值；L148「现有 namespace 到 deadline 前自然收口」在 0 预算下无收口窗），设计的「0 = 无 drain 预算信息 → 保持既有 wire 冻结语义」由既有冻结绿测试 D5-B1 钉死，且生产 Hub 两条 GOAWAY 生产路径恒发 >0（构造期验证）。非协议明文违反，属条款留白处的实现锚定——**登记为 note，建议 SA2 复核该解读**（SA8 不判断设计优劣）。裁决 no-conflict。
7. **handshaking 连接直接 `close(1001)`、不发 GOAWAY（§4.2）vs 协议 §6.3/§15.2**：协议未强制 hub 主动关闭前必发 GOAWAY；FSM `handshaking → closed` 经既有 `shutdownWithGoaway` handshaking 分支同款先例；规避 GOAWAY-before-ACK 的 peer fatal 误判。裁决 no-conflict。
8. **恢复编排复用 `requestRebuild`、仅 blocked 态有效（§5）vs 协议 §15.1 L439/L450 + ADR-0010 L143**：blocked 等待 token/config 变化（L439）、token 轮换只影响新 Upgrade（L450）、关闭后重开必须重建连接（L143）——rebuild 编排（关旧 wire → 新代际拨号）即三条的既有兑现；非 blocked 态 no-op 为「无待恢复事实」的合法降级。裁决 no-conflict。
9. **生命周期控制帧直发豁免（§4.5）vs ADR-0010 L151「control/ACK保留额度」**：直发仍走序列分配与 onEmitted 记账，与既有 `shutdownWithGoaway`/`connectionFatal` 同族——控制帧不被 data 背压否决正是保留额度纪律的目的侧。裁决 no-conflict。
10. **零 Runtime/Registry 扩形、零新帧型/错误码、非目标恪守（§2/§13）vs ADR-0008 L95/#132.5、ADR-0010 L90/L151/L203–214、CONTEXT.md 实例角色**：不引入 durable outbox、Runtime 公共事件订阅、新配置 knob、协议文本修改、角色切换；`REAUTH_REQUIRED` 为协议 §15.1 既有 reasonCode、GOAWAY 0x03 为既有帧型（L91 消息码 append-only 未被触碰）。裁决 no-conflict。
11. **§10 红灯套件两处锚点缺陷申报（IT4 L341/L358、IT6 L438）**：设计主张两条断言在任何满足 IT1/IT3/AC4 的设计下不可满足，建议 SA6 修正并显式上报总控，SA1/SA3 不触碰测试文件（§13）。红灯测试属任务资产而非 ADR/CONTEXT 约束——**不构成冲突项**；登记为 note 交总控裁决流转（设计未静默绕过，姿势合规）。

## 结论

- **Verdict 为 clear**：SA1 设计与 ADR-0001–0010 全集及 CONTEXT.md 无任何直接违反；无 override 声明需求（0）、无需 Jim 裁决的演进项（0）、无 hard-violation（0）。
- 设计性质与前置门禁判定一致：在 ADR-0010（及其收录的 instance-replication-v1 wire 契约）既有框架内补全 Hub 主动 reauth 生命周期——所有新增决策点（seam 形态、身份键、drain 预算、双端 deadline、恢复编排）均为既有条款的实现锚定，未修订、未推翻任何 ADR 决策。
- 信息充分性：ADR 全集与 CONTEXT.md 已全量重读；设计引用的协议条款（L91/L141/L147–149/L435–442/L447/L450/L524）已实读原文比对，引用准确；无信息不足。
- 登记给下游的非冲突 note（不阻塞，超出 SA8 职权的留给对应角色）：
  1. §6.3「drain=0 不武装」与 §6.1「两 reasonCode 均武装」的协议留白解读 → 建议 SA2 复核（设计已自登记 REAUTH-only 收窄 fallback）。
  2. §10 两处红灯锚点缺陷的 SA6 修正建议 → 总控裁决流转；若裁决「测试不可改」，设计已声明唯一替代路径均违反更高层契约（IT3/AC4/SA5#3），届时需回到总控重新调度而非由 SA3 变通。
  3. 红线复述（沿前置门禁）：blocked/dialing 不入 Runtime/Registry status；reauth 不触碰 META 复制保留字段；不引入 durable outbox；token 零暴露面（日志/错误/observer/wire）。

Verdict: clear
