# Issue #164 切片 9 设计 — apps/yjs-server 组合根 + 真实 WebSocket adapter（SA1 R1）

> **R1 修订记录（2026-08-30）**：响应 SA2 R0 reject（4 攻击点，见
> `task_issue-164-on-docs-phase-5-websocket-replication_sa2_review.md`）：
> A1（CRITICAL）cb 源响亮 TypeError 被无条件 catch 吞掉 → §4.4(f)/§4.5 重构为
> 「runLoud 单一逃逸机制」（cb 包装 + 异步边界统一 queueMicrotask 转投
> uncaughtException 域）；A2（MEDIUM）预验证无界 → §4.4(d) 选定甲案（复用
> helloTimeoutMs 封顶，超时 503）；A3（LOW）证据链缺口 → §8 补 P13（SA1 自跑
> 实测）+ P14（逃逸通道实测）；A4（LOW）三则工程硬化 → §4.3/§5.2/§10 落文。
> 逐条回应见 §11。架构面零改动（SA2 认定总体成立）。

- 任务：Phase 5 slice 9（ADR-0010 L175）——apps/yjs-server 组合根（HTTP Upgrade
  bearer-token 验证 → instanceId/namespace 权限 → `HubReplication.accept` 接线）
  + 真实 WebSocket adapter（`DuplexTransport` 生产三面）。
- 类型：**Feature（功能开发）**。权威链：GitHub issue #164 全文（已亲读）→
  `docs/protocols/instance-replication-v1.md` §2/§6.1/§17/§18/§19/§21 →
  ADR-0010 L165-182 → `docs/phases/phase-5-websocket-replication.md` §9（含
  「hub 停机 GOAWAY 归属裁决」）→ SA6 红灯契约（本简报 §SA6 + 三件测试文件）。
- 输入锚：SA6 已冻结公共面（简报 §2）与 12 用例红灯（FS1–FS9 + TF1–TF3），
  `apps/yjs-server/test/`（harness.ts + 2 测试文件，收集期红灯亲证）。

---

## §0 需求拆解（issue #164 → 设计目标）

| # | 需求（issue 原文/协议） | 设计承载 |
|---|---|---|
| R1 | HTTP Upgrade bearer-token 验证 → `accept(transport, …)` 接线 | §4.4：升级前验证（无凭据/非 Bearer → **401**；verifier 拒绝/抛错 → **403**；两者绝不 101），升级后把**原始 token** 传入 `hub.accept(transport, { token })`（包内 verifyToken 二次消费 = 纵深防御，FS1 断言 ≥2 次消费） |
| R2 | 真实 WebSocket adapter 实现 `DuplexTransport` | §3.2：`createWebSocketAdapter(socket: WebSocketLike): DuplexTransport`（send/close/closed/onMessage/onClose 全实现） |
| R3 | adapter 必须暴露 `bufferedAmount`（G3.4 背压前提） | §3.2：getter 实时投影 `socket.bufferedAmount`；§3.3 装配断言 |
| R4 | adapter 必须暴露 `ping`/`onPong`（G5.1 活性前提） | §3.2：转发 `socket.ping` / 订阅 `socket 'pong'` 事件（活性由 ws-replication `startLiveness` 消费，§4.4 只保证面在） |
| R5 | 宿主装配期一次性 loud 断言（缺面 → TypeError/结构化告警，防静默降级） | §3.3 `assertProductionTransportFaces`（缺任一面 → 同步 TypeError，message 列缺面名）+ §4.5 组合根每连接装配点接线（alert 通道 + 关连接 + 零协议分配；缺省 alert = 重抛 TypeError） |
| R6 | instanceId/namespace 权限接线 | §4.2（`role:'hub'` 显式校验 + instanceId 文法由 `createHubReplication`→`validateHubOptions` 单一权威校验）；authorize 直通 `HubReplicationOptions.authorize`（FS7 NAMESPACE_UNAUTHORIZED 语义归包，§1.2 已核实 hub-namespace.ts:271/590/673） |
| R7 | 停机编排（§21 顺序；phase §9 裁决：切片 9 只编排，不拥有 GOAWAY） | §4.6：停接纳 → `hub.close()`（①–③ 包语义）→ 残留 socket 清扫 → `registry.shutdown()`（④）→ http 终结确认 |
| R8 | 全链路（Upgrade → HELLO → OPEN/bootstrap → reconcile → 远端 diff 应用） | §2 边界裁决：**零新协议逻辑**——FS2 全链路由既有包（ws-replication + namespace-registry + doc-runtime）承担，组合根只做 transport/身份/生命周期接线（映射见 §1.3） |

**推演结论**：切片 9 的本质是「宿主接线层」——全部协议行为（HELLO/身份绑定/OPEN/
bootstrap/reconcile/背压/活性超时/GOAWAY drain）已在 `@nomicore/ws-replication`
内实现并被既有 191 文件 / 2166 用例覆盖（SA6 简报 §5：全量 193 文件中 191 现存
+ 2 新红灯，2166 用例零失败）。组合根新增的只有四类自有逻辑：
(i) HTTP Upgrade 前置验证与 401/403 裁决；(ii) ws.Socket → DuplexTransport 适配
（含 text 帧拒绝与 'error' 事件吸收）；(iii) 生产三面装配期响亮断言；(iv) §21 停机
编排。任何把协议逻辑搬进组合根的冲动都是架构违约（apps/AGENTS.md：Apps are
composition roots…without moving those contracts out of their owning packages）。

---

## §1 现状盘点

### 1.1 apps/yjs-server 现状（设计期亲验）

- 仅有 SA6 三件套：`test/harness.ts`（610 行：StubPersistence + 真 Registry fixture
  + 自研最小 RFC 6455 客户端 + PeerWire 观测器）、`test/issue164-slice9-red.test.ts`
  （FS1–FS9）、`test/issue164-transport-faces-red.test.ts`（TF1–TF3）。
  **无 package.json、无 src/、无 tsconfig** —— 组合根 100% 未交付（红灯实证：
  `Cannot find module '../src/index.js'` + `Cannot find package 'yjs'`）。
- `pnpm-workspace.yaml` 已含 `apps/*`（亲验）→ apps/yjs-server 成为 workspace
  成员只需补 package.json + `pnpm install`。
- 根 `vitest.config.ts` include 已由 SA6 追加 `apps/*/test/**/*.test.ts`（仅加不改）；
  vitest `typecheck.include` 仍只覆盖 `packages|domains/*/test/**/*test-d.ts`
  —— apps 测试不进 vitest typecheck（SA6 简报 §5 注记），由 §7 的独立 tsconfig 承接。

### 1.2 可复用的包能力（全部已交付、已回归锁）

| 能力 | 出处（亲读） | 切片 9 消费方式 |
|---|---|---|
| `createHubReplication(options)` / `accept(transport, {token})` | `packages/ws-replication/src/hub-connection.ts:48,116` | 直接构造；accept 负责早到帧缓冲/认证等待封顶/身份绑定/连接分配 |
| 升级认证门 0–5（missing-token / verifier-missing / auth-timeout / invalid-credentials / invalid-instance-id） | `hub-connection.ts:117-239` | 纵深防御第二层；组合根 401/403 是第一层 |
| HELLO 身份恒等校验（`INSTANCE_IDENTITY_MISMATCH` + 1008） | `hub-connection.ts:576-582` | FS5/FS5b 直接由包承载，零新代码 |
| namespace 授权（NAMESPACE_UNAUTHORIZED，连接不杀） | `hub-namespace.ts:271,590,673` | FS7 由包承载 |
| WS 源 ping/pong 活性（`startLiveness`，ping/onPong 双面在场才武装） | `liveness.ts:22-47` + `hub-connection.ts:596-605` | FS8/FS9：adapter 暴露两面 → 活性自动武装；pong 超时 → `close(1001,'pong-timeout')` |
| 停机 GOAWAY/drain/提前完成（#171/#174/#175） | `hub-connection.ts:274-284,405-446` | `close()` 只调 `hub.close()`（phase §9 裁决） |
| 三面可选语义（缺面 = dormant） | `types.ts:60-72`（DuplexTransport） | TF2 的 memory transport 即 dormant 形态（`ws-replication/src/testing.ts:47`） |
| 构造期响亮校验（instanceId 文法/registry/authorize/timer/verifyToken 形状） | `validate.ts:55-88`（validateHubOptions） | 组合根不重复实现（单一权威，见 §4.2） |
| Registry 三相停机（幂等 same-Promise） | `namespace-registry/src/types.ts:674-684` | §4.6 第 ④ 步；`registry-shutdown.test.ts:313-318` 同款 fixture（createRegistryTestScheduler）下 shutdown 亲证可结算 |
| limits/timeout 缺省与合并 | `defaults.ts`（DEFAULT_REPLICATION_LIMITS/TIMEOUTS 均 export） | §4.5 maxPayload 解析复用 DEFAULT_REPLICATION_LIMITS |

### 1.3 关键既有行为核对（红灯用例 → 包行为映射，亲读源码）

- FS1 `verifierCalls ≥ 2`：组合根预验证（第 1 次）+ `accept` 门 4 再验证
  （`hub-connection.ts:194`，第 2 次）——设计只须**透传原始 token**。
- FS5 `HELLO.peerInstanceId ≠ 认证身份` → `connectionFatal('INSTANCE_IDENTITY_MISMATCH',1008)`
  （先发 ERROR 帧 `connectionErrorFrame`，再 `transport.close(1008,'protocol-error')`）。
- FS5b `'Peer_Alpha!'` 走同一路径（≠ 'peer-alpha'）→ 1008 ∈ [1002,1008]，零 HELLO_ACK。
- FS6 既有连接收口：ready 态连接走 `shutdownWithGoaway` → 无 channel →
  `maybeFinishDrainEarly` 立即 `close(1001,'hub-shutdown')`（毫秒级，不等 5s deadline）。
- FS9 `reason === 'pong-timeout'`、code 1001：`onLivenessLost`（`hub-connection.ts:828-838`）。
- TF1 text 帧 → adapter 自有职责（包不感知 WS 帧 opcode）：`close(1002)` + 零投递。

---

## §2 架构总览与边界裁决

```
                      apps/yjs-server（本切片交付 = §虚线框）
┌─────────────────────────────────────────────────────────────────┐
│  createYjsHubServer(config)                                     │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ http.Server（node:http）                                   │  │
│  │  'request'   → 404（非升级普通 HTTP，占位响应）           │  │
│  │  'upgrade'   → 路由门 → Bearer 提取 → verifyToken 预验证  │  │
│  │               401/403/503 原始状态行拒绝（§4.4）          │  │
│  │  'connection'→ socket 登记（close 清扫依据）              │  │
│  └──────────────┬────────────────────────────────────────────┘  │
│                 │ 101 路径：wss.handleUpgrade(req,socket,head)   │
│  ┌──────────────▼────────────────────────────────────────────┐  │
│  │ WebSocketServer（ws@8，noServer:true, maxPayload）        │  │
│  │  cb(ws) → wireConnection(ws, token)：                     │  │
│  │    transportFactory(ws)（缺省 createWebSocketAdapter）    │  │
│  │    → assertProductionTransportFaces（§3.3，缺面响亮拒绝） │  │
│  │    → hub.accept(transport, { token })                     │  │
│  └──────────────┬────────────────────────────────────────────┘  │
│  ┌──────────────▼────────────────────────────────────────────┐  │
│  │ src/transport.ts：ws.Socket ⇄ DuplexTransport 适配        │  │
│  │   bufferedAmount 投影 / ping / onPong / text 帧拒绝       │  │
│  │   'error' 事件吸收（防 EventEmitter 无监听崩溃）          │  │
│  └───────────────────────────────────────────────────────────┘  │
│  close()：§21 编排（§4.6）                                      │
└───────────────────────────────┬─────────────────────────────────┘
                                │ 注入（零修改）
        @nomicore/ws-replication（createHubReplication：全部协议逻辑）
        @nomicore/namespace-registry（宿主注入实例：registry）
        ws@8（新外部依赖；@types/ws 类型）
```

**边界裁决（SA2 攻击预防御）**：

1. **零包修改**：红灯 12 用例的全部协议语义已由包承载（§1.3）。本设计 ALLOW LIST
   不含任何 `packages/**`；若实现中发现需要改包，即设计缺陷，须回炉而非绕行。
2. **不做 ADR-0010 L175 的完整 app 愿景**：ADR 设想「装配 Clock、Timer、Memory/File
   Persistence、Registry、WS replication、配置加载」的最小 Cordis composition root；
   SA6 冻结公共面（简报 §2）把 Registry/Persistence/verifyToken/authorize 收敛为
   **宿主注入项**，本切片只交付 `YjsHubServer` 窄面。配置加载/Cordis app 化/
   observer wiring（#163）均不在本票（issue #164 Scope 只列组合根接线 + adapter）。
   冻结契约与 ADR 愿景的差集 = 后续切片（phase §9 未交付边界明示 observability 归
   #163）。
3. **timer 由组合根提供生产实现**：ADR 0009「零 native timer」纪律约束的是包
   （seam 注入）；组合根本身就是生产 Timer/Clock 的提供方（ADR-0010 L175「装配
   Clock、Timer」+ types.ts:80「注入延迟 seam」注释语义）。§4.1 `PRODUCTION_TIMER`
   是唯一引入原生 timer 的位置，包内代码路径零原生 timer 保持。
4. **401/403/503 的裁决权在组合根，101 后一切归包**：升级前 HTTP 状态行是组合根
   自有域（包不可见）；`accept` 内的 1008/1009 收口是包域。两层都以同一
   verifyToken 消费同一 token——FS1 的 ≥2 次消费即为此设计的直接断言。

---

## §3 src/transport.ts 设计（adapter 三面 + 装配断言）

### 3.1 `WebSocketLike`（冻结形状，SA6 简报 §2）

```ts
import type { DuplexTransport } from '@nomicore/ws-replication';

/** ws.WebSocket 的最小结构面（SA6 冻结：bufferedAmount/readyState/send/close/ping/
 *  on/off + message/close/pong/error 事件）。事件 listener 全部按事件名重载声明
 *  （method 语法——对 FakeSocket（listener: never 形态）与 @types/ws（per-event
 *  重载）双向结构兼容，双端 bivariance 成立；TF1 直证）。 */
export interface WebSocketLike {
  readonly bufferedAmount: number;
  readonly readyState: number;               // 0 CONNECTING / 1 OPEN / 2 CLOSING / 3 CLOSED
  send(data: Uint8Array, options?: Readonly<{ readonly binary: boolean }>): void;
  close(code?: number, reason?: string): void;
  ping(data?: Uint8Array): void;
  on(event: 'message', listener: (data: unknown, isBinary: boolean) => void): void;
  on(event: 'close', listener: (code: number, reason: string) => void): void;
  on(event: 'pong', listener: (data: unknown) => void): void;
  on(event: 'error', listener: (error: unknown) => void): void;
  off(event: 'message', listener: (data: unknown, isBinary: boolean) => void): void;
  off(event: 'close', listener: (code: number, reason: string) => void): void;
  off(event: 'pong', listener: (data: unknown) => void): void;
  off(event: 'error', listener: (error: unknown) => void): void;
}
```

- `send` 显式 `{ binary: true }`：协议不变量 1「一 WS binary message = 一 frame」的
  发送侧宣言（ws 对 Buffer 本可自动判定，显式声明消除歧义）。
- 不含 `terminate`（slice 内无需硬杀；close 清扫走 socket.destroy 由组合根对
  原始 socket 做，不经 adapter）。

### 3.2 `createWebSocketAdapter(socket): DuplexTransport`

状态机与全路径伪码（SA3 按此实现，逐条有测试锚）：

```ts
const READY_STATE_OPEN = 1;
const READY_STATE_CLOSING = 2;

export function createWebSocketAdapter(socket: WebSocketLike): DuplexTransport {
  let ownClosed = false;        // 本端主动收口标志
  let closeNotified = false;    // onClose 恰一次投递守卫
  const messageListeners = new Set<(bytes: Uint8Array) => void>();
  const closeListeners = new Set<(info: Readonly<{ code: number; reason: string }>) => void>();
  const pongListeners = new Set<() => void>();

  // ── 'error' 必须最先订阅：Node EventEmitter 语义——'error' 无监听即抛进程级
  //    异常。ws 出错后必随发 'close'，这里只吸收 + 标记，收口统一由 'close' 承接
  //    （真降级路径：外部网络故障，合理吸收；绝不让进程崩）。
  socket.on('error', () => { ownClosed = true; });

  socket.on('close', (code, reason) => {
    ownClosed = true;
    if (closeNotified) return;
    closeNotified = true;
    for (const listener of [...closeListeners]) listener({ code, reason });
  });

  socket.on('message', (data, isBinary) => {
    if (ownClosed) return;                       // 收口后零投递
    if (isBinary === false) {                    // text 帧 = 帧级违约（不变量 1）：
      closeTransport(1002, 'text-frame-rejected'); // close(1002) + 零投递（TF1）
      return;
    }
    const bytes = toBytes(data);                 // Buffer|ArrayBuffer|Buffer[] → Uint8Array
    if (bytes === undefined) {                   // 不明 binary 载体形态 = 违约（loud，不静默吞）
      closeTransport(1002, 'binary-decode-failed');
      return;
    }
    for (const listener of [...messageListeners]) listener(bytes);
  });

  const closeTransport = (code?: number, reason?: string): void => {
    ownClosed = true;
    if (socket.readyState === READY_STATE_OPEN) {   // 确定性幂等：非 OPEN 不再调用
      try { socket.close(code, reason); }
      catch { /* ws 对非 OPEN close 本就静默；此处兜异常唯一来源是竞态断连（外部故障降级路径） */ }
    }
  };

  const transport: DuplexTransport = {
    // ── R3：背压观察点（§17 L492）。实时投影，非快照。
    get bufferedAmount(): number { return socket.bufferedAmount; },
    get closed(): boolean { return ownClosed || socket.readyState >= READY_STATE_CLOSING; },

    // ── 发送：byte 等同透传（TF1：socket.sentBinary[0] === frame）。
    //    发送竞态（对端同 tick 断连）= 外部故障 → 吸收并标记收口，不向
    //    OutboundQueue/ConnectionSender 抛异常（包内零防御假设）。
    send(bytes) {
      if (transport.closed) return;
      try { socket.send(bytes, { binary: true }); }
      catch { ownClosed = true; }
    },

    // ── 收口：code/reason 透传（TF1：close(1008,'upgrade-unauthorized') 逐字落
    //    socket.closeCalls）。幂等：重复调用零副作用；'close' 事件到达时 onClose
    //    恰一次投递（closeNotified 守卫，TF1 直证）。
    close(code, reason) { closeTransport(code, reason); },

    // ── R4：WS 级活性面。liveness 循环会以无参调用（socket.ping() 空载荷）；
    //    ping 不做 closed 门（TF1 在 text 拒绝后仍断言 pingData 可写）——真 socket
    //    上竞态抛错吸收并标记收口。
    ping(data) {
      try { socket.ping(data); }
      catch { ownClosed = true; }
    },

    onMessage(listener) { messageListeners.add(listener); return () => messageListeners.delete(listener); },
    onClose(listener) { closeListeners.add(listener); return () => closeListeners.delete(listener); },

    // ── onPong：忽略 pong 载荷（liveness 契约是 () => void；TF1 计数直证）。
    onPong(listener) {
      const handler = (): void => { listener(); };
      socket.on('pong', handler);
      return () => socket.off('pong', handler);
    },
  };
  return transport;
}

/** RawData(unknown) → Uint8Array | undefined（undefined = 不明形态）。
 *  Buffer ⊂ Uint8Array（nodebuffer 缺省直通）；ArrayBuffer 视图化；Buffer[] 碎片
 *  拼接（ws 分片接收形态）。TF1 FakeSocket 直发 Uint8Array 走首分支。 */
function toBytes(data: unknown): Uint8Array | undefined { /* §3.2 尾注实现 */ }
```

**`onClose` 不补发声明**：订阅晚于 close 事件 = 不回放。transport 契约假定订阅先于
关闭（hub-connection 在 `accept` 同步段订阅，hub-connection.ts:377-380 既有拓扑），
内存双端 transport（testing.ts:47）同语义——adapter 与既有 dormant 形态对齐。

**TF1 逐锚核对**（伪码 ↔ 断言）：
三面 typeof（getter/方法）✓；bufferedAmount 1234→0 实时投影 ✓；send 字节等同 ✓；
onMessage 订阅/退订（off 句柄）✓；text 帧 → `closeCalls[0].code === 1002` 且零投递 ✓；
ping 载荷透传 `pingData[0] === [9,9]` ✓；onPong 计数 + 退订 ✓；独立实例
`close(1008,'upgrade-unauthorized')` → `closed === true` + closeCalls 末项逐字段 ✓；
随后 emit('close') → onClose 恰一次 `{code:1008,reason:'upgrade-unauthorized'}` ✓。

### 3.3 `assertProductionTransportFaces(transport): void`

```ts
/** §17「生产 Adapter 必须暴露三面；组合根在装配期对缺面做响亮断言」——
 *  缺任一面 = 配置错误（TypeError），非运行时降级。message 列全部缺面名
 *  （TF3 断言含 'bufferedAmount'）。 */
export function assertProductionTransportFaces(transport: DuplexTransport): void {
  if (transport === null || typeof transport !== 'object') {
    throw new TypeError('transport 必须是对象（DuplexTransport 形状）');
  }
  const missing: string[] = [];
  if (typeof (transport as { readonly bufferedAmount?: unknown }).bufferedAmount !== 'number') {
    missing.push('bufferedAmount');
  }
  if (typeof (transport as { readonly ping?: unknown }).ping !== 'function') missing.push('ping');
  if (typeof (transport as { readonly onPong?: unknown }).onPong !== 'function') missing.push('onPong');
  if (missing.length > 0) {
    throw new TypeError(
      `transport missing required production faces: ${missing.join(', ')}` +
      '（§17：缺面 = 配置错误，非运行时降级）',
    );
  }
}
```

- 只断言**三可选生产面**；五个必选面（send/close/closed/onMessage/onClose）由 TS
  类型静态承载，运行时缺失会在首次调用处自然炸响（TF2 的 bufferedOnly 对象五必选
  面俱全、缺 ping/onPong 仍须 throw——断言范围恰好覆盖，不多不少）。
- TF2 三态：memory transport（三面全缺）→ throw ✓；bufferedOnly（仅 bufferedAmount）
  → throw（missing = ping, onPong）✓；`createWebSocketAdapter(new FakeSocket())`
  → 三面俱全 no-throw ✓。

---

## §4 src/index.ts 组合根设计

### 4.1 公共面（SA6 冻结形状 + exactOptionalPropertyTypes 细则）

```ts
import {
  createHubReplication,
  DEFAULT_REPLICATION_LIMITS,
  DEFAULT_REPLICATION_TIMEOUTS,       // R1/A2：preauth 封顶缺省合并（§4.1 私有装配面）
  type DuplexTransport,
  type HubReplication,
  type NamespaceAuthorizer,
  type PeerTokenVerifier,
  type ReplicationLimits,
  type ReplicationTimeouts,
  type ReplicationTimer,
} from '@nomicore/ws-replication';
import type { NamespaceRegistry } from '@nomicore/namespace-registry';
import {
  assertProductionTransportFaces,
  createWebSocketAdapter,
  type WebSocketLike,
} from './transport.js';

export { assertProductionTransportFaces, createWebSocketAdapter } from './transport.js';
export type { WebSocketLike } from './transport.js';

export interface YjsHubServerConfig {
  readonly role: 'hub';
  readonly instanceId: string;                    // ^[a-z][a-z0-9-]{0,62}$（§6.1）
  readonly listen: Readonly<{ readonly host?: string | undefined; readonly port: number }>; // port 0 = OS 随机
  readonly verifyToken: PeerTokenVerifier;
  readonly authorize: NamespaceAuthorizer;
  readonly registry: NamespaceRegistry;
  readonly limits?: Readonly<Partial<ReplicationLimits>> | undefined;
  readonly timeouts?: Readonly<Partial<ReplicationTimeouts>> | undefined;
  readonly transportFactory?: ((socket: WebSocketLike) => DuplexTransport) | undefined;
  readonly alert?: ((message: string) => void) | undefined;   // 结构化告警出口；缺省 = 抛 TypeError
}

export interface YjsHubServer {
  start(): Promise<Readonly<{ readonly host: string; readonly port: number }>>;
  close(): Promise<void>;                          // §21 停机编排（含 Registry.shutdown）
}

export function createYjsHubServer(config: YjsHubServerConfig): YjsHubServer;

/** 生产时源（组合根 = Timer capability 提供方，ADR-0010 L175；§2 边界裁决 3）。 */
const PRODUCTION_TIMER: ReplicationTimer = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as Parameters<typeof clearTimeout>[0]),
};

// ── 服务器实现私有装配面（createYjsHubServer 同步段，R1/A2 起 §4.4(d) 消费）：
// 时源单点（preauth 封顶与包内 hub timer 同 seam 形态）；timeouts 显式合并
// （resolveTimeouts 不在包公共出口——index.ts 只导出 DEFAULT_*_TIMEOUTS 常量，
// 亲验 index.ts:8-11；合并语义与包内 resolveTimeouts 逐字段一致：整值替换缺省）。
class YjsHubServerImpl … {
  private readonly timer: ReplicationTimer = PRODUCTION_TIMER;
  private readonly resolvedTimeouts: Readonly<ReplicationTimeouts> = {
    ...DEFAULT_REPLICATION_TIMEOUTS,          // import 自 '@nomicore/ws-replication'（公共出口 ✓）
    ...(config.timeouts ?? {}),
  };
  private readonly maxFrameBytes: number = { // §4.5 wss maxPayload 消费（DoS 上界）
    ...DEFAULT_REPLICATION_LIMITS,
    ...(config.limits ?? {}),
  }.maxFrameBytes;
}
```

**exactOptionalPropertyTypes 细则（SA3 必读）**：根 tsconfig 开启
exactOptionalPropertyTypes（tsconfig.base.json 亲验），而 SA6 测试 startHub 显式传
`limits: undefined`（slice9-red.test.ts:80）——因此可选属性一律声明 `| undefined`
联合（如上），显式 undefined 合法。向下传包时用条件展开：
`...(config.limits !== undefined ? { limits: config.limits } : {})`（HubReplicationOptions
的可选属性未带 `| undefined`，显式赋 undefined 在该编译选项下非法）。

### 4.2 装配期校验（单一权威，不重复实现）

```ts
function validateConfig(config: YjsHubServerConfig): void {
  if (config.role !== 'hub') {
    throw new TypeError('YJS_HUB_SERVER_ROLE: role 必须为 "hub"（切片 9 唯一支持角色）');
  }
  if (config.listen === null || typeof config.listen !== 'object') {
    throw new TypeError('YJS_HUB_SERVER_LISTEN: listen 必须是对象');
  }
  if (!Number.isInteger(config.listen.port) || config.listen.port < 0 || config.listen.port > 65535) {
    throw new TypeError('YJS_HUB_SERVER_LISTEN_PORT: port 必须是 0–65535 整数');
  }
  if (config.listen.host !== undefined &&
      (typeof config.listen.host !== 'string' || config.listen.host.length === 0)) {
    throw new TypeError('YJS_HUB_SERVER_LISTEN_HOST: host 必须是非空字符串或省略');
  }
  if (config.registry === null || typeof config.registry !== 'object' ||
      typeof config.registry.shutdown !== 'function') {
    throw new TypeError('YJS_HUB_SERVER_REGISTRY: registry.shutdown 必须是函数（§21 停机编排第 4 步依赖）');
  }
  if (config.transportFactory !== undefined && typeof config.transportFactory !== 'function') {
    throw new TypeError('YJS_HUB_SERVER_TRANSPORT_FACTORY: transportFactory 必须是函数');
  }
  if (config.alert !== undefined && typeof config.alert !== 'function') {
    throw new TypeError('YJS_HUB_SERVER_ALERT: alert 必须是函数');
  }
}
```

- **instanceId 文法 / verifyToken / authorize / registry.open 形状**：由紧随其后的
  `createHubReplication(...)` → `validateHubOptions`（validate.ts:55-88）在同一同步段
  权威校验并抛 TypeError——组合根**不重复实现**（单一权威；若双写会漂移）。
- registry.shutdown 是组合根私有依赖（§21 第 4 步），包不校验 → 组合根必须自校。
- `role` 显式必填且恒 'hub'：phase §9「切片 9 注记：生产 composition root 必须显式
  传 role」——Registry 的 role 在 Registry 构造时由宿主传入（SA6 harness 亲证
  `role: 'hub'` 传入 createNamespaceRegistryForTesting）；本配置项把「这是 hub 组合根」
  编码进类型与运行时双门。

### 4.3 `start()` + server/wss error 生命周期（R1/A4 修订）

**error 处理三相位单点（构造期挂一次持久订阅，零 once 残留）**——R0 的
`once('error', reject)` 在 start 成功后仍挂在 server 上，后续运行期 'error' 会
命中已 settle 的 reject = 静默吞掉。R1 改为相位路由：

```ts
// 构造期（createYjsHubServer 同步段）一次性安装，永不摘除：
private pendingStart: { reject: (err: Error) => void } | undefined = undefined;

this.httpServer.on('error', (err) => {
  if (this.pendingStart !== undefined) {          // 相位 1：listen 窗口 → reject start()
    const { reject } = this.pendingStart;
    this.pendingStart = undefined;
    this.started = false;                         // R1/A4(a)：失败复位——实例可重试，
    reject(err);                                  // 二次 start() 报真实根因（如再次
  } else {                                        // EADDRINUSE），绝不误报「重复 start」
    this.notify(`YJS_HUB_SERVER_HTTP_ERROR: ${String(err)}`);  // 相位 2：运行期 → 告警通道
  }                                               // （同步 EventEmitter 上下文：alert 缺席
});                                               //  时 notify 就地 throw → 天然 uncaughtException）
this.wss.on('error', (err) => {                   // R1/A4(b)：wss 自身 'error' 必须订阅——
  this.notify(`YJS_HUB_SERVER_WSS_ERROR: ${String(err)}`);     // EventEmitter 'error' 无监听 =
});                                              // 进程崩溃（D1 同族；noServer 形态罕见但非零路径）

async start(): Promise<Readonly<{ host: string; port: number }>> {
  if (this.closed) throw new Error('YJS_HUB_SERVER_CLOSED: server 已 close，不可 start');
  if (this.started) throw new Error('YJS_HUB_SERVER_STARTED: start() 非幂等，禁止重复调用');
  this.started = true;
  return await new Promise((resolve, reject) => {
    this.pendingStart = { reject };               // 相位 1 挂载（listen 成功即摘）
    this.httpServer.listen(this.config.listen.port, this.config.listen.host, () => {
      this.pendingStart = undefined;              // 摘除：后续 'error' 全走相位 2
      const addr = this.httpServer.address();
      if (addr === null || typeof addr === 'string') {  // 理论不可达（TCP listen）；防御收窄
        this.started = false;
        reject(new Error('YJS_HUB_SERVER_ADDRESS: 不支持的非 TCP 监听地址'));
        return;
      }
      resolve({ host: addr.address, port: addr.port });  // port 0 → OS 实际分配值
    });
  });
}
```

- **R1/A4(a) start 失败语义**：listen 失败（EADDRINUSE 等）→ reject 前
  `started = false` 复位——实例可重试；重试再次失败报真实根因，绝不误报
  「重复 start」（SA2 §4.4 红线测试方向）。`closed` 后 start 仍恒 throw（单向门）。
- **R1/A4(c) bind 语义**：`listen.host` 省缺时 Node 绑**全部接口**（address() 反射
  `::` 或 `0.0.0.0`）——协议 §2 已声明 TLS 归网关/mesh，组合根明文 `ws://` 全接口
  监听 = 无认证加密的裸露面。生产注记见 §10(6)：必须显式 host 或网关收口。
  测试/本地固定 `127.0.0.1`（SA6 harness 形态）。
- `http.Server` 构造时即挂 `'request'` 处理器：任何非升级请求 →
  `res.writeHead(404, {'content-length':'0'}); res.end()`（占位；apps/AGENTS.md
  「logging…at the application edge」的 slice 9 最小面——REST 管理面非本票 Scope）。

### 4.4 Upgrade 路由：预验证（有界）→ 401/403/503 → 101 → accept 接线（R1/A1+A2 修订）

```ts
private static readonly UPGRADE_PATH = '/replication';   // 冻结（SA6 harness UPGRADE_PATH）

this.httpServer.on('upgrade', (req, socket, head) => {
  // R1/A1：外层兜底 catch 只可能接到「本方法契约外 reject」= 编程缺陷——
  // 外部输入路径（401/403/404/503）全部就地 respondHttp + resolve，永不 reject。
  // 处置 = 清理 + escalate 原样转投进程级（异常身份零改写、零吞）。R0 在此二次
  // notify 的写法已删除（那是「吞掉后再喊」的失真通道——A1 攻击点）。
  void this.handleUpgrade(req, socket, head).catch((err) => {
    try { socket.destroy(); } catch { /* 已亡 */ }
    this.escalate(err);
  });
});

private async handleUpgrade(req: http.IncomingMessage, socket: net.Socket, head: Buffer): Promise<void> {
  // (a) 生命周期门：停机中 → 503（不建立 WebSocket）
  if (this.closed) { this.respondHttp(socket, 503, 'Service Unavailable'); return; }
  // (b) 路径门：非 /replication（含畸形 URL）→ 404。畸形 URL 是外部输入 →
  //     干净拒绝（正当降级），绝不 notify/崩溃。
  const pathname = safePathname(req.url);               // try/catch new URL → undefined
  if (pathname !== UPGRADE_PATH) { this.respondHttp(socket, 404, 'Not Found'); return; }
  // (c) 凭据门（§2：升级前验证）：缺失/非 Bearer/空 token → 401，绝不 101
  const token = extractBearerToken(req.headers.authorization);
  if (token === undefined) { this.respondHttp(socket, 401, 'Unauthorized'); return; }
  // (d) 验证门（R1/A2 甲案）：pre-auth 等待封顶——复用 timeouts.helloTimeoutMs
  //     （零新 knob；与包内 accept 门 3 的 auth-timeout 同源同值、同一 verifier
  //     的第二层消费对称设界，hub-connection.ts:183-188 立法先例镜像）。
  //     状态映射（§2「失败返回 401/403」的诚实扩展）：缺失/畸形凭据 → 401；
  //     verifier 拒绝/抛错 → 403（与包 accept 的 throw→invalid-credentials 折叠
  //     一致，hub-connection.ts:202-207）；verifier 悬挂 → 503（服务侧问题，
  //     绝不用 403 污染凭据语义）；停机 → 503。
  let preauthHandle: unknown;                           // 先声明（executor 同步武装时已可用）
  const preauth = Promise.race([
    this.config.verifyToken(token).then(
      (v) => ({ kind: 'verdict' as const, v }),
      () => ({ kind: 'verifier-threw' as const }),      // throw → 403 折叠（wrapper 永不 reject）
    ),
    new Promise<{ readonly kind: 'timeout' as const }>((resolveTimeout) => {
      preauthHandle = this.timer.setTimeout(() => resolveTimeout({ kind: 'timeout' }),
        this.resolvedTimeouts.helloTimeoutMs);          // executor 同步武装——声明必须在先
    }),
  ]);
  const outcome = await preauth;
  this.timer.clearTimeout(preauthHandle);               // 句柄必清（§8 纪律；verdict 赢时
                                                        // 清未触发者，timeout 赢时 no-op）
  if (outcome.kind === 'timeout') { this.respondHttp(socket, 503, 'Auth Timeout'); return; }
  if (outcome.kind === 'verifier-threw'
      || outcome.v === null || typeof outcome.v !== 'object' || outcome.v.ok !== true) {
    this.respondHttp(socket, 403, 'Forbidden'); return;
  }
  // 迟归不复活（镜像包内 authRejected 语义，hub-connection.ts:143,196）：timeout 已
  // 收口后，verifier 晚到的 resolve/reject 只会落进已 settle 的 race wrapper——
  // 零消费者、零副作用、零 unhandledRejection（throw 已折为值）。
  // (e) 竞态复核：await 期间 close() 已发生 → 503（hub 门 0 也会拦，这里是第一层）
  if (this.closed) { this.respondHttp(socket, 503, 'Service Unavailable'); return; }
  // (f) 101 路径：ws 完成 RFC 6455 握手 → 同步 cb 内完成装配断言与 accept 接线。
  //     R1/A1 关键接线：cb 经 runLoud 包装——wireConnection 内 notify 的缺省
  //     TypeError（或任何逃逸的宿主缺陷异常）由 runLoud 转 queueMicrotask-throw
  //     直达 uncaughtException 域，【不经本层 catch】（身份零改写、策略无关）。
  //     本层 catch 从此【专职 ws 内部握手防御】（外部输入畸形握手——Sec-WebSocket-*
  //     缺失/非法等，ws abortUpgrade 已自行 write 400 + destroy）：兜底 destroy、
  //     零 notify、零吞 loud（cb 源异常到不了这里）。
  try {
    this.wss.handleUpgrade(req, socket, head,
      (ws) => this.runLoud(() => this.wireConnection(ws, token)));
  } catch {
    try { socket.destroy(); } catch { /* ws 对畸形握手自行 abortUpgrade；双保险 */ }
  }
}
```

```ts
/** 升级前原始 HTTP 拒绝（协议 §2：失败返回 HTTP 401/403，不建立 WebSocket）。
 *  socket.end：先冲刷状态行再 FIN——客户端（含 SA6 RawWsClient）可完整读到
 *  状态行与空 Sec-WebSocket-Accept（FS3 断言 ''）。 */
private respondHttp(socket: net.Socket, status: number, reason: string): void {
  const line = `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`;
  try { socket.end(Buffer.from(line, 'latin1')); }
  catch { try { socket.destroy(); } catch { /* 已亡 */ } }
}

/** Authorization 头 → Bearer token。scheme 大小写不敏感（RFC 7235），捕获组
 *  非空才算凭据；其余一切形态 → undefined → 401。 */
function extractBearerToken(header: string | undefined): string | undefined {
  if (typeof header !== 'string') return undefined;
  const match = /^bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? undefined;
}
```

**await verifyToken 期间的数据安全（P13）**：socket 尚未交给 ws（无 data 监听、
不 flowing——Node 流暂停态缓冲），握手后的早到字节滞留内核/socket 缓冲，由
`handleUpgrade(req, socket, head, cb)` 的 `head` 参数与 ws 内部读取统一承接——零
丢失、零乱序。运行时假设依据与 SA1 自跑实测输出见 §8 P13（headLen=5 +
receivedLen=7 = 12 全量保全，两次复跑稳定；SA2 独立实测同结论）。

**R1/A2 决策记录（可复核）**：预验证封顶二选一已定——
- **甲案（采纳）**：复用 `timeouts.helloTimeoutMs` 作 pre-auth 封顶，超时 →
  503 + socket 收口。理由：(i) 包内 accept 门 3 对**同一 verifier 的第二次消费**
  已用 helloTimeoutMs 设界（hub-connection.ts:183-188「认证等待封顶（显式政策，
  非沉默）：复用 timeouts.helloTimeoutMs——握手预算的既有载体，零新 knob」）——
  第二层有界、第一层无界是防御不对称，R0 的「受信域缺陷不设计降级」自辩与所引
  先例自相矛盾（SA2 A2 攻击成立）；(ii) 未认证 socket 是最廉价的攻击者可积累资源
  （仅需发起 upgrade），verifier 悬挂（网络后端死锁等真实生产形态）下每请求一个
  永久悬挂 fd，封顶把该类资源从无界收敛为有界；(iii) 零新 knob——与包内同源
  同值，缺省 10s。
- **乙案（否决）**：显式登记「第一层无界」分歧并豁免 SA7 压力域。否决理由：
  包内先例已把「受信 verifier 的等待」立法定界（auth-timeout 门），乙案等于
  宣称组合根比包内更信任同一函数——无据；且 503 语义诚实（服务侧问题），
  不污染 401/403 凭据语义。
- 测试衔接：SA2 §4.2 红灯方向（verifier 永不 resolve → helloTimeoutMs + slack
  内握手收口 503 + 进程存活）与本设计逐点对齐（respondHttp(503) → 客户端
  wsUpgrade resolve {status:503, ws:undefined} → RawWsClient 侧收口）。

### 4.5 生产三面装配断言 + accept 接线（TF3 承载）

```ts
private wireConnection(ws: WebSocket, token: string): void {
  // wireConnection 全路径 totality（R1/A1 声明）：本函数自身【从不向调用方抛出】——
  //  (1) 工厂 throw → 本地 catch；(2) 断言 throw → 本地 catch；(3) accept reject →
  //  .then rejection 分支；safeClose* 双双吞二次异常；notify 的缺省 throw 是唯一
  //  逃逸源，由【唯一调用边界】§4.4(f) 的 runLoud 包装承接 → uncaughtException。
  //  清理先行不变式：每个 notify 调用点之前，transport 与真 socket 均已收口——
  //  runLoud 转投的异常绝不携带未清理资源（SA2 A1「握手清理干净」要求）。
  // (1) transport 装配（工厂错误 = 宿主配置错误 → 响亮，绝不带病入网）
  let transport: DuplexTransport;
  const factory = this.config.transportFactory ?? createWebSocketAdapter;  // 缺省 = 真 adapter
  try {
    transport = factory(ws);
  } catch (err) {
    this.safeCloseSocket(ws, 1011, 'transport-factory-error');       // 清理先行
    this.notify(err instanceof Error ? err.message : String(err));   // 缺省 throw → 由
    return;                                                          // runLoud 边界转投
  }
  // (2) §17 生产三面装配断言：缺面 = 配置错误，非运行时降级
  try {
    assertProductionTransportFaces(transport);
  } catch (err) {
    // 先收口再告警（顺序固定）：
    //   transport 尽力关（工厂产物形状不可信，吞其二次异常——主异常已在手）
    //   真 ws socket 必须关（TF3：memory transport 与真 socket 无关联，
    //     不关真 socket 客户端将永远悬挂——'响亮拒绝'必须包含连接收口）
    this.safeCloseTransport(transport, 1011, 'transport-faces-missing');
    this.safeCloseSocket(ws, 1011, 'transport-faces-missing');
    this.notify(err instanceof Error ? err.message : String(err));   // TF3 断言含 'bufferedAmount'
    return;
  }
  // (3) accept 接线：原始 token 透传 → 包内 verifyToken 二次消费（纵深防御，
  //     FS1 ≥2 次消费断言）。accept 返回 undefined = 包已按自身语义收口
  //    （hub-shutdown / missing-token / 早到帧超限…），组合根零额外动作。
  void this.hub.accept(transport, { token }).then(
    () => undefined,
    (err) => {   // 包契约「accept 永不 reject」被打破 = 包缺陷：响亮 + 收口（绝不静默吞）
      this.safeCloseTransport(transport, 1011, 'accept-failed');
      this.runLoud(() => this.notify(`YJS_HUB_SERVER_ACCEPT_REJECTED: ${String(err)}`));
    },          // R1/A1：异步边界经 runLoud——alert 在场 → 结构化告警（进程存活）；
  );            // 缺席 → notify 的 TypeError 由 runLoud 转进程级（不再走
}               // unhandledRejection 策略依赖路径——两语义统一，见下）

/** R1/A1 单一逃逸机制（SA2 甲案采纳）——两个原语，同一语义：
 *  ① escalate(err)：把【已在手的异常】原样投递进程级；
 *  ② runLoud(f)：同步执行 f（通常内含 notify），逃逸异常经 ① 转投。
 *  共同保证（P14 实测承载）：
 *  (i) 异常身份零改写（原 TypeError/message 原样抵达进程级，SA2 §4.1 红线
 *      断言 message 含 'bufferedAmount' 直接锚在原异常上）；
 *  (ii) 绕开一切中间 catch（microtask 全新栈，无人能截）；
 *  (iii) 策略无关（uncaughtException 是同步异常域，先于且独立于
 *       unhandledRejection 处理策略——Node 可配置 rejection 为 warn 而崩不了，
 *       但 uncaughtException 崩溃不受该配置影响；实测对照见 §8 P14）。
 *  调用方不变式：转投前资源清理必须已完成（本设计所有 notify 调用点均
 *  遵循「清理先行」——见 wireConnection (1)/(2) 顺序）。 */
private escalate(err: unknown): void {
  queueMicrotask(() => { throw err; });
}
private runLoud(f: () => void): void {
  try { f(); } catch (err) { this.escalate(err); }
}

/** 告警通道（语义保留 + 边界纪律）：alert 在场 → 结构化告警（进程存活，逐连接
 *  拒绝——TF3 形态）；缺席 → 就地抛 TypeError（SA6 冻结语义「缺省 = 抛 TypeError」
 *  逐字兑现——throw 语义未被 A1 修订改变，改变的是【谁接住它】）。
 *  R1/A1 边界纪律（硬约束，SA3 禁自创第三种）：
 *  - 同步 EventEmitter 上下文（httpServer/wss 'error' 监听器）→ 直接调用 notify：
 *    缺省 throw 沿 emit 同步栈天然成为 uncaughtException（进程级，无需包装）；
 *  - 异步/promise 上下文（upgrade cb、外层 .catch、accept rejection）→ 必须
 *    runLoud(() => notify(...))（执行体含告警）或 escalate(err)（异常已在手）：
 *    缺省 throw 被转投 uncaughtException 域。
 *  R0 缺陷根因（A1 攻击点，留档防重蹈）：cb 源 throw 未经包装直接穿透
 *  wss.handleUpgrade → 被 §4.4(f) 无条件 catch 捕获后仅 destroy = 静默吞掉
 *  （缺省配置零宿主可见信号）；而 D3 异步路径却经 unhandledRejection 响亮——
 *  两条路径语义撕裂。R1 后两路径统一为 uncaughtException 域。 */
private notify(message: string): void {
  if (this.config.alert !== undefined) { this.config.alert(message); return; }
  throw new TypeError(message);
}

private safeCloseSocket(ws: WebSocket, code: number, reason: string): void {
  try { if (ws.readyState === 1) ws.close(code, reason); } catch { /* 已亡 */ }
}
private safeCloseTransport(transport: DuplexTransport, code: number, reason: string): void {
  try { transport.close(code, reason); } catch { /* 工厂产物形状不可信——主告警在手 */ }
}
```

**零协议分配**：faces 拒绝路径不调 `hub.accept` → 零 HELLO_ACK、零错误帧、零
connection 登记（TF3 两断言）；唯一外显 = WS close(1011) + alert 文本。

**ws `maxPayload` 硬化**：`new WebSocketServer({ noServer: true, maxPayload })`，
`maxPayload = this.maxFrameBytes`（§4.1 私有装配面：`{ ...DEFAULT_REPLICATION_LIMITS,
...(config.limits ?? {}) }.maxFrameBytes`，缺省 8 MiB）
（缺省 8 MiB）。理由：包内 `decodeInbound` 的 FRAME_TOO_LARGE 检查发生在**整帧已入
内存后**；ws 层 maxPayload 在字节流上提前截断（超限即由 ws 以 1009 收口）——认证
前洪水帧的内存 DoS 上界由此闭合（早到帧窗口 16 帧 × 8 MiB）。双层同界（8 MiB），
协议 §14「帧过大 → 1009」语义两层一致。

### 4.6 `close()` — §21 停机编排（切片 9 只编排，GOAWAY 归包）

```ts
close(): Promise<void> {
  if (this.closePromise !== undefined) return this.closePromise;   // 幂等（same Promise）
  this.closed = true;   // 先置位：upgrade 路由 (a)/(e) 门即刻 503；start 门同步关闭
  this.closePromise = (async () => {
    // ① 停止接纳：listening socket 关闭（新 TCP 连接 ECONNREFUSED——FS6 refused 断言）
    const httpClosed = new Promise<void>((resolve) => { this.httpServer.close(() => resolve()); });
    // ②-③ replication 收口：GOAWAY(SERVER_SHUTTING_DOWN) + drain + Runtime barrier
    //    （hub-connection.ts:274-284/405-446 包语义；#171/#174/#175 归属——
    //    phase §9 裁决：切片 9 不拥有 GOAWAY 发送本身）
    await this.hub.close();
    // 残留 socket 清扫：未升级 idle TCP / verify 悬挂 socket / 停机竞态持连 →
    // destroy。保证 httpClosed 不悬挂（server.close() 回调等全部连接终结）。
    for (const socket of [...this.sockets]) { try { socket.destroy(); } catch { /* 已亡 */ } }
    this.wss.close();   // noServer 形态：仅终结 WebSocketServer 对象（卫生性）
    // ④ Registry shutdown（幂等 same-Promise；失败以 NamespaceRegistryShutdownError
    //    reject——响亮上抛，宿主必须观测；此时连接/端口清理已完成，失败面最小）
    await this.config.registry.shutdown();
    // 尾：httpServer 全连接终结的权威确认（清扫后必然可达）
    await httpClosed;
  })();
  return this.closePromise;
}
```

- socket 登记：构造时 `httpServer.on('connection', (s) => { sockets.add(s);
  s.once('close', () => sockets.delete(s)); })`。
- **destroy 清扫与 close 帧冲刷**：清扫发生在 `await this.hub.close()` **之后**——
  此时 GOAWAY/close 帧已随包内 drain 窗口同步写出（loopback/局域网下微秒级入网）；
  destroy 是兜底硬杀，即便极端竞态下 close 帧未及冲刷，客户端按 RFC 6455 异常关闭
  （1006）处理——FS6 只断言 `wire.closed !== undefined`，对 1001/1006 均成立。
  连接的权威停机语义已由包内 GOAWAY + Runtime barrier 承载，不依赖 close 帧送达。
- FS6 时序亲证：established（ready，零 channel）→ `hub.close()` →
  `shutdownWithGoaway` → `maybeFinishDrainEarly`（channels 空）→ 立即
  `close(1001,'hub-shutdown')` → 客户端 wire.closed（毫秒级，不等 5s deadline）；
  `registry.getStatus().state === 'stopped'` 在 close() resolve 前由第 ④ 步保证。
- ⑤ Persistence dispose / ⑥ Timer 停止：Persistence 由宿主经 Registry 持有（SA6
  fixture 形态），Timer 无武装句柄残留（hub.close 后包内零 timer）——切片 9 无可
  编排对象，Phase §10（最终集成）承接。

---

## §5 用例映射与防御矩阵

### 5.1 红灯用例 → 设计条目全映射

| 用例 | 断言要点 | 设计承载（条目） |
|---|---|---|
| FS1 | 101 + HELLO_ACK + verifier ≥2 次 + authorize 0 次 | §4.4(c)(d)(f) 预验证 + §4.5(3) token 透传；authorize 仅在 OPEN_NAMESPACE 由包调用（§1.2 表） |
| FS2 | 101→HELLO_ACK→OPEN_OK(bootstrap)→SNAPSHOT→ACK→round1→hub ROOT.n=43 | 零新逻辑：包 + Registry 全链路（§0 推演结论）；组合根只提供真 TCP transport + 真 timer |
| FS3 | 缺 Authorization → 401，无 WS | §4.4(c) + §4.4 respondHttp（无 Sec-WebSocket-Accept） |
| FS4 | 非法 token → 403，无 WS | §4.4(d) verifier {ok:false} → 403 |
| FS5 | 自述身份 ≠ 受信身份 → ERROR(INSTANCE_IDENTITY_MISMATCH) + 1008，零 HELLO_ACK | 包（hub-connection.ts:576-579）——adapter 把 close(1008) 忠实落 socket（§3.2 close） |
| FS5b | instanceId 文法违例 → 帧级拒绝 [1002,1008]，零 HELLO_ACK | 同 FS5 路径（'Peer_Alpha!' ≠ 'peer-alpha' → 1008） |
| FS6 | close() → 既有连接收口 + 端口拒绝 + registry stopped | §4.6 全序（①→hub.close→清扫→④） |
| FS7 | 未授权 ns → ERROR(NAMESPACE_UNAUTHORIZED)，连接不杀，authorize 被调 | 包（hub-namespace.ts:271）；authorize 直通（§4.1 构造） |
| FS8 | hub 真发 WS ping；回 pong 连接保持 | adapter ping/onPong 面（§3.2）→ 包 startLiveness 自动武装（缺面 dormant 的反面） |
| FS9 | 不回 pong → close reason 'pong-timeout'，code∈[1001,1002] | 包 onLivenessLost（1001）+ adapter.close 透传 reason（§3.2） |
| TF1 | 三面存在 + bufferedAmount 实时投影 + send 字节等同 + text 帧拒收 + ping/pong + close 语义 | §3.2 逐锚（见 §3.2 尾 TF1 核对） |
| TF2 | assert：缺任一面 → TypeError；全三面 → 无异常 | §3.3（三态逐一核对） |
| TF3 | 缺面 transport → 告警含 'bufferedAmount' + 零 HELLO_ACK + 连接收口 | §4.5(2)（transport 与真 socket 双收口 + notify） |

### 5.2 附加防御（红灯未直接断言，防弹必设）

| # | 威胁 | 防御（条目） |
|---|---|---|
| D1 | ws socket 'error' 事件无监听 → Node 进程崩溃 | §3.2 首订阅 'error'（吸收 + 标记，'close' 随后承接收口） |
| D2 | 发送/ping 与断连竞态抛错 → 污染包内队列/liveness timer 回调 | §3.2 send/ping try/catch 吸收 + ownClosed 标记（外部故障 = 正当降级） |
| D3 | upgrade 处理器自身 bug（非外部输入） | **R1/A1 修订**：§4.4 顶层 `.catch`：destroy socket + `escalate(err)` 原样转投 uncaughtException 域（异常身份零改写；R0 的二次 notify 写法已删——与 cb 路径同语义） |
| D4 | 畸形 URL / 畸形握手（外部输入） | 404 / ws abortUpgrade + destroy——干净拒绝，不误触 loud 通道（拒绝虚假降级：外部输入 ≠ 宿主缺陷）。§4.4(f) catch 经 R1 后【专职此域】（cb 源异常已被 runLoud 包装先行截走） |
| D5 | verifier 悬挂 → 未认证 socket 无界积累（fd/内存泄漏） | **R1/A2 修订**：§4.4(d) pre-auth 封顶（helloTimeoutMs 同源同值；超时 → 503 + socket 收口；迟归不复活）——从无界收敛为有界；§4.6 close() 清扫仍为第二道兜底 |
| D6 | 停机竞态：verify await 期间 close() | §4.4(e) 复核门 + hub.accept 门 0（双层） |
| D7 | 认证前洪水帧内存 DoS | §4.5 maxPayload = maxFrameBytes（ws 层流上截断 + 包层 decode 双保险，同界同码 1009） |
| D8 | 非 upgrade 普通 HTTP 请求悬挂 | §4.3 'request' 处理器 → 404 占位 |
| D9 | httpClosed 悬挂（病态持连） | §4.6 清扫 destroy → server.close 回调必然可达 |
| D10 | close() 与 start() 竞态/重入 | closed 置位先行 + start 门 + closePromise 幂等（same Promise） |
| D11 | accept 包契约破坏（reject） | §4.5(3) rejection 分支：收口 + `runLoud(notify)`（alert 在场 → 结构化；缺席 → 确定性进程级；不静默吞、不走策略依赖的 unhandledRejection） |
| D12 | 工厂产物形状不可信（TF3 对象连 close 都可能异常） | safeCloseTransport 吞二次异常（主告警已在手，非静默降级） |
| D13 | **缺省 alert（生产最常见形态）下，装配期 TypeError 被中间 catch 吞掉 → 零宿主可见信号（A1 攻击的威胁实体化）** | §4.4(f) cb 经 `runLoud` 包装 + §4.5 wireConnection totality + 清理先行不变式：缺省 throw 必达 uncaughtException（原异常、原 message——SA2 §4.1 红线可锚 'bufferedAmount'）；握手同步清理（ws 1011 + destroy 兜底） |
| D14 | wss / httpServer 对象 'error' 事件无监听 → 进程崩溃（D1 同族） | §4.3 构造期双订阅：httpServer 相位路由（start reject / 运行期 notify）、wss 恒 notify（同步上下文缺省 throw → 天然 uncaughtException） |
| D15 | start() listen 失败后 started 残留 true → 重试误报「重复 start」，掩盖真实根因 | §4.3 相位 1 reject 前复位 `started = false`（实例可重试，二次失败报 EADDRINUSE 原因） |

---

## §6 工程接入（SA3 交付步骤，文件级）

### 6.1 `apps/yjs-server/package.json`（新建）

```json
{
  "name": "@nomicore/yjs-server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc -p tsconfig.json" },
  "dependencies": {
    "@nomicore/namespace-registry": "workspace:*",
    "@nomicore/persistence": "workspace:*",
    "@nomicore/replication-protocol": "workspace:*",
    "@nomicore/ws-replication": "workspace:*",
    "ws": "^8.21.3",
    "yjs": "^13.6.30"
  },
  "devDependencies": {
    "@types/node": "^20",
    "@types/ws": "^8.18.1",
    "typescript": "^5.9.3",
    "vitest": "^3.2.4"
  }
}
```

- deps 集合 = SA6 简报 §4 第 1 条的逐项要求：`ws`（真 adapter）+
  `@nomicore/{ws-replication,namespace-registry,persistence,replication-protocol}`
  （组合根用 ws-replication/namespace-registry；persistence/replication-protocol/
  yjs 为 **test/harness.ts 的解析依赖**——harness import 它们（亲验 :18-42），须可
  从本包 node_modules 解析）。
- exports 只声明 `"."`：src/testing.ts 不存在（本票无此交付，见 DENY LIST）；
  exports 指向缺失文件会让 tsc/vitest 解析报错。SA6 测试以相对路径
  `../src/index.js` 导入 src（不经包名），`"."` 已足。
- `pnpm install` 后生成 apps/yjs-server/node_modules 符号链接（红灯根因之一消除）。

### 6.2 `apps/yjs-server/tsconfig.json`（新建）

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

根 `package.json` typecheck 脚本**追加**：`&& tsc -p apps/yjs-server/tsconfig.json`
（只增不改既有 11 项）。生产代码进静态门禁是本切片的防弹底线（adapter/composition
root 全新生产 TS，无 typecheck = 裸奔）；test/** 一并入列的理由：SA6 冻结测试须被
证明**可**通过严格编译（exactOptionalPropertyTypes 细则即为此服务）。若实现期暴露
冻结测试自身类型缺陷（非 SA3 可改），降级方案 = include 收窄为 src/**（显式登记于
dispatch log，不静默）。

### 6.3 `apps/yjs-server/AGENTS.md`（新建，≤10 行）

按 apps/AGENTS.md 约定（"Add an application-local AGENTS.md when an app gains
framework-specific commands"）：登记 `pnpm --filter @nomicore/yjs-server typecheck`、
真 WS 组合根角色、`ws` 依赖边界（adapter 不得绕过 DuplexTransport 直接触协议）。

### 6.4 交付顺序与验收命令

1. 新建 package.json → `pnpm install`（lockfile 增量：ws + @types/ws + 传递依赖）。
2. 实现 `src/transport.ts`（§3，估 ~150 行）→ `src/index.ts`（§4，估 ~280 行）。
3. tsconfig + 根 typecheck 脚本追加 + apps/yjs-server/AGENTS.md。
4. 验收：`npx vitest run apps/yjs-server/test` → 12/12 绿；
   `pnpm test` → 全量绿（既有 191 文件 / 2166 用例零回归 + 新 2 红灯文件转绿
   即 193 文件全过）；
   `pnpm typecheck` → 0 errors。
5. SA7 动态域（压力/时序/互通）非本设计范围；SA4 静态比对以 §7 ALLOW LIST 为准。

---

## §7 文件清单（File Scope）

### ALLOW LIST

- `apps/yjs-server/package.json` — 新建，workspace 成员包定义（§6.1：ws + @nomicore/* + yjs 依赖；SA6 简报 §4 前置）
- `apps/yjs-server/tsconfig.json` — 新建，extends 根 base + include src/test（§6.2）
- `apps/yjs-server/src/transport.ts` — 新建，WebSocketLike + createWebSocketAdapter + assertProductionTransportFaces（§3，~150 行）
- `apps/yjs-server/src/index.ts` — 新建，YjsHubServerConfig/YjsHubServer/createYjsHubServer 组合根（§4，~280 行）+ transport.ts re-export（SA6 简报 §2「经 index.ts 再导出」）
- `apps/yjs-server/AGENTS.md` — 新建，应用级 agent 说明（§6.3，≤10 行）
- `package.json` — 修改，仅 typecheck 脚本追加 `&& tsc -p apps/yjs-server/tsconfig.json`（+1 段，零删改）
- `pnpm-lock.yaml` — 修改，`pnpm install` 自动增量（ws@^8.21.3 + @types/ws@^8.18.1 + 传递依赖）
- `vitest.config.ts` — `[SA6 owned]` SA6 已改（include +`apps/*/test/**/*.test.ts` 一行，已在工作树）；SA3/SA4 不得再动
- `apps/yjs-server/test/harness.ts` — `[SA6 owned]` 冻结测试基建；SA3 仅可在 SA4/SA7 指出契约自身缺陷时经登记修正，不得为转绿而改
- `apps/yjs-server/test/issue164-slice9-red.test.ts` — `[SA6 owned]` 同上（FS1–FS9 断言逻辑禁改）
- `apps/yjs-server/test/issue164-transport-faces-red.test.ts` — `[SA6 owned]` 同上（TF1–TF3 断言逻辑禁改）
- `wiki/raw/task_issue-164-on-docs-phase-5-websocket-replication.md` — `[controller owned]` 任务简报（SA6 红灯契约报告；已在工作树，各 SA 不改）
- `wiki/raw/task_issue-164-on-docs-phase-5-websocket-replication_design.md` — 本设计文档（SA1 产出，SA2 评审后修订）
- `wiki/raw/task_issue-164-on-docs-phase-5-websocket-replication_dispatch.md` — dispatch log 追加条目（流程产物）

### DENY LIST

- `packages/ws-replication/**` — 协议/状态机权威；本设计零包修改（§2 边界裁决 1）
- `packages/namespace-registry/**`、`packages/persistence/**`、`packages/replication-protocol/**`、`packages/{clock,doc-runtime,namespace-runtime,vfsl*}/**` — 既有契约与回归锁，不动
- `packages/*/test/**`、`domains/**` — 既有 191 文件回归基线，不动
- `tsconfig.base.json`、`tsconfig.typecheck.json` — 根类型基座；apps 类型安全经自有 tsconfig 承接（§6.2），无需动基座
- `pnpm-workspace.yaml` — `apps/*` 已在列（亲验），不动
- `apps/README.md`、`apps/AGENTS.md` — 既有应用层说明，本票不改（slice 9 注记已在 phase §9 登记）
- `docs/**`（protocols/adr/phases） — 协议与 ADR 是权威源，实现票禁改
- `apps/yjs-server/src/testing.ts` — 本票不存在该文件（§6.1 修正注）；任何「为测试方便」的公共面扩张不在冻结契约内

---

## §8 协议假设依据 (Protocol Assumption Evidence)

| # | 假设 | 依据类型 | 依据内容（具体引用） | 风险 |
|---|---|---|---|---|
| P1 | `ws@8.x` 提供 `new WebSocketServer({noServer:true, maxPayload})` + `handleUpgrade(req,socket,head,cb)`（cb 同步） | 官方文档 + 设计期实测 | ws 官方 README（noServer/handleUpgrade 自 v7 起稳定 API）；`npm view ws version` → `8.21.3`（exit 0，本机实测 2026-08-30，registry 可达） | 低 |
| P2 | ws `'message'` 事件签名 `(data: RawData, isBinary: boolean)`，nodebuffer 缺省给 Buffer；RawData = Buffer\|ArrayBuffer\|Buffer[] | 官方文档 + 类型包 | @types/ws 8.18.1 事件签名（`npm view @types/ws version` → 8.18.1 实测存在）；TF1 FakeSocket `emit('message', data, isBinary)` 同形（transport-faces-red.test.ts:83-91） | 低 |
| P3 | ws 收 ping 自动回 pong；hub 侧 ping 由 ws 发送 | 官方文档（RFC 6455 §5.5.2） | ws 文档「Pong sent in response to ping is automatic」；FS8/FS9 客户端为 SA6 裸 TCP 客户端（harness.ts:314-321 手工 pong），不依赖该行为，语义上与真 ws 客户端一致 | 低 |
| P4 | ws maxPayload 超限 → 以 close 1009 截断 | 官方文档 + 包内双保险 | ws README maxPayload 语义；即使 ws 行为有差，包内 `decodeInbound` FRAME_TOO_LARGE → 1009（hub-connection.ts:157-162）为第二层，语义收敛 | 低 |
| P5 | Node http `'upgrade'` 事件内自行写状态行 + `socket.end()` 是标准拒绝模式 | 官方文档 | Node docs http Event:'upgrade'（「the socket is handed over; write a raw HTTP response and destroy」）；FS3/FS4 红灯测试解析状态行即对该协议形态的验收锚 | 低 |
| P6 | EventEmitter `'error'` 无监听 → 进程级异常 | 官方文档 | Node docs EventEmitter: `'error'` 事件无监听抛异常——§3.2 首订阅防御（D1）的立法依据 | 低 |
| P7 | `pnpm install` 可从 registry 拉取 ws/@types/ws | 设计期实测 | `npm view ws version` → 8.21.3 / exit 0（本 worktree 网络亲测）；lockfile 现无 ws（`grep '"ws@"' pnpm-lock.yaml` 零命中——全新外部依赖） | 中（CI 离线则 install 失败——SA6 简报 §4 已把 pnpm install 列为交付前置，非本设计新增风险） |
| P8 | vitest 相对导入 `'../src/index.js'` 解析到 `src/index.ts` | 设计期实证（SA6 红灯日志） | SA6 红灯证据（简报 §5）：slice9-red.test.ts 报 `Cannot find package 'yjs'`（`'./harness.js'` → harness.ts **已成功解析**，错误发生在下一跳 yjs）——.js→.ts 映射在本仓 vitest 已生效的直接证据 | 低 |
| P9 | `server.close()` 后新 TCP 连接被拒（listening socket 即刻停听）；upgraded socket 仍计入连接统计 | 官方文档 + 防御设计 | Node net/http docs（close 停止新连接、回调等存量终结）；FS6 refused 断言锚定前半；后半（病态持连）由 §4.6 清扫兜底，不依赖统计语义 | 低 |
| P10 | `@types/ws` 的 `close(code?, data?: string, cb?)` 重载与 WebSocketLike.close(reason?: string) 结构兼容 | 类型包签名 + 兜底 | @types/ws 8.x close 首重载即 string 载荷；万一个别小版本存在 Buffer/string 摩擦，允许组合根在 `wss.handleUpgrade` cb 内对 `ws` 做单点 `as WebSocketLike` 结构桥接（注释引用本条；运行时行为不变——ws 运行时接受 string reason） | 低 |
| P11 | Registry `shutdown()` 在 createRegistryTestScheduler 虚拟时钟下可结算（无需 advanceBy） | 现有测试引用 | `packages/namespace-registry/test/registry-shutdown.test.ts:313-318`（同款 createNamespaceRegistryForTesting + createRegistryTestScheduler fixture，多次 `await registry.shutdown()` 现绿）；r2-internal.test.ts:371 finally 内 active-lease shutdown 同证 | 低 |
| P12 | ws 升级握手响应含合法 `Sec-WebSocket-Accept` | RFC 6455 + ws 实现 | FS1 断言 `not.toBe('')`；ws 官方实现该计算（SA6 harness wsUpgrade 自校验 accept 值，harness.ts:440-445） | 低 |
| P13 | `'upgrade'` 事件后至 `handleUpgrade` 接管前，socket 处于**暂停缓冲态**（无 data 监听不 flowing），窗口内到达字节零丢失、零乱序——同段字节入 `head`，窗口字节缓冲后照常投递（R1/A3 补条） | 官方文档 + 设计期实测（SA1 自跑，等价 SA2 脚本） | Node docs（http `'upgrade'` 事件移交原始 socket；streams 暂停态缓冲语义）。**SA1 实测**（Node v24.13.0，`node /tmp/sa1-p13.mjs`，两次复跑同果）：客户端写握手 + 5B 同段负载，'upgrade' 后等 80ms（模拟异步 verifyToken），第 40ms 再写 7B，随后才 attach data 监听 → 输出 `{"headLen":5,"receivedLen":7,"totalPreserved":12,"lost":false}` exit=0 ×2。SA2 独立实测（review §0，`/tmp/sa2-upgrade-test{,2,3}.mjs`）同结论（head.len=5 / received=5） | 低（Node ≥20 目标域内暂停态语义稳定） |
| P14 | `queueMicrotask(() => { throw err; })` 进入 **uncaughtException** 域（非 unhandledRejection），不受 unhandledRejection 处理策略影响——R1/A1 runLoud 逃逸机制的承载假设 | 设计期实测（SA1 自跑，含对照组） | **实测 1**：`node -e "process.on('uncaughtException', e => { console.log('UNCAUGHT_EXCEPTION:', e.message); process.exit(0); }); process.on('unhandledRejection', ...); queueMicrotask(() => { throw new TypeError('p13-boom'); });"` → 输出 `UNCAUGHT_EXCEPTION: p13-boom` exit=0（unhandledRejection 处理器未被触达）。**对照实测 2**：async 边界 `throw new TypeError('ctrl-boom')` → `UNHANDLED_REJECTION: ctrl-boom`（策略依赖通道——Node 可配置 `--unhandled-rejections=warn` 即不崩，故 R0 乙式路径不满足确定性 fail-fast）。Node docs：microtask 全新栈上的同步 throw = uncaught exception | 低（Node 核心语义，v24 实测） |

---

## §9 契约改动连锁审计 (Contract Change Caller Audit)

**无契约改动**：本设计是**纯新增**——新建 `apps/yjs-server` 包的两个公共入口
（`createYjsHubServer` / `createWebSocketAdapter` / `assertProductionTransportFaces`
+ 三个类型），**零修改**任何既有导出函数的签名、返回类型、throw 语义或调用方。
对既有包的全部交互是注入式消费（`createHubReplication` / `NamespaceRegistry` /
`DEFAULT_REPLICATION_LIMITS` 均为只读消费，git grep 亲核调用面）。

唯一近似「契约」的接线点及其消费闭环（防御性登记，非改动）：

| 接线点 | 语义 | 消费闭环 |
|---|---|---|
| `hub.accept(transport, { token })` 返回 `undefined` | 包已收口（hub-shutdown / missing-token / 早到帧超限等 9 类，hub-connection.ts:117-239） | §4.5(3)：组合根零额外动作（transport 已被包关闭） |
| `hub.accept` 契约外 reject（包缺陷假设） | 契约声明「永不 reject」 | §4.5(3) rejection 分支：收口 + runLoud(notify)（D11——R1/A1 统一逃逸语义） |
| `config.alert` 缺省抛 TypeError | SA6 冻结语义（简报 §2），非本设计新造 | §4.5 notify：就地 throw 逐字兑现；异步边界由 runLoud 转投 uncaughtException 域（R1/A1——R0「沿 upgrade 同步栈冒泡」表述经 SA2 攻击证伪，已废除） |

---

## §10 风险与显式不做（scope 边界）

1. **不做 observer/clock wiring**（#163 域）：SA6 冻结面无 observer 字段；latency
   观测保持 dormant。加字段 = 违约冻结契约。
2. **不做配置加载/环境变量/Cordis app 化**：ADR-0010 L175 完整愿景归后续切片；
   本票交付冻结的 `YjsHubServer` 窄面。
3. **不做 peer 侧组合**：role 恒 'hub'（issue #164 Scope 仅 hub 组合根 + adapter）。
4. **不做 REST 管理面**：`'request'` → 404 是占位（apps/README 的统一写入管线愿景
   属 Phase 2+ 既设方向，非本票）。
5. **已知残余风险**：(a) P7 网络依赖（pnpm install）；(b) `@types/ws` 类型摩擦
   （P10 兜底已设）；(c) 冻结测试在严格编译下的未知类型缺陷（§6.2 降级方案已
   预案，显式登记不静默）。三者均有单向退路，无架构级返工面。
6. **R1/A4(c) 生产监听注记**：`listen.host` 省缺 = Node 绑全部接口（`::` /
   `0.0.0.0`），且协议 §2 明文 Nomicore 不提供链路机密性（TLS 归网关/mesh）——
   生产部署**必须**二选一：显式绑定内网 host，或确认网关/mesh 收口（TLS 终结
   + bearer token 保护）。缺省全接口 `ws://` 裸监听是显式登记的生产反模式。
   测试/本地开发固定 `127.0.0.1`（SA6 harness 形态）。

---

## §11 SA2 反馈逐条回应（R1 修订）

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| **A1**（CRITICAL）：§4.4(f) 无条件 catch 吞掉缺省 alert 的响亮 TypeError；cb 源异常须进宿主可见/进程级通道且握手清理干净；两路径同一响亮语义；同步改 §4.5 notify 注释、§5.2 D3 | ✅ | §4.4(f)、§4.5（runLoud + totality + notify 边界纪律）、§5.2 D3/D13、§8 P14、§9 表 | 采纳 SA2 甲案：cb 经 `runLoud(() => wireConnection(ws, token))` 包装——逃逸异常经 `queueMicrotask(() => { throw err; })` 直达 **uncaughtException 域**（身份零改写，SA2 §4.1 红线可锚原 message 'bufferedAmount'；策略无关——P14 实测：unhandledRejection 通道可被 `--unhandled-rejections=warn` 熄灭，microtask-throw 不可）。§4.4(f) catch 收窄为**专职 ws 内部握手防御**（外部输入，destroy 即可，零 notify）；外层 `.catch`（D3）删二次 notify、改 `escalate(err)` 原样转投——cb/异步两路径统一单一机制（escalate/runLoud 双原语同语义，§4.5）。§4.5 增 wireConnection totality 声明（自身从不抛出，唯一逃逸源 = notify 缺省 throw，唯一边界 = runLoud）+ 清理先行不变式（transport 收口 → 真 socket 收口(1011) → notify），握手清理干净由不变式承载。notify 语义保留「缺省 = 抛 TypeError」（SA6 冻结逐字兑现），改变的是谁接住它；R0 缺陷根因留档防重蹈 |
| **A2**（MEDIUM）：预验证 await 无界 vs 包内 auth-timeout 先例不对称；二选一表态落文（甲·推荐：复用 helloTimeoutMs，超时 503；乙：显式登记无界分歧） | ✅（选甲案） | §4.4(d)、§4.4 决策记录尾注、§5.2 D5 | **甲案采纳**：pre-auth 封顶复用 `timeouts.helloTimeoutMs`（零新 knob，与包内 accept 门 3 同源同值——hub-connection.ts:183-188 立法先例镜像）；超时 → `respondHttp(503, 'Auth Timeout')` + socket 收口（悬挂是服务侧问题，不用 403 污染凭据语义）；timer 句柄全出口必清；迟归不复活（镜像包内 authRejected 语义，wrapper 永不 reject → 零 unhandledRejection）。决策记录含乙案否决理由（包内先例已为同一 verifier 立法设界，乙案 = 组合根宣称比包内更信任同一函数，无据）；状态映射 401/403/503 全部落文；与 SA2 §4.2 红灯方向（helloTimeoutMs+slack 内收口 + 进程存活）逐点对齐 |
| **A3**（LOW）：§8 缺「upgrade→handleUpgrade 窗口字节保全」P 条（立法合规缺口）；须可验证依据 | ✅ | §8 P13、§4.4 尾注 | 补 P13：假设「upgrade 事件后至接管前 socket 暂停缓冲，窗口字节零丢失」；依据 = Node http/streams 文档 + **SA1 自跑实测**（`node /tmp/sa1-p13.mjs`，Node v24.13.0，两次复跑：`{"headLen":5,"receivedLen":7,"totalPreserved":12,"lost":false}` exit=0 ×2——同段 5B 入 head、窗口 7B 暂停缓冲后投递）+ SA2 独立实测交叉印证（review §0，head.len=5/received=5）；风险注记 Node ≥20 稳定 |
| **A4**（LOW）：(a) start 失败后 started 残留；(b) wss 'error' 未订阅；(c) host 省缺绑全接口须注记 | ✅ | §4.3（相位路由 + 复位 + wss 订阅 + bind 语义）、§5.2 D14/D15、§10(6) | (a) listen 失败 reject 前 `started = false` 复位——实例可重试、二次失败报真实根因（EADDRINUSE），并连带修复 R0 的 `once('error')` 残留缺陷（start 成功后 once 仍挂、后续运行期 error 命中已 settle reject = 静默吞）→ 构造期单一相位路由订阅（相位 1 start reject / 相位 2 notify）；(b) `wss.on('error') → notify` 构造期订阅（D1 同族，防 EventEmitter 'error' 无监听崩溃）→ D14；(c) bind 全接口语义 + 「生产必须显式 host 或网关收口（协议 §2 TLS 归网关）」落 §10(6) |

**R1 一致性自检**（技能修订后强制项）：全文检索 `runLoud`/`notify`/`unhandledRejection`/
`once('error')`——R0 的「沿 upgrade 事件同步栈冒泡」表述已在 §4.5/§9 全部废除并替换为
runLoud 机制；§4.4(f) catch 注释、D3/D4/D11/D13 五处与新机制逐一核对无残留矛盾；
§5.1 十二用例映射零改动（A1/A2 修复均在冻结测试盲区，由 SA2 §4.1/§4.2 规划的
SA4/SA7 新增测试承载，不改 SA6 冻结文件）。
