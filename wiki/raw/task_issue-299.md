# MABF Task Brief

Repository: welltop-jim-wang/nomicore
Issue: #299
Title: feat(#295 切片 1): 协议与配置基座：CAP_CHUNKED_SYNC 协商、0x42 kind 双形态 codec、聚合上限配置链
State: open
Issue updated at: 2026-09-11T04:40:03Z

## Issue body

## Parent

PR #298（docs/issue-295-chunked-sync-design）

## What to build

0x42 UPDATE_CHUNK 改写为 kind 首字段单形态并被正确编解码，且 snapshot/sync-diff 的聚合上限进入配置链并启动期响亮验证——这是 #295 一切后续切片的地基。冻结契约见 ADR 0019 与协议 §5/§10.3/§17。部署前提：同版本部署假设（ADR 0019），无 capability 协商、无向前兼容面。

端到端可验证行为：kind ∈ {0=live-update, 1=snapshot, 2=sync-diff} 的 0x42 帧（含 kind=1 首 chunk 的 replicationId/replicationEpoch 绑定块、kind=2 首 chunk 的 syncRoundId 绑定块）codec 往返无损；`kind ∉ {0,1,2}` 或绑定块位置违例（非首 chunk 携带 / kind=0 携带）→ MALFORMED_FRAME；ADR 0013 六字段旧形态的 golden vectors 在本分支内改写为单形态（旧形态从未发布，无兼容负担）。配置面：`maxChunkedBootstrapBytes`/`maxChunkedSyncDiffBytes`（缺省各 4 MiB）生效，`maxChunksPerUpdate`/`maxConcurrentAssembliesPerConnection`/`assemblyTimeoutMs` 语义 kind 无关、键名不变；启动校验链追加 `maxChunkedBootstrapBytes ≤ maxChunksPerUpdate × maxUpdateBytes` 与 `maxChunkedSyncDiffBytes ≤ maxChunksPerUpdate × maxUpdateBytes`，违例响亮拒绝、绝不运行时 clamp；`maxQueuedControlBytes ≥ maxBootstrapBytes + 协议开销` 校验原样保留（单帧路径仍需要）；未表达新键的存量配置不误判（非追溯性）。

## Acceptance criteria

- [ ] 0x42 单形态 codec：kind 首字段恒在 + 绑定块（仅 kind≠0 ∧ chunkIndex=0）编解码；全字段 golden vectors 改写并冻结
- [ ] codec 单帧规则：kind 非法值、绑定块缺失/越位 → MALFORMED_FRAME
- [ ] 两个聚合上限键 + 两条链②不等式进入启动响亮验证；control reserve 校验不变；存量配置非追溯性测试
- [ ] 三种 kind 共用同一 transferId 计数器（作用域 (连接,方向,namespace) 严格递增不回绕）的语义在 codec/契约层锁定

## Blocked by

None (can start immediately).


## Comments
