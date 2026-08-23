# SA4 静态验尸报告 — 修订轮 R1（公共 API 面收缩）

**Date**: 2026-08-23
**Verdict**: pass
**审查对象**: SA3 未 commit 工作区改动（rev1：owner PR #96 Request changes 优先方案落地）
**审查方法**: 逐行 diff + 机械断言集合比对 + 全仓 grep 闭合 + 后台独立进程复跑 + 无侵入红向探针（git worktree @ HEAD）

---

## 逐项结论（对任务简报 8 项检查点）

### 1. index.ts 三名目移除与旁路排除 — ✅ PASS

diff 证据（`git diff -- packages/doc-runtime/src/index.ts`）：

- 删除且仅删除两行：`export { applyValidatedMutation } from './mutation.js';`、`export type { MutationIssue, ApplyValidatedMutationResult } from './mutation.js';`（原 15-16 行）；
- 现文件全文 17 行，**枚举式白名单导出**：5 值导出（extractYjsSnapshot / readLogicalValueAtPath / materializeRoot / DocRuntimeFatalError / replaceRootContent）+ 8 类型名目；
- **无任何旁路形态**：无 `export *`、无 `export * as ns`、无 namespace re-export、无 default export、无换名 `as` 导出；
- 深路径旁路关闭：`package.json` `exports` 仅 `"." → ./src/index.ts`，Node ESM exports map 封闭子路径；`mutation.js` 仅经包内相对路径可达（即内部 seam 的正确形态）；
- 头注释更新为「the validated-mutation entry (set-only; awaits issue #76 completion) ... stay package-internal」——与实际公共面**一致**。

### 2. 公共面完整性（保留名目零误删）— ✅ PASS

- 静态枚举：8-17 行逐名目核对，owner 要求的 6 个交付名目（materializeRoot / DocRuntimeFatalError / DocRuntimeFatalPhase / extractYjsSnapshot / readLogicalValueAtPath / replaceRootContent）+ 既有 7 类型名目全部在位；
- 守卫用例 2（五项值导出 typeof function）与 type guard 正例（8 类型名目可导入）双绿佐证（见第 8 项复跑）；
- `DocRuntimeFatalPhase` 实现面（fatal.ts:12-15 三值字面量联合）与 type guard 的 `expectTypeOf<...>` 断言**精确一致**。

### 3. fatal 契约覆盖零丢失（三测试文件逐行 diff）— ✅ PASS（机械证明）

三个迁移文件（`apply-validated-mutation-fatal-contract.test.ts` / `apply-validated-mutation-nested-path-repro.test.ts` / `sa7-fatal-dynamic-verify.test.ts`）：

| 文件 | it() 用例数 HEAD→WT | expect/it 行数 HEAD→WT |
|---|---|---|
| fatal-contract | 4 → 4 | 25 → 25 |
| nested-path-repro | 2 → 2 | 11 → 11 |
| sa7-fatal-dynamic-verify | 8 → 8 | 69 → 69 |

- **断言行集合 diff**（两版各抽全部 expect/toBe/toBeInstanceOf/toThrow… 行做 diff）：三文件中两文件**零差异**；fatal-contract 唯一差异为一行**注释内引用的 expect 文本**（文件头"指示灯现状"段），**实际断言代码零差异**；
- 改动面严格限定于：import 来源拆分（`../src/mutation.js` vs `../src/index.js`）+ 配套注释 + describe/it 标题措辞（「公共导出面」→「包内 seam 载体面」，与载体事实一致）；
- fatal-contract `beforeAll` 双源结构正确：seam 取 `applyValidatedMutation`、公共入口取 `DocRuntimeFatalError`——exact identity 断言 `expect(thrown).toBeInstanceOf(fatalCtor)` 跨双源仍锁同一类（同源于 fatal.ts，本就用例设计意图）；
- **mutation.ts 实现本体零改动**：`git diff --name-only -- packages/doc-runtime/src/` 仅 index.ts；`git status` mutation.ts 空。
- fatal 契约四类场景（pre-commit internal / observer cleanup throw / post-commit verification / 未知异常保守分类 E205）与领域失败留结果联合的断言全部原样在位（sa7 文件 8 用例、fatal-contract 4 用例零触碰）。

### 4. SA6 守卫两文件零改动 + 机制无自欺 — ✅ PASS（独立红向探针复现）

**零改动证据**：
- mtime：guard.test.ts 21:36:05、type-guard.test-d.ts 21:37:45，均早于 SA3 修改（index.ts 21:43:03、fatal-contract 21:43:39）；
- 文件内仍保留红灯期"指示灯现状（当前基线，index.ts 第 15 行仍 `export { applyValidatedMutation}`）"注释——SA3 若改过必会触碰该段，原样保留即未动。

**机制无自欺（双向独立验证）**：
- **绿向**：主 worktree（导出已移除）全量 `npx vitest run --typecheck` → 72 文件 / 974 用例全绿、Type Errors no errors、exit 0（本人后台独立进程复跑，与总控 .mabf-bg/rev1-test.log 一致）；
- **红向（无侵入探针）**：`git worktree add /tmp/sa4-red-probe HEAD`（HEAD=18fa7c0，index.ts:15 含导出）→ 复制两守卫文件入内 → 独立 install + 跑 → **exit 1，2 文件红**：
  - guard.test.ts 用例 1 红：`expected true to be false`（hasOwnProperty 探得导出存在）；
  - guard.test.ts 用例 2 绿：五项保留名目在位（与基线一致，非环境噪声）；
  - guard.test.ts 用例 3 红：`expected [ 'applyValidatedMutation' ] to deeply equal []`；
  - type-guard.test-d.ts 红：2 × `TypeCheckError: Unused '@ts-expect-error' directive`（第 37/39 行）——与 SA6 简报记录的行号与文案**逐字一致**；
- 探针跑毕已 `git worktree remove --force` 清理，主 worktree 未受任何触碰（清理后 git status 复核）；
- 机制配置复核：root vitest.config.ts `typecheck.include = packages/*/test/**/*.test-d.ts` + `tsconfig: ./tsconfig.typecheck.json`，`pnpm test = vitest run --typecheck`——与 SA6 机制描述一致；`@ts-expect-error` TS2578/TS2305 自反转为 TypeScript 标准语义，探针实测吻合。

### 5. package.json patch bump — ✅ PASS

`0.1.6 → 0.1.7`（diff 唯一改动行），硬门禁 #9 / AC R6 在位。

### 6. 影响面闭合 + 文档矛盾检查 — ✅ PASS

- 全仓 grep（apps/ packages/ domains/ scripts/，*.ts/*.tsx/*.js/*.mjs，排除 doc-runtime 包自身）：`applyValidatedMutation` / `MutationIssue` / `ApplyValidatedMutationResult` **零命中**——无任何包/应用经公共入口引用三名目；
- doc-runtime 包内命中全部为预期面：src/mutation.ts（实现）、src/fatal.ts:56（**注释**性提及 transactGuarded 共用，非代码引用）、5 个测试文件（2 守卫 + 3 迁移）；
- `git status -- docs/` 空：**docs/ADR 零改动**；ADR-0007 L27/L42 两处 applyValidatedMutation 提及为 #76 终态描述（owner 未要求本轮改 ADR），无新增矛盾文档。

### 7. vitest 触发性自检（SKILL §1.4）— ✅ PASS

- 本轮新增/改动 5 个测试文件（2 守卫 + 3 迁移）全部位于 `packages/doc-runtime/test/`；
- root vitest.config.ts：`include: packages/*/test/**/*.test.ts` + `typecheck.include: packages/*/test/**/*.test-d.ts` → 全部命中；
- CI（.github/workflows/ci.yml）：`Test: pnpm test`（= `vitest run --typecheck`，Node 20/24 矩阵）+ `Typecheck: pnpm typecheck`（含 doc-runtime tsconfig）→ 全覆盖；
- **结论令牌：`vitest-package-not-triggered: ok（无未接通包）`**（全部改动测试文件经 CI `pnpm test` 触发）。

### 8. 后台独立进程复跑取证 — ✅ PASS

| 命令 | exit | 结果 |
|---|---|---|
| `npx vitest run --typecheck`（本人复跑） | 0 | Test Files 72 passed (72) / Tests 974 passed (974) / Type Errors no errors |
| `pnpm typecheck`（六包 tsc） | 0 | 无输出错误 |
| 总控亲跑（.mabf-bg/rev1-test.log / rev1-typecheck.log） | 0/0 | 同上（72/974 全绿）——双源一致 |
| 红向探针（HEAD 态守卫） | 1 | 2 文件红（见第 4 项）——机制非恒绿 |

---

## SKILL 门禁核对

| 门禁 | 结论 |
|---|---|
| §1.1 Scope Creep | ✅ actual = 5 修改 + 2 新增测试 + wiki 档案，与 owner 修改要求/rev1 简报改动清单一一对应，零越界；BLACKLIST（npm/yarn lockfile、TASK.md、.bak）零命中 |
| §1.3 E2E spec 触发 | N/A（无 .spec.ts 改动） |
| §1.4 vitest 触发 | ✅ ok（见第 7 项） |
| §1.5 协议假设 | N/A（纯导出面收缩，无协议级假设） |
| §1.6 契约改动 ripple | ✅ 无 throw/return 契约改动（mutation.ts 零改动）；导出移除的编译影响面 = 全仓零外部引用，闭合 |
| §1.7 源码 grep 断言禁令 | ✅ 5 个测试文件零 `readFileSync` + toMatch/toContain 反模式；守卫为模块导出观测（运行时）+ tsc 诊断（类型面），与 SA6 断言纪律声明一致 |
| §2 读写路径 | N/A（无数据流改动） |
| §3 静默失败 | N/A（无新执行路径） |
| §4 降级方案 | ✅ 无降级引入（set-only mutation 降为包内模块是 owner 定稿方案本身，非掩盖性降级） |
| §5 极端攻击 | ✅ 换名 / namespace / default / 深路径旁路全关闭（枚举式导出 + exports map 单入口 + type guard 类型面锚定） |
| §7 架构死胡同 | ✅ 无（收缩与 ADR-0008 授权范围一致，方案即 owner 定稿） |
| §8 过度设计 | ✅ 改动最小面：2 行删除 + 2 行注释 + 1 行 bump + 3 文件 import 拆分 |

## 非阻塞 findings（不改变 verdict，建议后续处置）

1. **F-1（低 · → SA6 未来加固）**：guard 用例 3 注释声称「防 SA3 改头换面（如换名导出 set-only 形态）」，但正则 `/^applyValidatedMutation$/` 仅匹配精确名，防不住未来换名导出（如 `applyMutation`）。建议下轮把用例 3 升级为**键集合白名单断言**（`Object.keys(ns).sort()` toEqual 已知五键），纵深更强。本轮不阻塞：owner 验收点（三名目不存在）被用例 1/3 + type guard 双负例精确锚定，且本轮 diff 已逐行验证无换名导出。
2. **F-2（cosmetic · → SA3 可选）**：fatal-contract L70 分节注释「（applyValidatedMutation / DocRuntimeFatalError 当前均未导出 → 行为性红灯）」为红灯期历史残留，与现状语义过时；文件头"指示灯现状"段已正确改写，不影响主读路径。
3. **F-3（housekeeping · → 总控 commit 时）**：`REPORT.md`（上轮 runner 结案产物，mtime 18:08 早于本轮 21:43）与 `.mabf/` 为 untracked 运行时产物，不属于本轮交付面，续传 commit 时应排除。

## 动态审核重点（交 SA7）

1. CI Node 20/24 双腿全绿（owner 回归要求 4 的 CI 部分；本地双通道已绿，矩阵腿归 runner/CI 证据）。
2. （可选低优先）PR 构建面无 mutation 深路径旁路——exports map 静态已闭合，CI 编译通过即为佐证。

## 审核结论汇总

1. 设计一致性：✅ 与 owner 优先方案逐条一致（三名目移除 / seam 保覆盖 / 交付范围不变 / bump）
2. 读写路径一致性：N/A（无数据流改动）
3. 静默失败：✅ 无新路径
4. 降级方案：✅ 无引入
5. 极端攻击：✅ 旁路全关闭（红向探针实证守卫非自欺）
6. 错误处理：✅ 契约面零变化（mutation.ts 零改动）
7. 架构评估：✅ 可行（收缩即定稿）
8. 过度设计：✅ 精简

verdict: pass
