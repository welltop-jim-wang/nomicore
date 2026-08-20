# SA4 静态验尸报告

**Date**: 2026-08-21
**Verdict**: pass
**被审对象**: SA3 实现 commit `1c95341`（基点 `5907dc3`），对照 SA1 设计 v1.1（`task_vfsl-codegen-hardening_design.md`）与 SA2 评审（pass，`task_vfsl-codegen-hardening_sa2_review.md`）
**审查方法**: 静态验尸 + 证据复跑——所有承重结论以本 worktree 实测（全量测试 / typecheck / CLI 门禁 / 发射形态探针 / grep 判据）独立取证，不采信 SA3/SA6 自述

---

## 一、立法自检项结论（总控点名项，前置披露）

### 1.3 E2E spec runner 触发性自检 — **N/A**

本任务设计与 diff 均无任何 `*.spec.ts` 文件（`git diff --name-only 5907dc3 HEAD | grep '\.spec\.ts$'` → 空）。门禁不触发。

### 1.4 vitest 触发性自检 — **通过**（4 个 SA6 测试文件全部接通 CI）

- 设计新增测试文件：`packages/vfsl-codegen/test/generate-protocol-import.test.ts`（5 条）、`generate-alias-collision-guard.test.ts`（4 条）、`generate-error-message-tail.test.ts`（4 条）+ 共享辅助 `tsc-helper.ts`（非测试文件）。三文件所在 workspace package = `@nomicore/vfsl-codegen`（`packages/vfsl-codegen/package.json` name 字段）。
- CI 触发链实测核对（`ls .github/workflows/` → 仅 `ci.yml`）：
  - `ci.yml` job `test`（matrix node 20/24，`on: pull_request` + `push: main`）step `Test` 执行 **`pnpm test`** = 根脚本 **`vitest run --typecheck`**（根 package.json scripts.test）；
  - 根 `vitest.config.ts` `include: ['packages/*/test/**/*.test.ts']` —— glob 覆盖 `packages/vfsl-codegen/test/*.test.ts`，无 `--filter`/`exclude` 收窄，三个新测试文件**全部落入** discovery 范围；
  - typecheck 侧：`include: ['packages/*/test/**/*.test-d.ts']` + `pnpm typecheck`（三包 `tsc -p`，vfsl-codegen tsconfig 含 test/）双通道覆盖新文件。
- **结论：无 CI 黑洞**——新 13 条测试在每次 PR CI 的 `Test` step 必然执行。本机全量复跑即其等价物：**27 files / 421 tests 全绿、Type Errors 无**（408 既有 + 13 新，与 SA6 红灯基线记录的算术一致）。SA7 须按联动要求从 `gh run view --log` 摘录 `Test` step 中三新文件的执行证据（见动态审核重点 #4）。

### 1.5 协议假设审查 — **通过**（§11 章节存在、零无据推断、可复现项全部复跑吻合）

设计 §11「协议假设依据」存在，8 行（A–H）逐假设列表，依据类型栏全为「设计期实测验证 / 源码引用 / 现有测试引用」——**无「应该/通常/预计」类无据断言**。可复现项逐条复核：

| # | 假设 | SA4 复核方式 | 结果 |
|---|---|---|---|
| A | 任意 top-level import 使文件成 module；零别名/0 字段形态同愈 | 本机探针 `/tmp/sa4-i45/probe-layout.mjs`（tsx 直驱真管线，三形态发射）+ 测试①两条编译锚全绿 | ✅ 三形态生成物均含恒一 import 行、孤立 program 零诊断（测试实证） |
| B/C | 增广作用域解析优先命中协议导出（12 名有害面） | 守卫落地后 12 名全量拦截即消除该面；测试②经 checker **运行时实测枚举**导出面逐一断言必抛 | ✅（harm 论据为守卫必要性论证，守卫本身已由测试②全绿实证覆盖全 12 名） |
| D | 未引用碰撞别名按声明名拦截（超集） | 静态核守卫体：`Object.keys(aliases)` 声明序过滤，与引用与否无关 | ✅ 声明期拦截确认 |
| E | script 形遮蔽（N2 机理） | 历史 SA5 p2 实证；测试①零别名 + consumer 同 program 零诊断 = 治愈锚 | ✅ |
| F | 协议导出面 = 12 名 | `grep '^export' packages/vfsl-protocol/src/index.ts` 逐名比对 `protocol-surface.ts` 冻结名单 | ✅ 12/12 逐名一致；测试② checker 枚举在 CI 每次运行时活体再验证 |
| G | `createProgram`+`getPreEmitDiagnostics` ≡ `tsc --noEmit` | SA5 probe3 双源核对 + 测试①以此载体全绿 | ✅ |
| H | CLI 对带 code 的 Error 打 `[<code>]` + exit 2 | 源码逐行读 `cli.ts` `printStructuredError`（非 SchemaSourceError → string code → `[<code>]` 前缀）+ `main().catch → process.exit(2)`；测试② CLI 断言全绿 | ✅ |

无进程/端口/时序类假设（与设计自述一致，本轮复核确认）。

### 硬门禁 9 — **通过**

`packages/vfsl-codegen/package.json` version **`0.1.0` → `0.1.1`**（patch bump，git diff 实证）。安全性复核：`header.ts` 运行时惰性自同步读 package.json version（`new URL('../package.json', import.meta.url)`）→ 头注行 `Generator: @nomicore/vfsl-codegen@0.1.1`（探针实证）；仓内**零入仓生成物**（`find -name 'generated.ts'` → 空）→ regen-diff 无迁移面（`pnpm generate --check --allow-empty-domains` exit 0 实证）；无任何测试硬编码版本串（grep 0.1.0/0.1.1 于 src/test → 零命中）。

> ⚠️ **随附发现（回流 SA1，非阻断）**：`package.json` **不在设计 §10 ALLOW LIST**，且设计 §9 明言「包版本 bump 非必需」——与总控硬门禁 9 直接矛盾。硬门禁为更高权威，SA3 的 bump 合规且经上述复核零风险；但设计文档滞后，**要求 SA1 出 v1.2 修订**：ALLOW LIST 增补 `packages/vfsl-codegen/package.json`（标注「硬门禁 9：行为变更包 patch bump」）、§9 该行同步更正。此为文档债，不影响 SA7 进入动态验证（行为面已全部实证）。

---

## 二、验尸清单逐项结论

### 1. 设计一致性审查

**1.1 文件清单 Scope Creep Guard — ✅ 无越界**（1 项豁免裁决见硬门禁 9 附注）

- ALLOW LIST 抽取自设计 §10（7 文件）；actual diff = `git diff --name-only 5907dc3 HEAD` = 8 文件。
- 逐文件比对：`emitter.ts` ✓ / `protocol-surface.ts`（新建）✓ / `README.md` ✓ / 三 `.test.ts` + `tsc-helper.ts`（SA6 owned）✓；**唯一 ALLOW 外文件 = `package.json`**，属总控硬门禁 9 强制项（上节已裁决：合规改动 + SA1 文档修订回流），非 SA3 自行扩权。
- **DENY LIST 零触碰**：`vfsl-protocol/src/index.ts`、`packages/vfsl/src/**`、`cli.ts`、`collect.ts`、`header.ts`、`vfsl-codegen/src/index.ts`（公共面保持最小——错误类未进公共面，与设计一致）、`docs/adr/**`、`tests/acceptance/**` 全部不在 diff（8 文件逐一核对）。
- BLACKLIST 零命中（无 package-lock.json / yarn.lock / .DS_Store / TASK.md / *.bak）。
- `[SA6 owned]` 纪律核对：四测试文件为 SA6 未跟踪新作首次入 commit（无先行版本可 diff），内容与任务简报 SA6 记录逐项吻合（5+4+4=13 条、断言锚形态、tsc-helper 三导出 + createRequire 取法），SA3 无篡改痕迹。

**1.2 设计偏离审查 — ✅ 一致**（唯一偏离 = 上节 package.json 项）

| 设计决策 | 实现核对 | 结果 |
|---|---|---|
| §3.1 布局冻结（四段、相邻恰一空行、段②空时连空行消失） | 探针三形态（具名别名/零别名/0 字段 ROOT）：无双空行、import 恒一条、首非注释行 = import 行 | ✅ 逐字节吻合设计样例 |
| §3.2 恒定 = 无条件（不判域形态） | `PROTOCOL_IMPORT_LINE` 为 sections 无条件成员（唯一可能被 filter 的只有 aliasLines） | ✅ |
| §3.5 装配伪代码 | sections `[header],[import],aliasLines,augmentationLines].filter(len>0)` join `'\n\n'` + 尾 `\n` | ✅ 与伪代码逐行同构 |
| §4.1 冻结 12 名（实测导出面） | protocol-surface.ts 名单 = grep 实测 12 名逐名一致 | ✅ |
| §4.3 错误类（code/aliases/消息全文） | 与伪代码逐字一致（`alias-protocol-export-collision`、声明序 join `、`、重命名指引尾） | ✅ |
| §4.4 守卫位次（ROOT 校验 → 守卫 → 装配） | emitter.ts:144-159 ROOT 三检查 → :162 守卫 → :164+ 装配 | ✅ 次序冻结达成（碰撞+形态错误并存 → 形态诊断先出） |
| §4.6 CLI/collect 零改动 | 两文件不在 diff；`printStructuredError` code 分支 + 顶层 catch exit 2 逐行复核在场 | ✅ |
| §5 尾串三消息 + L50 注释顺带 | `grep -c '由总控开后续票登记' emitter.ts` = **0**（SA2 判据）；`见 #44` 恰 4 处（L40/L51/L59/L77） | ✅ |
| §3.4 仓内零生成物零迁移 | `find generated.ts` → 空；无 domains/ | ✅ |

（SA2 四项文字修订 #1–#4 已在 v1.1 落实——本轮核 v1.1 文本确认，非 SA3 范围。）

**1.6 契约改动连锁审查 — ✅ 通过**（唯一契约改动 = `generateProjection` 新增 throw 路径 + 返回值内容增行）

caller 全集（`git grep generateProjection` 复跑）与三层防御矩阵：

| Caller | A. 直接 try/catch | B. await 链完整 | C. 顶层处置 | 判定 |
|---|---|---|---|---|
| `collect.ts:78`（生产唯一） | ❌ 裸调用（设计即定的响亮通道） | ✅ `main()` async → `await collectProjections`（cli.ts:59）→ 同步 throw 变 promise reject | ✅ `main().catch → printStructuredError → exit 2`（cli.ts 末尾，逐行核实） | ✅ B+C 兜住；无 unhandledRejection 面 |
| `index.ts:7` re-export | N/A | N/A | 签名不变 | ✅ |
| 测试 5 文件（②①③ + mapping-table + emission） | ②③ 显式 try/catch（断言必抛）；①/mapping/emission fixture 别名（`Box`/`Entity/Id/Meta`/`A/B/U/Node`）∉ 12 名 → 新 throw 不可达 | — | — | ✅ 全绿实证 |

附带复核：collect 全量前置（cli.ts:59）先于写盘循环 → 碰撞域**任何写盘前**失败，无部分写盘撕裂态（SA2 论断在当前代码再确认）。

**1.7 源码 GREP 断言禁令 — ✅ 通过**：四测试文件扫描，零 `readFileSync(<源码>) + toMatch/toContain` 反模式；全部断言锚 = 发射输出文本 / 抛错行为 / 错误对象属性 / CLI exit+stderr / tsc 编译诊断（运行时行为）。

### 2. 读写路径一致性 — ✅ 一致

唯一数据变更点 = 生成物文本（增 import 行 + 尾串）。写路径（CLI 写盘）与读路径（`--check` regen-diff、下游 typecheck）同走 `generateProjection` 单一发射器 → 无分叉。import 行写入与读取自洽于同一产物文件。

### 3. 静默失败专项 — ✅ 无

新守卫失败路径：throw → CLI 结构化 stderr（`[alias-protocol-export-collision]` + 全部碰撞别名 + 重命名指引）+ exit 2——网络/状态/UI 三问中「进程退出码 + stderr」双可观察。import 行发射为无条件常量，无分支。全绿测试②①分别锚定两行为。

### 4. 降级方案审查 — ✅ 无降级

无 fallback/降级路径引入。冻结名单（vs 运行时枚举）是带同步锚的技术取舍（协议包纯类型模块运行时不可枚举 + 生产不依赖 devDependency 编译器 API——约束真实；增名方向漂移 → 测试② checker 实测枚举出新名必抛断言即红，锚真实）。

### 5. 极端条件攻击 — ✅ 安全

- 多重碰撞：一次全列（声明序，`Object.keys` 插入序 = 声明序），确定性 ✅（静态确认；SA7 动态补锚见下）
- 碰撞 + ROOT 形态错误并存：形态诊断先出（守卫位次 ：162 在 ROOT 检查 ：144-159 之后）✅
- 零别名域 / 0 字段 ROOT：探针三形态布局与编译全过 ✅
- `ROOT` 别名：不在 12 名集合，集合成员测试天然排除 ✅
- 错误消息注入：别名名经 parse 层 identifier 词法约束，消息有界（≤12 名）✅（SA2 复证，静态再确认）
- 版本 bump × 头注哈希：version 不入 sourceText 哈希，自同步机制无扰 ✅

### 6. 错误处理链路 — ✅ 完整

三既有错误类（前缀锚定 + 新尾串）与新错误类（独立 code）全部经同一 CLI 顶层通道闭环；测试③/②的 CLI 端到端断言（exit 2 + stderr 尾串/`[code]`/别名）全绿。

### 7. 架构评估 — ✅ 可行

零绕过、零 FIXME、零临时补丁；实现与设计伪代码近逐行同构（emitter 净增约 +45 行 vs 设计预估 +40，量级吻合）。无退回 SA1 信号。

### 8. 过度设计审查 — ✅ 精简

最小变更：1 新文件（19 行）+ emitter 定点改造 + README 2 行 + 1 行 version bump。无多余抽象层，无不可能边界防御。

---

## 三、验证证据索引（本评审独立执行）

| # | 命令（仓根） | 结果 |
|---|---|---|
| 1 | `git diff --name-only 5907dc3 HEAD` | 8 文件（§1.1 逐一比对） |
| 2 | `./node_modules/.bin/vitest run --typecheck`（独立进程） | **Test Files 27 passed (27) / Tests 421 passed (421) / Type Errors no errors**，EXIT=0（408 既有 + 13 新全绿；含三新文件 5/4/4） |
| 3 | `pnpm typecheck` | 三包 tsc -p 全过，exit 0 |
| 4 | `pnpm generate --check --allow-empty-domains` | exit 0 |
| 5 | `grep -c '由总控开后续票登记' packages/vfsl-codegen/src/emitter.ts` | **0**（SA2 判据）；`见 #44` 恰 4 处（L40/L51/L59/L77） |
| 6 | `grep '^export' packages/vfsl-protocol/src/index.ts` × protocol-surface.ts | 12 名逐名一致（假设 F） |
| 7 | `tsx /tmp/sa4-i45/probe-layout.mjs`（真管线三形态） | 三形态布局全合 §3.1（无双空行 / import 恒一 / 头注 @0.1.1） |
| 8 | `sed -n '140,170p' + main() cli.ts`、`grep projectionText collect.ts` | 假设 H + §1.6 caller 链逐行核实 |
| 9 | `cat vitest.config.ts` + `cat .github/workflows/ci.yml` + 根 scripts | §1.4 触发链（include glob 覆盖 vfsl-codegen） |
| 10 | `git diff 5907dc3 HEAD -- package.json` | 0.1.0 → 0.1.1（硬门禁 9） |
| 11 | `find . -name 'generated.ts'`、`ls domains/` | 双空（零生成物零迁移） |
| 12 | 测试四文件全读 | 13 条断言锚全运行时行为（§1.7）；与 SA6 记录逐项吻合 |

---

## 四、动态审核重点（交 SA7）

1. **`--check` 路径行为增强实证**（设计 §9 披露 exit 0→2；SA6 ② 仅锚生成路径）：临时目录放碰撞域 → `pnpm generate --check --domains <dir>` → 断言 exit 2 + stderr 含 `[alias-protocol-export-collision]`（SA2 红灯思路 #3）。
2. **多重碰撞确定性**：fixture 双碰撞别名（如 `PathAt` + `PathValue`）→ 断言抛错、`aliases` = 声明序、消息含两名（SA2 思路 #5；静态已确认机理，动态补观测）。
3. **守卫次序确定性**：联合形 ROOT + 碰撞别名并存 → 断言错误为 `UnsupportedRootShapeError`（SA2 思路 #6）。
4. **CI vitest 触发证据**：`gh run view --log` 摘录 PR CI `Test` step 中三新测试文件（5/4/4）执行行 + `Domain scaffolds check`/`regen-diff` 两 step 绿（§1.4 静态结论的动态确认，立法联动要求）。
5. **版本 bump 端到端**：CI regen-diff step 绿即证 @0.1.1 头注无迁移面（本机已静态+门禁实证，CI 侧顺手确认）。

（SA2 思路 #2 全局名无害守护锚、#4 双向同步锚：设计明示「本票不纳入」、SA2 自裁不要求纳入 ALLOW LIST——接受延后，无需本票动作，后续票可选。）

---

## 五、Verdict

**pass。**

- 实现与设计 v1.1 三条修复线（恒定 import 行 / 12 名碰撞守卫独立错误码 / 三尾串+L50）逐项逐字节吻合，AC-1–AC-5 全部有实证（421/421 全绿 + typecheck exit 0 + `--check --allow-empty-domains` exit 0 + 布局探针 + grep 判据归零）。
- 立法自检三项（1.3 N/A、1.4 通过、1.5 通过）+ 硬门禁 9（patch bump 已落且零风险）全部达标。
- **唯一回流项（非阻断）→ SA1**：v1.2 修订 ALLOW LIST 增 `packages/vfsl-codegen/package.json`（硬门禁 9 依据）并更正 §9「bump 非必需」行；另可顺手把 §12 caller 表「测试侧 6 文件」勘误为 5（实测 git grep：生产 1 + re-export 1 + 测试直调 5 文件，无 caller 遗漏，纯计数笔误）。
- SA7 可进入动态验证（重点清单见上节）。
