# SA4 静态验尸报告

**Date**: 2026-08-22
**Verdict**: pass
**修订**: R2（2026-08-22）——按总控要求补齐 Hard Gate #14 法定章节「1.4 vitest 触发性自检」（结论关键词 `all-vitest-packages-triggered`）；实质分析原报告已覆盖，本轮仅补章节标题与结论关键词，Verdict 不变、无重审项。
**被审对象**: commit `06d6796`（SA3 更名迁移实现，未 push；基线 `origin/docs/doc-runtime-validation` = `ee3643c`）
**任务类型**: refactor（深度重构·纯更名迁移）· Phase 3
**输入**: 任务简报（含 SA6 Phase 1 红灯记录）/ design R2（SA2 verdict: pass）/ SA8 两轮 clear

---

## 审核方法声明

独立复跑设计 §6 四门 + 逐文件反向更名机械等价性验证 + 对抗性盲区攻击（动态字符串引用 / 大小写与 snake_case 变体 / alias 形态 / 重导出链 / lockfile 联动）。测试均在独立进程执行（`setsid nohup`，技能规范）。总控已独立复验 G1/G2/G3a/G3b/typecheck，本报告全部证据为 SA4 自行重跑所得。

## 独立验证证据（命令 + 结果）

| 门/检查 | 命令 | 结果 |
|---|---|---|
| **G1 白名单全仓门** | `git grep -n "validateSnapshot" -- ':!wiki' ':!docs/adr' ':!TASK.md' ':!CONTEXT.md' ':!.scratch' ':!.scratch*' ':!packages/vfsl/test/validate-logical-snapshot.test.ts' ':!packages/vfsl/test/validate-logical-snapshot.contract.ts'` | **零输出（exit 1）** ✓ |
| **G2 静态指纹门** | `grep -n "整份 JSON 快照校验" packages/vfsl/src/index.ts` | **零输出（exit 1）** ✓——孤儿续行不存在 |
| **G3a 探针显式单跑** | `pnpm exec vitest run packages/vfsl/test/validate-logical-snapshot.test.ts --passWithNoTests=false` | **Test Files 1 passed (1) / Tests 29 passed (29) / exit 0**（独立进程，Duration 5.12s）✓ |
| **G3b 全量 + 类型** | `pnpm test` → `pnpm typecheck` | **Test Files 47 passed (47) / Tests 669 passed (669) / Type Errors no errors / TEST_EXIT=0 / TYPECHECK_EXIT=0**；运行清单含 `✓ packages/vfsl/test/validate-logical-snapshot.test.ts (29 tests)` ✓ |

## 审核结论

1. **设计一致性：✅ 一致（含 Scope Creep Guard）**
   - **§1.1 文件清单比对**：actual diff（vs `ee3643c`）24 文件 = 15 个 §10 ALLOW 迁移文件 + 2 个 SA6 owned 冻结文件 + 7 个本任务前缀 wiki 流程产物。**无越界文件、DENY LIST 全零触碰**（`docs/adr/**`、`wiki/prd`、既有 wiki/raw、`TASK.md`、`CONTEXT.md`、scratch 三文件、`evaluate.ts` 等 12 个 src 文件、四个旁路包、CI/vitest.config/tsconfig/根 package.json 均不在 diff）；BLACKLIST（package-lock/yarn.lock/.DS_Store/TASK.md/.bak）零命中；untracked 文件为零。
   - **逐规格点验**：
     - `validate.ts:633-648` 新 JSDoc 块与 design §4.1(b) 逐字文本 **diff 零差异（byte-identical）**，16 行、不含旧名、不含 G2 指纹串；
     - `index.ts:14-18` 新 5 行 bullet 与 design §4.2(b) 改动后文本 **byte-identical**，旧 4 行 bullet（含 L15-17 续行）整块移除，无孤儿；
     - `index.ts:3` 头注为 §4.2(c) 指定形态「issue #21（#71 更名）：validateLogicalSnapshot」；
     - `package.json` 0.1.10 → 0.2.0（D7）单行；无 `as validateSnapshot` / `validateLogicalSnapshot as` 任何 alias 形态（D2）；
     - 文件名零改动（D4）；活文档 7 处与 §4.5 逐条吻合（README:61 为指定整括号扩写，其余全字替换）。
   - **机械性金标准验证**：7 个测试文件 + `resolve.ts` + `validate-patch.ts` 共 9 文件执行反向更名（`sed s/validateLogicalSnapshot/validateSnapshot/g`）后与基线版本 **`cmp` 逐字节相等**——纯 token 迁移、零顺手改动（D1）；`validate.ts` 反向更名后与基线唯一差异 = §4.1(b) JSDoc 块，`index.ts` 唯一差异 = §4.2(b) bullet + §4.2(c) L3 头注——**行为零改动获机械证明**（函数体 `return interpret(derived.values, derived.values['ROOT'], snapshot);` 逐字节不动，`validateSubtree`/`interpret`/一切消息字面量零触碰）。
2. **读写路径一致性：✅ 一致**（不适用分叉判定——纯名称绑定迁移，无数据流改动；导出面单一入口原子切换，无新旧双源并存窗口，D9 单提交）。
3. **静默失败：✅ 无**（零新分支/零新路径；验证门自身的历史伪绿面——R1 正向枚举盲区与 `passWithNoTests` 假绿——已分别被 G1 白名单门与 G3a 显式单跑堵死，本审独立重跑确认两门有效）。
4. **降级方案：✅ 安全**（无任何降级/fallback/兼容层——D2 不留 alias 经 grep 全形态验证；G1 + AC2 `toBeUndefined` 红灯锚构成持续守卫）。
5. **极端攻击：✅ 安全**：
   - 动态/计算属性访问旧名（`['validate` / `+ 'Snapshot'` 等）：零命中；
   - 大小写/snake_case 变体（`validatesnapshot` / `validate_snapshot`，case-insensitive）：豁免文件外零命中；
   - SA6 双文件旧名计数 **5 + 2** 与 design §1 域 D 逐点吻合（方法论叙述 + 探针断言本体，非活引用）；
   - 豁免侧残留逐文件核验：CONTEXT.md 1（L49 `_Avoid_` 执行机制，D8）、TASK.md 1、`.scratch/vfsl-v1-parser/spec.md` 4、`.scratch-spec-20.md` 1、`.scratch-review-spec.md` 0——与 §1 域 D 清单精确一致；
   - kebab 路径残留恰为 R-yes 记录三处（contract.ts:46 / sa7 头注 L5 / validate-patch.test.ts:64），D4 裁定在案；
   - ESM named import 破损不可能静默：typecheck 五包 exit 0；
   - 跨包消费面封闭：`@nomicore/vfsl` 的仓内 importer（vfsl-codegen / domains / persistence）无一引用新旧名（生产 caller = 0，与 §12 caller 审计表一致）；包 `private: true` 无外部消费者。
6. **错误处理：✅ 完整**（E100 崩溃边界与全部分支零触碰——由 §1 机械等价证明背书；探针含 E100/预算/截断三重可区分断言，29/29 绿）。
7. **架构评估：✅ 可行**（零绕过、零 FIXME、零临时补丁；半径 = 单包符号域 + 注释/文档行文 + 版本号，与 mandate 精确匹配；无退回 SA1 信号）。
8. **过度设计：✅ 精简**（反向案例——最小变更半径；0.2.0 bump 是 semver 破坏性变更纪律信号且有 lockfile 无感性证明：`pnpm-lock.yaml` 对 `@nomicore/vfsl` 全部为 `workspace:*`/`link:`，`--frozen-lockfile` 无冲突面）。
9. **测试质量（§1.7 源码 grep 禁令）：✅ 通过**——SA6 双文件 29 条断言全为运行时行为锚（结果形状 / issue 消息与 path / 冻结输入 / 深拷贝对照），`toMatch` 仅作用于运行时返回的 message 字符串，无 `readFileSync(<源码>)` 反模式；既有 7 套件迁移零断言改动（机械等价证明）。
10. **Runner 触发性（§1.3/§1.4）：✅ 通过**——无 `*.spec.ts`；全部改动测试文件（含探针）位于 `packages/vfsl/test/`，被根 `vitest.config.ts` include（`packages/*/test/**/*.test.ts`）收集、CI `ci.yml` `pnpm test` 步骤（L39）触发；`contract.ts` 非 `.test.ts` 不被收集（include 实读核实）；本审 G3b 运行清单实证探针在跑。逐文件明细与结论关键词见下方法定章节「1.4 vitest 触发性自检」。
11. **协议假设（§1.5）：✅ 不适用成立**——design §11「无协议级假设」与实现一致（纯符号更名，零协议面）。
12. **契约改动连锁（§1.6）：✅ 通过**——改动类别为名称绑定变更（删旧名 + 增新名），非五类行为性契约变化；caller 全集（重导出 1 + 测试面 7 + 动态探针 1）全部迁移或零改动兼容，G1 零输出 + typecheck exit 0 + 669 绿三重证明无遗漏 caller。

## 1.4 vitest 触发性自检（Hard Gate #14 法定章节）

**审查对象**：本任务新增/改动的全部测试文件（`git diff --name-only ee3643c 06d6796 | grep -E '\.(test|spec)\.ts$'` + SA6 双文件）。

**收集规则**（根 `vitest.config.ts` L5 实读）：`include: ['packages/*/test/**/*.test.ts', 'domains/*/test/**/*.test.ts']`。
**CI 触发链**（`.github/workflows/ci.yml` L38-39 实读）：`Test` 步骤执行根 `pnpm test` = `vitest run --typecheck`（无 `--filter`/包级裁剪，收集域 = include 全域）。
**运行清单证据**：SA4 独立进程 G3b（`pnpm test`，与 CI 同一入口同一 config）日志 `/tmp/sa4-g3b.log`，逐文件 grep 实证。

### 逐文件核对表

| # | 文件（均在 `packages/vfsl/test/`） | 改动 | 匹配 include | G3b 运行清单证据 | 判定 |
|---|---|---|---|---|---|
| 1 | `validate-logical-snapshot.test.ts` | 新增（SA6 探针） | ✅ `packages/*/test/**/*.test.ts` | ✅ `✓ … (29 tests) 8155ms` | 覆盖 |
| 2 | `validate-logical-snapshot.contract.ts` | 新增（SA6 共享断言集） | N/A——**非 `*.test.ts`，按设计（§10/D6）不独立收集** | 不在运行清单（**符合设计**）；其 27 条断言经 `registerBehaviorRegression` 在 #1 内执行——#1 的 29 tests = 2 导出面 + 27 contract 注册，含仅存在于 contract.ts 的 4.5s 预算用例 | 覆盖（经消费方 #1） |
| 3 | `validate-snapshot.test.ts` | 修改（更名迁移） | ✅ | ✅ `✓ … (35 tests) 112ms` | 覆盖 |
| 4 | `validate-snapshot-sa7.test.ts` | 修改 | ✅ | ✅ `✓ … (14 tests) 42458ms` | 覆盖 |
| 5 | `validate-patch.test.ts` | 修改 | ✅ | ✅ `✓ … (36 tests) 52ms` | 覆盖 |
| 6 | `validate-patch-sa7.test.ts` | 修改 | ✅ | ✅ `✓ … (22 tests) 41842ms` | 覆盖 |
| 7 | `docscope-guards.test.ts` | 修改 | ✅ | ✅ `✓ … (6 tests) 74ms` | 覆盖 |
| 8 | `vfsl-assets-fullchain-e2e.test.ts` | 修改 | ✅ | ✅ `✓ … (16 tests) 57ms` | 覆盖 |
| 9 | `evaluate-derived-schema.test.ts` | 修改 | ✅ | ✅ `✓ … (37 tests) 64ms` | 覆盖 |

8 个 `*.test.ts` 文件运行计数合计 195（29+35+14+36+22+6+16+37），全部含于 G3b 总量 669/669 绿。本任务无 `*.spec.ts`（§1.3 E2E spec 门不适用）；无新增 workspace package（全部落位既有 `@nomicore/vfsl`，根 `pnpm test` 对其天然覆盖，无需 `--filter` 比对）。

**缺口清单**：无。

**结论关键词：`all-vitest-packages-triggered`** —— 本任务全部新增/改动测试文件均被根 vitest include 覆盖并被 CI `pnpm test` 入口实际执行（运行清单逐文件实证）；contract.ts 为设计内共享断言模块（非孤儿测试文件），其断言经探针文件完整执行。

## 已知可接受残留（记录在案，非阻塞）

- **R8/D12 接受残留**：CI 无针对探针文件的专用 `--passWithNoTests=false` 步骤（CI 改动超 ALLOW LIST，设计裁定纪律落 SA3 自验 + SA7 证据）——探针被删/漏收集时 CI 侧仍可能静默假绿，防护为证据纪律而非机器门。
- **R-yes 残留**：两个 kebab-case 测试路径名 + 三处路径级引用（见结论 5）。
- 工作树有一处未提交改动：`wiki/raw/task_rename-validate-logical-snapshot_dispatch.md`（流水线簿记，不属于被审 commit 06d6796，无影响）。

## 动态审核重点（交 SA7）

1. **AC4 CI 证据**：commit `06d6796` 尚未 push——push 后须确认 `.github/workflows/ci.yml` node `[20, 24]` matrix 全绿，且 CI `Test` 步骤日志运行清单含 `packages/vfsl/test/validate-logical-snapshot.test.ts`（D12 要求贴 `Tests 29 passed (29)` 原文）；本机 G3a/G3b 证据已备，CI 侧等价证据待补。
2. **`pnpm install --frozen-lockfile` + version bump**：本地 lockfile 分析证明无版本锚（`workspace:*`/`link:`），CI install 步骤实跑确认（预期绿，仅形式确认）。
3. **R8 残留的持续防护**：后续任何触及 CI 的任务，建议为探针补专用 `--passWithNoTests=false` 步骤（对齐 persistence-contract / domains-scaffold 先例）——超出本票半径，仅登记。

---

**Verdict: pass** —— 更名迁移与设计 R2 逐点一致、机械可证、四门独立重跑全绿、无静默失败/降级/越界/过度设计，无退回信号。SA7 可进入动态验证（重点见上节）。
