# SA8 冲突门禁报告 — issue #299（前置门禁）

- **dispatch**: sa-8440188d-3c19-4a3c-8520-4870649b0cd6（mabf-sa8 / conflict-gate / iteration 0）
- **审查对象**: issue #299 任务简报「feat(#295 切片 1): 协议与配置基座：0x42 kind 首字段单形态 codec、聚合上限配置链」（任务要求来源 = issue body + ACs，与 `wiki/raw/task_issue-299.md` 快照逐字一致）
- **门禁类型**: 前置门禁（SA 派发前：任务简报 vs ADR 全集 + CONTEXT.md）
- **Issue comment REST snapshot**: `[]`（空——dispatch 声明与本次 `gh issue view 299` 实测一致，comments 数组为空）——无 owner 补充要求需要并入
- **裁决**: **通过（clear）——0 阻塞冲突 / 1 个轻微冲突（仅 issue 标题文本，正文与 AC 为准，R32）/ 5 条非阻塞就绪注意项（R33–R37）**

## 1. 冲突基准与效力判定

基准 = `CONTEXT.md` + `docs/adr/` 全集（17 篇）。全库 supersede/废止标记扫描：**无任何 ADR 处于 ADR 级整体被取代状态**（同 #244/#245/#246 门禁连续裁定）。代码与 `docs/protocols/`、wiki 不构成自动阻塞依据，仅作就绪性佐证。

- **ADR 0022（chunked sync transfer）**：状态「已接受（issue #295 设计冻结）」。本简报是其「后果」节（L100「#242 的 0x42 golden vectors 在本分支内改写为单形态」、L101「落地时修订协议文档与 CONTEXT.md」已由 docs 分支兑现、L54–64 配置链）的**显式履行票**——任务与 ADR 是义务-履行关系，非对抗关系。wire 冻结值以协议文档为唯一权威（ADR 0022 L4）。
- **ADR 0013（chunked live update transfer）**：状态「已接受」。其非目标 #4（SYNC_STEP2/BOOTSTRAP_SNAPSHOT 分块列为后续独立 capability 如 `CAP_CHUNKED_SYNC`）已被显式划除并登记「已由 ADR 0022 接替：0x42 kind 单形态恒用分块、同版本部署假设下无 capability 协商」（L117）——取代关系**已在 ADR 正文显式登记**，符合 docs/AGENTS.md「Amend or supersede prior decisions explicitly」；ADR 0022 L116 同时显式登记了对 ADR 0013「未协商端逐字节不变」纪律的**限定范围偏离**（仅 sync 段分块，live UPDATE 路径协商行为不动）。因此六字段旧形态不构成约束，改写 golden vectors 有直接 ADR 授权（ADR 0022 L36–37）。
- **`docs/protocols/instance-replication-v1.md`** 为 wire 契约唯一权威（root AGENTS.md「Instance replication」节），**HEAD 现状已完成 #295 修订**（commits `2ca06f6` + `eb380d7`：§1 实现代际、§5 L116 单形态、§8.1/§9.2 分块路径、§10.3 L313/323、§13.2 L445–452 四新码、§17 L578–615 配置链、§22 L701、§23.1 第 29–36 型）——实现票面对的是已冻结的目标契约，非待修订契约。
- **CONTEXT.md**：「分块复制传输／UPDATE_CHUNK／CAP_CHUNKED_UPDATE／同版本部署假设／实现代际」五词条已全部并入 ADR 0022 语义（单形态、三态 kind、共用计数器、无 sync 段协商），与简报用法一致，无新词条要求。

## 2. 逐条对照（简报 → 基线）

| # | 简报要求 | 基线依据 | 裁决 |
|---|---|---|---|
| C1 | 0x42 改写为 kind 首字段单形态并正确编解码 | ADR 0022「消息形态」L20–37（kind varUint 首字段 + 五字段序不变 + 绑定块位）；协议 §5 L116、§10.3 L313/L323 逐字同源；CONTEXT.md「UPDATE_CHUNK」词条 | 无冲突 |
| C2 | kind=1 首 chunk 携 replicationId/replicationEpoch、kind=2 首 chunk 携 syncRoundId，codec 往返无损 | ADR 0022「round/epoch 绑定」L39–43；§5 L116、§10.3 L323（绑定块位置：totalBytes 之后、bytes 之前；编码 replicationId varString + replicationEpoch varUint / syncRoundId varUint）；§8.1 L202、§9.2 L238 | 无冲突 |
| C3 | `kind ∉ {0,1,2}` 或绑定块位置违例（非首 chunk 携带 / kind=0 携带）→ `MALFORMED_FRAME` | §10.3 L323 逐字（「codec 级单帧规则追加：kind ∈ {0,1,2}、绑定块当且仅当 kind≠0 ∧ chunkIndex=0 时存在（违者 MALFORMED_FRAME）」）；§13.1 L401 `MALFORMED_FRAME`（fatal/no/1002）在册 | 无冲突 |
| C4 | 六字段旧形态 golden vectors 本分支内改写为单形态（旧形态从未发布，无兼容负担） | ADR 0022 L36–37/L87/L100 显式授权，前提「PR #241 尚未合入 main、旧形态从未部署」经本次实测**仍然成立**（PR #241 OPEN 未合并；当前分支 `payloads.ts` L651–690 实为六字段形态）；§22 L701（单形态 golden vectors 由实现票交付） | 无冲突（前提经实测复核） |
| C5 | `maxChunkedBootstrapBytes`/`maxChunkedSyncDiffBytes` 缺省各 4 MiB 生效 | ADR 0022 配置表 L58–59；协议 §17 L578–579（含超限错误码挂接 `SNAPSHOT/SYNC_TRANSFER_TOO_LARGE`） | 无冲突 |
| C6 | `maxChunksPerUpdate`/`maxConcurrentAssembliesPerConnection`/`assemblyTimeoutMs` 语义 kind 无关、键名不变 | ADR 0022 L61；协议 §17 L580–582（逐键登记 kind 无关推广 + 内存上界公式 + 超时按 kind 收口） | 无冲突 |
| C7 | 两条链②不等式进启动响亮验证、违例响亮拒绝、绝不运行时 clamp | 协议 §17 校验块 L602–603（`maxChunkedBootstrapBytes ≤ maxChunksPerUpdate * maxUpdateBytes` / SyncDiff 同形态）+ L611「不得运行时 clamp」；ADR 0022 L54 同源 | 无冲突 |
| C8 | `maxQueuedControlBytes ≥ maxBootstrapBytes + 协议开销` 校验原样保留 | ADR 0022 L63（「原样保留：未超上限的 snapshot 仍以单帧 control 帧承载」）；协议 §17 L598 + L615（含「静态纪律、不因运行期行为路径而条件化」理据） | 无冲突 |
| C9 | 未表达新键的存量配置不误判（非追溯性） | 协议 §17 L613（#244 先例：触发键 = 显式配置的分块族操作数键）+ L615（#295 键「同纪律…未表达新键的存量配置不误判」）——逐字同源；触发键作用域细化见 R35 | 无冲突（附 R35 精度约束） |
| C10 | 三种 kind 共用同一 transferId 计数器（(连接,方向,namespace) 域严格递增不回绕）语义在 codec/契约层锁定 | ADR 0013 L32（uint32、从 1 严格递增、不回绕）+ ADR 0022 L28（三 kind 共用）；协议 §5 L116、§10.3 L315/L325（0 非法）；CONTEXT.md「分块复制传输」L154 | 无冲突（附 R33 无状态边界约束） |

**交叉 ADR 检查**：ADR 0010——分块不改固定 envelope/ACK durability/identity fencing/backpressure 分层/停机顺序（ADR 0022 L116 自述「基线架构 ADR 0010 不变」；本切片仅 codec 单帧形态 + 配置校验，不触 §21）。ADR 0012（实例身份）——0x42 payload 零身份字段变更。ADR 0011/0014（诊断日志）——§23.1 第 29–36 型已登记，本切片非 observer 票，零交集。ADR 0001–0009/0016–0018（VFSL/投影/持久化/运行时/Registry/schema 生命周期）——零交集。CONTEXT.md 五分块词条与简报用法一致。

## 3. 依赖评估

- **Blocked by**: 简报声明 None——成立。父 PR #298（docs/issue-295-chunked-sync-design）OPEN 未合并，但其全部内容（ADR 0022 + 协议修订）**已在当前分支历史**（commits `2ca06f6`、`eb380d7`，工作分支 `mabf/issue-299`）——同 #244 R9 / #245 R25 / #246 R30 连续裁定的分支链先例，不阻塞。
- **ADR 0022 事实前提复核**：PR #241（v2 代际 base PR）OPEN 未合并 ✓；当前分支 codec 为六字段旧形态（`packages/replication-protocol/src/payloads.ts` L651–690，无 kind 字段）✓；待改写 golden 资产在库（`codec-messages-golden.test.ts`、`codec-issue242-ac-red.test.ts`、`codec-roundtrip-truncation.test.ts`、`codec-malformed.test.ts` 等，§22 L699 锚定）✓——「旧形态从未发布、无兼容负担」的门禁前提三重成立。
- **前置切片 #242–#246**：已落地并在分支历史（`56426a2` 收口），§5/§10.3/§13.2/§17/§22/§23.1 既有登记面即本切片的对端。
- **运行基线**：工作树仅含未跟踪简报快照 `wiki/raw/task_issue-299.md`（evidence，非规范），无未提交漂移。

## 4. 就绪注意项与轻微冲突（非阻塞，转交 SA1；编号接续 #246 门禁 R26–R31）

- **R32 · 【轻微冲突·仅标题文本】issue 标题与 ADR 0022 直接冲突，正文为准**：标题「…CAP_CHUNKED_SYNC 协商、0x42 kind 双形态 codec…」逐字命中 ADR 0022「明确拒绝的备选方案」#1（L87：「`CAP_CHUNKED_SYNC` capability 协商 + 0x42 双形态切换 + 发送端 gating…为不存在的部署矩阵付设计税」）与 CONTEXT.md「同版本部署假设」Avoid 条（「为历史 wire 形态保留双形态切换或发送端 gating、新旧互通矩阵测试」）。全库术语扫描证实 `CAP_CHUNKED_SYNC`/「双形态」仅存活于拒绝语境（ADR 0013 L117 划除非目标、ADR 0022 L17/L87、CONTEXT.md L167）——唯一仍在「待建」语义上使用它们的活跃工件就是本 issue 标题（推断源自修订前首笔设计冻结 commit `2ca06f6` 的措辞，已被 `eb380d7` 在库内取代而标题未同步）。**裁定不阻塞**：任务的可执行要求（What to build + ACs）全部来自正文，正文与 ACs 明确为「单形态、无协商、同版本部署假设」，与 ADR 0022/协议/CONTEXT 完全一致；但任何按标题实施的执行者都会直接违反 ADR 0022——建议 reporter 将标题改为与正文一致（如「0x42 kind 首字段单形态 codec、聚合上限配置链」），并在派发词中明示「标题措辞已废弃，以正文为准」。
- **R33 · codec 无状态边界（AC4 落地方式约束）**：CONTEXT.md「UPDATE_CHUNK」词条明文「codec 只做单帧无状态编解码与语义自洽校验，跨帧一致性/顺序/总量与重组属接收端 assembly 状态机」，Avoid「在 codec 层承载连接级 assembly 状态」。AC4「transferId 共用计数器语义在 codec/契约层锁定」必须以契约测试/golden vectors/类型层锁定实现（计数器本体是发送端连接域状态，非 codec 状态）；codec 单帧规则须保留既有 `transferId ≥ 1`（0 非法，§10.3 L315/L321）。
- **R34 · 「无 capability 协商」前提的作用域必须收窄到 sync 段**：正文「无 capability 协商、无向前兼容面」仅指 kind=1/2 的发送路径（ADR 0022 L16：sync 段「不新增 capability bit、不做协商、不做发送端 gating」），**不得**误读为移除 0x42 解码侧协商门。ADR 0022 非目标 #5（「修订 ADR 0013 已实现的 CAP_CHUNKED_UPDATE 协商与 v1 回落行为」出范围）+ 协议 §10.3 L345（「解码侧未协商必须在 payload 解析前以 UNSUPPORTED_MESSAGE_TYPE connection fatal 拒绝」——对 0x42 一体适用、不分 kind）+ §5 L114/L116 + §22 L701 + CONTEXT.md「CAP_CHUNKED_UPDATE」「实现代际」词条：v1 代际端对任何 0x42 帧照旧未知消息码 connection fatal。codec 改写必须原样保留该 pre-parse 拒绝路径及其测试锚（`codec-issue242-ac-red.test.ts`）。
- **R35 · 链②校验触发键作用域须按 §17 纪律精确落地**：§17 L613 对 #244 链①②的触发条件是「显式配置 `maxChunkedUpdateBytes` **或** `maxChunksPerUpdate`（两链不等式的分块族操作数键）」，L615 对 #295 键表述为「显式配置 `maxChunkedBootstrapBytes`/`maxChunkedSyncDiffBytes` 时对应链式校验响亮生效…同纪律」。#295 链②与 #244 链②共享操作数键 `maxChunksPerUpdate`——「同纪律」读法下，显式下调 `maxChunksPerUpdate`（如 64→1）而未表达新键的配置是否触发 #295 两条链②，须由 SA1 显式设计并测试（缺省自洽 4 MiB ≤ 64 × 512 KiB 由缺省构造成立）。简报的非追溯性措辞（「未表达新键的存量配置不误判」）不得宽读为「凡未写新键即跳过新链」——那会让显式下调 `maxChunksPerUpdate` 的配置静默违反 4 MiB 缺省上界，与「启动响亮、绝不运行时 clamp」纪律冲突。属规范精度约束，非冲突。
- **R36 · append-only 冻结面不得顺势删改**：`BOOTSTRAP_TOO_LARGE`/`SYNC_DIFF_TOO_LARGE` 成为死码但**保留于 §13.2 注册表**（ADR 0022 L102）；§13.2 四新码、§18 `SYNC_TRANSFER_EXPIRED`、§23.1 第 29–36 型事件均已登记——本切片（codec + 配置）不得重复登记或改动其语义。绑定块**内容**核对（replicationId 不符 → `REPLICATION_ID_MISMATCH`【协议 §8.1 L202，较 ADR 0022 L42 仅提 epoch 码多出 id 码——协议为 wire 权威，以协议为准】、epoch 不符 → `REPLICATION_EPOCH_MISMATCH`、syncRoundId 不符 → `SYNC_STATE_VIOLATION`）属 §8.1/§9.2 后续切片；codec 层只管存在性/位置（presence/position）——与 AC2 范围一致，勿越界。
- **R37 · 文档同步义务轻量**：协议 §5/§10.3/§17 在 HEAD 已是单形态目标契约，实现须与之逐字对齐而非再修订；落地后按 docs/AGENTS.md「code 行为变化须同步受影响规范文档」仅需收口 §22 L701「golden vectors…由实现 ticket 交付，本规范不预设其存在」的措辞（交付后资产已存在）与既有测试资产锚（文件名不变则零改动）。`git diff --check` 干净与过期术语扫描（「双形态」「CAP_CHUNKED_SYNC」在规范文档零命中，R32 的 issue 标题在 GitHub 侧，非仓内工件）照例执行。

## 5. 结论

**门禁通过（clear）**。issue #299 任务简报（正文 + ACs）是 ADR 0022「后果」节显式预设的实现基座票：单形态 codec、绑定块编解码、MALFORMED_FRAME 单帧规则、两个聚合上限键、两条链②不等式、control reserve 保留、非追溯性、共用 transferId 计数器——全部与 ADR 0022/协议 §5/§10.3/§13.2/§17/§22/CONTEXT.md 逐条同源；改写六字段 golden vectors 有 ADR 0022 直接授权且「旧形态从未发布」前提经实测复核成立（PR #241 未合并 + 分支 codec 现状六字段）；与 ADR 0010 及其余 ADR 零抵触。唯一冲突是 issue 标题文本仍停留在已废弃的设计初稿措辞（CAP_CHUNKED_SYNC 协商 + 双形态，ADR 0022 明确拒绝方案 #1）——正文与 ACs 为准、不阻塞，建议 reporter 改题并在派发词中声明标题废弃（R32）。R33–R35 为 SA1 设计必须吸收的边界/精度约束，R36–R37 为落地同步义务；R32–R36 可作设计后复审核对项。
