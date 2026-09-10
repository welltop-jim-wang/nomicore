# SA6 诊断与验收契约报告 — CI repair：PR #276 `test (24, 4)` root-lock 双活锁竞态

> 阶段：acceptance-contract（iteration 1）。Dispatch：`sa-f61dceac-0ff6-4ea1-8b35-a935a9ed0058`
> （mabf-sa6 / CI repair）。任务目标：诊断 PR #276（head `334494dbfe59ca6e48f46179b280137023676152`，
> 即本 worktree HEAD）在 GitHub Actions 作业 `test (24, 4)`（run
> [34296011254](https://github.com/welltop-jim-wang/nomicore/actions/runs/34296011254/job/102292700330)）
> 上的具体 CI 失败，划定最小安全修复边界，并按需新建/修订可执行验收契约。Issue comments
> REST 读取为 `[]`——无 owner 追加要求。**结论：`approve`** —— 失败为
> `apps/yjs-server` 根锁（`.nomicore-lock/`）stale 回收在“owner 写入窗口”上的**既有潜伏竞态**
> （双进程同时相信自己持有根锁），与 PR #276 的 vfsl 改动无关（失败面与基座字节一致）；
> 已在本机以 CI 同形场景复现真实双活（两 worker 同一毫秒 `acquired`、持有窗口重叠），
> 契约以“加负载多轮真进程 stale 回收 = 每轮恰一个 owner”的可执行压力测试固化。

## 1. Task type and inputs

- **类型：Bug（CI repair）**。任务简报即派发注记：PR #276 head `334494d`、作业
  `test (24, 4)`、`Current Issue comments were REST-read as []`。
- 输入：PR #276（[GitHub](https://github.com/welltop-jim-wang/nomicore/pull/276)，
  base `docs/rest-namespace-create`=a1ca2d7，head `mabf/issue-266`=334494d，3 commits：
  704398c/08c0ea6/334494d，全部为 `packages/vfsl`+wiki 文档改动）；失败作业日志
  （gh CLI 拉取，run 34296011254 job 102292700330）；worktree HEAD=334494d。
- 本仓无本任务既有 SA6 产物（wiki/raw 中 issue-266 系列为本 worktree 上一任务的存档），
  原位新建；不修改任何生产实现。

## 2. Owner comment mapping

Issue/PR 评论 REST 读取为空；无 owner requirements。验收口径 = 派发注记唯一要求：
**让 PR #276 的 CI 恢复绿色且不跳过/不禁用任何测试**——即修复必须消除根锁双活竞态本身
（测试保留并继续作为契约门禁）。

## 3. SA8 constraints

CI-repair 流程无独立 SA8 冲突门禁产物（iteration 1，无 design/conflict 文件）。本 SA6 自守
边界：诊断只读 + 报告/测试/fixture 写入；不设计最终修复方案、不触碰
`apps/yjs-server/src/lifecycle.ts` 等生产实现。

## 4. Environment and baseline

- CI 失败作业：`test (24, 4)` = matrix `node: 24` × `shard: 4`（.github/workflows/ci.yml），
  步骤 `Test (shard 4/6)`：`node scripts/ci-test-shard.mjs 4 6` → 49 文件 vitest run。
  同 run 其余 11 个矩阵格全绿，含 `test (20, 4)`（同一 shard 文件清单、Node 20）。
- 本地环境：node v24.13.0（与 CI Node 24 同大版本）/ pnpm 10.28.2 / vitest 3.2.7；
  本地 `scripts/ci-test-shard.mjs 4 6` 输出 49 文件，与 CI 一致且含
  `apps/yjs-server/test/root-lock-atomic-reclaim-red.test.ts`。
- HEAD/基座同一性：`git diff a4037cf..HEAD -- apps/yjs-server packages/persistence` 为空；
  PR #276 的三 commits 对失败面（yjs-server 根锁实现与其测试）**零改动**；同一代码状态在
  本 run 之前的基座 CI 全绿（run 34236906321/34236549836 = a1ca2d7/99b9d48 success）。

## 5. Positive reproduction

### 5.1 CI 原始失败（证据 A）

`gh run view 34296011254 --log-failed`（节选，完整见
`task_ci-pr-276_sa6_ci-fail.log`）：

```
❯ apps/yjs-server/test/root-lock-atomic-reclaim-red.test.ts (7 tests | 1 failed) 1017ms
  × root lock atomic ownership > real-process stale reclaim race has exactly one live owner 866ms
    → expected [ { type: 'acquired', …(1) }, …(1) ] to have a length of 1 but got 2
  ❯ apps/yjs-server/test/root-lock-atomic-reclaim-red.test.ts:104:22
AssertionError: expected [ { type: 'acquired', …(1) }, …(1) ] to have a length of 1 but got 2
Test Files  1 failed | 48 passed (49)   Tests  1 failed | 497 passed (498)
```

即：**12 个真进程竞争者回收一个 stale 根锁时，有 2 个进程都收到了 `acquired`**
（各自随后持有 5s，消息在同一批次内到达 ⇒ 持有窗口重叠 ⇒ 双活 owner）。
测试文件断言（L104）`expect(acquired).toHaveLength(1)` 红灯。

### 5.2 本地同形复现（证据 B）

在 4 核 Linux 上用同一 worker fixture（`test/fixtures/root-lock-worker.ts`、`tsx` 加载、
同一 `acquireRootLock` 生产实现）驱动 CI 同形轮次（12 竞争者、5s 持有、首消息批收），
在环境高负载时段捕获到**真实双活**（`stream ci` round 10，1/40 轮）：

```
--- OVERLAP dump stream=ci acquired=2 ---
overlap intervals: [{instanceId:"cci-10-2",windowMs:[1788917827056,1788917829056]},
                    {instanceId:"cci-10-3",windowMs:[1788917827056,1788917829056]}]
rootDir: /tmp/rl-race-i8if6U
.nomicore-lock.json: {"instanceId":"cci-10-2",...}     ← 诊断镜像
```

两个不同 worker 进程在同一毫秒 `acquired` 且持有窗口完全重叠（2000ms）——与 CI 断言
失败同构（CI：长度 1 得 2；本地：两窗口相交）。完整 dump 见 `task_ci-pr-276_sa6_red.log`。

### 5.3 复现率画像

| 场景（均真实 worker + 生产实现，12–24 竞争者/轮，长持有） | 轮次 | 双活轮 | 速率 |
|---|---|---|---|
| 空载顺序 vitest 单跑（CI 同形 12 竞争者，无外部负载） | 60 | 0 | <1.7%（0/60） |
| 空载 v3 驱动 ×3 序列（12/24 竞争者 ± 2 burner） | 370 | 0 | <0.8%（0/370） |
| 环境高负载（他流 64 进程 churn 并存）CI 同形 | 40 | 1 | ~2.5%（1/40） |
| 环境高负载（压力测试并存）CI 同形驱动 | 200 | 1 | ~0.5%（1/200，`amb` round 7） |
| CI runner（ubuntu-latest 噪音/共享）单轮原测试 | ~18 次执行 | 1 | ~5%（CI 观测） |

结论：自然触发率低但非零，**随系统争用升高**（µs 级窗口 × 进程被抢占概率）；CI 的
单轮原测试即是一个有效的低频 canary——它已经抓到一次。任何“单轮必红”的确定性契约在
不引入生产测试钩子的前提下不可达（见 §15）。

## 6. Negative control

- 空载/常规条件下同测试 60 连跑全绿（vitest，Node 24）：证明失败不是 fixture、入口、
  超时或断言书写问题，而是竞态条件触发。
- 同轮同断言在（20,4）格绿、（24,1-3,5-6）格绿：失败不随 Node 版本/shards 确定性复现。
- 同文件其余 6 用例（正常获取/同实例识别/活 owner 拒绝/死进程恢复/迟到 release/
  畸形镜像/不可写根）在 CI 与本机均绿——锁的**非竞态语义**无回归。
- 契约负控（见 §12）：顺序交接恒单 owner；活 owner 面前 8 竞争者 0 acquired/8 rejected。

## 7. Stability, scale and timing

- 竞态窗口为进程调度级（µs–ms），触发概率随并发进程数/CPU 争用单调上升（§5.3 表）。
- 事件序（稳定复现中观测到）：先 crashed worker `acquired` → SIGKILL → stale 目录就绪 →
  N 竞争者几乎同时启动回收；双活发生于「回收者判 stale → rename 摘走**正在写入的活 owner
  目录**」窗口。
- 时序敏感点：持有窗口须 ≫ 消息收集跨度（CI 5s vs ~1s）——契约保留该形状。

## 8. Root-cause chain

| Step | Fact | Evidence | Confidence |
|---|---|---|---|
| S1 症状 | CI `test (24,4)`：12 竞争者中 2 个 `acquired`（重叠持有），`toHaveLength(1)` 红 | run 34296011254 日志 L104 | 高（直接观测） |
| S2 直接故障点 | 两个进程都从 `acquireRootLock` 成功返回（各自 `break`） | 两 worker 均发 `acquired`；本地 dump 两窗口重叠 | 高 |
| S3 触发条件 | mkdir 赢家 W 的 owner.json 写入**未完成**（O_EXCL open 建空文件 → write payload 之间存在可抢占间隙）时，回收者 R 两次读到“空 owner”判 stale | lifecycle.ts L124-127（`mkdirSync`→`writeFileSync(...,{flag:'wx'})` 非原子）；strace 证实 `openat` 与 `write` 分离 | 高 |
| S4 摘走活目录 | R 经 reap-claim 串行后重读仍空 → `claimedRaw === raw('')` 守卫通过 → `renameSync(canonical, tombstone)` 摘走 W 刚 mkdir 的活目录 | lifecycle.ts L163-176；机制与 S3 窗口自洽 | 高（代码路径唯一） |
| S5 W 仍“成功” | W 的 write/close 走已摘走目录的 fd 仍成功；`.nomicore-lock.json` 镜像写在 rootDir 下不受摘除影响 → W `break` 返回成功 | lifecycle.ts L126-128/L84-103；本地双活 dump（镜像=c ci-10-2，两窗口重叠） | 高 |
| S6 R 亦成功 | R 删墓碑（空 owner）→ 回环 `mkdir` 成功 → 新 owner 写入 → R `break` | lifecycle.ts L188/L122-128 | 高 |
| S7 最深根因 | **成功条件不验证“canonical 仍归我”**：获取成功 = mkdir + fd 写 + 镜像写，任何一步不绑定 canonical 路径的持续归属；回收判定把“owner.json 缺失/为空（活 owner 写进行中）”等同于“stale”，两读全空即放行 detach——`mkdir 是唯一线性化点` 的文档不变量（hub-peer-deployment.md L234、lifecycle.ts L106-108 注释）在“空 owner 窗口”被击穿 | 上述 + 文档 L234/242-243 | 高 |
| A1 放大因素 | ① claim 文件与 owner 文件同为“先 O_EXCL 建空、后写内容”——claim 空读可致活 claim 被 unlink、回收者并发化；② 镜像发布 EEXIST 时无条件 unlink 覆写（仅诊断件）；③ 竞争者数量/系统争用放大抢占概率 | lifecycle.ts L146-161/L84-103；§5.3 速率表 | 中 |
| E1 排除 | PR #276 改动引入回归：diff 为空、基座多轮全绿（§4） | git + CI 记录 | 高（排除） |
| E2 排除 | Node 24 语义差异：路径无版本相关 API；同代码 Node 20 格单样本绿；机制为通用调度竞态（无法在本机跑 Node 20 复核——见 §15） | §4 | 中（倾向排除） |
| E3 排除 | 测试/夹具问题（消息重复、pid 复用、超时、镜像当权）：worker 单消息协议；SIGKILL 后 `await exited` 才放行竞争者；镜像不被回收判定读取 | 代码审读 | 高（排除） |
| E4 排除 | 已释放锁的合法顺序接管被误计：本地取证窗口用“持有重叠”而非“消息计数”判定，排除顺序假阳性（v1 hold=100ms 的早期实验因持有<收集跨度存在顺序伪阳性，已废弃，不计入证据） | §5.2/§15 | 高 |

## 9. Causal experiments

1. **同形复现**：CI 场景（SIGKILL 真 stale + 12 竞争者 + 5s 持有）本地驱动 370+ 轮空载零发、
   高负载 40 轮 1 发（§5.2/§5.3）——证实竞态存在且为负载敏感，非环境伪影。
2. **窗口宽度实验**：strace 证实 `writeFileSync({flag:'wx'})` = `openat(O_CREAT|O_EXCL)` +
   `write` 两个系统调用（文件在 open 后、write 前以**空文件**存在）——R 的空读窗口物理存在。
3. **负控**：空载 60 连跑全绿、活 owner 8 竞争者全拒——断言只对竞态交错敏感（§6/§12）。
4. **伪阳性排除**：v1 实验（hold=100ms）多数多 `acquired` 实为“顺序接管”（持有短于启动
   跨度），改用长持有 + 窗口重叠判定后仅真实双活计入（§5.2 判据），并弃用 v1 数据。

## 10. Impact surface

- 生产面：`apps/yjs-server/src/lifecycle.ts::acquireRootLock`（~250 行内自洽）+ 同文件
  `publishLegacyMirror` 交互；消费方仅 `apps/yjs-server/src/main.ts`（file 模式启动与
  SIGHUP 换装，L132/L193）经 `src/index.ts` L70 re-export。`packages/persistence` 不持有该锁。
- 契约/测试面：`apps/yjs-server/test/root-lock-atomic-reclaim-red.test.ts`（CI canary，保留
  原状）+ 新增压力契约测试（§12，自动落入 shard 文件枚举）。
- 语义面：根锁保证“同 root 活跃 owner 唯一、运行期不重叠”（docs/integration/
  hub-peer-deployment.md L232-250；AGENTS.md “共享活跃 root 被拒”）。双活直接违反该
  安全不变量——**修复边界 = 使成功路径与回收判定对“空 owner 窗口”免疫**（具体方案
  由设计/实现阶段裁决；本报告只划边界与契约）。

## 11. Ruled-out hypotheses

- PR #276 内容回归（diff=0、基座绿）——排除。
- 仅 Node 24 复现的确定性缺陷——无版本相关 API；同机空载 Node 24 不红；机制与 CI Node 20
  历史压力形态同构（§15 留待交叉复核）。
- 测试夹具/超时/消息协议/pid 复用/镜像当权（§8 E3）——排除。
- reap-claim 单点串行化失效是充分原因——claim 空读可使回收者并发化，但 rename 仍单胜者，
  双活必须经空-owner 摘活路径（claim 洞仅为放大器 A1）——排除为根因。
- 迟到 release 误删后继者锁（已由 L200-233 payload 校验 + 既有测试覆盖）——非本失败路径。

## 12. Acceptance contract and test paths

**交付物**：

| 文件 | 内容 |
|---|---|
| `apps/yjs-server/test/root-lock-stale-reclaim-race-stress.test.ts` | 可执行验收契约（3 用例：单 owner 压力主契约 6 轮 + 2 负控）；当前 head 实测红（§13 第 3 条），入口真实（vitest include + shard 枚举，当前落 shard 3） |
| `wiki/raw/task_ci-pr-276_sa6_contract.md` | 本报告 |
| `wiki/raw/task_ci-pr-276_sa6_ci-fail.log` | CI 失败作业原始日志（run 34296011254 / job 102292700330） |
| `wiki/raw/task_ci-pr-276_sa6_red.log` | 本地双活复现证据（两 driver dump + 机制 + 速率画像） |
| `wiki/raw/task_ci-pr-276_sa6_stress-red.log` | 压力契约本体红跑日志（与 CI 逐字同形的断言失败） |
| `wiki/raw/task_ci-pr-276_rootlock-race-driver.mjs` | 同形竞态 driver（验证/复现工具；不入 vitest 收集） |

- **不变式（目标行为）**：任意多真进程并发回收同一 stale 根锁时，恰一个进程成为 owner；
  其余全部 loud rejected；不存在两个持有窗口重叠的 owner。
- **红灯契约（新文件）**
  `apps/yjs-server/test/root-lock-stale-reclaim-race-stress.test.ts`：R=6 轮 × 每轮
  “SIGKILL 真 stale + N=12 竞争者（CI 同形，4×25ms 分批到达）+ 2 常驻 CPU burner 争用”，
  每轮断言 ①`acquired` 恰 1；②rejected 恰 N-1 且 message 匹配 `/held|unsupported/`；
  ③权威 `owner.json` 与诊断镜像均等于唯一 winner——即 CI 失败断言（L104）的逐轮强化版；
  任一轮红即文件红（首红早退）。运行时间预算 ≈ R×2.5-3s（本地实测 6 轮 ~6-7s，可落 shard）。
  文件已通过 app tsconfig `tsc --noEmit`；被 `scripts/ci-test-shard.mjs` 磁盘枚举自动收录
  （本地验证当前落 shard 3）。含两个负控：顺序交接恒单 owner；活 owner 前 8 竞争者
  0 acquired 全 rejected。
- **旧实现预期**：红（CI 已证：单轮 ~1-5%/run；压力多轮叠加后单次执行红概率显著更高，
  且在 CI 负载噪音下会像原 canary 一样持续随机抓到；本地演示见 §13）。
- **目标实现预期**：绿（修复须结构性消除双活可能 ⇒ 任意轮数零双活，非概率性变绿）。
- 测试入口真实：文件落在 vitest include `apps/*/test/**/*.test.ts`，被
  `scripts/ci-test-shard.mjs` 磁盘枚举自动收录（本地验证 shard 4 现含原 canary 文件）。

## 13. Red/green or baseline evidence

- 红（当前 head 334494d，生产代码零改动）：
  1. CI 原始失败（证据 A，§5.1）——canary 测试在目标断言处红（run 34296011254）；
  2. 本地同形驱动双活 dump ×2（证据 B：`ci` round 10 两 worker 同毫秒 acquired 窗口重叠；
     `amb` round 7 两 worker acquired、collection 764ms ≪ 5s 持有）；
  3. **新增压力契约文件本体红跑**（`task_ci-pr-276_sa6_stress-red.log`）：attempt 1 即红，
     失败点 = 本契约第 166 行 `expect(acquired).toHaveLength(1)`——
     `AssertionError: expected [ { type: 'acquired', …(1) }, …(1) ] to have a length of 1 but got 2`
     ——与 CI 失败**逐字同形**；同次运行两个负控全绿（10ms / 572ms）；文件总时长 4.3s。
- 绿（基线/负控）：原 canary 文件空载 60 连跑全绿；压力契约在空载/常规条件下的多次
  全绿复跑（6 轮 ~6-7s）；同文件其余用例与负控全绿；基座 CI run 34236906321/34236549836
  全绿；app `tsc --noEmit` 干净。

## 14. Runner trigger evidence

- CI 触发链：PR #276 push head 334494d → workflow `CI` → 作业
  `test (24, 4)`（node 24 × shard 4）→ 步骤 `Test (shard 4/6)`：
  `files=$(node scripts/ci-test-shard.mjs 4 6)`（49 文件）→
  `vitest run $files --typecheck.enabled=false --passWithNoTests=false` → 单文件红、
  退出码 1、作业 fail、PR 检查失败（`gh pr checks 276` 仅此格 fail）。
- 本地复现入口：`vitest run apps/yjs-server/test/root-lock-atomic-reclaim-red.test.ts`
  （canary）与新增压力契约文件；worker fixture 经 `fork('--import tsx')` 真进程执行同一
  生产 `acquireRootLock`。

## 15. Unknowns and blockers

- 无 Node 20 本机环境：Node 20 × 本竞态速率未能本地复核（CI（20,4）单样本绿；机制与
  Node 版本无关的结论基于代码路径与 Node 24 复现，置信中高）。
- 本沙箱 cgroup `pids.max=256`：并发进程数受限，难以完全复刻 CI runner 的争用幅度；
  因此本地速率下界估计（§5.3）可能低估 CI 实际触发率。
- 确定性红灯依赖生产测试钩子（历史 4755e1c 曾设计 `beforeStaleReclaimDecision` 类钩子，
  现版本已无）——是否引入属设计阶段裁决；本契约按概率-压力形态固化，红/绿判据仍为
  行为断言（非 skip/only/todo/env 开关/软化）。

## 16. Temporary diagnostics cleanup

- 本沙箱 cgroup `pids.max=256` 限制驱动实验的进程规模；所有 driver/复现脚本与日志均在
  `/tmp/rootlock-repro/`（沙箱外临时产物，收尾清理），唯一保留的复现工具已固化到
  `wiki/raw/task_ci-pr-276_rootlock-race-driver.mjs`（evidence artifact）。
- 对生产实现零改动：`git status` 仅含上述 6 个新交付物（契约测试 + 报告 + 4 证据/工具），
  `apps/yjs-server/src/` 与 `packages/` 无任何 diff；strace 探针只确认系统调用序列，未注入
  代码。收尾复核：契约 + canary 双文件联跑 10/10 绿；app `tsc --noEmit` 干净；无残留
  driver/worker 进程、无 PID 文件、无 nohup/setsid 遗留。
