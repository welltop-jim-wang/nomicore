# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出。只摘录，不裁决；引用编号与原文行号，需要时按编号回查 ADR 全文。

## 任务标识

- 任务：Issue #335 — `[shape-budget] T2: 投影通道形状预算——解析入口三参化与截断标记`（label：`in-progress` / `feature`）
- 简报：Issue #335 正文（`gh issue view 335`，comments 为空）与 `wiki/raw/task_issue-335.md`（同源摘要）
- Worktree：`/home/wangjian/nomicore-fix-issue-335`（branch `mabf/issue-335`，HEAD `ba11f32`，已含 PR #332 集成支上的 ADR 0024 三次提交 `50d52a1`/`7679c57`/`ba11f32`）
- 冲突基准：`docs/adr/` 全集 **24 个文件（0001–0024）逐个全读清点、相关者全文细读** + 根 `CONTEXT.md` 全读 + `packages/vfsl/AGENTS.md` 模块契约 + `docs/vfsl/v1-spec.md`（无 resolver 条款，已核）
- Ticket 谱系（tracking issue #331 / ADR 0024 / PR #332 `adr-0024-readdata-shape-budget`，集成 PR 未合并、本支已含其提交）：
  T0 #333（形状断言 helper 化 prefactor）→ **T1 #334（值通道三参化与截断省略，doc-runtime 面）** → **T2 #335（本票：投影通道三参化与截断标记，vfsl 面）** → T3 #336（readData 五键组合，namespace-runtime 面）→ T4 #337（DeepOptional 类型面，vfsl-protocol 面）→ T5 #338（文档负控与形状注记同步）

## 相关 ADR

### ADR-0024 readData 形状预算——depth/width 截断省略与截断清单（accepted，2026-09-12；本票直接母法）

`docs/adr/0024-readdata-shape-budget.md`（tracking issue #331；CONTEXT.md 已同步「形状预算 / 截断省略 / 截断清单」词条与「语义 schema 投影」词条的预算段）

- 与本任务的关联点：本票全部需求是 ADR 0024 **决策 5** 的 T2 切片兑现——解析入口三参化、valueSchema 同 depth 截断、投影层截断标记、别名闭包与注释切片收缩、计层规则、width 无操作、无 options 逐字节不变。
- 核心条款（原文摘录，编号=文件行号）：
  1. L73（决策 5 首条）：「值语义子树（valueSchema）与值同 depth 截断；**别名传递闭包随展开层收缩**（只含展开层引用到的别名）；`docs` / `aliasDocs` 注释切片对被裁路径省略（**延伸决定**：超出 spec 字面的合理推论，已回写 tracking issue）」——延伸决定已见于 #331 正文 Implementation Decisions「语义 schema 投影同 depth 裁剪」条（含「别名传递闭包随展开层收缩」）与 CONTEXT「语义 schema 投影」词条。
  2. L74（决策 5 次条）：「**width 对投影无操作**（投影是类型级、路径键控，无实例键——与数据量无关、与类型复杂度相关）」；验收 L125：「仅触发 width 的预算读，其 schema 投影与同路径无预算读的投影逐字节相等」。
  3. L77（截断节点选型，钉死）：「**投影层包装，不扩展 ValueSchema 语义联合**……投影契约（`ReadDataSchemaProjection`，`@nomicore/vfsl` 公共面）的 `valueSchema` 字段类型在预算读下为**投影包装联合**——成员值位可出现截断标记，标记**携带成员级类型线索**（成员的 ref 名优先，无 ref 名时给容器 kind），使消费方在截断处仍可盲拼下一轮路径；无预算读恒为纯 `ValueSchema`，形状零变化。该包装是投影通道自构造的派生形态，不是值域哨兵」。
  4. L79（投影通道公共面，钉死）：「`resolveSchemaAtPath(derived, path, options?)`（`@nomicore/vfsl` 公共 API）——可选、加法、无 options 行为逐字节不变；预算在解析递归内生效，valueSchema 截断、别名闭包收集、docs/aliasDocs 切片三者在同一次遍历内同步收缩。**不采用** namespace-runtime 层对完整投影的事后裁剪……此为 ADR-0016『解析语义』签名条款的显式修订（见修订节）」。
  5. L81（两通道截断位置对齐，契约级承诺；commit `ba11f32` 补入）：「类型树**同构计层**——discriminated union / literal union **透明**（不计层，与 resolver『任一成员出现即存在』的匹配语义一致），**ref 为终态边界**（截断标记落在 ref 处，携带 ref 名）。同一预算下，值截断位置与投影截断标记一一对应——消费方依赖两通道一致，错位即契约违约」——T2 落计层规则，T3（#336）组合时兑现一一对应。
  6. L29（决策 1）：「**不传 options = 完整投影**：逐字节现行为，零截断」；L30：options 封闭形状、非法值新稳定码 `READ_OPTIONS_INVALID`（同步、不抛，**注册于 readData 主接缝层**；ADR 未单独钉死 resolver 层 options 校验通道——设计面待 SA1 收口）。
  7. L100–104（对既有 ADR 的修订·ADR-0016 四处显式登记）：(1) 预算参数不是 schema opt-in、schema 通道仍 always-on；(2) `readLogicalValueAtPath` 三参化（无 options 逐字不变）——T1 面；(3) **`resolveSchemaAtPath(derived, path)` 加法扩展第三参 `options?`，无 options 行为不变（决策 5 选型）**——本票的直接授权条款；(4) Consequences 成本句随投影同 depth 裁剪修订。
  8. L115（备选否决）：「扩展 ValueSchema 语义联合（`kind: 'truncated'` 进 ADR-0003 的 9-kind 冻结面）……采用投影层包装替代（决策 5）」；L116（备选否决）：「namespace-runtime 层事后裁剪投影……采用解析入口三参化替代（决策 5）」——两条钉死本票的实现位置与禁区。
  9. L69（决策 4 破坏面论据）：各影响包已发布但均处 **0.x**，破坏性修订随 minor bump 发布、已知消费方可枚举——公共类型面加宽（投影包装联合）的发布依据。
- 对本任务影响：本票需求与决策 5 逐点对应，无新增决策面；禁区 = 事后裁剪、ValueSchema 扩 kind、值域哨兵。

### ADR-0016 readData 语义 schema 投影（accepted，2026-09-09；被 ADR 0019 §7 与 ADR 0024 修订节条款级修订）

`docs/adr/0016-readdata-semantic-schema-projection.md`

- 与本任务的关联点：`resolveSchemaAtPath` 与 `ReadDataSchemaProjection` 的母法；其签名条款与投影体 valueSchema 字段类型被 ADR 0024 显式修订（修订注册于 ADR 0024 修订节 + 决策 5，非静默矛盾）。
- 核心条款（原文摘录，编号=文件行号）：
  1. L30–39（投影体）：`ReadDataSchemaProjection` 四件套——`valueSchema: ValueSchema`（L32；预算读下按 ADR 0024 L77 加宽为投影包装联合，**无预算读恒纯 ValueSchema**）、`aliases: Record<string, ValueSchema>`（L34，传递闭包，预算下随展开层收缩）、`docs` / `aliasDocs` 切片（L36/L38，键规约 L42 与派生 schema 文档表同构）。
  2. L50–58（解析语义，签名条款）：`resolveSchemaAtPath(derived, path)` 两参签名 + 结果联合 `SCHEMA_PATH_NOT_FOUND` / `SCHEMA_PATH_INVALID` + path 新鲜副本回显——**该签名条款被 ADR 0024 修订节第 3 条加法修订为三参**；其余解析语义条款不在修订清单内、继续有效。
  3. L60–64（解析语义，继续有效）：union 静态 any-member 扩展（「任一成员出现即存在」——计层规则 union 透明的语义根基，ADR 0024 L81 明文挂钩）；解析与实际值无关；keyPattern fail-closed；optional 透明；ref 目标缺失 → `InternalError`（可信域 throw，不进结果联合）。
  4. L65（交付纪律，继续有效）：「解析器纯函数、同步、零 memo、结果联合拒绝——符合 vfsl 包边界」——预算递归不得引入跨调用状态。
  5. L69–70（交付纪律，继续有效）：schema 通道 **always-on**（无 opt-in 开关；ADR 0024 修订节第 1 条重申预算参数 ≠ schema opt-in）；每次读深拷贝投影属 namespace-runtime 组合边界——resolver 返回共享节点、detached 属 T3 组合面。
  6. L74（分层与兼容面）：`@nomicore/doc-runtime` 不动、`readLogicalValueAtPath(doc, path)` 签名与语义不变——被 ADR 0024 修订节第 2 条三参化（T1 面，非本票）；L75：namespace-runtime 组合值 + 投影（T3 面，非本票）。
  7. L100–118（ADR 0019 修订节）：docs 切片三来源合并 `docs[k] = [...fieldDocs[k], ...markerDocs[k], ...memberDocs[k]]`（field → marker → member 末位）、memberDocs 条件稀疏、键规约「四表」同构——预算下**选键集合**收缩（被裁路径省略），**合并纪律与键文法不变**。
- 对本任务影响：本票触及的 0016 条款（签名、投影体 valueSchema 类型）均有 ADR 0024 显式修订授权；未列修订的条款（解析语义行为、纯函数纪律、always-on、结果联合、可信域 throw 通道）全部原样有效。

### ADR-0003 求值器与派生 schema（accepted；冻结面守卫）

`docs/adr/0003-evaluator-derived-schema.md`

- 与本任务的关联点：ValueSchema 语义联合与派生 schema 形状的冻结母法——截断标记的「不得扩 kind」红线来源；ref 按名引用纪律是计层规则「ref 终态边界」的语义根基。
- 核心条款（原文摘录，编号=文件行号）：
  1. L26–27（决策 4）：别名按名引用（`ref` 节点），**不内联展开**——ADR 0024 L81「ref 为终态边界（截断标记落在 ref 处，携带 ref 名）」与之同构：ref 处截断即闭包边界，不因截断引入内联。
  2. L22（决策 3）：union 匹配语义 any-of、路径存在性「任一成员出现即存在」——计层规则「discriminated/literal union 透明」的母法挂钩。
  3. L46（后果）：「派生 schema 的形状变更须走设计修订流程（公共契约）」——本票不得改 ValueSchema/DerivedSchema 形状；投影包装联合在投影契约（`ReadDataSchemaProjection.valueSchema` 字段类型）层构造，不触派生 schema 形状。
- 对本任务影响：本票需求明文「不扩展 ValueSchema 语义联合」，与冻结面兼容；实现不得在 `derived.ts` 的 ValueSchema 9-kind 联合上新增成员。

### ADR-0019 VFSL 联合成员文档注释（accepted；docs 切片第三来源）

`docs/adr/0019-vfsl-union-member-docs.md`

- 与本任务的关联点：T2 收缩 docs/aliasDocs 切片时的合并纪律母法——只收缩选键，不改三源合并序与键文法。
- 核心条款（原文摘录，编号=文件行号）：
  1. L132–137（决策 7，修订 ADR 0016）：「`resolveSchemaAtPath` 的 docs 切片并入 memberDocs 为第三来源：**选键规则不变**……合并内容 `docs[k] = [...fieldDocs[k], ...markerDocs[k], ...memberDocs[k]]`（member 末位）」。
  2. L94–101（决策 5）：derived `memberDocs` 条件稀疏表；ADR 0016 修订节 L106–115（键规约「四表」、memberDocs 缺席即整遍跳过、在场表级畸形 → InternalError）——预算收缩不得破坏缺席兼容（无 M4 派生物逐字节不变）。
- 对本任务影响：切片收缩是选键面变化（ADR 0024 L73 授权），合并纪律、键规约、memberDocs 稀疏兼容为继续有效条款。

### ADR-0008 NamespaceRuntime 读写能力与单序列器（accepted，含多份修订节；读域归属与 D8 封口）

`docs/adr/0008-namespace-runtime-read-write-capabilities-and-sequencer.md`

- 与本任务的关联点：读域归属（预算属 ADR-0008 读域，ADR 0024 决策 6）与 D8 封口（derived 只经投影受控深拷贝进公共面）——T2 在 vfsl 层，不触 runtime 组合（T3 面）。
- 核心条款（原文摘录，编号=文件行号）：
  1. L167–178（ADR 0016 修订节）：readData 成功分支三键形状、D8 封口改写——ADR 0024 决策 4 进一步修订为恒五键（T3 面）。
  2. L20–28（读取能力）：`readLogicalValueAtPath` 载体投影语义——ADR 0024 修订节（L99）将其读语义修订为「预算内投影 + 截断清单」（值通道，T1 面；投影通道由 T2 承接）。
- 对本任务影响：本票不修改 runtime/doc-runtime 任何面；两通道截断位置一一对应（ADR 0024 L81）在 T3 组合时验收，本票须按计层规则交付对齐前提。

### 模块契约 `packages/vfsl/AGENTS.md`

- 「Treat root `CONTEXT.md`, `docs/vfsl/v1-spec.md`, and ADRs 0001/0003/0007/0016 as normative」（清单早于 ADR 0024，0024 为 corpus 内 accepted 决策，同等有效）。
- 「Add public API only through `src/index.ts`」——三参签名与投影包装联合类型的公共面出口纪律（现出口：`packages/vfsl/src/index.ts` L125–126）。
- 「Public malformed-input paths return discriminated results rather than throwing」+ resolveSchemaAtPath 可信域例外（malformed derived → `InternalError`；keyPattern 引擎四类错误 → fail-closed `SCHEMA_PATH_NOT_FOUND`）——options 属调用方敌意通道，其校验失败通道须走判别联合而非 throw（ADR 0024 未钉死 resolver 层具体码位，属设计收口点）。
- 「Keep parser, evaluator, and validators synchronous and deterministic」「Stable error codes, issue ordering, path reporting… are compatibility behavior」——预算递归不得引入异步/跨调用缓存/失败码语义漂移。

### 清点后判定不相关的 ADR（无本票条款面）

0001（VFSL 单一真相源——语言层，本票不改语言）、0002（重写范围外）、0004/0005（codegen 类型投影与生成管线——经 grep 核对无 readData/resolveSchemaAtPath 条款面；DeepOptional 属 T4）、0006（持久化）、0007（逻辑校验与运行时桥——resolver 沿其可信域先例，无修订需求）、0009（Registry/lease——透传属 T3）、0010/0012/0013/0018/0022（复制与分块传输）、0011/0014（诊断日志）、0017（schema 生命周期元数据）。

## 现状事实（源码确认，不构成决策依据）

- `packages/vfsl/src/resolve-schema-at-path.ts` L92–95：现签名两参（ADR 0016 形态）；L49–61 `ReadDataSchemaProjection.valueSchema: ValueSchema`；L380+ 别名闭包全量收集；L434+ docs/aliasDocs 切片全量选键——均无预算路径，T2 从零落。
- `packages/doc-runtime` 无 options 参数（T1 未落地）；namespace-runtime readData 仍三键形态（T3 未落地）——ticket 谱系按序推进，T2 自身独立可交付（vfsl 单元面）。
- `packages/namespace-registry/test/readdata-docs-adr0016-contract-fixture.ts` L30/L110：`readDataOptionUsages` 只匹配 `readData(` 带参用法、只扫三份作用域文档（typed-access skill + docs/integration×2）——不覆盖 `resolveSchemaAtPath`，T2 测试/注释不触该负控；正则修订（只禁 schema opt-in、放行预算）属 T5（#338）面。
- CONTEXT.md L41–55：「语义 schema 投影」（含预算裁剪段）、「形状预算」、「截断省略」、「截断清单」词条已随 ADR 0024 基线落词汇。
