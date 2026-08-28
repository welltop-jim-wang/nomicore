# SA2 攻击评审报告 — issue #137（单连接多 namespace 多路复用 + 有界公平背压）

**Date**: 2026-08-28（R1）/ 2026-08-28（R2 复审，§7）/ 2026-08-28（R3 复审，§8）
**被审对象**: `wiki/raw/task_phase5-ws-multiplex-backpressure_design.md`（R1：573 行；R2：677 行；R3：715 行，6 处 R3 落文 + 「SA2 反馈逐条回应（R3）」表）
**审查基准**: `..._relevant_decisions.md`（ADR 约束基准 + 末节 D1–D11 设计决策点）、协议
`docs/protocols/instance-replication-v1.md` §10/§13.1/§14/§17、SA6 红灯契约（4 用例 + driver + harness）、
`packages/ws-replication` / `packages/replication-protocol` / `packages/namespace-registry` 现行源码（逐锚核实）。
**Verdict（R1，已被后续修订取代）**: reject（窄幅）—— 详见 §2 攻击点清单。
**Verdict（R2 复审，已被 R3 修订取代）**: reject（窄幅·恰一处新缺陷 R2-N1）—— 详见 §7。
**Verdict（R3 复审，最新·最终）**: **pass** —— R2-N1 采方案 A（消费即进展）按本报告 R2 §7.3 的修订要求
逐字落实（§6.2 返回值钉死 / §4.5 进展语义条 / §5「同一次 drain 的后续 pass」/ §6.1 注释 / §10 行 5 等价性
补强——五处同口径）；7.4 三条次要注记全部落实；diff 复审未发现新伤；D1–D11 零改动。**设计放行
（路由 → SA3 TDD 实现）**。`pass` 不替代 SA4 静态验尸与 SA7 动态验证；R2-N1 转绿守卫用例与 F1–F9
红灯思路是 SA3/SA7 的直接输入。详见 §8。

---

## 0. 攻击方法与证据基线

- 全程以「全新视角」重读设计，不复读 SA8 结论；SA8 已 clear 的 ADR 一致性只做抽样复核（两级队列属主 §3.2、
  零新状态 §7、零 native timer §4.2——均与 ADR 0010/0008/0009 条款吻合，无翻案点）。
- 设计 §1.1 基线勘察表、§12 P-1~P-8 协议假设、§13 caller 枚举逐条对源码核实（结果见 §3/§4）；四红灯逐用例
  独立重演（不复读 §9，见 §2.3）。
- 关键源码锚（本轮实测核实）：`update-channel.ts:50-132`（deliver/overflows/flushQueued/sendAndRegister）、
  `frame-io.ts:98-189`（OutboundQueue/sendData 死代码/emitOne）、`peer-connection.ts:392-398`（sendControl ready 门）、
  `:406-423`（onSequenceExhausted 直发先例）、`:427-438`（onClose 1011→temporary）、`:440-450`（connectionFatal 走
  ready 门 sendControl）、`hub-connection.ts:345-362`（connectionFatal→sendControlChecked 无状态门）、
  `peer-namespace.ts:113-124/445-455/694-724/823-835`、`hub-namespace.ts:120-131/610-639/725-737`、
  `validate.ts:103-142`、`defaults.ts:16-44`、`errors.ts:27,108`、`harness.ts:395-408/538-566`、
  `issue137-driver.ts:120-125`、`namespace-registry/src/testing.ts:74-109`。

---

## 1. SA8 圈定攻击面 I-1~I-4 逐条结论

### I-1：data 直发快速路径绕过 RR wheel —— **结论：不破坏 AC-4 语义、不制造饥饿（pass，附 3 条量化注记）**

攻击与逐层破壁：

1. **「每轮每 ns 至多一帧」语义域**：AC-4（协议 §17「data 每轮每 namespace 最多一个」）的「轮」只对**排队 data 的
   出队调度**有定义；直发快速路径不在任何轮内。红锚时序（AC-6a：压力先置 → 六笔全部排队 → 恢复后 RR）中快速路径
   完全不参与，`[a,b,a,b,a,b]` 不受影响。快速路径的前置是「本 ns 窗口空位 ∧ 闸门开」——它消费的是**本 ns 自己的
   窗口额度**，不占任何排队 ns 的出队位；排队 ns 的出队约束只有「自身窗口满」（由自身 ACK 解除）与「闸门关」
   （由 poll 恢复解除），两者均与热 ns 的直发量无关。
2. **触发点完备性（防漏排）**：入队原因封闭为两类——窗口满（释放 ⇒ onAck 空位 → requestDataDrain，§6.2）与
   闸门关（释放 ⇒ poll 恢复 → 立即 drainData，§4.2）；deferred 队列经 resetForLive（round 结算先 `setState('live')`
   再 drain，peer-namespace.ts:631-632 / hub-namespace.ts:731-733 次序核实）；ackTimeout/abandon/markResync 路径
   均清队列或转 needs-resync。**不存在「queued 非空 ∧ 窗口开 ∧ 闸门开 ∧ 无未来触发」的状态**——无饥饿的结构前提成立。
3. **共享出口竞争**：真实 socket 上直发帧与排队帧共享 bufferedAmount。闸门在两条路径上**逐帧前置观察**
   （D9 ②：每次 data 发送尝试前），故超过 highWater 的过冲至多 1 帧/方向（有界过冲）；暂停对两条路径一视同仁，
   恢复 drain 亦然。wire 级公平由水位闸门兜底，非 RR。
4. **注记（要求落进设计文本，均非否决项）**：
   - a. 恢复窗口内「热 ns 新写直发」与「积压 ns 排队 drain」共享恢复带宽——B 每轮必得一帧（非饥饿），但逐帧交错
     不承诺；建议 §4.5 快速路径论证补一句「共存窗口的带宽分享由水位闸门兜底」。
   - b. wheel 移除（facet 消失/队列空）会使旋转游标在**本次 pass 内**跳过一邻位（经典下标偏移）——pass 内公平轻微
     偏斜、无跨 pass 饥饿；应在 §4.5 注明（或规定移除时不前移游标）。
   - c. `DRAIN_TURN_LIMIT=10_000` 截断出口（progressed=true 但 pass 用尽）依赖「已发出帧的 ACK 会再触发 drain」——
     成立（截断前至少发过 1 帧 → in-flight 非空 → ACK 必至），但应在 §4.5 注明该依赖，防止 SA3 把 turns 用尽当成
     终态。

### I-2：shed 停止条件「回到低水位」读作 Σ ≤ cap —— **结论：不会过度收口、不会收口不足（pass，附边界注记）**

1. **收口不足不可达**：`enforceConnectionCap` 循环每轮丢「最大 queued ns 的全部未发送」，Σ 单调下降；唯一 break
   条件是 victim 不存在或 queuedBytes=0——而记账域 Σ ≡ Σ facet.queuedBytes()（只计未发送 data，入队只增、
   出队/丢弃只减、无增量记账可腐化），Σ > cap 时必有某 facet > 0 ⇒ 循环必收敛到 Σ ≤ cap。**不存在 >cap 停摆**。
2. **过度收口不发生**：整 ns 粒度下每次只丢「使 Σ 回 ≤ cap 所需的最少 ns 数」；丢弃整 ns 未发送与 §17「丢弃
   未发送增量并标记 needs-resync」per-ns 溢出处置同构（D6），无部分丢弃语义可偷换。
3. **备选读法排除**：若把「低水位」读作 `limits.lowWater`（64KiB），则缺省 cap=8MiB下一次超限须清到 64KiB——
   近乎清空全部 ns 队列，且 AC-5 配置（cap=60KB < lowWater=64KB）语义反转（Σ=30KB 已 ≤64KB 却仍需 shed 到
   「回到低水位」的另一种读法不可操作）。设计读法是唯一同时满足协议字面与 AC-5 算术的读法。SA8 I-2 裁决维持。
4. **边界注记（LOW）**：触发「严格大于」+ 停止「≤ cap」⇒ Σ==cap 时下一笔 1 字节入队即再次 shed（无迟滞）。
   再触发需重新积压越过 cap（受 per-ns 与连接记账约束），churn 有界；协议字面如此。登记即可，不要求改。

### I-3：control 保留额度量纲 = lowWater 字节 —— **结论：触发路径完备（pass），但耗尽判据未钉死 + 极端合法配置未登记（升级为发现 #3，必改）**

1. **lowWater ≥ 1 前提核实**：`validate.ts:112` `positiveSafeInteger(limits.lowWater)` ✓（设计附注属实；
   `lowWater < highWater` @ :138）。额度恒 ≥ 1 字节，无 0 额度除零/恒耗尽病理。
2. **触发路径完备性逐路径核验**（「额度耗尽 → CONNECTION_BACKPRESSURE」无漏面）：
   - peer：控制器帧 / round-engine 帧 / `withController`·`onRemoteOpen` 的 NAMESPACE_STATE_VIOLATION——全部经
     公共 `sendControl`（§6.3 改经 `sender.sendControl`）✓ 记账可达；HELLO 直发 outbound（fresh sender 恒
     unpaused，构造期无暂停段）✓ 合理豁免；`connectionFatal`/`onSequenceExhausted`/`failConnectionBackpressure`
     收口帧豁免（见 I-4）✓。
   - hub：`sendControlChecked` 是唯一控制出口（HELLO_ACK、UPDATE_ACK、SYNC_*、RESYNC_REQUIRED、namespace ERROR
     全经此，hub-connection.ts:138/221/317/348）→ §6.3 改经 sender ✓ 记账可达。
   - 结论：**UPDATE_ACK 洪水 / SYNC_STEP2 / BOOTSTRAP_SNAPSHOT / RESYNC_REQUIRED 四类大或高频控制帧在暂停段
     全部落在记账面内**，耗尽路径完备。
3. **必改点（发现 #3 详见 §2）**：(a) 耗尽判据的比较谓词未定义（`used + frameBytes > reserve` 还是
   `used ≥ reserve`？两读法触发帧不同、SA7 配方数值不同）；(b) validate 允许 `lowWater=1, highWater=2` 的合法
   配置 ⇒ 暂停期**第一个**控制帧（编码后 ≥ 数十字节）即 CONNECTION_BACKPRESSURE——B-2 只以缺省 64KiB 论证，
   未覆盖该合法极端；量纲挪用（传输层数据水位 ↔ 控制面字节预算）在该极端下产生「配置了背压 = 禁用控制面」的
   反直觉行为，须显式登记运维下界指导或声明接受。
4. **B-2 风暴闭环补全（LOW，要求补注）**：慢消费者 + 大 diff 的完整循环——重连 → reconcile → Step2（≤2MiB，
   控制帧不经闸门）灌满出站缓冲 → 下一控制帧观察点进入暂停 → 后续 Step2/ACK 计入 64KiB 额度 → 立即耗尽 →
   1011 → 重连 → 同一 diff 再 Step2……唯一出口是对端恢复读取 socket；backoff baseMs=100→maxMs=30s 全抖动收敛
   （defaults.ts:40-44），每循环白传 ≤2MiB。协议字面如此（reserve 耗尽=分类失败），非设计缺陷，但 B-2 现文本
   「重连风暴面」五字过于简略，要求补该闭环与终止条件。

### I-4：收口 ERROR 直发豁免额度 —— **结论：不可滥用为无限 control 通道（pass，附 1 条守卫注记）**

1. **豁免面封闭枚举**：peer `connectionFatal` / `onSequenceExhausted` / `failConnectionBackpressure` 的收口 ERROR、
   hub `connectionFatal` / `onSequenceExhausted`——共 5 个调用点，全部是**连接终局路径**，无业务帧可借道。
2. **有界性**：每次收口事件至多 1 帧豁免帧；事件后 transport.close（hub 另有 `closedFlag` 幂等门，hub-connection.ts:345）
   与状态迁移（peer enterBlocked 幂等 @ peer-connection.ts:452）使后续调用被 `transport.closed`/`closedFlag`/重入
   守卫吸收。fake WS `close` 同步置 `self.closed=true`（harness.ts:547-555，P-8 核实），同 tick 二次 fatal 不会再发帧。
3. **零递归**：额度判据只在 `sender.sendControl` 单点；豁免路径直发 outbound 不经该点，`failConnectionBackpressure`
   的递归发送被 state 守卫吸收（§4.3）✓。
4. **注记（MINOR）**：真实 WS adapter 的 `close()` 是否同步置 `closed` 不在契约内——豁免路径的幂等不得**依赖**
   `transport.closed`，应以连接自身状态守卫为准（设计已有 `failConnectionBackpressure` 重入守卫；peer
   `connectionFatal` 现仅有 `stopping` 守卫 + transport.closed 检查——要求 SA1 在 §4.3/§6.3 明示：收口路径幂等
   由 connState/closedFlag 保证，transport.closed 只是 fast-path）。

---

## 2. 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 修订要求 |
|---|--------|--------|---------|---------|
| 1 | **MAJOR** | §5 合并账务核减口径 | 「队列侧在出队时**按合并产物实长**核减 queuedBytes」：queuedBytes 入账是逐项原始字节数之和（update-channel.ts:69-70），出队合并后按合并产物长度核减——`Y.mergeUpdates` 产物长度 ≠ Σ 项长度（通常更小）⇒ **账务撕裂**：phantom queuedBytes 累积 → `overflows()`（:101-107 用 pendingBytes）提前误溢出 → AC-3 per-ns 溢出误触发；`facet.queuedBytes()` 虚高 → AC-5 shed 误选 victim/误触发；§11.3 有界内存记账失真。SA3 按字面实现即产出缺陷。 | 改为：「核减 = 被取出各项的**入账字节数之和**；合并产物实长仅用于 inFlight 记账与本帧 maxUpdateBytes 判据」。 |
| 2 | **MAJOR** | §6.3/§10 未登记行为变化 | peer `connectionFatal` 改直发 outbound **绕过 ready 门**（#136 现状 peer-connection.ts:440-450 经 `this.sendControl` 的 ready 门，非 ready 窗口 ERROR 被吞为 0 帧；hub 侧 `sendControlChecked` 本无状态门故无变化）⇒ handshaking 期 fatal（decode error @ :220-227、HELLO_ACK mismatch @ :247-253）从「零 ERROR 帧」变为「发出 ERROR 帧」。§10 回归表未列此项；§6.3「非耗尽场景下行为与经 sender 等价」只对 ready 态成立。新行为其实**更符合**协议 §14（framing 可信时关闭前 best-effort ERROR），但这是 wire 可观察变化，不能以「碰巧无既有断言」 silently 通过。 | §10 补一行登记该 delta（grep 证实 73 IT 无 handshaking-fatal 帧断言，零回归仍成立——但须成文）；§6.3 明示「peer 收口直发绕过 ready 门是协议 §14 义务的有意收窄」；SA7 移交用例（红灯思路 §5-F2）。 |
| 3 | **MAJOR** | §4.3 耗尽判据未钉死 | (a) 比较谓词未定义：`controlReserveUsed + frameBytes > lowWater` 还是 `controlReserveUsed ≥ lowWater`？触发帧与 SA7 配方数值（~1700 ACK）随谓词漂移；(b) 合法极端配置 `lowWater=1` 下暂停期首个控制帧即 1011——「配置背压=禁用控制面」未登记（见 I-3.3）。 | 钉死谓词（建议：`used + frameBytes > lowWater` ⇒ 触发帧不发送并收口）；B-2 增补 lowWater 下界运维指导（如 reconcile 期不瞬断需 lowWater ≥ maxSyncDiffBytes）或显式声明接受该病理。 |
| 4 | MINOR | §5 与代码事实矛盾 | 「单项本身 > maxUpdateBytes ……**不入队**不参与合并」与 §6.2「deliver 逐字不动」矛盾：deliver 入队路径**无大小门**（update-channel.ts:58-70），超限项会入队、在 pull 时经 `sendUpdateFrame` 大小门（peer-namespace.ts:714-718）返回 0 丢弃（F4）。且「至少一项」遇超限首项 = 整帧（含已并入的合法项？——若首项即超限则仅其本身）丢弃，应写明等价逐笔丢弃。 | 更正描述为「入队、pull 时 F4 丢弃」；写明超限首项时合并帧=单项、丢弃语义与逐笔一致。 |
| 5 | MINOR | §6.2 facet 契约前置未成文 | `pullAndSendOne()` 的入口前置（controller live ∧ channel !needsResync ∧ `inFlight < maxInFlightUpdates` ∧ queued>0）散落于 §4.5 注释与 §6.3——§6.2 接口契约只写「合并策略取一帧→emit→inFlight 登记；false=本轮无帧」。漏写窗口前置 ⇒ SA3 可实现出**超窗发射**（flushQueued 的循环条件 `inFlight < max` 在 :125-126，pullAndSendOne 无循环可依托）。 | §6.2 钉死前置条件表；false 语义 = 前置任一不满足。 |
| 6 | MINOR | §8 teardown 矩阵缺口 | GOAWAY `SERVER_RESTARTING` → `scheduleDrainClose()`（peer-connection.ts:357-365）本地 close 后 FSM 停留 ready、无重拨编排——该路径 sender teardown 未列入 §8；已武装的 poll timer 会在已关 transport 上空触发，且「仍 > lowWater → 重武装」在 stale getter 上可能 1s 周期性重武装直至下次 dialNow 换 sender。 | §8 补该路径 teardown（或成文：stale fire 对已关 transport 零副作用且不重武装）。 |
| 7 | MINOR | emit 异常传播未规定 | `OutboundQueue.emitOne` 可抛 `OutboundExhaustedError`（frame-io.ts:173-179）/编码错。新链路 `drainData → pullAndSendOne → sendUpdateFrame → host.sendData → tryEmitData → emit`——若 sendUpdateFrame 的 try/catch 包裹（sendChecked 同款，§6.3「包裹不变」）不覆盖 `host.sendData` 调用，异常将穿越 drainData/onAck/onMessage 回调栈成为 uncaught。 | 钉死：sendUpdateFrame 的 try/catch 覆盖 sendData 调用（seq≤0 → F4 消费即丢弃）；drainData 内 emit 异常不得逃逸至 transport 回调栈。 |
| 8 | LOW | §4.5 轮转细节 | wheel 移除致游标 pass 内跳位（I-1 注记 b）；turns 截断出口依赖 ACK 再触发（I-1 注记 c）。 | §4.5 两条注记成文。 |
| 9 | LOW | §4.4 边界无迟滞 | Σ==cap 后 1 字节再入队即再 shed（I-2 注记 4）。 | 登记即可。 |
| 10 | LOW | §15 B-2 风暴闭环 | 慢消费者 + 大 Step2 的周期性 1011 重连循环未写全（I-3.4）。 | B-2 补闭环描述与终止条件。 |
| 11 | LOW | §4.2 seam 反向风险 | 缺 `bufferedAmount` 属性 = 恒无压力是**契约行为**（非伪降级——公共类型本无该字段，正常流程不「总应满足」）；但生产 adapter 忘接属性 ⇒ 背压**静默失效且无检测面**。 | 登记切片 7 adapter 自检演进位（如启动时探测一次并日志/metrics）。 |

**无 CRITICAL**：未发现竞态/死锁（drain 全同步、单线程微任务模型下无交错面）、未发现虚假降级（见 §4）、
未发现状态撕裂（sender 记账不投影、ADR 0008 #132 边界保持）、未发现协议违反（SA8 clear 抽样复核无翻案）。

---

## 2.1. AC-2 合并判据与 AC-4 红锚的时序边界张力 —— **结论：自洽（独立重演通过）**

- **AC-2 形状**（1 ns，window=1，saveGate 扣 A1）：A1 直发（帧 1）；A2/A3/A4 排队（pending=1,2,3 < 100，字节 ≪ 1MiB
  ——`overflows` 逐值核实不溢出）；释放 → ACK(A1) → onAck 'ok' → avail=1 < queued=3 → 贪心合并 3 项为 1 帧
  （≤ maxUpdateBytes=512KiB 缺省）→ 总 2 帧 < 4 ✓；hub apply 合并增量 n=12..14 收敛 ✓。
- **AC-4 形状**（2 ns，window=32）：queued=3 ≤ avail=32 ⇒ 不合并；wheel 插入序 [A,B]（写序 a,a,a,b,b,b，首次入队
  A 先）→ 三轮 pass 恰 `[a,b,a,b,a,b]` ✓；帧间复查恒 32KB（≤ lowWater 64KB）不中断 ✓。
- **边界**：queued == avail 不合并（窗口恰吸收，逐笔）✓；drain pass 内 avail 随该 ns 自身 inFlight 递减、
  判据 per-facet 计算无跨 ns 污染 ✓；合并以 pull 为单位、ACK 粒度变粗但簿记无特例（§5，除发现 #1 的核减口径）。
- **既有用例 queued>avail 可达形态逐一复核**（§10 行 3 论证属实）：ac5-live:98（window=2, 3 写 → queued=1, avail=1
  → 不合并 → 3 帧断言保住）；sa4-f1-f2-f3:30 / ac6-resync-close:42 / r3-r4⑧a:278（maxQueuedUpdateCount=1 → 第二笔
  即溢出，无积压面）；r3-r4⑦:241（W3 排队永不发——closing 态 onUpdateAck 被 isQuietState 早退，channel.onAck 不
  达，drain 不触发；pullAndSendOne 另有 live 门双保险）；fanout 溢出用例（window=32 > 20 笔全直发）。
  **既有用例中唯一可达形态确为单笔排队，合并=恒等** —— §10 行 3 成立。

## 2.2. SA6 四红灯确定性走查 —— **结论：独立重演全部成立**

- **AC-2**：如上 ✓（含守卫：peer 本地 n=14 先于释放即可断言）。
- **AC-6a+AC-4**：压力 2×highWater 先置 → 六笔 deliver(live) 逐笔在 `dataGateOpen()` 观察点进入暂停段（首笔武装
  poll@1000ms）→ 全部入队（per-ns 上限远未触、连接总压 ≪ 8MiB 缺省 cap 不 shed）→ 零 UPDATE 帧 / hub n=1 /
  连接 ready ✓；`setPeerPressure(32KB)` → `advanceBy(1000)`（fake scheduler `at <= deadline` 命中，testing.ts:92-107
  核实）→ 恢复清 timer/额度 → drain → `[a,b,a,b,a,b]` ✓。确定性锚核实：makeEnd.send 经 queueMicrotask 投递
  （harness.ts:540-546）⇒ 到达序=发送序；恢复循环 `advanceBy(1000)` 首轮即触发；hub 侧 hubPressure=0（属性在但值 0）
  恒不暂停、hub 不回发 fan-out（P-7 回声抑制，ac5-live:72-95 既有锚）⇒ `peerUpdateNsSeq` 不被污染。
- **AC-5**：A1/B1 直发在途（saveGates 到达序 gateA/gateB，P-5）；A2 入队 Σ=30KB、A3 入队 Σ=60KB==cap **不触发**
  （严格大于，逐值核实）；B1 直发；B2 入队 Σ=90KB > 60KB → victim=A（60>30）→ shed A（丢 60KB + RESYNC_REQUIRED
  + needs-resync）→ Σ=30KB 停止；B live / A 本地 blurb=BLOB[2] / 连接 ready ✓；overflows 边界（A: 30+30+30=90 ≤
  200KB、B: 30+30=60 ≤ 200KB）不误触 per-ns 溢出 ✓；gate 释放 → ACK(A1) → 窗口收口 → maybeStartRecovery → 新 round
  Step2 diff 补齐 BLOB[1..2] → A live ✓；ACK(B1) → drain 出 B2 ✓。与 §9 逐值吻合。
- **AC-6b**：peer 写 n=1 peer 方向无压直发 → hub apply → UPDATE_ACK（control）：sendControl 观察点进入暂停段（武装
  hub timer）但 control 不受阻 → ACK 照常出（~40B ≪ 64KiB）✓；hub 写 n=9 → fanout deliver(live) → dataGateOpen=
  false → 入队 → 零 fan-out UPDATE / hub 本地 n=9 ✓；`setHubPressure(32KB)` → hub scheduler advanceBy(1000) →
  恢复 → drain → UPDATE 出 → peer n=9 ✓。

## 2.3. 既有 73 IT 零回归论证完备性 —— **结论：主体成立，缺漏 = 发现 #2/#5/#6/#7**

§10 八行逐行复核：行 1（makeWire/makeDuplex 无 bufferedAmount 属性 → 恒 0 恒开、timer 永不武装——harness.ts:538-566
核实）✓；行 2（无暂停时直发序=请求序=序列序；r3-r4⑦ CLOSE=9 走查重演成立：UPDATE(7,8) 直发、W3 排队不发、
CLOSE(9) control 直发）✓；行 3（已核，§2.1）✓；行 4（grep 证实 maxQueuedBytesPerConnection/lowWater/highWater 仅
存在 defaults/validate/types/harness 镜像/api.test-d 类型断言，运行时零读取、无测试覆写）✓；行 5（单 ns onAck 同栈
drain ≡ 原 flushQueued 循环；quiet-state 早退使 closing 期零 drain，live 门双保险等价）✓；行 6（暂停段才记账，
行 1 成立 ⇒ 零触达）✓；行 7（sendData/dataQueues/nextDataNamespace/queuedDataCount grep 证实零 caller；
sendControl 返回 lastSeq 语义保留 → round-engine ownStep1Seq 簿记不受影响，round-engine.ts:86-115 核实）✓；
行 8（teardown 矩阵——除发现 #6 缺口）✓。**缺漏**：#2（peer connectionFatal ready 门 delta 未列）、#5（pullAndSendOne
前置）、#6（scheduleDrainClose）、#7（emit 异常传播）——后三者是「规格钉死不足」而非论证错误。

---

## 3. 协议假设依据审查（skill 立法项）

- **章节存在**：§12 存在，P-1~P-8 共 8 条，全部给出「源码引用 / 现有测试引用」级依据，无「应该/通常/预计」类
  无据推断。**通过**。
- **依据真实性（本轮逐条实测核实）**：P-1（issue137-driver.ts:120-125 `Object.defineProperty` getter ✓；WHATWG
  `bufferedAmount` number 属性引证合理）；P-2（registry testing.ts:92-107 `.filter(at <= deadline)` 按到期序触发 ✓）；
  P-3（peer-connection.ts:427-438：仅 1002/1008 → blocked，1011 → onTemporaryFailure ✓，与 §13.1 retryable=yes 一致）；
  P-4（errors.ts:27 类型 + :108 `connectionError('CONNECTION_BACKPRESSURE', true, 'yes', 1011)` ✓）；P-5
  （harness.ts:403-408 saveGates.shift() 到达序 ✓）；P-6（peer-namespace.ts:5 `import * as Y from 'yjs'` ✓）；
  P-7（ac5-live.test.ts:72-95 回声抑制既有锚存在 ✓）；P-8（harness.ts:547-555 close 仅通知对端 listeners ✓）。
  **无「声称实测但未贴命令输出」条目**（设计未主张新实测，全部为静态引用——可被 SA4 复核）。
- **可验证性**：全部引用可定位、命令可重跑（SA4 静态门禁可直接消费）。**通过**。

## 4. 错误处理链路审查（skill 立法项）

- **静默失败**：额度耗尽 → 触发帧不发送 + best-effort ERROR + close(1011) + FSM 迁移（hub closed / peer backoff）
  ——响亮收口，无静默吞帧路径 ✓。F4 丢弃（seq≤0）有 round 修复兜底且为既有语义 ✓。
- **状态闭环**：`paused`/额度/wheel 为 sender 内部记账，**有意不投影**（§7，落在 ADR 0008 #132「不含 session、网络、
  队列或 sync 状态」边界内，SA8 复核一致）；失败分类经既有连接 FSM（backoff/blocked）与 ns needs-resync 投影 ✓。
- **降级路径**：`bufferedAmount` 缺失/非 number/非有限 → 0=无压力——**非伪降级**：判定标准「该条件在正常流程是否
  总应满足」为否（`DuplexTransport` 公共类型本无该字段，api.test-d.ts:113-121 形状断言零该属性），缺失是契约内
  合法形态。反向风险（生产 adapter 忘接 ⇒ 背压静默失效无检测面）登记为发现 #11。
- **可感知性**：observer/metrics 面（§11.1 wire 零新增）不在本任务 AC 面（phase-5 阶段门禁另裁）。
- **结论**：无虚假降级、无静默失败闭环缺口。

---

## 5. 红线测试思路（每发现对应的 IT 编写方向；SA3/SA7 消费）

- **F1（合并账务）**：AC-2 场景扩展——window=1、saveGate 扣 ACK、写 N 笔**大而可压缩** update（同 ns 连续写同
  字段），释放后合并为 1 帧发出；随后继续写 M 笔逼近 `maxQueuedUpdateBytes`，断言 per-ns 溢出（needs-resync +
  RESYNC_REQUIRED）恰在真实 Σ 字节超限时触发（若 queuedBytes 按合并产物核减 → phantom 累积 → 提前触发 → 红）；
  再设 `maxQueuedBytesPerConnection` 恰在 Σ±ε，断言 shed 恰在真实超限时选 victim。
- **F2（ready 门 delta）**：peer 端 `waitFor:'handshake'` 后注入坏帧（sequence 正确但 payload 截断 → decode error
  @ handshaking）→ 断言：连接 blocked + peerToHub 恰 1 个 connection ERROR 帧 + close code 对应（新语义显式锁定，
  防 SA3 回退成静默）。
- **F3（额度判据+极端配置）**：① withPressure + `lowWater:1, highWater:2` → 置压 → 触发任一 control 帧（如
  peer 写一笔使 hub 回 ACK）→ 断言 CONNECTION_BACKPRESSURE ERROR + close(1011) + peer backoff（attempts≥1、
  非 blocked）+ 重连后恢复；② 缺省 64KiB 配方（~1700 ACK 或 1 个 >64KiB 的 Step2）锁定判据谓词下的精确触发帧数。
- **F4（超限项入队-丢弃）**：`maxUpdateBytes` 配小（< 生成的 update）+ window=1 → 第二笔入队 → ACK 释放 → 断言
  该帧零 UPDATE 发出（F4）且后续 round diff 收敛（超限数据永不发但本地保留）。
- **F5（pullAndSendOne 前置）**：window=1、2 ns 各 2 笔排队（闸门关制造积压）→ 恢复 → 断言单次恢复每 ns 至多发
  window 容量帧、无超窗 inFlight（经后续 ACK 数与帧数守恒断言）。
- **F6（timer 泄漏）**：withPressure + 置压进入暂停 → 注入 GOAWAY(SERVER_RESTARTING, drainTimeoutMs=0) → drain
  close → 断言 peer scheduler.pending() 恢复基线（无残留 poll timer）或 stale 触发后不重武装。
- **F7（emit 异常）**：静态守卫为主（SA4：drainData 调用链 try/catch 覆盖面 grep）；运行时可用 mock transport.send
  抛错注入 → 断言零 uncaught rejection + 连接收口路径不变。
- **F8（I-1 直发共存公平）**：2 ns，B 窗口满积压（saveGate 扣 B 的 ACK），A 窗口空持续写 → 断言 B 的 ACK 释放后
  B 帧在同步栈内发出（hub 收到序不晚于 A 的下一帧一个微任务边界）+ 全程 B 每 drain 轮恰得帧（无跨轮跳过）。
- **F9（73 IT 守卫）**：全量重跑（SA3 TDD 每步 + SA4/SA7），重点盯 r3-r4⑦（CLOSE=9、UPDATE=2）、ac5-live:98
  （3 帧/3 ACK）、ac7-faults:216（low/high 覆写但无属性恒开）。

---

## 6. 结论

**Verdict: reject（窄幅修订后可快速复审）**

- **存活面**（攻击未破）：总体架构与属主边界（§3）；I-1 直发读法、I-2 Σ≤cap 读法、I-4 豁免封闭性（§1）；
  I-3 触发路径完备性与 lowWater≥1 前提（判据钉死除外）；AC-2/AC-4 判据张力自洽（§2.1）；SA6 四红灯走查
  独立重演成立（§2.2）；§10 回归论证主体 + 行 1–8 逐行核实（§2.3）；P-1~P-8 依据全部属实（§3）；错误处理链路
  无虚假降级（§4）。
- **必改**：发现 #1（合并账务核减口径——一字之差撕裂三套记账）、#2（connectionFatal ready 门 delta 登记缺失）、
  #3（耗尽判据谓词 + lowWater 极端配置登记）。
- **随修订落实**：#4–#7（钉死性修订）、#8–#11（注记/演进位登记）。
- 修订不触及架构决策（D1–D11 无一被推翻，仅 D3/D8/D10 需补精度），复审可只对 diff 进行。

> 边界重申：`pass` 与否不替代 SA4（静态验尸）与 SA7（活链路）验证；本报告的红灯思路是后续 SA3/SA7 的直接输入。

---

# §7. R2 复审（2026-08-28 追加；diff-only，对象 573→677 行）

> 复审范围：R1 三 MAJOR（#1/#2/#3）修订核验 + #4–#11 与 I-1/I-4 注记抽查 + 新伤扫描。
> 方法：全文重读 R2 设计 + 对修订涉及的源码/测试锚独立复核（§10 行 9 的零回归声明逐断言重验），
> 不复读 SA1 自查表结论。

## 7.1 R1 三 MAJOR 修订核验 —— 全部通过

**#1 合并账务核减口径（§5「账务一致性」R2 重写，:339-347）—— ✅ 通过**

- 修订文本钉死：「出队核减 = 被取出各项的**入账字节数之和**（`update-channel.ts:69-70` 口径）——无论这些项被
  合并为一帧还是逐笔发出」；合并产物实长**只用于两处**（inFlight 记账 / 本帧 maxUpdateBytes 判据）；
  「queuedBytes 恒等于队列内各项原始字节数之和（可从队列直接重算）」。
- 核验：与入账口径（:69-70 逐项累加）严格互逆——phantom 记账面消除；`overflows()`（:101-107，
  pendingBytes = queuedBytes + Σ inFlight）两侧口径各自为「真实占用」的正确度量（未发送项按原始字节、
  已发送项按实发字节），自洽；§6.1 facet 注释、§6.2 引用三处同口径，无残留旧读法。

**#2 connectionFatal ready 门 delta（§6.3 R2 新条 :433-441 + §10 行 9 :540 + §15 B-6 :630）—— ✅ 通过（附精度注记）**

- 修订成文：定性为「协议 §14 best-effort 义务的有意落实（#136 R-13 收口方向）」；ready 态 fatal 行为不变；
  onSequenceExhausted 本就直发（#136 :406-423 先例）、无变化；B-6 残留面（非收口控制器帧仍以 connState 判定）
  划界准确。
- **§10 行 9「既有 ERROR 帧断言零触及」声明独立复核成立**：全测试库 `peerFrames('ERROR')` 断言恰 4 处——
  ① ac1-ac2:262（TARGET_NOT_REQUESTED）；② ac3:112（BOOTSTRAP_FAILED）；③ ac5-live:141
  （ACK_STATE_VIOLATION——**唯一真正的 peer connectionFatal 断言**，UPDATE_ACK 仅 dispatchReady 处理 →
  ready 态，现流程 ready 门放行、R2 直发同帧，零 delta）；④ r3-r4:212（closing 期零回发，namespace 域）。
  另核实：全库无 `waitFor:'handshake'/'none'` 用例、无 INSTANCE_IDENTITY_MISMATCH/HELLO_REQUIRED 断言、
  唯一 blocked 断言（sa4-f1-f2-f3:118）源自 ready 态注入重复序列帧、spec-b1-b2（B-1/B-2b/B-2d/B-2e）与
  sa4-r4-1（firstAfterHello 锚）均无 connectionFatal 路径——**handshaking 期 peer fatal 零断言触及**。
- 精度注记（非阻塞，见 7.4-1）：行 9 把 4 处统称「均在 ready 态」——其中 ①② 实为 namespace-scope ERROR
  经公共 sendControl 路径（不受影响的真正原因是**路径分离**而非状态）；结论不变。

**#3 耗尽判据（§4.3 R2 钉死 :195-201 + 合法极端登记 :207-211 + §15 B-2 运维下界）—— ✅ 通过**

- 谓词钉死：`controlReserveUsed + frameBytes > lowWater` → 触发帧不发送并立即收口；明示**禁用**
  `used ≥ reserve` 等其他谓词；「额度语义 = 暂停段累计已发出控制字节 ≤ lowWater」与谓词自洽（每帧发出后
  used′ ≤ lowWater）；观察点①进入暂停段清零后，暂停进入帧以满额判定（时序自洽，lowWater=1 下进入帧即触发
  ——与合法极端条描述一致）。
- 数字一致：64KiB ÷ ~40B ≈ 1638，与判据/可达性/B-2 三处「≈1600+」同数值；>64KiB 单控制帧（Step2 2MiB /
  BOOTSTRAP 4MiB）暂停段首帧即触发 ✓。
- `lowWater=1` 显式接受 + 运维下界 `lowWater ≥ maxSyncDiffBytes` 落 B-2 ✓（附注见 7.4-3）。

## 7.2 #4–#11 与 I-1/I-4 注记抽查 —— 全部落实、无架构伤（一项牵出 R2-N1）

| 项 | 落实核验 | 结论 |
|---|---|---|
| #4 超限项处置（§5 :332-338） | 「照常入队并按原始字节入账，pull 时大小门 → 0 → F4 消费即丢弃」与代码事实对齐（deliver 入队无大小门 :58-70；sendUpdateFrame 大小门 peer-namespace:715-718）✓；「至少一项」遇超限首项=单项成帧→丢弃、合法项不受牵连 ✓ | ✅（「下轮 pull 必然发生」假设牵出 R2-N1） |
| #5 pullAndSendOne 前置五条（§6.2 :389-394） | live / !needsResync / inFlight<max（明示原 :125-126 循环条件移入单帧前置、「无循环可依托，SA3 不得省略」）/ queued>0 / 闸门开——任一不满足 → false 且**不消费**；§6.1 facet 注释同步 | ✅（返回值语义见 R2-N1） |
| #6 GOAWAY teardown（§8 :494） | `scheduleDrainClose()` close 前补 sender.teardown() + stale fire 防御面（pollHandle 恒 undefined、零副作用、**不重武装**）；锚 :357-365 准确 | ✅ |
| #7 emit 异常收口（§6.3 :442-448） | sendChecked 同款 try/catch 明确覆盖 `host.sendData` 调用；OutboundExhaustedError/编码错统一收敛 seq≤0 → F4；「任何异常不得穿越 drainData/onAck/onMessage/timer 回调栈」；锚 frame-io:173-179 准确 | ✅（F4 收敛路径见 R2-N1） |
| #8 轮转细节注记（§4.5 :308-317） | a 共存带宽/水位兜底、b 游标偏移（非规范二选一，均无饥饿）、c turns 截断非终态（依赖 ACK/ackTimeout 再触发，SA3 不得当终态） | ✅ |
| #9 无迟滞登记（§4.4 :272-274） | Σ==cap 后 1 字节再入队即再 shed；churn 有界；R0-4 无字段可承载迟滞 | ✅ |
| #10 B-2 风暴闭环（§15 :626） | 完整循环（重连→Step2 灌缓冲→暂停→耗尽→1011→重连，每循环 ≤2MiB）+ 终止条件（对端恢复读取）+ backoff baseMs=100→maxMs=30s 全抖动收敛 | ✅ |
| #11 seam 反向风险（§4.2 :185-188 + B-7 :631） | 契约行为定性（非伪降级）成文；B-7 演进位：adapter 启动自检 + 日志/metrics（切片 7/8） | ✅ |
| I-1 注记 a/b/c | §4.5 注记 a/b/c 成文 | ✅ |
| I-4 幂等来源（§4.3 :228-232） | 幂等由连接自身状态守卫保证（connState / failConnectionBackpressure 重入守卫 / enterBlocked :452 / hub closedFlag :345-362）；transport.closed 仅 fast-path、不得作幂等依据 | ✅ |

## 7.3 新伤扫描 —— 恰 1 处（R2-N1，MAJOR → 触发窄幅 reject）

### R2-N1（MAJOR·活性缺陷）：`pullAndSendOne` 对 F4 丢弃返回 false × drainData `!progressed → return` ⇒ 合法排队项可无未来触发地滞留

- **文本锚**：§6.2「`sendUpdateFrame` 返回 seq ≤ 0 → F4 消费即丢弃、**返回 false**（round 修复）」＋ §4.5
  `if facet.pullAndSendOne(): progressed = true` / `if !progressed: return`。
- **触发条件**（逐步可达，无 validate 阻断）：
  1. 本地单笔 update > `maxUpdateBytes`（如缺省 512KiB 的大变更——§5 R2 自己承认「入队路径无大小门」，
     overflows 以 maxQueuedUpdateBytes=4MiB 为界**照常入队**）；
  2. 该项在「窗口满 / 闸门关」时入队（窗口空 ∧ 闸门开时会直发并立即被大小门 F4，不入队）；
  3. 队列中其后存在合法项；
  4. drain 触发（ACK 释放 / 闸门恢复）：pass 1 拉取超限首项（「至少一项」⇒ 合并帧=该单项）→ 大小门
     返回 0 → F4 消费 → **pullAndSendOne 返回 false** → 该 pass 无进展 → **drain 退出**；
  5. 此刻若本 ns 窗口无在途、无进行中 round ⇒ **三个 drain 触发点（onAck/恢复/resetForLive）无一可达**
     ——合法项无限期滞留（仅当未来偶然事件——如任意新写经直发后其 ACK 再触发 drain、或任何 needs-resync
     边沿开新 round——才被解救；静默连接上无界）。
- **对照 #136 语义（此为 R2 文本相对前驱的回归）**：`flushQueued`（update-channel.ts:122-132）是 while 循环，
  F4 丢弃后 `sendAndRegister` 静默返回、**循环继续消费下一项**直至窗口满/队列清空——不存在该搁浅。§10 行 5
  「drain 即『循环 pullAndSendOne 直到窗口满/清空』= 原 flushQueued 循环，帧集合与时序逐帧等价」的等价性声明
  被字面 false-on-F4 打破；§5「其后合法项留队、**下轮 pull** 逐笔正常发出」假设了「下轮 pull 必然发生」——
  正是未被保证的一环。
- **影响**：协议 §10.1「round 完成后发送」的活性承诺在可达输入下被破坏（静默 liveness 缺陷）；四红灯均不含
  超限项形态，**无红灯可捕**——SA3 按字面实现即产出缺陷，且全链测试静默通过。
- **修订要求（一行钉死，二选一）**：
  - **A（推荐）**：`pullAndSendOne` 只要**消费了队列项**即返回 true——F4 丢弃也是队列进展（progressed 语义 =
    队列长度下降），与 #136 flushQueued 循环逐语义对齐，§10 行 5 等价声明随之成立；同 drain 调用内 pass 2
    即拉到合法项发出，搁浅面消除（全超限队列：逐项消费至空，turns 限额兜底，无循环放大）。
  - **B**：保持 false-on-F4，但 drainData 的 progressed 判据改为「本轮 wheel 总 queuedCount 下降」，并在
    §5/§10 行 5 补注与 flushQueued 的差异。
- **红灯思路（R2 版，SA3/SA7 消费）**：`maxUpdateBytes` 配小（如 4KB）+ 窗口 1 + saveGate 扣 ACK → 写一笔
  >4KB（入队）→ 写一笔合法小更新（入队）→ 释放 gate（ACK → drain）→ 断言：合法更新在预算内到达对端收敛
  （settleUntil）且超限项零 UPDATE wire 帧——字面 false-on-F4 实现下该断言红（合法项滞留、hub 不收敛）。

## 7.4 次要注记（非阻塞，可随 R3 一并落文）

1. §10 行 9 的 4 处断言归类精度：ac1-ac2:262 / ac3:112 是 namespace-scope ERROR（经公共 sendControl——
   路径不变），与 ac5-live:141（ready 态 connectionFatal）宜分开表述；结论（零回归）两种理由下均成立。
2. 文末修订自查「13 处」计数与实际枚举（§4.3×4、§15×3 等）略有出入——纯计数口径，无实质影响。
3. §15 B-2 运维下界 `lowWater ≥ maxSyncDiffBytes`（≥2MiB）会连带要求 highWater 同步上调（validate
   `lowWater < highWater`），且数据闸门阈值随之变大——建议补半句「该指导下 highWater 需同步上调保持校验
   通过」，防运维只调一端在构造期 TypeError。

## 7.5 R2 Verdict

**Verdict: reject（窄幅·恰一处：R2-N1）**

- R1 三 MAJOR（#1/#2/#3）修订**全部验证通过**（§7.1，含 §10 行 9 零回归声明的独立重验）；
- #4–#11 与 I-1/I-4 注记全部落实、无架构伤（§7.2）；R2 未推翻任何 D1–D11 决策；
- 唯一残留：R2-N1（F4 丢弃活性搁浅——一行钉死可解：「消费即进展」）。SA1 落 A 或 B 任一修订后，本 SA2
  可**仅对 diff 复核并直接改判 pass**，无需再全量攻击。

> 边界重申（同 R1）：`pass` 不替代 SA4/SA7 验证；R2-N1 红灯思路与 7.4 注记是 SA3/SA7 的直接输入。

---

# §8. R3 复审（2026-08-28 追加；diff-only·按 R2 承诺，对象 677→715 行）

> 复审范围（R2 §7.5 承诺）：仅核验 R2-N1 落实（采方案 A）+ 7.4 三条次要注记 + diff 新伤扫描。
> 方法：逐处读取 R3 落文（§4.5×2 / §5 / §6.1 / §6.2 / §10×2 / §15 B-2 / 文末自查与 R3 回应表），
> 对照 R2 §7.3 的修订要求逐字核验；未重跑全量攻击（R1/R2 存活面结论不因文本级钉死而改变）。

## 8.1 R2-N1 落实核验（方案 A）—— ✅ 通过

| 要求（R2 §7.3 修订要求 A） | R3 落文 | 核验 |
|---|---|---|
| `pullAndSendOne` 消费 ≥1 项即返回 true（F4 丢弃也是进展）；false ⇔ 前置任一不满足（未消费） | §6.2 :406-411：「取帧后……返回 true；`sendUpdateFrame` 返回 seq ≤ 0 → F4 消费即丢弃、**仍返回 true**（返回值语义 = 是否消费了 ≥1 队列项，而非是否发出帧；false ⇔ 前置任一不满足（未消费））」＋活性成因与 #136 对齐依据（`update-channel.ts:122-132` F4 后继续消费）内联成文 | ✅ 与修订要求逐字对应；二分完备（每次调用要么消费 ≥1 → true、要么零消费 → false，无第三态） |
| §4.5 progressed 语义 = 队列长度下降；同 drain 后续 pass 即拉合法项（不依赖未来触发点）；全超限队列同 drain 逐项消费至空（单调收敛 + turns 兜底） | §4.5「进展语义」新条 :297-305 + 伪代码 :291 注释（true ⇔ 消费 ≥1 项）+ :294 退出注释改「全轮**零消费**（窗口满/live 门槛未过/闸门关）」 | ✅ 三点全落；「三个触发点无一可达 ⇒ 静默连接无限期滞留」的缺陷成因如实成文（非掩盖式修订） |
| §5「下轮 pull」→「同一次 drain 的后续 pass」 | §5 :348-349：「其后合法项留队、**同一次 drain 的后续 pass**（F4 消费即进展……**不依赖任何未来触发点**）逐笔正常发出」 | ✅ 原「下轮 pull 必然发生」的无依据假设已替换为保证成立的结构性论证 |
| §10 行 5 等价性补强（含超限项形态） | §10 行 5 :551：「等价性在 F4 路径上同样成立——pullAndSendOne『消费即进展』与 flushQueued 循环 F4 后继续消费下一项逐语义对齐——含超限项形态（超限项消费后续 pass 拉合法项，不依赖未来触发点）」 | ✅ R2 指出的等价性声明缺口闭合 |
| §6.1 facet 注释同步（五处同口径） | §6.1 :369：「true ⇔ 消费 ≥1 项（F4 丢弃也是进展，R3）」 | ✅ §4.5（条 + 伪代码）/§6.1/§6.2/§5/§10 行 5 全部同口径 |

**搁浅场景重演（R2 §7.3 触发条件 1–5 逐walkthrough）**：queue=[超限, 合法]、窗口空、闸门开、live——
drain pass 1：前置五条全过 → 贪心「至少一项」取超限首项成帧 → 大小门 0 → F4 消费 → **true**（progressed）→
pass 2：拉合法项 → 发出（true）→ 窗口满/队列空自然退出。**合法项在同一次 drain 内到达 wire，不依赖任何未来
触发点——搁浅面消除**，与 #136 flushQueued（:122-132 循环 F4 后继续）行为对齐 ✓。全超限队列：每 pass 消费
≥1 项（单调收敛），上限 maxQueuedUpdateCount（缺省 256 / 测试 ≤1000）≪ DRAIN_TURN_LIMIT(10_000)，无循环
放大 ✓。

## 8.2 7.4 三条次要注记核验 —— 全部落实

1. **7.4-1（§10 行 9 归类精度）** ✅ :555 重写为两类：namespace-scope ERROR ×3（ac1-ac2:262 / ac3:112 /
   r3-r4:212——经公共 `sendControl`，**路径分离**、与连接状态无关）+ ready 态 peer connectionFatal ×1
   （ac5-live:141——现流程门放行、直发同帧零 delta）。与本报告 R2 §7.1 #2 的独立重验结论逐字一致。
2. **7.4-2（计数勘误）** ✅ :688-689：「13 处」勘误为 19 处，标注漏计来源（§10 行 8 改写与 §15 B-6/B-7
   分列）。
3. **7.4-3（B-2 运维联动）** ✅ :641：补「该指导下 highWater 须同步上调（validate `lowWater < highWater`，
   只调一端在构造期 TypeError；数据闸门阈值随之变大属预期代价）」。

## 8.3 diff 新伤扫描 —— 无新伤

- **二分完备性**：true/false 语义无交叠无缺口（见 8.1 第一行）。
- **与 R2 前置五条的相容**：§6.2 :400-401「任一不满足 → 返回 false 且不消费」未动，与 :407-409 的
  false 分支定义吻合；无「消费了但返回 false」或「未消费但返回 true」的矛盾态。
- **帧间复查不变**：pass 内 `if paused ∨ !isEmitAllowed(): return`（:292）仍在每次 pull 之后执行——F4 pull
  （无帧发出）后照常复查；暂停再入时队列残余由 poll 恢复（暂停段 timer 必武装）兜底，无新洞。
- **红锚不受扰**：四红灯走查形态均为合法项（每次 pull 皆发帧）——「消费即进展」与「发帧即进展」在这些
  形态下重合，`[a,b,a,b,a,b]` / AC-2 合并 / AC-5 shed / AC-6b 恢复的确定性推演逐值不变（§9 未动，R3 回应表
  自查 ①「无架构与行为面变更」成立——方案 A 是把 R2 文本对齐到 #136 既有活性语义）。
- **R3 回应表 :713-715 声明**「R2 版红灯（超限项+合法项+settleUntil 收敛）在方案 A 下转绿」——核验属实：
  该用例从「捕获缺陷的红灯」转为「锁定活性的守卫」，SA7 应按转绿形态纳入。
- D1–D11 零改动、§14 文件清单零变化、结构/锚点保持（R3 落文 6 处均在 R2 已改节内）✓。

## 8.4 R3 Verdict

**Verdict: pass（最终）**

- R2-N1（唯一 reject 原因）按本报告 R2 §7.3 修订要求 A 逐字落实，五处同口径，搁浅面消除并附结构性论证；
- 7.4 三条次要注记全部落实；diff 复审零新伤；D1–D11 零改动；
- 三轮攻击评审累计：R1 存活面（架构/I-1~I-4 读法/四红灯走查/回归论证主体/P-1~P-8/无虚假降级）+ R2 修订
  （#1–#3 MAJOR、#4–#11、I-1/I-4 注记）+ R3 钉死（R2-N1）——设计文本在 SA3 可确定性正确实现的精度上闭环。
- **放行：路由 → SA3 TDD 实现。**

**移交 SA3/SA4/SA7 的直接输入**（汇总）：F1–F9 红灯思路（§5）+ R2-N1 转绿守卫用例（§7.3/§8.1）+
SA4 静态守卫锚（F7 emit 异常调用链 grep、§13 内部 seam 变更四项比对）+ SA7 动态验证配方（§4.3 可达性
≈1600+ ACK / >64KiB 单控制帧 / lowWater=1 极端、F2 handshaking fatal 新语义、B-2 风暴闭环终止条件）。

> 边界重申（末次）：`pass` 仅表示设计通过 SA2 攻击评审；SA4 静态验尸与 SA7 活链路验证独立进行，不受本
> 裁决替代或预支。
