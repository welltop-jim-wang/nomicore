# SA7 动态验证报告 — 派生 schema 携带 docs + typeCls 收敛（Issue #29）

**Date**: 2026-08-20
**验证对象**: SA3 commit `f071f3e`（分支 `fix/issue-29-on-adr-union-representation`，基线 `40c1be0`）
**输入**: SA4 静态验尸报告（pass + 4 条动态审核重点）、SA1 R2 设计、任务简报、SA5 报告、SA6 红灯测试文件
**产物**: 新增 `packages/vfsl/test/evaluate-derived-docs-audit.test.ts`（15 用例，ALLOW LIST `[SA7 owned]` 固定条目）

## Step 0 — SA4 验尸校对

SA4 报告顶部 Verdict 行为 pass → 按 SKILL Step 0 规则进 Step 1（SA7 不存在「下发」路径；本次为独立动态验证，未发现任何需下调的新 fail 事实）。

## Step 1 — SA6 红灯测试复跑

命令（后台独立进程）：`pnpm exec vitest run packages/vfsl/test/evaluate-derived-docs-typecls.test.ts`

```
 ✓ packages/vfsl/test/evaluate-derived-docs-typecls.test.ts (8 tests) 15ms
 Test Files  1 passed (1) / Tests  8 passed (8) / exit 0
```

**结论：🟢 GREEN（8/8）**——SA3 实现真实转绿，无伪红残留。

## Step 2 — SA4「动态审核重点」清单逐条验证

> 阅读量：8 个文件（SA4 报告/简报/SA5 报告/设计/evaluate.ts/ir.ts/SA6 测试/ci.yml），SKILL 上限 15 以内。

### 重点 #1 — audit 测试落地（设计 §8 方向 #1–#3）：✅ 已落地，15 用例全绿

新文件 `packages/vfsl/test/evaluate-derived-docs-audit.test.ts`（一次运行 15/15 绿；typecheck 门内三处初版类型错误已修，运行时行为零变化）：

| 方向 | 断言内容 | 结果 |
|---|---|---|
| #1 排序全键集 | FIXTURE 三表 `[...Object.keys(x)].sort()` 与设计 §4.5 字面量 `toEqual` 全等（**5 / 22 / 18**）；SYNTH 同款（3 / 9 / 7） | ✅ 逐键全等 |
| #1 性质断言 | 零碰撞模块 `Object.keys(markerDocs).length ===` IR marker 节点总数（独立计数器遍历 IR，ref 不穿越）；`aliasDocs` 键数 === 别名数 | ✅ 18=18、5=5、7=7、3=3 |
| #2 手造 IR 三例 E100 | 深拷贝合法 FIXTURE 产物后外科手术破坏：(a) 别名 docs=undefined、(b) 字段 docs=undefined、(c) 标记 docs='foo'（非数组）——每例 `ok:false` + `issues[0].message` 前缀 `VFSL-E100`（按 SA2 R2 口径只验冻结前缀，不要求消息含 docs 值）；附正向对照合法 FIXTURE 仍 `ok:true` | ✅ 三例 E100 + 对照不误伤 |
| #3 无 undefined 性质 | FIXTURE/SYNTH 的 derived 全树递归遍历，任何层级（含三表）无 undefined 值 | ✅ 无 |

**回流 warning #1（全键集对账未 CI 锚定）就此闭环**：此前仓内 18 键仅 7 键、22 键仅 5 键被红灯锚定；现在全键集 + 计数性质进入 `pnpm test` 常驻回归面。

### 重点 #2 — 同路径嵌套标记串联（§3.3 契约空白）：✅ 已锚定，且经突变证明是唯一杀手

NESTED 合成模块（全部 parser 可达形，parse ok 实测通过）+ 6 用例：

- `YMap<YMap<{f}>>`（别名体根）→ `markerDocs['NestMap'] === [' 外层 ', ' 内层 ']`——**外层在前源序串联**（设计 §3.3 定形与实现动态行为一致）；
- `YLeaf<YLeaf<string>>` → `[' A ', ' B ']`；
- 多 doc 标记：外层两段连续 doc + 内层一段 → `[' d1 ', ' d2 ', ' d3 ']`（数组级拼接按记号出现序）;
- 字段类型位嵌套 `ROOT.m` → `[' 外M ', ' 内M ']`，内层实参字段 `ROOT.m.v` 不串位；
- **record `<key>` 恒空锚**：`Record<string, /** 值标记 */ YMap<…>>` 值位标记携带 docs 时，`fieldDocs['ROOT.r.<key>']` 仍恒 `[]`（IR record 无 docs 槽），标记 docs 入 `markerDocs['ROOT.r.<key>']`；
- 碰撞收敛性质：marker 节点数 − 4 处双标记碰撞 === markerDocs 键数。

**回流 warning #2 就此闭环**，证据见 M4 突变（下表）：串联语义丢失时存量 261 全绿、仅本组 4 断言红——SA4 预言的「实际风险」此前真实存在，现已封死。

### 重点 #3 — CI 动态确认：见下文「vitest 触发证据」节

本阶段分支无 PR（PR 创建/推送属外部 check.sh 职责，SA 一律不执行），不存在可摘录的 CI run——按总控指示以**本地全量替代 CI** 留痕（详见该节）。

### 重点 #4 — mutation 全量实跑（非单文件）：✅ 4/4 全杀

每个突变体施加于 `evaluate.ts` 后跑全量 12 文件（276 用例），跑完即还原（终态 `git diff` 为空、0 突变标记残留）：

| 突变 | 形态 | 结果 | killer（失败文件→测试数） |
|---|---|---|---|
| M1 | marker `argPath` 分流失效（YArray/YPlainArray 也透明，`<item>` 段丢失） | 🔪 killed（exit 1） | 仅 audit：3（FIXTURE 键集 + FIXTURE 计数性质 + SYNTH 键集/性质）；**其余 11 文件全绿** |
| M2 | `<member ${i}>` → `<member ${i+1}>`（序号偏移） | 🔪 killed（exit 1） | audit 2（两键集）+ SA6 2（AC1/AC2） |
| M3 | record `<key>` 恒空数组改读值位 marker docs（外科手术形：`t.value.kind==='marker' ? t.value.docs : []`） | 🔪 killed（exit 1） | 仅 audit：1（`ROOT.r.<key>` 恒空锚）；其余 275 全绿 |
| M4 | `appendDocs` 串联→覆盖（put 语义，§3.3 丢失） | 🔪 killed（exit 1） | 仅 audit：4（嵌套串联组）；**存量 253 + SA6 8 全绿——动态坐实 SA4「现有 261 不拦此突变」的预言** |

四个突变面（SA4 点名的 `argPath` 分流 / `<member N>` 偏移 / record `<key>` 改读值 docs / `appendDocs`→`put`）全部有常驻测试锚定；其中 M1/M3/M4 仅被本次新增 audit 断言拦截——补充测试的实际防护增量经突变实证。

## §6 护栏不动点核对（diff 级）

`git diff 40c1be0..HEAD -- packages/vfsl/src/evaluate.ts` 中触碰 `detectDiscriminator` / `unionNode` 的行数 = **0**（设计 §6 改动级护栏成立）。

## 运行证据汇总（全部后台独立进程 `setsid nohup`，日志留存 /tmp）

| 运行 | 结果 | 日志 |
|---|---|---|
| SA6 红灯文件单跑 | 8/8 绿，exit 0 | /tmp/sa7-step1.log |
| audit 文件单跑（终版） | 15/15 绿，exit 0 | /tmp/sa7-audit2.log |
| 全量首跑 | 12 文件 / 276 用例全绿，exit 0 | /tmp/sa7-full.log |
| `pnpm typecheck`（终版） | exit 0（首版三处测试文件类型错误修复后复跑） | /tmp/sa7-tsc2.log |
| 突变 M1–M4 全量 | 各 exit 1（4/4 killed，killer 见上表） | /tmp/sa7-mut{1..4}.log |
| 复原后终态全量 | 12 文件 / 276 用例全绿，TEST_EXIT=0；TSC_EXIT=0 | /tmp/sa7-final2.log、/tmp/sa7-final.log |

环境说明：纯 vitest 单元测试链路，无服务端口占用——`fuser` 清场不适用；全程未发现、未杀任何未知进程。

## 工作区终态

- 源码零改动零残留：`git diff -- packages/vfsl/src/` 为空；`[SA7-MUTATION]` 标记计数 0；无诊断日志残留。
- 新增仅 1 个文件：`packages/vfsl/test/evaluate-derived-docs-audit.test.ts`（未跟踪，ALLOW LIST `[SA7 owned]` 条目）。
- 本报告落 `wiki/raw/`。未执行 push / PR / 任何 CI 宣称。

## vitest 触发证据

CI Run: 无——本阶段分支尚无 PR（PR 创建与推送属外部 check.sh 职责，SA 不得自行执行），故无可摘录的 GitHub Actions run；按总控指示以**本地全量实跑替代 CI 留痕**。静态接線已由 SA4 §2 核过（ci.yml `test` job：matrix node 20/24，steps `Typecheck: pnpm typecheck` + `Test: pnpm test`，`pull_request` 触发；根 `vitest.config.ts` include `packages/*/test/**/*.test.ts` 覆盖两文件）。PR 建立后的 CI run 摘录属外部 check.sh 后续职责，本报告不宣称 CI 已绿。

本地等价命令（worktree 根目录，后台独立进程）：`pnpm test` + `pnpm typecheck`

| Workspace Package | CI Step Name（本地等价命令） | 触发结果 | log 摘录 |
|---|---|---|---|
| vfsl | Test（`pnpm test`） | ✓ 触发且通过（276/276，含两新文件） | ` ✓ packages/vfsl/test/evaluate-derived-docs-audit.test.ts (15 tests) 20ms`；`Test Files  12 passed (12)` / `Tests  276 passed (276)` |
| vfsl | Typecheck（`pnpm typecheck`） | ✓ 通过 | `tsc -p packages/vfsl/tsconfig.json` → exit 0（TEST_EXIT=0 / TSC_EXIT=0，/tmp/sa7-final2.log） |

设计 §8 所列新增 `*.test.ts` 触发核对：`evaluate-derived-docs-typecls.test.ts`（SA6）出现在 runner 列表 `✓ … (8 tests)`（/tmp/sa7-step1.log）且含于全量 12 文件；`evaluate-derived-docs-audit.test.ts`（SA7）同上（15 tests）。两者在本地全量中均真跑且全绿，无 skip、无排除。

**触发状态**: ✅ 全部 vitest 测试文件真实触发且通过（本地全量证据；CI 留痕待 PR 建立后由外部 check.sh 补）

---

**Verdict**: pass
