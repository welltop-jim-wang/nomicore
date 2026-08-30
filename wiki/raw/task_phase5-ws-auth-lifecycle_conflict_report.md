# 冲突门禁报告

- 被审对象：`wiki/raw/task_phase5-ws-auth-lifecycle.md`（issue #138，任务类型：功能开发；Phase 5：authenticate instances and run connection lifecycle——实例认证与连接生命周期；含 AC-1–AC-7）
- 冲突基准：ADR 全集 `docs/adr/0001`–`0010`（10 个，全量逐个读取，无抽样）+ `CONTEXT.md` + 任务指定的 Phase 5 规格基准（`docs/phases/phase-5-websocket-replication.md` 切片 7、`docs/protocols/instance-replication-v1.md`——后者为 ADR 0010 L151 指定的唯一 wire contract，具 ADR 级约束力）
- 审查日期：2026-08-29（run_id: issue-138-1787994136-4073122, round 1）
- 依赖核实：#136（`6f2676f`，单 namespace 同步域）与 #137（`08da15b`，multiplex/背压连接域）确在分支 `fix/issue-138-on-docs-phase-5-websocket-replication` 历史中，简报 Dependencies 陈述属实。

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| 0001 | VFSL 文本是 schema 的唯一真相源 | accepted（含 2026-08-19/08-21 修订节） | 否 | 任务不新建 schema/投影/脚手架；SCHEMA/ROOT 仅作为日志脱敏对象（AC-7）与授权分级对象被整体引用，不解释其内容。无冲突 |
| 0002 | nomicore 是全新 yjs-server 重写，authority 出范围 | accepted | 否 | 任务不引入任何 authority 规则体系；「authorization」指连接/namespace 访问授权 Adapter（ADR 0010 L37/L157 域），与 `__authority__` manifest 无关，未混用。无冲突 |
| 0003 | 求值器与派生 schema | accepted | 否 | 求值器/ROOT 别名约定不触及。无冲突 |
| 0004 | vfsl-protocol 类型投影 | accepted | 否 | 类型投影/编译期护栏不触及。无冲突 |
| 0005 | 投影生成管线 | accepted | 否 | 无 SchemaSource 消费、无生成物、无新 domain 包。无冲突 |
| 0006 | Cordis 持久化插件 | accepted（含 #64/#79 修订节、#131 对齐说明、#133 修订节） | 否（弱） | 任务不改 Persistence 契约；degraded 分级（协议 §20 转述）仅为错误分级背景。无冲突 |
| 0007 | 逻辑验证与 Yjs Runtime Bridge | accepted（Runtime/open/read 条款由 0008 部分取代） | 否（弱） | raw update 受控通道已由 ADR 0010 裁决为 ReplicationSession；本任务认证/生命周期层不触及 apply 语义。被取代条款不构成约束。无冲突 |
| 0008 | NamespaceRuntime 读写能力与单序列器 | accepted（含 #93、#132 修订节） | 是 | AC-6「drains accepted apply work」= 已接纳 apply 槽无条件排空 + close barrier 不取消已接纳任务（L93 同款纪律，连接层 drain 经 #136 已交付编排兑现）；AC-5 连接状态机归属 ws-replication 插件域，#132 status 边界（replication 域不含 session/网络/队列状态）禁止把连接状态塞进 Runtime status——简报未违反。无冲突 |
| 0009 | NamespaceRegistry、租约与 Host 生命周期 | accepted（含 #131、#134 修订节） | 是 | AC-5「injected scheduler/random seams」与本 ADR「不各自实现或 fallback 到系统 timer」+ #131「randomBytes 注入、不得回退全局随机源」生态纪律一致（协议 §15.1 L431 对 backoff 显式同款要求）；AC-6 drain 的下游动作（release 不追踪/取消已接纳 apply 槽）与 #134 修订节一致；AC-7 与 L95 脱敏模型一致。无冲突 |
| 0010 | Hub/Peer WebSocket Y.Doc 复制与最终一致 | accepted（含 #134 round-2、#133 round-2 修订节） | 是（权威 ADR） | 任务全部 AC 逐条溯源见下；认证/授权/生命周期条款（L19、L37、L143–L147、L151、L155–L159、L165、L167、L174、L179）逐字吻合；范围边界（拓扑、非目标、包归属）未越界。无冲突 |

Phase 5 规格基准对照：

| 文档 | 对照结论 |
|---|---|
| docs/phases/phase-5-websocket-replication.md | 任务自认切片 7 条目（L112–119：Bearer upgrade 认证、instanceId 验证、hub/peer 双向身份约束、namespace 级 read/submit 授权、撤销只关 channel、结构化错误、日志脱敏、TLS 边界）；AC-5 对应 L146–151 连接状态机验收；AC-7 对应场景 12/16 与测试 seam「认证撤销、shutdown race」；非目标同源。无冲突 |
| docs/protocols/instance-replication-v1.md | AC-1 = §2（Upgrade 前验证、401/403 不建 WS、可信 Peer instanceId）；AC-2 = §2 L38 + 不变量 5 + §6.1/§6.2（六字段 HELLO / 五字段 HELLO_ACK、nonce 原样返回）；AC-3 = §13（scope/registry 派生、不可覆盖）+ §14（close code 表）+ §18（timeout 分级）；AC-4 = §19（深 Module、denied/allowed{localOwner, read, submit}、可选 revoke 事件）+ §7.1 L162（先 authorization 再 open）；AC-5 = §15.1（full jitter 公式、blocked、backoffResetAfterMs、GOAWAY 原因分级、注入 seam）+ §6.3（retryAfterMs hint）；AC-6 = §6.3 L147（GOAWAY 停 OPEN）+ §21（六步停机、不无限等 ACK）+ §16 L475；AC-7 = §13.2 L380 + §22。逐条吻合，无冲突 |

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| （无） | — | — | — | — | 未发现任何直接违反 ADR/CONTEXT/规格基准的要求；亦无未声明推翻（无 override 需求）与未走正式 supersede 的实质演进 |

### 逐条溯源（佐证上表「无冲突」结论）

| 被审对象条目 | 基准条款（溯源） |
|---|---|
| AC-1 Bearer 认证与 Peer 实例解析先于 Upgrade；无效凭据绝不分配协议连接 | ADR 0010 L147「Bearer token在HTTP Upgrade前认证」+ L155「WebSocket upgrade 使用 bearer token 认证实例身份；token 映射到安全文法约束的 `instanceId` 与 namespace 权限」+ L156（instanceId 文法）；协议 §2 L36「失败返回 HTTP 401/403，不建立 WebSocket。成功认证至少产生可信 Peer instanceId 和其可用授权上下文」；L165「framing、认证等连接级错误才关闭整条连接」；phase-5 L116 |
| AC-2 HELLO/HELLO_ACK 绑定已认证 Peer 身份、期望 Hub 身份、协议版本、capabilities 与 nonce；namespace 仅在其后 open | ADR 0010 L145「HELLO显式协商完整protocol version与capabilities；不得按消息数值猜版本」+ L147「Upgrade后Peer发送HELLO，Hub回复HELLO_ACK并绑定Peer/Hub instance identity」+ L157「peer 验证配置的 hub 身份」+ L143（Namespace 依次 OPEN）；协议 §2 L38「Upgrade 身份、HELLO Peer instanceId 和配置的 Hub instanceId 必须一致」、不变量 5「HELLO_ACK 前不得发送 namespace frame」、§6.1/§6.2（peerInstanceId=Upgrade 身份、connectionNonce 16 bytes 原样返回、hubInstanceId=Peer 配置期望值） |
| AC-3 连接 sequence、ACK 关联、frame/心跳 timeout、ERROR scope、WS close-code 映射遵循 v1 contract | ADR 0010 L147「每方向sequence从1严格递增，不回绕；gap、repeat或错误ACK关联关闭连接。WS ping/pong负责活性」+ L151「连接与namespace状态、消息码、payload字段、错误码、timeout、close code……以`docs/protocols/instance-replication-v1.md`为唯一wire contract」——简报「follow the v1 contract」正是该委托的字面执行；协议 §13（scope 由 code registry 派生、调用方不能覆盖）、§13.1/13.2、§14、§18（「HELLO/pong timeout关闭连接。Open/…/ACK timeout只收口 namespace」）、§2 L40「活性检测只使用 WebSocket ping/pong」 |
| AC-4 Hub 授权是深 Adapter，返回 denied 或 local owner + read/submit 权限；可选 revoke/reauth 只关闭所需 scope | ADR 0010 L37「authorization Adapter按已认证 instance identity + namespaceId返回 denied，或返回 Hub local owner与 read/submit权限；Peer不得声明 Hub owner」+ L157 + L158「权限撤销关闭对应 channel，不必关闭整条 WS；授权结果不跨连接生命周期缓存」；协议 §19「Hub authorization Adapter是深 Module……」「授权只在 OPEN时检查；Adapter可选提供结构化 revoke事件，触发 namespace终止 ERROR和cleanup」+ §15.2 L448「已建立连接只有在认证/授权 Adapter主动发 reauth/revoke事件时关闭」（「deep Adapter」= §19「深 Module」术语）；phase-5 L117「撤销只关闭对应 channel」 |
| AC-5 Peer 连接状态机提供 full-jitter backoff、永久失败 blocking、稳定 ready 重置、Hub GOAWAY 原因/重试 hint，经注入 scheduler/random seam | ADR 0010 L19「peer 只主动连接一个 hub；hub 不反向拨号」+ L147（GOAWAY 相对 drain timeout）+ L151（连接状态/backpressure 委托 wire contract）；协议 §15.1（full jitter 公式 `cap = min(maxBackoffMs, baseBackoffMs * 2^attempt); delay = random(0, cap)`；「只有 ready 稳定超过 `backoffResetAfterMs` 才清零 attempt。Scheduler和random必须注入测试 seam」；GOAWAY 原因分级含 retryAfterMs）+ §6.3（`retryAfterMs` optional「hint，不构成保证」）；ADR 0009 注入式 Clock/Timer/randomBytes 生态纪律同向；phase-5 L115/L151「认证、版本、身份或policy永久错误进入blocked」 |
| AC-6 GOAWAY 停止新 open、排空已接纳 apply 且不无限等待网络 ACK、按规定顺序关闭 | 协议 §6.3 L147「收到 GOAWAY 后停止 OPEN，不开始新 sync round；现有 namespace 到 deadline 前自然收口」+ §16 L475「已被 Runtime sequencer接纳的 apply必须结算……绝不在 sequencer槽内 await」+ §21「Drain不无限等待网络ACK」六步停机；ADR 0010 L179「停止顺序为：复制插件停止接纳连接/target，关闭 channels，等待已被 Runtime 接纳的 apply 槽完成但不无限等待网络 ACK，释放 replication leases，随后 Registry shutdown、Persistence dispose，最后停止 Timer/Clock」——AC-6 为该条原文的行为化；ADR 0008 L93 / ADR 0009 #134 修订节（已接纳任务无条件排空、release 不取消）同向 |
| AC-7 日志与 observer 事件绝不暴露 token、owner 值、Yjs 字节、SCHEMA/ROOT、cause、失控高基数标签 | ADR 0010 L159「Token、Yjs update、SCHEMA/ROOT 内容以及未经控制的 owner/namespace 不得出现在默认日志或高基数指标标签中」+ L167（observer seam 最小观测面）+ L156（instanceId 用于受控日志/指标）；协议 §13.2 L380「Wire永不携带 owner、token、SCHEMA、ROOT、update、stack、原始 cause或异常 message」+ §22「secret-free logs和受控metrics标签」；phase-5 L118/L126、场景 12。排除清单 = ADR L159 ∪ 协议 wire 禁携清单，未收紧到违反任何条款（范围注记 1 见结论） |
| 依赖与范围陈述（#136/#137 输出在分支历史 `6f2676f`/`08da15b`） | `git log` 实证两提交均在分支；任务范围限定于认证/授权/连接生命周期，不实现生产 composition root（切片 9）、不新增第二种 transport（ADR 0010 L177）、不触碰 Persistence/Registry 契约——与切片划分相容 |

## 结论

**Verdict: `clear` —— 放行。**

- 冲突点数：0；裁决分布：no-conflict 10/10（ADR 层面），override-declared 0，evolution 0，hard-violation 0。无需 override、无需 Jim 裁决条目、无需停止运行。
- 任务简报不是新决策提案，而是 ADR 0010（L19/L37/L143–L147/L151/L155–L159/L165/L167/L179）+ 协议 v1（§2、§6、§13、§14、§15、§16、§18、§19、§21）+ Phase 5 切片 7 的忠实实施切片；全部 AC 可逐条溯源到已接受条款（溯源表见上）。
- 五条非冲突范围注记（供总控/SA1/SA2 参考，不构成门禁约束）：
  1. **AC-7「causes」只约束暴露面，不删除内部保留义务**：协议 §13.2 L380 明文「内部 observer/trace保留 committed与exact cause，但协议只输出安全稳定字段」，§20 L553 与 ADR 0008 branded fatal（`cause` 字段）同款。SA1 必须区分「内部保留（committed/exact cause 事实面）」与「对外暴露（默认日志、observer 事件载荷、wire）」——AC-7 的排除清单治理后者；不得把 AC-7 读成剥离内部 committed/cause 记账（那将与 §13.2/§20 保留条款及 ADR 0008 fatal 契约相抵触）。instanceId/connectionId/namespaceId 是受控观测身份（ADR 0010 L156、§6.2），不在 AC-7 排除清单内，不得一并脱敏到不可观测。
  2. **revoke/reauth 的两级 scope 分裂**：「closes only the required scope」必须按委托契约两级落地——authz 层 revoke 事件 → 只关对应 namespace channel（ADR 0010 L158、协议 §19「触发 namespace终止 ERROR和cleanup」）；auth 层 reauth 事件 → 关闭整条已建立连接（§15.2 L448）。同时受 L158「授权结果不跨连接生命周期缓存」与 §19「授权只在 OPEN时检查」约束：无事件 Adapter 的新授权在下一连接生效，不做 per-frame 重查。
  3. **backoff/blocked 状态机是 Peer 专属**：AC-5 明文「Peer connection state」。Hub 入站连接只走 `upgraded → handshaking → ready → draining → closed` 线性链，「Hub 不包含 dial/backoff」（§15.2；ADR 0010 L19「hub 不反向拨号」；phase-5 L151）。SA1 不得为 Hub 侧补造重连/backoff 逻辑。
  4. **认证失败不得泄露 namespace 存在性**：§7.1 L162「未授权不得泄露 namespace 是否存在；只有已获访问权的 Peer才可收到 `NAMESPACE_NOT_FOUND` 或 `REPLICATION_NOT_ENABLED`」——401/403（Upgrade 前）与授权拒绝（OPEN 时）的错误面必须按此分层；AC-4 的 Adapter 返回 denied 时不携带存在性信息。
  5. **`retryAfterMs` 是 hint 不是承诺**：协议 §6.3 明文「hint，不构成保证」。AC-5「retry hints」措辞与之一致；SA1 设计不得把它实现为对端可依赖的时序承诺（重连调度仍由本地 full-jitter backoff 决定，GOAWAY 原因只调整 blocked/backoff 分级）。
- 相关决议清单（全链复用）：`wiki/raw/task_phase5-ws-auth-lifecycle_relevant_decisions.md`
