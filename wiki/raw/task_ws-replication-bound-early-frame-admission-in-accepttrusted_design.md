# SA1 设计 — issue #190：ws-replication `acceptTrusted` 早到帧有界 admission 收敛

- **任务**：bugfix（Issue #190，PR #130 合并后 review 发现）
- **Worktree**：`/home/wangjian/nomicore-fix-issue-190`（HEAD `b66615c`）
- **缺陷文件**：`packages/ws-replication/src/hub-connection.ts`
- **红灯契约**：`packages/ws-replication/test/ws-replication-issue190-red.test.ts`（SA6 已就位：3 红 IT + 1 绿保真锚）
- **权威输入**：任务简报 `task_ws-replication-bound-early-frame-admission-in-accepttrusted.md`、SA5 分析 `20260831-bug-ws-replication-bound-early-frame-admission-in-accepttrusted.md`、相关决议 `_relevant_decisions.md`（ADR-0010 唯一强相关）

| 版本 | 日期 | 触发 | 变更摘要 |
|---|---|---|---|
| R1 | 2026-08-31 | SA2 攻击评审 `_sa2_review.md`（verdict **reject——轻量修订**：核心机制 D1/D2/D3 经全维攻击零 CRITICAL/零高危；1 MAJOR + 2 MINOR，均为设计文档级，不动方案骨架） | ①（MAJOR #1）#172 双标注：§3.1 注释草稿补「权威指向 + 历史证据」并置行 + §10 落点增第 5 项施工义务（含 `MAX_EARLY_FRAMES` 现行 :41-46 单标注欠账修正）；②（MINOR #2）§3.4/E10 指定 RT-1 验证载体：§10.1 全规格 + §11 ALLOW LIST 增补新测试文件 `ws-replication-issue190-guard.test.ts`（SA2 指定载体）+ §8.2 锚表/§10 验证命令/§13 caller 清单联动；③（MINOR #3）§3.3 I6 措辞收敛至「契约内帧载荷（Uint8Array）」限定——显式登记 `bytes.byteLength` 契约外载荷暴露与现行 accept() 门 3 :157 同面非新增、不加 typeof 守卫（SA2 裁定：加守卫破坏逐语句等价论证），RT-2 按 SA2 明示免做 |

---

## §0 摘要与结论

**根因**：`acceptTrusted()`（hub-connection.ts:241-290）的早到帧监听器（**:259-261**）对每帧无条件
`earlyFrames.push(bytes)`——`accept()` 门 3（:140-188）在 phase5（issue #138，PR #130）经 SA2 R2 A2 +
R3 N1 两轮立法形成的「有界早到帧 admission」三重纪律（幂等拒绝标志 / `limits.maxFrameBytes` 单帧界 /
`MAX_EARLY_FRAMES=16` 条数界）**只落在了 token 验证路径**；两入口 admission 逻辑独立实现，
trusted 路径成为无界保留 + 错档拒绝语义（分配 `HubConnectionImpl` 后死于构造尾重放 `decodeInbound`
的 1002/'protocol-error' + `connection-failed` 事件，而非文档化帧限语义）。

**方案**：把 `accept()` 门 3 的 admission 提取为**模块私有共享单点**
`installEarlyFrameAdmission(transport, limits, emitFrameLimitRejected)`——两入口消费同一机制。
`accept()` 行为逐字节等价收敛（冻结锚不破坏）；`acceptTrusted()` 获得同款「保留前拒绝」：
单帧界 → `close(1009,'upgrade-frame-limit')` + observer `auth-upgrade-rejected/frame-too-large`；
条数界 → `close(1008,'upgrade-frame-limit')` + `early-frame-limit`；拒绝路径零 `HubConnectionImpl`
分配、恒 resolve `undefined`、拒绝标志使后续帧/回调不可复活。零公共 API 变化、零新 knob、零新错误码、
零协议文档变更（帧限语义已在 wire contract 文档化，见 §12 假设 1-3）。

---

## §1 根因推演（Bug）

### 1.1 最深层原因（非表象）

表象是「trusted 路径内存无界保留 + 拒绝语义错档」；最深层原因是**结构性**的：同一安全纪律
（信任边界最外侧的 admission 资源界）在两个 upgrade 入口**各自独立实现**，立法（R2 A2/R3 N1）
只约束了其中一个实现。SA5 根因结论原文：「两入口的 admission 逻辑是独立实现而非共享机制，
PR #130 只给 token 路径落了 R2 A2 立法」。**只要两入口继续独立实现，任何一侧的纪律演进都会
继续漏掉另一侧**——这是缺陷的产生机制，也是复发的风险面。因此本设计的第一约束是简报
Required outcome 第 1 条：「Use **one** bounded early-frame admission mechanism」——共享单点是
硬性要求，不是风格偏好。

### 1.2 缺陷后果链（逐帧推演，同步重放型 transport 形态）

以红灯 fixture `makeReplayTransport`（TcpTransport 实存形态：`onMessage(listener)` 注册即同步
重放全部积压、重放先于 return，`ws-replication-sa7-r2-transport.test.ts:130-140`）推演 `acceptTrusted` 现行为：

```
hub.acceptTrusted(transport, identity)
 ├─ :249/250 门 0/1 检查通过
 ├─ :259 transport.onMessage(listener) 注册
 │    └─ 重放循环开始：每帧 → listener → earlyFrames.push(bytes)   ← 无界保留发生点
 │       （无 authRejected 守卫 / 无 maxFrameBytes / 无 MAX_EARLY_FRAMES）
 ├─ :262 onClose 注册；:269-279 收口检查（无拒绝分支——标志根本不存在）
 ├─ :281 new HubConnectionImpl(..., earlyFrames)                    ← 违规分配
 │    └─ :428 构造内再注册 onMessage → fixture 再重放一次积压        ← replayedCount 翻倍
 │       └─ :434 构造尾重放 earlyFrames → onMessage → decodeInbound
 │          （frame-io.ts:60-68）→ 非协议字节先判 MALFORMED → 1002   ← 检查在保留+分配之后
 │          → connectionFatal('MALFORMED_FRAME', 1002) → close(1002,'protocol-error')
 │          → observer 走 connection-failed（非 auth-upgrade-rejected）
 └─ 异步 cleanupAll 回收连接（connectionCounter 已消耗、connectionList 已入列）
```

与 `accept()` 同输入对照（既有绿灯 A2-e，`ws-replication-auth-lifecycle-red.test.ts:655-678`）：
门 3 listener 在**帧到达同步段、push 之前**拒绝——置 `authRejected` + `close(1009|1008,
'upgrade-frame-limit')` + `auth-upgrade-rejected` 事件；注册后同步收口段 `return undefined`
零分配。两入口行为分裂即简报 Problem 所述。

### 1.3 为什么是「new-feature-defect」而非回归

SA5 git 考古：`hub-connection.ts` 诞生于 `b66615c`（PR #130），`acceptTrusted` 随功能首发即无界。
修复不是恢复旧行为，而是把既有立法**延伸覆盖**到第二个入口——这决定了方案的形态：以
`accept()` 已评审的机制为基准做收敛，而不是发明新机制。

---

## §2 设计约束与原则（决议对齐）

| # | 约束 | 来源 | 本设计的兑现 |
|---|---|---|---|
| C1 | 资源上限提供安全默认值；「最大 WS frame」为插件配置 | ADR-0010 §资源限制 | 单帧界复用 `limits.maxFrameBytes`（零新 knob，R2 A2 立法原文） |
| C2 | framing/认证等**连接级**错误关闭整条连接 | ADR-0010 §资源限制 | upgrade 期帧限 = 认证级错误 → 整 transport `close`（既有语义） |
| C3 | close code / 错误码 / 观察面语义以 `docs/protocols/instance-replication-v1.md` 为唯一 wire contract | ADR-0010 + #172 修订节 | 复用已文档化的 1008/1009 分类（:389-390）与 `auth-upgrade-rejected` reason 表（:636）；**零文档变更**（见 §12） |
| C4 | 结构化 observer seam，不给业务 update events | ADR-0010 | 拒绝只发既有 `auth-upgrade-rejected`，零新事件类型 |
| C5 | trusted Lease/transport 授予纪律：Host 负责只交给可信代码 | ADR-0010 §NamespaceLease | admission 界是**纵深防御**（接收侧兑现），不推翻 Host 授予责任 |
| C6 | 早期帧接纳层是 transport 接纳层的有界队列，与 Runtime fanout 队列分属两层 | 相关决议 §CONTEXT 术语 | 不触碰 Runtime/write sequencer/背压管线（§11 DENY） |
| C7 | `wiki/raw` 非规范 | ADR-0010 #172 修订节 | 本设计所有行为锚点引用源码/测试/协议文档，不引用 wiki 作规范 |
| C8 | 零新 knob：`MAX_EARLY_FRAMES` 为模块常数，非配置 | phase5 R2 A2 立法 | 常数不动（:46），仅注释扩展覆盖面 |
| C9 | 「accept 恒 resolve」（零 unhandled rejection） | phase5 §8.2/§8.3 + index.ts:375-382 注释 | 收敛后 `acceptTrusted` 继承同一不变量；机制内 close 加守卫（§3.4） |

**拒绝虚假降级立法对照**：越界早到帧是**异常路径**（信任边界最外侧的外部输入滥用），
处理方式是显式 fail-closed 拒绝（close + 稳定 reason + observer 事件）——与 phase5 设计
§12「未认证方早到帧超界」行的既有定性一致，无降级设计。

---

## §3 D1：共享有界早到帧 admission 机制（核心）

### 3.1 机制规格

模块私有（**不导出**，零公共 API 变化）单点工厂，落在 `hub-connection.ts`：

```ts
/**
 * issue #190：两 upgrade 入口（accept 门 3 / acceptTrusted 门 2）共享的有界早到帧
 * admission 单点。
 *
 * 权威指向（#172 双标注）：帧限拒绝对外语义（1009/1008 close-code 分类 +
 * auth-upgrade-rejected reason 闭集 frame-too-large/early-frame-limit）以
 * docs/protocols/instance-replication-v1.md 为唯一 wire contract（§14 close-code
 * 分类、§23 observer reason 表）。历史证据（立法沿革）：phase5 issue #138 设计
 * §3.2 R2 A2（早到帧有界化）+ R3 N1（同步重放型 transport 句柄安全）。
 *
 * 纪律（帧到达同步段、push 之前执行）：
 * - 幂等拒绝早退：拒绝后重放循环内后续帧直接 return（零保留零重放）；
 * - 单帧界：bytes.byteLength > limits.maxFrameBytes → 拒绝（§14 → 1009）；
 * - 条数界：frames.length >= MAX_EARLY_FRAMES（第 17 帧）→ 拒绝（policy → 1008）；
 * - 拒绝效果 = 置标志 + close(…, 'upgrade-frame-limit') + emit 帧限 reason（经注入回调）；
 * - 摘监听统一延后到注册完成后的同步收口段（R3 N1：no-op 句柄使 detach 任意时刻安全）。
 *
 * 资源账：保留上界 = MAX_EARLY_FRAMES × maxFrameBytes + 常数数组开销（§7）。
 */
interface EarlyFrameAdmission {
  /** 有界缓冲（≤16 帧，每帧 ≤ maxFrameBytes）——分配时随连接注入构造尾重放。 */
  readonly frames: Uint8Array[];
  /** admission 拒绝已发生（帧限或外部 markRejected）——迟归/后续帧不复活。 */
  isRejected(): boolean;
  /** 外部标记拒绝（accept() auth timer 超时路径专用；无副作用——close/emit 由调用方路径自理）。 */
  markRejected(): void;
  /** 接纳窗口内对端已断（onClose 观察）。 */
  isEarlyClosed(): boolean;
  /** 幂等摘除两监听（重放期内调用 = 无害 no-op，R3 N1）。 */
  detach(): void;
}

function installEarlyFrameAdmission(
  transport: DuplexTransport,
  limits: ResolvedLimits,
  emitFrameLimitRejected: (reason: 'frame-too-large' | 'early-frame-limit') => void,
): EarlyFrameAdmission
```

**#172 双标签示范（R1 修订，SA2 攻击点 #1）**：上方注释草稿的「权威指向 + 历史证据」
两段是 SA3 落源码时的**直接采用模板**——源码注释中的公共行为表述必须指向
`docs/protocols/`（权威），phase5 design 引用仅作立法沿革（`wiki/raw` 非规范，
ADR-0010 #172 修订节）。§10 第 5 项为对应施工义务条目。

### 3.2 实现伪代码（accept() 门 3 既有形状的原样收敛 + §3.4 守卫）

```ts
function installEarlyFrameAdmission(transport, limits, emitFrameLimitRejected): EarlyFrameAdmission {
  const frames: Uint8Array[] = [];
  const state = { rejected: false, earlyClosed: false };
  // R3 N1（一行级，原样保留）：off 句柄 no-op 初始化——同步重放型 transport
  // （TcpTransport 实存形态）上积压帧可在赋值语句完成前触发本 listener 的拒绝路径；
  // no-op 句柄使 detach 在【任意时刻】安全，注册完成后重赋真句柄。
  let offMessage: () => void = () => {};
  let offClose: () => void = () => {};
  const detach = (): void => { offMessage(); offClose(); }; // 幂等（重复摘除零副作用）
  offMessage = transport.onMessage((bytes) => {
    if (state.rejected) return;                          // 已拒（重放循环内后续帧）——幂等早退
    if (bytes.byteLength > limits.maxFrameBytes) {       // 单帧界：ADR-0010「最大 WS frame」；§14 → 1009
      state.rejected = true;
      closeAdmission(transport, 1009, 'upgrade-frame-limit'); // §3.4 守卫版 close
      emitFrameLimitRejected('frame-too-large');
      return;
    }
    if (frames.length >= MAX_EARLY_FRAMES) {             // 条数界：第 17 帧即拒（policy）→ 1008
      state.rejected = true;
      closeAdmission(transport, 1008, 'upgrade-frame-limit');
      emitFrameLimitRejected('early-frame-limit');
      return;
    }
    frames.push(bytes);                                  // 唯一保留点——三检全过才保留
  });
  offClose = transport.onClose(() => { state.earlyClosed = true; });
  return { frames, isRejected: () => state.rejected, markRejected: () => { state.rejected = true; },
           isEarlyClosed: () => state.earlyClosed, detach };
}

/** §3.4：admission 拒绝路径的守卫版 close——transport 契约外形态（close 抛出）不得
 *  流产重放循环 / reject 调用方 promise（见 §3.4 论证）。契约内 transport 行为零变化。 */
function closeAdmission(transport: DuplexTransport, code: number, reason: string): void {
  try {
    transport.close(code, reason);
  } catch {
    // transport 契约外形态（close 抛出）：拒绝效果已生效（标志已置、事件仍发）——
    // 残局归 transport 所有者；与 index.ts safeCloseTransport「吞二次异常」同款纪律。
  }
}
```

检查顺序与 accept() 门 3 现行实现（:156-171）**逐语句一致**：幂等早退 → 单帧界 → 条数界 → push。
`emitFrameLimitRejected` 由两入口注入 `(reason) => this.emitUpgradeRejected(reason)`——reason 子类型
（`'frame-too-large' | 'early-frame-limit'`）是 `emitUpgradeRejected` 既有 union（:98-106）的成员，
**零新码**；`dispatchReplicationObserver` 已隔离 observer throw（observer.ts:34-38），事件发射零抛出。

### 3.3 机制不变量（I1–I8）

| # | 不变量 | 依据 |
|---|---|---|
| I1 | **保留前拒绝**：三检（幂等/单帧/条数）全部先于 `push`——字节永不无界入内存 | 简报 Required outcome 2；A2-e 语义 |
| I2 | **拒绝一次定型**：拒绝后（含重放循环内后续帧、事后 pump 帧）listener 幂等早退，零二次 close、零二次事件、零保留 | 红灯 AC2/AC3 快照：`closeInfos` 恰 1 条、`rejectedReasons` 恰 1 条 |
| I3 | **零分配**：拒绝路径不构造 `HubConnectionImpl`——不消耗 `connectionCounter`、不入 `connectionList`、无异步 `cleanupAll` 回收面 | 简报 Required outcome 4；快照 `connections:0` |
| I4 | **不可复活**：收口段 `detach` 摘真句柄 → 后续帧无处投递；即使未摘（重放期内），I2 幂等早退双重吸收 | 简报 Required outcome 4；AC3 泵帧断言 |
| I5 | **同步重放安全**：no-op 句柄初值 + listener 零同步抛出 → `onMessage(...)` 调用点零异常展开、重放循环零流产（`replayedCount` = 积压条数） | R3 N1 立法；红灯快照 `replayedCount:1/17/64` |
| I6 | **恒 resolve（契约内帧载荷限定——R1 收敛，SA2 攻击点 #3）**：机制自身零 throw 路径**在契约内帧载荷（`Uint8Array`）下**成立——标志赋值/守卫 close/隔离 emit 均不可抛 → 两入口 promise 恒 settle 非 reject。**边界登记**：契约外载荷（listener 被 transport 以 `null`/`undefined` 帧直接调用）下，首检前的 `bytes.byteLength` 属性访问会 TypeError 经 `onMessage(...)` 调用点展开——该暴露**与现行 accept() 门 3（hub-connection.ts:157）同面，非本任务新增**（TS 类型 `Uint8Array` 已封死包内调用方；现行 `HubConnectionImpl.onMessage` → `decodeInbound` 在 trusted 路径同样会抛）。**不为该面加 typeof 守卫**——加守卫破坏「与 accept() 门 3 逐语句一致」的等价性论证（SA2 R1 裁定）。RT-2 契约外载荷基线测试按 SA2 明示免做 | phase5 §8.2/§8.3；index.ts:375 注释；红灯 probe 断言空；hub-connection.ts:157（同暴露面既有先例） |
| I7 | **单槽替换稳健**：`detach` 在早到监听仍在册时执行（先摘 → 后构造，§3.3 原序），未来单槽型 transport 不会摘错监听 | phase5 §3.3 不变量 4 |
| I8 | **单例单窗**：每 accept/acceptTrusted 一次安装、独立状态，无跨连接共享结构 | phase5 R2 A2 资源账（§7） |

### 3.4 唯一超越「原样收敛」的强化：拒绝路径 close 守卫（论证）

accept() 门 3 现行 listener 的 `transport.close(...)` **未**包 try/catch。本设计在共享机制内加守卫，
证据链：

1. **throw 现实性有代码库先例**：`apps/yjs-server/src/index.ts:364-368` `safeCloseTransport` 注释
   「工厂产物形状不可信，吞其二次异常」——生产代码明确按「transport.close 可能抛出」设防。
2. **不变量已立法**：phase5 §8.2「早到监听回调……拒绝路径全部同步执行且**零抛出**」——该声明
   覆盖我方代码，但重放窗口内 close 抛出会使异常从 `transport.onMessage(...)` 调用点展开，
   直接违背 §8.3「accept 恒 resolve」。
3. **fire-and-forget caller 放大后果**：`acceptTrusted` 唯一生产 caller 是
   `apps/yjs-server/src/app.ts:274` `void acceptTrusted.call(...)`——零 rejection handler；
   promise reject → unhandledRejection → 进程级风险（issue #259 家族事故形态）。

**行为影响面**：契约内 transport（close 不抛，全部现存 fixture/生产 adapter）行为**零变化**；
守卫仅在契约外形态下把「promise reject + 重放流产」收窄为「resolve undefined + 拒绝效果已生效」。
这是对既有立法的**兑现**而非行为变更。路径级 close（两入口门 0/1 的 `transport.close(1001/1008)`）
在监听注册之前、无重放窗口，维持原样不动（与 accept() 现行评审形状对称，不扩权）。

**验证载体（R1 修订，SA2 攻击点 #2）**：本守卫是全设计唯一超越「原样收敛」的新增代码路径，
在全部现存 fixture（close 均不抛）下是死代码——SA3 笔误（catch 块内误置状态/吞错后漏 emit）
在红/绿锚全绿下不可见，仅靠 SA4 目测无验证闭环。指定 **RT-1** 为行为锁定锚（§10.1 全规格）：
新建 `packages/ws-replication/test/ws-replication-issue190-guard.test.ts`（SA2 R1 指定载体；
SA6 两测试文件断言冻结不可承载）——throwing-close fixture + 超界帧同步重放，断言「恒 resolve /
拒绝事件仍发 / 重放循环零流产 / 零 unhandledRejection」。区分度：无守卫实现 → listener 内
throw 经 `onMessage(...)` 调用点展开 → `replayedCount:1`（重放流产）+ `await p` 抛出
（promise reject）→ 测试红；有守卫 → 全绿。§6 E10 行的验证锚已由「无既有测试」更新为 RT-1。

---

## §4 D2：`accept()` 收敛（行为逐字节等价）

门 3（:140-188）的 listener/缓冲/标志闭包**整体替换**为机制消费；其余门（0/1/2/4/5、
`queueMicrotask` 让出、分配段）零变化：

```ts
async accept(transport: DuplexTransport, request?: HubUpgradeRequest): Promise<HubConnection | undefined> {
  // 门 0/1/2：closed / missing-token / verifier-missing —— 原样不动（:117-138）
  // ── 门 3（R2 A2 + R3 N1 + #190 收敛）：共享有界早到帧 admission + 认证等待封顶 ──
  const admission = installEarlyFrameAdmission(
    transport, this.limits, (reason) => this.emitUpgradeRejected(reason),
  );
  // 注册完成后的同步收口段（R3 N1）：同步重放期已拒（或注册期早断）→ 摘真句柄 + 拒绝返回。
  // 此刻 auth timer 尚未武装——零清理面；非重放路径两标志恒 false，零开销通过。
  if (admission.isRejected() || admission.isEarlyClosed()) {
    admission.detach();
    return undefined;
  }
  // 认证等待封顶（显式政策，非沉默）：复用 timeouts.helloTimeoutMs——零新 knob（原 :181-188 政策原样）
  const authHandle = this.internals.timer.setTimeout(() => {
    admission.markRejected();   // 超时拒绝标记（迟归不复活）——close/emit 由本路径自理
    admission.detach();         // 此时句柄必为真值（注册已完成）
    if (!transport.closed) transport.close(1008, 'upgrade-timeout');
    this.emitUpgradeRejected('auth-timeout');
  }, this.timeouts.helloTimeoutMs);
  const clearAuthTimer = (): void => { this.internals.timer.clearTimeout(authHandle); };

  // ── 门 4：验证（accept 永不 reject）——原 :191-219，仅标志读取换轨 ──
  let instanceId: unknown;
  try {
    const verdict = await this.options.verifyToken(token);
    clearAuthTimer();
    if (admission.isRejected()) return undefined;   // 缓冲期已拒（预算/超时）——迟归不复活
    /* …invalid-credentials 分支原样… */
  } catch {
    clearAuthTimer();
    if (admission.isRejected()) return undefined;   // 超时在先、验证器抛错在后——仍 undefined
    /* …原样… */
  }
  await new Promise<void>((resolve) => queueMicrotask(resolve));  // A2-d 零宽窗口让出（:208-213 原样）
  if (admission.isRejected()) return undefined;     // 早到缓冲已拒——验后迟拒兜底复核
  /* …isValidInstanceId 原样… */

  // ── 门 5（R2 A4 顺序唯一基准）：先摘早到监听 → 再检查 → 再构造 ──
  admission.detach();
  if (this.closed) { transport.close(1001, 'hub-shutdown'); this.emitUpgradeRejected('hub-shutdown'); return undefined; }
  if (admission.isEarlyClosed() || transport.closed) {
    this.emitUpgradeRejected('peer-disconnected');  // 零分配、零 close 副作用
    return undefined;
  }
  const connection = new HubConnectionImpl(
    this.internals, transport, this.connectionCounter++, instanceId as string, admission.frames,
  );
  this.connectionList.push(connection);
  return connection;
}
```

私有 helper `rejectUpgrade(transport, detachEarly)`（:292-296）签名不变，调用点传 `admission.detach`。

**等价性论证**：机制 = 现 listener 三检逐语句复制 + 标志/缓冲换名（`authRejected`→`state.rejected`、
`earlyFrames`→`frames`）+ §3.4 守卫（契约内零差异）。auth timer 由 `markRejected()` 与共享标志合流——
语义与原单闭包标志 `authRejected` 完全同构（timer 置位 / 帧限置位互相可见：listener 幂等早退读同一
标志；门 4/5 的「迟归不复活」复核读同一标志）。冻结锚 A2-e / A2-d / A2-c / trusted-HELLO 全绿预期
（§8 逐锚论证）。

---

## §5 D3：`acceptTrusted()` 收敛（修复本体）

```ts
async acceptTrusted(
  transport: DuplexTransport,
  identity: UpgradeIdentity,
): Promise<HubConnection | undefined> {
  // 门 0：停止接纳（原样 :245-249）
  if (this.closed) {
    transport.close(1001, 'hub-shutdown');
    this.emitUpgradeRejected('hub-shutdown');
    return undefined;
  }
  // 门 1：身份文法（原样 :250-254——invalid-instance-id → 1008）
  if (!isValidInstanceId(identity?.peerInstanceId)) {
    transport.close(1008, 'upgrade-unauthorized');
    this.emitUpgradeRejected('invalid-instance-id');
    return undefined;
  }
  // ── 门 2（#190 修复本体）：共享有界早到帧 admission（与 accept() 门 3 同一机制单点）──
  //    trusted 路径无验证器、无 auth timer（SA5：无需该两件清理面）——注册到收口
  //    零 await，唯一可达拒绝源是同步重放期帧限拒绝。
  const admission = installEarlyFrameAdmission(
    transport, this.limits, (reason) => this.emitUpgradeRejected(reason),
  );
  // 注册后同步收口段（R3 N1 同款；检查序 = 拒绝原因优先级序，见 §5.1）：
  if (admission.isRejected()) {
    admission.detach();
    return undefined;   // 帧限拒绝已在监听器内完成 close + observer 事件——零分配、零补发事件
  }
  if (this.closed) {    // 防御性复查（原 :269-274 保留——单同步段内实际不可达）
    admission.detach();
    transport.close(1001, 'hub-shutdown');
    this.emitUpgradeRejected('hub-shutdown');
    return undefined;
  }
  if (admission.isEarlyClosed() || transport.closed) {   // 原 :275-279 语义保留
    admission.detach();
    this.emitUpgradeRejected('peer-disconnected');       // 零 close 副作用（对端已断）
    return undefined;
  }
  // 分配（§3.3 唯一顺序基准：先摘早到监听 → 检查 → 构造——原 :280 收口原序）
  admission.detach();
  const connection = new HubConnectionImpl(
    this.internals, transport, this.connectionCounter++, identity.peerInstanceId, admission.frames,
  );
  this.connectionList.push(connection);
  return connection;
}
```

### 5.1 收口段检查序 = 拒绝原因优先级序（新增设计决策，必须成文）

`admission.isRejected()` **必须**排在 `transport.closed` / `earlyClosed` 之前：帧限拒绝自身会
close transport（`transport.closed === true`）——若 `transport.closed` 先查，拒绝会被误分类为
`peer-disconnected` 并补发错误事件（违反 I2「拒绝一次定型、单一 reason」）。红灯快照锚定此序：
AC1-AC3 的 `rejectedReasons` 恰为 `['frame-too-large']` / `['early-frame-limit']` 且无第二次 close。

### 5.2 保真路径推演（绿灯锚逐帧复核）

`makeReplayTransport([HELLO])`（auth-lifecycle :632-653 + issue190 保真锚）：

1. 门 0/1 通过；安装 admission → 注册即重放 HELLO（32B 量级 ≪ maxFrameBytes；frames.length 0 < 16）
   → push（唯一保留点）；
2. 收口段三检全 false → `detach` → 构造 `HubConnectionImpl`（`admission.frames = [HELLO]`）；
3. 构造内 `transport.onMessage` 注册 → fixture **再**重放积压（`replayedCount` = 2，既有锚 :651）→
   连接监听消费 HELLO → `onHello` → ready + HELLO_ACK；
4. 构造尾重放 `earlyFrames` → 第二次投递 → ready 态收 HELLO → `CONNECTION_POLICY_VIOLATION` →
   `connectionFatal(1008)` → state `'closed'`（既有锚 :652「双投递 → policy 收口」）；
5. `rejectedReasons` = []（无 auth-upgrade-rejected；connection-failed 非 rejection reason——锚不断言）。

与现行为逐项一致——修复对合法 HELLO 路径零扰动。

---

## §6 竞态与边界矩阵

| # | 场景 | 机制响应 | 锚 |
|---|---|---|---|
| E1 | 同步重放期单帧超界（第 1 帧即 8MB+1） | listener 内拒：标志 + close(1009) + 事件；重放循环零流产（余帧幂等早退）；收口段 rejected-first → detach → undefined | AC1 快照全字段 |
| E2 | 同步重放期第 17 帧越条数界 | 前 16 帧 push，第 17 帧拒（1008 + `early-frame-limit`）；第 18+ 帧幂等早退 | AC2（17 帧）、AC3（64 帧，`replayedCount:64`） |
| E3 | 拒绝后事后泵帧（含合法 HELLO） | 收口段已 detach → pump 无处投递；连接不存在 → 无 FSM 可复活；零新 close/事件/wire 输出 | AC3 复活免疫段 |
| E4 | 接纳窗口内对端早断 | `earlyClosed` 置位（无副作用）；非拒绝路径 → `peer-disconnected` + undefined（原语义保留） | acceptTrusted 原 :275-279 |
| E5 | transport 注册前已 closed | 收口段 `transport.closed` → `peer-disconnected` + undefined（零 close 副作用） | 同上（原行为） |
| E6 | 拒绝与早断并发（拒绝 close 触发 onClose） | 拒绝先定型：onClose 仅置 earlyClosed（无事件）；收口段 rejected-first 不读 earlyClosed → 无 `peer-disconnected` 误发 | I2 + §5.1 |
| E7 | 微任务型 transport（makeEnd/testing.ts Set 形态） | 注册期零投递 → 三检零触发 → admission 直通（no-op pass-through）→ 帧后续达连接监听 | A2-* wire 锚全绿 |
| E8 | accept() 验证器迟归（拒绝已发生） | `markRejected`/帧限共用标志 → 门 4/5 复核 `isRejected()` → undefined（迟归不复活） | A2-d + 红灯 #5 家族 |
| E9 | hub.close() 与 acceptTrusted 竞态 | 单同步段（零 await）不可交错；门 0 拦截在先；防御性 `this.closed` 复查保留 | 原 :245/:269 |
| E10 | transport.close 在拒绝路径抛出（契约外形态） | §3.4 守卫吞异常；标志已置、事件仍发；promise 恒 resolve | I6（契约内帧载荷限定）+ **RT-1 守卫锚**（§10.1——R1 修订指定验证载体，SA2 攻击点 #2） |
| E11 | observer 回调 throw | `dispatchReplicationObserver` 隔离（静默），协议状态零影响 | observer.ts:34-38 |
| E12 | 敌意 transport 注册即无限同步重放 | admission 三检在**每帧**执行——第 17 帧必拒（条数界不依赖帧内容）；无限循环本身是同步回调契约的通性问题（timer 无法抢占同步代码），非本层可解 | C5 纵深防御定位 |
| E13 | 单槽替换型 transport（未来形态） | detach 在早到监听在册时执行（先摘后构造）→ 不摘错监听 | I7（phase5 §3.3 不变量 4） |

---

## §7 资源账（与 phase5 R2 A2 同构，覆盖面扩至 trusted）

- **单入口上界**：保留 ≤ `MAX_EARLY_FRAMES × maxFrameBytes`（默认 16 × 8 MiB）+ 常数数组开销；
  trusted 路径保留仅存在于**单个同步段**内（注册→收口零 await）——保留时长Transient（同步段结束即
  重放入连接或随拒绝丢弃），比 accept() 的 await 窗口更紧。
- **并发 N 个 upgrade**：N × 单项界，每入口独立安装（I8），无共享无界结构。
- **被拒方账单**：零连接分配（I3）+ 有界内存 + 有界占用时长 + 有界观察事件（恰 1 条）——
  ADR-0010 资源纪律在接收侧闭合。
- **timer 面**：trusted admission 零 timer（无验证器等待面）；accept() auth timer 清理面不变
  （§8.1 矩阵原样）。

---

## §8 兼容性影响评估

### 8.1 行为变化面（唯一，即修复目标）

| 输入 | 改动前（缺陷） | 改动后 |
|---|---|---|
| trusted 同步重放：单帧 > maxFrameBytes | 8MB+1 字节全量保留 → 分配连接 → 1002/'protocol-error' + `connection-failed` | 保留前拒：1009/'upgrade-frame-limit' + `auth-upgrade-rejected/frame-too-large`，零分配，恒 undefined |
| trusted 同步重放：> 16 帧 | 无界保留 → 分配 → 1002 | 第 17 帧即拒：1008/'upgrade-frame-limit' + `early-frame-limit`，零分配 |

其余全部路径（合法 HELLO、微任务型 transport、accept() 全部门、peer 侧、hub 生命周期）行为不变。

### 8.2 冻结锚逐锚保全论证

| 锚 | 预期 | 论证 |
|---|---|---|
| `issue190-red` AC1/AC2/AC3（3 红） | 转绿 | §5 + §6 E1-E3 逐字段推演（§5.2 同法） |
| `issue190-red` 保真锚 | 保持绿 | §5.2 逐帧推演 |
| auth-lifecycle `trusted Upgrade identity…`（:632-653） | 保持绿 | 同 §5.2（同一 fixture 同一路径） |
| auth-lifecycle **A2-e**（:655-678，accept 同步重放拒绝） | 保持绿 | §4 等价性：机制三检逐语句复制 accept 门 3；`replayedCount:1/17`、closeInfos、零分配全由 I1-I5 保持 |
| auth-lifecycle **A2-d**（认证超时封顶，:618-629） | 保持绿 | timer 路径 `markRejected + detach + close(1008,'upgrade-timeout') + 'auth-timeout'` 与原 :183-188 逐句同构 |
| A2-c draining close-code 分类 / A2-a/A2-b | 保持绿 | 连接建立后的 drain/分类逻辑零触碰 |
| issue168 HELLO_TIMEOUT / issue170 pong / issue171 ack / issue169 backpressure / issue174 GOAWAY / issue175 reauth | 保持绿 | 全部作用于 `HubConnectionImpl` 生命周期/连接后协议层，本设计零触碰（§11 DENY） |
| `issue190-guard` RT-1（新建守卫锚，§10.1——R1 修订，SA2 攻击点 #2） | 实现后即绿 | throwing-close fixture：守卫吞 close 异常 → 恒 resolve + `rejectedReasons:['frame-too-large']`（事件仍发）+ `replayedCount:3`（重放零流产）+ 零 unhandledRejection；无守卫实现天然红（`replayedCount:1` + promise reject——§10.1 区分度） |
| 全仓其余套件（yjs-server app/e2e） | 保持绿 | 生产唯一 caller（app.ts:274）行为面：合法 upgrade 分配不变；拒绝仅在新输入（越界早到帧）下触发，无既有测试注入该输入 |

### 8.3 公共 API / 类型 / wire / 文档

零变化：`HubReplication.acceptTrusted?` 可选签名不动（types.ts:141-145）；`MAX_EARLY_FRAMES`
仍模块常数（仅注释从「认证窗口」扩展为「两 upgrade 入口接纳窗口」）；close code/reason 与 observer
reason 均为既有已文档化值（§12）；`docs/protocols/instance-replication-v1.md` 零改动。

---

## §9 被否方案

| 方案 | 否决理由 |
|---|---|
| **A. 双份内联**：把门 3 三检复制进 acceptTrusted 的 listener | 违反 Required outcome 1「one mechanism」；正是缺陷产生机制（独立实现 → 单侧立法漏覆盖，SA5 根因），下次纪律演进仍会漏 |
| **B. 构造尾重放期检查**：在 `HubConnectionImpl` 重放循环里做帧限拒绝 | 检查发生在保留与分配**之后**（违反「before retaining bytes」）；分配已发生违反零分配不变量；拒绝时已是连接级 close 而非 upgrade 拒绝（错档 `connection-failed` 语义依旧）；需改构造器契约波及全部既有调用 |
| **C. transport 契约扩展**：给 `DuplexTransport` 加 admission/超时义务 | seam 契约沉默添加隐式义务——phase5 认证封顶政策已否决同类思路（types.ts 五成员零超时面的显式理由）；破坏全部既有 transport 实现 |
| **D. 条数界配置化**（新 limit knob） | 违反 R2 A2「零新 knob」立法（C8）；HELLO 是唯一合法早到帧，16 常数已含充裕余量 |
| **E. trusted 路径加 helloTimeoutMs 封顶 timer** | 无等待面可封（零 await 单同步段，E9/E12）；凭空新增 timer 清理面，违反最小改动 |

---

## §10 SA3 实现指引与验收映射

**改动落点**：

生产（单文件）：`packages/ws-replication/src/hub-connection.ts`
1. 新增模块私有 `installEarlyFrameAdmission` + `EarlyFrameAdmission` 接口 + `closeAdmission` 守卫
   （§3 伪代码，≈ 60 行含注释；置于 `MAX_EARLY_FRAMES` 常数之后）；
2. `accept()` 门 3 换轨为机制消费（§4；净 ≈ −20 行）；
3. `acceptTrusted()` 门 2 换轨 + 收口段（§5；净 ≈ +10 行）；
4. `MAX_EARLY_FRAMES` 注释扩展（±3 行）：覆盖面从「认证窗口」扩为「两 upgrade 入口接纳窗口」，
   **并补 #172 双标注**（现行 :41-46 仅「§3.2 R2 A2」单标注、无权威指向——`grep docs/protocols`
   在 `packages/ws-replication/src/` 零命中，本任务注释扩展时一并修正该历史欠账）；
5. **#172 双标注义务（R1 修订，SA2 攻击点 #1——MAJOR）**：本文件内凡进入源码注释的
   phase5 立法引用，必须**并置**「权威指向 + 历史证据」——帧限拒绝对外语义（close-code
   分类 + observer reason 闭集）→ `docs/protocols/instance-replication-v1.md`（§14 close-code
   分类、§23 observer reason 表，即 §12 P1-P3 的既有锚）；立法沿革 → phase5 design
   §3.2 R2 A2/R3 N1（`wiki/raw` 非规范，仅历史证据）。模板行已在 §3.1 注释草稿给出，
   SA3 直接采用；SA4 静态复核按此检查源码注释双标注形态。

测试（新文件 1 个，RT-1 验证载体）：`packages/ws-replication/test/ws-replication-issue190-guard.test.ts`
——规格冻结于 §10.1（R1 修订，SA2 攻击点 #2）。

实现形态（closure vs class）不锁，机制语义（I1-I8）与「两入口同一单点」是硬约束。

### 10.1 RT-1：§3.4 拒绝路径 close 守卫的行为锁定锚（R1 修订——SA2 攻击点 #2）

**动机**：`closeAdmission` try/catch 是全设计唯一超越「原样收敛」的新增代码路径，在全部现存
fixture（close 均不抛）下是死代码——SA3 笔误（catch 块内误置状态/吞错后漏 emit）在红/绿锚
全绿下不可见。RT-1 使「守卫在」与「守卫不在」可区分。

**文件**：`packages/ws-replication/test/ws-replication-issue190-guard.test.ts`（SA3 实现期按本规格
创建、SA7 动态验证执行——SA2 R1 指定载体；SA6 两文件断言冻结不可承载）。

**fixture**：`makeReplayTransport` 变体（与 issue190-red :60-112 同构，仅一处差异）——
`close()` 恒 `throw new Error('boom')`（其余面同款：send 记录、`onMessage` 注册即同步重放
完整 backlog、`onClose` 注册、`pump`）。fixture 级、零 mock 被测对象——红线纪律同 SA6
（零源码 grep、断言 = 可观察运行时行为）。

**输入**：`makeTrustedHub({ observer })` + backlog = 3 帧 = [1 帧 `CONTRACT_LIMITS.maxFrameBytes+1`
（超界），2 帧常规尺寸 32B]；`await hub.acceptTrusted(transport, { peerInstanceId: PEER_INSTANCE })`
（包 `collectUnhandledRejections` probe）。

**断言（快照式 toEqual + probe）**：

```ts
expect({
  resolved: conn === undefined ? 'undefined' : 'allocated:…',
  rejectedReasons: events.rejectedReasons(), // 事件仍发——吞的是 close 异常，不是拒绝效果
  connections: hub.connections.length,
  replayedCount: replay.replayedCount(),      // close throw 不得展开到 onMessage 调用点流产循环
}).toEqual({
  resolved: 'undefined',
  rejectedReasons: ['frame-too-large'],
  connections: 0,
  replayedCount: 3,
});
expect(probe.events).toEqual([]);             // 恒 resolve 不掉到 unhandledRejection
```

**区分度（红灯性）**：无守卫实现 → listener 内 `transport.close` throw 经 `onMessage(...)`
调用点展开 → 重放循环首帧即断（`replayedCount:1` ≠ 3）+ `acceptTrusted` promise reject →
`await p` 抛出 → 测试红；有守卫 → 全绿。天然锁定 §3.4 声称的行为变更面（「promise reject +
重放流产」→「resolve undefined + 拒绝效果已生效」）。

**RT-2 不做**：SA2 R1 攻击点 #3 明示「若 SA1 采纳措辞收敛，本测试可不做」——本设计已采纳
（§3.3 I6 限定契约内帧载荷并登记既有同面暴露），契约外载荷 probe 基线记录免做。

**验收映射**：AC1→§5/E1；AC2→§5/E2；AC3→§5.1/I4/E3；AC4→§4 等价性 + §8.2 锚表；AC5→下述
验证；RT-1→§3.4/E10 守卫行为锁定。

**验证（SA3/SA7 执行）**：
```bash
npx vitest run packages/ws-replication/test/ws-replication-issue190-red.test.ts    # 3 红→绿，保真锚保持绿
npx vitest run packages/ws-replication/test/ws-replication-issue190-guard.test.ts  # RT-1 守卫锚绿（§10.1）
npx vitest run packages/ws-replication/test                                        # 45 文件全绿（含 A2-e/A2-d/trusted-HELLO/RT-1）
pnpm typecheck                                                                     # 根级零错误
pnpm test                                                                          # 全仓
git diff --check                                                                   # 零空白问题
```

---

## SA2 反馈逐条回应

> R1 修订依据：SA2 攻击评审 `_sa2_review.md` §5 放行条件 1-3（攻击点 #1 MAJOR / #2 MINOR /
> #3 MINOR；#4/#5 为 INFO 记录无修订要求）。方案骨架（D1/D2/D3 + I1-I8 + §5.1 收口序）经
> SA2 全维攻击零改动，修订全部为合规/验证载体/声明精度层。

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| #1（MAJOR）§10 增补 #172 双标注义务条目 + §3.1 注释草稿补权威指向 | ✅ | §3.1 注释草稿（新增「权威指向 + 历史证据」两段）+ §3.1 代码块后「#172 双标签示范」说明 + §10 落点第 5 项（施工义务成文，含 SA4 静态复核检查点）+ §10 落点第 4 项（`MAX_EARLY_FRAMES` 注释扩展时修正现行 :41-46 单标注欠账）+ 头部 R1 版本表 | 注释草稿新增：权威指向 = 帧限拒绝对外语义以 `docs/protocols/instance-replication-v1.md` 为唯一 wire contract（§14 close-code 分类、§23 observer reason 表）；历史证据 = phase5 issue #138 §3.2 R2 A2/R3 N1 立法沿革（`wiki/raw` 非规范）。§10 第 5 项把双标注固化为 SA3 施工合同条目 |
| #2（MINOR）为 §3.4/E10 指定验证载体（推荐 ALLOW LIST 增补 RT-1 新测试文件） | ✅ | §10.1（RT-1 全规格：fixture/输入/断言/区分度，新建）+ §3.4「验证载体」段 + §6 E10 锚列 + §8.2 锚表新增行 + §10 验证命令块（guard 文件 + 45 文件计数）+ §11 ALLOW LIST 增补（标注 SA2 攻击点 #2）+ §13 `acceptTrusted` caller 清单增行 | 新建 `packages/ws-replication/test/ws-replication-issue190-guard.test.ts`（SA2 R1 指定载体，SA3 按规格创建/SA7 执行）：throwing-close fixture + 3 帧积压（1 超界 + 2 常规）→ 断言 `resolved:'undefined'` / `rejectedReasons:['frame-too-large']` / `connections:0` / `replayedCount:3` / `probe.events:[]`；无守卫实现天然红（`replayedCount:1` + promise reject）——「守卫在/不在」可区分，§3.4 行为变更面获验证闭环 |
| #3（MINOR）I6 声明收敛至「契约内帧载荷」限定 | ✅ | §3.3 I6 行（措辞重写：限定域 + 边界登记 + 不加守卫理由）+ §3.4「验证载体」段尾 RT-2 免做说明 + §10.1「RT-2 不做」小节 + 头部 R1 版本表 | I6 收敛为「机制自身零 throw 路径**在契约内帧载荷（Uint8Array）下**成立」；显式登记 `bytes.byteLength` 契约外载荷 TypeError 暴露与现行 accept() 门 3 :157 同面、非本任务新增、TS 类型已封死包内调用方；**不加 typeof 守卫**（SA2 裁定：加守卫破坏与 accept() 门 3 逐语句一致的等价性论证）；RT-2 按 SA2 明示免做 |

---

## §11. 文件清单（File Scope）

### ALLOW LIST

- `packages/ws-replication/src/hub-connection.ts` — 修改：§3 新增模块私有 admission 单点（≈55 行）；
  §4 `accept()` 门 3 换轨（净 ≈ −20 行）；§5 `acceptTrusted()` 门 2 换轨 + 收口段（净 ≈ +10 行）；
  `MAX_EARLY_FRAMES` 注释扩展（±3 行）。唯一生产文件。
- `packages/ws-replication/test/ws-replication-issue190-red.test.ts` — `[SA6 owned]` 验收红灯本体
  （已就位：3 红 IT + 1 绿保真锚）。SA3 不准改断言逻辑；仅允许测试基础设施级修复。
- `packages/ws-replication/test/ws-replication-auth-lifecycle-red.test.ts` — `[SA6 owned]` 冻结锚
  （A2-e :655-678 / A2-d / trusted-HELLO :632-653）。本任务预期零改动；SA6/SA3 仅许可测试
  基础设施级修复，断言冻结（§8.2 锚表为保全契约）。
- `packages/ws-replication/test/ws-replication-issue190-guard.test.ts` — 新建，
  `[SA3/SA7 owned]`（**R1 修订追加——SA2 攻击点 #2 指定验证载体**）：RT-1 throwing-close
  守卫锚，规格冻结于 §10.1（fixture：`close()` 恒 throw；断言：恒 resolve / 拒绝事件仍发 /
  `replayedCount:3` 零流产 / 零 unhandledRejection）。SA3 实现期按 §10.1 规格创建，
  SA7 动态验证执行；断言逻辑以 §10.1 为准不得偏离。SA6 两测试文件断言冻结，不可承载本锚。

### DENY LIST

- `packages/ws-replication/src/types.ts` — 类型面零变化（`acceptTrusted?` 可选签名与
  `DuplexTransport` 五成员契约不动；方案 C 已否决）。
- `packages/ws-replication/src/` 其余模块（`frame-io` / `backpressure` / `hub-namespace` /
  `liveness` / `observer` / `defaults` / `validate` / `peer-connection` / `peer-namespace` /
  `round-engine` / `update-channel` / `error-mapping` / `fence-watchdog` / `lifecycle-queue` /
  `testing` / `index`）— 邻接模块零触碰；`HubConnectionImpl` 连接后生命周期不动。
- `apps/yjs-server/src/**` — caller 侧零改动：契约未变（§13）；`app.ts:274` fire-and-forget 形态
  由设计侧 I6 兜住，不在本任务改 caller。
- `docs/protocols/instance-replication-v1.md` — 帧限拒绝语义已文档化（:389-390 close code 分类、
  :636 observer reason 表）；本任务复用既有语义，零文档变更（相关决议衍生约束的「若需变更」前提不成立）。
- `packages/ws-replication/test/harness.ts` / `driver.ts` / `issue137-driver.ts` — fixture 已备，
  零改动。
- 其余 `packages/**` / `apps/**` — 无关面。

---

## §12. 协议假设依据 (Protocol Assumption Evidence)

| # | 假设 | 依据类型 | 依据内容（具体引用） | 风险等级 |
|---|---|---|---|---|
| P1 | 单帧界拒绝 → `close(1009, 'upgrade-frame-limit')` | 源码引用 + 现有测试引用 + 协议原文引用 | `hub-connection.ts:157-163`（accept() 既有路径原样）；`ws-replication-auth-lifecycle-red.test.ts:665`（A2-e 绿锚断言 `[{code:1009,reason:'upgrade-frame-limit'}]`）；`docs/protocols/instance-replication-v1.md:390`「1009：外层 frame超限」+ :341（FRAME_TOO_LARGE→1009 注册表行） | 低 |
| P2 | 条数界拒绝（第 17 帧）→ `close(1008, 'upgrade-frame-limit')` | 源码引用 + 现有测试引用 + 协议原文引用 | `hub-connection.ts:164-170`；A2-e `:676`（`[{code:1008,…}]` 绿锚）；`instance-replication-v1.md:389`「1008：身份或连接 policy 错误」 | 低 |
| P3 | observer 事件 `auth-upgrade-rejected` reason ∈ {frame-too-large, early-frame-limit} 已文档化（= 简报「documented frame-limit semantics」） | 协议原文引用 + 源码引用 | `instance-replication-v1.md:636`（reason 闭联合含两值，pre-connection 无 connectionId）；`hub-connection.ts:98-106`（union 已含，SA5 Evidence 确认零新码） | 低 |
| P4 | 同步重放型 transport 形态（`onMessage` 注册即同步重放积压、重放先于 return）为实存形态，非 fixture 臆造 | 现有测试引用 | `packages/ws-replication/test/ws-replication-sa7-r2-transport.test.ts:130-140`（TcpTransport.onMessage 真实形态：注册后 `pendingFrames.splice(0)` 循环同步投递、先于 return）；issue190/auth-lifecycle 两侧 fixture（`:60-112` / `:108-156`）同构复刻 | 低 |
| P5 | `MAX_EARLY_FRAMES = 16` 为立法契约值（非本设计发明） | 源码引用 + 设计立法引用 | `hub-connection.ts:46`（模块常数）；phase5 design §3.2 R2 A2（「HELLO 是唯一合法早到帧，16 为充裕余量」）；红灯契约 `MAX_EARLY_FRAMES = 16`（issue190-red:51） | 低 |
| P6 | `accept`/`acceptTrusted` 恒 resolve（永不 reject）是包级不变量 | 源码引用 + 设计立法引用 + 现有测试引用 | `apps/yjs-server/src/index.ts:378` 注释「包契约『accept 永不 reject』被打破 = 包缺陷」；phase5 design §8.2/§8.3；issue190-red AC1-AC3 `collectUnhandledRejections` probe 断言空（:172-203） | 低 |
| P7 | `transport.close` 可能抛出，重放窗口内需守卫 | 源码引用 | `apps/yjs-server/src/index.ts:364-368` `safeCloseTransport`（「工厂产物形状不可信，吞其二次异常」——生产代码对 transport close 的既有设防先例）；phase5 §8.2 零抛出立法 + §3.4 完整论证 | 低 |
| P8 | observer 回调 throw 被隔离，不影响协议状态 | 源码引用 | `packages/ws-replication/src/observer.ts:34-38`（`dispatchReplicationObserver` try/catch 静默隔离） | 低 |
| P9 | trusted admission 窗口为单同步段（零 await），无 timer 封顶必要 | 源码引用 | `hub-connection.ts:241-290` 全函数无 `await`（async 仅签名）；§6 E9/E12 分析 | 低 |

本设计无「HTTP/WS 端点返回值」「端口占用时序」「跨 job 资源生命周期」「第三方库默认行为」类协议级
假设——修复面为纯进程内事件回调时序，P1-P9 已全覆盖。

---

## §13. 契约改动连锁审计 (Contract Change Caller Audit)

### 改动函数

| 函数 | 文件 | 改动前契约 | 改动后契约 |
|---|---|---|---|
| `acceptTrusted` | `packages/ws-replication/src/hub-connection.ts:241` | `Promise<HubConnection \| undefined>`：越界早到帧输入下 **无界缓冲 + 分配连接 + 1002/'protocol-error' 收口 + `connection-failed` 事件**（缺陷行为） | `Promise<HubConnection \| undefined>`：**类型签名零变化、零新增 throw 路径**；越界输入下保留前拒绝 + 零分配 + 1009/1008 `'upgrade-frame-limit'` + `auth-upgrade-rejected` 事件（即本 bugfix 的行为变更面，§8.1） |
| `accept` | `packages/ws-replication/src/hub-connection.ts:116` | `Promise<HubConnection \| undefined>`（恒 resolve） | **无契约改动**：内部换轨至共享机制，行为逐字节等价（§4）；「恒 resolve」不变量继续成立并经 §3.4 守卫强化 |
| `installEarlyFrameAdmission`（新） | `packages/ws-replication/src/hub-connection.ts`（模块私有） | — | 新增内部函数，不可从包外调用，零公共契约面 |

### Caller 清单

**`acceptTrusted` 全部 caller**（`git grep -n "acceptTrusted" -- ':!wiki' ':!*.md'` 实测）：

| Caller | 文件:行号 | 是否 await | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---|---|---|---|---|
| 生产组合根（唯一生产 caller） | `apps/yjs-server/src/app.ts:274` | ❌ **fire-and-forget**（`void acceptTrusted.call(...)`） | ❌ 无 | ❌ 无 | **零改动**：设计保证 I6「恒 resolve」（契约内输入限定，§3.3 R1 收敛措辞——机制零 throw 路径 + §3.4 close 守卫）→ 零 unhandledRejection；行为变化仅在越界输入下从「分配+1002」变为「零分配+1009/1008」——该输入无生产路径注入（§8.2 末行） |
| 绿锚测试 | `packages/ws-replication/test/ws-replication-auth-lifecycle-red.test.ts:649` | ✅ await | N/A | N/A | 零改动：1 帧合法 HELLO 过 admission → 分配路径不变（§5.2） |
| 本任务红灯 | `packages/ws-replication/test/ws-replication-issue190-red.test.ts:177/214/247/289` | ✅ await | N/A（probe 收集 unhandledRejection） | N/A | 断言目标即新契约快照——红灯转绿 |
| RT-1 守卫锚（**R1 修订新增**，SA2 攻击点 #2） | `packages/ws-replication/test/ws-replication-issue190-guard.test.ts`（新建，规格 §10.1） | ✅ await | N/A（probe 收集 unhandledRejection） | N/A | 断言目标 = I6 守卫行为面（throwing-close transport 下恒 resolve + 事件仍发 + 重放零流产）——§3.4 验证闭环；caller 清单只增不删（R1 追加） |

**间接 caller**（经 `startHubWsServer` 回调链触达 `app.ts:274`）：

| Caller | 文件:行号 | 是否 await | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---|---|---|---|---|
| ws upgrade 适配回调 | `apps/yjs-server/src/transport/ws-server.ts:195`（`options.accept(wrapWs(ws), identity)`） | 同步调用 | ❌（回调体内 app.ts:270-272 自有 TypeError 防御，非本任务面） | `.catch(() => socket.destroy())`（:197，仅覆盖 async IIFE） | 零改动：I6 使 promise 恒 settle，回调链无新增异常面 |

**`accept` 全部 caller**（行为零变化，列出供 SA4 比对完整性）：

| Caller | 文件:行号 | 是否 await | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---|---|---|---|---|
| yjs-server legacy WS 接线 | `apps/yjs-server/src/index.ts:375` | void + `.then(onFulfilled, onRejected)` | ✅ 显式 rejection handler（响亮 notify + safeClose 1011） | — | 零改动：恒 resolve 保持 → handler 永不触发 |
| 测试 driver | `packages/ws-replication/test/driver.ts:511` | ❌ fire-and-forget | ❌ | N/A | 零改动（phase5 审计原结论「accept 永不 reject」延续） |
| 测试 driver | `packages/ws-replication/test/driver.ts:675` | ✅ await | N/A | N/A | 零改动 |
| issue137 driver | `packages/ws-replication/test/issue137-driver.ts:140` | ❌ fire-and-forget | ❌ | N/A | 零改动 |
| 冻结红/绿锚（多调用点） | `ws-replication-auth-lifecycle-red.test.ts:206/233/237/247/262/399/557/585/595/624/661/673`、`issue168…:270`、`issue169…:684` | ✅ 或 void | probe（A2-e） | N/A | 零改动：§8.2 逐锚保全论证 |

### 风险评估

- **遗漏 caller 的代价**：`acceptTrusted` 若引入任何 throw/reject 路径，`app.ts:274` 的 `void`
  使其直接成为 unhandledRejection（issue #259 家族：进程级风险）。本设计**反向操作**——零新增
  throw 路径且以 §3.4 守卫**收窄**了既有风险面（重放窗口内 close 抛出从「promise reject」变为
  「resolve undefined」）。
- **行为变更半径**：`acceptTrusted` 唯一行为变化输入（越界早到帧）在生产路径中无注入源
  （生产 transport 由 `wrapWs` 构造、帧来自真实 WS 对端；越界帧=恶意/缺陷对端，恰是本修复要
  防御的对象），全部既有测试绿锚不受影响（§8.2）。
- **抓全 caller 的方法**（已执行）：
  ```bash
  git grep -n "acceptTrusted" -- ':!wiki' ':!*.md'          # → app.ts:269-274 + types.ts + 2 个测试文件
  git grep -n "\.accept(" -- 'packages/**/*.ts' 'apps/**/*.ts'  # → 全量见上表
  ```
