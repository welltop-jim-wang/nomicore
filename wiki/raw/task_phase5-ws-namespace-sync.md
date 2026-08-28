# 任务简报 — Phase 5: synchronize one namespace over WebSocket（issue #136）

- run_id: issue-136-1787888033-8367
- round: 1
- branch: fix/issue-136-on-docs-phase-5-websocket-replication
- 任务类型: 功能开发（feature）
- Parent: PR #130（docs/phase-5-websocket-replication）

## What to build（issue 原文）

Make one configured Peer namespace synchronize end to end with a Hub over the v1 protocol, including authorization, open, absent-replica bootstrap, matching-replica bidirectional reconciliation, live updates, acknowledgements, resync, and orderly namespace close.

## Acceptance criteria（issue 原文）

- [ ] A Peer target contains namespaceId and Peer-local owner; the Hub authorization result supplies independent Hub-local owner and read/submit permissions.
- [ ] OPEN correctly selects bootstrap or reconcile and rejects unauthorized, missing, disabled, lineage-mismatched, and epoch-mismatched namespaces without leaking owner data.
- [ ] Bootstrap transfers one bounded full snapshot, imports it exclusively, acknowledges installation, and then performs mandatory bidirectional reconciliation.
- [ ] Peer-initiated sync rounds require both directions' Step2 apply plus SYNC_APPLIED before entering live.
- [ ] Live UPDATE/UPDATE_ACK semantics match the protocol and every remote update uses ReplicationSession sequencing and dirty notification.
- [ ] RESYNC_REQUIRED, ACK timeout, normal close, terminal ERROR, identity change, socket loss, and reconnect all reach the specified namespace states without a durable outbox.
- [ ] Fake-duplex deterministic tests cover the complete namespace and sync state machines, wrong-order frames, duplicate controls, apply failures, degraded behavior, and cleanup races.

## Blocked by（全部已 CLOSED，对应实现已在本分支历史）

- #133 Phase 5: bootstrap import, archive, and guarded replica reset（PR #147 已合入栈）
- #134 Phase 5: expose trusted NamespaceLease ReplicationSession（PR #146）
- #135 Phase 5: implement instance replication protocol v1 codec（PR #144）

## 规格与决策基准（必读）

- `docs/phases/phase-5-websocket-replication.md` — Phase 5 总纲；本 issue 对应实施切片 6（`@nomicore/ws-replication` namespace 状态机），并依赖切片 1–5 已交付物；§协议与状态机验收 / §必须通过的场景 / §测试 seam / §非目标 / §阶段门禁 为本任务验收基准。
- `docs/protocols/instance-replication-v1.md` — v1 协议帧、状态机、时序语义。
- `docs/adr/0010-hub-peer-websocket-ydoc-replication.md` — ADR 0010 复制谱系/epoch/bootstrap/重连决策。
- `CONTEXT.md` — 项目术语与纪律。

## 既有交付物（本分支已存在，SA 需先勘察复用）

- `packages/replication-protocol` — v1 codec（#144）
- `packages/persistence` — importDoc / archiveDoc（#147）
- `packages/namespace-registry` — importReplica / resetReplica / ReplicationSession（#146/#147）
- namespaceId 生成与 Registry 身份迁移（#143）、复制身份与 epoch 管理（#145）

## 流水线记录

- dispatch log: `wiki/raw/task_phase5-ws-namespace-sync_dispatch.md`

---

## SA6 红灯验收测试（Phase 1 验收锚定，2026-08-28 追加 · issue #136 切片 6 红色契约）

**产出目录**：`packages/ws-replication/test/`（包本体由 SA3 创建；SA6 只写测试与共享基建，未创建 package.json/src）。

### 文件清单与 7 条 AC 覆盖映射

| 文件 | 锚定的验收项 | 关键断言（行为锚） |
|---|---|---|
| `harness.ts` | 测试 seam（phase-5 §测试 seam） | fake-duplex 内存双端（一 WS message = 一 frame、微任务投递、顺序保序、丢帧/关闭 seam）；StubPersistence（saveDoc 门闩=「dirty 未登记完成」时序锚、importDoc 门闩=导入竞态锚、handle 状态可编程=degraded 锚）；真实 Registry+Runtime（createNamespaceRegistryForTesting + 受控 clock/scheduler/randomBytes）；帧解码（真实 codec） |
| `driver.ts` | 全部 AC（编排层） | 双实例组装 `boot`/`bootFanout`（独立 Persistence、独立 Registry、role hub/peer）、授权 spy、`injectPeer`/`injectHub`（严格序列注入）、`dropNext*`（故障注入）、`advanceMs`（全虚拟时间） |
| `ws-replication-api.test-d.ts` | 契约类型面 | createHubReplication/createPeerReplication 签名、PeerReplication（addTarget/removeTarget/状态投影）、DuplexTransport、ReplicationTarget{namespaceId,localOwner}、NamespaceAuthorizer（§19）、limits/timeouts/backoff、DEFAULT_* 常量 |
| `ws-replication-ac1-ac2-open.test.ts` | **AC1+AC2** | ACL1: target {nsId, localOwner} 不上 wire（解码全帧无 owner 键/值）；授权结果 → 独立 Hub owner（Hub entry owner ≠ Peer localOwner 才能走到 OPEN_OK——错误 owner 即 NAMESPACE_NOT_FOUND，端到端证明授权 owner 被使用）；read/submit 权限使用（read:false→OPEN 拒；submit:false→UPDATE 拒）；addTarget/removeTarget 幂等。AC2: OPEN 选择（hasLocalReplica=false→mode0，true 同源→mode1）、拒绝五态（UNAUTHORIZED 含缺失不泄露 / NOT_FOUND / NOT_ENABLED / ID_MISMATCH→conflicted / EPOCH_MISMATCH→conflicted）、conflicted/closed 后重开→NAMESPACE_REOPEN_REQUIRES_RECONNECT、未知 target→TARGET_NOT_REQUESTED |
| `ws-replication-ac3-bootstrap.test.ts` | **AC3** | OPEN_OK(0)→恰一帧 BOOTSTRAP_SNAPSHOT（单帧完整 `encodeStateAsUpdate`，应用即完整 Hub 状态）；BOOTSTRAP_ACK(ackedSequence=快照 sequence) 先于一切 sync 帧；ACK 后强制 round 1；BOOTSTRAP_TOO_LARGE（不分块不 fallback）；并发 duplicate→BOOTSTRAP_FAILED 且不覆盖既有副本；bootstrap timeout→收口 failed（不重发） |
| `ws-replication-ac4-reconcile.test.ts` | **AC4** | Peer 以 syncRoundId 发起；Hub 不自行开始（收到新 round 才发自己 Step1）；同 round 双向 Step1→Step2（relatedStep1Sequence=被响应 Step1 的 sequence）→SYNC_APPLIED；双方向都收到 Applied 才 live（丢一个 Applied→停在 reconciling，reconcile timeout→failed）；错序/重复/错误 round→SYNC_STATE_VIOLATION；空 diff 完整走 Step2/Applied；确定性数据互换（n/ext/extra 非冲突键） |
| `ws-replication-ac5-live.test.ts` | **AC5** | UPDATE→Hub 单槽 apply+dirty→UPDATE_ACK(ackedSequence=UPDATE sequence)；ACK 只在 saveDoc 完成后（saveDoc 门闩：挂起期零 ACK）；echo 抑制（A 不回送）+ B 收 fan-out UPDATE 并 ACK+数据收敛（bootFanout 双 peer）；滑动窗口（maxInFlightUpdates=2 → 第 3 笔抑制，窗口收口放行）；重复 update 仍 ACK；ACK_STATE_VIOLATION→connection fatal（blocked+关闭）；UPDATE_TOO_LARGE→零写入 |
| `ws-replication-ac6-resync-close.test.ts` | **AC6** | RESYNC_REQUIRED（队列溢出→needs-resync，此后新 roundId=2 由 diff 补齐，不再发 UPDATE）；ACK timeout→needs-resync（不重发同一 UPDATE，state-vector round 修复）；正常 close（CLOSE→CLOSE_OK(ackedSequence)→closed，不等待丢失 ACK，closed 后重开→REOPEN_REQUIRES_RECONNECT）；terminal ERROR→failed（后续零帧）；IDENTITY_CHANGED→conflicted（META 不当 UPDATE 应用、本地 epoch 不变）；socket 断开→disconnected（无 outbox：断线写零 UPDATE 帧，重连 state-vector 修复）；bootstrap 中断线→重连完整重 bootstrap |
| `ws-replication-ac7-faults.test.ts` | **AC7** | 错序（OPEN_OK 前 UPDATE→NAMESPACE_STATE_VIOLATION）；重复控制帧（同 round 重复 SYNC_APPLIED→SYNC_STATE_VIOLATION）；apply 失败（不可解码 update→APPLY_FAILED 零写入）；hub degraded（PERSISTENCE_DEGRADED→failed，恢复后 reconciliation 补齐）；peer degraded（hub→peer 仍内存 apply+saveDoc 登记+ACK 照发）；cleanup 竞态（removeTarget 与在途 apply：CLOSE_OK 只在 apply settle 后、apply 不丢；socket 断开与在途 apply：drain 完成）；cleanup 合流（并发 removeTarget×2→恰一 CLOSE 帧）；构造期响亮校验（§17 三类非法配置→TypeError）；保护检查（SCHEMA/META 篡改→PROTECTED_FIELD_MUTATION 零写入、身份不漂移）；错误 round→SYNC_STATE_VIOLATION |

### SA6 冻结契约面（`@nomicore/ws-replication`，切片 6——实现必须逐字段对齐）

主入口导出：

```ts
export interface ReplicationLimits { maxFrameBytes; maxBootstrapBytes; maxSyncDiffBytes;
  maxUpdateBytes; maxQueuedUpdateBytes; maxQueuedUpdateCount; maxInFlightUpdates;  // 默认 32
  maxQueuedBytesPerConnection; lowWater; highWater }
export interface ReplicationTimeouts { helloTimeoutMs; openTimeoutMs; bootstrapTimeoutMs;
  reconcileTimeoutMs; closeTimeoutMs; ackTimeoutMs }
export interface ReplicationBackoff { baseMs; maxMs; resetAfterMs }
export const DEFAULT_REPLICATION_LIMITS / DEFAULT_REPLICATION_TIMEOUTS / DEFAULT_REPLICATION_BACKOFF
export interface DuplexTransport { send(bytes); close(code?, reason?); readonly closed;
  onMessage(l): () => void; onClose(l): () => void }   // 一 WS binary message = 一 frame
export interface ReplicationTimer { setTimeout(cb, ms): unknown; clearTimeout(h): void }
export type NamespaceAuthorization = { ok: true; localOwner: NamespaceOwner;
  permissions: { read: boolean; submit: boolean } } | { ok: false }
export type NamespaceAuthorizer = (instanceIdentity: string, namespaceId: string) => Promise<NamespaceAuthorization>
export interface ReplicationTarget { namespaceId; localOwner }   // 精确两字段，不上 wire
export interface HubReplicationOptions { instanceId; registry; authorize; timer; limits?; timeouts? }
export interface HubReplication { accept(t: DuplexTransport): HubConnection; readonly connections;
  close(): Promise<void> }
export interface HubConnection { state: 'handshaking'|'ready'|'draining'|'closed';
  peerInstanceId?: string; close(code?, reason?) }
export interface PeerReplicationOptions { instanceId; hubInstanceId; registry; dial(): DuplexTransport;
  timer; targets?; limits?; timeouts?; backoff?; random?: () => number }
export interface PeerReplication { start(): void; stop(): Promise<void>;
  addTarget(target): void; removeTarget(namespaceId): Promise<void>;   // ADR 0010 冻结名
  getConnectionState(): 'stopped'|'disconnected'|'connecting'|'handshaking'|'ready'|'draining'|'backoff'|'blocked';
  getNamespaceState(namespaceId): 'targeted'|'opening'|'bootstrapping'|'reconciling'|'live'|
    'needs-resync'|'closing'|'closed'|'conflicted'|'failed'|'disconnected' | undefined }
export function createHubReplication(options): HubReplication
export function createPeerReplication(options): PeerReplication
// /testing：createMemoryDuplexTransport(): { peer, hub }（内存双端；本批测试用 harness 内置同形实现）
```

### SA6 裁决注记（规格未逐字钉死、测试钉死处的依据）

1. submit:false 的 wire 码 = `NAMESPACE_UNAUTHORIZED`（§19 授权语义；只断言拒绝+零写入+无 ACK+收口，码可经 Spec 轴修正为其他授权类码——一处改动）；
2. OPEN_OK 前的 UPDATE → `NAMESPACE_STATE_VIOLATION`（§7.2「不得收发」+§13.2 命名空间状态机码）；
3. 不可解码 update → `APPLY_FAILED`（§20 scratch malformed）；
4. RESYNC_REQUIRED 的触发面取「发端（peer）本地未发送队列溢出后声明」（§9.4 任一端可声明 + §17 溢出语义）；
5. 空 diff 实测为 y-protocols 2 字节封装，断言 ≤4 字节 + 应用后状态向量不变（不锁定具体字节）；
6. IDENTITY_CHANGED 经 Hub bump（fixture lease.bumpReplicationEpoch）触发，§11 冻结。

### 红灯运行验证（真实执行，独立进程）

命令：`pnpm exec vitest run packages/ws-replication`（worktree 根；后台独立进程，退出码落盘）。

结果（`/tmp/sa6-red-run.log` 与终轮修订后重跑 `/tmp/sa6-red-final.log`，exit=1）：

```
Test Files  7 failed (7)      ← 6 个 .test.ts 套件加载失败 + api.test-d.ts 类型检查失败
Tests       1 failed | 8 passed (9)   ← test-d 的 9 项类型项（未实现包下其余 8 项空转）
Type Errors 1 failed
Errors      36 errors
EXIT=1
```

失败根因（每条即为预期红灯锚点）：`@nomicore/ws-replication` 包不存在 → `Cannot find module '@nomicore/ws-replication'`（TS2307/模块解析失败）；连带 `@nomicore/replication-protocol`、`yjs` 同因包缺席（无 package.json/node_modules）无法解析——SA3 建包并声明 yjs/y-protocols/lib0 + workspace 依赖后消解（与 issue #135 先例一致，见 task_replication-protocol-v1-codec.md 红灯记录）。

**测试代码类型干净性验证**：以 /tmp 契约 stub（与冻结契约面逐字段一致）+ 路径映射 tsc 全量校验 7 个 .ts/.test-d.ts（`tsc -p /tmp/wsstub/tsconfig.json`）→ **exit 0，零错误**——红灯仅来自「包未实现」，无测试侧类型缺陷。

**harness 基建 smoke 验证**（临时文件，已删除）：makeHubNamespace（create+enable+身份合规）、makePeerReplica（导入成功/duplicate 分类）、StubPersistence（saveGate 单次门闩/importHold 竞态 duplicate）、makeWire（微任务投递+顺序+丢帧+关闭传播）、settleUntil —— 全绿（5/5），确认基建本身行为正确。

禁止事项核对：无源码 grep 断言（全部为 wire 帧/持久化内容/状态投影/异常分类/模块导出/时序门闩断言）；未创建 package.json/src；`scripts/test-lock.sh` 不存在（无脚本需维护）；零 real sleep（fake scheduler + 微任务 + 门闩驱动）。

### SA6 测试对齐修订记录（R2，2026-08-30 · 按设计 §18.11 冻结测试对齐清单 #1–#7）

> 背景：SA8 设计后复审裁定设计 2 处偏离 ADR 字面（CP-1 序列跳跃容忍 vs ADR 0010 L147；CP-2 溢出整连接重建 vs ADR 0010 L165/协议 §9.4/§17），总控裁决维持 ADR 字面；SA1 已完成设计 R2 修订（`wiki/raw/task_phase5-ws-namespace-sync_design.md` §18.8/§18.10/§18.11）。SA6 依 §18.11 清单修订冻结测试（只改清单内断言/用例形态；清单外用例逐一核对未动——见设计 §18.11「不受影响用例」附注，与本次 diff 一致）。

| §18.11 | 文件 | 用例 | 修订内容 |
|---|---|---|---|
| #1 | `ws-replication-ac1-ac2-open.test.ts` | AC1 幂等 addTarget/removeTarget | 尾断言 `run.frames().peerToHub.filter(HELLO) → 2`（算术冲突：`frames()` 恒取最后一条 wire、单连接单 HELLO）改 `run.peerFramesAll('HELLO') → 2`（全连接聚合，行为不变；重建=新拨号+新 HELLO、1/wire） |
| #2 | `ws-replication-ac4-reconcile.test.ts` | 重复 Step1（同 round） | 保留 `errorCodes(hubFrames(ERROR)) 含 SYNC_STATE_VIOLATION`（hub 判定不变、帧仍在 wire）；终态 `waitNamespace('failed')` → `waitNamespace('disconnected')` + `connectionState()==='blocked'`（hub ERROR 帧携带 gap → peer 先判 SEQUENCE_VIOLATION fatal） |
| #3 | `ws-replication-ac6-resync-close.test.ts` | RESYNC_REQUIRED（队列溢出） | `STEP1 toHaveLength(1)/[0].roundId=2` → `toHaveLength(2)/[1].roundId=2`（CP-2：channel 级恢复、同连接；roundId per-target 持久：r1 bootstrap + r2 恢复）；其余断言（RESYNC×1、UPDATE×1、needs-resync、hub extra=2/n=1）不变 |
| #4 | `ws-replication-ac6-resync-close.test.ts` | ACK timeout | 改为跨连接收敛形态：丢 ACK → `needs-resync`（timer 锚保留）→ 同连接 STEP1[1].roundId=2 发出 → hub 响应携带 gap → `SEQUENCE_VIOLATION` fatal（`disconnected`+`blocked`）→ 测试侧 `addTarget`（config-change 重建 §14.1）→ re-OPEN/reconcile → `live` + `hub n=9`；「不重发同一 UPDATE」沿全帧聚合基面 `peerFramesAll`（全生命周期恰一帧、字节 toEqual 一致）保留（原字节同一性比较为缺陷，一并修正） |
| #5 | `ws-replication-ac6-resync-close.test.ts` | 正常 close | 「不等待 ACK」改无丢帧形态：saveGate 悬挂在途 apply（ACK 未发出）→ removeTarget → CLOSE 帧发出、CLOSE_OK 只在 apply settle 后 → closed + 已接纳 apply 不丢；原「丢 ACK 后同连接注入 OPEN→REOPEN_REQUIRES_RECONNECT」断言移除（CP-1 下 wire 关闭注入不可达；该语义由 AC1/AC2 注入式 reopen 用例覆盖）；保留幂等 removeTarget 与 closed 后 addTarget 重建→live |
| #6 | `ws-replication-ac7-faults.test.ts` | 重复控制帧（重复 SYNC_APPLIED） | 同 #2：保留 hub SYNC_STATE_VIOLATION ERROR 断言；终态 → `disconnected` + `blocked` |
| #7 | `ws-replication-ac7-faults.test.ts` | 错误 round（STEP2 roundId=500） | 同 #2/#6：保留 hub SYNC_STATE_VIOLATION ERROR 断言；终态 → `disconnected` + `blocked` |

**修订后红灯再验证**（独立进程，`pnpm exec vitest run packages/ws-replication`，`/tmp/sa6-red-r2-align.log`，exit=1）：

```
Test Files  7 failed (7)      ← 6 套件加载失败 + api.test-d.ts 类型检查失败（与修订前同构）
Tests       1 failed | 8 passed (9)
Type Errors 1 failed
Errors      36 errors
EXIT=1
```

失败根因逐条核对：全部 38 处为模块解析错误（`Cannot find package/module '@nomicore/ws-replication' | '@nomicore/replication-protocol' | 'yjs' | '@nomicore/persistence' | '@nomicore/namespace-registry(/testing)'`，因包未实现、无 package.json/node_modules 解析面）——**零 syntax/transform/parse 错误、零断言级错误**；红灯仍纯由「包未实现」产生，无测试自身缺陷引入。

**类型干净性复核**：修订后 `/tmp/wsstub` 契约 stub + 路径映射 `tsc -p /tmp/wsstub/tsconfig.json` → exit 0（7 文件零错误）。

### SA6 红灯补测记录（R3 追加 + R4/N-1，2026-08-30 · 设计定稿 §18.11「R3 追加」节）

> 背景：设计定稿（SA2 R3 verdict: pass）。SA2 R1 攻击评审移交 7 项新增红灯 IT 方向（§18.11「R3 追加」节）；R4/N-1 再追加 ⑧（encode* 同步 throw 面）。SA6 落地为新增文件 **`packages/ws-replication/test/ws-replication-r3-r4-regressions.test.ts`**（11 条 it；既有冻结断言零改动——仅 driver.ts 新增 `collectUnhandledRejections()` 探针辅助）。

| 设计条目 | 本文件用例 | 对齐的设计形态（R4 定稿） |
|---|---|---|
| ① 恢复窗口 UPDATE 容忍 | `① 恢复窗口 UPDATE 容忍` | §11.1/§11.3 状态门 R3/#1 收窄（needs-resync/恢复期 reconciling/live 照常 accept）；§10.4 同连接恢复：saveGate 悬挂 → ackTimeout → needs-resync → 恢复期 hub 新写 fan-out → 照常 apply+ACK（零 NAMESPACE_STATE_VIOLATION）→ 回 live；hub 通道镜像语义（§10.1 对称条款）恢复期入 queued、round 后 flush |
| ② bump×流量竞态终态确定 | `② bump×流量竞态终态确定` | §11.1 R3/#2 围栏判别（apply 拒绝码读 getStatus()→conflicted→§12.2 one-shot）+ 零 INTERNAL_ERROR + 零 unhandled；bump 后注入 UPDATE（hub session 已 fence）→ 恰 1 帧 IDENTITY_CHANGED（one-shot 记忆化）+ peer conflicted |
| ③ session fanout 溢出消费 | `③ session fanout 溢出消费` | §12 问题二（FANOUT 16 冻结容量；session needsResync sticky 边沿；watchdog 探测谓词第三项）；20 笔连发（单 lease 并发提交——peer 本地写为暴露面，N-2 修订后 peer 侧 watchdog 生效前提）→ RESYNC_REQUIRED 恰 1 + 同连接新 round（roundId=2）→ hub 收敛 n=19（设计定稿形态：第 20 笔落在 needs-resync 置位后的 §10.1 丢弃面，修复 round 编码于其提交之前；其数据由下一 round state-vector diff 修复，本地 n=20 保留） |
| ④ | —（跳过） | 已由 §18.11 对齐清单 #4（ACK timeout 跨连接形态）覆盖；设计侧矩阵已消解互斥 |
| ⑤ removeTarget 不可达 ×3 + closing×terminal ERROR | `⑤a targeted` / `⑤b disconnected` / `⑤c conflicted+failed` / `⑤d closing+terminal ERROR` | §13.1 状态矩阵：targeted（零拨号零帧本地收口 closed）、disconnected（零新帧收口）、终态 conflicted/failed（零 CLOSE 帧收口 closed）；⑤d 按 R3/#5d：closing 中收到 terminal namespace ERROR → 维持 closing、收敛 closed（非 failed）、零回发帧——saveGate 悬挂在途 apply 制造 closing 窗口后注入 ERROR |
| ⑥ authorize rejection | `⑥ authorize rejection` | §7 step1 R3/#6：throwing adapter → 捕获 → namespace ERROR INTERNAL_ERROR（failed）+ 零 unhandled rejection（process 探针） |
| ⑦ 序列分配点 CLOSE 插队 | `⑦ 序列分配点` | §4.1（R3/#7 钉死）：序列号只在帧**实际出队发送时**分配——saveGate 悬挂积压 ≥2（窗口满第 3 笔入 queued）→ CLOSE 插队 → 断言 peer→hub 到达序严格 +1（seq == [1..n]）且 CLOSE.sequence=5（HELLO1/OPEN2/UPDATE3/UPDATE4/CLOSE5）——预占序列的实现会交付序≠序列序 → 接收端 SEQUENCE_VIOLATION 自伤 |
| ⑧ fence × 恢复 round（R4/N-1） | `⑧a fence × 恢复 round` | §9.1.2 编码调用点 error-mapping 单点收编（encodeStateVector 同步 throw → §11.1 围栏判别 R4 扩域 (b) → §12.2 one-shot）；§7 step1 通用契约（零 unhandled rejection）。溢出恢复 r2 在途时 bump → 断言：零 uncaught、peer 恰 conflicted、IDENTITY_CHANGED 恰 1、无 INTERNAL_ERROR（两检测面谁先到均收敛同一终态——设计 §11.1 附注） |
| ⑧ 变体：OPEN(mode0) × bump | `⑧b fence × bootstrap` | §8.1 R4 扩域 (b)（fence × bootstrap 快照竞态）：importHold 冻结 peer 安装期 → bump（hub 快照身份重读已完成于 bump 前 → 快照与 OPEN_OK 声明一致 → import 成功非 BOOTSTRAP_FAILED）→ r1 Step1 编码 throw → 围栏 → one-shot → conflicted（非卡死/崩溃） |

**红灯再验证**（独立进程，`pnpm exec vitest run packages/ws-replication`，`/tmp/sa6-red-r3r4.log`，exit=1）：

```
Test Files  8 failed (8)      ← 7 套件加载失败（含新 r3-r4-regressions）+ api.test-d.ts 类型检查失败
Tests       1 failed | 8 passed (9)
Type Errors 1 failed
Errors      36 errors
EXIT=1
```

失败根因逐条核对：全部 38 处为模块解析错误（`Cannot find package/module '@nomicore/ws-replication'`（经 driver.ts/新文件）/ `'@nomicore/replication-protocol'` / `'yjs'`）——包未实现、无 package.json/node_modules 解析面；零 syntax/transform/parse 错误、零断言级错误；新文件经 driver.ts 入口与既有 6 文件同样因模块缺失红（未有测试自身缺陷引入）。SA3 建包并声明 yjs/y-protocols/lib0 与 workspace 依赖后消解（与 #135 先例一致）。

**类型干净性复核**：新增文件 + driver 探针后 `/tmp/wsstub` 契约 stub + 路径映射 `tsc -p /tmp/wsstub/tsconfig.json` → exit 0（8 个 .ts/.test-d.ts 零错误）。

**禁则核对**：新文件全部断言为 wire 帧（序列/帧数/编码码）/持久化内容（rootValue/metaValue）/状态投影（getNamespaceState/getConnectionState）/未处理 rejection 事件——零源码 grep；零 real sleep（fake scheduler + 微任务 + 门闩）；`scripts/test-lock.sh` 不存在无需维护。

### SA6 对齐记录（Phase 3，2026-08-30 · 7 条残余红灯逐条仲裁与修订）

> 背景：SA3 实现落地（commit 24642a9），`packages/ws-replication` 60/67 绿；剩余 7 条红灯 SA3 逐条举证为测试侧缺陷（实现零断言改动）。SA6 以测试所有者身份逐条对照设计 R4 定稿仲裁：**7 条全部裁定为测试缺陷并修订**（无实现缺陷退回项）；修订后独立进程复跑 67/67 全绿。

| # | 用例 | 裁决 | 原断言 → 新断言 | 覆盖等价性论证 |
|---|---|---|---|---|
| 1 | AC4 幸福路径（ac4:62） | 测试缺陷（跨方向数组索引恒等不可满足） | `kindsP.indexOf(STEP1) < kindsH.indexOf(STEP1)`（对称协议下两侧各自 index 恒 2，2<2 恒假）→ 跨方向统一发送时序：`run.timeline()`（harness Wire 新增 timeline——发送时刻逐帧记录、含被丢帧；driver Run.timeline() 按连接序拼接）中 `hub→peer STEP1 的时序位 > peer→hub STEP1 的时序位` | 「Peer Step1 先于 Hub Step1」（§9.1：round 由 Peer 隐式开始、Hub 收有效新 round 后才发自己的 Step1）语义原样保留，改以可比较的跨方向时间序表达——比原断言更强（同一时钟序下可严格断言先后）；顺带锚定「peer 的 Step1 必然已发出」（findIndex ≥ 0 守卫） |
| 2 | AC4 错序（round 前 STEP2） | 测试缺陷（注入前提未满足：peer OPEN 经 async registry.open 未发出，注入帧先到 hub 无通道 → §6 无通道统一码） | 注入前补 `await run.waitHubSent('OPEN_OK', 1)`（通道建立信号；importHold 已挂 → peer 冻结 bootstrapping）——原断言不变（SYNC_STATE_VIOLATION + hub STEP1 帧数 0 + 释放后 failed） | 注入语义（§9.2「round 建立前 STEP2」→ SYNC_STATE_VIOLATION）与错误码期望原样保留，仅把「通道已建立」前置条件显式化——原断言意图（§9.2 矩阵）正是 SYNC_STATE_VIOLATION，修正后可达 |
| 3 | AC7 degraded（peer 侧） | 测试缺陷（方向写反） | `run.hubFrames('UPDATE_ACK')`（hub→peer 方向——peer 对 hub 的 ACK 永不在此方向）→ `run.peerFrames('UPDATE_ACK')`（peer→hub） | 「ACK 照发」是可观察行为本身（AC7 冻结锚：peer degraded 下 hub→peer 内存 apply + saveDoc 登记 + ACK 照发）——方向修正后断言同一语义，无覆盖变化；SA3 实测 peerToHub 恰 1 帧 ACK 与修订一致 |
| 4 | R3 ①（5000ms 超时） | 测试缺陷（writeHub 经 hub 同一 write sequencer，await 排在 saveGate 挂起槽之后 → 死锁） | `await run.writeHub({extra:5})` → `const hubWrite = run.writeHub(...)`（仅发起，操作已入 sequencer 队）→ 释放 gate → `await hubWrite` | 语义不变且更精确：hub 新写仍产生 fan-out UPDATE，且在 peer 的 needs-resync/reconciling 恢复窗口到达/入队（§10.1 hub 镜像条款）→ §11.3 状态门收窄（恢复期照常 apply+ACK、零 NAMESPACE_STATE_VIOLATION）正是该测试的锚定对象；其余断言（live、extra 5 双侧收敛、UPDATE_ACK≥1、零 unhandled）原样 |
| 5 | R3 ③（n=19 vs 实测 n=20） | **测试缺陷（设计候选文本排布假设；实现按语义必然排布）**：设计 §5.3 丢弃安全性论证（任何被丢弃的增量都已提交本地 Y.Doc；下一 round 的 encodeDiff(对端 sv) 必然包含它）⇒ hub 收敛 n=20 是语义必然；「n=19」需「恢复 round 编码早于第 20 笔写提交」的额外排布，设计未钉死时刻表（§12 预算论证只钉 watchdog 探测窗口、§10.2 只钉溢出判据） | `expect(run.rootValue('hub','n')).toBe(19)` → `toBe(20)`；peer 本地 n=20 保留；注释记录裁决依据 | 机制语义（RESYNC×1 / roundId=2 / UPDATE<20 / needs-resync → 同连接新 round 收敛）全部原样；「无数据丢失」以最强形式表达（hub=20=全收敛，恰是 §5.3 论证的落点）；实测该语义下 20 笔写全数经 diff 收敛 |
| 6 | R3 ⑦（CLOSE 序列 5 vs 9） | 测试缺陷（注释序列清单遗漏 bootstrap round 帧占 seq 3–6） | `expect(closes[0].sequence).toBe(5)` → 动态 `toBe(run.frames().peerToHub.length)` + 注释真实序列清单（HELLO1/OPEN2/BOOTSTRAP_ACK3/STEP1 4/STEP2 5/APPLIED 6/UPDATE7/UPDATE8/CLOSE9） | 核心语义「交付序 == 序列序（到达序严格 +1）」「CLOSE 序列=帧实际出队发送时刻分配」原样保留；动态断言使测试不再依赖具体帧数排布假设（同一语义对 bootstrap 与直接 reconcile 路径均成立）；`seqs == [1..n]` 断言不变 |
| 7 | R3 ⑧a（5000ms 超时，同 4） | 测试缺陷（bumpHubEpoch 经 hub 同一 write sequencer，await 排在挂起槽之后 → 死锁） | `await run.bumpHubEpoch()` → `const bumpP = run.bumpHubEpoch()`（发起即入队）→ 释放 gate → `await bumpP` | fence × 恢复 round 语义不变；修订后队列序为 [n:1 apply(挂)→bump 槽→r2 hub-apply]，bump 槽确定性先于 r2 的 hub apply 执行 → session fence 后 r2 apply 命中围栏判别（§11.1 R4 扩域）→ one-shot——比修订前的时序撞大运更确定；断言集（IDENTITY_CHANGED 恰 1 / 恰 conflicted / 零 INTERNAL_ERROR / 零 uncaught）原样 |

**基建改动（测试侧，零语义影响）**：harness `Wire` 新增 `timeline`（跨方向统一发送时序，逐帧记录含被丢帧——drop 判定前记录）；driver `Run.timeline()` 按连接序拼接（重连聚合）。

**绿灯再验证**（独立进程，`pnpm exec vitest run packages/ws-replication`，/tmp/sa6-phase3-r2.log 与复跑 /tmp/sa6-phase3-r3.log，均 exit=0）：

```
Test Files  8 passed (8)
Tests       67 passed (67)
Type Errors no errors
EXIT=0
```

（修订前基线 /tmp/sa6-phase3-run.log：8 文件 3 失败 5 通过、67 测试 7 失败 60 通过——7 条失败与上述仲裁逐条对应。）

**类型干净性**：修订后 /tmp/wsstub 契约 stub + 路径映射 `tsc -p /tmp/wsstub/tsconfig.json` → exit 0。**范围说明**：SA6 只跑 `packages/ws-replication` 包范围；全仓 `pnpm test` 零回归确认由总控亲跑（简报另述）。

### SA6 回流红灯记录（SA4 F1/F2/F3，2026-08-30）

> 背景：SA4 静态验尸 verdict: reject（`wiki/raw/task_phase5-ws-namespace-sync_sa4_review.md`，F1/F2/F3 三条 REJECT 依据）。SA6 以测试所有者身份落地三条新红灯（实现未修、预期红）+ F3 配套 seam 修复 + ⑤d 无撞号形态修订（保持 R3/#5d 语义）。

### 新增红灯（`packages/ws-replication/test/ws-replication-sa4-f1-f2-f3-red.test.ts`，3 it）

| IT | 设计依据 | 红锚（现实现实测失败 = SA4 执行证据一致） | 转绿条件（SA3 修复） |
|---|---|---|---|
| F1 hub 侧溢出 → RESYNC_REQUIRED → 同连接恢复 round → 双向收敛 | §10.2 溢出动作表「发 RESYNC_REQUIRED{reasonCode:'send-queue-overflow'}（本端声明）」；§18.4「hub 溢出同机制（协议 §9.4 任一端可声明）」；协议 §9.4（round 恒由 peer 发起——hub 声明是唯一通路）。构造：`maxInFlightUpdates:1, maxQueuedUpdateCount:1` + 悬挂 peer saveDoc（hub→peer 首笔 UPDATE 在途 ACK 不回 → hub in-flight 不收口）→ hub 连写 extra:5/n:6 → 第二笔触发 channel 溢出 | `expected [] to have a length of 1 but got +0`（hubFrames('RESYNC_REQUIRED')=0；= SA4 R-D 证据）| hub 两处溢出路径补发 RESYNC_REQUIRED → peer §10.6 路径收敛 → 本 IT 断言（reasonCode/roundId=2/n:6/extra:5 双侧收敛）全绿 |
| F2 重连后 open 超时兜底 | §5.1「opening → armed openTimeoutMs」；§16 timer 清单；§9.3——均**无条件武装、无 everBeenLive 豁免**。构造：live → closePeerSide(1006) → backoff（0.5×50=25ms）重连（第二次 authorize 悬挂——hub 永不回 OPEN_OK）→ waitNamespace('opening') → `advanceMs(openTimeoutMs=200)` | `settleUntil 预算耗尽：namespace 状态 ∈ [failed]，当前 opening`（= SA4 R-C 证据：10× 超时时长仍 opening）| 删 everBeenLive 豁免、按 §16 无条件武装 → advanceMs 后收口 failed（§13.3 重连规则接管） |
| F3 closing 窗口重复序列帧 → SEQUENCE_VIOLATION fatal → blocked | §4.1/§18.8（ADR 0010 L147 字面）：入站 sequence ≠ 期望——**无论 gap、repeat 或回退——一律 SEQUENCE_VIOLATION connection fatal**；§18.11 前言「不得为迁就现行断言偏离 ADR」。构造：⑤d 同款 closing 窗口（saveGate 悬挂、CLOSE_OK 不回）→ 显式 `injectHub(ERROR, { sequence: 1 })`（HELLO_ACK 已占用的回退序列——断言序列纪律无 closing 豁免）| `settleUntil 预算耗尽：connection 状态 = blocked，当前 ready`（= SA4 R-A 证据：closing 窗口宽赦放行）| 删除 anyNamespaceClosing 宽赦分支（回归 §4.1 字面：fatal → blocked + ns disconnected） |

### F3 配套 seam 修复（测试侧；既有断言语义零改动）

- `driver.injectPeer/injectHub` 增加可选 `{ sequence?: number }`（默认仍为「接收端期望 = 已见最大 +1」）并文档化**静默期不变量**：注入必须发生在「发送方不再产生真实帧」的窗口——否则真实帧与注入帧同序列撞号（接收端按序列纪律判 SEQUENCE_VIOLATION，非确定性）；确需注入错序/重复帧（F3 红灯）时显式传 sequence。
- **⑤d 无撞号形态修订**（`ws-replication-r3-r4-regressions.test.ts`）：原形态（saveGate 悬挂 → 注入 → 释放 → CLOSE_OK 序列与注入帧撞号——现被实现宽赦掩盖，SA3 修 F3 后必然假红）改为：saveGate **保持悬挂**（CLOSE_OK 永不发出 → hub 方向完全静默）→ 注入合法序列 ERROR → 断言不降级 failed + 零回发帧 → `advanceMs(closeTimeoutMs=200)` 按 §13.1「fire → 不再等待，本地收口 closed」→ closed + CLOSE_OK 帧数 0 + 已接纳 apply 不丢。**覆盖等价性**：R3/#5d 语义（closing 期迟到的 terminal ERROR 只推进收口、收敛 closed 非 failed、零回发帧）原样保留；注入序列合法性与 CP-1 序列纪律兼容（消除与真实出站帧的撞号面）。

### 红绿证据（独立进程，`pnpm exec vitest run packages/ws-replication`，/tmp/sa6-f1f2f3-run.log，exit=1）

```
Test Files  1 failed | 8 passed (9)    ← 新文件 3 it 全红；既有 8 文件（67 IT）全绿
Tests       3 failed | 67 passed (70)
Type Errors no errors
EXIT=1（预期——F1/F2/F3 实现未修）
```

红锚逐条与 SA4 执行证据一致：F1 = R-D（RESYNC 0 帧）、F2 = R-C（100× 超时时长仍 opening——本 IT 用 1× openTimeoutMs 等效收口断言）、F3 = R-A（closing 期重复序列被宽赦 → 恒 ready）。既有 67 IT 零回归（含修订后的 ⑤d 与 R3 ①/⑧a 等触发面）。

**类型干净性**：修订 + 新增后 /tmp/wsstub 契约 stub 路径映射 `tsc -p /tmp/wsstub/tsconfig.json` → exit 0。**范围**：仅 `packages/ws-replication/test/`（新增 1 文件、修订 driver/r3-r4-regressions）与简报；未触碰生产代码（SA3 随后对 F1/F2/F3 实现）。

### SA6 对齐记录（SA3 R2 修复后残余红灯，2026-08-30 · AC7 degraded hub 推进形态）

> 背景：SA3 R2 修复（commit ade002c）收口 SA4 F1–F7，69/70 绿。唯一余红：AC7 degraded（hub 侧）恢复段 `advanceMs(run, 25_000)`——F2 定案收回 everBeenLive 豁免后 openTimeoutMs(5s)/reconcileTimeoutMs(10s) 无条件武装，fake scheduler `advanceBy` 每 timer 仅 3 次微任务让步、重连链（OPEN→registry→OPEN_OK→round ≈15–20 微任务）无法在 timer 间隙完成 → open@5s 准时触发收口 failed。SA4 F2 注记自身指引：「正确做法是调整 timer 值或测试推进量，不是删兜底」。SA3 已实证等价通过形态。

| 文件/用例 | 原形态 | 新形态 | 覆盖等价性论证 |
|---|---|---|---|
| `ws-replication-ac7-faults.test.ts` · degraded（hub 侧）恢复段 | `advanceMs(run, 25_000)`（覆盖默认 backoff 首拨上界——大步推进误触 F2 后无条件武装的 open@5s/reconcile@10s） | `advanceMs(run, 200)`（**backoff 首拨段推进**：默认 base=100、attempt=1 → `cap=min(30_000, 100·2⁰)=100ms`、delay<cap，200ms 覆盖且远小于 open@5s——不推进任何 namespace timer）→ `waitConnection('ready')` → `waitNamespace('live')`（重连链余下步骤经 settleUntil 微任务轮询收口，3000 步预算覆盖 ≈15–20 微任务） | AC7 冻结语义逐项不变：PERSISTENCE_DEGRADED 拒绝（ERROR 码 / 零 UPDATE_ACK / hub root n=42 不动 / 零 saveDoc）→ 恢复 + 重连 → reconciliation 补齐（live + hub n=1）。唯一变化是「时间推进量」而非「被测行为」——backoff 仍是首拨时序驱动（advanceMs 200 只触发拨号 timer），重连链与恢复 round 全部在零时间开销的微任务域完成（fake scheduler 下 timer 仅经 advanceBy 触发——不推进即不 fire，open/reconcile 兜底结构性不参与本用例，恰是「不删兜底、只调整推进量」的 F2 注记本义）。断言集（10 条）零改动。 |

**验证**（独立进程，两轮复跑）：`pnpm exec vitest run packages/ws-replication` → **Test Files 9 passed (9) / Tests 70 passed (70) / Type Errors no errors / exit 0**（/tmp/sa6-70-run1.log、/tmp/sa6-70-run2.log 一致）。类型干净性：/tmp/wsstub 契约 stub tsc → exit 0。范围：仅该用例推进形态一行修改（+注释）与简报。

### SA6 回流红灯记录（双轴终审 B-1/B-2/G-1，2026-08-30）

> 背景：Spec review verdict: has-blocking-findings（`wiki/raw/task_phase5-ws-namespace-sync_spec_review.md` §5 B-1/B-2 簇）；Standards review G-1（=Spec G-1：r3-r4-regressions.test.ts 文件末多余空行致 `git diff --check` exit 2）。

### G-1（一行修复）
`ws-replication-r3-r4-regressions.test.ts` 文件末 `});\n\n` → `});\n`。验证：`git diff --check`（工作区+缓存区）exit 0。

### 新增红灯（`packages/ws-replication/test/ws-replication-spec-b1-b2-red.test.ts`，5 it，全部实测红）

| IT | 设计依据 | 构造（确定性门闩/时序） | 红锚（现实现实测 = Spec 报告证据） | 转绿条件（SA3 修复） |
|---|---|---|---|---|
| B-1 removeTarget×reconcile 竞态 | §5.1（closing 唯一出口 CLOSE_OK/closeTimeout→closed）+ §13.4（终态不复活、零状态机迁移） | reconcile 模式 + **peer saveGate**（本端 Step2 apply 在途）→ hub 的 SYNC_APPLIED 已收（waitHubSent）→ removeTarget（closing）→ **dropNextHubFrame('CLOSE_OK')**（收口只走 closeTimeout 路径——消除 CLOSE_OK 先到的随机序；drop 后 hub 无后续帧、零 gap）→ 释放 gate（apply 迟结算 → checkSettled 双位齐 → onRoundSettled）→ advanceMs(closeTimeout) → 断言 closed；re-add 断言拨号数增加 | `settleUntil 超时：状态 ∈ [closed]，当前 live`（= Spec B-1「投影谎报 live、close timer 仅认 closing → no-op」） | onRoundSettled 加状态守卫（仅 reconciling 进 live）→ 无复活 → closeTimer 收口 closed → re-add 重建 → live |
| B-2b 导入迟到遇 disconnected | §13.4「连接已断」半句 + §8 L361 | bootstrap + **importHold** → 断线（cleanup 快、投影 disconnected）→ 释放 import → backoff 重连 ready → 断言重连 OPEN 帧数 2（重开 reconcile——副本已导入）→ live | `OPEN_NAMESPACE 期望 2，实际 1`（= Spec B-2b：续体假迁 reconciling → openActiveTargets 跳过 → 重连零 OPEN） | 续体守卫扩至 'disconnected'（零状态机迁移）→ 重连按 §13.3 重开（reconcile → live） |
| B-2c startOpen 迟到续体 | §13.4 + §5.2 | **peer loadGate**（首轮 startOpen 的 registry.open/loadDoc 在途）→ ready 后断线 → backoff 重连 ready（重连 startOpen 的 open #2 与 #1 同走 registry carrier）→ 释放 loadGate → 断言 OPEN 帧数 1（迟到续体零 wire、仅收敛路径一帧）→ live | `OPEN_NAMESPACE 期望 1，实际 0`（= Spec B-2c 同簇：OPEN 决策链迟滞/零收敛——恒 opening；均违反「零 wire + 收敛」） | 续体守卫扩至 'disconnected'（与当前连接不符 → 零 wire、旧 lease 回收）→ 单 OPEN → live |
| B-2d（最重）在途 apply 跨重连 | §13.4 + §13.3 + AC6「socket loss → 重连修复」承诺 | live + **peer saveGate**（hub→peer UPDATE apply 在途）→ writeHub({n:1}) → 断线（现实现 cleanup 卡 session.close 屏障 → 投影滞留 live）→ backoff 重连 ready → 断言重连 OPEN 帧数 2 → 释放 gate（旧 ACK 续体）→ 断言收敛 live + hub/peer n=1 | `OPEN_NAMESPACE 期望 2，实际 1`（= Spec B-2d：openActiveTargets 跳过滞留 'live' → 新连接不重 OPEN → 旧 ACK 落新连接 → hub 违例 → failed；本 IT 另锚 live 收敛） | 断开即投影 disconnected（cleanup 不滞留）+ 重连按 §13.3 重开 → 旧 ACK 不落新连接 → reconcile → live + n=1 |
| B-2e rebuild 不投影 disconnected | §4.3 L228（重建期间所有 namespace 投影 disconnected 字面） | 双 namespace 自建装配（per `peer.getNamespaceState`）→ A、B 均 live → A removeTarget（closed）→ re-add A（§14.1 整连接重建）→ 断言新连接 OPEN 帧数 4（A 重建 + **B 重开**）→ B 后续本地写（bus lease）不断连无通道 | `OPEN_NAMESPACE 期望 4，实际 3`（= Spec B-2e：requestRebuild 不通知 namespace → 兄弟 B 恒 'live' 残留投影、新连接不重 OPEN） | requestRebuild 通知全部 namespace 投影 disconnected → B 亦重 OPEN → 写经通道正常 → live |

**B-2a（导入终态不回收 lease）未单独锚定——理由**：lease 泄漏无公共观测面（Registry 无 lease 列表/计数 API；泄漏的 lease 不改变重连行为——Registry open 复用 entry）——无法以行为断言确定性观测；其修复由实现侧顺手完成（`importResult.lease` 终态分支 release），SA7 动态/静态闭项（简报记录，N-12 同述）。

**基建改动（测试 seam，零既有断言语义影响）**：`StubPersistence` 新增 `loadGate`（单次门闩：下一次 `loadDoc` 挂起——B-2c 的 registry.open 在途锚；缺省 undefined → 既有测试零影响）。

### 红绿证据（独立进程，`pnpm exec vitest run packages/ws-replication`，/tmp/sa6-spec-b12-final.log，exit=1）

```
Test Files  1 failed | 10 passed (11)   ← 新文件 5 it 全红；既有 10 文件（74 IT）全绿
Tests       5 failed | 74 passed (79)
Type Errors no errors
EXIT=1（预期——B-1/B-2 实现未修）
```

红锚逐条与 Spec 报告证据对应（B-1 复活 live / B-2b 重连零 OPEN / B-2c OPEN 决策链迟滞 / B-2d 滞留不重 OPEN / B-2e 兄弟 ns 零重 OPEN）。既有 74 IT 零回归；`git diff --check`（工作区+缓存区）exit 0（G-1）；类型干净性：/tmp/wsstub 契约 stub 路径映射 tsc → exit 0。范围：仅 `packages/ws-replication/test/`（新增 1 文件、harness loadGate 一行门闩、r3-r4 EOF 一行）与简报；未触碰生产代码（SA3 随后对 B-1/B-2 实现）。
