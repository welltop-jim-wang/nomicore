# Task Brief — Issue #175: 主动 reauthentication 生命周期

- Repository: welltop-jim-wang/nomicore
- Issue: #175
- Task type: Bug 修复
- Worktree: /home/wangjian/nomicore-fix-issue-175
- Branch: fix/issue-175-on-fix-issue-138-on-docs-phase-5-websocket-

## Problem

PR #173 的 Peer 能识别收到的 `REAUTH_REQUIRED` GOAWAY，但 Hub 仅公开 namespace `revoke()`，没有认证 Adapter 主动请求 reauthentication 的事件 seam/API，也没有完整的连接级 reauth 关闭流程。

协议要求已建立连接可由认证/授权 Adapter 主动发出 reauth/revoke 事件；reauth 应使旧认证连接按规定收口，并在 token/config 改变前保持 blocked。

## Acceptance Criteria

1. 定义窄而明确的认证 Adapter reauth 事件 seam 或 Hub 公共入口。
2. Hub 可针对认证实例/连接发送 `GOAWAY(REAUTH_REQUIRED)`。
3. reauth 只影响所需连接，不误关其他实例或 namespace 连接。
4. 旧认证 transport 按 GOAWAY drain/deadline 规则以 WS 1001 关闭，不无限保持开放。
5. Peer 进入 blocked，token/config 明确变化后才能恢复拨号。
6. 重复、迟到以及与 disconnect/hub.close 竞态的 reauth 事件幂等且无 unhandled rejection。
7. 不在日志、错误、observer 或 wire 中暴露 token。
8. 增加 Hub 主动 reauth、Peer blocked、配置变化恢复和竞态动态测试。

## References

- `packages/ws-replication/src/types.ts`
- `packages/ws-replication/src/hub-connection.ts`
- `packages/ws-replication/src/peer-connection.ts`
- `docs/protocols/instance-replication-v1.md`

## SA6 红灯契约（Phase 1 red tests，2026-08-30）

### 冻结契约扩展（SA6 锚；实现后与 `@nomicore/ws-replication` 正式类型逐字段一致）

- `HubReplication.requestReauth(instanceIdentity: string): Promise<void>`（AC1/AC2/AC3/AC7）：
  认证/授权 Adapter 主动 reauth 事件 seam——按**认证实例身份**定位连接（绝不以 token
  值为键），对每个匹配连接发送 `GOAWAY(REAUTH_REQUIRED, drainTimeoutMs>0)`，按
  drain/deadline 规则以 **WS 1001** 收口（AC4——区别于 `hub.close()` 的零 drain 窗口）；
  未知实例/已收口连接 → 无副作用 resolve；重复调用幂等（AC6）。
- `PeerReplication.notifyAuthChanged(): void`（AC5）：token/config 显式变化通知缝——
  blocked 仅在明确变化后恢复拨号（自 blocked 走 rebuild 编排）。
- 测试 mirror 冻结于 `test/driver.ts`（`HubReauthSeam` / `PeerAuthNotifySeam`）+
  `BootOptions.tokenSource`（拨号凭据源，token 轮换场景）。

### 测试文件

`packages/ws-replication/test/ws-replication-reauth-lifecycle-red.test.ts`（6 条 IT，全部红灯；
真实 yjs/Registry/Runtime 双实例、fake-duplex、fake scheduler、零源码 grep、零 mock 被测对象）：

| IT | AC | 红灯锚（当前行为） |
|---|---|---|
| 1 requestReauth 端到端 | 1/2/4/5 | `requestReauth` 缺失 → TypeError；实现后：恰 1 GOAWAY(REAUTH_REQUIRED, drain>0)、peer blocked、drain 窗 wire 保持开放、deadline 后 1001 收口、60s 零自动重拨 |
| 2 定向性（多实例） | 3 | seam 缺失 TypeError；实现后：未知实例 no-op；requestReauth(peer-beta) 仅 beta 收 GOAWAY→blocked→1001，alpha 零 GOAWAY、ready/live、wire 开放 |
| 3 接收侧 deadline | 4 | 注入 GOAWAY(REAUTH_REQUIRED, 60ms) 后 peer blocked 且 wire 无限开放（10×deadline 仍开放，SA5 R3）→ 必须 deadline 自行 1001 收口 |
| 4 恢复 | 5 | `notifyAuthChanged` 缺失 TypeError；实现后：blocked 无通知零重拨（60s 时钟；注入 GOAWAY drainTimeoutMs=300_000，60s 窗口不越 receiver deadline——SA2 修正），token 轮换 + 通知 → 旧 wire 收口(1000)→新 token 认证(dial 2)→ready→live→数据收敛 |
| 5 幂等与竞态 | 6 | seam 缺失 TypeError；实现后：重复 ×3 恰 1 GOAWAY；收口后迟到 no-op；与 hub.close 背靠背竞态双 resolve；连接消失后迟到 no-op；零 unhandled rejection |
| 6 零 token 暴露 | 7 | seam 缺失 TypeError；实现后：GOAWAY 帧字节 + peer 观测 close reason + 全 wire 字节零 token 序列；hub 侧无 close 观测面（hubSideCloseInfo 恒 undefined——SA2 修正，删除原不可满足的 `?.reason.includes` 断言） |

运行命令（worktree 根，后台独立进程）：

```bash
npx vitest run packages/ws-replication/test/ws-replication-reauth-lifecycle-red.test.ts
```

### 红灯验证结果（2026-08-30，后台独立进程实测）

命令：`npx vitest run packages/ws-replication/test/ws-replication-reauth-lifecycle-red.test.ts`
结果：**6 failed / 0 passed**（exit 1）——全部 IT 在预期锚点红灯，真实复现缺陷：

```
× AC1/AC2/AC4/AC5 requestReauth 端到端     → expected 'rejected' to be 'resolved'（requestReauth 缺失 → TypeError）
× AC3 定向性（多实例）                      → expected 'rejected' to be 'resolved'（同一 seam 缺失）
× AC4 接收侧 deadline（SA5 根因 #3 锚）      → expected false to be true（peer 收 GOAWAY(REAUTH_REQUIRED, 60ms) 后
                                              blocked；60ms deadline 后 wire.peerSideClosed 仍 false——wire 无限开放，
                                              与 SA5 R3 证据一致）
× AC5 恢复                                 → expected 'rejected' to be 'resolved'（notifyAuthChanged 缺失 → TypeError）
× AC6 幂等与竞态                            → expected 'rejected' to be 'resolved'（requestReauth 缺失 → TypeError）
× AC7 零 token 暴露                        → expected 'rejected' to be 'resolved'（requestReauth 缺失 → TypeError）
```

回归对照：同一 worktree 上 `ws-replication-sa7-dynamic` / `sa7-hardening-dynamic` /
`sa7-r1-transport-auth` 三个既有绿套件 19/19 通过（driver.ts 改动零回归）；
`npx tsc -p packages/ws-replication/tsconfig.json` 通过（含 test/**）。

### SA2 修正后复跑（2026-08-30，同命令实测）

SA2 Verdict: pass 后按其所指修正两处锚点（仅测试文件）：IT4 注入 GOAWAY
drainTimeoutMs 5_000 → 300_000（60s 无通知窗口不越 receiver deadline）；IT6 删除
不可满足的 `hubSideCloseInfo?.reason.includes(TEST_TOKEN) === false`，改为
`expect(run.wire.hubSideCloseInfo).toBeUndefined()`（Hub 主动收口流程中 hub 侧无
close 观测面），保留 AC7 的 wire 字节 + peer 侧 close reason 验证。

复跑结果：**6 failed / 0 passed**（exit 1，Type Errors: no errors）——6 条 IT 仍全部
在**同一预期锚点**红灯（IT1/2/6/7 与 IT4 均死于 `requestReauth`/`notifyAuthChanged`
缺失 TypeError；IT3 死于 60ms deadline 后 `wire.peerSideClosed` 仍 false；IT4 的
blocked 与 60s 零重拨前置断言在红锚之前全部通过，证明 300s drain 窗口下锚点干净）；
修正不改变红灯契约的失败面。



