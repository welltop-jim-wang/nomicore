# SA6 诊断与验收契约 — Issue #335 `[shape-budget] T2: 投影通道形状预算——解析入口三参化与截断标记`

- 派发：`sa-608a14e5-d4cc-426d-8c07-b21bf68d76c7`（role `mabf-sa6`，phase `acceptance-contract`，iteration 0）
- Worktree：`/home/wangjian/nomicore-fix-issue-335`（branch `mabf/issue-335`，HEAD `ba11f328ae845bf882d131a2098a7afc8dfcc17c`；已含 PR #332 支上 ADR 0024 三次提交 `50d52a1`/`7679c57`/`ba11f32`）
- 任务类型：**Feature**（ADR 0024 决策 5 已接受、投影通道预算未落地 = 能力缺口；不虚构 Bug 根因）
- 派发约束：**只做诊断与契约定义，不实现代码、不新增测试**——红在 HEAD 由最小复现 probe 实跑证明（§5/§13），契约断言组与测试路径在本报告钉死（§12），测试文件由下游实现迭代落盘
- 上游：SA8 冲突门禁 `clear`（no-conflict 3 / implements-existing-decision 8 / evolution 0 / hard-conflict 0）+ `requiresConflictRecheck=true`；Issue comments REST 读取 `[]`（无 owner 要求、无可应用 comment）

## Verdict

`approve` —— 能力缺口已证实且可用最小复现稳定呈现：公共入口 `resolveSchemaAtPath` 现为两参（`fn.length === 2`），第三参 `options` 在运行时被**静默忽略**（7 条路径上 `{depth:0}`/`{maxChildrenPerNode:1}` 调用与无预算调用 `JSON.stringify` 逐字节相等、marker 命中 0），类型面三参调用报 `TS2554`、公共 index 无预算投影包装类型名目（`TS2724`）。SA8 的 11 项对照与 6 条 required actions 已逐条落为契约断言组 G0–G10（§12）；负控（无预算逐字节锚 + 既有 651 用例）在 HEAD 全绿；测试入口真实（vitest include / typecheck.include / 包 tsconfig 均实测命中）。ADR 未逐字钉死的实现自由位（标记节点字段名、ref 体内标记归属、options 失败码位、计层原点）在 §15 列为 SA1 必须收口的设计 pin，并全部映射为 SA8 后置 recheck 的核对项。**无 blocker。**

---

## 1. 任务类型与输入

| 输入 | 路径 | 用途 |
|---|---|---|
| 任务简报 | `wiki/raw/task_issue-335.md` | Issue #335 正文「What to build」+ AC1–AC5；`Comments` 空 |
| Issue-comments REST 快照 | 派发说明 | `[]`——无 owner 评论要求、无 comment ID/时间戳可应用 |
| SA8 冲突门禁 | `wiki/raw/task_issue-335_conflict_report.md` | Verdict `clear`；§8 required actions 1–6；§10 `requiresConflictRecheck=true`（a 公共 API/类型面、b 两项 override 落地、c 跨 T1/T2/T3 计层一一对应） |
| SA8 决议摘录 | `wiki/raw/task_issue-335_relevant_decisions.md` | ADR 0024/0016/0003/0019/0008 条款行号摘录 + 模块契约 + 现状事实 1–3 |
| 母法 | `docs/adr/0024-readdata-shape-budget.md` L29–30/L69–81/L97–105/L114–118/L120–131 | 决策 5 全段（三参化 L79、截断节点选型 L77、同 depth 裁剪 L73、width 无操作 L74、两通道计层对齐 L81）+ 修订节第 3 条 L103 + 验收 L122/L125 |
| 既有母法 | `docs/adr/0016-readdata-semantic-schema-projection.md` L30–42/L50–58/L60–65/L69–76；`docs/adr/0003` L22/L26–27/L46；`docs/adr/0019` L132–137 | 投影体四件套、签名条款（经 0024 加法修订）、解析语义继续有效条款、ValueSchema 冻结面、docs 三源合并纪律 |
| 术语面 | `CONTEXT.md` L41–46 | 「语义 schema 投影」预算段（截断标记=投影层、非新 kind、非值哨兵）+「形状预算」词条 |
| 现状实现锚 | `packages/vfsl/src/resolve-schema-at-path.ts` L49–61/L92–95/L380–419/L434–496；`packages/vfsl/src/index.ts` L125–126；`packages/namespace-runtime/src/read-schema-projection.ts` L42–58/L121–181；`packages/namespace-runtime/src/runtime.ts` L127/L486；`packages/doc-runtime/src/read.ts`（无 options） | 两参签名、投影体、闭包/切片全量收集、公共出口、组合消费与逐 kind 深拷贝、T1/T3 未落地 |
| 现存测试 | `packages/vfsl/test/resolve-schema-at-path*.test.ts`、`resolve-schema-at-path.test-d.ts`、`resolve-schema-at-path-*-fixture.ts`（#272 契约/负控/成员文档/pattern 错误）；`packages/namespace-runtime/test/runtime-readdata-schema-projection-red.test.ts`（恰三键锚） | 基线与回归锚、夹具复用、不得触碰的既有断言 |
| 运行入口 | `vitest.config.ts`、`package.json`、`packages/vfsl/tsconfig.json`、`tsconfig.base.json`、`tsconfig.typecheck.json` | 测试发现、门禁、跨包解析条件 |

本 iteration 无 SA1 设计产物（`wiki/raw/task_issue-335_design.md` 不存在）。SA1 若对 §12/§15 的契约或 pin 另有选择，须先原位修订本契约并触发 SA8 复核。

## 2. Owner 评论映射

无 owner 评论：REST Issue-comments 读取为 `[]`，不存在评论来源的 override 或附加义务。契约全部义务 = Issue #335 正文 AC1–AC5 + ADR 0024 决策 5（SA8 判定 8 项 `implements-existing-decision` + 3 项 `no-conflict`）。AC → 契约落点见 §12.1。

## 3. SA8 约束采纳

SA8 §8 required actions 逐条落点：

| # | SA8 required action | 契约落点 |
|---|---|---|
| 1 | 按 ADR 0024 决策 5 钉死选型：预算在解析递归内生效（先裁后收集、单遍历收缩三件事）；禁 namespace-runtime 事后裁剪；禁值域哨兵与 ValueSchema 扩 kind | G2（计层规则）/G3（标记）/G4（闭包收缩）/G5（切片收缩）在 vfsl 单元面断言；G1.4 `ValueSchema['kind']` 九 kind 冻结 + 运行时逐节点 kind 扫描；G9.1 改动面门禁（只 `packages/vfsl/src`）；G9.5 变异敏感性 D8（事后裁剪必红） |
| 2 | 公共面出口纪律：三参签名与投影包装联合只经 `packages/vfsl/src/index.ts` 导出 | G1.1/G1.2（test-d 从 `../src/index.js` 导入三参函数、options 类型、包装联合类型）+ G9.1 |
| 3 | SA1 设计收口点：resolver 层 `options` 校验失败通道与码位须为判别联合、不 throw、无 options 路径零开销零语义变化 | G7（运行时：非法 options → 判别失败；稳定码 = SA1 pin，Q4）；G8（无 options 逐字节锚） |
| 4 | 回归锚：无 options 逐字节恒等 + 仅 width 触发时投影与无预算读逐字节相等（0024 L122/L125） | G8.1–G8.3（冻结哈希表 + `undefined` 显式第三参 + 充足 depth ≡ 无预算）、G6（width no-op） |
| 5 | 越界禁令：不动 doc-runtime / namespace-runtime / registry 公共面；不动 readData 文档负控正则（T5） | G9.1 门禁 + G9.2 根 typecheck（namespace-runtime 逐 kind 深拷贝编译通过）+ §10 明确不改面 |
| 6 | （阶段建议，非本票）ADR 0016 回填修订批注 | 本契约不纳入；报告 §10 记为范围外 |

SA8 §10 `requiresConflictRecheck=true` 三项在后置复核中的核对物：

- **(a) 公共 API/类型面**：G1.1–G1.5（三参签名、options/包装类型公共出口、无预算结果类型保持 `ValueSchema` 纯度、九 kind 冻结）；尤其 `packages/namespace-runtime/src/read-schema-projection.ts` L121–181 的 `switch (node.kind)` 无 default 穷举——**无预算路径的静态类型若被包装联合污染，根 typecheck 必红**（G9.2）。
- **(b) §4 两项正式 override 落地**：无 options 逐字节恒等（G8）+ 无预算读恒纯 `ValueSchema`（G1.3）+ override 范围不扩大（G1.4 九 kind、G9.1 改动面）。
- **(c) 跨票预算计层一一对应（T1 #334 / T2 / T3 #336）**：T2 交付 vfsl 单元面计层规则与可复用 oracle（G2 + §12.4 矩阵 + G10），T3 组合时必须差分核对「值截断条目路径 ↔ 投影标记路径」（G10.2 recipe）。T1/T3 未落地（§4 现状），本契约不越界代验。

## 4. 环境与基线

- 运行时：Node v24.13.0；pnpm 10.28.2；vitest 3.2.7、typescript 5.9.3、tsx 4.23.12。
- 依赖：`pnpm install --frozen-lockfile --offline` → exit 0（16 workspace projects，65 包全部 store 复用）；pnpm 提示 `esbuild@0.28.2` build script 被忽略——实测 vitest/tsx/tsc 全部可用，未影响任何门禁。
- **基线（HEAD `ba11f32`，未做任何改动）**：

| 命令 | 结果 |
|---|---|
| `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/vfsl/test --typecheck` | exit 0；**37 files / 651 tests passed；Type Errors: no errors**（61.33s） |
| `pnpm typecheck`（root，14 个 tsc project） | exit 0 |
| `pnpm test`（root，全部 packages/domains/apps + `--typecheck`） | exit 0；**338 files / 3588 tests passed；Type Errors: no errors**（622.64s） |
| `pnpm exec tsc -p packages/vfsl/tsconfig.json` | exit 0（覆盖 `src/**/*.ts` + `test/**/*.ts`） |
| `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run --typecheck.only` | exit 0；**27 files / 146 tests passed；Type Errors: no errors**；其中 `packages/vfsl/test/resolve-schema-at-path.test-d.ts (3 tests)` 已在收集清单 |

- 现状（源码确认，不构成决策依据）：`resolveSchemaAtPath` 两参（`resolve-schema-at-path.ts` L92–95）；`ReadDataSchemaProjection.valueSchema: ValueSchema`（L49–61）；闭包全量收集（L380–419）、docs/aliasDocs 全量选键（L434–496）；`packages/vfsl/src/index.ts` L125–126 是唯一公共出口；`maxChildrenPerNode`/`READ_OPTIONS_INVALID` 在 `packages/`、`apps/`、`domains/` 源码**零命中**（仅 `docs/adr/0024`、`CONTEXT.md` L46 有词）；`packages/doc-runtime` 无 options 参数（T1 #334 未落地）；`namespace-runtime` readData 成功分支仍恰三键（T3 #336 未落地）——T2 为 vfsl 单元面独立可交付切片。
- 运行入口：`vitest.config.ts` → `include: ['packages/*/test/**/*.test.ts', ...]`、`typecheck.include: ['packages/*/test/**/*.test-d.ts', ...]`、`maxWorkers: 1`；跨包源码解析走 `customConditions: ["nomicore-source"]` + `NODE_OPTIONS=--conditions=nomicore-source`（无需 build）。

## 5. 正例复现（能力缺口，HEAD 实测红）

Feature 无「运行时故障」，可复现的是**能力缺口**：解析入口无法表达预算，第三参被静默吞掉。全部 probe 为临时 stdin/inline 脚本，未落盘（§16）。

**P1 — 运行时第三参静默忽略（探针脚本，fixture = 既有 #272 `FIXTURE_TEXT`）**：

```
fn.length = 2
path=[]                     full=ok aliases=[Audit,AssetEntity,U] docsKeys=5 depth0-identical=true width1-identical=true markerHits=0
path=["audit"]              full=ok aliases=[Audit]              docsKeys=2 depth0-identical=true width1-identical=true markerHits=0
path=["assets"]             full=ok aliases=[AssetEntity,Audit] docsKeys=1 depth0-identical=true width1-identical=true markerHits=0
path=["assets","img1"]      full=ok aliases=[AssetEntity,Audit] docsKeys=1 depth0-identical=true width1-identical=true markerHits=0
path=["u"]                  full=ok aliases=[U]                  docsKeys=0 depth0-identical=true width1-identical=true markerHits=0
path=["config"]             full=ok aliases=[]                   docsKeys=1 depth0-identical=true width1-identical=true markerHits=0
path=["keywords"]           full=ok aliases=[]                   docsKeys=1 depth0-identical=true width1-identical=true markerHits=0
```

判读：7/7 路径上 `resolveSchemaAtPath(derived, p, {depth:0})` 与 `(derived, p, {maxChildrenPerNode:1})` 的 `JSON.stringify` 与无预算调用**逐字节相等**，序列化结果 marker 词元命中 0——预算语义完全缺失；函数对象 `length` 为 2，第三参在 JS 运行时可传但被忽略。

**P2 — 类型面/公共面缺口（临时探针文件，编译后即删；§16）**：

```
test/.probe-335-budget-type.ts(12,53): error TS2554: Expected 2 arguments, but got 3.
test/.probe-335-budget-type.ts(16,15): error TS2724: '"../src/index.js"' has no exported member named
  'BudgetedReadDataSchemaProjection'. Did you mean 'ReadDataSchemaProjection'?
```

判读：三参调用在 HEAD 类型编译即红（TS2554）；公共 index 无任何预算投影包装类型名目（TS2724 于占位名）——名称由 SA1 钉死（Q3），机制不变（无公共预算类型出口）。

**P3 — 「遍历不越过裁切边界」哨兵（能力缺口的因果性实据）**：在既有 fixture 的 JSON 深拷贝上，把 `values.AssetEntity.members[0].fields.audit.value.name` 改为未声明别名 `MissingAlias`（仅经闭包/展开遍历可达）：

```
clean   no-options      = ok
poison  no-options      = THROW:InternalError:值树未声明别名: MissingAlias
poison  {depth:0}       = THROW:InternalError:值树未声明别名: MissingAlias
poison  {depth:9}       = THROW:InternalError:值树未声明别名: MissingAlias
poison  {maxChildren:1} = THROW:InternalError:值树未声明别名: MissingAlias
```

判读：HEAD 上 `{depth:0}` 仍全量遍历（第三参被忽略），故 poison 照抛。目标实现下 `{depth:0}` 必须 `ok`（ROOT 折叠、绝不触达 `ROOT.assets.<key>.audit`），而同一毒化派生物的无预算读仍必须 `throw InternalError`（可信域畸形通道不变）——该差分同时是「零越界遍历」与「先裁后收集」的行为级锚。

**AC → 缺口映射**：AC1（标记位置/线索）无实现；AC2（闭包/切片收缩）无实现（P1 显示闭包/切片恒为全量）；AC3（计层规则/width 无操作）无实现；AC4（包装类型进公共面/无 options 逐字节回归）类型面无出口（P2），无 options 路径今日逐字节可锚（P1）；AC5（门禁）基线已绿（§4）。

## 6. 负控

| 负控 | 构造 | HEAD 实测 |
|---|---|---|
| 无预算逐字节回归锚 | 既有 #272 fixture 14 条路径 `JSON.stringify(result)` 冻结哈希（§13 表） | 全绿（现行为即基线） |
| 既有 #272 契约/负控/成员文档/pattern 错误测试 | `resolve-schema-at-path*.test.ts`（34+11+16+4 用例） | 全绿（含「ref 缺失 → InternalError」「两码失败联合」「path 新鲜副本」） |
| 既有组合面回归 | `namespace-runtime` 读投影测试（恰三键 `{ok,value,schema}`、`schema:null` 三情形、D5 深拷贝） | 全绿（T2 不得触碰） |
| 环境/夹具前提 | `parseVfsl` + `evaluate` 对 fixture ok；`derived.values` 五别名表在场 | 全绿（P1/P3 前置不变量） |
| 诚实对照（能力缺口非环境） | 无预算调用在同一 fixture 上 ok（P1）；毒化派生物无预算读 throw（P3） | 绿/throw 各就位——红只在「预算语义」断言处 |
| width-only 今日「恰好」相等 | `{maxChildrenPerNode:1}` 与无预算逐字节相等（P1） | 今日因参数被忽略而相等，**不得作为 width no-op 的绿灯证据**；目标实现须在预算真实生效后重新断言（G6） |

## 7. 稳定性、规模与时序

- 解析器为同步纯函数：全部断言单次调用完成，无异步/计时/并发维度；无概率性。
- 重复率：P1/P3 同型结果重复运行一致（无随机源，§9 E4 两次独立进程哈希 diff 为空）；`resolveSchemaAtPath` 零 memo（ADR 0016 L65），契约以此断言跨调用无状态（G8.4）。
- 规模面：预算递归的新增成本只应随**展开层**增长；契约以 P3 的越界遍历哨兵（行为级、O(1) 构造）替代性能基准断言——「先全量遍历再裁剪」的退化实现会因触达 poison 而红（§12.5 D4/D8）。不设任何时间阈值断言。
- 边界输入：depth ∈ {0, 1, 2, 极大}；width ∈ {0, 1, 3, 极大}；options ∈ {缺省, `{}`, `undefined`, 非法值, 未知键, 非对象}；path ∈ {`[]`, 浅路径, 深路径, 别名内部路径, 失败路径}。

## 8. 能力缺口链

| 步 | 事实 | 证据 | 置信 |
|---|---|---|---|
| 症状 | 预算读的「省」无法在投影通道成立——`readData` 组合预算时投影仍全量（ADR 0024 动机段），调用方拿不到「被截处是什么类型」的口径 | ADR 0024 L71–83 | 高（母法） |
| 直接缺口 | `resolveSchemaAtPath` 两参签名；第三参运行时静默忽略；无截断标记、无闭包/切片收缩 | P1（`fn.length=2`、7/7 逐字节相等、marker 0）；源码 L92–95/L380–496 | 高（HEAD 实跑） |
| 触发条件 | 任何携带 `{depth}` 的调用——返回与无预算读逐字节相同（且不报错） | P1 | 高（实测） |
| 类型面缺口 | 三参调用 TS2554；公共 index 无预算投影包装类型名目 | P2 | 高（tsc 实测） |
| 上游依据 | ADR 0024 决策 5 明文指派 `@nomicore/vfsl` 加法三参化 + 投影层包装联合 + 同遍历收缩；备选否决锁定「不做 namespace-runtime 事后裁剪」「不扩 ValueSchema kind」 | ADR 0024 L73–81、L114–118、L103；SA8 §8 | 高 |
| 未实现面 | 全仓无预算标识符（仅文档词条）；T1/T3 均未落地 | §4 现状；grep 零命中 | 高 |
| 未证实假设（需 SA1 收口） | 标记节点字段名/判别式、ref 体内标记归属、options 失败码位、计层原点与 d=0 目标呈现 | ADR 未逐字钉死 | 见 §15 Q1–Q9 |

## 9. 因果实验

| 实验 | 控制 | 观察 | 结论 |
|---|---|---|---|
| E1 第三参语义 | 同一 fixture、同一路径：无预算 vs `{depth:0}` vs `{maxChildrenPerNode:1}` | 三者在 7 路径 `JSON.stringify` 逐字节相等 | 缺口根因 = 预算参数未被解释（不是夹具/环境） |
| E2 类型面 | 三参调用编译 vs 现两参签名 | TS2554；占位包装类型 TS2724 | 公共 API/类型面确无预算出口 |
| E3 越界遍历哨兵 | 同一毒化派生物：无预算读 vs `{depth:0}` 读 | 两者皆 throw（HEAD）；目标实现前者 throw、后者必须 ok | HEAD 无「先裁后收集」；差分可作目标断言与变异传感器 |
| E4 基线确定性 | 14 路径 + derived 哈希，两次独立进程复算 | 输出 `diff` 为空（逐字节一致） | 回归锚可冻结、无随机序 |
| E5 敏感性设计（待实现期执行，§12.5） | D1–D9 变异实现 | 每个变异必须让指定断言红 | 契约断言对根因/目标行为敏感，非空洞绿 |

## 10. 影响面

**改造面（本票唯一）**：`packages/vfsl/src/resolve-schema-at-path.ts`（预算递归、计层、标记、闭包/切片收缩）+ `packages/vfsl/src/index.ts`（公共出口：三参签名已有导出，新增 options 类型与投影包装联合类型出口）。

**公共面契约变化（SA8 §4 override 落地面）**：

| 面 | 现形态 | 目标形态 | 约束 |
|---|---|---|---|
| `resolveSchemaAtPath` 签名 | `(derived, path)` | `(derived, path, options?)` 加法 | 无 options 签名与行为逐字节不变；`undefined` 显式第三参 ≡ 缺省 |
| 结果 ok 分支 `valueSchema` 字段类型 | `ValueSchema` | 预算读下为投影包装联合（可含截断标记） | 无预算读恒纯 `ValueSchema`；`ValueSchema` 九 kind 冻结面零改动（ADR 0003 L46） |
| `aliases` 字段类型 | `Record<string, ValueSchema>` | **待 SA1 pin（Q1）**：若允许别名体内出现标记则同样加宽；否则保持纯 `ValueSchema` | 加宽即扩大 override 范围，须 SA8 复核 |
| 失败分支 | 两码 `SCHEMA_PATH_NOT_FOUND`/`SCHEMA_PATH_INVALID` + path 新鲜副本 | 追加 options 校验失败形态（判别联合、不 throw；码位 SA1 pin） | 既有两码语义/回显/throw 通道（`InternalError`）不变 |
| `docs`/`aliasDocs` | 全量选键 | 选键集合随展开层收缩 | 键文法、三源合并序（field→marker→member）、memberDocs 缺席兼容不变 |

**跨包只读耦合（本票不得改，但会被根 typecheck 保护）**：

- `packages/namespace-runtime/src/read-schema-projection.ts` L56 以**两参**调用 resolver；L106–181 `detachReadSchemaProjection`/`cloneValueSchema` 对 `ValueSchema` 逐 kind 穷举、无 default。若两参结果的静态 `valueSchema` 被包装联合污染，该包 typecheck 必红 → T2 必须保证无预算路径类型纯化（G1.3/G9.2）。
- `packages/namespace-runtime/src/runtime.ts` L127/L486 成功分支恰三键；`runtime-readdata-schema-projection-red.test.ts` 的恰三键/`schema:null` 断言是本票回归锚（T3 #336 才改五键）。
- `packages/doc-runtime` 无 options（T1 #334 未落地）；`packages/namespace-registry/test/readdata-docs-adr0016-contract-fixture.ts` L30/L110 的 `readDataOptionUsages` 只匹配 `readData(` 带参用法、不覆盖 `resolveSchemaAtPath`——T2 测试/注释不触该负控，正则修订属 T5 #338。

**明确不改（可验证排除面）**：`derived.ts` ValueSchema/DerivedSchema 形状、`evaluate`/`validate-patch`/`pattern`、两个 runtime 包、registry、docs/ADR（除本报告外任何文档）、`.github` 工作流、`packages/namespace-registry` 文档负控。

**票谱系依赖**：T1 #334（值通道三参化，doc-runtime）与 T3 #336（readData 五键组合）未落地——本票独立可交付；两通道一一对应（ADR 0024 L81）的组合验收属 T3，本票交付其单元面前提（§12.4/G10）。

## 11. 排除的假设

1. **「预算已在别处/别名下实现」**——`maxChildrenPerNode`/`READ_OPTIONS_INVALID` 在 `packages|apps|domains` 零命中；P1 运行时第三参被忽略、P2 类型面无出口 → 排除。
2. **「第三参今日会被响亮拒绝或有守卫」**——实测静默忽略（P1：逐字节相等、不抛）。红契约不得假设会抛错；实现也不得新增「未知实参抛错」路径（无 options 路径零开销零语义变化）。
3. **「width 今日已对投影无操作可作绿灯」**——今日相等只因参数被忽略（P1）；G6 必须在预算真实生效后重验（负控表注）。
4. **「T2 需要动 doc-runtime/namespace-runtime」**——SA8 §8.5 越界禁令；ADR 0024 决策 5 明确否决事后裁剪选型；两包现状确认无 options/五键 → 排除。
5. **「截断标记可作为 ValueSchema 新 kind」**——ADR 0024 L115 + ADR 0003 L46 明文否决；G1.4 以九 kind 类型恒等 + 运行时逐节点扫描守卫 → 排除。
6. **「ref 可以内联展开以简化预算」**——ADR 0003 L26–27「按名引用、不内联展开」；ADR 0024 L81「ref 为终态边界」；G2.5 断言 ref 节点保留 + 闭包按名 → 排除。
7. **「既有 651 用例已覆盖逐字节回归」**——#272 断言以 `toEqual` 内容相等为主，不锁键序/序列化字节；G8 追加冻结哈希锚 → 部分排除，须补字节锚。
8. **「源码字符串/正则断言可证明标记形态」**——违反契约纪律；G3 全部经运行时返回结构观察（§12.2）。
9. **「毒化派生物哨兵不可用」**——P3 实测：无害前提（clean ok）与毒化触发（no-options throw）均稳定；目标读的 ok 是「未越界遍历」的行为级必然结果 → 排除。

## 12. 验收契约与测试路径

> **派发约束**：本 iteration 只**定义**契约范围与红灯机制，不落盘测试文件（§12.3 的文件清单为下游实现迭代的交付物）。红在 HEAD 已由 P1/P2/P3 在**契约将断言的同一场景**上实跑证明（§5/§13），非纸面推测。

### 12.1 契约总表（AC1–AC5 + SA8 required actions → 落点）

| Issue AC / SA8 | 断言组 | 测试文件 | 最小输入 | HEAD 预期 | 目标预期 |
|---|---|---|---|---|---|
| AC1 同 depth 下 valueSchema 截断标记位置正确、携带 ref 名或容器 kind（vfsl 单元面） | G2/G3 | `resolve-schema-at-path-budget.test.ts` | fixture 路径 × depth ∈ {0,1,2,3,9} × 选项 | 标记 0 命中、与无预算逐字节相等（P1）→ 红 | 标记位置/线索与 §12.4 矩阵（SA1 pin 后固化）一致 |
| AC2 别名闭包随展开层收缩；被裁路径 docs/aliasDocs 切片省略 | G4/G5 | 同上 | 同上 + 文档三表锚 | 闭包/切片恒全量（P1）→ 红 | 闭包键集 = 展开层引用闭包（精确集）；切片 ⊆ 无预算且无被裁键 |
| AC3 union 透明 / ref 终态计层符合 ADR；width 不影响投影 | G2.1–G2.5/G6 | 同上 | union/ref/optional 对偶夹具 + width-only 选项 | 无计层实现；width 因忽略而「相等」→ 红（G6 在预算生效后判定） | 计层对偶断言全绿；width-only ≡ 无预算逐字节 |
| AC4 投影包装类型进入投影契约公共面；无 options 逐字节回归锚全绿 | G1/G8 | `resolve-schema-at-path-budget.test-d.ts` + `resolve-schema-at-path-budget-control.test.ts` | 公共 index 导入 + 14 路径基线哈希 | TS2554/TS2724（P2）→ 红；负控绿 | 包装/options 类型可导入、无预算结果类型纯 `ValueSchema`；哈希不变 |
| AC5 全套包门禁 + root typecheck/test | G9 | §12.6 命令 | — | 基线绿（§4） | 实现后仍全绿 + 新文件被收集 |
| SA8 §8.3 options 校验通道 | G7 | `resolve-schema-at-path-budget.test.ts` | 非法/未知键/非对象 options | 无守卫（忽略）→ 红 | 判别联合失败、稳定码（SA1 pin Q4）、不 throw |
| SA8 §10(a) 公共 API/类型面 | G1 + G9.2 | `-budget.test-d.ts` + root typecheck | — | 红（P2） | 绿，且 namespace-runtime 穷举拷贝编译通过 |
| SA8 §10(c) 跨票计层一一对应 | G10 + §12.4 | 本报告 + T3 差分 recipe | 同一 fixture/同一预算 | T1/T3 未落地（不可代验） | T2 oracle 可复用；T3 差分核对值条目 ↔ 标记路径 |

### 12.2 断言组（契约范围；observation = 运行时返回结构，禁止源码断言）

**G0 前提与 oracle（负控文件，HEAD 现绿）**
- G0.1 预算 fixture `parseVfsl` + `evaluate` ok；五张表/别名表在场。
- G0.2 fixture 值树/别名体的**层结构字面量对账**（`evaluate` 输出逐字面量）：object/array 各一层、optional/union/enum 透明、ref 终止——作为 §12.4 计层矩阵的独立 oracle（期望值不靠读源码）。
- G0.3 毒化前提：clean 派生物无预算读 ok；毒化派生物无预算读 `throw InternalError`（P3 实测）。
- G0.4 无预算基线冻结：14 路径 `JSON.stringify(result)` 哈希字面量（§13 表）+ `Object.keys(result)` 键序 + 深层 `toEqual` 内容。

**G1 公共 API 与类型面（`-budget.test-d.ts` 红灯；`index.ts` 出口纪律）**
- G1.1 三参调用 `resolveSchemaAtPath(derived, path, options)` 类型编译通过（HEAD：TS2554）；两参调用仍合法（第三参可选）。
- G1.2 options 类型与投影包装联合类型**只经 `packages/vfsl/src/index.ts`** 导入（HEAD：TS2724；名称 SA1 pin，Q3）；包装类型是 `ValueSchema` 的超集（`ValueSchema` 可赋给它）。
- G1.3 无预算结果类型纯度：两参调用结果 `valueSchema` 可赋给 `ValueSchema`；预算结果的包装/标记类型**不得**出现在两参结果类型上（以 `@ts-expect-error` 访问标记专有字段锚定）。
- G1.4 `ValueSchema['kind']` 恰为九 kind 字面量联合（`object|array|xml|union|enum|pattern|scalar|optional|ref`）——新增 kind 即红（ADR 0003 L46 / 0024 L115）。
- G1.5 预算结果 `valueSchema` 类型可容纳标记成员（包装联合）；`aliases` 是否同样加宽由 Q1 决定，测试按 pin 落地。

**G2 计层规则（运行时；ADR L81 钉死语义）**
- G2.1 容器层：object（Y.Map/封闭对象/Record）与 array（Y.Array/YPlainArray）各恰计 1 层；depth+1 使裁切前沿恰好下移一个容器层（嵌套对偶夹具逐 depth 断言）。
- G2.2 optional 透明：`config?: YMap<{retries}>` 与同构必填孪生位的裁切 depth 相同。
- G2.3 union 透明：union 节点自身**永不**是标记位；含 union 包装的容器路径与去掉 union 的同构孪生路径在每个 depth 的裁切状态一致（判别联合 + 字面量联合两类成员均测）。
- G2.4 字面量联合（enum）终态、不计层、不产生标记。
- G2.5 ref 终态边界：裁切落在 ref 位时，标记在 **ref 位**、线索为 ref 名；ref 节点不内联；被裁 ref 的别名不进闭包；未被裁 ref 保留原节点（`{kind:'ref',name}`）且目标别名在闭包内。
- G2.6 目标呈现规则：终点为终态（scalar/xml/enum/pattern）时任何 depth 为 no-op（与无预算逐字节相等）；终点为容器/ref 且 `depth:0` 时为骨架（呈现形态 = SA1 pin Q2）。
- G2.7 单调/确定性：同一 (path, options) 重复调用逐字节相同；depth 递增时标记前沿单调下移，不出现「跨层跳变」。

**G3 截断标记（运行时）**
- G3.1 标记**当且仅当**预算裁切出现；无预算读恒零标记（P1 为反例锚）。
- G3.2 标记位置 = 被裁位置的类型位（按数据路径寻址；union 成员位按成员索引寻址）。
- G3.3 线索：被裁位类型节点为 ref → 线索 = ref 名字符串全等；为容器 → 线索可区分 `object`/`array`（不得混淆）。
- G3.4 标记是投影层形态：`valueSchema`/`aliases` 中非标记节点 kind 全部 ∈ 九 kind；标记不出现在 `derived`（原派生物零变异）；`derived` 深比较不变。
- G3.5 标记集合 = §12.4 矩阵（SA1 pin 后固化）精确相等——不允许「多标」「少标」或仅弱断言「至少一个标记」。

**G4 别名闭包收缩（运行时）**
- G4.1 `aliases` 键集 = 从**展开位**可达 ref 的传递闭包（精确集合相等，非仅 ⊆）。
- G4.2 被裁 ref → 目标别名缺席；展开 ref → 在场且内容与无预算读同名别名一致（若 Q1 允许体内标记，则身体按 pin 断言）。
- G4.3 递归别名终止、单名闭包、JSON 可序列化；零跨调用状态。
- G4.4 越界遍历哨兵：`{depth:0}` 对毒化派生物 ok（P3 目标面），与 G0.3 的 no-budget throw 构成差分。

**G5 docs/aliasDocs 切片收缩（运行时）**
- G5.1 预算切片键集 ⊆ 无预算键集；共享键内容逐字相等（含三源合并序 field→marker→member）。
- G5.2 被裁路径的键缺席（前缀规则按 pin Q5）；被裁别名无 `aliasDocs` 条目。
- G5.3 键文法不发明新键；`memberDocs` 缺席的派生物（无 M4 夹具）在预算读下仍逐字节兼容。

**G6 width 无操作（运行时；ADR L74/L125）**
- G6.1 width-only：`{maxChildrenPerNode:k}`（k ∈ {0,1,3,大}）在路径集上与无预算读 `JSON.stringify` 逐字节相等。
- G6.2 组合：`{depth:d, maxChildrenPerNode:k}` ≡ `{depth:d}`。
- G6.3 width 非法值走 G7 失败面（不得静默忽略）。

**G7 options 校验（运行时；SA8 §8.3）**
- G7.1 `{}` ≡ 无预算（逐字节）。
- G7.2 非法 options（负数/非整数/非有限数/非对象/未知多余键）→ 判别联合失败：`ok:false` + 稳定码（SA1 pin Q4），**同步、不抛**、不产生部分截断；path 回显规则按 pin。
- G7.3 合法预算 → `ok:true` 且行为按 G2–G6。
- G7.4 敌意 options（抛错 getter/Proxy）不得泄漏非 `InternalError` 的裸异常（通道由 SA1 pin Q4）。

**G8 无预算逐字节回归锚（G8.1 负控现绿；G8.2–G8.4 含第三参调用，属红灯面）**
- G8.1 14 路径哈希与键序不变（§13 表）。
- G8.2 显式 `undefined` 第三参 ≡ 缺省两参（逐字节）。
- G8.3 充足 depth（覆盖全部容器层）≡ 无预算（逐字节）——防止「全展开仍插标记」。
- G8.4 无跨调用状态：先预算读、再无预算读，后者仍等于基线；不同 options 连续调用互不影响。

**G9 边界与门禁（review/runner 级，非单测断言）**
- G9.1 改动面：`git diff --name-only` ⊆ `packages/vfsl/src/{resolve-schema-at-path.ts,index.ts}` + §12.3 新测试/fixture；无 `docs/`、无其他包。
- G9.2 `pnpm typecheck`（14 project）green——含 `namespace-runtime` 穷举拷贝（无预算类型纯度）。
- G9.3 `pnpm test`（root，全部包 + `--typecheck`）green；新文件被收集；`--passWithNoTests=false` 防静默假绿。
- G9.4 纪律：无 skip/only/todo、无 env override/fallback、无吞错/软化断言、无源码字符串/正则断言。
- G9.5 §12.5 变异矩阵逐项由实现/复核方临时执行并复原。

**G10 跨票计层对账（T3 面向）**
- G10.1 T2 交付可复用 oracle：§12.4 计层矩阵 + G0.2 层结构对账，使 T3 能对同一 fixture/同一预算断言「值截断条目路径集 ↔ 投影标记路径集」一一对应（ref 边界的归一规则按 Q1 pin 记录）。
- G10.2 T3 差分 recipe（写入 T2 实现说明）：同一预算下，取值通道 `truncations` 条目的 `path` 集合与投影标记路径集合，按 pin 的 ref/union 归一化后断言相等；错位即契约违约（ADR L81）。

### 12.3 测试文件清单（下游实现迭代落盘；本迭代不落盘）

| 文件（worktree-relative） | 角色 | 内容 |
|---|---|---|
| `packages/vfsl/test/resolve-schema-at-path-budget-fixture.ts` | 共享夹具/oracle | 预算专用 VFSL 文本（嵌套别名链、ref 内嵌 ref、容器×union 对偶、字面量联合、深位文档注释、可选字段孪生）+ 期望字面量 + §12.4 计层矩阵 + 毒化派生物构造器 + §13 基线哈希字面量。**不改动** #272 既有 fixture |
| `packages/vfsl/test/resolve-schema-at-path-budget.test.ts` | **红灯契约（运行时）** | G2–G7 全部断言；**动态接缝**取导出（顶层不静态 import 新名目，保住包 tsc 对运行时红文件零报错）；每条红灯显式报「#335 预算通道缺失」原因 |
| `packages/vfsl/test/resolve-schema-at-path-budget.test-d.ts` | **类型面红灯** | G1 全部断言（三参签名/公共类型出口/无预算纯度/九 kind 冻结/包装联合）；经 `expectTypeOf` 与 `@ts-expect-error` |
| `packages/vfsl/test/resolve-schema-at-path-budget-control.test.ts` | 负控/基线（HEAD 现绿） | G0 + G8.1（两参调用静态可编译）；G8.2–G8.4 需第三参 → 归红灯文件；**不 import/不调用**新预算面 |
| 既有 `resolve-schema-at-path*.test.ts` / `resolve-schema-at-path.test-d.ts`、`namespace-runtime` 投影测试 | 既有回归 | 一行不改、全绿 |

**红灯机制（HEAD 复跑时必须呈现；实现后翻绿）**：
1. **运行时单因红**（设计无关）：`JSON.stringify((fn as BudgetSeam)(derived, [], { depth: 0 })) !== JSON.stringify(fn(derived, []))`——今日相等（P1）→ 显式抛「第三参 options 未被解释」；实现预算递归后自动通过。
2. **标记/闭包/切片红**：G3/G4/G5 断言在 HEAD 分别以「无标记」「闭包非收缩」「切片非收缩」失败（P1 实证）。
3. **类型面红**：三参调用 TS2554 + 公共包装类型 TS2724（P2 实证）。
4. **越界遍历红**：G4.4 毒化 `{depth:0}` 今日 throw（P3 实证）。

### 12.4 计层规则与标记矩阵（默认读法；SA1 必须确认或显式改写，见 Q1/Q2/Q5）

规则（ADR L81 直译）：容器（object/array）各计 1 层；optional/union/enum 透明；ref 为终态边界——**被裁位是 ref 时标记落在 ref 位并携带 ref 名**，被裁位是容器时线索给容器 kind；终点容器 `depth:0` 折叠为骨架（呈现形态 Q2）。下表为既有 #272 fixture 的默认读法期望（`→` 后为线索）：

| path | depth=0 | depth=1 | depth=2 | depth≥9 |
|---|---|---|---|---|
| `[]` | 终点折叠：`object` 位标记（Q2） | 标记：`ROOT.audit→'Audit'`、`ROOT.assets→'object'`、`ROOT.keywords→'array'`、`ROOT.u→'U'`、`ROOT.config→'object'`、`ROOT.attachments→'array'`；`ROOT.notes` 原样（optional 透明 + 标量终态） | 标记：`ROOT.assets.'<key>'→'AssetEntity'`、`ROOT.u.<member 1>.x→'array'`；`ROOT.audit` 保留 `ref:Audit`；闭包 `{Audit,U}` | 无标记；≡ 无预算（逐字节） |
| `['audit']` | 终点 `ref:Audit` 位标记 → `'Audit'`；闭包 `{}` | ref 保留、闭包 `{Audit}`、体内 `createdBy` 标量无标记 | 同 d=1 | ≡ 无预算 |
| `['assets','img1']` | 终点 `ref:AssetEntity` 位标记 → `'AssetEntity'` | 保留 `ref:AssetEntity` + 闭包 `{AssetEntity}`；`<member 0>.audit`/`<member 1>.audit` 为容器位 → 标记 `'Audit'` | 内嵌 audit ref 保留 → 闭包 `{AssetEntity,Audit}`；无标记 | ≡ 无预算 |
| `['u']` | 终点 `ref:U` 位标记 → `'U'` | 保留 `ref:U` + 闭包 `{U}`；`<member 1>.x→'array'`（容器位标记），`<member 0>.x` 标量原样 | 同 d=1（无更深容器） | ≡ 无预算 |

闭包收缩示例（可执行断言素材）：`['assets','img1']` 的闭包在 depth=1 为 `{AssetEntity}`、depth≥2 为 `{AssetEntity,Audit}`；`[]` 的闭包在 depth≤1 为 `{}`、depth=2 为 `{Audit,U}`、depth≥3 为 `{Audit,AssetEntity,U}`（`assets.<key>` 处的 AssetEntity 在深度覆盖后并入，其内嵌 Audit 随之可达）。这些期望在 SA1 pin 后由 fixture oracle（G0.2）独立对账。

### 12.5 变异敏感性矩阵（G9.5；实现/复核期临时执行并复原）

| 变异 | 预期转红的断言 |
|---|---|
| D1 忽略 options（= HEAD 现状） | 红灯机制 1、G3.1、G3.5、G4.1 |
| D2 union 计层（当容器） | G2.3（union 对偶孪生位裁切 depth 偏移） |
| D3 越过裁切继续展开 / 内联 ref | G2.5、G3.3（线索应为 ref 名）、G4.2、G4.4 |
| D4 全量收集闭包后再裁剪标记 | G4.1（闭包集过大）、G4.4（毒化 throw） |
| D5 docs/aliasDocs 全量切片 | G5.1/G5.2 |
| D6 width 作用于投影 | G6.1/G6.2 |
| D7 给 ValueSchema 加标记 kind | G1.4（类型）、G3.4（运行时 kind 扫描） |
| D8 namespace-runtime 层事后裁剪（不在 resolver 内） | §12.3 红灯机制 1/2（vfsl 单元面返回全量）、G9.1 |
| D9 跨调用缓存预算结果 | G8.4（先后调用相互污染）、G2.7 |

### 12.6 验证门（实现完成后必须全部通过）

```bash
pnpm exec tsc -p packages/vfsl/tsconfig.json
NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/vfsl/test --typecheck --passWithNoTests=false
pnpm typecheck     # root 14 project（含 namespace-runtime 穷举拷贝）
pnpm test          # root vitest run --typecheck（全部 packages/domains/apps）
```

范围外：T1 #334（doc-runtime 值通道）、T3 #336（readData 五键组合）、T4 #337（DeepOptional）、T5 #338（文档负控与形状注记）——本票不触碰、不代验。

## 13. 红/绿证据

1. **红·运行时（P1）**：`fn.length=2`；7/7 路径 `{depth:0}` 与 `{maxChildrenPerNode:1}` 调用 `JSON.stringify` 与无预算**逐字节相等**，marker 词元 0 命中；`[]` 闭包恒 `[Audit,AssetEntity,U]`、docs 键数恒 5（无收缩）。失败原因是 PR 目标断言处的真实行为（预算参数未实现），非环境/fixture/入口错误。
2. **红·类型面（P2）**：三参调用 `TS2554: Expected 2 arguments, but got 3.`；公共包装类型占位导入 `TS2724`。
3. **红·越界遍历（P3）**：毒化派生物 `{depth:0}` 仍 `THROW InternalError`（应 ok）；同时 clean no-options ok、毒化 no-options throw（负控前提成立）。
4. **绿·基线（§4）**：vfsl 37 files/651 tests + 0 type errors；root typecheck exit 0；`--typecheck.only` 27 files/146 tests 且 `resolve-schema-at-path.test-d.ts (3 tests)` 被收集；包 tsc exit 0。
5. **无预算逐字节锚（冻结；sha256(JSON.stringify(result)) 前 16 位；fixture = 既有 #272 `FIXTURE_TEXT`，derived 哈希 `0269500af3cf4ed4`）**：

| path | 形态 | 哈希 | path | 形态 | 哈希 |
|---|---|---|---|---|---|
| `[]` | ok | `5c2eb58e98e87b3f` | `['u','x']` | ok | `2b26ffb93924762a` |
| `['audit']` | ok | `0522bec4126c4361` | `['config']` | ok | `49be73e01d4cedf0` |
| `['assets']` | ok | `d791971882166312` | `['config','retries']` | ok | `ad5ad3e6a978cf44` |
| `['assets','img1']` | ok | `1fdd6ec9abc63cf7` | `['nope']` | NOT_FOUND | `09ba64ad18349c6b` |
| `['assets','img1','url']` | ok | `2417f648bb65657d` | `[0]` | INVALID | `66daaf30651de6a8` |
| `['notes']` | ok | `fd64ebfcd5191e12` | `['keywords',-1]` | INVALID | `b901ba9fc9a06227` |
| `['keywords']` | ok | `a9fa8c686e66fcdb` | `['u']` | ok | `f44ef53c5873dce4` |

6. **root 门基线**：`pnpm typecheck` exit 0（14 project）；`pnpm test` exit 0——**338 files / 3588 tests passed；Type Errors: no errors**（622.64s，含全部 packages/domains/apps 与 `--typecheck`）。

> 注：本 iteration 按派发约束不落盘测试；上表 P1–P3 是「契约将断言的同一场景」在 HEAD 的实跑证据。实现迭代落盘测试后，必须先在 HEAD 复跑捕获同型红（预期同上），再实施改造——否则不得声称红。

## 14. 测试入口证据

- `vitest.config.ts`：`include: ['packages/*/test/**/*.test.ts', 'domains/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts']`；`typecheck.include: ['packages/*/test/**/*.test-d.ts', ...]`（tsconfig `./tsconfig.typecheck.json`）；`maxWorkers: 1`。
- 基线实跑（§4）已收集同目录同后缀的 `resolve-schema-at-path.test.ts`（运行时）与 `resolve-schema-at-path.test-d.ts`（`--typecheck.only` 清单），§12.3 四条建议路径命中同一 glob。
- 包级门：`packages/vfsl/tsconfig.json` include `src/**/*.ts` + `test/**/*.ts`——运行时红文件必须用动态接缝（顶层不静态 import 缺失名目），否则包 tsc 连带红（与 #272 先例同款纪律）。
- 跨包解析：`NODE_OPTIONS=--conditions=nomicore-source` + `tsconfig.base.json` `customConditions`，无需 build。

## 15. 未知与阻塞（SA1 设计 pin；不阻塞契约执行）

下列位 ADR 未逐字钉死，是 SA8 `requiresConflictRecheck=true` 的直接对象；SA1 必须逐项在设计中裁决（含最小示例），实现测试按 pin 字面化：

- **Q1（最关键）ref 体内标记归属与 `aliases` 类型面**：终点/成员 ref 的**部分展开**（体内存在下一层容器）时，标记落在 ref 位（整别名全有全无，`aliases` 保持纯 `ValueSchema`）还是落在别名体内（`aliases` 值也须加宽为包装联合）？两读法对 ADR L81「值截断位置 ↔ 标记一一对应」的映射不同；若选后者，公共类型面 override 范围扩大（超出 ADR L77 仅点名 `valueSchema` 的表述），须 SA8 复核。
- **Q2 计层原点与 `depth:0` 目标呈现**：终点容器的 `depth:0` 呈现为「终点位单标记」还是「同形容器 + 成员位标记」；终态终点 no-op 已由 ADR 决策 1 钉死（G2.6 保留）。
- **Q3 标记节点与公共名目**：标记的可判别形状（判别字段名/取值）、线索字段名与取值域（ref 名 vs 容器 kind）、包装联合类型名、options 类型名、以及是否提供公共类型守卫。测试按 pin 从 `src/index.ts` 导入。
- **Q4 options 校验通道与码位**：resolver 层失败码（复用 `READ_OPTIONS_INVALID` 还是 vfsl 域新码）、path 回显规则、敌意 options（抛错 getter/Proxy）处置——必须在 vfsl 模块契约「malformed 公共入参走判别联合而非 throw」内，且无 options 路径零开销零语义变化。
- **Q5 被裁位置的 docs/aliasDocs 选键**：裁切位**自身**的键（如 `ROOT.audit`）保留还是省略；「被裁路径省略」的前缀规则与 union 成员位（`<member N>`）键归属。
- **Q6 空 options**：`{}` 是否保证 ≡ 无预算（本契约默认要求；pin 后字面化）。
- **Q7 无预算类型纯度实现路线**：`ReadDataSchemaProjection` 泛型化 / 重载 / 分离结果类型——不得让 `namespace-runtime` 的两参消费与穷举拷贝红（G9.2）。
- **Q8 width 在 resolver 的合法性与零作用**：`maxChildrenPerNode` 合法（≥0 整数）且对投影零作用（不得因「投影无 width 概念」而拒收）。
- **Q9 union 静态展开与数据路径的对应粒度**：G10.2 的 T3 差分归一化规则（多成员同数据路径时的标记多重性 vs 值条目唯一性）——T2 记录规则前提，T3 验收。

跨票依赖（非阻塞）：T1 #334 与 T3 #336 未落地，值通道条目 ↔ 投影标记的一一对应无法在本票端到端验证；G10 已把前提（oracle + 归一化规则）交付给 T3。无环境缺失、无信息不足——**无 blocker**。

## 16. 临时诊断清理

- 临时类型探针 `packages/vfsl/test/.probe-335-budget-type.ts` 已删除；`git status --porcelain`：仅三枚任务输入（`task_issue-335.md`、`task_issue-335_conflict_report.md`、`task_issue-335_relevant_decisions.md`）为 untracked，生产实现与既有测试零改动。
- 运行时 probe（P1/P3）为 stdin/`tsx -` inline 脚本；哈希基线采集与确定性复算用 `/tmp/dsh-335-*.mjs` / `*.txt` 临时脚本（已删除）。
- `node_modules/` 为 `pnpm install --frozen-lockfile --offline` 产物（gitignore 覆盖，`pnpm-lock.yaml` 零 diff）。
- 未启动常驻服务；无遗留后台任务（root `pnpm test`/`pnpm typecheck` 基线作业已收，exit 0）。
