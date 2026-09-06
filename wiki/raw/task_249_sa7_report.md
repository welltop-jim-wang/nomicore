# SA7 独立动态验证报告 — Issue #249（final-verification）

- 阶段：final-verification（SA7 动态验证）；日期 2026-09-06（UTC）
- Worktree：`/home/wangjian/nomicore-fix-issue-249`（branch `mabf/issue-249`，HEAD
  `ac91a6bf17ae7661df3f6461456e7ca4e8e81526` = PR #248；工作树含 SA3 未提交改动）
- 输入（全部亲读）：SA4 approve 产物 `wiki/raw/task_249_sa4_review.md`、批准设计
  `wiki/raw/task_249_design.md`、任务简报 `wiki/raw/task_diagnostic-pump-singleflight-duplicate.md`
  （AC1–AC8）、SA6 对齐契约与证据 `wiki/raw/task_249_sa6_align_verification.md`、
  SA3 实现报告 `wiki/raw/task_249_sa3_impl.md`、实现全量 diff（5 文件逐 hunk 亲读）、
  三份验收契约测试亲读（pump-red 432 行 / duplicate-red 306 行 / coverage 410 行）
- 本轮边界：零产品代码改动、零测试改动；唯一写入 = 本报告；零提交、零推送、零 PR；
  一切测试经后台独立进程（Job 服务持有）；一次 HEAD 基线探针经 `git stash` 临时摘除
  tracked 改动后**完整恢复**（探针后 `git status` 与 diff 逐文件核对一致）

## Verdict

**approve**（`requiresConflictRecheck: false`）

AC1–AC8 全部经本轮**独立实跑**验证通过：三契约 + 覆盖 20/20 全绿（含 Type Errors 零）；
root typecheck 14 工程 exit 0；root `pnpm test` 全量 2889 用例中 #249 全部相关面绿
（namespace-registry 包全绿），4 例失败全部判别为**外部 CPU 饥饿**下与本票零代码交集
的预算/时序边缘（隔离/宽预算复跑全绿）；版本 bump、Vitest 触发覆盖、未屏蔽测试三项
专项审计通过。**AC7 红灯基线经本轮 stash 探针活体复证**：HEAD（PR #248）上契约恰
7 红 | 6 绿，与 SA6 R1 记录逐用例一致——红→绿判别力非历史日志转述，是本轮实证。

## 1. 验证方法

不采信 SA3/SA4 口头声明，全部证据为本轮独立后台实跑（表 V）；静态面（diff/配置/
版本/屏蔽审计）辅以亲读。长脚本一律 `run_in_background: true`，Job 服务持有进程与
退出码；探针后工作树完整性逐文件核对。

| # | 命令（后台 Job） | 结果 | 判定 |
|---|---|---|---|
| V1 | root 配置 vitest run 三契约文件（pump-red + duplicate-red + coverage，verbose） | **20/20 passed**，Type Errors: no errors，exit 0，4.55s | ✅ AC7 终态 |
| V2 | `pnpm typecheck`（root，14 工程串行 tsc） | **exit 0** | ✅ AC8 |
| V3 | vitest run `packages/namespace-registry/test`（全套件 37 文件） | 397/398；唯一失败 = phase5-replication-session AC-5 补锚(a) 5s 超时（判别见 §4，D4 全量中该文件 22/22 绿） | ✅（判别后） |
| V4 | `pnpm test`（root 全量 `vitest run --typecheck`，263 文件） | **2885 passed / 4 failed (2889)**，Type Errors: no errors，911.84s；4 失败 = vfsl-codegen ×3（5s 超时）+ ws-replication RT-G5（真实 TCP 时序断言）——全部判别为环境边缘（§4） | ✅（判别后） |
| V5 | `git diff --check` | exit 0（零 whitespace 错误） | ✅ AC8 |
| V6 | **HEAD 红灯基线探针**（`git stash` 摘 5 个 tracked 改动 → 跑两契约 + phase5 → `git stash pop`） | 契约 **7 failed \| 6 passed (13)**，Type Errors: no errors；phase5 同负载 22/22 绿（5314ms）；工作树恢复完整 | ✅ AC7 红灯活体复证 + V3 判别 |
| V7 | ws-replication RT 文件隔离复跑 | **4/4 passed**（原失败用例 RT-G5 隔离 1568ms） | ✅ V4 失败判别 |
| V8 | vfsl-codegen 宽预算复跑（`--testTimeout=30000`） | **8/8 passed**，Type Errors: no errors | ✅ V4 失败判别（与 SA3 vc-06 同法同果） |

## 2. AC1–AC8 逐条（动态证据）

| AC | 要求 | 本轮动态证据 | 判定 |
|---|---|---|---|
| AC1 | 每 ns 同时至多一个 scheduled/running drain；首 drain 前 burst 不无界重复 setImmediate | V1：R1a（burst 1000 → scheduleCount===1）/R1b（fired===1）/R1c（100 ticks × 50 入队 pending 有界）全绿——真实手工调度器替换 `globalThis.setImmediate`、真实 `createDiagPump`（契约亲证，非 mock）。V6：同三用例在 HEAD **红**（256≠1 族）→ 判别力双向实证 | ✅ |
| AC2 | stale callback 与 enqueue/drain 清理交错不丢任务；同 ns FIFO、initStream 先行 | V1：R2a（对齐版：显式重调已触发回调——空队 no-op、scheduleCount===2、零丢失）/R2b（末任务期重入同轮消费）/R2c（FIFO + init 先行）/R2d（resolver/emitter 违约隔离）4/4 绿；V6：HEAD 上同 4 用例亦绿（守护锚双向绿，机制更换未偷走覆盖） | ✅ |
| AC3 | 内存/调度有界；满队 drop-newest 保序 + 低基数 metric/observer 上报 | V1：R3-1（300 burst 保序留 256）绿；R3-2（44 条 emit 丢弃逐条上报、判别联合、`operation==='namespace-create'`）绿；R3-3（init-stream 丢弃恰一次、无 operation、从未执行）绿；§13.3-b（observer 收 `diag-pump-drop` **恰四键** + throw 隔离零业务影响）绿。V6：R3-2 在 HEAD 红（0≠44） | ✅ |
| AC4 | entry collision 与 DOC_DUPLICATE 到正确 ns 的诊断流；不影响 8 次 retry/最终结果/词表 | V1：T-A（nsA 2 条含 rejected、零补建）/T-B（1 rejected + 恰一次 genesis-less 补建）/T-C（1 committed + 9 rejected、零 fatal 记录、initStream 恰 1、unattributed 0）绿；§13.3-c legacy no-op ×2 绿（#150「恰一条最终结局」锚保持）；§13.3-d code↔sourceModule↔stage 精确成对（DOC_DUPLICATE→persistence/transaction；NAMESPACE_ALREADY_EXISTS→registry/identity，经**真实 emitter 管线**落盘断言）绿。V6：T-A/T-B/T-C 在 HEAD 全红 | ✅ |
| AC5 | gate 输入零访问；后续仅 detached safe snapshot | 契约亲读 + diff 亲证：entry collision `input:{status:'not-accessed'}`（判定只读 entries map）；DOC_DUPLICATE `input:{snapshot:{schema:p.schema, root:p.root}}` 复用 preparedBox 既有 detached frozen snapshot（与相邻发射点同款）；V1 中 T-A/T-B/d 组断言实跑通过（管线不会因 input 形状丢弃） | ✅ |
| AC6 | initStream/resolver/emitter/storage 异常不改业务结果/顺序、不无限延长 shutdown | V1：R2d（违约只丢肇事记录、不阻塞队列）+ §13.3-b test 2（observer throw → `created.ok===true`、后续投递零影响）绿；diff 零触碰 shutdown/disposer 面 | ✅ |
| AC7 | 确定性红→绿测试覆盖全矩阵，且 PR #248 会失败 | 覆盖矩阵 20 用例 V1 全绿；**V6 活体复证**：HEAD 上 7 红（R1a/R1b/R1c/R3-2/T-A/T-B/T-C）+ 6 绿守护锚，与 SA6 R1 记录（`sa6-align-final-run.log` 7 failed \| 6 passed）**逐用例一致**，且 Type Errors 同为零——红灯非编排假象 | ✅ |
| AC8 | registry 指定测试 + root typecheck + pnpm test + git diff --check | V2 typecheck exit 0；V3 registry 397/398（唯一失败判别见 §4；该文件在 V4 全量 22/22 绿）；V4 全量 2885/2889、Type Errors 零、#249 全部相关面绿；V5 diff --check 干净 | ✅ |

## 3. 专项审计

### 3.1 版本（version bump）

- `packages/namespace-registry/package.json`：`0.1.8 → 0.1.9`（patch，唯一被改包）。
- 全仓（packages/apps/domains 的 package.json + pnpm-lock.yaml）**零 `0.1.8` 残留**；
  lockfile 对 workspace 包全为 `link:` 引用（importers 不记自身版本）→ **无 lockfile 漂移**，
  `--frozen-lockfile` 不受影响。
- `packages/namespace-diagnostic-log/**` 零 diff（指纹/schema/词表冻结面平凡保持）。
- 与设计 §14 一致：无 changeset/CHANGEBOOK 联动机制（本轮复核成立）。

### 3.2 Vitest 触发覆盖（AC7/AC8「进 pnpm test 收集面」）

- root `vitest.config.ts` include = `packages/*/test/**/*.test.ts`（亲读）→ 三份
  `registry-issue-249-*.test.ts` 路径全部命中；**无 exclude**、无包级 vitest 配置覆盖
  （`packages/namespace-registry/vitest.config.*` 不存在）。
- V1 以 root 配置实跑三文件：收集 + 执行双证（20/20）。
- V4 全量总数 **2889 == SA3 四轮全量记录**（含本票 20 用例；若未收集则总数应为 2869）
  ——计数算术证明收集面包含；Type Errors: no errors（tsc 程序面含测试文件）。
- `.scratch/249/` 复现载体不在 include 面内（目录模式不匹配），不进 `pnpm test`。

### 3.3 未屏蔽测试（no masking）

- 三新文件 grep 全词审计：`.skip/.only/.todo/skipIf/runIf/xit/xdescribe/fit/fixme`
  **零命中**；`vi.mock` 零命中——全部经真实 `src/diag-pump.js`、真实 testing seam、
  真实 emitter 管线（亲读三文件确认：手工调度器替换 globalThis.setImmediate、
  StubPersistence 仅持久层边界、断言全为精确计数/精确键集/精确序强形式）。
- `git status` test 树：**零 tracked 测试文件被修改**（既有绿基线防回退面成立，
  断言不可能被弱化）。
- vitest.config.ts / tsconfig / CI workflow 零 diff（无收集面/门禁面操纵）；
  V4 汇总无 skipped 计数。
- V6 红灯探针反向证明：绿灯非恒真——同文件在 HEAD 上 7 例红。

## 4. 环境边缘失败判别链（V3/V4 唯一失败项）

**共同根因（本轮实测）**：宿主机 4 核承载 load 7.75–8.06——`ps` 实证 **6 个运行数日的
外部 `grep` 进程各占 70–94% CPU**（非本会话进程，无法处置）；vitest 自身在 V4 中出现
2 个 `[vitest-worker]: Timeout calling "onTaskUpdate"` RPC 超时——测试基础设施本身
处于饥饿状态的直接证据。

| 失败项 | 判别证据 | 结论 |
|---|---|---|
| V3: phase5-replication-session AC-5 补锚(a) 5s 超时 | ①该测试 `makeRegistry` **不注入 diagnosticLog** → `createDiagRuntime(undefined,…)` 直接 NOOP 单例、泵不构造——#249 对该路径**机制上零 delta**（亲读测试 L342–354 + 源码早退分支）；②V6 探针：HEAD 同负载下 22/22 绿（5314ms）；③V4 全量：该文件 22/22 绿（第 3 样本通过）；④失败用例身份在两次失败间漂移（L1097 vs L1027 邻域）——负载特征而非定点回归；⑤历史：SA3 四轮 4.6–5.7s（93–115% 预算）临界通过 | 环境 CPU 饥饿预算边缘，非 #249 |
| V4: vfsl-codegen generate-cli-check ×3 5s 超时 | ①包与 #249 零 diff 交集；②子进程型测试（spawn `pnpm generate` 全工具链）对外部饥饿最敏感；③V8 宽预算 30s 复跑 **8/8 全绿**；④SA3 vc-05/06/07/08 同法同果同签名 | 预算边缘（与 SA3 判别一致），非 #249 |
| V4: ws-replication RT-G5 `'blocked'≠'draining'` | ①真实 TCP + 真实 timer 时序断言，包与 #249 零交集；②V7 隔离复跑 **4/4 绿**（原用例 1568ms）；③V4 同 run 的 vitest RPC 超时佐证全局饥饿 | 真实传输时序在饥饿下的竞态，非 #249 |

三项判别共同满足：零代码交集 + 同树隔离/宽预算复跑通过 + 根因实证（外部进程饥饿）。
**#249 改动所在包（namespace-registry）在 V4 全量中整包全绿**（含三契约、五基线套件、
sa7-dynamic、hostile、shutdown、复制面全部既有锚）。

## 5. 实现面亲读复核（与 SA4 静态验尸互证）

- `diag-pump.ts`：`inflight` 合一位与设计 §4.2 伪码逐行同构（排定位置位、回调末尾
  finally 清除、敌意 setImmediate 位回滚）；drain 本体（每轮重取引用/空判 break/
  排空 delete）与 runTask 结构保持；`reportDrop` 判别联合 + try/catch 收编。
- `registry.ts`：`reportPumpDrop` 窄回调 → `diag-pump-drop` 四键事件；两发射点均在
  retry return 之前、槽内 O(1)；头注释按新事实改写。
- `create-diagnostic.ts`：`emitCandidateOutcome` 泵路径实现 + legacy/NOOP no-op（D-1）；
  `sourceModule` 可选参缺省 'registry'（既有调用点零漂移）；`options.reportPumpDrop
  === undefined` 分形构造保持两参行为。
- `observer.ts`：联合加法变体，`index.ts` 零导出（grep 亲证）；新增行零
  `setTimeout|setInterval|Date.now`（守卫面保持）。

## 6. 观察与移交（均非阻断）

- **O1（环境）**：宿主机外部 `grep` 进程饥饿（load ≈ 2× 核数）导致预算临界测试
  （vfsl-codegen、phase5 复制、registry-surface、ws-replication 真传输族）在本机
  随机翻红；**CI runner 以其实际能力终裁**。建议 finalize 后按常规发布，不因本机
  负载边缘扣留。
- **O2（证据链卫生，承接 SA4 F1）**：`.scratch/249/` **不在 .gitignore**（本轮复核
  仍零命中）——finalize 必须以精确 paths 收录，确保 `.scratch/` 与其内 node_modules
  不入提交（结构性 finalize 本就如此）。
- **O3（程序注记，承接 SA4 F3）**：SA3 对 SA6 契约文件的类型机械修正（非空断言 +
  exactOptionalPropertyTypes 分形构造）本轮实跑共存验证：20/20 绿 + Type Errors 零，
  与红灯史（V6 活体复证）不矛盾。

## 7. 结论

- AC1–AC8 全部通过独立动态验证；红→绿双向（V1 绿 vs V6 HEAD 红）活体实证，非历史
  转述。
- 版本 bump（0.1.9，无 lockfile 漂移）、Vitest 触发覆盖（include 命中 + 计数算术 +
  实跑三证）、未屏蔽测试（全词零命中 + 零 tracked 测试改动 + 红灯反向证）专项通过。
- 全量 4 例失败全部完成判别闭环（零交集 + 复跑绿 + 根因实证）；#249 相关面在全量、
  包级、契约级三层全绿。
- 无新规范决策、无词表/公共面/schema 变更信号 → 无需冲突复检。

Verdict: **approve** — `requiresConflictRecheck: false`

路由：SA7 approve → AC 门禁 → 总控 finalize（精确 paths，排除 `.scratch/`；发布与 CI
归 issue-runner）。
