# SA6 诊断与验收契约报告 — issue #301（#295 切片 3）：分块同步完备性、observer 与新旧互通矩阵

- **dispatch**: iteration 0 = sa-a120072b-7629-4619-a2c2-5625f82ea5e5；**Revision R1 = sa-32477ccf-48a8-4d3d-be0f-6ba1cbab1a83（mabf-sa6 / acceptance-contract / iteration 1）**——响应 SA3 实现报告 §8-2 记录的 R2 末条 wire 计数断言阻塞，做 contract-only 最小修订并复核。
- **任务类型**: **Feature**（`feat(#295 切片 3)`）——不虚构 Bug 根因；本报告证明**能力缺口**（8 型 chunked-snapshot-*/chunked-sync-* observer 事件零发射点，且 slice 2 已把普通族改道归零 ⇒ 分块 snapshot/sync 在观测面完全不可见），并把目标行为固化为红灯验收契约 + 绿负控。
- **裁决**: **approve**（能力缺口经真实双端 harness 稳定复现；8 条红灯全部因能力缺失而失败；9 条负控当前即绿；既有 70 文件 / 499 用例零回归；测试入口真实）。**Revision R1 复核后维持 approve**：R2 末条 wire 断言的判别式已按 §9.2/§23.1 修订为 `ackedSequence` 精确锚定并完成双向复跑（§17），修订未改变红/绿边界与验收覆盖。
- **契约文件**: `packages/ws-replication/test/ws-replication-issue301-chunked-completeness-ac-red.test.ts`（新增，1392 行，17 用例：8 红 + 9 负控；R2 末条断言经 Revision R1 修订，见 §17）。
- **基线**: `0f3eca5`（`fix(#300): feat(#295 切片 2): chunked snapshot / sync-diff 端到端`，PR #325 合并点；`git rev-parse HEAD` 实测）。**SA6 生产实现零改动**（Revision R1 亦零改动，§17.6）。

---

## 1. Task type and inputs

**类型 = Feature**：issue #301 是 ADR 0019（已接受、docs 随 `2ca06f6`/`eb380d7` 冻结）的**第三切片**：slice 1（#299：0x42 单形态 codec + 两聚合上限配置链）与 slice 2（#300：kind=1/2 端到端传输）已落地；本票要求补全（a）异常面生命周期完备性矩阵、（b）observer seam 8 型发射点接线、（c）多 ns 公平调度/control reserve 回归；（新旧互通矩阵由 ADR 0019 非目标显式排除，不在本票范围）。

输入（全部实读）：

| 输入 | 用途 |
|---|---|
| `wiki/raw/task_issue-301.md` | 任务简报（What to build / AC1–AC5 / Blocked by #300） |
| `docs/adr/0019-chunked-sync-transfer.md` | 规范（L45–51 平移纪律、L66–70 错误码+超时两向收口、L72–83 observer 8 型、L96–103 后果/死码） |
| `docs/protocols/instance-replication-v1.md` | wire 唯一权威（§8.1/§9.2/§9.4/§10.3/§13.2/§17/§18/§22/§23.1–23.4/§23.7） |
| `packages/ws-replication/src/{bulk-transfer,update-transfer,hub-namespace,peer-namespace,round-engine,observer,types,defaults,validate}.ts` | 现状实现事实（能力缺口定位：发射点缺失/deferral 注释） |
| 既有测试：`ws-replication-issue300-chunked-sync-ac-red.test.ts`（8 红→已全绿）、`ws-replication-issue300-bulk-edge-ac.test.ts`、`issue244/245/246`（kind=0 先例/回归锚）、`issue256`（observer 隔离锚）、`issue137-ac1-ac7`（多 ns 公平锚）、`harness.ts`/`driver.ts`（确定性驱动） | 契约风格、回归面、运行入口 |
| **SA8 产物** | **本 iteration 不存在**（`wiki/raw/task_issue-301_conflict_report.md`、`_design.md`、`_relevant_decisions.md` 均缺失）——按 skill「输入缺失时使用任务简报、源码、日志和现有测试继续」，并直接从规范文档 + slice 2 源码中的**显式 deferral 注释**推导约束（§3）。 |

**Owner comment mapping**：REST comments endpoint 返回空（与 dispatch 声明一致）——无 owner 补充要求、无 override 需要并入；本契约不引入任何额外行为、不发明错误码/字段/事件。

---

## 2. Owner comment mapping

| Owner 输入 | 映射 |
|---|---|
| （无 — issue #301 comments 空；owner 未留补充评论） | 任务要求唯一来源 = issue body/AC1–AC5 + ADR 0019 + 协议冻结文本。契约零发明：8 型事件字段集逐字对齐 ADR L78–81 与 §23.1 第 29–36 型行；`reason` 复用既有 `ChunkedUpdateAbortReason` 六值闭联合（零新词）。 |
| Revision R1 owner-feedback 记录 | REST comments endpoint 仍无 comments（与 dispatch 记录一致）——无 owner 补充要求/override 需并入；修订仅由 SA3 记录的契约内部矛盾驱动（§17），未引入外部行为。 |

---

## 3. SA8 constraints（无 SA8 产物时的约束来源与落点）

本 iteration 无 `task_issue-301_conflict_report.md`/`_design.md`/`_relevant_decisions.md`。契约约束来自规范文本与 slice 2 已成文边界：

| 约束 | 来源 | 契约落点 |
|---|---|---|
| observer 8 型字段集（sent：connectionId?/namespaceId/transferId/chunkCount/totalBytes，sync 族另携 syncRoundId；applied：+bytes/chunkCount/applyLatencyMs?；acked：+bytes/ackLatencyMs?；aborted：namespaceId/transferId/reason/receivedChunks/receivedBytes） | ADR 0019 L78–81；协议 §23.1 第 29–36 型行 | R1/R2/R3/R4/R5/R8 的键集白名单 + required/forbidden 断言（R6 全量深扫） |
| sent = transfer 完成出站**恰一**、非逐 chunk；applied/acked 每笔恰一；aborted 与成功型互斥 | §23.1 L746–754（kind=0 先例逐字平移） | R1/R2 计数恰一（chunkCount ≥ 2 前置）；R3/R4/R5/R8 aborted 恰一 + 零成功型 |
| 分块 sync round 的单 `SYNC_APPLIED` 以 `ackedSequence` = 末 chunk 帧序为身份（同一方向其他 round 的 ACK 不参与判别） | §9.2 L246；§23.1 第 34 型「末 chunk 帧序的单 SYNC_APPLIED」 | R2 末条 wire 锚（Revision R1 修订，§17） |
| 改道（R21 平移）：分块窗口内 `bootstrap-snapshot-sent`/`bootstrap-imported`/`sync-step2-sent`/`sync-diff-applied` 归零 | §23.1 第 29–34 型「改道」子句；ADR 0019 L74–83 | R1（普通族 sent/imported 零）、R2（普通族 sent/applied 增量零）、N6（单帧路径普通族照常=触发条件） |
| `syncRoundId` 仅 sync 族 sent/applied 携带；acked 键集冻结无 sequence/syncRoundId | §23.1 L752–754 | R2 required/forbidden；R1/R2 acked forbidden `sequence` |
| safe-field：仅长度/计数/受控标识；禁止 Yjs bytes/ArrayBuffer/DataView/Error/token/owner/SCHEMA/ROOT/cause | §23.3；§23.7 conformance | R6 深扫 + JSON 哨兵（token/owner/内容片段） |
| throw 隔离、决策落定后发射、无 observer 逐字节等价 | §23.4；ADR 0019 L83 | N7（observer 全 throw vs 无 observer wire/值全等）；N1/R3–R5 发射点在决策后（状态/帧已落定） |
| clock 缺省 → latency 整键缺失（非 undefined 值） | §23.4 | R7（两族 applied/acked 四键） |
| 超时两向收口：kind=1 → BOOTSTRAP_FAILED 族终局；kind=2 → 弃 partial + `RESYNC_REQUIRED{SYNC_TRANSFER_EXPIRED}` 非终态 | ADR L70；协议 §9.2/§17/§18 | N1（kind=1 终局 + `namespace-failed{bootstrap-timeout,30000}`）；R5-AC2 绿半（kind=2 非终态 + 零 ERROR + 零写入） |
| assembly 纯易失：断线/close/GOAWAY/epoch fence 全部丢弃、partial 绝不进 live 路径、零 durable 残留 | ADR L49；协议 §10.3 L336 | R3（channel-teardown）/R4（connection-teardown）/R8（GOAWAY drain→connection-teardown 行）/N9（epoch fence 效果面）；全部断言零写入 + 零 dirty |
| 恶意声明不导致无界分配：首 chunk 分配前二维上界 + 几何校验，通过后一次性有界分配 | ADR L49；协议 §10.3 L337 | N5（kind=1 count 65 → `SNAPSHOT_TRANSFER_TOO_LARGE`；kind=2 totalBytes 1MiB → `SYNC_TRANSFER_TOO_LARGE`；均分配前拒绝 + 零写入） |
| 多 ns 复用 + control reserve 零 chunk + 公平调度不饿死 | 协议 §17 L584–586 | N8（双 ns 分块 snapshot 同连接全部收敛；data 闸门关闭期 control 帧照常、零 chunk） |
| 互通矩阵不在本票 | ADR 0019 非目标；issue body 括注 | 契约零互通矩阵断言 |

**slice 2 显式 deferral（源码内证据，构成本票能力缺口的直接施工面）**：
`hub-namespace.ts` L993–994 与 `peer-namespace.ts` L952–953：
「issue #295 切片 2（D8/R46）：aborted 事件仅 kind=0（`busyKind === 0`）——kind=1/2 分块中止的对应事件类型**归 #301**，本切片零发射。」
`peer-namespace.ts` L609（`emitImported=false` 改道）与 `hub-namespace.ts` L1446–1458 / `peer-namespace.ts` L1725–1740（`syncChunked` 抑制普通族）确认：分块窗口普通族已归零、新族未接线 ⇒ 观测面空洞。

---

## 4. Environment and baseline

- 环境：Node `v24.13.0`、pnpm `10.28.2`、vitest `3.2.7`、TS `5.9.3`、yjs 13.6.x；依赖经本地 pnpm store **离线**安装（`pnpm install --frozen-lockfile --offline`：65 包 reused，零网络）。
- 基线 HEAD `0f3eca5`；工作树初始仅 1 个未跟踪简报快照（`wiki/raw/task_issue-301.md`）。
- **契约前基线全包复跑**：`npx vitest run packages/ws-replication/test --typecheck.enabled=false` → **70 文件 / 499 用例全绿**（slice 2 的 #300 契约 8 条红灯已全部转绿）。
- **契约后全包**：71 文件 / 516 用例 → **8 failed | 508 passed**；8 条失败**全部且仅为**本契约红灯；既有 70 文件 / 499 用例零回归。

---

## 5. Positive reproduction（能力缺口复现）

复现全部经真实 yjs / Registry / Runtime / fake-duplex wire，`chunkedUpdate: true`，零 real sleep。诊断探针（临时文件，已删，§16）逐事件/逐帧观测：

**(a) 分块 snapshot（100KB 文档，`maxBootstrapBytes=8KiB`、`maxChunkedBootstrapBytes=512KiB`）**

| 观测 | 实测 |
|---|---|
| wire | 13 × `UPDATE_CHUNK`（kind=1、transferId=1、chunkCount=13、totalBytes=100407、Σbytes=totalBytes、Σ/帧 ≤8KiB）→ 单 `BOOTSTRAP_ACK` 锚末 chunk 帧序 → peer `live` |
| hub observer | `connection-state-changed`、`channel-state-changed`×3、`sync-step2-sent`、`sync-diff-applied`——**零 `chunked-snapshot-sent`、零 `chunked-snapshot-acked`**；`bootstrap-snapshot-sent` 已归零（改道生效） |
| peer observer | **零 `chunked-snapshot-applied`**；`bootstrap-imported` 已归零（改道生效） |

⇒ 合法的 kind=1 分块 bootstrap 成功收敛，但在 observer 面**完全不可见**（既无普通族、也无分块族）。

**(b) 分块 sync-diff（peer→hub 100KB 写；`maxChunkedUpdateBytes=64KiB` 使 live 路径不可分块 → F4 丢弃 → resync → 恢复 diff > `maxSyncDiffBytes=32KiB`）**

| 观测 | 实测 |
|---|---|
| wire | 13 × `UPDATE_CHUNK`（kind=2、transferId=2、chunkCount=13、totalBytes=100029、首 chunk `syncRoundId=2`）→ 单 `SYNC_APPLIED` 锚末 chunk 帧序；hub 收敛 |
| peer observer | **零 `chunked-sync-sent`、零 `chunked-sync-acked`**；分块窗口内 `sync-step2-sent` 零新增（改道生效） |
| hub observer | **零 `chunked-sync-applied`**；分块完成点 `sync-diff-applied` 零发射（改道生效） |

**(c) kind=1 尾部丢失 → assembly 超时（`assemblyTimeoutMs=30s`，虚拟时间推进 30_001ms）**：peer `failed` + wire `BOOTSTRAP_FAILED` + `namespace-failed{bootstrap-timeout, timeoutMs=30000}` + 零副本 + 零 dirty；**零 `chunked-snapshot-aborted`**（终局失败族的 aborted 行归 §23.1 明文排除，见 §15）。

**(d) kind=1 partial + CLOSE_NAMESPACE（channel-teardown 行）**：peer `closed`、零副本；**零 `chunked-snapshot-aborted`**。

**(e) kind=1 partial + 断线（connection-teardown 行）**：peer `disconnected`、零副本；**零 `chunked-snapshot-aborted`**。

**(f) kind=2 尾部丢失 → assembly 超时（seal 代理丢弃末 chunk 及其后全部帧，连接级 sequence 保持连续）**：12/13 chunk 已收；推进 30_001ms → hub 出向 `RESYNC_REQUIRED{SYNC_TRANSFER_EXPIRED}`、零 ERROR、零 `namespace-failed`、peer 非 failed、hub 值不变（seed）、零 dirty；**零 `chunked-sync-aborted`**。

**(g) kind=1/2 重复、错序、中途丢帧、恶意声明（现状已交付面，探针实测）**：
- kind=1 重复首 chunk / 错序（缺 i1 直达 i2）→ `SNAPSHOT_TRANSFER_VIOLATION` + failed + 零副本；
- kind=2 chunk1 原位改写为 chunk0（同 sequence 重复）→ `SYNC_TRANSFER_VIOLATION` + hub 值不变 + 零 dirty；
- kind=2 中途丢帧（序列缺口）→ connection fatal `SEQUENCE_VIOLATION` + 零部分导入（可靠有序 transport 下丢帧**不可能**静默产生部分导入）；
- kind=2 chunk0 声明 `totalBytes=1MiB`（> `maxChunkedSyncDiffBytes` 512KiB）→ `SYNC_TRANSFER_TOO_LARGE`（分配前拒绝）+ 零写入；kind=1 `chunkCount=65` → `SNAPSHOT_TRANSFER_TOO_LARGE` + 零写入。

**(h) 多 ns / 无 observer 对照**：双 namespace 同连接各 13 chunk 分块 snapshot 全部收敛（零饿死）；observer 全 throw 与无 observer 基线的 hub→peer 帧序列逐字节相同（18 帧）；无 observer 零事件。

---

## 6. Negative control

| 负控 | 断言 | 现状 |
|---|---|---|
| **N1**（AC1/AC2） | kind=1 尾部停滞超时 → `BOOTSTRAP_FAILED` 族终局 + `namespace-failed{bootstrap-timeout,30000}` + 零写入/零 dirty | ✅ 绿 |
| **N2**（AC1） | kind=1 重复首 chunk / 错序 → `SNAPSHOT_TRANSFER_VIOLATION` + failed + apply 前零写入 | ✅ 绿 |
| **N3**（AC1） | kind=2 重复 chunk（原位改写，sequence 合法）→ `SYNC_TRANSFER_VIOLATION` + 零部分导入/零 dirty | ✅ 绿 |
| **N4**（AC1） | kind=2 中途丢帧 → 连接级 `SEQUENCE_VIOLATION` + 零部分导入/零 dirty | ✅ 绿 |
| **N5**（AC3） | 恶意 `chunkCount`/`totalBytes` 声明分配前拒绝（kind=1 count / kind=2 aggregate）+ 零写入 | ✅ 绿 |
| **N6**（AC5 触发条件） | 未超单帧上限的 snapshot/diff 仍走单帧普通族（sent/imported/step2-sent/diff-applied 各照常）+ 零 chunked 事件/零 chunk | ✅ 绿 |
| **N7**（AC5/§23.4） | observer 全 throw 与无 observer 基线 wire 逐帧全等 + 无 observer 零事件 | ✅ 绿 |
| **N8**（AC4） | 双 ns 分块 snapshot 同连接复用全部收敛；data 闸门关闭期 control 帧照常、零 chunk | ✅ 绿 |
| **N9**（AC1） | epoch fence 下 partial kind=1 assembly 全部丢弃、零写入/零 dirty、终态 ∈ {conflicted, disconnected} | ✅ 绿 |

负控同时证明红不来自环境/入口/断言敏感度：N1/N2 与 R3/R4/R8 共用同一 partial 构型（只改收口触发面）；N3/N4/N5 与 R2/R5 共用同一 kind=2 真实 transfer 注入面（只改改写模式）；N6 与 R1/R2 共用同一 boot helper（只改载荷规模）；N7 与 R1/R2 共用同一运行路径（只改 observer 实现）；N8 复用同一连接/调度链。

---

## 7. Stability, scale and timing

- **稳定性**：契约连跑 3 次 → 每次 `8 failed | 9 passed (17)`，失败集合与失败断言逐字相同（零抖动）；全包运行复现同一 8 条。
- **规模**：载荷 100KB（≈13 chunk，`maxUpdateBytes=8KiB`）/ 16KB（单帧对照）；`maxInFlightUpdates=8`；聚合上限 512KiB（= 64 × 8KiB 链②边界内）；恶意声明上界 1MiB（远超聚合上限，分配前拒绝）。
- **时序**：全部微任务/假调度器驱动（`settle`/`settleUntil` ≤3000 迭代）；虚拟时间仅在两个超时用例推进（30_001ms = `assemblyTimeoutMs` + 1ms）；`ackTimeoutMs=60s`、`bootstrapTimeoutMs/reconcileTimeoutMs=120s` 均不被触发——**R5 的 kind=2 超时用例把 reconcile 上限抬到 assembly 之上**以隔离单变量（诊断中默认 reconcileTimeout 10s 先行触发 peer 重建，故显式排除）。红不可能是超时/预算产物。
- **竞态**：零真实并发；跨方向顺序用 wire 数组/帧序断言，不依赖真实时间。

---

## 8. Capability gap（能力缺口链，替代 Bug 根因链）

| Step | Fact | Evidence | Confidence |
|---|---|---|---|
| 症状 | kind=1/2 分块传输成功收敛、异常面按规范收口，但 observer 面 8 型事件**恒零**；分块 snapshot/sync 在事件流中完全不可见 | §5(a)(b)(c)(d)(e)(f)；探针逐事件观测 | 高 |
| 直接故障点 ①（类型面） | `types.ts` `ReplicationObserverEvent` 判别联合**无** `chunked-snapshot-*`/`chunked-sync-*` 8 型（第 29–36 型未追加）；`observer.ts` 白名单不涉（事件类型非稳定码） | `types.ts` L775–856（第 25–28 型为止）；`grep chunked-snapshot\|chunked-sync` 在 src 下命中 0 | 高 |
| 直接故障点 ②（发送侧发射点） | hub `startBootstrap` kind=1 分支 enqueue 后直接 return（零事件）；`onBootstrapAck` 仅 `bulkTransfer.settle(1)`（零事件）；hub/peer `sendStep2` kind=2 分支 enqueue 后 return（零事件）；`BulkTransferSender` 无 sent/acked 结算回调面 | `hub-namespace.ts` L573–604/L632–652/L697–731；`peer-namespace.ts` L1538–1572；`bulk-transfer.ts` L188–202 | 高 |
| 直接故障点 ③（接收侧发射点） | peer `finishBootstrapImport(..., emitImported=false)` 对 kind=1 完成点零事件；`applyRemoteUpdate` 的 `{syncChunked:true}` 分支**仅抑制**普通族、零替代事件；kind=0 的 `chunked-update-applied` 分支结构性排除 kind=1/2 | `peer-namespace.ts` L609–618/L900/L1725–1740；`hub-namespace.ts` L1446–1474 | 高 |
| 直接故障点 ④（aborted 发射点） | hub/peer `clearInboundAssembly(reason)` 的发射条件显式 `busyKind === 0`；kind=1/2 丢弃（timeout/close/断线/GOAWAY/fence/resync/shed）零事件 | `hub-namespace.ts` L993–1016；`peer-namespace.ts` L952–978（源码注释明文「归 #301」） | 高 |
| 触发条件 | 分块窗口（snapshot > `maxBootstrapBytes` 且 ≤ `maxChunkedBootstrapBytes`；diff > `maxSyncDiffBytes` 且 ≤ `maxChunkedSyncDiffBytes`）+ observer 注入 | R1/R2 构型；#300 契约 8 条已绿 | 高 |
| 放大因素 | 普通族改道已在 slice 2 落地 ⇒ 分块窗口内既有普通族零发射、新族未接线，形成**观测盲区**（不是「多一条事件」而是「该传输无任何事件」） | `peer-namespace.ts` L609；`hub-namespace.ts` L1446–1458；`peer-namespace.ts` L1725–1740 | 高 |
| 最深根因 | 切片划分：#300 把 kind=1/2 的 observer 面（8 型 + aborted 两族）显式推迟到 #301（源码 deferral 注释 + R46 登记），本票尚未实现 | §3 deferral 证据；`wiki/raw/task_issue-300_sa6_contract.md` R46 | 高 |
| 未证实假设 | kind=1 超时（终局失败族）是否发 aborted；epoch-fence 在 peer 侧的 reason 归类（connection-teardown 可能 last-writer-wins 覆盖） | 契约**不**断言这两处（§12.3/§15），仅断言效果面 | — |
| 已排除 | 环境/依赖/入口/codec/配置链/协商门/普通族改道/生命周期实现缺陷（§11） | — | 高 |

---

## 9. Causal experiments（控制变量/反证）

| 实验 | 变量 | 结果 | 结论 |
|---|---|---|---|
| E1 | 同一 100KB snapshot：`maxBootstrapBytes` 8KiB（分块）vs 400KiB（单帧） | 分块 → 13 chunk、零 `bootstrap-snapshot-sent`、零 `chunked-snapshot-*`；单帧 → 1 帧 `BOOTSTRAP_SNAPSHOT` + 1 `bootstrap-snapshot-sent` + 1 `bootstrap-imported` | 改道生效而新族缺失，观测盲区由 kind 分支造成（N6 对照） |
| E2 | 同一 100KB diff：`maxChunkedUpdateBytes` 64KiB（resync→kind=2 分块）vs 4KiB/16KB（单帧 diff） | 分块 → 13 kind=2 chunk、零 `sync-step2-sent` 增量、零 `chunked-sync-*`；单帧 → 1 `sync-step2-sent` + 1 `sync-diff-applied` | 同上；红与「触发条件/普通族」正交 |
| E3 | kind=2 尾部：完整收齐 vs 丢末 chunk（seal） | 收齐 → 收敛 + 零事件；停滞 → 30s 后 `RESYNC_REQUIRED{SYNC_TRANSFER_EXPIRED}` + 零 aborted 事件 | 超时收口（AC2）已实现；红只在事件面 |
| E4 | kind=1 partial 收口面：CLOSE_NAMESPACE / 断线 / GOAWAY drain / epoch fence / F4 超时 | 四类非终局/终局收口均丢弃 partial（零副本/零 dirty），但 `chunked-snapshot-aborted` 恒零；fence 的 peer 终态可为 disconnected（连接收口后置） | 丢弃语义已实现；aborted 族缺失（R3/R4/R8 红）；fence 只锁效果（N9） |
| E5 | kind=2 违例注入面：整笔丢弃+手工注入 vs 原位改写（同 sequence） | 整笔丢弃后任意后续真实帧 → `SEQUENCE_VIOLATION`（连接 fatal），注入面被污染；原位改写（同 sequence）→ 精确命中 `SYNC_TRANSFER_VIOLATION`/`SYNC_TRANSFER_TOO_LARGE` | 契约采用原位改写（N3/N5）；「丢帧」的忠实模型 = 尾部停滞（超时）或序列缺口（连接 fatal），分别由 R5/N4 覆盖 |
| E6 | observer 实现：全 throw vs 无 observer | wire 帧序列逐字节相同（18 帧）、值相同；无 observer 零事件 | §23.4 隔离/等价纪律成立（N7 回归锚） |
| E7 | clock：注入 vs 缺省 | 注入 → applied/acked latency 键应在场（红，事件缺失）；缺省 → 基线实现本应整键缺失（R7 红面） | R7 同时锁字段在场纪律与「非 undefined 值」折叠 |
| E8 | 双 ns：同日启动两笔分块 snapshot | 13+13 chunk 全部收敛、零饿死；data 闸门关闭期 control 帧照常、零 chunk | AC4 多 ns/control reserve 面已实现（N8 回归锁） |

---

## 10. Impact surface（实现面，仅信息，非设计）

- `types.ts`：`ReplicationObserverEvent` 追加第 29–36 型判别成员（字段集逐字 ADR L78–81/§23.1）；`ChunkedUpdateAbortReason` 复用零新词。
- 发送侧：`bulk-transfer.ts`（末 chunk 结算/ACK 结算回调面：totalBytes、chunkCount、transferId、syncRoundId、latency 采样点）；`hub-namespace.ts`（startBootstrap kind=1 分支 + onBootstrapAck settle(1)）；`hub/peer-namespace.ts` `sendStep2` kind=2 分支 + SYNC_APPLIED settle(2)；`round-engine.noteChunkedStep2Outbound`（round id 事实源已就位）。
- 接收侧：`peer-namespace.finishBootstrapImport`（emitImported=false 分支改为发 `chunked-snapshot-applied`）；`hub/peer-namespace.applyRemoteUpdate` 的 `{syncChunked:true}` 分支改为发 `chunked-sync-applied`（携 syncRoundId）；applyLatency 沿用既有 t0/t1 采样点。
- aborted：`hub/peer-namespace.clearInboundAssembly` 的 `busyKind` 门泛化为 kind 选型（kind=0 保持 `chunked-update-aborted`；kind=1 → `chunked-snapshot-aborted`；kind=2 → `chunked-sync-aborted`），reason 复用既有矩阵行；终局失败族（`SNAPSHOT_TRANSFER_*`/`BOOTSTRAP_FAILED`/`SYNC_TRANSFER_*`）不发 aborted（§23.1 明文）。
- 不改：0x42 codec/字段序、消息码/错误码注册表、配置键与校验链、普通族既有发射点与改道归零（slice 2 R21 已实现）、kind=0 行为（全包回归锚）。
- 文档同步义务（实现 ticket）：§23.1 事件词汇计数文案（36 型已登记，无需改）、§22 conformance 资产锚如需补记。

---

## 11. Ruled-out hypotheses

| 假设 | 排除证据 |
|---|---|
| 环境/依赖/入口问题 | 离线安装成功；契约前全包 70 文件/499 用例全绿；同一 boot helper 上 9 条负控全绿 |
| 传输能力缺失（分块未接通） | R1/R2 构型下 kind=1/2 chunk 序列真实上 wire（13 + 13）、单 ACK 锚末 chunk 帧序、双端收敛（N1–N5/N8） |
| 普通族改道未落地（导致红只是旧文案漂移） | N6 证明单帧路径普通族照常；R1/R2 断言分块窗口普通族**增量零**——改道与事件缺失可分离 |
| codec/协商门/配置链缺陷 | #300 契约 8 条绿、#299 契约绿；N5 声明校验与边界行为符合 §10.3 |
| 生命周期实现缺陷（超时/丢弃/违例） | N1–N5/N9 全绿；R5-AC2 绿半（`SYNC_TRANSFER_EXPIRED` 非终态）在红断言**之前**通过 |
| 序列/注入造假 | N3/N5 注入经真实 kind=2 序列原位改写（同 sequence、codec 自洽）；R5 前置断言已收 12/13 chunk；R3/R4/R8 前置断言 partial 进度与 wire 一致 |
| 「测试预算/超时」伪红 | 红灯断言为事件集合/键集直接断言；虚拟时间仅在两个超时用例受控推进；诊断已排除 reconcileTimeout 干扰 |
| observer 隔离缺陷 | N7 全 throw 与无 observer wire 全等、零事件 |
| 这是 Bug（现实现应有事件） | slice 2 源码注释明文「kind=1/2 aborted 事件归 #301」；ADR/协议冻结的是**目标契约**，属能力缺口而非缺陷回归 |

---

## 12. Acceptance contract and test paths

**文件**：`packages/ws-replication/test/ws-replication-issue301-chunked-completeness-ac-red.test.ts`（新入口经真实包入口 `@nomicore/ws-replication` + `@nomicore/replication-protocol`，真实 yjs/Registry/Runtime，wire + observer 载荷断言，无源码字符串/正则）。

### 12.1 红灯契约（实现前必须失败，实现后转绿）

| 用例 | 锚点 | 最小输入 | 可观察断言（目标实现） |
|---|---|---|---|
| **R1** | AC5/AC1；§23.1 29–31 型 | 100KB snapshot；`maxBootstrapBytes=8KiB`；clock 注入 | hub 恰一 `chunked-snapshot-sent`（transferId/chunkCount/totalBytes = wire 申报、无 sequence/latency 键）；peer 恰一 `chunked-snapshot-applied`（bytes=totalBytes、chunkCount、applyLatencyMs ≥0、无 transferId/sequence/stages）；hub 恰一 `chunked-snapshot-acked`（bytes=totalBytes、ackLatencyMs ≥0、无 sequence/transferId）；`bootstrap-snapshot-sent`/`bootstrap-imported` 归零；收敛 + 单 ACK 锚末 chunk 帧序 |
| **R2** | AC5/AC2；§23.1 32–34 型、§9.2 L246 | peer 100KB 写 → resync → kind=2 恢复 diff；clock 注入 | peer 恰一 `chunked-sync-sent`（+syncRoundId=wire round、无 sequence）；peer 恰一 `chunked-sync-acked`（bytes=totalBytes、无 sequence/syncRoundId）；hub 恰一 `chunked-sync-applied`（bytes=totalBytes、chunkCount、syncRoundId、applyLatencyMs、无 transferId/sequence/stages）；分块窗口普通族 `sync-step2-sent`/`sync-diff-applied` 增量零；**wire 锚（Revision R1 修订 §17）**：hub→peer 全部 `SYNC_APPLIED` 中 `ackedSequence` = kind=2 末 chunk 帧序者**恰一笔**——判别式 = `ackedSequence`，不得按 `SYNC_APPLIED` 总数计数（bootstrap 后初始 round 另有一笔既有 ACK） |
| **R3** | AC1/AC5；§23.1 35 型；§10.3 L336 | kind=1 partial（丢末 chunk）+ crafted CLOSE_NAMESPACE | peer 恰一 `chunked-snapshot-aborted{channel-teardown}`（transferId/receivedChunks/receivedBytes = 实际进度、无 connectionId）；零 applied；零写入/零 dirty |
| **R4** | AC1/AC5 | kind=1 partial + 断线（closeHubSide 1001） | peer 恰一 `chunked-snapshot-aborted{connection-teardown}` + 进度一致；零写入/零 dirty |
| **R5** | AC2/AC5 | kind=2 partial（seal：丢末 chunk 及其后帧）+ `advance(30_001)`；`reconcileTimeoutMs=120s` 隔离 | **AC2 绿半**：`RESYNC_REQUIRED{SYNC_TRANSFER_EXPIRED}`、零 ERROR、零 `namespace-failed`、peer 非 failed、hub 值不变、零 dirty；**红半**：hub 恰一 `chunked-sync-aborted{timeout}` + 进度一致；零 `chunked-sync-applied` |
| **R6** | AC5/§23.3/§23.7 | 4 次运行收集全 8 型（snapshot 成功 / sync 成功 / snapshot aborted / sync aborted） | 8 型**全部可观测**；每事件键集 ⊆ 冻结白名单；深扫无 `Uint8Array`/`ArrayBuffer`/`DataView`/`Error`；JSON 无 token/owner/文档内容哨兵 |
| **R7** | AC5/§23.4 | observer 在场、clock 缺省（snapshot + sync 两次运行） | `chunked-snapshot-applied`/`-acked`/`chunked-sync-applied`/`-acked` 各恰一；`applyLatencyMs`/`ackLatencyMs` **整键缺失**（非 undefined 值） |
| **R8** | AC1/AC5；§23.1 GOAWAY 行 | kind=1 partial + crafted `GOAWAY{SERVER_RESTARTING, drain=1000}` + `advance(1_000)` | peer 进入 draining；恰一 `chunked-snapshot-aborted{connection-teardown}`（GOAWAY 无独立 reason）+ 进度一致；零写入/零 dirty |

### 12.2 绿负控（当前即绿，实现后必须保持绿）

N1（kind=1 超时终局）/ N2（kind=1 重复+错序）/ N3（kind=2 重复）/ N4（kind=2 中途丢帧→SEQUENCE_VIOLATION）/ N5（恶意声明分配前拒绝，kind=1 count + kind=2 aggregate）/ N6（单帧路径普通族照常 + 零 chunked 事件）/ N7（observer 全 throw 与无 observer 等价 + 无 observer 零事件）/ N8（双 ns 公平 + control reserve）/ N9（epoch fence 丢弃效果）。

### 12.3 已声明的解释边界（不进断言，供 SA1/SA3 设计对照）

1. **kind=1 超时是否发 aborted**：§23.1 第 35 型明文「终局失败族（`SNAPSHOT_TRANSFER_*`/`BOOTSTRAP_FAILED` 族）不发本事件」⇒ kind=1 超时（→`BOOTSTRAP_FAILED` 终局）预期**零** aborted；契约在 N1 只断言终局面与「零成功型事件」，不锁 aborted 计数。
2. **epoch-fence 的 aborted reason**：peer 侧 `onIdentityChanged` 置 `epoch-fence` 后，若连接随之收口，`runDisposal` 可能以 `connection-teardown` 覆盖（last-writer-wins）；契约只锁**丢弃效果**（N9），不锁 reason。
3. **GOAWAY reason 映射**：按 §23.1「GOAWAY 无独立 reason，drain 收口归 `connection-teardown` 行」断言（R8）。
4. **`connectionId` 在场纪律**：握手完成后在场（§23.1 既有信封）；aborted 族无 `connectionId`（对齐既有 chunked-update-aborted 域键集）——R3/R4/R5/R8 断言其不在场。

### 12.4 触发与纪律

- 触发方式：`packages/*/test/**/*.test.ts` 被 `vitest.config.ts` include 命中；无 `skip/only/todo`、无 env override、无 fallback、不断言源码字符串。
- 契约 header 逐条登记 ADR/协议条款与 AC 映射，供 SA1 设计/SA3 实现对照。

---

## 13. Red / green evidence

命令（worktree 根，`NODE_OPTIONS=--conditions=nomicore-source`）：

```bash
npx vitest run packages/ws-replication/test/ws-replication-issue301-chunked-completeness-ac-red.test.ts --typecheck.enabled=false
npx vitest run packages/ws-replication/test --typecheck.enabled=false
npx tsc -p packages/ws-replication/tsconfig.json
pnpm typecheck
```

### 13.1 实现前基线（契约文件原始版本，SA3 实现前的红）

| 运行 | 结果 |
|---|---|
| 契约单跑 ×1 | **8 failed \| 9 passed (17)** |
| 契约单跑 ×2（稳定性） | **8 failed \| 9 passed (17)**，失败集合/断言逐字相同 |
| 契约单跑 ×3（稳定性） | **8 failed \| 9 passed (17)** |
| 全包（71 文件） | **8 failed \| 508 passed (516)**；8 条失败**全部**为本契约红灯；既有 70 文件/499 用例零回归 |
| `tsc -p packages/ws-replication/tsconfig.json` | exit 0（契约文件类型干净） |
| 根 `pnpm typecheck`（14 个 tsconfig） | exit 0 |

**8 条红灯的失败原因（全部为能力缺失——事件零发射；全部在对应前置断言通过之后失败）**：

1. R1 — `hub 必须发射恰一次 chunked-snapshot-sent（transfer 完成出站时恰一，非逐 chunk）: expected [] to have a length of 1 but got +0`
2. R2 — `发送侧（peer）必须发射恰一次 chunked-sync-sent: expected [] to have a length of 1 but got +0`
3. R3 — `kind=1 partial assembly 被 channel-teardown 丢弃时必须发射恰一次 chunked-snapshot-aborted: expected [] to have a length of 1 but got +0`
4. R4 — `断线必须丢弃 partial kind=1 assembly 并发射恰一次 aborted: expected [] to have a length of 1 but got +0`
5. R5 — `kind=2 assembly 停滞超时（进度滑动 deadline）必须发射恰一次 chunked-sync-aborted{timeout}: expected [] to have a length of 1 but got +0`（此前 AC2 绿半断言已通过：`SYNC_TRANSFER_EXPIRED` + 非终态 + 零写入）
6. R6 — `R6：8 型事件必须全部可观测（缺 chunked-snapshot-sent）: expected false to be true`
7. R7 — `R7：applied 事件必须在场（前置）: expected [] to have a length of 1 but got +0`
8. R8 — `GOAWAY drain 丢弃 partial kind=1 assembly 必须发射恰一次 chunked-snapshot-aborted（映射 connection-teardown 行）: expected [] to have a length of 1 but got +0`

**前置断言（已通过，证明红灯不是 fixture 空转）**：R1/R2 先断言 13 chunk 的 wire 结构与 Σbytes；R3/R4/R8 先断言 peer `bootstrapping` + 已收 = `chunkCount-1` + 进度字节；R5 先断言真实 kind=2 transfer 已收 12 chunk（= `chunkCount-1`）；R6 前置为 4 次真实运行；R7 前置为两族事件在场。

**转绿判据（供 SA1/SA3/SA7 核对）**：上述 8 条全部转绿，且 N1–N9 与全包既有 499 条断言保持绿。

### 13.2 Revision R1 修订后复跑（当前契约文件 = 修订版，SA3 实现在场）

| 运行 | 结果 |
|---|---|
| 契约单跑 ×1（实现在场） | **17 passed (17)**（R1–R8 全绿 + N1–N9 保持绿） |
| 契约单跑 ×2/×3/×4（稳定性，实现在场） | **17 passed (17)** ×3，零抖动 |
| 全包（71 文件，实现在场） | **516 passed (516)，0 failed**；既有 70 文件/499 用例 + #300 契约零回归 |
| `tsc -p packages/ws-replication/tsconfig.json` | exit 0 |
| 根 `pnpm typecheck`（14 个 tsconfig） | exit 0 |
| 实现前基线复跑（修订版契约 + `git stash` 临时回退 src） | **8 failed \| 9 passed (17)**；8 条失败消息与 §13.1 逐字相同；R2 在 `chunked-sync-sent`（观测面能力缺口）处失败，**未到达**修订后的 wire 锚断言——证明修订不掩盖能力缺口、红/绿边界不变（§17） |
| 断言敏感度 mutation（临时副本：判别式 `ackedSequence = 末 chunk 帧序 + 1`） | **1 failed \| 16 passed (17)**；R2 恰在修订后的锚定断言处失败 `expected [] to have a length of 1 but got +0`——证明该断言非恒真（临时副本已删除） |

---

## 14. Runner trigger evidence

- `vitest.config.ts`：`test.include = ['packages/*/test/**/*.test.ts', ...]` → 契约路径命中；根 `pnpm test` = `NODE_OPTIONS=--conditions=nomicore-source vitest run --typecheck` 会执行该文件。
- 实测发现：修订版单文件运行 `17 tests`（实现前 8 failed | 9 passed；实现后 17 passed）；全包运行 `71 files`、`516 tests`（含本文件 17 条），非「文件未收集」。
- 契约文件不含 `describe.skip`/`it.only`/`it.todo`/`process.env`/正则源码断言（自检：`grep -c "  it("` = 17，skip/only/todo/env 命中 0；Revision R1 的临时诊断探针/mutation 副本零残留，§17.6）。
- 全包运行同时证明既有 runner 链路（含 typecheck 配置）未受影响；`tsc` 与根 `pnpm typecheck` 均 exit 0。

---

## 15. Unknowns and blockers

| 项 | 状态 | 处置 |
|---|---|---|
| kind=1 超时的 aborted 发射（终局失败族） | 规范边界：§23.1 明文终局失败族不发 aborted；slice 2 现状为零 | 契约不锁该行（§12.3-1），仅锁终局面与成功型归零；SA1 设计应按 §23.1 明文收口 |
| epoch-fence 的 aborted reason 归类（connection-teardown 可能覆盖） | 有效但不阻塞 | N9 只锁丢弃效果/零残留/终态；R8 锁 GOAWAY→connection-teardown 明确行 |
| SA8 前置门禁缺失（本 iteration 无 conflict report/design/relevant_decisions） | 环境事实 | 契约约束改由 ADR 0019 + 协议 §23 + 源码 deferral 注释显式登记（§3）；不阻塞契约可执行性 |
| 新旧互通矩阵 | issue body 显式排除（ADR 0019 非目标） | 契约零互通断言 |
| R2 末条 wire 计数断言与既有 round 的 `SYNC_APPLIED` 混同（SA3 §8-2 阻塞） | **已消解**（Revision R1，§17）：判别式改为 `ackedSequence` 精确锚定；修订版契约实现前 8 红（R2 在观测面断言处失败）/ 实现后 17 绿；mutation 敏感度已证 | 无遗留动作 |
| 阻塞项 | **无** | — |

---

## 16. Temporary diagnostics cleanup

- 临时探针文件 `packages/ws-replication/test/ws-replication-issue301-probe.test.ts`（P1–P13 诊断/矩阵探针）**已删除**；`git status --porcelain` 现仅含：新增契约文件 + Host 简报快照 `wiki/raw/task_issue-301.md`（固定输入，非本 SA6 产出）。
- 未修改任何生产实现文件（`packages/**/src/**` 零改动）；未改 #300 契约文件、刻画文件与既有测试（`git diff` 空）。
- **Revision R1 追加清理**：诊断探针插入（契约 R2 内的 `console.log('SA6-PROBE-R2' …)`）**已删除**（`grep TEMP-SA6-PROBE\|SA6-PROBE-R2\|console.log` = 0 命中）；断言敏感度 mutation 临时副本 `packages/ws-replication/test/tmp-sa6-r2-anchor-mutation.test.ts` **已删除**；基线对照用的 `git stash` 临时回退已 `pop`（`git stash list` 空，`git status` 与实施前逐项一致），5 个实现文件 md5 在 stash/pop 前后逐字相同（`types.ts 912350fc…`、`bulk-transfer.ts 2089bfe4…`、`hub-namespace.ts 200744a0…`、`peer-namespace.ts 935c3fcf…`、`round-engine.ts dead8d68…`）——SA6 对生产实现零净改动。
- 未启动常驻服务、无后台作业遗留（Revision R1 的 vitest/typecheck 后台作业均已 `job_output` 回收）；未使用 nohup/setsid/PID 文件；无环境变量 override 遗留。
- 报告与契约文件为本 SA6 的固定产物；未 commit/push。

---

## 17. Revision R1 — SA3 记录的 R2 阻塞消解（contract-only）

### 17.1 阻塞陈述（SA3 `task_issue-301_sa3_impl.md` §8-2）

契约 R2 末条断言（原 L710–713）`expect(syncApplied).toHaveLength(1)` 要求 hub→peer 方向 `SYNC_APPLIED` **全局恰一笔**；而 R2 构型下该方向存在两笔：

- round 1（bootstrap 后初始 round，2 字节 diff）：`SYNC_APPLIED`，`ackedSequence=5`、`syncRoundId=1`；
- round 2（本票关注的 kind=2 分块恢复 round）：`SYNC_APPLIED`，`ackedSequence=21`（= kind=2 末 chunk 帧序）、`syncRoundId=2`。

### 17.2 独立复现与根因（诊断，非接受 SA3 结论）

| Step | Fact | Evidence | Confidence |
|---|---|---|---|
| 症状 | 实现在场时契约 `1 failed \| 16 passed`；R2 在旧 L712 处失败 `expected [ Array(2) ] to have a length of 1 but got 2`；R2 的全部 observer 断言（sent/applied/acked/syncRoundId/改道归零）此前已通过 | 本次复跑 vitest 输出 | 高 |
| 直接故障点 | 断言把「分块 round 的单 ACK 锚末 chunk 帧序」错误表达为「hub→peer 全部 `SYNC_APPLIED` 计数 = 1」；判别维度选错（总数 vs `ackedSequence`） | 断言文本 + 帧实测 | 高 |
| 触发条件 | bootstrap 完成后初始 round 必然产生一笔普通单帧 diff 的 `SYNC_APPLIED`；分块恢复 round 再产生第二笔 | 探针 `applied:[{acked:5,round:1},{acked:21,round:2}]` | 高 |
| 最深根因 | 契约（SA6 iteration 0）未把「既有 round 的 ACK」从分块 round 的 ACK 中判别剔除；与生产实现无关（基线逐帧全等） | 基线对照实验（§17.3） | 高 |
| 排除项 | 实现引入多余 `SYNC_APPLIED` / wire 回归 / 测试入口或环境伪红 | 基线 stash 对照两帧 JSON 逐字相同；全包 516 绿 | 高 |

### 17.3 因果实验（控制变量：仅回退生产实现）

临时探针（已删）在 R2 中打印 hub→peer 全部 `SYNC_APPLIED` 与锚定计数：

| 运行 | 探针输出 |
|---|---|
| SA3 实现在场 | `{"lastChunkSeq":21,"applied":[{"acked":5,"round":1},{"acked":21,"round":2}],"anchoredByAckedSequence":1}` |
| `git stash push -- packages/ws-replication/src`（基线 `0f3eca5`） | `{"lastChunkSeq":21,"applied":[{"acked":5,"round":1},{"acked":21,"round":2}],"anchoredByAckedSequence":1}` |

⇒ 两帧、帧序、`ackedSequence`、`syncRoundId` 逐字相同：该 2 帧计数是**基线 wire 行为**（round 引擎既有语义），非本票实现产生；`ackedSequence` 判别式在基线与实现下均为 1，是应被**保持**的 wire 不变量。SA3 §8-2 的事实陈述与所提修订方向成立。

### 17.4 规范依据（为何 `ackedSequence` 是正确判别式）

- `docs/protocols/instance-replication-v1.md` §9.2 L246：`SYNC_APPLIED.ackedSequence = SYNC_STEP2 sequence（分块 diff 时为末 chunk 帧序——单 ACK 结算，对齐 §10.3）` ⇒ 「分块 round 的 ACK」的规范身份就是 `ackedSequence` 等于末 chunk 帧序，而非该方向 ACK 的总数。
- §23.1 `chunked-sync-acked` 行：语义为「**末 chunk 帧序的单 SYNC_APPLIED** 收妥结算（发送侧）」——同一判定口径的事件面投影（R2 已独立断言该事件恰一）。
- 不选 `syncRoundId` 过滤：`ackedSequence` 才是本断言要验证的规范字段（「锚定末 chunk 帧序」）；仅按 round 过滤并不检查被 ACK 的帧序，反而丢掉原断言的验收内核。

### 17.5 最小修订（contract-only，验收覆盖保持）

```diff
-      // 单 ACK 锚末 chunk 帧序（§9.3）
-      const syncApplied = onlyKind(ctx.frames('hubToPeer'), 'SYNC_APPLIED') as SyncAppliedMsg[];
-      expect(syncApplied).toHaveLength(1);
-      expect(syncApplied[0]!.ackedSequence).toBe(kind2[kind2.length - 1]!.sequence);
+      // 单 ACK 锚末 chunk 帧序（§9.3）。判别式 = ackedSequence（= kind=2 末 chunk 的 wire 帧序）：
+      // bootstrap 完成后的初始 round 会在同一方向产生一笔既有 SYNC_APPLIED（基线 wire 行为，
+      // 与本票无关），故不得按 SYNC_APPLIED 总数计数，须以 ackedSequence 精确锚定分块 round。
+      const syncApplied = onlyKind(ctx.frames('hubToPeer'), 'SYNC_APPLIED') as SyncAppliedMsg[];
+      const anchored = syncApplied.filter((m) => m.ackedSequence === kind2[kind2.length - 1]!.sequence);
+      expect(
+        anchored,
+        'R2：kind=2 分块 round 必须以恰一笔 SYNC_APPLIED 锚定末 chunk 帧序（ackedSequence 判别，排除既有 round 的 SYNC_APPLIED）',
+      ).toHaveLength(1);
```

**覆盖评估（保留 / 不新增 / 不弱化）**：

- **保留**：分块 round 必须收到**恰一笔**、且 ACK 的正是末 chunk 帧序（`ackedSequence`）的 `SYNC_APPLIED`——与原断言语义同值，仅剔除既有 round 帧的混同；`syncApplied[0]!.ackedSequence === …` 的个别相等断言被过滤式断言蕴含，无信息损失。
- **不新增**：不断言 round 1 那笔既有 `SYNC_APPLIED` 的存在/数量（基线固有行为，不在本票契约面），故不会把非本票行为锁进契约。
- **不弱化**：计数仍为**恰好 1**（非 `toContain`/`≥1`）；若实现漏发分块 round 的 ACK、ACK 错帧序、或对同一末 chunk 发多笔 ACK，`anchored` 分别为 0 / 0 / >1，契约均失败（§17.6 mutation 实证）。R2 的其余 3 类事件断言、syncRoundId 投影、改道归零断言与 N1–N9 零变化。
- **红/绿边界不变**：修订版契约在实现前仍 8 红（R2 因 `chunked-sync-sent` 零发射失败——即本票能力缺口），实现后 17 绿。

### 17.6 修订后验证证据

| 验证 | 命令/方法 | 结果 |
|---|---|---|
| 实现在场契约 | `vitest run <契约文件>` | **17 passed (17)**；连续 4 次运行均 17/17 |
| 全包回归 | `vitest run packages/ws-replication/test --typecheck.enabled=false` | **71 文件 / 516 passed (516)，0 failed** |
| 包类型 | `tsc -p packages/ws-replication/tsconfig.json` | exit 0 |
| 根类型门 | `pnpm typecheck`（14 tsconfig） | exit 0 |
| 实现前基线（修订版契约） | stash src → 同命令 | **8 failed \| 9 passed**；R2 失败于 `chunked-sync-sent`（能力缺口），8 条消息与 §13.1 逐字一致 |
| 断言敏感度 mutation | 临时副本把判别式改为 `末 chunk 帧序 + 1` | **1 failed \| 16 passed**；R2 恰在锚定断言处失败（`expected [] to have a length of 1 but got +0`）——断言非恒真；副本已删 |
| 生产实现零改动 | md5 前后比对 + `git status` | 5 个实现文件 md5 逐字不变；`git stash list` 空 |

**结论**：SA3 记录的阻塞成立且已由 contract-only 最小修订消解；修订不放松任何验收断言、不新增非本票约束、不触碰生产实现。

---

## Verdict

**approve（Revision R1 复核后维持）。** issue #301 的能力缺口经真实双端 harness 稳定复现：8 型 `chunked-snapshot-*`/`chunked-sync-*` observer 事件在实现中零发射点（类型面 + 发送/接收/aborted 发射点四处结构性缺失，源码 deferral 注释明文归本票），且 slice 2 已把普通族改道归零 ⇒ 分块 snapshot/sync 在观测面完全不可见（§5/§8）。验收契约把 AC1–AC5 与 ADR 0019/协议 §23 的冻结字段集、改道纪律、超时两向收口、assembly 丢弃与安全字段纪律转成 8 条可执行红灯 + 9 条当前即绿的生命周期/调度/等价性负控；红灯全部因能力缺失而失败、且均在对应前置断言通过之后（§13），负控与既有 499 条断言零回归，测试入口真实（`packages/*/test/**/*.test.ts`），类型检查（包 + 根）全绿。Revision R1 针对 SA3 §8-2 记录的 R2 末条 wire 计数断言完成最小修订：判别式由「`SYNC_APPLIED` 总数」改为「`ackedSequence` = kind=2 末 chunk 帧序」（§9.2 L246 规范身份），基线/实现两向对照证明既有 round 的 ACK 为基线固有行为；修订版契约实现前 8 红（R2 在能力缺口断言处失败）、实现后 17 绿、全包 516 绿、mutation 证明锚定断言敏感（§17）。未见阻塞项；转绿判据已显式给出（§13）。
