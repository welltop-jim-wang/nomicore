# SA4 静态验尸报告

**Date**: 2026-08-19
**Verdict**: reject（**唯一阻断项 = 文件清单 BLACKLIST 违规：`TASK.md` 进入了分支 diff**，源自 commit 51bd63e 而非 SA3 实现提交 e73eeef。实现本体的全部技术门禁均通过——回滚 TASK.md 后无需重攻实现，复审为形式性确认）

**审查对象**: commit `e73eeef`（SA3 实现）+ 分支 diff（base = `origin/adr/union-representation` = 6b93d79，即 `mabf.base-branch` 配置值与 merge-base；注意 `mabf.basebranch` 键为空，SKILL §1.1/§1.4 两条辅助命令取键不一致，本审查以任务简报声明的 base 为准）
**输入**: 任务简报 + SA1 设计 R2 稿 + SA2 R1/R2 评审 + SA6 红灯测试（37 条）+ ADR 0003 + spec §2/§3/§10 + `ir.ts`/`errors.ts`/`parser.ts`/`shapes.ts`/`index.ts` 源码核对 + 亲测（typecheck / vitest 全量 / parseOk 探针）

---

## 审核结论

1. 设计一致性：✅ 一致（1 个 NOTE 级偏离，见 §「设计偏离明细」#N1；不影响 ok 模块行为）
2. 读写路径一致性：✅ 一致（纯函数 IR → 派生物，无数据源分叉；索引行与树共享对象引用为设计 §7.1/§8.3 显式选择）
3. 静默失败：✅ 无（一切内部异常 → 顶层 catch → `ok:false` E100，与 parseVfsl §15.4 逐项同款；N1 为不可达输入的非 loud 分支，NOTE 级）
4. 降级方案：✅ 安全（E100 为设计内崩溃边界、非虚假降级；`makeIssue(ErrCode.E100, …, 1, 1)` 产出 `VFSL-E100: 内部错误（意外异常）: <detail>` 与 index.ts:62-71 内联构造逐字符同源——已对照 errors.ts:36-38 实测）
5. 极端攻击：✅ 未发现可静态确认的实现漏洞（手造 IR 五类攻击全部 loud；1 个时间复杂度观察项交 SA7，见动态审核重点 #2）
6. 错误处理：✅ 完整（重名/环/缺席/非 map 形/非 string 键全表覆盖，§9 I1~I6 处置逐项在实现中落实）
7. 架构评估：✅ 可行（无绕约束、无 FIXME/TODO、无临时补丁——三新文件 grep 零命中）
8. 过度设计：✅ 精简（evaluate.ts 322 行 vs 设计 §10 预估 ≤320——估计噪声内；computeCls 帧栈为设计指定的 shapes.ts 算法模式）

---

## R1. 文件清单 Scope Creep Guard（阻断项所在）

**ALLOW LIST 抽取**（设计 §12）：`packages/vfsl/src/derived.ts`、`resolve.ts`、`evaluate.ts`、`index.ts`、`package.json`、`test/evaluate-derived-schema.test.ts`（SA6 owned，限基础设施级修正 + 须 PR 说明）。

**Actual diff**（base..HEAD，11 文件）：

| 文件 | 判定 |
|---|---|
| `packages/vfsl/src/derived.ts` / `resolve.ts` / `evaluate.ts` | ✅ ALLOW（新建） |
| `packages/vfsl/src/index.ts` | ✅ ALLOW（修改：头注释 + re-export，`parseVfsl` 函数体逐字节未动） |
| `packages/vfsl/package.json` | ✅ ALLOW（恰 1 行：`0.1.4 → 0.1.5`，简报强制项） |
| `packages/vfsl/test/evaluate-derived-schema.test.ts` | ✅ ALLOW（见 R2 合规复核） |
| `wiki/raw/task_vfsl-evaluator{,_design,_dispatch,_sa2_review}.md` | ✅ 白名单豁免（`^wiki/raw/task_`） |
| **`TASK.md`** | ❌ **BLACKLIST 违规**（`^TASK\.md$`，P0 立法） |

### ❌ REJECT-1：`verdict: blacklist-violation` — TASK.md 进入分支 diff

- **证据**：`git log origin/adr/union-representation..HEAD -- TASK.md` → **commit 51bd63e**（SA1 设计文档提交）。内容从 base 的 issue #8 运行时残留被复写为 issue #20 任务内容——**与 PR #253（issue #248）事故同型**：issue-runner runtime 文件被上一任务 commit 后被本任务复写携带。
- **非 SA3 之过但须 SA3（或分支所有者）修复**：SA3 提交 e73eeef 的 stat 仅含 6 个 ALLOW 文件，本身干净。
- **影响**：PR 将携带 runtime 文件的跨任务内容漂移；BLACKLIST 立法明文「一旦出现在 diff 里就 REJECT，不论是否在 ALLOW LIST」。
- **回流目标**：SA3（经总控）。修复 = 让分支不再触碰该文件：
  ```bash
  git -C <worktree> restore --source=origin/adr/union-representation TASK.md
  git -C <worktree> commit -m "chore: revert TASK.md runtime file (blacklist)"
  ```
  （或将 51bd63e 中 TASK.md hunk rebase 剔除。）`.gitignore` 化属仓库级决策，不在本任务 ALLOW LIST 内，不得顺带做。
- **附带提醒**：工作树尚有未提交的 `wiki/raw/task_vfsl-evaluator_dispatch.md` 修改与未跟踪 `.mabf-bg/`——均不得进 PR commit（前者由总控流水线自行处置，后者为运行时目录）。

**DENY LIST 核对**：`parser.ts`/`tokenizer.ts`/`semantic.ts`/`shapes.ts`/`ir.ts`/`errors.ts`/`parse-*.test.ts`（9 文件）/`docs/**`/tsconfig/pnpm-workspace —— actual diff 零命中 ✅（`errors.ts` 仅被 import 引用，零改动，符合 §12 澄清）。其余 BLACKLIST 模式（package-lock.json / yarn.lock / .DS_Store / *.bak）零命中 ✅。

## R2. 测试文件改动合规复核（设计 §12「SA6 owned」条款 + 总控提示项）

SA3 对 `evaluate-derived-schema.test.ts` 的改动 = **仅 `parseOk` 返回类型注解**（e73eeef diff 全量核对：函数体逐字节未动，断言逻辑零变更），commit message 中按条款要求作了 PR 说明。**结论：合规。**

注解修正的必要性经**探针实证**（临时文件 `packages/vfsl/test/zz-sa4-probe.ts`，以 e73eeef^ 原注解逐字形式包裹 HEAD 的 `parseVfsl` 跑 `tsc -p`，已删除）：

| 论断 | 证据 | 结论 |
|---|---|---|
| 原注解恒解析为 `never` | `type IsNever<T> = [T] extends [never] ? true; const oldIsNever: IsNever<OldParseOk> = true` → **无错**（若非 never 必报 TS2322）；且 `return result.module` 报 **TS2322: Type 'VfslModule' is not assignable to type 'never'** | ✅ 成立——SA6 记录的基线「一条级联 TS2322」即此处，**与 evaluate 导出无关**（HEAD src 上仍复现） |
| 新注解解析为 `VfslModule` | `Eq<NewParseOk, VfslModule> = true` 型断言 → 无错（双向相等） | ✅ 成立 |
| 不修则 typecheck 不可能绿 | 上述 TS2322 在 HEAD src + 原注解下持续存在（tsc exit 2 亲测） | ✅ 修正为实现 AC（typecheck 由红转绿）所必需 |

**版本 bump 复核**：`package.json` 恰 1 行 `0.1.4 → 0.1.5`，与 §12 ALLOW LIST 行逐字对应（「版本 0.1.4 → 0.1.5（1 行）」）✅。

## R3. §1.4 vitest 触发性自检（总控提示项，结论：**pass**）

- 设计涉及的 `*.test.ts`：`packages/vfsl/test/evaluate-derived-schema.test.ts`（本任务分支含新增，commit 6782608 + e73eeef 修正）。
- Runner 链路实测：根 `package.json` `"test": "vitest run"` → 根 `vitest.config.ts` `include: ['packages/*/test/**/*.test.ts']` → **该文件被 glob 覆盖**（`packages/vfsl/test/**` 命中；根级统一 vitest，无 per-package --filter 需求）。
- CI 接通：`.github/workflows/ci.yml`（`on: pull_request`，matrix node 20/24）Test step = `pnpm test`，Typecheck step = `pnpm typecheck`（= `tsc -p packages/vfsl/tsconfig.json`，include `src/**` + `test/**`，同样覆盖该测试文件）。
- **判定**：`vitest-package-not-triggered` 不成立，无未接通 workspace package。SA7 请从 `gh run view --log` 摘录该文件的 37 条执行证据（SKILL §1.4 联动要求）。
- §1.3 E2E spec 触发性：diff 无 `*.spec.ts` → N/A。

## R4. 其余立法门禁

- **§1.5 协议假设**：设计 §13 在场且「无协议级假设」与代码事实相符（纯函数库 + 类型定义，零 IO）；实现未引入任何网络/进程/第三方库行为。✅ pass。
- **§1.6 契约改动连锁**：零契约改动——`parseVfsl` 函数体未动（diff 仅注释 + re-export），`evaluate` 为新导出、仓内 caller 唯一 = SA6 测试（grep apps/packages/tests 零其余命中）。✅ pass。
- **§1.7 源码 GREP 断言禁令**：测试文件无 `readFileSync`（grep 零命中）；`serialized.match(/"kind":"ref"/g)` 等作用于 `JSON.stringify(derived)` 的**运行时输出**，非源码文本。✅ pass。

## R5. 设计偏离明细（逐条对照 R2 设计稿）

全量对照结果：§4.1 全景表 11 行、§4.2 三解析点 + F4 分流（`isNoChildTerminal`/`terminalOf` 判别集与设计逐 kind 一致）、§5.2 判别式（首成员字段声明序最先满足 (b)+(c)；byValue 键 `String(字面量)`、插入序 = 声明序；两负例路径在场）、§6 值树（IR 同态永不解析 ref；Record 值位仍 ref 终态——两树不对称正确落地）、§7 索引（path≠null 就地填充、union/ref/终态停、`index['ROOT']` 与树同引用）、§8 确定性（无时钟/随机，插入序全由声明序决定）、§9 I1~I6 loud 处置（重名 seen-Set、环 inFlight、缺席、E304/E306 Internal、ROOT 缺席 TypeError）——**均与设计一致**。resolve.ts 依赖的文法断言「联合成员恒非内联联合」经 parser.ts 255-269 + 括号拒绝（注记 5）实测成立。

- **#N1（NOTE，非阻断）**：`detectDiscriminator` 对**空联合**（`t.members[0] === undefined`）加了返回 `undefined` 的防御分支（evaluate.ts:224）——手造 IR 产出 `ok:true` 的空成员 union 节点，而非设计 §2.2「不为不可能输入写防御分支」纪律下的 loud E100（文法不可能产出空联合：parseUnionType 单成员坍缩、≥2 才成联合）。对 ok 模块零影响、输出结构自洽，不构成静默垃圾派生物的实质风险；建议后续票二选一：删防御分支回归 TypeError→E100，或设计成文接受。SA3 无须本票修改。

## R6. 亲测验证证据

| 项 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `pnpm typecheck`（独立进程） | **exit 0**（基线两条预期红全消，无新增错误） |
| 全量测试 | `pnpm test`（独立进程） | **253/253 passed**（10 文件：evaluate 37 + parse 216，无回归） |
| parseOk 探针 | `tsc -p`（探针已删） | 见 R2 表；删后复跑 typecheck exit 0 |

---

## 动态审核重点（交 SA7）

1. **E100 崩溃边界实弹**：公共面对手造 IR 五例——双 ROOT 重名 / ref 环 / 未声明名 / ROOT 缺席（`aliases: []`）/ `evaluate(null)`——逐例断言 `ok:false`、`issues[0].message` 以 `VFSL-E100:` 起头、line=column=1。静态已核处置路径（SA2 R2 红线构思 #4/#5），运行时确认收编无逃逸。
2. **线性 ref 链求值时间**（SA4 观察项，非性能 AC）：`resolveChain` 无 memo，N 条 `type A_i = A_{i+1}` 链上每别名物化重走全链 → 求值时间 O(N²)（派生物**大小**仍 O(文本)，ADR 0003 §4 的承诺不受影响；设计 §4.3 仅吸收栈安全）。以 parse 侧既有 20k 裸引用链文本（T-l 同型）喂 `parseVfsl → evaluate`，记录耗时；秒级即接受，分钟级上报（后续票可 memo 化链终点，属优化非缺陷）。
3. **Record 值位解析为 map 时的索引续行**：实现对 `Record<string, {x:string}>` 按设计 §7.2 停止表**续行**（`ROOT.m.<key>.x` 行在场）——SA6 未钉死该政策（SA2 R2 观察 3）。运行时经 `resolvePath` 验证查询无歧义即可；建议后续票由 SA6 补一行在场性断言冻结政策。
4. **CI 触发证据摘录**：`gh run view --log` 摘录 evaluate-derived-schema.test.ts 的 37 条执行行 + typecheck step 绿（§1.4/§1.3 联动义务）。
5. **（随 #N1）**空联合手造 IR 的实际输出形态确认（当前 ok:true / 空 members / 无判别式），供 SA1 决策留档。

---

## 裁定

- **Verdict: reject**，标记 `verdict: blacklist-violation`——修复动作唯一且纯 git 卫生级：回滚 `TASK.md`（R1 修复命令）。**SA3 实现本体（e73eeef 的 6 个文件）无任何代码级驳回项**：设计一致性、读写路径、静默失败、降级、错误处理、架构、过度设计八门禁全过，typecheck/test 亲测全绿，SA6 owned 文件改动与版本 bump 合规。
- 回滚 TASK.md 并提交后，SA4 复审仅需 `git diff --name-only <base> HEAD | grep TASK.md` 为空 + 测试仍绿即可翻绿，无需重攻实现。

---

## 【R2 Verdict】（2026-08-19，第 2 轮复审 — 按 R1 复审约定的形式性确认）

**复审范围**：R1 唯一阻断项 REJECT-1（`verdict: blacklist-violation`，TASK.md 进分支 diff）的整改确认。按 R1 文末约定仅验两件事：分支 diff（相对 merge-base `6b93d79`）不再含 TASK.md + 测试仍全绿；**不重攻实现**，R1 八项技术门禁结论原样承继。

### 整改核验（全部通过）

| 核验项 | 命令 | 证据 | 结果 |
|---|---|---|---|
| merge-base 锚定 | `git merge-base HEAD origin/adr/union-representation` | `6b93d79c0dbcd7d9fe479da61171e179ac279c85` | ✅ 与 R1 审查 base 一致 |
| diff 不含 TASK.md | `git diff --name-only 6b93d79 HEAD` \| `grep -c '^TASK\.md$'` | 11 文件清单，**0 命中** | ✅ |
| TASK.md 内容还原 | `git diff 6b93d79 HEAD -- TASK.md` \| `wc -c` | **0 字节**（还原至 base 内容，非仅移出清单） | ✅ |
| 回滚 commit 纯度 | `git show --stat 9e10a95` | 仅触 `TASK.md`（10+/16−），无夹带其他文件 | ✅ |
| 全量 BLACKLIST 扫描 | 五模式（package-lock / yarn.lock / .DS_Store / `^TASK\.md$` / `*.bak`）逐模式扫 actual diff | 零命中 | ✅ |
| 工作树卫生 | `git status --porcelain` | 仅未跟踪 `.mabf-bg/`（运行时目录，不在任何 commit）；TASK.md 工作树 == HEAD | ✅ |
| 文件清单复核 | actual 11 文件 vs R1 ALLOW 表 | 6 ALLOW + 5 `^wiki/raw/task_` 白名单，与 R1 表逐行同（唯一差异 = TASK.md 移除），无新 creep | ✅ |
| 类型检查 | `pnpm typecheck`（setsid 独立进程） | **exit 0** | ✅ |
| 全量测试 | `pnpm test`（setsid 独立进程） | **exit 0，253/253 passed**（10 文件：evaluate 37 + parse 216，与 R1 基线全等，零回归） | ✅ |

**R1 附带提醒落实**：R1 指出的未提交 dispatch.md 修改已由 7763ea1 / cec81a0 收编为 wiki 提交；`.mabf-bg/` 维持未跟踪，未进任何 commit。

**Verdict**: **pass**

- REJECT-1 的唯一修复动作（回滚 TASK.md）已由 commit 9e10a95 等价落实（文件级、无夹带），分支 diff（6b93d79..HEAD）不再触碰 TASK.md，BLACKLIST 违规消除。
- typecheck / 全量测试双绿，与 R1 亲测基线全等——实现本体（e73eeef 六文件）自 R1 以来零改动，符合「无需重攻」前提。
- R1 全部技术门禁结论（设计一致性 / 读写路径 / 静默失败 / 降级 / 极端攻击 / 错误处理 / 架构 / 过度设计八项 ✅）与「动态审核重点」5 条清单**原样承继**，SA7 可按此进入动态验证（含 `gh run view --log` 的 37 条执行证据摘录义务）。
- #N1（空联合防御分支，NOTE 级）维持不阻断裁定，留后续票二选一处置。
