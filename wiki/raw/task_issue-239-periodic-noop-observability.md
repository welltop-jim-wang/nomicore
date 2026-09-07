# 任务简报 — issue #239: replication observer 无法判断 periodic reconciliation 是否语义 no-op

- 来源：`gh issue view 239 --repo welltop-jim-wang/nomicore`（2026-09-07 采集，Issue 评论数 0，labels: bug, in-progress）
- 下文为 issue body 逐字快照；本文件是 SA8 前置门禁的被审对象，后续 SA1–SA7 复用时以本快照为准。

---

## Summary

生产日志中，已进入 `live` 的 Hub/Peer 每五分钟执行一次协议规定的 periodic reconciliation；每轮双方都观测到固定的 1,272 B `sync-step2-sent` 和 `sync-diff-applied`。现有 observer 只报告编码后的 Yjs update `byteLength`，无法回答：

- round 前后 state vector 是否变化；
- apply 是否推进了文档状态；
- 该 encoded update 是否只是 Yjs 格式上的非零载荷但语义 no-op；
- 两端是否反复认为同一历史缺失。

这不会证明复制不收敛，但会把正常的 encoded representation 与“持续非空业务 diff”混淆，使生产诊断无法区分健康 periodic round 和真正的 convergence defect。

## Production evidence

观测窗口：2026-09-06 10:09:15–10:47:36，namespace `ns-a14c373c98ddc2dbbc99f7ca244e82f8`。

初始 reconcile 双向 Step2 update 为 1,265 B；此后每五分钟的七轮 periodic reconciliation，双方 `sync-step2-sent` / `sync-diff-applied` 均稳定为 1,272 B：

- 10:14:22
- 10:19:22
- 10:24:23
- 10:29:23
- 10:34:24
- 10:39:24
- 10:44:25

同期普通增量 UPDATE 和 ACK 持续成功，应用层终态/dispatch 数据也已收敛；无 replication error。

原始分析日志：

`/home/wangjian/deepseek-harness/nomicore-center-runner-replication-log-2026-09-06.md`

## Current contract and implementation

Protocol §23 currently defines：

```text
sync-step2-sent.bytes     = outbound Step2 diff payload length
sync-diff-applied.bytes   = applied Step2 update length
```

Hub/Peer implementation directly emits `message.update.byteLength` / `update.byteLength`。因此 `bytes > 0` 只说明编码后的 update 有字节，不能证明 logical state 发生变化；相同长度也不能证明是同一 update。

Periodic timer itself is expected behavior：Peer owns a one-shot `reconcileIntervalMs` timer and locally transitions `live → reconciling → live`。Hub 作为响应方未必产生对称 channel-state transitions，因此本 Issue 不把 Hub/Peer state transition 不对称视为缺陷。

## Expected behavior

Observer / trace 应能在不泄漏 state vector 或 Yjs 内容的前提下，回答 periodic round 是否改变副本状态。建议 append-only 增加：

```text
syncRoundId                 // trace/log correlation; avoid default metrics label
stateVectorBeforeHash       // keyed or documented safe digest; trace-only if needed
stateVectorAfterHash
stateVectorChanged          // preferred low-cardinality signal
encodedUpdateBytes          // rename/new field clarifying current bytes semantics
applyEffect: changed | noop  // derived from before/after vector, not byteLength
```

如果安全或兼容性不适合暴露 hash，至少提供 `stateVectorChanged` 和 round-local correlation。不得暴露 raw state vector、Yjs bytes、ROOT/SCHEMA、owner 或绝对时间戳。

## Required feedback loop

补充 deterministic periodic reconciliation integration test：

1. 启动状态已完全相同的 Hub + Peer；
2. 固定并推进 `reconcileIntervalMs`；
3. 捕获 round 前后双方 state vector；
4. 断言 namespace 回到 live；
5. 断言 ROOT/SCHEMA/META 与双方 state vector 均不变化；
6. 断言 observer 明确报告 `stateVectorChanged=false` / `applyEffect=noop`；
7. 另构造一侧静默漂移，断言下一轮至少一侧报告 changed，且最终收敛。


## Deterministic local reproduction

已在当前 `main` 工作树构造确定性集成复现：

- 测试：`packages/ws-replication/test/ws-replication-issue239-repro.test.ts`
- 测试驱动 seam：`packages/ws-replication/test/driver.ts` 支持注入 Peer factory，以便同时捕获 Hub/Peer observer 事件。

单次运行：

```bash
pnpm exec vitest run packages/ws-replication/test/ws-replication-issue239-repro.test.ts --reporter=verbose
```

复现包含两个场景：

1. **已收敛副本的 periodic no-op**
   - 以完全相同的 Hub/Peer 副本启动；
   - 连续推进 7 个 `reconcileIntervalMs`；
   - 每轮 namespace 均返回 `live`；
   - 双方 state vector 在 round 前后保持不变；
   - 但每轮 `sync-step2-sent.bytes` / `sync-diff-applied.bytes` 仍为非零；
   - observer 事件不包含 `stateVectorChanged`、`applyEffect` 或 `syncRoundId`。

2. **静默漂移修复 round**
   - 直接修改 Hub live Y.Doc，模拟未产生普通 UPDATE 帧的静默漂移；
   - 下一次 periodic round 成功修复 Peer，最终 ROOT 与双方 state vector 收敛；
   - observer 仍只报告非零 `bytes`，无法与上述 no-op round 明确区分。

稳定性验证：连续运行上述测试 **20 次，20/20 全部复现，复现率 100%**；每次均为 2 tests passed、无 type errors，单次约 0.8 秒。

本地 fixture 中 no-op Step2 通常为 9–10 B，漂移 round 通常为 34–36 B；具体长度会随 Yjs client ID 编码宽度变化，因此回归测试不应锁死字节数。稳定且应断言的信号是 state vector 是否变化，以及 observer 是否明确报告 `noop` / `changed`。这与生产中固定 1,272 B 的载荷大小不同，但复现的是同一语义问题：**encoded update 非零不能证明 logical state 发生变化**。

## Acceptance criteria

- [ ] 生产 observer 不再要求用 `bytes > 0` 猜测是否存在语义 diff。
- [ ] 相同副本 periodic round 明确报告 no-op，且 round 前后 state vector 不变。
- [ ] 静默漂移修复 round 明确报告 changed，并在完成后双方 state vector 一致。
- [ ] sent/applied 能以 roundId、sequence 或等价安全字段可靠关联。
- [ ] `bytes` 的文档和字段名明确表示 encoded update length，而不是 logical change count。
- [ ] safe-field、低基数 metrics、observer throw isolation 与无 observer 热路径测试通过。
- [ ] 不改变 wire bytes 或 periodic reconciliation 状态机；如 observer contract 演进，按 append-only 更新 protocol §23。

## Related

- #232 调查 reconciliation apply 是否回声为普通 UPDATE；本 Issue 聚焦“如何证明 periodic round 是 no-op 或 changed”，两者互补但不重复。
- #231 聚焦 `send-failed` 分类，不覆盖成功 sync round 的语义效果。
