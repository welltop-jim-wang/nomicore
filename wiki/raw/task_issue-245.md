# MABF Task Brief

Repository: welltop-jim-wang/nomicore
Issue: #245
Title: ws-replication：分块传输 observer 事件（issue #233 切片 4）
State: open
Issue updated at: 2026-09-09T15:51:55Z

## Issue body

## Parent

PR #241（feat/issue-233-chunked-update-base）

## What to build

分块传输对观测面完全可见而不泄漏内容：observer seam append-only 新增四个事件类型——chunked-update-sent（transfer 完成出站时一次，非逐 chunk）、chunked-update-applied（纳入 apply 成功路径互斥规则第四形态）、chunked-update-acked、chunked-update-aborted（reason 闭集覆盖 timeout/shed/resync-declared/channel-teardown/connection-teardown/epoch-fence，含 receivedChunks/receivedBytes）。字段只报长度、计数与有界标识（transferId），遵循 safe-field 白名单；throw 隔离、决策落定后发射、无 observer 零事件零采样的逐字节等价纪律全部沿用。

## Acceptance criteria

- [ ] 四个新事件类型的键集冻结并经白名单断言；safe-field 深扫通过（零 Yjs bytes/ArrayBuffer、零 Error/异常原文、零 token/owner/内容，含 JSON.stringify 哨兵扫描）
- [ ] observer 每事件必 throw 时，wire 帧序列、终态、文档内容与 apply 结算与无 observer 基线逐字节全等
- [ ] 无 observer = 零事件、零状态投影读取、零时钟调用；无 clock 时 latency 字段缺失（非 undefined 值），有 clock 时 ≥ 0
- [ ] chunked-update-applied 与 update-applied/sync-diff-applied/degraded-bypass-applied 的互斥规则成立（每笔成功 apply 恰一事件）
- [ ] chunked-update-aborted 的 reason 闭集与切片 3 的全部中止路径一一对应，计数不变量（每笔中止恰一事件）成立
- [ ] §23.7 conformance 增补测试通过（事件矩阵 key-set 冻结、时钟折叠策略）

## Blocked by

- #244

## Comments
