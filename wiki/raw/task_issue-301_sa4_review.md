# SA4 实现静态审查 — issue #301（#295 切片 3）：分块 snapshot/sync 的 observer 8 型接线

- **dispatch**: iteration 0 = sa-55228446-96f2-4662-b3a1-cd2b20c7a6ca；**iteration 1（当前，已提交最终交付 + 空白卫生修正复核）= sa-6a1565a2-157a-4f97-9150-a14e85b4e00d（mabf-sa4 / implementation-review / iteration 1）**
- **被审对象（iteration 1）**: **已提交最终交付**——commit `799a6182b818`（`feat(ws-replication): complete chunked observer events`，单提交、parent = 基线 `0f3eca5`、工作树 clean）vs 基线 `0f3eca5` 的全量 diff；含 dispatch 点名的「commit readiness 空白卫生修正」（5 个已入库证据产物的 EOF 多余空行删除）
- **裁决**: **approve（iteration 1 维持）**——无 BLOCKER / 无 MAJOR；3 条 MINOR 观察不阻断
- **Owner-feedback 记录**: REST comments endpoint 返回空（与 dispatch / SA6 §2 / SA2 §4 / SA3 头部一致）——无 owner 补充要求，无 owner override 需并入
- **SA4 纪律声明**: 本审查为纯静态（提交全量 diff 逐 hunk 实读 + blob 级 git 取证 + 源码现状锚点核对 + 契约断言体对照 + runner/typecheck 配置核对）；未修改实现/设计/测试，未运行测试、未启动服务、未创建临时进程、未 commit/push。SA3/SA6/SA7 报告中的运行结果（契约 17/17、全包 71 文件/516 用例、根 332 文件/3503 用例、typecheck 全绿、md5 跨 SA 互证）作为引用证据对待；SA4 的结论独立建立在静态可核验事实上。

---

## 1. Reviewed inputs

| 输入 | 状态 | 用途 |
|---|---|---|
| `wiki/raw/task_issue-301.md` | 实读（HEAD 版 38 行） | 任务简报（AC1–AC5；§Comments 空）；空白修正后正文逐字节不变（§6.2 取证） |
| `wiki/raw/task_issue-301_design.md` | 实读 | 批准设计（OD1–OD9、§8.1 接口表、§10 调用方矩阵、§11 ALLOW/DENY、§12 验证映射、§14/§15） |
| `wiki/raw/task_issue-301_sa2_review.md` | 实读 | SA2 攻击评审（approve；O-1/O-2/O-3 全 MINOR） |
| `wiki/raw/task_issue-301_sa3_impl.md` | 实读（iteration 2 版） | SA3 实现报告（§8-1 尾参偏差、§8-4 空白卫生 DENY 偏差登记、V1–V18 验证证据、修前/修后 blob 记录） |
| `wiki/raw/task_issue-301_sa6_contract.md` | 实读 | 验收契约（approve；Revision R1 §17） |
| `wiki/raw/task_issue-301_sa7_report.md` | 实读（iteration 1 新增输入） | SA7 动态验证（approve；P1–P10 探针闭合 SA4 动态面表 5 行；§10-1 shed 行修正性 finding） |
| `wiki/raw/task_issue-301_design_conflict_report.md` | 实读 | SA8 设计后冲突复查（clear；D1–D14） |
| `wiki/raw/task_issue-301_implementation_conflict_report.md` | 实读 | SA8 实现后冲突复查（clear；D1–D13；`requiresConflictRecheck: false`） |
| **commit `799a618` 全量 diff（21 文件）+ blob 级取证** | 逐 hunk 实读 | **iteration 1 被审实体**（§6.1/§6.2） |
| `packages/ws-replication/src/{types,bulk-transfer,hub-namespace,peer-namespace,round-engine,observer,update-transfer}.ts`、`hub-connection.ts`/`peer-connection.ts` | HEAD 实读 | 发射点/结算结构/单载体仲裁/negotiation 门现状核验（提交态逐点复核） |
| `packages/ws-replication/test/ws-replication-issue301-chunked-completeness-ac-red.test.ts`（HEAD 版 1392 行 / 17 用例） | 断言体实读 | 契约质量与实现断言逐字段对照（含 Revision R1 判别式 L714） |
| `ws-replication-api.test-d.ts`、`ws-replication-observer-red.test.ts`、`ws-replication-issue300-{chunked-sync-ac-red,bulk-edge-ac}.test.ts` | 实读（关键锚点） | 类型镜像 / DENY 锚可达面 / 回归面独立核验 |
| `apps/yjs-server/src/fatal-policy.ts` | 实读 | 公共联合加性变更的穷尽消费者排查 |
| `docs/adr/0022-chunked-sync-transfer.md` L70–83、`docs/protocols/instance-replication-v1.md` §9.2/§22/§23.1/§23.3/§23.4 | 实读 | 冻结字段集/side 信封/键集排除/纪律条款逐字比对 |
| `vitest.config.ts`、`packages/ws-replication/tsconfig.json`、`packages/ws-replication/src/index.ts`、`packages/ws-replication/AGENTS.md` | 实读 | runner/typecheck 触发面、导出面、模块契约（observer 隔离、FSM 不变量、验证门） |
| `wiki/raw/task_issue-301_relevant_decisions.md` / `_conflict_report.md` | 不存在 | 前置 SA8 门禁缺失已由两份 SA8 复查报告补位（design clear + implementation clear） |

## 2. Verdict

**approve（iteration 1 维持）。** 已提交最终交付（`799a618`）是批准设计的忠实落地：

- **实现字节连续性**：5 个实现文件（types/bulk-transfer/hub-namespace/peer-namespace/round-engine）HEAD md5 与 SA3 §2 / SA6 §16 跨 SA 记录**逐字相同**（`912350fc…`/`2089bfe4…`/`200744a0…`/`935c3fcf…`/`dead8d68…`）——被提交的实现与 SA4 iteration 0 逐 hunk 审过、SA6 Revision R1 复核、SA8 实现后复查、SA7 动态验证的**是同一批字节**，审查链证据全部延续有效；
- **设计落实**：8 型事件字段集/side 信封/键集排除与协议 §23.1 第 29–36 型行及 ADR 0022 L78–81 逐字一致（本审查在 HEAD 三源独立比对 types.ts ↔ 协议表行 ↔ api.test-d 镜像，成员计数 36/36）；11 处物理发射点（sent 3 / acked 3 / applied 3 / aborted 2）全部落在既有结算结构上、恰一性由结构单点保证；单帧路径与 kind=0 面逐字节不变；
- **commit readiness 空白卫生修正**：5 个被点名文件（4 个 `artifacts/sa7-issue301-*.log` + `wiki/raw/task_issue-301.md`）的修正经 blob 级取证证实为**严格空白等价**（每文件唯一差异 = 删除 EOF 一个空行，正文逐字节不变；行数 202→201 / 11→10 / 58→57 / 14→13 / 39→38 与 SA3 §10 记录一致；HEAD blob id 与 SA3 修后记录逐字相同）；`git show --check HEAD` 与 `git diff --check 0f3eca5..HEAD` 均 **exit 0 零输出**；
- **范围**：提交 = 7 个 ALLOW 文件（M）+ SA6 契约（A，SA6 所有）+ 4 个 SA7 证据日志（A）+ 9 个 wiki 固定产物（A）——全部为本票交付集，DENY 面在基线↔HEAD 全集 diff 中**零命中**；
- SA6 契约（含 Revision R1）在 HEAD 断言未被弱化（17 `it(`、零 skip/only/todo/env、判别式 L714 在位）；SA8 实现后复查（clear）的 Frozen surfaces 逐项经本审查独立复核成立；SA7 动态验证（approve）已闭合 SA4 iteration 0 登记的全部后续动态验证项（含 shed 行修正，见 §11）。

无 BLOCKER / 无 MAJOR；3 条 MINOR 见 Non-blocking observations。

## 3. 上游要求落实

| Requirement or finding | Implementation evidence（HEAD） | Assessment |
|---|---|---|
| Issue AC1（chunk 丢失/重复/错序/超时/close/GOAWAY/断线/epoch fence 矩阵 + 零 durable 残留） | 生命周期面 slice 2 已交付；提交 diff 零 FSM/收口改动（唯一例外 = `onAssemblyTimeout` reason 实参 `kind === 1 ? undefined : 'timeout'`，hub L1941 / peer L2351；丢弃/终局行为逐字不变）；N1–N4/N9 负控锁绿（SA3 V3/V4；SA7 本轮复跑 17/17） | **已覆盖**——本票只补 aborted 可见性，未触碰已交付生命周期面 |
| Issue AC2（超时两向收口） | kind=1 → `BOOTSTRAP_FAILED` 族终局 + 零 aborted（OD7）；kind=2 → `RESYNC_REQUIRED{SYNC_TRANSFER_EXPIRED}` 非终态 + aborted{timeout}（OD6）；R5 双半断言体与实现行为对应（SA7 P5/P6 变体再证） | **已覆盖** |
| Issue AC3（恶意声明无界分配） | 零改动面（`update-transfer.ts` 基线↔HEAD diff 空）；N5 负控保持绿 | **已覆盖**（负控锁绿即回归门） |
| Issue AC4（多 ns 公平 + control reserve） | 零改动面（新状态仅 per-controller 内存字段 `chunkedAckT0`，不进调度/账本）；N8 负控 | **已覆盖** |
| Issue AC5（observer 8 型：发射点/改道归零/互斥/safe-field/throw isolation） | OD1–OD8 全落地（见 §4）；R1–R8 断言与实现逐字段对应（SA3 V3 实测 + SA7 C1 独立复跑） | **已覆盖** |
| SA6 §8 四个直接故障点（类型面/发送侧/接收侧/aborted kind 门） | types.ts L876/890/905/918/932/948/963/976 八型；hub L596–610/L664–685/L767–787、peer L1611–1630/L692–712 发送侧；hub L1520–1539、peer L1799–1818（kind=2 applied）、peer L622–642（kind=1 applied）；hub L1051–1077 / peer L994–1020 kind 选路（HEAD 行号，与 iteration 0 一致——字节未变） | **逐点兑付** |
| SA6 Revision R1（R2 判别式 = `ackedSequence` 精确锚定） | HEAD 契约文件 L713–718 实读确认 = `syncApplied.filter(m => m.ackedSequence === kind2[末帧].sequence)` 恰一；与协议 §9.2 L246 规范身份一致；SA6 §17.6 mutation + SA3 V10 双向实证 | **修订属实且未弱化**（计数仍恰一、非恒真） |
| SA2 O-1（peer 侧 quiet 方法名） | peer `onSyncApplied` 用 `isInboundQuiet()`、hub 用 `isQuietState()`——按侧取真实方法名 | **落实** |
| SA2 O-2（8 型 per-type `Extract` 断言全覆盖） | api.test-d L331–386（HEAD）：8 型逐字段断言 + 3 处负向 `keyof` 锚（sync-acked 无 syncRoundId、snapshot-applied 无 transferId、sync-applied 无 sequence、snapshot-aborted 无 connectionId） | **落实** |
| SA2 O-3（以 §10 矩阵为准，物理调用点 11 处） | sent 3（hub L596/hub L770/peer L1614）、acked 3（hub L667/hub L718/peer L698）、applied 3（hub L1528/peer L1809/peer L636）、aborted 2（hub L1064/peer L1006）= 恰 11 处 | **落实** |
| SA8 实现后复查 Required actions 1–4 | 无阻塞动作；SA7 动态面 follow-up 已由 SA7 报告兑付（§7-2）；设计文档登记性分歧（§7-3）非阻塞 | **闭合** |
| SA7 §10-1（shed × kind=1/2 结构性零事件面） | 行为符合设计（§244 D5 既有裁决：非 live 通道不清 assembly；入站 busy kind=1/2 结构性蕴含非 live）；kind=0 shed 行由 issue-244 D-SHED1/2 持续锁绿 | **非缺陷**——SA4 iteration 0 动态面表行 3 措辞过宽，已在 §11 修正 |
| iteration 2 dispatch 空白卫生要求（5 个已入库产物 EOF 空行 + staging check 干净） | §6.2 blob 取证：5 文件修正 = 严格空白等价；`git show --check HEAD` / `git diff --check 0f3eca5..HEAD` exit 0 | **达成**（commit readiness 闭环） |
| Owner comments | 空——无补充要求 | **一致**（实现未虚构 owner 义务） |

## 4. 设计落实审查

（HEAD 逐 hunk 复核；实现字节与 iteration 0 审查对象逐字相同（md5 互证），行号锚沿用并经本轮直读复核。）

| Design decision | Implementation location（HEAD） | Assessment | Finding |
|---|---|---|---|
| OD1 类型面 8 型判别成员（字段集/side 信封/键集冻结逐字） | `types.ts` L860–986：snapshot 成功三型 side 字面量 hub/peer/hub；sync 四型与两 aborted 型 `ReplicationObserverSide`；sent 无 latency、applied 无 transferId/sequence/效果组、sync-acked 无 sequence/syncRoundId、aborted 无 connectionId；`reason` 复用 `ChunkedUpdateAbortReason` 零新词；联合头注释 28→36 型 + issue #301 出处（L365–374） | 与协议 §23.1 L749–754/L783–784 及 ADR 0022 L78–81 **逐字一致**（三源独立比对：types.ts ↔ 协议表行 ↔ api.test-d 镜像，36/36） | 无 |
| OD2 发送侧 sent（结算记录 + 三调用点发射，末 chunk 恰一） | `bulk-transfer.ts` L45–53（`BulkTransferOutboundSettlement`）+ L212–219（`pullOne` 末 chunk 分支：`phase='awaiting-ack'` → `lastChunkSequence` 赋值 → 同一同步栈 `onLastChunkSent(seq, settlementOf(state))`——awaiting-ack 后 `pullOne` 早退 L174 ⇒ 单次触发）；hub L596–610（chunked-snapshot-sent）、hub L770–787 / peer L1614–1630（chunked-sync-sent，`syncRoundId` 取 `sendStep2` 闭包实参 = 首 chunk 绑定块同源变量） | **一致**；形态偏差（追加尾参）见 §12 O-4 | 无 |
| OD3 发送侧 acked（`settle` 返回结算记录 + 三调用点） | `bulk-transfer.ts` L228–238（awaiting-ack ∧ kind 匹配 → 先构造记录再 dispose → 返回；否则 undefined）；hub `onBootstrapAck` L651–685（状态门 + seq 核对 `connectionFatal('ACK_STATE_VIOLATION')` 在 settle 之前 return——零事件；settle → `setState('reconciling')` → 发射 = 决策落定后，本轮直读复核）；hub L712–733 / peer L692–713 `onSyncApplied`（quiet 门：hub `isQuietState()` / peer `isInboundQuiet()`；被拒 ACK 零 acked、载体仍 settle 释放；`RoundAborted` throw 路径 settle 不执行） | **一致**（含被拒 ACK 零 acked 解释决策，SA8 D6 no-conflict + SA7 P2 行为面确认） | 无 |
| OD4 接收侧 applied（kind=2 第五形态 + chunkCount 穿线 + svBefore 跳过） | `round-engine.ts` L54–60/L228–241/L279–288（`{form:'syncChunked'; chunkCount}` 结构化穿线）；hub L1005 / peer L952（`handleAssemblerResult` 传 `result.chunkCount`——断链接通；事实源 = `update-transfer.ts` L97–99 wire 申报 chunkCount）；hub L1520–1539 / peer L1799–1818（独立字段组不展开 base；`bytes = update.byteLength`；`syncRoundId: syncRoundId!`——isStep2 恒有 roundId（D2），断言安全）；svBefore 捕获门收紧 hub L1472–1475 / peer L1737–1740；单帧 else 腿 `sync-diff-applied ...base` 逐字节不变；peer degraded 判别外层先行（L1776–1792）——R23 胜出保持 | **一致** | 无 |
| OD5 接收侧 applied（kind=1 form 参数化 + 第六形态） | `peer-namespace.ts` L571–573（form 判别联合）；调用点 L547（单帧 `'single'`）/ L941–945（分块 `{form:'chunked', chunkCount}`）；t0 = `form !== 'single' && observerOn ? host.now?.()`（L588，紧邻 `registry.importReplica` 之前）；发射点 L622–642 在 `importResult.ok` 判定（L613–617 BOOTSTRAP_FAILED return）与 epoch 判别静默回收之后、`this.lease` 赋值（L618）后、`tryOpenReplicationSession`（L643）之前——本轮直读复核次序；`'single'` 分支既有 `bootstrap-imported` 逐字节不变 | **一致**（迟到/失败路径结构性零事件） | 无 |
| OD6 中止侧 kind 选路（双侧同构） | hub L1051–1077 / peer L994–1020：`busyKind ?? 0` reset 前捕获 → busy 守卫快照 → reset → 三型选路；全部 reason 置位点（timeout/channel-teardown/connection-teardown/epoch-fence/resync-declared/shed）在 diff 中不可见 = 零改动即自动接线；终局失败族（不带 reason）零事件保持；hub 侧 kind=1 结构性不可达（SA7 P10 行为面确认），类型保留双侧 = 防御面同构先例 | **一致**（恰一不变量：busy 守卫 + 快照先于 reset 原样继承；SA7 P3 重复触发零追加再证） | 无 |
| OD7 kind=1 超时零 aborted | hub L1941 / peer L2351：`clearInboundAssembly(kind === 1 ? undefined : 'timeout')`（kind 于 reset 前捕获——既有行保持）；kind=1 的 `BOOTSTRAP_FAILED` + `finalize('failed','bootstrap-timeout',…)` 终局收口逐字不变（diff 仅改 reason 实参） | **一致**（SA8 D7 no-conflict + SA7 P1 行为面确认：aborted=0） | 无 |
| OD8 纪律面（latency 两态/safe-field/throw 隔离/无 observer 等价） | 全部发射经 `this.host.emitObserver` → `dispatchReplicationObserver`（observer.ts 基线↔HEAD 零改动，try/catch 静默单点实读确认）；latency 全部条件展开（hub L677–681/L725–729、peer L640/L706–710）；`sampleAckT0()` 仅 observerOn 时触 `host.now`（hub L1751–1754 / peer L2116–2119）；新字段全集 = 稳定字面量 + `cidField` 受控标识 + 有限数值 | **一致**（R6/R7/N7 锚绿） | 无 |
| OD9-1 类型镜像 | api.test-d L240–295（36 型全联合 `toEqualTypeOf`）+ L331–386（8 型逐字段 + 3 处负向 keyof 锚）；标题「26 型」→「36 型」修正 | **一致**；包 tsconfig `include: ["src/**/*.ts","test/**/*.ts"]` → `tsc -p` 覆盖镜像；根 vitest `typecheck.include *.test-d.ts`——双门防漂移（本轮配置直读复核） | 无 |
| OD9-2 §22 资产锚 | 协议文档基线↔HEAD numstat **1 insertion / 0 deletion**；新行 L702 落 §22 列表内（§23 = L710 起，冻结文本零改动——hunk 头 `@@ -699,6 +699,7 @@` 上下文全为既有资产锚条目；基线既有的 EOF 空行不在 diff 面，非本票引入） | **一致** | 无 |

## 5. 架构一致性与惯例

### 责任归属

| Behavior | Expected owner | Actual location | Assessment |
|---|---|---|---|
| sent/acked 发射点 | 控制器（`onUpdateSent`/`onUpdateAcked` 先例） | hub/peer namespace 回调体（hub L596/L770、peer L1614、hub L667/L718、peer L698） | **正确**——机制模块 `BulkTransferSender` 保持零观测面（仅供给结算记录） |
| 结算字段事实源 | 发送器自身状态 | `settlementOf(state)` 单点（bulk-transfer L281–287），`onLastChunkSent` 与 `settle` 同源 | **正确**——控制器不自记第二份 |
| assembly 进度事实源 | assembler `snapshot()` | OD6 复用（snapshot 先于 reset；`update-transfer.ts` 零改动） | **正确** |
| round 归属事实源 | `chunkedStep2RoundId` / `sendStep2` 闭包实参 | OD4 投影 | **正确** |

### 相似能力对照

| Similar capability | Existing implementation | Actual implementation | Consistent or divergent | Reason |
|---|---|---|---|---|
| kind=0 chunked 四型（issue #245） | types.ts 第 25–28 型 + update-channel 发射纪律 | 8 型逐字结构克隆（键集/两态 latency/恰一计数） | **一致** | §23.1 各行明文「字段集对齐既有 chunked-update-* 四型」 |
| acked latency t0 锚 | kind=0：update-channel `sentAt`（末帧出站） | kind=1/2：控制器 `chunkedAckT0` 单槽（末 chunk 出站覆写） | **一致** | 同一冻结语义；记账位置差异由单载体仲裁支撑（见 §8） |
| observer 分发/cidField/safeNow | observer.ts 单点 + 连接层 seam | 全部复用，零新通道 | **一致** | 实读确认（DENY 零改动） |
| §22 资产锚惯例 | #242/#246/#295/#300 各票登记 | 一句登记（契约 + 类型镜像） | **一致** | 登记性加法非契约修订 |

### 单一事实源

| Fact | Authoritative source | Derived state | Drift risk |
|---|---|---|---|
| transferId/chunkCount/totalBytes | 发送器载体状态（`settlementOf`） | sent/acked 事件字段 | 无（单点；控制器平行记账已被设计备选④拒绝并落实） |
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

### 6.1 提交范围（commit `799a618`，21 文件）

| Changed path（HEAD 状态） | ALLOW entry | Purpose | Assessment |
|---|---|---|---|
| `packages/ws-replication/src/types.ts`（M，+131/−3） | ALLOW 1 | OD1 | **范围内** |
| `packages/ws-replication/src/bulk-transfer.ts`（M，+50/−3） | ALLOW 2 | OD2/OD3 | **范围内** |
| `packages/ws-replication/src/hub-namespace.ts`（M，+127/−28） | ALLOW 3 | OD2/3/4/6/7 hub | **范围内** |
| `packages/ws-replication/src/peer-namespace.ts`（M，+142/−32） | ALLOW 4 | 镜像 + OD5 | **范围内** |
| `packages/ws-replication/src/round-engine.ts`（M，+22/−4） | ALLOW 5 | OD4-3 | **范围内** |
| `packages/ws-replication/test/ws-replication-api.test-d.ts`（M，+66/−1） | ALLOW 6 | OD9-1 | **范围内** |
| `docs/protocols/instance-replication-v1.md`（M，+1/−0） | ALLOW 7 | OD9-2 仅 §22 一句 | **范围内**（§23.x 冻结文本零触碰） |
| `packages/ws-replication/test/ws-replication-issue301-chunked-completeness-ac-red.test.ts`（A，1392 行） | SA6 契约（DENY 面对 SA3；文件本体为 SA6 固定验收输入） | 验收契约随交付入库 | **预期存在**——HEAD 实测 17 `it(`、零 skip/only/todo/env、Revision R1 判别式 L714 在位；SA6 §16/SA3 V11 的 md5 互证链未破坏 |
| `artifacts/sa7-issue301-{package-tests,post-removal-verify,probe-dynamic,supporting-suites}.log`（A，4 文件） | 设计 ALLOW/DENY 均未列（SA7 证据产物；iteration 2 dispatch 点名） | SA7 动态验证证据日志 | **预期存在**——空白修正后正文逐字节不变（§6.2），SA7 §3/§5 计数结论证据继续有效 |
| `wiki/raw/task_issue-301.md`（A，38 行） | 设计 §11 DENY「只读上游产物」；**iteration 2 dispatch 点名授权**（SA3 §8-4 登记） | 任务简报随交付入库 + EOF 空行删除 | **授权偏差，内容中性**（§6.2 取证；§12 O-6） |
| `wiki/raw/task_issue-301_{design,design_conflict_report,implementation_conflict_report,sa2_review,sa3_impl,sa4_review,sa6_contract,sa7_report}.md`（A，8 文件） | 各 SA skill 固定产物 | 本票过程产物随交付入库 | **预期存在**，非越界 |

**DENY 面零触碰**（基线 `0f3eca5` ↔ HEAD 全集 pathspec diff 零命中，本轮实测）：`observer.ts`、`update-channel.ts`、`update-transfer.ts`、`index.ts`（无 BulkTransfer 导出——包内私有成立）、`replication-protocol/**`、`defaults/validate/backpressure/frame-io/lifecycle-queue`、ADR/CONTEXT、issue300/299/244/245/246/256/239/233/231/137、`ws-replication-observer-red.test.ts`；无 `tmp-sa3`/`tmp-sa6`/探针/bisect 残留（test 目录 grep 零命中）；`git stash list` 空；工作树 clean（`git status --porcelain` 零输出）。

### 6.2 空白卫生修正取证（iteration 2 dispatch 点名项）

| 检查 | 方法 | 结果 |
|---|---|---|
| 修正严格空白等价 | 修前索引 blob（`git cat-file`，SA3 §10.2 记录的 `00a70374…`/`5f4f6903…`/`55a9b6b8…`/`9b9cb3d4…`/`5c4b4663…`，对象库仍在）vs HEAD 内容逐文件 `diff` | 每文件**唯一差异 = 删除 EOF 一个空行**（`202d201`/`11d10`/`58d57`/`14d13`/`39d38`），正文/日志字节零变化，无夹带修改 |
| HEAD blob 与 SA3 修后记录一致 | `git rev-parse HEAD:<path>` | `12ec9384…`/`3a792695…`/`712b6969…`/`bdc501f0…`/`4d969789…` 与 SA3 §10.2 修后 blob 记录**逐字相同** |
| EOF 单换行 | `git show HEAD:<path> \| tail -c 12 \| od -c` | 5 文件均以单一 `\n` 收尾 |
| staging/commit 门 | `git show --check --format= HEAD`；`git diff --check 0f3eca5..HEAD` | 均 **exit 0、零输出**——`new blank line at EOF` 违规清零，commit readiness 达成 |
| 实现面隔离 | `git diff --name-only 0f3eca5..HEAD -- packages/ docs/` 与 §6.1 对账 | 修正仅涉 5 个证据产物；`packages/**`、`docs/**`、契约（DENY）零额外改动 |

## 7. 契约连锁审查

| Contract | Caller | Actual handling | Risk | Finding |
|---|---|---|---|---|
| `ReplicationObserverEvent` +8 成员（公共加性） | 全仓 grep：生产消费者 = hub/peer/observer/types/index（包内）；外部 = `apps/yjs-server/src/fatal-policy.ts` switch 含 `default: return false` 腿 | 非穷尽消费者零破坏；穷尽镜像仅 api.test-d（HEAD 已同步 36 型） | 无 | 无 |
| `onLastChunkSent` 签名（追加尾参） | 调用点恰三（hub L596/L770、peer L1614，全随改）+ DENY 锚 issue300-bulk-edge L194（单参绑定 `lastSeq`）/L228（零参） | TS 参数省略规则下单/零参回调对加宽签名类型成立，锚文件零改动（基线↔HEAD diff 空实测） | 无 | 无 |
| `settle(kind)` 返回值 | 调用点恰三（hub L667/L718、peer L698），返回值全消费（undefined → 零事件） | 覆盖单帧/zombie/kind 不匹配全分支 | 无 | 无 |
| `RoundHost.applyStep2` / `completeChunkedStep2` / `applyStep2Safely` 结构化 form | 实现者仅 hub（L222/L1411）/peer（L275/L1673）两控制器；普通调用点 round-engine L184 不传 form（undefined 路径不变） | 双侧随改；`form === undefined ? undefined : {syncChunked:true, chunkCount}` 保形 | 无 | 无 |
| `applyRemoteUpdate` 第 5 参 `{syncChunked:true, chunkCount}` | 构造点恰两个（双侧 applyStep2），判别 `'syncChunked' in chunked` | kind=0 `{chunkCount}` 形态正交不受影响 | 无 | 无 |
| peer `finishBootstrapImport` form 参数化 | 调用点恰两个（L547 单帧 / L941 分块） | boolean 的非法组合态被判别联合消除 | 无 | 无 |
| `clearInboundAssembly` / `onAssemblyTimeout` 内部化 | 六类 reason 置位点全部不变（diff 不可见） | kind=0 行为逐字节保持（`busyKind ?? 0` 兜底） | 无 | 无 |
| 新事件对既有测试流的侵入 | `ws-replication-observer-red.test.ts`：两处 `assertSafe` 场景经 `chunked` 选项只压 `maxUpdateBytes`（8KiB kind=0），`maxBootstrapBytes`/`maxSyncDiffBytes` 保持 4MiB/2MiB 缺省 ⇒ 8 型不在其可达面；背压场景未传 `chunkedUpdate`（未协商 ⇒ kind=1/2 分块结构性不进入） | `ALLOWED_KEYS` 不见未知型（未知型会响亮红）；SA7 C4 支撑套件 75/75 实跑保持 | 无 | 无 |
| issue300 契约/机制锚 | issue300-chunked-sync-ac-red 零 observer 引用（grep 0 命中）；bulk-edge 事件断言按 type 过滤 | 新事件不出现在其断言面；SA7 C4 实跑绿 | 无 | 无 |

## 8. 错误、恢复与并发

| 风险 | 静态分析（HEAD） | 结论 |
|---|---|---|
| sent 重复发射 | `pullOne` 在 `phase === 'awaiting-ack'` 早退（L174）⇒ 末 chunk 分支每载体至多一次；中止载体（被拒 L196–204/teardown/shed/resync/超时弃置）到不了该点 ⇒ 与 aborted 互斥 | 结构性恰一 |
| acked 伪成功（zombie/单帧/kind 不匹配） | `settle` 三条件门 → undefined → 零事件（bulk-transfer L229–232）；kind=1 状态门先拒（hub L651–658）；ACK 违例 connectionFatal 在 settle 之前 return（hub L659–663，本轮直读复核） | 结构性恰一（SA7 P8 行为面确认） |
| 被拒 ACK（round 校验失败） | `round.onApplied` → `onViolation` → failed 终局（quiet）→ `!isQuietState()`/`!isInboundQuiet()` 复核不发射；载体仍 settle 释放（既有行为不变）；对齐 kind=0 `onUpdateAck` violation 先例 | 零事件（SA7 P2 行为面确认：跨 ackTimeoutMs 零复活） |
| `chunkedAckT0` 单槽新鲜度 | **单载体仲裁强于设计论证**：每控制器仅一个 `BulkTransferSender`，`enqueue` 非 idle 防御重置（L140–145 实读——旧载体 dispose 后才入新载体）⇒ 任一时刻至多 1 个出站载体；awaiting-ack ⟹ 本载体 `onLastChunkSent` 已触发（同一转移 L213–217）⇒ settle 返回记录时槽值恒属当前载体；载体弃置 → settle undefined → 槽不被消费 | 结构性安全 |
| aborted 重复/竞态 clear | busy 守卫（busy 才快照）+ reset 后续 clear 零快照；fire 后 stale 零副作用（timer 早退门） | 恰一不变量继承（SA7 P3 重复注入零追加再证） |
| kind=1 超时误发 aborted | `reason === undefined` → `snapshot === undefined` → 零构造（OD7）；终局互补信号 = `BOOTSTRAP_FAILED` ERROR + `namespace-failed` | 零事件（SA7 P1 确认） |
| applied 伪成功（导入失败/迟到/代际不符） | 发射严格在 `importResult.ok` 判定、epoch 判别（静默回收 return）之后（peer L612–643 本轮直读复核）；`applyRemoteUpdate` 失败/quiet 路径先于发射 return；peer degraded 判别外层先行胜出（R23） | 零事件 |
| observer/clock throw 外溢 | `dispatchReplicationObserver` try/catch 单点（observer.ts 实读，零改动）；`host.now` 连接层 safeNow 折叠 + observer 门控——无 observer 零时钟调用 | 隔离成立（N7 锚） |
| 部分完成伪装成功 | 出站被拒（M5）在末 chunk 前 dispose → 零 sent/acked；wire 互补信号（BOOTSTRAP_FAILED/resync 族）既有 | 无伪成功 |
| 资源泄漏 / 持久化残留 | 零新增 acquire；settlement/事件 = 进程内小对象零持久化零 wire；assembly 易失性不变（N1–N5/N9 锚；SA7 探针 `docPresent=false`/`saveCount` 不变逐例） | 无 |

## 9. 测试质量审查

| Test | Behavior asserted | Runner entry | Weakening or gap | Finding |
|---|---|---|---|---|
| R1（契约 L554–631） | 三成功型恰一 + 字段 = wire 申报（Σbytes/chunkIndex 逐帧核对）+ forbidden sequence/latency/transferId/stages + 普通族归零 + 单 BOOTSTRAP_ACK 锚末 chunk 帧序 | `vitest.config.ts` `include: packages/*/test/**/*.test.ts` 命中（HEAD 配置直读复核） | 无——前置断言先行，红灯非 fixture 空转（SA6 §13.1 实测失败消息在对应前置断言之后） | 无 |
| R2（L635–722） | 双向三成功型 + syncRoundId=wire round 交叉验证 + acked 键集冻结 + 改道增量零 + Revision R1 判别式（L713–718 `ackedSequence` 精确锚定恰一） | 同上 | 无——判别式非恒真（SA6 §17.6 + SA3 V10 mutation 双向实证）；非放宽（仍恰一） | 无 |
| R3/R4/R8（L726–808/L978–1022） | aborted{channel-teardown / connection-teardown} 恰一 + transferId/进度 = wire 实测 + 无 connectionId + 零 applied/零写入/零 dirty + R8 draining 状态 | 同上 | 无 | 无 |
| R5（L809–861） | AC2 绿半（`SYNC_TRANSFER_EXPIRED` 非终态、零 ERROR、零 failed、值不变、零 dirty）先通过后红半（hub aborted{timeout} 恰一 + 进度一致） | 同上 | 无 | 无 |
| R6（L863–940） | 4 次真实运行收集全 8 型；键集 ⊆ 冻结白名单（`EVENT_KEYS` 与 types.ts 逐键一致——本审查比对）；深扫无 Uint8Array/ArrayBuffer/DataView/Error；JSON 无 token/owner/内容哨兵 | 同上 | 无 | 无 |
| R7（L942–976） | clock 缺省 → 四键**整键缺失**（`'applyLatencyMs' in event === false`——非 undefined 值） | 同上 | 无 | 无 |
| N1–N9（L1023–1391） | 生命周期/声明/调度/改道条件/等价性负控，实现后保持绿（SA3 V3/V4；SA7 C1/C2 独立复跑） | 同上 | 无——N1 按 SA6 §12.3-1 不锁 kind=1 超时 aborted 计数（OD7 静态保证 + SA7 P1 行为面确认零） | 无 |
| 契约纪律（HEAD 实测） | 17 `it(`、零 skip/only/todo、零 `process.env`、零源码字符串/正则断言（grep 复核）；fixture 经 `try/finally ctx.stop()` 隔离清理；虚拟时间仅在两个超时用例受控推进 | 同上 | 无 | 无 |
| api.test-d 型测（L240–386，HEAD） | 36 型全联合 `toEqualTypeOf` + 8 型逐字段 + 3 处负向 keyof 锚 | 包 tsconfig include `test/**/*.ts`（`tsc -p`）+ 根 vitest `typecheck.include *.test-d.ts` 双门（HEAD 配置直读复核） | 无——types.ts 加成员而镜像不同步即 typecheck 红（防漂移自带） | 无 |
| SA7 探针（P1–P10，已删除） | 动态面：被拒 ACK/zombie/kind=1 超时/三 reason 行/hub 防御面/side 双侧 | 一次性 vitest 运行；探针文件已删且 post-removal 28/28 不变（`artifacts/sa7-issue301-post-removal-verify.log`，空白修正后正文不变） | 无——探针不入交付源码树（commit 文件列表零探针命中） | 无 |

## 10. Required revisions

无（无 BLOCKER / 无 MAJOR）。

## 11. 后续动态验证项

iteration 0 登记的 5 行动态验证项已**全部由 SA7（approve）执行并闭合**；下表为闭环状态与修正记录，无新增待办：

| Risk（iteration 0 行） | 执行者与证据 | 结果 | 修正 |
|---|---|---|---|
| 被拒 ACK 时 chunked-sync-acked 计数 | SA7 探针 P2 | 载体释放 + 零 acked + `SYNC_STATE_VIOLATION` → failed；跨 ackTimeoutMs 零复活 | — |
| kind=1 超时零 aborted 计数（OD7） | SA7 探针 P1 | `namespace-failed{bootstrap-timeout,30000}` 终局 + 零 aborted/零成功型 | — |
| shed / resync-declared / epoch-fence 三 reason 行 | SA7 探针 P3/P4/P5/P6/P7a/P7b/P7c + issue-244 套件 | resync-declared（hub k2/peer k1）恰一；epoch-fence（hub k2/peer k2）恰一；peer k1 fence 归并 connection-teardown（§23.1 last-writer-wins 裁决内）；**shed × kind=1/2 = 结构性零事件面**（非 live 门——§244 D5 既有裁决；assembly 保持 + 后续 timeout 行恰一） | **SA4 iteration 0 该行原始措辞（「shed 恰一」）过宽**——非缺陷，行为符合设计；kind=0 shed 行由 issue-244 D-SHED1/D-SHED2 持续锁绿 |
| zombie 迟到 SYNC_APPLIED/BOOTSTRAP_ACK | SA7 探针 P8 | 零 acked、零状态迁移、终局保持恰一 | — |
| hub 侧 chunked-snapshot-aborted 结构不可达 | SA7 探针 P10 | 接纳即 `NAMESPACE_STATE_VIOLATION`、零 snapshot 族事件 | — |

## 12. Non-blocking observations

| ID | Severity | Observation | 建议处理 |
|---|---|---|---|
| O-4 | MINOR | 设计 §8.1 接口表将 `onLastChunkSent` 写作「参数 `number` → `BulkTransferOutboundSettlement` **替换**」；实现为**追加第 2 参**（保 DENY 冻结锚 issue300-bulk-edge L194 的类型绑定）。偏差已三重登记（SA3 §8-1、`bulk-transfer.ts` L60–70 源内注释、SA8 实现后报告 D4/§7-3），实体义务（名字/发射点/单点事实源/同一同步栈/sent 字段）逐项保留；后续仅读设计文档者可能被接口表误导 | 已充分登记，无需改动；后续设计文档维护时以两处登记为准（SA8 §7-3 同判） |
| O-5 | MINOR | `chunked-snapshot-applied.applyLatencyMs` 的 t0 = `registry.importReplica` 调用前采样（含 Registry 排队），与 `chunked-sync-applied` 的 apply 边界 t0 物理边界不同——设计 OD5 的显式选择（对齐既有 applyRemoteUpdate t0 纪律），非实现偏差；仅提示观测口径解读时注意 | 无需改动；SA7/文档解读时以 OD5 口径为准 |
| O-6 | MINOR | `wiki/raw/task_issue-301.md` 属设计 §11 DENY（只读上游产物），但被 iteration 2 dispatch 点名做 EOF 空行删除——dispatch 授权的范围偏差（SA3 §8-4 登记）。本轮 blob 级取证确认**内容中性**：修前 blob `5c4b4663…` vs HEAD `4d969789…` 唯一差异 = 第 39 行空行，正文 L1–L38 逐字节不变；且该文件不参与任何构建/测试 | 偏差已被 dispatch 授权 + 内容零变化 + 登记闭环，无需回退；如需恢复，补回末尾单个空行即还原为原始 blob |

---

## 结论

已提交最终交付（commit `799a618`，单提交、工作树 clean）对批准设计 OD1–OD9 逐项忠实落地，且 commit-readiness 空白卫生修正经 blob 级取证证实为严格空白等价：

- **实现连续性**：5 个实现文件 HEAD md5 与 SA3 §2/SA6 §16 跨 SA 指纹记录逐字相同——被提交的实现与 SA4 iteration 0 逐 hunk 审查、SA6 Revision R1 双向复跑、SA8 实现后复查（clear）、SA7 动态验证（approve）的对象是**同一批字节**，全链审查证据无断裂；
- **设计/规范一致性**：8 型事件字段集与 ADR 0022 L78–81 / 协议 §23.1 第 29–36 型冻结行逐字一致（三源独立比对）；11 处发射点全部位于既有结算结构、恰一性由结构单点保证（单载体仲裁 + busy 守卫 + settle 三条件门）；单帧路径、kind=0 面、六类 reason 置位点、FSM/失败语义逐字节不变；
- **范围**：提交 21 文件全部属本票交付集（7 ALLOW M + SA6 契约 A + 4 SA7 日志 A + 9 wiki 固定产物 A）；DENY 面基线↔HEAD 零命中；`git show --check` / `git diff --check` 双绿；
- **测试与验收**：SA6 契约（含 Revision R1）在 HEAD 未被弱化（17 用例/零 skip/判别式在位）；api 型镜像 36 型同步且双门防漂移；SA7 动态面已闭合 iteration 0 全部待验项（含 shed 行措辞修正）。

静态可核验面未发现 BLOCKER/MAJOR 缺陷；运行时绿灯证据（17/17、516、3503、typecheck 全绿）引自 SA3/SA6/SA7 且经 md5 跨 SA 互证，静态分析与运行时证据相互印证。**approve。**

*SA4 只读审查：未修改实现、设计或测试；未运行测试、未启动服务、未创建临时进程；未 commit/push；唯一产出为本文件（原位更新至 iteration 1）。*
