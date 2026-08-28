# 设计 — `@nomicore/ws-replication`：Peer namespace 与 Hub 的 v1 协议端到端同步状态机

- 任务：issue #136（Phase 5 切片 6，功能开发）
- run_id: issue-136-1787888033-8367 / round: 1（设计 R4.2 单条款澄清：2026-08-30，§12 hub 溢出分支「声明+等待」定案〔SA4 F1 语义〕；R4.1 勘误轮：SA4 F8 追认 + F6/F9 登记——见文末「SA4 勘误轮（R4.1/R4.2）逐条回应」；此前 R4：SA2 R2 重审 N-1/N-2 收口，R3：SA2 R1 攻击评审 #1–#13 全收口，R2：SA8 CP-1/CP-2 × 总控裁决「维持 ADR 字面」，R2.1：O-7 措辞澄清）/ branch `fix/issue-136-on-docs-phase-5-websocket-replication`
- 设计基准（约束顺序）：SA6 冻结契约面 + 冻结红灯测试（`packages/ws-replication/test/`，36 it 已锚红；**R2 注记：其中 7 处断言经总控裁决须由 SA6 按 §18.11 对齐清单修订**）→ `docs/protocols/instance-replication-v1.md`（唯一 wire contract）→ ADR 0010（含 #133/#134 round-2 修订节）→ ADR 0006/0008/0009 → `docs/phases/phase-5-websocket-replication.md` → CONTEXT.md。
- 相关决议：`wiki/raw/task_phase5-ws-namespace-sync_relevant_decisions.md`（SA8 摘录，前置 verdict clear）+ `wiki/raw/task_phase5-ws-namespace-sync_design_conflict_report.md`（设计后复审 verdict conflict → R2 回归 ADR 字面）。

---

## §0. 任务范围与不变量

**交付物**：新建包 `packages/ws-replication`（`@nomicore/ws-replication`），实现：

1. 冻结公共面（§2）：`createHubReplication` / `createPeerReplication` + 类型 + `DEFAULT_*` 常量 + `/testing` 子路径；
2. Peer 连接状态机（stopped→…→ready/backoff/blocked，full-jitter）；
3. Peer namespace 状态机（targeted→opening→bootstrapping|reconciling→live→…→closed/conflicted/failed，11 态投影）；
4. Hub 入站连接（accept→handshaking→ready→draining→closed）与 per-(connection, namespace) 通道；
5. OPEN 授权/身份矩阵、单帧 bootstrap、双向 sync round、live UPDATE 滑动窗口/有界队列、ACK、RESYNC、IDENTITY_CHANGED fencing、CLOSE 收口、重连修复；
6. 一切远端 apply 经 `NamespaceLease.openReplicationSession()` 的 `applyRemoteUpdate()`（唯一 write sequencer + 槽内 dirty notification），一切本地读取/编码经 session 窄能力（`encodeStateVector`/`encodeDiff`/`subscribeOwnedUpdates`）——**transport 绝不接触裸 Y.Doc**（ADR 0009/0010）。

**硬不变量（全设计反复引用）**：

- I-1 一条 WS binary message = 一 frame（协议 §1.1；DuplexTransport seam 即为此抽象）。
- I-2 owner、token、SCHEMA/ROOT 内容、stack、cause 永不上 wire（协议 §13.2 L380）。
- I-3 ACK 只表示 sequenced apply + dirty notification 完成（§1.8）——实现上即「`applyRemoteUpdate()` resolve 后才发 ACK」。
- I-4 无 durable outbox：断线即丢连接内协议状态，重连靠 state-vector round 修复（ADR 0010 非目标）。
- I-5 同一连接内同一 namespaceId 恰一生命周期；closed/conflicted/failed 后不得重开，重开必须重建连接（协议 §1.4/§16）。
- I-6 网络状态只存在于本包（连接/namespace 控制器），绝不写入 Runtime capability status（ADR 0010 L87）。
- I-7 零 native timer / 零全局随机：全部延迟经注入 `ReplicationTimer`，jitter 经注入 `random()`（phase-5 §测试 seam；§15.1 "Scheduler和random必须注入测试 seam"）。

**非目标**（本切片不做）：真实 WebSocket 适配/bearer upgrade（切片 7）、observability observer/metrics（切片 8）、`resetReplica` 编排入口（切片 8；Registry 已交付）、GOAWAY 主动发送（hub 停机编排属切片 9——本包实现 GOAWAY 的**接收**语义与被动 close 分类）、namespace discovery/通配 selector、durable outbox、第二种 transport。

---

## §1. 既有交付物勘察与复用面（已逐项读源码核实）

| 交付物 | 本设计消费的面（签名已核实） | 消费点 |
|---|---|---|
| `@nomicore/replication-protocol`（#144） | `encodeMessage(msg,{sequence,maxFrameBytes,limits})` / `decodeMessage(bytes,{maxFrameBytes,limits})` → `DecodedMessage{header,message}`；字段级超限在 codec 层抛 `ProtocolError('UPDATE_TOO_LARGE'|'BOOTSTRAP_TOO_LARGE'|'SYNC_DIFF_TOO_LARGE')`（payloads.ts:611-622/471-484/550-563）；`lookupError(code)` → `{scope,fatal,retryable,wsCloseCode?,terminalState?}`；`selectProtocolVersion`；17 消息判别联合 | 全部 wire 编解码、ERROR 元数据、终态映射 |
| `@nomicore/namespace-registry`（#146/#143/#145） | `registry.open(owner,nsId)`（NOT_FOUND=缺失/owner 不符）、`registry.importReplica(owner,nsId,doc,expectedIdentity)`（#133 R2：expected 必须 Hub 广告身份；duplicate → `NAMESPACE_ALREADY_EXISTS`）、`lease.openReplicationSession({localRole,remoteInstanceId})`、`lease.getStatus().runtime.replication`（两态投影：`{state:'enabled',replicationId,replicationEpoch}`）、`lease.enableReplication()/bumpReplicationEpoch()`（hub 管理面，测试 fixture 直调） | Peer/Hub 全部 Registry 交互 |
| `@nomicore/namespace-runtime` ReplicationSession（#134） | session 六能力 + status 11 字段；`applyRemoteUpdate()` 拒绝码闭集（六码）+ `RuntimeWriteFatalError` rejection（`NSRT-FATAL-REPLICATION-APPLY-INTERNAL`）；受保护字段判据（hub：SCHEMA 全容器+META 全键；peer：META 全键）在 session 层**已内建**；fanout 每投递独立 bytes、20 微任务让步、队列 16 溢出弃新置 `needsResync`（sticky）；**epoch fence 在 bump 槽 E5.5′ 同步 `fenceStale` → session 终态 conflicted + 清队**（replication-write.ts:423）——本包不重复实现保护检查，只做 wire 映射 | 一切 apply/编码/订阅 |
| `@nomicore/persistence`（#147/#133） | 经 Registry 间接消费（importDoc/archiveDoc 不直调）；`DocHandleStatus`（`'persistence-degraded'` 为 degraded 语义源） | degraded 映射判别（§11.3） |

**关键既有事实（决定本设计形状）**：

- F-1 `applyRemoteUpdate()` 的 resolve 点 = 槽内 `Y.applyUpdate` + `await notifyDirty()`（= `saveDoc`）完成之后（replication-session.ts R5/R6）——I-3 的时序锚由 session 层免费提供。
- F-2 session fanout 的回声抑制按 applyOrigin；null-origin（业务写/管理写）恒投全部 channel——hub 多 peer fan-out 与 peer 业务写上行都由该单 observer 承载（AC5）。
- F-3 bump 的 META 事务字节**不会**经 `subscribeOwnedUpdates` 投给旧 epoch session（E5.5′ fence 在泵投递前清队）——hub 侧 fence 检测必须自建（§12）。
- F-4 `RegistryTestScheduler.advanceBy` 由测试驱动；**hub 侧 timer 在冻结测试中永不被推进**（driver.ts:475-478 只推进 peer scheduler）——hub 侧行为在测试中必须完全由 inbound/outbound 帧事件驱动（§12/§16 依据）。
- F-5 每 Lease 至多一个活跃 session；Registry.open 每次签发独立 lease → hub 对每个 (connection, namespace) 开**自己的 lease+session**，多 peer 复用同一 Runtime 的单一 observer（ADR 0010 L107）。

---

## §2. 冻结公共契约面（SA6 冻结，逐字段；实现不得增删改名）

主入口 `src/index.ts` 导出（值 + 类型）：

```ts
export interface ReplicationLimits {
  readonly maxFrameBytes: number;          // 8 MiB
  readonly maxBootstrapBytes: number;      // 4 MiB
  readonly maxSyncDiffBytes: number;       // 2 MiB
  readonly maxUpdateBytes: number;         // 512 KiB
  readonly maxQueuedUpdateBytes: number;   // 4 MiB
  readonly maxQueuedUpdateCount: number;   // 256
  readonly maxInFlightUpdates: number;     // 32
  readonly maxQueuedBytesPerConnection: number; // 8 MiB
  readonly lowWater: number;               // 64 KiB
  readonly highWater: number;              // 512 KiB
}
export interface ReplicationTimeouts {
  readonly helloTimeoutMs: number;         // 10_000
  readonly openTimeoutMs: number;          // 5_000
  readonly bootstrapTimeoutMs: number;     // 10_000
  readonly reconcileTimeoutMs: number;     // 10_000
  readonly closeTimeoutMs: number;         // 5_000
  readonly ackTimeoutMs: number;           // 10_000
}
export interface ReplicationBackoff { readonly baseMs: number; readonly maxMs: number; readonly resetAfterMs: number; }
// DEFAULT_REPLICATION_LIMITS / DEFAULT_REPLICATION_TIMEOUTS / DEFAULT_REPLICATION_BACKOFF
//   —— 值 = 上表注释（与 harness CONTRACT_* 逐值一致，Object.freeze 深冻结一层）

export interface DuplexTransport {
  send(bytes: Uint8Array): void;
  close(code?: number, reason?: string): void;
  readonly closed: boolean;
  onMessage(listener: (bytes: Uint8Array) => void): () => void;
  onClose(listener: (info: Readonly<{ code: number; reason: string }>) => void): () => void;
}
export interface ReplicationTimer {
  readonly setTimeout: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
}
export type NamespaceAuthorization =
  | Readonly<{ ok: true; localOwner: NamespaceOwner; permissions: Readonly<{ read: boolean; submit: boolean }> }>
  | Readonly<{ ok: false }>;
export type NamespaceAuthorizer = (instanceIdentity: string, namespaceId: string) => Promise<NamespaceAuthorization>;
export interface ReplicationTarget { readonly namespaceId: string; readonly localOwner: NamespaceOwner; }

export interface HubReplicationOptions {
  readonly instanceId: string;
  readonly registry: NamespaceRegistry;
  readonly authorize: NamespaceAuthorizer;
  readonly timer: ReplicationTimer;
  readonly limits?: Readonly<Partial<ReplicationLimits>>;
  readonly timeouts?: Readonly<Partial<ReplicationTimeouts>>;
}
export interface HubReplication {
  accept(transport: DuplexTransport): HubConnection;
  readonly connections: readonly HubConnection[];
  close(): Promise<void>;
}
export interface HubConnection {
  readonly state: 'handshaking' | 'ready' | 'draining' | 'closed';
  readonly peerInstanceId: string | undefined;
  close(code?: number, reason?: string): void;
}

export interface PeerReplicationOptions {
  readonly instanceId: string;
  readonly hubInstanceId: string;
  readonly registry: NamespaceRegistry;
  readonly dial: () => DuplexTransport;
  readonly timer: ReplicationTimer;
  readonly targets?: readonly ReplicationTarget[];
  readonly limits?: Readonly<Partial<ReplicationLimits>>;
  readonly timeouts?: Readonly<Partial<ReplicationTimeouts>>;
  readonly backoff?: Readonly<Partial<ReplicationBackoff>>;
  readonly random?: () => number;          // 缺省 () => Math.random()
}
export interface PeerReplication {
  start(): void;                            // 幂等
  stop(): Promise<void>;
  addTarget(target: ReplicationTarget): void;      // 幂等（ADR 0010 冻结名）
  removeTarget(namespaceId: string): Promise<void>; // 幂等；未知 nsId → 立即 resolve undefined
  getConnectionState(): PeerConnectionState;
  getNamespaceState(namespaceId: string): PeerNamespaceState | undefined; // 未知 → undefined
}
export type PeerConnectionState =
  | 'stopped' | 'disconnected' | 'connecting' | 'handshaking' | 'ready'
  | 'draining' | 'backoff' | 'blocked';
export type PeerNamespaceState =
  | 'targeted' | 'opening' | 'bootstrapping' | 'reconciling' | 'live'
  | 'needs-resync' | 'closing' | 'closed' | 'conflicted' | 'failed' | 'disconnected';
export function createHubReplication(options: HubReplicationOptions): HubReplication;
export function createPeerReplication(options: PeerReplicationOptions): PeerReplication;
```

`/testing` 子路径（`src/testing.ts`，导出 `createMemoryDuplexTransport(): { peer: DuplexTransport; hub: DuplexTransport }`）：内存双端，一端 `send` → 微任务投递对端 `onMessage`；一端 `close(code,reason)` → 微任务通知对端 `onClose`；与 harness `makeDuplex` 同形（SA6 冻结契约注释明示「本批测试用 harness 内置同形实现」——包仍必须提供，供切片 7/8 与第三方 Host 复用）。

类型来源：`NamespaceOwner` / `NamespaceRegistry` 自 `@nomicore/namespace-registry` import type（公共类型可引用依赖包公开类型名，与 lease.ts 先例一致）。

---

## §3. 总体架构与模块分解

```text
packages/ws-replication/
├── package.json          # deps: yjs/y-protocols/lib0 + workspace(protocol, registry)；devDeps: persistence/vitest/typescript
├── tsconfig.json         # 同 replication-protocol 先例（extends ../../tsconfig.base.json, include src+test）
├── src/
│   ├── index.ts          # 公共面 re-export（§2；无逻辑）
│   ├── types.ts          # 冻结类型 + 内部结构类型
│   ├── defaults.ts       # DEFAULT_* 三常量（冻结值）+ resolve 合并（Partial 覆盖缺省）
│   ├── validate.ts       # §17 构造期响亮校验（同步 TypeError，绝不 clamp）
│   ├── frame-io.ts       # 方向序列纪律、codec 包装、close-code 分类、ERROR 帧构造
│   ├── lifecycle-queue.ts# per-namespace 单一生命周期队列（removeTarget/socket-close/session-close/lease-release 串行 + 合流）
│   ├── round-engine.ts   # sync round 双侧共享引擎（Step1/Step2/Applied 记账 + 违例判定矩阵）
│   ├── update-channel.ts # 单方向 UPDATE 通道：滑动窗口/有界队列/ACK 簿记/溢出（§10）
│   ├── fence-watchdog.ts # 每通道 epoch-fence/session-溢出 watchdog（双节奏，双侧对称——peer 仅 needsResync 边沿，§12）
│   ├── error-mapping.ts  # session 拒绝码/Persistence 事实 → wire ERROR code → 终态（§11）
│   ├── peer-connection.ts# createPeerReplication：连接 FSM + backoff/jitter + 重建编排
│   ├── peer-namespace.ts # peer 侧 target/namespace 控制器（OPEN/bootstrap/round 接线/关闭/重连投影）
│   ├── hub-connection.ts # createHubReplication：accept/HELLO/hub 连接 FSM + 帧分发
│   └── hub-namespace.ts  # hub 侧 per-(conn,ns) 通道（OPEN 矩阵/快照/round/UPDATE/fanout/CLOSE）
└── test/                 # SA6 owned（已存在；SA3 仅可动测试基础设施，禁改断言）
```

数据流（live 期，双向）：

```text
Peer 业务写(lease.mutateRoot, origin=null)
  → peer Runtime fanout → peer session.subscribeOwnedUpdates listener（owned bytes）
  → update-channel（窗口/队列）→ UPDATE frame → wire
  → hub frame-io（decode+limits+序列+状态门）→ hub 通道 submit 门禁
  → hub session.applyRemoteUpdate（唯一 write sequencer：scratch 保护检查→apply→dirty）
  → resolve → UPDATE_ACK frame → peer（清窗口槽位）
  → (同槽产生的 update 经 hub Runtime 单 observer fan-out) → 其他 peer 的 hub 通道 listener
  → UPDATE frame → 其他 peer apply → 其 UPDATE_ACK
```

所有跨层状态为包内私有；对外仅 §2 投影。

---

## §4. 连接层

### §4.1 帧序列纪律（R2 修订：按 ADR 0010 L147 + 协议 §1.2/§13.1 字面；见 §18.8）

- 发送侧：每连接每方向独立 uint32 计数从 1 严格递增（codec `EncodeOptions.sequence`）；peer 的 HELLO 恒为 sequence 1（AC1 锚）。**序列号消费点（R3/#7 钉死）：只在帧实际出队发送时分配**（frame-io 的 dequeue 点单点分配；§4.4 的入队项**不携带、不预占**序列号）——否则控制帧优先插队会造成「实际交付序 ≠ 序列序」→ 接收端按本节判 `SEQUENCE_VIOLATION` 自伤断连（CLOSE/RESYNC/IDENTITY_CHANGED 插队即触发）。「同一连接同一方向按实际交付序严格 +1」列为 SA4 静态 / SA7 动态检查项。
- **出站 uint32 耗尽（R3/#11；R4 nano-note 2 选择注记）**：任一方向发送计数达到 `0xffffffff`（下一帧将回绕）→ 响亮收口：best-effort 发 connection ERROR（`CONNECTION_POLICY_VIOLATION`，safeMessage 静态常量）后 `close(1008)`；**不回绕、不静默错序**（ADR 0010 L147「不回绕」的完备执行面；实践中不可达，防御性定义）。**选择注记**：1008/blocked 不自愈（需 Host 干预）；因序列计数器按连接重置，retryable 分类（1011 → backoff 重连自愈）成本更低——现采保守选择（永久性配置级信号更贴近「计数器不可信」事实），备选形态登记于此供切片 10 复议。
- 接收侧：维护每方向期望值 `expected = lastInbound + 1`（连接/方向首帧期望 1）；**入站帧 sequence ≠ 期望值——无论 gap（> 期望）、repeat 或回退（≤ last）——一律 `SEQUENCE_VIOLATION` connection fatal**：framing 仍可信时 best-effort 发 connection ERROR 后 `close(1002)`（协议 §14）；peer 连接 → `blocked`（§4.3，协议 §15.1「1002/1008：blocked」），hub 连接 → `closed`。
- 依据（ADR 字面，R2 总控裁决 CP-1）：ADR 0010 L147「每方向 sequence 从 1 严格递增，不回绕；**gap、repeat 或错误 ACK 关联关闭连接**」；协议 §1 不变量 2「对端**严格按期望值接收**」、§13.1 `SEQUENCE_VIOLATION`（fatal，1002）。WebSocket 是可靠有序传输，**连接内 gap 在真实传输下不可达**——可达面仅为注入测试与实现缺陷，二者都以断连为正确响应；注入丢帧后的收敛经「fatal close → 重连/重建 → 重新 OPEN/reconcile」达成（受影响冻结用例见 §18.11 对齐清单）。「错误 ACK 关联」对应 §10.3 的 `ACK_STATE_VIOLATION`（never-sent ackedSequence，同为 fatal 1002）。
- 注：「错误 ACK 关联」中「曾被发出但已弃置」的迟到 ACK（§10.4 `zombieSeqs`）不属 never-sent——其传输序合法、关联序曾真实存在，按 §10.2「重复或已包含的 Yjs update 仍正常 ACK」的幂等族处理为良性 no-op（SA8 复审采此解释，列观察项 O-5 相邻、判一致）。

### §4.2 HELLO 握手（协议 §2/§6）

- Peer `dial()` 返回即视为 socket-open（DuplexTransport 无 open 事件——内存双端语义；真实 WS 适配在切片 7 包装）→ 发 HELLO：`peerInstanceId`=options.instanceId、`expectedHubInstanceId`、`protocolVersions=[1]`、capabilities 0/0、16 字节 nonce（`random()` 派生 16 字节，或 `random()` 逐字节——**nonce 不要求密码学强度**，仅握手活性绑定；实现用注入 random 逐字节填充）。armed `helloTimeoutMs`。
- Hub 收 HELLO：校验 `expectedHubInstanceId === options.instanceId`（不等 → `INSTANCE_IDENTITY_MISMATCH`，close 1008）；版本协商 `selectProtocolVersion([1])`；requiredCapabilities ≠ 0 → `UNSUPPORTED_CAPABILITY`；nonce 原样回显；`connectionId = \`${instanceId}-conn-${++counter}\``（单调计数器，受控 observability 标识，无密码学要求）。回 HELLO_ACK。
- HELLO 前的任何 namespace frame → `HELLO_REQUIRED`（close 1002）；重复 HELLO（已 ready）→ `CONNECTION_POLICY_VIOLATION`。
- Peer 收 HELLO_ACK：校验 `hubInstanceId === options.hubInstanceId`、nonce 相等、protocolVersion ∈ 自身支持集 → connection ready。
- Hub 侧 armed `helloTimeoutMs`（hub timer；测试不推进——生产语义完整，测试惰性）。

### §4.3 Peer 连接状态机与 backoff（协议 §15.1）

```text
stopped ──start()──▶ disconnected ──dial──▶ connecting ──HELLO 发出──▶ handshaking
handshaking ──HELLO_ACK──▶ ready
connecting/handshaking/ready ──临时失败（dial throw / socket close 1000|1001|1006|1011 / HELLO timeout）──▶ backoff
handshaking/ready ──永久失败（1002|1008 / INSTANCE_IDENTITY_MISMATCH / UNSUPPORTED_* / ACK_STATE_VIOLATION）──▶ blocked
ready ──stop()/GOAWAY──▶ draining ──namespaces 收口或 deadline──▶ stopped | backoff
backoff ──timer 到期──▶ connecting（重拨）；stop/config-change ──▶ stopped|disconnected
blocked ──config-change（addTarget 触发的重建）──▶ disconnected；stop ──▶ stopped
```

- Full jitter（协议 §15.1 公式）：`cap = min(maxMs, baseMs·2^attempt)`；`delay = random()·cap`；attempt 每次临时失败 +1；ready 稳定 ≥ `resetAfterMs` 后清零（用 timer 安排检查，清零只影响下一次计算的 attempt）。
- 冻结锚（AC6 socket-loss）：base=50/max=400/resetAfter=500、random=0.5 → 首失败 delay=0.5×50=25ms；`advanceMs(25)` → dial#2。AC7 degraded 用缺省 base=100：首失败 delay ≤ 100ms < 25_000ms 推进量 ✓。
- **重建（rebuild）**：目标控制器判定「本连接禁止重开」（§14.1：closed/conflicted/failed ns 的重 add）时：置连接 `disconnected`（带 `rebuildPending` 标志，抑制 backoff 分类）→ `transport.close(1000,'replication-rebuild')` → 立即（同一微任务链）`dial()` 新连接 → 新 HELLO → ready 后对每个非终态 target 重新 OPEN。重建期间所有 namespace 投影 `disconnected`。R2 修订（CP-2）：**溢出恢复不再是重建触发器**——本地队列溢出按协议 §9.4/§17 在**同一连接**发起新 round（§10.5）；重建唯一入口收敛为 §14.1 重开矩阵（协议 §16「重新 add 必须重建连接」）。
- GOAWAY 接收：停止新 OPEN/round；按 reasonCode 分类（`SERVER_RESTARTING`→deadline 后普通 backoff；`SERVER_SHUTTING_DOWN`/`REAUTH_REQUIRED`→blocked）；现有 namespace 到**按 GOAWAY 帧 `drainTimeoutMs` 字段计算的本地 elapsed deadline**（协议 §6.3「接收时开始计算本地 elapsed deadline」；payloads.ts:225 帧字段——**非本地配置项**，冻结 `ReplicationTimeouts` 恰 6 字段，SA3 不得自造配置字段）自然收口后 close。hub 主动 GOAWAY 发送属切片 9，本包只实现接收。

### §4.4 帧发送调度（协议 §17）

连接级双优先级出站队列：control（HELLO/OPEN*/CLOSE*/ERROR/ACK/RESYNC/IDENTITY_CHANGED/SYNC*）恒先、无上限保留额度（超 `maxQueuedBytesPerConnection` → `CONNECTION_BACKPRESSURE` close 1011）；data（UPDATE）走 per-namespace 队列 round-robin（每轮每 namespace 至多一笔）。`lowWater/highWater` 作用于**本包自身记账的连接排队字节**（DuplexTransport 无 `bufferedAmount` 面——真实 WS 的 bufferedAmount 观察属切片 7 适配层；此处按内部队列字节数实现高/低水位暂停/恢复 dequeue，§17 的「Adapter观察 bufferedAmount」在 v1 以内部记账满足，切片 7 登记演进位）。内存双端 send 同步完成，队列即刻排空——调度器结构性存在但测试中零积压。

---

## §5. Peer 侧：target 控制器与 namespace 状态机

### §5.1 Namespace 状态全转移表（`getNamespaceState` 投影）

```text
targeted ──连接 ready 且轮到本 ns──▶ opening（armed openTimeoutMs）
opening ──OPEN_OK(mode0)──▶ bootstrapping（armed bootstrapTimeoutMs）
opening ──OPEN_OK(mode1)──▶ reconciling（round 启动，armed reconcileTimeoutMs）
bootstrapping ──导入完成+BOOTSTRAP_ACK 已发──▶ reconciling（round 启动）
reconciling ──双方向 Step2 均已 apply 且双方向 SYNC_APPLIED 均已收──▶ live
live ──溢出（§10.2）/ 收到对端 RESYNC_REQUIRED──▶ needs-resync（停止新 UPDATE）
needs-resync ──in-flight 窗口收口（ACK 到齐或经 §10.4 弃置）──▶ reconciling（同连接 round+1；§10.4/§10.5——R2 修订：两种触发面统一同连接拓扑）
任意活跃态（opening/bootstrapping/reconciling/live/needs-resync）──removeTarget──▶ closing（armed closeTimeoutMs）
closing ──CLOSE_OK / closeTimeout──▶ closed（终态）
REPLICATION_ID_MISMATCH / REPLICATION_EPOCH_MISMATCH / 收到 IDENTITY_CHANGED──▶ conflicted（终态）
terminal namespace ERROR（§11.2 映射 failed）/ open|bootstrap|reconcile timeout（NAMESPACE_TIMEOUT）/ 内部错──▶ failed（终态）
任意活跃态 ──socket 断开/重建──▶ disconnected（target 保留；重连后按 §13.3 重连规则 / §14.1 重开矩阵恢复）
closed/conflicted ──重开请求──▶ 拒绝 + 整连接重建（§14.1）
```

- `targeted`：已 add 未轮到（连接未 ready 或排队中）。
- 终态（closed/conflicted/failed）后本连接内不再收发该 ns 任何帧；重开仅经重建（I-5）。
- timeout（open/bootstrap/reconcile/close/ack）**只收口 namespace**：置终态、清 timer、走 cleanup 队列（close lease/session）；**不主动发 wire 帧**（对端由其自身 hub 侧 bootstrap/close timer 或连接关闭收口；裁决依据：AC3/AC4 的 timeout 用例断言零重发且不要求任何 ERROR 帧，§18「只收口 namespace」）。ACK timeout 例外：进入 needs-resync 并驱动新 round（同连接），见 §10.4。

### §5.2 OPEN 决策（peer 侧）

连接 ready 后对每个 target（round-robin 逐个发起，简化为顺序发起——单连接内多 ns 的 OPEN 并发度不设上限）：

1. `registry.open(target.localOwner, nsId)`：
   - ok → 持有 lease；读 `lease.getStatus().runtime.replication`：
     - `enabled` → 本地身份 `{rid, epoch}` → OPEN 声明 `hasLocalReplica=true` + 两 identity 字段（同时出现）；
     - `disabled` → **本地响亮终局**：投影 `failed`（local，零 wire 帧，safeMessage 不含身份）；依据 ADR 0010「peer 不得普通 create 一个准备从 hub 复制的同 key namespace」——无谱系副本不可参与复制，bootstrap 亦会在 importReplica 处 `NAMESPACE_ALREADY_EXISTS`，故不静默降级为 bootstrap 尝试（拒绝虚假降级立法）。
   - `NAMESPACE_NOT_FOUND` → 本地无副本 → OPEN `hasLocalReplica=false`（bootstrap 请求）。
   - `REGISTRY_NOT_ACCEPTING`/`NAMESPACE_LOAD_FAILED` → 投影 `failed`（local INTERNAL_ERROR 类），零 wire 帧。
2. 发 OPEN，armed `openTimeoutMs`。
3. 收 OPEN_OK：mode 与声明一致性校验（mode0 ⇔ 声明无副本；mode1 ⇔ 声明身份 === OPEN_OK 身份；否则 `NAMESPACE_STATE_VIOLATION` 终局）；mode1 → 立即 `lease.openReplicationSession({localRole:'peer', remoteInstanceId:hubInstanceId})` → 启动 round（§9）；mode0 → 进入 bootstrapping 等 snapshot。
4. 收 namespace ERROR → 按注册表终态映射（§11.2）。

### §5.3 本地更新订阅（live 上行）

session 打开即 `subscribeOwnedUpdates(listener)`；listener 行为按 ns 状态：

- `live`：交 update-channel（窗口/队列，§10）；
- `reconciling`/`bootstrapping`/`needs-resync`/`opening`：进入同一有界队列（协议 §10「Reconcile期间本地 updates进入有界未发送队列；round完成后发送」），round 完成进 live 后按序发出；期间溢出（§10.2 判据）→ 丢弃全部未发送 + 置 `pendingResync`，round 完成时不进 live 而直接再开新 round（数据由 diff 修复，无丢失——写已落本地 doc）；
- 终态：忽略。

**丢弃安全性论证**：任何被丢弃的增量都已提交本地 Y.Doc；下一 round 的 `encodeDiff(对端 sv)` 必然包含它（state-vector 语义）。因此「丢弃未发送增量」永不丢数据，只丢带宽（ADR 0010 L151 同款论证）。

---

## §6. Hub 侧：accept、连接与 per-namespace 通道

- `accept(transport)` → 新 HubConnection（state `handshaking`）；订阅 transport onMessage/onClose；armed `helloTimeoutMs`。HELLO_ACK 后 `ready`，`peerInstanceId` 可观测。
- 每个 (connection, namespaceId) 一个 `HubNamespaceChannel`：持有**自己的** lease（`registry.open(authorizedOwner, nsId)`，F-5）+ 至多一个 session + 出站 update-channel（hub→peer 方向）。
- 入站帧分发：decode（含 limits）→ 序列纪律（§4.1）→ HELLO 门（§4.2）→ 按 message kind 找 ns 通道。无通道（该 ns 从未在本连接 OPEN）时：namespace-scope 帧（UPDATE/SYNC*/BOOTSTRAP_ACK/CLOSE*/IDENTITY_CHANGED 等）统一 `NAMESPACE_STATE_VIOLATION`（§7.2「OPEN_OK 之前不得收发」的广义面——无生命周期即无合法收发态）。方向纪律（R2.1 澄清措辞，SA8 O-7）：OPEN_NAMESPACE 属 **peer→hub** 方向帧，**hub 侧收到即正常路径、按 §7 OPEN 矩阵处理**；错向面是 **hub 收到 hub→peer 方向专用帧**（消息注册表 direction 域：HELLO_ACK / OPEN_OK / BOOTSTRAP_SNAPSHOT / IDENTITY_CHANGED）——按连接策略拒绝（`CONNECTION_POLICY_VIOLATION`，close 1008）。peer 侧对称：收到 hub→peer 方向帧为正常路径，收到 peer→hub 专用帧（如 HELLO）同码拒绝；唯一例外是 OPEN_NAMESPACE 错向到达 peer——按 §11.2 以 namespace-scope `TARGET_NOT_REQUESTED`（未配置 target）/ `NAMESPACE_STATE_VIOLATION`（状态机不允许）处理（AC2 冻结锚），不作连接级拒绝。
- socket close / `connection.close()` / `HubReplication.close()`：state → `draining`→`closed`；对每个 ns 通道走生命周期队列 cleanup（§13）。
- Hub 连接 FSM：`handshaking → ready → draining → closed`（协议 §15.2，无 dial/backoff）。

---

## §7. OPEN 矩阵（hub 侧；协议 §7 + §19）

处理 OPEN_NAMESPACE（含重复/重开），冻结顺序：

```text
0. ns 已存在于本连接？
   0a. state ∈ {opening, bootstrapping, reconciling, live, needs-resync, closing}
       → 合流：把「再答一次 OPEN_OK/ERROR」挂到在途 open 操作的 Promise 链上（不重复 authorize/不重复 Registry open）
       —— AC1 冻结锚：授权门闩挂起时注入第二个 OPEN，两请求都收到 OPEN_OK，authorize 恰一次。
   0b. state ∈ {closed, conflicted, failed} → ERROR NAMESPACE_REOPEN_REQUIRES_RECONNECT（终态 closed；I-5）。
1. authorize(peerInstanceId, nsId)：
   {ok:false} 或 permissions.read === false → ERROR NAMESPACE_UNAUTHORIZED（failed；未触碰 Registry——不泄露存在性，§7.1）
   **rejection/throw（R3/#6 增补；R4/N-1 扩 seam 清单）**：Adapter 故障（后端不可达/bug）→ 捕获 → ERROR
   INTERNAL_ERROR（failed；同样不泄露存在性——与第 2 步 Registry open 运营失败同款处理）；禁止异常穿透帧处理
   Promise 链（否则 hub 通道滞留 opening + unhandled rejection）。**通用契约（R4/N-1 扩全）**：本包一切
   seam 调用的**异常与拒绝结算**一律在 error-mapping 单点收编为稳定 wire 码或本地终局，零 unhandled
   rejection——async seam：authorize / dial / registry.open / importReplica / openReplicationSession /
   applyRemoteUpdate（ok:false 结果与 rejection 同收）；**同步 throw 面（R4/N-1 补入）**：
   `session.encodeStateVector()` / `session.encodeDiff()` 在终态 session（closed **或** conflicted）
   **同步 throw `ReplicationSessionClosedError`**（replication-session.ts:410/:414；registry types.ts:526
   文档化该契约）——三处编码调用点（§8.1 快照 / §9.1.2 Step1 sv / §9.1.3 Step2 diff）必须 try/catch 后
   交 error-mapping 单点（围栏判别适用域见 §11.1 第 4 步 R4 扩域），禁止 throw 穿透帧分发同步段。
   （SA2 红灯思路 #6：注入 rejecting authorize，断言 INTERNAL_ERROR namespace ERROR + 进程零 unhandled
   rejection；N-1 红灯：fence × 恢复 round 在途 Step1 → 编码 throw → 断言零 uncaught + conflicted 终态。）
2. registry.open(authz.localOwner, nsId)：
   NAMESPACE_NOT_FOUND → ERROR NAMESPACE_NOT_FOUND（failed；仅授权通过者可得此码，§7.1）
   REGISTRY_NOT_ACCEPTING/LOAD_FAILED → ERROR INTERNAL_ERROR（failed）
3. lease.getStatus().runtime.replication：
   disabled → ERROR REPLICATION_NOT_ENABLED（failed）
   enabled → hubIdentity {rid, epoch}
4. 声明比较（OPEN 的 hasLocalReplica + identity）：
   hasLocalReplica=false            → mode 0（bootstrap）
   hasLocalReplica=true 且 rid 不等 → ERROR REPLICATION_ID_MISMATCH（conflicted）
   hasLocalReplica=true 且 epoch 不等 → ERROR REPLICATION_EPOCH_MISMATCH（conflicted）
   hasLocalReplica=true 且全等      → mode 1（reconcile）
   （两 identity 字段恰一出现——codec 层已拒；到达本层即视为合法形状）
5. lease.openReplicationSession({localRole:'hub', remoteInstanceId: peerInstanceId})：
   ok → 通道建立；mode0 → §8 出快照；mode1 → 等待 peer Step1（§9）
   REPLICATION_NOT_ENABLED（竞态：3 与 5 之间被禁用）→ 同码 ERROR
   RUNTIME_WRITE_DISABLED/其余 → ERROR INTERNAL_ERROR（failed）
6. 回 OPEN_OK{mode, hubIdentity}；保存 authz.permissions.submit 供 §11.1 UPDATE 门禁。
```

owner 纪律：wire 的 OPEN 不携带 owner（AC1 全帧扫描锚）；Hub 用**授权结果的 localOwner** 开 Registry（错 owner → `NAMESPACE_NOT_FOUND`，即 AC1「独立 Hub owner 端到端证明」）。

---

## §8. Bootstrap 流水线（协议 §8；AC3）

Hub（mode0 应答路径）：

1. `snapshot = session.encodeDiff(new Uint8Array(0))`（= `Y.encodeStateAsUpdate(doc)` 全量；空 sv=全编码——session 窄能力内的规范等价形式）。**编码异常面（R4/N-1）**：终态 session 同步 throw `ReplicationSessionClosedError` → try/catch 后交 §11.1 围栏判别（R4 扩域 (b)：fence × bootstrap 快照竞态——OPEN(mode0) 处理中 bump）——命中 fence → §12.2 one-shot 终结器（conflicted）；state==='closed' → §13.4 迟到纪律收口；禁止 throw 穿透帧处理同步段。
2. `snapshot.byteLength > limits.maxBootstrapBytes` → ERROR `BOOTSTRAP_TOO_LARGE`（failed；**不分块、不 fallback**，零 snapshot 帧——AC3 冻结锚：帧数 0）。
3. 发 BOOTSTRAP_SNAPSHOT{nsId, hubIdentity, snapshot}（单帧）；armed hub 侧 `bootstrapTimeoutMs` 等 BOOTSTRAP_ACK（fire → ns 收口；hub timer 测试惰性）。**身份读取点（R3/#8 钉死；R4 nano-note 1 措辞校准）**：帧内 `replicationId/replicationEpoch` 在**与 encodeDiff 同一同步段之后**从自有 lease `getStatus().runtime.replication` **重读**（非 §7 step 3 的 OPEN 时读值）——重读**最小化**「帧身份 ≠ 快照内容」的不一致窗口（消除「OPEN 时读 → 编码发送」的大窗口）；**残余窗口安全失败**：bump 落在「encodeDiff 之后、重读之前」时身份(N+1)≠内容(N) → importReplica 按 #133 R2 严格双源不一致拒绝 → BOOTSTRAP_FAILED（有意的安全口径，非缺陷）；重读后被 fence 的竞态由 §11.1 围栏判别/§12 one-shot 终结器收编。

编码一致性注记（ADR 0010 L61「hub 在 write sequencer 中读取复制身份并编码一次完整基线」）：session 的 `encodeDiff` 是同步读取 live Y.Doc 的一致快照（Yjs 事务同步性保证无中间态）；若编码后、对端安装前 hub 又有新提交，该窗口由 **BOOTSTRAP_ACK 后的强制 round 1** 修复（ADR 0010 L67「补齐编码基线与安装之间的竞态窗口」）——这正是协议要求 ACK 后必发 Step1 的原因（AC3 帧序锚：BOOTSTRAP_ACK 的**下一**帧恰为 SYNC_STEP1(roundId=1)）。

Peer（mode0 收到 snapshot）：

1. `detached = new Y.Doc(); Y.applyUpdate(detached, snapshot)`——throw → ERROR `BOOTSTRAP_FAILED`（failed；peer→hub 上报）。
2. 身份核对与排他导入**一并委托** Registry：`registry.importReplica(target.localOwner, nsId, detached, expectedIdentity=OPEN_OK 身份)`（#133 R2：expected 必须来自认证 Hub 广告——OPEN_OK 即绑定源；Registry 在 ownership 转移前完成 META.docId/复制事实/广告一致性核对）：
   - ok → 持有 lease → `openReplicationSession({localRole:'peer', remoteInstanceId:hubInstanceId})` → 订阅（§5.3）→ 发 BOOTSTRAP_ACK{ackedSequence=snapshot 帧 sequence}（此时导入+session 建立完成，协议 §8.2 语义）→ **立即**启动 round（§9，roundId 取 ns 级计数器下一值）→ 投影 reconciling；解除 bootstrap timer。
   - `NAMESPACE_ALREADY_EXISTS`（含并发 duplicate——AC3 竞态锚：importHold 门闩释放前被测试抢占 seed）→ ERROR `BOOTSTRAP_FAILED`（failed；**不重试快照**——AC3 冻结锚：BOOTSTRAP_SNAPSHOT 帧数恰 1）；本地既有副本不被覆盖（importReplica 排他语义）。
   - `NAMESPACE_IMPORT_*` 其余 → ERROR `BOOTSTRAP_FAILED`（failed）。
3. bootstrap timeout（peer timer，armed at OPEN_OK(mode0)，解除于 ACK 发出）：快照未到/导入未完成 → 投影 failed、零 BOOTSTRAP_ACK、零重发（AC3 timeout 冻结锚）；若导入 Promise 仍在途，其 resolve 后发现 ns 已终态 → 仅做 lease/session 静默回收（§13.4 迟到结果纪律）。

BOOTSTRAP_SNAPSHOT 的 replicationId/epoch 与 OPEN_OK 不一致（敌意/缺陷）→ peer 判 `NAMESPACE_STATE_VIOLATION`（failed；不安装）。

---

## §9. Sync-round 引擎（协议 §9；AC4）

每 (ns, 连接生命周期) 维护（两侧对称，角色参数化）：

```ts
interface RoundState {
  currentRound: number;            // 本连接内最近 Peer Step1 的 roundId
  sentStep1: boolean;              // 本端本 round 已发 Step1（每方向每 round 恰一次）
  ownStep1Seq: number | undefined; // 本端 Step1 帧序（校验对端 Step2.relatedStep1Sequence）
  ownStep2Seq: number | undefined; // 本端 Step2 帧序（校验对端 SYNC_APPLIED.ackedSequence）
  receivedStep2: boolean;          // 已收对端 Step2（防重复）
  remoteDiffAppliedLocally: boolean; // 已 apply 对端 Step2 且已发 SYNC_APPLIED
  localDiffAppliedByRemote: boolean; // 已收对端对本端 Step2 的 SYNC_APPLIED
}
// roundId 计数器：peer 侧 per-target 持久于 PeerReplication 实例（跨连接不回绕，见 §14.2）；
//                hub 侧 per-connection 通道记录 lastRound（接受严格更大者）。
```

### §9.1 时序（冻结锚 AC4；R4/N-1：编码调用点均经 error-mapping 单点）

1. Peer 发 Step1(r, `session.encodeStateVector()`) —— round 由 Peer 隐式开始；armed/重置 `reconcileTimeoutMs`（peer timer）。**编码异常面（R4/N-1）**：`encodeStateVector()` 终态同步 throw `ReplicationSessionClosedError` → try/catch 后交 §11.1 围栏判别（R4 扩域 (b)）：命中 fence → §12.2 one-shot 终结器（conflicted）；state==='closed' → §13.4 迟到纪律收口——**禁止 throw 穿透帧处理同步段**。
2. Hub 收 Step1：`r > lastRound` 且本 round 未见过 Step1 → 记账、`lastRound = r`、发自己的 Step1(r, hub sv)（**hub 不自行开始 round**）——hub sv 经 `session.encodeStateVector()`，异常面同第 1 步（fence × 恢复 round 在途 Step1 的核心竞态路径，N-1 红灯场景）。
3. 任一端收 Step1(r)：`session.encodeDiff(对端 sv)` → 发 Step2(r, relatedStep1Sequence=**收到的** Step1 帧序, update=diff)；`encodeDiff()` 异常面同第 1 步收编（fence × Step2 编码竞态）。允许空 diff（y-protocols 空封装 ≤4 字节；AC4 冻结锚不锁定具体字节）。`update.length > maxSyncDiffBytes`（codec 层抛）→ ERROR `SYNC_DIFF_TOO_LARGE`（failed）。
4. 任一端收 Step2(r)：校验 `r === currentRound` ∧ `relatedStep1Sequence === ownStep1Seq` ∧ `!receivedStep2` → `session.applyRemoteUpdate(update)`：
   - ok → 发 SYNC_APPLIED(r, ackedSequence=**收到的** Step2 帧序) → `remoteDiffAppliedLocally = true`；
   - 拒绝映射见 §11（apply 失败即 ns 终局，round 中止）。
5. 收 SYNC_APPLIED(r)：校验 `r === currentRound` ∧ `ackedSequence === ownStep2Seq` ∧ `!localDiffAppliedByRemote` → 置位。
6. 双位为真 → Peer 侧投影 `live`（解除 reconcile timer；若 §5.3 的 pendingResync 置位 → 不进 live，直接再开 round+1）；Hub 侧通道进入 live（接受 UPDATE）。

### §9.2 违例判定矩阵（一律 `SYNC_STATE_VIOLATION`，ns failed；「控制帧不靠 Yjs 幂等性静默吞掉」）

| 入站帧 | 接收侧 | 处置 |
|---|---|---|
| closing / 终态（closed/conflicted/failed）通道收到 SYNC*（Step1/Step2/Applied/RESYNC） | 双侧 | **静默忽略（R4/N-1 补规定）**——与 §11.1 第四类对齐：cleanup 优先、零写入零回发零违例码（§13.4 迟到纪律；迟到的 round 步骤不复活生命周期，一致性由下一连接 round 修复）。非违例（违例矩阵只适用于活跃态通道） |
| SYNC_STEP1 | hub | 违例条件：`r ≤ lastRound`（含同 round 重复——AC4 锚）→ `SYNC_STATE_VIOLATION`（ns failed） |
| SYNC_STEP1 | peer | hub 的 Step1 是对 peer Step1 的合法响应帧：校验 `r === 自己发起的 currentRound` ∧ 本 round 尚未收到过 hub Step1；通过则记账（`ownStep1Seq` 不适用——peer 的 Step1 是自己发的；peer 记录**收到的** hub Step1 帧序供 §9.1.3 的 `relatedStep1Sequence` 回填）并进流程 3；不满足即违例。peer 绝不接受未发起 round 的 Step1 |
| SYNC_STEP2 | 双侧 | 违例条件：`currentRound` 未建立 / `r ≠ currentRound`（错误 round——AC7 锚）/ 本端尚未发 Step1（§7.2 前置）/ `relatedStep1Sequence ≠ 收到的对端 Step1 帧序` / `receivedStep2` 已置 → `SYNC_STATE_VIOLATION` |
| SYNC_APPLIED | 双侧 | 违例条件：`r ≠ currentRound` / `ackedSequence ≠ ownStep2Seq`（本端 Step2 帧序）/ `localDiffAppliedByRemote` 已置（重复控制帧——AC7 锚）→ `SYNC_STATE_VIOLATION` |
| RESYNC_REQUIRED | 双侧 | 非违例（任何活跃态可收）；处置见 §10.6；closing/终态见首行 |

冻结锚核对：AC4「round 开始前的 Step2」（hub 无 currentRound）✓；AC4「同 round 重复 Step1」✓；AC7「同 round 重复 SYNC_APPLIED」✓；AC7「错误 round 500 的 Step2」✓。

### §9.3 reconcile timeout（peer timer）

armed at round 启动，双位为真解除；fire → ns `failed`（NAMESPACE_TIMEOUT 类，零 wire 帧，§5.1）。AC4 冻结锚：丢 hub 的 SYNC_APPLIED → 停在 reconciling → `advanceMs(200)` → failed ✓。

---

## §10. Live UPDATE 通道（协议 §10/§17；AC5/AC6）

每 (ns, 方向) 一个 update-channel：

```ts
interface UpdateChannelState {
  inFlight: Map<seq, { bytes: Uint8Array; }>;   // 已发未 ACK
  zombieSeqs: Set<seq>;                          // ACK-timeout 弃置但序列仍登记（容忍迟到 ACK）
  queued: { bytes: Uint8Array; bytesLen: number }[]; // 未发送（reconcile 期/窗口满）
  queuedBytes: number;
  needsResync: boolean;                          // 本地溢出声明后置位
}
```

### §10.1 发送（live）

listener 交付 update（owned bytes，已独立副本）→ 若 `needsResync`：丢弃（round 将修复）→ 否则：

1. **窗口**：`inFlight.size < maxInFlightUpdates` 且 channel 允许 → 出队/直发：UPDATE 帧（消耗发送序）→ 登记 `inFlight[seq]`，armed ack 计时（单计时器覆盖最老 in-flight，§16）。
2. **队列**：窗口满 → 入 `queued`（FIFO；`Y.mergeUpdates` 合并同类未发送项为可选优化，v1 不做）。

**hub 侧对称条款（R3/#13 成文）**：hub 通道在「对端 bootstrap 进行中 / 本端已声明 RESYNC / 等待 peer 恢复 round」期间同样会收到单 observer fan-out 交付（自有 Runtime 的 null-origin 写与其他 session 的 apply 副本）——镜像 §5.3 语义：非 live 状态下入同一有界 `queued`（同一 UpdateChannelState 结构），溢出（§10.2 判据）→ 丢弃 + pendingResync，恢复 round 完成后 flush 或再开 round（新 round 恒由 peer 发起，hub 侧只按 §10.6 等待）；终局状态忽略交付。

### §10.2 溢出判据（裁决 A-5，§18.5——冻结算术倒推）

新 update 到达时：`pending = inFlight.size + queued.length`；若 `pending ≥ maxQueuedUpdateCount` 或 `pendingBytes + 新 bytes > maxQueuedUpdateBytes` → **溢出**：

- 丢弃**全部** `queued`（含本笔）；置 `needsResync`；发 RESYNC_REQUIRED{reasonCode:'send-queue-overflow'}（本端声明——SA6 裁决 4：触发面取发端 peer 本地未发送队列溢出）；停止新 UPDATE（listener 后续交付直接丢弃）；
- 已发送窗口等待 ACK 或连接断开（协议 §17）。

**第三溢出信号面（R3/#3 登记指针）**：上述判据覆盖**本包 update-channel** 的排队溢出；session 层 fanout 队列（容量 16 冻结常量）溢出以 `session.getStatus().needsResync`（sticky）暴露、其增量**不经过本节通道**——该信号的消费（边沿触发 → §10.2 同构处置）见 §12 检测层，两信号面互补、不重复计数。

判据依据：AC6 冻结测试 `maxInFlightUpdates:1, maxQueuedUpdateCount:1` 下**第二笔**写即须溢出（UPDATE 帧数恰 1 + RESYNC_REQUIRED 恰 1 + needs-resync）——只有把 in-flight 计入 pending 才成立（仅数 queued 时第二笔仅入队、不溢出，测试不可过）；AC5 `maxQueuedUpdateCount:100, maxInFlightUpdates:2` 下三笔写 pending 峰值 3 < 100 不溢出、窗口语义独立成立 ✓。字节数上限同口径（in-flight bytes + queued bytes；配置校验 §15 保证 `maxQueuedUpdateBytes ≥ maxUpdateBytes`，全空窗时单笔必可入队）。

### §10.3 ACK 簿记（双端对称）

- 收 UPDATE_ACK(ackedSequence)：`inFlight.has(seq)` → 删除 + 重置计时；`zombieSeqs.has(seq)` 或已 ACK 过的序列 → **良性 no-op**（幂等容忍）；从未作为 UPDATE 发出过的序列 → `ACK_STATE_VIOLATION` **connection fatal**（发 connection ERROR + close 1002；peer 连接 → `blocked`——AC5 冻结锚 99999）。
- 重复 UPDATE（同 bytes 重放）在接收端照常 apply + ACK（Yjs 幂等——AC5 冻结锚 ACK×2）。
- 接收端 apply 失败/拒绝 → §11 映射的 namespace ERROR（无 ACK）。

### §10.4 ACK timeout → needs-resync（同连接恢复；协议 §18）

ack 计时 fire（peer timer）：**不重发同一 UPDATE**；全部 in-flight 移入 `zombieSeqs`（窗口视为收口——迟至 ACK 良性）；置 needs-resync；**立即**（无需等待，窗口已收口）以 roundId+1 发起新 round（state: needs-resync → reconciling）。修复语义：peer doc 已含该 update 内容，新 round 的 Step2 diff 对「hub 已 apply（ACK 丢失）」与「hub 未 apply」两种情形都收敛。AC6 冻结锚的对应关系（R2 修订注记）：「不重发」断言在无丢帧的真实超时场景下成立；该用例现行以 `dropNextHubToPeer(UPDATE_ACK)` 制造超时——在 §4.1 ADR 字面序列纪律下，hub 后续帧将携带 gap 触发 `SEQUENCE_VIOLATION` fatal，用例须按 §18.11 对齐清单 #4 改为跨连接收敛形态。

### §10.5 溢出路径恢复：同连接新 round（R2 修订：按协议 §9.4/§17 默认拓扑；ADR 0010 L165 单 channel 粒度；见 §18.7）

溢出（§10.2）与 ACK-timeout（§10.4）**统一为同连接恢复拓扑**：

- 溢出时：丢弃全部未发送增量 + 置 needs-resync + 发 RESYNC_REQUIRED（本端声明）+ 停止新 UPDATE；**已发送窗口等待 ACK 或连接断开**（协议 §17 字面）；
- in-flight 窗口收口后（ACK 到齐；或 ACK 迟迟不至时经 §10.4 ackTimeout 弃置收口；或连接断开时转入 §13.3 重连路径），由 **Peer 在同一连接**以 roundId+1 发起新 round（needs-resync → reconciling → live）；丢弃增量与任何在途竞态由新 round 的 state-vector diff 修复（§5.3 丢弃安全性论证）。
- Hub 侧收 RESYNC_REQUIRED（§10.6）：仅作废该 namespace 的增量连续性（丢弃其未发送队列、置 needsResync），**连接与其余 namespace 不受影响**——per-channel 粒度。

**R2 修订记录（CP-2，总控裁决「维持 ADR 字面」）**：round 1 设计曾以 AC6-resync 冻结测试的 wire 帧计数算术（重建后当前 wire 上 SYNC_STEP1 恰 1 帧且 roundId=2）为据，把溢出恢复定为「窗口收口后整连接重建」。SA8 复审判 evolution 级冲突（ADR 0010 L165「普通超限以稳定错误关闭单个 channel；framing、认证等连接级错误才关闭整条连接」+ 协议 §9.4「窗口收口后开始新 round」的默认拓扑），总控裁决回退 ADR 字面：per-namespace 队列超限是 channel 级事件，不得升级为连接级拆除；重建机制唯一入口收敛为 §14.1 重开矩阵（协议 §16 明文的「重新 add 必须重建连接」）。受影响的冻结断言（`step1s.toHaveLength(1)`/`[0]=2` → 同连接下应为 2/`[1]=2`）移交 §18.11 对齐清单 #3。

### §10.6 RESYNC_REQUIRED 接收（对端声明）

- Peer 收到：置 needs-resync、停发新 UPDATE（in-flight 照常等 ACK；迟迟不至时经 §10.4 ackTimeout 弃置收口）；**in-flight 窗口收口后，在同一连接**以 roundId+1 发起新 round（peer 是 round 唯一发起者——§9.4；拓扑与 §10.5 统一）。
- Hub 收到：对该 ns 停发 UPDATE（hub→peer 方向 channel 置 needsResync）、丢弃其未发送队列；等待 peer 新 round。

---

## §11. 错误映射（三层：session/Persistence 事实 → wire code → 终态）

### §11.1 Hub 收 peer UPDATE（状态门 + submit 门 + apply 映射；R3 修订 #1/#2）

```text
1. ns 状态门（R3/#1 收窄——「UPDATE 仅 live 可发」是协议 §10.1 的发送方约束；接收侧
   违例面收窄为「结构性不可有 UPDATE 的状态」，恢复窗口的合法在途 UPDATE 照常接纳）：
   - 无生命周期（从未 OPEN）/ opening（OPEN_OK 未发出）/ bootstrapping（快照未 ACK）
     → ERROR NAMESPACE_STATE_VIOLATION（failed）。—— OPEN_OK 前的 UPDATE 同码
     （SA6 裁决 2；AC7 锚：opening 期注入 UPDATE——冻结锚只钉此场景，不受收窄影响）。
   - 首轮 reconciling（本连接尚未到达过 live）→ 同码 NAMESPACE_STATE_VIOLATION
     （peer 从未 live，不存在合法在途 UPDATE——真违例）。
   - needs-resync / 恢复期 reconciling（本连接到达过 live 后的 round）/ live
     → 照常走 2-4（apply + ACK）。依据协议 §9.4「发出后不再发送新 UPDATE；已接纳
     update 正常 apply/ACK」的对端镜像：hub 声明 RESYNC 后 peer 已发出的在途 UPDATE
     仍应被 apply/ACK；Yjs 幂等保证收敛由后续 round 兜底。
   - closing / 终态（closed/conflicted/failed）→ 静默忽略（零写入、零 ACK、零 ERROR；
     cleanup 优先，一致性由下一连接 round 修复——§13.4 迟到纪律）。
2. submit 门：OPEN 时保存的 permissions.submit === false → ERROR NAMESPACE_UNAUTHORIZED
   （failed；零写入、零 ACK——SA6 裁决 1）。门禁范围=UPDATE（peer→hub 增量提交）；
   SYNC_STEP2 不设此门（AC1 冻结锚：submit:false 的 peer 仍须 bootstrap→reconcile→live，
   其 Step2 在无本地新写时为空 diff；读取路径只受 read 门约束于 OPEN）。
3. 大小门：codec decode limits 抛 UPDATE_TOO_LARGE → 同码 ERROR（failed；零写入零 ACK——AC5 锚）。
4. apply：session.applyRemoteUpdate(update)
   ok                        → UPDATE_ACK(ackedSequence=UPDATE 帧序)   // I-3：resolve 点在 dirty 之后
   ── 拒绝码映射（error-mapping.ts 单点）──
   REPLICATION_RAW_UPDATE_INVALID        → APPLY_FAILED           (failed；AC7 锚 0xff 字节)
   REPLICATION_PROTECTED_FIELDS_CHANGED  → PROTECTED_FIELD_MUTATION (failed；AC7 锚 SCHEMA/META 篡改)
   RUNTIME_WRITE_DISABLED（lifecycle ready ∧ fatal null）→ PERSISTENCE_DEGRADED (failed；recovery——AC7 hub degraded 锚)
   RUNTIME_WRITE_DISABLED（其余：lifecycle≠ready / fatal 置位）→ INTERNAL_ERROR (failed)
   ── R3/#2 围栏判别，R4/N-1 扩适用域（先于 INTERNAL_ERROR 落码）──
   适用域 = **一切 session 能力调用的异常/拒绝结算**（不限于 apply）：
   (a) applyRemoteUpdate 的任一 ok:false 拒绝码；
   (b) encodeStateVector()/encodeDiff() 的同步 throw（ReplicationSessionClosedError——
       §9.1.2 Step1 sv / §9.1.3 Step2 diff / §8.1 快照三处编码调用点，帧处理同步段内捕获）。
   判别：读 session.getStatus()——state === 'conflicted' ∨ currentEpoch !== replicationEpoch
   → 判定已被 epoch fence（bump 槽 E5.5′ 主动 fence 或 apply 槽 R2 被动 fence）→ **走 §12.2
   身份围栏终局路径**（恰一帧 IDENTITY_CHANGED〔one-shot 终结器记忆化〕+ 双侧 conflicted +
   cleanup）——与 §12 watchdog 探测**合流到同一 one-shot 终结器**，两检测面谁先到都产出同一
   确定性终态（协议 §11 效果义务：Peer 进入 conflicted，而非 failed）。
   state === 'closed'（围栏未命中——显式 close/对端 CLOSE/lease release 竞态）→ 按 §13.4 迟到
   纪律收口：cleanup 队列推进 + INTERNAL_ERROR 域本地终局（零 wire 假码）。
   未命中围栏才落下方映射。
   REPLICATION_SESSION_CLOSED / REPLICATION_EPOCH_CONFLICTED（未命中围栏判别——理论不可达，
   防御保留）/ NAMESPACE_LEASE_RELEASED → INTERNAL_ERROR (failed；通道已终局，收口优先)
   ── rejection ──
   RuntimeWriteFatalError                → INTERNAL_ERROR (failed；committed 事实诚实保留在内部，wire 只发安全码)
```

**R3/#2 附注（确定性；R4/N-1 扩面）**：busy 通道上 bump × 在途流量的竞态不再产生 failed/conflicted 二态——帧处理路径的围栏判别成为 fence 的**确定性事件驱动检测钩子**（apply 拒绝码与 encode* throw 都是**同步事实**，在任何 await 让步点之前即成立——watchdog 探测每 8 让步一次无法抢占）；fence × 恢复 round（peer Step1(r+1) 在途时 bump → hub 编码 Step1/Step2 throw）、fence × bootstrap 快照（OPEN(mode0) 处理中 bump）、close × 在途 round 步骤四类竞态统一收编（N-1 红灯：零 uncaught + conflicted 终态）。§12 watchdog 退化为空闲兜底（见 §12 修订）。

degraded 判别依据（避免解析 message 文本）：refusal 后读自有 lease 的 `getStatus().runtime`——`lifecycle === 'ready' ∧ fatal === null` 时 RUNTIME_WRITE_DISABLED 的可达成因只剩 R3 writable 门（DocHandle `persistence-degraded`/released/disposed）与 notifier 缺席（D6.4），全部是持久化域 → `PERSISTENCE_DEGRADED`；`lifecycle ≠ 'ready'` 或 `fatal ≠ null` → 关闭/fatal 域 → `INTERNAL_ERROR`。（AC7 冻结锚：hub `setStatus('persistence-degraded')` → UPDATE 被 session R3 拒 → 本映射出 PERSISTENCE_DEGRADED，hub 零 saveDoc、root 不动；恢复+重连后 round diff 补齐 n=1 ✓。）

### §11.2 wire code → namespace 终态（协议 §13.2；经 `lookupError().terminalState` 单点驱动）

| 收到/产生的 code | 终态投影 |
|---|---|
| TARGET_NOT_REQUESTED / NAMESPACE_UNAUTHORIZED / NAMESPACE_NOT_FOUND / REPLICATION_NOT_ENABLED / NAMESPACE_STATE_VIOLATION / SYNC_STATE_VIOLATION / BOOTSTRAP_TOO_LARGE / BOOTSTRAP_FAILED / SYNC_DIFF_TOO_LARGE / UPDATE_TOO_LARGE / PROTECTED_FIELD_MUTATION / ROLE_VIOLATION / PERSISTENCE_DEGRADED / APPLY_FAILED / NAMESPACE_TIMEOUT / INTERNAL_ERROR | `failed` |
| REPLICATION_ID_MISMATCH / REPLICATION_EPOCH_MISMATCH（及收到 IDENTITY_CHANGED） | `conflicted` |
| NAMESPACE_REOPEN_REQUIRES_RECONNECT | `closed` |
| ACK_TIMEOUT（本地事件） | `needs-resync`（非终态） |

- Peer 收 terminal namespace ERROR → 映射终态 + 停发该 ns 一切帧（AC6 锚：terminal ERROR 后本地写零 UPDATE 帧）+ 生命周期队列 cleanup（§13）。
- Peer 收到 hub→peer 方向 OPEN_NAMESPACE（敌意/错向）：不在 target 集合 → ERROR `TARGET_NOT_REQUESTED`（failed；AC1 锚）；在 target 集合但状态机不允许 → `NAMESPACE_STATE_VIOLATION`。
- ERROR 帧构造：`{kind:'ERROR', code, safeMessage, relatedSequence?, namespaceId?}`——scope/fatal/retryable 由 codec 从注册表导出（调用方不可覆盖）；safeMessage 为静态常量表（error-mapping.ts 单点），**零 owner/token/身份值/update 内容回显**（I-2；AC1/AC2 safeMessage 扫描锚）。

### §11.3 Peer 收 hub UPDATE（hub→peer 应用；R3/#1 状态门收窄）

状态门与 §11.1 第 1 步**同构镜像**（「UPDATE 仅 live 可发」是发送方约束；R2 的 CP-2 把溢出/ACK-timeout 恢复搬回同一连接后，恢复窗口内 hub 通道仍 live、其单 observer fan-out 持续向 peer 投递 UPDATE——needs-resync / 恢复期 reconciling 收到 UPDATE 是**结构性必然**，不是违例）：

- 无生命周期 / opening（OPEN_OK 未收到）/ bootstrapping / 首轮 reconciling → `NAMESPACE_STATE_VIOLATION`（failed；hub 在这些状态不 fan-out，到达即真违例——AC7「OPEN_OK 前的 UPDATE」冻结锚属此类）；
- **needs-resync / 恢复期 reconciling（本连接到达过 live）/ live → 照常 apply + ACK**（协议 §9.4 兼容读法：peer 已声明 RESYNC 后 hub 已发出的在途 UPDATE 照常 apply/ACK；Yjs 幂等，收敛由恢复 round 的 state-vector diff 保证）；
- closing / 终态 → 静默忽略（零写入零 ACK 零 ERROR；§13.4 迟到纪律）。

大小门同 §11.1 第 3 步（code `UPDATE_TOO_LARGE`）；`session.applyRemoteUpdate()`：

- ok → UPDATE_ACK（**即使 peer 本地 persistence-degraded**——session 层 R3 的 hub-to-peer bypass 已裁量：内存 apply + `saveDoc` 登记 + ACK 照发；AC7 冻结锚：peer root=88、peer saveEvents+1、hub 收到 ACK×1——本包零特殊分支，行为完全由 session 层承载）；
- 拒绝/异常映射同 §11.1（含 R3/#2 围栏判别——peer 侧结构性不可达 fence（peer Runtime 永不 bump，ADR 0010 hub-only 管理权），判别作防御性对称保留：命中即按 conflicted 终局收口；peer 侧 RUNTIME_WRITE_DISABLED → `INTERNAL_ERROR`——peer 侧 degraded 走 bypass 不落此分支；落此分支即异常关闭域）。

---

## §12. Identity-fence 与 session 溢出检测（双侧通道；AC6；SA6 裁决 6；R3 修订 #2/#3/#10，R4/N-2 作用域更正）

**问题一（fence）**：epoch bump 在 Runtime bump 槽 E5.5′ 同步 `fanout.fenceStale` → hub 侧 ws-replication session 立即终态 `conflicted` 且**未投递排队项被清空**（F-3）——`subscribeOwnedUpdates` listener 不会收到 bump 字节（这正是「META 管理写字节不得经 raw 回灌」的机制保证，ADR 0010 #134 修订节）；session/lease/Registry 均**无 fence 回调面**（observer.ts 事件清单已核实无复制管理事件）。而协议 §11 要求 hub **主动**在 bump 时发送 IDENTITY_CHANGED 并关闭 ns session（不能等下一笔 peer UPDATE 才被动发现——那会让 peer 在已作废的谱系上继续运行）。

**问题二（session 层 fanout 溢出——R3/#3 新增）**：owned update 到达本包 listener 前先经 session fanout 有界队列（`FANOUT_CHANNEL_QUEUE_CAPACITY=16` 冻结常量，每投递让步 20 微任务）；队列满 → **弃新项 + 置 session `status.needsResync`（sticky，永不清除）**，被丢项永不进入 §10 update-channel——§10.2 判据不触发、无 in-flight 即无 ACK timeout → **健康连接上单向静默发散**。CONTEXT.md《ReplicationSession》词条冻结义务：「fanout 投递有界队列溢出将 session 标记 needs-resync（sticky）——**transport 须 reset/bootstrap**」——消费该信号是本包的成文义务而非裁量。可达性结构性存在：`maxInFlightUpdates` 默认 32 > 16，≥17 次提交落在单个 20 让步窗口内即溢出（冻结测试写突发 ≤3 笔故不暴露；SA2 红灯思路 #3 用 20 笔连发构造）。

**机制（R3 定稿：三层检测面 + 单 one-shot 终结器）**：

0. **确定性事件驱动钩子（fence 主检测面，R3/#2）**：§11.1 的围栏判别——任何 `applyRemoteUpdate()` 拒绝结算时读 `session.getStatus()`（`state==='conflicted'` ∨ `currentEpoch!==replicationEpoch`）→ 命中即进入 §12.2 one-shot 终结器。busy 通道上 bump × 在途流量的竞态由此获得**确定性** outcome（不再依赖探测时序）。
1. **微任务节奏（活跃突发兜底；R4/N-2 作用域更正：双侧对称持有）**：**每条 ns 通道（hub 与 peer 对称）**各持一个 watchdog 实例（同一 `src/fence-watchdog.ts`，职责注释：fence 判据 + session 溢出边沿），每次通道事件（收帧/发帧/apply settle/listener 交付/timer fire/状态迁移）触发一次**有界**自延伸微任务链：每 8 次 `await Promise.resolve()` 探测一次，预算 4096 次让步（512 次探测）后静默退出。**探测谓词（R3/#3 扩编）**：`state !== 'open'` ∨ `currentEpoch !== replicationEpoch` ∨ **`status.needsResync`**——**peer 通道上 fence 两判据结构性不命中**（peer Runtime 永不 bump，ADR 0010 hub-only 管理权），peer 侧 watchdog **仅 `needsResync` 边沿生效**（peer 本地连写突发的唯一发现路径——若按「hub 侧」字面实现则 R1 #3 在 peer 侧复发）；hub 侧三判据全效。**边沿触发（硬约束）**：只在 false→true 跃迁时动作——sticky 标志永不清除，电平触发会每 8 让步重复动作死循环；每通道维护 `lastPredicateValue`。**有界性**同前：无界自延伸链会永久霸占 microtask 队列饿死 macrotask；与 runtime fanout 泵同族，以让步预算替代队列空条件退出。
2. **timer 节奏（空闲兜底，双侧对称同上）**：每 `ackTimeoutMs`（合并配置；无专用配置面——冻结契约不许新增字段）经注入 timer 探测一次（同谓词、同边沿触发、peer 侧仅 needsResync 边沿）并重新武装微任务突发。生产空闲期由该节奏覆盖；fence 的空闲检测延迟 = ackTimeoutMs（协议未设上界，可接受——#2 钩子已覆盖 busy 期）。

**命中分派（按谓词成因；R4.2 澄清 hub 分支——SA4 F1 语义定案，防误读为「只等待零声明」）**：`state!=='open' ∨ currentEpoch!==replicationEpoch`（fence）→ §12.2 one-shot 终结器；`status.needsResync` 边沿（session 层溢出，fence 两项为假）→ **§10.2 同构处置**：丢弃本端未发送队列、置 ns needs-resync、peer 端发 RESYNC_REQUIRED 并在 in-flight 窗口收口后开新 round（§10.5 同连接拓扑）；**hub 侧命中（多 peer fan-out 方向 / hub 通道任一溢出面——§10.2 本地排队溢出与 §12 needsResync 边沿同规）= 声明 RESYNC_REQUIRED + 等待**：丢弃 hub→peer 未发送队列、**发 RESYNC_REQUIRED**（协议 §9.4「任一端可声明」——hub 的声明是 peer 得知、从而发起恢复 round 的**唯一通路**，round 恒由 peer 发起）→ 等待 peer 新 round（§10.6 语义）。「声明 + 等待」与 §10.2/§18.4「hub 溢出同机制声明」一致——**hub 侧不存在「只等待零声明」的分支**（SA4 F1 静默发散根因即该误读）。两分派共享「停止新 UPDATE、由 state-vector round 修复」的收敛骨架（CONTEXT「transport 须 reset/bootstrap」义务的 v1 落地形态：连接内 reset = 新 round；bootstrap 留给重连路径）。

预算量纲论证：AC6 冻结测试从「hub 通道最后一次事件（round 收口进 live）」到「fence 检测可观测窗口耗尽（bump 链 ≈20 让步 + settle() 300 让步 + settleUntil 预算 3000）」约 ≤3.5×10³ 让步；预算 4096 覆盖且留裕量。**耦合不变量（R3/#10 钉死，双向登记）**：`watchdog 预算（4096）> harness settle 预算之和（settle 300 + settleUntil 3000 = 3300）`——SA6 若上调 harness 常量（harness.ts:198/207）须同步复核本不变量（建议在两常量旁登记耦合注释）；#2 钩子落地后 fence 主检测不依赖预算、敏感度下降，预算仅覆盖 needsResync 边沿与空闲 fence。生产成本：每次活动突发 ≤4096 次微任务让步 + 廉价 `getStatus()`，量级亚毫秒、不跨 macrotask 边界饿死定时器。

**§12.2 命中处置（one-shot 终结器——帧处理钩子与 watchdog 探测合流点，记忆化保证恰一帧）**：读自有 lease `getStatus().runtime.replication`（bump 槽 E5.5 已同步整替 → 恒 enabled+新 epoch；防御：disabled/异读 → INTERNAL_ERROR 收口）→ 发 IDENTITY_CHANGED{nsId, replicationId, replicationEpoch=当前身份}（恰 1 帧——AC6 锚；绝不把 META 变更当 UPDATE 发送——hub→peer UPDATE 帧数 0 锚）→ hub 通道终局（conflicted）+ 生命周期队列 cleanup（session 已终态，`close()` 幂等无害；lease release）。Peer 收 IDENTITY_CHANGED → 校验 nsId → 投影 `conflicted`、**零 apply**（控制帧不进 sequencer；本地 META/epoch 不变——AC6 锚 peer epoch 保持 1）→ cleanup。

**演进位（登记 §23）**：ReplicationSession 增加 append-only 终态/溢出回调（如 `onTerminal(cb)` / `onNeedsResync(cb)`）后，watchdog 退化为纯事件驱动，微任务突发删除。该登记建议进 ADR 0010 增补节（收口动作在切片 10）。

---

## §13. Close、cleanup 与生命周期队列（协议 §12/§16/§21；AC6/AC7）

### §13.1 单一生命周期队列 + 合流（per target/通道；R3/#5 状态矩阵补全）

`lifecycle-queue.ts`：每 peer target / hub 通道一条 Promise 串行链，只接受四类操作（`removeTarget`、socket-close cleanup、session-close、lease-release）；cleanup Promise **记忆化合流**——并发 `removeTarget ×2` → 同一 Promise、恰一个 CLOSE 帧（AC7 锚）。`removeTarget(namespaceId)` **× ns 状态全矩阵**：

| ns 当前状态 | removeTarget 行为 |
|---|---|
| 未知 nsId（无 target） | 立即 resolve `undefined`（幂等，AC1 锚） |
| `targeted`（尚未发 OPEN——hub 无通道） | **本地收口**：intent=removed、投影 `closed`、结算 cleanup Promise（无 lease/session 可清）、**零 wire 帧**（若照发 CLOSE，hub 按 §6 无通道规则回 `NAMESPACE_STATE_VIOLATION`——结构性多余帧，禁） |
| `disconnected`（transport 已关，CLOSE 无处可发） | 同上本地收口（投影 `closed`、零 wire 帧；lease/session 若残留则走静默回收） |
| 活跃（opening/bootstrapping/reconciling/live/needs-resync） | 同步置 intent=removed + 投影 `closing` → 入队：发 CLOSE_NAMESPACE{reasonCode:'target-removed'} → armed `closeTimeoutMs` → 等 CLOSE_OK（fire → 不再等待，本地收口 closed——「正常 close 不等待丢失的 UPDATE_ACK」同源语义：也不无限等待 CLOSE_OK） |
| `closing`（已在收口） | 合流到在途 cleanup Promise（记忆化） |
| 终态 `closed` | 复用已结算 cleanup Promise |
| 终态 `conflicted` / `failed`（cleanup 已结算） | 立即 resolve；intent=removed，投影迁移 `closed`（target 移除是显式生命周期关闭——conflicted/failed 事实保留在内部诊断，投影以 closed 为最终 target 状态）；零 wire 帧 |

**closing 中到达 terminal namespace ERROR（R3/#5d）**：维持 closing 语义、收敛 `closed`（终态不降级原则的收口方向——移除意图优先于迟到终局分类；§13.4 迟到纪律扩至「迟到 ERROR/IDENTITY_CHANGED」：closing 期收到的一切 terminal 帧只推进收口、不再改判终态类别、零回发帧）。

### §13.2 Hub 收 CLOSE_NAMESPACE / peer 收 CLOSE_NAMESPACE（对称）

接收端**同步**停止该 ns 帧接纳 → 等待**已被 sequencer 接纳的 apply** 结算（本包记录的在途 `applyRemoteUpdate()` Promise 集合；AC7 锚：saveGate 挂起期 CLOSE_OK 恒 0、apply 完成后 hub root=1 不丢）→ `session.close()`（barrier 语义：resolve 点=已接纳槽排空）→ `lease.release()` → 回 CLOSE_OK{ackedSequence=CLOSE 帧序}。**绝不在 sequencer 槽内 await cleanup**（§12/§21——实现上 cleanup 全部在包自己的微任务上下文，session.applyRemoteUpdate 的槽体不含任何 ws 逻辑）。

### §13.3 Socket 断开（双侧，§16）

- Peer：全部活跃 ns → 投影 `disconnected`（target 保留）；逐 ns：停接纳 → 退订 → `session.close()`（等已接纳 apply 排空——AC7 锚：gate 释放后 hub n=1）→ lease release；连接进 backoff。断线期间 listener 不可达（session 终态 no-op 订阅）→ 断线本地写**零 UPDATE 帧**（AC6 锚——无 outbox 的结构性保证）。
- Hub：对断开 peer 的每个 ns 同款 cleanup（不影响其他 peer——通道隔离）。
- 重连：新连接 HELLO 后对每个 target：终态 `failed` → 重开（§16「等待连接重建」）；`closed`/`conflicted` → 跳过（其 re-add 才触发重建）；活跃/`disconnected` → 重开。重开路径必为 reconcile/bootstrap 按 §5.2 重新判定；修复靠 round diff（AC6 锚：wire2 含 OPEN、零 UPDATE 重放；extra=55 经 diff 收敛）。

### §13.4 迟到结果纪律

任何异步操作（authorize、import、apply、CLOSE_OK…）resolve 时发现自己所属 ns 已终局/连接已断：只做资源回收（lease.release / session.close），**零 wire 帧、零状态机迁移**（终态不降级、不复活）。

### §13.5 停机（stop()/HubReplication.close()）

- `stop()`：停止接纳 →（可选 GOAWAY——hub 侧发向属切片 9，本包 hub.close 直接 close(1001)）→ 对每个 ns 走 §13.1 close 流程（drain 已接纳 apply，不等丢失 ACK）→ 等待全部 cleanup Promise → 关 transport → `stopped`。
- `HubReplication.close()`：全部连接 `close(1001,'hub-shutdown')` → 等全部通道 cleanup → resolve。

---

## §14. 重开、重建与 roundId 计数器

### §14.1 重开矩阵（§16 + I-5；R3/#4 补 blocked 裁决）

| 请求/事件 | 同连接行为 |
|---|---|
| OPEN（wire）对 closed/conflicted/failed ns | `NAMESPACE_REOPEN_REQUIRES_RECONNECT`（AC1/AC6 锚：错误 owner/身份的注入 OPEN 亦经此路径——hub 对终局 ns 一律先查终态再处理） |
| `addTarget` 对 closed ns（连接仍 ready） | **整连接重建**（§4.3）后新连接 OPEN |
| `addTarget` 对 conflicted/failed ns（连接 ready） | conflicted：重建（冲突是配置级状态，重开需新生命周期）；failed：同连接不可重开（I-5）→ 重建 |
| `addTarget` 幂等（**连接非 blocked 时**） | 活跃/opening 中重复 add → 合流，零新 OPEN 帧（AC1 锚） |
| **`addTarget`（连接 blocked 时，R3/#4 裁决）** | **任何 addTarget——含对既有活跃/opening/disconnected target 的重复 add——一律视为 config-change → 整连接重建**（§4.3「blocked ──config-change──▶ disconnected」的完整读法；§18.11 #4 修订后的冻结用例正依赖此路径：blocked + 重复 add 既有 target → 重建 → live）。幂等合流行**仅适用于非 blocked 连接**——两条规则不再互斥。扰动界限：blocked 下重复 add 触发的重建风暴由 Host 配置纪律约束（addTarget 本就是配置动作），v1 接受该代价 |
| 新连接（重连/重建后） | failed/disconnected/活跃 → OPEN；closed/conflicted → 跳过等显式 re-add |

### §14.2 roundId 计数器作用域（R2 修订）

计数器 per-target 持久于 PeerReplication 实例（跨连接不重置、不回绕；uint32 溢出 → 响亮 INTERNAL_ERROR 终局——实践不可达）。

- 协议依据：§1「连接内不回绕」只约束连接内单调，不禁止新连接从更高值开始；hub 侧按「严格大于 lastRound（新连接初值 0）」接受任意首 round——两种作用域（per-connection 重置 / per-target 持久）均协议合法。
- R2 定案（CP-2 后）：溢出与 ACK-timeout 恢复统一同连接新 round（§10.5），round 1 曾以「溢出重建 wire2 首轮=r2」为持久性依据的算术随之作废；现采 **per-target 持久**作为保守选择——同一 namespace 的 roundId 在其整个 target 生命周期内全局唯一，使任何跨连接场景（重连 reconcile、re-add 重建）下 roundId 不被重用，hub/测试无需区分「新连接的首 round」与「延续 round」。bootstrap 从未开始 round 的中断连接不消耗计数器 → 该场景 wire2 仍从 r1 起（AC3 bootstrap round=1 锚相容；AC6 bootstrap 中断线用例无 roundId 断言）。

---

## §15. §17 构造期响亮校验与默认值

### §15.1 校验（`validate.ts`；同步 `TypeError`，绝不运行时 clamp）

`createHubReplication` / `createPeerReplication` 构造期（合并 Partial 覆盖 DEFAULT 后对**合并结果**校验）：

```text
instanceId / hubInstanceId 不匹配 ^[a-z][a-z0-9-]{0,62}$        → TypeError
registry/authorize/dial/timer 形状门（缺成员/非函数）            → TypeError
limits：
  maxBootstrapBytes ≤ maxFrameBytes − PROTOCOL_OVERHEAD_BYTES(128)
  maxSyncDiffBytes  ≤ maxFrameBytes − 128
  maxUpdateBytes    ≤ maxFrameBytes − 128
  maxQueuedUpdateBytes ≥ maxUpdateBytes
  maxInFlightUpdates ≥ 1
  所有 limit 为正有限安全整数
  lowWater < highWater（两者为正有限安全整数）
timeouts：六个均为有限安全整数 > 0
backoff：baseMs/maxMs/resetAfterMs 为有限安全整数 > 0 ∧ baseMs ≤ maxMs
```

冻结锚（AC7）：`{maxInFlightUpdates:0}` ✗ TypeError；`{lowWater:1024,highWater:512}` ✗；`{maxUpdateBytes:16MiB, maxFrameBytes:8MiB}` ✗；`{lowWater:256,highWater:512,maxInFlightUpdates:1}` ✓ 不抛。Partial 合并语义：显式字段**整值替换**缺省（无逐字段 clamp——「不得运行时 clamp」）。

### §15.2 DEFAULT 值（冻结，与 harness `CONTRACT_*` 逐值一致）

见 §2 注释（limits 10 字段 / timeouts 6 字段 / backoff 3 字段）。全部 `Object.freeze`。

---

## §16. Timer 清单（全部经注入 `ReplicationTimer`；零 native timer——SA4/SA7 静态守卫目标）

| timer | 侧 | armed | 解除/触发 |
|---|---|---|---|
| helloTimeoutMs | peer+hub | HELLO 发出 / accept | HELLO_ACK 解除；fire → 连接级收口（peer → backoff；hub → close） |
| openTimeoutMs | peer | OPEN 发出 | OPEN_OK/ERROR 解除；fire → ns failed（零 wire） |
| bootstrapTimeoutMs | peer | OPEN_OK(mode0) | BOOTSTRAP_ACK 发出解除；fire → ns failed（零 wire、零重发——AC3 锚） |
| bootstrapTimeoutMs（等 ACK） | hub | SNAPSHOT 发出 | BOOTSTRAP_ACK 解除；fire → ns 收口（测试惰性） |
| reconcileTimeoutMs | peer | round 启动 | 双 Applied 解除；fire → ns failed（AC4 锚） |
| ackTimeoutMs | peer（+hub 对称） | 最老 in-flight UPDATE 存在时 | 全部 ACK 解除；fire → §10.4 needs-resync |
| closeTimeoutMs | peer（+hub 对称） | CLOSE_NAMESPACE 发出 | CLOSE_OK 解除；fire → 本地收口 closed |
| backoff delay | peer | 临时失败 | fire → connecting 重拨（AC6/AC7 锚：25ms / ≤100ms） |
| resetAfterMs 检查 | peer | 进入 ready | fire 且仍 ready → attempt=0 |
| fence/session-溢出 watchdog 空闲节奏（R3 扩谓词；R4/N-2 侧更正） | hub + peer（双侧对称；peer 仅 needsResync 边沿生效——fence 判据结构性不命中） | 通道活跃期 | 每 ackTimeoutMs 探测（hub：state/currentEpoch/needsResync 边沿；peer：needsResync 边沿）+ 重武装（§12） |

---

## §17. `/testing` 子路径

`createMemoryDuplexTransport()`：`{peer, hub}` 两端 `DuplexTransport`；send → `bytes.slice()` → `queueMicrotask` 投递对端 listeners；close → 微任务通知对端 closeListeners `{code, reason}`；`closed` 立即置位。与 harness `makeDuplex` 行为同形（SA6 冻结注释），实现独立、零 harness 依赖。

---

## §18. SA6 六条裁决注记落实 + SA1 补充裁决

### 18.1（SA6-1）submit:false 的 wire 码 = `NAMESPACE_UNAUTHORIZED`

落实：§11.1.2——门禁范围**仅 UPDATE**（Step2 不设门，否则 submit:false peer 无法达到 live，违背 AC1 冻结锚「submit:false → 先 live 再拒绝写」）。断言面：拒绝 + 零写入 + 无 ACK + ns 收口 failed。Spec 轴修正点单点化于 `error-mapping.ts`。

### 18.2（SA6-2）OPEN_OK 前的 UPDATE → `NAMESPACE_STATE_VIOLATION`

落实：§11.1.1 状态门（opening/bootstrapping/reconciling 均非 live）+ §9.2（sync 帧无 round 上下文 → `SYNC_STATE_VIOLATION`；AC4「round 前 Step2」用后者）。

### 18.3（SA6-3）不可解码 update → `APPLY_FAILED`

落实：§11.1.4 映射 `REPLICATION_RAW_UPDATE_INVALID → APPLY_FAILED`。注意分层：注入的 `0xff…` 字节在 **codec 层可解码**（合法 varUint8Array），失败发生在 session 槽 R4 scratch 预演（Yjs 拒收）→ 拒绝码映射即达 `APPLY_FAILED`；live 零写入由 session 层零触碰保证（AC7 锚）。

### 18.4（SA6-4）RESYNC_REQUIRED 触发面 = 发端（peer）本地未发送队列溢出后声明

落实：§10.2（peer 发端溢出声明）+ §10.6（hub 亦可声明——协议 §9.4「任一端」，hub 溢出同机制；恢复 round 恒由 peer 发起）。

### 18.5（SA1-A5）溢出判据含 in-flight（pending = inFlight + queued）

依据：AC6-resync 冻结算术（cap=1 时第二笔写即溢出）+ AC5（cap=100 三笔不溢出）联立的唯一解；§17 配置约束 `maxQueuedUpdateBytes ≥ maxUpdateBytes` 在该口径下自洽（空窗单笔必可发送/入队）。

### 18.6（SA6-5）空 diff = y-protocols 自然封装（≤4 字节）+ 应用后状态向量不变

落实：不锁定字节——Step2 直接携带 `encodeDiff` 产物；AC4 空 diff 用例走完整 Step2/Applied（§9.1.3「允许空 diff」），投影不变由 Yjs 幂等保证。本设计零字节级特判。

### 18.7（R2 修订）队列溢出的恢复拓扑 = 同连接新 round（ADR 0010 L165 + 协议 §9.4/§17 字面）

定案：溢出 → 丢弃+needs-resync+RESYNC_REQUIRED → 等 in-flight 窗口收口 → **Peer 在同一连接**以 roundId+1 发起新 round（§10.5）；per-namespace 队列超限是 channel 级事件，不得升级为连接级拆除（ADR 0010 L165「普通超限以稳定错误关闭单个 channel；framing、认证等连接级错误才关闭整条连接」）。**修订史**：round 1 设计曾以 AC6-resync 冻结测试的 wire 帧计数算术为据采「整连接重建」拓扑；SA8 复审 CP-2 判 evolution 级冲突，总控裁决（2026-08-30）走「维持 ADR 字面」路径回退，无 ADR 增补；受影响断言移交 §18.11 对齐清单 #3。roundId 计数器作用域（§14.2）相应改为保守的 per-target 持久（不再由重建算术倒推）。

### 18.8（R2 修订）入站序列纪律：gap/repeat/错误 ACK 关联一律 `SEQUENCE_VIOLATION` fatal（ADR 0010 L147 字面）

定案（§4.1）：入站帧 sequence 严格等于期望值（last+1）；**gap、repeat/回退一律 `SEQUENCE_VIOLATION` connection fatal（close 1002，peer → blocked）**；「错误 ACK 关联」= never-sent ackedSequence → `ACK_STATE_VIOLATION`（§10.3，同为 fatal 1002）。WebSocket 可靠有序传输下连接内 gap 不可达——fatal close 是对注入/缺陷的正确响应，注入丢帧后的收敛经「fatal close → 重连/重建 → 重新 OPEN/reconcile」达成。**修订史**：round 1 设计曾以冻结丢帧测试（同连接丢 SYNC_APPLIED/UPDATE_ACK 后继续收敛）为据采「跳跃容忍」形态；SA8 复审 CP-1 判 evolution 级冲突（测试为代码、非约束基准；§1.9 修复清单不含连接内丢帧），总控裁决回退 ADR 字面；受影响用例移交 §18.11 对齐清单 #2/#4/#5/#6/#7。

### 18.9（SA6-6 + SA1-A9）IDENTITY_CHANGED 经 Hub bump 触发

落实：§12 fence-watchdog（双节奏）+ §12.2 处置。SA1-A9 为其可行性论证：session 层无 fence 回调（源码核实：observer.ts 事件清单、E5.5′ 清队时序、hub timer 测试惰性 F-4）→ 双节奏探测是当前分层下唯一确定性机制。

### 18.10（SA1-A10）冻结测试 `ws-replication-ac1-ac2-open.test.ts` 尾部断言的算术冲突登记

`AC1 幂等` 用例末两条断言联立无解：`expect(run.wires.length).toBeGreaterThan(1)`（要求 ≥2 条 wire ⇒ 重建=新拨号）与 `expect(run.frames()…HELLO).toHaveLength(2)`（`frames()` 恒取**最后一条** wire（driver.ts:167-171/189-194 已核实），单连接单 HELLO（协议 §2）⇒ 最后一条 wire 至多 1 个 HELLO）。任何「一次拨号一个 HELLO」的实现都无法同时满足；满足计数 2 的唯一读法是全连接聚合（即 `peerFramesAll`）。本设计采协议正确形态（重建=新拨号+新 HELLO，1/wire），该断言预期失败并登记为 §18.11 对齐清单 #1。除此之外该用例全部断言（OPEN×1、幂等 remove、CLOSE×1、dialCount↑、wires↑、live）本设计均满足。

### 18.11 冻结测试对齐清单（移交 SA6）

> R2 修订产物。CP-1（序列纪律回退 ADR 0010 L147 字面）与 CP-2（溢出恢复回退协议 §9.4/§17 同连接拓扑）使以下 SA6 冻结用例在 ADR-literal 实现下**预期红**。测试文件归 SA6 所有，本清单只列修订点与期望新形态（含断言级建议），供总控转派 SA6 执行；实现侧（SA3）以本设计为准、不得为迁就现行断言偏离 ADR。清单外用例已逐一核对在 ADR-literal 形态下仍绿（核对记录见清单后附注与 §22 映射表）。

| # | 文件 | 用例 | 受影响断言（现行） | 根因 | 期望新形态（ADR-literal） |
|---|---|---|---|---|---|
| 1 | `ws-replication-ac1-ac2-open.test.ts` | AC1 幂等 addTarget/removeTarget（尾断言，§18.10） | `expect(run.frames().peerToHub.filter(HELLO)).toHaveLength(2)` | 算术冲突（与 `wires.length>1` 联立无解；重建=新拨号 ⇒ 最后 wire 恰 1 个 HELLO） | 改 `run.peerFramesAll('HELLO')` → 2（全连接聚合；行为不变），或改当前 wire → 1 |
| 2 | `ws-replication-ac4-reconcile.test.ts` | 重复 Step1（同 round） | `await run.waitNamespace('failed')`（用例先 `dropNextHubFrame('SYNC_APPLIED')` 再注入重复 Step1） | CP-1：hub 的 SYNC_STATE_VIOLATION ERROR 帧到达 peer 时携带 gap → peer 先判 `SEQUENCE_VIOLATION` fatal → ns 投影 `disconnected`、连接 `blocked` | 保留 `errorCodes(run.hubFrames('ERROR'))` 含 `SYNC_STATE_VIOLATION`（hub 判定不变，帧仍在 wire 上）；终态断言改 `waitNamespace('disconnected')` + `connectionState()==='blocked'`；或去掉前置 drop（hub→peer 方向无丢帧、序列连续，保留 failed 断言） |
| 3 | `ws-replication-ac6-resync-close.test.ts` | RESYNC_REQUIRED（队列溢出） | `expect(step1s).toHaveLength(1)` + `step1s[0].syncRoundId === 2` | CP-2：同连接恢复 ⇒ 当前 wire 上 SYNC_STEP1 = [r1(bootstrap), r2(恢复)] 两帧 | 改 `toHaveLength(2)` + `step1s[1].syncRoundId === 2`；其余断言（RESYNC_REQUIRED×1、UPDATE×1、needs-resync、hub extra=2/n=1）不变 |
| 4 | `ws-replication-ac6-resync-close.test.ts` | ACK timeout | `run.wire.dropNextHubToPeer(UPDATE_ACK)` 后 `waitNamespace('needs-resync')` → `waitNamespace('live')` + 同 wire `SYNC_STEP1[1]` 断言 | CP-1：恢复 round 的 hub Step1 响应携带 gap → `SEQUENCE_VIOLATION` fatal → blocked，同连接 `live` 不可达 | 跨连接收敛形态：丢 ACK → needs-resync（timer 锚保留）→ Step1(r2) 发出后 hub 响应触发 fatal → 断言 `blocked`/`disconnected` → 测试侧再 `addTarget(target)`（config-change 重建，§14.1）→ 重连 re-OPEN/reconcile → `live` + `hub n=9`；「不重发同一 UPDATE」断言沿全帧聚合基面（`peerFramesAll`）保留 |
| 5 | `ws-replication-ac6-resync-close.test.ts` | 正常 close（不等待丢失 ACK） | `run.dropNextHubFrame('UPDATE_ACK')` 后继续同连接 CLOSE/REOPEN 断言（注入 OPEN → REOPEN_REQUIRES_RECONNECT） | CP-1：CLOSE_OK 携带 gap → fatal close；wire 关闭后测试注入帧不可达 hub（peerEnd 已 closed，send 静默丢弃） | 「close 不等待 ACK」改以无丢帧形式表达（如以 saveGate 悬挂在途 apply、断言 CLOSE_OK 只在 apply settle 后发出——与 AC7 cleanup 竞态用例同构）；REOPEN_REQUIRES_RECONNECT 断言移入无丢帧上下文（AC1/AC2 的注入式 reopen 用例已覆盖同语义） |
| 6 | `ws-replication-ac7-faults.test.ts` | 重复控制帧（同 round 重复 SYNC_APPLIED） | `await run.waitNamespace('failed')`（先 drop hub 的 SYNC_APPLIED 再注入重复 Applied） | 同 #2 | 同 #2 形态：hub 的 `SYNC_STATE_VIOLATION` ERROR 帧断言保留；peer 终态改 `disconnected` + `blocked`；或去 drop 保 failed |
| 7 | `ws-replication-ac7-faults.test.ts` | 错误 round（SYNC_STEP2 roundId=500） | `await run.waitNamespace('failed')`（先 drop hub 的 SYNC_APPLIED 再注入 Step2(500)） | 同 #2 | 同 #2 形态 |

**不受影响用例（R2 逐一核对，ADR-literal 形态下仍绿）**：AC1/AC2 其余全部（无连接内丢帧）；AC3 全部（bootstrap-timeout 用例丢帧后 hub 再无后续帧、gap 不可观测，timeout 收口路径不变；duplicate 用例为 importHold 门闩、非丢帧）；AC4 幸福路径 / 缺 Applied timeout（丢帧后 hub 静默至 peer reconcile timeout 收口 failed）/ 错序 Step2（hub ERROR 帧序列连续、peer 正常处理为 failed）/ 空 diff；AC5 全部（saveGate 是时延不是丢帧；所有注入帧序列均按 nextSeq 正确）；AC6 terminal ERROR / IDENTITY_CHANGED / socket 断开 / bootstrap 中断线（closePeerSide 前无丢帧；wire2 序列重置从 1 起）；AC7 错序 OPEN_OK 前 UPDATE / APPLY_FAILED / 保护检查×2 / degraded×2 / cleanup 竞态×2 / 合流 / 构造校验（均无连接内丢帧）。

**R3 追加（新测试候选——非冻结断言修订）**：SA2 R1 攻击评审（`task_phase5-ws-namespace-sync_sa2_review.md` §红线测试思路；R4/nano-note 3 更正轮次笔误——导致设计 R3 修订的是 SA2 的 R1 评审）为 #1–#7 漏洞给出 7 个**新增**红灯 IT 方向，全部与 R3 修订后的设计形态一致、不影响既有冻结断言，移交总控供 SA6 按需补测：① 恢复窗口 UPDATE 容忍（saveGate 悬挂 → ackTimeout → 恢复期 hub UPDATE 照常 apply+ACK、零 NAMESPACE_STATE_VIOLATION、回 live）；② bump×流量竞态终态确定（bump 后立即注入 UPDATE → conflicted 恰一帧 IDENTITY_CHANGED、无 INTERNAL_ERROR）；③ session fanout 溢出消费（连发 20 笔本地写 → RESYNC/新 round → hub 收敛 n=19；**peer 本地写为暴露面——N-2 修订后 peer 侧 watchdog 生效的前提**）；④（已有 §18.11 #4 覆盖，设计侧矩阵已消解互斥）；⑤ removeTarget 不可达路径 ×3（targeted/disconnected/终态 → 零帧本地收口 closed；closing 中 terminal ERROR → closed 非 failed）；⑥ authorize rejection（throwing adapter → INTERNAL_ERROR namespace ERROR + 零 unhandled rejection）；⑦ 序列分配点（saveGate 积压 ≥2 → CLOSE 插队 → 到达序严格 +1）。**R4 追加（N-1 红灯）**：⑧ fence × 恢复 round（peer Step1(r2) 在途时 bumpHubEpoch → hub 编码面同步 throw → 断言零 uncaught、peer 终态恰 conflicted、IDENTITY_CHANGED 恰 1、无 INTERNAL_ERROR）；变体：OPEN(mode0) 处理与 bump 竞态 → conflicted（非 BOOTSTRAP_FAILED 卡死/崩溃）。

---

## §19. 协议假设依据 (Protocol Assumption Evidence)

| # | 假设 | 依据类型 | 依据内容（具体引用） | 风险 |
|---|---|---|---|---|
| P-1 | DuplexTransport 无 open/bufferedAmount 事件；dial() 返回即可发帧 | 源码引用 | 冻结契约面（任务简报 §SA6 冻结契约面 L79-81）+ harness `makeDuplex`（harness.ts:491-526，send 即投递、无 open 事件）；driver `dial`（driver.ts:410-416） | 低 |
| P-2 | `RegistryTestScheduler.advanceBy` 仅由测试对 **peer** scheduler 调用；hub timer 测试惰性 | 现有测试引用 | driver.ts:475-478（唯一 advanceBy 调用点，仅 `run.peerNode.scheduler`）；全 test 目录 grep 无 hubNode.scheduler.advanceBy | 中（已按此约束设计 hub 侧行为为纯事件驱动 + §12 双节奏） |
| P-3 | `applyRemoteUpdate()` resolve ⟺ sequenced apply + `saveDoc` 完成（ACK 时序锚） | 源码引用 | replication-session.ts R5/R6（:638-676：apply → `await notifyDirty()` → `{ok:true}`）；harness saveGate 门闩语义（harness.ts:362-370） | 低 |
| P-4 | bump 槽 E5.5′ 在泵投递前 fence 并清队（bump 字节不达 hub 通道 listener） | 源码引用 | replication-write.ts:403-423（transact → E5.5 整替 → E5.5′ fenceStale，同一同步段）+ replication-session.ts finalize（:380-386 清队）与泵（:216-241 让步后重检） | 低（决定 §12 自建检测） |
| P-5 | codec 层字段超限抛 `UPDATE_TOO_LARGE`/`BOOTSTRAP_TOO_LARGE`/`SYNC_DIFF_TOO_LARGE`（供 hub 大小门直接映射） | 源码引用 | payloads.ts:611-622/471-484/550-563（decode+encode 双侧检查） | 低 |
| P-6 | `lookupError(code)` 提供 scope/fatal/retryable/wsCloseCode/terminalState（ERROR 帧元数据与终态映射单点） | 源码引用 | replication-protocol src/errors.ts:60-75（ErrorInfo）+ index.ts 导出 | 低 |
| P-7 | Registry.open 的 NOT_FOUND 语义覆盖「缺失」与「owner 不符」（hub 授权 owner 证明 + peer hasLocalReplica 探测复用） | 源码引用 | ADR-0009 #131 修订节（relevant_decisions L95）；types.ts OpenNamespaceIssue | 低 |
| P-8 | importReplica 第 4 参数即「Hub 广告身份」的受信绑定源（OPEN_OK 身份可直传） | 源码引用 | registry.ts:1919-1941 + ADR-0006 #133 修订节（relevant_decisions L115） | 低 |
| P-9 | session fanout：null-origin 恒投全部 channel、applyOrigin 回声抑制、每投递独立副本、20 让步异步化 | 源码引用 | replication-session.ts:252-293（observer）/216-241（泵）——AC5 fan-out/回声抑制锚 | 低 |
| P-10 | y-protocols 空 diff 为 2 字节封装（断言 ≤4 安全） | 设计期实测验证（SA6 已验） | 任务简报 SA6 裁决注记 5：「空 diff 实测为 y-protocols 2 字节封装，断言 ≤4 字节」；本设计不锁字节，零风险传递 | 低 |
| P-11 | 微任务自延伸链若无界将饿死 macrotask（timer/IO）——watchdog 必须有界 | 官方文档引用（Node.js 事件循环模型）+ 仓库先例 | Node.js docs：microtask queue 清空后才进入下一 phase；仓库先例 fanout 泵以队列空为退出条件（replication-session.ts:221）避免无界 | 低（设计已内置 4096 让步预算） |
| P-12（R4.1 勘误：vitest 半句维持、typecheck 半句更正） | 测试拾取与类型门禁两条路径**性质不同**：(a) vitest 路径——根配置通配覆盖本包，无需改动 ✓；(b) `pnpm typecheck` 路径——根 `package.json` 脚本为**逐包显式枚举**（`tsc -p … && …`），新包必须追加一行，否则 CI Typecheck 步骤**静默跳过本包**（R1 原表述「根配置零改动必要」对此路径不成立，已于 §21 ALLOW 追认 `0cd1ae6` 单行追加） | 源码引用 + SA4 实证 | vitest.config.ts:5-11（`packages/*/test/**` include + typecheck include 通配 ✓）+ tsconfig.typecheck.json include `packages/*/src|test`（聚合 `--noEmit` 路径确覆盖，但非 CI 所跑路径）；根 package.json:13（typecheck 脚本逐包枚举——本包追加前不含 ws-replication）；`.github/workflows/ci.yml` L36-40（push/PR 均跑 `pnpm typecheck`/`pnpm test`）；SA4 报告 F8（`git diff ff50d47..HEAD -- package.json` 单行追加 + 改后 `pnpm typecheck` exit 0 含本包复核）；红灯记录确认 7 套件已被 vitest 发现（失败仅因包缺席） | 低（已收口：0cd1ae6 落地 + 本勘误） |
| P-13（R2） | WebSocket 可靠有序传输 ⇒ 连接内 sequence gap 真实不可达；gap/repeat 的可达面仅为注入测试与实现缺陷，均以 `SEQUENCE_VIOLATION` fatal close（1002）为正确响应；注入丢帧后的收敛经「fatal close → 重连/重建 → re-OPEN/reconcile」达成 | ADR/协议文档引用 | ADR 0010 L147「每方向sequence从1严格递增，不回绕；**gap、repeat或错误ACK关联关闭连接**」（SA8 CP-1 裁决基准原文）+ 协议 §1.2「对端严格按期望值接收」+ §13.1 注册表 + RFC 6455（WS 有序可靠交付）；SA8 报告 CP-1 行「WebSocket 为可靠有序传输、连接内 gap 在真实传输下不可达」 | 低（受影响冻结用例已列 §18.11 清单移交 SA6） |
| P-14（R3） | session status 可作围栏/溢出判别面：`getStatus()` 暴露 `state('open'\|'closed'\|'conflicted')`、`currentEpoch`（投影链当前值 ≠ 冻结 `replicationEpoch` ⟹ 已被 fence）与第 11 字段 `needsResync`（sticky、置位后永不清除）；apply 拒绝码 `REPLICATION_EPOCH_CONFLICTED` 在 A1 接纳层（session 已 conflicted）与槽 R2 被动 fence 两路径同码产出 | 源码引用 | namespace-registry types.ts `ReplicationSessionStatus`（state/currentEpoch/needsResync 字段冻结形状）+ replication-session.ts :450-453（A1）/:568-580（R2 被动 fence → 同码拒绝）/:258-261（队列容量 16 溢出置 sticky needsResync）；CONTEXT.md《ReplicationSession》词条「transport 须 reset/bootstrap」义务（SA2 #2/#3 依据，本轮独立核实） | 低 |

---

## §20. 契约改动连锁审计 (Contract Change Caller Audit)

**无契约改动**：本设计只**新建** `packages/ws-replication` 包及其公共面；不修改任何既有包的函数签名、返回类型、throw 行为或 caller 契约（`@nomicore/replication-protocol` / `namespace-registry` / `namespace-runtime` / `persistence` / `clock` / `doc-runtime` 的 src 零触碰；根配置零触碰——见 §21 DENY LIST 与 P-12）。既有交付物仅以只读方式消费（§1 表）。

---

## §21. 文件清单（File Scope）

### ALLOW LIST

- `packages/ws-replication/package.json` — 新建，包声明（name/exports `.`+`/testing`；deps yjs/y-protocols/lib0 + workspace protocol/registry；devDeps persistence/vitest/typescript）
- `packages/ws-replication/tsconfig.json` — 新建，沿 replication-protocol 先例
- `packages/ws-replication/src/index.ts` — 新建，公共面 re-export（§2；≈60 行）
- `packages/ws-replication/src/types.ts` — 新建，冻结类型 + 内部类型（≈180 行）
- `packages/ws-replication/src/defaults.ts` — 新建，DEFAULT_* + Partial 合并（≈60 行）
- `packages/ws-replication/src/validate.ts` — 新建，§15.1 构造期校验（≈90 行）
- `packages/ws-replication/src/frame-io.ts` — 新建，序列纪律/codec 包装/close 分类/ERROR 构造（§4；≈150 行）
- `packages/ws-replication/src/lifecycle-queue.ts` — 新建，§13 单一生命周期队列 + 合流（≈80 行）
- `packages/ws-replication/src/round-engine.ts` — 新建，§9 round 引擎 + 违例矩阵（≈170 行）
- `packages/ws-replication/src/update-channel.ts` — 新建，§10 窗口/队列/ACK/溢出（≈180 行）
- `packages/ws-replication/src/fence-watchdog.ts` — 新建，§12 双节奏 fence 检测（≈70 行）
- `packages/ws-replication/src/error-mapping.ts` — 新建，§11 三层映射单点（≈120 行）
- `packages/ws-replication/src/peer-connection.ts` — 新建，§4.3/§14 连接 FSM + backoff + 重建（≈200 行）
- `packages/ws-replication/src/peer-namespace.ts` — 新建，§5/§8/§13 target 控制器（≈320 行）
- `packages/ws-replication/src/hub-connection.ts` — 新建，§4.2/§6 accept + HELLO + 分发（≈180 行）
- `packages/ws-replication/src/hub-namespace.ts` — 新建，§7/§8/§9/§11/§12 hub 通道（≈300 行）
- `packages/ws-replication/src/testing.ts` — 新建，§17 createMemoryDuplexTransport（≈50 行）
- `pnpm-lock.yaml` — 修改，`pnpm install` 登记新包依赖（红灯记录明示此为消解根因的必要步骤）
- `packages/ws-replication/test/*.ts`（既有 9 文件）— `[SA6 owned]` 冻结验收测试；SA3 仅可修测试**基础设施**（import 解析、hook/fixture 装配），**禁改断言逻辑**；§18.11 对齐清单 #1–#7 的断言修正必须由 SA6 走测试侧修订，SA3 不得代改
- `package.json`（根）— 修改，`typecheck` 脚本枚举追加 `tsc -p packages/ws-replication/tsconfig.json` 单行（**R4.1 勘误轮追认**，SA4 静态验尸 F8 范围越界项；commit `0cd1ae6` 已落地，SA4 复核 `pnpm typecheck` exit 0 且含本包）。理由（总控裁决依据）：根 `package.json` 的 `typecheck` 脚本是**逐包显式枚举**（`tsc -p … && tsc -p …`）而非通配——不追加则本包在 CI `pnpm typecheck` 门禁（`.github/workflows/ci.yml` L36-40）中**静默跳过**（issue #147 §1.4 立法要堵的 CI 黑洞）；R1 设计 P-12「通配已覆盖」的 typecheck 半句对此路径**不成立**（vitest 半句成立——`vitest.config.ts` include 通配确覆盖本包，见 §19 P-12 勘误）。原 DENY 排除据此解除（ALLOW 只增原则 + SA4 F8 编号理由；其余根配置仍 DENY）

### DENY LIST

- `packages/replication-protocol/**` — codec 已冻结交付（#144），本任务只读消费
- `packages/namespace-registry/**`、`packages/namespace-runtime/**`、`packages/persistence/**`、`packages/clock/**`、`packages/doc-runtime/**`、`packages/dsh-persistence/**`、`packages/vfsl*/**` — 既有交付物只读
- `apps/**`、`domains/**`、`tests/**` — 组合根/域/跨包测试不属本切片
- `docs/**`、`CONTEXT.md`、`wiki/**` — ADR/规格/词汇一致性收口属切片 10（§23 登记项届时处理）
- `vitest.config.ts`、`tsconfig.base.json`、`tsconfig.typecheck.json`、`pnpm-workspace.yaml` — 通配已覆盖本包（P-12 勘误后仅 vitest 半句成立；typecheck 脚本枚举项已于 R4.1 移入 ALLOW——见上条）

---

## §22. 冻结测试 → 设计条款映射（验收对照）

| 冻结测试（it 主题） | 设计条款 | 关键锚达成机制 | R2 核对 |
|---|---|---|---|
| AC1 幸福路径 HELLO/OPEN/wire 无 owner/授权恰一次/序列递增 | §4.1/§4.2/§7/§2 | owner 不入帧构造（I-2）；authorize 单点调用（§7.1）；HELLO seq=1 | ✓ 仍绿 |
| AC1 submit:false | §18.1/§11.1.2 | live 门不拦 Step2 → 先 live；UPDATE 拒 NAMESPACE_UNAUTHORIZED | ✓ 仍绿 |
| AC1 重复 OPEN 合流 | §7.0a | 在途 open Promise 链挂第二应答 | ✓ 仍绿 |
| AC1 reopen 拒绝 | §7.0b/§14.1 | 终态先行检查 | ✓ 仍绿 |
| AC1 TARGET_NOT_REQUESTED | §11.2 | peer 侧 target 集合门 | ✓ 仍绿 |
| AC1 幂等 add/remove + closed 后 add 重建 | §13.1/§14.1 | cleanup 合流；重建=重拨（re-add 路径 R2 保留，协议 §16 明文） | 尾断言 → §18.11 #1 |
| AC2 五类 OPEN 拒绝 + 不泄露 | §7.1-4 | 授权先于 Registry；NOT_FOUND 仅授权后；身份比较矩阵 | ✓ 仍绿 |
| AC3 单帧快照/ACK/强制 round/TOO_LARGE/duplicate/timeout | §8 | encodeDiff(∅sv) 单帧；importReplica 排他；peer timer 收口 | ✓ 仍绿（timeout 用例丢帧后 hub 无后续帧，gap 不可观测） |
| AC4 round 时序/缺 Applied 不 live/timeout/错序/空 diff | §9.1/§9.2/§9.3 | 双位门禁 + 违例矩阵 + roundId 单调 | ✓ 仍绿 |
| AC4 重复 Step1（同 round） | §9.2 | hub 判定不变（SYNC_STATE_VIOLATION ERROR 帧仍在 wire） | → §18.11 #2（CP-1） |
| AC5 UPDATE/ACK 时序（saveGate）/fan-out/窗口/重复 ACK/ACK_STATE_VIOLATION/UPDATE_TOO_LARGE | §10/§11.1/§11.3/P-3/P-9/P-5 | ACK 后置于 apply resolve；session fanout 回声抑制；zombie 序容忍（SA8 判一致） | ✓ 仍绿（saveGate 为时延非丢帧） |
| AC6 溢出→RESYNC→**同连接** round2（R2：CP-2 回退） | §10.5/§10.2 | 窗口收口后同连接新 round；丢弃增量由 diff 修复 | 计数断言 → §18.11 #3（CP-2） |
| AC6 ACK timeout | §10.4 | 不重发；abandon in-flight；新 round | → §18.11 #4（CP-1） |
| AC6 正常 close | §13.1/§13.2 | CLOSE_OK 只在已接纳 apply settle 后；close 不等丢失 ACK | → §18.11 #5（CP-1） |
| AC6 terminal ERROR / IDENTITY_CHANGED / socket loss / bootstrap 中断线 | §13.3/§12/§14.1 | watchdog + 无 outbox 结构保证 + wire2 序列重置 | ✓ 仍绿 |
| AC7 错序 OPEN_OK 前 UPDATE/APPLY_FAILED/degraded×2/cleanup 竞态×2/合流/构造校验/保护检查×2 | §9.2/§11.1/§11.3/§13.2/§13.3/§15.1 | 状态门 + session 层承载 + 生命周期队列 | ✓ 仍绿 |
| AC7 重复控制帧 / 错误 round | §9.2 | hub 判定不变（ERROR 帧仍在 wire） | → §18.11 #6/#7（CP-1） |
| api.test-d 类型面 | §2 | 逐字段导出 | ✓ 仍绿 |

**验证命令**（SA3/SA7 执行；R2 注记：§18.11 清单 #1–#7 落实的 SA6 修订合入前，这 7 处断言预期红——SA7 应以「清单内豁免、清单外全绿」为门禁口径）：`pnpm install --lockfile-only` 后 `pnpm exec vitest run packages/ws-replication`；`pnpm typecheck`；根聚合 `tsc -p tsconfig.typecheck.json --noEmit`；`git diff --check`。

---

## §23. 风险、代价与演进位（ADR/规格登记候选——收口于切片 10）

| # | 项 | 代价/风险 | 缓解 | 演进位（登记建议） |
|---|---|---|---|---|
| R-1（R3 扩） | fence/session-溢出 watchdog 微任务突发（§12 谓词已扩 needsResync） | 活跃期每事件 ≤4096 让步的亚毫秒微任务占用 | 有界预算；timer 兜底；边沿触发；R3/#2 钩子落地后 fence 主检测确定性化、预算仅覆盖 needsResync 边沿与空闲兜底 | session 层 append-only 终态/溢出回调（`onTerminal`/`onNeedsResync`）后删除突发（ADR 0010 增补节候选） |
| R-3（R2 重写） | 序列纪律 ADR 字面（gap/repeat 一律 fatal 1002） | 注入式丢帧/实现缺陷即断连 + peer `blocked`（无自动重试，协议 §15.1）；跨连接恢复需依赖 addTarget 重建或 Host 重启 | WS 可靠有序传输下连接内 gap 真实不可达（P-13）；受影响冻结用例已列 §18.11 移交 SA6 | 无——已按 ADR 0010 L147 字面收口（CP-1，R2 总控裁决） |
| R-4 | hub 大小门依赖 codec decode limits 抛码 | 无（P-5 源码锚定） | — | 无 |
| R-5 | degraded 判别依赖 lease status 旁证（§11.1） | 拒绝码与 wire 码非一一对应 | 判别表单点（error-mapping.ts）；覆盖矩阵见 AC7 锚 | session 拒绝码增补 persistence 域细分码时可简化 |
| R-6（R2 收窄） | §18.11 对齐清单 #1–#7 共 7 处冻结断言在 SA6 修订合入前预期红 | SA7 动态验证需按「清单内豁免、清单外全绿」口径 | 清单逐条给出期望新形态（含断言级建议），实现侧零迁就 | SA6 测试修订（总控转派） |
| R-7 | 多 target 连接的 OPEN 并发无节流 | 首连风暴（v1 无测试覆盖） | 顺序发起（§5.2）；per-ns 队列天然隔离 | 切片 8 observability 观测后按需节流 |
| R-8 | `maxQueuedBytesPerConnection`/水位以内部记账实现 | 真实 WS bufferedAmount 背压未接（DuplexTransport 无该面） | 内存双端 send 同步、结构性零积压 | 切片 7 transport 适配层接 bufferedAmount |
| R-9（R3/#9 新增，O-4 登记补全） | submit 门 UPDATE-only（§11.1.2/§18.1）：submit:false 的重连同 peer 可经 reconcile Step2 diff 向 hub 传播**离线写** | 授权语义缺口——「提交权限」未覆盖 Step2 数据面（冻结 AC1 锚死 UPDATE-only 读法，本切片不改行为） | 冻结测试锚定 + 缺口在此显式登记（原先只在 SA8 摘录 relevant_decisions #5） | **Jim/切片 10 裁决候选**：submit 权限是否应扩展覆盖 Step2（届时需 ADR 0010 §19 增补 + SA6 新锚） |
| R-10（R3/#10 新增） | watchdog 预算 4096 与 harness settle 常量（300/3000）的耦合不变量 | SA6 上调 harness 预算会静默破坏 fence/溢出检测（用例超时红） | 不变量「watchdog 预算 > settle 预算之和」已写入 §12（双向登记；建议 harness 常量旁加耦合注释） | SA6 在 harness.ts:198/207 登记耦合注释（测试侧文档性动作） |
| R-11（R4.1 新增，SA4 F6 登记） | §4.4 连接级调度**半残**：`lowWater/highWater/maxQueuedBytesPerConnection` 仅存在于 defaults+validate（零字节记账）、`OutboundQueue` round-robin/dataQueues 未被喂入、`CONNECTION_BACKPRESSURE` 无实现面；SA4 另录角落差异——UPDATE 大小门的执行层先于 state/submit 门（设计 §11.1 门序 state→submit→size，语义等价但角落码可达面不同） | v1 内存同步 transport（send 即达）下结构性不可达，无行为影响；真实 WS（有 bufferedAmount/投递延迟）接入后背压全失效 | §4.4 已声明「bufferedAmount 观察属切片 7 适配层」；SA4 判不阻塞 | **切片 7**：真实 WS 适配层必须接上 bufferedAmount 观察水位、连接排队字节记账、round-robin data 队列喂入与 `CONNECTION_BACKPRESSURE` close(1011)；门序差异一并收口（SA7 动态审核重点 #4） |
| R-12（R4.1 新增，SA4 F9 登记） | §4.3 GOAWAY 接收的 `SERVER_RESTARTING` 分支未实现「停止新 OPEN/round」（实现仅按 drainTimeoutMs deadline 关连接，deadline 期间 namespace 照常 live/open） | 停机通告期继续开新生命周期与「收口后关闭」意图相悖（hub 停机窗口内 peer 白开 round，随后必然断连重来） | 本切片无冻结测试覆盖；hub 主动 GOAWAY 发送属切片 9（§4.3 已划界） | **切片 9**：停机编排收口——drain 期停新 OPEN/round + deadline 关闭 + reasonCode 分类重连全链路（SA7 动态审核重点 #5） |
| R-13（R4.3 登记轮新增，SA4 R4 复审 R4-4 nano） | `sendControl` 的 ready 门（peer-connection:396，以 connState 为判据）抑制了**当前连接握手期合法的 connection ERROR 帧**——`connectionFatal` 发生在 handshaking 态时 best-effort ERROR 不再发出（§4.1「framing 仍可信时 best-effort 发 connection ERROR」被弱化；close code 本身仍正确送达，危害限于诊断面） | 握手期协议错误（如 HELLO_REQUIRED/UNSUPPORTED_* 类）的对端只收到 close、收不到结构化原因码——可观测性弱化，无正确性影响（SA4 判 nano 不阻塞） | 门本身服务于 B-2e 重建语义（迟到控制器帧不得落入新连接——SA4 核 ✅），不能简单删除 | **切片 7**：门的判据精确化——按 **epoch**（帧属当前连接生命周期）而非 connState 判定，或对 connection 级 ERROR 豁免（SA4 R4-4 原建议）；随真实 WS 适配层一并落地 |

**R2 收口状态（CP-1/CP-2）**：round 1 曾登记的两条 ADR 增补候选（溢出整连接重建拓扑、序列跳跃容忍）与 R-2（整连接扰动代价）**已删除**——两冲突点均按总控裁决回退 ADR 0010/协议字面（§4.1/§10.5/§18.7/§18.8），**无需 ADR 增补、无待 Jim 裁决残留**。

**一致性收口建议（切片 10）**：ADR 0010 增补节登记——(a) R-1 演进位；(b) `PERSISTENCE_DEGRADED` 判别表；(c)（SA8 观察项 O-1）bootstrap 基线编码「write sequencer 内」措辞与 session `encodeDiff` 同步直读的等价性澄清。CONTEXT 词汇无需新增（连接/namespace/sync 状态词均已冻结）。

---

## 修订回应

### R2 修订逐条回应（SA8 设计后复审 `conflict` × 2 + 总控裁决「维持 ADR 字面」，2026-08-30）

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| CP-1：序列纪律回退 ADR 0010 L147 + 协议 §1.2/§13.1 字面（gap/repeat/错误 ACK 关联一律 `SEQUENCE_VIOLATION` fatal 1002；删除「跳跃容忍、连接内收敛」） | ✅ | §4.1（全文重写）/§18.8（定案+修订史）/P-13（新增）/§22（AC4/AC7 相应行） | 入站序列严格等于期望值；gap 与 repeat 同判 fatal close 1002（peer → blocked）；WS 可靠有序传输下 gap 真实不可达（P-13）；注入丢帧收敛改经「fatal close → 重连/重建 → re-OPEN/reconcile」 |
| CP-2：溢出恢复回退协议 §9.4/§17 默认同连接拓扑（删除「整连接重建」；ADR 0010 L165 单 channel 粒度） | ✅ | §10.5（全文重写）/§4.3（重建触发器收窄为 §14.1 重开矩阵）/§5.1（needs-resync 两行合一）/§10.6/§14.2/§18.7（定案+修订史） | 溢出与 ACK-timeout 统一同连接新 round；hub 收 RESYNC 仅作废单 channel；重建唯一入口 = 协议 §16「重新 add 必须重建连接」 |
| 同步修订：roundId 计数器语义（A-7 区分消解，两者均同连接新 round） | ✅ | §14.2（重写） | 持久性依据改为「保守选择」（roundId 全 target 生命周期唯一），删除溢出重建算术倒推叙述 |
| 同步修订：§13/§16 等所有受影响条款 | ✅ | §13（核对无需改——§13.3 重连规则本就同连接语义；§16 timer 清单核对无 rebuild 依赖项）/§10.4（冻结锚引用改挂 §18.11 #4） | 逐条核对后仅 §10.4 的锚引用需调整；§2 契约面为纯类型/常量，零受影响（核对记录见修订汇报） |
| §18 末尾新增「冻结测试对齐清单（移交 SA6）」 | ✅ | §18.11（新增，7 条：#1 AC1 尾断言算术冲突 + #2/#6/#7 CP-1 丢帧用例 ×3 + #3 CP-2 计数断言 + #4/#5 CP-1 丢帧用例 ×2；每条含期望新形态；附「不受影响用例」核对清单） | 测试归 SA6 所有，只列清单不改测试 |
| A-7/A-8 及相关「唯一解」叙述全部按新形态重写 | ✅ | §18.7/§18.8（含修订史段）/§10.5 修订记录段/§14.2/§22 | 保留修订史溯源（round-1 形态 → SA8 冲突 → 总控裁决 → R2 定案），现行设计面零残留旧形态 |
| §19 协议假设依据同步更新 | ✅ | P-13 新增（ADR 0010 L147 + RFC 6455 + SA8 CP-1 基准）；P-1–P-12 逐条核对无一依赖旧形态 | — |
| §23 风险登记：移除 R-2 与两条 ADR 增补候选，改为「已按 ADR 字面收口」 | ✅ | §23（R-2 删除；R-3 重写为 ADR 字面风险；R-6 收窄为 7 处豁免断言；新增「R2 收口状态」段声明无待 Jim 裁决残留） | — |

### R2.1 续传小修订（SA8 R2 复审 verdict clear，编辑性观察项 O-7）

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| O-7：§6 方向纪律句措辞澄清——「hub 收 OPEN_NAMESPACE → CONNECTION_POLICY_VIOLATION」字面与 §7/协议 §7.1（hub 正常处理 OPEN）相抵；实际意图为「hub 收到 hub→peer 方向帧属错向」 | ✅ | §6 第三条（帧分发 bullet，R2.1 标注） | 重写为：OPEN_NAMESPACE 属 peer→hub 帧、hub 侧收到即正常路径（§7 OPEN 矩阵）；错向面 = hub 收到 **hub→peer 方向专用帧**（HELLO_ACK/OPEN_OK/BOOTSTRAP_SNAPSHOT/IDENTITY_CHANGED，按消息注册表 direction 域枚举）→ `CONNECTION_POLICY_VIOLATION`（close 1008）；并补 peer 侧对称说明（含 OPEN_NAMESPACE 错向到达 peer 时按 §11.2 namespace-scope TARGET_NOT_REQUESTED/NAMESPACE_STATE_VIOLATION 处理的 AC2 冻结锚例外）。零行为变更——仅措辞澄清，其余内容未动 |

### SA2 反馈逐条回应（R3：攻击评审 reject → 逐条收口 #1–#13，2026-08-30）

> 报告：`task_phase5-ws-namespace-sync_sa2_review.md`。约束遵守声明：本轮零触碰冻结契约面（§2）与 ADR 字面定案（§4.1 序列纪律 / §10.5 同连接恢复）；#1–#13 全部为设计文本级修订，既有冻结断言零影响（新测试候选另列 §18.11 R3 追加节）。

| # | 攻击点 | 处置 | 修订位置 |
|---|---|---|---|
| 1（CRITICAL） | §11.3 blanket「非 live UPDATE → NAMESPACE_STATE_VIOLATION」击穿 ACK-timeout/溢出恢复路径（恢复窗口内 hub fan-out UPDATE 结构性必然到达非 live peer → 误判违例 → 双侧 failed） | ✅ 按建议收窄：双侧状态门重写为四分类——无生命周期/opening/bootstrapping/**首轮 reconciling**（未到达过 live）→ 违例；**needs-resync/恢复期 reconciling（到达过 live）/live → 照常 apply+ACK**（协议 §9.4「已接纳 update 正常 apply/ACK」镜像 + §10.1 live 限为发送方约束）；closing/终态 → 静默忽略。AC7「OPEN_OK 前」冻结锚属违例类、不受影响 | §11.1 第 1 步（hub 侧重写）；§11.3 开头（peer 侧镜像重写） |
| 2（CRITICAL） | epoch bump × 在途流量竞态：`REPLICATION_EPOCH_CONFLICTED` 映射 INTERNAL_ERROR → failed，与 §12 watchdog → conflicted 赛跑，同一 bump 非确定二态，违反协议 §11 效果义务 | ✅ 映射表前置**围栏判别**：任一拒绝码结算时读 `session.getStatus()`（state==='conflicted' ∨ currentEpoch!==replicationEpoch，P-14）→ 命中走 §12.2 **one-shot 终结器**（恰一帧 IDENTITY_CHANGED + 双侧 conflicted + cleanup，记忆化）；两检测面（帧处理钩子/watchdog 探测）合流到同一终结器 → 确定性终态；未命中才落 INTERNAL_ERROR。帧处理路径成为 fence 的确定性事件驱动钩子，watchdog 退化为空闲兜底 | §11.1 第 4 步映射块 + R3/#2 附注；§12 机制层第 0 条、§12.2（one-shot 合流点）；P-14 新增 |
| 3（CRITICAL） | session 层 fanout 溢出（容量 16、sticky `status.needsResync`）未被消费 → 健康连接单向静默发散无界持续；CONTEXT.md「transport 须 reset/bootstrap」冻结义务遗漏 | ✅ watchdog 谓词扩编 `∨ status.needsResync`，**边沿触发**（false→true 跃迁才动作；sticky 永不清除、电平触发即死循环——每通道维护 lastPredicateValue）；命中分派：fence → §12.2；needsResync 边沿 → §10.2 同构处置（peer 发 RESYNC + 窗口收口后新 round〔§10.5 同连接〕；hub 侧 §10.6 等待）。「连接内 reset = 新 round；bootstrap 留给重连路径」为义务的 v1 落地形态；§10.2 增第三溢出信号面指针（两信号面互补不重复计数） | §12（问题二/机制第 1 条谓词/命中分派——全文扩写）；§10.2 尾注；§16 timer 行更名 |
| 4（MAJOR） | §14.1 幂等行（重复 add → 合流零 OPEN）× §4.3（blocked ──addTarget──▶ 重建）互斥；§18.11 #4 冻结用例依赖后者 | ✅ 显式 reconcile：幂等合流行**限定非 blocked 连接**；blocked 下**任何 addTarget（含对既有活跃/opening/disconnected target 的重复 add）= config-change → 整连接重建**；补扰动界限注（Host 配置纪律约束，v1 接受） | §14.1 新增 blocked 行 + 幂等行加限定语 |
| 5（MAJOR） | removeTarget × ns 状态矩阵四缺口（targeted/disconnected/终态 conflicted-failed/closing 中 terminal ERROR） | ✅ 补全七行全矩阵：targeted/disconnected → 本地收口（closed、零 wire 帧——点名禁发 CLOSE 的结构性多余帧）；conflicted/failed → 立即 resolve + 投影迁 closed（事实保内部诊断）；closing 中 terminal ERROR → 维持 closing 收敛 closed（§13.4 迟到纪律扩至「迟到 ERROR/IDENTITY_CHANGED」） | §13.1（重写为矩阵表 + closing-迟到 ERROR 条款） |
| 6（MAJOR） | authorize() rejection/throw 未定义 → 潜在 unhandled rejection + hub 通道滞留 opening | ✅ §7 第 1 步增补：rejection → 捕获 → INTERNAL_ERROR namespace ERROR（failed、不泄露存在性，与 Registry open 运营失败同款）；并立通用契约——一切 async seam（authorize/dial/registry.open/importReplica/openReplicationSession/applyRemoteUpdate）异常一律 error-mapping 单点收编，零 unhandled rejection | §7 第 1 步（rejection 分支 + 通用契约） |
| 7（MAJOR） | 序列号消费点未钉死：入队分配 + 控制帧优先插队 → 实际交付序 ≠ 序列序 → 接收端 SEQUENCE_VIOLATION 自伤 | ✅ frame-io 契约钉死：序列号**只在 dequeue 实际发送时单点分配**，入队项不携带不预占；「实际交付序严格 +1」列 SA4 静态/SA7 动态检查项 | §4.1 发送侧新增序列号消费点条款 |
| 8（MINOR） | BOOTSTRAP_SNAPSHOT 身份读点未钉死（OPEN 时读 vs 发送时读 → bump 竞态下多余 BOOTSTRAP_FAILED） | ✅ 钉死为「与 encodeDiff 同一同步段之后从自有 lease status 重读」；重读后被 fence 的残余竞态由 #2 围栏判别/one-shot 终结器收编 | §8 第 3 步（身份读取点条款） |
| 9（MINOR） | submit 门 UPDATE-only 的授权语义缺口（submit:false 离线写经 Step2 上行）只在 SA8 摘录、未入设计风险面 | ✅ §23 新增 R-9 行显式登记（数据面后果 + Jim/切片 10 裁决候选；本切片不改行为——AC1 冻结锚死） | §23 R-9 |
| 10（MINOR） | watchdog 预算 4096 锚定 harness 常量（settle 300/settleUntil 3000），SA6 上调会静默破坏检测 | ✅ 双向钉不变量「watchdog 预算 > settle 预算之和（3300）」写入 §12 预算论证；§23 新增 R-10（建议 harness 常量旁登记耦合注释）；#2 落地后 fence 主检测不依赖预算、敏感度下降 | §12 预算段；§23 R-10 |
| 11（MINOR） | 出站 uint32 耗尽行为未定义（「不回绕」只禁回绕） | ✅ 定义响亮收口：达 0xffffffff → connection ERROR（CONNECTION_POLICY_VIOLATION）+ close 1008；不回绕不静默错序 | §4.1 出站耗尽条款 |
| 12（MINOR） | §4.3 drainTimeoutMs 措辞易误读为本地配置项（冻结 ReplicationTimeouts 恰 6 字段） | ✅ 改为「按 GOAWAY 帧 drainTimeoutMs 字段计算的本地 elapsed deadline」（协议 §6.3 + payloads.ts:225 帧字段），明示非本地配置、SA3 不得自造字段 | §4.3 GOAWAY 行 |
| 13（MINOR） | hub 侧 reconcile/bootstrap/RESYNC 等待期的 fan-out 交付排队语义未成文（§5.3 只写 peer） | ✅ §10.1 增 hub 侧对称条款：镜像 §5.3（同一 UpdateChannelState 有界队列 / 溢出 → pendingResync / 新 round 恒由 peer 发起、hub 按 §10.6 等待 / 终局忽略） | §10.1 末段 |

**新测试候选移交**：SA2 报告 §红线测试思路 7 项已附录于 §18.11「R3 追加」节（非冻结断言修订；#4 由既有 §18.11 #4 覆盖），供总控转派 SA6 按需补测。

### SA2 R2 反馈逐条回应（R4：窄幅增补 N-1/N-2 + nano-notes ×3，2026-08-30）

> 报告：`task_phase5-ws-namespace-sync_sa2_review.md` 文末「SA2 R2 重审节」（R1 #1–#13 复核全部 ✅；本轮仅核对本增补条款）。约束遵守：零触碰 §2 契约面 / §4.1/§10.5 ADR 字面定案 / 既有冻结断言。

| # | 攻击点 | 处置 | 修订位置 |
|---|---|---|---|
| N-1（MAJOR） | `encodeStateVector()/encodeDiff()` 终态 session **同步 throw** `ReplicationSessionClosedError`（replication-session.ts:410/:414）未被围栏判别/seam 契约覆盖——fence × 恢复 round 在途 Step1/Step2、fence × bootstrap 快照、close × 在途 round 四类竞态下 throw 穿透（uncaught）或被误映射 failed（违反协议 §11 效果义务），且先于 watchdog 探测（帧处理同步段 vs 每 8 让步探测） | ✅ 四点增补：① §7 通用契约 seam 清单补入 encode* 两**同步 throw 面**（标注 ReplicationSessionClosedError 源码锚 :410/:414 + types.ts:526 契约文档），三处编码调用点必须 try/catch；② §11.1 围栏判别适用域从「apply 拒绝码」扩为「**一切 session 能力调用的异常/拒绝结算**」—— 同步 throw 与 ok:false 统一进 error-mapping 单点：命中 fence（state conflicted ∨ currentEpoch≠epoch）→ §12.2 one-shot 终结器（IDENTITY_CHANGED + 双侧 conflicted）；state==='closed' → §13.4 迟到纪律/cleanup 收口（INTERNAL_ERROR 域，零 wire 假码）；③ §8.1/§9.1.2/§9.1.3 三处编码调用点逐一注明「经 error-mapping 单点 + 禁止穿透同步段」（§9.1.2 标注 N-1 红灯核心竞态路径）；④ §9.2 矩阵补 closing/终态通道收 SYNC* 帧条款（静默忽略、与 §11.1 第四类对齐、非违例——违例矩阵只适用活跃态） | §7 第 1 步（seam 清单扩全）；§11.1 围栏判别块（适用域 (a)/(b) + closed 分支）；§11.1 附注（扩面说明 + 四竞态类收编）；§8.1 第 1 步；§9.1 第 1/2/3 步；§9.2 首行 |
| N-2（MINOR 伴随） | §12 机制/§16 timer「hub 侧」写死与命中分派 peer 分支矛盾——若按字面实现，peer 本地连写溢出无检测面（R1 #3 peer 侧复发、红灯 ③ 必红） | ✅ 一句话更正（落三处）：watchdog **双侧对称持有**（同一 fence-watchdog.ts）；**peer 通道 fence 两判据结构性不命中（peer Runtime 永不 bump），仅 `needsResync` 边沿生效**（peer 本地连写突发的唯一发现路径）；§12 标题、§16 timer 行（侧 = hub+peer + 差异注记）、§3 模块职责注释同步 | §12 标题 + 机制第 1/2 条；§16 timer 行；§3 fence-watchdog.ts 注释 |
| nano-note 1 | §8「重读保证帧身份与快照内容一致通过安装」措辞过强（bump 落 encodeDiff 与重读之间仍安全失败 BOOTSTRAP_FAILED） | ✅ 措辞校准为「**最小化**不一致窗口；**残余窗口安全失败**」（#133 R2 有意口径，非缺陷） | §8 第 3 步身份读取点条款 |
| nano-note 2 | uint32 耗尽 1008/blocked 不自愈 vs retryable 1011 + 重连自愈（计数器按连接重置） | ✅ 选择注记登记：保守选择理由（永久性配置级信号更贴近「计数器不可信」事实）+ 备选形态（1011/backoff）登记供切片 10 复议 | §4.1 出站耗尽条款 |
| nano-note 3 | §18.11「R3 追加」首句「SA2 R3 攻击评审」轮次笔误 | ✅ 更正为「SA2 R1 攻击评审」+ 笔误说明；顺带补 N-1 红灯候选 ⑧（fence × 恢复 round / OPEN(mode0) × bump 变体）入移交清单 | §18.11 R3 追加节 |

### SA4 勘误轮（R4.1/R4.2）逐条回应（静态验尸 F8 追认 + F6/F9 登记 + F1 hub 声明条款澄清，2026-08-30）

> 报告：`task_phase5-ws-namespace-sync_sa4_review.md`。R4.1 按总控指令窄幅执行：F8 勘误 + F6/F9 演进位登记；R4.2 追加授权完成 F1 的 SA1 侧条款澄清（§12 hub 分支「声明+等待」定案）。F1/F2/F3 的实现与测试修复归 SA3/SA6（SA4 已裁回流路径）。

| # | 项 | 处置 | 修订位置 |
|---|---|---|---|
| F8 | 根 `package.json` 越界（0cd1ae6 单行 typecheck 枚举追加）：P-12「通配已覆盖」对 typecheck 脚本路径不成立，不追加则 CI 静默跳过本包 | ✅ 追认：§21 ALLOW LIST 追加根 package.json 条目（附总控裁决依据 + 0cd1ae6 + CI 门禁锚）；DENY LIST 该行同步收窄（根 package.json 移出，其余根配置仍 DENY；ALLOW 只增原则）；P-12 勘误为双路径分述（vitest 通配 ✓ / typecheck 枚举须追加） | §21 ALLOW LIST 末尾新增条目 + DENY LIST 配置行；§19 P-12（整行重写，标注 R4.1 勘误） |
| F6 | §4.4 水位/round-robin/CONNECTION_BACKPRESSURE 半残（v1 内存 transport 结构性不可达）+ UPDATE 门序角落差异 | ✅ 登记 R-11：演进位指向切片 7（bufferedAmount 水位/记账/round-robin 喂入/CONNECTION_BACKPRESSURE + 门序收口，SA7 动态审核重点 #4） | §23 R-11 |
| F9 | GOAWAY `SERVER_RESTARTING` 未停新 OPEN/round（仅 deadline 关连接） | ✅ 登记 R-12：演进位指向切片 9（停机编排：drain 期停新 OPEN/round + deadline 关闭 + 分类重连，SA7 动态审核重点 #5） | §23 R-12 |
| F1（SA1 侧条款，R4.2 追加授权） | §12「命中分派」hub 分支「丢弃+等待」与 §10.2/§18.4「hub 溢出同机制声明 RESYNC_REQUIRED」内部张力——SA3 曾按 §12 字面实现为「只等待零声明」→ hub 侧溢出零 wire 信号、恢复 round 永不触发（SA4 F1 静默发散根因） | ✅ 单条款澄清：hub 分支明确定为「**声明 RESYNC_REQUIRED + 等待**」（hub 通道任一溢出面——§10.2 本地排队溢出与 §12 needsResync 边沿同规；协议 §9.4「任一端可声明」——hub 的声明是 peer 发起恢复 round 的唯一通路）；明文「hub 侧不存在『只等待零声明』的分支」。实现侧补发（SA3）与红灯（SA6）按 SA4 F1 处置回流路径执行 | §12 命中分派段（R4.2 标注） |
| R4-4（nano，R4.3 登记轮） | sendControl ready 门抑制握手期合法 connection ERROR 帧（§4.1 best-effort 弱化；close code 仍正确送达，危害限诊断面） | ✅ 登记 §23 R-13：现状（connState 判据 + B-2e 重建语义服务，不可简单删）+ 切片 7 精确化建议（epoch 门判据或 connection ERROR 豁免，SA4 原建议） | §23 R-13 |
