# 冲突门禁报告 — issue #266（前置门禁）

> SA8 前置门禁产出（iteration 0，dispatch `sa-95c5994f-8337-4a51-a5e7-f23f0d011ce5`）。
> 冲突基准 = `docs/adr/` 全集（14 文件全读，无抽样；0013 编号空洞，0012 无重号——历史
> 0012 重号已由 0014-LOG 改号收敛）+ 根 `CONTEXT.md`。被审对象 = GitHub issue #266 任务简报
> （「VFSL 内容寻址 schema ID（sc1-）：窄派生接口与 envelope 校验」，label `in-progress`，
> Parent PR #158 `docs/rest-namespace-create`）。Issue 评论已经必需 REST endpoint 读取，为空，
> 无 Owner 追加要求。工作分支 `mabf/issue-266` 基于 PR #158 分支（head `a1ca2d7` 携带 ADR 0015）。
> 执行说明：`sa8-conflict-gate` 技能在本会话技能目录（`.agents/skills/`）不可用，按 SA8 角色章程
> 与仓库既有门禁方法论（`wiki/raw/task_*_conflict_report.md` 先例，四级裁决口径
> no-conflict / override-declared / evolution / hard-violation）执行；除本报告外零文件改动。

## Verdict

`clear`

任务简报与 ADR 决策集 + CONTEXT.md **无冲突**。#266 是 **ADR 0015 §「内容寻址 schema ID」 +
§「测试决策」的兑现型切片**：窄接口形状、`sc1-` 格式冻结、敏感度规则、envelope 强校验与两个
稳定 issue code、包级契约测试矩阵，与 ADR 0015 L119–144/L196 **逐字对应**；指纹语义与 ADR 0007
L17（`sha256:v1:` domain separation、语义指纹覆盖面）和 CONTEXT.md「语义指纹 / 内容寻址 schema ID」
两个词条完全一致。无条款被违反、无 override 声明需求、无未走正式声明的决策演进。附 3 项设计期
边界条件（不阻塞放行，移交设计后 SA8 复审重点核对）。

范围确认：#266 简报只覆盖 ADR 0015 的 **`@nomicore/vfsl` 包内部分**（窄派生接口 + 完整 envelope
编译扩展 + 包级契约测试）；REST vertical 本体（HTTP 契约、错误映射、observer、limits）不在本票
范围。本门禁只裁 #266 简报面。

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| 0001 | VFSL 单一真相源 | accepted（+2026-08-19 目标态/阶段态修订、2026-08-21 `SCHEMA` 命名修订） | 是（弱） | 一致：信封四键 `{lang,version,id,text}` 不变，`sc1-` 只是 `id` 的**值格式**扩展；方言冻结（`lang=vfsl/version=1` 恒定断言）与「无机器标签」条款不受触——JSDoc 仍是纯文档层，语义指纹保留 JSDoc 只是**内容身份**事实（ADR 0007 已决），不复活机器标签；「纯引擎仓库、schema 文本仅测试 fixture」与包级契约测试 fixture 用法相容 |
| 0002 | 重写权威、authority 出范围 | accepted | 否 | 不适用 |
| 0003 | 求值器与派生 schema | accepted | 是（弱） | 一致：`evaluate` 公共接缝不动；窄接口**不暴露** IR/派生 schema 是新增更窄的观察面，不撤销既有公共导出（「PRD #3 唯一公共测试接缝早期措辞废止」先例允许按 Interface 各自冻结）；派生 schema 可内容哈希纪律与指纹复用不冲突 |
| 0004 | vfsl-protocol 类型投影 | accepted | 否 | 不适用（投影/生成器零触及） |
| 0005 | 投影生成管线 | accepted | **B1** | 一致 + 边界条件 B1：D1「**id 是标签不是键**：引擎正确性不依赖 id 唯一性……信封 id ≠ doc 地址」——`sc1-` 使 id 获得**可校验的 schema 内容地址**身份，属已由 ADR 0015 + CONTEXT.md 词条登记的扩展，非矛盾（见冲突点 #6） |
| 0006 | Persistence DocPersistence | accepted（+#64/#79/#131/#133 修订节） | 否（弱） | 一致：L70 信封 id 例举（`命名空间@schema版本` 谱系标签）描述旧式 id；简报明文「旧式 SCHEMA id 继续兼容」，存量存储不因新格式失效 |
| 0007 | 逻辑验证与 Yjs Runtime Bridge | accepted（Runtime/open/read 条款由 0008 部分取代；+#237 修订节） | **核心** | 一致：L15 `compileSchemaEnvelope` 严格封闭四键 + envelope/dialect/parse/evaluate/internal 分相位结果联合——`sc1-` 强校验**落在既有 envelope 相位框架内**（加法扩展，非改相位模型）；L17 指纹 SHA-256、UTF-8、canonical JSON、domain separation `sha256:v1:<hex>`、语义指纹覆盖 `lang+version+` 规范 IR（忽略空白/普通注释、保留 JSDoc/声明顺序、排除 `id`）——与简报敏感度规则及「与 `sha256:v1:<64 lowercase hex>` 携带相同 digest」逐项互证 |
| 0008 | NamespaceRuntime 读写能力与单序列器 | accepted（+#93/#132 修订节） | 是（弱） | 一致：L36 `getActiveSchema()` 只回 `lang/version/id` + 两指纹、不暴露 module/derived/validator——窄接口同款不暴露纪律同源；L131 `SCHEMA_ENVELOPE_<code>` 动态族为 vfsl envelope 相位码的不透明透传、码域归上游注册表——新增 envelope 码**不需要** runtime 侧注册/改动 |
| 0009 | Registry、租约与 Host 生命周期 | accepted（+#131/#134 修订节） | 否（弱） | 一致：Registry create 全量重编译/校验路径不含 envelope id 格式约束；REST 先派生后组装再经 Registry 安全入口的编排属 ADR 0015 域（本票不触及 Registry） |
| 0010 | Hub/Peer WS Y.Doc 复制 | accepted（+多修订节） | 否 | 一致：L50 replicationId ≠ SCHEMA 信封 `id`——CONTEXT.md 词条 Avoid 清单同款隔离；`sc1-` 不进入复制身份 |
| 0011 | best-effort namespace 诊断变更日志 | accepted | 否 | 不适用（日志域 schema fingerprint 表述与引擎指纹互不约束） |
| 0012 | 实例身份与 WS plugin 所有权 | accepted | 否 | 不适用 |
| 0014 | VFSL 校验 JSONL 与 framed sidecar 日志 | accepted（+#152 R2 首切片 amendment） | 否 | 不适用（其「schema id/fingerprint」为日志 observer 观测字段，消费而非定义引擎 ID 格式） |
| 0015 | 纵向 REST namespace create 与内容寻址 schema ID | **提议**（2026-08-28，随 PR #158 在途） | **权威** | 一致（兑现源）：§「内容寻址 schema ID」L119–144 与简报逐字同源；§「测试决策」L196 包级契约测试清单与验收标准逐项对应。状态为「提议」 riding PR #158，而 #266 挂 PR #158 分支实现，正是 issue-tracker.md 集成 PR 纪律的既定模式（设计文档 PR 转任集成 PR，ticket 挂其下同支累积，收官人工合并）——非冲突，附流程注记（冲突点 #7） |

无 superseded ADR。被取代条款（ADR 0007 Runtime/open/read、ADR 0009 复合 key 等）不构成约束，未参与裁决。

## 冲突点

四级裁决口径：no-conflict / override-declared / evolution / hard-violation。本轮**无 hard-violation、
无 override、无 evolution 级裁决**；以下 9 项为逐条对照记录（兑现型 3、扩展/验收/工程型 3、边界条件 3）。

| # | 严重度 | 基准条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| 1 | 核心兑现 | ADR 0015 L119–125：新增 `@nomicore/vfsl` 窄 Module interface，输入 `lang=vfsl/version=1/text`，复用既有编译 pipeline，返回 semantic fingerprint 与 schema ID 或 VFSL issues；不接收 provisional envelope ID，不暴露 IR/派生 schema/validator；不是 REST endpoint | 简报「What to build」第 1 段 + 验收标准第 1/4 条（同款四不暴露） | **no-conflict（逐字兑现）** | 逐字对应，无任何形状偏差；「不暴露派生物」与 ADR 0008 L36 纪律同源互证 |
| 2 | 核心兑现 | ADR 0015 L127–133：`sc1-<52 位小写 RFC 4648 Base32>`，payload = semantic fingerprint 完整 256-bit SHA-256 digest，不截断、无 padding，与 `sha256:v1:<64 lowercase hex>` 同 digest；CONTEXT.md「内容寻址 schema ID」词条（v1 canonical 形式逐字相同） | 简报「schema ID 格式冻结为 `sc1-` + 52 位小写 RFC 4648 Base32（无 padding）……不截断」+ 验收标准第 2 条 | **no-conflict（逐字兑现）** | 三处文本（ADR/词条/简报）一致；算术自洽（32 bytes = 256 bits → 52 个 5-bit Base32 字符、去 4 个 `=`）；「同 digest 信息」与 ADR 0007 L17 domain separation 格式互证，不产生第二套摘要语义 |
| 3 | 核心兑现 | ADR 0007 L17（语义指纹覆盖面：忽略空白与普通注释、保留 JSDoc/声明顺序、排除 `id`）；CONTEXT.md「语义指纹」词条；ADR 0015 L135–140 | 简报「空白与普通注释不改变 ID，JSDoc、声明顺序及其他 VFSL 语义变化会改变 ID」 | **no-conflict（逐字兑现）** | 敏感度规则全部继承自**已接受**的 ADR 0007 指纹定义，`sc1-` 只是同一 digest 的另一 canonical 编码；ADR 0001「语义层无机器标签」不受触（JSDoc 保留在指纹中是内容身份事实，非机器语义校验） |
| 4 | 扩展对齐 | ADR 0015 L144：任何 `sc1-` 前缀输入 envelope，VFSL 完整 envelope 编译必须验证 canonical 格式及与 text semantic fingerprint 的精确匹配；格式错误与语义不匹配各用**一个稳定 VFSL issue code**，编号由实施时按错误注册表分配；旧式 id 继续兼容。ADR 0007 L15（envelope 相位既存） | 简报「同时扩展完整 envelope 编译……各使用一个稳定 VFSL issue code（编号由实施时按错误注册表分配）。旧式 SCHEMA id 继续兼容」+ 验收标准第 3 条两码场景 | **no-conflict（扩展型）** | 校验落在 `compileSchemaEnvelope` 既有 envelope 相位框架内（加法规则，不改分相位结果联合模型）；「编号由实施时按错误注册表分配」是 ADR 0015 的显式授权——注册表机制现成（见冲突点 #8），编号选择属 SA1/SA3 自由度；旧式兼容与 ADR 0006 L70 旧式 id 例举、CONTEXT.md 词条「旧式 SCHEMA id 继续兼容」三方一致 |
| 5 | 验收矩阵 | ADR 0015 §测试决策 L196：包级契约测试覆盖 fingerprint 与 `sc1-` 一一重编码、空白/普通注释稳定、JSDoc 变化、canonical Base32、旧 ID 兼容、`sc1-` 格式错误/语义不匹配 | 验收标准第 3 条（同款六场景清单） | **no-conflict（验收型）** | 逐项对应，验收**执行**既定契约不引入新行为；测试内 VFSL 文本 fixture 属 ADR 0001 L9「测试 fixture 除外」明文许可 |
| 6 | 边界条件 B1 | ADR 0005 D1：「id 是标签不是键：引擎正确性不依赖 id 唯一性……id 的用途是人读标签、管理端谱系追踪、工具链寻址。信封 id ≠ doc 地址」 | `sc1-` 使 envelope `id` 获得可校验的 schema 内容地址身份（不匹配即拒） | **no-conflict（已登记扩展）→ 设计后复核** | 非矛盾：(a) 引擎正确性仍不依赖 id **唯一性**——`sc1-` 校验的是**真实性**（与 text 匹配），同一 schema id 可出现在多 namespace 正是内容寻址要义；(b) 信封 id ≠ doc 地址保持（doc/复制身份是 namespaceId/replicationId，ADR 0010 L50、CONTEXT.md Avoid 清单）；(c) 「工具链寻址」用途枚举涵盖内容寻址。CONTEXT.md 词条已把两制整合为一句（「旧式 SCHEMA id 继续兼容，但任何 `sc1-` id 都必须……精确匹配」）——演进已登记，无 silent override。遗留卫生点：ADR 0015 未对 ADR 0005 该句加显式交叉引用/修订注记；建议 PR #158 收口或 ADR 0015 翻 accepted 时补一行指向（docs/AGENTS.md「Amend or supersede explicitly」精神），避免后续读者把 0005 D1 误读为禁止内容寻址 |
| 7 | 边界条件 B2 | ADR 0015 状态「提议」，随 open PR #158 在途；issue-tracker.md Ticket Parent 约定（设计文档 PR 转任集成 PR，ticket 挂其下、实现与设计同支累积）；`branch.mabf/issue-266` → `docs/rest-namespace-create` | #266 在 PR #158 分支上实现 ADR 0015 的 vfsl 包切片 | **no-conflict（流程既定模式）→ 注记** | 恰是集成 PR 纪律的设计意图（避免「规格已改、实现未跟」污染 main 的中间态）；SA1/SA3 应把 ADR 0015 当 governing 决策设计，不得重开已决条款；阶段收官/合并时应把 ADR 0015 状态由「提议」翻「accepted」（docs/AGENTS.md：`docs/adr/` 记录 accepted 决策）——移交总控在收尾清单登记 |
| 8 | 边界条件 B3 | `packages/vfsl/src/errors.ts`：方言层 21 码冻结注册表（`VFSL-E<编号>:` message 前缀通道，公共 `VfslIssue` 无独立 code 字段）；`packages/vfsl/src/envelope.ts`：信封层独立 `EnvelopeErrCode` 注册表（`VFSL-ENV-E<码>:`，ENV_1–ENV_5/ENV_100，与方言层码空间互斥）；`docs/vfsl/v1-spec.md` §4「错误码共 21 个」 | 「格式错误与语义不匹配各使用一个稳定 VFSL issue code」 | **no-conflict（注册表机制既有）→ 设计期注意** | 新码落点属 SA1/SA3 设计自由度：语义上是 envelope 相位校验，自然落 `VFSL-ENV` 码空间（envelope.ts 既有 append 式注册表），**不触碰** v1-spec §4 冻结的方言层 21 码表（「共 21 个」计数不受影响）；ADR 0008 L131 已声明 envelope 码域为上游注册表不透明透传，runtime 侧零改动。注意点：①ADR 0015 措辞「VFSL issue code」是泛称，实施不得误读为必须挤进方言层 21 码表；②若选择在 `docs/vfsl/` 或信封设计文档记录新码，须同步该规范文档（docs/AGENTS.md「update every normative document whose stated contract changed」）；③窄接口「或 VFSL issues」返回形状沿用既有 `SchemaParseIssue` 判别联合（envelope/vfsl 两 kind）为最自然落点，属设计裁量 |
| 9 | 工程门禁 | `packages/vfsl/AGENTS.md`：公共 API 仅经 `src/index.ts`；「Stable error codes, issue ordering, path reporting, envelope strictness, and fingerprint inputs are compatibility behavior」；公共类型/信封编译/校验行为变更须跑根 `pnpm typecheck` + `pnpm test` | 新增公共窄接口 + envelope 行为扩展 + 新稳定码 | **no-conflict（执行既有纪律）** | 简报全部交付面落在该包契约框架内；指纹输入不变（复用 ADR 0007 已冻语义），新增的是**消费**该指纹的 ID 编码与 envelope 相位规则——兼容性面（既有码/排序/严格性）不得回归，测试矩阵已含旧 ID 兼容回归项 |

裁决分布：no-conflict 9（逐字兑现 3 + 扩展/验收/工程 3 + 边界条件 3），override-declared 0，
evolution 0，hard-violation 0。

## 结论

**Verdict: `clear`** —— 放行，按任务类型路由继续（代码变更面在 `packages/vfsl`，属功能开发：
SA1 设计 → SA2 全维度攻击评审 → SA3/SA4 实现 → SA7 补充审查全链适用；设计后 SA8 复审按惯例执行）。

移交下链的三项边界条件（均不阻塞）：

1. **B1（ADR 0005 交叉引用卫生）**：`sc1-` 对「id 是标签不是键」的扩展已由 CONTEXT.md 词条整合、
   非矛盾；设计后复审核对 SA1 设计未把「id 可校验」外溢为「引擎正确性依赖 id」或「信封 id 参与
   doc/复制身份」；建议 PR #158 收口或 ADR 0015 翻 accepted 时补 0005 交叉注记。
2. **B2（ADR 0015 状态流转）**：SA1 以 ADR 0015 为 governing、不重开已决条款；阶段收官把
   「提议」翻「accepted」并入收尾清单。
3. **B3（新 issue code 落点与规范同步）**：两个新稳定码落 envelope 层注册表（`VFSL-ENV` 码空间）
   为最自然读法，不触方言层 21 码冻结表；「稳定 VFSL issue code」以冻结 message 前缀（或 envelope
   `code` 字段）表达；若新码记入规范文档须同步更新。编号选择、返回联合形状属 SA1/SA3 自由度。

另附三项非阻断登记（供总控/下链知悉，不构成冲突）：

- **ADR 编号空洞 0013**：0012 之后直接 0014，无重号（历史 0012 重号已由 0014-LOG 改号收敛）；
  引用无需消歧。
- **Git 配置残留**：worktree 本地 `mabf.issue=75`、`mabf.branch=fix/issue-137-on-docs-phase-5-websocket-replication`、
  `mabf.base-branch=main` 与本任务不符（疑建仓残留，与 #228 门禁报告所见同款）；分支跟踪
  `branch.mabf/issue-266.merge=refs/heads/docs/rest-namespace-create` 正确指向 Parent PR #158 分支。
  发布/base 推导属 runner 职责，本门禁不改 git 配置。
- **技能可用性**：`sa8-conflict-gate` 技能不在本会话 `.agents/skills/` 目录，本报告按角色章程与
  仓库既有门禁先例方法论执行，裁决口径与前序报告一致。

审查日期：2026-09-08（dispatch `sa-95c5994f-8337-4a51-a5e7-f23f0d011ce5`，iteration 0，前置门禁）。
