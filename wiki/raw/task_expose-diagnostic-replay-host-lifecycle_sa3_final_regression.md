# SA3 终局回归诊断报告 — issue #155 全量 `pnpm test` 两例失败归因（final verification round）

**Date**: 2026-09-03（19:09–19:20 复验窗口）
**Verdict**: **环境/并发依赖的既有 flake，非 #155 回归，非确定性测试缺陷——零代码改动正当**（无任何 test weakening / skip / masking；工作树除本报告外零变更）

- **任务输入**：总控终局复跑 `pnpm test` 失败（exit 1），两例失败均位于 #155 诊断重放测试之外：
  1. `apps/yjs-server/test/phase5-mgmt-verbs-sa7.test.ts` — bump-epoch/fence 收敛测试中 `process exited awaiting read reply`（子进程在等待回执期间退出）
  2. `packages/ws-replication/test/ws-replication-sa7-issue171-real-transport.test.ts` — `expected connection state 'draining', got 'blocked'`
- **结论先行**：同一 worktree 代码在 12:35（SA7 全量）、19:09 与 19:14（本次复跑 #1/#2）三次全量 `pnpm test` 全绿（259 files / 2854 tests / exit 0）；两文件隔离复跑、满载（load≈5–6/4 核）连跑亦全绿 → **13:45 终局红为一次性环境抖动**。两文件与 ws-replication 生产代码对 HEAD `b11eb9c` **零 diff**；#155 diff 全部路径在 `diagnostics.enabled===true` 门内（两失败用例均未启用），结构性不可能引入该两失败。依据仓库既往多次同款登记（SA4 V5 注记、vitest worker RPC 超时、spawn 型 E2E 负载抖动），此类失败在该共享 4 核主机上为已知环境现象。

---

## 1. 复验命令与退出码（全部串行/独立作业，harness 后台作业收敛）

| # | 命令（cwd=repo root） | 时间 | 结果 | 日志 |
|---|---|---|---|---|
| R0 | `pnpm test`（= `NODE_OPTIONS=--conditions=nomicore-source vitest run --typecheck`）——**总控 13:45 同命令** | ~13:45 | **exit 1**：上列 2 文件失败（总控报告） | 总控侧（`git status` 佐证代码与此后逐字节一致） |
| R1 | 同上（本次复验，主机 load 2.4–3.6/4 核） | 19:09:28 → 193.01s | **exit 0**：`Test Files 259 passed (259) / Tests 2854 passed (2854) / Type Errors no errors` | `.pnpm-store/.sa3-logs/full-test-1.log` |
| R2 | 同上（稳定性第二遍） | 19:14:21 → 185.37s | **exit 0**：259/2854 全绿 | `.pnpm-store/.sa3-logs/full-test-2.log` |
| R3 | `pnpm exec vitest run packages/ws-replication/test/ws-replication-sa7-issue171-real-transport.test.ts`（隔离） | 19:12:56 → 4.82s | **exit 0**：1 file / 4 tests 绿 | `.pnpm-store/.sa3-logs/isolated-171.log` |
| R4 | `pnpm exec vitest run apps/yjs-server/test/phase5-mgmt-verbs-sa7.test.ts`（隔离） | 19:13 → 40.77s | **exit 0**：1 file / 5 tests 绿 | `.pnpm-store/.sa3-logs/isolated-p5mgmt.log` |
| R5 | R3 ×6 连跑，**3× CPU 燃烧进程满载**（load≈4.8–5.9/4 核） | 19:17–19:18 | **6/6 轮 exit 0**（每轮 4/4 tests） | `.pnpm-store/.sa3-logs/contend-171-{1..6}.log` |
| R6 | R4 同款，满载连跑 1 轮（load≈5.4/4 核） | 19:18 → 49.37s | **exit 0**：5/5 tests 绿 | `.pnpm-store/.sa3-logs/contend-p5mgmt.log` |
| R7 | SA7 当日全量（同 worktree 同代码，报告 + `.pnpm-store/.sa7-logs/full-test.log`） | 12:35:58 → 153.79s | **exit 0**：259/2854 全绿、`FULL_EXIT=0` | `.pnpm-store/.sa7-logs/full-test.log` |
| R8 | CI（ubuntu-latest，node 20/24 矩阵，含两文件） | 2026-09-03T10:23/10:30Z | **success**（`gh run list --branch main`；#220/#221 两连绿） | GitHub Actions |

**代码一致性证明**：`find apps packages domains -name "*.ts" -newermt "2026-09-03 13:46"` → **空**——总控红跑（13:45）至本次复验（19:09+）之间源码/测试零变更；13:45 与 19:09 两次运行执行的是逐字节相同的代码 → 红/绿差异只能归因于运行环境，而非代码。

**#155 文件收集证据（R1 日志摘录）**：`✓ apps/yjs-server/test/diagnostic-replay-host-lifecycle-red.test.ts (22 tests) 42225ms`；`✓ apps/yjs-server/test/diagnostic-replay-host-lifecycle-sa7.test.ts (6 tests) 7043ms`；两失败文件同轮：`✓ ws-replication-sa7-issue171-real-transport.test.ts (4 tests) 3727ms`、`✓ phase5-mgmt-verbs-sa7.test.ts (5 tests) 43829ms`。

## 2. 结构性因果排除（#155 diff 不可能导致该两失败）

### 2.1 直接零触碰
- `git diff HEAD --stat -- apps/yjs-server/test packages/ws-replication packages/namespace-registry/src/testing.ts` → **空**：两失败测试文件、ws-replication 生产代码、registry testing seam 全部未修改（两文件最后一次提交分别 b66615c / b155c73，均在 main 上长期绿）。
- 工作树 diff = 16 个修改文件 + 3 个新文件，全部落在 #155 ALLOW 范围（`apps/yjs-server/src/{app,config,index,diagnostics,diagnostic-replay}.ts` + namespace-{registry,runtime,diagnostic-log} 包 + package.json/lockfile 版本随动）。

### 2.2 共享包路径全部为「diagnosticLog 缺席 → 既有行为逐字节不变」
两失败测试均不携带 `diagnosticLog`/host 参数：
- `registry.ts`：`createRuntimeDiagResolver(undefined, clock)` → 恒 `() => undefined` 解析器（create-diagnostic.ts）；三处 RuntimeFactory 第三参 = `undefined` → `createNamespaceRuntime(handle, notifyDirty)` 两参行为原样（runtime.ts 条件展开 `diagnostic !== undefined` 才注入 seam 字段）。
- `NOOP_DIAG.emitStreamOutcome` / `emitOutcome` → no-op 单例（既有 #150 语义）。
- `plugin.ts`：`host` 第二参缺省 → `hostDiagnosticLog === undefined` → 不注入。
- 时间面：上述为 O(1) 纯函数调用 + 一次闭包构造，无 timer/scheduler/IO 路径差异。

### 2.3 app 侧唯一无条件增量 = 停机路径多一条 NDJSON 事件
`performStop` 在 `registry-stopped` 后新增 `sink({event:'diagnostics-closed'})`（`this.diagnostics?.close()` 在未启用时为 no-op）。受影响断言面核查：
- `ordered-shutdown-red.test.ts:77-86` 仅以 `findIndex` 断言 4 事件的**严格递增序**（非相邻、非全集）→ 中间多事件不破坏（该文件本次全绿佐证）；
- 两失败测试在停止前即失败（等待回执/状态机），且其进程收口走 afterEach `SIGKILL`（负 pid 进程组），**根本不经过优雅停机事件流** → `diagnostics-closed` 增量与该两失败零交集。

### 2.4 失败形态与 #155 特征不符
#155 全部代码路径（config 校验新增键、diagnostics 管理器、adapter、replay 工具）在用例配置（无 `diagnostics` 键）下不可达；两失败一在 peer 连接状态机（'blocked' vs 'draining'）、一在 spawn 子进程存活（process exited），均属于未启用诊断的既有运行面。

## 3. 归因：环境/并发依赖的既有 flake（含机理注记）

- **同码异果（flake 定义性证据）**：12:35 绿 / 13:45 红 / 19:09 绿 / 19:14 绿——四次全量、逐字节同码，仅 13:45 一次红。
- **仓库既往同款登记（本任务内即有两处）**：
  1. `task_expose-diagnostic-replay-host-lifecycle_sa4_review.md` §十 V5 归因注记（**本任务 SA4 R1**）：V5（yjs-server 存量 spawn 型 E2E）与 V3（三包 1090 例）并发时出现 **3 文件/6 用例超时失败**；隔离复跑 17/17 全绿 →「并发负载下 spawn 型 E2E 的环境抖动，非本任务回归」。
  2. SA7 报告「测试执行环境注记」：「**SA4 V5 注记的 spawn 型 E2E 并发抖动已规避**——全量套件与单文件套件串行执行」——即 SA7 为获得干净证据刻意串行；总控终局全量跑（vitest 默认多 worker 并行）恰回到该抖动暴露面。
  3. 跨任务同签名：`smoke-skeleton-red` T3/F1、`stdin-error-chain-red` F1、vitest worker `onTaskUpdate` RPC 超时、spawn EAGAIN/Cannot fork（issue-139/190 系列 SA7 报告）——该 4 核共享主机负载多租户（本次复验期间 load 2.4→5.9 波动，外部负载无法由本会话观测/控制）。
- **机理注记（未能复现，标注为假设）**：
  - (a) `phase5-mgmt-verbs-sa7`（spawn 3 进程真实拓扑 + 真实 WebSocket）：全量并行下数十个 tsx/node 子进程与外部租户争用 CPU/调度，子进程墙钟预算在 fence/收敛窗口内耗尽（issue-139 实测 fence 检出 8.3s 已接近 ackTimeoutMs=10s；`waitConverged`/`sendOp` 轮询期内子进程退出 → 「process exited awaiting reply」）；极端情况含 fork/内存预算饥饿下的进程被杀。
  - (b) `ws-replication-sa7-issue171-real-transport`（真实 TCP + 真实 timer，ACK_MS=120/DRAIN_MS=800 紧窗口）：GOAWAY 注入序列 = `peerSide.nextSequenceForReceiver()`；若注入瞬间 hub 侧恰有同序号在途帧（事件循环调度延迟放大该窗口），peer 收到重复序号 → `SEQUENCE_VIOLATION` → `connectionFatal` → 连接 'blocked' 而非 'draining'——与观察到的断言失败形态一致。属测试注入法与真实异步链路间的固有竞态窗口，非生产代码缺陷（生产侧序列记账由单一 sender 串行持有）。
  - 两假设均无法在复验窗口复现（含满载 6 连跑），登记供未来 CI/观察使用，**不构成修复依据**。

## 4. 处置决定

**零代码/零测试改动**：
1. 无确定性回归可修（2× 全量 + 2× 隔离 + 7× 满载目标复跑全绿；CI 双 node 矩阵绿）；
2. 任何「修复」将被迫：改 ws-replication 测试注入时序或 phase5 测试超时（= 为未复现 flake 弱化/掩盖测试，明确禁止）；或改生产状态机（无缺陷证据，且越 #155 DENY 边界）；
3. #155 行为完整保留（其 22+6 契约用例在两次全量中全绿）。

**后续观察项（交总控/CI）**：PR CI（ubuntu 独占 runner）为权威裁决面；若 CI 偶发复现，按 §3 机理注记定位——(b) 若在 CI 复现可评估将 `RealWireTransport.inject` 改为经 hub 侧 sender 记账注入（消除双序号源）的测试侧窄修，需另开票（涉 ws-replication 测试基础设施，不在本票 ALLOW 范围）。

## 5. 变更清单

| 文件 | 变更 |
|---|---|
| `wiki/raw/task_expose-diagnostic-replay-host-lifecycle_sa3_final_regression.md` | **新增（本报告）** |
| 其余（16 修改 + 3 新增 + wiki） | 零变更（`git status` 复验；`.pnpm-store/.sa3-logs/` 为 gitignored 日志暂存） |

无 commit、无 push（遵指令）。

## 6. 验证证据汇总（命令 → 结果）

- `NODE_OPTIONS=--conditions=nomicore-source pnpm test` → **exit 0** ×2（259/2854，Type Errors no errors；R1 193.01s / R2 185.37s）
- 两失败文件隔离：**4/4、5/5 exit 0**
- 满载连跑（load≈5–6）：ws-replication 文件 6/6 轮绿、phase5 文件 5/5 绿
- `gh run list --branch main --limit 5` → 10:23/10:30 UTC 两连 success（同代码基线 CI 绿）
- `git status`/mtime 检查 → 13:45 红跑与 19:09 复验同码；本会话零源码触碰
