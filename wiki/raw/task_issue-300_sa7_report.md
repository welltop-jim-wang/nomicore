# SA7 动态验证报告 — issue #300（#295 切片 2）：chunked BOOTSTRAP_SNAPSHOT / SYNC_STEP2 端到端

- **dispatch**: `sa-218f83b5-c20d-4209-baee-31ba013ed35e`（mabf-sa7 / final-verification / iteration 0）
- **验证对象**: SA3 实现（dispatch `sa-73a641fa-…`，报告 `wiki/raw/task_issue-300_sa3_impl.md`）在 SA4 静态审查 **approve**（无 BLOCKER/MAJOR；§11 移交 4 项动态验证项）与 SA8 implementation 复查 **clear** 之后的当前工作树未提交 diff
- **HEAD**: `605a48f`（分支 `mabf/issue-300`）+ 工作树实现 diff（13 modified + `bulk-transfer.ts`/`ws-replication-issue300-bulk-edge-ac.test.ts`/`ws-replication-issue300-chunked-sync-ac-red.test.ts` 新增；本轮 `git status` 逐条核对 = SA3/SA4 声明集合，零额外漂移）
- **Issue comments REST 快照 = `[]`**（与简报/SA6/SA8/SA2/SA3/SA4 六方一致）→ 零 owner 映射项
- **Verdict**: **approve** — 设计声明改变的路线（①②③⑥）按设计变化、声明保持的路线（④⑤ + 协商门 + v1 组合 + 观测锚）保持不变、状态机转换与关键值正确、禁止转换未出现、ACK/超时/resync 失败路径与清理符合设计；临时探针已全部删除且删除后结果不变

---

## 1. Inputs

| 输入 | 路径 | 状态 |
|---|---|---|
| 任务简报（AC1–AC5；comments 空） | `wiki/raw/task_issue-300.md` | 在库 |
| 设计 r1（SA2 approve；§8 六条数据流路线 = 本报告验证对象；§7 D0–D12） | `wiki/raw/task_issue-300_design.md` | 在库 |
| SA6 验收契约（approve；R1–R7 + N1–N4；转绿判据 §13） | `wiki/raw/task_issue-300_sa6_contract.md` | 在库 |
| SA3 实现报告（iteration 2；3 项声明偏离） | `wiki/raw/task_issue-300_sa3_impl.md` | 在库 |
| SA4 静态审查（approve；§11 后续动态验证项 1–4 = 本报告证据矩阵输入；§12 非阻塞观察 1 = round 回退分支） | `wiki/raw/task_issue-300_sa4_review.md` | 在库 |
| SA8 两份门禁（前置 clear R42–R47/N6；implementation 复查 clear R48/R49/N7） | `wiki/raw/task_issue-300_conflict_report.md`、`wiki/raw/task_issue-300_implementation_conflict_report.md` | 在库（协议边界识别） |
| 实现源码 + 既有测试（含 SA6 契约文件、bulk-edge 探针、刻画文件 `ws-replication-issue233-repro.test.ts`） | `packages/ws-replication/**`、`packages/replication-protocol/**` | 实读 + 实跑 |

## 2. Runtime environment

- worktree：`/home/wangjian/nomicore-fix-issue-300`（cwd 固定）；node `v24.13.0`、pnpm `10.28.2`、vitest `3.2.7`、yjs `13.6.30`；依赖离线安装（SA6 §4 同源），本轮零网络。
- 驱动形态：既有套件（vitest 一次性命令）+ 2 个**临时探针测试文件**（fake-duplex wire / 真实 TCP `node:net` + 4B 长度前缀成帧；`[SA7-DATAFLOW]` 观察日志）——见 §7，全部已删除。
- 虚拟时间：fake scheduler `advanceBy`（超时路径 T1/T2/T3：assemblyTimeoutMs/ackTimeoutMs 注入为 5s，advance 5.1s——超时触发是虚拟时钟推进的唯一来源，零 real sleep）；真实 TCP 探针用有界 real wait（≤15s 轮询，ephermeral port，finally 收口）。
- 零常驻进程、零端口占用残留；后台 job 全部完成收取（bash-1/2/3 均 completed）。

## 3. Changed Data Flow Verification

（设计 §8 路线表逐条；`探针` = §7 临时探针原始输出（`artifacts/sa7-issue300-probe-transport.log`），`契约` = SA6 契约文件本轮运行。）

| Route | Design change | Runtime driver | Observed hops | Expected result | Actual result | Verdict |
|---|---|---|---|---|---|---|
| ① 分块 snapshot（hub→peer） | 超 `maxBootstrapBytes` → `BulkTransferSender.enqueue(kind=1)` 惰性切片、data 路径逐帧、单 `BOOTSTRAP_ACK{ackedSequence=末 chunk 帧序}`、`finishBootstrapImport` 排他导入 | 契约 R1（fake-duplex）+ 探针 RT（真实 TCP，双 peer） | RT：hub→A 13 chunk / hub→B 13 chunk（kind=1、单 transferId、Σbytes=totalBytes=100029、每帧 ≤8KiB）；恰 1 个 `BOOTSTRAP_ACK`，`ackedSequence=15` = 末 kind=1 chunk 帧序 15（双侧同锚）；副本逐字 = 100KB 快照；R1 另断言零单帧 snapshot、零 ERROR、hub `bootstrapSnapshotSeq` 锚语义经 ACK 等值核验 | ≥2 chunk、结构一致、单 ACK 锚末 chunk、收敛 | 逐项一致（`rt-bootstrap-k1`；R1 绿） | pass |
| ② 分块恢复 diff（peer→hub） | `host.sendStep2 → {mode:'chunked'}` → kind=2 载体；`admitChunkedStep2` round 核对 → assembler → `completeChunkedStep2`（syncChunked 形态，M1）→ 一次 apply + `SYNC_APPLIED{ackedSequence=末 chunk 帧序}` | 契约 R2 + 探针 RT 阶段二 | RT：A→hub 13 个 kind=2 chunk（totalBytes=100029 > 32KiB 触发条件成立）；hub→A 恰一 `SYNC_APPLIED[round 2, acked 21]`，21 = A 上行末 kind=2 chunk 帧序；hub 收敛 BIGRT2；完成点零普通族事件（bulk-edge M1 锚） | 双向收敛 + 单 ACK 锚末 chunk | 逐项一致（`rt-recovery-k2`；R2 绿） | pass |
| ③ 分块恢复 diff（hub→peer） | 同②（hub 侧发送器 + 共享计数器） | 契约 R2b + 探针 RT 阶段二（B 的恢复） | RT：hub→B 13 个 kind=2 chunk（100029B）；B→hub 恰一 `SYNC_APPLIED[round 2, acked 33]` = hub 下行末 kind=2 chunk 帧序；B 收敛、`live` | 双向改道对称 | 逐项一致（R2b 绿 + RT 下行锚） | pass |
| ①②③ data 路径记账 / control reserve 零 chunk | chunk 经 `tryEmitData`（独立 sequence、水位闸门、RR）；control 队列结构性零 chunk | 契约 R3（hub 闸门 600KiB 注入） | 闸门关：`OPEN_OK` 已出站、peer ∈{opening,bootstrapping}（非 failed）、零 0x42、零单帧 snapshot；释放后 ≥2 kind=1 chunk 经 data 路径完成、连接 `ready` | 终局不由控制帧判定；chunk 只走 data 路径 | 一致（R3 绿；探针 T3 的 mid-flight 闸门暂停同样只停 data 面——控制帧 STEP1/RESYNC 照常通过） | pass |
| ⑥ 四码注册表首登（D12） | `errors.ts` append 四行冻结值；`encodeError`/`decodeError` 可编码 | `codec-issue242-ac-red`（注册表计数 26 + 四码元数据/往返）+ 契约 R4/R6/R7 的 wire 码断言 | R4：`SNAPSHOT_TRANSFER_TOO_LARGE`/`SNAPSHOT_TRANSFER_VIOLATION` 上 wire；R6：`SYNC_TRANSFER_VIOLATION`/`SYNC_STATE_VIOLATION`；R7：`SYNC_TRANSFER_TOO_LARGE`；协议包 206/206 绿（含 `codec-registries` 键集等价） | 四码 wire 可观察、终态 failed 可导出 | 一致（契约 12/12 + 协议包全绿） | pass |
| ② transferId 单计数器（R42/D2，细化观察） | 三 kind 共用 `(连接,方向,ns)` 计数器；首 chunk 出站时刻分配 | 探针 T6（kind=0→kind=2→kind=0 三笔连续 transfer） | idA=1（kind=0）→ idB=2（kind=2）= idA+1 → idC=3（kind=0）= idB+1；全程恰 3 个唯一 transferId（19 chunk 帧）、零重复零跳号 | 跨 kind 严格 +1 递增、无第二计数器、无双重分配 | 一致（`t6-transfer-id-counter`；契约 R2 断言 kind2>kind0 为粗粒度子集） | pass |

## 4. Preserved Data Flow Verification

| Route | Preserved invariant | Runtime driver | Baseline observation | Current observation | Verdict |
|---|---|---|---|---|---|
| ⑤ 单帧 snapshot（N1） | 未超 `maxBootstrapBytes` → 恰 1 帧 `BOOTSTRAP_SNAPSHOT`、零 0x42、单 `BOOTSTRAP_ACK` | 契约 N1（本轮运行） | SA6 HEAD 绿 | 绿（契约 12/12 内）；触发条件边界未漂移 | pass |
| ⑤ 单帧恢复 diff（N2） | 16KB diff ≤ `maxSyncDiffBytes` → 恰 1 帧 `SYNC_STEP2`、零 kind=2 chunk | 契约 N2 | SA6 HEAD 绿 | 绿；`sync-step2-sent`/`sync-diff-applied` 单帧照常（bulk-edge M1 对照锚） | pass |
| 协商门（R43/N3） | 未协商端任何 0x42（含伪造 payload）→ pre-parse `UNSUPPORTED_MESSAGE_TYPE`、close 1002、`blocked`、零 namespace 级码 | 契约 N3 | SA6 HEAD 绿 | 绿（12/12 内）；kind 泛化未弱化解码门 | pass |
| **v1 未协商组合的发送端门（D0 保持）** | 未协商 ∧ 超限 → 既有 `BOOTSTRAP_TOO_LARGE`/`SYNC_DIFF_TOO_LARGE` 终局（死码面保留） | 探针 T5（`chunkedUpdate:false` 双构型） | 刻画文件 R3（`issue137-driver` 未协商）SA6 基线绿 | T5-snapshot：hub→peer `ERROR:BOOTSTRAP_TOO_LARGE`、peer failed、零 0x42、零写入；T5-diff：peer→hub `ERROR:SYNC_DIFF_TOO_LARGE`、peer failed、hub 值 `seed`（零写入）、零 0x42；两构型均不落新码 | pass |
| ④ kind=0 分块 live update（N4/R47） | `transferKind=0`、无绑定块、单 `UPDATE_ACK` 锚末 chunk 帧序、收敛 | 契约 N4 + 全包 #243–#246 锚 + 探针 T6 phase A/C（kind=0 与 kind=2 交替） | SA6 基线 485 绿 | 全包 70 文件 499 绿（含 real-transport 1/1）；T6 中 kind=0 transfer 在 kind=2 前后行为不变 | pass |
| 刻画文件零改动且绿 | `ws-replication-issue233-repro.test.ts` 3/3（R1/R2/R3 现状刻画，未协商驱动） | 本轮独立运行 | SA6 §4：3/3 | 3/3（`artifacts/sa7-issue300-post-removal-verify.log`；文件 `git status` 零条目） | pass |
| 观测锚（M1/D8） | kind=2 完成点零普通族 `sync-diff-applied`；单帧路径照常发射；`chunked-update-aborted` 仅 kind=0 | bulk-edge M1 + issue256/observer-red/#239/#245/#231 全包锚 | SA3 报告绿 | 全包 499 绿；M1 探针：分块完成点 hub 侧零事件 + 单帧对照锚照常 | pass |
| 互通矩阵（v1 端行为） | `ws-replication-issue246-interop-matrix` | 全包运行 | SA6 基线绿 | 绿（499 内） | pass |

## 5. State Machine Verification

| Initial state | Trigger | Expected transitions | Observed transitions | Forbidden transitions absent | Verdict |
|---|---|---|---|---|---|
| `BulkTransferSender` idle | `enqueue(kind=2)` → 逐 `pullOne()` | queued→active（首 chunk，transferId 此刻分配）→active（chunkIndex 严格递增）→awaiting-ack（末 chunk：onLastChunkSent 同步栈 + 自持 timer 武装） | 探针 T7：首/中段 chunk 零 timer 武装，末 chunk 恰一次武装 `delay=ackTimeoutMs=5000`；`onLastChunkSent` 收到末 chunk 帧序（seq 3）；awaiting-ack 期间 `hasWork()=true ∧ hasQueuedWork()=false`（整笔占槽 + M3 窄判据） | 未见中段武装/提前结算/双重分配 | pass |
| awaiting-ack（kind=2） | ACK 超时（timer fire） | 载体弃置→idle + `onAckTimeout` 恰一次；timer 拆除后 stale fire 零回调 | T7①：fire 后 `hasWork()=false`、回调恰 1 次、重复 fire 零二次回调；T1（集成）：advance(5.1s) 后同 transferId chunk 数 13→13（零新增出站 = M2 出站静止性） | 无超时后复活出站、无重复终局 | pass |
| awaiting-ack（kind=2） | `settle(2)`（SYNC_APPLIED 收妥）/ `abortForResyncDeclared()`（M2 边沿） | →idle + timer 拆除 | T7②④：两路径均 `cleared=1`、归 idle、stale fire 零回调 | 无结算后残留 timer/载体 | pass |
| queued/active（kind=1） | 全部 chunk 出站 | →awaiting-ack 且**零自持 timer**（ACK 等待由宿主 bootstrap timer 覆盖，D9） | T7③：kind=1 三次 pullOne 全程 `armed=0`（回调面结构性不可达——onAckTimeout 注入即 throw 的负控在场） | 无 kind=1 自持 timer 误武装 | pass |
| peer ns `bootstrapping` | kind=1 首 chunk 接纳（绑定块核对通过）→后续 chunk 停滞 | assembly 悬置（滑动 deadline 武装）→超时：弃 partial → ns ERROR `BOOTSTRAP_FAILED` → `finalize('failed','bootstrap-timeout', assemblyTimeoutMs)`（D9 精确闭包） | 探针 T2：advance(5.1s) → peerToHub `ERROR:BOOTSTRAP_FAILED`、peer `failed`、`peerDocPresent=false`（零写入）；observer `namespace-failed{cause:'bootstrap-timeout', timeoutMs:5000}` = 实际到期的 assemblyTimeoutMs | 零 `UPDATE_TRANSFER_EXPIRED`（kind=0 误选路）、零 needs-resync 误入、零 partial apply | pass |
| hub ns live + round 活跃 | kind=2 assembly 停滞（chunk 流中断） | 弃 partial → `RESYNC_REQUIRED{SYNC_TRANSFER_EXPIRED}` → needs-resync（非终态） | 探针 T3（data 闸门 mid-flight 暂停——只停 data 面）：advance(5.1s) → hubToPeer `RESYNC_REQUIRED{reasonCode=SYNC_TRANSFER_EXPIRED}`、零 ERROR 双向、hub 值保持 `seed`（零写入）、peer `needs-resync`、连接 `ready` | 零 ERROR 终局、零 `BOOTSTRAP_FAILED` 误选路、零 failed | pass |
| peer round R（kind=2 已出站，awaiting SYNC_APPLIED） | ACK 丢失 → bulk 自持 ACK 超时 | 载体弃置 + `declareLocalResync('ack-timeout')` 入既有 §10.4 漏斗（episode 记忆化合并）→ 非终态 | 探针 T1：advance(5.1s) 后同 transferId 零新增 chunk、peer 非 failed（reconciling）、连接 `ready`、零 ERROR、hub 收敛值保持；wire 恰 1 笔 `RESYNC_REQUIRED`（episode 开启声明）、observer 恰 1 个 `resync-required` 事件——**ack-timeout 声明经同一漏斗被 episode 记忆化合并（与 kind=0 channel ack-timeout 完全同款）**，不产生重复声明帧/事件 | 无终局 failed、无重复 RESYNC、无载体复活出站 | pass |
| hub round 引擎（busy kind=2 assembly + `chunkedStep2RoundId` 已捕获） | 协议外注入：新 round STEP1（无 RESYNC 前驱）→ 补残 chunk 收齐 | `completeChunkedStep2` 走 `?? currentRound` 回退分支：一次 apply + 单 `SYNC_APPLIED`（SA4 §11-4 静态不可达分支的动态复核） | 探针 T4：注入 STEP1(R+1)→crafted 首 chunk（绑定 R+1）→STEP1(R+2)（resetState 清捕获 round）→残 chunk 收齐 → hub 恰一 `SYNC_APPLIED{roundId=R+2, ackedSequence=末 chunk 帧序 37}`（**结算 round ≠ 绑定 round——回退分支执行的直接证据**）；hub 值经幂等重放保持 BIG_DIFF（apply 的是真实发送端帧、零损坏）；零 ERROR、peer 零感知（live） | 无双重 apply、无数据损坏、无伪失败；回退归属偏差仅在该协议外注入面可达（见 §10 finding 路由） | pass（含 finding 记录） |
| 接收端单 assembly 不变量 | busy ∧ 异 transferId/kind | violation（族按 busyKind） | 契约 R6（跨帧 totalBytes 漂移→`SYNC_TRANSFER_VIOLATION`；syncRoundId 漂移→`SYNC_STATE_VIOLATION`）；R4 边界（恰在上界）接纳、assembly 悬置零写入 | 无合法流量误伤（发送端 FIFO 互斥由 facet 三段仲裁承载，R3/全包回归） | pass |

## 6. Error and Cleanup Flow

- **声明超限/几何/绑定块违例（AC4 全表）**：契约 R4（aggregate/count/geometry/边界 4 例）、R5（`REPLICATION_ID_MISMATCH`/`REPLICATION_EPOCH_MISMATCH` 既有码 + 本地 failed/protocol-violation）、R6（kind=2 跨帧/绑定）、R7（`SYNC_TRANSFER_TOO_LARGE` 且零 `SYNC_DIFF_TOO_LARGE` 回落）全绿——违例一律 ns ERROR + failed + **live Y.Doc 零写入**（`peerDocPresent=false`/hub 值不变/零 dirty 逐例断言）。
- **ACK 超时（发送端）**：T1 + T7 —— 载体确定性弃置、回调恰一次、episode 内声明合并（kind=0 同款漏斗语义）、非终态、连接 `ready`。
- **assembly 停滞（接收端）**：T2/T3 —— 按 `busyKind` 选路精确（kind=1 → BOOTSTRAP_FAILED 族终局 + cause/timeoutMs 精确闭包；kind=2 → `RESYNC{SYNC_TRANSFER_EXPIRED}` 非终态）；partial 先于 apply 弃置。
- **resync 边沿（M2）**：bulk-edge M2（收对端 RESYNC 族：边沿后同 transferId 零新增 chunk、hub 零写入、peer 非 failed、连接 ready）+ T1（bulk 自身 ACK 超时族）+ T7④（abort 面 timer 拆除）+ 既有 M5-a/b（出站被拒族：明细先采样、收口恰一次、归 idle 零自旋）。
- **cleanup 达 quiescence**：全部探针/套件为一次性进程内运行；真实 TCP 探针绑 ephemeral port 且 finally `peer.stop()/hub.close()` 收口；本轮零遗留进程/端口/后台 job。
- **错误路径零伪成功**：所有失败路径均以 wire ERROR / RESYNC / observer 终态边沿可观察，无静默吞错（T3/T4 显式断言零 ERROR 的路径均为非终态恢复路径）。

## 7. Temporary Diagnostics

| 项 | 内容 |
|---|---|
| 添加 | 2 个临时探针测试文件：`packages/ws-replication/test/sa7-300-transport-probe.test.ts`（T1 ACK 超时 / T2 kind=1 停滞 / T3 kind=2 停滞 / T4 round 回退 / T5 协商门 / T6 transferId 计数器 / T7 BulkTransferSender 单元；含 observer 事件捕获与 data 闸门/丢帧代理）、`packages/ws-replication/test/sa7-300-real-transport-probe.test.ts`（真实 TCP kind=1/kind=2 端到端）；统一 `[SA7-DATAFLOW]` 前缀、仅最小字段（route/step/关键值）、零 secret/零 live 对象 dump/零控制流改变 |
| 删除 | 收尾前全部删除（`ls packages/ws-replication/test \| grep -c sa7-300` = 0；`git status --porcelain \| grep sa7-300` 零命中） |
| post-removal 验证 | 关键场景重跑 = **22/22 绿**（契约 12 + bulk-edge 6 + 刻画 3 + real-transport 1）；全包重跑 = **70 文件 499 用例绿**；根 `pnpm typecheck` = **exit 0**；`git diff HEAD \| grep -c SA7-DATAFLOW` = **0**；工作树 tracked 变更集合与 SA3 声明逐条一致（13 M + 3 新增）——与探针在场时结果完全一致（探针在场全包 507 = 499 + 8 探针用例，零干扰） |
| 备注 | `artifacts/sa7-issue300-*.log` 为探针运行的**观察记录**（含 `[SA7-DATAFLOW]` 输出行），非交付进代码库的诊断仪表本身；探针文件本身不进入 artifactPaths |

## 8. Dynamic Evidence Matrix

| Source | Requirement or risk | Driver | Expected | Actual | Evidence | Result | Suggested routing |
|---|---|---|---|---|---|---|---|
| SA6 R1/R2/R2b/R3 | AC1/AC2/AC3 端到端改道 + data 路径记账 | 契约运行（本轮） | 12/12 绿 | 12/12 绿（3 次运行：基线、探针在场全包、post-removal） | `artifacts/sa7-issue300-post-removal-verify.log`、`-post-removal-full.log` | pass | — |
| SA6 R4–R7 | AC4 校验族/绑定块/新码映射 + 零写入 | 契约运行 | 全绿 | 全绿（含边界 ≤ 等号、零回落断言） | 同上 | pass | — |
| SA6 N1–N4 | 触发条件保持 + 协商门 + kind=0 等价 | 契约 + 全包回归 | 保持绿 | 全绿 | 同上 | pass | — |
| SA4 §11-1 | peer finalize→cleanupResources 异步间隙残帧 | **未由 SA7 动态复现**（结构性难点：需在异步间隙注入一个无 ERROR 前驱的 finalize 路径并同步触发 drain；harness 可达的确定性 finalize 路径要么先于载体入队、要么先发 wire 帧使对端 quiet 门消化） | 无数据损坏/无假性违例 | SA4 静态分析 + 缓解面（wire 序先于残渣 + quiet 门 + 与基线 kind=0 时序同构）维持原判 | — | 部分（记录，非本轮缺口） | #301 生命周期矩阵（SA4 既定路由） |
| SA4 §11-2 | M2 本端声明漏斗/ack-timeout 漏斗执行锚 | 探针 T1（集成：bulk 自持 ACK 超时→漏斗）+ T7（单元：timer 武装/超时/拆除）+ 既有 M5-b（onSendRejected→漏斗，活载体） | 边沿后载体弃置/零新增出站/非终态 | 全部一致；另观察：episode 记忆化使 ack-timeout 声明与 episode 开启声明合并（kind=0 同款漏斗语义，非新行为） | `artifacts/sa7-issue300-probe-transport.log`（t1/t7） | pass | — |
| SA4 §11-3 | 真实传输介质 kind=1/2 端到端 | 探针 RT（`node:net` 真实 TCP + 4B 长度前缀成帧，1 Hub + 2 Peer，`acceptTrusted` 真实握手） | 收敛、单 ACK 锚末 chunk、零 ERROR | 双 peer kind=1 bootstrap（13+13 chunk、单 ACK 锚 15=末帧序）；kind=2 上行 13 chunk + 下行 13 chunk（100029B）、双向单 SYNC_APPLIED 锚末 chunk 帧序、全副本收敛、双方 live | 同上（rt-bootstrap-k1/rt-recovery-k2） | pass | — |
| SA4 §11-4 + §12-1 | `completeChunkedStep2` round 回退分支 | 探针 T4（协议外注入新 round STEP1 + 补残 chunk） | 不可达或仅 apply 真实发送端帧 | 回退分支**可经协议外注入触发**：恰一 apply（幂等、零损坏）+ 单 SYNC_APPLIED 锚末 chunk 帧序，但结算 roundId=currentRound ≠ 绑定 round（归属偏差实态确认）；无 ERROR/无伪成功 | 同上（t4-round-fallback） | pass（行为受控） | #301：建议按 SA4 观察 1 改 fail-loud（violation）或断言 |
| SA4 §12-3 | startBootstrap 次序微移复合边缘 | 静态已核（本轮不复测——v1 主路径由 T5/刻画文件覆盖） | v1 主路径不受影响 | T5/刻画 3/3 绿 | §4 表 | pass | — |
| Design D0（v1 门保持） | 未协商 ∧ 超限 → 既有终局码 | 探针 T5 + 契约 N3 + 刻画文件 | 既有码原样、零 0x42 | 逐项一致 | 同上（t5-negotiation-gate） | pass | — |
| Design D2（R42 计数器） | 跨 kind 严格递增 +1 | 探针 T6 | 单计数器无跳号 | ids=[1,2,3] 跨 kind 严格 +1 | 同上（t6-transfer-id-counter） | pass | — |
| Design D9（超时选路 + 精确闭包） | kind=1/kind=2 停滞收口分流 | 探针 T2/T3 | BOOTSTRAP_FAILED 族终局 / RESYNC{SYNC_TRANSFER_EXPIRED} | 一致（含 observer cause='bootstrap-timeout'、timeoutMs=5000=assemblyTimeoutMs） | 同上 | pass | — |
| SA8 R48/R49/N7 | 文档注记/transferId 耗尽不对称/过期注释 | 非动态面（文档/防御分支） | — | 实现侧无需动作（SA8 既定） | — | n/a | owner/#301（既定路由） |

## 9. Commands and Evidence

| Command | Result | Evidence |
|---|---|---|
| `npx vitest run packages/ws-replication/test/ws-replication-issue300-chunked-sync-ac-red.test.ts ws-replication-issue300-bulk-edge-ac.test.ts ws-replication-issue233-repro.test.ts --typecheck.enabled=false`（基线） | **21 passed (21)** | 本轮首跑（§2） |
| `npx vitest run packages/ws-replication/test --typecheck.enabled=false`（全包，探针前） | **70 文件 / 499 passed** | `/tmp/sa7-ws-full.log`（exit 0） |
| `npx vitest run packages/replication-protocol/test --typecheck.enabled=false` | **12 文件 / 206 passed** | `/tmp/sa7-proto-full.log`（exit 0） |
| 探针 ×2（transport + real-transport） | **8 passed (8)**，`[SA7-DATAFLOW]` 观察 16 条 | `artifacts/sa7-issue300-probe-transport.log` |
| 全包（探针在场） | **70 文件 / 507 passed**（499 + 8，零干扰） | `artifacts/sa7-issue300-full-with-probes.log` |
| 探针删除后关键场景重跑 | **22 passed (22)**（契约 12 + bulk-edge 6 + 刻画 3 + real-transport 1） | `artifacts/sa7-issue300-post-removal-verify.log` |
| 探针删除后全包重跑 | **70 文件 / 499 passed** | `artifacts/sa7-issue300-post-removal-full.log` |
| 根 `pnpm typecheck`（14 tsconfig） | **exit 0** | `artifacts/sa7-issue300-typecheck.log` |
| `git diff HEAD \| grep -c SA7-DATAFLOW` | **0** | §7 |
| `git status --porcelain` | = SA3/SA4 声明集合（13 M + bulk-transfer.ts + 2 测试新增 + wiki 输入），零额外漂移 | §7 |

## 10. Deviations

1. **SA4 §11-1（peer finalize→cleanupResources 异步间隙残帧）未动态复现**——需要在 peer 侧异步清理间隙内注入「无 ERROR 前驱的 finalize + drain 触发」的复合构型；harness 内确定性可达的 finalize 路径均不满足该前提（或先于载体存在、或先行发出 wire 帧使对端 quiet 门静默消化残渣）。SA4 的静态分析（间隙与基线 kind=0 `channel.teardown` 时序同构 + wire 序缓解）未被推翻；按 SA4 既定路由转 #301 生命周期矩阵。非本轮 reject 依据（无反向证据，且缓解面在既有回归中持续受锚）。
2. **T1 观察澄清（非偏差）**：kind=2 发送端 ACK 超时的 `declareLocalResync('ack-timeout')` 在 wire 可达构型中恒处于「未结算 resync episode」内（大 diff 的 round 必然由本端声明开启），被漏斗 episode 记忆化合并——不产生第二笔 RESYNC 帧或 observer 事件。该合并语义与 kind=0 channel ack-timeout 走**同一漏斗同一门**（#243 时代既有行为），设计 D1/D9 的「弃载体 + 归 idle + 零新增出站」义务由 T1/T7 直接验证成立；`cause='ack-timeout'` 的 observer 可观察性仅存在于「episode 外超时」构型（周期 round 大 diff，wire 不可达——见 §8 SA4 §11-2 行注记）。
3. **T4 finding（记录，路由 #301）**：`completeChunkedStep2` 的 `chunkedStep2RoundId ?? currentRound` 回退分支经协议外注入（新 round STEP1 无 RESYNC 前驱 + busy assembly 跨 round 存活）可触发：apply 仍为真实发送端帧且恰一次（幂等、零损坏）、单 SYNC_APPLIED 锚末 chunk 帧序，但**结算 roundId 归属 currentRound 而非绑定 round**——SA4 §12 观察 1 的动态实态确认；建议 #301 改 fail-loud。协议内（合法 wire 序）不可达：round 推进恒经 RESYNC 边沿清 assembly。
4. **全仓根 `pnpm test`（3486 用例）未由 SA7 重跑**——技能边界（设计点名路线的动态验证，非一般回归）；本轮覆盖两受影响包全套件（499 + 206）+ 根 typecheck + 刻画/契约/real-transport 聚焦运行。SA3 已跑全仓绿（其报告 §Verification），与本轮互证。
5. 无其他偏差：SA6 契约文件、刻画文件、DENY 面零触碰（工作树变更集合核对）；本轮生产代码零修改（仅临时探针 + 证据日志 + 本报告）。

## 11. Verdict

**approve**。

- 设计 §8 声明改变的四条运行路线（①分块 snapshot、②③双向分块恢复 diff、⑥四码注册）全部获得运行时逐跳证据（fake-duplex 契约 + 真实 TCP 探针），与设计 D0–D12 逐项一致：三分叉触发、data 路径逐帧出站与记账、单 ACK 锚末 chunk 帧序、一次 apply/排他导入、四码 wire 可观察。
- 设计声明保持的路线（单帧 snapshot/diff、kind=0 分块、协商门 pre-parse、v1 未协商组合既有终局码、observer 锚、互通矩阵）全部保持，且刻画文件 3/3 零改动。
- 状态机：`BulkTransferSender` 四态 + abort 面逐转移验证（含 kind=1 零自持 timer 的负控）；peer/hub 命名空间在停滞/超时/边沿下的转移与关键值（busyKind 选路、cause/timeoutMs 精确闭包、episode 记忆化合并）正确；禁止转换（中段武装 timer、超时后复活出站、partial apply、结算后残留载体、误选路错误族）均未出现。
- ACK/超时/resync 失败路径：发送端 ACK 超时（载体弃置 + 出站静止 + 非终态）、接收端 assembly 停滞（kind 精确选路 + 零写入）、M2 三族边沿、M5 出站被拒全部按设计收敛到确定性处置；错误沿设计路径传播、无伪成功、cleanup 达 quiescence。
- SA4 §11 移交 4 项中 3 项（真实介质端到端、M2 漏斗族、round 回退分支）获动态证据；1 项（peer 异步间隙残帧）按既定路由转 #301 并记录理由。
- 临时诊断 2 文件已全部删除，post-removal 重跑结果不变（22/22 + 499/499 + typecheck exit 0），tracked diff 零 `[SA7-DATAFLOW]`。
