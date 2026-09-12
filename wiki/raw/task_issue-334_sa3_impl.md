# SA3 Implementation Report — task_issue-334（形状预算 T1：载体投影读取三参化与截断省略）

- **Role**：mabf-sa3（implementation phase，dispatch `sa-4df35f78-dbd4-46fc-b957-8f5973ec7e32`，iteration 1；迭代 0 = `sa-dc5a62a2-0e59-49ec-a4f5-8d4f22a4f871`）
- **Issue**：welltop-jim-wang/nomicore #334（parent PR #332 / ADR-0024；tracking #331）
- **HEAD**：`ba11f328ae845bf882d131a2098a7afc8dfcc17c`（branch `mabf/issue-334`）
- **Verdict**：**实现完成（clear）** —— SA6 迭代 1 裁决（B16/R9）的唯一待办 A-1 已落地：`budgetFold` 对未集成（`doc === null`）`Y.Map`/`Y.Array` 短路为 `rawTotal := 0` 且零公共 count 读；展开侧 detached 守卫与其余实现零改动（S21/NC-8 原样绿）。18 份报告 §7 的「S19④ 与 S21/B5 互斥」矛盾已由 SA6 迭代 1 消解，本轮红灯契约转绿：`shape-budget.test.ts` 33/33、doc-runtime 27 文件/503 tests、root 341 文件/3717 tests 全绿，package/root typecheck 均 exit 0。

---

## 1. Inputs consumed

| 输入 | 路径 | 状态 |
|---|---|---|
| 任务简报 | `wiki/raw/task_issue-334.md`（What-to-build + AC1–AC5） | 已读 |
| SA1 设计 | `wiki/raw/task_issue-334_design.md`（§7.2 折叠槽位表、§7.3 B15/O-1、§8 编排、§11 ALLOW/DENY） | 已逐节落实（迭代 0），本轮仅按 SA6 裁决加 B16 例外 |
| SA2 设计评审 | `wiki/raw/task_issue-334_sa2_review.md`（approve；O-1/O-2） | 已逐条落实（§4） |
| SA6 验收契约（迭代 1，本轮直接输入） | `wiki/raw/task_issue-334_sa6_contract.md`（§0.1 裁决、§12.3 B16、§12.11 R9、§12.7 S19④/O-1、§15 A-1） | 已落实；测试文件的 S19④/O-1 断言与夹具助手由 SA6 原位修订 |
| SA8 冲突报告 / 决策摘录 | `wiki/raw/task_issue-334_conflict_report.md`、`…_relevant_decisions.md` | 冻结面逐项保持（§5） |
| 直接治理 ADR | `docs/adr/0024-readdata-shape-budget.md`（决策 1/2/3/6 + 验收节） | 已按契约口径实现 |
| SA3 迭代 0 实现报告 | `wiki/raw/task_issue-334_sa3_impl.md`（verdict reject，唯一红 = §7 S19④ 矛盾） | 本文件原位重写为当前状态 |
| Issue 评论快照 | REST 读评论成功、**零评论**（comment IDs: none） | 无 Owner 要求需应用 |
| 现行源码/测试/runner | `packages/doc-runtime/src/read.ts`、`src/index.ts`、6 个目标测试文件、`vitest.config.ts`/`tsconfig*.json` | 已亲读核对 |

## 2. Existing worktree reconciliation

- 起始工作区 = SA3 迭代 0 交付态（`git status`：`M src/index.ts`、`M src/read.ts`、`M test/public-surface-type-guard.test-d.ts` + 3 个新 `shape-budget*` 测试文件 + wiki 输入）；SA6 迭代 1 只原位修订了 `test/read-logical-value-at-path-shape-budget.test.ts` 的 S19④/O-1 断言与夹具助手（`makeDetachedFoldDoc` / `instrumentPublicCount`），**生产实现零改动**。
- 起始红灯（SA6 §13 迭代 1 复核）：`shape-budget.test.ts` = `2 failed | 31 passed (33)`，唯一红 = B16④ 两条零公共 count 读断言（当前实现折叠 detached 容器时仍读 `size`/`length`，`expected 1 to be +0`）；结果面断言（`{ys:{}}` / `{ys:[]}`、`truncated:false`、空条目）已绿。
- 本轮改动：只施加 SA6 §15 A-1（`budgetFold` detached 短路）+ 2 处已过时的红旗注释更新（`read.ts` 模块头注补 B16/R9 例外；测试文件头注由「当前红」改为落地后绿）。断言、夹具、其余生产逻辑逐字保留；无 SA4/SA7 返工输入、无 design/conflict 复审输入。

## 3. Changed paths

### 3.1 本轮（迭代 1）实际改动

| Path | Design/契约 section | Change |
|---|---|---|
| `packages/doc-runtime/src/read.ts` | §12.3 B16③④ / §12.11 R9 / §15 A-1 | `budgetFold`：`Y.Map`/`Y.Array` 在 `(v as {doc:unknown}).doc === null` 时返回 `{rawTotal: 0, empty: {}}` / `{rawTotal: 0, empty: []}`，**不执行** `size`/`length` 读（+6 行）；函数头注补 B16/R9 例外（+3 行）；模块头注补 detached 折叠例外一行（+2 行）。合计 +11 行 |
| `packages/doc-runtime/test/read-logical-value-at-path-shape-budget.test.ts` | §12.9 行 1（仅头注） | 头注「红灯现状」段原位更新为 A-1 落地后的绿状态（断言/夹具零改动；S19④/O-1 与 `makeDetachedFoldDoc`/`instrumentPublicCount` 由 SA6 迭代 1 落成） |

### 3.2 累计交付面（迭代 0 + 迭代 1；`git diff --stat` 口径）

| Path | 状态 | 累计 |
|---|---|---|
| `packages/doc-runtime/src/read.ts` | M | +423/−34（迭代 0 为 +412/−34 → 本轮 +11） |
| `packages/doc-runtime/src/index.ts` | M | +7（仅加法类型导出，无新值导出） |
| `packages/doc-runtime/test/read-logical-value-at-path-shape-budget.test.ts` | 新（untracked） | 33 tests：S1–S27（F-CANON / F-POISON / detached 折叠夹具 / S20 fixture / S24 fixture / S22 10k） |
| `packages/doc-runtime/test/read-logical-value-at-path-shape-budget-guards.test.ts` | 新（untracked） | 88 tests：§12.2 校验矩阵 + accessor 纪律 + 键空间 + V1/V2/V3/V5 + NC-4/NC-5 |
| `packages/doc-runtime/test/read-logical-value-at-path-shape-budget.test-d.ts` | 新（untracked） | 7 tests：TD1–TD6 |
| `packages/doc-runtime/test/public-surface-type-guard.test-d.ts` | M | +15（仅加法：3 个新类型名目导入锚） |

**迭代 0 的 TDD 节奏保留**：生产改动前先落 3 个测试文件与加法锚并跑红（迭代 0 §6.1）；本轮为「契约修订后的红灯 → A-1 转绿」。

## 4. SA2 Finding 落实

| Finding ID | Implementation | Result |
|---|---|---|
| O-1（detached 载体作为 P1 目标 + `depth:0` 折叠先后；建议钉死折叠先于 detached 守卫并加锚） | 折叠前置于 detached 守卫不变（`projectValue` L536-545）；SA6 B16 进一步钉死折叠为同形空容器、rawTotal 0、零 count 读。迭代 0 因契约矛盾只锚了结果面（`ok:true` + `{}`），本轮契约修订后条目与计数器断言随之全锚 | **全绿**：S19④（`{ys:{}}`/`{ys:[]}` + `truncated:false` + 空条目 + 计数器 0）、O-1（`['holder','ys'],{depth:0}` → `{}` + 空条目 + 计数器 0） |
| O-2（§8.2 的 `?? ∞` 冗余；按归一化不变式直接取 `ctx.budget.depth`） | P1 入口 `ctx.budget === null ? 0 : ctx.budget.depth`；legacy 分支不读 d/p、零 truncations 写入 | 落实，无冗余（未改动） |

**BLOCKER/MAJOR**：SA2 §13 明确「无 BLOCKER、无 MAJOR」——无未落实项。

## 5. File scope check

| Changed path | ALLOW entry（SA6 §10 / SA1 §11） | Purpose |
|---|---|---|
| `packages/doc-runtime/src/read.ts` | §10 行 1 | 全部生产落点（类型/重载/校验/预算递归）；本轮仅 `budgetFold` B16 短路 + 注释 |
| `packages/doc-runtime/src/index.ts` | §10 行 2 | 加法类型导出（T1-6；零新值导出 T1-7） |
| `packages/doc-runtime/test/read-logical-value-at-path-shape-budget.test.ts` | §10 行 3 | S1–S27 行为验收（SA6 修订 S19④/O-1；本轮仅头注） |
| `packages/doc-runtime/test/read-logical-value-at-path-shape-budget.test-d.ts` | §10 行 4 | TD1–TD6 类型验收 |
| `packages/doc-runtime/test/read-logical-value-at-path-shape-budget-guards.test.ts` | §10 行 5 | §12.2 矩阵 + V2/V3 守卫 |
| `packages/doc-runtime/test/public-surface-type-guard.test-d.ts` | §10 行 6（仅加法） | 3 个新名目导入锚 |

**越界证据（E6/E7）**：

```
$ git diff --stat
 packages/doc-runtime/src/index.ts                  |   7 +
 packages/doc-runtime/src/read.ts                   | 423 +++++++++++++++++++--
 .../test/public-surface-type-guard.test-d.ts       |  15 +
 3 files changed, 411 insertions(+), 34 deletions(-)
$ git diff --name-only | grep -E "namespace-runtime|namespace-registry|vfsl|domains/|apps/|docs/|CONTEXT\.md|vitest\.config|tsconfig|package\.json"
（空；grep exit 1）
$ ls -d packages/doc-runtime/.scratch*          # 无匹配
$ find packages/doc-runtime -name "*.js" -path "*/src/*"   # 零命中
```

- DENY 面零 diff：`namespace-runtime`（含 `runtime.ts:119` Extract / `:484` 调用）、`namespace-registry`、`vfsl*`、`docs/**`（含 ADR-0024）、`CONTEXT.md`、wire/协议、根 runner/tsconfig/package.json——零改动。
- 4 个冻结回归锚**未修改**且全绿：`read-logical-value-at-path-schema-independent.test.ts`（33）、`…test-d.ts`（4）、`read-logical-value-at-path-guards.test.ts`（39）、`public-surface-guard.test.ts`（3）。
- 公共面：`index.ts` 仅 `export type`；值导出面 guard 原样绿 → T1-7 零新值导出。

## 6. Verification

### 6.1 红灯契约转绿（E2；本轮主判据）

| Command | Result | Evidence |
|---|---|---|
| `NODE_OPTIONS=--conditions=nomicore-source npx vitest run packages/doc-runtime/test/read-logical-value-at-path-shape-budget.test.ts` | **33 passed (33)**、`Type Errors no errors` | A-1 前为 `2 failed | 31 passed`（SA6 §13 迭代 1）；A-1 后全绿，含 S19④ 零公共 count 读与 O-1 |

### 6.2 受影响 package（E2/E4/E9）

| Command | Result | Evidence |
|---|---|---|
| `NODE_OPTIONS=--conditions=nomicore-source npx vitest run packages/doc-runtime` | **27 files passed (27)、503 tests passed (503)、Type Errors no errors** | shape-budget 33、guards 88、shape-budget.test-d 7、schema-independent 33、read guards 39、public-surface-guard 3、schema-independent.test-d 4、public-surface-type-guard.test-d 3 全绿 |
| `npx tsc -p packages/doc-runtime/tsconfig.json` | **exit 0** | 3 参调用/新名目/TD 负例/夹具 instrumentation 全部按契约编译 |
| 无 options 逐字节（F1/E4） | 绿 | 4 个冻结锚未修改且全绿；S1/S23 恰两键、无 `truncated`/`truncations` |
| 负控（E3；NC-1…NC-8） | 全绿 | NC-1（F-POISON 无 options 必红）、NC-2/NC-7（S21 poison `depth:2`）、NC-3/NC-6（S1/S7/S23 两键）、NC-4（S18 + guards）、NC-5（guards 矩阵 88 tests）、**NC-8（S21 扩展：`['holder'],{depth:2}` 与 `['holderArr'],{depth:2}` 均 `PATH_NOT_ALLOWED`；B16⑤ 展开守卫原样）** |
| 零物化哨兵（AC3） | 绿 | S19①②③（poison NaN / sparse 空洞在 D=0 折叠 → `ok:true`）、S19④（detached 折叠 + 零 count 读）、S20①–④；S21 反证证明夹具非宽松 |
| 规模形状（E9，不计时） | 绿 | S22：10k `Y.Array` K=5 → `length 5` + omitted 9995；K=0 → omitted 10000；K=10001 → 全量无截断 |

### 6.3 变异敏感（E5；本轮 delta 专属 m7/m8，逐条红 → 还原绿）

| # | 变异 | 结果 | 判据 |
|---|---|---|---|
| m7 | 删除 `budgetFold` 的 `doc === null` 短路（恢复对未集成实例读公共 `size`/`length`） | shape-budget `2 failed | 31 passed (33)`；红 = S19④ 与 O-1 的计数器断言（`expected 0 to be +0`，实得 1）；**结果面断言仍绿** | 新增断言对「无效访问」敏感，非结果面重复 |
| m8 | 以内部 `_prelimContent` 计 detached rawTotal（`prelim.size` / `prelim.length`） | shape-budget `2 failed | 31 passed (33)`；红 = S19④ 与 O-1（多出 depth 条目 → `truncated` 变 true / 条目非空） | 与 §12.12 否决项一致：prelim 计数必红 |
| 还原 | `cp` 备份还原后 `sha256sum packages/doc-runtime/src/read.ts` 与变异前一致（`129273742db4…edfaa`），重跑 shape-budget → **33 passed** | 还原可信、非残留 |

（迭代 0 已完成 m1「忽略 options」→ 28 failed、m2「禁用折叠」→ 12 failed；m3–m6 留 SA4/SA7。）

### 6.4 全量门禁（E8）

| Command | Result | Evidence |
|---|---|---|
| `pnpm typecheck`（root，最终冻结态） | **exit 0** | 14 个 package tsconfig 全过；`runtime.ts:119` 的 `Extract<ReadLogicalValueResult,…>` 输入未变 → `NamespaceRuntimeReadDataResult` 零泄漏 |
| `pnpm test`（root） | **341 files passed (341)、3717 tests passed (3717)、Type Errors no errors、exit 0**（跑两次） | ① A-1 落地后首跑（16:59:21，与冻结态仅差注释）；② **最终冻结态复跑（17:10:26）同结果**——唯一历史红（S19④）已消除；`read.ts` 冻结 sha256 `3bf6b8b016e4…b312`、`shape-budget.test.ts` 冻结 sha256 `a8e8c803b040…d126` |

### 6.5 范围/清洁证据（E6/E7/E10）

| 项 | 证据 |
|---|---|
| 范围 | §5 `git diff --stat` + DENY grep 空 |
| 临时物 | 零 `.scratch*`、零 src 下 `.js`；变异备份在 worktree 外（`/tmp`），未入库 |
| 契约口径成文 | `read.ts` 模块头注 + `budgetFold` 头注明确 B16/R9（`rawTotal := 0`、零公共 count 读、d ≥ 1 展开守卫不变）；无静默偏移 |

## 7. Deferred verification（不在 SA3 职责内）

| 项 | 说明 |
|---|---|
| E5 全量变异 m3–m6 | m3（omitted 用后代数 → S24）、m4（条件在场截断通道 → S7/S15）、m5（truncated 恒 false → S2）、m6（非法 options 借路径码 → guards NC-5）留 SA4/SA7；m1/m2（迭代 0）与 m7/m8（本轮）已备证 |
| SA8 D-3 实现后冻结面逐项复查 | §5/§6 备 diff 与锚证据；正式复查归 SA8 |
| T2–T5 / N-1/N-2 / 发布 | 设计 §12 残余问题，明确非 T1 义务；`docs/adr/0008|0016` 镜像节、`CONTEXT.md` 词条、`docs/integration` 注记零接触 |
| 最终动态验收 / CI | 归 SA4/SA7/Controller |

## 8. Deviations or blockers

- **无阻塞、无 reject 项**。唯一实现 delta 即 SA6 §15 A-1（`budgetFold` 2 行短路 + 注释），结果面与展开侧守卫逐字未变（S21/NC-8 绿）。
- 细节澄清（非偏移）：B16④ 的「零公共 count 读」通过 `(v as {doc:unknown}).doc === null` 判别；`.doc` 为 yjs 既有 O(1) 属性读，实证不触发 `Invalid access` 警告（`node` 探针：detached `doc===null` true、`warns:0`）。
- 迭代 0 报告 §7 所列三选项（a/a′/b）已由 SA6 裁决为 B16/R9（等价 a′ 机制 + a 结果面）；选项 b（折叠前先走 detached 守卫）已被 §12.12 否决，未实施。

## 9. Suggested commit message（仅供 Controller 选择；SA3 不执行 commit）

```
feat(doc-runtime): readLogicalValueAtPath 三参化——形状预算与截断清单（#334 / ADR-0024 T1）

- 公共面加法：readLogicalValueAtPath(doc, path, options?) 双结果类型 + 重载
  （ReadLogicalValueResult 逐字不动；新 ReadLogicalValueAtPathOptions /
  ReadLogicalValueTruncationEntry / ReadLogicalValueAtPathBudgetResult）
- 预算贯通既有双递归（projectValue/projectYMap/projectYArray/copyPlainStrict）：
  depth:0 同形空容器骨架 + depth/width 键省略 + 截断清单恒在场（omitted = raw 直接子项数）
- 零物化边界：折叠/裁减在槽位枚举层，超出前缀零 get/零递归（poison/sparse 哨兵）
- detached 容器（doc === null）d===0 折叠按 B16/R9：rawTotal := 0、零公共 count 读、
  无 depth 条目、truncated:false；d ≥ 1 展开/保留物化仍走现行 PATH_NOT_ALLOWED 守卫
- 非法 options 新失败分支 READ_OPTIONS_INVALID：G0 → 校验 → N0 定序，零 doc 触碰、零外抛
- index.ts 仅加类型导出；无 options 路径逐字节不变（4 个冻结锚未改动且全绿）
```

—— 报告结束 ——
