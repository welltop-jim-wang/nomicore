# SA1 设计与裁决 — PR #165 review 八项修订（issue #161 round 2）

**Status**: R4 = F1 增补（SA7 动态验证 `..._round2_sa7_report.md` §2 唯一缺陷——D2 滞回接纳帧负记账；增补节 **§D9**，八项修订主体与 R1–R3 裁决不变）| **Date**: 2026-08-30（首版 → R2 → R3 → R4/F1）
**Worktree**: `/home/wangjian/nomicore-fix-issue-161`（branch `fix/issue-161-on-docs-phase-5-websocket-replication`，基线 commit `0a18661`；SA3 实现 `4bc57dd`；SA7 冻结锚 `218ca3a`）
**输入**: SA5 缺陷分析 `wiki/raw/task_ws-replication-review-revisions_round2_sa5_analysis.md`（行号基线 0a18661）；SA6 红灯契约 `wiki/raw/task_ws-replication-review-revisions_round2_sa6_red.md`（13 例红灯 + D3 改写 1 例，基线 14 failed / 110 passed）；SA2 评审 `..._round2_sa2_review.md`（R1：B1/B2/B3 → R2：B4）；**SA7 动态报告 `..._round2_sa7_report.md`（F1——本增补的输入）**；round-1 设计 `wiki/raw/task_ws-replication-hardening_design.md`。
**产出边界**: 本文件只做设计与裁决，零生产/测试代码改动。

---

## §0. 裁决总表（8 项修订 → 绑定性结论）

| # | 修订 | 裁决（binding） | 设计节 |
|---|---|---|---|
| R1 | cap/low-water 严格接纳 | **严格准入**：shed 循环后 `pipelineBytes() + incoming > maxQueuedBytesPerConnection` 仍成立 → **拒纳 incoming + 同批丢弃该 ns 幸存排队帧 + 无条件 `onDataShed(ns)` 显影**（B1 修复：显影必以面全弃为前提——否则 channel pendingData 负记账 + 声明后仍派发）；单帧超限同一路径（无特例分支）。A2 滞回锚维持 `≤2`（SA6 仲裁正确——该场景合法接纳 1 帧）。 | §D1 |
| R2 | 控制帧真实有界保留额度 | **新增显式 limit 字段 `maxQueuedControlBytes`**（不从总预算派生）；缺省 `8 MiB`；校验 `≥ maxBootstrapBytes + 128`；记账 = socket 缓冲 FIFO 尾窗归因的控制字节（emit-tail ledger）；**检查点评估**（规则 C 扩为析取），非 send 时拒发；`sendControl` 补 `ensureCheckpoint()`。 | §D2 |
| R3 | GOAWAY/blocked 同步静默（双侧） | **hub**：`onConnectionClosed()` 增同步段 `quiesceSync()`（订阅摘除 + 非 terminal 投影离开 live → `closed`），drain/释放仍异步；**peer**：`onConnectionFatal`/`onConnectionLost` 增同步段（订阅摘除先于 `setState('disconnected')`），异步尾巴保留 B-2d「仅收口当次句柄」守卫。 | §D3 |
| R4 | pong 超时关传输 + 代际安全 | **pong 专属入口 `onPongTimeoutDetached()`**（不改公共 `onTemporaryFailure`——dial 抛错/hello 超时/onClose 三入口行为不变）；收口序：stopLiveness → clearGoawayDrain → 退订 → `close(1001,'pong-timeout')` → epoch+1 → backoff 投影 → outbound.dispose（投影后 dispose = 零出站噪声）。 | §D4 |
| R5 | round-robin 有界整轮扫描 | **blocked ns 跳过不终止本轮**：`consecutiveSkipped` 计数，成功派发即归零；`consecutiveSkipped ≥ dataOrder.length`（当前值）才 return——饥饿界 = 连续一整轮零派发；AC5-RR 无阻塞场景行为逐字节不变。 | §D5 |
| R6 | pending handoff 计入溢出判定 | count 与 bytes 双口径纳入：`pendingDataCount`（已有）+ 新增 `pendingDataBytes`；**四出口同步**：`handoff`(+)/`onDataDispatched`(−)/`onDataShed`(清零)/`teardown`(清零)。 | §D6 |
| R7 | 确定性 seam + 去 512 跳魔法 | **生产**：`requestRebuild` L638 `queueMicrotask` → `this.deferTask(...)`（含 L634-637 / peer-namespace L688-689 注释去 512 叙事）。**driver**：废除 `DEFER_MICROTASK_HOPS` 跳数链（命名常数不满足修订要求——总控裁决），改**显式 flush 泵**：`makeDeferPump()`（入队 + 显式 `flush()`），唯一自动冲刷点 = `settleUntil` 谓词未决时（谓词先行）；`settle()` 永不冲刷。 | §D7 |
| R8 | 权威文档四缺口 + 陈旧叙事 | A8a 身份投影句（§2）/ A8b transport facet 契约（§17/§18 + ADR 指针）/ A8c liveness 缺省与约束（§18）/ A8d 背压终态口径（§17 + 校验清单）/ A8e phase-5 L75-83 流水线回合叙事改写为终态句；**ADR 0010 既有修订节 append-only 全保留**，只追加新节。 | §D8 |

---

## §D1. R1 — 严格字节接纳（frame-io.ts enqueueData）

### 现缺陷（SA5 R1 证据，设计确认）

`enqueueData`（frame-io.ts:155-177）在触发面 shed 循环结束后**无条件接纳** incoming（L173-174）。缓冲主导（queued 无 victim）与单帧超限（空队列）两条路径都绕过字节约束；接纳无任何显影。

### 设计（伪码，替换 L161-176 触发面块）

```ts
enqueueData(namespaceId: string, message: ReplicationMessage): void {
  this.registerDataNamespace(namespaceId);   // 保持先行（NB2(a)：空桶幂等登记）
  const bytes = (message as { update: Uint8Array }).update.byteLength;
  if (this.pipelineBytes() + bytes > this.limits.maxQueuedBytesPerConnection) {
    while (this.queuedDataBytes > this.limits.lowWater) {
      const victim = this.largestQueuedNamespace();
      if (victim === undefined) break;
      this.shedNamespace(victim);            // victim ns 整队丢弃 + onDataShed(victim)
    }
    // ── R1（PR #165）：严格准入——shed 后仍超限则拒纳（绝不接纳违反字节约束的帧）。
    //    拒纳 = 本帧不 push、不占 queuedDataBytes、不分配序列。
    //    B1 修复（SA2 R2）：拒纳必须**先丢弃该 ns 幸存排队面**（清桶 + 回减
    //    queuedDataBytes），再**无条件** onDataShed(ns) 显影（空桶也显影——
    //    shedNamespace/dropData 对空桶跳显影，不可复用；R1-2 空队列拒纳必须显影）。
    //    不变量：onDataShed(ns) ⇒ 该 ns 的 handed-off-未派发面（队列侧）已全弃——
    //    这是 R6「onDataShed 清零 channel pendingData」不产生负记账的前提。
    if (this.pipelineBytes() + bytes > this.limits.maxQueuedBytesPerConnection) {
      const bucket = this.dataQueues.get(namespaceId);
      if (bucket !== undefined) {
        for (const item of bucket) {
          this.queuedDataBytes -= (item as { update: Uint8Array }).update.byteLength;
        }
        bucket.length = 0;   // 空桶保留注册（NB2(a)——drain shift 守卫摘除，与 shedNamespace 同形）
      }
      this.deps?.onDataShed(namespaceId);   // 无条件——即使桶原本为空（保 R1-2 显影）
      this.ensureCheckpoint();               // shed 可能已发生（victim 帧）——续挂检查点
      return;
    }
  }
  this.dataQueues.get(namespaceId)!.push(message);
  this.queuedDataBytes += bytes;
  this.drain();
  this.ensureCheckpoint();
}
```

### 语义要点（binding）

1. **单一拒绝路径**：单帧超限（`bytes > max`，空队列）与缓冲主导（`pipeline > max`，queued 已 ≤ lowWater）由**同一判定**覆盖——`post-shed pipelineBytes() + bytes > max` 即拒纳。无单帧特例分支。
2. **拒纳 = 幸存面全弃 + 无条件显影（B1 修复后语义）**：拒纳不只作用于 incoming——该 ns 仍留在 `dataQueues` 的幸存排队帧（总量 ≤ lowWater 时 shed 循环不触达它们）**同批全弃**，随后 `onDataShed(ns)` **无条件**触发（空桶也显影）。理由：(a) **记账闭环**——`onDataShed` 会把 channel 侧 `pendingDataCount`/`pendingDataBytes` 清零（R6 字段），若幸存帧不被丢弃，其随后派发经 `onDataDispatched` 再减一 → **负记账** → A7 窗口门与 R6 溢出判定双双低估负载（窗口等效放宽 \|负值\| 帧，破坏被锚冻结的不变量）；(b) **声明语义一致**——该 ns 已发 RESYNC_REQUIRED（reasonCode `send-queue-overflow`）后仍向 wire 派发其旧帧，与「发送队列溢出」声明矛盾。hub 侧显影 → `declareHubResync()`、peer 侧 → `declareLocalResync()`（均记忆化）。**拒纳、幸存面全弃、显影是同一要求的三个面，不可拆**。
3. **不依赖 `maxUpdateBytes ≤ maxQueuedBytesPerConnection` 关系**（SA5 依赖联动项裁决）：按本判定直接拒纳，validate.ts 不新增该关系校验（该关系在缺省值下成立但非协议不变量——测试用 R1_LIMITS 即构造 `maxUpdateBytes=512KiB > max=64KiB` 的合法配置）。
4. **A2 滞回锚维持 `≤2`**（确认 SA6 §4 仲裁）：SHED_LIMITS 场景（buffered ≈8KiB + lowWater 1KiB）下 shed 后 pipeline+incoming ≈17KiB ≤ 64KiB → 第 N 帧合法接纳 → 恢复后派发恒 2（首帧缓冲 + 1 合法接纳帧）。字节级拒纳判别由 R1-1/R1-2 独立锚定；A2 锚注释已由 SA6 更新为字节级语义口径，SA3 零改动。
5. **双侧对称**：hub（hub-connection.ts:181 sendData）与 peer（peer-connection.ts:516 sendData）共用 OutboundQueue，严格准入对两个方向同时生效。

### 锚通过性推演

- **R1-1**（`maxQueuedBytesPerConnection=64KiB`，gate 置停，9 笔 8KiB）：前 8 笔派发后 held ≈64.8KiB > 64KiB；第 9 笔触发面 → shed 循环零 victim（queued 0）→ 严格判定 64.8KiB + 8KiB > 64KiB → 拒纳（空桶 → 仅无条件显影）+ onDataShed → `declareHubResync` → RESYNC_REQUIRED ≥ 1（控制面不受 paused 约束，恒可派发）；dispatchLog UPDATE == 8、第 8 笔后零 UPDATE 字节。✅
- **R1-2**（单笔 100KiB > 64KiB）：channel 帧级门 `maxUpdateBytes=512KiB` 放行 → handoff → enqueueData：pipeline(0) + 100KiB > 64KiB → shed 无 victim → 拒纳（空桶同上）+ 显影 → wire 零该帧 + RESYNC ≥ 1。✅
- **R1-3（B1 新增红灯契约，SA2 §5 定稿——「拒纳 × 幸存面」行为面）**：
  - **构造**：`maxQueuedBytesPerConnection=64KiB、lowWater=1KiB、highWater=4096`；ns A 突发 7×8KiB（gate 置停、零检查点推进——buffered ≈56KiB）→ 推进一个检查点置 paused → ns W 排队 1 帧 512B（准入通过：56.5KiB ≤ 64KiB；paused 保排队、不派发）→ 再向 W 投 8KiB 帧 → 触发面：`queuedDataBytes(512) ≤ lowWater(1024)` → **shed 循环不运行**（幸存帧在此）→ 严格判定 56 + 0.5 + 8 > 64 → **拒纳 + 丢弃 W 幸存 512B 帧 + onDataShed(W)**。（双 ns 构造按 SA2 §5；单 ns 变体——A 自任两角色——语义等价，构造选择归 SA6。）
  - **断言**：(a) 该 ns 的 RESYNC_REQUIRED 声明之后 wire **零该 ns UPDATE**（幸存 512B 帧必须同批丢弃——首版设计下会派发 → 红）；(b) 释放 gate + unpause 排空后，对象图只读投影 `channel.pendingDataCount === 0`（首版设计为 −1 → 红——负记账直接可观测）；(c) 恢复 round 后 `inFlight.size + pendingDataCount ≤ maxInFlightUpdates`（A7 窗口不变量回归面）。
  - **首版缺陷签名**：首版拒纳分支不清幸存桶 → (a) 声明后仍派发旧帧、(b) pendingData = −1——两断言在首版下皆红，B1 修复后双绿。锚落 `ws-replication-review-revisions-r1-r7-red.test.ts`（SA6 补写；§C 已列该文件）。
  - **构造精度注（SA2 R2-N1，SA6 补写必读）**：触发面算术按**字面 KiB payload**（8KiB = 8192B；7×8257 + 512 + 8192 = 66,503 > 65,536，裕度 ~967B）。若沿用 `BLOB`=8000 常量（帧 ≈8,071B），7 帧合计 65,015 < 65,536 **不达限**——SA6 必须用 ≥8192B 字面 payload（或等效加大 W 帧字节）。契约语义按字面 KiB 读法成立。

---

## §D2. R2 — 真实有界控制帧保留额度（裁决：新 limit 字段 + 检查点评估 + 尾窗归因记账）

### 裁决 1：额度来源 = 新增显式 limit 字段 `maxQueuedControlBytes`（不从总预算派生）

**理由**：
- 协议 §17 L490 既有权威句「Control frame有独立保留额度，耗尽为 `CONNECTION_BACKPRESSURE`」——「独立」的字面落地是独立可配置字段；从 `maxQueuedBytesPerConnection` 派生（如 `max − highWater`）语义模糊且不可独立收紧；
- SA6 红灯锚已按此字段名 cast（`R2_LIMITS_WITH_CONTROL_QUOTA.maxQueuedControlBytes = 32KiB`），裁决与锚零摩擦；
- 校验/缺省/文档三处需要显式载体（SA5 A2c 要求 `ResolvedLimits`/validate/docs 同步）。

**契约面改动**（连锁审计见 §C）：

| 文件 | 改动 |
|---|---|
| `src/types.ts` | `ReplicationLimits` 新增 `readonly maxQueuedControlBytes: number;`（必填——与既有 10 个 limit 字段同模式：接口必填 + defaults 提供缺省 + Partial 覆盖；不引入 optional 先例分裂） |
| `src/defaults.ts` | `DEFAULT_REPLICATION_LIMITS` 增 `maxQueuedControlBytes: 8 * 1024 * 1024`（缺省 = maxFrameBytes 缺省值：任何单笔合法控制帧（含 envelope）都不可独自触发终止） |
| `src/validate.ts` | `positiveSafeInteger(maxQueuedControlBytes)` + `assertCollKind(limits.maxQueuedControlBytes >= limits.maxBootstrapBytes + PROTOCOL_OVERHEAD_BYTES, ...)`——「单笔最大合法控制帧（BOOTSTRAP_SNAPSHOT payload ≤ maxBootstrapBytes + 20B envelope + 余量）不得独自耗尽额度」的构造期响亮保障，绝不运行时 clamp |
| `test/ws-replication-api.test-d.ts` | L124-135 形状断言增该字段（冻结面逐字段纪律） |
| `test/harness.ts` | `WsReplicationLimits` 镜像（L42-53）+ `CONTRACT_LIMITS`（L126）同步增字段（「与 DEFAULT 逐值一致」既有纪律） |

**缺省值 8 MiB 的语义核算**：控制帧中唯一的字节大户是 BOOTSTRAP_SNAPSHOT（≤ maxBootstrapBytes = 4MiB 缺省）。缺省 8MiB 容忍「任一单笔合法帧 + 一笔全额 snapshot 在途」不误杀慢消费 peer；操作员按部署特征（如小 namespace）可收紧至 `maxBootstrapBytes + 128` 下限。额度上限不设校验（更大的额度只意味着控制分支更晚触发——总量仍由规则 C 总量分支与 R1 数据准入收口）。

### 裁决 2：记账 = socket 缓冲 FIFO 尾窗归因（emit-tail ledger）

`bufferedAmount()` 是**整条 socket 缓冲的字节数**，控制/数据混流后无法逐帧拆分。WS 语义下缓冲按 FIFO 冲刷（§17 L492「Adapter 观察 bufferedAmount」的既有前提），故**发送字节流的尾部 `bufferedAmount()` 窗口内的控制字节**可精确归因：

```ts
// OutboundQueue 新增私有记账（frame-io.ts）
private totalEmittedBytes = 0;        // emitOne 成功后累加（不分面；dispose/clear 重置）
private controlOutstandingBytes = 0;  // 已 emit 未冲刷（尾窗内）的控制字节
private readonly emitTail: Array<{ endOffset: number; isControl: boolean; size: number }> = [];

// emitOne 成功路径（增加 plane 参数）：
private emitOne(message: ReplicationMessage, plane: 'control' | 'data'): number {
  ...
  this.emitRaw(bytes, sequence);
  this.totalEmittedBytes += bytes.byteLength;
  this.emitTail.push({ endOffset: this.totalEmittedBytes, isControl: plane === 'control', size: bytes.byteLength });
  if (plane === 'control') this.controlOutstandingBytes += bytes.byteLength;
  return sequence;
}
```

检查点裁剪（`flushed = totalEmittedBytes − buffered` 单调不减——每步增量恰为冲刷量）：

```ts
// runCheckpoint 内、规则评估前：
const buffered = this.deps?.bufferedAmount() ?? 0;
const flushed = this.totalEmittedBytes - buffered;   // ≤0 时零裁剪（防御）
while (this.emitTail.length > 0 && this.emitTail[0]!.endOffset <= flushed) {
  const head = this.emitTail.shift()!;
  if (head.isControl) this.controlOutstandingBytes -= head.size;
}
```

**弃用项**：`controlQueue` 排队字节不计入（结构性瞬态——`sendControl` 同步 drain，检查点从 timer 触发，永无观察窗口；`OutboundExhaustedError` 中断路径由连接收口接管）。设计明确**不**在 sendControl 入口做额度拒发。

### 裁决 3：耗尽判定 = 检查点评估（规则 C 扩为析取），非 send 时拒发

```ts
// runCheckpoint 规则 C（§3.3 扩展——两分支同检查点并列评估，A2-3 语义保持）：
if (
  this.controlOutstandingBytes > this.limits.maxQueuedControlBytes ||            // R2：控制独立额度
  (buffered > this.limits.maxQueuedBytesPerConnection &&
    this.largestQueuedNamespace() === undefined)                                  // 既有：总量 + 无可 shed 面
) {
  this.deps?.onControlExhausted();   // → connectionFatal('CONNECTION_BACKPRESSURE', 1011)（双侧已接线，零连接文件改动）
  return;
}
```

**检查点评估而非 send 时拒发的理由**（binding）：
1. **终止路径自举**：`onControlExhausted → connectionFatal` 需要**发出** CONNECTION_BACKPRESSURE ERROR 帧再 close(1011)（hub-connection.ts:424-437 先 sendControlChecked 再 close）。send 时拒发会使终止性 ERROR 自身不可发送——peer 只见 1011 裸 close，诊断面退化；
2. **控制恒先排空的既有不变量**（AC5-PRI 锚）：控制面无准入门是该不变量的结构基础；
3. **与既有 A2-1011 锚同节奏**（单检查点触发）；R2-A2a 锚的「检查点 #2 评估」结构与本裁决一致。

**`sendControl` 补 `ensureCheckpoint()`**（真实完备性缺口）：纯控制风暴（无数据排队、未 paused）下原实现检查点永不 armed——控制额度不可检测。`sendControl` 在 drain 后调用 `ensureCheckpoint()`；既有起挂条件（`paused ∨ queued>0 ∨ buffered>0`）天然覆盖「控制字节滞留缓冲」（buffered>0），空闲连接零 timer（N1 纪律不破——检查点重挂时按同条件解除）。

**dispose/clear（N6 归位：重置单点化）**：三字段重置（`emitTail.length = 0`、`controlOutstandingBytes = 0`、`totalEmittedBytes = 0`）**只写在 `clear()` 一处**——`dispose()` 既有路径末尾调用 `clear()`，不重复罗列（防未来第三调用点漏重置）。OutboundQueue 每连接一代实例（peer dialNow 重建、hub cleanupAll 后死亡），dispose 后不复用——重置无跨代污染。

**N7 注记（防 SA4 误报）**：`onSequenceExhausted` 的 uint32 耗尽直发路径（hub-connection.ts:445-464 / peer-connection.ts:531-548）绕过 `emitOne` → 不入尾窗 ledger——该路径随即 close(1008) 收口 + dispose 重置，属终态旁路，**有意不记账**（lastSeq 已到 0xffffffff，ledger 语义已失效）。

### 锚通过性推演

- **R2-A2a**（类级直构：`maxQueuedControlBytes=32KiB`，highWater=16 → 检查点 #1 paused；第二数据帧排队 → `largestQueuedNamespace() = W`；16 × 8KiB BOOTSTRAP 控制风暴 → 尾窗控制字节 ≈128KiB；advanceBy(100) → 检查点 #2）：裁剪（flushed=0，零冲刷）→ `controlOutstandingBytes ≈128KiB > 32KiB` → `onControlExhausted()` 恰 1 次（早 return 不再重挂）→ ✅。类级锚直构 ResolvedLimits **绕过 validateLimits**（构造期校验属 Hub/Peer 组合门）——锚的 32KiB < maxBootstrapBytes(1MiB) 与校验规则不冲突，属有意测试配置。
- **A2-1011 锚保持绿**（g3-g4 L703-731）：10 笔 UPDATE 数据帧 held > 64KiB，控制尾窗 ≈0 → 控制分支不触发；总量分支（buffered > 64KiB ∧ largestQueued === undefined）照旧触发 1011。✅
- **A2b 语义**（额度不被数据侵占/不侵占数据）：数据帧接纳检查用 `pipelineBytes()`（连接总量，含控制字节）——控制积压会收紧数据准入（正确的连接级语义）；控制帧无准入门、其额度只按控制字节归因——数据积压不消耗控制额度。两平面独立成立。

---

## §D3. R3 — 双侧同步静默（hub 重、peer 轻）

### 现缺陷复述（SA5 R3 证据，设计确认）

- **hub 侧**：连接收口（`close()` L197-205 / `onTransportClosed` L401-406 / `connectionFatal` L424-437 → `void this.cleanupAll()`）的同步前缀只做退订 transport 回调 + stopLiveness；channel 的 `onConnectionClosed()`（hub-namespace.ts:557-567）同步段仅清 `openWaiters`，订阅摘除在 `closeQueue.then → drainPendingApplies → closeSessionAndRelease`（L861-864）异步链内，channel state 在整个 drain 窗口保持 `live`——窗口内 `onOwnedUpdate` 继续按 live 投递 → 死连接上的幻影 in-flight + 静默丢帧。
- **peer 侧**：`onConnectionFatal`（peer-namespace.ts:624-631）投影先行（B-2d）但订阅摘除经 `void this.cleanupResources()` → `cleanupTail.then` 至少晚一个微任务链。

### 设计（hub 侧）

```ts
// hub-namespace.ts —— onConnectionClosed 拆分同步/异步两段：
onConnectionClosed(): Promise<void> {
  // 同步段（连接收口同步栈内——cleanupAll 同步前缀调用本方法）：
  this.openWaiters = [];
  this.quiesceSync();                                   // ← 新增
  return this.closeQueue.then(async () => {             // 异步段（不变）：drain/释放
    await this.drainPendingApplies();
    await this.closeSessionAndRelease();                // 订阅已摘除——本函数内 unsubscribe 分支自然 no-op
    if (!this.isTerminal()) this.setState('closed');    // 兜底（quiesceSync 已置 closed → 通常 no-op）
  });
}

/** R3：同步静默——订阅摘除 + channel 投影离开 live（幻影 in-flight 的充要消灭条件：
 *  无订阅 → drain 窗口内 owned update 零投递；投影非 live → 任何迟到续体走终态静默分支）。 */
private quiesceSync(): void {
  const unsubscribe = this.unsubscribe;
  if (unsubscribe !== undefined) {
    unsubscribe();
    this.unsubscribe = undefined;
  }
  if (!this.isTerminal()) this.setState('closed');      // opening/bootstrapping/reconciling/live/needs-resync/closing → closed
}
```

**同步性论证**：`cleanupAll` 是 async 函数，`void this.cleanupAll()` 起始同步执行至首个 `await`——`transportSubscribers` 退订、`stopLiveness`、`channels.map(ch => ch.onConnectionClosed())` 全部位于同步前缀。因此 `close()` / `onTransportClosed()` / `connectionFatal()` / `onSequenceExhausted()` 四个触发面的**同一同步栈**内 channel 已静默。

**语义安全性**：
- `closeSessionAndRelease` 内既有 unsubscribe 分支（L861-864）保留为 no-op 安全网；
- drain 窗口内迟到 apply 续体遇 `isTerminal() === true` → §13.4 静默回收（正是要求的行为）；
- hub channel 是 per-connection 对象（连接死亡即废弃，无跨代复用）——同步摘除无 peer 侧 B-2d 类风险；
- `onDataShed` 声明链（cleanupAll 末尾 `outbound.dispose()`）：`declareHubResync` 的 `isQuietState()` 守卫因 state 已 `closed` 更早为真——零噪声帧（比现状更严）。

### 设计（peer 侧）

```ts
// peer-namespace.ts —— onConnectionFatal / onConnectionLost 增同步段：
onConnectionFatal(): void {
  if (this.isTerminal()) return;
  if (this.state === 'closing') this.settleCloseMemo();   // 既有（R3 关闭承诺兑现）
  this.quiesceSync();                                     // ← 新增：先摘订阅（硬停 inflow）
  this.setState('disconnected');
  void this.cleanupResources();                           // 异步尾巴：session.close / lease release
}

onConnectionLost(): void {
  if (this.state === 'closed' || this.state === 'conflicted') return;   // 终态保持（订阅已由其 finalize 链摘除）
  if (this.state === 'closing') {
    this.settleCloseMemo();                // R3：断线 = 关闭承诺兑现
    this.quiesceSync();                    // ← 新增（closing 分支内——N3 钉死：各非终态分支均先静默再迁移）
    this.setState('disconnected');
    void this.cleanupResources();
    return;
  }
  if (this.state === 'failed') {
    this.quiesceSync();                    // ← 新增（failed 分支内）
    this.setState('disconnected');
    void this.cleanupResources();
    return;
  }
  // B-2d：投影先行——活跃态（live/opening/bootstrapping/reconciling/needs-resync/disconnected 自身幂等）
  this.quiesceSync();                      // ← 新增
  this.setState('disconnected');
  void this.cleanupResources();
}

/** R3：同步摘除当次捕获的订阅句柄（入口捕获、比对后置空）。幂等——已摘除/未订阅为 no-op。 */
private quiesceSync(): void {
  const unsubscribe = this.unsubscribe;
  if (unsubscribe !== undefined) {
    unsubscribe();
    this.unsubscribe = undefined;
  }
}
```

**N3 说明**：`quiesceSync` 置于**每个非终态分支的迁移之前**（closing/failed/活跃态三分支各自内联，非尾部合流——避免「分支内早 return 绕过尾部静默」二义）；终态分支（closed/conflicted）跳过——其订阅摘除已由各自 `finalize → closeSessionAndRelease` 链负责，`quiesceSync` 幂等性使双重路径无害。锚只覆盖 onConnectionFatal 面（R3-4/R3-5）；onConnectionLost 侧为对称完备（无独立锚，行为经既有 B-2d/AC6 系锚回归；closing/failed 分支新增的 `cleanupResources()` 排程为资源更早释放方向、B-2d 身份守卫保护——SA2 R2-N2 建议由 **SA7 动态验证时对 closing/failed 态断线路径加一次回归观察**，随既有 B-2d/AC6/r3-r4 锚面复核）。

**迟到 cleanup 安全（B-2d 守卫保持）**：`closeSessionAndRelease`（L950-979）保留 `this.session === session && this.lease === lease` 守卫；其 unsubscribe 分支捕获的是**入口时点**的 `this.unsubscribe`——quiesceSync 已置 undefined → 迟到尾巴跳过退订，**结构性不可能误摘新连接的订阅句柄**（比「比对后置空」更强的保证：字段已空）。`subscribe()`（新连接 round 完成）写入新句柄不受影响。

### 锚通过性推演

- **R3-1**（close(1001) 同步栈）：`close() → void cleanupAll()` 同步前缀 → `quiesceSync` → state `closed` ≠ `live`。✅
- **R3-2**（订阅摘除 + companion）：同步栈 `unsubscribe === undefined` ✅；settle 后 `closeSessionAndRelease` 完成 → state `closed`、`channel.teardown()` → inFlight 0；`writeHub({n:55})` → 无订阅零投递 → wire 零 UPDATE。✅
- **R3-3**（SEQUENCE_VIOLATION fatal 同栈）：`onMessage → connectionFatal` 同步链含 quiesce；测试轮询 `conn.state === 'closed'` 可观测时同步栈已完整执行。✅
- **R3-4**（GOAWAY SHUTTING_DOWN → blocked 同步段）：`dispatchReady → onGoaway → enterBlocked → controllers.onConnectionFatal()`（L592-594）全同步；测试观测 `blocked` 时整个 enterBlocked 已完成 → `unsubscribe === undefined`。✅
- **R3-5**（SERVER_RESTARTING deadline）：`goawayDrainHandle` 回调 `quiesceControllers() → onConnectionFatal → quiesceSync` **先于** `transport.close`（peer-connection.ts:449-454 既有顺序保持）→ advanceBy(500) 后订阅已摘除 + `peerEnd.closed === true`。✅
- **SA7 D5**（blocked 零出站 UPDATE）保持绿：enterBlocked 既有 outbound.dispose + 非 ready 门语义不变。

---

## §D4. R4 — peer pong 超时：专属收口入口（裁决）+ 关闭序 + 代际安全 + GOAWAY 互斥

### 裁决：pong 专属入口，不改公共 `onTemporaryFailure`

`onTemporaryFailure`（peer-connection.ts:597-615）被四入口共用：

| 入口 | transport 状态 | 关闭传输是否必要 |
|---|---|---|
| `dial()` 抛错（L207-209） | **无 transport**（赋值前抛出；`this.transport` 是旧代或 undefined） | 不适用 |
| hello 超时（L650） | 可能存活 | 本轮范围外（hub 侧自有 HELLO_TIMEOUT fatal 关闭其半边；双侧同值竞速——登记为观察项，见下） |
| `onClose` 非 1002/1008（L562） | **已关闭**（close 事件即死亡证明） | no-op |
| **pong 超时（L345-350）** | **存活但失联**（活性失联 = 单侧僵尸） | **必须** |

只有 pong 超时存在「活性已判死、传输仍开、对端（hub）只认 close 事件收口」的僵尸组合——review 修订正对此面。改公共路径会使 onClose 入口的代际/退订时序一起变（无红灯锚覆盖、AC2a/AC2b 锚定现状），半径不必要地扩大。**裁决：新增 pong 专属入口。**

### 设计（伪码）

```ts
// peer-connection.ts —— liveness 回调改接（L345-350）：
onPongTimeout: () => { this.onPongTimeoutDetached(); }

/** R4（PR #165）：pong 超时 = 活性失联——同步关闭并代际安全脱离当前 transport，然后才重连。 */
private onPongTimeoutDetached(): void {
  if (this.stopping) return;
  if (this.connStateValue !== 'ready') return;   // 已被 stop/blocked/backoff 收口的迟到超时——零动作
  // ── 收口次序（与 dialNow 卫生序同族，全部幂等）──
  this.stopLivenessNow();                        // ① ping loop / pong timer 停（N1）
  this.clearGoawayDrain();                       // ② N1：GOAWAY drain deadline 与失联回收互斥（见下）
  const transport = this.transport;
  this.unsubscribeTransport();                   // ③ 旧 socket 回调退订（卫生）
  if (transport !== undefined && !transport.closed) {
    transport.close(1001, 'pong-timeout');       // ④ close code 对齐 hub 侧行为（hub-connection.ts:295 同码同因）
  }
  this.connectionEpochValue += 1;                // ⑤ 代际前移——迟到 message/close 结构性迟到（退订为主防线，代际为兜底双保险）
  this.onTemporaryFailure();                     // ⑥ 清 hello/reset timer、attempts+1、投影 backoff、controllers.onConnectionLost（含 R3 同步静默）、武装 backoff
  if (this.outbound !== undefined) {             // ⑦ 投影后 dispose——onDataShed 声明经 sendControl 非 ready 门 → 零出站噪声（enterBlocked 同款纪律）
    this.outbound.dispose();
    this.outbound = undefined;
  }
}
```

**关闭序论证（binding）**：
- ①② 先行：任何 timer 先清，防收口途中自我重入；
- ③ 先于 ④：close 事件（异步送达）到达时监听已摘除——peer 侧零后续处理；hub 侧由 close 事件驱动 `onTransportClosed → cleanupAll`（R3 同步静默 + dropConnection）——`hub.connections` 即刻清理（R4-1 A4c）；
- ⑤ 代际安全：即便未来出现「退订失效」路径（如 adapter 违约复用 listener 集合），epoch 闸仍结构性丢弃旧代回调——与 dialNow 前缀（L195-201）同一卫生序，dialNow 到期时重执行全部步骤为幂等 no-op；
- ⑥⑦ 顺序敏感：**先投影后 dispose**——dispose 的逐 ns `onDataShed` 触发 `declareLocalResync → sendChecked → sendControl`，此时 connState 已 `backoff`（非 ready 门，peer-connection.ts:499）→ 零出站帧；反序会在垂死传输上发出 RESYNC 噪声（enterBlocked L584-587 注释既有纪律）。

**GOAWAY 交互（N1 互斥）**：drain 窗口（`goawayActive`、state 仍 ready）内 pong 超时 → 本入口收口传输并 `clearGoawayDrain()`——drain deadline 的职责（静默 + close + 回退重连）已被失联回收完整承担，迟到的 deadline 触发只剩重复 close（有 closed 守卫）与重复 quiesce（幂等），清除之符合 N1「零悬挂 timer」。重连后 `dialNow` 复位 `goawayActive = false`（L194 既有）——SERVER_RESTARTING 的恢复语义由重连 reconcile 兑现。

**登记观察项（本轮不改、不开票阻断；N2 处置）**：hello 超时路径的 peer 侧传输不关（依赖 hub 侧同值 HELLO_TIMEOUT fatal 兜底关闭对端半边，双侧 10s 同值存在竞速窗口）。SA5/SA6 未将其列为修订项、无红灯锚；记录于本设计防后续误判为缺陷遗漏。**处置建议**：随本轮 REPORT.md 开跟踪票（总控决定是否立项——非本轮交付面）。

### 锚通过性推演

- **R4-1**：`advanceBy(1000+500)` → pong timer fire（同步回调栈）→ ⑥ 置 backoff——同一栈内 ④ 已执行 → `wire1.peerSideClosed === true` ✅；`await settle()` 后 close 事件（fake wire queueMicrotask 送达 hub）→ hub `onTransportClosed → cleanupAll → dropConnection` → `hub.connections.length === 0` ✅（backoff random=0.99 → 99ms 观察窗内不重拨）。
- **R4-2**：`advanceBy(100)` → dialNow → wire2 → ready/live；`hub.connections.length === 1`（旧连接已 drop）✅；wire1 迟到 RESYNC 注入 → ③ 已退订（且 ⑤ 代际闸）→ ready/live 保持 ✅（A4b 双模型回归面）；失联窗口 `writeHub({n:9})`（fixture 直写 hub 文档，hub channel 已被 R3 静默——零死连接投递）→ 重连 re-OPEN mode1 → state-vector round → hub diff 含 n=9 → 双侧 `rootValue('peer','n') === 9` ✅（A4d 无静默丢失）。`stop()` 收尾零 timer 残留（liveness 已停 + backoff timer 由 stop 清）。

---

## §D5. R5 — round-robin 有界整轮扫描（drain 循环改造）

### 设计（伪码，替换 drain 数据循环 L205-233 骨架）

```ts
drain(): number {
  let lastControlSeq = 0;
  while (this.controlQueue.length > 0) { ... }          // 控制排空（不变——恒先于 data）
  let consecutiveSkipped = 0;                            // R5：连续 blocked 跳过计数
  while (!this.paused && this.queuedDataCount() > 0) {
    if (consecutiveSkipped >= this.dataOrder.length) {   // R5 有界：连续扫过一整轮（当前注册数）零派发 → 本轮无进展即止
      return lastControlSeq;
    }
    const nsId = this.nextDataNamespace();               // 游标持久推进（不变）
    if (nsId === undefined) return lastControlSeq;
    if (this.deps?.canDispatchData !== undefined && !this.deps.canDispatchData(nsId)) {
      consecutiveSkipped += 1;                           // R5：跳过 blocked ns——不终止整轮（原 L208-210 return 删除）
      continue;
    }
    consecutiveSkipped = 0;                              // 有派发即归零——饥饿界 = 连续一整轮无派发
    ...派发一帧（bucket shift / 空桶注销守卫 / emitOne + onDataDispatched——全部不变）...
  }
  return lastControlSeq;
}
```

### 不变量与终止性（binding）

1. **有界**：两次成功派发之间至多 `dataOrder.length` 次 skip（游标每 skip 前进一格，扫过一整轮即所有注册 ns 皆 blocked）；比较用**当前** `dataOrder.length`（`unregisterDataNamespace` 使之收缩——收缩只让界更紧）。全阻塞场景：`enqueueData` 触发的 drain 至多扫一轮即 return，零派发、零死循环（A5b/D3 伴生锚）。**N4 假设钉死**：该界依赖「drain 循环体内 `dataOrder` 不增长」——当前结构性成立：循环体回调面（`onDataDispatched` → 通道记账 + ACK 计时器武装；`emitRaw` → `transport.send`）**零 `enqueueData` 调用点**（flushQueued 只在 ACK/恢复路径，不在 drain 内触发）；且 `registerDataNamespace` 对既有 ns 幂等——只有「派发回调内注册**全新** ns」才破坏本界。若未来引入该类路径，须改用进入本轮时的快照长度为界。
2. **公平性保持**：无 blocked ns 时 `consecutiveSkipped` 恒 0 → 与现实现逐行为等价（每轮每 ns 至多一帧、持久游标、空桶保留 NB2）——AC5-RR 锚 `[a,b,a,b]` 不受影响。
3. **不退化为逐 ns 排空**：skip 只跳过、不排空；派发节奏仍由游标轮转约束（A5c）。
4. **SA7 D3 改写锚**（sa7-hardening-dynamic L507-542）：`[W,X blocked] + Y 就绪`——第 4 笔 enqueue(Y) 的 drain 自游标起 skip W/X（各 +1，2 < 3）→ Y2 同轮派发 → emissions = 2 ✅；「全阻塞有界」伴生锚：3 ns 皆 blocked → 首个 enqueue 即 skip 达界 return，advanceBy(100) 检查点 drain 同样达界——零派发 ✅。
5. **与 R2 无冲突**：控制帧仍在数据循环前排空（AC5-PRI）；与 R1 的 drain 调用点无冲突（拒纳路径提前 return 不触 drain）。

---

## §D6. R6 — UpdateChannel 溢出判定计入 pending handoff（count/bytes 双口径）

### 设计（伪码）

```ts
// update-channel.ts 新增字段：
private pendingDataBytes = 0;   // 已 handoff 未派发字节合计（与 pendingDataCount 同生命周期）

// overflows 双口径（L127-133 改造）：
private overflows(incoming: Uint8Array): boolean {
  const pending = this.inFlight.size + this.queued.length + this.pendingDataCount;      // R6：count 纳入 pending handoff
  if (pending >= this.host.limits.maxQueuedUpdateCount) return true;
  let pendingBytes = this.queuedBytes + this.pendingDataBytes;                          // R6：bytes 纳入 pending handoff
  for (const bytes of this.inFlight.values()) pendingBytes += bytes.byteLength;
  return pendingBytes + incoming.byteLength > this.host.limits.maxQueuedUpdateBytes;
}

// 四出口同步（漏任何一处即与 A7 记账锚冲突）：
private handoff(bytes: Uint8Array): void {
  if (bytes.byteLength > this.host.limits.maxUpdateBytes) return;
  this.pendingDataCount += 1;
  this.pendingDataBytes += bytes.byteLength;                                            // 出口 1（+）
  this.host.enqueueUpdate(bytes);
}
onDataDispatched(bytes, sequence): void {
  this.pendingDataCount -= 1;
  this.pendingDataBytes -= bytes.byteLength;                                            // 出口 2（−）——bytes 参数既有
  ...
}
onDataShed(): void {
  this.pendingDataCount = 0;
  this.pendingDataBytes = 0;                                                            // 出口 3（清零——shed = 已 handoff 未派发面全弃）
  ...
}
teardown(): void {
  ...
  this.pendingDataCount = 0;
  this.pendingDataBytes = 0;                                                            // 出口 4（清零）
  ...
}
```

**与 R1 的闭环（B1 修复后成立）**：OutboundQueue 拒纳路径（§D1）触发 `onDataShed` → `pendingData` 双字段清零——handoff 后被拒纳的帧不留幽灵记账。**队列侧不变量（R6 记账正确性的前提，SA2 B1 钉死）**：`onDataShed(ns)` ⇒ 该 ns 的 handed-off-未派发面（OutboundQueue 队列侧）**已全弃**——§D1 拒纳分支先清幸存桶再显影、`shedNamespace`/`dropData` 整桶丢弃后显影、`dispose` 逐 ns（仅 queued>0 的桶）显影后 `clear()`，三处均满足。channel 侧 `pendingDataCount/pendingDataBytes` 恰对应 handed-off-未派发帧——面全弃后清零才不产生负记账（R1-3 锚断言 (b) 直测）。**已知例外注记**：drain 的单帧编码错路径（frame-io.ts L226-231）对该帧 shift 后 emit 失败 → `onDataShed(ns)`，若同 ns 有幸存兄弟帧则不变量同破——该路径结构性不可达（handoff 前 `maxUpdateBytes` 门 + validate 预算链，L228 注释自证）；若未来变为可达，须改为逐帧减记或同批弃桶，此处登记防 SA4 误报与未来引入回归。`abandonInFlight`（§10.4）不动 pending 字段（其域为 in-flight），窗口不变量（L56 / L153）已含 pendingDataCount，不变。

### 锚通过性推演

- **R6-1**（count）：`maxInFlightUpdates=8`、gate 置停 → #1 派发（inFlight 1）+ #2–#8 handoff（pending 7）→ #9 窗口满（1+7=8）入队路径 → overflows：`1 + 0 + 7 = 8 ≥ maxQueuedUpdateCount(6)` → 溢出 → live 路径 `needsResync + declareLocalResync`（hub 侧为 declareHubResync——bootReview 是 hub 写下行 → hub 声明）→ RESYNC ≥ 1 ✅（现实现 `1+0 < 6` → 入队 → 红）。
- **R6-2**（bytes）：同构造 + `maxQueuedUpdateBytes = 4L` → overflows：`0 + 7L + L + L = 9L > 4L` → 溢出 → RESYNC ≥ 1 ✅。
- **A7 窗口锚 / flushQueued / F1** 保持绿：F1（maxQueuedUpdateCount=1）旧口径 `inFlight(1)+queued(0) ≥ 1` 本就溢出——行为不变；窗口不变量循环条件未动。

---

## §D7. R7 — 确定性 seam：生产重建走 deferTask；driver 显式 flush 泵（废除 512 跳）

### 裁决背景

SA6 红灯契约将 driver 的 512 跳字面改为命名常数 `DEFER_MICROTASK_HOPS = 512` 并保留跳数链机制。**总控裁决：命名常数不满足修订要求——「不得依赖 512 跳微任务链魔法」针对的是机制（以不透明跳数链祈祷时序窗），不是常数拼写**。本设计废除跳数链，落位**显式 scheduler/flush seam**。SA6 已完成的测试侧改动（B-1 等待窗放宽至 settleUntil、A2 注释更新、`BootOptions.deferTask` 注入面）是本裁决的有效子集，全部保留。

### 生产侧（src，SA3 执行）

```ts
// peer-connection.ts L617-642 requestRebuild 尾部：
// 注释改写：删除「重建调度保持单跳 queueMicrotask…seam（deferTask/TEST_DEFER 512 跳）只作用于
// ACK-timeout 恢复路径…不作用于本单跳调度点」整段，替换为：
// 「R7（PR #165）：重建调度经 deferTask seam——生产缺省单微任务（行为等价）；测试经 driver
//  显式 defer 泵注入（flush 仅在等待谓词未决时发生——可挂起、可观测，零跳数魔法）。」
this.deferTask(() => {                       // 原 L638: queueMicrotask(...)
  this.rebuildPending = false;
  if (!this.stopping) this.dialNow();
});

// peer-namespace.ts L688-689 注释改写：「测试经 driver 注入 512 跳 TEST_DEFER——needs-resync
// 投影先可观测」→「测试经 driver 注入显式 defer 泵——needs-resync 投影先可观测（谓词先于冲刷）」。
```

生产缺省行为不变（`defaultDefer` = 单次 `queueMicrotask`，L34-37 不动）；`src/` 中 `queueMicrotask` 仍仅 `defaultDefer` 定义一处（A7d grep 锚）。

### driver 侧（测试基建，SA3 执行）

**机制：defer 泵 = 显式队列 + 显式 `flush()`；唯一自动冲刷点 = `settleUntil` 谓词未决时（谓词先行）。`settle()` 永不冲刷。**

```ts
// test/harness.ts（测试基建单点）：
export interface DeferPump {
  readonly defer: (task: () => void) => void;   // 入队——零隐式执行、零跳数链
  flush(): void;                                 // 显式冲刷：FIFO 执行至队列稳定（冲刷中新入队任务同轮 drain，上限 1000 防自旋）
  readonly pendingCount: number;
}
const deferPumps = new Set<DeferPump>();         // 模块级注册表（vitest 按文件隔离模块图——跨文件零共享）
export function makeDeferPump(): DeferPump {
  const queue: Array<() => void> = [];
  return {
    defer: (task) => { queue.push(task); },
    flush() {
      for (let round = 0; queue.length > 0 && round < 1_000; round += 1) {
        const batch = queue.splice(0);
        for (const task of batch) task();
      }
    },
    get pendingCount() { return queue.length; },
  };
}
export function registerDeferPump(pump: DeferPump): void { deferPumps.add(pump); }

// settleUntil 语义升级（R7——签名/预算不变）：
export async function settleUntil(predicate: () => boolean, what: string, budget = 3_000): Promise<void> {
  for (let index = 0; index < budget; index += 1) {
    if (predicate()) return;                     // ① 谓词先行——同步投影（needs-resync 等）先于任何冲刷可观测
    for (const pump of [...deferPumps]) pump.flush();   // ② 仅在等待未决进度时冲刷延迟任务（恢复轮/重建拨号由此推进）
    if (predicate()) return;                     // ③ 冲刷效果同步可见即返回
    await Promise.resolve();
  }
  throw new Error(`settleUntil 预算耗尽：${what}`);
}
// settle() 保持纯微任务排空——不冲刷（「单次 settle 内恢复不推进」既有可观测序保持）。
```

```ts
// test/driver.ts：
// 删除 DEFER_MICROTASK_HOPS 常数与 TEST_DEFER 跳数链（L399-418 整块替换为泵装配）。
const pump = makeDeferPump();
registerDeferPump(pump);
createPeerReplication({
  ...,
  deferTask: opts.deferTask ?? pump.defer,       // boot() 与 bootFanout() 两处同款；BootOptions.deferTask 覆盖面保留（R7-1 latch）
});
// Run 暴露 readonly deferPump（手动 flush 观测面；R7-1 类测试可用 pendingCount 断言零隐式执行）。
```

### 既有语义窗的结构性保持（binding 论证）

原 512 跳窗承诺两条：**(a) needs-resync 投影先可观测**；**(b) 延迟任务出现于 settle()（300 跳）之后、settleUntil(3000) 预算内**。泵方案：

- **(a) 结构化成立**：投影是 `onAckTimeoutFired` 的同步 `setState`，先于 `deferTask` 调用；`settleUntil` 每轮**先查谓词后冲刷**——任何 `waitNamespace('needs-resync')` 在冲刷发生前即返回；`settle()` 根本不冲刷。
- **(b) 收窄为「显式等待时推进」**：延迟任务在**第一个**谓词未决的 settleUntil 轮次执行（原为第 ~512 跳）。核对全部依赖面：
  - `ac6-resync-close:73-101`：`advanceMs(200)`（含 settle，不冲刷）→ `waitNamespace('needs-resync')`（① 即中）→ `waitPeerSent('SYNC_STEP1', 2)`（② 冲刷启动恢复轮）✅；
  - `r3-r4-regressions:41-42/130/290`、`g3-g4 AC4/AC6-3`、`sa4-f1-f2-f3:51`、`sa7-dynamic W2/D1`：全部经 Run `waitXxx`（settleUntil 族）或同步 RESYNC 路径（不经 defer）✅；
  - 重建面（`ac1:284-287`、`ac6:135-141`、`g1-g2 AC2a/AC2b`、`spec-b1-b2 B-1`、`sa7-dynamic B2a:264-267`）：全部 `waitNamespace/waitConnection/settleUntil` 等待 → ② 冲刷触发 `requestRebuild` 的延迟拨号 → dialCount+1 ✅（B-1 已由 SA6 放宽为 settleUntil——与本机制严丝合缝）；
  - **无既有锚依赖「settle() 内完成延迟任务」**（512 > 300 使其结构性不可能）——收窄零破坏面。
- **确定性**：任务执行时点 = 显式 flush 调用点（可枚举：settleUntil 未决轮 / 测试手动），无跳数链、无真实时间。
- **N1 约束（并发 Run）**：注册表冲刷语义 = 「等待进度即时间前进」对**全部已注册泵**生效——顺序测试风格（每测试单活跃 Run）下唯一被冲刷的就是自身；闲泵冲刷为 no-op。**约束声明：同一测试内并发驱动多个 Run 且需要相互独立的延迟时序时，不得依赖共享注册表——必须经 `BootOptions.deferTask` 为各 Run 注入手动泵**（R7-1 latch 模式即其先例）。

### grep 验收锚（B2 修订：模式定向——不误伤冻结契约值与合法调用）

首版三条锚中 #1/#3 **事实性不可满足**（SA2 B2 实测）：`grep "512"` 必中 6 处冻结契约值（`src/types.ts:22,28` 的 `// 512 KiB` 注释、`src/defaults.ts:20,26` 与 `test/harness.ts:130,136` 的 `512 * 1024`——maxUpdateBytes/highWater 冻结缺省，**不得动**）；`grep "queueMicrotask"` 必中 `src/testing.ts:18,25` 两处**合法调用**（导出的内存双工 transport 微任务投递，必须保留）与 `types.ts:130`/`peer-connection.ts:34` 注释。按 SA2 §1-B2 替换为可满足且更精确的定向锚：

```bash
# 锚 1（叙事清理面——首版 #1/#3 合并替换）：512 跳叙事/跳数链标识零残留。
#    B4 修正（SA2 R2.2）：清理前命中实测全列 = 11 处 / 5 文件，逐处落入清理面：
#      driver.ts:131（BootOptions.deferTask 注释更新——§C driver 条目已含）、
#      driver.ts:400/407/408/413（TEST_DEFER 跳数链块整删）、
#      driver.ts:467/619（boot/bootFanout 泵装配 deferTask: pump.defer）、
#      peer-connection.ts:636（requestRebuild 注释改写）、peer-namespace.ts:689（注释改写）、
#      review-red:13（配套注释同步①）、spec-b1-b2-red:90（配套注释同步②——B4 新增属主）。
#    11 处全部清理后零命中。
grep -rn "512 跳\|TEST_DEFER\|DEFER_MICROTASK_HOPS" packages/ws-replication          # → 0 命中

# 锚 2（首版 #2 保留）：显式泵标识零残留（同上超集，双保险）。
grep -rn "DEFER_MICROTASK_HOPS" packages/ws-replication                              # → 0 命中（review-red:13 与 spec-b1-b2:90 两处注释同步，见配套注释同步①②）

# 锚 3（调用点定向——排除 testing.ts 合法面后的生产调度点唯一性）：
#    grep -v 过滤后唯一命中应为 defaultDefer 定义处；注释中的词形（无 ASCII '('）天然排除。
grep -rn "queueMicrotask(" packages/ws-replication/src | grep -v "src/testing.ts"    # → 恰 1 命中：peer-connection.ts:36（defaultDefer）

# 锚 4（冻结值防回归——B2 新增）：512 * 1024 冻结缺省值零改动（base = 0a18661，R2-N3）。
git diff 0a18661..HEAD -- packages/ws-replication/src/defaults.ts packages/ws-replication/test/harness.ts \
  | grep -c "^[+-].*512 \* 1024"                                                     # → 0（maxUpdateBytes/highWater 冻结值不动）
```

**配套注释同步（B4 修订后共两处，均注释级、断言与测试体零改动）**：
① `ws-replication-review-revisions-r1-r7-red.test.ts` 头部 R7 注释句「driver 无 512 魔法（改为显式命名常数 DEFER_MICROTASK_HOPS，见 driver.ts）」随泵机制落地过时——SA3 做**注释同步**（改为「driver 无 512 魔法（显式 defer 泵 flush seam，见 driver.ts/harness.ts）」）。
② `ws-replication-spec-b1-b2-red.test.ts` **L90** B-1 注释句「重建调度经 deferTask seam（测试侧 DEFER_MICROTASK_HOPS=512）——」（SA6 本轮为 B-1 放宽所写）——同样过时，SA3 做**一行注释同步**（改为「重建调度经 deferTask seam（测试侧显式 defer 泵）——」，等待语义 settleUntil 表述保留），**断言与测试体零改动**（SA6 契约面冻结）。

---

## §D8. R8 — 权威文档四缺口 + 陈旧叙事清理（精确清单）

**权威源分层（binding）**：wire/行为契约的规范文本 = `docs/protocols/instance-replication-v1.md`（§22 conformance 的被引对象）；ADR 0010 = 决策记录 + append-only 修订节（历史不删改，只追加）；phase-5 = 交付切片终态规范。**所有新增规范句落 protocol；ADR 只追加一节登记决策并指针引用——不在两处复写规范文本（避免 #164 交叠分叉）。**

### A8a — 公共受信身份投影（protocol §2 增句）

`docs/protocols/instance-replication-v1.md` §2（L38 段后）增：

> Hub 的公共身份投影（`HubConnection.peerInstanceId`）只消费 Upgrade 认证产生的受信身份，绝不采信 HELLO 自述身份；宿主 `accept` 未提供受信身份即接线缺陷——实现必须响亮拒绝（同步 TypeError），不得降级为匿名或 wire 自述会话。

依据（既有行为，无新语义）：hub-connection.ts:78-95（TypeError + `peerInstanceId = this.trust.peerInstanceId` L269）+ g1-g2 AC1 锚（INSTANCE_IDENTITY_MISMATCH）。§6.1 L120 字段注「必须等于 Upgrade 身份」已有，不动。

### A8b — transport facet 契约（protocol §17 观察段扩写 + ADR 追加节指针）

§17 L492 段（Adapter 观察面）扩写为：

> 传输 Adapter 暴露三个可选能力面：`bufferedAmount`（socket 未冲刷字节；缺面视为 0——背压水位退化为不可观察，数据总量仍受准入与 1011 收口）、`ping` / `onPong`（WS 级活性；缺面 = 无活性面，零 timer 的 dormant 降级）。生产 Adapter 必须暴露三面；组合根在装配期对缺面做响亮断言（应用层缺面 = 配置错误，非运行时降级——见 issue #164）。

ADR 0010 追加节登记该契约的决策归属（指针到 protocol §17/§18），**不重复数值**。与 #164 票面的单一权威源 = protocol。

### A8c — liveness 缺省与约束（protocol §18 增句）

§18 L518「WS ping interval/pong timeout」条目后增：

> 工程缺省：`pingIntervalMs = 30_000`、`pongTimeoutMs = 10_000`；约束 `pongTimeoutMs < pingIntervalMs` 在配置解析期响亮验证（TypeError），绝不运行时 clamp。pong 超时按临时失败处理：关闭传输（close code 1001）并经 backoff 重连。

依据：defaults.ts:39-40、validate.ts:161-166、hub-connection.ts:293-296（hub 侧既有）、本设计 §D4（peer 侧对齐）。

### A8d — 背压边界终态口径（protocol §17 回写，依赖本设计 §D1/§D2/§D5/§D6 裁决）

**B3 修订（SA2）**：首版「扩写为」若被 SA3 执行成整段替换，将**无声丢失**原段两句既有冻结不变量——「control/error/ACK高优先级」（AC5-PRI 锚的行为基础）与「data每轮每 namespace最多一个」（AC5-RR 锚）。改写方式定为**合并文本**：原段第一句**逐字保留**，新终态口径句**追加其后**；原段第二、三句（shed 到低水位、控制保留额度）被新文本的更精确表述覆盖（语义超集）。§17 L490 段改写后全文：

> Connection使用 per-namespace队列和 round-robin：control/error/ACK高优先级，data每轮每 namespace最多一个。总队列记账 = 每 namespace 排队字节 + socket `bufferedAmount`（连接级 pipeline）。溢出触发时按最大排队 namespace 整队丢弃至 queued 侧 ≤ low-water——shed 只作用于排队侧（socket 缓冲不可撤回，由水位暂停与 1011 承接）；**严格接纳**：shed 后（或空队列时）接纳 incoming 仍会越限则拒纳该帧并同批丢弃该 namespace 幸存排队帧，以 needs-resync 声明显影（不静默吞、不静默纳）。Control frame 使用独立保留额度 `maxQueuedControlBytes`（缺省 8 MiB；必须 ≥ `maxBootstrapBytes` + 协议开销），额度按 socket 缓冲内未冲刷控制字节计，耗尽为 `CONNECTION_BACKPRESSURE`（close 1011）。水位检查点间隔 = `max(1, floor(ackTimeoutMs / 100))`。round-robin 派发扫描有界：单轮内队首 namespace 窗口满只跳过该 namespace，连续一整轮无可派发 namespace 才停止本轮。

§17 校验清单代码块（L496-504）增两行：

```text
maxQueuedControlBytes >= maxBootstrapBytes + protocol overhead
maxQueuedBytesPerConnection >= highWater   # 既有链式不变量（validate.ts L147-151 已实现，文档补记）
```

**doc-diff 核对项（B3 新增，见 §V.5）**：改写后 `docs/protocols/instance-replication-v1.md` §17 必须仍含「高优先级」与「每轮每 namespace最多一个」两短语（grep 定位）；原段第一句逐字节保留。

### A8e — 陈旧阶段/红灯叙事清理（精确移除清单）

**移除/改写（仅 `docs/phases/phase-5-websocket-replication.md` L75-83 两处）**：

| 行 | 现文本（阶段叙事成分） | 改写为（终态规范句） |
|---|---|---|
| L75 | `**切片 3/4 落地锚定（issue #134 已接受；零改形）**：` | `**切片 3/4 落地锚定（冻结词汇）**：` |
| L81 | `**切片 3「needs-resync 通知」对账注记（SA8 放行条件 C-1，issue #134 round 2 改写——撤销 round-1「本切片无队列 ⇒ ADR 0010 L113 唯一触发面结构性不可达；needs-resync 与队列属主 = 切片 6」读法）**：needs-resync 于本切片落地——…` | `**needs-resync 通知归属**：needs-resync 于切片 3 落地——fanout 投递队列为切片 3 属主（每 session 有界 16 项冻结常量、溢出弃新置 status.needsResync——sticky、标记后继续投递）；WS 发送队列/连接级背压属切片 6（ADR 0010 L151 域）。`（终态归属句保留全部冻结词汇，删除 SA8 放行条件/round-N 撤销叙事） |
| L83 | `**切片 3/4 锚定节追加（issue #134 round 2 冻结词汇）**：fanout 投递异步化 = …` | `**切片 3/4 冻结词汇（补充）**：fanout 投递异步化 = …`（正文逐字保留——均为终态规范内容） |

**明确不移除（合法历史，append-only 纪律）**：
- `docs/adr/0010-*.md` L228-291 既有修订节（issue #134 / #133 各节）**逐字保留**——ADR 修订节是 append-only 历史记录，「round-2 改写——撤销 round-1」在 ADR 语境是合法的决策谱系；
- phase-5 文档中对 ADR 修订节的**指针式引用**（如 L52「与 ADR 0008 issue #132 修订节一致」）保留——引用不是叙事；
- `REPORT.md` / `wiki/raw/*` 任务工件不属公共权威文档：REPORT.md 由本轮重写（其「遗留问题 2」的 overflows 口径观察因 R6 落地而消除，新报告相应收口）；wiki 任务工件不动。

**grep 验收锚**：`grep -rn "红灯\|SA6 契约\|SA8 放行\|撤销 round" docs/phases docs/protocols` → 零命中；`grep -rn "round-1\|round 1" docs/phases docs/protocols` → 零命中（ADR 0010 修订节除外——其域为 `docs/adr/`，不在清理面）。

### ADR 0010 追加节（新增，append-only）

文末追加：

```markdown
### issue #161 round 2 修订（PR #165 review 八项——2026-08-30）

本节登记 ws-replication 实现层的八项 review 修订决策；wire 契约以
`docs/protocols/instance-replication-v1.md`（§2/§17/§18 本轮扩写）为唯一权威：
公共身份投影只取受信 Upgrade 身份（缺身份 accept = 响亮 TypeError）；transport
三可选面（bufferedAmount/ping/onPong）缺面 dormant 语义与生产装配期断言；liveness
缺省 30s/10s 与 pongTimeout < pingInterval 构造期校验；背压终态口径（pipeline =
queued+buffered、shed 仅 queued 侧、严格接纳 + onDataShed 显影、控制独立保留额度
maxQueuedControlBytes 缺省 8MiB、有界整轮扫描、pending handoff 计入 per-ns 溢出
双口径、checkpoint = max(1, floor(ackTimeoutMs/100))、1011 终止）；peer pong 超时
close(1001) + 代际安全脱离后重连；GOAWAY/blocked/连接收口同步静默订阅先于异步
drain。实现证据：`packages/ws-replication/src/*`（PR #165 round 2）。
```

### 附带注释对齐（N5 升级为必做——两层语义入注）

A8b 落地后，`types.ts` L57-62 facets 注释与 A8b「生产装配期响亮断言」存在双口径误读空间（缺面 = dormant vs 缺面 = 配置错误）。**必做**：`types.ts` facets 注释改写为两层语义——「**运行时**：内存/测试 transport 缺面 = 能力缺失的 dormant（正确降级）；**生产组合根**（#164）：缺面 = 配置错误，装配期响亮断言（不允许存在）」；`defaults.ts` L29-31「协议 §18 只列配置项…均无数值规定」注释随 A8c 落地改为「缺省与约束见 protocol §18」。`frame-io.ts` §3.2/§3.3 注释块按 §D1/§D2 终态口径同步（断点接纳注释删除）。

---

## §D9. F1 增补（SA7 §2）— 滞回接纳帧的 pendingData 负记账：wipe-credit 修复

### 9.0 缺陷复述与根因（SA7 §2 证据，设计确认——**设计级缺口，非实现走样**）

**触发链**（A2 滞回接纳路径——**与 B1 拒纳路径不同**）：channel `handoff()` 在调用 `host.enqueueUpdate`（→ 连接层 `sendData` → `outbound.enqueueData`）**之前**已 `pendingDataCount += 1`；`enqueueData` 内部触发面先执行 **shed 循环**——victim = 本 ns 时 `shedNamespace` → `onDataShed(ns)` → channel `pendingDataCount/Bytes` **清零（连同 incoming 的先计 +1）**；随后再判定 `post-shed pipeline + bytes ≤ max` → **滞回接纳**（入桶，不重记）；恢复期派发 → `onDataDispatched` 再减一 → **pendingDataCount = −1**（SA7 D2 锚终态直测）。

SA7 D2 场景算术：max 64KiB / lowWater 1KiB——#2..#7 滞留桶内 ≈49.5KiB + buffered ≈8.2KiB + #8 8.2KiB > 64KiB → shed 弃整桶（6 帧）+ onDataShed（pending 7→0，含 #8 先计）→ 再判定 16.4 ≤ 64 → 接纳 #8。**B1 的 R2 修复只覆盖拒纳分支（该分支帧被弃，清零语义正确）；滞回接纳分支的「清零发生在先计之后、接纳之前」窗口未被覆盖**——SA4 §2 R1 攻击点②推演的「回调窗口内幸存帧被派发」不可达（SA7 D2 动态证实），但「shed 后接纳帧的**迟后**派发」路径漏审。

**SA7 已冻结锚（commit `218ca3a`，断言不可改）的语义约束**——修复必须同时满足三组观测：
- L403：#8 写完成后 `pendingData() === 0`（「shed 清面后归零」）；
- L407：#9/#10 被 needsResync 门弃后 `pendingData() === 0`；
- L430（破坏性锚）：恢复派发 #8 后 `pendingData() ≥ 0`。

**推论（修复形态的硬约束）**：滞回接纳帧在桶内期间 **不得计入 `pendingDataCount`**（否则 L403/L407 读 1 违约）——即 SA7 §2 修复方向 (a) 的字面形态「accept 后重新计入 pending」**会使 L403/L407 转 1 而破坏冻结锚**；同时该帧派发时 **不得走无条件减记**（否则 0−1 = −1 违约 L430）。唯一自洽解：**该帧以「未计数」状态入桶（观测面 pending 恒 0），派发时经独立信用（credit）跳过减记**。

### 9.1 设计：increment-before + wipe 检测 + 派发信用（update-channel 单点记账 + 判定回传链）

**(1) 判定回传链（disposition chain）——`enqueueData` 及其上游返回接纳布尔**：

```ts
// frame-io.ts：enqueueData 契约扩展（三 return 点）
enqueueData(namespaceId: string, message: ReplicationMessage): boolean {
  // …触发面/shed 循环/B1 拒纳分支（§D1 R3 版不变）…
  //   拒纳分支：清幸存桶 + 无条件 onDataShed → return false;   // ← 帧已弃 + 已显影
  // …正常/滞回接纳：push + queuedDataBytes += … + drain + ensureCheckpoint → return true;
}

// 接线链（内部 host 接口——非冻结公共面；类型 void → boolean）：
//   update-channel.ts   UpdateChannelHost.enqueueUpdate(bytes): boolean
//   hub-namespace.ts    HubChannelHost.sendData(message): boolean
//                       + enqueueUpdateFrame 改 return（超限早退 → return false——防御性
//                         双门，channel 侧 handoff 先行门已拦，结构性不可达）
//   peer-namespace.ts   PeerNamespaceHost.sendData(message): boolean
//                       + enqueueUpdateFrame 改 return（同上）
//   peer-connection.ts  private sendData(message): boolean
//                       （outbound undefined → return false；非 ready → onConnectionDataShed
//                         显影后 return false；ready → return this.outbound.enqueueData(...)）
//   hub-connection.ts   **零文本改动**——L181 接线为表达式体
//                       `(message) => this.outbound.enqueueData(...)`，类型放宽后布尔自动回流
//                       （实现期验证注记：若实际非表达式体，须回 SA1 扩 ALLOW 后方可触碰）
```

**(2) update-channel.ts 记账修复（核心，单文件）**：

```ts
// 新增双字段（credit 子账本——与 pendingData 同生命周期，随 R6 四出口对称维护）：
private uncountedAccepted = 0;        // F1：handoff 期间被同 ns onDataShed 清零、仍被滞回接纳的帧数
private uncountedAcceptedBytes = 0;   // 同上（bytes 口径）

private handoff(bytes: Uint8Array): void {
  if (bytes.byteLength > this.host.limits.maxUpdateBytes) return;
  this.pendingDataCount += 1;                       // 先计（无 wipe 路径：派发减记命中已计帧
  this.pendingDataBytes += bytes.byteLength;        //   ——零瞬态负值）
  // deliver/flushQueued 入口门已保证 needsResync === false（resyncBefore 恒 false——
  // 捕获为防御性断言注释，不运行时分支）
  const accepted = this.host.enqueueUpdate(bytes);  // ← 期间 shed 循环/拒纳/非 ready 门可触发
                                                    //   onDataShed（清零 + needsResync=true）
  if (!accepted) return;                            // 拒纳：onDataShed 已清零（含本帧先计）——一致
  if (this.needsResync) {
    // F1：本帧先计在 enqueueUpdate 内被同 ns onDataShed 抹除、帧仍被滞回接纳——
    // 登记信用（不重计 pending，保 D2 锚 L403/L407 = 0 观测语义）；派发时消费信用跳过减记
    this.uncountedAccepted += 1;
    this.uncountedAcceptedBytes += bytes.byteLength;
    return;
  }
  // 无 wipe：先计保留——正常路径（D2 的 #1..#7、全部既有锚路径）
}

onDataDispatched(bytes: Uint8Array, sequence: number): void {
  if (this.uncountedAccepted > 0) {
    this.uncountedAccepted -= 1;                    // F1：信用消费——本帧入桶时未计数，跳过减记
    this.uncountedAcceptedBytes -= bytes.byteLength;
  } else {
    this.pendingDataCount -= 1;
    this.pendingDataBytes -= bytes.byteLength;
  }
  this.inFlight.set(sequence, bytes);
  this.armAckTimer();
}

onDataShed(): void {
  this.pendingDataCount = 0;
  this.pendingDataBytes = 0;
  this.uncountedAccepted = 0;                       // F1：wipe 弃整桶（含未计帧）——信用同步清零
  this.uncountedAcceptedBytes = 0;                  //   （弃帧永不派发，防信用悬挂）
  this.needsResync = true;
  this.discardQueued();
}

teardown(): void {
  …既有…
  this.uncountedAccepted = 0;                       // F1：teardown 出口同清（四出口对称）
  this.uncountedAcceptedBytes = 0;
  …既有…
}

// 精确负载门（三处——窗口/溢出判定把未计帧计入有效负载，消除 off-by-one 偏差）：
deliver live 门：  this.inFlight.size + this.pendingDataCount + this.uncountedAccepted < maxInFlightUpdates
flushQueued 循环： 同上三和
overflows count：  inFlight.size + queued.length + pendingDataCount + uncountedAccepted ≥ maxQueuedUpdateCount
overflows bytes：  queuedBytes + pendingDataBytes + uncountedAcceptedBytes + ΣinFlight + incoming > maxQueuedUpdateBytes
```

### 9.2 状态/顺序/重入全枚举（binding）

| # | 场景 | 推演 | 结论 |
|---|---|---|---|
| S1 | **滞回接纳（D2 场景）** | #8 先计 7 → enqueueData：shed 弃桶 → onDataShed（pending 7→0、needsResync、credit 清 0）→ 滞回接纳 → return true → handoff 检出 needsResync → credit=1、pending 不重计。L403/L407 观测 pending 0 ✓；恢复派发 → 信用消费 → pending 0、inFlight+1 → L430 ≥ 0 ✓ | **冻结 D2 锚全绿** |
| S2 | **拒纳路径（R1-1/2/3）** | B1 分支：清幸存桶 + 无条件 onDataShed（pending→0、credit→0）→ return false → handoff `!accepted` 直接返回——不计数不信用。R1-3 (a)(b)(c) 三断言与 R3 版逐字节同形 | 既有 15 锚不动即绿 |
| S3 | **正常接纳（无 wipe）** | 先计保留；enqueueData 内同步 drain 派发时 `onDataDispatched` 减记命中**已计**帧（先计在 drain 之前完成）——**零瞬态负值**（对比「计数后移」方案的同步派发瞬态 −1，本设计结构性消除） | 窗口门读数语义不变 |
| S4 | **重入 drain**（onDataShed → declareHubResync → sendControl → drain） | shed 清面后同 ns 桶空、incoming 未 push → 重入 drain 同 ns 零派发（SA7 D2 实测「RESYNC 发射窗口零幸存派发」保持）；异 ns 派发走各 channel 独立记账，credit 不串扰 | 重入安全 |
| S5 | **credit × FIFO 混桶** | wipe 后 needsResync 阻断一切新 handoff → 未计帧是该桶代内**唯一**在桶帧；resetForLive 后新帧（已计）排其**后**（桶为 FIFO 数组）；派发序 = counted* → uncounted → counted*，减记/消费严格对位。新一轮 shed 弃桶时 onDataShed 同步清 credit（弃帧永不派发）——无错位消费、无悬挂信用 | 信用精确 |
| S6 | **精确负载门** | 三门（deliver/flushQueued/overflows）读 `pending + uncounted`（count/bytes 双口径）——未计帧计入有效负载：窗口门与 R6 溢出判定**零偏差**（无 off-by-one 放宽）；`pendingDataCount` 原字段语义与观测面不变（锚直读该字段） | 判定精确 |
| S7 | **双侧对称** | 修复落共享层（update-channel）+ 双侧 disposition 接线（hub/peer 对称同形）——peer 侧同构造可达同修复 | 对称成立 |
| S8 | **teardown/stop** | teardown 清 credit（出口 4）——stop/收口后无悬挂 | 四出口对称 |
| S9 | **非 ready 门（peer sendData）** | 非 ready：onConnectionDataShed 显影（pending→0、needsResync）→ return false → handoff 不计不信用——一致；outbound undefined → return false（此时 channel 侧 deliver 已被状态机 disconnect 投影阻断——结构性前置） | 一致 |
| S10 | **hub enqueueUpdateFrame 超限早退** | return false（不接纳）——channel 侧 handoff 先行门已拦（`> maxUpdateBytes` 早退），该分支为防御性双门，结构性不可达 | 防御一致 |

### 9.3 与 SA7 修复方向 (a) 的关系（裁决记录）

SA7 建议 (a)「accept 后重新计入 pending」的字面形态会使 L403/L407 观测 1 而**破坏冻结锚**（§9.0 推论）。本设计为 (a) 的**锚兼容精化**：wipe 检测（needsResync 翻转 + accepted 双条件）替代重计 pending，信用在**派发点**闭环——「四出口对称」以 credit 子账本随四出口维护的形式保持（登记/消费/双清零），语义等价、观测面自洽。(b)（逐帧减记）破坏 R1-3 (b) 语义、(c)（判定前置）不消除 wipe 窗口（shed 信号仍先于接纳）——均排除，与 SA7 判断一致。

### 9.4 实现与验收（文件清单增量 + 锚映射见 §C/§A/§V 增补行）

实现半径：**5 个 src 文件、hub-connection.ts 零文本改动**（表达式体接线自动回流布尔——DENY 保持）；零 SA6 锚改动（15 锚按 S2 推演不动即绿）；零 SA7 锚改动（冻结 D2 按 S1 推演转绿）。全量回归 = 包级 125 + 整仓（2002 − D2 红 = 全绿）。

---

## §A. 验收映射（全部红灯锚 → 设计节 → 实现点）

| 红灯锚（基线 failed） | 文件:测试 | 设计节 | 实现点 | 既有绿锚保持 |
|---|---|---|---|---|
| R1-1 第 9 笔拒纳（dispatchLog==8、零字节、RESYNC≥1） | review-r1-r7-red L333 | §D1 | frame-io enqueueData 严格准入分支 | — |
| R1-2 超预算单帧拒纳 | L355 | §D1 | 同上（单帧同路径） | — |
| **R1-3 拒纳丢弃幸存面（B1 新增——声明后零派发 + pendingData==0 + 窗口不变量）** | review-r1-r7-red（SA6 补写，契约见 §D1） | §D1（B1 修复） | 拒纳分支先清幸存桶再无条件 onDataShed | A7 窗口锚（回归面） |
| R2-A2a 有排队数据时控制耗尽（exhausted==1） | L412 | §D2 | 尾窗 ledger + 规则 C 析取 + sendControl ensureCheckpoint | A2-1011（g3-g4 L703） |
| R3-1 hub close 同步段 channel ≠ live | L453 | §D3 | hub onConnectionClosed.quiesceSync | — |
| R3-2 hub close 同步段订阅摘除 + companion | L464 | §D3 | 同上（quiesceSync 摘订阅置空） | — |
| R3-3 SEQUENCE_VIOLATION fatal 同步段 ≠ live | L485 | §D3 | connectionFatal → cleanupAll 同步前缀已达 | — |
| R3-4 peer blocked 同步段订阅摘除 | L504 | §D3 | peer onConnectionFatal.quiesceSync | SA7 D5 |
| R3-5 GOAWAY deadline 先静默后 close | L524 | §D3 | quiesceControllers 顺序既有 + quiesceSync | sa7 G1/G2 |
| R4-1 pong 超时同步关传输 + hub 清理 | L711 | §D4 | onPongTimeoutDetached ①–⑦ | AC2a/AC2b、sa7 D4 |
| R4-2 重拨 hub 单连接 + 迟到帧零影响 + 收敛 | L729 | §D4 | 同上 + dialNow 幂等卫生序 | sa7 D4 状态机锚 |
| D3 改写（R5）同轮派发 emissions==2 | sa7-hardening-dynamic L508 | §D5 | drain consecutiveSkipped 机制 | D3 伴生「全阻塞有界」、AC5-RR |
| R6-1 count 口径第 9 笔溢出 | L778 | §D6 | overflows + pendingDataCount | A7 窗口锚、F1 |
| R6-2 bytes 口径第 9 笔溢出 | L799 | §D6 | pendingDataBytes 四出口 | 同上 |
| R7-1 latch 未放行零拨号、放行恰 +1 | L833 | §D7 | requestRebuild → this.deferTask | spec B-1（已放宽）、ac1/ac6/g1-g2 重建锚 |
| A8a–A8e 文档验收（SA6 §5 清单） | sa6_red §5 | §D8 | docs 三件 + types/defaults 注释 | 全部既有行为锚（零改动验收） |
| **D2（F1 破坏性锚，SA7 冻结于 `218ca3a`）：滞回接纳帧恢复派发后 pendingData ≥ 0**（含 L388/L394/L403/L407 子锚与 RESYNC/幸存零派发/A7 不变量） | sa7-round2-dynamic L377-431 | **§D9** | disposition 回传链 + handoff wipe-credit + onDataDispatched 信用消费 + onDataShed/teardown 信用清零 + 三门精确负载 | 其余 D1/D3/D4/D5 锚（SA7 已绿）+ 15 锚全量（§D9 S2 逐锚推演） |

**红转绿命令**（SA6 §1 + B1 新增 R1-3，SA3 完成后全绿——**15 例**）：

```bash
npx vitest run packages/ws-replication/test/ws-replication-review-revisions-r1-r7-red.test.ts \
  packages/ws-replication/test/ws-replication-sa7-hardening-dynamic.test.ts   # 15 例（14 + R1-3）→ 0 failed
```

---

## §B. 兼容性风险评估

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| 1 | **R2 新增必填 limit 字段**：全量 `ReplicationLimits` 字面量构造点编译破坏 | 中（编译期，非运行期） | 全仓 grep 证实仅 harness `CONTRACT_LIMITS` 与 api.test-d 形状断言两处（§C 清单）；`Partial<ReplicationLimits>` 用户零破坏；repo 外无消费者（#164 组合根未落地） |
| 2 | **R1 严格接纳改变突发场景计数**：gate 期更多拒纳 + RESYNC 声明 | 低 | A2 ≤2 已推演恒 2；AC5-SHED 断言 ≥1 保持；peer 侧收敛由 needs-resync 恢复轮修复（协议 §17 语义） |
| 3 | **R7 泵使延迟任务提前执行**（首个未决 settleUntil 轮 vs 第 512 跳） | 低 | §D7 逐文件核对依赖面：无锚依赖「settle() 内完成延迟任务」（512 > 300 结构性不可能）；「needs-resync 先可观测」由谓词先行结构化保持；B-1 已预放宽 |
| 4 | **R3 hub channel 提前 `closed`**：drain 窗口内迟到续体走终态分支 | 低 | 正是 §13.4 要求（零 wire/零迁移）；`HubReplication.close()` 仍等 settleTail；hub channel per-connection 无跨代复用风险 |
| 5 | **R4 pong 收口改变失联时序**：旧 transport 提前关闭 | 低 | AC2a/AC2b 锚重建路径（requestRebuild）不受影响；G1 锚 1001-close → backoff 语义对齐；sa7-dynamic G1（GOAWAY drain close 1001 → backoff）走 onClose 路径不变 |
| 6 | **R2 sendControl 起挂检查点**：控制发送后可能新增 timer | 低 | 起挂条件既有（buffered>0）；空闲连接零 timer；sa7 W1 的 scheduler.pending 断言场景 buffered=0 不起挂 |
| 7 | **R6 更早溢出**：per-ns 上限提前 M 帧触发 | 低 | F1 锚旧口径本已溢出（推演 §D6）；A5/A7 锚计数面小 |
| 8 | **泵注册表模块级共享**（同文件多 run） | 极低 | vitest 按文件隔离模块图；同文件内冲刷闲泵 = no-op；语义 = 「等待进度时时间前进」对全部 run 一致 |
| 9 | **§D9 判定链布尔回传**：内部 host 接口三处签名 void→boolean | 低（编译期全覆盖） | 内部结构类型（非冻结公共面，`packages/ws-replication` 内 grep 证实唯一消费方 = UpdateChannel.handoff 两侧各一）；hub-connection 表达式体接线零文本改动（实现期验证注记入 §C DENY） |
| 10 | **§D9 credit 与观测面语义**：未计帧期间 `pendingDataCount` 原字段不含该帧 | 极低 | `pendingDataCount` 语义 = 「已计数未派发」——与冻结 D2 锚 L403/L407 观测语义**一致**（锚作者按此冻结）；窗口/溢出判定经三门精确负载（pending+uncounted）零偏差（S6）；A7 不变量结构成立（未计帧不在任一加数） |

---

## §V. 验证计划（SA3 实现后）

1. **红转绿**：`npx vitest run packages/ws-replication/test/ws-replication-review-revisions-r1-r7-red.test.ts packages/ws-replication/test/ws-replication-sa7-hardening-dynamic.test.ts` → **15 例**全绿（SA6 基线 14 + B1 新增 R1-3——SA6 补写后红灯基线应为 15 failed）。
1a. **F1 红转绿（§D9）**：`npx vitest run packages/ws-replication/test/ws-replication-sa7-round2-dynamic.test.ts` → **6/6 全绿**（D2 破坏性锚转绿；D1/D3/D4/D5 保持绿）。
2. **回归全量**：`npx vitest run packages/ws-replication` → **126 例全绿**（125 + SA7 D2 转绿）；整仓 `pnpm test` → 2002/2002（SA7 基线唯一红 = D2）；零 real sleep、零 unhandled rejection（既有 collectUnhandledRejections 锚）。
3. **类型面**：`pnpm test`（内含 --typecheck）零错误；api.test-d 形状断言含 `maxQueuedControlBytes`。
4. **R7 grep 锚（B2 修正后四条，§D7）**：锚 1/2（`512 跳|TEST_DEFER|DEFER_MICROTASK_HOPS` / `DEFER_MICROTASK_HOPS`）零命中；锚 3（`queueMicrotask(` 排除 testing.ts）恰 1 命中 defaultDefer；锚 4 冻结值防回归（`512 * 1024` 行 diff 为零）。
5. **R8 grep/doc-diff 锚（含 B3 新增）**：§D8e 两条 grep 零命中（phases/protocols 无红灯/round-N 撤销叙事）；ADR 0010 既有修订节 diff 为零（仅文末追加新节）；**B3 doc-diff**：protocol §17 改写后仍含「高优先级」与「每轮每 namespace最多一个」两短语（`grep -n "高优先级\|每轮每 namespace最多一个" docs/protocols/instance-replication-v1.md` ≥1 且位于 §17）；phase-5 改写面外零改动。
6. **全仓**：`pnpm test` + 聚合 `tsc --noEmit` + `git diff --check`（阶段门禁既有口径）。

---

## §C. 文件清单（File Scope）

### ALLOW LIST

生产（src）：
- `packages/ws-replication/src/frame-io.ts` — 修改：§D1 enqueueData 严格准入分支（拒纳 = 清幸存桶 + 无条件 onDataShed，~20 行）；§D2 尾窗 ledger 字段 + emitOne plane 参数 + runCheckpoint 规则 C 析取 + 裁剪 + sendControl ensureCheckpoint + clear() 单点重置（~45 行）；§D5 drain consecutiveSkipped 循环（~10 行）；**§D9 enqueueData 返回接纳布尔（三 return 点，~6 行）**；§D1/D2 终态注释同步（断点接纳注释删除）
- `packages/ws-replication/src/update-channel.ts` — 修改：§D6 pendingDataBytes 字段 + overflows 双口径 + 四出口（~10 行）；**§D9 UpdateChannelHost.enqueueUpdate 返回类型 + handoff wipe-credit（先计保留 + accepted/needsResync 双条件信用登记）+ onDataDispatched 信用消费 + onDataShed/teardown 信用清零 + deliver/flushQueued/overflows 三门精确负载（pending+uncounted 双口径，~30 行）**
- `packages/ws-replication/src/peer-connection.ts` — 修改：§D4 onPongTimeoutDetached 新方法 + liveness 回调改接（~25 行）；§D7 requestRebuild L638 改 deferTask + L634-637 注释改写（~8 行）；**§D9 sendData 返回布尔（outbound undefined / 非 ready → false + 显影；ready → return enqueueData，~5 行）**
- `packages/ws-replication/src/peer-namespace.ts` — 修改：§D3 quiesceSync + onConnectionFatal/onConnectionLost 三分支内联同步段（~20 行）；§D7 L688-689 注释改写（2 行）；**§D9 PeerNamespaceHost.sendData 返回类型 + enqueueUpdateFrame return 透传（~3 行）**
- `packages/ws-replication/src/hub-namespace.ts` — 修改：§D3 onConnectionClosed 同步段 + quiesceSync（~15 行）；**§D9 HubChannelHost.sendData 返回类型 + enqueueUpdateFrame return 透传（超限早退 → false，~3 行）**
- `packages/ws-replication/src/types.ts` — 修改：§D2 ReplicationLimits 增 `maxQueuedControlBytes` 字段（1 行 + 注释）；§D8 N5 必做——facets 注释两层语义改写（~2 行）
- `packages/ws-replication/src/defaults.ts` — 修改：§D2 缺省 `maxQueuedControlBytes: 8 * 1024 * 1024`（1 行）；§D8 L29-31 注释对齐（1 行）
- `packages/ws-replication/src/validate.ts` — 修改：§D2 positiveSafeInteger + `≥ maxBootstrapBytes + PROTOCOL_OVERHEAD_BYTES` 校验（~8 行）

测试与基建：
- `packages/ws-replication/test/harness.ts` — `[SA6 owned]` 修改：§D2 WsReplicationLimits/CONTRACT_LIMITS 增字段（2 行）；§D7 DeferPump 注册表 + makeDeferPump + settleUntil 谓词先行冲刷（~30 行）。SA3 可改基建，断言语义冻结
- `packages/ws-replication/test/driver.ts` — `[SA6 owned]` 修改：§D7 删 DEFER_MICROTASK_HOPS/TEST_DEFER 跳数链 → 泵装配（boot/bootFanout 两处 + Run.deferPump 暴露，~20 行净减）；BootOptions.deferTask 注释更新
- `packages/ws-replication/test/ws-replication-review-revisions-r1-r7-red.test.ts` — `[SA6 owned]` 已成文 13 例红灯（SA6 产出，本轮 diff 已含）+ **B1 新增 R1-3 红灯锚（SA6 补写，契约见 §D1）**；SA3 仅做头部 R7 注释同步（§D7 配套注释同步——常数引用改泵描述），断言与测试体零改动（R2 cast 字段名与裁决一致）
- `packages/ws-replication/test/ws-replication-api.test-d.ts` — `[SA6 owned]` 修改：§D2 L124-135 形状断言增 maxQueuedControlBytes（1 行）
- `packages/ws-replication/test/ws-replication-sa7-hardening-dynamic.test.ts` — `[SA6 owned]` SA6 已改写 D3 为 R5 强锚（本轮 diff 已含）；SA3 零改动预期
- `packages/ws-replication/test/ws-replication-sa6-hardening-g3-g4-red.test.ts` — `[SA6 owned]` SA6 已更新 A2 锚注释（本轮 diff 已含）；SA3 零改动预期
- `packages/ws-replication/test/ws-replication-spec-b1-b2-red.test.ts` — `[SA6 owned]` SA6 已放宽 B-1 等待窗（本轮 diff 已含）；**SA3 仅做 L90 B-1 注释一行同步（B4——「测试侧 DEFER_MICROTASK_HOPS=512」改泵描述，见 §D7 配套注释同步②）；断言与测试体零改动预期**
- `packages/ws-replication/test/ws-replication-ac1-ac2-open.test.ts` — `[SA6 owned]` 条件允许：仅当 §D7 泵时序需要等待器微调（waitXxx/settleUntil 用法），断言语义冻结（预期零改动）
- `packages/ws-replication/test/ws-replication-ac6-resync-close.test.ts` — `[SA6 owned]` 条件允许：同上（预期零改动）
- `packages/ws-replication/test/ws-replication-r3-r4-regressions.test.ts` — `[SA6 owned]` 条件允许：同上（预期零改动）
- `packages/ws-replication/test/ws-replication-sa4-f1-f2-f3-red.test.ts` — `[SA6 owned]` 条件允许：同上（预期零改动）
- `packages/ws-replication/test/ws-replication-sa6-hardening-g1-g2-red.test.ts` — `[SA6 owned]` 条件允许：同上（预期零改动）
- `packages/ws-replication/test/ws-replication-sa7-dynamic.test.ts` — `[SA6 owned]` 条件允许：同上（预期零改动）
- `packages/ws-replication/test/ws-replication-sa7-round2-dynamic.test.ts` — `[SA7 owned]` **F1 冻结破坏性锚**（commit `218ca3a`，+832 行；D1–D5 六锚，D2 唯一红）。任何 SA 不改——修复后按 §D9 S1 推演直接转绿

文档：
- `docs/protocols/instance-replication-v1.md` — 修改：§D8 A8a（§2 增句）/A8b（§17 facets 段）/A8c（§18 缺省与约束）/A8d（§17 终态口径 + 校验清单两行）
- `docs/adr/0010-hub-peer-websocket-ydoc-replication.md` — 修改：§D8 文末 append-only 追加「issue #161 round 2 修订」节（既有修订节零改动）
- `docs/phases/phase-5-websocket-replication.md` — 修改：§D8 A8e L75/L81/L83 三处终态化改写（冻结词汇正文保留）

交付与 wiki：
- `REPORT.md` — 修改：round-2 报告重写（遗留问题 2 因 R6 落地消除；验证结果回填）
- `wiki/raw/task_ws-replication-review-revisions_round2_design.md` — 本文件（SA1 产出）
- `wiki/raw/task_ws-replication-review-revisions_round2_dispatch.md` — 追加 dispatch 行（各阶段）

### DENY LIST

- `packages/ws-replication/src/hub-connection.ts` — R2 终止接线（L161）、R3 cleanupAll 同步前缀、hub 侧 pong close（L295）均已就位，本任务零改动。**§D9 注记**：disposition 回传链经 L181 表达式体接线 `(message) => this.outbound.enqueueData(...)` 自动回流布尔——**零文本改动，DENY 保持**；实现期验证：若该行实际非表达式体（需加大括号/return），必须回 SA1 显式扩 ALLOW 并标注 §D9 后方可触碰
- `packages/ws-replication/src/liveness.ts` — onPongTimeout 回调面已够（§D4 在 connection 层收口）
- `packages/ws-replication/src/round-engine.ts` / `fence-watchdog.ts` / `error-mapping.ts` — round/fence/错误映射面与本八项无关
- `packages/ws-replication/src/index.ts` — 导出面无新增符号（ReplicationLimits 字段扩展不需导出变更）
- `packages/replication-protocol/**`、`packages/namespace-registry/**`、`packages/namespace-runtime/**`、`packages/persistence*/**` — 跨包零改动
- `apps/**` — 组合根属 issue #164（A8b 只登记契约，不实现装配断言）
- `packages/ws-replication/test/ws-replication-ac3-bootstrap.test.ts` / `ac4-reconcile` / `ac5-live` / `ac7-faults` / `sa4-r4-1-red` — 无 defer/重建/背压依赖面，预期零改动（不在条件允许面——如 SA3 发现需改，须回 SA1 扩表）

---

## §P. 协议假设依据 (Protocol Assumption Evidence)

| 假设 | 依据类型 | 依据内容（具体引用） | 风险 |
|---|---|---|---|
| socket 缓冲按 FIFO 冲刷（§D2 尾窗归因前提） | 官方语义 + 源码引用 | WHATWG WebSocket `bufferedAmount` 语义（已排队未发送字节数，按发送序冲刷）；协议 §17 L492「Adapter 观察 WebSocket bufferedAmount」既有前提；test/driver.ts GatedWire `bufferedAmount = Σ held`（review-red L178-182）与该假设一致 | 低（若某 adapter 乱序冲刷，控制归因偏保守方向——只会高估 outstanding，不漏检） |
| peer 侧 pong 超时 close(1001) 分类为临时失败 | 源码引用 | peer-connection.ts:558-562：close code 1002/1008 → blocked，其余 → onTemporaryFailure；hub 侧 pong 超时同码先例 hub-connection.ts:293-296 | 无（既有分类矩阵） |
| `cleanupAll` 同步前缀可达 channel 静默 | 源码引用 | hub-connection.ts:408-422：async 函数体在首个 `await this.settleTail`（L417）前的退订/stopLiveness/`channels.map(onConnectionClosed)`（L415）均同步执行；四个触发面（close/onTransportClosed/connectionFatal/onSequenceExhausted）均 `void this.cleanupAll()` | 无 |
| fake scheduler 单次 advanceBy 触发全部到期 timer | 现有测试引用 | g3-g4 A2-1011 锚（L703-731）：单次 `advanceBy(100)` 内规则 A+C 并列评估；R2-A2a 锚同构造（SA6 已实测红灯签名与之相符） | 无 |
| vitest 按测试文件隔离模块图（泵注册表不跨文件泄漏） | 官方文档 + 类比 | Vitest 默认 `isolate: true`（每文件独立模块注册表）；harness 既有模块级 `requireYjs` 缓存等同模式（harness.ts:563-566）；且闲泵 flush 为 no-op——即使共享亦无行为差 | 极低 |
| `maxQueuedControlBytes` 缺省 8MiB 不误杀合法 bootstrap | 源码推演 | validate.ts:119-134 既有链：maxBootstrapBytes(4MiB) ≤ maxFrameBytes−128；缺省 8MiB = maxFrameBytes → 任何单笔合法控制帧（含 envelope ≤ maxFrameBytes）不可独自越限 | 低 |

无其余协议级假设：本设计不引入新 HTTP/WS 端点、端口或跨进程资源生命周期假设。

---

## §X. 契约改动连锁审计 (Contract Change Caller Audit)

### 改动函数/接口

| 函数/接口 | 文件 | 改动前契约 | 改动后契约 |
|---|---|---|---|
| `ReplicationLimits` | `src/types.ts:18` | 10 字段冻结接口 | 11 字段（+`maxQueuedControlBytes: number` 必填）——**类型面加字段** |
| `OutboundQueue.enqueueData` | `src/frame-io.ts:155` | 超限时无条件接纳（void 返回） | 超限时**拒纳 + 同批丢弃该 ns 幸存排队帧 + 无条件 `onDataShed(ns)`**（void 返回不变——行为契约收紧，无签名变化；不变量 `onDataShed(ns) ⇒ ns 队列面已全弃`，见 §D1/§D6） |
| `OutboundQueue.drain` | `src/frame-io.ts:199` | 队首 ns blocked 即 return | 跳过 blocked 继续整轮（返回值语义不变） |
| `OutboundQueue.runCheckpoint` | `src/frame-io.ts:239` | 规则 C 单条件 | 规则 C 析取（+控制额度分支；`onControlExhausted` 触发面扩大） |
| `emitOne` | `src/frame-io.ts:356` | `(message) => number` | `(message, plane) => number`——**私有**方法加参 |
| `onTemporaryFailure`（使用面） | `src/peer-connection.ts:597` | pong 超时经此入口 | pong 超时改经 `onPongTimeoutDetached`（私有新方法；onTemporaryFailure 签名/其余三入口行为不变） |
| `requestRebuild`（调度点） | `src/peer-connection.ts:617` | 硬编码 `queueMicrotask` | 经 `this.deferTask`（缺省行为等价——单微任务） |
| `HubNamespaceChannel.onConnectionClosed` | `src/hub-namespace.ts:558` | 同步段仅清 openWaiters | 同步段增订阅摘除 + 投影 closed（Promise 返回不变） |
| `PeerNamespaceController.onConnectionFatal/onConnectionLost` | `src/peer-namespace.ts:606/624` | 订阅异步摘除 | 增同步摘除段（void 返回不变） |
| `UpdateChannel.overflows`（私有） | `src/update-channel.ts:127` | count/bytes 不含 pending | 双口径含 pending（行为收紧） |
| `OutboundQueue.enqueueData`（§D9） | `src/frame-io.ts:155` | `void` 返回 | `boolean` 返回（true 接纳 / false 拒纳）——**签名扩展** |
| `UpdateChannelHost.enqueueUpdate`（§D9） | `src/update-channel.ts:15` | `(bytes) => void` | `(bytes) => boolean`——**内部 host 接口签名** |
| `HubChannelHost.sendData`（§D9） | `src/hub-namespace.ts:55` | `(message) => void` | `(message) => boolean`——同上 |
| `PeerNamespaceHost.sendData`（§D9） | `src/peer-namespace.ts:43` | `(message) => void` | `(message) => boolean`——同上 |
| `UpdateChannel.handoff/onDataDispatched/onDataShed/teardown`（§D9） | `src/update-channel.ts` | 四出口 pending 记账 | 增 credit 子账本随四出口（登记/消费/双清零）+ 三门精确负载——**行为扩展，公共签名不变** |

### Caller 清单

| Caller | 文件:行号 | 是否 await | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---|---|---|---|---|
| `resolveLimits` | `src/defaults.ts:51` | N/A（同步合并） | N/A | N/A | 缺省提供新字段——合并结果自动满足（零改动） |
| `validateLimits` | `src/validate.ts:107`（调用方：hub-connection.ts:63 / peer-connection.ts:77） | 同步 | 构造期 TypeError（既有语义） | N/A | §D2 新校验沿用 assertCollKind 响亮模式 |
| harness `CONTRACT_LIMITS` | `test/harness.ts:126` | N/A | N/A | N/A | 增字段（ALLOW LIST） |
| api.test-d 形状断言 | `test/ws-replication-api.test-d.ts:124` | N/A | N/A | N/A | 增字段（ALLOW LIST） |
| `enqueueData`（hub 侧） | `src/hub-connection.ts:181`（channelHost.sendData） | 同步 | 上游 `sendChecked` 无需（void 返回） | N/A | 拒纳经 onDataShed → channel.onConnectionDataShed → declareHubResync（isQuietState 守卫既有） |
| `enqueueData`（peer 侧） | `src/peer-connection.ts:516`（sendData） | 同步 | N/A | N/A | 同上（declareLocalResync 记忆化既有） |
| `drain` 调用点 | `src/frame-io.ts:150/175/254`（sendControl/enqueueData/runCheckpoint） | 同步 | emit 编码错沿 sendChecked 族收编（既有注释 L203） | N/A | §D5 循环内零新 throw 路径 |
| `onControlExhausted` 接线 | `src/hub-connection.ts:161` / `src/peer-connection.ts:229` | 同步回调 | connectionFatal 内部 try/catch（hub L426-430） | N/A | 零改动（触发面扩大由 §D2 裁决，回调幂等由 closedFlag/connState 门保证） |
| `onTemporaryFailure` 其余三入口 | `src/peer-connection.ts:208`（dial 抛错）/`650`（hello 超时）/`562`（onClose） | 同步 | N/A | N/A | **行为不变**（§D4 裁决：仅 pong 入口改道） |
| `onConnectionClosed` 调用点 | `src/hub-connection.ts:415`（cleanupAll） | Promise（settleTail 聚合） | N/A | `HubReplication.close()` await settleTail | 同步段无 throw 路径（unsubscribe 幂等） |
| `onConnectionFatal` 调用点 | `src/peer-connection.ts:459`（quiesceControllers）/`547`（onSequenceExhausted→enterBlocked L592-594） | 同步 | N/A | N/A | 同步段零 throw；R3-4/R3-5 锚直证 |
| `onConnectionLost` 调用点 | `src/peer-connection.ts:605-607`（onTemporaryFailure）/`627-629`（requestRebuild） | 同步 | N/A | N/A | §D4 ⑥⑦ 顺序保证 onDataShed 零出站 |
| `handoff/onDataDispatched/onDataShed/teardown` 接线 | `src/update-channel.ts:142/112/120/180`（宿主回调由 hub-namespace L124-139 / peer-namespace 构造注入） | 同步回调 | N/A | N/A | §D6 四出口对称维护——漏项由 A7 记账锚捕获 |
| `enqueueUpdate`（→enqueueUpdateFrame→sendData→enqueueData 判定链，§D9） | hub 侧：`src/hub-namespace.ts:127/689` → `src/hub-connection.ts:181`（表达式体，零文本改动）；peer 侧：`src/peer-namespace.ts:127 附近/777` → `src/peer-connection.ts:91/506` | 同步 | 拒纳路径经 onDataShed 显影（既有）；返回值纯读（handoff 记账分支） | N/A | 唯一调用方 = `UpdateChannel.handoff`（两侧各一）；布尔消费点单一（§D9 credit 判定）——无第三消费方（内部 host 接口，grep 证实无其他 caller） |

### 风险评估

- **最大连锁面 = R2 类型加字段**：编译期可见（tsc/vitest typecheck 即捕获），运行期零隐匿；repo 内全量构造点已列全（§C grep 证据）。
- **行为契约收紧（R1/R5/R6）无签名变化**：所有调用方经回调显影（onDataShed/RESYNC 声明链既有），无未捕获 throw 新路径。
- **遗漏 caller 的代价**：类型面由编译器兜底；行为面由 §A 既有绿锚 + 全量回归兜底。

---

## SA2 反馈逐条回应（R2 修订——`..._round2_sa2_review.md` §6 blocking + §8 非阻塞）

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| **B1（CRITICAL）**：拒纳分支只显影不弃幸存面 → channel pendingData 负记账（窗口不变量破坏）+ 声明后仍派发旧帧；要求「清桶 + 回减 queuedDataBytes → 无条件 onDataShed」组合（空桶也显影保 R1-2）+ 补 R1-3 锚 | ✅ | §D1 伪码块（拒纳分支整体替换为「清幸存桶 → 回减 → 无条件 onDataShed」）、§D1 语义要点 2（三面不可拆 + 双理由）、§D1 锚推演（R1-3 契约定稿：构造/三断言/首版缺陷签名）、§D6「与 R1 的闭环」（队列侧不变量 + 编码错路径例外注记）、§X enqueueData 行为契约行、§A R1-3 映射行、§C frame-io/red-test 条目、§V.1/2（红转绿 15 例） | 拒纳 = 幸存面全弃 + 无条件显影；不变量 `onDataShed(ns) ⇒ ns 队列面已全弃` 成为 R6 记账正确性的显式前提；R1-3 断言 = 声明后零派发 / pendingData==0 / A7 窗口不变量 |
| **B2（HIGH）**：首版 grep 锚 #1/#3 事实性不可满足（512 冻结值 6 处、testing.ts 合法 queueMicrotask 2 处 + 注释 2 处）→ 换模式定向锚 | ✅ | §D7「grep 验收锚」节整体替换（四条：`512 跳\|TEST_DEFER\|DEFER_MICROTASK_HOPS` → 0；DEFER_MICROTASK_HOPS → 0；`queueMicrotask(` 排除 testing.ts → 恰 1 处 defaultDefer；`512 * 1024` 冻结值 diff → 0）、§V.4 同步重写 | 锚可满足且更精确；附防回归断言（冻结值不动）——实测验证过 SA2 的命中清单（types:22,28 / defaults:20,26 / harness:130,136 / testing:18,25） |
| **B3（HIGH）**：A8d「扩写为」若整段替换将无声丢失 §17 既有两句冻结不变量（控制高优先级 / 每轮每 ns 一帧）→ 合并文本 + doc-diff 核对项 | ✅ | §D8 A8d 整节重写（合并文本：原段第一句「Connection使用 per-namespace队列和 round-robin：control/error/ACK高优先级，data每轮每 namespace最多一个。」**逐字保留**为段首，终态口径句追加其后；拒纳句含幸存面同批丢弃语义）、§V.5（doc-diff 核对项：两短语 grep 在位 + 原句逐字节保留 + ADR 既有节 diff 零） | 防误删方向堵住；A8d 新文本与 §D1 B1 修复语义同步（「拒纳并同批丢弃幸存排队帧」入协议句） |
| N1（泵注册表并发 Run） | ✅ 采纳 | §D7 语义窗节新增 N1 约束 | 并发多 Run 独立时序须走 BootOptions.deferTask 手动泵；共享注册表 = 「等待进度即时间前进」语义声明 |
| N2（hello 超时孤儿传输开跟踪票） | ✅ 采纳（建议级） | §D4 登记观察项处置句 | 建议随本轮 REPORT.md 开票——立项归总控 |
| N3（onConnectionLost 分支归属二义） | ✅ 采纳 | §D3 peer 伪码整体重写（closing/failed/活跃态三分支各自内联 quiesceSync，终态分支跳过）+ N3 说明段 | 各非终态分支先静默再迁移；锚面（onConnectionFatal）不变 |
| N4（R5 界依赖 dataOrder 不增长） | ✅ 采纳 | §D5 不变量 1 补 N4 假设钉死（循环体回调面零 enqueueData 调用点；未来新 ns 注册路径须改快照界） | 假设依据修正为「循环体回调无 enqueueData 调用点」（flushQueued 在 ACK 路径，不在 drain 内） |
| N5（facets 注释双口径误读） | ✅ 采纳 | §D8 附带注释对齐从「可选」升级「必做」（types.ts 两层语义：运行时 dormant vs 组合根装配断言） | ALLOW LIST types.ts 条目同步 |
| N6（三字段重置归位 clear 单点） | ✅ 采纳 | §D2 dispose/clear 节重写（重置只写 clear() 一处；dispose 经由调用） | 防未来第三调用点漏重置 |
| N7（onSequenceExhausted 绕过 ledger） | ✅ 采纳 | §D2 新增 N7 注记（终态旁路有意不记账——防 SA4 误报） | |
| **B4（SA2 R2.2 唯一阻塞）**：`spec-b1-b2-red.test.ts:90` 过时注释（「测试侧 DEFER_MICROTASK_HOPS=512」）无清理属主 → 修正后锚 1/2 仍假失败；且 R2 版锚 1 内嵌命中清单与实测不符（漏 5 处 driver 命中 + spec-b1-b2:90，所列 L401 实不匹配） | ✅（R3） | §D7 配套注释同步扩为两处（② 新增 spec-b1-b2 L90 一行注释同步——改泵描述，断言/测试体零改动）、§D7 锚 1 注释命中清单改为**实测全列 11 处/5 文件**（driver.ts:131/400/407/408/413/467/619、peer-connection.ts:636、peer-namespace.ts:689、review-red:13、spec-b1-b2:90——逐处标注清理面归属，driver:131 由 BootOptions.deferTask 注释更新覆盖）、锚 2 注释同步标注两处、§C spec-b1-b2 条目「SA3 零改动预期」→「仅 L90 注释一行同步（B4）」 | 11 处全部落入清理面（本设计 R3 期实测复核与 SA2 R2.2 实测一致）；锚 1/2 修后 → 0、锚 3 → 恰 1、锚 4 冻结值不动——四锚全部可满足 |
| R2-N1（R1-3 构造 payload 精度：字面 8192B 裕度 ~967B ✓；BLOB=8000 常量则不达限） | ✅ 登记转发 | §D1 R1-3 契约构造注（SA6 补写时须用 ≥8192B 字面 payload 或等效加帧）——按 SA2「设计契约按字面 KiB 读法成立」不改契约文本 | 属 SA6 补写注意事项，随 R1-3 契约一并交接 |
| R2-N2（N3 落实超字面：closing/failed 分支新增 cleanupResources 排程，无独立锚） | ✅ 登记转发 | §D3 N3 说明段已有「onConnectionLost 侧为对称完备（无独立锚，行为经既有 B-2d/AC6 系锚回归）」——SA7 动态验证对 closing/failed 断线路径加回归观察 | 方向正确（资源更早释放 + B-2d 守卫保护），无需改设计 |
| R2-N3（锚 4 `<base>` 占位符未落具体基线） | ✅ 顺带收口 | §D7 锚 4 命令 `<base>` → `0a18661`（设计头部载明的基线 commit） | 一词替换 |
| **F1（SA7 §2 动态发现，非 SA2 项）**：incoming 先计 → enqueueData 内同 ns shed 的 onDataShed 清零（含先计）→ 滞回接纳 → 恢复派发 `onDataDispatched` 再减一 → pendingData = −1（R6 溢出 count 与 A7 窗口门双低估 1 帧/循环累计）；冻结 D2 锚红 | ✅（R4 增补 §D9） | **wipe-credit 修复**：① disposition 回传链（enqueueData/enqueueUpdate/sendData → boolean，5 src 文件 + hub-connection 零文本改动）；② handoff 先计保留 + `accepted && needsResync 翻转` 双条件信用登记（不重计 pending——保 D2 锚 L403/L407 = 0 观测语义，字面 (a) 重计会使冻结锚转 1 破约，§D9.0 推论/§D9.3 裁决）；③ onDataDispatched 信用消费跳过减记（L430 ≥ 0）；④ onDataShed/teardown 信用清零（四出口对称）；⑤ deliver/flushQueued/overflows 三门读 pending+uncounted（count/bytes 双口径——判定零偏差）。S1–S10 状态/顺序/重入全枚举 | 冻结 D2 锚（`218ca3a`）零改动转绿（S1 逐行推演：L388=0/L394=6/L403=0/L407=0/L430=0）；15 既有锚零扰动（S2 逐锚）；R1 幸存面丢弃/R6 四出口语义/双侧对称全部保持（S5/S6/S7） | |

**一致性自检（R3）**：全文 grep 复核——「拒纳」语义在 §0/§D1/§D6/§X/§A/A8d 六处均为「清幸存桶 + 无条件显影」口径；grep 锚仅在 §D7/§V.4 出现且为 B2/B4 修正版（无旧 `grep "512"` 残留；锚 1 命中清单 = 实测 11 处全列，与 R3 期实测逐处一致）；§17 合并文本首句与 protocol 原文逐字一致；红转绿计数 15 在 §A/§V.1/§V.2 三处一致；spec-b1-b2:90 的清理属主在 §D7 配套注释同步② 与 §C 条目两处一致。
