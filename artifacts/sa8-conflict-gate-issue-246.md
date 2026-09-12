# SA8 冲突门禁报告 — issue #246（前置门禁）

- **dispatch**: sa-c2f9d0af-6020-455d-b99d-07e0a1141c65（mabf-sa8 / conflict-gate / iteration 0）
- **审查对象**: issue #246 任务简报「协议文档：分块传输 wire 契约修订与新旧互通矩阵（issue #233 切片 5）」（简报全文 = issue body，与 `wiki/raw/task_issue-246.md` 快照逐字一致）
- **门禁类型**: 前置门禁（SA 派发前：任务简报 vs ADR 全集 + CONTEXT.md）
- **Issue comment REST snapshot**: `[]`（空——dispatch 声明经本次实测 `GET /issues/246/comments` 返回 0 条复核一致）——无 owner 补充要求需要并入；本报告仅以 issue body 为任务要求来源
- **裁决**: **通过（clear）——0 阻塞冲突 / 0 轻微冲突 / 6 条非阻塞就绪注意项（R26–R31）**

## 1. 冲突基准与效力判定

基准 = `CONTEXT.md` + `docs/adr/` 全集（14 篇）。全库扫描 supersede/废止标记：**无任何 ADR 处于 ADR 级被取代状态**（grep 命中均为 ADR 正文节内历史修订记录，同 #244/#245 门禁裁定）；代码与 `docs/protocols/`、wiki 不构成自动阻塞依据，仅作就绪性佐证。

- **ADR 0013（chunked live update transfer）**：状态「提议（issue #233 base PR）」。沿用 #244 前置门禁 R9 / #245 前置门禁 R25 连续裁定：正文已入 corpus（commit `164eee7`）、CONTEXT.md 已并入「分块复制传输／UPDATE_CHUNK／CAP_CHUNKED_UPDATE」三词条、切片 #242/#243/#244/#245 已按其全部落地（commits `c20aeb0`/`e2178f3`/`733b3a7`/`d1888cc` 均在当前分支 `mabf/issue-246` 历史）——按 SA8 基准规则其为**现行约束**，且本简报正是其「后果」节（L109「落地时须修订 `docs/protocols/instance-replication-v1.md`（消息注册表、§13.2、§17、§23）并补 golden vectors 与旧/新互通矩阵」+ L110「复现刻画测试保留为现状基线」+ L25「互通矩阵：v2↔v2 分块；任意 v1 组合回落 v1 超限行为」）的**显式履行票**——任务与 ADR 是义务-履行关系，非对抗关系。
- **ADR 0010** 为复制架构权威；ADR 0013 自述「扩展 ADR 0010 的 live UPDATE 路径，不改变其 ACK durability 语义、identity fencing、backpressure 分层或停机顺序」；grep 证实 ADR 0010 正文零分块引用——无双重权威。
- **`docs/protocols/instance-replication-v1.md`** 为 wire 契约权威（root AGENTS.md「Instance replication」节）；docs/AGENTS.md 治理规则（词汇精确、显式修订而非静默矛盾、同步全部受影响规范文档、不虚构未实现行为）与本简报 AC5 逐字同源。

## 2. 逐条对照（简报 → 基线）

| # | 简报要求 | 基线依据 | 裁决 |
|---|---|---|---|
| C1 | 消息注册表修订（UPDATE_CHUNK 0x42） | ADR 0013「消息形态」节（0x42、单自描述帧、拒绝 BEGIN/CHUNK/COMMIT）；协议 §5 已登记（L111 行 + L113 gating 注：未协商 = connection fatal `UNSUPPORTED_MESSAGE_TYPE`、v1 HELLO 恒发 `optionalCapabilities=0`）——#242 交付，字段序与 ADR 六字段逐字一致（codec golden vectors 锁定） | 无冲突（范围 = 校验/收口已登记面，见 R26） |
| C2 | HELLO capability 协商节 | ADR 0013「协商」节（bit `0x00000001 = CAP_CHUNKED_UPDATE`、交集机制、零新字段、envelope version 恒 1 / flags 恒 0）；协议 §6.1 L130–134 capability bitset 词表已登记；实现锚点在 `peer-connection.ts:385`（offer）与 `hub-connection.ts`（onHello 单点交集） | 无冲突 |
| C3 | live UPDATE 分块节：发送/接收端规则、transfer 身份、ACK 锚点 | ADR 0013「发送端规则」「接收端规则」「ACK 复用」三节为完整规范源（transferId 严格递增域、首 chunk 四项校验、`chunkIndex === 已收数量`、收齐一次 apply + `UPDATE_ACK(末 chunk 帧序)`、assembly 易失作用域与全部丢弃路径）；协议 §10.3 现状明文「跨帧规则…与 assembly 状态机、ACK 复用…**属后续切片**」（L312）——本简报即该预留的承接，且实现已由 #243/#244/#245 落地（AC1「与实现逐字一致」有活实现可对照） | 无冲突（本切片唯一实质新增文档内容） |
| C4 | namespace 错误码注册表两个新码 | ADR 0013「错误码与词表」节；协议 §13.2 L410–413 已登记 `UPDATE_TRANSFER_VIOLATION`（fatal/no/failed）与 `UPDATE_TRANSFER_TOO_LARGE`（fatal/config/failed，对齐 `SYNC_DIFF_TOO_LARGE` 族）+ `RESYNC_REQUIRED.reasonCode` 词表 `UPDATE_TRANSFER_EXPIRED`（§18 L582）——#242/#244 交付 | 无冲突 |
| C5 | 资源上限与配置链节：四个新配置及校验不变量 | ADR 0013「资源上限与配置链」配置表（4 MiB/64/4/30_000 + 链式不变量）；协议 §17 L535–540 配置清单 + L548–569 校验块（跨字段链①②、缺省自洽、非追溯性条款）已登记——#242/#244 交付，「绝不运行时 clamp」逐字同源 | 无冲突 |
| C6 | observer seam 节：四个新事件类型与词表 | ADR 0013「Observer seam」表（L85–92）；协议 §23.1 已登记全部 26 型——第 23 型 `chunked-update-aborted`（#244，reason 六值闭集）+ 第 24–26 型 sent/applied/acked（#245，ADR L89–91 域键集逐字 + §23 信封、R21 改道与 R23 degraded 判别先例已按 #245 门禁收口）；§23.2 稳定码闭集合、§23.3 safe-field、§23.7 conformance 补充均在库 | 无冲突（范围 = 校验/保持冻结面） |
| C7 | conformance 清单增补；golden vectors 与新消息码锁定值纳入 §22 | 协议 §22 L652–653 已列「版本协商全矩阵和锁定 Yjs/y-protocols/lib0 组合的旧/新互通矩阵」+「分块传输（issue #242）：UPDATE_CHUNK 全字段 golden vectors、未协商 0x42 拒绝、v1 回落」；golden 资产已在库：`codec-messages-golden.test.ts`（18 型注册表恰锁 + UPDATE_CHUNK 三向量 + 0x42 锚定）与 `codec-issue242-ac-red.test.ts`（AC3 未协商拒绝） | 无冲突（范围 = 清单语言收口与指向，见 R26/R29） |
| C8 | ADR 0013 状态「提议」→「已接受」并登记与本协议的权威关系 | ADR 0013 状态行自述转移机制：「接受后 wire 冻结值以 `docs/protocols/instance-replication-v1.md` 修订为唯一权威，本文不先行改冻结契约」——本简报在修订协议文档的同一切片内完成接受与权威让渡，正是该条款预设的闭环；docs/AGENTS.md「Amend or supersede prior decisions explicitly」；四实现切片全部落地（ci-passed）为接受提供事实基础 | 无冲突（权威边界刻画见 R31） |
| C9 | 互通矩阵测试：v1↔v2 全组合（未协商 ⇒ 超限丢弃 + reconciliation 的 v1 行为逐字节保持）+ 锁定依赖组合旧/新互通 | ADR 0013 L25 逐字预授权（「互通矩阵：v2↔v2 分块；任意 v1 组合回落 v1 超限行为」）+ L110（#233 刻画测试 R1/R2/R3 保留为现状基线，`ws-replication-issue233-repro.test.ts` 在库且运行于缺省 `chunkedUpdate=false` 路径 = v1 基线，与「未协商逐字节 v1」AC 同构）；v1 peer 实现面直接可得：`chunkedUpdate?: boolean` 缺省 false = v1 逐字节（`types.ts` 注释明文「缺省 false = v1 逐字节」） | 无冲突（v1-hub 格可行性见 R28） |
| C10 | 文档验证：链接/引用文件名、过期术语搜索、`git diff --check` 干净 | docs/AGENTS.md「Verification」节逐字同源（Check links and referenced filenames, search for stale terminology, `git diff --check`）；本门禁已实测一处将过期术语：CONTEXT.md L142「（ADR 0013 提议）」——接受后须同步修订（入 AC1「CONTEXT.md 词汇零矛盾」范围） | 无冲突 |

**交叉 ADR 检查**：ADR 0010——分块不改其固定 envelope/ACK durability/identity fencing/backpressure 分层/停机顺序（ADR 0013 自述 + 实现切片未触碰 §21 停机序）；AC1「文档间零矛盾（ADR 0010/0013）」有明确对端。ADR 0012（实例身份/插件所有权）——HELLO 字段序冻结、仅 bitset 取值域扩展，零字段变更，无抵触。ADR 0011/0014（诊断日志）——与协议文档/互通矩阵零交集。ADR 0001–0009（VFSL/求值/投影/持久化/校验/运行时/Registry）——零交集。CONTEXT.md 三分块词条与简报用法一致，无新词条要求（R27/R31 的措辞修订除外）。

## 3. 依赖评估

- **Blocked by #245（切片 4）**：CLOSED（COMPLETED，ci-passed），经 #281 合并（commit `d1888cc`），且该 commit 为当前工作分支 `mabf/issue-246` 的 **HEAD 直接提交**——**满足**。其交付面（第 24–26 型事件、R21 成功结算改道、R23 degraded 判别先例）正是本简报 §23 节「校验已冻结面」的对端。
- **#242/#243/#244（切片 1–3）**：全部 CLOSED，commits `c20aeb0`/`e2178f3`/`733b3a7` 均在分支历史——协议文档 §5/§6.1/§10.3/§13.2/§17/§23 的既有登记与实现、golden vectors、v1 缺省路径全部有据可依。
- **父 issue #233**：OPEN（enhancement 伞票，正常——切片 5 为其收尾票）；**父 PR #241**：OPEN（MERGEABLE）——见 R30（同 #244 R9 / #245 R25 连续裁定）。
- **运行基线**：`docs/protocols/instance-replication-v1.md` 947 行在库；`packages/replication-protocol`（codec + golden + 版本/能力协商矩阵测试）与 `packages/ws-replication`（transfer 状态机 + observer + 刻画/红绿灯测试族）模块契约 AGENTS.md 与验证门齐备；工作树仅含未跟踪简报快照 `wiki/raw/task_issue-246.md`（evidence，非规范），无未提交漂移。

## 4. 就绪注意项（非阻塞，转交 SA1；编号接续 #245 门禁 R20–R25）

- **R26 · 简报所列各节大多已登记——本切片文档面实为「收口」而非「新登记」**：§5/§6.1/§13.2/§17/§23.1/§22 的分块条目已由切片 1–4 逐票登记（各带 issue 归注）。#246 的实质新增只有：①§10.3 跨帧规则/发送接收端规则/transfer 身份/ACK 锚点（现状 L312 明文「属后续切片」）；②ADR 0013 接受与权威登记；③§22 语言收口；④CONTEXT.md 过期标注清理；⑤全文一致性清障。SA1 须按「校验/保持/收口」定界，**不得重复登记、不得改动已冻结面（消息码、字段序、错误码语义、事件键集、配置缺省与校验链）**，AC1 的「逐字一致」以三方对照（ADR ↔ 协议 ↔ 实现 + 测试锚）验收。
- **R27 · 「v1/v2」实现代际词表欠定义**：协议文档全文零「v2」用法；「v1」一词现承担双义（协议版本 1——标题/`protocolVersions`/envelope 层，与旧实现代际——§5 L113「v1 的 HELLO 仍发 optionalCapabilities=0」）。互通矩阵引入「实现代际」第三层语义，SA1 须显式命名并三层消歧（envelopeVersion / protocolVersions / implementation generation），按 docs/AGENTS.md 词汇规则评估是否需要 CONTEXT.md 增词——不得让「v2」被误读为协议版本 2（ADR 0013 明文 envelope version 恒 1、零新协议版本）。
- **R28 · 「v2 peer ↔ v1 hub」格的实现可行性缺口**：hub 侧 `HUB_SUPPORTED_CAPABILITIES = CAP_CHUNKED_UPDATE` 为模块常量（`hub-connection.ts:64`），无配置旋钮——新码 hub 被置位 offer 时必回选该 bit，无法直接扮演 v1 hub。SA1 须二选一并显式设计：testing surface / 可注入 supported-capabilities 覆盖 seam，或等价性论证（旧 hub ⇔ 交集计算 = 0 的 hub）+ 逐字节断言（该格 `HELLO_ACK.selectedCapabilities === 0`、后续超限走 v1 丢弃 + needs-resync）。属设计缺口，非冲突。
- **R29 · 「锁定依赖组合的旧/新互通」锚定既有资产**：§22 L652 该义务已由 codec 层兑现（`codec-version-interop.test.ts`：版本协商全矩阵 + golden 旧字节 × 新 codec 互通）。SA1 应以既有矩阵为锚增补传输层构型，**不要**发明「安装旧版包」的多版本 harness——`@nomicore/ws-replication` 为 workspace-only 包，仓内无旧版安装机制。
- **R30 · ADR 0013 接受时点与父 PR 未合并**：接受翻转发生在 #241（MERGEABLE，OPEN）未合并时——与切片链先例一致（全部切片经分支链最终由 #241 汇聚合并），且 ADR L4 预设「接受 + 协议修订为唯一权威」同票完成。不阻塞；仅提示总控：若 #241 后续发生方向性返工，本门禁结论需复审（R9/R25 连续条款）。
- **R31 · 接受后的权威让渡边界须显式刻画**：ADR L4 让渡对象是「wire 冻结值」（消息码、字段序、词表锁定值）→ 协议文档唯一权威；但协议 §17 L535 现文「issue #242 / ADR 0013 配置表为权威」把配置表权威留在 ADR。SA1 修订时须显式划定两层（wire 冻结值 → 协议文档；配置语义/设计理据 → ADR 0013 保留），避免「唯一权威」措辞误伤配置表归属；同时清理全部「提议」残留（CONTEXT.md L142「（ADR 0013 提议）」已实测确认，ADR L4 状态行自身），AC5 过期术语搜索以「提议」为零为验收。

## 5. 结论

**门禁通过（clear）**。issue #246 任务简报是 ADR 0013「后果」节显式预设的文档收口与接受票：所列各修订节与 ADR 0013 逐条同源且大多已由切片 1–4 登记，实质新增（§10.3 跨帧规则、ADR 接受与权威让渡、互通矩阵、§22 收口）全部有 ADR 条款或既有 conformance 义务直接预授权；与 ADR 0010 及其余 ADR、CONTEXT.md 零抵触；blocked-by #245 已满足且其交付面正是本简报的校验对端；互通矩阵三格中两格实现面直接可得（缺省 `chunkedUpdate=false` = v1 逐字节、#233 刻画测试即 v1 基线），v1-hub 格存在已知可行性缺口（R28）属设计裁量而非冲突。可进入 SA1 设计；R26–R28 为设计后复审（轻量）核对项，R29–R31 为落地同步义务。
