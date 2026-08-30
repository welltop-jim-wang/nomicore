# Acceptance Criteria Checklist — Issue #175 主动 reauthentication 生命周期

| AC# | 描述 | 状态 | 证据 | 处理 |
|---|---|---|---|---|
| AC1 | 定义窄而明确的认证 Adapter reauth seam 或 Hub 公共入口 | ✅ | `HubReplication.requestReauth(instanceIdentity): Promise<void>` 已在 `src/types.ts` 落地；SA4 §1.2 契约审查通过；SA6 IT1、SA7 D1/D2 运行时验证。 | 已实现并独立审查。 |
| AC2 | Hub 可针对认证实例/连接发送 `GOAWAY(REAUTH_REQUIRED)` | ✅ | `HubConnectionImpl.beginReauth()` 发送控制帧；SA6 IT1 绿；SA7 D1 真实 TCP 原始帧验证 `GOAWAY(REAUTH_REQUIRED)`。 | 已实现并动态验证。 |
| AC3 | reauth 只影响所需连接，不误关其他实例或 namespace 连接 | ✅ | `authenticatedInstanceId` 匹配与拷贝迭代；SA6 IT2 绿；SA7 D2 验证多连接/二次覆盖，未匹配连接无 GOAWAY。 | 已实现并动态验证。 |
| AC4 | 旧认证 transport 按 GOAWAY drain/deadline 规则以 WS 1001 关闭 | ✅ | Hub deadline `close(1001, 'hub-reauth')` 与 Peer blocked deadline `close(1001, 'blocked-deadline')`；SA6 IT1/IT3 绿；SA7 D1/D3/D5 验证 drain、deadline、1001 收口。 | 已实现并动态验证。 |
| AC5 | Peer blocked，token/config 明确变化后才能恢复拨号 | ✅ | `PeerReplication.notifyAuthChanged()` 仅 blocked 态调用 `requestRebuild('auth-change')`；SA6 IT4 绿；SA7 D1/D3/D4/D5 验证 blocked 保持与零自动重拨。 | 已实现并动态验证。 |
| AC6 | 重复、迟到和与 disconnect/hub.close 竞态幂等且无 unhandled rejection | ✅ | `reauthRequested`、`closedFlag`、timer cleanup 与状态守卫；SA6 IT5 绿；SA7 D2 验证同 tick 竞态与零 unhandled rejection；SA4 静态审查通过。 | 已实现并动态验证。 |
| AC7 | 不在日志、错误、observer 或 wire 中暴露 token | ✅ | 以 `authenticatedInstanceId` 为键，静态 close reason；SA6 IT6 绿；SA7 D1 全原始 socket 字节和 close reason 扫描零 token；SA4 V4 确认 src 零 console/process.env。 | 已实现并动态验证。 |
| AC8 | 增加 Hub 主动 reauth、Peer blocked、配置变化恢复和竞态动态测试 | ✅ | SA6 6 条验收契约测试 + SA7 `ws-replication-sa7-175-dynamic.test.ts` 6 条动态测试（D1–D6）；SA7 全包回归 26 files / 187 tests 通过。 | 已添加并动态验证。 |

## 结论

8/8 AC 全部满足。关联证据：SA4 R2 `Verdict: pass`、SA7 `Verdict: pass`。CI run 尚未产生，因分支未由 Host 发布；该项属于发布后 Host/CI 观察，不构成本地 AC 未满足。
