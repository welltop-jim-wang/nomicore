# SA7 动态验证报告 — 验证型交付（Issue #9）

**Date**: 2026-08-19
**验证对象**: SA3 交付 commit `22b6fcd`（交付物① `packages/vfsl/test/parse-vfsl-cycle-detection.test.ts` 16 条 AC 回归锁 + 交付物② HG9 bump `0.1.2 → 0.1.3`，产品 src 零 diff）；验证时基线 HEAD = `69216b6`（SA4 报告 commit，交付 commit 之上零代码增量）
**执行规程**: SA1 设计 §6（动态验证协议）§6.1/§6.2/§6.3 + 简报指定执行内容；SA7 SKILL（setsid 独立后台进程 / 端口无占用面 / HG12 观测如实）
**日志留存**: `/tmp/sa7-regression.log`、`/tmp/sa7-mu-<代号>-single.log`、`/tmp/sa7-mu-<代号>-full.log`、`/tmp/sa7-final-regression.log`（全息可复核）

> **取证方式**：7 条 MU 注入点行号先实码核对（本人 `sed -n` 逐行读码，与设计 §6.2 / SA4 §三.5 逐点相符后方注入）；每条注入原子化：净态检查 → 注入（git diff 摘录为证）→ 单文件跑 → `timeout 300` 全量跑（记墙钟）→ `git checkout -- packages/vfsl/src/` 还原 → `git diff --name-only` 清零自证，并以 trap EXIT 兜底还原。全部测试命令起独立后台进程（本任务为纯进程内 parser，无服务/端口占用面，无 fuser 清场需求）。

---

## Step 0 — SA4 静态验尸结果校对

- SA4 最终结论: **pass**（`task_vfsl-parser-cycle-detection_sa4_review.md` 末行，2026-08-19，含「动态审核重点」五条移交清单）
- 操作: **进入动态验证**。SA4 移交清单逐项承接——①§6.2 七条 MU 逐条实跑（本报告 §二）②墙钟政策 `timeout 300`（§二每条记墙钟）③清零门禁（§二逐条 + §三终局）④HG14 vitest 触发证据段落含 16 条计数（§四）⑤fixture 同一性未复算（SA4 已按求值层方法三方复核一致，SA7 动态层以 fixture 用例实跑绿承载，不重复静态比对）

## Step 1 — SA6 验收测试状态

SA6 验收测试文件即交付物① 本身（验证型交付：四条 AC 已由 #6/#7 交付实现满足，红灯阶段结构性不存在——设计 §1.2 已立法替代证据标准）。§6.1 全量实跑中该文件 **16/16 绿**（含新#15/新#16）；替代红灯证据 = 本报告 §二 mutation 矩阵（7 条注入全部按预登记观测爆红，证断言活性）。

---

## 一、§6.1 标准回归（交付态，独立后台进程）

| 跑次 | typecheck | 全量 test | 墙钟 | 输出摘录 |
|---|---|---|---|---|
| 交付态首跑 | **EXIT=0** | **EXIT=0** | 5s（含 typecheck） | `Test Files  7 passed (7)` ｜ `Tests  101 passed (101)` |
| 矩阵终了复跑（硬门禁 4） | **EXIT=0** | **EXIT=0** | 5s（含 typecheck） | `Test Files  7 passed (7)` ｜ `Tests  101 passed (101)` |

两跑均 7 文件 101/101 全绿、无 skip，与设计 §6.1 期望（101/101 + EXIT=0）**一致**；矩阵 7 条注入还原后的复跑全绿同时证实 mutation 实验零残留污染（D2/D4 双证）。

---

## 二、§6.2 mutation 核验矩阵（7 条全部实跑）

### 总表

| 代号 | 注入点（实跑 diff 验证） | 单文件（新 16 条） | 全量 `timeout 300 pnpm test` | 墙钟 | 与 §4/§6.2 期望比对 | 还原清零 |
|---|---|---|---|---|---|---|
| MU-1 | `semantic.ts:164` push 整行注释 | **9 红/7 绿**（EXIT=1） | **16 红/85 绿**（EXIT=1） | 3s | ✅ 新文件恰 9 红（AC1×3+AC2×6）；全量红名单较预登记宽出 sa7s×2（同 E106 族，见下） | ✅ `POST_RESTORE_DIFF=''` |
| MU-2 | `:163` path 构造改 `'循环引用'` | **6 红/10 绿**（EXIT=1） | **6 红/95 绿**（EXIT=1） | 3s | ✅ 逐项一致（AC2×6 红、AC1×3 绿、基线 0 红） | ✅ |
| MU-3 | `:164` `ref.pos`→`root.namePos`（×2 处） | **9 红/7 绿**（EXIT=1） | **17 红/84 绿**（EXIT=1） | 3s | ✅ 9 例 `expectIssueAt` 全红；全量较预登记宽（位置锚定族，见下） | ✅ |
| MU-5 | `:160` `gray.has(ref.name) ‖ black.has(ref.name)`（**修订配方，非 :166**） | **7 红/9 绿**（EXIT=1） | **14 红/87 绿**（EXIT=1） | 3s | ✅ 与 SA2 R1 实测**逐条吻合**（含 AC4#3；无挂起） | ✅ |
| MU-7 | `:54` `walk(t.key, visit);` 整行删除 | **1 红/15 绿**（EXIT=1） | **1 红/100 绿**（EXIT=1） | 3s | ✅ 单红 = 新#15，精确命中 | ✅ |
| MU-11 | `tokenizer.ts:176` body 切片加 `.trim()` | **1 红/15 绿**（EXIT=1） | **5 红/96 绿**（EXIT=1） | 3s | ✅ AC3#3 红 + jd 逐字×4 红 | ✅ |
| MU-19 | `:183` 比较器 y-x 全反转 | **16 全绿**（**EXIT=0**） | **7 红/94 绿**（EXIT=1） | 4s | ✅ 双跑法差异逐项一致（联合锚定关键证据） | ✅ |

**墙钟政策执行**：7 条全量跑墙钟 3~4s（`timeout 300` 外层，GNU coreutils 9.4），**零「FAIL-挂起」**（无 EXIT=124）；MU-5 修正配方「机制上不再黑节点重遍历」获动态证实（对照原 :166 配方 180s+ 挂起被杀的在册教训）。

**清零门禁执行**：每条注入前净态检查（`git diff --name-only -- packages/vfsl/src/` 为空方注入）、还原后同命令输出为空方入下一条（`POST_RESTORE_DIFF=''` ×7）；终局门禁见 §三。

### 逐条证据

#### MU-1 — E106 候选入池删除

- 注入 diff：`-        candidates.push(candidate(makeIssue(ErrCode.E106, `循环引用: ${path}`, ref.pos.line, ref.pos.column), ErrCode.E106));` → `+        // [SA7-MU1] E106 push removed`（恰 :164 单行）
- 单文件：`Tests  9 failed | 7 passed (16)`——红 = AC1×3（容器包裹 / 多行 / 标记实参）+ AC2×6（标记传递 / 三节点 / 纯别名链 / Record 值位 / **新#15** / **新#16**）。与 §6.2 期望「新 16 条中 9 红（AC1×3 + AC2×6，含新#15/#16）」**一致**
- 全量：`Test Files  4 failed | 3 passed (7)`、`Tests  16 failed | 85 passed (101)`——红名单 = 新 9 + errors（E106 自引用 / E106 互引用）×2 + r3（R-2 自环版 / 互环版 / 单声明对照）×3 + sa7s（T-R4-1 / T-R4-2）×2
- **差异如实登记（HG12）**：§6.2 预登记文字为「errors/r3 E106 族红」，实跑另含 sa7s×2（T-R4-1/T-R4-2 为容器介导环的 E106 身份断言，同属 E106 族）——预登记 narrower，实跑为准；红名单放大方向与突变语义一致（E106 候选全消失，所有 E106 锚定用例必红），无矛盾

#### MU-2 — 环路径消息丢弃

- 注入 diff：`-        const path = [...stack.slice(startIdx).map((f) => f.name), ref.name].join(' → ');` → `+        const path = "循环引用";`（恰 :163 单行）
- 单文件：`Tests  6 failed | 10 passed (16)`——红恰 = AC2×6（标记传递 / 三节点 / 纯别名链 / Record 值位 / **新#15 `A → A`** / **新#16 `A → B → A`**，全部 `toContain` 失败）；AC1×3 绿（只锚码+位，预期内不红，如实登记）
- 全量：`Test Files  1 failed | 6 passed (7)`、`Tests  6 failed | 95 passed (101)`——红全部在新文件，**基线 0 红**（前序无消息路径断言，预登记「不红」证实）
- 与 §6.2 期望逐项**一致**；「原 §5 R1 残余已由新#15 关闭」获直接实证（自环路径消息 `A → A` 现可红）

#### MU-3 — 锚点漂移（`ref.pos` → `root.namePos`）

- 注入 diff：`:164` 行内 `ref.pos.line, ref.pos.column` → `root.namePos.line, root.namePos.column`（×2 处，恰 :164 单行；修订定稿配方，编译运行均通过——原 `a.namePos` 出作用域的编译错判定在册）
- 单文件：`Tests  9 failed | 7 passed (16)`——**9 例 `expectIssueAt` 全红**（AC1×3 + AC2×6 含新#15/#16），锚漂至 root 声明名位，与 §2.4 P13 探针预验（漂 (1,6)）相符
- 全量：`Tests  17 failed | 84 passed (101)`——红名单 = 新 9 + errors×2 + r3×3 + sa7s×3（T-R3-2 / T-R4-1 / T-R4-2）
- **差异如实登记（HG12）**：§4 M3 预登记基线红仅「errors×2」，实跑另含 r3×3 + sa7s×3（皆为位置锚定用例，E106 锚漂后必红，同族放大）——实跑为准，方向与突变语义一致

#### MU-5 — DAG 误报（gray ∪ black 皆判环）· 修订配方关键验证

- 注入 diff：`-      if (gray.has(ref.name)) {` → `+      if (gray.has(ref.name) || black.has(ref.name)) {`（恰 **:160** 单条件改写；**:166 作废配方未使用**）
- 单文件：`Tests  7 failed | 9 passed (16)`——红恰 = **AC3×4**（fixture ok:true×4 全线失败）+ **AC4×3**（往返 / 确定性 / 全 kind 合成文本，#3 的 `Root→Nested` 黑共享引用误报）；绿恰 = AC1×3 + AC2×6（含新#15/#16，真环经灰命中输出不变）。与 §6.2 期望「新文件 7 红/9 绿」**逐项一致**
- 全量：`Test Files  4 failed | 3 passed (7)`、`Tests  14 failed | 87 passed (101)`——红名单 = 新 7 + **cm×5**（E306 沿别名链 / E307 间接纯值 / 变体拼写§6 / Record 键 Pattern 区分 / spec §10 fixture 端到端）+ **sa7s T-l**（20k 链误报）+ **e2e 迷你 fixture×1**，与 SA2 R1 实测「全量恰 14 红」**逐条吻合**
- 墙钟 3s **无挂起**——修正配方「不再黑节点重入再遍历」的动态证实（原 :166 配方 O(n²) 重遍历 180s+ 挂起教训在册，本次未复现）
- fixture 双重身份（正例 + A16 DAG 不误报锚）获实证：Audit 黑节点共享引用被误判 E106 → `ok:false` → AC3/AC4 七连红

#### MU-7 — walk `record.key` 边源删除（单红预言）

- 注入 diff：`-      walk(t.key, visit);`（恰 :54 整行删除，无其他行触碰）
- 单文件：`Tests  1 failed | 15 passed (16)`——**唯一红灯 = 新#15**（`type A = Record<A, string>;` 输入 `ok:true` 静默放行 → `expectSingleIssue` 抛出，「环拒绝行为静默丢失」失效模式与 §2.4 P10 探针证实一致）；其余 15 绿
- 全量：`Test Files  1 failed | 6 passed (7)`、`Tests  1 failed | 100 passed (101)`——**基线 0 红**（85 基线无 Record 键位负例，§6.2 预判「基线不红」证实，无差异需登记）
- 单红精确命中：修订 1 新增用例的边源锚定价值（覆盖 §5 R2 关闭主张）获动态实证

#### MU-11 — JSDoc 非逐字（body 加 `.trim()`）

- 注入 diff：`-          pending.push({ body: text.slice(open + 3, close), line: startLine, column: startCol });` → `+          pending.push({ body: text.slice(open + 3, close).trim(), line: startLine, column: startCol });`（恰 tokenizer.ts:176）
- 单文件：`Tests  1 failed | 15 passed (16)`——红恰 = **AC3#3**（七常量含首尾空格的逐字 `toEqual`，P5/P12 预验的观测复现）
- 全量：`Test Files  2 failed | 5 passed (7)`、`Tests  5 failed | 96 passed (101)`——红 = 新 1 + **jd×4**（属性位 notes / 忽略型注释间隔 / 标记类型位 / 连续两条逐字含换行@tag）。「全量 jd 基线逐字用例红」证实（jd 7 条中恰 4 条逐字锚定用例红，其余 3 条不涉首尾空格不红，方向一致）
- 与 §6.2 期望**一致**

#### MU-19 — min-position 聚合反转（联合锚定 · 双跑法关键证据点）

- 注入 diff：`:183` `-    (x, y) => x.issue.line - y.issue.line || x.issue.column - y.issue.column || x.code - y.code,` → `+    (x, y) => y.issue.line - x.issue.line || y.issue.column - x.issue.column || y.code - x.code,`（比较器 y-x 全反转）
- **单跑新文件**：`Test Files  1 passed (1)`、`Tests  16 passed (16)`，**EXIT=0 全绿**——AC1/AC2 各输入均恰 1 条回边、无竞争，§2.4 P15 预言证实
- **全量**：`Test Files  2 failed | 5 passed (7)`、`Tests  7 failed | 94 passed (101)`——红恰 = **r3×2**（R-2 自环版 / 互环版，重复声明并集回边多候选）+ **sa7s×5**（T-R2-4 / T-R2-5 / T-R3-2 / T-R4-1 / T-R4-2），与 SA2 R1 实测清单**逐条吻合**（五用例代号一字不差）
- **双跑法差异成立**：单跑会伪报「无红」，全量抓住 7 红——「每注入必跑全量」（§6.2 硬门禁 2）与 M19「联合锚定」结论的动态实证，本矩阵关键证据点达成

### 矩阵小结

七条注入的观测与设计 §4/§6.2（修订 1 后）期望**全部一致**：单文件红/绿计数 7/7 精确命中（9/6/9/7/1/1/16绿 + 全量 16/6/17/14/1/5/7）；两处全量红名单较预登记文字放大（MU-1 +sa7s×2、MU-3 +r3×3+sa7s×3），均为同族（E106 / 位置锚定）放大、方向与突变语义一致，按 §6.2 硬门禁 5「以 SA7 实测为准」如实登记，不构成矛盾。MU-2 的「预期内不红」（AC1×3）与 MU-7 的「预期单红」均照实记录。**零 FAIL-挂起。**

---

## 三、终局门禁（D4 / 硬门禁 3·4）

| 门禁 | 证据 | 结果 |
|---|---|---|
| 逐注入清零（×7） | 每条还原后 `git diff --name-only -- packages/vfsl/src/` 输出为空（`POST_RESTORE_DIFF=''`） | ✅ |
| `git status --short -- packages/vfsl/src/` | 输出为空 | ✅ 零残留 |
| **最终 `git diff -- packages/vfsl/src/`（D4）** | 输出为空 | ✅ **产品 src 零改动保持** |
| HEAD 未漂移 | `69216b6`（验证全程无 commit） | ✅ |
| 矩阵终了标准回归复跑 | typecheck EXIT=0 + `Test Files 7 passed (7)` / `Tests 101 passed (101)` EXIT=0 | ✅ |

工作区仅存两个未跟踪项 `.mabf-bg/`、`TASK.md`（SA4 N-1 已注记的既有项，非 SA7 产物，不在交付 diff 内，保持未跟踪原样，提请总控按 N-1 处置）。

---

## vitest 触发证据

> HG14（简报红线 4 / 设计 §6.3）：本任务设计含 `*.test.ts` 交付（`parse-vfsl-cycle-detection.test.ts` 新增 16 条），SA7 report 须含本段落——实际运行输出证文件被 vitest 收集执行、**16 条计数可见**。

**运行**: 本地实跑 `pnpm test`（= `vitest run`，v3.2.7，交付态首跑 + 矩阵终了复跑两次同结果；SA7 阶段无 CI run——发布/CI 由外部 check.sh 承担（简报红线 1），CI 侧触发证据由 check.sh 推送后的 PR run 接续，非本报告缺口）

**Test Files 行摘录（终了复跑原文）**：

```
 Test Files  7 passed (7)
      Tests  101 passed (101)
```

**全部 7 个测试文件逐文件证据（同跑原文摘录）**——workspace package 唯一为 `@nomicore/vfsl`（`packages/vfsl`，根 `vitest.config.ts` include glob `packages/*/test/**/*.test.ts` 收集，SA4 §二.5 已静态确认触发链，本表为动态侧证据）：

| # | 测试文件（均属 `@nomicore/vfsl`） | 触发结果 | 运行输出摘录 |
|---|---|---|---|
| 1 | `packages/vfsl/test/parse-vfsl-sa7-supplementary.test.ts` | ✓ 触发且通过（8） | ` ✓ packages/vfsl/test/parse-vfsl-sa7-supplementary.test.ts (8 tests)` |
| 2 | `packages/vfsl/test/parse-vfsl-r3-regression.test.ts` | ✓ 触发且通过（7） | ` ✓ packages/vfsl/test/parse-vfsl-r3-regression.test.ts (7 tests)` |
| 3 | `packages/vfsl/test/parse-vfsl-containers-markers.test.ts` | ✓ 触发且通过（33） | ` ✓ packages/vfsl/test/parse-vfsl-containers-markers.test.ts (33 tests)` |
| 4 | `packages/vfsl/test/parse-vfsl-errors.test.ts` | ✓ 触发且通过（19） | ` ✓ packages/vfsl/test/parse-vfsl-errors.test.ts (19 tests)` |
| 5 | **`packages/vfsl/test/parse-vfsl-cycle-detection.test.ts`（本任务交付物①）** | ✓ 触发且通过（**16**） | ` ✓ packages/vfsl/test/parse-vfsl-cycle-detection.test.ts (16 tests)` |
| 6 | `packages/vfsl/test/parse-vfsl.test.ts` | ✓ 触发且通过（11） | ` ✓ packages/vfsl/test/parse-vfsl.test.ts (11 tests)` |
| 7 | `packages/vfsl/test/parse-vfsl-jsdoc.test.ts` | ✓ 触发且通过（7） | ` ✓ packages/vfsl/test/parse-vfsl-jsdoc.test.ts (7 tests)` |

计数自洽：8+7+33+19+**16**+11+7 = 101 = `Tests 101 passed (101)`；交付文件 **16 条计数可见**（85 基线 + 16 新）。另：本任务无 `*.spec.ts`（E2E）交付，SKILL Step 3 spec 触发证据段落不适用（N/A）。

**vitest 触发结论**: ✅ all-vitest-packages-triggered（唯一 workspace package `@nomicore/vfsl` 的全部 7 个测试文件被收集执行且全绿，`vitest-package-not-triggered` 不成立）

---

## 五、验证结论汇总

| 协议项 | 结论 |
|---|---|
| §6.1 标准回归（两跑） | ✅ typecheck EXIT=0 + 7 文件 101/101 EXIT=0，无 skip |
| §6.2 矩阵 MU-1 | ✅ 一致（单文件 9 红；全量 16 红，sa7s×2 同族放大如实登记） |
| §6.2 矩阵 MU-2 | ✅ 逐项一致（AC2×6 红 / AC1×3 绿 / 基线 0 红） |
| §6.2 矩阵 MU-3 | ✅ 一致（9 例锚定全红；全量 17 红，位置族放大如实登记） |
| §6.2 矩阵 MU-5 | ✅ 与 SA2 R1 实测逐条吻合（7/9 + 全量 14 红 + 无挂起） |
| §6.2 矩阵 MU-7 | ✅ 单红精确命中（新#15；基线 0 红） |
| §6.2 矩阵 MU-11 | ✅ 一致（AC3#3 + jd×4） |
| §6.2 矩阵 MU-19 | ✅ 双跑法差异逐项一致（单文件 16 绿 EXIT=0 vs 全量 7 红 = r3×2+sa7s×5） |
| 墙钟政策 | ✅ 7 条全量 3~4s，零 FAIL-挂起 |
| 清零门禁 / D4 | ✅ 逐注入 ×7 清零 + 终局 `git diff -- packages/vfsl/src/` 为空（产品 src 零改动保持）+ 终局回归复跑全绿 |
| HG14 vitest 触发证据 | ✅ 段落在案，7 文件 + 16 条计数可见 |

SA4 五条「动态审核重点」移交全部承接完毕；期望观测与设计/SA2 预登记的全部差异（两处同族红名单放大）已按 HG12 如实登记并说明方向一致性。SA3 交付的 16 条 AC 回归锁经 7 条破坏性注入检验全部表现出设计预登记的红灯行为——测试非假绿、锚定强度主张成立；验证型交付两件交付物（回归锁 + HG9 bump 0.1.3）在真实运行链路上复核通过，无新发现问题。

**Verdict**: pass
