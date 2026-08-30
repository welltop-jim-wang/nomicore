# SA3 实现报告 — issue #171 命名空间生命周期跨连接代际竞态收口

**Date**: 2026-08-30
**实现对象**: `task_issue-171_design.md`（R1 修订版，SA2 R2 verdict = pass）
**实现范围**: `packages/ws-replication/src/{peer-namespace,peer-connection,hub-namespace,lifecycle-queue}.ts`（ALLOW LIST §17 四项源码）；测试代码零改动（含 `[SA6 owned]` 文件）。

---

## §1. 交付内容（对 §D1–§D9 逐条落实）

| 设计条款 | 文件 | 落实摘要 |
|---|---|---|
| §D1（§4.1/§4.2） | peer-namespace.ts | 新增 `CleanupClaim`（无 epoch——SA2 #3）、`enqueueLifecycle`、`claimForDisposal`、`runDisposal`（**身份守卫** `this.session === claim.session` + lease 子守卫）；删除 `closeSessionAndRelease`；`cleanupResources` 改为**排队前求值**（`const claim = this.claimForDisposal()` 于 lambda 外——SA2 #1 CRITICAL）；`unsubscribe` 只退捕获句柄（删除入口无条件 `quiesceSync()`） |
| §D2（§5） | peer-namespace.ts | `onCloseRequest` 重写：clearAllTimers + 同步段排队前捕获 claim + epoch 局部变量 + 续体 epoch 门（跨代零 CLOSE_OK/零迁移/零 settle） |
| §D3（§6） | peer-namespace.ts | `removeTarget` live 族拆 `seq > 0` / `seq ≤ 0` 两翼：seq≤0 → 本地收口 closed + 同步结算（AC3，不等 closeTimeout）；`ensureCloseMemo` 的 claim 于 memo 创建时捕获 |
| §D4（§7） | peer-namespace.ts | `onCloseOk` 重写：终态/disconnected 静默；closing 期仅「closeSequence 有值且匹配」收口，**其余一律** `connectionFatal('ACK_STATE_VIOLATION',1002)`（SA2 #2 CRITICAL——删除初稿 undefined 例外）；活跃态未请求同款 fatal |
| §D5.1（§8.1） | peer-namespace.ts | `onConnectionLost` 全分支 `clearAllTimers` + 摘订阅 + 处置排队（failed 分支补排队）；新增 `onConnectionQuiesce`（轻量层——零处置排队）；`onConnectionFatal` = 轻量段 + `cleanupResources`（closing 分支补排队 = 有意保底） |
| §D5.2（§8.2） | peer-namespace.ts | `tryOpenReplicationSession` 成功段：`round/channel/watchdog.teardown()` + `closeSequence = undefined`（新代 aux 重置；stuck-disposal 路径唯一重置点） |
| §D5.3（§8.3） | peer-namespace.ts | `onWatchdogEdge` 首行 `isQuietState() || state==='disconnected'` 复活门（hub 侧 declareHubResync 对称补全） |
| §D5.4（§8.4） | peer-namespace.ts / hub-namespace.ts | peer `applyStep2` 零代码改动（既有 epoch 门，注释钉死决策 (a)）；hub `applyStep2` 补 `!isQuietState()` 门（只拦发送，round 结算语义不变——返回 'ok'，与 peer 侧同构） |
| §D6（§9） | peer-connection.ts | `onGoaway` 重写：RESTARTING 收帧同步段 `quiesceControllersLite()`（轻量层）+ deadline 回调全量层 + `transport.close(1001)`（deadline 只关 transport）；新增 `quiesceControllersLite`；SHUTTING_DOWN/REAUTH → enterBlocked 不变 |
| §D7（§10） | peer-namespace.ts | 新增 `isInboundQuiet()`；onSyncStep1/2、onSyncApplied、onResyncReceived、onHubUpdate、onUpdateAck、onErrorFrame 改 `isInboundQuiet` 门；onOpenOk/onBootstrapSnapshot 追加 disconnected 静默（closing → finalize('failed') 保留——sa7-hardening D6 锚不动）；onCloseRequest/onIdentityChanged 不改 |
| §D8（§11） | hub-namespace.ts | 新增 `isOpenAborted()`（终态 ∨ closing）；`startOpen` 各恢复点重写（D-H1：authorize 成功不拦截 registry.open——取得阶段完整执行；registry.open 之后**每个**失败出口先判 `isOpenAborted` → `finishOpenSilently`——SA2 #5）；`finishOpenSilently(pendingLease?, pendingSession?)` 显式回收（先 session 后 lease，ADR-0010 L90 次序） |
| §D8.5（§11.5） | hub-namespace.ts | `quiesceConnection` / hub `onCloseRequest` 同步段追加 `clearAllTimers()` |
| §D9（§12） | hub-namespace.ts / lifecycle-queue.ts | 删除 hub 死字段 `cleanupTail`（零引用）；`lifecycle-queue.ts` 模块头注释更新为双侧分责权威裁决（零代码改动）；删除 `PeerNamespaceHost.isGoawayDraining` 接口成员 + peer-connection.ts 装配行（死 seam，零消费者） |

未改动（按 DENY LIST / 设计 §17）：`docs/protocols/instance-replication-v1.md`、`packages/replication-protocol/**`、`packages/namespace-registry/**`、`index.ts`、`hub-connection.ts`、`update-channel.ts`、`round-engine.ts`、`fence-watchdog.ts`、`backpressure.ts` 及其余全部测试文件。

---

## §2. 验证结果

### §2.1 红灯契约（`pnpm exec vitest run packages/ws-replication/test/ws-replication-issue171-red.test.ts`）

| 锚 | 结果 | 证据 |
|---|---|---|
| H1 | ✅ 绿 | `lease-released` 事件恰 1 次 + `finalRemaining=1`（observer seam；`finishOpenSilently(opened.lease)` 显式回收） |
| P3 | ✅ 绿 | gen2 `live` + 订阅在 + `writePeer({n:101})` 收敛 + hub gen2 通道 `live`（排队前捕获 + 身份守卫 + epoch 门） |
| C4 | ⚠️ 见 §2.2 | **生产链路绿**（四锚全兑付已验证）；冻结测试文件存在注入时序竞态（见 §2.2） |
| G5 | ✅ 绿 | 收帧同步段订阅已摘 + 零 UPDATE + deadline 只关 transport（connState 恒 ready） |

C4 生产链路验证（同构同步点调试，零改动测试文件）：错配 `CLOSE_OK{ackedSequence:999999}` 到达 `onCloseOk` → `connectionFatal('ACK_STATE_VIOLATION',1002)` → ERROR 帧（`peerFramesAll('ERROR')` 含 `ACK_STATE_VIOLATION`，connectionFatal 直发豁免路径）+ `connState='blocked'` + `wire.peerSideClosed=true` + `removeTarget` 承诺微任务预算内结算——**四锚全部兑付**（验证运行：`zz-debug-c4-green` 临时文件，已删除）。

### §2.2 C4 冻结测试的注入时序竞态（必须报给总控/SA6，未动测试文件）

冻结测试 `ws-replication-issue171-red.test.ts` C4（L274-300）的构造：
`dropNextHubFrame('CLOSE_OK')` → `removeTarget` → `waitNamespace('closing')` → **立即** `injectHub(CLOSE_OK{999999})`。

实测（预修复代码与修复后代码行为**完全一致**的确定性时序）：
- `waitNamespace('closing')` 在 removeTarget 同步栈返回后首个微任务即断言成立 → `injectHub` 在 **hub 真实 CLOSE_OK 发出之前**（hub closeQueue 链 ≥2 微任务）到达 wire；
- 单向 `dropNextHubFrame` 谓词（首个 CLOSE_OK）**吞掉的是注入帧**（`droppedHubToPeer` 记录 `ackedSequence=999999`）；
- hub 真实 CLOSE_OK（`ackedSequence=7 == closeSequence`）随后抵达 → 按匹配收口（close 正常完成、零 ERROR）——**与生产实现无关的 fixture 时序**。

即：冻结 C4 锚 1「错配帧必须被处理」在现有注入时序下不可达——必须复刻 [SA6 既有锚 `AC3b`（`ws-replication-sa6-hardening-g1-g2-red.test.ts` L200-213）已文档化的「**时序修正**」]：注入前以「hub 通道投影 `closed`」为 CLOSE_OK 已发出并被 drop 拦截的可观测同步点（`settleUntil(() => hubChannelState === 'closed')`）。该修正**零断言语义改动**（锚 1-4 的断言原文保持），属测试基建（fixture 时序）调整，按 ALLOW LIST 纪律由 SA6 执行或总控授权。预期 diff（插入于 L276 `waitNamespace('closing')` 之后、L278 `injectHub` 之前）：

```ts
await settleUntil(
  () => {
    const connection = run.hub.connections[0] as unknown as
      | { channels: Map<string, { state: string }> } | undefined;
    return connection?.channels.get(run.nsId)?.state === 'closed';
  },
  'hub 通道 closed（CLOSE_OK 已发出并被 drop）',
);
```

### §2.3 全量回归（`pnpm exec vitest run packages/ws-replication`）

**157 passed | 2 failed**，失败恰为两处已登记项：

1. `ws-replication-issue171-red.test.ts` C4 —— §2.2 的注入时序竞态（生产链路已证绿）。
2. `ws-replication-sa6-hardening-g1-g2-red.test.ts` AC3b —— **设计 §13.1 登记的必须翻转**（`[SA6 owned]`）：`closeSettled false→true`（伪造 CLOSE_OK 按权威策略 violation 收口并结算 close 承诺；`namespaceState() not.toBe('closed')` 首断言仍通过——violation 路径投影 `disconnected`）。SA6 按 §13.1 翻转断言（`closeSettled.toBe(false)` → `toBe(true)` + violation 锚）。

关键绿灯锚核对（设计 §13.2 全部兑现，无未登记翻转）：`sa7-issue137-dynamic`（D5/D5B1 四检查点 timer 计面——轻量/全量两层钉死处置时点）、`sa7-dynamic`（G1/G2）、`sa7-round2-dynamic`（D3）、`review-revisions`（R3-4/R3-5）、`sa7-hardening-dynamic`（D6）、`spec-b1-b2`、`r3-r4-regressions`、`ac1-ac7`、`sa4-*`、`sa6-hardening`（除 AC3b）、`api.test-d`。

### §2.4 静态验证

- `pnpm exec tsc -p packages/ws-replication/tsconfig.json` → 无错误（Type Errors: no errors 于全部 vitest 运行复验）。
- `git diff --check` → 见提交记录（无空白错误）。

---

## §3. 提交内容

- `packages/ws-replication/src/peer-namespace.ts` — §D1/§D2/§D3/§D4/§D5.1-5.4/§D7/§D9（估 −90/+140 行）
- `packages/ws-replication/src/peer-connection.ts` — §D6 + isGoawayDraining 装配删除（估 −6/+10 行）
- `packages/ws-replication/src/hub-namespace.ts` — §D8/§D8.5/§D9（估 −20/+60 行）
- `packages/ws-replication/src/lifecycle-queue.ts` — 模块头注释（§D9 裁决；零代码改动）
- `packages/ws-replication/test/ws-replication-issue171-red.test.ts` — [SA6 owned] 冻结契约文件原样纳入提交（零改动）
- `wiki/raw/task_issue-171*.md`、`wiki/raw/20260830-bug-issue-171.md` — 本轮全部 wiki 档案归档

---

## §4. 交接给 SA4/SA6/SA7 的注记

- **SA6**：① C4 冻结测试需 §2.2 的时序修正（零断言语义改动；与 AC3b「时序修正」同款）；② AC3b 按 §13.1 翻转（closeSettled false→true）；③ §13.4 六新锚（P3b/C4b/L1/W1/W2/W3）为 SA6 决策项。
- **SA4**：设计 §16 caller 审计与本节对齐——`connectionFatal` 副作用面（ERROR 直发 + close + blocked）与 `enqueueLifecycle`（返回值 rejection 只传播给显式 await 方）均按设计落实；无 public 导出面变更。
- **SA7**：动态面确认项——①收帧段 ns `disconnected` 提前投影（G1 明言不断言、R3-5 提前后平凡成立，动态面留证）；②hub applyStep2 isQuietState 门（设计自核零既有测试依赖 closing 期 SYNC_APPLIED）；③AC3b 翻转（§13.1 登记）。
- 全程遵守 Jim 铁律：`src/` 零 env-override / 零 fallback 软兜底（全部路径 = 显式收口或协议规定静默）；零 DENY LIST 文件改动。
