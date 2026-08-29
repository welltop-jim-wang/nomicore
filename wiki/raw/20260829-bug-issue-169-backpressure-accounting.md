# [Bug] 连接级背压记账/控制保留额度与协议 §17 权威文本不一致（issue #169）

**Status**: analyzed | **Date**: 2026-08-29
**Severity**: high
**Type**: new-feature-defect（实现落 于 08da15b/#162；权威契约由 ef19bae/#165 落地后即失配——从未一致过）
**Layer**: backend（`packages/ws-replication`）

## Symptoms

对照 `docs/protocols/instance-replication-v1.md` §17 L492（权威文本，ef19bae/#165 落地），当前 `ConnectionSender` 表现为：

1. **预算击穿**：同一同步栈内连续发送 + transport `bufferedAmount` 异步滞后时，连接总压可远超 `maxQueuedBytesPerConnection`（复现：cap 64 KiB，单栈放行 164,000 字节，2.5× 超限，且零 shedding、零 1011）。
2. **控制额度冲刷后不释放 → 误杀连接**：`controlReserveUsed` 只在 `enterPause`/`resume` 清零，从不随 socket 冲刷核减；socket 已把控制帧全部冲走后，下一合法控制帧仍误触 `CONNECTION_BACKPRESSURE` + close(1011)（复现：2 帧各 16 KiB，第 2 帧被拒并收口）。
3. **缺省配置自伤**：`controlReserveBytes` 缺省 64 KiB < `maxBootstrapBytes` 缺省 4 MiB——暂停窗口内 hub 侧任何 >64 KiB 的 `BOOTSTRAP_SNAPSHOT`（控制类帧，`hub-namespace.ts:426` 经 `sendControl` 出站）都会立即把连接打 1011。协议要求字段 `maxQueuedControlBytes` 缺省 8 MiB 且 ≥ `maxBootstrapBytes` + 协议开销。
4. **shed 恢复目标错误**：溢出只整队丢弃到 `total ≤ cap` 即停，不停在协议要求的 queued 侧 ≤ `lowWater`（复现：65 KiB > 64 KiB cap 只丢最大 ns，幸存 ns 仍留 25,600 字节 > lowWater 1 KiB）。
5. **poll 间隔违约**：固定 `BACKPRESSURE_POLL_INTERVAL_MS = 1_000`，非协议公式 `max(1, floor(ackTimeoutMs / 100))`（ackTimeoutMs=5000 时应为 50ms，实测 1000ms 才恢复，慢 20×；缺省 10s 时慢 10×）。
6. **严格接纳缺失**：shed 后（或空队列时）接纳 incoming 仍越限应「拒纳该帧 + 同批丢弃该 ns 幸存排队帧 + needs-resync 声明」；现实现 incoming 先入队再触发 shed，若自身 ns 非最大 victim 则被静默接纳。

## Reproduction

工作区 `/home/wangjian/nomicore-fix-issue-169`（HEAD=ef19bae），`pnpm install` 后以 vitest 直构 `ConnectionSender`（同 `ws-replication-sa7-round2-dynamic.test.ts` D4 模式：fake scheduler + 手控 `readBufferedAmount` 模拟 bufferedAmount 滞后）。临时测试 `packages/ws-replication/test/sa5-diag-issue169.temp.test.ts`（已删除），四个用例参数与结果：

| # | 场景 | 配置 | 当前实现结果 | 协议要求 |
|---|------|------|-------------|---------|
| S1 | 同步栈 10 次 `tryEmitData(16 KiB UPDATE)`，`readBufferedAmount` 恒 0 | cap=64 KiB | 10/10 放行，wire=164,000B，exhausted=0 | 总压 ≤ 64 KiB（约 4 帧后拒纳） |
| S2 | `ackTimeoutMs=5000`，暂停后 buffered→0，advance 50ms | — | 50ms 未恢复；1000ms 才 drain | 50ms（公式）即恢复 |
| S3 | 暂停段发 16 KiB control → socket 全冲刷（buffered→lowWater+1，仍暂停）→ 再发 16 KiB control | reserve=32 KiB | 第 2 帧误触 exhausted=1，仅 1 帧上 wire | 未冲刷控制字节=0 → 两帧均放行 |
| S4 | ns-a 40 KiB + ns-b 25 KiB 入队（总 65 KiB） | cap=64 KiB, lowWater=1 KiB | 只 shed ns-a；ns-b 幸存 25,600B | shed 至 queued ≤ 1 KiB（两 ns 均整队丢弃） |

## Investigation

读取（Step 1+2 共 8 个项目文件）：任务简报、`backpressure.ts`（全文）、协议 §17 L479–510、`frame-io.ts`（OutboundQueue L98–168）、`update-channel.ts`（L60–289）、`defaults.ts`（全文）、`hub-connection.ts`（L115–189）、`peer-connection.ts`（L205–244、L556–600）。

数据流追踪（data 面）：
`UpdateChannel.deliver()`（`update-channel.ts:67`）→ live 直发 `sendAndRegister:143` 或入队 `queued.push:90` → `onDataQueued:93` → `ConnectionSender.onDataQueued:108` → `enforceConnectionCap:226`（**只看 Σ facet.queuedBytes()**）→ drain `pullAndSendOne:191` → `takeItems:203`（**先核减 queuedByteCount**）→ `sendAndRegister` → 连接层 `sendData` → `ConnectionSender.tryEmitData:91`（**看 bufferedAmount + Σ queued + 当前帧**）→ `OutboundQueue.emit` → `emitRaw`（交 transport，bufferedAmount 异步才反映）。

断点判定：
- **记账缝隙**：帧被 `takeItems` 移出队列、已 `emitRaw` 交给 transport、但 `bufferedAmount` 尚未反映的窗口内，该帧字节对两套账本（shed 账本、admission 账本）都不可见；`tryEmitData:96` 的 `+ frameBytes` 只补偿「当前这一帧」，补偿不了同栈先前已交接的帧 → S1 击穿。反之 admission 侧如果 naive 地把 pending handoff 与仍在队列的当前帧同时计入则会双计——统一账本必须恰好计一次（issue 范围第 1、2 条所指）。
- **账本割裂**：admission（`tryEmitData:96` 含 bufferedAmount）与 shed（`enforceConnectionCap:229` 只含 queued）用两套口径，都不含 pending-handoff；协议 §17 L492「总队列记账 = 每 namespace 排队字节 + socket bufferedAmount」是单一账本。
- **控制账本口径错**：`controlReserveUsed`（`backpressure.ts:63`）语义 = 暂停段累计已发出控制帧编码字节（`onEmitted:117` 只在 paused 时累加），协议口径 = socket 缓冲内**未冲刷**控制字节（冲刷即释放）。`enterPause:186`/`resume:193` 清零是唯一释放点。
- **契约字段错**：`types.ts:29` + `defaults.ts:27` + `validate.ts:118` 用 `controlReserveBytes`（64 KiB，仅正整数校验）；协议字段 `maxQueuedControlBytes`（8 MiB，≥ `maxBootstrapBytes`+协议开销，启动期响亮验证）。

git 考古：`git log --follow -- packages/ws-replication/src/backpressure.ts` → 仅 08da15b（#162/#137 创建，277 行，落定时即固定 1000ms poll + controlReserveUsed 累计口径 + controlReserveBytes 字段）与 ef19bae（#165 加固）。`git log -S maxQueuedControlBytes/严格接纳/ackTimeoutMs÷100 -- docs/protocols/...` → 三段权威文本均 ef19bae 落地。即 #165 更新了协议权威文本但未同步实现——post-merge review 发现的「still disagrees」由此而来。

## Root Cause

`packages/ws-replication/src/backpressure.ts`（#162 引入）的连接级背压实现基于 issue #137 设计 §4.x 的自有口径，与 #165 固化的协议 §17 L492 权威口径存在六处结构性偏差：

| # | 缺陷点（文件:行） | 偏差 |
|---|------------------|------|
| 1 | `backpressure.ts:55` | poll 间隔固定 1000ms，应为 `max(1, floor(ackTimeoutMs/100))` |
| 2 | `backpressure.ts:63-64,79-87,117-121,183-196` | 控制保留额度 = 「暂停段累计已发出字节」，应为「socket 未冲刷控制字节」账本（冲刷释放）；判据仅 paused 时生效 |
| 3 | `backpressure.ts:91-99` | admission 账本漏计 pending-handoff（已交接未吸收）字节 → 同步栈击穿 budget |
| 4 | `backpressure.ts:220-238` | shed 账本漏计 socket 压力且恢复目标停在 cap，应为 queued 侧 ≤ lowWater；无严格接纳（拒纳 incoming + 同批丢弃幸存帧） |
| 5 | `types.ts:29` / `defaults.ts:27` / `validate.ts:118` | 字段 `controlReserveBytes`(64 KiB) 应为 `maxQueuedControlBytes`(8 MiB) 且 ≥ `maxBootstrapBytes`+framing 开销（启动验证，无迁移） |
| 6 | `backpressure.ts:96` vs `229` | admission 与 shed 两套账本割裂，无统一 ledger |

**Fix direction**（供 SA1 设计参考）：在 `ConnectionSender` 内建单一连接账本（各 ns queued + 已交接未吸收 pending-handoff + 可观察 bufferedAmount，每帧恰计一次），同时驱动 admission 与 shed（触发严格大于 cap、恢复至 queued 侧 ≤ lowWater、严格接纳拒纳路径）；控制保留额度改为随 socket 冲刷核减的未冲刷控制字节账本（冲刷即释放额度）；字段迁移 `controlReserveBytes` → `maxQueuedControlBytes`（缺省 8 MiB，validate.ts 增加启动期约束）；poll 间隔由 `max(1, floor(ackTimeoutMs/100))` 推导。保持 PR #162 的 `ConnectionSender`/`DataSenderFacet` 单数据面，不得回退出第二个 OutboundQueue data 调度器。

## Evidence

动态复现（vitest，fake scheduler，2026-08-29，HEAD=ef19bae；临时测试已删除、`git diff` 干净）：

```text
[SA5-DIAG] S1 admitted frames: 10 /10; wireBytes: 164000 ; cap: 65536        → 击穿 2.5×，零 shedding
[SA5-DIAG] S2 drained after 50ms: 0 (协议要求=1) / drained after 1000ms: 1   → poll 慢 20×（ackTimeoutMs=5000）
[SA5-DIAG] S3 exhausted: 1 ; emitted control frames: 1 (协议要求 0/2)        → 冲刷后额度不释放，误杀 1011
[SA5-DIAG] S4 shed namespaces: [ 'ns-aaa…' ] ; surviving queued bytes: [ 0, 25600 ]  → 停在 cap 非 lowWater
```

关键代码：

```ts
// backpressure.ts:55  固定间隔（协议要求 max(1, floor(ackTimeoutMs/100))）
export const BACKPRESSURE_POLL_INTERVAL_MS = 1_000;

// backpressure.ts:79-87  控制额度判据：仅 paused 生效 + 累计口径
if (this.paused) {
  const frameBytes = this.measureFrame(message);
  if (this.controlReserveUsed + frameBytes > this.host.limits.controlReserveBytes) { … }

// backpressure.ts:96  admission 账本：只补偿当前帧，漏 pending-handoff
const projected = this.host.readBufferedAmount() + this.totalQueuedBytes() + frameBytes;

// backpressure.ts:229-230  shed 账本：只看 queued；停在 cap
const total = this.totalQueuedBytes();
if (total <= cap) return;   // 协议：整队丢弃至 queued 侧 ≤ lowWater

// defaults.ts:27  缺省 64 KiB（协议 maxQueuedControlBytes 缺省 8 MiB，且须 ≥ maxBootstrapBytes+开销）
controlReserveBytes: 64 * 1024,
```

git 证据：

```text
$ git log --follow --oneline -- packages/ws-replication/src/backpressure.ts
ef19bae Follow-up: harden WebSocket replication protocol after PR #160 (#165)
08da15b Phase 5: multiplex namespaces with bounded fair backpressure (#162)   ← 创建，含全部现口径
$ git log -S "maxQueuedControlBytes" --oneline -- docs/protocols/instance-replication-v1.md
ef19bae   ← 权威文本落地点；实现未同步
```
