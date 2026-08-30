# Issue #170 设计 — Phase 5 ping/pong timeout epoch safety（SA1，Round 1）

- **任务**：`wiki/raw/task_issue-170-ping-pong-epoch-safety.md`（bugfix）
- **缺陷锚**：SA5 分析 `wiki/raw/20260830-bug-ping-pong-epoch-safety.md`（R1–R4）
- **红灯契约**：`packages/ws-replication/test/ws-replication-issue170-r1-r4-red.test.ts`（SA6，H1/P1–P5，当前 6 failed）
- **基线**：`ef19bae`（PR #165 —— ping/pong seam 首次引入即带缺陷，new-feature-defect）
- **本文档角色**：SA1 设计工件。SA3 按本文实现；SA4 按 §11 文件清单做 scope 比对；SA2 攻击后按「SA2 反馈逐条回应」协议修订。

---

## §1. 根因复述与设计目标

四个同源缺陷（PR #165 seam 收口不完整），本设计逐一给出结构性修复：

| # | 缺陷（SA5 锚） | 结构定位 | 本设计章节 |
|---|---|---|---|
| R1 | hub pong 超时走 `connectionFatal('PONG_TIMEOUT', 1002)`：未注册错误码（§13.1 注册表无 `PONG_TIMEOUT`）→ ERROR 帧编码抛错被吞；close 1002 违反 §18 L524（应 1001）；peer `onClose(1002)` → `enterBlocked` 永不重拨 | `hub-connection.ts:261` | §5 |
| R2 | pong↔ping 零关联：pong 监听无条件清「当前任意」`pongHandle`——迟到/重复/未请求 pong 清掉下一次 ping 的超时（死对端误判存活）。seam 级根因：`types.ts:63` `onPong` 丢弃 pong 载荷（WS pong 回显的 ping 载荷是唯一关联凭据） | `liveness.ts:25-30` + `types.ts:63` | §3 + §4 |
| R3 | peer pong 超时闭包只 `close(1001)+onTemporaryFailure()`，未同步停旧 liveness / 退订旧 transport 监听 / 作废旧代际——backoff 窗口内僵尸 liveness 对已关 transport 周期 ping（真实 `ws` 语义 = timer 回调内未捕获异常）；闭包不校验 epoch | `peer-connection.ts:308-311` | §6.1 |
| R4 | `enterBlocked` 完全不停 liveness / 不退订 transport——blocked 终态旧 liveness 无限期运行；自身 pong 超时再二次 close(1001) 而 FSM 停留 blocked | `peer-connection.ts:595-613` | §6.3 |

**边界澄清（沿用 SA5）**：hub 侧无跨代际问题（每 `HubConnectionImpl` 独占 transport，`cleanupAll` 同步 `stopLiveness`）——hub 只修协议语义（R1）。peer 侧 `dialNow`（`peer-connection.ts:186-243`）已具备「停旧→退订→epoch+1→换新」纪律，跨代泄漏被限制在 backoff 窗口（R3）与 blocked 终态（R4）。

### 设计目标（= issue 验收的工程化表述）

- **G1（协议正确）**：hub pong 超时按 §18 权威语义执行——close **1001**、**零** ERROR 帧（不发明未注册码）、对端按临时失败 backoff 重拨重连收敛。
- **G2（pong 关联）**：每个 pong 必须凭**逐字节匹配在途 ping 凭据**才能清超时；迟到/重复/未请求/空载荷 pong 一律无效。
- **G3（同步收口栈）**：pong 超时 → backoff 排程之间，同步完成：停旧 liveness → 退订旧 transport 全部监听 → 关旧 transport(1001) → 作废旧连接 epoch——顺序即此。
- **G4（旧代惰性）**：旧代 pong 超时回调凭 **transport 身份 + connection epoch 双凭据**自判迟到；替换连接就绪后旧传输上的任何注入对新状态/序列/ns 零扰动。
- **G5（零应用级 PING/PONG 帧）**：活性只走 WS 层（协议 L42），wire 上不出现业务 PING/PONG 帧与 `PONG_TIMEOUT` ERROR 帧。
- **G6（无回归）**：既有 155 个测试全绿（除按 §8 说明的两处 fixture 回显忠实化），`tsc --noEmit` / vitest `--typecheck` / `git diff --check` 通过。

---

## §2. 设计总览：三层修复与六条不变量

```
┌─ 契约层（§3）  types.ts DuplexTransport.onPong 监听器签名拓宽：
│                (listener: () => void) → (listener: (payload?: Uint8Array) => void)
│                + 契约注释：暴露 onPong 面的 adapter 必须忠实透传回显载荷
├─ 活性层（§4）  liveness.ts 重构：
│                ① 每个 ping 携带 8 字节大端单调计数凭据
│                ② 仅凭据逐字节匹配的 pong 可清超时（R2）
│                ③ pong 超时/已关传输 ping 抛错 → 先自停（清双 timer + 退订 pong 监听）
│                   再回调 onPongTimeout —— 旧循环从此不再发 ping（R3 的活性半边）
│                ④ ping 抛错不得逃出 timer 回调（防御）
└─ 收口层（§5/§6）
   hub：onPongTimeout → onLivenessLost()：1001 临时失败关闭 + 零 ERROR 帧 + 同步清理（R1）
   peer：onPongTimeout → 双凭据校验 → 同步收口栈（§6.1）→ onTemporaryFailure 排 backoff（R3）
        onTemporaryFailure 顶部统一「停 liveness + 退订 transport + epoch++」（§6.2）
        enterBlocked 同补三件套（§6.3，R4）；requestRebuild 同补（§6.4，加固）
```

**不变量（SA4/SA7 评审锚）**：

- **I1**：任意时刻一条连接至多一个在途 ping；其凭据在会话内严格单调（`pongTimeoutMs < pingIntervalMs` 由 `validate.ts:164-168` 配置期 TypeError 保证——重验证不必新增）。
- **I2**：pong 超时（或 ping 抛错）触发时，liveness 在调用 `onPongTimeout` **之前**已完成自停——回调返回后 wire 上不可能再出现该会话的任何 ping/pong 监听回调。
- **I3**：peer 的 pong 超时回调持有 `(transport 引用, arm 时 epoch)` 双凭据；任一不匹配即静默返回（旧代惰性），不触碰新状态。
- **I4**：`onTemporaryFailure` 与 `enterBlocked` 返回后：旧 transport 三监听面（message/close/pong）计数为 0、零存活 liveness timer、连接代际已 +1（即使 close 行为按路径不同）。
- **I5**：传输 **关闭** 是路径特定的：pong 超时路径同步 `close(1001,'pong-timeout')`；远端关闭路径传输已死不重复关；hello 超时孤儿传输窗口（`ws-replication-sa7-round2-dynamic.test.ts` D5 登记观察项）**本任务不动**；blocked 终态不自发关（P5 断言 closeLog 为空）。
- **I6**：hub 侧每连接独占 transport 且 `cleanupAll` 同步停 liveness——hub 不引入 epoch（SA5 边界澄清），仅修协议语义。

---

## §3. 契约层：`DuplexTransport.onPong` 透传 pong 载荷（R2 的 seam 前置）

**现状**：`types.ts:63` `onPong?(listener: () => void): () => void;` —— 丢弃 pong 载荷。WS pong 回显 ping 载荷（RFC 6455 §5.5.2），是 ping↔pong 唯一关联凭据；不改 seam，P1–P3 在结构上不可能转绿（SA6 契约提示原话）。

**改动**（`types.ts` 冻结公共契约面上的**签名拓宽**，逐字）：

```ts
  /** WS 级活性（§18；协议不定义业务 PING/PONG frame——活性只走 WS 层）。缺省 = 无活性面。
   *  pong 关联契约（issue #170）：监听器接收 pong 载荷（RFC 6455 §5.5.2——pong 必须回显
   *  ping 载荷）。暴露本面的 transport/adapter 必须忠实透传回显载荷；无法透传载荷的实现
   * 不得暴露 onPong（缺面 → liveness dormant 是唯一合法降级形态）。 */
  ping?(data?: Uint8Array): void;
  onPong?(listener: (payload?: Uint8Array) => void): () => void;
```

`ping` 签名不变（`data?` 本就支持载荷；现状调用方从不传参——§4 起开始传）。

**为什么必须拓宽而不得用「等价关联面」绕开**：任何不经过 pong 载荷的关联（如计数窗口、时序启发）都无法区分「合法回声」与「迟到/重复回声」——它们在同一传输、同一时刻到达，唯一区别就是载荷。SA6 红灯测试的 fixture 已按此契约实现（`FacetTransport.onPong(listener: (payload?: Uint8Array) => void)`，test:62/172/220），这是本任务的验收契约，不是可选项。

**兼容性判定**（详见 §13 连锁审计）：`DuplexTransport` 自 `index.ts:13` 公开导出，但仓内无包外消费者（全仓 grep `onPong`/`DuplexTransport` 仅命中 `packages/ws-replication` 与其测试）；生产 ws adapter 属仓外宿主层（切片 9，未落地），以 types.ts 契约注释约束其未来实现。

---

## §4. 活性层：`liveness.ts` 重构——凭据关联 + 超时自停

**整文件重写**（54 行 → 约 100 行）。完整目标形态：

```ts
/**
 * liveness —— WS 级 ping/pong 活性循环（协议 L42「活性检测只使用 WebSocket ping/pong。
 * 协议不定义业务 PING/PONG frame」+ §18 L518-524）。
 *
 * 仅当 transport 提供 `ping` 与 `onPong` 两个可选面时武装（缺面 → dormant，零 timer）。
 * 周期 ping（每次携带 8 字节单调凭据）→ 仅凭据逐字节匹配的 pong 清超时 →
 * pong 超时 / 已关传输上 ping 抛错 → 先自停（清双 timer + 退订 pong 监听）再回调
 * onPongTimeout（hub: 1001 连接关闭；peer: 同步收口栈 + backoff）。
 */
import type { ReplicationTimer } from './types.js';

export interface LivenessDeps {
  readonly timer: ReplicationTimer;
  readonly pingIntervalMs: number;
  readonly pongTimeoutMs: number;
  readonly ping: (data?: Uint8Array) => void;
  /** seam 契约（issue #170 / §3）：监听器接收 pong 载荷（RFC 6455 §5.5.2 回显凭据）。 */
  readonly onPong: (listener: (payload?: Uint8Array) => void) => () => void;
  /** 活性失联（pong 超时，或已关传输上 ping 抛错）。回调时 liveness 已自停并退订。 */
  readonly onPongTimeout: () => void;
}

/** ping 关联凭据：8 字节大端单调计数。会话内严格单调 → 任何旧凭据不等于新在途凭据；
 *  8 字节 ≪ RFC 6455 §5.5 控制帧 125 字节载荷上限。 */
function encodeCredential(counter: number): Uint8Array {
  const payload = new Uint8Array(8);
  let value = counter;
  for (let i = 7; i >= 0; i -= 1) {
    payload[i] = value % 256;
    value = Math.floor(value / 256);
  }
  return payload;
}

/** 逐字节比对；载荷缺失（undefined）/长度不等/任一字节不等 → 不匹配（不静默放行）。 */
function credentialMatches(payload: Uint8Array | undefined, credential: Uint8Array): boolean {
  if (payload === undefined || payload.byteLength !== credential.byteLength) return false;
  for (let i = 0; i < credential.byteLength; i += 1) {
    if (payload[i] !== credential[i]) return false;
  }
  return true;
}

/** 启动活性循环；返回停用函数（收口/重拨/stop 必调——幂等）。 */
export function startLiveness(deps: LivenessDeps): () => void {
  let stopped = false;
  let pingHandle: unknown | undefined;
  let pongHandle: unknown | undefined;
  let counter = 0; // 会话内单调；跨会话隔离由 per-socket pong 投递保证（§9 E7）
  let outstanding: Uint8Array | undefined;

  const stopInternal = (): void => {
    if (stopped) return;
    stopped = true;
    if (pingHandle !== undefined) { deps.timer.clearTimeout(pingHandle); pingHandle = undefined; }
    if (pongHandle !== undefined) { deps.timer.clearTimeout(pongHandle); pongHandle = undefined; }
    outstanding = undefined;
    offPong();
  };

  // R2 核心：仅当「有在途 ping 且 pong 载荷逐字节 == 在途凭据」才清超时。
  // 迟到（旧凭据）/ 重复（旧凭据二次投递）/ 未请求（从未发出的载荷）/ 空载荷 → 一律忽略。
  const offPong = deps.onPong((payload) => {
    if (stopped || pongHandle === undefined || outstanding === undefined) return;
    if (!credentialMatches(payload, outstanding)) return;
    deps.timer.clearTimeout(pongHandle);
    pongHandle = undefined;
    outstanding = undefined;
  });

  const loseLiveness = (): void => {
    stopInternal();        // I2：回调前自停——清下一 ping timer + 退订 pong 监听
    deps.onPongTimeout();  // 调用方在「已停活性、已退订」的栈上做连接收口
  };

  const loop = (): void => {
    if (stopped) return;
    counter += 1;
    outstanding = encodeCredential(counter);
    try {
      deps.ping(outstanding);
    } catch {
      // 已关/损坏 socket 上的 ping 抛错（ws 语义 `WebSocket is not open: readyState 3`）
      // = 活性已失。不得让异常逃出 timer 回调（生产 = 进程级未捕获异常）。
      loseLiveness();
      return;
    }
    pongHandle = deps.timer.setTimeout(() => {
      pongHandle = undefined;
      if (!stopped) loseLiveness();
    }, deps.pongTimeoutMs);
    pingHandle = deps.timer.setTimeout(loop, deps.pingIntervalMs);
  };

  pingHandle = deps.timer.setTimeout(loop, deps.pingIntervalMs);
  return stopInternal;
}
```

**要点与理由**：

1. **凭据选型**：8 字节大端**单调计数**（非随机 nonce）。判据：pong 投递是 per-socket 的——旧连接的 pong 只会到达旧 socket 的监听器（本设计保证其在收口时已退订），不存在跨 socket 的 pong 迁移；会话内单调性已足以区分迟到/重复/未请求。P3 的未请求载荷 `[0xde,0xad]`（2 字节）与 8 字节凭据长度即不等 → 不匹配。liveness 是活性启发而非认证边界（§9 E8），不引入 `random` 依赖（hub 侧本就无 `random` 注入）。
2. **超时自停（I2）**：pong 超时在回调调用方**之前**清掉预排的下一 ping timer（现状缺陷：`liveness.ts:38` 预排、超时后不清 → 僵尸循环）并退订 pong 监听——即使调用方忘记停活性，wire 上也不再有任何该会话的 ping/pong 面。`stopInternal` 幂等，调用方随后再调（hub `cleanupAll` / peer `stopLivenessNow`）为 no-op。
3. **`onPongTimeout` 语义扩注**：含「已关传输上 ping 抛错」这一触发源（catch 分支）。两个调用方（hub/peer）的处理器都是「活性失联 → 临时失败收口」，对 ping 抛错同样正确（此时传输已关：hub `closedFlag` 守卫、peer 状态守卫/双凭据守卫保证幂等，§9 E5）。
4. **不变量 I1 的结构性依托**：`validate.ts:164-168` 已在配置解析期以 TypeError 强制 `pongTimeoutMs < pingIntervalMs`——同一时刻至多一个在途 ping 由结构保证，loop 无需多凭据簿记。
5. `stopInternal` 引用后声明的 `offPong` 是闭包 TDZ 安全的（二者都只在 `startLiveness` 返回后才可能被调用；同步注册期 `deps.onPong` 若立即回调监听器，监听器因 `pongHandle === undefined` 早退，不触碰 `stopInternal`）。

---

## §5. hub 侧：pong 超时 = 协议临时失败（R1）

**改动点**：`hub-connection.ts` — ① `onHello` 武装处的回调（:261）；② 新增私有 `onLivenessLost()`。

```ts
    // onHello 内（替换 :261 的 onPongTimeout 行；onPong 实参随 §3 拓宽后直接透传载荷）：
    if (this.transport.ping !== undefined && this.transport.onPong !== undefined) {
      this.stopLiveness = startLiveness({
        timer: this.hub.timer,
        pingIntervalMs: this.hub.timeouts.pingIntervalMs,
        pongTimeoutMs: this.hub.timeouts.pongTimeoutMs,
        ping: this.transport.ping,
        onPong: this.transport.onPong,
        // issue #170 R1：pong 超时 = §18 L524 临时失败——close(1001)、零 ERROR 帧
        //（§13.1 注册表无 liveness 错误码；不得发明未注册码）。
        onPongTimeout: () => this.onLivenessLost(),
      });
    }

  /** 活性失联收口（§18 L524：临时失败——close 1001 + 对端经 backoff 重连）。
   *  与 connectionFatal 同拓扑（sender 停 → closedFlag/状态 → 通道 quiesce → close →
   *  cleanupAll 停活性+退订+dropConnection），差异仅两处：① 不发 connection ERROR 帧
   *  （liveness 非 wire 协议错误——协议 L42 活性只走 WS 层；注册表无码可发）；
   *  ② close code 1001 + reason 'pong-timeout'（非 'protocol-error'/1002）。 */
  private onLivenessLost(): void {
    if (this.closedFlag) return;
    this.sender.teardown();
    this.closedFlag = true;
    this.state = 'closed';
    for (const channel of this.channels.values()) channel.quiesceConnection();
    if (!this.transport.closed) {
      this.transport.close(1001, 'pong-timeout');
    }
    void this.cleanupAll();
  }
```

**行为变化（wire 可观测，有意为之）**：

| 维度 | 现状（ef19bae） | 目标 | 依据 |
|---|---|---|---|
| close code/reason | 1002 / `'protocol-error'` | **1001 / `'pong-timeout'`** | §18 L524「pong 超时按临时失败处理：关闭传输（close code 1001）」；§14 L387（1002=framing/sequence/message/ACK 协议错误——liveness 不属于） |
| ERROR 帧 | 尝试发 `PONG_TIMEOUT`（编码抛 `unknown error code` 被 `connectionFatal` try/catch 吞 → 实际零帧上线） | **零尝试、零帧** | §13.1 注册表封闭（17 个 connection 错误码，无 liveness 码）；encoder 从注册表导出语义、调用方不可覆盖（协议 L334）；issue 范围明令「do not emit an unregistered PONG_TIMEOUT protocol error」 |
| 对端效果 | `onClose(1002)` → `enterBlocked` 终态、永不重拨 | `onClose(1001)` → `onTemporaryFailure` → backoff 重拨 | H1 锚 2/3 |

**为何不发任何替代 ERROR 帧**：§14「framing 仍可信时关闭前 best-effort 发送 connection ERROR」的义务以**注册表存在该条件的错误码**为前提；liveness 失联不是 wire 协议错误（协议 L42），注册表刻意不含此类码，hub 无码可发——以 close code 1001 单独承载机器语义（peer 侧重拨由 close code 驱动，无需 ERROR 帧）。也不发 GOAWAY：GOAWAY 是「计划停机排空」语义（§11），活性失联要求立即收口，混用会引入 drain 等待窗口。

**epoch/transport 校验（G4 对 hub 的适用性）**：hub 每 `HubConnectionImpl` 独占一条 transport、liveness 每 connection 至多武装一次、`cleanupAll` 同步停活性——旧 pong 超时 timer 在 `cleanupAll` 后不可能存在（timer 已清）。`onLivenessLost` 的 `closedFlag` 守卫吸收任何重入（如 ping 抛错路径与超时路径竞速）。hub 无需引入 epoch（I6；SA5 边界澄清）。

---

## §6. peer 侧：同步收口栈 + 双凭据校验 + 终态拆除（R3/R4）

### §6.1 pong 超时闭包：双凭据校验 + 同步收口栈（R3 / P4）

`peer-connection.ts` `onHelloAck` 武装处（:300-313）替换为：

```ts
    this.clearHello();
    this.setState('ready');
    this.armResetCheck();
    const transport = this.transport;
    if (transport?.ping !== undefined && transport.onPong !== undefined) {
      const epoch = this.connectionEpochValue; // I3：武装时捕获代际
      this.stopLiveness = startLiveness({
        timer: this.options.timer,
        pingIntervalMs: this.timeouts.pingIntervalMs,
        pongTimeoutMs: this.timeouts.pongTimeoutMs,
        ping: transport.ping,
        onPong: transport.onPong, // §3 拓宽后直接透传
        onPongTimeout: () => {
          if (this.stopping) return;
          // 双凭据校验（issue 范围 2）：transport 身份 + 连接代际——旧代定时器零影响。
          if (this.transport !== transport || this.connectionEpochValue !== epoch) return;
          // 同步收口栈（G3，顺序 = issue 原文）：停旧 liveness → 退订旧 transport 全部监听
          // → 关旧 transport(1001) → epoch 作废（在 onTemporaryFailure 顶部）→ 排 backoff。
          this.stopLivenessNow();
          this.unsubscribeTransport();
          if (!transport.closed) transport.close(1001, 'pong-timeout');
          this.onTemporaryFailure();
        },
      });
    }
    this.openActiveTargets();
```

- liveness 已在回调前自停（§4 I2）——`stopLivenessNow()` 此处为幂等防御（也覆盖 liveness 因 ping 抛错已先走 `loseLiveness` 的情形）。
- epoch 作废收敛到 `onTemporaryFailure` 顶部单点（§6.2），在 `setState('backoff')` 与 backoff timer 排程**之前**执行——满足 G3「epoch invalidation before scheduling backoff」的顺序要求，且避免双计数。
- 回调触发时状态必为 `ready`（liveness 只在 ready 武装；离开 ready 的所有路径——stop/requestRebuild/onTemporaryFailure/enterBlocked——均先停 liveness），`onTemporaryFailure` 的状态守卫是第二层防御。

### §6.2 `onTemporaryFailure`：顶部统一代际收口（R3 的 funnel 半边）

```ts
  private onTemporaryFailure(): void {
    if (this.stopping) return;
    if (this.connStateValue === 'backoff' || this.connStateValue === 'blocked') return;
    // 同步代际收口（issue #170 验收 2 / I4）：停旧 liveness、退订旧 transport 全部监听、
    // 作废连接代际——先于一切 backoff 排程。不关传输（I5）：关闭是路径特定的——
    // pong 超时路径由闭包同步 close(1001)（§6.1）；远端关闭路径传输已死；hello 超时
    // 孤儿传输窗口是 D5 登记处置项，本任务不动。
    this.stopLivenessNow();
    this.unsubscribeTransport();
    this.connectionEpochValue += 1;
    this.sender?.teardown();      // 以下与现状逐行相同
    this.clearHello();
    this.clearReset();
    this.attempts += 1;
    this.setState('backoff');
    for (const controller of this.controllers.values()) {
      controller.onConnectionLost();
    }
    const cap = Math.min(this.backoff.maxMs, this.backoff.baseMs * Math.pow(2, this.attempts - 1));
    const random = this.options.random ?? Math.random;
    const delay = Math.max(0, random() * cap);
    this.backoffHandle = this.options.timer.setTimeout(() => {
      this.backoffHandle = undefined;
      if (this.connStateValue === 'backoff') this.dialNow();
    }, delay);
  }
```

**这修复了一个 SA5 未单列、但与 R3 同类的潜伏缺陷**：远端 1001/1000/1011 关闭（`onClose` → `onTemporaryFailure`）时，liveness 仍武装、ping timer 仍预排——backoff 窗口内旧 liveness 对已关 transport 周期 ping（真实 ws = timer 回调内未捕获异常）。收口栈放进 funnel 后，**所有**临时失败路径统一获得「停活性 + 退订 + 代际作废」纪律；只有「关传输」保持路径特定（I5），从而一字不破坏 D5 登记观察项（hello 超时不关 peer 侧传输——`ws-replication-sa7-round2-dynamic.test.ts:790/803` 继续原样通过）。

**epoch 前移的安全性**（消费方逐一核对）：`connectionEpoch()` 仅被 `peer-namespace.ts` 用作迟到性判别（`host.connectionEpoch() !== epoch` → 丢弃续体，:191/:224/:294/:321/:386/:405/:785/:822），全部是不等式比较、无「等于某特定值」假设；连接失联时控制器已经 `onConnectionLost()` 投影 disconnected——续体本就应当即刻全量惰性。epoch 在失败时刻而非 dial 时刻作废，是把「迟到」的判定提前到连接真正死亡的一刻，语义更准。`dialNow` 随后的 `+= 1`（:193）只是再次推进，无害。

### §6.3 `enterBlocked`：终态拆除三件套（R4 / P5）

```ts
  private enterBlocked(): void {
    if (this.connStateValue === 'blocked') return;
    // R4：blocked 也是连接收口——liveness/transport 订阅/代际与 temporary-failure 同纪律拆除
    //（P5：三监听面计数 0、blocked 态零 ping 活动、零自发二次 close）。传输不关：
    //1002/1008 路径传输已被对端关闭；GOAWAY SHUTTING_DOWN 语义要求 socket 保持开放
    //（sa7-hardening D5：drain 残留排队帧不得继续派发——退订 onMessage 反而强化该语义）。
    this.stopLivenessNow();
    this.unsubscribeTransport();
    this.connectionEpochValue += 1;
    this.sender?.teardown();      // 以下与现状逐行相同
    this.clearHello();
    this.clearReset();
    this.clearBackoff();
    this.setState('blocked');
    if (this.outbound !== undefined) { this.outbound.clear(); this.outbound = undefined; }
    for (const controller of this.controllers.values()) {
      controller.onConnectionFatal();
    }
  }
```

`connectionFatal`（本端协议错误）/`onSequenceExhausted`/`onClose(1002|1008)`/`onGoaway(SHUTTING_DOWN|REAUTH_REQUIRED)` 全部经 `enterBlocked` 获得同纪律——R4 的泄漏面（「任何 1002/1008 收口路径」）整体闭合，非逐点补丁。

### §6.4 `requestRebuild`：同一纪律加固（deferTask 挂起窗口）

`requestRebuild`（:635-657）在 `this.sender?.teardown();` 前插入同三行（`stopLivenessNow()` + `unsubscribeTransport()` + `connectionEpochValue += 1`）。

理由：`requestRebuild` 是「替换连接」的另一入口（config-change/re-add），现状依赖 deferred `dialNow` 补拆——`deferTask` 可被宿主替换为任意时长的 latch（R7-1 语义），挂起窗口内旧 liveness 的 ping timer 仍活着、旧 transport 监听仍订阅，与 R3 同构。三行加固把「旧代在替换编排启动的一刻即惰性」变为结构保证；对既有测试零可观测影响（R7-1 的 driver wire 无 ping 面 → liveness dormant；断言不含监听计数）。

### §6.5 不改动的 peer 路径（显式说明）

- `dialNow`（:186-243）既有「停旧→退订→epoch+1→换新」纪律保留原样；不在 dialNow 里补「关旧传输」——hello 超时孤儿窗口归 D5 跟踪票处置（I5），本任务不扩权。
- `stop()`（:111-134）已有同纪律，原样。
- `failConnectionBackpressure`（:571-593）：先 `close(1011,'control-backpressure')` 再调 `onTemporaryFailure`——funnel 的退订/停活性幂等叠加，1011 关闭码不被覆盖（funnel 不关传输）。

---

## §7. 红灯逐条转绿推演（虚拟时钟时间线）

SA6 测试常量：`PING_INTERVAL_MS=30_000`、`PONG_TIMEOUT_MS=10_000`、backoff base/max=100_000 × random 0.5 → 重拨延迟 50_000。

### H1（R1，hub 协议语义；facets='hub'，首代 hubAutoPong=false，次代 true）

| 时刻（hub 时钟） | 事件 | 设计后行为 → 断言 |
|---|---|---|
| t≈0 | 握手 ready；hub liveness 武装（凭据计数就绪） | `hubPongListeners()===1` ✓ |
| t=30 | loop：凭据 c1 → `hubEnd.ping(c1)`；pong timer t=40；next ping t=60 | `hubPings().length===1` ✓ |
| t=40 | pong timer 触发 → liveness 自停 → `onLivenessLost()`：sender 停 → 通道 quiesce → `close(1001,'pong-timeout')` → `cleanupAll`（停活性 no-op + 退订 + dropConnection） | `hubCloseLog()[0].code===1001` ✓；`hubToPeerFrames()` 仅 HELLO_ACK → 零 `PONG_TIMEOUT` ERROR ✓ |
| （微任务） | peer `onClose({1001})` → 非 1002/1008 → `onTemporaryFailure`：停活性（peer 无面，dormant no-op）+ 退订 + epoch++ → backoff timer（peer 时钟 +50s） | `getConnectionState()==='backoff'` ✓ |
| peer+50s | `dialNow` → wire2（hubAutoPong=true）→ 握手 → ready → ns live | `dialCount===2` ✓；`hub.connections.length===1` ✓（旧连接已 dropConnection） |
| 之后 | hub 写 99 → UPDATE 经 wire2 → peer apply | `rootValue('peer')===99` ✓ |

### P1/P2/P3（R2，pong↔ping 关联；facets='peer'，无 autoPong；peer 时钟）

| 测试 | 时间线 | 设计后行为 → 断言 |
|---|---|---|
| P1 迟到 | t=30 ping(c1)；注入 pong(c1)→匹配清超时；t=60 ping(c2)；注入 pong(c1)（迟到）→ **c1≠c2 忽略**；t=70 pong timer 触发 → 自停 → 闭包双凭据 ✓ → 同步栈 close(1001)+backoff | `state==='backoff'` ✓ `peerCloseLog()[0].code===1001` ✓ |
| P2 重复 | t=30 ping(c1)+pong(c1) 匹配；t=60 ping(c2)；再注入 pong(c1)（重复）→ 忽略；t=70 超时收口 | 同上 ✓ |
| P3 未请求 | t=30 ping(c1)；注入 pong(`[0xde,0xad]`)（2 字节，长度≠8）→ 忽略；t=40 超时收口 | 同上 ✓（死对端不得被误判存活） |

### P4（R3 + old-epoch；facets='peer'，autoPongFromSecond，throwPingWhenClosed）

| 时刻（peer 时钟） | 事件 | 设计后行为 → 断言 |
|---|---|---|
| t=30 | ping(c1)（wire1 记录载荷 c1） | `peerPings().length===1` ✓ |
| t=40 | pong timer → liveness 自停（next-ping timer 清 + pong 监听退订）→ 闭包：双凭据 ✓ → 停活性(幂等) → 退订 message/close → `close(1001,'pong-timeout')` → `onTemporaryFailure`（退订幂等 + epoch++ + backoff@t=90） | `closeLog===[{1001,'pong-timeout'}]` ✓ `state==='backoff'` ✓ `pongListeners/messageListeners/closeListeners===0` ✓ |
| backoff 窗 [40,90) | 注入旧代 pong(c1) → wire1 零监听 → 惰性；推进 t=70 → 零存活 timer | `peerPingsAfterClose()===0` ✓ `closedTransportPingErrors()===0` ✓ |
| t=90 | backoff → `dialNow`（epoch++ → wire2 autoPong）→ ready → ns live | `dialCount===2` ✓ `hub.connections.length===1` ✓ |
| 之后 | wire1 注入 pong(c1)：wire1 零监听（且闭包 epoch 已旧）→ 全惰性 | 新连接 `ready`/`live` 不扰动、wire1 ping 计数不变 ✓；hub 写 77 收敛 ✓ |

### P5（R4，blocked 收口；facets='peer'）

| 时刻 | 事件 | 设计后行为 → 断言 |
|---|---|---|
| t≈0 | `hubEnd.close(1002,'protocol-error')` → peer `onClose` → `enterBlocked`：停活性（首 ping timer t=30 被清）+ 退订三面 + epoch++ | `state==='blocked'` ✓ 三监听 `===0` ✓ |
| t=30 | 推进 30s：零存活 liveness timer | `peerPings().length===0` ✓ |
| t=40 | 推进 10s：无 pong timer → 无自发收口 | `peerCloseLog()` 空 ✓ |
| t=390 | 终态保持（护栏） | `blocked`、`dialCount===1` ✓ |

---

## §8. 回归面：既有测试影响与两处 fixture 回显忠实化

全量回归命令：`pnpm exec vitest run packages/ws-replication`（现状 22 文件 155 passed + 6 新红灯；修复后目标 161/161）。

### §8.1 必改：两个既有 wire 的 pong 回显忠实化（`[SA6 owned]` fixture 更新，断言零改动）

strict 凭据匹配下，「无载荷 pong」不再被视为合法应答（issue 范围明文「unsolicited pong must not clear the next ping timeout」；SA5 R2 的死对端场景正是用空载荷注入复现的）。两个既有 fixture 以**无载荷** pong 模拟对端应答，属于对 RFC 6455 §5.5.2（「A Pong frame sent in response to a Ping frame must echo identical application data」）的非忠实建模，需按 SA6 新契约（「wire 只忠实回显 ping(data) 的载荷」）修正——**只改 wire 机制，不改任何断言**：

1. `ws-replication-sa7-hardening-dynamic.test.ts`（D4 wire，:561-642）：
   - `ping()` → `ping(data?: Uint8Array)`：记录 `lastPingData = data`；
   - `pongListeners` 元素类型 `() => void` → `(payload?: Uint8Array) => void`；
   - `firePong()` → 以 `listener(lastPingData)` 投递（忠实回显）。
   - D4 断言（`advanceBy(499)+1` 后仍 ready——「pong 已清计时不误杀」）在回显忠实化后照常成立：回显载荷逐字节等于在途凭据 → 匹配 → 清超时。
2. `ws-replication-sa7-round2-dynamic.test.ts`（LivenessLogWire，:500-511）：
   - `ping()` → 记录载荷；`autoPong` 分支以 `listener(data)` 回显。
   - D3 断言（wire2 重连后 5s 观察窗保持 ready/live，:666-675）照常成立。
   - D5（hello 超时孤儿窗口登记项，:786-803）：`onTemporaryFailure` 不关传输（§6.2/I5）→ `peerSideClosed===false` 原样通过——**本任务不动该登记项**。

**不改**：`ws-replication-review-revisions-r1-r7-red.test.ts` 的 wire 虽有 `firePong`（无载荷），但全文件无调用点（仅 sa7-hardening 调用）；其 R4-1/R4-2 走 pong 超时路径（无 pong 应答），零影响。

### §8.2 逐类既有测试的兼容性论证

| 测试面 | 影响 | 论证 |
|---|---|---|
| `ws-replication-review-revisions-r1-r7-red.test.ts` R4-1/R4-2（pong 超时关传输/hub 清理/重连收敛） | 无（继续绿） | §6.1 同步 `close(1001,'pong-timeout')` 与现状闭包的 close 行为等价（`hubSideCloseInfo` 断言 1001/pong-timeout 不变）；hub 清理/重连拓扑不变 |
| `ws-replication-sa7-hardening-dynamic.test.ts` D4 缺面 dormant（stripFacets） | 无 | 无 ping/onPong → liveness 不武装（判定条件不变） |
| `ws-replication-api.test-d.ts` 传输 seam 类型断言（:114 `toMatchTypeOf` 5 必选方法） | 无 | 拓宽的是**可选**成员 `onPong` 的监听器参数（`() => void` → `(payload?: Uint8Array) => void`，可选参数向后兼容）；5 个必选成员签名不变，`DuplexTransport` 对该形状的可赋值性不变 |
| sa7-hardening D5 / GOAWAY blocked（socket 保持开放、零后续 UPDATE） | 无 | `enterBlocked` 不关传输；退订 onMessage 强化「残留帧不派发」而非削弱 |
| ac7-faults / r3-r4-regressions / issue137 系（blocked/fatal/backoff 分类） | 无 | `connectionFatal`/`failConnectionBackpressure`/`onClose` 分类逻辑零改动；funnel 新增的退订/停活性对无 ping 面的 wire 是 no-op |
| 类型检查（`tsc --noEmit`、vitest `--typecheck`） | 无 | 方法双变（method bivariance）下旧式 `onPong(listener: () => void)` 实现仍可赋值给拓宽后接口；包内唯二 liveness 消费点（hub/peer）直接透传新签名 |

---

## §9. 边界条件与并发矩阵

| # | 场景 | 设计行为 |
|---|---|---|
| E1 | 迟到 pong（载荷 = 上一凭据）在下一 ping 在途时到达 | `credentialMatches` 失败 → 忽略；下一 ping 超时照常收口（P1） |
| E2 | 同一 pong 重复投递（已清超时后再来一份） | `pongHandle===undefined` 早退 → 忽略（P2 前半 + 匹配后重复） |
| E3 | 未请求 pong（载荷从未发出 / 空载荷 undefined / 长度不符） | 忽略（P3；§4 `credentialMatches` 三重判否，不静默放行——拒绝虚假降级） |
| E4 | 旧代 pong 超时 timer 在替换连接 ready 后触发 | liveness 在旧收口时已自停 → timer 已清，结构性不存在；即使绕道（ping 抛错路径）触发回调，闭包双凭据（transport 引用 + epoch）不匹配 → 静默返回（P4 末段 + I3） |
| E5 | 已关传输上 ping 抛错（ws `WebSocket is not open`） | liveness catch → 自停 → `onPongTimeout` → hub：`closedFlag` 守卫；peer：状态守卫（backoff/blocked 返回）+ 双凭据 → 幂等，无未捕获异常（§4 catch 分支） |
| E6 | pong 超时与远端 close 竞速（同一连接） | 先到者走 funnel（退订+停活性+epoch++）；后到者：onClose 已退订（fake wire）/状态守卫（真实 ws 的迟到 close 事件经守卫吸收）——均幂等 |
| E7 | 跨会话凭据碰撞 | 不存在投递通道：pong 按 socket 投递，旧 socket 的 pong 只达旧监听器（已退订）；计数凭据仅需会话内单调（§4 要点 1） |
| E8 | 恶意对端预猜下一凭据并发未请求 pong | 凭据为单调计数，可预测——但 liveness 是活性启发而非认证边界（协议 L42）；「从不回 pong 的对端」在下一凭据生成后即超时收口。防伪造不属本层职责（bearer/认证在 Upgrade 层） |
| E9 | `pongTimeoutMs ≥ pingIntervalMs` 的错误配置 | 配置解析期 TypeError（`validate.ts:164-168` 既有），运行时零 clamp——不变量 I1 的前提不可被绕过 |
| E10 | 微任务快照投递中途退订（onClose/onPong dispatch 中 unsubscribe） | 测试 wire 以 `[...listeners]` 快照迭代；Node EventEmitter 对 emit 中 removeListener 安全——退订只影响后续投递 |
| E11 | 双 funnel 叠加（pong 超时闭包先退订，`onTemporaryFailure` 再退订） | `unsubscribeTransport` 清空数组、`stopLivenessNow` 置 undefined、epoch 前者不碰后者 +1——全幂等，无双重 backoff（状态守卫） |
| E12 | blocked 期间对端关闭 socket（GOAWAY 场景） | enterBlocked 已退订 onClose → 无回调；FSM 保持 blocked（P5 护栏） |
| E13 | hello 超时（liveness 从未武装） | funnel 停活性 no-op、退订生效（迟到 HELLO_ACK 本就被状态守卫忽略——语义等价）、不关传输（D5 登记项保持） |

---

## §10. SA2 反馈逐条回应

（Round 1 首版——尚无 SA2 反馈。SA2 reject 后，本表逐条登记要求编号、落实位置与实质改动摘要。）

---

## §11. 文件清单（File Scope）

### ALLOW LIST

- `packages/ws-replication/src/liveness.ts` — 修改（整文件重写，54→约 100 行）：ping↔pong 凭据关联 + 超时/抛错自停（§4；R2 核心 + R3 活性半边）
- `packages/ws-replication/src/types.ts` — 修改（1 处签名 + 契约注释，约 6 行）：`DuplexTransport.onPong` 监听器拓宽透传 pong 载荷（§3；SA6 契约提示的 seam 前置）
- `packages/ws-replication/src/hub-connection.ts` — 修改（约 20 行）：`onPongTimeout` 改指 `onLivenessLost()` + 新增私有方法（§5；R1——1001/零 ERROR 帧/同步清理）
- `packages/ws-replication/src/peer-connection.ts` — 修改（约 25 行）：pong 超时闭包双凭据 + 同步收口栈（§6.1）；`onTemporaryFailure` 顶部代际收口（§6.2）；`enterBlocked` 三件套（§6.3）；`requestRebuild` 加固（§6.4）
- `packages/ws-replication/test/ws-replication-issue170-r1-r4-red.test.ts` — `[SA6 owned]` 验收红灯（已由 SA6 落盘，本任务验收靶；SA3 **不得改动断言**，仅允许测试基础设施级修复如 hook/隔离——预期零改动）
- `packages/ws-replication/test/ws-replication-sa7-hardening-dynamic.test.ts` — `[SA6 owned]` 修改（约 6 行）：D4 wire `ping`/`firePong`/pong 监听类型回显忠实化（§8.1-1；**断言零改动**）
- `packages/ws-replication/test/ws-replication-sa7-round2-dynamic.test.ts` — `[SA6 owned]` 修改（约 4 行）：LivenessLogWire `ping`/`autoPong` 回显忠实化（§8.1-2；**断言零改动**）
- `wiki/raw/task_issue-170-ping-pong-epoch-safety_design.md` — 本设计文档（SA1 产出与后续 R 修订）

### DENY LIST

- `docs/protocols/instance-replication-v1.md` — 协议文档已是权威语义（§13.1 注册表封闭、§14 close 分类、§18 L524 pong 超时=1001 临时失败），本任务**实现向文档对齐**，不改文档、不登记新错误码
- `packages/replication-protocol/**` — codec/注册表不动（不注册 `PONG_TIMEOUT`；hub 超时零 ERROR 帧正是注册表封闭的推论）
- `packages/ws-replication/src/index.ts` — 公共导出面零改动（`startLiveness`/`LivenessDeps` 本就非导出成员）
- `packages/ws-replication/src/defaults.ts` / `validate.ts` — 配置缺省与校验零改动（`pongTimeoutMs < pingIntervalMs` 既有 TypeError 已覆盖 I1 前提）
- `packages/ws-replication/src/peer-namespace.ts` / `hub-namespace.ts` / `backpressure.ts` / `frame-io.ts` / `hub-connection.ts` 其余部分 — 控制器/背压/帧层/握手分类零改动
- `packages/ws-replication/test/ws-replication-review-revisions-r1-r7-red.test.ts` — wire 的 `firePong` 无调用点，零改动
- `packages/ws-replication/test/` 其余全部测试文件 — 不动（§8.2 逐类论证零影响）
- `packages/namespace-registry/**`、`packages/kvstore-sdk/**`、仓内其余包 — 与本缺陷无关

---

## §12. 协议假设依据 (Protocol Assumption Evidence)

| # | 假设 | 依据类型 | 依据内容（具体引用） | 风险 |
|---|---|---|---|---|
| A1 | WS pong 回显 ping 载荷，可作 ping↔pong 关联凭据；控制帧载荷 ≤ 125 字节（8 字节凭据合法） | 官方规范 | RFC 6455 §5.5（控制帧 ≤ 125 octets）、§5.5.2「A Pong frame sent in response to a Ping frame must echo identical Application data…Unsolicited Pong frames MAY be sent」（unsolicited pong 存在 → 必须凭载荷甄别，即 §4 strict 匹配的规范依据） | 低 |
| A2 | pong 载荷回显是本任务的验收契约 | 现有测试引用 + 任务契约 | `packages/ws-replication/test/ws-replication-issue170-r1-r4-red.test.ts`（fixture `ping` 记录载荷、autoPong `listener(payload)` 回显、`injectPeerPong` 任意载荷注入，:152-226）；任务简报「契约提示」节：「P1–P3 以『pong 回显 ping 载荷』为关联凭据……需按契约扩展 seam 透传 pong 载荷」 | 低 |
| A3 | hub pong 超时的正确语义 = close 1001 + 零 ERROR 帧 + 对端 backoff | 源码引用（仓内权威文档） | `docs/protocols/instance-replication-v1.md` L524（§18「pong 超时按临时失败处理：关闭传输（close code 1001）并经 backoff 重连」）、L336-352（§13.1 注册表 17 码无 liveness 码）、L387-388（§14 close 分类）、L42（§2 活性只走 WS 层）；`packages/replication-protocol/src/payloads.ts:310-315`（`encodeError` 对未注册码 throw——「发 PONG_TIMEOUT 帧」在现实现下即不可能上线，SA5 Evidence #2） | 低 |
| A4 | 已关 socket 上 `ping()` 抛 `WebSocket is not open`（timer 回调内未捕获 = 进程级异常） | 现有测试引用 + SA5 动态取证 | SA5 报告 R3 时间线（`throwPingWhenClosed` 模拟 + `Error: WebSocket is not open: readyState 3 (CLOSED)` 从 timer 回调传播）；SA6 red fixture `closedTransportPingErrors()`（test:158-162）按同一语义建模 | 低 |
| A5 | 虚拟时钟 `advanceBy(ms)` 按到期序执行回调、微任务帧经 `queueMicrotask` 投递（P4 窗口 [40s,90s) 判定成立） | 类比已有 job 验证 | `ws-replication-sa7-round2-dynamic.test.ts` D3（:648-668）与 review-revisions R4-2（:796-824）已用同构 scheduler/时间线断言同构窗口并长期绿；SA6 红灯 6 例在同 harness 上确定性复现 | 低 |
| A6 | 真实 ws adapter 的 `pong` 事件携带回显载荷 | 官方规范 + 缺面降级契约 | RFC 6455 §5.5.2（同 A1）；仓内无生产 adapter（grep `onPong`/`DuplexTransport` 全仓仅 ws-replication 及其测试；宿主 adapter 属切片 9 未落地）→ 以 §3 types.ts 契约注释约束未来实现：「无法透传载荷的 transport 不得暴露 onPong（缺面 → dormant）」 | 中（跨版本边界；以契约注释 + dormant 降级路径兜底） |

（无 HTTP 端点/端口占用/进程生命周期/第三方库默认行为类假设。）

---

## §13. 契约改动连锁审计 (Contract Change Caller Audit)

### 改动 1：`DuplexTransport.onPong` 监听器签名（公共导出类型，向后兼容拓宽）

| 成员 | 文件 | 改动前 | 改动后 |
|---|---|---|---|
| `DuplexTransport.onPong` | `packages/ws-replication/src/types.ts:63`（经 `index.ts:13` 导出） | `onPong?(listener: () => void): () => void` | `onPong?(listener: (payload?: Uint8Array) => void): () => void`（可选成员、可选参数——旧实现/旧监听器仍可赋值，method bivariance） |

**注册方（listener 传入点）**——全仓唯一监听器注册者是 liveness：

| 注册方 | 文件:行 | 是否同步回调 | 直接 try/catch | 顶层守卫 | 处置方案 |
|---|---|---|---|---|---|
| hub liveness | `liveness.ts`（经 `hub-connection.ts:260` 传入 `this.transport.onPong`） | 同步（pong 事件） | 监听器体为纯比较 + `timer.clearTimeout`，无 throw 面 | `stopped`/`pongHandle`/`outstanding` 三重早退 | §4 新监听器（载荷匹配才清） |
| peer liveness | `liveness.ts`（经 `peer-connection.ts:307` 传入 `transport.onPong`） | 同上 | 同上 | 同上 | 同上 |

**实现方（transport 侧 `onPong` 方法）**：

| 实现方 | 文件:行 | 形态 | 处置方案 |
|---|---|---|---|
| SA6 red fixture | `ws-replication-issue170-r1-r4-red.test.ts:62/172/220` | 已按新契约（payload 回显/注入） | 零改动（验收靶） |
| sa7-hardening D4 wire | `ws-replication-sa7-hardening-dynamic.test.ts:600` | 旧签名；`firePong()` 无载荷投递 | §8.1-1 回显忠实化（仅 wire 机制，断言不变） |
| round2 LivenessLogWire | `ws-replication-sa7-round2-dynamic.test.ts:508` | 旧签名；`autoPong` 无载荷投递 | §8.1-2 回显忠实化 |
| review-revisions wire | `ws-replication-review-revisions-r1-r7-red.test.ts:671` | 旧签名；`firePong` 无调用点 | 零改动 |
| 仓外宿主 adapter（切片 9，未落地） | — | 未知 | §3 契约注释立法：必须透传回显载荷，否则不得暴露 onPong（dormant 为唯一合法降级）；本仓无此 caller（grep 证据见 §12 A6） |

### 改动 2：`startLiveness`/`LivenessDeps`（**包内私有**——未从 `index.ts` 导出）

| 成员 | 文件 | 改动前 | 改动后 |
|---|---|---|---|
| `LivenessDeps.onPong` | `liveness.ts:15` | `(listener: () => void) => () => void` | `(listener: (payload?: Uint8Array) => void) => () => void` |
| `LivenessDeps.onPongTimeout` 语义 | `liveness.ts:17` | 仅 pong 超时触发 | pong 超时 **或** 已关传输 ping 抛错触发；回调前 liveness 已自停（JSDoc 扩注） |
| 行为：loop 超时后继续运转 | `liveness.ts:31-39` | 超时后 next-ping timer 存活（僵尸） | 超时即自停（清双 timer + 退订 pong 监听） |

**Caller**（唯二，均本仓）：

| Caller | 文件:行 | 回调内行为 | 守卫 | 处置 |
|---|---|---|---|---|
| hub | `hub-connection.ts:255-263` | 现走 `connectionFatal('PONG_TIMEOUT',1002)` | `connectionFatal` 的 `closedFlag` | 改走 `onLivenessLost()`（§5）——`closedFlag` 守卫沿用，ping 抛错竞速幂等 |
| peer | `peer-connection.ts:302-313` | 现走 `close(1001)+onTemporaryFailure`（无停活性/退订/epoch） | 无（缺陷） | §6.1 双凭据 + 同步收口栈；`stopping`/双凭据/`onTemporaryFailure` 状态守卫三层 |

### 改动 3：peer `onTemporaryFailure` 行为扩展（私有方法，签名不变）

| Caller | 文件:行 | 是否同步 | 直接 try/catch | 顶层守卫 | 处置方案 |
|---|---|---|---|---|---|
| `dialNow` catch（dial 抛错） | `peer-connection.ts:201` | 同步 | dial 有 try/catch | funnel：`stopping` + backoff/blocked 状态守卫 | 新顶部三件套幂等（旧传输通常已关；不关 = I5） |
| `armHello` timer（hello 超时） | `peer-connection.ts:665` | timer 回调 | 无需（纯状态迁移） | funnel 状态守卫 + timer 内 `handshaking` 判定 | 新三件套生效（无 liveness → 停活性 no-op；退订生效；**不关传输**——D5 登记项保持，E13） |
| `onClose`（远端非 1002/1008 关闭） | `peer-connection.ts:539` | close 监听回调内 | 无需 | `stopping`/stopped/backoff/blocked/draining 守卫（既有） | 新三件套修复该路径僵尸 liveness（§6.2 论证）；退订发生于 dispatch 中安全（E10） |
| `failConnectionBackpressure` | `peer-connection.ts:592` | 同步 | best-effort ERROR 有 try/catch（既有） | funnel 状态守卫 + 自身重入守卫 | 1011 关闭先发生，funnel 不关传输 → 关闭码不覆盖（§6.5） |
| pong 超时闭包 | `peer-connection.ts:308-311` → §6.1 | liveness timer 回调 | 无需（幂等栈） | `stopping` + 双凭据 + funnel 状态守卫 | 同步收口栈后进入 funnel（E11 幂等叠加） |

### 改动 4：hub pong 超时处理路径（wire 可观测行为变化，有意）

| 维度 | 消费方 | 现状 | 目标 | 审计 |
|---|---|---|---|---|
| close code 1002→1001 | peer `onClose`（`peer-connection.ts:535`） | 1002 → `enterBlocked` 终态 | 1001 → `onTemporaryFailure` → backoff 重拨 | 即 H1 验收（issue 范围明令）；1002 的其余来源（framing/sequence 等真协议错误）分类不变 |
| ERROR 帧尝试 | `encodeError`（`replication-protocol/src/payloads.ts:310-315`） | throw 被吞 | 零尝试 | codec 零改动；`connectionFatal` 其余 16 个注册码路径不变 |

**风险小结**：本次无「return→throw」「签名收窄」「同步变 async」类契约翻转；唯一公共面变化是可选成员的可选参数拓宽（§8.2 类型兼容论证），其行为面影响（strict 匹配下无载荷 pong 不再算应答）由 §8.1 两处 fixture 忠实化与 §3 契约注释承接，仓内无其他 caller（grep 证据：`onPong|\.ping\(|startLiveness` 全仓 58 处命中全部列于本节与 §8）。

---

## §14. 验收映射与验证命令

| Issue 验收标准 | 设计落点 | 验证 |
|---|---|---|
| 1. 旧连接 pong 超时在替换就绪后触发不影响新状态/序列/backoff/ns | I3 + §4 自停 + §6.1 双凭据 + §6.2/6.3 退订 | P4 末段（旧代 pong 注入零扰动）；E4 |
| 2. 超时→backoff 同步栈内旧 transport 关闭、旧监听/liveness 解绑 | G3 + §6.1 顺序（停活性→退订→close→epoch→backoff） | P4 红灯锚 1/2/3；I4 |
| 3. hub 超时 close code 与错误行为完全对齐协议文档 | §5（1001/`pong-timeout`、零 ERROR 帧、注册表封闭） | H1；§12 A3 逐条引用 |
| 4. 确定性测试覆盖迟到/重复/未请求/旧代 pong | SA6 red 文件 P1/P2/P3/P4 | §7 时间线推演 |
| 5. 重连后 hub 仅留新连接、数据收敛 | §5 `cleanupAll`→dropConnection + funnel 重拨 | H1/P4 末段；§8.2 R4-2 回归 |
| 6. typecheck / vitest --typecheck / git diff --check | §8.2 类型兼容 | `pnpm run typecheck`；`pnpm exec vitest run packages/ws-replication --typecheck`；`git diff --check` |
| 全量无回归 | §8 | `pnpm exec vitest run packages/ws-replication` → 161 passed（155 既有 + 6 红转绿） |

**SA3 实现顺序建议**（独立可验的四个提交单元）：① §3+§4（seam + liveness——P1/P2/P3 转绿，但 hub/peer 回调语义尚未换轨前 H1/P4/P5 仍红）→ ② §5（hub——H1 转绿）→ ③ §6.1/6.2（peer 临时失败栈——P4 转绿）→ ④ §6.3/6.4 + §8.1 两 fixture（P5 转绿 + 全量回归绿）。
