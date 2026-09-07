# MABF Task Brief

Repository: welltop-jim-wang/nomicore
Issue: #254
Title: bug(ws-replication): reconcile 超时后形成 failed/needs-resync 僵尸连接且无法自愈
State: open
Issue updated at: 2026-09-07T15:40:35Z

## Issue body

## 问题摘要

Peer 的周期 reconciliation 超时后会把 namespace channel 直接收口为 `failed`，但不会促使仍处于 `ready` 的 WebSocket 连接重建。随后 Hub 因 UPDATE ACK 超时进入 `needs-resync` 并发送 `RESYNC_REQUIRED`；Peer 已处于当前连接内不可恢复的 `failed` 终态，无法再发起新 round。TCP/WebSocket 保持建立，双方永久互等。

最终状态：

```text
Peer channel: failed
Hub channel: needs-resync
Connection: ready / TCP ESTABLISHED
Recovery: none
```

## 业务影响

复制通道可在短暂延迟或事件循环饥饿后永久失活，且 TCP 层看起来仍然健康。Peer 后续本地写无法上报 Hub，Hub 对 Peer 任务状态失明，必须人工重启 Runner 或连接才能恢复。

本次事故直接影响 `jim-dev2 ↔ Center Hub` 上的 MABF issue #228 执行状态上报。

## 事故证据

采集窗口：2026-09-07 20:18–21:40 CST。

关键时间线：

- `20:23:51` Peer 周期 reconcile：`live → reconciling`
- reconcile 期间 Peer `applyLatencyMs` 上升，Hub `ackLatencyMs` 同步上升
- `20:24:04` Peer：`reconciling → failed`
- `20:24:26` Hub：`live → needs-resync`，`cause: ack-timeout`
- 此后超过一小时无新 round、重连或 channel 日志
- 双侧 TCP socket 持续 `ESTABLISHED`，网络 RTT 正常

Peer 尾部日志：

```text
20:23:51 channel-state-changed peer live→reconciling
20:23:57 sync-step2-sent peer
20:24:00 sync-diff-applied peer applyLatencyMs=2363
20:24:03 update-applied peer applyLatencyMs=5568
20:24:04 update-applied peer applyLatencyMs=6192
20:24:04 channel-state-changed peer reconciling→failed
```

Hub 尾部日志：

```text
20:24:03 update-acked hub ackLatencyMs=9583
20:24:04 update-acked hub ackLatencyMs=9413
20:24:16..24 update-sent hub (无 ACK)
20:24:26 channel-state-changed hub live→needs-resync
20:24:26 resync-required hub cause=ack-timeout
```

完整事故报告与原始日志当前由报告方保留：

- `/tmp/mabf-jimdev2-replication-failure-2026-09-07.md`
- `/tmp/mabf-incident-228/`（双侧全量、失败窗口和健康对照，共 8 个文件）

## 已定位的实现路径

`packages/ws-replication/src/peer-namespace.ts` 中，除 periodic timer 外的 namespace timer 到期统一执行：

```ts
this.finalize('failed');
```

因此 `reconcileTimeoutMs` 到期会把 Peer channel 置为 `failed`。

但当前行为同时满足：

1. `failed` 是同一连接内的 namespace 终态；
2. 同一连接内终态 namespace 禁止重新 OPEN；
3. `onConnectionReady()` 只有在连接重新建立后才会将 `failed` target 重新 OPEN；
4. reconcile timeout 不关闭或重建仍处于 `ready` 的连接。

这使 `failed` 没有实际可达的自愈路径。

## 契约冲突

`docs/protocols/instance-replication-v1.md` 规定：

- ACK timeout 进入 `needs-resync`，由 Peer 发起新 state-vector round；
- `failed` 等待连接重建或配置变化；
- 同一连接内终态 namespace 不得重新 OPEN。

如果 reconcile timeout 必须进入 `failed`，实现需要同时触发连接重建；否则应采用一个仍能推进恢复 round 的非终态路径。当前实现两者均未执行。

## 确定性回归场景

建议在 fake duplex transport + injected timer 上增加秒级测试：

1. Hub/Peer 完成首次同步并进入 `live`；
2. 触发周期 reconciliation；
3. 丢弃该 round 必需的 `SYNC_APPLIED`（或等价控制帧）；
4. 推进时间超过 `reconcileTimeoutMs`；
5. 断言不得停留在 `Peer=failed, Hub=needs-resync, connection=ready`；
6. 断言连接被重建并重新 OPEN/reconcile，最终双方回到 `live`。

现有测试 `ws-replication-periodic-reconcile.test.ts` 的“进行中的周期 round 不重叠”只推进了少于 reconcile timeout 的时间，因此无法捕获该问题。

## 验收标准

- [ ] 周期 reconciliation 超时后无需人工重启即可恢复
- [ ] 不再出现长期稳定的 `Peer failed + Hub needs-resync + connection ready/ESTABLISHED`
- [ ] 恢复路径遵守“同一连接内终态 namespace 不重开”的协议不变量
- [ ] 已接纳 apply 正常排空，session/lease 生命周期无泄漏
- [ ] 增加确定性超时与自动恢复回归测试
- [ ] 覆盖 Peer/Hub channel 状态、连接重建和最终数据收敛

## 非结论

事故日志高度提示 Peer 事件循环或 write sequencer 排队饥饿是本次超时诱因，但尚不足以证明唯一诱因。无论超时由业务负载、IO、调度延迟还是网络抖动触发，超时后的永久不自愈行为本身已构成独立 bug。


## Comments
