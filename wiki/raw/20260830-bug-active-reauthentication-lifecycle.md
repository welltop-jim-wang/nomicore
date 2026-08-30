# [Bug] Hub 主动 reauthentication 生命周期缺失：无 reauth seam、无 GOAWAY(REAUTH_REQUIRED) 发送方、blocked 连接不收口且 token 变化无恢复入口

**Status**: analyzed | **Date**: 2026-08-30
**Severity**: high
**Type**: new-feature-defect（wire 契约要求的 reauth 生命周期只实现了接收侧一半；非回归）
**Layer**: backend（`packages/ws-replication`）

## Symptoms

1. **Hub 侧**：认证/授权 Adapter 在凭据轮换/撤销后，没有任何 API 可以对已建立的 Peer 连接发起 reauthentication。`HubReplication` 公共面只有 `accept` / `connections` / `revoke`（namespace 级授权撤销）/ `close`（整 Hub 停机）。凭据已失效的旧连接继续以 `ready` 状态无限同步——协议 `docs/protocols/instance-replication-v1.md` L450「已建立连接只有在认证/授权 Adapter 主动发 reauth/revoke 事件时关闭」的 reauth 半边不存在。
2. **Peer 侧**：能识别 `GOAWAY(REAUTH_REQUIRED)` 并进入 `blocked`（peer-connection.ts:404-408），但 blocked 后旧 transport 永不关闭（双侧时钟越过 drain deadline 10 倍后 wire 仍开放），且 token-only 变化没有任何公共入口可恢复拨号（唯一恢复缝是 `addTarget` 触发的 `config-change` 重建）。
3. **测试面**：仓库中零条 Hub 主动 reauth 测试（AC8 缺口）。

**影响范围**：所有部署了 Bearer token 认证的 Hub/Peer 复制拓扑。凭据轮换后旧连接的授权窗口无限延长（安全面）；Peer blocked 后只能靠「增删 target」这种间接配置变化恢复，token 轮换本身无法解除 blocked（可用性面）。

**环境**：worktree `/home/wangjian/nomicore-fix-issue-175`，分支 `fix/issue-175-on-fix-issue-138-on-docs-phase-5-websocket-`，HEAD `0df6583`。Node v24.13.0、pnpm 10.28.2、vitest 3.2.7，全部复现于内存双端 fake-duplex transport + 受控 scheduler（确定性，零真实时间）。

## Reproduction

临时诊断测试 `packages/ws-replication/test/ws-replication-sa5-diag-reauth.test.ts`（已按 SA5 纪律删除，4/4 通过，零 unhandled rejection），基于既有 `test/driver.ts` 的 `boot()`（真实 Registry/Runtime/Y.Doc + fake wire）：

- **R1（seam 缺失）**：`boot({})` 至 ready 后枚举 `run.hub` 与 `run.hub.connections[0]` 的全部属性键。结果：`HubReplication` 键集 = `["accept","close","closeTail","closed","connectionCounter","connectionList","connections","dropConnection","internals","limits","options","rejectUpgrade","revoke","timeouts"]`——reauth 相关键为 `[]`；`HubConnection` 键集中唯一 GOAWAY 能力是私有 `shutdownWithGoaway`（写死 `SERVER_SHUTTING_DOWN`），无任何 reauth/goaway 公共方法。同时 `src/` 全量 grep `REAUTH_REQUIRED` 仅命中接收侧 peer-connection.ts:404——Hub 无生产路径构造该帧（测试只能经 `run.injectHub()` 注入）。
- **R2（revoke ≠ reauth）**：`await hub.revoke(PEER_INSTANCE, nsId)` → 该 namespace channel 终止（ns → `failed`），但连接仍 `ready`、wire 仍开放。证明既有 revoke 只做 channel 级（ADR-0010 条款 3 语义），无法承担连接级 reauth 收口。
- **R3（blocked 不收口）**：注入 `GOAWAY(REAUTH_REQUIRED, drainTimeoutMs=60)` → peer 立即 `blocked`、ns 投影 `disconnected`（正确）；随后双侧时钟各推进 600ms（10×deadline）→ `wire.peerEnd.closed = false`、`wire.hubEnd.closed = false`、peer 侧 close info = null。旧认证 transport 无限期开放，违反 AC4。
- **R4（恢复缝单一）**：blocked 态下枚举 `run.peer` 公共键——无任何 `token|config|reauth|refresh|credential|update` 命名的入口（`dial` 闭包构造期固定）。唯一恢复路径：`peer.addTarget(target)` → `requestRebuild('config-change')` → 第 2 条 wire → `ready`。token-only 轮换无法经公共面恢复拨号。

复现命令（worktree 根）：
```bash
pnpm install --frozen-lockfile --prefer-offline
npx vitest run packages/ws-replication/test/ws-replication-sa5-diag-reauth.test.ts   # 4 passed（文件已删除，断言细节见 Evidence）
```

## Investigation

阅读清单（Step 1+2 共 7 个文件，未超 2026-05-11 立法上限）：任务简报、SA8 相关决议、`src/types.ts`、`src/hub-connection.ts`、`src/peer-connection.ts`、`docs/protocols/instance-replication-v1.md`（§5/§6.3/§15.1/§18 节选）、`test/driver.ts` + 既有测试锚点（`ws-replication-auth-lifecycle-red.test.ts`、`ws-replication-sa7-dynamic.test.ts` 相关段）。

**调用链与数据流**：

1. **Hub 出站 GOAWAY 唯一链路**：`HubReplicationImpl.close()`（hub-connection.ts:217-227）→ 逐连接 `connection.shutdownWithGoaway(closeTimeoutMs)`（:324-340）→ `outbound.sendControl({kind:'GOAWAY', reasonCode:'SERVER_SHUTTING_DOWN', drainTimeoutMs})` 直发豁免 → **立即** `this.close(1001,'hub-shutdown')`。整条链路由 `closed` 标志单次触发（幂等），reasonCode 硬编码，drain 窗口实际为零。认证 Adapter 无任何挂载点能进入这条链路，也无法指定单个认证实例。
2. **Peer 入站 GOAWAY 分类**：`dispatchReady` case 'GOAWAY'（peer-connection.ts:375-377）→ `onGoaway`（:398-416）：`SERVER_SHUTTING_DOWN` / `REAUTH_REQUIRED` → `enterBlocked()`；drain 类 → `draining` + `armDrainClose()`（receiver 侧本地 elapsed deadline，§6.3）。`enterBlocked()`（:655-674）清全部 timer、`outbound.clear()`、控制器 `onConnectionFatal()`，**不关 transport、不武装任何 deadline**（注释明言「保持 wire 开放供宿主决定最终关闭时机」）——把收口义务完全交给 GOAWAY 发送方，而发送方（Hub reauth 路径）不存在。
3. **blocked 恢复链**：`addTarget`（:136-168）在 `connStateValue === 'blocked'` 分支 → `requestRebuild('config-change')`（:696-718）→ 关旧 wire(1000) → `deferTask` → `dialNow()` → 新 Upgrade（新 token 由 `options.dial` 闭包携带）。这是 Peer 侧唯一的 config-change 感知点；无 token-only 变化的等价缝。
4. **git 考古**：`git log -S 'REAUTH_REQUIRED'` 命中 `24642a9`（2026-08-28，issue #136 切片 6）——peer 侧 REAUTH 分类随 GOAWAY 接收面一次性落地；issue #138（`01e6801`）补了 Upgrade 认证与 `revoke`。Hub 主动 reauth 从未实现，故为 new-feature-defect 而非回归。

**假设与验证**：初始假设「seam 存在但语义错」被 R1 的运行时键枚举 + 源码 grep（0 个 Hub 侧 REAUTH 构造点）证伪；假设「blocked 后有隐藏 deadline」被 R3 双时钟推进证伪；假设「token 变化可经某更新入口恢复」被 R4 键枚举 + types.ts 冻结面（`PeerReplication` 仅 start/stop/addTarget/removeTarget/getConnectionState/getNamespaceState）证伪。

## Root Cause

`packages/ws-replication` 的 Hub 侧从未实现 wire 契约（instance-replication-v1.md L435-442、L450，经 ADR-0010 条款 2 收录为约束）要求的连接级主动 reauth 生命周期。精确缺口：

| # | 缺陷点 | 位置 |
|---|---|---|
| 1 | `HubReplication` 冻结公共面无 reauth 事件 seam/入口（AC1） | `src/types.ts:117-125` |
| 2 | Hub 唯一 GOAWAY 生产路径写死 `SERVER_SHUTTING_DOWN` 且仅由整 Hub `close()` 触发；无按 `authenticatedInstanceId` 定向发送 `GOAWAY(REAUTH_REQUIRED)` 的代码（AC2/AC3） | `src/hub-connection.ts:217-227, 324-340`；grep `REAUTH_REQUIRED` 全 src 仅 `peer-connection.ts:404`（接收侧） |
| 3 | Peer blocked 类 GOAWAY 不武装 receiver 侧本地 elapsed deadline（§6.3「接收时开始计算本地 elapsed deadline」只对 drain 类 `armDrainClose` 生效），wire 无限开放（AC4） | `src/peer-connection.ts:398-416, 655-674` |
| 4 | Peer 无 token/config 显式变化通知入口，恢复拨号仅 `addTarget` 一条缝（AC5 的 token 半边） | `src/peer-connection.ts:136-168, 696-718`；`src/types.ts:148-155` |
| 5 | 零 Hub 主动 reauth / blocked 恢复 / 竞态动态测试（AC8） | `test/` 全目录无相关用例（GOAWAY 用例均经 `run.injectHub` 注入） |

AC6（重复/迟到/竞态幂等）因发送侧不存在而无从谈起；既有幂等基件（`closedFlag` 早退、`revoke` 的拷贝迭代、peer `onClose` blocked 态早退）可复用。AC7 目前无违反（hub 静态 reason、零 token 回显），新 seam 需以 `instanceId` 为键维持该不变量。

**Fix direction**（供 SA1 设计参考，不展开实现）：在 Hub 侧补一条窄的公共 reauth 入口（按 `authenticatedInstanceId` 定位连接、绝不以 token 值为键），复用 `shutdownWithGoaway` 的直发豁免模式发送 `GOAWAY(REAUTH_REQUIRED, drainTimeoutMs)` 并武装 deadline 后 `close(1001)`（区别于 shutdown 的立即 close），全程以 `closedFlag`/hub `closed` 门幂等并安全竞态 `hub.close()` 与 transport 已断。Peer 侧需评估为 blocked 类 GOAWAY 补 receiver 侧 elapsed deadline（防 Hub drain 期死亡导致 wire 永开放），并补一个显式 config/token-change 通知缝使 blocked 仅在明确变化后重拨（`requestRebuild('config-change')` 既有编排可直接承载）。竞态与恢复路径需配套动态测试（AC8）。

## Evidence

诊断运行（2026-08-30，删除前最后运行，4 passed / 0 failed，`collectUnhandledRejections` 四场景均零事件）关键输出：

```
[SA5-DIAG] HubReplication 公共键: ["accept","close","closeTail","closed","connectionCounter","connectionList","connections","dropConnection","internals","limits","options","rejectUpgrade","revoke","timeouts"]
[SA5-DIAG] reauth 相关键: []
[SA5-DIAG] HubConnection 公共键: [...,"close",...,"revokeNamespace",...,"shutdownWithGoaway",...]   ← 唯一 GOAWAY 能力，私有、写死 SHUTTING_DOWN
[SA5-DIAG] revoke 后 connectionState = ready / wire closed = false                                 ← R2：namespace 级 ≠ 连接级
[SA5-DIAG] GOAWAY(REAUTH_REQUIRED) 后 connectionState = blocked
[SA5-DIAG] +600ms 后 wire closed(peerEnd/hubEnd) = false false / peer close info = null             ← R3：10×deadline 后仍无限开放
[SA5-DIAG] PeerReplication 公共键: [无 token/config/reauth/refresh/credential/update 命中]
[SA5-DIAG] addTarget 后 wires = 2 / state = ready                                                  ← R4：唯一恢复缝
```

代码锚点：

```ts
// hub-connection.ts:324-340 —— Hub 唯一 GOAWAY 发送方（私有，reasonCode 硬编码，立即 close）：
shutdownWithGoaway(drainMs: number): void {
  ...
  this.outbound.sendControl({
    kind: 'GOAWAY',
    reasonCode: 'SERVER_SHUTTING_DOWN',   // ← 无 REAUTH_REQUIRED 路径
    drainTimeoutMs: drainMs,
  });
  ...
  this.close(1001, 'hub-shutdown');       // ← 零 drain 窗口
}

// peer-connection.ts:404-408 —— 接收侧已识别 REAUTH_REQUIRED：
if (message.reasonCode === 'SERVER_SHUTTING_DOWN' || message.reasonCode === 'REAUTH_REQUIRED') {
  this.enterBlocked();                    // ← 不关 transport、不武装 deadline（:655-674）
  return;
}
```

协议契约（`docs/protocols/instance-replication-v1.md`）：

- §6.3（L141-149）：`drainTimeoutMs`「接收时开始计算本地 elapsed deadline」；「现有 namespace 到 deadline 前自然收口，之后**发送方**以 WS 1001 关闭」。
- §15.1（L435-442）：`REAUTH_REQUIRED`：blocked，等待 token/config 变化；1002/1008：blocked。
- L450：「Hub 不包含 dial/backoff。Bearer token 轮换只影响新 Upgrade；已建立连接只有在认证/授权 Adapter 主动发 reauth/revoke 事件时关闭。」

git 证据：

```
24642a9bf48f1d3bb0be1c0f1154198ac930adfe 2026-08-28 feat(ws-replication): Phase 5 slice 6 ... （-S 'REAUTH_REQUIRED' 唯一命中：peer 接收侧分类落地）
01e6801 fix(ws-replication): 切片 7 实例认证/连接生命周期实现（issue #138）   （revoke/Upgrade 认证落地；Hub reauth 仍未实现）
0df6583（HEAD）fix(ws-replication): migrate hardening tests to authenticated accept
```

既有测试锚点（复用面，非缺口）：`ws-replication-auth-lifecycle-red.test.ts` AC-4（revoke 只关 channel 不关连接）、AC-5/AC-6/A2-c（GOAWAY 接收分类与 blocked）；`ws-replication-sa7-dynamic.test.ts` #5（GOAWAY 接收已实现面——REAUTH_REQUIRED → blocked 仅 peer 侧锚定）。

现场清理：诊断文件已删除，`git status --short` 仅剩任务派发自带 4 个 untracked wiki 文件，`git diff --stat` 为空。
