# SA4 静态验尸报告（rev2 · Phase 3）

- **Date**: 2026-08-22
- **Reviewer**: SA4（Red Team Hacker，静态绿光验尸）
- **被审对象**: SA3 实现 commit `0f0b470`（基线 `7f77384` = SA6 红灯锚定入库点）；`packages/doc-runtime/src/read.ts` + `package.json`
- **设计基准**: `wiki/raw/task_read-logical-value-at-path_rev2_design.md`（451 行定稿，SA2 R2 verdict pass）
- **验收输入**: 总控亲跑 `pnpm typecheck` + `pnpm test` 全绿（`.mabf-bg/verify-after-sa3-rev2.log`：60 文件 834 用例、Type Errors no errors）；SA4 另行独立复跑全量（见 §7）
- **Verdict**: **pass**

## 审核结论（总表）

1. 设计一致性：✅ 一致——seam 伪代码（§3.1.2/§3.2.1）逐字落地，无一处偏离（§3）
2. 读写路径一致性：✅ 不适用（纯函数抽取，无数据源；live 读取三处形态零改动，读写闭环不触）
3. 静默失败：✅ 无——union 分支所有路径经 seam 收束三态，顶层两态映射不变；无新增吞错/静默路径
4. 降级方案：✅ 无降级引入——missing 三源为 D8 立法合法语义（SA2 rev2 已裁定非伪降级），本轮零触碰
5. 极端攻击：✅ 安全——空成员 union → reject（与 rev1 循环零次同判）、空 iterable、单成员、throw 上浮路径均逐点等价（§3.3）；未发现可静态确认漏洞
6. 错误处理：✅ 完整——新代码零 try/catch/finally，异常不捕不转沿 rev1 同点同序上浮（§3.3）
7. 架构评估：✅ 可行——INV-15 仲裁单点权威成立（`let sawMissing` 恰 1、聚合唯一经 seam）；无需退回 SA1
8. 过度设计：✅ 精简——~60 行 delta（含 JSDoc）恰为 owner 建议形态逐字兑付，无多余抽象层

**五项重点义务（总控指定）全部执行完毕，逐项证据见 §1–§7。**

---

## §1. §3.2.3 静态门禁四命令原样复跑 + 阴性对照抽查

**四命令（原样复跑，worktree HEAD = 0f0b470，f=packages/doc-runtime/src/read.ts）：**

| # | 命令 | 预期 | 实测 | 判定 |
|---|---|---|---|---|
| 1 | 三 span（seam 块/generator 块/`case 'union':`…`case 'leaf':`）注释剥离后 `grep -nE 'Array\.from\|\.map\(\|\[\.\.\.'` | 零命中（exit=1） | **exit=1 零命中**；span1=8 行、span2=13 行、span3=14 行（Phase A `decide` + Phase B `navigate` 双 union 块，与设计口径说明 (i) 及 SA2 mock 实测 14 行吻合） | ✅ |
| 2 | `grep -cE 'function\*[[:space:]]+memberOutcomes' $f` | 恰 1 | **1**（L313 定义） | ✅ |
| 3 | `grep -n 'memberOutcomes' $f` | 恰 2 行（定义 + 直接实参调用） | **恰 2 行**：L313 定义 + L408 `return arbitrateUnion(memberOutcomes(node, live, segs, i, resolveS, fullPath, memo));` | ✅ |
| 4 | `grep -c 'let sawMissing' $f` | 恰 1（INV-15 无第二仲裁实现） | **1**（L297，arbitrateUnion 体内） | ✅ |

**阴性对照抽查（全部在 `/tmp/sa4-negctl/` 副本上构造，worktree 生产代码零触碰）：**

| 对照 | 构造的违规形态 | 结果 | 判定 |
|---|---|---|---|
| (a) | M-C 物化变异：seam 内 `const arr = Array.from(outcomes)` 后循环 arr | 命令 1 命中（`Array.from` 行） | ✅ 捕获 |
| (b) | eager-helper 漂移：`memberOutcomes` 改普通函数体内 `out.push(resolveLive(…))` 返回数组（区域内零禁形 token——SA2 R1 缺陷 #1(b) 精确复现形态） | 命令 1 **确实零命中**（与设计预期缺口一致）但**命令 2 = 0 捕获**（`function*` 形态锁） | ✅ 组合捕获 |
| (c) | 调用点物化：`arbitrateUnion(Array.from(memberOutcomes(…)))` 包裹 | 命令 1 经 span3 命中 | ✅ 捕获 |
| (d) | 第二仲裁实现：union 分支内再声明一个 `let sawMissing` | 命令 4 = 2 捕获 | ✅ 捕获 |

SA2 非阻塞注记 1 复核：三条 span 内字符串字面量不含 `//`/`/*`，perl 剥离无误蚀风险（现行形态不触发）。**门禁杀伤力四方向全部实证。**

## §2. §8.1 区域边界与 ALLOW/DENY 比对

**diff 基线比对**：`git diff --name-status 7f77384..0f0b470` = 恰两个文件——`M packages/doc-runtime/src/read.ts` + `M packages/doc-runtime/package.json`（+61/-12，与简报宣称一致）。actual ⊆ ALLOW（§8.1 前两项）零溢出；BLACKLIST（package-lock/yarn.lock/.DS_Store/TASK.md/*.bak）零命中。

**read.ts 子文件级 DENY 逐项核验**（hunk 边界证据）——diff 仅 3 个 hunk：

| hunk | 旧行界 | 内容 | 对应授权区域 |
|---|---|---|---|
| @@ -15,7 +15,8 @@ | 15-21 | 文件头 JSDoc 追加一行 rev2 注记 | §2 (e) ✅ |
| @@ -260,16 +261,69 @@ | 260-275 | NavOutcome JSDoc 增补 + `export` 关键字；插入 arbitrateUnion（L296-303）+ memberOutcomes（L313-325） | §2 (a)(b)(c) ✅ |
| @@ -349,14 +403,9 @@ | 349-362 | union 分支 10 行内联仲裁 → 2 行 seam 调用 | §2 (d) ✅ |

Phase A 全部（notAllowed L103 / isPathAllowed L132 / decide L156 / makeValuesResolver L212 / vChild L240 / keyAllowed L251，均在 hunk 旧行界 260 之前）、`resolveLive` 本体（L331-356，无 hunk 覆盖）、map/array/leaf/plain/xml-fragment 分支、顶层 try/catch 编排、终点 `walk` 委托——**零触碰**（hunk 粒度证据）。

**DENY 面其余文件**：index.ts / extract.ts / carrier.ts / `packages/vfsl/**` / vfsl-protocol / persistence / dsh-persistence / vfsl-codegen / apps / 根配置——均不在 diff，零改动。

**SA6 owned 两测试文件零触碰**：`git diff --stat 7f77384..0f0b470 -- packages/doc-runtime/test/` 空输出；rev1 文件的 AC-R2-3 措辞勘误段在库（7f77384 由 SA6 提交），行为断言未被 SA3 触碰。

**顶层放置序核验**（设计 §3.1.2 固定序）：`readLogicalValueAtPath(43) → NavOutcome(271) → arbitrateUnion(296) → memberOutcomes(313) → resolveLive(331) → navigate(359)` ✅。

## §3. seam 伪代码逐行比对（D17 四规则 / 短路惰性 / 异常不捕不转）

逐行比对实现（HEAD L296-325、L405-409）与设计 §3.1.2/§3.2.1 normative 伪代码：**逐字一致**（含行尾注释、参数序、`Generator<NavOutcome, void, unknown>` 返回型、`arbitrateUnion(memberOutcomes(…))` 直接实参形）。

- **D17 四规则逐字保持**：(1) 首 `kind:'value'` **按引用原样返回**（`return o`，与 rev1 `return r` 同——不改写不复制）；(2) missing 只记账 `sawMissing = true` 不返回；(3) reject 落空继续；(4) 耗尽 `sawMissing ? {kind:'missing'} : {kind:'reject'}`——构造点、对象新鲜性与 rev1 内联循环逐字一致；空成员 union（空 iterable）→ 循环零次 → reject，与 rev1 同判。
- **短路惰性**：generator 仅在 `next()` 拉动时执行到下一个 `yield`（每次恰触发一次 `resolveLive`）；arbitrateUnion 首 value `return` → for-of 提前退出触发 IteratorClose（generator 无 finally ⟹ 零可观测副作用）→ 后序成员零试探。rev2 纯测试行 2（`pulled == [0]`）为动态锚，本轮两次全量运行均绿。
- **异常不捕不转**：arbitrateUnion / memberOutcomes 体内零 try/catch/finally；diff 零新增 throw（仅 JSDoc 文字提及）。throw 源仍唯一为 navigate `ref` case 防御 throw（L415），冒泡路径 `resolveLive(内层) → generator body → arbitrateUnion for-of → navigate → resolveLive(外层) → … → 顶层 catch → C3(DOCRT-E100)` 与 rev1 同点同序。
- **D13 memo 挂点**：`resolveLive` 本体零改动（L331-356 无 hunk）；rev1 删除行 `resolveLive(m, live, segs, i, resolveS, fullPath, memo)` 与 generator yield 实参**七参逐位相同** ⟹ 调用序逐位相同 ⟹ memo 写序一致；H-a 护栏（rev1-hardening 7 用例）两次运行均绿。
- **INV-15 纯函数纪律**：arbitrateUnion 只接触 `outcomes` 形参——零 doc/memo/模块级状态访问；全文件 `let sawMissing` 恰 1、union 聚合唯一经 seam（命令 3/4 实证）。

**SA2「未成立的攻击」清单复用确认**：seam 等价 / 异常传播 / memo 写序与 H-a / M-A、M-C、M-D 矩阵预测——本轮静态复核全部继续成立，未重复消耗。

## §4. INV-14 公共面零泄漏

| 检查 | 证据 | 判定 |
|---|---|---|
| index.ts 恰冻结五项导出 | `extractYjsSnapshot` / `ExtractIssue` / `ExtractResult` / `readLogicalValueAtPath` / `ReadLogicalValueResult`（index.ts L15-18 全文核验）；**公共导出零新增** | ✅ |
| read.ts 导出面恰为授权四项 | `grep '^export '`：ReadLogicalValueResult(34) / readLogicalValueAtPath(43) / type NavOutcome(271) / arbitrateUnion(296)——前两项存量，后两项为 D19 授权 | ✅ |
| test-d 冻结形态锁绿 | 总控日志 + SA4 独立复跑均 `Type Errors no errors`（typecheck include 覆盖 `packages/*/test/**/*.test-d.ts`） | ✅ |
| 包外 deep import 零授权 | `grep -rn "src/read" packages/ apps/` → 包外**零命中**；唯一消费点 = rev2 纯仲裁测试（SA8 注记 R2-1 明文批准的破例） | ✅ |
| exports map 结构性后盾 | package.json 实测 `"private": true` + `"exports": { ".": "./src/index.ts" }`——包外 deep import 被 Node `ERR_PACKAGE_PATH_NOT_EXPORTED`/TS bundler 双侧阻断（设计 §3.1.1/§7 补引属实） | ✅ |
| **H-d 公共面负锁（本轮 SA4 裁量落地，§4.3「建议优先纳入」）** | 新建 `packages/doc-runtime/test/read-logical-value-at-path-rev2-inv14-negative.test-d.ts`（§8.1 ALLOW 明列路径；SA3 不编写条款不破——由 SA4 落地）：双 `@ts-expect-error` 自反转负锁（barrel 导入 arbitrateUnion/NavOutcome 必须编译失败）+ 同文件 deep import 正锁与签名冻结断言。**验证**：包级 `tsc -p packages/doc-runtime/tsconfig.json` exit 0；vitest typecheck 通道 2 用例绿；**机制阴性对照**（/tmp 同款 tsconfig.base 标志迷你工程）：现行态编译零错、违规态（barrel 挂 seam）TS2578 双红 | ✅ 已落地并双通道验证 |

H-d 与 rev1 SA4 落地 H-a/H-b 护栏同款先例；文件目前为工作树新增（未提交），**收尾 commit 应包含**（已在 §8.1 ALLOW 内）。

## §5. 版本 bump 硬门禁 #9

`git diff 7f77384..0f0b470 -- packages/doc-runtime/package.json`：**唯一改动 `"version": "0.1.3" → "0.1.4"`**，其余字段（name/private/type/exports/scripts/依赖）逐字节不变。✅

## §6. §1.4 vitest 触发性自检（硬门禁 #14）

- **触发条件成立**：本任务含新增 `*.test.ts`（`read-logical-value-at-path-rev2-union-arbitration-pure.test.ts`，commit 7f77384）→ 门禁适用。
- **workspace package 定位**：`packages/doc-runtime`（`@nomicore/doc-runtime`）。
- **runner 覆盖链**（静态）：根 `vitest.config.ts` `include: ['packages/*/test/**/*.test.ts', …]`（无按导入路径过滤、无 project 收窄）命中该文件；根 `package.json` `"test": "vitest run --typecheck"` 无 `--filter`（全 workspace 包统一触发）；CI `.github/workflows/ci.yml` job `test`（`on: pull_request` + `push: main`，node 20/24 matrix）步骤 `Test: pnpm test` + 步骤 `Typecheck: pnpm typecheck`（含 `tsc -p packages/doc-runtime/tsconfig.json`，覆盖 test/**/*.ts 类型通道）。**注**：skill 辅助命令的 `--filter` grep 口径不适用——本仓 CI 不用 filter 而是根级全量命令，覆盖面为其超集。
- **直接执行证据**（动态）：总控日志 `✓ packages/doc-runtime/test/read-logical-value-at-path-rev2-union-arbitration-pure.test.ts (6 tests)`；SA4 独立复跑同款命中（6 tests ✓）。
- **结论**：**触发确认，无 CI 黑洞**（`vitest-package-not-triggered` 不成立）。

**§1.3 E2E spec 触发性**：本任务无 `*.spec.ts`，门禁不适用。**§1.5 协议假设**：设计 §5 章节在、四项语言级事实全带依据且经 SA2 复核；本轮以两次全量绿（deep import 通道 + for-of 短路语义运行时实证）再确认，无 `unverified-protocol-assumption`。**§1.6 契约改动连锁**：diff 无既有 export 函数 throw/return 契约变化（`readLogicalValueAtPath` 公共契约 INV-13 冻结；arbitrateUnion 为新增包内函数），门禁不触发。**§1.7 源码 grep 断言禁令**：doc-runtime 全部测试文件扫描 `readFileSync + toMatch/toContain` 反模式**零命中**；rev2 纯测试全部为运行时行为断言（返回值 + 拉动序列），文件头明文自证。

## §7. 全量复跑（SA4 独立，含 H-d 落地后）

独立进程（setsid）复跑 `pnpm test`：**61 文件 / 836 用例全绿，Type Errors no errors，exit 0**（60→61、834→836，增量恰为 H-d 文件 2 个 typecheck 用例；rev2 纯仲裁 6 用例、rev1-hardening 7 用例、rev1 union-arbitration、supplementary、主套件、extract 5 文件全绿）。总控验收日志（H-d 之前）60/834 全绿一致。AC-R2-5 前半句（不回归既有测试）双重确认。

## 动态审核重点（交 SA7）

1. **AC-R2-4 mutation proof（必做 M-A + M-C；owner 合并阻塞项的兑付证据）**：按设计 §3.3.3 双路径协议执行。**路径 P 前置条件已就绪**：seam 实现已提交于 `0f0b470` 且 `git status --porcelain packages/doc-runtime/src/read.ts` 现为空输出（SA4 实测）——可直接 `git checkout -- packages/doc-runtime/src/read.ts` 安全还原，验收 = porcelain 复空。预期红集合（矩阵基线）：M-A = 行 1/3/5（行 1 双红）；M-C = 行 2 拉动断言（结果仍绿）；对照组（rev1 R1/R2/R3 + 全包其余）两变异下均须全绿。
2. **可选 M-B（红集合 {3,4,6}，含 H-b/R4-3 公共面红）/ M-D（红集合 {3,4,5} + R4 组）**：裁量执行，同款还原纪律；实测与矩阵冲突时先复查变异形态再定性（§3.3.1 矩阵基线注）。
3. **H-a 性能护栏时序记录**：generator 帧开销下的 26 层链耗时（本轮两次全量均绿，仅需在 SA7 报告记实测值以留基准）。
4. **H-d 负锁（新落地）动态确认**：CI/`pnpm test` 日志中 `read-logical-value-at-path-rev2-inv14-negative.test-d.ts (2 tests)` 出现即触发证据。

## 处置说明

- **Verdict = pass**：SA3 实现 `0f0b470` 与设计 normative 伪代码逐字一致、全部静态门禁与 ALLOW/DENY 比对通过、INV-14 公共面零泄漏、版本 bump 合规、vitest 触发链闭合。SA7 可进入动态验证（AC-R2-4 mutation proof 为核心义务）。
- **SA4 变更清单**（不触生产代码）：① 新增 `packages/doc-runtime/test/read-logical-value-at-path-rev2-inv14-negative.test-d.ts`（H-d 负锁，设计 §4.3/§8.1 授权 SA4 裁量，双通道验证绿）；② 本报告。收尾 commit 请包含前者。
- **无需回流**：无 reject 项；SA1/SA3/SA6 均无需返工。
