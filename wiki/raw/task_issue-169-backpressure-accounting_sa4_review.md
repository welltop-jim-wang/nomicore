# SA4 静态验尸报告 — issue #169 连接级背压记账 / 控制保留额度 / poll 公式

**Date**: 2026-08-30（R1）/ 2026-08-30（R2 复审）/ 2026-08-30（R3 复验，见文末「SA4 R3 固定范围复验」节）
**Verdict**: R1 = **pass**（3 项动态重点交 SA7，无阻断项）→ 双轴 BLOCK → R12 修复 → R2 = **reject**（3 项设计文本阻断，实现本体免返工）→ SA1 v5.2 → **R3 = pass**（三项阻断在固定范围内全部闭合；零代码/零测试改动、Scope Guard 重放零越界、验收命令复跑全绿）
**被审对象（R1）**: SA3 commit `541c3b7`（单 commit，base = ef19bae / `docs/phase-5-websocket-replication`）
**被审对象（R2）**: SA3 commit `8da8692`（R12 kind-aware 退休账本）+ SA1 设计 v5.1（NC-5/NC-6 对齐版）
**被审对象（R3）**: SA1 设计 v5.2（SA4 R2 三项文本阻断修订版）＋代码基线不变（HEAD = 8da8692，`git diff 8da8692 HEAD -- packages/ apps/` 为空——按 R2.3 约定纯设计文本面复验）
**对照基准**: SA1 设计（R1=v4 / R2=v5.1 / R3=v5.2）、SA6 红灯契约（17 用例）、协议 §17 权威文本（`docs/protocols/instance-replication-v1.md` L479–510）、SA5 缺陷分析、SA2 评审（R11 pass / R12 pass + NC-5..8）、双轴 final review（BLOCK）、SA7 报告（D1/D2）、SA4 R2 实测真值（本文件 R2.0/R2.2.A）。

---

## 0. 验证证据（命令 + 结果，2026-08-30 本 worktree 实测）

```bash
# 后台独立进程（skill 测试执行规范）：
pnpm run typecheck                                      → exit 0
pnpm exec vitest run packages/ws-replication --typecheck
  → Test Files 23 passed (23) | Tests 172 passed (172) | Type Errors no errors
  → 含 ws-replication-issue169-backpressure-accounting-red.test.ts (17 tests) ✓
git diff --check                                        → exit 0
git diff --name-only ef19bae HEAD                       → 15 文件，全部落在 ALLOW LIST
```

与设计附录 B 验收命令、SA2 R11 独立复跑（23 文件/172 用例）三方一致。

## 1. 审核结论

### 1.1 Scope Creep Guard（§1.1 立法）：✅ 通过

- actual diff（15 文件）与 ALLOW LIST（生产 6 + 测试 9）**逐文件精确匹配**，零越界、零缺漏。
- DENY LIST 零触碰：`frame-io.ts` / `update-channel.ts` / `hub-namespace.ts` / `peer-namespace.ts` / round-engine 等均不在 diff 中（`update-channel.ts:160-166` 拒纳显影、`OutboundQueue.onEmitted` 单点回报（frame-io.ts emitOne：emitRaw 后同步回调）均核对本轮未动）。
- BLACKLIST 零命中（无 lockfile/TASK.md/.bak）。`wiki/raw/*` 为流水线档案（白名单面，未入 commit）。

### 1.2 设计一致性（含 R11 裁定形状）：✅ 一致

逐条对照设计 v4 规范口径与实现（`backpressure.ts`）：

| 设计条款 | 实现锚点 | 判定 |
|---|---|---|
| §3.2 observe() FIFO 对账（非零 Δ 队首弹出 min(\|Δ\|,chunk)，双向释放） | backpressure.ts:276-297 | ✅ 与伪代码逐行同构 |
| §3.4 totalPressure = 观察值 + pendingDataHandoff + controlPendingHandoff + Σqueued（controlUnflushed 不入，R3 消双计） | :301-304 | ✅ |
| §4.2 onEmitted：data 恒入 FIFO；control 仅暂停窗口双登记（**R11 裁定形状**） | :143-164 | ✅ 与 §12.7 批准形状一致 |
| §4.3 额度判据 controlUnflushed + frame > maxQueuedControlBytes，首过限帧不上线 + 恰一次耗尽 | :99-110 | ✅ |
| §5 严格接纳 projected ≤ cap（恰值放行）+ 单帧守卫保持 | :113-125 | ✅ |
| §6 shed 触发（总压严格 > cap）→ 恢复目标 queued ≤ lowWater，victim 最大优先 + 契约防御 break | :312-327 | ✅ |
| §7 poll = max(1, floor(ackTimeoutMs/100))；删 BACKPRESSURE_POLL_INTERVAL_MS 导出 | :91 / :256（全仓 grep 零残留引用） | ✅ |
| §8 启动约束 maxQueuedControlBytes ≥ maxBootstrapBytes + 128（TypeError，无运行时 clamp） | validate.ts:118/142-147（assertCollKind → TypeError 核对） | ✅ |
| §9 宿主接线各 1 行（hub/peer 构造点均先 resolveTimeouts+validateTimeouts） | hub-connection.ts:148 / peer-connection.ts:218 | ✅ |
| 字段迁移 64KiB controlReserveBytes → 8MiB maxQueuedControlBytes | types.ts / defaults.ts | ✅ |

红灯契约文件（673 行）与 SA6 简报登记的 17 用例逐条对上（13 红 + 4 锚），本轮**零语义改动**（SA2 T7 要求满足）。

### 1.3 读写路径一致性：✅ 一致

admission（tryEmitData）、shed 触发（enforceConnectionCap）、额度判据（sendControl）全部消费同一套台账（I-2 单一台账）；写点仅 onEmitted/observe/enterPause/resume/teardown。未引入第二个 data 调度器（I-5：OutboundQueue/UpdateChannel 零改动，PR #162 单数据面保持）。

### 1.4 静默失败：✅ 无新增静默路径

- data 拒纳 `seq ≤ 0` → `discardQueued + needsResync + declareLocalResync`（update-channel.ts:160-166，本轮未动，逐字核对）。
- shed → `discardForConnectionPressure` → namespace 声明显影（hub-namespace.ts:106 / peer-namespace.ts:107，未动）。
- 额度耗尽 → `onBackpressureExhausted` → CONNECTION_BACKPRESSURE + close(1011)（hub/peer 接线未动）。
- 已知静默活锁面 = Δ≡0 悬崖（见 §3 动态重点 3），属设计 §14.4 显式接受面（协议「缺面视为 0」sanctioned），非本轮新增。

### 1.5 降级方案：✅ 安全（无新增降级）

无新增 fallback/兼容层：旧字段无别名读取（G7b 断言缺省物无旧键，grep 证实生产代码零残留）；cast 面（sa7-hardening/review-revisions QUEUE_LIMITS）全部改经 `resolveLimits()` 构造 + `Number.isFinite` 防线（SA2 T1 落地，hardening D2 首行断言可见）。

### 1.6 极端条件攻击：✅ 未发现可驳回漏洞（2 项精度观察 + 1 项已知悬崖，全部交 SA7）

独立复算全部边界算术：G1（3 帧/49,329B ≤ 65,536）、G2a（恰值 49,329 放行）、G2b（49,329 > 49,328 拒）、G4（40,960+25,600 → 双 victim）、G5（74,752 > cap → NS_A(37,888) 先弃 → NS_B 弃，incoming 同批丢弃）、G3a/G3b（Δ=−16,477 释放策略账）、G6a/b（50ms/1ms）——与实现行为逐值吻合。攻击发现的两项精度面与一项已知悬崖**均为设计 v4 伪代码的忠实实现**（见动态重点），不构成实现级 reject。

### 1.7 错误处理：✅ 完整

契约改动连锁审计（§1.6 立法）：C1–C5 无 throw/async 契约变化（唯一新 throw 在 validateLimits——TypeError 校验函数本职）；sendControl/tryEmitData 返回语义逐字保持。全部 5 处 `new ConnectionSender(` 构造点（生产 2 + 测试 3）均提供必填 `ackTimeoutMs`（TypeScript 编译期强制 + 本轮逐一核对）；`ReplicationLimits`/`resolveLimits` 全仓 grep 证实 ws-replication 之外零消费（本机复跑：apps/ 与其余 packages 零命中）——爆炸半径封闭。

### 1.8 架构评估：✅ 可行（无退回信号）

零 FIXME/临时补丁；不触碰 DENY 面；台账全部为 sender 私有状态，随连接生命周期归零（peer dialNow 先 teardown 再新建，核对 peer-connection.ts:212-218）。过度设计检查：核心改动 ≈169 行（backpressure.ts）+ 5 个 1-8 行小改，与六处根因偏差修复面成比例，无多余抽象。

### 1.9 CI 触发性自检（§1.3/§1.4 立法）：✅ 全部接通

- 无 `.spec.ts` 文件（§1.3 N/A）。
- 根 `pnpm test` = `vitest run --typecheck`，vitest.config `include: ['packages/*/test/**/*.test.ts']` → **全部 ws-replication 测试（含新红灯契约文件）落在 CI `test` job（matrix node 20/24）执行范围内**；`pnpm typecheck` 脚本末项显式含 `packages/ws-replication/tsconfig.json`。无孤儿测试。
- §1.7 源码 grep 断言禁令：改动测试文件零 `readFileSync` 命中；G7a/G7b 用真·模块导出断言（resolveLimits/DEFAULT_REPLICATION_LIMITS），非文本 grep。

### 1.10 测试迁移质量（SA6 配方执行核对）：✅ 无断言削弱

§11 表 11 条配方逐条对上：#1/#2（harness/test-d 改名+8MiB）、#3/#4（64,000≥63,872+128 / 1,500≥1,372+128 恰值）、#5/#7（D3a/D3c mb=512+quota=640、boot-before-pressure 断言、mb 下界探针、allowed=floor(640/ackBytes)≥2 前置）、#6（D3b 双 ns 双帧：断言从旧缺陷依赖的「0 BOOTSTRAP」改为**更强的新行为锁**「恰 1 帧上 wire + 第 2 帧首越界」——这是结构不可达公式的行为化落定，非削弱）、#8/#9/#10（QUEUE_LIMITS resolveLimits 化 + ackTimeoutMs + isFinite 防线；advanceBy(100)=公式值）、#11（真实 TCP 用例 B 显式 quota=64KiB+128，耗尽路径保留；用例 A 缺省零改动）。

---

## 2. 遗留观察（非阻断，登记供后续）

| # | 观察 | 定性 |
|---|---|---|
| N1 | SA2 T3（假 shed 回归：已吸收未冲刷控制不计总压触发）、T4（非暂停控制栈语义钉死）、T6（饱和签名）三项测试构想未落地为用例——SA2 原文「无需本轮落码」、设计附录 B 仅作映射，流水线已裁定；但 R3 双账本拆分（本轮最关键的正确性修复之一）当前无测试钉死，未来回归无护栏 | 测试覆盖缺口，建议后续轮补 |
| N2 | `backpressure.ts:146` 注释「裁定待 SA1/SA2 复核」——设计 v4 §12.7 与 SA2 R11 已批准，注释略滞后 | 修饰性 |
| N3 | D3b 的「单帧合法 BOOTSTRAP 自杀结构性不可达」以注释+行为断言落定，未固化为独立公式断言用例（§11 #6 备选面） | 修饰性 |

## 3. 动态审核重点（交 SA7）

以下风险点是静态审查确认「实现与已批准设计逐行一致」后仍需真实运行环境验证的面，SA7 请在 `task_issue-169-backpressure-accounting_sa7_report.md` 逐条回复：

1. **混合冲刷下额度过释放（quota over-release）**：`observe()` 在任何 Δ<0 时按 `min(|Δ|, controlUnflushed)` 全额释放策略账，**不区分该次冲刷字节属于 data 还是 control**（FIFO 弹出循环本身知道 kind，但策略释放忽略之）。暂停窗口内若 FIFO 队首是窗口前的 data 积压（暂停前已交接、未吸收的数据帧），其冲刷会错误释放控制额度——最坏情形单窗口过纳 ≈ 窗口前 data 积压量（有界，≤ cap；病态混合 jam 下总控字节可至 ~2× quota 后才 1011）。G3b 只覆盖全控制冲刷面。**验证入口**：真实 TCP + enterRealPause jam + 窗口内 BOOTSTRAP 流 + 观察 writableLength 下降段的额度释放归因；若确认越界明显，建议后续轮以「Δ<0 时按 FIFO 弹出的 control-kind 字节数释放」收窄（3 行改动，属设计修订面）。
2. **Δ≡0 write-through-0 悬崖的数据面锁死**（设计 §14.4 已接受，#164 为上线前置）：健康 Node 流 `writableLength` 写穿归 0 → 帧间有空闲间隙的低速率连接上，「上升+回落同间隙」的帧在 FIFO 留永久残差 → 单连接累计 data 纳入满 cap（8MiB）后 data 准入恒拒 + RESYNC 风暴、无 1011、无重连终局信号。现有真实 TCP 用例数据量（≪8MiB）打不到该面。**验证入口**：长寿命连接、帧间 settle 节奏、累计 >8MiB 后观测 RESYNC_REQUIRED 单调升 + UPDATE 字节平（§13.11 饱和签名）是否如期可观测。
3. **真实 TCP 用例 B 耗尽点漂移**（设计 §14.3 预告）：新冲刷释放语义下 writableLength 完全饱和前的瞬降会延后耗尽点；本轮实测用例 B 通过（814ms，恰 1 ERROR + 1011），但该用时序敏感面在 CI 低速/共享 runner 上可能漂移——若复现 flake，按设计配方加 topUp 维持饱和。

## 4. Verdict（R1，2026-08-30）

**pass**。SA3 实现（541c3b7）与 SA1 设计 v4（含 R11 裁定）、SA6 红灯契约、协议 §17 权威文本四方位一致；17 红灯全绿 + 4 锚保持 + 155 既有用例绿 + 零类型错 + 零 scope 越界；无静默失败新增、无契约涟漪风险、CI 全接通。SA7 可进入动态验证，重点见 §3。

---
---

# SA4 R2 独立静态复审 — R12 kind-aware 退休账本（2026-08-30）

**Verdict**: **reject**（3 项设计文本阻断项一次列齐；**实现本体四焦点全部验证通过、零代码返工**；回流目标 = SA1，纯设计文本修正）

**被审对象**：SA3 commit `8da8692`（R12：`backpressure.ts` 退休账本 + `ws-replication-sa7-issue169-dynamic.test.ts` D1 反转）+ SA1 设计 v5.1（NC-5/NC-6 对齐）。
**触发链**：R1 pass → SA7 pass（D1 特性化暴露过释放）→ 双轴 final review **BLOCK**（data flush 释放控制额度，违反 issue「maxQueuedControlBytes = 未冲刷 control bytes 上限」）→ SA1 v5（§3.5 kind-aware 退休）→ SA2 R12 pass（NC-5..8 非阻断）→ SA3 8da8692 → SA1 v5.1 → 本复审。

## R2.0 验证证据（全部本机独立进程实测，2026-08-30）

```bash
# HEAD (8da8692) 验收命令：
pnpm run typecheck                                                → exit 0
pnpm exec vitest run packages/ws-replication --typecheck
  → Test Files 24 passed (24) | Tests 174 passed (174) | Type Errors no errors   （含 D1/D2 新用例）
git diff --check                                                   → exit 0

# v4↔v5 对照实证（回归锚真实性证明，detached worktree @541c3b7 + 同测试文件）：
#   v4 形状下 D1：FAIL —— n2 expected 0, received 3（data flush 释放控制额度 → wire 197,724 > QUOTA 163,840）；D2 pass
#   v5 形状下 D1：PASS —— n2=0、exhausted=1、wire=148,293 = n1×F_CTRL ≤ QUOTA
# 逐相位账本诊断（temp 测试，已删除；v4 与 HEAD 各一遍）：
#   v4：P3 cu=148,293 → P4 Δ=−44,963 → cu=103,330 → n2=3
#   v5：P3 ①=98,658 ③=94,598 cu=148,293 → P4 ① 消耗 44,963（98,658→53,695）、cu 不变 → n2=0

# Scope Guard：
git diff --name-only 541c3b7 8da8692 → 2 文件：backpressure.ts（ALLOW 内）+ ws-replication-sa7-issue169-dynamic.test.ts（**不在 §15 ALLOW LIST**）
```

## R2.1 总控钦定四焦点逐项裁定

### 焦点一：control-kind retirement 是否确保 data flush 绝不释放 controlUnflushed —— ✅ 成立（结构 + 双实证）

- **结构性**：`observe()` Δ<0 分支（backpressure.ts:305-326）中 ①（`unretiredAbsorbedData`）只减自身、② `retireFromHandoff('data')` 只减 `pendingDataHandoff`；唯一的额度释放行 `controlUnflushed -= Math.min(r3 + r4, controlUnflushed)` 的 r3/r4 只来自 ③④（control 侧）。①② 代码路径对 `controlUnflushed` 零写入——硬不变量由优先序结构保证，非约定。Δ>0 分支按 kind 累积退休候选、超出 FIFO 余额的增量不记账（外部积压），与设计 §3.5 逐行同构。
- **实证（绿面）**：HEAD 诊断 P4 段 `①: 98,658→53,695`（消耗 44,963）、`cu` 恒 148,293——data flush 事件零额度释放直接可观测；P5 首帧 148,293+16,477=164,770 > 163,840 恰一次收口、n2=0、wire=148,293。
- **实证（红面）**：v4 worktree 同测试 D1 红（n2=3）——回归锚真实（红于旧形状/绿于新形状），非恒真断言。
- **既有锚不破**：G3b（④ handoff 控制退休路径重走：Δ=−16,477 → ③=0/④=16,477 → 释放 16,477，第二帧放行零误杀）、G3a/G8/G9/D4（Δ≡0 → 零退休 → 累计口径不变）逐条重推成立，全量 174 用例绿。
- **保守性三类**（§14.6）：本连接字节严格保守（只会欠释放）＋外部积压受控乐观（≤ quota，G3b 钦定归因读法）＋跨窗口 ③④ 残留候选（NC-5 枚举，≤ 2×quota 最坏、恒动面 C_prev≈0）——设计已如实登记，本审查独立推导无异议。

### 焦点二：SA7 D1 已反转为 quota 安全回归 —— ✅ 成立

- 断言面反转完整：旧特性化断言（`n2>0` 放行 / `wire>QUOTA` 过释放显影）→ 新安全断言 `n2=0` + `emittedControlCount=n1` + `wireControlBytes ≤ QUOTA` + 精确 `n1×F_CTRL`；v4 下两条 ★ 断言双红（本审查 worktree 实证），v5 下全绿。
- 测试质量：真实组件直构（ConnectionSender/OutboundQueue/真实 codec；仅 bufferedAmount seam + 注入调度器 = 协议既定边界）；防御上限循环（n2>200 抛错）；零源码 grep 断言、零 readFileSync；D2（真实 TCP 饱和签名）与 R12 无机制交叠、双形状同绿。
- **但注意**：D1 反转的 owner 归属与文件入册仍缺设计侧登记（→ 阻断项 B/C）。

### 焦点三：teardown 清零 —— ✅ 成立

`teardown()`（backpressure.ts:175-190）复位全部 7 项台账：`handoffQueue`、`pendingDataHandoff`、`controlPendingHandoff`、`controlUnflushed`、**`unretiredAbsorbedData`、`unretiredAbsorbedControl`**（新增两计数已清，代码注释引 §8/NC-8）、`lastObservedBuffered`，另 wheel/cursor/paused/tornDown/clearPoll——跨连接/重拨零泄漏（peer dialNow 先 teardown 再建，R1 已核对拓扑未变）。

### 焦点四：范围与类型/测试接通 —— ❌ 范围文档面阻断（类型/接通 ✅）

- **类型**：`pnpm run typecheck` exit 0（ws-replication tsconfig 在列）；`handoffQueue` 去 readonly（retireFromHandoff 重赋 filter）为私有实现细节，无外部契约面。
- **接通**：新测试文件匹配根 vitest `include: packages/*/test/**/*.test.ts` → CI `pnpm test`（matrix node 20/24）覆盖；24 文件/174 用例本地全绿即同配置收集证据。R12 diff 的 src 侧仅 `backpressure.ts`（ALLOW 内）；hub/peer/frame-io/update-channel 等零触碰。
- **范围**：本轮唯一新增文件 `ws-replication-sa7-issue169-dynamic.test.ts` **不在设计 §15 ALLOW LIST**（v5/v5.1 均未扩；全设计文档 grep 该文件名零命中）→ §1.1 Scope Creep Guard 硬门禁命中（见阻断项 B）。

## R2.2 阻断项（一次列齐；全部 SA1 设计文本面，零代码/零测试返工）

### A.【NC-6 假闭合——设计叙事数字与落地构造实测不符】verdict 依据：叙事-实证一致性仍是坏的

设计 v5.1 §12.8/§3.5/§3.3/修订记录/A15/R12 行声称的 v4 违反展示与账宽数字，与本审查双诊断（v4 worktree + HEAD）实测不符：

| 设计 v5.1 声称 | 落地构造实测 | 错误机理 |
|---|---|---|
| P4 观察 `Δ<0 = 61,440` | **Δ<0 = 44,963** | 第 9 帧控制的吸收（P3 末次 `buffered += F_CTRL` 发生在最后一次 observe 之后）与 data flush（−61,440）落在**同一观察隙**，净抵一帧；61,440 是 buffered **减量**，不是观察 **Δ** |
| P3 末 `unretiredAbsorbedControl = 148,293` | **③ = 94,598**（④ 侧 controlPendingHandoff = 53,695） | Δ>0 总弹出 193,256 = data 98,658 + control 94,598；窗口末帧（#9）的吸收未获观察 |
| v4 下放行 **13 帧 / 214,201 / 超出 50,361 / n2=4** | **12 帧 / 197,724 / 超出 33,884 / n2=3**（cu 释至 103,330） | 上一行 Δ 错误的连锁：v4 释放 min(44,963, cu)=44,963 → cu=103,330 → 恰再放 3 帧 |

- **影响**：NC-6 的立法目的即「叙事-实证数字一致性恢复」——v5.1 的对齐引入了新错误（SA7 报告原始数字 197,724/12 帧/33,884 恰为落地构造真值，v5 初稿帧数碰巧正确、NC-6「修正」反而改错）。数字错位不改变 BLOCK 的方向性结论（v4 下 wire control > quota 且未冲刷成立），但设计作为 normative 档案其证据链数字失真，且 SA2 R12.3 的「独立复算」复读了同一错误（未察觉同隙净抵）。
- **v5 结论不受影响**：预算 44,963（非 61,440）仍全被 ①（98,658 ≥ 44,963）消耗 → 零释放 → 第 10 帧首越界——`n2=0` 断言面与实测吻合。
- **回流**：SA1 修正 §12.8/§3.5/§3.3/修订记录/A15/R12 行数字（Δ=44,963 及同隙机理、③=94,598/④=53,695、12 帧/197,724/33,884/n2=3、v5 消耗量 44,963），并将 SA7 报告旧数字（同为真值）与 v5 初稿重构数字的废止关系写明。

### B.【scope-creep-detected——§15 ALLOW LIST 未含本轮新增测试文件】verdict 依据：§1.1 硬门禁（2026-06-08 立法）

- actual（`git diff --name-only 541c3b7 8da8692`）= `backpressure.ts`（ALLOW 内）+ **`packages/ws-replication/test/ws-replication-sa7-issue169-dynamic.test.ts`（不在 ALLOW LIST）**；非白名单豁免面（wiki 档案/lockfile 之外）。
- 文件实质已获流水线背书（SA7 Phase-4 交付物、双轴 BLOCK 钦定回归锚、SA2 R12 复审对象、dispatch #19 记录），**但 §15 是文件范围的唯一 normative 清单**——设计全文 grep 该路径零命中，v5/v5.1 均未扩。SA2 NC-7 已点名同类归属缺位，v5.1 只闭合 NC-5/NC-6。
- **不接受「SA2 已审过该文件内容」作为越界理由**（立法明文不接受测试通过类豁免）；处置走立法给定的第二条路：**SA1 修订 §15 显式扩 ALLOW LIST 并标注理由**（SA7 交付物 + R12 §12.8 回归锚 + owner 归属），不回滚代码。

### C.【NC-7/NC-8 设计侧未闭合】与 B 同批修复

- NC-7：设计未补 D1 ★ 断言反转的 owner 归属行（SA2 要求「设计补一行归属」；实测由 SA3 在 8da8692 执行、dispatch #19 有记录，但设计文本零登记——grep "NC-7" 零命中）。
- NC-8：附录 A `teardown()` 行（:839）仍是「handoffQueue/两余额/策略账/基线清零」，**未补两退休候选计数**（字段清单 :822-824 已带「仅 teardown 清零」注、代码已落地并引 NC-8——仅附录行未同步）。

## R2.3 固定复验范围（回流后 SA4 R3 只审此面）

SA1 修订落地后，本 SA4 只复审：设计文本 §12.8/§3.5/§3.3/A15/修订记录/R12 反馈行的数字与机理表述、§15 ALLOW LIST 扩项 + 理由 + owner 行、附录 A teardown 行——对照基准 = 本报告 R2.0/R2.2.A 的实测数字。**零代码/零测试复验**（若 8da8692 之后 src/test 无新改动；有任何新改动则该改动自动入复验范围）。该范围通过即给 pass 或 residual reject，不插入额外验证轮。

## R2.4 Verdict

**reject**。R12 实现本体（退休账本机制、D1 反转回归锚、teardown 清零、类型与 CI 接通、24 文件/174 用例全绿、v4↔v5 红绿对照）**全部通过独立验证**；但设计 v5.1 档案存在三项文本阻断（A：NC-6 数字假闭合——叙事与实测不符；B：§15 ALLOW LIST 缺本轮唯一新增文件；C：NC-7/NC-8 未闭合），按 §1.1 硬门禁与叙事-实证一致性纪律整体驳回。回流目标 **SA1**（纯设计文本，~10 行级修正）；SA3/SA6 零返工。

---
---

# SA4 R3 固定范围复验 — 设计 v5.2（2026-08-30）

**Verdict**: **pass**（R2 三项阻断在 R2.3 约定的固定范围内全部闭合；代码基线零改动，无新增风险面）

**被审对象**：SA1 设计 v5.2（修订记录 v5.2 段 + §3.3/§3.5/§12.8/§15/附录 A/R12 行/R12-NC 行/新增 SA4-R2 回应行/A15）。
**前置确认**：HEAD 仍为 `8da8692`，`git diff 8da8692 HEAD -- packages/ apps/` 为空、tracked 零改动——按 R2.3「零代码复验」条款成立，复验范围为纯设计文本。

## R3.0 验证证据（2026-08-30 本机实测）

```bash
git rev-parse HEAD → 8da8692；git diff 8da8692 HEAD -- packages/ apps/ → 空（零代码/零测试改动）
pnpm run typecheck → exit 0
pnpm exec vitest run packages/ws-replication --typecheck → 24 files / 174 tests 全绿 / Type Errors no errors
git diff --check → exit 0
Scope Guard 机械重放（skill §1.1 启发式提取 v5.2 反引号路径 + comm 比对 ef19bae..HEAD 全量 16 文件）→ creep = 0；BLACKLIST 零命中
```

## R3.1 阻断项 A（NC-6 假闭合）——✅ 闭合

v5.2 在全部指定位置（修订记录 v5/v5.2 段、§3.5 问题段 :197、§3.3 R12 要点行 :178、§12.8 场景/v4 路径/v5 路径 :578-582、R12 行 :679、R12-NC 行 :680、A15 :742）改用 SA4 R2 实测真值，逐值比对通过：

| 项 | v5.2 声称 | SA4 R2 实测 | 判定 |
|---|---|---|---|
| P4 观察 Δ | 净 −44,963（第 9 帧控制吸收与 data flush 同隙净抵；明确区分 buffered 减量 61,440 ≠ 观察 Δ） | −44,963 | ✅ |
| P3 退休候选分拆 | ③ unretiredAbsorbedControl = 94,598 / ④ handoff 控制 = 53,695（合计 148,293 = 9×16,477） | 94,598 / 53,695 | ✅ |
| v4 违反展示 | cu 148,293−44,963 = 103,330 → 再放 3 帧（152,761 ≤ 163,840，第 4 帧 169,238 >）→ n2=3、共 12 帧 / 197,724 / 超 33,884 | n2=3 / 197,724 / 33,884 | ✅ |
| v5 结论 | ①（≥44,963）整额消耗 → 零释放 → 第 10 帧首越界 164,770 恰一次收口 | n2=0 / wire=148,293 / exhausted=1 | ✅ |

- 旧错值（61,440 / 13 帧 / 214,201 / 50,361）grep 复核：仅存于「数值史废止声明」与历史记录语境，无任何现行断言残留。
- 算术独立复核：94,598+53,695=148,293=9×16,477 ✓；103,330+3×16,477=152,761 ≤ 163,840 ✓；148,293+16,477=164,770 > 163,840 ✓；197,724−163,840=33,884 ✓。
- §12.8 场景段「① ≥ 44,963」为保守真包含表述（实测 P4 时 ①=98,658）——正确方向，无失真。

## R3.2 阻断项 B（scope-creep-detected）——✅ 闭合

- §15 ALLOW LIST 新增 `[SA7 owned]` 条目（标注「v5.2 追加：已提交的动态验证契约，SA4 R2 B 项」），含 D1/D2 需求理由（D1 = R12 硬不变量反向回归锚：首越界帧拒纳 + 恰一次 CONNECTION_BACKPRESSURE + 上线 ≤ quota；D2 = Δ≡0 悬崖饱和签名真实 TCP 契约）+ 「非 §11 八文件迁移域（resolveLimits 构造、无旧字段面）」注记——理由与归属齐备，符合立法「显式扩展 + 标注理由」处置路径。
- **Scope Guard 机械重放**：skill §1.1 启发式从 v5.2 提取 ALLOW 集（37 路径）与 `git diff --name-only ef19bae HEAD`（16 文件）comm 比对 → 豁免过滤后 **creep = 0**；BLACKLIST（lockfile/TASK.md/.bak 等）零命中。硬门禁解除。

## R3.3 阻断项 C（NC-7/NC-8）——✅ 闭合

- **NC-7**：§12.8 新增「D1 反转分工（owner）」段——SA3 实现（commit 8da8692）＋ SA7 复证（D1 安全回归，v4 红 / v5 绿），与 dispatch #19/#15 记录一致。
- **NC-8**：附录 A `teardown()` 行（:843-845）显式列举 `unretiredAbsorbedData` / `unretiredAbsorbedControl`（引 §3.1「仅 teardown 清零」对齐）——SA2 NC-8 原始要求（补两退休候选计数）满足；代码侧（backpressure.ts teardown 7 台账全清）R2 已验证且零改动。

## R3.4 残余 nit（非阻断，登记不回流）

1. 附录 A teardown 行的枚举为部分清单（v5.2 版列 paused/pollHandle/wheel/cursor + controlUnflushed + 两候选 + lastObservedBuffered，未复列 handoffQueue/两余额；v5.1 旧版则相反）——两版均为部分枚举，规范性枚举以 §3.1/附录字段块为准（该处完整且与代码一致）。修饰性粒度问题，两版等价，不构成回流通报。
2. R1 遗留观察 N1-N3（T3/T4 独立护栏缺口、注释滞后、公式断言用例）状态不变，属后续轮测试增强域，非本任务收口面。

## R3.5 固定范围外抽样

v5.2 改动面 = R2.3 指定六处 + 新增「SA4-R2 回应行」（直接影响面，内容已逐值核对，含「两次转述失准教训：叙事数字一律以最终实测为准」的自警）——无范围外新章节、无新契约/新风险引入；§14.6 三类保守性、A15 能力假设等 R2 已审内容 grep 抽样零意外改动。

## R3.6 Verdict

**pass**。SA4 R2 三项阻断（A：NC-6 数字假闭合；B：ALLOW LIST 缺新测试文件；C：NC-7/NC-8 未闭合）在设计 v5.2 中于固定范围内全部闭合且数字链与 SA4 R2 实测逐值一致；代码基线 8da8692 零改动（R2 已验证的四焦点结论直接延续）；Scope Guard 重放零越界；验收命令复跑全绿（typecheck / 24 files / 174 tests / diff-check）。**SA4 静态门禁就此收口**，后续按流水线进入 AC 复核与新鲜双轴 final review。
