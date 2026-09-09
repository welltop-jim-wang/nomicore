# SA2 攻击评审报告 — CI repair：`apps/yjs-server` 根锁 stale 回收双活竞态（PR #276 `test (24, 4)`）— iteration 4（闭环核验轮）

**Date**: 2026-09-10
**Verdict**: **pass** —— iteration-3 的全部 binding findings（#12 MAJOR Option A 四子项 + #13 MINOR）
**逐项闭环核验通过**；机制本体（D1/D1′/D2/D3/D4/D6）确认**零改动**；修订后的验收网
（T7a②′/⑥ + T7c + 变异自检义务）经本轮**可执行模拟重放**证明：对「急早起爆（M1）/ 更替重置失效
（M2）/ 预算量纲错误 / 基线续量合并 / 永不抛出」五类不安全实现变异**各有至少一处确定性红灯**，
且**不排斥合规实现**（正确实现全绿）。无新增阻断项；残余为 1 条非阻断实现期观察（O-13，
T7c 的 M2 红灯对「nonce A 检测延迟」有 ≈200ms 预算，见 §14）。**同意放行实施。**

> 评审对象：`wiki/raw/task_ci-pr-276_design.md`（iteration 5 原位修订版，808 行，2026-09-10 01:28）。
> 上游输入（全部亲读）：SA6 验收契约 + 红/CI/压力证据四件 + driver；SA8 冲突复审四轮（iteration 2/
> 3/4 —— iter-4 为 clear，H1-H8 + N1″/O4/O2 + B1″-B4′ 边界移交）；本报告前三版（iteration 1 reject
> 7 findings / iteration 2 reject #8 MAJOR + #9-#11 MINOR / iteration 3 reject #12 MAJOR + #13 MINOR
> —— 本文件原位沿革）。
> 评审基线：worktree HEAD `334494d`（本轮 `git log -1` 亲证，与 SA6/SA8/SA2 各轮证据同一性一致）；
> `git status` 亲证：`lifecycle.ts` 及全部生产/测试代码**未被触碰**（仅 wiki 证据 + SA6 压力契约新文件
> 未跟踪）——与设计「只产出设计证据」的声明一致，D6 为纯设计面。
> 源码/契约锚点本轮全部亲读复核：`lifecycle.ts` 252 行全文（L20-22/L49-57/L59-63/L65-74/L76-82/
> L105-137/L139-195/L198-232/L236-251）；`main.ts`（L30/L100-105/L125-145/L185-212）；`src/index.ts`
> L70 导出面；canary 7 用例全文（重点 L77/L78/L104-107/L121）；stress 3 用例全文（重点 **L127/L168**
> 败者子串 regex）；fixture `root-lock-worker.ts`（L8-23 单消息协议）；stress `spawnBurner`（`spawn(
> process.execPath, ['-e', …])` 内联模式——T7c 助手同款）；`docs/integration/hub-peer-deployment.md`
> §锁文件与共享 root（L232-250，L250 pid 复用句覆盖范围亲证）；`apps/yjs-server/AGENTS.md`
> Boundaries 末条；`vitest.config.ts`（include `apps/*/test/**/*.test.ts` + `maxWorkers:1`）；
> `scripts/ci-test-shard.mjs`（L29-50 磁盘枚举 walk——新测试文件自动收录）；`acquireRootLock`
> 全仓消费者 grep（仅 main.ts L132/L193 两处 + 测试面——B8 完整）。
> Issue/PR comments REST：`[]`（dispatch 注记；无 Owner 追加要求可映射，与 SA6/SA8/SA2 各轮一致）。

---

## 0. 沿革与本轮范围

| 轮次 | 对象 | verdict | 遗留 |
|---|---|---|---|
| iteration 1 | 初版设计 | reject（7 findings：#1 CRITICAL 残余双活 + #2-#7） | 全部由 iteration 2/3 修订落实 |
| iteration 2 | iteration 3 设计 | reject（#8 MAJOR claim 门无界自旋 + #9-#11 MINOR） | 全部由 iteration 4 设计（D6）落实 |
| iteration 3 | iteration 4 设计（D6） | reject（#12 MAJOR 验证论证失实 + 两变异盲区；#13 MINOR） | 修订落点 = Option A（A1-A4）+ #13；机制本体不许重开 |
| **iteration 4（本报告）** | **iteration 5 设计（#12/#13 修订版）** | **pass** | 无阻断遗留；O-13 实现期观察 |

本轮为**闭环核验轮**：任务 = 逐项验证 binding findings 闭环 + 机制零改动 + 修订后验收网对不安全
实现变异的真实红灯性（派发指令明文要求）。攻击方法：(a) 全部事实主张独立亲证（regex/行号/导出面/
spawn 模式/CI 装置）；(b) **可执行模拟重放**——把 T7a/T7c 规格时间线与「正确 + 五类变异」实现放入
同一仿真（§7），验证红/绿归属；(c) 机制面与 SA8 iter-4 报告的独立引文逐段对照（§8）；(d) 对修订
新增面（T7c 时间线、T7a②′下界、文案不相交硬约束）做全新视角攻击（§9）。

## 1. Reviewed inputs

| 输入 | 状态 |
|---|---|
| `wiki/raw/task_ci-pr-276_design.md`（iteration 5，808 行） | 亲读（评审对象，全文） |
| `task_ci-pr-276_design_conflict_report_iter4.md`（SA8 clear + O4/B4′ 移交） | 亲读（机制零改动对照基准） |
| `task_ci-pr-276_design_conflict_report.md` / `_iter3.md` | 亲读（沿革） |
| `task_ci-pr-276_sa6_contract.md` + 三份证据 log + driver | 亲读（沿革承接；§2/§12 验收口径复核） |
| 生产/契约/装置源码锚点（见头注清单） | 本轮全部亲读复核 |
| Issue/PR comments REST | `[]`（无 Owner 要求） |

## 2. Verdict

**pass** —— #12（Option A A1-A4 + 验收条款）与 #13 全部闭环（§6 逐项证据）；机制本体零改动（§8）；
修订后验收网对 M1/M2/量纲/合并/永不抛五类变异各有确定性红灯且不排斥合规实现（§7 模拟实证）。
`requiresConflictRecheck: false`（§13）。

## 3. 需求覆盖

| Requirement | Design section | Assessment |
|---|---|---|
| PR #276 CI 恢复绿、不跳过/不禁用/不弱化任何测试（SA6 §2 字面） | §1 / §12 E1/E2 / §11 DENY | 覆盖 ✓（两契约 + fixture + CI 装置封锁；ALLOW 仍为同一文件四项、DENY 未松动——本轮复核） |
| 双活结构性消除（SA6 §12：任意轮数零双活） | §0 I0-I2 / §7 三层防线 / §8.3 | 覆盖 ✓（iteration 2 独立重放结论承接；本轮对照 SA8 iter-4 引文确认机制零改动，无回归） |
| 迭代 4 派发指令（claim 门有界/liveness-safe + 恢复语义 + 可执行验收 + 保留七项既有解） | §7 D6 / §9 / §12 E9 / §15 | 覆盖 ✓（iteration 3 已裁机制本体成立；本轮未回归） |
| **迭代 5 派发指令（本轮闭环对象）：修正 E1 误触发守卫失实、等待下界钉位（急起 claimStuck 不得通过）、更替重置计账证据、#13 如实化、机制不许重开** | §8.1 / §12 E9a②′·⑥ + E9d/T7c / §13 R8-② / §15.3 / §7 零改动 | **全部闭环 ✓**（§6 逐项；§7 红灯性实证；§8 零改动核验） |
| 磁盘契约稳定面零变化 / 非目标不扩大 | §8.1 / §11 | 覆盖 ✓（唯一新公共可观察输出仍为 claimStuck 文案，本轮程序化验证与两冻结契约败者 regex 不相交） |

## 4. Owner 评论覆盖

Issue/PR 评论 REST 读取为 `[]`（dispatch 注记，与 SA6 §2 / SA8 各轮 / 本报告前三轮六方一致）——
无 Owner 评论要求可映射。验收口径 = 派发要求（§3 已覆盖）。

## 5. 上游事实与 SA8 约束核对

| Fact or constraint | Design response | Assessment |
|---|---|---|
| SA8 iter-4 **O4/B4′**（移交 SA2 裁决：E1 兼任误触发守卫失实；若改文案须同步 T7a regex 与 §8.1） | Option A：文案避开 `held`/`unsupported` + regex/引文四处同步 + T7a②′/⑥ + T7c | **闭环 ✓**——SA1 选择的正是 B4′ 预裁路径，同步义务逐处履行（§6 A1）；B4′「SA4/SA7 不得以 E1 转红检测误触发」的边界在 §10/§11/§12 各行如实降级为「概率性兜底」 |
| SA8 iter-4 H1-H8（clear） | §6 采纳为裁决基础 | 一致 ✓（本轮复核：H1 自由面措辞、H3 模块私有、H7 重触发条款逐项未触——§13） |
| SA8 iter-4 N1″（轻量 ADR advisory）/ O2（main.ts L11 头注先在缺陷） | §16 / §11 DENY | 维持不阻塞，归 owner/总控（O-11 沿） |
| B8 消费者完整性 | 本轮全仓 grep | ✓（src 内仅 main.ts L132/L193；测试面 = canary/stress/fixture + 新增测试文件） |
| CI 装置：新测试文件自动收录 | vitest include + shard walk | ✓（本轮亲证 `scripts/ci-test-shard.mjs` L29-50 磁盘枚举；`maxWorkers:1`） |
| SA6 §12 结构零窗口标准 / §2 不弱化测试 | §12 E1（≥3 复跑）/ DENY | 承接 ✓ |

## 6. Binding findings 闭环核验（本轮核心一）

### 6.1 #12-A1：文案不相交 + 四处同步 —— **闭环 ✓（程序化验证）**

本轮以 node 对**实际序列化文案**（`{instanceId: <JSON.stringify>, pid: <JSON.stringify>}`，与
`heldError` L68 owner 串构造逐字节同款——lifecycle.ts 亲证）执行五项验证：

| # | 验证 | 结果 |
|---|---|---|
| V1 | 定稿文案（`… is still occupied by a live pid … (pid reuse caveat: …)`）对败者子串 regex `/held\|unsupported/` | **不匹配** ✓（含边界词核查：`holder` 不含子串 `held`；无大小写变体） |
| V2 | 设计钉位 regex `/reclaim claim .* occupied by a live pid .*\(pid reuse caveat/` 对定稿文案 | **匹配** ✓（§8.1「逐字符验证」声明独立复核成立） |
| V3 | iteration-4 旧文案（`is still held by a live pid`）对 `/held\|unsupported/` | 匹配——**原 #12 缺陷形态复现确认**（闭环对象真实存在且已消除） |
| V4 | SA2 iteration-3 自己给出的示例 regex（`… .* pid reuse caveat/`，空格形）对定稿文案 | **永不匹配**——SA1 的「隐性缺陷」披露**属实**（文案中 caveat 紧随左括号、前面无空格；SA1 改锚 `\(pid reuse caveat` 是必要修正而非多余收紧） |
| V5 | 要素齐全性 | ✓ claim 名（`.nomicore-lock.reap-claim`）/ 持有者 `{instanceId, pid}`（V 前置同款序列化）/ 上限（`after 5000ms`）/ 处置指引（verify → remove claim → retry）/ pid-reuse-caveat（`(pid reuse caveat: see docs/…)`） |

同步义务四处逐点核对：§8.1 钉位 regex（L491）✓、§11 ALLOW T7a 行 ①（L643）✓、§12 E9a①（L675）✓、
§11 deployment doc 症状句引文（`still occupied by a live pid … 5000ms`，L644）✓——**四处一致**。
文案不相交硬约束（§8.1「不得含子串 `held` 或 `unsupported`」，规范性）+ T7a⑥ 把该性质本身钉为被测
契约 ✓。

### 6.2 #12-A2：T7a②′ 下界 + ⑥ 不相交 —— **闭环 ✓**

§11 ALLOW T7a 行与 §12 E9a 均改为**断言七件**：① 钉位 regex；**②′ 墙钟下界 `elapsed ≥ 5000ms`
（同一 `performance.now` 包夹）**；② 上界 `< 4×5000ms`；③ claim 字节不变（不夺门）；④ canonical
未创建；⑤ 无 staging 残留；**⑥ `not.toMatch(/held\|unsupported/)`**。下界的合规性论证（「同内容
占用连续判活 ≥ LIMIT 才许抛」⇒ 预置静态 claim 下 throw - t0 = 5000 + (首拒基线 - t0) ≥ 5000）数学
成立——**不排斥合规实现**（§7 模拟中正确实现 throw@≈5005ms，②′/② 双过）。

### 6.3 #12-A3：T7c（=E9d）更替重置确定性用例 —— **闭环 ✓**

规格要素逐项在位（§11 新测试文件行 + §12 E9d + §8.3-10 + §7 D6 验收段四处一致）：内联 `node -e`
助手（不新增 fixture 文件；与 stress `spawnBurner` 的 `spawn(execPath, ['-e', …])` 模式同款——本轮
亲证该模式在库）；外部 instanceId + **自身活 pid**（判活必真）；nonce A ≈2600ms →「写 staging +
`renameSync(staging, claim)` 原子换名」（O-10：禁 unlink+write 空窗）→ nonce B ≈2600ms → unlink
退出；**测试进程先异步轮询确认 nonce A 在场再进入同步 acquire**（防「门未挂上即获取」退化）；
断言 = 获取**成功** + owner.json=镜像=获取者 + release 干净（超时 30s）。单段 < 5000ms、合计
≈5200ms > 5000ms。红灯性实证见 §7。

### 6.4 #12-A4：8 处失实表述清除 + 验收条款 —— **闭环 ✓（grep 全量复核）**

对设计全文 grep「转红 / 兼任 / 守卫」逐条归类：**无任何残留**把 E1/canary 表述为唯一或确定性误触发
守卫；全部存活occurrence 分三类——(i) Option A 下**如实**的概率性兜底陈述（「误发时败者消息失配
即红」——V1 使其为真）；(ii) 确定性守卫对**变异**转红的陈述（T7a②′/⑥/T7c）；(iii) 对 finding 本身
的历史引文（§5/§6/§15.3 映射表）。§6.1 所列 8 处（§7 D6-验收 / §8.3-10 / §10 fixture 行 / §10 压力
契约行 / §11 DENY 压力契约行 / §12 E1 行 / §12 E9c 行 / §13 R5 处置列）逐一改写到位。
**验收条款**（SA2 iter-3 #12 Acceptance）落实：§12 新增「实现期变异自检义务」（临时 M1 或
`ROOT_LOCK_CLAIM_WAIT_LIMIT_MS` 置 0 → canary/stress/T6/T7a/T7c 至少一处转红 → 复原全绿；一次性、
不随实现入库）✓；T7a/T7c 断言清单写入 §11 ALLOW 行与 §12 E9 ✓。

### 6.5 #13：R8-② 时钟方向如实化 —— **闭环 ✓**

§13 R8-② 现文：`performance.now()` 单调、底层（libuv `uv_hrtime` = Linux `CLOCK_MONOTONIC`）
**不含 suspend**——挂起使**墙钟**变长而单调计量不变 ⇒ 触发相对墙钟**只会更晚、绝不提前**；I3 单调
上界不受影响。方向与 Node/libuv 实现一致（iteration-4 原文方向确实写反，本轮确认已改正）。
§11 deployment doc 行含可选墙钟注记（「挂起/重度调度饥饿下从墙钟看等待可能长于 5000ms 才触发」）✓。
P10 引用维持无误 ✓。

## 7. 变异敏感性实证（本轮核心二：可执行模拟重放）

派发指令要求确认「revised tests genuinely fail unsafe eager/misfire/incorrect-budget implementations」。
本轮把 T7a（静态活 claim）/ T7c（A 2600ms → 原子换名 B 2600ms → unlink）规格时间线与六种实现
（1 合规 + 5 变异）放入同一仿真（循环粒度 1ms；T7c 检测延迟 δ=50ms；超时 30s）：

| 实现 | T7a 结果（②′≥5000 / ②<20000 / 30s 超时） | T7c 结果（期望成功） |
|---|---|---|
| **正确**（首拒基线 + 同内容续量 + 更替重置） | throw@5005ms：**②′ PASS / ② PASS** | **success@5200ms：GREEN** |
| M1 首拒即抛 | throw@5ms：**②′ RED** | throw@50ms：**RED** |
| M2 重置分支失效（跨更替累计） | throw@5005ms：②′/② PASS（T7a 对 M2 本就不敏感——iter-3 判定维持） | throw@5050ms：**RED** |
| 预算量纲错误（5000µs） | throw@10ms：**②′ RED** | throw@55ms：**RED** |
| 基线续量合并（deniedSince=0 纪元合并） | throw@5000ms：②′ PASS* | throw@5000ms：**RED** |
| 永不抛出（无界自旋，iter-3 缺陷形态） | 30s 超时：**RED**（兜底「不挂死」） | success@5200ms：GREEN（该方向由 T7a 超时覆盖） |

结论：**五类不安全变异各有至少一处确定性红灯；正确实现不被排斥**。*注：基线合并变体在 T7a②′
的走红取决于 vitest worker 内 `performance.now()` 纪元是否已 >5000ms（fresh worker 下可能只在
5000ms 整抛出、②′ 边界通过）——但该变体被 **T7c 确定性捕获**（换手后续量从纪元起算 ⇒ 5000ms 整
误抛），**网级保证成立**；设计 §12 E9a②′ 对该变体的归属表述属最优情形陈述，非失实（net-level
红灯性不受影响）。

## 8. 机制零改动核验（迭代 5 范围遵从）

- **§7 伪代码逐段对照** SA8 iter-4 报告对 iteration-4 设计的独立引文（D6 = `ROOT_LOCK_CLAIM_WAIT_LIMIT_MS
  = 5_000` + 同内容占用计账 + 更替重置 + `claimStuckError` loud + 绝不夺门；claim 门 link 挂名 /
  rename-detach 单胜者接管 / 内容校验释放；NEW①-⑤ staging 构建、CAS errno 集、证据门控阶梯）——
  **结构、常量、hook 形态、抛点位置全部一致**；本轮对伪代码的独立重放（iteration 3 A11-A16 场景）
  未产生新反例。
- **§8.2 状态机**（含 claim-blocked 终止态）、**不变量 I0-I3**、D2/D3/D4（含 #9/#10/#11）、备选
  1-12 否决理由、§8.3 场景 1-8、§9 恢复语义、§13 R1-R7——与 iteration-4 机制面一致（本轮通读 +
  SA8 引文对拍）。
- **修订面清点**（与 SA1 自述一致）：§8.1 文案与硬约束、T7a②′/⑥、T7c、8 处文本改写、R8-②、
  §11 引文同步、§12 自检义务、§15.3 映射——**全部为验证/文案/文本级，无机制行变更**。
- 生产代码零触碰（`git status` 亲证）——D6 尚未实现，正是本轮设计评审的意义所在。

## 9. 本轮攻击点清单（全新视角攻击修订新增面）

| # | 严重度 | 攻击面 | 攻击与结论 |
|---|---|---|---|
| — | — | T7a① 钉位 regex 被既有错误族误命中（假阳性交叉） | 攻击失败：三族既有文案（`held by the same instance…` / `shared file persistence root is unsupported…` / `cannot write…`）均不含 `reclaim claim … occupied by a live pid` 序列——canary L77/L78/L121 各自的钉位 regex 与新 regex 无交叉（本轮逐条核对） |
| — | — | T7c 被错误实现「绕过门」骗绿（无 claim 门实现直接成功） | 属机制面保真问题（iteration 2 A2 已证 claim 门必要；E1 ≥3 复跑 + E7 driver burn 为行为兜底；伪代码保真是 SA4 代码评审义务）——非本轮 #12 范围，不构成新阻断 |
| — | — | T7c 被错误实现「误判活为死」骗绿（提前接管活 claim） | 攻击失败：该变异在 **T7a③（claim 字节不变）** 转红——接管会 rename 走 claim |
| — | — | 每轮循环无条件重置的变异（永不累计）骗过 T7a | 攻击失败：T7a 30s 超时红（§7 模拟「永不抛出」行） |
| — | — | 同步 `performance.now` 包夹 vs 实现时钟不一致 | 攻击失败：T7a②′ 明文「同一 `performance.now` 包夹」，与实现测量同源单调时钟（§14 P10） |
| 14→O-13 | 观察项 | **T7c 的 M2 红灯预算**：M2 抛点 = δ+5000ms（δ = nonce A 检测延迟）；helper 于 5200ms unlink——δ ≥ ~200ms 时 M2 在 claim 消失后才达阈 ⇒ **骗绿**（模拟证实 δ=250ms 即逃逸）。反向：helper 段被调度延迟 >5000ms 会使**正确实现**假红 | 见 §14 O-13（非阻断：时间线源自 SA2 iter-3 自身 A3 规格；§12 变异自检义务在实现期强制暴露该边际并迫使其修复） |

**无 CRITICAL/MAJOR/MINOR 新增**。

## 10. 协议假设依据审查

- **章节存在性**：§14 独立成章 P1-P10 ✓（P10 单调时钟 + 判活语义；本轮复核 Node 文档引用无误，
  R8-② 已按 #13 如实化——原「无据推断」瑕疵清除）。
- **依据可验证性**：P1-P9 man7/POSIX/Node 引用 + 本机探针输出内联（SA4 重跑义务沿 B2″）；钉位
  regex/文案/败者 regex 等**新增可验证主张**本轮已由 SA2 直接程序化复证（§6.1 V1-V5）。
- 本轮不需要设计补实测（探针对拍归 SA4；T7a/T7c 红灯性已由 §7 模拟替代证明，实机归实现轮）。

## 11. 错误处理链路审查

- **静默失败**：验证层的「静默」（iter-3 #12(a)）已消除——Option A 下误触发对两冻结契约**真实
  可见**（V1/V3 程序化证明），且确定性守卫（T7a②′/⑥ + T7c）不依赖该概率性兜底；机制层无新增
  静默路径（I3 + #11 errno 契约 + §9 终止性论证沿 iteration-3 裁定）。
- **状态闭环**：claim-blocked loud 终止态；boot/reload 通用 catch（main.ts L132/L193 亲读）闭环。
- **降级路径**：无伪降级——claimStuck 不夺门、可重试（T5 自动接管 / T7b 人工清除 / 监督器重启）；
  R8-①/② 如实登记（② 方向已改正）。
- **用户可感知性**：文案五要素齐全（V5）+ §11 症状→处置连接句 + 墙钟注记（#13）✓。

## 12. 契约影响与文件范围审查

| 项 | 结论 |
|---|---|
| canary / stress / fixture（DENY） | 零触碰维持（`git status` 亲证；ALLOW/DENY 与 iteration-4 同面——四 ALLOW 行未扩、DENY 未松） |
| `src/index.ts` L70 导出面 / `main.ts` | 零变化维持（亲证；claimStuckError 为 plain Error、不入 `STABLE_OP_ERROR_CODES`——L236-251 亲读无根锁码） |
| 新测试文件（ALLOW 第二行） | T1-T6 沿既有；T7a 七件断言 / T7b / T7c 为 #12 修订新增——被 vitest include 与 shard walk 自动收录（亲证） |
| 范围遵从 | 机制本体未借修订重开（§8）；全部修订落在既有 ALLOW 四行 + 设计文本内 |

## 13. 冲突复查

`requiresConflictRecheck: false` —— 本轮 pass 无设计修订；逐项对照 SA8 iteration-4 关门重触发条款：
无 fsync（R6 维持）；不触 `packages/**` 与 ADR-0006 冻结布局（T7c 助手为测试内联 `node -e`）；无新增
公共导出、claimStuck 未入 `STABLE_OP_ERROR_CODES`；无 CONTEXT.md 域词（`occupied` 为模块私有文案）；
ALLOW/DENY 零扩界；5000ms 模块私有常量、不进配置面。iteration-5 修订面（文案措辞 + 测试断言 +
引文同步）走在 SA8 B4′ 预裁路径内，SA8 iter-4 已 clear——本轮无新回炉事由。

## 14. Non-blocking observations

- **O-13（新，实现期）**：T7c 的 M2 红灯依赖「nonce A 检测延迟 δ < ≈200ms」（5200 − 5000 预算）；
  反向地，helper 任一段被调度延迟 >5000ms 会使正确实现假红。建议 SA3/SA4 落地时：(a) 轮询间隔取
  ≤25ms 且轮询与 acquire 之间零宏任务插入；(b) 在设计「≈2600ms」纬度内取更宽分段（如 ≈2800ms×2
  ⇒ 合计 ≈5600ms，δ 预算扩至 ≈600ms，单段对调度延迟余量 ≈2200ms）；(c) 可选：测试内实测 δ 并在
  δ > 150ms 时显式 fail（把边际侵蚀变 loud 而非静默弱化变异网）。**非阻断**依据：时间线源自 SA2
  iteration-3 A3 自身规格；§12 变异自检义务在实现期强制证明 M2 红——若边际不足会在自检暴露并被
  迫修复；且 maxWorkers=1 下轮询期事件循环空闲，δ 实测预期为数十毫秒。
- **O-14（新，文字级）**：§12 E9a②′ 将「基线续量合并」列为 T7a②′ 红灯属最优情形（fresh worker
  下该变体可能恰在 5000ms 整抛出而通过 ②′）——T7c 对其确定性红灯（§7 模拟），网级保证不受影响；
  实现评审不必单独复现该归属。
- **O-9（沿，已登记）**：Option A 后两冻结契约对「合法持有者被调度饥饿 >5s」极端形态真实转红——
  守卫语义；若 CI 实测出现按 R8-① 口径处置（预算变更须回炉 SA8）。设计 §12 E1/R8 已登记 ✓。
- **O-10（沿，已采纳）**：T7c 原子换名（禁 unlink+write 空窗）已写入规格四处 ✓。
- **O-11/O-12（沿）**：N1″ 轻量 ADR 裁量归 owner/总控；O2 头注勘误留实施轮；`pass` 不替代 SA4/SA7
  对实现与活链路的验证；本报告未修改任何生产代码、测试或 SA1 设计文档，
  `wiki/raw/task_ci-pr-276_sa2_review.md` 为唯一产物（原位沿革）。

## 15. 红线测试思路（闭环确认，供 SA3/SA4 直接落地）

iteration-3 §15 五条全部被设计吸收为规格（T7a②′/⑥、T7c、变异自检、E9c 观察）——本轮仅补实现期
注意事项：① T7a 的 t0/throw 须同用 `performance.now()`（勿混 `Date.now()`）；② T7c 助手 nonce 经
argv 传入、测试轮询读 claim 字节比对（勿只比存在性——防「helper 未写完即检测」）；③ T7c 断言
success 后**再**校验 owner.json=镜像=instance-C（顺序不可倒置——失败时先看到 throw 语义）；④
变异自检跑三文件（publication + canary + stress）并保留输出为评审证据（一次性，不入库）。

## 16. 结论

- iteration-5 修订**逐项、忠实、无超范围地**落实了 iteration-3 的全部 binding findings：#12 Option A
  四子项 + 验收条款（A1 文案不相交经程序化证明、钉位 regex 四处同步、SA2 自身示例缺陷被诚实披露
  并修正；A2 七件断言含下界与不相交；A3 T7c 四处一致且防退化措施在位；A4 八处清除经 grep 全量
  复核）与 #13（R8-② 方向如实化 + §11 注记）。机制本体（D1/D1′/D2/D3/D4/D6）零改动（SA8 iter-4
  引文对拍 + 本轮重放），既有七项 + #8-#11 解全部保留。
- 修订后的验收网经**可执行模拟重放**证明对五类不安全实现变异（急起 / 误触发 / 预算错误 / 合并 /
  永不抛）各有确定性红灯、对合规实现零误伤——派发指令的确认要求成立。残余为 O-13/O-14 实现期
  注意（非阻断，自检义务兜底）。
- **Verdict: pass（同意放行实施）。`requiresConflictRecheck: false`。** `pass` 仅覆盖设计层；
  实现保真（伪代码逐行落地、T7a/T7c 实机红灯性、变异自检证据、E1 ≥3 复跑、两契约零改动转绿）
  由 SA4/SA7 在实现与活链路上验证。
