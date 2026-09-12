# SA7 动态验证报告 — issue #301（#295 切片 3）：分块 snapshot/sync 的 observer 8 型接线

- **dispatch**: `sa-b24de83e-39b7-4f0b-bba9-4f0f0e6dcc35`（mabf-sa7 / final-verification / iteration 0）
- **验证对象**: SA3 实现（iteration 1，`wiki/raw/task_issue-301_sa3_impl.md`）在 SA4 静态审查 **approve**（无 BLOCKER/MAJOR）与 SA8 实现后复查 **clear**（`requiresConflictRecheck: false`）之后的当前工作树未提交 diff
- **HEAD**: `0f3eca5`（基线 = SA6/SA3/SA4 同源）+ 工作树实现 diff = **恰好 ALLOW 七文件 modified**（`types.ts`/`bulk-transfer.ts`/`hub-namespace.ts`/`peer-namespace.ts`/`round-engine.ts`/`api.test-d.ts`/`instance-replication-v1.md`）+ 未跟踪 = SA6 契约文件 + 8 个本票 wiki 固定产物；本轮 `git status` 逐条核对与 SA4 基线事实一致，零额外漂移
- **Owner-feedback 记录**: REST comments endpoint 返回空（与简报 §Comments / SA6 §2 / SA3 头部 / SA4 头部一致）→ 零 owner 映射项
- **Verdict**: **approve** — 设计声明改变的路线（observer 8 型接线三条数据流路线）按设计变化且关键中间跳点有运行时证据；声明保持的路线（单帧普通族 / kind=0 族 / 无 observer 逐字节等价 / slice 2 wire 面）保持不变；状态机转换与关键值正确；禁止转换未出现（kind=1 超时零 aborted、hub 侧 snapshot-aborted 结构不可达、被拒 ACK / zombie 迟到 ACK / 单帧路径零 acked、aborted 与成功型互斥）；错误与清理符合设计（零 durable 残留、错误路径零伪成功、cleanup 达 quiescence）；临时探针已全部删除且删除后结果不变

---

## 1. Inputs

| 输入 | 路径 | 状态 |
|---|---|---|
| 任务简报（AC1–AC5；comments 空） | `wiki/raw/task_issue-301.md` | 实读 |
| 批准设计（OD1–OD9；§8.2 三条数据流路线 = 本报告验证对象；§12 验证映射；§13-2/§13-5/§13-9 残余） | `wiki/raw/task_issue-301_design.md` | 实读 |
| SA6 验收契约（approve；Revision R1；R1–R8 + N1–N9；§12.3 解释边界） | `wiki/raw/task_issue-301_sa6_contract.md` | 实读 |
| SA3 实现报告（iteration 1；§7 deferred → SA7 动态面清单；V1–V12） | `wiki/raw/task_issue-301_sa3_impl.md` | 实读 |
| SA4 静态审查（approve；「SA7 动态面」表 5 行 = 本报告证据矩阵输入；2 MINOR 不阻断） | `wiki/raw/task_issue-301_sa4_review.md` | 实读 |
| SA8 实现后冲突复查（clear；§7-2 = SA7 动态面既有归口） | `wiki/raw/task_issue-301_implementation_conflict_report.md` | 实读（协议边界识别） |
| SA6 契约文件 + 实现源码 + 既有测试（含 #300 契约、issue-244 SA7 动态面、observer-red） | `packages/ws-replication/{src,test}` | 实读 + 实跑 |

SA4 verdict = **approve** ⇒ SA7 在其上独立执行动态验证；本报告不重复 SA4 的静态结论，只验证运行时声明。

## 2. Runtime environment

- worktree：`/home/wangjian/nomicore-fix-issue-301`（cwd 固定）；node `v24.13.0`、vitest `3.2.7`、pnpm `10.28.2`；依赖离线（node_modules 在库），本轮零网络。
- 驱动形态：既有套件一次性 vitest 命令（fake-duplex wire / 真实 yjs/Registry/Runtime / fake scheduler 虚拟时间推进）+ **1 个临时探针测试文件**（12 场景；data 闸门/出站 hold/闩锁代理；`[SA7-DATAFLOW]` 最小字段观察日志）——见 §7，已全部删除。
- 虚拟时间仅用于超时场景（`advance(30_001)`/`advance(5_100)`/`advance(1_000)`）；零 real sleep；零常驻进程、零端口占用、无后台作业遗留（全部 job 已收取）。

## 3. Changed Data Flow Verification

（设计 §8.2 路线表逐条。`契约` = SA6 契约文件本轮独立运行；`探针 P*` = §7 临时探针实测值；关键中间跳点 = 发射点结构锚 + 事件字段与 wire 申报的投影一致性。）

| Route | Design change | Runtime driver | Observed hops | Expected result | Actual result | Verdict |
|---|---|---|---|---|---|---|
| ① chunked snapshot 成功链（hub sent → peer applied → hub acked） | 末 chunk 出站结算恰一（非逐 chunk）→ `chunked-snapshot-sent{transferId,chunkCount,totalBytes}`；peer 排他导入成功结算 → `chunked-snapshot-applied{bytes,chunkCount}`；单 BOOTSTRAP_ACK 收妥结算 → `chunked-snapshot-acked{bytes}`；普通族 sent/imported 窗口内归零 | 契约 R1（100KB snapshot + clock 注入；本轮 17/17 内） | hub `onLastChunkSent` 结算记录 → sent 恰一（transferId/chunkCount/totalBytes = wire 13 chunk 申报、无 sequence/latency 键）；peer applied 恰一（bytes=totalBytes=100407、chunkCount=13、applyLatencyMs ≥0、无 transferId/sequence/stages）；hub acked 恰一（bytes、ackLatencyMs ≥0、无 transferId/chunkCount）；wire 单 `BOOTSTRAP_ACK` 锚末 chunk 帧序；`bootstrap-snapshot-sent`/`bootstrap-imported` 归零 | 三事件各恰一、字段 = wire 申报投影、改道归零 | 逐项一致（R1 绿） | pass |
| ② chunked sync 成功链 · peer→hub 方向 | `chunked-sync-sent{+syncRoundId}` → 接收侧 `chunked-sync-applied{+syncRoundId,chunkCount}` → `chunked-sync-acked`（键集冻结无 sequence/syncRoundId/transferId/chunkCount）；单 `SYNC_APPLIED` 锚末 chunk 帧序；普通族 step2-sent/diff-applied 增量零 | 契约 R2（peer 100KB 写 → resync → 恢复 diff + clock） | peer sent 恰一（syncRoundId=2=wire round）；hub applied 恰一（bytes=100029、chunkCount=13、syncRoundId、applyLatencyMs、无 transferId/sequence/效果组）；peer acked 恰一（无 sequence/syncRoundId）；wire 锚：`ackedSequence`=21（= kind=2 末 chunk 帧序）的 `SYNC_APPLIED` 恰一笔（Revision R1 判别式） | 三事件各恰一、syncRoundId 投影、改道归零、ACK 锚定 | 逐项一致（R2 绿） | pass |
| ②′ chunked sync 成功链 · hub→peer 方向（side 双侧覆盖——设计 §13-9/§23.1 第 25 型行归口，SA6 契约未覆盖，SA7 探针补） | hub 侧发送器 sent（side:hub）→ peer 侧 applied（side:peer）→ hub 侧 acked（side:hub）；方向对称 | 探针 P9（hub 100KB 写 → 恢复 round 分块 step2 下行） | hub `chunked-sync-sent` 恰一 `{side:hub, transferId:1, chunkCount:13, totalBytes:100029, syncRoundId:2}`；peer `chunked-sync-applied` 恰一 `{side:peer, bytes:100029, chunkCount:13, syncRoundId:2}`（= hub→peer 首 chunk 绑定 round，wire 实测一致）；hub `chunked-sync-acked` 恰一 `{side:hub, bytes:100029}` 且无 syncRoundId 键；本构型 peer 方向零 sent（方向隔离）；零 snapshot 族事件 | 双向对称、字段/side 正确、acked 键集冻结 | 逐项一致（P9 绿） | pass |
| ③ 中止链 · timeout 行（kind=2） | 停滞超时（进度滑动 deadline）→ 弃 partial + `chunked-sync-aborted{timeout}` + `RESYNC_REQUIRED{SYNC_TRANSFER_EXPIRED}` 非终态 | 契约 R5（seal 丢末 chunk + advance(30_001)） | hub aborted{timeout} 恰一（transferId/receivedChunks=12/receivedBytes = 实际进度）；`SYNC_TRANSFER_EXPIRED` 出向、零 ERROR、零 namespace-failed、peer 非 failed、hub 值不变、零 dirty；零 applied | reason 恰一 + 进度一致 + 非终态收口 + 互斥 | 逐项一致（R5 绿） | pass |
| ③ 中止链 · channel/connection 行（kind=1） | close/断线/GOAWAY drain → `chunked-snapshot-aborted{channel-teardown / connection-teardown}` 恰一（GOAWAY 无独立 reason） | 契约 R3/R4/R8 | R3：CLOSE_NAMESPACE → aborted{channel-teardown} 恰一 + 无 connectionId + 零写入/零 dirty；R4：断线 1001 → aborted{connection-teardown}；R8：GOAWAY{SERVER_RESTARTING,drain=1000} → draining + aborted{connection-teardown}（归并行） | reason 行正确、恰一、进度一致、零残留 | 逐项一致（R3/R4/R8 绿） | pass |
| ③ 中止链 · resync-declared 行（SA4 动态面表行 3；契约未覆盖） | 收对端 RESYNC 声明边 → `clearInboundAssembly('resync-declared')` 按 busyKind 选路 | 探针 P3（hub kind=2 busy + crafted RESYNC_REQUIRED）/ P4（peer kind=1 partial + crafted RESYNC_REQUIRED） | P3：hub `chunked-sync-aborted{resync-declared}` 恰一 `{side:hub, transferId:1, receivedChunks:1, receivedBytes:8192}`；hub 值保持 seed、零 ERROR、零 failed；**重复注入第二次 RESYNC → 计数保持 1（busy 守卫）**。P4：peer `chunked-snapshot-aborted{resync-declared}` 恰一 `{side:peer, transferId:1, receivedChunks:12, receivedBytes:98304}`、peer 非 failed（reconciling）、零写入 | reason 恰一 + 进度一致 + 互斥 + 重复触发零追加 | 逐项一致（P3/P4 绿） | pass |
| ③ 中止链 · epoch-fence 行（SA4 动态面表行 3；N9 只锁效果面） | fence 终局（conflicted 族 carve-out）→ `chunked-{sync,snapshot}-aborted{epoch-fence}`（peer 侧 last-writer-wins 可被 connection-teardown 覆盖——§23.1 既有裁决/设计 §13-5） | 探针 P7a（hub kind=2 busy + bumpHubEpoch）/ P7b（peer kind=2 busy）/ P7c（peer kind=1 partial，N9 计数面） | P7a：hub `chunked-sync-aborted{epoch-fence}` 恰一 `{side:hub, receivedChunks:1}` + `IDENTITY_CHANGED` 恰一帧 + hub 本地写在场 + 零 failed；P7b：peer `chunked-sync-aborted{epoch-fence}` 恰一 `{side:peer, receivedChunks:1}`、终局 conflicted、对端 partial 零写入；P7c：peer kind=1 partial fence → **恰一** aborted、实测 reason=`connection-teardown`（last-writer-wins 覆盖发生）、终局 `disconnected`（∈ N9 终态集）、receivedChunks=12、零写入/零残留 | 恰一 + 进度一致 + 终态正确；reason 按 §23.1 裁决归并（两值皆合法） | 逐项一致（P7a/b/c 绿；P7c 归并行为与 SA6 §12.3-2 预告一致） | pass |
| ③ 中止链 · shed 行（SA4 动态面表行 3）——**结构性零事件面** | `discardForConnectionPressure` 的 reason 判别 `connection-shed → 'shed'` **仅 live 通道清 assembly**（§244 D5 既有裁决：「非 live 通道只置 pendingResync、不清 assembly = 正确行为」）；而入站 busy kind=1/2 ⇒ 通道结构性非 live（kind=1 ⇒ bootstrapping；kind=2 ⇒ 恢复 round，resync 边先行）⇒ **shed × kind=1/2 aborted 不可达** | 探针 P5（hub kind=2 busy + 连接级背压弃置 600KiB>cap 256KiB）/ P6（peer 侧镜像） | P5：hub 本端 20KB kind=0 写入队触发 shed 弃置 → **即时零 aborted 事件**、零 ERROR、hub 本地写完整在场（SHED_WRITE）；advance(30_001) 后 `chunked-sync-aborted{timeout}` **恰一** `{side:hub, transferId:1, receivedChunks:1, receivedBytes:8192}` + RESYNC_REQUIRED 上 wire——证明 assembly 未被 shed 清除、后续真实收口 reason 归属正确。P6 镜像一致（peer 侧 timeout 行恰一） | 零 shed 事件 + assembly 保持 + 后续收口 reason 归属正确（非 SA4 表原始措辞「shed 恰一」——见 §10 偏差 1） | 逐项一致（P5/P6 绿）；shed reason 本身经同一发射点由 issue-244 D-SHED1/D-SHED2（kind=0，本轮 75/75 内）锁绿 | pass（含 finding 记录） |
| ③ 中止链 · kind=0 先例面（同一发射点回归） | OD6 只改事件型选路，kind=0 `chunked-update-aborted` 与全部 reason 置位点零改动 | issue-244 SA7 动态面套件（D-RD1/D-RD2/D-QO1/D-QO2/D-SHED1/D-SHED2/D-FENCE/D-GOAWAY）本轮运行 | 11/11 绿（含 shed{kind=0} 恰一、resync-declared 双侧、epoch-fence 双侧、GOAWAY 归并） | kind=0 面零回归 | 一致（`artifacts/sa7-issue301-supporting-suites.log`） | pass |
| ①②③ 补充：apply 成功路径第二构型（被拒 ACK 场景的前置） | kind=2 applied 发射与 ACK 处理解耦（决策落定后发射） | 探针 P2 前置 | 真 SYNC_APPLIED 被出站 hold 代理捕获不投递的构型下，hub `chunked-sync-applied` 仍恰一（apply 成功在先）+ peer `chunked-sync-sent` 恰一 | apply 结算独立于 ACK 送达 | 一致（P2 前置实测） | pass |

## 4. Preserved Data Flow Verification

| Route | Preserved invariant | Runtime driver | Baseline observation | Current observation | Verdict |
|---|---|---|---|---|---|
| 单帧 snapshot/diff 普通族（N6 触发条件） | 未超单帧上限 → `bootstrap-snapshot-sent`/`bootstrap-imported`/`sync-step2-sent`/`sync-diff-applied` 照常 + 零 chunked 事件/零 chunk | 契约 N6（本轮 17/17 内） | SA6 基线（0f3eca5）绿 | 绿；单帧路径逐字节不变（R1/R2 断言分块窗口普通族归零 + N6 断言单帧照常——改道与单帧面分离） | pass |
| 无 observer 逐字节等价 + throw 隔离（N7/§23.4） | observer 全 throw vs 无 observer：wire 逐帧全等、值全等；无 observer 零事件 | 契约 N7（本轮 17/17 内） | SA6 基线绿 | 绿；新发射全在 `observerOn` 门内的静态结论经此负控动态保持 | pass |
| kind=0 分块 live update 面（DENY `update-channel.ts`/`update-transfer.ts`/`observer.ts` 零改动） | kind=0 四型 + aborted 行为不变 | 全包运行（71 文件/516 用例，含 issue #243–#246 全部锚） | SA6 §4：70 文件/499 绿 | 本轮 71 文件/516 全绿（`artifacts/sa7-issue301-package-tests.log`）——新增 17 用例全为 #301 契约，既有 499 零回归 | pass |
| slice 2 wire 面（#300 契约） | 分块传输端到端、bulk 边缘、ACK 锚定、超时两向收口零变化 | `ws-replication-issue300-chunked-sync-ac-red`（8 用例）+ `issue300-bulk-edge-ac` | SA6 基线绿 | 绿（supporting 套件 75/75 内） | pass |
| observer safe-field 矩阵 | `observer-red` 白名单场景零新事件（不进入 chunked snapshot/sync 窗口） | `ws-replication-observer-red.test.ts` | SA6 基线绿 | 绿（supporting 套件 75/75 内；设计 §13-6 论证动态保持） | pass |
| wire/配置/状态机零变化（OD 全系前置） | 唯一 diff = ALLOW 七文件（观测面加性）；`BulkTransferSender` 相位机/namespace/round/assembly 状态机零新转移 | `git status --porcelain` 逐项 + `npx tsc -p packages/ws-replication/tsconfig.json` | SA4 基线事实（7 文件 521+/86−） | 本轮 porcelain 与 SA4 声明逐条一致；tsc exit 0；探针删除后工作树回到 SA3 终态 | pass |

## 5. State Machine Verification

| Initial state | Trigger | Expected transitions | Observed transitions | Forbidden transitions absent | Verdict |
|---|---|---|---|---|---|
| hub `bootstrapping`（kind=1 载体已完整出站、awaiting BOOTSTRAP_ACK）| 末 chunk 出站结算 | pullOne 末 chunk 分支 → `onLastChunkSent(seq, settlement)` 同一同步栈 → sent 恰一 → awaiting-ack（kind=1 无自持 timer，bootstrap timer 覆盖） | 契约 R1/P1：sent 恰一（transferId/chunkCount/totalBytes = 结算记录单点）；P8 前置复现 | 逐 chunk 发射（计数恒 1）；中段发射 | pass |
| awaiting-ack（kind=1/kind=2） | 合法单 ACK 收妥 | settle(kind) 返回结算记录 → 状态推进（reconciling）→ acked 恰一（决策落定后） | 契约 R1/R2/P9：acked 恰一、bytes=totalBytes、无 sequence/syncRoundId | 状态推进前发射；单帧路径 acked（N6 零 chunked 事件） | pass |
| awaiting-ack（kind=2）+ round 校验失败（**SA8 D6/设计 §13-2 解释决策②——契约未覆盖，SA4 动态面表行 1**） | 被拒 ACK（round 匹配、ackedSequence 错位：22 vs 真值 21） | `round.onApplied` → `onViolation` → `SYNC_STATE_VIOLATION` + failed 终局；载体仍被 settle 释放；quiet 门 → **零 acked** | 探针 P2：peer→hub `SYNC_STATE_VIOLATION` + peer failed；`chunked-sync-acked` = 0（hub applied 恰一在先）；跨 ackTimeoutMs（advance 5_100）零复活：newEvents=0、newFrames=0、零 `resync-required{ack-timeout}`（timer 随 settle 拆除的直接证据） | 出现 acked；载体泄漏（ack-timeout 复活/重复结算） | pass |
| 载体已弃置（bootstrap 超时 failed 终局）+ zombie 迟到 BOOTSTRAP_ACK（SA4 动态面表行 4） | 原始字节、原始帧序释放被捕获的迟到 ACK | `onBootstrapAck` 状态门：terminal → 静默 return；settle 不执行 → 零 acked、零状态迁移 | 探针 P8：释放后 `chunked-snapshot-acked` = 0、hub `namespace-failed` 保持恰一（不重复终局）、hub 事件增量 = 0、零新增 ERROR | 出现 acked；failed → 其他状态迁移；二次终局 | pass |
| peer `bootstrapping` + partial kind=1 assembly（12/13） | assembly 停滞超时（advance 30_001）——**OD7 计数面（N1 不锁）** | `clearInboundAssembly(kind===1 ? undefined : 'timeout')` → **零 aborted**；`BOOTSTRAP_FAILED` ERROR + `finalize('failed','bootstrap-timeout',30000)` 终局；hub 侧 sent 已恰一、零 acked | 探针 P1：`chunked-snapshot-aborted` = 0、peer 全部 chunked-* = 0、`namespace-failed{bootstrap-timeout, timeoutMs:30000}` 恰一、peer failed、wire BOOTSTRAP_FAILED、hub sent=1/acked=0、零写入/零 dirty | kind=1 超时出现 aborted{timeout}（§23.1 第 35 型终局失败族排除）；成功型事件 | pass |
| hub/peer 恢复 round + partial kind=2 assembly | 停滞超时（advance 30_001） | 弃 partial → `RESYNC_REQUIRED{SYNC_TRANSFER_EXPIRED}` 非终态 + aborted{timeout} 恰一（busy→aborted 边沿） | 契约 R5（12/13）+ P5/P6（1/13，assembly 经 shed 弃置面后仍 busy 的变体——timeout 行同样恰一） | 终局 failed；重复 aborted；成功型并存 | pass |
| busy assembly + 重复收口触发（P3 第二次注入） | 第二次 RESYNC_REQUIRED | assembly 已 reset → busy 守卫零快照 → 零追加事件 | 探针 P3：aborted 计数保持 1 | 重复 clear 复活事件 | pass |
| live 恢复 round 双侧 busy（hub 入站 + peer 入站 kind=2） | hub epoch bump（fence 终局） | hub `oneShotTerminal`（epoch-fence 置位）→ hub aborted{epoch-fence} + `IDENTITY_CHANGED` 恰一帧 → peer `onIdentityChanged`（epoch-fence 置位）→ peer aborted{epoch-fence}；双侧 conflicted 族终局（零 failed） | 探针 P7a/P7b（分侧构型）：hub/peer 各恰一 `{epoch-fence}`、IDENTITY_CHANGED=1、双侧零 failed、互补 identity-conflicted 在场（P7a 实测） | failed 族终局；部分写入；重复 aborted | pass |
| peer `bootstrapping` + partial kind=1 + epoch bump（N9 计数面） | fence 边 + 连接收口（last-writer-wins） | 恰一 aborted；reason ∈ {epoch-fence, connection-teardown}（§23.1 既有裁决）；终态 ∈ {conflicted, disconnected} | 探针 P7c：恰一、实测 reason=`connection-teardown`（连接收口后置覆盖）、终态 `disconnected`、receivedChunks=12、零写入/零残留 | 计数 >1；终态 live/failed；残留写入 | pass |
| hub ns `live`（idle assembly） | 协议外注入 kind=1 首 chunk（**SA4 动态面表行 5，可选**） | 接纳门即拒：`NAMESPACE_STATE_VIOLATION` + failed；assembly 永不 busy ⇒ hub 侧 `chunked-snapshot-aborted` 结构性不可达 | 探针 P10：hub→peer `NAMESPACE_STATE_VIOLATION`、hub 零任何 `chunked-snapshot-*` 事件 | hub 出现 chunked-snapshot-aborted（或任何 snapshot 族） | pass |
| 多 ns 公平 + control reserve（AC4 负控） | 双 ns 分块 snapshot 同连接 + hub data 闸门起始关闭 | 全部收敛、control 帧照常、闸门期零 chunk、连接 ready | 契约 N8（本轮 17/17 内） | 饿死；闸门期 chunk 出站 | pass |

## 6. Error and Cleanup Flow

- **错误分类精确**：kind=1 超时 → `BOOTSTRAP_FAILED` 族终局（P1）；kind=2 超时 → `SYNC_TRANSFER_EXPIRED` 非终态（R5/P5/P6）；round 校验失败 → `SYNC_STATE_VIOLATION` + failed（P2）；hub kind=1 入站防御 → `NAMESPACE_STATE_VIOLATION`（P10）；fence → conflicted 族（零 failed，P7a/b/c）；resync/shed → 软收口零 ERROR（P3/P4/P5/P6）。无一处错误路径伪成功（全部以 wire ERROR/RESYNC/终态边沿可观察）。
- **零 durable 残留**：R3/R4/R5/R8/N9 契约断言 + P1/P3/P4/P5/P6/P7 探针断言 `docPresent=false` / 对端值保持 / `saveCount` 不变逐例成立——partial assembly 绝不进 live 路径。
- **资源释放达 quiescence**：P2 跨 ackTimeoutMs 推进零新增事件/帧/声明（settle 释放载体 + timer 拆除）；P8 zombie 释放零事件增量；全部场景为进程内一次性运行，`ctx.stop()` 收口，零遗留进程/端口/后台 job。
- **observer 异常面**：N7（全 throw 等价）绿；探针全程无 observer 异常逃逸（发射点 `emitObserver` 单点隔离为静态结论，负控动态保持）。

## 7. Temporary Diagnostics

| 项 | 明细 |
|---|---|
| 添加 | 临时探针 `packages/ws-replication/test/ws-replication-issue301-sa7-probe.test.ts`（12 场景 P1–P10 + `[SA7-DATAFLOW]` 最小字段日志：route/step/关键值/计数；data 闸门代理 + 出站 hold/闩锁代理 + crafted 帧注入，全部测试侧、零生产代码改动）+ 短时调试副本 `ws-replication-issue301-sa7-bisect.test.ts`（P2 排障用） |
| 删除 | 两个文件均已删除；`git status --porcelain` 恢复为 SA4 基线事实集合（ALLOW 七文件 modified + 契约/wiki 未跟踪），无探针残留 |
| 删除后复跑 | `artifacts/sa7-issue301-post-removal-verify.log`：契约 **17 passed (17)** + issue-244 SA7 动态面 **11 passed** = 28/28，与探针在场时结果一致（零漂移） |
| 残留检查 | `git diff` 内 `[SA7-DATAFLOW]` 计数 = 0；`packages/`、`docs/`、wiki 固定产物 grep 零命中（原始探针输出仅存于 `artifacts/sa7-issue301-probe-dynamic.log` 观察记录，不入 artifactPaths） |
| 生产代码 | 零改动（本轮未触碰 `src/**`；工作树 diff 与 SA3/SA4 声明逐字节同源） |

## 8. Dynamic Evidence Matrix

| Source | Requirement or risk | Driver | Expected | Actual | Evidence | Result | Suggested routing |
|---|---|---|---|---|---|---|---|
| SA6 R1–R8 | 8 型事件发射点/改道归零/互斥/safe-field/两态 latency/超时两向收口 | 契约文件本轮独立运行 ×2（含全包内一次） | 17/17 | 17/17 ×2 + 全包 516/516 | `artifacts/sa7-issue301-package-tests.log`；§3 | pass | 无 |
| SA6 N1–N9 | 生命周期/声明/调度/等价性负控保持绿 | 同上 | 9/9 | 9/9 | 同上 | pass | 无 |
| SA4 动态面行 1（SA8 D6） | 被拒 ACK 时 chunked-sync-acked 计数 | 探针 P2 | 零 acked + 载体释放 + SYNC_STATE_VIOLATION → failed | 逐项成立（含跨 ackTimeoutMs 零复活） | §5/§7 探针日志 | pass | 无（设计 §13-2 读法行为面确认） |
| SA4 动态面行 2（OD7） | kind=1 超时零 aborted 计数 | 探针 P1 | 零 aborted + 终局族 | aborted=0、namespace-failed{bootstrap-timeout,30000} | §5 | pass | 无 |
| SA4 动态面行 3 | shed/resync-declared/epoch-fence 三 reason 行路由与计数 | 探针 P3/P4/P7a/P7b/P7c + P5/P6 + issue-244 套件 | 对应 reason 恰一 + 进度一致 + 互斥 | resync-declared（hub k2 / peer k1）恰一；epoch-fence（hub k2 / peer k2）恰一；peer k1 fence 归并 connection-teardown（§23.1 裁决内）；**shed × k1/k2 = 结构性零事件面（非 live 门）**——assembly 保持 + 后续 timeout 行恰一 | §3/§5 | pass | shed × k1/k2 不可达结论建议随 #301 结案记录（SA4 表措辞修正性 finding，非缺陷）；kind=0 shed 行由 issue-244 D-SHED1/2 持续锁绿 |
| SA4 动态面行 4 | zombie 迟到 SYNC_APPLIED/BOOTSTRAP_ACK | 探针 P8（BOOTSTRAP_ACK 腿） | 零 acked、零状态迁移 | 逐项成立（事件增量 0、终局保持恰一） | §5 | pass | 无 |
| SA4 动态面行 5 | hub 侧 chunked-snapshot-aborted 结构不可达 | 探针 P10 | 接纳即 NAMESPACE_STATE_VIOLATION、零事件 | 逐项成立 | §5 | pass | 无 |
| Design §13-9/§23.1 第 25 型行 | sync 族 side 双侧覆盖（hub→peer 方向） | 探针 P9 | hub sent/peer applied/hub acked 各恰一 | 逐项成立（含 syncRoundId 投影与 acked 键集冻结） | §3 | pass | 无 |
| Design §8.2/§9.1 | 计数恰一不变量（结构性单点） | 契约 + 探针全部场景 | sent/acked/applied/aborted 恰一 | 全部恰一；重复触发/zombie/被拒/单帧四类零事件面成立 | §3/§5 | pass | 无 |

## 9. Commands and Evidence

（worktree 根执行；`NODE_OPTIONS=--conditions=nomicore-source`；产物 = `artifacts/sa7-issue301-*.log`。）

| # | Command | Result | Evidence |
|---|---|---|---|
| C1 | `npx vitest run packages/ws-replication/test/ws-replication-issue301-chunked-completeness-ac-red.test.ts --typecheck.enabled=false` | **17 passed (17)**（独立首跑） | bash-21 输出（R1–R8 + N1–N9 全绿） |
| C2 | `npx vitest run packages/ws-replication/test --typecheck.enabled=false` | **71 文件 / 516 passed (516)，0 failed**（探针在场时含探针 12 条亦全绿） | `artifacts/sa7-issue301-package-tests.log`（终态复跑） |
| C3 | 探针运行（P1–P10 共 12 用例） | **12 passed (12)**；`[SA7-DATAFLOW]` 关键值见 §3/§5 | `artifacts/sa7-issue301-probe-dynamic.log`（观察记录，非 artifactPaths） |
| C4 | `npx vitest run …/ws-replication-issue244-sa7-dynamic.test.ts …/ws-replication-issue244-ac-red.test.ts …/ws-replication-issue300-chunked-sync-ac-red.test.ts …/ws-replication-issue300-bulk-edge-ac.test.ts …/ws-replication-observer-red.test.ts --typecheck.enabled=false` | **5 文件 / 75 passed (75)**（shed{kind=0}/resync/fence/GOAWAY 行 + slice 2 契约 + safe-field 矩阵） | `artifacts/sa7-issue301-supporting-suites.log` |
| C5 | 探针删除后复跑（契约 + issue-244 SA7 动态面） | **28 passed (28)**——移除日志后结果不变 | `artifacts/sa7-issue301-post-removal-verify.log` |
| C6 | `npx tsc -p packages/ws-replication/tsconfig.json` | **exit 0**（含契约与 api.test-d 全联合镜像） | 终端输出 `TSC-EXIT-0` |
| C7 | `git status --porcelain` / `git diff` / grep `[SA7-DATAFLOW]` | 与 SA4 基线事实逐条一致；diff 内零 `[SA7-DATAFLOW]` | §7 |

## 10. Deviations

1. **（finding，非缺陷）shed × kind=1/2 aborted 为结构性零事件面**：SA4 动态面表行 3 的原始预期（「shed 行在 kind=1/2 aborted 上恰一」）经动态探查**不可满足**——`discardForConnectionPressure` 的 shed 清理仅对 live 通道执行（§244 D5 既有裁决原文：「非 live 通道只置 pendingResync、不清 assembly = 正确行为」），而入站 busy kind=1（⇒ bootstrapping）/kind=2（⇒ 恢复 round，发送方 resync 声明边先行）结构性蕴含非 live。P5/P6 实测：shed 弃置后即时零事件、零 ERROR、本地写完整在场，且停滞超时仍按真实收口面发射 aborted{timeout} 恰一（assembly 未被清除的直接行为证据）。shed reason 本身的 kind 选路接线由同一发射点（`clearInboundAssembly` 单点）的 kind=0 行（issue-244 D-SHED1/D-SHED2，本轮 75/75 内绿）覆盖。行为与批准设计一致；仅 SA4 表述过宽。
2. **（观察记录）P7c last-writer-wins 归并实测**：peer kind=1 partial + epoch bump 场景的 aborted reason 实测为 `connection-teardown`（fence 置位后被连接收口覆盖）、终态 `disconnected`——落在 §23.1 既有裁决与 SA6 §12.3-2 预告的两值闭包内（count/进度/互斥/零残留全部正确）。非偏差，按 SA6 登记的解释边界记录。
3. **（流程性）探针构造修正两轮**：P2 初版 hold 代理未做激活门（round-1 ACK 混同）与 P2/P5/P6/P9 初版依赖 `settle()`（不冲刷 defer 泵）导致断言早于异步结算——均为探针侧构造问题，修正后 12/12；对生产实现零影响（生产代码全程零改动）。

## 11. Verdict

**approve。**

- 设计声明改变的observer 数据流路线（①②②′③ 全族）按设计变化，8 型事件的发射点、字段投影（wire 申报单点事实源）、改道归零、恰一计数、side 信封、两态 latency、safe-field 全部有运行时证据（契约 17/17 本轮独立复现 + 探针 12/12）。
- 设计声明保持的路线全部保持不变（N6 单帧族、N7 无 observer 逐字节等价、kind=0 面、slice 2 wire 面、observer-red 矩阵、ALLOW/DENY 边界、typecheck）。
- 状态机转换与关键值正确；禁止转换未出现：kind=1 超时零 aborted（OD7）、hub 侧 chunked-snapshot-aborted 结构不可达、被拒 ACK / zombie 迟到 ACK / 单帧路径 / 重复触发四类零 acked/零追加面、aborted 与成功型互斥、终局族不发 aborted。
- 错误与清理符合设计：超时两向收口、零 durable 残留、错误分类精确、cleanup 达 quiescence（跨超时窗口零泄漏）。
- 临时诊断已安全清理（探针删除、post-removal 28/28 不变、git diff 零 `[SA7-DATAFLOW]`）。
- SA4 verdict = approve 未被下调；本报告新增 finding 仅 1 条（§10-1，行为符合设计的结构性零事件面），无需设计修订、无冲突复查触发（`requiresConflictRecheck` 不适用——无设计面变更建议）。
