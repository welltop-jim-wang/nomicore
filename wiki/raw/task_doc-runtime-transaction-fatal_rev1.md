# 修订轮简报 Rev1 — doc-runtime committed-aware transaction fatal（issue #87 / PR #96）

- run_id: issue-87-1787469258-378585
- branch: fix/issue-87-on-docs-namespace-runtime
- 触发：runner 转达 owner 对 PR #96 的 Review（Request changes）
- 类型自判：发布后修订 —— 公共 API 面收缩（owner 已给出明确修改方案 = 设计定稿），
  按 SKILL §发布后修订轮 裁剪流水线：SA6（红灯锚定）→ SA3（实现）→ SA4（静态验尸）→ SA7（动态验证）→ commit+push。
  SA5 无缺陷需复现（非 bug）；SA1/SA2 设计空间已由 owner 修改要求锁死；SA8 前置门禁研判：
  本修订是**收缩**公共面至 ADR-0008 实际授权范围（owner 裁定 ADR-0008 未授权发布 set-only 公共 mutation API），
  与 ADR 一致、无冲突可能，按裁剪原则不派 SA8（依据记录于此）。

## Owner 反馈全文（PR #96 Review，Request changes）

### P1 / Major：公开 set-only `applyValidatedMutation`，违反 #76 四操作公共契约

PR #96 当前从 `@nomicore/doc-runtime` 公共入口导出了：

```ts
applyValidatedMutation(derived, doc, mutation)
```

但实现只接受 `op === 'set'`，对以下已冻结操作返回“本切片未支持”：

- `delete`
- `array-insert`
- `array-delete`

这与 Issue #76 的明确契约冲突：

> 实现同步 `applyValidatedMutation(derived, doc, mutation)`，统一承载 set、delete、array-insert、array-delete。

同时，Issue #87 明确 `Blocked by: #76`，其验收目标是 committed-aware transaction fatal contract；ADR 0008 的本项前置演进也只要求 transaction helper 提供 committed-aware branded fatal，并未授权以正式公共名称发布能力不完整的 mutation API。

当前形态会让下游成功编译并调用一个看似完整的公共入口，却在三种正式操作上遭遇运行时拒绝，形成半成品公共契约。

### 修改要求（优先方案，owner 明确推荐）

1. 从 PR #96 的公共 package export 中移除 `applyValidatedMutation`、`MutationIssue` 和 `ApplyValidatedMutationResult`；
2. 不以正式公共 API 交付 set-only 实现；若 fatal 契约测试需要 mutation transaction seam，可保留为包内测试/内部 seam，或直接通过 `materializeRoot` 与 `transactGuarded` 验收；
3. `DocRuntimeFatalError`、稳定 phase、committed 分类、原始 cause 保留及 materializeRoot fatal 改造继续作为本 PR 的交付范围；
4. 等 Issue #76 完整实现 set/delete/array-insert/array-delete 及其全部 AC 后，再一次性公开 `applyValidatedMutation`。

（备选方案"本 PR 直接完整兑现 #76"被 owner 明确不推荐，不采用。）

### 回归要求（owner 明文）

- package 公共入口不存在 set-only 半成品 `applyValidatedMutation`；
- fatal contract 仍覆盖 pre-commit internal、observer cleanup throw、post-commit verification 和未知异常保守分类；
- 普通领域失败继续留在结果联合；
- 全量 typecheck/test 与 Node 20/24 CI 通过。

## 总控研判

- 反馈为**真问题**：`packages/doc-runtime/src/index.ts` 第 15-16 行确实公开导出
  `applyValidatedMutation` + `MutationIssue` + `ApplyValidatedMutationResult`，实现仅支持 set。
- 采用 owner 优先方案：公共入口移除三名目；fatal 契约测试改为经**包内内部 seam**
  （测试直接 import 包内 `../src/mutation.js`，不经公共 index）保留全部 fatal 覆盖；
  不改 mutation.ts 实现本体（set-only 实现降级为包内内部模块，待 #76 完整化后再公开）。
- 无仓内其他包经公共入口引用该 API（已 grep 核实），影响面闭合于 doc-runtime。
- ADR-0007 文本提及 `applyValidatedMutation` 属 #76 完整交付时的终态描述，本次临时下公共面
  不改变 ADR 意图；owner review 本身即为裁决。

## 本轮验收标准（修订 AC）

| # | 条目 | 来源 |
|---|---|---|
| R1 | `@nomicore/doc-runtime` 公共入口不再导出 `applyValidatedMutation` / `MutationIssue` / `ApplyValidatedMutationResult`（有 guard 测试锚定） | owner 修改要求 1 |
| R2 | fatal 契约四类场景（pre-commit internal / observer cleanup throw / post-commit verification / 未知异常保守分类）测试覆盖不丢，经内部 seam 或 materializeRoot/transactGuarded 保持 | owner 回归要求 2 |
| R3 | 普通领域失败（logical/path/materialization/mutation）继续留在结果联合，不进 fatal 通道 | owner 回归要求 3 |
| R4 | `DocRuntimeFatalError`、稳定 phase、committed 分类、原始 cause 保留、materializeRoot fatal 改造交付范围不变 | owner 修改要求 3 |
| R5 | 全量 typecheck + test 绿（CI Node 20/24 腿由 runner 跟踪） | owner 回归要求 4 |
| R6 | doc-runtime patch 版本 bump（硬门禁 #9） | MABF 立法 |

---

## SA6 红灯锚定记录（red-light anchor，本轮新增）

### 测试文件（新增，均位于 `packages/doc-runtime/test/`）

| 文件 | 通道 | 角色 |
|---|---|---|
| `public-surface-guard.test.ts` | vitest 运行时（`npx vitest run`） | 值导出面：公共入口命名空间探测 |
| `public-surface-type-guard.test-d.ts` | vitest typecheck（`.test-d.ts`，`vitest run --typecheck`） | 类型名目面：`@ts-expect-error` 自我反转锚定 |

两个文件均只从公共入口 `packages/doc-runtime/src/index.ts`（包名 `@nomicore/doc-runtime` `"."` 导出指向的入口模块，`import * as / import type ... from '../src/index.js'`）导入；无任何源码 grep/字符串形状断言（全部为模块导出观测 + tsc 诊断）。

### 断言清单

**`public-surface-guard.test.ts`（运行时值面，3 用例）**
1. 公共入口不存在 set-only 半成品值导出 `applyValidatedMutation`：
   `expect(Object.prototype.hasOwnProperty.call(ns,'applyValidatedMutation')).toBe(false)` + `expect(ns.applyValidatedMutation).toBeUndefined()`；
2. owner 要求继续交付的五项值导出仍在位（`typeof === 'function'`）：`materializeRoot`、`DocRuntimeFatalError`、`extractYjsSnapshot`、`readLogicalValueAtPath`、`replaceRootContent`；
3. 公共入口不泄露任何 mutation 管线值导出：`Object.keys(ns)` 中不允许出现 `applyValidatedMutation`（防换名改头换面导出 set-only 形态）。

**`public-surface-type-guard.test-d.ts`（类型面，1 用例 + 2 负例锚）**
- 负例：`// @ts-expect-error` + `import type { MutationIssue }`、`import type { ApplyValidatedMutationResult }`——公共入口不得再可导入这两名目；被移除名目在文件其他位置零引用（避免修绿后残留未抑制 TS2304 噪声）；
- 正例：无指令 `import type` 八个保留名目（`ExtractIssue`/`ExtractResult`/`ReadLogicalValueResult`/`MaterializeIssue`/`MaterializeResult`/`DocRuntimeFatalPhase`/`ReplaceIssue`/`ReplaceResult`）——任一被误删 → TS2305 → 红；并以 `expectTypeOf` 基本投影验证导入有效。

### 类型名目锚定机制说明（在当前 vitest --typecheck 配置下红/绿翻转，已实测双向）

- 机制：`vitest.config.ts` 启用 `typecheck.enabled`，`typecheck.include` 覆盖各包 test 目录下 `.test-d.ts` 后缀文件，`tsconfig` 指向 `tsconfig.typecheck.json`；`@ts-expect-error` 指令在 tsc 诊断层面自反转——**指令未被消费（下一行无错误）→ TS2578 "Unused '@ts-expect-error' directive" → 红；指令被消费（下一行 TS2305 被抑制）→ 绿**。
- 实测双向（均未触碰 src/index.ts）：
  - 红向（当前基线，导出仍在）：`vitest run --typecheck` 报 2 条 `TypeCheckError: Unused '@ts-expect-error' directive`（第 37/39 行）→ 红；
  - 绿向（对称机制验证）：临时探针 `.test-d.ts` 对**不存在的成员**加同一指令 → `✓ TS ... (1 test)` 通过 → 证明 SA3 移除三名目导出后，本文件指令被 TS2305 消费 → 绿。
- 补充说明：`packages/doc-runtime/tsconfig.json`（`pnpm typecheck` 通道）对同一文件同样以 tsc 诊断驱动（导出在位 → TS2578 红；移除后 → 绿），双通道行为一致。

### 红灯证据（`npx vitest run --typecheck doc-runtime`，root vitest.config.ts，即 CI `pnpm test` 同通道）

```
 Test Files  2 failed | 19 passed (21)
      Tests  2 failed | 260 passed (262)
 Type Errors  no errors
```
- `public-surface-guard.test.ts`：`×` 用例 1（`expected true to be false`——`applyValidatedMutation` 存在于命名空间）、`×` 用例 3（`expected [ 'applyValidatedMutation' ] to deeply equal []`）；用例 2（五项保留名目在位）绿——现状与 owner 描述一致；
- `public-surface-type-guard.test-d.ts`：`FAIL ... TypeCheckError: Unused '@ts-expect-error' directive.`（第 37/39 行两条）；
- 其余 19 个既有测试文件全部通过（260 tests passed），确认新增红灯仅来自本守卫，基线无其他波动。

### SA3 修绿路径提示（不动本测试，仅记录）

1. 从 `src/index.ts` 删除第 15-16 行三名目导出 → 两个守卫文件转绿；
2. 既有 fatal 契约测试（`apply-validated-mutation-fatal-contract.test.ts`、`apply-validated-mutation-nested-path-repro.test.ts` 等 21 处 `from '../src/index.js'` 中的相关导入）需按修订计划改走包内内部 seam（`../src/mutation.js`），否则移除公共导出后这些既有测试会因 import 失败转红——属 AC R2 交付范围，须随本轮一并落地。

---

## SA3 实现记录（rev1 修订轮）

### 改动清单

1. **`packages/doc-runtime/src/index.ts`**：删除第 15-16 行三名目公共导出（`export { applyValidatedMutation }` / `export type { MutationIssue, ApplyValidatedMutationResult }`）；文件头注释补充「validated-mutation entry（set-only; awaits issue #76）stay package-internal」，与收缩后公共面一致。`src/mutation.ts` 实现本体零改动（降级为包内内部模块）。
2. **`packages/doc-runtime/package.json`**：patch 版本 bump `0.1.6 → 0.1.7`（硬门禁 #9 / AC R6）。
3. 未触碰任何其他 src 文件；无仓内其他包经公共入口引用该 API（已 grep 核实，影响面闭合于 doc-runtime）。

### 测试迁移清单（既有测试改走包内内部 seam `../src/mutation.js`；守卫 2 文件零改动）

| 文件 | 改动 |
|---|---|
| `test/apply-validated-mutation-nested-path-repro.test.ts` | 第 26 行拆分：`materializeRoot` 保留 `../src/index.js`，`applyValidatedMutation` 改 `../src/mutation.js`（+ 注释） |
| `test/sa7-fatal-dynamic-verify.test.ts` | 第 36-41 行拆分：`applyValidatedMutation` 改 `../src/mutation.js`；`DocRuntimeFatalError`/`materializeRoot`/`readLogicalValueAtPath` 保留公共入口 |
| `test/apply-validated-mutation-fatal-contract.test.ts` | `beforeAll` 动态 import 拆双源：seam `../src/mutation.js` 取 `applyValidatedMutation`、公共入口取 `DocRuntimeFatalError`；文件头 "指示灯现状"/describe 标题/用例注释同步为 seam 载体描述。**断言零弱化**：fatal 四覆盖（pre-commit internal=seam 载体面、observer cleanup throw、post-commit verification、未知异常保守分类 E205 领域联合）与领域失败留结果联合（ok:false + issues + 零写入）全部原样保留 |

fatal 契约覆盖矩阵（rev1 AC R2/R3 逐条对位）：`apply-validated-mutation-fatal-contract.test.ts` 4 用例（committed:true / exact identity / 领域失败不 fatal 化）＋ `sa7-fatal-dynamic-verify.test.ts` 8 用例（伪造 branded 三投递路径 / (F)(G) 双读窗口 / P-5 E202 三窗口）＋ `apply-validated-mutation-nested-path-repro.test.ts` 2 用例（嵌套路径契约）全部经 seam 或公共入口按原语义运行。

### 验证输出摘要（均在仓 root，即 CI `pnpm test` 同通道）

1. `npx vitest run --typecheck`：**Test Files 72 passed (72) / Tests 974 passed (974) / Type Errors no errors**（exit 0）。含两个守卫文件转绿：`public-surface-guard.test.ts`（3 tests）、`public-surface-type-guard.test-d.ts`（1 test，`@ts-expect-error` 被 TS2305 消费）；既有 19 个 doc-runtime 测试文件全部通过（SA6 红灯基线 21 文件 262 用例 → 现 21 文件全绿，无回归）。
2. 守卫专项单独复跑：`npx vitest run --typecheck packages/doc-runtime/test/public-surface-guard.test.ts packages/doc-runtime/test/public-surface-type-guard.test-d.ts` → 2 files / 4 tests passed / Type Errors no errors（exit 0）。
3. `pnpm typecheck`（root workspace 六包）→ exit 0。
4. 本轮按要求**未 commit**（等 SA4/SA7 双清后由总控续传 commit+push）。
