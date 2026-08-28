# SA1 设计 — issue #161 ws-replication 协议/生命周期加固（PR #160 post-review）

**Status**: R2 修订（落实 SA2 R1 reject 全部攻击点 A1–A11 + SA8 附注） | **Author**: SA1 | **Date**: 2026-08-29
**R2 修订摘要**：§3 组按 A1/A2/A5/A7 重写（水位检查点起挂条件、总队列记账口径与 shedding 滞回、dropData 语义定案、pendingData 记账出口不变量）并逐帧重推三例红灯锚；§1.1 AC1 第二锚按 A3 定锚形态（§3.8 裁决 2）；AC5-RR 替换构造并入 A4 强制修正（§3.8 裁决 1）；A6/A8–A11 与 SA8 编辑性附注全部落实（逐条映射见 §13 表）。
**任务**: Bug 修复（6 组 required fixes 共 21 项，其中 18 项缺陷确认 + 3 项范围澄清）
**输入**: 任务简报 `task_ws-replication-hardening.md`；SA5 缺陷分析 `20260828-bug-ws-replication-hardening.md`；SA6 红灯契约 `task_ws-replication-hardening_sa6_red.md`（15 例红灯，实测基线 **15 failed / 82 passed / Type Errors none**，本设计期复核一致）；相关决议 `_relevant_decisions.md`（ADR-0010/0008/0009 约束基准）。
**红线**: 本文档为唯一产出；零源码改动（`git status` 仅 4 个 wiki 文件 + 2 个 SA6 红灯测试，与 SA5 审计一致）。

---

## §0. 设计总纲与根因定位

**总根因**（承 SA5，本设计期逐条源码复核确认）：PR #160 交付了协议 happy path，但加固面系统性缺失，呈现三种形态：

1. **契约先行、运行时为零**：`maxQueuedBytesPerConnection/lowWater/highWater`（`types.ts:26-28`）仅类型+校验；`CONNECTION_BACKPRESSURE`（`replication-protocol/src/errors.ts:27,108`，fatal/1011）零发出；Upgrade 受信身份无入参面。
2. **机制已建成但被旁路**：`OutboundQueue` 数据面（`frame-io.ts:102-104,124-127,135-148,165-171`）无入队 API、`sendData` 零调用者——UPDATE 实际走 `sendControl` 控制路径（`peer-namespace.ts:714-724` / `hub-namespace.ts:630-639`）；hub `declareHubResync()`（`hub-namespace.ts:612-622`，记忆化 RESYNC_REQUIRED）被 `onAckTimeoutFired`（L624-626）旁路。
3. **同步性/代际纪律缺失**：CLOSE 处理不同步停接纳（peer 侧 `peer-namespace.ts:457-471` 根本不进 closing）；peer 传输回调未绑连接代际（`peer-connection.ts:199-200`）；hub `onRoundSettled`（`hub-namespace.ts:725-737`）仅判终态，'closing' 可被复活为 'live'。

**设计原则**：

- **唯一 wire contract**：`docs/protocols/instance-replication-v1.md`（§2/§6/§8.2/§9.4/§12/§13.1/§14/§15/§16/§17/§18）+ ADR-0010 条款为行为基准；本设计不修改协议文本，只补实现。
- **冻结面最小演进**：公共契约类型（SA6 冻结）仅做**加性**扩展（可选成员/可选参数），保持 `ws-replication-api.test-d.ts` 既有断言绿（`toMatchTypeOf` 为单向赋值检查，源类型新增可选成员不影响向既有目标形状的赋值——依据见 §11 假设表 #12）。
- **拒绝虚假降级**：受信身份缺失 = 宿主接线 bug → **构造期/accept 期响亮 TypeError**，绝不静默回退采信 wire 身份（任务简报明令："do not authorize using an identity asserted only by the wire frame"）。
- **单一权威机制**（G5.3）：出站调度唯一权威 = 改造后的 `OutboundQueue`（控制优先 + per-ns 数据 round-robin + 水位 + shedding）；生命周期收口唯一权威 = 既有 closeQueue/closeMemo 链；删除四处置死抽象。
- **确定性测试 seam**：一切延迟经注入 `ReplicationTimer` 或新增 `deferTask` seam；生产代码零裸 `queueMicrotask` 循环（G5.2）。

**修复组 → 设计节映射**：G1→§1；G2→§2；G3→§3；G4→§4；G5→§5；G6→§6。验收标准映射见 §7。**§3.8 为测试构造裁决清单**（AC5-RR 构造调整已获 SA2 R1 批准；AC1 第二锚锚形态按 A3 于 R2 定案）。

**引用约定（R2，SA8 附注落实）**：
- 「协议 §N」= `docs/protocols/instance-replication-v1.md`（唯一 wire contract）；
- 「P5 §N」= PR #160 切片设计稿 `wiki/raw/task_phase5-ws-namespace-sync_design.md` 的章节（源码注释同款引用，如 `peer-namespace.ts` 注释中的 §13.4/§10.6 等）；
- 不带前缀的「§N」= 本设计文档自身章节。R1 中混写的裸 §13.4/§14.1/§10.1/§10.6/§11.3 等已在 R2 全部改为带前缀引用。

**术语区分（SA8 附注落实）**：「**连接代际**」（connection epoch；`peer-connection.ts:44-46` 的 `connectionEpochValue`，每次拨号 +1，用于迟到回调判别）与冻结词「**复制代际**」（replication epoch；CONTEXT.md「从 1 开始、只由 Hub 显式提升的安全整数」，与 replicationId 共同构成复制谱系）是两个不相交概念——本设计仅涉及前者；后者出现在 §1.1 的身份校验面（replicationId/replicationEpoch 字段），全文无混用。

---

## §1. D1 — 认证与连接代际（G1.1/G1.2/G1.3）

### 1.1 G1.1+G1.2：`accept()` 绑定 Upgrade 受信身份，HELLO 自述身份只做一致性校验

**契约演进**（加性，可选参数）：

```ts
// types.ts（新增导出类型 + HubReplication.accept 可选第二参）
/** HTTP Upgrade bearer-token 验证的受信产物（协议 §2：成功认证至少产生可信 Peer
 *  instanceId）。由宿主（切片 9 组合根）在 Upgrade 验证通过后传给 accept()。 */
export interface UpgradeIdentity {
  readonly peerInstanceId: string; // 文法 ^[a-z][a-z0-9-]{0,62}$（§6.1）
}

export interface HubReplication {
  accept(transport: DuplexTransport, identity?: UpgradeIdentity): HubConnection;
  // ...
}
```

**accept() 语义**（`HubReplicationImpl.accept`）：

```ts
accept(transport: DuplexTransport, identity?: UpgradeIdentity): HubConnection {
  if (identity === undefined) {
    // 响亮拒绝（拒绝虚假降级立法）：协议 §2 规定每条 Upgrade 后连接必有受信身份；
    // 缺失 = 宿主未接线 bearer 验证产物 = 上游 bug，不是降级场景。
    throw new TypeError(
      'HUB_ACCEPT_IDENTITY_REQUIRED: accept(transport, identity) 需要Upgrade认证产物' +
      '（协议§2：bearer token 验证产生的可信 peerInstanceId；不得采信 HELLO 自述身份）',
    );
  }
  validateInstanceId(identity.peerInstanceId, 'identity.peerInstanceId'); // 复用 INSTANCE_ID_RE
  const connection = new HubConnectionImpl(this.internals, transport, identity, this.connectionCounter);
  // ...（现有逻辑不变）
}
```

**HubConnectionImpl 改造**：

1. 构造器保存 `private readonly trustedIdentity: UpgradeIdentity`。
2. `onHello`（`hub-connection.ts:191-229`）在现有 `expectedHubInstanceId` 校验（L202-204）之后、版本协商之前**新增第一条校验**：

```ts
if (message.peerInstanceId !== this.trustedIdentity.peerInstanceId) {
  // §6.1 L120「peerInstanceId … 必须等于 Upgrade 身份」；冒充在一切下游（版本协商、
  // HELLO_ACK、namespace 授权）之前收口
  this.connectionFatal('INSTANCE_IDENTITY_MISMATCH', 1008);
  return;
}
```

3. 授权身份源切换：`channelHost.peerInstanceId`（L136-137）改为 `() => this.trustedIdentity.peerInstanceId`——`authorize(instanceIdentity, …)`（消费点 `hub-namespace.ts:205`）与 `openReplicationSession({ remoteInstanceId })`（L281）**只消费受信身份**。由于 HELLO 不匹配即 fatal，握手成功后两者恒等；以受信值为准是简报的字面要求。
4. 公共投影 `peerInstanceId: string | undefined`：保持现有语义（HELLO 成功后置值），赋值来源改为 `this.trustedIdentity.peerInstanceId`（L215 的 `= message.peerInstanceId` 删除——不再从 wire 赋值）。

**AC1 红灯闭环（R2，A3 修正）**：`accept(wire.hubEnd, { peerInstanceId: 'peer-alpha' })` + HELLO 自述 `'peer-loki'` → fatal：ERROR `INSTANCE_IDENTITY_MISMATCH`（connectionErrorFrame，经控制路径 best-effort）+ `transport.close(1008)`（同步置 `hubSideClosed`）→ `authorize` 零调用 ✓ + ERROR 帧含该码 ✓。
**第二锚锚形态定案（A3）**：原断言 `hub.connections[0]?.state === 'closed'` 在本设计下**不可满足**——`connectionFatal` → `cleanupAll()`（零 channels → `Promise.all([])` ≈2 跳）→ `dropConnection` 将连接从 `hub.connections` 摘除，而 AC1 断言前有两次 `settle()`（600 跳）→ `connections[0]` 必为 `undefined`。R2 选型：**保留 prompt-drop 生产语义**（死连接及时摘除 = 资源卫生；「滞留至宿主显式清除」会为被拒握手引入死条目累积），**测试锚替换**为 `wire.hubSideClosed === true` + `hub.connections.length === 0`（drop 即正确收口证据）——完整替换断言组与推演见 **§3.8 裁决 2**（与 AC5-RR 同列入测试构造裁决清单，SA2 R1 §四已列为同类裁决项）。

### 1.2 G1.3：peer 传输回调绑定连接代际 + 退订

**根因**：`peer-connection.ts:199-200` 闭包跨代际共享 FSM，且 `onMessage/onClose` 返回的退订函数被丢弃；重建后 `expectedSeq=1`（L185），旧 socket 迟到 seq=1 帧可通过序列检查（`peer-connection.ts:212-213` 仅按状态门禁）；旧 socket 迟到 close 把新连接打进 backoff（`onClose` → `onTemporaryFailure`，L427-438/463-480）。

**改造**（`dialNow`，`peer-connection.ts:165-201`）：

```ts
private dialNow(): void {
  if (this.stopping) return;
  this.clearBackoff();
  this.unsubscribeTransport();          // ← 新增：退订上一代 transport 回调（卫生；主防线是代际闸）
  this.connectionEpochValue += 1;
  const epoch = this.connectionEpochValue;   // ← 当代代际捕获
  // ...（dial / outbound 构造 / HELLO 直发不变）
  this.transportSubscriptions = [
    transport.onMessage((bytes) => {
      if (this.connectionEpochValue !== epoch) return;  // P5 §13.4 代际纪律：迟到帧静默丢弃
      this.onMessage(bytes);
    }),
    transport.onClose((info) => {
      if (this.connectionEpochValue !== epoch) return;  // 迟到 close 不得触发 backoff/状态迁移（P5 §13.4）
      this.onClose(info);
    }),
  ];
}

private unsubscribeTransport(): void {
  for (const off of this.transportSubscriptions) off();
  this.transportSubscriptions = [];
}
```

要点：

- **双重防线**：代际闸（闭包捕获当次 epoch，回调先验后入）+ 主动退订（`dialNow`/`stop()`/`enterBlocked` 时调用 `unsubscribeTransport()`）。代际闸是正确性主防线（退订前的在途事件也被拦）；退订是资源卫生。
- 静默丢弃是**正确语义而非虚假降级**：旧 socket 事件对替代连接而言结构性迟到（P5 §13.4「已终局/连接已断/已重建」迟到收口域——`peer-namespace.ts:859-862` isConnectionDead 注记同款纪律），与 SA5 分析一致。
- hub 侧天然隔离（每次 `accept()` 新建独立 `HubConnectionImpl`），但对称补齐：`hub-connection.ts:146-147` 的退订句柄同样保存并在 `cleanupAll()` 退订（防御未来复用）。
- `requestRebuild` 自身 `transport.close(1000)`（L496-498）产生的 close 事件：若同步到达（epoch 未变）行为同现状；若微任务后到达（epoch 已 +1）被闸丢弃——消除现状中重建路径 spurious backoff 的竞态窗口（现状依赖 `onClose` 的状态门禁兜底）。

**AC2a/AC2b 红灯闭环**：`removeTarget → addTarget` 触发 `requestRebuild`（P5 §14.1 整连接重建——`peer-connection.ts:127-129` 注释同款引用）→ 新连接 ready/live（epoch=2）→ 旧 wire（epoch=1 回调）注入 seq=1 帧 / `closeHubSide(1000)` → 代际闸丢弃 → 新连接保持 `ready`、namespace 保持 `live` ✓。

---

## §2. D2 — ACK 关联与恢复（G2.1–G2.4）

### 2.1 G2.1：BOOTSTRAP_ACK 序列关联（hub 侧）

`hub-namespace.ts`：

```ts
// 状态字段（新增）
private bootstrapSnapshotSeq: number | undefined;

// startBootstrap（L397-403）：留存发送序
const seq = this.sendChecked({ kind: 'BOOTSTRAP_SNAPSHOT', /* … */ });
this.bootstrapSnapshotSeq = seq > 0 ? seq : undefined;  // 发送失败（连接收口）→ 无可关联序
this.armTimer('bootstrap');

// onBootstrapAck（L412-423）：先验关联
onBootstrapAck(message: { ackedSequence: number }): void {
  if (this.state !== 'bootstrapping') { /* 现有违例路径不变 */ }
  if (this.bootstrapSnapshotSeq === undefined ||
      message.ackedSequence !== this.bootstrapSnapshotSeq) {
    // §8.2 L197「ackedSequence = BOOTSTRAP_SNAPSHOT sequence」；错配走 UPDATE_ACK 同款
    // 违例策略（§6/ADR L147「错误ACK关联关闭连接」）
    this.host.connectionFatal('ACK_STATE_VIOLATION', 1002);
    return;
  }
  this.clearTimer('bootstrap');
  this.bootstrapSnapshotSeq = undefined;   // 一次性消费
  this.setState('reconciling');
}
```

**违例策略选型**：`ACK_STATE_VIOLATION` connection fatal（1002）——沿用 UPDATE_ACK 先例（`update-channel.ts:74-86` violation → `hub-namespace.ts:492-499` fatal）；SA6 AC3a 断言 `hubFrames('ERROR')` 含 `ACK_STATE_VIOLATION` 且 `waitConnection('blocked')`（hub close(1002) → peer `onClose` 1002 → `enterBlocked`）✓。发送失败（seq≤0）时 `bootstrapSnapshotSeq === undefined` → 任何 ACK 均错配 fatal——此时连接已在收口路径上，fatal 为同一终局。

### 2.2 G2.2：CLOSE_OK 序列关联（peer 侧）

`peer-namespace.ts`：

```ts
// 状态字段（新增）
private closeNamespaceSeq: number | undefined;

// removeTarget 'closing' 分支（L519-526）：留存发送序
this.setState('closing');
this.armTimer('close');
const seq = this.sendChecked({ kind: 'CLOSE_NAMESPACE', /* … */ });
this.closeNamespaceSeq = seq > 0 ? seq : undefined;   // 发送失败 → 只能 closeTimeout 收口
return this.ensureCloseMemo();

// onCloseOk（L473-481）：接收端校验（dispatch 侧同步传参，见下）
onCloseOk(ackedSequence: number): void {
  if (this.state !== 'closing') return;                       // 非 closing：迟到/重复帧，静默
  if (this.closeNamespaceSeq === undefined) return;           // 无可关联序：不完成 close
  if (ackedSequence !== this.closeNamespaceSeq) return;       // §12 L311：错配不完成 close
  this.clearTimer('close');
  this.setState('closed');
  this.settleCloseMemo();
}
```

`peer-connection.ts:307-309` dispatch 改为传参：`this.withController(message.namespaceId, (c) => c.onCloseOk(message.ackedSequence))`。

**违例策略选型**：错配 → **忽略并保持 closing**（closeTimeout 兜底本地收口），**不是** connection fatal。依据：(a) 简报措辞差异——G2.1 是 "must follow the protocol violation/error policy"，G2.2 是 "invalid ACK correlation must not complete close"（仅要求不完成收口）；(b) 协议 §12 L312「正常 close 不等待丢失的 UPDATE_ACK；下次连接通过 state vector 修复」——close 路径按设计是丢包容的，错配 CLOSE_OK 视为丢失/陈旧帧、交由 closeTimeout 收口；(c) 多 namespace 复用一条连接时，收口期连接级 fatal 会放大爆炸半径（§: 普通超限关单个 channel，framing/认证才关整条连接）。SA6 AC3b 断言 `not.toBe('closed')` + `closeSettled === false` + 5s 后 closeTimeout → closed ✓（契约文件明示两种等价锚「保持 closing 或停连接」，本设计取前者）。

### 2.3 G2.3：hub ACK 超时 → 记忆化 RESYNC_REQUIRED（恢复死锁修复）

`hub-namespace.ts:624-626` 改为复用既有记忆化声明机制：

```ts
private onAckTimeoutFired(): void {
  // §18 L520「ACK timeout → needs-resync + 新 round 修复」+ §9.4 L248「恢复恒由 peer
  // 发起，hub 声明是唯一通路」——UPDATE_ACK 超时与队列溢出（协议 §17 上半节/P5 §10.2）同机制声明。
  this.declareHubResync();   // L612-622：resyncDeclared 记忆化 → 恰一帧 RESYNC_REQUIRED
                             // + setState('needs-resync')；quiet-state 守卫不变
}
```

不新增任何机制——`declareHubResync()` 已被队列溢出（L604-608）与 watchdog 边沿（L561-570）调用并被注释自证语义；本修复把 ACK 超时路径接入同一声明面。记忆化清零点保持 `onRoundSettled`（L734，需 §4.3 守卫保护）。

**AC4-1/AC4-2 红灯闭环**：peer saveGate 悬挂 apply → hub UPDATE 无 ACK → `advanceBy(ackTimeoutMs)` → `abandonInFlight`（zombie 备案）→ `onAckTimeoutFired` → `declareHubResync` → wire 上恰 1 帧 `RESYNC_REQUIRED` ✓；peer `onResyncReceived`（`peer-namespace.ts:418-423`：markResyncReceived + needs-resync + **同步** `maybeStartRecovery()`——不经 deferRecovery seam，无在途窗口阻塞）→ roundId+1 恢复 round → 双向 diff 收敛 n=9 ✓。

### 2.4 G2.4：ACK 计时器按「最老剩余在途」重挂

`update-channel.ts`：现状 `armAckTimer()` 带 `ackTimerArmed` 单次挂载守卫（L160-168），`onAck` 仅在 `inFlight.size === 0` 时 disarm（L74-79）——部分进度（最老在途被 ACK、窗口非空）时计时器仍锚定本窗口第一帧发送时刻，持续流量下新 flush 帧只有残余预算即被 `abandonInFlight` 整窗弃置 → 周期性假性 needs-resync。

```ts
// onAck（L74-79）改造：最老在途被 ACK 且窗口非空 → 重挂（disarm + arm，锚点回到 now）
onAck(sequence: number): 'ok' | 'zombie' | 'violation' {
  if (this.inFlight.has(sequence)) {
    const wasOldest = sequence === this.oldestInFlightSeq();
    this.inFlight.delete(sequence);
    if (this.inFlight.size === 0) this.disarmAckTimer();
    else if (wasOldest) { this.disarmAckTimer(); this.armAckTimer(); }  // ← 重挂
    this.flushQueued();
    return 'ok';
  }
  /* zombie / violation 不变 */
}

private oldestInFlightSeq(): number {
  let min = Number.MAX_SAFE_INTEGER;
  for (const seq of this.inFlight.keys()) min = Math.min(min, seq);
  return min;
}
```

- 乱序 ACK（ACK 到达序 ≠ 序列序）：仅当被 ACK 的恰为最老在途时重挂；非最老被 ACK 时最老锚点未变，不重挂。
- **锚点语义声明（R2，A6 修正）**：重挂锚点是「最老剩余在途的上一次观测点（前一最老的 ACK 到达时刻）」——是**下界近似**而非逐帧发送时刻锚定（无注入 clock seam 时 `t_send` 不可锚定；最老剩余在途帧实际获得 `[t_ack, t_ack+T] ⊇ [t_send, t_send+T]` 预算）。宽松方向无正确性损害：ACK 超时是活性启发而非正确性期限（协议 §18 无逐帧 deadline 语义，只要求「不重发同一 UPDATE、进入 needs-resync」），验收措辞「correctly re-armed」按本近似语义满足——部分进度后窗口不再被陈旧锚点整窗弃置。
- `maxInFlightUpdates` 上界（默认 32；测试可到 512）内 `Math.min` 扫描成本可忽略。
- §3.5 的改造使 ACK 计时器在**实际出队派发**时 arm（`onDataDispatched` 回调内）——新帧的计时起点即真实发送时刻；本节重挂覆盖「部分进度」面，二者合流后 §18 超时语义在近似精度内完整。

---

## §3. D3 — 背压与公平（G3.1–G3.5，整组新建连接级数据面）

> **R2 修订**：本组按 SA2 A1/A2/A5/A7 重写——水位检查点起挂条件（A1）、总队列记账口径与 shedding 滞回（A2）、dropData 接线语义定案（A5）、pendingData 记账出口不变量（A7）。全部红灯锚已在 §3.7 按修订后伪码逐帧重推。

### 3.0 层级模型（总览）

```
UpdateChannel（每 ns、每方向，既有）             OutboundQueue（每连接、每方向，本设计改造）
┌────────────────────────────────┐              ┌─────────────────────────────────────────┐
│ deliver(live|deferred)          │   handoff    │ controlQueue（控制优先、恒可 dispatch、    │
│  ├ 窗口开放 → host.sendData ────┼─────────────→│  有界保留额度）                          │
│  │   (pendingData 计数入窗口)    │              │ dataQueues[ns] + dataOrder + cursor      │
│  └ 窗口满 → queued[]（既有界）   │              │  （round-robin：每轮每 ns 至多一帧）      │
│ onAck/onDataDispatched/onShed   │←─────────────┤ enqueueData / drain / checkpoint timer   │
│  inFlight/zombie/violation      │  callbacks   │ 水位（bufferedAmount）/ shedding / 1011  │
└────────────────────────────────┘              └─────────────────────────────────────────┘
```

- **per-namespace 界限不变**（协议 §17 上半节，已实现：`update-channel.ts:101-107` maxQueuedUpdateCount/Bytes、L53 maxInFlightUpdates、溢出丢弃+needs-resync）。
- **connection 级面新建**（协议 §17 下半节）：per-ns 队列 + round-robin + 总量上限 shedding + 控制保留额度 + bufferedAmount 水位。
- **序列纪律保持**（frame-io.ts 头注冻结纪律/R3/#7）：序列号仍在 `emitOne` 实际出队发送时单点分配；数据帧入队项不携带、不预占序列。`UpdateChannel` 的 in-flight 登记移至**实际派发回调**（`onDataDispatched(sequence)`）。
- **handoff 边界（A5 定案，§3.5）**：帧一经 `host.sendData` 交给连接队列即进入「已接纳」域，出口恰三（派发 / 连接级 shed / teardown）；handoff **之前**的丢弃（窗口溢出等）属 UpdateChannel 既有语义。

### 3.1 G3.1+G3.2：UPDATE 走真实 per-ns 数据队列 + 连接级 round-robin

**发送链改造**（双侧对称）：

- `HubChannelHost` / `PeerNamespaceHost` 新增成员：`sendData(message: ReplicationMessage): void`（handoff 入队；不返回序列——序列在实际派发时分配）与 `dropData(namespaceId: string): void`（按 §3.5 定案的语义面丢弃该 ns 连接级未发送数据帧）。
- `peer-namespace.ts:714-724` / `hub-namespace.ts:630-639` 的 `sendUpdateFrame` 从 `sendChecked(…UPDATE…)` 改为 `host.sendData({kind:'UPDATE', namespaceId, update:bytes})`；超限丢弃（byteLength > maxUpdateBytes → 不 handoff，由恢复 round diff 修复）语义不变（handoff 前丢弃，不违反边界）。
- **`sendData` 契约（A7）**：返回 void；连接层保证每帧 handoff 后恰一出口——`onDataDispatched`（实际派发）/ `onDataShed`（任何连接级丢弃）/ `teardown` 清零。peer 侧连接状态门（B-2e：非 ready 期 handoff）从「静默丢」改为「丢 + `onDataShed`」（丢失必须以 needs-resync 声明显影，不允许静默吞帧面）。

**OutboundQueue 数据面**（替换 `frame-io.ts:98-189` 中死置部分）：

```ts
export class OutboundQueue {
  // …controlQueue / lastSeq 既有…
  private readonly dataQueues = new Map<string, ReplicationMessage[]>();
  private readonly dataOrder: string[] = [];        // ns 注册序（通道建立时登记）
  private dataCursor = 0;
  private queuedDataBytes = 0;                       // 连接级数据排队字节
  private paused = false;                            // 水位暂停（仅约束数据面）
  private checkpointHandle: unknown | undefined;     // 水位检查 timer（注入 timer）

  /** 数据帧 handoff 入队（UPDATE 专属路径）：总队列核算（§3.2）→ 排队 → drain → 检查点在挂。 */
  enqueueData(namespaceId: string, message: ReplicationMessage): void {
    this.registerDataNamespace(namespaceId);          // 幂等登记 dataOrder
    const bytes = message.update.byteLength;
    // §3.2 滞回（触发 > max / shed 到 queued ≤ lowWater）：触发看总队列（queued + buffered，
    // socket 缓冲即传输队列的延伸——R2 口径）；shed 只作用于 queued 侧（buffered 不可撤回，
    // 由暂停（规则 A）与 1011（规则 C）承接）。
    if (this.pipelineBytes() + bytes > this.limits.maxQueuedBytesPerConnection) {
      while (this.queuedDataBytes > this.limits.lowWater) {
        const victim = this.largestQueuedNamespace(); // 协议 §17 L490：按最大 queued ns 整队丢弃
        if (victim === undefined) break;              // queued 侧已 ≤ lowWater 或已空
        this.shedNamespace(victim);                   // 丢该 ns 全部排队帧 + onDataShed 声明
      }
      // queued 侧已压到 ≤ lowWater（或本就空）而总队列仍 > max：无可 shed 面——按断点接纳
      //（不丢弃 incoming：溢出有界于检查点周期内的派发流量，且 buffered 侧超限由规则 C
      // 在下一检查点收口；A5 边界下 handoff 帧不回退丢弃）
    }
    this.dataQueues.get(namespaceId)!.push(message);
    this.queuedDataBytes += bytes;
    this.drain();
    this.ensureCheckpoint();                          // A1：dispatch/排队/buffered 任一在途即挂
  }

  /** 总队列 = queuedDataBytes + bufferedAmount()（R2 记账口径，§3.2）。 */
  private pipelineBytes(): number {
    return this.queuedDataBytes + this.deps.bufferedAmount();
  }

  /** 控制帧路径（既有 sendControl 语义保持：控制恒先、立即排空、不受数据暂停约束）。 */
  sendControl(message: ReplicationMessage): number { /* 既有：push + drain */ }

  /** 排空：控制全部先行；数据每轮每 ns 至多一帧（round-robin，持久游标）。 */
  drain(): void {
    while (this.controlQueue.length > 0) {
      const item = this.controlQueue.shift()!;
      this.emitOne(item);                             // 编码错沿 sendChecked 同族收编（连接层
    }                                                 // catch → best-effort ERROR；A7 捕获点）
    while (!this.paused && this.queuedDataCount() > 0) {
      const nsId = this.nextDataNamespace();          // 既有 dataCursor 轮转逻辑（启用）
      if (nsId === undefined) return;
      const bucket = this.dataQueues.get(nsId)!;
      const item = bucket.shift()!;
      this.queuedDataBytes -= (item as { update: Uint8Array }).update.byteLength;
      try {
        const seq = this.emitOne(item);               // 序列在实际发送时分配（R3/#7）
        this.deps.onDataDispatched(nsId, item, seq);  // → 通道 in-flight 登记 + ACK 计时器
      } catch (err) {
        if (err instanceof OutboundExhaustedError) throw err;  // 连接收口路径接管（dispose 全量 shed）
        // 单帧编码错（结构性不可达——handoff 前 maxUpdateBytes 门 + validate 预算链）：
        // 该帧按 shed 计（onDataShed）+ best-effort ns ERROR，不断连接、不中断 drain 记账
        this.deps.onDataShed(nsId);
        continue;
      }
      if (bucket.length === 0) this.unregisterDataNamespace(nsId);
    }
  }
}
```

- **round 语义**：一次 `drain` 的数据循环 = 若干完整轮转；每轮每 ns 至多一帧（`nextDataNamespace` 游标推进）。游标跨 drain 持久——上一轮刚发送过的 ns 在下一轮恢复公平位置。
- **控制优先的绝对性**：控制队列在任何 `drain` 入口先排空；数据暂停（`paused`）不约束控制帧（AC5-PRI 锚）。
- 构造器扩展：`(emitRaw, limits, onSequenceExhausted, deps: { timer, checkpointIntervalMs, bufferedAmount: () => number, onDataDispatched, onDataShed, onControlExhausted })`——hub/peer 连接层装配时注入。`dispose()`（连接收口/重拨）= 清 checkpoint timer + `clear()` + 对全部排队数据帧逐 ns `onDataShed`（A7：teardown 也是显式出口，不留静默清队列）。

**UpdateChannel 侧配套**（窗口记账覆盖「已 handoff、未实际发出」的帧；A7 不变量）：

```ts
// UpdateChannelHost 新增：enqueueUpdate handoff + dropData 丢弃；sendUpdateFrame 语义退役。
deliver(bytes, 'live'):
  if (this.needsResync) return;                       // 既有（handoff 前丢弃面）
  if (this.inFlight.size + this.pendingDataCount < maxInFlightUpdates) {
    this.pendingDataCount += 1;
    this.host.enqueueUpdate(bytes);                   // → host.sendData(message)（handoff）
    return;
  }
  /* 既有：入 queued[] / 溢出 → discardQueued + declareLocalResync|notePendingResync */

onDataDispatched(bytes, sequence):                    // 连接层实际派发回调（出口 1）
  this.pendingDataCount -= 1;
  this.inFlight.set(sequence, bytes);
  this.armAckTimer();

onDataShed():                                         // 连接层丢弃回调（出口 2；teardown 为出口 3）
  this.pendingDataCount = 0;
  this.needsResync = true;
  this.discardQueued();
  // 声明由宿主控制器负责（hub: declareHubResync；peer: declareLocalResync——均记忆化）

// flushQueued（A7）：循环条件纳入 pendingDataCount——窗口不变量在 flush 路径不被自破
flushQueued():
  while (!this.needsResync
      && this.inFlight.size + this.pendingDataCount < this.host.limits.maxInFlightUpdates
      && this.queued.length > 0) { /* pop → handoff（pendingData+1） */ }
```

**pendingData 记账不变量（A7）**：`pendingDataCount` 的减一出口恰三——`onDataDispatched` / `onDataShed` / `teardown` 清零；连接层任何丢弃路径（非 ready 门、shed、dispose、编码错）一律经 `onDataShed` 显影，不存在第四种静默出口。transport 已关时的派发（emitRaw 守卫跳过 `transport.send` 但序列已分配）不算丢弃：该帧按已派发记账，ACK 由 ackTimeout/zombie 纪律收尾（既有容忍语义）。

### 3.2 G3.3：总队列记账口径与 shedding 滞回（R2 定案）

**记账口径（A2-1）**：「总队列」= **`queuedDataBytes + bufferedAmount()`**——socket 缓冲（已派发未冲刷）是传输队列的延伸；SA6 慢 socket wire 的 `bufferedAmount` getter（g3-g4 红灯文件 L184-189）即按此语义构造。该口径同时给规则 C（§3.3）自然的阈值依据。

**滞回语义（A2-2，触发/停机解耦）**：

- **触发**：handoff 时 `pipelineBytes() + incomingBytes > maxQueuedBytesPerConnection`；
- **停机**：按最大 queued ns **整队丢弃**并声明 needs-resync（`onDataShed` → 记忆化 RESYNC_REQUIRED），持续到 **`queuedDataBytes ≤ lowWater`**（协议 §17 L490「直到回到低水位」字面）或 queued 侧已空；
- queued 侧已到停机线而总队列仍 > max（buffered 主导）：无可 shed 面 → 按断点接纳（不丢 incoming）；残余压力由暂停（规则 A）停止增量、规则 C 在检查点收口。溢出有界于一个检查点周期内的派发流量。

R1 版「shed 到能塞进 max 即停」的循环条件已删除（与协议 L490 矛盾，SA2 A2 指认）。

- shed 的对象恒为**未发送增量**（已 handoff 未派发的排队帧）；已在 socket 缓冲的帧不可撤回，仍按在途等 ACK/zombie 备案。
- 声明去重：通道侧 `resyncDeclared` 记忆化（hub `declareHubResync` / peer `declareLocalResync`）保证每个恢复周期至多一帧 RESYNC_REQUIRED。
- 控制帧字节独立于数据预算（= 控制保留额度，见 §3.3）。
- **单帧超限边界**：若 `maxQueuedBytesPerConnection < maxUpdateBytes`（病态配置），单帧 handoff 即触发且无可 shed 面 → 按断点接纳——超限量结构性有界于 `maxUpdateBytes`，下一检查点规则 C 必然评估；不静默、不回绕。

### 3.3 G3.4：控制帧保留额度与 `CONNECTION_BACKPRESSURE`

- **保留额度的实现形态**：控制帧不进入数据容量核算、不受数据暂停约束（结构性「为控制保留的发送能力」）；`controlQueue` 在 drain-on-enqueue 下长度结构性趋零，其**耗尽判定**放在水位检查点（§3.4 规则 C）：数据 shedding 已无法再降低管线（无可丢弃的排队数据）而 socket 缓冲仍超出连接总预算时，控制帧的继续派发只会推高不可冲刷的缓冲 → 视为控制保留额度耗尽。
- **终止动作**：经 `onControlExhausted` 回调连接层 → `connectionFatal('CONNECTION_BACKPRESSURE', 1011)`（错误码已在协议包注册：fatal/retryable=yes/1011；本包首次发出）；best-effort ERROR 帧后 `transport.close(1011)`。peer 侧对 1011 close 的分类遵循协议 §15.1（继续 backoff，不永久 blocked）——现有 `onClose` 状态机已满足（1011 非 1002/1008 → 临时失败 → backoff）。
- **阈值口径注记（A9）**：以 `maxQueuedBytesPerConnection` 兼作 socket 缓冲 1011 判定阈值属**解释性选择**——协议 §13.1/§14 只给 1011 语义（「不可恢复内部错误或 control backpressure」）无数值；R2 依据 §3.2 合记口径（socket 缓冲 = 传输队列延伸）把「连接总预算」读作该常量，无新配置面。

### 3.4 G3.5：bufferedAmount 高低水位（注入 timer 检查点；R2 修复 A1）

依据协议 L492「Adapter 观察 WebSocket `bufferedAmount`：超过 high-water暂停 dequeue，降至 low-water恢复。**无 drain event时使用 Cordis Timer调度检查**，不使用原生 timer」——**暂停/恢复均由注入 timer 的周期检查点驱动**（不做发送时刻的同步拦截；该形态对红灯锚的必然性论证见 §3.8 裁决 1 的可行性推演）：

```ts
/** 水位检查点（注入 timer）。R2（A1）：起挂/续挂条件 = paused ∨ 有排队 ∨ buffered > 0——
 *  「队列即时排空、字节滞留 socket 缓冲」的首个 highWater 越线必须在下一检查点可观测；
 *  空闲（三条件皆空）不挂/不再续挂（零空闲 timer，N1 纪律不变）。
 *  规则 A/B 互斥（暂停/恢复）；规则 C 独立判定、与 A 同检查点并列评估（A2-3：不依赖
 *  第二次 checkpoint）。 */
private runCheckpoint(): void {
  this.checkpointHandle = undefined;
  const buffered = this.deps.bufferedAmount();        // transport.bufferedAmount ?? 0
  if (!this.paused && buffered >= this.limits.highWater) {
    this.paused = true;                               // 规则 A：越过 highWater → 暂停数据出队
  } else if (this.paused && buffered <= this.limits.lowWater) {
    this.paused = false;                              // 规则 B：回落 lowWater 以下 → 恢复
  }
  if (buffered > this.limits.maxQueuedBytesPerConnection
      && this.largestQueuedNamespace() === undefined) {
    this.deps.onControlExhausted();                   // 规则 C（§3.3，独立于 A/B）：socket 缓冲
    return;                                           // 超总预算且无可 shed 数据 → 1011 终止
  }
  this.drain();                                       // B 解除暂停后尝试推进
  this.ensureCheckpoint();                            // 续挂判定同起挂条件
}

private ensureCheckpoint(): void {
  if (this.checkpointHandle !== undefined) return;
  if (!this.paused && this.queuedDataCount() === 0 && this.deps.bufferedAmount() === 0) {
    return;                                           // 空闲：不挂（零空闲 timer）
  }
  this.checkpointHandle = this.deps.timer.setTimeout(
    () => this.runCheckpoint(), this.deps.checkpointIntervalMs);
}
```

- **A1 修复要点**：R1 守卫只看「排队」，漏「已派发未冲刷」——首帧派发后队列立即为空、checkpoint 不挂、`paused` 永不置位（生产 canonical 慢 socket 背压失效；AC5-WATER/PRI 恒红，SA2 逐帧推演证实）。R2 起挂/续挂条件补 `bufferedAmount() > 0`。
- **轮询成本注记**：真实 socket 有未冲刷字节期间按 checkpointIntervalMs（100ms 缺省）持续轮询（10Hz/连接）——无 drain event 面下协议 L492 明示的 timer 轮询代价；空闲即停。
- **`DuplexTransport` 加性扩展**（可选成员，缺省 = 无该能力 → `bufferedAmount` 视为 0、无暂停/恢复/1011 判定——包内内存 transport 全部 dormant，既有测试零影响）。**生产接线要求（A11）**：真实 adapter（切片 9）**必须**暴露 `bufferedAmount`（背压前提）与 `ping`/`onPong`（活性前提）；缺面 = 能力真实缺失的 dormant（正确降级），但宿主装配期应 loud 断言（留切片 9 票面，§6）：

```ts
export interface DuplexTransport {
  /* 既有五成员不变 */
  /** socket 缓冲未冲刷字节（真实 WS bufferedAmount 语义；协议 §17 L492 观察点）。缺省视为 0。
   *  生产 adapter 必须暴露（G3.4 背压的前提面）——见 §6 切片 9 票面。 */
  readonly bufferedAmount?: number;
  /** WS 级活性（§5.1）；缺省 = 无活性面（不启用 ping/pong 收口）。生产 adapter 应暴露。 */
  ping?(data?: Uint8Array): void;
  onPong?(listener: () => void): () => void;
}
```

- **checkpointIntervalMs 推导**：`max(1, floor(ackTimeoutMs / 100))`（默认 10_000/100 = **100ms**）。理由：水位轮询粒度取 ACK 超时的 1/100，默认下每秒 10 次检查——对 bufferedAmount 变化的一阶近似足够（协议未给数值；`ReplicationLimits/Timeouts` 冻结面无专属字段，禁止发明新配置）；与 SA6 测试 `advanceBy(100)` 的步进对齐（定时器在 deadline ≤ now+100 时于同次 advance 触发——`createRegistryTestScheduler.advanceBy` 按到期序执行，依据见 §11 #9）。
- **配置校验（A2-3 配套）**：`validateLimits` 新增 `highWater ≤ maxQueuedBytesPerConnection`（构造期响亮 TypeError）——保证可恢复的暂停阈值先于终止性的 1011 阈值（低水位 < 高水位 ≤ 总预算的链式不变量）；既有 WATER/SHED_LIMITS 与缺省值均满足。
- **timer 生命周期**：checkpoint timer 归 OutboundQueue 所有；连接收口（hub `cleanupAll` / peer `stop`/重拨）调用 `queue.dispose()`（clear checkpoint timer + `clear()` + 逐 ns `onDataShed`）——与 hello-timer N1 修复同款纪律。

### 3.5 与 UpdateChannel/状态机的交互完整性与 dropData 语义定案（R2，A5）

**dropData 接线定案**（R1 表格「经 markResyncReceived 路径」的指称错误已修正——`declareHubResync` 不经 `markResyncReceived`，后者是对端 RESYNC 帧的入站处理器 `hub-namespace.ts:520-524`）：

| 触发面 | channel.queued[]（既有语义） | 连接级排队帧（本设计） | 协议依据 |
|---|---|---|---|
| **自声明·溢出族**：UpdateChannel 溢出（hub `onLocalResyncEdge` / peer `declareLocalResync` 溢出路径） | 丢弃（既有 `discardQueued`） | **丢弃**（`dropData`） | 协议 §17 上半节「未发送队列超限：丢弃**全部未发送增量**，标记 needs-resync，停止新 UPDATE」——「全部未发送」覆盖连接级排队帧 |
| **自声明·ACK 超时族**：两侧 `onAckTimeoutFired` | 保留（既有——abandonInFlight 只 zombie 在途） | **保留** | 协议 §18「ACK timeout 不重发同一 UPDATE，而进入 needs-resync并由新 round 修复」——无丢弃面；已 handoff 帧按序派发，ACK/zombie 纪律收尾，恢复 round diff 超集幂等覆盖（yjs 增量幂等） |
| **对端声明**：`onResyncReceived` → `markResyncReceived` | 丢弃（既有） | **丢弃**（`dropData`） | 协议 §9.4「发出后不再发送新 UPDATE」延伸至未发送面；对端已声明连续性作废，排队帧派发只浪费带宽（对端按 diff 修复） |
| **session 溢出边沿**：`markSessionResyncEdge`（§12 R4.2 同构） | 丢弃（既有） | **丢弃**（`dropData`） | 与对端声明同构处置（既有代码即 markResyncReceived 复用） |
| **连接级 shed**（§3.2）/ 连接层丢弃（A7：非 ready 门、dispose、编码错） | —（不触及） | **丢弃**（`onDataShed`，机制自身） | §17 L490 / A7 记账不变量 |

接线点：控制器在各触发面同步调用 `host.dropData(this.namespaceId)`（hub 侧 `onLocalResyncEdge`/`onResyncReceived`/`onWatchdogEdge`；peer 侧 `declareLocalResync`（仅溢出触发点）/`onResyncReceived`/`onWatchdogEdge`；ACK 超时面**不接**）。

**事件交互矩阵**（R2 修正版）：

| 事件 | UpdateChannel | 连接层（OutboundQueue） | 状态机 |
|---|---|---|---|
| live 写、窗口开放 | `pendingData+1` → handoff | `enqueueData`（滞回核算/shed/drain） | 不变 |
| 实际派发 | `onDataDispatched`：`pendingData-1`、inFlight 登记、arm ACK timer | `emitOne` 分配序列 | 不变 |
| 总队列超限 | — | shed victim ns → `onDataShed` | victim → needs-resync + RESYNC（记忆化） |
| ACK 到达 | `onAck`（§2.4 重挂）→ `flushQueued`（窗口含 pendingData，A7） | enqueue/drain | 不变 |
| ACK 超时（自声明·超时族） | `abandonInFlight`（zombie）→ `onAckTimeout`；queued 与 handoff 帧**保留** | 无 dropData | needs-resync（hub 侧另发声明，§2.3） |
| 对端 RESYNC / session 溢出边沿 | `markResyncReceived` + `dropData` | 丢弃该 ns 排队数据 | needs-resync |
| round 完成 | `resetForLive` → `flushQueued` | enqueue/drain | live |
| 连接收口 | `teardown`（含 pendingData 清零） | `dispose`（checkpoint 清 + 逐 ns `onDataShed`） | 终态/ disconnected |

### 3.6 伪代码演练：一次多 ns 突发（暂停→恢复，R2 重推）

```
limits：highWater=16/lowWater=8/maxQueued=8MiB（§3.8 裁决 1 同款 tiny 配置）
setGate(true) → write a1：handoff（触发核算：0+0+40B ≤ 8MiB）→ drain 未暂停 → dispatch a1
  → held 40B；ensureCheckpoint：queued=0、paused=false，但 buffered(40B)>0 → 挂 ✓（A1）
advanceBy(100) → checkpoint：规则 A（40 ≥ 16）→ paused=true；C（40 > 8MiB？否）；续挂（paused）
write a2/b1/b2：handoff（触发核算：queued+40B+40B ≪ 8MiB → 零 shed）→ 排队 [a2]/[b1]/[b2]
  → drain 因 paused 直通；ensureCheckpoint 已在挂
advanceBy(100) → checkpoint：B 否（40 > 8）；C 否；续挂
setGate(false) + releaseAll()：a1 送达 peer；buffered → 0
advanceBy(100) → checkpoint：规则 B（0 ≤ 8）→ paused=false → drain：
  游标在 B（a1 派发后已推进）→ 轮 1：b1、a2；轮 2：b2
wire 序（deliveredToPeer）：a1, b1, a2, b2 —— 即 [a, b, a, b]（每轮每 ns 至多一帧）
```

### 3.7 AC5 三例（WATER / PRI / SHED）通过性推演（R2 伪码下逐帧重推）

**AC5-WATER**（`WATER_LIMITS`：highWater=4096/lowWater=1024/maxQueued=8MiB，blob≈8KiB）：
1. `setGate(true)` → write1(blob)：handoff（0+0+8196 ≤ 8MiB）→ drain 即派发 #1 → `held`≈8KiB（`dispatchLog` 记录）→ **ensureCheckpoint 因 buffered>0 在挂（A1）**——测试注释「第一笔已 dispatch」前提成立；
2. `advanceBy(100)` → 检查点 #1：规则 A（8192 ≥ 4096）→ `paused=true`；规则 C 同点独立评估（8192 > 8MiB？否）；
3. writes 2-4：handoff（滞回核算：queued+8192+8196 ≪ 8MiB → 零 shed）→ 排队；drain 因 paused 直通 → 断言「越过 highWater 后数据出队必须暂停」= dispatchLog 增量中 UPDATE 计 0 ✓；
4. `releaseAll()`（held 清空送达 peer，`bufferedAmount` → 0）→ `advanceBy(100)` → 检查点：规则 B（0 ≤ 1024）→ 恢复 → drain 派发 3 帧（gate 未解除 → 再入 held——测试 wire 形态）；
5. 收敛断言 `rootValue('peer', a, 'blob') === BLOB`：帧 #1 已含 blob 写入（四写同值），peer apply 后即成立 ✓（后 3 帧留在 socket 缓冲属测试 wire 形态，生产由 socket 冲刷送达）。

**AC5-PRI**：write1 + 检查点暂停（同上）→ writes 2-3 排队不派发；`writePeerNs(a,{n:77})`：peer→hub 方向不经 gate → hub 入站处理与出站暂停正交 → apply 完成 → `UPDATE_ACK` 走**控制路径**（控制不受数据暂停约束）→ 即时派发进 `dispatchLog` → 断言「暂停期 UPDATE 计 0 且 UPDATE_ACK ≥ 1」✓。

**AC5-SHED**（`SHED_LIMITS`：maxQueuedBytesPerConnection=64KiB，highWater=4096）：
1. 循环 64 次写（~8KiB/帧）：fake scheduler 的 timer 仅在 `advanceBy` 触发——循环内只 `settle()`，检查点不运行 → 恒未暂停 → 每帧 handoff（滞回触发核算：queued(0)+buffered(渐增)+8196 > 65536 自第 ~9 笔起为真 → while 循环 victim=undefined（队列空）→ break → **按断点接纳**）→ 派发持续 → `held` 累积 ≈512KiB → 前提断言 `heldBytes > 64KiB` ✓；
2. `advanceBy(100)` → **单次检查点**：规则 A（512KiB ≥ 4096）暂停 **且** 规则 C 同点独立判定（512KiB > 64KiB 且 `largestQueuedNamespace() === undefined`——排队恒空）→ `onControlExhausted` → `connectionFatal('CONNECTION_BACKPRESSURE', 1011)`：best-effort ERROR 帧派发进 `held` + `close(1011)`（A2-3 修复：C 不依赖第二次 checkpoint）；
3. `releaseAll()` → delivered 含该 ERROR 帧 → 断言 `resyncCount + backpressureCount ≥ 1` ✓（SA6 契约明示两信号任一即锚——本路径落 CONNECTION_BACKPRESSURE 面）；
4. peer 侧对 1011 close 的分类 = 继续 backoff（§11 #13）——重拨依赖 peer scheduler 推进，本测试不推进 → 无重连噪声干扰帧计数 ✓。

**结构性结论**：三例均不依赖「等待静默 namespace」或测试耦合延迟；暂停可观测性由 A1 起挂条件保证、1011 可达性由 A2 规则 C 并列评估保证——与 §3.8 的 AC5-RR 构造问题形成对照（该对照本身即是「AC5-RR 需调整构造」的交叉证据：同组三例的确定性形态都是 gate+checkpoint，唯 AC5-RR 例外）。

### 3.8 测试构造裁决清单（SA2 R1 已批；A1/A2 修复后随 R2 复审通过一次性下发 SA6）

**裁决 1（AC5-RR 构造调整——SA2 §四 GRANTED，A4 强制修正已并入）**：原构造（顺序 `await writeHubNs(a)×2 → (b)×2`，每写 `settle()`=300 跳）在规约合规实现下不可通过——hub 侧 UPDATE 产自 session fanout 泵（`replication-session.ts:147-153`，每项投递前让步 20 微任务），四帧入队时刻相隔 ≥ ~335 跳、任何两帧从不同时在队；round-robin 公平性（协议 §17 L490）只约束同时排队帧，为凑 `[a,b,a,b]` 等待静默 ns 的实现会饿死 AC5-WATER 的首帧派发前提（两构造互斥）；唯一翻绿替代是入队防抖延迟环（G5.2 明令删除的反模式）。**替换构造**（断言面与原 AC5-RR 完全一致；`setGate(false)` 为 A4 修正——`releaseAll()` 不解除 gate，漏此步则恢复派发的 b1/a2/b2 进 `held` 而非 `deliveredToPeer`，`updates=[a]` 仍红）：

```ts
it('AC5-RR（调整构造）：水位暂停下多 ns 排队 → 恢复 drain 的 wire 序为 round-robin', async () => {
  const run = await bootMulti({ limits: { ...WATER_LIMITS, highWater: 16, lowWater: 8 } });
  const a = run.nsIds[0]!, b = run.nsIds[1]!;
  run.wire.setGate(true);
  await run.writeHubNs(a, { n: 1 });                    // dispatch #1（首帧即越过 tiny highWater）
  await run.hubNode.scheduler.advanceBy(100);           // checkpoint → 规则 A 暂停（A1 起挂后必达）
  await settle();
  const afterFirst = run.wire.dispatchLog.length;
  await run.writeHubNs(a, { n: 2 });                    // 暂停期排队：[a2]
  await run.writeHubNs(b, { n: 1 });                    // [b1]
  await run.writeHubNs(b, { n: 2 });                    // [b2]
  await run.hubNode.scheduler.advanceBy(100); await settle();
  // 前置锚：暂停窗口内零数据派发（防误判）
  expect(run.wire.dispatchLog.slice(afterFirst).filter((e) => e.kind === 'UPDATE')).toHaveLength(0);
  run.wire.setGate(false);                              // ← A4 修正：解除 gate（releaseAll 不解除）
  run.wire.releaseAll();                                // a1 送达 peer；buffered → 0
  await run.hubNode.scheduler.advanceBy(100); await settle();  // checkpoint → 规则 B 恢复 → drain
  const updates = run.wire.deliveredToPeer.map((x) => decodeMessage(x))
    .filter((f) => f.message.kind === 'UPDATE')
    .map((f) => (f.message as { namespaceId: string }).namespaceId);
  expect(updates).toEqual([a, b, a, b]);                // ← 与原 AC5-RR 断言完全一致
  expect(updates).toHaveLength(4);
});
```

（游标推导：a1 派发后游标推进至 B；恢复 drain 轮 1 = b1, a2、轮 2 = b2 → `a1,b1,a2,b2`。）

**裁决 2（AC1 第二锚锚形态——A3）**：设计选型 **(b) 测试锚调整**，不为测试改变生产生命周期。事实链：`connectionFatal` → `cleanupAll()`（零 channels → `Promise.all([])` ≈2 跳）→ `dropConnection` 把连接从 `hub.connections` 摘除；AC1 在断言前有两次 `settle()`（600 跳）→ `hub.connections[0]` 必为 `undefined` → 原断言 `expect(hub.connections[0]?.state).toBe('closed')` 恒红。**保留 prompt-drop 生产语义**（死连接及时摘除 = 资源卫生正确；「滞留至宿主显式清除」会为被拒握手引入死条目累积）。替换断言组：

```ts
expect(spy.calls, '伪造身份不得进入命名空间授权（协议 §6.1）').toHaveLength(0);   // 锚 1 不变
expect(wire.hubSideClosed).toBe(true);                  // 锚 2 替换：hub 主动关闭传输
                                                        //（`hubSideClosed` 读 pair.right.closed，
                                                        //  connectionFatal 同步 close(1008) 即真）
expect(hub.connections).toHaveLength(0);                // 锚 2 补充：drop = 正确收口证据
                                                        //（fatal 后 ~2 跳摘除，600 跳后稳定为 0）
expect(errorCodes(toPeer)).toContain('INSTANCE_IDENTITY_MISMATCH');  // 锚 3 不变
```

**建议补充锚（SA2 §五；随本清单一并下发，SA6 取舍）**：A1 窄锚（gated 单 ns：首帧派发后 `advanceBy(100)` → 第二笔零 dispatch）；A2 滞回锚（先置停再突发：shed 后剩余 queuedDataBytes ≤ lowWater）；A2 单检查点 1011 可达锚（buffered > max 且队列空 → 单次 advanceBy 后 wire 出现 CONNECTION_BACKPRESSURE 或 1011 收口）；A5 语义锚（按 §3.5 定案：hub ACK 超时自声明 → 恢复后该批排队 UPDATE 仍派发 + 迟到 ACK zombie 容忍）；A6 行为锚（三帧窗口慢 ACK：第二帧在窗口内不被整窗弃置）；A7 记账锚（paused 期大量入队 → flush 后 `inFlight+pendingData ≤ maxInFlightUpdates`）。

**若总控裁定 SA6 文件逐字节冻结**：AC5-RR 在本设计下恒红（构造不可行），需总控明确放宽该锚——本设计不接受以测试耦合延迟环换绿。AC1 第二锚同表裁决（替换断言组如上）。

---

## §4. D4 — Close、GOAWAY 与异步竞态（G4.1–G4.5）

### 4.1 G4.1：CLOSE 帧分发同步段停接纳（双侧）

**peer 侧**（`peer-namespace.ts:457-471`，实质违例——原实现完全不设 closing）：

```ts
onCloseRequest(message: { sequence: number }): void {
  if (this.isQuietState()) return;
  if (this.state === 'closing') return;            // 幂等：重复 CLOSE 不再入列
  this.setState('closing');                        // §12 L304/§16 L475：**帧分发同步段**停接纳
  void (async () => {                              // 随后串行 drain → cleanup → CLOSE_OK
    await this.drainPendingApplies();
    await this.closeSessionAndRelease();
    this.sendChecked({ kind: 'CLOSE_OK', namespaceId: this.namespaceId,
                       ackedSequence: message.sequence });   // §12 L311 回显请求序（既有正确）
    if (this.state !== 'closed') this.setState('closed');
    this.settleCloseMemo();
  })();
}
```

同步置 'closing' 后 `isQuietState()` 为真 → `onHubUpdate`（L425-443）静默忽略后续 UPDATE（P5 §11.3 语义——`peer-namespace.ts:426` 注释同款引用；对应协议 §12 接收方停接纳纪律，AC6-2 锚：不应用、不 ACK）；`onSyncStep1/2/Applied` 同门。**收到 CLOSE 不额外 arm closeTimeout**（与 hub 对称：本地 drain 无限等待已接纳 apply 是 ADR-0008 L93「无条件排空」纪律；removeTarget 路径的 closeTimeout 保持不变）。

**hub 侧**（`hub-namespace.ts:501-518`）：`setState('closing')` 从 `closeQueue.then` 微任务续体（L503-505）**上提到帧分发同步段**：

```ts
onCloseRequest(message: { sequence: number }): void {
  if (this.isTerminal() || this.state === 'closing') return;
  this.setState('closing');                        // 同步段（消除微任务窗口）
  this.closeQueue = this.closeQueue.then(async () => {
    if (this.isTerminal()) return;
    await this.drainPendingApplies();
    await this.closeSessionAndRelease();
    if (!this.isTerminal()) {
      this.sendChecked({ kind: 'CLOSE_OK', namespaceId: this.namespaceId,
                         ackedSequence: message.sequence });
      this.setState('closed');
      this.settleClosingOpenWaiters();             // §4.5
    }
  });
}
```

### 4.2 G4.2：已接纳 apply 的 drain 完整性

关键不变量：**apply 的接纳是同步登记**——`onUpdate/onHubUpdate` → `void applyRemoteUpdate(...)`，其函数体首段（`session.applyRemoteUpdate` + `pendingApplies.add`）在首个 await 前同步执行（两侧 `hub-namespace.ts:656-690` / `peer-namespace.ts:744-781` 均如此）。因此 §4.1 的同步 closing 之后：

- 后续 UPDATE/Step2 在 `isQuietState` 门处被拒 → **不再有新 apply 进入 `pendingApplies`**；
- `drainPendingApplies()`（`Promise.allSettled([...this.pendingApplies])`）快照覆盖**全部**已接纳 apply（peer 侧原缺口：快照取自 async IIFE 首个 await 前，但不停接纳导致快照后仍可新增——同步 closing 关闭该窗口）；
- 排空完成 → `closeSessionAndRelease()`（session.close barrier → unsubscribe → lease.release）——「apply settle 后才 cleanup」的通道层保证成立（AC6-2 锚）。

### 4.3 G4.3：迟到 round 结算不得复活 closing（hub 侧补 B-1 同款守卫）

`hub-namespace.ts:725-737`：守卫从 `if (!this.isTerminal())` 收窄为「round 活跃态白名单」：

```ts
private onRoundSettled(): void {
  if (this.pendingResync) this.pendingResync = false;   // 清账独立于状态（无副作用）
  if (this.state !== 'reconciling' && this.state !== 'needs-resync') {
    return;   // B-1 对齐（peer-namespace.ts:617-623 同款纪律）：closing/终态/live/opening
              // 期间的迟到结算零状态机迁移——closing 不得复活为 live（P5 §13.4 终态不复活）
  }
  this.round.markLive();
  this.setState('live');
  this.channel.resetForLive();
  this.resyncDeclared = false;                          // 恢复周期完成：声明记忆化清零
  this.watchdog.onEvent();
}
```

白名单含 `'needs-resync'` 的理由：hub 不发起恢复 round（§9.4），恢复期 hub 停留 needs-resync，peer 的新 round 完成时 hub 必须 needs-resync → live 并清 `resyncDeclared`（AC4-2 收敛路径依赖）；peer 侧 B-1 无此态（`maybeStartRecovery` 先置 reconciling）。`markLive()` 移到守卫之后（对齐 peer 形态；closing 期间 `wasLive` 标记无消费面）。`resyncDeclared` 清零只在真实回 live 时发生——closing 期间不清（防收口期再声明）。

**AC6-3 红灯闭环**：双门闩构造（gate1 挂 peer UPDATE apply、gate2 挂恢复 round Step2 apply）→ removeTarget → hub 同步 closing → 采样循环释放双门闩 → apply settle → `checkSettled → onRoundSettled` → 守卫早退（state='closing'）→ 无 `closing→live→closed` 抖动，采样序列恰 `['closing','closed']` ✓。

### 4.4 G4.4：GOAWAY/blocked 同步静默 channel 与订阅

`peer-connection.ts:342-365` 重构（保 sa7-dynamic G1/G2 既有绿灯锚：RESTARTING drain 期连接态保持 `'ready'`、SHUTTING_DOWN 态为 `'blocked'` 且不关本地 socket——`ws-replication-sa7-dynamic.test.ts:180-227`）：

```ts
private goawayActive = false;
private goawayDrainHandle: unknown | undefined;   // ← 修复：句柄保存（stop/重拨可清除）

private onGoaway(message: { reasonCode: string; drainTimeoutMs: number }): void {
  this.goawayActive = true;                        // §6.3 L147：停止新 OPEN / 新 sync round
  if (message.reasonCode === 'SERVER_SHUTTING_DOWN' || message.reasonCode === 'REAUTH_REQUIRED') {
    // 修复：走 enterBlocked()（原实现裸 setState('blocked') 后 return——namespace 停留
    // live 投影、UpdateChannel、subscribeOwnedUpdates 订阅全部残留 = G4.4 缺陷）
    this.enterBlocked();                           // 同步：清 hello/reset/backoff timer + blocked
                                                   // + 全部控制器 onConnectionFatal()
    return;
  }
  // SERVER_RESTARTING / 其他：drain 期连接态保持 ready（sa7 G1 锚）；deadline 后关闭回退重连
  this.clearGoawayDrain();
  this.goawayDrainHandle = this.options.timer.setTimeout(() => {
    this.goawayDrainHandle = undefined;
    this.quiesceControllers();                     // §4.4b：deadline 同步静默（先于 close 事件）
    const transport = this.transport;
    if (transport !== undefined && !transport.closed) transport.close(1001, 'goaway-drain');
  }, message.drainTimeoutMs);
}

/** §4.4b：同步静默全部 namespace channel/订阅（enterBlocked 与 goaway deadline 共用）。 */
private quiesceControllers(): void {
  for (const controller of this.controllers.values()) controller.onConnectionFatal();
  // onConnectionFatal：同步投影 disconnected（停接纳）+ cleanupResources()
  //（其中 unsubscribe 前移为同步段——见 §4.4c）→ 幂等（后续 onClose/onConnectionLost 重入无害）
}
```

- **§4.4c 订阅同步摘除**：两侧 `closeSessionAndRelease()`（`peer-namespace.ts:891-919` / `hub-namespace.ts:788-806`）把 `unsubscribe()` 调用**前移到函数入口同步段**（现置于 `await session.close()` 之后）——「GOAWAY/blocked/断线处理**同步**静默 channel 与订阅」的最小实现；保留 B-2d/R4-2 的「仅退订本 cleanup 捕获的句柄」守卫（入口捕获、比对后置空）。
- `goawayActive` 的抑制面（§6.3 L147「收到 GOAWAY 后停止 OPEN，不开始新 sync round」）：`openActiveTargets()` 与控制器 `maybeStartRecovery()` 入口前置 drain 门禁——经 `PeerNamespaceHost` 新增包内私有成员 `isGoawayDraining(): boolean` 暴露（连接 ready 门不覆盖 drain 期：RESTARTING 分支连接态保持 'ready'，sa7 G1 锚）；`dialNow` 重置 `goawayActive = false` 并 `clearGoawayDrain()`（重连后恢复 OPEN/round——sa7 G1 重连 re-OPEN 依赖此重置）；`stop()` 同样清理。deadline 关闭 → 本方 close 事件（真实 WS 语义）→ `onClose(1001)` → 临时失败 → backoff → 重连（sa7 G1 全链路保持）。
- `scheduleDrainClose` 的 `goawayDrainMs` 跨连接残留字段随重构删除（deadline 直接闭包捕获）。

### 4.5 G4.5：closing 期重复 OPEN waiter 的 flush

`hub-namespace.ts`：'closing' 分支（L160-167）挂入的 waiter 现状永不 flush（close 完成路径 `onCloseRequest`/`finalize`/`onConnectionClosed` 均不触达 `openWaiters`）→ 该 OPEN 永无响应，违反 §7.1 L164「每个请求都收到 OPEN_OK 或 ERROR」。

```ts
/** close 终局统一答复 closing 期挂入的 OPEN waiter（§7.1 必答；连接存活时发帧，
 *  已收口则 sendChecked 的 transport.closed 守卫自然零输出）。 */
private settleClosingOpenWaiters(): void {
  const waiters = this.openWaiters;
  this.openWaiters = [];
  for (const _waiter of waiters) {
    this.sendChecked(namespaceErrorFrame('NAMESPACE_REOPEN_REQUIRES_RECONNECT', this.namespaceId));
  }
}
```

调用点：(a) `onCloseRequest` 完成段（CLOSE_OK 发出、置 closed 之后——§4.1 伪代码）；(b) `finalize()`（closing 期间被终止性 ERROR 收口时，waiter 同样必答）；(c) `onConnectionClosed()`（零 wire 语义下仅清空数组，不发帧——P5 §13.4 迟到收口域）。'opening' 合流 waiter 的既有 flush 面（`flushOpenWaitersOk/finishOpenError/finishOpenSilently`，L326-352）不变。

**AC6-4 红灯闭环**：hub saveGate 悬挂 peer UPDATE apply → removeTarget → hub 同步 closing（drain 进行中）→ closing 期注入重复 OPEN → waiter 挂入 → 放行 gate → apply settle → CLOSE_OK → closed → `settleClosingOpenWaiters` → ERROR `NAMESPACE_REOPEN_REQUIRES_RECONNECT` ✓（SA6 断言 hubFrames ERROR 含该码）。

---

## §5. D5 — 活性与可测性（G5.1–G5.3）

### 5.1 G5.1：WS ping/pong 活性接线（传输/host 集成 seam）

依据：协议 L40「活性检测只使用 WebSocket ping/pong。**协议不定义业务 PING/PONG frame**」、§18 L518-520「WS ping interval/pong timeout……HELLO/pong timeout关闭连接」、ADR-0010 L147。**禁止**应用层 PING/PONG 帧（本设计零新增消息码）。

- **`ReplicationTimeouts` 加性扩展**（可选字段 + Resolved 必填）：

```ts
export interface ReplicationTimeouts {
  /* 既有六字段不变 */
  readonly pingIntervalMs?: number;    // 缺省 30_000（§18「心跳与失联判定」安全缺省；ADR L165）
  readonly pongTimeoutMs?: number;     // 缺省 10_000
}
export interface ResolvedTimeouts extends ReplicationTimeouts {
  readonly pingIntervalMs: number;     // resolve 后必填（DEFAULT 提供缺省）
  readonly pongTimeoutMs: number;
}
```

- **连接层活性循环**（hub 每连接 / peer 每次 dial，共用小工具 `liveness.ts` 或内联）：握手成功（HELLO_ACK 发出 / 收到）后，**当且仅当** transport 提供 `ping` 与 `onPong` 两个可选面时武装：

```
每 pingIntervalMs：transport.ping()；挂 pongTimeoutMs 计时
  onPong 到达 → 清 pong 计时（仅 pong 复位——L40 活性信号唯一定义）
  pong 计时到期 → 活性失联：
    hub：transport.close(1001, 'pong-timeout') → 既有 onTransportClosed 全量 cleanup
    peer：onTemporaryFailure()（§15.1 temporary-close → backoff → 重连）
收口/重拨/stop：清全部活性 timer（N1 纪律）
```

- **宿主接线归属**：真实 WS 的 ping/pong 面由切片 9 组合根（apps/yjs-server）提供；`apps/` 现状仅 README/AGENTS（SA5 范围核查）——本设计只交付**包内 seam 与缺省行为**（transport 无该面 → 活性机制 dormant，零 timer——现有内存 transport 测试零影响）。这正是任务简报「without introducing application-level PING/PONG frames」与 G6 澄清的边界。
- `validateTimeouts` 扩展：两字段若显式提供 → 正有限安全整数；且 `pongTimeoutMs < pingIntervalMs`（构造期响亮校验，协议 §17「不得运行时 clamp」同款纪律）。
- **缺省数值注记（A10）**：`30_000/10_000` 为**工程缺省**——协议 §18 只列配置项、ADR-0010 L165 只要求「安全默认值」，均无数值规定；选型依据为「心跳周期 ≫ 检查点周期（100ms）与常见 RTT，pong 预算 ≈ 1/3 心跳周期」的工程惯例，切片 9 可按部署覆盖。

### 5.2 G5.2：测试可观测性延迟 → 显式确定性 seam

**现状缺陷**：`peer-namespace.ts:637-657` `onAckTimeoutFired` 内 `deferRecovery()` 递归链式 `queueMicrotask` 至多 **512** 次才 `maybeStartRecovery()`（注释自证「保证测试的 settleUntil 至少观察到一次 needs-resync 投影」——生产代码为测试可观测性引入非确定延迟）；次要同类：`peer-connection.ts:499-503` `requestRebuild` 裸 `queueMicrotask` 延迟 `dialNow`。

**设计**：`PeerReplicationOptions` 加性扩展 `deferTask?: (task: () => void) => void`；**生产缺省 = 单次 `queueMicrotask`**（恢复/重建即刻推进——P5 §10.4「窗口收口后开始新 round」/协议 §9.4「Peer等待 in-flight 窗口收口后开始新 round」的字面行为，延迟本就只为测试观测）。两处使用点改经 seam：

```ts
// peer-namespace.ts onAckTimeoutFired（512 环整体删除）
if (this.state === 'live' || this.state === 'needs-resync') {
  this.setState('needs-resync');
  this.host.deferTask(() => { if (this.state === 'needs-resync') this.maybeStartRecovery(); });
}
// peer-connection.ts requestRebuild（裸 queueMicrotask 替换）
this.host.deferTask(() => { this.rebuildPending = false; if (!this.stopping) this.dialNow(); });
```

**既有测试保绿的关键**：`ac6-resync-close:73-105` 与 `r3-r4:31-60` 的 ACK-timeout 流程为 `advanceMs(200) → waitNamespace('needs-resync') → waitPeerSent('SYNC_STEP1', 2)`——若缺省单微任务，恢复 round 会在 `advanceMs` 内部的（3+300 跳）微任务排空期先行启动，`needs-resync` 投影不可观测 → 既有测试红。512 这个数正是「> 303（advanceBy 3 跳 + settle 300 跳）且 < 3000（settleUntil 预算）」的测试耦合常数。因此：**`test/driver.ts`（boot 与 bootFanout 两处 createPeerReplication）注入测试 defer**——

```ts
// driver.ts（测试基建；SA3 执行）：保持既有可观测性时序（常数移入测试侧，归其所属）
const TEST_DEFER = (task: () => void): void => {
  let hops = 0;
  const step = (): void => { queueMicrotask(() => { hops += 1; if (hops >= 512) task(); else step(); }); };
  step();
};
createPeerReplication({ /* … */ deferTask: TEST_DEFER });
```

SA6 红灯文件不注入（`bootMulti` 直构 peer）——AC4-2 的 peer 恢复走 `onResyncReceived` 同步路径（不经 defer），AC6-3 走 `boot()`（driver 注入）→ 两例均不受影响（已逐例核对）。生产语义更干净（恢复即时），测试时序由测试侧拥有——这正是简报「Replace the production queueMicrotask delay loop used for test observability with an explicit deterministic test seam」的字面落实。

### 5.3 G5.3：死抽象清理（收敛单一权威机制）

| 死抽象 | 位置 | 处置 |
|---|---|---|
| `LifecycleQueue` | `lifecycle-queue.ts:7-24`（全包零引用；hub 用内联 closeQueue promise 链、peer 用 `Memoized`+cleanupTail——两套并存即「非单一权威」） | **删除类**；文件保留 `Memoized`（peer-namespace.ts:14 在用）并更名注释 |
| `OutboundQueue` 死数据面 | `frame-io.ts:102-104,124-127`（`sendData` 零调用者——grep 证实） | **由 §3 实现取代**（enqueueData/drain/游标复活为真实机制）；`sendData` 直发方法删除 |
| `cleanupTail`（hub） | `hub-namespace.ts:82`（声明后从未使用；peer 侧同名在用，保留 peer 的） | **删除 hub 侧声明** |
| `NamespaceChannelCore` | `types.ts:172-178`（零实现零引用） | **删除接口** |

清理后权威机制唯一化：出站调度 = OutboundQueue（控制+数据双平面）；生命周期收口 = hub `closeQueue` 链 / peer `closeMemo`(Memoized)+`cleanupTail`。

---

## §6. D6 — 交付澄清（G6，开票不改码）

| 项 | 结论 | 证据 | 处置 |
|---|---|---|---|
| `resetReplica` | **Registry 侧已交付**（`packages/namespace-registry/src/registry.ts` 含 resetReplica，phase5-bootstrap-archive-reset 切片）；transport 层 needs-resync 恢复走 state-vector round（§9.4/§18 L520）；conflicted→reset 编排按 ADR-0006 L211 属调用方（Registry 受信编排）——**非本包缺陷** | SA5 范围核查 grep 命中 registry 源+测试 | 不改码；在本设计记录归属，防后续误判缺陷 |
| 结构化 observability（ADR-0010 L167 最小观测面） | **未交付**：`src/index.ts` 导出面零观测 API；两 Options 无 observer 字段；connectionId（§6.2 L137）已生成无消费 | `src/index.ts` 全文 | **建议总控开独立实现票**（连接/通道状态、bootstrap/reconcile 计数与字节、updates/bytes in/out、apply/ACK latency、backpressure resync、auth/authz failure、identity/epoch conflict、degraded bypass、稳定错误计数）。票面要点：与 G3.3/G3.4 的 shed/backpressure 事件共用回调点（本设计已预留 `onDataShed/onControlExhausted` 连接层回调面，observability 票可直接挂接） |
| apps/yjs-server 组合根（ADR-0010 L175 切片 9） | **未交付**：`apps/` 仅 README.md + AGENTS.md；无真实 WS 适配 | `ls apps/` | **留切片 9 独立票**；G3.5/G5.1 的宿主前提（bufferedAmount/ping/pong 面、Upgrade bearer 验证 → `accept(transport, identity)`）已在本设计中作为 seam 预留，切片 9 零协议改动即可接线。**票面必须含（A11）**：真实 adapter **必须**暴露 `bufferedAmount`（G3.4 背压前提——缺面则生产背压静默不存在）与 `ping`/`onPong`（G5.1 活性前提）；建议宿主装配期一次性 loud 断言（缺面即 TypeError/结构化告警，防静默降级） |

---

## §7. 验收标准（7 条）实现方案映射

| # | 验收标准 | 设计节 | 红灯锚 |
|---|---|---|---|
| 1 | 伪造 HELLO 身份在 namespace 授权前被拒 | §1.1（受信身份绑定 + onHello 首查 + authorize 只消费受信值）+ §3.8 裁决 2（第二锚替换：`hubSideClosed` + `connections.length===0`——A3 定案） | AC1（authorize 零调用 + 1008 传输关闭 + `INSTANCE_IDENTITY_MISMATCH`；原 `connections[0].state` 锚按裁决 2 替换） |
| 2 | 旧 socket 迟到 message/close 不影响替代连接 | §1.2（代际闸 + 退订） | AC2a（ready/live 保持）/ AC2b（无 backoff） |
| 3 | 伪造/陈旧 BOOTSTRAP_ACK 与 CLOSE_OK 不能推进状态 | §2.1（快照序留存 + ACK_STATE_VIOLATION fatal）/ §2.2（CLOSE_NAMESPACE 序留存 + 错配不完成 close） | AC3a（ERROR + blocked）/ AC3b（保持 closing → closeTimeout） |
| 4 | Hub ACK 超时确定性引发 peer 发起恢复并收敛 | §2.3（onAckTimeoutFired → declareHubResync 记忆化）+ §2.4（计时器重挂保恢复节奏正确） | AC4-1（恰 1 帧 RESYNC_REQUIRED）/ AC4-2（roundId=2 + 双侧 n=9） |
| 5 | 确定性多 ns 测试证明控制优先、round-robin、shedding、高低水位 | §3 全组（数据面/round-robin/滞回 shedding/水位检查点（A1 起挂）/1011（A2 并列评估）） | AC5-RR*（**构造调整已获批，A4 修正并入，见 §3.8 裁决 1**）/ AC5-WATER / AC5-PRI / AC5-SHED（三例 R2 逐帧重推见 §3.7） |
| 6 | 确定性竞态测试证明 CLOSE 同步停接纳、排空、终态不可复活 | §4.1（同步 closing）/ §4.2（drain 完整性）/ §4.3（round 结算守卫）/ §4.5（waiter flush） | AC6-1 / AC6-2 / AC6-3 / AC6-4 |
| 7 | PR #160 既有 82 例保持绿 + typecheck + `git diff --check` | §8 影响评估 + §10 ALLOW LIST（测试侧仅 driver/spec-b1-b2/SA6-g3g4 的**调用点**调整，断言面零改动） | 全量 `./node_modules/.bin/vitest run packages/ws-replication` 97 例全绿 |

---

## §8. 影响评估

**既有 82 例绿灯保绿面**（逐风险点核对）：

1. `accept()` 新增必填语义：4 个测试侧调用点更新（`driver.ts:431`、`driver.ts:588`、`spec-b1-b2-red.test.ts:193`、SA6 g3-g4 `bootMulti:262`——均传 `{ peerInstanceId: PEER_INSTANCE }`，与各测试 HELLO 自述身份一致）；SA6 g1-g2 已按新形状传参（`accept.call(hub, wire.hubEnd, { peerInstanceId: PEER_INSTANCE })`）。类型层 `api.test-d.ts` 不需改动（可选参数单向赋值兼容）。
2. UPDATE 改走数据面：单 ns 场景行为等价（窗口开放 → 入队 → 立即 drain 派发；无 gate/无 bufferedAmount → 永不暂停）；`ac5-live`/`r3-r4` 的 UPDATE/ACK 时序不变（派发仍同步于 fanout 投递后的 drain）。
3. GOAWAY 重构：sa7 G1/G2 的两个锚（drain 期 ready、SHUTTING_DOWN blocked 且不关 socket）在 §4.4 设计中显式保持；`enterBlocked` 对控制器的通知与既有 1002/1008 路径同构。
4. `deferTask` seam：生产缺省单微任务更快，但 driver 注入 512 跳测试 defer → `ac6`/`r3-r4`/`sa4-f1-f2-f3`/`sa7` 的 ACK-timeout 恢复时序逐字节保持。
5. hub `onRoundSettled` 守卫：live/needs-resync 白名单覆盖既有全部合法结算路径（首连 reconciling → live；恢复 needs-resync → live）；`ac3/ac4` bootstrap/reconcile 流程不变。
6. 活性/ping/水位：内存 transport 无可选面 → dormant，零新 timer。
7. LifecycleQueue/NamespaceChannelCore/cleanupTail 删除：零引用（grep 证实），零行为影响。
8. `validateLimits` 新增 `highWater ≤ maxQueuedBytesPerConnection` 链式校验（A2-3）：既有测试配置（WATER_LIMITS 4096 ≤ 8MiB、SHED_LIMITS 4096 ≤ 64KiB）与缺省（512KiB ≤ 8MiB）全部满足——零既有测试触碰；新校验只拦截病态配置。
9. peer 侧 `sendData` 非 ready 门从静默丢改为「丢 + onDataShed 声明」（A7）：现有测试中该窗口（live 会话 + 非 ready 连接）结构性不可达（ready 门 + 控制器投影先行），零行为回归；即使可达，行为差异仅为多一帧 RESYNC_REQUIRED 声明（恢复语义正确方向）。

**风险与回归面**：改动集中在 `packages/ws-replication/src`（11 文件）；`replication-protocol`、`namespace-registry`、`namespace-runtime`、`persistence`、`apps` 零改动。typecheck 由 vitest --typecheck 覆盖（api.test-d.ts + 全量）。

---

## §9. 实现顺序建议（SA3 参考，非门禁）

1. §5.3 死抽象清理 + §2 全组（小步、独立可验：AC1-AC4 红灯先转绿）
2. §1（accept 身份 + 代际闸；含测试调用点更新）
3. §4（CLOSE/GOAWAY/竞态；AC6 转绿）
4. §3（数据面整组——最大改动；AC5-WATER/PRI/SHED 按 §3.7 重推转绿；AC5-RR 按已批调整构造转绿——SA6 调整单一包（§3.8 裁决 1+2+补充锚）随本 R2 复审通过后一次性下发）
5. §5.1/§5.2（活性 seam + deferTask + driver 注入）
6. 全量回归 + typecheck + `git diff --check`

---

## §10. 文件清单

### ALLOW LIST

生产文件（`packages/ws-replication/src/`）：

- `src/types.ts` — 修改：`UpgradeIdentity` 新类型；`HubReplication.accept` 可选第二参；`DuplexTransport` 可选 `bufferedAmount/ping/onPong`；`ReplicationTimeouts` 可选 `pingIntervalMs/pongTimeoutMs`（Resolved 必填）；`PeerReplicationOptions.deferTask`；删除 `NamespaceChannelCore`（§1/§3.4/§5.1/§5.2/§5.3；约 +40/−8 行）
- `src/frame-io.ts` — 修改：OutboundQueue 数据面实现（enqueueData/round-robin drain/入队 shedding/水位检查点/控制保留额度/`CONNECTION_BACKPRESSURE` 钩子/dispose）；删除死 `sendData`（§3.1–§3.4；约 +160/−25 行）
- `src/update-channel.ts` — 修改：pendingData 窗口记账、onDataDispatched/onDataShed 回调、ACK 计时器最老在途重挂、markResyncReceived 联动 dropData（§2.4/§3.1/§3.5；约 +55/−10 行）
- `src/hub-connection.ts` — 修改：accept 受信身份绑定与响亮校验、onHello 首查、授权身份源切换、sendData/dropData 装配、OutboundQueue deps 注入、transport 退订卫生（§1.1/§1.2/§3；约 +110/−15 行）
- `src/peer-connection.ts` — 修改：dialNow 代际闸+退订、requestRebuild deferTask、GOAWAY 重构（enterBlocked/goawayDrain 句柄/quiesceControllers/goawayActive）、sendData 装配、stop 清理（§1.2/§3/§4.4/§5.2；约 +100/−20 行）
- `src/hub-namespace.ts` — 修改：bootstrapSnapshotSeq 留存+关联校验、onCloseRequest 同步 closing、onRoundSettled 白名单守卫、settleClosingOpenWaiters、onAckTimeoutFired→declareHubResync、closeSessionAndRelease 订阅同步摘除、sendData host 成员、删除 cleanupTail（§2.1/§2.3/§3.1/§4.1/§4.3/§4.5/§5.3；约 +85/−20 行）
- `src/peer-namespace.ts` — 修改：onCloseRequest 同步 closing、closeNamespaceSeq 留存+CLOSE_OK 关联、deferRecovery 512 环→deferTask、onDataShed/declareLocalResync 联动、closeSessionAndRelease 订阅同步摘除、sendData host 成员（§2.2/§3.1/§4.1/§4.4c/§5.2；约 +75/−25 行）
- `src/defaults.ts` — 修改：DEFAULT_REPLICATION_TIMEOUTS 增 `pingIntervalMs: 30_000`/`pongTimeoutMs: 10_000`（§5.1；约 +6 行）
- `src/validate.ts` — 修改：可选 ping/pong 超时校验（正有限安全整数 + pong < ping）、deferTask callable（§5.1）、**`highWater ≤ maxQueuedBytesPerConnection` 链式校验**（§3.4/A2-3；约 +20 行）
- `src/index.ts` — 修改：导出 `UpgradeIdentity` 类型（§1.1；约 +3 行）
- `src/lifecycle-queue.ts` — 修改：删除 `LifecycleQueue` 类，保留 `Memoized`（§5.3；约 −18 行）

测试文件（SA6/SA4 owned + 测试基建；SA3 仅按本设计调整**调用点与构造**，断言面零改动）：

- `test/driver.ts` — `[测试基建（issue #136 SA6 交付）]` 修改：boot/bootFanout 的 `hub.accept` 调用点传受信身份（2 处）；createPeerReplication 注入 `TEST_DEFER`（§1.1/§5.2；约 +15 行）
- `test/ws-replication-spec-b1-b2-red.test.ts` — `[SA4 authored（PR #160 红灯）· 本任务仅调用点]` 修改：dial 闭包内 `hub.accept` 调用点传受信身份（1 处；约 +1 行，断言面零改动）
- `test/ws-replication-sa6-hardening-g3-g4-red.test.ts` — `[SA6 owned]` 修改：bootMulti 的 `hub.accept` 调用点传受信身份；**AC5-RR 构造按 §3.8 裁决 1 调整**（SA2 R1 已批 + A4 强制修正并入；断言 `[a,b,a,b]` 不变；SA6 调整单一包随 R2 复审通过后一次性下发）
- `test/ws-replication-sa6-hardening-g1-g2-red.test.ts` — `[SA6 owned]` 修改：**AC1 第二锚按 §3.8 裁决 2 替换**（`hub.connections[0]?.state === 'closed'` → `wire.hubSideClosed === true` + `hub.connections.length === 0`；锚 1/3 不变；A3 定案）——R1 标注「预期零改动」作废，该文件现在属调整面（调用形状 `accept(transport, {peerInstanceId})` 仍与本设计 §1.1 精确吻合，无需改动）

### DENY LIST

- `packages/replication-protocol/**` — wire codec/错误注册表冻结（`CONNECTION_BACKPRESSURE` 已定义，只消费不修改）
- `packages/namespace-registry/**`、`packages/namespace-runtime/**`、`packages/persistence/**` — ADR-0008/0009/0006/0010 包边界；fanout 泵/sequencer/session 语义非本任务域
- `apps/**` — 切片 9 组合根（G6 澄清：本任务只留 seam）
- `docs/protocols/instance-replication-v1.md`、`docs/adr/**` — wire contract 与 ADR 为基准文本，本任务只实现不修法
- `packages/ws-replication/src/testing.ts` — 内存 transport 不加活性面（dormant 语义即正确；SA6 慢 socket wire 在测试文件内自治）
- `test/ws-replication-ac1-ac7*.test.ts`、`test/ws-replication-r3-r4-regressions.test.ts`、`test/ws-replication-sa4-*.test.ts`、`test/ws-replication-sa7-dynamic.test.ts`、`test/ws-replication-api.test-d.ts` — PR #160 验收/回归/类型契约断言面冻结（其时序依赖由 driver 侧 TEST_DEFER 承接，不需触碰）
- `test/harness.ts` — 共享测试基建冻结（settle/settleUntil/makeWire 语义是 §3.8 论证基准）

---

## §11. 协议假设依据

| # | 假设 | 依据类型 | 依据内容（具体引用） | 风险等级 |
|---|---|---|---|---|
| 1 | HELLO `peerInstanceId` 必须等于 Upgrade 受信身份；不符为连接级 1008 错误 | 协议文本+ADR | `docs/protocols/instance-replication-v1.md` §6.1 L120（字段规则「必须等于 Upgrade 身份」）+ §2 L36（「成功认证至少产生可信 Peer instanceId」）；ADR-0010 L155；错误注册表 `replication-protocol/src/errors.ts:INSTANCE_IDENTITY_MISMATCH → 1008` | 低 |
| 2 | `accept()` 在 bearer 验证**之后**由宿主调用，验证产物经参数传入（非包内解析 token） | 协议文本+架构边界 | 协议 §2 L34-36（「Bearer token 在 HTTP Upgrade 前验证……成功认证至少产生可信 Peer instanceId」——验证属 HTTP 层）；ADR-0010 L175（apps/yjs-server 为组合根，切片 9）；SA6 红灯契约 AC1 注（「测试按 `accept(transport, { peerInstanceId })` 形状传参……SA3 同步调整该调用处，断言面不变」——形状获 SA6 预认可） | 低 |
| 3 | BOOTSTRAP_ACK 错配 = 连接级违例（ACK_STATE_VIOLATION fatal 1002） | 现有测试引用+错误注册表+SA6 契约 | UPDATE_ACK 先例：`update-channel.ts:74-86`（violation 判定）→ `hub-namespace.ts:492-499`（`connectionFatal('ACK_STATE_VIOLATION', 1002)`）；`errors.ts:ACK_STATE_VIOLATION`（fatal/1002）；SA6 AC3a 断言 `ERROR 含 ACK_STATE_VIOLATION` + `waitConnection('blocked')`（g1-g2 红灯文件 L172-173） | 低 |
| 4 | CLOSE_OK 错配不完成 close（保持 closing，closeTimeout 兜底），非连接 fatal | 协议文本+任务简报+SA6 契约 | 协议 §12 L311-313（CLOSE_OK 关联 +「正常 close 不等待丢失的 UPDATE_ACK；下次连接通过 state vector 修复」）；简报 G2 措辞差异（"must not complete close" vs BOOTSTRAP 的 "violation policy"）；SA6 契约 L25（「错配 CLOSE_OK 不完成 close（保持 closing 或停连接）」——两锚等价明示） | 低 |
| 5 | hub ACK 超时 → 发 RESYNC_REQUIRED（记忆化）→ peer 发起新 round | 协议文本+源码注释 | 协议 §9.4 L248（「始终由 Peer 用新 roundId 发起下一轮……hub 的声明是唯一通路」）；§18 L520（「ACK timeout 不重发同一 UPDATE，而进入 needs-resync 并由新 state-vector round 修复」）；`hub-namespace.ts:566-569` 注释自证；错误注册表 `ACK_TIMEOUT retryable=resync` | 低 |
| 6 | 连接级公平 = per-ns 队列 + round-robin（每轮每 ns 至多一帧）+ 控制优先 | 协议文本+ADR | 协议 §17 L490；ADR-0010 L151（「connection 按 namespace round-robin 公平发送，control/ACK 保留额度」） | 低 |
| 7 | 总队列超限 shedding：「按最大 queued namespace 依次丢弃**未发送**增量并标记 needs-resync，直到回到低水位」 | 协议文本 | 协议 §17 L490（字面）；`ReplicationLimits.maxQueuedBytesPerConnection/lowWater/highWater` 三常量已冻结于 `types.ts:26-28` + `defaults.ts:24-26` + `validate.ts:111-113,138-140`（仅缺运行时引用——本设计补用） | 低 |
| 8 | 水位暂停/恢复经注入 timer 周期检查 bufferedAmount（无同步拦截、无 drain event 假设） | 协议文本+设计期实测 | 协议 §17 L492（「Adapter 观察 WebSocket bufferedAmount：超过 high-water暂停 dequeue，降至 low-water恢复。**无 drain event时使用 Cordis Timer调度检查**，不使用原生 timer」）；SA6 慢 socket wire（g3-g4 红灯文件 L152-217）以 `held` 数组 + `bufferedAmount` getter 实现该语义且 `releaseAll` 后才下降——**无任何 drain 事件回调面**（测试即行为证据） | 中（timer 驱动 → 首帧越线的可观测性依赖检查点**起挂条件**——R2 已按 A1 把起挂条件补入 `bufferedAmount() > 0`（§3.4），AC5-WATER/PRI 因此可过；SA2 R1 曾据 R1 缺陷判两例恒红，R2 修复后 §3.7 重推闭合） |
| 9 | fake scheduler `advanceBy(N)` 触发到期时刻 ≤ now+N 的全部 timer（按到期序）；`advanceBy(100)` 必达 100ms 间隔的检查点 | 源码引用 | `packages/namespace-registry/src/testing.ts:74-105`（`advanceBy` while 循环取 `at <= deadline` 的最早项执行——100ms 检查点在 `advanceBy(100)` 的 deadline 覆盖内） | 低 |
| 10 | fanout 投递滞后 ~21 跳微任务/项、`settle()`=300 跳——AC5-RR 原构造四帧入队相隔 ≥ ~335 跳、无同时排队窗口 | 源码引用+现有测试实测 | `replication-session.ts:147-153`（`FANOUT_DELIVERY_DEFERRAL_MICROTASKS = 20` + 泵实现 L218-244）；`test/harness.ts:215-218`（settle 300 跳）；红灯基线实测（本设计期 `vitest run` 15 failed/82 passed 与 SA6 记录一致，AC5-RR 失败输出 wire 序 `A,A,B,B` 即贪心派发序 = 写入序的直接证据） | 中（驱动 §3.8 裁决请求） |
| 11 | 活性只用 WS ping/pong，禁应用层帧；pong timeout 关闭连接 | 协议文本+ADR | 协议 L40（「活性检测只使用 WebSocket ping/pong。协议不定义业务 PING/PONG frame」）；§18 L518-520（ping interval/pong timeout 配置项 +「HELLO/pong timeout关闭连接」）；ADR-0010 L147 | 低 |
| 12 | 冻结契约类型做**加性可选**演进后，既有 `toMatchTypeOf` 断言仍绿（单向赋值兼容） | 设计期实测验证 | `test/ws-replication-api.test-d.ts` 全部为 `expectTypeOf<X>().toMatchTypeOf<{…既有成员}>()` 单向形状检查；TypeScript 赋值规则：源类型新增**可选**成员/可选参数不影响向目标形状赋值（`HubReplication.accept(transport, identity?)` 对 `(transport) => HubConnection` 赋值兼容；`DuplexTransport`/`ReplicationTimeouts` 同理）。本设计期 typecheck 基线 `Type Errors none`（vitest 输出），SA3 实现后由同一门禁复核 | 低 |
| 13 | peer 对 1011 close 按「继续 backoff」分类（不永久 blocked） | 协议文本+源码引用 | 协议 §15.1 GOAWAY 原因块（「1011：继续 backoff，连续失败后降为低频并告警，不永久 blocked」）；`peer-connection.ts:427-438`（onClose 仅 1002/1008 → blocked，其余 → onTemporaryFailure——现状已满足，§3.3 复用） | 低 |
| 14 | checkpoint 间隔 100ms 缺省推导（`floor(ackTimeoutMs/100)`）满足 SA6 `advanceBy(100)` 观察窗；**且检查点会被起挂并在单次 advance 内评估规则 A 与 C**（R2 补 A1/A2 闭环） | 类比已有 job 验证+源码引用+R2 行为自证 | SA6 g3-g4 红灯文件三例（WATER L419/427/439、PRI L449/458、SHED L480）均以 `advanceBy(100)` 为观察步进；§9 的 scheduler 语义保证 100ms 间隔 timer 在该步进内必达；`ackTimeoutMs` 缺省 10_000（`defaults.ts:36`）→ 推导值恰 100。**起挂闭环（A1）**：首数据帧派发后 `bufferedAmount() > 0` → `ensureCheckpoint` 必挂（§3.4 伪码）→ advanceBy(100) 必评估规则 A；**C 可达闭环（A2-3）**：规则 C 与 A 在同一 runCheckpoint 内独立评估（无 else-if 短路），AC5-SHED 的单次 advanceBy 即触达 1011 判定——两闭环均经 §3.7 三例逐帧重推自证 | 低（R2 后） |
| 15 | 「总队列」记账口径 = `queuedDataBytes + bufferedAmount()`（socket 缓冲为传输队列延伸） | 设计期实测（SA6 行为证据）+解释性选择声明 | SA6 慢 socket wire 的 `bufferedAmount` getter 语义（g3-g4 L184-189 注释「socket 缓冲中尚未被对端读取的字节数（真实 WS bufferedAmount 语义）」）+ `held` 数组仅在 `releaseAll` 后清空（缓冲不可外部撤回）——「已派发未冲刷」字节只能观察不能撤回，是总队列的不可控尾部；协议 §17 L490「总队列超限」未定义口径，本设计将其读作 queued+buffered（A2 定案，含 A9 的 1011 阈值同源口径）。**解释性选择**，无协议数值锚 | 低 |
| 16 | `highWater ≤ maxQueuedBytesPerConnection` 是有效配置的链式不变量（lowWater < highWater ≤ max） | 源码引用+测试配置实测 | 现有校验链 `validate.ts:138-140`（lowWater < highWater）+ R2 新增链尾（§3.4）；SA6 三组配置实测满足（WATER 1024<4096≤8MiB、SHED 1024<4096≤64KiB、缺省 64KiB<512KiB≤8MiB）；违反该链的配置使终止性 1011 阈值先于可恢复暂停阈值——构造期响亮拒绝 | 低 |

---

## §12. 契约改动连锁审计

### 改动函数/接口

| 契约 | 文件 | 改动前 | 改动后 |
|---|---|---|---|
| `HubReplication.accept` | `src/types.ts:90`（实现在 `hub-connection.ts:75-83`） | `accept(transport): HubConnection` | `accept(transport, identity?: UpgradeIdentity): HubConnection`；identity 缺失 → 同步 `TypeError`（响亮，非降级） |
| `DuplexTransport` | `src/types.ts:47-53` | 5 成员冻结 | +可选 `bufferedAmount?/ping?/onPong?`（缺省 dormant） |
| `ReplicationTimeouts` | `src/types.ts:31-38` | 6 必填字段 | +可选 `pingIntervalMs?/pongTimeoutMs?`（`ResolvedTimeouts` 必填） |
| `PeerReplicationOptions` | `src/types.ts:101-112` | — | +可选 `deferTask?: (task: () => void) => void`（缺省单次 queueMicrotask） |
| `HubChannelHost` / `PeerNamespaceHost`（包内私有） | `hub-namespace.ts:44-57` / `peer-namespace.ts:34-46` | `sendControl` 承载 UPDATE | +`sendData(message): void`（A7 契约：每帧恰一出口——dispatch/shed/teardown；非 ready 门丢弃必须经 `onDataShed` 显影，禁止静默吞帧）、`dropData(namespaceId): void`（接线面按 §3.5 定案）；UPDATE 出站迁至 sendData |
| `UpdateChannelHost`（包内私有） | `update-channel.ts:10-23` | `sendUpdateFrame(bytes): number`（同步返回序） | 退役；改为 `enqueueUpdate(bytes): void` + 派发回调 `onDataDispatched` / `onDataShed`（序列在实际派发时回传） |
| `PeerNamespaceController.onCloseOk` | `peer-namespace.ts:473-481` | `onCloseOk(): void`（无参） | `onCloseOk(ackedSequence: number): void`（错配不完成 close） |
| `OutboundQueue.sendData` | `frame-io.ts:124-127` | 死代码（零调用者，grep 证实） | **删除**（被 `enqueueData` 真实数据面取代） |
| `LifecycleQueue` | `lifecycle-queue.ts:7-24` | 死代码（零引用，grep 证实） | **删除**（`Memoized` 保留） |
| `NamespaceChannelCore` | `types.ts:172-178` | 死接口（零实现零引用） | **删除** |

**无 throw 契约反转**：本设计不把任何 `return` 路径改为 `throw`（`accept` 的 TypeError 是**新增入参校验**，与 `validateHubOptions` 构造期 TypeError 同族——该族在 PR #160 既有测试中已被 `makeAuthorizer`/`boot` 等合法调用路径规避，唯一受影响调用点见下表）。

### Caller 清单

| Caller | 文件:行号 | 是否 await | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---|---|---|---|---|
| `hub.accept`（driver boot dial 闭包） | `test/driver.ts:431` | 否（同步调用） | ❌ | N/A（测试） | **本设计要求传 identity**（`{ peerInstanceId: PEER_INSTANCE }`，§1.1） |
| `hub.accept`（driver bootFanout） | `test/driver.ts:588` | 否 | ❌ | N/A（测试） | 同上 |
| `hub.accept`（spec-b1-b2 dial 闭包） | `test/ws-replication-spec-b1-b2-red.test.ts:193` | 否 | ❌ | N/A（测试） | 同上 |
| `hub.accept`（SA6 bootMulti） | `test/ws-replication-sa6-hardening-g3-g4-red.test.ts:262` | 否 | ❌ | N/A（测试） | 同上 |
| `hub.accept`（SA6 AC1，已传形状） | `test/ws-replication-sa6-hardening-g1-g2-red.test.ts:63` | 否 | ❌ | N/A（测试） | 零改动（形状精确吻合） |
| `controller.onCloseOk`（唯一 dispatch 点） | `peer-connection.ts:307-309` | 否 | ❌ | N/A | **本设计同步传 `message.ackedSequence`**（§2.2） |
| `channel.onBootstrapAck`（唯一 dispatch 点） | `hub-connection.ts:244-245` | 否 | ❌ | N/A | 已传参；本设计只改通道内校验（§2.1） |
| `host.sendUpdateFrame`（update-channel 唯一调用） | `update-channel.ts:114-119`（sendAndRegister） | 否 | ❌ | N/A（seq≤0 早退既有） | **随 Host 契约改造迁移至 enqueueUpdate/派发回调**（§3.1；同步返回序契约退役，inFlight 登记移至实际派发） |
| UPDATE 出站（peer/hub 通道） | `peer-namespace.ts:714-724` / `hub-namespace.ts:630-639` | 否 | sendChecked 内 catch（编码错→ns ERROR） | N/A | **迁至 `host.sendData`**（数据面编码错捕获点在 `drain()` 的 per-frame try/catch：单帧编码错 → `onDataShed` + best-effort ns ERROR，不断连接不破记账（A7）；`OutboundExhaustedError` 交连接收口路径 + `dispose` 全量 shed；超限丢弃在 handoff 前不变） |
| `queueMicrotask`（deferRecovery/requestRebuild） | `peer-namespace.ts:646` / `peer-connection.ts:499` | — | — | — | **改经 `deferTask` seam**（§5.2；生产缺省单跳，测试经 driver 注入） |
| 类型消费者（api.test-d / harness 镜像类型） | `test/ws-replication-api.test-d.ts:47-59,113-152`；`test/harness.ts:42-109` | — | — | — | 加性可选成员单向赋值兼容（§11 #12）——零改动，typecheck 门禁复核 |

### 风险评估

- **漏改 accept 调用点的代价**：运行时同步 TypeError → 该测试即刻红（响亮失败，非静默错行为）——正是设计意图；grep 面（`git grep -n "\.accept(" -- packages/ test/`）已穷尽于上表 5 处。
- **UPDATE 数据面迁移的时序风险**：单 ns 无 gate 场景派发仍同步于 enqueue 后的 drain（§8.2 已核对）；多 ns 场景行为变更为本任务目标本身（AC5 组）。
- **onCloseOk 签名收紧的风险**：唯一调用点同步更新；无其他 caller（grep 证实）。

---

## §13. SA2 反馈逐条回应（R1 reject → R2 修订映射）

评审报告：`wiki/raw/task_ws-replication-hardening_sa2_review.md`（2026-08-29，verdict: reject）。**R2 后续判决：SA2 R2 verdict = pass（含非阻断放行条件；NB1 机械修订——本表即 R2 实际映射：A1–A11 + SA8 附注逐条给出修订位置与内容摘要，与 R2 头部「逐条映射见 §13 表」指针对齐，无 R1 残文）。**

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| **A1**（CRITICAL）水位检查点起挂条件使首个 highWater 越线不可观测 | ✅ | §3.4（`ensureCheckpoint` 起挂/续挂条件）+ §3.6/§3.7 重推 | 起挂与续挂条件改为 `paused ∨ queuedDataCount()>0 ∨ bufferedAmount()>0`（伪码与注释明示 A1 修复点）；零空闲 timer 纪律不变（三条件皆空不挂）。§3.6 演练首行补「buffered(40B)>0 → 挂 ✓」；§3.7 WATER/PRI 在修复后语义下逐帧重推闭合 |
| **A2**（CRITICAL）shedding 双阈值矛盾 + socket 缓冲计入口径 + 规则 C 可达性 | ✅ | §3.2（口径与滞回定案）+ §3.1（enqueueData 重写）+ §3.4（C 并列评估 + 新校验）+ §3.7（SHED 重推） | (1) 口径定案：总队列 = `queuedDataBytes + bufferedAmount()`（§11 #15 声明解释性选择）；(2) 滞回统一：触发 `> max`，shed 到 `queuedDataBytes ≤ lowWater`（R1 「塞进 max 即停」循环删除）；queued 侧空时按断点接纳（不丢 incoming——AC5-SHED 前提依赖派发持续 + A5 边界下 handoff 帧不回退）；(3) 规则 C 与 A 同检查点独立评估（无 else-if 短路，§3.4 注释明示）+ 新增 `highWater ≤ maxQueuedBytesPerConnection` 构造期校验（§11 #16）；SHED 全程重推：64 帧全部派发（held ≈512KiB）→ 单次 advanceBy → A 暂停 + C 触发 1011 → 信号 ≥1 |
| **A3**（CRITICAL）AC1 第二锚恒红（fatal 后 dropConnection 摘除条目） | ✅ | §1.1（闭环重写）+ §3.8 裁决 2（锚形态定案） | 选型 (b) 测试锚调整：保留 prompt-drop 生产语义（资源卫生正确），替换断言组为 `wire.hubSideClosed === true` + `hub.connections.length === 0`（drop 即正确收口证据）+ 既有锚 1/3 不变；事实链（`Promise.all([])` ≈2 跳 → dropConnection，600 跳后 undefined）与替换推演写入 §3.8；g1-g2 文件列入 ALLOW 调整面 |
| **A4**（HIGH）AC5-RR 替换构造漏 `setGate(false)` | ✅ | §3.8 裁决 1（构造重写） | `setGate(false)` 置于 `releaseAll()` 前（a1 由 releaseAll 送达、b1/a2/b2 由恢复 drain 即时送达 deliveredToPeer，序恰 `[a,b,a,b]`）；另补暂停窗口零派发前置锚；断言面与原 AC5-RR 完全一致 |
| **A5**（HIGH）§3.5 表 dropData 接线指称错误 + hub 自声明丢弃语义未定 | ✅ | §3.5（dropData 语义定案表 + 交互矩阵重写） | 指称错误修正（declareHubResync 不经 markResyncReceived）；语义定案为四象限：溢出族自声明**丢弃**（协议 §17 上半「丢弃全部未发送增量」字面）/ ACK 超时族自声明**保留**（协议 §18 无丢弃面 + 既有 channel.queued 保留语义对称）/ 对端声明与 session 边沿**丢弃**（协议 §9.4「不再发送新 UPDATE」延伸）/ 连接级 shed 丢弃；接线点逐面列明（ACK 超时面不接 dropData） |
| **A6**（MEDIUM）ACK 计时器锚点「精确」声明为假 | ✅ | §2.4（锚点语义声明重写） | 改为「最老剩余在途的上一次观测点（前一最老的 ACK 时刻）为锚的**下界近似**」；明示宽松方向无正确性损害（§18 活性启发、无逐帧 deadline）；验收措辞按近似语义重述 |
| **A7**（MEDIUM）flushQueued 破窗口不变量 + sendData 丢弃路径无记账 | ✅ | §3.1（flushQueued 循环条件 + sendData 契约 + pendingData 出口不变量）| flushQueued 循环条件纳入 `pendingDataCount`；`sendData` 契约：每帧恰一出口（onDataDispatched / onDataShed / teardown 清零），非 ready 门从静默丢改为「丢 + onDataShed」；编码错捕获点写在 `drain()` per-frame try/catch（单帧 shed + best-effort ns ERROR）；transport 已关的派发不算丢弃（zombie 纪律，明示）；dispose 逐 ns onDataShed |
| **A8**（LOW）交叉引用错乱 | ✅ | §0 引用约定 + 全文（§1.2/§2.3/§4.1/§4.3/§4.5/§5.2）+ §11 #8/#14 | 「§3.5 规则 C」→§3.4（R1 交付稿已含，R2 复核）；§11 #8 风险栏改述 A1 修复闭环；全文裸 P5 引用按 §0 约定加前缀 |
| **A9**（LOW）规则 C 阈值口径未注明解释性 | ✅ | §3.3（阈值口径注记）+ §11 #15 | 明示以 `maxQueuedBytesPerConnection` 兼作 socket 缓冲 1011 阈值为解释性选择，依据 = §3.2 合记口径，无新配置面 |
| **A10**（LOW）ping/pong 缺省数值无锚 | ✅ | §5.1（缺省数值注记） | 注明 30_000/10_000 为工程缺省（协议/ADR 无数值规定）+ 选型依据；构造期校验保留 |
| **A11**（LOW）生产 adapter 漏暴露 bufferedAmount → 背压静默不存在 | ✅ | §3.4（DuplexTransport 注释）+ §6（切片 9 票面） | seam 注释明示「生产 adapter 必须暴露」；切片 9 票面加装配期 loud 断言建议（缺面即 TypeError/结构化告警） |
| **SA8 附注**（非阻塞）4 处悬空协议引用 + 术语区分 | ✅ | §0（引用约定 + 术语区分）+ §1.2×3/§2.3/§4.1/§4.3/§4.5/§5.2 | 裸 §13.4×3/§14.1/§10.1（及同类 §10.2/§10.4/§10.6/§11.3）全部改为「P5 §N」带源码注释锚点的引用；§0 立「协议 §N / P5 §N / 本设计 §N」三分约定 + 「连接代际 vs 复制代际」术语区分（后者为 CONTEXT 冻结词，本设计不触及） |
| **SA2 §四裁决**：AC5-RR 构造调整 GRANTED（附 A4 修正；A1/A2 修复后一次性下发 SA6） | ✅ | §3.8（裁决清单重组） | 裁决 1（AC5-RR，含 A4 修正）+ 裁决 2（AC1 第二锚，A3 定案）+ SA2 §四建议补充锚六项一并列入下发单一包；§10 ALLOW LIST 两 SA6 文件条目同步 |

**修订质量自证（SA2 §六要求）**：R2 对 §3.7 三例（WATER/PRI/SHED）与 §3.6 演练在修订后伪码下**逐帧重推**（含 A1 起挂时点、A2 滞回核算与 C 并列评估时点）；§3.8 两个替换测试构造经 harness 投递路径（gated→held、releaseAll→deliveredToPeer、gate 解除后续派发直达）走完全生命周期；§1.1 AC1 闭环含 dropConnection 生命周期时序。
