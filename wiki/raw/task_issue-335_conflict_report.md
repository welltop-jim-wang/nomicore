# 冲突报告（Conflict Report）— Issue #335 前置门禁

> SA8 产出。只裁决冲突，不评设计优劣、不判实现质量、不做设计。基准 = ADR 全集 + CONTEXT.md（+ 模块 AGENTS 明文收录的决策）；源码仅作现状确认。

## 1. Reviewed subject

**task**（前置门禁）——Issue #335「[shape-budget] T2: 投影通道形状预算——解析入口三参化与截断标记」需求与验收标准 vs 决策集。无 Issue comments（REST 读取为空）。

## 2. Inputs and decision set

- 输入：`wiki/raw/task_issue-335.md`（简报）+ Issue #335 正文（同源）；Parent PR #332（`adr-0024-readdata-shape-budget`，open，其 ADR 0024 提交已在本 worktree 支上）。
- 决策集：`docs/adr/` 全集 24 文件（0001–0024）全读清点；细读 0003 / 0008 / 0016 / 0019 / 0024；根 `CONTEXT.md` 全读（L41–55 预算词汇已落）；`packages/vfsl/AGENTS.md` 模块契约；`docs/vfsl/v1-spec.md` 无 resolver 条款面（grep 核对）。被 superseded 者无（全部 accepted；条款级修订关系见 §4）。
- 现状确认：`packages/vfsl/src/resolve-schema-at-path.ts` 为两参签名、投影体 `valueSchema: ValueSchema`、闭包/切片全量收集；vfsl 无任何预算代码（parser 的 `depth` 为嵌套深度上限，无关）。doc-runtime/namespace-runtime 均未落预算（T1/T3 未落地，谱系见 relevant_decisions）。
- 详尽摘录：`wiki/raw/task_issue-335_relevant_decisions.md`。

## 3. Decision analysis

| # | Decision | Clause | Subject behavior | Classification | Evidence | Required action |
|---|---|---|---|---|---|---|
| 1 | ADR-0024 | 决策 5「投影通道公共面（钉死）」L79；备选否决 L116 | 解析入口加法三参化 `resolveSchemaAtPath(derived, path, options?)`，预算在解析递归内生效，valueSchema 截断/别名闭包/注释切片同遍历收缩；不做 namespace-runtime 事后裁剪 | **implements-existing-decision** | `docs/adr/0024-readdata-shape-budget.md` L79、L116 | 按钉死选型实现；禁止在 namespace-runtime 层做事后投影裁剪（该层组合属 T3） |
| 2 | ADR-0024 | 决策 5「截断节点选型（钉死）」L77；备选否决 L115 | 截断处放投影层截断标记：投影包装联合，不扩展 ValueSchema 语义联合；标记携带成员级类型线索（ref 名优先，无 ref 名时容器 kind） | **implements-existing-decision** | 0024 L77、L115；CONTEXT.md L42 | 包装联合落 `ReadDataSchemaProjection.valueSchema` 字段类型位；标记节点为投影通道自构造派生形态，非值域哨兵 |
| 3 | ADR-0003 | 决策 4 L26–27；后果 L46（「派生 schema 的形状变更须走设计修订流程」） | 需求明文不扩展 ValueSchema 语义联合——ValueSchema 9-kind 冻结面与 DerivedSchema 形状零改动 | **no-conflict** | `docs/adr/0003-evaluator-derived-schema.md` L26–27、L46；0024 L115 | 实现不得在 `derived.ts` 的 ValueSchema 联合新增 kind 或改派生 schema 形状（实现期核对项） |
| 4 | ADR-0024 | 决策 5 首条 L73（延伸决定已回写 #331 正文与 CONTEXT L42） | valueSchema 与值同 depth 截断；别名传递闭包随展开层收缩；被裁路径 docs/aliasDocs 切片省略 | **implements-existing-decision** | 0024 L73；CONTEXT.md L42；#331 正文 Implementation Decisions | 闭包只含展开层引用到的别名；「先裁后收集」顺序（0024 L116 否决事后裁剪的理由） |
| 5 | ADR-0016（+ADR-0019 §7 修订） | 投影体 L30–39、L42；ADR 0019 修订节 L106–115 | 投影体仍四件套；切片收缩只动**选键集合**，三源合并序（field→marker→member）与键文法同构纪律不动 | **no-conflict**（既有条款在预算下的收缩由 0024 L73 授权，合并纪律未被修订） | `docs/adr/0016-...md` L30–42；`docs/adr/0019-...md` L132–137 | 不发明新键、不改合并序；memberDocs 条件稀疏兼容（无 M4 派生物逐字节不变）保持 |
| 6 | ADR-0016 | 「解析语义」签名条款 L50–58——被 ADR-0024 修订节第 3 条（L103）显式加法修订 | 三参化需求与 0016 原两参签名的表面张力由 0024 合法解除；修订授权链在 corpus 内（非静默矛盾） | **implements-existing-decision**（0016 签名条款经 0024 显式修订；其余解析语义条款不在修订清单，继续有效） | 0016 L50–58；0024 L100–104（第 3 条） | 无 options 时签名与行为逐字节不变；union any-member、值无关解析、keyPattern fail-closed、optional 透明、ref 缺失 InternalError 全部原样 |
| 7 | ADR-0016 | 投影体 `valueSchema: ValueSchema` 字段类型 L32——预算读下加宽为投影包装联合 | AC「投影包装类型进入投影契约公共面」：字段类型在预算读下为包装联合，无预算读恒纯 ValueSchema、形状零变化 | **implements-existing-decision**（0024 决策 5 L77 明文落地条款） | 0016 L30–32；0024 L77、L69（0.x minor bump 破坏面论据） | 包装类型经 `packages/vfsl/src/index.ts` 出口（模块契约）；无预算读形状零变化锚入回归 |
| 8 | ADR-0024 | 决策 5「两通道截断位置对齐（计层规则，契约级承诺）」L81（commit `ba11f32`） | 计层规则：discriminated/literal union 透明（不计层）、ref 为终态边界（标记落 ref 处、携带 ref 名）——与 ADR-0003 §3 any-of「任一成员出现即存在」与 §4 ref 按名不内联同构 | **implements-existing-decision**（对 0003 为 no-conflict：计层规则复用其语义，不改其条款） | 0024 L81；0003 L22、L26–27 | T2 按规则交付对齐前提；值↔投影截断位置一一对应的组合验收属 T3（#336），错位即契约违约 |
| 9 | ADR-0024 | 决策 5 次条 L74；验收 L125 | width 对投影无操作；仅触发 width 的预算读，投影与无预算读逐字节相等 | **implements-existing-decision** | 0024 L74、L125 | width 参数在解析递归内对投影通道零作用（不进投影裁剪判定） |
| 10 | ADR-0024 | 决策 1 L29「不传 options = 完整投影：逐字节现行为，零截断」；修订节第 2/3 条 | 无 options 时行为逐字节不变（AC 回归锚） | **implements-existing-decision** | 0024 L29、L101–103 | 全量投影路径保持单源现状；逐字节回归锚全绿为验收门 |
| 11 | ADR-0016 + `packages/vfsl/AGENTS.md` | 交付纪律 L65（纯函数、同步、零 memo、结果联合拒绝）、L69（always-on）；模块契约「公共 API 只经 src/index.ts」「malformed 公共入参走判别联合而非 throw」「稳定码兼容行为」 | 三参化与包装联合为加法公共面扩展；不引入 schema opt-in、不引入跨调用缓存、不动 SCHEMA_PATH_* 码与 InternalError 通道 | **no-conflict**（需求未触及；附一个未钉死设计点，见 §8 第 3 条） | 0016 L65、L69；`packages/vfsl/AGENTS.md` Contract/Boundaries 节 | options 属调用方敌意通道，其校验失败通道必须判别联合形态；`READ_OPTIONS_INVALID` 在 0024 决策 1 注册于 readData 主接缝层，resolver 层码位未钉死——SA1 设计收口，不得违反模块契约 throw 纪律 |

裁决分布：no-conflict 3 项（#3、#5、#11）；implements-existing-decision 8 项（#1、#2、#4、#6、#7、#8、#9、#10）；evolution-required 0 项；hard-conflict 0 项。

## 4. Overrides

| Old decision | Override authority | Scope | New obligation |
|---|---|---|---|
| ADR-0016「解析语义」`resolveSchemaAtPath(derived, path)` 两参签名条款（L50–58） | ADR-0024（accepted，2026-09-12，corpus 内）修订节第 3 条 + 决策 5 | 加法第三参 `options?`；预算在解析递归内生效；闭包/切片同遍历收缩 | 无 options 签名与行为逐字节不变；截断标记/计层规则按 0024 决策 5 |
| ADR-0016「投影体」`valueSchema: ValueSchema` 字段类型（L32） | ADR-0024 决策 5「截断节点选型」段（L77，钉死） | `valueSchema` 字段类型在**预算读下**为投影包装联合；无预算读恒纯 ValueSchema | 包装类型进 `@nomicore/vfsl` 公共面（经 src/index.ts）；标记携带 ref 名/容器 kind |
| （边界注记）ADR-0016「分层与兼容面」`readLogicalValueAtPath(doc, path)`（L74） | ADR-0024 修订节第 2 条（L102） | 三参化 | **非本票面**——T1（#334）承接；T2 不得越界改 doc-runtime |

Owner 评论 override：无需（无既有决策被违反；上述均为新 ADR 显式修订路径）。SA8 不替 Owner 或 SA1 创建新 override。

## 5. Frozen surfaces

| Surface | Must remain unchanged | Evidence | Actual result |
|---|---|---|---|
| ValueSchema 9-kind 语义联合（含 DerivedSchema 形状、evaluate 接缝） | 无新 kind（如 `kind:'truncated'`）、派生 schema 形状零改动 | ADR-0003 L46；0024 L115；CONTEXT L42 | 需求明文排除扩展——一致（实现期核对） |
| `resolveSchemaAtPath` 失败面：`SCHEMA_PATH_NOT_FOUND` / `SCHEMA_PATH_INVALID` + path 新鲜副本回显；可信域 `InternalError` throw 清单 | 码位、语义、path 回显、throw/联合通道划分不变 | ADR-0016 L56–58、L64；vfsl AGENTS「Stable error codes…compatibility behavior」 | 需求未触及——一致（options 校验通道待 SA1 钉死，须走判别联合） |
| `ReadDataSchemaProjection` 四键（valueSchema/aliases/docs/aliasDocs）与键规约同构 | 键集不变；docs/aliasDocs 键文法、三源合并序不变；valueSchema 仅预算读下类型加宽 | ADR-0016 L30–42；ADR-0019 L132–137；0024 L77 | 需求为字段内类型加宽——一致 |
| 无 options 输出逐字节恒等 | options 缺席时投影输出与现行为逐字节相同 | 0024 L29、L79、L103 | AC 自带回归锚——一致 |
| schema 通道 always-on（无 schema opt-in） | 预算参数不得成为 schema 有无开关 | ADR-0016 L69；0024 修订节第 1 条（L101） | 需求未触及——一致 |
| 解析器纯函数/同步/零 memo | 无跨调用状态、无异步 | ADR-0016 L65；vfsl AGENTS「synchronous and deterministic」 | 需求未触及——一致 |
| readData 文档负控（`readDataOptionUsages` 只匹配 `readData(` 带参用法、只扫 typed-access + docs/integration×2） | T2 不触该负控；正则修订属 T5（#338） | `packages/namespace-registry/test/readdata-docs-adr0016-contract-fixture.ts` L30、L110；0024 L105 | 已核匹配器不覆盖 `resolveSchemaAtPath`——一致 |
| doc-runtime / namespace-runtime / registry 公共面 | 本票（vfsl 单元面）零改动 | ADR-0016 L74–76；0024 决策 6/修订节第 2 条 | 需求限定解析入口——一致 |

## 6. Evolution requirements

无新增 evolution-required 项。本票所需的决策演进（ADR-0008 读语义、ADR-0016 四处条款、CONTEXT 词汇、文档负控预告）已由 ADR 0024 及其基线提交（`50d52a1`/`7679c57`/`ba11f32`，PR #332 支）在同一变更集内完成——修订文件（ADR 0024 + CONTEXT.md L41–55）、新旧语义（修订节逐条登记）、失败语义（决策 1/3）、验证（验收节）、不变冻结面（备选否决节）齐备；残余文档负控/形状注记同步已开票 T5（#338）承接。

语料导航性注记（非冲突、非本票义务）：ADR 0016 自身文本尚未回填「ADR 0024 修订」批注节——repo 先例（ADR 0008 的多份修订节、ADR 0016 自身的 ADR 0019 修订节）是回填式；但 ADR 0024 修订节已「四处显式登记，不静默矛盾」，修订权威链在 corpus 内完整，docs/AGENTS「显式修订、不静默矛盾」义务已满足。建议随 PR #332 / T5 文档同步面补回填批注，便于按 ADR 0016 文本直读的消费方发现修订；不构成本票阻塞。

## 7. Hard conflicts

无。

## 8. Required actions

1. **按 ADR 0024 决策 5 钉死选型实现**：预算在解析递归内生效（先裁后收集，单遍历收缩三件事）；禁止 namespace-runtime 层事后裁剪路径；禁止值域哨兵与 ValueSchema 扩 kind。
2. **公共面出口纪律**：三参签名与投影包装联合类型只经 `packages/vfsl/src/index.ts` 导出（`packages/vfsl/AGENTS.md`）。
3. **SA1 设计收口点（未钉死，非冲突）**：resolver 层 `options` 校验的失败通道与码位——ADR 0024 只在 readData 主接缝注册 `READ_OPTIONS_INVALID`（决策 1 L30），resolver 结果联合现仅两码（ADR 0016 L56–58）；设计须在 vfsl 模块契约「malformed 公共入参走判别联合而非 throw」纪律内钉死，且无 options 路径零开销零语义变化。
4. **回归锚**：无 options 逐字节恒等 + 仅 width 触发时投影与无预算读逐字节相等（0024 验收 L122/L125）。
5. **越界禁令**：不动 doc-runtime / namespace-runtime / registry 公共面（T1/T3 面）；不动 readData 文档负控正则（T5 面）。
6. （阶段级建议，非本票）随 PR #332/T5 为 ADR 0016 回填 ADR 0024 修订批注节（§6 注记）。

## 9. Verdict

**clear** —— 11 项对照全部为 no-conflict（3）或 implements-existing-decision（8）；无需新的决策演进；被修订的 ADR 0016 条款均有 corpus 内合法 override 链（ADR 0024 accepted）。总控可继续派发 SA1。

## 10. requiresConflictRecheck

**true** —— 理由：(a) 公共 API/类型面变更（`resolveSchemaAtPath` 签名 + `ReadDataSchemaProjection.valueSchema` 包装联合 + resolver 结果联合在 options 通道上的扩展）尚待 SA1 设计与实现核对；(b) §4 两项正式 override 的落地（无 options 逐字节恒等、无预算读恒纯 ValueSchema、不扩大 override 范围）须在设计后复审与实现复审逐项核对；(c) 计层规则与值通道的一一对应承诺跨 T1/T2/T3，实现期需核对未漂移。
