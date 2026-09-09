# MABF Task Brief

Repository: welltop-jim-wang/nomicore
Issue: #243
Title: ws-replication：超限 UPDATE 分块端到端 live 传输（issue #233 切片 2）
State: open
Issue updated at: 2026-09-08T13:40:07Z

## Issue body

## Parent

PR #241（feat/issue-233-chunked-update-base）

## What to build

协商过 CAP_CHUNKED_UPDATE 的 Hub/Peer 之间，超过 maxUpdateBytes 的单逻辑 live update 不再被丢弃退化为全量 reconciliation：发送端在出队时刻惰性切片，chunk 逐帧经既有 data 路径（独立 sequence、round-robin 每轮每 namespace 一帧、dataGateOpen 水位闸门）出站，整笔 transfer 占 1 个 in-flight 窗口槽；接收端在通过首 chunk 校验的 detached buffer 中重组，收齐并核对总长后在唯一 write sequencer 中执行恰一次 trusted apply + dirty notification，以单 UPDATE_ACK（末 chunk 帧序）结算，Hub 正常 fan-out 给其他 Peer。未协商双端行为与 v1 逐字节一致（超限仍丢弃 + needs-resync）。

## Acceptance criteria

- [ ] 大于 maxUpdateBytes、不超过 maxChunkedUpdateBytes 的 update 在 live 状态完成传输并收到单 ACK，全程零 SYNC round
- [ ] 每个 wire frame 均不超过 maxUpdateBytes 与 maxFrameBytes 既有上限
- [ ] 接收端恰一次 sequenced apply + dirty notification；任何重组失败发生在 apply 之前，live Y.Doc 零写入
- [ ] 多 namespace 场景下 chunk 与其他 namespace 数据帧 RR 穿插，既有 backpressure/公平调度测试不回归
- [ ] ACK 计时锚为末 chunk 出站时刻；ackTimeoutMs 语义不变
- [ ] 未协商（无 capability）双端：issue #233 刻画测试（R1/R2/R3）继续逐字节全绿
- [ ] fake-duplex harness seam 与真实 WebSocket + MemoryPersistence 1 Hub + 2 Peers seam 双双收敛绿灯
- [ ] 首 chunk 基础校验生效：chunkIndex 从 0 严格递增、transferId/totalBytes/chunkCount 跨 chunk 一致（违例分类在切片 3 完备化）

## Blocked by

- #242

## Comments
