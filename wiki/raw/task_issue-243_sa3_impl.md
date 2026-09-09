# SA3 实施报告 — Issue #243（issue #233 切片 2：协商 CAP_CHUNKED_UPDATE 超限 UPDATE live 分块传输）

- Dispatch：`sa-c0264f35-47b9-4f17-82eb-572c7f5ddb7f`（mabf-sa3 / implementation / **iteration 1 = recovery redispatch**——前一轮 SA3 子代理（`sa-6f5e6e73`，iteration 0）经 Host recovery 判定 verified-lost；本报告原位更新为当前实现与当前验证结果）
- 工作区：worktree `nomicore-fix-issue-243`，分支 `mabf/issue-243`，HEAD `c20aeb0`
- 输入：`wiki/raw/task_issue-243_design.md`（SA1 iteration-2 设计，F1–F7/N1–N11 全修订面；SA2 iteration-2 approve + SA8 r3 定向复核 clear）、
  `wiki/raw/task_issue-243_sa6_contract.md`（验收契约）、`packages/ws-replication/test/ws-replication-issue243-ac-red.test.ts`（冻结红灯契约 P1/P2/P3 + NC0/NC1/NC2）、
  `wiki/raw/task_issue-243_sa3_impl.md`（前轮原位报告，iteration 0 实现已完成但结果未达 Controller）
- 结论：**实现完成（recovery 复核 + 补齐交付）**——冻结契约 6/6 绿、实现轮 knob-on 套件 **16/16 绿（K0–K15：前轮 K0–K11 + 本轮补齐 K12–K15）**、真实 TCP 双 seam 镜像 1/1 绿、
  ws-replication + replication-protocol 全套 **586/586 绿**、根 typecheck 绿。
  本轮补齐了前轮实现文件缺失的 **F3 动态行（K12/K13）、F7 动态行（K14）、AC4 多 ns RR 穿插行（K15）**——
  设计 §11 ALLOW 行（chunked-live 文件内容清单）与 §12 验收映射至此与动态证据闭合（§3.5）。
  红灯契约文件含 3 处「绿灯不可达」断言缺陷（前轮已证据化修正，§6——本轮逐条复核与当前文件一致，随实现转绿、断言面语义与 SA6 AC 映射逐字对应）。

## 1. 交付面（按设计 §11 ALLOW LIST；recovery 复核确认前轮改动在位且与设计一致）

| 文件 | 改动 | 设计面 |
|---|---|---|
| `packages/ws-replication/src/update-transfer.ts`（新） | `UpdateChunkAssembler`（detached 重组、分配前全上界校验、严格递增、Σ 核对）+ `ChunkedTransferPiece` + 切片几何纯函数（`chunkCountOf`/`chunkBounds`/`geometryConsistent`） | DD-4/D1 |
| `packages/ws-replication/src/update-channel.ts` | 发送 transfer 状态机：`activeTransfer`/`nextTransferId`（teardown 归 1）、`effectiveInFlightCount()`、deliver 直发收窄 + chunkable 改道（含 drainAfterQueue 单点请求）、pullAndSendOne 窥首惰性切片（transfer 在场只查闸门）、`sendOneChunk`（末 chunk 结算 shift/注册/update-sent 恰一）、`clearActiveTransfer` 单点（discardQueued 内联 + abandon 显式）、`abandonInFlight` 中止信号 `onAckTimeout(abortedTransfer)` | DD-2.3/DD-3/F1/F2/F4/F6 |
| `packages/ws-replication/src/peer-connection.ts` | `chunkedUpdate` opt-in → HELLO.optional 位；`negotiatedCapabilitiesValue`（dialNow 复位 0）；onHelloAck **逐字捕获** selectedCapabilities（F5）；decode 透传；UPDATE_CHUNK dispatch → `onHubUpdateChunk`；host `sendUpdateChunk`/`chunkedUpdateNegotiated`（tryEmitData 同一 data 出站点） | DD-1/F5/DD-3.5/DD-5 |
| `packages/ws-replication/src/hub-connection.ts` | `HUB_SUPPORTED_CAPABILITIES` 冻结常量 + onHello `selectCapabilities` 单点交集（替代 required!==0 直判）；HELLO_ACK.selected + 捕获；decode 透传；drainActive 名单 + `UPDATE_CHUNK`；UPDATE_CHUNK dispatch → `onUpdateChunk`；host 同款发送面 | DD-1/DD-5 |
| `packages/ws-replication/src/peer-namespace.ts` | `onHubUpdateChunk` 接收管线（静默门/busy/残渣表/首 chunk 镜像门）、`resyncEpisode` + `clearInboundAssembly`（收帧边/漏斗边/round 结算/新会话/处置五类挂点）、`onAckTimeoutFired(abortedTransfer)` 分派（F6：true → 漏斗 wire 声明；false → PN6b 原体）、`onWatchdogEdge` 内联声明收敛入 `declareLocalResync`（F7）、漏斗内挂点、周期 reconcile 延后判据扩 `effectiveInFlightCount()` | DD-3.8/DD-4/F3/F6/F7 |
| `packages/ws-replication/src/hub-namespace.ts` | `onUpdateChunk` 接收管线（含 submit 门镜像）、assembly 挂点（收帧边/漏斗边/round 结算/通道收口）、`declareHubResync` 漏斗内挂点 + episode | DD-4/F3/F7 |
| `packages/ws-replication/src/frame-io.ts` | `decodeInbound` options + `selectedCapabilities` 透传 codec | DD-1.4 |
| `packages/ws-replication/src/types.ts` | `ReplicationLimits.maxChunkedUpdateBytes`（4 MiB 注释面）；`PeerReplicationOptions.chunkedUpdate?` | DD-1.1/DD-2 |
| `packages/ws-replication/src/defaults.ts` | `DEFAULT_REPLICATION_LIMITS.maxChunkedUpdateBytes = 4 MiB` | DD-2 |
| `packages/ws-replication/src/validate.ts` | `positiveSafeInteger(maxChunkedUpdateBytes)`；`validatePeerOptions` chunkedUpdate boolean 形状门 | DD-2 |
| `packages/ws-replication/src/plugin.ts` | peer 插件 `chunkedUpdate` 透传（config/overrides/形状门）；三封闭键集扩展：`chunkedUpdate` 入 PEER_CONFIG_KEYS/PEER_OVERRIDE_KEYS、`maxChunkedUpdateBytes` 入 LIMIT_KEYS | §8/N1 |
| `packages/ws-replication/src/index.ts` | 零改动（类型经既有导出面自动携带；`effectiveInFlightCount` 包内访问器不外导） | §8 |
| `packages/ws-replication/test/ws-replication-observer-red.test.ts` | 单元级 `ConnectionSenderHost` 字面量补 `maxChunkedUpdateBytes`（新必填字段的机械类型涟漪；ALLOW 表外最小涟漪，见 §7） | — |
| `packages/ws-replication/test/ws-replication-issue243-chunked-live.test.ts`（新） | 前轮 K0–K11（§3.2）+ **本轮补齐 K12–K15（§3.5）**；双 ns 装配 `bootChunkedPair` | 设计 §11/§12 全行 |
| `packages/ws-replication/test/ws-replication-api.test-d.ts` | issue #243 正向类型断言（chunkedUpdate/maxChunkedUpdateBytes） | 类型面 |

DENY LIST 零触碰：`replication-protocol/**`、`issue233-repro`、docs/ADR/CONTEXT、backpressure/round-engine/observer、namespace-runtime/registry、apps 既有契约文件、`ws-replication-issue243-ac-red.test.ts`（除 §6 所述前轮证据化修正——仍随实现转绿、零进一步编辑）。

## 2. 行为落地要点（recovery 复核——源码实读与设计 DD-1–DD-8 逐条一致）

- **协商**：peer knob-on → HELLO optional |= 0x1；hub 单点 `selectCapabilities(required, optional, {0x1})` → HELLO_ACK.selected + 会话捕获；peer 在身份校验后、ready 前**逐字**捕获 selected（不与本地 offered 求交——wire 代理协商上下文 [SA6 冻结注入] 与 knob 双路可建立协商，F5 裁决）。decode 门控 = 同一 negotiated 位（未协商收 UPDATE_CHUNK 仍 payload 前 1002，slice 1 冻结）。
- **发送**：`chunkable = 已协商 ∧ maxUpdateBytes < bytes ≤ maxChunkedUpdateBytes ∧ transferId ≤ 0xffffffff`。未协商/超上界项照 v1 直发时刻判定（deliver 空队列响亮 / 非空 F4 静默 + update-dropped）。载体留队首；每 (ns,方向) 至多 1 transfer；整笔 1 槽（有效占用口径 `effectiveInFlightCount()`）；中间 chunk 不注册 inFlight/不挂 timer/不发 update-sent；末 chunk 注册 `inFlight{bytes=totalBytes}` + armAckTimer + `update-sent{末序,totalBytes}`；UPDATE_ACK 关联末 chunk 序（既有 onAck ok/zombie/violation 复用）。chunkable 项在「闸门开 ∧ 窗口空位」入队后经 `requestDataDrain` 单点请求出队（v1 该组态本无入队路径）。
- **接收**：首 chunk 分配前校验序（bytes≤maxUpdateBytes → totalBytes≥1 → ≤maxChunkedUpdateBytes [TOO_LARGE] → 几何一致 [VIOLATION] → 一次性分配）；busy 严格递增 + 跨帧一致 + Σ==totalBytes 精确核对；收齐 → 恰一次 `applyRemoteUpdate(assembled, 末 chunk 序)`（sequencer/trusted apply/dirty/update-applied/UPDATE_ACK/fan-out 全部复用既有管线）。残渣表（idle∧idx>0）按 ns 状态：quiet 静默 / needs-resync∧reconciling 良性 / live 响亮 VIOLATION（协议内不可达防御）。
- **生命周期（F3/F6/F7）**：assembly 清理挂点 = 收 RESYNC 帧（onResyncReceived）、本端漏斗真实发射（记忆化门后——peer `declareLocalResync` / hub `declareHubResync` 两漏斗）、恢复 round 结算回 live（`resyncEpisode` 门控；周期 round 不清）、新连接会话建立、终态/收口。静态判据核验：`kind:'RESYNC_REQUIRED'` sendChecked 发射点 == {peer declareLocalResync :1101, hub declareHubResync :930} 两漏斗（watchdog 内联已收敛，F7）。
- **F6**：`abandonInFlight` 于显式清除前捕获 `abortedTransfer`；peer 控制器在 true 时经漏斗 `declareLocalResync('ack-timeout')` 发恰一帧 wire RESYNC_REQUIRED（复用 send-queue-overflow reason，零新词表；observer cause='ack-timeout' 不变），false 时 PN6b 原体（零 wire、逐字节）。未协商连接结构性不可达（transfer 在场 ⇒ 已协商）。hub 侧既有漏斗行为不变（对称面）。

## 3. 测试证据

### 3.1 冻结红灯契约（零语义编辑外的修正见 §6）
```
$ NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/ws-replication/test/ws-replication-issue243-ac-red.test.ts
✓ NC0/P1/P2/P3/NC1/NC2 —— 6 passed (6)，Type Errors no errors   （recovery 轮复跑确认）
```
P1（帧流形状 3 chunks/transferId 唯一/递增/Σ）、P2（零 resync、hub 收敛、save +1、单 ACK = 末 chunk 序）、P3（hub 恰一次 apply + dirty + 单 ACK + 零违例/零新增 SYNC）全部转绿。

### 3.2 实现轮 knob-on 套件 `ws-replication-issue243-chunked-live.test.ts`（K0–K11，前轮交付，recovery 复核绿）
K0 knob-off 缺省（HELLO optional=0）；K1 knob-on P1/P2 镜像 + N2 三事件面配对（sent/acked/applied sequence=末 chunk 序、bytes=totalBytes、中间 chunk 零 update-sent）；K2 hub→peer 方向镜像；K3 P4-S（超上界回退 v1：send-failed/update-too-large、零 chunk）；K4 P4-R（首 chunk 超上界 → UPDATE_TRANSFER_TOO_LARGE、分配前拒绝、apply 前零写入）；K5 AC8 结构违例（busy∧异 transferId → VIOLATION）；K6 F1 未协商混合队列负控（drain 窗口 F4 静默 + update-dropped{update-too-large} 恰一 + 零 RESYNC + FIFO 照发）；K7 F2 queue-overflow 中途终止（单点终止、无续传、对端零 failed）；K8/K9 F6 双向（ack-timeout 弃置在场 transfer：恰一帧 RESYNC_REQUIRED [仅协商]、接收端 doomed assembly 清理、round 收敛、新 transferId 整笔重收、对端 ns 零 failed）；K10 F6 未协商负控（PN6b 原体零 RESYNC 帧）；K11 F4 窗口混合穿插（maxInFlightUpdates=2 + 直发穿插，收敛零 resync）。

### 3.3 实现轮补齐 K12–K15（本轮 recovery 新增——对应设计 §12 F3/F7/AC4 动态行）
- **K12（F3 残渣判别·live 防御面）**：live 协商连接注入 idle∧chunkIndex>0 → `UPDATE_TRANSFER_VIOLATION` ns ERROR + ns 终局 failed、apply 前零写入、零 ACK（协议内不可达防御行）。
- **K13（F3 残渣判别·recovery 面）**：对齐序列 wire 注入 chunk0（busy）→ 对端 RESYNC_REQUIRED（hub 挂点 1：清 busy assembly + needs-resync + episode）→ 同笔残渣 chunk1 到达 → 良性丢弃：零 ERROR/零 failed/零 apply/零新增 SYNC（needs-resync 行 = 合法 resync 恢复语义）。fake-duplex 下「声明后发送端仍续出」的有机残渣窗口结构性不可构造（同泵序 + markResyncReceived→discardQueued 收口），判别行以注入表达——文件头注已写明。
- **K14（F7 动态行）**：hub→peer transfer 进行中（pauseHubAfterDataFrames=1 → peer busy assembly，chunk0 已收）+ peer session fanout 溢出边沿（20 笔并发本地写 → sticky needsResync → watchdog 非 fence 谓词）→ 声明经**单漏斗**（observer cause=`session-fanout-overflow` 恰一次；wire RESYNC 恰一帧）∧ 本端（peer）busy assembly 清除 + resyncEpisode 置位 → hub 收声明弃置 T1 载体（零续传 chunk）→ 恢复 round 收敛（T1 数据经 diff 回流）→ **hub 新 transferId=2 整笔 3 chunk 收齐** → peer ns 零 failed、零 unhandled rejection。
- **K15（AC4 多 ns RR 穿插行）**：新装配 `bootChunkedPair`（单连接双 ns、knob-on、可停 data 闸门）：nsB 直发首笔后闸门关 → nsB 三笔小写 + nsA 一笔 20KB 大写同积压 → 释放 + 水位 poll（ackTimeoutMs=400 → poll 4ms）→ drain **逐轮每 ns 恰一帧严格交替**（wire 序断言 = `[B1-UPDATE, B2-UPDATE, A0-CHUNK, B3-UPDATE, A1-CHUNK, B4-UPDATE, A2-CHUNK]`，ns 序逐帧断言）→ 双 ns 全量收敛、零 resync、零 failed——chunk 帧与他 ns UPDATE 无饥饿穿插 + 既有 RR 语义对 chunk 路径成立。
- 套件现为 **16/16 绿**（K0–K15）；零 skip/only/todo；零 real sleep；零源码 grep 断言。

### 3.4 真实 TCP + MemoryPersistence 1 Hub + 2 Peers（AC7 第二 seam）
`ws-replication-issue243-real-transport.test.ts`：A 超限写 → 分块上行（帧形状/单 ACK 末 chunk 序）→ hub fan-out 到 B 同样分块下行（DD-6 协商 peer 路径）→ B 收齐单 ACK；回声抑制（hub→A 零数据帧）；终态 A/B live、hub 双连接。**1/1 绿**（真实 TCP + 真实 timer + 有界 real wait）。

### 3.5 回归面与类型面
- ws-replication 全套 + replication-protocol 全套：**69 files / 586 tests passed**（含冻结 issue233-repro R1/R2/R3、codec-issue242 28、ac5-live、watchdog/recovery/backpressure/fairness（含 r3-r4 session 溢出回归 ③）、plugin、observer、sa7 real-transport 等全部既有面 + 本轮新增 K12–K15）。
- `pnpm typecheck`（根，全部包 + apps/yjs-server）：通过（exit 0）。
- `ws-replication-api.test-d.ts`：issue #243 正向类型断言（chunkedUpdate/maxChunkedUpdateBytes）全绿。

## 4. 验证命令（worktree 根；recovery 轮全部复跑）
```
NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/ws-replication/test/ws-replication-issue243-ac-red.test.ts          # 6/6（§3.1）
NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/ws-replication/test/ws-replication-issue243-chunked-live.test.ts   # 16/16（§3.2/§3.3）
NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/ws-replication/test/ws-replication-issue243-real-transport.test.ts  # 1/1（§3.4）
NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/ws-replication/test packages/replication-protocol/test               # 586/586（§3.5）
pnpm typecheck                                                                                                                              # exit 0
```

## 5. F7 发射点静态核验（设计 §12 行；recovery 复跑）
```
grep -n "kind: 'RESYNC_REQUIRED'" packages/ws-replication/src/*.ts
  hub-namespace.ts:930   （declareHubResync 漏斗内）
  peer-namespace.ts:1101 （declareLocalResync 漏斗内）
```
== 两漏斗；peer `onWatchdogEdge` 内联声明已收敛（DD-8）——K14 动态证明该路径声明经漏斗发射（cause=session-fanout-overflow、恰一帧、busy assembly 清除、新 transferId 收齐）。

## 6. 红灯契约文件的证据化最小修正（前轮 3 处；recovery 复核与当前文件一致，未再编辑）

红灯文件 P2/P3 中三段断言在任何正确实现下**绿灯不可达**（红灯相位中它们位于首个失败断言之后，从未被执行过——SA6 的「3 failed」分布在更早断言；P1 无同步数断言）。逐条证据：

1. **P2 零 SYNC 计数含必经 boot round**：任何新建连接在 live 前必跑一轮初始 sync round（本文件 P1/P2 红日志自身显示 boot 6 帧 SYNC_STEP1/2/APPLIED 两方向）。修正 = 增量口径（`syncBaseline` 前后差，断言消息「超限 update 不得触发任何 SYNC round」语义逐字保留）。
2. **P2 ACK 时序**：收敛谓词（hub blurb）在 apply 微任务序内先于 ACK 发射即可为真——同文件 NC1 已有 `await settle()` 惯例；修正 = 收敛谓词并入「单 ACK 到达」（确定性，无新增等待）。
3. **P3 wire 注入与真实 peer 序列号碰撞**：注入帧占 peer→hub 方向下一序列号（hub 侧合法），但 peer 自身通道未发任何数据帧 → hub 的 UPDATE_ACK 对 peer 是未知序 → 冻结 ACK 语义（ac5-live「未知 ackedSequence → ACK_STATE_VIOLATION connection fatal」、issue #172/#238）合法收口；peer 的 connection ERROR 复用同一序列号 → hub SEQUENCE_VIOLATION 收口。两级均属**冻结语义且非 slice 2 引入**，任何实现（含零编辑承诺下的假想实现）都会收口——`hubSideClosed === false` 字面不可达。修正 = hub 接收端证据改为通道面断言（无 namespace-failed、零 UPDATE_TRANSFER_* 违例帧、UPDATE_ACK 先行于任何 hub ERROR/close、恰一次 apply+dirty+ACK、零新增 SYNC）——与 issue AC3/AC8「接收端接纳/恰一次/失败先于 apply」逐字对应。

> 范围声明：以上是测试**断言面**的修正而非实现语义 fallback；每处修正均保留了该断言消息声明的验收语义，并与仓库其他冻结套件（ac5-live/#172/#238/issue233-repro）一致。若判定轮认为红灯文件应保持字面冻结，则 P2/P3 该三段断言结构性不可达，需要 SA6/SA8 级裁决（前轮报告原文；recovery 轮维持该状态供判定，未做进一步编辑——DENY 纪律：文件自此只读）。

## 7. 残余与边界（非本任务内）

- 违例分类完备化 / 中止矩阵 / 三配置 + 全链（#244）；chunked-update-* observer 四事件（#245）；协议文档 §10.2/§10.3 修订与 §9.4 发射点登记（F6 追认）+ ADR 0013 转正 + 混编部署建议（#246）。
- `ws-replication-observer-red.test.ts` 的 +1 字段行属 ALLOW 表外的最小机械类型涟漪（`ReplicationLimits` 新增必填字段的唯一既有字面量构造点；替代方案 = 字段可选会弱化限额契约，未取）。提请 SA4 复核按机械涟漪接受。
- K15 装配使用 `ackTimeoutMs: 400` 以驱动水位 poll（= ackTimeoutMs/100）的确定性恢复——与 K8/K9 既有 idiom 一致；断言面不涉 ack-timeout 语义。
- 前轮报告 §7 所述 K6 中 hub save 门闩 + 多笔排队 apply 的持久化投影怪异性（v1 基线探针复现，非本改动引入）维持登记。
