# 冲突门禁报告（设计后复审）— issue #237

**被审对象**：SA1 设计 `wiki/raw/task_237_design.md`（round 1；issue #237：ordinary Namespace mutation 用路径级校验替代完整 ROOT 复制与全量校验）
**门禁类型**：设计后复审（SA1 设计产出后，SA2 攻击评审前）
**产出时间**：2026-09-06
**对照基准**：
- `docs/adr/` 全集 11 份（0001–0010、0012；核心相关 0007/0008/0010 本次按设计声明行号逐行核对原文，其余按前置门禁 `task_237_conflict_report.md` + `task_237_relevant_decisions.md` 摘录复核）；
- `CONTEXT.md` 相关词条全文（「逻辑快照校验」「载体投影读取」「重建校验」「零写入」「写序列器」「结构树」「标记类型」「复制未校验」「P0」「active schema」）；
- issue #237 正文 + Owner（welltop-jim-wang）全部 3 条评论（2026-09-05T16:01Z / 2026-09-05T16:08Z / 2026-09-06T02:55Z，gh API 全文重读）；
- 前置门禁：`wiki/raw/task_237_conflict_report.md`（verdict `clear`，E1–E4 强制修订义务）+ `wiki/raw/task_237_relevant_decisions.md`。

**基线核实**（本门禁独立执行，非转抄设计声明）：

- worktree HEAD `9e3f0bf`、branch `mabf/issue-237`，与设计声明一致；引用先例 commit `1c8b907`（docs(adr): document incremental mutation commits）与 `a3e9266`（#236 最小 edit）均在仓。
- SA6 红灯锚复跑（本工作区，后台 Job）：`packages/doc-runtime/test/issue-237-path-localized-validation-red.test.ts` = **41 tests：3 failed（必红）+ 38 passed**，与设计 §19 及 SA6 登记一致；namespace-runtime 红文件 4 用例在场。红因与登记一致（A-1 计数锚、A-2 ok:false）。
- §12 契约缺陷独立复现（探针，tsx + nomicore-source 直读 src，throwaway 脚本即删）：fixture schema `type ROOT = { target: { value: number }; library: YArray<Item> }` 上 `delete ['target','value']` ⇒ `{"ok":false,"issues":[{"message":"缺少必填字段 \"value\"","path":["target","value"]}]}`；且 SA6 测试 L193–L194 确断言 `expect(r3.ok).toBe(true)`。
- 源码锚核对：`mutation.ts:9` 已 `import { extractYjsSnapshot, walk } from './extract.js'`（walk 接缝先例在位）；现行管线 `mutation.ts`（extract→validate 旧→clone→applyToJson→validate 新→prepareCommit→transactGuarded→verifySnapshotIntact）与设计 §2 逐行一致；`extract.ts:91/160/187`（walk/walkUnion/trialMember + 逐 kind carrierOf 判定）；`validate.ts:658`（validateSubtree）；`validate-patch.ts` 四公共导出（L611/627/643/667）与 §3.3 五规则（L298/L429–460「按优先级命中即止」）在场；`fatal-contract` 用例「ROOT 已损坏→普通 mutation 失败」在该测试 L209 在场；ADR-0003 L53「最近的结构边界重建整值」与 phase-2 H2 在场。

## Verdict

`clear`

设计全部实质决策点落在前置门禁 `clear` 裁决已授权的演进包络（E1–E4）与 Owner 三评论明文授权之内；**无新增冲突点、无 hard-violation、无 override 需求**。附 1 项移交 SA2 裁决的条件项（C1）与 4 项实现期强制条件（C2–C5）。放行进入 SA2 攻击评审。

## ADR 盘点（设计后逐份对照）

| 编号 | 相关 | 对照结论 |
|---|---|---|
| 0001 | 弱 | no-conflict：不触及 schema 文本、信封、方言冻结、编译缓存、ROOT/SCHEMA 命名（沿用前置门禁结论，设计 §6 只加运行时库函数） |
| 0002 | 弱 | no-conflict：「结构 → 值 → 单事务提交」三步形状保持（S3–S7 结构/值前置 + S8 单事务） |
| 0003 | 相关 | no-conflict（正向对齐）：「最近的结构边界重建整值」本即其关联统一写入管线（§7）与 phase-2 H2 既定能力；R1–R6 是该能力向 mutation 词表的映射 |
| 0004 | 弱 | no-conflict：D1/D5 编译期投影轨道无交集；运行时侧消费不动 |
| 0005 | 无 | no-conflict |
| 0006 | 相关 | no-conflict：saveDoc=脏通知、Y.transact 单事务原子性锚面不动（P5） |
| 0007 | **核心** | **evolution（E1，前置门禁已裁决）**：设计的管线改写/前置假设/损坏条款收窄/提交后边界验证全部落在 E1 登记的修订义务内，且 §14 E1 修订文本逐条对应 E1 要求（管线句、前置假设、损坏收窄、成本模型、等价测试硬前置）。分层条款（vfsl 无 Yjs、零写入、observer no-rollback、不公开跨时间 prepared mutation）全部保持 |
| 0008 | **核心** | **evolution（E2）**：仅镜像句同步；设计 §14 E2 明确「其余不动」——槽序、active schema at slot、非空路径不重建完整 ROOT、SCHEMA write 全量、fatal、封装边界、status 观测面逐项保持（§7.5/§9） |
| 0009 | 相关 | no-conflict：唯一 Runtime/sequencer 不变量保持（namespace-runtime 零源码改动）；create 全量校验合法性建立点不动（§3.1） |
| 0010 | **核心** | **evolution（E3）**：L107 后备句按 E3 收窄 + follow-up 显式登记（replication 合法性重建另票 + carrier 覆盖面审计）；同段「不得先 apply 后回滚」与设计 S3–S7 先于事务完全同向 |
| 0012 | 无 | no-conflict |
| CONTEXT.md | **核心** | **evolution（E4）**：三词条修订（逻辑快照校验/复制未校验/载体投影读取）与前置门禁 E4 逐条对应；「重建校验」交叉引用为可选项，不加不改亦不冲突 |

## 冲突点

| # | 严重度 | 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| （无新增） | — | — | — | — | — |

无新增冲突点。前置门禁 E1–E4 四项 evolution 为本设计唯一触碰的 ADR/CONTEXT 演进面，且设计的 §14 修订方案逐条兑现其强制义务，无超范围、无静默项。

## 逐项裁决（按派发令清单）

### D1 局部 boundary pipeline（§3.3 R1–R6 / §4 S0–S10）— 符合授权

- Owner 2026-09-05T16:01Z 逐条兑现：删热路径旧 ROOT `validateLogicalSnapshot`（S3–S6 无此调用）；无 baseline 状态机（§3.1 明示）；只提取/重建/校验最近必要语义边界（S5/S6）；schema 要求时退化到 ROOT（R1/R5 上界 + set([]) legacy）。
- §4 S0–S10 与 issue 正文「建议设计」8 步、Owner 2026-09-05T16:08Z §5 九步逐一对位（导航+逐跳 carrier 检查→边界→局部投影→detached 模拟→VFSL 边界校验→detached 构造→最小 guarded transaction→仅受影响边界验证）。
- R1–R6 与 `validate-patch.ts` §3.3 五规则优先级语义一致（「按优先级命中即止」原文核对）；R3（数组下标 replace）声明词表不适用并以现行 `applyToJson` 拒绝域保持——行为保持，非新语义。
- 等价性硬前置（ADR-0007 L59「继续优化完整校验成本时必须保留行为等价测试」）由 SA6 A-6 28 场景绿锁定承载；L1–L3 引理为 SA2 主攻击面（设计 §17-1 已自认），属设计质量审查而非冲突。

### D2 carrier navigation（§4 S4 / §7.2）— 符合授权

- Owner 2026-09-05T16:08Z §3「沿路径导航时仍应检查所经过的局部 carrier。这既是安全导航要求，也是避免错误 carrier 被当作 schema 合法值处理的必要条件」：S4 逐 hop union 仲裁 + 载体检查 + 中间在场检查 + 终段规则，逐项兑现。
- 分层（同评论 §2）：vfsl 保持无 Yjs（§6.4）；carrier 校验单源于 doc-runtime（§7.2）；「不应仅为 carrier 校验而让 VFSL 核心直接依赖 Yjs」满足。Owner 提议的 `validateDocument`/`validateMutationBoundary` 内部接口名为「可考虑」非强制；设计以 vfsl 纯函数规划 + doc-runtime 组合的替代布置满足同一分层原则，不构成偏离。
- 前置假设双半边（logical values + carrier topology）写入内部契约与测试前置（§3.1、SA6 L115–L121 前置断言在场）——Owner 评论 1/评论 2 §3 均兑现。

### D3 VFSL 扩展（§6）— 符合授权；公共 API 面裁决如下

- **授权来源**：issue 正文明文「应优先复用或扩展，而不是在 doc-runtime 重复实现 schema 解释逻辑」——扩展 validate-patch 家族是任务指定路径，非擅自扩面。四个既有公共导出签名与行为逐字节不变 + 既有测试全绿为硬前置（§6.1）；新增 2 函数 + 3 类型纯 additive；不引入 Yjs/carrier 概念（ADR-0007 L22「vfsl 继续保持无 Yjs 依赖」保持）。
- **「不允许扩大 public API」裁决**：该约束保护的是 Nomicore 消费面——`mutateData()` 公共 interface 与结果联合（issue AC#1）、namespace-runtime 源码、doc-runtime `index.ts`、公共事件订阅（ADR-0008 status 观测面条款）、instrumentation 面（前置门禁 #11 约束）。设计对上述全部零改动（§7.5/§15.3），测试内 seam 与 throwaway harness 属明示豁免。vfsl 包内新增导出是兄弟包间的构建期接缝，经既有 `@nomicore/vfsl` 公共包入口消费（与 `validateLogicalSnapshot` 同通道，包边界纪律不变），且为 issue 明文指定的「复用或扩展」落点——**不构成违规扩面**。长期契约命名/形状评审移交 SA2（设计 §17-8 自认，属设计质量项）。
- **TOCTOU 裁决**：`planMutationBoundary` 是 (derived, path, op) 的纯函数、零 base 读、零文档状态（§6.2），非「可跨时间执行的 prepared mutation」；ADR-0007 L27 该条款针对 mutation 公共面，设计未在任何公共面暴露跨时间 prepared 状态（S3–S8 同步同槽内闭环）——条款保持。

### D4 set([]) full-ROOT fallback（§4 S2）— 符合授权

- ADR-0007 L27「只有 `set([])` 走完整 ROOT 清空与重装」、L33 整体替换语义、ADR-0008 L47「唯一清空并重装完整 ROOT 的 mutation，不作为普通消费模式」——legacy 全量管线原样保留（含 verifyInstall + verifySnapshotIntact），条款字面保持。
- R1/R5 顶层退化 O(ROOT) = issue AC「schema 语义要求更大上下文时，能够安全退化到更高边界直至 ROOT」明文授权，且常数优于现状。

### D5 最小 edit 单事务（S8）— 符合授权

- S8 = 现行 `commitPrepared` + `transactGuarded` 原样（ADR-0007 `1c8b907`「只修改目标 carrier……不重建无关 carrier」保持；E203 包装不变）；每笔成功恰 1 transaction、1 dirty、1 owned update（P2/P3/P5 证据链）；carrier identity 由 B-1/B-4 锚定。提交面零新语义。

### D6 E1–E4 文档修订（§14）— 与前置门禁强制义务逐条对齐

| 义务（前置门禁结论） | 设计 §14 落点 | 对齐 |
|---|---|---|
| E1 ADR-0007：管线句 + 前置假设 + 损坏条款收窄 + 成本模型 + 等价测试前置 | E1 四点全含，含 §3.1 原文入 ADR | ✔ |
| E2 ADR-0008：仅镜像句同步，其余不动 | E2 明示「其余不动」并逐项列举 | ✔ |
| E3 ADR-0010 L107 收窄 + follow-up 显式登记（合法性重建另票 + carrier 审计）不得静默留白 | E3 两项 follow-up 全登记 | ✔ |
| E4 CONTEXT 三词条修订 | E4 全含（「重建校验」交叉引用为可选，不加不冲突） | ✔ |
| 修订模式：owner 授权 + 显式修订节（docs/AGENTS.md「Amend or supersede prior decisions explicitly」；ADR-0006 #64/#79、ADR-0008 #93/#132 先例） | §14 明示按先例追加修订节并引用授权链 | ✔ |

### D7 follow-up 登记（§1 非目标 + §14 注册面）— 完整

replication/损坏存量/不可信恢复合法性重建另票（评论 1）；carrier validation 覆盖面审计（评论 2 §1/§6）；MABF 集成方 origin/path instrumentation 另行确认（评论 3）；lazy cursor/overlay 待局部投影被证明瓶颈后再议（评论 2 §5）。四项全登记，无静默让渡。

### D8 #238 归因纪律 — 符合

Owner 2026-09-06T02:55Z「现已另开 #238 专门调查……不能把它直接归因于本 Issue」：设计 §1.7 明示不归因；§15.3 benchmark 仅引用冻结 wire 计数测试对照，不把 Peer apply 2–11s 阶梯归入本票。

### D9 测试面变更（§12/§13，本设计新登记，前置门禁未逐字覆盖）— 授权裁决

- **§12 SA6 红灯锚缺陷修订 — 授权（契约缺陷修复，非语义让渡）**。证据链三重独立成立：(a) 本门禁探针复现 delete 必填字段 ⇒ ok:false（缺少必填字段）；(b) ADR-0007 L35 明文「delete 禁止 ROOT、required 字段和数组下标；只允许 optional 字段与 Record 动态键」——SA6 断言 `r3.ok===true` 与 ADR 词表本身矛盾；(c) A-6 oracle 绿锁定同形 schema 下该决策为 ok:false。任何行为等价实现均不可满足该断言。设计的最小修订（optional 字段或 Record 键 delete 腿）保持锚数（3 必红/38 绿 + 1 必红/3 绿）与计数锚语义，方向是**向 oracle 一致性收敛**；设计同时明令禁止以放宽 delete 语义满足断言（正确——否则击穿 A-6 与 operations 既有用例）。
- **§13 fatal-contract 领域用例修订 — 授权（E1 已声明的语义演进之测试面落地）**。该用例（L209「ROOT 已损坏→普通 mutation 失败」）在 E1/E3 收窄后必然转 ok:true，属前置门禁 E1「损坏条款收窄」的直接后果；修订方向（损坏移入边界内，保持「领域失败不入 fatal 通道」W5 意图）与授权一致；fatal 契约面其余用例（E203、identity、不虚假回滚）不受影响。

## Schema / 契约 / 安全 / 进程边界变化 — 显式裁决（派发令要求）

1. **Schema 边界：无变化**。不改 schema 文本、信封、方言、编译缓存、ROOT/SCHEMA 命名（ADR-0001 保持 no-conflict）。vfsl 扩展是运行时库 API，不是 schema 语言面。
2. **消费契约：一项已声明演进，其余零变化**。唯一可观测语义变化 = 无关分支既存非法数据不再被普通写发现（ok:false→ok:true）——即 E1/E3 已裁决、Owner 已授权的声明语义，且以测试锚定「已声明而非疏漏」（A-2/B-3）。interface/结果联合/FIFO/槽序/零写入/dirty 语义全部不变（§9 不变项表逐项有锚）。
3. **安全边界：不削弱**。校验全部先于事务（S3–S7 先于 S8，禁 write-then-undo——Owner 评论 2 §4/ADR-0007/ADR-0010 三方同向）；无 baseline 状态机（评论 1 明令）；TOCTOU 面不新增（D3）；fatal 不削弱——E201 变体 C/D 保持 committed:true、不回滚、绝不假成功（变体 D 强化了「防线未能运行必响亮」）；§7.3 导航载体违规归领域 ok:false 是**行为保持**重分类（现行 E204 抛点在 extract 之后不可达；可观测 A-4 现绿行为 ok:false 不变），E204 保留给手造派生物。
4. **进程/包边界：不扩大**。doc-runtime `index.ts` 零改动、namespace-runtime 零源码改动、vfsl additive（D3 裁决）、`verifyBoundaryIntact` 仅内部导出不进 index（walk 接缝先例）；instrumentation 零公共 API/事件/导出面（§15.3）；throwaway harness 走 `.mabf-bg/`（gitignore 已核实）。

## 条件项（移交 SA2 / SA3 / SA4，不阻塞放行）

- **C1（移交 SA2 裁决，设计 §17-4 自认）**：R6 set 目标位「旧值不读」与 §14 E1 损坏句草稿（「边界内损坏仍响亮失败」）存在措辞-行为缺口：目标位恰为边界时，被替换旧载体若违规将被静默整值替换（修复语义）而非拒绝。phase-1 前置假设下该状态出契约，但 E1 修订文本与实现行为必须二择一致：(a) S4 终段对**在场** set 目标加形态检查（拒），或 (b) 绿锁定补「set 替换损坏载体位=修复成功」锚并在 E1 显式声明。两者均在授权包络内，本门禁不强制择向；E1 措辞必须与所择行为逐字一致，禁止留下「边界内损坏仍拒」的字面承诺与 R6 行为相抵。
- **C2（SA3）**：§12 锚修订执行最小方案（optional 字段或 Record 键 delete 腿），保持 3 必红/38 绿 + 1 必红/3 绿结构与三计数锚；dispatch log 登记；严禁放宽 delete 词表。
- **C3（SA3/SA4）**：§13 用例修订须在用例注释引用 Owner 2026-09-05T16:01Z + ADR-0007 修订节；fatal 契约面其余用例零改动。
- **C4（SA4）**：若 E201 变体 C/D 引入新稳定码字面量，须按 ADR-0008「稳定码注册修订」节的 append-only 注册表纪律落在 `errors.ts` 定义处注册表；E204 注释与 E1 措辞同步（设计 §17-5）。
- **C5（SA3 证据报告，非门禁义务）**：Owner 评论 3「sequencer 占用」对比以槽内领域校验时长收缩定性承载（§15.2），可接受（#238 拥有延迟归因）；证据报告应保留该定性说明与「完整 ROOT 投影次数=0」旁证，不引入墙钟归因。

## 结论

**Verdict：`clear`** — SA1 设计放行进入 SA2 攻击评审。设计的局部 boundary pipeline、carrier navigation、VFSL additive 扩展、set([]) full-ROOT fallback、最小 edit 单事务、E1–E4 修订与 follow-up 登记全部落在 issue #237 正文 + Owner 三评论 + 前置门禁 E1–E4 授权包络内；无公共消费 API 扩面、无 #238 归因、无 schema/wire/安全/进程边界越权变化；新增测试面变更（§12/§13）经独立证据核验裁为授权修订。SA2 按设计 §17 攻击面清单 + 本报告 C1 继续评审。
