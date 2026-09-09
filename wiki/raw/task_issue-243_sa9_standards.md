# SA9 标准评审 — Issue #243（issue #233 切片 2：协商 CAP_CHUNKED_UPDATE 超限 UPDATE live 分块传输）

- Dispatch：`sa-c91ed05a-5b35-43a2-b747-63e811b19cfb`（mabf-sa9 / standards-review / iteration 0；final-verification 组，与 SA10 并行）
- 评审对象：worktree `nomicore-fix-issue-243`（branch `mabf/issue-243`，权威 base `feat/issue-233-chunked-update-base@c20aeb09573564b6a8e50681002b7ba9fdba137e`，dispatch 声明显式 fetch 核对、无需 rebase）工作树交付 diff：12 tracked 修改（10 src + 2 test）+ 4 新文件（`update-transfer.ts` + 3 测试文件）
- 输入链：SA6 契约（approve）→ SA8 前置门禁（clear，D1/D2/W1–W4）→ SA1 设计 iteration-2（F1–F7 全修订面）→ SA8 r1/r2/r3（clear；r3 履行 F6 路径 B 定向复核义务，O5 解除）→ SA2 iteration-2（approve，0 BLOCKER/MAJOR/MINOR）→ SA3 实施报告（iteration 1 recovery，586/586 + 23/23 + typecheck 绿）→ SA4（approve，两处测试侧偏离裁定接受）
- Owner 要求：dispatch 声明 issue #243 评论 REST 快照 `[]`（dispatch 前即刻刷新）——**无 owner 衍生要求适用**；需求面 = issue body 8 条 AC（需求完整实现判定归 SA10，本评审只判标准符合性）
- 结论：**approve** —— 0 BLOCKER、0 MAJOR；2 项 MINOR（非阻塞登记，§6）。代码、测试、当前轮产物与已批准设计/契约全部符合仓库 AGENTS/ADR/模块责任/架构惯例/单一事实源/生命周期对称/文件范围/测试质量标准
- 方法：独立实读全部 16 个交付文件的 diff/全文（非仅复核上游结论）；静态判据自行 grep 复验；未运行测试、未改任何文件（SA9 纪律）

## 1. AGENTS 与架构契约符合性

| 标准面 | 证据 | 判定 |
|---|---|---|
| 根 AGENTS「Instance replication」（ADR 0010 + 协议文档为权威） | 实现与 ADR 0013 发送端规则（出队惰性切片、队列持完整 update、整笔 1 槽、每帧独立 sequence/RR/闸门、ACK 锚=末 chunk 出站）及接收端规则（纯易失 assembly、分配前上界校验、严格递增、Σ 核对、恰一次 apply、失败零 Y.Doc 写入）逐条对齐——`update-channel.ts` DD-3 状态机 + `update-transfer.ts:115-149` 校验序实读一致；切片边界延后项（maxChunksPerUpdate/maxConcurrentAssemblies/assemblyTimeoutMs、observer 四事件、协议文档修订）均经 SA8 D1/D2/W1–W4 裁决归 #244/#245/#246，设计 §1 非目标与 DENY 一致 | 符合 |
| 包 AGENTS「Route namespace ownership…transport layer never reaches into Runtime」 | 收齐后 `void this.applyRemoteUpdate(result.bytes, sequence)`（peer-namespace.ts / hub-namespace.ts 新增管线）复用既有 ReplicationSession 管线；零 Runtime/Persistence/Y.Doc 内部触达 | 符合 |
| 包 AGENTS「Export production APIs through src/index.ts」 | `index.ts` 零改动（git status 实证）；新模块 `update-transfer.ts` 不经 index 导出（文件头注 :19 明示包内私有）；公共类型面（`ReplicationLimits.maxChunkedUpdateBytes`、`PeerReplicationOptions.chunkedUpdate`）经既有导出自动携带 | 符合 |
| 包 AGENTS「Keep admission bounded」 | D1 落实：`validateFirst`（update-transfer.ts:161-174）全部上界校验先于 `new Uint8Array(totalBytes)`（:120）；发送端 chunkable 项仍过 `maxQueuedUpdateBytes/Count` 预算 | 符合 |
| 包 AGENTS「injected transport/scheduler/observer seams」 | chunk 帧经 `tryEmitData` 同一 data 出站点（水位/单帧守卫/账本投影/序列单点分配）；`sendUpdateChunkFrame` 控制器侧 try/catch 纪律与 `sendUpdateFrame` 同款；两角色 `sendUpdateChunk` 分别逐字镜像各自既有 `sendData` 门形（hub 裸 tryEmitData / peer outbound+ready 门） | 符合 |
| 包 AGENTS「Preserve protocol ordering and FSM invariants」 | HELLO 门保持：peer 在 `onHelloAck` 身份校验通过后、ready 前逐字捕获 selectedCapabilities（:437）；hub `onHello` 以 `selectCapabilities` 单点交集（替代 required!==0 直判，ok=false → 既有 UNSUPPORTED_CAPABILITY）；握手期 decode 门值 0 = v1 逐字节 | 符合 |
| 根 AGENTS 诊断日志纪律 | 零新增 emission 调用点；apply 复用既有管线（W4 遵守）——diff 全文零 diagnostic 触点 | 符合 |
| ADR 0010/0012 / 协议 §6.2/§6.3/§9.4 | SA8 三轮复核 clear（C1–C41）；本席抽核：§9.4「任一端可声明 + Peer 发起 round」字面许可内（peer F6 声明 + 既有 reason `send-queue-overflow`，零新词表）；hub `drainActive` 丢弃名单显式 +`UPDATE_CHUNK`（hub-connection.ts:758，§6.3 drain 语义）；peer drain 允许名单零改动（chunk drain 期静默丢弃） | 符合 |
| CONTEXT.md 词条 | 「分块复制传输/UPDATE_CHUNK/CAP_CHUNKED_UPDATE」已有（slice 1）；F6 使「中断即丢弃并回退 reconciliation」在两方向首次以 wire 信号落地（SA8 r3 §4 正式解除 O5）；CONTEXT.md 零改动 | 符合 |

## 2. 单一事实源

| 面 | 证据 | 判定 |
|---|---|---|
| 切片几何 | `chunkCountOf`/`chunkBounds`/`geometryConsistent` 单模块（update-transfer.ts）发送端切片与接收端校验共享；`update-channel.ts` import 复用 | 符合 |
| 协商交集 | hub `onHello` 单点 `selectCapabilities`（replication-protocol/negotiation.ts:26 已导出函数复用）；peer 逐字消费 HELLO_ACK.selected，不复制交集计算（F5 裁决——零第二事实源） | 符合 |
| RESYNC_REQUIRED 发射点全集（F7 静态判据） | 本席独立 grep `kind: 'RESYNC_REQUIRED'`（packages/ws-replication/src）：**恰 2 处** = peer `declareLocalResync`（peer-namespace.ts:1101）+ hub `declareHubResync`（hub-namespace.ts:930）——`onWatchdogEdge` 内联声明已收敛入漏斗（diff 实读：声明段替换为 `declareLocalResync('session-fanout-overflow')`，`markSessionResyncEdge` 幂等前置保持，指令序逐行等价）；发射点全集 == 挂点全集 | 符合 |
| 窗口占用口径 | `effectiveInFlightCount()` 唯一包内只读访问器（update-channel.ts:118-121，不经 index 导出）；deliver 直发前置 / pullAndSendOne 初始化前置 / peer 周期 reconcile 延后判据三消费方 | 符合 |
| 会话协商状态 | 每连接单一 `negotiatedCapabilitiesValue`（dialNow 复位 0；hub 单握手生命周期）；发送门（`chunkedSendEnabled`）与 decode 门共用同一判据 | 符合 |

## 3. 生命周期对称性

| 面 | peer | hub | 判定 |
|---|---|---|---|
| assembly 清理挂点 | onResyncReceived（:594-595）/ 漏斗记忆化门后（:1098-1099）/ 恢复结算边 resyncEpisode 门控（:1027-1030）/ tryOpen 新会话（:446-447）/ runDisposal（:1561-1562）/ 违例复位（transferViolation） | onResyncReceived（:779-780）/ 漏斗（:927-928）/ 结算边（:1178-1181）/ closeSessionAndRelease（:1311-1312）/ 违例复位 | 对称闭合（hub 通道不跨连接存活，无 tryOpen 对偶——结构性正确） |
| 终态 ⇒ assembly 释放（ADR 0013:58） | finalize → cleanupResources → runDisposal（身份守卫通过即清，:1561）——本席沿调用链实读确认 | closeSessionAndRelease 单点 | 符合（设计挂点 4 映射 = 收口/处置单点） |
| transferId 作用域 | `teardown()` 归 1（update-channel.ts，连接收口/新会话标记）；resync/终态不复位 | 同一 UpdateChannel 实现 | 符合（ADR 0013:32） |
| ack-timeout 弃置信号（F6） | `onAckTimeoutFired(abortedTransfer)`：true → 漏斗 wire 声明；false → PN6b 原体逐字节；分派在 `live \|\| needs-resync` 外层门**内**（:1042——SA8 r3 O7 守门要求满足） | 既有 `declareHubResync('ack-timeout')` 不变（`onAckTimeout: (_abortedTransfer) => …` 忽略参数） | 两方向对称闭合 |
| 接收管线 | 静默门 → busy/残渣/首 chunk 判别 → 首 chunk 状态镜像门（`live \| needs-resync \| reconciling∧wasLive`）→ assembler | 同形 + submit 门（首 chunk 判、分配前） | 对称 + hub submit 门镜像 onUpdate |
| 残渣判别（F3） | quiet 静默 / needs-resync∧reconciling 良性 / live fail-loud | 同形 | 逐字对称 |

## 4. 文件范围（ALLOW/DENY）复核

- **ALLOW 内（10 src + 3 test 新文件 + api.test-d）**：全部有 DD 归因，与设计 §11 逐路径一致；`index.ts` 零改动（设计「仅当需要时补」——typecheck 绿证明不需要）。
- **DENY 零实质触碰**（git status 实证）：`replication-protocol/**`、`issue233-repro` 冻结刻画、`docs/protocols/instance-replication-v1.md`、`docs/adr/0013`、`CONTEXT.md`、`backpressure.ts`、`round-engine.ts`、`observer.ts`、`namespace-runtime/**`、`namespace-registry/**`、apps 契约文件——全部未触达。协议纪律随之成立：**零新帧型、零新 reason、零新 observer 事件类型/cause**（grep 实证 `chunked-update-*` 零命中；`update-sent/acked/applied` 复用既有三事件面，N2 裁定）。
- **两处测试侧偏离**（见 §6 M1）：已披露、已裁定、语义保持——不升级为 findings。

## 5. 测试质量标准

| 标准 | 证据 | 判定 |
|---|---|---|
| 行为断言（非源码 grep/字符串断言） | K0–K15 + real-transport 全部为 wire 帧序/帧形状/observer 事件/持久化 saveDoc 计数/ns 终态投影断言（K1 :557-636、K14 :1154-1223 等实读）；三新文件零 `readFileSync`/`src/` grep 断言 | 符合 |
| 零 skip/only/todo | grep 实证三文件零命中 | 符合 |
| 确定性（fake-duplex 零 real sleep） | chunked-live/ac-red 零 `setTimeout` sleep；real-transport 有界 real wait（10ms poll + 100ms ACK 回流，:67/:235）与 sa7 real-transport 套件既有纪律同族（5 个先例文件 grep 实证） | 符合 |
| CI 触发性 | 根 `vitest.config.ts` include `packages/*/test/**/*.test.ts` + typecheck include `*.test-d.ts`——三新文件自动发现；`.github/workflows/ci.yml` 分片作业触达（SA4 §3 复验） | 符合 |
| 类型面 | `ws-replication-api.test-d.ts` 新增 issue #243 正向断言（chunkedUpdate 可选 boolean / maxChunkedUpdateBytes 必填 number + DEFAULT 携带） | 符合 |
| 诚实标注 | K13 头注如实声明 fake-duplex 下「声明后仍续出」有机残渣窗口结构性不可构造、判别行以对齐序列注入表达；ac-red 3 处修正均附 inline「实现轮修正注」 | 符合 |
| 负控面 | K0 knob-off（HELLO optional=0）、K6 F1 未协商混合队列、K10 F6 未协商 ack-timeout 零 RESYNC 帧、NC2 + 冻结 R1/R2/R3——对「协商默认翻恒开」「v1 漂移」双保险在位 | 符合 |

## 6. Findings

**0 BLOCKER / 0 MAJOR。2 项 MINOR（非阻塞，不阻断 approve）：**

- **M1（MINOR，程序性登记）**：两处测试侧文件范围偏离设计 §11——(a) `ws-replication-issue243-ac-red.test.ts`（DENY「断言面冻结」）3 处断言机制修正；(b) `ws-replication-observer-red.test.ts`（ALLOW 表外）+1 行既有完整字面量补新必填字段。SA3 §6/§7 透明披露并提请裁定；SA4 §4.1/§4.2 逐条独立复核「绿灯不可达/机械涟漪」论证后正式接受。本席抽核三处修正后的断言（ac-red :391-518）：AC 映射语义逐字保持（单 ACK 且 ackedSequence=末 chunk 帧序、恰一次 apply+dirty、写后零新增 SYNC、UPDATE_TRANSFER_* 零违例），红灯失败面（P1 零 chunk / P2 resync=1 / P3 decode 收口）未触碰；observer-red +1 行为新必填字段的唯一既有完整字面量构造点，字段可选化替代方案（弱化限额契约）未取正确。裁定链完整、证据充分——登记而非升级。
- **M2（MINOR，外观漂移）**：`packages/ws-replication/test/harness.ts` 本地镜像接口 `WsReplicationLimits`（11 字段，:43-55「与冻结契约一致」头注）未随包公共类型新增第 12 字段 `maxChunkedUpdateBytes`。零功能影响：无 CONTRACT_LIMITS↔DEFAULT_REPLICATION_LIMITS 平价断言（grep 实证）、全部消费经 `Partial<ReplicationLimits>`、SA4 复跑 typecheck exit 0。建议后续触及该文件时补齐镜像字段，本任务不阻断。

## 7. 裁决汇总

| 检查项 | 结果 |
|---|---|
| AGENTS（根 + 包）/ ADR 0010/0013 / 协议条款 / CONTEXT 词条 | 逐面符合（§1，含独立抽核） |
| 单一事实源（几何/协商/发射点/窗口口径/协商状态） | 全部符合（§2，含 F7 静态判据 grep 复验恰 2 漏斗） |
| 生命周期对称（清理挂点/终态释放/transferId 作用域/F6 双向/残渣判别） | 对称闭合（§3，含 finalize→runDisposal 调用链实读） |
| 文件范围 ALLOW/DENY | DENY 零实质触碰；2 测试侧偏离已裁定接受（§4/§6 M1） |
| 测试质量（行为断言/确定性/CI 触达/类型面/负控/诚实标注） | 全部符合（§5） |
| BLOCKER / MAJOR | **0 / 0** |

**verdict：approve**。`requiresConflictRecheck: false`——实现未引入 SA8 r3 未覆盖的语义偏离（与 SA4 §6 同裁定）；F6/F7 落地与已复核设计逐字一致。M1/M2 为非阻塞登记项，分别由既有裁定链与后续触及机会承接。
