# task_issue-174-goaway-drain — SA1 防弹架构设计（R2 修订版）

> **R2 修订记录（2026-08-30，落实 SA2 R1 评审全部修订要求）**：MAJOR #1 → §4.6 扩为「drain 互锁四路径」+ `clearDrainHandles()` 单点（§4.4/§8/§6.3 同步更正）；MAJOR #2 → §4.3 终态 `setState` 点全量枚举更正为 **4 处**、第 4 处免通知的真实理由（调用图推导），删除与源码不符的「终态只能从这里进入」表述；MAJOR #3 → §6.1/§11 hub.close() 测试域消费点更正为 **4 处**（补登 sa7-r1 afterAll + 残余边界申报）；MINOR #4 → §4.7 peer 副作用审计改述（blocked 状态门丢弃，R1 引用了不可达路径）；MINOR #5 → §4.3 `notifySettled()` 函数尾部无条件调用指令；MINOR #6 → §4.1 双门重入防御；NOTE #8 → §4.2-D6 in-flight 来源注记；AC-6 适配所有权显式化 → 新增 §6.2.1。架构主轴经 SA2 R1 独立验证全部成立（「核心架构……全部成立」「reject 仅针对三处 MAJOR」），本次修订均为局部补充，**零主决策变更**。

- 任务：修复 PR #173 —— `HubConnectionImpl.shutdownWithGoaway()` 实现真实 GOAWAY drain 与关闭时序（issue #174）
- 任务类型：Bug 修复
- 输入基线：`wiki/raw/task_issue-174-goaway-drain.md`（简报）、`wiki/raw/task_issue-174-goaway-drain_relevant_decisions.md`（SA8 约束清单，verdict clear）、`wiki/raw/20260830-bug-issue-174-goaway-drain.md`（SA5 缺陷报告）、SA6 红灯契约 `packages/ws-replication/test/ws-replication-issue174-goaway-drain-red.test.ts`（R1–R4，4 failed 确定性红灯）
- 协议基准：`docs/protocols/instance-replication-v1.md`（§6.3 L141-149、§12/§13、§14、§15.2 L447、§21 L561-574）经 ADR-0010 L151 授权为唯一 wire contract

---

## §1. 结论摘要

`shutdownWithGoaway()` 把「GOAWAY 发出」与「`transport.close(1001)`」解耦为真实 drain 阶段：

1. **窗口开启**（同步段）：置 `state='draining'`、武装 `drainActive` 结算闸、直发 GOAWAY（保留既有背压豁免理由）、经**注入的 `hub.timer`** 武装 `drainMs` deadline、做一次提前完成检查（channels 全终态/空 → 立即收口）。
2. **窗口内**：连接保持收发。入站帧分级处置——`OPEN_NAMESPACE` 显式拒绝（`ERROR(NAMESPACE_REOPEN_REQUIRES_RECONNECT)` + relatedSequence，零授权、零建道）；`SYNC_STEP1` 无响应丢弃（不开始新 round，§6.3）；其余帧照常分发（现有 namespace 自然收口：UPDATE 接纳+ACK、CLOSE_NAMESPACE 全握手、在途 round 尾帧完成）。
3. **提前完成**：channel 每次进入终态经新增 `HubChannelHost.onChannelSettled()` 一次性通知连接；连接判「全部 channel 终态」→ 立即 `close(1001,'hub-shutdown')`（零时间推进，R2）。
4. **deadline 收口**：timer fire → `finishDrain()` → 复用**既有** `close(1001,'hub-shutdown')`（同步 quiesce + transport close + cleanupAll），不等待任何未完成网络 ACK（AC4）。
5. **结算链**：`settle()` 在 drain 期返回 `drainTail`（resolve-only，cleanupAll 尾部 finally 释放）；`HubReplicationImpl.close()` 结构不动（SA5「settle 聚合面不变」），其 Promise 结算时点自然变为「drain 完成（提前）或 deadline 到达」。

改动半径：仅 `hub-connection.ts`（主）+ `hub-namespace.ts`（+1 内部通知面）。零 wire 格式变化、零新错误码、零公共契约变化、零配置变化。peer 侧不动（SA5 已证接收侧语义完整）。

**⚠ 前置冲突申报（§6.2，需总控/SA6 裁决）**：既有 AC-6（`ws-replication-auth-lifecycle-red.test.ts:383-401`）在冻结虚拟时间下 `await closePromise`，与新契约 R1 RED@2「deadline 前 close Promise 不结算」数学上不可同时满足——两用例输入等价、时间面相同。本设计给出五步证明与 SA6 侧 1 行最小适配方案（插入 hub scheduler 时间推进），不以静默破坏既有基线的方式绕过。

---

## §2. 根因复核（独立验证，与 SA5 一致）

SA5 定位（`hub-connection.ts` L324-340）：`drainMs` 只被编码进 GOAWAY 帧，本地零消费——无 deadline timer、无 channels 自然收口观测、无已接纳 apply 排空等待；GOAWAY 后同栈 `this.close(1001)` 强制全 channel `quiesceConnection()`（强制 `closing`，非自然收口）并 `transport.close(1001)`，`cleanupAll()`（L544-553）随即摘除 transport 监听器，drain 期一切入站帧被 `onMessage` 的 `closedFlag` 早退（L355）静默丢弃。

SA1 独立复核补充三点（SA5 未展开）：

1. **结算链副作用**：`close()` → `cleanupAll()` 同步段替换 `settleTail` 后，`HubReplicationImpl.close()`（L217-227）map 的 `settle()` 立即可结算——`hub.close()` 的 Promise 从未跨过任何窗口（SA5 Symptoms 第 5 点的直接机制）。
2. **handshaking 分支正确性确认**：L326-329 对 handshaking 连接不发 GOAWAY 直接 `close(1001)` —— peer 侧 handshaking 门对非 HELLO_ACK 帧判 `CONNECTION_POLICY_VIOLATION`（peer-connection.ts），GOAWAY-before-ACK 是协议伤害。**保留**（简报明令）。
3. **次要缺陷面确认**（SA5「次要缺陷面」）：drain 窗口内新 OPEN/新 sync round 的「显式拒绝面」缺失——`onMessage` 早退使一切帧零响应。本设计 §4.2 补齐。

---

## §3. 目标时序模型

```text
HubReplication.close()                        （Host 停机入口，§21 步骤 1）
 ├─ closed=true（accept 门 0 即刻拒绝新 Upgrade —— AC1「停止接纳新连接」既有，不动）
 └─ 对每个 connection: shutdownWithGoaway(closeTimeoutMs)
      │
      ├─ state==='handshaking' → close(1001,'hub-shutdown')        【既有分支，保留】
      │
      └─ ready →
          ① drainTail 结算闸武装（settle() 由此 pending —— R1 RED@2）
          ② state='draining'（§15.2 hub FSM 独立状态）
          ③ 直发 GOAWAY(SERVER_SHUTTING_DOWN, drainMs)（背压豁免，既有理由）
          ④ hub.timer.setTimeout(deadline=drainMs)（§8 句柄可清纪律）
          ⑤ 提前完成检查（channels 空/全终态 → 直接 finishDrain）
          │
          ├─ 窗口内（t0 → t0+drainMs）：transport 开放、监听保持
          │    ├─ OPEN_NAMESPACE   → ERROR(NAMESPACE_REOPEN_REQUIRES_RECONNECT)【显式拒绝】
          │    ├─ SYNC_STEP1       → 无响应丢弃【不开始新 round】
          │    ├─ UPDATE/UPDATE_ACK/SYNC_STEP2/SYNC_APPLIED/RESYNC/BOOTSTRAP_ACK
          │    │                    → 照常分发（自然收口；已接纳 apply 排空+ACK）
          │    ├─ CLOSE_NAMESPACE  → closing → drainPendingApplies → session.close
          │    │                    → lease.release → CLOSE_OK(ackedSequence) → closed
          │    │                    → onChannelSettled → 全终态 → finishDrain【提前完成，R2】
          │    └─ 方向违例帧       → 照旧 CONNECTION_POLICY_VIOLATION fatal（纪律不悬置）
          │
          ├─ deadline fire ──────────────────────────────────────→ finishDrain【R1/R3/R4】
          └─ （peer 抢先关 transport → onTransportClosed → 同一收口）
 finishDrain(): clear deadline → close(1001,'hub-shutdown')
   【既有 close 原样复用：sender.teardown + 同步 quiesce 全 channel + transport.close + cleanupAll】
 cleanupAll(): 摘监听 → 各 channel onConnectionClosed（drain applies → session close →
   lease release，§16/§21 顺序）→ dropConnection → finally 释放 drainDone
```

hub 连接状态机（§15.2）：`upgraded → handshaking → ready → draining(真实窗口) → closed`。

---

## §4. 详细设计

### §4.1 `shutdownWithGoaway` 重构（hub-connection.ts L320-340 替换）

```ts
shutdownWithGoaway(drainMs: number): void {
  if (this.closedFlag || this.drainActive) return; // R2-M6：双门重入防御——窗口期重入
    //                                              // 会【覆盖】旧 drainTail/drainDone →
    //                                              // 旧 hub.close() Promise 永不结算
    //                                              // （挂起泄漏）。当前无现实重入路径
    //                                              // （唯一调用点 :221 受 HubReplication-
    //                                              // Impl.closed 门 + hub.close() 幂等
    //                                              // 保护；apps/** 零引用），防御成本一行。
  if (this.state === 'handshaking') {
    this.close(1001, 'hub-shutdown');           // 既有分支：SA5 论证正确，原样保留
    return;
  }
  // ① 结算闸先于一切（HubReplication.close() 随后 map settle() 必须观察到 pending——R1 RED@2）
  this.drainTail = new Promise<void>((resolve) => { this.drainDone = resolve; }); // resolve-only，永不 reject
  this.drainActive = true;
  this.state = 'draining';
  try {
    this.outbound.sendControl({                  // 直发豁免（既有注释理由保留：停机帧
      kind: 'GOAWAY',                            // 不允许被背压额度否决）
      reasonCode: 'SERVER_SHUTTING_DOWN',
      drainTimeoutMs: drainMs,
    });
  } catch {
    this.finishDrain();                          // framing 不可信 = 真降级路径（外部故障）：
    return;                                      // drain 无从宣告 → 直接收口（既有 best-effort 语义）
  }
  // ② deadline：与 GOAWAY 宣告值同源同值（drainMs 即 closeTimeoutMs，R1 断言锚）。
  //    零新 knob；经注入 timer（测试 fake scheduler / 生产 timer 同一 seam，§15.1 纪律）。
  this.drainDeadline = this.hub.timer.setTimeout(() => {
    this.drainDeadline = undefined;
    this.finishDrain();                          // 不等待任何完成事件（AC4/R1）
  }, drainMs);
  // ③ 提前完成初检：channels 空 = 无可收口对象 → 立即收口（GOAWAY 已同步上 wire，
  //    close 随后——帧序仍先于 close 事件，D4 同序锚）
  this.maybeFinishDrainEarly();
}
```

新增私有字段：`drainActive: boolean`、`drainDeadline: unknown | undefined`、`drainDone: (() => void) | undefined`、`drainTail: Promise<void> | undefined`。

### §4.2 窗口内入站帧处置矩阵（`dispatchReady` 前置门）

```ts
private dispatchReady(message: ReplicationMessage, sequence: number): void {
  if (this.drainActive) {
    switch (message.kind) {
      case 'OPEN_NAMESPACE':
        // 显式拒绝（AC1/R3）：零 authorize、零 Registry open、零 channel 创建、不杀连接。
        // relatedSequence = 被拒 OPEN 帧序（§13 ERROR registry「与特定 frame 相关」）。
        try {
          this.sendControlChecked(
            namespaceErrorFrame('NAMESPACE_REOPEN_REQUIRES_RECONNECT', message.namespaceId, sequence),
          );
        } catch { /* 连接已收口；忽略（withChannel 同款既有防御） */ }
        return;
      case 'SYNC_STEP1':
        return; // 新 round 不接纳：无响应丢弃（决策依据见下表 D2 行）
      default:
        break;   // 其余帧照常走既有分发（自然收口）
    }
  }
  /* …既有 switch 原样… */
}
```

处置决策表（每行给出为什么**不是**静默降级、为什么**不**触犯「控制帧不静默吞」纪律）：

| # | 帧类（窗口内） | 处置 | 依据与拒绝的替代方案 |
|---|---|---|---|
| D1 | `OPEN_NAMESPACE` | 显式 `ERROR(NAMESPACE_REOPEN_REQUIRES_RECONNECT, relatedSequence)`，零授权零建道，连接存活 | AC1/R3 要求显式拒绝。在途 OPEN「非 peer 违例」（R3 注释）→ 不可用 violation/fatal 码（见 §4.7 码型论证）。边界注记：拒绝帧走 `sendControlChecked`（保留额度判据单点，§4.3 既有架构）——极端背压下控制额度耗尽触发既有 `CONNECTION_BACKPRESSURE`（close 1011）语义，不因 drain 悬置（与 GOAWAY 直发豁免不同：拒绝帧非停机关键帧，无豁免理由）。 |
| D2 | `SYNC_STEP1` | 无响应丢弃（round engine 零推进、channel 状态零变化、连接存活） | ① §6.3 字面：「收到 GOAWAY 后……**不开始新 sync round**」——义务主语是收到 GOAWAY 的一方（双侧）；hub 侧的履行方式 = 不开启 round（`RoundEngine.onStep1` 不被调用即不推进），丢弃即履行，不存在「应答却被吞」的期待帧。② registry 中不存在「非 fatal 的 round 拒绝码」（§13.2 全表 fatal-for-namespace=yes，`ACK_TIMEOUT` 是超时不是拒绝）；若回 `SYNC_STATE_VIOLATION` → channel 终态化 → 触发 §4.3 提前收口 → 违反 R3「窗口保持到 deadline」的红线。③ RoundEngine 结构事实：hub 收到的任何 Step1 要么是新 round（`roundId > lastRound`，round-engine.ts:99-116）要么是重复违例（`:101-103`）——两者在窗口内都应以「不开 round」应答；在途 round 的完成帧（Step2/SYNC_APPLIED）不含 Step1，故全量丢弃 Step1 不误伤在途 round（D4 行）。④ 恢复纪律：重连后重新 OPEN + reconcile（协议核心恢复路径），零状态损伤。 |
| D3 | `UPDATE`（现有 channel） | 照常接纳：sequencer apply + `UPDATE_ACK`（若 channel 非 quiet） | §6.3「现有 namespace 到 deadline 前自然收口」；R4 已接纳 apply 排空的同一语义面（接纳层是 channel 状态门，非连接门）。 |
| D4 | `SYNC_STEP2` / `SYNC_APPLIED`（在途 round 尾帧） | 照常转发 channel，在途 round 自然完成 | 同 D3；在途 round 的完成不经过 Step1（D2 论证③），「自然收口」含在途轮次的收尾。 |
| D5 | `UPDATE_ACK` | 照常转发 `channel.onUpdateAck`（违例照旧 `ACK_STATE_VIOLATION` fatal） | R1 的「迟到回调零副作用」只约束 **close 之后**的迟到帧（监听已摘、零投递）；窗口内 ACK 属正常收口。序列纪律不因 drain 悬置。 |
| D6 | `CLOSE_NAMESPACE` | 照常全握手（`onCloseRequest` 既有链：closing → drainPendingApplies → closeSessionAndRelease → `CLOSE_OK(ackedSequence=帧序)` → closed） | R2 主锚；§12/§13 既有实现原样可用——**前提是本设计不在 GOAWAY 时 quiesce channel**（旧实现的强制 `closing` 正是 R2 红灯根因）。**现实来源注记（R2，SA2 NOTE #8）**：生产时序下 peer 收 GOAWAY(SHUTTING_DOWN) → blocked（`enterBlocked` 清发送队列 + `sendControl` 非 ready 门 peer-connection.ts:489 + `onConnectionFatal` 本地静默）→ **blocked 后 peer 不会主动发 CLOSE**；窗口内合法到达的 CLOSE 的现实来源是「**GOAWAY 送达前已在途的 CLOSE**」。hub 义务是正确处理任何合法入站帧（wire 层防御契约），R2 实测的正是该 in-flight 场景——后续维护者不得据此预期 blocked peer 会发 CLOSE。 |
| D7 | `ERROR`（peer→hub，namespace 域） | 照常转发（channel 终态化 → 计入提前完成） | 自然收口的失败面也是收口。 |
| D8 | `RESYNC_REQUIRED` / `BOOTSTRAP_ACK` | 照常转发（状态推进无害；peer 收 GOAWAY 后不再开新 round，D2 已封） | 状态机一致性。 |
| D9 | 方向违例帧（HELLO/HELLO_ACK/OPEN_OK/BOOTSTRAP_SNAPSHOT/IDENTITY_CHANGED/GOAWAY/CLOSE_OK） | 照旧既有处置（多数 `CONNECTION_POLICY_VIOLATION` fatal） | 方向/协议纪律不因 drain 悬置；真实违例仍应响亮关闭。 |

`onMessage` 的 `closedFlag` 早退（L355）在窗口内不触发（`closedFlag` 直到 finishDrain 才置位）——这是「窗口内帧可达分发层」的机制前提。

### §4.3 提前完成观测（hub-namespace.ts +1 通知面）

`HubChannelHost`（hub-namespace.ts L44-66）新增一个方法（包内内部接口，非 SA6 冻结公共契约）：

```ts
/** channel 进入终态（closed/conflicted/failed）的一次性通知——连接 drain 窗口
 *  提前完成观测（issue #174 §4.3）；非 drain 期调用方 no-op。 */
onChannelSettled(namespaceId: string): void;
```

`HubNamespaceChannel` 新增 `settledNotified` 记忆位 + `notifySettled()`。**终态 `setState` 点源码全量枚举（R2-M2 更正——R1 初版「且仅这三个——终态只能从这里进入」与源码不符）**：channel 到达终态的 `setState` 调用点共 **4 处**——

1. `finalize()`（hub-namespace.ts:823-828）——watchdog / violation / terminateUnauthorized / error-mapping 全部经此；
2. `onCloseRequest` 的 `closeQueue` 尾部（:542-558）`setState('closed')`——R2 的自然收口入口；
3. `finishOpenError`（:364-375）的 `setState(targetState)`（注意其外层守卫 `if (this.state === 'opening' || !this.isTerminal())`——已终态时**跳过 setState**）；
4. `onConnectionClosed()`（:593-600）closeQueue 链尾 `if (!this.isTerminal()) this.setState('closed')`（:598）。

**通知面只需覆盖前 3 处**；第 4 处**免通知的真实理由（R2-M2）**：`onConnectionClosed` 只被 `cleanupAll()` 调用，而 `cleanupAll()` 的全部调用方（`close()` / `onTransportClosed()` / `connectionFatal()` / `onSequenceExhausted()`——见 §4.6 四路径）都**先置 `closedFlag=true`**——即第 4 处执行时 drain 必已终结，`maybeFinishDrainEarly` 首行 `!drainActive || closedFlag` 早退使通知在那里即使发生也无效果。因此「drain 语义相关的通知只需这三处」是**由调用图推导的正确结论**，而非「终态只能从这三处进入」的事实陈述（后者错误，R2 更正）。防御纵深声明：`maybeFinishDrainEarly` 的 `closedFlag` 检查**不是冗余**——若未来重构改变调用图（如新的 `onConnectionClosed` 调用方未先置 `closedFlag`），它是防止静默失效的第二道闸，SA3/后续维护者不得以「第四处免通知」为由删除。

**调用指令（R2-M5，消除实现歧义）**：`notifySettled()` 在每个入口（前 3 处）的**函数尾部无条件调用**（`settledNotified` 记忆位保证每 channel 至多一次），**不依附于任何 `setState` 分支**——具体到 `finishOpenError`：其守卫跳过分支（已终态时）同样走到函数尾部通知；该情形下先前入口已通知过、记忆位吸收，两种放置方式（守卫内/守卫外）经记忆位等价，但设计钉死「尾部无条件」以消除 SA4 比对噪音。

连接侧实现：

```ts
// channelHost 构造段追加：
onChannelSettled: (_namespaceId) => this.maybeFinishDrainEarly(),

private maybeFinishDrainEarly(): void {
  if (!this.drainActive || this.closedFlag) return;
  for (const channel of this.channels.values()) {
    const s = channel.state;                    // 公开字段，零新投影 API
    if (s !== 'closed' && s !== 'conflicted' && s !== 'failed') return;
  }
  this.finishDrain();                           // 全部终态（或 channels 空）→ 提前收口
}
```

设计要点：

- **判定语义**：drain「完成」= 每一个 (connection, namespace) 通道都到达生命周期终态。`'closing'` **不算**完成（CLOSE 握手在途、apply 在排空——此时关 transport 会截断握手）。R2 中 CLOSE_OK 发出后 `setState('closed')` 才通知 → 时序正确。
- **非 drain 期零开销**：`maybeFinishDrainEarly` 首行 `!drainActive` 早退——`finalize()` 在正常运行中高频存在（普通 channel 失败），通知面不改变任何既有行为。
- **记忆位防重**：`settledNotified` 保证每 channel 至多通知一次（重复通知本身幂等，记忆位是整洁性而非正确性前提）。
- **不再需要轮询/心跳**：终态转移全部发生在同步段或 `closeQueue` 微任务链内，通知是事件驱动的——R2 的 `settleUntil`（纯微任务，不推进时间）可观测到提前收口。

### §4.4 deadline 收口（`finishDrain`）

```ts
private finishDrain(): void {
  if (this.closedFlag || !this.drainActive) return;   // 幂等：deadline/提前/对端关三入口合流
  this.clearDrainHandles();                            // R2-M1：§4.6 单点（drainActive 复位 +
                                                       // deadline 句柄清理，四路径共用）
  this.close(1001, 'hub-shutdown');                    // 既有收口原样复用（见 §4.6）
}
```

- deadline fire 时**不检查任何 channel/apply 状态**——「不等待未完成的网络 ACK 超过 drain deadline」（AC4；ADR-0010 L179 的网络侧等待域，见 §5）。
- `close(1001,'hub-shutdown')` 保留 D4 的 `meta.hub === {code:1001, reason:'hub-shutdown'}` 观测与「GOAWAY 帧先于 close 事件」的 wire 次序（GOAWAY 在窗口开启时同步上 wire，`sendControl` 同步 drain，frame-io.ts:126-131；close 在 deadline 或提前完成点）。

### §4.5 结算链：`settle()` / `HubReplication.close()`

```ts
settle(): Promise<void> {
  return this.drainTail ?? this.settleTail;   // drain 期 → 窗口末结算；否则既有语义
}
```

- `HubReplicationImpl.close()`（L217-227）**代码零改动**：`shutdownWithGoaway` 同步段先武装 `drainTail`，随后 `connectionList.map(c => c.settle())` 必然取到 pending 的 `drainTail`（R1 RED@2 的机制保证——调用序在同一个同步栈内，无竞态窗口）。
- handshaking 分支不武装 `drainTail`：`settle()` 返回被 `close()→cleanupAll()` 同步替换的 `settleTail`，既有快速结算语义不变（如 hub 停机瞬间尚在握手的连接）。
- `drainTail` **resolve-only**：构造器只捕获 `resolve`，不存在 reject 路径 → 零 floating rejection（R1 断言 `rejections.events === []`）。

### §4.6 drain 互锁四路径（R2-M1 扩维：`close()` / `onTransportClosed()` / `connectionFatal()` / `onSequenceExhausted()`）

**问题（R1 初版疏漏，SA2 MAJOR #1）**：`connectionFatal()`（hub-connection.ts:555-573）与 `onSequenceExhausted()`（:607-616）两条连接终结路径**不经过 `close()` 也不经过 `finishDrain()`**——各自直接置 `closedFlag=true` + `void cleanupAll()`。若不加清理，drain 窗口期内发生连接级 fatal（malformed 帧、SEQUENCE_VIOLATION、方向违例 D9、PONG_TIMEOUT、D1 拒绝帧额度耗尽触发的 `CONNECTION_BACKPRESSURE` 1011——SA2 NOTE #7 边界）或出站序列耗尽时，`drainDeadline` timer 残留在 `hub.timer` 上直到 fire。fire 回调经 `finishDrain()` 首行 `closedFlag` 早退**行为安全**，但违反 §8 timer 纪律「句柄必清」（ADR-0010 #161 修订节精神）、污染 fake scheduler `pending()` 计面（+1 直至 advanceBy 越过 deadline——未来任何「drain 期 fatal + pending() 断言」组合必踩，SA2 红线思路 #1/#2 即为此守卫）、回调闭包持有 connection 引用阻碍 GC（有界 ≤drainMs）。

**修订：单点 helper + 四路径全调用**：

```ts
/** R2-M1 单点：drain 复位 + deadline 句柄清理。幂等；四条连接终结路径共用。 */
private clearDrainHandles(): void {
  this.drainActive = false;
  if (this.drainDeadline !== undefined) {
    this.hub.timer.clearTimeout(this.drainDeadline);   // §8 句柄必清纪律
    this.drainDeadline = undefined;
  }
}
```

| # | 终结路径 | 触发场景 | drain 互锁指令 |
|---|---|---|---|
| 1 | `close(code?, reason?)`（L308-318，公共） | 宿主窗口期 force-close（逃生舱）/ `finishDrain()` 终结器 / handshaking 分支 | 同步段首部调用 `clearDrainHandles()`（含下方两处最小修改） |
| 2 | `onTransportClosed()`（L536-542） | 对端在窗口期抢先关 transport | 既有体前加 `clearDrainHandles()`——对端已关 = 窗口无服务对象，走既有收口 |
| 3 | `connectionFatal(code, wsCloseCode)`（L555-573） | 窗口期连接级 fatal（decode 失败/序列违例/方向违例/HELLO 纪律/PONG 超时/背压 1011） | **R2 新增**：`sender.teardown()` 前加 `clearDrainHandles()` |
| 4 | `onSequenceExhausted()`（L607-616） | 出站 uint32 耗尽（实践不可达，防御路径） | **R2 新增**：`sender.teardown()` 前加 `clearDrainHandles()` |

路径 3/4 的 `drainDone` 结算不依赖句柄清理：两条路径都 `void cleanupAll()`，`cleanupAll` 尾部 finally 释放 `drainDone`（见下）→ `hub.close()` Promise 照常结算——句柄清理是纪律/计面/GC 修正，不是结算链前提。

`close(code?, reason?)` 是窗口终结器，**同步语义原样保留**（R3-1/R3-2 既有锚：直接调用 `conn.close()` 后同步栈内 channel 已离开 live、订阅已摘——`quiesceConnection()` 循环不动）。仅做两处最小修改：

1. `clearDrainHandles()`（公共 `close()` 在窗口期被宿主直接调用 = force-close 逃生舱：立即收口、跳过剩余窗口——合理的公共语义，文档化）；
2. `this.state = 'draining'` → `this.state = 'closed'`（§15.2 FSM 终态对齐：其余三条路径都已置 `'closed'`，唯 `close()` 置 `'draining'` 是历史不一致；经审计无任何测试观察 close 路径的 post-close state 值——见 §11 观察者清单）。

```ts
close(code?: number, reason?: string): void {
  if (this.closedFlag) return;
  this.closedFlag = true;
  this.state = 'closed';                        // ← 由 'draining' 改（FSM 对齐，§4.6-2）
  this.clearDrainHandles();                     // ← R2-M1：单点（原 inline 复位+清句柄收敛于此）
  this.sender.teardown();
  for (const channel of this.channels.values()) channel.quiesceConnection();
  if (!this.transport.closed) {
    this.transport.close(code ?? 1001, reason ?? 'hub-close');
  }
  void this.cleanupAll();
}
```

`cleanupAll()`（L544-553，四路径共同收口点）尾部追加 finally 语义释放：

```ts
private async cleanupAll(): Promise<void> {
  /* …既有体原样（quiesce → stopLiveness → 摘监听 → onConnectionClosed 链 → dropConnection）… */
  try {
    this.settleTail = Promise.all(cleanups).then(() => undefined);
    await this.settleTail;
    this.hub.dropConnection(this);
  } finally {
    const done = this.drainDone;                // 结算闸在清理链尾释放——即使清理异常，
    this.drainDone = undefined;                 // close() Promise 也绝不悬挂
    done?.();
  }
}
```

收口幂等性（SA5 已论证、本设计依赖）：`settleClose()` 链式追加 + `closeSessionAndRelease()` 内 `session/lease` undefined 短路——R2 提前收口后再经 `cleanupAll→onConnectionClosed` 二次收口零重复释放。

### §4.7 OPEN 拒绝码型论证（为何是 `NAMESPACE_REOPEN_REQUIRES_RECONNECT`）

registry（协议 §13.2）逐码盘点：

| 候选 | 否决/采纳 | 理由 |
|---|---|---|
| `NAMESPACE_REOPEN_REQUIRES_RECONNECT` | **采纳** | retryable=`reconnect`、terminal=`closed`——「此连接上不可获得该 namespace，须重连后重开」与 drain 拒绝**同构**；非 fatal-指控语义，匹配 R3「在途 OPEN 非 peer 违例」。peer 消费语义（正常时序，peer 未 blocked 时）：`onErrorFrame` → 终态 `closed` → 重连后 re-OPEN（§16「closed：等待连接重建」）；生产 drain 时序下该路径被 blocked 门前置（见下方副作用审计 R2-M4——结果等价）。 |
| `CONNECTION_POLICY_VIOLATION` | 否决 | connection fatal（1008）→ 杀连接 → 违反 R3「拒绝不杀连接（窗口保持到 deadline）」。 |
| `NAMESPACE_STATE_VIOLATION` / `SYNC_STATE_VIOLATION` | 否决 | fatal-for-namespace、terminal=`failed`——指控违例；且终态化 channel → 若为唯一 channel 会触发 §4.3 提前收口 → 窗口提前关闭 → R3 红。 |
| `TARGET_NOT_REQUESTED` | 否决 | 语义误指「peer 未配置该 target」，与事实相反。 |
| 新增 wire 码 | 否决 | 码表 append-only 属协议演进（需改 wire contract 文档）；bug 修复任务不扩协议面。既有码已足够表达。 |

副作用审计（R2-M4 改述——R1 初版引用了一条**生产时序下不可达的路径**「peer 有 target → onErrorFrame → 终态 closed」；SA2 复核确认结果等价、无行为缺陷，但论证瑕疵须更正）：

1. **R3 测试面**：注入 OPEN 经 `injectPeer` 绕过 peer 状态机直达 hub；hub 的拒绝 ERROR 帧到达真实 peer 时，peer 已因 GOAWAY 进入 blocked——`onMessage` 对非 handshaking/ready 状态**丢弃一切后续入站帧**（peer-connection.ts:255），ERROR 到不了 peer controller（ns2 亦无 controller，:369-374 未命中不响应）——零乒乓、零额外帧；断言锚在 **hub 出站帧面**，不依赖 peer 处理，测试安全。
2. **生产时序等价性**：GOAWAY 在窗口开启时发出，拒绝帧只能更晚到达 peer → blocked 状态门丢弃不可避免——**结果等价**：peer 已终态化 blocked（本就是「重连后 re-OPEN + reconcile」恢复路径的起点），拒绝帧在其上不再有增量语义。wire 契约的完备性不因此受损：拒绝帧的价值在 GOAWAY 丢失/乱序等异常时序下仍然成立（peer 未 blocked 时可正确消费）。

---

## §5. 两个等待域的边界（SA8 冲突报告要点 2 的落地）

| 等待域 | deadline 是否覆盖 | 机制归属 |
|---|---|---|
| **网络 ACK / transport 存续** | **是**——`drainDeadline` fire 无条件 `close(1001)`，不等待任何在途 ACK/握手 | 本设计 §4.4（AC4；ADR-0010 L179「不无限等待网络 ACK」） |
| **Runtime 已接纳 apply 槽** | **否**——`cleanupAll → onConnectionClosed → drainPendingApplies()` 无 deadline、不取消（`Promise.allSettled`）；`hub.close()` Promise 可晚于 deadline 结算（等 apply 排空） | ADR-0008 L93「此前已接纳任务无条件排空，不取消、不设内部 timeout」——既有代码，不动 |

推论（防 SA2 攻击预埋）：若 deadline 时仍有 apply 悬挂（如 R4 的 saveGate 不释放），transport 照常在 deadline 关闭（网络域硬顶），但 `hub.close()` Promise 等到 apply 完成才结算（Runtime 域 barrier）——两域各自独立正确，不混同、不互相豁免。

---

## §6. 既有测试兼容性审计（175 基线逐锚过堂）

### §6.1 直接受 `hub.close()` 时序变化影响的既有锚（R2-M3 更正：测试域消费点全量 **4 处**，grep 证据）

grep 方法与结果（SA2 复核同款）：`grep -rn "hub\.close()" packages/ws-replication/test/` → **4 处**（`ws-replication-sa7-r1-transport-auth.test.ts:312` / `ws-replication-sa7-r2-transport.test.ts:363` / `ws-replication-auth-lifecycle-red.test.ts:385`+`:393` / `ws-replication-sa7-r1-transport-auth.test.ts:503`）；生产域消费点即 `HubReplicationImpl.close()` 自身（§11）。R1 初版「全量 3 处」漏了 sa7-r1 afterAll——R2 补登。

| 既有锚 | 判定 | 依据 |
|---|---|---|
| **D4**（`ws-replication-sa7-r1-transport-auth.test.ts:437-524`，realTimer + 真实 TCP） | ✅ 保持绿 | `await hub.close()` 阻塞至真实 5s 窗口末（it 有 90s timeout）；GOAWAY 在 t0 同步上 wire、socket-close 在 t0+5s → 「GOAWAY 帧先于 close 事件」次序不变且间隔从 0 变 5s（D4 只断言次序不断言间隔——SA5 Evidence 2 明证）；`meta.hub={1001,'hub-shutdown'}` 不变；窗口内 peer blocked 静默（peer-connection.ts:404-408 → enterBlocked 清队列清 timer、零出站）→ 零 ERROR 帧 ✓；peer 终态 blocked ✓。 |
| **sa7-r1 afterAll**（`ws-replication-sa7-r1-transport-auth.test.ts:307-313`，realTimer，`Promise.race([hub.close(), 3s setTimeout])`）——**R2-M3 补登** | ✅ 保持绿（含残余边界申报） | afterAll 先逐 peer `peer.stop()`（同型 race 3s 兜底）→ peer transport 关 → hub `onTransportClosed` → 连接 `closedFlag` → `hub.close()` 时 `shutdownWithGoaway` 首行早退 → `settle()` 即返已结算 `settleTail` → 第二个 race 兜底不触发，零残留 timer（与 r2-transport afterAll 同型态——R1 初版对后者逐字论证却漏登前者，论证覆盖不对称，R2 更正）。**残余边界**（低概率、无断言失败）：若某 `peer.stop()` 恰超 3s（race 兜底先行返回），对应 hub 连接未收口 → `hub.close()` 进入真实 drain（5s 真实 timer）→ 第二个 race 3s 再兜底 → afterAll 返回时 drain timer 残留，进程退出尾部最多 +drainMs——活链路观测点（vitest 退出时长无 +5s 尾巴）归 SA7（SA2 红线思路 #4）。 |
| **r2-transport afterAll**（`ws-replication-sa7-r2-transport.test.ts:355-364`，`settleClose` 3s race） | ✅ 保持绿 | afterAll 先 `run.destroy()`（销毁 transport → hub 连接已 `closedFlag`）→ `shutdownWithGoaway` 首行早退 → `settle()` 即返已结算 `settleTail` → `hub.close()` 立即结算，settleClose race 甚至不需要超时兜底。零残留 timer。 |
| **AC-6**（`ws-replication-auth-lifecycle-red.test.ts:383-401`，fake scheduler） | ⚠️ **不可原样保持绿**——需 SA6 侧 2 行适配（§6.2/§6.2.1） | 见下。 |

### §6.2 AC-6 × R1 不可同时满足的证明与最小适配方案

**五步证明**（全部源码可查证）：

1. **输入等价**：R1 `boot({ timeouts: { closeTimeoutMs: 5_000 } })`（red test L64）与 AC-6 `boot({})`（L384）的解析后配置等价——`resolveTimeouts` 逐字段合并缺省（defaults.ts:56-61），缺省 `closeTimeoutMs=5_000`（defaults.ts:38）≡ R1 显式值；其余 boot 参数两用例全缺省（同一 waitFor='live'、同一单 namespace live 拓扑）。
2. **时间面等价**：hub 侧唯一时间面 = 注入的 fake scheduler（driver boot：`timer: hubNode.scheduler`）；`createRegistryTestScheduler` 是纯 map 队列 fake，timer **仅在 `advanceBy` 时触发**，与真实时间无关（namespace-registry/src/testing.ts:74-109）。
3. **两用例断言点前均无时间推进**：R1 在 settled 检查前只有 2×`settle()`（harness.ts:247-251——纯 300 次 `await Promise.resolve()` 微任务泵，不推进虚拟时钟、不冲刷 defer 泵）；AC-6 在 `await closePromise` 前只有 1×`settle()`。
4. **矛盾**：R1 L89-94 要求 closePromise 在 ≥600 个微任务检查点后仍 pending（窗口开启）；AC-6 L393 要求 closePromise 在无任何时间推进的微任务因果内 settle。同一输入 + 同一时间面 + 微任务因果闭包（`await pendingPromise` 不泵送任何新因果）⇒ **不存在同时满足两者的实现**。
5. **归属**：AC-6 的 `await closePromise` 内嵌 issue-#138 时代的旧时序假设（close 随 cleanupAll 立即结算——当时是正确契约）；issue #174 的新契约（SA5 Fix direction：「修复后该 Promise 的结算时点自然变为 drain 完成（提前）或 deadline 到达」+ SA6 R1 RED@2 显式断言）改变了该假设。**冲突是测试基线的时代差，不是实现选择问题。**

**最小适配方案（SA6 owned，本设计 ALLOW LIST 已登记；所有权协议见 §6.2.1）**——`ws-replication-auth-lifecycle-red.test.ts` AC-6 在 `await closePromise`（L393）前插入 2 行：

```ts
await run.hubNode.scheduler.advanceBy(CONTRACT_TIMEOUTS.closeTimeoutMs); // hub 侧虚拟时钟推进至 drain deadline（注意：driver.advanceMs 推进的是 peer scheduler，不可用）
await settle();
```

适配后 AC-6 全部既有断言**原值保留**：GOAWAY 断言在插入点之前不受影响；`accept → undefined` 由 `hub.closed` 在 `close()` 同步段置位（既有）；`run.hub.connections.length === 0` 由 deadline → finishDrain → cleanupAll → dropConnection 在 advance 后的微任务内达成。

**备选方案（供总控裁决，本设计不默认采用）**：若裁定 AC-6 一个字都不能动，则唯一出路是放弃 R1 RED@2 的窗口结算语义（close Promise 提前结算 + transport 延后关）——该方案与 SA5 Fix direction、SA6 红灯契约、AC「不等待未完成网络 ACK 超过 drain deadline」的宿主停机语义（close Promise 是 Host 进入 Registry shutdown 的门闩）全面冲突，**不推荐**。

### §6.2.1 AC-6 时序适配的所有权协议（R2 显式化）

| 维度 | 裁决 |
|---|---|
| **改什么** | `ws-replication-auth-lifecycle-red.test.ts` AC-6（L393 `await closePromise` 前）插入 2 行：`await run.hubNode.scheduler.advanceBy(CONTRACT_TIMEOUTS.closeTimeoutMs);` + `await settle();`（`CONTRACT_TIMEOUTS`/`settle` 该文件均已 import，:52/:60；注意 `driver.advanceMs` 推进的是 **peer** scheduler，不可用）。既有断言语义零变化——GOAWAY 断言在插入点前；`accept → undefined` 依赖的 `hub.closed` 在 `close()` 同步段置位；`connections.length===0` 由 deadline → finishDrain → cleanupAll → dropConnection 在推进后的微任务内达成。 |
| **谁改（所有权）** | **SA6 独占**。依据：2026-06-13 立法（SA6 owned 测试文件必须以 `[SA6 owned]` 进 ALLOW LIST、SA3 不得改断言逻辑）；本设计 ALLOW LIST 已登记该文件为 `[SA6 owned]`。**SA3 的实现 PR 不得包含此文件改动**——否则 Scope Creep Guard 比对时 ALLOW LIST 登记与 diff 主体不一致，且违反测试所有权立法。 |
| **何时改** | 必须与 SA3 实现落在**同一任务轮次**、且先于 SA4 全量验证门禁（`npx vitest run packages/ws-replication`，简报 AC-8）完成——否则套件呈现 1 个由测试时代差造成的**假回归**（AC-6 timeout），污染「175 基线保持绿」判定，SA4 会把真实现缺陷与假回归混在一起 reject。建议时序：总控在派发 SA3 的同一轮先派发 SA6 适配（或 SA6 与 SA3 并行、适配先行合入）。 |
| **谁裁决** | 总控。本冲突已作为前置冲突申报（§1 摘要）上报；SA2 R1 评审已独立复核五步证明并确认「矛盾真实存在」「P6 申请 SA6 实证的处理恰当」（sa2_review §协议假设依据审查 P5/P6 行）。若 SA6 资源不可用，由总控裁定代执行路径——**不得由 SA3 越权自改**。 |
| **为什么不能反向适配** | 即「改实现迁就 AC-6 的 `await closePromise`」——见 §6.2 备选方案：与 SA5 Fix direction、SA6 R1 RED@2 显式断言、AC4 宿主停机语义全面冲突。SA2 R1 已将其列为不推荐。适配方向只能是测试侧时间推进。 |
| **回归守卫** | SA2 红线思路 #4：适配后 AC-6 全断言原值 + r2-transport/sa7-r1 afterAll 无新增挂起（vitest 退出时长无 +5s 尾巴）。

### §6.3 其余既有锚（间接面抽查）

| 锚 | 判定 | 依据 |
|---|---|---|
| R3-1/R3-2（`ws-replication-review-revisions-r1-r7-red.test.ts:532-564`，直接 `conn.close(1001,'sa6-r3-quiesce')`） | ✅ | 不经 `hub.close()`/drain；`close()` 同步 quiesce 语义原样保留（§4.6），两锚断言的同步静默不变。 |
| R2-2 序列耗尽（`ws-replication-issue137-r2-red.test.ts:246-266`，断言 state `'closed'`） | ✅ | `onSequenceExhausted` 路径未动，state 直接置 `'closed'`（:613-614）。 |
| AC-5 / A2-a..e / G1 / G2 / D5 / D3（peer 侧 GOAWAY drain 全家） | ✅ | peer-connection.ts / peer-namespace.ts 零改动（SA5「接收侧语义完整」）。 |
| sa7-dynamic hub `scheduler.pending()` 计数锚（:75-117） | ✅ | 这些用例不调用 `hub.close()`；drain timer 只在 shutdown 后存在，且连接终结**四路径**（close / onTransportClosed / connectionFatal / onSequenceExhausted）经 §4.6 `clearDrainHandles()` 单点清理——R2-M1 更正（R1 初版「双点清」漏 fatal/exhausted 两路径）；drain 期 fatal 的计面回归由 SA2 红线思路 #1/#2 守卫（§7.1）。 |
| sa6-hardening G3/G4 / issue137 全系 / spec-b1-b2 / ac1-ac7 | ✅ | 无 hub.close() 调用点（§6.1 grep 全量 4 处已覆盖）；连接分发层前置门只在 `drainActive` 时改变行为，正常运行零路径变化。 |

---

## §7. 红灯契约逐条映射（R1–R4 → 设计条款）

| 红灯 | 断言 | 设计条款 |
|---|---|---|
| **R1** 窗口与 deadline | GOAWAY×1 + `drainTimeoutMs=closeTimeoutMs`；peer blocked；t0 `hubSideClosed=false`；t0 closePromise pending；advance(5000) → closed + `peerSideCloseInfo.code=1001`；closePromise 结算；迟到 UPDATE_ACK/CLOSE_NAMESPACE 零响应零 CLOSE_OK 零异常 | §4.1①③（结算闸先武装 + GOAWAY 同步直发）；§4.1②（deadline=drainMs 同源）；§4.5（settle→drainTail）；§4.4（fire 无条件 close）；§4.6（cleanupAll 摘监听 → 迟到帧零投递；drainTail resolve-only → 零 unhandled rejection） |
| **R2** 自然收口 | t0 窗口开放；窗口内 CLOSE → `CLOSE_OK(ackedSequence=帧序)`；唯一 channel 收口后零时间推进 1001 提前关；closePromise 结算 | §4.2-D6（窗口内不 quiesce——GOAWAY 时零 channel 强制收口，既有 `onCloseRequest` 链原样可用）；§4.3（closed 终态通知 → `maybeFinishDrainEarly` → finishDrain）；§4.6（`sendControl` 同步上 wire → CLOSE_OK 先于 close 事件） |
| **R3** 新 OPEN/新 round 拒绝 | t0 窗口开放；OPEN → 零 OPEN_OK + ≥1 ERROR；SYNC_STEP1(新 roundId) → 零 round 响应；拒绝不杀连接（窗口到 deadline）；deadline 1001 | §4.2-D1（显式 ERROR + relatedSequence，零建道零授权）；§4.2-D2（Step1 丢弃——不开 round 且**不**终态化 channel，窗口因此保持）；§4.7（码型：拒绝≠违例≠杀连接）；§4.1②（deadline） |
| **R4** pending apply 排空 | apply 在途时窗口开放 + GOAWAY×1；释放门闩后 apply 排空（值收敛 + saveEvents+1）；排空后、deadline 前窗口仍开放；deadline 1001 + closePromise 结算 | §4.1（GOAWAY 不触发 quiesce/cleanup——apply 链不被截断）；§4.2-D3（窗口内 UPDATE 照常接纳）；§4.3（live channel 非终态 → 不提前收口）；§4.4（deadline 硬顶 transport）；§5（apply 槽在 cleanupAll 无 deadline 排空） |

R4 的 UPDATE_ACK 侧写：门闩释放后 apply 完成，channel 仍 live（非 quiet）→ 既有 `applyRemoteUpdate` 发 `UPDATE_ACK`（hub-namespace.ts:739-744）——窗口内正常 ACK，R4 无断言禁止，符合 §10.2「ACK=sequenced apply+dirty」语义。

### §7.1 SA2 R1 建议的守卫测试锚定（R2 新增；SA4/SA7 参考输入与设计条款对照）

SA2 评审「红线测试思路」5 条，逐条锚定到设计条款（SA6/SA4 落地时按此对照，防止实现漂移）：

| SA2 思路 | 场景 | 锚定设计条款 | 红/绿预期 |
|---|---|---|---|
| #1 drain 期 fatal 计面回归 | boot（fake scheduler）→ `hub.close()` 窗口开启（`pending()` 基线含 drainDeadline）→ `injectPeer` 错序帧（`sequence: nextPeerSeq()+2`，复用 review-revisions R3-3 触发面）→ SEQUENCE_VIOLATION fatal → 断言 `pending()` 回落（drainDeadline 已清）+ `closePromise` 正常结算 | §4.6 路径 3（connectionFatal 加 `clearDrainHandles()`）+ cleanupAll finally 释放 drainDone | R1 设计实现下计面断言红（timer 残留）→ 修后绿；结算面恒绿 |
| #2 CONNECTION_BACKPRESSURE fatal 计面 | 极限 `controlReserveBytes` + 高水位注入 → 窗口内 OPEN 拒绝帧触发额度耗尽 → 1011 后 `pending()` 无 drain 残留 | §4.2-D1 边界注记 + §4.6 路径 3 | 可选（依赖背压注入 seam） |
| #3 shutdownWithGoaway 重入不泄漏 | 窗口内再次调用 → 首个 `hub.close()` Promise 仍正常结算 | §4.1 双门（R2-M6）——重入直接早退，drainTail/drainDone 零覆盖 | 无防御下首 Promise 悬挂 → 红；双门下绿 |
| #4 既有红灯回归守卫 | R1–R4 全绿 + 175 基线全绿 + afterAll 无 +5s 退出尾巴 | §6.1 四消费点 + §6.2.1 回归守卫行 | 全绿 |
| #5 notifySettled 幂等观测（可选） | opening 期先 fatal 终态化，再 authorize 迟归失败（finishOpenError）→ 断言 ERROR 帧恰 1 条、`close(1001)` 恰一次 | §4.3 记忆位 + R2-M5 尾部无条件调用指令 | 无双发帧 |

---

## §8. 伪代码总览（实现骨架）

```ts
// ═══ hub-connection.ts ═══
class HubConnectionImpl implements HubConnection {
  private drainActive = false;
  private drainDeadline: unknown | undefined;
  private drainDone: (() => void) | undefined;
  private drainTail: Promise<void> | undefined;

  shutdownWithGoaway(drainMs) { /* §4.1：双门（closedFlag||drainActive）+ 窗口武装 */ }
  private maybeFinishDrainEarly() { /* §4.3 */ }
  private finishDrain() { /* §4.4：clearDrainHandles + close(1001,'hub-shutdown') */ }
  private clearDrainHandles() { /* §4.6-R2 单点：drainActive=false + clearTimeout(drainDeadline) */ }
  settle() { return this.drainTail ?? this.settleTail; }        // §4.5
  close(code?, reason?) { /* §4.6 路径1：state='closed' + clearDrainHandles，其余原样 */ }
  private dispatchReady(msg, seq) { /* §4.2 前置门 + 既有 switch */ }
  private onTransportClosed() { /* §4.6 路径2：clearDrainHandles + 既有体 */ }
  private connectionFatal(code, ws) { /* §4.6 路径3：clearDrainHandles（R2-M1 新增）+ 既有体 */ }
  private onSequenceExhausted(t) { /* §4.6 路径4：clearDrainHandles（R2-M1 新增）+ 既有体 */ }
  private async cleanupAll() { /* §4.6 四路径共同收口：try/finally 释放 drainDone */ }
  // channelHost 构造段：onChannelSettled: () => this.maybeFinishDrainEarly(),
}
// HubReplicationImpl.close() —— 零改动（§4.5）

// ═══ hub-namespace.ts ═══
export interface HubChannelHost { /* …既有… */ onChannelSettled(namespaceId: string): void; }
export class HubNamespaceChannel {
  private settledNotified = false;
  private notifySettled() {
    if (this.settledNotified) return;
    this.settledNotified = true;
    this.host.onChannelSettled(this.namespaceId);
  }
  // 三个通知入口（R2-M5：各入口【函数尾部无条件】调用，不依附 setState 分支）：
  //   finalize() / onCloseRequest closeQueue 尾部 / finishOpenError 尾部
  // 第四个终态 setState 点（onConnectionClosed :598）免通知——理由见 §4.3（调用图推导）
}
```

---

## SA2 反馈逐条回应

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| MAJOR #1：drain 句柄清理矩阵漏 `connectionFatal()`/`onSequenceExhausted()` 两路径；要求 §4.6 扩四路径 + `clearDrainHandles()` 单点；§6.3「双点清」更正 | ✅ | §4.6（重写为「drain 互锁四路径」+ 单点 helper 伪代码 + 四路径指令表 + 残留危害三联论证）、§4.4（finishDrain 改调 `clearDrainHandles()`）、§8（伪代码骨架同步）、§6.3（「双点清」→「四路径……单点清理」）、§7.1（SA2 思路 #1/#2 计面守卫锚定） | `connectionFatal`/`onSequenceExhausted` 同步段加 `clearDrainHandles()`；并明确路径 3/4 的 drainDone 结算不依赖句柄清理（都经 cleanupAll finally）——纪律/计面/GC 修正与结算链解耦 |
| MAJOR #2：§4.3「且仅这三个——终态只能从这里进入」与源码不符（`onConnectionClosed :598` 是第 4 个终态 setState 点）；要求列出全部 4 处 + 第 4 处免通知的真实理由 | ✅ | §4.3（终态 `setState` 点全量枚举 4 处；第 4 处免通知理由 = 调用图推导：onConnectionClosed 只被 cleanupAll 调用、其全部调用方先置 closedFlag → drain 必已终结；「终态只能从这里进入」表述删除；新增防御纵深声明——maybeFinishDrainEarly 的 closedFlag 检查非冗余、不得删） | 枚举完备性论证前提更正为「由调用图推导」；结论（通知只需 3 处）不变但依据修正 |
| MAJOR #3：§6.1「全量 3 处」漏 sa7-r1 afterAll（:312 race 3s）；要求补登 + 残余边界说明；§11 比对基准同步 | ✅ | §6.1（标题改「4 处」+ grep 方法与结果 + sa7-r1 afterAll 补登行：peer.stop 先行 → 快速结算 + 残余边界「peer.stop 超 3s → drain timer 残留 → 退出尾部 +drainMs，归 SA7」）、§11（caller 表新增消费方④ + grep 证据更新 + 风险评估「3 个」→「4 个」） | 文档补登，SA3 零代码改动 |
| MINOR #4：§4.7 peer 副作用审计引用不可达路径（生产时序 GOAWAY 先到 → blocked 门丢弃） | ✅ | §4.7 副作用审计（改述为两面：① R3 测试面——injectPeer 绕过 peer 状态机、锚在 hub 出站帧面；② 生产等价性——peer-connection.ts:255 非 ready 状态门丢弃、结果等价、拒绝帧价值保留于 GOAWAY 丢失/乱序异常时序） | 删除「peer 有 target → onErrorFrame → 终态 closed」不可达引用 |
| MINOR #5：notifySettled 调用点含糊（finishOpenError 守卫分支歧义）；要求确定指令 | ✅ | §4.3「调用指令（R2-M5）」段 + §8 注释 | 钉死「每个入口的**函数尾部无条件**调用，不依附 setState 分支」；finishOpenError 守卫跳过分支同样走到尾部（记忆位吸收）；消除 SA4 比对噪音 |
| MINOR #6：shutdownWithGoaway 首行仅 closedFlag 门，重入覆盖 drainTail/drainDone → 旧 close Promise 悬挂 | ✅ | §4.1（首行改 `if (this.closedFlag \|\| this.drainActive) return;` + 覆盖危害注释：旧 drainTail 永不 resolve = hub.close() 挂起泄漏；无现实重入路径声明：唯一调用点受 closed 门 + 幂等保护） | 一行防御 |
| NOTE #7（D1 背压边界）：已自申报、SA2 复核接受，无需修订 | ✅（记录在案） | §4.2-D1 边界注记（R1 已有，R2 保持）；§4.6 路径 3 触发场景表把 CONNECTION_BACKPRESSURE 列入 fatal 面（句柄清理因此覆盖该边界） | 无改动 |
| NOTE #8（R2 的 peer 自然收口现实语义）：建议 D6 注记 in-flight 来源 | ✅ | §4.2-D6「现实来源注记」 | blocked peer 不发 CLOSE；窗口内 CLOSE 的现实来源 = GOAWAY 送达前在途帧；hub 义务 = wire 层防御契约 |
| NOTE #9（Host 停机上界 = ADR 决定，范围外） | ✅（记录在案） | §5（两等待域表 + 推论）、§12-1（如实申报） | 无改动；未来硬上界走 ADR 演进 |
| AC-6 适配所有权（总控指令：explicitly address） | ✅ | §6.2.1（新增所有权协议表：改什么/谁改=SA6 独占/何时改=与 SA3 同轮且先于 SA4 门禁/谁裁决=总控/为何不能反向/回归守卫） | SA3 的实现 PR 不含该文件；时序错位会产生假回归污染 175 基线判定 |

---

## §9. 文件清单（File Scope）

### ALLOW LIST

- `packages/ws-replication/src/hub-connection.ts` — 修改，§4.1/§4.2/§4.4/§4.5/§4.6 全部（drain 4 字段 + shutdownWithGoaway 重构（双门）+ dispatchReady 前置门 + finishDrain/maybeFinishDrainEarly/**clearDrainHandles 单点** + settle/close/onTransportClosed/**connectionFatal/onSequenceExhausted** 四路径互锁 + cleanupAll finally；估算 +95/−25 行）
- `packages/ws-replication/src/hub-namespace.ts` — 修改，§4.3 通知面（`HubChannelHost.onChannelSettled` + `settledNotified`/`notifySettled` + 三个通知入口的函数尾部调用点；估算 +18/−0 行）
- `packages/ws-replication/test/ws-replication-issue174-goaway-drain-red.test.ts` — `[SA6 owned]` 本任务红灯契约（SA6 已写就并验证 4-red 确定、175 基线绿）。SA3 **零改动**；如实现与断言出现歧义，回到 SA6 裁决，不得改断言逻辑。
- `packages/ws-replication/test/ws-replication-auth-lifecycle-red.test.ts` — `[SA6 owned]` AC-6 一处 **2 行插入**适配新窗口契约（§6.2 五步证明 + §6.2.1 所有权协议：`await closePromise` 前插入 `run.hubNode.scheduler.advanceBy(CONTRACT_TIMEOUTS.closeTimeoutMs);` 与 `await settle();`）。既有断言语义零变化。**SA6 独占落实，SA3 的实现 PR 不含此文件**；须与 SA3 实现同轮、先于 SA4 全量验证门禁。

### DENY LIST

- `packages/ws-replication/src/peer-connection.ts`、`packages/ws-replication/src/peer-namespace.ts` — peer 侧 drain 语义完整（SA5 §peer 对照；onGoaway/draining/blocked/deadline close 已实现），本任务零改动。
- `packages/ws-replication/src/{backpressure,frame-io,round-engine,update-channel,liveness,error-mapping,fence-watchdog,defaults,validate,types,index,testing}.ts` — 窗口门在连接分发层单点收口；round 拒绝经「不调用」实现而非改 RoundEngine；零新配置 knob（drain 时长复用 closeTimeoutMs）；公共类型零变化。
- `packages/replication-protocol/**` — 零新 wire 码、零 codec 变化（§4.7 用既有码）。
- `docs/protocols/instance-replication-v1.md`、`docs/adr/**` — wire contract 与 ADR 不改；本设计是对既有条文的实施修复（SA8 冲突门禁 verdict clear）。
- `packages/namespace-registry/**`、`packages/persistence/**` — Runtime/Registry/Persistence 零改动（§5 两域边界靠既有机制）。
- `apps/**` — 组合根零改动（HubReplication.close() 签名与结构不变）。

---

## §10. 协议假设依据 (Protocol Assumption Evidence)

| # | 假设 | 依据类型 | 依据内容（具体引用） | 风险 |
|---|---|---|---|---|
| P1 | peer 收 `GOAWAY(SERVER_SHUTTING_DOWN)` 即时 `blocked`、其后零出站帧、wire 保持开放 | 源码 | `peer-connection.ts:398-416`（onGoaway → SHUTTING_DOWN/REAUTH → `enterBlocked()`）；`peer-connection.ts:404-408` 注释「保持 wire 开放供宿主决定最终关闭时机」；`peer-namespace.ts:640-652`（onConnectionFatal 纯本地静默收口，零 wire 帧）。R1 的 `connectionState()==='blocked'` 断言在当前实现已绿（SA6 红灯验证：4 失败全部在窗口断言） | 低 |
| P2 | 测试时间面：hub 侧 timer 仅在 `advanceBy` 触发，真实时间无效 | 源码 | `packages/namespace-registry/src/testing.ts:74-109`（纯 map 队列 fake；`advanceBy` 按到期序逐个触发；零 native timer）；`driver.ts` boot 将 `timer: hubNode.scheduler` 注入 hub | 低 |
| P3 | 控制帧同步上 wire：GOAWAY/CLOSE_OK 字节先于同栈后续 `transport.close` 可被对端观测 | 源码 + 现有测试 | `frame-io.ts:117-131`（`sendControl` 入队即 `drain()` 同步 `emitOne`）；`harness.ts:571-599`（makeEnd：send 与 close 均 `queueMicrotask` 投递，FIFO）；既有 D4 锚 `ws-replication-sa7-r1-transport-auth.test.ts:506-510` 已在真实 TCP 上验证「GOAWAY 帧先于 close 事件」 | 低 |
| P4 | `CLOSE_OK.ackedSequence` = CLOSE_NAMESPACE 帧序 | 协议 + 源码 | 协议 §13 `CLOSE_OK` 表（ackedSequence = CLOSE_NAMESPACE sequence）；`hub-namespace.ts:538-559` 既有 `onCloseRequest` 以 `message.sequence` 回执（R2 复用，零改动） | 低 |
| P5 | vitest 无 fake timers / 无 setupFiles / 默认 testTimeout——AC-6 挂起分析的前提 | 配置 | 仓库根 `vitest.config.ts`（仅 include/typecheck/passWithNoTests，无 testTimeout、setupFiles、fakeTimers 配置）；包内无 vitest.config | 中（若未来加全局 fake-timer 自动推进配置则 §6.2 证明需复核——当前不存在） |
| P6 | AC-6 与 R1 的输入语义等价（§6.2 证明第 1 步） | 设计期验证（静态源码推导） | defaults.ts:33-42 + resolveTimeouts 合并语义（:56-61）+ 两用例 boot 调用点（red test L64 / auth-lifecycle L384）+ driver boot 透传链（driver.ts:472-507）。注：设计期未运行任何测试（SA1 硬门禁禁跑测试），推导全部基于源码字面 | 中（已申请 SA6 在适配 AC-6 时顺带实证：当前实现下两用例除 timeouts 传参外无行为差） |
| P7 | handshaking 连接收 GOAWAY 是协议伤害 → 保留直接 close(1001) 分支 | 源码 + 简报 | `hub-connection.ts:320-323` 既有论证（peer handshaking 门对非 HELLO_ACK 帧 CONNECTION_POLICY_VIOLATION）；简报明令「必须保留（SA5 论证为正确）」 | 低 |

无其他协议级假设：本设计不新增端点/端口/跨进程生命周期假设；timer 全部经既有注入 seam。

---

## §11. 契约改动连锁审计 (Contract Change Caller Audit)

### 改动函数/面

| 函数/面 | 文件 | 改动前契约 | 改动后契约 |
|---|---|---|---|
| `shutdownWithGoaway(drainMs)` | `packages/ws-replication/src/hub-connection.ts:324` | 同步完成 GOAWAY+close(1001)，调用返回即收口 | 签名不变；发起异步 drain 窗口，收口延后至 deadline/提前完成/对端关（handshaking 分支行为不变） |
| `settle()`（内部） | `hub-connection.ts:350` | 返回当前 `settleTail`（close 后快速结算） | drain 期返回 `drainTail`（窗口末结算）；非 drain 路径不变 |
| `close(code?, reason?)`（公共） | `hub-connection.ts:308` | 同步 quiesce + transport close + cleanup；state→`'draining'` | 同步语义不变；新增 drain 句柄清理/复位；state→`'closed'`（FSM 对齐） |
| `HubConnection.state`（公共只读） | `hub-connection.ts:236` / `types.ts:128` | 类型与取值集不变；`draining` 实际零驻留 | 类型不变；`draining` 真实驻留一个窗口期；close 后值为 `'closed'`（原 `'draining'`） |
| `HubChannelHost`（包内接口） | `hub-namespace.ts:44` | 13 个成员 | +1 `onChannelSettled(namespaceId)`（非公共导出契约——经 `index.ts` 出口的类型面零变化） |
| `connectionFatal(code, wsCloseCode)`（私有，R2-M1 新列入改动面） | `hub-connection.ts:555` | 直接收口（teardown → ERROR 直发 → closedFlag → transport close → cleanupAll），无 drain 概念 | 行为不变；同步段新增 `clearDrainHandles()`（drain 期 fatal 不残留 timer 句柄） |
| `onSequenceExhausted(transport)`（私有，R2-M1 新列入改动面） | `hub-connection.ts:607` | 直接收口（teardown → close(1008) → closedFlag → cleanupAll），无 drain 概念 | 行为不变；同步段新增 `clearDrainHandles()`（同上） |
| `dispatchReady` / `maybeFinishDrainEarly` / `finishDrain` / `clearDrainHandles` / `cleanupAll` | `hub-connection.ts` | 私有 | 私有（新增 3 个私有方法 + 4 个私有字段） |

**公共 API（`HubReplication`/`HubConnection`/`DuplexTransport`/默认常量）签名零变化**——`ws-replication-api.test-d.ts` 契约测试不受影响。

### Caller 清单

| Caller | 文件:行号 | 是否 await | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---|---|---|---|---|
| `HubReplicationImpl.close()` → `shutdownWithGoaway` | `hub-connection.ts:221`（grep 全仓唯一调用点） | 否（同步 void 调用） | 无需（方法不抛——GOAWAY 发送已内包 try/catch） | N/A | 唯一 caller；调用后同栈 `map(c => c.settle())` 取到 pending `drainTail`（§4.5 调用序保证） |
| `HubReplicationImpl.close()` → `settle` | `hub-connection.ts:224`（唯一） | 是（Promise.all 聚合进 closeTail） | closeTail 消费方均 await | `close()` 幂等返回同一 closeTail | 结算时点变化的影响面 = 下三行 |
| ↓ closeTail 消费方① D4 | `ws-replication-sa7-r1-transport-auth.test.ts:503`（`await hub.close()`，realTimer） | 是 | N/A（测试） | it 90s timeout | 阻塞至真实 5s 窗口末——预算内，断言全部兼容（§6.1） |
| ↓ closeTail 消费方② sa7-r1 afterAll（R2-M3 补登） | `ws-replication-sa7-r1-transport-auth.test.ts:312`（`Promise.race([hub.close(), 3s])`，realTimer） | 是（race 兜底） | race 显式兜底 | 有 | 正常路径：先 peer.stop() → 连接已 closedFlag → 立即结算；残余边界（peer.stop 超 3s）→ drain timer 残留 → 进程退出尾部 +drainMs（§6.1 补登行，无断言失败，活链路观测归 SA7） |
| ↓ closeTail 消费方③ r2-transport afterAll | `ws-replication-sa7-r2-transport.test.ts:363`（settleClose 3s race） | 是（race 兜底） | settleClose 显式 race | 有 | destroy 先行 → 连接已 closedFlag → 立即结算（§6.1） |
| ↓ closeTail 消费方④ AC-6 | `ws-replication-auth-lifecycle-red.test.ts:393`（`await closePromise`，fake scheduler） | 是 | N/A（测试） | vitest testTimeout | ⚠️ 冻结时间下不可结算——§6.2 证明 + SA6 2 行适配（所有权协议 §6.2.1，ALLOW LIST 已登记） |
| `close()` 公共调用方·测试 R3-1 | `ws-replication-review-revisions-r1-r7-red.test.ts:536` | 否（同步断言） | N/A | N/A | 直接 close 不经 drain；同步 quiesce 保留 → 锚不变 |
| `close()` 公共调用方·测试 R3-2 | `ws-replication-review-revisions-r1-r7-red.test.ts:550` | 否（同步断言） | N/A | N/A | 同上 |
| `close()` 内部调用·shutdownWithGoaway handshaking 分支 / finishDrain | `hub-connection.ts:327`（既有）、§4.4（新增） | 否 | close 自身 void cleanupAll（既有） | cleanupAll finally 释放 drainDone | 收口幂等（closedFlag 门） |
| `HubConnection.state` 观察方·issue137-r2 | `ws-replication-issue137-r2-red.test.ts:265`（断言 `'closed'`） | — | — | — | onSequenceExhausted 路径直接置 `'closed'`——不受 close() state 改值影响 |
| `HubConnection.state` 观察方·review-revisions R3-3 | `ws-replication-review-revisions-r1-r7-red.test.ts:576-579`（轮询至 `'closed'`） | — | — | — | connectionFatal 路径直接置 `'closed'`——不变 |
| `HubChannelHost` 实现方 | `hub-connection.ts:277-291`（唯一实现） | — | — | — | 构造段追加 `onChannelSettled` 绑定 |
| `HubChannelHost` 消费方 | `hub-namespace.ts`（唯一：`this.host.*` 调用点） | — | — | — | 仅 `notifySettled()` 在 **3 个通知入口**的函数尾部调用（§4.3：终态 `setState` 点共 4 处，第 4 处 `onConnectionClosed:598` 免通知——调用图推导，非枚举遗漏） |
| `revoke()` → `terminateUnauthorized`（窗口期交叠） | `hub-connection.ts:204-211` / `hub-namespace.ts:585-590` | 是 | 既有链 | 既有 | 窗口期 revoke：channel 终态化 → 经 §4.3 计入提前完成——协议正确（无剩余可收口对象），非缺陷；revoke 自身结算走 cleanupTail 不受 drainTail 影响 |

抓全方法（SA4 比对基准，R2-M3 更新）：`git grep -n "shutdownWithGoaway\|\.settle()" -- 'packages/**/*.ts' 'apps/**/*.ts'` → 生产调用点各 1 处（hub-connection.ts:221/:224）；`grep -rn "hub\.close()" packages/ws-replication/test/` → **4 处**（sa7-r1:312 / r2-transport:363 / auth-lifecycle:385+393 / sa7-r1:503——R1 初版漏 sa7-r1:312，R2 补登，与 SA2 复核结果一致）；`git grep -n "connections\[.\]\.close\|conn\.close" -- 'packages/*/test/*.ts'` → 2 处（review-revisions:536/:550）；`apps/**` 对 `HubConnection` 零引用（grep 空）。

### 风险评估

- **遗漏 caller 的代价**：closeTail 结算时点变化若漏审某个 await 方 → 测试挂起/超时（非生产崩溃——生产 Host `await hub.close()` 在真实 timer 下最多多等 closeTimeoutMs）。上表已穷尽 grep 证据的 **4 个**测试消费方 + 0 个生产消费方（R2-M3 更正：R1 初版误计 3 个）。
- **drain 句柄残留的代价（R2-M1 新增）**：四路径任一漏加 `clearDrainHandles()` → fake scheduler `pending()` 计面污染 +1 至 advanceBy 越过 deadline（未来 drain 期 fatal + pending() 断言组合必踩，SA2 红线思路 #1/#2 即此守卫）；行为安全（fire 回调 closedFlag 早退）但违 §8 纪律。
- **state 改值风险**：close 路径 post-close state 从 `'draining'` → `'closed'`——全仓 grep 无任何测试断言该值（§ Caller 清单两观察方均断言 fatal/exhaustion 路径的 `'closed'`，本就如此）。

---

## §12. 业务影响评估

1. **Host 停机时长**：`hub.close()` 从「立即」变为最多 `closeTimeoutMs`（缺省 5s）+ apply 排空尾长。这是 ADR-0010 L179 停止顺序的正确实施代价——此前 Registry shutdown 与复制收口实际存在竞态（close Promise 不跨窗口，Host 过早进入后续停机步）。生产可经既有 `timeouts.closeTimeoutMs` 调节，零新配置面。
2. **peer 侧收益**：GOAWAY 宣告的窗口首次真实可用——在途 UPDATE 的 ACK 语义、CLOSE_NAMESPACE 收口握手在窗口内可完成；此前 peer 收到的是「零长度窗口 + 立即 1001」。
3. **数据一致性**：已接纳 apply 槽无条件排空（不取消、无内部超时）——崩溃窗口不因本修复扩大；网络侧不无限等待（deadline 硬顶）。重连 reconcile 修复一切残余（协议恢复纪律）。
4. **零 wire/契约/配置破坏**：无新错误码、无格式变化、公共 API 签名不变、默认值不变。
5. **观测面**：hub 连接 `state` 的 `draining` 首次成为真实可观测阶段（§15.2 FSM 实施完整性）。

## §13. 防虚假降级自检

- GOAWAY 发送失败 catch → `finishDrain()`：**真降级路径**（framing 不可信 = 外部故障域），处置是响亮收口（close 1001），非静默回退值。✓
- `SYNC_STEP1` 窗口内丢弃：非 null-guard 降级——是「义务方在 peer、hub 以不推进履约」的协议决策（§4.2-D2 四点论证），且不可用 fatal 码（会破坏 R3 窗口保持红线）。✓
- `onChannelSettled` 非 drain 期 no-op：事件面常驻、消费者按态过滤，非「条件不满足就吞错」。✓
- 本设计不引入任何 `if (!x) return fallback` 形态的静默降级。✓

## §14. 一致性自检记录（R2 修订后全文扫描）

- 「不 quiesce channel at GOAWAY」：§4.1 无 quiesce 调用；§4.2-D6/R2、§7-R4 依赖此点——全文无矛盾（旧实现的 quiesce 在 close() 内，仅窗口终结时执行——§4.4/§4.6）。
- 「deadline=drainMs=closeTimeoutMs 同源」：§4.1② 与 §1-5、§7-R1、§12-1 一致。
- 「apply 槽无 deadline」：§5、§7-R4、§12-3 一致（cleanupAll 的 drainPendingApplies 不受 drainDeadline 影响）。
- 「AC-6 冲突」：§1 摘要、§6.1、§6.2、§6.2.1、§10-P6、§11 caller 表④ 六处表述一致（需 SA6 2 行适配，非 SA3 实现缺陷；所有权/时序/裁决链见 §6.2.1）。
- 「drain 句柄清理 = 四路径」（R2 新增）：§4.4（finishDrain 调 clearDrainHandles）、§4.6（四路径表 + 单点伪代码）、§8（骨架）、§6.3（sa7-dynamic 行）、§7.1（守卫 #1/#2）、§11 风险评估——全文无「双点清」残留。
- 「终态 setState 4 处 / 通知 3 处」（R2 新增）：§4.3（枚举 + 免通知理由 + 调用指令）、§8（注释「第四个终态 setState 点免通知」）、SA2 回应表 MAJOR #2 行——无「终态只能从这里进入」残留。
- 「hub.close() 测试域消费点 4 处」（R2 新增）：§6.1（标题 + 表 4 行）、§11（caller 表①-④ + grep 证据 + 风险评估「4 个」）——无「全量 3 处」残留。
- 「shutdownWithGoaway 双门」：§4.1、§8、§7.1 守卫 #3——一致。
