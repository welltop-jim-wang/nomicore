# SA4 实现静态审查 — issue #301（#295 切片 3）：分块 snapshot/sync 的 observer 8 型接线

- **dispatch**: sa-55228446-96f2-4662-b3a1-cd2b20c7a6ca（mabf-sa4 / implementation-review / iteration 0）
- **被审对象**: 当前工作树 diff vs 基线 `0f3eca5`（分支 `mabf/issue-301`；`git status` = 恰好 ALLOW 七文件 modified（521+/86−）+ 未跟踪 = SA6 契约文件 + 7 个 wiki 固定产物）
- **裁决**: **approve**（无 BLOCKER / 无 MAJOR；2 条 MINOR 观察不阻断）
- **Owner-feedback 记录**: REST comments endpoint 返回空（与 dispatch / SA6 §2 / SA2 §4 / SA3 头部一致）——无 owner 补充要求，无 owner override 需并入
- **SA4 纪律声明**: 本审查为纯静态（逐 hunk 实读 diff + 源码现状锚点核对 + 契约断言体逐字段对照 + runner/typecheck 配置核对）；未修改实现/设计/测试，未运行测试、未启动服务、未创建临时进程。SA3/SA6 报告中的运行结果（契约 17/17、全包 71 文件/516 用例、根 332 文件/3503 用例、typecheck 全绿、md5 跨 SA 互证）作为引用证据对待，SA4 的结论独立建立在静态可核验事实上。

---

## 1. Reviewed inputs

| 输入 | 状态 | 用途 |
|---|---|---|
| `wiki/raw/task_issue-301.md` | 实读 | 任务简报（AC1–AC5；§Comments 空） |
| `wiki/raw/task_issue-301_design.md` | 实读 | 批准设计（OD1–OD9、§8.1 接口表、§10 调用方矩阵、§11 ALLOW/DENY、§12 验证映射、§14/§15） |
| `wiki/raw/task_issue-301_sa2_review.md` | 实读 | SA2 攻击评审（approve；O-1/O-2/O-3 全 MINOR） |
| `wiki/raw/task_issue-301_sa3_impl.md` | 实读 | SA3 实现报告 iteration 1（含 §8-1 偏差登记、V1–V12 验证证据） |
| `wiki/raw/task_issue-301_sa6_contract.md` | 实读 | 验收契约（approve；Revision R1 §17） |
| `wiki/raw/task_issue-301_design_conflict_report.md` | 实读 | SA8 设计后冲突复查（clear；D1–D14） |
| `wiki/raw/task_issue-301_implementation_conflict_report.md` | 实读 | SA8 实现后冲突复查（clear；D1–D13；`requiresConflictRecheck: false`） |
| 当前工作树 diff（7 文件）+ 未跟踪契约文件 | 逐 hunk 实读 | 被审实体 |
| `packages/ws-replication/src/{types,bulk-transfer,hub-namespace,peer-namespace,round-engine,observer,update-transfer}.ts`、`hub-connection.ts`/`peer-connection.ts`（now/emitObserver/cidField/negotiation seam） | 实读 | 发射点/结算结构/单载体仲裁/negotiation 门现状核验 |
| `packages/ws-replication/test/ws-replication-issue301-chunked-completeness-ac-red.test.ts`（1392 行 / 17 用例） | 断言体实读 | 契约质量与实现断言逐字段对照 |
| `ws-replication-api.test-d.ts`、`ws-replication-observer-red.test.ts`、`ws-replication-issue300-{chunked-sync-ac-red,bulk-edge-ac}.test.ts` | 实读（关键锚点） | 类型镜像 / DENY 锚可达面 / 回归面独立核验 |
| `apps/yjs-server/src/fatal-policy.ts` | 实读 | 公共联合加性变更的穷尽消费者排查 |
| `docs/adr/0019-chunked-sync-transfer.md` L70–83、`docs/protocols/instance-replication-v1.md` §9.2/§22/§23.1/§23.3/§23.4 | 实读 | 冻结字段集/side 信封/键集排除/纪律条款逐字比对 |
| `vitest.config.ts`、`packages/ws-replication/tsconfig.json`、`packages/ws-replication/src/index.ts`、`packages/ws-replication/AGENTS.md` | 实读 | runner/typecheck 触发面、导出面、模块契约 |
| `wiki/raw/task_issue-301_relevant_decisions.md` / `_conflict_report.md` / `_sa4_review.md`（旧版） | 不存在 | 前置 SA8 门禁缺失已由两份 SA8 复查报告补位（design clear + implementation clear）；无返工轮 |

## 2. Verdict

**approve。** 实现是批准设计的忠实落地：8 型事件字段集/side 信封/键集排除与协议 §23.1 第 29–36 型行及 ADR 0019 L78–81 **逐字一致**（本审查逐行独立比对，非仅采信 SA8 D1）；11 处物理发射点（sent 3 / acked 3 / applied 3 / aborted 2）全部落在既有结算结构上且计数恰一性由结构单点保证；单帧路径与 kind=0 面逐字节不变；ALLOW 七文件边界与 DENY 零触碰经 porcelain 全集核对；SA6 契约 17 用例断言与实现行为逐字段对应且未被弱化；SA8 实现后复查（clear）的 Frozen surfaces 逐项经本审查独立复核成立。唯一登记偏差（`onLastChunkSent` 追加尾参而非替换）有三重登记（SA3 §8-1、`bulk-transfer.ts` L60–70 源内注释、SA8 D4/§7-3），实体义务逐项保留。无 BLOCKER / 无 MAJOR；2 条 MINOR 见 Non-blocking observations。

## 3. 上游要求落实

| Requirement or finding | Implementation evidence | Assessment |
|---|---|---|
| Issue AC1（chunk 丢失/重复/错序/超时/close/GOAWAY/断线/epoch fence 矩阵 + 零 durable 残留） | 生命周期面 slice 2 已交付；本票 diff 零 FSM/收口改动（唯一例外 = `onAssemblyTimeout` reason 实参 `kind === 1 ? undefined : 'timeout'`，hub L1939 / peer L2349；丢弃/终局行为逐字不变）；N1–N4/N9 负控锁绿（SA3 §6 V3/V4） | **已覆盖**——本票只补 aborted 可见性，未触碰已交付生命周期面 |
| Issue AC2（超时两向收口） | kind=1 → `BOOTSTRAP_FAILED` 族终局 + 零 aborted（OD7）；kind=2 → `RESYNC_REQUIRED{SYNC_TRANSFER_EXPIRED}` 非终态 + aborted{timeout}（OD6）；R5 双半断言体（契约 L809–861）与实现行为对应 | **已覆盖** |
| Issue AC3（恶意声明无界分配） | 零改动面（`update-transfer.ts` 未改，git status 空）；N5 负控（契约 L1174–1241）保持绿 | **已覆盖**（负控锁绿即回归门） |
| Issue AC4（多 ns 公平 + control reserve） | 零改动面（新状态仅 per-controller 内存字段 `chunkedAckT0`，不进调度/账本）；N8 负控（契约 L1319–1357） | **已覆盖** |
| Issue AC5（observer 8 型：发射点/改道归零/互斥/safe-field/throw isolation） | OD1–OD8 全落地（见 §4 设计落实审查）；R1–R8 断言与实现逐字段对应 | **已覆盖** |
| SA6 §8 四个直接故障点（类型面/发送侧/接收侧/aborted kind 门） | types.ts L876/890/905/918/932/948/963/976 八型；hub L596–610/L664–682/L712–730/L767–787、peer L1611–1630/L692–711 发送侧；hub L1520–1539、peer L1799–1818（kind=2 applied）、peer L622–642（kind=1 applied）；hub L1064–1086 / peer L1006–1028 kind 选路 | **逐点兑付** |
| SA6 Revision R1（R2 判别式 = `ackedSequence` 精确锚定） | 契约文件 L710–718 实读确认 = `syncApplied.filter(m => m.ackedSequence === kind2[末帧].sequence)` 恰一；与协议 §9.2 L246 规范身份一致；SA6 §17.6 mutation 敏感度 + SA3 V10 独立复现 | **修订属实且未弱化**（计数仍恰一、非恒真） |
| SA2 O-1（peer 侧 quiet 方法名） | peer `onSyncApplied` 用 `isInboundQuiet()`（peer L693/L699）、hub 用 `isQuietState()`（hub L715/L719）——按侧取真实方法名 | **落实** |
| SA2 O-2（8 型 per-type `Extract` 断言全覆盖） | api.test-d L331–386：8 型逐字段断言 + 3 处负向 `keyof` 锚（sync-acked 无 syncRoundId、snapshot-applied 无 transferId、sync-applied 无 sequence、snapshot-aborted 无 connectionId） | **落实** |
| SA2 O-3（以 §10 矩阵为准，物理调用点 11 处） | sent 3（hub L596/hub L770/peer L1614）、acked 3（hub L667/hub L718/peer L698）、applied 3（hub L1528/peer L1809/peer L636）、aborted 2（hub L1064/peer L1006）= 恰 11 处 | **落实** |
| SA8 实现后复查 Required actions 1–4 | 无阻塞动作；SA7 动态面 follow-up（§7-2）与设计文档登记性分歧（§7-3）均为非阻塞 | **闭合**（无待办落入实现面） |
| Owner comments | 空——无补充要求 | **一致**（实现未虚构 owner 义务） |

## 4. 设计落实审查

| Design decision | Implementation location | Assessment | Finding |
|---|---|---|---|
| OD1 类型面 8 型判别成员（字段集/side 信封/键集冻结逐字） | `types.ts` L876–985：snapshot 成功三型 side 字面量 hub/peer/hub；sync 四型与两 aborted 型 `ReplicationObserverSide`；sent 无 latency、applied 无 transferId/sequence/效果组、sync-acked 无 sequence/syncRoundId、aborted 无 connectionId；`reason` 复用 `ChunkedUpdateAbortReason` 零新词；联合头注释 28→36 型 + issue #301 出处 | 与协议 §23.1 L749–754/L783–784 及 ADR 0019 L78–81 **逐字一致**（本审查三源独立比对：types.ts ↔ 协议表行 ↔ api.test-d 镜像，成员计数 36/36） | 无 |
| OD2 发送侧 sent（结算记录 + 三调用点发射，末 chunk 恰一） | `bulk-transfer.ts` L45–53（`BulkTransferOutboundSettlement`）+ L212–219（`pullOne` 末 chunk 分支：`phase='awaiting-ack'` → `lastChunkSequence` 赋值 → 同一同步栈 `onLastChunkSent(seq, settlementOf(state))`——awaiting-ack 后 `pullOne` 早退 L174 ⇒ 单次触发）；hub L596–610（chunked-snapshot-sent）、hub L770–787 / peer L1614–1630（chunked-sync-sent，`syncRoundId` 取 `sendStep2` 闭包实参 = 首 chunk 绑定块同源，hub L762/peer L1613 `binding:{syncRoundId}` 同一变量） | **一致**；形态偏差（追加尾参）见 §10 O-4 | 无 |
| OD3 发送侧 acked（`settle` 返回结算记录 + 三调用点） | `bulk-transfer.ts` L225–235（awaiting-ack ∧ kind 匹配 → 先构造记录再 dispose → 返回；否则 undefined）；hub `onBootstrapAck` L667–685（ACK 违例在 settle 之前 connectionFatal return——零事件；settle → `setState('reconciling')` → 发射 = 决策落定后）；hub L718–733 / peer L698–713 `onSyncApplied`（quiet 门：hub `isQuietState()` / peer `isInboundQuiet()`；`round.onApplied` 违例 → failed 终局 → 不发射，载体仍 settle 释放；`RoundAborted` throw 路径 settle 不执行——载体由 teardown 收口零事件） | **一致**（含被拒 ACK 零 acked 的解释决策，SA8 D6 no-conflict） | 无 |
| OD4 接收侧 applied（kind=2 第五形态 + chunkCount 穿线 + svBefore 跳过） | `round-engine.ts` L54–60/L228–241/L275–288（`{form:'syncChunked'; chunkCount}` 结构化穿线）；hub L1005 / peer L952（`handleAssemblerResult` 传 `result.chunkCount`——此前被丢弃的断链接通；事实源 = `update-transfer.ts` L246–249 `declaredChunkCount`）；hub L1520–1539 / peer L1799–1818（独立字段组不展开 base；`bytes = update.byteLength`；`syncRoundId: syncRoundId!`）；svBefore 捕获门收紧 hub L1472–1475 / peer L1737–1740；单帧 else 腿 `sync-diff-applied ...base` 逐字节不变；peer degraded 判别外层先行（L1776–1792）——R23 胜出保持 | **一致** | 无 |
| OD5 接收侧 applied（kind=1 form 参数化 + 第六形态） | `peer-namespace.ts` L571–573（`form: 'single' | Readonly<{form:'chunked'; chunkCount}>`）；调用点 L547（单帧 `'single'`）/ L941–945（分块 `{form:'chunked', chunkCount: result.chunkCount}`）；t0 = `form !== 'single' && observerOn ? host.now?.()`（L588，紧邻 `registry.importReplica` 之前——「进入 apply」边界）；发射点 L622–642 在 `importResult.ok` 判定（L614–617 BOOTSTRAP_FAILED return）与 epoch 判别（L602–612 静默回收 return）之后的成功结算点、`this.lease` 赋值后、`tryOpenReplicationSession` 之前；`'single'` 分支既有 `bootstrap-imported` 逐字节不变（L619–629） | **一致**（迟到/失败路径结构性零事件） | 无 |
| OD6 中止侧 kind 选路（双侧同构） | hub L1060–1086 / peer L1002–1028：`busyKind ?? 0` reset 前捕获 → busy 守卫快照 → reset → 三型选路；全部 reason 置位点（timeout/channel-teardown/connection-teardown/epoch-fence/resync-declared/shed）在 diff 中不可见 = 零改动即自动接线；终局失败族（不带 reason）零事件保持；hub 侧 kind=1 结构性不可达（接纳门即拒），类型保留双侧 = 防御面同构先例 | **一致**（恰一不变量：busy 守卫 + 快照先于 reset 原样继承） | 无 |
| OD7 kind=1 超时零 aborted | hub L1939 / peer L2349：`clearInboundAssembly(kind === 1 ? undefined : 'timeout')`（kind 于 reset 前捕获——既有行保持）；kind=1 的 `BOOTSTRAP_FAILED` + `finalize('failed','bootstrap-timeout',…)` 终局收口逐字不变（diff 仅改 reason 实参） | **一致**（SA8 D7 no-conflict：唯一相容读法） | 无 |
| OD8 纪律面（latency 两态/safe-field/throw 隔离/无 observer 等价） | 全部发射经 `this.host.emitObserver` → `dispatchReplicationObserver`（observer.ts 零改动，try/catch 静默单点实读确认）；latency 全部条件展开（`...(x !== undefined ? {k:x} : {})`，hub L677–681/L725–729、peer L705–709、peer L640）；`sampleAckT0()` 仅 observerOn 时触 `host.now`（hub L1751–1754 / peer L2116–2119）；新字段全集 = 稳定字面量 + `cidField` 受控标识 + 有限数值（R6 深扫白名单对应） | **一致** | 无 |
| OD9-1 类型镜像 | api.test-d L240–295（36 型全联合 `toEqualTypeOf`）+ L331–386（8 型逐字段 + 负向 keyof 锚）；标题「26 型」→「36 型」修正 | **一致**；包 tsconfig `include: ["src/**/*.ts","test/**/*.ts"]` → `tsc -p` 覆盖镜像；根 vitest `typecheck.include` 覆盖 `*.test-d.ts`——双门防漂移 | 无 |
| OD9-2 §22 资产锚 | 协议文档 numstat **1 insertion / 0 deletion**；新行 L702 落 §22 列表内（§23 = L710 起，冻结文本零改动——git hunk 头 `@@ -699,6 +699,7 @@` 上下文全为既有资产锚条目） | **一致** | 无 |

## 5. 架构一致性与惯例

### 责任归属

| Behavior | Expected owner | Actual location | Assessment |
|---|---|---|---|
| sent/acked 发射点 | 控制器（`onUpdateSent`/`onUpdateAcked` 先例） | hub/peer namespace 回调体（hub L596/L770、peer L1614、hub L667/L718、peer L698） | **正确**——机制模块 `BulkTransferSender` 保持零观测面（仅供给结算记录） |
| 结算字段事实源 | 发送器自身状态 | `settlementOf(state)` 单点（bulk-transfer L278–284），`onLastChunkSent` 与 `settle` 同源 | **正确**——控制器不自记第二份 |
| assembly 进度事实源 | assembler `snapshot()` | OD6 复用（snapshot 先于 reset） | **正确** |
| round 归属事实源 | `chunkedStep2RoundId` / `sendStep2` 闭包实参 | OD4 投影 | **正确** |

### 相似能力对照

| Similar capability | Existing implementation | Actual implementation | Consistent or divergent | Reason |
|---|---|---|---|---|
| kind=0 chunked 四型（issue #245） | types.ts 第 25–28 型 + update-channel 发射纪律 | 8 型逐字结构克隆（键集/两态 latency/恰一计数） | **一致** | §23.1 各行明文「字段集对齐既有 chunked-update-* 四型」 |
| acked latency t0 锚 | kind=0：update-channel `sentAt`（末帧出站） | kind=1/2：控制器 `chunkedAckT0` 单槽（末 chunk 出站覆写） | **一致** | 同一冻结语义；记账位置差异由 per-(ns,方向) 单载体仲裁支撑（见 §8） |
| observer 分发/cidField/safeNow | observer.ts 单点 + 连接层 seam | 全部复用，零新通道 | **一致** | 实读确认 |
| §22 资产锚惯例 | #242/#246/#295/#300 各票登记 | 一句登记（契约 + 类型镜像） | **一致** | 登记性加法非契约修订 |

### 单一事实源

| Fact | Authoritative source | Derived state | Drift risk |
|---|---|---|---|
| transferId/chunkCount/totalBytes | 发送器载体状态（`settlementOf`） | sent/acked 事件字段 | 无（单点；设计备选④拒绝控制器平行记账已落实） |
| bytes（applied/acked） | wire totalBytes（assembler Σbytes 核对 / 结算记录） | 事件字段 | 无 |
| syncRoundId | round 引擎绑定块（闭包同源） | sent/applied 事件字段 | 无 |
| assembly 进度 | assembler snapshot | aborted 事件字段 | 无 |
| ack t0 | `chunkedAckT0` 覆写单槽 | ackLatencyMs 差值 | 低——仅在被结算载体上消费（§8 并发论证） |

### 生命周期对称性

| Start or acquire | Stop or release | Failure recovery | Assessment |
|---|---|---|---|
| `chunkedAckT0` 写入（末 chunk 出站） | 覆写式（新载体）/ 弃置（不消费即不可错发） | 无需清理 | **对称充分**（纯覆写单槽，无 acquire/release 语义） |
| 观测发射（同步回调）/ settlement 对象（进程内） | 无异步资源、零持久化、零 wire 投影 | dispatch 隔离吞 throw | **对称**（N7 等价锚：无 observer 零构造零时钟调用） |

### 平行机制检查

| Candidate duplicate | Existing path | Actual path | Disposition |
|---|---|---|---|
| 第二 observer 分发/白名单 | `dispatchReplicationObserver` 单点（无 per-type 白名单） | 复用（observer.ts 零改动） | 无平行 |
| 第二时钟采样通道 | `host.now`（连接层 safeNow + observer 门控） | 复用 | 无平行 |
| 第二发送结算账本 | `BulkTransferSender` 状态 | `settlementOf` 单点 | 无平行 |
| 第二清理/中止函数 | `clearInboundAssembly` 单点 | kind 选路泛化（六类 reason 挂点零复制） | 无平行 |
| 仅服务单 Issue 的抽象 | — | `BulkTransferOutboundSettlement` 三字段最小记录（kind 无关） | 无过度抽象 |

## 6. 文件范围审查

| Changed path | ALLOW entry | Purpose | Assessment |
|---|---|---|---|
| `packages/ws-replication/src/types.ts`（+131/−3） | ALLOW 1 | OD1 | **范围内** |
| `packages/ws-replication/src/bulk-transfer.ts`（+50/−3） | ALLOW 2 | OD2/OD3 | **范围内** |
| `packages/ws-replication/src/hub-namespace.ts`（+127/−28） | ALLOW 3 | OD2/3/4/6/7 hub | **范围内** |
| `packages/ws-replication/src/peer-namespace.ts`（+142/−32） | ALLOW 4 | 镜像 + OD5 | **范围内** |
| `packages/ws-replication/src/round-engine.ts`（+22/−4） | ALLOW 5 | OD4-3 | **范围内** |
| `packages/ws-replication/test/ws-replication-api.test-d.ts`（+66/−1） | ALLOW 6 | OD9-1 | **范围内** |
| `docs/protocols/instance-replication-v1.md`（+1/−0） | ALLOW 7 | OD9-2 仅 §22 一句 | **范围内**（§23.x 冻结文本零触碰） |
| 未跟踪：契约测试 + 7 wiki 文件 | SA6/各 SA 固定产物（DENY 面对契约为 SA6 所有） | 验收契约 / 任务输入 / SA 报告 | **预期存在**，非越界 |

**DENY 面零触碰**（porcelain 全集核对）：SA6 契约文件未被 SA3 修改（SA3 §5/V8/V11 + SA8 grep 复核；Revision R1 为契约 owner SA6 的 contract-only 修订，D12 no-conflict）；`observer.ts`、`update-channel.ts`、`update-transfer.ts`、`index.ts`（grep 无 BulkTransfer 导出——包内私有成立）、`replication-protocol/**`、`defaults/validate/backpressure/frame-io/lifecycle-queue`、ADR/CONTEXT、issue300/299/244/245/246/256/239/233/231/137、`ws-replication-observer-red.test.ts` 全部未改；无 `tmp-sa3`/`tmp-sa6`/探针残留；`git stash list` 无悬空（SA3 V11）。

## 7. 契约连锁审查

| Contract | Caller | Actual handling | Risk | Finding |
|---|---|---|---|---|
| `ReplicationObserverEvent` +8 成员（公共加性） | 全仓 grep：生产消费者 = hub/peer/observer/types/index（包内）；外部 = `apps/yjs-server/src/fatal-policy.ts` switch 含 `default: return false` 腿（L65–73 实读） | 非穷尽消费者零破坏；穷尽镜像仅 api.test-d（已同步 36 型） | 无 | 无 |
| `onLastChunkSent` 签名（追加尾参） | 调用点恰三（hub L596/L770、peer L1614，全随改）+ DENY 锚 issue300-bulk-edge L194（单参绑定 `lastSeq`）/L228（零参） | TS 参数省略规则下单/零参回调对加宽签名类型成立（逆变的合法面），锚文件零改动 | 无 | 无 |
| `settle(kind)` 返回值 | 调用点恰三（hub L667/L718、peer L698），返回值全消费（undefined → 零事件） | 覆盖单帧/zombie/kind 不匹配全分支 | 无 | 无 |
| `RoundHost.applyStep2` / `completeChunkedStep2` / `applyStep2Safely` 结构化 form | 实现者仅 hub（L222/L1407）/peer（L275/L1669）两控制器；普通调用点 round-engine L184 不传 form（undefined 路径不变） | 双侧随改；`form === undefined ? undefined : {syncChunked:true, chunkCount}` 保形 | 无 | 无 |
| `applyRemoteUpdate` 第 5 参 `{syncChunked:true, chunkCount}` | 构造点恰两个（双侧 applyStep2），判别 `'syncChunked' in chunked` | kind=0 `{chunkCount}` 形态正交不受影响 | 无 | 无 |
| peer `finishBootstrapImport` form 参数化 | 调用点恰两个（L547 单帧 / L941 分块） | boolean 的非法组合态被判别联合消除 | 无 | 无 |
| `clearInboundAssembly` / `onAssemblyTimeout` 内部化 | 六类 reason 置位点全部不变（diff 不可见） | kind=0 行为逐字节保持（`busyKind ?? 0` 兜底） | 无 | 无 |
| 新事件对既有测试流的侵入 | `ws-replication-observer-red.test.ts`：matrix/sentinel 两处 `assertSafe` 场景经 `chunked` 选项只压 `maxUpdateBytes`（L192–196），`maxBootstrapBytes`/`maxSyncDiffBytes` 保持 4MiB/2MiB 缺省（L801–802）且载荷极小 ⇒ 8 型不在其可达面；背压场景（L907–909 压 512B 三限）**未传 `chunkedUpdate`**（未协商 ⇒ kind=1/2 分块结构性不进入）且其锚按 type 过滤、不调用 assertSafe | `ALLOWED_KEYS` 不见未知型（未知型会响亮红——`expect(allowed).toBeDefined()`） | 无 | 无（SA2 §11/SA8 D14 结论经本审查独立复核成立） |
| issue300 契约/机制锚 | issue300-chunked-sync-ac-red **零 observer 引用**（grep 实测 0 命中）；bulk-edge 事件断言按 type 过滤（L348–381 注入、L463–476 过滤） | 新事件不出现在其断言面 | 无 | 无 |

## 8. 错误、恢复与并发

| 风险 | 静态分析 | 结论 |
|---|---|---|
| sent 重复发射 | `pullOne` 在 `phase === 'awaiting-ack'` 早退（L174）⇒ 末 chunk 分支每载体至多一次；中止载体（被拒 L196–204/teardown/shed/resync/超时弃置）到不了该点 ⇒ 与 aborted 互斥 | 结构性恰一 |
| acked 伪成功（zombie/单帧/kind 不匹配） | `settle` 三条件门 → undefined → 零事件（bulk-transfer L226–229）；kind=1 状态门先拒（hub L651–658）；ACK 违例 connectionFatal 在 settle 之前 return（hub L659–663） | 结构性恰一 |
| 被拒 ACK（round 校验失败） | `round.onApplied` → `onViolation` → failed 终局（quiet）→ `!isQuietState()`/`!isInboundQuiet()` 复核不发射；载体仍 settle 释放（既有行为不变）；对齐 kind=0 `onUpdateAck` violation 先例 | 零事件（SA8 D6 读法） |
| `chunkedAckT0` 单槽新鲜度 | per (ns,方向) 单载体（`enqueue` 非 idle 防御重置 L140–142 实读）；awaiting-ack ⟹ 本载体 `onLastChunkSent` 已触发（同一转移 L213–217）⇒ settle 返回记录时槽值恒属当前载体；载体弃置 → settle undefined → 槽不被消费；hub kind=1/kind=2 载体经状态机（bootstrapping→reconciling→live）时序上不重叠 | 结构性安全 |
| aborted 重复/竞态 clear | busy 守卫（busy 才快照）+ reset 后续 clear 零快照；fire 后 stale 零副作用（timer 早退门） | 恰一不变量继承 |
| kind=1 超时误发 aborted | `reason === undefined` → `snapshot === undefined` → 零构造（OD7）；终局互补信号 = `BOOTSTRAP_FAILED` ERROR + `namespace-failed` | 零事件 |
| applied 伪成功（导入失败/迟到/代际不符） | 发射严格在 `importResult.ok` 判定、epoch 判别（B-2a/B-2b 静默回收 return）之后；`applyRemoteUpdate` 失败/quiet 路径先于发射 return；peer degraded 判别外层先行胜出（R23） | 零事件 |
| observer/clock throw 外溢 | `dispatchReplicationObserver` try/catch 单点（observer.ts 实读）；`host.now` 连接层 safeNow 折叠 + observer 门控——无 observer 零时钟调用 | 隔离成立（N7 锚） |
| 部分完成伪装成功 | 出站被拒（M5）在末 chunk 前 dispose → 零 sent/acked；wire 互补信号（BOOTSTRAP_FAILED/resync 族）既有 | 无伪成功 |
| 资源泄漏 / 持久化残留 | 零新增 acquire；settlement/事件 = 进程内小对象零持久化零 wire；assembly 易失性不变（N1–N5/N9 锚） | 无 |

## 9. 测试质量审查

| Test | Behavior asserted | Runner entry | Weakening or gap | Finding |
|---|---|---|---|---|
| R1（L554–631） | 三成功型恰一 + 字段 = wire 申报（`expectWellFormedTransfer` Σbytes/chunkIndex 逐帧核对）+ forbidden sequence/latency/transferId/stages + 普通族归零 + 单 BOOTSTRAP_ACK 锚末 chunk 帧序 | `vitest.config.ts` `include: packages/*/test/**/*.test.ts` 命中 | 无——前置断言（transfer 结构）先行，红灯非 fixture 空转 | 无 |
| R2（L635–722） | 双向三成功型 + syncRoundId=wire round（来自 SYNC_STEP1 交叉验证 L650–655）+ acked 键集冻结 + 改道增量零 + **Revision R1 判别式**（L713–718 `ackedSequence` 精确锚定恰一） | 同上 | 无——判别式非恒真（SA6 §17.6 + SA3 V10 mutation 双向实证：`帧序+1` → 恰在该断言失败）；非放宽（仍恰一） | 无 |
| R3/R4/R8（L726–808/L978–1022） | aborted{channel-teardown / connection-teardown} 恰一 + transferId/进度 = wire 实测 + 无 connectionId + 零 applied/零写入/零 dirty + R8 draining 状态 | 同上 | 无 | 无 |
| R5（L809–861） | AC2 绿半（`SYNC_TRANSFER_EXPIRED` 非终态、零 ERROR、零 failed、值不变、零 dirty）先通过后红半（hub aborted{timeout} 恰一 + 进度一致） | 同上 | 无 | 无 |
| R6（L863–940） | 4 次真实运行收集全 8 型；键集 ⊆ 冻结白名单（`EVENT_KEYS` 与 types.ts 逐键一致——本审查比对）；深扫无 Uint8Array/ArrayBuffer/DataView/Error；JSON 无 token/owner/内容哨兵（'zzzzz'/'qqqqq'） | 同上 | 无 | 无 |
| R7（L942–976） | clock 缺省 → 四键**整键缺失**（`'applyLatencyMs' in event === false`——非 undefined 值） | 同上 | 无 | 无 |
| N1–N9（L1023–1391） | 生命周期/声明/调度/改道条件/等价性负控，实现后保持绿（SA3 V3/V4） | 同上 | 无——N1 按 SA6 §12.3-1 不锁 kind=1 超时 aborted 计数（OD7 静态保证零，见 §11 动态项） | 无 |
| 契约纪律 | 17 `it(`、零 skip/only/todo、零 `process.env`、零源码字符串/正则断言（grep 实测）；fixture 经 `try/finally ctx.stop()` 隔离清理；虚拟时间仅在两个超时用例受控推进 | 同上 | 无 | 无 |
| api.test-d 型测（L240–386） | 36 型全联合 `toEqualTypeOf` + 8 型逐字段 + 负向 keyof 锚 | 包 tsconfig include `test/**/*.ts`（`tsc -p`）+ 根 vitest `typecheck.include *.test-d.ts` 双门 | 无——types.ts 加成员而镜像不同步即 typecheck 红（防漂移自带） | 无 |

## 10. Required revisions

无（无 BLOCKER / 无 MAJOR）。

## 11. 后续动态验证项

| Risk | Driver | Expected observation | Failure condition |
|---|---|---|---|
| 被拒 ACK（SYNC_APPLIED round 校验失败）时 chunked-sync-acked 计数 | SA7 动态面（§23.1 L782 既有归口；设计 §13-2 登记） | 载体被 settle 释放 + 零 acked 事件 + `SYNC_STATE_VIOLATION` → failed 终局 | 出现 acked 事件或载体泄漏（settle 后仍占用） |
| kind=1 超时零 aborted 计数（OD7 读法的行为面确认；N1 不锁） | SA7 动态面 | `namespace-failed{bootstrap-timeout}` 终局 + 零成功型 + **零** `chunked-snapshot-aborted` | 出现 aborted{timeout}（kind=1） |
| shed / resync-declared / epoch-fence 三 reason 行在 kind=1/2 aborted 上的路由与计数（R3/R4/R5/R8 只覆盖 channel/connection/timeout 行；peer epoch-fence last-writer-wins 覆盖为 §23.1 既有裁决） | SA7 动态面 | 对应 reason 恰一 + 进度一致 + 互斥 | reason 错行/重复/与成功型并存 |
| ackTimeoutMs 弃置后 zombie 迟到 SYNC_APPLIED/BOOTSTRAP_ACK | SA7 动态面（结构上 settle → undefined，静态已保证） | 零 acked、零状态迁移 | 出现 acked 或重复结算 |
| hub 侧 `chunked-snapshot-aborted` 结构性不可达（防御面） | SA7 动态面（可选） | hub kind=1 入站接纳即 `NAMESPACE_STATE_VIOLATION`，assembly 永不 busy | hub 出现该型事件 |

## 12. Non-blocking observations

| ID | Severity | Observation | 建议处理 |
|---|---|---|---|
| O-4 | MINOR | 设计 §8.1 接口表将 `onLastChunkSent` 写作「参数 `number` → `BulkTransferOutboundSettlement` **替换**」；实现为**追加第 2 参**（保 DENY 冻结锚 issue300-bulk-edge L194 的类型绑定）。偏差已三重登记（SA3 §8-1、`bulk-transfer.ts` L60–70 源内注释、SA8 实现后报告 D4/§7-3），实体义务（名字/发射点/单点事实源/同一同步栈/sent 字段）逐项保留；但后续仅读设计文档者可能被接口表误导 | 已充分登记，无需改动；后续设计文档维护时以两处登记为准（SA8 §7-3 同判） |
| O-5 | MINOR | `chunked-snapshot-applied.applyLatencyMs` 的 t0 = `registry.importReplica` 调用前采样（含 Registry 排队），与 `chunked-sync-applied` 的 apply 边界 t0 在语义上同为「进入排他 apply」口径但物理边界不同——这是设计 OD5 的显式选择（对齐既有 applyRemoteUpdate t0 纪律），非实现偏差；仅提示观测口径解读时注意 | 无需改动；SA7/文档解读时以 OD5 口径为准 |

---

## 结论

实现对批准设计 OD1–OD9 逐项忠实落地：8 型事件字段集与 ADR 0019 L78–81 / 协议 §23.1 第 29–36 型冻结行逐字一致（三源独立比对）；11 处发射点全部位于既有结算结构、计数恰一性由结构单点保证；单帧路径、kind=0 面、六类 reason 置位点、FSM/失败语义逐字节不变；ALLOW 七文件边界与 DENY 零触碰经 porcelain 全集核对；SA6 契约（含 Revision R1）断言未被弱化且与实现行为逐字段对应；SA8 实现后复查（clear）的 Frozen surfaces 经本审查独立复核全部成立；SA2 三条 MINOR 已落实。静态可核验面未发现 BLOCKER/MAJOR 缺陷；运行时绿灯证据（17/17、516、3503、typecheck 全绿）引自 SA3/SA6 且经 md5 跨 SA 互证，静态分析与之相互印证。**approve。**

*SA4 只读审查：未修改实现、设计或测试；未运行测试、未启动服务、未创建临时进程；唯一产出为本文件。*
