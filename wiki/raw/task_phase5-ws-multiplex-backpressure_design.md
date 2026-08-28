# 设计 — issue #137：单连接多 namespace 多路复用 + 有界公平背压（连接级调度域）

- run_id: issue-137-1787922674-8367 / round: 1 / branch `fix/issue-137-on-docs-phase-5-websocket-replication`
- 任务类型：功能开发（无缺陷复现诉求）
- 权威基准：`docs/protocols/instance-replication-v1.md` §10/§13.1/§14/§17（ADR 0010 L151 指定的唯一
  wire contract）+ ADR 0010 L143/L151/L113/L165/L177 + phase-5 切片 6/7 条目
- 前置文档：`task_phase5-ws-multiplex-backpressure.md`（简报）、`..._conflict_report.md`（SA8 clear，
  三条非冲突注记 = 设计红线）、`..._relevant_decisions.md`（ADR 约束基准）、SA6 红灯契约
  （`ws-replication-issue137-ac1-ac7-red.test.ts` + `issue137-driver.ts` + `harness.ts` saveGates）
- 前驱设计：`wiki/raw/task_phase5-ws-namespace-sync_design.md`（#136，本设计是其 §23 R-11/F6
  登记演进位的交付）

---

## §0. 任务范围与红线

本 issue 的新域 = **连接级发送调度**，恰好四件事（R-11/F6 演进位的逐项落地）：

1. **§4.5 data round-robin 公平轮转**：UPDATE（data）改道 per-namespace 队列 + 连接级
   round-robin（每轮每 ns 至多一帧），control/error/ACK 恒先（AC-4）；
2. **§4.4 连接总压恢复**：`maxQueuedBytesPerConnection` 运行时记账 + 按最大 queued namespace
   依次收口（丢未发送 + needs-resync）直到回低位 + control 保留额度（耗尽 =
   `CONNECTION_BACKPRESSURE` 分类连接失败，close 1011）（AC-5）；
3. **§4.2 bufferedAmount 高/低水位闸门**：读传输端 `bufferedAmount` 属性，超 highWater 暂停
   data dequeue、降至 lowWater 恢复；恢复检查经注入 Timer 调度（零 native timer、不进 Runtime
   sequencer）（AC-6）；
4. **§5 未发送增量合并**：`Y.mergeUpdates()` 合并尚未分配 sequence、尚未发送的 queued updates
   （AC-2）。

**四条红线（违反 = 设计无效）**：

- **R0-1 已绿域不得重做**：AC-1（multiplex + 同连接禁止重开）与 AC-3（per-ns 溢出语义）在 #136
  交付态已绿（SA6 探针实测）；AC-7 的独立失败/重连修复/per-ns 上限三轴已有覆盖。本设计**不新增
  状态机状态、不改 OPEN/bootstrap/round/close 迁移矩阵**，只改「帧怎么出队」。
- **R0-2 两级队列属主边界**（SA8 冲突报告注记 ① / ADR 0010 #134 round-2 修订节）：切片 3 fanout
  投递队列（session 域、容量 16 冻结、溢出弃新保旧、置 `status.needsResync` sticky）与本任务的
  WS 发送队列/连接级背压（连接域）是**两套队列、两个属主、两种溢出语义**。本设计只在
  `@nomicore/ws-replication` 连接层新增记账，**零触碰** `namespace-registry` 的 fanout 队列。
- **R0-3 不提前提取 transport-independent seam**（ADR 0010 L177）：AC-6 的 bufferedAmount 观察以
  **对既有 `DuplexTransport` 做鸭子类型动态属性读取**的最小接缝落地（§4.2），不新增 observer
  接口、不新增抽象层、不引入第二种 transport 形态；真实 WS Adapter（切片 7 其余部分）不在本任务
  范围，但读取形态与 `ws`/浏览器 WebSocket 的 `bufferedAmount` number 属性直接同构。
- **R0-4 冻结公共契约面不动**：`types.ts` 公共类型（`ReplicationLimits` 10 字段 /
  `ReplicationTimeouts` 6 字段 / `DuplexTransport` / `PeerReplication` 等）、`defaults.ts`
  DEFAULT_* 三常量、`index.ts` 导出面、`validate.ts` §17 校验清单——**零增删改名**。新逻辑全部
  落在包内私有面（新模块 + 内部 host 接口扩展）。

## §1. 基线勘察（已逐项读源码核实）

### §1.1 #136 交付态发送路径实况

| 事实 | 源码锚 | 后果 |
|---|---|---|
| UPDATE 帧走 **control 直发路径**：`UpdateChannel.sendAndRegister` → 控制器 `sendUpdateFrame` → `sendChecked` → 宿主 `sendControl` → `OutboundQueue.sendControl`（入 control 队列即排空） | `update-channel.ts:114-119`、`peer-namespace.ts:714-724`、`peer-connection.ts:392-398`、`hub-namespace.ts:630-639` | data 无独立调度路径；「control 恒先」对 UPDATE 无差别成立 |
| `OutboundQueue` 的 dataQueues/dataOrder/cursor **结构存在但从未喂入**；`sendData` 忽略 namespaceId 直发 | `frame-io.ts:98-149`（`sendData` 内 `void namespaceId`） | RR 公平轮转零实现面（#136 设计 §4.4 自注「调度器结构性存在但测试中零积压」） |
| `maxQueuedBytesPerConnection` / `lowWater` / `highWater` 仅存在于 defaults+validate+types，**运行时零读取** | `defaults.ts:24-26`、`validate.ts:111-113,136-141` | AC-5 红锚「A 恒 live」的直接原因 |
| 无 bufferedAmount 观察面；内存双端 send 同步完成 | `testing.ts`、`harness.ts makeWire` | AC-6a/6b 红锚「压力下帧照发」的直接原因 |
| per-ns 滑动窗口/有界队列/ACK 簿记/溢出（§10）**已完整交付** | `update-channel.ts` 全文 | 本设计复用其队列与窗口作为 data 调度的 per-ns 载体 |
| `flushQueued` 在 onAck/resetForLive 同步排空单 ns 队列（逐笔一帧、无合并） | `update-channel.ts:121-132,135-138` | AC-2 红锚「4 帧逐笔」的直接原因 |

### §1.2 SA6 红灯契约（4 红灯锚，设计必须转绿且 73 IT 零回归）

| 用例 | 红锚断言（精确形态） | 设计落点 |
|---|---|---|
| AC-2 未发送合并 | 窗口满排队 3 笔、ACK 后 `UPDATE 帧数 < 4`（实测 4） | §5 合并策略 |
| AC-6a+AC-4 高水位暂停 + 恢复轮转 | 压力 2×highWater 下**零** UPDATE 帧；恢复后帧 ns 序**恰** `[a,b,a,b,a,b]`（实测 3 帧即发 / 无交替） | §4.2 闸门 + §4.5 RR |
| AC-5 连接总压力 | `maxQueuedBytesPerConnection=60KB`、总 queued 90KB → **恰 A**（最大 queued ns）needs-resync、B live、连接 ready、恢复 round 补齐 | §4.4 shed |
| AC-6b hub 出站压力 + control 保留 | hub 压力下 fan-out UPDATE **零**帧；peer 写的 `UPDATE_ACK ≥ 1` 照常出 | §4.2 + §4.3 |

### §1.3 测试 seam 三注记（SA6 移交，设计必须逐条回应）

1. **bufferedAmount 读取形态**：测试以 number 型动态属性注入（`Object.defineProperty` getter，
   `issue137-driver.ts:120-125`）。本设计采**属性形态**（§4.2），**测试侧零调整**。
2. **saveGates 顺序门闩**：按 saveDoc 到达序逐个消费（`harness.ts:403-408`）——AC-5 的「双 ns 窗口
   各自满」时序由此保证；本设计不依赖也不改变该语义。
3. **恢复检查间隔假设 ≤ 30s**（测试 1s × 30 步进；ackTimeoutMs=120s 无干扰）：本设计定
   **`BACKPRESSURE_POLL_INTERVAL_MS = 1_000`**（包内冻结常量，非配置——公共契约面无该字段且
   SA3 不得自造，同 #136 §4.3 GOAWAY drainTimeoutMs 先例）≤ 30s ✓，测试侧推进量零调整。

## §2. 需求推演与 AC 逐条映射

| AC | 本设计前状态 | 本设计动作 |
|---|---|---|
| AC-1 multiplex + 禁止同连接重开 | **已绿**（#136 交付） | 零改动（controllers/channels 逐 ns map 既有）；§4.5 只调度其出队 |
| AC-2 有界队列/窗口/ACK-timeout/**未发送合并** | 除合并外已绿 | **新增合并策略**（§5）；上限/窗口/timeout 语义不动 |
| AC-3 溢出只丢未发送 + needs-resync + 本地状态保留 | **已绿** | per-ns 溢出路径原样；§4.4 连接级 shed 复用同一溢出处置（§10.2 同构） |
| AC-4 control 优先 + data round-robin 每轮每 ns 至多一帧 | 半残（结构在、未喂入） | **UPDATE 改道 data 调度路径 + RR 轮转**（§4.1/§4.5） |
| AC-5 连接总压恢复 + control 保留 + 分类失败 | 零实现 | **总压记账 + shed + 保留额度 + CONNECTION_BACKPRESSURE**（§4.3/§4.4） |
| AC-6 bufferedAmount 水位门控（Cordis 调度、不阻塞 sequencer） | 零实现 | **水位闸门 + poll timer**（§4.2）；闸门位于连接层，天然在 Runtime sequencer 之外（§11.2） |
| AC-7 公平/无饥饿/独立失败/重连修复/上限/有界内存 | 大部已绿 | fairness/no-starvation 由 AC-6a+AC-4 用例承担；本设计 §4.5 给出无饥饿论证 + §11.3 有界内存论证 |

## §3. 总体架构：ConnectionSender 分层与属主边界

### §3.1 新模块与数据流

```text
┌─ 控制器（peer-namespace / hub-namespace，不改状态机） ─────────────────────┐
│  round/bootstrapping/close 等控制帧 → host.sendControl（不变）              │
│  UpdateChannel（每 (ns,方向) 一个；仍是 per-ns 队列/窗口/ACK 簿记的属主）    │
│    deliver(live): 窗口空 ∧ 闸门开 → 直发；否则入有界队列（既有溢出判据）     │
│    pullAndSendOne(): 合并策略取一帧 → 发送 → inFlight 登记（新）            │
└──────────────┬─────────────────────────────────────────────┬──────────────┘
               │ host.dataGateOpen / onDataQueued /          │ host.sendControl
               │ requestDataDrain / sendUpdateFrame           │
┌──────────────▼─────────────────────────────────────────────▼──────────────┐
│ ConnectionSender（新：backpressure.ts；每连接实例一个，随 transport 生命周期）│
│  ① bufferedAmount 水位闸门（hysteresis + poll timer，§4.2）                 │
│  ② control 保留额度（暂停期控制帧字节记账，§4.3）                            │
│  ③ 连接总压记账 + shed（Σ queuedBytes > cap → 收口最大 ns，§4.4）           │
│  ④ data round-robin 轮转（插入序 wheel + 旋转游标，每轮每 ns 至多一帧，§4.5）│
└──────────────┬─────────────────────────────────────────────────────────────┘
               │ emitControl / emitData（序列号单点分配）
┌──────────────▼─────────────────────────────────────────────────────────────┐
│ OutboundQueue（frame-io.ts；保留控制路径 + 序列分配单点；删除未喂入的死代码）│
│   emitRaw → transport.send                                                 │
│   （transport.bufferedAmount 由 ConnectionSender 鸭子类型读取——§4.2）        │
└────────────────────────────────────────────────────────────────────────────┘
```

### §3.2 两级队列属主对账表（R0-2 红线的成文落实）

| 维度 | fanout 投递队列（切片 3，已交付） | WS 发送队列/连接级背压（本任务） |
|---|---|---|
| 位置/属主 | `namespace-registry` Runtime 内、**session 域** | `ws-replication` 连接层、**连接域** |
| 容量 | 16 冻结常量，不可配置 | `maxQueuedUpdateCount/Bytes`（per-ns）+ `maxQueuedBytesPerConnection`（连接） |
| 溢出语义 | 弃**新**保旧（已入队最旧项保留）+ `status.needsResync`（sticky） | 丢**全部未发送**增量 + namespace `needs-resync` 状态（非 sticky——round 恢复后回 live）+ 停发新 UPDATE |
| 修复拓扑 | transport 须 reset/bootstrap（经 watchdog 边沿 → §10.2 同构处置） | 同连接新 round state-vector diff（#136 §10.5 定案） |

两队列互不代管：连接层 shed 只丢弃 **ws-replication 自己的** 未发送队列，不触碰 session fanout
队列；session 层溢出仍经 `FenceWatchdog` needsResync 边沿消费（#136 §12 R4.2，不变）。

## §4. 连接级发送调度（协议 §17）

### §4.1 双优先级与 UPDATE 改道

- **control 帧**（HELLO/HELLO_ACK/OPEN_*/BOOTSTRAP_*/SYNC_*/RESYNC_REQUIRED/UPDATE_ACK/
  CLOSE_*/ERROR/GOAWAY/IDENTITY_CHANGED）：经 `OutboundQueue.sendControl` 既有路径——入队即
  排空、序列号出队时分配。**不被水位闸门阻塞**（协议 §17「control/error/ACK 高优先级」；AC-6b
  锚：压力下 UPDATE_ACK 照常出），但暂停期计入保留额度（§4.3）。
- **data 帧**（UPDATE，唯一 data 类）：改道 per-ns 队列（`UpdateChannel.queued`——它本来就是
  「未发送队列」，§10.1）+ 连接级 RR 出队。直发快速路径：`deliver(live)` 时窗口有空位且闸门开 →
  立即发送（与 #136 可观察行为逐帧一致，§10 回归论证）；窗口满 / 闸门关 / 非 live（deferred）→
  入有界队列（沿用既有溢出判据 `overflows()`：pending = inFlight + queued，§10.2/#136 §18.5
  不变），并通知 ConnectionSender（RR wheel 登记 + 连接总压检查）。
- **序列纪律不变**（#136 §4.1 R3/#7 钉死）：序列号只在 `OutboundQueue.emitOne` 出队发送时单点
  分配；入队项不携带不预占。data 帧改道不改变「实际交付序 = 序列序」——data 帧要么直发（请求序
  即交付序）、要么经 drain 出队（出队序即交付序）；控制帧插队只会跳过**未出队**的 data 项，被跳过
  项尚未消费序列号，无 SEQUENCE_VIOLATION 自伤面。

### §4.2 bufferedAmount 高/低水位闸门（AC-6）

**读取形态（seam 定案）**：鸭子类型动态属性读取，写入 `ConnectionSender` 单点：

```ts
private readLevel(): number {
  try {
    const v = (this.transport as { readonly bufferedAmount?: unknown }).bufferedAmount;
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  } catch {
    return 0; // seam 契约：transport 契约是「number 属性或缺失」；非契约形态 = 无压力
  }
}
```

- **契约语义**：`DuplexTransport` 公共类型**不加字段**（R0-4；`ws-replication-api.test-d.ts:113`
  传输 seam 形状断言零影响）。缺失 / 非 number / 非有限数 → 0 = 永不暂停——既有 harness
  `makeWire`（无该属性）与全部 73 用例结构性零影响（SA6 实测 73/73 绿的前提保持）。真实
  WebSocket（浏览器与 `ws` 包）的 `bufferedAmount` 均为 number 属性，同构直读，无需适配层
  （R0-3：不新增 observer 接口 = 不提前提取 transport-independent seam）。
- **hysteresis（协议 §17 字面）**：观察点读到 `level > highWater` → `paused = true`（进入暂停段
  时清零保留额度计数、武装 poll timer）；暂停段读到 `level ≤ lowWater` → `paused = false`（清
  poll timer、清零保留额度、**立即 drainData**）。两水位之间 → 保持现态（不抖动）。
- **观察时机**（全部同步、零轮询开销放大）：① 每次 control 帧发送前（`sendControl`）；② 每次
  data 发送尝试前（`dataGateOpen()` / `tryEmitData` 内）——即「每一帧出队前读一次」，协议
  「超过 high-water 暂停 dequeue」的逐帧执行面；③ poll timer 到期（仅暂停段存活）。
- **poll timer（「无 drain event 时使用 Cordis Timer 调度检查」）**：`BACKPRESSURE_POLL_INTERVAL_MS
  = 1_000`（包内冻结常量）。暂停进入时武装、恢复/连接收口时清除；到期读水位：仍 > lowWater →
  重武装（一拍一查，不叠帧）；≤ lowWater → 恢复 + drain。经注入 `ReplicationTimer`
  （peer `options.timer` / hub `hub.timer`——与既有 timer 同一注入面），**零 native timer**
  （SA4/SA7 静态守卫目标不变），回调只触碰连接/通道自身状态，**永不 await Runtime/Lease/Registry**，
  不进 Runtime sequencer（协议 §17 字面 + ADR 0010 L151）。
- **paused 只作用于 data dequeue**：不暂停 control（§4.1）、不改连接状态机（AC-6a 锚
  `connectionState()==='ready'` 在暂停段保持）、不触碰已发送 in-flight 的 ACK 簿记（ackTimeout
  照常兜底——暂停期窗口内的在途 UPDATE 若超时，走既有 §10.4 弃置 + needs-resync + 新 round）。
- **反向风险登记（R2，SA2 #11）**：缺属性 = 恒无压力是**契约行为**（公共类型无该字段——「该条件
  在正常流程是否总应满足」= 否，非伪降级）；但生产 WS adapter 若忘接 `bufferedAmount` 属性 ⇒
  背压**静默失效且无检测面**。登记切片 7 演进位（§15 B-7）：adapter 启动时探测一次「属性在位」
  事实并暴露给日志/metrics（切片 8 观测面），不在本任务实现。

### §4.3 control 保留额度与 CONNECTION_BACKPRESSURE（AC-5 尾款）

- **记账**：暂停段内每个**已发出**的 control 帧，按编码后实际字节数（`OutboundQueue` 出站回调
  单点回报，见 §6.4——判据必须确定，估算不可接受）累入 `controlReserveUsed`；恢复（或连接收口）
  时清零。
- **耗尽判据（R2 钉死，SA2 #3a）**：控制帧发送前判定
  **`controlReserveUsed + frameBytes > lowWater` → 该触发帧不发送**并立即走耗尽动作（下条）；
  `≤` 则发出并累入 `controlReserveUsed`——即额度语义为「暂停段累计已发出的控制字节 ≤ lowWater」，
  触发帧是**首个会越界的帧**。缺省 64KiB 下小 ACK（~40B）≈ 1600+ 帧余量；单帧 > 64KiB 的大
  控制帧（SYNC_STEP2 缺省上界 2MiB / BOOTSTRAP_SNAPSHOT 4MiB）在暂停段**首帧即触发**。SA7
  配方（SA2 报告 §5-F3②）按此谓词锁定精确触发帧数，SA3 不得采用其他谓词（如 `used ≥ reserve`
  ——两读法触发帧不同）。
- **额度**：保留额度 = `limits.lowWater` 字节。依据：公共契约零新字段（R0-4）下唯一量纲吻合的
  既有水位——「socket 恢复 data 所需余量即控制面在暂停期可占用的余量」；validate 已保证
  lowWater ≥ 1（positiveSafeInteger）。语义：小控制帧（ACK/ERROR/RESYNC/CLOSE，数十字节级）
  在压力下可继续维持协议活性；大控制帧（SYNC_STEP2 ≤ maxSyncDiffBytes、BOOTSTRAP_SNAPSHOT）
  或持续 ACK 洪水会耗尽额度——此时该连接对 peer 已不可服务，按注册表分类失败是正确行为。
- **合法极端配置的显式登记（R2，SA2 #3b）**：validate 允许 `lowWater=1, highWater=2`——该配置下
  暂停段**首个**控制帧（编码后 ≥ 数十字节）即 `used + frameBytes > 1` → CONNECTION_BACKPRESSURE
  (1011)。这是协议 §17「保留额度耗尽 = 分类失败」字面在该合法配置下的正确行为（retryable →
  backoff 重连自愈），**设计显式接受**；运维下界指导登记于 §15 B-2：期望「暂停期控制面存活 /
  reconcile 期 Step2 不瞬断」的部署应使 `lowWater ≥ maxSyncDiffBytes`。
- **耗尽动作（分类连接失败，§13.1 `CONNECTION_BACKPRESSURE` | retryable=yes | 1011）**：
  触发帧**不发送**（额度已尽），随后：
  - **hub 侧**：`connectionFatal('CONNECTION_BACKPRESSURE', 1011)`（既有路径：best-effort
    connection ERROR + close(1011) + closed + cleanup）；
  - **peer 侧**：新私有路径 `failConnectionBackpressure()`：best-effort ERROR（**诊断帧豁免额度**
    ——收口前最后一帧，不参与记账）→ `transport.close(1011, 'control-backpressure')` →
    `onTemporaryFailure()`（**retryable 语义**：attempts+1 → backoff → 重拨；**不走**
    `enterBlocked`——#136 §4.3 的 1002/1008 才是 blocked）。本地 close 不触发本地 onClose
    （fake/真实 WS 同构），FSM 迁移由本方法显式驱动；重入守卫：state ∈ {stopped/backoff/
    blocked/draining} 时直接返回（best-effort ERROR 的递归发送被守卫吸收）。
  - peer 侧收到 close 1011 → `onClose` 既有分类（非 1002/1008 → temporary → backoff）✓
    （`peer-connection.ts:427-438`）——重连后重新 OPEN/reconcile，即「分类失败 + 可重试」闭环。
  - **豁免的结构落地**：收口 ERROR 帧**直发 `OutboundQueue.sendControl`（绕过 sender 的额度
    判据）**——与既有 `onSequenceExhausted` 的直发先例同构（`peer-connection.ts:406-423`，队列已
    不可信时绕过出站队列直发）。由此收口路径零递归：额度判据只在 `sender.sendControl` 单点，
    收口帧不走该点；连接层 guard（closedFlag / connState）兜底二次触发。
  - **幂等来源明示（R2，SA2 I-4 注记）**：收口路径的幂等由**连接自身状态守卫**保证（peer
    connState / `failConnectionBackpressure` 重入守卫 / `enterBlocked` 幂等
    `peer-connection.ts:452`；hub `closedFlag` `hub-connection.ts:345-362`）——`transport.closed`
    仅是 fast-path 优化，**不得作为幂等依据**（真实 WS adapter 的 close 是否同步置 closed 不在
    契约内）。
- **可达性与可测性**（防「虚假实现」质疑）：暂停段（bufferedAmount > highWater 注入）+ 连续控制
  帧 > 64KiB（缺省 lowWater；按本节耗尽判据谓词 ≈ 1600+ 个 UPDATE_ACK，或 1 个 > 64KiB 的
  SYNC_STEP2 首帧即触发）→ 确定性触发。SA7 动态验证按 SA2 §5-F3 配方扩展（本任务红灯不含该
  用例，设计先钉死语义与配方）。

### §4.4 连接总压记账与 shed（AC-5）

- **记账域**：`totalQueuedDataBytes = Σ facet.queuedBytes()`——每连接每方向，**只计 data 未发送
  队列**（in-flight 已出队不计；control 走保留额度域不计）。每次求值即时从 facets 现算（O(ns)，
  ns 数为每连接通道数，v1 规模可忽略；增量记账的复杂度不做——正确性优先，演进位 §15）。
- **触发点**：任一通道 data 入队后（`host.onDataQueued(nsId)` → wheel 登记 → 总压检查）。
- **shed 算法（协议 §17 字面：「总队列超限时，按最大 queued namespace 依次丢弃未发送增量并标记
  needs-resync，直到回到低水位」）**：

```text
enforceConnectionCap():
  while Σ facet.queuedBytes() > limits.maxQueuedBytesPerConnection:
    victim = facets 中 queuedBytes() 最大者（并列取 wheel 序先者——确定性）
    if victim === undefined 或 victim.queuedBytes() === 0: break   // 无 data 可弃
    victim.discardForConnectionPressure()   // 丢其全部未发送 + §10.2 同构处置（下）
  // AC-5 数值走查：A=60KB + B=30KB = 90KB > 60KB → victim=A（60>30）→ Σ=30KB ≤ 60KB 停止
  // —— 恰收口最大 queued ns；B 不受影响；连接状态不动（无整连接失败）
```

- **`discardForConnectionPressure()` = §10.2 同构处置（复用既有恢复拓扑，零新语义）**：
  `discardQueued()` + channel `needsResync = true`（停发新 UPDATE）+ 控制器分派：
  - 通道 live → peer `declareLocalResync()`（发 RESYNC_REQUIRED{reasonCode:'send-queue-overflow'}
    + 置 needs-resync + in-flight 窗口收口后**同连接**新 round）/ hub `declareHubResync()`（声明
    + 等待 peer 新 round）——与 #136 §10.2/§10.5/§12 R4.2 完全同一入口；
  - 通道非 live（reconciling 等，deferred 队列被弃）→ `pendingResync = true`（round 结算时不进
    live 直接再开 round，#136 §5.3 同款）。
- **恢复闭环**（AC-5 后半）：被 shed 的 ns 经「ACK 到齐/ackTimeout 弃置 → 窗口收口 → peer 发起新
  round → Step2 diff 补齐被弃增量 → live」修复（丢弃安全性：被弃增量已提交本地 Y.Doc，下一 round
  `encodeDiff(对端 sv)` 必然包含——#136 §5.3 论证原样适用）。未被 shed 的 ns 照常 live。
- **边界语义**：触发用**严格大于**（`> cap`；AC-5 中 60KB == cap 不触发，90KB 触发——与测试算术
  逐值吻合）。单笔 update > cap 的配置病理（cap < maxUpdateBytes，如 AC-5 的 60KB < 200KB 但其
  单笔 30KB < 60KB 不命中）：该 ns 每入队即被自身 shed → needs-resync → round 修复 → 有界内存
  保持、一致性保持，但持续写会 round 抖动。**不加 validate 约束**（协议 §17 校验清单是封闭清单，
  且该约束会击穿 AC-5 测试配置本身）；登记为运维指导 + 演进位（§15）。
- **无迟滞边界登记（R2，SA2 #9）**：触发「严格大于」+ 停止「≤ cap」⇒ Σ == cap 后下一笔 1 字节
  入队即再次 shed（无迟滞；协议 §17 字面如此）。再触发需重新积压越过 cap（受 per-ns 与连接
  记账双重约束），churn 有界；不引入迟滞水位（公共契约无字段可承载，R0-4）。

### §4.5 data round-robin 公平轮转（AC-4）

- **wheel**：插入序 `nsId[]`（首次入队时登记）+ 旋转游标。出队 drain：

```text
drainData():                      // 触发点：① 水位恢复 ② onAck 窗口空位 ③ resetForLive
  if paused ∨ !isEmitAllowed(): return
  turns = 0
  while wheel 非空 ∧ turns++ < DRAIN_TURN_LIMIT(10_000):
    progressed = false; visited = 0
    while visited < wheel.length:
      nsId = wheel[cursor]; cursor 前进
      facet = facetOf(nsId)
      if facet === undefined: 从 wheel 移除; continue
      if facet.queuedCount() === 0: 从 wheel 移除; continue   // 留轮条件=有未发送 data
      if facet.pullAndSendOne(): progressed = true            // 每轮每 ns 至多一帧；true ⇔ 消费 ≥1 项（R3）
      if paused ∨ !isEmitAllowed(): return                    // 帧间重读水位（§4.2 ②）
      visited += 1
    if !progressed: return        // 全轮零消费（窗口满/live 门槛未过/闸门关）→ 退出，ACK 后再来
```

- **进展语义（R3 钉死，SA2 R2-N1·采方案 A）**：`progressed = true ⇔ 本 pass 有队列项被**消费**`
  ——`pullAndSendOne` 返回 true 的定义即「消费了 ≥1 项」（**F4 丢弃也是队列进展**，§6.2 R3），
  而非「发出了帧」。理由：超限项（> maxUpdateBytes，入队路径无大小门、可达）被 F4 消费后若按
  「未发帧 = 无进展」退出 drain，且此刻窗口无在途、无进行中 round，则三个触发点
  （onAck/水位恢复/resetForLive）无一可达——其后合法排队项在静默连接上**无限期滞留**（活性
  缺陷；#136 `flushQueued` 循环 update-channel.ts:122-132 F4 后继续消费下一项，无此搁浅）。采
  「消费即进展」后：同一 drain 的后续 pass 即拉到合法项发出；全超限队列在同一 drain 内逐项消费
  至空（每 true 消费 ≥1 项，单调收敛，turns 限额兜底，无循环放大）——§10 行 5 与 flushQueued
  的等价性声明（含超限项形态）随之成立。

- **「每轮每 ns 至多一帧」**：一次 pass 内每个 ns 至多 `pullAndSendOne()` 一次；多轮循环直到无
  进展/闸门再关/序列耗尽——AC-6a 恢复段确定性产出 `[a,b,a,b,a,b]`（A 先入队先出队，§9 走查）。
- **无饥饿论证（AC-7）**：wheel 中每个有未发送 data 的 ns 在每一轮都被访问且至多被跳过
  「窗口满/非 live」——两者都由该 ns 自身的 ACK/round 进度解除，与其他 ns 的积压量无关；单 ns
  无论积压多大，每轮只出一帧，其余 ns 的帧在本轮内必然获得出队位。热 ns 的爆发被自身窗口
  （maxInFlightUpdates）+ 自身队列上限 + 连接总压三重约束，不存在独占连接的路径。
- **快速路径公平性论证**（§4.1 直发不经过 wheel）：直发仅在「本 ns 窗口空位 ∧ 闸门开」时发生，
  即该 ns 的发送能力由自身 ACK 节奏决定，不占用任何其他 ns 的出队位（其他 ns 若有积压，其约束
  是自身窗口满或闸门关——两者直发都帮不了也抢不走）。不变量：「ns 有未发送队列 ∧ 窗口开放 ∧
  闸门开 ⇒ 同步栈内必有一次 drain 正在或即将把它清到窗口满/清空」——由 drain 的同步性与三个
  触发点（ACK/恢复/resetForLive）保证。
- **调度细节注记（R2 成文，SA2 #8 / I-1 注记 a·b·c）**：
  a. **共存窗口带宽分享**：恢复窗口内「热 ns 新写直发」与「积压 ns 排队 drain」共享恢复带宽——
     每个排队 ns 每轮必得一帧（非饥饿），但逐帧交错不承诺；共存窗口的带宽分享由水位闸门兜底
     （直发路径同样逐帧前置观察，超 highWater 过冲有界 ≤ 1 帧/方向）。
  b. **wheel 移除的游标偏移**：pass 内移除元素（facet 消失/队列清空）会使旋转游标在本次 pass 内
     跳过一邻位（经典下标偏移）——pass 内公平轻微偏斜、无跨 pass 饥饿；实现可选择「移除时不
     前移游标」消除偏斜（等价于重索引，非规范性要求，SA3 二选一即可）。
  c. **turns 截断出口不是终态**：`DRAIN_TURN_LIMIT`（10_000）截断隐含依赖「已发出帧的 ACK 会再
     触发 drain」——截断前至少发过 1 帧 ⇒ in-flight 非空 ⇒ ACK 必至（或 ackTimeout →
     needs-resync → 恢复 round），drain 必有下一次触发。SA3 不得把 turns 用尽当成队列终态处理。

## §5. 未发送增量合并（AC-2）

- **合并资格（协议 §10.1 字面）**：只合并「尚未分配 sequence、尚未发送」的 queued 项——in-flight
  项永不合并改写；合并产物作为**一个** UPDATE 帧出队、消费一个序列号、登记一项 inFlight。
- **触发判据（本设计钉死的策略，唯一同时满足 AC-2 与 AC-4 红锚的形态）**：在 `pullAndSendOne()`
  取帧时，`queuedCount > avail`（avail = `maxInFlightUpdates − inFlight.size`，即滑动窗口无法
  一次性吸收全部积压）→ 本帧取**贪心合并**（从队首累计 `Y.mergeUpdates`，累计字节数 ≤
  `maxUpdateBytes`，至少一项）；`queuedCount ≤ avail` → **不合并**，按原样逐项一帧。
  - 语义：仅当发送方处于 **ACK 节奏约束**（窗口是瓶颈）时才以批量换帧预算——此时每帧都要等
    ACK，合并最大化 data-per-ACK；窗口可全吸收时保留逐笔粒度（公平交错与部分进度最优）。
  - AC-2 走查：avail=1、queued=3 → 3>1 → 合并为 1 帧 → 总帧数 = A1 + 合并帧 = 2 < 4 ✓；
  - AC-4 走查：avail=32、queued=3 → 3≤32 → 不合并 → 恢复段 6 帧逐笔 RR ✓；
  - 既有窗口用例走查（ac5-live 滑动窗口）：avail=1、queued=1 → 不合并 → 3 写 3 帧 ✓（§10 逐表）。
- **字节上界与超限项处置（R2 修订——描述与代码事实对齐，SA2 #4）**：贪心累计以
  `maxUpdateBytes` 为界（超出即停止纳入，剩余留队）。**入队路径无大小门**（deliver/overflows
  只看 count/bytes 上限，`update-channel.ts:58-70`）——单项本身 > maxUpdateBytes 的项**照常
  入队并按原始字节入账**，在 pull 时经控制器 `sendUpdateFrame` 既有大小门返回 0 → F4 消费即
  丢弃（round diff 修复；本地已接受状态不受影响，协议 §10.1 语义不变）。合并帧以超限项为**首项**
  时即退化为「该单项成帧 → 大小门丢弃」——与逐笔丢弃语义一致，超限数据永不 wire；贪心遇超限项
  即停止纳入，其后合法项留队、**同一次 drain 的后续 pass**（F4 消费即进展，§4.5/§6.2 R3——
  不依赖任何未来触发点）逐笔正常发出（合法项不受超限项牵连）。
- **账务一致性（R2 修订——核减口径钉死，SA2 #1）**：`queuedBytes` 的**入账口径**是逐项原始字节
  数（`update-channel.ts:69-70`），故**出队核减 = 被取出各项的入账字节数之和**——无论这些项被
  合并为一帧还是逐笔发出。合并产物实长**只用于两处**：① inFlight 登记的 payload 引用/字节
  记账；② 本帧 `maxUpdateBytes` 判据（贪心上界）。理由：`Y.mergeUpdates` 产物长度 ≠ Σ 项长度
  （通常更小），若按产物实长核减 `queuedBytes` 将产生 phantom 字节累积，撕裂三套记账——
  `overflows()`（pendingBytes 判据 `update-channel.ts:101-107`，AC-3 per-ns 误溢出）、
  `facet.queuedBytes()`（AC-5 shed 误选 victim/误触发）、§11.3 有界内存上界。核减口径钉死后，
  `queuedBytes` 恒等于「队列内各项原始字节数之和」这一可从队列直接重算的量（无增量记账腐化
  面）。ACK 对合并帧的 ackedSequence 即该帧序列号，簿记无特例。

## §6. 模块级改动与伪代码

### §6.1 新文件 `packages/ws-replication/src/backpressure.ts`（~220 行）

```ts
/** ConnectionSender —— 连接级发送调度（协议 §17；每连接实例一个，随 transport 生命周期）。 */
export interface DataSenderFacet {
  queuedBytes(): number;                      // 连接总压记账（只计未发送 data；口径=各项原始字节之和，§5 R2）
  queuedCount(): number;                      // wheel 留轮判定
  pullAndSendOne(): boolean;                  // 前置五条见 §6.2（R2 钉死）；true ⇔ 消费 ≥1 项（F4 丢弃也是进展，R3）
  discardForConnectionPressure(): void;       // §4.4 shed → §10.2 同构处置
}

export interface ConnectionSenderHost {
  readonly limits: ResolvedLimits;
  readonly timer: ReplicationTimer;
  readBufferedAmount(): number;               // 连接层实现（持 transport；鸭子类型读取）
  emitControl(message: ReplicationMessage): number;   // → OutboundQueue.sendControl（无水位门）
  emitData(message: ReplicationMessage): number;      // → OutboundQueue.emit（序列分配单点）
  facetOf(namespaceId: string): DataSenderFacet | undefined;
  isEmitAllowed(): boolean;                   // peer: connState==='ready'；hub: 未收口
  onBackpressureExhausted(): void;            // §4.3：CONNECTION_BACKPRESSURE 分类失败
}

export const BACKPRESSURE_POLL_INTERVAL_MS = 1_000;   // §1.3-3：≤30s 假设内，冻结常量
```

类成员与关键方法（§4.2–§4.5 伪代码即规格）：`paused` / `pollHandle` / `controlReserveUsed` /
`wheel[]` / `cursor`；`sendControl(message)`（水位观察 + 保留额度判据 + emitControl）、
`tryEmitData(nsId, message)`（isEmitAllowed + 水位 + emitData）、`dataGateOpen()`、
`onDataQueued(nsId)`（wheel + enforceConnectionCap）、`requestDrain()`（!paused → drainData）、
`drainData()`（§4.5）、`teardown()`（清 poll timer、清 wheel、复位 paused——**连接收口/
重拨/重建/stop 的必经点，防 timer 泄漏**）。

### §6.2 `update-channel.ts` 改动（~90 行）

- `UpdateChannelHost` 新增三钩子（内部接口，非公共契约）：
  `dataGateOpen(): boolean`、`onDataQueued(): void`、`requestDataDrain(): void`。
- `deliver()`：live 直发分支增加 `host.dataGateOpen()` 前置判（关 → 走既有入队路径）；入队路径
  成功后调 `host.onDataQueued()`。其余（needsResync 丢弃、overflows 判据、溢出处置）逐字不动。
- `flushQueued()` **删除**，替换为 `pullAndSendOne(): boolean`。**入口前置（R2 钉死，SA2 #5——
  全部满足才取帧；任一不满足 → 返回 false 且不消费队列项）**：
  ① 控制器 `state === 'live'`（facet 层门，§6.3）；② channel `!needsResync`；③
  `inFlight.size < maxInFlightUpdates`（窗口空位——原 flushQueued 循环条件
  `update-channel.ts:125-126` 移入单帧前置，**pullAndSendOne 无循环可依托，SA3 不得省略**，
  否则超窗发射）；④ `queued.length > 0`；⑤ `host.dataGateOpen()`（闸门开）。
  取帧后：§5 合并策略（核减口径见该节 R2）→ `sendAndRegister` 复用 → 返回 true；
  `sendUpdateFrame` 返回 seq ≤ 0 → F4 消费即丢弃、**仍返回 true**（**R3 钉死，SA2 R2-N1·采
  方案 A：「消费即进展」——返回值语义 = 是否消费了 ≥1 队列项，而非是否发出帧；false ⇔ 前置
  任一不满足（未消费）。否则超限项 F4 后该 pass 零进展退出 drain，窗口无在途 ∧ 无 round 时
  三个触发点无一可达 → 其后合法项在静默连接上无限期滞留（活性缺陷，#136 flushQueued 循环
  `update-channel.ts:122-132` F4 后继续消费、无此搁浅）**）。丢弃项由 round diff 修复（F4 语义
  不变）。触发责任上移连接层（§4.5 三个触发点）。
- `onAck()` 'ok' 分支：`inFlight` 空位 ∧ queued 非空 → `host.requestDataDrain()`（替代原同步
  flush 循环；单 ns 场景 drain 同步清空，时序与原 flushQueued 等价——§10 论证）。
- `resetForLive()`：`needsResync = false` 后调 `host.requestDataDrain()`。
- 新增 `discardForConnectionPressure(liveOverflow: () => void, deferredOverflow: () => void)`：
  `discardQueued()` + `needsResync = true` + 按通道 live 性分派（§4.4）。
- facet 适配器放控制器侧（§6.3），UpdateChannel 不感知控制器状态。

### §6.3 控制器与连接改动

**`peer-namespace.ts` / `hub-namespace.ts`（各 ~45 行，状态机零改动）**：

- `PeerNamespaceHost` / `HubChannelHost` 新增：`sendData(namespaceId, bytes): number`（data 路径，
  peer 侧含 ready 门）、`dataGateOpen(): boolean`、`onDataQueued(namespaceId): void`、
  `requestDataDrain(): void`。
- 控制器 `sendUpdateFrame` 改走 `host.sendData`（大小门与 `sendChecked` 包裹不变）；UpdateChannel
  host 钩子桥接到新宿主面。
- 暴露 `sendFacet: DataSenderFacet`（§6.1 接口）：
  `pullAndSendOne` 以 `state === 'live'` 为门槛（deferred 队列仅在 `resetForLive` 后经 drain 放行
  ——与 #136「flushQueued 只从 onAck/resetForLive 调用」的 live 门逐语义等价）；
  `discardForConnectionPressure` 分派 `declareLocalResync`（peer）/`declareHubResync`（hub）或
  `pendingResync`。

**`peer-connection.ts`（~70 行）**：

- `dialNow()` 构造 `ConnectionSender`（与 `OutboundQueue` 同生命周期；新 sender 创建前旧
  `sender.teardown()`）；host 适配：`readBufferedAmount`（transport 鸭子读）、`emitControl` =
  outbound.sendControl、`emitData` = outbound.emit、`facetOf` = controllers map 查
  `sendFacet`、`isEmitAllowed` = `connState === 'ready'`、`onBackpressureExhausted` =
  `failConnectionBackpressure()`（§4.3 新私有方法）。
- `sendControl` 公共路径改经 `sender.sendControl`（ready 门保留在外层——HELLO 仍直发 outbound，
  与 #136 一致）；新增 `sendData(nsId, bytes)`：ready 门 → `sender.tryEmitData`。
- `facetOf` 返回时同步登记 controllers map（controller 创建即可被查到——facet 由连接在
  `pullAndSendOne` 现取）。
- `stop()` / `enterBlocked()` / `onTemporaryFailure()` / `requestRebuild()` 路径补
  `sender.teardown()`（旧连接 poll timer 零泄漏；重拨后新 sender 从 clean 态起步）。
- **（R2 修订，SA2 #2）`connectionFatal` 的 best-effort ERROR 改直发 outbound（绕过 ready 门）——
  有意的 wire 可观察变化**：#136 现状经 `this.sendControl` 的 ready 门
  （`peer-connection.ts:392-398` → `:440-450`）——handshaking 期 fatal（decode error
  `:220-227` / HELLO_ACK mismatch `:247-253`）的 connection ERROR 被吞为 0 帧。R2 起 peer 收口
  ERROR（`connectionFatal` / `onSequenceExhausted` / `failConnectionBackpressure`）统一直发
  outbound（§4.3 豁免），**这是协议 §14「framing 仍可信时关闭前 best-effort 发送 connection
  ERROR」义务的落实**（#136 R-13 登记的收口方向）。行为 delta：handshaking 期 fatal 从「零
  ERROR 帧」变为「恰 1 帧 ERROR + close」——§10 行 9 登记（73 IT 零断言触及，已核实）；SA7 以
  SA2 §5-F2 锚定新语义（防 SA3 回退成静默）。ready 态 fatal 行为不变（现流程 ready 门本就放行）。
- **（R2 钉死，SA2 #7）emit 异常传播收口**：新链路 `drainData → pullAndSendOne →
  sendUpdateFrame → host.sendData → sender.tryEmitData → OutboundQueue.emit` 中，控制器
  `sendUpdateFrame` 的 sendChecked 同款 try/catch **明确覆盖 `host.sendData` 调用**——
  `OutboundExhaustedError`（`frame-io.ts:173-179`）与编码错统一收敛为返回 0 → F4 消费即丢弃
  （uint32 耗尽场景 `onSequenceExhausted` 已先行收口连接）；drainData 收到 pull 返回 false 即
  按无进展处理（本轮自然终止）——**任何异常不得穿越 drainData/onAck/onMessage/定时器回调栈
  成为 uncaught**。SA4 静态守卫（SA2 §5-F7）：本调用链 try/catch 覆盖面 grep。

**`hub-connection.ts`（~55 行）**：对称。构造 sender；`sendControlChecked` 经 sender；新增
`sendData`；`facetOf` = channels map；`isEmitAllowed` = 未收口；`onBackpressureExhausted` =
`connectionFatal('CONNECTION_BACKPRESSURE', 1011)`；`close()`/`onTransportClosed()`/
`connectionFatal` 补 `sender.teardown()`。连接级收口 ERROR（`connectionFatal` /
`onSequenceExhausted`）改经直发 outbound 路径（§4.3 豁免；非耗尽场景下行为与经 sender 等价——
控制帧本就不受阻，仅差额度记账，而收口后额度无意义）。

### §6.4 `frame-io.ts` 改动（~40 行）

- `OutboundQueue.emitOne` 保持序列分配单点；新增公共 `emit(message): number`（data 出队点，供
  sender 调用）。
- 构造器新增可选 `onEmitted?: (info: { kind: 'control' | 'data'; byteLength: number }) => void`
  ——编码后实际字节回报（§4.3 保留额度记账的确定判据来源）。
- **删除死代码**：`dataQueues` / `dataOrder` / `dataCursor` / `nextDataNamespace` /
  `queuedDataCount` / `sendData`（void namespaceId 直发的未用面）与 `drain()` 中的 data 段——
  RR 职责已由 ConnectionSender + UpdateChannel 落地；control 队列排空逻辑保留（`drain()` 收窄为
  control-only）。内部符号，不出公共入口，零外部 caller。

### §6.5 不改动清单（对照 R0-1/R0-4）

`types.ts` 公共类型、`defaults.ts`、`validate.ts`、`index.ts`、`error-mapping.ts`、
`round-engine.ts`、`fence-watchdog.ts`、`lifecycle-queue.ts`、`testing.ts`、
`replication-protocol` 全包、`namespace-registry` 全包。

## §7. 状态机与恢复拓扑不变量

- **零新状态**：连接态（`PeerConnectionState`/hub 四态）与 ns 态（`PeerNamespaceState`/
  `HubChannelState`）枚举不动。`paused` / 保留额度 / wheel 是 sender 内部记账，不投影、不上
  wire、不入 Runtime status（ADR 0008 #132 边界）。
- **恢复拓扑不变**：一切「丢未发送 + needs-resync」入口（per-ns 溢出 §10.2 / ACK-timeout §10.4 /
  对端 RESYNC §10.6 / **连接总压 shed §4.4（新）**）统一收敛到 #136 §10.5 定案——同连接新 round，
  round 恒由 peer 发起；hub 声明后等待。shed 不触发重建/重连（AC-5 锚：连接保持 ready）。
- **needs-resync 停发语义不变**：channel `needsResync` 置位后 `deliver` 直弃新交付；`resetForLive`
  清位后 drain 放行队列残余。
- **迟到纪律不变**：B-2e（ready 门抑制重建窗口期出站）、epoch 判别、§13.4 迟到收口域——data
  路径与 control 路径走同一 `isEmitAllowed`/ready 门语义。

## §8. 生命周期、停机与 timer 清理

| 事件 | sender 动作 |
|---|---|
| dial/accept（连接建立） | 新建 sender（clean：!paused、额度 0、空 wheel、无 timer） |
| 水位暂停进入/退出 | arm/clear poll timer（唯一新增 timer 面；仅暂停段存活） |
| peer stop()/GOAWAY 收口、blocked、temporary failure、rebuild | `sender.teardown()`（清 timer + wheel + 复位）——重拨/重建由新 sender 接管 |
| **（R2 补行，SA2 #6）** peer GOAWAY `SERVER_RESTARTING` 等 → `scheduleDrainClose()` 本地 close（FSM 停留 ready、无重拨编排，`peer-connection.ts:357-365`） | close 前补 `sender.teardown()`——清除已武装 poll timer，杜绝「stale getter 上 1s 周期性重武装直至下次 dialNow 换 sender」；即便 stale fire 到达（防御面）：teardown 后 `pollHandle` 恒 undefined，回调对已收口连接零副作用且**不重武装** |
| hub close()/transport closed/connectionFatal | 同上 |
| 停机顺序（§21） | 无新依赖：sender teardown 不 await 任何 Runtime/Lease/Registry；drain 不在 sequencer 槽内（协议 §17「不进入 Runtime sequencer」） |

## §9. 四红灯逐用例确定性走查（设计自证）

**AC-2**（1 ns，`maxInFlightUpdates:1`，saveGate 扣 A1 ACK）：A1 直发（1 帧）；A2/A3/A4 窗口满
入队（pending=1+0,1,2 < 100 / 字节 ≪ 1MiB，不溢出）。释放 → ACK(A1) → onAck 'ok' → 空位 ∧
queued>0 → requestDrain → drainData：queued(3) > avail(1) → 贪心合并为 1 帧发出（inFlight=1，
窗口满，drain 止）。hub apply 合并增量（n=12..14）→ ACK → 收敛 n=14。总 UPDATE 帧 = 2 < 4 ✓；
本地 peer n=14（sequencer 不受队列影响）✓。

**AC-6a+AC-4**（2 ns，`maxInFlightUpdates:32`，压力 2×highWater）：六笔写各自 deliver(live)：
窗口空但 `dataGateOpen()`=false（1MB > 512KB；首次判定进入暂停段：武装 poll@1000ms、额度清零）
→ 六项分别入 A/B 的有界队列（远低于 per-ns 上限；连接总压 ≪ 8MiB 不触发 shed）→ **零 UPDATE
帧** ✓；hub n 保持 1 ✓；peer 本地 13/23 ✓；连接 ready ✓。`setPeerPressure(32KB)` 后
`advanceBy(1000)` → poll fire → 32KB ≤ 64KB → 恢复（清 timer/额度）→ drainData：wheel=[A,B]
（A 先入队），每轮每 ns 一帧、不合并（queued 3 ≤ avail 32）、帧间水位复查（32KB 恒低）→
`[a,b,a,b,a,b]` ✓；hub 双收敛 ✓；双 ns 保持 live ✓。

**AC-5**（2 ns，cap=60KB，saveGates 双扣）：A1/B1 直发在途；A2/A3 入队（60KB）；B2 入队 →
`onDataQueued(B)` → Σ=90KB > 60KB → shed A（60>30）→ `discardForConnectionPressure` → A 丢
60KB + RESYNC_REQUIRED + needs-resync（in-flight A1 在途照常等 ACK）→ Σ=30KB 停止；B live ✓；
A 本地 blurb=BLOB[2] ✓；连接 ready ✓。gateA/B 释放 → ACK(A1) → A 窗口收口 → maybeStartRecovery
→ 新 round → Step2 diff 补齐 BLOB[1..2] → A live、hub 收敛 ✓；ACK(B1) → B2 经 drain 发出 →
hub 收敛 ✓。

**AC-6b**（1 ns，hub 压力 2×highWater）：peer 写 n=1 → peer 方向无压直发；hub apply →
UPDATE_ACK（control）：sendControl 水位观察（进入暂停段、武装 poll）但 control 不受阻 →
照常发出 ✓（额度记账：~40 字节 ≪ 64KB）。hub 写 n=9 → fanout deliver(live)：窗口空、
`dataGateOpen()`=false → 入队 → **零 fan-out UPDATE 帧** ✓；hub 本地 n=9 ✓（sequencer 未阻塞）。
`setHubPressure(32KB)` → `advanceBy(1000)`（hub timer）→ 恢复 → drain → fan-out UPDATE 发出 →
peer 收敛 n=9 ✓。

## §10. 回归面分析（既有 73 IT 零回归论证）

| # | 风险点 | 论证 |
|---|---|---|
| 1 | 水位闸门误暂停 | 73 用例的 transport（`makeWire`/`makeDuplex`）无 `bufferedAmount` 属性 → 恒 0 → 恒开；poll timer 永不武装（零新 timer 面） |
| 2 | UPDATE 改道后帧序/序列变化 | 无暂停时 data 走直发快速路径：请求序=交付序=序列序，与 #136 逐帧一致；r3-r4 ⑦「CLOSE 出队序列=9」走查：UPDATE(7,8) 直发、W3 入队未发、CLOSE(9) control 直发 ✓ |
| 3 | 合并策略改变帧数断言 | 逐用例核对全部 `maxInFlightUpdates` 覆盖用例：ac5-live 滑动窗口（avail=1,queued=1→不合并→3 帧 ✓）；ac6-resync-close/sa4-f1-f2-f3/r3-r4 ⑧a（`maxQueuedUpdateCount:1` 第二笔即溢出丢弃，无 drain 积压面 ✓）；r3-r4 ⑦（W3 永不发 ✓）；r3-r4 fanout 溢出（窗口 32>20 全直发，`UPDATE<20` 仅因 fanout 弃投 ✓）；ac7-faults:216（水位 256/512 但无属性→恒开 ✓）。**queued>avail 在既有用例中唯一可达形态是单笔排队（合并=恒等）** |
| 4 | shed 误触发 | 既有用例 queued 峰值 ≪ 缺省 8MiB cap；无任何用例覆盖 `maxQueuedBytesPerConnection` 覆写（grep 证实仅 harness 镜像/类型测试出现该字段） |
| 5 | `flushQueued`→drain 时序变化 | drain 由 ACK 同步触发（同一调用栈）；单 ns 场景 drain 即「循环 pullAndSendOne 直到窗口满/清空」= 原 flushQueued 循环，帧集合与时序逐帧等价；多 ns 场景 #136 无积压用例（自注「零积压」）。**（R3 补强，SA2 R2-N1）等价性在 F4 路径上同样成立**：pullAndSendOne「消费即进展」（§6.2 R3）与 flushQueued 循环 F4 后继续消费下一项（update-channel.ts:122-132）逐语义对齐——含超限项形态（超限项消费后续 pass 拉合法项，不依赖未来触发点） |
| 6 | control 保留额度 | 仅暂停段记账；#1 成立 ⇒ 既有用例零触达 |
| 7 | OutboundQueue 删死代码 | dataQueues/sendasData 无任何 caller（grep 证实）；`drain()` 收窄为 control-only，`sendControl` 行为不变（返回 lastSeq 语义不变——round 引擎 `ownStep1Seq` 簿记依赖它） |
| 8 | 新增 timer 泄漏 | poll timer 仅暂停段存活；§8 teardown 矩阵覆盖 stop/blocked/backoff/rebuild/hub close/GOAWAY drain-close（R2 补） |
| 9 | **（R2 登记，SA2 #2；R3 归类精度修正，SA2 7.4-1）** peer 收口 ERROR 直发绕过 ready 门——handshaking 期 fatal 从「0 ERROR 帧」变「恰 1 帧」 | 既有 73 IT 的 ERROR 帧断言恰 4 处，按影响面分两类（R3 修正表述）：**namespace-scope ERROR ×3**（ac1-ac2:262 TARGET_NOT_REQUESTED、ac3:112 BOOTSTRAP_FAILED、r3-r4:212 closing 期零回发）——经公共 `sendControl` 路径，**路径分离**故不受收口直发改动影响（与连接状态无关）；**ready 态 peer connectionFatal ×1**（ac5-live:141 ACK_STATE_VIOLATION——现流程 ready 门放行、R2 直发同帧，零 delta）。handshaking 期 peer fatal 的 ERROR 帧数零断言触及，零回归成立（SA2 R2 复审独立重验 ✓）；新行为 = 协议 §14 best-effort 义务落实（#136 R-13 收口方向，§6.3 R2）；SA7 以 SA2 §5-F2 锚定新语义 |

## §11. 观测、安全与性能注记

### §11.1 wire 面零新增
无新消息码/字段/错误码（`CONNECTION_BACKPRESSURE` 复用注册表既有条目，errors.ts:108）；ERROR
safeMessage 静态常量复用；不回显任何身份/内容（I-2 不变）。

### §11.2 「不进 Runtime sequencer」的结构保证
ConnectionSender 只被三处调用：控制帧发送点（连接/控制器同步段）、`UpdateChannel` 出队点（ACK
回调/恢复检查/resetForLive——全部在 ws-replication 自身调用栈）、poll timer 回调（注入 Timer）。
其代码路径不 import、不 await、不回调 Runtime/Lease/Registry——ADR 0010 L151「网络背压不得进入
Runtime sequencer」由**结构**（依赖方向）保证，非约定。

### §11.3 有界内存（AC-7）
每方向内存上界 = Σ per-ns（inFlight ≤ maxInFlightUpdates × maxUpdateBytes + queued ≤
maxQueuedUpdateBytes）且 Σ queued ≤ maxQueuedBytesPerConnection（shed 强制）+ control 保留
额度 ≤ lowWater（超额即分类失败）——三层上限各自独立生效，敌意流量下均收敛。

### §11.4 性能
每帧一次属性读 + 每入队一次 O(ns) 总压求和 + 每控制帧一次编码字节数回报——v1 规模（每连接几十
ns）可忽略；「每连接最大 channel 数」上限属 ADR 0010 L165 清单但不在冻结契约内，登记演进位
（§15）。

## §12. 协议假设依据 (Protocol Assumption Evidence)

| # | 假设 | 依据类型 | 依据内容（具体引用） | 风险 |
|---|---|---|---|---|
| P-1 | transport 以 number 属性暴露 `bufferedAmount`；缺失=无压力 | 源码引用 + 现有测试引用 | SA6 注入 seam：`packages/ws-replication/test/issue137-driver.ts:120-125`（`Object.defineProperty` getter，契约注记「缺省 0 = 无压力，既有 makeWire 零影响」）；真实面同构：浏览器 WebSocket 与 Node `ws` 的 `bufferedAmount` 均为 number 数据属性（WHATWG WebSockets API 标准 `readonly attribute unsigned long bufferedAmount`） | 低 |
| P-2 | fake scheduler `advanceBy(ms)` 触发 `at ≤ deadline` 的 timer（1000ms 间隔首轮即触发） | 源码引用 | `packages/namespace-registry/src/testing.ts:92-107`：`.filter(([, timer]) => timer.at <= deadline)` 按到期序触发 + 微任务展开 | 低 |
| P-3 | close 1011 在 peer 侧按临时失败分类（backoff 重连，非 blocked） | 源码引用 | `packages/ws-replication/src/peer-connection.ts:427-438`：仅 1002/1008 → `enterBlocked`，其余 → `onTemporaryFailure`；协议 §13.1 `CONNECTION_BACKPRESSURE` retryable=yes + §14 close code 1011 | 低 |
| P-4 | `CONNECTION_BACKPRESSURE` 注册表条目存在且 scope=connection/retryable=yes/1011 | 源码引用 | `packages/replication-protocol/src/errors.ts:27,108`；`connectionErrorFrame()` 构造可用（frame-io.ts:35） | 低 |
| P-5 | saveGates 按 saveDoc 到达序逐个消费（AC-5 双 ns 窗口时序的前提） | 现有测试引用 | `packages/ws-replication/test/harness.ts:403-408`（`saveGates.shift()`） | 低 |
| P-6 | `Y.mergeUpdates` 可用且合并未发送增量安全 | 源码引用 | `peer-namespace.ts:5` 已 `import * as Y from 'yjs'`（包依赖在位）；协议 §10.1「尚未分配 sequence、尚未发送的 updates 允许 Y.mergeUpdates() 合并」 | 低 |
| P-7 | hub 对 remote-apply 不回发 fan-out（回声抑制），AC-6a 恢复段 peerToHub UPDATE 序不被 hub 数据污染 | 现有测试引用 | `packages/ws-replication/test/ws-replication-ac5-live.test.ts:72-95`（「A 的 hub→peer 方向没有任何 UPDATE」既有锚） | 低 |
| P-8 | 本地 close 不触发本地 onClose（peer 需显式驱动 FSM） | 源码引用 | `harness.ts:547-553`（close 只通知对端 listeners）；真实 WS 同构（close 主动端收不到自身 close 事件） | 低 |

## §13. 契约改动连锁审计 (Contract Change Caller Audit)

**公共契约改动：无。** 本设计仅涉及 [新增内部模块 / 包内私有 host 接口扩展 / 删除未用内部符号]。
`types.ts` 公共类型、`defaults.ts`、`index.ts` 导出、两个工厂函数签名、`DuplexTransport` 形状、
全部返回值/异常契约——零变化。SA4 §1.5 五类触发（return→throw / Promise 形态 / 同步变异步 /
catch 重抛 / 可空性翻转）均不命中。

内部 seam 变更（仅供 SA4 比对，全部包内私有、编译期封闭）：

| 内部接口 | 变更 | 实现/调用方（全部枚举） | 处置 |
|---|---|---|---|
| `UpdateChannelHost` | +`dataGateOpen`/`onDataQueued`/`requestDataDrain` | 实现：`peer-namespace.ts:113-124`、`hub-namespace.ts:120-131`；调用：`update-channel.ts` | 两处 host 对象字面量补三钩子，桥接宿主新面 |
| `PeerNamespaceHost` / `HubChannelHost` | +`sendData`/`dataGateOpen`/`onDataQueued`/`requestDataDrain` | 实现：`peer-connection.ts:70-79`、`hub-connection.ts:130-140`；调用：peer-namespace/hub-namespace 控制器 | 同上 |
| `OutboundQueue` | −`sendData`/`dataQueues`/`nextDataNamespace`/`queuedDataCount`；+`emit`/`onEmitted`；`drain` 收窄 | caller 检索：`git grep -n "sendData\|dataQueues\|nextDataNamespace" -- packages/ws-replication/src` → 除定义外**零 caller**（死代码）；`drain()` 唯一 caller 是 `sendControl`（保留路径） | 删除安全；`sendControl` 返回值（lastSeq）语义不变 |
| `UpdateChannel.flushQueued` | 删除 → `pullAndSendOne` | caller 检索：`update-channel.ts` 内部（onAck/resetForLive 两处）+ `git grep` 无外部 caller | 两处 caller 改 `requestDataDrain`；hub/peer 对称 |

## §14. 文件清单（File Scope）

### ALLOW LIST

- `packages/ws-replication/src/backpressure.ts` — 新建（~220 行），ConnectionSender：水位闸门/保留额度/总压 shed/RR 轮转（§6.1）
- `packages/ws-replication/src/frame-io.ts` — 修改（~40 行），OutboundQueue 出队字节回报 + 公共 emit + 删除未喂入的 data 死代码（§6.4）
- `packages/ws-replication/src/update-channel.ts` — 修改（~90 行），deliver 闸门前置/pullAndSendOne 合并取帧/shed 处置钩子/flushQueued 替换（§6.2）
- `packages/ws-replication/src/peer-connection.ts` — 修改（~70 行），sender 装配/sendData 路径/failConnectionBackpressure/teardown 接线（§6.3）
- `packages/ws-replication/src/hub-connection.ts` — 修改（~55 行），对称装配 + connectionFatal('CONNECTION_BACKPRESSURE',1011)（§6.3）
- `packages/ws-replication/src/peer-namespace.ts` — 修改（~45 行），host 钩子桥接 + sendFacet；状态机零改动（§6.3）
- `packages/ws-replication/src/hub-namespace.ts` — 修改（~45 行），同上（hub 对称）（§6.3）
- `packages/ws-replication/test/ws-replication-issue137-ac1-ac7-red.test.ts` — `[SA6 owned]` 红灯验收测试。SA3 不得改断言；仅允许测试基建级修复（且须回注理由）
- `packages/ws-replication/test/issue137-driver.ts` — `[SA6 owned]` 多 ns 驱动器。同上
- `packages/ws-replication/test/harness.ts` — `[SA6 owned]` saveGates 顺序门闩。同上

### DENY LIST

- `packages/ws-replication/src/types.ts` — 公共契约面（含 DuplexTransport/ReplicationLimits）零增删改名；本任务不改该文件（内部 facet 类型定义于 backpressure.ts）
- `packages/ws-replication/src/defaults.ts` — DEFAULT_* 冻结三常量；零改动
- `packages/ws-replication/src/validate.ts` — §17 校验封闭清单；零改动（§4.4 边界语义段已论证不加约束的缘由）
- `packages/ws-replication/src/index.ts` — 公共导出面零变化（backpressure.ts 不导出）
- `packages/ws-replication/src/round-engine.ts` / `fence-watchdog.ts` / `lifecycle-queue.ts` / `error-mapping.ts` / `testing.ts` — 状态机/检测/收口/映射/内存 transport 均非本任务改动面
- `packages/replication-protocol/**` — 纯协议包，稳定
- `packages/namespace-registry/**` / `packages/namespace-runtime/**` / `packages/doc-runtime/**` — 两级队列属主红线（R0-2）：fanout 队列域零触碰
- `apps/**` — 切片 9 composition root 非本任务范围
- `docs/**` — 协议文档是裁决基准，非交付物
- 其余 `packages/ws-replication/test/*`（非上列 SA6 owned 三件） — 既有 73 IT 冻结，零改动

## §15. 风险与演进位

| # | 项 | 风险/代价 | 缓解 | 演进位 |
|---|---|---|---|---|
| B-1 | 合并策略钉死「queued>avail 才合并」 | 单 ns 窗口大开时的批量带宽优化被刻意放弃（换 AC-4 逐笔交错锚点） | 两红锚唯一共同解；§5 语义论证 | 切片 10 可按负载画像复议（需同步 SA6 锚点修订） |
| B-2 | 保留额度 = lowWater 的量化选择 | 额度过小：大 Step2 在压力下即刻触发 1011；过大：backpressure 失控缓冲膨胀。**完整风暴闭环（R2 补全，SA2 #10/I-3.4）**：慢消费者 + 大 diff——重连 → reconcile → Step2（≤2MiB 控制帧不经闸门）灌满出站缓冲 → 下一控制帧观察点进入暂停 → 后续 Step2/ACK 计入额度 → 耗尽 → 1011 → 重连 → 同一 diff 再 Step2……周期循环，每循环白传 ≤ 2MiB；**终止条件**：唯一出口是对端恢复读取 socket（bufferedAmount 降档 → poll 恢复 → drain）；backoff baseMs=100→maxMs=30s 全抖动（defaults.ts:40-44）使重连尝试收敛、不放大为风暴——协议字面如此（reserve 耗尽 = 分类失败），非设计缺陷 | 按缺省 64KiB：小 ACK（~40B）≈ 1600+ 帧余量（§4.3 R2 谓词）；1011 retryable（backoff + jitter 收敛）。**运维下界指导（R2，SA2 #3b；R3 补注 7.4-3）**：期望「暂停期控制面存活 / reconcile 期 Step2 不瞬断」的部署应使 `lowWater ≥ maxSyncDiffBytes`——**该指导下 highWater 须同步上调**（validate `lowWater < highWater`，只调一端在构造期 TypeError；数据闸门阈值随之变大属预期代价）；`lowWater=1` 等合法极端 = 暂停段首控制帧即 1011（§4.3 R2 显式接受） | 切片 8 观测数据后按需调参（届时需公共契约增字段 = Jim 裁决） |
| B-3 | cap < 单笔 update 的配置病理（round 抖动） | §4.4 边界语义段 | 有界内存/一致性保持；运维指导：cap ≥ maxQueuedUpdateBytes | 切片 10 复议是否入 validate（需协议 §17 清单增补） |
| B-4 | 总压求和 O(ns)/入队 | 每 data 入队一次线性求和 | v1 规模可忽略；正确性优先 | 「每连接最大 channel 数」上限（ADR 0010 L165）落地时一并增量化 |
| B-5 | 恢复延迟 = poll 间隔（1s） | data 恢复最多迟一个间隔 | 间隔内 control 不受影响；ACK/业务时序不受闸门影响 | 真实 WS Adapter（切片 7 其余）可接 drain event 事件化（届时替换 poll） |
| B-6 | #136 R-13（sendControl ready 门以 connState 判定） | **R2 状态更新（SA2 #2）**：本任务已部分收口——peer 收口 ERROR（connectionFatal 等三路径）改直发绕过 ready 门（§6.3 R2），handshaking 期 fatal 的 best-effort ERROR 义务已落实；残留面 = 非收口控制器帧仍以 connState 判定（B-2e 重建语义保留） | §10 行 9 登记 delta（73 IT 零触及，已核实）；SA7 F2 锚定 | 剩余精确化（按 epoch 判定）维持 #136 登记：切片 7 真实 WS 适配层一并处理 |
| B-7（R2 新增，SA2 #11） | 生产 adapter 忘接 `bufferedAmount` 属性 → 背压静默失效、无检测面 | 慢消费者场景缺水位闸门保护；per-ns/连接记账三层上限（§11.3）仍有效，内存不失控 | §4.2 R2 已登记契约行为定性（非伪降级） | 切片 7：adapter 启动自检（首读探测「属性在位」+ 日志/metrics 暴露——切片 8 观测面） |

## §16. 移交要点逐条回应（恢复轮补充上下文 + SA6 seam 注记）

| 要求 | 落实 | 位置 |
|---|---|---|
| ① 两级队列两属主两语义不得混同/代管 | ✅ §3.2 对账表 + R0-2 + DENY LIST（namespace-registry 零触碰） | §0/§3.2/§14 |
| ② bufferedAmount 须在「不提前提取 transport-independent seam」纪律内定义最小接缝（fake duplex 测试面 + 真实 WS 观察面） | ✅ 鸭子类型动态属性读取单点（不加接口/不加抽象层/真实 WS number 属性同构直读）；R0-3 成文 | §4.2/§0 |
| ③ 切片 7 认证细节与切片 9 composition root 划出范围 | ✅ 零触碰 apps/**、零新增认证面；仅 send 路径 | §14 DENY |
| ④ 4 红灯转绿 + 73 IT 零回归 | ✅ §9 逐用例走查 + §10 八点回归论证（含逐用例合并触发条件核对） | §9/§10 |
| ⑤ AC-1/AC-3/AC-7 三演示轴已绿，不得以「实现缺失」重做 | ✅ R0-1 + §2 映射表（零状态机改动、零 OPEN/round/close 迁移改动） | §0/§2/§6.5 |
| ⑥ seam 形态明示：bufferedAmount 属性 vs 方法 | ✅ **属性形态**（number，缺省 0）；测试侧零调整 | §1.3-1/§4.2 |
| ⑦ seam 形态明示：saveGates 顺序门闩语义 | ✅ 依赖且不改变（到达序消费）；AC-5 走查按此推演 | §1.3-2/§9 |
| ⑧ seam 形态明示：恢复检查间隔假设 ≤30s | ✅ `BACKPRESSURE_POLL_INTERVAL_MS = 1_000`（冻结常量）；测试侧推进量零调整 | §1.3-3/§4.2 |

---

## SA2 反馈逐条回应（R2 修订，2026-08-28）

> 报告：`wiki/raw/task_phase5-ws-multiplex-backpressure_sa2_review.md`（verdict: reject 窄幅）。
> 约束遵守：架构决策 D1–D11 零推翻（SA2 §6 存活面保持）；本轮全部为精度钉死/登记成文/描述对齐类
> 修订，四红灯走查（§9）、AC 映射（§2）、文件清单（§14）零结构变化。I-1 注记 a/b/c 与 I-4 注记
> 一并入表（SA2 要求落进设计文本）。

| # | SA2 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|---|---|:--:|---|---|
| 1（MAJOR） | §5 合并账务核减口径错误：按合并产物实长核减撕裂三套记账（overflows/facet.queuedBytes/§11.3） | ✅ | §5「账务一致性」条（R2 重写） | 钉死「出队核减 = 被取出各项的**入账字节数之和**（update-channel.ts:69-70 口径）」；合并产物实长只用于 inFlight 记账与 maxUpdateBytes 判据；queuedBytes 恒可从队列直接重算 |
| 2（MAJOR） | peer connectionFatal 直发绕过 ready 门 = wire 可观察变化（handshaking fatal 0→1 ERROR 帧），§10 未登记 | ✅ | §6.3 peer-connection 新增条（R2）+ §10 行 9（R2 新增）+ §15 B-6 状态更新 | 成文「协议 §14 best-effort 义务的有意落实（#136 R-13 收口方向）」；§10 行 9 逐处核实既有 4 处 ERROR 帧断言均在 ready 态（ac1-ac2:262 / ac3:112 / ac5-live:141 / r3-r4:212），零回归成立；SA7 移交 F2 锚 |
| 3（MAJOR） | 耗尽判据谓词未钉死 + lowWater=1 合法极端未登记 | ✅ | §4.3「耗尽判据」新条（R2 钉死）+「合法极端配置的显式登记」新条 + §15 B-2 | 谓词钉死 `controlReserveUsed + frameBytes > lowWater` → 触发帧不发送并收口（SA3 不得用 `used ≥ reserve` 等其他谓词）；缺省配方改精确值 ≈1600+ ACK；`lowWater=1` → 暂停段首控制帧即 1011 显式接受 + 运维下界指导 `lowWater ≥ maxSyncDiffBytes` |
| 4（MINOR） | §5 与代码事实矛盾（超限项「不入队」错误；入队路径无大小门） | ✅ | §5「字节上界与超限项处置」条（R2 重写） | 更正为「照常入队并按原始字节入账，pull 时经 sendUpdateFrame 大小门返回 0 → F4 消费即丢弃」；超限首项时合并帧退化为单项成帧→丢弃，与逐笔语义一致，合法项不受牵连 |
| 5（MINOR） | §6.2 pullAndSendOne 入口前置未成文（漏窗口前置 ⇒ 超窗发射风险） | ✅ | §6.2 pullAndSendOne 条（R2 钉死）+ §6.1 facet 注释同步 | 前置五条成文（live / !needsResync / inFlight<max / queued>0 / 闸门开），任一不满足 → false 且不消费；明示原 flushQueued 循环条件 :125-126 移入单帧前置、无循环可依托 |
| 6（MINOR） | §8 teardown 矩阵缺 GOAWAY scheduleDrainClose 路径（poll timer stale 重武装） | ✅ | §8 新增行（R2） | `scheduleDrainClose()` close 前补 sender.teardown()；stale fire 防御面成文（teardown 后 pollHandle 恒 undefined、零副作用、不重武装） |
| 7（MINOR） | emit 异常传播未规定（OutboundExhaustedError/编码错可穿透回调栈） | ✅ | §6.3 peer-connection 新增条（R2 钉死） | sendUpdateFrame 的 try/catch 明确覆盖 host.sendData 调用 → 统一收敛 seq≤0 → F4；drainData 收 false 按无进展自然终止；任何异常不得穿越 drainData/onAck/onMessage/timer 回调栈；SA4 守卫锚（F7） |
| 8（LOW） | §4.5 轮转细节（游标偏移 / turns 截断依赖） | ✅ | §4.5「调度细节注记」a·b·c（R2 成文） | b. wheel 移除 pass 内游标跳位（偏斜有界，可选「移除不前移游标」）；c. turns 截断非终态——依赖「已发帧 ACK 必再触发 drain」，SA3 不得当队列终态 |
| 9（LOW） | §4.4 Σ==cap 无迟滞边界 | ✅ | §4.4「无迟滞边界登记」条（R2） | 成文：1 字节再入队即再 shed；churn 有界；不引入迟滞水位（R0-4 无字段可承载） |
| 10（LOW） | B-2 风暴闭环未写全 | ✅ | §15 B-2（R2 补全） | 完整闭环（重连→Step2 灌缓冲→暂停→额度耗尽→1011→重连…每循环 ≤2MiB）+ 终止条件（对端恢复读取；backoff 全抖动收敛）+ 运维下界指导 |
| 11（LOW） | §4.2 seam 反向风险（adapter 忘接属性 = 背压静默失效无检测面） | ✅ | §4.2「反向风险登记」条（R2）+ §15 B-7（R2 新增） | 定性成文（契约行为、非伪降级）；切片 7 演进位：adapter 启动自检（首读探测 + 日志/metrics） |
| I-1 注记 a | 恢复窗口直发与 drain 共存带宽分享由水位闸门兜底 | ✅ | §4.5 注记 a | 一句话成文（直发同样逐帧前置观察、过冲 ≤1 帧/方向） |
| I-1 注记 b | （同 #8.b） | ✅ | §4.5 注记 b | 见上 |
| I-1 注记 c | （同 #8.c） | ✅ | §4.5 注记 c | 见上 |
| I-4 注记 | 收口路径幂等不得依赖 transport.closed | ✅ | §4.3「幂等来源明示」条（R2） | 幂等由连接自身状态守卫保证（connState/重入守卫/closedFlag @:345-362/:452）；transport.closed 仅 fast-path |

**修订自查**：① R2 修订共 19 处落文（§4.2×1 / §4.3×4 / §4.4×1 / §4.5×1 / §5×2 / §6.1×1 /
§6.2×1 / §6.3×2 / §8×1 / §10×2 / §15×3——R3 勘误：原计 13 处漏计 §10 行 8 改写与 §15 B-6/B-7
分列），全部为文本级精度钉死与登记，无架构变更；② 关键术语
全文一致（「核减 = 入账字节之和」在 §5/§6.1/§6.2 三处同口径；耗尽谓词在 §4.3 判据/可达性/B-2
三处同数值）；③ SA2 红灯思路 F1–F9 已在对应条款内引用（F2→§6.3/§10 行 9、F3→§4.3、
F7→§6.3），供 SA3/SA7 直接消费。

---

## SA2 反馈逐条回应（R3 修订，2026-08-28）

> 报告：`wiki/raw/task_phase5-ws-multiplex-backpressure_sa2_review.md` §7（R2 复审 verdict:
> reject 窄幅·恰一处 R2-N1）。约束遵守：R1 三 MAJOR 与 #4–#11 均经复审确认通过，本轮仅落实
> R2-N1（一行钉死）+ 7.4 三条次要注记；D1–D11 零改动、结构与锚点保持。

| # | SA2 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|---|---|:--:|---|---|
| R2-N1（MAJOR） | F4 丢弃返回 false × `!progressed → return` ⇒ 超限项消费后 drain 零进展退出、静默连接上合法项无限期滞留（相对 #136 flushQueued 的活性回归）。二选一钉死：A 消费即进展（推荐）/ B false + progressed 按 queuedCount 下降 | ✅ **采方案 A** | §6.2 pullAndSendOne 条（R3 钉死）+ §4.5「进展语义」新条（R3）+ §4.5 伪代码注释 + §6.1 facet 注释 + §5 超限项处置条（「下轮 pull」→「同一次 drain 的后续 pass」）+ §10 行 5 补强 | 钉死「`pullAndSendOne` 返回 true ⇔ 消费了 ≥1 队列项（F4 丢弃也是进展）；false ⇔ 前置任一不满足（未消费）」——`progressed` 语义 = 队列长度下降，与 #136 flushQueued 循环（:122-132 F4 后继续消费）逐语义对齐；同 drain 后续 pass 即拉合法项，不依赖任何未来触发点；全超限队列同一 drain 逐项消费至空（每 true 消费 ≥1 项单调收敛，turns 限额兜底）；§10 行 5 等价声明（含超限项形态）随之成立；搁浅面消除论证 + 活性缺陷成因成文 |
| 7.4-1（精度注记） | §10 行 9 四处断言归类：①② 为 namespace-scope ERROR（路径分离才是零影响原因，非状态）；③ 才是 ready 态 connectionFatal | ✅ | §10 行 9（R3 归类精度修正） | 重写为两类：namespace-scope ×3（经公共 sendControl，路径分离、与状态无关）+ ready 态 connectionFatal ×1（现流程门放行、直发同帧零 delta）；结论（零回归）不变，SA2 复审已独立重验 ✓ |
| 7.4-2（计数勘误） | 文末自查「13 处」与实际枚举有出入 | ✅ | 文末修订自查① | 勘误为 19 处（补计 §10×2 / §15×3，标注 R3 勘误与漏计来源） |
| 7.4-3（运维联动） | B-2 下界指导 `lowWater ≥ maxSyncDiffBytes` 需补 highWater 联动（否则构造期 TypeError） | ✅ | §15 B-2 缓解列（R3 补注） | 补「该指导下 highWater 须同步上调（validate `lowWater < highWater`，只调一端构造期 TypeError；数据闸门阈值随之变大属预期代价）」 |

**R3 自查**：① 本轮 4 项全部为钉死/登记/勘误级文本修订（6 处落文），无架构与行为面变更（方案 A
是把 R2 文本的返回值语义对齐到 #136 flushQueued 既有活性语义，非新行为）；② 「消费即进展」在
§4.5（进展语义条 + 伪代码注释）/ §6.1（facet 注释）/ §6.2（返回值钉死）/ §5（同一次 drain 后续
pass）/ §10 行 5（等价性补强）五处同口径；③ SA2 R2 版红灯思路（超限项 + 合法小更新 + settleUntil
收敛断言）与 F1–F9 一并供 SA3/SA7 消费——该红灯在方案 A 下转绿（合法项经同 drain 后续 pass 到达
对端、超限项零 UPDATE wire 帧）。
