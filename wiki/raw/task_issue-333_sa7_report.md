# SA7 最终动态验证报告 — issue #333（T0：readData 成功分支形状断言 helper 化 prefactor）

- 验证角色：SA7（Dynamic Verifier，final-verification 轮，iteration 0）
- 验证焦点（dispatch 指派）：**SA6 C2.3 M1/M2 突变敏感性、还原洁净度、收敛门、相关 test-only 验收行为**；不做一般设计评审、不扩大交付范围（临时探针全部还原）
- 上游 verdict 链：SA6 契约 approve → SA2 评审 approve → SA3 实现 → SA4 静态审查 **approve**（本报告在其上独立动态验证；SA7 只能在 SA4 pass 基础上独立发现 fail）
- 仓库 / worktree：`welltop-jim-wang/nomicore` @ `/home/wangjian/nomicore-fix-issue-333`，分支 `mabf/issue-333`，base `ba11f32`（实现未提交：10 `M` 测试文件 + 1 新增 `??` helper + SA6 仪器两文件未跟踪）
- Owner feedback：无适用评论（dispatch 记录 REST comment read 返回空数组；SA6 §2 / SA2 / SA3 / SA4 四方同证）

**Verdict：`approve`**（全部焦点项通过；M1/M2 突变敏感性逐点复现、探针还原逐字节洁净、门 20/20、验收行为面全绿；详见各节）。

---

## 1. Inputs

| 输入 | 状态 | 用途 |
|---|---|---|
| `wiki/raw/task_issue-333.md` | 在场 | AC1–AC3（收敛 / 语义零变化 / 零生产变更） |
| `wiki/raw/task_issue-333_design.md` | 在场 | §8.6 数据流路线表（本报告 Changed/Preserved 表的对照基准）、§11 验证映射 |
| `wiki/raw/task_issue-333_sa6_contract.md` | 在场 | §9 M1/M2 探针规格、§12.2 C1a/C1b/C2.1–C2.4/C3a–C3c 验收条款 |
| `wiki/raw/task_issue-333_sa3_impl.md` | 在场 | 实现自跑证据（用于独立复现对照，不作为本报告证据） |
| `wiki/raw/task_issue-333_sa4_review.md` | 在场 | §11「后续动态验证项」清单（本报告逐项执行）；SA4 verdict = approve |
| SA8 产物（`_relevant_decisions.md` / `_conflict_report.md`） | 不存在 | 三方（SA6/SA2/SA4）同证；无协议边界需要额外锚定 |
| 实现源码 | SA7 独立运行 | 全部动态证据由本报告命令独立产生（见 §10） |

## 2. Runtime environment

| 项 | 值 |
|---|---|
| node / pnpm / vitest / typescript | v24.13.0 / 10.28.2 / 3.2.7 / 5.9.3 |
| 运行入口 | `NODE_OPTIONS=--conditions=nomicore-source npx vitest run [--no-typecheck] <files>`；root `pnpm test` = `vitest run --typecheck` |
| vitest include | `packages/*/test/**/*.test.ts`（+ domains/apps 同式）；`maxWorkers: 1`；typecheck 程序 `tsconfig.typecheck.json`（`packages/*/test/**/*.ts`，含 helper） |
| 验证时工作树 | 恰 10 `M`（全在两测试树）+ `??` helper + `??` SA6 仪器两文件 + `??` wiki 产物（§7 还原复核后 `git status --porcelain` 同形） |

## 3. Changed Data Flow Verification

设计（§8.6）声明：**零运行时数据流变化**；变化的只有测试进程内三条「期望构造 / 替身构造 / 键集断言」路线。逐条动态验证（关键中间跳点 = helper 内部比较点与 vitest diff，非仅最终通过/失败）：

| Route | Design change | Runtime driver | Observed hops | Expected result | Actual result | Verdict |
|---|---|---|---|---|---|---|
| 断言期望（family A，24 站点 → helper 单点） | 站点 `expectReadDataOk(actual, {value, schema})`；期望在 helper L39 **独立内联**构造，不经 `readDataOk` | 基线：C2.1 十二文件；M1 探针：`runtime.ts:486` 追加 `truncated:false, truncations:[]` 后跑 8 套件 | 基线绿；M1 下 hostile-guard 4 处在 `readdata-ok-shape.ts:40` `toStrictEqual` 处红，diff 逐键展示 actual 侧多出 `truncated:false`/`truncations:[]`（期望侧仍恰三键） | 基线绿；形状突变必红（多一键即击穿） | 4 红（T1/T2/T3/局部负控，含 `value:undefined` 键在场用例与四键投影体用例）；还原后绿 | ✅ |
| 替身形状构造（9 制造点 → `readDataOk` 单点） | 5 类 stub + 工厂默认 + 2 内联 override + makeMarkerRuntime 全部经 `readDataOk(v, s)`；每次新鲜普通对象 | 基线：C2.1 十二文件（含 concurrency/shutdown 两制造点套件）；M2 探针：**只改** `readDataOk` L29 函数体追加同两键后跑 registry 五文件 + hostile-guard 对照 | 基线绿；M2 下 registry 五文件 19 处同类断言红（actual=替身五键 vs expected=断言面三键）；**同批 hostile-guard（真实 runtime + helper 断言面）4/4 绿** | M2 ≥19 红（11/2/2/1/3）；断言面若从构造面派生则全绿=伪绿 | **恰 19 红**（idle 11 / open 2 / create 2 / sa7-hostile 1 / sa7-rev1 3）；hostile 对照绿 → 反伪绿分离动态成立；还原后绿 | ✅ |
| 键集断言（family B，3 站点 → helper 单点） | `expectReadDataOkKeys(actual)` → `Object.keys().sort()` 深等 `READDATA_OK_KEYS` 常量 | 基线：C2.1；M1 探针同上 | 基线绿；M1 下 `projection-red:103` 与 `docs-sync-control` 行为锚在 `readdata-ok-shape.ts:45` 处红，diff 显示键集多出 `truncated`/`truncations` 两元素 | 基线绿；五键键集必红 | 2 红（red 1B + docs-sync 1B）；还原后绿 | ✅ |

M1 证据样例（vitest diff，actual 侧独增两键、期望侧恰三键）：

```
@@ -7,7 +7,9 @@      (hostile-guard 局部负控, 经 expectReadDataOk)
+   "truncated": false,
+   "truncations": [],
@@ (projection-red 空路径, 经 expectReadDataOkKeys)
  expected [ 'ok', 'schema', 'truncated', …(2) ] to strictly equal [ 'ok', 'schema', 'value' ]
```

M2 证据样例（registry 行为断言红 = 替身五键 vs 断言面独立三键期望）：`Test Files 5 failed | 1 passed (6) / Tests 19 failed | 94 passed (113)`，19 红分布 11/2/2/1/3 与 SA6 §9 M2 逐文件一致。

## 4. Preserved Data Flow Verification

设计声明不变的路线（§1 非目标 + §8.6「无运行时数据流变化」），验证其保持不变：

| Route | Preserved invariant | Runtime driver | Baseline observation | Current observation | Verdict |
|---|---|---|---|---|---|
| 生产 readData 路径 | `runtime.ts:474-487` 逐字节不变（L486 成功字面量三键；失败分支不带 schema 键；lifecycle gate 前置） | `git diff -- packages/namespace-runtime/src/runtime.ts`（探针还原后） | pristine（SA6 §4 基线 189 绿） | **diff 空**；L486 原文在；M1 探针施加即红、还原即绿（同一入口判定可逆） | ✅ |
| doc-runtime 两键成功分支 | `{ ok, value }`（ADR-0016 分层）零触碰 | `git diff -- packages/doc-runtime` + 全量 `pnpm test` | 基线绿 | diff 空；全量 339/3608 绿 | ✅ |
| 加法兼容负控（C2.4） | `runtime-readdata-schema-projection-control.test.ts` 的 `toMatchObject`/分字段断言零改动、保持绿 | `git diff` + 套件运行 | 基线 6 tests 绿 | **零 diff**（`toMatchObject` 8 处原样）；6 tests 绿 | ✅ |
| red 文件窄接口/预言机（C2.4） | `readOk`/`oracle`/`PROJ`/分字段断言零改动 | diff 审查（本报告 §1 输入阶段逐 hunk 复核） | 基线 15 tests 绿 | diff 仅 import 行 + L103 一处键集改写；15 tests 绿 | ✅ |
| registry 行为面 | lease.readData 透传、idle/close/reopen 状态行为不变 | C2.1 十二文件 + 全量 | 基线 178（10 文件 162 + 两制造点套件 16） | 12 文件 178 tests 绿；全量含 registry 全部套件绿 | ✅ |
| 公共面/类型面锚（C3b） | 公共导出面与 3 个 test-d 类型锚零变化 | `npx vitest run --typecheck`（name 过滤 3 test-d）+ 全量内 4 个公共面套件 | 基线绿 | 3 文件 / 5 tests 绿，`Type Errors: no errors`；公共面 4 套件在全量中绿 | ✅ |

## 5. State Machine Verification

本任务零生产状态机变化（零 src diff，§4）。与验收相关的「状态机」是**探针生命周期**与 readData 生命周期门（既有）：

| Initial state | Trigger | Expected transitions | Observed transitions | Forbidden transitions absent | Verdict |
|---|---|---|---|---|---|
| 全绿验收态 | M1 探针施加（生产成功分支 +2 键） | 恰 6 红（hostile 4A + red 1B + docs-sync 1B），registry 5 文件保持绿（钉的是替身） | 恰 6 红 / 143 绿（8 套件 149 tests）；registry 5 文件全绿 | 无意外红（无 helper 误伤其他套件）；无该红不红 | ✅ |
| M1 红态 | 探针还原（`cp` 备份回写） | 全绿恢复；`runtime.ts` diff 空 | 13 文件 / 198 tests 全绿；diff 空、L486 原文 | 禁止：还原后仍红（旧路径复活）或残留突变 | ✅ |
| 全绿验收态 | M2 探针施加（**仅** `readDataOk` L29 函数体 +2 键） | registry 五文件 ≥19 红；断言面（真实 runtime 路线）不受影响 | 恰 19 红 / 94 绿 + hostile-guard 4/4 绿 | 禁止：全绿（= 断言面从构造面派生，伪绿）；未出现 | ✅ |
| M2 红态 | 探针还原 | 全绿恢复；helper 与备份逐字节相同 | `diff` = IDENTICAL；gate 20/20 + 12 文件 178 绿（合计 198） | 禁止：还原后仍红或字节漂移；未出现 | ✅ |
| readData 生命周期门（既有） | ready / closing / closed 期读取 | ready=三键组合；非 ready=联合拒绝（无 schema 键） | hostile/projection 套件全绿（含失败分支断言）；全量绿 | 禁止态未出现（本任务未触碰该路径） | ✅ |

## 6. Error and Cleanup Flow

- **错误语义**：helper 失败 = vitest `toStrictEqual` throw + 逐键 diff（§3 样例：多出的 `truncated`/`truncations` 在 diff 中逐键可见）——失败帧指向 `readdata-ok-shape.ts:40/45`，测试名定位站点；无吞错、无 fallback、无静默通过路径。`ok:false` 结果在 `ok:true` 期望下必红（失败分支断言在既有套件中保持绿证明未误伤）。
- **探针清理（本报告核心焦点之一）**：
  1. M1：施加前 `cp runtime.ts /tmp/sa7-m1-runtime.ts.bak`；还原 `cp` 回写；复核 = `git diff -- src/runtime.ts` **空** + `diff` 备份 **IDENTICAL** + L486 原文回显。
  2. M2：施加前 `cp readdata-ok-shape.ts /tmp/sa7-m2-readdata-ok-shape.ts.bak`；还原后 `diff` **IDENTICAL**、L29 原文回显。
  3. 残留扫描：`grep -rn "truncated\|truncations" packages/namespace-runtime/test packages/namespace-registry/test packages/namespace-runtime/src` → **NONE**（探针不复活、无失败后残留）。
  4. `git status --porcelain` 还原后与验证前同形（10 `M` + 3 `??` 测试产物 + wiki 产物；无新增/丢失文件）。
- **收尾复跑**：还原后 gate + 12 文件 = **13 文件 / 198 tests 全绿**（移除探针后结果与基线一致）。
- **全量 quiescence**：`pnpm test` 602.10s 自然结束 exit 0，无悬挂进程/后台服务（本报告未启动任何服务、未占用端口）。

## 7. Temporary Diagnostics

**未添加任何临时日志。** 依据动态日志协议：现有 vitest 断言 diff（逐键中间值）、扫描器输出（`scanReadDataShapeAssertions()`）、git diff 与测试结果已足以观察全部关键跳点，无需 `[SA7-DATAFLOW]` 日志。

| 项 | 记录 |
|---|---|
| 添加项 | 0（无） |
| 删除项 | 0（无） |
| Post-removal 验证 | `git diff \| grep -c "SA7-DATAFLOW"` = 0；树内 grep 无标记 |
| 工作树外临时文件 | `/tmp/sa7-m1-runtime.ts.bak`、`/tmp/sa7-m2-readdata-ok-shape.ts.bak`、`/tmp/sa7-producer-scan.ts`、`/tmp/sa7-fulltest.log`、`/tmp/sa7-typecheck.log`（worktree 外，不进入提交与 artifactPaths） |

## 8. Dynamic Evidence Matrix

| Source | Requirement or risk | Driver | Expected | Actual | Evidence | Result | Suggested routing |
|---|---|---|---|---|---|---|---|
| SA6 C2.3 | M1 生产突变敏感性：收敛后仍红 | `runtime.ts:486` +2 键 → 8 套件 | 6 红（4A+1B+1B）；registry 5 绿 | 恰 6 红 / 143 绿；分布逐文件吻合 | §3/§10 命令 4 及 diff 样例 | ✅ | — |
| SA6 C2.3 | M2 替身突变敏感性 + 反伪绿 | 仅 `readDataOk` L29 +2 键 → registry 5 文件 + hostile 对照 | ≥19 红（11/2/2/1/3）；若断言面派生自构造面则全绿=伪绿 | 恰 19 红；hostile 4/4 绿（对照） | §3/§10 命令 5 | ✅ | — |
| SA6 C2.3 / SA4 §8 | 探针还原洁净度 | `cp` 回写 + diff + git diff + grep 残留 | 逐字节还原、零残留、状态同形 | IDENTICAL ×2；diff 空；grep NONE；status 同形 | §6/§10 命令 6/8 | ✅ | — |
| SA6 C1a/C1b | 收敛门归零 | `vitest run --no-typecheck readdata-shape-assertion-consolidation` | 20/20 绿（含 7 正/8 负自控 + 作用域覆盖） | 20/20 绿（5ms） | §10 命令 2 | ✅ | — |
| SA6 AC1 括号 | 生产者集中化（报告项） | `scanReadDataShapeAssertions()`（/tmp 脚本直跑扫描器，零树内改动） | 站点制造点 0；helper 内恰 2（L29/L39，均非断言实参） | assertionSites 0 / producers 2（filesScanned 110） | §10 命令 3 | ✅ | — |
| SA6 C2.1/C3c | 行为零变化 + 门禁 | C2.1 十二文件；`pnpm typecheck`；`pnpm test` | 178 绿；exit 0；339/3608 绿 | 178 绿；exit 0；**339 files / 3608 tests / no type errors / exit 0**（602s） | §10 命令 1/9/10 | ✅ | — |
| SA6 C2.4 | 反向边界不收紧 | control 文件 diff + 运行 | 零 diff、6 绿、toMatchObject 原样 | 零 diff；8 处 toMatchObject 原样；6 绿 | §10 命令 7 | ✅ | — |
| SA6 C3a | 零生产/公共类型变化 | 两条范围门命令 | 均空 | 均空（grep exit 1 = 无越界行） | §10 命令 7 | ✅ | — |
| SA6 C3b | 类型面锚 | `vitest run --typecheck`（3 test-d） | 5 绿、no errors | 3 文件 / 5 tests 绿、`Type Errors: no errors` | §10 命令 9 | ✅ | — |
| Design §8.6 | 三条 test 内路线按设计变化 | 见 §3 | 见 §3 | 全部按设计 | §3 | ✅ | — |
| Design §8.4 | `toStrictEqual` 判定等价（含显式 undefined 键用例） | C2.1 内 hostile L61/L69 用例 + M1 红态 | 用例维持原判定；突变下红 | 基线绿 / M1 红（判定方向一致） | §3/§10 命令 1/4 | ✅ | — |

额外 finding：无。（全部观察与 SA6/SA4/设计预期一致，无需扩大验证范围。）

## 9. Verdict

**`approve`。** 依据：

1. C2.3 M1：恰 6 红（4A+1B+1B，逐文件吻合），registry 5 文件同批绿（区分钉生产/钉替身）——收敛后生产形状突变仍被断言面击穿。
2. C2.3 M2：恰 19 红（11/2/2/1/3），且 hostile 对照绿——断言面期望与构造面**动态证明互不派生**（伪绿结构不可达）。
3. 还原洁净度：两探针逐字节还原（diff IDENTICAL）、`runtime.ts` git diff 空、`truncated/truncations` 残留 NONE、git status 与验证前同形、还原后 13 文件/198 tests 复跑全绿（无复活）。
4. 收敛门 20/20 绿（C1a/C1b 归零 + 仪器 7 正/8 负自控 + 作用域覆盖）；生产者扫描站点 0 / helper 内恰 2。
5. 验收行为面：C2.1 十二文件 178 绿；C2.4 control 零 diff 且绿；C3b 3 test-d 5 绿 no errors；C3a 两条范围门空；`pnpm typecheck` exit 0；`pnpm test` 339/3608 全绿 exit 0（与 SA3 报告口径逐项一致）。
6. 临时诊断：未添加（无需）；无 `[SA7-DATAFLOW]` 残留。

无拒绝条件命中：关键跳点值与事实源全部按设计；不变路线（生产 readData、doc-runtime、负控、公共面）零变化；探针生命周期状态序正确且禁止态（还原后残留红/伪绿）未出现。

## 10. Commands and Evidence

| # | 命令（均可复跑；入口同 SA6 §4） | 结果 |
|---|---|---|
| 1 | `NODE_OPTIONS=--conditions=nomicore-source npx vitest run --no-typecheck <C2.1 十二文件>` | `Test Files 12 passed (12) / Tests 178 passed (178)` |
| 2 | `… npx vitest run --no-typecheck readdata-shape-assertion-consolidation` | `1 passed (1) / 20 passed (20)`（5ms） |
| 3 | `… npx tsx /tmp/sa7-producer-scan.ts`（import `scanReadDataShapeAssertions()`） | `filesScanned 110 / assertionSiteCount 0 / producerSiteCount 2`（均在 `readdata-ok-shape.ts` L29/L39，`isAssertionArgument:false`） |
| 4 | M1：`cp` 备份 → `runtime.ts:486` 追加 `, truncated: false, truncations: []` → 同入口跑 8 套件 | `3 failed \| 5 passed (8) / 6 failed \| 143 passed (149)`；红 = hostile T1/T2/T3/局部负控 + red 空路径 + docs-sync 行为锚 |
| 5 | M2：`cp` 备份 → `readData-ok-shape.ts:29` 改为 `{ ok: true, value, schema, truncated: false, truncations: [] }` → registry 五文件 + hostile-guard | `5 failed \| 1 passed (6) / 19 failed \| 94 passed (113)`；红分布 idle 11 / open 2 / create 2 / sa7-hostile 1 / sa7-rev1 3；hostile 4/4 绿 |
| 6 | 还原：`cp` 两备份回写 | `diff` IDENTICAL ×2；`git diff -- src/runtime.ts` 空；L486/L29 原文回显 |
| 7 | 范围/边界：`git diff --name-only -- <control> / '*.test-d.ts' / 'packages/*/src' 'domains' 'apps' 'docs'`；`git diff --name-only \| grep -vE '^packages/(namespace-runtime\|namespace-registry)/test/'`；`grep -c toMatchObject <control>`；`grep -rn "truncated\|truncations" <两树+src>` | 全部空/NONE；toMatchObject=8；残留 NONE |
| 8 | 收尾复跑：gate + 十二文件 | `13 passed (13) / 198 passed (198)` |
| 9 | `… npx vitest run --typecheck runtime-data-interface runtime-readdata-schema-red registry-readdata-schema-red`；`pnpm typecheck` | 3 文件 / 5 tests 绿 + `Type Errors: no errors`；`TYPECHECK_EXIT=0` |
| 10 | `… pnpm test`（root 全量，= `vitest run --typecheck`） | `Test Files 339 passed (339) / Tests 3608 passed (3608) / Type Errors no errors`，Duration 602.10s，`FULLTEST_EXIT=0`（日志 `/tmp/sa7-fulltest.log`） |

对照口径：pristine 基线 338 文件/3588 tests（不含门）+ 门 20 tests = 339/3608，与本轮实测一致（SA2-O3 口径）。

## 11. Deviations

- **无偏差。** 全部焦点项按 SA6 §12.2 / SA4 §11 / 设计 §11 的预期复现，计数逐文件吻合。
- 未新增任何测试/fixture/日志（动态证据完全来自既有仪器与套件；唯一树外脚本 `/tmp/sa7-producer-scan.ts` 为扫描器直跑载体，worktree 外）。
- 未修改生产代码（M1 探针已逐字节还原并复核）；未修改 SA6 仪器、control 负控、test-d 锚。
- requiresConflictRecheck：**false**（零协议/公共面/ADR 冻结面变化；探针已还原）。
