# 冲突门禁报告（设计后复审）— issue #137 SA1 设计

- 被审对象：`wiki/raw/task_phase5-ws-multiplex-backpressure_design.md`（SA1 产出，573 行）
- 冲突基准：`wiki/raw/task_phase5-ws-multiplex-backpressure_relevant_decisions.md`（前置门禁摘录）+ ADR 全集 `docs/adr/0001`–`0010`（前置门禁已全量盘点，本次按相关 ADR 复核）+ `CONTEXT.md` + `docs/protocols/instance-replication-v1.md`（ADR 0010 L151 指定唯一 wire contract）+ `docs/phases/phase-5-websocket-replication.md`
- 审查日期：2026-08-28（run_id: issue-137-1787922674-8367, round 1，设计后复审）
- 复审性质：设计与 ADR 决策/规格基准一致性 + 前置门禁三条非冲突注记落实复核；设计优劣属 SA2，不在此裁

## Verdict

`clear`

## ADR 盘点（设计后复审——相关度复核，全量盘点见前置门禁报告）

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| 0001–0005 | VFSL 真相源 / authority 出范围 / 求值器 / 类型投影 / 投影管线 | accepted | 否 | 设计零触及（SCHEMA 仅作为既有受保护域背景；DENY LIST 排除 replication-protocol 包改动）。无冲突 |
| 0006 | Cordis 持久化插件 | accepted（含 #64/#79/#131/#133 修订节） | 否（弱） | 设计不改 Persistence；AC-3 本地状态保留落在 Y.Doc/sequencer 域。无冲突 |
| 0007 | 逻辑验证与 Yjs Runtime Bridge | accepted（部分被 0008 取代） | 否（弱） | 背压丢弃只影响未发送 wire 增量，不触 apply 语义；被取代条款不构成约束。无冲突 |
| 0008 | NamespaceRuntime 读写能力与单序列器 | accepted（含 #93、#132 修订节） | 是 | 设计 §7「paused/保留额度/wheel 不投影、不上 wire、不入 Runtime status」逐字落在 #132 边界（「不含 session、网络、队列或 sync 状态」）；§11.2 以依赖方向结构保证「不进 Runtime sequencer」（= L151/L113 义务）；§4.5 公平轮转以「不同 namespace 可并行」为结构前提。无冲突 |
| 0009 | NamespaceRegistry、租约与 Host 生命周期 | accepted（含 #131、#134 修订节） | 是 | poll timer 经注入 `ReplicationTimer`（与既有 timer 同一注入面）、零 native timer——符合「不各自实现或 fallback 到系统 timer」；§8 teardown 不 await Runtime/Lease/Registry。无冲突 |
| 0010 | Hub/Peer WebSocket Y.Doc 复制与最终一致 | accepted（含 #134 round-2、#133 round-2 修订节） | 是（权威） | 设计四件新域（RR/总压 shed/水位闸门/未发送合并）逐条溯源到 L151/L165/L177 与协议 §10.1/§13.1/§14/§17；两级队列属主边界与 #134 round-2 修订节（L267）逐项一致；无 wire 新增（消息注册表 append-only 纪律保持）；非目标（durable outbox、第二种 transport）零触碰。无冲突 |

Phase 5 规格基准：切片 6 背压/调度条目（L110）、切片 7 multiplex 条目（L114）、场景 10/11/13/16、测试 seam、非目标清单——设计与任务简报同源同界。无冲突。

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| （无） | — | — | — | — | 未发现任何直接违反 ADR/CONTEXT/协议/Phase 5 规格的设计决策；无未声明推翻（override 需求为零）；无未走正式 supersede 的实质演进 |

裁决分布：no-conflict（逐条溯源 24 项 + 注记复核 3 项，见下），override-declared 0，evolution 0，hard-violation 0。

## 逐条溯源（设计决策 → 已接受条款）

| 设计条目 | 设计决策 | 基准条款（溯源） | 对照结论 |
|---|---|---|---|
| §0 范围四件事 + R0-1 | 只改「帧怎么出队」，零新状态机状态、不改 OPEN/bootstrap/round/close 迁移 | ADR 0010 L143/L151（连接级条款域）；phase-5 切片 6 | 一致：新域全部落在连接级发送调度，不触及已交付状态机 |
| §0 R0-2 + §3.2 | 两级队列两属主两溢出语义对账表 + 互不代管 | ADR 0010 #134 round-2 修订节（L267：投递队列容量 16 冻结、溢出弃新保旧、`status.needsResync` sticky 属切片 3；「WS 发送队列/连接级背压（正文 L151 域）」属切片 6） | 一致（详见注记 ① 复核） |
| §4.1 control 恒先 | control 帧不被水位闸门阻塞，入队即排空 | 协议 §17「control/error/ACK高优先级」；ADR 0010 L151「control/ACK保留额度」 | 一致 |
| §4.1 UPDATE 改道 + 直发快速路径 | 排队 data 走 per-ns 队列 + RR；窗口空位 ∧ 闸门开时 live 直发（不入队） | 协议 §17「Connection使用 per-namespace队列和 round-robin……data每轮每 namespace最多一个」+ §10.2「窗口满只暂停该 namespace发送」 | 一致（协议未要求「每个 UPDATE 必须先入调度队列」；#136 已交付态即直发；快速路径语义=「窗口未满即发」的字面执行面。解释已登记，留 SA2 攻击面） |
| §4.1 序列纪律 | 序列号只在 `OutboundQueue` 出队发送时单点分配；控制帧插队只跳过未消费序列号的未出队 data 项 | 协议 §1 不变量 2「每条正常 frame 都消费本发送方向的 sequence；对端严格按期望值接收」 | 一致：交付序=序列序保持，无 SEQUENCE_VIOLATION 自伤面 |
| §4.2 hysteresis | `> highWater` 暂停 / `≤ lowWater` 恢复 / 两水位间保持现态 | 协议 §17「超过 high-water暂停 dequeue，降至 low-water恢复」+ 校验「low-water < high-water」 | 一致（逐帧执行面：control 发送前/data 尝试前/poll 到期三观察点） |
| §4.2 poll timer | 注入 `ReplicationTimer`、零 native timer、仅暂停段存活、回调不 await Runtime/Lease/Registry | 协议 §17「无 drain event时使用 Cordis Timer调度检查，不使用原生 timer，也不进入 Runtime sequencer」；ADR 0009 Timer 纪律 | 一致 |
| §4.2 paused 只作用 data dequeue | 连接保持 ready、ACK 簿记/ackTimeout 照常、在途超时走既有 §10.4 | 协议 §17（暂停的是 dequeue）+ §15.1（ready 仅 temporary-close 退 backoff）+ §18 | 一致 |
| §4.3 保留额度记账 | 暂停段内已发出 control 帧按编码后实际字节累入，恢复/收口清零 | 协议 §17「Control frame有独立保留额度」 | 一致（量纲选择=lowWater 字节为设计自由度，已登记新决策点） |
| §4.3 耗尽处置 | hub `connectionFatal('CONNECTION_BACKPRESSURE',1011)`；peer `failConnectionBackpressure()` → close(1011) → `onTemporaryFailure()`（backoff，非 blocked） | 协议 §13.1 `CONNECTION_BACKPRESSURE \| yes \| yes \| 1011` + §14「1011：不可恢复内部错误或 control backpressure」+ §15.1「1011：继续 backoff……不永久 blocked」 | 一致：retryable=yes 落为 backoff 重连；1002/1008 才 blocked 的既有分类不动 |
| §4.3 收口 ERROR 豁免额度 | 额度耗尽后诊断 ERROR 直发出站队列（不走额度判据） | 协议 §14「如果 framing仍可信，关闭前 best-effort发送 connection ERROR」 | 一致：豁免正是为了 §14 best-effort 义务在耗尽态仍可履行 |
| §4.4 总压记账/触发 | 只计 per-ns 未发送 data 队列字节（in-flight/control 不计）；严格 `> cap` 触发 | 协议 §17「总队列超限时，按最大 queued namespace依次丢弃未发送增量并标记 needs-resync」 | 一致（「回到低水位」读作 Σ ≤ cap，已登记解释） |
| §4.4 shed 算法 | victim = queuedBytes 最大者（并列取 wheel 序先者），丢其全部未发送 + §10.2 同构处置，循环至 Σ ≤ cap | 协议 §17 同上句 +「未发送队列任一上限超出：丢弃全部未发送增量，标记 needs-resync，停止新 UPDATE」 | 一致：shed 处置与 per-ns 溢出处置同一语义（丢全部未发送 + needs-resync + 停发） |
| §4.4 恢复闭环 | 被 shed ns 经窗口收口 → peer 新 round → Step2 diff 补齐 → live；连接不重建 | 协议 §17「窗口收口后由 Peer开始新 reconciliation」+ §9.4「始终由 Peer用新 roundId 发起下一轮」 | 一致（round 恒 peer 发起；hub 侧 declareHubResync=声明后等待） |
| §4.4 不加 validate 约束 | cap < maxUpdateBytes 病理登记运维指导 + 演进位，不改校验清单 | 协议 §17 校验清单（封闭枚举）+「不得运行时 clamp」 | 一致：未增删校验清单即与文本一致 |
| §4.5 wheel RR | 插入序 wheel + 旋转游标，一次 pass 每 ns 至多 `pullAndSendOne()` 一次 | 协议 §17「data每轮每 namespace最多一个」；ADR 0010 L151「connection按namespace round-robin公平发送」；ADR 0008「不同 namespace 可并行」（结构前提） | 一致（无饥饿论证为设计自证，攻击面归 SA2） |
| §5 合并资格 | 只合并「尚未分配 sequence、尚未发送」项；in-flight 永不改写；合并产物一帧一序列号一项 inFlight | 协议 §10.1「尚未分配 sequence、尚未发送的 updates允许 `Y.mergeUpdates()` 合并；发出后不得改写」 | 一致（协议为「允许」，触发判据 queuedCount>avail 为设计自由度，已登记） |
| §5 字节上界 | 贪心累计以 `maxUpdateBytes` 为界 | 协议 §10.1「update……最大 `maxUpdateBytes`」 | 一致 |
| §7 零新状态/不投影 | sender 内部记账不上 wire、不入 Runtime status | ADR 0008 #132 修订节（status replication 域仅两态持久事实）；协议消息注册表 | 一致 |
| §7 恢复拓扑统一 | 一切「丢未发送 + needs-resync」入口收敛到同连接新 round | 协议 §9.4 + §17；phase-5 切片 6「溢出丢弃未发送增量并重新diff」 | 一致（needs-resync 非sticky、round 后回 live，与协议 §16 状态图一致；与 #134 session 级 sticky needsResync 正确区分） |
| §8 生命周期/teardown | 停止/收口/重拨/重建必经 teardown；teardown 不 await Runtime/Lease/Registry；drain 不在 sequencer 槽内 | ADR 0010 L179 停机顺序 + 协议 §21「不得从notifier或sequencer槽内await Runtime close、Lease release或Registry shutdown」 | 一致（无新停机依赖） |
| §11.1 wire 零新增 | 无新消息码/字段/错误码；`CONNECTION_BACKPRESSURE` 复用注册表既有条目 | 协议 §5「消息码是 append-only」+ §13 注册表 | 一致 |
| §11.3 有界内存 | 三层独立上限（per-ns 窗口/队列 + 连接 cap shed + control 保留额度） | ADR 0010 L165 上限清单；ADR 0010 非目标（无 durable outbox——断线丢弃队列，协议 §16「断线期间不维持 update outbox」） | 一致 |
| §14 范围边界 | DENY：`apps/**`（切片 9）、认证零新增、`replication-protocol`/`namespace-registry`/`namespace-runtime`/`doc-runtime` 零触碰 | 前置门禁注记 ③；phase-5 切片划分；ADR 0010 #134 round-2 属主边界 | 一致（详见注记 ③ 复核） |
| §15 B-4 | 「每连接最大 channel 数」上限（ADR 0010 L165 清单项）延后至演进位 | ADR 0010 L165 | 非冲突：该项不在本任务 AC 面（前置门禁已按任务简报裁定范围）；延后以演进位显式登记，不构成对 L165 的推翻——L165 要求的是插件整体配置面，随切片交付逐步落地 |

## 前置门禁三条非冲突注记落实复核

### 注记 ① 两级队列属主边界 → **落实，无混同、无代管**

- 设计 §0 R0-2 红线成文；§3.2 对账表按四维度（位置/属主、容量、溢出语义、修复拓扑）逐项对照：
  - fanout 投递队列：`namespace-registry` Runtime 内 session 域 / 容量 16 冻结不可配置 / **弃新保旧** + `status.needsResync` **sticky** / transport reset-bootstrap——与 ADR 0010 #134 round-2 修订节（L267）逐字一致；
  - WS 发送队列/连接级背压：`ws-replication` 连接域 / `maxQueuedUpdateCount/Bytes` + `maxQueuedBytesPerConnection` / **丢全部未发送** + namespace needs-resync（非 sticky，round 后回 live）+ 停发新 UPDATE——与协议 §17 逐字一致，且与 session 级 sticky 标记明确区分（两套语义未被拉平）。
- §3.2 结尾「两队列互不代管：连接层 shed 只丢弃 ws-replication 自己的未发送队列」——shed 的 `discardForConnectionPressure()` 只作用于 UpdateChannel 未发送队列，零触碰 fanout 队列；session 层溢出仍经 `FenceWatchdog` 边沿（#136 既有，不动）。
- §14 DENY LIST 把 `namespace-registry/**`、`namespace-runtime/**`、`doc-runtime/**` 全部划出改动面——属主边界有结构保证。

### 注记 ② AC-6 bufferedAmount 最小接缝 vs ADR 0010 L177 → **落实，守住「不提前提取」纪律**

- L177 原文：「在出现第二种 transport 前，不提前提取 transport-independent replication package。」约束的是**不提取包级/接口级 transport 无关抽象**。设计 §4.2 的落地形态：对既有 `DuplexTransport` 做**鸭子类型动态属性读取**（单点 `readLevel()`，缺失/非 number/非有限数 → 0 = 无压力），`DuplexTransport` 公共类型**零增字段**（R0-4/DENY types.ts）、不新增 observer 接口、不新增抽象层、不引入第二种 transport 形态——没有任何 transport-independent seam 被提取。真实 WS（浏览器/`ws` 包）`bufferedAmount` 均为 number 属性，同构直读、无需适配层。
- 协议 §17「Adapter观察 WebSocket bufferedAmount……无 drain event时使用 Cordis Timer调度检查」：观察义务落在持 transport 的连接层（ConnectionSender），poll 经注入 `ReplicationTimer`（Cordis 纪律），hysteresis 高/低水位字面实现，§11.2 以依赖方向（不 import/不 await/不回调 Runtime/Lease/Registry）结构保证「不进入 Runtime sequencer」。
- 真实 WS Adapter（切片 7 其余）明确划出范围（§0 R0-3），未借机长出第二种 transport 抽象。无冲突。

### 注记 ③ 切片 7 认证/授权与切片 9 composition root 划出范围 → **落实**

- §14 DENY：`apps/**`（切片 9 composition root）零触碰；无任何认证/授权 Adapter 实现（§16 行 ③「零新增认证面；仅 send 路径」）；HELLO 等既有控制帧路径不动（§4.1）。
- multiplex 条目本身经 #136 已交付注入 seam 消费（R0-1），未实现生产认证面。无冲突。

## 协议文本解释登记（均裁 no-conflict；原文留有自由度，设计钉死了一种读法——留作 SA2 攻击面）

| # | 协议文本 | 设计读法 | 裁决 |
|---|---|---|---|
| I-1 | §17「Connection使用 per-namespace队列和 round-robin」 | 排队 data 走 RR；窗口空位 ∧ 闸门开时 live 直发不入队（与 #136 可观察行为逐帧一致的快速路径） | no-conflict：协议未要求每 UPDATE 必先入调度队列；#136 已交付态即直发且已经门禁链接受；SA6 红灯契约（AC-2 首帧直发、AC-6a 全排队后 RR）本身编码双路径 |
| I-2 | §17「直到回到低水位」（连接总压 shed 停止条件） | Σ queued ≤ `maxQueuedBytesPerConnection` 即停（协议未定义连接队列的独立低水位值） | no-conflict：唯一可操作读法；「严格大于」触发与 AC-5 算术吻合 |
| I-3 | §17「Control frame有独立保留额度」（量纲未定） | 额度 = `limits.lowWater` 字节；公共契约零新字段下唯一量纲吻合的既有水位 | no-conflict：协议未定量纲；附注——「lowWater ≥ 1」的保证来源是 `validate.ts` 代码而非协议文本，SA4 比对时须核实该前提 |
| I-4 | §14 best-effort 收口 ERROR vs §17 额度耗尽 | 收口诊断帧豁免额度、直发出站队列（否则耗尽态无法履行 §14 best-effort 义务） | no-conflict：两条款合取下豁免是必要读法 |

## 设计引入的新决策点（已登记 relevant_decisions 末节，只登记不裁决）

D1 bufferedAmount 鸭子类型属性读取 seam（缺失/非 number/非有限 → 0）；D2 `BACKPRESSURE_POLL_INTERVAL_MS = 1_000` 冻结常量；D3 保留额度 = lowWater 字节 + 编码实长记账；D4 耗尽双侧处置路径（hub connectionFatal / peer failConnectionBackpressure + 收口帧豁免）；D5 总压记账域/触发/shed 停止条件；D6 shed = §10.2 同构处置；D7 data 双路径 + drain 三触发点；D8 合并触发判据（queuedCount > avail）；D9 水位三观察时机；D10 内部 seam 变更四项（公共契约零变化）；D11 两项 validate 约束的显式不加（B-3/B-4 演进位）。详见 `wiki/raw/task_phase5-ws-multiplex-backpressure_relevant_decisions.md`「设计后复审追加」节。

## 结论

**Verdict: `clear` —— 放行（路由 → SA2 攻击评审）。**

- 冲突点数：0；裁决分布：no-conflict（溯源 24 项 + 注记复核 3 项 + 解释登记 4 项全部 no-conflict），override-declared 0，evolution 0，hard-violation 0。
- 设计是 ADR 0010（L143/L151/L165/L177 + #134 round-2 属主边界修订）+ 协议 v1（§1/§9.4/§10.1/§10.2/§13.1/§14/§15.1/§16/§17/§21）+ Phase 5 切片 6/7 的忠实实施设计；全部可争议处（I-1–I-4、D1–D11）均为协议自由度内的钉死选择，已登记供 SA2 攻击与后续轮次回查，无需 override、无需 Jim 裁决条目。
- 前置门禁三条非冲突注记全部成文落实（R0-2/§3.2/DENY、R0-3/§4.2、§14 DENY），无一条被违反或稀释。
- 边界重申：本报告只裁一致性；快速路径公平性、走查正确性、代码锚点（§1.1 源码事实、P-1–P-8 假设）与 73 IT 零回归论证的充分性属 SA2/SA4/SA7 职责。
