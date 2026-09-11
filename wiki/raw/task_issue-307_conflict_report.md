# 冲突门禁报告

- 被审对象：GitHub issue #307 任务简报（feat(vfsl-codegen): 联合成员 doc 四发射位（别名联合/枚举多行 + 内联行内前置）；`in-progress` + `feature` 标签；实读于 `gh issue view 307`，issue 更新于 2026-09-11T05:54:04Z）。Issue 反馈 REST 快照：无评论（none applicable）——无 owner 覆盖性输入可采。
- 冲突基准：`docs/adr/` 全部 17 份（0001–0012、0014、0016–0019；0013/0015 编号空缺，无 superseded 文件）+ 根 `CONTEXT.md`。核心五件（0001/0003/0004/0005/0019）全文实读；其余经全仓 `grep 生成器|codegen|发射` 收敛核对（0010/0017 的命中分别为复制事件发射点与外部项目指纹文档指引，与 codegen 输出面无交集）。
- 门禁阶段：前置门禁（SA 派发之前）。
- 产出日期：2026-09-11（SA8，dispatch `sa-3ae26e00-3ef8-4add-9a38-26270e36e988`）。
- Worktree：`/home/wangjian/nomicore-fix-issue-307`（branch `mabf/issue-307`，HEAD `4d4208b`）。前置事实核验：#306 实现（M4 解析 + IR/derived `memberDocs`）已经 PR #313 合并为本支 HEAD `4d4208b`；ADR 0019 落档于 `91c4add`。

## Verdict

`clear`

**放行进入后续 SA 派发**。冲突点数 0：evolution × 0、override-declared × 0、hard-violation × 0——issue #307 是已接受 ADR 0019 决策 6 的忠实实现票，其后果清单原文即把本任务登记为交付物（「`packages/vfsl-codegen`：emitter.ts 四发射位（含枚举多行布局、semicolonFree 模式同布局）」）。附 2 项 SA1 设计留白登记（W1/W2）与 3 项边界义务（B1–B3），均非冲突。

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0001 | VFSL 单一真相源 | accepted（含修订节） | 相关（docs 全部文档性质、无机器标签） | no-conflict：成员 doc TSDoc 发射是纯文档消费，与「语义层不设机器标签」同向；ADR 0019 决策 8 明文本特性不打开任何机器语义口子 |
| ADR-0002 | 全新重写，authority 出范围 | accepted | 无关 | no-conflict：codegen 输出面零交集 |
| ADR-0003 | 求值器与派生 schema | accepted | 相关（派生 schema 冻结形状 docs 表条款——已被 ADR 0019 决策 5 显式修订：三表扩四表，`memberDocs` 条件稀疏） | no-conflict：修订链完备（docs/AGENTS.md「amend explicitly」纪律已由 0019 满足）；#306 已将 `DerivedSchema.memberDocs` 落地（derived.ts L86-91），#307 只消费第四表 |
| ADR-0004 | vfsl-protocol 类型投影 | accepted | **核心相关**（后果条款「类型树形状 = 生成契约……映射表 docs→TSDoc 注释」；D2 联合投影宽度） | no-conflict：成员 doc 行是注释，类型树形状、D2 键空间投影、PathSchema 外壳全部不变；TSDoc 发射正是映射表既定落点 |
| ADR-0005 | 投影生成管线 | accepted | **核心相关**（D3 生成器是纯发射器、输入 = evaluate 派生物并携带 docs；D4 生成物入仓 + CI regen-diff 源/逻辑漂移双抓） | no-conflict：四发射位消费 derived `memberDocs` 表（非 IR、不重推导语义）；「无成员 doc 逐字节不变 + `generate --check` 不报过期」的 AC 正是 D4 纪律的行为锚定 |
| ADR-0006 | 持久化插件与 docstore | accepted（含修订节） | 无关 | no-conflict |
| ADR-0007 | 逻辑验证与 Yjs Runtime Bridge | accepted（部分被 0008 取代；含 #237 修订节） | 无关 | no-conflict：校验面不读 docs（ADR 0019 决策 8 维持）；本任务不触校验 |
| ADR-0008 | NamespaceRuntime 读写能力与单序列器 | accepted（含修订节） | 无关 | no-conflict |
| ADR-0009 | Registry、租约与 Host 生命周期 | accepted（含修订节） | 无关 | no-conflict |
| ADR-0010 | Hub/Peer WS Y.Doc 复制 | accepted（含修订节） | 无关（「发射点纪律」条款指复制事件，非 codegen） | no-conflict |
| ADR-0011 | best-effort 诊断变更日志 | accepted | 无关 | no-conflict |
| ADR-0012 | 实例身份与 WS plugin 所有权 | accepted | 无关 | no-conflict |
| ADR-0014 | VFSL 校验 JSONL 与 framed sidecar 日志 | accepted | 无关 | no-conflict |
| ADR-0016 | readData 语义 schema 投影 | accepted（docs 切片条款被 ADR 0019 决策 7 显式修订：两来源 → 三来源） | 弱相关 | no-conflict：决策 7 的实现归属 #308（OPEN）；#307 边界明确不触 `resolve-schema-at-path.ts`（见 B1） |
| ADR-0017 | schema 生命周期元数据与指纹 | accepted | 弱相关（语义/信封指纹纪律） | no-conflict：指纹稳定性义务已在 #306 兑现（无 memberDocs 键的 IR 逐字节不变）；#307 不改 packages/vfsl，指纹面零触碰 |
| ADR-0018 | peer schema re-arm | accepted | 无关 | no-conflict |
| ADR-0019 | VFSL 联合成员文档注释（M4） | accepted（2026-09-11，issue #304） | **直接基准**（决策 6 四发射位；决策 8 纯文档性质；后果清单明列 codegen 交付物与测试矩阵「codegen 四发射位文案与无 doc 逐字节不变」） | no-conflict：issue 正文与 AC 逐条转写决策 6（别名联合逐行 / 别名枚举多行切换 / 内联行内前置 / YPlainArray 与 YXmlFragment 无发射位 / semicolonFree 同布局 / 无 doc 逐字节不变） |
| CONTEXT.md | 术语与硬性惯例 | 现行 | 相关 | no-conflict：本任务不引入/不改变任何域术语；「语义层」词条（全部文档性质）与产出同向；无词条需要随 #307 修订 |

裁决分布：no-conflict × 18 项（17 ADR + CONTEXT.md，其中核心相关 3、直接基准 1）；evolution × 0；override-declared × 0；hard-violation × 0。

## 冲突点

无。被审对象的全部规范性要求均能在冲突基准中找到同向或显式授权条款，无任何条款被要求违反、收窄或静默改写。

## 逐条对照明细（被审对象要求 → 冲突基准条款）

| # | 被审对象要求 | 对照基准条款 | 裁决 | 依据（含 HEAD `4d4208b` 实读证据） |
|---|---|---|---|---|
| 1 | 别名判别联合成员 doc 以 `  \| ` 行为基准上一行发射逐成员 TSDoc | ADR 0019 决策 6.1 | no-conflict | 发射位在场：emitter.ts L217-223 别名联合已是 `export type X =\n  \| A\n  \| B` 多行布局（`emitUnionBodyMembers`），成员 doc 行只需在既有 `  \| ` 行上方插入；布局基准与 ADR 示例（doc 缩进与 `|` 列对齐）一致 |
| 2 | 别名枚举（标量联合坍缩位）有成员 doc 时转多行逐成员布局，默认与 semicolonFree 两种模式 | ADR 0019 决策 6.2（「成员边界仅从 memberDocs 表按 `<member N>` 路径回填」「无成员 doc 时保持既有单行布局，存量生成物逐字节不变」） | no-conflict | 消费面已就绪：derived.ts L86-91（键 = `<member N>`，N 从 0 起声明序，条件稀疏、仅非空条目）+ evaluate.ts L403-408（walkDocs 收集）；现发射为单行（emitAlias L224 → emitInner leaf → projectValue enum `'a' \| 'b'`，valuetype.ts）。多行切换须以 memberDocs 表在该别名成员键上有条目为闸门（W1 留白登记） |
| 3 | 内联联合/内联枚举（字段类型位）成员 doc 行内前置发射 | ADR 0019 决策 6.3/6.4（`/** d */ Member \| …`） | no-conflict | 发射位在场：emitInner case 'union'（L289-293，`join(' \| ')`）与 case 'leaf'（L295-301 → projectValue）；行内前置是纯前缀拼接，不改变 join 文法 |
| 4 | YPlainArray 纯值子树与 YXmlFragment 实参内成员 doc 无发射位（丢弃） | ADR 0019 决策 6 末段（「与 fieldDocs/markerDocs 在这些位置的既有限界同族；derived 表照常收集」） | no-conflict | 既有同族限界在代码内明文：emitter.ts L283-287（plain：纯值终态丢弃 docs）、L302-304（xml-fragment 不透明终态 → 'string'）；丢弃不回写 derived 表——收集归 #306 已落地的 evaluate，不属本任务 |
| 5 | semicolonFree 模式同布局 | ADR 0019 后果清单（「含……semicolonFree 模式同布局」）+ GenerateProjectionOptions.semicolonFree 契约（emitter.ts L28-40）+ 包 README L31-41 + `docs/integration/external-project-vfsl-codegen.md` L128 | no-conflict | 两种格式逐字节互斥、生成与 `--check` 必须同值的 fail-closed 纪律不变；多行枚举布局在无分号模式下沿既有别名联合 `  \| ` 无分隔符布局同构（#222 先例），不与 `@stylistic/member-delimiter-style multiline none` 消费配置冲突 |
| 6 | 无成员 doc 的生成物逐字节不变；存量 domains 的 `pnpm generate --check` 不报告过期 | ADR 0005 决策 4（CI regen-diff 源漂移与生成器逻辑漂移双抓）+ codegen AGENTS「deterministic and byte-stable」「`--check` must detect every stale generated file」 | no-conflict | 触发面天然有限：`domains/vfs3-assets/schema.vfsl` 现无任何成员 doc（M4 全新，schema 未用），故正确实现下存量 generated.ts 零字节变化、freshness 不漂移；该 AC 同时是防「无条件多行化」走样的行为锚 |
| 7 | codegen 包测试与 typecheck 绿，根 `pnpm typecheck` 绿 | packages/vfsl-codegen/AGENTS.md Verification（emitted types 变更时另跑根 typecheck 与 test）+ 根 package.json typecheck 脚本（14 个 tsconfig 串行） | no-conflict | 成员 doc 是注释行：VfslPathMap 增广体、PathSchema 外壳、类型形状零变化；根 typecheck 绿是「注释不改类型」的自然推论，与 typed-access 强制条款（根 AGENTS.md）无交集——本任务无 namespace 写路径 |
| 8 | Blocked by #306 | 依赖追踪 | 满足 | #306 CLOSED（`ci-passed` + `feature`），实现经 PR #313 合并为 HEAD `4d4208b`（17 文件：parser/ir/semantic/derived/evaluate + 426 行测试），memberDocs 消费面在本支真实在场；无对 #308/#309 的隐藏依赖（codegen 只吃 derived 表） |
| 9 | （隐含）输入面与语义边界 | ADR 0005 决策 3（生成器是纯发射器：输入 = evaluate 派生物，物化折叠/联合三分类只算一次，不得在生成器重推导） | no-conflict | 四发射位的成员边界信息来源被 ADR 0019 决策 6.2 显式钉死为 derived `memberDocs` 表的 `<member N>` 键回填——这是消费派生物，不是重推导；`<member N>` 路径文法在 emitter 既有代码已内联使用（emitUnionBodyMembers L358），键空间一致 |

## 登记项（非冲突；转 SA1 设计 / SA3 实现 / 后续门禁）

- **W1（SA1 设计留白）坍缩位多行切换的精确触发条件**：issue 以「别名枚举（标量联合坍缩位）」统称，ADR 0019 决策 6.2 的示例只覆盖字面量枚举。派生侧坍缩族实际含 enum 字面量联合与标量联合（如可空/多标量叶，emitter 注释 L296「标量联合 → T \| null」）等形态。SA1 须钉死：切换判据 = 该别名的 `<member N>` 键在 memberDocs 表存在条目（而非值侧 kind 枚举），以及多行化后各成员文法的来源（values 声明序）。判据选错会把「无 doc 逐字节不变」做破（对照明细 #6）。
- **W2（SA1 设计留白）多 doc 成员的确定性拼接**：M4 允许连续多条 doc 同挂一成员（ADR 0019 决策 1）。四个发射位对 2+ doc 成员的呈现（行内多块串联 / 块位多行叠加）须逐位定义并确定性渲染（tsdocLines 现语义：每条 doc 一行/一块）。
- **B1（范围边界义务）**：#307 = `packages/vfsl-codegen` only。readData docs 切片并入第三来源属 #308（ADR 0019 决策 7，涉 `resolve-schema-at-path.ts` 与 ADR 0016 修订）；v1-spec §5 四锚位修订与 schema-authoring-guide §7/8 同步属 #309。#307 不得顺带改动 `packages/vfsl` 公共面、协议包或规格文本——当前 v1-spec §5 仍写三锚位属 #309 已登记的欠账，不是 #307 的冲突或义务。
- **B2（集成惯例义务）**：实现挂 PR #305（docs/issue-304 集成 PR）之下同支累积、收官人工合并（ADR 0019 后果「Ticket Parent 惯例」；#306 已循此例进 #313→#305 支）。
- **B3（环境注记）**：门禁环境未安装依赖（node_modules 缺失，`pnpm generate --check` 无法实跑）；本报告基线绿证据采信 #306 `ci-passed` 标签 + `4d4208b` 合并事实 + 静态实读。SA6/SA7 验收与 SA3 完成自检必须实跑 `pnpm generate --check`、codegen 包测试、根 `pnpm typecheck`。

## 结论

**Verdict：`clear`——放行，可进入 SA1 设计与后续派发。**

- 冲突点数 0（evolution 0 / override-declared 0 / hard-violation 0）；18 项基准对照全部 no-conflict。
- 授权链直接且完备：ADR 0019（accepted）决策 6 即本任务的规范来源，其后果清单把「`packages/vfsl-codegen`：emitter.ts 四发射位（含枚举多行布局、semicolonFree 模式同布局）」与测试矩阵「codegen 四发射位文案与无 doc 逐字节不变」原文登记为交付物；issue 正文与 AC 是该决策的无偏转写，无任何越决策边界的附加要求。
- 前置依赖满足：#306 已合并（HEAD `4d4208b`），derived `memberDocs` 消费面在场；对 #308/#309 无隐藏依赖。
- 唯一需要设计纪律收口的是 W1/W2 两处留白（坍缩位切换判据、多 doc 拼接）——它们是实现自由度，不是决策集冲突；做破的后果由 AC #6 的逐字节断言兜底。
- 全链约束清单：B1 范围边界（不越入 #308/#309）、B2 集成惯例（挂 #305 同支累积）、B3 验证义务（SA3/SA6/SA7 实跑 generate --check / 包测试 / 根 typecheck）。
