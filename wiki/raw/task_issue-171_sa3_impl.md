# SA3 实现报告 — issue #171 命名空间生命周期跨连接代际竞态收口

**Date**: 2026-08-30（第 2 轮：SA4 复审 F1 回流修复）
**实现对象**: `task_issue-171_design.md`（R1 修订版 + R1.1 修订批，SA2 R2 verdict = pass；SA4 复审 = reject，阻断项 F1，本轮闭环）
**实现范围**: `packages/ws-replication/src/{peer-namespace,peer-connection,hub-namespace,lifecycle-queue}.ts`（ALLOW LIST §17 四项源码）；测试代码零改动（含 `[SA6 owned]` 文件与 SA4 新增 F1 锚——原样保留）。

---

## §1. 交付内容（对 §D1–§D9 逐条落实）

| 设计条款 | 文件 | 落实摘要 |
|---|---|---|
| §D1（§4.1/§4.2） | peer-namespace.ts | 新增 `CleanupClaim`（无 epoch——SA2 #3）、`enqueueLifecycle`、`claimForDisposal`、`runDisposal`（**身份守卫** `this.session === claim.session` + lease 子守卫）；删除 `closeSessionAndRelease`；`cleanupResources` 改为**排队前求值**（`const claim = this.claimForDisposal()` 于 lambda 外——SA2 #1 CRITICAL）；`unsubscribe` 只退捕获句柄（删除入口无条件 `quiesceSync()`） |
| §D2（§5） | peer-namespace.ts | `onCloseRequest` 重写：clearAllTimers + 同步段排队前捕获 claim + epoch 局部变量 + 续体 epoch 门（跨代零 CLOSE_OK/零迁移/零 settle） |
| §D3（§6） | peer-namespace.ts | `removeTarget` live 族拆 `seq > 0` / `seq ≤ 0` 两翼：seq≤0 → 本地收口 closed + 同步结算（AC3，不等 closeTimeout）；`ensureCloseMemo` 的 claim 于 memo 创建时捕获；**R1.1（F1）**：`case 'targeted'/'disconnected'` 本地收口分支补 `void this.cleanupResources().catch(() => undefined)`（见 §2.5） |
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

### §2.3 全量回归

**第 1 轮（SA3 202558b + 冻结测试原样）**：`pnpm exec vitest run packages/ws-replication` = **157 passed | 2 failed**，失败恰为两处已登记项：① `issue171-red` C4 的注入时序竞态（§2.2，生产链路已证绿）；② `sa6-hardening` AC3b §13.1 登记翻转（`[SA6 owned]`）。

**第 1.5 轮（SA6 R2 提交 fc09cbb：C4 时序修正 / AC3b 翻转 / C4b 新增）后复跑**：`pnpm exec vitest run packages/ws-replication --typecheck` = **160 passed | 0 failed**（SA4 独立复现一致）。

**第 2 轮（本报告，F1 修复后）**：`pnpm exec vitest run packages/ws-replication --typecheck` = **24 files | 161 passed | 0 failed**（Type Errors: no errors；含 `ws-replication-sa4-issue171-review-red.test.ts` F1 锚 1/1）。五链红灯（H1/P3/C4/C4b/G5）+ AC3b 翻转 + F1 全部绿；`sa7-issue137 D5`、`sa7-dynamic G1/G2`、`sa7-round2-dynamic D3`、`review-revisions R3-4/R3-5`、`sa7-hardening-dynamic D6`、`spec-b1-b2`、`r3-r4-regressions`、`ac1-ac7`、`sa4-*`、`api.test-d` 全绿——无未登记翻转。

### §2.4 静态验证

- `pnpm exec tsc -p packages/ws-replication/tsconfig.json` → 无错误（Type Errors: no errors 于全部 vitest 运行复验）。
- `git diff --check` → 见提交记录（无空白错误）。

### §2.5 F1 修复记录（SA4 复审阻断项闭环，2026-08-30）

**漏洞**（SA4 红队独立复现）：GOAWAY `SERVER_RESTARTING` drain 窗口内（轻量层 `onConnectionQuiesce` 已投影 `disconnected` 且**零处置排队**——§D6 设计如此）宿主调用 `removeTarget()` → 命中 `case 'disconnected'`（本地收口 `closed` + settle，无处置排队）→ deadline 全量层 `onConnectionFatal()` 首行 `if (this.isTerminal()) return;`（state 已 `closed`）早退 → 已取得 session/lease/watchdog 泄漏（AC2 违例；对 `ef19bae` 基线回归——旧实现该窗口 state 保持 `live`，removeTarget 走 `case 'live'` 收口链）。设计层根因 = R1 设计 §D3 该分支自身的洞（SA2 R2 新攻击扫描漏检「drain 窗口内 removeTarget」交叉）。

**修复（一行 + 注释；最小变更，终态早退门不拆）**：`peer-namespace.ts` `removeTarget` 的 `case 'targeted'/'disconnected'` 在 `settleCloseMemo()` 之后补：

```ts
// ★ F1（SA4 复审，issue #171）：本地结算同样排队处置——GOAWAY drain 窗口
// （轻量层 onConnectionQuiesce 投影 disconnected + **零处置排队**）内 removeTarget
// 落入本分支时，若不排队处置，deadline 全量层 onConnectionFatal 将以
// isTerminal()（closed）早退 → session/lease/watchdog 永久泄漏（AC2 违例；
// 对 ef19bae 基线回归）。补排 = 与同函数 seq≤0 分支同款：claim 于本同步段
// 捕获——'targeted' 态为空 → 幂等 no-op；'disconnected' 态 = 本代资源 →
// 恰一次处置（与 loss 路径已排队处置经幂等 same-promise 兑付）。**不拆**终态
// 早退门（onConnectionFatal 的 isTerminal() 保护终态控制器免受重复静默投影）。
void this.cleanupResources().catch(() => undefined);
```

**机制论证**：① claim 于 removeTarget 同步段求值（`cleanupResources` 排队前捕获）——`disconnected`（GOAWAY 窗口）态捕获本代 `{session, lease}`（unsubscribe 已被 `onConnectionQuiesce`→`quiesceSync` 清空）→ `runDisposal` 身份守卫命中 → 关 session、release lease、清字段 + watchdog/round/channel teardown（watchdog 自重武装链终止）；`targeted` 态 claim 为空 → 幂等 no-op；② 与 loss/断线路径已排队处置并存时，`session.close()`/`lease.release()` 幂等 same-promise（ADR-0009 L42）→ 恰一次兑付；③ `onConnectionFatal` 的 `isTerminal()` 早退门**保持不动**（保护终态控制器免受重复静默投影——SA4 明示禁止拆门）；④ 处置队列冲突面为零：闭合窗口内其余入口（deadline `onConnectionFatal` 早退、transport close 后生产路径 `onConnectionLost` 终态早退）均不重复排队。

**验证证据**：
- `pnpm exec vitest run packages/ws-replication/test/ws-replication-sa4-issue171-review-red.test.ts` → **1 passed**（F1：deadline 后 `session/lease` 字段清理 + `watchdogIdleArmed=false`——修复前该锚确定性红灯 `expected {…ReplicationSession} to be undefined`）。
- 固定复验范围（SA4 §2 指定）：`pnpm exec vitest run packages/ws-replication --typecheck` → **161/161 全绿**（160 既有 + F1），零回退。
- 受影响面自核：仅 `removeTarget` 新增分支（无既有绿灯锚依赖「targeted/disconnected 分支零处置」语义——§13.1/§13.2 全量回查无翻转）；五链红灯锚 + D5 计面 + AC3b 翻转均复验绿。

**伴随修订（设计文档，零机制改动）**：`task_issue-171_design.md` R1.1 修订批——① §D3 伪代码 `case 'targeted'/'disconnected'` 补 cleanupResources 语义；② §4.2 表 removeTarget 行「捕获时点/任务体」列同步；③ **R2-N1 落实**：总则 1/3 措辞对齐 §4.1 身份守卫语义（claim 无 epoch；字段/aux 处置以「自捕获以来未建立新 session」为准，含有意跨代清字段 + teardown 面）——纯措辞/一致性修正，无重设计。

---

## §3. 提交内容

**第 1 轮（202558b）**：
- `packages/ws-replication/src/peer-namespace.ts` — §D1/§D2/§D3/§D4/§D5.1-5.4/§D7/§D9（估 −90/+140 行）
- `packages/ws-replication/src/peer-connection.ts` — §D6 + isGoawayDraining 装配删除（估 −6/+10 行）
- `packages/ws-replication/src/hub-namespace.ts` — §D8/§D8.5/§D9（估 −20/+60 行）
- `packages/ws-replication/src/lifecycle-queue.ts` — 模块头注释（§D9 裁决；零代码改动）
- `packages/ws-replication/test/ws-replication-issue171-red.test.ts` — [SA6 owned] 冻结契约文件原样纳入提交（零改动）
- `wiki/raw/task_issue-171*.md`、`wiki/raw/20260830-bug-issue-171.md` — 本轮全部 wiki 档案归档

**第 2 轮（本报告，F1 回流修复）**：
- `packages/ws-replication/src/peer-namespace.ts` — F1 一行修复 + 注释（§2.5；`removeTarget` `case 'targeted'/'disconnected'` 补处置排队）
- `wiki/raw/task_issue-171_design.md` — R1.1 修订批（§D3 伪代码 + §4.2 表 + 总则 1/3 R2-N1 措辞对齐；头注登记）
- `wiki/raw/task_issue-171_sa3_impl.md` — 本报告（§2.5 修复证据）
- SA4 新增 `packages/ws-replication/test/ws-replication-sa4-issue171-review-red.test.ts`（F1 锚）与 `wiki/raw/task_issue-171_sa4_review.md` — [SA4 owned] 原样纳入提交（零改动；保留全部测试，零删除）

---

## §4. 交接给 SA4/SA6/SA7 的注记

- **SA4**：F1 已按 §2 回流目标闭合（一行修复 + 终态早退门未拆 + F1 锚转绿 + 固定复验范围 161/161 全绿）；设计注记批（§D3/§4.2/R2-N1）已在 `task_issue-171_design.md` R1.1 修订批落实。其余维度（五链机制/Scope/调试残留）第 1 轮已通过，本轮零新面。
- **SA6**：① §13.4 六新锚（P3b/C4b/L1/W1/W2/W3）决策项——C4b 已新增（fc09cbb），P3b/L1/W1/W2/W3 未新增；F1 锚已由 SA4 补上（`ws-replication-sa4-issue171-review-red.test.ts`），可斟酌收编/迁移（非阻断）；§13.4 L1「不新增」理由中的 H1/P3/D5 代偿主张已被 F1 证伪，决策表宜补注（SA4 §0 注记）。
- **SA7**：动态面确认项——①收帧段 ns `disconnected` 提前投影（G1 明言不断言、R3-5 提前后平凡成立，动态面留证）；②hub applyStep2 isQuietState 门（设计自核零既有测试依赖 closing 期 SYNC_APPLIED）；③F1 修复后的真机回归面（GOAWAY RESTARTING 窗口内 removeTarget → deadline → registry `lease-released` 恰一次 + 无 watchdog 空转——静态锚已覆盖测试环境，动态面确认真 WS transport close 触发本地 onClose 后同样收口）；④SA4 §3 N1（drain 窗口内在途 `startOpen` 续体 B-2c 守卫的 OPEN_NAMESPACE 出站面）。
- 全程遵守 Jim 铁律：`src/` 零 env-override / 零 fallback 软兜底（全部路径 = 显式收口或协议规定静默）；零 DENY LIST 文件改动；零测试删除（SA4 F1 锚保留、SA6 全部锚保留）。
