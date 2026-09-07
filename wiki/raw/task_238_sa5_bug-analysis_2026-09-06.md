# Issue #238 分阶段 Bug 分析（dated 2026-09-06）

## 任务标识

- 任务：Issue #238 — BUG investigation: Hub→Peer UPDATE apply 延迟呈阶梯累积，最高 11 秒（bug / in-progress，OPEN）
- 分析日期：2026-09-06（UTC；本地 CST 2026-09-07）。执行者：SA5（design 阶段，MABF round 1，controllerRunId `controller-welltop-jim-wang-nomicore-238-1788714687956-host-recovery-1788714687956`）
- Worktree：`/home/wangjian/nomicore-fix-issue-238`（branch `mabf/issue-238`，基准 HEAD `9e3f0bf`；本分析新增/修改文件见 §10，未提交、未推送）
- 输入：任务简报（本 prompt）+ Issue #238 正文 + Owner 评论 `IC_kwDOT8JVvs8AAAABS2CyWg`（welltop-jim-wang，2026-09-06T13:39:25Z，当前唯一评论）+ ADR 前置产出 `wiki/raw/task_238_relevant_decisions.md`、`wiki/raw/task_238_conflict_report.md`（verdict: clear，G1–G4 条件性演进门登记在案）
- 本文档职责：分析 + 复现 + 观测面验证（Owner 要求的工作方向）；**不含**生产代码修复与 protocol §23 字段落地的实现（issue AC 的修复腿，属后续任务）

## 1. 执行摘要

1. **机制已在本 worktree 确定性复现并逐要素保留 Owner 基线**：Peer 同 namespace write sequencer 的首个 slot 被挂起的 dirty notification（`saveGate`）占据时，Hub 连续五笔小 UPDATE 排队，连接恒 `live`、零重连、零 namespace error、五笔全部 apply + ACK，`applyLatencyMs = [5000,4000,3000,2000,1000]`——与 Owner 评论登记值逐位一致。反馈循环红线能力已证（故意改期望为全 5000 → 稳定红并报实际阶梯），20/20 稳定，测试主体 35 ms。
2. **分段分解成立且守恒**：用既有 seam（`applyLatencyMs` 差值 + persistence `saveDoc` 入/出时钟戳 + sequencer FIFO 推理）把每笔延迟分解为 queue wait / protected check + live apply / dirty notification 三段，三段之和恰等于 `applyLatencyMs`。归因：u1 的 5000 ms 全部是 dirty notification（被挂起）；u2–u5 的延迟全部是排在被占槽后的 queue wait；protected check + live apply 段为 0（小 update）。
3. **sent/applied/acked 关联可按 wire sequence 可靠建立**（`UPDATE` envelope `header.sequence` ↔ `UPDATE_ACK.ackedSequence`），本复现中逐一配对成功；同时证实事件面现状缺口——observer 事件不携带 sequence，而发送侧存在贪心合并（多笔业务 update 可并成一帧），**按时间/字节长度猜关联结构性不可靠**，sequence 是唯一稳定键。
4. **生产归因边界（Owner 明文）**：复现证明排队机制，**不证明**生产 11 秒长占槽的具体阶段。生产证据再推导显示：五笔 UPDATE 的接纳聚在 ~2.8 s 窗口内、槽排空速率 ~2–3 s/笔、而该 namespace 平时中位 apply 536 ms——即事故窗内单槽成本膨胀为中位的 4–6 倍。本机实测在树内管线（含 R4 scratch clone）对小 update 的全程成本为 ~1.2 ms@8KB → ~6 ms@1MB（≈6 ms/MB 量级），**单纯文档体量驱动的 R4 成本无法解释秒级槽**，除非文档达数百 MB 量级。据此假设排序：H1（Peer event loop 阻塞）与 H4（同 sequencer 的业务 mutation S-slot 长占槽，#237 完整 ROOT 校验成本）升为首位，H2（生产 dirty 路径违背「登记即返回」）次之，H3（R4 O(doc)）降级为辅助放大器。
5. **观测面生产化设计**（§8）：以 §23 append-only 方式新增分段差值字段与 sequence 关联字段，槽内捕获、槽外发射，零 wire 字节变更，无 observer 时逐字节等价——是闭合生产归因缺口的最小充分手段。

## 2. 反馈循环（Phase 1：红线能力证明）

命令（单轮，本 worktree 实测）：

```bash
pnpm exec vitest run \
  packages/ws-replication/test/ws-replication-issue238-repro.test.ts \
  --reporter=verbose
# → Test Files 1 passed (1), Tests 1 passed (1), Type Errors no errors；测试主体 35 ms
```

红线能力（将 `applyLatencyMs` 期望故意改为 `[5000,5000,5000,5000,5000]` 后实跑）：

```text
AssertionError: expected [ 5000, 4000, 3000, 2000, 1000 ] to deeply equal [ 5000, 5000, 5000, 5000, 5000 ]
- 5000, 5000, 5000, 5000, 5000  （期望）
+ 5000, 4000, 3000, 2000, 1000   （实际）
Tests  1 failed (1)
```

（还原后期望回归绿：`Tests 1 passed (1)`，`Type Errors no errors`。）

稳定性循环（Owner 基线同款）：

```bash
for i in $(seq 1 20); do
  pnpm exec vitest run packages/ws-replication/test/ws-replication-issue238-repro.test.ts \
    --reporter=dot || exit 1
done
# → 20/20 passed（本 worktree 实测；单轮整体 ~0.9 s，测试主体 35 ms，零 real sleep）
```

判据核对（diagnosing-bugs skill Phase 1）：红线可触 ✓（上）、确定性 ✓（20/20）、秒级 ✓（0.9 s 轮 / 35 ms 主体）、可无人值守 ✓（单命令）。

最小性说明（每要素承重）：`saveGate` 门闩移除 → 无长占槽 → 无阶梯（绿）；手动时钟移除 → `applyLatencyMs` 缺面（dormant）→ 断言面消失；五笔连续写是生产形态（连续小 UPDATE 排队）的最小重现；单 namespace 即可复现（同 sequencer 排队是 per-namespace 事实）。构型沿用 Owner 基线未做削减，以保留与登记值的逐位可比性。

## 3. 复现构型与症状（Phase 2）

构型（`ws-replication-issue238-repro.test.ts` 头注同款）：

- 真实 `NamespaceRuntime` + `ReplicationSession`（`createNamespaceRegistryForTesting`，受控 clock/scheduler/randomBytes；不 mock 被测对象）；
- 内存 fake-duplex Hub/Peer（一 WS message = 一 frame，微任务投递，零 real sleep）；
- Peer persistence `saveGate` 单次门闩挂起首笔 dirty notification；
- **共享手动单调时钟**注入双侧 `clock` seam（`issue137-driver.ts` 新增可选 `hubClock`/`peerClock`，缺省不注入——生产缺省行为逐字节不变）；每笔发送后推进 1000 ms；
- Hub 连续五笔小 UPDATE（`{ n }` 单字段业务写 → 37 B 级增量）。

观测到的症状（与 Owner 评论逐条对应）：

| 事实 | 值 |
|---|---|
| Peer `update-applied.applyLatencyMs` | `[5000, 4000, 3000, 2000, 1000]` |
| Hub `update-acked.ackLatencyMs` | `[5000, 4000, 3000, 2000, 1000]`（对称） |
| apply/ACK 数 | 5 笔 UPDATE 帧、5 笔 `update-applied`、5 笔 `UPDATE_ACK`、5 笔 `update-acked` |
| 连接 | `wires.length === 1`（dial 仅一次），state 恒 `ready`，零 `connection-state-changed` 迁移 |
| namespace | 恒 `live`；零 `namespace-error`；零 `resync-required`（双侧） |
| 数据 | Peer 最终 `ROOT.n === 24`（收敛）；零 unhandled rejection |
| 门闩释放前 | 零 `update-applied`；仅 u1 的 saveDoc 已入槽（entered@0，仍挂起） |

时间线（共享单调时钟，ms）：发送/接纳 `u_i @ (i−1)·1000`；门闩释放后五笔 apply 全部完成于 `5000`。

## 4. 机制：延迟在各阶段的构成（代码级归因）

Hub→Peer 一笔 UPDATE 的完整路径与观测口径：

```text
hub 业务写(S-slot) → fanout → update-channel(记账 sentAt per sequence) → wire UPDATE(envelope header.sequence)
  → peer dispatch（peer-connection.ts:353/395，同步段）
  → onHubUpdate（peer-namespace.ts:536-554）
  → applyRemoteUpdate：t0 采样（peer-namespace.ts:1042，调用 session.applyRemoteUpdate 前）
  → session 接纳层 A1–A4（replication-session.ts:436-503：终态/形状/lifecycle 门 + 入队唯一 write sequencer）
  → R-slot（replication-session.ts:558-679）：
      R1 fatal gate → R2 身份/epoch gate → R3 writable gate
      → R4 受保护字段检查（:620 → :698-714 scratch clone = new Y.Doc + 全量装载 + 投影比对，O(doc)）
      → R5 Y.applyUpdate（:640，live apply）
      → R6 await notifyDirty()（:665；= persistence.saveDoc(handle)，registry.ts:1204 绑定）
      → R7 槽释放（promise settle → sequencer 放行下一项）
  → t1 采样 + update-applied{applyLatencyMs=t1−t0}（peer-namespace.ts:1065-1079）
  → UPDATE_ACK{ackedSequence}（:1086-1090）→ hub onAck → update-acked{ackLatencyMs}（记账 sentAt 差值，update-channel.ts:234-241）
```

三个关键事实：

1. **`applyLatencyMs` 按契约覆盖 queue wait**：t0 在接纳前采样、t1 在结算后采样（protocol §23.4「含 write sequencer 排队等待」；实现注释 peer-namespace.ts:1040-1042 同款）。阶梯不是测量伪影，是被测真实。
2. **阶梯是冻结槽序的字面行为**：ADR-0008 L51「……一次 Yjs transaction、`await notifyDirty()`，然后才释放给下一任务」与 CONTEXT「写序列器」词条（「前项完成 dirty notification 后下一项才执行」）——一个慢（被挂起/迟缓的）槽内阶段必然把后续 remote apply 排成 FIFO 队列，后续每笔的 `applyLatencyMs` = 剩余占槽时间 + 自身槽成本，随接纳次序递减——恰为阶梯形。**排队本身不是缺陷**；缺陷候选是「生产中是什么把槽占到 2–11 秒」。
3. **ACK 侧对称**：hub `ackLatencyMs = ACK 收妥 − 帧出队`（update-channel.ts §6.5 U2 记账），包含 Peer 全部 apply 排队 + ACK 回程，故与 apply 阶梯同形（生产数据亦然：apply max 11,142 ms vs ack max 11,298 ms，差值 ~156 ms 为 ACK 派发/回程）。

## 5. 分段观测验证（本 worktree 实测的分解与守恒）

方法（零生产代码改动，仅既有 seam）：

- **admission_i**（接纳时钟）= `update-applied` 事件戳 − `applyLatencyMs`（既有差值字段反推，精确）；
- **dirty 段** = persistence `saveDoc` 入/出时钟戳（测试侧包覆 `peerNode.persistence.saveDoc`，入槽即记录、完成回填；行为零改变——门闩仍由原实现消费）；
- **slotStart_1** = admission_1（空序器即时入槽）；**slotStart_k** = saveOut_{k−1}（严格 FIFO：前槽 dirty 结束即后槽开始，手动时钟同读数）；
- **queueWait_k** = slotStart_k − admission_k；**checkAndApply_k**（R1–R5）= saveIn_k − slotStart_k；**dirty_k** = saveOut_k − saveIn_k。

实测分解表（ms）：

| update | admission | queueWait | check+apply（R1–R5） | dirty（R6） | 合计 = applyLatencyMs |
|---|---:|---:|---:|---:|---:|
| u1 | 0 | 0 | 0 | **5000** | 5000 |
| u2 | 1000 | **4000** | 0 | 0 | 4000 |
| u3 | 2000 | **3000** | 0 | 0 | 3000 |
| u4 | 3000 | **2000** | 0 | 0 | 2000 |
| u5 | 4000 | **1000** | 0 | 0 | 1000 |

守恒断言（测试内逐笔）：`queueWait + checkAndApply + dirty === applyLatencyMs` ✓。结论：**阶梯 = queue wait；被占槽 = dirty notification**。这正是 Owner 要求观测面能区分的四段中的三段（第四段 event-loop stall 见 §7-H1 与 §8）。

## 6. sent/applied/acked 跨阶段关联验证

- **wire 侧（可靠键已在协议内）**：每方向 envelope `sequence`（uint32，严格递增，protocol §3）+ `UPDATE_ACK.ackedSequence`（§10.2）。本复现实测：5 个发送 sequence 严格递增不重号，`ackedSequences` 与 `sentSequences` 逐位相等——**每笔 ACK 恰指其 UPDATE**；再叠加双侧共享单调时钟戳可拼出每笔完整时间线（sent@i·1000 → admitted@i·1000 → applied@5000 → acked@5000）。零新增 wire 字段。
- **事件面（现状缺口）**：`update-sent`/`update-applied`/`update-acked` 事件仅携带 `namespaceId`/`bytes`/latency（types.ts:352-374），**不携带 sequence**；且发送侧存在贪心合并（`update-channel.ts` §5：窗口不足时多笔 update `Y.mergeUpdates` 成一帧，一帧一 sequence）——**按字节长度/顺序猜关联在合并发生时结构性失效**（一个 ACK 的 sequence 覆盖多笔业务 update）。hub 侧 `inFlight` 记账已按 sequence 键存 `sentAt`，是天然锚点。
- 结论：关联 ID 的正确形态 = **连接局部、由既有 wire sequence 派生**（Owner 的 connection-local 要求 + ADR-0010 非目标「跨重连 update ID 表」边界一致；冲突报告第 3 条同款裁决）。事件面补 `sequence`（发送/apply/ACK 三处）即闭合，属 §23 append-only 字段新增（G3 红线不动：零 wire 字节变更）。

## 7. 生产证据再推导与根因假设排序

### 7.1 再推导（源：Issue 正文表格；原始日志文件见 §11 缺口注记）

由 `admission = completion − applyLatencyMs` 逐笔反推（10:26 窗口）：

| 完成时刻 | apply latency (ms) | 反推接纳时刻 |
|---|---:|---|
| 10:26:35 | 2,256 | 10:26:32.744 |
| 10:26:38 | 2,697 | 10:26:35.303 |
| 10:26:40 | 5,105 | 10:26:34.895 |
| 10:26:44 | 8,478 | 10:26:35.522 |
| 10:26:46 | 11,142 | 10:26:34.858 |

- 五笔接纳聚在 **[32.744, 35.522] 的 2.78 s 窗口**；完成跨度 11 s → 事故窗内**槽排空速率 ~2–3 s/笔**。
- 该 namespace 同期基线：Peer `update-applied` 中位 536.5 ms、p95 834 ms → 平时单槽（含排队）成本 ~0.5–0.8 s；事故窗膨胀 4–6 倍。
- Peer→Hub ACK max 1,392 ms、Hub apply max 222 ms：ACK 派发与 hub 侧成本低，**不支持**「ACK/hub 路径为主因」。
- 无 reconnect / 无 terminal / 无 error + 后续大更新仍成功：与「本地 sequencer 排队」一致（复现同形）。

### 7.2 假设排序（可证伪形态；预测 → 判别探针）

| # | 假设 | 预测（若为因） | 判别探针（§8 落地后） | 本分析证据 |
|---|---|---|---|---|
| **H1** | Peer event loop 被同步业务/observer 外部工作长阻塞 | 全部阶段同步拉长（含 ACK 派发、liveness timer 漂移、flush 调度漂移）；queue wait 与槽内段**同时**膨胀 | `eventLoopDelayMs`（注入时钟 + timer 漂移探针） | 复现无法呈现（in-memory duplex 无真实 timer/IO，结构性零 stall——见 §11）；生产 4–6× 同步膨胀与其相容 |
| **H4** | 同 sequencer 的业务 mutation S-slot 长占槽（#237：ordinary mutation 完整 ROOT 复制/校验成本） | UPDATE 的 `queueWaitMs` 高而自身 `protectedCheckMs/liveApplyMs/dirtyNotifyMs` 低；事故窗与 Runner 本地写突发对齐；slot 级记账可见 S-slot 时长 | `queueWaitMs` + sequencer 槽级 metrics（slot 类型/时长，日志-metrics seam，不入 status） | 机制同源（同一 FIFO）；MABF Center–Runner 协作 namespace 正是「复制 apply + 业务写混流」形态；#237 已独立登记该成本 |
| **H2** | 生产 dirty notification 违背「登记即返回」（ADR-0006 L33） | `dirtyNotifyMs` 高（秒级）；saveDoc resolve 前有重活 | `dirtyNotifyMs` | 在树内 saveDoc 为同步登记（persistence/src/lifecycle.ts:580-590，`dirtyGeneration += 1; scheduleFlush()`）——本 worktree 无慢路径；生产 adapter 包装层待查 |
| **H3** | R4 scratch clone O(doc) 在连续小 UPDATE 下排队 | `protectedCheckMs` 随文档体积线性、且事故窗文档巨大 | `protectedCheckMs` + 文档体量对齐 | **已降级**：实测（§7.3）在树全程 ~6 ms/MB，解释 2–3 s 槽需数百 MB 文档，量级不合 |
| H5 | ACK enqueue/socket write/hub ACK dispatch 延迟 | 只解释 ack−apply 差值，不能解释 Peer apply 阶梯 | （既有 ackLatency − applyLatency 差值即 probe） | 生产差值 ~156 ms@max，非主因 |

### 7.3 在树管线成本实测（临时实验，测后已删）

真实 Runtime/Session + fake duplex，五笔小 UPDATE「hub 业务写 → peer `update-applied`」墙钟（每档 5 样本，本机）：

| 文档体量 | 每笔全程 ms（hub/total 同量级） |
|---|---|
| 8KB | 3.2, 1.5, 1.6, 1.5, 1.3 |
| 64KB | 1.7, 1.6, 1.7, 1.7, 1.8 |
| 256KB | 2.0, 1.6, 1.8, 2.0, 1.7 |
| 1MB | 6.4, 5.5, 8.9, 4.4, 4.7 |

→ 增量成本 ≈ 6 ms/MB（含 hub S-slot、fanout、wire、peer R-slot 全程）。外推：生产中位 536 ms ≈ 需 ~90 MB 文档；2–3 s 槽 ≈ 需 300–500 MB——对 Center–Runner 协作 namespace 不合理。故 H3 单独不成立，至多为大体量文档上的放大器。**注意**：生产 VM CPU/负载可差 5–10×，但仍有 1–2 个数量级缺口；该测量排除的是「纯体量」解释，不是「体量 × 阻塞叠加」。

**边界重申（Owner 要求）**：以上是机制确认 + 排序依据；生产 11 s 占槽阶段的最终归因须待 §8 分段字段上线后以生产数据闭合。复现**不构成**生产阶段证明。

## 8. 观测面生产化设计（后续实现任务的输入）

原则：全部走 protocol §23 append-only 扩展 + ADR-0010 L167 observer seam；零 wire 字节变更（G3）；不进 `NamespaceRuntime.getStatus()`/`ReplicationSession.getStatus()` 公共面（G4/ADR-0008 L101「队列进度和内部事件属于日志、metrics 与 trace」）；槽序/FIFO 不动（G1）；R4 增量判据属 G2（先评审）。

1. **分段差值字段**（append 到 `update-applied` / `sync-diff-applied`；`applyLatencyMs` 语义不动——§23.4 冻结）：
   - `queueWaitMs` = slot start − admission；
   - `protectedCheckMs` = R4 进入至完成（scratch 预演）；
   - `liveApplyMs` = R5 `Y.applyUpdate` 时长；
   - `dirtyNotifyMs` = R6 `saveDoc` 时长。
   - 采样纪律：**槽内捕获（单调注入时源差值），apply 结算续体发射**（§23.4「发射点永不位于 Registry write sequencer 槽内」——本复现的 saveDoc 入/出戳即该模式的最小验证）；无 observer 时零采样零调用（逐字节等价）；数值恒为差值，无绝对时间戳。
   - 跨包 seam：R4–R6 时点在 `@nomicore/namespace-runtime` 槽内，事件在 `@nomicore/ws-replication` 发射——经 session 内部 seam 结构化导出样本（冲突报告注记 4 的边界：transport 不得直探 Runtime 内部）。
2. **关联字段**：`update-sent`/`update-applied`/`update-acked` 增加可选 `sequence`（发送/ACK 侧来自记账与 wire；apply 侧来自触发帧的 envelope sequence——合并帧时 sequence 对应合并帧，`bytes` 语义已同口径）。connection-local，不绑 metric label（§23.6），不跨重连。
3. **event-loop 探针**（连接域低频事件或 metrics）：注入单调时钟 + Cordis Timer 漂移采样（`fire 时刻时钟 − 计划时刻`）；仅 observer 在场启用。判别 H1。
4. **sequencer 槽级记账**（metrics/log seam，非事件、非 status）：per-namespace 槽类型（S/E/R/bump/close-barrier）× 时长直方图 + 队列深度采样（ADR-0008 L101 指定落点）。判别 H4。
5. **聚焦测试**：以本 repro 为基座扩展断言（分段字段 + sequence 关联 + 无 observer 等价 + throw 隔离），替代/补充现测试中对 saveDoc 的测试侧包覆。

## 9. 修复方向边界（后续任务）

- 复现内根因（慢 dirty 占槽）的合法修复空间 = 缩短槽内阶段，而非重排槽序：使生产 `saveDoc` 回归 ADR-0006「登记即返回」（若 H2 证实）；降低 R4 成本走 G2（增量/diff 触达判据，先设计评审 + 行为等价测试，ADR-0007 L59）；降低 S-slot 成本属 #237。
- 「修复后连续小 UPDATE 不再随序号单调累积」的 issue AC 以「事故窗槽成本回落至基线（中位 ~0.5 s 量级）」为可验证形态——queue wait 是 FIFO 的必然输出，消除的是「长槽」，不是排队本身。
- 未复现情形下的 AC 兜底（排除矩阵 + 缺失生产证据登记）已被本分析部分预填（§7.2/§7.3）；待分段字段生产数据闭合。

## 10. 变更与证据清单

本分析产生的 worktree 变更（未提交、未推送，按任务要求）：

| 文件 | 性质 | 说明 |
|---|---|---|
| `packages/ws-replication/test/ws-replication-issue238-repro.test.ts` | 新增 | 确定性复现 + 分段分解 + 关联断言（§2/§3/§5/§6 的全部断言） |
| `packages/ws-replication/test/issue137-driver.ts` | 修改（加性） | `Issue137BootOptions` 新增可选 `hubClock`/`peerClock`，条件透传 `createHubReplication`/`createPeerReplication` 的 `clock` seam；缺省零行为变化（dormant） |
| `wiki/raw/task_238_sa5_bug-analysis_2026-09-06.md` | 新增 | 本文档 |

验证命令与结果（均本 worktree 实跑）：

```bash
# 反馈循环（§2）：单轮 / 负控制（红）/ 还原（绿）/ 20× 稳定 —— 全部执行，结果见 §2
pnpm exec vitest run packages/ws-replication/test/ws-replication-issue238-repro.test.ts --reporter=verbose

# 相邻回归 + 类型检查（结果见 §10.1）
pnpm exec vitest run packages/ws-replication/test/ws-replication-issue238-repro.test.ts \
  packages/ws-replication/test/ws-replication-issue230-incremental-mutation.test.ts --reporter=verbose
pnpm --filter @nomicore/ws-replication typecheck
```

### 10.1 回归与类型检查摘要（2026-09-06T17:36–17:52Z 实跑）

- 相邻回归（上节成对命令）：`Test Files 2 passed (2)，Tests 3 passed (3)`（repro 1 + issue230 hub/peer 双向 2）。
- `@nomicore/ws-replication` 包全套件：`Test Files 49 passed (49)，Tests 348 passed (348)，Type Errors no errors`（含全部 import `issue137-driver` 的 9 个文件与新增 repro；49 = 48 个 `.test.ts` + 1 个 `test-d.ts` 类型用例文件）。
- `pnpm --filter @nomicore/ws-replication typecheck`：exit 0。
- 根 `pnpm typecheck`（13 个 tsc 项目全链）：exit 0。
- 临时性能实验文件（`ws-replication-issue238-scratch-perf.test.ts`）与临时诊断（`[DEBUG-238a]`）已删除（`grep -r "DEBUG-238a|SCRATCH-238perf" packages/` 零命中；test 目录仅存 `ws-replication-issue238-repro.test.ts` 一个 238 相关文件）。

## 11. 信息充分性与遗留缺口

1. **生产原始日志不可得**：Issue 正文引用的 `/home/wangjian/deepseek-harness/nomicore-center-runner-replication-log-2026-09-06.md` 现内容为 #231 的 code review 报告（文件被复用/覆盖）。本分析的生产证据基 = Issue 正文聚合数据（分位数 + 两窗口表格）——反推导（§7.1）已足够支撑排序，但逐事件原始记录缺失。
2. **event-loop stall 无法在本 harness 呈现**：fake duplex + fake scheduler（零真实 timer/IO）结构性排除 H1 的复现——这不是缺陷而是边界；H1 的证伪/证实只能靠 §8.3 生产探针。同理，本 harness 无法复现「网络 transit」段（恒 ~0）。
3. **单机性能外推的局限**：§7.3 在本机测得；生产 VM 负载/CPU 差异未量化，但量级缺口（1–2 个数量级）足以支撑 H3 降级结论。
4. **4MB+ 文档 boot 预算**：临时实验中 4MB 档曾触发 `bootMulti` 内置 3000 微任务轮预算耗尽（harness 预算，非生产路径）；大文档场景如需入测试，需扩展预算或分片装载。已从交付中移除该档位。
5. **分段字段/sequence 字段尚未进生产事件**：本分析的分解靠测试侧 seam（saveDoc 包覆 + 差值反推）验证了方法论与归因；生产化实现（§8）是后续任务，其 ADR/protocol 落点与红线已在冲突报告 G1–G4 与本文 §8 固化。
6. **#233 交互**：chunked live update 若合入，其分帧与本关联 ID/分段观测的交互需在设计期复核（冲突报告注记 3 同款提醒）。

## 结论

- 机制（同 namespace write sequencer 被长占槽 → 连续小 UPDATE 阶梯排队，`applyLatencyMs` 含 queue wait）已在本 worktree 以 Owner 基线构型（含注入单调时钟）确定性复现并红线证明；分段分解守恒，归因链闭合：**阶梯 = queue wait，被占槽 = dirty notification（复现注入）**。
- 生产 11 秒占槽阶段的归因仍未闭合（Owner 边界）；再推导 + 在树成本实测将 H1（event-loop 阻塞）与 H4（业务 S-slot 长占槽，#237 成本域）置顶，H2 次之，H3 降级。
- 闭合缺口的最小充分手段 = §8 的 append-only 分段/关联字段 + 槽级记账 + event-loop 探针（零 wire 变更、无 observer 等价、不进公共 status）——建议作为后续实现任务的输入。

Verdict: approve（机制复现与观测验证达成；生产归因按 Owner 边界登记为未闭合，非本分析缺陷）
