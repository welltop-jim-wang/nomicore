# Design — issue #168：ws-replication peer 侧 HELLO 超时同步关闭旧 transport（孤儿传输竞速窗口收口）

- **任务类型**：Bug 修复（Low、有界——hub 侧同值 HELLO_TIMEOUT 兜底存在，但违反 wire contract §18 显式条款）
- **基线**：worktree `ffca4f6`（= PR #185；SA8 前置门禁确认本 worktree 已含 `packages/ws-replication` 本体与 D5 锚测试）
- **设计产出**：本文档（SA1 R0 初版）
- **权威依据**：`docs/protocols/instance-replication-v1.md` §18（wire contract，经 ADR-0010 正文纳入基准）；ADR-0010 修订节「issue #161 round 2 修订」登记的 peer pong 超时 detach-close 序列

---

## §0. 结论摘要（一段话版本）

`peer-connection.ts` 的传输关闭在本代码库中是**路径特定**的：pong 超时在自己的回调里自关（`onPongTimeout`，:421-432），远端关闭路径传输已死，dial-throw 无传输可关——唯独 **hello 超时入口（`armHello` :908-914）只调 `onTemporaryFailure('hello-timeout')` 进 backoff，没有对应的自关代码**，旧 transport 无人关闭成为孤儿，直到 hub 侧同值 HELLO_TIMEOUT（缺省 10s）兜底。修复：把 pong-timeout 的 §18 R4 detach-close 序列提取为私有 guarded helper `detachCloseTimedOutTransport(transport, reason)`（停 liveness → 退订 → epoch 失效 → close(1001)），hello 超时回调在进入 backoff 前以同构守卫（stopping / 状态 / 传输身份+代际双凭据）调用它；pong-timeout 调用点改为同一 helper（行为字节等价的机械提取）。dial-throw 与 onClose 两个冻结入口零改动；hub 侧零改动（兜底面保留为纵深防御）。

---

## §1. 上下文与证据基础

### 1.1 已读输入

| 输入 | 关键内容 |
|---|---|
| 任务简报 `wiki/raw/task_ws-replication-close-peer-transport-synchronously.md` | 需求原文 + SA6 Phase 1 红灯契约（T1 红核心 / T2 T3 冻结面）+ 红灯验证证据（T1×/D5× 于 `ffca4f6` 稳定复现，tsc 零错误） |
| SA8 前置决议 `_relevant_decisions.md` | ADR-0010 唯一管辖本域；§18 R4 次序纪律「epoch 必须在调用可能同步重入的 transport close() 前失效」；§15.1 状态机迁移不得改变；backoff reason 词表已含 `hello-timeout` |
| SA5 分析 `wiki/raw/20260830-bug-ws-replication-close-peer-transport-synchronously.md` | 根因定位 + 冻结面划定 + fix direction (a)–(e)（供 SA1 参考） |
| 红灯测试 `test/ws-replication-issue168-hello-timeout-close-peer-red.test.ts`（SA6 已写） | T1/T2/T3 行为锚点（详见 §5 与 §7） |
| 翻转锚 `test/ws-replication-sa7-round2-dynamic.test.ts:758-822`（SA6 已改） | D5 从「登记观察」翻转为修复契约 |
| 源码 `src/peer-connection.ts`（962 行全文） | 连接 FSM、dialNow/onHelloAck/onClose/onTemporaryFailure/armHello、pong-timeout detach-close 序列 |
| 源码 `src/hub-connection.ts`（:372-376、:761-792） | hub 侧 HELLO_TIMEOUT 兜底与 onTransportClosed 收口链 |
| 源码 `src/liveness.ts`、`src/types.ts`、`src/defaults.ts`、`src/validate.ts` | liveness 自停语义、backoff reason 词表、helloTimeoutMs 缺省 10s / 正整数校验 |

### 1.2 缺陷复现路径（静态闭环）

```
peer.start() → dialNow() :276
  ├─ epoch+1 → setState('connecting') → dial() 成功 → this.transport = wire1 :295
  ├─ 直发 HELLO :323-331 → setState('handshaking') :332 → armHello() :333
  │     helloHandle = setTimeout(() => {
  │       if (state === 'handshaking') this.onTemporaryFailure('hello-timeout');  // ← 断点
  │     }, helloTimeoutMs)
  └─ 订阅 transport onMessage/onClose（epoch 门闭包）:334-337

helloTimeoutMs 到点 → onTemporaryFailure('hello-timeout') :845
  ├─ stopLivenessNow / unsubscribeTransport / epoch+1 / sender.teardown   ✅ 代际收口齐全
  ├─ setState('backoff') → backoff timer → dialNow()（wire2 新代）
  └─ ❌ 零 close(this.transport)——:849-851 注释明示「不关传输（I5）……hello 超时孤儿
       传输窗口是 D5 登记处置项，本任务不动」（PR #185 固化的 scoped-out 决议）

孤儿窗口：wire1 peer 半边开着（监听已退订，不读不写）；hub 半边等 HELLO 直到自身
helloTimeoutMs 到点 connectionFatal('HELLO_TIMEOUT', 1002)（hub-connection.ts:372-376）。
```

红灯验证（SA6，2026-08-30，`ffca4f6`）：T1 失败于 `peerSideClosed: expected false to be true`（:296 先于 :299 的序列签名断言触发）；D5 失败于同面（:802）。**缺陷真实且锚点唯一指向 `armHello`。**

---

## §2. 根因推演（最深层原因，非表象）

**表象**：hello 超时后旧 transport 的 peer 半边滞留开放。

**深层原因**：`onTemporaryFailure`（:845-872）被设计为**只做代际收口不做传输关闭**——「关闭是路径特定的」（注释 :848-851 的 I5 决策）。这个设计本身是对的：六条调用路径里五条的关闭责任各有归属——

| 调用路径 | 位置 | 传输关闭责任 | 状态 |
|---|---|---|---|
| `dial-failed`（dial 抛错） | :292 | 无——`this.transport` 尚未赋值（dial 在赋值前 throw） | ✅ 正确 |
| `pong-timeout` | :431 | 回调内自关 `close(1001,'pong-timeout')`（:421-432 detach-close 序列） | ✅ 正确 |
| `socket-closed`（onClose 入口） | :736 | 无——传输已死（close 事件就是它触发的） | ✅ 正确 |
| `goaway-closed` | :745 | 无——传输已死（drain deadline close 后的 close 事件） | ✅ 正确 |
| `connection-backpressure` | :817 | `failConnectionBackpressure` 内自关 `close(1011)`（:812-814） | ✅ 正确 |
| **`hello-timeout`** | **:912** | **无任何归属——armHello 回调里没有自关代码** | ❌ **缺陷** |

即：路径特定关闭的责任矩阵有一条空缺。PR #165 round 2（`ef19bae`）在 SA7 D5 显式 scoped-out，PR #185（`ffca4f6`）重构 pong/ping epoch-safe 时保持该行为并注释「本任务不动」。**这不是回归，是显式推迟的已知缺陷**；issue #168 是跟踪票，本设计将其收口。它违反 wire contract §18 :526 的显式条款「**HELLO/pong timeout关闭连接**」——pong 超时已对齐（§18 R4 序列 + ADR-0010 round 2 修订登记），hello 超时未对齐。

---

## §3. 设计目标与约束

### 3.1 目标

1. **G1（红核心）**：peer 侧 hello 超时，在进入 backoff 的同一同步栈内关闭旧 transport——`wire1.peerSideClosed === true` 在 `getConnectionState() === 'backoff'` 可观测时必然已成立（T1 :291-296 的时序）。
2. **G2（序列签名）**：close 事件以 `{ code: 1001, reason: 'hello-timeout' }` 到达 hub 侧（established detach-close 序列签名，pong-timeout 同构；T1 :299-302）。
3. **G3（幂等/并发）**：迟到并发步零扰动——in-flight HELLO_ACK 落旧 wire 零副作用；迟到的旧代 timer 不得作用新代传输；恰好一次 `connection-backoff-scheduled`、零 `connection-failed`。
4. **G4（恢复）**：backoff → 重拨 → ready → live → `hub.connections` 收口至 1 全链保持。
5. **G5（冻结面）**：dial-throw 入口（`backoff(dial-failed)`，关闭动作不外溢到无 transport 入口）与 onClose 入口（`backoff(socket-closed)`，迟到 hello 定时器零副作用）行为字节不变（T2/T3 当前绿 → 实现后必须仍绿）。
6. **G6（架构一致性）**：不改变 §15.1 状态机迁移、观测面词表、hub 侧任何行为；hub HELLO_TIMEOUT 兜底保留（对硬崩溃 peer 的纵深防御）。

### 3.2 非目标（显式排除）

- 不改 hub 侧任何文件（兜底面本就正确：state 守卫 `if (this.state === 'handshaking')` 使迟到 fire 为幂等 no-op，hub-connection.ts:372-376）。
- 不改 `onTemporaryFailure` 的契约（它继续只做代际收口——关闭责任在调用方，本设计把 hello 路径补进责任矩阵）。
- 不发明新观测词、新 close code、新 wire 帧（§13.1 注册表不扩；peer 本地超时是无 wire 帧的内部路径）。
- 不动 docs/protocols / docs/adr——修复是**对齐** §18 既有条款，不是改条款。

---

## §4. 修复设计

### 4.0 方案选型（两案对比，选 B）

| | 方案 A：armHello 内联序列 | **方案 B：共享 guarded helper（选定）** |
|---|---|---|
| 做法 | 在 armHello 回调里手写 4 步收口栈 | 提取 `detachCloseTimedOutTransport`，pong/hello 两个调用点共用 |
| 改动面 | 仅 armHello（~10 行） | 新 helper + 2 调用点重构 + armHello 签名（~35 行） |
| 一致性 | §18 R4 次序纪律（epoch 先于可重入 close 失效）在两处靠复制维持——未来漂移风险 | 次序纪律单点结构化强制，pong/hello 永远同构 |
| 风险 | 零（不碰 pong 路径） | pong 路径纯机械提取（行为字节等价），且 pong 路径有 6 个绿测试文件覆盖（§7.2）——回归即被抓 |

任务简报明示「via the established pong-timeout detach-close sequence (**or an equivalent guarded helper**)」，SA5 fix direction 亦明示「或与 pong-timeout 共用的 guarded detach-close helper」——方案 B 是被显式预期的形态。§18 把 HELLO/pong timeout 的关闭纪律定义为**同一条款**；用一个 helper 承载这条纪律比两处复制更防弹。选定**方案 B**。

### 4.1 新增私有 helper：`detachCloseTimedOutTransport`

位置：`peer-connection.ts`，放在 `stopLivenessNow`/`unsubscribeTransport`（:601-609）附近的 helper 区。

```ts
/**
 * §18 R4 detach-close 序列（本地超时路径共用：pong-timeout / hello-timeout）：
 * 停旧 liveness → 退订旧 transport 全部监听 → epoch 作废 → close(1001, reason)。
 * epoch 必须先于可能同步重入的 transport close() 失效（§18 次序纪律）；退订先行
 * + 订阅闭包 epoch 门 = 双保险，本地 close 零重入副作用。
 * 身份不变量（this.transport === transport）由调用方守卫保证；此处冗余断言
 * （fail-loud——杜绝未来第三调用点漏写守卫造成「退订错代监听 + 关错传输」，SA2 #2）。
 * close-throw 处置（adapter 违约同步抛错）：epoch 已作废、监听已退订——try/catch
 * 吸收异常以保证调用方后续 onTemporaryFailure 必达（backoff 恢复链不被劫持，SA2 #3）。
 * 幂等：transport 已关时跳过 close，但前三步代际收口照常执行（调用方随后必经
 * onTemporaryFailure 的状态守卫，不会双计）。
 */
private detachCloseTimedOutTransport(
  transport: DuplexTransport,
  reason: 'pong-timeout' | 'hello-timeout',
): void {
  if (this.transport !== transport) {
    throw new Error(
      `detachCloseTimedOutTransport: transport identity mismatch (caller guard violated, reason=${reason})`,
    );
  }
  this.stopLivenessNow();
  this.unsubscribeTransport();
  this.connectionEpochValue += 1;
  if (!transport.closed) {
    try {
      transport.close(1001, reason);
    } catch {
      // adapter.close() 同步抛错（第三方违约）：吞掉以保证 onTemporaryFailure 必达
      // （连接已退订、代际已作废——唯一还差的就是 backoff 恢复链，不能被劫持）
    }
  }
}
```

要点：
- **reason 参数类型收窄为 `'pong-timeout' | 'hello-timeout'`**（不放宽到 `PeerBackoffReason`）——只有本地超时路径合法使用本 helper；close reason 字符串与 backoff reason 词共用既有词（观测词表零新词）。
- **close code 固定 1001**（裁决论证见 §6）。
- **身份断言（SA2 #2 落实）**：helper 头部 loud 前置校验 `this.transport !== transport` → throw。调用点守卫（pong :424 / hello 双凭据）结构性保证不触发；触发即调用方守卫漏写（内部 bug），fail-loud 而非静默跳过（杜绝「退订错代监听 + 关错传输」的代际错配形态），呼应仓库自身纪律（requestRebuild :881-883「杜绝『守卫兜底』成为唯一防线」）。
- **close-throw 吸收（SA2 #3 落实）**：`transport.close()` 契约为 `void`（types.ts :62，不代表永不 throw）。若第三方 adapter 的 close() 同步抛错：epoch 已作废 + 监听已退订 + helloHandle 已清——若异常外播则 `onTemporaryFailure` 不执行，连接永久卡 'handshaking'（无在武定时器、远端 close 因退订不可见、唯一出路是外部 stop()）。try/catch 吸收该异常，保证 backoff 恢复链必达。pong 路径自 issue #170 起同构暴露（sa7-issue170-real-transport 绿面），本设计把该防护统一关进 helper 而非复制。
- **`!transport.closed` 守卫是**合法幂等**而非虚假降级**：timer 回调执行时传输可能已被对端关闭（close 事件尚在微任务队列）——「已关」是真实竞速下的正常态，跳过 close、保留代际收口是正确行为，且后续 `onTemporaryFailure` 的 `backoff/blocked` 状态守卫保证不会产生第二次 backoff。

### 4.2 pong-timeout 调用点重构（行为字节等价）

`onHelloAck` 内的 `onPongTimeout` 回调（:421-432）改为：

```ts
onPongTimeout: () => {
  if (this.stopping) return;
  // 双凭据校验（issue 范围 2）：transport 身份 + 连接代际——旧代定时器零影响。
  if (this.transport !== transport || this.connectionEpochValue !== epoch) return;
  // 同步收口栈（G3，§18 R4）：停旧 liveness → 退订旧 transport 全部监听 → epoch
  // 作废 → 关旧 transport(1001) → 排 backoff。epoch 必须先于可重入的 adapter.close() 失效。
  this.detachCloseTimedOutTransport(transport, 'pong-timeout');
  this.onTemporaryFailure('pong-timeout', true);
},
```

守卫（stopping / 双凭据）留在调用点，序列进 helper——**执行顺序与现状完全一致**（原 :427-430 四步 = helper 四步），纯机械提取。pong 路径行为零变化，由 §7.2 列出的既有绿测试锁定。

### 4.3 hello-timeout 入口修复（本任务核心）

`armHello` 改为接收 dialNow 刚拨出的 transport——不是为了「消除可空读取」（回调本不读 `this.transport`，现状仅状态守卫 + `onTemporaryFailure`），而是为**武装时刻捕获传输身份 + 连接代际双凭据**（pong-timeout 同构；迟到定时器凭据的来源）：

```ts
private armHello(transport: DuplexTransport): void {
  this.clearHello();
  const epoch = this.connectionEpochValue; // 武装时捕获代际（迟到定时器双凭据之一）
  this.helloHandle = this.options.timer.setTimeout(() => {
    this.helloHandle = undefined;
    if (this.stopping) return;
    // 状态守卫（冻结面 T3）：非 handshaking 的迟到 fire 零副作用
    //（clear-on-ack 是第一保险，此为第二保险——SA6 T3 双保险断言面）。
    if (this.connStateValue !== 'handshaking') return;
    // 双凭据守卫（pong-timeout 同构）：迟到的旧代 timer 不得作用新代传输/代际
    //（helloHandle 单槽 + 各收口路径 clearHello 是第一保险，此为纵深）。
    if (this.transport !== transport || this.connectionEpochValue !== epoch) return;
    // issue #168：§18「HELLO/pong timeout关闭连接」——hello 超时与 pong 超时同构，
    // 进入 backoff 前同步执行 established detach-close 序列，收口孤儿传输窗口。
    this.detachCloseTimedOutTransport(transport, 'hello-timeout');
    this.onTemporaryFailure('hello-timeout', true);
  }, this.timeouts.helloTimeoutMs);
}
```

`dialNow` 唯一调用点（:333）同步改为 `this.armHello(transport);`（dialNow 的局部 `transport` 在此处已确定赋值——赋值发生在 try/catch 之后 :295，catch 路径早已 return，类型层面非空）。

**次序论证（为什么 close 在 `onTemporaryFailure` 之前）**：
1. **§18 R4 次序纪律**：epoch 失效必须先于可能同步重入的 `close()`——helper 内部已保证（epoch++ 在 close 前）；`onTemporaryFailure(reason, true)` 在 close 之后调用，其 `epochAlreadyInvalidated=true` 防止重复递增。
2. **T1 时序锚**：`peerSideClosed` 必须在状态变为 `backoff` 的同一同步栈内已翻转（测试在 `settleUntil(backoff)` 后立即断言）——close 先于 `setState('backoff')` 恰好满足。
3. `onTemporaryFailure` 随后重入执行 `stopLivenessNow`/`unsubscribeTransport`（幂等 no-op）。

### 4.4 注释收口（杜绝文档-代码矛盾）

`onTemporaryFailure` 头注释（:848-851）中「不关传输（I5）：……hello 超时孤儿传输窗口是 D5 登记处置项，本任务不动」已失真，替换为：

```
// 同步代际收口（issue #170 验收 2 / I4）：停旧 liveness、退订旧 transport 全部监听、
// 作废连接代际——先于一切 backoff 排程。传输关闭是路径特定的（I5）：
// - 本地超时路径（pong/hello）在各自回调里经 detachCloseTimedOutTransport 自关
//   （可重入 close 前 epoch 已作废，故传 true 防重复递增）；
// - 背压终态在 failConnectionBackpressure 内自关(1011)；
// - 远端关闭（onClose/onGoawayClosed）传输已死；dial-throw 无 transport 可关。
```

### 4.5 hub 侧不变性论证（零改动）

- peer 同步 close(1001) → close 事件（测试 wire 经微任务；真实 WS 经事件循环）→ hub 的 transport onClose 订阅（hub-connection.ts:379）→ `onTransportClosed`（:761-768：closedFlag 置位、state='closed'、teardown、cleanupAll）→ `dropConnection` → `hub.connections` 收口至新连接。**既有链路，零改动。**
- hub 自身 HELLO_TIMEOUT 定时器（:372-376）**保留**：它对硬崩溃 peer（本地定时器随进程消失）仍是必要兜底；在 peer 已自关的场景，其 fire 撞上 `state !== 'handshaking'` 守卫 → 幂等 no-op（T1 :339-344 断言面）。注意 hub 的 `helloHandle` 不在 `onTransportClosed` 里清除——**依赖的正是 state 守卫**，这是既有行为，本设计不触碰。

---

## §5. 并发 / 边界 / 幂等推演（攻击面穷举）

| # | 竞速/边界场景 | 分析 | 结论 |
|---|---|---|---|
| R1 | **hello 超时 vs in-flight HELLO_ACK**（ACK 在超时触发后在旧 wire 上到达） | helper 先 `unsubscribeTransport`（旧 onMessage 闭包已摘）+ epoch 已失效（订阅闭包 epoch 门 :335-336 双保险）→ ACK 无人派发；即使派发也被代际门滤除 | 零扰动；state 保持 backoff；无第二次 backoff（T1 :314-328） |
| R2 | **迟到的旧代 hello timer vs 新代 handshaking** | 三层防线：(1) `helloHandle` 单槽——dialNow→armHello 开头 `clearHello()` 清旧柄；且离开 handshaking 的全部路径（onHelloAck :409 / stop :194 / onGoawayClosed :748 / enterBlocked :828 / onTemporaryFailure :856 / requestRebuild :878）都 clear；(2) 状态守卫 `!== 'handshaking'`；(3) 双凭据（transport 身份 + epoch）。任何一层独立即可拦截 | 旧代 timer 不可能关掉 wire2 / 不可能触发新代 backoff |
| R3 | **close() 同步重入**（真实 adapter 的 onClose 在 close() 内同步派发） | epoch 在 close 前已失效 + 监听已退订——重入的 onClose 调用既到不了我们的闭包（已摘），即使到达也被 epoch 门滤除。pong-timeout 在 real-transport 测试（sa7-issue170-real-transport）已验证同构序列 | 零重入副作用；无递归 close |
| R4 | **timer fire 时传输已被对端关闭**（remote close 事件还在队列里） | `!transport.closed` → 跳过 close；代际收口照常；`onTemporaryFailure` 进 backoff；**退订在先** → 迟到的 close 事件无人接收 → 不会触发第二次 `onTemporaryFailure`（其状态守卫也兜底） | 恰好一次 backoff；`peerSideClosed`/`closed` 已为 true，断言面不变 |
| R5 | **stop() 与 hello timer 竞速** | 单线程同步执行，timer 回调不会与 stop() 交错；stop() 先 `clearHello()`；即使假想 fire，`stopping` 守卫 + state（draining）守卫双拦 | stop 语义不变（1000/'replication-stop'） |
| R6 | **handshaking 期收到 GOAWAY/协议违规帧** | 走 `connectionFatal` → `enterBlocked` → `clearHello`（:828）→ hello timer 已清；state=blocked ≠ handshaking | 与本修复零交互 |
| R7 | **hub 侧同值 HELLO_TIMEOUT 后到**（10s > peer 100ms 探针 + 重拨） | hub 旧连接经 onTransportClosed 已 closed → 定时器 fire 撞 state 守卫 → no-op；hub.connections 仅剩 wire2 连接（T1 :339-344） | 幂等 no-op，零打扰 |
| R8 | **重拨链完整性** | backoff timer → dialNow：再次 stopLivenessNow/unsubscribeTransport/epoch+1（幂等）/旧 sender teardown/新 OutboundQueue+ConnectionSender/wire2 HELLO 放行 → onHelloAck → ready → openActiveTargets → live | 恢复链与缺陷前行为完全一致（D5/T1 恢复段当前就绿） |
| R9 | **观测面 exactly-once** | backoff 事件只在 `onTemporaryFailure` 发射一次（P3，:867）；零 `connection-failed`（临时失败分类——hello-timeout 不经 connectionFatal）；无 wire ERROR 帧（内部路径） | T1 :304-312 断言面成立 |
| R10 | **attempts 计数与退避公式** | 不变：`attempts += 1` 仍在 `onTemporaryFailure` 单点（:858）；full-jitter 公式不动 | attempt=1、delayMs=0.5×baseMs（探针 random=0.5）不变 |
| R11 | **`transport === undefined` 的假想武装** | 结构性不可能：armHello 仅由 dialNow :333 调用，晚于 `this.transport = transport`（:295）；签名改为参数传递后由类型系统承载该不变量，**无需运行时分支**（拒绝虚假降级：这不是降级场景而是不变量，用类型承载而非 if 兜底） | 无静默降级路径 |
| R12 | **背压终态路径与 hello 超时叠加** | failConnectionBackpressure 的重入守卫（state ∈ stopped/backoff/blocked/draining 早退）先于本路径可叠加的窗口；且 handshaking 期 sender 无控制帧流量（sendControl 被 ready 门拦），不会触发 | 零交互 |

---

## §6. close code / reason 裁决论证（对齐 SA6 次要断言，零测试调整）

SA6 设计要点声明「如 SA1 设计裁决不同，仅需调整次要断言」。**SA1 裁决：沿用 `{ code: 1001, reason: 'hello-timeout' }`**，论证：

1. **§14 WS close code 粗分类**：1001 属「GOAWAY、计划重启或服务停止」粗类——本地超时主动断开、稍后重连的语义正落此类；且 §15.1 规定「无明确 GOAWAY 的 1001：普通 backoff」——与 hello 超时的临时失败分类自洽（对端看到的是我们发出的 1001）。
2. **§13.1 注册表边界**：`HELLO_TIMEOUT | yes | yes | 1002` 是**连接级 wire ERROR 码**（hub 侧收不到 HELLO 时 `connectionFatal` 用，hub-connection.ts:374）。peer 本地超时是**无 wire 帧的内部路径**——与 §23.2 `PONG_TIMEOUT`「无 wire 帧——本地内部路径」的注册姿势同构（instance-replication-v1.md:656），不得发明 wire 帧或在 peer 侧发 ERROR。
3. **ADR-0010 round 2 修订先例**：登记的正是「**peer pong 超时 close(1001) + 代际安全脱离后重连**」——hello 超时按同一纪律收口是架构一致性要求，而非新决策。
4. **reason 复用观测词表既有词**：`hello-timeout` 已在 `PeerBackoffReason`（peer-connection.ts:41）与 observer 事件类型（types.ts:280）及协议观测面表中——close reason 与 backoff reason 用词一致，零新词。
5. **结论**：T1 :299-302 与 D5 :804-807 的次要断言无需调整；核心契约 `peerSideClosed === true` 由 §4.3 满足。

---

## §7. 影响评估与回归面

### 7.1 行为变化面（唯一）

hello 超时入口从「进 backoff、旧 transport 开放滞留」变为「同步 close(1001,'hello-timeout') → 进 backoff」。变化的可观测差异：
- `wire1.peerSideClosed`：false → true（缺陷收口，即 T1/D5 红转绿点）；
- hub 侧收到 close 事件 `{1001,'hello-timeout'}`（原先收到的是 10s 后 hub 自身超时的 `{1002,'protocol-error'}` 兜底——hub 自身收口路径不变，只是提前且由 peer 侧发起）；
- hub 连接表占用窗口从最长 ~helloTimeoutMs 缩至一次微任务传播。
- **状态机迁移、backoff reason/attempt/delay、恢复链、观测事件集**：全部不变。

### 7.2 受影响绿测试（pong 路径机械提取的回归锁定）

以下测试覆盖 pong-timeout 路径（重构必须保持绿）：

| 测试文件 | 覆盖点 |
|---|---|
| `ws-replication-issue170-r1-r4-red.test.ts` | R4 detach-close 序列正身（issue #170 验收） |
| `ws-replication-sa7-round2-dynamic.test.ts` D1-D3 | D3：drain 窗口 × pong 超时互斥 + close(1001,'pong-timeout') 签名 |
| `ws-replication-issue176-red.test.ts` | pong-timeout 相关收口 |
| `ws-replication-sa7-175-dynamic.test.ts` | 动态互斥面 |
| `ws-replication-sa7-issue170-minor3-observation.test.ts` | 观测面 |
| `ws-replication-sa7-issue170-real-transport.test.ts` | **真实 socket adapter**——close() 重入语义的实路径验证（R3 攻击面的实证） |

hello 超时入口仅被两个 #168 锚测试驱动（全测试目录 grep 确认：仅这两个文件用 `hello-timeout` reason；其余 helloTimeoutMs 引用均设 10s 不触发）。dial-throw / onClose 冻结面被 T2/T3 锁定。

### 7.3 业务影响

ws-replication 是 Phase 5 交付的复制传输层；本修复把一个显式推迟的协议对齐缺口收口，消除 handshaking 期半开 socket 滞留与 hub 连接表短时多占。无数据正确性影响（旧代 epoch/退订本就隔离），无配置面/公共 API 变化。

### 7.4 SA3 验证命令（实现后必须全绿）

```bash
# 1. 红转绿（本任务主锚）
npx vitest run packages/ws-replication/test/ws-replication-issue168-hello-timeout-close-peer-red.test.ts
npx vitest run packages/ws-replication/test/ws-replication-sa7-round2-dynamic.test.ts
# 2. pong 路径回归锁定（§7.2 全表）
npx vitest run packages/ws-replication/test/ws-replication-issue170-r1-r4-red.test.ts \
  packages/ws-replication/test/ws-replication-issue176-red.test.ts \
  packages/ws-replication/test/ws-replication-sa7-175-dynamic.test.ts \
  packages/ws-replication/test/ws-replication-sa7-issue170-minor3-observation.test.ts \
  packages/ws-replication/test/ws-replication-sa7-issue170-real-transport.test.ts
# 3. 包全量 + 类型
npx vitest run packages/ws-replication
npx tsc -p packages/ws-replication/tsconfig.json --noEmit
```

---

## §8. 实现步骤（SA3 指引，预计 ~35 行净改动）

1. `peer-connection.ts` helper 区新增 `detachCloseTimedOutTransport`（§4.1 代码逐字可用）。
2. `onHelloAck` 的 `onPongTimeout` 回调改用 helper（§4.2；守卫原样保留）。
3. `armHello` 改签名为 `(transport: DuplexTransport)` 并重写回调（§4.3；守卫层次：stopping → 状态 → 双凭据 → helper → onTemporaryFailure(true)）。
4. `dialNow` :333 调用点改 `this.armHello(transport)`。
5. 替换 `onTemporaryFailure` 头注释（§4.4 文案）。
6. 跑 §7.4 命令组；红灯测试 T1/D5 转绿、T2/T3 及全部既有测试保持绿、tsc 零错误。
7. 禁止触碰 ALLOW LIST 之外任何文件（见 §文件清单）。

---

## SA2 反馈逐条回应

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| #1（MINOR）§11/§4.3 的 armHello「消除 this.transport 可空读取」描述失准——真实理由是「武装时刻捕获传输身份 + 代际双凭据」（pong 同构） | ✅ | §4.3 措辞、§11 改动函数表 | 措辞改为「回调本不读 this.transport（现状仅状态守卫 + onTemporaryFailure）；参数化是为武装时刻捕获传输身份 + 代际双凭据」；§11 改动前契约改为「回调不持有传输身份/代际凭据（仅状态守卫），双凭据守卫无从书写」 |
| #2（MINOR）helper 不变量 `this.transport === transport` 仅由调用方守卫保证 | ✅（安全处理 + 记录） | §4.1 helper 代码（身份断言）、§10 A9、§11 | helper 头部加 loud 前置身份断言（不满足即 throw——fail-loud，非静默 return；两调用点守卫结构性保证不触发）；§10 A9 登记依据 |
| #3（LOW）`transport.close()` 同步 throw 的暴露面（卡 handshaking 永久无恢复） | ✅（安全处理 + 记录） | §4.1 helper 代码（try/catch）、§10 A8、§11 | helper 内 close 包 try/catch：吞 adapter 违约异常，保证调用方 `onTemporaryFailure` 必达（backoff 恢复链不被劫持）；§10 A8 登记依据；pong 路径经同一 helper 同享防护 |
| #4（INFO）引用章节号失准：「§25 PONG_TIMEOUT」应为 §23.2（:656） | ✅ | §6 论证 2、§10 A1 | 两处改为「§23.2（instance-replication-v1.md:656）」 |

（R0 初版无 SA2 反馈；本表为 SA2 pass 评审后按裁决落实的逐条记录，全部 4 项非阻断项已吸收。）

---

## §9. 文件清单（File Scope）

### ALLOW LIST

- `packages/ws-replication/src/peer-connection.ts` — 修改。§4 全部四处改动集中于此：新增私有 helper `detachCloseTimedOutTransport`（§4.1，~14 行）、pong 调用点机械提取（§4.2，净 ~0 行）、`armHello` 签名+回调重写（§4.3，~14 行）、`onTemporaryFailure` 头注释替换（§4.4，净 ~3 行）。预计净改动 ≤ 35 行，零公共 API 变化。
- `packages/ws-replication/test/ws-replication-issue168-hello-timeout-close-peer-red.test.ts` — `[SA6 owned]` 新建红灯契约（T1/T2/T3），SA6 Phase 1 已写入并验证红灯。SA3 不改断言逻辑；仅允许在 harness 级基础设施异常时经总控裁决的等价修复。
- `packages/ws-replication/test/ws-replication-sa7-round2-dynamic.test.ts` — `[SA6 owned]` D5 锚从「登记观察」翻转为修复契约（D1–D4 零改动），SA6 Phase 1 已完成。SA3 不改。

### DENY LIST

- `packages/ws-replication/src/hub-connection.ts` — hub 侧零改动（§4.5：兜底面 + state 守卫本就正确）
- `packages/ws-replication/src/liveness.ts` — liveness 自停/回调契约不动
- `packages/ws-replication/src/peer-namespace.ts` — namespace FSM 不动（onConnectionLost 行为不变）
- `packages/ws-replication/src/backpressure.ts`、`frame-io.ts`、`observer.ts`、`round-engine.ts`、`hub-namespace.ts`、`update-channel.ts`、`fence-watchdog.ts`、`lifecycle-queue.ts`、`error-mapping.ts`、`validate.ts`、`defaults.ts`、`index.ts`、`testing.ts` — 本任务零关联
- `packages/ws-replication/src/types.ts` — 词表已含 `hello-timeout`，零类型改动
- `docs/protocols/instance-replication-v1.md`、`docs/adr/**` — 修复对齐既有条款，不改规范
- `packages/ws-replication/test/` 下其余全部测试文件 — SA6 已写好/既有绿面，SA3 不准动
- `packages/` 其余包、`apps/**`、`tests/**` — 无关联

---

## §10. 协议假设依据 (Protocol Assumption Evidence)

| # | 假设 | 依据类型 | 依据内容（具体引用） | 风险等级 |
|---|---|---|---|---|
| A1 | peer 本地 hello 超时是内部路径：**零 wire ERROR 帧**，仅 WS 层 close | 源码引用 + 协议引用 | 协议 §13.1 `HELLO_TIMEOUT | yes | yes | 1002` 是连接级 wire ERROR 注册表（hub 侧 `hub-connection.ts:374` `connectionFatal('HELLO_TIMEOUT', 1002)` 消费）；§23.2（instance-replication-v1.md:656）`PONG_TIMEOUT` 注册姿势注明「无 wire 帧——本地内部路径」；pong-timeout 现行实现（peer-connection.ts:421-432）同样零 ERROR 帧 | 低 |
| A2 | `close(1001, 'hello-timeout')` 的 close 事件经 transport onClose 到达 hub 侧，签名 `{code:1001, reason:'hello-timeout'}` | 现有测试引用（同构先例） | SA7 round2 D3（ws-replication-sa7-round2-dynamic.test.ts:664-667）对 pong 路径断言 `hubSideCloseInfo` toEqual `{code:1001, reason:'pong-timeout'}`，同一测试 wire 语义（peer close → queueMicrotask → hubCloseListeners）；hub 侧订阅点 hub-connection.ts:379 | 低 |
| A3 | hub 对 peer 发起的 close 走 `onTransportClosed → cleanupAll → dropConnection`，`hub.connections` 收口至 1 | 源码引用 | hub-connection.ts:761-792（closedFlag/state='closed'/cleanupAll 尾部 dropConnection）；T1 :335 用 settleUntil 轮询该异步链 | 低 |
| A4 | hub 自身 HELLO_TIMEOUT 定时器在连接已 closed 时 fire → 幂等 no-op | 源码引用 | hub-connection.ts:372-376 回调守卫 `if (this.state === 'handshaking')`；`helloHandle` 不在 onTransportClosed/cleanupAll 清除（:610 仅 HELLO_ACK 清除）——state 守卫是唯一且足够的防线，既有行为 | 低 |
| A5 | 迟到 in-flight HELLO_ACK 落旧 wire 零扰动 | 源码引用 | 订阅闭包 epoch 门 peer-connection.ts:335-336（`if (this.connectionEpochValue === epoch)`）+ helper 内 `unsubscribeTransport` 先行；D3 :669 同构断言（收口后旧 wire 零出站/零派发面） | 低 |
| A6 | fake scheduler timer 语义：advanceBy 触发到点回调，clearTimeout 后不再触发 | 现有测试引用 | harness `createRegistryTestScheduler`（test/harness.ts）；D3 :656-659、T1 :290/:330/:339 大量依赖同语义；SA6 红灯运行已实证（hello 100ms 超时稳定触发 onTemporaryFailure） | 低 |
| A7 | close code 1001 对 §15.1 状态机的分类：临时失败（backoff），非 blocked | 协议引用 | §15.1「网络断开或无明确 GOAWAY 的 1001：普通 backoff」；§14「1001：GOAWAY、计划重启或服务停止」粗类；ADR-0010 round 2 修订登记 peer pong 超时 close(1001) 先例 | 低 |
| A8 | `transport.close()` 可能同步抛错（adapter 违约）——处置为 try/catch 吸收，`onTemporaryFailure` 必达 | 源码引用 + 评审建议 | types.ts :62 仅签名约束（void ≠ 永不 throw）；SA2 攻击点 #3（原 pong 路径同构暴露：epoch 已失效 + 监听已退订 + helloHandle 已清 → 若异常外播 onTemporaryFailure 不执行 → 连接永久卡 'handshaking'）；sa7-issue170-real-transport 实路径绿面（close 正常路径）。吸收即消除「适配器异常劫持恢复链」暴露面 | 低 |
| A9 | helper 内身份断言 `this.transport !== transport` → throw：调用点守卫保证不触发 | 源码引用 + 评审建议 | SA2 攻击点 #2（呼 requestRebuild :881-883「杜绝『守卫兜底』成为唯一防线」）；两调用点守卫均在前三行含 `this.transport !== transport`（pong :424 / hello §4.3）；触发即内部 bug——fail-loud（零静默降级） | 低 |

（本节无「应该返回 X」类无依据假设；全部条目有源码/测试/协议三引用之一以上。）

---

## §11. 契约改动连锁审计 (Contract Change Caller Audit)

### 总声明

**本设计无 SA4 §1.5 五类契约改动**（无 `return X → throw`、无 Promise/never 变化、无同步变 async、无 catch swallow → rethrow、无可空性/签名返回类型公共契约翻转）。改动为：新增私有方法、私有方法签名收紧（参数化）、调用点机械重构、注释替换——全部位于 `PeerConnectionImpl` 类内部，不外溢公共面。注：helper 内的身份断言 throw 与 close try/catch 均为**私有路径的防御性处置**（不可能被外部观察者触达；正常执行路径零 throw、异常不外播），已在 §10 A8/A9 登记。

### 改动函数

| 函数 | 文件 | 改动前契约 | 改动后契约 |
|---|---|---|---|
| `armHello`（私有） | `packages/ws-replication/src/peer-connection.ts:908` | `(): void`——回调不持有传输身份/代际凭据（仅状态守卫），双凭据守卫无从书写 | `(transport: DuplexTransport): void`——transport 由调用方传入，武装时刻捕获传输身份 + 代际双凭据（pong-timeout 同构） |
| `detachCloseTimedOutTransport`（私有，新增） | 同上（helper 区） | 不存在 | `(transport, reason: 'pong-timeout' \| 'hello-timeout') => void`；四步序列，正常路径无返回值、零 throw（身份不变量破坏断言 throw、adapter close 异常 try/catch 吸收——见 §10 A8/A9） |
| `onTemporaryFailure`（私有） | 同上:845 | `(reason, epochAlreadyInvalidated=false) => void` | **不变**（新增第六个带 `true` 的调用点，契约本身零改动） |
| 公共 API（`createPeerReplication`/`PeerReplication` 面） | `index.ts` 导出 | — | **零改动** |

### Caller 清单（内部调用点全量）

| Caller | 文件:行号 | 是否 await | 直接 try/catch | 顶层 catch-all / 重入守卫 | 处置方案 |
|---|---|---|---|---|---|
| `armHello` ← `dialNow` | peer-connection.ts:333 | N/A（同步 void） | 不需要（零 throw 路径；timer seam 回调由 scheduler 调用） | dialNow 自身无 catch（timer 回调异常会上抛 scheduler——与现状一致） | 唯一调用点同步改为 `this.armHello(transport)`；grep 验证：`git grep -n "armHello" -- 'packages/**/*.ts'` 仅 dialNow 一处 |
| `detachCloseTimedOutTransport` ← pong `onPongTimeout` 回调 | peer-connection.ts:421-432（重构后 :431 附近） | N/A（同步） | 不需要 | 回调前置三守卫（stopping/双凭据）已保留；liveness.ts:79 保证回调时活性已自停 | 机械替换四行为一调用；守卫与 `onTemporaryFailure('pong-timeout', true)` 原样 |
| `detachCloseTimedOutTransport` ← hello timer 回调 | peer-connection.ts:912（重写后） | N/A（同步） | 不需要 | 回调前置三守卫（stopping/状态/双凭据） | 新调用点；后随 `onTemporaryFailure('hello-timeout', true)` |
| `onTemporaryFailure` 全部 caller（6 处，契约未变，逐点复核） | :292 dial-failed / :431 pong-timeout(true) / :736 socket-closed / :745 goaway-closed / :817 connection-backpressure / :912 hello-timeout(**新增 true**) | N/A（同步 void） | 不需要（零 throw） | 方法首行 `if (this.stopping) return` + `backoff/blocked` 状态幂等守卫 | 前五处零改动；第六处由本设计新增且传 `true`（epoch 已在 helper 内失效，防重复递增） |
| `transport.close(1001, reason)` 新调用点（hello 回调内，经 helper） | N/A | 不需要 | DuplexTransport.close 契约为 void（types.ts :62；不代表永不 throw——SA2 #3，见 §10 A8）；helper 内 try/catch 吸收：异常不外播，`onTemporaryFailure` 必达 | 与 pong-timeout :430 同构（pong 现亦经同一 helper） |

### 风险评估

- **遗漏 caller 的代价**：`armHello`/`detachCloseTimedOutTransport` 均为私有且单一/双一 caller，无外部面；`onTemporaryFailure` 契约未变，六 caller 全列于上表。
- **抓全 caller 的方法**（SA4 复核命令）：
  ```bash
  git grep -n "\barmHello\b" -- 'packages/**/*.ts'          # → 仅 peer-connection.ts 定义+dialNow 调用
  git grep -n "detachCloseTimedOutTransport" -- 'packages/**/*.ts'  # → 定义+pong/hello 两调用点
  git grep -n "\bonTemporaryFailure\s*(" -- 'packages/**/*.ts'      # → 定义+上表 6 处
  ```
- **无 unhandledRejection / 进程级风险**：全部同步 void 调用，零新 throw 路径，零 Promise 面变化。

---

（SA1 R0 初版完——交出控制权，等待 SA2 破壁攻击。）
