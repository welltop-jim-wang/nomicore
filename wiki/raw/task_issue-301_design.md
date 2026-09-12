# SA1 架构与实现设计 — issue #301（#295 切片 3）：分块 snapshot/sync 的 observer 8 型接线

- **dispatch**: sa-8039a70c-aa6b-40b4-8764-3f022dace9f8（mabf-sa1 / design / iteration 0）
- **任务类型**: **Feature**（ADR 0022 第三切片的观测面收尾——8 型 `chunked-snapshot-*` / `chunked-sync-*` observer 事件从零发射点接通；非 Bug，无根因修复）
- **上游产物**: SA6 验收契约 `wiki/raw/task_issue-301_sa6_contract.md`（**approve**，8 红 R1–R8 + 9 负控 N1–N9；契约文件 `packages/ws-replication/test/ws-replication-issue301-chunked-completeness-ac-red.test.ts`，1387 行 / 17 用例）
- **基线**: `0f3eca5`（`fix(#300): feat(#295 切片 2)`，PR #325 合并点；SA6 实测全包 70 文件 / 499 用例全绿）
- **SA8 产物**: 本 iteration **缺失**（`task_issue-301_conflict_report.md` / `_relevant_decisions.md` / `_design.md` 均不存在）——按 skill 纪律改由 ADR 0022 + 协议冻结文本 + slice 2 源码 deferral 注释显式登记约束（§4），并标记设计后冲突复查（§15）
- **Owner comments**: REST comments endpoint 返回空（任务简报 §Comments 与 SA6 §2 一致）——无 owner 补充要求

---

## 1. 任务模型（Feature：能力缺口）

**能力缺口**：ADR 0022 / 协议 §23.1 已冻结登记的第 29–36 型 observer 事件（8 型）在实现中**零发射点**——`types.ts` 判别联合止于第 28 型，hub/peer 双侧发送、接收、中止结算点均无对应发射；同时 slice 2 已把分块窗口内普通族（`bootstrap-snapshot-sent` / `bootstrap-imported` / `sync-step2-sent` / `sync-diff-applied`）改道归零 ⇒ 分块 snapshot / sync-diff 传输在 observer 事件流中**完全不可见**。

**目标**（本票范围内、SA6 契约可验收的部分）：

1. `ReplicationObserverEvent` 追加第 29–36 型判别成员（字段集逐字 = ADR 0022 L78–81 + 协议 §23.1 行 + §23 side 信封）；
2. 接通 8 个发射点：发送侧 sent（末 chunk 出站结算恰一）、发送侧 acked（单 ACK 收妥结算恰一）、接收侧 applied（apply 成功结算恰一、互斥六选一的第五/第六形态）、接收侧 aborted（busy→aborted 边沿恰一、kind 门泛化）；
3. 全部沿用 §23.3 safe-field、§23.4 隔离/时钟/「决策落定后发射」/「无 observer 逐字节等价」纪律。

**非目标**（边界与 SA6 §1/§3、ADR 0022 非目标对齐）：

- **零 wire 变化**：不动 0x42 codec/字段序、消息码、错误码注册表、RESYNC reason 词表、配置键与校验链（AC1–AC4 的生命周期/调度/恶意声明面已由 slice 2 交付且被 N1–N9 锁绿，本票不触碰）；
- **零新事件字段发明**：8 型字段集与 `ChunkedUpdateAbortReason` 六值闭集合全部为协议冻结值，本票是**接线**不是设计；
- 新旧互通矩阵（ADR 0022 非目标，issue body 显式排除）；kind=0 live-update 行为（全包回归锚）；`observer.ts` 白名单（事件型非稳定码，dispatch 无 per-type 白名单——issue #287 复审已明确域分离）；
- 不为 hub 侧结构不可达路径发明发射点（hub 无 kind=1 入站合法上下文——见 §7 OD6 注）。

## 2. Owner要求落实

| Comment ID | Updated at | Requirement | Design section |
|---|---|---|---|
| （无——issue #301 comments 为空） | — | 任务要求唯一来源 = issue 正文 AC1–AC5 + ADR 0022 + 协议冻结文本 | AC1–AC4 → §12 负控保持绿（零实现改动）；AC5 → §7 OD1–OD9、§12 R1–R8 转绿映射 |

## 3. 复现和根因承接（SA6 契约事实 → 设计响应）

| 上游事实 | 证据位置 | 设计响应 |
|---|---|---|
| 8 型事件恒零发射：类型面止于第 28 型 | SA6 §8 直接故障点 ①；`types.ts` L775–856 | OD1：追加第 29–36 型判别成员 |
| 发送侧零发射：hub `startBootstrap` kind=1 分支与 `sendStep2` kind=2 分支 enqueue 后零事件；`onBootstrapAck`/`onSyncApplied` 仅 `settle` 零事件；`BulkTransferSender` 无 sent/acked 结算回调面 | SA6 §8 ②；`hub-namespace.ts` L573–604/L632–652/L697–731；`peer-namespace.ts` L1538–1572；`bulk-transfer.ts` L188–202 | OD2（sent：`onLastChunkSent` 结算记录扩展 + 三调用点发射）、OD3（acked：`settle(kind)` 返回结算记录 + 三调用点发射） |
| 接收侧零发射：peer `finishBootstrapImport(..., emitImported=false)` 零替代事件；`applyRemoteUpdate` 的 `{syncChunked:true}` 分支仅抑制普通族 | SA6 §8 ③；`peer-namespace.ts` L609–618/L900；`hub-namespace.ts` L1446–1474；`peer-namespace.ts` L1725–1740 | OD4（kind=2：`{syncChunked:true, chunkCount}` + `chunked-sync-applied` 改道发射）、OD5（kind=1：`finishBootstrapImport` form 参数化 + `chunked-snapshot-applied` 发射） |
| aborted 仅 kind=0：`clearInboundAssembly` 的 `busyKind === 0` 门（源码注释明文「归 #301」） | SA6 §8 ④/§3 deferral；`hub-namespace.ts` L993–1016；`peer-namespace.ts` L952–978 | OD6：busyKind → 事件型选路泛化（双侧同构） |
| 普通族改道已落地 ⇒ 观测盲区由「新族缺失」单独造成 | SA6 §8 放大因素；N6/E1/E2 | 设计不改任何普通族发射点（单帧路径逐字节不变，N6 锚） |
| kind=1 超时属终局失败族，§23.1 明文不发 aborted（SA6 §12.3-1 解释边界） | 协议 §23.1 第 35 型行；SA6 §15 | OD7：`onAssemblyTimeout` 双侧 reason 选择（kind=1 → 无 reason） |
| 生命周期完备性/公平调度/恶意声明面已交付（N1–N9 当前即绿） | SA6 §6/§11 | 本票零生命周期实现改动；负控保持绿即回归门（§12） |
| 既有 70 文件 / 499 用例零回归基线 | SA6 §4 | §11 DENY LIST 锁定既有测试与共享锚；§13 论证 observer-red 矩阵零新事件 |

## 4. SA8约束落实（SA8 产物缺失——替代约束源）

| 决议或义务 | 来源 | 设计位置 | 处理方式 | 是否需要设计后冲突复查 |
|---|---|---|---|---|
| observer 8 型字段集冻结（sent：`connectionId?/namespaceId/transferId/chunkCount/totalBytes`（sync 另携 `syncRoundId`）；applied：`+bytes/chunkCount/applyLatencyMs?`（sync 另携 `syncRoundId`）；acked：`+bytes/ackLatencyMs?`（无 sequence/syncRoundId）；aborted：`namespaceId/transferId/reason/receivedChunks/receivedBytes`（无 connectionId）） | ADR 0022 L78–81；协议 §23.1 L749–754/L783–784 | OD1/OD2/OD3/OD4/OD5/OD6 | 逐字落地；键集冻结 = 无 sequence/四段差值/效果组/transferId（applied）/latency（sent） | 是（公共导出类型联合的加性变更 + 冻结面解释，§15） |
| sent = transfer 完成出站恰一（末 chunk 结算记账点，非逐 chunk）；applied/acked 每笔恰一；aborted 与成功型互斥 | 协议 §23.1 L746–754（kind=0 先例逐字平移） | OD2/OD3/§9 计数不变量表 | 结构性单点保证 | 否 |
| R21 改道平移：分块窗口普通族归零（本票只加不改） | §23.1 第 29–34 型「改道」子句 | §5 现状锚点；OD4/OD5 在既有抑制点原位替换 | 抑制点已由 slice 2 落地，本票替换为零事件处发射新族 | 否 |
| safe-field / secret-free / throw 隔离 / 无 observer 逐字节等价 / clock 缺省整键缺失 | §23.3/§23.4；ADR 0022 L83 | OD8 | 全部事件构造走既有 `emitObserver` + `dispatchReplicationObserver` 单点；latency 键条件展开 | 否 |
| 超时两向收口 / assembly 易失 / 恶意声明 / 公平调度 | ADR L49/L70；协议 §9.2/§10.3/§17 | 非本票改动面（§1 非目标） | 负控 N1–N9 保持绿 | 否 |
| `ChunkedUpdateAbortReason` 闭联合零新词 | §23.1 L783–784 | OD6 复用既有类型 | 零新词 | 否 |
| slice 2 显式 deferral：「kind=1/2 分块中止的对应事件类型归 #301」 | `hub-namespace.ts` L993–994 / `peer-namespace.ts` L953–954 注释 | OD6/OD7 | 本票兑付该登记 | 否 |

**SA8 门禁缺失处置**：上表约束全部改由 ADR 0022（已接受）+ 协议冻结文本 + 源码 deferral 注释显式登记；未发现相互矛盾。因涉公共 API 类型联合加性变更且存在两处冻结文本解释决策（§13-1/§13-2），按 skill「缺少 SA8 产物时……标记需要冲突复查」提交 `requiresConflictRecheck: true`（§15）。

## 5. 当前行为与证据锚点（基线 `0f3eca5`）

### 5.1 发送侧（sent/acked 现状）

- **hub `startBootstrap` kind=1 分支**（`hub-namespace.ts` L573–605）：`snapshot.byteLength > maxBootstrapBytes` 且已协商且 ≤ `maxChunkedBootstrapBytes` → `bulkTransfer.enqueue({kind:1, payload, binding, onLastChunkSent: seq => this.bootstrapSnapshotSeq = seq, onSendRejected, onAckTimeout})`；单帧路径（L606–626）`seq>0 && observerOn` 时发 `bootstrap-snapshot-sent`（本票不动）。
- **hub/peer `sendStep2` kind=2 分支**（`hub-namespace.ts` L697–731 / `peer-namespace.ts` L1538–1572）：`diff > maxSyncDiffBytes` 判据三态裁决 → `enqueue({kind:2, binding:{syncRoundId}, onLastChunkSent: seq => round.noteChunkedStep2Outbound(seq), ...})`；单帧路径发 `sync-step2-sent`（本票不动）。
- **`BulkTransferSender.pullOne`**（`bulk-transfer.ts` L150–195）：末 chunk 出站成功 → `phase='awaiting-ack'` → **同一同步栈**调 `onLastChunkSent(seq)`（L188–193）——这是 §23.1「末 chunk 结算记账点」的现成结构锚；kind=2 随即 `armAckTimer()`。
- **`settle(kind)`**（L197–202）：awaiting-ack 且 kind 匹配 → `disposeCurrent()` 归 idle，返回 void；zombie 迟到 ACK（载体已弃置/超时拆 timer）→ 早退 no-op。
- **hub `onBootstrapAck`**（L632–652）：状态门 + `ackedSequence === bootstrapSnapshotSeq` 核对（违例 → `connectionFatal('ACK_STATE_VIOLATION')`）→ `clearTimer` + `bulkTransfer.settle(1)` + `setState('reconciling')`——零事件。
- **hub/peer `onSyncApplied`**（`hub-namespace.ts` L679–688 / `peer-namespace.ts` L664–673）：quiet 门 → `round.onApplied(message)`（违例经 `onViolation` → `SYNC_STATE_VIOLATION` + failed）→ `bulkTransfer.settle(2)`——零事件。

### 5.2 接收侧（applied 现状）

- **peer `finishBootstrapImport`**（`peer-namespace.ts` L556–637）：detached `Y.applyUpdate` 校验 → `registry.importReplica`（排他复制导入）→ epoch 判别 → `emitImported && observerOn` 时发 `bootstrap-imported`（L610–618）→ `tryOpenReplicationSession` → `BOOTSTRAP_ACK{ackedSequence=anchorSequence}` → reconciling + startRound。调用点两处：单帧 `onBootstrapSnapshot` 传 `true`（L544–547）；kind=1 完成点 `handleAssemblerResult` 传 `false`（L900）——分块路径**零事件**。
- **`applyRemoteUpdate` 第 5 参 `chunked`**（`hub-namespace.ts` L1378–1490 / `peer-namespace.ts` L1645–1789）：`Readonly<{chunkCount:number}> | Readonly<{syncChunked:true}>`。isStep2 分支中 `{syncChunked:true}` → **仅抑制** `sync-diff-applied`（hub L1446–1458 / peer L1728–1741，窗口内归零、零替代事件）；kind=0 形态 `{chunkCount}` → 发 `chunked-update-applied`（先例锚，本票不动）。peer 侧 degraded 判别先行胜出（L1703，R23）；t0/t1 采样点在位（L1660/L1714）。
- **`round.completeChunkedStep2(update, lastChunkSequence)`**（`round-engine.ts` L221–229）：`chunkedStep2RoundId`（admit 时捕获）→ `applyStep2Safely(..., 'syncChunked')` → `RoundHost.applyStep2(update, step2Sequence, syncRoundId, form?)`（L52–57）→ 宿主 `applyStep2` 转 `applyRemoteUpdate(..., form==='syncChunked' ? {syncChunked:true} : undefined)`（hub L1340–1352 / peer L1604–1617）。**`UpdateChunkAcceptResult.complete.chunkCount` 在双侧 `handleAssemblerResult` 调用点被丢弃**（hub L942 / peer L906）——kind=2 applied 事件的 chunkCount 需新穿线。

### 5.3 中止侧（aborted 现状）

- **`clearInboundAssembly(reason?)`**（`hub-namespace.ts` L995–1016 / `peer-namespace.ts` L955–978，双侧同构）：`reason !== undefined && observerOn && busy && busyKind === 0` 才快照+发射 `chunked-update-aborted`；kind=1/2 中止零事件（注释明文归 #301）。
- **reason 置位点全集**（既有挂点，本票零改动即自动继承）：`'timeout'`（`onAssemblyTimeout` 双侧）、`'channel-teardown'`（`onCloseRequest` 双侧 / peer `removeTarget`）、`'connection-teardown'`（peer `onConnectionLost`/`onConnectionFatal`/`onConnectionStopped`；hub 收口）、`'epoch-fence'`（hub `oneShotTerminal()`（`onWatchdogEdge` 漏斗）L1197 / peer `onIdentityChanged` L1054——last-writer-wins：连接随后收口可覆盖为 connection-teardown，§23.1 既有裁决）、`'resync-declared'`（`onResyncReceived` / declare 漏斗）、`'shed'`（`declareHubResync('connection-shed')` / peer 对应漏斗）。终局失败族（`transferViolation`/`bindingViolation`）clear 不带 reason——§23.1「终局失败族不发本事件」已正确落地。
- **`onAssemblyTimeout`**（hub L1839–1859 / peer L2251–2278）：busy 门 → 捕获 `busyKind` → `clearInboundAssembly('timeout')` → kind=1 分支 `BOOTSTRAP_FAILED` + `finalize('failed','bootstrap-timeout',assemblyTimeoutMs)`（终局）；kind=0/2 分支 `RESYNC_REQUIRED{UPDATE|SYNC_TRANSFER_EXPIRED}`（非终态）。
- **assembler 事实源**：`UpdateChunkAssembler.snapshot()`（`update-transfer.ts` L157–166）返回 `{transferId, receivedChunks, receivedBytes}`（kind 无关）；`busyKind`（L151–153）。

### 5.4 观测基建现状

- `dispatchReplicationObserver`（`observer.ts` L36–46）：try/catch 静默隔离单点；无 per-type 白名单（事件型非稳定码）。
- `cidField`（L113–117）：connectionId 缺省 = 字段不存在。
- `host.now`（连接层）：`observer() !== undefined` 门控 + safeNow 折叠——无 observer ⇒ 零时钟调用（§23.4 已登记）。
- `ws-replication-api.test-d.ts` L240–279：`ReplicationObserverEvent` **全联合镜像** `toEqualTypeOf` 精确断言（现 28 型，标题文案「26 型」已滞后）——追加 8 型后必须同步扩展，否则 typecheck 红。
- `ws-replication-observer-red.test.ts` `assertSafe`（L1270–1293）：per-type `ALLOWED_KEYS` 白名单，未知型响亮红；该文件分块腿只压 `maxUpdateBytes`（8KiB，kind=0 live-update），`maxBootstrapBytes`/`maxSyncDiffBytes` 保持缺省（4MiB/2MiB）⇒ 其场景**不进入** chunked snapshot/sync 窗口，8 型不在其可达面（零回归论证，§13-6）。

## 6. 能力缺口（承接 SA6 §8，设计视角压缩重述）

类型面（联合缺 8 型）→ 发送侧（sent/acked 结算回调面缺失）→ 接收侧（applied 抑制点无替代发射、chunkCount 穿线断链）→ 中止侧（kind 门锁死 kind=0）。四个故障点全部是「既有结算结构已就位、事件未接线」——**设计因此是纯观测面接线，零协议/状态机/生命周期改动**。

## 7. 设计决策（OD1–OD9）

### OD1 · 类型面：`types.ts` 追加第 29–36 型判别成员

在 `ReplicationObserverEvent` 联合第 28 型（`chunked-update-acked`）后追加（同步更新联合头部文档注释「28 型 → 36 型」与 issue #295 出处标注）：

```ts
// ── issue #301 / #295 切片 3（append-only 第 29–36 型；ADR 0022 L78–81 + 协议 §23.1
//    第 29–36 型行；字段集对齐既有 chunked-update-* 四型；side 信封按 §23.1 行取值：
//    snapshot 成功三型 side 为字面量（snapshot 恒 hub→peer，对齐 bootstrap-snapshot-sent/
//    bootstrap-imported 先例）；sync 四型与 snapshot-aborted 为 ReplicationObserverSide
//    （hub/peer 双侧可达，对齐 chunked-update-aborted 先例——hub 侧 kind=1 入站结构不可达
//    属防御面，类型不收紧）──
| { readonly type: 'chunked-snapshot-sent';    readonly side: 'hub';  readonly connectionId?: string; readonly namespaceId: string; readonly transferId: number; readonly chunkCount: number; readonly totalBytes: number; }
| { readonly type: 'chunked-snapshot-applied'; readonly side: 'peer'; readonly connectionId?: string; readonly namespaceId: string; readonly bytes: number; readonly chunkCount: number; readonly applyLatencyMs?: number; }
| { readonly type: 'chunked-snapshot-acked';   readonly side: 'hub';  readonly connectionId?: string; readonly namespaceId: string; readonly bytes: number; readonly ackLatencyMs?: number; }
| { readonly type: 'chunked-snapshot-aborted'; readonly side: ReplicationObserverSide; readonly namespaceId: string; readonly transferId: number; readonly reason: ChunkedUpdateAbortReason; readonly receivedChunks: number; readonly receivedBytes: number; }
| { readonly type: 'chunked-sync-sent';    readonly side: ReplicationObserverSide; readonly connectionId?: string; readonly namespaceId: string; readonly transferId: number; readonly chunkCount: number; readonly totalBytes: number; readonly syncRoundId: number; }
| { readonly type: 'chunked-sync-applied'; readonly side: ReplicationObserverSide; readonly connectionId?: string; readonly namespaceId: string; readonly bytes: number; readonly chunkCount: number; readonly syncRoundId: number; readonly applyLatencyMs?: number; }
| { readonly type: 'chunked-sync-acked';   readonly side: ReplicationObserverSide; readonly connectionId?: string; readonly namespaceId: string; readonly bytes: number; readonly ackLatencyMs?: number; }
| { readonly type: 'chunked-sync-aborted'; readonly side: ReplicationObserverSide; readonly namespaceId: string; readonly transferId: number; readonly reason: ChunkedUpdateAbortReason; readonly receivedChunks: number; readonly receivedBytes: number; }
```

键集冻结依据：sent 无任何 latency/sequence 键；applied 无 `transferId`/`sequence`/四段差值/效果组键；acked 无 `sequence`/`syncRoundId`（sync acked 亦无 `transferId`/`chunkCount`——R1/R2 forbidden 断言逐字对应）；aborted 无 `connectionId`（对齐 `chunked-update-aborted` 域键集）。`ChunkedUpdateAbortReason` 复用零新词。

### OD2 · 发送侧 sent：`onLastChunkSent` 结算记录扩展（包内私有签名加宽）

`bulk-transfer.ts` 新增导出接口（模块内类型，不经 `src/index.ts`）：

```ts
/** 末 chunk 出站结算记录（issue #301）：sent 事件字段事实源 + acked latency 的 t0 锚。 */
export interface BulkTransferOutboundSettlement {
  readonly lastChunkSequence: number;
  readonly transferId: number;
  readonly chunkCount: number;
  readonly totalBytes: number;
}
```

`BulkTransferRequest.onLastChunkSent` 参数从 `number` 加宽为 `BulkTransferOutboundSettlement`（**名字与发射点不变**——`pullOne` L188–193 末 chunk 分支、sendChunk 成功且 `nextChunkIndex === chunkCount` 后同一同步栈调用；`settle` 内 `disposeCurrent` 前状态字段即事实源，构造零额外读取）。三个调用点改为：

- **hub `startBootstrap` kind=1**（L592–595 回调体）：先置既有锚 `this.bootstrapSnapshotSeq = s.lastChunkSequence`，再 `this.chunkedAckT0 = this.sampleAckT0()`，最后 `observerOn` 门下发射：

```ts
this.host.emitObserver({
  type: 'chunked-snapshot-sent', side: 'hub',
  ...cidField(this.host.connectionId()),
  namespaceId: this.namespaceId,
  transferId: s.transferId, chunkCount: s.chunkCount, totalBytes: s.totalBytes,
});
```

- **hub `sendStep2` / peer `sendStep2` kind=2**（hub L723–724 / peer L1564–1565 回调体）：先既有 `this.round.noteChunkedStep2Outbound(s.lastChunkSequence)`，再 t0 采样，再发射 `chunked-sync-sent`（side 分别 'hub'/'peer'；`syncRoundId` 取闭包内 `sendStep2` 实参——即本 round 的 wire roundId，与首 chunk 绑定块同源）。

双侧控制器各加一个私有字段 `private chunkedAckT0: number | undefined;` 与私有采样 `private sampleAckT0(): number | undefined { return this.observerOn ? this.host.now?.() : undefined; }`（`host.now` 连接层已 safeNow 折叠 + observer 门控——无 observer 零时钟调用）。

**t0 新鲜度不变量**（单槽充分的根据）：per (ns, 方向) 至多 1 个进行中载体（facet D7 仲裁），且 `phase === 'awaiting-ack'` 结构性蕴含本载体已触发 `onLastChunkSent`（同一转移内赋值）⇒ `settle` 返回记录时 `chunkedAckT0` 必属当前载体；载体经 teardown/resync/shed/超时弃置时 `settle` 返回 undefined，槽值不被消费。

**备选（拒绝）**：① 在 `BulkTransferSender` 内接 observer seam——机制模块无观测面（构造参数 `BulkTransferHost` 全为协议单点），发射点惯例在控制器（`onUpdateSent`/`onUpdateAcked` 先例）；② 新增第二个回调 `onTransferSent`——与 `onLastChunkSent` 同点发射引入无谓排序问题；③ sent 逐 chunk 发射——§23.1「恰一、非逐 chunk」冻结；④ 由控制器在 enqueue 时自记 totalBytes/chunkCount——与发送器切片几何形成两份事实源（`chunkCountOf` 漂移即错），结算记录单点取值。

### OD3 · 发送侧 acked：`settle(kind)` 返回结算记录 + 三调用点发射

`settle` 签名改为 `settle(kind: 1 | 2): BulkTransferOutboundSettlement | undefined`——匹配 awaiting-ack 载体被结算时**先构造记录再 dispose** 并返回；否则返回 undefined（单帧路径无载体 / zombie 迟到 ACK / kind 不匹配）。调用点：

- **hub `onBootstrapAck`**（L647–651）：`const settled = this.bulkTransfer.settle(1); this.setState('reconciling'); if (settled !== undefined && this.observerOn) { const t1 = this.host.now?.(); this.host.emitObserver({ type:'chunked-snapshot-acked', side:'hub', ...cidField(...), namespaceId, bytes: settled.totalBytes, ...(t1 !== undefined && this.chunkedAckT0 !== undefined ? { ackLatencyMs: t1 - this.chunkedAckT0 } : {}) }); }`。发射在 `setState('reconciling')` 之后（决策落定：ACK 已验证、载体已结算、状态已推进）。**单帧路径结构性零事件**（无载体 → undefined——§23.1 第 31 型「普通族无对应事件，本型为分块路径独有」）；ACK 违例路径（`ACK_STATE_VIOLATION` → connectionFatal）在 settle 之前 return——零事件（对齐 kind=0 `onUpdateAck` violation 先例）。
- **hub/peer `onSyncApplied`**（hub L679–688 / peer L664–673）：`round.onApplied(message)` 后 `const settled = this.bulkTransfer.settle(2); if (settled !== undefined && !this.isQuietState() && this.observerOn) { 发射 chunked-sync-acked（side 'hub'/'peer'，bytes = settled.totalBytes，ackLatencyMs 同上两态） }`。`!this.isQuietState()` 门 = round 校验失败（`onViolation` → `finalize('failed')`）时该 SYNC_APPLIED 属被拒 ACK，不发射（kind=0 先例：`onUpdateAcked` 的 violation 分支零事件）；载体仍被 settle 释放（既有行为不变）。RoundAborted throw 路径 settle 不执行——载体由 teardown 收口，零事件。

`ackLatencyMs` 语义 = ACK 处理时刻 − 末 chunk 出站时刻（§23.1 第 31/34 型），t0/t1 均为注入时钟域差值；clock 缺省 → 整键缺失（条件展开，非 undefined 值——R7）。

**备选（拒绝）**：settle 保持 void、控制器另记账本——违反「结算单点」并重蹈两份事实源；被拒 ACK 也发 acked——「收妥结算」语义失真且违背 kind=0 先例与「决策落定后发射」。

### OD4 · 接收侧 applied（kind=2）：`{syncChunked:true, chunkCount}` + 改道发射

1. **`applyRemoteUpdate` 第 5 参联合扩展**（hub L1383 / peer L1650）：`Readonly<{ chunkCount: number }>` 不变；`Readonly<{ syncChunked: true }>` → `Readonly<{ syncChunked: true; chunkCount: number }>`（包内私有方法，双侧唯二调用方随改）。
2. **isStep2 分支替换抑制为发射**（hub L1446–1458 / peer L1728–1741）：

```ts
if (isStep2) {
  if (chunked !== undefined && 'syncChunked' in chunked) {
    // issue #301：kind=2 分块完成点——第五形态（§23.1 互斥规则；R21 改道平移：
    // 本结算点不再发 sync-diff-applied）。独立字段组，不得展开 base（base 含
    // sequence/stages——DD1/§23.1 第 33 型排除项）；applyLatencyMs 沿用 t0/t1 既有采样点。
    this.host.emitObserver({
      type: 'chunked-sync-applied', side: <'hub' | 'peer'>,
      ...cidField(this.host.connectionId()),
      namespaceId: this.namespaceId,
      bytes: update.byteLength,            // = wire 声明 totalBytes（assembler Σbytes 核对不变量）
      chunkCount: chunked.chunkCount,
      syncRoundId: syncRoundId!,
      ...(applyLatencyMs !== undefined ? { applyLatencyMs } : {}),
    });
  } else {
    this.host.emitObserver({ type: 'sync-diff-applied', ... }); // 单帧路径逐字节不变（N6 锚）
  }
}
```

peer 侧该分支位于 `degraded` 判别之后的外层 else 内（L1713 起）——**degraded 窗口任意来源仍发 `degraded-bypass-applied` 胜出**（R23 裁决不变，§23.1 互斥规则「degraded 判别先于 chunked 判别」）。hub 无 degraded 分支（既有结构）。
3. **chunkCount 穿线**：`RoundHost.applyStep2` 第 4 参从 `form?: 'syncChunked'` 改为结构化 `form?: Readonly<{ form: 'syncChunked'; chunkCount: number }>`（round-engine.ts L52–57 + hub L218–219 / peer L271–272 接线 + 双侧私有 `applyStep2` 签名 hub L1340 / peer L1604）；`RoundEngine.completeChunkedStep2(update, lastChunkSequence, chunkCount)`（L225–229）与私有 `applyStep2Safely` 同步扩展；双侧 `handleAssemblerResult` kind=2 complete 分支传 `result.chunkCount`（hub L942 / peer L906）。`chunkedStep2RoundId` 归属核对与结算锚逻辑零变化。
4. **效果组捕获跳过（有界成本纪律）**：`svBefore` 捕获门从 `isStep2 && observerOn` 收紧为 `isStep2 && observerOn && !(chunked !== undefined && 'syncChunked' in chunked)`（hub L1397–1398 / peer L1665–1666）——syncChunked 形态键集冻结排除效果组（§23.1 第 33 型），捕获是必然丢弃的死读取（peer 侧现注释已声明成本有界；跳过与保留观测等价，SA3 若判 diff 复杂度不划算可保留捕获，行为不变）。

**备选（拒绝）**：为 chunked-sync-applied 保留 `sync-diff-applied` 的效果组/sequence/stages 字段——键集冻结明文排除（§23.1 第 33 型「无 transferId/sequence/四段差值/效果组键」）；在接收侧绕开 round 引擎直发——破坏 §9 违例矩阵单点；chunkCount 走裸第 5 参 number——位置参数易错且与形态解绑（结构化 payload 与既有 `chunked` 判别联合风格一致）。

### OD5 · 接收侧 applied（kind=1）：`finishBootstrapImport` form 参数化

第 4 参从 `emitImported: boolean` 改为 `form: 'single' | Readonly<{ form: 'chunked'; chunkCount: number }>`（peer-namespace.ts L556 签名；两个调用点：`onBootstrapSnapshot` 单帧传 `'single'`（L544–547，行为逐字节不变）；`handleAssemblerResult` kind=1 完成点传 `{ form: 'chunked', chunkCount: result.chunkCount }`（L900））。

- **t0 采样**：`form !== 'single' && this.observerOn` 时在导入续体内、紧邻 `registry.importReplica` 调用之前采样（`const t0 = this.host.now?.()`）——语义 = 排他复制导入的「进入 apply」边界（含 Registry 排队；对齐 applyRemoteUpdate 的 t0 纪律）。
- **发射点**：既有 `bootstrap-imported` 发射位（L610–618）按 form 分支——`'single'` → 既有事件逐字节不变；chunked → 在 `importResult.ok` 已判定、`this.lease` 赋值后的成功结算点发射 `chunked-snapshot-applied`（`bytes: snapshotBytes.byteLength`（= wire totalBytes，assembler Σbytes 已核对）、`chunkCount: form.chunkCount`、`applyLatencyMs` 两态条件展开）。
- **迟到/失败路径零事件**（既有结构不动）：detached apply 失败 / importReplica throw / `!importResult.ok` → `BOOTSTRAP_FAILED` 族终局（可观测信号 = `namespace-error`/`namespace-failed`，§23.1 互补不重复）；连接代际不符的迟到导入 → 静默回收零事件——均先于发射点 return。
- **无 degraded 交互**：排他复制导入不是 session apply 路径（`finishBootstrapImport` 无 degraded 分支；§23.1 第六形态无 degraded 但书；degraded 判别点 = `applyRemoteUpdate`）。bootstrap 期 lease 尚未建立，`degradedBypassActive` 结构性不可达。

**备选（拒绝）**：保留 boolean 另加可选 chunkCount 参数——两参数可组合出非法状态（`emitImported=false` + 无 chunkCount）；在 `handleAssemblerResult` 外层发射——离开导入结算点即违反「决策落定后发射」（导入可能失败/迟到）。

### OD6 · 中止侧：`clearInboundAssembly` kind 门泛化（双侧同构）

`hub-namespace.ts` L995–1016 与 `peer-namespace.ts` L955–978 改为：

```ts
private clearInboundAssembly(reason?: ChunkedUpdateAbortReason): void {
  const kind = this.inboundAssembler.busyKind ?? 0; // reset 前捕获
  const snapshot =
    reason !== undefined && this.observerOn && this.inboundAssembler.busy
      ? this.inboundAssembler.snapshot()
      : undefined;
  this.endAssemblyScope();
  this.inboundAssembler.reset();
  // （仅 peer）this.bootstrapChunkBinding = undefined;  —— 既有行保持
  if (snapshot !== undefined && reason !== undefined) {
    this.host.emitObserver({
      type: kind === 1 ? 'chunked-snapshot-aborted'
          : kind === 2 ? 'chunked-sync-aborted'
          : 'chunked-update-aborted',
      side: <'hub' | 'peer'>,
      namespaceId: this.namespaceId,
      transferId: snapshot.transferId,
      reason, // ChunkedUpdateAbortReason 复用零新词
      receivedChunks: snapshot.receivedChunks,
      receivedBytes: snapshot.receivedBytes,
    });
  }
}
```

busy 守卫（`busy` 才快照 ⇒ 重复 clear/多清理挂点汇合至多一事件；fire 后竞态 clear 由 stale 零副作用吸收）与「快照先于 reset」次序不变——恰一不变量原样继承。**全部 reason 置位点（§5.3 清单）零改动即自动接线**：channel-teardown（R3）、connection-teardown（R4/R8）、timeout（R5，经 OD7 的 kind 选择）、epoch-fence/resync-declared/shed（词表行，SA7 动态验证面）。终局失败族（`transferViolation`/`bindingViolation` 不带 reason）保持零事件。hub 侧 `chunked-snapshot-aborted` 结构性不可达（hub 无 kind=1 入站合法上下文，接纳门即拒）——类型保留双侧（对齐 `chunked-update-aborted` 先例），防御路径不需要发明发射。

**备选（拒绝）**：为 kind=1/2 另立清理函数——六类 reason 置位点全部要复制改写，恰一守卫与槽归还逻辑分叉；给 `ChunkedUpdateAbortReason` 加 kind 维度新词——违「零新词」冻结。

### OD7 · kind=1 超时终局族不发 aborted（双侧 `onAssemblyTimeout` reason 选择）

`hub-namespace.ts` L1839–1848 与 `peer-namespace.ts` L2251–2265 的清理行从 `this.clearInboundAssembly('timeout')` 改为：

```ts
this.clearInboundAssembly(kind === 1 ? undefined : 'timeout');
```

依据：§23.1 第 35 型明文「终局失败族不发本事件（`SNAPSHOT_TRANSFER_*`/`BOOTSTRAP_FAILED` 族的可观测信号 = `namespace-error`/`namespace-failed`）」；kind=1 停滞超时的收口 = `BOOTSTRAP_FAILED` ERROR + `finalize('failed','bootstrap-timeout',assemblyTimeoutMs)` 终局（双侧既有行为）⇒ aborted 恒零；kind=0/2 超时为非终态收口（RESYNC 族）⇒ aborted{timeout} 照发（kind=0 现状 + R5 红半）。`kind` 在 clear 之前捕获（busyKind 随 reset 消失——既有 L1841/L2253 行已先捕获，保持）。该决策与 SA6 §12.3-1/§15 的规范读法一致（N1 不锁 aborted 计数、预期零）。

### OD8 · 纪律面：latency 两态 / safe-field / 隔离 / 无 observer 等价

- **latency 两态**：全部 latency 键条件展开（`...(x !== undefined ? { k: x } : {})`）——clock 缺省/无 observer = 整键缺失非 undefined 值（R7）；采样点仅 `chunkedAckT0`（末 chunk 出站）、ack t1（ACK 结算）、applied t0/t1（apply/导入边界）；`now()` 只作差，绝对时间戳不入事件；clock throw 经 `host.now` 连接层 safeNow 折叠为缺面，零协议外溢（§23.4 既有纪律）。
- **safe-field**：新事件字段全集 = 稳定字面量（type/side/reason）+ 受控标识（namespaceId/connectionId 经 `cidField`）+ 有限数值（transferId/chunkCount/totalBytes/bytes/receivedChunks/receivedBytes/syncRoundId/latency 差值）——零 Yjs bytes/ArrayBuffer/DataView/Error/token/owner/SCHEMA/ROOT/cause（R6 深扫面）。syncRoundId 属 §23.3 issue #239 已登记类别（uint32 wire 投影）。
- **throw 隔离**：发射全部经 `this.host.emitObserver` → `dispatchReplicationObserver` 单点（observer throw 静默、返回值忽略）——继承 N7 锚。
- **无 observer 逐字节等价**：新发射全部 `observerOn` 门内构造；新读取 = 结算记录（内存字段）与 `host.now`（连接层 observer 门控）⇒ 无 observer = 零事件构造、零时钟调用、wire/状态机逐字节等价（N7 保持绿）；发送侧回调加宽不改出站时序（同一同步栈、同一点调用）。

### OD9 · 类型镜像与文档锚

1. `ws-replication-api.test-d.ts`：联合镜像（L241–279）追加 8 个成员并改标题计数（「26 型」文案 → 36 型；现标题本身已滞后两型，一并修正）；按既有风格追加 8 型的字段精确性断言（`Extract<...>` 逐字段 `toEqualTypeOf`，含 `chunked-snapshot-applied.applyLatencyMs: number | undefined`、`chunked-sync-acked` 无 syncRoundId 键等——结构断言经 `Extract` 成员类型表达）。
2. `docs/protocols/instance-replication-v1.md` §22：按 L701 既有资产锚格式补记本票验收契约文件锚一句（§23.1 第 29–36 型行已在冻结文本登记，**零改动**；§23.3/§23.4 纪律文本零改动）。

## 8. 接口、状态机与数据流

### 8.1 接口变化汇总（全部包内私有或加性公共类型）

| 接口 | 变化 | 可见性 |
|---|---|---|
| `ReplicationObserverEvent` | 追加 8 个判别成员（29–36 型） | 公共（index.ts 已导出，加性 append-only） |
| `BulkTransferRequest.onLastChunkSent` | 参数 `number` → `BulkTransferOutboundSettlement` | 包内私有（bulk-transfer.ts 不经 index.ts） |
| `BulkTransferSender.settle` | 返回 `void` → `BulkTransferOutboundSettlement \| undefined` | 包内私有 |
| `RoundHost.applyStep2` / `RoundEngine.completeChunkedStep2` / `applyStep2Safely` | 第 4 参 `'syncChunked'` → `{ form:'syncChunked'; chunkCount:number }`；complete 增第 3 参 `chunkCount` | 包内私有 |
| hub/peer `applyRemoteUpdate` 第 5 参 | `{syncChunked:true}` → `{syncChunked:true; chunkCount:number}` | 类私有 |
| peer `finishBootstrapImport` 第 4 参 | `emitImported: boolean` → form 判别联合 | 类私有 |
| hub/peer `clearInboundAssembly` / `onAssemblyTimeout` | 签名零变化；内部 kind 选路 | 类私有 |

**状态机零变化**：`BulkTransferSender`（idle/queued/active/awaiting-ack）、namespace 状态机、round 引擎状态、assembly 状态机全部不动；本设计只在既有转移的结算点追加观测发射。

### 8.2 数据流路线（事件对象流；业务运行时数据创建/写入/传输零变化——唯一新增运行时数据 = 同步投递的 observer 事件对象，进程内、零持久化、零 wire）

| 路线 | 触发者与输入 | 写入或创建点 | 转换与边界 | 存储或传输 | 读取或投影点 | 可观察结果 | 错误与清理 | 验收锚点 |
|---|---|---|---|---|---|---|---|---|
| ① chunked snapshot 成功链 | hub `startBootstrap` 编码快照 > `maxBootstrapBytes`（≤ 聚合上限） | `BulkTransferSender` 载体（内存）→ 末 chunk 出站结算（pullOne）→ hub `chunked-snapshot-sent`；peer assembler detached buffer 收齐 → `importReplica` 排他导入 → peer `chunked-snapshot-applied`；peer `BOOTSTRAP_ACK` → hub `onBootstrapAck` → `chunked-snapshot-acked` | wire 申报（transferId/chunkCount/totalBytes）→ 事件字段投影；跨进程边界仅经既有 wire 帧，事件本体各侧进程内 | 零持久化（事件 = 观测投影） | observer 回调（同步） | 三事件各恰一；普通族 sent/imported 窗口内归零 | 出站被拒/导入失败 → BOOTSTRAP_FAILED 族（零成功型事件）；observer throw 静默 | R1/R7（snapshot 腿）/N6 |
| ② chunked sync 成功链 | 双向 `sendStep2` diff > `maxSyncDiffBytes` | 载体 → 末 chunk 出站结算 → 发送侧 `chunked-sync-sent`（+syncRoundId）；接收侧 assembler 收齐 → `completeChunkedStep2` → `applyRemoteUpdate` apply 结算 → `chunked-sync-applied`（+syncRoundId/chunkCount）；`SYNC_APPLIED` → 发送侧 `chunked-sync-acked` | round 绑定块 syncRoundId → 事件投影；t0/t1 差值 | 零持久化 | observer 回调 | 三事件各恰一、双向对称；普通族 step2-sent/diff-applied 窗口内归零 | degraded 窗口 → `degraded-bypass-applied` 胜出（R23）；被拒/迟到 ACK → 零 acked | R2/R7（sync 腿）/N6 |
| ③ 中止链 | partial assembly + 六类收口触发面（timeout/close/断线/GOAWAY/fence/resync/shed） | `clearInboundAssembly(reason)` 快照 → 事件构造 → reset/槽归还 | busyKind → 事件型选路；receivedChunks/receivedBytes 进度投影 | 零持久化（assembly 纯易失不变） | observer 回调 | `chunked-{snapshot,sync,update}-aborted` 恰一（busy→aborted 边沿）；成功型互斥 | 终局失败族/kind=1 超时零 aborted（互补 = namespace-error/failed）；重复 clear 零副作用 | R3/R4/R5/R8/R6/N1/N9 |

跨边界说明：每跳数据形态 = wire 申报值/内存计数 → 冻结键集事件对象 → 宿主 observer；事实源 = 发送器结算字段 / assembler snapshot / apply 结算局部变量；无缓存无最终一致性议题；失败可见性 = 事件缺省 + 互补 wire ERROR/终态事件。

## 9. 错误、恢复、并发和幂等

### 9.1 计数不变量（全部结构性单点）

| 不变量 | 结构保证 | 锚 |
|---|---|---|
| sent 每笔完成出站 transfer 恰一 | `onLastChunkSent` 只在 pullOne 末 chunk 分支单次触发；载体弃置（被拒/teardown/shed/resync/超时）到不了该点 ⇒ 中止 transfer 零 sent（与 aborted 互斥） | §23.1 L746/749/752；R1/R2 |
| acked 每笔被结算的 transfer 恰一 | `settle` 返回记录 ⇔ awaiting-ack 载体真实结算；zombie 迟到 ACK / 单帧路径 / kind 不匹配 → undefined → 零事件 | §23.1 L748/751/754；OD3 |
| applied 每笔成功 apply 恰一（六选一互斥） | 发射结构 = 既有 `chunked-update-applied` 三分支位的同位扩展：degraded（peer）> isStep2(syncChunked → 第五形态 / else 单帧) > chunkCount（第四形态）> else 普通族——判别序冻结 | §23.1 L787–796；R1/R2/N6 |
| aborted 每笔 busy→aborted 边沿恰一 | busy 守卫 + reset 后续 clear 零快照；与成功型互斥（中止 assembly 到不了 complete 点） | §23.1 L782–784；R3/R4/R5/R8 |
| t0 新鲜度 | awaiting-ack ⟹ 本载体 `onLastChunkSent` 已触发（同一转移）⇒ 单槽 `chunkedAckT0` 恒属被结算载体 | OD2 |

### 9.2 失败/恢复语义（全部继承，零新失败语义）

- 出站被拒（M5）：载体弃置于末 chunk 前 → 零 sent/acked；kind=1 → BOOTSTRAP_FAILED 族、kind=2 → resync 边沿族（既有）——可观测信号 = `namespace-error`/`namespace-failed`/`resync-required`，互补不重复。
- ACK 超时（kind=2 自持 timer）：载体弃置 → 迟到 SYNC_APPLIED settle 返回 undefined → 零 acked（§23.1 zombie 条款平移）。
- 超时两向收口：kind=1 → BOOTSTRAP_FAILED 族终局 + 零 aborted（OD7）；kind=2 → RESYNC{SYNC_TRANSFER_EXPIRED} 非终态 + aborted{timeout}（OD6）。
- 观测面异常（observer throw / clock throw / 事件构造）：经 dispatch 隔离与 safeNow 折叠——绝不改变协议状态、关闭分类、Runtime 写入（§23.4；N7）。

### 9.3 并发与生命周期所有权

- 发射点全部位于 ws-replication 层帧分发同步段或 apply/导入结算续体（§23.4「永不位于 Registry write sequencer 槽内」——新发射点复用既有结算位置，零新增槽内调用）。
- 单载体仲裁（per (ns,方向) 至多 1）保证 sent/acked 计数与 t0 槽无并发歧义；多 namespace 各自控制器实例独立（N8 公平调度面零改动）。
- 重连/代际：载体与 assembly 均易失、随收口弃置（既有）；peer `tryOpenReplicationSession` 的 `clearInboundAssembly()` 无 reason——新代清理零事件（正确：非中止语义，属代际重置）。

## 10. 调用方影响矩阵

| 调用方 | 当前处理 | 设计后处理 | 所需改动 | 证据 |
|---|---|---|---|---|
| hub `startBootstrap`（bulk enqueue 调用点） | `onLastChunkSent: seq => bootstrapSnapshotSeq = seq` | 结算记录：锚 + t0 + sent 发射 | OD2 | hub-namespace.ts L585–598 |
| hub/peer `sendStep2`（kind=2 enqueue 调用点） | `onLastChunkSent: seq => round.noteChunkedStep2Outbound(seq)` | 结算记录：锚 + t0 + sent 发射（+syncRoundId） | OD2 | hub L719–727 / peer L1560–1568 |
| hub `onBootstrapAck` / hub/peer `onSyncApplied`（settle 调用点） | `settle(1)`/`settle(2)` 返回值忽略 | 消费返回记录 → acked 发射（含 quiet 门） | OD3 | hub L632–652/L679–688；peer L664–673 |
| `RoundEngine.completeChunkedStep2` / `applyStep2Safely` / `RoundHost.applyStep2` | `'syncChunked'` 字符串形态，chunkCount 丢弃 | 结构化形态携 chunkCount | OD4-3 | round-engine.ts L52–57/L221–229/L265–277 |
| hub/peer `applyStep2` → `applyRemoteUpdate` | `{syncChunked:true}` 抑制普通族 | `{syncChunked:true, chunkCount}` → 发射第五形态 | OD4-1/2 | hub L1340–1352/L1446–1458；peer L1604–1617/L1728–1741 |
| peer `finishBootstrapImport` 两调用点 | boolean 抑制 `bootstrap-imported` | form 判别：single 逐字节不变 / chunked 发射第六形态 | OD5 | peer L544–547/L900 |
| hub/peer `clearInboundAssembly` 全部 reason 置位点（§5.3 清单） | kind=0 门内发 `chunked-update-aborted` | kind 选路三型（置位点零改动） | OD6 | hub L995–1016；peer L955–978 |
| hub/peer `onAssemblyTimeout` | 一律 `'timeout'` | kind=1 → undefined（终局族零 aborted） | OD7 | hub L1839–1848；peer L2251–2265 |
| 宿主 observer / Adapter 消费者 | 28 型联合回调 | 36 型（加性——非穷尽 switch 消费者零破坏；穷尽镜像仅 api.test-d.ts） | OD9 同步镜像 | types.ts L405；api.test-d.ts L241 |
| `BulkTransferSender` 构造点（hub L257 / peer L310） | `BulkTransferHost` seam | **零变化**（无新宿主方法） | — | bulk-transfer.ts L57–74 |
| `observer.ts` / `index.ts` / `update-channel.ts` / `update-transfer.ts` | — | **零改动**（dispatch 无 per-type 白名单；无新导出；通道/kind=0 面不动；assembler snapshot 已 kind 无关） | §11 DENY | §5.4 |

## 11. 文件范围

### ALLOW LIST

| 路径 | 预期改动 | 原因 |
|---|---|---|
| `packages/ws-replication/src/types.ts` | `ReplicationObserverEvent` 追加第 29–36 型成员 + 联合头部文档注释计数/出处更新 | OD1（类型面能力缺口） |
| `packages/ws-replication/src/bulk-transfer.ts` | 新增 `BulkTransferOutboundSettlement`；`onLastChunkSent` 参数加宽；`settle` 返回结算记录；相关注释更新 | OD2/OD3（发送侧结算回调面） |
| `packages/ws-replication/src/hub-namespace.ts` | `chunkedAckT0` 字段 + 采样helper；startBootstrap/onBootstrapAck/sendStep2/onSyncApplied/handleAssemblerResult(kind=2)/applyStep2/applyRemoteUpdate(syncChunked 分支)/clearInboundAssembly/onAssemblyTimeout 九处 | OD2/OD3/OD4/OD6/OD7（hub 侧接线） |
| `packages/ws-replication/src/peer-namespace.ts` | 镜像 hub 的九处 + `finishBootstrapImport` form 参数化及其两调用点 | OD2/OD3/OD4/OD5/OD6/OD7（peer 侧接线） |
| `packages/ws-replication/src/round-engine.ts` | `RoundHost.applyStep2`/`completeChunkedStep2`/`applyStep2Safely` 结构化 form 携 chunkCount | OD4-3（chunkCount 穿线） |
| `packages/ws-replication/test/ws-replication-api.test-d.ts` | 联合镜像追加 8 型 + 计数文案修正 + 8 型字段精确性断言 | OD9-1（`toEqualTypeOf` 全联合精确断言，不同步即 typecheck 红） |
| `docs/protocols/instance-replication-v1.md` | 仅 §22（L701 段）补记本票契约测试资产锚一句 | OD9-2（资产登记惯例；§23.1/§23.3/§23.4 冻结文本零改动） |

### DENY LIST

| 路径 | 与任务的关系 | 禁止修改原因 |
|---|---|---|
| `packages/ws-replication/test/ws-replication-issue301-chunked-completeness-ac-red.test.ts` | SA6 验收契约（8 红 + 9 负控） | 固定验收输入；修改即毁红灯证据链（SA6 §16 已冻结） |
| `packages/ws-replication/test/ws-replication-issue300-*.test.ts`、`ws-replication-issue299-*`、`issue244/245/246/256/239/231/137` 等 | slice 1/2 与既有 observer/kind=0 回归锚 | 回归面 = 499 用例保持绿（N 系锚）；R21 改道/互斥锚不得漂移 |
| `packages/ws-replication/test/ws-replication-observer-red.test.ts` | §23.7 safe-field 矩阵锚 | 其场景不进入 chunked snapshot/sync 窗口（§13-6 论证）⇒ 无需扩 `ALLOWED_KEYS`；共享锚文件防顺手改 |
| `packages/ws-replication/src/observer.ts` | 隔离分发/稳定码白名单单点 | 事件型非稳定码、无 per-type 白名单（issue #287 复审域分离）；零改动 |
| `packages/ws-replication/src/update-channel.ts`、`update-transfer.ts` | kind=0 通道与 assembler | `snapshot()`/`busyKind`/`complete.chunkCount` 事实源已就位；kind=0 逐字节等价面（R47 遗产） |
| `packages/ws-replication/src/index.ts` | 公共导出面 | 零新导出符号（联合成员经既有 `ReplicationObserverEvent` 加性可见） |
| `packages/ws-replication/src/{defaults,validate,backpressure,frame-io,lifecycle-queue,...}.ts` 及 `packages/replication-protocol/**` | 配置链/codec/wire | 零 wire/配置/生命周期改动（§1 非目标） |
| `docs/adr/0022-chunked-sync-transfer.md`、`docs/adr/0013-*` | 冻结决策文本 | 本票是接线不是决策修订；ADR 面零触碰 |
| `CONTEXT.md` | 领域词汇 | 「分块复制传输」词条不枚举事件型；事件词汇权威在协议 §23.1（已登记） |
| `wiki/raw/task_issue-301.md`、`wiki/raw/task_issue-301_sa6_contract.md` | Host/SA6 固定输入 | 只读上游产物 |

## 12. 验收与验证映射

| 需求或风险 | 现有证据 | 所需行为测试或动态场景 | 预期观察 |
|---|---|---|---|
| AC5/§23.1 29–31 型（snapshot sent/applied/acked） | 契约 R1 红（零发射）；单帧对照 N6 绿 | R1（100KB snapshot + clock 注入，真实双端 harness） | hub sent 恰一（transferId/chunkCount/totalBytes = wire 申报、无 sequence/latency）；peer applied 恰一（bytes=totalBytes、chunkCount、applyLatencyMs ≥0、无 transferId/sequence/stages）；hub acked 恰一（bytes、ackLatencyMs ≥0、无 transferId/chunkCount）；普通族归零；单 ACK 锚末 chunk 帧序 |
| AC5/§23.1 32–34 型（sync sent/applied/acked + syncRoundId 纪律） | R2 红 | R2（peer 100KB 写 → resync → kind=2 恢复 diff + clock） | peer sent 恰一（+syncRoundId=wire round）；hub applied 恰一（+syncRoundId/chunkCount）；peer acked 恰一（无 sequence/syncRoundId/transferId/chunkCount）；普通族增量零 |
| AC1/§10.3 L336（channel-teardown 丢弃） | R3 红；丢弃语义绿（E4） | R3（kind=1 partial + crafted CLOSE_NAMESPACE） | peer `chunked-snapshot-aborted{channel-teardown}` 恰一（transferId/receivedChunks/receivedBytes = 实际进度、无 connectionId）；零 applied；零写入/零 dirty |
| AC1（connection-teardown 丢弃） | R4 红；E4 绿 | R4（partial + closeHubSide 1001） | peer aborted{connection-teardown} 恰一 + 进度一致；零 durable 残留 |
| AC2/AC5（kind=2 超时非终态 + aborted{timeout}） | R5 红/绿半；E3 绿 | R5（seal 丢末 chunk + advance(30_001)，reconcile 上限隔离） | `RESYNC_REQUIRED{SYNC_TRANSFER_EXPIRED}` + 零 ERROR/零 namespace-failed + hub aborted{timeout} 恰一 + 进度一致 |
| AC5/§23.3/§23.7（safe-field/secret-free） | R6 红（8 型不可观测） | R6（4 次运行收集全 8 型） | 键集 ⊆ 冻结白名单；深扫无 Uint8Array/ArrayBuffer/DataView/Error；JSON 无 token/owner/内容哨兵 |
| AC5/§23.4（clock 缺省两态） | R7 红 | R7（observer 在场、clock 缺省，两族各一次） | applied/acked 各恰一且 latency 键**整键缺失** |
| AC1/§23.1 GOAWAY 行 | R8 红；E4 绿 | R8（partial + GOAWAY{SERVER_RESTARTING, drain=1000} + advance） | peer draining + aborted{connection-teardown} 恰一（无独立 reason） |
| AC1–AC4 生命周期/声明/调度面保持 | N1–N9 当前即绿（SA6 §6） | N1–N9 + 全包既有 499 用例 + `pnpm typecheck` + 根 `pnpm test`（含 typecheck 型测） | 全绿零回归；api 型镜像（OD9-1）typecheck 通过 |
| kind=1 超时零 aborted（§23.1 35 型解释） | N1 不锁计数；规范明文 | N1（现有）+ SA7 动态面可加计数断言 | `namespace-failed{bootstrap-timeout,30000}` 终局、零成功型事件、（按 OD7）零 aborted |
| 无 observer 等价 | N7 绿 | N7（observer 全 throw vs 无 observer wire 逐字节全等） | 保持绿（发射全在 observerOn 门内） |

**验证命令**（SA6 §13 同款）：`npx vitest run packages/ws-replication/test/ws-replication-issue301-chunked-completeness-ac-red.test.ts --typecheck.enabled=false`（8 红 → 全绿）→ 全包 → `npx tsc -p packages/ws-replication/tsconfig.json` → `pnpm typecheck` → 根 `pnpm test`。

## 13. 风险、回滚和残余问题

1. **解释决策①——kind=1 超时零 aborted（OD7）**：§23.1 第 35 型终局失败族条款的直接读法（SA6 §12.3-1 同读法、§15 指示 SA1 按 §23.1 明文收口）。若 SA8 复审判读法相反（kind=1 超时应发 aborted{timeout}），改动面 = OD7 一行的 reason 选择 + N1 增设计数断言——单点可逆。已列入冲突复查焦点。
2. **解释决策②——被拒 ACK 零 acked（OD3 quiet 门）**：round 校验失败（SYNC_APPLIED 违例 → failed 终局）时载体仍被 settle 释放但不发 acked。依据 = kind=0 `onUpdateAck` violation 先例（零事件）+「收妥结算」语义；契约不覆盖该组合（SA6 未构造），SA7 动态面可探测。已列入复查焦点。
3. **api 型镜像同步**：`toEqualTypeOf` 全联合精确断言——types.ts 加成员而镜像不同步 = typecheck 红（build gate 自带防漂移；风险仅为流程顺序，非正确性）。
4. **t0 单槽依赖单载体仲裁**：若未来放宽 per-(ns,方向) 单载体（无此计划——ADR 0022 冻结），`chunkedAckT0` 需随载体迁移；当前结构性安全（§9.1 不变量）。
5. **epoch-fence reason last-writer-wins（peer）**：连接随后收口可把 'epoch-fence' 覆盖为 'connection-teardown'——§23.1 既有裁决（「收口入口置位 + 收口链消费 = last-writer-wins」），N9 只锁丢弃效果；非本票可改变的语义。
6. **observer-red 矩阵零新事件论证**：该文件分块腿仅压 `maxUpdateBytes`（8KiB，kind=0），`maxBootstrapBytes`/`maxSyncDiffBytes` 保持缺省 4MiB/2MiB，CHUNKED_BIG=20KB 不进入 chunked snapshot/sync 窗口 ⇒ `assertSafe` 白名单不见新型、零回归；若未来该文件构造超限 snapshot/diff 场景，须同步扩其 `ALLOWED_KEYS`（follow-up 性质，非本票必要条件）。
7. **hub 侧 `chunked-snapshot-aborted` 结构不可达**：hub 无 kind=1 入站合法上下文（接纳门即 `NAMESPACE_STATE_VIOLATION`，assembly 永不 busy）——类型保留双侧仅为与 `chunked-update-aborted` 同构；无死代码发射点需要发明。
8. **回滚**：纯观测面加性变更（零 wire/持久化/状态机耦合）——回滚 = 撤销 ALLOW LIST 七文件的改动即可，无数据迁移、无兼容面。
9. **残余/follow-up（非本票必要条件）**：§22 资产锚为惯例性登记（OD9-2）；observer-red `ALLOWED_KEYS` 全 36 型覆盖（§13-6）；SA7 动态验证面（shed/epoch-fence/GOAWAY 行 + side 双侧覆盖——§23.1 第 25 型行既有归口）。

## 14. 评审修订映射

`wiki/raw/task_issue-301_sa2_review.md` 本 iteration 不存在——无适用 finding；SA2 评审到位后按逐条映射修订本设计（含文件范围显式更新）。

## 15. 设计后 ADR 冲突复查

**需要（`requiresConflictRecheck: true`）。** 理由：

1. **公共 API 类型联合加性变更**：`ReplicationObserverEvent` 为 `@nomicore/ws-replication` 导出面，追加 8 型改变其静态形状（api 型断言面随之扩展）——虽为 ADR 0022/协议 §23.1 预登记值的接线（零新决策），仍属公共契约面变更，按惯例应过 SA8 复核；
2. **冻结文本两处解释决策**：OD7（kind=1 超时零 aborted——§23.1 第 35 型终局失败族条款的解释）与 OD3（被拒 ACK 零 acked——kind=0 先例平移）均为本设计做出的规范读法固化，SA6 契约显式不锁（§12.3），需要冲突复查确认与 ADR 0022/§23 无潜在冲突；
3. **SA8 前置门禁缺失**：本 iteration 无 `task_issue-301_conflict_report.md`/`_relevant_decisions.md`——按 skill「缺少 SA8 产物时……标记需要冲突复查」明文提交。

复查焦点：OD1 字段集/side 信封与 §23.1 第 29–36 型行逐字一致性；OD7 终局失败族条款读法；OD3 被拒 ACK 语义；R21 改道面（本票只加不改）与 N6/N7 锚的不变性；ALLOW/DENY 边界（尤其 observer-red 与契约文件的不可改性）。
