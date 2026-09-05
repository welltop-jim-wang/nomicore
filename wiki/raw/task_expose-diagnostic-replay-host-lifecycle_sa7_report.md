# SA7 动态验证报告 — issue #155（expose diagnostic replay & Host lifecycle）

**Date**: 2026-09-03（首轮 12:0x–12:40）／ 2026-09-03 20:53–21:05（R4 恢复轮独立复验，见「R4 恢复轮独立动态验证」节）／ 2026-09-03 23:14–23:24（**R5 恢复轮独立复验**，见「R5 恢复轮独立动态验证」节——最终 Verdict 以本轮为准）
**Verdict**: **pass**（R5 恢复轮维持——基准 = **SA4 R4 pass（2026-09-03 23:11 最终）** + 当前未提交 #155 diff（`find … -newermt '2026-09-03 23:12'` → 空，生产/测试 `.ts` 零变更 → 本轮验证对象与 SA4 R4 审核对象**逐字节一致**；唯一 diff-stat 增量 = REPORT.md +30/−30，Controller 21:14 工件，SA4 R4.1 已登记）；本轮全部动态链路独立复跑：红灯契约 22/22（默认超时面，F1 持续有效）、SA7 补充套件 6/6（`[SA7-DV]` 三处打点原文复现）、CI 等价 `pnpm test` **两 #155 文件在同 run 内绿**（22+6 tests）+ 满载窗 1 例非 #155 文件 spawn 抖动（隔离复跑 5/5 绿，归因闭合，见 R5.2）、`pnpm typecheck` 0 errors。唯一未闭合项仍为 **CI run-log 摘录——环境阻塞**（分支未推送/无 PR/无 run，R5 复查依旧；push/PR 归总控，非 SA7 职责），本地等价证据已全量复验，后续摘录命令见「vitest 触发证据」节）

- **验证对象**：worktree 未提交 diff（HEAD=b11eb9c，16 文件修改 + 3 新文件）+ SA4 R2 复核后的夹具修订；R4 恢复轮同一 diff 经 mtime 复核**字节冻结**（生产面 09-02 22:22–22:35、red test 09-03 12:04:48、sa7 test 09-03 12:35:23；`find apps packages domains -name '*.ts' -newermt '2026-09-03 13:46'` → 空）
- **输入**：任务简报 / SA4 review（R2 pass → **R3 恢复轮 pass 维持**，R4 轮基准）/ SA6 红灯契约（22 例）/ SA2 R1（C1/M2 绿灯期增补建议）
- **方法**：独立进程测试复跑（harness 后台作业）+ 破坏性/补充性测试编写（新增 6 例，全部以真实 Host 管理器 + registry 测试 seam + 真实 File adapter / 真实进程 spawn 驱动）

---

## Step 0 — SA4 verdict 校对

`wiki/raw/task_expose-diagnostic-replay-host-lifecycle_sa4_review.md` 顶部：
`Verdict: pass`（R2 限定复核，2026-09-03：F1 已按处方修复——E1–E4 timeout-only 修订 + 标准 acceptance 命令 22/22 绿）。

→ SA4 pass，SA7 进入动态验证（不允许下调，只可独立发现 fail）。

> **R4 注（2026-09-03 20:53 复核）**：SA4 verdict 现为 **pass（R3 恢复轮维持）**——生产 diff 自 R2 字节冻结、SA7 套件过审（R3.2）、SA3 flake 归因独立攻击未被推翻（R3.3）。R4 轮以 R3 pass + 当前未提交 diff 为基准，Step 0 放行不变。

> **R5 注（2026-09-03 23:14 复核）**：SA4 verdict 现为 **pass（R4 恢复轮最终，23:11）**——四项测试独立串行复跑全绿 + 机械门禁全过 + 生产 diff 自 R2 字节冻结独立复核。R5 轮以 R4 pass + 当前未提交 diff 为基准（本轮独立验证 23:12 后零 `.ts` 变更），Step 0 放行不变。

## Step 1 — SA6 红灯契约复跑（第二关）

| 命令 | 结果 |
|---|---|
| `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run apps/yjs-server/test/diagnostic-replay-host-lifecycle-red.test.ts`（root `pnpm test` 对该文件的精确语义；**无任何 `--testTimeout` 覆盖**） | **22/22 pass，exit 0**，`Type Errors no errors`，Duration 38.10s |

单例时长：E1 6335ms / E2 6126ms / E3 5924ms / E4 5962ms / E5 12560ms——与 SA4 R2 记录（6332/6077/5924/5964/12561）一致，E1–E4 均 >5s 默认超时（F1 诊断复证成立，300_000 夹具参数有效）。

**[SA7 Step 1 结论] SA6 红灯: 🟢 GREEN → 进入 Step 2。**

---

## Step 2 — SA4「动态审核重点」六条逐条验证

### 重点 1 — CI 全量 `pnpm test` 绿灯证据 → **环境阻塞（本地等价已补齐）**

- **阻塞事实**（gh CLI 已认证，welltop-jim-wang 账号）：
  - `git ls-remote --heads origin | grep mabf/issue-155` → 空（分支未推送）；
  - `gh pr list --head mabf/issue-155 --state all` → `[]`（无 PR）；
  - `gh run list --branch mabf/issue-155` → 空（无任何 CI run）。
  - worktree 为未提交 diff——`gh run view --log` 无对象可摘。push/建 PR 明确不在 SA7 职责内（skill 边界），故本条按**环境阻塞**登记，非 spec-not-triggered/vitest-package-not-triggered（触发失败分类仅适用于「CI 已跑而测试未被收集」；此处 CI 根本未发生）。
- **本地等价证据**（与 ci.yml 步骤逐一对应）：

| ci.yml 步骤 | 本地等价命令 | 结果 |
|---|---|---|
| L36 Typecheck | `pnpm typecheck`（14 个 tsconfig 全链） | **exit 0** |
| L39 Test | `pnpm test`（= `NODE_OPTIONS=--conditions=nomicore-source vitest run --typecheck`，include 覆盖 `apps/*/test/**/*.test.ts`） | **259 files / 2854 tests 全绿，Type Errors no errors，exit 0**（含本票两测试文件，摘录行见「vitest 触发证据」节；发布前同一命令亦复跑一次 258/2848 全绿） |

- **后续动作（交总控）**：push + 建 PR 后，对 latest run 执行
  `gh run view <run-id> --log | grep -E "diagnostic-replay-host-lifecycle-(red|sa7)|Test Files"` 摘录 CI 侧触发行即可闭合本条。

### 重点 2 — C1 并发 create 交错（SA2 R1 绿灯期增补建议）→ **PASS（新增 2 例）**

测试文件：`apps/yjs-server/test/diagnostic-replay-host-lifecycle-sa7.test.ts`（重点 1 describe，2 例均绿）。

- **集成级**（`Promise.all` + 真实 registry + 真实 `createHostDiagnosticsManager` + 按 docId 键控的 gate/error 注入）：A 挂 Persistence gate、B 的 createDoc 注入 `DocCreateOperationalError`——B 在 A 仍处 create 槽内时结算失败（R0 C1 攻击窗次序）。实测：
  - A 流恰 2 条（genesis-baseline seq1 + #17 namespace-create committed seq2），strict read `status:'ok'`、`issues:[]`；segment 全文不含 B 专属 schema marker（`ns-b-schema-leak-marker`）；**B 无日志目录**（`existsSync(namespaces/ns-…02) === false`——失败 create 不建流）；
  - `replayNamespaceDiagnosticLog({rootDir, namespaceId: A})` → **`complete` + `issues === []`**（SA2 R1 建议的原始断言面逐字达成）、lastAppliedSequence `'2'`、snapshot 应用到 detached Y.Doc 复现 `META.docId`/`ROOT.count`；
  - sink 事件**恰 1 条** `{event:'diagnostic-log-emission-dropped', reason:'unattributed'}` 且**不携 namespaceId**（无归属词义本体），零 `stream-unavailable`/`manager-closed`，零 `diagnostic-log-manager-failed`；
  - `[SA7-DV]` 实测摘录：`A 流 2 条记录（genesis+#17）；sink 事件 [{"event":"diagnostic-log-emission-dropped","reason":"unattributed"},{"event":"diagnostic-log","namespaceId":"ns-…01","type":"retention-swept",…}]`。
- **manager 级迟到 emit 直探**（SA2 R1 单元面）：`initStream(A)` 之后 B 的 emission 经 `runtimeEmitterFor(B)` 落 **B 自己的新流**（strict read 1 条 attempt）；A 流仍仅 genesis——数据键控归因（Map 按 namespaceId 查表，零共享可变路由状态）下跨 namespace 误归因**实测不可达**；数据通道命中 → 零丢弃事件。

### 重点 3 — M2 篡改流形直探 → **PASS（新增 1 例）**

手工改写 segment（`…/streams/<id>/segments/00000001.jsonl`）：attempt 行提至首位占 seq1、genesis 行后移占 seq2（reader 连续性 1,2 仍成立——攻击面专打 replay 的 mid-genesis 判定）。实测：

```
status: 'failed'
issues: [{code:'genesis-misplaced'}, {code:'genesis-missing'}]   // 恰两条、该顺序
lastAppliedSequence: null
snapshot: undefined
```

与 SA4 §六预判（attemptSeen(M2) → genesis-misplaced + break → ⑤ genesis-missing → failed 无基）逐字一致；伪造基线不可能 complete。

### 重点 4 — §二-D1 legacy fallback 动线 → **PASS（无泛滥，生产不可达性实测）**

- **静态面复验**：#150 冻结契约（emitter-only binding——legacy fallback 的唯一消费形态）在本轮全量 `pnpm test` 中全绿：`✓ packages/namespace-registry/test/registry-create-diagnostic-red.test.ts (16 tests)`。
- **进程级实测**（重点 5 E2E 同一进程）：enabled 态全生命周期 NDJSON **零** `diagnostic-log-emission-dropped`（生产管理器恒提供 `runtimeEmitterFor` → 恒走数据键控通道，fallback 分支生产不可达——manager 级直探用例亦断言 `expect(resolver).toBeDefined()` 坐实该前提）。「泛滥」不存在。
- 附注：唯一产生 `unattributed` 丢弃的场景是 create 槽内 initStream 之前的失败结局（重点 2 注入实测）——词义正确（无归属前置失败），非接线回归。

### 重点 5 — D8 健康事件面 → **PASS（新增 1 例，进程级 NDJSON 摘录）**

真实进程（tsx spawn `main.ts`，hub + provision + verify-write + SIGTERM exit 0，6.3s）enabled 态全生命周期 `diagnostic*` NDJSON 事件流完整摘录：

```json
[
  {"event":"diagnostic-log","namespaceId":"ns-0812c4d8…","type":"retention-swept","deletedGroups":0,"reclaimedBytes":0,"orphanBinsDeleted":0,"deletingMarkersCompleted":0,"leaseBlockedGroups":0,"failedSteps":0},
  {"event":"diagnostics-closed"}
]
```

- `diagnostics-closed` **恰 1 次**（performStop 有界收口事件上线——此前既有测试零断言的面，现已钉死）；
- `diagnostic-log` 健康事件实际出现（构造期 retention sweep 的 observer 投影，字段全在 health.ts 冻结白名单内：type/计数类，无 streamId/segment/offset）；
- 停机前后均零 `diagnostic-log-emission-dropped` / `diagnostic-log-manager-failed`；
- 数据通道载荷落地（genesis 首位 + root-mutation attempt 记录在流中）——「零丢弃」断言因此有载荷意义（证明 emission 真实流经数据通道而非无流量）。

### 重点 6 — §六(a)/(b) 两 note 运行时复核 → **PASS（新增 2 例）**

- **(a) issues 镜像双份**：健康链尾接两行垃圾 → 实测 `issues = [invalid-json ×3]`（**镜像 ③ 全量 2 份 + 停止点 ④ 1 份**）、`status:'partial'`（三态判定不受双份影响——`issues.length>0` 即非 complete，方向保守只多不少）、`lastAppliedSequence:'2'`（停在停止点前，停止点之后的发现不进入——m2「截断」语义在停止点面成立；镜像面全量属设计既定的「该流事实并集」语义）、`snapshot` 仍诚实给出（有重放基）。`[SA7-DV]` 摘录：`issues=[{"code":"invalid-json"},{"code":"invalid-json"},{"code":"invalid-json"}] status=partial`。
- **(b) fatal-committed effect:'unknown' 推进语义**：健康链中段插入 `{kind:'fatal', committed:true, effect:'unknown'}`（fatalFromBytes 无 bytes 形状，经真实 File adapter 落盘）→ 实测 **complete**、`issues:[]`、`lastAppliedSequence:'4'`（genesis=1、update=2、fatal-unknown=3 **按「其他」分支推进计数**、update=4）、snapshot 复现终态（ROOT.count=9）。该记录形状不产生 issue、不 break——按 best-effort disclaimer 语义可接受（SA4 note 的运行时确认）。

---

## Spec 触发证据 (verdict 升级 — 2026-06-09)

**N/A**——本任务 SA1 design / SA6 契约均无 `*.spec.ts`（唯一 E2E 面 = `*.test.ts`，由 vitest 承载）；SA4 §1.3 静态门禁同判 N/A。无 E2E Playwright spec 需要触发证据。

## vitest 触发证据 (verdict 升级 — 2026-06-15)

**CI Run: 环境阻塞**（分支 `mabf/issue-155` 未推送、无 PR、无 run——见 Step 2 重点 1；**R4 恢复轮 20:53 复查依旧**；**R5 恢复轮 23:14 再查依旧**：`git ls-remote --heads origin` 无 `mabf/issue-155`、`gh pr list --head mabf/issue-155 --state all` → 空、`gh run list --branch mabf/issue-155` → 空；`spec-not-triggered`/`vitest-package-not-triggered` 分类不适用，因为触发面从未运行而非运行未收集）。

**本地等价证据**（root `pnpm test` 与 ci.yml L39 Test 步骤同一命令、同一 include 面；**R4 轮全量复跑日志 `.pnpm-store/.sa7-logs/r4-full.log`**——gitignored 沙箱暂存，报告以命令+摘录行为准）：

| Workspace 测试文件 | CI Step Name | 触发结果 | log 摘录（本地全量 run） |
|---|---|---|---|
| `apps/yjs-server/test/diagnostic-replay-host-lifecycle-red.test.ts` | Test (`pnpm test`) | ✓ 触发且通过（本地等价）22 tests | `✓ apps/yjs-server/test/diagnostic-replay-host-lifecycle-red.test.ts (22 tests) 37568ms` |
| `apps/yjs-server/test/diagnostic-replay-host-lifecycle-sa7.test.ts`（SA7 新增） | Test (`pnpm test`) | ✓ 触发且通过（本地等价）6 tests | `✓ apps/yjs-server/test/diagnostic-replay-host-lifecycle-sa7.test.ts (6 tests) 6537ms` |

> **R4 轮同一矩阵复跑摘录**（r4-full.log）：`✓ …red.test.ts (22 tests) 39684ms`、`✓ …sa7.test.ts (6 tests) 6764ms`；汇总 `Test Files 259 passed (259)` / `Tests 2854 passed (2854)` / `Type Errors no errors` / `FULL_EXIT=0`（Duration 186.19s）。

> **R5 轮同一矩阵复跑摘录**（r5-full.log）：`✓ …red.test.ts (22 tests) 40453ms`、`✓ …sa7.test.ts (6 tests) 7008ms`；汇总 `Test Files 1 failed | 258 passed (259)` / `Tests 1 failed | 2853 passed (2854)` / `Type Errors no errors` / exit 1（Duration 186.07s）——唯一失败 = `phase5-mgmt-verbs-sa7.test.ts`（非 #155 面、零 `diagnostic` 引用、满载 spawn 抖动；**隔离复跑 5/5 绿 exit 0**，归因闭合见 R5.2；**两 #155 文件在该失败 run 内本身绿**）。

汇总行：`Test Files 259 passed (259)` / `Tests 2854 passed (2854)` / `Type Errors no errors` / `FULL_EXIT=0`。

静态接通面（SA4 §1.4 已核，本轮复核）：root `vitest.config.ts` include 含 `apps/*/test/**/*.test.ts`，两文件均在该 glob 内且实测被收集执行。**总控发布 PR 后需按重点 1 的命令补 CI run-log 摘录以闭合升级要求。**

---

## 测试执行环境注记

- **沙箱等价移植**：本 harness 每次 bash 调用为独立 bwrap（`--tmpfs /tmp` + `--die-with-parent`）——skill 模板的 `setsid nohup … /tmp/sa7.log` 跨调用不存活。已按 SA4 R2 同款等价移植为 harness 后台作业（`run_in_background` + `job_output` 收敛），全部测试命令仍起独立进程、异步收敛、零 ACP session 内同步阻塞。日志暂存于 gitignored `.pnpm-store/.sa7-logs/`。
- **端口**：全部用例 `freePort()` 动态分配（含新增 E2E），零固定端口依赖，无需 `fuser` 清场；未发现遗留异常进程。
- **并发纪律**：SA4 V5 注记的 spawn 型 E2E 并发抖动已规避——全量套件与单文件套件串行执行（本报告各命令均独立作业、无重叠）。

## 产出产物

| 产物 | 位置 | 消费者 |
|---|---|---|
| 动态验证报告（本文件） | `wiki/raw/task_expose-diagnostic-replay-host-lifecycle_sa7_report.md` | 总控、后续 SA3/SA4 循环 |
| 补充性/破坏性测试（6 例：C1×2、M2×1、§六(a)×1、§六(b)×1、D8/D1 E2E×1） | `apps/yjs-server/test/diagnostic-replay-host-lifecycle-sa7.test.ts` | CI、后续 SA4 审核 |
| 全量运行日志（暂存，gitignored） | `.pnpm-store/.sa7-logs/full-test.log` / `typecheck.log`（首轮）；`r4-red.log` / `r4-sa7.log` / `r4-full.log` / `r4-typecheck.log`（R4 恢复轮）；`r5-red.log` / `r5-sa7.log` / `r5-full.log` / `r5-phase5-isolated.log` / `r5-typecheck.log`（R5 恢复轮） | 证据溯源 |

**生产代码零触碰**（git status + mtime 双重核对：16 个生产/配置文件 mtime 均为 SA3/SA4 时点 09-02 22:2x–22:3x，SA7 仅新增测试文件与本报告）。

---

## R4 恢复轮独立动态验证（2026-09-03 20:53–21:05）

> 总控指令：以 **SA4 R3 pass + 当前未提交 #155 diff** 为基准执行当前恢复轮的独立动态验证，更新本报告并明确最终 Verdict。全部命令独立进程（harness 后台作业，等价移植 skill 模板——见「测试执行环境注记」），**严格串行**（规避 SA4 V5 注记的 spawn 型 E2E 并发抖动）；主机 4 核、执行窗 load 2.0–2.7。

### R4.0 基准冻结独立复核

| 项 | 独立证据 | 结论 |
|---|---|---|
| 生产 diff 字节冻结 | 16 修改文件 mtime 逐文件 stat = 09-02 22:22:40–22:35:19（与 SA4 R3.1 记录逐点一致）；red test 09-03 12:04:48、sa7 test 09-03 12:35:23 | R4 验证对象 = SA4 R3 审核对象 |
| 增量触碰面 | `find apps packages domains -name '*.ts' -newermt '2026-09-03 13:46'` → 空（SA3 终局回归同款命令独立复跑，结果一致） | 13:45 后零源码变更 |
| diff 统计 | `git diff --stat` = 16 files / +493 / −24（含 pnpm-lock +3） | 与 SA4 R1「~490 行增量」一致 |
| 遗留进程/端口 | `ps` 扫描 tsx/vitest/yjs-server → 空；全部用例 `freePort()` 动态分配，无需 `fuser` 清场 | 环境干净 |

### R4.1 独立复跑结果（全部 exit 0）

| # | 命令（全部 `NODE_OPTIONS=--conditions=nomicore-source`，独立后台进程） | 结果 | 日志 |
|---|---|---|---|
| R4-V1 | `pnpm exec vitest run apps/yjs-server/test/diagnostic-replay-host-lifecycle-red.test.ts`（标准 acceptance 命令，**无任何 `--testTimeout` 覆盖** = F1 原暴露面） | **22/22 pass**，Type Errors no errors，Duration 39.28s；E1 6486 / E2 6239 / E3 6083 / E4 6071 / E5 12889 ms（E1–E4 均 >5s 默认超时，F1 修复持续有效） | r4-red.log |
| R4-V2 | `pnpm exec vitest run apps/yjs-server/test/diagnostic-replay-host-lifecycle-sa7.test.ts` | **6/6 pass**（C1×2、M2×1、§六(a)×1、§六(b)×1、D8/D1 E2E×1），Type Errors no errors | r4-sa7.log |
| R4-V3 | `pnpm test`（= ci.yml L39 Test 步骤同一命令） | **259 files / 2854 tests 全绿**，Type Errors no errors，`FULL_EXIT=0`（186.19s，主机负载中等）——含本票两文件（摘录行见「vitest 触发证据」节） | r4-full.log |
| R4-V4 | `pnpm typecheck`（= ci.yml L36，14 tsconfig 全链） | **exit 0，`error TS` 计数 0** | r4-typecheck.log |

### R4.2 六条动态审核重点活链路复证（R4-V2 内 `[SA7-DV]` 打点本轮原文摘录）

1. **C1 并发交错**：`A 流 2 条记录（genesis+#17）；sink 事件 [{"event":"diagnostic-log-emission-dropped","reason":"unattributed"},{"event":"diagnostic-log",…,"type":"retention-swept",…}]`——unattributed 计数恰 1 且不携 namespaceId，A 流无 B 痕迹，replay complete/issues=[] 断言随 6/6 绿成立。
2. **M2 篡改流形**：`[attempt(seq1), genesis(seq2)]` → failed + genesis-misplaced/genesis-missing、无 snapshot、lastAppliedSequence=null（用例绿）。
3. **§六(a) 镜像双份**：`issues=[{"code":"invalid-json"}×3] status=partial`——镜像 2 份 + 停止点 1 份，三态判定不受影响。
4. **§六(b) fatal-unknown 推进**：complete、issues=[]、lastAppliedSequence 计入该记录、快照复现终态（用例绿）。
5. **D8/D1 进程级 NDJSON**：`[{"event":"diagnostic-log",…,"type":"retention-swept",…},{"event":"diagnostics-closed"}]`——停机恰一次 `diagnostics-closed`，健康运行零 `emission-dropped`，数据通道载荷落地。

### R4.3 环境阻塞项复查（持续登记，非本票缺陷）

- CI run-log 摘录：分支 `mabf/issue-155` **仍未推送**（`git ls-remote` 无该 head）、无 PR、`gh run list --branch` 空 → Step 3/4 动态门禁的 CI 面依旧不可执行。`spec-not-triggered`/`vitest-package-not-triggered` 分类不适用（触发面从未运行）。本地等价证据（R4-V3/R4-V4）与 ci.yml L36/L39 逐步对应已补齐；**push/建 PR 及其后 run-log 摘录归总控**（SA7 skill 边界明确不负责发布）。
- 无其他阻塞：测试命令、gh CLI 读取、临时目录均正常。

### R4.4 R4 轮结论

- 未发现任何实现缺陷或回归；六条 SA4 动态审核重点在冻结 diff 上全部以活链路证据复证；F1 修复在默认超时面持续成立；全仓 259/2854 + typecheck 双绿复现 SA3/SA4 时间线（同码第 5/6 次全量绿）。
- **SA7 最终 Verdict: pass（R4 恢复轮维持）**，唯一残留 = CI run-log 摘录（环境阻塞，交总控发布后闭合）。

---

## R5 恢复轮独立动态验证（2026-09-03 23:14–23:24）

> 总控指令：以 **SA4 R4 pass（23:11 最终）+ 当前未提交 #155 diff** 为基准执行当前恢复轮的独立动态验证，更新本报告并明确最终 Verdict。全部命令独立进程（harness 后台作业，等价移植 skill 模板），**严格串行**（V1 → V2 → V3(+V3b) → V4，无重叠）；主机 4 核、满载窗 load 4.43。

### R5.0 基准冻结独立复核

| 项 | 独立证据 | 结论 |
|---|---|---|
| 生产/测试源码零变更 | `find apps packages domains -name '*.ts' -newermt '2026-09-03 23:12'` → 空（SA4 R4 审核窗 23:01–23:11 之后零 `.ts` 写入） | R5 验证对象 = SA4 R4 审核对象（逐字节） |
| diff-stat 增量归因 | 本轮 `git diff --stat` = 17 files / +523 / −54 vs SA7 R4 记录 16 / +493 / −24；差值恰 = **REPORT.md +30/−30**（`git diff --stat REPORT.md` 独立核验；Controller 21:14 写入，SA4 R4.1 已登记为工件 note） | 生产代码面零增量，唯一变化非 SA3 所为 |
| 伪造绿灯手段 | 两测试文件 `.skip(/.only(/setConfig` grep = 0 命中；red test `300_000` 恰 5 次（E1–E5） | 无 |
| 触发接通面 | root `vitest.config.ts` include 含 `apps/*/test/**/*.test.ts`；ci.yml L36 `pnpm typecheck` / L39 `pnpm test` 与本地等价命令逐步对应 | 接通 |
| 遗留进程 | `ps` 扫描 tsx/vitest → 0（本轮全部测试收敛后复查） | 环境干净 |

### R5.1 独立复跑结果

| # | 命令（全部 `NODE_OPTIONS=--conditions=nomicore-source`，独立后台进程，串行） | 结果 | 日志 |
|---|---|---|---|
| R5-V1 | `pnpm exec vitest run apps/yjs-server/test/diagnostic-replay-host-lifecycle-red.test.ts`（标准 acceptance 命令，**无任何 `--testTimeout` 覆盖** = F1 原暴露面） | **22/22 pass，exit 0**，Type Errors no errors，Duration 39.27s；E1 6492 / E2 6237 / E3 6089 / E4 6073 / E5 12837 ms（E1–E4 均 >5s 默认超时——F1 修复持续有效） | r5-red.log |
| R5-V2 | `pnpm exec vitest run apps/yjs-server/test/diagnostic-replay-host-lifecycle-sa7.test.ts` | **6/6 pass，exit 0**（C1×2、M2×1、§六(a)×1、§六(b)×1、D8/D1 E2E×1），Type Errors no errors，7.96s；`[SA7-DV]` 三处打点本轮原文复现（R5.3） | r5-sa7.log |
| R5-V3 | `pnpm test`（= ci.yml L39 Test 步骤同一命令） | **两 #155 文件在同 run 内绿**（`✓ …red.test.ts (22 tests) 40453ms`、`✓ …sa7.test.ts (6 tests) 7008ms`，摘录行在录）；汇总 258/259 files、2853/2854 tests 绿、Type Errors no errors、exit 1——**唯一失败为非 #155 文件**（R5.2 归因闭合） | r5-full.log |
| R5-V3b | `pnpm exec vitest run apps/yjs-server/test/phase5-mgmt-verbs-sa7.test.ts`（失败文件**隔离串行**复跑，V5 先例处方） | **5/5 pass，exit 0**，Type Errors no errors，Duration 40.48s | r5-phase5-isolated.log |
| R5-V4 | `pnpm typecheck`（= ci.yml L36，14 tsconfig 全链） | **exit 0，`error TS` 计数 0** | r5-typecheck.log |

### R5.2 满载窗 1 例失败的独立归因（R5-V3 内 `phase5-mgmt-verbs-sa7.test.ts` 1/5 红）

本轮满载 run 出现 1 例失败，按「SA7 只可独立发现 fail、不可轻信既有归因」原则独立取证，四点证据链：

1. **结构性隔离**：失败文件 `grep -c diagnostic` = **0**——#155 增量路径需 `diagnostics` 配置启用（resolver 在 `diagnosticLog == null` 时恒 no-op，SA4 R3.3 已核 create-diagnostic.ts:290-291/runtime.ts:598-600/plugin.ts:184-192）；该文件从未启用 → #155 路径在该测试内**不可达**。
2. **失败形态**：`Error: process exited awaiting reply to {"op":"read",…}`（phase5-mgmt-verbs-sa7.test.ts:182 sendOp）——spawn 子进程在 await reply 窗口内退出，负载/时序敏感型失败，与 SA4 R1 V5、SA3 终局回归（13:45 红）登记的 spawn 型 E2E 抖动同族。
3. **同码异果（flake 定义性证据）**：R5-V3b 隔离串行复跑同文件 **5/5 绿 exit 0**（零代码变更间隔仅数分钟）；满载窗 load 4.43/4 核。
4. **#155 面在该失败 run 内本身绿**：22+6 tests 两文件摘录行同 run 在录——失败与 #155 改动无因果接触面。

**处置**：不构成 #155 回归 → 不触发 SA7 fail。登记为既有 spawn 抖动观察项（同码绿计数：12:35 / 19:09 / 19:14 / SA4-R3 / SA7-R4 / SA4-R4 六次全量 259/259 全绿 vs 本轮 258/259——非同码首见，13:45 同族先例两次失败文件之一即 phase5 家族）。移交 PR CI（ubuntu 独占 runner）观察，与 R3.4 残留项 1 同口径。

### R5.3 六条动态审核重点活链路复证（R5-V2/V3 内 `[SA7-DV]` 打点本轮原文摘录）

1. **C1 并发交错**：`A 流 2 条记录（genesis+#17）；sink 事件 [{"event":"diagnostic-log-emission-dropped","reason":"unattributed"},{"event":"diagnostic-log","namespaceId":"ns-000…001","type":"retention-swept",…}]`——unattributed 恰 1 且不携 namespaceId，A 流无 B 痕迹，replay complete/issues=[] 断言随 6/6 绿成立。
2. **M2 篡改流形**：`[attempt(seq1), genesis(seq2)]` → failed + genesis-misplaced/genesis-missing、无 snapshot、lastAppliedSequence=null（用例绿）。
3. **§六(a) 镜像双份**：`issues=[{"code":"invalid-json"}×3] status=partial`——镜像 2 份 + 停止点 1 份，三态判定不受影响。
4. **§六(b) fatal-unknown 推进**：complete、issues=[]、lastAppliedSequence 计入该记录、快照复现终态（用例绿）。
5. **D8/D1 进程级 NDJSON**：`[{"event":"diagnostic-log",…,"type":"retention-swept",…},{"event":"diagnostics-closed"}]`——停机恰一次 `diagnostics-closed`，健康运行零 `emission-dropped`，数据通道载荷落地。

### R5.4 环境阻塞项复查（持续登记，非本票缺陷）

- CI run-log 摘录：分支 `mabf/issue-155` **仍未推送**（本轮 23:14 三连复查：`git ls-remote` 无该 head、`gh pr list` 空、`gh run list` 空）→ Step 3/4 动态门禁的 CI 面依旧不可执行；`spec-not-triggered`/`vitest-package-not-triggered` 分类不适用（触发面从未运行）。本地等价证据（R5-V3/V3b/V4）与 ci.yml L36/L39 逐步对应已补齐；push/建 PR 及其后 run-log 摘录归总控（SA7 skill 边界明确不负责发布）。
- 无其他阻塞：测试命令、gh CLI 读取、临时目录均正常；无遗留进程。

### R5.5 R5 轮结论

- 未发现任何 #155 实现缺陷或回归；六条 SA4 动态审核重点在冻结 diff 上全部以活链路证据复证；F1 修复在默认超时面持续成立（E1–E4 实测 6.07–6.49s）；满载窗唯一失败经四点证据链独立归因为既有 spawn 抖动（非 #155 面），隔离复跑绿。
- **SA7 最终 Verdict: pass（R5 恢复轮维持）**，唯一残留 = CI run-log 摘录（环境阻塞，交总控发布后闭合）。


## 结论

| Step | 结论 |
|---|---|
| Step 0 SA4 verdict 校对 | pass → 放行验证 |
| Step 1 SA6 红灯 | 🟢 22/22（标准 acceptance 命令、默认超时面） |
| Step 2 重点 1 CI 证据 | 环境阻塞（分支未发布）；本地等价（typecheck 0 errors + 全量 259/2854 绿）已补齐，后续动作交总控 |
| Step 2 重点 2 C1 并发交错 | ✅ 2 例：A 流无 B 痕迹、replay complete/issues=[]、unattributed 计数恰 1 |
| Step 2 重点 3 M2 篡改流形 | ✅ failed + genesis-misplaced/genesis-missing、无 snapshot |
| Step 2 重点 4 D1 legacy fallback | ✅ 生产不可达（resolver 恒在）+ 进程级零泛滥；#150 静态面全绿 |
| Step 2 重点 5 D8 健康事件面 | ✅ NDJSON 摘录：retention-swept + 恰一次 diagnostics-closed、零丢弃 |
| Step 2 重点 6 §六(a)/(b) | ✅ 镜像 3 份保守双报（三态不受影响）；fatal-unknown 推进 → complete |
| Step 3 spec 触发 | N/A（无 *.spec.ts） |
| Step 4 vitest 触发 | 本地等价 ✓ 两文件均收集且全绿；CI run-log 待发布后摘录（阻塞已登记） |
| **R4 恢复轮独立复验** | ✅ 基准冻结复核 + 22/22 + 6/6 + 全量 259/2854 + typecheck 0 errors 全部独立复现；六重点 `[SA7-DV]` 打点原文复证；CI 面持续环境阻塞（分支未推送，复查依旧） |
| **R5 恢复轮独立复验**（最终） | ✅ 基准 = SA4 R4 pass + 逐字节冻结 diff（23:12 后零 `.ts` 变更，diff-stat 增量恰 = REPORT.md Controller 工件）；22/22（默认超时面）+ 6/6 + 满载全量 2853/2854（两 #155 文件同 run 绿；唯一失败非 #155 面、零 diagnostic 引用、隔离复跑 5/5 绿——四点证据链归因为既有 spawn 抖动）+ typecheck 0 errors；六重点 `[SA7-DV]` 打点原文复证；CI 面持续环境阻塞（三连复查依旧） |

**Verdict: pass（最终 = R5 恢复轮维持）** —— SA4（R2→R3→R4 pass）六条动态审核重点全部以活链路证据闭合（其中 5 条为新增破坏性/补充性测试的实测断言，1 条环境阻塞已用本地 CI 等价命令补齐并登记后续动作）；未发现任何实现缺陷。R5 恢复轮以 SA4 R4 pass（23:11 最终）+ 逐字节冻结 diff 为基准独立复跑：红灯契约 22/22（默认超时面，E1–E4 实测 6.07–6.49s，F1 持续成立）、SA7 补充套件 6/6、CI 等价全量中两 #155 文件同 run 绿 + 满载唯一失败（非 #155 面）经隔离复跑与结构性隔离独立归因为既有 spawn 抖动、root typecheck 0 errors。唯一残留项 = CI run-log 摘录（环境阻塞：分支未推送/无 PR——push/PR 归总控，发布后按「重点 1」命令闭合即可）。

*SA7 完（R2 首轮 2026-09-03 12:0x–12:40 → R4 恢复轮 20:53–21:05 → R5 恢复轮 23:14–23:24）——控制权交回总控。*
