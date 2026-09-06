# SA3 验证命令勘正与实测 — Issue #249（Controller 独立验证命令替代 + implementation 复验）

- 阶段：implementation 复验（Controller 独立验证命令失败后的命令勘正轮；SA3 角色）
- Worktree：`/home/wangjian/nomicore-fix-issue-249`（branch `mabf/issue-249`，HEAD
  `ac91a6bf17ae7661df3f6461456e7ca4e8e81526` = PR #248；工作树含 SA3 R0 未提交改动：
  namespace-registry 4 个 src 文件 + package.json 0.1.8→0.1.9 + 3 个新增测试文件）
- 日期：2026-09-06（UTC）；全部测试/门禁命令以后台独立进程运行（`run_in_background: true`，
  Job 服务持有，非前台同步阻塞）
- 本轮边界：只产验证证据文件；实现/测试若真失败则修复——**结论：无需修复**；零提交、零推送、零 PR

## 0. 起因与处置（不忽略、不绕过）

Controller 的独立验证命令 `source scripts/test-lock.sh && mabf_run_tests --only namespace-registry`
在本 worktree **失败**：`scripts/test-lock.sh` 不存在（`ls scripts/` 实测仅 build/publish/verify 类
脚本，无 test-lock.sh），`mabf_run_tests` 亦非本仓命令/工具（全仓 grep 零命中）。该命令形态属
外部/过时 harness 约定——本仓同因先例：#155 `REPORT.md` L38（`source scripts/test-lock.sh` 以
exit 1 结束，随后以根 `package.json` 权威 scripts 重跑为最终通过证据）。

处置：不忽略、不绕过；按仓库权威来源确定**受支持的精确验证命令**，逐条后台实测并记录
命令/退出码/覆盖范围/日志证据，供 Controller、SA4/SA7 复核与 finalize 复用。

## 1. 权威命令来源（受支持面盘点）

| 来源 | 规定内容 |
|---|---|
| 根 `package.json` `scripts` | `test` = `NODE_OPTIONS=--conditions=nomicore-source vitest run --typecheck`；`typecheck` = 14 个 tsconfig 串行 tsc。root `vitest.config.ts`：`typecheck.enabled: true`、`tsconfig.typecheck.json`（编译面含 `packages/*/test/**/*.ts`）、include 面 `packages/*/test/**/*.test.ts` |
| CI `.github/workflows/ci.yml` | Typecheck step = `pnpm typecheck`；Test step = `pnpm test`（另有 4 个专项 vitest 步，本票不涉） |
| `packages/namespace-registry/AGENTS.md`（Verification 节） | Registry open/create、lease/idle、replication、shutdown、persistence-parity、Cordis、concurrency、public-surface 全套件 + 包 typecheck；lifecycle/identity/role/replication-contract 类变更须 root `pnpm typecheck` + `pnpm test` |
| 设计 `wiki/raw/task_249_design.md` §13.4（AC8） | 契约两文件 vitest run → 回归 5 套件 vitest run → `pnpm typecheck && pnpm test && git diff --check`（注明后台进程执行） |
| SA6 R1 / SA3 R0 前期实测同构 | `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run <目标文件…> --reporter=verbose` |

- **`--only namespace-registry` 的受支持等价** = vitest 位置过滤：
  `pnpm exec vitest run packages/namespace-registry/test`（root include 面命中该包全部 37 个测试文件）。
- 本仓**无** `mabf_run_tests` 单命令等价物；以上命令集即 Controller 意图（只跑本包 + 相关契约）的
  仓库内权威落地，并与 CI 步骤逐条同构。

## 2. 实测命令表（全部后台独立进程；worktree 根执行）

| Job | 精确命令 | 结果摘要 | exit | 日志 |
|---|---|---|---|---|
| bash-29 | `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/namespace-registry/test/registry-issue-249-pump-red.test.ts packages/namespace-registry/test/registry-issue-249-duplicate-red.test.ts packages/namespace-registry/test/registry-issue-249-coverage.test.ts --reporter=verbose` | 3 文件 **20/20 passed**；Type Errors: no errors；7.64s | **0** | `.scratch/249/sa3-vc-01-contract.log` |
| bash-30 | `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/namespace-registry/test` | 37 文件 **398/398 passed**；Type Errors: no errors；79.59s | **0** | `.scratch/249/sa3-vc-02-registry-suite.log` |
| bash-31 | `pnpm exec tsc -p packages/namespace-registry/tsconfig.json` | 包 typecheck 静默通过 | **0** | `.scratch/249/sa3-vc-03-pkg-typecheck.log` |
| bash-32 | `pnpm typecheck` | 14 工程 tsc 串行全部通过 | **0** | `.scratch/249/sa3-vc-04-root-typecheck.log` |
| bash-33 | `pnpm test`（root 全量 run #1，CI Test step 同款） | 262/263 文件、2888/2889 用例绿；1 失败见 §4 | 1 | `.scratch/249/sa3-vc-05-root-test.log` |
| bash-34 | `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/vfsl-codegen/test/generate-cli-check.test.ts --testTimeout=30000 --reporter=verbose` | 隔离宽预算 **8/8 passed**；Type Errors: no errors；24.03s；失败同名用例实测 5408ms（另 1 例 5396ms） | **0** | `.scratch/249/sa3-vc-06-codegen-widebudget.log` |
| bash-35 | `pnpm test`（root 全量 run #2） | 262/263 文件、2887/2889 用例绿；2 失败同文件见 §4；915.50s | 1 | `.scratch/249/sa3-vc-07-root-test-rerun.log` |
| bash-36 | `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/vfsl-codegen/test/generate-cli-check.test.ts --reporter=verbose`（默认 5s 预算，隔离） | **7/8**——同用例（L73）在默认预算下再次超时 → 预算不足确定性成立 | 1 | `.scratch/249/sa3-vc-08-codegen-defaultbudget.log` |
| —（前台静态） | `git diff --check` | 干净（零 whitespace 错误） | **0** | — |

## 3. 覆盖范围（对应 issue #249 变更与验收契约）

- **验收契约面（AC7/§13.3）**：SA6 对齐版契约 13 例——pump-red 10（R1a/R1b/R1c 红转绿、R1d 守护锚、
  R2a–R2d 交错守护锚、R3-1、R3-2 判别联合上报）+ duplicate-red 3（T-A/T-B 红转绿、T-C D-2 对齐版）；
  加 SA3-owned 新增覆盖 7 例（§13.3-a: R3-3 init-stream drop 恰一次；§13.3-b×2: observer 落点四键锁 +
  throw 隔离；§13.3-c×2: legacy no-op 锁；§13.3-d×2: code/sourceModule 成对锁）→ **20/20 全绿，
  Type Errors: no errors**。
- **防回退面（module AGENTS.md Verification 节全清单）**：registry 全套件 37 文件 398/398 绿——含
  SA5 诊断基线 5 套件 94/94（registry-issue-226-red 13、registry-create-diagnostic-red 16、
  registry-create-diagnostic-code-source 6、registry-create 47、registry-surface 12）、
  registry-create-diagnostic-sa7-dynamic（`emitCalls===10` 零业务漂移计数锚）、open/create/lease/idle/
  shutdown、phase5 replication（red/session/round2/channels/bootstrap-reset 动态族）、
  persistence-contract、cordis、concurrency、hostile、node-dispose、entry-removal-guard、sa7-rev1 等。
- **类型面**：包 `tsc -p`（src 编译面）exit 0；root 14 工程 tsc 串行 exit 0；每轮 vitest
  Type Errors: no errors。
- **全仓门禁（AC8/CI 同款）**：`pnpm test` = `vitest run --typecheck` 全收集面 263 文件 / 2889 用例
  （唯一失败判别见 §4）；`git diff --check` 干净。

## 4. root 全量 `pnpm test` 失败项判别（既有机器预算边缘；非 #249 引入；无需修复）

失败项（两次全量复跑 + 两轮隔离实验锁定）：`packages/vfsl-codegen/test/generate-cli-check.test.ts`
- run #1（bash-33）：L73「自定义输出 --check：fresh=0；stale/missing=1 且不写盘」`Test timed out in 5000ms`
- run #2（bash-35）：L73 同上 + L111「源漂移后 --check → 退出非零」——2 例同因
- 每次伴 2 例 `[vitest-worker]: Timeout calling "onTaskUpdate"` unhandled error = 超时连锁的 RPC 症状
  （隔离跑零出现）

判别依据（证据链）：
1. **零代码交集**：git 改动仅在 `packages/namespace-registry`；`packages/vfsl-codegen` 与 `git diff`
   零触碰，文件内容 = HEAD `ac91a6b`（PR #248 合入态）。
2. **确定性预算不足（本机）**：隔离 + 30s 预算 → 8/8 全绿 exit 0，失败同名用例实测 **5408ms >
   5000ms**（同文件另 1 例 5396ms 同临界）；隔离 + **默认 5s 预算 → L73 用例再次超时（7/8）**——
   该用例在本机默认预算下确定性失败，与全量套件负载无关（bash-34/36 两轮隔离互证）。
3. **负载边缘解释全量下 1 vs 2 例差异**：两次全量分别 1/2 例超时 = 全量运行期间 CPU 争用使临界
   用例（~5.0–5.4s 区间）越过/未越过预算阈值。
4. **CI 基线**：CI（GitHub Actions runner）该文件默认预算下为绿基线（PR #248 合入 CI 绿；工作流与
   该文件均未变更）——预算以 runner 实际能力裁决，本机偏慢不构成 #249 完工阻塞。

处理：不改 vfsl-codegen（跨模块越权 + 禁止屏蔽测试）；完整记录如上，root 门禁在 SA7/总控/CI 层按
runner 实际能力复核。**namespace-registry 域全部门禁 exit 0，与本票相关面无一失败。**

## 5. 结论

- issue #249 修复实现经受全部适用门禁：验收契约 20/20、registry 全套件 398/398、包/root typecheck
  双绿、`git diff --check` 干净、root 全量 2888/2889（唯一失败 = §4 已判别的既有机器预算边缘，
  与本票零交集，两轮隔离实验闭环证明）。
- **未发现实现/测试实际失败 → 本轮无需任何代码修复。**
- 验证命令结论（供总控/SA4/SA7 复用）：本仓 **无** `scripts/test-lock.sh`、**无** `mabf_run_tests`；
  受支持精确命令 = §2 表六条（契约定向 vitest run / `packages/namespace-registry/test` 目录跑 /
  包 tsc / root `pnpm typecheck` / root `pnpm test` / `git diff --check`），一律后台独立进程执行。

## 6. 产物

- 本证据：`wiki/raw/task_249_sa3_verification_command.md`
- 运行日志（不入仓候选，仅审计）：`.scratch/249/sa3-vc-01-contract.log`、`sa3-vc-02-registry-suite.log`、
  `sa3-vc-03-pkg-typecheck.log`、`sa3-vc-04-root-typecheck.log`、`sa3-vc-05-root-test.log`、
  `sa3-vc-06-codegen-widebudget.log`、`sa3-vc-07-root-test-rerun.log`、`sa3-vc-08-codegen-defaultbudget.log`
