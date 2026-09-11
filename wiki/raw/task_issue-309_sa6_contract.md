# SA6 验收契约 — issue #309（v1-spec §5 与编写指南落地 M4 挂载锚位）

- Dispatch：`sa-076438d2-c91f-4b23-9583-b6a93608fbb7`（mabf-sa6 / acceptance-contract / iteration 0）
- 任务类型：**文档面能力缺口（Feature 口径：规范/指南未落地已实现的 M4 四锚位）+ 实现行为回归契约**。不虚构 bug 根因——parser/evaluator/codegen 的 M4 行为已由 #306/#307/#308 落地且与本契约实测一致；缺口在规范正文、编写指南、检查表、源码/测试注释措辞与规格检查器机器契约。
- 证据基线：worktree `/home/wangjian/nomicore-fix-issue-309`，分支 `mabf/issue-309`，HEAD `bbb93fbda3100b2da2a007a228af777cdc56d282`（#306/#307/#308 均已合入）。
- 本报告范围：诊断 + 可执行验收契约。**按派发指令，SA6 本轮不实现、不编写测试、不改生产实现**——第 12 节给出可直接转写的契约（测试路径、逐用例断言、fixture 文本、冻结观察值、运行入口），由实现票/设计票落地。
- 结论预告：**approve** —— 文档缺口稳定复现（9 个非 wiki 追踪文件、14 处措辞 + v1-spec §5 / 指南 §7/§8 / 检查表逐项与实现矛盾），红因单一且由控制变量矩阵归因；负控（实现行为、金样本、E305 维持面、无 M4 键缺席）当前全绿；契约入口真实（`pnpm test` → CI 分片）、可执行、对错误实现敏感。

---

## 1. Task type and inputs

| 输入 | 位置 | 关键内容 |
|---|---|---|
| Host task brief | `wiki/raw/task_issue-309.md`（未跟踪，Host 所有） | What to build：v1-spec §5 修订为**四类锚位**（M4 子规则：`\|` 锚位、首成员起点锚位、连续 doc 同挂、坍缩维持 E305、`\|` 夹缝与 M3 优先的不对称注明），挂载示例补联合成员样本；schema-authoring-guide 第 7/8 节补逐成员 doc 写法与示例、检查表同步；源码与测试注释「三锚位」措辞清扫为四锚位 |
| Issue #309 REST | `gh issue view 309 --json state,labels,comments` → `{"comments":[],"labels":[{in-progress}],"state":"OPEN"}` | **无 Owner 追加要求**；需求全集 = What to build + 4 条 AC |
| 权威决策 | `docs/adr/0019-vfsl-union-member-docs.md`（accepted 2026-09-11） | 决策 1（M4 子规则）、2（坍缩维持 E305）、3（M3 优先/夹缝不对称）、9（只增不改）；**Consequences 明列「文档：v1-spec §5 挂载规则修订…随实现 PR 落地；schema-authoring-guide 第 7/8 节与检查表同步」** |
| 前置实现（已合入） | `packages/vfsl/src/{parser,ir,semantic,derived,evaluate,resolve-schema-at-path}.ts`、`packages/vfsl-codegen/src/emitter.ts` | M4 解析/IR/派生/投影/codegen 四发射位全部落地（#306/#307/#308） |
| 规格检查器 | `tests/acceptance/vfsl_spec_acceptance.py`（issue #4 机制，纯标准库）+ `tests/acceptance/exemplar/spec-exemplar-v1.md` | 机器契约硬编码「挂载目标: 类型别名 / 属性 / 标记类型」（L34）与 G10 need 列表（L477–478）；#306 设计冲突报告 **O-3**：「#309 修订 v1-spec §5 时必须同支更新该检查器与 schema-authoring-guide，否则 C-1 违反」 |
| 缺失输入（记录） | `wiki/raw/task_issue-309_{relevant_decisions,conflict_report}.md`、`task_issue-309_sa8_conflict.md`、`task_issue-309_design.md` | **均不存在**（工作树内无 #309 的 SA8/设计/决策登记产物）。契约改由 brief + ADR 0019 + #306 登记的 O-3/C-1 推导；不构成阻塞（派发指令要求读固定 brief 后直接产出），但设计票须补 SA8 门禁 |
| 环境 | Node `v24.13.0` / pnpm `10.28.2` / Python `3.12.3` | `pnpm install --frozen-lockfile --offline` → 65 包全部复用本地 store，exit 0（476ms） |

**需求全集（AC 逐条）**

- AC1：v1-spec §5 的挂载规则、边界行为与实现逐条一致（含 E305 既有场景不变的明确表述）。
- AC2：编写指南的枚举/联合示例使用逐成员 doc，检查表覆盖 M4。
- AC3：全仓「三锚位」措辞无残留（dist 产物除外）。
- AC4：`git diff --check` 干净。

## 2. Owner comment mapping

Issue REST 实测（本轮直接调用 `gh`）：`comments: []`、`state: OPEN`、`labels: [in-progress]`。无 Owner 追加要求，无 owner-comment 硬性约束。契约必达项全部来自 Issue body（What to build + 4 AC）与 ADR 0019 Consequences；报告不引入超出该范围的强制项（唯一超出 AC 的项目是 §12.4 的 G16 陈旧期望修复，明确标注为验证器维护项并给出可选处置）。

## 3. SA8 constraints

**#309 无 SA8 冲突门禁产物**（`task_issue-309_sa8_conflict.md` 不存在）。契约以三条已登记约束承接：

| 来源约束 | 本契约落点 |
|---|---|
| ADR 0019 Consequences「文档面随实现落地，避免『规格已改、实现未跟』中间态」 | D1/D2（v1-spec §5 四锚位 + 联合成员示例）、D3（指南 §7/§8） |
| #306 `_design_conflict_report.md` **O-3**（#306 设计门禁登记）：#309 必须同支更新 `tests/acceptance/vfsl_spec_acceptance.py` 与 schema-authoring-guide | §12.4（检查器 G10/G17 + docstring + exemplar 同步） |
| `docs/AGENTS.md`：代码行为变更须更新所有契约已改的规范文档；文档措辞变更不得虚构实现行为；检查链接与陈旧术语；跑 `git diff --check` | D5（措辞清扫 + diff 卫生）、§12.3（不新增实现行为，只描述已实测行为） |

## 4. Environment and baseline

| 项 | 值 / 命令 | 结果 |
|---|---|---|
| HEAD / 分支 | `bbb93fbda3100b2da2a007a228af777cdc56d282` / `mabf/issue-309` | #308 已合入 |
| 依赖 | `pnpm install --frozen-lockfile --offline` | exit 0（65 包，离线 store 复用） |
| **实现基线（必须保持）** | `NODE_OPTIONS=--conditions=nomicore-source pnpm vitest run packages/vfsl/test/parse-vfsl-union-member-docs.test.ts packages/vfsl/test/evaluate-derived-member-docs.test.ts packages/vfsl/test/resolve-schema-at-path-member-docs.test.ts packages/vfsl-codegen/test/generate-union-member-docs.test.ts` | **4 files / 68 tests passed；Type Errors: no errors；exit 0**（3.44s） |
| 规格检查器基线 | `python3 tests/acceptance/vfsl_spec_acceptance.py` | **20/21，RED：`G16 fixture 构造覆盖 — 缺少 AssetsDoc`（exit 1）** ← 预存在陈旧期望，见 §11.5 |
| 类型面基线 | `pnpm typecheck`（14 个 tsconfig） | exit 0 |
| 生成物新鲜度基线 | `pnpm generate --check` | exit 0（`domains/*/generated.ts` 无过期/缺失） |
| 检查器绿路径 | `python3 tests/acceptance/vfsl_spec_acceptance.py --spec tests/acceptance/exemplar/spec-exemplar-v1.md` | 21/21 GREEN（exit 0）——检查器本身可用 |
| 卫生基线 | `git diff --check` | exit 0（干净） |
| 生产实现改动 | `git status --porcelain` | 仅 Host brief 未跟踪；SA6 未改任何生产/规范文件（临时探针收尾删除，见 §16） |
| 措辞残留 | 全仓 grep（排除 wiki/node_modules/dist） | 「三锚位」**14 处 / 9 个追踪文件**（§5.4） |

## 5. Positive reproduction（能力缺口：文档面与实现矛盾）

### 5.1 现行规范/指南文本（矛盾对象）

- `docs/vfsl/v1-spec.md:405–409`：「挂载到紧随其后…的**声明性节点**，**三类**：**类型别名**（声明处）、**属性**（对象字段处）、**标记类型**（Marker 记号处）。连续多个文档注释按出现顺序全部挂载到同一后续节点。若直到模块末尾都没有可挂载节点 → VFSL-E305」——**无「联合成员」，无 M4 子规则，无坍缩/夹缝边界表述**。
- `docs/vfsl/v1-spec.md:414–424` 挂载示例表＝附录 fixture 7 条 doc，**无联合成员样本**；§5 内**零个 `vfsl` 围栏块**（唯一 `vfsl` 块在 §10 附录）。
- `docs/vfsl/schema-authoring-guide.md:204`：「JSDoc 必须紧邻类型别名、对象字段或标记类型才能挂载」——三锚位表述。
- 指南 §7（L152–164）`type Asset = | {kind:"image"…} | {kind:"text"…};` 与 §8（L182–202）`type Status = | "draft" | "submitted";` 示例**均无逐成员 doc**。
- 提交前检查表（L273–287）**无 M4/逐成员 doc 条目**。

### 5.2 文档声明 ↔ 实现观察的逐条矛盾（公共入口实测，HEAD bbb93fb）

| # | 现行文档声明 | 实现实测（`parseVfsl`/`evaluate`） | 判 |
|---|---|---|---|
| 1 | §5「三类」声明性节点，成员 doc 无锚位 → E305 | `type T = /** d */ "a" \| "b";` → `ok:true`，`memberDocs=[[" d "],[]]` | **矛盾** |
| 2 | 同上 | 多行前导 `\|`：`ok:true`，`memberDocs=[[" 草稿…"],[" 已提交…"],[]]` | **矛盾** |
| 3 | 同上 | doc 紧邻 `\|` 之前：`ok:true`，`memberDocs=[[],[" 乙 "]]` | **矛盾** |
| 4 | 同上 | 连续两 doc 同挂成员 0：`memberDocs=[[" 一 "," 二\n * @tag "],[]]` | **矛盾** |
| 5 | 指南 L204 三锚位挂载目标 | E305 消息正文已是「类型别名 / 属性 / 标记类型 / **联合成员**」四类 | **矛盾** |
| 6 | 指南 §7/§8 示例无逐成员 doc | 逐成员 doc 形态实测 `ok:true` 且派生 `memberDocs` 逐字在场（`Status.<member N>`/`Asset.<member N>`） | **指南落后** |

### 5.3 交付物红灯矩阵（现行文档在本契约断言处全红）

| 断言组 | 现行状态 | 实测红因 |
|---|---|---|
| D1 §5 四类锚位 + M4 子规则结构性陈述 | **红** | §5 含「三类」，无「联合成员/M4」；G17 的 9 项子规则 **0/9** 命中（§9 X5） |
| D2 §5 联合成员挂载示例存在且可执行 | **红** | §5 `vfsl` 块 0 个；无联合成员样本 |
| D3 指南 §7/§8 示例逐成员 doc 且可执行 | **红** | §7 示例成员 doc 0 条；§8 示例成员 doc 0 条 |
| D3b 指南 L204 挂载目标含「联合成员」 | **红** | 现文为三锚位句 |
| D4 检查表覆盖 M4 | **红** | 检查表无联合/枚举逐成员 doc 条目 |
| D5 「三锚位」措辞清扫（wiki/dist 除外） | **红** | 14 处 / 9 文件 |
| G10（检查器，扩展后）§5 含「联合成员」 | **红** | `need` 列表（L477–478）与 docstring（L34）均为三锚位机器契约 |
| G17（检查器，新增）§5 M4 子规则结构化契约 | **红** | 9 项子规则 0/9 命中（模拟落地后 9/9 绿，§9 X5） |
| G16（检查器，预存在）fixture 构造覆盖 | **红（预存在）** | §10 fixture 已由 ROOT 约定改名 `AssetsDoc→ROOT`，检查器 L321 仍期望 `AssetsDoc`——**与 #309 无关的陈旧测试期望**，见 §11.5 |

### 5.4 「三锚位」残留清单（全仓 tracked，排除 `wiki/**` 与 `dist/`）

| 文件 | 行 | 性质 |
|---|---|---|
| `docs/adr/0019-vfsl-union-member-docs.md` | 60 | 规范文档（比较性表述，唯一 docs 命中） |
| `packages/vfsl/src/parser.ts` | 174, 519 | 源码注释 |
| `packages/vfsl/src/semantic.ts` | 5 | 源码注释 |
| `packages/vfsl/src/ir.ts` | 59 | 源码注释 |
| `packages/vfsl/test/parse-vfsl-union-member-docs.test.ts` | 5 | 测试注释（「现行 §5 三锚位」已因 #309 变更而失效） |
| `packages/vfsl/test/evaluate-derived-docs-audit.test.ts` | 59 | 测试注释 |
| `packages/vfsl/test/parse-vfsl-cycle-detection.test.ts` | 11 | 测试注释 |
| `packages/vfsl/test/evaluate-derived-docs-typecls.test.ts` | 70, 119 | 测试注释 + describe 标题 |
| `domains/vfs3-assets/test/vfs3-assets-tsdoc.test.ts` | 3, 9, 70, 126 | 测试注释 + describe 标题（4 处） |

`wiki/` 内含该词的**追踪文件 25 个**（历史 MABF 产物），另有未跟踪的 Host brief。**AC3 的「全仓」边界见 §12.8 B1**：历史证据必须保留（`docs/AGENTS.md`：wiki/raw 是证据不是规范；且 #309 自身的 SA6/SA7/SA8 报告必然引用该词），故措辞断言的作用域 = 全部追踪文件 − `wiki/**` − `dist/`。

## 6. Negative control

以下控制在**当前即绿**，落地后必须保持绿（全部为运行时/文件级可观察断言，无源码字符串代理）：

| 控制 | 内容 | 当前实测 |
|---|---|---|
| N1 实现行为回归 | 既有 M4 四套件（解析 13 + 派生 6 + 投影 16 + codegen 33） | **4 files / 68 tests 绿；Type Errors 无** |
| N2 金样本逐字节 | `SPEC_FIXTURE`/`FIXTURE_B` 的 IR sha256 与 semantic 指纹常量（`parse-vfsl-union-member-docs.test.ts`） | 绿（#306 契约常量在场） |
| N3 E305 维持面 | 坍缩两形态 E305@(2,10)、夹缝非标记 E305@(2,16)/(4,5)、前导 `\|` 夹缝 E305@(2,12)；前缀 `VFSL-E305: ` 冻结 | 全绿（实测 §13 表） |
| N4 M3 优先不双挂 | `/** 成员口径 */ \| /** 载体口径 */ YLeaf<"a"> \| YLeaf<"b">` → 载体 doc 仅进 marker docs，成员 doc 仅进 memberDocs | 绿（`memberDocs=[[" 成员口径 "],[]]`，`markerDocs=[[" 载体口径 "],[]]`） |
| N5 无 M4 输入惰性 | 无成员 doc 的联合：IR 无 `memberDocs` 键；§10 fixture 派生 `memberDocs={}` | 绿（键 absent；spec-block 派生空表） |
| N6 存量生成物 | `pnpm generate --check` 新鲜（codegen 套件内 387ms 用例）与 `domains/*/generated.ts` 零改动 | 绿 |
| N7 检查器其余项不受 §5 追加影响 | 模拟目标 §5（含新增 `vfsl` 示例块）下 G1–G15 全绿 | 绿（§9 X1–X4：E3 = 21/21） |
| N8 历史证据不被改写 | `wiki/**` 不进入本票 diff；措辞断言排除该目录 | 基线：`git status` 无 wiki 追踪文件改动 |

## 7. Stability, scale and timing

- **确定性**：临时探针（§16）连跑两次，stdout **sha256 完全相等**（`943ef179…`），差异为空；解析/派生为同步纯函数，无服务、无时钟、无并发面、无 I/O（仅文档读取）。
- **复现率**：100%（文件级 + 纯函数级断言，无竞态面）。
- **规模**：文档 3 份（v1-spec 535 行 / 指南 287 行 / exemplar 164 行）+ 9 个文件的措辞扫描（`git ls-files` 约 1.4k 追踪文件）；断言毫秒级，无超时竞争者。
- **时序/规模条件**：不适用（无异步、无性能面）；探针与套件运行时长：M4 四套件 3.44s，探针 <2s，检查器 <1s。

## 8. Root-cause chain / capability gap

| Step | Fact | Evidence | Confidence |
|---|---|---|---|
| 症状 | v1-spec §5 与编写指南仍表述三锚位；源码/测试注释 14 处残留；规格检查器机器契约未扩展 | §5.1/§5.3/§5.4 | 高 |
| 直接故障点 | 文档三面（v1-spec §5、指南 §7/§8+检查表、检查器/exemplar 机器契约）未随实现修订；M4 行为已可观测（`memberDocs` 全链路在场） | §5.2 实测矛盾表；A–L 探针 | 高 |
| 触发条件 | 任何读者/工具按现行 §5 解释 M4 文本（声明 E305）或按检查器契约核验规格时立即暴露；`tests/acceptance/vfsl_spec_acceptance.py` 现行仅查规格文本，故对实现漂移无感 | §9 X1–X5 | 高 |
| 最深根因 | 特性被拆成实现票（#306/#307/#308）与文档票（#309）且同支累积；#306 设计冲突报告 **C-5/O-3 已显式把规格与检查器同步划归 #309**，属**已登记的计划性缺口**（非回归 bug）：文档面未落地前的中间态被设计接受 | `task_issue-306_design_conflict_report.md` L34/L49；ADR 0019 Consequences | 高 |
| 放大因素 | ① 规格检查器未接入 CI/package scripts（全仓唯一引用在 exemplar 头注），漂移可长期静默；② `wiki/**` 历史证据合法保留旧词，使 AC3「全仓」需要精确边界，否则会诱导改写历史或漏扫 | CI 无引用（grep）；25 个 wiki 追踪文件命中 | 高 |
| 未证实假设 | 无遗留：M4 全链路在场性、边界行为、检查器敏感度、文档示例可执行性全部实测闭口（§9） | — | — |
| 排除项 | ① 实现仍三锚位 → 68 tests + A–L 探针证否；② 文档已落地 → §5.1 原文证否；③ 需改生产代码才能让新示例合法 → 目标示例（含 `YXmlFragment` 联合成员）在现行实现下已全绿（L2）；④ 红因是环境/夹具/入口 → 基线 68 tests 绿、检查器 exemplar 21/21 绿、探针确定性相等 | §9/§13 | 高 |

**能力缺口一句话**：ADR 0019 授权的 M4 四锚位只在实现面落地；规范/指南/检查器的**规范文本面**与**注释措辞面**停留在三锚位，形成「实现已四锚位、规格仍三锚位」的中间态。

## 9. Causal experiments（控制变量矩阵）

全部实验在 `/tmp` 沙箱副本上进行（SA6 未改仓库内任何规范/检查器文件）；实验脚本收尾删除（§16）。

| # | 实验 | 观察 |
|---|---|---|
| X1 | 扩展检查器（G10 need 增「联合成员」）× 现行 spec | exit 1：`G10 缺失要素: 联合成员` + 预存在 `G16 缺少 AssetsDoc` |
| X2 | 扩展检查器 × 模拟目标 spec（§5 四类锚位 + M4 子规则 + 一个 `vfsl` 联合成员示例块） | exit 1：**仅** `G16 缺少 AssetsDoc`（G10 转绿；G1–G15 全绿） |
| X3 | 扩展检查器 + G16 期望 `AssetsDoc→ROOT` × 模拟目标 spec | **exit 0 / 21 项全绿**——证明 §5 新增 `vfsl` 示例块不破坏 G15/G16 的 fixture 覆盖语义 |
| X4 | 扩展检查器 + G16 修复 × 现行 spec | exit 1：**仅** `G10 缺失要素: 联合成员`——红因单一、精确归因于 M4 措辞缺席 |
| X5 | G17（§5 M4 子规则 9 项结构化契约）× 现行 spec / 目标 spec | **9/9 红**（四类、联合成员、前导 `\|` 锚位、首成员起始记号、连续同挂、坍缩 E305、夹缝 E305、M3 优先不双挂、E305 既有场景不变）→ **9/9 绿** |
| X6 | 目标指南示例可执行性（现行实现） | §7 目标形态（含 `YXmlFragment` 成员）+ wrapper → `ok:true`，`memberDocs={"Asset.<member 0>":[" 图片资产 "],"Asset.<member 1>":[" 文本文档 "}`；§8 目标形态 → `ok:true`，`Status.<member 0/1>` 逐字在场 |
| X7 | 无 M4 惰性 / M3 优先对照 | 无 doc 联合 IR 无 `memberDocs` 键；`\|` 前 doc → 成员表、`\|` 后夹缝 marker doc → M3、不双挂 |

**红因非环境/夹具/入口错误的证据**：X4 的单红（G10）与 N1/N7 的绿并存；X3 证明目标文本在检查器其余 20 项下安然；X6 证明目标示例在**现行实现**下无需生产改动即成立。

## 10. Impact surface

| 面 | 变更 | 证据/落点 |
|---|---|---|
| `docs/vfsl/v1-spec.md` §5（L390–425） | **改**：四类锚位 + M4 子规则 + E305 维持面明确表述 + 联合成员挂载示例 | ADR 0019 §1/§2/§3；D1/D2 |
| `docs/vfsl/schema-authoring-guide.md` §7/§8 + 检查表 + L204 | **改**：逐成员 doc 写法与示例；挂载目标句补联合成员；检查表补 M4 条目 | Issue AC2；D3/D3b/D4 |
| `tests/acceptance/vfsl_spec_acceptance.py` | **改**：docstring L34、G10 need L478 增「联合成员」；新增 G17（§5 M4 子规则 9 项）；G16 L321 期望 `AssetsDoc→ROOT`（维护项） | #306 O-3；§12.4 |
| `tests/acceptance/exemplar/spec-exemplar-v1.md` §4（L99–101） | **改**：挂载目标补「联合成员」（保持 `--spec exemplar` 绿路径） | G10 扩展的必然同步 |
| 9 个源/测文件的 14 处措辞（§5.4） | **改**：注释与 describe 标题措辞（零行为语义） | AC3；D5 |
| 新增 `packages/vfsl/test/spec-docs-anchor-m4-contract.test.ts` | **新增**：D1–D5 文档契约（CI-wired） | §12.2 |
| 生产行为（IR/fingerprint/derived/投影/生成物） | **零改动**：注释改动不得改变任何运行时输出 | N1/N2/N6；C 组 |
| `domains/*/generated.ts`、`wiki/**` | **零改动** | N6/N8 |

## 11. Ruled-out hypotheses

1. **「实现仍是三锚位 / M4 未落地」** —— 68 tests 绿 + 探针 A–L：M4 解析、IR 条件键、派生表、投影切片、codegen 四发射位全部在场。
2. **「文档已经更新」** —— §5.1 原文：§5 仍是「三类」、零 M4 字样；指南 §7/§8 示例零成员 doc；检查表零 M4 条目。
3. **「需要改生产代码才能让新指南示例合法」** —— X6：目标示例（含 `YXmlFragment` 成员与多行前导 `|`）在现行实现下 `ok:true`；本票为纯文档+注释+测试面任务。
4. **「红是夹具/入口/环境问题」** —— X4 单红归因 + 基线套件绿 + 探针两次输出 sha256 相等；G10 红由完全可控的文本差决定。
5. **「规格检查器基线全绿，可直接当验收入口」** —— 反驳：现行 20/21，`G16 缺少 AssetsDoc` 为 **ROOT 约定改名的预存在陈旧期望**（`task_vfsl-root-convention_design.md` 明列 `AssetsDoc→ROOT` 规格修订；检查器 L321/L555 未同步）。因此本契约主入口放在 **CI-wired 的 vitest**，检查器作规范文本机器契约（并按 O-3 同步）。
6. **「AC3 的全仓范围包含 wiki」** —— 反驳：25 个 wiki 追踪文件为该词的历史证据（`docs/AGENTS.md` 明示 wiki/raw 是证据非规范），且 #309 自身的 SA6/SA7/SA8 报告必然引用该词；把历史证据改写为「无残留」会伪造审计轨迹且自相矛盾。精确边界见 §12.8 B1。
7. **「指南示例是自含模块，可直接整块解析」** —— 反驳：§7 示例是片段（无 `ROOT`），整块 `parseVfsl` 得 E310；契约给出显式 wrapper 规则（§12.2 D3），不依赖 fallback/吞错。
8. **「M3 优先与 M4 双挂」** —— 反驳：N4 实测同一 doc 只出现一次（marker docs 或 memberDocs 之一）。

## 12. Acceptance contract（可直接转写的可执行契约）

### 12.1 冻结运行时观察（行为锚，目标文档必须与之一致；生成自 HEAD `bbb93fb` 实测）

| 场景 | 输入（逐字） | 冻结观察 |
|---|---|---|
| A1 前导 `\|` 锚位 | `type ROOT = {};\ntype Status =\n  /** 草稿：可继续编辑 */\n  \| "draft"\n  /** 已提交：只可追加备注 */\n  \| "submitted"\n  \| "archived";` | `ok:true`；`memberDocs=[[" 草稿：可继续编辑 "],[" 已提交：只可追加备注 "],[]]` |
| A2 首成员起点锚位 | `type ROOT = {};\ntype T = /** 甲 */ "a" \| "b";` | `ok:true`；`memberDocs=[[" 甲 "],[]]` |
| A3 doc 紧邻 `\|` 之前 | `type ROOT = {};\ntype T = "a" /** 乙 */ \| "b";` | `ok:true`；`memberDocs=[[],[" 乙 "]]` |
| A4 连续 doc 同挂 | `type ROOT = {};\ntype T =\n  /** 一 */\n  /** 二\n * @tag */\n  \| "a"\n  \| "b";` | `ok:true`；`memberDocs=[[" 一 "," 二\n * @tag "],[]]`（逐字含内部 `*`/缩进） |
| B1 坍缩（成员起点锚） | `type ROOT = {};\ntype T = /** d */ "a";` | `ok:false`；E305 @ (2,10)；message `^VFSL-E305: ` |
| B2 坍缩（前导 `\|`） | `type ROOT = {};\ntype T = /** d */ \| "a";` | `ok:false`；E305 @ (2,10) |
| B3 夹缝非标记（单行） | `type ROOT = {};\ntype T = "a" \| /** d */ "b";` | `ok:false`；E305 @ (2,16) |
| B4 夹缝非标记（多行） | `type ROOT = {};\ntype T =\n  \| "a"\n  \| /** d */ "b";` | `ok:false`；E305 @ (4,5) |
| C1 M3 优先（`\|` 后 marker） | `type ROOT = {};\ntype T = /** 成员口径 */ \| /** 载体口径 */ YLeaf<"a"> \| YLeaf<"b">;` | `ok:true`；`memberDocs=[[" 成员口径 "],[]]`；`members[0].docs=[" 载体口径 "]`；「载体口径」在整树 JSON 中恰出现 1 次 |
| C3 M3 优先（成员起点 marker） | `type ROOT = {};\ntype T = /** d */ YLeaf<"a"> \| YLeaf<"b">;` | `ok:true`；`members[].docs=[[" d "],[]]`；**无 `memberDocs` 键**（不双挂、全空即缺席） |
| C5 M3 优先（前导 `\|` 夹缝 marker） | `type ROOT = {};\ntype T = \| /** d */ YLeaf<"a"> \| YLeaf<"b">;` | `ok:true`；marker docs `[[" d "],[]]`；无 `memberDocs` 键 |
| D1 无 M4 惰性 | `type ROOT = {};\ntype T = "a" \| "b";` | `ok:true`；IR 无 `memberDocs` 键 |
| E1 派生表 | `type ROOT = { m: Mixed; s: Status };\ntype Status = /** 状态 */ "draft" \| "submitted";\ntype Mixed = /** 成员甲 */ \| /** 载体甲 */ YLeaf<"x"> \| YLeaf<"y">;` | `derived.memberDocs={"Status.<member 0>":[" 状态 "],"Mixed.<member 0>":[" 成员甲 "]}` |
| E2 投影切片 | 同上，`resolveSchemaAtPath(derived, ["m"])` | `docs={"Mixed.<member 0>":[" 载体甲 "," 成员甲 "]}（marker 在前、member 在后）`；`["s"]` → `{"Status.<member 0>":[" 状态 "]}` |
| I1 E305 消息 | B1 的 message 正文 | 含「类型别名 / 属性 / 标记类型 / 联合成员」四类枚举；前缀冻结 |

### 12.2 Suite D（交付物契约，**新增**，主红/绿判据，CI-wired）

**文件**：`packages/vfsl/test/spec-docs-anchor-m4-contract.test.ts`（vitest；`vitest.config.ts` include = `packages/*/test/**/*.test.ts`；CI 分片器 `scripts/ci-test-shard.mjs` 从磁盘枚举 `*.test.ts`，**新文件自动入分片**）。
**通用工具**：`repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')`；`readSection(file, startHeading, endHeading)`；`execBlock(block)` = 若块内无 `type ROOT` 声明则前置 `type ROOT = {};\n`（显式 wrapper 规则），随后 `parseVfsl` → `evaluate`，两段都必须 `ok`，返回 `derived`。

| 用例 | 断言 | 现行预期 | 目标预期 |
|---|---|---|---|
| **D1 §5 四类锚位 + M4 子规则** | 取 §5 正文（`## 5.` → `## 6.`）；必须命中：`四类`、`类型别名`、`属性`、`标记类型`、`联合成员`；且含子规则事实链：`前导`+`\|`+`锚位`；`首成员`+`起始记号`；`连续`+`同一成员`；`坍缩`+`E305`；`夹缝`+`E305`；`优先`+`不双挂`；`既有`+`不变`（共 20 needle；按事实链取合取） | **红**（20 needle 缺 12：`四类`/`联合成员`/`锚位`/`首成员`/`起始记号`/`同一成员`/`坍缩`/`夹缝`/`优先`/`不双挂`/`既有`/`不变`；`前导` 仅以「前导注释」出现故子规则链 c 仍红，其余命中 `类型别名`/`属性`/`标记类型`/`\|`/`连续`/`E305`×2） | 绿 |
| **D2 §5 联合成员挂载示例** | 提取 §5 全部 ` ```vfsl ` 块：至少 1 块；每块 `execBlock` 成功；至少 1 块的 `derived.memberDocs` 存在**非空**条目。自跟随核对（多行前导 `\|` 布局）：块内每个「`/** … */` 行 + 下一非空行以 `\|` 开头」对的 doc 原文（去掉 `/**` 与 `*/` 后逐字）必须出现在 `memberDocs` 值中 | **红**（块数 0） | 绿 |
| **D3 指南 §7/§8 示例** | 取 `### 7.` 与 `### 8.` 各自 `vfsl` 块，`execBlock` 成功；每块内「`/** … */` 行 + 下一非空行以 `\|` 开头」对 ≥2 个，且 doc 原文（去 `/**`/`*/` 边界后逐字）出现在 `derived.memberDocs` 值中（自跟随：期望值取自文档自身，不做硬编码复述） | **红**（两示例各 0 个成员 doc 对） | 绿（冻结观察：`Asset.<member 0/1>`、`Status.<member 0/1>`） |
| **D3b 指南挂载目标句** | 指南正文含「联合成员」且三锚位挂载句（L204）已修订为四类 | **红** | 绿 |
| **D4 检查表覆盖 M4** | `## 提交前检查表` 至 EOF 内至少 1 条 `- [ ]` 条目同时含（`联合` 或 `枚举`）+ `成员` +（`JSDoc` 或 `文档注释`） | **红** | 绿 |
| **D5 措辞清扫 + diff 卫生** | ① `git ls-files -z` 枚举追踪文件，排除路径以 `wiki/` 开头者与含 `/dist/`/以 `dist/` 开头者；UTF-8 读取（非文本跳过），计数 needle `['三','锚位'].join('')` → **必须 0**（测试文件自身用 join 构造 needle，避免自命中）；② `spawnSync('git', ['diff', '--check'])` → exit 0 且 stdout 为空 | **红**（14 处 / 9 文件） | 绿（0 处；diff 干净） |

**断言纪律**：D1/D3b/D4 是交付物本体（文档文本即产品，同 `tests/acceptance/vfsl_spec_acceptance.py`「对交付物做结构性解析而非对被测源码 grep」先例）；D2/D3 的期望值来自文档自身（自跟随），执行经真实 `parseVfsl`/`evaluate`；D5 是 AC3 的直接对象。无 skip/only/todo/env override/fallback/吞错。

### 12.3 Suite C（回归与负控；不新增测试，运行既有套件）

| 命令 | 当前 | 完成后必须 |
|---|---|---|
| `NODE_OPTIONS=--conditions=nomicore-source pnpm vitest run packages/vfsl/test/parse-vfsl-union-member-docs.test.ts packages/vfsl/test/evaluate-derived-member-docs.test.ts packages/vfsl/test/resolve-schema-at-path-member-docs.test.ts packages/vfsl-codegen/test/generate-union-member-docs.test.ts` | 4 files / 68 tests 绿、Type Errors 无 | 同数同绿（既有断言零修改/零弱化） |
| `pnpm typecheck` | exit 0（14 个 tsconfig） | exit 0 |
| `pnpm generate --check` | exit 0（codegen 套件内 387ms 用例同判） | exit 0，`domains/*/generated.ts` 零 diff |
| `git diff --name-only`（实现支） | — | `wiki/**` 零条目；`packages/*/src/**` 若出现，只允许注释/措辞改动（§12.8 B5） |
| `parse-vfsl-union-member-docs.test.ts` 金样本常量（IR sha256 + semantic 指纹） | 绿 | **不得修改常量**（改了即伪绿） |

### 12.4 规格检查器同步（`tests/acceptance/vfsl_spec_acceptance.py`，O-3 强制）

| 项 | 要求 |
|---|---|
| docstring 机器契约 L34 | 「挂载目标: 类型别名 / 属性 / 标记类型」→ 四类（补「联合成员」） |
| G10 need 列表 L477–478 | 增 `"联合成员"`（现行 12 项 → 13 项） |
| **新增 G17（§5 M4 子规则，9 项）** | §5 正文必须命中：`("四类","锚位")`、`("联合成员",)`、`("前导","\|","锚位")`、`("首成员","起始记号")`、`("连续","同一成员")`、`("坍缩","E305")`、`("夹缝","E305")`、`("标记","优先","不双挂")`、`("既有","不变")` |
| G16 期望修复（维护项） | L321/L555 `AssetsDoc` → `ROOT`（ROOT 约定改名后的陈旧期望；见 §11.5） |
| exemplar 同步 | `tests/acceptance/exemplar/spec-exemplar-v1.md` §4（L99–101）挂载目标补「联合成员」，保持 `--spec` 绿路径 |
| 判定 | `python3 tests/acceptance/vfsl_spec_acceptance.py` → **22/22 GREEN（21 + G17）**；`--spec tests/acceptance/exemplar/spec-exemplar-v1.md` → 22/22 GREEN |

### 12.5 运行入口（全部从仓库根运行）

```bash
# 主判据（CI-wired；新文件由 vitest include 与 CI 分片器自动发现）
NODE_OPTIONS=--conditions=nomicore-source pnpm vitest run packages/vfsl/test/spec-docs-anchor-m4-contract.test.ts

# 全量门禁
NODE_OPTIONS=--conditions=nomicore-source pnpm test          # 含 --typecheck
pnpm typecheck && pnpm generate --check && git diff --check

# 规格文本机器契约（issue #4 机制）
python3 tests/acceptance/vfsl_spec_acceptance.py
python3 tests/acceptance/vfsl_spec_acceptance.py --spec tests/acceptance/exemplar/spec-exemplar-v1.md
```

### 12.6 敏感度（错误实现先红在哪条）

| 走偏方式 | 先红 |
|---|---|
| §5 保留三锚位 / 漏 M4 子规则 | D1 + G10 + G17 |
| §5 无联合成员示例块 | D2 |
| 指南示例未加逐成员 doc / 仍是单行旧布局 | D3（D3b 若 L204 未改） |
| 检查表未补 M4 | D4 |
| 任何一处「三锚位」残留 / 非注释 whitespace 缺陷 | D5 |
| 为落地文档而改生产行为（IR/派生/生成物/fingerprint） | C 组（N1/N2/N6） |
| 把 `memberDocs` 加进守卫必填清单或改投影形状 | 既有 M4 套件红（N1） |
| 改写 wiki 历史证据以「清零」措辞 | N8（wiki 零 diff 控制） |
| 目标示例引入非规范 `Y` 前缀记号或删除附录 fixture | 检查器 G15/G16 红（X3 证明正常追加不红） |
| 检查器只改 docstring 不改 need 列表 | G10 仍红（need 是判据） |

### 12.7 旧实现（现行文档）vs 目标实现预期

| 判据 | 现行（旧文档） | 目标（落地后） |
|---|---|---|
| D1–D5 | 全红 | 全绿 |
| G10 / G17 | 红 | 绿 |
| G16 | 红（预存在 stale） | 绿（同步修复后） |
| N1–N8 | 全绿 | 必须保持全绿 |
| `git diff --check` | 0（基线干净） | 0 |

### 12.8 契约边界与设计待决（D-x）

- **B1 AC3 作用域**：措辞断言 = `git ls-files`（追踪文件）− `wiki/**` − `dist/**`。理由：wiki/raw 是历史证据（docs/AGENTS.md）；25 个追踪 wiki 文件与 #309 自身报告必然含该词。`wiki/**` 另由 N8（零 diff 控制）锚定「不得为清零而改写历史」。**字面全域读法的代价（供设计裁决）**：需额外改写 25 个追踪历史产物（含 #306/#307/#308 的 SA2/SA4/SA6/SA7 报告与设计、以及本特性的 ADR 论证记录），与本流程「历史产物是审计证据」冲突；若设计/Owner 仍选择字面读法，必须在设计中显式记录改写授权，本契约不将其列为默认。**两种读法在本票的可验证差异仅 25 个 wiki 文件；D1–D4、G10/G17、AC1/AC2/AC4 不受影响。**
- **B2 `docs/adr/0019:60`**：唯一命中规范文档的比较性表述（「与三锚位『紧随其后』语义一致」）。**推荐**：最小措辞修订为「与既有 M1/M2/M3 的『紧随其后』语义一致」（不改决策）；若设计选择豁免该行，必须在 SA8/设计中显式记录豁免路径（D5 相应白名单化），**不得静默放过**。
- **B3 G16 预存在红**：推荐同票修复（检查器维护项，一行期望）。若设计不在本票修，必须：① 在设计中登记为预存在缺陷；② #309 验收只用 G10/G17 + Suite D 判红绿；③ 不得把 G16 红计为 #309 缺陷或伪绿。
- **B4 检查器接入 CI**：AC 未要求；推荐 follow-up（当前唯一引用在 exemplar 头注）。
- **B5 生产代码零语义改动**：允许 `packages/vfsl/src/*.ts` **仅注释**改动；由 C 组（金样本/类型检查/生成物）承压。可选加强：对改动文件做「去注释后 token 等价」比对（如以 TypeScript scanner 剥离 trivia 后逐 token 比较）。
- **B6 测试文件命名/落点**：`packages/vfsl/test/` 内任意 `*.test.ts` 均可被 runner 发现；本契约以 `spec-docs-anchor-m4-contract.test.ts` 为建议名，改名不改判据。

## 13. Red/green or baseline evidence（实测汇总）

```
# 实现基线（负控 N1/N2）
$ NODE_OPTIONS=--conditions=nomicore-source pnpm vitest run packages/vfsl/test/parse-vfsl-union-member-docs.test.ts \
    packages/vfsl/test/evaluate-derived-member-docs.test.ts packages/vfsl/test/resolve-schema-at-path-member-docs.test.ts \
    packages/vfsl-codegen/test/generate-union-member-docs.test.ts
 ✓ generate-union-member-docs.test.ts (33)  ✓ resolve-schema-at-path-member-docs.test.ts (16)
 ✓ parse-vfsl-union-member-docs.test.ts (13) ✓ evaluate-derived-member-docs.test.ts (6)
 Test Files 4 passed (4) | Tests 68 passed (68) | Type Errors no errors | exit 0

# 规格检查器基线（预存在红）
$ python3 tests/acceptance/vfsl_spec_acceptance.py
 [FAIL] G16 fixture 构造覆盖 — 缺少 AssetsDoc        → 20/21 RED (exit 1)
$ python3 tests/acceptance/vfsl_spec_acceptance.py --spec tests/acceptance/exemplar/spec-exemplar-v1.md
 GREEN 21/21 (exit 0)

# 控制变量矩阵（§9 X1–X4 实测输出）
 E1 extended × current : G10 缺 联合成员 + G16 缺 AssetsDoc
 E2 extended × target  : 仅 G16 缺 AssetsDoc          （G10 转绿）
 E3 extended+G16fix × target : GREEN 21/21            （§5 追加示例块不伤 G15/G16）
 E4 extended+G16fix × current: 仅 G10 缺 联合成员      （红因单一）
 G17 × current : RED 9/9 项  |  G17 × target : GREEN 0 项不满足

# 运行时观察（A–L 探针，两次运行 stdout sha256 相等 = 确定性）
 A1 ok / memberDocs [[" 草稿：可继续编辑 "],[" 已提交：只可追加备注 "],[]]
 A2 ok / [[" 甲 "],[]]      A3 ok / [[],[" 乙 "]]      A4 ok / [[" 一 "," 二\n * @tag "],[]]
 B1/B2 E305@(2,10)   B3 E305@(2,16)   B4 E305@(4,5)   C4 E305@(2,12)
 C1 memberDocs=[[" 成员口径 "],[]] + marker docs=[[" 载体口径 "],[]]（不双挂）
 C3/C5 marker docs=[[" d "],[]] + 无 memberDocs 键
 D1 无 memberDocs 键；E1 derived 表 2 键；E2 投影合并 [" 载体甲 "," 成员甲 "]
 I1 消息正文含「类型别名 / 属性 / 标记类型 / 联合成员」
 F1/F2 codegen 枚举/联合逐成员 TSDoc 多行发射
 X6 目标指南示例（现行实现）parse+evaluate 绿，memberDocs 逐字在场

# 现状文本（H1–H5）
 H1 §5 含「三类」= true   H2 §5 含「联合成员」= false   H3 §5 含「M4」= false
 H4 锚句子 = 「…声明性节点，三类：类型别名、属性、标记类型…」
 H5 指南 = 「JSDoc 必须紧邻类型别名、对象字段或标记类型才能挂载。」

# 卫生
 $ git diff --check  → exit 0（基线干净）
 $ pnpm typecheck    → exit 0（14 个 tsconfig）
 $ pnpm generate --check → exit 0
```

## 14. Runner trigger evidence

| 入口 | 证据 |
|---|---|
| `pnpm test`（vitest） | `vitest.config.ts` `test.include = ['packages/*/test/**/*.test.ts', 'domains/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts']`；本轮 4 个 `packages/vfsl*/test/*.test.ts` 被真实收集并执行（68 tests）→ 新增 `packages/vfsl/test/spec-docs-anchor-m4-contract.test.ts` 会被同一入口发现 |
| CI 分片 | `.github/workflows/ci.yml` test 作业：`scripts/ci-test-shard.mjs` **从磁盘枚举** `*.test.ts`（L25–50）→ 新测试文件自动落入分片，无需登记 |
| 规格检查器 | `tests/acceptance/vfsl_spec_acceptance.py`（`python3` 直接运行，纯标准库零依赖；退出码 0/1）；本轮实测可运行（20/21 + exemplar 21/21） |
| exemplar 绿路径 | `--spec tests/acceptance/exemplar/spec-exemplar-v1.md` 21/21 GREEN |
| 类型面 | `pnpm test` 内含 `--typecheck`（config `typecheck.enabled`），D 组无 `.test-d.ts` 需求 |

## 15. Unknowns and blockers

无硬阻塞。需设计票裁决的开放点（均有推荐默认，不阻塞契约成立）：

1. **U1**：`docs/adr/0019:60` 措辞修改 vs 豁免登记（推荐：最小措辞修订；§12.8 B2）。
2. **U2**：G16 陈旧期望是否同票修复（推荐：同票修，一行维护；§12.8 B3）。
3. **U3**：D 组测试文件命名/是否同时把 §5 示例做成语义锚（推荐名 `spec-docs-anchor-m4-contract.test.ts`；§12.8 B6）。
4. **U4**：检查器是否顺带接入 CI/package scripts（AC 外，推荐 follow-up；§12.8 B4）。
5. **U5**：#309 缺 SA8 冲突门禁/设计产物（本报告已以 brief+ADR 0019+O-3 推导；设计票须补齐门禁）。

## 16. Temporary diagnostics cleanup

| 项 | 内容 |
|---|---|
| 创建的临时文件 | `.scratch/issue-309-probe/probe.ts`（运行时探针）、`.scratch/issue-309-probe/acceptance-experiment.py`（检查器控制矩阵） |
| 沙箱产物 | `/tmp/sa6-309-*/`（spec 副本与检查器副本）、`/tmp/probe-{1,2}.txt` —— 均在 `/tmp`，无仓库影响 |
| 生产/规范/测试改动 | **零**（未触碰 `docs/**`、`packages/**`、`tests/**`） |
| 清理 | 已删除 `.scratch/issue-309-probe/` 全部内容（`.scratch/` 仅余追踪文件 `vfsl-v1-parser/spec.md`）与 `/tmp` 沙箱；实测 `git status --porcelain` = 仅 `?? wiki/raw/task_issue-309.md`（Host brief）与 `?? wiki/raw/task_issue-309_sa6_contract.md`（本报告）；`git diff --stat` 为空；`git diff --check` exit 0 |
| 复现方式 | 探针与控制矩阵的完整输入/命令/观察值已逐字冻结于 §9/§12.1/§13，实现票可直接转写为 D 组用例 |
