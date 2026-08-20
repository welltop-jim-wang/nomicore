# SA7 动态验证报告 — fix(vfsl-codegen) 生成物编译级加固（Issue #45）

**Date**: 2026-08-21
**Verdict**: **pass**
**被验对象**: SA3 实现 commit `1c95341`（基点 `5907dc3`），SA4 静态审核已 pass（`task_vfsl-codegen-hardening_sa4_review.md` L4）
**验证方法**: 真实运行链路驱动——全部探针走 `/tmp` hermetic 目录（`/tmp/sa7-i45/`，含 `git archive 5907dc3` 孤立基线副本做差分对照），仓内零写入（唯一仓内产物 = 本报告 + 基线日志 `wiki/raw/task_vfsl-codegen-hardening_sa7_baseline.log`）。生成路径经真实管线（`parseVfsl → evaluate → generateProjection`，tsx 直驱仓内源码）；编译判据用真实 `tsc --noEmit -p`（非测试 API 路径的独立复证）；CLI 判据用 `pnpm generate` 子进程 exit code + stderr 原文。

---

## Step 0 — SA4 verdict 校对

SA4 verdict = **pass**（sa4_review.md L4）→ 进入动态验证。SA7 独立验证如下，未下调、未上调 SA4 结论。

## Step 1 — SA6 红灯测试红→绿

命令（仓根，独立进程）：`./node_modules/.bin/vitest run packages/vfsl-codegen/test/generate-protocol-import.test.ts packages/vfsl-codegen/test/generate-alias-collision-guard.test.ts packages/vfsl-codegen/test/generate-error-message-tail.test.ts`

```
 ✓ packages/vfsl-codegen/test/generate-protocol-import.test.ts (5 tests)
 ✓ packages/vfsl-codegen/test/generate-alias-collision-guard.test.ts (4 tests)
 ✓ packages/vfsl-codegen/test/generate-error-message-tail.test.ts (4 tests)
 Test Files  3 passed (3)
      Tests  13 passed (13)
Type Errors  no errors
EXIT=0
```

**SA6 13 红灯全转绿**（SA6 记录的基点红灯：13 failed / EXIT=1）。

---

## 一、SA4 §四动态审核重点逐项实证

### 清单① — `--check` 路径行为增强 0→2（双侧差分实证）✅

探针：`/tmp/sa7-i45/probes/probe1-check-collision.sh`。碰撞域（`// @id: collide@1`，`type ROOT = YMap<{ x: PathSchema }>` + `type PathSchema = YMap<{ x: YLeaf<string> }>`）写入 `/tmp/sa7-i45/check-collision/domains/collide/schema.vfsl`。

| 步骤 | 链路 | 实测 |
|---|---|---|
| A | **基线 5907dc3** CLI（`git archive` 孤立副本，真实 `tsx cli.ts --domains`）生成路径 | `BASELINE-GENERATE-EXIT=0`，写盘毒化生成物 L8：`export type PathSchema = { 'x': PathSchema<string, 'leaf'> };`（自碰撞形态） |
| B | **基线 5907dc3** `--check` 同目录（盘上为基线自产） | `BASELINE-CHECK-EXIT=0` —— **旧行为：碰撞域 `--check` 静默绿** |
| D | **当前 1c95341** `pnpm generate --check --domains <同目录>` | `CURRENT-CHECK-EXIT=2`，stderr 原文：`vfsl-codegen: [alias-protocol-export-collision] 领域别名与协议导出名碰撞：'PathSchema'——生成物以模块增广方式接线协议，增广体内别名名会解析到协议导出（泛型名 → 生成物编译错误；非泛型名 → 静默绑定协议类型、路径投影语义损坏）；'@nomicore/vfsl-protocol' 的导出名不得作领域别名，请重命名领域别名` |
| E | 当前生成路径对照 + 失败零产出 | `CURRENT-GENERATE-EXIT=2` 同 stderr；域目录仅剩 `schema.vfsl`（无 `generated.ts` 写盘——collect 全量前置 → 任何写盘前失败） |

**结论：`--check` 行为增强 exit 0→2 双侧实证**（同一环境同一域目录，基线副本 exit 0 → 当前 exit 2 + 结构化 stderr + 独立错误码）。

### 清单② — 多重碰撞确定性（声明序，非字段序/非字典序）✅

探针：`/tmp/sa7-i45/probes/probe2-multi-collision.mjs`（fixture 三序互异设计：声明序 ≠ ROOT 字段序 ≠ 字典序，可判定实际跟随哪一序）。

- **F1**（声明序 `VfslKind → PathValue → PathAt`；ROOT 字段序 `PathAt → VfslKind → PathValue`）：`err.aliases = ["VfslKind","PathValue","PathAt"]` ＝**声明序**；`err.name = AliasProtocolExportCollisionError`，`err.code = 'alias-protocol-export-collision'`；消息三名一次全列且顺序一致（`'VfslKind'、'PathValue'、'PathAt'`）。
- **F2**（反向声明 `PathValue → VfslKind → PathAt`）：`err.aliases = ["PathValue","VfslKind","PathAt"]` ＝声明序跟随翻转——排除字段序与字典序两种解释。
- 两 fixture 均**一次全列三名**（非首个命中即抛），确定性成立。PROBE2 ALL PASS。

### 清单③ — 守卫次序确定性（碰撞 + 形态错误并存 → 形态诊断先出）✅

探针：`/tmp/sa7-i45/probes/probe3-guard-order.mjs`。

- 联合形 ROOT（`YMap<{a}> | YMap<{b}>`）+ 碰撞别名 `PathSchema` 并存 → 抛 `UnsupportedRootShapeError`（`err.code = undefined`，**非**碰撞错误），消息尾串 `见 #44`。
- 对照 1：同联合 ROOT 无碰撞 → 同样 `UnsupportedRootShapeError`（fixture 有效性）。
- 对照 2：合法 map ROOT + 同碰撞别名 → `AliasProtocolExportCollisionError`（守卫本身可达）。
- PROBE3 ALL PASS——ROOT 形态检查先于碰撞守卫，§4.4 位次冻结动态确认。

### 清单④ — CI Test step 触发证据（分支未推远端 → 本地执行如实记录）

推送状态实测（2026-08-21）：`git ls-remote --heads origin fix/issue-45-on-adr-vfsl-protocol` → 空；`git branch -r --contains 1c95341` → 空；`gh run list --branch fix/issue-45-on-adr-vfsl-protocol` → `[]`；`gh pr list --head fix/issue-45-on-adr-vfsl-protocol` → 空。**commit 1c95341 仅存本地，CI run 不存在（非工作流缺陷，是推送状态）。** 按总控指示以本地执行如实记录：

本地等价物（CI `Test` step 命令 = `pnpm test` = `vitest run --typecheck`，基线日志 L1 段）：

```
 ✓ packages/vfsl-codegen/test/generate-protocol-import.test.ts (5 tests) 797ms
 ✓ packages/vfsl-codegen/test/generate-alias-collision-guard.test.ts (4 tests) 455ms
 ✓ packages/vfsl-codegen/test/generate-error-message-tail.test.ts (4 tests) 442ms
 Test Files  27 passed (27)
      Tests  421 passed (421)
Type Errors  no errors
```

推送后总控/SA3 应执行（`ci.yml` job `test`，matrix node 20/24）：

```bash
gh run list --branch fix/issue-45-on-adr-vfsl-protocol --limit 3
gh run view <run-id> --log --job='test (20)' 2>&1 | grep -E "generate-(protocol-import|alias-collision-guard|error-message-tail)|Test Files.*passed" | head -20
```

其余 CI step（`Typecheck` / `Domain scaffolds check` / `Generated projection freshness (regen-diff)`）的本地等价物见 §三基线（全 exit 0）。

### 清单⑤ — 版本 bump 端到端（regen-diff 绿 = @0.1.1 头注无迁移面）✅

四段证据链：

1. **bump 落地**：`git diff 5907dc3 HEAD -- packages/vfsl-codegen/package.json` → `"version": "0.1.0"` → `"0.1.1"`（基线日志 §4 段）。
2. **头注端到端**：探针 4 双域生成物头注实测均含 ` * Generator: @nomicore/vfsl-codegen@0.1.1`（惰性自同步读 package.json，非硬编码）。
3. **regen-diff 绿**：`pnpm generate --check --allow-empty-domains` → `REGEN-EXIT=0`（基线日志 §3 段）。
4. **无迁移面**：`find . -name "generated.ts" -not -path "./node_modules/*"` → **0**（仓内零入仓生成物——即便版本号入头注也无盘上产物需要迁移）。

---

## 二、核心复证（总控点名项）

### N1/N2 — 生成物原样孤立 `tsc --noEmit` 可编译（真实 tsc 二进制差分）✅

探针：`/tmp/sa7-i45/probes/probe4-compile-diff.mjs`。编译选项 `strict/ES2022/ESNext/bundler + paths` 指仓内协议源码（与 SA5 探针 program 同构，但载体换为独立 `tsc --noEmit -p` 进程——与测试的编译器 API 路径互为独立复证）。

**当前 1c95341 侧（治愈）**：
- N1 具名别名域（`ROOT = YMap<{ label; box: Box }>`）+ N2 零别名域（`ROOT = { label: string }`）生成物 + N2 消费方（`import { PathAt, VfslKind } from '@nomicore/vfsl-protocol'` + `PathAt<import('...').VfslPathMap, ['label']>`）同 program：`tsc --noEmit -p` → **exit 0，零输出**——N1 缺 import 治愈 + N2 script 遮蔽治愈且**消费方不被毒化**。
- 文案锚：两域首非注释行均 = `import type { PathSchema } from '@nomicore/vfsl-protocol';`，全文恰一条，无双空行。

**基线 5907dc3 侧（毒化差分 = 探针灵敏度证明）**：基线零别名生成物（头注 @0.1.0、无 import 行）+ 同一消费方 → `exit 2`：

```
consumer.ts(1,10): error TS2305: Module '"@nomicore/vfsl-protocol"' has no exported member 'PathAt'.
consumer.ts(1,18): error TS2305: Module '"@nomicore/vfsl-protocol"' has no exported member 'VfslKind'.
generated.ts(11,12): error TS2304: Cannot find name 'PathSchema'.
```

与 SA5 p2 实证逐码一致（TS2305×2 + TS2304）——探针确能抓到回归，当前零诊断是真实治愈而非探针失明。PROBE4 ALL PASS。

### N3 — 协议导出面 12 名碰撞逐一响亮失败 ✅

探针：`/tmp/sa7-i45/probes/probe5-n3-twelve.mjs`。**名单独立取证**：`grep '^export' packages/vfsl-protocol/src/index.ts` 实测 12 名（`VfslKind, PathSchema, UnknownPath, RootSchema, PathAt, VfslValueOf, PathValue, PathKind, PathPatchValue, PathElementValue, VfslTypedAccess, VfslPathMap`）——不采信冻结名单本身，交叉核对一致。

12 名逐一作碰撞别名（n3 同构 fixture，引用位于 ROOT 字段位）经真实管线：**12/12 全部 throw `AliasProtocolExportCollisionError`，`code = 'alias-protocol-export-collision'`，`aliases = [该名]`，消息含该名**；零静默产出、零 parse/evaluate 层拦截（守卫确在发射层）。PROBE5 ALL PASS（12/12）。

### AC-4 — 三尾串「见 #44」✅

探针：`/tmp/sa7-i45/probes/probe6-tails.mjs`。三条触发路径运行时 `err.message` 实测：

| 错误类 | 触发形态 | 实测 message（尾段） |
|---|---|---|
| `UnsupportedRootShapeError` | 联合形 ROOT | `…需协议层顶层动态键/成员并集语义，见 #44` |
| `UnsupportedRootReferenceError` | 死别名 X 字段引用 ROOT（`type X = YMap<{ r: ROOT }>`） | `…需协议层引用目标语义，见 #44` |
| `UnsupportedUnionKindError` | map×array 异形联合 | `…需协议层 PathKind 联合语义，见 #44` |

三条均 `endsWith('见 #44')` 且不含旧文案「由总控开后续票登记」。CLI 端到端：异形 ROOT 域 `pnpm generate` → exit 2，stderr 尾串 = `见 #44`。PROBE6 ALL PASS。

---

## 三、基线全绿零回归（AC-5）

基线日志：`wiki/raw/task_vfsl-codegen-hardening_sa7_baseline.log`（本报告唯一伴生仓内产物）。

| # | 命令（仓根，独立进程） | 结果 |
|---|---|---|
| 1 | `./node_modules/.bin/vitest run --typecheck`（= CI `Test` step 命令） | **Test Files 27 passed (27) / Tests 421 passed (421) / Type Errors no errors**，EXIT=0（408 既有 + 13 新；SA4 §三#2 同值独立复核吻合） |
| 2 | `pnpm typecheck` | 三包 `tsc -p` 全过，EXIT=0 |
| 3 | `pnpm generate --check --allow-empty-domains`（= CI regen-diff step 命令） | EXIT=0 |
| 4 | `git status --short`（探针全程后） | 源码零改动；新增仅本报告 + 基线日志（探针全部落 `/tmp/sa7-i45/`，仓内零写入达成） |

---

## 四、Spec 触发证据 (verdict 升级 — 2026-06-09)

**N/A** —— 本任务设计与 diff 均无任何 `*.spec.ts` 文件（`find . -name '*.spec.ts' -not -path './node_modules/*'` → 空；与 SA4 §1.3 静态结论一致）。门禁不触发。

## 五、vitest 触发证据 (verdict 升级 — 2026-06-15)

设计含新增 `*.test.ts`（3 文件 + 1 共享辅助）→ 本段必填。Workspace package = **`@nomicore/vfsl-codegen`**（`packages/vfsl-codegen/package.json` name 字段；根 `vitest.config.ts` `include: ['packages/*/test/**/*.test.ts']` 覆盖）。

**CI Run: 不存在**——分支 `fix/issue-45-on-adr-vfsl-protocol` 未推远端（§清单④四重实证）。下表「CI Step」栏如实标注；本地执行（CI `Test` step 同命令）为当前可得证据：

| Workspace Package | CI Step Name | 触发结果 | log 摘录（本地 `vitest run --typecheck`，= CI `pnpm test`） |
|---|---|---|---|
| @nomicore/vfsl-codegen | `Test`（`pnpm test`，matrix node 20/24） | ✓ 本地触发且通过（13 tests：5/4/4）；**CI 侧待推送后确认** | `✓ packages/vfsl-codegen/test/generate-protocol-import.test.ts (5 tests)`、`✓ packages/vfsl-codegen/test/generate-alias-collision-guard.test.ts (4 tests)`、`✓ packages/vfsl-codegen/test/generate-error-message-tail.test.ts (4 tests)`、`Test Files  27 passed (27)`、`Tests  421 passed (421)`、`Type Errors  no errors` |

**verdict**: ✅ all-vitest-packages-triggered（本地通道：三文件全部出现在 Test Files 列表且全绿；CI 通道因分支未推远端不可得——总控已预授权以本地执行记录，非 `vitest-package-not-triggered`）。推送后按 §清单④ 命令模板补 CI 原文摘录即可闭环。

---

## 六、结论

**verdict: pass。**

- SA6 13 红灯全转绿（3 files / 13 tests / EXIT=0）。
- SA4 动态审核重点 5 项全部实证：① `--check` 0→2 双侧差分（基线副本 exit 0 → 当前 exit 2 + `[alias-protocol-export-collision]` + 失败零写盘）；② 多重碰撞一次全列且序 = 声明序（三序互异 fixture 判定）；③ 碰撞 + 形态错误并存 → `UnsupportedRootShapeError` 先出（双对照确认守卫可达）；④ CI 证据因分支未推远端以本地执行如实记录（附推送后命令模板）；⑤ 版本 bump 四段证据链（diff 0.1.0→0.1.1 / 头注 @0.1.1 / regen-diff exit 0 / 仓内零生成物无迁移面）。
- 核心复证全过：N1/N2 真实 tsc 孤立编译零诊断（含零别名域消费方不毒化，基线差分 TS2305×2+TS2304 证明探针灵敏度）；N3 十二名（grep 独立取证）逐一响亮失败；三尾串 `见 #44` + CLI 端到端；基线 27 files / 421 tests 全绿零回归。
- 探针纪律：全部 `/tmp` hermetic（`/tmp/sa7-i45/`），仓内零写入，无端口/服务，无生产代码改动。

无需退回 SA3。唯一后续动作（非阻断）：分支推送后补 CI `Test` step 原文摘录（§清单④模板）；SA1 v1.2 文档债（SA4 回流项，非 SA7 范围）。
