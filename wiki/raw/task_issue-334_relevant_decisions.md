# Relevant decisions — task_issue-334（前置门禁摘录）

> 任务：`[shape-budget] T1: 值通道形状预算——载体投影读取三参化与截断省略`（Issue #334，parent PR #332）。
> Phase：conflict-gate（task 前置门禁）。本文件只摘录相关决策、条款与关联点，不重写原义、不作业务设计。
> Issue 评论快照：REST 读评论成功且零评论——无 Owner override 需要应用（comment IDs: none）。

## 决策集状态一览

- `docs/adr/` 现存 20 份 ADR（0001–0014、0016–0019、0022、0024），状态全部为 accepted；无整份 superseded 条目。
- ADR-0007 状态注明「Runtime/open/read 条款由 ADR 0008 部分取代」——其 schema-aware `readLogicalValueAtPath(derived, doc, path)` 与 open 编排条款**不构成约束**；logical validation / detached materialization / validated mutation / 零写入 / observer no-rollback 条款继续有效（与本只读任务无交集）。
- ADR 0020/0021 存在于未合并分支（`docs/issue-310-vfsl-number-constraints`、`mabf/issue-314`），不在当前分支决策集内；0015/0023 从未存在。二者均不构成本任务约束面。
- ADR-0024 于本分支已入库（commits `50d52a1` → `7679c57` → `ba11f32`，tracking issue #331），状态**已接受**——本任务的直接治理 ADR。

---

## ADR-0024：readData 形状预算（直接治理 ADR，已接受，2026-09-12）

### 决策 1：API 与参数语义（L20–31）

摘录（与 T1 直接相关条款）：

- 「**`depth`**（≥ 0，整数）：自目标节点向下允许**展开**的容器层数。容器（Y.Map / Y.Array / plain object / plain array）各计一层；标量与 `Y.XmlFragment`（语义字符串）是终态。`depth: 0` = 纯骨架读——目标容器自身折叠为同形空容器 + 单条 depth 截断项（readData 的 value 键恒在场，目标节点不能省略自身）。」
- 「**`maxChildrenPerNode`**（≥ 0，整数）：每个被展开节点最多保留前 K 个子项。数组按下标天然稳定；映射按键的插入序——**不承诺稳定，这不是分页 API**，只是护栏。」
- 「预算在载体投影递归内生效：未展开分支零物化成本（成本从 `O(目标子树)` 收敛到 `O(实际返回部分)`）。」
- 「**不传 options = 完整投影**：逐字节现行为，零截断。」
- 「**非法 options**（负数、非整数、非有限数、非对象、**含未知多余键**——options 是封闭形状，与 VFSL 封闭对象纪律同精神）：响亮拒绝，新稳定失败码 `READ_OPTIONS_INVALID`（同步、不抛；不借用路径失败码或生命周期失败码——预算缺陷不是路径缺陷）。」
- 「**终态目标的预算是 no-op**：目标为标量或 `Y.XmlFragment`（语义字符串）时任何 depth 值都原样返回（终态无展开可言）；width 同理不适用。」

**关联点**：简报 What-to-build（task_issue-334.md L17）对决策 1 逐点复述（三参形态、递归内生效、零物化、depth:0 骨架、终态 no-op、封闭 options 响亮拒绝、无 options 逐字节不变）；AC1/AC4/AC5 与「验收」节「载体单元」条对应。

### 决策 2：截断省略——值内唯一截断形态（L33–40）

摘录：

- 「depth 耗尽与 width 超限触发**同一种**值内形态：被裁子项的键不出现在返回值中。……语义是『这次没取，可再访问补全』，不是『数据为空』。」
- 消歧规则：「键缺席 **且不在** 截断清单 = 真缺席（既有缺席吸收语义不变）；键缺席 **且在** 清单 = 被裁。」
- 「值域纪律不动摇：输出端 undefined 值键省略的吸收纪律（ADR-0008 缺席语义条款；实现词汇 E1）保持——不引入『键在、值 undefined』第三态；不引入魔法哨兵对象……；不引入同形空占位 `{}` / `[]`……。**唯一例外**：`depth: 0` 时目标节点自身以同形空容器呈现……该例外是『目标节点』的呈现规则，不是子项占位的复活。」

**关联点**：简报「截断省略为值内唯一截断形态(depth 与 width 同形态,键省略)」；AC4「缺席吸收语义……不破」。

### 决策 3：截断清单（L42–56）

摘录：

- 「预算读成功结果中**恒在场**的截断事实通道（无截断时为空清单）。每条：`path`（被裁位置，与 readData 实参同基）/ `kind`（`'depth'` / `'width'`）/ `omitted`（省略计数）。」
- 「depth 条目的 `path` 尾段即被裁键名——键名的唯一在场位置（值内已省略），枚举不丢键名；width 条目只在父路径记一条，不逐键罗列。」
- 「**`omitted` 语义（钉死）**：depth 条目 = 被截容器的**直接子项数**（Y.Map `size` / Y.Array `length`，O(1)）；width 条目 = 超出保留数的子项数。**不是后代总数**——统计后代必须遍历被截子树，直接违背『未展开分支零物化成本』（决策 1）。」
- 「条目**不携带**被截容器内部的子键列表……；清单规模由预算间接约束……不需要独立护栏。」

**关联点**：简报「omitted = 直接子项数(O(1),非后代总数)」；AC2「截断事实(位置/裁因/直接子项数计数)随结果返回,可供 runtime 组合消费」。注：「恒在场」通道的措辞锚定在 runtime `readData` 成功分支（决策 4 五键形态）；doc-runtime 层结果联合如何携带截断事实（组合消费形态）属 SA1 设计粒度，受 AC5「无 options 逐字节回归锚」与决策 1「不传 options 逐字节现行为」双重约束。

### 决策 4：结果形状（破坏性修订，L58–69）——**非 T1 范围**

摘录（界定范围用）：readData 成功分支「恰三键 → 恒五键」（`value`/`schema`/`truncated`/`truncations`）；「既有『恰三键』形状锚、深等断言与 docs/integration 形状注记全线修订」。

**关联点**：该修订作用于 `@nomicore/namespace-runtime` readData 面（含 `docs/integration/cordis-plugin-hosting.md:340` 的「恰三键」注记），属后续切片；T1 简报范围为 doc-runtime 载体单元面，未越界抢先实现该面。

### 决策 5：语义 schema 投影同 depth 裁剪（L71–83）——**非 T1 范围**

摘录（界定范围用）：`resolveSchemaAtPath(derived, path, options?)` 三参化（`@nomicore/vfsl`）；投影层包装不扩展 ValueSchema 语义联合；两通道截断位置对齐计层规则。

**关联点**：T1 为值通道（doc-runtime）；投影通道裁剪、投影包装联合、别名闭包收缩属 vfsl/runtime 后续切片。计层规则（值通道数数据载体层；标量/XmlFragment 终态）中「值通道数数据载体层」一半在 T1 落地，类型树同构计层归投影切片——两通道**对齐承诺的完整兑现跨切片**，T1 只需按决策 1 的容器计层定义实现值通道侧。

### 决策 6：公共面归属（L85–87）

摘录：「预算是 schema 无关的投影概念，属 ADR-0008 读域：载体投影读取公共面扩展为三参形态 `readLogicalValueAtPath(doc, path, options?)`，projection 递归（Yjs 容器递归与 plain 域拷贝两条路径）携带预算；runtime `readData` 组合值与投影两通道的同预算截断；registry lease 原样透传。不新增第二条读路径。」

**关联点**：T1 的落点条款——三参化落在 `@nomicore/doc-runtime` 公共面；「Yjs 容器递归与 plain 域拷贝两条路径」正对 read.ts 现行 `projectValue` / `copyPlainStrict` 双递归（read.ts 头注 D6）；「不新增第二条读路径」排除旁路实现。

### 决策 7：类型面（L89–95）——**非 T1 范围（vfsl-protocol 侧）**

摘录（界定范围用）：无 options 保持 `PathAt` 完整子树承诺；带 options 静态类型 `DeepOptional<PathAt<…>>`，进协议类型面并列导出，零 per-schema 生成。

**关联点**：`DeepOptional` 属 `@nomicore/vfsl-protocol` 类型面（后续切片）；T1（doc-runtime）无 `PathAt` 面。doc-runtime 侧仅需第三参 `options?` 的加法类型（TS 可选参数），不触 codegen。

### 「对既有 ADR 的修订」节（L97–105）

摘录：

- 「**ADR-0008**：读语义由『目标子树**完整**深拷贝』修订为『预算内投影 + 截断清单』——不传预算 = 完整投影（既有语义作为默认保留）；投影递归成本界由『目标子树』改为『实际返回部分』……」
- 「**ADR-0016**（四处显式登记，不静默矛盾）：…… 2. 『分层与兼容面』`readLogicalValueAtPath(doc, path)` 签名与语义不变条款：签名加法扩展为三参（`options?`），**无 options 时签名与语义逐字不变**。3. 『解析语义』`resolveSchemaAtPath(derived, path)` 签名：加法扩展第三参…… 4. Consequences 成本句……修订为 `O(path + 实际展开的值部分 + 展开层引用的类型闭包与注释切片)`。」
- 「**文档负控**：`packages/namespace-registry/test/readdata-docs-adr0016-contract-fixture.ts` 的 `readDataOptionUsages` 正则……由『禁一切带参用法』改为『只禁 schema opt-in 形态、放行预算形态』。」

**关联点**：本节即 ADR-0024 对 0008/0016 的**显式修订登记**（合法演进路径：新 ADR 修订旧 ADR）；简报三参化由此获得决策依据，不与 0008/0016 修订前原文构成冲突。文档负控正则修订属 registry/readData 面（后续切片），非 T1 落点。

### 「验收」节中 T1 对应条（L120–130）

摘录：「**零物化行为哨兵（主动机回归保护）**：被截子树内埋投影不可表示值（non-finite number / 稀疏数组空洞）——预算读必须 `ok: true`（递归未触及）；『先全量物化再裁剪』的退化实现会触发 `PATH_NOT_ALLOWED` 而变红。行为级断言，不依赖性能基准」「**载体单元（doc-runtime 公共面）**：预算递归截断省略结果、缺席吸收纪律不破、敌意 path 零 throw、终态目标预算 no-op」「无 options 逐字节现行为回归锚」。

**关联点**：简报 AC1–AC5 与之一一对应；AC3 的哨兵机制与 read.ts 现行 plain 域纪律（`copyPlainStrict` 对 non-finite/数组 undefined 响亮失败，头注 D6）互为反证面。

---

## ADR-0008：NamespaceRuntime 读写能力与单序列器（accepted，读域被 ADR-0024 修订）

### 「读取能力」节（L18–30，修订前原文 + 0024 修订后有效语义）

摘录（继续有效、T1 必须保持的条款）：

- 「`Y.Map` 使用 string segment，`Y.Array` 使用严格非负整数 segment；plain object/array 同理」
- 「map/object 缺键或数组越界均成功返回 `undefined`，中间缺失立即结束」
- 「plain object 仅读 own enumerable string data property，不走原型链、不执行 accessor」
- 「plain subtree 仅允许 JSON-compatible plain value，禁止嵌套 Yjs shared type」
- 「`Y.XmlFragment` 是不可下钻终态，返回语义字符串；未知 Yjs shared type 响亮失败，不使用 `toJSON()` fallback」
- 「空 path 深拷贝完整 ROOT；非空 path 只转换目标子树；返回值是可变普通深拷贝，不做运行时冻结」→ 经 ADR-0024 修订节修订为「预算内投影 + 截断清单；不传预算 = 完整投影（默认保留）」
- 「预期路径、载体和 lifecycle 失败使用同步结果联合，只有 internal bug 才抛异常」
- 「读取只观察调用瞬间已经提交的 live Y.Doc，不等待已接纳但尚未提交的写」

**关联点**：缺席吸收、段纪律、XmlFragment 终态、零 throw、同步结果联合是 T1 预算递归必须原样携带的底座语义（简报 AC4）；终态 no-op 条款（0024 决策 1）直接建立在本 ADR 的终态定义上。

---

## ADR-0016：readData 语义 schema 投影（accepted；分层条款被 ADR-0024 修订节第 2 条显式修订）

### 「分层与兼容面」节 L74（修订前原文）

摘录：「`@nomicore/doc-runtime` 不动：读取保持 schema 无关（ADR 0008），`readLogicalValueAtPath(doc, path)` 签名与语义不变。」

**关联点**：该句已被 ADR-0024（L102）显式修订为「签名加法扩展为三参（`options?`），无 options 时签名与语义逐字不变」——按修订后决策集，T1 三参化有合法依据；「读取保持 schema 无关」半句**不在修订范围**，继续有效（预算是 schema 无关概念，ADR-0024 决策 6 原文自证）。注：ADR-0016 正文暂无 0024 镜像修订节（见冲突报告 N-1，非阻塞）。

### 正文其余条款（投影体/解析语义/交付纪律）

**关联点**：全部作用于 schema 通道（`resolveSchemaAtPath`、runtime 组合），非 T1 范围；T1 不触碰。

---

## ADR-0003：求值器与派生 schema（accepted——冻结面参照）

**关联点（负向）**：ValueSchema 是 9-kind 封闭语义联合（ADR-0024 决策 5 明文「塞进 ValueSchema 需修订 ADR-0003 冻结面」而**不采用**）。T1 为纯值通道，零触碰 ValueSchema 与派生 schema 面——该冻结面与 T1 无接触即合规。

## ADR-0007：逻辑验证与 Yjs Runtime Bridge 分层（accepted；read 条款被 0008 取代）

**关联点（负向）**：schema-aware `readLogicalValueAtPath(derived, doc, path)`（L26）已注明「已由 ADR 0008 取代」，不构成约束；其余有效条款（logical validation / validated mutation / 零写入 / observer no-rollback）与只读 T1 无交集。

## ADR-0001/0002/0004/0005/0006/0009–0014/0017/0018/0019/0022

**关联点**：逐份盘点（schema 真相源/重写定位/协议投影/生成管线/持久化/注册租约/复制/诊断日志/指纹/re-arm/成员注释/分块同步）均与 doc-runtime 只读载体投影无契约交集；ADR-0016 L77 明文「诊断变更日志不涉及读面」。未摘录条款。

---

## CONTEXT.md 术语（与本任务直接相关的词条）

- **形状预算（shape budget）**（L45–47）：`depth`/`maxChildrenPerNode` 语义、「预算在载体投影递归内生效——未展开分支零物化成本；不传预算 = 完整投影」、「预算护栏不是导航或分页手段」——与简报同源（ADR-0024 决策 1/2 的词汇化）。
- **截断省略（truncation omission）**（L49–51）：键省略形态、与真缺席的消歧、E1 吸收纪律不变、`depth: 0` 目标同形空容器唯一例外；_Avoid_ 明列同形空占位/魔法哨兵键/被省略键逐条进清单。
- **截断清单（truncation list）**（L53–55）：条目三字段、depth 尾段键名、width 父路径单条、omitted = 直接子项数；_Avoid_ 明列条目携带子键列表/当分页游标/条件在场/逐键罗列。
- **语义 schema 投影**（L41–43）：已含预算读投影裁剪句（投影包装联合、width 对投影无操作）——非 T1 范围但词汇已在位。
- **载体投影读取（readLogicalValueAtPath）**（L97–99）：schema 无关载体投影、不重复校验、持久化损坏不在契约范围——词条未冻结签名（无三参/双参字样），与 T1 加法扩展相容。

## 模块 AGENTS 收录的决策性纪律

- `packages/doc-runtime/AGENTS.md`：「Keep reads schema-independent」「Add public APIs only through `src/index.ts`; public-surface guard tests must account for every export」「Run root `pnpm typecheck` / `pnpm test` when public types or mutation/read contracts change」——T1 扩展公共读取面（第三参、options/截断类型、新失败分支）时的包边界义务。
- `packages/namespace-runtime/AGENTS.md` / 根 AGENTS.md：写路径纪律（typed writes、sequencer）与 T1 无交集；「Reads may use the dynamic `NamespaceLease.readData()`」的 typed 读纪律不受 T1 影响（DeepOptional 属后续类型面切片）。

## 现行代码事实（确认基线，非决策依据）

- `packages/doc-runtime/src/read.ts:53-56`：现行双参 `readLogicalValueAtPath(doc, path)`；`:44-46` 结果联合两态（`{ok:true,value}` | `{ok:false,code:'PATH_NOT_ALLOWED',path,message?}`）；顶层 try/catch（E100，零 throw 纪律）；`projectValue`（Yjs 容器递归）+ `copyPlainStrict`（plain 域拷贝，non-finite/数组 undefined/嵌套 Yjs 响亮失败）双递归——ADR-0024 决策 6 点名的两条投影路径。
- 全仓 `maxChildrenPerNode` / `READ_OPTIONS_INVALID` / `DeepOptional` 零命中——预算面为全新落地面，无先行实现/无陈旧引用。
- 冻结锚在库：`read-logical-value-at-path-schema-independent.test.ts`（行为锚 + 结果联合冻结形态）、`...test-d.ts`（双参签名锚，旧三参 `(derived,doc,path)` 形态的 `@ts-expect-error` 自反转锚）、`public-surface-guard.test.ts`（导出面全覆盖）、`read-logical-value-at-path-guards.test.ts`（敌意 path 零 throw）。
