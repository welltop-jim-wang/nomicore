# MABF Task Brief

Repository: welltop-jim-wang/nomicore
Issue: #270
Title: Server 集成验收：REST 与 WebSocket 共享 Registry + 有序停止
State: open
Issue updated at: 2026-09-10T23:59:32Z

## Issue body

## Parent

PR #158（docs/rest-namespace-create）

## What to build

server 集成验收：composition root 构造 REST 与 WebSocket Module 时注入并共享同一个 `NamespaceRegistry` 引用（同一 namespace 在进程内只有一个 Runtime 与一个 write sequencer）；server 先按 raw path 选择 REST 与 WebSocket route family。

验收同时覆盖停止顺序：先停止 intake，再等待已接纳的 REST/WS 工作 settle，释放 Lease/Session，最后 shutdown Registry 与 Persistence。

本票基于骨架 router 即可落地，不等待完整错误契约与 observer 行为；后续 ticket 叠加的 router 行为不得破坏本验收。

## Acceptance criteria

- [ ] 集成测试证明 REST 与 WebSocket Module 持有同一个 `NamespaceRegistry` 引用（不经 Cordis Context 查找、不运行时替换）
- [ ] raw path 正确分流 REST 与 WebSocket route family
- [ ] 停止顺序被验证：停止 intake → 等待已接纳工作 → 释放 Lease/Session → shutdown Registry 与 Persistence
- [ ] WebSocket Module 不依赖 REST create，仍直接使用 Registry/Lease/ReplicationSession

## Blocked by

- Blocked by #267



## Comments

