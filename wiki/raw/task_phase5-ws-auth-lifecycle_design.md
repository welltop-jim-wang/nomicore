# SA1 设计档案 — issue #138 Phase 5 切片 7：实例认证与连接生命周期

- Worktree: `/home/wangjian/nomicore-fix-issue-138`
- 任务简报: `wiki/raw/task_phase5-ws-auth-lifecycle.md`（SA6 已锚 10 项红灯，全红确认）
- 决议基准: `wiki/raw/task_phase5-ws-auth-lifecycle_relevant_decisions.md`（ADR 0010 为主 + 协议
  `docs/protocols/instance-replication-v1.md` §2/§6.1–6.3/§13/§14/§15/§19/§21 + phase-5 切片 7/L146-151）
- 任务类型: **Feature**（在 #136/#137 交付的连接骨架上叠加认证 / 授权撤销 / GOAWAY 生命周期域）
- 红灯契约: `packages/ws-replication/test/ws-replication-auth-lifecycle-red.test.ts`（10 IT）
- 产出：本设计档案。**零代码产出**（SA1 硬门禁）。

### 修订日志

| 版本 | 日期 | 触发 | 摘要 |
|---|---|---|---|
| R0 | 2026-08-29 | 总控首发指令 | 初版设计（D1–D5；§6.1 采用 hint 键控 draining 裁决） |
| **R1** | 2026-08-29 | SA8 设计后复审 `wiki/raw/task_phase5-ws-auth-lifecycle_design_conflict_report.md`（verdict `conflict`；CP-1/CP-2 evolution，同根）→ **总控裁决**：按协议字面契约——ready 态收到的 drain 类 GOAWAY **无条件**进入 draining（与 `retryAfterMs` 无关）；一切 GOAWAY drain 路径**无差别**停新 OPEN 与新 sync round | §6 全节重写（无条件 draining + 状态键控停 OPEN/round 结构门，CP-1/CP-2 双消解）；G1 L189 既有锚改锚呈报 + 红灯契约新增锚 2 项（§6.5）；ALLOW LIST 显式扩展（§11：`ws-replication-sa7-dynamic.test.ts` 原 DENY 解除，SA6 owned）；§0.2/§8/§10/§12/§13/§14 联动更新。**D1/D2/D3/D5 与 §2–§5/§7–§9 零改动**（SA8 监点 no-conflict） |
| **R2** | 2026-08-29 | SA2 攻击评审 `wiki/raw/task_phase5-ws-auth-lifecycle_sa2_review.md`（verdict **reject**；A1/A2 必修，A3–A6 随 R2 显式处置） | **A1**：§6.3 onClose draining 分支前置 close-code 分类——1002/1008 → `clearDrainClose()+enterBlocked()`（永久失败阻断 + drain timer 清理），其余 → `onGoawayClosed()`；**A2**：§3.2 早到帧缓冲有界化（单帧复用 `maxFrameBytes` + 常数 `MAX_EARLY_FRAMES=16` 条数界，零新 knob）+ 认证等待封顶政策（复用 `helloTimeoutMs` 认证期 timer，显式非沉默）；**A3**：§6.2「自然收口 → 重连 reconcile 替换」取舍显式声明 + NR-1 空转面登记呈报；**A4**：§3.2/§3.3 顺序统一为「先摘早到监听 → 构造 → 构造尾重放」单一基准；**A5**：§5.3 cleanupTail 改链式追加；**A6**：driver.ts 镜像修正例外登记 §13。红灯契约新增锚 2 项（§6.5 A2-c/A2-d，合计 14 IT）；§8/§9/§10/§11/§12/§14/附录联动 |
| **R3** | 2026-08-29 | SA2 R2 复审（同文件追加节；verdict **reject 收窄至唯一必修 N1** + N2–N5 LOW 随手处置——A1–A6 六项全部确认已修） | **N1（必修）**：§3.2 门 3 伪代码 off 句柄 **no-op 初始化**（`let offMessage/offClose = () => {}`）+ listener 幂等早退（`if (authRejected) return`，重放期内拒绝只置标志+close、不摘监听）+ 注册完成后同步收口段（`if (authRejected || earlyClosed) { detachEarly(); return undefined; }`）——同步重放型 transport 上 `onMessage(...)` 调用点零同步抛出、「accept 永不 reject」在一切 transport 形态下成立、重放循环零流产；§3.3 不变量 6 / §8.2 / §8.3 新行联动；**新锚 A2-e**（同步重放 fixture 回归——防伪绿）；**N2**：§8.1 注明 onGoaway blocked 分支空虚真、路由冻结（B1 pending 计面保护）；**N3**：A2-d 超时变体改推进 hub scheduler（`node.scheduler.advanceBy`）；**N4**：§5.3 settleClose 存储前归一化（`.then(() => undefined, () => undefined)`）；**N5**：§12 A11 行号校正 :19/:33 → :17/:32。红灯契约 15 IT |

---

## §0 任务基线与证据

### 0.1 被改对象现状（源码逐点引用）

| 面 | 现状 | 证据 |
|---|---|---|
| upgrade 认证 | **不存在**。`accept(transport)` 同步分配 `HubConnectionImpl`，任何 transport 一律接纳 | `src/hub-connection.ts:76-84` |
| HELLO 身份绑定 | 只校验 `expectedHubInstanceId === hub.instanceId`；`peerInstanceId` 来自 HELLO 自声明，无认证对照 | `src/hub-connection.ts:221-234` |
| 授权撤销 | `revoke` 不存在（`git grep revoke src/` 零命中） | — |
| GOAWAY 接收 | `SERVER_SHUTTING_DOWN/REAUTH_REQUIRED → blocked`；`SERVER_RESTARTING → scheduleDrainClose()`（状态**保持 ready**，忽略 `retryAfterMs`；drain timer 句柄不跟踪） | `src/peer-connection.ts:363-395` |
| hub 停机 | `close()` 对每连接直接 `connection.close(1001,'hub-shutdown')`，**无 GOAWAY**；close 后 `accept` 仍分配（随即 1001） | `src/hub-connection.ts:90-100, 80-82` |

### 0.2 必须保持绿灯的既有面（全量回归 17 文件 / 106 用例）

经全文件审读，与本设计交叠的既有锚：

| 既有锚 | 断言内容 | 文件:行 |
|---|---|---|
| G1 | `GOAWAY(SERVER_RESTARTING, drain=60)` **无 retryAfterMs** → ~~settle 后连接仍 ready~~（**R1：L189 `ready` 断言被总控裁决推翻，须 SA6 改锚为 `draining`**，§6.5）；L190 wire 未关 + deadline close(1001) → **普通 backoff**（0.5×50=25ms）→ 重连 re-OPEN live（L190-215 保留不变） | `test/ws-replication-sa7-dynamic.test.ts:180-215` |
| G2 | `GOAWAY(SERVER_SHUTTING_DOWN)` → settle 后**立即 blocked**、wire 不关 | 同上 `:217-224` |
| D5 | `GOAWAY(SERVER_RESTARTING, drain=1)` 无 hint → drain timer 武装（pending+1）→ deadline fire `sender.teardown()` + close(1001)（pending-1）→ close 事件交付 → **backoff** → 重连 live | `test/ws-replication-sa7-issue137-dynamic.test.ts:517-579` |
| B1 | `GOAWAY(SERVER_SHUTTING_DOWN)` → **blocked 直达** + teardown，60s 推进零重拨 | 同上 `:583-631` |
| 类型锁 | `accept(transport): HubConnection`（同步、单参、非 undefined 返回） | `test/ws-replication-api.test-d.ts:47-60` |
| 4 处直建 hub | `issue137-driver.ts:104`、`spec-b1-b2-red.test.ts:179`、`sa7-issue137-dynamic.test.ts:687`、`sa7-r2-transport.test.ts:223` —— **均未传 `verifyToken`**（SA6 只补了 accept 侧 `{token: TEST_TOKEN}`） | git grep `createHubReplication` |

**兼容性结论（R1 修订）**：既有绿灯以「协议字面契约优先，工件随契约改锚」为原则——上表唯一与裁决相抵的断言是 G1 L189（`ready`），须 SA6 改锚（§6.5）；其余锚（G2/B1/D5/类型锁/直建 hub）逐点推演保持绿灯（§6.4 对账表），其中类型锁与 4 处直建 hub 的连带更新见 §11。

---

## §1 需求推演（Feature 切入点）

协议把「谁在连」从三层事实合成：**Upgrade 前的 bearer 认证**（可信身份来源，§2 L38）→ **HELLO 声明**（对端自报）→ **HELLO_ACK 绑定**（hub 侧对照 + peer 侧 nonce/hubInstanceId 对照）。当前实现只有第二、三层的一半（hub 不对照、peer 已对照 nonce/hubInstanceId，`peer-connection.ts:263-280`），缺第一层与「一层↔二层绑定」。

由此推导五个正交改动面（与 SA6 冻结契约表一一对应）：

| # | 改动面 | 切入点 | 冻结契约依据 |
|---|---|---|---|
| D1 | upgrade 认证管线 | `HubReplicationImpl.accept` 异步化：认证先于 `HubConnectionImpl` 分配 | AC-1（§2；ADR 0010 L155） |
| D2 | HELLO 身份绑定 | `HubConnectionImpl.onHello` 增认证身份对照 | AC-2（§2 L38） |
| D3 | 授权撤销 | `HubReplication.revoke` → `HubConnectionImpl.revokeNamespace` → `HubNamespaceChannel.terminateUnauthorized` | AC-4（§19；ADR 0010 L158） |
| D4 | GOAWAY 生命周期 | `PeerConnectionImpl.onGoaway` 分类细化 + drain timer 跟踪 + `onClose` draining 分支 + 停新 OPEN 门 | AC-5/6（§6.3/§15.1） |
| D5 | hub 停机 GOAWAY 先行 | `HubReplicationImpl.close` 先发 GOAWAY 再关；close 后零接纳 | AC-6（§21 第 1 步） |

架构一致性：D1–D5 全部落在既有模块边界内（hub-connection / hub-namespace / peer-connection / types / validate / index），不触碰 #136/#137 已冻结的 namespace 状态机、round engine、背压结构。

---

## §2 冻结契约类型变更（types.ts / index.ts / validate.ts）

### 2.1 `src/types.ts` 新增公共类型（与 driver.ts 镜像 L55-62 逐字段一致）

```ts
/** Hub upgrade 请求上下文（Bearer token 值；缺失 = 未提供凭据）。 */
export interface HubUpgradeRequest {
  readonly token?: string;
}

/** 升级认证器：token → 可信 Peer instanceId（文法 ^[a-z][a-z0-9-]{0,62}$）或拒绝。 */
export type PeerTokenVerifier = (
  token: string,
) => Promise<Readonly<{ ok: true; instanceId: string }> | Readonly<{ ok: false }>>;
```

### 2.2 接口变更（冻结）

```ts
export interface HubReplicationOptions {
  readonly instanceId: string;
  readonly registry: NamespaceRegistry;
  readonly authorize: NamespaceAuthorizer;
  readonly timer: ReplicationTimer;
  readonly verifyToken: PeerTokenVerifier;          // ← 新增，必填（冻结契约表 AC-1 行）
  readonly limits?: Readonly<Partial<ReplicationLimits>>;
  readonly timeouts?: Readonly<Partial<ReplicationTimeouts>>;
}

export interface HubReplication {
  accept(                                           // ← 契约变更（§13 审计）
    transport: DuplexTransport,
    request?: HubUpgradeRequest,
  ): Promise<HubConnection | undefined>;
  readonly connections: readonly HubConnection[];
  revoke(instanceIdentity: string, namespaceId: string): Promise<void>;  // ← 新增
  close(): Promise<void>;
}
```

`request` 可选：红灯 #3 L173 直调 `hub.accept(wireB.hubEnd)`（零参）必须类型合法且按「缺失凭据」拒绝。

### 2.3 `src/validate.ts`

- `validateHubOptions` 增加 `assertCallable(options.verifyToken, 'verifyToken')` —— §17 构造期响亮
  校验纪律（与 `authorize`/`timer` 同款；`TypeError` message 为静态文案，零 token 回显）。
- 新增导出 `isValidInstanceId(value: unknown): boolean`（复用 L13 `INSTANCE_ID_RE`）——D1 对验证器
  返回身份做布尔文法判定（不能复用 `validateInstanceId`：那里是 throw 语义，D1 需要 reject 语义）。

### 2.4 `src/index.ts`

type 导出追加 `HubUpgradeRequest`、`PeerTokenVerifier`。值导出面零变化。

---

## §3 D1：upgrade 认证管线（accept 异步化 + 早到帧缓冲 + fail-closed）

### 3.1 时序竞态（设计期钉死，非实现细节）

Peer 的 `dial()` 返回后**立即同步发 HELLO**（`peer-connection.ts:209-217`）。而认证是异步的
（`await verifyToken`）。fake wire 的投递是 `queueMicrotask` 快照式（`harness.ts:544-547`：
listener 集合**在 fire 时**快照）：

- 验证器若 ≥2 个微任务才结算（红灯 #6 用 `async () => ({ok:true,...})`，async 函数返回 promise
  的 await 链恰为 2+ tick），HELLO 投递微任务先 fire → **HELLO 落在无监听者窗口 → 永久丢失**
  → hello timeout（fake timer 不推进）→ 连接悬挂 → `waitConnection('blocked')` 预算耗尽。
- **同款竞态在真实 TCP 上已被既有测试处理**：`sa7-r2-transport.test.ts:132-144` 的 `TcpTransport`
  在 `onMessage` 注册时重放 `pendingFrames` 积压——「listener 晚于数据到达」是 transport 层真实
  存在的形态，fake wire 靠微任务时序掩盖了它。

**结论：accept 必须在认证前挂「早到帧缓冲」监听**，认证成功后移交连接并按序重放。这不是可选项，
是红灯 #1/#6 能否转绿的边界条件。

### 3.2 `HubReplicationImpl.accept` 伪代码（R2：有界早到缓冲 + 认证等待封顶）

```ts
// 模块级常量（非配置 knob——SA2 A2 裁定「零新 knob」；HELLO 是唯一合法早到帧（§2 L38），
// 守规矩的 peer 恰发 1 帧，16 为充裕余量；累计字节由「单帧界 × 条数界」导出：≤ 16×maxFrameBytes）
const MAX_EARLY_FRAMES = 16;

async accept(transport, request?): Promise<HubConnection | undefined> {
  // ── 门 0：停止接纳（生命周期门先于认证——已 close 的 hub 对新 upgrade 零工作）
  if (this.closed) { transport.close(1001, 'hub-shutdown'); return undefined; }

  // ── 门 1：缺凭据（未传 request / 无 token 字段 / 非字符串 / 空串）→ 拒绝
  const token = request?.token;
  if (typeof token !== 'string' || token.length === 0) {
    transport.close(1008, 'upgrade-unauthorized');   // 静态 reason，零 token/身份回显（AC-7）
    return undefined;
  }

  // ── 门 2：无认证器（类型必填 + §2.3 构造期 TypeError 后的纵深防御——JS 调用方绕过类型）
  //    「无认证器 = 全部 upgrade 拒绝」——fail-closed，绝不 fail-open
  if (typeof this.options.verifyToken !== 'function') {
    transport.close(1008, 'upgrade-unauthorized');
    return undefined;
  }

  // ── 门 3（R2 A2 + R3 N1）：有界早到帧缓冲 + 早断线观察 + 认证等待封顶
  const earlyFrames: Uint8Array[] = [];
  let earlyClosed = false;
  let authRejected = false;   // 预算/超时拒绝已发生——验证器迟归一律 undefined（迟归不复活）
  // R3 N1（SA2 必修，一行级）：off 句柄 no-op 初始化——同步重放型 transport（TcpTransport
  // 实存形态：onMessage 注册即同步重放积压、重放先于 return/句柄赋值，sa7-r2-transport:132-144）
  // 上，积压帧可在赋值语句完成前触发本 listener 的拒绝路径；no-op 句柄使 detachEarly 在
  // 【任意时刻】安全（重放期内调用 = 无害 no-op），注册完成后重赋真句柄。拒绝的【效果】
  // （置标志 + close）在重放期内照常生效；【摘监听】统一延后到注册完成后的同步段收口——
  // 不再从 transport.onMessage(...) 调用点同步抛 TypeError（那会使 async accept 的 promise
  // reject，违反 §8.2 硬不变量，且异常展开会流产重放循环——pendingFrames 已 splice、余帧丢失、
  // transport 未按设计关闭）。
  let offMessage: () => void = () => {};
  let offClose: () => void = () => {};
  const detachEarly = (): void => { offMessage(); offClose(); };   // 幂等（重复摘除零副作用）
  offMessage = transport.onMessage((bytes) => {
    if (authRejected) return;                       // 已拒（重放循环内后续帧）——幂等早退
    if (bytes.byteLength > this.limits.maxFrameBytes) {
      // 单帧界：复用既有 limit（ADR 0010 L165「最大 WS frame」）；§14 语义 → 1009
      authRejected = true;
      transport.close(1009, 'upgrade-frame-limit'); // 重放期内 close 照常生效（不摘监听）
      return;
    }
    if (earlyFrames.length >= MAX_EARLY_FRAMES) {
      // 条数界：第 17 帧即拒绝（policy）→ 1008
      authRejected = true;
      transport.close(1008, 'upgrade-frame-limit');
      return;
    }
    earlyFrames.push(bytes);
  });
  offClose = transport.onClose(() => { earlyClosed = true; });
  // 注册完成后的同步收口段（R3 N1）：同步重放期已拒（或注册期早断）→ 摘真句柄 + 直接拒绝
  // 返回。此刻 auth timer 尚未武装——零清理面；非重放路径 authRejected/earlyClosed 恒 false，
  // 本检查零开销通过。
  if (authRejected || earlyClosed) { detachEarly(); return undefined; }
  // 认证等待封顶（显式政策，非沉默）：复用 timeouts.helloTimeoutMs——握手预算的既有载体，
  // 零新 knob；超时 = 拒绝分配（1008 静态 reason）。起止：门 3 武装 → 任何出口即清（§8.1 矩阵）。
  const authHandle = this.internals.timer.setTimeout(() => {
    authRejected = true; detachEarly();             // 此时句柄必为真值（注册已完成）
    if (!transport.closed) transport.close(1008, 'upgrade-timeout');
  }, this.timeouts.helloTimeoutMs);
  const clearAuthTimer = (): void => { this.internals.timer.clearTimeout(authHandle); };

  // ── 门 4：验证（accept 永不 reject——红灯 #5 零 unhandled rejection 的不变量）
  let instanceId: unknown;
  try {
    const verdict = await this.options.verifyToken(token);
    clearAuthTimer();                               // 首要动作：验证器已归，封顶 timer 必清
    if (authRejected) return undefined;             // 缓冲期已拒（预算/超时）——迟归不复活
    if (verdict === null || typeof verdict !== 'object' || (verdict as {ok?:unknown}).ok !== true) {
      return this.rejectUpgrade(transport, detachEarly);            // {ok:false} 或畸形裁决
    }
    instanceId = (verdict as { instanceId: unknown }).instanceId;
  } catch {
    clearAuthTimer();
    if (authRejected) return undefined;             // 超时在先、验证器抛错在后——仍 undefined
    return this.rejectUpgrade(transport, detachEarly);              // 验证器抛错
  }
  // instanceId 文法违例（红灯 #4：'Bad-Id!'）→ 视为无效凭据
  if (!isValidInstanceId(instanceId)) {
    return this.rejectUpgrade(transport, detachEarly);
  }

  // ── 门 5：认证期间世界变化（R2 A4：先摘早到监听 → 再检查 → 再构造——顺序唯一基准，见 §3.3）
  detachEarly();
  if (this.closed) { transport.close(1001, 'hub-shutdown'); return undefined; }
  if (earlyClosed || transport.closed) return undefined;  // 对端已断：零分配、零 close 副作用

  // ── 分配：认证身份随连接注入；早到帧在构造尾部按序重放（§3.3）
  const connection = new HubConnectionImpl(
    this.internals, transport, this.connectionCounter++, instanceId as string, earlyFrames,
  );
  this.connectionList.push(connection);
  return connection;
}

private rejectUpgrade(transport, detachEarly): undefined {
  detachEarly();                                    // 幂等——预算路径已摘时零副作用
  transport.close(1008, 'upgrade-unauthorized');
  return undefined;
}
```

**认证等待封顶政策（SA2 A2 二选一的显式抉择）**：采用「包内 timer 封顶」而非「声明由
transport/宿主层超时负责」。理由：`DuplexTransport` 契约零超时面（`types.ts:48-54`——
send/close/closed/onMessage/onClose 五成员，无超时义务），把封口推给 transport 等于在 seam
契约里沉默添加隐式义务；复用 `helloTimeoutMs`（同一「握手完成预算」语义、既有注入 timer seam、
既有 §17 校验正值）使封顶确定性可测（fake scheduler 推进即触），且 worst case「认证 + HELLO」
总预算 ≤ 2×helloTimeoutMs 有界。

**R2 A2 资源账**：早到缓冲上界 = 16 帧 × maxFrameBytes 单帧界（默认 8 MiB × 16）+ 常数数组
开销；认证等待上界 = helloTimeoutMs；并发 N 个 accept 的总界 = N ×（上述单项界）——每 accept
独立缓冲、独立 timer，无共享无界结构。对无效凭据方：零连接分配 + 有界内存占用 + 有界占用时长
（AC-1 保护精神的资源面闭合）。

**畸形成功裁决（`ok:true` 但 `instanceId` 缺失/非串）归入拒绝**：这是信任边界上的防御性拒绝
（上游 verifier 违反契约时 hub 无法绑定身份 → 拒绝连接），不是静默降级——连接被显式关闭且
reason 稳定。与「拒绝虚假降级」立法的边界：**异常路径**（外部输入不可信）在信任边界上允许
fail-closed；正常路径的内部缺陷仍走响亮失败（§2.3 构造期 TypeError）。

### 3.3 零丢失 / 零重复的不变量（R2 A4：顺序唯一基准——先摘早到监听 → 构造 → 构造尾重放）

摘监听/构造/重放的顺序以 §3.2 门 5 伪代码为**唯一基准**（R1 版 §3.3 曾表述为「构造→摘监听」，
与 §3.2 矛盾——R2 统一删除）：

```
detachEarly();                                  // ① 摘早到监听（此时它们仍安装在册）
new HubConnectionImpl(..., earlyFrames)         // ② 构造：内挂连接监听（既有 :164-165），
                                                //    构造尾部同步重放 earlyFrames（§3.2 分配点）
```

不变量论证：

1. 认证 await 期间到达的帧 → 只进 `earlyFrames`（早到监听是当时唯一监听）→ 恰一次；
2. ①②在同一同步块内，**不可能**被微任务打断 → 摘监听与连接监听安装之间无第三帧窗口；
3. 投递微任务 fire 时对 listener 集合快照（`harness.ts:545`）——同步块完成后 fire 的帧只见
   连接监听 → 恰一次（Set 型多监听 transport，`makeEnd`/`TcpTransport` 均是）；
4. **对单槽替换型 transport 的稳健性**（R2 A4 补强）：①在早到监听仍安装在册时摘除——即便
   未来 transport 实现为「onMessage 替换单槽」，②的安装也不会使 off 句柄失效（R1 §3.3 的
   「构造→摘监听」形态在单槽语义下会摘错监听，故废弃）；
5. 重放路径复用 `onMessage`（handshaking 态内非 HELLO 帧 → `HELLO_REQUIRED` fatal，
   `hub-connection.ts:199-206`）——早到帧不绕过任何协议纪律；有界缓冲（≤16 帧）使重放
   同步段长度有界。
6. **同步重放型 transport 的句柄安全（R3 N1）**：transport 的 `onMessage` 注册即同步重放积压
   （TcpTransport 实存形态）时，①早到监听在重放期内触发拒绝 → 只置 `authRejected` + close
   （效果即时），**不摘监听**（off 句柄此时为 no-op 初值，`detachEarly()` 任意时刻安全）；②
   注册完成后的同步收口段 `if (authRejected || earlyClosed) { detachEarly(); return undefined; }`
   以**真句柄**摘除并拒绝返回——`transport.onMessage(...)` 调用点零同步抛出，「accept 永不
   reject」（§8.2）在一切 transport 实现形态下成立；重放循环零流产（余帧不丢、transport 按
   设计关闭）。回归锚 = §6.5 A2-e。

构造尾部形态：hello timer 武装（既有 `:159-163`）→ 挂监听 → `for (const b of earlyFrames) this.onMessage(b)`。
若 earlyFrames 首帧即 HELLO，则 hello timer 武装后立刻被 `onHello` 清除（`:238`）——零悬挂 timer。

### 3.4 观测面

- 红灯 #1：`verifyCalls` 恰 `[TEST_TOKEN]`——每 accept 恰一次验证调用（dial→accept 一比一）；
  `hub.close()` 后的 accept 在门 0 返回，**零验证调用**（停止接纳 = 零工作，不消耗验证器配额）。
- 红灯 #2/#3/#4/#5：`connections.length === 0`（连接对象从未入 `connectionList`）+
  `wire.hubSideClosed === true`（拒绝路径统一 1008 关闭）+ 认证失败后早到 HELLO 零处理
  （早到监听已摘、连接未分配 → 无 FSM 消费该帧 → `hubToPeer.length === 0`）。
- **R2 认证期 timer 计面**：auth timer 在 accept 出口必清（§3.2/§8.1）——boot 完成后（ready+
  live 已 await）fake scheduler 的 `pending()` 不含 auth timer 残留；既有 hub 侧 pending 锚
  （`sa7-dynamic.test.ts:75-76` 下界断言「不锁内部清单」、`:117-118` 相对递减）与该 timer
  的「武装→清除」瞬态零冲突（已逐行核对）。
- **R2 预算拒绝观测**（§6.5 A4 锚）：单帧超界 → `hubSideClosed(1009)` + 零分配；条数超界 →
  `hubSideClosed(1008)` + 零分配；两者都在**帧到达同步段**即拒绝（不等验证器归），后续灌帧
  落在已摘监听 + 已关 transport 上——零累积。

---

## §4 D2：HELLO 认证身份绑定

`HubConnectionImpl.onHello`（`hub-connection.ts:210-248`）在既有 `expectedHubInstanceId`
对照**之前**插入：

```ts
if (message.peerInstanceId !== this.authenticatedInstanceId) {
  this.connectionFatal('INSTANCE_IDENTITY_MISMATCH', 1008);   // ERROR + close(1008) + cleanup
  return;
}
```

- `authenticatedInstanceId` 为构造注入的只读字段（D1 分配时绑定）。
- 复用既有 `connectionFatal`（`:365-382`）：best-effort connection ERROR（safeMessage 为
  `frame-io.ts:30-32` 的静态 `protocol error: INSTANCE_IDENTITY_MISMATCH`，零身份/token 文本，
  红灯 #6 的 `safeMessage.includes(...)` 断言直接满足）→ `transport.close(1008)` → peer 侧
  `onClose(1008) → enterBlocked()`（`peer-connection.ts:496-498`）→ `waitConnection('blocked')`
  收口；`peerSideCloseInfo.code === 1008` 由 hub 侧 close 事件携带。
- `wsCloseCodeFor` 已含该码 → 1008 映射（`:429-433`），错误注册表 `INSTANCE_IDENTITY_MISMATCH`
  为 connection/config/1008（`replication-protocol/src/errors.ts:105`）——零新错误码。
- 公共 `peerInstanceId` 字段语义不变（HELLO 完成前 `undefined`，`:110/:234`）。

---

## §5 D3：授权撤销（revoke）——只关 scope，不关连接

### 5.1 调用链（三层，各自守边界）

```ts
// HubReplicationImpl（hub-connection.ts）
async revoke(instanceIdentity: string, namespaceId: string): Promise<void> {
  const tails: Promise<void>[] = [];
  for (const connection of [...this.connectionList]) {          // 拷贝迭代——revoke 途中连接可能收口
    if (connection.authenticatedInstanceId !== instanceIdentity) continue;   // 认证身份为权威键
    tails.push(connection.revokeNamespace(namespaceId));
  }
  await Promise.all(tails);                                      // 未知 scope → 空数组 → resolve
}

// HubConnectionImpl
revokeNamespace(namespaceId: string): Promise<void> {
  const channel = this.channels.get(namespaceId);               // HELLO 前无 channels → 天然 no-op
  if (channel === undefined) return Promise.resolve();
  return channel.terminateUnauthorized();
}
```

身份键取 `authenticatedInstanceId`（D1 权威来源）而非 HELLO 自声明：二者在 HELLO 绑定后必然相等
（D2 保证），而 HELLO 前不存在任何 channel——两键在可撤销面上不可区分，取认证键语义更严。

### 5.2 `HubNamespaceChannel.terminateUnauthorized()`（hub-namespace.ts 新增公共方法）

```ts
/** 授权撤销（§19 L158）：terminating namespace ERROR + failed 终局 + 资源收口。
 *  quiet/终态（closing/closed/conflicted/failed）→ 零副作用 no-op（重复 revoke 幂等）。 */
terminateUnauthorized(): Promise<void> {
  if (this.isQuietState()) return Promise.resolve();            // 既有判据（:804-811）
  this.sendNsError('NAMESPACE_UNAUTHORIZED');                   // 既有（:770-772）→ namespaceErrorFrame
  this.finalize('failed');                                      // 既有（:791-796）：清 timer/终态/收口
  return this.terminationSettled();                             // §5.3
}
```

- `NAMESPACE_UNAUTHORIZED` 为 namespace scope / config / terminalState=failed
  （`errors.ts:115`）——与 `terminalStateOf('NAMESPACE_UNAUTHORIZED') === 'failed'`（`error-mapping.ts:38-40`）
  一致，hub 侧通道与 peer 侧控制器（`onErrorFrame → finalize(toFinalState(...))`，
  `peer-namespace.ts:520-527`）**对称终局到 failed**。
- ERROR 帧携带 `namespaceId`（`namespaceErrorFrame`，`frame-io.ts:45-57`）→ 红灯 #7 的
  `unauthorized[0].namespaceId === ns2` 直接满足；恰 1 帧——`terminateUnauthorized` 的 quiet
  守卫 + `finalize` 的终态守卫（`:792`）双重保证重复调用零重复帧。
- 连接与其余 namespace 不受影响：`terminateUnauthorized` 不触碰连接层任何状态；
  `channels` 中其余通道与 `HubConnectionImpl.state`（仍 ready）原样——红灯 #7 的
  `ns1 live / connection ready / peerSideCloseInfo undefined` 全部由「只动单通道」结构性满足。
- opening 态撤销（授权在途）：`finalize('failed')` 先置终态 → 在途 `startOpen` 续体的
  `isTerminal()` 检查（`hub-namespace.ts:238-241` 等）走 `finishOpenSilently` → 零 wire、资源回收
  ——既有 §13.4 迟到纪律覆盖，无新路径。

### 5.3 revoke 的结算语义（R2 A5：cleanupTail 链式追加）

`finalize` 内部 `void this.closeSessionAndRelease()`（`:795, :817-835`）是 fire-and-forget。
为让 `revoke` resolve 即「资源已收口」确定成立，改造为**链式追加**（R1 版单字段覆写
`this.cleanupTail = <promise>` 在 revoke 与并发 `onConnectionClosed`（closeQueue 链）竞争时
后写覆写前写——方向保守（等更久）但强度弱于声称；R2 按 SA2 A5 改链式）：

```ts
/** 收口单点：执行幂等清理体并【链式追加】到 cleanupTail——所有发起方（finalize/
 *  terminateUnauthorized/onConnectionClosed）的清理都汇入同一链，无覆写丢尾。 */
private settleClose(): Promise<void> {
  const op = this.closeSessionAndReleaseOnce();     // 既有 :817-835 实现体（幂等：session/
  this.cleanupTail = this.cleanupTail.then(         // unsub/lease 二次调用见 undefined 即跳过）
    () => op, () => op,
  ).then(() => undefined, () => undefined);         // R3 N4（SA2）：存储前归一化——清理体若抛错
  return this.cleanupTail;                          //（session.close 现无内捕，与既有 void 形态同款
}                                                   // 暴露），void this.settleClose() 不产生 floating
                                                    // rejected promise（红灯 #5/D5/B1 probe 面）；
                                                    // terminationSettled 本就吞异常——归一化零语义损失
```

- `finalize` / `terminateUnauthorized` / `onConnectionClosed` 的清理一律经 `settleClose()`
  （既有 `void this.closeSessionAndRelease()` 调用点替换为 `void this.settleClose()`）。
- `terminationSettled()` 返回 `this.cleanupTail.then(() => undefined, () => undefined)`
  （吞清理异常——session.close/lease.release 的异常在收口链内部分类处理，不允许冒泡成
  revoke rejection；红灯 #7/#8 断言 revoke resolve）。
- **强度恢复**：`revoke` resolve ⟺ 该通道**全部已发起**的清理（含并发收口路径）均已 settle——
  链式保证 revoke 观察到的 tail 覆盖其之前追加的一切 op；其之后追加的 op 由各自发起方等待，
  且清理体幂等使晚到的重复收口零副作用。

---

## §6 D4：GOAWAY 生命周期（无条件 draining / 停 OPEN+round / retryAfterMs hint 调度）

### 6.1 裁决记录（R1：总控裁定协议字面契约，推翻 R0 hint 键控）

**裁决原文（总控，2026-08-29，针对 SA8 CP-1/CP-2）**：按协议字面契约执行——ready 态收到的 GOAWAY
**无条件**进入 draining（与 retryAfterMs 无关）；一切 GOAWAY drain 路径**无差别**停新 OPEN 与新 sync round。

**设计落实（三条）**：

1. **drain 类 GOAWAY（`SERVER_RESTARTING` 及一切非永久类 reasonCode）从 ready 收到即
   `setState('draining')`**——协议 §15.1 L411 字面 `ready ├─ local-stop/GOAWAY → draining`。
   `retryAfterMs` hint **只影响 deadline close 后的重连调度**（hint → `retryAfterMs + jitter`；
   无 hint → 普通 full-jitter backoff），不影响状态机转移本身。
2. **裁决作用域边界（显式声明）**：`SERVER_SHUTTING_DOWN` / `REAUTH_REQUIRED` 两类永久失败
   GOAWAY 保持 **blocked 直达**（不经 draining）。这同样是协议字面——§15.1 GOAWAY 原因分级表
   明文「`SERVER_SHUTTING_DOWN`：blocked，等待配置/人工 start」「`REAUTH_REQUIRED`：blocked，
   等待 token/config 变化」；SA8 CP-1 减轻因素 ② 已认定「分级细化通用边是协议自身认可的读法」
   （该分支由既有绿灯 G2/B1 与协议分级表共同锚定）。总控裁决限定语「regardless of
   retryAfterMs」针对的正是 CP-1 的 hint 键控分歧面（retryAfterMs 仅在 drain 类上有意义）；若把
   blocked 类也强折为 draining-then-blocked，则假时钟世界 blocked 永不可达（须 deadline 推进），
   击穿 G2/B1 且与「legacy 锚仅 G1 L189 一处改锚」的处置不符。红灯 #10 的 hub 停机
   GOAWAY（`SERVER_SHUTTING_DOWN`）→ peer blocked 的既有对账（§7）不受影响。
3. **停新 OPEN / 停新 round 的无差别结构性门（CP-2 消解）**：drain 类 → draining 态
   （出站 ready 门关 + `addTarget` ready 分支不可达）；blocked 类 → blocked 态（出站 ready 门关 +
   sender teardown + 控制器 disconnected 投影）。两类的门均键控于**连接状态**而非标志位——
   SA8 指出的「无 hint 路径状态保持 ready ⇒ 出站门放行 ⇒ round 可启动」缺口随无条件 draining
   自动闭合（SA8 预判：「若 CP-1 裁字面 draining，则 draining 出站门自动覆盖，本条消解」）。
   round 抑制的两条路径（源码核实，精确区分）：
   - **入站触发**（对端 RESYNC_REQUIRED 等）：`onMessage` 状态门（`peer-connection.ts:234`，
     解码**前**）在 draining 态直接丢弃——控制器零扰动、零状态迁移；
   - **本地触发**（ACK_TIMEOUT timer 等）：本地 timer 照常 fire → `onAckTimeoutFired →
     needs-resync → maybeStartRecovery → startRound → host.send`（`peer-namespace.ts:447-451,635-638`
     + `round-engine.ts:82-86`）→ Step1 经 `sendControl` ready 门**零上 wire**；控制器本地状态机
     推进（needs-resync→reconciling）但无 wire 效应，deadline close 的 teardown 使 round 状态
     随连接终结归零，重连后 `openActiveTargets` 重 OPEN + 新 round 恢复——无悬挂 round 跨连接。

**R0 hint 键控裁决作废**：其论据（「hint=编排重启信号→draining；无 hint=deadline 通告→保持
ready」）被 SA8 认定为「文本中不存在的细化读法，实质收窄 wire contract 状态机语义」（CP-1），
且「不推翻既有绿灯」论据落在非约束工件（代码/测试）上——按 SA8 规则不能以工件既有行为豁免
契约文本的字面要求。R0 §6.1/§6.2 的键控伪代码与 `goawayReceived` 标志整体删除，全文零死引用。

### 6.2 `onGoaway` 重写（peer-connection.ts:363-395 替换）

```ts
private goawayRetryAfterMs: number | undefined;   // hint（无则 undefined）——只用于重连调度
private drainCloseHandle: unknown;                // §8 timer 纪律：句柄必须可清

private onGoaway(message: { reasonCode: string; drainTimeoutMs: number; retryAfterMs?: number }): void {
  this.goawayDrainMs = message.drainTimeoutMs;
  this.goawayRetryAfterMs = message.retryAfterMs;
  if (message.reasonCode === 'SERVER_SHUTTING_DOWN' || message.reasonCode === 'REAUTH_REQUIRED') {
    // §15.1 原因分级（G2/B1 冻结锚）：永久失败类——blocked 直达（sender teardown），
    // 无 deadline 编排、wire 不关
    this.sender?.teardown();
    this.setState('blocked');
    return;
  }
  // drain 类（SERVER_RESTARTING 及未知非永久类）：§15.1 L411 字面——无条件 draining。
  // 注意：此处【不】teardown sender——D5 的 scheduler.pending 计面锚（drain timer 恰 +1，
  // poll timer 保持武装至 deadline fire 才清）依赖「draining 进入仅改状态」；teardown
  // 统一在 deadline fire / blocked / 收口路径执行（§8.1 矩阵）。
  this.setState('draining');
  this.armDrainClose();                // deadline close(1001)——hint 与否无差别
}

private armDrainClose(): void {
  this.clearDrainClose();
  const transport = this.transport;
  this.drainCloseHandle = this.options.timer.setTimeout(() => {
    this.drainCloseHandle = undefined;
    this.sender?.teardown();                            // D5 主锚：close 前清 poll timer
    if (transport !== undefined && !transport.closed) {
      transport.close(1001, 'goaway-drain');
    }
  }, this.goawayDrainMs);
}
```

draining 期间出入站纪律（R1：**hint 有/无两形态无差别**，全部由既有门结构性成立，零新门）：

- **出站（停新 OPEN + 停新 round 的结构性门）**：`sendControl`/`sendData` 的 ready 门
  （`peer-connection.ts:426, 438`：`connStateValue !== 'ready' → 0`）在 draining 态抑制一切
  控制器帧——OPEN_NAMESPACE、round Step1/Step2（`round-engine.ts:82/109/178` 全经
  `host.send → sendChecked → sendControl`）、CLOSE_NAMESPACE 一并停发。
- **入站**：`onMessage` 状态门（`:234` 只放行 handshaking/ready）在 draining 态忽略对端帧——
  deadline 内对端残留 UPDATE 的 ACK 缺失由对端 ack-timeout→needs-resync 有界处理，deadline
  close 后重连 reconcile round 修复收敛（G1 已锚「数据不丢」同款路径；SA8 注记 N2 采同向取舍）。
- **addTarget（停新 OPEN 的第二道门）**：`addTarget` 的 ready 分支（`:146`）在 draining 态天然
  不可达（状态 ≠ ready）——控制器停 `targeted`，重连后 `openActiveTargets`（`:407-418`）统一
  补 OPEN。R0 的 `&& !this.goawayReceived` 标志门删除（状态门已完备，双门冗余）。

**自然收口 vs 重连 reconcile 的取舍声明（R2 A3，显式落文）**：协议 §6.3 L147 的完整句是
「收到 GOAWAY 后停止 OPEN，不开始新 sync round；**现有 namespace 到 deadline 前自然收口**，
之后发送方以 WS 1001 关闭」。本设计在 draining 窗口采用**双向冻结**（出站 ready 门 + 入站
状态门），意味着：在途 round 的完成帧（SYNC_STEP2/SYNC_APPLIED/UPDATE_ACK）也被冻结，
「自然收口」在**接收侧被有意替换为重连 reconcile**（deadline close → 新连接 → OPEN →
state-vector round 收敛）。取舍理由：

1. 协议显式义务是停「**新** OPEN / **新** round」；对在途 round 完成帧的去留未作规定，而
   §12 L313「正常 close 不等待丢失的 UPDATE_ACK；下次连接通过 state vector 修复」+ §16
   重连纪律已为「close 后 reconcile 修复」提供同款先例——数据安全无虞（Yjs 幂等合并；
   G1 已锚 drain→重连→收敛「数据不丢」）。
2. 出站白名单方案（放行 {SYNC_STEP2, SYNC_APPLIED, UPDATE_ACK, CLOSE_NAMESPACE}）需要在
   连接层区分「完成中的 round」与「新 round」——round 归属信息在 round engine/控制器层，
   跨层耦合；且与入站冻结组合语义不完整（对端 UPDATE 收不进来，白名单 ACK 也无意义），
   并与 §6.5 A2-b 变体二的「帧计数冻结」锚冲突。SA2 评审已把白名单路线标记为「须同步重审
   A2-b 锚 + 另行评审」——本设计取 (a) 声明路线。
3. **代价登记（NR-1 空转面）**：drain 窗口内本地恢复机械可能空转——本地触发的
   needs-resync→reconciling 迁移 + reconcile timer 武装（零 wire 效应，§6.1 落实点 3），至
   deadline close 的 teardown 止。窗口有界（drainTimeoutMs 由 hub 声明），空转无资源累积。
4. **呈报总控**：请将本取舍（双向冻结 + 重连 reconcile 替换自然收口 + NR-1 空转面）登记进
   `wiki/raw/task_phase5-ws-auth-lifecycle_relevant_decisions.md` 的「设计引入的新决策点」节
   （该文档由 SA8 维护，SA1 不代笔）。

### 6.3 `onClose` 的 draining 分支与 hint 重连调度（`:490-501` 扩展）

```ts
private onClose(info: Readonly<{ code: number; reason: string }>): void {
  if (this.stopping || this.connStateValue === 'stopped') return;
  if (this.connStateValue === 'backoff' || this.connStateValue === 'blocked') return;
  if (this.connStateValue === 'draining') {
    // R2 A1（SA2 必修）：close 事件的机器语义由 code 携带（协议 §14「WS close code 只做
    // 粗分类」+ §15.1 L439「1002/1008：blocked」），与进入 draining 的前因（GOAWAY）无关——
    // drain 窗口内 hub 侧 connectionFatal(1002/1008)（hub-connection.ts:365-382，peer 冻结
    // 出站不阻止 hub 侧检测）或中间盒 1008 强断都可能到达。分类与非 draining 态完全同构：
    // 永久类 → blocked；其余（1000/1001/1006/1011…）→ onGoawayClosed（1011 落 backoff
    // 恰合 §15.1 L440「继续 backoff」——SA2 确认不受影响）。
    if (info.code === 1002 || info.code === 1008) {
      this.clearDrainClose();      // drain timer 清理（总控 R2 指令）——杜绝 stale fire
      this.enterBlocked();         // enterBlocked 亦含 clearDrainClose（§8.1 单点纪律，双保险）
      return;
    }
    this.onGoawayClosed();         // 本地 stop() 的 draining 由上行 stopping 守卫拦截
    return;
  }
  /* 既有：1002/1008 → blocked；其余 → onTemporaryFailure（不变——G1 deadline close 即走此路径） */
}

/** GOAWAY drain 关闭后的重连编排（§15.1 SERVER_RESTARTING 行）。 */
private onGoawayClosed(): void {
  this.clearDrainClose();
  this.sender?.teardown();
  const retryAfter = this.goawayRetryAfterMs;
  if (retryAfter === undefined) {
    this.onTemporaryFailure();                        // 无 hint：普通 full-jitter backoff（G1 L193-209/D5 冻结面——R1 仅改其前的 draining 投影，本分支不变）
    return;
  }
  this.clearHello(); this.clearReset();
  this.setState('backoff');
  for (const controller of this.controllers.values()) controller.onConnectionLost();
  // hint 面公式：delay = retryAfterMs + random()×cap（cap 复用 §15.1 full-jitter 帽；
  // random=0 → 恰 retryAfterMs；attempt 不递增——hub 编排的重回不是失败事件，不放大退避）
  const cap = Math.min(this.backoff.maxMs, this.backoff.baseMs * 2 ** this.attempts);
  const random = this.options.random ?? Math.random;
  this.backoffHandle = this.options.timer.setTimeout(() => {
    this.backoffHandle = undefined;
    if (this.connStateValue === 'backoff') this.dialNow();
  }, retryAfter + Math.max(0, random() * cap));
}
```

红灯 #9 逐点对账（fake scheduler 时间轴，t=0 收 GOAWAY）：

- settle 后 `draining` ✓（§6.2 无条件分支——R1 后 hint 面行为与红灯 #9 断言逐字吻合）；
- drain 期 `addTarget(ns2)` → wires[0] 上 OPEN 恒 1（ns1 首连那帧）✓（§6.2 停 OPEN 门）；
- `advanceMs(1000)` → drain timer fire → close(1001)；测试随后 `closePeerSide(1001,'goaway-drain')`
  交付本地 close 事件（harness 保真度注记 `:310`、G1 同款 `:196-198`）→ `onClose(draining)` →
  `onGoawayClosed` → delay = 6000 + 0×cap = **6000ms**（random=0）；
- t=5000：`dialCount === 1` ✓（timer 未到）；
- t=7500 ≥ t_close(1000)+6000 = 7000：`dialCount === 2` ✓。

### 6.4 既有锚对账（R1：协议字面优先，工件随契约改锚）

| 锚 | R1 路径 | 结论 |
|---|---|---|
| G1（`sa7-dynamic:180-215`） | 无 hint → **draining**（L189 断言改锚，§6.5-A1）→ deadline fire（teardown+close 1001）→ closePeerSide 交付 close 事件 → `onClose(draining) → onGoawayClosed` 无 hint 分支 → 既有 `onTemporaryFailure`（attempts=1，cap=50，0.5×50=25ms）→ t+25 重连 re-OPEN live | **L189 一处改锚（SA6）**；L190（wire 未关）/L193-215（deadline close、backoff 25ms、重连、单 OPEN、数据收敛）逐断言不变——draining 期 G1 无 addTarget/无帧流量预期，零观测差 |
| D5（`sa7-issue137-dynamic:517-579`） | 无 hint → draining（**无断言触及该窗口的连接状态**）；`pending()` 计面：draining 进入仅 `setState` + `armDrainClose`（恰 +1 ✓ L544；**不 teardown sender**——poll timer 保持武装，§6.2 注记）；advanceBy(1) → fire → teardown（poll 清）+ close → pending-1 ✓ L552；60s stale 零副作用 ✓；closePeerSide → `onGoawayClosed` 无 hint → backoff ✓ L563；重连 live/收敛 ✓ | **零改锚保持绿**（SA8 报告把 D5 与 G1 并列为「需 SA6 改锚」，R1 逐断言复核：D5 全文无 draining 窗口内的连接状态断言，pending 计面在「进入仅改状态」的实现约束下成立——该约束已写入 §6.2 伪代码注记，SA3 不得在 draining 进入点加 teardown） |
| G2/B1 | SHUTTING_DOWN 分支原样保留（blocked 直达 + teardown + wire 不关；§6.1 落实点 2 的作用域边界） | 保持绿 |
| 红灯 #9（hint 面） | draining/停 OPEN/retryAfter 调度逐字保持（§6.3 对账） | 转绿（断言零改动） |

### 6.5 测试锚变更清单（SA6 执行；SA1 只列契约，不动测试文件）

**A1（既有锚改锚）** — `test/ws-replication-sa7-dynamic.test.ts:186-190`（G1）：

- L189：`expect(run.connectionState()).toBe('ready')` → `.toBe('draining')`
  （依据：总控 R1 裁决 + 协议 §15.1 L411 字面）。
- L188 注释同步：「deadline 未到：连接照常」→「deadline 未到：连接 draining（§15.1 字面；
  既有 namespace 不强关——自然收口到 deadline」。
- L190 `peerSideClosed === false` 及其后全部断言保留。

**A2（红灯契约新增锚，R3 后共 5 个 IT：a/b 系 R1 总控裁决面，c/d 系 SA2 A1/A2 必修面，
e 系 SA2 R2 复审 N1 必修面）** —
`test/ws-replication-auth-lifecycle-red.test.ts` 追加
（冻结契约文件，SA6 owned；实现前红灯、实现后转绿）：

- **A2-a 无 hint draining 面（CP-1 字面锚）**：`boot({ random: () => 0, backoff: { baseMs: 50, maxMs: 400, resetAfterMs: 500 } })`
  → live → `injectHub({ kind: 'GOAWAY', reasonCode: 'SERVER_RESTARTING', drainTimeoutMs: 60 })`（**无
  retryAfterMs**）→ settle → 断言 `connectionState() === 'draining'`（G1 改锚面的契约级固化，
  不依赖 legacy 文件）；drain 期 `addTarget(ns2)` → 断言 wires[0] OPEN_NAMESPACE 计数不增
  （停新 OPEN 无差别面）；`advanceMs(60)` + `closePeerSide(1001)` → backoff → `advanceMs(25)`
  → 重连 ready + ns1/ns2 live（普通 backoff 出口在无 hint 面同样成立）。
- **A2-b drain 期停新 sync round（CP-2 字面锚，两变体——SA6 按确定性择一或双锚）**：
  `boot({ random: () => 0, timeouts: { ackTimeoutMs: 40 } })` → live → 记 wires[0]
  peerToHub 的 `SYNC_STEP1` 基线 →
  - **变体一（本地触发——主锚，真正穿过 round 发起点）**：`writePeer({n:1})` → settle →
    `dropNextHubFrame('UPDATE_ACK')`（ACK 丢弃 → 本地 ACK_TIMEOUT timer 是 drain 窗口内唯一
    round 触发源）→ `injectHub(GOAWAY, SERVER_RESTARTING, drain=200)`（hint 有/无均可）→ settle
    （draining）→ `advanceMs(≥ackTimeoutMs 且 <deadline)` → 本地 timer fire、恢复链推进至
    `startRound`（§6.1 落实点 3）→ 断言 STEP1 计数 === 基线（出站 ready 门拦截）且
    `UPDATE`/`OPEN_NAMESPACE` 计数冻结；
  - **变体二（入站触发——辅锚，验证入站门）**：draining 期
    `injectHub({ kind: 'RESYNC_REQUIRED', namespaceId: ns1, reasonCode: 'send-queue-overflow' })`
    → settle → 断言 STEP1 计数 === 基线 **且** `getNamespaceState(ns1)` 保持 `live`
    （入站门 `:234` 解码前丢弃——控制器零扰动）；
  - 收尾（共用）：`advanceMs(过 deadline)` + `closePeerSide(1001)` → 重连后 STEP1 计数恢复
    增长（新连接新 round）+ ns1 live（数据经 reconcile round 收敛）。
  - 锚定纪律沿文件头红线（fake-duplex/fake scheduler/零 mock 被测对象/wire 级断言）；注入沿用
    `injectHub`/`dropNextHubFrame` 的序列记账与静默窗纪律。
- **A2-c draining 期 close-code 分类（SA2 攻击点 A1 修复锚——红灯：现设计 1002/1008 落
  backoff）**：`boot({ random: () => 0 })` → live → `injectHub({kind:'GOAWAY',
  reasonCode:'SERVER_RESTARTING', drainTimeoutMs: 5000})` → settle 断言 `draining` →
  `wire.closePeerSide(1002, 'protocol-error')` → settle → **断言 `connectionState()==='blocked'`**
  → `advanceMs(5_000 + 60_000)` → 断言 `dialCount===1`（blocked 零重拨）且 wire 帧冻结
  （零 stale drain-close 副作用——drain timer 已清）。变体：`closePeerSide(1008)` 同断言；
  反向对照 `closePeerSide(1001)` → backoff（钉死 1001/1011 路由不被修复波及）。
- **A2-d 认证期早到帧预算（SA2 攻击点 A2 修复锚——红灯：现设计无界）**：`makeAuthHub` + 受控
  deferred verifier（不立即 resolve）→ `hub.accept(wire.hubEnd, {token: TEST_TOKEN})`（不
  await）→ 灌帧：1 帧合法 HELLO + 16 帧垃圾字节（各 ≤ maxFrameBytes）→ **断言
  `wire.hubSideClosed===true` 且 `hub.connections.length===0`**（第 17 帧触发条数界，帧到达
  同步段即拒）→ resolve verifier `{ok:true, instanceId: PEER_INSTANCE}` → settle → accept
  结果 undefined（迟归不复活）。变体：单帧 > `maxFrameBytes`（`CONTRACT_LIMITS.maxFrameBytes`
  + 1 字节）→ 同断言（1009 路径）；**边界内防回归（R3 并入）**：恰 1 帧 HELLO → 正常分配 +
  `hubFramesAll('HELLO_ACK').length === 1` + 零 `SEQUENCE_VIOLATION`（§3.3 恰一次投递
  不变量——两种摘监听实现形态下均成立）；认证超时变体（可选，R3 N3 修正）：deferred verifier
  不 resolve → **推进 hub scheduler**（makeAuthHub 场景 `node.scheduler.advanceBy(helloTimeoutMs)`
  ——`advanceMs(run,…)` 推进的是 peer scheduler（driver.ts:548-549），auth timer 挂在 hub
  scheduler 上，误用则 timer 永不 fire、锚恒红）→ 断言 hubSideClosed(1008) + 零分配（封顶政策锚）。
- **A2-e 同步重放型 transport 注册期拒绝（SA2 R2 复审 N1 必修锚——防伪绿：冻结套件的 fake
  wire 无同步重放形态，测不到本面）**：测试本地构造同步重放 fixture（**非 mock 被测对象**——
  实现 DuplexTransport 五成员，`onMessage(listener)` 注册后同步重放预置积压、重放先于 return，
  同 TcpTransport 形态 `sa7-r2-transport.test.ts:132-144`）：主用例预置积压 = [1 帧 >
  `CONTRACT_LIMITS.maxFrameBytes` 的字节串] → `makeAuthHub`（立即 resolve 的 verifier）→
  `const p = hub.accept(t, {token: TEST_TOKEN})` → `await expect(p).resolves.toBeUndefined()`
  （红灯点：R2 伪代码形态下此处 reject——TypeError 自 `transport.onMessage(...)` 调用点同步
  抛出）+ `collectUnhandledRejections()` 空 + transport 已关闭（1009）+
  `hub.connections.length===0` + 重放余帧零丢失断言（fixture 记录已重放帧数 = 预置数——异常
  流产会中断重放循环）。变体：预置 17 帧正常尺寸积压 → 条数界同断言（1008 +
  resolves.toBeUndefined）。锚定纪律同文件头（fixture 属 seam 层，零 mock 被测对象）。

**A3（连带更新，非 GOAWAY 域）** — §11 已列的 api.test-d 签名同步与 4 处直建 hub 补
`verifyToken`（R0 已覆盖）；R2 增：driver.ts 镜像类型层例外经 §13 表登记（SA2 A6，见该表）。

---

## §7 D5：hub.close() GOAWAY 先行 + 停止接纳

### 7.1 `HubReplicationImpl.close`（`hub-connection.ts:90-100` 修订）

```ts
close(): Promise<void> {
  if (this.closed) return this.closeTail;
  this.closed = true;                                   // 先置位：accept 门 0 即刻生效（§3.2）
  for (const connection of [...this.connectionList]) {
    connection.shutdownWithGoaway(this.timeouts.closeTimeoutMs);
  }
  this.closeTail = Promise.all(this.connectionList.map((c) => c.settle())).then(() => undefined);
  return this.closeTail;
}
```

`drainTimeoutMs` 取 `timeouts.closeTimeoutMs`（默认 5000，`defaults.ts:36`，§17 校验保证 >0——
红灯 #10 的 `drainTimeoutMs > 0` 满足；不为停机新造配置面，理由：它是「close 收口窗口」的既有
语义载体，新 knob 扩大冻结面而无验收需求）。

### 7.2 `HubConnectionImpl.shutdownWithGoaway`（新增）

```ts
/** §21 第 1 步：GOAWAY(SERVER_SHUTTING_DOWN, drain) 先行，随后 close(1001)。
 *  handshaking 连接不发 GOAWAY（HELLO 未完成——对端 handshaking 门对非 HELLO_ACK 帧
 *  判 CONNECTION_POLICY_VIOLATION，peer-connection.ts:256-258；GOAWAY-before-ACK 反而是
 *  协议伤害）；直接 close(1001)。 */
shutdownWithGoaway(drainMs: number): void {
  if (this.closedFlag) return;
  if (this.state === 'handshaking') { this.close(1001, 'hub-shutdown'); return; }
  try {
    this.outbound.sendControl({                        // 直发豁免（同 connectionFatal :369-375）：
      kind: 'GOAWAY',                                  // sender.sendControl 在 paused 态有额度
      reasonCode: 'SERVER_SHUTTING_DOWN',              // 判据，耗尽即 connectionFatal——停机帧
      drainTimeoutMs: drainMs,                         // 不允许被背压额度否决
    });
  } catch { /* best-effort：framing 不可信 → 直接 close */ }
  this.close(1001, 'hub-shutdown');                    // 既有路径：teardown + close + cleanupAll
}
```

- **帧序保证**：GOAWAY 经 `outbound.sendControl` 同步 emitRaw → transport.send（`frame-io.ts:123-127`）
  ；紧随的 `transport.close` 在其后——fake wire 微任务 FIFO（`harness.ts:544-555`）保证对端先收
  GOAWAY 再收 close 事件；红灯 #10 settle 后 `hubFramesAll('GOAWAY').length === 1` ✓。
- **close promise 不等 deadline**：`closeTail` 只等 `settle()`（通道 cleanup：排空已接纳 apply →
  session close → lease release，全微任务界）；transport 在 GOAWAY 后立即 1001 关闭——「不无限
  等待网络 ACK」由「收口后无出站」结构性满足，且红灯 #10 在零时间推进下 `await closePromise`
  必须结算（fake timer 不前进，等 deadline 即死锁——测试形态钉死了这一点）。
- peer 收 GOAWAY(SERVER_SHUTTING_DOWN) → blocked（G2 分支）→ 紧随 close(1001) 事件被 blocked
  早退吸收（`:493`）——与 §6.2 一致。
- **close 后零接纳**：accept 门 0 返回 undefined + `transport.close(1001)`，零分配、零验证调用
  （§3.4）——红灯 #10 后半 ✓。

---

## §8 边界 / 并发 / 资源纪律

### 8.1 Timer 矩阵（§8 teardown 纪律补行——drain/auth 句柄从无到有）

| timer | 武装点 | 清除点 |
|---|---|---|
| `drainCloseHandle`（新） | `armDrainClose` | `clearDrainClose`：fire 自清 / `onGoawayClosed` / `dialNow` / `stop`（加入既有 clear 列 `:103-105`）/ **`enterBlocked`（R2 A1 单点：draining 期 1002/1008 close、connectionFatal 等一切经 enterBlocked 的 blocked 入口）。R3 N2 注明：§6.2 的 onGoaway blocked 分支（SHUTTING_DOWN/REAUTH → teardown+setState 直达）**不经 enterBlocked、亦无 clearDrainClose 调用**——该分支处于 ready 态、drainCloseHandle 必为 undefined（armDrainClose 仅存在于 drain 类路径），空虚真安全（零行为差异）；**不改路由**：若强改经 enterBlocked，其额外 clearReset 会使 B1 的 pending 计面 -2（SA2 已排除）——路由语义冻结 |
| `backoffHandle`（hint 复用） | `onGoawayClosed` hint 分支 | 既有 `clearBackoff`（fire 自清 / dialNow / stop / enterBlocked / requestRebuild） |
| `authHandle`（R2 A2 新，hub 侧） | `accept` 门 3（认证等待封顶，`helloTimeoutMs`） | `clearAuthTimer`：验证器 settle（try/catch 两路首行动作，§3.2 门 4）/ 早到预算拒绝路径（detachEarly 同步段）/ fire 自拒（authRejected=true + 摘监听 + close）——**accept 任何出口必清**，零悬挂 |

stale fire 防御：drain timer fire 时 `sender?.teardown()` 幂等 + `transport.closed` 检查（§6.2
伪代码），迟到 fire 零副作用——与 D5 的 stale 调度面同型。

### 8.2 unhandledRejection 不变量

- `accept` **永不 reject**（§3.2 门 4 全 catch；畸形裁决/文法违例/验证器抛错一律 resolve
  undefined）——driver 的 `hub.accept(...)` 全部 fire-and-forget（`:473/:631` 等 6 处），accept
  一旦 reject 即成进程级 unhandledRejection。红灯 #5 的 probe 直接断言此不变量。
- `revoke` 内部 `Promise.all` 的成员经 `terminationSettled` 吞清理异常（§5.3），resolve 语义稳定。
- `shutdownWithGoaway` 的 GOAWAY 发送 try/catch（§7.2），framing 异常不逃逸。
- **R2 A2 补 + R3 N1 修订**：早到监听回调与认证 timer 回调的拒绝路径**全部同步执行且零抛出**——
  置 `authRejected` + close 即时生效；**摘监听永不在重放/赋值未完成的窗口内执行**（no-op 句柄
  初始化 + 注册后同步收口段，§3.2 门 3 / §3.3 不变量 6）——同步重放型 transport 上
  `transport.onMessage(...)` 调用点零同步抛出，accept promise 在一切 transport 形态下
  **恒 resolve**（含 undefined）；零新 promise 链、零 floating promise。验证器无论多迟 settle，
  其 promise 恒被 `await` 消化（门 4），迟归不产生孤儿 rejection。

### 8.3 并发与竞态清单

| 竞态 | 处置 |
|---|---|
| 认证 await 期间 hub.close() | 门 5 复查 `this.closed` → undefined + 1001（§3.2） |
| 认证 await 期间对端断线 | `earlyClosed \|\| transport.closed` → undefined 零分配（close 已由对端发生，不再二次 close） |
| HELLO 早到（认证中） | earlyFrames 缓冲 + 构造尾重放（§3.1/3.3） |
| 早到帧含非 HELLO 帧 | 重放走 `onMessage` handshaking 门 → `HELLO_REQUIRED` fatal——协议纪律不因缓冲而放宽 |
| revoke × 在途 startOpen | opening 终态化 → 既有 §13.4 迟到纪律（§5.2） |
| revoke × 连接收口竞态 | 拷贝迭代 + quiet 守卫 → no-op（§5.1/5.2） |
| 双 GOAWAY / GOAWAY 后残帧 | draining 入站门整体忽略（§6.2）——幂等 |
| deadline 前对端先关（1001/1000） | `onClose(draining)` → `onGoawayClosed`：hint 从**实际 close 时刻**起算（§15.1「关闭后」字面）；无 hint → 普通 backoff |
| stop() 期间 drain close | `stopping` 守卫在 onClose 首行拦截（既有） |
| drain 期 removeTarget（R1 新列） | `CLOSE_NAMESPACE` 被出站 ready 门抑制（零 wire）→ close timer（closeTimeoutMs）到点本地 finalize closed；或 deadline close 先到 → `onConnectionLost`（closing→disconnected）；`intent='removed'` 使重连后 `openActiveTargets` 跳过——无悬挂重开。有界、无泄漏 |
| drain 期恢复触发（R1 新列；两路径精确区分） | **入站触发**（对端 RESYNC_REQUIRED）：`onMessage` 状态门（`:234`，解码前）直接丢弃——控制器零扰动；**本地触发**（ACK_TIMEOUT timer）：本地 timer 照常 fire → `needs-resync→reconciling` 并 arm reconcile timer，但 Step1 经 `sendControl` ready 门**零上 wire**（§6.1 落实点 3 源码链）；deadline close 的 round teardown 归零，reconcile timer 同被 `clearAllTimers`/teardown 清除——无跨连接悬挂 round |
| draining 期 1002/1008 close（R2 A1 新列） | close 事件机器语义由 code 携带，与前因无关——hub 侧 `connectionFatal`（`hub-connection.ts:365-382`，drain 期仍可发生）或中间盒强断 → `clearDrainClose() + enterBlocked()`（永久失败阻断；§6.3 分支）——对持续 1002/1008 拒绝的对端**零重连**（协议 §15.1 L439/AC-5） |
| 认证期早到帧超界 / 认证超时（R2 A2 新列；R3 N1 措辞同步） | 帧到达同步段即拒（单帧 > maxFrameBytes → 1009；第 17 帧 → 1008）：**置 `authRejected` + close 即时生效**，摘监听在注册完成后同步收口段执行（§3.2 门 3）——后续灌帧被 listener 幂等早退（已拒标志）+ 已关 transport 双重吸收，零累积；认证 timer 超时同型（1008）。**验证器迟归不复活**：settle 后首检 `authRejected` → 一律 undefined（§3.2 门 4），迟归的 `{ok:true}` 不触发分配——「invalid credentials never allocate」的资源面闭合 |
| 同步重放型 transport 注册期拒绝（R3 N1 新列） | TcpTransport 形态（注册即同步重放积压）：重放期内超界帧触发拒绝 → listener 只置标志 + close（no-op 句柄使 `detachEarly` 无害），注册完成后同步收口段摘真句柄 + return undefined——`onMessage(...)` 调用点零同步抛出、accept 恒 resolve（§3.3 不变量 6）；重放循环零流产（pendingFrames 余帧不丢）。fake wire 无此形态 → 冻结套件不覆盖，回归锚 A2-e（§6.5）以本地同步重放 fixture 拦截伪绿 |
| 认证期 transport 早断 + 验证器迟归（R2 新列） | `earlyClosed/transport.closed` → undefined 零分配（close 已由对端发生，不二次 close）；auth timer 已清（门 4 首动作）——零悬挂 timer、零 unhandledRejection（验证器 promise 被 await 消化）。**验证器永不 settle 的极限形态**：预算/超时拒绝已发生（transport 关、零分配、timer 已消费、缓冲有界），accept 的 await 继续悬挂直至 verifier settle（宿主自有 promise；全部现行 caller 为 fire-and-forget——无观测面、无 unhandledRejection、无无界资源）。否决 `Promise.race` 提前出路的理由：输掉 race 的 verifier promise 其后继 rejection 需额外 catch 管线，可观测效果等价而复杂度上升 |

### 8.4 AC-7 脱敏对照

| 泄漏面 | 设计保证 |
|---|---|
| token 上 wire | token 只存在于 `HubUpgradeRequest` 内存对象；GOAWAY/ERROR/HELLO_ACK 编码路径均不含 token——红灯 #1 `tokenLeaksOnWire` 全字节扫描结构性通过 |
| ERROR safeMessage | 恒 `protocol error: <CODE>`（`frame-io.ts:30-32` 静态表，零拼接）——红灯 #6 断言 |
| 拒绝路径 close reason | 静态常量 `'upgrade-unauthorized'` / `'hub-shutdown'`，不区分无效/缺失/抛错（不给探测方分类信息） |
| 日志/指标 | 本包零 console/零新增观测面（observer seam 属**切片 8**——R1 勘误，SA8 注记 N4；「auth/authz failure」最小观测事件由切片 8 落地时回补并登记其验收）；`connectionId`（HELLO_ACK 既有）不受本设计影响 |

---

## §9 允许的暂停降级 vs 响亮失败（立法对照）

| 条件 | 分类 | 处置 |
|---|---|---|
| 验证器抛错 / 返回 ok:false | 异常路径（外部认证后端事实） | 拒绝 upgrade（1008 + 静态 reason）——合理的 fail-closed |
| 验证器返回文法违例 instanceId | 异常路径（信任边界数据不可信） | 拒绝 upgrade（红灯 #4 锚） |
| `verifyToken` 选项缺失 | **正常路径缺陷**（类型必填 + 构造期 `TypeError` 响亮失败，§2.3）——运行期残留检查仅为纵深防御（fail-closed 拒绝，绝不容忍无认证接纳） | 响亮失败优先 |
| `ok:true` 但 instanceId 畸形/缺失 | 异常路径（verifier 契约违反 @ 信任边界） | 拒绝 upgrade（§3.2 注记） |
| 未认证方早到帧超界 / 认证等待超时（R2 A2 新） | 异常路径（信任边界最外侧的资源滥用——异常域输入） | 拒绝 upgrade（单帧界 1009 / 条数界·超时 1008 + 静态 reason，帧到达同步段即拒；§3.2 门 3）——fail-closed，非降级（显式关闭 + 有界资源账 §3.2） |

---

## §10 AC 对照与红灯映射

| AC | 设计面 | 红灯 IT |
|---|---|---|
| AC-1 认证先于分配 | §3（门 0-5 + 零分配不变量 + R2 有界缓冲/封顶） | #1 #2 #3 #4 #5 + §6.5 A2-d（预算/超时锚） |
| AC-2 HELLO 绑定认证身份 | §4 | #1（HELLO_ACK/nonce）#6 |
| AC-3 错误域/关闭码映射 | §4/§5 复用既有 registry 映射（1008/namespace-scope）零新码 | #6 #7 |
| AC-4 授权 Adapter + revoke 只关 scope | §5 | #1（授权通过面）#7 #8 |
| AC-5 GOAWAY/backoff/blocked 注入 seam | §6（R1：无条件 draining + hint 只管重连调度；R2 A1：draining 期 1002/1008 → blocked 分类；公式复用注入 random/timer） | #9 + §6.5 A2-a（无 hint draining）+ A2-c（close-code 分类） |
| AC-6 GOAWAY 停 OPEN/drain/停机序 | §6 + §7（R1：停 OPEN+停 round 无差别状态门） | #9 #10 + §6.5 A2-b（停 round 新锚） |
| AC-7 脱敏 | §8.4 | #1 #6 |

实现后全量回归预期（R3）：`ws-replication-auth-lifecycle-red.test.ts` 15/15 转绿（R0 的 10 IT +
§6.5 A2-a/A2-b（R1 裁决面）+ A2-c/A2-d（SA2 A1/A2 必修面）+ A2-e（SA2 R2 复审 N1 必修面））；
既有 17 文件 106 用例中，G1 因 L189 改锚（§6.5-A1，SA6 执行）后全绿，其余逐点对账保持绿
（§6.4 + §11 的 4 处直建 hub 补 `verifyToken` + api.test-d 签名同步）；typecheck 归零（简报所列
14 处新契约面错误由 §2 落型消解，api.test-d 更新消除签名锁冲突）。

---

## §11. 文件清单（File Scope）

### ALLOW LIST

| 文件 | 类型 | 理由（章节 × 估行） |
|---|---|---|
| `packages/ws-replication/src/types.ts` | 修改 | §2：+`HubUpgradeRequest`/`PeerTokenVerifier`、`verifyToken` 必填、`accept`/`revoke` 契约（≈ 20 行） |
| `packages/ws-replication/src/hub-connection.ts` | 修改 | §3/§4/§5/§7：accept 认证管线与早到帧缓冲、onHello 绑定、revoke 链、close GOAWAY 先行（≈ 120 行净增） |
| `packages/ws-replication/src/hub-namespace.ts` | 修改 | §5：+`terminateUnauthorized()` 公共方法 + `cleanupTail` 结算记账（≈ 25 行） |
| `packages/ws-replication/src/peer-connection.ts` | 修改 | §6：onGoaway 分类/drain 句柄/onClose draining 分支/onGoawayClosed/停 OPEN 门/dialNow 复位（≈ 70 行净增） |
| `packages/ws-replication/src/validate.ts` | 修改 | §2.3：verifyToken callable 校验 + `isValidInstanceId` 导出（≈ 12 行） |
| `packages/ws-replication/src/index.ts` | 修改 | §2.4：新类型导出（≈ 2 行） |
| `packages/ws-replication/test/ws-replication-auth-lifecycle-red.test.ts` | `[SA6 owned]` | 验收红灯契约本体。追加义务（R1+R2+R3，§6.5-A2 共 5 个新 IT）：A2-a 无 hint draining 面、A2-b drain 期停新 sync round（R1 裁决面）；A2-c draining 期 close-code 分类、A2-d 认证期早到帧预算（SA2 A1/A2 必修面）；A2-e 同步重放型 transport 注册期拒绝（SA2 R2 复审 N1 必修面）——实现前红灯、实现后转绿；既有 10 IT 断言零改动；SA3 **不得改动断言**，仅允许测试基础设施级修复（hook/隔离；A2-e 的同步重放 fixture 属 seam 层新增，允许） |
| `packages/ws-replication/test/ws-replication-sa7-dynamic.test.ts` | `[SA6 owned]`（**R1 解除原 DENY**） | §6.5-A1：G1 L189 改锚（`'ready'`→`'draining'`）+ L188 注释同步——**总控 R1 裁决（SA8 CP-1）授权的 legacy 锚更新**，改动恰 2 行（断言值 + 注释），L190-215 零触碰；SA3 不得动此文件 |
| `packages/ws-replication/test/driver.ts` | `[SA6 owned]` | 已携带完整契约镜像（verifyToken/TEST_TOKEN/boot 选项）；SA3 预期零改动。**唯一例外（R2 A6 登记）**：实现期发现镜像与正式类型有字段级偏差时，允许 SA3 按冻结契约回改镜像的**纯类型层**（`HubUpgradeRequest`/`PeerTokenVerifier` 字段对齐；零运行时逻辑、零断言）——该例外已登记进 §13 审计表（白名单路径 + 触发条件），SA4 比对 ALLOW↔diff 时按 §13 行放行 |
| `packages/ws-replication/test/ws-replication-api.test-d.ts` | 修改 | §2.2 签名锁同步：`accept` 双参/`Promise<HubConnection \| undefined>`、`revoke`、`verifyToken`（vitest typecheck include 该文件——`vitest.config.ts` typecheck.include；**不改即类型红灯**）。仅类型断言块更新，零运行时逻辑 |
| `packages/ws-replication/test/issue137-driver.ts` | 修改 | §0.2：直建 hub 补 `verifyToken: DEFAULT_PEER_VERIFIER`（1 行 + import；peer 声明 PEER_INSTANCE、accept 传 TEST_TOKEN → 身份绑定成立，保持绿） |
| `packages/ws-replication/test/ws-replication-spec-b1-b2-red.test.ts` | 修改 | 同上（1 行 + import） |
| `packages/ws-replication/test/ws-replication-sa7-issue137-dynamic.test.ts` | 修改 | 同上（1 行 + import） |
| `packages/ws-replication/test/ws-replication-sa7-r2-transport.test.ts` | 修改 | 同上（1 行 + import；真实 TCP 文件，afterAll `hub.close()` 走 §7 新序但 settleClose 3s race 照常结算） |

> 4 处直建 hub 补丁的正当性：SA6 简报「Fixture/测试基础设施变更」节声明这些文件「实现后走默认
> 验证器保持绿」，但其构造面未被 SA6 触达（git grep 证实零 `verifyToken`）；`verifyToken` 为
> 必填契约（冻结表 AC-1 行），类型 + 构造期校验双面生效后这 4 处必然红——补 `DEFAULT_PEER_VERIFIER`
> 是兑现简报预言的最小改（每文件 1 行，无断言触碰）。

### DENY LIST

- `packages/replication-protocol/**` — codec/错误注册表已冻结（append-only），本任务零新码零改动
- `packages/namespace-registry/**` — Registry/Lease/session 契约不动（revoke 只经既有 `finalize`/收口链）
- `packages/ws-replication/src/defaults.ts` — 不新增配置 knob（§7.1 closeTimeoutMs 复用论证）
- `packages/ws-replication/src/{peer-namespace,round-engine,update-channel,backpressure,fence-watchdog,frame-io,error-mapping,lifecycle-queue}.ts` — namespace 状态机/round/背压/编码域不在本切片（peer-namespace 零改动：revoke 的 peer 侧终局由既有 `onErrorFrame` 路径承载）
- `packages/ws-replication/src/testing.ts` — 内存双端 transport 不动
- `packages/ws-replication/test/harness.ts` — SA6 冻结基建，不动
- `packages/ws-replication/test/ws-replication-ac*.test.ts`、`ws-replication-issue137-*.test.ts`、`ws-replication-sa4-*.test.ts`、`ws-replication-spec-*.test.ts`（除上表 b1-b2 单文件）、`ws-replication-sa7-r2-supplement.test.ts` — 既有绿灯锚，本任务不动（`ws-replication-sa7-dynamic.test.ts` 原列于此，R1 经总控裁决授权移入 ALLOW，见上表）
- `apps/**`、`domains/**`、`docs/**`、`wiki/**`（除本设计档案） — 无关域

---

## §12. 协议假设依据 (Protocol Assumption Evidence)

| # | 假设 | 依据类型 | 依据内容（具体引用） | 风险 |
|---|---|---|---|---|
| A1 | GOAWAY wire 字段为 `reasonCode:string / drainTimeoutMs:uint / retryAfterMs?:uint`（可选 marker 0\|1 编码） | 源码引用 | `replication-protocol/src/messages.ts:122-125`（类型）+ `payloads.ts:215-242`（codec：`retryAfterMs` 缺省不编码，解码出 `undefined`）——注入端 `encodeMessage` 与接收端 `decodeInbound` 同一 codec | 低 |
| A2 | fake wire「一 send 一投递」微任务 FIFO；close 只通知对端、不自通知；listener 集合 fire 时快照 | 现有测试引用 + 源码引用 | `test/harness.ts:540-568`（makeEnd）+ G1 时序注记 `sa7-dynamic.test.ts:44-46,196-198` + D5 同款 `:560-562`——close 事件须由测试 `closePeerSide` 交付本地；**§3.1/§3.3/§6.3/§7.2 的全部时序推演以此为基准** | 低 |
| A3 | 真实 TCP 上 listener 晚于数据到达是既存形态，需积压重放 | 现有测试引用 | `sa7-r2-transport.test.ts:132-144`（TcpTransport.onMessage 注册时重放 pendingFrames）——早到帧缓冲设计与该先例同构，且二者叠加无双重投递（pendingFrames 在首注册时排空） | 低 |
| A4 | fake scheduler `advanceBy(ms)` 使 ≤now+ms 的 timer 按序 fire，且期间新 timer 不提前 | 现有测试引用 | G1 `sa7-dynamic.test.ts:193-209`（advanceMs(60) 触 deadline close、advanceMs(25) 触 backoff 重拨）与 D5 `:546-556`（advanceBy(1) 触 drain、advanceBy(60_000) 验 stale 零副作用）已用同一时序面——红灯 #9 的 t=1000/5000/7500 轴沿用 | 低 |
| A5 | `ERROR` 帧 `namespaceErrorFrame(code, namespaceId)` 携带 namespaceId 且 scope/fatal/retryable/terminal 由注册表导出不可覆盖 | 源码引用 | `ws-replication/src/frame-io.ts:45-57` + `replication-protocol/src/errors.ts:115,150-155`（own-key 查表）——红灯 #7 的 `namespaceId === ns2` 断言依据 | 低 |
| A6 | `INSTANCE_IDENTITY_MISMATCH` = connection/config/1008；`NAMESPACE_UNAUTHORIZED` = namespace/config/failed | 源码引用 | `errors.ts:105,115`（注册表冻结值）——§4 关闭码与 §5 终态映射零自造 | 低 |
| A7 | 微任务序：`await verifyToken` 与 HELLO 投递的相对次序不定（验证器 ≥2 tick 时 HELLO 先达） | 设计期推演 + 源码引用 | `harness.ts:545`（queueMicrotask 快照）× async 函数 await 链 ≥2 tick；红灯 #6 验证器为 `async () => ({ok:true,...})`——§3.1 已把该竞态从「假设不出错」升级为「结构性缓冲消除」 | 中（已消解） |
| A8 | 红灯 #10 的 `await closePromise` 在零时间推进下结算 ⇒ hub.close 不得等 drain deadline | 现有测试引用 | 红灯 `:318-328`（无 advanceMs 即 await）+ A4（fake timer 不自前进）——§7「GOAWAY 后立即 1001」的直接依据 | 低 |
| A9 | R1 裁决：drain 类 GOAWAY 从 ready 无条件 draining；一切 drain 路径无差别停新 OPEN/round；blocked 类（SHUTTING_DOWN/REAUTH）作用域外保持直达 | 决策依据（非源码推断） | SA8 `…_design_conflict_report.md` CP-1/CP-2（evolution 上报处置选项 1）+ 总控裁决原文（2026-08-29，转录于 §6.1）+ 协议 §15.1 L411 状态机字面与 §15.1 GOAWAY 原因分级表（blocked 类依据）——设计仲裁来源 | 低 |
| A10 | R2 A1：draining 期 close 事件按 code 分类（1002/1008 → blocked；其余 → onGoawayClosed）——close 机器语义由 code 携带，与进入 draining 前因无关 | 协议原文引用 + 源码引用 | 协议 §14「稳定机器语义由 ERROR code 定义，WS close code 只做粗分类」+ §15.1 L439「1002/1008：blocked」/L440「1011：继续 backoff」；hub 侧 `connectionFatal` 随时可 1002/1008 关闭（`hub-connection.ts:365-382`）；既有非 draining 分类先例（`peer-connection.ts:495-500`）——draining 分支与之同构 | 低 |
| A11 | R2 A2：早到帧单帧界复用 `limits.maxFrameBytes`（超界 → 1009）；条数界为模块常数 16（超界 → 1008）；认证等待封顶复用 `timeouts.helloTimeoutMs` | 源码引用 + 协议原文引用 | `maxFrameBytes` 为 ADR 0010 L165「最大 WS frame」既有插件配置（`defaults.ts:17`，decode 点同款生效 `frame-io.ts:63-68`）；§14 1009=「外层 frame 超限」/1008=policy；`helloTimeoutMs` 为既有握手预算（`defaults.ts:32`；R3 N5 行号校正 :19/:33 → :17/:32）；`DuplexTransport` 契约零超时面（`types.ts:48-54`）→ 封顶必须留在包内（§3.2 政策声明） | 低 |
| A12 | R3 N1：同步重放型 transport（`onMessage` 注册即同步重放积压、重放先于 return）为实存形态——早到监听可在 off 句柄赋值完成前被调用 | 现有测试引用（源码） | `sa7-r2-transport.test.ts:132-144`（TcpTransport.onMessage：push listener → `for (const bytes of replay) listener(bytes)` 先于 return 执行）；fake `makeEnd`/`src/testing.ts`（Set 型 + queueMicrotask）无此形态 → 冻结套件伪绿面由 §6.5 A2-e 拦截 | 低 |

无其他协议级假设：本设计不触 HTTP/端口/进程生命周期/第三方库行为。

---

## §13. 契约改动连锁审计 (Contract Change Caller Audit)

### 改动函数

| 函数 | 文件 | 改动前契约 | 改动后契约 |
|---|---|---|---|
| `HubReplication.accept` | `src/types.ts:90-94`（实现在 `hub-connection.ts:76`） | `(transport: DuplexTransport) => HubConnection`（同步，必非 undefined） | `(transport, request?) => Promise<HubConnection \| undefined>`（undefined = upgrade 拒绝/已停机；**永不 reject**） |
| `HubReplicationOptions` | `src/types.ts:81-88` | 无 `verifyToken` | 新增必填 `verifyToken: PeerTokenVerifier`（构造期 TypeError，`validate.ts`） |
| `HubReplication.revoke` | — | 不存在 | 新增 `(instanceIdentity, namespaceId) => Promise<void>`（未知 scope → resolve 零副作用） |

注：`close()` 签名不变（行为增 GOAWAY-first，属行为面非契约面，其 caller 无类型影响）；
`HubConnection` 公共面不变。

### Caller 清单（`git grep -n "\.accept(\|createHubReplication\|hub.close()" -- packages/ws-replication` 全量）

| Caller | 文件:行 | 是否 await | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---|---|---|---|---|
| driver boot dial 闭包 | `test/driver.ts:473` | ❌ fire-and-forget | N/A | N/A（accept 永不 reject） | 零改动：resolve 值不被消费；认证异步化由早到帧缓冲兜住 HELLO 竞态 |
| driver bootFanout dial | `test/driver.ts:631` | ❌ 同上 | N/A | N/A | 同上 |
| issue137-driver dial | `test/issue137-driver.ts:139` | ❌ 同上 | N/A | N/A | 同上 + §11 补 `verifyToken` |
| spec-b1-b2 dial | `test/ws-replication-spec-b1-b2-red.test.ts:193` | ❌ 同上 | N/A | N/A | 同上 + §11 补 `verifyToken` |
| sa7-issue137 dial | `test/ws-replication-sa7-issue137-dynamic.test.ts:713` | ❌ 同上 | N/A | N/A | 同上 + §11 补 `verifyToken` |
| sa7-r2-transport server 回调 | `test/ws-replication-sa7-r2-transport.test.ts:240` | ❌ 同上 | N/A | N/A | 同上 + §11 补 `verifyToken`；真实 TCP 早到帧由 A3 双保险 |
| 红灯契约 6 处直调 | `test/ws-replication-auth-lifecycle-red.test.ts:142,169,173,183,198,332` | ✅ await | N/A（断言 undefined 本体） | N/A | 契约消费者本体，零改动 |
| 类型锁 | `test/ws-replication-api.test-d.ts:47-60` | —（类型层） | — | — | **必须同步更新**（§11 ALLOW），否则 vitest typecheck 红 |
| hub 构造 ×6 | `driver.ts:457,614`（已传 ✓）、`issue137-driver.ts:104`、`spec-b1-b2:179`、`sa7-issue137:687`、`sa7-r2-transport:223`（未传） | — | 构造期 TypeError 直抛（测试框架捕获） | — | 4 处未传者补 `DEFAULT_PEER_VERIFIER`（§11）——TypeError 若不补会击穿整文件 |
| `hub.close()` ×2 | `sa7-r2-transport.test.ts:362`（settleClose 3s race）、红灯 `:320`（裸 await） | ✅ | race 兜底 / 断言本体 | — | close 仍 resolve（§7 不等 deadline），两 caller 零改动 |

### 风险评估

- **accept 变异步的最大风险**＝调用方把返回值当同步 `HubConnection` 用（undefined 未检）或
  floating-promise 场景的 rejection 逃逸。审计结论：全部 6 处运行时 caller 均 fire-and-forget
  且不消费返回值；唯一消费方是红灯契约（await + undefined 断言）。设计侧以「accept 永不
  reject」不变量（§8.2）封死 unhandledRejection 面。
- **verifyToken 必填的最大风险**＝构造期 TypeError 击穿未更新的构造点 → 已由 §11 的 4 文件
  1 行补丁封死（SA4 比对锚：ALLOW LIST ↔ `git diff --name-only`）。
- 生产侧 caller：`@nomicore/ws-replication` 当前无包外消费方（package `private: true`、
  `apps/` 无引用——phase-5 切片 9 才建 composition root），无隐藏 caller 面。
- **R1 修订声明**：R1（CP-1/CP-2 裁决落实）**不改任何公共契约**——`accept`/`verifyToken`/`revoke`
  签名与 R0 一致；改动仅为 peer 侧内部行为（onGoaway/onClose/onGoawayClosed）与测试锚
  （§6.5）。本审计表零增删。
- **R2 修订声明**：R2（SA2 A1–A6）同样**不改任何公共契约**——A1 改 `onClose` 内部分支、A2 在
  `accept` 内部加有界缓冲/封顶（`MAX_EARLY_FRAMES` 为模块常数，非导出配置）、A4/A5 为内部
  顺序/记账统一。运行时 caller 面与类型面零变化。**唯一例外登记（A6）**：

  | 例外路径 | 触发条件 | 允许动作 | 禁止动作 |
  |---|---|---|---|
  | `packages/ws-replication/test/driver.ts` | 实现期发现契约镜像（`HubUpgradeRequest`/`PeerTokenVerifier`）与 §2 正式类型有字段级偏差 | SA3 按冻结契约回改镜像**纯类型声明**（import type 对齐/字段名与可选性），保持与 `types.ts` 逐字段一致 | 零运行时逻辑改动、零断言改动、零新测试行为——越出类型层即 scope-creep，SA4 按本表 reject |

---

## §14. SA2 反馈逐条回应

> R1 修订系 **SA8 冲突门禁 + 总控裁决**驱动（非 SA2 reject）；按下表逐条落实并留痕。SA2 破壁
> 反馈到达后在本表续行追加，只增不删。

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|---|---|---|---|
| **CP-1**（SA8 evolution/高 + 总控裁决）：协议 §15.1 `ready --GOAWAY--> draining` 字面无条件——R0 的 hint 键控收窄了 wire contract 状态机语义 | ✅ | §6.1（裁决记录）/§6.2（伪代码）/§6.3/§6.4/§6.5 | drain 类 GOAWAY 从 ready 一律 `setState('draining')`（与 retryAfterMs 无关）；hint 只保留在 §6.3 deadline close 后的重连调度；R0 的 `goawayReceived` 标志与 hint 键控伪代码**整体删除**（非注释性承认——§6.2 代码块实质替换）；blocked 类（SHUTTING_DOWN/REAUTH）作用域边界显式声明并锚 G2/B1 |
| **CP-2**（SA8 evolution/中 + 总控裁决）：§6.3「不开始新 sync round」在无 hint 路径缺结构性门 | ✅ | §6.1 落实点 3 / §6.2 出站纪律 / §8.3 新行 / §6.5-A2-b | 无条件 draining 后出站 ready 门（peer-connection.ts:426/:438）覆盖**全部** drain 路径（drain 类=draining 门、blocked 类=blocked 门+teardown）；round 触发链源码核实（onResyncReceived→maybeStartRecovery→startRound→host.send）写入设计；新增红灯锚 A2-b（drain 期注入 RESYNC_REQUIRED → 断言 SYNC_STEP1 零增长） |
| **总控指令**：identify/update needed SA6 acceptance and legacy-test anchors | ✅ | §6.5（清单）/§0.2/§6.4/§11 | A1：G1 L189 改锚（`ready`→`draining`，2 行）；A2：红灯契约新增 2 IT（无 hint draining 面 + 停 round 面）；A3：R0 已含的 api.test-d/4 处直建 hub 连带更新；ALLOW LIST 显式扩展（sa7-dynamic 解除 DENY，`[SA6 owned]`） |
| **SA8 N4 勘误**（非冲突）：observer seam 切片归属笔误（9→8） | ✅ | §8.4 | 「属切片 9」→「属切片 8」+ auth/authz failure 事件面回补登记 |
| **SA2 A1**（MEDIUM 必修）：draining 态吞掉 close-code 分类——1002/1008 永久失败被降格为临时失败（无限重连循环；协议 §15.1 L439/phase L148/AC-5 冲突） | ✅ | §6.3（onClose draining 分支重写）/§8.1（enterBlocked 单点 clearDrainClose）/§8.3（新竞态行）/§6.5 A2-c（新红灯锚） | draining 分支前置 code 分类：`1002/1008 → clearDrainClose()+enterBlocked()`（永久阻断 + drain timer 清理——总控 R2 指令字面落实）；其余 → `onGoawayClosed()`（1011 落 backoff 与 L440 一致，反向对照锚钉死）。与全部冻结锚兼容（G1/D5/红灯 #9/A2-a/b 均以 1001 关闭） |
| **SA2 A2**（MEDIUM 必修）：认证窗口早到帧缓冲无界 + 认证等待无时限——信任边界最外侧 DoS 面（ADR 0010 L165 失守） | ✅ | §3.2（门 3 重写：单帧 maxFrameBytes 界/条数 16 界/auth timer）/§3.2 政策声明/§3.2 资源账/§8.1（authHandle 行）/§8.2/§8.3/§9/§6.5 A2-d（新红灯锚） | **零新 knob**：单帧复用 `limits.maxFrameBytes`（超界→1009）+ 模块常数 `MAX_EARLY_FRAMES=16`（超界→1008，帧到达同步段即拒）；认证等待封顶**显式二选一落文**：复用 `helloTimeoutMs` 起包内 timer（超时→1008）——否决「transport/宿主层负责」方案的理由成文（DuplexTransport 契约零超时面 types.ts:48-54，沉默添加隐式义务）；`authRejected` 迟归不复活；资源账上界 16×maxFrameBytes + helloTimeoutMs |
| **SA2 A3**（LOW）：draining 双向冻结 vs §6.3 L147「自然收口」未对账；NR-1 空转面 | ✅ | §6.2「自然收口 vs 重连 reconcile 取舍声明」 | 走 SA2 建议路线 (a)：显式声明「自然收口在接收侧被有意替换为重连 reconcile」+ 三条理由（协议显式义务仅停「新」、§12 L313/§16 修复先例、白名单路线跨层耦合且与 A2-b 变体二锚冲突）+ NR-1 空转面登记 + 呈报总控将取舍登记进 relevant_decisions「设计引入的新决策点」（SA8 维护文档，SA1 不代笔） |
| **SA2 A4**（LOW）：§3.2/§3.3 摘监听/构造顺序互相矛盾 | ✅ | §3.2 门 5（唯一基准）/§3.3（重写） | 统一为「先摘早到监听 → 构造（内挂监听）→ 构造尾重放」；§3.3 不变量 1-3 保留 + 新增第 4 条：对单槽替换型 transport 的稳健性论证（R1 的「构造→摘」形态在该语义下会摘错监听，废弃） |
| **SA2 A5**（LOW）：cleanupTail 单字段覆写弱于「revoke resolve 即资源已收口」声称 | ✅ | §5.3（重写） | 改**链式追加**：`settleClose()` 单点（`this.cleanupTail = this.cleanupTail.then(() => op, () => op)`），finalize/terminateUnauthorized/onConnectionClosed 三方清理汇入同一链无覆写丢尾；强度声明恢复（revoke resolve ⟺ 全部已发起清理 settle） |
| **SA2 A6**（LOW）：driver.ts 镜像修正例外无登记——SA4 比对会误判越权 | ✅ | §13（例外登记表：路径+触发条件+允许/禁止动作）/§11（driver.ts 条目引用 §13） | 例外以白名单表形式登记进 §13 审计表（纯类型层、触发条件=字段级偏差、禁止动作=越出类型层即 scope-creep reject）——SA4 比对依据补全 |
| **SA2 R2 复审 N1**（MEDIUM 必修，R2 修订引入）：`detachEarly()` 闭包在 off 句柄赋值完成前可被同步重放型 transport（TcpTransport 实存形态）调用 → TypeError 自 `transport.onMessage(...)` 调用点同步抛出 → **accept promise reject**——违反 §8.2「accept 永不 reject」硬不变量；崩溃窗口恰为 A2 防御的信任边界场景；异常展开流产重放循环（余帧丢失、transport 未按设计关闭）；fake wire 无此形态 → 冻结套件伪绿 | ✅ | §3.2 门 3（no-op 初始化 + listener 幂等早退 + 注册后同步收口段）/§3.3 不变量 6/§8.2（bullet 重写）/§8.3（两行措辞同步 + 新行）/§6.5 A2-e（新红灯锚）/§12 A12（依据行） | 采 SA2 建议①：`let offMessage: () => void = () => {}; let offClose: () => void = () => {};`——detachEarly 任意时刻安全；拒绝**效果**（置标志+close）重放期内照常生效，**摘监听**延至注册完成后同步收口段（真句柄 + return undefined）；auth timer 在收口段之后武装（早拒场景零清理面）；`onMessage(...)` 调用点零同步抛出、重放循环零流产。新锚 A2-e：本地同步重放 fixture（DuplexTransport 五成员，非 mock 被测对象）+ 预置超界积压 → `expect(p).resolves.toBeUndefined()` + probe 空 + transport 关闭（1009）+ 零分配 + 重放余帧零丢失断言；17 帧变体走条数界 |
| **SA2 R2 复审 N2**（LOW）：§8.1 括注「enterBlocked 含 onGoaway blocked 分支」与 §6.2（teardown+setState 直达、不经 enterBlocked）不符——空虚真 | ✅ | §8.1 drainCloseHandle 行 | 括注改注明：该分支处于 ready 态、drainCloseHandle 必为 undefined（armDrainClose 仅存在于 drain 类路径）——**空虚真安全、零行为差异**；显式不改路由：强改经 enterBlocked 其额外 clearReset 会使 B1 pending 计面 -2（SA2 已排除）——路由语义冻结，B1 不受扰动 |
| **SA2 R2 复审 N3**（LOW）：A2-d 超时变体 `advanceMs(helloTimeoutMs)` 推进的是 peer scheduler，auth timer 在 hub scheduler——误用则锚恒红 | ✅ | §6.5 A2-d 超时变体 | 锚文本改为「推进 hub scheduler（makeAuthHub 场景 `node.scheduler.advanceBy(helloTimeoutMs)`）」+ 误用成因注记（driver.ts:548-549 的 advanceMs 绑定 peerNode） |
| **SA2 R2 复审 N4**（LOW）：settleClose 存储的 tail 若因清理体抛错而 reject，`void this.settleClose()` 产生 floating rejected promise（probe 面） | ✅ | §5.3（伪代码尾部） | 存储前归一化：`this.cleanupTail = prev.then(() => op, () => op).then(() => undefined, () => undefined);`——terminationSettled 本就吞异常，归一化零语义损失；belt-and-braces |
| **SA2 R2 复审 N5**（LOW）：§12 A11 行号漂移（defaults.ts:19/:33 → 实际 :17/:32） | ✅ | §12 A11 | 行号校正 + 漂移事实注记（同一冻结块，可定位性无损） |
| （SA2 R3 复审反馈） | — | — | 待 R3 复审后续行 |

---

## 附：设计自检（一致性扫描记录；R3 后全量复扫）

- `verifyToken`：出现于 §2（类型）/§3（管线）/§8.4/§9/§11/§13——均为「必填 + fail-closed + 4 处补丁」同一表述，无矛盾。
- `draining` 转移：§6.1 裁决（R1 无条件——drain 类 GOAWAY 从 ready 一律 draining）与 §6.2 伪代码（drain 类无差别 `setState('draining')`，hint 只进 §6.3 重连调度）与 §6.4 G1 对账（L189 改锚后无 hint 面同样 draining）与 §6.5 A2-a 新锚四者同一表述；blocked 类作用域边界（SHUTTING_DOWN/REAUTH 直达）在 §6.1 落实点 2 / §6.2 分支 / §6.4 G2/B1 行 / §7 peer 对账一致。
- **draining 期 close 分类（R2 A1）**：§6.3 分支（1002/1008 → clearDrainClose+enterBlocked；其余 → onGoawayClosed）/ §8.1 enterBlocked 单点 / §8.3 竞态行 / §6.5 A2-c 锚 / §12 A10 依据五处同一分类；与非 draining 态分类（`:495-500` 既有）同构；1011 → onGoawayClosed → backoff 与 §15.1 L440 一致。
- `retryAfterMs + jitter`：§6.1 落实点 1（hint 只管重连调度）、§6.3 公式、§10 AC-5 行三处同式（`retryAfter + random()×cap`，random=0 → 恰 retryAfter；无 hint → 普通 backoff 出口，§6.4 G1/D5 行）。
- **早到帧（R2 A2/A4 + R3 N1）**：§3.1 竞态 → §3.2 门 3（有界缓冲 16×maxFrameBytes + auth timer 封顶 + **off 句柄 no-op 初始化/幂等早退/注册后收口段**）→ §3.3 唯一顺序基准（先摘→构造→重放，不变量 1-6，含同步重放句柄安全）→ §8.1 authHandle 行 → §8.2（零抛出修订版）→ §13 A6 例外，路径闭环；预算拒绝三态（1009 单帧 / 1008 条数 / 1008 超时）在 §3.2/§3.4/§9/§12 A11 一致；「迟归不复活」在 §3.2 门 4 / §8.3 两行一致；「accept 恒 resolve」在 §3.2 门 3 注记 / §3.3 不变量 6 / §8.2 / §8.3 新行 / A2-e 锚五处同表述。
- **cleanupTail（R2 A5）**：§5.3 链式追加单点 `settleClose()`，三发起方（finalize/terminateUnauthorized/onConnectionClosed）汇入同一链——与 §5.2 的 terminationSettled 引用一致，无旧「单字段覆写」残留。
- 拒绝语义六联（缺凭据/验证拒绝/抛错/文法违例/**帧超界/认证超时**）在 §3.2 门 1/3/4、§0.1、§9 表、§10 AC-1 行同为「undefined + 零分配 + 静态 close」，红灯 #2–#5 + A2-d 一一对应。
- 测试锚总数对账：红灯契约 15 IT（10 基线 + A2-a/b/c/d/e）在 §6.5（intro + 各锚）/§10/§11 三处一致；G1 改锚恰 2 行（§6.5-A1/§6.4）；D5 零改锚（§6.4）；api.test-d + 4 处直建 hub（§11/§13）。
- **R3 N 系联防**：N1（§3.2/§3.3/§8.2/§8.3/A2-e/A12）/N2（§8.1 空虚真 + 路由冻结）/N3（A2-d hub scheduler）/N4（§5.3 归一化）/N5（§12 A11 行号）五处各自成文且互不引用冲突；N2 的「不改路由」与 §6.2 blocked 分支伪代码（teardown+setState 直达）一致——enterBlocked 不被引入该分支。
