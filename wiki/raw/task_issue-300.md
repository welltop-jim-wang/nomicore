# MABF Task Brief

Repository: welltop-jim-wang/nomicore
Issue: #300
Title: feat(#295 切片 2): chunked snapshot / sync-diff 端到端：R1/R3 收敛绿灯
State: open
Issue updated at: 2026-09-11T13:11:38Z

## Issue body

## Parent

PR #298（docs/issue-295-chunked-sync-design）

## What to build

大于单帧上限、不超过聚合上限的合法文档不再让 namespace 永久失同步：hub 的 BOOTSTRAP_SNAPSHOT 与双向 SYNC_STEP2 diff 超过 `maxBootstrapBytes`/`maxSyncDiffBytes` 时改道 kind=1/kind=2 chunk 序列，经 data 路径逐帧出站（独立 sequence、dataGateOpen 与 round-robin 调度、整笔占 1 个 in-flight 窗口槽、队列持完整载荷出队惰性切片、control reserve 零 chunk——修复 R1 揭示的结构性绕行）；未超单帧上限的载荷仍走单帧路径（触发条件，非兼容回落）。接收端 assembler kind 泛化（作用域 (连接,方向,namespaceId,transferId)，bootstrap 期按 OPEN_NAMESPACE 已知的 namespaceId 记账、无需 Lease），首 chunk 绑定块核对（kind=1: replicationId/replicationEpoch 对 OPEN_OK，不符 → REPLICATION_ID_MISMATCH/REPLICATION_EPOCH_MISMATCH；kind=2: syncRoundId 对该 round，不符 → SYNC_STATE_VIOLATION），分配前二维校验（totalBytes ≤ 按 kind 的聚合上限、chunkCount ≤ maxChunksPerUpdate）通过后按已验证上界一次性分配 detached buffer，收齐长度精确核对后执行**一次** sequenced apply / 排他复制导入，再以 BOOTSTRAP_ACK / SYNC_APPLIED 单 ACK 结算（durability 含义不变，重组失败对 live Y.Doc 零写入）。错误映射：声明超限 → SNAPSHOT_TRANSFER_TOO_LARGE / SYNC_TRANSFER_TOO_LARGE（fatal/config/failed）；跨帧元数据违例 → SNAPSHOT_TRANSFER_VIOLATION / SYNC_TRANSFER_VIOLATION（fatal/no/failed）。

端到端绿灯：R1 构型（单笔 20KB 合法写 + `maxUpdateBytes=8KiB`）恢复 diff 经 data 路径分块、不再以单个 20KB 控制帧绕开记账；R3 构型（100KB 写 + `maxSyncDiffBytes=32KiB`）恢复同步收敛、零终局失败（刻画测试文件 `packages/ws-replication/test/ws-replication-issue233-repro.test.ts` 不改，新增收敛绿灯测试）。

## Acceptance criteria

- [ ] snapshot 超 `maxBootstrapBytes` → kind=1 chunk 序列完成初始同步，BOOTSTRAP_ACK 在导入完成后结算（ackedSequence = 末 chunk 帧序）
- [ ] diff 超 `maxSyncDiffBytes` → kind=2 chunk 序列完成恢复同步，SYNC_APPLIED 在一次 apply 后结算
- [ ] 每个 wire frame 不超既有 frame 与 per-chunk 上限；snapshot/diff 字节纳入 data 路径 backpressure 记账，control reserve 零 chunk
- [ ] 绑定块违例映射既有码；声明超限/跨帧违例映射四个新 namespace 错误码（fatal/terminal failed，retryable 对齐既有族）
- [ ] R1/R3 构型收敛绿灯测试新增（刻画文件不动）；接收端只在完整重组后一次 apply，partial failure 对 live Y.Doc 零写入

## Blocked by

- #299


## Comments
