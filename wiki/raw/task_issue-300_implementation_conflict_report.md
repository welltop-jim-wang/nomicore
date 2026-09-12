# SA8 冲突门禁报告 — issue #300（implementation 复查）

- **dispatch**: sa-e45f82e1-45ef-4794-aaa5-f659c301d2a2（mabf-sa8 / conflict-gate / iteration 2）
- **审查对象**: issue #300 已实现 diff（工作树未提交改动 = 13 个 modified + 2 个新增源/测试文件，`git diff --stat` +1045/−221；基线 `mabf/issue-300` @ `605a48f`，#299/PR #321 合并点）
- **门禁类型**: implementation 复查（触发条件：实际 diff 触碰 ADR/协议/冻结面——协议文档 §22、codec 错误注册表 append-only 首登、0x42 wire kind=1/2 端到端、namespace 状态机承载行为、失败语义；同时兑现前置门禁 §10 与设计 §15/SA2 §13 预告的设计后+实现后冲突复查焦点 ①–⑦）
- **裁决**: **clear——0 hard-conflict / 0 evolution-required**；全部对照项为 `implements-existing-decision` 或 `no-conflict`；2 条非阻塞 required actions（R48/R49）+ 1 条环境注记（N7）。
- **requiresConflictRecheck**: **false**（本次实现复查已闭合前置门禁标记的全部待核对冻结面；理由见 §10）。

## 1. Reviewed subject: implementation

被审对象 = 工作树内 issue #300 实现 diff 全集（不是设计、不是任务简报）：`docs/protocols/instance-replication-v1.md`（§22 L701 措辞收口）、`packages/replication-protocol/src/errors.ts` + `test/fixtures.ts` + `test/codec-issue242-ac-red.test.ts`（四码 append-only 首登与测试同步）、`packages/ws-replication/src/{bulk-transfer(新),update-transfer,update-channel,round-engine,hub-namespace,peer-namespace,hub-connection,peer-connection}.ts`（kind=1/2 端到端）、`test/driver.ts`、`test/ws-replication-issue256-namespace-failed.test.ts`（场景 14 改写）、`test/ws-replication-issue300-bulk-edge-ac.test.ts`（新）。逐文件实读 diff 与关键实现体（assembler 校验序、facet 三段仲裁、D0 三分叉、M1 门控、M2/M3/M5 接线、超时选路）。只裁决与既有决策集的冲突；不评实现质量、测试充分性与验收完成度（SA4/SA7 职责）。

## 2. Inputs and decision set

- **实现链产物（实读）**：设计 r1 `task_issue-300_design.md`（568 行）、SA2 review（**approve**，B1+M1–M5 已落实；`requiresConflictRecheck: true`——焦点 D12/M5/R5/场景 14）、SA3 impl `task_issue-300_sa3_impl.md`（零偏离；12/12 契约绿 + 全量门绿 + `git diff --check` 干净——本报告引用其验证结论，SA8 不运行测试）、SA6 契约 `task_issue-300_sa6_contract.md`（approve，8 红 + 4 负控）。
- **SA4/SA9 产物**：**尚不存在**（实现后评审未开始）——本复查按 skill 第三触发条件（diff 触碰协议/冻结面）运行，不以其存在为前提；后续 SA4/SA9 若发现新决策面可再触发。
- **决策集**：`CONTEXT.md` + `docs/adr/` 17 篇（无 ADR 级 superseded；ADR 0013 非目标 #4 条款级取代登记于 L117）+ `docs/protocols/instance-replication-v1.md`（wire 冻结值唯一权威，含 #295 全部规范修订）+ `packages/ws-replication/AGENTS.md`、`packages/replication-protocol/AGENTS.md`。本报告「ADR 0022」恒指 `0022-chunked-sync-transfer.md`（N6 消歧沿用；origin/main 的 `0019-vfsl-union-member-docs.md` 原 0019 同号冲突已消解——本基线篇重编号 0022——该 VFSL ADR 不在本基线决策集内）。
- **运行基线核对**：HEAD = `605a48f` ✓；DENY 清单文件经 `git status --porcelain` 定向扫描零触碰（唯一命中 = SA6 契约文件本身，untracked、未被实现修改——SA3 §File scope 与行数 1085/12 用例核对一致）；`git diff --check` 干净；协议文档过期术语扫描零命中（「后续切片交付/不预设其存在/本切片唯一 kind」已清；`CAP_CHUNKED_SYNC` 仅存于 ADR 拒绝备选与取代注记的历史叙述，属正当保留）。
- **Issue comments REST 快照 = `[]`**（与前置门禁/dispatch 声明一致）——无 owner override 需要并入。

## 3. Decision analysis

| Decision | Clause | Subject behavior（实际 diff） | Classification | Evidence | Required action |
|---|---|---|---|---|---|
| ADR 0022 L68；协议 §13.2 L445–448 | 四码 append-only 注册；replication-protocol AGENTS「error codes append-only、不得重编号或静默重释」 | `errors.ts`：`NamespaceErrorCode` 联合末尾 append 四字面量 + `_namespaceErrors` append 四行**冻结元数据逐字**（VIOLATION=true/no/failed；TOO_LARGE=true/config/failed ×2）+ 来源注释；既有 22 条零改动（仅描述性计数注释 22→26）；`BOOTSTRAP_TOO_LARGE`/`SYNC_DIFF_TOO_LARGE` 死码行保留；连接级注册表零新增；fixtures 镜像同步；issue242 计数用例按其既定维护路径 22→26 + 四码元数据/lookupError 作用域/ERROR 帧往返断言 | **implements-existing-decision** | errors.ts/fixtures.ts/codec-issue242 diff 逐值核对 = §13.2 L445–448 表；#242 先例（UPDATE_TRANSFER_* 同款 append）；SA6 R4/R6/R7 wire 断言路径经 C15 fail-closed→可编码闭合 | 无——恰为「兑现 §13.2 冻结面」而非改表（前置门禁「已注册」前提更正的承接，见设计 D12） |
| ADR 0022 L12/L48；协议 §8.1 L200–202、§17 L586/L615 | 超 `maxBootstrapBytes` 恒用改道 kind=1 经 data 路径；control reserve 零 chunk；触发条件非兼容回落 | `startBootstrap` 三分叉实测：≤ 上限 → 既有单帧路径逐字节不变（含发送后 armTimer 与 bootstrap-snapshot-sent 观测）；超限且未协商 → 既有 `BOOTSTRAP_TOO_LARGE` + failed/send-failed（v1 保持）；超 `maxChunkedBootstrapBytes` → `SNAPSHOT_TRANSFER_TOO_LARGE` + failed/send-failed；其余 → `bulkTransfer.enqueue(kind=1)` + timer 武装点前移至 enqueue + `onDataQueued`/`requestDataDrain`。每 chunk 经 `sendUpdateChunkFrame` → 连接层 `tryEmitData`（data 出站点：独立 sequence、dataGateOpen、连接总压账本）——control 队列结构性零 chunk；载体字节计入 facet `queuedBytes`（shed 账本可见） | **implements-existing-decision** | hub-namespace.ts startBootstrap 三分叉 diff；bulk-transfer.ts pullOne/sendChunk；§8.1 L202「经 data 路径传输…control 保留额度不承载任何 chunk」逐字对应 | 无 |
| ADR 0022 L48；协议 §9.2 L236–238 | 超 `maxSyncDiffBytes` 双向改道 kind=2；单帧路径保留 | 双侧 `sendStep2` 三态 seam（single/chunked/refused）实测与 hub 同构：≤ 上限单帧逐字节不变（sync-step2-sent 观测迁移至 single 分支、字段集/发射条件不变）；未协商超限 → `SYNC_DIFF_TOO_LARGE` v1 保持；超聚合 → 发送端预检 `SYNC_TRANSFER_TOO_LARGE` + failed + 零写入；否则 enqueue kind=2（绑定块 syncRoundId） | **implements-existing-decision** | round-engine.ts Step2SendOutcome + hub/peer sendStep2 diff；R45 显式授权发送端预检设计选择（前置门禁 §8 R45） | 无 |
| ADR 0022 L39–43；协议 §8.1 L202、§9.2 L238 | 首 chunk 绑定块核对映射既有码 | peer `admitBootstrapChunk`：replicationId/epoch ≠ OPEN_OK → `bindingViolation` → wire `REPLICATION_ID_MISMATCH`/`REPLICATION_EPOCH_MISMATCH`（既有码）+ 本地 failed/protocol-violation；kind=2 `admitChunkedStep2`：round 归属/重复 Step2 不符 → `SYNC_STATE_VIOLATION` + failed（§9.3 语义）；核对先于一切资源判定 | **implements-existing-decision**（本地终态裁定见第 7 行） | peer-namespace.ts diff；§13.2 三码既有行未动 | 无 |
| ADR 0022 L49；协议 §10.3 L337、§8.1 L202、§9.2 L238 | 首 chunk 分配前全四条校验 + 一次性分配 + 收齐一次 apply/导入 + partial 零写入 | 实测五步序：绑定块内容 → 控制器 `chunkCount > maxChunksPerUpdate`（`>` 判定、恰在上界接纳）→ 连接级槽（kind 无关、按 kind 取码）→ assembler `totalBytes` ≤ 按 kind 聚合上限（`aggregateLimitFor` 取键；kind=1/2 未配置 = 响亮编程错）→ `geometryConsistent`（totalBytes ≤ chunkCount × maxUpdateBytes ∧ chunkCount ≥ 1，纯函数零改动）；通过后 `new Uint8Array(totalBytes)` 一次性分配；收齐 Σbytes 精确核对 → kind=1 `finishBootstrapImport`（一次排他复制导入，与单帧同一续体）/kind=2 `round.completeChunkedStep2`（一次 sequenced apply + dirty）；重组失败一律先于 apply | **implements-existing-decision**（R44 全四条闭合） | update-transfer.ts diff（validateFirst/geometryConsistent）；hub/peer admitUpdateChunk；busy 跨帧一致集合扩展 transferKind（比冻结三字段更严的防御一致性，方向合规） | 无 |
| ADR 0022 L47；协议 §8.2 L211、§9.3 L246 | 单 ACK；ackedSequence = 末 chunk 帧序；durability 含义不变 | `BOOTSTRAP_ACK{ackedSequence: anchorSequence}`（单帧=快照帧序/kind=1=末 chunk 帧序，`finishBootstrapImport` 参数化）；`SYNC_APPLIED` 经 `applyStep2` 单点（kind=2 完成点传末 chunk 帧序）；ACK 在导入/apply 完成后发出；锚值在末 chunk 出站同一同步栈赋值（`onLastChunkSent`/`noteChunkedStep2Outbound`），undefined 期收 ACK → 既有 `ACK_STATE_VIOLATION` 防御不变；hub `onBootstrapAck`/`onApplied` 处 `bulkTransfer.settle(kind)` 单点结算 | **implements-existing-decision** | peer-namespace finishBootstrapImport；round-engine completeChunkedStep2/applyStep2Safely；§8.2/§9.3 字段集零变化 | 无 |
| 协议 §13.2 L428–429 注册表行 vs 实现本地终态 | 绑定块不符 wire 码（terminalState=conflicted）与接收方本地终态 | 检测方（peer）为 ERROR **发送方**：本地按 protocol-violation → failed（单帧 `onBootstrapSnapshot` 身份不符 → failed 的同构先例；bootstrap 期 peer 无本地副本身份，非两副本 conflicted 语义域）；registry `conflicted` 仍作为**错误接收方**（hub）的映射由 `error-mapping.terminalStateOf` 单点导出（error-mapping.ts 零改动实测）——发送方本地终态与注册表接收方映射不构成同一对象 | **no-conflict**（协议只冻结 wire 码；本地终态为未冻结本地细节，裁定有据且被 SA6 R5 契约锚定、SA2 E3 支持） | peer-namespace bindingViolation；error-mapping.ts 未触碰（DENY 核对）；§16「terminal protocol failure → failed」 | 无（设计 §15 焦点⑥确认：裁定成立） |
| ADR 0022 非目标 #5（L111）；协议 §5 L114、§10.3 L345、§22 互通矩阵行 | 0x42 解码侧协商门不分 kind；v1 组合逐字节保持 | 解码门/codec 形态面零触碰（`frame-io.ts`/`payloads.ts`/`messages.ts`/`index.ts`/golden 实测未改）；发送端改道判据含 `chunkedUpdateNegotiated()`；连接层 `sendUpdateChunk` 保留 `isChunkedNegotiated()` 纵深防御；未协商 ∧ 超限 → `BOOTSTRAP_TOO_LARGE`/`SYNC_DIFF_TOO_LARGE` v1 终局原样（刻画文件 `issue233-repro.test.ts` 未触碰，经未协商 `issue137-driver` 运行仍绿——SA3 全量门证据）；N3 负控（伪造 transferKind=3 → pre-parse `UNSUPPORTED_MESSAGE_TYPE`）绿 | **implements-existing-decision**（R43 闭合；ADR 0022 L102「死码」读法 = 同版本部署面，v1 触发面由 ADR 0013 既有内容承载——前置门禁已裁定，实现与之一致） | git status DENY 扫描；hub/peer-connection sendUpdateChunk diff；§22 issue #246 行「未协商 ⇒ v1 行为逐字节保持」 | 无 |
| 协议 §10.3 L315/L325；ADR 0022 L28 | 三 kind 共用同一 transferId 计数器、uint32 不回绕 | `UpdateChannel.allocateTransferId()`/`transferIdAvailable()` 包内单点：kind=0 `startTransfer` 与 bulk 首 chunk 出站同源消费；bulk 无独立计数器；teardown 归 1 单点仍在 channel（R42 断言跨 kind 单调 = SA6 R2 绿） | **implements-existing-decision**（R42 闭合） | update-channel.ts diff；bulk-transfer.ts host seam（`allocateTransferId: () => this.channel.allocateTransferId()` 双侧同款） | 无 |
| 协议 §16 L556 | 分块不新增状态；assembly 进度对状态机不可见；bootstrapping/reconciling 承载分块 | 实现零新增 namespace/连接状态；bulk 载体为通道私有（idle/queued/active/awaiting-ack 传输层内部相位，非协议状态机）；facet ② 无 live 门 = bootstrap/reconciling 承载语义的落实（kind=0 的 live 门 ①③ 原样） | **implements-existing-decision** | hub/peer sendFacet 三段仲裁 diff；§16 文本 | 无 |
| 协议 §8.1 L202 尾句、§9.2 L238 尾句、§17 L582、§18 L628 | 停滞超时按段收口：kind=1 → BOOTSTRAP_FAILED 族终局；kind=2 → RESYNC{SYNC_TRANSFER_EXPIRED} 非终态；kind=0 原样 | `onAssemblyTimeout` 按 `busyKind` 选路实测：kind=0 → `UPDATE_TRANSFER_EXPIRED`（原样）；kind=2 → `SYNC_TRANSFER_EXPIRED` + needs-resync（词表 §9.4 L270 已登记，发射前登记纪律满足）；kind=1 → 弃 partial → `sendNsError('BOOTSTRAP_FAILED')` → `finalize('failed','bootstrap-timeout', assemblyTimeoutMs)`；kind=2 发送端自持 ACK timer（末 chunk 出站锚）超时 → 载体弃置 + `declareHubResync/declareLocalResync('ack-timeout')`（§10.3 L332 中止复用既有机制族） | **implements-existing-decision**（冻结收口语义逐字落实；`bootstrap-timeout` cause 字面量与 timeoutMs 取值的覆盖面注记 → R48） | hub/peer onAssemblyTimeout diff；bulk-transfer armAckTimer/onAckTimeout | R48（非阻塞文档同步） |
| 协议 §10.3 L332、§23.1 L783–784；前置门禁 R46 | 中止复用既有机制（RESYNC_REQUIRED 等）；chunked-*-aborted 8 型归 #301；本票零新事件类型/词表 | M2 三族边沿挂点实测与 channel 同点：① `onResyncReceived`（双侧）② 本端声明漏斗（peer `declareLocalResync`/hub `declareHubResync` 记忆化门后）③ ack-timeout funnel（含 bulk 自身 ACK 超时经②漏斗）——边沿后载体弃置归 idle、零新增 kind≠0 出站；`clearInboundAssembly` aborted 事件按 `busyKind===0` 门控（kind=1/2 零 aborted 事件 = R46 已知中间态）；零新事件类型、零 cause/reason 新词 | **implements-existing-decision**（机制接线本票 + 完备矩阵归 #301——切片边界为前置门禁 R46 预先接受） | hub/peer diff 三挂点；§23.1 L783–784「终局失败族不发本事件…可观测信号 = namespace-error/namespace-failed」与实现一致 | 无（#301 承接） |
| 协议 §23.1 L753 第 33 型、L787–796 互斥规则 | kind=2 分块完成点不再发普通族 `sync-diff-applied`（窗口内归零） | M1 门控实测：`applyRemoteUpdate` 第 5 参判别联合 `{chunkCount} \| {syncChunked:true}`；`isStep2 ∧ ¬syncChunked → sync-diff-applied`（单帧逐字节不变）；`syncChunked → 零事件`（`chunked-sync-applied` 接线归 #301 = R46 中间态）；kind=0 `{chunkCount} → chunked-update-applied`（守卫改 `'chunkCount' in`，既有调用点行为不变）；else → `update-applied` 不变；peer degraded 判别仍最外层先行（R23）；kind=1 路径 `bootstrap-snapshot-sent`/`bootstrap-imported` 不发射（前者结构性、后者 `emitImported=false` 显式） | **implements-existing-decision**（改道归零半边 = 冻结面已兑现；正向 `chunked-sync-applied` 半边为 #301 预告中间态——§23.3 互斥规则第五形态暂以零事件形态存在，R46 已接受） | hub/peer applyRemoteUpdate diff；bulk-edge M1 探针（分块完成点零 sync-diff-applied + 单帧对照锚） | 无（#301 承接正向接线） |
| 协议 §23.3 L814（场景 14 行）+ §22 L701；ADR 0022 L102 | hub send-failed 行改挂 `SNAPSHOT_TRANSFER_TOO_LARGE`；「回归锚场景 14 由实现 ticket 改写」；§22 测试资产措辞收口 | 场景 14 改写实测三要素：协商连接（driver `chunkedUpdate: true` 条件透传，undefined 零传）+ `len > maxChunkedBootstrapBytes` 构型 + 断言 hub `namespace-error{sent: SNAPSHOT_TRANSFER_TOO_LARGE}` + `namespace-failed{send-failed}` + peer remote-error + **零** `BOOTSTRAP_TOO_LARGE` 回落；协议 §22 L701 从「后续切片交付…不预设其存在」收口为引用已交付资产（契约文件/bulk-edge 探针/场景 14 锚——三者在库实测存在），表本体零改动、无行为虚构 | **implements-existing-decision**（R47 文档同步义务兑现；docs/AGENTS「documentation-only wording 不虚构行为」满足） | issue256 场景 14 diff；协议 diff 单行；文件存在性实测 | 无 |
| 前置门禁 R47（append-only 零顺手改） | codec 形态面/单帧规则/既有行/死码/kind=0 逐字节等价 | DENY 实测零触碰（codec 形态面、配置链、error-mapping、backpressure、observer、刻画文件、issue137-driver、SA6 契约、namespace-registry/runtime、docs/adr、CONTEXT.md）；kind=0 出站 piece 显式 `transferKind: 0`（wire 字节不变——codec 本就编 0）；`ChunkedTransferPiece.transferKind` 可选 + `?? 0` 归一（SA3 偏离 #1，等价实现——既有调用点/fixture 零改动，R47 等价面保持）；onAck drain 扩展 `∨ hasBulkTransferWork?.()`（SA3 偏离 #2/#3：`hasQueuedWork` 窄判据与可选 seam——无 bulk 工作时与现状逐字节同义，M3-b 负控锚定） | **no-conflict** | git status 定向扫描；update-channel/connection diff；bulk-edge M3-b 探针 | 无 |
| ADR 0010/0008/0009/0012/0018 等 + CONTEXT.md + 两包 AGENTS | ACK durability/单序列器/Registry seam/传输层边界/术语 | 导入经既有 `importReplica`/Session seam（「与单帧路径同一导入语义」）；transport 零直入 Runtime/Persistence/live Y.Doc（bulk 仅持载荷字节，apply 经宿主既有管线）；「一次 sequenced apply」纪律保持；CONTEXT 词条零触碰、零新术语 | **no-conflict** | peer-namespace finishBootstrapImport（续体抽取不改 seam）；ws-replication AGENTS Boundaries 逐条对照 | 无 |

**交叉事实核对**：实现发射的全部 namespace 错误码（四新码 + BOOTSTRAP/SYNC_DIFF_TOO_LARGE + BOOTSTRAP_FAILED + REPLICATION_ID/EPOCH_MISMATCH + SYNC_STATE_VIOLATION + NAMESPACE_STATE_VIOLATION + SNAPSHOT/SYNC_TRANSFER_VIOLATION/TOO_LARGE）均在注册表内（C15 fail-closed 链闭合）；配置链零新键；`sync-step2-sent` 观测从 `RoundHost.send` 包装迁移至 `sendStep2` single 分支（引擎是 SYNC_STEP2 唯一生产者，字段集/发射条件不变——无发射路径丢失）。

## 4. Overrides

| Old decision | Override authority | Scope | New obligation |
|---|---|---|---|
| （无新增 override） | — | — | — |

实现未创建任何 override，也无需创建：所有行为均在 ADR 0022 + 协议冻结文本内。既有合法 override 链（ADR 0013 非目标 #4 被 ADR 0022 取代 + sync 段「未协商端逐字节不变」纪律限定偏离）已在 docs 提交落地，实现只是消费该链条——v1 触发面保持恰是该偏离范围（仅限 sync 段分块、live UPDATE 协商行为不动）的正确落点。

## 5. Frozen surfaces（逐项核对实际 diff）

| Surface | Must remain unchanged | Evidence | Actual result |
|---|---|---|---|
| 0x42 payload 形态 | kind 首字段单形态字段序 + 绑定块位置/存在性；MALFORMED_FRAME 单帧规则 | 协议 §5 L116、§10.3 L313/L321/L323 | ✓ codec 文件零触碰；连接层仅透传 piece（kind=0 分支字节形状与改前逐字节同构；缺失绑定成员由 codec 响亮拒绝） |
| Envelope / 消息注册表 | 一 WS message = 一完整 frame；零新消息码 | 协议 §3/§5 | ✓（chunk 经既有 UPDATE_CHUNK 0x42） |
| BOOTSTRAP_ACK / SYNC_APPLIED payload | 字段集不变；ackedSequence = 末 chunk 帧序；无新 ACK 消息 | §8.2 L211、§9.3 L246 | ✓（finishBootstrapImport/applyStep2 参数化锚值） |
| 单帧路径 | 未超限走单帧（触发条件非回落）；不 fallback、不做无界拆分 | §8.1 L200、§9.2 L236 | ✓（三分叉 ≤ 分支逐字节不变；无任何回落路径） |
| 错误码注册表（append-only） | 四码冻结元数据；死码行保留；连接级零新增；RESYNC 词表 `SYNC_TRANSFER_EXPIRED` 冻结 | §13.2 L445–448、§9.4 L270、§23.2 | ✓（append-only 首登逐值一致；死码行在；v1 触发面按互通矩阵保留） |
| Peer namespace 状态机 | 分块不新增状态；assembly 进度不可见；终态 channel 仅新连接重开 | §16 L556 | ✓（零新状态；bulk 相位为传输层私有） |
| 配置链 | 两聚合上限 + 三机制键 kind 无关、键名不变；链② 校验；`maxQueuedControlBytes ≥ maxBootstrapBytes + 开销` 原样 | §17 L575–615 | ✓（defaults/types/validate 零触碰） |
| Control/data 记账边界 | control 保留额度零 chunk；chunk 经 data 路径独立 sequence/闸门/RR | §8.1 L202、§17 L586/L615 | ✓（tryEmitData 唯一出站点；载体入 facet 聚合账本） |
| 0x42 解码侧协商门 | 未协商 pre-parse `UNSUPPORTED_MESSAGE_TYPE` 不分 kind | §5 L114、§10.3 L345 | ✓（解码面零改动；N3 负控绿） |
| transferId 计数器 | uint32 ≥1 不回绕；(连接,方向,ns) 域；三 kind 共用、无第二计数器 | §5 L116、§10.3 L315/L325 | ✓（allocateTransferId 单点；teardown 归 1 单点不变） |
| ACK durability 语义 | ACK = 已落 live Y.Doc，非 flush/quorum | ADR 0022 L47、ADR 0010 | ✓（导入/apply 完成后单 ACK 结算） |
| 刻画测试文件 | `ws-replication-issue233-repro.test.ts` 不改且绿 | ADR 0022 L103、§22 L700 | ✓（未触碰；SA3 全量门 3/3 绿——v1 组合 R1/R3 现状断言保持） |
| Observer 注册表 | 零新事件类型/词表；改道点普通族归零；8 型接线归 #301 | §23.1 L749–754、§23.3 L753 | ✓（M1 门控 + busyKind 门控；零新词；既有锚全绿——SA3 证据） |
| SA6 验收契约文件 | 不得为绿而改断言 | 设计 DENY | ✓（untracked 未修改；1085 行/12 用例与 SA6 §12 一致） |

## 6. Evolution requirements

**无。** 实现没有改变任何冻结契约：无 ADR/CONTEXT/协议语义修订需求；四码注册表首登是「兑现 §13.2 已冻结表」而非改表（append-only 演进路径为模块 AGENTS 明文允许、#242 先例在案）；协议 §22 修订为 R47 预设的文档同步（引用真实存在的资产，零语义改动）。修订计划完备性检查不适用。实现与设计 r1（SA2 approve）语义一致，SA3 报告的三处实现形状偏离（transferKind 可选归一 / hasQueuedWork 窄判据 / 可选 seam）均为等价实现选择，不触及决策面。

## 7. Hard conflicts

**无。** 逐面核对：wire（0x42 kind=1/2 端到端、单帧/v1/分块三分叉、ACK 锚）、状态机（零新状态、承载语义、resync/teardown/shed/fence 中止接线）、失败语义（四新码发射点与分类、绑定块既有码、超时按段收口、发送端超聚合收口、出站被拒镜像 #243 族）、append-only 注册表（首登逐值一致、零既有行改动、死码保留）——全部与 ADR 0022、协议 §5/§8/§9/§10.3/§13.2/§16/§17/§18/§22/§23 及模块 AGENTS 兼容；设计 §15 预告的七个复查焦点（D12 首登/R42 计数器/R43 v1 门/R45 预检+场景 14/R47 冻结面/R5 终态裁定/M5 入口面读法）经本报告 §3 逐项闭合——其中 M5 与 D9 的 `namespace-failed` cause 复用（`send-failed`/`bootstrap-timeout` 闭集合字面量、零新词、计数不变量经 finalize 幂等保持、timeoutMs 语义 = 实际到期的配置上限）属冻结词表内的边界读法，不构成硬冲突；残余覆盖面缺口转 R48 文档同步。

## 8. Required actions（非阻塞；编号接续前置门禁 R42–R47）

- **R48 · §23.3 cause×failed 覆盖矩阵注记同步（文档-only，建议随 #301 或独立 doc commit 执行）**：实现为既有 cause 字面量引入了矩阵未列举的入口——① hub/peer kind=1 assembly 停滞收口 → `bootstrap-timeout`（矩阵现只列 peer `onTimerFired('bootstrap')`/hub bootstrap timer 到期；`timeoutMs` 实参 = `assemblyTimeoutMs`，而 L780 枚举只列 open/bootstrap/reconcile 三 timeout 键）；② kind=1 chunk 出站被拒（M5）与 shed 弃置 → `send-failed`（矩阵 hub 入口现只列「控制帧编码面失败 + 快照超聚合上限」）。词表纪律（append-only 闭集合、先登记后发射、恰一计数、timeoutMs=到期配置上限）全部保持、无既有陈述为假——故非冲突、非 evolution-required；但按 docs/AGENTS「文档与代码一致」纪律，宜在 #301 接线 §23.3 chunked 观测面时同批补记两行入口注记（或本票附一行 doc-only 修订）。**若执行为协议文档修订，属纯措辞补记，无新决策面。**
- **R49 · transferId 域耗尽分支的不对称（观察项，可归 #301 生命周期矩阵）**：kind=2 发送端把 `transferIdAvailable()=false` 显式收口为 `SYNC_TRANSFER_TOO_LARGE` + failed（协议未冻结该边缘的码位选择——defensive uint32 边界，注册表分类 config/reconnect 可恢复）；kind=1 无显式预检，依赖 bulk `pullOne` 恒 false + bootstrap timer 兜底（`bootstrap-timeout` 终局）。两分支均冻结语义内、实践不可达；建议 #301 完备中止矩阵时统一注记，避免后续读者困惑。
- **N7（环境观察，非本票冲突）· `packages/ws-replication/src/types.ts` 既有过期计数注释**（「协议 §13.2 注册表全 20 码」，基线即漂移、D12 后应为 26）：`types.ts` 在设计 DENY 清单、本票零触碰、非本票引入；建议 owner/总控授权一行注释同步（同 N6/R32 类处置），不阻塞本票。

## 9. Verdict

**clear。** issue #300 实现 diff 是 ADR 0022 + 协议冻结契约的忠实落地：改道三分叉（单帧逐字节不变/v1 终局保持/kind=1/2 分块）、data 路径逐帧出站与记账（control reserve 结构性零 chunk）、assembler kind 泛化与全四条首 chunk 校验、绑定块既有码映射、收齐一次 apply/排他导入 + 单 ACK（末 chunk 帧序）、四码 append-only 首登（逐值 = §13.2 冻结行）、超时按段收口（BOOTSTRAP_FAILED 族 / RESYNC{SYNC_TRANSFER_EXPIRED}）、场景 14 改写与 §22 文档同步——与 ADR 0022、协议 §5/§8/§9/§10.3/§13.2/§16/§17/§18/§22/§23、CONTEXT.md 词条及两包 AGENTS 逐条同源；R42–R47 全部闭合；DENY 清单零触碰；SA3 验证证据（契约 12/12 绿、全量门绿、diff-check 干净）与静态核对相互印证。前置门禁与设计/SA2 预告的全部冲突复查焦点已由本报告闭合。R48/R49/N7 为非阻塞收尾项。实现质量、动态验收与 PR 面归 SA4/SA7/总控，不在本门禁范围。

## 10. requiresConflictRecheck

**false。** 前置门禁标记 true 的待核对面——wire 传输路径（0x42 kind=1/2 端到端）、namespace 状态机承载行为、失败语义（四新码终局/发送端收口/中止接线）、**codec 错误注册表面（append-only 首登）**——已由本次 implementation 复查逐项核对闭合（§3/§5）；无公共 API/schema/持久化/新 override 遗留待核对（实现零公共面变化、零配置键、零持久化面）。剩余事项均为已登记的非阻塞动作（R48 文档注记 = 纯措辞补记、R49 观察项归 #301、N7 归 owner/总控）与 #301 切片自身的新门禁义务，不构成本票的待核对冻结面。
