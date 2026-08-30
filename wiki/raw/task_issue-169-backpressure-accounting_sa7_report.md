# SA7 动态验证报告 — issue #169 连接级背压记账 / 控制保留额度 / poll 公式

**Date**: 2026-08-30（R1）/ 2026-08-30（R2 复证，见文末「SA7 R2」节）
**Verdict**: R1 = pass（3 项动态重点复核 + 2 项设计接受面量化登记）→ 双轴 final review **BLOCK**（D1 特性化的过释放面违反 §17 未冲刷控制上限不变量）→ SA1 v5 §3.5（SA2 R12 pass）→ SA3 `8da8692` → **R2 = pass**（D1 反转独立复证：data flush 零释放控制额度、第 n1+1 帧拒纳不上 wire、恰一次耗尽、wire ≤ quota；红灯 17/17 + 全量 174/174 + typecheck/diff-check 全绿）
**被验对象（R1）**: SA3 commit `541c3b7`（base = ef19bae），worktree `/home/wangjian/nomicore-fix-issue-169`
**被验对象（R2）**: SA3 commit `8da8692`（R12 kind-aware 保守控制退休；= HEAD，SA4 R3 pass 的固定代码基线）
**输入**: SA4 静态验尸（R1 pass / R2 reject / R3 pass）、SA6 红灯契约（17 用例）、SA5 缺陷分析、SA1 设计 v4→v5.2（§3.5 R12）、双轴 final review（BLOCK）、SA7 R1 报告（D1/D2）

---

## 0. Step 0：SA4 verdict 校对

```
SA4 verdict: pass（task_issue-169-backpressure-accounting_sa4_review.md L4）
操作: 进入 Step 1
```

## 1. Step 1：SA6 红灯复跑（第二关）

命令（后台独立进程，fake scheduler，零 real sleep）：

```bash
pnpm exec vitest run packages/ws-replication/test/ws-replication-issue169-backpressure-accounting-red.test.ts
```

结果：**🟢 GREEN — `Tests 17 passed (17)` / `Type Errors no errors` / exit 0**（13 红灯修复全绿 + 4 锚保持）。

```
[SA7 Step 1 结论] SA6 红灯: 🟢 GREEN → 进入 Step 2
```

## 2. Step 2：SA4 动态审核重点逐条验证

SA4 §3 移交清单逐条复核。新增补充测试文件
`packages/ws-replication/test/ws-replication-sa7-issue169-dynamic.test.ts`（2 用例，永久入库）：

### 重点 1：混合冲刷下控制额度过释放（quota over-release）——✅ 动态确认（有界、终局可达；设计已接受面）

**验证方式**：D1 用例（seam 级确定性复现——真实 `ConnectionSender` + 真实 `OutboundQueue` + 真实 codec，仅 transport `bufferedAmount` seam 为协议既定可注入边界）。SA4 建议的「真实 TCP + 归因观察」入口在真实内核上不可确定性构造部分显影/部分冲刷（归因面不可控），故归因验证取 seam 确定性路径 + 既有真实 TCP A/B 套件（见重点 3）共同覆盖。

**构造**（cap 1MiB / highWater 8KiB / maxQueuedControlBytes=QUOTA 160KiB / maxBootstrapBytes 16KiB）：
P1 同步栈 6×16KiB data 直发（buffered 恒 0 滞后，FIFO data 积压 98,658B）→ P2 transport 显影吸收 61,440B（Δ>0 弹出同额，水位 > highWater 入暂停窗口，FIFO 队首留窗口前未吸收 data 积压）→ P3 窗口内控制流 batch1 = 9 帧（真实未冲刷控制 148,293B，未触收口）→ P4 **混合冲刷**：缓冲内 61,440B **data** 字节离开 socket（控制字节一字未动）→ P5 batch2 继续控制帧直至（账本）额度耗尽。

**实测（[SA7-DIAG] 量化，已还原）**：

```text
n1=9, n2=3, F_CTRL=16477, F_DATA=16443
wireControlBytes=197724 > QUOTA=163840      ← 过释放显影：窗口内控制上线超 maxQueuedControlBytes
过纳量 = 33,884B（≈ +2.06 帧）≤ dataBacklog=98,658B（≤ cap）   ← SA4 上界声明成立
exhausted=1                                  ← 账本耗尽后 1011 终局恰一次可达（非无界逃逸）
```

**机理确认**：`observe()` 的 Δ<0 释放（backpressure.ts:290-293）按 `min(|Δ|, controlUnflushed)` 全额释放策略账，不区分离开字节属于 data 还是 control——data 冲刷亦释放控制额度，与 SA4 静态判读一致。

**定性**：设计 v4 §3.2 批准形状（SA2 R11 复核通过）的忠实实现，**非本轮实现偏差**；过纳有界（≤ 窗口前 data 积压 ≤ cap，病态混合 jam 最坏 ~2× quota 后 1011），且相对修复前「冲刷永不释放→误杀合法连接」是严格改进。**维持 SA4 建议**：后续轮以「Δ<0 时按 FIFO 弹出的 control-kind 字节数释放」收窄（≈3 行，属设计修订面，需 SA1/SA2 走查）。D1 中标注 ★ 的断言即该修订的回归锚（修订落地时翻红，更新断言即可）。

### 重点 2：Δ≡0 write-through-0 悬崖的数据面饱和签名——✅ 真实链路如期可观测（设计 §14.4 sanctioned 面，已固化为可观测契约）

**验证方式**：D2 用例——真实 `node:net` TCP loopback + 真实 `socket.writableLength`（零注入）+ 真实 timer，长寿命连接、帧间 settle 节奏（每帧后等 writableLength 写穿归 0 再写下一帧）、cap 显式降为 1MiB 使饱和在测试体量内可达（缺省 8MiB 同构，仅尺度不同）。

**实测**（D2 全绿，2.27s）：帧间 settle 节奏下连续 64KiB UPDATE 写入，饱和到达后 §13.11 饱和签名四要素全部如期可观测：

| 签名要素 | 实测 |
|---|---|
| ① 预算耗尽纯粹来自已交付字节 | peer 实收 UPDATE 字节 > cap − 70KiB，且此刻 `writableLength === 0`（socket 实际为空——「占用」是 FIFO 永久残差的幻影） |
| ② 恢复环再拒（声明单调升） | peer 收 RESYNC_REQUIRED 发起新 round，round 完成后新写仍恒拒（残差不随恢复清除）→ RESYNC_REQUIRED ≥ 2 |
| ③ UPDATE 字节平 | 饱和后新写零交付（平线断言 ≤ 4KiB 容差，实测零增长） |
| ④ 无终局信号 | 零 ERROR、零 close(1011)、连接保持 `ready`——锁死而非收口（静默活锁形态） |

**定性**：与设计 §14.4 预期逐项一致（协议 §17「缺面视为 0」sanctioned；恒 0 读数子类 → 永不暂停 → 额度 dormant 免检 → 数据面靠预算准入收口）。#164（生产 Adapter 三面装配期响亮断言）为上线前置，已登记，非本轮修复面。D2 落实设计 §14.4「可观测契约（本任务落地面）」：把「接受」从静默变为受测契约。

### 重点 3：真实 TCP 用例 B 耗尽点漂移——✅ 本地零漂移（CI 面待发布后观察）

既有 `ws-replication-sa7-r2-transport.test.ts`（用例 A/B，新冲刷释放语义下 SA4 实测 B=814ms）本轮两度复跑：

```text
全量套件内：A/B 通过（24 文件 174 用例之一）
独立复跑：  Test Files 1 passed (1) | Tests 2 passed (2)，B 耗尽侧 610ms，exit 0
```

本地无漂移、无 flake。CI 低速/共享 runner 面属发布后观察项（见 §4）；若复现 flake，按设计 §14.3 配方加 topUp 维持饱和（SA6 校准域）。

## 3. 新增补充测试（交付物）

`packages/ws-replication/test/ws-replication-sa7-issue169-dynamic.test.ts`（未跟踪新文件，待 Runner 随本轮入库）：

| 用例 | 覆盖 | 断言要点 |
|---|---|---|
| D1 | SA4 重点 1（seam 确定性） | 混合冲刷过释放显影（wireControl > QUOTA）+ 上界（≤ data 积压）+ 终局恰一次 1011；★ 断言为 control-kind 归因修订的回归锚 |
| D2 | SA4 重点 2（真实 TCP E2E） | §13.11 饱和签名四要素（交付≈cap 且 socket 空 / RESYNC 环 ≥2 / UPDATE 平 / 零 ERROR·零 close·ready） |

测试纪律：真实组件直构（零 mock 业务面）；D2 有界 real wait 属真实链路集成抽样类（header 显式声明，与 r2-transport 同类）；`[SA7-DIAG]` 临时日志已还原（`git status` 除新文件与 wiki 档案外零改动）；无尾随空白/Tab；未修改任何生产代码。

## 4. 验收命令证据（2026-08-30 本 worktree 实测，全部后台独立进程）

```bash
pnpm exec vitest run packages/ws-replication --typecheck
  → Test Files 24 passed (24) | Tests 174 passed (174) | Type Errors no errors | exit 0
  （SA4 轮 23 文件/172 用例 + 本轮新增 2 用例；含红灯契约 17 用例 ✓、r2-transport A/B ✓）
pnpm run typecheck        → exit 0（含 packages/ws-replication/tsconfig.json）
git diff --check          → exit 0
```

任务验收标准中 fairness / control priority / no-starvation / bounded-memory 回归均在 174 用例内绿。

## 5. Spec / vitest 触发证据（Step 3 / Step 4 立法）

- **Step 3（E2E spec）**：N/A——本任务无 `*.spec.ts` 文件（SA4 §1.9 同裁定）。
- **Step 4（vitest package）**：`gh pr list --head fix/issue-169-on-docs-phase-5-websocket-replication` → `[]`；`gh run list` 该分支 → 空；`git ls-remote` 远端无该分支——**分支未推送、无 PR、CI 未启动**。CI 动态触发证据属发布后面（环境未就绪，非验证失败）。静态接通已由 SA4 §1.9 核对（根 `pnpm test` = `vitest run --typecheck`，`packages/*/test/**/*.test.ts` include 覆盖含新文件在内的全部 ws-replication 测试——本机全量 24 文件被同一配置收集执行即为本地等价证据）。**请总控在 PR 建立后以 `gh run view --log` 摘录 `Running N tests`/`Test Files N passed` 补齐该段**。

## 6. 遗留登记（非阻断，供后续轮）

| # | 事项 | 来源 |
|---|---|---|
| F1 | 混合冲刷额度过释放收窄（Δ<0 按 control-kind 归因，≈3 行，设计修订面需 SA1/SA2 走查）；D1 ★ 断言为回归锚 | 本轮 D1 量化确认（+33,884B / quota 163,840B，有界） |
| F2 | Δ≡0 悬崖的生产面收口依赖 #164（生产 Adapter bufferedAmount/ping/onPong 三面装配期响亮断言）——上线前置 | 本轮 D2 真实链路确认签名可观测 |
| F3 | 真实 TCP 用例 B 在 CI 低速 runner 的时序漂移观察（flake 则按 §14.3 加 topUp） | 本轮本地零漂移；CI 待 PR |
| F4 | SA4 N1（R3 双账本拆分无独立护栏）部分缓解：D1 现钉死 controlUnflushed 策略账行为面；data 侧 pendingDataHandoff 精度面仍无独立用例 | SA4 §2 N1 |

## 7. Verdict（R1，2026-08-30）

**pass**。SA4（pass）移交的 3 项动态重点全部在真实运行环境完成复核：重点 1 确认存在但有界且终局可达（设计 v4 批准形状，量化登记 + 回归锚）；重点 2 饱和签名在真实 TCP 上如期可观测（协议 sanctioned 面，已固化为受测契约）；重点 3 本地零漂移。SA6 红灯 17/17 绿、全量 24 文件 174 用例绿、typecheck/git diff --check 零瑕疵；新增 2 用例入库无断言削弱、零生产代码改动。CI 动态触发证据因分支未发布而待补（§5），不构成本地验证缺口。

> **R1 后续**：双轴 final review（standards/spec 两独立轴）对本报告 D1 特性化的过释放面裁定 **BLOCK**——「data-only flush 不得释放仍未冲刷控制帧的额度」为协议 §17 不变量，D1 当时将其编码为预期行为不能洗白。SA1 设计 v5 §3.5（R12，SA2 复审 pass）→ SA3 `8da8692` 修复。R2 复证见下节。

---

# SA7 R2 复证 — R12 kind-aware 保守控制退休（2026-08-30，HEAD=`8da8692`）

## R2.0 Step 0：SA4 verdict 校对

```
SA4 verdict: R3 = pass（sa4_review.md 头部 Verdict 行；三项设计文本阻断在 v5.2 闭合，
             代码基线 8da8692 不变：git diff 8da8692 HEAD -- packages/ apps/ 为空）
操作: 进入复证
```

被审修复：`8da8692`（单 commit，改 `backpressure.ts` +109 行与 SA7 动态测试文件——后者将 R1 未跟踪的 D1/D2 一并入库并反转 D1）。

## R2.1 SA6 红灯 + SA7 动态复跑

```bash
pnpm exec vitest run packages/ws-replication/test/ws-replication-issue169-backpressure-accounting-red.test.ts \
                        packages/ws-replication/test/ws-replication-sa7-issue169-dynamic.test.ts
→ Test Files 2 passed (2) | Tests 19 passed (19) | Type Errors no errors | exit 0
（红灯契约 17/17 含 G3a（首过限帧+恰一次耗尽）/G9（1011 接线 E2E）锚；D1 反转版 + D2 各 1）
```

## R2.2 D1 反转核验（本轮核心指令）

**断言强度审查（SA3 在 8da8692 中反转 D1——非削弱，精确对立面）**：R1 的 ★ 特性化断言（`n2 > 0` / `wire > QUOTA`）被替换为其修复后对立面，且 P4 注释保留 v4 反事实（旧语义此处按 `min(|Δ|)` 释放 → 对立面断言翻红）——判别力保持：

| 指令要求 | 反转后 D1 断言（实测绿） | 实测值 |
|---|---|---|
| data flush 不释放 control quota | `n2 === 0`（batch2 零放行） | 0 |
| 第 10 control 拒绝不上 wire | `emittedControlCount === n1`（n1=9） | 9 |
| 恰一次耗尽 / 1011 接线 | `exhausted === 1`（1011 收口接线由红灯锚 G3a/G9 钉死，本轮 17/17 绿） | 1 |
| wire ≤ quota | `wireControlBytes ≤ QUOTA` 且精确 `= n1×F_CTRL` | 148,293 ≤ 163,840 |

**独立翻转证明（临时探针 A，`it.fails` 装载 R1 旧断言，取证后已删除）**：在 `8da8692` 上重放 R1 D1 场景并断言旧 v4 预期（`n2 > 0` / `wire > QUOTA`）→ 断言必抛 → `it.fails` 绿。若回退旧语义，该探针翻红。**翻转由独立构造证实，非仅采信 SA3 改写的测试**。

**kind 归因正向对照（临时探针 B，取证后已删除）**——防「一刀切不释放」的过保守伪修复：

```text
[SA7-DIAG-R2] 探针B {"n1":9,"n2":5,"expectedN2":5,"F_CTRL":16477,
                    "releasedByControl":69185,"wire":230678,
                    "trueUnflushedControl":107798,"QUOTA":163840}
```

混合队列（data 候选 + control 在场）下冲刷 122,880B：①data 候选 53,695 先耗尽 → 释放恰 69,185B（=③④实际退休的控制字节）→ batch2 放行 5 帧**与归因账逐值一致**（expectedN2=5 实测 5）；§17 不变量按**真值口径**复核：未冲刷控制字节 107,798 ≤ 163,840 ✓；账本边界到达后恰一次收口。→ 释放既非 v4 的「data 冲刷也释放」，也非「永不释放」的死锁，恰由退休控制字节驱动。

**R1 报告勘误（登记）**：R1 §2 重点 1 以「累计 wire > QUOTA」为过释放显影判读——该判据仅在「零控制冲刷」构造下成立（D1 场景控制一字未动，恰满足）；累计 wire 不是协议不变量，**未冲刷控制字节 ≤ maxQueuedControlBytes** 才是。R2 已按真值口径复核（上）。

## R2.3 实现机制抽查（对照设计 v5 §3.5）

`observe()` 符号分支逐行核对：Δ>0 弹出按 kind 累积 `unretiredAbsorbedData/Control`（超队列余额 = 外部积压不作候选）；Δ<0 退休优先序 ①absorbedData→②handoffData→③absorbedControl→④handoffControl，`controlUnflushed -= min(r3+r4, controlUnflushed)`——仅 ③④ 驱动额度释放（硬不变量落点）；压力侧总弹出量 = min(|Δ|, 全部候选余额)（与 v4 总量一致，仅归因序改 data 优先）；`teardown` 清零两候选计数（NC-8）✓。D2（Δ≡0 饱和签名）与 R12 零机制交叠（恒 0 读数面无 Δ≠0），保持绿 ✓。

## R2.4 全量验收（2026-08-30 本 worktree 实测）

```bash
pnpm exec vitest run packages/ws-replication --typecheck
  → Test Files 24 passed (24) | Tests 174 passed (174) | Type Errors no errors | exit 0
pnpm run typecheck → exit 0；git diff --check → exit 0；tracked 文件零改动
```

临时探针文件已删除（`git status` 无残留）；本轮零生产代码、零入库测试改动（用户指令：仅诊断测试自行处理——探针证据已归档于 R2.2）。

## R2.5 Spec / vitest 触发证据（Step 3/4）

Step 3 N/A（无 `.spec.ts`，同 R1）。Step 4：分支仍未推送（`git ls-remote` 远端无 169 分支）、无 PR、无 CI run——CI 动态证据仍属发布后面，待总控 PR 后摘录补齐（本地等价证据：全量 24 文件由 CI 同一 vitest 配置收集执行）。

## R2.6 遗留登记更新

| # | 事项 | R2 状态 |
|---|---|---|
| F1 | 混合冲刷额度过释放收窄 | **已闭合**（R12 落地 + R2 独立复证；D1 反转为安全回归 + 探针 A/B 双向证明） |
| F2 | Δ≡0 悬崖生产面收口依赖 #164 | 保持（上线前置；D2 本轮复跑绿） |
| F3 | 真实 TCP 用例 B CI 漂移观察 | 保持（本地复跑绿；CI 待 PR） |
| F4 | data 侧 pendingDataHandoff 精度面无独立用例 | 保持（非阻断） |

## R2.7 Verdict（R2，2026-08-30）

**pass**。核心指令四要素全部独立复证：data flush 零释放控制额度（D1 反转断言 + 探针 A `it.fails` 独立翻转证明）、第 n1+1 控制帧拒纳不上 wire（emitted = n1 = 9）、恰一次 CONNECTION_BACKPRESSURE（1011 接线锚 G3a/G9 绿）、窗口内控制上线 148,293 ≤ quota 163,840；探针 B 证明归因精确且非过保守（释放量 = 退休控制字节，真值未冲刷控制 ≤ quota）。红灯 17/17、D2 真实 TCP 饱和签名、全量 24 文件 174 用例、typecheck、git diff --check 全绿；SA3 对 D1 的反转经断言强度审查非削弱。无新增否决项；CI 动态证据待发布后补（R2.5）。
