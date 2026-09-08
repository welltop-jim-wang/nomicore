# SA3 Implementation Report — issue #254：周期 reconciliation 超时 failed/needs-resync 僵尸的协议合规自愈

## Inputs consumed

- 任务简报：`wiki/raw/task_issue-254.md`（issue #254，open；issue comments REST 读取为空——无 owner 反馈）
- 最新批准设计：`wiki/raw/task_issue-254_design.md`（SA1 iteration 0，方向 A；`requiresConflictRecheck: true` 已由 `task_issue-254_sa8_recheck.md`（verdict `clear`）背书）
- SA2 设计评审：`wiki/raw/task_issue-254_sa2_review.md`（verdict approve 有条件；F1/F2 P1 必改 + F3 P2 应改 + F4/F5 P3）
- SA6 红灯契约：`wiki/raw/task_issue-254_sa6_contract.md` + 契约测试 `packages/ws-replication/test/ws-replication-issue254-ac-red.test.ts`（红 10/10 固化，DENY LIST 冻结）
- SA8 门禁/复审：`wiki/raw/task_issue-254_sa8_gate.md`（clear，D1–D5）、`task_issue-254_sa8_recheck.md`（clear；R1/R2 advisory 即 SA2 F1/F2）
- 基线：HEAD `6a005a4`（branch `mabf/issue-254`）

## Existing worktree reconciliation

无既有 SA3 产物（无 `task_issue-254_sa3_impl.md`、无未提交实现）。SA6 契约文件与 wiki 报告为未跟踪新文件（DENY LIST 只读输入，未改动）。git status 核验：修改面与下述 Changed paths 一致。

## Changed paths

| Path | Design section | Change |
|---|---|---|
| `packages/ws-replication/src/peer-namespace.ts` | §8.1（决策 4） | `PeerNamespaceHost` 新增内部 facet `requestConnectionRecovery(namespaceId)`；`onTimerFired` 尾部 `finalize('failed')` 后按 `intent === 'active'` 门分派恢复请求；删除 `finalize` 内空 `if (state === 'failed') {}` 死块 |
| `packages/ws-replication/src/peer-connection.ts` | §8.1/§8.2（决策 3） | `PeerBackoffReason` 追加 `'namespace-recovery'`（append-only 8 值）；constructor host 装配 facet；`detachCloseTimedOutTransport` reason 闭合追加（第三调用点）；新私有方法 `onNamespaceRecoveryRequested`（stopping/ready/transport 三门 + detach-close 1001 + `onTemporaryFailure('namespace-recovery', true)`） |
| `packages/ws-replication/src/types.ts` | §8.1（决策 5） | `connection-backoff-scheduled.reason` 闭联合追加 `'namespace-recovery'`（append-only，7→8） |
| `packages/ws-replication/test/ws-replication-ac4-reconcile.test.ts` | §11 ALLOW 行 4 / §2.2 | §9.3「缺少对端 SYNC_APPLIED」场景改版：事件轨迹断言 `reconciling→failed` 与 `failed→disconnected`（瞬态 failed 不可轮询），重建后回 live；保留同 wire 单 round 纪律（wire1 恰一轮 SYNC_STEP1）；新 wire re-OPEN/SYNC_STEP1 断言；hub 侧回 live；零 unhandled rejection 哨兵 |
| `packages/ws-replication/test/ws-replication-ac3-bootstrap.test.ts` | §11 ALLOW 行 5 / §2.2 | §18 bootstrap timeout 场景改版：瞬态 `bootstrapping→failed` 事件轨迹；wire1 零快照投递/零 ACK（同 wire 不重发）；新 wire 恰一次快照重发 + 恰一次 BOOTSTRAP_ACK；droppedFrames 断言保留；收敛 live + 身份/数据核对 |
| `packages/ws-replication/test/ws-replication-sa4-f1-f2-f3-red.test.ts` | §11 ALLOW 行 6 / §2.2 | F2 改版：open 超时收口 `failed` 瞬态（事件轨迹）；悬挂窗口内有界重试环（dialCount 增长受 backoff 界约束、attempts 单调递增、退避延迟按 full-jitter 公式 [25,50,100,200]）；release 后恢复 live；零 unhandled rejection |
| `packages/ws-replication/test/ws-replication-issue254-timeout-recovery.test.ts`（新文件） | §11 ALLOW 行 7 / §12；SA2 F3 | 场景 1 open 超时自愈环；场景 2 bootstrap 双停（每 wire 各恰一次快照尝试）→ 第三 wire 收敛；场景 3 multiplex（兄弟 ns churn 可恢复、零数据丢失）；场景 4 reconcile 丢帧持续故障环（15s 窗 dialCount 有界、attempts 单调至 cap、每 wire 恰一次丢弃）；场景 5 界外负控（NOT_FOUND 错误帧 failed → 60s 零重建零重拨、零 `namespace-recovery` 事件） |
| `packages/ws-replication/test/ws-replication-api.test-d.ts` | §8.1（types.ts 变更的闭集合 fixture） | 事件 union 精确匹配 fixture 的 `connection-backoff-scheduled.reason` 追加 `'namespace-recovery'`（issue #238 同款 append-only fixture 同步先例；不加将致 package typecheck 红） |
| `packages/ws-replication/test/ws-replication-issue170-r1-r4-red.test.ts` | §13 风险 1（未知命中收敛） | H1/P1–P3/P4/P4a 在 `握手 ready` 后追加 ns-live 同步点：liveness 时间线前置确定性（见 Deviations） |
| `docs/protocols/instance-replication-v1.md` | §8.4-1/2/3/5 | §16 `failed` 词条扩写（谓词收窄至 timer 族，SA2 F2 口径，含 wire ERROR 族 follow-up 边界声明）；§18 超时句伴随句；§15.1 ready 出边注记（`namespace-recovery` 为 temporary-close 本端触发实例，不新增边）；§23.1 reason 枚举追加 `'namespace-recovery'`（标 issue #254，词表 7→8，SA2 F1 口径） |
| `docs/adr/0010-hub-peer-websocket-ydoc-replication.md` | §8.4-4 | 追加「issue #254 修订（recoverable namespace timeout 的连接重建触发——2026-09-08）」节：触发谓词与范围（timer 族 + L165 域界双向声明）、编排与不变量（AC3）、close code/所有权、§23.1 观测登记同款引语、双环形风暴界运营注记（SA2 F4 口径）、协议文本修订清单 |

## SA2 Finding 落实

| Finding ID | Implementation | Result |
|---|---|---|
| F1（P1，SA8 复审 R1）：§23.1 reason 枚举修订未登记 | protocol §23.1 `connection-backoff-scheduled.reason` 行追加 `'namespace-recovery'`（标注 issue #254、append-only、词表 7→8）；ADR 0010 修订节第 4 条含同款引语（对齐 issue #238 先例） | 落实（纯登记性增改；四处一致性：types.ts / peer-connection.ts 闭集合、protocol §23.1、ADR 修订节齐备，见 Verification 文档核对项） |
| F2（P1，SA8 复审 R2）：§16 登记谓词与实现边界宽窄不一 | §16 词条按 SA8 复审推荐口径 (a) 收窄：「failed 源于 open/bootstrap/reconcile timer 超时（§13.2 `NAMESPACE_TIMEOUT`，本地映射）……由 Peer 控制器触发整连接重建」，并登记 wire ERROR 驱动 reconnect 族为显式未实现 follow-up（§13-1 引用）——与 §18 伴随句、§15.1 注记、ADR 修订节第 1 条逐字同域（timer 族） | 落实（实现行为 = timer 族单点分派；负控场景 5 实证界外零重建） |
| F3（P2）：触发面边界缺显式负控测试 | 新文件场景 5：`hubNamespace:false`（OPEN → NOT_FOUND ERROR 帧）→ `failed` + `ready` → 推进 60s 恢复窗口 → wires==1/dials==1/ns 保持 failed/零 `namespace-recovery` 事件 | 落实（核心形态；config 族变体 UPDATE_TOO_LARGE 为 F3 原文「可加」的可选项，未实施——理由见 Deviations） |
| F4（P3）：风暴界双环形表述 | ADR 修订节第 5 条区分 open-timeout 环（attempts 单调增长至 cap，周期 ≈ 5s+握手+退避）与 reconcile-timeout 环（attempts 每环清零，周期 ≈ 10.1s），统一上界「重拨率 ≤ 1/min(超时窗, backoff 界)」+ 告警阈值分设提示 | 落实（文档侧；两环形均有测试实证：场景 1/4 attempts 单调、新场景分别覆盖） |
| F5（P3）：事实勘误（26→25 调用点、types 锚 L287-299） | 设计文件文字勘误属 SA1 职权（SA3 不修改设计文件）；实现侧无对应代码面（本实现仅新增 1 个分派调用点，未触碰 finalize 其他调用点） | 记录不处理（属设计文本修订；SA2 已声明不影响决策） |

## File scope check

| Changed path | ALLOW entry | Purpose |
|---|---|---|
| `packages/ws-replication/src/peer-namespace.ts` | ALLOW 行 1 | 触发落点（决策 4）+ 死块清理 |
| `packages/ws-replication/src/peer-connection.ts` | ALLOW 行 2 | 触发面单点 + reason 闭合并追加（决策 3） |
| `packages/ws-replication/src/types.ts` | ALLOW 行 3 | 观测闭联合镜像追加 |
| `packages/ws-replication/test/ws-replication-ac4-reconcile.test.ts` | ALLOW 行 4 | §9.3 场景按新契约改版 |
| `packages/ws-replication/test/ws-replication-ac3-bootstrap.test.ts` | ALLOW 行 5 | §18 bootstrap 场景改版 |
| `packages/ws-replication/test/ws-replication-sa4-f1-f2-f3-red.test.ts` | ALLOW 行 6 | F2 场景改版 |
| `packages/ws-replication/test/ws-replication-issue254-timeout-recovery.test.ts` | ALLOW 行 7（新文件） | D2 一般化 + multiplex + churn 界 + 负控（SA2 F3）验收 |
| `packages/ws-replication/test/ws-replication-api.test-d.ts` | 不在 ALLOW——按 append-only 纪律必需的闭集合 fixture 同步（issue #238 先例；不加 → package typecheck 红，违反设计 §12 硬门） | 事件 union 精确匹配 fixture 追加 reason 值（纯类型面，无行为断言变更） |
| `packages/ws-replication/test/ws-replication-issue170-r1-r4-red.test.ts` | 不在 ALLOW——设计 §13 风险 1 预登记的「存量测试未知命中」收敛（全量 suite 为硬验收门） | H1/P1–P3/P4/P4a 加 ns-live 同步点（确定性收敛；零断言/语义变更，见 Deviations） |
| `docs/protocols/instance-replication-v1.md` | ALLOW 行 8（含 SA2 F1 的 §23.1 增补） | §16/§18/§15.1/§23.1 登记性文本 |
| `docs/adr/0010-hub-peer-websocket-ydoc-replication.md` | ALLOW 行 9 | issue #254 修订节 |

未触碰：`ws-replication-issue254-ac-red.test.ts`（DENY）、hub-connection/hub-namespace（DENY）、`replication-protocol/**`（DENY）、registry/runtime/persistence 各包（DENY）、`frame-io/backpressure/round-engine/update-channel/liveness/fence-watchdog/validate/defaults`（DENY）、`ws-replication-periodic-reconcile.test.ts`（DENY）、CONTEXT.md（DENY）、`wiki/raw/task_issue-254*.md`（只读）。

## Verification

| Command | Result | Evidence |
|---|---|---|
| SA6 红灯契约：`pnpm exec vitest run packages/ws-replication/test/ws-replication-issue254-ac-red.test.ts` | **5/5 通过**（A1/A2 转绿，N1–N3 保持绿） | `Tests 5 passed (5)`，Type Errors: no errors；3 连跑 10/10 通过（与新建文件同跑） |
| 三个改版存量文件（ac4/ac3/sa4-f1-f2-f3） | ac4 5/5、ac3 4/4、sa4-f1-f2-f3 3/3 通过 | 单独运行均绿 |
| 新文件：`ws-replication-issue254-timeout-recovery.test.ts` | **5/5 通过** | 场景 1–5 全绿；3 连跑稳定 |
| 全量 ws-replication suite：`pnpm exec vitest run packages/ws-replication/test` | **54 files / 373 tests 全通过** | 基线 368（366 绿 + A1/A2 红，SA6 §14）→ 373 绿（+ 新文件 5 场景）；含 real-transport 项本轮零抖动 |
| package typecheck：`pnpm exec tsc -p packages/ws-replication/tsconfig.json` | 通过（exit 0） | 含 api.test-d.ts 精确联合 fixture |
| 根 typecheck：`pnpm typecheck` | 通过（exit 0） | 13 个 package tsconfig 全绿 |
| 根测试：`pnpm test`（--typecheck 全仓） | **第二轮全量 231 files / 2373 tests 全通过** | 首轮 2372/2373，唯一失败 = `apps/yjs-server/test/stdin-error-chain-red.test.ts` F1（真实子进程 60s ready 超时——全量并行负载抖动；单独复跑 4/4 通过；第二轮全量复跑全绿，确认与本变更零交集，属 SA6 §14 记录的 real-process 抖动同类口径） |
| `git diff --check` | 通过（零 whitespace 错误） | exit 0 |
| 文档一致性核对（SA2 F1/F2 验收构想）：types.ts / peer-connection.ts 闭集合、protocol §23.1 枚举、protocol §16/§18/§15.1、ADR 修订节四处 `'namespace-recovery'` 齐备；§16 谓词与 ADR 谓词同域（timer 族） | 通过 | grep + 目检 |

> 注：第二轮全量 `pnpm test` 结果以本报告最终提交时状态为准（见 Deferred verification）。

> 注：全量根测试 `pnpm test` 两轮结果已并入上表（第二轮全绿；首轮唯一失败项为
> yjs-server 子进程负载抖动测试，单独与全量复跑均通过）。

## Deferred verification

- SA6 §14 口径的 real-transport/real-process 抖动项如需可单独复跑（本轮 ws-replication
  suite 与根 suite 复跑均零抖动）。
- CI/提交/发布级验证不在 SA3 职责内（Controller/后续环节）。

## Deviations or blockers

1. **超出 ALLOW 的两个测试文件（api.test-d.ts、issue170-r1-r4-red.test.ts）**：
   - `api.test-d.ts`：types.ts reason 闭集合 7→8 使「事件 union 21 型字面量精确匹配」fixture 报类型错（toEqualTypeOf 闭集）。设计 §8.1 的 append-only 增补必然要求该精确 fixture 同步（issue #238 先例同款）；不改则 package typecheck 红、设计 §12 硬门不达。改动为单值追加，零断言语义变更。
   - `issue170-r1-r4-red.test.ts`：实现后 5 个 liveness 场景（H1/P1–P3/P4/P4a）全量 suite 红。根因 = 设计 §13 风险 1 预登记的未知命中：这些场景在 `ready` 后**单次大步推进**（30s+虚拟时间），open 链尚未收口即越过 openTimeoutMs(5s)——基线语义下 open 超时仅静默收口 ns（连接保持），issue #254 修复后 open 超时按设计触发重建 → 时间线前提（wire1 存活至 t=30s）被破坏。收敛方式按设计 §13「同口径」（未涉及断言语义）：在 liveness 时间线启动前追加 ns-live 同步点（settleUntil，与 driver boot 缺省 waitFor='live' 同构），零断言改动、零 issue #170 契约语义变更。此收敛把「open 链在途 + 大步推进」的人工饥饿形态转为确定性形态。
2. **场景 3（multiplex）注入形态**：设计 §12 场景 3 原文为「ns-A reconcile 超时 → 整连接重建」。fake-wire 信封洞约束（SA6 §15-1：丢帧洞后同连接任何新帧 → SEQUENCE_VIOLATION）使「兄弟 ns 在同一 wire 持续健康收发的同时丢 ns-A 的 SYNC_APPLIED」在 harness 上不可注入（兄弟 ns 的帧必撞洞）。故场景 3 以**同触发族（timer 族）的 open 超时实例**（authorize 悬挂，零丢帧零信封洞）驱动整连接重建环，验收断言面与设计原文一致（兄弟 ns 每轮 churn 后可恢复、双 ns 回 live、双向数据收敛零丢失）。设计 §13 风险 1 同款收敛口径。
3. **SA2 F3 的 config 族变体（UPDATE_TOO_LARGE）**：F3 原文标为「可加」的可选项；核心 NOT_FOUND 负控已落地。UPDATE_TOO_LARGE 需双侧不同 limits（driver boot 单 limits 注入双侧），构造成本高且不属核心断言面，记录为未选可选项。
4. 无设计不可行、无契约矛盾、无环境阻塞。红线契约零 skip/only/改断言。

## Suggested commit message

```
fix(ws-replication): 周期 reconciliation 超时后自动触发连接重建自愈（issue #254）

方向 A：open/bootstrap/reconcile timer 超时收口 failed 后，target 仍活跃且连接仍
存活时由 Peer 控制器经新内部 facet requestConnectionRecovery 触发恢复性整连接重建
（§18 detach-close：epoch 先失效 → close(1001,'namespace-recovery') → §15.1 backoff
重拨 → 新代 re-OPEN/reconcile）。零 wire 字节、零错误码、零状态机新边；终态
namespace 复活仍只经 disconnected → 新代 ready（§1 不变量 4 / AC3 保持）。

- PeerNamespaceHost.requestConnectionRecovery（内部缝）+ onTimerFired 尾部 intent
  门分派；删除 finalize 内空死块
- PeerBackoffReason / connection-backoff-scheduled.reason 追加 'namespace-recovery'
  （append-only；protocol §23.1 + ADR 0010 修订节登记，标 issue #254）
- SA6 契约 A1/A2 转绿（重建 + re-OPEN + 收敛 live），N1–N3 保持绿；新增
  ws-replication-issue254-timeout-recovery.test.ts（open/bootstrap 自愈、multiplex
  churn、reconcile 环有界性、错误帧族界外负控）；ac3/ac4/sa4-F2 三个存量僵尸钉住
  场景按新契约改版；issue170 liveness 场景加 ns-live 同步点（时间线确定性）
- protocol §16/§18/§15.1 登记性文本 + ADR 0010 issue #254 修订节
```
