# Issue #335 设计 — [shape-budget] T2：投影通道形状预算——解析入口三参化与截断标记

- 派发：`sa-10fc397b-85a1-4075-853a-26f189a47d74`（role `mabf-sa1`，phase `design`，iteration 1）
- Worktree：`/home/wangjian/nomicore-fix-issue-335`（branch `mabf/issue-335`，HEAD `ba11f328ae845bf882d131a2098a7afc8dfcc17c`）
- 上游输入：任务简报 `wiki/raw/task_issue-335.md`（Issue #335 正文，comments REST 读取为 `[]`）；
  SA6 契约 `wiki/raw/task_issue-335_sa6_contract.md`；SA8 冲突报告 `wiki/raw/task_issue-335_conflict_report.md`（verdict `clear`）；
  SA8 决议摘录 `wiki/raw/task_issue-335_relevant_decisions.md`。
- **评审修订输入**：`wiki/raw/task_issue-335_sa2_review.md`（iteration 0 评审，verdict `reject`——F1/F2 两项 MAJOR +
  F3/F4/F5 三项 MINOR）。本 iteration 为对全部五项 finding 的逐条修订（映射表见 §13）；主干收口（公共类型/API 面、
  Q1 标记归属、计层算术、options 校验、兼容路线）经评审独立核验成立，原样保留。
- 母法：`docs/adr/0024-readdata-shape-budget.md`（决策 5 + 修订节第 3 条）；既有母法 `docs/adr/0016` / `0003` / `0019` / `0008`；
  模块契约 `packages/vfsl/AGENTS.md`；词汇 `CONTEXT.md` L41–55。

---

## 1. 任务类型、目标与非目标

**任务类型：Feature（能力缺口）**。ADR 0024（accepted，2026-09-12）决策 5 已钉死投影通道预算选型，实现零落地
（SA6 P1/P2/P3 实证：第三参运行时被静默忽略、类型面 TS2554、公共面无包装类型名目）。

**目标**：

1. `resolveSchemaAtPath(derived, path, options?)` 加法三参化（ADR 0024 L79 / 修订节第 3 条）；
   预算在解析递归内生效，valueSchema 截断、别名闭包收集、docs/aliasDocs 切片在同一次遍历内同步收缩（先裁后收集）。
2. 截断处放**投影层截断标记**：投影包装联合，不扩展 ValueSchema 语义联合（九 kind 冻结面零改动），标记携带成员级类型线索
   （ref 名优先，无 ref 名时容器 kind）（ADR 0024 L77 / L115）。
3. 计层规则：容器（object/array）各计 1 层；optional/union/enum（及 pattern/scalar/xml 终态）透明；ref 为终态边界
   （ADR 0024 L81）。width（`maxChildrenPerNode`）合法但对投影零操作（ADR 0024 L74 / L125）。
4. 投影包装类型进入 `@nomicore/vfsl` 公共面（仅经 `src/index.ts` 出口）。
5. **无 options（含显式 `undefined`）时行为逐字节不变**（ADR 0024 L29 / 修订节；SA8 §4 override 落地）。

**非目标（越界禁令，SA8 §8.5 / SA6 §10）**：

- 不改 `packages/doc-runtime`（T1 #334 值通道三参化）、`packages/namespace-runtime`（T3 #336 readData 五键组合与
  detach 拷贝面）、`packages/namespace-registry`（文档负控正则属 T5 #338）。
- 不做 namespace-runtime 层事后投影裁剪（ADR 0024 L116 否决）；不引入值域哨兵；不给 ValueSchema 扩 kind（L115 否决）。
- 不改 ValueSchema / DerivedSchema / evaluate / validate-patch / pattern 等任何既有公共形状与行为。
- 不改 `docs/`（ADR 0024 与 CONTEXT 词汇已落基线；ADR 0016 回填修订批注属 PR #332 / T5 面，SA8 §6 注记）。
- 不实现代码、不落盘测试（本设计之后的实现迭代完成）。

---

## 2. 当前行为与证据锚点

| 事实 | 锚点 |
|---|---|
| 签名两参 `resolveSchemaAtPath(derived, path)`；path 形状守卫在最前（敌意通道优先） | `packages/vfsl/src/resolve-schema-at-path.ts` L92–104 |
| derived 可信域形状守卫 → `InternalError`（五张表 + root/ROOT 在场校验） | 同上 L106–126 |
| 路径游走双侧锁步：结构侧 `drillStep`（合法性+失败分类）+ 值侧 `matchValueCandidate`/`matchValueNode`（optional 透明解包、ref 逐跳查表且锚名切换为 ref 名、union 静态全成员展开、Record `<key>` 槽 keyPattern 正则实测）；出候选 `emitValue` 记录**原样节点**（optional/ref 包装保留）与语法路径，并累积脊柱键 `spine` | 同上 L128–292 |
| **值侧环防御先例（两型）**：ref 名环 → `inFlight` 名集 → `throw InternalError("值树引用环")`（仅当路径段驱动候选规范化穿过该环——路径依赖）；对象图环 → `visited` 身份集**先加后递归**、静默终止不抛 | 同上 L226–247（inFlight L227/L237）、L251–253（visited） |
| 终点合成：单候选原样；多候选 = 合成 union（恰两键、恒无判别式） | 同上 L172–175 |
| 别名闭包 `collectAliasClosure`：DFS 全量收集；ref → 名集登记后访问体（递归别名终止）；`aliases[n] = values[n]` **原样引用**（L409）；插入序 = 发现序；`visitedNodes` 身份集**先加后递归**（L388–389）防对象图环发散；ref 目标缺失 `Object.hasOwn` 守卫 → `InternalError`（L406） | 同上 L380–419 |
| docs/aliasDocs 切片 `sliceDocs`：选键 = 脊柱（精确）∪ 终点路径前缀匹配 ∪ 闭包别名内部前缀匹配（`k === p \|\| k.startsWith(p + '.')`）；三源合并 `docs[k] = [...fieldDocs[k], ...markerDocs[k], ...memberDocs[k]]`（field → marker → member 末位）；空合并过滤；memberDocs 条件稀疏（缺席整遍跳过、在场表级畸形 → InternalError） | 同上 L434–496（want 谓词 L443–452） |
| 模块 throw 纪律：本函数 throw 的只有 `InternalError`（文件头 L24 + L299 明文） | 同上 L24 / L299 |
| 结果联合：ok = 投影四件套；失败 = 两枚稳定码 `SCHEMA_PATH_NOT_FOUND` / `SCHEMA_PATH_INVALID` + path 新鲜副本回显 | 同上 L63–71 |
| 公共出口唯一：`packages/vfsl/src/index.ts` L125–126（值导出函数 + 两枚类型） | index.ts |
| 跨包消费（两参调用、不加 catch）：`packages/namespace-runtime/src/read-schema-projection.ts` L56；`detachReadSchemaProjection`/`cloneValueSchema` 对 `ValueSchema` 逐 kind 穷举、**无 default**（L121–181）——两参结果类型若被包装联合污染，root typecheck 必红 | 同上 |
| ValueSchema 九 kind 冻结联合（object/array/xml/union/enum/pattern/scalar/optional/ref）；ref 按名引用不内联；**enum 节点形态 = `{ kind: 'enum'; values: Array<string \| number> }`（字面量数组、声明序）** | `packages/vfsl/src/derived.ts` L44–53（enum L49）；ADR 0003 L26–27/L46 |
| **求值器节点分配纪律（环防御设计依据）**：`valueOf` 逐语法位**新建**节点对象（object/array/record/union/enum 均为字面量构造，无驻留/interning）；别名体 `values[name]` 每名一体，仅经 ref（按名间接）被共享 | `packages/vfsl/src/evaluate.ts` L276–325（enum L281/L305） |
| 严格面：`strict` + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` + `verbatimModuleSyntax` | `tsconfig.base.json` |
| 语法路径文法（docs 键锚定）：字段名、Record 槽 `'<key>'`、数组元素 `'<item>'`、union 成员 `'<member N>'`；**enum（字面量联合）成员注释键锚定在 `${pos}.<member N>`（终态节点内部）**——M4 夹具 23 键中 8+ 键属此类（`'ROOT.mode.<member 0>'`、`'Status.<member 0>'`、`'InlEnum.<member 0>'`、`'ROOT.inlineItems.<item>.<member 0>'`、`'ROOT.recInline.<key>.<member 0>'`、`'Choice.<member 0>'`、`'InlItem.<item>.<member 0>'`、`'InlRec.<key>.<member 0>'` 等），为 ADR 0019 键文法合法声明位且是**既有无预算读的实际输出键**（`EXPECTED_DOCS` 为运行时快照）——F2 证据 | `packages/vfsl/test/resolve-schema-at-path-member-docs-fixture.ts` L69–93（M4_TEXT L26–63）；`packages/vfsl/test/resolve-schema-at-path-fixture.ts` L76–82（fieldDocs 非空键全集：`Audit.createdBy`/`ROOT.audit`/`ROOT.notes`/`ROOT.keywords`/`ROOT.config`） |
| 现有 #272 夹具：五别名（ROOT/Audit/AssetEntity/U + AssetId pattern）；docs 断言先例（如 `['audit']` docs = 脊柱 `ROOT.audit` + 闭包内部 `Audit.createdBy`） | `packages/vfsl/test/resolve-schema-at-path-fixture.ts`；`resolve-schema-at-path.test.ts` L398–449 |
| 基线全绿（HEAD 实测）：vfsl 37 files/651 tests、root typecheck（14 project）、root test 338 files/3588 tests；无预算 14 路径冻结哈希表（SA6 §13.5） | SA6 §4/§13 |
| 预算零实现：`maxChildrenPerNode`/`READ_OPTIONS_INVALID` 在 `packages|apps|domains` 源码零命中（本设计 grep 复核确认） | SA6 §4；本设计复核 |

**关键结构事实（后续设计依赖）**：终点候选 `V` 携带的是**原样节点**（ref/optional 包装保留）——
`['audit']` 的无预算结果 `valueSchema = {kind:'ref', name:'Audit'}`、`aliases = {Audit: 完整体}`；
`['assets','img1']` 的无预算结果 `valueSchema = {kind:'ref', name:'AssetEntity'}`、闭包 `{AssetEntity, Audit}`。
即：**ref 终点的展开层内容天然住在闭包别名体内，而不是 valueSchema 里**（ADR 0016 投影体 + ADR 0003 §4 按名引用纪律的既有结构事实）。

---

## 3. 能力缺口（根因承接）

| 上游事实 | 证据位置 | 设计响应 |
|---|---|---|
| 第三参运行时被静默忽略：7 路径上 `{depth:0}`/`{maxChildrenPerNode:1}` 调用与无预算调用 `JSON.stringify` 逐字节相等、marker 命中 0、`fn.length=2` | SA6 P1（§5） | §6.3/§7：加法第三参 + 预算游走分支 |
| 类型面缺口：三参调用 TS2554；公共 index 无预算投影包装类型名目（TS2724 于占位名） | SA6 P2（§5） | §6.4/§6.8/§7.1：公共名目 + 重载签名 |
| 无「先裁后收集」：`{depth:0}` 对毒化派生物（仅闭包/展开遍历可达的未声明别名）仍 `throw InternalError`——HEAD 全量遍历 | SA6 P3（§5） | §6.3/§7.3：预算游走只触达展开位；`{depth:0}` 恒不进任何别名体 |
| 闭包/切片恒全量（P1：`[]` 闭包恒 `[Audit,AssetEntity,U]`、docs 键数恒 5） | SA6 P1 | §6.3/§6.6：闭包与切片随展开层收缩 |

能力缺口链完整（SA6 §8，高置信）：需求 = ADR 0024 决策 5 的 T2 切片兑现，无新增决策面。

---

## 4. Owner要求落实

REST Issue comments 读取为 `[]`（Host 简报与派发均确认）——无 Owner 评论来源的要求、override 或附加义务，无映射表可列。
全部义务 = Issue #335 正文「What to build」+ AC1–AC5 + ADR 0024 决策 5（SA8 判定 8 项 implements-existing-decision + 3 项
no-conflict）。AC → 设计落点：AC1 → §6.2/§6.3/§6.4；AC2 → §6.3/§6.6；AC3 → §6.3/§6.9；AC4 → §6.4/§6.8/§7.1；AC5 → §11。

---

## 5. SA8约束落实

| SA8 决议或义务（§3 裁决 / §8 required actions） | 设计位置 | 处理方式 | 是否需要设计后冲突复查 |
|---|---|---|---|
| #1 决策 5 钉死：预算在解析递归内生效（先裁后收集、单遍历收缩三件事）；禁 namespace-runtime 事后裁剪；禁值域哨兵与 ValueSchema 扩 kind | §6.3/§7.3 | 预算游走在 resolver 单次遍历内同步产出 valueSchema/闭包/切片键；改动面限 `packages/vfsl/src` 两文件 | 否（implements-existing-decision） |
| #2 公共面出口纪律：三参签名与投影包装联合只经 `src/index.ts` 导出 | §7.1 | 全部新名目经 index.ts 出口；文件范围 §10 | 否 |
| #3 SA1 收口点：resolver 层 options 校验失败通道与码位——须判别联合、不 throw、无 options 路径零开销零语义变化 | §6.5 | 新稳定码 `SCHEMA_OPTIONS_INVALID`（判别联合、同步、不抛、path 回显）；无 options 走原代码路径 | **是**（码位为 ADR 未钉死的新公共失败码） |
| #4 回归锚：无 options 逐字节恒等 + 仅 width 触发时投影与无预算读逐字节相等 | §6.7/§7.4/§11 | 分支隔离 + 身份短路 + **枚举成员位 emit（§6.3 F2 修复）**使逐字节恒等为结构性结果（§7.4.2 修订论证） | 否（实现期验证） |
| #5 越界禁令：不动 doc-runtime / namespace-runtime / registry 公共面；不动 readData 文档负控 | §1 非目标/§10 DENY | 文件范围钉死 | 否 |
| #6 ADR 0016 回填修订批注（阶段建议，非本票） | §1 非目标 | 范围外，归 PR #332 / T5 | 否 |
| §10(a) 公共 API/类型面变更须后置核对 | §14 | `requiresConflictRecheck=true` | **是** |
| §10(b) 两项正式 override 落地（无 options 逐字节恒等、无预算读恒纯 `ValueSchema`、不扩大 override 范围） | §6.8/§7.4 | 两参调用类型纯度经重载保证；**aliases 字段类型加宽是对 override 范围的一处显式扩大（Q1 必然结论），已在 §6.1 单独论证并列入复查** | **是** |
| §10(c) 跨票计层一一对应（T1/T2/T3） | §6.10 | T2 交付计层规则 + 可复用 oracle 前提与 T3 归一化规则记录（含 F5 的 options 校验规则集对齐前提） | 是（跨票核对项） |
| §5 冻结面：ValueSchema 九 kind、失败两码语义与 path 回显、投影体四键与三源合并序、无 options 逐字节、schema 通道 always-on、纯函数/同步/零 memo、readData 文档负控、其他三包公共面 | §6.3–§6.9/§10 | 逐项落实（见对应节）；F1 修复保持 throw 通道纯度（预算游走零新增 throw，§8） | 随 §10(a)(b) 合并复查 |

---

## 6. 设计决策总览（SA6 §15 pin Q1–Q9 逐项收口）

> 以下为本设计的核心收口。每项给出裁决、最小示例与依据；实现与测试按 pin 字面化。
> SA6 §1 约定：SA1 若对 §12/§15 契约或 pin 另有选择，须先原位修订契约并触发 SA8 复核——本设计对 SA6 §12.4 计层矩阵
> 修正**一处算术漂移**（见 §6.3.4），对 Q1 选取「aliases 加宽」读法（SA6 已预告该选项需 SA8 复核）；除此之外全部确认
> SA6 默认读法。矩阵修正不改变任何断言机制，只修正期望字面量（由 fixture oracle G0.2 独立对账仲裁）。

### 6.1 Q1（最关键）——ref 体内标记归属与 `aliases` 类型面

**裁决：标记落在被裁位置的类型位——包括保留 ref 之后的别名体内。`aliases` 字段类型在预算读下与 `valueSchema`
一并加宽为投影包装联合（`Record<string, BudgetedValueSchema>`）。无预算读恒 `Record<string, ValueSchema>`（纯度不变）。**

推导（为什么「整别名全有全无、aliases 保持纯」的读法不成立）：

1. **ref 终点的展开层内容住在闭包体内**（§2 关键结构事实）：`['assets','img1']` 的 `valueSchema` 是裸
   `ref:AssetEntity`。预算 d=1 时值通道已展开目标容器（kind/url/audit 子键以折叠壳在场、audit 子容器被裁），
   类型侧若不进入别名体，消费者拿到的只有一个 ref 名——既看不到展开层字段，也看不到「audit 被裁」的任何类型信号。
2. **ADR 0024 L81「两通道截断位置一一对应——错位即契约违约」是契约级承诺**。值通道按容器逐位裁（无「整 ref 全有全无」
   概念）；若类型侧在部分展开时把标记抬到 ref 位整体折叠（全有全无读法），值截断位置（…/audit）与投影标记位置
   （终点 ref 位）系统性错位——违反 L81。反之，体内标记读法在 d=1 下给出 `AssetEntity.<member N>.audit` 位标记，
   经锚名归一后与值条目 `…/audit` 一一对应。
3. 因此部分展开必然进入别名体、必然在体内成员值位产生标记 → `aliases` 的值类型必须能容纳标记 → 加宽是 Q1 的必然结论，
   而非可选风格。ADR 0024 L77 只点名 `valueSchema` 字段，但同一句的机制描述「**成员值位**可出现截断标记」在
   ref 按名引用 + 闭包自包含的投影结构下必然延伸到闭包体成员值位（投影类型树 = valueSchema + 闭包体的并）。
4. **诚实申报**：这是对 SA8 §4 override 表「valueSchema 字段类型加宽」范围的显式扩大（aliases 同步加宽），
   SA6 §10/§15 已预告该选项须 SA8 复核 → 本设计 `requiresConflictRecheck=true`（§14），并在 §12 列为实现期核对项。

最小示例（既有 #272 夹具，`['assets','img1']`，`depth:1`）：

```text
valueSchema = { kind:'ref', name:'AssetEntity' }        // 原样保留（共享节点）
aliases     = { AssetEntity: { kind:'union', members:[
    { kind:'object', fields:[ …kind/url 原样…,
        { name:'audit', value: MARKER(ref 'Audit') } ] },   // 体内标记，线索 = ref 名
    { kind:'object', fields:[ …kind/body 原样…,
        { name:'audit', value: MARKER(ref 'Audit') } ] } ] } }
// Audit 不在闭包（其 ref 被裁）；被裁 ref → 目标别名缺席（G2.5）
```

附带推论（ref 位标记归属）：预算耗尽落在 ref 位本身时（b=0），标记在 **ref 位**、线索 = ref 名、
**不查 `values[name]`、不进闭包**——`{depth:0}` 因此恒不触达任何别名体（P3 毒化哨兵的 ok 语义来源）。

别名体渲染预算（同一别名被多个不同剩余预算的位置引用时）：**按 DFS 首发现的预算渲染闭包条目，一次登记后复用**
（镜像既有闭包的名集先登记后访问体）。理由：(a) 确定性（与既有发现序纪律同构）；(b) 按名引用设计下闭包条目共享，
逐引用位渲染不可表示（无预算闭包同样共享，非预算特有损失）；(c) 失效方向安全——若另一更深预算的引用位在值通道
展开得更深，闭包体相对「少报」（多一个标记），消费者重读即得；反向（按最大预算渲染）会「多报可见」——消费者以为
某位已取而值通道实际裁掉，是危险方向。该限制与 T3 归一化前提一并记录于 §6.10。

**递归包含的例外（评审 F1 修订引入，规约见 §6.3.5）**：当别名体的首发现登记发生在该体**仍在渲染栈上**时
（合法派生物中唯一情形：path `[]` 的终点 `values.ROOT` 直walk 期间经 ref 链回到 `ref:ROOT`），闭包条目经
in-progress 透传取得**原体引用**而非预算渲染——这正是无预算读 `collectAliasClosure` 的既有纪律
（`aliases[name] = values[name]` 原样引用，L409），也是 `{}` 在含递归别名的合法派生物上逐字节恒等的必要条件。

### 6.2 Q2 —— 计层原点与 `depth:0` 目标呈现

**裁决：**

- **计层原点 = 路径终点**（与值通道「自目标节点向下」同构）。路径游走段（到达终点前的每一段）不消耗、不受预算约束
  ——预算只作用于终点及以下的类型子树。终点候选以完整预算起算。
- **`depth:0` 呈现 = 位置标记（position marker）**：被裁节点的整棵类型子树以单枚标记呈现（CONTEXT.md「语义 schema 投影」
  词条原文：「截断处的类型子树以投影层截断标记呈现」）。容器终点 → 标记线索 = 容器 kind（`'object'`/`'array'`）；
  ref 终点 → 标记线索 = ref 名。**不采用**「同形容器 + 成员位标记」的骨架呈现：标记替换子树，与值通道
  「折叠为同形空容器 + 单条 depth 条目」的容器粒度一一对应（一容器一条目 ↔ 一容器一标记）。
- **终态终点 no-op**（ADR 0024 决策 1）：终点为 scalar/xml/enum/pattern（含经 optional 透明包裹）时，任何 depth
  原样返回——`['notes']`、`['audit','createdBy']`、`['u','x']` 的标量成员等在任何预算下与无预算逐字节相等。
- **包装保留**：optional 包装在标记处保留——`config?: YMap<{retries}>` 在预算耗尽于其内容器时呈现为
  `optional(MARKER(container 'object'))`（optional 对计层透明、对结构保真；投影既有纪律「optional 原样保留」的预算延伸）。
  union 节点自身永不是标记位（G2.3）：union 壳保留、成员位标记。

### 6.3 计层算法规约（形式化 walk；Q2 计层规则的完整落地）

预算游走 `walk(node, b, path)`（`b` = 该位置尚可展开的容器层数；终点起算 `b = depth`；无上限用 `∞`）。
**预算判定（b==0）先于该节点任何子位触达**（先裁后收集——子位零访问、零物化；F3 修订后的权威顺序）：

| node.kind | 规则 |
|---|---|
| `object`（容器，计 1 层） | `b=0` → `MARKER(container 'object')`（**不触达 fields、不 emit 任何子位路径**）。`b≥1` → 壳 `{kind:'object', fields:[…]}`（`keyPattern` 在场则照抄）；逐字段：`child = walk(f.value, b-1, `${path}.${f.name}`)`（消耗一层），**`child` 非标记才 emit `` `${path}.${f.name}` ``**（先裁后 emit：字段值位被裁则该路径不入 emitted） |
| `array`（容器，计 1 层） | `b=0` → `MARKER(container 'array')`（不触达 element）。`b≥1` → `child = walk(node.element, b-1, `${path}.<item>`)`；`child` 非标记才 emit `` `${path}.<item>` `` |
| `union`（透明，不计层） | 壳 `{kind:'union', members:[…], discriminator?}`（判别式缓存在场则引用照抄）；逐成员：`child = walk(member, b, `${path}.<member ${i}>`)`（**同 b**），`child` 非标记才 emit；union 永不整位标记 |
| `optional`（透明，不计层） | `{kind:'optional', value: walk(node.value, b, path)}`（**同 b、同 path**——optional 不占语法路径段；内位渲染结果为标记时保留 optional 包装，见 §6.2） |
| `ref`（终态边界） | `b=0` → `MARKER(ref node.name)`（**不查 `values[name]`、不登记闭包**）。`b≥1` → 名未登记时：先 `Object.hasOwn(values, name)` 守卫，**缺失 → `throw new InternalError("值树未声明别名: …")`**（与既有 `collectAliasClosure` L406 同文同码；F3/E3 守卫）；随后先登记名（占位，递归别名终止），`aliases[name] = walk(values[name], b, name)`（锚名切换为别名名——B10 文法；首发现预算渲染 §6.1；**该重入若命中 in-progress → 透传原体，§6.3.5**）；emit 别名名（闭包体根锚）。名已登记 → 直接返回原 ref 节点（共享条目复用）。两种路径均 emit `` `${path}` ``（保留 ref 位在场）并返回**原共享 ref 节点** |
| `enum`（终态，no-op） | emit 路径；**并逐字面量成员位 emit `` `${path}.<member ${i}>` ``（i 按 `node.values` 声明序 0 基）——字面量为终态、永不产生标记（F2 修复，理由见下）**；原样返回共享节点（预算无关） |
| `pattern` / `scalar` / `xml`（终态，no-op） | emit 路径，原样返回共享节点（预算无关；无内部声明位——键文法下无锚定其内部的键形态） |

**F2 修复理由（enum 成员位 emit）**：ADR 0019 键文法允许成员注释锚定在枚举（字面量联合）终态内部
（`${pos}.<member N>`），且此类键是既有无预算读的实际输出键（M4 夹具 `EXPECTED_DOCS` 23 键中 8+ 键，§2 证据行）。
walk 若只 emit enum 自身路径、不下钻成员位，则该类键永不入 emitted → 预算分支（**含 `{}`、充足 depth、width-only
等零标记读**）docs 丢键，直接击穿 G6.1/G7.1/G8.3 逐字节恒等。union/optional 成员位 walk 本就 emit；scalar/pattern/xml
无内部声明位——**enum 成员位是唯一缺口**，补 emit 后 docs 键的锚定位重新与「walk 渲染过的位置」全量对齐（§6.6/§7.4.2）。

配套机制：

- **身份短路（identity short-circuit）**：子树渲染结果零标记 ⟺ 各容器/union/optional 的成员结果全部 === 原引用 ⟹
  整体返回**原节点引用**（不构造壳）。这使「充足 depth ≡ 无预算」成为结构性的字节恒等（且引用恒等），也使
  大预算读不产生多余分配。
- **渲染位路径集（emitted）**：每个被渲染的位置记录其语法路径——容器壳位、字段值位、`<item>`、`<member N>`
  （union 成员位**与 enum 字面量成员位**）、optional 内位（同路径）、终态自身、保留 ref 位、闭包体根锚=别名名。
  **标记位及其全部后代不入 emitted**（先裁后 emit；被裁位零触达故零 emit）。该集合供 docs 选键（§6.6）。
  路径文法与既有 docs 键文法逐字同构（字段名/`<key>`/`<item>`/`<member N>`/别名锚名）。
- **路径游走段不受预算**：既有 L137–170 的段循环原样运行（结构侧 drillStep + 值侧匹配 + 脊柱累积）——预算分支只在
  终点合成/闭包/切片阶段分叉。依据：ADR 0024 决策 1「自**目标节点**向下」；值通道同样不预算到达目标的路径成本。
  **该段连同其环语义（ref 名环 → InternalError，路径依赖）逐字保留**——预算读与无预算读在同一 (derived, path) 上的
  throw 行为完全一致（§6.3.5/§8）。
- **值树环防御（两相防御；F1 修订，完整规约见 §6.3.5）**：walk 上下文携带两个按**节点对象身份**键控的结构——
  **进行中集**（in-progress set：进入节点时先加入，完成渲染后移除）与**完成表**（completion memo：节点 → 渲染结果，
  渲染完成后写入，供 DAG 共享复用）。入口协议顺序固定：完成表命中 → 返回记忆结果；进行中集命中 → **返回原节点引用**
  （环透传：不构造、不 emit、不抛——与无预算读共享原引用的输出语义同构）；否则加入进行中集、按上表渲染、移出进行中集、
  写入完成表。该结构对 DAG 是记忆化、对环是防发散——「出口写表」的单表结构（原伪代码）只对 DAG 有效、对环必然发散
  （透明环任意预算、容器环 b=∞ 下栈溢出裸 `RangeError`），已废除。
- **成本界**：walk 只触达渲染位（含身份短路前的逐位枚举——为收集 emitted 路径仍需逐位访问，成本 O(渲染位)，
  与既有闭包收集同阶；enum 成员位 emit 增加 O(|values|)/每渲染枚举位，与渲染该终态同阶）；`b=0` 位的子树零触达
  （零物化承诺的行为基础，P3 哨兵锚定）。

#### 6.3.4 对 SA6 §12.4 计层矩阵的一处修正

SA6 §12.4（默认读法，SA1 须确认或显式改写）在 `['u']` 行 depth=2 列写「同 d=1（无更深容器）」。按 ADR 0024 L81
计层规则与 SA6 自身 G2.1（「depth+1 使裁切前沿恰好下移一个容器层」）推导：`['u']` 终点 `ref:U` → union 透明 →
成员 object（第 1 容器层）→ `x: YArray`（第 2 容器层）→ 元素 scalar（终态）。depth=1 时标记落 `<member 1>.x`（array 位）；
**depth=2 时 x 数组展开、元素 scalar 原样——无标记，与无预算逐字节相等**（d=2 即达本夹具该路径的全展开；d≥2 ≡ 无预算）。
「同 d=1」与 G2.1 的单调下移矛盾，属 SA6 矩阵的算术漂移。修正后的完整矩阵（其余全部确认 SA6 默认读法；`→` 后为线索；
`≡ 无预算` = JSON.stringify 逐字节相等）：

| path | depth=0 | depth=1 | depth=2 | depth=3 | depth≥4（充足） |
|---|---|---|---|---|---|
| `[]` | 终点折叠：`object` 位标记；闭包 `{}`；docs `{}` | 成员位标记：`ROOT.audit→'Audit'`、`ROOT.assets→'object'`、`ROOT.keywords→'array'`、`ROOT.u→'U'`、`ROOT.config→object`（`optional` 包装保留）、`ROOT.attachments→'array'`；`ROOT.notes` 原样（optional 透明 + 标量终态）；闭包 `{}`；docs = 渲染位（本夹具仅 `ROOT.notes`，其余成员位被裁——被裁字段键 `ROOT.audit`/`ROOT.keywords`/`ROOT.config` 不入选，见 §6.6） | `ROOT.assets.'<key>'→'AssetEntity'`、`ROOT.u.<member 1>.x→'array'`；`ROOT.audit` 保留 `ref:Audit`；闭包 `{Audit, U}`（U 体内含 `<member 1>.x` 标记）；docs 含 `Audit.createdBy` | `AssetEntity.<member 0/1>.audit→'Audit'`（闭包体内）；闭包 `{Audit, AssetEntity, U}` | ≡ 无预算（无标记；含 U/AssetEntity 全净） |
| `['audit']` | 终点 `ref:Audit` 位标记 → `'Audit'`；闭包 `{}`；docs = 脊柱 `ROOT.audit`（§6.6 pin） | `ref:Audit` 保留、闭包 `{Audit}` 净体、`createdBy` 标量无标记 | 同 d=1 | 同 d=1 | ≡ 无预算（d≥1 即全展开） |
| `['assets','img1']` | 终点 `ref:AssetEntity` 位标记 → `'AssetEntity'`；闭包 `{}`；docs `{}`（脊柱键无内容） | 保留 `ref:AssetEntity` + 闭包 `{AssetEntity}`（体内 `<member 0/1>.audit→'Audit'`，§6.1 示例）；`aliasDocs` 含 `AssetEntity` | 内嵌 audit ref 保留 → 闭包 `{AssetEntity, Audit}` 全净；无标记 | 同 d=2 | ≡ 无预算（d≥2 即全展开） |
| `['u']` | 终点 `ref:U` 位标记 → `'U'`；闭包 `{}` | 保留 `ref:U` + 闭包 `{U}`（`<member 1>.x→'array'`，`<member 0>.x` 标量原样） | **无标记（修正：x 数组展开、元素标量原样）**；闭包 `{U}` 净体 | 同 d=2 | ≡ 无预算（d≥2 即全展开） |
| `['u','x']`（合成 union 终点） | 合成 union 成员位标记：`<member 1>→'array'`（scalar 成员原样）；闭包 `{}` | ≡ 无预算（scalar + array{scalar} 全净） | 同 d=1 | 同 d=1 | ≡ 无预算 |

闭包收缩示例（确认 SA6 §12.4 尾段）：`['assets','img1']` 闭包 d=1 `{AssetEntity}`、d≥2 `{AssetEntity, Audit}`；
`[]` 闭包 d≤1 `{}`、d=2 `{Audit, U}`、d≥3 `{Audit, AssetEntity, U}`。docs 收缩见 §6.6。

矩阵与 F2 修复的相容性：#272 夹具的 enum 位（`AssetEntity.<member N>.kind`、`U.<member N>.kind`）在 docs 三表中
**无成员注释键**（非空键全集见 §2 证据行），故 enum 成员位 emit 不改变本矩阵任何格的 docs 期望；标记位集合不受影响
（enum 成员位永不产生标记，G3.5 精确集合不变）。

#### 6.3.5 环语义规约（F1 修订的完整收口）

**适用对象**：预算游走 walk 的递归栈（终点子树渲染 + 闭包体渲染共用）。无 options 分支不经 walk，行为逐字节不变。

**结构与协议**（伪代码见 §7.3）：

1. walk 上下文持有 `inProgress: Set<ValueSchema>`（按对象身份）与 `memo: Map<ValueSchema, BudgetedValueSchema>`
   （按对象身份；每调用局部，零跨调用状态——ADR 0016 L65 纯函数纪律）。
2. 入口协议（顺序固定）：`memo.has(node)` → 返回 `memo.get(node)`；`inProgress.has(node)` → **返回 `node` 本身**
   （环透传）；否则 `inProgress.add(node)` → 按渲染 → `inProgress.delete(node)` → `memo.set(node, 结果)` → 返回。
3. **环透传语义**：重入进行中节点时返回原节点引用——不构造壳、不产生标记、不 emit 任何路径（重入位不是新渲染位，
   其路径 emit 归属首次进入该位的父级渲染）。父级将该原引用作为子结果参与身份短路判定：容器环 + `b=∞` 下
   「子结果 === 原引用」成立 → 整体身份短路 → 输出即原环状结构（与无预算读共享同一批原节点，结构同构）；
   容器环 + 有限 b 下递归按层耗尽正常产生有界壳 + 标记（每层一次、有限次）；透明环（union/optional 自引用）任意 b 下
   首次重入即透传、不再展开。

**为什么透传返回原引用（而非标记或预算副本）**：

- (a) **终止性是硬约束**：任何对环上节点的「继续渲染」在透明环（任意预算）或容器环（`b=∞`，即 `{}`/width-only/缺
  depth）下无限递归——这是 F1 根因；透传是唯一在全部预算域内终止且不引入新 throw 的处置。
- (b) **与无预算读同构**：无预算读对对象图环输入返回 ok 且投影共享原节点（`matchValueNode` visited L252–253、
  `collectAliasClosure` visitedNodes L388–389 均先加后递归、静默终止）；预算分支重入返回原引用使 `{}` 在该输入上
  与无 options 行为一致（G7.1 恒等承诺的输入域覆盖到手造环状派生物）。
- (c) **合法递归别名的恒等前提**：path `[]` + 递归 ROOT 包含下（§6.1 例外），`{}` 必须经透传取得
  `closure.ROOT = 原体` 才与无预算读（`aliases.ROOT = values.ROOT` 原引用）逐字节相等；若此处渲染预算副本或标记，
  G7.1/G8.3 在含递归别名的**合法**派生物上必红。
- (d) **throw 通道纯度**：对象图环不在可信域 InternalError 清单内（清单 = ref 目标缺失、**ref 名环**、两树分歧、
  root/ROOT 缺失、意外异常——见 `resolve-schema-at-path.ts` L22–24）；预算游走对其不新增 throw，与无预算读一致。

**ref 名环与对象图环的区分（既有语义原样保留）**：ref 名环（ref 链回到同名别名）由**不变的路径游走段**
`matchValueCandidate` 的 inFlight 名集处置——路径段驱动候选规范化穿过该环时 `throw InternalError("值树引用环")`、
否则不触发（路径依赖，L226–247 既有行为）。预算读与无预算读在同一 (derived, path) 上 throw 行为逐字节一致；
预算 walk 自身对 ref 名环经闭包名集先登记终止（镜像既有 `collectAliasClosure`），不抛。

**完成表按节点身份键控的预算串染分析（诚实记录）**：

- **合法派生物上无串染**：同一节点对象 × 同一次调用至多处于一个剩余预算上下文。依据：(i) 求值器 `valueOf`
  逐语法位新建节点（evaluate.ts L276–325，无驻留），inline 节点在值树中位置唯一；(ii) 别名体 `values[name]` 每名一体，
  预算游走仅经闭包登记进入且每名至多登记一次（首发现预算，§6.1 pin）；(iii) `values.ROOT` 在 path `[]` 时额外作为
  终点直walk，其经 ref 链的自递归重入由 in-progress 透传吸收（不产生第二预算上下文，即 §6.1 例外）。
- **可信域外（手造 DAG/环）**：共享节点跨预算上下文时完成表「首渲染胜出」（含首渲染为 MARKER 的情形——该标记被
  复用到更富裕预算的位置，方向为过度裁剪/少报，非危险方向）。此类输入不承诺 L81 一一对应与逐字节恒等
  （无预算读对它们的 docs 选择同样依赖其 visited 截断形状）；承诺 = 终止 + 确定 + 无裸异常 + 环位原样透传。

**测试断言口径（SA2 S1/E2 验收的转写）**：手造环状派生物（union 自引用环 × 任意预算；容器环 × `{}`/width-only/
有限 depth）断言——调用正常返回（ok；或路径穿过 ref 名环时 InternalError，与无预算读同构）；无 `RangeError`/
`TypeError` 等裸异常；`{}` 输出与无预算读**引用级**同构（valueSchema/aliases 条目 === 对应原节点；环状输出不可
`JSON.stringify`，断言用引用相等与形态检查）；有限 depth 下标记按 §6.3 规约确定；重复调用逐字节/逐引用确定。
环状夹具不带环下文档键（docs 键锚定在环重入点以下属可信域外构造，规约不承诺其选择形状）。

### 6.4 SA6 Q3 —— 标记形状与公共名目

**裁决（公共名目全部经 `packages/vfsl/src/index.ts` 出口）：**

```ts
/** 截断标记线索：被裁位类型节点为 ref → ref 名；为容器 → 容器 kind。 */
export type SchemaTruncationClue =
  | { readonly via: 'ref'; readonly name: string }
  | { readonly via: 'container'; readonly containerKind: 'object' | 'array' };

/** 投影层截断标记（ADR 0024 决策 5「截断节点选型」）。非 ValueSchema 成员、非值域哨兵。 */
export interface SchemaTruncationMarker {
  readonly kind: 'truncated';
  readonly clue: SchemaTruncationClue;
}

/** 投影包装联合：无预算读恒纯 ValueSchema；预算读成员值位可出现标记。 */
export type BudgetedValueSchema = ValueSchema | SchemaTruncationMarker;

/** 预算 options（封闭形状；width 合法但对投影零操作）。 */
export interface ResolveSchemaBudgetOptions {
  readonly depth?: number;
  readonly maxChildrenPerNode?: number;
}

/** 公共类型守卫（消费方/T3 判别用）。 */
export function isSchemaTruncationMarker(node: unknown): node is SchemaTruncationMarker;
```

设计理由：

- **判别字段名复用 `kind`，字面量 `'truncated'`**：包装联合在 `kind` 上形成十案判别（九 ValueSchema kind + truncated），
  消费方 `switch (node.kind)` 可穷举收窄；`'truncated'` 不在九 kind 字面量内，`SchemaTruncationMarker` 与 `ValueSchema`
  类型上互不可赋值（不污染冻结联合，G1.4 锚定的类型事实不破）。运行时 G3.4 扫描口径：非标记节点 kind 全部 ∈ 九 kind。
- **线索为嵌套判别联合而非裸字符串**：避免「别名恰好命名为 `object`/`array`」时线索语义二义（词法上 VFSL 标识符不排除
  该拼写）；`via:'ref'` / `via:'container'` 使 T3 归一化与消费方分支类型安全。ADR「ref 名优先，无 ref 名时容器 kind」
  的优先级由 walk 落点决定（被裁位是 ref 还是容器），不再依赖字符串域区分。
- **守卫函数**：T3 detach 拷贝与外部消费方需要；小而稳定，经 index 出口。
- 标记**不携带**预算种类（投影通道唯一裁因是 depth；width 无操作）、不携带被截容器子键清单（ADR 0024 决策 3 明文：
  看下一层结构 = 下一轮浅读或 schema 投影截断节点——标记即该节点，携带的线索仅供盲拼下一轮路径段类型）。

### 6.5 Q4 —— options 校验通道与码位

**裁决：**

1. **失败通道 = 判别联合**：`{ ok: false; code: 'SCHEMA_OPTIONS_INVALID'; path: Array<string | number> }`
   （path = 已通过形状校验的调用方数组新鲜副本，与既有失败分支同构）。同步、不抛、不产生部分截断（校验先于一切
   预算游走）。
2. **码位 = 新稳定码 `SCHEMA_OPTIONS_INVALID`**，不复用 `READ_OPTIONS_INVALID`、不借用 `SCHEMA_PATH_*`。理由：
   (a) ADR 0024 L30 将 `READ_OPTIONS_INVALID` 注册于 **readData 主接缝层**（SA8 §8.3 确认 resolver 层未钉死）；
   vfsl 公共失败码族是 `SCHEMA_*`（SCHEMA_PATH_NOT_FOUND/SCHEMA_PATH_INVALID），resolver 是独立公共接缝，按仓内
   「每包自有码族」先例（vfsl SCHEMA_*、envelope issue 族、runtime 自有族）取接缝内码名；(b) 「预算缺陷不是路径缺陷」
   原则（L30）的 resolver 对偶 = 不借用 SCHEMA_PATH_*，新码是其在vfsl 域的结构镜像；(c) T3 组合时 readData 在自身
   接缝先校验并以 `READ_OPTIONS_INVALID` 结算，resolver 的 options 码是防御性第二道门，经 T3 吸收（如同两枚路径码
   收敛 `schema:null` 的先例），两码不冲突。**本码位列入 SA8 复核项（§14）。**
3. **校验规则**（敌意通道；全部 own-property 语义）：
   - `options === undefined`（或缺省）→ 无预算，不校验；
   - `typeof options !== 'object'` 或 `null` 或 `Array.isArray(options)` → 非法；
   - own 键集合（`Object.keys`）出现 `depth`/`maxChildrenPerNode` 之外的键 → 非法（封闭形状，ADR 0024 L30 同款）；
   - `depth` / `maxChildrenPerNode` 在场（`Object.hasOwn`）时须为 `number` 且 `Number.isInteger(v) && v >= 0`
     （Number.isInteger 已排除 NaN/±∞——「非有限数」规则覆盖）；**已知键在场且值为 `undefined` → 非法**
     （与包 `exactOptionalPropertyTypes` 静态纪律对偶：静态不可写的形状运行时响亮拒绝）；
   - `maxChildrenPerNode` 通过校验后在投影通道**被忽略**（§6.9）。
4. **校验顺序**：path 形状守卫（既有 L96–104，位置不动）→ **options 校验（新）** → derived 可信域守卫（L106+，不动）→
   路径游走。敌意通道（path、options）全部先于可信域访问结算——既不因 options 敌意把 InternalError 泄漏给敌意调用方，
   也不让 options 校验失败被 derived 畸形的 throw 掩盖；path 先于 options 保持既有「path 守卫先于一切 derived 访问」
   的文档化次序不变。推论：path 与 options 同时非法 → path 码胜；path 内容级失败（NOT_FOUND，产生于游走中）与
   options 非法并存 → options 码胜（校验先于游走）。
5. **敌意 options（抛错 getter / Proxy 陷阱）**：校验块整体置于局部 try/catch，任何异常一律收敛
   `SCHEMA_OPTIONS_INVALID`——**不泄漏任何裸异常、不使用 InternalError**（options 是敌意通道；InternalError 专属
   可信域畸形，模块契约「malformed 公共入参走判别联合而非 throw」的忠实执行；满足 SA6 G7.4 的「不泄漏非
   InternalError 裸异常」且更严：什么都不泄漏）。try 范围仅限校验块，不含任何 derived 访问（不吞 InternalError）。

### 6.6 Q5 —— 被裁位置的 docs/aliasDocs 选键规则

**裁决：docs 键当且仅当其锚定位「在场」才入选——在场 = 脊柱位（路径游走过，含终点位自身的精确键）或渲染位
（emitted 集合，精确键匹配；**含 enum 终态的字面量成员位**——F2 修复）。标记位及其后代不入选。aliasDocs 仅随闭包成员
（被裁 ref → 目标别名缺席 → 无条目，含别名级注释一并省略）。**

- 实现：预算分支的 `want(k) = spine.has(k) || emitted.has(k)`（**精确键匹配**，O(1) 判定）。**三源合并序、键文法、
  空条目过滤、memberDocs 条件稀疏兼容全部原样**（ADR 0019 §7 / SA8 裁决 #5：只收缩选键集合，不发明键、不改合并序）。
- **F2 修复后的等价论证（替代原「渲染位集合 ⊇ 前缀展开全集，因 docs 键必对应真实声明位」的错误断言——该断言被
  M4 夹具的 enum 成员注释键证伪）**：零标记（`{}` / 充足 depth / width-only）时 `spine ∪ emitted` ≡ 无预算分支的
  可选键锚定位全集，两向论证见 §7.4.2——要点：docs 键的锚定链由文法段（字段名 / `<key>` / `<item>` / `<member N>`）
  构成，walk 在未裁位上对**每一类**文法段都发生渲染与 emit（union 成员位既有；enum 字面量成员位经本修复补齐），
  故无预算分支选中的每个键其锚定位都在 emitted 中；反向 emitted ⊆ 终点子树 ∪ 闭包体 ∪ 脊柱，无预算分支的前缀规则
  亦选中。裁剪态下精确匹配天然排除被裁子树键（标记位不入 emitted）——「被裁路径省略」（ADR 0024 L73）既不扩大
  （终态内部注释位不因修复而被裁）也不缩小（被裁 enum 的成员键仍随其宿主位标记而省略）。
- **脊柱键（含被裁终点位自身的键，如 `['audit']` d=0 的 `ROOT.audit`）保留**。理由：docs 切片三来源中脊柱描述
  「你走过的路径位」——路径位在预算读中全部真实解析过；「被裁路径省略」（ADR 0024 L73 延伸决定）针对的是**被裁子树
  内部**的注释位（emitted 缺席）与**被裁别名**的 aliasDocs，不针对调用方显式寻址的路径位。该解读是对延伸决定的
  边界 pin，列入 SA8 复核关注点（§14）。
- 等价表述：**docs 跟随其锚定位是否随投影在场**——脊柱位恒在场；渲染位在场；标记位被传输形态替换而不在场；
  闭包别名名随闭包成员在场（docs 侧的 `k === 别名名` 情形由闭包体根锚 emit 覆盖，与无预算分支 `k === a` 条款逐字节
  等价）。
- 例（#272 夹具）：`[]` d=1 docs = `{ROOT.notes}`（其余成员位被裁——`ROOT.audit`/`ROOT.keywords`/`ROOT.config`
  为 fieldDocs 实际在册键、被裁故不入选）；`[]` d=2 docs 含 `ROOT.audit`/`ROOT.notes`/`ROOT.keywords`/`ROOT.config`/
  `Audit.createdBy`；`['audit']` d=0 docs = `{ROOT.audit}`（脊柱）；`['assets','img1']` d=1 `aliasDocs` =
  `{AssetEntity}`（Audit 被裁缺席）。
- 例（M4 型夹具，F2 修复的直接锚定）：`['mode']` 任意 depth（enum 终态 no-op）docs 含
  `ROOT.mode.<member 0/1>`；`['s']` d≥1 闭包 `{Status}` → docs 含 `Status.<member 0/1>`；`['s']` d=0 docs =
  `{}`（脊柱键 `ROOT.s` 不在 M4 三表中——脊柱保留规则只作用于在册键；Status 成员键省略：ref 位标记 ⇒ 无闭包 ⇒
  无闭包锚）；`[]` 充足 depth docs = 无预算全 23 键
  （含 8+ enum 成员注释键）——`{}`/width-only/充足 depth 三态与无预算读 `JSON.stringify` 逐字节相等（G7.1/G6.1/G8.3）。

### 6.7 Q6 —— 空 options

**裁决：`{}` ≡ 无预算（逐字节）**。机制：`{}` 校验通过且无 depth/width 约束 → walk 以 `∞` 预算运行 → 全部身份短路 →
输出与无预算同字节（含闭包发现序、docs 表扫描序、合成 union 形状逐项一致，§7.4 论证；含递归别名与手造环状输入——
环经 in-progress 透传取得原引用，与无预算读的同构性见 §6.3.5）。`undefined` 显式第三参同（G8.2）。
`{maxChildrenPerNode:k}`（width-only）亦逐字节 ≡ 无预算（G6.1）；`{depth:d, maxChildrenPerNode:k}` ≡
`{depth:d}`（G6.2）。

### 6.8 Q7 —— 无预算类型纯度实现路线

**裁决：重载 + 投影体泛型化（不采用单一三参签名 + 条件返回类型）。**

```ts
// 既有名目形状零变化（默认类型参实例化后逐字段同型）：
export interface ReadDataSchemaProjection<V extends BudgetedValueSchema = ValueSchema> {
  readonly valueSchema: V;
  readonly aliases: Record<string, V>;
  readonly docs: Record<string, readonly string[]>;
  readonly aliasDocs: Record<string, readonly string[]>;
}
export type BudgetedReadDataSchemaProjection = ReadDataSchemaProjection<BudgetedValueSchema>;

export type ResolveSchemaAtPathResult = /* 既有两码联合，一字不改 */;
export type BudgetedResolveSchemaAtPathResult =
  | ({ readonly ok: true } & BudgetedReadDataSchemaProjection)
  | { ok: false; code: 'SCHEMA_PATH_NOT_FOUND' | 'SCHEMA_PATH_INVALID' | 'SCHEMA_OPTIONS_INVALID';
      path: Array<string | number> };

// 重载（声明序：两参在前）：
export function resolveSchemaAtPath(
  derived: DerivedSchema,
  path: readonly (string | number)[],
): ResolveSchemaAtPathResult;
export function resolveSchemaAtPath(
  derived: DerivedSchema,
  path: readonly (string | number)[],
  options: ResolveSchemaBudgetOptions | undefined,
): BudgetedResolveSchemaAtPathResult;
export function resolveSchemaAtPath(
  derived: DerivedSchema,
  path: readonly (string | number)[],
  options?: ResolveSchemaBudgetOptions,
): ResolveSchemaAtPathResult | BudgetedResolveSchemaAtPathResult { /* 实现 */ }
```

- 两参调用 → 第一重载 → 结果类型恒纯 `ValueSchema` / `Record<string, ValueSchema>`：`namespace-runtime` 的两参消费
  与逐 kind 穷举拷贝（`read-schema-projection.ts` L56/L121–181）零改动编译通过（G9.2）；
  `resolve-schema-at-path.test-d.ts` 既有断言（valueSchema `toEqualTypeOf<ValueSchema>()` 等）不红。
- 三参调用（含显式 `undefined`）→ 第二重载 → 加宽类型。显式 `undefined` 的**运行时**行为 ≡ 缺省（逐字节，G8.2）；
  **静态**类型取加宽面（调用方选择了三参形态；纯度承诺按 ADR 0024 修订节第 3 条只钉「无 options」形态）。
  该差异在 test-d 显式锚定（G1.1/G8.2 的类型面注记）。
- 否决备选：单一签名 + `O extends … ? 纯 : 宽` 条件返回——条件类型在泛型上下文不可解析、破坏既有具名结果联合形状、
  失败码集无法按形态分裂（纯面必须恰两码，加宽面三码）；分离平行接口族（BudgetedObject/BudgetedArray…）——重复
  九 kind 家族、维护面翻倍，且运行时标记本就只出现在成员值位与终点根位，浅层联合已精确覆盖运行时可达形态。
- `fn.length` 将由 2 变 3（实现签名三参）。ADR「无 options 签名逐字不变」指调用形态（一切既有两参调用合法且行为/
  类型不变），不约束函数元数据；SA6 P1 的 `fn.length=2` 仅作 HEAD 诊断证据，红灯机制 1 以行为差分（JSON.stringify）
  为断言，不受影响。实现说明中记一笔即可。

### 6.9 Q8 —— width 合法性与零作用

`maxChildrenPerNode` 按 §6.5 规则校验（合法域：缺席或 ≥0 整数），通过后**在投影通道不进入任何判定**——walk 不接收、
不比较、不计数（投影是类型级、路径键控，无实例键；ADR 0024 L74/L125）。非法 width 值走 `SCHEMA_OPTIONS_INVALID`
（G6.3：不得因「投影无 width 概念」而拒收合法 width，也不得静默放过非法 width）。

### 6.10 Q9 —— union 展开粒度与跨票（T1/T3）计层对账前提

- **union 静态全成员展开保持既有语义**（ADR 0003 §3「任一成员出现即存在」；ADR 0016 L60–64 继续有效）：预算下
  union 壳保留、成员逐个以同预算 walk——一个数据位若类型为透明 union，其标记按成员索引多重出现
  （`union{MARKER, MARKER}` 或 `union{scalar, MARKER}`）。
- **T3 归一化前提（记录，T3 #336 验收）**：值截断条目路径集 ↔ 投影标记路径集比对前，投影侧须做两步归一——
  (i) 剥离 `<member N>` 段（union 透明，多重标记收敛到宿主数据位，值侧一位置一 depth 条目）；
  (ii) ref 位标记经 ref 名对齐到值侧同数据位（保留 ref ⟹ 值侧该位已展开一层；ref 位标记 ⟹ 值侧该容器折叠）。
  闭包体内标记锚定在别名名（类型空间）：按 §6.1 首发现预算渲染，与「逐引用位值裁剪」在多引用不同剩余预算的构造下
  不逐位对齐——T3 差分应锚定终点子树（valueSchema 内）标记的逐位对应，闭包体标记按「存在性 ⊆ 引用位裁剪并集」
  弱断言，或夹具避免多引用跨预算构造。该前提写入 T2 实现说明（G10.2 recipe），错位即契约违约（ADR L81）。
- **跨票 options 校验规则集对齐前提（F5 修订新增，记录）**：本设计 §6.5.3 的校验规则集——含「已知键在场且值为
  `undefined` → 非法」这一超出 ADR 0024 L30 字面清单的加严 pin——是 T1（#334 值通道）与 T3（#336 readData 接缝）的
  **对齐前提**：两票设计须采纳同一规则集，或在接缝处显式净化（如 readData 透传前剥离 present-undefined 键）后再进入
  本 resolver 的第二道门；否则 T3 对 readData options 的合法透传会被本层误拒。该前提随 G10 前提一并写入 T2 实现说明。
- T2 交付的可复用 oracle：§6.3 计层规约 + §6.3.4 修正矩阵 + §6.3.5 环语义规约 + SA6 G0.2 层结构字面量对账
  （期望值不靠读源码）。

### 6.11 备选方案否决记录（本设计层）

| 备选 | 否决原因 |
|---|---|
| 整别名全有全无（aliases 保持纯，部分展开时整 ref 折叠为标记） | 与 ADR 0024 L81 一一对应承诺冲突（值通道逐容器裁、无全有全无概念）；展开层信息全丢（§6.1 推导 1–2） |
| 预算下 ref 内联展开（valueSchema 直接呈现体内标记，闭包保持纯） | 违反 ref 按名引用不内联（ADR 0003 §4 / ADR 0016 投影体）；无预算与预算输出结构性分叉超出标记插入 |
| depth:0 同形容器骨架（壳 + 全成员位标记） | 与值通道「折叠 + 单条目」容器粒度错位（一一对应按容器配对）；CONTEXT「类型子树以标记呈现」的钉死表述相反 |
| 闭包按最大引用预算渲染 / 逐引用位渲染 | 最大预算会「多报可见」（危险方向）；逐引用位在按名共享闭包下不可表示（§6.1 附带推论） |
| docs 选键改为渲染位**前缀**匹配（SA2 F2 修复选项 a：`k === p \|\| k.startsWith(p + '.')` 对全部已渲染位 p） | **过选被裁后代键**：`[]` d=1 时 `ROOT` 容器壳已渲染（在 emitted），前缀规则经 `ROOT.` 选中标记位键 `ROOT.audit`/`ROOT.keywords`/`ROOT.config`（fieldDocs 实际在册），与 §6.3.4 矩阵（docs = `{ROOT.notes}`）及「被裁路径省略」（ADR 0024 L73）直接矛盾——「标记位不入 emitted 即天然排除被裁子树键」的推断只在键的**全部**前缀祖先均被裁时成立，对「父壳已渲染、子位被标记」的常态不成立；修复该过选需再按标记前缀扣减 = 第二遍后处理，违反单遍历收缩纪律。采用选项 b（enum 成员位 emit）后**精确匹配**在零标记与裁剪两态均与无预算分支等价（§7.4.2）且 O(1) 判定（原否决行「emitted 精确匹配天然达成同集」的前提错误已随 F2 撤回，本行为修正后的否决理由） |
| 环防御采用「出口写表」单表 memo（节点 → 结果，递归返回后写入） | 只对 DAG 记忆化、对环必然发散（F1 根因）：透明环任意预算、容器环 b=∞ 下栈溢出裸 `RangeError`，违反 throw 纪律与 `{}` ≡ 无 options 承诺；已改为「完成表 + 进行中集」两相防御（§6.3.5） |
| 环重入返回标记 / 预算副本 | 标记破坏 `{}` 在合法递归别名上的逐字节恒等（closure 条目应为原体，§6.3.5(c)）；预算副本违反闭包单名单次渲染纪律（§6.1）且对 b=∞ 仍需透传终止 |
| resolver 复用 `READ_OPTIONS_INVALID` | 该码注册于 readData 主接缝层（ADR 0024 L30）；vfsl 接缝码族为 SCHEMA_*（§6.5 论证） |
| 单一签名 + 条件返回类型 / 平行 Budgeted 类型族 | §6.8 否决理由 |
| 标记携带被截容器子键清单 / 预算种类字段 | ADR 0024 决策 3 明文不带子键清单；投影唯一裁因是 depth（§6.4） |

---

## 7. 接口、数据结构与实现蓝图

### 7.1 公共面变更总表（`packages/vfsl/src/index.ts` 新增出口）

| 名目 | 种类 | 形态 |
|---|---|---|
| `resolveSchemaAtPath` | 值导出（既有） | 重载签名扩展（§6.8）；既有两参调用面零变化 |
| `ResolveSchemaBudgetOptions` | 类型（新） | `{ depth?; maxChildrenPerNode? }`（readonly、exactOptionalPropertyTypes 兼容） |
| `SchemaTruncationClue` | 类型（新） | `{via:'ref', name} \| {via:'container', containerKind}` |
| `SchemaTruncationMarker` | 类型（新） | `{kind:'truncated'; clue}` |
| `BudgetedValueSchema` | 类型（新） | `ValueSchema \| SchemaTruncationMarker` |
| `ReadDataSchemaProjection` | 类型（既有） | 泛型化 `<V extends BudgetedValueSchema = ValueSchema>`；缺省实例化逐字段同型（既有消费者零感知） |
| `BudgetedReadDataSchemaProjection` | 类型（新） | `ReadDataSchemaProjection<BudgetedValueSchema>` 别名 |
| `BudgetedResolveSchemaAtPathResult` | 类型（新） | ok = 预算投影四件套；失败 = 三码 + path 回显（§6.8） |
| `isSchemaTruncationMarker` | 值导出（新） | `unknown => node is SchemaTruncationMarker`（结构判别：对象、`kind === 'truncated'`、clue 形状） |

`index.ts` L117–126 的导出块与注释同步扩写（三参语义、预算纪律、无 options 逐字节承诺）。

### 7.2 `resolve-schema-at-path.ts` 结构（预算代码全部落本文件，SA6 §10/G9.1 改造面）

```text
L1–47   文件头注 + imports                    → 扩写预算语义段（三参、计层、标记、先裁后收集、两相环防御、逐字节承诺）
L48–61  ReadDataSchemaProjection             → 泛型化（§6.8）
L63–71  ResolveSchemaAtPathResult            → 不动；其后新增 §6.4/§6.8 全部新类型
L92–95  函数签名                              → 重载 + 实现签名（§6.8）
L96–104 path 形状守卫                         → 不动（位置与行为逐字节保留）
新增      options 校验（§6.5）                 → 紧随 path 守卫、先于 derived 守卫；局部 try/catch 收敛 SCHEMA_OPTIONS_INVALID
L106–170 derived 守卫 + 路径游走              → 不动（预算不进游走段；环语义/失败分类原样）
L172–183 终点合成/闭包/切片                    → 分叉：
           options === undefined → 既有三步逐字运行（collectAliasClosure + sliceDocs 原样调用）
           options 在场 → 预算游走 walk（§6.3/§6.3.5）：产出 budgeted 终点（身份短路）、ordered 闭包、emitted 路径集
                         → 合成（单候选原样/多候选合成 union，成员为 budgeted 节点）
                         → 预算切片（§6.6：want = spine ∪ emitted 精确匹配；三源合并序与扫描序照抄 sliceDocs）
新增      内部件：validateBudgetOptions / BudgetWalk 上下文（emitted/aliases/名集/inProgress/memo）/ walk /
         isSchemaTruncationMarker
```

### 7.3 预算游走伪代码（核心递归；完整规则见 §6.3 表，环语义见 §6.3.5）

```text
walk(node, b, path):
  // —— 入口协议（两相环防御；顺序固定：完成表 → 进行中集 → 渲染）——
  if memo.has(node):      return memo.get(node)     // DAG 共享复用（已完成渲染，含 MARKER 结果——§6.3.5 串染分析）
  if inProgress.has(node): return node               // 环透传：原节点引用；不构造、不 emit、不抛
  inProgress.add(node)                               // 进入即登记（先加后递归——镜像 visitedNodes/visited 先例）
  result = render(node, b, path)
  inProgress.delete(node)
  memo.set(node, result)                             // 完成后写表（DAG 复用；对环不设防的「出口写表」已废除）
  return result

render(node, b, path):                                // 预算判定（b==0）先于一切子位触达（先裁后收集）
  switch node.kind:
    'object':
      if b == 0: return MARKER({via:'container', containerKind:'object'})   // 不触达 fields、不 emit 子位
      children = []
      for f of node.fields:                           // 声明序
        child = walk(f.value, b-1, `${path}.${f.name}`)                     // 容器消耗一层
        if child 不是 MARKER: emit `${path}.${f.name}`                      // 先裁后 emit
        children.push({name: f.name, value: child})
      return 身份短路(node, {kind:'object', fields: children}, node.keyPattern)
    'array':
      if b == 0: return MARKER({via:'container', containerKind:'array'})    // 不触达 element
      child = walk(node.element, b-1, `${path}.<item>`)
      if child 不是 MARKER: emit `${path}.<item>`
      return 身份短路(node, {kind:'array', element: child})
    'union':                                           // 透明：同 b；union 永不整位标记
      children = []
      for i, m of node.members:                        // 成员序
        child = walk(m, b, `${path}.<member ${i}>`)
        if child 不是 MARKER: emit `${path}.<member ${i}>`
        children.push(child)
      return 身份短路(node, {kind:'union', members: children}, node.discriminator)
    'optional':                                        // 透明：同 b、同 path（不占语法路径段）
      child = walk(node.value, b, path)
      return child === node.value ? node : {kind:'optional', value: child}
    'ref':                                             // 终态边界
      if b == 0: return MARKER({via:'ref', name: node.name})   // 不查 values、不登记闭包 ⇒ {depth:0} 恒不触达别名体
      if !closureNames.has(node.name):
        if !Object.hasOwn(values, node.name):
          throw new InternalError(`值树未声明别名: ${node.name}`)           // 镜像 collectAliasClosure L406（F3/E3）
        closureNames.add(node.name)                   // 先登记名（占位）：递归别名终止
        closureEntries[node.name] = walk(values[node.name], b, node.name)   // 锚名切换；首发现预算（§6.1）；
                                                          // 自递归重入命中 inProgress → 透传原体（§6.3.5/(c)）
        emit node.name                                 // 闭包体根锚
      emit path                                        // 保留 ref 位在场
      return node                                      // 原共享 ref 节点
    'enum':                                            // 终态、预算无关
      emit path
      for i in 0 .. node.values.length-1: emit `${path}.<member ${i}>`      // 字面量成员位（F2 修复；终态永不标记）
      return node
    'pattern' | 'scalar' | 'xml':                      // 终态、预算无关、无内部声明位
      emit path; return node

身份短路(原节点, 构造壳, 可选照抄键): 全部子结果 === 对应原引用 ⟺ 零标记子树 → 返回原节点引用；否则返回构造壳
```

主流程（options 在场分支）：

```text
depth = 校验后的 options.depth（缺席 → ∞）                    // width 校验后弃用
walked = V.map(c => walk(c.node, depth, c.path))              // 终点候选逐个、完整预算起算
valueSchema = walked.length === 1 ? walked[0] : { kind:'union', members: walked }   // 与既有合成同形
aliases = ordered closureEntries（发现序）                     // 与既有 collectAliasClosure 发现序一致
docs/aliasDocs = 三源表扫描（序照抄 sliceDocs），want(k) = spine.has(k) || emitted.has(k)
return { ok:true, valueSchema, aliases, docs, aliasDocs }     // 恰五键（ok + 四件套），无新增键、无 options 回显
```

### 7.4 无 options 逐字节恒等的结构性论证（F1/F2 修订后重立）

1. `options === undefined` 时预算代码零执行（分支隔离）——运行路径 = 既有代码逐指令（零开销、零语义变化，SA8 §8.3）。
2. 显式 `undefined` / `{}` / width-only / 充足 depth 走预算分支，以下四点合取给出逐字节恒等：
   - **valueSchema 与 aliases**：身份短路 + ref 原样保留 + 闭包登记（自递归重入经 in-progress 透传取得原体）⇒
     全部为原共享节点引用；闭包发现序 = walk 的 DFS 次序 = 既有收集器次序（字段声明序、union 成员序、候选序——
     环机制对此零影响，见下一点）。
   - **环机制行为中性**：对无环输入，in-progress 永不命中（无环定义使然）、完成表命中返回的恰是该遍历将重算的同一
     结果——两相防御在无环输入上与「无防御直渲染」输出恒等；对合法递归别名，透传复现无预算闭包纪律（原体引用，
     §6.3.5(c)）。
   - **docs 键集**（F2 修复后的双向论证）：零标记 ⇒ (⊆) 每个 emitted 位属于某终点子树、某闭包体（以别名锚名为根）
     或脊柱——无预算分支的终点前缀/闭包前缀/脊柱规则均选中；(⊇) 无预算分支选中的每个键 k：k ∈ 脊柱（预算分支同样
     精确选中），或 k 的锚定链自某终点路径/闭包锚名起由文法段（字段名/`<key>`/`<item>`/`<member N>`）构成——walk
     在未裁位上对每类文法段都渲染并 emit（union 成员位既有；**enum 字面量成员位经 §6.3 F2 修复补齐**），故 k 的
     锚定位 ∈ emitted、精确匹配选中。
   - **三源合并序与扫描序**照抄 `sliceDocs`（键序 = 表声明序扫描，逐调用确定）。
   ⇒ `JSON.stringify` 逐字节相等且冻结哈希（SA6 §13.5）不变——该论证现覆盖含 enum 成员注释键的派生物（M4 型）与
   含递归别名的派生物（原论证对前者的缺口即 F2，已闭合）。
3. 由此 G8.1（14 路径哈希）、G8.2（显式 undefined）、G8.3（充足 depth）、G6.1/G6.2（width no-op）、G7.1（`{}`）
   全部为同一机制的直接推论；`{}` 的恒等域并覆盖手造环状输入（引用级同构，§6.3.5 测试口径）。

### 7.5 数据流路线

| 路线 | 触发者与输入 | 写入或创建点 | 转换与边界 | 存储或传输 | 读取或投影点 | 可观察结果 | 错误与清理 | 验收锚点 |
|---|---|---|---|---|---|---|---|---|
| 无预算读（既有，不变） | 调用方 `(derived, path)` | 无写入；投影为只读共享引用 + 每调用新鲜 docs 数组/闭包 record | derived 可信域（throw）/ path 敌意（两码）边界不动 | 无（零 memo、零缓存） | namespace-runtime detach 深拷贝（L106–114）后进 readData `schema` 键 | 逐字节 = 现行为 | 失败 = 判别联合；InternalError 直通 | SA6 G8.1 冻结哈希；既有 651 用例 |
| 预算读（新） | 调用方 `(derived, path, options)` | 每调用新鲜：标记节点、预算壳（仅构造位）、闭包 record、docs 数组、walk 局部 inProgress/memo（调用结束即弃） | §6.5 校验（敌意 → 三码判别）→ §6.3 walk（先裁后收集、身份短路、两相环防御、零物化）→ §6.6 切片 | 无（零跨调用状态） | 同上（T3 落地前仅测试/外部消费方直接消费） | ok = 预算投影四件套（恰五键）；被裁位 = 标记（ref 名/容器 kind 线索）；环状输入透传原引用不发散 | options 非法 → SCHEMA_OPTIONS_INVALID；路径失败两码不变；可信域 InternalError 通道不变（含预算分支 ref 缺失守卫）；**预算游走零新增 throw** | SA6 G2–G8；§6.3.4 矩阵；§6.3.5 环断言；M4 型逐字节差分 |
| 派生 schema（只读事实源） | evaluate 产物（不在本票） | 无（本票对 derived 零写入；G3.4 深比较锚定零变异） | — | — | walk 只读取 `derived.values` | — | — | G3.4 |

跨模块边界一跳说明：resolver 返回的 valueSchema/aliases 与调用方 derived **共享节点**（不可变契约；身份短路下亦然），
detached 深拷贝属 namespace-runtime 组合边界（ADR 0016 交付纪律 L69–70）——预算标记节点的拷贝处理属 T3 面
（本票不实现，G10 前提已记录）。

---

## 8. 错误、恢复、并发与幂等

- **错误三分不变 + 一分新增**：① path 敌意 → 两码（不变）；② **options 敌意（新）→ `SCHEMA_OPTIONS_INVALID`
  （判别、同步、不抛、含敌意 getter/Proxy 收敛）**；③ derived 可信域畸形 → `InternalError` throw（清单不变、无顶层
  catch 不变）；④ 正常 → ok 投影。次序：path → options → derived → 游走（§6.5.4）。
- **预算游走零新增 throw（F1 修订的纪律面）**：环防御以透传返回（对象图环/透明环任何预算下不发散、不泄漏
  `RangeError` 等裸异常——模块 throw 纪律「本函数 throw 的只有 InternalError」在预算分支同样成立）；预算分支
  ref 目标缺失经 `Object.hasOwn` 守卫收敛 `InternalError`（与既有 `collectAliasClosure` L406 同文——裸
  `values[name]` 访问的 `TypeError` 不可能出现）；ref 名环仍由**不变的**路径游走段按既有语义处置（路径穿过时
  InternalError、否则 ok——预算读与无预算读在同一 (derived, path) 上 throw 行为逐字节一致）。
- **失败无部分状态**：options 校验先于一切预算游走；失败对象仅含 `{ok, code, path}`（path 新鲜副本）。
- **并发/幂等**：同步纯函数、零 memo（跨调用）、全部状态调用内局部（regexCache 既有局部先例保持；walk 的
  inProgress/memo 同为调用内局部）——重复调用逐字节确定（G2.7/G8.4）；预算读与无预算读交错无相互影响。
- **恢复/重试**：无副作用（零写入），调用方可任意重试；被裁位补全 = 调用方以更深 depth 或逐路径再读
  （「这次没取，可再访问补全」语义，ADR 0024 决策 2）。
- **回滚**：改动集中于单文件分支 + index 出口；回滚 = 移除预算分支与出口，无 options 路径因分支隔离未被触碰。

---

## 9. 调用方影响矩阵

| 调用方 | 当前处理 | 设计后处理 | 所需改动 | 证据 |
|---|---|---|---|---|
| `packages/namespace-runtime/src/read-schema-projection.ts` L56（两参调用，直接） | 两参 → 纯 `ValueSchema`；detach 逐 kind 穷举拷贝 | 完全不变（第一重载保纯度；运行时行为逐字节不变） | **零改动**（T3 #336 才引入三参与标记拷贝） | 本设计 §6.8；G9.2 root typecheck |
| `packages/namespace-runtime` 投影测试（恰三键/`schema:null`/D5 深拷贝，间接） | 锚定两参行为 | 不变、全绿（T2 不触该包） | 零改动 | SA6 §6 负控表 |
| `packages/vfsl/test/resolve-schema-at-path*.test.ts` / `.test-d.ts`（既有 8 文件，直接） | 651 用例含类型面 | 不变、全绿（两参调用面与既有名目形状零变化） | 零改动（SA6 §12.3「一行不改」；新预算测试可 import 只读复用其夹具，见 §10） | G8.1/既有断言 |
| `packages/namespace-registry` 文档负控（间接） | `readDataOptionUsages` 只匹配 `readData(` 带参用法，不覆盖 `resolveSchemaAtPath` | 不触发（T2 注释不写 `readData(` 带参形态） | 零改动 | `readdata-docs-adr0016-contract-fixture.ts` L30/L110（SA8 已核） |
| T3 #336（未来直接调用方） | — | 经第二重载得 `BudgetedResolveSchemaAtPathResult`；三码吸收与标记 detach 拷贝按 G10 前提（§6.10）实现 | T3 面票内处理 | §6.10/§14 |
| 外部消费者（npm，0.x） | 两参/既有类型 | 加法扩展；0.x minor bump 依据 ADR 0024 L69 | 无强制迁移 | §6.8 |

未覆盖调用方：无（生产源码调用面经 grep 全量枚举如上；F1/F2 修订不改任何签名/结果形状，调用方面零增量）。

---

## 10. 文件范围

### ALLOW LIST

| 路径 | 预期改动 | 原因 |
|---|---|---|
| `packages/vfsl/src/resolve-schema-at-path.ts` | 投影体泛型化；新类型（§6.4/§6.8）；重载签名；options 校验；预算 walk（含两相环防御与 `Object.hasOwn` 守卫）；enum 成员位 emit；预算切片；文件头注/函数 JSDoc 扩写 | 唯一改造面（SA6 §10/G9.1；ADR 0024 决策 5「解析入口」） |
| `packages/vfsl/src/index.ts` | 新增 6 类型 + 1 守卫函数出口；L117–126 注释块扩写 | 公共面出口纪律（模块契约 / SA8 §8.2） |
| `packages/vfsl/test/resolve-schema-at-path-budget-fixture.ts`（新） | 预算专用 VFSL 文本（嵌套别名链、ref 内嵌 ref、容器×union 对偶、**enum 成员注释锚定位——内联/别名/数组元素/Record 槽四形态至少各一，可直接 `import { M4_TEXT }` 只读复用既有 M4 夹具或同型构造**、深位文档、可选字段孪生、多引用跨预算构造）+ 期望字面量 + §6.3.4 修正矩阵 + 毒化派生物构造器 + **手造环状派生物构造器（union/optional 自引用环、容器环）** + 基线哈希字面量 | SA6 §12.3；oracle 独立对账（G0.2）；F1/F2 验收锚的夹具面（SA2 §13 验收列） |
| `packages/vfsl/test/resolve-schema-at-path-budget.test.ts`（新） | G2–G7 运行时断言；动态接缝取导出；红灯显式报因；**F2 锚：enum 成员注释键在 `{}`/充足 depth/width-only 下与无预算读 `JSON.stringify` 逐字节相等、被裁 enum 成员键省略；F1 锚：环状派生物不发散/无裸异常/透传同构/确定性；F3 锚：毒化 + `{depth:N>0}` 仍 InternalError 差分** | SA6 §12.3 红灯契约；SA2 §7–§8/§12/§13 验收转写 |
| `packages/vfsl/test/resolve-schema-at-path-budget.test-d.ts`（新） | G1 类型面断言（expectTypeOf + @ts-expect-error；新名目从 `../src/index.js` 导入） | SA6 §12.3 |
| `packages/vfsl/test/resolve-schema-at-path-budget-control.test.ts`（新） | G0 + G8.1 负控（两参静态可编译、不 import 新名目）；**含 M4 型夹具的无预算基线冻结（为 F2 逐字节差分提供对账基点）** | SA6 §12.3 |

### DENY LIST

| 路径 | 与任务的关系 | 禁止修改原因 |
|---|---|---|
| `packages/vfsl/src/derived.ts`、`evaluate.ts`、`validate-patch.ts`、`resolve.ts`、`pattern.ts`、其余 vfsl src | ValueSchema/DerivedSchema 冻结面、求值与写侧守卫 | ADR 0003 L46 / 0024 L115；G1.4 冻结锚；本票只动解析入口 |
| `packages/doc-runtime/**` | T1 #334 值通道三参化 | SA8 §8.5 越界禁令 |
| `packages/namespace-runtime/**` | T3 #336 readData 五键组合 + detach 拷贝面 | 同上；ADR 0016 L75 组合边界 |
| `packages/namespace-registry/**`（含 `test/readdata-docs-adr0016-contract-fixture.ts`） | 文档负控正则修订 | T5 #338 面 |
| `packages/vfsl-protocol/**` | T4 #337 DeepOptional 类型面 | 票谱系分工 |
| `docs/**`、`CONTEXT.md`、`packages/vfsl/AGENTS.md` | ADR 0024 与词汇已落基线；回填批注属 PR #332/T5 | SA6 §10 明确不改面；G9.1 |
| 既有 8 文件（**显式枚举，替代原 glob——F4**）：`packages/vfsl/test/resolve-schema-at-path.test.ts`、`resolve-schema-at-path-control.test.ts`、`resolve-schema-at-path-member-docs.test.ts`、`resolve-schema-at-path-member-docs-control.test.ts`、`resolve-schema-at-path-pattern-errors.test.ts`、`resolve-schema-at-path.test-d.ts`、`resolve-schema-at-path-fixture.ts`、`resolve-schema-at-path-member-docs-fixture.ts` | 既有回归锚（#272/#308 契约、负控、成员文档、pattern 错误及其夹具）——**一行不改**；新预算测试可 `import` 只读复用（如 `M4_TEXT`/`FIXTURE_TEXT`），import ≠ 修改 | SA6 §12.3「一行不改」；原 DENY glob `resolve-schema-at-path*.test.ts` 同时匹配 ALLOW 新文件（ALLOW∩DENY 非空、门禁判读歧义），已改为显式路径列表，两表交集为空 |
| `.github/**`、`vitest.config.ts`、`tsconfig*.json`、`package.json` | 门禁与工程配置 | 无需变更；G9.1 改动面纪律 |

---

## 11. 验收与验证映射（对应 SA6 §12 契约；SA1 不编写/运行测试）

| 需求或风险 | 现有证据 | 所需行为测试或动态场景 | 预期观察 |
|---|---|---|---|
| AC1 标记位置/线索（G2/G3） | P1 红（标记 0 命中） | budget.test.ts：§6.3.4 修正矩阵全格断言（位置=类型位、union 成员位按索引、线索 ref 名全等/容器 kind 可区分、精确集合相等） | 矩阵逐格绿；D1/D2/D3 变异红 |
| AC2 闭包/切片收缩（G4/G5） | P1 红（恒全量） | 闭包键集精确相等（`{AssetEntity}`@d1 等）；docs ⊆ 无预算且共享键逐字相等；**F2 锚：预算夹具显式含 enum 成员注释锚定位（内联/别名/数组元素/Record 槽四形态至少各一——直接 import M4_TEXT 或同型构造），`{}`、充足 depth、width-only 在该夹具上与无预算读 `JSON.stringify` 逐字节相等，被裁 enum 的成员键确被省略（裁剪语义不受修复影响）**；脊柱键保留 pin；毒化 `{depth:0}` ok 与无预算 throw 差分 | G4.1–G4.4/G5.1–G5.3 绿（含 enum 注释键场景——原 G5.1 仅 ⊆ 不拦截零标记丢键，逐字节差分补位后可拦截）；D4/D5 变异红 |
| AC3 计层/width（G2/G6） | 无计层实现 | union 对偶孪生、optional 孪生、enum 终态、ref 边界、depth 单调；width-only/组合逐字节 ≡（预算真实生效后重验；enum 注释夹具上该断言对 F2 类缺陷敏感——设计已闭合） | G2.1–G2.7/G6 绿；D2/D6 变异红 |
| AC4 公共面/回归锚（G1/G8） | P2 红（TS2554/TS2724） | test-d：三参编译、新名目 index 导入、两参纯度（@ts-expect-error 锚）、九 kind 冻结；control：14 路径冻结哈希（#272）+ **M4 型夹具无预算基线冻结与 `{}`/width-only/充足 depth 逐字节差分**（#272 哈希无 enum 成员注释、单独捕捉不到 F2——SA2 §12 AC4 行）、显式 undefined、跨调用无状态 | G1/G8 绿；D7/D9 变异红 |
| AC5 门禁（G9） | §4 基线全绿 | §12.6 四命令 + 改动面 `git diff --name-only` ⊆ ALLOW LIST | 全绿 + namespace-runtime 穷举拷贝编译通过 |
| options 校验（G7，SA8 §8.3） | 无守卫（P1 静默忽略） | 非法值矩阵（负数/非整数/非有限/非对象/未知键/present-undefined/抛错 getter/Proxy）；path 回显；`{}`/合法预算 | 判别失败、不抛、无部分截断 |
| aliases 加宽 override（§6.1） | — | test-d：预算结果 `aliases` 为 `Record<string, BudgetedValueSchema>`；运行时 G3.4/G4.2 按体内标记断言 | 类型面与运行时一致；SA8 复核项 |
| 计层矩阵修正（§6.3.4） | SA6 §12.4 默认读法 | fixture oracle G0.2 层结构字面量对账独立推导 `['u']` d=2 期望 | oracle 与修正矩阵一致（无标记、≡ 无预算） |
| 多引用跨预算（§6.1 首发现 pin） | — | fixture 含双引用同别名构造，断言首发现渲染 + 确定性 | 逐字节确定；T3 前提记录 |
| **环防御（§6.3.5，F1/SA2 S1+E2）** | 规约新立（无实现） | 手造环状派生物：union/optional 自引用环 × `{depth:0}`/`{depth:N}`/`{}`/width-only；容器环 × `{}`/width-only/有限 depth。断言：调用正常返回（ok，或路径穿过 ref 名环时 InternalError——与无预算读同构）；无 `RangeError`/`TypeError` 等裸异常；`{}` 输出与无预算读引用级同构（valueSchema/aliases 条目 === 对应原节点；环状输出不可 stringify，用引用相等断言）；有限 depth 下标记按 §6.3 规约确定；重复调用逐字节/逐引用确定 | 不发散、无裸异常、透传同构、确定性；两相防御变异（恢复「出口写表」）在环用例上红 |
| **预算分支 ref 缺失守卫（§6.3/§7.3，F3/SA2 E3）** | P3（`{depth:0}` 今日 throw） | 毒化派生物：`{depth:0}` → ok（零触达）；`{depth:N}`（N 足够触达该 ref）→ 仍 `throw InternalError`（非裸 `TypeError`）；无预算 → throw（既有） | 三态差分完整；P3 毒化哨兵不失锚 |

---

## 12. 风险、回滚与残余问题

| 风险 | 等级 | 缓解/回滚 |
|---|---|---|
| aliases 类型面加宽扩大 SA8 §4 override 范围（超 ADR L77 字面） | 中 | §6.1 已论证为 L81 一一对应承诺的必然结论；列入 SA8 复核（§14）；无预算读纯度与逐字节锚不受影响 |
| 新稳定码 `SCHEMA_OPTIONS_INVALID`（ADR 未钉死位） | 中 | §6.5 论证 + 复核项；码一旦发布即兼容行为，不可轻改——实现前经 SA8 复核确认 |
| docs 脊柱键保留解读（延伸决定边界 pin，§6.6） | 低 | 与「docs 跟随锚定位在场」原则一致；G5.1 子集断言两读法均满足，属可调 pin——若 SA8/Owner 另有解读，仅需改切片 want 一处 |
| 逐字节回归漂移（预算分支构造路径污染无预算输出） | 低 | 分支隔离 + 身份短路 + enum 成员位 emit 使恒等为结构性结果（§7.4 修订论证）；#272 冻结哈希 + M4 型逐字节差分双门禁兜底 |
| **enum 成员注释键丢键（F2 已修复）** | 低（修复后） | §6.3 enum 行成员位 emit + §7.4.2 双向等价论证；M4 型夹具零标记逐字节差分锚定（§11 AC2/AC4 行）；被裁 enum 成员键省略断言防「修复扩大裁剪面」 |
| **预算游走环发散 / 裸 RangeError（F1 已修复）** | 低（修复后） | §6.3.5 两相防御 + 环断言组（§11）；完成表按节点身份键控的预算串染仅存于可信域外 DAG（合法派生物单预算上下文——§6.3.5 论证），方向为过度裁剪/少报（安全侧），确定性有保证 |
| 闭包多引用跨预算的信息损失（按名共享的固有性质） | 低 | §6.1 失效方向安全论证 + §6.10 T3 弱断言/夹具规避前提；非本票可消除项（消除需破坏按名引用纪律） |
| walk 递归深度（深类型树 + 大 depth） | 低 | 递归深度 = 类型树深（与既有闭包收集同阶）；同步纯函数无栈外状态；parser 侧类型嵌套有既有上限（`depth` 嵌套深度上限，与本票无关）；环状输入由 §6.3.5 终止性规约覆盖 |
| 残余（明确 follow-up，非本票）：T3 差分验收值条目 ↔ 标记路径（G10.2，含 §6.10 options 校验规则集对齐前提）；T5 文档负控/形状注记与 ADR 0016 回填批注；T4 DeepOptional | — | 票谱系分工（#336/#338/#337），前提已随本设计交付（§6.10） |

任务内必要条件均已收口，无伪 follow-up、无阻塞。

---

## 13. 评审修订映射（iteration 1；输入 `wiki/raw/task_issue-335_sa2_review.md`）

| Finding | 修订位置 | 处理结果 |
|---|---|---|
| **F1（MAJOR）** 预算 walk 环防御机制与自述不变量矛盾（「出口写表」对环必发散 → 裸 `RangeError`；违反 throw 纪律、`{}` ≡ 无 options、自述「值树环不发散」） | §6.3 配套机制（重写环防御 bullet）；**§6.3.5（新章：环语义规约——两相防御/透传语义/四点理由/ref 名环区分/完成表键控串染分析/测试口径）**；§6.1（递归包含例外）；§7.2（上下文名目）、§7.3（入口协议伪代码）、§7.4.2（环机制行为中性论证）、§7.5、§8（零新增 throw）、§11（环防御行）、§12（风险行）、§6.11（「出口写表」与「标记/预算副本」否决行） | **已解决**：改为「完成表 + 进行中集」两相防御，进入即登记、重入返回**原节点引用**（透传），完成后记忆化供 DAG 复用；`{}` 在环状输入上与无预算读引用级同构；合法递归别名恒等前提成文（§6.3.5(c)）；§7.4.2 与 §12 相应行同步修正 |
| **F2（MAJOR）** 预算分支 docs 选键规则在 enum（字面量联合）成员注释键上与无预算分支不可等价（`{}`/充足 depth/width-only 逐字节恒等在含此类注释的合法派生物上必红） | §6.3 表 enum 行（成员位 emit + F2 修复理由）；§6.3.4（矩阵相容性说明）；§6.6（want 谓词等价论证重立 + M4 例）；§6.11（前缀匹配否决行修正——撤回原「emitted 精确匹配天然同集」错误前提）；§7.4.2（双向等价论证）；§10（夹具面四形态 enum 注释锚定位 + M4 只读复用）；§11（AC2/AC4 行逐字节差分）；§12（风险行） | **已解决**：采用 SA2 选项 **(b)**——walk 的 enum 终态补 emit `` `${path}.<member ${i}>` ``（字面量终态永不标记）。选项 (a)（渲染位前缀匹配）经核验**不采纳**：`[]` d=1 时 `ROOT` 壳前缀会过选标记位键 `ROOT.audit`/`ROOT.keywords`/`ROOT.config`（#272 fieldDocs 实际在册），与评审自身核验的矩阵格（docs=`{ROOT.notes}`）及「被裁路径省略」矛盾——技术冲突与依据已记录于 §6.11，属评审建议二选一内的裁决，无需外部决策 |
| **F3（MINOR）** 伪代码容器分支顺序（子位 walk 列于 `if b==0` 之前）+ ref 情形缺 `Object.hasOwn`/InternalError 守卫 | §6.3 表（「预算判定先于子位触达」权威顺序 + ref 行守卫）；§7.3（伪代码 b==0 先行、hasOwn 守卫同文 InternalError）；§11（`{depth:N>0}` 毒化差分行） | **已解决** |
| **F4（MINOR）** DENY glob `resolve-schema-at-path*.test.ts` 匹配 ALLOW 新文件（ALLOW∩DENY 非空） | §10 DENY LIST（显式枚举既有 8 文件 + import ≠ 修改注记） | **已解决**：两表交集为空 |
| **F5（MINOR）** present-undefined 拒收规则未记录为 T1/T3 跨票对齐前提 | §6.10（新增长度：跨票 options 校验规则集对齐前提） | **已解决**：前提入 §6.10 清单并随 G10 前提写入 T2 实现说明 |

未落实 finding：无。评审 §14 非阻断观察 1（SA6 §12.4 erratum 批注路径）维持原 §13/§14 处置（矩阵修正经评审独立重放证实、G0.2 oracle 仲裁、SA8 复核已武装——erratum 批注建议留待 Controller/SA8 复核时定夺，不属设计产物义务）。

---

## 14. 设计后 ADR 冲突复查

**`requiresConflictRecheck = true`**。理由（对应 SA8 §10 三项 + 本设计新增项；F1/F2 修订均落在 ADR 0024 L73
「选键收缩」授权域与模块 throw 纪律既有授权域内，**不新增 ADR 冲突面**——SA2 §14.4 亦确认）：

1. **公共 API/类型面变更**（SA8 §10(a)）：`resolveSchemaAtPath` 重载三参化、投影体泛型化、6 新类型 + 1 守卫出口、
   结果联合新增失败分支——须后置核对两参调用面纯度（G1.3/G9.2）与名目出口纪律。
2. **两项正式 override 的落地核对**（SA8 §10(b)）：无 options 逐字节恒等（G8）与无预算读恒纯 `ValueSchema`（G1.3），
   以及 **override 范围的一处显式扩大——`aliases` 字段类型随 Q1 裁决同步加宽**（§6.1，超出 ADR 0024 L77 仅点名
   valueSchema 的表述，属「修订既有决策表述边界」类，须 SA8 复核确认）。
3. **新增失败码 `SCHEMA_OPTIONS_INVALID`**：ADR 0024 只注册 `READ_OPTIONS_INVALID` 于 readData 主接缝；resolver 层
   码位是 SA8 §8.3 明文留给 SA1 的收口点，收口结果需经复核定格为兼容行为。
4. **docs 脊柱键保留解读**（§6.6）：ADR 0024 L73 延伸决定的边界 pin，建议随复核一并核对。
5. **跨票计层一一对应**（SA8 §10(c)）：T2 计层规则与 T3 归一化前提（§6.10，含 options 校验规则集对齐前提）在 T3
   实现期差分核对——本票交付前提，复核确认规则未漂移。
