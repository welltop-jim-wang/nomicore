# SA1 设计 — Issue #274 文档同步：typed-access 与 docs/integration 覆盖 readData 语义 schema 投影（ADR 0016）

- Worktree：`/home/wangjian/nomicore-fix-issue-274`（branch `mabf/issue-274`，HEAD `6ab8c87`）
- Phase：design（iteration 0，dispatch `sa-d83bfa86-801d-4c0c-bae2-fb51b54ac647`，`wiki/raw/task_274_dispatch.md`）
- 上游输入：任务简报 `wiki/raw/task_issue-274.md`；SA6 验收契约 `wiki/raw/task_issue-274_sa6_contract.md`（裁决 approve，7/7 红 + 21/21 负控绿）
- 母法：`docs/adr/0016-readdata-semantic-schema-projection.md`（已接受）；ADR 0008 L167–178 修订节；`CONTEXT.md` 「Data」L33–35 与「语义 schema 投影」L37–39 词条

## 1. 任务类型、目标和非目标

**任务类型：feature（文档能力缺口同步）**——非 Bug。行为面（#273/PR #278、#272/PR #277）与规范面（ADR 0016、ADR 0008 修订节、CONTEXT 词条）均已合入 HEAD；缺口是面向集成方与 agent 消费者的文档未同步：typed-access skill 对成功读的 `schema` 字段零覆盖，cordis-plugin-hosting 示例含与运行时真实输出矛盾的两键全等形状注记。

**目标（本设计产出措辞级方案，不实施）：**

1. `.agents/skills/nomicore/typed-access.md` 新增「读结果语义」小节，覆盖 AC1 六要点：成功读 `schema` 字段形态（四键投影体）、docs/aliasDocs 键规约与派生 schema 文档三表同构、`schema` 为 `null` 不是读的失败、典型消费方式（读后修改凭投影构造合法 mutation）、挂接 ADR 0016 权威源。
2. `docs/integration/cordis-plugin-hosting.md` L340–341 的 `readData` 形状注记同步为含 `schema` 的三键形状（AC2），并保持同页 L360（无注记、加法兼容）不变。
3. 全部陈述与 ADR 0016 一致；现有示例保持加法兼容（适配器只消费 `.ok`/`.value` 的例子不强制改写）。

**非目标：**

- 不改任何生产代码、测试代码或既有契约测试文件（SA6 三份契约文件冻结为实现验收面）。
- 不改规范面：ADR 0016 / ADR 0008 / CONTEXT.md 已是母法，文档向其对齐，不反向修订。
- 不给宿主发明新的验证义务（Completion gate 不新增 schema 投影相关条款——documentation-only 改动不得发明实现行为，docs/AGENTS.md）。
- 不改根 `AGENTS.md`、`.agents/skills/nomicore/replication.md` 等作用域外文档（见 §10 DENY LIST，均无形状断言、无矛盾）。

## 2. 当前行为与证据锚点

| 事实 | 证据锚点 |
|---|---|
| `readData` 成功分支恰三键 `{ ok: true, value, schema }`，`schema` 为 `ReadDataSchemaProjection \| null` | `packages/namespace-runtime/src/runtime.ts` L123–127（`NamespaceRuntimeReadDataResult`）；ADR 0016 L19 |
| 投影体四键 `valueSchema`/`aliases`/`docs`/`aliasDocs`；docs/aliasDocs 键规约与 DerivedSchema 文档三表同构（§3 绝对语法路径 + `'<item>'/'<key>'/'<member N>'` 合成段，别名以别名名锚定） | ADR 0016 L30–42；`packages/vfsl/src/index.ts` L126 公开导出 `ReadDataSchemaProjection` |
| `schema` 为 `null` 三情形单义（无 active schema / 路径偏离 / 静态解析失败），null 不是读的失败；always-on、每次读 detached 深拷贝 | ADR 0016 L22、L69–70；CONTEXT.md L37–39；ADR 0008 L167–178 修订节 |
| cordis 示例装配下 `readData(['title'])` 实测 = ok=true、value='first'、键集恰 `['ok','schema','value']`、schema 非 null 且 own keys 恰四键 | SA6 负控行为锚 `packages/namespace-registry/test/readdata-docs-adr0016-sync-control.test.ts` L112–166（HEAD 21/21 绿） |
| typed-access.md（153 行，英文正文）对 schema 投影零覆盖：`投影`/ADR-0016/valueSchema/aliasDocs/null 全部 0 命中 | SA6 契约 §4 预扫描；本次会话全文亲读复核 |
| cordis-plugin-hosting.md L341 为全仓唯一两键全等形状注记 `// { ok: true, value: 'first' }` | 本次会话全仓 grep `// *{ *ok: *true`（*.md，排除 wiki/raw）：仅 cordis L341 与 ADR 0016 自身 L55（`{ ok: true, ...projection }`，不在扫描作用域） |
| docs/integration 消费 readData 恰两文件：cordis L340/L360、external-project-vfsl-codegen L253/L349；其余 integration 文档（hub-peer-deployment、local-package-linking）无 readData 消费 | 本次会话 grep 复核，与 SA6 §1 一致 |
| typed-access 现有 §5 适配器与 §6 反例只消费 `.ok`/`.value`，加法兼容（ADR 0016 L77） | external-project-vfsl-codegen.md L253–256、L349；ADR 0016 L77「adapter 可忽略新字段，亦可在其后消费」 |
| 契约测试入口真实：vitest `include: ['packages/*/test/**/*.test.ts', …]`；夹具无 `.test.ts` 后缀不被收集 | `vitest.config.ts` L15、L20 |

## 3. 能力缺口（feature 缺口链，承接 SA6 §8）

| Step | 事实 | 证据 | 设计响应 |
|---|---|---|---|
| ① 规范面已就位且与行为一致 | ADR 0016 + ADR 0008 修订节 + CONTEXT 词条落仓 | §2 锚点 | 文档陈述逐句以 ADR 0016 L19/L22/L30–39/L42/L69–70 为准 |
| ② 行为面已合入且测试全绿 | #273/#272 在 HEAD；运行时契约 21/21、registry 79/79 | SA6 §4 复跑 | 本票零行为改动，只同步消费文档 |
| ③ typed-access 零覆盖（AC1 六要点全部缺席） | R1–R6 内容锚 0 命中 → 7/7 红中之 6 | SA6 §5/§13 | §5 设计 D1：新增读结果语义小节（措辞见 §6） |
| ④ cordis L341 注记与真实输出矛盾（AC2） | 注记两键 vs 行为锚实测三键 + 四键投影体 | R7 红 + 行为锚 | §5 设计 D3：注记同步为三键形状（措辞见 §7） |
| ⑤ 收敛点 = 文档同步本身 | 规范/行为两面陈述已冻结；文档只须不矛盾、示例加法兼容 | docs/AGENTS.md 纪律；ADR 0016 L77 | 设计不触碰任何规范/行为文件 |

## 4. Owner 要求落实

Issue REST comments 当前为 `[]`（dispatch 记录；SA6 §2 同口径），无 comment ID / updated_at / owner 评论要求需并入。执行标准唯一来源 = 简报正文（What to build 六要点 + AC1–AC3）。

| 来源 | 要求 | 设计章节 |
|---|---|---|
| Issue 正文 What to build ①④ | typed-access 说明成功读 `schema` 字段形态、null 语义、典型消费方式 | §6（D1/D2 措辞） |
| Issue 正文 What to build ② | docs 切片与派生 schema 文档三表同构的键规约 | §6（R4 段措辞） |
| Issue 正文 What to build ③ | 「`schema` 为 `null` 不是读的失败」判读指引 | §6（R5 段）+ §7（cordis 注记） |
| Issue 正文 What to build ⑤ | 范围 = typed-access 指引 + docs/integration 消费 readData 文档 | §10 文件范围 |
| Issue 正文 What to build ⑥ | 现有示例保持加法兼容、陈述不得与 ADR 0016 矛盾 | §5 D4/D5、§12 负控保持 |
| AC1/AC2/AC3 | 三条验收 | §12 验收映射 |

## 5. 设计决策与主要备选方案

**D1（落点）：typed-access.md 新增独立 `##` 小节，插在「Activation guards」末尾（现 L106）与「## Mutation policy」标题（现 L108）之间。**
理由：六要点内容量约 5 段，塞进 Process item 6 会破坏编号清单的信息密度；塞进 Completion gate 会把「说明性内容」混入「宿主验证义务」，且 documentation-only 改动不得发明实现行为。小节位置使阅读流自然衔接：Process → Program wiring → **读结果语义** → Mutation policy（读后修改恰好衔接 R6 消费场景）→ Completion gate。
备选否决：并入 Process item 6（过载）；新增 Completion gate 条款（发明宿主义务，违反 docs/AGENTS 纪律）。

**D2（语言与词汇）：小节用英文撰写（与 typed-access.md 全文一致），采用 CONTEXT 词条的规范英文词形 "semantic schema projection" / "A null schema is not a read failure"。**
理由：SA6 §15.2 已确认匹配器双语兼容且文档为英文正文；docs/AGENTS 要求「Use repository vocabulary exactly」，词形取自 CONTEXT L37 与 ADR 0016，不在文档中发明新术语。

**D3（cordis 注记修法）：保留「注释即打印形状」的既有风格——L341 替换为含 `schema` 的三键注记，并在 L340 调用上方加两行中文说明注释（含 null 判读与 ADR 0016 指向）。**
理由：行为锚已证明该示例实际输出四键非 null 投影，注记可以精确到键集；说明行把 null 语义一次性带到 AC2 消费现场；总 diff = 1 行替换 + 2 行新增。同页 L360（`readData(['count'])`，无注记）不动——加法兼容。
备选否决：仅删除注记（丢失对读者最有用的输出形状信息）；改为纯说明文字不贴形状（与该文件 L320–321 既有「说明 + 精确注记」风格不一致）。

**D4（external-project-vfsl-codegen.md）：可选（推荐）单句增补，无示例代码改动。**
理由：AC2 的判据是「无与 ADR 0016 矛盾的描述」，该文件现有适配器只消费 `.ok`/`.value` 属加法兼容（ADR 0016 L77 明文），红契约不要求改它；但 typed-access.md L3 把该文件指为「authoritative external-project workflow」，只读该文件的宿主将永远不知道 readData 携带 schema——一句加法说明以近零成本闭合该指引缺口。不采纳「在 §5 适配器示例中增加 schema 转发代码」：会改变示例形状、扩大评审面，违背最小同步。

**D5（作用域外文档零改动）：根 `AGENTS.md`「Reads may use the dynamic `NamespaceLease.readData()` …」句、`.agents/skills/nomicore/replication.md` L90、其余 skill 文档均无形状断言（本次会话 grep 复核），与 ADR 0016 加法兼容、无矛盾。** 不改（见 DENY LIST）。

**D6（typed-access Process item 6 交叉指针）：可选（推荐）在 item 6 第二子弹尾追加一句指向新小节。** 非必需（新小节位于自然阅读流中，六条内容锚全部由新小节独立满足）；采纳成本一行。

**D7（冲突复查）：`requiresConflictRecheck = true`，见 §13。**

## 6. 措辞级方案 — `.agents/skills/nomicore/typed-access.md`（必改，对应 R1–R6）

插入位置：现 L106（「…Also inspect `--listFilesOnly` output for the exact generated file.」）之后、现 L108（`## Mutation policy: minimal, mergeable, semantic`）之前，新增整节。以下为建议全文（SA3 可微调句式，但每段锚词与段落结构须保持——锚词-段落映射见表后）：

```markdown
## Read result: value plus semantic schema projection

Every successful `readData(path)` returns `{ ok: true, value, schema }` ([ADR 0016](../../../docs/adr/0016-readdata-semantic-schema-projection.md); see the 语义 schema 投影 entry in `CONTEXT.md`): besides the plain logical value, `schema` carries the path's semantic schema projection — the semantics an agent consumer needs to interpret the value (value domains, literal unions, constraints) and to prepare a follow-up write.

The projection (`ReadDataSchemaProjection`) has four keys:

- `valueSchema` — the value-semantics subtree at the path end (refs kept by name, not inlined);
- `aliases` — the transitive closure of aliases referenced by `valueSchema` (self-contained, recursion-safe);
- `docs` / `aliasDocs` — the relevant slices of the derived schema documentation tables.

The keys of `docs` and `aliasDocs` are isomorphic to the derived schema documentation tables: absolute syntax paths plus `'<item>'` / `'<key>'` / `'<member N>'` synthetic segments, with alias-internal docs anchored by alias name.

`schema` is `null` when there is no active schema, the path strays outside the schema, or static resolution fails. A null schema is not a read failure: `ok` stays true. Treat a null projection as "no semantics available for this path", not as an error. Every read returns a detached deep copy; do not cache or share projections across reads.

When a read is followed by a write, use the schema projection returned with the value to interpret the value's domain and construct a legal `mutateData()` mutation (minimal, mergeable, semantic — next section). Static `PathAt` / `PathPatchValue` types remain the compile-time authority; the runtime projection serves dynamically read values and agent-style consumers that must interpret data without generated types.
```

**段落-锚词-验收映射**（匹配器定义见 `readdata-docs-adr0016-contract-fixture.ts` L55–107；段落 = 空行分隔文本块）：

| 契约 | 匹配器要求 | 建议文本中的满足点 |
|---|---|---|
| R1 | 文件级出现 `ADR 0016` / `0016-readdata` | 第 1 段链接文本 "ADR 0016" + URL `0016-readdata-…`（相对链接自 `.agents/skills/nomicore/` 上溯三级至仓根，路径已核实存在） |
| R2 | 同一段落含 `readData` + 「schema projection/投影」相邻词形 | 第 1 段："Every successful `readData(path)` returns … semantic schema projection" |
| R3 | 同一段落含 `valueSchema` + `aliasDocs` | 四键 bullet 列表（**列表项之间不得插入空行**，否则段落被切开、锚分离） |
| R4 | 同一段落含 `aliasDocs` + 键规约锚词（isomorphic/synthetic/…） | 第 3 段："The keys of `docs` and `aliasDocs` are isomorphic … synthetic segments …" |
| R5 | 同一段落含 `null` + 「not a read failure/不是读的失败」 | 第 4 段："A null schema is not a read failure" |
| R6 | 同一段落含「schema projection」词形 + mutation/mutateData | 第 5 段："use the schema projection … construct a legal `mutateData()` mutation" |

**实现注意（负控保持）：**

1. 全节只允许 `readData(path)` 单参形式——任何 `readData(…, …)` 带逗号第二实参的写法会触发负控 `readDataOptionUsages`（ADR 0016 always-on，无 opt-in）。
2. 不引入行首 `// { ok: true, …` 且该行无 `schema` 的注记（负控 `staleAnnotationViolations`）；上文行内代码 `{ ok: true, value, schema }` 不以 `//` 开头，安全。
3. 既有内容零删改（`VfslPathMap`、`--check` 等核心内容由负控锁定必须在场）——本节为纯加法插入。

**可选项 D6（Process item 6 交叉指针，推荐）：** 将现 L44 子弹

```markdown
   - the adapter calls public `NamespaceLease.readData()` and `mutateData()`;
```

改为

```markdown
   - the adapter calls public `NamespaceLease.readData()` (a successful read returns `{ ok, value, schema }` — see [Read result: value plus semantic schema projection](#read-result-value-plus-semantic-schema-projection)) and `mutateData()`;
```

锚链接与建议标题 `## Read result: value plus semantic schema projection` 的 GitHub slug 一致；若 SA3 改标题须同步改锚。

## 7. 措辞级方案 — `docs/integration/cordis-plugin-hosting.md`（必改，对应 R7/AC2）

现 L340–341：

```ts
console.log(lease.readData(['title']))
// { ok: true, value: 'first' }
```

替换为（仍在原代码块内）：

```ts
// readData 成功分支恰三键（ADR 0016）：schema 为该路径的语义 schema 投影或 null，
// null 不是读的失败（读的 ok 恒真）。
console.log(lease.readData(['title']))
// { ok: true, value: 'first', schema: { valueSchema, aliases, docs, aliasDocs } }
```

- 注记行含 `schema` → 不再触发 `staleAnnotationViolations`（R7 转绿）；键集 `{ valueSchema, aliases, docs, aliasDocs }` 与行为锚对该示例的实测（`Object.keys(r1.schema).sort()` 恰四键、非 null）精确一致，非虚构。
- 事实依据逐条：三键形状 = ADR 0016 L19 / runtime.ts L127；投影或 null = ADR 0016 L19–22；null 判读 = ADR 0016 L22；本例非 null = 负控行为锚实测。
- 同页 L360 `console.log(reopened.lease.readData(['count']))` **不动**（无注记，加法兼容）。
- 本文件其余部分零改动。

## 8. 措辞级方案 — `docs/integration/external-project-vfsl-codegen.md`（可选推荐，非契约必需）

位置：§5，现 L286 段（「适配器中的断言只位于运行时校验结果与生成类型之间的受控边界。……TypeScript 类型不能替代运行时校验。」）之后新增一段：

```markdown
`readData` 的成功结果还随值携带 `schema`——该路径的语义 schema 投影（[ADR-0016](../adr/0016-readdata-semantic-schema-projection.md)；`null` 不是读的失败）。上面的适配器刻意只收窄到 `.value`；需要随读语义的宿主（如 agent 消费者）可在同一适配器中同时暴露 `result.schema`，这是加法兼容的演进，不改变本页示例。
```

- 链接相对路径 `../adr/…` 与同目录 cordis-plugin-hosting.md 的 ADR 引用风格一致（`[ADR-0006](../adr/0006-….md)` 先例）。
- 不修改 §5 适配器示例代码、§6 反例；无 `readData(…, …)` 带参形式、无两键全等注记 → 现有负控（该文件注记扫描 0 违规）保持绿。
- 若评审认为应严格最小化，可整体省略本项：R1–R7 与全部负控在省略时同样全绿（§12 标注）。

## 9. 接口、状态机与数据流

**无运行时接口、状态机、数据流变化。** 本设计只新增/替换 Markdown 文本，零代码路径改动（依据：§10 ALLOW LIST 全部为 `.md`；HEAD 上行为契约 21/21、registry 79/79 已绿）。唯一的「数据流」是文档内容的权威传递链：

| 路线 | 触发者与输入 | 写入或创建点 | 转换与边界 | 存储或传输 | 读取或投影点 | 可观察结果 | 错误与清理 | 验收锚点 |
|---|---|---|---|---|---|---|---|---|
| 规范→消费文档同步 | SA3 按 §6–§8 措辞落位 | typed-access.md 新节、cordis L340–341、（可选）external §5 一句 | ADR 0016 L19/L22/L30–42/L69–70 的规范词形 → 英文/中文消费文档措辞；不复制规则、以链接挂接权威源（docs/AGENTS） | git 工作区文本 | 集成方/agent 读者；SA6 内容匹配器按段落读取 | R1–R7 全绿、负控 21/21 保持绿 | 失败模式=文档与 ADR 矛盾，由红契约+评审捕获；回滚=git revert 文档提交 | `readdata-docs-adr0016-sync-red.test.ts` / `-control.test.ts` |

## 10. 文件范围

### ALLOW LIST

| 路径 | 预期改动 | 原因 |
|---|---|---|
| `.agents/skills/nomicore/typed-access.md` | 必改：L106/L108 之间插入 §6 新节（R1–R6）；可选推荐：L44 子弹追加 D6 交叉指针 | AC1 六要点唯一落点；SA6 §10 必改面 |
| `docs/integration/cordis-plugin-hosting.md` | 必改：L340–341 注记同步（§7）；L360 不动 | 全仓唯一与 ADR 0016 矛盾的形状注记（R7/AC2） |
| `docs/integration/external-project-vfsl-codegen.md` | 可选推荐：§5 L286 后新增一段（§8）；示例代码零改动 | typed-access L3 指其为权威工作流，一句加法说明闭合指引缺口；缺省亦可全绿 |
| `wiki/raw/task_issue-274_design.md` | 本设计产物（SA1 本轮写入） | 设计记录 |

### DENY LIST

| 路径 | 与任务的关系 | 禁止修改原因 |
|---|---|---|
| `packages/namespace-registry/test/readdata-docs-adr0016-sync-red.test.ts` | 本票验收契约（7 条红） | SA6 冻结产物；实现不得改契约 |
| `packages/namespace-registry/test/readdata-docs-adr0016-sync-control.test.ts` | 本票负控/行为锚（21 条） | 同上；行为锚锁运行时事实 |
| `packages/namespace-registry/test/readdata-docs-adr0016-contract-fixture.ts` | 共享匹配器夹具 | 同上；改夹具即改验收语义 |
| `docs/adr/0016-readdata-semantic-schema-projection.md`、`docs/adr/0008-…md`、`CONTEXT.md` | 母法/规范面 | 已接受且与行为一致；文档向其对齐而非修订决策 |
| `packages/**`、`apps/**`、`domains/**`、`tests/**` | 行为面 | #273/#272 已交付，本票零代码义务（AC3 只是终态门） |
| 根 `AGENTS.md`、`.agents/skills/nomicore/{SKILL,schema,cordis-host,replication,schema-evolution}.md` | 作用域外 readData 提及/无关 | 无形状断言、与 ADR 0016 加法兼容（本次 grep 复核）；改则超 Issue 范围 |
| `docs/integration/hub-peer-deployment.md`、`docs/integration/local-package-linking.md` | docs/integration 其余文档 | 无 readData 消费（grep 实测） |
| `README.md`、`README_zh.md`、`REPORT.md` | 无 readData 形状陈述 | grep 实测零命中；非本票范围 |
| `wiki/raw/**`（除本设计产物） | 历史流水线证据 | docs/AGENTS：wiki/raw 是 evidence，非规范契约 |

## 11. 调用方影响矩阵（文档消费方）

| 消费方 | 当前处理 | 设计后处理 | 所需改动 | 证据 |
|---|---|---|---|---|
| 独立宿主集成者（读 typed-access.md） | 不知道 readData 返回 schema；按两键心智模型消费 | 获得读结果语义小节：三键形状、四键、null 判读、深拷贝纪律、读后 mutation 衔接 | 仅读文档；既有流程（生成/接线/负向夹具）零变化（纯加法插入） | §6；负控「typed-access 核心内容保持」 |
| Agent 消费者（skill 调用方） | 值缺语义，无法判读枚举/字面量域 | 凭随读投影解读值域、构造合法 mutation；null 视作「无语义可用」而非错误 | 无（消费方式指引为加法） | ADR 0016 L8/L22；§6 R5/R6 段 |
| Cordis 宿主集成者（读 cordis-plugin-hosting.md） | L341 注记与 console.log 实际输出矛盾（误导） | 注记与真实三键/四键输出一致，并附 null 判读 | 无（示例行为不变） | 行为锚实测；§7 |
| 外部项目 codegen 跟随者（读 external-project-vfsl-codegen.md） | 适配器示例只消费 `.ok`/`.value`（合法但不知有 schema） | （可选）一句话知晓可加法暴露 `result.schema` | 无（示例代码不动） | ADR 0016 L77；§8 |
| SA6 契约测试 | 红 7/7（文档缺口） | 红→绿 7/7；负控 21/21 保持 | 无 | §12 |
| CI（`pnpm typecheck` / `pnpm test`） | HEAD 全绿 | 保持全绿（零代码改动；新增文档不进 tsc Program） | 无 | package.json L11/L13；SA6 §4 |

## 12. 验收与验证映射

| 需求或风险 | 现有证据 | 所需验证 | 预期观察 |
|---|---|---|---|
| AC1 形态说明（R1/R2/R3） | 红 7/7 中 R1–R3 红（SA6 §13，3 次复跑一致） | `NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run packages/namespace-registry/test/readdata-docs-adr0016-sync-red.test.ts --typecheck.enabled=false` | §6 新节落位后 R1–R3 绿 |
| AC1 键规约（R4） | R4 红（同上） | 同上 | §6 第 3 段落位后 R4 绿 |
| AC1 null 判读（R5） | R5 红 | 同上 | §6 第 4 段落位后 R5 绿 |
| AC1 典型消费（R6） | R6 红 | 同上 | §6 第 5 段落位后 R6 绿 |
| AC2 示例同步（R7） | R7 红（L341 精确定位） | 同上 | §7 注记替换后 R7 绿 |
| 加法兼容与不越界 | 负控 21/21 绿（HEAD） | `NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run packages/namespace-registry/test/readdata-docs-adr0016-sync-control.test.ts --typecheck.enabled=false` | 行为锚仍实测三键+四键投影体；作用域文档无 `readData(…,…)` 带参；typed-access 仍含 `VfslPathMap` 与 `--check`；external/typed-access 无两键注记 |
| AC3 全仓终态门 | SA6 §4：typecheck exit 0、registry 面 405 passed | 仓根 `pnpm typecheck`（package.json L13 顺序 tsc）与 `pnpm test`（`vitest run --typecheck`） | 双绿 |
| 陈旧术语/矛盾扫描（docs/AGENTS 验证面） | 本次会话全仓 grep 复核 | grep `// *{ *ok: *true` 于全部 `*.md`（排除 wiki/raw、ADR 0016 自身 L55）→ 0 残留；`readData` 全 md 复扫无新矛盾陈述 | 仅余 cordis 已修复站点；无新增带参/opt-in 用法 |
| 链接与引用文件名（docs/AGENTS 验证面） | 新相对链接路径本次已核实存在 | 实现后核对 `../../../docs/adr/0016-…md`（自 `.agents/skills/nomicore/`）与 `../adr/0016-…md`（自 `docs/integration/`）可解析；D6 锚 slug 与标题一致 | 链接全部可达 |
| 空白错误（docs/AGENTS 验证面） | — | `git diff --check` | 干净 |
| §8 可选项不破坏验收 | 负控对该文件的扫描现 0 违规 | 同负控命令（含或不含 §8 两种终态都跑） | 两种终态均全绿；若含 §8，链接检查覆盖 `../adr/0016-…` |

## 13. 风险、回滚和残余问题

| 风险 | 评估 | 缓解 |
|---|---|---|
| 内容锚是最低门非充分门：满足正则但语义漂移（如暗示 opt-in、暗示 null 为错误） | 中 | §6/§7/§8 建议文本逐句贴 ADR 0016 L19/L22/L30–42/L69–70 原语义；SA2/SA4 语义评审兜底；负控已含语义反向负样本（「null 说明读取失败」类被拒） |
| 四键 bullet 列表被空行切开 → R3 锚分离 | 低（实现细节） | §6 实现注意 1：列表项之间不插空行 |
| SA3 改写建议句式时丢失锚词（如把 "schema projection" 改成 "projected schema"） | 低 | §6 段落-锚词映射表为实现合同；红契约逐条点名缺失锚 |
| typed-access 新节被后续重写吞掉 | 低（长期） | 负控「核心内容保持」+ R1–R6 常驻契约测试防回潮 |
| external 可选项引入与 cordis 风格不一致的链接标签 | 极低 | §8 已对齐 `[ADR-0016](../adr/…)` 先例；可整体省略 |

**回滚**：任一文件改动均为纯文本提交，`git revert` 即完全回滚；无运行时耦合、无迁移、无数据面影响。
**残余问题 / follow-up（非本票义务）**：无任务内未决必要条件。可选后续（明确不属于本票）：为 agent 宿主提供消费 `result.schema` 的完整适配器示例（§8 仅一句指引，示例属加法演进，留给真实需求出现时）。

## 14. 评审修订映射

`wiki/raw/task_issue-274_sa2_review.md` 不存在（iteration 0，尚无评审输入）——本节空置；收到评审后按 finding → 修订位置逐条补表。

## 15. 是否需要设计后 ADR 冲突复查及理由

**requiresConflictRecheck = true。** 理由：

1. **SA8 固定产物缺失**：`wiki/raw/task_issue-274_relevant_decisions.md` 与 `wiki/raw/task_issue-274_conflict_report.md` 均不存在（本任务派发链 SA6 → SA1 直达，跳过了 SA8 环节；此前任务 228/237/238/249/r2 均有 SA8 产物先例）。按 design-architecture 规程，缺 SA8 产物时已改为亲读相关 ADR（ADR 0016 全文、ADR 0008 L163–178 修订节、CONTEXT 词条、docs/AGENTS 纪律）并标记冲突复查。
2. **本设计的核心正确性谓词是 ADR 0016 保真**：Issue 明令「文档陈述不得与 ADR 0016 矛盾」。红契约只锁词形锚（最低门），新消费文档措辞是否在语义层与 ADR 0016/ADR 0008 修订节完全一致（三情形单义、always-on、深拷贝、加法兼容），值得一次窄冲突复查确认。

复查范围建议收窄为：§6/§7/§8 建议措辞逐句对照 ADR 0016 决策节；确认无 opt-in 暗示、无 null 误读、无对 ADR 0008 D8 封口修订节的回退表述。本设计不触碰任何 ADR 冻结面、不改公共 API/wire/schema/持久化/状态机——若 Controller 判断 SA2/SA4 语义评审已足够覆盖第 2 点，可将复查降级为评审内检查项。
