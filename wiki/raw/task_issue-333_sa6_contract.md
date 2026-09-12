# SA6 诊断与验收契约 — issue #333（T0：readData 成功分支形状断言 helper 化 prefactor）

- 任务类型：**Refactor（纯测试重构，零行为变化）**——"readData 成功分支「恰三键」深等断言收敛为统一 helper，使 T3/ADR-0024 五键破坏性修订集中在一处"
- 仓库 / HEAD：`welltop-jim-wang/nomicore` @ `ba11f32`（"docs(adr): ADR 0024 补两通道截断位置对齐计层规则…(#331)"）
- worktree：`/home/wangjian/nomicore-fix-issue-333`
- 结论：**approve**——结构性缺口稳定可复现、作用域清单可执行、行为基线绿、突变敏感性已证、负控绿、仪器可发现且自带敏感性自控；契约在 T0 前红（缺口本身）、T0 后应绿。
- SA6 判据：本任务无行为缺陷，故**不伪造行为红灯**；红的是"未集中化"这一结构性缺口（见 §12 门项 C1a/C1b），基线为绿（§4/§13）。

---

## 1. Task type and inputs

| 输入 | 状态 |
|---|---|
| Host task brief `wiki/raw/task_issue-333.md` | 在场（issue #333 正文 + AC1–AC3；Parent = PR #332 / ADR-0024-readdata-shape-budget） |
| `wiki/raw/task_issue-333_relevant_decisions.md` | **不存在**（目录内无 333 相关文件；按 skill 用 brief + 源码 + ADR + 现有测试继续） |
| `wiki/raw/task_issue-333_conflict_report.md` | **不存在** |
| SA8 产物（issue #333） | **不存在**（`wiki/raw/` 内无 `task_issue-333_sa8_*`/`_design*`）；无设计约束可读，契约按 issue AC + ADR-0024 推导 |
| 已有 SA6 报告（issue #333） | 不存在（首轮） |
| 现有测试/fixture | 已读：runtime/registry 全部 readData 相关测试、`readdata-schema-projection-fixture.ts`、`readdata-docs-adr0016-contract-fixture.ts` |
| 权威源 | `docs/adr/0024-readdata-shape-budget.md`（决策 4：恰三键 → 恒五键）、`docs/adr/0016-readdata-semantic-schema-projection.md`（成功分支恰三键） |
| Owner feedback（dispatch 记录） | REST comment read 返回空数组 → **无 owner 评论**；无未决异议需要映射 |

Issue #333 原文要点：纯测试重构；AC1 全量收敛（含"等价的集中化形状构造"）；AC2 断言语义零变化 + 全套包门禁绿；AC3 **无产品代码/公共类型变化**，root typecheck 与 test 通过。

## 2. Owner comment mapping

| Owner 意见 | SA6 处置 |
|---|---|
| （无）——dispatch 记录 "REST comment read returned an empty array" | 无映射项；不引入额外 scope。若后续出现 owner 评论，需回写 §12 契约与 §15 未知项。 |

## 3. SA8 constraints

- issue #333 无 SA8 产物、无 design/conflict 报告 → 无 SA8 施加的约束可引用。
- 可援引的上游约束来自 ADR-0024 决策 4（`docs/adr/0024-readdata-shape-budget.md`）：五键形状 `{ ok, value, schema, truncated, truncations }`；"既有「恰三键」形状锚、深等断言与 docs/integration 形状注记全线修订" → 本票（T0）是该破坏性修订的前置 reducer。
- 模块边界：`packages/namespace-runtime/AGENTS.md`（公共面暴露 detached 投影，内部 seam 不外泄）、`packages/namespace-registry/AGENTS.md`（公共 API 只经 `src/index.ts`；hostile/test 控制留在显式 testing 面）。T0 不触碰任何 src，边界天然满足。

## 4. Environment and baseline

- 工具链：node v24.13.0、pnpm 10.28.2、vitest 3.2.7、typescript 5.9.3（`pnpm install --frozen-lockfile --offline`，store v10，65 包，437ms）。
- 运行入口：`NODE_OPTIONS=--conditions=nomicore-source npx vitest run …`（`vitest.config.ts` include：`packages/*/test/**/*.test.ts`；`maxWorkers: 1`；`.test-d.ts` 走 `--typecheck` 项目）。
- **基线（pristine HEAD，SA6 产物尚未落盘时启动）**：
  - `pnpm typecheck` → **exit 0**（14 个 tsconfig，日志 `/tmp/sa6-typecheck.log`）。
  - 聚焦基线 14 文件 / **189 tests 全绿**：`runtime-readdata-hostile-path-guard`(4)、`runtime-readdata-schema-projection-red`(15)、`runtime-readdata-schema-projection-control`(6)、`runtime-public-surface-ownership`(6)、`runtime-acceptance-exports-audit`(4)、`runtime-registry-internal-seam`(5)、`registry-create`(47)、`registry-idle`(18)、`registry-open`(32)、`registry-sa7-hostile`(6)、`registry-sa7-rev1`(6)、`registry-surface`(12)、`readdata-docs-adr0016-sync-control`(21)、`readdata-docs-adr0016-sync-red`(7)。
  - 类型面（`--typecheck`）：`runtime-data-interface.test-d.ts`、`runtime-readdata-schema-red.test-d.ts`、`registry-readdata-schema-red.test-d.ts` → 3 文件 / 5 tests 绿，`Type Errors: no errors`。
  - 全量 `pnpm test`（pristine HEAD）结果见 §13（后台作业，SA6 产物落盘前启动 → 不含本票门文件）。
- 行为事实（基线不变式，见 §5）：readData 成功分支 `{ ok: true, value, schema }` 恰三键；`value` 键恒在场（缺席为显式 `undefined`）；`schema` 为 `ReadDataSchemaProjection | null`；失败分支不带 `schema` 键。

## 5. Positive reproduction

"正向故障场景"在本票里 = **结构性缺口的正向复现**：成功形状被字面写死在 N 处，T3 五键修订必须逐个改。

- 复现输入：issue #333 两个测试树（pristine 107 个 `.ts`；含 SA6 新增的扫描器 + 门共 **109 个 `.ts`**）。
- 复现命令（可执行仪器）：
  ```
  npx vitest run --no-typecheck readdata-shape-assertion-consolidation
  ```
- 复现结果（稳定、确定性）：门文件 20 用例中 **2 红 / 18 绿**；红消息逐条列出：
  - family A（恰三键深等字面量）：**24 处 / 6 文件**
  - family B（恰三键键集字面量）：**3 处 / 2 文件**
- 分布（按文件）：
  | 文件 | 处数 | 家族 |
  |---|---|---|
  | `packages/namespace-registry/test/registry-idle.test.ts` | 11 | A |
  | `packages/namespace-runtime/test/runtime-readdata-hostile-path-guard.test.ts` | 4 | A |
  | `packages/namespace-registry/test/registry-create.test.ts` | 3 | A |
  | `packages/namespace-registry/test/registry-sa7-rev1.test.ts` | 3 | A |
  | `packages/namespace-registry/test/registry-open.test.ts` | 2 | A |
  | `packages/namespace-registry/test/registry-sa7-hostile.test.ts` | 1 | A |
  | `packages/namespace-registry/test/readdata-docs-adr0016-sync-control.test.ts` | 2 | B |
  | `packages/namespace-runtime/test/runtime-readdata-schema-projection-red.test.ts` | 1 | B |
  合计 **27 处断言写死形状**。完整 file:line 清单见门失败消息，或 `scanReadDataShapeAssertions()` 输出；**文末附录**给出全部 27 处。
- 附带盘点（报告项，非门项）：**9 处非断言的形状制造点**（测试替身 `readData` 返回值 / fake Runtime），分布：`registry-create:381`、`registry-idle:242`、`registry-open:184/804/858`、`registry-sa7-concurrency:168`、`registry-sa7-hostile:166`、`registry-sa7-rev1:211`、`registry-shutdown:190`。AC1 的"或等价的集中化形状构造"允许这些一并收敛；作用域若扩大需在 SA8/设计显式确认（本契约为报告项）。
- 全仓对照（防漏）：跨全部 `packages/domains/apps` 的 `.ts` 扫描显示，成功分支恰三键断言只在上述两个包；无 3 键 `toMatchObject`；无 4/5 键成功形状字面量。

## 6. Negative control

| 负控 | 内容 | 结果 |
|---|---|---|
| N1（基线绿） | 移除一切突变后重跑 7 个含断言点的文件 | **128 tests 全绿**（§13 M0） |
| N2（作用域外不得误伤） | doc-runtime 两键成功分支 `{ok,value}`、失败分支 `{ok:false,...}`、加法兼容 `toMatchObject`、schema 投影体四键键集、hoisted 期望对象、`toEqual(<构造调用>)` | 仪器 8 个负样本全部**不命中** → 作用域收敛不越界 |
| N3（防仪器空转） | 作用域覆盖断言：扫描文件数 ≥80（实测 109）、4 个代表文件在场、两个 scope 声明同源 | 门内绿 |
| N4（防仪器漏报） | 7 个正样本：单行/多行/键序无关/`as const`/取反深等/两种 `Object.keys` 恰三键键集 | 全部命中（含 `family B` 初次实现漏报被自控捕获并修复——见 §16） |

## 7. Stability, scale and timing

- 复现率：**5/5 次**（门运行、name-filter 运行、模拟运行、两次完整复核）——输出为确定性 AST 扫描 + 确定性文件集，无时钟/并发/随机依赖。
- 规模曲线：断言点数 27（24A+3B），扫描文件 109，扫描耗时 <10ms（门用例 8ms 量级）；整门 20 tests <20ms。
- 时序条件：无。全部门用例为同步纯计算；不涉及 IO 竞态（仅读文件）。
- 边界：扫描器只读 worktree 内固定相对路径作用域；`node_modules` 被跳过；新增测试文件自动纳入（作用域随 include 语义扩张，正合 AC1 全量要求）。

## 8. Root-cause chain / capability gap

| Step | Fact | Evidence | Confidence |
|---|---|---|---|
| 1 症状 | T3 的五键修订（ADR-0024 决策 4）会击穿散布的成功形状断言，需逐处改 | ADR-0024「既有『恰三键』形状锚、深等断言…全线修订」 | 高 |
| 2 直接事实 | runtime+registry 测试树中存在 **27 处** 把恰三键形状/键集字面写死的断言 | SA6 仪器扫描（AST）+ 门红灯清单 | 高（确定性） |
| 3 触发条件 | readData 成功分支形状发生任何键集变化（加 `truncated`/`truncations`） | 突变探针 M1a/M1b：runtime 4A+1B 点变红、registry 行为锚变红；M2：19 个 registry A 点变红（同类字面量 3 点同测试体/同字面量） | 高（实测） |
| 4 最深根因 | 两个测试树**没有**共享的成功形状断言 helper / 集中化形状构造；每个测试文件各自重复字面量，测试替身类各自重造形状（7 类 stub） | 27 处断言 + 9 处生产者全部分散、无任何 import 的共享形状模块（`grep`/AST 均无） | 高 |
| 5 放大因素 | ① registry 测试大量使用 fake Runtime（`ObservableRuntime`/`makeMarkerRuntime`/`makeRuntime`），形状在替身与断言两处各写一遍 → 修改点翻倍；② 既有负控文件刻意保留"加法兼容断言"（toMatchObject），与全等断言混排，易被误改（反向风险，见 §12 C2.4） | M1 registry 全绿（替身未被生产突变影响）；M2 registry 19 点红 | 高 |
| 6 未证实假设 | ——（无；本票不主张任何行为缺陷） | — | — |
| 7 已排除 | 生产实现/公共类型问题：基线行为正确、全套绿、公共面锚绿 | §4、§6 N1 | 高 |

能力缺口（feature 式表述）：**缺少"成功形状"的单点断言/构造面**；`AC1` 要求它以 helper（或等价集中化构造）形态存在，并被 runtime 与 registry 两侧测试共同复用。

## 9. Causal experiments

> 全部实验均在工作树内进行，结束前 `git checkout --` / `cp` 恢复，`git status` 复核（§16）。

| 实验 | 变量（只改一处） | 期望 | 实测 |
|---|---|---|---|
| **M0 负控** | 无（HEAD） | 全绿 | 7 文件 / 128 tests 绿（§13） |
| **M1 生产突变** | `packages/namespace-runtime/src/runtime.ts:486` 成功分支追加 `truncated: false, truncations: []`（模拟 T3 五键形状） | 把"恰三键"写死的断言变红 | **M1a：5 tests 红**——`runtime-readdata-hostile-path-guard`（4 处 family A：L38/53/61/69）+ `runtime-readdata-schema-projection-red`（family B：L102 键集断言）；同批 registry 5 文件 **全绿** → 它们钉住的是测试替身，不是真实 runtime。**M1b：1 test 红**——`readdata-docs-adr0016-sync-control` 行为锚（family B：L143 命中；L154 同测试体在其后，未达但同源敏感） |
| **M2 替身突变** | 5 个 registry 文件的 fake `readData()` 返回值追加同两键 | 钉住替身形状的断言变红 | **19 tests 红**（registry-idle 11、registry-open 2、registry-create 2、sa7-hostile 1、sa7-rev1 3）；`registry-create:1770` 与 `1769` 同测试体同字面量，未单独触达但同源敏感 |
| **S1 收敛模拟** | 临时把 runtime 4 处改 `shapedOk(v, s)` 调用、`red:102` 改用共享常量 | 门计数下降且无新误报 | family A 24→**21**、family B 3→**2**，自控全绿；证明"helper/构造形态"过门（T0 后可归零） |
| **S2 仪器漏报注入** | 首次 family B 实现（错误的父链导航） | 自控应报错 | 自控正样本 **2 红** → 定位并修复（`expect(...).toEqual(...)` 是单 CallExpression，主语在 `expression.expression` 的实参上） |

结论链：形状一改 → 27 个断言点中 **24 个被独立实测击穿**（runtime 4A、registry 19A、runtime 1B、registry 行为锚 1B），其余 3 个点与实测点同文件同测试体/同字面量（`registry-create:1770` 与 `1769` 同体、`docs-sync:154` 与 `143` 同体），敏感性同源；而这一击穿**只在测试侧**，生产行为无缺陷。集中化的收益 = T3 只需改 helper 一处 + 各站点预期值。

## 10. Impact surface

- 直接被 T0 改动（允许）：`packages/namespace-runtime/test/**`、`packages/namespace-registry/test/**` 中的 27 处断言 + 可选 9 处形状制造点；新增 helper/fixture 模块（建议置于 `packages/namespace-runtime/test/helpers/*.ts` 或 `packages/namespace-registry/test/*-fixture.ts` 先例处；registry 侧可用既有跨包测试相对 import 先例 `../../namespace-runtime/test/durable-snapshot-wait.js`）。
- **禁止**改动：任何 `packages/*/src/**`、`domains/**`、`apps/**`、`docs/**`、公共类型/导出面、`package.json` 依赖面。
- 必须保持绿的行为面（回归契约）：§4 聚焦基线 14 文件 + registry/runtime 公共面与类型面锚 + root `typecheck`/`test`。
- 反向影响（易被 T0 误伤）：`runtime-readdata-schema-projection-control.test.ts` 的加法兼容断言（toMatchObject/分字段）是**刻意保留**的新旧形状双绿负控；`runtime-readdata-schema-projection-red.test.ts` 的 `readOk` 窄接口与分字段断言是红契约的独立证据面。T0 只允许收敛"把恰三键写死"的断言，不得把这二者改写为全等断言（否则 T3 会把负控一起击穿，反向收紧）。
- 文档面：T0 不改任何 docs/skill（ADR-0024 的文档负控正则修订属 T3）。

## 11. Ruled-out hypotheses

| 假设 | 判定 | 依据 |
|---|---|---|
| H1 存在生产行为缺陷（readData 形状错） | **排除** | 聚焦基线 189 tests 绿 + 全量基线 338 文件/3588 tests 绿（§13.1）；形状与 ADR-0016 一致；M1 只在人为突变下变红 |
| H2 registry 断言冗余（可直接删除而不损覆盖） | **排除** | M2 证明 19 处 registry 断言对替身形状敏感；删断言 = 降覆盖，违反 AC2 |
| H3 断言已经是集中的（存在 helper） | **排除** | AST 扫描：27 处均为字面量；`grep` 无共享形状模块 |
| H4 其它包也有成功形状断言（作用域应更大） | **排除** | 全仓扫描：仅 runtime/registry 两树命中；doc-runtime 为两键语义（ADR-0016 分层），不在 scope |
| H5 键集断言（family B）可留在 T0 之外 | **部分排除（范围决策，见 §12 C1b）** | M1 证明 `red:102` 与 `docs-sync:143/154` 与 family A 同属 T3 击穿半径；留散处则 T3 仍需逐处改，违背 issue "集中在一处" 之目的 |
| H6 扫描器可被文本/注释误触发 | **排除** | 仪器为 AST 级；负样本（含注释/字符串形态）不命中；正样本 7/7 命中 |

## 12. Acceptance contract and test paths

### 12.1 交付面

| 产物 | 路径 | 作用 |
|---|---|---|
| 收敛门（vitest，默认 include 发现） | `packages/namespace-runtime/test/readdata-shape-assertion-consolidation-gate.test.ts` | C1a/C1b 门 + 作用域覆盖 + 仪器正负样本自控（20 tests） |
| 扫描仪器（非测试文件，vitest 不收集） | `packages/namespace-runtime/test/helpers/readdata-shape-assertion-scan.ts` | AST 级 family A/B 检测、生产者盘点、报告格式化 |

**T0 前（当前 HEAD）预期**：门文件 **2 红 / 18 绿**（红 = family A 24、family B 3）。
**T0 后（验收态）预期**：门文件 **20/20 绿**；全部既有套件绿；`pnpm typecheck` / `pnpm test` 绿。
> 注意：T0 落地前，root `pnpm test` 会因本门这 2 条失败——这是**预期红灯**（缺口门），不是环境/入口错误；T0 完成后同一入口全绿。既有套件本身在 T0 前已全绿（§4/§13.1）。

### 12.2 契约条款

- **C1a（family A 归零）**：`packages/namespace-runtime/test/**` 与 `packages/namespace-registry/test/**` 中不存在 `toEqual/toStrictEqual/deepStrictEqual/deepEqual(<含 ok:true 与 schema 键的对象字面量>)`。当前 24 → 目标 0。
- **C1b（family B 归零）**：同一作用域内不存在 `toEqual(['ok','schema','value'])`（对 `Object.keys(...)`/`Reflect.ownKeys(...)` 主语）的恰三键键集字面量。当前 3 → 目标 0。
  *范围说明（证据见 §9 M1）*：family B 不是 AC1 字面所指的"深等断言"，但与 family A 同属 T3 五键击穿半径；本契约为"集中在一处"的目的将其纳入硬门。若 SA8/设计裁定其不属于 T0，需以显式决策放宽该条（门内为独立 `it`，改动可见、不成隐性豁免）。
- **C2.1（行为零变化）**：下述命令在 T0 前后均须绿（T0 前已实测绿）：
  ```
  NODE_OPTIONS=--conditions=nomicore-source npx vitest run --no-typecheck \
    packages/namespace-runtime/test/runtime-readdata-hostile-path-guard.test.ts \
    packages/namespace-runtime/test/runtime-readdata-schema-projection-red.test.ts \
    packages/namespace-runtime/test/runtime-readdata-schema-projection-control.test.ts \
    packages/namespace-registry/test/registry-create.test.ts \
    packages/namespace-registry/test/registry-idle.test.ts \
    packages/namespace-registry/test/registry-open.test.ts \
    packages/namespace-registry/test/registry-sa7-hostile.test.ts \
    packages/namespace-registry/test/registry-sa7-rev1.test.ts \
    packages/namespace-registry/test/readdata-docs-adr0016-sync-control.test.ts \
    packages/namespace-registry/test/readdata-docs-adr0016-sync-red.test.ts
  ```
- **C2.2（helper 判定语义，设计无关的等价性要求）**：收敛后的断言面必须与旧字面量**逐点等价且严格性不降**：
  1. `ok === true`；
  2. **恰三键**：多一键即失败（T3 五键形状必须击中，不得用 `toMatchObject`/子集匹配放过）；
  3. `value` 深等，含显式 `undefined`（键在场）用例；
  4. `schema` 深等（`null` 与四键投影体两种）；
  5. `ok:false` 结果必须失败（失败分支不得被当成功断言）。
- **C2.3（突变敏感性保持——反伪绿门）**：SA5 必须重跑 §9 的 M1（生产 readData 追加两键）与 M2（替身追加两键），确认**收敛后**仍分别在同类断言点变红。**收敛后 M1/M2 不再变红 = helper 被削弱（伪绿），验收拒绝。**
- **C2.4（反向边界）**：`runtime-readdata-schema-projection-control.test.ts` 的加法兼容断言（`toMatchObject`/分字段）**不得**被改写为全等断言；`runtime-readdata-schema-projection-red.test.ts` 的 `readOk` 窄接口与分字段断言不得降级合并。T0 只动"把恰三键写死"的断言。
- **C3a（零生产/公共类型变化）**：变更集仅落在两测试树（允许新增 test helper/fixture）。门命令（以 T0 基线 commit 为 base）：
  ```
  git diff --name-only <base>...HEAD | grep -vE '^packages/(namespace-runtime|namespace-registry)/test/'   # 必须为空
  git diff --name-only <base>...HEAD -- 'packages/*/src' 'domains' 'apps' 'docs'                            # 必须为空
  ```
  （SA6 已用等价工作树命令自证：除本票新测试产物外零越界，§13 E6）
- **C3b（公共面/类型面锚保持绿）**：`runtime-public-surface-ownership`、`runtime-acceptance-exports-audit`、`runtime-registry-internal-seam`、`registry-surface`、`runtime-data-interface.test-d.ts`、`runtime-readdata-schema-red.test-d.ts`、`registry-readdata-schema-red.test-d.ts`。
- **C3c（门禁全绿）**：`pnpm typecheck` 与 `pnpm test` 均通过（T0 后；含本门的 C1a/C1b 两条）。

### 12.3 路由与路由豁免

- 不需要 skip/only/todo/env override/fallback/吞错/软化断言；两条红判断均以"清单必须为空"表达，失败消息携带 file:line + 原文。
- 门为**结构性门**（读测试源码的 AST），并非行为验证替代品：行为面由 C2.1（真实 runtime/lease 行为断言）与 C2.3（突变探针）承担，门的自身敏感性由 7 正样本 / 8 负样本 / 2 生产者样例自控承担（防空转、防误伤）。

## 13. Red/green or baseline evidence

| 证据 | 命令 | 结果 |
|---|---|---|
| E1 基线行为绿（含公共面/文档负控） | 见 §4 聚焦清单 | 14 文件 / **189 tests 绿** |
| E2 基线类型面绿 | `npx vitest run --typecheck`（3 个 test-d 文件） | 3 文件 / 5 tests 绿，`Type Errors: no errors` |
| E3 root typecheck 绿 | `pnpm typecheck` | **exit 0** |
| E4 root test 基线绿 | `pnpm test`（pristine HEAD，SA6 产物落盘前启动） | 见 §13.1 |
| E5 门红（缺口） | `npx vitest run --no-typecheck readdata-shape-assertion-consolidation` | 20 tests：**2 红**（A=24、B=3）/ 18 绿 |
| E6 范围零越界 | 工作树变更集 vs 生产路径 | 仅 2 个 `packages/namespace-runtime/test/**` 新文件（+ 未跟踪 task brief） |
| E7 M0 负控 | 7 文件重跑 | 128 tests 绿 |
| E8 M1a 生产突变（runtime 断言面） | §9 | 5 tests 红（runtime 4A+1B）；registry 5 文件全绿 |
| E8b M1b 生产突变（registry family B） | §9 | 1 test 红（docs-sync 行为锚 L143；L154 同测试体） |
| E9 M2 替身突变 | §9 | 19 tests 红（registry 19A） |
| E10 收敛模拟（绿路径） | §9 S1 | A 24→21、B 3→2，自控全绿 |

### 13.1 全量 `pnpm test` 基线（pristine HEAD）

`pnpm test` 在 SA6 产物落盘前启动（作业 `bash-36`；因此**不含**本票门文件）：

```
Test Files  338 passed (338)
     Tests  3588 passed (3588)
  Duration  612.51s
FULLTEST_EXIT=0
```

→ T0 前套件基线 **338 文件 / 3588 tests 全绿，exit 0**；与 `pnpm typecheck` exit 0 共同构成 AC3 的"起点全绿"事实。T0 后同一入口必须仍绿（含转绿后的门文件）。

## 14. Runner trigger evidence

- `vitest.config.ts`：`test.include = ['packages/*/test/**/*.test.ts', …]` → 门文件路径匹配（已实测）。
- 实测触发（非直指文件，走配置 include + name filter；`--no-typecheck` 与 root `pnpm test` 同款 `--typecheck` 两种模式均实测）：
  ```
  npx vitest run --no-typecheck readdata-shape-assertion-consolidation
  npx vitest run --typecheck     readdata-shape-assertion-consolidation
  → RUN v3.2.7 … 收集到门文件并执行 20 tests（2 红 18 绿）
  ```
- 扫描仪器 `helpers/readdata-shape-assertion-scan.ts` 无 `.test.ts` 后缀 → 不被收集（与 `readdata-docs-adr0016-contract-fixture.ts`、`durable-snapshot-wait.ts` 先例一致）。
- 类型面门不适用（本门无 `.test-d.ts`）；root `pnpm test` 使用同一 include。

## 15. Unknowns and blockers

| 项 | 状态 / 处置 |
|---|---|
| SA8 设计产物缺失（helper 归属/命名/是否含生产者） | 不影响契约可执行性：C1a/C1b 检测的是"字面量是否还存在"，对 helper 命名/形态保持中立（构造调用、共享常量、hoisted 期望对象均过门）。设计需保证 helper 可被两测试树 import（跨包相对 import 先例已在仓内） |
| family B 是否属 T0 硬门 | 见 C1b 范围说明；SA6 判定纳入（M1 证据），如 SA8 反对需显式决策 |
| 9 处形状制造点是否收敛 | 报告项；若设计决定不收敛，门不阻塞（C1 只约束断言） |
| T3 会引入 4/5 键字面量断言 | 本门会将其判红（family A 定义含 `schema` 键、不限键数），符合"集中在一处"目的；T3 落地时应把形状逻辑放进同一 helper |
| 环境缺依赖 | 已解决（离线 store 安装成功）；无阻塞 |

**无阻塞项，verdict = approve。**

## 16. Temporary diagnostics cleanup

| 临时改动 | 用途 | 清理 | 复核 |
|---|---|---|---|
| `packages/namespace-runtime/src/runtime.ts:486` 追加 `truncated/truncations`（M1a/M1b，两次施加-还原） | 突变敏感性 | `cp /tmp/runtime.ts.bak`、`/tmp/runtime.ts.bak2` 还原 | `git diff` 空；第 486 行恢复原文（§9） |
| 5 个 registry 测试文件的替身返回值追加两键（M2） | 替身突变敏感性 | `git checkout --` 5 文件 | `git status` 无残留 |
| `runtime-readdata-hostile-path-guard.test.ts` 4 处改 `shapedOk(...)`、`runtime-readdata-schema-projection-red.test.ts:102` 改共享常量（S1） | 收敛绿路径模拟 | `cp /tmp/sim-*.bak` 还原 | `git status` 无残留 |
| 仓库内临时脚本 `dbg-tmp.ts`（多次） | 仪器调试（含 family B 父链导航修正定位） | `rm -f` | `glob`/`git status` 无该文件 |
| `/tmp` 下脚本与日志（`sa6-scan-prototype*.mjs`、`sa6-m1.log`、`sa6-m2.log`、`sa6-typecheck.log`、`sa6-fulltest.log`、`*.bak`） | 证据留档 | worktree 外，不进入提交 | — |
| 最终工作树 | — | 3 个产物（扫描器 + 门 + 本报告）+ task brief（Host-owned） | `git status --porcelain`（§13 E6） |

---

### 附：完整清单（27 处，门失败消息同源）

family A（24）：`registry-idle.test.ts` L480/505/536/616/712/765/801/908/972/1056/1095；`runtime-readdata-hostile-path-guard.test.ts` L38/53/61/69；`registry-create.test.ts` L517/1769/1770；`registry-sa7-rev1.test.ts` L547/624/687；`registry-open.test.ts` L816/880；`registry-sa7-hostile.test.ts` L423。

family B（3）：`readdata-docs-adr0016-sync-control.test.ts` L143/154；`runtime-readdata-schema-projection-red.test.ts` L102。
