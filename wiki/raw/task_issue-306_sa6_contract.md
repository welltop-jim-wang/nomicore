# SA6 诊断与验收契约 — issue #306（M4 联合成员文档注释：解析挂载 + IR/derived `memberDocs`）

- **Dispatch**: sa-509beb7b-8976-4c48-ade4-da8fce907dd5（mabf-sa6 / acceptance-contract / iteration 0）
- **Worktree**: `/home/wangjian/nomicore-fix-issue-306`，branch `mabf/issue-306`，HEAD `91c4add`（docs(#304): ADR 0019 联合成员文档注释设计契约）
- **任务类型**: **Feature（能力缺口 → 验收契约）**，附一条 ADR 授权的既有行为变更（E305 消息措辞）与一组必须逐字节保持的既有行为（坍缩 / `|` 夹缝 E305、存量 IR / derived / semantic 指纹）。**不虚构 bug 根因**：当前成员 doc → E305 是 v1-spec §5 现行「三锚位」文本的**规格要求行为**；ADR 0019 显式授权新增 M4 锚位（#309 与实现同支改规格文），故这是「只增」演进的能力缺口，不是缺陷。
- **Verdict**: **approve**（能力缺口已稳定复现；契约 19 用例中 12 红 / 7 绿，红因全部锁定为能力缺口；负控与存量回归全绿；测试入口真实可触发；条带金样本录制于实现前，E-1 基线真实）。

---

## 1. Task type and inputs

| 输入 | 使用方式 |
| --- | --- |
| `wiki/raw/task_issue-306.md`（Host-owned brief） | 需求与 AC1~AC6 逐条转译为契约用例；issue 无评论（§2） |
| `.scratch/sa8-conflict-report-issue-306.md`（SA8 冲突门禁） | 约束 C-1~C-6 与证据要求 E-1~E-6 逐条落地（§3） |
| `docs/adr/0019-vfsl-union-member-docs.md`（已接受，未被取代） | 契约的规范权威：决策 1（M4 锚位）/2（坍缩维持 E305）/3（M3 优先不双挂）/4（IR 条件键）/5（derived 条件稀疏 + 手造 IR 守卫）/8（纯文档性质）/9.3（E305 措辞） |
| `docs/vfsl/v1-spec.md` §5（三锚位 + E305）、§10（vfs3.assets fixture）、§4（消息前缀冻结） | 存量行为基线 + 金样本输入 + 措辞断言边界 |
| `packages/vfsl/src/{parser,semantic,ir,derived,evaluate,fingerprint,tokenizer}.ts`、`packages/vfsl/test/*` | 能力缺口定位（§8）与既有回归锚点（§10） |
| `wiki/raw/task_issue-306_relevant_decisions.md` | **不存在**（已确认）；决策面由 ADR 0019 + SA8 报告承载 |
| 既有 SA6 报告 | `wiki/raw/task_issue-306_sa6_contract.md` 原先不存在 → 本文件为唯一原位报告 |

## 2. Owner comment mapping

- issue #306 **无适用评论**：`gh issue view 306 --json comments,labels,state --jq ...` → `{"comments":0,"labels":["in-progress","feature"],"state":"OPEN"}`（本侧独立复核，与 dispatch Owner feedback 及 SA8 §标题行一致）。
- 因此不存在「评论约束 vs ADR」的裁决项；需求面 = issue What-to-build + AC1~AC6，全部可从 ADR 0019 决策面找到依据（SA8 矩阵 1~12 已核对）。

## 3. SA8 constraints

| SA8 约束 | 本契约的落实 |
| --- | --- |
| **C-1 规格同支同步（#309）** | 不在本契约的测试面（规格文本不由 vitest 断言）；但契约的红/绿分流保证实现与规格修订可分步落地而行为面自洽。 |
| **C-2 指纹纪律** | 金样本 A（v1-spec §10 fixture）+ 金样本 B（联合密集 fixture）：IR 紧凑 JSON SHA-256、semantic 指纹**精确值**、`sha256:v1:` 前缀、derived 紧凑 JSON SHA-256，全部录制于实现前并断言逐字节不变（§12 行 18/19 = IR/指纹金样本，行 14 = derived 稳定）。 |
| **C-3 E305 触发面只缩小** | 坍缩两形态 `/** d */ "a"` 与 `/** d */ | "a"` 断言 E305 @(2,10)；`|` 夹缝非标记成员（单行 + 多行）断言 E305 @(2,16) / @(4,5)——锚点全部取自现行实现实测值。 |
| **C-4 纯文档纪律** | 「纯文档性质」用例断言「有成员 doc」与「无成员 doc」的 `structure / values / index / aliases / aliasDocs / fieldDocs / markerDocs` **全等**，且派生物 JSON 确有差异（memberDocs 表）——同时封住「不进校验与物化」与「不得静默丢弃」两个方向。 |
| **C-5 中间态豁免（#308/#307 不判缺陷）** | 契约不覆盖 `resolveSchemaAtPath` 投影切片（决策 7 / #308）与 codegen 四发射位（决策 6 / #307）；SA7 验收 #306 时不得以二者缺席判缺陷（§10/§15 登记）。 |
| **C-6 消息变更边界** | 措辞用例只断言 `^VFSL-E305: `（§4 冻结前缀）+ 正文含「联合成员」；全仓无既有断言锁定 E305 消息正文（已 grep：仅 `parse-vfsl-jsdoc.test.ts:127` 前缀正则、`tests/acceptance/vfsl_spec_acceptance.py` 只查规格文本）。 |
| **E-1 存量稳定金样本** | 由本票新增（实现前录制）：金样本 A/B 的 IR/derived 摘要 + semantic 指纹（含派生键集合 = 既有七表）。 |
| **E-2 M4 矩阵** | 两锚位子规则正例 + 连续 doc + 坍缩两形态 + 夹缝（非标记 E305 / 标记 M3 不双挂）+ 夹缝叠写各归各锚位。 |
| **E-3 derived 条件稀疏** | `<member N>` 键序（N=0 起声明序）、只收非空条目、无 doc 模块整键缺席、嵌套路径合成（字段段 + `<item>` 段）。 |
| **E-4 手造 IR 守卫** | 4 类畸形（短于/长于 members、元素非数组、整体非数组）→ `ok:false` 恰一条 `VFSL-E100` 且无 `derived`；良性等长（含全空数组）正控。 |
| **E-5 门禁绿** | `npx tsc -p packages/vfsl/tsconfig.json` exit 0；根 `pnpm typecheck`（14 个 tsconfig）exit 0；`packages/vfsl/test` 存量 607 测试全绿（§4/§13）。 |
| **E-6 规格一致性** | #309 验收，本契约不越界断言规格文本。 |

## 4. Environment and baseline

- 环境：`node v24.13.0`、`pnpm 10.28.2`、`vitest 3.2.7`、`typescript 5.9.3`、`tsx 4.23.12`；`pnpm install --frozen-lockfile` exit 0（65 包，lockfile 未变）。
- 测试入口：`packages/*/test/**/*.test.ts`（根 `vitest.config.ts` include）；类型面 `packages/vfsl/tsconfig.json` include `src/**/*.ts + test/**/*.ts`。
- **改动前基线（HEAD 91c4add，contract 文件尚未创建）**：`NODE_OPTIONS=--conditions=nomicore-source npx vitest run packages/vfsl` → **43 files / 682 tests 全绿，Type Errors: no errors**（含 vfsl-codegen / vfsl-protocol 的路径子串命中）。
- **加入契约文件后**：`npx vitest run packages/vfsl/test` → **34 files / 619 tests：32 files / 607 tests 绿，仅 2 个新契约文件红（12 用例）**——红被限制在新文件内，存量零回归。
- 类型面：`npx tsc -p packages/vfsl/tsconfig.json` exit 0；`pnpm typecheck` exit 0。
- 工作树仅新增 3 个文件（2 测试 + 1 fixture），**零生产实现改动**（`git status` 无 `M` 条目）。

## 5. Positive reproduction（能力缺口复现）

命令：`NODE_OPTIONS=--conditions=nomicore-source npx vitest run packages/vfsl/test/parse-vfsl-union-member-docs.test.ts packages/vfsl/test/evaluate-derived-member-docs.test.ts`
结果：**12 failed | 7 passed (19)**，复现率 **3/3 次运行**（含实现前探针与两轮契约运行，失败集合与失败原因逐字一致）。

| # | 输入（核心形态） | 现行结果 | 目标（契约） |
| --- | --- | --- | --- |
| 1 | `type Status =`⏎`  /** 草稿 */`⏎`  | "draft"` | `ok:false` E305 @(3,3) | ok:true，`memberDocs=[[' 草稿 '],[…],[]]` |
| 2 | `type T = /** 甲 */ "a" \| "b";` | E305 @(2,10) | `[[' 甲 '],[]]` |
| 3 | `type T = "a" /** 乙 */ \| "b";` | E305 @(2,14) | `[[],[' 乙 ']]` |
| 4 | 连续两条 doc（含换行/`@tag`）挂首成员 | E305 @(3,3) | `[[' 一 ',' 二\n * @tag '],[]]`（逐字） |
| 5 | `/** 成员口径 */ \| /** 载体口径 */ YLeaf<"a"> \| YLeaf<"b">` | E305 @(2,10) | `memberDocs=[[' 成员口径 '],[]]` + marker `docs=[' 载体口径 ']`，无双重挂载 |
| 6 | 同模块「有 doc 的联合 + 无 doc 的联合」 | E305 @(3,13) | Pair 有键；Plain 的 `YPlainArray<"x"\|"y">` 内层联合**无键** |
| 7 | derived（AC3）有成员 doc 的 `Status` | 派生物无 `memberDocs`（键集合 = 既有七表） | `{ 'Status.<member 0>': […], 'Status.<member 1>': […] }`（member 2 不成键） |
| 8 | derived 嵌套路径（字段位 + `YArray<…>` 的 `<item>` 段） | 无键 | `X.k.<member 0>`、`V.<item>.<member 0>` |
| 9 | 纯文档性质（有/无成员 doc 对比） | 无 doc 版本绿；有 doc 版本 parse E305（红） | 物化/索引/既有三表全等，仅 memberDocs 差异 |
| 10 | 手造 IR：`memberDocs=[[' x '],[]]`（等长良性） | `ok:true`，但派生物 `memberDocs` 缺席（静默忽略） | `ok:true` + `T.<member 0>=' x '` |
| 11 | 手造 IR：短于/长于 members、元素非数组、整体非数组 | **`ok:true` 静默忽略**（AC5 红灯） | `ok:false` 恰一条 `VFSL-E100`，无 `derived` 载荷 |
| 12 | `E305` 消息正文 | 「…（类型别名 / 属性 / 标记类型），且不相邻…」无「联合成员」 | 前缀不变 + 正文枚举补「联合成员」（决策 9.3） |

## 6. Negative control

| 负控 | 断言 | 状态 |
| --- | --- | --- |
| 多行前导 `\|` 布局剥离成员 doc（同排版） | `ok:true` | 绿（实现后必须保持） |
| `type T = "a" \| "b";`（单行无 doc） | `ok:true` | 绿 |
| `YPlainArray<"x" \| "y">` 内层联合 | 整键 `memberDocs` 不存在，JSON 不含该串 | 绿 |
| `type T = \| /** d */ YLeaf<"a">;`（M3 挂载 + 单成员坍缩） | `ok:true`、doc 在 marker 节点恰出现 1 次、alias JSON 无 `memberDocs` | 绿 |
| 坍缩 `/** d */ "a"` / `/** d */ \| "a"` | E305 @(2,10)（现行逐字节保持） | 绿 |
| 夹缝非标记 `"a" \| /** d */ "b"`（单行 / 多行） | E305 @(2,16) / @(4,5) | 绿 |
| 存量金样本 A/B（IR + semantic 指纹 + derived 摘要） | 精确摘要相等 | 绿（实现前录制） |
| 无成员 doc 模块派生物 | 键集合 = 既有七表、整键缺席、摘要不变 | 绿 |
| 既有 `packages/vfsl/test` 全部测试 | 607/607 | 绿 |

## 7. Stability, scale and timing

- `parseVfsl` / `evaluate` 为同步纯函数（无 Date/random/IO），失败集合三次运行完全一致（12 红 / 7 绿、同一 12 条 FAIL 与同一失败消息）。
- 19 条用例合计 ≈ 0.5 s；单用例 < 10 ms（`--reporter=verbose` 实测）；无竞态、无超时、无规模相关条件。
- 全包运行（含 validate 系列重用例）60.9 s，属既有基线量级，契约文件不引入慢用例。
- 本任务非性能/竞态诊断，无概率性复现项。

## 8. Capability gap chain

| Step | Fact | Evidence | Confidence |
| --- | --- | --- | --- |
| 症状 | 成员前 doc 一律被拒为 VFSL-E305，逐成员语义无处安放 | 探针 + 契约 12 红用例的实测 issue | 高（运行时） |
| 直接故障点 | parser 集中式 dangling 记账只在三个锚位 `claimDocs()` 回收（M1 `parseModule` 别名起点 / M2 `parseObjectType` 字段起点 / M3 `parseMarkerType` 标记名）；`parseUnionType` 消费前导 `\|` 与成员起始记号时**不回收** | `parser.ts:141-144`（next 把 leadDocs 入 dangling）、`parser.ts:151-156`（claimDocs）、调用点 `parser.ts:209 / 522 / 434`、`parser.ts:255-269`（union 消费零回收） | 高（源码符号 + 运行时结果一致） |
| 触发条件 | 联合 ≥2 成员且成员前紧邻 doc：前导 `\|` 前、成员起始记号前 | 契约用例 1~6 的 E305 锚点（注释起始） | 高 |
| 最深根因 | v1-spec §5 冻结「三锚位」；M4 需**延迟回收**（成员数须扫到表达式末尾才知坍缩与否，ADR 决策 4 末段），该机制未实现 | ADR 0019 决策 1/4；`parser.ts:265-268`（坍缩在 union 解析末尾才判定） | 高 |
| IR 面 | `toIRType` union 分支只产 `{kind, members}`，无 `memberDocs` | `semantic.ts:222-223` | 高 |
| derived 面 | `DerivedSchema` 无 `memberDocs`；`collectDocs` 的 `DocsTables` 仅三表；`walkDocs` union 分支只递归 members | `derived.ts:68-84`、`evaluate.ts:333-360`（`DocsTables` / `put` / `appendDocs` / `collectDocs`） | 高 |
| 守卫面 | 手造 IR 的 `memberDocs` 不在 `put/appendDocs` 守卫族入口内 → 长度不符/非数组**静默忽略** | 契约用例 11 实测 `ok:true`；守卫族 `evaluate.ts:344-352` | 高（运行时） |
| 放大因素 | 无 | — | — |
| 未证实假设 | 无阻塞性假设；后修复锚点断言只取「现行实测值」（维持面）与 ADR 明文的键名/等长/条件在场语义 | §12 契约表 | — |

## 9. Causal experiments

| 实验 | 做法 | 观察 | 结论 |
| --- | --- | --- | --- |
| E-a 输入因果 | 同一布局「有 doc / 无 doc」成对解析 | 有 doc → E305；无 doc → ok:true | 失败由 doc 挂载能力缺失引起，非排版/词法 |
| E-b M3 既有行为 | `\| /** d */ YLeaf<"a">`（标记成员夹缝） | 现行 `ok:true`，doc 落在 marker 节点且恰一次 | M3 优先是**既有**行为，M4 不得抢槽/双挂（决策 3） |
| E-c 坍缩维持 | 两种坍缩写法 | 现行均 E305 @(2,10) | 冻结面锚点取自现行实现，非设计推测 |
| E-d 守卫缺失 | 直构 4 类畸形 IR（绕过 `parseVfsl`） | 全部 `ok:true`（key 被忽略） | AC5 的 loud 边界确实不存在 |
| E-e 基线录制 | 实现前计算金样本 A/B 的 IR/derived 摘要与 semantic 指纹 | 3 次运行稳定复现同一摘要（writes 后再次校验一致） | E-1 基线真实、非事后回填；SA8 风险提示闭环 |
| E-f 反证敏感性 | 逐条设计「错误实现必红」映射（见下表） | — | 断言对目标语义敏感，非恒真 |

**Mutation 敏感性（错误实现 → 必红用例）**：

| 错误实现 | 触红用例 |
| --- | --- |
| 前导 `\|` 的 doc 挂到**前一个**成员 | 用例 3（`"a" /** 乙 */ \| "b"` → 期望 `[[],[' 乙 ']]`） |
| 联合内任意 doc 就近挂成员（丢严格相邻） | 夹缝非标记 E305 用例（会变 ok:true） |
| M4 抢走 M3 的夹缝 doc 或双挂 | M3 优先用例（marker `docs` 空 / 成员表出现「载体口径」） |
| 对无 doc 联合也附加 `memberDocs`（空表/等长空槽） | 逐节点负控 + 金样本 A/B（JSON 摘要含新键必不等） |
| 坍缩场景误挂成员/别名 | 坍缩两形态 E305 用例 |
| 连续 doc 只挂最后一条 / 顺序颠倒 | 连续 doc 逐字 `toEqual` 用例 |
| 嵌套联合不按 `<member N>` / `<item>` 合成键 | 嵌套路径用例（键集合精确 `toEqual`） |
| derived 对无成员 doc 模块输出空 `memberDocs` 表 | derived 金样本/键集合用例 |
| 成员 doc 影响物化/索引/既有三表 | 纯文档性质用例（七路 `toEqual`） |
| 畸形 `memberDocs` 用 `?? []` 静默规范化或忽略 | 4 类畸形 E100 用例 |

## 10. Impact surface

- **目标改动面（SA4，ADR 0019 Consequences）**：`packages/vfsl/src/parser.ts`（M4 延迟回收 + AST `union.memberDocs`）、`ir.ts`（条件键）、`semantic.ts`（条件附加 + E305 措辞）、`derived.ts`（条件稀疏表 + 类型注）、`evaluate.ts`（walkDocs 收集 + 手造 IR 守卫）。**本 SA6 未触碰任何生产文件。**
- **既有回归锚点（实现后必须仍绿）**：
  - `resolve-schema-at-path.test.ts:289`：`Object.keys(node)).toEqual(['kind','members'])` → `memberDocs` 只能进 derived 顶层表，**不得**塞进 structure/value 节点；
  - `evaluate-derived-docs-audit.test.ts:183-231`：三表全键集与性质断言（aliasDocs/fieldDocs/markerDocs 键数、无 undefined 全树）；
  - `evaluate-derived-schema.test.ts` / `compile-schema-envelope-sentinel.test.ts`：IR 形状与指纹输入不变（`JSON` 摘要、reorder 敏感性）；
  - `parse-vfsl-jsdoc.test.ts:127`：E305 前缀正则（措辞变更安全）；
  - `tests/acceptance/vfsl_spec_acceptance.py`：只查规格文本，不受消息正文变更影响。
- **范围外（SA8 C-5 登记）**：#307（codegen 四发射位 + `generate --check`）、#308（`resolveSchemaAtPath` 第三来源合并）、#309（v1-spec §5 / 编写指南 / 检查表 + 全仓「三锚位」措辞）。本契约不覆盖、SA7 不得据此判缺陷。

## 11. Ruled-out hypotheses

| 假设 | 排除证据 |
| --- | --- |
| 环境/依赖/入口错误 | 实现前 43 files / 682 tests 全绿；root typecheck exit 0；同文件内负控用例绿 |
| tokenizer doc 侧通道缺陷 | M1/M2/M3 挂载与金样本全绿；载荷逐字（含换行/`*`/`@tag`）已验证 |
| 探针/测试自身的排版或锚点错误 | 首轮唯一因「我的锚点笔误」失败的多行夹缝用例已改为现行实测 (4,5) 后转绿；其余红因全部为 E305/缺键 |
| 「这是 bug，需修根因」 | v1-spec §5 现行文本要求三锚位 + E305；ADR 0019（已接受、未被取代）显式授权 M4——按 Feature 处理，不虚构 bug 根因 |
| 契约红是「实现自由度」误伤 | 所有红断言直接落在 ADR 决策 1/3/4/5/8/9.3 与 issue AC1~AC5 的明文语义上；措辞断言用容忍正则 `联合.{0,6}成员` |
| 需要 mock 才能观察 | 全部断言经公共接缝 `parseVfsl` / `evaluate` 的运行时返回值，无 mock、无源码字符串断言 |

## 12. Acceptance contract and test paths

**测试文件（新增）**

| 路径 | 内容 |
| --- | --- |
| `packages/vfsl/test/parse-vfsl-union-member-docs.test.ts` | AC1/AC2/AC4：M4 解析挂载、IR 条件键、E305 维持面、措辞、IR/指纹金样本（13 用例） |
| `packages/vfsl/test/evaluate-derived-member-docs.test.ts` | AC3/AC5/决策 8：derived 条件稀疏、嵌套路径、纯文档性质、手造 IR 守卫（6 用例） |
| `packages/vfsl/test/union-member-docs-fixture.ts` | 数据 fixture：v1-spec §10 fixture 逐字节副本 + 联合密集 fixture（不被 vitest 收集） |

**AC → 用例映射（红=目标行为未实现；绿=必须保持/存量稳定，实现后必须仍绿）**

| # | issue AC / ADR 决策 | 用例 | 断言（运行时可观察） | 现状 |
| --- | --- | --- | --- | --- |
| 1 | AC1 / 决策 1 | 多行前导 `\|` 布局 | `memberDocs=[[' 草稿：可继续编辑 '],[' 已提交：只可追加备注 '],[]]`、等长、JSON 往返 | 红 |
| 2 | AC1 / 决策 1 | 单行首成员 | `[[' 甲 '],[]]` | 红 |
| 3 | AC1 / 决策 1 | doc 紧邻 `\|` 之前 | `[[],[' 乙 ']]`（挂后继成员） | 红 |
| 4 | AC1 | 连续多条 doc | 逐字 `[[' 一 ',' 二\n * @tag '],[]]` | 红 |
| 5 | AC4 / 决策 4 | 逐节点条件附加（同模块混排） | Pair 有键；Plain 内层联合无 `memberDocs` 键 | 红 |
| 6 | AC4 / 决策 4 | 逐节点条件附加（负控） | 无 doc 联合整键不存在且 JSON 不含该串 | 绿 |
| 7 | AC2 / 决策 3 | M3 优先不双挂 | 成员表含「成员口径」、marker `docs=[' 载体口径 ']` 恰一次 | 红 |
| 8 | AC2 / 决策 2 | 坍缩两形态维持 E305 | `^VFSL-E305: ` @(2,10) | 绿 |
| 9 | AC2 / 决策 1 | `\|` 夹缝非标记 E305 | @(2,16)（单行）/ @(4,5)（多行） | 绿 |
| 10 | 决策 2/3 | M3 优先的坍缩形态（负控） | `ok:true`、doc 恰一次、无 `memberDocs` | 绿 |
| 11 | AC2 / 决策 9.3 | E305 消息措辞 | 前缀不变 + `/联合.{0,6}成员/` | 红 |
| 12 | AC3 / 决策 5 | derived 条件稀疏 + `<member N>` | 键序 `Status.<member 0|1>`、只收非空、member 2 不成键 | 红 |
| 13 | AC3 / 决策 5 | 嵌套路径合成 | `X.k.<member 0>`、`V.<item>.<member 0>` | 红 |
| 14 | AC3/AC4 / 决策 5 | 无成员 doc 派生物 | 键集合=既有七表、整键缺席、JSON 摘要 = 金样本 | 绿 |
| 15 | 决策 8 | 纯文档性质 | 七路 `toEqual` 全等 + 派生物确有差异 | 红 |
| 16 | AC5 / 决策 5 | 手造 IR 良性正控 | 无键/等长良性 `ok:true`；全空数组不产生空表 | 红 |
| 17 | AC5 / 决策 5 | 手造 IR 畸形 → E100 | 4 类畸形：恰一条 `VFSL-E100`、无 `derived` | 红 |
| 18 | AC4 / 决策 4 | IR 金样本 A（v1-spec §10） | IR SHA-256 `325cf923…f3ffc`、指纹 `sha256:v1:b71be76e…0631c` | 绿 |
| 19 | AC4 / 决策 4 | IR 金样本 B（联合密集） | IR SHA-256 `78332590…be71`、指纹 `sha256:v1:55095e88…144d` | 绿 |

金样本录制值（实现前 HEAD `91c4add`，SA4 不得重录）：

| 样本 | IR JSON SHA-256 | semantic 指纹 | derived JSON SHA-256 |
| --- | --- | --- | --- |
| v1-spec §10 fixture | `325cf923c4de04b72920699fab0ce33ef381c72fe5e2c6fe801394894d4f3ffc` | `sha256:v1:b71be76e3d3579670236b14a36373716db6238d86a15da440f44aecbb9b0631c` | `2335a0236fd20572999d3126de6dae5aa30e954ea5bb070ffcb5c8847df0375b` |
| 联合密集 fixture B | `78332590a86d3b2bb084fb377182fec5f161dd62e82d8d8cb136c33cafb4be71` | `sha256:v1:55095e88e08a923ec64c3fbe006d533fb735684a0987e7b974c5ab4cf5b5144d` | `547748b6dcbe75a236ab3c88f30c31188bf8f8324bdaa8e9aac2a393c509492f` |

## 13. Red/green or baseline evidence

**红（12，全部红因为「能力缺口 / 键缺席 / 措辞未补」，无环境或入口型红）**

| 用例 | 实测首因（压缩） |
| --- | --- |
| 多行前导 `\|` 布局 | `VFSL-E305 … @(3,3)`（前导 `\|` 前 doc） |
| 单行首成员 | `VFSL-E305 … @(2,10)` |
| doc 紧邻 `\|` 之前 | `VFSL-E305 … @(2,14)` |
| 连续多条 doc | `VFSL-E305 … @(3,3)` |
| 逐节点条件附加（混排） | `VFSL-E305 … @(3,13)` |
| M3 优先不双挂 | `VFSL-E305 … @(2,10)` |
| E305 消息措辞 | `'VFSL-E305: …（类型别名 / 属性 / 标记类型）…' to match /联合.{0,6}成员/` |
| derived 条件稀疏 | `VFSL-E305 … @(3,3)`（前置 parse 失败） |
| derived 嵌套路径 | `VFSL-E305 … @(2,15)`（前置 parse 失败） |
| 纯文档性质 | `VFSL-E305 … @(3,3)`（前置 parse 失败） |
| 手造 IR 正控 | `expected [] to deeply equal [ 'T.<member 0>' ]`（良性 memberDocs 被忽略） |
| 手造 IR 畸形 | `短于 members: 应 loud 失败: expected true to be false`（静默忽略） |

**绿（7，实现后必须仍绿）**：坍缩两形态 E305、`\|` 夹缝非标记 E305、M3 坍缩负控、逐节点条件附加负控、derived 无 doc 稳定、IR 金样本 A、IR 金样本 B。

**runner 汇总**：`Test Files 2 failed (2)`、`Tests 12 failed | 7 passed (19)`、`Type Errors: no errors`（vitest 内建 typecheck 对 `*.test-d.ts` 无新增、无错误）。

**存量回归**：`npx vitest run packages/vfsl/test` → `32 passed | 2 failed (34 files)`、`607 passed | 12 failed (619)`；两个失败文件即本契约新增文件。实现前同一入口（无新文件）为 682/682 全绿（更宽的 `packages/vfsl` 过滤）。

**类型门禁**：`npx tsc -p packages/vfsl/tsconfig.json` exit 0；`pnpm typecheck`（14 个 tsconfig，含 vfsl-codegen / namespace-runtime / ws-replication / apps/yjs-server）exit 0。

## 14. Runner trigger evidence

- 配置发现：根 `vitest.config.ts` `include: ['packages/*/test/**/*.test.ts', …]` 命中两个新文件；fixture 模块不被收集（`vitest list` 输出 19 条全部来自 2 个测试文件）。
- `npx vitest list packages/vfsl/test/parse-vfsl-union-member-docs.test.ts packages/vfsl/test/evaluate-derived-member-docs.test.ts` → 列出 19 条用例（13 + 6），无 skipped。
- skip/only/todo/env-override 扫描：`grep -nE "\.(skip|only|todo)\("` 三个新文件命中 **0**；契约不读环境变量、无 fallback/吞错分支。
- 类型包含：`packages/vfsl/tsconfig.json` include `test/**/*.ts` → 3 个新文件均被 `tsc` 覆盖（exit 0）。
- 全量运行可见性：`npx vitest run packages/vfsl/test` 的文件清单同时列出两个新文件与其红/绿计数。

## 15. Unknowns and blockers

- **无阻塞项**；诊断与契约足以进入实现（SA4）阶段。
- 残留风险（供 SA7 静态/动态复核，非停止条件）：
  1. 契约以**运行时**断言为准（skill 要求）；ADR 决策 4/5 的**类型声明** `memberDocs?: string[][]` / `memberDocs?: Record<string, string[]>` 不由本契约的 type-level 用例锁定（避免锁死 `readonly` vs 可变等实现自由度）——SA7 需以 typecheck + 只读审查确认类型面同步。
  2. 措辞断言用容忍正则 `/联合.{0,6}成员/`（接受「联合成员」「联合（枚举）成员」「联合的成员」）；若实现完全不提联合成员，按 issue/决策 9.3 应红。
  3. 契约交付即红：在 SA4 落地前 CI 的 vitest 门禁为红（SA6 红灯交付的仓库既有先例，如 `parse-vfsl-jsdoc.test.ts` 首版）。
  4. 金样本按「IR/derived 键插入序 + 紧凑 JSON」逐字节锁定：任何重排键序、补空槽、二次规范化的实现都会（正确地）触红——C-2 的强制口径。
  5. #307（codegen）/ #308（投影切片）/ #309（规格文本）不在本契约面内（C-5）；PR #305 收官清单仍需另行核对 #307/#308/#309。
  6. 未跑根 `pnpm test` 全仓（E-5 的 #306 验收面 = `packages/vfsl` 包测试 + typecheck）；已额外跑「`packages/vfsl` 路径全量 682 绿」与根 typecheck 14/14 绿，跨包影响面已覆盖。

## 16. Temporary diagnostics cleanup

- 临时探针/生成器/日志已删除：`.scratch/probe-306.ts`、`probe-306b.ts`、`probe-306c.ts`、`probe-306d.ts`、`gen-fixture-306.ts`、`verify-fixture-306.ts`、`red-run-306*.log`、`full-vfsl-run-306.log`、`root-typecheck-306.log`（`.scratch/` 现仅剩既有 SA8 报告与 `vfsl-v1-parser/`）。
- 未修改任何生产实现；`git status` 仅新增：`packages/vfsl/test/parse-vfsl-union-member-docs.test.ts`、`packages/vfsl/test/evaluate-derived-member-docs.test.ts`、`packages/vfsl/test/union-member-docs-fixture.ts`（外加 Host/SA8 既有的 `wiki/raw/task_issue-306.md`、`.scratch/sa8-conflict-report-issue-306.md`）。
- 无后台服务/进程遗留（本任务全部命令为前台或已完成的 Job）。

---

**复审命令**

```bash
cd /home/wangjian/nomicore-fix-issue-306
NODE_OPTIONS=--conditions=nomicore-source npx vitest run \
  packages/vfsl/test/parse-vfsl-union-member-docs.test.ts \
  packages/vfsl/test/evaluate-derived-member-docs.test.ts   # 期望（实现前）12 红 / 7 绿
npx vitest run packages/vfsl/test                            # 存量面：仅 2 新文件红
npx tsc -p packages/vfsl/tsconfig.json && pnpm typecheck    # exit 0
```
