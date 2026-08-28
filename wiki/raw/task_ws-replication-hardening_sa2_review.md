# SA2 攻击评审报告 — issue #161 ws-replication 协议/生命周期加固设计（R1）

**Date**: 2026-08-29
**Verdict**: **reject**（3 项 CRITICAL + 2 项 HIGH；核心方向正确、§1/§2/§4/§5 组闭合论证经独立推演成立，但 §3 背压组的核心机制伪码与自身演练/红灯锚矛盾，§1.1 存在一处未察觉的恒红灯锚。修订后可快速复审。）

**评审对象**: `wiki/raw/task_ws-replication-hardening_design.md`（R1，2026-08-28）
**审查方法**: 全新视角独立复核——逐节对照 worktree 源码（`packages/ws-replication/src` 全 15 文件 + `namespace-runtime/src/replication-session.ts` + `namespace-registry/src/testing.ts`）、协议全文（§2/§6/§8.2/§9.4/§12/§13.1/§14/§15.1/§16/§17/§18/L40）、SA6 两红灯测试文件与 `test/harness.ts`/`test/driver.ts`、相关决议 ADR 条款；红灯基线本人复跑确认（`./node_modules/.bin/vitest run packages/ws-replication` → **15 failed / 82 passed / Type Errors none**，与 SA6/SA1 记录一致）。

---

## 一、攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议修订 |
|---|--------|--------|---------|---------|
| A1 | **CRITICAL** | §3.4 水位检查点起挂条件（G3.5） | `ensureCheckpoint()` 守卫 `if (!this.paused && this.queuedDataCount() === 0) return` 使「队列即时排空、字节滞留 socket 缓冲」的首个 highWater 越线**永不可观测**：首帧入队 → drain 全量派发（未暂停）→ 队列空 → 不挂 checkpoint → `paused` 永不置位。这与设计自己的 §3.6 演练（「dispatch a1（buffered≈8KiB）→ checkpoint(100ms)：buffered ≥ highWater → paused」）直接矛盾——按守卫，该 checkpoint 根本不存在。后果：(a) 生产 canonical 慢 socket 场景（入队即派发、缓冲持续增长）背压完全失效，bufferedAmount 无界增长；(b) **AC5-WATER / AC5-PRI 在本设计伪码下恒红**（两测试均依赖首帧派发后的第一个 `advanceBy(100)` 观察到暂停；本人按伪码逐帧推演：WATER 断言处仍 dispatch 3 笔 UPDATE、PRI 仍 dispatch 2 笔，与当前红灯输出逐字相同）。`enqueueData` 尾注释「有数据在途 → 保证水位检查点在挂」的「在途」意图未被守卫实现（守卫只看「排队」，不看「已派发未冲刷」）。 | 起挂条件改为 `paused \|\| queuedDataCount() > 0 \|\| bufferedAmount() > 0`（或：本轮 drain 有数据帧派发即挂）。零空闲 timer 纪律不变（buffered 归零且队列空即不再续挂）。修订后必须重推 §3.6 演练与 AC5-WATER/PRI/SHED 三锚。 |
| A2 | **CRITICAL** | §3.1/§3.2 shedding 触发与停机阈值（G3.3） | 两层缺陷叠加使 **AC5-SHED 恒红**：(1) **伪码与文本自相矛盾**——§3.1 `enqueueData` 的 while 守卫是 `queuedDataBytes + bytes > maxQueuedBytesPerConnection`（ shed 到能塞进 **max** 即停），§3.2 文本与协议 §17 L490（「直到回到低水位」字面）却要求 shed 到 **lowWater** 以下。二者择一，另一处即违反 L490。(2) **enqueue 侧核算对 socket 缓冲不设防**——AC5-SHED 构造中 64 笔写入连续发生（循环内只有 `settle()` 微任务、无 `advanceBy`），checkpoint 从未运行 → `paused=false` → 每次 enqueue 即时排空 → `queuedDataBytes` 恒≈0 → shedding 循环永不触发；全部字节滞留 `held`（buffered≈512KiB ≫ 64KiB）却无任何 shed 信号。(3) **规则 C 结构性不可达**——`runCheckpoint` 的 else-if 链中规则 A 先于 C，而 `validate.ts` 只校验 `lowWater < highWater`、不校验 `highWater < maxQueuedBytesPerConnection`（SHED 配置 4KiB < 64KiB 满足蕴含：buffered > max ⇒ buffered ≥ highWater），首个 checkpoint 只置 `paused=true`、C 被跳过；测试在 releaseAll 后**再无 advanceBy**，第二个 checkpoint（唯一能评估 C 的时机）永不运行 → `resyncCount + backpressureCount === 0`，红灯原样。 | 明确「总队列」的记账口径为 **queuedDataBytes + bufferedAmount()**（socket 缓冲即传输队列的延伸，SA6 慢 socket wire 的 `bufferedAmount` 语义即为此设计；这也让规则 C 获得自然依据）；统一双阈值语义：**触发在 > max，持续 shed 到 ≤ lowWater**（触发/停机滞回，两处文本+伪码同步修正）；规则 C 与规则 A 改为并列评估（或 C 前置），并补 `highWater ≤ maxQueuedBytesPerConnection` 的构造期校验。修订后重推 AC5-SHED 全程。 |
| A3 | **CRITICAL** | §1.1 AC1 红灯闭合论证（G1.1/G1.2） | 设计声称 SA6 AC1 三断言全部 ✓，但**第二锚在本设计实现下不可满足**：`connectionFatal('INSTANCE_IDENTITY_MISMATCH', 1008)` → `state='closed'` → `void cleanupAll()`——此时零 channels，`Promise.all([])` ≈2 跳后即 `dropConnection(connection)` 把连接从 `hub.connections` 摘除；测试在断言前做了**两次 `settle()`（600 跳）**，断言 `hub.connections[0]?.state` 时列表已空 → `expect(undefined).toBe('closed')` 恒失败。当前红灯先死在第一锚（spy.calls=1），掩盖了此问题；修复后第一锚转绿、第二锚接棒变红。设计对 AC1 的逐断言验证是纸面推演，未走完 cleanup 生命周期。 | 二选一并写入设计：(a) 规定 fatal 后连接在 `connections` 中的可观测保留策略（如 dropConnection 延后到 `close()`/transport-close 结算，或 fatal 路径保留条目直至宿主显式清除）；(b) 将 AC1 第二锚列入与 §3.7 同类的「测试构造裁决」清单（改为断言 `hubSideClosed` close code 1008 + ERROR 码 + `connections.length` 收缩）。不得留待 SA3 现场发现。 |
| A4 | **HIGH** | §3.7 AC5-RR 裁决请求的替换构造 | 裁决请求本身**成立**（见下「§3.7 裁决」），但设计给出的替换测试代码自身有缺陷：`releaseAll()` 后 **gate 仍为 true**，恢复 drain 派发的 b1/a2/b2 经 `hubEnd.send` 全部进 `held` 而非 `deliveredToPeer`（`makeGatedWire` 语义：gated → held），最终 `updates === [a]` ≠ `[a,b,a,b]` → 该构造下 AC5-RR 仍恒红。SA1 未按自己的 §3.6 语义走完 harness 投递路径。 | 替换构造补 `run.wire.setGate(false)`（置于 releaseAll 前；随后 a1 由 releaseAll 送达、b1/a2/b2 由恢复 drain 即时送达，序恰 `[a,b,a,b]`——本人按游标语义逐帧推演确认），或改为二次 `releaseAll()`。断言面不变。 |
| A5 | **HIGH** | §3.5 交互表「ACK 超时」行 / dropData 接线 | 表格写「hub: declareHubResync 时 dropData(ns)（经 markResyncReceived 路径）」——`declareHubResync` **不经** `markResyncReceived`（后者是对端 RESYNC 帧的入站处理器 `hub-namespace.ts:520-524`）；§3.1 只把 `dropData` 挂进 `markResyncReceived`/`markSessionResyncEdge`。hub 自声明路径（本地队列溢出 `onLocalResyncEdge`、ACK 超时 §2.3）是否丢弃连接级已排队数据**未定义**：§9.4「已接纳 update 正常 apply/ACK」暗示保留、§10.1「声明后丢弃」暗示丢弃，两义并存。SA3 按错误接线实现会产生行为分叉。 | 明确单一语义并修正表格：建议「自声明（溢出/ACK 超时）保留已 handoff 数据帧（属 §9.4 已接纳面，由 zombie/ACK 纪律收尾）；对端声明（markResyncReceived）与 session 边沿丢弃（§10.6）」——与既有 peer 侧 queued[] 语义对称；或反之，但须给协议依据。 |
| A6 | **MEDIUM** | §2.4 ACK 计时器锚点声明与实现不符 | 文本声称「锚点语义精确为『最老剩余在途的发送时刻预算』」，实现却是在**被 ACK 的前一最老的 ACK 到达时刻** disarm+arm。最老剩余在途帧实际获得 `[t_ack, t_ack+T]` 预算 ⊇ `[t_send, t_send+T]`（无 clock seam 时发送时刻不可锚定）。方向上宽松无害（超时是活性启发而非正确性期限，§18 无逐帧 deadline 语义），但「精确」声明为假。 | 措辞改为「以最老剩余在途的上一次观测点（前一最老的 ACK 时刻）为锚的下界近似」，或补注入 clock seam 实现真正发送时刻锚定。验收措辞「correctly re-armed」按近似语义重述。 |
| A7 | **MEDIUM** | §3.1 窗口记账不变量 & sendData 丢弃路径 | (1) `deliver` 门改为 `inFlight + pendingData < max`，但 `flushQueued()` 仍只查 `inFlight`——pendingData 占用时继续 handoff 可突破 maxInFlightUpdates 窗口（有连接级字节预算兜底，但设计自设的不变量被自己的 flush 破坏）。(2) 新 `sendData(message): void` 无返回值/无丢弃回调：B-2e 非 ready 丢弃、transport 已关、`emitOne` 抛 `OutboundExhaustedError`/编码错等路径上 `pendingDataCount` 无扣减规定（仅 §3.5 的 teardown 清零兜底）；「编码错由 sendChecked 同族收编」一笔带过，无具体机制。 | flushQueued 循环条件纳入 pendingDataCount；明确规定：连接层任何丢弃（非 ready 门、dispose、异常）必须回调 `onDataShed(namespaceId)`（或 sendData 返回丢弃信号），保证 pendingData 记账在 dispatch/shed/teardown 三之外无第四种出口；错误传播路径写明捕获点。 |
| A8 | **LOW** | 章节交叉引用错乱 | 「见 §3.5 规则 C」应为 §3.4；§11 #8 称「§3.7 已论证其对 AC5-SHED 前提的必要性」——§3.7 只论证 AC5-RR，未涉及 SHED。 | 修引用；无行为影响。 |
| A9 | **LOW** | §3.3 规则 C 的阈值口径 | 以 `maxQueuedBytesPerConnection` 兼作 socket 缓冲 1011 判定阈值属未注明的解释性选择（协议 §13.1/§14 只给 1011 语义无数值）。若采纳 A2 的「queued+buffered 合记」，此口径自然成立，但仍应在设计里写明这是解释。 | 一句话注明口径来源；随 A2 一并解决。 |
| A10 | **LOW** | §5.1 缺省数值 | `pingIntervalMs=30_000`/`pongTimeoutMs=10_000` 无协议/ADR 数值锚（§18 只列配置项，ADR L165 只说「安全默认值」）。数值合理但属工程发明。 | 注明「工程缺省，协议无数值规定」；`pongTimeout < pingInterval` 的构造期响亮校验保留。 |
| A11 | **LOW** | 生产能力缺省的静默 dormant | `bufferedAmount`/`ping`/`onPong` 缺省 dormant 对包内内存 transport 是正确语义（能力真缺失，非掩盖 bug——不构成虚假降级）；但切片 9 真实 adapter 若漏暴露 `bufferedAmount`，G3.4 背压在生产**静默不存在**且无任何信号。 | 在 `DuplexTransport` seam 注释与 G6 澄清表中写明「生产 adapter 必须暴露 bufferedAmount（及 ping/onPong）」；可选：宿主装配期一次性 loud 断言留给切片 9 票面。 |

**独立复核通过、无需修订的面**（供总控与 SA3 参考，非背书性内容）：
- §1.2 代际闸 + 退订：与源码逐行对得上（`peer-connection.ts:199-200` 闭包共享、退订丢弃、`expectedSeq=1` 重置）；AC2a/AC2b 闭合推演成立；hub 侧对称补齐合理；「迟到事件静默丢弃是正确语义而非虚假降级」判断正确（§13.4 域）。
- §2.1/§2.2 违例策略选型（BOOTSTRAP_ACK 错配 fatal 1002 / CLOSE_OK 错配保持 closing 交 closeTimeout）：均有协议与 SA6 契约双锚（契约 L62-64 明示两种等价锚），AC3a/AC3b 闭合成立。
- §2.3 复用 `declareHubResync` 记忆化：机制存在性、调用面（溢出/watchdog 边沿）、`resyncDeclared` 清零点核实无误；AC4-1/AC4-2 闭合成立（peer `onResyncReceived` 同步 `maybeStartRecovery` 不经 defer seam，`peer-namespace.ts:418-423` 证实）。
- §4.1–§4.5：同步 closing 窗口关闭论证（apply 接纳同步登记，两侧函数首段首个 await 前同步——源码证实）、§4.3 白名单含 needs-resync 的理由（AC4-2 收敛依赖）、§4.4 对 sa7 G1/G2 两锚的保持（本人核对 `ws-replication-sa7-dynamic.test.ts:180-227`：RESTARTING drain 期 ready + SHUTTING_DOWN blocked 不关 socket——`enterBlocked` 不关 transport 证实）、§4.5 waiter 必答——AC6-1..4 闭合推演全部成立。
- §5.2：512 跳常数溯源（`> 303 = advanceBy 3 跳 + settle 300 跳` 且 `< settleUntil 3000`）与 driver 注入方案自洽；生产缺省单微任务更贴近 §10.4 字面；SA6 两红灯文件不注入 defer 的影响面核对（AC4-2 走同步路径、AC6-3 走 boot）正确。
- §5.3 死抽象清单：本人 grep 全部证实（`LifecycleQueue`/`NamespaceChannelCore` 仅自身定义；hub `cleanupTail` 仅声明；`OutboundQueue.sendData` 零调用者；src `queueMicrotask` 恰两处生产命中）。
- §6 G6 澄清三项与 SA5 一致，resetReplica 归属判断有据（ADR-0006 L211）。
- §12 契约审计：`accept(` 调用点 grep 穷尽性证实（4 处 dot-call + g1-g2 `accept.call` 形态）；「无 throw 契约反转」论证成立；`onCloseOk` 唯一 dispatch 点证实。
- DENY LIST 无违反：replication-protocol/namespace-runtime/namespace-registry/persistence/apps/harness.ts 均不触碰；ADR-0008 L93 无条件排空、ADR-0009 L42/L150、#134 R2-3 冻结常量（fanout 16/20）未被扰动；「网络背压不进 Runtime sequencer」（ADR-0010 L151）在 §3 层级模型中保持。

---

## 二、协议假设依据审查（2026-06-13 立法）

**章节存在性**：✅ §11 存在，14 条假设逐条给出依据类型与具体引用。

**依据可验证性抽查**（本人逐条可定位复核）：
- #1/#2/#5/#6/#7/#11/#13 的协议行号引用全部命中（§6.1 L120、§2 L36、§9.4 L248、§17 L490-492、L40、§15.1 1011 分类等，与 `docs/protocols/instance-replication-v1.md` 现文逐字一致）。
- #3 的 UPDATE_ACK 先例链（`update-channel.ts:74-86` → `hub-namespace.ts:492-499` fatal 1002）源码证实；SA6 AC3a 断言面（g1-g2 文件 L172-173）证实。
- #9 `advanceBy` 到期序语义：`namespace-registry/src/testing.ts` L74-105 证实（`at <= deadline` 按到期序执行 + 每 timer 3 跳微任务展开）。
- #10 fanout 20 跳 + settle 300 跳：`replication-session.ts`（`FANOUT_DELIVERY_DEFERRAL_MICROTASKS = 20`）与 `harness.ts:215-219` 证实——**这是 §3.7 裁决请求的支柱，成立**。
- #12 `toMatchTypeOf` 单向赋值：`api.test-d.ts` L41-56 形态证实；TS 可选成员加性兼容论证正确。
- 声称「实测验证」处（红灯基线 15/82）：本人独立复跑一致 ✅。

**缺陷**：#8/#14 的风险评级未覆盖 A1/A2 类内部矛盾（假设表断言 100ms 检查点「必达」，却未验证检查点会被起挂/会评估规则 C）——即依据表本身合格，但**设计伪码与依据表之间的行为一致性未被 SA1 自验**，A1-A3 三处恒红灯锚均属此类。

---

## 三、错误处理链路审查（2026-05-07 立法）

- **静默失败**：§1.1 `accept` 缺身份 → 构造期响亮 TypeError ✅（正确拒绝虚假降级：受信身份在正常宿主接线中恒存在，缺失=上游 bug）。缺口一处：A7——新 `sendData` 丢弃路径（非 ready 门/异常/收口）无记账回调，属设计层面的静默吞帧面，须补 `onDataShed` 或返回值契约。
- **状态闭环**：closing/closed/conflicted/blocked 全部失败路径有终态归宿（closeTimeout 兜底、enterBlocked 收口、settleClosingOpenWaiters 必答）✅；§4.4 GOAWAY 两条分支（blocked / deadline close）均到终局 ✅。
- **降级路径**：内存 transport 无 bufferedAmount/ping 面 → dormant 属真实能力缺失（正确降级，非伪降级）✅；但见 A11 生产静默无背压风险，建议 seam 显式声明。
- **虚假降级识别**：未发现以降级掩盖 bug 的设计。两处「静默」均有正确性依据——§1.2 迟到帧静默丢弃（§13.4 结构性迟到域）、§2.2 错配 CLOSE_OK 静默保持 closing（丢包容错语义，有 §12 L312 依据）。身份缺失不降级、直接 fatal 的选型符合立法精神。

---

## 四、§3.7 AC5-RR 测试构造调整请求：裁决

**裁决：请求成立（GRANTED），附一处强制修正。**

1. **原构造在规约合规实现下确不可通过**——独立验证：hub UPDATE 产自 fanout 泵（每项投递前让步 20 微任务），`writeHubNs` 内含 `settle()`=300 跳，四帧入队时刻相隔 ≥ ~335 跳，任何「入队即 drain」的贪心实现（含本设计）下任何两帧从不同时在队，wire 序 = 写入序 `[a,a,b,b]`；红灯基线的失败输出（`expected [ …(4) ] to deeply equal`）与 SA6 契约记录的 `A,A,B,B` 一致。
2. **断言语义与互斥论证成立**——round-robin 公平性（§17 L490「每轮每 ns 至多一个」）只约束同时排队帧；单 ns 独占队列退化为 FIFO 是正确行为，「为凑 `[a,b,a,b]` 而等待静默 ns」的实现会饿死 AC5-WATER（单 ns 写 + 双 ns 连接）的首帧派发前提（`bufferedAmount ≥ 4096` 断言要求首帧已 dispatch）。两测试构造确实互斥。
3. **唯一能翻红为绿的替代实现是入队防抖延迟环**——正是 G5.2 明令删除的反模式。拒绝该实现正确。
4. **强制修正（=A4）**：SA1 给出的替换构造漏 `setGate(false)`——`releaseAll()` 不解除 gate，恢复 drain 的 b1/a2/b2 进 `held` 不进 `deliveredToPeer`，`updates=[a]` 仍红。修正后（releaseAll 前 `setGate(false)`）本人按游标语义逐帧推演为 `[a1,b1,a2,b2]`，断言面与原 AC5-RR 完全一致。**该修正须并入 SA6 调整单**。
5. 附带要求：A1/A2 修复前，调整后的 AC5-RR 同样无法通过（暂停机制本身失效）——SA6 调整应在 SA1 修订稿复审通过后一次性下发，避免二次返工。

**同类新裁决项（=A3）**：AC1 第二锚 `hub.connections[0]?.state === 'closed'` 在 fatal+cleanup 生命周期下不可满足（连接被 dropConnection 摘除），须与 §3.7 并列为测试构造/设计补规定裁决，由总控批转。

---

## 五、红线测试思路（每漏洞对应的 IT 编写方向）

- **A1（检查点起挂）**：`AC5-WATER`/`AC5-PRI` 本身即红灯（保留不动即可验）。另补一个更早失败的窄锚：gated transport + 单 ns 单笔写（首帧即派发、队列空）→ `advanceBy(100)` → 再写一笔 → 断言第二笔 **零 dispatch**（`dispatchLog` 增量无 UPDATE）。该锚在 A1 未修时红、修后绿，直接钉死「派发后 buffered>0 必须挂检查点」。
- **A2（shedding 口径与规则 C 可达性）**：`AC5-SHED` 保留。补两例：(a) 滞回锚——构造 paused 期排队超限（先 `advanceBy` 置停再突发），断言 shed 后**剩余 queuedDataBytes ≤ lowWater**（钉死停机阈值不是 max）；(b) 单检查点 1011 可达锚——gate + 突发使 buffered > max 且队列已排空 → 单次 `advanceBy(100)` 后断言 wire 上出现 `CONNECTION_BACKPRESSURE` ERROR 或连接 1011 收口（钉死规则 C 不依赖第二次 checkpoint）。
- **A3（AC1 第二锚）**：按裁决方向二选一——若改测试：断言 `oldWire`/wire 的 `hubSideClosed` close code=1008 + `hubFrames('ERROR')` 含 `INSTANCE_IDENTITY_MISMATCH` + `hub.connections.length === 0`（drop 语义下 0 反而是正确收口证据）；若设计补保留策略：断言 fatal 后同 tick 内 `connections[0].state === 'closed'` 且随 `hub.close()` 结算后才摘除。
- **A4（AC5-RR 替换构造）**：按修正稿（`setGate(false)` → `releaseAll` → `advanceBy(100)`）执行，断言 `updates` `[a,b,a,b]` 不变；另断言 `dispatchLog` 中暂停窗口内 UPDATE 数为 0（前置锚防误判）。
- **A5（dropData 语义）**：hub 侧 ACK 超时（`ackTimeoutMs` 压小 + saveGate 悬挂 peer apply）且 hub 数据面有未发送排队帧（先置暂停）→ 断言 RESYNC_REQUIRED 发出后，恢复 drain 时该 ns 排队 UPDATE 的派发行为与设计声明的语义一致（保留则 zombie 路径 ACK 容忍、丢弃则 `dispatchLog` 无该批 UPDATE）——以设计最终选型定断言方向。
- **A6（ACK 锚点近似）**：三帧窗口，慢 ACK 第一帧（t=T-ε 到达）后第二帧在窗口内不被 `abandonInFlight` 整窗弃置（连续流量下不再周期性假性 needs-resync）——即 AC 既有「re-arm」行为锚，附加断言：从第二帧派发起 `ackTimeoutMs` 内到达的 ACK 记为 ok 而非 zombie（锚点宽松方向的容忍面）。
- **A7（窗口记账/丢弃回调）**：(a) 压满 pendingData（paused 期大量入队）→ 触发 `flushQueued`（ACK 到达/round 完成）→ 断言任一时刻 `inFlight.size + pendingData ≤ maxInFlightUpdates`（经 dispatchLog 与 ACK 帧序差分推算）；(b) 非 ready 期（重建窗口）注入 deliver → 断言随后 `pendingData` 归零路径被触发（如恢复后窗口满额可用，而非永久缩水）。
- **A8–A11**：文档级修订，无独立红灯；A11 可选加装配期断言测试（transport 无 bufferedAmount 时宿主侧显式告警/抛错——若采纳）。

---

## 六、结论

- **Verdict: reject**。修订集中在：§3.4 起挂条件（A1）、§3.1/§3.2 shedding 双阈值与 buffered 计入口径 + 规则 C 可达性（A2）、§1.1 AC1 锚裁决（A3）、§3.7 替换构造 gate 修正（A4）、§3.5 表格与 dropData 语义定案（A5）；A6/A7 措辞与不变量补正；A8–A11 顺手修。
- 设计的**根因定位、修复组映射、ADR/协议锚定、§1/§2/§4/§5 组闭合论证、DENY 边界纪律均经独立验证成立**；败笔集中在 §3 组「伪码—演练—红灯锚」三角未做行为级自洽推演，以及 §1.1/§3.7 两处红灯锚的纸面验证未走完生命周期/投递路径。修订上述各项并补一轮「每个红灯锚在设计伪码下逐帧转绿」的自证后，可进入快速复审。
- `pass` 判断保留给修订稿；本报告不替代 SA4/SA7 对实现与活链路的验证。

---
---

# SA2 R2 复审 — issue #161 ws-replication 加固设计（R2 修订版）

**Date**: 2026-08-29
**Verdict**: **pass**（A1–A11 全部闭合，§3.8 两项裁决最终形态可一次性下发 SA6；附 1 项交接前机械修订（NB1）与 2 项强制转达 SA3 的实现注意（NB2/NB3），均非架构性变更。）

**评审对象**: `wiki/raw/task_ws-replication-hardening_design.md`（Status: R2，2026-08-29）
**复审方法**: 对 R2 全文重读 + 对重写的 §3 组伪码独立逐帧重推全部 AC5 锚 + 对两项裁决的替换构造按 harness 实际 API（`setGate/releaseAll/dispatchLog/deliveredToPeer/hubSideClosed`）走完投递路径 + 对 R2 新增面（`pipelineBytes` 滞回、规则 C 并列评估、`validateLimits` 链尾、B-2e onDataShed 化）核对既有绿灯兼容性（含 `ws-replication-ac7-faults.test.ts:192-220` 的构造期校验锚——其合法边界配置 `lowWater:256/highWater:512` 满足新链 `512 ≤ 8MiB`，既有断言零影响，§8.8 声明经实测证实）。

## 一、A1–A11 逐条闭合核验

| # | R1 要求 | R2 落点 | 独立复核结论 |
|---|---------|---------|-------------|
| A1 | 检查点起挂条件补「派发后 buffered>0」 | §3.4 `ensureCheckpoint` 守卫 = `paused ∨ queued>0 ∨ bufferedAmount()>0`；§3.6 演练补「buffered(40B)>0 → 挂 ✓」 | ✅ **闭合**。本人按 R2 伪码逐帧重推 AC5-WATER（首帧派发→checkpoint 起挂→advanceBy(100) 规则 A 暂停→3 笔零 dispatch→releaseAll→规则 B 恢复→收敛断言经首帧成立）与 AC5-PRI（暂停期 UPDATE 零、UPDATE_ACK 经控制路径即时入 dispatchLog）——两锚均转绿，与 R1 判恒红的推演差异恰为起挂条件一处，修复定位精准。空闲三条件皆空不挂，N1 纪律保持。 |
| A2 | 总队列计入口径 + 双阈值滞回 + 规则 C 可达性 + 链式校验 | §3.1 `pipelineBytes() = queuedDataBytes + bufferedAmount()`；触发 `>max` / shed 到 `queued ≤ lowWater`（R1「shed 到 max」循环删除并自认错误）；§3.4 规则 C 脱离 else-if 链独立评估；`validateLimits` 增 `highWater ≤ maxQueuedBytesPerConnection`；§3.2 单帧超限病态配置边界 | ✅ **闭合**。AC5-SHED 逐帧重推：循环期无 advanceBy → 恒未暂停 → 每帧即时派发（触发条件自第 ~9 笔为真但 `queued=0 ≤ lowWater` → 无可 shed 面 → 按断点接纳）→ held≈512KiB；单次 `advanceBy(100)` 内规则 A 与 C **同点评估**（512KiB>64KiB 且队列空）→ `CONNECTION_BACKPRESSURE`(1011) best-effort ERROR 入 held + close(1011)；`releaseAll` 后 delivered 含该帧 → 断言 ≥1 成立。滞回语义与协议 §17 L490「直到回到低水位」字面一致；新链式校验经 ac7 既有配置实测兼容（§8.8 声明证实）。peer 对 1011 的 backoff 分类不产生帧计数噪声（§11 #13 复用）。 |
| A3 | AC1 第二锚不可满足 → 设计补规定或测试锚裁决 | §1.1 + §3.8 裁决 2：**保留 prompt-drop 生产语义**（选型 (b) 测试锚替换：`wire.hubSideClosed === true` + `hub.connections).toHaveLength(0)`；锚 1/3 不变） | ✅ **闭合**。选型正确（不为测试扭曲生产生命周期；「滞留死条目」的反例论证成立）。锚可行性独立验证：`hubSideClosed` 读 `pair.right.closed`（`harness.ts:690`），`connectionFatal` 同步 `transport.close(1008)` 即真——无微任务依赖；`dropConnection` ≈2 跳 vs 测试 600 跳 settle → `connections.length===0` 确定性成立。g1-g2 文件在 ALLOW 清单中正确从「预期零改动」改列为调整面（§10）。 |
| A4 | AC5-RR 替换构造漏 `setGate(false)` | §3.8 裁决 1 替换构造补 `run.wire.setGate(false)`（置于 releaseAll 前），并注明漏此步则 `updates=[a]` 仍红 | ✅ **闭合**。本人按 R2 伪码 + gated wire 语义逐帧重推：a1 派发（buffered 40B>16 起挂）→ 暂停 → [a2]/[b1]/[b2] 排队（前置锚 0 dispatch ✓）→ `setGate(false)`+releaseAll（a1 送达，buffered→0）→ 规则 B 恢复 → 游标在 B → 轮 1 b1、a2 / 轮 2 b2 即时送达 → `deliveredToPeer` UPDATE 序 `[a,b,a,b]`、长度 4 ✓。boot 期无 UPDATE 帧混入（bootstrap/reconcile 均非 UPDATE kind）✓。断言面与原 AC5-RR 完全一致 ✓。 |
| A5 | §3.5 表格接线错误 + hub 自声明丢弃语义未定案 | §3.5 重写为五族触发面矩阵（溢出族丢 / ACK 超时族**保留** / 对端声明丢 / session 边沿丢 / 连接级 shed），逐行协议依据；接线点枚举（ACK 超时面不接 dropData） | ✅ **闭合**。定案语义自洽：「ACK 超时保留」与 §9.4「已接纳 update 正常 apply/ACK」+ §18 无丢弃面一致，恢复 round diff 超集幂等覆盖（yjs 幂等）——与既有 peer 侧 queued[] 行为对称；「溢出族丢」对齐协议 §17 上半节「丢弃全部未发送增量」的字面（连接级排队帧属未发送面）。R1 错误行已消除。 |
| A6 | 锚点「精确为发送时刻」声明不实 | §2.4 改为「上一次观测点（前一最老的 ACK 到达时刻）的下界近似」+ 宽松方向无害论证（§18 无逐帧 deadline） | ✅ **闭合**。措辞与实现一致，验收语义按近似重述。 |
| A7 | flushQueued 破坏窗口不变量 + sendData 丢弃路径无记账出口 | §3.1 `flushQueued` 循环条件纳入 `pendingDataCount`；「恰三出口」不变量（dispatch/shed/teardown）成文；B-2e 非 ready 门改「丢 + onDataShed」；drain per-frame try/catch（编码错→onDataShed+ns ERROR 不断连接；`OutboundExhaustedError` rethrow 交收口）；`dispose` = 清 timer + 逐 ns onDataShed；transport 已关派发按已派发记账（ackTimeout/zombie 收尾） | ✅ **闭合**。负计数路径逐一排查（B-2e 门拒于入队前 / shed 整队丢 / dispose 全量丢 / 编码错帧即丢——均无「先 shed 清零后又有同 ns 帧派发」的窗口）；§8.9 对既有测试零回归的论证成立（live 会话 + 非 ready 连接窗口结构性不可达）。 |
| A8 | 章节交叉引用错乱 | §0「引用约定」（协议 §N / P5 §N / 本文档 §N）+ 全文裸引用改带前缀；§3.3 引用改 §3.4 规则 C；§11 #8 陈旧交叉引用删除 | ✅ **闭合**。抽查（§1.2 P5 §13.4、§4.1 P5 §11.3、§4.5 P5 §13.4、§2.3 P5 §10.2）全部一致。 |
| A9 | 1011 阈值口径未注明为解释性选择 | §3.3「阈值口径注记」+ §11 #15（解释性选择声明，无协议数值锚） | ✅ **闭合**。 |
| A10 | ping/pong 缺省数值无锚未注明 | §5.1「缺省数值注记」：工程缺省 + 选型依据 + 切片 9 可覆盖 | ✅ **闭合**。 |
| A11 | 生产 adapter 漏暴露 bufferedAmount → 背压静默不存在 | §3.4「生产接线要求」+ `DuplexTransport` 注释 + §6 切片 9 票面强制项（含建议装配期 loud 断言） | ✅ **闭合**。 |

**SA8 附注**（引用约定、连接代际/复制代际术语区分）：均已落实，与协议/CONTEXT 用法无冲突 ✅。

**R1 已验证面无回归**（diff-scan）：§1.2/§2.1–2.3/§4.1–4.3/§4.5/§5.2/§5.3 与 R1 逐字一致或仅引用前缀化；§4.4 的 `isGoawayDraining()` 包内私有 host 成员是 R1 模糊描述（「sendControl ready 门已覆盖大部分」——对 RESTARTING drain 期 ready 态并不成立）的真实改进，sa7 G1/G2 锚保持论证随之更严密。

## 二、§3.8 两项测试构造裁决最终形态复核

**裁决 1（AC5-RR 构造调整）**：✅ **可供 SA6 一次性调整**。
- 依赖的 harness/wire API 全部存在且语义匹配（`setGate/releaseAll/dispatchLog/deliveredToPeer`、`hubNode.scheduler.advanceBy`、`WATER_LIMITS`、`decodeMessage`、`settle`）；新配置（highWater=16/lowWater=8/max=8MiB）满足 R2 新校验链。
- A4 修正（`setGate(false)`）位置正确；含前置锚（暂停窗口零数据派发）防误判；断言组（`[a,b,a,b]` + 长度 4）与原 AC5-RR 完全一致——SA6 仅改构造体，断言面零改动。
- 本人逐帧重推通过（见 A4 行）；boot 期帧污染、恢复后 checkpoint 续挂、peer ACK 回流干扰均逐一排除。

**裁决 2（AC1 第二锚替换）**：✅ **可供 SA6 一次性调整**。
- 替换断言组（`hubSideClosed === true` + `hub.connections).toHaveLength(0)`，锚 1/3 不变）在 harness 上确定性成立（fatal 同步 close → `pair.right.closed` 即真；dropConnection ≈2 跳 ≪ 600 跳 settle）；fatal 后注入的 OPEN(seq 2) 因 `closedFlag` 被忽略 → 零 channel → `connections` 稳定空。
- ALLOW 清单已把 g1-g2 文件列入调整面（R1「预期零改动」标注作废）——与裁决一致；`accept.call(transport, {peerInstanceId})` 调用形状无需改动 ✓。

**建议补充锚**：R1 报告 §五 的六项补充锚（A1 窄锚/A2 滞回锚/A2 单检查点 1011 锚/A5 语义锚/A6 行为锚/A7 记账锚）已全部收入 §3.8——SA6 可同包下发。其中 A5 语义锚方向已按 §3.5 定案明确（hub ACK 超时自声明 → 排队 UPDATE 保留派发 + 迟到 ACK zombie 容忍），无歧义。

## 三、R2 新发现残余（非阻断）

| # | 级别 | 内容 | 处置 |
|---|------|------|------|
| NB1 | LOW（交接前机械修订） | §13「SA2 反馈逐条回应」表仍为 R1 残文（「尚无 SA2 反馈」+ 空表），与 R2 头部「逐条映射见 §13 表」自相矛盾——追溯性指针断裂。实质映射已由本 R2 段§一 表独立完成并核验。 | 总控在派发 SA3 前要求 SA1 机械填充 §13 表（A1–A11 → 修订位置），或以本报告 R2 §一 表为权威映射随任务包传递。**不构成 reject 理由**（纯文档记账，不影响实现与测试结果）。 |
| NB2 | MEDIUM（强制转达 SA3 实现注意，伪码级，非架构） | §3.1 `enqueueData`/`drain` 的桶注册卫生有两处脚枪（均为响亮崩溃、非静默错行为，且首个 shed 测试即暴露）：(a) `registerDataNamespace` 在 shed 循环**前**调用——若 victim 恰为 incoming ns 且 `shedNamespace` 按 drain 同款「空桶注销」idiom 实现，随后 `dataQueues.get(ns)!.push` 命中 undefined → TypeError（单 ns 连接的 shed 恰是最常见场景）；(b) drain 的 catch 分支 `continue` **跳过**了本轮的空桶注销检查——空桶残留 dataOrder，下一轮 `bucket.shift()` 返回 undefined → `item!` 断言崩溃（R1 死代码 drain 原有的 `if (item === undefined) continue` 守卫在 R2 伪码中被丢弃）。 | SA3 实现约束（择一即可，一行级）：shed 循环后重新 `registerDataNamespace` 或 `shedNamespace` 不注销空桶；drain 恢复 shift 空桶守卫（或 catch 分支不 `continue` 而走统一的空桶注销）。总控须将本条原文转达 SA3；「恰三出口」不变量（A7）不受影响。 |
| NB3 | LOW（观察项，可留切片 9/后续票） | 规则 C 要求 `largestQueuedNamespace() === undefined`（排队**全空**）；多 ns 部分shed 终态（`0 < queued ≤ lowWater` 且 `buffered > max`，暂停中）既不派发也不 1011，直至 socket 冲刷或 pong-timeout 活性收口（生产 adapter 按 A11 必有 ping/pong 面 → 有界恢复；包内内存 transport 无 bufferedAmount → 不可达）。无红灯锚影响，协议对「控制额度耗尽」时点无数值定义，现读法可辩护。 | 可选精化（不阻断）：规则 C 第二合取放宽为 `queuedDataBytes ≤ lowWater`（「shedding 已到停机线仍无法缓解 buffered」），语义更贴合 §3.3 的耗尽论证；SA3 可按现设计实现，精化与否交由实现票/SA4 评审定夺。 |
| NB4 | NIT（措辞） | §3.7 SHED 步 1「victim=undefined → break」——实际循环经条件 `queued(0) > lowWater` 为假直接退出，未取 victim；行为等价。 | 顺手修正措辞，零行为影响。 |

## 四、R2 复审结论

- **Verdict: pass**。A1–A11 全部闭合且闭合质量高（A1/A2 的修复精确落在 R1 指认的矛盾点上，AC5 三例逐帧重推与本人独立重推结论一致；A3/A4 裁决选型与本人 R1 建议 (b) 完全对齐且可执行）；§3.8 两项裁决最终形态完整、自洽、与 harness 实际 API 逐一吻合，**可一次性下发 SA6**。
- 放行条件（由总控执行，不需 SA1 返工设计）：① NB1 的 §13 机械填充（或以本报告 R2 §一 表为权威映射）；② NB2 原文转达 SA3 作为实现约束；③ NB3/NB4 作为 SA3/SA4 参考注记。
- `pass` 仅表示设计通过审查；实现正确性与活链路验证仍由 SA4（静态门禁+实测）与 SA7（动态验证）承担，红灯全绿基线（15 failed → 97 passed）以实际 vitest 运行为准。

---
---

# SA2 R3 快速复审 — §3.8 裁决 3（实现期 addendum：事件驱动 close 结算 × DENY 冻结测试 ⑦）

**Date**: 2026-08-29
**Verdict**: **reject（窄域）**——裁决 3 的 (2)(3)(4) 三项全部核验通过且**可立即下发**（互不依赖第 (1) 项的修订）；但第 (1) 项「resolve 事件集**封闭穷尽为四类**，无第五种」的定案被协议文本与实现状态机**双重证伪**（见 R3-1）：closing 期间的终局 finalize（failed/conflicted）是第五种收口完成事件且当前实现**不结算** → removeTarget 承诺在该路径上永久悬挂。需补一条 E5 子句 + 一行接线修复后生效。

**评审对象**: `wiki/raw/task_ws-replication-hardening_design.md` §3.8 裁决 3（L580-609）+ 实现态工作区（SA3 回流修复已落盘：`peer-namespace.ts` 事件驱动 closeMemo/gate、E1-E4 接线、`frame-io.ts`/`peer-connection.ts`）+ `ws-replication-r3-r4-regressions.test.ts` ⑦（实际 L241-272）。
**复审方法**: E1–E4 逐事件对照协议 §12/§16/§18 与实现接线（`peer-namespace.ts` L490/L502/L534/L609-611/L624-629/L634-642/L1020-1028）；测试 ⑦ 新构造逐帧推演；全仓 `removeTarget` 调用点死锁排查（ac1-ac2:276/279、ac6:111/135、ac7:153/185-186、r3-r4 ⑤a-d、SA6 AC6-3/4、g1-g2 AC3b）；SA4 R3 裁定原文核对。

## 一、逐项核验

| 项 | 内容 | 核验结论 |
|---|------|---------|
| (1) E1–E4 封闭事件集 + ADR-0008 L93 分层论证 | E1=关联 CLOSE_OK（§12 L311 ✓）/ E2=closeTimeout（§18 + §12 L312 本地兜底 ✓，实现 L1020-1028 ✓）/ E3=连接死亡（§16 ✓，实现 L609-611/L624-629/L634-642 三入口齐 ✓）/ E4=onCloseRequest 完成段（§4.1 ✓，实现 L490 ✓）；「apply drain 段不设 timeout（memo body 无限等待已接纳 apply）vs 握手等待段 closeTimeout 管辖」的分层与 ADR-0008 L93/协议 §12 L304 相容——**分层论证本身成立**，且实现忠实（memo body = drain→cleanup→await gate，E2 只解除 wire 等待、绝不截断 drain） | ⚠️ **四事件各自成立，但「封闭穷尽、无第五种」的枚举声明为假** → R3-1。E2 保证「连接存活」前提下主通路必有结算点 + E3 覆盖断线——主通路无死锁 ✓；缺口在第五条终局路径。 |
| (2) 测试 ⑦ 发起/结算分离构造 | 逐帧推演 ✓：`removeTarget` 同步置 closing + CLOSE_NAMESPACE 经控制路径即时派发（seq 9）→ 观测面即刻固定（CLOSE×1 / peerToHub 序列严格 [1..9] / CLOSE seq=9=length / UPDATE×2——第 3 笔因窗口满滞留 channel 队列、closing 停发）→ 断言全部只读 wire 帧，与 closeP 是否结算零耦合（原轮询环的「提前 resolve」对断言零贡献——成立）；释放 saveGate → hub apply 链完成（sequencer FIFO）→ hub closeQueue drain → `CLOSE_OK(ackedSequence=9)` → peer §2.2 关联通过（closeNamespaceSeq=9）→ closed → settle → memo body（peer drain 空，微任务级）→ `await closeP` 确定性结算。零 timer 推进、零轮询、零魔法常数 ✓。迟到 UPDATE_ACK 在 quiet-state 门被忽略、无干扰 ✓。**与同域兄弟测试（ac6:103-127、ac7:145-168）的既有「发起/结算分离」形态完全同构——⑦ 本是唯一例外**，调整即收敛到家族惯例 | ✅ 通过。 |
| (3) 文件门禁豁免最小化 | 全仓 removeTarget 调用点逐一排查：其余全部具备结算事件（真实 CLOSE_OK 的 E1：ac1-ac2:279、ac6:111/135、ac7:153/185、AC6-3/4；E2+advanceMs：⑤d、AC3b；本地收口分支：⑤a/b/c；幂等 memo 合流：ac7:186）——**唯 ⑦ 在 gate 持有下直接 await，是唯一的结构性死锁点**，豁免必要性成立；豁免面最小（单用例、断言面冻结、其余用例 ①-⑥/⑧* 仍 DENY；ALLOW L912 与 DENY L921 口径一致） | ✅ 通过。 |
| (4) 选型 (A) 否定 (B) | (B) 恢复有界预算 = 生产魔法常数延迟环（SA4 R3 的 G5.2 裁定成立）且「预算耗尽无条件 resolve」破坏 (1) 定案的承诺语义；(A) 无需 SA4 撤回正确裁定。补充独立佐证：SA6 已批红灯 **AC3b 的 `closeSettled === false` 锚本身就要求事件驱动语义**（PR #160 的「本地 cleanup 完成即结算」旧语义会使 closeP 在 closing 期早结算 → AC3b 红）——事件驱动方向被已批契约独立锁定，(A) 是唯一可行选型 | ✅ 通过。 |

## 二、R3-1（reject 依据）：E-集枚举不封闭——closing 期终局 finalize 是第五结算事件，且实现不结算

**触发条件（确定性可达，两类生产路径）**：
1. **apply drain 期终局失败/fence**：removeTarget 置 closing 后，close drain 等待的已接纳 apply 以失败结算 → `applyRemoteUpdate` 续体 → `applyOutcome`（`peer-namespace.ts:853-866`）→ `finalize('failed')`（APPLY_FAILED / PERSISTENCE_DEGRADED / INTERNAL_ERROR 等，`error-mapping.ts` L84-122 全部映射终态）或 `finalize('conflicted')`（fence——close drain 与 bump 竞态，⑧a 家族已证该竞态真实可达）；
2. **closing 期迟到 OPEN_OK 违例**：removeTarget 与在途 OPEN 竞态 → hub 迟到 OPEN_OK → `onOpenOk` 非 opening 分支 → `finalize('failed')`。

**缺口机制（实现证据）**：`finalize()`（`peer-namespace.ts:902-910`）仅在 `state === 'closed'` 时 `settleCloseMemo()`（L908）——failed/conflicted **不结算**。此后四事件全部被状态门锁死：E1 `onCloseOk` 首行 `state !== 'closing'` 早退；E2 `onTimerFired` 首行 `isTerminal()` 早退（且 finalize 已 `clearAllTimers`）；E4 `onCloseRequest` quiet-state 早退；仅真实断线（E3）可解。**连接存活 → removeTarget 承诺永久悬挂**——公共契约 `removeTarget(): Promise<void>`（types.ts L118）的活性被破坏（调用方编排收口悬挂；资源无泄漏、wire 无违例，纯 promise 活性缺陷）。

**协议证伪「无第五种」**：协议 §12 L313「**终止性 namespace ERROR 已经完成收口**，不再追加 CLOSE握手」——终态即收口完成，承诺必须兑现。终局 finalize 与 E1/E2/E4 同为「生命周期已终结」事件，归属同一结算族；addendum 的四类枚举漏掉它。

**ADR-0008 L93 相容性**：E5 在 apply **结算之后**由其续体触发（失败的 apply 已 settle——drain 已完成其「无条件排空」义务），不构成对 drain 段的打断 ✓。

**修复要求（窄域，两处）**：
1. 裁决 3 (1) 文字修订：E-集补 **E5「终局收口」**——closing 期间 `finalize('failed'|'conflicted')`（apply drain 终局失败/fence、迟到帧违例等）= 第五结算事件；「封闭穷尽为四类」改为五类（或将 E4 措辞扩为「终局收口族：hub 发起 CLOSE 完成段 ∥ 终局 finalize」）。依据补引 §12 L313。
2. SA3 接线一行：`finalize()` 的 `settleCloseMemo()` 去掉 `state === 'closed'` 条件（终态皆结算）。

**回归面核查**：E5 不触碰任何既有绿灯——AC3b（无 finalize 发生）、⑤d（terminal ERROR 期维持 closing 不 finalize，R3/#5d 语义不变、仍由 E2 结算）、⑤c（conflicted/failed 的 removeTarget 走本地分支立即 resolve）均不受影响；hub 侧对称场景（hub drain 期终局失败 → `isTerminal` 守卫跳过 CLOSE_OK）由 peer E2 closeTimeout 有界兜底（§12 L312 丢包容），无悬挂 ✓。

**建议红灯锚（随 E5 定案补发 SA6）**：closing drain 期 bump（或持久层降级注入）→ 断言 ns 终态（conflicted/failed）**且 `removeTarget` 承诺在有限微任务内结算**（E5 锚；零 timer 推进形态可用 bump 续体事件驱动）。

## 三、其余核验注记

- addendum 引证勘误（NIT）：⑦ 实际位于 L241-272（原文引 L240-266）；原 await 点实际 L253（原文引 L250-251）——SA6 执行时以用例名「序列分配点」定位为准。
- 实现的 gate 装饰 promise 设计（memo 创建时同步登记 resolve，settle 与登记之间零竞态窗口）经审查成立 ✓；「SA3 已接线 peer-namespace.ts:610」核实 ✓（实际 L609-611）。
- 裁决 3 (2)(3) 与 E5 修订**零耦合**：⑦ 的调整构造、单测豁免、SA6 执行包可先行下发；(1) 的 E5 子句 + finalize 一行随后到为即可，不需重新过 (2)(3)。

## 四、R3 复审结论

- **Verdict: reject（窄域）**。唯一阻断项 = R3-1（E-集枚举不封闭 + 实现孤儿承诺路径，一行接线 + 一句文字）。分层论证、⑦ 构造时序、豁免最小化、选型 (A) 四项均核验通过。
- 放行路径：SA1 补 E5 子句（引 §12 L313）→ SA3 落 `finalize` 无条件 settle（一行）→ E5 修复与本节要求逐字一致时无需再轮 SA2（建议 SA4 复验时加验 E5 路径）→ (2)(3) 的 SA6 调整包不受本轮影响、可并行下发。
