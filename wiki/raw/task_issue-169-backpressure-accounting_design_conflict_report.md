# 冲突门禁报告 — 设计后复审（SA1 设计产物）

- 被审对象：`wiki/raw/task_issue-169-backpressure-accounting_design.md`（SA1 设计，issue #169 连接级背压记账/控制保留额度/poll 公式；631 行）
- 任务简报：`wiki/raw/task_issue-169-backpressure-accounting.md`（前置门禁已裁决 verdict=clear、0 冲突）
- 阶段：设计后复审（SA1 设计 vs ADR 全集 + CONTEXT.md）
- 冲突基准：`docs/adr/` 全部 10 个 ADR（全读，无抽样）+ `CONTEXT.md`。`docs/protocols/instance-replication-v1.md` §13.1/§14/§17/§18 仅经 ADR-0010 L151/L296「唯一 wire contract」明文收录的域（backpressure / 错误码 / close code / timeout）构成约束；代码与 wiki 其余文档不构成自动阻塞依据。
- 复审方法：逐条提取设计决策（§0–§17 + 附录 A/B）对照 ADR-0010 正文与 #161-r2 修订节、收录协议 §17/§13.1/§14/§18、ADR-0008 负向条款、CONTEXT.md 术语；对设计引用的现状锚点（backpressure.ts/update-channel.ts/frame-io.ts/validate.ts）做了源码核证，证实设计的六处偏差描述与现状逐点属实。

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0001 | VFSL 单一真相源 | accepted（含两修订节） | 否 | 设计不触碰 schema/信封/投影域 → no-conflict |
| ADR-0002 | 重写定位 / authority 出范围 | accepted | 否 | 无接触点 → no-conflict |
| ADR-0003 | 求值器与派生 schema | accepted | 否 | 无接触点 → no-conflict |
| ADR-0004 | vfsl-protocol 类型投影 | accepted | 否 | 无接触点 → no-conflict |
| ADR-0005 | 投影生成管线 | accepted | 否 | 无接触点 → no-conflict |
| ADR-0006 | 持久化插件 | accepted（含 #64/#79/#131 对齐/#133-r2 修订节） | 否 | 设计 ALLOW LIST 仅 ws-replication 六文件，不动持久层 → no-conflict |
| ADR-0007 | 逻辑验证与 Runtime Bridge | accepted（Runtime/open/read 条款被 ADR-0008 取代） | 否 | 被 superseded 条款不构成约束；其余与传输层背压无接触 → no-conflict |
| ADR-0008 | NamespaceRuntime 读写能力与单序列器 | accepted（含 #93/#132/#134 修订节） | 是（负向） | ADR-0010 L151「网络背压不得进入Runtime sequencer」所指即本文唯一 FIFO；设计 I-6「零 import/零 await/零回调 Runtime/Lease/Registry」+ §13.9 重申 → no-conflict |
| ADR-0009 | Registry、租约与 Host 生命周期 | accepted（含 #131/#134 修订节） | 弱 | 设计不改 Registry/Lease 公共面；needs-resync 后恢复走既有 transport reset/bootstrap → no-conflict |
| ADR-0010 | Hub/Peer WebSocket Y.Doc 复制 | accepted（含 #134/#133-r2/**#161-r2** 修订节） | 是（直接） | 设计即 #161-r2 八项背压终态口径 + 收录协议 §17 的实现纠偏，逐点一致（见下对照表）→ no-conflict |

## 冲突点

无。逐条对照未发现设计直接违反任何 accepted ADR 条款或 CONTEXT.md 惯例：

| 裁决 | 数量 |
|---|---|
| hard-violation | 0 |
| evolution | 0 |
| override-declared | 0 |
| no-conflict | 10/10 ADR（直接相关 1、负向相关 1、弱相关 1、无关联 7） |

### 设计决策 ↔ 基准条款对照（复核用）

| # | 设计决策（章节） | 基准条款（ADR-0010 / 收录协议） | 裁决 | 依据 |
|---|---|---|---|---|
| 1 | 统一连接台账 `totalPressure = lastObservedBuffered + pendingDataHandoff + controlUnflushed + Σqueued`（§3.4）驱动 admission+shed+恢复（I-2） | 协议 §17「总队列记账 = 每 namespace 排队字节 + socket `bufferedAmount`（连接级 pipeline）」+ 简报 Scope 2「must not leave an accounting gap」 | no-conflict | P2（pending handoff）/未冲刷控制台账是对 `bufferedAmount` 异步观察缝隙的保守补账（前置门禁对照 #1 已裁定「实现级落实，非口径变更」）；误差方向恒为高估（I-4），不构成口径变更 |
| 2 | shed 只作用排队侧、恢复目标 `queued ≤ lowWater`（不止步于 cap）、victim 最大排队优先（§6） | 协议 §17「溢出触发时按最大排队 namespace 整队丢弃至 queued 侧 ≤ low-water——shed 只作用于排队侧（socket 缓冲不可撤回，由水位暂停与 1011 承接）」 | no-conflict | 逐字一致；触发严格 `>`、恰好 cap 不触发（I-3）与 AC-5 边界语义一致 |
| 3 | 严格接纳：admission `projected ≤ cap`、单帧守卫保持、入队路径越限 → 拒纳 + 同批整队丢弃 + needs-resync 显影（§5/§6） | 协议 §17「**严格接纳**：shed 后（或空队列时）接纳 incoming 仍会越限则拒纳该帧并同批丢弃该 namespace 幸存排队帧，以 needs-resync 声明显影（不静默吞、不静默纳）」 | no-conflict | 可观测契约逐点满足（帧不上 wire + ns 队列清空 + 声明显影）；直发路径消费既有 PR #165 接线（设计 A9，源码核证属实） |
| 4 | 控制保留额度 = 暂停窗口内未冲刷控制字节台账，冲刷（deltaDown）即释放（§4.2/§3.3） | 协议 §17「额度按 socket 缓冲内未冲刷控制字节计，耗尽为 `CONNECTION_BACKPRESSURE`（close 1011）」 | no-conflict | 口径由「暂停段累计已发」改为「未冲刷」正是协议字面；首过限帧不上 wire + 恰一次收口（§4.3）与 §13.1/§14 一致 |
| 5 | 字段迁移 `controlReserveBytes`→`maxQueuedControlBytes`，缺省 8 MiB，启动期约束 ≥ `maxBootstrapBytes`+128，无兼容层（§4.1/§8/§14.5） | #161-r2「控制独立保留额度 maxQueuedControlBytes 缺省 8MiB」+ 协议 §17 同款 + 验证块 `maxQueuedControlBytes >= maxBootstrapBytes + protocol overhead` | no-conflict | `controlReserveBytes`/`BACKPRESSURE_POLL_INTERVAL_MS` 未见于任何 ADR/CONTEXT/协议条款（grep 证实）——删除无约束；`max(1,·)` 下界在权威公式内，非运行时 clamp（§17「不得运行时 clamp」不违反） |
| 6 | poll 间隔 = `max(1, floor(ackTimeoutMs/100))`，经注入 `ReplicationTimer`（§7） | #161-r2「checkpoint = max(1, floor(ackTimeoutMs/100))」+ 协议 §17「水位检查点间隔 = `max(1, floor(ackTimeoutMs / 100))`」+「使用 Cordis Timer调度检查，不使用原生 timer」 | no-conflict | 公式逐字一致；`host.timer.setTimeout` 保持注入 timer 纪律（设计 A5） |
| 7 | 数据侧超限零 1011（G1/G4/G5），仅控制额度耗尽 1011 整连（§4.3/§10） | ADR-0010 L165「普通超限以稳定错误关闭单个 channel；framing、认证等连接级错误才关闭整条连接」 vs #161-r2「1011 终止」+ §13.1/§14/§17 | no-conflict | 采用前置门禁注记 1 已登记的「后订且具体的条款优先」读法：数据走 per-ns shedding + needs-resync，仅控制耗尽 1011——设计两种行为分界与此逐点一致 |
| 8 | 不引入第二个 data 调度器；OutboundQueue/UpdateChannel/round-engine/namespace 层零改动（I-5/§10/§15 DENY LIST） | 协议 §17「Connection使用 per-namespace队列和 round-robin：control/error/ACK高优先级，data每轮每 namespace最多一个」+ 有界整轮扫描条款 | no-conflict | 单数据面与公平调度条款相容；fairness/control-priority/no-starvation 锚全部保持（§12.3） |
| 9 | 网络背压零接触 Runtime sequencer（I-6/§13.9） | ADR-0010 L151「网络背压不得进入Runtime sequencer」+ 协议 §17 同款 + ADR-0008 唯一 FIFO 定义 | no-conflict | 零新增 import（源码级承诺）；CONTEXT「写序列器」词条不受触碰 |
| 10 | needs-resync 显影沿既有 facet/声明拓扑（discardForConnectionPressure → declareHubResync/declareLocalResync）（§6/§10） | #161-r2「严格接纳 + onDataShed 显影」+ 协议 §17「以 needs-resync 声明显影」+ ADR-0010 L167 观测面「backpressure resync」 | no-conflict | 协议要求的是可观测 needs-resync 声明而非特定钩子名；既有 observer seam/声明拓扑零改动 |
| 11 | 「pending handoff 计入双口径」的实现落点 = pendingDataHandoff 同时计入 admission（§5 projected）与 shed 触发（§6）两个判据口径；per-ns 未发送队列判据（R2-3：in-flight 窗口独立限制）零改动 | #161-r2「pending handoff 计入 per-ns 溢出双口径」 | no-conflict | 设计对连接级两判据口径均计入且每帧恰计一次（I-1）；DENY LIST 不移除任何已登记的 per-ns 记账——无论该压缩短语作何种读法，设计均不与其矛盾 |
| 12 | 缺面 dormant：bufferedAmount 缺面 → 永不暂停 → 控制判据不生效、data 总量仍受准入收口（§13.10/§14.4） | 协议 §17「缺面视为 0——背压水位退化为不可观察，数据总量仍受准入与 1011 收口」 | no-conflict | P2 台账使 data 总量受准入收口（协议字面）；控制侧不因能力缺失假杀，与「装配期响亮断言（issue #164）、非运行时降级」精神一致 |
| 13 | CONTEXT.md 术语使用（hub/peer、needs-resync、write sequencer、ReplicationSession） | CONTEXT.md 各词条及 _Avoid_ 清单 | no-conflict | 设计用词无违例；channel 级 needsResync 属 ws-replication transport 域，与 session 级 sticky 标记语义正交、未混用 |

### 判断点登记（非冲突，供 SA2 攻击评审；设计自身已标注）

以下三点是设计在协议文本未显式规定处的**解释性选择**，逐条核验均不构成对任何 accepted 条款的直接违反，亦无修订既有决策的意图（非 evolution），登记如下供 SA2 全维度评审：

1. **§4.4 读法 B（控制额度判据仅暂停窗口生效）**：协议 §17 只定义额度口径（「按 socket 缓冲内未冲刷控制字节计」），未显式限定检查窗口。设计选 B（窗口判据）而非 A（无条件判据），理由链完整（缺面 dormant 语义、D3c 锚依赖、残余暴露落入「socket 缓冲不可撤回，由水位暂停与 1011 承接」兜底域，§14.2）。判据形状（首越界帧 + 恰一次）与 §13.1/§14 逐字一致。属解释选择，非冲突。
2. **已吸收未冲刷控制字节在 totalPressure 中的保守双计**（§3.2/§3.3）：controlUnflushed 仅 deltaDown 释放，而吸收（deltaUp）后这些字节已进入 lastObservedBuffered——两次观察之间既吸收又冲刷的窗口内存在高估。方向恒为保守（I-4 允许），协议 §17 台账组成是下限口径而非上限；属实现取舍，非冲突。
3. **deltaDown 释放控制额度不区分被冲刷字节归属**（data 冲刷也可释放 control 额度）：socket 不提供按帧归属的冲刷观测，min-clamped 近似为唯一可实现判据；G3b 锚（「冲刷即释放」）即此语义。属实现近似，非冲突。

## 结论

**Verdict = `clear`，冲突点 0，裁决分布：no-conflict ×10（hard-violation 0 / evolution 0 / override-declared 0）。放行进入 SA2 攻击评审，无停止原因、无需 override、无需 Jim 裁决条目。**

- 设计与前置门禁裁决（clear）一致：其全部决策是 ADR-0010「issue #161 round 2 修订节」八项背压终态口径 + 收录协议 §13.1/§14/§17/§18 的**实现纠偏**，设计 §0 自称「不修订、不推翻任何既有决策」经逐点核验属实；DENY LIST 明确排除 `docs/adr/**` 与协议文档的修改。
- 设计对现状（六处结构偏差）的描述经源码核证逐点属实（backpressure.ts 1000ms 常量/controlReserveUsed 累计口径/admission 漏 P2/shed 停在 cap/旧字段仅正整数校验/两套账本割裂）——修复方向与权威口径的映射无编造。
- 三处解释性判断点（上节）不构成冲突，但属 SA2 评审应重点攻击的面；建议 SA2 优先复核 §4.4 读法 B 的残余暴露面论证与 §11 #6（D3b 断言反转）/§11 #10（真实 TCP 用例 B）两处测试迁移的语义等价性（测试迁移属 SA6 职责、非 ADR 约束项，本门禁不裁决）。
- 相关决议文档已按技能要求追加「设计后复审追加」节（11 条设计引入决策点摘录），供 SA2/SA3/SA4/SA6/SA7 复用。
