# SA9 标准评审 — issue #246：分块传输 wire 契约收口与新旧互通矩阵（issue #233 切片 5）

- Dispatch：`sa-72974487-d26a-46b1-b76e-d1b0220af1d1`（mabf-sa9 / standards-review / iteration 0）
- 评审对象：committed HEAD `fffbc940a5a5e50a0ab1a9f112be8086a5e36257`（`docs(replication): finalize chunked transfer protocol contract`，单提交交付；父提交 = 权威父 PR #241 head `2c95ddc017024d25febb1a5685d151944a50d0c1`——`git log --format='%H %P'` 实测父指针恰为该值，`git merge-base --is-ancestor` 成立，变基落点正确）
- 评审范围（SA9 职责）：仓库 AGENTS/ADR/模块责任/既有架构惯例/单一事实源/生命周期对称性/文件范围/测试质量标准；**不**复核 Issue 需求实现完备性（归 SA10）、不重跑测试、不启动服务（以 SA3/SA7 在库日志为证据面并逐项核对其与 HEAD 树同一性）
- Owner 评论：REST 快照 `[]`（dispatch 声明；简报 `## Comments` 空节、SA1/SA2/SA3/SA4/SA7/SA8 六方登记一致）——零 owner 评论要求需并入

## 1. Reviewed inputs（实读/实测）

| 输入 | 状态 |
|---|---|
| HEAD 提交元数据 + 父指针 + 工作树状态 | 实测（`git log`/`merge-base`/`status --porcelain=v1`） |
| HEAD 全量 diff（交付面 5 文件：3 文档 + 2 新测试；另含 artifacts/wiki 流程产物） | 实读（3 文档 diff 全文；File A 357 行全文逐行；File B 687 行全文逐行） |
| 交付文件与 SA4/SA7 批准基线同一性 | 实测 md5 五者全一致（File A `f5fc29e6…`、File B `4e771651…`、CONTEXT `2c5c9a73…`、ADR `922307e7…`、协议 `a3c8ade9…`） |
| SA1 设计（iteration 1）`task_issue-246_design.md`（409 行） | 实读全文 |
| SA2 复审 `task_issue-246_sa2_review.md`（approve，0B/0M，N7–N9） | 实读全文 |
| SA3 实现报告 `task_issue-246_sa3_impl.md`（iteration 3） | 实读全文 |
| SA4 复审 `task_issue-246_sa4_review.md`（approve，F1 闭合） | 实读全文 |
| SA7 动态验证 `task_issue-246_sa7_report.md`（approve） | 实读全文 |
| SA8 两门禁 `artifacts/sa8-conflict-gate-issue-246.md`（clear，R26–R31）/ `-recheck.md`（clear） | 实读全文 |
| 规范基线：`docs/protocols/instance-replication-v1.md`（§1/§5/§10.3/§13.2/§17/§22/§23 头注，HEAD 文本）、`docs/adr/0013`（L4/协商/后果/取代与关联）、`CONTEXT.md` 分块词条区 | 实读 |
| 实现锚点抽查：`update-channel.ts`（inFlight/activeTransfer/ack 计时锚）、`update-transfer.ts`（validateFirst/跨帧规则/收齐核对）、`hub-namespace.ts`/`peer-namespace.ts`（chunkCount 门/并发槽/assembly 超时）、`payloads.ts`（未协商解码前拒绝）、`negotiation.ts`（selectCapabilities）、`hub-connection.ts`（connectionId 格式/交集消费） | 实读 |
| 仓库契约：根 `AGENTS.md`、`docs/AGENTS.md`、`packages/replication-protocol/AGENTS.md`、`packages/ws-replication/AGENTS.md`、交付先例（#244 `733b3a7` / #245 `d1888cc` commit 组成） | 实读/实测 |
| 在库证据日志：`sa3-issue246-pnpm-test-iter1.log`（304 文件 3261 测试全绿 exit=0）、`sa7-issue246-fileB-20x.log`（20/20 exit=0）、`sa3-issue246-doc-checks-iter3.log`（六查零命中 + diff --check 干净）、typecheck 日志 | 实读关键行 |

## 2. Verdict

**approve** —— 0 × BLOCKER / 0 × MAJOR；1 × MINOR（M1：已提交 SA3 报告引用的部分 iter3 证据日志未随交付提交——流程证据留档完整性，非规范面）+ 3 × 观察项（均不阻断，两条承自 SA4/SA7 已登记项）。

交付与批准设计（SA1 iteration 1）及 SA4/SA7 批准基线逐字节同一（md5 五者实测一致）；变基父指针恰为 PR #241 head `2c95ddc`；零生产代码改动（`packages/*/src/**`、`apps/**`、`domains/**` diff 空实测）；冻结面（§5/§6.1/§9.4/§13.2/§17/§23.1/§10.3 六字段表）零触碰（协议文档仅 4 行删除，全部为占位句/注记改挂）；ADR 0013 接受与两层权威让渡按 ADR 自身 L4 预设机制同票闭环；AC5 过期术语六查本评审独立复测全部零命中、`git diff --check` 干净。

## 3. 逐轴标准核验

### 3.1 AGENTS.md 合规（根 + docs + 两包级）

| 要求 | 核验（本评审独立实测） | 结论 |
|---|---|---|
| Instance replication 变更以 ADR 0010 + `instance-replication-v1.md` 为规范权威（根 AGENTS） | 全交付围绕协议文档收口；ADR 0010 零改动且零分块引用（`grep -nE "UPDATE_CHUNK\|CAP_CHUNKED\|分块" docs/adr/0010-*.md` 本评审复测零命中；File A D6-3 可执行守卫同向锁定） | 合规 |
| 词汇精确；新增/变更词条同步 CONTEXT.md（docs/AGENTS Editing 1） | 新词「实现代际（implementation generation）」同票登记于协议 §1 与 CONTEXT.md，双侧同义且均带 _Avoid_（「把 v2 代际误读为协议版本 2 / 用代际推断 envelopeVersion/protocolVersions 变化」）；§5 注记与 §22 两条目改挂「v1 代际」并回指 §1——三层消歧（envelopeVersion / protocolVersions / 实现代际）成立 | 合规 |
| 显式修订/取代既有决策而非静默矛盾（Editing 2） | ADR 0013 状态行「提议」→「已接受」为显式翻转，且正是 ADR L4 自预设的「接受 + 协议修订为唯一权威」同票闭环；「取代与关联」节旧未来时子句「接受后以该文档修订」已改已生效表述（File A D1-4 负向锚锁定） | 合规 |
| 链接权威源而非多点复制规则（Editing 3） | wire 冻结值权威唯一化到协议文档（ADR L4 + 取代节双层登记：配置语义/理据保留 ADR「资源上限与配置链」）；CONTEXT.md UPDATE_CHUNK 词条改挂指向协议 §10.3 而非复制规则；§17 L558「issue #242 / ADR 0013 配置表为权威」原样保留——「唯一权威」未误伤配置表归属（R31 边界自洽） | 合规 |
| 文档-only 措辞不得虚构实现行为（Editing 4） | §10.3 新正文逐条有实现/ADR 出处，本评审抽查全部属实：transferId (ns,方向,连接) 域自 1 严格递增（`update-channel.ts:118` 注释+`nextTransferId=1`）；chunkable 门控 = 已协商∧超限∧≤上限∧域未耗尽（`:151-156` 区注释/实现）；transfer 占 1 窗口槽直至末 chunk ACK、ACK 计时锚 = 末 chunk 出站（`effectiveInFlightCount = inFlight.size + (activeTransfer?1:0)`、末 chunk 出站 `inFlight.set`+`armAckTimer`）；首 chunk 分配前二维上界+几何一致（`update-transfer.ts` validateFirst：totalBytes 超上限→TOO_LARGE、几何→VIOLATION）；chunkCount 门在控制器分配前（`hub-namespace.ts:707-710`/`peer-namespace.ts:690-693`，`>` 判定、=== 恰接纳）；并发槽超额→VIOLATION 且 ns 级连接保持 ready；超时→`RESYNC_REQUIRED{UPDATE_TRANSFER_EXPIRED}`（`hub-namespace.ts:1616`/`peer-namespace.ts:1897`）；未协商 0x42 在 payload 解析前 `UNSUPPORTED_MESSAGE_TYPE`（`payloads.ts:830-836`） | 合规 |
| docs 验证门：链接/引用文件名、过期术语、`git diff --check`（docs/AGENTS Verification） | AC5 六查本评审独立复测全部零命中（exit=1）：`提议`（docs/+CONTEXT 全局）、`状态：提议`、`ADR 0013 提议`、`属后续切片`、`后续切片承接`、ADR 0010 分块引用；`git diff --check` 干净；D6-1/D6-2 把文件名/路径存在性可执行化（断言源仅 `docs/`+CONTEXT.md，禁读 `wiki/raw/**`——File A 全文实测仅头注纪律声明含该串，零实际读取） | 合规 |
| replication-protocol 包边界：codec 传输/Registry 无关、兼容性注册表 append-only、导出经 `src/index.ts` | 本票零 src 改动（diff 实测空）；新测试文件只读消费 `MESSAGE_TYPES`/`CAP_CHUNKED_UPDATE` 既有导出做三方锁（D5-4），不新增 API、不触碰注册表值 | 合规 |
| ws-replication 包边界：注入 transport/scheduler/observer seam、测试用公共 API + testing 面克制 | File B 仅消费公共 API（`createHubReplication`/`createPeerReplication`/codec）与既有 harness 构件；interposer 为测试本地 `DuplexTransport` 包装（onMessage 退订句柄原样透传），生产面零 seam 新增（`HUB_SUPPORTED_CAPABILITIES` 常量零 diff）；未改共享 fixture（`harness.ts`/`driver.ts`/`issue137-driver.ts` 零 diff 实测） | 合规 |
| 包级验证门（焦点测试 + 包 typecheck + 根 typecheck/test） | 在库证据：`sa3-issue246-typecheck-iter1/iter3.log`（两包 + 根 14 工程 exit=0）、`sa3-issue246-pnpm-test-iter1.log`（304 文件 / 3261 测试全绿、Type Errors no errors、exit=0，含 File A L10 / File B L280 / #233 L446 实测行）；SA7 复核工作树与该证据对象逐字节一致 | 合规（证据在库可复核） |

### 3.2 ADR 符合性

- **ADR 0013 接受机制**：状态行翻转内容完整——切片 1–5 落地枚举、接受日期、wire 冻结值枚举（消息码 `0x42`/payload 字段序/capability/错误码/reason 词表锁定值）→ 协议文档唯一权威、配置表与设计理据保留本文、observer 事件词表单列 local seam 词表（协议 §23，非 wire 契约）。枚举拆分（F4 修复形态）与 §23 头注「属于 local seam：不改变任何 wire 字节，不新增帧/字段/错误码」零矛盾（File A D1-2 负向 + D1-5 正向双向锁定）。
- **ADR 0010 边界**：零改动、零分块引用（实测）；§10.3 新正文明文「ACK 计时锚 = 末 chunk 出站时刻（`ackTimeoutMs` 语义不变）」「中止复用既有机制」——ACK durability/停机序/backpressure 分层零语义触碰；ADR 0013「扩展而非修订」关系句保留。
- **ADR 0012**：HELLO 字段序冻结、仅 bitset 取值域扩展——本票零字段变更；interposer 仅测试域改写 4 字节 capability 窗口且字节对断言证明其余字段（peerInstanceId/expectedHubInstanceId/protocolVersions/requiredCapabilities/connectionNonce）原样保留。
- **后果节义务履行**：ADR L109-110 预设的「落地时须修订协议文档并补 golden vectors 与旧/新互通矩阵」「刻画测试保留为现状基线」由本票闭合；#233 刻画文件零改动（DENY 遵守，diff 实测不含该文件）。
- **接受时点（R30）**：接受发生在父 PR #241 未合并时——切片链连续先例（#244 R9/#245 R25），SA8 recheck 已实测父分支前进 commit `2c95ddc` 与本票文件交集为空、非方向性返工；本评审复核变基后父指针恰为该 commit，结论保持。

### 3.3 模块责任与既有架构惯例

- wire 契约权威 → 协议文档；配置语义/理据 → ADR 0013；codec 常量 → replication-protocol；状态机/传输 → ws-replication；文档契约可执行化 → 包内 vitest include 域（root `tests/` 为 Python VFSL 验收，不在 include——包内是唯一可执行位置，SA2 已核、本评审复核 `vitest.config.ts:15` include 实测覆盖两新文件）。
- 命名谱系：File A `codec-` 前缀与同目录 `codec-package-contract.test.ts` 一致（SA2 N5 登记不改）；File B `ws-replication-issue246-` 前缀与 #233/#243/#244/#245 issue 前缀测试族一致。
- File A 跨出包界读仓库根 `docs/`+CONTEXT.md——包内首个此类契约测试，头注显式登记读取边界与「禁读 wiki/raw」纪律（`docs/AGENTS.md:5` Authority 背书）；断言形态（锚定子串/正则 + 最近标题节切片）与既有 `codec-package-contract.test.ts` 读文件先例同谱系。
- 测试纪律与既有套件一致：真实 yjs/Registry/Runtime + fake-duplex + fake scheduler + 零 real sleep；`decodeWire` 协商上下文解码 = #243 L111-112 先例（N6）；`makeNode` 独立 `makeCounterRandomBytes` 计数随机源复用（N9 前提，头注登记）；observer collector 按观测侧分别断言、禁止双侧汇总（N4）。
- commit message  conventional 风格（`docs(replication): …`）与历史一致；交付 commit 组成（源码面 + artifacts 日志 + wiki/raw 任务产物）与 #244/#245 交付先例一致。

### 3.4 单一事实源

| 事实 | 权威源（交付后） | 派生/断言面 | 漂移封堵 |
|---|---|---|---|
| wire 冻结值（0x42/字段序/capability/错误码/reason 锁定值） | 协议文档 | ADR 历史正文、实现常量 | D5-4 三方锁（`MESSAGE_TYPES.UPDATE_CHUNK === 0x42`、`CAP_CHUNKED_UPDATE === 0x00000001` 与文档登记值可执行相等断言）；D5-1/2/3/5 冻结面绿锚 |
| 决策状态 | ADR 0013 状态行 | CONTEXT.md 标注（「ADR 0013 已接受」同票同步） | D1-1/D3-3 负向断言 + 全局「提议」零命中（本评审复测） |
| 实现代际词表 | 协议 §1 词条 | CONTEXT 同义词条、§5/§22 改挂 | D3-1/D3-3 锚 + D3-2 负向串（「协议版本 2」/「envelope v2」/「protocol v2」禁现） |
| §22 conformance 资产指向 | §22 条目（仓库根全路径，SA2 N7 采纳落地） | 五个被引资产 | D6-1 存在性可执行检查；本评审实测五资产全部在库 |
| v1 行为基线 | #233 刻画测试（零改动） | M1 传输层参照系 | DENY 遵守 + AC3 末句绿证据在库 |

### 3.5 生命周期对称性

零生产生命周期变化（`packages/*/src/**` 零 diff 实测）。测试域：interposer 为会话域一次性包装，`onMessage`/`onClose` 返回的退订句柄原样透传、`send`/`close`/`closed` 纯委托——获取/释放路径对称；File B `write` helper 内业务 lease 经 `business.release()` 显式释放；M1/M2/M3 每 `it` 独立组装（独立 Registry/Runtime/随机源），无跨用例共享状态；`before/after` 帧切片隔离每次写增量，跨腿计数不混入 wire 断言。协议侧 §10.3 收口的生命周期语句（assembly 易失作用域、全部丢弃路径、transfer 窗口槽占用至 ACK）与实现注释逐一同向（本评审抽查属实），无新增非对称面。

### 3.6 文件范围

- ALLOW 6 项逐项对应：协议文档（§1/§5 注记/§10.3/§22）、ADR 0013（L4 + 取代节，diff 实测仅 2 hunk）、CONTEXT.md（L142 注记/UPDATE_CHUNK 词条/新词条）、File A（新）、File B（新）、设计文档（流程产物）。
- DENY 零越界（`git status --porcelain=v1` + diff 实测）：`packages/*/src/**`、`apps/**`、`domains/**`、`vitest.config.ts`、`package.json`、`tsconfig*`、`pnpm-lock.yaml` 零改动；#233 刻画文件、共享 harness/driver 三件、既有 codec 测试五件、ADR 0010 及其余 ADR 零改动；§5/§6.1/§13.2/§17/§23.1 既有登记行原样（协议 diff 仅 4 行删除：§5 注记句、§10.3 切片注记句、§10.3 占位句、§22 旧分块条目——全部为收口/改挂，非冻结面改动）。
- 流程产物（artifacts 日志 + wiki/raw 任务链文件）随交付提交，与 #244/#245 先例一致。

### 3.7 测试质量标准

| 维度 | 核验 | 结论 |
|---|---|---|
| 纪律红线 | `skip`/`only`/`todo`/`console.*`/real sleep/Date.now 两文件 grep 零命中（本评审实测；唯一命中为头注「零 real sleep」纪律声明自身） | 合规 |
| 源码 grep 断言 | File B 零源码字符串断言（行为断言全经公共 API/observer/wire 帧）；File A 断言源仅规范文档 | 合规 |
| 确定性（F1 验收面） | 跨会话零字节/长度相等断言（File B 全文实测：唯一字节级断言 = interposer 同会话原始↔重写 HELLO 字节对 L533-559，定长 uint32BE 窗口 [0,0,0,1]→[0,0,0,0]）；M2≡M1 三层形态 = (a) kind#sequence 序列全等、(b) 确定性字段逐字段（排除 connectionNonce/connectionId/Yjs 字节）、(c) Yjs 承载帧 kind+计数（+namespaceId）；三层比对位于四条对称回落腿之后（L571-581），覆盖超限 hub→peer 载荷腿 | 合规 |
| 红灯先行 | File A 红面 12 条（D1-1..5/D2-1..3/D3-1/D3-3/D4-1/2）与设计 §12.1 枚举一一对应；SA3 以 stash 法独立复现 12 failed \| 10 passed 并 md5 还原全 OK（`f1-fix-iter3.log`）；本评审复核红面锚针对预交付文档现状确为真红（占位句/旧状态行/缺词条/缺 §22 条目均为交付前事实） | 合规 |
| 无弱化通过面 | M2 新增 hubToPeer 腿为内联真调用 `assertV1Fallback`，回落缺失/多少帧/不收敛任一回归直接红；收敛谓词要求副本值 === BIG 且离开 needs-resync/reconciling，无静默通过；恰一性按观测侧（发射侧 send-failed + 接收侧 remote-declared + wire RESYNC_REQUIRED 各恰一） | 合规 |
| 稳定性正式验收 | SA7 20 次串行全新进程 `20/20 exit=0`（`sa7-issue246-fileB-20x.log` 在库，逐行计数复核）；类型面由 vitest `Type Errors no errors` 在位复验 | 合规 |
| 触发面 | 根 `pnpm test` include 覆盖两文件（`vitest.config.ts:15` 实测）；CI 分片磁盘枚举零配置改动 | 合规 |

## 4. Findings

### MINOR（不阻断）

- **M1（流程证据留档完整性）**：已提交的 SA3 iteration 3 报告 Verification 表引用 `artifacts/sa3-issue246-{fileA-red,fileA-green,fileB-green,pnpm-test}-iter3.log` 四件，该四件在交付 commit 中未包含（当前仍为未跟踪工作树文件）；交付已含等价覆盖（`pnpm-test-iter1` 全绿、`fileB-20x-iter3`、`doc-checks-iter3`、`typecheck-iter3`、`f1-fix-iter3` 还原校验、SA7 正式 ×20 日志），关键主张零证据缺口。另：简报 `wiki/raw/task_issue-246.md` 未随交付提交（#245 先例提交了简报）。artifacts/wiki 属非规范 evidence（`docs/AGENTS.md:5`），不影响任何标准轴结论；建议 finalizer 一并收编以闭合追溯链。

### 观察项（登记，不阻断）

- **O1（承 SA4 N-OBS1，已在 SA3/SA4/SA7 三方登记延后）**：File A D2-3 两错误码锚为同节存在性形态——并类/删除即红，但两码「对调」不红。当前文本三方对照正确性已由 SA2/SA4 独立核验、本评审复核 §10.3 与 §13.2 分类逐字同向（TOO_LARGE=fatal/config/failed、VIOLATION=fatal/no/failed）；归后续测试强化票，非本票缺陷。
- **O2（措辞微差）**：§10.3 字段表 transferId 行写作用域「(连接, 方向, namespace)」，同节 transfer 身份段写「(连接, 方向, namespaceId)」——同义指称、非矛盾（接收端作用域四元组段两处均 namespaceId）；后续文档维护可顺手统一。
- **O3（承 SA4 N-OBS5）**：File B 会话未显式 teardown——与 #233 刻画文件同惯例（fake scheduler/duplex，进程退出即清；#233 文件 grep 零 stop/close/afterEach 实测），helper 内 lease 释放对称（§3.5），无资源泄漏面。

## 5. 复核命令留档（SA9 只读；未运行测试/服务，未改任何文件——本报告为唯一写入）

- 变基与同一性：`git log --format='%H %P' -1`（父 = `2c95ddc…`）、`git merge-base --is-ancestor`（成立）、`git status --porcelain=v1`、`md5sum` 五交付文件（与 SA4/SA7 批准基线逐字节一致）
- 文件范围：`git diff 2c95ddc..fffbc94 --stat -- packages/ws-replication/src packages/replication-protocol/src apps domains`（空）、`--name-only`（非 artifacts/wiki 条目恰 5 交付文件）、协议 diff 删除行枚举（恰 4 行，全为占位/注记）
- 文档现状：`grep -rn "提议" docs/ CONTEXT.md` 等 AC5 六查全部零命中（exit=1）；§10.3/§13.2/§17 L558/§22/ADR L4+取代节/CONTEXT 词条区实读
- 实现锚点：`update-channel.ts`（inFlight/activeTransfer/ack 锚）、`update-transfer.ts`（validateFirst/accept/completeIfExact）、`hub-namespace.ts:707-716,1605-1616` / `peer-namespace.ts:690-699,1883-1897`、`payloads.ts:828-836`、`negotiation.ts:26`、`hub-connection.ts:765`
- 测试纪律：两文件 `skip|only|todo|console.*|setTimeout|Date.now` grep 零命中；File A 断言源枚举（仅 PROTOCOL/ADR13/ADR10/CONTEXT 四读）；File B 全文逐行读（L1-687）
- 证据日志：`sa3-issue246-pnpm-test-iter1.log` 尾部（304/3261 全绿 exit=0）、`sa7-issue246-fileB-20x.log`（20×exit=0）、`sa3-issue246-doc-checks-iter3.log`（六查 exit=1 + diff --check exit=0）
- 先例比对：`git show d1888cc --stat` / `git show 733b3a7 --stat`（交付 commit 含 artifacts/wiki 流程产物为先例惯例）；`ws-replication-issue233-repro.test.ts` teardown 惯例 grep
- §22 资产存在性：五个被引 `*.test.ts` + real-transport 套件逐一 `test -f` 全部在库

## 6. 结论

**approve**。issue #246 交付（HEAD `fffbc94`，父 = PR #241 head `2c95ddc`）在全部八个标准轴上合规：AGENTS 治理（词汇同步、显式修订、权威链接、零虚构行为、docs 验证门）、ADR 符合性（0013 按其自预设机制接受、0010/0012 边界零触碰）、模块责任与既有惯例、单一事实源（含 D5-4 三方锁与 D6-1 存在性检查）、生命周期对称性（零生产变更 + 测试域对称）、文件范围（ALLOW/DENY 零越界）、测试质量（纪律红线零违规、F1 确定性形态、红灯先行独立复现、×20 稳定性正式验收在库）。1 条 MINOR（流程证据留档完整性，归 finalizer 收编）+ 3 条观察项均不阻断。`requiresConflictRecheck = false`（SA8 前置门禁 + 实现后 recheck 双 clear，本评审未引入新冲突面）。
