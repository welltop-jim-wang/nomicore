# Issue #226 独立动态最终验证报告（final verification）

- 任务：Issue #226（bugfix）— `wiki/raw/task_issue-226.md`（AC1–AC5；Parent PR #142）
- Worktree：`/home/wangjian/nomicore-fix-issue-226`（branch `mabf/issue-226`，基线 HEAD `45a22f0`，SA3 实现 + SA8 impl-conflict recheck clear 后的未提交态）
- 验证对象：当前实现全集（`packages/namespace-registry/src/diag-pump.ts` 新增、`create-diagnostic.ts`/`registry.ts`/`plugin.ts`、`apps/yjs-server/src/diagnostics.ts` 注释、两 package.json 版本 bump、rev1 红契约、E1/E3/D8/C1 契约修订、R4 守卫注释）
- 输入产物（SA4 审查所引用链条，本报告全部亲读）：任务简报、`20260905-bug-issue-226.md`（含 §7–§9 复核）、verify2–verify6、`task_issue-226_design.md`（iter4，含 §10 R1–R4）、`_design_attack_review.md`（SA2 approve）、`_red_contract_rev1.md` + 其 SA8 recheck、`_sa3_impl.md`、`_impl_conflict_recheck.md`（clear）、`_sa5.md`、`_sa6_red.md`、`_relevant_decisions.md`
- 本轮性质：**独立动态最终验证**——真实运行 #226 契约、#149/#150 基线、#155 SA7/lifecycle 路径、typecheck 与全量回归；核验 acceptance 行为而非静态断言；处理并报告负载噪声（零屏蔽、零跳过、零禁用）；零生产代码改动。
- 环境：node v24.13.0 / pnpm 10.28.2 / vitest 3.2.7（`--typecheck` 开启）；宿主 4 核、6 用户共享、整轮 load ~6.3–7.6（本轮实测 `uptime` 快照 6.34/7.20/7.58 与 7.31/7.40/7.52）。
- 时间：2026-09-06（本地）；全部测试经后台 Job 独立进程（bash-39 至 bash-45）。

## Verdict

**approve**（`requiresConflictRecheck: false`）

AC1–AC5 全部以可执行行为面验证通过；#226 契约 13/13 绿且**修复前红态经本轮 stash 独立复现**（12F|1P，形态与 rev1/SA8 记录一致）；#149/#150/#155 相邻基线零漂移；typecheck 14 项目零错误；全量 260/260 文件、2869/2869 用例、Type Errors 0（唯一残留 = 2 条 vitest worker RPC 编排层超时，零测试失败——见 §5 负载噪声处理）。

## 1. 本轮动态运行证据（全部后台 Job、真实退出码）

| # | 套件（命令） | Job | 结果 |
|---|---|---|---|
| 1 | #226 验收契约 `pnpm test packages/namespace-registry/test/registry-issue-226-red.test.ts` | bash-39 | **13 passed (13)**，Type Errors no errors，EXIT=0，4.48s |
| 2 | #150+#149 基线 + 守卫：`registry-create-diagnostic-red`（16）+ `runtime-root-schema-diagnostic-red`（14）+ `registry-surface`（12，含 R4 注释面） | bash-40 | **42 passed (42)**，Type Errors no errors，EXIT=0（#149 AC4 `emitCalls===2` 直注同步锚保持） |
| 3 | #155 路径：`diagnostic-replay-host-lifecycle-sa7`（6，含 C1 翻绿 + D8 进程级）+ `diagnostic-replay-host-lifecycle-red`（22，含 E1–E5） | bash-41 | **28 passed (28)**，Type Errors no errors，EXIT=0（C1 实测 stdout：A 流 2 条（genesis+#17）、B 流 1 条 NS_B 归属 attempt、sink 零 unattributed drop） |
| 4 | `registry-create-diagnostic-code-source`（6）+ `registry-create-diagnostic-sa7-dynamic`（10） | bash-42 | **16 passed (16)**，Type Errors no errors，EXIT=0 |
| 5 | 根 typecheck（14 tsconfig 串联）`pnpm typecheck` | bash-43 | **EXIT=0**，零类型错误 |
| 6 | 修复前红态独立复现（§3） | bash-44 | **12 failed \| 1 passed (13)**，Type Errors no errors，EXIT=1（预期红灯） |
| 7 | 红态恢复后契约复跑 | bash-45 前段 | **13 passed (13)**，EXIT=0（恢复完整性证据） |
| 8 | 全量回归 `pnpm test --testTimeout=30000`（完整日志 `/tmp/issue226-final-full.log`） | bash-45 后段 | **Test Files 260 passed (260)；Tests 2869 passed (2869)；Type Errors no errors**；`Errors 2`（见 §5）；pnpm ELIFECYCLE exit 1 由该 2 条编排层错误导致，**测试断言零失败** |

焦点面合计：13 + 42 + 28 + 16 = **99/99 绿**（#226/#149/#150/#155/守卫全焦点面）；全量 2869/2869。

## 2. acceptance 行为核验（非静态断言）

- **AC1（建流前结局归属）**：T1–T6 实跑通过——schema-compile/validation/input-snapshot/Persistence 运营/Persistence fatal（committed:true 事实保留）/create-document-internal fatal 六类早结局以候选 ns 数据键控到达通道，`unattributedDrops===0`；T7 GREEN 对照（#17/#18）保持；T11 真实 File adapter E2E：被拒 create 的 `namespaces/<候选ns>/` 目录含诊断文件（poll 到达 + 递归目录非空断言）。#155 C1（生产 Host 全链路）：B 以 NS_B 归属落自己的流（恰 1 条 attempt：transaction/`NAMESPACE_CREATE_FAILED`/rejected）、全程零 unattributed 丢弃、A 流干净（genesis+#17、无 B marker、replay complete/issues=[]）。
- **AC2（输入零访问/detached 快照纪律）**：T1 `e.input.snapshot` = 接纳时 detached 快照且 `observedAt` = 注入 Clock 同源 ISO（本轮 13/13 内实跑）；T3 cycle-safe 拒绝 → `status:'unsafe-input'`（发射面零回读敌意输入）。
- **AC3（日志 I/O 出关键路径）**：T8（慢建流 120ms+慢 append 120ms）：`create:settled` 先于 `initStream:end`/`emit:1:end`（顺序锚）+ 墙钟 <120ms；T10（ensureBlockMs=150）：`open:settled` 先于 `ensure:end` + open <75ms；T12（emitBlockMs=100，**生产装配全链路**）：`writes:settled` 先于 `emit:2:start` + gap <50ms。判据 = 事件迹 indexOf 顺序（确定性）+ 墙钟旁证，非静态 grep。
- **AC4（慢/挂起存储隔离 + shutdown 有界）**：T9（慢建流 200ms + 已接纳 create）：`shutdown:settled` 先于 `initStream:end`，shutdown <100ms；T13（在途写 + 立即 shutdown）：`shutdown:settled` 先于 `emit:2:end`，<50ms；E3 app 级：SIGTERM 30s 界内 exit 0、停机后 strict 一致；业务面 GREEN 锚（ok lease/FIFO/终值/branded fatal）在全部用例内先行通过。
- **AC5（契约证明修复前失败）**：见 §3 红态复现——12F|1P 与 rev1 §4 / SA8 recheck §3 / SA3 §5 的修复前基线逐轮一致。

## 3. 修复前红态独立复现（本轮新增的关键独立证据）

方法：`git stash push`（**仅 tracked 实现与测试修订**：`packages/namespace-registry/src`、两 package.json、`registry-surface.test.ts`、`apps/yjs-server/src`、`apps/yjs-server/test`）——未跟踪的 #226 契约文件原样保留；生产回退后 `create-diagnostic.ts` 无 `createDiagPump` 引用（grep 证实）。运行 Job bash-44：

```text
pnpm test packages/namespace-registry/test/registry-issue-226-red.test.ts
Test Files  1 failed (1)
     Tests  12 failed | 1 passed (13)
Type Errors  no errors        （EXIT=1，预期红灯）
```

失败形态抽查与既有八轮一致：T11 目录 poll `expected false to be true`（被拒 create 零落盘）、T13 墙钟 `shutdown … 101ms: expected 101 to be less than 50`、T12 同族。随后 `git stash pop` 恢复：`git stash list` 空、`git diff --stat` 与 SA3 清单逐字节一致（9 文件 400+/143−）、恢复后契约复跑 13/13 绿（§1 行 7）。

⇒ 在当前 HEAD 上独立成立：**契约钉住修复前缺陷（红）且当前实现使其翻绿**——红→绿翻转由实现本身决定，非契约漂移。

## 4. 测试触发范围（trigger scope）核验

- vitest `include`：`packages/*/test`、`domains/*/test`、`apps/*/test` 全集 + `--typecheck` 覆盖 `*.test-d.ts`（`tsconfig.typecheck.json`：src+test+domains）；`maxWorkers: 1`（全量 881.40s 与 #155 时代 504s→现 260 文件量级相符）。
- 直接消费 `diagnosticLog` seam 的测试恰 5 文件（#226 契约、#150 red、code-source、sa7-dynamic、yjs-server SA7）——本轮全部实跑（§1 行 1/2/3/4）；lifecycle E2E（E1–E5）+ D8 为 Host 进程级消费面（§1 行 3）。
- 使用 `createRegistry/createNamespaceRegistry` 的测试共 39 文件（其余走 no-op diag 路径）——由全量回归（§1 行 8）整体覆盖。
- 生产 tsconfig：`pnpm typecheck` 14 项目串联全绿（含 namespace-registry 与 yjs-server 的 src+test）。
- 版本 bump（registry 0.1.7→0.1.8、yjs-server 0.1.2→0.1.3）：lockfile 全部 `workspace:*` specifier，无 pinned 版本引用 ⇒ 无需 lockfile 变更（亲核 `pnpm-lock.yaml`）。
- `setImmediate` 生产调用点：src 全树 grep 唯一命中 `diag-pump.ts:137`（dsh-persistence 命中为注释）——与 R4 注释契约「只授权 diag-pump 一处」吻合，守卫 12/12 绿。

## 5. 负载相关测试噪声的处理与报告（未屏蔽、未跳过、未禁用）

- **全量轮唯一残留**：`Errors 2` —— 两条 `[vitest-worker]: Timeout calling "onTaskUpdate"`（worker→orchestrator 的进度上报 RPC 超时）。**测试断言零失败**（260/260 文件、2869/2869 用例、Type Errors 0）。逐字与 SA3 §6 bash-28/bash-29 两轮全绿的残留噪声同型同量级；总量（260/2869）与 SA3 连续两轮完全一致。
- **排除伪失败**：log 内 18 处 `FAIL|✗|×` 模式命中经逐条核对全部为**通过用例名中的乘号 `×`**（如「100k 键 × 120 成员联合」），`✓` 370 处，无任何真实 FAIL 行；ELIFECYCLE exit 1 纯由上述 2 条编排层错误触发。
- **处理方式（合规）**：① 全部套件**顺序执行**（vitest `maxWorkers:1` + 同刻至多一个重作业，避免自致负载）；② 全量轮仅放宽用例预算 `--testTimeout=30000`（SA3 先例；宿主 load 7.3–7.6/4 核下进程级/CLI 子进程用例的合法耗时余量），**零 skip、零 disable、零过滤器**；③ SA3 记录的默认 5s 预算下边际超时族（registry-phase5-replication、root-lock、vfsl-codegen CLI、ws-replication real-transport）在本轮加宽预算后全部自然通过——无需任何屏蔽。
- **结论**：全部 #226 相关面（契约/基线/#155/守卫/typecheck）在本轮负载条件下确定性绿；唯一噪声属 vitest 编排层、与 #226 改动面无内容关联（该 RPC 不承载测试结果）。

## 6. 发现与登记（非阻断）

1. **⚠️ 陈旧 REPORT.md（重复登记）**：worktree 根 `REPORT.md` 仍为**前一任务 #155 的遗留**（`status: complete`、`run_id: controller-…-155-…`、`branch: mabf/issue-155`），与本任务不符；`.mabf-done` 不存在（本轮实测）——issue-226 本地完成事务**尚未成立**。Controller 在写 #226 完成事务前必须整体改写该文件（带本次 run_id/branch `mabf/issue-226`），不得消费遗留内容（verify6 §5 已首登记，本轮复核维持）。
2. 实现态为**未提交**（9 tracked 修改 + 2 新文件）：本地完成事务的提交动作属 Controller/issue-runner 职责，本轮零 git 写操作（stash push/pop 为验证性暂存，已完整恢复并核实）。
3. 卫生注记维持 impl-conflict recheck §4（`streamedNamespaces` 单调增长、plugin.ts 注释未列入 SA3 §1 表等）——非阻断、无行为面影响。
4. duplicate 家族（entry 碰撞/Persistence `DOC_DUPLICATE` 重试零发射、id 耗尽 fatal 零诊断发射）维持 SA5/SA6/verify6 登记面裁定（#150「恰一条最终结局」裁决覆盖；非本票红灯对象）——本轮未增锚、未预裁。

## 7. 本轮边界

- **零生产代码改动、零测试改动、零 git 状态变更**（`git status --porcelain` 31 项与 SA3 清单 + wiki 一致；stash 已清空）。
- 唯一写入 = 本报告文件。
- 结构化结果：verdict `approve`（fail-needs-fix/fail-needs-redesign 均不适用）；artifactPaths 见 structured_output。
