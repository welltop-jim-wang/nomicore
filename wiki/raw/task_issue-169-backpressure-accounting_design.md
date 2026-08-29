# SA1 设计 — issue #169：连接级背压记账 / 控制保留额度 / poll 公式对齐协议 §17（R12 退休账本版 v5；SA4-R2 文本修订 v5.2）

> 任务类型：Bug 修复。Worktree：`/home/wangjian/nomicore-fix-issue-169`（branch `fix/issue-169-on-docs-phase-5-websocket-replication`，base = `docs/phase-5-websocket-replication`，HEAD=ef19bae）。
> 简报：`wiki/raw/task_issue-169-backpressure-accounting.md`；SA5 缺陷分析：`wiki/raw/20260829-bug-issue-169-backpressure-accounting.md`。
> 约束基准：`wiki/raw/task_issue-169-backpressure-accounting_relevant_decisions.md`（SA8 前置门禁，verdict=clear，0 冲突）——ADR-0010「#161 round 2 修订节」+ 其收录的 `docs/protocols/instance-replication-v1.md` §13.1/§14/§17/§18 为唯一权威。
> 红灯契约：`packages/ws-replication/test/ws-replication-issue169-backpressure-accounting-red.test.ts`（17 用例：13 红 / 4 锚绿；§12 逐条走查）。红灯契约本轮零改动（SA2 裁定）。
> **修订记录**：v2 按 SA2 R1（reject）落实 R1-R8（R3 双账本拆分 + R4 恒计、93B 帧头修正、FIFO 假设声明、caller 审计补齐、缺面悬崖如实登记）。v3 按 SA2 R2（reject）落实 R9/R10（D3 族 mb=512/quota=640 配方 + 前置断言；Δ≡0 恒读数面风险范围）。v4 = R11 实现期裁定（撤回 R4 可选项 (c) 恒计：789B 等额永久残差击穿 R1-1 协议公式边界锚，§12.7；控制仅暂停入压力桥，批准 SA3 commit 541c3b7 形状）。**v5（本版）= R12 双轴 BLOCK 修订**：最终双轴审查（Standards+Spec）一致 BLOCK 并推翻 SA7 F1 的非阻断归类——issue 明确要求 `maxQueuedControlBytes` 是**未冲刷 control bytes 的上限**，而 v2-v4 的额度释放规则是**无 kind 归因**的 `controlUnflushed -= min(|Δ|, balance)`：**data flush 的观察下降同样释放控制额度**。SA7 D1 动态实证（SA4 R2 实测真值）：quota=163,840 下单次净下降 **Δ=−44,963**（data flush）误释放等量额度 → 窗口余额 148,293−44,963 = 103,330 → 再放行 3 帧（**n2=3**）→ 共 **12 帧 / 197,724 > quota（超 33,884）** 且控制仍未冲刷——直接违反 issue 语义。v5 引入 **kind-aware 保守退休账本**（§3.5）：Δ<0 的额度退休按「本连接 data（吸收侧→handoff 侧）→ 本连接 control（吸收侧→handoff 侧）」优先序消耗，**data flush 绝不释放控制额度**（硬不变量）；外部积压不作退休候选（G3b 锚钦定的归因读法，残余乐观性登记 §14.6）；D1 反向回归走查 §12.8。压力侧机制、R3 拆分、R11 裁定均不变。逐条映射见文末「SA2 反馈逐条回应」R12 行。**v5.1（本版）= R12 复审非阻断 NC 对齐**（SA3 commit 8da8692 已实现 R12 并通过 D1 安全回归）：NC-5——§14.6 显式枚举第三类受控乐观（跨窗口 ③④ 残留候选：生命周期账 vs 窗口账的错位；界链 R_xw ≤ C_prev → 未冲刷自有控制 ≤ 2×quota 最坏、恒动面 C_prev ≈ 0、可选收紧变体 enterPause 清零 ③），§3.5 保守性清单同步增补；NC-6——§12.8/§3.5/§3.3/修订记录/A15 的 v4 违反叙事数字由设计期重构（3×16,477/197,724/12 帧）对齐为 SA7 实际构造（**单次 61,440 data flush / 13 帧 / 214,201**，超出 50,361），重构版废止声明就地登记（**该 NC-6 转述值后经 SA4 R2 实测再纠正——见 v5.2**）。**v5.2（本版）= SA4 R2 文本阻断修订**（verdict=reject，实现本体免返工，仅三项设计文本）：**(A) D1 叙事数字改为 SA4 实测真值**——P4 净 Δ=−44,963（非 61,440）、P3 退休候选 ③=94,598 / ④=53,695（合计 148,293 = 9×16,477）、v4 形状 **12 帧 / 197,724（超 33,884、n2=3）**、v5 结论不变（① 全额消耗 → 零释放 → 第 10 帧首越界 164,770 恰一次收口）——NC-6 转述值（61,440/13 帧/214,201/50,361）一并废止；**(B) §15 ALLOW LIST 补已提交的 `ws-replication-sa7-issue169-dynamic.test.ts`**（[SA7 owned] 动态验证契约：D1=R12 退休账本反向回归锚、D2=Δ≡0 write-through-0 悬崖饱和签名真实 TCP 契约）；**(C) §12.8 明确 D1 反转分工（SA3 实现 8da8692 / SA7 复证）+ 附录 A teardown 清单显式列入 `unretiredAbsorbedData`/`unretiredAbsorbedControl`**。
> 基线验证（SA1 设计期实测，2026-08-29，未改任何生产代码）：
> `pnpm exec vitest run packages/ws-replication` → **Test Files 1 failed | 22 passed；Tests 13 failed | 159 passed；Type Errors no errors**——唯一红文件即新红灯测试；全部既有套件当前绿，§11/§12 逐套件给兼容论证与迁移配方。

---

## §0. 任务定位与边界

本任务 = **实现纠偏**：PR #165（ef19bae）落定了协议 §17 的权威背压文本，但 `ConnectionSender`（PR #162/08da15b 按 issue #137 自有口径实现）未同步。SA8 已裁决：任务七项 Scope 与 ADR-0010 #161-r2 登记的背压终态口径「pipeline = queued+buffered、shed 仅 queued 侧、严格接纳 + onDataShed 显影、控制独立保留额度 maxQueuedControlBytes 缺省 8MiB、有界整轮扫描、pending handoff 计入 per-ns 溢出双口径、checkpoint = max(1, floor(ackTimeoutMs/100))、1011 终止」逐点一致，**不修订、不推翻任何既有决策**。SA2 R3 指出的「吸收期双计」属 v1 设计的实现级缺陷（SA8 裁定时未审出），本版以台账拆分修正——修正后总压公式仍是「queued + bufferedAmount（+交接缝隙补偿）」的无缝隙落实，不触碰 SA8 裁定本身。

**明确不在本任务面内**（简报 + SA8 注记 3）：ping/pong 活性、GOAWAY、namespace lifecycle、`ConnectionSender`/`DataSenderFacet` 结构重组（不得回退第二个 OutboundQueue data 调度器）。

---

## §1. 根因推演（最深层层因）

### 1.1 物理模型：单一可观察量 + 异步吸收 = 结构性记账缝隙

连接级压力的**真相**分布在四个相位，而实现只有一个可观察量 `transport.bufferedAmount`：

| 相位 | 内容 | 可观察性 |
|---|---|---|
| P1 queued | 各 ns 未发送 data 队列（`facet.queuedBytes()`，口径=原始字节和，§5 R2 冻结） | ✅ 精确 |
| P2 handed-off | 已调 `emitRaw` 交给 transport、**尚未被 bufferedAmount 反映**（吸收异步）——data 与 control 帧都经过此相位 | ❌ 不可见（缝隙） |
| P3 buffered | socket 缓冲内未冲刷字节（data+control 混同） | ✅ 经 `bufferedAmount`（滞后读数） |
| P4 flushed | 已冲刷 | ❌ 只能经 P3 的**下降**间接推断 |

当前实现用两套割裂账本各取片段：

- **admission**（`backpressure.ts:96`）：`projected = readBufferedAmount() + Σ queued + frameBytes`——只补偿「当前这一帧」，补偿不了同同步栈先前已交接的 P2 帧；
- **shed**（`backpressure.ts:229`）：`Σ facet.queuedBytes()`——连 P3 都不含。

**G1 击穿的机理**：同步栈 10 连发、`bufferedAmount` 恒 0（滞后）时，每帧在 `emitData` 后同时离开 P1（发出去了）且未进入 P3（未吸收）——两套账本上都不存在 → admission 对第 4..10 帧的 `projected` 恒等于单帧长 → 10/10 放行，wire 164,000B ≈ 2.5× cap。这是**类别缺陷**（缝隙结构性存在），不是单点漏加：修复必须引入 P2 台账（每帧恰计一次），并把 admission 与 shed 统一到一个账本上（简报 Scope 1+2）。

### 1.2 六处结构偏差（SA5 已定位，SA1 复核确认，SA2 逐行复核属实）

| # | 位置 | 现状 | 协议 §17 权威口径 | 红灯 |
|---|---|---|---|---|
| 1 | `backpressure.ts:55` | poll 固定 1000ms | 检查点间隔 = `max(1, floor(ackTimeoutMs/100))` | G6a/G6b |
| 2 | `backpressure.ts:63-64,79-87,117-121` | 控制额度 = 暂停段**累计已发**字节（`enterPause`/`resume` 清零是唯一释放点）；判据仅 paused 生效 | 额度 = socket 缓冲内**未冲刷**控制字节账本（冲刷即释放）；耗尽 = `CONNECTION_BACKPRESSURE` + close(1011) | G3b/G8/G9 |
| 3 | `backpressure.ts:91-99` | admission 漏计 P2（pending handoff） | 总队列记账 = 每 ns 排队字节 + socket bufferedAmount（连接级 pipeline，无缝隙） | G1/G2a/G2b |
| 4 | `backpressure.ts:220-238` | shed 只看 Σqueued、恢复目标停在 `total ≤ cap` | 溢出触发时按最大排队 ns 整队丢弃**至 queued 侧 ≤ low-water**（shed 只作用排队侧） | G4/G5 |
| 5 | `types.ts:29` / `defaults.ts:27` / `validate.ts:118` | 字段 `controlReserveBytes`（64 KiB，仅正整数校验）；缺省 64KiB < maxBootstrapBytes 缺省 4MiB → 暂停窗口内合法 BOOTSTRAP_SNAPSHOT 自杀式 1011 | `maxQueuedControlBytes` 缺省 8 MiB，且 ≥ `maxBootstrapBytes` + 协议开销（启动期响亮验证，无迁移） | G7a-d/G8/G9 |
| 6 | `backpressure.ts:96` vs `:229` | admission 与 shed 两套账本割裂；严格接纳（拒纳 + 同批丢弃 + needs-resync 显影）在入队路径缺失 | 单一台账驱动 admission + shed + 严格接纳（不静默吞、不静默纳） | G5 |

**最深层层因**（git 考古，SA5 §Investigation）：`backpressure.ts` 创建于 08da15b（#162），其口径出自 issue #137 设计 §4.x；#165（ef19bae）把权威文本写进协议但没改实现——「still disagrees」自那时起从未一致过。**直接路径的严格接纳其实已存在**（PR #165 在 `update-channel.ts` 落定：`sendUpdateFrame` 返回 ≤0 → `discardQueued + needsResync + declareLocalResync`，`update-channel.ts:160-166`）——G5 缺的是**入队路径**（`onDataQueued` 侧）的触发与恢复目标。

### 1.3 红灯基线复核（SA1 实测）

13 红 = G1 / G2a / G2b / G3b / G4 / G5 / G6a / G6b / G7a / G7b / G7c / G8 / G9；4 锚绿 = G2c（单帧守卫）/ G3a（首过限帧 + 恰一次）/ G4b（victim 选择）/ G7d（恰值合法）。四锚锁定既有正确行为，本设计全部保持（§12）。

---

## §2. 设计总则（不变量）

I-1 **压力相位恰计一次（R4 措辞 + R11 裁定范围）**：一帧的**压力侧**足迹——data 帧自入队（P1）→ 交接（P2，`handoffQueue` FIFO 成员）→ 吸收/离开传输队列（P3 = `bufferedAmount` 观察值）→ 冲刷（P4，退出一切压力账）——任一时刻恰好落在一个压力相位、恰好被 `totalPressure()` 计一次；**控制帧的相位声明只覆盖暂停窗口内交接者**（其 P2 足迹 = `handoffQueue` 中的 control chunk，聚合为 `controlPendingHandoff`；非暂停期交接的控制帧**不入压力桥**——R11 裁定，其暴露单列为 §4.4/§14.2 已知盲区，归协议观察滞后域）。`controlUnflushed` **不是压力相位账本**，是 §4.3 额度判据的**策略覆盖层**（暂停窗口内的未冲刷控制记账），只喂额度判据、不喂 `totalPressure()`——同一字节可同时位于 P3（压力已计）与策略账（额度语义），二者消费面不同、各自恰计一次。

I-2 **单一台账**：admission（`tryEmitData`）、shed 触发（`enforceConnectionCap`）、恢复目标共用同一 `totalPressure()`；不允许第二套口径（Scope 2/6）。

I-3 **触发严格大于、接纳 `≤ cap`**：溢出触发用 `> cap`（恰好 cap 不触发 shed——AC-5 既有边界语义）；admission 判 `projected ≤ cap`（G2a 恰值放行锚）。

I-4 **误差方向单调安全**：交接缝隙补偿（P2 台账）只允许**高估**压力（保守拒纳），不允许**低估**（击穿预算）；其宽松度在任何观察间隙内不超过 `|ΔbufferedAmount|`——即不超过协议权威公式（queued + bufferedAmount，根本不计 P2）自身的宽松度（§3.3 论证）。

I-5 **不引入第二个 data 调度器**：`ConnectionSender`（wheel 轮转 + drain）与 `DataSenderFacet`（通道侧）结构不动；`OutboundQueue`、`UpdateChannel`、round-engine、namespace 层零改动（DENY LIST）。

I-6 **网络背压不进 Runtime sequencer**（ADR-0008 负向约束）：`backpressure.ts` 继续零 import/零 await/零回调 Runtime/Lease/Registry——本次改动不新增任何外部依赖。

I-7 **响亮失败，无运行时 clamp**（§17「不得运行时 clamp」）：字段约束在 `validateLimits` 构造期 TypeError；`ackTimeoutMs` 等超时已在 `validateTimeouts` 保证正有限安全整数；测试 harness 迁移后对额度字段做 `Number.isFinite` 防线，杜绝 cast 遮缺键的 NaN 静默失效（R1）。

---

## §3. 统一连接账本（核心新增；R3/R4/R5/R11/R12 修订）

### 3.1 FIFO 交接队列 + 一个策略账本 + 退休候选计数 + 一条基线（R3 拆分 + R12 退休账本）

```ts
// ConnectionSender 新增/改语义的私有状态
/** P2 交接队列：按交接序 FIFO 记录「已交给 transport、未被观察吸收/离开」的 chunk。
 *  入队纪律（R11 裁定）：data 恒入队；control 仅暂停窗口内入队（非暂停控制不入压力桥——
 *  §12.7 裁定依据：恒计会在「Δ≡0 相位后接 Δ>0」的面上留下等额永久残差，击穿协议公式边界锚）。
 *  两个余额是其聚合视图： */
private handoffQueue: Array<{ kind: 'data' | 'control'; bytes: number }> = [];
private pendingDataHandoff = 0;    // = Σ kind==='data' 的 bytes（data 侧 P2 余额；恒计）
private controlPendingHandoff = 0; // = Σ kind==='control' 的 bytes（control 侧 P2 余额；仅暂停窗口，R11）
/** 策略账本（非压力相位）：暂停窗口内交接、未观察冲刷的控制字节——只喂 §4.3 额度判据。 */
private controlUnflushed = 0;
/** 退休候选计数（R12）：Δ>0 归因弹出 handoff chunk 时按 kind 累积的「已吸收、未退休」余额——
 *  Δ<0 的控制额度退休按 §3.5 优先序消耗这些候选；仅 teardown 清零（缓冲模型，跨暂停窗口持续）。 */
private unretiredAbsorbedData = 0;
private unretiredAbsorbedControl = 0;
/** 最近一次观察基线（delta 对账）。 */
private lastObservedBuffered = 0;
private readonly pollIntervalMs: number;  // = max(1, floor(host.ackTimeoutMs / 100))
```

### 3.2 观察原语 `observe()`——所有 `readBufferedAmount` 消费点的单点必经

```ts
/**
 * 读数 + 对账（§3.3 方向性与界；§3.5 退休账本）：
 *  - Δ > 0（吸收证据）：FIFO 队首起弹出 min(Δ, 队列总余额) 字节（按 kind 核减压力侧余额），
 *    并把弹出量按 kind 累积到退休候选计数（unretiredAbsorbedData/Control）；
 *    超出队列余额的增量 = 外部积压（不作退休候选，不记账）。
 *  - Δ < 0（离开证据）：按 §3.5 退休优先序消耗——
 *      ① unretiredAbsorbedData → ② handoffQueue 中 data chunk（最老优先）
 *      → ③ unretiredAbsorbedControl → ④ handoffQueue 中 control chunk（最老优先）；
 *    控制额度释放 = ③+④ 实际退休的控制字节（clamp 到 controlUnflushed）。
 *    压力侧总弹出量 = min(|Δ|, 全部候选余额)（与 v4 相同的总量，仅归因顺序改为 data 优先）。
 * 返回本次观察值。
 */
private observe(): number {
  const level = this.host.readBufferedAmount();
  const delta = level - this.lastObservedBuffered;
  if (delta > 0) {
    let remaining = delta;
    while (remaining > 0 && this.handoffQueue.length > 0) {
      const chunk = this.handoffQueue[0]!;
      const take = Math.min(chunk.bytes, remaining);
      if (chunk.kind === 'data') { this.pendingDataHandoff -= take; this.unretiredAbsorbedData += take; }
      else { this.controlPendingHandoff -= take; this.unretiredAbsorbedControl += take; }
      chunk.bytes -= take;
      remaining -= take;
      if (chunk.bytes === 0) this.handoffQueue.shift();
    }
    // remaining > 0 的部分 = 外部积压增量（非本连接写入）——不作退休候选，不记账
  } else if (delta < 0) {
    let remaining = -delta;
    // ① 已吸收 data 退休候选
    const r1 = Math.min(remaining, this.unretiredAbsorbedData);
    this.unretiredAbsorbedData -= r1; remaining -= r1;
    // ② handoff data chunk（最老优先；data flush 对 data stale 的释放——§3.3(c)）
    remaining -= this.retireFromHandoff('data', remaining);
    // ③ 已吸收 control 退休候选
    const r3 = Math.min(remaining, this.unretiredAbsorbedControl);
    this.unretiredAbsorbedControl -= r3; remaining -= r3;
    // ④ handoff control chunk（最老优先）——G3b 的归因读法（无本连接 data 在场时的下降归因于控制）
    const r4 = this.retireFromHandoff('control', remaining);
    // 控制额度释放：仅由 ③+④（退休的控制字节）驱动——data flush（①+②）绝不释放（R12 硬不变量）
    this.controlUnflushed -= Math.min(r3 + r4, this.controlUnflushed);
  }
  this.lastObservedBuffered = level;
  return level;
}

/** 从 handoffQueue 按指定 kind（最老优先）退休 up to budget 字节（核减压力侧余额、清空 chunk）；返回实退量。 */
private retireFromHandoff(kind: 'data' | 'control', budget: number): number {
  let retired = 0;
  for (const chunk of this.handoffQueue) {          // 队首即最老；原地遍历缩减
    if (budget <= 0) break;
    if (chunk.kind !== kind || chunk.bytes === 0) continue;
    const take = Math.min(chunk.bytes, budget);
    chunk.bytes -= take; budget -= take; retired += take;
    if (kind === 'data') this.pendingDataHandoff -= take;
    else this.controlPendingHandoff -= take;
  }
  this.handoffQueue = this.handoffQueue.filter((c) => c.bytes > 0);
  return retired;
}
```

### 3.3 释放规则、FIFO 假设与界（R3/R4/R5 落实）

**FIFO 吸收假设（R5 显式声明）**：`observe()` 把观察值的变化归因到**最老**的交接 chunk。该归因在「transport 按交接序吸收/冲刷用户写入」（FIFO）时精确。依据（官方文档）：
- WHATWG/HTML WebSocket API 与 MDN：`bufferedAmount` = 「queued using calls to send() but not yet transmitted to the network」——`send()` 按调用序入队（[MDN `WebSocket.bufferedAmount`](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/bufferedAmount)）；
- Node.js 流：`writableLength` = 写队列待写字节数，写请求按提交序进入写队列（[Node.js stream docs](https://nodejs.org/api/stream.html)）；本仓真实 TCP 适配器即以 `socket.writableLength` 为 `bufferedAmount` 真值来源（ws-replication-sa7-r2-transport.test.ts:74/108）。

**假设不成立时（非 FIFO 吸收）的欠计上界**：单次误归因 ≤ `min(|Δ|, 被误释侧余额)`；对预算的净影响 ≤ 该次 `|Δ|`，且 ≤ 协议公式在同一观察间隙的自身宽松度（协议公式根本不计 P2，观察值一降它同样全额释压）。SA2 T5 测试将该边界文档化钉死。

| 账本 | 角色 | 释放时机 | 方向性论证 |
|---|---|---|---|
| `handoffQueue`（余额 `pendingDataHandoff` 恒计 + `controlPendingHandoff` 仅暂停窗口，R11） | 压力相位 P2（I-1） | Δ>0：FIFO 队首弹出 `min(Δ, 总余额)`（归因吸收）；Δ<0：按 §3.5 退休优先序弹出（data 优先——①已吸收 data 计数 → ②handoff data → ③已吸收 control 计数 → ④handoff control），总量仍 = `min(\|Δ\|, 全部候选余额)` | (a) 同步栈内（G1）：Δ=0 → 零释放 → 缝隙被补偿，预算严格；(b) 跨间隙：transport 报告字节离开（升降皆然）即按其权威释压——协议公式（queued+bufferedAmount）在同一间隙**全额**忽略 P2，故本桥的宽松度恒 ≤ `\|Δ\|` ≤ 协议自身宽松度，I-4 单调安全成立；(c) 若 Δ<0 不释压力侧，则「吸收+冲刷发生在同一间隙」的 chunk 在恒动面（真实 `writableLength` 适配器健康态波动/归零）上留下不可回收 stale → P2 无界累积 → 健康连接假拒/假 shed——双向释放是「不比权威口径永久更严」的必要条件；(d) **精确性（R11）**：data-only 队列在 FIFO 吸收假设下残差恒 0（每次 Δ>0 恰弹出对应 data chunk，§12.3 零干扰论证成立；Δ<0 的 data-first 顺序对 data-only 队列逐值等价）；若非暂停 control 恒入队（v2/v3 形状），则「Δ≡0 相位（如 GatedWire gate-off boot 期 delivered 即离缓冲）入队的 control chunk」会被后续 data 吸收的 Δ>0 提前弹出、留下等额 data 残差**永久滞留**（SA3 实测 789B，§12.7）——恒计的代价与既有边界锚不可共存，故 control 仅暂停入队。 |
| `controlUnflushed` | 策略覆盖层（§4.3 额度判据专用，**不进 totalPressure**——R3 消双计） | **仅 Δ<0 且经 §3.5 退休账本归因为控制退休**（③已吸收控制 + ④handoff 控制；①②data 退休绝不触发）；`enterPause`/`resume`/`teardown` 窗口重置 | 已吸收（Δ>0）≠ 已冲刷——吸收后仍占用额度（R2-A2a 即时反射 wire 的语义锚：控制帧发出 → held 增长（Δ>0），字节仍在 socket 缓冲、未冲刷，额度不得释放）。**R3 修复要点**：该账本不计入 shed/admission 总压（消双计假 shed，§12.4）。**R12 修复要点**：v2-v4 的 `min(\|Δ\|, balance)` 无 kind 归因——data flush 的下降同样释放控制额度（SA7 D1，SA4 R2 实测：quota 163,840 下净下降 Δ=−44,963 误释放 → 12 帧 / wire control 197,724 > quota（超 33,884）且未冲刷，直接违反 issue 的「未冲刷 control bytes 上限」语义）；v5 起释放仅由退休账本的控制退休量驱动（§3.5）。 |

### 3.4 总压函数（R3 修订）

```ts
/** 连接总压（§17「总队列记账 = 每 ns 排队字节 + socket bufferedAmount」的无缝隙实现）：
 *  P3 观察 + P2 未吸收/未离开交接（data 恒计；control 仅暂停窗口，R11）+ Σ P1 排队。
 *  controlUnflushed 不在此（R3）：已吸收控制字节已在 lastObservedBuffered 内；
 *  非暂停控制不在此（R11）：归协议观察滞后域（§4.4/§14.2 诚实暴露界）。 */
private totalPressure(): number {
  return this.lastObservedBuffered + this.pendingDataHandoff
       + this.controlPendingHandoff + this.totalQueuedBytes();
}
```

`controlPendingHandoff` 仅含**暂停窗口内**交接的控制 chunk（R11）：入暂停窗口后（含窗口残留至 resume 后未释放的部分）计入总压——恒 ≥ 0、≤ maxQueuedControlBytes（额度判据在窗口内封顶），保守方向（高估）；resume 后未获 Δ 释放的窗口残留同样保守（I-4 安全）。非暂停期控制交接不入压力桥，其暴露见 §4.4/§14.2；**Δ≡0 恒读数面**（恒 0 缺面 / write-through-0 / 仅测试 wire 冻结非 0 读数——三者同构，R10）的长期行为如实登记于 §14.4（R6/R10）。

### 3.5 kind-aware 保守退休账本（R12；控制额度的退休归因）

**问题（双轴 BLOCK 实证）**：socket 缓冲是 data/control 混同的单一聚合观察量 `bufferedAmount`——一次下降无法区分冲刷的是 data 还是 control。v2-v4 的无 kind 归因释放使 **data flush 释放控制额度**：SA7 D1 动态实证（SA4 R2 实测真值）quota=163,840（160KiB）下，**单次净下降 Δ=−44,963（data flush）** 经无 kind 归因规则误释放等量额度 → 窗口余额 148,293−44,963 = 103,330 → 再放行 3 帧（n2=3）→ 共 **12 帧 / 197,724（=12×16,477）** 控制字节上 wire（**超 quota 33,884**）且仍未冲刷——issue 的「maxQueuedControlBytes = 未冲刷 control bytes 上限」被击穿（数值源=SA4 R2 实测；v5 初稿重构值与 NC-6 转述值〔61,440/13 帧/214,201〕均废止）。

**退休规则（优先序消耗，实现于 §3.2 observe() 的 Δ<0 分支）**：

```text
Δ<0（离开证据）按以下顺序消耗退休预算 |Δ|：
  ① unretiredAbsorbedData      —— 本连接已吸收、未退休的 data（Δ>0 归因时累积）
  ② handoffQueue 的 data chunk —— 本连接未吸收 data（最老优先）
  ③ unretiredAbsorbedControl   —— 本连接已吸收、未退休的 control
  ④ handoffQueue 的 control chunk —— 本连接未吸收 control（最老优先）
控制额度释放 = ③ + ④ 的实际退休量（clamp 到 controlUnflushed）。
外部积压（Δ>0 超出 handoff 余额的增量）不作退休候选、不记账。
```

**硬不变量（R12）**：`data flush 绝不释放控制额度`——①② 的消耗不产生任何 `controlUnflushed` 释放。只要本连接存在任何未退休 data（①② 余额 > 0），下降首先被 data 消耗；控制额度释放仅发生在下降深度**超过全部本连接 data 退休候选**之后。

**保守性与能力假设（§14.6 详述）**：
- **对本连接字节保守**：控制退休要求下降深度 > 全部未退休本连接 data（不论其缓冲位置先后）——真实 FIFO 冲刷只需超过「比该控制更老的 data」即可冲刷该控制，故本规则**只会欠释放、不会过释放**（相对本连接字节的真值）；欠释放方向 = 额度偏高计 = 提前耗尽 = 安全侧。
- **对外部积压乐观（G3b 锚钦定）**：当无本连接 data 在场时，下降归因于本连接控制（③→④）——若该下降实际冲刷的是外部积压字节，则被释放的控制额度可能仍未冲刷。此乐观性是 G3b 红灯锚的强制读法（预置外部电平 17,502 内含待发控制帧 16,477，下降 16,477 必须释放额度否则锚红），过释放上界 = 控制账面余额 ≤ quota，登记于 §14.6。
- **对跨窗口 ③④ 残留候选乐观（NC-5 枚举）**：退休候选是生命周期账而额度是窗口账——窗口起点既存的 ③④ 控制候选被本窗口下降退休时，释放不对应本窗口自有控制的冲刷证据；界链 R_xw ≤ C_prev、未冲刷自有控制 ≤ quota + R_xw ≤ 2×quota（最坏）、恒动面 C_prev ≈ 0、可选收紧变体（enterPause 清零 ③）——全文见 §14.6 第三类。
- **能力假设**：(i) 吸收归因 FIFO（A12 既有）；(ii) 本连接是 transport 的唯一写入者（生产 socket：仅本连接 send；hub/peer 各自持有独立 transport——`emitRaw` 单点，hub-connection.ts:137-144 / peer-connection.ts:204-211），外部增量仅来自测试 wire 的预置/置压；(iii) 观察间隙的净 Δ 语义（吸收+冲刷同隙净 0 → 不归因 → 保守，A12 既有）。

---

## §4. 控制保留额度重设计（S3/S5；G3a/G3b/G7/G8/G9）

### 4.1 字段与缺省（Scope 5；G7a/G7b）

`ReplicationLimits`：`controlReserveBytes: number // 64 KiB` **删除**，替换为：

```ts
readonly maxQueuedControlBytes: number; // 8 MiB——控制帧独立保留额度（协议 §17：未冲刷控制字节口径）；
                                        // 必须 ≥ maxBootstrapBytes + 协议开销（validate 启动期响亮验证）；
                                        // 耗尽 = CONNECTION_BACKPRESSURE（close 1011）
```

`DEFAULT_REPLICATION_LIMITS`：`controlReserveBytes: 64 * 1024` → `maxQueuedControlBytes: 8 * 1024 * 1024`。`resolveLimits` spread 自动生效；缺省物不再含旧键（G7b 双断言：`resolveLimits(undefined)` 与 `DEFAULT_REPLICATION_LIMITS` 上 `controlReserveBytes` 均 undefined）。

**帧头常量（R2/R8 修正，实测来源红灯探针）**：UPDATE 帧头 = 16,443 − 16,384 = **59B**；BOOTSTRAP 帧头 = 16,477 − 16,384 = **93B**（BOOTSTRAP 多出 replicationId 32B + epoch ≈2B）。v1 的「≈293B」为算术错误，已废止。

### 4.2 账本口径：暂停窗口内累计交接、冲刷即释放（G3b）；控制两侧台账均窗口内登记（R11 批准形状）

```ts
/** 出站帧回报（OutboundQueue onEmitted 单点；frame-io.ts:166 同步逐帧回调）。 */
onEmitted(info: Readonly<{ kind: 'control' | 'data'; byteLength: number }>): void {
  if (this.tornDown) return;                                    // 收口路径直发 ERROR 的回报零记账（§13.4）
  if (info.kind === 'control') {
    if (this.paused) {                                                    // R11：控制两侧台账均仅暂停窗口登记
      this.handoffQueue.push({ kind: 'control', bytes: info.byteLength }); // 压力侧 P2（窗口内）
      this.controlPendingHandoff += info.byteLength;
      this.controlUnflushed += info.byteLength;                           // 策略侧：窗口内累计
    }                                                                     // 非暂停控制：不入任何台账（§4.4 暴露界）
  } else {
    this.handoffQueue.push({ kind: 'data', bytes: info.byteLength });    // 压力侧 P2（data 恒计）
    this.pendingDataHandoff += info.byteLength;
  }
}

private enterPause(): void {
  if (this.paused) return;
  this.paused = true;
  this.controlUnflushed = 0;   // 暂停窗口起点（新窗口从 0 计；D3c 探针 ACK 语义依赖此重置）
  this.armPoll();
}

private resume(): void {
  if (!this.paused) return;
  this.paused = false;
  this.controlUnflushed = 0;   // 窗口关闭（resume ⇔ 观察值已 ≤ lowWater，缓冲基本排空）
  this.clearPoll();
  this.requestDrain();
}
```

与旧口径（`controlReserveUsed` 全窗口累计、永不随冲刷核减）的本质差异：**`observe()` 的 Δ<0 在窗口内随时释放额度**（G3b：socket 全冲刷后第二帧放行、零 1011）。

### 4.3 判据：首过限帧不上线 + 恰一次（G3a 锚保持）

```ts
sendControl(message: ReplicationMessage): number {
  this.observeWater();                       // 观察 + 对账 + 迟滞（enterPause 内含窗口重置）
  if (this.paused) {                          // 判据窗口：见 §4.4 协议读法与取舍
    const frameBytes = this.measureFrame(message);
    if (this.controlUnflushed + frameBytes > this.host.limits.maxQueuedControlBytes) {
      this.host.onBackpressureExhausted();   // CONNECTION_BACKPRESSURE → best-effort ERROR + close(1011)
      return 0;                               // 触发帧不上 wire；谓词形状与 R2-4 钉死一致（首越界帧）
    }
  }
  return this.host.emitControl(message);     // 控制帧不受水位闸门阻塞（§17「control 高优先级」，既有）
}
```

hub/peer 宿主的 `onBackpressureExhausted` 接线**零改动**（hub：`connectionFatal('CONNECTION_BACKPRESSURE', 1011)`，hub-connection.ts:153 + §13.4 收口 ERROR 直发豁免 + `transport.close(1011,'protocol-error')`；peer：`failConnectionBackpressure()` → ERROR + `close(1011,'control-backpressure')` + backoff 非 blocked，peer-connection.ts:571-593）。G9 的失败输出（`{code:1011, reason:'protocol-error'}`）正是这条既有接线在缺省 64KiB 下的**误杀**——修额度后零触发，接线本身保持并被 G3a/G9 双向锁定。

### 4.4 「判据仅暂停窗口生效」的协议读法与取舍（供 SA2 攻击的判断点；R4 界修正）

协议 §17 只说「额度按 socket 缓冲内未冲刷控制字节计，耗尽为 1011」，未显式限定窗口。两种读法：

| 读法 | 语义 | 后果 |
|---|---|---|
| A. 无条件判据（非暂停也检查） | 全生命周期未冲刷控制台账 | **Δ≡0 恒读数面假杀**（R10 口径：恒 0 缺面 / write-through-0 / 冻结非 0 读数全类命中——见 §14.4）：`bufferedAmount` 读数永不移动 → 永无 Δ<0 → 台账只增不减 → 8 MiB 累计后对完全健康（或仅测试冻结）的连接误发 1011；与协议「缺面 = 水位退化为不可观察」的 dormant 语义冲突 |
| **B. 暂停窗口判据（本设计）** | 窗口内未冲刷控制台账（窗口起点重置、窗口内冲刷即释放） | 非暂停期控制不受额度检查——但非暂停 ⇔ 观察值 ≤ highWater（socket 在排水）；越界后**下一次 `sendControl` 自带的 `observeWater` 立即入窗**。恒 0 读数面（Δ≡0 且读数为 0 的子类，§14.4 细分——缺面/write-through-0）：永不暂停 → 永不检查 → 控制照流（dormant 语义一致，与现状零漂移）；冻结非 0 读数面属另一子类（入暂停窗口、额度判据活跃） |

选 **B**。**非暂停期控制发射的诚实暴露界（R4 修订 + R11 裁定收窄措辞）**：非暂停控制帧对**两套判据**均不可见——(i) 额度判据不生效（未暂停）；(ii) 压力桥不登记（R11）。暴露界：**单同步栈内免检且不入账，上界 = 该栈产生的控制字节总量**（栈内无界；实践上受 socket 排纳速率 × 栈时长约束——一个栈能产出的字节最终都要过同一个 socket，排纳速率是物理上限）；**跨栈：控制字节一旦被吸收（观察值上升）即进入 `lastObservedBuffered`，协议公式与本项目账本同时计及**——吸收前的窗口即协议自身的观察滞后盲区（协议公式 queued+bufferedAmount 对未吸收交接字节同样不可见，本设计只是不比协议更严也不比协议更松）；栈末首个观察点若见 buffered > highWater 即入暂停窗口，此后控制帧同时受额度判据与压力桥约束（收口）。该盲区与 v2/v3「恒计封盲区」的取舍依据见 §12.7（恒计的等额永久残差与既有 R1-1 协议公式边界锚不可共存）。SA2 T4 按所选语义钉死：「栈内全放行（控制不入账）+ 栈末观察点入窗收口」（§12.5）。

---

## §5. admission 重设计：`tryEmitData`（S1；G1/G2a/G2b/G2c）

```ts
tryEmitData(message: ReplicationMessage): number {
  if (!this.host.isEmitAllowed()) return 0;
  if (!this.dataGateOpen()) return 0;            // 观察 + 迟滞（不变；暂停期 data 恒拒）
  const frameBytes = this.measureFrame(message);
  const cap = this.host.limits.maxQueuedBytesPerConnection;
  if (frameBytes > cap) return 0;                 // 既有单帧守卫（G2c 锚，保持）
  // 严格接纳：P3 + P2（data 恒计；control 仅暂停窗口，R11）+ P1 + 本帧 ≤ cap（G2a 恰值放行 ⇔ 判 ≤）。
  // controlUnflushed 不计入（R3）：已吸收控制字节已在观察值内。
  // controlPendingHandoff 在此处（!paused 可达）= 上一暂停窗口的未释放残留（恒 ≥ 0、≤ quota，保守方向）。
  const projected =
    this.observe() + this.pendingDataHandoff + this.controlPendingHandoff
    + this.totalQueuedBytes() + frameBytes;
  if (projected > cap) return 0;
  return this.host.emitData(message);            // onEmitted → pendingDataHandoff += frameBytes（P2 起计）
}
```

- **G1**：buffered 恒 0（滞后）→ Δ 恒 0 → `pendingDataHandoff` 逐帧累积、每帧恰一次 → 放行 `floor(cap/frameBytes)` = 3 帧、wire = 49,329B ≤ 65,536B、零 1011（拒纳 ≠ 耗尽）。
- **G2a**：cap = 3×16,443 = 49,329；第 3 帧 projected 恰 = 49,329 ≤ cap → 放行；第 4 帧 65,772 > cap → 拒纳。`wireDataBytes = cap`（恰值）。
- **G2b**：cap = 49,328；第 3 帧 49,329 > 49,328 → 拒纳（首帧越界语义 = 第 3 帧起拒）。
- **G2c**：单帧 > cap → 守卫拒纳（0 帧放行）——锚保持。
- 拒纳返回 0 的**下游显影已在 PR #165 落定且不动**：`UpdateChannel.sendAndRegister` 收到 `seq ≤ 0` → `discardQueued() + needsResync = true + declareLocalResync()`（update-channel.ts:160-166）——即协议「拒纳该帧并同批丢弃该 ns 幸存排队帧，以 needs-resync 声明显影（不静默吞、不静默纳）」的直发路径实现。

---

## §6. shed 重设计：`onDataQueued`/`enforceConnectionCap`（S4/S6；G4/G4b/G5）

```ts
onDataQueued(namespaceId: string): void {
  if (this.tornDown) return;
  if (!this.wheel.includes(namespaceId)) this.wheel.push(namespaceId);
  this.enforceConnectionCap();
}

private enforceConnectionCap(): void {
  const cap = this.host.limits.maxQueuedBytesPerConnection;
  this.observe();                                                     // 决策点先观察（I-2）
  if (this.lastObservedBuffered + this.pendingDataHandoff
      + this.controlPendingHandoff + this.totalQueuedBytes() <= cap) {
    return;                                                           // 触发：严格大于（I-3；恰好 cap 不触发）
  }                                                                   // R3：controlUnflushed 不在触发项（消双计假 shed）
  // 恢复目标 = queued 侧 ≤ lowWater（协议 §17「整队丢弃至 queued 侧 ≤ low-water」；
  // S4 修正：触发后不止步于 cap——即便中途总压已回落也要清到 lowWater）
  while (this.totalQueuedBytes() > this.host.limits.lowWater) {
    const victim = this.pickVictim();          // 最大 queued 优先；并列取 wheel 序先者（不变，确定性）
    if (victim === undefined) break;           // 无可弃（socket 侧压力 → 水位暂停/1011 承接域）
    const facet = this.host.facetOf(victim);
    if (facet === undefined || facet.queuedBytes() === 0) break;
    facet.discardForConnectionPressure();      // §10.2 同构：丢全部未发送 + needs-resync + 声明（facet 契约）
    if (facet.queuedBytes() > 0) break;        // facet 契约防御：discard 后未清零即停（防活锁）
    this.removeFromWheel(victim);
  }
}
```

**严格接纳的入队路径**（S6/G5）：通道「先入队再通知」（现实现顺序，红灯测试注释同）→ 越限 incoming 已在队列内 → 触发 shed-to-lowWater → 该 ns 成为 victim 时**同批丢弃**（incoming + 幸存帧一起清空）+ `discardForConnectionPressure` 内置 needs-resync 声明显影。G5 走查：37KiB+24KiB=62,464 ≤ cap 不触发（前置成立）→ push 12KiB → 总 queued 74,752 > cap → 触发 → victim NS_A(37,888) 弃 → 36,864 > lowWater → victim NS_B 弃 → 0 ≤ 1,024 停；两 ns 全空、零 1011。G4 走查：queued payload 40,960+25,600 = 66,560 > cap 65,536 → [NS_A, NS_B] 依序整队丢弃，discardLog 顺序 = 最大优先。G4b（锚）：72,480 > cap 触发后只弃 NS_A，幸存 800 ≤ lowWater=1,024 → NS_B 保留、log=[NS_A]。

---

## §7. 水位观察与 poll 公式（S2；G6a/G6b）

```ts
// 构造期：
this.pollIntervalMs = Math.max(1, Math.floor(host.ackTimeoutMs / 100));  // 协议 §17 权威公式

private observeWater(): void {
  const level = this.observe();                                  // 迟滞判定前先对账（G3b 冲刷释放的观察点之一）
  if (level > this.host.limits.highWater) { this.enterPause(); return; }
  if (this.paused && level <= this.host.limits.lowWater) { this.resume(); }
}

private armPoll(): void {
  if (this.pollHandle !== undefined) return;
  this.pollHandle = this.host.timer.setTimeout(() => {
    this.pollHandle = undefined;
    if (this.tornDown || !this.paused) return;                   // stale fire：零副作用、不重武装（不变）
    const level = this.observe();                                // poll 也是对账点（冲刷释放）
    if (level > this.host.limits.lowWater) { this.armPoll(); return; }
    this.resume();
  }, this.pollIntervalMs);                                        // ← 唯一改动：1000ms 常量 → 公式值
}
```

- **删除导出常量 `BACKPRESSURE_POLL_INTERVAL_MS`**（间隔随连接配置派生后，模块级常量语义死亡；保留只会误导。唯一消费方是测试，§11 迁移）。
- `ConnectionSenderHost` 新增必填 `readonly ackTimeoutMs: number`（红灯接口提示钦定的 flat 形态；`ResolvedTimeouts.ackTimeoutMs` 已由 `validateTimeouts` 保证正有限安全整数——无运行时 clamp）。
- G6a：`ackTimeoutMs=5000` → 50ms；advanceBy(49) 未恢复、+1ms 恢复 drain。G6b：`ackTimeoutMs=1` → `max(1,0)=1ms`。
- 缺省（10s）→ 100ms：比旧 1000ms 快 10×。对既有 gated-wire 套件的兼容性逐用例论证见 §12.3——所有「暂停窗口内零派发」断言的用例里 poll 触发时观察值仍 > lowWater（re-arm，不恢复），无一误恢复。

---

## §8. 启动验证（G7c/G7d）

`validate.ts`：`positiveSafeInteger(limits.controlReserveBytes, ...)` 删除，替换为：

```ts
positiveSafeInteger(limits.maxQueuedControlBytes, 'maxQueuedControlBytes');
// ...
assertCollKind(
  limits.maxQueuedControlBytes >= limits.maxBootstrapBytes + PROTOCOL_OVERHEAD_BYTES,
  'limits',
  `maxQueuedControlBytes(${limits.maxQueuedControlBytes}) 必须 ≥ maxBootstrapBytes(${limits.maxBootstrapBytes}) + ${PROTOCOL_OVERHEAD_BYTES}`,
);
```

- `PROTOCOL_OVERHEAD_BYTES = 128`（validate.ts:14 既有冻结值；红灯测试 L62 同值声明「validate.ts 同值 128」）。
- G7c：64KiB < 64KiB+128 → TypeError ✓；G7d：恰值 64KiB+128 合法、缺省组合（8MiB ≥ 4MiB+128）合法 ✓。
- 协议 §17 验证块的其余项已全部在位（maxBootstrap/SyncDiff/Update ≤ maxFrameBytes−128、maxQueuedUpdateBytes ≥ maxUpdateBytes、maxInFlightUpdates ≥ 1、lowWater < highWater、highWater ≤ maxQueuedBytesPerConnection、timeout 正有限）——不动。
- 调用点既有：`createHubReplication`（hub-connection.ts:61-63）/ `createPeerReplication`（peer-connection.ts:71-74）构造期对合并结果校验——零改动。

---

## §9. 宿主接线（生产两处，各 1 行）

```ts
// hub-connection.ts:145-154（ConnectionSender 构造）
this.sender = new ConnectionSender({
  limits: hub.limits,
  timer: hub.timer,
  ackTimeoutMs: hub.timeouts.ackTimeoutMs,        // ← 新增 1 行
  readBufferedAmount: () => this.readBufferedAmount(),
  ...
});

// peer-connection.ts:215-224（dialNow 内 ConnectionSender 构造）
this.sender = new ConnectionSender({
  limits: this.limits,
  timer: this.options.timer,
  ackTimeoutMs: this.timeouts.ackTimeoutMs,       // ← 新增 1 行（this.timeouts 字段在位，peer-connection.ts:41/78）
  ...
});
```

每连接一个 sender、随 transport 生命周期、重拨时旧 sender teardown 后新建（peer-connection.ts:212-215 既有）——**台账天然随连接重置**（FIFO 队列/策略账本/基线都是连接私有状态），无需跨代清理。

---

## §10. 明确不动面（契约保持）

| 不动 | 理由 |
|---|---|
| `DataSenderFacet` 接口（queuedBytes/queuedCount/pullAndSendOne/discardForConnectionPressure） | PR #162 单数据面（Scope 8）；facet 契约完全覆盖本设计需要 |
| `OutboundQueue`（frame-io.ts） | 序列纪律/控制优先/onEmitted 单点回报（:166）已满足记账需要；零改动 |
| `UpdateChannel`（update-channel.ts） | 直发路径严格接纳 + F4 消费即进展 + 溢出判据（§17 每 ns 限制）均已在 PR #165 落定 |
| `hub-namespace.ts` / `peer-namespace.ts` 的 sendFacet 与声明拓扑 | `discardForConnectionPressure` → live: declareHubResync/declareLocalResync、非 live: pendingResync（hub:102-114 / peer:103-115）即协议「needs-resync 声明显影」 |
| drain 轮转（wheel/cursor/DRAIN_TURN_LIMIT/帧间水位复查） | 公平性/无饥饿面（AC5-RR 锚）——本设计零触碰 |
| `teardown()` 拓扑与全部调用点 | 仅在复位清单里追加新台账字段 |
| 1011 收口链路（hub connectionFatal / peer failConnectionBackpressure + ERROR 直发豁免） | 既有接线正确，G9 红的是缺省额度不是接线 |

---

## §11. 既有测试影响面与迁移配方（SA6 owned；ALLOW LIST 依据；R1/R2/R7 修订）

字段迁移是**编译期破坏**（`Partial<ReplicationLimits>` 对象字面量携带 `controlReserveBytes` → excess property 报错；`as ResolvedLimits` cast 对象缺新键 → **编译器不报错但运行时读 undefined** → 额度判据 `number > undefined = NaN 比较恒假` 静默失效——R1 指出的 NaN 静默面）+ **缺省行为变更**（64KiB → 8MiB）。全仓 grep 证实 `ReplicationLimits`/`resolveLimits` 在 `packages/ws-replication` 之外**零消费**（apps/ 无引用）——爆炸半径封闭在本包。**受影响测试文件共 8 个**（v1 漏计 1 个，R1 修正）。

### 11.0 审计 grep 如实转录（R1 要求；2026-08-29 于 worktree 重跑，verbatim）

```text
$ git grep -n "new ConnectionSender(" -- 'packages/**/*.ts'
packages/ws-replication/src/hub-connection.ts:145:    this.sender = new ConnectionSender({
packages/ws-replication/src/peer-connection.ts:215:    this.sender = new ConnectionSender({
packages/ws-replication/test/ws-replication-review-revisions-r1-r7-red.test.ts:509:    sender = new ConnectionSender({
packages/ws-replication/test/ws-replication-sa7-hardening-dynamic.test.ts:473:  sender = new ConnectionSender({
packages/ws-replication/test/ws-replication-sa7-round2-dynamic.test.ts:722:    sender = new ConnectionSender({
（5 处构造点：生产 2 + 测试直构 3——v1 只记录 4 处、漏 sa7-hardening:473，R1 属实）

$ git grep -n "BACKPRESSURE_POLL_INTERVAL_MS" -- 'packages/**/*.ts'
packages/ws-replication/src/backpressure.ts:55:export const BACKPRESSURE_POLL_INTERVAL_MS = 1_000;
packages/ws-replication/src/backpressure.ts:209:    }, BACKPRESSURE_POLL_INTERVAL_MS);
packages/ws-replication/test/ws-replication-sa7-round2-dynamic.test.ts:29:import { BACKPRESSURE_POLL_INTERVAL_MS, ConnectionSender, type DataSenderFacet } from '../src/backpressure.js';
packages/ws-replication/test/ws-replication-sa7-round2-dynamic.test.ts:741:    await scheduler.advanceBy(BACKPRESSURE_POLL_INTERVAL_MS);
（生产消费点 = 自用 :209，随重写消亡；测试消费 = sa7-round2 一处 import + 一处使用）

$ git grep -rn "ReplicationLimits\|resolveLimits\|DEFAULT_REPLICATION_LIMITS" -- 'apps/**/*.ts' 'apps/**/*.tsx' 'packages/**' | grep -v "packages/ws-replication"
（空输出——零外部消费）
```

（`controlReserveBytes` 的完整 grep 命中见 §17 C1 行：src 4 文件 + 测试 7 文件，与本节迁移清单一一对应。）

### 11.1 逐文件迁移配方（8 文件）

| # | 文件 | 现状 | 迁移配方 | 预估 |
|---|---|---|---|---|
| 1 | `test/harness.ts`（:53 接口镜像 / :138 `CONTRACT_LIMITS`） | `controlReserveBytes: 64*1024` | 字段改名 + 值 `8 * 1024 * 1024`（镜像立意=与包 DEFAULT 逐值一致；无运行时断言消费，grep 证实） | 2 行 |
| 2 | `test/ws-replication-api.test-d.ts`（:135 类型 pin） | pin 旧字段 | pin 换 `maxQueuedControlBytes: number` | 1 行 |
| 3 | `test/ws-replication-issue137-r2-red.test.ts` R2-4 独立性（:390 `controlReserveBytes: 64_000`） | 覆写旧字段 | → `maxQueuedControlBytes: 64_000` + `maxBootstrapBytes: 63_872`（64,000 ≥ 63,872+128 恰值；用例文档为小 {n} 根，63,872 足够容纳 bootstrap snapshot） | 2 行 |
| 4 | 同文件 R2-4 生效（:437 `controlReserveBytes: 1_500`） | 同上 | → `maxQueuedControlBytes: 1_500` + `maxBootstrapBytes: 1_372`（1,500 ≥ 1,372+128 恰值；snapshot 极小可容纳；断言 `expect(ackBytes*K).toBeGreaterThan(1_500)` 等不动） | 2 行 |
| 5 | `test/ws-replication-sa7-issue137-dynamic.test.ts` D3a（:264 `controlReserveBytes: 1`） | 极端 1B 额度 | **（R9 重写；v2 的 `maxBootstrapBytes: 1` 废止——mb 必须大于种子 snapshot payload，mb=1 会击穿 boot 期 codec 尺寸门（BOOTSTRAP_TOO_LARGE），bootMulti 的 settleUntil(live) 永不满足）**。**D3 族共用配方（#5/#7 同遵）**：(a) `maxBootstrapBytes: 512`（安全值，∈R9 钦定 [512,4096]——种子文档为 {n} 根，yjs snapshot payload 实测量级数十字节，512 有一个数量级裕度；#3/#4/#6 的 mb 亦已满足同一纪律）；(b) `maxQueuedControlBytes: 640`（= mb+128 恰值合法，G7d 同构）；(c) **boot-before-pressure 前置断言**：置压前显式 `expect(peer.getNamespaceState(nsId)).toBe('live')`（bootMulti 的 settleUntil(live) 升格为断言）——保证 boot 期控制帧（OPEN_OK/SYNC/BOOTSTRAP）全部落在暂停窗口**之外**（窗口起点重置使它们不占额度，§4.2）；(d) **mb 下界探针断言**：从 wire 日志取 boot 期 BOOTSTRAP_SNAPSHOT 的 `snapshot.byteLength`，`expect(...).toBeLessThan(512)`——把「安全值覆盖种子 snapshot」的假设变为受测前置（yjs 膨胀越界即响亮失败，而非误判耗尽语义）。**驱动形态（R9 明确）**：置压 → 探针实测 ackBytes（D3c 既有探针模式）→ `allowed = floor(640/ackBytes)`（实测 ≈11：11×57=627 ≤ 640、12×57=684 > 640）→ **连续 allowed+1 笔写**（`for n` 循环逐笔 settle）：前 allowed 笔的 ACK 依序放行（窗口额度 57→…→627），**第 allowed+1 笔的 ACK 为首个越界帧**（627+57=684 > 640）触发耗尽且不上 wire。断言组：暂停段 wire 上**恰 allowed 个 UPDATE_ACK** + ERROR×1(CONNECTION_BACKPRESSURE，无 namespaceId) + close(1011) + backoff 非 blocked + 撤压重连恢复（主锚不变） | ~8 行 |
| 6 | 同文件 D3b（:318 缺省 64KiB 大控制帧自杀） | **断言反转面**：缺省 8MiB 后 90KB BOOTSTRAP 不再耗尽 | **（R2 重写）结构性事实先行**：尺寸门查 payload（P ≤ maxBootstrapBytes=mb）、额度查编码帧长 F = P + **93**（§4.1 帧头常量，红灯 G3b 探针实测 16,477−16,384）；启动约束 quota ≥ mb + 128 ⟹ 单帧合法 BOOTSTRAP 恒有 F = P+93 ≤ mb+93 < mb+128 ≤ quota——**「单帧合法 BOOTSTRAP 自杀」在修复后结构性不可达（可行区间为空集）**，此公式应固化为独立断言用例（SA2 T2 后半）。**主配方（双 ns 双帧耗尽，无探针依赖）**：改用 bootMulti 双 ns、各 ~90KB blurb（payload P ≈ 90.2KiB）；`maxBootstrapBytes: 96*1024`（mb=98,304 ≥ P 宽裕）、`maxQueuedControlBytes: 98_432`（= mb+128 恰值）。暂停窗口内帧1 = P+93 ≈ 90.3KiB ≤ 98,432 → 放行；帧2 累计 2(P+93) ≈ 180.6KiB > 98,432（⟺ P > 49,123，90KB blurb 恒满足，无边界耦合）→ 耗尽。断言组（与旧意图逐语义对应）：wire 上**恰 1 帧 BOOTSTRAP** + ERROR×1(CONNECTION_BACKPRESSURE) + close(1011) + backoff 非 blocked + 撤压重连后两 ns live + 大文档收敛。**备选（SA2 选项 c）**：改写为 G8/G9 同款「缺省不误杀」+ 保留结构性不可达公式用例——二选一，推荐主配方（保住额度耗尽路径覆盖） | ~8 行 |
| 7 | 同文件 D3c（:372 `controlReserveBytes: 100`） | 谓词帧数锚 | **（R9 重写；v2 的 `maxBootstrapBytes: 1` 废止，理由同 #5）**：套用 #5 的 D3 族共用配方——`maxBootstrapBytes: 512, maxQueuedControlBytes: 640`（恰值）+ boot-before-pressure 前置断言 + mb 下界探针断言（D3c 的探针写本就在置压前，天然满足 boot-before-pressure，仅需显式化断言）；测试内 `allowed` 常量 100 → `floor(640/ackBytes)`（探针实测，≈11），断言结构零改动（探针写/置压/连续 allowed+1 写/计数/恢复全同形——v2 后 `allowed` 恒 ≥ 2，消除了 129/57≈2 靠近 1 的边界脆弱性） | 3 行 |
| 8 | `test/ws-replication-review-revisions-r1-r7-red.test.ts`（QUEUE_LIMITS :457-469 + R2-A2a 宿主 :509） | `controlReserveBytes: 32*1024` + `maxBootstrapBytes: 1<<20`（违反新约束）；宿主字面量无 `ackTimeoutMs`（**R7：v1 §11 漏配而 §17 C2 已列，口径不一致**） | 三处：(a) `maxBootstrapBytes: 16 * 1024`（R2-A2a 快照 8KiB ≤ 16KiB ✓）+ 字段改名 32KiB（≥ 16KiB+128 ✓）——R2-A2a 放行数不变：floor(32,768/8,245)=3、第 4 帧触发（恒定 buffered 下压力侧 FIFO 弹出与策略侧不释放并存，逐帧同数，§12.2 走查）；(b) **host 增 `ackTimeoutMs: 10_000`**（与 §17 C2 行对齐）；(c) cast 防线：QUEUE_LIMITS 改经 `resolveLimits({...})` 构造（cast 不再遮缺键）或加 `Number.isFinite(...maxQueuedControlBytes)` 断言（SA2 T1）。R1/R3 断言零改动 | 3 行 |
| 9 | `test/ws-replication-sa7-round2-dynamic.test.ts` D4（:687-699 limits / :722 host / :741 poll 常量） | 三处旧面 | limits 同 #8(a) 配方（`maxBootstrapBytes: 16*1024` + 改名）；host 增 `ackTimeoutMs: 10_000`；`import { BACKPRESSURE_POLL_INTERVAL_MS }` 删除、`advanceBy(BACKPRESSURE_POLL_INTERVAL_MS)` → `advanceBy(100)`（= max(1, floor(10_000/100))，D4 恢复 drain 断言不变） | 3 行 |
| 10 | `test/ws-replication-sa7-hardening-dynamic.test.ts`（**R1 补：v1 全文件遗漏**；QUEUE_LIMITS :424-435 `as ResolvedLimits` cast 本就缺 `controlReserveBytes` + senderHarness 宿主 :473 无 `ackTimeoutMs` 且无 cast） | C2 落地即 typecheck 红（:473 缺必填成员）；且若只做「补 ackTimeoutMs」最小修补，QUEUE_LIMITS cast 继续遮缺 `maxQueuedControlBytes` → `sendControl` 额度判据读 undefined → NaN 比较恒假 → **额度检查在该 harness 内静默失效**（R1 指出的静默失败面） | (a) host 增 `ackTimeoutMs: 10_000`（:473；D2/D3 语义与 poll 无关——`readBufferedAmount: () => 0` 恒不暂停，额度判据与 poll 均不可达，值语义安全）；(b) QUEUE_LIMITS 增 `maxQueuedControlBytes: 8 * 1024 * 1024`（或改经 `resolveLimits` 构造）+ `Number.isFinite` 防线断言（SA2 T1）；行为零变化——D2（控制序不受 data 污染）/D3（round-robin 有界整轮扫描）不触额度与 poll 路径（已核对 :517-550 断言面：纯派发序/轮转，cap 8MiB 无 shed、恒 0 观察永不暂停） | 3 行 |
| 11 | `test/ws-replication-sa7-r2-transport.test.ts` 用例 B（真实 TCP，403-431） | **断言依赖缺省 64KiB 耗尽**（1280 ACK ≈73KiB） | 缺省变 8MiB 后 73KiB 不再耗尽：显式 `limits: { maxBootstrapBytes: 64 * 1024, maxQueuedControlBytes: 64 * 1024 + 128 }`（bootReal 的 ns 文档极小，64KiB bootstrap 上限可容纳）→ 耗尽点 ≈ floor(65,664/ackBytes) ≈ 旧预测 ~1150 同量级；用例 A（缺省额度内 7.3KiB 全放行）零改动天然绿。**注意**：新冲刷释放语义下，真实 socket 的 writableLength 在完全塞死（TCP 窗归零）前可能有瞬降 → 每次瞬降释放额度 → 耗尽延后；enterRealPause 已等积压 >512KiB（过饱和信号）后 writableLength 近似单调，与旧累计口径等效；若 CI 观测到漂移，加 topUp 维持饱和（SA6 校准域，见 §14.3） | ~3 行 |

其余既有套件**零改动**（兼容性论证 §12）：fairness/no-starvation（ac5-live、AC5-RR/PRI）、bounded-memory（sa6-hardening g1/g2——数据量级 ≪ 8MiB）、水位/shed（AC5-WATER/SHED、A1/A2/A7）、R1 严格接纳三连（review-revisions R1-1/2/3）、真实 TCP 用例 A、sa7-hardening D2/D3（经 #10 迁移后行为零变化）。

---

## §12. 走查验证

### 12.1 红灯逐条转绿

| 用例 | 新设计走查（关键数） | 结论 |
|---|---|---|
| G1 | cap 65,536 / 帧长 16,443（真实 codec 探针，测试自校验）；buffered 恒 0 → Δ 恒 0 → `pendingDataHandoff` 0→16,443→32,886→49,329；第 4 帧 65,772 > cap 拒。放行 3 = floor(65,536/16,443)；wire 49,329 ≤ cap；exhausted 0 | ✅ |
| G2a | cap=49,329；3 帧后 P2=49,329；第 4 帧 projected=65,772>cap 拒；`≤` 判据使第 3 帧恰值放行，wire=cap | ✅ |
| G2b | cap=49,328；第 3 帧 49,329>cap 拒；放行 2 | ✅ |
| G2c | 单帧守卫先拒（锚） | ✅ 保持 |
| G3a | buffered 8,193 > 8,192 → sendControl#1 入窗（策略账 reset 0）→ 16,477 ≤ 32,768 放行 → 策略账 16,477（压力侧同额入 FIFO）；#2 Δ=0（恒 8,193）→ 16,477+16,477=32,954 > 32,768 → exhausted ×1、触发帧不上线 | ✅ 保持 |
| G3b | #1 后策略账 16,477；setBuffered(1,025) → #2 的 observe：Δ=−16,477 → 退休账本：①② data 候选 = 0 → ③ 已吸收控制 = 0 → ④ handoff 控制 16,477 全退休 → 额度释放 16,477（策略账 → 0；压力侧 controlPendingHandoff 同步归零）；1,025 > lowWater 1,024 仍暂停；0+16,477 ≤ 32,768 放行；exhausted 0（外部积压归因读法 = 本锚钦定，§3.5/§14.6） | ✅ |
| G4 | cap=65,536（64KiB）；queued payload 合计 40,960+25,600=66,560 > cap 触发 → shed 循环：victim NS_A（40,960 最大）弃 → 25,600 > lowWater 1,024 → victim NS_B 弃 → 0 ≤ 1,024 停；log=[NS_A,NS_B]；两 ns 空 | ✅ |
| G4b | 触发 72,480 > cap → victim NS_A → 800 ≤ 1,024 停；NS_B 幸存；log=[NS_A]（锚） | ✅ 保持 |
| G5 | 前置 37,888+24,576=62,464 ≤ cap 不触发 ✓；push 12,288 后总 queued 74,752 > cap → victim NS_A → 36,864 > 1,024 → victim NS_B → 0；b.items=0、a.items=0、exhausted 0 | ✅ |
| G6a | pollInterval = max(1,floor(5,000/100))=50；advanceBy(49) 未火；+1 火速 observe（buffered 1,024 ≤ 1,024）→ resume → drain → pullAndSendOne → tryEmitData：projected = 1,024+0+0+0+16,443 ≤ cap 放行；emitted 1 | ✅ |
| G6b | max(1,floor(1/100))=1ms；advanceBy(1) 恢复 | ✅ |
| G7a/b | DEFAULT/resolveLimits(undefined) 携带 `maxQueuedControlBytes: 8MiB`、无 `controlReserveBytes` | ✅ |
| G7c | 65,536 < 65,536+128 → assertCollKind TypeError | ✅ |
| G7d | 恰值 65,664 ≥ 65,664 ✓；缺省 8,388,608 ≥ 4,194,432+128 ✓（锚） | ✅ 保持 |
| G8 | 缺省：buffered 524,289 > 524,288 入窗（策略账 0）→ 100KiB BOOTSTRAP（帧 ≈ payload+93 ≈ 102.6KB）≪ 8MiB 放行；exhausted 0 | ✅ |
| G9 | hub wire buffered 恒 524,289：HELLO_ACK 入窗 → 后续 OPEN_OK/SYNC/BOOTSTRAP 策略账累计 ≪ 8MiB、Δ=0 无释放也无妨 → 零耗尽、零 close、BOOTSTRAP 上 wire、peer live | ✅ |

### 12.2 直构类既有测试（同步反射 wire：R2-A2a / D4）

R2-A2a：wire 的 buffered=Σheld（发出即持有、同步反映）。#1 预置 17B → 观察入窗（策略账 0；FIFO 空）→ 快照 8,245B 放行 → FIFO 入 control chunk + 策略账 8,245 → held 增 → #2 观察 Δ=+8,245 → FIFO 弹出上一 control chunk（压力侧归零）→ **策略账不因 Δ>0 释放**（已吸收≠已冲刷）→ 8,245 → #2 放行 16,490 → #3 24,735 → #4 32,980 > 32,768 耗尽 ×1；pending（2B UPDATE）不被 shed（enforce 触发条件不满足）。**与旧累计口径在恒定/单调 buffered 下逐帧同数**——窗口内没有 Δ<0。D4 同形（8,193 恒定 → Δ=0 → 3 帧放行第 4 触发；迁移后 advanceBy(100)=公式间隔恢复 drain）。

### 12.3 全链路既有套件（关键：poll 提前 10× 与 P2 台账的零干扰证明）

- **P2 台账零干扰（R11 修正机理 + 实证锚）**：data-only FIFO 在 FIFO 吸收假设下残差恒 0——每次 Δ>0 恰弹出对应 data chunk（队首 = 最老未吸收 data = 该次吸收的帧），故 projected 与协议公式（buffered + queued + frame）**逐值相同**；控制侧因 R11 裁定不入桥（非暂停）或随窗口出入（暂停），均不产生跨相位残差。**实证锚 = R1-1**（cap 65,536）：第 8 帧协议公式 projected 64,808 ≤ cap 放行、第 9 帧拒纳——SA3 commit 541c3b7 实测通过；反证：v2/v3 恒计形状下同一用例 projected 64,808+789（boot 控制 chunk 残差）= 65,597 > cap → 第 8 帧误拒（§12.7）。唯一收紧点是「同一同步栈多帧无观察间隔」——这正是 G1 要修的缝隙；既有套件每次写之间都有 settle（观察点充分）。数据量级：全套件最大单 ns 数据 ≪ 8MiB cap（grep 证实 payload ≤ 8KiB、循环 ≤ 40）。
- **poll 100ms 提前**：全部「暂停窗口内零派发」断言（AC5-WATER:451 / AC5-PRI:480 / A1:664 / A2:687 / A7:814 / AC5-RR:413）在 poll 触发时 buffered 仍 > lowWater（held 未释放）→ re-arm 不恢复 → 断言不破。恢复仍可由 ACK 驱动（onAck → requestDataDrain，既有）——AC5-RR/A1 在 releaseAll 后靠 ACK 恢复，与新 poll 恢复并存且序一致（单 ns 或 RR 序均满足断言）。
- **A2-滞回（671）**：触发点从旧 Σqueued>cap（第 9 写）提前到 总压>cap（第 8 写，含 observed 8.4KiB）——结局同构：shed-to-lowWater 清空 + RESYNC 声明 + 后续写在 needsResync 首行丢弃；恢复后 updateCount=1 ≤ 2、resyncCount ≥ 1 ✓。
- **A2-1011（706）**：入队路径 shed 在更早的写数触发，held 恒 ≤ cap ✓、不 close ✓、恢复 ready ✓。
- **AC5-SHED（487）**：两 ns 交替写 → 总压触发 → 最大 victim 先弃 → RESYNC 上 wire（控制帧不受闸门阻塞）→ held ∈ (0, 64KiB]、信号 ≥ 1 ✓。
- **R1-1/R1-2/R1-3**：R1-1/R1-2 判据同旧（P2 已被 observe 释放，projected 逐值同）；R1-3 阶段 4 触发 shed-to-lowWater → RESYNC 真实出现 → 锚 (a) 从「空洞真」（无 RESYNC 时 slice 空）变为「实真」（声明后零该 ns UPDATE）——断言更强仍绿；(b)/(c) 记账非负/窗口不变量 ✓。
- **真实 TCP A（365）**：128 ACK ≈ 7.3KiB < 8MiB 缺省 → 全放行、零 ERROR、ready ✓（零改动）。
- **sa7-hardening D2/D3**（R1 补）：`readBufferedAmount: () => 0` 恒不暂停 → 额度判据/poll 均不可达；P2 台账累积量 = 用例帧量（个位数 × ~100B）≪ cap 8MiB → 派发行为逐值不变 ✓。
- **AC4/A5/A6**（ACK 超时族）：无背压面交叠，零影响。

### 12.4 R3 假 shed 场景走查（SA2 T3；v1 双计缺陷的修复证明）

场景：cap=8MiB 缺省；observed=600KiB（data 塞 jam，> highWater 512KiB → 暂停）→ `sendControl` 4MiB BOOTSTRAP：入窗策略账 0 → 4MiB+93 ≤ 8MiB 放行 → 策略账 4MiB+93、FIFO 入 control chunk → socket 吸收：observed 600KiB→4.6MiB（Δ=+4MiB → FIFO 弹出该 chunk，`controlPendingHandoff` → 0；**策略账不释放**——正确，字节未冲刷且仍暂停）→ 其他 ns 排队 2MiB → `onDataQueued` → enforce：`totalPressure = 4.6MiB(observed) + 0 + 0 + 2MiB = 6.6MiB ≤ 8MiB` → **不触发** → discardLog 空、零 RESYNC ✓（协议公式 queued+bufferedAmount = 6.6MiB ≤ cap 同判）。v1 口径（策略账计入总压）下同一场景 = 4.6 + 4 + 2 = 10.6MiB > cap → 假 shed（SA2 R3 实证的破坏性面）。**结论：R3 修复后与协议公式同判，假阳性消除。**

### 12.5 R4 非暂停控制栈语义走查（SA2 T4；R11 裁定后选定语义的钉死）

非暂停 socket（observed ≤ highWater）+ 同步栈连发 2 帧 4MiB BOOTSTRAP + 显式小 quota（满足 ≥ mb+128）：额度判据不生效（未暂停）且压力桥不登记（R11）→ **栈内 2 帧全放行、零入账**（栈内后续 data 准入不受这 8MiB 影响——盲区按 §4.4 诚实界接受：上界 = 栈控制字节总量，实践受 socket 排纳速率约束）；栈末首个观察点若 observed > highWater → 入暂停窗口，此后控制帧同时受额度判据与压力桥约束（窗口起点重置，栈内已放行帧若已被吸收则不计入新窗口——D3c 探针同款语义）。T4 按此断言：「栈内全放行（控制不入账）+ 栈末观察点入窗收口」。

### 12.6 编译/静态门禁

`pnpm run typecheck` + `pnpm exec vitest run packages/ws-replication --typecheck`：字段迁移后 §11 表内 **8 个测试文件**必须同步迁移（v1 计 7，R1 修正），否则 excess-property/缺必填成员编译错——这是设计**有意**的响亮迁移（G7b 断言旧字段从生产缺省物消失；保留旧字段兼容层会直接违反 G7b）；cast 面（sa7-hardening QUEUE_LIMITS）另经 `resolveLimits()` 化 + `Number.isFinite` 断言双防线消除 NaN 静默失效。`git diff --check` 零空白问题（常规）。

### 12.7 R11 实现期裁定：非暂停控制 P2「恒计」与既有协议公式边界锚的冲突（v4 裁定记录）

**冲突事实（SA3 commit 541c3b7 实证）**：v2/v3 设计要求非暂停控制恒入压力桥（SA2 R1 轮 R4 的可选项 (c)）。实现期发现与既有 R1-1（`ws-replication-review-revisions-r1-r7-red.test.ts`，cap=65,536，SA6 owned）的协议公式边界标定冲突：

1. **残差机理**：R1-1 的 GatedWire 在 boot 期 gate=false——控制帧（HELLO_ACK/OPEN_OK/SYNC 族，合计实测 **789B**）send 即 delivered（`queueMicrotask` 直投 peer），**不入 held** → `bufferedAmount`（=Σheld）恒 0 → Δ≡0 相位。恒计形状下这 789B 控制 chunk 滞留 FIFO；gate 置位后每个 data 帧的 Δ>0 依 FIFO 队首弹出——先弹尽 789B 控制 chunk，再弹 (L−789) 的最老 data chunk → **每个 data chunk 尾部恒留 789B 未弹** → `pendingDataHandoff` 永久 +789B（保守高估，但非零）。
2. **边界击穿**：R1-1 第 8 帧协议公式 projected = 64,808 ≤ 65,536 应放行（其「R2-N1 构造精度：8L+512 > 64KiB」的标定正是协议公式语义）；恒计形状 projected = 64,808 + 789 = **65,597 > 65,536** → 第 8 帧误拒 → 断言「8 帧派发」红。
3. **残差内在性**：任何 Δ 基释放策略都无法消除（队首/队尾弹出、按 kind 优先归属均只转移残差的载体侧，总量不变）——「P2 覆盖不可观察交接字节」+「该面在交接时不可观察」⟹ 残差 = 该相位控制字节，是恒计的固有代价。

**裁定 = 选项 (a)：控制帧仅暂停窗口内进入压力桥（批准 SA3 已落地形状）**，理由五项：

| # | 理由 | 依据 |
|---|---|---|
| 1 | **全部 17 红灯用例零依赖非暂停控制 P2**——G1/G2a/b/c/G4/G4b/G5/G6 为纯 data；G3a/G3b/G8/G9 的控制帧全部在暂停窗口内（照常入桥入额度账） | §12.1 逐条走查 |
| 2 | **R3 假 shed 修复完整保留**——T3 场景（§12.4）的控制帧在暂停窗口内交接，双账本拆分的全部收益不受裁定影响 | §12.4 |
| 3 | **既有协议公式边界锚零迁移**——选项 (b) 需把 R1-1（及同类字节级边界用例）重标定为「协议公式 + 实现残差」，将协议语义锚退化为实现细节锚，且残差随 boot 流量逐测试漂移 | R1-1 断言组 + §12.3 实证锚 |
| 4 | **SA2 R1 轮 R4 的必要项本就是 (a) 措辞修正 + (b) 诚实暴露界**——(c) 恒计原文为「推荐一并解决」的可选项；本裁定回归必要项，(c) 因与契约冲突撤回 | SA2 R1 评审 R4 修订要求原文 |
| 5 | **SA3 实现已全绿**（17 红灯转绿 + 全包 22 文件/既有 159 用例绿）——批准落地形状避免二次返工；且与协议公式「不更严也不更松」（未吸收控制 = 协议观察滞后域） | commit 541c3b7 验证结果 |

**批准的实现形状（本设计 v4 的规范口径）**：`onEmitted` control 分支整体以 `paused` 门控——暂停窗口内：入 FIFO（压力侧）+ `controlUnflushed`（策略侧）双登记；非暂停：零登记（额度免检 + 压力桥不可见，暴露界见 §4.4/§14.2）。data 分支恒入 FIFO。**盲区的补偿面**：非暂停控制一旦被吸收即入 `lastObservedBuffered`（协议公式同计）；栈末观察点越 highWater 即入窗收口；暂停窗口残留（resume 后未获 Δ 释放的部分）计入总压且 ≤ quota（保守方向）。**不需任何 SA6 断言迁移、不需 SA3 代码返工**——本节即设计对实现的追认依据。

### 12.8 R12 D1 反向回归走查：data flush 绝不释放控制额度（v5 退休账本）

**D1 场景（SA7 实际构造；数值 = SA4 R2 实测真值）**：quota = 163,840（160KiB）；控制帧长 16,477（G3b 探针值）；wire 反射发射（GatedWire 族：buffered = Σheld）。暂停窗口内：控制发射 ×9（`controlUnflushed` = 9×16,477 = 148,293；P3 时点的退休候选分拆实测：**③ `unretiredAbsorbedControl` = 94,598、④ handoff 控制 = 53,695**，合计 148,293 ✓）与 data 发射-吸收交错（`unretiredAbsorbedData` ≥ 44,963）；**P4 阶段单次 data flush，净 Δ<0 = −44,963**。（数值史：v5 初稿重构值「3×16,477/197,724」与 NC-6 转述值「61,440/13 帧/214,201」均与实测不符，SA4 R2 实测为准，两者废止。）

**v4 违反路径（SA4 R2 实测）**：P4 净下降 Δ=−44,963 经无 kind 归因规则 `controlUnflushed -= min(44,963, 148,293)` 误释放 44,963 → 窗口余额 148,293−44,963 = 103,330 → 其后可再放行 3 帧（103,330+3×16,477 = 152,761 ≤ 163,840；第 4 帧将 169,238 > quota；**n2 = 3**）→ 共 **12 帧 / 197,724 > quota 163,840（超 33,884）**，且这 12 帧控制字节仍滞留 socket 缓冲（未冲刷）——「未冲刷 control bytes 上限」被击穿（双轴 BLOCK 依据）。

**v5 修复路径（结论与实测一致：零释放）**：P4 净下降 Δ=−44,963 的退休预算先被 ① `unretiredAbsorbedData`（≥ 44,963）整额消耗 → ③④ 零退休 → **控制额度零释放**，`controlUnflushed` 保持 148,293（额度内放行的 9 帧）。**第 10 帧为首越界帧**：148,293 + 16,477 = 164,770 > 163,840 → `onBackpressureExhausted()` 恰一次 → 该帧不上 wire → best-effort ERROR(CONNECTION_BACKPRESSURE) + close(1011)。终态：wire control = 148,293 ≤ quota ✓、恰一次 CONNECTION_BACKPRESSURE ✓、1011 ✓——即 D1 反向回归的断言面（data flush 后超限控制不上 wire + 恰一次收口）。

**D1 反转分工（owner，SA4-R2 C 项）**：**SA3 实现**（commit 8da8692 落地 §3.5 退休账本与 §3.2 observe() 退休分派）＋ **SA7 复证**（`ws-replication-sa7-issue169-dynamic.test.ts` D1 安全回归用例——直构真实 ConnectionSender/OutboundQueue/codec，仅传输 bufferedAmount seam 与注入调度器；v4 形状下红、v5 形状下绿）。

**绿灯锚复核（v5 规则不破既有面）**：G3a（恒 8,193，Δ=0 → 零退休 → 第 2 帧恰一次耗尽）✓；G3b（§12.1 行：④ handoff 控制退休 → 释放，帧 2 放行零误杀）✓；G8/G9（恒读数 → Δ=0 → 零释放亦零需要）✓；D3a/D3c/D4/真实 TCP A（恒定电平或额度富余）✓；真实 TCP B（迁移 quota 64KiB+128）：ACK 相位中本连接 data 积压（480KiB 帧已吸收）优先消耗退休预算 → 额度释放比 v4 更保守（更早耗尽）→ 「≥1 ERROR + 1011」断言只会更早满足 ✓；R1-1/A2/AC5 族（enqueue/边界路径，退休账本不参与 admission）✓；T3（§12.4，Δ>0 归因，无 Δ<0）✓。

---

## §13. 边界、并发与一致性分析

1. **同步栈突发**（G1 场景）：一次栈内 N 次 tryEmitData，无观察间隔 → FIFO/`pendingDataHandoff` 线性累积 → 放行恰 floor(cap/frame)。控制帧同栈突发（暂停窗口内）→ 压力桥 + 策略账双登记 → 越限帧触发 1011（§17 耗尽收口）；非暂停同栈突发 → 额度免检且不入压力桥（§4.4 诚实暴露界，R11 裁定）。
2. **每帧恰计一次的形式论证**：帧 X 计入 P1（facet.queuedBytes）直到被 `takeItems` 移出（通道侧同步核减，update-channel.ts:215/220）→ emit → `onEmitted` 同步入 FIFO 队尾（frame-io.ts:166 在 emitRaw 后立即回调；data 恒入、control 仅暂停窗口——R11）→ 下一次非零 Δ 观察从**队首**（最老）弹出恰好一次（min 弹出保证不超弹）→ 字节进入 P3（observed 自身表达）或已离开（P4，退出一切账）。P1→P2 交接无重叠窗口（同一同步栈内先核减后回调）；策略账（controlUnflushed）与压力账消费面正交（I-1 措辞，R4+R11）；data-only 队列在 FIFO 假设下跨相位残差恒 0（§3.3(d)）。
3. **FIFO 归因误差**（R5 声明）：非 FIFO 吸收下单次误归因 ≤ min(|Δ|, 被误释侧余额)，净影响 ≤ |Δ| ≤ 协议公式同间隙自身宽松度（协议公式不计 P2）；T5 文档化钉死。
4. **重入**：`sendControl` 耗尽 → `onBackpressureExhausted` → 宿主收口（hub: closedFlag 早退幂等；peer: 状态机重入守卫）→ 收口路径的 best-effort ERROR **直发 outbound**（豁免不经 sender 判据，hub-connection.ts:397-415 / peer-connection.ts:542-593 注释明示）→ 其 onEmitted 回报被 `tornDown` 守卫吸收（teardown 先于直发）或落入已死连接的台账（无害）。零递归（既有拓扑）。
5. **drain 中途暂停**：帧间水位复查（:164 既有）+ observe 的对账在 pullAndSendOne → tryEmitData → dataGateOpen 链上执行——恢复/暂停边沿的台账状态一致（observe 先于判据）。
6. **重拨/新建连接**：peer dialNow 每 wire 新 sender（台账归零）；hub 每连接独立实例。无跨连接泄漏。
7. **收口路径 onEmitted**：见 (4)——`tornDown` 守卫 + 窗口门控使收口直发帧零污染。
8. **并发模型**：单线程事件循环内全同步状态机（timer 注入）；无锁需求。台账更新全部同步于发送/观察点。
9. **活锁防御**：shed 循环每轮消费一个 wheel 项或 break；「discard 后 queuedBytes 仍 > 0 即 break」硬守卫（facet 契约违约时不空转）。
10. **无 Runtime sequencer 接触**：改动全部在 `backpressure.ts` 私有状态 + 判据；零新增 import。
11. **饱和签名（R6/R10 可观测契约）**：Δ≡0 恒读数面（§14.4 三成员同构）上 P2 饱和后的行为是**可观测的确定签名**——每个 live deliver 被准入拒绝 → `seq ≤ 0` → 通道 discard + needsResync → RESYNC_REQUIRED 声明帧持续上线（wire 可观测）+ ADR-0010 最小观测面中已有的 backpressure resync 计数单调上升 + UPDATE 字节零增长。签名即 T6(iii) 断言面。

---

## §14. 风险与已接受取舍

### 14.1 D3b 断言反转与结构性不可达（R2 修订）

缺省额度 64KiB→8MiB 使「缺省配置下大 BOOTSTRAP 自杀」从缺陷变为不可能；更强的**结构性事实**：尺寸门（payload ≤ maxBootstrapBytes）与额度约束（quota ≥ maxBootstrapBytes+128）与帧头常量 93B 联立 ⟹ 单帧合法 BOOTSTRAP 的编码帧长 P+93 恒小于任何合法 quota 的下界 mb+128——**单帧自杀在修复后结构性不可达**（§11 #6 公式）。这不是回归，是缺陷修复的必然面；设计要求把该公式断言固化为测试（SA2 T2 后半），并以双 ns 双帧配方（§11 #6 主配方）保留「大控制帧族耗尽额度」的路径覆盖。

### 14.2 非暂停期控制发射的诚实暴露界（R4 修订 + R11 裁定）

非暂停控制对**两套判据**均不可见（额度免检 + 压力桥不登记，R11 裁定）：**单同步栈内免检且不入账上界 = 该栈产生的控制字节总量**（栈内无界；实践上受 socket 排纳速率 × 栈时长约束——物理上限是同一 socket 的排纳速率）；跨栈吸收后即入观察值（协议公式与本项目同计——不比协议更严也不更松，协议公式对未吸收交接字节同样盲）；栈末首个观察点越 highWater 即入窗收口。**恒 0 读数面**（Δ≡0 且读数为 0——缺面/write-through-0 子类，见 §14.4 细分）上额度恒免检（dormant 语义，与现状零漂移；冻结非 0 读数面会入暂停窗口、额度判据活跃，属 §14.4 另一子类）。v1 的「暴露 ≤ 一帧 + 观察滞后」断言在 bufferedAmount 异步滞后前提下不成立，已废止（SA2 R4 属实）；v2/v3 的「恒计封盲区」因等额永久残差（789B）击穿 R1-1 协议公式边界锚而撤回（R11，§12.7）。

### 14.3 真实 TCP 用例 B 的时序敏感性（§11 #11）

新冲刷释放语义下，writableLength 在完全饱和前的瞬降会释放额度 → 耗尽点延后。enterRealPause 的 >512KiB 入口条件是过饱和信号；若 CI 观测漂移，SA6 可加 topUp 维持饱和。这是协议语义（冲刷即释放）的正确代价，不是设计缺陷；旧「永不释放」口径在该场景反而违反协议（G3b 类缺陷的真实链路版）。

### 14.4 Δ≡0 恒读数面悬崖：恒 0 缺面 / write-through-0 / 仅测试 wire 冻结非 0 读数，三者同构（R6 修订 + R10 范围重构）

**风险类定义（R10）**：P2 释放机制（§3.2/§3.3）以**观察值移动**（Δ≠0）为唯一释放证据。因此悬崖的充要条件是 **Δ≡0 恒读数面**——`readBufferedAmount()` 在连接生命周期内永不移动的任何面，与读数的绝对值无关。三个成员同构命中：

| 成员 | 读数 | 机制 | 可达域 |
|---|---|---|---|
| (a) 恒 0 缺面 | 0（协议明文「缺面视为 0」） | 永无 Δ → FIFO 永不弹出 → P2 只增不减 | 生产（配置错误面）+ 测试 |
| (b) write-through-0 | 0 或趋 0（Node 流写穿健康态：socket 可写时 `writableLength` 直接归 0） | 同上 | 生产（健康链路）+ 测试——本仓真实 TCP 适配器自证（ws-replication-sa7-r2-transport.test.ts:328-334「吸收完成 → writableLength 回 0 = 未饱和」） |
| (c) 仅测试 wire 冻结非 0 读数 | 常数 C ≠ 0（`setHubPressure(3/300/…)` 冻结、直构 harness 手控 buffered 恒值——本仓 D3/G 族即此类） | 同为 Δ≡0 → P2 只增不减；**差异仅在下游收口面**（见下） | 仅测试（生产 face 要么缺失=0 要么随排纳移动；冻结常数是测试 seam 的构造物） |

**两个子类的下游差异（如实区分，勿混）**：恒 0 读数（a/b）⟹ 永不暂停 → 额度判据 dormant 免检（§4.4 读法 B 的设计意图）→ 数据面靠**预算准入**收口；冻结非 0 且 > highWater（c，及假想的冻结高压生产面）⟹ 恒暂停 → 额度窗口活跃（Δ<0 永不发生 → 额度不释放，控制面也会在 quota 累计满后 1011）→ 数据面靠**闸门 + shed**收口。两子类的 P2 累积后果同构：单连接累计 admission 满 cap（缺省 8MiB）后 data 准入恒拒 → 通道 needs-resync 恒置 → **RESYNC 声明单调升 + UPDATE 字节零增长**（§13.11 饱和签名）；协议 §17 对缺面的原话语义正是「数据总量仍受准入与 1011 收口」，即该悬崖是 sanctioned 行为，但其无终局信号（不重连、对端视角连接照常）是**静默活锁**形态。

**测试面 (c) 的体量护栏**：冻结面用例的 P2 累积量 = 该用例帧量，必须 ≪ cap——§12.3 已核全套件（ACK/控制帧 × 数十 × ~百字节 ≪ 8MiB/64KiB cap），D3 族迁移配方（§11 #5/#7/#6/#11）沿用该纪律。

**处置（三层，如实）**：
1. **可观测契约（本任务落地面）**：饱和签名（§13.11）= wire 级 RESYNC_REQUIRED 持续声明 + observer seam（ADR-0010 最小观测面含 backpressure resync 计数）单调升 + UPDATE 字节平。SA2 T6(iii) 将其钉为受测契约——把「接受」变成可观测而非静默；对子类 (c)，同一签名在测试体量护栏内不可达（P2 ≪ cap），仅作为越界时的可观测防线。
2. **护栏登记（期票，如实声明）**：生产防护依赖 issue #164「组合根装配期对缺面做响亮断言」——**该断言在本仓尚未实现**（SA2 R1 轮审查 grep 证实 apps/ 零 adapter、无装配期断言）；在 #164 落地前，任何 Δ≡0 面（(a)/(b) 类）都可命中本悬崖。本设计不在此任务内实现 #164（范围外），但把它登记为**上线前置依赖**（§15 DENY 注记）。#164 的断言面只覆盖缺面 (a)；(b) write-through-0 的面**存在且读 0**（合法 adapter），无法由缺面断言拦截——其长期缓解归处置 3。
3. **后续增强（明确超出本任务范围，仅登记建议）**：为 Δ≡0 面补 P2 饱和的 observer-seam 显式事件（如「P2 余额 ≥ cap 且跨一轮 reconcile 零释放」上报）——非运行时 clamp、不违反 §17；作为 #164 的姊妹项开跟踪票归总控决策（同时覆盖 (a)/(b)/(c) 三成员与两个子类）。本设计不偷渡实现（避免 DENY 面与公共 API 涟漪）。

### 14.5 字段迁移无兼容层

不保留 `controlReserveBytes` 读取/别名（G7b 硬断言缺省物无旧键；SA8 裁决「移除旧名无约束」）。调用方（全仓 grep 证实仅本包测试）经 §11 配方一次性迁移。运行时未知键经 resolveLimits spread 惰性携带、零消费（现有 spread 语义，不变）。cast 构造（`as ResolvedLimits`）经 §11 #8/#10 的 `resolveLimits()` 化 + `Number.isFinite` 防线杜绝 NaN 静默失效（R1）。

### 14.6 退休账本的近似面与能力假设（R12）

**聚合观察的根本限制**：`bufferedAmount` 是 data/control 混同的单一电平，**没有任何 per-kind 冲刷观察面**。任何退休规则都是归因推断而非观察；v5 的 §3.5 规则在两条轴向上定型：

| 轴向 | 规则 | 方向 |
|---|---|---|
| 本连接字节 | 控制退休要求下降深度 > **全部**未退休本连接 data（不论缓冲位置先后） | **严格保守**：真实 FIFO 冲刷只需超过「比该控制更老的 data」；本规则只会欠释放（额度偏高计 → 提前耗尽 → 安全侧），不会过释放。代价：控制真实已冲刷但 data 积压仍在时，额度释放被推迟——在「data 积压大 + 控制流量大」的暂停窗口里表现为额度保守（偏严），不产生误杀以外的新风险（误杀方向 = 更早 1011，协议允许的收口域） |
| 外部积压（非本连接写入） | 不作退休候选：无本连接 data 在场时，下降直接归因本连接控制（③→④） | **受控乐观**：若下降实际冲刷的是外部积压，被释放的控制额度可能仍未冲刷——过释放上界 = 控制账面余额 ≤ quota。**这是 G3b 红灯锚钦定的归因读法**（预置电平 17,502 内含待发控制帧，下降 16,477 必须释放，否则锚红）——生产面无外部积压（能力假设 ii），仅测试 wire 的预置/置压构造可达 |

**第三类：跨窗口 ③④ 残留候选的受控乐观（NC-5 显式枚举）**：退休候选 ③（`unretiredAbsorbedControl`）与 ④（handoff 控制 chunk）是**连接生命周期账**（仅 teardown 清零，§3.1），而额度账 `controlUnflushed` 是**暂停窗口账**（enterPause/resume 重置，§4.2）——两套生命周期错位产生一个独立乐观类：

- **类定义**：窗口 W 内的额度释放 ΣR_W 中，由「窗口起点既存的 ③④ 控制候选」（即历史暂停窗口发射、已吸收或仍在 handoff、从未被退休的控制字节）退休驱动的部分 R_xw > 0 时，该释放**不对应 W 内自有控制的冲刷证据**——W 的「未冲刷自有控制」可超出 quota 达 R_xw。
- **界的链条**：(1) R_xw ≤ 窗口起点 ③④ 控制候选余额 C_prev；(2) C_prev ≤ 历史暂停窗口控制发射量 − 历史已被退休量，而每次退休都要求下降深度 > 当时全部 ①② data 候选（data-first 序）→ 恒动面上 **unpause 区间的排水先清 ①② 再清 ③④**，进入新窗口时 C_prev 通常为 0；C_prev > 0 需要「unpause 区间净零下降（Δ≡0）**且**新窗口内下降深度 > 新窗口 data 候选」的组合；(3) 窗口内放行总量 ≤ quota + ΣR_W ≤ quota + R_xw + R_own（R_own = 自有候选退休，受外部积压乐观界约束）→ **未冲刷自有控制 ≤ quota + R_xw ≤ 2×quota（最坏上界）**；(4) 生产压制：单写入者 + 恒动面上 C_prev ≈ 0（unpause 即排水退休）——该类与外部积压乐观类同域，主要在 Δ≡0 相位后接 Δ>0 的测试 wire 构造上可达。
- **可选收紧（登记不强制，供 SA2 若要求收口时选用）**：`enterPause` 时清零 ③（`unretiredAbsorbedControl`）使额度释放严格窗口内归因（R_xw ≡ 0，未冲刷自有控制 ≤ quota + R_own）——代价是真实已冲刷的跨窗口控制不再释放额度（更保守 = 可能提前耗尽）；**④ 不清零**（handoff 控制 chunk 同时是压力侧窗口残留，R11 已裁定其保守计入总压，清零会削弱 I-4 方向）。此变体不需要动 G3b/D1 任一锚（两者的 ③④ 候选均在窗口内产生）。

**能力/传输假设（可实施性的前提，A15 存档）**：(i) 吸收归因 FIFO（A12 既有，官方文档依据）；(ii) **本连接是 transport 的唯一写入者**——生产 socket 上只有本连接的 `send` 增加 `bufferedAmount`（`emitRaw` 单点：hub-connection.ts:137-144 / peer-connection.ts:204-211 各自持有独立 transport；协议拓扑中连接独占 socket），外部增量仅来自测试 wire 的预置/置压；(iii) 观察间隙净 Δ 语义：同隙吸收+冲刷净 0 → 不归因 → 保守（A12 既有）。若未来出现多写入者 transport（如连接复用/多路汇聚），假设 (ii) 失效——本节登记为**能力前置条件**，届时需引入 per-kind 冲刷观察面（协议层扩展）或按最悲观归因（全部下降视为外部）重审 §3.5。

**与 v2-v4 的差异边界**：压力侧（handoffQueue 弹出总量与余额语义）不变——仅 Δ<0 的弹出顺序从「FIFO 队首任意 kind」改为「data 优先」（对 data-only 队列逐值等价，§12.3 精确性保持）；额度侧从无 kind 归因改为退休驱动（本节）；R3 拆分 / R11 裁定 / 窗口语义全部不动。

---

## SA2 反馈逐条回应

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| R1: caller/迁移清单漏 `ws-replication-sa7-hardening-dynamic.test.ts`（:473 宿主缺 `ackTimeoutMs`、:424-435 QUEUE_LIMITS cast 遮缺键 → NaN 静默失效）；审计 grep 未如实转录 | ✅ | §11.0（grep verbatim 转录，5 处构造点）/ §11 #10（新行：ackTimeoutMs + maxQueuedControlBytes + isFinite 防线 + D2/D3 行为零变化核对）/ §11 引言（7→8 文件）/ §12.3 / §12.6 / §15 ALLOW LIST / §17 C2 caller 表（补 :473 行） | 承认 v1 审计遗漏属实（grep 实际 5 处、v1 只录 4 处）；全部清单/走查/ALLOW/caller 表同步补齐；cast 静默面以 `resolveLimits()` 化 + `Number.isFinite` 断言双防线消除（I-7 增补） |
| R2: BOOTSTRAP 帧头算术错误（93B 非 293B）；「首帧即耗尽」配方在启动约束下可行区间为空集 | ✅ | §4.1（帧头常量 59B/93B，来源=红灯探针实测 16,477−16,384/16,443−16,384）/ §11 #6（整行重写：结构性不可达公式 + 双 ns 双帧主配方 mb=96KiB/quota=98,432、恰 1 帧上 wire + 第 2 帧耗尽、无探针依赖；备选=选项 c）/ §14.1 | 承认 293B 与 (P−149, P] 区间均错；以 93B 重推：F=P+93 < mb+128 ≤ quota ⟹ 单帧自杀结构性不可达（登记为缺陷已修的公式断言，SA2 T2 后半）；主配方改双 ns 双帧（2(P+93) > mb+128 ⟺ P > 49,123，90KB blurb 宽裕成立） |
| R3: 已吸收未冲刷控制字节在 shed 触发中双计 → 可达假阳性 shed（破坏性） | ✅ | §3.1（拆 `controlPendingHandoff`）/ §3.4（totalPressure 移除 controlUnflushed、纳入 controlPendingHandoff）/ §3.3（职责正交表）/ §6（触发项替换）/ §12.4（T3 场景走查：6.6MiB ≤ cap 不触发、v1 口径 10.6MiB 假 shed 对照） | 完全采纳 SA2 处方：压力侧（喂总压、Δ 释放）与策略侧（喂判据、Δ<0 释放）拆为两个账本；按协议公式（queued+bufferedAmount）同判，假阳性消除；不触碰 SA8 裁定 |
| R4: I-1 对非暂停控制帧为假；§14.2「≤ 一帧 + 观察滞后」界错误 | ✅ | §2 I-1（重写：压力相位不变量覆盖 controlPendingHandoff 且不区分暂停；controlUnflushed 声明为策略覆盖层）/ §4.2（onEmitted 控制帧恒计压力侧）/ §4.4（诚实界：栈内无界 = 栈产生控制字节总量、实践受排纳速率约束）/ §5（projected 纳入 controlPendingHandoff）/ §12.5（T4 语义钉死） | 承认 v1 断言错误；盲区以恒计压力侧封闭（非暂停控制 P2 进入总压与 admission），额度免检界如实改写并选定 T4 可测语义 |
| R5: deltaUp 归因依赖未声明的 FIFO 假设；§16 无条目 | ✅ | §3.2（observe 注释）/ §3.3（FIFO 假设显式声明 + MDN/WHATWG/Node 官方依据 + 非 FIFO 欠计上界 ≤ min(\|Δ\|, 被误释侧余额) 且 ≤ 协议公式自身宽松度）/ §13.3 / §16 A12（新条目） | 声明 FIFO 吸收假设（官方文档引用）+ 给出假设不成立时的欠计上界；T5 按假设边界文档化 |
| R6: 缺面 dormant 数据面永久饱和无终局信号；#164 护栏是期票不是事实 | ✅ | §14.4（整节重写：悬崖范围纠正为「缺面 + write-through-0 同构」并引本仓真实适配器证据；三层处置=饱和签名可观测契约 T6(iii) / #164 期票如实登记为上线前置依赖 / observer-seam 事件仅登记建议不偷渡）；§13.11（饱和签名定义） | 如实处理：v1 范围错误承认并纠正；选 T6(iii) 把接受变为受钉契约；#164 未实现的事实如实写入并登记为前置依赖；响亮信号增强超出本任务范围、明文登记归总控 |
| R7: §11 #8 与 §17 C2 自相矛盾（QUEUE_LIMITS 配方漏 host `ackTimeoutMs`） | ✅ | §11 #8（配方改为三处：limits + **host `ackTimeoutMs: 10_000`** + cast 防线） | 与 §17 C2 行对齐，消除两处口径不一致 |
| R8: 两处无据推断混入正文（293B 帧头、§14.2 暴露界） | ✅ | 随 R2（§4.1/§11 #6/§14.1）与 R4（§4.4/§14.2）修订；§16 A1 帧头数值修正（93B/59B）+ A12 新增 | 无据推断全部替换为实测常量（红灯探针）或如实的界声明；§16 增补 FIFO 条目 |
| R9（R2 轮阻断）: §11 #5/#7 用 `maxBootstrapBytes: 1` 不可执行——mb=1 小于种子 snapshot payload，击穿 boot 期 codec 尺寸门（BOOTSTRAP_TOO_LARGE → 永不 live）；要求安全值（512–4096）或种子探针、quota=mb+128、D3a 明确连续 allowed+1 写使首越界 ACK、写入 mb 下界/探针步骤与 boot-before-pressure 前置断言 | ✅ | §11 #5（整行重写为 D3 族共用配方：mb=512 ∈[512,4096] + quota=640=mb+128 恰值 + (c) boot-before-pressure 显式断言 `expect(getNamespaceState).toBe('live')`（settleUntil 升格）+ (d) mb 下界探针断言「wire 上 BOOTSTRAP_SNAPSHOT payload < 512」把安全值假设变为受测前置；驱动形态明确：探针 ackBytes → allowed=floor(640/ackBytes)（≈11）→ 连续 allowed+1 笔写 → 第 allowed+1 个 ACK 为首越界帧（627+57=684>640），断言「恰 allowed 个 ACK 上 wire + ERROR×1 + 1011 + backoff + 恢复」）/ §11 #7（同配方引用 + `allowed` 常量 100→floor(640/ackBytes)，并注明消除了 129/57≈2 贴近边界的脆弱性） | 承认 v2 配方不可执行（mb=1 会杀死 boot）；mb 下界=种子 snapshot payload 写入配方并以运行时断言钉死；quota 恒取 mb+128 恰值（G7d 同构）；D3a 的触发驱动改为确定形态「连续 allowed+1 写使首越界 ACK」 |
| R10（R2 轮低项）: §14.4/A13 风险范围应为「Δ≡0 恒读数面」——恒 0 缺面 / write-through-0 / 仅测试 wire 冻结非 0 读数同构 | ✅ | §14.4（重构：风险类定义改为 Δ≡0 恒读数面 + 三成员表（各自机制/可达域）+ 两子类下游差异（恒 0 读数=额度 dormant 免检+预算收口 vs 冻结非 0=暂停窗口活跃+闸门/shed 收口）+ 测试面 (c) 体量护栏 + 处置 2 补注 #164 断言只覆盖缺面 (a)、(b) 归处置 3）/ §13.11 / §3.4 尾注 / §14.2 尾注（dormant 免检精确限定到恒 0 读数子类）/ §4.4 读法 A 行 / §16 A13（重构为三类各带本仓锚） | 风险范围由「恒 0 面」泛化为「Δ≡0 恒读数面」（充要条件=观察值永不移动，与绝对值无关）；冻结非 0 测试 wire 显式纳入并给出体量护栏；两个子类的额度/收口差异如实区分 |
| R11（实现期裁定，SA3 commit 541c3b7 触发）: v2/v3「非暂停控制恒计压力桥」（R4 选项 c）与既有 R1-1 协议公式边界锚冲突——GatedWire gate-off boot 期 Δ≡0 使 789B 控制 chunk 滞留 FIFO，后续 Δ>0 弹出后留等额永久 data 残差，第 8 帧 projected 65,597 > cap 65,536 被拒（协议公式 64,808 应放行）；SA3 无权改 SA6 owned 断言，实现采用「仅 paused 登记 control P2」 | ✅（裁定=选项 (a)，批准 SA3 形状） | §12.7（新增裁定记录：残差机理三步 + 残差内在性论证 + 五项理由表 + 批准形状规范口径 + 零迁移/零返工声明）/ §2 I-1（控制相位声明收窄到暂停窗口）/ §3.1/§3.3(d)/§3.4（入队纪律 + data-only 残差恒 0 精确性）/ §4.2（onEmitted control 分支整体 paused 门控）/ §4.4 + §14.2（诚实暴露界改为「两套判据均不可见 + 吸收后协议公式同计」）/ §5 注释 / §12.3（零干扰论证修正 + R1-1 实证锚）/ §12.5（T4 语义改「栈内全放行（控制不入账）」）/ §13.1-13.2 / §16 A14 | 裁定依据：17 红灯零依赖非暂停控制 P2；R3 假 shed 修复完整保留（T3 控制帧在窗口内）；选项 (b) 会把协议语义锚退化为实现细节锚（残差随 boot 流量漂移）；SA2 R4 必要项本是 (a)+(b)、(c) 为可选项；SA3 实现已全绿。撤回 (c) 不撤回 R4 必要项——措辞修正与诚实界以 R11 口径重申 |
| R12（双轴 BLOCK，推翻 SA7 F1 非阻断归类）: issue 明确 maxQueuedControlBytes 是**未冲刷 control bytes 上限**；v2-v4 额度释放无 kind 归因（`min(\|Δ\|, balance)`）→ **data flush 释放控制额度**——SA7 D1 实证（SA4 R2 实测）quota=163,840 下净下降 Δ=−44,963 误释放 → 12 帧 / wire control 197,724 > quota（超 33,884、n2=3）且控制仍未冲刷。要求：aggregate-only 限制下保守可实现的 control-kind retirement；data flush 绝不释放未冲刷 control quota；覆盖 D1 反向回归（data flush 后超限控制不上 wire + 恰一次 CONNECTION_BACKPRESSURE/1011）；说明 FIFO/transport 能力假设与保守性 | ✅（SA3 commit 8da8692 已实现并通过 D1 安全回归） | §3.5（新增 kind-aware 退休账本：Δ<0 按 ①已吸收 data → ②handoff data → ③已吸收 control → ④handoff control 优先序消耗退休预算；额度释放仅由 ③+④ 驱动；外部积压不作候选）/ §3.1（退休候选计数）/ §3.2（observe() 重写：Δ>0 归因累积候选、Δ<0 退休分派 + retireFromHandoff）/ §3.3 controlUnflushed 行（R12 修复要点）/ §12.1 G3b 行（④ 退休重走）/ §12.8（D1 反向回归走查（SA4 R2 实测对齐：P4 净 Δ=−44,963、P3 候选 ③=94,598/④=53,695；flush 被 ① 整额消耗 → 零释放 → 第 10 帧首越界 164,770 > 163,840 恰一次收口 + 1011；D1 反转分工 SA3 实现/SA7 复证；绿灯锚复核清单）/ §14.6（三类定型：本连接字节严格保守 + 外部积压受控乐观 + 跨窗口 ③④ 残留候选类（NC-5）；能力假设 (i)FIFO (ii)单写入者 (iii)净 Δ 语义；多写入者未来域登记）/ §16 A15 | 硬不变量「data flush 绝不释放控制额度」由优先序结构保证（①② 消耗不触额度）；保守性三类如实声明；D1 断言面（超限控制不上 wire + 恰一次 1011）走查闭合且已由 8da8692 落地验证；压力侧/R3/R11/窗口语义零改动（data-only 队列 Δ<0 弹出顺序变化对其逐值等价） |
| R12-NC（SA2 R12 复审非阻断）: NC-5——§14.6 未枚举「跨窗口 ③④ 残留候选导致的受控乐观类」及其界；NC-6——§12.8 的 v4 违反叙事数字为设计期重构（3×16,477/197,724/12 帧），与 SA7 实际 D1 构造（单次 61,440 flush、13 帧/214,201）不符 | ✅ | NC-5 → §14.6（新增「第三类：跨窗口 ③④ 残留候选的受控乐观」：类定义（生命周期账 vs 窗口账错位，R_xw 不对应本窗口自有冲刷证据）+ 界链四步（R_xw ≤ C_prev；C_prev 需「unpause 区间 Δ≡0 且新窗口下降 > data 候选」组合、恒动面 ≈ 0；未冲刷自有控制 ≤ quota + R_xw ≤ 2×quota 最坏；生产压制同外部积压域）+ 可选收紧变体（enterPause 清零 ③，R_xw ≡ 0；④ 不清零以保 R11 压力侧保守））+ §3.5 保守性清单第三条指针；NC-6 → §12.8/§3.5/§3.3/R12 行/A15/修订记录全部对齐实际数字（**v5.2 再订正：NC-6 转述值 61,440/13 帧/214,201 又被 SA4 R2 实测纠正为 P4 净 Δ=−44,963、12 帧/197,724、超 33,884、n2=3、P3 候选 ③=94,598/④=53,695**——两次转述失准教训：叙事数字一律以最终实测为准，第 10 帧首越界 164,770 的 v5 结论在全部版本下不变），重构版就地废止声明 | 类与界显式枚举（NC-5 闭合）；叙事-实证数字一致性恢复（NC-6 闭合）；零代码/测试改动（SA3 8da8692 既有实现即规范形状） |
| SA4-R2（reject，三项设计文本阻断；实现本体免返工）: (A) D1 叙事数字与实测不符——P4 净 Δ=−44,963（非 61,440）、P3 ③=94,598/④=53,695、v4=12 帧/197,724/超 33,884/n2=3（v5 结论仍零释放）；(B) §15 ALLOW LIST 漏已提交的 `ws-replication-sa7-issue169-dynamic.test.ts`（D1/D2 需求理由）；(C) D1 反转 owner 未明确（SA3 实现/SA7 复证）+ 附录 A teardown 未列退休候选计数 | ✅ | (A) 修订记录 v5 段/v5.2 段、§3.5 问题段、§3.3 R12 要点行、§12.8（场景〔含 P3 候选分拆 ③=94,598/④=53,695、P4 净 Δ=−44,963〕/v4 路径〔103,330→+3 帧=n2=3→12 帧/197,724/超 33,884〕/v5 路径〔① 整额消耗 → 零释放 → 第 10 帧首越界 164,770 恰一次收口〕/数值史废止声明）、R12 行、R12-NC 行、A15；(B) §15 ALLOW LIST 新增 `[SA7 owned]` 条目（D1=R12 硬不变量反向回归锚：首越界帧拒纳 + 恰一次 CONNECTION_BACKPRESSURE + 上线 ≤ quota；D2=Δ≡0 悬崖饱和签名真实 TCP 契约：RESYNC 反复声明 + UPDATE 平 + 无终局信号），并注明非 §11 八文件迁移域（resolveLimits 构造）；(C) §12.8 新增「D1 反转分工」段（SA3 实现 8da8692 + SA7 复证于 sa7-issue169-dynamic D1）+ 附录 A teardown 复位清单显式列举 `unretiredAbsorbedData`/`unretiredAbsorbedControl`（与 §3.1「仅 teardown 清零」对齐） | 三项文本阻断全部闭合；零代码/测试改动；数字链经算术复核（103,330+3×16,477=152,761 ≤ 163,840 → n2=3；③+④=148,293=9×16,477） |

---

## §15. 文件清单（File Scope）

### ALLOW LIST

生产（SA3 实现域，共 6 文件、净改动 ≈ 120 行）：

- `packages/ws-replication/src/backpressure.ts` — 重写记账核心：观察原语 observe()（FIFO 交接队列 + 策略账本）+ 统一 totalPressure + poll 公式 + shed-to-lowWater + 判据换字段；删 BACKPRESSURE_POLL_INTERVAL_MS 导出（≈ 105 行）
- `packages/ws-replication/src/types.ts` — `ReplicationLimits` 字段迁移 controlReserveBytes → maxQueuedControlBytes（1 行）
- `packages/ws-replication/src/defaults.ts` — DEFAULT_REPLICATION_LIMITS 缺省 8 MiB（1 行）
- `packages/ws-replication/src/validate.ts` — positiveSafeInteger 换字段 + 启动期跨字段约束 ≥ maxBootstrapBytes+128（≈ 8 行）
- `packages/ws-replication/src/hub-connection.ts` — sender 宿主增 `ackTimeoutMs: hub.timeouts.ackTimeoutMs`（1 行）
- `packages/ws-replication/src/peer-connection.ts` — sender 宿主增 `ackTimeoutMs: this.timeouts.ackTimeoutMs`（1 行）

测试（`[SA6 owned]`——SA6 创建/迁移；SA3 仅可在测试基础设施（hook/fixture）层面配合，不得改断言语义）：

- `packages/ws-replication/test/ws-replication-issue169-backpressure-accounting-red.test.ts` — `[SA6 owned]` 红灯契约本体（双相位设计，预期零改动；SA2 裁定红灯契约不动）
- `packages/ws-replication/test/harness.ts` — `[SA6 owned]` 契约镜像字段迁移（2 行）
- `packages/ws-replication/test/ws-replication-api.test-d.ts` — `[SA6 owned]` 类型 pin 迁移（1 行）
- `packages/ws-replication/test/ws-replication-issue137-r2-red.test.ts` — `[SA6 owned]` R2-4 ×2 limits 迁移（§11 #3/#4）
- `packages/ws-replication/test/ws-replication-sa7-issue137-dynamic.test.ts` — `[SA6 owned]` D3a/D3b/D3c 迁移（§11 #5/#6/#7；D3b 双 ns 双帧主配方或选项 c）
- `packages/ws-replication/test/ws-replication-review-revisions-r1-r7-red.test.ts` — `[SA6 owned]` QUEUE_LIMITS 迁移 + R2-A2a 宿主 ackTimeoutMs + cast 防线（§11 #8；R1/R3 断言零改动）
- `packages/ws-replication/test/ws-replication-sa7-round2-dynamic.test.ts` — `[SA6 owned]` D4 迁移：limits + host ackTimeoutMs + poll 常量 import 摘除（§11 #9；D2/D3/D5 断言零改动）
- `packages/ws-replication/test/ws-replication-sa7-hardening-dynamic.test.ts` — `[SA6 owned]`（**R1 追加**）QUEUE_LIMITS 补 maxQueuedControlBytes + senderHarness 宿主补 ackTimeoutMs + isFinite 防线（§11 #10；D2/D3 断言零改动）
- `packages/ws-replication/test/ws-replication-sa7-r2-transport.test.ts` — `[SA6 owned]` 真实 TCP 用例 B limits 显式化（§11 #11；用例 A 零改动）
- `packages/ws-replication/test/ws-replication-sa7-issue169-dynamic.test.ts` — `[SA7 owned]`（**v5.2 追加：已提交的动态验证契约，SA4 R2 B 项**；非 §11 八文件迁移域——经 `resolveLimits` 构造、无旧字段面）。**D1 需求理由**：R12 kind-aware 退休账本的反向回归锚——data flush 绝不释放控制额度（硬不变量）的动态判定：Δ<0 按 §3.5 优先序消耗后，首越界控制帧（第 n1+1 帧）拒纳不上 wire + 恰一次 CONNECTION_BACKPRESSURE（1011 接线由 G3a/G9 锚钉死）+ 窗口内控制上线 ≤ maxQueuedControlBytes；直构真实 ConnectionSender/OutboundQueue/codec，仅传输 bufferedAmount seam 与注入调度器（协议既定可注入边界）。**D2 需求理由**：Δ≡0 write-through-0 悬崖（§14.4 已接受面）的饱和签名可观测契约（§13.11 / T6(iii)）——真实 node:net TCP + 真实 timer + 真实 writableLength（零注入）的长寿命低速率连接上，累计 data 纳入满 cap 后验证签名如期可观测（RESYNC_REQUIRED 反复声明 + UPDATE 字节平 + 无 1011/无 close 终局信号），把 §14.4 的「接受」钉为受测契约而非静默。

### DENY LIST

- `packages/ws-replication/src/frame-io.ts` — OutboundQueue/序列纪律/onEmitted 单点不动（§10）
- `packages/ws-replication/src/update-channel.ts` — 直发路径严格接纳与 §10.2 处置已在 PR #165 定型，不动（§10）
- `packages/ws-replication/src/hub-namespace.ts` / `peer-namespace.ts` — facet/声明拓扑不动（§10）
- `packages/ws-replication/src/round-engine.ts` / `lifecycle-queue.ts` / `liveness.ts` / `fence-watchdog.ts` / `error-mapping.ts` / `index.ts` / `testing.ts` — 零接触（lifecycle/ping-pong/GOAWAY 不在本任务面）
- `docs/protocols/instance-replication-v1.md` / `docs/adr/**` — 权威文本与 ADR 是对齐目标，不是对齐对象
- `wiki/raw/20260829-bug-issue-169-backpressure-accounting.md` 及其余 wiki 文档 — SA5/SA2/SA8 产出，SA1 只读
- `packages/**`（ws-replication 除外）、`apps/**` — 字段迁移爆炸半径已证实封闭于本包；issue #164 装配期缺面断言明确不在本任务面（§14.4 处置 2/3——上线前置依赖，非本任务偷渡面）

---

## §16. 协议假设依据 (Protocol Assumption Evidence)

| 假设 | 依据类型 | 依据内容（具体引用） | 风险等级 |
|---|---|---|---|
| A1 16KiB UPDATE 编码帧长 = 16,443B（帧头 **59B**）；16KiB BOOTSTRAP = 16,477B（帧头 **93B** = 59B + replicationId 32B + epoch ≈2B）；100KiB BOOTSTRAP ≈ 102.6KB | 现有测试引用（真实 codec 探针自校验）+ 设计期算术复核（16,477−16,384=93、16,443−16,384=59） | 红灯测试 G2a L279 `expect(encodedUpdateBytes(PAYLOAD_16K, limits)).toBe(16_443)`、G3b L345 `.toBe(16_477)`——探针即生产 codec `encodeMessage`（frame-io.ts:21 codecFieldLimits 同源）；SA5 动态复现 wireBytes 164,000B 量级吻合 | 低 |
| A2 `onEmitted` 在 `emitRaw` 后同步逐帧回报 `{kind, byteLength}`（记账判据来源） | 源码引用 | `frame-io.ts:165-166`：`this.emitRaw(bytes, sequence); this.onEmitted({ kind, byteLength: bytes.byteLength });`——顺序保证「交接即入 P2 台账」无窗口 | 低 |
| A3 bufferedAmount 缺面/非法 → 0（dormant 语义不变） | 源码引用 + 协议收录 | `hub-connection.ts:435-442` / `peer-connection.ts:499-508`（typeof number + isFinite → 否则 0）；协议 §17 L494「缺面视为 0——背压水位退化为不可观察，数据总量仍受准入与 1011 收口」 | 低 |
| A4 两宿主均持有已验证的 `timeouts.ackTimeoutMs` 可接线 | 源码引用 | `hub-connection.ts:61-63`（resolveTimeouts + validateTimeouts → hub.timeouts）/ `peer-connection.ts:71-78`（this.timeouts）；`validate.ts:161` positiveSafeInteger(ackTimeoutMs) 保证公式输入合法 | 低 |
| A5 poll 由注入 `ReplicationTimer` 承载；fake scheduler `advanceBy` 步进语义（49ms 不火/50ms 火） | 现有测试引用 | 红灯 G6a L450-453（advanceBy(49)/advanceBy(1)）；`createRegistryTestScheduler`（namespace-registry/src/testing.ts:74，SA2 复核属实）为既有注入 seam（types.ts:73-76 ADT 0009 依赖纪律） | 低 |
| A6 `validateLimits` 在 createHub/createPeer 构造期同步调用（G7c 构造期 TypeError 可达） | 源码引用 | `hub-connection.ts:61-63` / `peer-connection.ts:71-74`；`validate.ts:21` assertCollKind throws TypeError（既有模式） | 低 |
| A7 控制帧分类：BOOTSTRAP_SNAPSHOT/ERROR/ACK/SYNC 族走 sendControl，UPDATE 走 tryEmitData | 源码引用 + 现有测试引用 | `hub-namespace.ts:426-432` BOOTSTRAP 经 sendChecked→sendControl；红灯 G3/G8 用 sendControl、G1/G2 用 tryEmitData 的用例构造本身即分类锚 | 低 |
| A8 通道入队顺序 = 「先入队再 onDataQueued 通知」（G5 的 incoming 已在队列内） | 源码引用 | `update-channel.ts:90-93`：`this.queued.push(...); this.queuedByteCount += ...; this.host.onDataQueued();` | 低 |
| A9 直发路径拒纳显影已存在（seq ≤ 0 → discard + needsResync + declare） | 源码引用 | `update-channel.ts:160-166`（PR #165 落定）——本设计仅补入队路径，无需改通道 | 低 |
| A10 无运行时 clamp 纪律可维持（pollInterval 对合法 ackTimeoutMs 恒 ≥ 1） | 官方协议引用 | 协议 §17 L492 公式自带 `max(1, …)` 下界；输入合法性由 validateTimeouts 构造期保证（A4）——实现照抄公式即无 clamp | 低 |
| A11 既有套件当前全绿基线（兼容论证的出发点） | 设计期实测验证 | SA1 于 2026-08-29 运行 `pnpm exec vitest run packages/ws-replication`：Test Files 1 failed（仅新红灯文件）\| 22 passed；Tests 13 failed \| 159 passed；Type Errors no errors | 低 |
| A12（R5 新增）**FIFO 吸收假设**：transport 按交接序吸收/冲刷用户写入，`observe()` 的 Δ 归因到 FIFO 队首在该假设下精确 | 官方文档引用 + 现有测试引用 | [MDN `WebSocket.bufferedAmount`](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/bufferedAmount)：「the number of bytes of data that have been queued using calls to send() but not yet transmitted to the network」——send() 按调用序入队；[Node.js stream `writableLength`](https://nodejs.org/api/stream.html)：写请求按提交序进入写队列；本仓真实 TCP 适配器以 `socket.writableLength` 为 `bufferedAmount` 真值（ws-replication-sa7-r2-transport.test.ts:74/108）。**假设不成立的欠计上界**：单次 ≤ min(\|Δ\|, 被误释侧余额)，净影响 ≤ \|Δ\| ≤ 协议公式（不计 P2）在同间隙的自身宽松度；T5 文档化钉死 | 中（假设在标准 WS/Node 传输上成立；非标准传输由上界封闭） |
| A13（R6 新增，R10 重构范围）**Δ≡0 恒读数面**：`readBufferedAmount()` 永不移动的任何面——恒 0 缺面 / write-through-0（健康态 Node 流写穿使 `writableLength` 归 0）/ 仅测试 wire 冻结非 0 读数（`setHubPressure` 冻结常数、直构 harness 手控恒值）——三者 P2 释放后果同构（永无 Δ → FIFO 永不弹出） | 现有测试引用（本仓实证，三类各有锚） | (a) 缺面：协议 §17 L494「缺面视为 0」+ hub-connection.ts:435-442/peer-connection.ts:499-508；(b) write-through-0：`ws-replication-sa7-r2-transport.test.ts:328-334`「吸收完成 → writableLength 回 0 = 未饱和」——真实链路自证；(c) 冻结非 0：本仓 D3 族 `setHubPressure(3/300)`（ws-replication-sa7-issue137-dynamic.test.ts:275/396）与红灯 G3a 恒 8,193、G1 恒 0 的 harness 构造本身。后果与两个子类的下游差异见 §14.4（含测试体量护栏） | 中（子类 (a)/(b) 生产可达，已由 §14.4 处置 1 饱和签名 + 处置 2 #164 前置依赖 + 处置 3 跟踪票建议封闭；子类 (c) 仅测试域，体量护栏 ≪ cap） |
| A14（R11 新增）**GatedWire gate-off 期 delivered 即离缓冲**：`makeGatedWire` 在 gate=false 时 send 直投 `queueMicrotask`、不入 held → `bufferedAmount`(=Σheld) 对该相位恒 0（Δ≡0）——恒计非暂停控制 P2 时 boot 控制 chunk（实测 789B）滞留 FIFO、后续 data 吸收的 Δ>0 弹出后留等额永久残差的机理载体 | 源码引用 + 实现期实测验证 | `ws-replication-review-revisions-r1-r7-red.test.ts:147-160`（hubEnd.send：`if (gated) { held.push(copy); return; } deliveredToPeer.push(copy); queueMicrotask(...)`）与 `:179-183`（bufferedAmount getter = Σheld）；SA3 commit 541c3b7 动态实测：恒计形状下 R1-1 第 8 帧 projected 64,808+789=65,597 > 65,536 被拒、暂停门控形状全绿（§12.7） | 低（该 wire 行为是 R1-1 用意的构造物；裁定后控制不入非暂停桥，机理仅作为撤回 (c) 的依据存档） |

| A15（R12 新增，v5.1 NC-6 数字对齐）**聚合观察限制 + 单写入者能力假设**：`bufferedAmount` 是 data/control 混同的单一电平（无 per-kind 冲刷观察面）；本连接是其 transport 的唯一写入者（生产 socket 只有本连接 send 增加 bufferedAmount；外部增量仅来自测试 wire 预置/置压）。二者共同使 §3.5 的 kind-aware 退休归因可实施且方向可控（本连接字节严格保守 / 外部积压受控乐观 / 跨窗口残留候选受控乐观，§14.6 三类） | 源码引用 + 实现期实测验证 | 唯一写入者：`emitRaw` 单点（hub-connection.ts:137-144 / peer-connection.ts:204-211，各自持有独立 transport、OutboundQueue 唯一出站点 frame-io.ts:165）；聚合限制：DuplexTransport 契约只有 `bufferedAmount?: number` 单属性（types.ts:58-60）。SA7 D1 动态实证（SA4 R2 实测真值）：v4 无 kind 归因下 quota=163,840、P4 净下降 Δ=−44,963 误释放 → 12 帧 / wire control 197,724 > quota（超 33,884、n2=3）且未冲刷；v5 data-first 退休下该下降被 ① data 候选整额消耗 → 第 10 帧为首越界帧（148,293+16,477=164,770 > 163,840）恰一次收口（§12.8，SA3 commit 8da8692 实现 + SA7 D1 安全回归复证） | 中（单写入者在当前协议拓扑恒真；多写入者 transport 属未来协议扩展域，§14.6 已登记为能力前置条件） |

（本设计无 HTTP/WS 端点返回值、端口占用、跨进程资源生命周期类假设——全部交互面在本包同步代码与注入 seam 内。）

---

## §17. 契约改动连锁审计 (Contract Change Caller Audit)

### 改动函数/接口

| 契约 | 文件 | 改动前 | 改动后 |
|---|---|---|---|
| C1 `ReplicationLimits.controlReserveBytes` | `packages/ws-replication/src/types.ts:29` | 必填 `number`（64KiB 缺省） | **删除**；新增必填 `maxQueuedControlBytes: number`（8MiB 缺省） |
| C2 `ConnectionSenderHost` | `packages/ws-replication/src/backpressure.ts:37-52` | 8 成员 | **新增必填** `readonly ackTimeoutMs: number`（其余不变） |
| C3 导出常量 `BACKPRESSURE_POLL_INTERVAL_MS` | `packages/ws-replication/src/backpressure.ts:55` | `export const = 1_000` | **删除导出**（间隔改由 per-connection 公式派生，私有 `pollIntervalMs`） |
| C4 `ConnectionSender.onEmitted` | `backpressure.ts:117-121` | 签名 `(info) => void`；仅 control+paused 累计 | **签名不变**；语义扩展：data/control 分支各入 FIFO 压力账，control 另计窗口策略账 |
| C5 `sendControl`/`tryEmitData` 返回语义 | `backpressure.ts:77/91` | `number`（0=拒纳/耗尽；>0=帧序） | **不变**（判据与台账内部变更，返回契约逐字保持） |

**无 throw/async 契约变化**：本设计不把任何 return 路径改为 throw（唯一新 throw 在 `validateLimits`——本来就是 TypeError 校验函数，G7c 要求）；不同步函数变 async；不新增无条件 throw。

### Caller 清单

| Caller | 文件:行号 | 是否 await | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---|---|---|---|---|
| C1 ← `DEFAULT_REPLICATION_LIMITS` 字面量 | `src/defaults.ts:27` | N/A（同步常量） | N/A | N/A | 本设计改写为 `maxQueuedControlBytes: 8MiB`（§4.1） |
| C1 ← `validateLimits`（读 `limits.controlReserveBytes`） | `src/validate.ts:118` | N/A | 自身即 throw 点（TypeError 契约） | N/A | 换字段 + 新增跨字段约束（§8） |
| C1 ← `sendControl` 耗尽判据 | `src/backpressure.ts:81` | N/A | N/A（返回 0 不 throw） | N/A | 判据换 `maxQueuedControlBytes` + 台账换 controlUnflushed（§4.3） |
| C1 ← 测试 limits 字面量（编译期 excess-property 破坏点） | `test/harness.ts:138`、`test/ws-replication-issue137-r2-red.test.ts:390,437`、`test/ws-replication-sa7-issue137-dynamic.test.ts:264,372`、`test/ws-replication-review-revisions-r1-r7-red.test.ts:468`、`test/ws-replication-sa7-round2-dynamic.test.ts:698`、`test/ws-replication-sa7-hardening-dynamic.test.ts:424-435`（**cast 对象，编译期不报错——运行时读 undefined 静默面，R1**） | N/A | N/A | N/A | §11 逐文件迁移配方（SA6 owned）；cast 面以 `resolveLimits()` 化 + `Number.isFinite` 断言双防线（§11 #8/#10） |
| C1 ← 类型 pin | `test/ws-replication-api.test-d.ts:135` | N/A | N/A | N/A | pin 换新字段（§11 #2） |
| C1 ← 全仓其余消费方 | —（grep 证实不存在，§11.0 转录） | — | — | — | `ReplicationLimits`/`resolveLimits`/`DEFAULT_REPLICATION_LIMITS` 在 apps/ 与其余 packages 零引用 |
| C2 ← hub sender 构造 | `src/hub-connection.ts:145-154` | N/A（同步构造） | N/A | N/A | 增 `ackTimeoutMs: hub.timeouts.ackTimeoutMs`（§9） |
| C2 ← peer sender 构造（每 dialNow） | `src/peer-connection.ts:215-224` | N/A | N/A | N/A | 增 `ackTimeoutMs: this.timeouts.ackTimeoutMs`（§9） |
| C2 ← 测试直构 host（红灯，已提供） | `test/ws-replication-issue169-backpressure-accounting-red.test.ts:190-210` | N/A | N/A | N/A | 零改动（接口提示钦定，`ackTimeoutMs` 经 cast 提供） |
| C2 ← 测试直构 host（D4） | `test/ws-replication-sa7-round2-dynamic.test.ts:722-731` | N/A | N/A | N/A | 增 `ackTimeoutMs: 10_000`（§11 #9，SA6） |
| C2 ← 测试直构 host（R2-A2a） | `test/ws-replication-review-revisions-r1-r7-red.test.ts:509-518` | N/A | N/A | N/A | 增 `ackTimeoutMs: 10_000`（§11 #8，R7 对齐） |
| C2 ← 测试直构 host（senderHarness，**R1 补：v1 全遗漏**） | `test/ws-replication-sa7-hardening-dynamic.test.ts:473-486` | N/A | N/A | N/A | 增 `ackTimeoutMs: 10_000` + QUEUE_LIMITS 补 `maxQueuedControlBytes` + isFinite 防线（§11 #10，SA6；D2/D3 断言零改动） |
| C3 ← 测试 import/使用 | `test/ws-replication-sa7-round2-dynamic.test.ts:29,741` | N/A | N/A | N/A | 删 import、advanceBy 换公式值 100（§11 #9，SA6） |
| C3 ← 生产消费方 | —（grep 证实零外部消费，§11.0 转录：仅 backpressure.ts 自用点 :209 随重写消亡） | — | — | — | 无 |
| C4 ← `OutboundQueue` 构造回调 | `src/hub-connection.ts:143`、`src/peer-connection.ts:210`、测试 queue 构造（red test:184-189 / r1-r7:496-501 / round2:708 / **hardening:472**） | N/A（同步回调） | N/A | N/A | 签名不变零改动；语义扩展由 sender 内部消化（§4.2） |
| C5 ← `UpdateChannel.sendAndRegister`（sendUpdateFrame=宿主 sendData→tryEmitData） | `src/update-channel.ts:160-166`（经 hub-connection.ts:426-432 / peer-connection.ts:478-483） | N/A（同步） | `seq ≤ 0` 分支处理（非 throw） | N/A | **零改动**——拒纳显影语义原样消费新判据（§5/A9） |
| C5 ← `sendControlChecked`（hub 控制出站单点） | `src/hub-connection.ts:417-420` | N/A | 上游 withChannel try/catch（:363-371，吞「连接已收口」） | N/A | 零改动；耗尽路径经 onBackpressureExhausted → connectionFatal（幂等）承接 |
| C5 ← peer 控制出站（emitControl→sender.sendControl） | `src/peer-connection.ts` 控制发送点（round/open/ACK 经 sendChecked 族） | N/A | 既有收口守卫 | N/A | 零改动；failConnectionBackpressure 重入守卫（:571-579）承接 |

### 风险评估

- **遗漏 caller 的代价**：C1/C2 为编译期破坏（TypeScript 必填/删除字段）——遗漏即 `pnpm run typecheck` / vitest `--typecheck` 红，不可能静默流入运行时；**唯一例外是 cast 面**（编译器不查 cast 对象缺键）——本仓 cast 构造 ConnectionSenderHost 的仅红灯 harness（:210，已提供 ackTimeoutMs）与 cast 构造 ResolvedLimits 的 QUEUE_LIMITS ×2（review-revisions:469 / sa7-hardening:435，经 §11 #8/#10 `resolveLimits()` 化 + `Number.isFinite` 防线消除）。C4/C5 无签名变化，无遗漏风险。
- **抓全 caller 的方法**（设计期已执行，输出 verbatim 转录于 §11.0）：
  ```bash
  git grep -n "new ConnectionSender(" -- 'packages/**/*.ts'          # → 5 处（生产 2 + 测试直构 3）
  git grep -n "controlReserveBytes" -- 'packages/ws-replication/src/*.ts' 'packages/ws-replication/test/*.ts'
  git grep -n "BACKPRESSURE_POLL_INTERVAL_MS" -- 'packages/**/*.ts'  # → 4 行（生产自用 2 + 测试 2）
  git grep -rn "ReplicationLimits\|resolveLimits\|DEFAULT_REPLICATION_LIMITS" -- 'apps/**/*.ts' 'apps/**/*.tsx' 'packages/**' | grep -v "packages/ws-replication"  # → 空
  ```
- **运行时半径**：C5 判据变化只影响「何时返回 0」；返回 0 的下游（通道 §10.2 同构处置、宿主收口）全部既有且幂等——无新增未捕获路径、无 unhandledRejection 面（全同步）。

---

## 附录 A. 新 `backpressure.ts` 结构总览（伪代码级，SA3 实现锚；R3/R4 修订后）

```ts
export interface DataSenderFacet { /* 不变 */ }

export interface ConnectionSenderHost {
  readonly limits: ResolvedLimits;
  readonly timer: ReplicationTimer;
  readonly ackTimeoutMs: number;              // ★ 新增（poll 公式唯一输入）
  readBufferedAmount(): number;
  emitControl(message: ReplicationMessage): number;
  emitData(message: ReplicationMessage): number;
  facetOf(namespaceId: string): DataSenderFacet | undefined;
  isEmitAllowed(): boolean;
  onBackpressureExhausted(): void;
}
// ★ 删除 export const BACKPRESSURE_POLL_INTERVAL_MS
const DRAIN_TURN_LIMIT = 10_000;              // 不变

interface HandoffChunk { kind: 'data' | 'control'; bytes: number }   // ★ FIFO 队首可原地缩减

export class ConnectionSender {
  private paused = false;
  private pollHandle: unknown | undefined;
  private handoffQueue: HandoffChunk[] = [];  // ★ §3.1 P2 交接队列（压力相位账）
  private pendingDataHandoff = 0;             // ★ Σ data chunks（data 侧余额）
  private controlPendingHandoff = 0;          // ★ Σ control chunks（control 侧余额；仅暂停窗口登记，R11）
  private controlUnflushed = 0;               // ★ §4.2 暂停窗口策略账（只喂额度判据，R3；释放经 §3.5 退休账本，R12）
  private unretiredAbsorbedData = 0;          // ★ §3.5 退休候选（已吸收未退休 data；仅 teardown 清零）
  private unretiredAbsorbedControl = 0;       // ★ §3.5 退休候选（已吸收未退休 control；仅 teardown 清零）
  private lastObservedBuffered = 0;           // ★ §3.2 对账基线
  private readonly pollIntervalMs: number;    // ★ §7 = max(1, floor(ackTimeoutMs/100))
  private readonly wheel: string[] = [];
  private cursor = 0;
  private tornDown = false;

  constructor(host: ConnectionSenderHost) { this.host = host; this.pollIntervalMs = Math.max(1, Math.floor(host.ackTimeoutMs / 100)); }

  sendControl(...)      // §4.3：observeWater → paused? 判据 controlUnflushed+frame ≤ maxQueuedControlBytes → emit
  tryEmitData(...)      // §5：isEmitAllowed → dataGateOpen → 单帧守卫 → projected(P3+P2data+P2control+P1+frame) ≤ cap → emit
  dataGateOpen()        // 不变形状（observeWater 内换 observe()）
  onDataQueued(...)     // §6：wheel 登记 → enforceConnectionCap
  onEmitted(info)       // §4.2：tornDown 守卫；control 仅 paused→FIFO+策略账双登记（R11）；data→FIFO 恒计
  requestDrain()        // 不变
  teardown()            // ★ 复位清单（SA4-R2 C 项显式列举）：paused/pollHandle/wheel/cursor +
                        //   handoffQueue + pendingDataHandoff/controlPendingHandoff（两余额）+
                        //   controlUnflushed（策略账）+ unretiredAbsorbedData/unretiredAbsorbedControl
                        //   （退休候选计数，§3.1「仅 teardown 清零」）+ lastObservedBuffered

  private observe()              // ★ §3.2 单点读数+对账 + §3.5 退休账本（Δ>0 归因累积候选；Δ<0 按 ①data吸收→②data handoff→③control吸收→④control handoff 优先序退休；额度释放仅 ③+④，data flush 零释放）
  private retireFromHandoff(kind, budget)     // ★ §3.5 按 kind 最老优先退休 handoff chunk（核减压力侧余额）
  private totalPressure()        // ★ §3.4 P3 + pendingDataHandoff + controlPendingHandoff + ΣP1（无 controlUnflushed）
  private drainData()            // 不变（wheel/cursor/turn-limit/帧间水位复查）
  private observeWater()/enterPause()/resume()/armPoll()/clearPoll()   // §7：迟滞不变；interval 公式；enterPause/resume 重置策略账
  private enforceConnectionCap() // §6：触发(严格>，总压含 controlPendingHandoff) → shed 至 Σqueued ≤ lowWater（victim 最大优先 + 契约防御 break）
  private pickVictim()/totalQueuedBytes()/queuedBytesOf()/removeFromWheel()  // 不变
  private measureFrame(message)  // 不变（探针编码确定性判据）
}
```

## 附录 B. 验收命令（SA3/SA7 复证用）

```bash
pnpm run typecheck
pnpm exec vitest run packages/ws-replication --typecheck     # 17 红灯全绿 + 159 既有全绿（含 §11 8 文件迁移后）
pnpm exec vitest run packages/ws-replication/test/ws-replication-issue169-backpressure-accounting-red.test.ts
git diff --check
```

公平性/控制优先/无饥饿/有界内存回归 = `ws-replication-ac5-live` / `ws-replication-sa6-hardening-g1-g2` / AC5-* / A1-A7 / R1-R3 / 真实 TCP A / sa7-hardening D2-D3 等既有套件（§12.3 逐项论证零回归；D3b/用例 B 按 §11 配方语义等价迁移）。SA2 建议的 T1-T7 红灯构想映射：T1=§11 cast 防线、T2=§11 #6 公式断言+双帧配方、T3=§12.4、T4=§12.5、T5=§3.3/A12 边界文档化、T6=§13.11/§14.4 处置 1、T7=红灯契约零改动（SA6 落地时按此对号）。
