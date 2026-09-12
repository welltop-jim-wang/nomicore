# SA3 Implementation Report — issue #333（T0：readData 成功分支形状断言 helper 化 prefactor）

- 任务类型：Refactor（纯测试重构；零产品代码 / 公共类型变化）
- 设计：`wiki/raw/task_issue-333_design.md`（SA1，iteration 0）；评审：`wiki/raw/task_issue-333_sa2_review.md`（SA2 **approve**，无 BLOCKER/MAJOR）
- 契约：`wiki/raw/task_issue-333_sa6_contract.md`（SA6 **approve**；C1a/C1b/C2.1–C2.4/C3a–C3c）
- worktree / base：`/home/wangjian/nomicore-fix-issue-333` @ `ba11f32`（未提交；SA3 不 commit/push）
- Owner feedback：无适用评论（dispatch 记录 REST comment read 返回空数组；SA6 §2 / SA2 §4 同证）

## Inputs consumed

| 输入 | 状态 | 用途 |
|---|---|---|
| `wiki/raw/task_issue-333.md` | 在场 | AC1–AC3（收敛 / 语义零变化 / 零生产变更） |
| `wiki/raw/task_issue-333_design.md` | 在场 | 唯一实施依据（§7.1 helper 全文、§8.1 改写式、§10 ALLOW/DENY、附录 27+9 逐点表） |
| `wiki/raw/task_issue-333_sa2_review.md` | 在场 | approve；无 BLOCKER/MAJOR（§12「无需修订即可实施」）；O1–O5 为观察，不阻断 |
| `wiki/raw/task_issue-333_sa6_contract.md` | 在场 | 验收条款与仪器语义（§12.2）、突变探针规格（§9 M1/M2） |
| `packages/namespace-runtime/test/helpers/readdata-shape-assertion-scan.ts` + `readdata-shape-assertion-consolidation-gate.test.ts` | 在场（未跟踪，SA6 交付面） | 红灯契约执行面；**只读消费，零改动**（DENY） |
| `wiki/raw/task_issue-333_relevant_decisions.md` / `_conflict_report.md` / `_sa8_*` | **不存在** | 按设计 §6 以 ADR-0016/0024 原文 + 两包 `AGENTS.md` 替代锚定继续（非阻塞） |

## Existing worktree reconciliation

- 起始工作树：`ba11f32` 干净 tracked 树 + 3 个未跟踪 SA6 产物（扫描器、门、task brief）+ 4 个未跟踪 wiki 输入；**无既有实现或半成品**（`wiki/raw/task_issue-333_sa3_impl.md` 不存在）。
- 红灯基线现场复核：`readdata-shape-assertion-consolidation` → **2 failed | 18 passed (20)**，family A 24 处 / family B 3 处，与 SA6 §13-E5 完全一致。
- 无过时实现需修正或删除；本次为原位新建实现。

## Changed paths

| Path | Design section | Change |
|---|---|---|
| `packages/namespace-runtime/test/helpers/readdata-ok-shape.ts` | §7.1 全文（含文件头反伪绿不变量） | **新增**：`READDATA_OK_KEYS` / `ReadDataOkShape` / `readDataOk`（构造面）/ `expectReadDataOk`（family A 断言面，期望独立内联）/ `expectReadDataOkKeys`（family B 键集面）；断言面与构造面**不互相派生** |
| `packages/namespace-runtime/test/runtime-readdata-hostile-path-guard.test.ts` | §8.1 family A ×4 + §10.1 | L38/L53/L61/L69 四处 `toEqual({ok:true,…})` → `expectReadDataOk(r, { value, schema })`（含显式 `value: undefined` 与四键投影体）；import 行；后随 `'schema' in r` 与 `Object.isFrozen` 抽检原样保留 |
| `packages/namespace-runtime/test/runtime-readdata-schema-projection-red.test.ts` | §8.1 family B ×1 + C2.4 | L102 键集字面量 → `expectReadDataOkKeys(r)`；import 行；`readOk` 窄接口 / `oracle` / `PROJ` / 分字段断言**零改动** |
| `packages/namespace-registry/test/readdata-docs-adr0016-sync-control.test.ts` | §8.1 family B ×2 | L143/L154 → `expectReadDataOkKeys(r1)` / `expectReadDataOkKeys(r2)`；import 行；同测试体其余断言（`JSON.stringify` 含 `"schema"`、四键投影键集）原样保留 |
| `packages/namespace-registry/test/registry-idle.test.ts` | §8.1 family A ×11 + §8.1 生产者 ×1 | 11 断言 → `expectReadDataOk(lease{,2}.readData(['x']), { value, schema: null })`（含 4 条行尾注释原样保留）；`ObservableRuntime.readData()` → `readDataOk(this.marker, null)`；import 行 |
| `packages/namespace-registry/test/registry-create.test.ts` | §8.1 family A ×3 + 生产者 ×1 | L517/1769/1770 → `expectReadDataOk(...)`；`makeMarkerRuntime` → `readDataOk(marker, null)`；import 行 |
| `packages/namespace-registry/test/registry-open.test.ts` | §8.1 family A ×2 + 生产者 ×3 | L816/880 → `expectReadDataOk(...)`；`makeRuntime` 默认 + 两处内联 override → `readDataOk('runtime-value'\|'still-readable'\|'pre-p0-value', null)`；import 行 |
| `packages/namespace-registry/test/registry-sa7-rev1.test.ts` | §8.1 family A ×3 + 生产者 ×1 | 三处 `expectReadDataOk(lease2.readData(['x']), { value: 'R2', schema: null })`；stub → `readDataOk(this.marker, null)`；import 行 |
| `packages/namespace-registry/test/registry-sa7-hostile.test.ts` | §8.1 family A ×1 + 生产者 ×1 | L423 → `expectReadDataOk(...)`；stub → `readDataOk(this.marker, null)`；import 行 |
| `packages/namespace-registry/test/registry-sa7-concurrency.test.ts` | §7.2 / §10.1（仅生产者） | `CountingRuntime.readData()` → `readDataOk(this.marker, null)`；import 行 |
| `packages/namespace-registry/test/registry-shutdown.test.ts` | §7.2 / §10.1（仅生产者） | `ObservableRuntime.readData()` → `readDataOk(this.marker, null)`；import 行 |

零产品代码 / 公共类型 / 文档 / 配置改动（见 §File scope check 与 Verification C3a）。

## SA2 Finding落实

SA2 结论为 **approve，无 BLOCKER / MAJOR**（`task_issue-333_sa2_review.md` §12），故无强制修订项。观察项处置：

| Finding ID | Implementation | Result |
|---|---|---|
| O1（跨包 import 方向措辞） | registry 8 文件 import runtime 测试树 helper（`../../namespace-runtime/test/helpers/readdata-ok-shape.js`），与 `durable-snapshot-wait.js` 先例同向 | 类型检查与运行均通过（C3b / M0 证据） |
| O2（`derived.ts` 行号笔误） | 无需动作（四键投影体字面量经上下文类型赋值，见 C2.2.4 证据） | `--typecheck` 无类型错误 |
| O3（C3c 基线口径） | 本报告显式写明：pristine 基线 338 文件/3588 tests（不含门）；当前树含门 = 339 文件/3608 tests（T0 前 2 红） | 见 Verification C3c 行 |
| O4（`toStrictEqual`→`toEqual` 回退路径） | **未触发**：C2.1 全套绿，无原型/undefined 键差异；helper 保持 `toStrictEqual` | 严格性只增不减 |
| O5（反伪绿不变量持久化） | 模块头注写死不变量；断言面与构造面各自独立内联构造（生产者扫描恰 2 条，见 Verification）；M2 探针实测仍红 | 反伪绿分离成立 |

## File scope check

| Changed path | ALLOW entry | Purpose |
|---|---|---|
| `packages/namespace-runtime/test/helpers/readdata-ok-shape.ts` | ALLOW §10.1 行 1（新增共享 helper） | 单点断言/构造面 |
| `packages/namespace-runtime/test/runtime-readdata-hostile-path-guard.test.ts` | ALLOW §10.1 行 2（4 断言 + import） | C1a |
| `packages/namespace-runtime/test/runtime-readdata-schema-projection-red.test.ts` | ALLOW §10.1 行 3（仅 L102 + import） | C1b |
| `packages/namespace-registry/test/readdata-docs-adr0016-sync-control.test.ts` | ALLOW §10.1 行 4（L143/154 + import） | C1b |
| `packages/namespace-registry/test/registry-idle.test.ts` | ALLOW §10.1 行 5（11 断言 + L242 + import） | C1a + §7.2 |
| `packages/namespace-registry/test/registry-create.test.ts` | ALLOW §10.1 行 6（L517/1769/1770 + L381 + import） | C1a + §7.2 |
| `packages/namespace-registry/test/registry-open.test.ts` | ALLOW §10.1 行 7（L816/880 + L184/804/858 + import） | C1a + §7.2 |
| `packages/namespace-registry/test/registry-sa7-rev1.test.ts` | ALLOW §10.1 行 8（L547/624/687 + L211 + import） | C1a + §7.2 |
| `packages/namespace-registry/test/registry-sa7-hostile.test.ts` | ALLOW §10.1 行 9（L423 + L166 + import） | C1a + §7.2 |
| `packages/namespace-registry/test/registry-sa7-concurrency.test.ts` | ALLOW §10.1 行 10（L168 + import） | §7.2 |
| `packages/namespace-registry/test/registry-shutdown.test.ts` | ALLOW §10.1 行 11（L190 + import） | §7.2 |

DENY LIST 核对（`git status` / `git diff --name-only` 双证）：`packages/*/src/**`、`domains/**`、`apps/**`、`docs/**`、`package.json`、`packages/doc-runtime/**`、SA6 仪器两文件、`runtime-readdata-schema-projection-control.test.ts`、3 个 `.test-d.ts`、其余无命中测试文件 —— **全部零改动**。

## Verification

| Command | Result | Evidence |
|---|---|---|
| `npx vitest run --no-typecheck readdata-shape-assertion-consolidation`（T0 前） | **2 failed / 18 passed**（A=24、B=3） | 现场复核 SA6 §13-E5；红清单逐条 file:line 吻合 |
| 同上（T0 后） | **1 file / 20 tests 全绿**（C1a/C1b 归零 + 7 正/8 负自控 + 作用域覆盖） | `Test Files 1 passed (1) / Tests 20 passed (20)` |
| 生产者扫描（`scanReadDataShapeAssertions()`，node 直跑扫描器） | 站点制造点 **9→0**；helper 模块内**恰 2 条**（`readDataOk` L29 / `expectReadDataOk` L39，均 `isAssertionArgument=false`） | `producersByFile {"…/readdata-ok-shape.ts":2}`；行为断言面 0/0（`assertionSites` 空） |
| C2.1 十文件 + `registry-sa7-concurrency` + `registry-shutdown`（12 文件） | **12 files / 178 tests 全绿** | 与 SA6 §4 基线口径吻合（10 文件 162 + 两生产者套件 16） |
| C2.4 反向边界 | `runtime-readdata-schema-projection-control.test.ts` **零 diff**，套件 6 tests 绿；red 文件 `readOk`/`oracle`/`PROJ`/分字段断言零改动 | `git diff --name-only -- …control.test.ts` 空 + 套件绿 |
| C2.3 M1（生产突变：`runtime.ts` 成功分支追加 `truncated:false, truncations:[]`，跑 hostile-guard + projection-red + docs-sync-control） | **6 tests 红**（hostile 4A + red 1B + docs-sync 1B），与 SA6 §9 M1a/M1b 计数一致；探针后 `cp` 还原，`git diff` 空 | `/tmp/sa3-m1-runtime.ts.bak`；还原后 `git diff --name-only -- packages/namespace-runtime/src/runtime.ts` 空 |
| C2.3 M2（替身突变：**只改** `readDataOk` 函数体加两键，跑 registry 五文件） | **19 tests 红**（idle 11 / open 2 / create 2 / hostile 1 / rev1 3），与 SA6 §9 M2 一致；还原后与备份逐字节相同 | `/tmp/sa3-m2-readdata-ok-shape.ts.bak` + `diff` = IDENTICAL；**证明断言面未从构造面派生（反伪绿分离成立）** |
| C3a 范围门（worktree 等价命令，SA3 未 commit） | ① `git diff --name-only \| grep -vE '^packages/(namespace-runtime\|namespace-registry)/test/'` → **空**；② `git diff --name-only -- 'packages/*/src' 'domains' 'apps' 'docs'` → **空** | `git status --porcelain`：仅 10 个 `M`（全在两测试树）+ 1 个 `??` helper |
| C3b 类型面锚 | `npx vitest run --typecheck runtime-data-interface runtime-readdata-schema-red registry-readdata-schema-red` → **3 files / 5 tests 绿，`Type Errors: no errors`** | 公共面 4 个 `.test.ts` 锚在全量运行中全绿：`runtime-public-surface-ownership`(6)、`runtime-acceptance-exports-audit`(4)、`runtime-registry-internal-seam`(5)、`registry-surface`(12) |
| C3c `pnpm typecheck` | **exit 0**（14 个包级 tsconfig） | 命令输出尾 `TYPECHECK_EXIT=0` |
| C3c `pnpm test`（root，= `vitest run --typecheck`） | **339 files / 3608 tests 全绿，`Type Errors: no errors`，exit 0**（603s） | 后台作业日志 `/tmp/sa3-fulltest.log`（尾部 `FULLTEST_EXIT=0`）；含门 20 tests 转绿 |
| 收尾复跑（还原后终态）：门 + 12 文件 | **13 files / 198 tests 全绿** | 终态证据（M1/M2 还原后无残留） |

### C3c 全量结果

`NODE_OPTIONS=--conditions=nomicore-source pnpm test`（root，= `vitest run --typecheck`，T0 后终态）：

```
Test Files  339 passed (339)
     Tests  3608 passed (3608)
Type Errors  no errors
  Duration  603.47s
FULLTEST_EXIT=0
```

- 对比口径（SA2 O3）：pristine 基线 = 338 文件 / 3588 tests 全绿（不含 SA6 门）；当前树 = 339 文件 / 3608 tests 全绿（含门 20 tests，T0 前该门 2 红）。文件数 +1 全部来自 SA6 门（已在树，非本任务新增），tests +20 即门用例。
- 日志：`/tmp/sa3-fulltest.log`（worktree 外，不进入提交）。

## Deferred verification

- **SA5 最终动态验证 / 独立复跑**：C2.3 M1/M2 探针本报告已自跑留证；按 SA6 §12.2 该条仍应由 SA5 在验收态独立重跑（探针施加点与期望红数已在本报告固化，便于复核）。
- **root `pnpm test` 全量**（C3c）：由本报告 Verification 行记录（SA3 已跑，见终态日志）；若 Controller 要求独立复现，命令为 `NODE_OPTIONS=--conditions=nomicore-source pnpm test`。
- **T3 演化钩子**（非本任务）：五键本体修订、门 family B 仪器扩展至五键、ADR-0024 文档负控正则同步 —— 设计 §12 明示 follow-up；本任务零预演。
- 本任务**无行为面/协议面回归范围**（零 src 变更），故未额外扩展回归套件；既有套件全量结果见 C3c。

## Deviations or blockers

- **无偏差、无阻塞。** 设计 ALLOW/DENY 边界清晰、红灯契约与设计一致；实现逐点按 §8.1 改写式与附录 27+9 清单执行，无临时发明、无 skip/only/todo、无 env override/fallback、未弱化任何断言。
- 未触发设计 §8.4 的回退路径（`toStrictEqual` 保持；C2.2 严格性只增不减）。
- 未修改任何验收语义或 SA6 仪器（门因字面量消失而转绿，非因改门）。
- 备注（非偏差）：`registry-create.test.ts` 的 helper import 置于 `@nomicore/namespace-registry/testing` 与 `@nomicore/namespace-runtime/internal` 两行之间（该文件既有 import 分组本就非严格排序）；仅位置，不影响语义。

## Suggested commit message

```
test(issue-333): readData 成功分支恰三键形状断言/构造收敛为共享 helper（T0 prefactor）

- 新增 packages/namespace-runtime/test/helpers/readdata-ok-shape.ts：
  expectReadDataOk（family A 全等断言，期望独立内联）/ expectReadDataOkKeys
  （family B 键集）/ readDataOk（替身构造）+ ReadDataOkShape 类型锁；
  断言面与构造面不互相派生（反伪绿不变量，SA6 C2.3）。
- runtime/registry 两测试树 27 处形状断言（24A+3B）与 9 处替身形状制造点全部经
  共享 helper 表达；断言语义零变化（toStrictEqual 严查恰三键，严格性不降）。
- 收敛门 readdata-shape-assertion-consolidation 2 红/18 绿 → 20/20 绿；
  C2.1 12 文件 178 tests、C3b 类型面锚、pnpm typecheck 全绿。
- 零产品代码 / 公共类型 / 文档 / 配置变化（C3a 两条范围门为空）。
```
