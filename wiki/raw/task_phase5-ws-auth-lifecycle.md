# Task Brief — Phase 5: authenticate instances and run connection lifecycle (issue #138)

- Repository: `welltop-jim-wang/nomicore`
- Branch: `fix/issue-138-on-docs-phase-5-websocket-replication`
- Run ID: `issue-138-1787994136-4073122`
- Round: `1`
- Task type: feature
- Parent: PR #130 (`docs/phase-5-websocket-replication`)
- Dependencies: #136 and #137; their outputs are present in branch history (`6f2676f`, `08da15b`).

## Acceptance criteria

1. Bearer authentication and Peer instance resolution occur before WebSocket upgrade; invalid credentials never allocate a protocol connection.
2. HELLO/HELLO_ACK binds authenticated Peer identity, expected Hub identity, supported protocol version, capabilities, and nonce; namespaces open only afterwards.
3. Connection sequence, ACK association, frame/heartbeat timeouts, ERROR scope, and WS close-code mapping follow the v1 contract.
4. Hub authorization is a deep Adapter returning denied or local owner plus read/submit permissions; optional revoke/reauth closes only the required scope.
5. Peer connection state supplies full-jitter backoff, permanent-failure blocking, stable-ready reset, Hub GOAWAY reasons/retry hints, through injected scheduler/random seams.
6. GOAWAY stops new opens, drains accepted apply work without unbounded network-ACK waiting, and closes in the specified order.
7. Logs and observer events never expose tokens, owner values, Yjs bytes, SCHEMA/ROOT, causes, or uncontrolled high-cardinality labels.

---

# SA6 红灯验收锚定（Round 1 Phase 1 首版；Round 1 R2 修订——设计 SA2 R3 放行后）

> 依据：ADRs/Spec 基准摘录（`task_phase5-ws-auth-lifecycle_relevant_decisions.md`）、协议
> `instance-replication-v1.md` §2/§6.1/§6.2/§6.3/§13/§14/§15/§19/§21、phase-5 切片 7/场景
> 12/16/L146-151。裁决：**切片 3/4 已交付部分**（HELLO_ACK 握手、nonce 回显、序列纪律、
> 授权 Adapter 于 OPEN、backoff/blocked 骨架、ERROR wire 七段 codec）**不重复锚**；本次
> 固化的是**缺失面**：upgrade 前置认证、认证身份绑定、revoke/reauth、GOAWAY 语义
> （draining 转移/停 OPEN/retryAfterMs）、Hub 停机 GOAWAY 先行。
> 切片 3/4 既有测试已覆盖面（HELLO_TIMEOUT、序列、ERROR scope、backoff 公式、
> backoffResetAfterMs、1002/1008→blocked）经审阅与协议一致，未重复编写。
>
> **R2 修订记录（设计 `task_phase5-ws-auth-lifecycle_design.md` §6.5，SA2 R3 pass 后执行）**：
> A1——legacy G1（sa7-dynamic.test.ts:186-190）draining 期望改锚（L189 `'ready'`→`'draining'`，
> L188 注释同步；L190 起逐断言不变——§6.4 对账）；A2——红灯契约追加 5 IT（A2-a/b/c/d/e，
> 冻结契约文件 SA6 owned）；认证拒绝路径 reason 细化为 `upgrade-unauthorized`/
> `upgrade-frame-limit`/`upgrade-timeout`（设计 §3.2 门 1/3/4，替代首版统一
> `upgrade-rejected`——既有 10 红灯只断言关闭、不断言 reason，零冲突）。
> 涉及设计修订面（§3.2 早到缓冲有界 16×maxFrameBytes + helloTimeoutMs 封顶、§6.2 无条件
> draining + drain 期停新 OPEN/round、§6.3 draining 期 1002/1008 close → blocked）。

## 冻结契约扩展（SA6 锚；SA1 设计须遵循，SA3 实现须落型）

| 面 | 冻结形态 | AC 依据 |
|---|---|---|
| 升级认证器 | `HubReplicationOptions.verifyToken: (token) => Promise<{ok:true; instanceId} | {ok:false}>`（必填——无认证器 = 全部 upgrade 拒绝） | AC-1（协议 §2；ADR 0010 L155） |
| 升级请求上下文 | `HubReplication.accept(transport, request?: {token?: string}): Promise<HubConnection \| undefined>`——认证先于任何协议连接分配；缺凭据/验证拒绝/验证器抛错/instanceId 文法违规（`^[a-z][a-z0-9-]{0,62}$`）→ 返回 undefined、零分配、transport 以静态原因 close（`upgrade-unauthorized`/`upgrade-frame-limit`/`upgrade-timeout`） | AC-1 + AC-7 |
| 早到缓冲资源界 | 认证窗口早到帧：单帧 > `maxFrameBytes` → 1009、条数 ≥ 16（模块常数）→ 1008、认证等待超过 `helloTimeoutMs` → 1008——有界（16×maxFrameBytes + helloTimeoutMs），零新 knob | ADR 0010 L165 + AC-1 |
| 身份绑定 | HELLO `peerInstanceId` 必须等于认证身份；不等 → `INSTANCE_IDENTITY_MISMATCH`（ERROR 1008；safeMessage 静态无身份/token 文本） | AC-2（协议 §2 L38） |
| 授权撤销 | `HubReplication.revoke(instanceIdentity, namespaceId): Promise<void>`——只终止对应 namespace（terminating namespace ERROR `NAMESPACE_UNAUTHORIZED` + failed），连接与其他 namespace 不受影响；未知 scope → resolve 无副作用 | AC-4（协议 §19；ADR 0010 L158） |
| GOAWAY 语义 | Peer 收 GOAWAY → 连接 `ready → draining`（**无条件**，与 retryAfterMs 无关；`SERVER_SHUTTING_DOWN`/`REAUTH_REQUIRED` 仍 blocked 直达）；drain 期停新 OPEN/round（§6.3 L147）；`SERVER_RESTARTING` 按 `drainTimeoutMs` 后 1001 关闭、按 `retryAfterMs + jitter`（无 hint → 普通 full-jitter）重连调度；draining 期 close-code 分类：1002/1008 → blocked（清 drain timer），其余（1000/1001/1006/1011）→ onGoawayClosed 重连 | AC-5 + AC-6（协议 §15.1/§6.3） |
| Hub 停机 | `HubReplication.close()` 先向每连接发 GOAWAY（`SERVER_SHUTTING_DOWN` + 正 drainTimeoutMs）再 close(1001)；close 后 `accept` → undefined、零分配（停止接纳） | AC-6（协议 §21 第 1 步） |

## 测试矩阵（`packages/ws-replication/test/ws-replication-auth-lifecycle-red.test.ts`，**15 IT 全红灯**；另含 legacy G1 改锚 1 处）

| # | IT | AC | 预期红灯点（当前实现） |
|---|---|---|---|
| 1 | 幸福路径：有效 bearer → 认证记账 → HELLO_ACK（nonce 16B 回显）→ OPEN → live → 双向收敛，token 零上 wire | AC-1/2/4/7 | `verifyCalls` 空（无认证记账） |
| 2 | 无效 token → 零协议连接分配、transport 关闭、不接受 HELLO | AC-1 | accept 仍分配 HubConnectionImpl |
| 3 | 缺失凭据（无 token / 未传请求）→ 拒绝 | AC-1 | 同上 |
| 4 | 验证器返回文法违例 instanceId → 拒绝 | AC-1 | 同上 |
| 5 | 验证器抛错 → 拒绝、零 unhandled rejection | AC-1 | 同上 |
| 6 | HELLO.peerInstanceId ≠ 认证身份 → INSTANCE_IDENTITY_MISMATCH（1008，safeMessage 无身份/token 文本），绝不 ready | AC-2 | 无绑定 → ready（blocked 等待预算耗尽） |
| 7 | revoke(ns2) → 恰 1 个 NAMESPACE_UNAUTHORIZED（ns2 scope）+ ns2 failed；ns1/连接存活 | AC-4 | revoke 不存在；0 ERROR 帧 |
| 8 | revoke 未知 scope → resolve 零副作用 | AC-4 边界 | revoke 不存在（TypeError） |
| 9 | GOAWAY(SERVER_RESTARTING, drain=1000, retryAfter=6000, random=0) → 连接 draining；drain 期停新 OPEN；7000ms 前零重拨、之后重拨 | AC-5/6 | 状态保持 ready；addTarget 即发 OPEN；忽略 retryAfterMs（1000ms 即重拨） |
| 10 | hub.close() → 先 GOAWAY(SERVER_SHUTTING_DOWN, drain>0) 再关闭；close 后零接纳 | AC-6 | 无 GOAWAY 帧；close 后 accept 仍分配 |
| A2-a | 无 hint GOAWAY → 无条件 draining（CP-1 字面）；drain 期停新 OPEN；普通 backoff 出口重连 ns1/ns2 live | AC-5/6 | 状态保持 ready；addTarget 即发 OPEN |
| A2-b | drain 期停新 sync round（CP-2 字面）——变体一本地 ACK_TIMEOUT（drop UPDATE_ACK，ackTimeoutMs=40）→ startRound 被出站 ready 门拦截；变体二入站 RESYNC_REQUIRED → 入站状态门丢弃（控制器零扰动）；收尾重连后新 round 恢复 + 数据收敛 | AC-5/6 | 状态保持 ready → 本地恢复链照发新 Step1；入站 RESYNC 推动新 round 上 wire；ns 非 live |
| A2-c | draining 期 close-code 分类（SA2 A1 修复锚）——drain 窗口内 1002/1008 → blocked（零重拨、零 stale drain-close 副作用）；反向对照 1001 → backoff | AC-5（§15.1 L439） | 预设断言 `'draining'` 即红（现实现 GOAWAY 后仍 ready）——分类断言为实现后防线（A1 缺陷在本实现进入 draining 态后才会出现） |
| A2-d | 认证期早到帧预算（SA2 A2 修复锚）——deferred verifier 窗口内 1 HELLO + 16 垃圾 → 第 17 帧条数界 1008；单帧 > maxFrameBytes → 1009；边界内恰 1 HELLO → 正常分配 + HELLO_ACK 恰 1 + 零 SEQUENCE_VIOLATION（恰一次投递防回归）；verifier 永不归 → **hub scheduler** advanceBy(helloTimeoutMs) 超时封顶 1008（N3 修正：advanceMs 推进 peer scheduler，本场景必须 node.scheduler.advanceBy） | ADR 0010 L165 + AC-1 | 现实现无预算无封顶——accept 同步分配（垃圾帧经连接 fatal 自清理后 `await p` 仍得连接对象 → 断言之红；超时变体零封顶——分配 + 无关闭） |
| A2-e | 同步重放型 transport 注册期拒绝（SA2 R2 N1 必修锚，防伪绿）——本地 fixture（DuplexTransport 五成员、onMessage 注册即同步重放积压、重放先于 return，TcpTransport 形态）：预置 1 帧 > maxFrameBytes → `await expect(p).resolves.toBeUndefined()` + 关闭码 1009 + `hub.connections.length===0` + 重放计数 = 预置数（零流产）；变体 17 帧正常尺寸 → 1008 | §8.2「accept 永不 reject」 | 现实现 accept 同步返回连接对象 → resolves 断言失败（红） |
| G1（改锚） | legacy `sa7-dynamic.test.ts:186-190`：无 hint 面 GOAWAY 后连接状态 `'ready'`→`'draining'`（L189）+ 注释同步；L190 起逐断言不变 | AC-5（§15.1 L411 字面） | 改锚后现实现残留 'ready' → 红（实现后转绿；设计 §6.4 对账：L190-215 逐断言不变） |

红线纪律：真实 yjs/Registry/Runtime 双实例；fake-duplex 内存双端（微任务投递）；fake
scheduler（零 real sleep）；断言 = wire 帧/状态投影/认证记账/连接分配观测（零源码 grep、零 mock 被测对象）。
A2-e 的同步重放 fixture 属 seam 层新增（设计 §11 治理放行），非 mock 被测对象。

## 运行证据（Round 1 R2，前置实现——必须全红）

```text
命令（独立后台进程；无端口依赖——fake-duplex，test-lock 无涉）：
  node node_modules/vitest/vitest.mjs run packages/ws-replication/test/ws-replication-auth-lifecycle-red.test.ts packages/ws-replication/test/ws-replication-sa7-dynamic.test.ts --reporter=verbose
结果：Test Files 2 failed (2) | Tests 16 failed | 5 passed (21)；Type Errors no errors；EXIT=1
  （红 = 红灯契约 15 IT + legacy G1 改锚；绿 = sa7-dynamic 其余 G2/W2/B2a/D2 + W1）
逐点失败（断言级）：
  #1   expected [] to deeply equal ['tok-test-...']             —— 认证记账缺失
  #2-5 expected HubConnectionImpl{…} to be undefined            —— upgrade 认证缺失（无效/缺失/文法违例/抛错凭据均分配）
  #6   settleUntil 预算耗尽（blocked 未达；连接已 ready）        —— 认证身份未绑定
  #7   expected +0 to be 1（无 NAMESPACE_UNAUTHORIZED 帧）       —— revoke 面缺失
  #8   revokeOutcome 'rejected'（TypeError: revoke is not a function）
  #9   expected 'ready' to be 'draining'（:293）                —— GOAWAY 未转移关态（含停 OPEN/retryAfter 面）
  #10  expected +0 to be 1（无 GOAWAY 帧）                       —— close 未先发 GOAWAY
  A2-a expected 'ready' to be 'draining'（:412）                 —— 无 hint 面不转移
  A2-b expected 'ready' to be 'draining'（:440；变体一 RED@1）   —— 无 draining 预设（停 round 面随之未达）
  A2-c expected 'ready' to be 'draining'（:508）                 —— 无 draining 预设（close-code 分类为实现后防线）
  A2-d expected HubConnectionImpl{…} to be undefined             —— 现实现 accept 同步分配；无预算/封顶（超时变体同理）
  A2-e expected HubConnectionImpl{…} to be undefined（resolves） —— 现实现 accept 同步分配返回连接对象
  G1   expected 'ready' to be 'draining'（sa7-dynamic:190）      —— legacy 改锚（§6.5 A1）
```

## Fixture/测试基础设施变更（随红灯契约）

- `test/driver.ts`：新增 `HubUpgradeRequest`/`PeerTokenVerifier` 契约镜像、`TEST_TOKEN`、
  `DEFAULT_PEER_VERIFIER`；`boot()` 增 `verifyToken/token/peerInstanceId` 选项，hub
  构造注入 `verifyToken`、dial 注入 `{ token }`、Run 暴露 `verifyCalls` 认证记账。
- 既有 accept 直调点（issue137-driver.ts、spec-b1-b2-red、sa7-issue137-dynamic、
  sa7-r2-transport）统一携带 `{ token: TEST_TOKEN }`——实现前为透明（参数被忽略），
  实现后走默认验证器保持绿。
- R2 新增：`ws-replication-auth-lifecycle-red.test.ts` 追加 A2-a..A2-e（含同步重放
  fixture、deferred verifier、hub-scheduler 推进）；`sa7-dynamic.test.ts` G1 L189 改锚
  （+L188 注释）——全量回归（R2）：`vitest run packages/ws-replication/test/` → 运行时
  **16 文件通过 / 105 用例通过**，失败 = 红灯契约 15 IT + G1 改锚 1 处（W1 保持绿）；
  typecheck 21 处报错全部属新契约面未落型（`verifyToken` 不存在、`accept` 双参——
  A2-d/A2-e 新调用点计入），SA3 落型后消解（预期）。
- `scripts/test-lock.sh`：仓库无此脚本（无 scripts/ 目录），无端口/新包依赖——无更新。
