# 冲突门禁报告（设计后复审）— Issue #274 文档同步：typed-access 与 docs/integration 覆盖 readData 语义 schema 投影（ADR 0016）

## 1. Reviewed subject

- 被审对象：**design** — SA1 设计 `wiki/raw/task_issue-274_design.md`（iteration 1 前、256 行；目标/非目标、D1–D7 决策、§6–§8 措辞级方案、§10 文件范围、§12 验收映射、§15 自报复查）
- 复审触发：设计 §15 自报 `requiresConflictRecheck = true`，范围自述收窄为「§6/§7/§8 建议措辞逐句对照 ADR 0016 决策节；确认无 opt-in 暗示、无 null 误读、无对 ADR 0008 D8 封口修订节的回退表述」；本复审全量过设计，并以**建议文档断言的加法兼容性**（dispatch 指定焦点）深审
- 阶段：设计后冲突复审（SA1 之后、实现之前）；`wiki/raw/task_issue-274_sa2_review.md` 不存在（实测 glob）——无 SA2 评审输入可并入
- Worktree：`/home/wangjian/nomicore-fix-issue-274`（branch `mabf/issue-274`，HEAD `6ab8c87`；`git status` 仅 SA6 契约 3 文件 + 任务快照 4 文件未跟踪，生产实现与作用域文档零改动——实测）
- 裁决人：SA8 Conflict Gatekeeper（mabf-sa8，dispatch `sa-8b538a5d-0cc2-40d1-9f5c-bdc92862d08e`，iteration 1）
- 技能说明：`sa8-conflict-gate` 技能在本会话技能目录中不存在（实测 skill 加载失败）；本报告按系统角色定义（冲突基准 = ADR 全集 + CONTEXT.md；只读；唯一产物 = 本报告）与仓库先例格式（`task_issue-273_design_conflict_report.md`）执行

## 2. Inputs and decision set

- 冲突基准（逐个核读）：`docs/adr/` 全集 **14 文件**（0001–0012、0014、0016；0013/0015 不存在——实测 glob）+ 根 `CONTEXT.md`。**无任何 ADR 被 superseded 于本案辖域**：ADR 0016 状态「已接受」，其「取代关系」仅修订 ADR 0008 D8 封口句；全仓 grep 无推翻/取代 0016 的决策文本
- readData 语义发言者唯一性复核：全仓 md 中 `readData(` 消费/陈述面 = typed-access.md L43、replication skill L90、根 AGENTS.md L31、CONTEXT.md L34/L38、docs/integration 恰两文件四处（cordis L340/L360、external L253/L349）、ADR 0008 L14、ADR 0016（grep 实测）——**规范发言者仅 ADR 0008 + ADR 0016**，无第三个决策文本
- 规范面锚点（亲读核验）：ADR 0016 L19（三键形状）、L22（null 三情形单义 + ok 恒真）、L30–39（投影体四键）、L42（键规约同构）、L69–70（always-on / detached 深拷贝零缓存）、L77（typed-access 与 codegen 加法兼容）、L81（opt-in 备选明文拒绝）；ADR 0008 修订节（L166–178：D8 封口改写、成功分支形状演进、「原规则保持」）；CONTEXT.md「Data」L33–35 与「语义 schema 投影（semantic schema projection）」L37–39（含 _Avoid_ 三条）
- 行为面事实核验（非独立基准、用于证实文档断言不虚构）：`packages/namespace-runtime/src/runtime.ts` L123–127（`NamespaceRuntimeReadDataResult` 成功分支恰 `{ ok: true; value: unknown; schema: ReadDataSchemaProjection | null }`）；`packages/vfsl/src/index.ts` L126（`ReadDataSchemaProjection` 公开导出）
- 对照输入：任务简报 `wiki/raw/task_issue-274.md`（What to build 六要点 + AC1–AC3）；**上游验收契约** `wiki/raw/task_issue-274_sa6_contract.md`（approve；R1–R7 红契约 + 21 负控 + 匹配器夹具）；dispatch `wiki/raw/task_274_dispatch.md`；上游链 #273 设计后复审 `task_issue-273_design_conflict_report.md`（clear 先例：行为面形状/null 语义/深拷贝已裁定无冲突）
- Issue comments：REST 双通道实测 `[]`（`gh issue view --json comments` = 0；`gh api …/issues/274/comments` = 0）——**无 owner 要求需并入、无 override 声明在案**（与 dispatch/简报/SA6 §2 三处同口径）
- 契约可执行性基线复跑（本会话实测）：红契约 `readdata-docs-adr0016-sync-red.test.ts` **7/7 红** + 负控 `…-sync-control.test.ts` **21/21 绿**（含行为锚：cordis 示例真实装配实测 `readData(['title'])` 键集恰 `['ok','schema','value']`、schema 非 null 且 own keys 恰四键）——设计 §2/§3 的证据锚与红灯原因陈述属实
- 全仓过时注记扫描复跑（本会话实测）：`grep -rEn "// *\{ *ok *: *true" --include="*.md"`（排除 wiki/raw）恰两命中 = cordis L341（矛盾站点）+ ADR 0016 自身 L55（`// { ok: true, ...projection }`，不在契约扫描作用域）——设计 §2 行 6 的「全仓唯一」陈述属实
- typed-access 现状复核（实测）：`投影|valueSchema|aliasDocs|0016` 0 命中、`null` 0 命中——「零覆盖」缺口陈述属实；插入点 L106（「Also inspect `--listFilesOnly` …」）/ L108（`## Mutation policy`）实测在位；doc 内容敏感测试全仓恰 SA6 三文件（grep 实测），无第四个消费这些文档的测试面

## 3. Decision analysis

### 3.1 焦点：建议文档断言的加法兼容性（§6/§7/§8 措辞逐句对照 ADR 0016）

**设计行为**：§6 typed-access 新增「Read result: value plus semantic schema projection」五段小节；§7 cordis L340–341 注记替换为三键形状 + 两行 null 判读说明；§8（可选）external §5 一句加法说明；D6（可选）item 6 子弹追加交叉指针。逐断言裁决：

| # | 建议文档断言（设计措辞） | 决策条款 | Classification | Evidence | Required action |
|---|---|---|---|---|---|
| A1 | 「Every successful `readData(path)` returns `{ ok: true, value, schema }`」（§6 段 1） | ADR 0016 L19 + ADR 0008 修订节第 2 条 | **implements-existing-decision** | 与 runtime.ts L123–127 逐字同形；「successful」限定准确——失败分支（PATH_NOT_ALLOWED / RUNTIME_READ_DISABLED / released）未被触碰或误述 | 无 |
| A2 | 四键 bullet：valueSchema（refs kept by name, not inlined）/ aliases（transitive closure, self-contained, recursion-safe）/ docs+aliasDocs（relevant slices）（§6 段 2） | ADR 0016 L30–39 + ADR 0003 §4（ref 按名保留纪律）+ CONTEXT「派生 schema」词条 L63–64 | **implements-existing-decision** | 三条 bullet 与 ADR 投影体接口注释逐义对应；「refs by name」与 ADR 0003 §4 同款纪律（#273 复审行 9 已裁 ADR 0003 辖域 no-conflict，本票文档措辞不引入新表述面） | 无 |
| A3 | 「keys of `docs`/`aliasDocs` are isomorphic to the derived schema documentation tables: absolute syntax paths plus `'<item>'/'<key>'/'<member N>'` synthetic segments, alias-internal docs anchored by alias name」（§6 段 3） | ADR 0016 L42 | **implements-existing-decision** | 与 L42「§3 绝对语法路径 + `'<item>'/'<key>'/'<member N>'` 合成段文法，别名以别名名锚定」逐义互译；无新结构发明（Issue What-to-build ② 的键规约要求闭合） | 无 |
| A4 | 「`schema` is `null` when there is no active schema, the path strays outside the schema, or static resolution fails. A null schema is not a read failure: `ok` stays true. … not as an error.」（§6 段 4） | ADR 0016 L22（三情形穷尽枚举 + 单义 + ok 恒真）+ CONTEXT L38 | **implements-existing-decision** | 三情形枚举穷尽且**不区分缺席原因**（无 `schemaIssue` 子通道暗示——被否备选 L87 未被采纳）；「strays outside the schema」忠实覆盖 raw 复制例外（null 情形②，事实源 ADR 0010 明示例外）；无「null 为错误」误读 | 无 |
| A5 | 「Every read returns a detached deep copy; do not cache or share projections across reads.」（§6 段 4 末） | ADR 0016 L70（每次读深拷贝、detached、零缓存、不冻结）+ CONTEXT _Avoid_ L39 | **implements-existing-decision** | 消费方告诫形态的交付纪律转述；SA6 §15.4 显式将该告诫列为允许的可选增值；与 CONTEXT _Avoid_「把投影当作 live derived schema 的共享引用」同向 | 无 |
| A6 | 「use the schema projection … construct a legal `mutateData()` mutation (minimal, mergeable, semantic)」（§6 段 5） | ADR 0016 L8（读后修改凭同一份 schema 构造合法 mutation 的动机）+ Issue What-to-build ④ | **no-conflict** | 消费场景为 ADR 动机原文；括注三词复用 typed-access 既有 Mutation policy 标题词汇（L108），无新术语 | 无 |
| A7 | 「Static `PathAt` / `PathPatchValue` types remain the compile-time authority; the runtime projection serves dynamically read values and agent-style consumers」（§6 段 5 末） | ADR 0016 L77（typed-access 投影与 codegen 加法兼容）+ ADR 0004/0005（静态投影生成权威）+ 根 AGENTS.md typed-access 纪律（typed reads 用生成类型 / 动态读面留给有意处理运行时形状的调用方） | **no-conflict** | 编译期权威归属陈述与 AGENTS.md 纪律同向；未把运行时投影抬升为类型替代品（不与 ADR 0005 投影管线的 SSOT 纪律相抵） | 无 |
| A8 | 英文规范词形「semantic schema projection」/「A null schema is not a read failure」（D2） | CONTEXT L37 词条名（semantic schema projection）+ SA6 §15.2（匹配器双语兼容、英文规范词形显式放行） | **no-conflict** | 前者取自 CONTEXT 词条名原文；后者为 ADR 0016 L22/CONTEXT L38 规范判读语的英译，SA6 契约 §15.2 已点名该英文句形为合法锚——非发明新术语（docs/AGENTS 词汇纪律满足） | 无 |
| A9 | §6 结构机制：四键 bullet 列表项间不插空行（R3 锚同块）、`{ ok: true, value, schema }` 行内代码不以 `//` 开头、全节仅 `readData(path)` 单参形式 | 夹具 `readdata-docs-adr0016-contract-fixture.ts` L51–107（段切分 `\n\s*\n`、`staleAnnotationViolations` 行级 `//\s*\{\s*ok\s*:\s*true` 且无 `\bschema\b`、`readDataOptionUsages` 行级 `readData\s*\([^)]*,`） | **no-conflict** | 逐 matcher 核验：bullet 块含 valueSchema+aliasDocs 同块 ✓；行内代码无 `//` 前缀 ✓；`readData(path)`/`readData()` 无逗号第二实参 ✓——**无 opt-in 暗示**（ADR 0016 L69 always-on + L81 备选否决的文档面保持） | 无 |
| A10 | §7 注记 `// { ok: true, value: 'first', schema: { valueSchema, aliases, docs, aliasDocs } }` + 两行中文说明（三键恰形 / null 判读 / ADR 0016 指向） | ADR 0016 L19/L22/L30–39 + 行为锚（负控 21/21 之行为锚实测） | **implements-existing-decision** | 注记含 `schema` → 不触发 `staleAnnotationViolations`（R7 转绿路径实测可行）；四键示意与行为锚实测 own keys 恰四键、非 null **精确一致，非虚构**（docs/AGENTS「documentation-only 改动不得发明实现行为」满足）；两行说明无 `// { ok: true` 模式、无 `readData(…,…)` 带参形——负控不误触 | 无 |
| A11 | §7 保持 L360 `readData(['count'])` 无注记不动；cordis 示例代码本体（L340 调用）不变 | Issue「现有示例保持加法兼容」+ ADR 0016 L92（toMatchObject 加法兼容先例） | **no-conflict** | 示例行为零变化，仅注记由矛盾陈述修正为真实形状——修正本身是 AC2/R7 明令（现状注记与 ADR 0016 L19 + 运行时事实**矛盾**，grep 实测全仓唯一站点）；消费 `.ok`/`.value` 的读者不受影响 | 无 |
| A12 | §8（可选）「适配器刻意只收窄到 `.value`；需要随读语义的宿主可在同一适配器中同时暴露 `result.schema`，这是加法兼容的演进，不改变本页示例」 | ADR 0016 L77（「adapter 可忽略新字段，亦可在其后消费」）+ Issue「现有示例保持加法兼容」 | **implements-existing-decision** | ADR 0016 加法兼容条款的逐义转述；external §5/§6 示例代码零改动（DENY 于设计 §8 自述）；缺省省略亦不破契约（§12 标注，实测红/绿判定不依赖该文件新增内容） | 无 |
| A13 | §8 链接 `[ADR-0016](../adr/0016-readdata-semantic-schema-projection.md)`、§6 链接 `[ADR 0016](../../../docs/adr/0016-…md)` | docs/AGENTS「Link to the authoritative source instead of copying」 | **no-conflict** | 两相对路径解析均实测可达（`docs/integration/` 同目录先例 `[ADR-0006](../adr/0006-…)` 于 cordis L3/L159 在案；`.agents/skills/nomicore/` 上溯三级至仓根正确）；以链接挂接而非复制规则——满足 docs/AGENTS 编辑纪律 | 无 |
| A14 | D6（可选）item 6 子弹追加「(a successful read returns `{ ok, value, schema }` — see …)」 | 负控「typed-access 核心内容保持」+ 夹具 matcher | **no-conflict** | 行内 `{ ok, value, schema }` 无 `//` 前缀、无 `ok:` 注记模式 → 不触 `staleAnnotationViolations`；锚 slug `#read-result-value-plus-semantic-schema-projection` 与建议标题 GitHub slug 一致（实测推导）；bullet 原文保留追加，`VfslPathMap`/`--check` 核心内容不受触碰 | 无 |

**焦点总裁决：no-conflict（含 implements-existing-decision 成分 A1/A2/A3/A4/A5/A10/A12）。** 设计自报的三个复查疑点逐项闭合：**无 opt-in 暗示**（A9：全作用域建议措辞仅单参 `readData(path)` 形式，与 ADR 0016 L69 always-on、L81 备选否决一致）；**无 null 误读**（A4：三情形穷尽、单义、ok 恒真、「not as an error」，与 ADR 0016 L22 逐义一致）；**无 ADR 0008 D8 修订节回退表述**（A1/A7：不重述旧两键形状、不把 derived 投影说成 live 引用出站——D8 修订后的「derived 只经受控只读深拷贝进公共面」语义恰为 A5 深拷贝告诫所复述）。

### 3.2 其余设计决策与范围全量对照

| # | Design | Clause | Classification | Evidence | Required action |
|---|---|---|---|---|---|
| 1 | D1 落点：独立 `##` 小节插于 L106/L108 之间；否决「Completion gate 新条款」 | docs/AGENTS「documentation-only wording changes must not invent implementation behavior」+ 设计非目标 3 | **no-conflict** | 不给宿主发明 schema 投影验证义务；插入点实测在位；新标题与既有 8 个标题无 slug 冲突（实测 heading 清单） | 无 |
| 2 | D3 cordis 注记修法（替换 + 两行说明）；否决「仅删除注记」 | AC2 + R7（SA6 §15.3 修法自由度三选一） | **no-conflict** | 「含 schema 三键注记」在 SA6 显式留白内；保留形状信息与同页 L320–321「说明 + 精确注记」风格一致 | 无 |
| 3 | D4 external 单句增补为可选推荐 | Issue 范围（docs/integration 下消费 readData 的相关文档——external L253/L349 消费 readData，实测在范围内）+ SA6 §10（可选面） | **no-conflict** | 范围内可选项，非越界；示例代码不动 | 无 |
| 4 | D5 作用域外文档零改动（根 AGENTS.md、replication.md L90 等） | Issue 范围限定 | **no-conflict** | 实测复核：根 AGENTS.md L31 与 replication.md L90 均无形状断言、与 ADR 0016 加法兼容——不改不构成矛盾残留（全仓过时注记扫描仅 cordis L341 一处，实测） | 无 |
| 5 | §10 ALLOW LIST 恰三消费文档 + 设计产物自身；DENY LIST 冻结规范面/行为面/SA6 契约 3 文件 | Issue What-to-build ⑤ + docs/AGENTS「文档向决策对齐」+ 验收契约冻结纪律 | **implements-existing-decision** | 文件范围 ⊆ Issue 范围；本票零代码/零规范修订义务的定位与 #273 终态一致；SA6 契约文件未被触碰（git status 实测仍 untracked 原样） | 无 |
| 6 | 不新增域词、不改 CONTEXT | docs/AGENTS「update CONTEXT.md when introducing or changing a domain term」 | **no-conflict** | 全部措辞取既有词条/ADR 词形（A8）；无新术语引入义务触发 | 无 |
| 7 | §12 验收映射：红→绿 + 负控保持 + AC3 双绿 + 链接检查 + `git diff --check` | Issue AC1–AC3 + docs/AGENTS 验证面 | **implements-existing-decision** | 红契约命令本会话复跑属实（7/7 红、21/21 绿）；文档不进 tsc Program，AC3 仅终态门；docs/AGENTS 三项验证义务（链接/陈旧术语/空白）全部入表 | 无 |
| 8 | §13 风险表（内容锚为最低门、语义漂移由 SA2/SA4 兜底） | SA6 §15.1（内容锚非充分门） | **no-conflict** | 设计不把词形锚当语义充分条件；语义保真由本报告焦点表 A1–A14 逐句背书 | 无 |
| 9 | ADR-0001/0002/0004/0005/0006/0007/0009/0010/0011/0012/0014 辖域 | 各 ADR 正文 | **no-conflict** | 设计零触及（SSOT/authority/codegen/持久化/lease/raw 复制例外/诊断/实例身份/日志格式）；文档票不改任何行为面；readData 语义规范发言者仅 0008+0016（grep 实测） | 无 |
| 10 | §9 无运行时接口/状态机/数据流变化 | ADR 0008 读面冻结 + #273 已交付终态 | **no-conflict** | ALLOW LIST 全为 `.md`（实测）；行为契约 21/21、registry 面绿在 HEAD（本会话控制文件复跑佐证） | 无 |

## 4. Overrides

| Old decision | Override authority | Scope | New obligation |
|---|---|---|---|
| — | — | — | — |

无 override 声明、无 override 需求：设计的立场是**文档向既有决策对齐**（非目标 2 明示「不改规范面：文档向其对齐，不反向修订」）；Issue comments 为空（REST 双通道实测 0 条），无 Owner 覆盖权威可来源；无新 ADR/协议版本。cordis L341 注记替换是对**已被 ADR 0016 修订掉的旧事实陈述**的同步，属 docs/AGENTS「code behavior changes 时同步规范文档」义务的兑现，非决策覆盖。

## 5. Frozen surfaces

| Surface | Must remain unchanged | Evidence | Actual result |
|---|---|---|---|
| 规范面 | ADR 0016 / ADR 0008 / CONTEXT.md 全文 | 设计 §10 DENY + 本票定位 | 设计零触碰（git status 实测）——**通过** |
| SA6 验收契约 | 红/控/夹具三文件 | 设计 §10 DENY（SA6 冻结产物） | 未被修改（untracked 原样）——**通过** |
| 行为面 | `packages/**`、`apps/**`、`domains/**`、测试代码 | Issue AC3 仅终态门；#273/#272 已交付 | 设计 ALLOW LIST 全为 `.md`——**通过** |
| 既有示例代码 | cordis L340/L360 调用行、external §5/§6 示例 | Issue「现有示例保持加法兼容」+ ADR 0016 L77 | §7 只换注记行 + 加说明注释；L360 不动；external 示例零改动——**通过** |
| out-of-scope 文档 | 根 AGENTS.md、replication.md、其余 skill/integration 文档 | Issue 范围 + D5 | 零改动（DENY LIST）——**通过** |
| 读结果契约语义 | 三键形状 / null 三情形单义 / always-on / detached 深拷贝 | ADR 0016 L19/L22/L69–70 | 建议措辞逐句同义复述（焦点表 A1/A4/A5/A9）——**通过** |

## 6. Evolution requirements

**无 evolution-required 项。**

- 设计不修订任何决策文本：全部建议措辞是 ADR 0016 + ADR 0008 修订节 + CONTEXT 词条的**消费文档转述**（焦点表 7 行 implements-existing-decision 均为「既有决策的文档面兑现」）；设计 §10 DENY `docs/adr/**`、`CONTEXT.md` 与该结论自洽。
- 无新域词（docs/AGENTS 词汇纪律不触发 CONTEXT 同改）；无新宿主验证义务（D1 否决 Completion gate 条款）；无 wire/schema/持久化/状态机/公共 API 触碰。
- 反事实核验（裁决边界对称性，非本设计立场）：若建议措辞出现 `readData(path, { schema: true })` 类带参形式 → 与 ADR 0016 L69/L81 冲突（负控已机械拦截）；若把 null 表述为错误/失败 → 与 L22 冲突（负样本已拒）；若重述两键全等形状 → 与 L19 冲突（R7 已拦截）；若宣称投影是 live 引用可跨读共享 → 与 L70/CONTEXT _Avoid_ 冲突。设计措辞对以上四条反向全部避让——恰落在无文本修订负担的区间。

## 7. Hard conflicts

无。hard-conflict **0**。

全决策集（ADR 14 文件 + CONTEXT.md）无任何条款与设计建议措辞相抵：设计是纯文档同步，母法（ADR 0016）恰**要求**这类同步（Consequences 第 4 条「CONTEXT.md 更新」已在前置票兑现；消费文档同步是 docs/AGENTS「当代码行为变化时更新每个契约变更的规范文档」义务的下游延伸）；被 ADR 0016 修订掉的旧两键形状注记（cordis L341）是全仓唯一矛盾残留（grep 实测），修正它正是 Issue AC2 的命题。

## 8. Required actions（非阻塞，移交下游）

1. **[SA3 — 行号勘误，非冲突]** 设计 D6 称适配器子弹位于「现 L44」，实测为 **L43**（`grep -n` 核验；off-by-one）。子弹原文全仓唯一，无定位歧义；落位时以文本匹配为准，勿盲信行号。同型微瑕：SA6 与设计对 ADR 0008 修订节引 L167–177 vs L167–178、CONTEXT「Data」L33–35 vs L34——均为区间端点舍入，内容锚已亲核一致，不构成冲突。
2. **[SA3 — 精度澄清，非冲突]** 设计 §6 实现注意 3「既有内容零删改」辖**必改新节**；若采纳可选 D6，则另有一行既有子弹被追加式编辑（原文保留 + 括注）。两者不矛盾但建议 SA3 在提交说明中分开陈述，避免「纯加法」表述被误读为覆盖 D6。
3. **[SA4 — 观察项]** §7 注记 `schema: { valueSchema, aliases, docs, aliasDocs }` 为**键名示意**而非字面序列化输出（与同文件 L320–321「说明 + 形状注记」先例风格一致）；R7 只锁「注记含 schema」，行为锚锁真实键集。SA4 语义评审时可确认示意性对读者无误导（键集与实测一致，非虚构）。
4. **[SA4 — 观察项]** external-project-vfsl-codegen.md 现无任何 ADR 链接（实测 grep 零命中）；§8 的 `[ADR-0016](../adr/…)` 将是该文件首个 ADR 链接，风格取自同目录 cordis 先例（L3/L159 在案）。路径实测可达；是否采纳该可选项属设计已声明之自由度。
5. **[SA6/SA7 — 终态复核清单]** 实现后核对：ALLOW LIST 外零触碰（`git status`）；R1–R7 全绿 + 负控 21/21 保持绿；全仓 `pnpm typecheck` + `pnpm test` 双绿（AC3）；`git diff --check` 干净；新相对链接两处可达。

## 9. Verdict

**clear**。

- 冲突点数：**0**（hard-conflict 0 / override-declared 0 / evolution-required 0）。
- 裁决分布（对照行共 24）：**no-conflict × 13**（焦点表 A6/A7/A8/A9/A11/A13/A14 六行 + 3.2 表 D1/D3/D4/D5/词汇/风险/其余 ADR/无运行时变化七行）+ **implements-existing-decision × 11**（焦点表 A1/A2/A3/A4/A5/A10/A12 七行 + 3.2 表文件范围/验收映射/SA6 契约兑现等四行）。焦点表 A1–A14 全部落地为「无 Required action」。
- 焦点裁定：**建议文档断言的加法兼容性 = no-conflict**——三键形状/四键投影体/键规约同构/null 三情形单义/detached 深拷贝/读后 mutation 消费六组断言均为 ADR 0016 决策节的逐义转述（多处与 runtime.ts L123–127、行为锚实测互证，无虚构行为）；全部既有示例保持消费面兼容（`.ok`/`.value` 消费者不受影响，ADR 0016 L77 明文加法兼容）；唯一非加法改动（cordis L341 注记替换）是 AC2/R7 明令的矛盾修正，且示例代码本体不变。
- 设计自报复查三疑点闭合：无 opt-in 暗示（A9）、无 null 误读（A4）、无 ADR 0008 D8 修订节回退（A1/A5/A7）。
- Issue 范围一致性：ALLOW LIST ⊆ Issue 范围（typed-access skill + docs/integration readData 消费文档，消费站点 grep 实测恰 cordis L340/L360 + external L253/L349）；AC1–AC3 在 §4/§12 逐条映射；Owner 要求面为空（REST 双通道实测 0 评论）。
- 上游验收契约一致性：R1–R7 锚词与建议措辞逐条可满足（对照夹具 matcher 亲核 + 红契约 7/7 复跑属实）；21 条负控无一被建议措辞误触（`readDataOptionUsages`/`staleAnnotationViolations`/核心内容保持/权威源健全四组逐 matcher 核验）；SA6 §15 留白的五项自由度（措辞/语言/R7 修法/深拷贝告诫/根 AGENTS 句）设计选择全部在留白内。
- 信息充分性：ADR 全集 14 文件状态与辖域、CONTEXT 词条、runtime/vfsl 源码形状、SA6 夹具 matcher、红/控契约复跑、全仓过时注记扫描、Issue 评论双通道——均已亲核；无信息不足。

## 10. requiresConflictRecheck

**false**（设计层）。

设计已被本报告裁定 clear 且无 Required action 级冲突义务；建议措辞与决策集的逐句对照（焦点表 A1–A14）即设计 §15 所请复查的完整闭合，设计无需修订、无需再次冲突复查。实现期一致性由既有机械门兜底：R1–R7 红→绿 + 21 条负控常驻（防措辞回退与越界）+ AC3 全仓双绿 + §8.5 终态复核清单；若实现偏离设计措辞至 §6 所列负控反向区（opt-in 带参、两键注记、null 误读），契约将直接红灯，届时再触发冲突复查。
