# Issue #226 — SA3 R1 后独立动态复验报告（final re-verification R1）

- 被验对象：SA3 R1「本地 E2E 前置修复」（dispatch `sa-b678ff13`，`task_issue-226_local_e2e_prereq_fix.md`）
  + SA4 R1 implementation-review approve（`task_issue-226_local_e2e_prereq_fix_review.md`）之后的当前 #226 实现全集
- Worktree：`/home/wangjian/nomicore-fix-issue-226`（branch `mabf/issue-226`，HEAD `45a22f0`，实现全集未提交态）
- 输入产物（全部亲读）：R1 修复报告、R1 review、`task_issue-226_final_verify.md`（原独立动态终验 approve）、
  `20260906-issue-226-final-full-run.md`（原全量回归完整输出）、`task_issue-226.md` 简报链
- 本轮性质：独立动态复验——不信任前轮口头结论，全部证据本轮亲测重取；零代码改动（生产/测试均未触碰）。
- 环境：node v24.13.0 / pnpm 10.28.2；宿主 4 核共享，load 6.31/6.92/7.08（与原终验同量级）。
- 时间：2026-09-06 14:00–14:12 CST；全部测试经单一后台 Job（bash-58）内**顺序执行**（vitest `maxWorkers:1`，
  避免自致负载），真实退出码；日志 `/tmp/issue226-reverify/seg{1..5}-*.log`。

## Verdict

**approve**（fail-needs-fix / fail-needs-redesign 均不适用）

## 1. 动态复验结果（Job bash-58，五段顺序、真实退出码）

| # | 模式 | 命令 | 结果 |
|---|---|---|---|
| 1 | **裸跑**（Controller 原复现失败、R1 所修的原样调用） | `pnpm exec vitest run --typecheck <两 lifecycle 文件>` | **2 files / 28 passed (28)**，Type Errors no errors，EXIT=0 |
| 2 | **规范 env** | `pnpm test <两 lifecycle 文件>` | **2 files / 28 passed (28)**，Type Errors no errors，EXIT=0 |
| 3 | #226 契约 + 守卫 + #149/#150 基线 + 动态/源码面 | `pnpm test registry-issue-226-red + registry-surface + registry-create-diagnostic-red + runtime-root-schema-diagnostic-red + registry-create-diagnostic-code-source + registry-create-diagnostic-sa7-dynamic` | **6 files / 71 passed (71)**（13+12+16+14+6+10），Type Errors no errors，EXIT=0 |
| 4 | yjs-server 全模块（含全部进程级 E2E） | `pnpm test apps/yjs-server/test --testTimeout=30000` | **19 files / 114 passed (114)**，Type Errors no errors，EXIT=0，Duration 337.00s |
| 5 | 根 typecheck（14 tsconfig 串联） | `pnpm typecheck` | **EXIT=0**，零类型错误 |

对照：#3 前序终验等价批（bash-40/42）42+16=58 → 本轮 71（多含 #226 契约 13）；yjs-server 19/114 与
SA3 R1 bash-54、SA4 R1 SEG-C 完全同构。**裸跑与规范 env 逐段同构（28/28 = 28/28）**，证明钉扎在规范
路径零行为变化、在裸路径真实修复。

## 2. E1–E5/D8 真实进程级运行证据（SEG-1 裸跑，修复前该模式子进程全灭）

```text
✓ E1 启用从 namespace 创建起 … 7350ms
✓ E2 ROOT/SCHEMA 变更链记录 … 7357ms
✓ E3 Host 停机有界且日志完好：SIGTERM 干净退出（30s 界）… 7222ms
✓ E4 日志故障隔离 … 7547ms
✓ E5 hub 重启（多 Runtime generation）延续同一 stream … 16330ms
✓ D8 健康事件面 + D1 无泛滥（enabled 态进程级 NDJSON 摘录）… 7266ms
Test Files 2 passed (2) / Tests 28 passed (28) / Type Errors no errors
```

秒级真实耗时 + NDJSON stdout 摘录 = 真实 spawn Host 子进程跑全链路（非 mock、非缩水）。
D8 实测事件流：`diagnostic-log(retention-swept) + diagnostics-closed`（恰一次），零 `emission-dropped`。

## 3. acceptance 行为保持（两种调用方式下均验证）

- **C1（建流前结局归属，AC1 生产面）**：裸跑与规范 env 两轮 stdout 一致——A 流 2 条（genesis + #17
  namespace-create committed）、B 流恰 1 条 **NS_B 归属** attempt（transaction/`NAMESPACE_CREATE_FAILED`/rejected）、
  **全程零 unattributed 丢弃**、A 流干净（无 B marker、replay complete/issues=[]）。缺陷行为（无归属丢弃）
  未回归，且行为不随调用方式分叉。
- **#226 契约（AC1–AC5 钉子）**：13/13 绿——T1–T6 六类建流前早结局以候选 ns 键控归属、T7 GREEN 对照边界、
  T8/T10/T12 关键路径隔离顺序锚、T9/T13 shutdown 有界、T11 被拒 create 落盘真实 File adapter E2E。
- **基线零漂移**：#150 `registry-create-diagnostic-red` 16/16（AC4 `emitCalls===2` 直注同步锚在内）、
  `runtime-root-schema-diagnostic-red` 14/14、`registry-surface` 12/12（含 R4 setImmediate 注释面守卫）、
  `code-source` 6/6、`sa7-dynamic` 10/10（first-slice 同步落盘证据在内）。
- **进程级邻接面**：yjs-server 全模块 19 套件/114 用例含 hub-restart、stdin-error-chain、smoke-skeleton、
  phase5-mgmt/three-instance、root-lock 等全部真实进程 E2E，全绿。
- **类型面**：根 `pnpm typecheck` 14 tsconfig（含 apps/yjs-server src+test）EXIT=0，符合
  `apps/yjs-server/AGENTS.md` 验证门槛。

## 4. 无测试弱化 / 无跳过复核（独立于 R1 报告与 review 的亲测）

- 精确 grep（`it|test|describe` 的 `.skip/.todo/.only/.fails`、`expect.soft`）于三个焦点文件：**零命中**；
  四段运行日志中 "skipped/todo" 零命中（"failed" 命中均为通过用例名中的预期行为词，如 `write-failed`）。
- 两个 lifecycle 文件各恰一处 `spawn(`，均带 `NODE_OPTIONS: SPAWN_NODE_OPTIONS` 钉扎；tsx bin、main.ts
  参数、stdio 三管道、stdin NDJSON 控制通道、SIGTERM 收口（30s 界）逐行核对未动。
- `git diff --stat` = **9 文件 434+/145−**，与 SA4 R1 逐 hunk 核验的基线逐字节一致（R0 基线 400+/143− +
  两处钉扎 +34/−2）；removed 行仅旧 `env:{...process.env}` 与 rev1 R3 已授权的 C1 重写内容。
- 测试内无 `testTimeout`/`hookTimeout` 放宽（SEG-4 的 `--testTimeout=30000` 为运行参数、SA3/final_verify
  既有先例，仅作用于本模块全部用例、不屏蔽任何断言）。
- 钉扎语义核对：规范 env 下 `includes('conditions=nomicore-source')` 命中 → 原样透传（SEG-1≡SEG-2 同构
  证明）；裸 env 下补 flag——与根 `package.json` `test` 脚本 env 等价，无 env 分叉断言路径。

## 5. 非阻断登记（不影响本轮 verdict）

1. worktree 根 `REPORT.md` 仍为 #155 遗留内容、`.mabf-done` 不存在——#226 本地完成事务未成立；
   Controller 收尾前必须整体改写（final_verify §6.1 已三度登记）。
2. SA4 登记的 helper 子串判理论假阳性面（`nomicore-source-x` 前缀）不可达，维持仅记录。
3. yjs-server 其余进程级套件沿用 `env:{...process.env}` 模式（规范 env 下 19/19 绿）；统一钉扎属后续可选面，
   本票范围外。

## 6. 本轮边界

零生产代码改动、零测试改动、零 git 状态变更（`git stash list` 空、diff 面与被验态一致）；
唯一写入 = 本报告；结构化结果：**approve**，artifactPaths 见 structured_output。
