# SA7 动态验证报告 — Parser 禁止语法负例矩阵（Issue #8）

**Date**: 2026-08-19
**验证对象**: commit `a35ab48`（SA3 test-only 工作单执行，分支 `fix/issue-8-on-refactor-docs-add-mabf-multi-repo-monito`）
**验证输入**: SA4 静态验尸报告（Verdict=pass，「动态审核重点」清单 4 条）、任务简报（§六 SA6 A.2 中断门禁记录）、SA1 设计 R1（§4.3 工作单 / §4.4 SA7 边界 / §8 R2 比对口径）
**验证方法**: 全部命令按 2026-05-08 立法后台独立进程（`setsid nohup … & disown`）执行；变异抽检以临时改 `src`（python3 精确替换 + `[SA7-DIAG]` 标注）→ 后台跑矩阵文件 → `git checkout` 还原 → 复跑全量坐实零残留的方式完成。本任务为纯进程内 parser（零运行时依赖、无服务/端口）——按 SA7 CLAUDE.md「不得盲用 `fuser -k` 清场」未做端口释放（无所需端口）。
**环境**: node v24.13.0（命中 CI 矩阵 node [20,24] 的 24 腿）/ pnpm 10.28.2 / vitest 3.2.7

---

## Step 0 — SA4 verdict 校对（2026-06-13 立法）

```
[SA7 Step 0 结论]
SA4 verdict: pass（sa4_review.md 顶部 :4 Verdict: pass；2026-08-19 勘误仅补门禁条目名称，Verdict 维持 pass）
操作: 进 Step 1
```

## Step 1 — SA6 红灯测试现跑（第二关）

本任务 SA6 走 **A.2 中断门禁分支**（简报 §6.3：两轮矩阵测试全绿、无法制造红灯），红灯契约资产即矩阵文件本身；SA3 依 §4.3 工作单改写 1 格 + 新增 3 it 后的现跑即第二关：

```text
$ pnpm test    # setsid nohup 后台独立进程，/tmp/sa7-test.log，exit 0
 RUN  v3.2.7
 ✓ packages/vfsl/test/parse-vfsl-containers-markers.test.ts (33 tests)
 ✓ packages/vfsl/test/parse-vfsl-forbidden-matrix.test.ts (79 tests)
 ✓ packages/vfsl/test/parse-vfsl-errors.test.ts (19 tests)
 ✓ packages/vfsl/test/parse-vfsl.test.ts (11 tests)
 ✓ packages/vfsl/test/parse-vfsl-r3-regression.test.ts (7 tests)
 ✓ packages/vfsl/test/parse-vfsl-jsdoc.test.ts (7 tests)
 ✓ packages/vfsl/test/parse-vfsl-sa7-supplementary.test.ts (8 tests)
 Test Files  7 passed (7)
      Tests  164 passed (164)
TEST_EXIT=0
```

```
[SA7 Step 1 结论]
SA6 红灯资产（A.2 分支：矩阵 + §4.3 工作单 4 it）: 🟢 GREEN — 矩阵 79/79，全量 7 文件 164/164
操作: 进入 Step 2
```

工作单 4 it 落位核对（grep + 实读）：`E102-06-pos`@:185-187（`expectOk(parseVfsl('type Foo = string; type T = Foo;'), 2)`）、`E102-09-neg`@:189-192、`E103-08-neg`@:271-273、`E103-08-pos`@:275-277——与 SA1 §4.3 规格 it 名/块体逐字一致，矩阵恰 79 it（`grep -c "  it("`）。

## Step 2 — SA4 动态审核重点清单逐项验证

> 阅读量：SA4 报告 + 简报 + 设计 R1 + issue #7 SA7 报告（先例）+ parser.ts/semantic.ts 定段 + 矩阵文件定段 = 7 文件，限额 15 内。

### 清单 1. 复绿复现（164/164 + typecheck exit 0） → ✅ 通过（HEAD 现跑）

SA4 E7 静态期复现后，SA7 在 HEAD 上再摘录一轮（上方 Step 1 全量日志 + 下述）：

```text
$ pnpm typecheck    # /tmp/sa7-tsc.log，TSC_EXIT=0
> tsc -p packages/vfsl/tsconfig.json
（零输出零错误）
```

计数自洽：164 = 冻结基线 85（33+19+11+7+7+8）+ 矩阵 79，与设计 §4.3 预期态（161→164）逐数吻合。变异抽检全部还原后另跑终态复绿一轮（见清单 3 末），仍 164/164 + exit 0——worktree 零残留的动态坐实。

### 清单 2. Spec/vitest 触发证据（CI run 摘录） → ⏳ CI 待建（如实登记，非实现缺陷）

```text
$ gh run list --branch fix/issue-8-on-refactor-docs-add-mabf-multi-repo-monito --limit 5
（空输出，gh-exit=0）
$ gh pr list --head fix/issue-8-on-refactor-docs-add-mabf-multi-repo-monito
（空输出，gh-exit=0）
$ git log origin/fix/issue-8-on-refactor-docs-add-mabf-multi-repo-monito -1
fatal: unknown revision（分支从未 push）
```

分支尚无任何 GitHub Actions run、无 PR——SA7 无 push/建 PR 职责（CLAUDE.md 边界），CI runner 侧日志**本轮不可得，不以静态推断冒充**。按总控指令依 issue #7 SA7 先例处置：本地实跑摘录（Step 1）+ 静态接线核验（见 Step 4 表）+ CI 待建如实登记，**CI run log 留待总控 push/建 PR 后收尾关摘录**。

### 清单 3. 变异抽检（E103-08-neg 首记号位 + E102-06-pos 伪正例修复格） → ✅ 两项全部检出

**M1 — 删 parser.ts:351-353 首记号位 `extends` 分支**（SA4 E8 静态推演的动态确认）：

python3 精确删除 `parseIdentType` 内 `if (v === 'extends') { throw E103 }` 三行（`git diff --stat` 确认恰 3 deletions），后台跑矩阵文件（/tmp/sa7-m1.log）：

```text
M1_EXIT=1
 × E103 — 条件类型禁止矩阵（v1-spec §4 判定顺序第 3 条，锚 extends 记号） > E103-08-neg 类型位置首记号即 extends → E103 锚 1:10
   → expected 'VFSL-E100: 别名缺少终止分号 ';',（注记 4），实际 标识…' to match /^VFSL-E103: /
 Test Files  1 failed (1)
      Tests  1 failed | 78 passed (79)
```

- **恰 1 红 = E103-08-neg**，与 SA4 E8 推演逐字吻合：`extends` 走非保留名 ref 路径 → 后随 `B` 落在 `;` 期望位 → E100（码失配）；E103-01~07（走 dispatchContinuation:308-310 分支）全部保持绿——外科手术式检出，证明红源确系首记号位分支而非别处。
- 设计 §5 对照表「删该分支 → 首轮全套件全绿（零防护）→ 修复后 1 格红」的**后一态动态坐实**；前一态（零防护）由 SA1 `grep -rn "=\s*extends"` 零命中 + 本变异的「其余 78 格全绿」间接佐证（若无 E103-08，该变异当时全套件仍会全绿）。

**M2 — 已声明裸引用误判为越界**（E102-06-pos 修复格防护力；SA4 清单 3 可选项，一并执行）：

semantic.ts:99 `if (!declared.has(t.name))` 临时改 `if (true) { // [SA7-DIAG]`（一切裸引用按未声明裁定 E301），后台跑矩阵文件（/tmp/sa7-m2.log）：

```text
M2_EXIT=1
 × E102 — 自定义泛型禁止矩阵（…） > E102-06-pos 声明后裸引用（Foo 已声明的最接近合法写法）→ ok
   → expected false to be true // Object.is equality
 ✓ E102 — … > E102-06-neg 类型位置泛型调用且名未声明（第 6 条终判）→ E301 锚引用记号 1:10
 ✓ E102 — … > E102-09-neg 裸引用未声明名（无实参）→ E301 锚引用记号 1:10
 Test Files  1 failed (1)
      Tests  22 failed | 57 passed (79)
```

- 22 红 = 全部依赖「已声明裸引用须接受」的 pos 格（E102-04/06/07-pos、E103-01~07-pos、E105 各 pos 等）；**E102-06-pos 在列且 `ok:false` 被 `expectOk` 首断言当场抓住**，其两个配对负例（E102-06-neg/E102-09-neg）保持绿——配对语义干净：pos 格守护「已声明引用必须被接受」，负例守护「未声明必须被拒」，信号互不遮蔽。
- **盲区闭合反证**：改写前该槽位块体为 `expectAnchored(expectSingleIssue(parseVfsl('type T = Foo;')), '301', 1, 10)`——M2 下未声明 `Foo` 仍产出 E301@1:10，旧槽位会继续绿。即 R1-a 落地前此变异对 E102-06 槽位零检出；落地后当场检出——SA2 攻击点 #1 的修复防护力动态成立。

**还原与终态复绿**：`git checkout -- packages/vfsl/src/{parser,semantic}.ts`，`git status --porcelain -- packages/` 为空；另起后台终态轮（/tmp/sa7-final.log）：`pnpm test` **7 文件 164/164 exit 0**（含 `✓ parse-vfsl-forbidden-matrix.test.ts (79 tests)`）+ `pnpm typecheck` **exit 0**——变异零残留。

### 清单 4. Scope 终检（§8 R2 口径） → ✅ 通过

```text
$ git diff --name-only b076d41..HEAD -- packages/
packages/vfsl/test/parse-vfsl-forbidden-matrix.test.ts     ← 恰 1 行
$ git status --porcelain -- packages/
（空输出——变异已全部还原，工作区与 HEAD 一致）
```

SA7 全程未新增/修改任何 `packages/**` 文件（含测试文件——理由见「产物与边界说明」）；`src/**` 两次触碰均为临时变异且已还原。

## Step 3 — E2E spec 触发门禁 → 不适用

`find . -name '*.spec.ts' -not -path './node_modules/*'` = **0 个文件**（全仓无 E2E spec；SA4 立法门禁 §1.3 同判 N/A）。本任务只有 `*.test.ts`（vitest），走 Step 4 门禁。

---

## vitest 触发证据 (verdict 升级 — 2026-06-15 立法)

### CI 侧如实说明（不得伪造 CI 日志）

见 Step 2 清单 2：该分支**尚无任何 GitHub Actions run、尚无 PR、从未 push**（三条命令空输出/unknown revision实录）。PR 由外部流程在 SA 链收尾后创建，SA7 无 push/建 PR 职责。CI runner 侧动态日志本轮不可得，`✓ 触发且通过（CI）`分类留待 PR 建立后确认——与 issue #7 SA7 报告同款处置。

### 证据采用：workflow 静态接线 + 本地全量运行（SA7 亲验，非转抄）

| 链路环节 | 证据 |
|---|---|
| 新增/改动 `*.test.ts` | `packages/vfsl/test/parse-vfsl-forbidden-matrix.test.ts`（79 用例，本任务唯一 ALLOW LIST 文件）——本轮实跑收集执行 ✅ |
| 所在 workspace package | `@nomicore/vfsl`（全仓唯一 workspace package） |
| vitest include | 根 `vitest.config.ts:5` `'packages/*/test/**/*.test.ts'` → 命中 |
| 根 script | 根 `package.json` `"test": "vitest run"`（无过滤，根级全仓收集） |
| CI workflow 静态接线 | ci.yml：`push: main` + 全部 `pull_request` 触发（:4-6），node [20,24] 矩阵（:18），`pnpm typecheck`（:36）→ `pnpm test`（:39） |
| typecheck 侧 | `packages/vfsl/tsconfig.json` include 含 test → 矩阵文件同受检（本轮 tsc exit 0） |
| 本地运行动态确认 | node v24.13.0（命中矩阵 24 腿）`pnpm test`：`Test Files 7 passed (7)` / `Tests 164 passed (164)`，含 `✓ packages/vfsl/test/parse-vfsl-forbidden-matrix.test.ts (79 tests)` 摘录（Step 1 + 终态轮双跑） |

| Workspace Package | CI Step Name | 触发结果 | 证据 |
|---|---|---|---|
| `@nomicore/vfsl` | `Test`（`pnpm test`，node 20/24 矩阵） | ⏳ CI run 待 PR 建立（无 run 可查，如实说明）；**本地等价命令全绿** | `Test Files 7 passed (7)` / `Tests 164 passed (164)`（本地 vitest 3.2.7 / node 24） |

**verdict**: ✅ all-vitest-packages-triggered（静态接线完整 + 本地实跑收集执行全部 7 个测试文件含矩阵文件；不存在「测试文件不在 runner 收集范围」的黑洞路径。CI runner 侧日志留待 PR 建立后由总控/收尾关确认）

---

## 产物与边界说明

- **未新增任何测试文件、未修改任何业务代码**：设计 §8 ALLOW LIST 限定 packages/ 恰 1 文件（SA4 比对口径 R2），SA4 动态审核重点 #4 明示「SA7 期间产生新的 packages/ 改动即违 §8 R2」；设计 §4.4 亦将本任务 SA7 动态验证界定为「复跑 `pnpm test`（预期 164/164）+ `pnpm typecheck`」。故破坏性验证以**临时变异**（python3 精确替换 + `git checkout` 还原）执行，全程零永久 `packages/**` 改动——比 issue #7 的临时探针文件更进一步（连临时测试文件都不需要，矩阵文件本身即探针）。
- `src/**` 两次变异（M1/M2）均带 `[SA7-DIAG]` 语义、跑完即还原，终态轮 164/164 + tsc exit 0 坐实零残留。
- 工作区遗留（`TASK.md`、`.mabf-bg/`、`wiki/raw/task_vfsl-forbidden-syntax-matrix_dispatch.md` 改动、`_sa4_review.md` 待提交）系总控/前序 SA 流程产物，SA7 未触碰；本报告为 SA7 唯一新增文件（§8 显式豁免清单内）。

## 总结

| 项 | 结果 |
|---|---|
| Step 0 SA4 verdict 校对 | pass → 进 Step 1 |
| Step 1 SA6 红灯资产现跑 | 🟢 矩阵 79/79、全量 164/164、exit 0 |
| 清单 1 复绿复现 | ✅ 164/164 + typecheck exit 0（HEAD 现跑；变异还原后终态轮再证） |
| 清单 2 CI 触发证据 | ⏳ CI 待建（分支未 push、无 run 无 PR；静态接线 + 本地等价命令已验，CI log 留交总控——issue #7 同款处置） |
| 清单 3 变异抽检 | ✅ M1 删首记号位分支 → 恰 1 红 = E103-08-neg（E100 码失配，与 SA4 E8 推演逐字吻合）；✅ M2 已声明裸引用误判 → E102-06-pos 红（`expected false to be true`）且配对负例保持绿 |
| 清单 4 Scope 终检 | ✅ `git diff --name-only b076d41..HEAD -- packages/` 恰 1 行；工作区 packages/ 零残留 |
| Step 3 / Step 4 | spec=0 不适用；vitest 接线完整 + 本地实跑全绿，CI 侧如实登记 |

SA4 动态审核重点 4 条：3 条 ✅ 通过、1 条 ⏳ CI 待建（环境性阻塞，非实现缺陷，交总控 push 后收尾关补证）。变异抽检两项全部检出——SA2 攻击点 #1（伪正例）与 #2（首记号位零防护）的修复经动态破坏性验证确认具备真实防护力。未发现新缺陷，无回流项。

---

**Verdict: pass**
