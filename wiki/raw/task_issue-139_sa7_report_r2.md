# SA7 动态验证报告 R2（独立复审）— Issue #139 F1 修复（commit `381b9fd`）

**Date**: 2026-08-30
**Verifier**: SA7 R2（独立动态验证；**未修改任何生产代码/测试/配置、未提交、未推送**；本报告为唯一 worktree 产物，全部验证脚本与日志在 `/tmp/sa7-139-r2/`）
**审核对象**: worktree `/home/wangjian/nomicore-fix-issue-139` @ commit `381b9fd`（HEAD 实测一致；branch `fix/issue-139-on-docs-phase-5-websocket-replication`，相对 `origin/docs/phase-5-websocket-replication` ahead 4）——即 SA3 R3 的 F1 修复提交（`apps/yjs-server/src/app.ts` + 新增 `test/stdin-error-chain-red.test.ts`，2 files / +583/−3）
**Step 0 校对**: SA4 最新 verdict = **PASS**（`task_issue-139_sa4_review_r2.md` 首部，@ `4d9fff5`；`381b9fd` 未再触发 SA4 reject）→ 按规进入独立动态验证。SA7 只能上发 fail，不下调 SA4。
**SA7 R2 Verdict**: **PASS** —— R1 的唯一阻断 F1（`verify-write` 对已知集未物化 ns 绕过 §3.4 有界等待、~50ms 快速 `write-failed`）已在载荷级证据下确认修复；本轮全部验证维度独立重跑全绿（§2–§6），无新增阻断。

---

## 0. 方法与执行纪律

- 所有命令在**独立后台进程**（`setsid nohup` 主编排 `master.sh`，六阶段严格串行，避免本 4 核共享机上并发噪声污染计时证据）执行；日志落 `/tmp/sa7-139-r2/logs/*.log`，每阶段 EXIT 码记账（全部 =0）。
- 未采信 SA3 R3 / SA4 报告中的任何运行结果；复现脚本由本轮独立重写（`/tmp/sa7-139-r2/{lib,f1-repro,e14b-bounded}.mjs`，方法论沿用 R1 已证配方以保可比性），worktree 零写入（`git status` 复核仅 `?? wiki/raw/task_issue-139_*`）。
- 进程纪律：运行前 `pgrep -af 'yjs-server/src/main.ts'` 确认无残留；每轮套件/冒烟后复查孤儿（全部 "no orphan"）；4×CPU 燃烧进程结束即 `kill -9` 清场（burner pid 文件已删，末次复核无 burner/yjs 残留，load 回落 0.08）。未知进程一律保留。
- R1 记录的本机线程/进程预算上限（§7-O4）：本轮全程串行，未出现 `spawn EAGAIN`/`SIGABRT` 类环境形失败，全部批次的失败分类无需打折。

## 1. 修复面独立复核（源码级）

`git diff 4d9fff5..381b9fd` 实测仅两文件：`apps/yjs-server/src/app.ts`（+45/−3）与 `apps/yjs-server/test/stdin-error-chain-red.test.ts`（新建 538 行，设计 §8 ALLOW LIST 明列文件名）——与 SA3 R3 §3 声明一致，零 `packages/**` 改动，未修改任何既有测试文件。

`opVerifyWrite` 新逻辑（`app.ts:510-534` + `openWriteNamespace:599-622`）：

- `registry.open` 的 `NAMESPACE_NOT_FOUND`（本地记录未物化 = 复制收敛/恢复路径上的瞬态）在**单 op deadline**（`Date.now()+waitMs`，缺省 30s、`timeoutMs` 钳位 [1,120000] 不变）内以 50ms 间隔重试；
- deadline 达成仍未物化 → `verify-write-timeout`；非 NOT_FOUND 真实错误 → 立即 `write-failed`（不吞错、不冒充超时）；open 成功后 `waitNamespaceLive` 用**同一 deadline 的剩余预算**（`Math.max(0, deadline - Date.now())`），等待总预算不叠加——与设计 §3.4 冻结契约（「等待该 ns state=live 的 deadline … 超时 → verify-write-timeout（不挂起、不静默）」；`write-failed` 仅限等待达成后 `mutateRoot ok:false`）现在对「已知集但未物化」ns 成立；稳定码注册表零新增（append-only 保持）。

R1 §2.5 修复方向（open 失败且 ns ∈ 已知集 → deadline 内重试、超时 `verify-write-timeout`；`write-failed` 收缩回真实错误/物化后失败）被逐条落实。

## 2. 定向套件多轮（app suite ×4 连绿）

命令：`./node_modules/.bin/vitest run apps/yjs-server/test`（worktree 根，串行 ×4；日志 `logs/suite-rounds.log`）

| 轮次 | 结果 | 明细 | 孤儿检查 |
|---|---|---|---|
| run 1 | ✅ EXIT=0 | 7 files / **35 tests** 全绿（36s） | 无残留 |
| run 2 | ✅ EXIT=0 | 7 files / 35 tests 全绿（36s） | 无残留 |
| run 3 | ✅ EXIT=0 | 7 files / 35 tests 全绿（36s） | 无残留 |
| run 4 | ✅ EXIT=0 | 7 files / 35 tests 全绿（35s） | 无残留 |

对照 R1 基线（同命令 @ `4d9fff5`：**1/3 轮红**，`smoke-skeleton-red` 用例 1 `expect(writeReply.ok)` @874ms 快速失败 = F1 签名）：本机近无载条件下 R2 **4/4 连绿**，R1 的套件不稳定根因随修复消失。7 files 含 SA6 全部红测（smoke/ws-transport/app-config/ordered-shutdown/hub-restart T6/third-party-composition）+ SA3 新增 T7 文件。

## 3. 隔离 smoke 多轮（×5 连绿）

命令：`./node_modules/.bin/vitest run apps/yjs-server/test/smoke-skeleton-red.test.ts`（串行 ×5；日志 `logs/smoke-rounds.log`）

| 轮次 | 结果 | 明细 | 孤儿检查 |
|---|---|---|---|
| run 1–5 | ✅ 全部 EXIT=0 | 每轮 1 file / **3 tests** 全绿（~35s/轮；用例 1「verify-write 收敛」11.3s、用例 2「锁释放 + durable 回读」17.2s、用例 3「共享 root 拒」6.2s） | 每轮后均无残留 |

R1 §2.1b 同隔离批次：**1/5 红**（run 2 用例 2，719ms 快速失败，load 仅 0.44）。R2：**5/5 绿**——R1 指认的两处概率性失败面均闭合。

## 4. F1 定向复现（独立复写 R1 §2.2 配方；共 34 个收敛迭代 + 10 个有界超时迭代）

场景 = smoke 用例 1 精确链路：hub（file+provision+authorization）boot → peer（静态 target）`ready` 事件后**立即**（settle=0，命中未物化竞态窗口）`verify-write{timeoutMs:30000}`，每迭代全新 hub+peer 进程组（`node /tmp/sa7-139-r2/f1-repro.mjs <N> <settleMs>`）。

| 批次 | 条件 | N | 结果 | opMs 分布 | R1 同形状对照 |
|---|---|---|---|---|---|
| 近无载 | settle=0，load 0.11 | 12 | ✅ **12/12 ok:true**，`fastFailLt1s=0` | 50–151ms | **1/12 fail**（`write-failed` @50ms） |
| 4 路 CPU 打满 | settle=0 | 12 | ✅ **12/12 ok:true**，`fastFailLt1s=0` | 99–203ms | **7/10 fail**（全部 `write-failed` @49–53ms） |
| 4 路 CPU 打满（对照） | settle=1500ms | 10 | ✅ **10/10 ok:true** | 50–51ms | 0/10 fail（与 R1 一致） |

- **断言一（正常收敛期无即时 write-failed）**：三个批次合计 34/34 全部 `ok:true`，`write-failed` 出现 0 次，其中 opMs<1s 的快速失败 0 次（`fastFailLt1s=0` 记账于每批 SUMMARY 行）。
- 满载真实性佐证：燃烧期 1 分钟 load 均值实测 **3.82**（紧随满载批次的 e14b 阶段头部采样，恰为 4 燃烧核形状）；满载批 opMs 整体上移（99–203ms vs 无载 50–151ms）、批次耗时 83s vs 74s——争用真实存在，且不再产生任何 `write-failed`（R1 满载下同窗口 70% 命中率，现为 0）。

### 4.1 永不可物化已知 ns 的有界超时行为（E1-4b / 设计 §5-T7 规格，×10）

`node /tmp/sa7-139-r2/e14b-bounded.mjs 10`（每迭代全新 hub+peer；peer `add-target` `ns-deadbeef×4`（文法合法、hub 从未创建）后 `verify-write{timeoutMs:500}`；日志 `logs/e14b-bounded.log`）：

| 断言 | 结果（10/10 迭代全过） |
|---|---|
| 回执码 | ✅ 全部 `{"ok":false,"code":"verify-write-timeout"}`——**零次** `write-failed`（R1 同规格实测 ~51ms `write-failed` = 红） |
| 有界窗口 | ✅ 全部 501–554ms ∈ [450, 8000)——deadline 真正执行到位（≈500ms+50ms 重试间隔量化），不挂起、不静默 |
| 负例对照（未知集 ns） | ✅ 每迭代 `verify-write` 文法合法但不在已知集的 ns → **即时** `namespace-unknown` @49–51ms（有界等待没有被泛化成「什么都等」） |
| 进程存活 | ✅ 每迭代后续 `status` ok（控制通道不因输入退出） |

R1 §2.4 的 E1-4b 红（`write-failed` in 51ms）现为确定性绿——设计 §5-T7 冻结用例动态执行通过。

## 5. 类型检查（独立复跑，全绿）

| 命令 | 结果 |
|---|---|
| `./node_modules/.bin/tsc -p apps/yjs-server/tsconfig.json` | ✅ **EXIT=0**（含新测试文件的收集面） |
| 逐项目 `tsc -p`（11 packages + app，镜像 `pnpm typecheck` 全链） | ✅ **12/12 EXIT=0，FAIL=0** |
| `pnpm typecheck` | ✅ **EXIT=0** |

日志：`/tmp/sa7-139-r2/logs/typecheck.log`。

## 6. 纪律复核（收尾状态）

- worktree `git status`：仅 `?? wiki/raw/task_issue-139_*`（SA 产物）；HEAD 仍 = `381b9fd`，**未提交任何内容**。
- 无 burner / yjs-server 残留进程（`pgrep` 复核；burner pid 文件已随清场删除）；1 分钟 load 回落 0.08。
- 新测试文件进程治理复核（静态）：`detached:true` 独立进程组 + afterEach `kill(-pid)` 组杀——R1 §7-O2 的 tsx 包装层孤儿泄漏教训已落实；本轮 9 轮套件/冒烟后的孤儿检查全部为空，动态侧证有效。

## 7. CI 触发证据（skill Step 3/4）

- **阻塞（非 SA7 可解，沿 R1 §8 记账）**：分支仍未推送——`git status -sb` = `ahead 4`（相对 `origin/docs/phase-5-websocket-replication`）；`origin` 无同名远端分支（`git branch -r` 计 0）；`gh run list --branch fix/issue-139-…` 与 `gh pr list --head …` 均空 → **无 CI run/PR 可摘录**。SA7 不负责 push/建 PR；spec/vitest 触发证据待推送后由后续轮补。
- 静态门禁独立复核：根 `vitest.config.ts` include 含 `apps/*/test/**/*.test.ts`（新增 `stdin-error-chain-red.test.ts` 在 CI `pnpm test` 收集面内）；`.github/workflows/ci.yml` `Typecheck: pnpm typecheck` + `Test: pnpm test`——两者本轮均已在本地以同等命令取得 EXIT=0（§2/§5）。

## 8. 非阻断观察（记账，无升级项）

| # | 级别 | 发现 | 备注 |
|---|---|---|---|
| O1 | MINOR（沿 R1 §7-O1，SA3 R3 §4 已记） | `opRead`（`app.ts:470-471` 附近）对未物化已知 ns 仍即时 `read-failed`——设计对 read 无 verify-write 同款有界等待契约，不属 F1 范围 | 本轮 E1-4b 负例（未知集 ns → `namespace-unknown`）与套件全绿侧面确认 read 行为未因修复回归；是否扩展属 SA1/SA2 设计裁定 |
| O2 | INFO | 满载批 `load=` 采样点在燃烧 1s 后（1 分钟均值滞后），争用真实性以 §4 的 load 3.82 次点采样 + opMs 上移 + 批次耗时佐证 | 后续轮可在批次中点采样佐证（对本轮结论无影响：满载形状 0 fail） |
| O3 | INFO | CI 证据沿 R1 阻塞（未推送/无 run/无 PR） | 非产品缺陷；静态门禁 + 本地 CI-parity（app 套件 + pnpm typecheck 全绿）已在案 |

## 9. 结论

| 维度 | R1（@4d9fff5） | R2（@381b9fd，本轮独立） |
|---|---|---|
| 定向套件 | ❌ 1/3 轮红（F1） | ✅ **4/4 连绿**（7 files/35 tests） |
| 隔离 smoke | ❌ 1/5 红（F1） | ✅ **5/5 绿**（3 tests/轮） |
| F1 定向复现（无载 settle=0） | ❌ 1/12 `write-failed` | ✅ **12/12 ok** |
| F1 定向复现（4 路满载 settle=0） | ❌ 7/10 `write-failed` | ✅ **12/12 ok**（≥10 次要求满足） |
| 满载对照（settle=1500） | ✅ 10/10 | ✅ **10/10 ok** |
| E1-4b 永不可物化已知 ns | ❌ `write-failed` @51ms | ✅ **10/10 `verify-write-timeout` @501–554ms**（有界、不挂起；未知集 ns 负例仍即时 `namespace-unknown`） |
| 类型检查 | ✅ | ✅ app tsc / 12 项目链 / `pnpm typecheck` 全 EXIT=0 |
| CI 触发证据 | ⚠ 未推送阻塞 | ⚠ 同（静态门禁 + 本地 parity 在案） |

**Verdict: PASS** —— R1 唯一阻断 F1（`verify-write` 有界物化等待被绕过）已修复并经本轮独立动态验证闭合：正常收敛期（含满载竞态窗口）34/34 无任何即时 `write-failed`；永不可物化已知 ns 10/10 于 deadline 后有界返回 `verify-write-timeout` 且不挂起；未知集 ns 负例保持即时 `namespace-unknown`（契约未被泛化破坏）；套件/隔离 smoke 多轮连绿；类型检查全绿。未发现新增阻断或回归。

---

## 附录 A：命令与日志索引（全部独立进程执行，`/tmp/sa7-139-r2/`）

| 产物 | 路径 |
|---|---|
| 主编排（六阶段串行，EXIT 记账） | `logs/master.log` + `logs/master-nohup.log`（SA7R2-MASTER-DONE） |
| app 套件 ×4 | `logs/suite-rounds.log` |
| 隔离 smoke ×5 | `logs/smoke-rounds.log` |
| F1 无载 ×12 | `logs/f1-unloaded.log` |
| F1 满载 ×12 + 对照 ×10 | `logs/f1-loaded.log` |
| E1-4b 有界超时 ×10 | `logs/e14b-bounded.log` |
| 类型检查（app + 12 项目 + pnpm） | `logs/typecheck.log` |
| 驱动库/场景脚本 | `lib.mjs`、`f1-repro.mjs`、`e14b-bounded.mjs`、`{suite,smoke,f1-unloaded,f1-loaded,e14b,typecheck,master}.sh` |
