# MABF Task Brief

Repository: welltop-jim-wang/nomicore
Issue: #301
Title: feat(#295 切片 3): 完备性、observer 与新旧互通矩阵
State: open
Issue updated at: 2026-09-11T17:40:26Z

## Issue body

## Parent

PR #298（docs/issue-295-chunked-sync-design）

## What to build

让切片 2 的分块同步在异常面与观测面上达到协议规格（ADR 0022 / §9.4/§13.2/§18/§23）承诺的完备性：

**生命周期完备性**：chunk 丢失（assemblyTimeoutMs 进度滑动 deadline 为唯一探测器）、重复、错序、超时、namespace close/终态、GOAWAY drain 收口、断线、epoch fence 下 partial assembly 全部丢弃、零 durable 残留；超时按 kind 两向收口——snapshot → BOOTSTRAP_FAILED 语义族终局（terminal failed + §18 连接重建既有规则），sync-diff → 弃 partial + RESYNC_REQUIRED{SYNC_TRANSFER_EXPIRED} 非终态；恶意 totalBytes/chunkCount 声明不导致无界分配（首 chunk 分配前校验 + 按已验证上界一次性分配）；多 namespace round-robin 公平调度与 control reserve 不回归。

**observer seam**：chunked-snapshot-{sent,applied,acked,aborted} 与 chunked-sync-{sent,applied,acked,aborted} 八型发射点接线（sent 为 transfer 完成出站时恰一、非逐 chunk；sync 族 sent/applied 携 syncRoundId safe-field）；R21 改道规则平移——分块窗口内普通族 bootstrap-snapshot-sent/bootstrap-imported/sync-step2-sent/sync-diff-applied 归零；apply 成功路径六选一互斥；aborted 复用 ChunkedUpdateAbortReason 闭联合零新词；safe-field、secret-free（事件树深扫无 Uint8Array）、throw isolation、无 observer 逐字节等价。

（新旧互通矩阵不在本票范围：同版本部署假设，ADR 0022 非目标。）

## Acceptance criteria

- [ ] chunk 丢失、重复、错序、超时、close、GOAWAY、断线、epoch fence 测试矩阵完备，assembly 丢弃零 durable 残留
- [ ] 超时两向收口：snapshot → BOOTSTRAP_FAILED 族终局；sync-diff → RESYNC_REQUIRED{SYNC_TRANSFER_EXPIRED} 非终态
- [ ] 恶意声明不导致无界分配（分配前校验 + 一次性有界分配的负例测试）
- [ ] 多 namespace 公平调度与 control reserve 回归测试通过
- [ ] observer 8 事件型：发射点、改道归零、互斥、safe-field/secret-free/throw isolation 测试通过

## Blocked by

- #300


## Comments
