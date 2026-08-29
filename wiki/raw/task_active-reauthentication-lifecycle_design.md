# Design — Issue #175: 主动 reauthentication 生命周期

- Task type: Bug 修复（new-feature-defect：wire 契约要求的 reauth 生命周期只实现了接收侧一半）
- Worktree: `/home/wangjian/nomicore-fix-issue-175`（branch `fix/issue-175-on-fix-issue-138-on-docs-phase-5-websocket-`，HEAD `0df6583`）
- 设计输入：任务简报 `task_active-reauthentication-lifecycle.md`、SA5 分析 `20260830-bug-active-reauthentication-lifecycle.md`（根因表 5 缺陷点）、SA6 红灯套件 `packages/ws-replication/test/ws-replication-reauth-lifecycle-red.test.ts`（6 IT，2026-08-30 实测 6/6 red）+ `test/driver.ts` 冻结 seam 镜像（`HubReauthSeam`/`PeerAuthNotifySeam`/`BootOptions.tokenSource`）、SA8 相关决议（ADR-0010 条款 2/3/4/6/9、ADR-0008/0009 边界）、协议 `docs/protocols/instance-replication-v1.md` §6.3（L141-149）/§15.1（L435-442）/L450/L524。
- 本文档角色：SA3 实现蓝本 + SA2 破壁评审对象 + SA4 文件清单比对依据（§13）。

---

## §1. 根因与设计映射

SA5 根因（已复核源码确认，行号以 HEAD `0df6583` 为准）：

| # | 缺陷点（SA5） | 复核锚点 | 本设计对应 |
|---|---|---|---|
| 1 | `HubReplication` 冻结公共面无 reauth 事件 seam（AC1） | `src/types.ts:117-125` | §3 冻结契约扩展 `requestReauth` |
| 2 | Hub 唯一 GOAWAY 生产路径写死 `SERVER_SHUTTING_DOWN`、仅由整 Hub `close()` 触发、零 drain 窗（AC2/AC3） | `src/hub-connection.ts:217-227, 320-340` | §4 `beginReauth`：定向 `GOAWAY(REAUTH_REQUIRED, drain>0)` + deadline 1001 收口 |
| 3 | Peer blocked 类 GOAWAY 不武装 receiver 侧本地 elapsed deadline，wire 无限开放（AC4） | `src/peer-connection.ts:398-416, 655-674` | §6 `armBlockedDeadline`（§6.3 receiver 侧 deadline） |
| 4 | Peer 无 token/config 显式变化通知入口，恢复仅 `addTarget` 一条缝（AC5） | `src/peer-connection.ts:136-168, 696-718`；`src/types.ts:148-155` | §5 `notifyAuthChanged`（复用 `requestRebuild` 编排） |
| 5 | 零 Hub 主动 reauth / blocked 恢复 / 竞态动态测试（AC8） | `test/` 目录（SA6 已补 6 IT） | §8 AC 覆盖矩阵（SA6 红灯套件 + SA7 动态复验） |

AC6（幂等/竞态）与 AC7（零 token 暴露）不是独立缺陷点而是新 seam 的设计约束：AC6 复用既有幂等基件（`closedFlag` 早退、拷贝迭代、`requestRebuild` 的 `rebuildPending` 守卫），AC7 以 `authenticatedInstanceId` 为键 + 静态 close reason + GOAWAY 稳定安全码维持既有不变量（本包零日志面、零凭据字段帧）。

**设计三腿**（互相独立可分别评审）：

1. **Hub 主动侧**（§4）：`HubReplication.requestReauth(instanceIdentity)` → 按认证实例身份定位连接 → 每连接 `GOAWAY(REAUTH_REQUIRED, drainTimeoutMs = closeTimeoutMs)` 直发 + hub 侧 deadline timer → `close(1001, 'hub-reauth')`。协议 §6.3 L149「之后**发送方**以 WS 1001 关闭」的发送方义务。
2. **Peer 恢复缝**（§5）：`PeerReplication.notifyAuthChanged()` → 仅 blocked 态走既有 `requestRebuild` 编排（关旧 wire 1000 → deferTask → `dialNow` 读拨号闭包的当前凭据）。
3. **Peer receiver 侧 deadline**（§6）：blocked 类 GOAWAY（`drainTimeoutMs > 0`）接收时武装本地 elapsed deadline → 发送方 drain 窗内死亡时本端 `close(1001, 'blocked-deadline')` 自行收口。协议 §6.3 L141「接收时开始计算本地 elapsed deadline」的接收方义务；区别于既有 drain 类 `armDrainClose`（`peer-connection.ts:418-430`）只覆盖 `SERVER_RESTARTING` 分支。

---

## §2. 架构一致性与边界（ADR 合规）

- **ADR-0010 条款 2**（wire 契约 + 连接收口纪律）：GOAWAY 帧型/字段、1001 收口、断开即 close sessions/release Leases——本设计零新帧型、零新错误码、复用既有 `close()` 收口拓扑（teardown + quiesce + cleanupAll）。
- **ADR-0010 条款 3/4**：namespace 级撤销走既有 `revoke()`（channel 级，不关连接）；认证属连接级错误 → 整条连接 GOAWAY 收口。本设计不触碰 `revoke` 语义（SA5 R2 已证两者正交）。
- **ADR-0010 条款 5 / ADR-0008 修订节 5**：blocked/dialing 等连接态留在复制插件层（`PeerConnectionState`），零 Runtime status 扩形。
- **ADR-0010 条款 6**：token 不入日志/错误/wire。新 seam 以 `authenticatedInstanceId`（accept 分配期绑定的可信身份，`hub-connection.ts:255`）为键，绝不以 token 值为键；close reason 为静态字符串。
- **ADR-0010 条款 7 / ADR-0009 修订节 2**：reauth 收口复用「先关 session（`close()` → `quiesceConnection` + `cleanupAll` → channel `onConnectionClosed`）」既有次序；幂等与 Lease/Registry 既有幂等 close/release 同构。
- **ADR-0010 条款 9**：`instanceId` 文法 `^[a-z][a-z0-9-]{0,62}$`（accept 期已 `isValidInstanceId` 验证，`hub-connection.ts:178`）——`requestReauth` 的键空间即此身份。
- **CONTEXT.md 实例角色**：reauth 入口属 hub 角色能力（Hub 是静态星型的通信/管理点）；peer 侧通知缝属 peer 角色。零角色切换。
- **非目标**（不引入）：durable outbox、Runtime 公共事件订阅（ADR-0008 正文）、新配置 knob（drain 预算复用 `closeTimeoutMs`——见 §4.3）、协议文本修改。

---

## §3. 冻结契约扩展（`src/types.ts`）

SA6 已在任务简报 §SA6 红灯契约 + `test/driver.ts:86-94` 冻结镜像。实现后与正式类型**逐字段一致**：

```ts
export interface HubReplication {
  accept(transport: DuplexTransport, request?: HubUpgradeRequest): Promise<HubConnection | undefined>;
  readonly connections: readonly HubConnection[];
  revoke(instanceIdentity: string, namespaceId: string): Promise<void>;
  /** issue #175（AC1/AC2/AC3/AC6/AC7）：认证/授权 Adapter 主动 reauth 事件 seam——按
   *  认证实例身份定位连接（绝不以 token 值为键），对每个匹配连接发送
   *  GOAWAY(REAUTH_REQUIRED, drainTimeoutMs>0) 并按 drain/deadline 规则以 WS 1001 收口。
   *  未知实例/已收口连接 → 无副作用 resolve；重复调用幂等。 */
  requestReauth(instanceIdentity: string): Promise<void>;
  close(): Promise<void>;
}

export interface PeerReplication {
  start(): void;
  stop(): Promise<void>;
  addTarget(target: ReplicationTarget): void;
  removeTarget(namespaceId: string): Promise<void>;
  getConnectionState(): PeerConnectionState;
  getNamespaceState(namespaceId: string): PeerNamespaceState | undefined;
  /** issue #175（AC5）：token/config 显式变化通知缝——blocked 仅在明确变化后恢复拨号。 */
  notifyAuthChanged(): void;
}
```

- types.ts 头部「SA6 冻结，逐字段；实现不得增删改名」针对的是 #136/#138 时点的冻结面；本任务的 SA6 冻结契约（简报 §SA6 + driver 镜像）**明文要求**这两项扩展（「实现后与 `@nomicore/ws-replication` 正式类型逐字段一致」）——冻结基线随任务前移，非违约。
- `HubConnection` 公共面零变化（reauth 是 Hub 级 seam；连接级可观测面 = 既有 `state` 字段进入 `'draining'`，§15.2 FSM `ready → draining → closed` 的合法迁移）。
- `index.ts` 零变化（类型整包 re-export，`src/index.ts:19-32`）。
- 类型层测试 `ws-replication-api.test-d.ts` 用 `toMatchTypeOf`（结构超集匹配）——接口新增方法不破坏既有断言（已核对该文件全部 4 处 interface 断言）。
- **公共面扩展伴随包版本 patch bump（SA4 R1 F-1）**：`packages/ws-replication/package.json` version `0.1.2 → 0.1.3`（HG9：公共 API 面变更必须升版——本任务净增 `requestReauth`/`notifyAuthChanged` 两个公共方法；本仓任务级 patch 递增先例：doc-runtime `0.1.11`、namespace-registry `0.1.6`）。仅 version 字段一字段改动，其余字段冻结。

---

## §4. Hub 侧详细设计（`src/hub-connection.ts`）

### §4.1 `HubReplicationImpl.requestReauth`

```ts
async requestReauth(instanceIdentity: string): Promise<void> {
  if (this.closed) return;                              // hub 已停机：迟到请求零副作用（AC6；§4.6 close-先 序的设计期守卫）
  for (const connection of [...this.connectionList]) {  // 拷贝迭代——revoke :206 同款（发起途中连接可能收口）
    if (connection.authenticatedInstanceId !== instanceIdentity) continue; // 认证身份为权威键（AC3/AC7）
    connection.beginReauth();                           // 同步发起：GOAWAY 同步冲刷 + deadline 同步武装
  }
  return;                                               // resolve 语义 =「请求已受理」（§4.4）
}
```

- **键**：`authenticatedInstanceId`（accept 分配期由 verifyToken 绑定，`hub-connection.ts:191-193, 255`）。未知/畸形身份 → 匹配零连接 → 无副作用 resolve（合法降级，见 §9）。
- **多连接同身份**：全部匹配连接各自 `beginReauth()`（AC3「只影响所需连接」的正向半边——同身份多条连接都属于「所需」）。

### §4.2 `HubConnectionImpl.beginReauth`（新增，包内可见）

```ts
private reauthRequested = false;
private reauthDeadlineHandle: unknown | undefined;

/** issue #175 AC1/AC2/AC4：定向 reauth——GOAWAY(REAUTH_REQUIRED, drain>0) + deadline 后 1001 收口。
 *  幂等（reauthRequested）；迟到/竞态（closedFlag）零副作用；绝不携带凭据（AC7）。 */
beginReauth(): void {
  if (this.closedFlag || this.reauthRequested) return;
  this.reauthRequested = true;
  if (this.state === 'handshaking') {
    // GOAWAY-before-ACK 是协议伤害：peer handshaking 门对非 HELLO_ACK 帧判
    // CONNECTION_POLICY_VIOLATION（peer-connection.ts:277-279）——镜像 shutdownWithGoaway
    // 的 handshaking 分支（hub-connection.ts:320-329）：不发 GOAWAY，直接 close(1001)。
    // 该连接同样是匹配身份的连接（其 Upgrade 已用待轮换凭据认证），关闭 = 正确的 reauth 语义。
    this.close(1001, 'hub-reauth');
    return;
  }
  this.state = 'draining';                              // §15.2 FSM；现有 namespace 到 deadline 前自然收口（§6.3 L148）
  try {
    this.outbound.sendControl({                         // §4.3 收口路径直发豁免（见 §4.5）
      kind: 'GOAWAY',
      reasonCode: 'REAUTH_REQUIRED',                    // 稳定安全码，零凭据字段（AC7；§5 消息注册表 0x03 既有帧型）
      drainTimeoutMs: this.hub.timeouts.closeTimeoutMs, // drain 预算载体（§4.3）
    });
  } catch {
    this.close(1001, 'hub-reauth');                     // framing 不可信 → fail-closed 直接收口（:336-338 同款）
    return;
  }
  this.reauthDeadlineHandle = this.hub.timer.setTimeout(() => {  // §6.3 L149「之后发送方以 WS 1001 关闭」
    this.reauthDeadlineHandle = undefined;
    if (this.closedFlag) return;                        // transport 断/hub.close 已收口 → stale fire 零副作用
    this.close(1001, 'hub-reauth');                     // 既有收口拓扑：teardown + quiesce + close + cleanupAll + drop
  }, this.hub.timeouts.closeTimeoutMs);
}
```

`cleanupAll()` 同步段头部追加（覆盖 `close()`/`onTransportClosed()`/`connectionFatal()`/`onSequenceExhausted()` 全部收口路径，§8.1 timer 纪律「句柄必须可清」）：

```ts
private async cleanupAll(): Promise<void> {
  if (this.reauthDeadlineHandle !== undefined) {
    this.hub.timer.clearTimeout(this.reauthDeadlineHandle);
    this.reauthDeadlineHandle = undefined;
  }
  // ……既有体不变（quiesce / stopLiveness / splice 订阅 / channel cleanups / dropConnection）……
}
```

### §4.3 drain 预算 = `timeouts.closeTimeoutMs`（零新 knob）

- **先例**：`HubReplicationImpl.close()` 把 `timeouts.closeTimeoutMs` 作为 `shutdownWithGoaway(drainMs)` 的 drain 值（`hub-connection.ts:221`）。`closeTimeoutMs` 即「连接收口预算」的既有载体。
- **>0 结构保证**：`validateTimeouts` 对 `closeTimeoutMs` 施加 positiveSafeInteger（`validate.ts:166`）——冻结契约「drainTimeoutMs>0」由构造期验证保证，运行时零 clamp（§17 纪律）。
- **红灯套件算术确认**：IT1/IT2/IT5/IT6 以 `closeTimeoutMs: 60` boot，随后 `advanceBy(goaway.drainTimeoutMs)` 即期收口——drain 值必须恰等于 `closeTimeoutMs`。
- **与 `hub.close()` 的语义区别**（AC4）：`shutdownWithGoaway` 发帧后**立即** `close(1001)`（零实际 drain 窗——停机不等 drain）；`beginReauth` 发帧后**真正等待 drain 窗**再收口。这正是 IT1 红灯锚 2（`hubSideClosed === false && peerSideClosed === false` during window）所要求的差异。

### §4.4 resolve 语义 =「请求已受理」，不等 drain 结算

`requestReauth` 在 GOAWAY 同步冲刷 + deadline 同步武装后即 resolve。依据：

1. **红灯套件时序**：IT1/IT5 在**未推进 hub 时钟**的情况下 `await callReauth(...)` 并期待 resolved（`red.test.ts:203, 380-382, 394`）——若 await drain 结算（drain 挂在 hub scheduler 上），promise 永不 resolve（vitest 超时）。
2. **语义对称**：`accept()` resolve 于分配完成（不等 HELLO）；`revoke()` await 的是 channel 终止的**真实异步尾**；reauth 的全部动作（sendControl 同步、timer 武装同步）没有可 await 的异步尾——`Promise<void>` 签名纯粹是 seam 的调用方人体工学（与 `revoke`/`close` 同族）。

### §4.5 背压豁免（直发 `outbound.sendControl`）

与 `shutdownWithGoaway`（`hub-connection.ts:330-338`）/`connectionFatal`（:558-565）同一豁免家族：连接生命周期控制帧不允许被 data 背压额度否决。经 `outbound.sendControl` 直发仍走 `emitOne` 的序列分配与 `onEmitted` 记账（`frame-io.ts:126-129, 147-160`）——序列纪律不变。若背压已耗尽到 fatal 程度，连接早已 `connectionFatal` 收口，`closedFlag` 守卫先行拦截。

### §4.6 与 `hub.close()` 的竞态（AC6，IT5 变体二）

| 序 | 行为 |
|---|---|
| reauth 先（IT5 变体二的字面序：`callReauth` 同步前缀先跑） | REAUTH GOAWAY 已发 + deadline 已武装 → `close()` 迭代到该连接 → `shutdownWithGoaway` 再发 SHUTTING_DOWN GOAWAY + 立即 `close(1001)` → `cleanupAll` **清除 reauth deadline**（§4.2 追加）→ 零 stale fire。peer 侧：第一条 GOAWAY 使其 blocked（`onClose` blocked 早退 `peer-connection.ts:555`），第二条 GOAWAY 被 `onMessage` 状态门丢弃（:255），close(1001) 到达后保持 blocked → `peerSideCloseInfo.code === 1001` ✓ |
| close 先 | `requestReauth` 的 `this.closed` 早退（或逐连接 `closedFlag` 守卫）→ 无副作用 resolve |

双序均：两个 promise 都 resolve、零 throw（§12 无 unhandled rejection 论证）。

---

## §5. Peer 恢复缝：`notifyAuthChanged`（`src/peer-connection.ts`）

```ts
/** issue #175 AC5：token/config 显式变化通知缝。仅 blocked 是恢复语义的合法入口：
 *  - backoff：下一次 dial 本就读取拨号闭包的当前凭据（token 轮换自动生效，无需通知）；
 *  - ready/handshaking/connecting：无「待恢复」事实；
 *  - disconnected（重建编排进行中）：requestRebuild 已排队，rebuildPending 幂等守卫兜底；
 *  - stopped：恢复入口是 start()（生命周期语义，非凭据语义）。 */
notifyAuthChanged(): void {
  if (this.stopping) return;
  if (this.connStateValue !== 'blocked') return;
  this.requestRebuild('auth-change');   // 既有编排（:696-718）：关旧 wire(1000,'replication-rebuild')
}                                       // → deferTask → dialNow（dial 闭包读 tokenSource 当前值）
```

- **复用而非新建编排**：`requestRebuild` 已承载 `addTarget` 的 config-change 重建（`peer-connection.ts:140-146`）——关旧 wire(1000) → 控制器投影 disconnected → `deferTask` → `dialNow`（新代际、新凭据、`goawayActive` 复位）。AC5 冻结契约明文「自 blocked 走 rebuild 编排」。
- **幂等**：`requestRebuild` 的 `rebuildPending` 守卫（:698）+ 本方法的 blocked 门——重复通知/通知与 addTarget 交叠均收敛为一次重建。
- **reason 字串**：`requestRebuild(reason)` 现实现 `void reason`（:697，观测占位）——取 `'auth-change'` 以区分来源；无行为差异。
- **停止态**：`stopping` 早退（stop 已收口一切，迟到通知零副作用）。

---

## §6. Peer receiver 侧 deadline：`armBlockedDeadline`（SA5 根因 #3 / AC4）

### §6.1 触发点（`onGoaway` blocked 分支改造）

```ts
private onGoaway(message: { reasonCode: string; drainTimeoutMs: number; retryAfterMs?: number }): void {
  this.goawayActive = true;
  this.goawayDrainMs = message.drainTimeoutMs;
  this.goawayRetryAfterMs = message.retryAfterMs;
  if (message.reasonCode === 'SERVER_SHUTTING_DOWN' || message.reasonCode === 'REAUTH_REQUIRED') {
    this.enterBlocked();                                 // 既有：清 timer、teardown、outbound.clear、控制器 disconnected
    if (this.goawayDrainMs > 0) this.armBlockedDeadline(); // ★ 新增：§6.3 receiver 侧本地 elapsed deadline
    return;
  }
  this.setState('draining');                             // drain 类（SERVER_RESTARTING/未知非永久类）——既有路径不变
  this.armDrainClose();
}
```

- **武装顺序**：必须在 `enterBlocked()` **之后**（`enterBlocked` 首行动作是 `clearDrainClose()`，`peer-connection.ts:657`——先武装会被清掉）。
- **覆盖面**：blocked 类两个 reasonCode 都武装（`SERVER_SHUTTING_DOWN` 与 `REAUTH_REQUIRED`）。依据：§6.3 L141 的 deadline 规则对 GOAWAY **不区分 reason**（「收到 GOAWAY 后……之后发送方以 WS 1001 关闭」）；§15.1 只区分 deadline 关闭**后的重连调度**（blocked vs backoff），不区分 wire 生命周期；SA5 根因 #3 表述亦为「blocked 类」。SA5 R3 证据（10×deadline 仍开放）正是 REAUTH 形态。若 SA2 裁决收窄到 REAUTH-only，改动是一行条件（登记为 fallback，不影响其余设计）。
- **drain=0 不武装**：见 §6.3。

### §6.2 实现

```ts
/** issue #175 AC4（SA5 根因 #3 / §6.3 L141）：blocked 类 GOAWAY 的 receiver 侧本地 elapsed
 *  deadline——发送方（hub reauth/停机）在 drain 窗内死亡、或帧为注入形态（无发送方收口方）时，
 *  wire 不无限开放：deadline 到 → 本端 close(1001)。仅处置 transport 收口：控制器/出站队列/
 *  全部 timer 已由 enterBlocked 统一收口，此处重复处置反而引入双重 quiesce 风险。 */
private armBlockedDeadline(): void {
  this.clearDrainClose();
  const transport = this.transport;
  this.drainCloseHandle = this.options.timer.setTimeout(() => {
    this.drainCloseHandle = undefined;
    if (this.connStateValue !== 'blocked') return;       // rebuild/stop/dialNow 已接管旧 transport → 零副作用
    if (transport !== undefined && !transport.closed) {
      transport.close(1001, 'blocked-deadline');         // 静态 reason，零凭据（AC7）
    }
  }, this.goawayDrainMs);
}
```

- **复用 `drainCloseHandle` 字段**（`peer-connection.ts:457`）：`stop()`（:116）、`dialNow()`（:189）既有清除点白得覆盖；`requestRebuild` 追加清除（§6.4）。§8.1 timer 纪律「句柄必须可清——stale fire 零副作用」双重满足：清句柄（主）+ 回调状态守卫（辅）。
- **close code 1001**：IT3 冻结锚（`hubSideCloseInfo?.code === 1001`，red.test.ts:313）+ 「going away」语义。peer 保持 blocked：本端 close 在 fake transport 不自通知（harness.ts:585-591 仅通知对端），真实 WS 的本地 close 事件进入 `onClose` 后被 blocked 早退吸收（:555）——两形态同终态（IT3 后续 10×deadline 断言：blocked、dialCount 1）。

### §6.3 `drainTimeoutMs === 0` 不武装（load-bearing 决策）

D5 变体 B1（`ws-replication-sa7-issue137-dynamic.test.ts:583-637`）注入 `GOAWAY(SERVER_SHUTTING_DOWN, drainTimeoutMs: 0)` 后断言：

1. blocked 后 `scheduler.pending() < pausedPending`（poll timer 清除后**不得有新增 timer** 顶回计面）；
2. `advanceBy(60_000)` 后 `pending <= pausedPending` 且 wire 冻结（零新帧）。

若 0 值也武装，pending 恰好 +1 回到 `pausedPending`，断言 1 失败。因此 **0 = 「无 drain 预算信息」→ 不武装本地 deadline，保持既有 wire 冻结语义（等待宿主）**。这不是静默降级：0 是合法 wire 值（varUint），其语义由冻结绿测试钉死；生产 Hub 的两条 GOAWAY 生产路径恒发 `closeTimeoutMs > 0`（构造期验证）。drain 类（RESTARTING）既有 `armDrainClose` 对 0 值的行为不变（不在本任务半径）。

### §6.4 `requestRebuild` 追加清除（一行）

```ts
private requestRebuild(reason: string): void {
  void reason;
  if (this.rebuildPending) return;
  this.rebuildPending = true;
  this.clearHello();
  this.clearReset();
  this.clearBackoff();
  this.clearDrainClose();   // ★ 新增：重建 = 旧连接终结（dialNow :189 同款理由）。
                            // 语义保护主体是 §6.2 的状态守卫（重建后 state=disconnected → 回调 no-op）；
                            // 此处清句柄是 §8.1 矩阵卫生（杜绝「守卫兜底」成为唯一防线）。
  ...
}
```

消除的窗口：`requestRebuild`（同步关旧 wire、置 disconnected）与 deferTask 放行的 `dialNow` 之间，blocked deadline 若 fire，旧 transport 已被 rebuild 以 1000 关闭（`transport.closed` → 跳过）——有守卫时零副作用，无守卫时是双重收口噪声。清句柄使窗口不存在。

### §6.5 与 drain 类 deadline（`armDrainClose`）的关系

| | `armDrainClose`（既有，drain 类） | `armBlockedDeadline`（新增，blocked 类） |
|---|---|---|
| 前置状态 | `draining` | `blocked`（`enterBlocked` 已收口控制器/出站/timer） |
| fire 动作 | `quiesceControllers()` + `sender.teardown()` + `close(1001,'goaway-drain')` | 仅 `close(1001,'blocked-deadline')`（其余已由 enterBlocked 完成） |
| fire 后出口 | `onClose` → `onGoawayClosed`（hint 重连 / backoff） | 保持 blocked（`onClose` :555 早退；状态守卫） |
| 句柄字段 | `drainCloseHandle` | `drainCloseHandle`（互斥使用——同一连接同一时刻至多一个 GOAWAY 生效；第二帧被 `onMessage` 状态门 :255 拦截） |

互斥性论证：blocked 类先到 → blocked（后续帧丢弃）；drain 类先到 → draining（后续帧丢弃）。两 deadline 不共存。

---

## §7. 竞态与幂等矩阵（AC6 全集）

| # | 场景 | 保护 | 红灯锚 |
|---|---|---|---|
| 1 | `requestReauth` ×3 同身份 | `reauthRequested` 连接级 flag | IT5-1：恰 1 GOAWAY |
| 2 | 收口后迟到 `requestReauth` | 连接已 drop（`cleanupAll → dropConnection`）无匹配；未 drop 时 `closedFlag` 守卫 | IT5-1 尾：仍 1 GOAWAY |
| 3 | `requestReauth` ↔ `hub.close()` 背靠背（双序） | §4.6；`cleanupAll` 清 reauth deadline | IT5-2：双 resolve + 60s+ 残响零副作用 + `peerSideCloseInfo.code===1001` |
| 4 | 连接消失后迟到 `requestReauth` | 拷贝迭代 + 无匹配 | IT5-3：0 GOAWAY |
| 5 | hub reauth deadline ↔ transport 先断 | `onTransportClosed → cleanupAll` 清句柄；即使 stale fire 也有 `closedFlag` 守卫 | —（设计期推演） |
| 6 | peer blocked deadline ↔ `notifyAuthChanged` 重建（双序） | §6.4 清句柄 + 状态守卫（≠blocked → no-op） | IT4 主体（缺陷锚另见 §10.1） |
| 7 | peer blocked deadline ↔ `stop()` | `stop` 既有 `clearDrainClose()`（:116）+ 状态守卫 | —（设计期推演） |
| 8 | peer 双 GOAWAY（blocked 后迟到帧） | `onMessage` 状态门 :255 | 既有行为 |
| 9 | hub reauth 落在 peer draining（drain 类已收） | peer 状态门丢弃该帧；hub 侧 deadline 照常收口 wire | —（设计期推演；§6.5 互斥） |
| 10 | `requestReauth` 落在 handshaking 连接 | §4.2 handshaking 分支直接 `close(1001)`（零 GOAWAY） | —（协议伤害规避，:320-329 镜像） |

**零 unhandled rejection 论证**：`requestReauth` 全路径无 throw（`sendControl` 包 try/catch；timer map 操作同步不抛；循环体无 await 外部回调）；`notifyAuthChanged` 同步无 throw；两个 deadline 回调只调用 `close()`/`transport.close()`（同步、既有路径）。IT1-IT6 均挂 `collectUnhandledRejections` 探针。

---

## §8. AC 覆盖矩阵

| AC | 设计节 | 红灯 IT | 备注 |
|---|---|---|---|
| 1 seam 窄而明确 | §3/§4.1 | IT1/IT2/IT5/IT6（TypeError 锚） | Hub 级单方法；身份为键 |
| 2 定向 GOAWAY(REAUTH_REQUIRED) | §4.2 | IT1（恰 1 帧、drain>0）/IT2 | 直发豁免 §4.5 |
| 3 只影响所需连接 | §4.1 键匹配 | IT2（alpha 零 GOAWAY、ready/live、wire 开放；未知实例 no-op） | ADR-0010 条款 3 正交（revoke 不动） |
| 4 drain/deadline 规则 1001 收口 | §4.3/§4.2/§6 | IT1（发送侧）/IT3（接收侧） | 与 hub.close 零窗区别：IT1 红灯锚 2 |
| 5 blocked + 明确变化后恢复 | §5/§6.2（blocked 保持） | IT4 | 零通知 60s 零重拨（IT1/IT3/IT4 前半） |
| 6 重复/迟到/竞态幂等 | §7 全表 | IT5（三变体） | 零 unhandled rejection |
| 7 零 token 暴露 | §4.2 静态 reason/身份键；§6.2 静态 reason | IT6 | 帧字节 + 双侧 close reason 扫描 |
| 8 动态测试 | 本设计 = 其实现蓝本 | SA6 红灯套件（6 IT）+ SA7 动态复验 | §10 两锚点缺陷需 SA6 修正后方可全绿 |

---

## §9. 「拒绝虚假降级」自检（2026-05-07 立法）

| 条件 | 判定 | 依据 |
|---|---|---|
| `requestReauth(未知/畸形身份)` → 无副作用 resolve | **合法降级**（非上游缺陷） | 身份键查询语义；与断线天然竞态（身份刚消失）；冻结契约明文「未知实例/已收口连接 → 无副作用 resolve」+ IT2/IT5 锚 |
| `notifyAuthChanged` 非 blocked 态 → no-op | **合法降级** | 无「待恢复」事实（§5 注释列各状态理由）；backoff 重拨自动携带新凭据 |
| `drainTimeoutMs === 0` → 不武装 blocked deadline | **合法降级**（语义钉死） | §6.3：D5-B1 冻结语义 + 生产路径恒 >0（构造期验证） |
| GOAWAY 发送失败（framing 不可信）→ `close(1001)` | **fail-closed 收口**（非静默吞） | §4.2 catch 分支；绝不让失效凭据连接静默续命 |
| `beginReauth` 落在 handshaking → close(1001)（不发 GOAWAY） | **响亮处理**（协议伤害规避） | §4.2；peer :277-279 会把 GOAWAY-before-ACK 判 fatal |

---

## §10. 🚨 冻结红灯套件两处锚点缺陷报告（SA6-owned 修正建议）

> 设计期逐条推演 6 个 IT 的虚拟时钟算术与 harness 语义时发现：**IT4 与 IT6 各有一处断言在任何满足 IT1/IT3/AC4 的设计下不可满足**。以下给出完整证据链与最小修正建议。SA1/SA3 不触碰测试文件（§13）；修正属 SA6 职权，请总控裁决流转。

### §10.1 IT4 L358：`expect(run.wires[0]!.hubSideCloseInfo?.code).toBe(1000)` 不可满足

**时钟算术**：

1. L341 注入 `GOAWAY(REAUTH_REQUIRED, drainTimeoutMs: 5_000)` → peer blocked +（本设计 §6）receiver deadline 武装于 peer 时钟 t+5000。
2. L346 `advanceMs(run, 60_000)` 推进 **peer** scheduler（`driver.ts:590-593`）→ fake scheduler 触发一切 `at <= deadline` 的 timer（`namespace-registry/src/testing.ts:92-107`）→ deadline **必然 fire** → 旧 wire 以 `{code:1001, reason:'blocked-deadline'}` 关闭（peer 端发起）。
3. makeEnd.close 幂等（`harness.ts:586`：`if (self.closed) return`）→ L353 通知触发的 `requestRebuild` 内 `transport.close(1000)` 成为 no-op → hub 端观测值 = **1001**，断言期待 **1000** → 失败。

**不可满足性**（任意设计，不限本设计）：IT3 要求 f(60) ≤ 60（L310-312：advance 恰 60 后 peerSideClosed true + hub 观测 1001）；IT4 要求 f(5000) > 60000（60s 大步时钟后旧 wire 仍开放，rebuild 的 1000 才是首个 peer 端 close）。两测试的 closeTimeoutMs 相同（5000）、连接状态史相同、注入帧型相同——唯一变量 drainTimeoutMs 不存在连续/成比例函数同时满足两界。**唯一能区分二者的输入是 drain 数值本身，任何以数值阈值分支的设计（如「drain < closeTimeout 才武装」）都是为迁就断言的 numerology，非语义。**

**根因**：IT4 的 L358 锚定「rebuild 关闭语义(1000)」时沿用了 blocked 期间 wire 无限开放的**修复前**心智模型，与 IT3（修复后模型）在同套件内冲突。SA6 红灯执行时 IT4 在 L353（notifyAuthChanged TypeError）先红，后续断言从未被执行，冲突未被暴露。

**最小修正建议（SA6）**：L341 的 `drainTimeoutMs: 5_000` → `300_000`（> L346 的 60_000 窗口）。语义零损失：「blocked 无通知零重拨（60s 时钟）」窗口完整保留且完全落在 deadline 之前；rebuild 的 1000 关闭重新成为旧 wire 首个 peer 端 close；IT4 的恢复链断言（dial 2 / verifyCalls / live / 收敛 / 零 token 泄漏）全部保持原值。

### §10.2 IT6 L438：`expect(run.wire.hubSideCloseInfo?.reason.includes(TEST_TOKEN)).toBe(false)` 不可满足

**机制链**：

1. `hubSideCloseInfo` 仅由 hub 端 wrapper 拦截器记录（`harness.ts:695-699`），该拦截器只在 **peer 端发起的 close**（`pair.left.close` 通知 right 端监听者，`harness.ts:585-591`）时触发。
2. IT6 只推进 **hub** 时钟（L431 `run.hubNode.scheduler.advanceBy(...)`）；peer 时钟全程冻结 → peer 侧 blocked deadline（§6）永不满期 → peer 端唯一可能的 close 触发点不存在。
3. hub deadline → `this.close(1001)` → `cleanupAll()` **同步段** splice 掉 transport 订阅（`hub-connection.ts:548`，async 函数体在首个 await 前同步执行）——早于 makeEnd `queueMicrotask` 投递的 close 通知到达 peer（`harness.ts:587-590`）。此后即使 peer 补发本端 close，right 端监听者已空，`hubSideCloseInfo` 永为 `undefined`。
4. `undefined?.reason.includes(TEST_TOKEN)` 经可选链短路求值为 `undefined` → `expect(undefined).toBe(false)` 失败。

**不可满足性**：在保持（a）drain 窗内 wire 开放（IT1 L218-219、IT3 前半的冻结锚）与（b）hub 收口既有的同步清理拓扑（改动它 = 为单个误模断言重排全 Hub 收口次序，fake/生产语义分叉）的前提下，无设计可使该断言非 undefined。**根因**：SA6 误以为 hub 主动 close 会记录在 hub 侧观测变量（harness 的 close 观测是「对端观测」语义，`harness.ts:601` 注释明示「一端 close → 对端 onClose」）。

**最小修正建议（SA6）**：删除 L438（AC7 已由 L435 全 wire 字节扫描 + L437 `peerSideCloseInfo`（hub 主动 close 的实际观测侧）reason 扫描完整覆盖），或改为注释说明 hub 侧观测变量在该形态下恒 undefined。

### §10.3 对交付的影响面

- 本设计使 IT1/IT2/IT3/IT5 全绿、IT4/IT6 各差上述单条断言（其余断言全绿）。
- 若总控裁决「测试不可改」：唯一替代路径是放弃 receiver 侧 deadline（IT3/AC4/SA5#3 违约）或按数值阈值分支（§10.1 已驳斥）——两者都违反更高层契约，故 **SA6 一行/两行修正是唯一自洽路径**。设计在此显式申报，不静默绕过。

---

## §11. 协议假设依据 (Protocol Assumption Evidence)

| # | 假设 | 依据类型 | 依据内容（具体引用） | 风险 |
|---|---|---|---|---|
| 1 | `outbound.sendControl` 直发 GOAWAY 不被背压否决、同步冲刷 | 源码引用 | `hub-connection.ts:330-338`（shutdownWithGoaway 同款直发 + 注释「停机帧不允许被背压额度否决」）；`frame-io.ts:126-129`（sendControl 同步 drain） | 低 |
| 2 | `closeTimeoutMs` 可作 drain 预算且恒 >0 | 源码引用 + 现有测试引用 | `hub-connection.ts:221`（close() 先例）；`validate.ts:166`（positiveSafeInteger）；`defaults.ts:38`（5000）；红灯 IT1/IT5 以 `closeTimeoutMs:60` boot 后 `advanceBy(goaway.drainTimeoutMs)` 即收口的算术 | 低 |
| 3 | fake wire「一端 close → 对端 onClose」且幂等（首个 close 决定观测码） | 源码引用 | `harness.ts:576-599`（makeEnd）、`:586`（`if (self.closed) return`）、`:634-743`（makeWire 双端 wrapper 记录 peer/hubSideCloseInfo） | 低 |
| 4 | fake scheduler `advanceBy` 触发一切 `at <= deadline` 的 timer | 源码引用 | `namespace-registry/src/testing.ts:92-107`（due 过滤 + 到期序逐个 fire） | 低 |
| 5 | peer `onClose` 在 blocked 态早退、blocked 语义在收口后保持 | 源码引用 + 现有测试引用 | `peer-connection.ts:555`；`ws-replication-sa7-dynamic.test.ts:218-224`（G2：SHUTTING_DOWN → blocked，wire 冻结）；IT3 后续 10×deadline 断言 | 低 |
| 6 | handshaking 期收到非 HELLO_ACK 帧 → peer 判 CONNECTION_POLICY_VIOLATION（GOAWAY-before-ACK 有害） | 源码引用 | `peer-connection.ts:272-279`；`hub-connection.ts:320-329` 既有注释同结论 | 低 |
| 7 | GOAWAY 帧型/字段无需 codec 变更即支持 REAUTH_REQUIRED | 源码引用 + 现有测试引用 | 消息注册表 0x03 既有（protocol §5）；peer 接收分类已实现（`peer-connection.ts:404`）；红测 IT1 直接断言解码出的 reasonCode | 低 |
| 8 | hub 各收口路径都汇聚 `cleanupAll`（deadline 句柄单点清理成立） | 源码引用 | `hub-connection.ts:308-318`（close）、`:536-542`（onTransportClosed）、`:544-553`（cleanupAll 本体）、`:555-573`（connectionFatal）、`:607-616`（onSequenceExhausted） | 低 |
| 9 |（设计期实测）红灯套件现状 6/6 red、既有绿套件 19/19 | 设计期实测验证 | 任务简报 §红灯验证结果（2026-08-30，命令 + 逐 IT 红灯消息在案） | 低 |

无未列出的协议级假设：本设计不新增端点/端口/进程生命周期/第三方库行为假设（纯包内状态机 + 既有注入 seam）。

---

## §12. 契约改动连锁审计 (Contract Change Caller Audit)

### 改动函数

| 函数/接口 | 文件 | 改动前契约 | 改动后契约 |
|---|---|---|---|
| `HubReplication`（接口） | `src/types.ts:117-125` | accept/connections/revoke/close | **新增** `requestReauth(instanceIdentity: string): Promise<void>`（纯新增，既有四成员零变化） |
| `PeerReplication`（接口） | `src/types.ts:148-155` | start/stop/addTarget/removeTarget/getConnectionState/getNamespaceState | **新增** `notifyAuthChanged(): void`（纯新增） |
| `HubConnectionImpl.beginReauth` | `src/hub-connection.ts` | （不存在） | 新增包内方法；不进 `HubConnection` 公共接口 |
| `PeerConnectionImpl.armBlockedDeadline` | `src/peer-connection.ts` | （不存在） | 新增私有方法 |
| `onGoaway`（私有） | `src/peer-connection.ts:398-416` | blocked 类：仅 `enterBlocked()` | blocked 类：`enterBlocked()` + drain>0 时武装 deadline（行为增强，签名不变） |
| `requestRebuild`（私有） | `src/peer-connection.ts:696-718` | 清 hello/reset/backoff | 追加清 drainClose（行为增强，签名不变） |
| `cleanupAll`（私有） | `src/hub-connection.ts:544-553` | channel 清理 + 订阅摘除 | 头部追加清 reauth deadline（行为增强，签名不变） |

**无既有函数契约变更**（无 return→throw、无同步变异步、无 catch swallow→rethrow、无可空性翻转）。公共面为两个**新增**方法——对既有 caller 順零连锁。

### Caller 清单（新增方法 + 被增强私有方法）

| Caller | 文件:行号 | 是否 await | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---|---|---|---|---|
| `HubReauthSeam.requestReauth` 唯一生产 caller = 认证/授权 Adapter（组合根，切片 9 未建） | 仓内零命中（`git grep` 全 repo：仅 `test/driver.ts` 镜像 + 红测 cast 调用） | 调用方自定 | 调用方自定 | 调用方自定 | seam 永不 reject（§7 零 throw 论证）——调用方无需防御性 catch |
| `PeerAuthNotifySeam.notifyAuthChanged` 唯一生产 caller = 宿主凭据轮换点 | 仓内零命中（同上） | 同步 void | — | — | 同步零 throw |
| `dispatchReady` → `onGoaway` | `peer-connection.ts:375-377` | 否（同步） | 外层无 | 无 | 增强仅追加武装动作；异常面不变（timer 同步 map 操作） |
| `addTarget` ×2 → `requestRebuild` | `peer-connection.ts:145, 165` | 否 | 无 | 无 | 既有路径；新增 clearDrainClose 为幂等清理，零异常面 |
| `notifyAuthChanged` → `requestRebuild`（新） | §5 | 否 | 无 | 无 | 同上 |
| `close`/`onTransportClosed`/`connectionFatal`/`onSequenceExhausted` → `cleanupAll` | `hub-connection.ts:317, 541, 572, 615` | fire-and-forget（`void`） | 无 | 无 | 头部新增清理为同步幂等，零异常面 |
| 接口实现者 | `HubReplicationImpl` / `PeerConnectionImpl`（全 repo 唯二实现，外部零 `implements` 命中） | — | — | — | 两实现同 PR 补齐新成员；`api.test-d.ts` 的 `toMatchTypeOf` 为结构超集匹配，新增成员不破坏 |

抓全方法（复核）：`git grep -n "implements HubReplication\|implements PeerReplication" -- 'apps/**/*.ts' 'packages/**/*.ts' 'domains/**/*.ts'` → 仅本包两实现；外部消费（apps/domains）零命中。

### 风险评估

- 遗漏 caller 的代价：接口新增成员若实现者未补齐 → TS 编译失败（构造期响亮，非运行时）。仓内实现者唯一且同 PR 修改——编译即验证。
- 私有方法增强的 caller 全部在包内、全部同步调用、零新增 throw 路径 → 无 unhandledRejection 新面。

---

## §13. 文件清单（File Scope）

### ALLOW LIST

- `packages/ws-replication/src/types.ts` — 修改，§3 两个接口各追加一个方法（≈10 行，含注释）。
- `packages/ws-replication/src/hub-connection.ts` — 修改，§4：`requestReauth`（HubReplicationImpl）+ `beginReauth`/`reauthRequested`/`reauthDeadlineHandle` + `cleanupAll` 头部清理（≈45 行）。
- `packages/ws-replication/src/peer-connection.ts` — 修改，§5/§6：`notifyAuthChanged` + `onGoaway` blocked 分支一行 + `armBlockedDeadline` + `requestRebuild` 一行清理（≈35 行）。
- `packages/ws-replication/package.json` —（SA4 R1 F-1 修订追加）修改，**仅** version patch bump `0.1.2 → 0.1.3`（1 行；理由见 §3 末条：HG9 公共 API 面变更强制升版 + 本包 patch 递增先例）。**不得**触碰其余任何字段（scripts/exports/dependencies 冻结）。
- `packages/ws-replication/test/ws-replication-reauth-lifecycle-red.test.ts` — `[SA6 owned]` 验收红灯套件。仅允许 SA6 按 §10 缺陷报告修正两处锚点（IT4 L341 drain 值 / IT6 L438 删除）；SA1/SA3 不得触碰断言逻辑。
- `packages/ws-replication/test/driver.ts` — `[SA6 owned]` 冻结 seam 镜像已含 `HubReauthSeam`/`PeerAuthNotifySeam`/`tokenSource`，**预期零改动**；若 SA6 修正波及镜像则同权限。

### DENY LIST

- `packages/ws-replication/src/hub-namespace.ts` — channel 层零涉及（reauth 是连接级；quiesce 经既有 `close()` 拓扑自动发生）。
- `packages/ws-replication/src/peer-namespace.ts` — 控制器生命周期面零涉及（`onConnectionFatal`/`onConnectionLost` 既有幂等足够）。
- `packages/ws-replication/src/{backpressure,frame-io,liveness,round-engine,update-channel,fence-watchdog,error-mapping,lifecycle-queue,validate,defaults,testing,index}.ts` — 零改动（§11 依据 1/2/8；index 整包 re-export 无需变更）。
- `packages/ws-replication/test/`（除 ALLOW 两文件外的全部 `*.test.ts` / `*.test-d.ts` / `harness.ts` / `issue137-driver.ts`）— 冻结绿套件与基建，本任务零触碰（§10 修正不落在这些文件）。
- `packages/replication-protocol/**` — GOAWAY 帧型/字段既有支持（§11 依据 7）。
- `docs/protocols/instance-replication-v1.md` — 本任务是实现缺口补全，不是协议变更；receiver deadline 语义 §6.3 L141 既有明文。
- `apps/**`、`domains/**`、其余 `packages/**` — 组合根（切片 9）未建，零外部 caller（§12 复核）。

### SA4 比对说明

actual diff 预期 = src 三文件 + `package.json`（仅 version 一行，F-1）+ SA6 红测文件（若 §10 修正在同 PR 流转）。src 三文件与 `package.json` version 字段之外的任何 `packages/ws-replication/**` 改动 = scope creep。

---

## §14. SA2 反馈逐条回应

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|---|---|---|---|
| F-1（SA4 R1，唯一 reject 项）：设计需治理版本 bump 出口——ALLOW LIST 补 `packages/ws-replication/package.json`，限定仅 version patch `0.1.2→0.1.3`（HG9 强制/本包先例） | ✅ | §13 ALLOW LIST（第 4 条）+ §3 末条（正文依据） | 追加 `packages/ws-replication/package.json` 条目：限定**仅** version 字段 `0.1.2 → 0.1.3` 一行改动（HG9：公共 API 面净增两方法必须升版；先例 doc-runtime `0.1.11` / namespace-registry `0.1.6`）；其余字段显式冻结。§3 末条同步补设计正文对应说明（文件清单立法：每个 ALLOW 条目须有正文章节锚点） |

---

## §15. 一致性自检记录（提交前）

- 全文检索 `requestReauth`/`notifyAuthChanged`/`armBlockedDeadline`/`beginReauth`：定义（§3-§6）与引用（§7-§8、§10-§13）逐处口径一致（Hub 级 seam / Peer 级通知缝 / 私有 deadline 方法）。
- drain 预算表述统一为 `closeTimeoutMs`（§4.3 论证，§11 依据 2 复引）；close reason 统一 `'hub-reauth'`（hub 侧）/`'blocked-deadline'`（peer 侧）/既有 `'replication-rebuild'`(1000) 不变。
- §6.1「blocked 两 reasonCode 都武装」与 §10.1 缺陷分析（IT4 与 reasonCode 无关、只与 drain 算术有关）互不矛盾；fallback（REAUTH-only 收窄）已登记为 §6.1 一行条件。
