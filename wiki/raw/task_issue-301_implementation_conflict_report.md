# SA8 冲突门禁报告 — issue #301 实现后复查（implementation conflict report）

- **Reviewed subject**: implementation（当前工作树 diff vs 基线 `0f3eca5`；分支 `mabf/issue-301`）
- **Dispatch**: sa-59d8f9f4-7671-4aa5-9bf2-f1f841f08253（mabf-sa8 / conflict-gate / iteration 1）
- **复审触发**: SA3 显式请求（SA3 §7/§8-1）+ SA8 设计后报告 §7 Required action 3 + §9 `requiresConflictRecheck: true` 的实现后一半——设计登记公共 API 类型联合加性变更与冻结面，实现落地后按 skill「implementation 复查」逐项核对 Frozen surfaces vs 实际 diff
- **Owner-feedback 记录**: REST comments endpoint 返回空（无适用 owner 要求）——与任务简报 §Comments / SA6 §2 / SA2 §4 / SA3 头部一致；无 Owner override 来源
- **基线事实**: `git rev-parse HEAD` = `0f3eca5`；`git status --porcelain` = **恰好 ALLOW 七文件 modified**（`types.ts`/`bulk-transfer.ts`/`hub-namespace.ts`/`peer-namespace.ts`/`round-engine.ts`/`api.test-d.ts`/`instance-replication-v1.md`，共 521+/86−）+ 未跟踪 = SA6 契约文件与 6 个本票 wiki 固定产物；DENY 面零触碰（逐项见 §4/§5）

---

## 1. Inputs and decision set

| 输入 | 状态 | 说明 |
|---|---|---|
| 当前工作树 diff（7 文件，§基线事实） | 被审对象 | 实现后复查的唯一实体；逐 hunk 实读 |
| `wiki/raw/task_issue-301_sa3_impl.md` | 实读 | SA3 实现报告 iteration 1（含 §8-1 偏差登记、§6 V1–V12 验证证据、md5 指纹互证） |
| `wiki/raw/task_issue-301_design.md` | 实读 | SA1 设计（OD1–OD9、§8.1 接口表、§11 ALLOW/DENY、§15 复查请求）——设计文本用于定位偏差点，**不构成 SA8 决策基准** |
| `wiki/raw/task_issue-301_design_conflict_report.md` | 实读 | SA8 设计后复查（clear；D1–D14）——本报告 §5 Frozen surfaces 逐项继承并核对其 §4 |
| `wiki/raw/task_issue-301_sa2_review.md` | 实读 | SA2 攻击评审（approve；O-1/O-2/O-3 全 MINOR 已落实） |
| `wiki/raw/task_issue-301_sa6_contract.md` | 实读 | 验收契约（approve；Revision R1 = contract-only 判别式修订，§17） |
| `wiki/raw/task_issue-301_sa4_review.md` / `_sa9_*.md` / `_sa7_*.md` | **不存在** | 无返工轮（SA3 §1 已登记）；不构成本复查阻塞 |
| `docs/adr/0019-chunked-sync-transfer.md` | **已接受**（issue #295 设计冻结；wire 冻结值以协议文档为唯一权威） | L72–83 Observer seam 8 型登记；L70 超时两向收口；非目标条款 |
| `docs/adr/0013-chunked-live-update-transfer.md` | 已接受（被 0019 扩展） | kind=0 分块四型先例与 observer 纪律沿用源 |
| `docs/adr/0010-hub-peer-websocket-ydoc-replication.md` 及其余 ADR（0001–0018） | 已接受，不在本 diff 触碰面 | 无 superseded ADR 构成约束 |
| `docs/protocols/instance-replication-v1.md` | **规范权威** | §23.1 第 29–36 型行（L749–754/L783–784）、§23 头部 append-only/GA 冻结（L714–715）、§23.3/§23.4 纪律、§9.2 L246（`SYNC_APPLIED.ackedSequence` 语义）、§22 资产锚惯例（L687–709） |
| `CONTEXT.md` | 领域词汇 | 「分块复制传输」（L153–155）不枚举事件型；「同版本部署假设」（L165–166）——均未改（git diff 空） |
| `packages/ws-replication/AGENTS.md` | 模块契约 | observer 隔离、公共导出面经 index.ts、FSM 不变量 |

源码与测试仅用于确认事实（diff 逐 hunk、grep 导出面/回调消费者、锚文件绑定形态）；测试通过证据（契约 17/17、全包 516、根 3503、typecheck 全绿）引自 SA3 §6，SA8 未运行测试。

---

## 2. Decision analysis

| # | Decision | Clause | Subject behavior（实际 diff 行为） | Classification | Evidence | Required action |
|---|---|---|---|---|---|---|
| D1 | ADR 0019 L78–81；协议 §23.1 L749–754、L783–784 | 8 型字段集逐字冻结（sent：`connectionId?/namespaceId/transferId/chunkCount/totalBytes`（sync 另携 `syncRoundId`）；applied：`+bytes/chunkCount/applyLatencyMs?`（sync 另携 `syncRoundId`）；acked：`+bytes/ackLatencyMs?`；aborted：`namespaceId/transferId/reason/receivedChunks/receivedBytes` 无 connectionId） | `types.ts` 追加第 29–36 型：字段名/可选性/side 信封（snapshot 成功三型字面量 hub/peer/hub；sync 四型与两 aborted 型 `ReplicationObserverSide`）与冻结行**逐字一致**——本报告逐行比对：L749（29 型 hub）↔ `chunked-snapshot-sent`、L750（30 型 peer）↔ `-applied`、L751（31 型 hub）↔ `-acked`、L752/753/754（32–34 型 hub/peer）↔ sync 三型、L783/784（35/36 型 hub/peer）↔ 两 aborted；键集排除（sent 无 latency、applied 无 transferId/sequence/效果组、sync-acked 无 sequence/syncRoundId、aborted 无 connectionId）全部成立；`reason` 复用 `ChunkedUpdateAbortReason` 六值闭集（零新词） | **implements-existing-decision** | types.ts diff 8 个成员逐一 vs 协议行比对（本报告独立执行）；api 型镜像负向 `keyof` 锚（`'syncRoundId' extends keyof …-acked ? true : false` → false 等 3 处）静态锁键集排除；R6 exact-keyset 契约绿（SA3 §6 V3） | 无 |
| D2 | 协议 §23 头部 L714–715（Seam append-only：「事件类型、reason/cause/via 词表、稳定码表只增不改；GA 后字段语义冻结」） | 公共导出联合加性变更的合法面 | `ReplicationObserverEvent`（index.ts 既有导出）追加 8 成员 = 纯加性；`ws-replication-api.test-d.ts` 镜像同步扩至 36 型（`toEqualTypeOf` 全联合精确断言 + 标题计数修正 + 8 型逐字段 `Extract` 断言）——加成员而镜像不同步会 typecheck 红，实际同步（SA3 V6：Type Errors: no errors） | **implements-existing-decision** | api.test-d.ts diff（26 型→36 型标题 + 8 成员 + 50 行字段断言）；外部穷尽消费者排查：`apps/yjs-server/src/fatal-policy.ts` L65–73 switch 含 `default` 腿（非穷尽）——加性成员零破坏（SA2 §1 已排查，本报告复核该 switch 形态）；`BulkTransferOutboundSettlement` 定义于 `bulk-transfer.ts`，grep `index.ts` 零 BulkTransfer 导出 = 包内私有 | 无 |
| D3 | 协议 §23.1 L746/749/752（sent 语义：完成出站时恰一、末 chunk 结算记账点、非逐 chunk） | sent 发射结构 | `pullOne` 末 chunk 分支：`state.phase='awaiting-ack'` → `state.lastChunkSequence = seq` → 同一同步栈 `onLastChunkSent(seq, settlementOf(state))`（bulk-transfer.ts L215–219）；三调用点（hub startBootstrap kind=1 / hub·peer sendStep2 kind=2）在回调体内先既有锚（`bootstrapSnapshotSeq` / `noteChunkedStep2Outbound`）→ `chunkedAckT0` 采样 → `observerOn` 门内发射；`settlementOf` 单点构造（pullOne 与 settle 同源——设计 OD2「拒绝 second source」义务落实） | **implements-existing-decision** | bulk-transfer/hub/peer diff 逐 hunk；发射点恰一性由结构保证（末 chunk 分支单次触发；中止 transfer 到不了该点）；R1/R2 契约「sent 恰一、无 sequence/latency」绿（SA3 §6） | 无 |
| D4 | **无决策条款管辖**（见 Evidence：决策文本零引用）+ 设计 §11 DENY 行「`ws-replication-issue300-*` … 回归锚 … 不得漂移」+ SA8 设计报告 §4 Frozen surfaces「验收契约与回归锚零改动」 | **SA3 §8-1 登记的偏差：`onLastChunkSent` 采用追加第 2 参形态**——`(lastChunkSequence: number, settlement: BulkTransferOutboundSettlement)`，而非设计 §8.1 接口表拟定的「唯一参数 `number` 替换为结算记录」 | 名字、发射点（pullOne 末 chunk 同一同步栈）、单点事实源（`settlementOf`）、sent 事件字段、控制器语义（`lastChunkSequence === settlement.lastChunkSequence` 同源）全部与设计一致；唯一差异 = 参数形态（追加 vs 替换）；DENY 冻结锚 `ws-replication-issue300-bulk-edge-ac.test.ts` L194（单参绑定 `let lastSeq: number \| undefined`）与 L228（零参 `() => undefined`）在 TS 参数省略规则下类型成立、文件**零改动**（git status 该文件空）；替换形态将令包 typecheck TS2322 且锚不可改——设计文本自身张力（§8.1 接口表 vs §11 DENY）由实现按 DENY 约束解决 | **no-conflict** | grep 实证：`onLastChunkSent` 在 `docs/` 与 `CONTEXT.md` **零引用**（回调形态不构成任何 ADR/协议/CONTEXT 冻结面）；`bulk-transfer.ts` 不经 `index.ts`（包内私有签名）；全仓消费者仅 hub/peer 两控制器（已随改）+ issue300 锚两处（variance 合法、未改）；bulk-transfer.ts L60–66 源内注释登记偏差与理由；设计 OD2 的实体义务（单源/同名/同点/同栈）逐项保留 | 无（设计 §8.1 接口表该行属设计文档内部描述，被 SA3 §8-1 + 源内注释显式登记的形态取代；无决策文本需要更新——SA8 不改设计文档） |
| D5 | 协议 §23.1 L748/751/754（acked 语义：末 chunk 帧序单 ACK 收妥结算恰一；zombie 迟到 ACK / 单帧路径零事件）+ §23.4 L920（ackLatencyMs = 收 ACK 时刻 − 帧实际出队时刻） | acked 发射结构 | `settle(kind)` 返回 `BulkTransferOutboundSettlement \| undefined`：awaiting-ack 且 kind 匹配才构造记录→dispose→返回，否则 undefined（单帧/zombie/kind 不匹配 → 零事件）；hub `onBootstrapAck`：settle → `setState('reconciling')` **之后**发射（决策落定）；hub/peer `onSyncApplied`：quiet 门 + t1 采样 + `ackLatencyMs` 两态条件展开（t0 缺 → 整键缺失） | **implements-existing-decision** | bulk-transfer/hub/peer diff；R1/R2 契约「acked 恰一、bytes=totalBytes、无 sequence/syncRoundId/transferId/chunkCount、ackLatencyMs ≥0」绿；R7 两态键缺失绿（SA3 §6 V3） | 无 |
| D6 | 协议 §9.3 L255（违例 SYNC_APPLIED = `SYNC_STATE_VIOLATION`）+ §23.4 L900–902（决策落定后发射） | 被拒 ACK（round 校验失败 → failed 终局）时载体仍 settle 释放但零 acked | hub `onSyncApplied`：`round.onApplied(message)` 后 `if (settled !== undefined && !this.isQuietState() && this.observerOn)`；peer 用 `isInboundQuiet()`（SA2 O-1 侧别方法名）——违例路径不发射、载体释放行为不变 | **no-conflict** | SA8 设计报告 D6 已裁定该读法为冻结文本直接相容读法（kind=0 `onUpdateAck` violation 先例零事件）；实现与裁定读法一致；契约不覆盖该组合（设计 §13-2 登记，SA7 动态面探测） | 无（SA7 动态面可加计数断言——既有归口） |
| D7 | 协议 §23.1 L783（35 型「终局失败族不发本事件」）+ §18 L628（assemblyTimeoutMs 两向收口：snapshot → `BOOTSTRAP_FAILED` 语义族 terminal failed） | kind=1 停滞超时零 aborted | 双侧 `onAssemblyTimeout`：`clearInboundAssembly(kind === 1 ? undefined : 'timeout')`（kind 于 reset 前捕获——既有行保持）；kind=1 分支的 `BOOTSTRAP_FAILED` ERROR + `finalize('failed','bootstrap-timeout',…)` 终局收口**逐字不变**（diff 仅改 reason 实参） | **no-conflict** | SA8 设计报告 D5 裁定零 aborted 为唯一相容读法；hub/peer diff 确认收口行为零变化；N1 契约（kind=1 超时终局、零成功型）绿 | 无 |
| D8 | 协议 §23.1 L787–796（apply 成功路径互斥六选一、degraded 判别先于 chunked 判别胜出 R23）+ L746–748（R21 改道条款） | 第五/第六形态接线：抑制点原位改道发射；单帧路径逐字节不变 | hub/peer `applyRemoteUpdate` isStep2 分支：`'syncChunked' in chunked` → 发 `chunked-sync-applied`（独立字段组不展开 base；`bytes = update.byteLength`；`chunkCount` 经 `round-engine` 结构化 form 穿线——`completeChunkedStep2` 第 3 参）；**else 腿 `sync-diff-applied ...base` 逐字节不变**；peer `finishBootstrapImport` form 参数化：`'single'` → 既有 `bootstrap-imported` 逐字节不变 / chunked → `chunked-snapshot-applied`（t0 紧邻 `importReplica`、`importResult.ok` 判定后的成功结算点）；peer degraded 判别仍在外层先行胜出；svBefore 捕获门收紧至非 syncChunked（键集排除一致） | **implements-existing-decision** | hub/peer/round-engine diff；N6 单帧对照绿、R23 degraded 胜出绿（SA3 §6）；`chunkCount` 穿线闭环 = 双侧 `handleAssemblerResult` 传 `result.chunkCount`（此前被丢弃——设计 §5.2 登记的断链已接通） | 无 |
| D9 | 协议 §23.1 L782–784（aborted 纪律：六 reason 接线行、busy 守卫恰一、last-writer-wins、终局失败族不发、`chunked-update-aborted` 逐字同构） | kind 门泛化：busyKind → 事件型三选路 | 双侧 `clearInboundAssembly`：`busyKind ?? 0` reset 前捕获 → busy 守卫快照 → reset → `kind===1 ? 'chunked-snapshot-aborted' : kind===2 ? 'chunked-sync-aborted' : 'chunked-update-aborted'`；**全部 reason 置位点零改动**（timeout/channel-teardown/connection-teardown/epoch-fence/resync-declared/shed 挂点 diff 中不可见 = 未触碰）；终局失败族（不带 reason）零事件保持；hub 侧 35 型结构性不可达（类型保留双侧 = 防御面同构先例） | **implements-existing-decision** | hub/peer diff（slice 2 源码 deferral 注释「kind=1/2 分块中止归 #301」兑付——hub L1051/peer L994 注释更新登记）；R3/R4/R5/R8 + N9 契约绿 | 无（动态行计数断言归 SA7——§23.1 L782 既有归口） |
| D10 | 协议 §23.3（safe-field 清单）；§23.4 L896–928（throw 隔离、决策落定后发射、无 observer 逐字节等价、clock 缺省整键缺失、绝对时间戳禁入）+ ADR 0019 L83 | 纪律面落实 | 全部新发射经 `this.host.emitObserver` → `dispatchReplicationObserver` 单点（observer.ts 零改动）；字段全集 = 稳定字面量 + `cidField` 受控标识 + 有限数值（`syncRoundId` = §23.3 issue #239 已登记 uint32 类别）；latency 全部条件展开（整键缺失非 undefined 值）；`sampleAckT0` 仅 `observerOn` 时触 `host.now`（连接层 observer 门控 + safeNow 折叠 = 无 observer 零时钟调用） | **implements-existing-decision** | R6 深扫（无 Uint8Array/ArrayBuffer/DataView/Error/token）+ R7 + N7（observer 全 throw vs 无 observer wire 逐字节等价）全绿（SA3 §6）；settlement 对象构造为进程内内存小对象、零 wire 投影（N7 等价性不受影响） | 无 |
| D11 | 协议 §22（L687–709 Conformance tests 资产锚惯例——每票登记验收资产）；docs/AGENTS.md（protocols 为规范权威） | 规范文档改动 = §22 加一行资产锚 | `instance-replication-v1.md` numstat **1 insertion / 0 deletion**：新行落 L702，位于 §22 列表内（§22 = L687–709、§23 = L710 起）——内容 = 本票验收契约 + 类型镜像资产锚一句；**§23.1/§23.3/§23.4/§23.7 冻结文本零改动** | **implements-existing-decision** | git diff hunk 头 `@@ -699,6 +699,7 @@` + 新行上下文全为 §22 既有资产锚条目；与 issue #242/#246/#295/#300 各票登记模式同构（SA8 设计报告 D10 裁定惯例兑付） | 无 |
| D12 | 协议 §9.2 L246（`SYNC_APPLIED.ackedSequence = SYNC_STEP2 sequence`，分块 diff 时为末 chunk 帧序）+ §23.1 第 34 型（「末 chunk 帧序的单 SYNC_APPLIED」语义） | SA6 契约文件在实现期发生 **Revision R1**（contract-only）：R2 末条 wire 断言判别式由「hub→peer 全部 `SYNC_APPLIED` 计数 = 1」改为「`ackedSequence` = kind=2 末 chunk 帧序者恰一」 | 契约文件（SA6 产物，未跟踪新文件）内 R2 判别式 = `syncApplied.filter(m => m.ackedSequence === kind2 末 chunk 帧序)` 恰一；17 用例无 skip/only/todo/env（本报告 grep 复核：`it` 计数 17、命中 0）；SA3 零改动契约（DENY 义务成立）；旧判别式在 R2 构型下结构性不可满足（round 1 既有 ACK `ackedSequence=5` + round 2 分块 ACK `ackedSequence=21`——基线 stash 对照两帧逐字相同 = 基线固有 wire 行为非实现引入） | **no-conflict** | 契约 = SA6 验收工件**非决策文档**（SA8 决策基准 = ADR + CONTEXT + 协议）；修订方向**对齐**规范字段语义（§9.2 L246 判别身份 = `ackedSequence`）；SA6 §17 双向复跑 + mutation 敏感度（`帧序+1` → R2 恰失败）证明非恒真；SA8 设计报告 §4 冻结面「SA6 契约零改动」在设计时点属实，实现期由**契约 owner SA6** 依其修订权处置并全迹登记——SA3 的 DENY 约束未被违反 | 无 |
| D13 | ADR 0019 L45–70（slice 2 已交付面：ACK/发送/接收/记账、超时两向、资源上限）；协议 §5/§10.3/§13/§16/§17/§18（wire、错误码、词表、配置链、状态机、终局） | 零 wire/配置/状态机/失败语义改动 | `git status` 全集 = ALLOW 七文件 + wiki/契约未跟踪：`replication-protocol/**`、`defaults/validate/backpressure/frame-io/lifecycle-queue`、`observer.ts`、`update-channel.ts`、`update-transfer.ts`、`index.ts`、ADR/CONTEXT **全部未改**；`BulkTransferSender` 相位机（idle/queued/active/awaiting-ack）零新转移；namespace/round/assembly 状态机零变化（只在既有结算点追加发射与返回值） | **no-conflict** | porcelain 全集逐项核对（本报告基线事实节）；N1–N9 负控 + 全包 516 + 根 3503 全绿（SA3 §6 V3/V4/V12） | 无 |

**裁决分布**：implements-existing-decision × 8（D1/D2/D3/D5/D8/D9/D10/D11）；no-conflict × 5（D4/D6/D7/D12/D13）；evolution-required × 0；hard-conflict × 0。

---

## 3. Overrides

| Old decision | Override authority | Scope | New obligation |
|---|---|---|---|

（空——无需任何 override。实现是 ADR 0019/协议 §23.1 已登记冻结值的接线；Owner comments 为空不存在 Owner 覆盖；SA3 §8-1 偏差（D4）不构成 override——回调形态无决策条款管辖，且该偏差的方向是**保全**冻结回归锚而非偏离任何决策；SA6 Revision R1（D12）是契约 owner 对验收工件的修订，非决策文本 override。）

---

## 4. Frozen surfaces

（继承 SA8 设计报告 §4，逐项 vs 实际 diff 核对）

| Surface | Must remain unchanged | Evidence | Actual result |
|---|---|---|---|
| Wire 面 | 0x42 codec/字段序/消息码、§13.1/§13.2 错误码注册表、§9.4 RESYNC reason 词表、§17 配置键与校验链 | ADR 0019 L20–37/L66–69；协议 §5/§10.3/§13/§17 | **符合**：`replication-protocol/**` 与配置链文件零改动（porcelain 核对）；diff 全部位于观测发射/类型/镜像/文档锚 |
| §23.1 第 29–36 型字段集/side 信封/键集排除 | 逐字冻结（GA 后字段语义冻结） | 协议 §23 头 L714–715 + L749–754/L783–784 | **符合**：types.ts 8 成员逐行比对一致（本报告 D1）；api 型镜像 + 契约 R6/R1/R2 exact-keyset 双面锁定 |
| §23.3/§23.4 纪律文本 | 规范文本零改动 | 设计 OD9-2 承诺 | **符合**：协议文档 numstat 1/0，唯一插入位于 §22（L702）——§23 起全部未触碰（§23 = L710 起） |
| CONTEXT.md「分块复制传输」词条 | 不枚举事件型；事件词汇权威在 §23.1 | CONTEXT L153–155/L165–166 | **符合**：git diff 空；无新领域词（8 型事件名 = 协议词汇） |
| ADR 0019/0013 冻结文本 | 决策文本零触碰 | 设计 DENY | **符合**：`git diff -- docs/adr CONTEXT.md` 空 |
| kind=0 chunked 族 + 单帧普通族发射 | 逐字节不变（N6/N7 锚、R47/R21 遗产） | 协议 §23.1 L746–748 | **符合**：isStep2 else 腿（`sync-diff-applied ...base`）与 `finishBootstrapImport` `'single'` 分支 diff 中仅移位零改写；`update-channel.ts`/`update-transfer.ts` 未改；N6/N7 绿（SA3 §6） |
| Observer 分发单点/无 per-type 白名单 | `observer.ts` 零改动（issue #287 域分离） | observer.ts L36–46 | **符合**：porcelain 无该文件 |
| 验收契约与回归锚 | SA3 不得修改契约与 issue300/299/244/245/246/256/239/233 等既有锚 | SA6 §16 冻结；设计 DENY | **符合（含一处 owner 侧修订）**：SA3 零改动（md5 与 SA6 §16 记录逐字相同、V8 纪律自检、本报告 grep 复核 17 it/零 skip）；issue300 冻结锚文件未改（git status 空）——其 L194/L228 单参/零参绑定在 D4 偏差形态下类型成立；契约文件经 **SA6 Revision R1**（contract owner，全迹登记 + mutation 敏感度，方向对齐 §9.2 L246——D12 裁定 no-conflict） |
| 状态机/生命周期/失败语义 | FSM 转移、终局规则、RESYNC/BOOTSTRAP_FAILED 收口零变化 | ADR 0019 L70；协议 §16/§18 | **符合**：零新转移（`settle` 仅增返回值、`clearInboundAssembly` 仅内化选路、`onAssemblyTimeout` 仅改 reason 实参）；OD3 quiet 门只影响事件发射、OD7 只影响 reason 实参——收口行为逐字保持（D5/D6/D7） |

---

## 5. Evolution requirements

无 `evolution-required` 项：

- 唯一规范文档改动 = §22 一行资产锚（§22 既有惯例兑付，D11）；
- 公共 API 联合加性变更在协议 §23 append-only 纪律显式允许面内（D2），镜像同步为 build gate 义务性后果；
- SA3 §8-1 偏差（D4）不改变任何契约语义——回调形态无决策条款管辖，且实现保全了 DENY 冻结锚；设计 §8.1 接口表该行的形态差异属设计文档内部描述与实现间的登记性分歧（SA3 §8-1 + 源内注释已双登记），非 ADR/CONTEXT/协议修订需求；
- SA6 Revision R1（D12）是验收工件判别式修正，方向与规范字段语义一致，未引入行为或契约演进。

## 6. Hard conflicts

无。全部 13 项对照落在 no-conflict（5）或 implements-existing-decision（8）；被审 diff 未触碰任何需要正式演进路径的决策面。

## 7. Required actions

1. **无阻塞动作**。本复查闭合设计后报告 §9 的 `requiresConflictRecheck: true`（实现后一半）——公共 API 类型联合、Frozen surfaces、ALLOW/DENY 边界、单帧逐字节不变性均已逐项核对成立；
2. （非阻塞，既有归口）SA7 动态验证面可补 shed/epoch-fence/GOAWAY 行、双侧 side 覆盖与被拒 ACK 组合的计数断言（§23.1 L782「动态断言归 SA7」——设计 §13-9 已登记为 follow-up，非本票必要条件）；
3. （非阻塞，登记性）设计文档 §8.1 接口表中 `onLastChunkSent`「参数替换」行与实现形态（追加尾参）不一致——偏差已由 SA3 §8-1 与 `bulk-transfer.ts` L60–66 源内注释双登记，无需决策文档跟进；后续阅读设计文档者以两处登记为准；
4. 无需 Owner 裁决事项：D4/D6/D7/D12 四处读法/偏差均有冻结文本或「无条款管辖 + 冻结锚保全」的直接支持，不上升 Owner。

## 8. Verdict

**clear**

- 全部 13 项对照 = no-conflict（5）或 implements-existing-decision（8）；零 evolution-required、零 hard-conflict、零所需 override；
- **焦点偏差裁决（SA3 §8-1，dispatch 指定复查项）**：`onLastChunkSent` 尾参形态为 no-conflict——回调签名是包内私有实现面（`bulk-transfer.ts` 不经 `index.ts`、决策文本零引用），尾参形态在 TS 参数省略规则下保持 DENY 冻结的 issue300 锚类型成立且文件零改动；设计的全部实体义务（名字/发射点/单点事实源/同一同步栈/sent 字段）逐项保留——该偏差是对设计内部 DENY 约束的正确服从，不是对任何决策的偏离；
- SA8 设计后报告 §4 Frozen surfaces 九项逐项 vs 实际 diff 全部符合（含 SA6 Revision R1 的 owner 侧修订经 D12 裁定）；
- SA2 三条 MINOR（O-1/O-2/O-3）已按实现落实（D6 侧别方法名、D1/D2 断言全覆盖、D3/D5/D8/D9 共 11 处物理发射点接线）；
- 测试证据（契约 17/17、全包 516、根 3503、typecheck/api 型镜像全绿、md5 跨 SA 互证）引自 SA3 §6——SA8 未运行测试，仅作事实引用。

## 9. requiresConflictRecheck

**false**。理由（skill 规则：实现后复查已闭合时为 false）：

1. 公共 API 类型联合 +8 成员已落地并经本报告逐行核对 = 冻结文本逐字一致；api 型镜像同步、外部穷尽消费者（`fatal-policy.ts` default 腿）零破坏；
2. 全部 Frozen surfaces 已逐项 vs 实际 diff 核对闭合；ALLOW 七文件边界与 DENY 零触碰经 porcelain 全集核对；
3. 四处焦点（尾参偏差/被拒 ACK 零 acked/kind=1 超时零 aborted/契约 Revision R1）均在本报告裁定为决策集内相容（D4/D6/D7/D12），无尚待实现核对的公共 API、wire、schema、持久化、状态机、生命周期、失败语义或正式 override 项。

---

*SA8 只读裁决：本报告为唯一产出；未修改任何被审对象、决策文档、代码或测试；未运行测试；未派发其他 SA。*
