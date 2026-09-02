# Issue #171 设计 — 命名空间生命周期跨连接代际竞态收口（SA1 防弹设计）

> **R1 修订（2026-08-30）**：按 SA2 攻击评审 `task_issue-171_sa2_review.md`（verdict: reject；2 CRITICAL + 2 MAJOR + 4 MINOR）逐条落实，设计骨架（§D1–§D9 结构、红灯锚对位、兼容面盘点）保留：
> - **#1（CRITICAL）**：`cleanupResources()` 的 claim 捕获改为**排队前在 caller 同步栈求值**（原稿 lambda 内求值 = 任务执行期捕获，可达成 P3 同款杀新代）；§4.2 表与代码对齐；`onConnectionFatal` closing 分支的补排队裁决为「有意保底」并写明安全前提（R1-§8.1）。
> - **#2（CRITICAL）**：**删除** `onCloseOk` 的 `closeSequence===undefined` 接受例外——hub 发起 CLOSE 不产生「发给 peer 的 CLOSE_OK」，该窗口入站 CLOSE_OK 按定义 unmatched → 一律 `ACK_STATE_VIOLATION` fatal；§15#6 依据重写，§D4/§D7 矛盾注释消除。
> - **#3（MAJOR）**：`runDisposal` 的 epoch 守卫改为**身份守卫**（`this.session === claim.session`）——覆盖「epoch 已推进但新代永不 open（intent removed/终态）」的 watchdog/channel 永久泄漏面（AC2）；`CleanupClaim` 删除 epoch 字段（epoch 判别仅保留于 §D2 续体的 wire 门）。
> - **#4（MAJOR）**：GOAWAY 静默分**轻量（收帧段）/全量（deadline 回调）两层**——轻量层零处置排队，处置时点与现状完全一致 → `sa7-issue137 D5` 四检查点 timer 账目逐值不变（§13.2 重推）。
> - **#5–#8（MINOR）**：startOpen 取得后失败分支补 `isOpenAborted()` 先行判别；waiter 丢弃裁决 (a)（静默 + openTimeout 兜底，登记 §13.3）；`enqueueLifecycle` 吞错纪律（任务体结构性零 throw + `void` 调用点显式 `.catch`）；SYNC_APPLIED 非对称消除（决策 (a)：peer 维持既有 epoch 门照发、hub 补 `isQuietState` 门）。
> 修订明细与逐条落实位置见文末「SA2 反馈逐条回应（R1）」。
>
> **R1.1 修订（2026-08-30，SA4 复审 F1 回流批）**：按 `task_issue-171_sa4_review.md`（verdict: reject，阻断项 F1）修订：
> - **F1（CRITICAL）**：`removeTarget` 的 `case 'targeted'/'disconnected'` 本地收口分支补 `void this.cleanupResources().catch(() => undefined)`（§D3 伪代码与 §4.2 表同步）——GOAWAY drain 窗口（轻量层 `onConnectionQuiesce` 投影 `disconnected` 且零处置排队）内 removeTarget 否则落入「无处置」分支，deadline 全量层 `onConnectionFatal` 以 `isTerminal()`（closed）早退 → session/lease/watchdog 泄漏（AC2 违例、对 `ef19bae` 基线回归；SA2 R2 新攻击扫描漏检「drain 窗口内 removeTarget」交叉）。终态早退门**保持不拆**。
> - **R2-N1（SA2 非阻塞注记）**：总则 1/3 措辞对齐 §4.1 身份守卫语义（claim 无 epoch；字段/aux 处置以「自捕获以来未建立新 session」为准，含有意跨代清字段 + teardown 面）；条款编号不变，机制零改动。

- 任务类型：Bug 修复（bugfix）
- Worktree：`/home/wangjian/nomicore-fix-issue-171`（branch `fix/issue-171-on-docs-phase-5-websocket-replication`，baseline `docs/phase-5-websocket-replication`）
- 红灯契约：`packages/ws-replication/test/ws-replication-issue171-red.test.ts`（SA6 冻结，H1/P3/C4/G5 四锚，实测 4 failed / 0 假红——见 §2.4）
- 前置决议：`task_issue-171_relevant_decisions.md`（ADR-0010 含 #161 修订节「代际安全脱离」「同步静默订阅先于异步 drain」；ADR-0009 L32 generation 纪律 / L42 幂等 same-promise release；ADR-0008 L93/#134 修订节「已接纳槽无条件排空」）；冲突门禁 verdict `clear`（8 项 no-conflict，三点边界注记全文遵守）

---

## §0. 阅读链与设计期实测

阅读链（全读）：`task_issue-171.md` → `task_issue-171_relevant_decisions.md` → `task_issue-171_conflict_report.md` → SA5 分析 `20260830-bug-issue-171.md`（RC1–RC7 + E1–E8）→ `packages/ws-replication/src/{hub-namespace,peer-namespace,peer-connection,hub-connection,lifecycle-queue,update-channel,round-engine,fence-watchdog,backpressure}.ts` 全文 → `docs/protocols/instance-replication-v1.md` 全文（§5/§6.3/§7/§12/§13/§15/§16/§17/§18）→ 红灯测试 + `test/{driver,harness}.ts` 全文 → 既有绿灯锚兼容面（ac1–ac7、r3-r4-regressions、sa4-f1-f2-f3、sa4-r4-1、spec-b1-b2、sa6-hardening-g1-g2/g3-g4、sa7-dynamic、sa7-hardening-dynamic、sa7-round2-dynamic、sa7-issue137-dynamic 的相关 IT 逐个核对）。

### §0.1 设计期实测记录（SA1，2026-08-30，worktree 根）

1. **红灯复跑**：`pnpm exec vitest run packages/ws-replication/test/ws-replication-issue171-red.test.ts`
   → `4 tests | 4 failed`（H1 `expected [] to have a length of 1 but got +0`；P3 `expected 'closed' to be 'live'`；C4 `expected false to be true`；G5 `expected [Function] to be undefined`）——与 SA6 记录逐字一致，无构造性假红。
2. **H1 机制探针**（/tmp 副本 + 探针测试，零 worktree 改动；探针 = bootObserved 复刻 + registry observer 全事件 trace + authorize 门闩 trace）：
   - `closeHubSide(1001)` 后 `settleUntil(channelState==='closed')` 通过（gen1 通道确实到达终局 `closed`，hub 连接随后 drop）；
   - `releaseAuthorize()` 后 observer **零事件**、`authorizeCalls=1`、`conns=0`。
   - 结合 `hub-namespace.ts:239`（authorize 恢复点 guard：`isTerminal()` 命中 `closed` → `finishOpenSilently()` → return，**registry.open 从未被调用**）——**修正 SA5/SA6 静态模型**：在 H1 的精确时序下（settleUntil 先等通道终局再放门闩），泄漏窗口不是「registry.open 已交付后丢弃」，而是「authorize 恢复点 guard 在取得任何资源之前就把续体拦死」。当前实现零 lease 取得、零事件，锚 1 以 0 红灯。
   - **设计含义（→§D8 决策 D-H1）**：红灯契约锚 1 要求「续体恢复后必有 `lease-released` 事件」——即修复后 authorize 恢复点**必须放行 registry.open**（先取得、再于下一恢复点中止并显式回收）。中止判别保护的是**资源账目**（acquire→release 配对），不是调用点。
3. **registry observer 事件面**：`packages/namespace-registry/src/observer.ts:27` —— observer 只定义 `lease-released`（无 lease-issued）；`lease.ts:213` 在 release 路径发事件。观测面成立。

---

## §1. 术语与判定基准（全程遵守冲突门禁三点注记）

- **connection generation（连接代际）**：ws-replication 层清理所有权标识。peer 侧实体 = `host.connectionEpoch()`（每次 `dialNow` +1，peer-connection.ts:193）；hub 侧 per-(connection, namespace) 通道**不跨连接存活**，代际问题只存在于「同一通道内 open 续体 vs 收口链」——用**通道静默态**（`closing`/终态）判定，无需引入 hub 连接计数器（§D8 论证）。**不是** CONTEXT「复制代际（replication epoch）」——零词汇混用。
- **释放恰一次**：落在 ADR-0009 L42 / ADR-0010 #134 修订节 L246 的幂等 same-promise 机制上（重复调用返回同一结算）。本设计的「恰一次」= 语义恰一次（幂等兑付），不发明新释放语义。
- **已接纳槽不可取消**：所有清理路径只作用于连接域资源（listener/session/lease/watchdog/round 簿记/ACK timer/channel 簿记）；`drainPendingApplies` 与 `session.close()` barrier 保持「已接纳 apply 无条件排空」。任何「中止迟到续体」不得外溢为取消已接纳任务。
- **释放次序**：先关 session、再释放 lease（ADR-0010 L90；本设计 `runDisposal` 严格保持）。
- wire 契约唯一权威：`docs/protocols/instance-replication-v1.md`。本设计**零新增错误码、零 payload 变更**（`ACK_STATE_VIOLATION`/`NAMESPACE_STATE_VIOLATION` 均为既有 registry 码，§13.1/L351）。

---

## §2. 根因推演（对 SA5 RC1–RC7 的复核 + 两处修正）

| RC | Scope/AC | 根因定位（现状代码） | SA1 复核结论 |
|---|---|---|---|
| RC1 | 1 / AC1 | hub `startOpen`（hub-namespace.ts:231-340）全部恢复点守卫仅 `isTerminal()`（L239/254/278/316）；`quiesceConnection()`（L574-581）只置 `closing`（非终态）→ 续体在 `closing` 下继续赋 lease/session、`flushOpenWaitersOk()`（L333/355-362）补发 `OPEN_OK`、`startBootstrap`（L389）自 `closing` 倒退 `bootstrapping` + 补发 `BOOTSTRAP_SNAPSHOT`（L426）。open 续体不挂接 `closeQueue`，零串行化 | 成立。**修正**：E2 泄漏变体在「续体恢复晚于收口链完成」时不可达（guard 在 authorize 恢复点即拦死，registry.open 不运行——§0.1 探针）；在「恢复早于收口链完成」（state 尚 `closing`）时 E1 复活变体成立。两变体同修：`closing`/终态同列为中止 + 各取得点显式回收（§D8） |
| RC2 | 2 / AC1+AC2 | peer `closeSessionAndRelease`（peer-namespace.ts:957-986）**入口才捕获** session/lease/unsubscribe，且 L961 无条件 `quiesceSync()` 退订**当前**字段；`cleanupResources`（L988-995）排入 `cleanupTail` 后执行体滞后进入 → 旧代 cleanup 在新代建成后进入时捕获到 gen2 资源，L965 判等恒真 → 摘新 listener/teardown 新代 round/channel/watchdog/close session2/release lease2；`onCloseRequest` IIFE（L499-509）与 `ensureCloseMemo` body（L595-599）同款后置捕获窗口，且 L502-506 迟到 `CLOSE_OK` 可落新连接 | 成立（P3 实测红）。修法：**排队前捕获所有权 + 执行期只处置捕获对象**（处置正确性由身份守卫承担，R1 #1/#3）+ **续体局部 epoch 门**守卫 wire/状态机副作用（§D1/§D2） |
| RC3 | 3 / AC2 | `onConnectionLost`（L621-637）：closing 分支不清任何 timer；failed 分支零动作；活跃分支不清 open/bootstrap/reconcile timer → 断线停留 `disconnected` 期间旧 timer 触发 `onTimerFired`（L1029-1042）非 close 路径 `finalize('failed')`（连接丢失被污染为 ns 终局失败）；`removeTarget` 自 `bootstrapping`/`reconciling` 入 `closing` 时残留 timer 未清（L553-565 只 arm 'close'）；watchdog/round/channel/ACK-timer teardown 全部推迟且挂在错代载体上 | 成立。修法：全分支 `clearAllTimers()` 同步段 + 处置排队（§D5）；watchdog 复活门补漏（§D5.3） |
| RC4 | 4 / AC3 | `removeTarget`（L560-565）不校验 `sendChecked` 返回序；`peer-connection.sendControl`（L461-469）在 `connState!=='ready'`/出站未就绪时静默返回 0 → `closeSequence=0` 永无匹配 → 挂满 `closeTimeoutMs` | 成立。修法：seq>0 才武装等待，否则本地收口立即结算（§D3） |
| RC5 | 5 / AC4 | `onCloseOk`（L512-520）仅 `state==='closing' && ackedSequence===closeSequence` 收口，错配/伪造/未请求帧静默忽略——与库内既有 ACK 关联权威策略（hub `onBootstrapAck` 错配 → `connectionFatal('ACK_STATE_VIOLATION',1002)`，hub-namespace.ts:450-456；`onUpdateAck` violation 同款；ADR-0010 L147「错误ACK关联关闭连接」）不一致 | 成立（C4 实测红）。修法：按权威策略显式收口（§D4）；**R1 修订**：初稿的「hub 发起 CLOSE 的 `closeSequence===undefined` 接受例外」经 SA2 #2 证伪删除——CLOSE_OK 的发送方恒为 CLOSE_NAMESPACE 的接收方（协议 §5 L104 Result 语义），peer 唯一 CLOSE_NAMESPACE 发送点是 `removeTarget`，hub 发起 CLOSE 不产生发给 peer 的 CLOSE_OK，该窗口入站 CLOSE_OK 按定义 unmatched → 同款 fatal |
| RC6 | 6 / AC5 | `onGoaway`（peer-connection.ts:398-412）`SERVER_RESTARTING` 分支把 `quiesceControllers()` 整体放进 `drainTimeoutMs` 定时器回调 → 收帧至 deadline 窗口内控制器状态不变、`maybeStartRecovery`/`sendFacet` 照常发数据，违反协议 §6.3（L149）与 #161 修订节「同步静默订阅先于异步 drain」；`isGoawayDraining` seam（peer-namespace.ts:52 / peer-connection.ts:94）零消费 | 成立（G5 实测红）。修法：轻量静默移至收帧同步段（摘订阅/投影，R1 #4 两层）、处置留 deadline 全量、deadline 只关 transport（§D6）；死 seam 移除（§D9） |
| RC7 | 7 / — | 生命周期权威分裂：hub 内联 `closeQueue`（hub-namespace.ts:93/542）+ **死字段** `cleanupTail`（L92 声明后零引用——SA1 grep 复核确认）；peer `Memoized`+`cleanupTail`+`closeSettleResolve` gate+`onCloseRequest` 独立 IIFE 多机制交错；`LifecycleQueue` 类已删除 | 成立（含 SA1 增补：hub `cleanupTail` 为死字段）。裁决见 §D9 |

### §2.4 红灯锚 × 根因 × 修复条款对照

| 锚 | 缺陷症状（实测） | 根因 | 修复条款 | 绿灯判据 |
|---|---|---|---|---|
| H1-① | 续体恢复后 `lease-released` 事件 = 0 | RC1（authorize 恢复点拦死→零取得；修复语义须放行取得+回收） | §D8 D-H1 + `finishOpenSilently(pendingLease?)` | 恰 1 事件（registry.open 交付的 lease 显式 release） |
| H1-② | `peer.stop()` 后 `remainingLeases=2`（SA6 预测；当前实现在锚①即中断未及此锚） | 同上（泄漏 lease 使 registry 永远多持 1） | 同上 | 最终 remaining=1（仅 fixture lease） |
| P3-①② | 旧代收口续体把 gen2 打到 `closed`、摘 gen2 listener | RC2 入口捕获错代 | §D1+§D2（claim 排队前捕获 + 身份守卫（R1）） | gen2 保持 `live`、订阅仍在 |
| P3-③ | 迟到 `CLOSE_OK` 落新连接→hub gen2 通道 `failed` | RC2（IIFE 无代际门的 sendChecked） | §D2（续体局部 epoch 门 → 跨代零 wire） | hub gen2 通道 `live` |
| P3-④ | gen2 live 下 peer 写零收敛 | RC2（listener 被摘/session 被关） | §D1+§D2+§D5.2（新代 open 路径重置 aux） | `writePeer({n:101})` 收敛到 hub |
| C4-①②③ | 错配 `CLOSE_OK` 零 ERROR、滞留 ready、不关传输 | RC5 | §D4（`connectionFatal('ACK_STATE_VIOLATION',1002)`） | ERROR 帧 + `blocked` + transport 关 |
| C4-④ | `removeTarget` 承诺无界悬挂 | RC5（无结算点） | §D4（violation 收口 settle closeMemo） | 微任务预算内结算 |
| G5-①② | 收帧后订阅仍在、UPDATE 照发 | RC6 | §D6（同步静默移至收帧段） | 订阅 undefined + 零 UPDATE 出站 + hub 不收新提交 |
| G5-③ | deadline 到期 transport 未关（companion） | — | §D6（deadline 只管 transport close，保持既有） | `peerEnd.closed` + 连接保持 `ready` |

---

## §3. 设计总则

1. **资源账目制（ownership claim）**：任何异步续体在**发起/排队时**（caller 同步栈）捕获其资源所有权 `{session, lease, unsubscribe}`（**无 epoch 字段**——代际判别由执行期的**身份守卫**承担，见 §4.1 `runDisposal`）；执行期只处置捕获对象；中止/迟到时对**捕获的**（而非字段回读的）资源显式回收。字段清空与 aux teardown 以身份守卫（`this.session === claim.session`）判定：自捕获以来**未建立新 session** ⇒ 照常清字段 + `watchdog/round/channel.teardown()`（无论连接代际是否推进——AC2 零泄漏兑付）；**已建立新 session** ⇒ 零字段/aux 触碰（新代资源归新代生命周期，见总则 3 与 §D5.2）。
2. **中止判别保护资源账目，不保护调用点**（D-H1）：中止检查位于每个**取得之后**的恢复点；authorize→registry.open 段无资源可保护，取得完成再判别回收。与 peer 侧 B-2c（peer-namespace.ts:191-195：registry.open 已返回、迟到判别后 `releaseLeaseOrNoop(result.lease)`）语义对称——peer 的 abort 点同样在取得之后。
3. **跨代零副作用（以身份守卫为准）**：epoch 已推进的续体 = 迟到 → 只回收自己捕获的资源、**零 wire 帧、零状态机迁移**；当前字段与 aux 簿记（round/channel/watchdog）的处置权归**身份守卫**——无新 session 建立（intent='removed'/终态/新代未重开）⇒ **有意**跨代清字段 + aux teardown（§4.1；不执行则泄漏面=新代永不 open 时 watchdog 永久自重武装 / channel 队列残留——AC2）；新 session 已建立（P3 stuck-disposal）⇒ 零字段/aux 触碰，残留清理由新代 open 路径自重置（§D5.2）。
4. **单一生命周期权威（peer）**：`cleanupTail` 队列（经新原语 `enqueueLifecycle`）串行化 peer 全部生命周期续体（hub-CLOSE 收口、removeTarget 处置、loss/fatal/stop 处置）；关闭承诺结算 = 既有事件驱动 settle-gate（R3 纪律，零轮询环保留）。
5. **同步静默先于异步 drain**（#161 修订节既有决策）：GOAWAY/blocked/收口的**同步段**完成停新数据接受（摘订阅、停 timer、停 round 推进、投影），异步段只做 barrier 排空与 transport 关闭。
6. **已接纳槽无条件排空**：`drainPendingApplies()` 与 `session.close()` barrier 语义保持；处置链不取消任何已接纳 apply。
7. **零静默降级（loud assert 纪律）**：本任务所有「异常路径」都是协议/竞态异常（伪造帧、迟到续体、连接死亡）——处置是**显式收口**（ERROR 帧/connectionFatal/终局投影），不是吞掉。唯一「合法降级」是迟到帧在静默域内的**协议规定忽略**（§13.4 迟到纪律），且有状态门显式编码。

---

## §4. §D1 — peer 代际所有权捕获与统一生命周期队列（Scope 2/7 核心）

### §4.1 新类型与新原语（peer-namespace.ts）

```ts
/** 排队时捕获的代际资源所有权（Scope 2）：执行期只处置捕获对象。
 *  R1（#3）：不含 epoch——代际判别由「身份守卫」承担（见 runDisposal）；
 *  epoch 比对仅保留于 §D2 收口续体的 wire 副作用门（独立局部变量）。 */
interface CleanupClaim {
  readonly session: ReplicationSession | undefined;
  readonly lease: NamespaceLease | undefined;
  readonly unsubscribe: (() => void) | undefined;
}

/** 单一生命周期队列原语（Scope 7）：peer 全部生命周期续体经此串行化。
 *  R1（#7）吞错纪律：任务体结构性零 throw（runDisposal 各步骤局部吞错）；
 *  返回值 run 按原语义 reject 传播给显式 await 的调用方（ensureCloseMemo body）；
 *  fire-and-forget 调用点一律显式 .catch(() => undefined)（§16 caller 表注记）。 */
private enqueueLifecycle(task: () => Promise<void>): Promise<void> {
  const run = this.cleanupTail.then(task);
  this.cleanupTail = run.then(() => undefined, () => undefined);
  return run;
}

/** 捕获当前代资源所有权（在 caller 同步栈内求值——绝不放进任务 lambda）。 */
private claimForDisposal(): CleanupClaim {
  return { session: this.session, lease: this.lease, unsubscribe: this.unsubscribe };
}

/** 处置捕获的资源（§12 次序：退捕获句柄 → session.close 屏障 → lease.release）。
 *  R1（#3）身份守卫：自捕获以来未建立新 session（this.session === claim.session）
 *  ⇒ aux 簿记（watchdog/round/channel）仍归本代，**与连接代际无关**——同时正确覆盖：
 *   - P3（新代已建成 session2 → 不等 → 跳过：新代资源/aux 零触碰）；
 *   - 泄漏面（epoch 已推进但新代永不 open——intent='removed' ∨ 终态：openActiveTargets
 *     跳过（peer-connection.ts:447-448）、§D5.2 重置永不发生 ⇒ this.session 保持捕获值
 *     → 照常清字段 + aux teardown，watchdog idle timer（fence-watchdog.ts:56-66 自我
 *     重武装）/channel 队列/round 簿记不泄漏——AC2 明文兑付）。
 *  session 对象一经释放不复用（Registry 语义），「先不等后复等」不可达，判据健全。 */
private async runDisposal(claim: CleanupClaim): Promise<void> {
  const { session, lease, unsubscribe } = claim;
  if (unsubscribe !== undefined) {
    try { unsubscribe(); } catch { /* seam 防御（R1 #7）：退订回调不得使任务体 throw */ }
  }
  if (session !== undefined) await session.close().catch(() => undefined);
  if (lease !== undefined) await lease.release().catch(() => undefined);
  if (this.session === session) {                    // ← 身份守卫（R1：替代 epoch 守卫）
    if (this.lease === lease) this.lease = undefined;
    this.session = undefined;
    if (this.unsubscribe === unsubscribe && unsubscribe !== undefined) this.unsubscribe = undefined;
    this.watchdog.teardown();
    this.round.teardown();
    this.channel.teardown();
  }
}

/** 清理入口（各失联/终局/停止事件调用）。
 *  R1（#1）：claim 于**排队前**在 caller 同步栈求值——原稿把 claimForDisposal() 写进
 *  任务 lambda，等于任务**执行期**才捕获：T1 挂起（drain 屏障）期间 fatal 补排 T2、
 *  blocked→re-add 重建 gen2 后 T2 才开始执行 → 捕获到 gen2 字段且 epoch 恒等 →
 *  杀新代（SA2 #1 攻击路径）。排队前求值后 T2 的 claim 恒为 fatal 时刻的本代资源，
 *  执行滞后到任何代际都只处置捕获对象。 */
private cleanupResources(): Promise<void> {
  const claim = this.claimForDisposal();             // ← 求值点 = 排队前（事件同步段）
  return this.enqueueLifecycle(() => this.runDisposal(claim));
}
```

- 原 `closeSessionAndRelease()`（L957-986）**删除**，由 `runDisposal(claim)` 取代。差异（对照旧实现）：
  1. 捕获时点：**排队前**（caller 同步栈，R1 #1 修正——初稿的「排队时」表述与 lambda 内求值的代码自相矛盾，本版代码与 §4.2 表逐行一致）而非执行入口——P3 与 SA2 #1 的错代窗口均消除；
  2. `unsubscribe`：只退**捕获的**句柄；删除入口无条件 `quiesceSync()`（旧 L961 与 R4-2 注释自相矛盾处——退订当前字段可能是新代 listener）；
  3. 字段清空与 aux teardown 以**身份守卫**判定（R1 #3）：本代资源照常收口；新代已建 session 时不触碰；epoch 推进与否不再影响处置正确性。
- 语义兑付：`session.close()` / `lease.release()` 幂等 same-promise（ADR-0009 L42、#134 修订节 L246）——同一 claim 被两个事件重复排队（如 hub-CLOSE 续体 + 随后 stop）时，第二次处置结算为同一 Promise，**恰一次释放**由幂等机制兑付，无双重副作用；第二次任务的身份守卫因首次已清字段（`this.session=undefined ≠ claim.session`）自然短路。

### §4.2 所有清理路径汇流点（caller 全景；R1 后代码与表逐行一致）

| 触发事件 | 捕获时点（claim 求值位置） | 队列任务体 | 状态机/wire 副作用 |
|---|---|---|---|
| hub `CLOSE_NAMESPACE`（§D2） | onCloseRequest 同步段（quiesceSync 之后） | drain → runDisposal(claim) → epoch 内：CLOSE_OK + `closed` + settle | epoch 门（跨代零 wire/零迁移；独立局部变量） |
| `removeTarget`（§D3） | ensureCloseMemo 创建时（removeTarget 同步段）；**本地收口分支**（`targeted`/`disconnected` 与 seq≤0）在 removeTarget 同步段捕获后直接排队 | drain → runDisposal(claim)，随后 await settle-gate；本地收口分支 = 同步结算 + runDisposal(claim)（F1 补排——GOAWAY drain 窗口 `disconnected` 内 removeTarget 不得依赖 deadline 全量层处置：该层以 `isTerminal()` 早退） | gate 由 CLOSE_OK/closeTimeout/断线/blocked/stop 事件结算 |
| 连接断线 `onConnectionLost`（§D5.1） | 活跃/failed 分支的事件同步段；**closing 分支不排队**（见下） | runDisposal(claim) | 投影 `disconnected` 已在同步段完成 |
| blocked `onConnectionFatal` / GOAWAY deadline 全量静默（§D5.1/§D6） | 事件同步段（含 closing——见下） | runDisposal(claim) | 投影 `disconnected` 已在同步段完成 |
| GOAWAY 收帧段轻量静默 `onConnectionQuiesce`（§D6，R1 #4 新增） | **不排队**（零处置） | — | 摘订阅/清 timer/closing 结算/投影 `disconnected`；处置留给 deadline 回调或 transport 失联（与现状同时点） |
| `stop()`（onConnectionStopped） | 调用时 | runDisposal(claim) | `closed` 投影 + settle 已在同步段完成 |
| ns 终局 `finalize()` | finalize 同步段 | runDisposal(claim) | 终态投影 + settle 已在同步段完成 |
| closeTimeout（onTimerFired 'close'） | timer 回调同步段 | runDisposal(claim) | `closed` + settle 已在回调段完成 |

**closing 分支排队不对称的裁决（R1，回应 SA2 #1 附带质询）**：`onConnectionLost` 的 closing 分支不排队、`onConnectionFatal` 的 closing 分支补排队——**有意为之**。依据不变量 **I-C**：进入 `closing` 的仅有入口（`onCloseRequest` 续体、`removeTarget` 的 `ensureCloseMemo` body）都在进入同步段内排队了带 claim 的处置任务，故 Lost 侧无需重复；Fatal 侧的补排队是**防御性保底**（防未来新增 closing 入口遗漏排队），其零副作用前提正是 R1 #1 修复后的**排队前捕获**——claim 在 fatal 同步段求值恒为本代资源，即使任务滞后到新代建成后执行也只处置捕获对象（身份守卫再兜底），不会成为 SA2 #1 描绘的错代载体。

---

## §5. §D2 — `onCloseRequest` 收口续体重写（Scope 2 / P3 主锚）

```ts
onCloseRequest(message: { sequence: number }): void {
  if (this.isQuietState()) return;                 // 既有：closing/终态重复 CLOSE 静默
  this.clearAllTimers();                           // §D5：进 closing 即清 open/bootstrap/reconcile 残留 timer
  this.setState('closing');                        // §12：帧分发同步段停接纳
  this.quiesceSync();                              // 同步摘本代 listener（AC6-1 既有锚）
  const claim = this.claimForDisposal();           // ★ 排队前捕获（onCloseRequest 同步段求值；unsubscribe 字段已被 quiesceSync 清空 → claim.unsubscribe=undefined，句柄已退）
  const epoch = this.host.connectionEpoch();
  void this.enqueueLifecycle(async () => {
    await this.drainPendingApplies();              // §16：已接纳 apply 无条件排空（不取消）
    await this.runDisposal(claim);                 // 只处置捕获的 gen-N session/lease
    if (this.host.connectionEpoch() !== epoch) {
      return;                                      // ★ P3 核心：跨代 → 零 CLOSE_OK、零 setState、零 settle（settle 已由断线分支完成）
    }
    this.sendChecked({
      kind: 'CLOSE_OK',
      namespaceId: this.namespaceId,
      ackedSequence: message.sequence,             // 本端为 CLOSE_NAMESPACE 接收方 → 回发 CLOSE_OK（协议 §5 Result 语义）
    });
    if (this.state !== 'closed') this.setState('closed');
    this.settleCloseMemo();
  }).catch(() => undefined);                       // R1（#7）：fire-and-forget 显式吞错（任务体结构性零 throw，防御 seam 偏差）
}
```

P3 时序推演（修复后）：gen1 hub CLOSE → claim1={session1,lease1}（onCloseRequest 同步段捕获），任务 T1 挂在 drainPendingApplies（saveGate）→ 断线（closing 分支：清 timer + `disconnected` + settle）→ 重连 gen2（epoch2）→ session2/listener2/lease2 建成、aux 重置（§D5.2）→ 放行 saveGate → T1 恢复：runDisposal(claim1) 关 session1/release lease1（身份守卫：`this.session===session2≠session1` → 不触碰 gen2 字段/aux）→ epoch 2≠1 → return（无 CLOSE_OK 落新连接、无 `closed` 投影）→ gen2 继续 reconcile → live → `writePeer({n:101})` 经 listener2 收敛。四锚全绿。

---

## §6. §D3 — `removeTarget`：发送校验 + timer 卫生 + memo 处置 claim 化（Scope 4 / AC3）

```ts
removeTarget(): Promise<void> {
  if (this.intent === 'removed') {
    return this.closeMemo?.get() ?? Promise.resolve();
  }
  this.intent = 'removed';
  switch (this.state) {
    case 'targeted':
    case 'disconnected':
      this.setState('closed');
      this.settleCloseMemo();
      // ★ F1（SA4 复审补排，2026-08-30）：本地收口同样排队处置——GOAWAY drain 窗口
      // （轻量层投影 disconnected + 零处置排队）内 removeTarget 落入本分支时，若不
      // 排队，deadline 全量层 onConnectionFatal 以 isTerminal()（closed）早退 →
      // session/lease/watchdog 泄漏（AC2）。claim 于本同步段捕获：'targeted' 态为
      // 空 → 幂等 no-op；'disconnected' 态 = 本代资源 → 恰一次处置（与 loss 路径已
      // 排队处置经幂等 same-promise 兑付）。**不拆**终态早退门。
      void this.cleanupResources().catch(() => undefined);
      return this.closeMemo?.get() ?? Promise.resolve();
    case 'opening':
    case 'bootstrapping':
    case 'reconciling':
    case 'live':
    case 'needs-resync': {
      this.clearAllTimers();                        // ★ RC3：清残留 open/bootstrap/reconcile timer（防 closing 期触发 finalize('failed') 污染收口）
      this.setState('closing');
      const seq = this.sendChecked({
        kind: 'CLOSE_NAMESPACE',
        namespaceId: this.namespaceId,
        reasonCode: 'target-removed',
      });
      if (seq > 0) {
        this.closeSequence = seq;                   // ★ RC4：仅在 CLOSE 确实上线时武装 CLOSE_OK 等待
        this.armTimer('close');
        return this.ensureCloseMemo();
      }
      // ★ RC4/AC3：发送被抑制（connState!=='ready' / 出站未就绪 → sendControl 静默 0）
      // —— CLOSE 未上线即不得等待 CLOSE_OK：本地收口 + 立即结算（不等 closeTimeoutMs）
      this.closeSequence = undefined;
      this.setState('closed');
      this.settleCloseMemo();
      void this.cleanupResources().catch(() => undefined);   // R1（#7）：drain 由 session.close barrier 承担（§16 无条件排空）
      return this.closeMemo?.get() ?? Promise.resolve();
    }
    case 'closing':
      return this.ensureCloseMemo();
    case 'closed':
      return this.closeMemo?.get() ?? Promise.resolve();
    case 'conflicted':
    case 'failed':
      this.setState('closed');
      return Promise.resolve();
    default: { /* never */ return Promise.resolve(); }
  }
}

private ensureCloseMemo(): Promise<void> {
  if (this.closeMemo === undefined) {
    const gate = new Promise<void>((resolve) => { this.closeSettleResolve = resolve; });   // 同步登记（R3 既有纪律，保留）
    const claim = this.claimForDisposal();          // ★ 排队前捕获（memo 创建时 = removeTarget 同步段求值，R1 #1）
    this.closeMemo = new Memoized(async () => {
      await this.enqueueLifecycle(async () => {
        await this.drainPendingApplies();
        await this.runDisposal(claim);
      });
      await gate;                                   // 事件驱动结算（onCloseOk/closeTimeout/断线/blocked/stop/E5 终局）
    });
  }
  return this.closeMemo.get();
}
```

- `settleCloseMemo()`（L604-617）零改动（R3 事件驱动结算纪律原样保留）。
- 兼容核对：`r3-r4-regressions ⑦`（live 期 removeTarget、连接 ready → seq=9 正常路径 + CLOSE_OK → closed）、`ac6 正常 close`、`ac7 cleanup 竞态/合流`、`spec-b1-b2 B1`、`round2 L108-125`（断线 = settle true）——全部走 seq>0 或既有分支，行为不变。

---

## §7. §D4 — `onCloseOk`：错配显式收口（Scope 5 / AC4 / C4）

权威策略基线（库内既有）：hub `onBootstrapAck` 错配 → `connectionFatal('ACK_STATE_VIOLATION', 1002)`（hub-namespace.ts:450-456）；`onUpdateAck` → `channel.onAck` 'violation' → 同款 fatal（peer-namespace.ts:482-492）；协议 §10.2 L283「Unknown、类型不匹配或 namespace 不匹配的 ackedSequence 属 connection fatal `ACK_STATE_VIOLATION`」+ §13.1 L351（fatal/no-retry/1002）；ADR-0010 L147「错误ACK关联关闭连接」。

```ts
onCloseOk(ackedSequence: number): void {
  if (this.isTerminal() || this.state === 'disconnected') {
    return;                                         // §13.4 迟到纪律：终态/失联静默（含 GOAWAY drain 窗口——§D7）
  }
  if (this.state === 'closing') {
    if (this.closeSequence !== undefined && ackedSequence === this.closeSequence) {
      // 本端 removeTarget 发出的 CLOSE_NAMESPACE 的关联确认 → 收口完成信号（接受收口语义保留）
      this.clearTimer('close');
      this.setState('closed');
      this.settleCloseMemo();
      return;
    }
    // ★ RC5/C4 + R1（#2）：closing 期其余一切 CLOSE_OK（有 closeSequence 而错配，或
    // closeSequence===undefined 即 close 源于 hub 发起的 CLOSE_NAMESPACE——本端从未发出
    // CLOSE_NAMESPACE，入站 CLOSE_OK 按定义 unmatched）→ 按库内 ACK 关联权威策略显式收口，
    // 不做任何静默完成（AC4「no silent completion」）
    this.host.connectionFatal('ACK_STATE_VIOLATION', 1002);
    return;
  }
  // 活跃态收到未请求的 CLOSE_OK：peer 全库唯一 CLOSE_NAMESPACE 发送点 = removeTarget
  // （peer-namespace.ts:561；hub 侧发送点为零——hub-connection.ts:323-326 将入站 CLOSE_OK
  // 判方向异常）→ 本端未请求即伪造/错向帧，同款 ACK 关联违例
  this.host.connectionFatal('ACK_STATE_VIOLATION', 1002);
}
```

- **R1（#2）修订——删除初稿的 `closeSequence===undefined` 接受例外**：初稿误设「hub 发起 CLOSE 的 CLOSE_OK 合法」分支，SA2 证伪——协议 §5 L104 的 Result 语义决定 **CLOSE_OK 的发送方恒为 CLOSE_NAMESPACE 的接收方**：hub 发起 CLOSE_NAMESPACE 时应答帧是 peer→hub 方向（本端**出站**，§D2 续体已发送），hub→peer 的 CLOSE_OK 只能由 peer 发出的 CLOSE_NAMESPACE 触发，而 peer 唯一发送点是 `removeTarget`（seq>0 ⇒ `closeSequence` 必有值；seq≤0 ⇒ §D3 已本地收口进终态静默域）。故「closing ∧ closeSequence===undefined」窗口的入站 CLOSE_OK **协议上不可能合法**，一律 fatal。该窗口的收口结算本就由 §D2 续体承担（不依赖 CLOSE_OK）；fatal 后续体的 epoch 门（blocked 不拨号、epoch 不变）令其照常完成 `closed` 投影与 settle（`sendChecked` 经非 ready 门零出站）。
- C4 四锚兑付：错配 → ERROR 帧（connectionFatal 直发 outbound 豁免路径，peer-connection.ts:542-561 既有）→ `enterBlocked()`（L595-613）→ 控制器 `onConnectionFatal`：closing → `settleCloseMemo()`（removeTarget 承诺有限结算）+ `disconnected` 投影 + 处置排队；transport `close(1002)`；连接 `blocked`。
- 迟到的**匹配** CLOSE_OK 在终态/失联被静默忽略（承诺已结算），不复活（§13.4）。

---

## §8. §D5 — `onConnectionLost` / `onConnectionFatal` 全分支收口（Scope 3 / AC2）

### §8.1 重写（peer-namespace.ts L621-648；R1 拆分为轻量/全量两层）

```ts
onConnectionLost(): void {
  if (this.state === 'closed' || this.state === 'conflicted') return;   // 终态保持
  this.clearAllTimers();                            // ★ RC3：断线同步段清全部 timer（open/bootstrap/reconcile/close）
  this.quiesceSync();                               // 同步摘本代 listener（既有）
  if (this.state === 'closing') {
    this.setState('disconnected');
    this.settleCloseMemo();                         // R3 既有：断线 = 关闭承诺兑现
    return;                                         // 处置由已排队的 close 续体承担（不变量 I-C，§4.2）
  }
  if (this.state === 'failed') {
    this.setState('disconnected');
    void this.cleanupResources().catch(() => undefined);   // finalize 已排队（幂等兑付）；防御性保底
    return;
  }
  this.setState('disconnected');                    // B-2d 既有：投影先行（重连 openActiveTargets 不跳过）
  void this.cleanupResources().catch(() => undefined);
}

/** R1（#4）新增——GOAWAY RESTARTING 收帧同步段的轻量静默：与全量层的差异 = **零处置排队**。
 *  摘订阅（G5 数据面双保险之一）+ 清 timer + closing 承诺结算 + 投影 disconnected 即止；
 *  session/lease 处置与 aux teardown 留给 deadline 回调（§D6 全量层）或 transport 失联
 *  （onConnectionLost/onConnectionFatal）——处置时点与现状完全一致（D5 计面不变的根据）。 */
onConnectionQuiesce(): void {
  if (this.isTerminal()) return;
  this.clearAllTimers();
  this.quiesceSync();
  if (this.state === 'closing') this.settleCloseMemo();
  this.setState('disconnected');
}

/** 全量静默：blocked（enterBlocked）与 GOAWAY deadline 回调（§D6）共用 = 轻量段 + 处置排队。 */
onConnectionFatal(): void {
  if (this.isTerminal()) return;
  this.onConnectionQuiesce();
  // closing 分支的补排队 = 有意保底（§4.2 不对称裁决）：不变量 I-C 下幂等零副作用；
  // 安全前提 = R1（#1）修复后的排队前捕获——claim 在本同步段求值恒为本代资源。
  void this.cleanupResources().catch(() => undefined);
}
```

- **watchdog/round/channel 不在轻量静默段 teardown**（SA1 对 RC3「同步停摆」的收敛裁决，R1 #4 后精确化）：三者的收口点 = (a) 全量静默/处置完成段（同代身份守卫命中）或 (b) 新代 open 路径重置（§D5.2）——AC2 要求的是**完成清理、零泄漏**（身份守卫保证任意路径最终命中其一），不要求同步完成；watchdog 残留探测期由 §D5.3 复活门挡住副作用。理由：GOAWAY/blocked 后 transport 可能仍开放（drain 窗口 / SHUTTING_DOWN 不关 socket），channel 同步 teardown 会让迟到 UPDATE_ACK 落入 `onAck` 'violation' → 假 fatal（update-channel.ts:97-116 zombie 容忍语义被破坏）；处置（watchdog teardown/lease release 及其触发的 registry idle 计面）留在 deadline 回调/失联点 = 与现状**同时点同款**——`sa7-issue137 D5` 的 scheduler pending 精确计面因此逐值不变（§13.2 重推）。
- 兼容核对：F2（重连 open 超时 → failed——gen1 断线清 timer 不影响 gen2 openTimer 武装）、ac6 断线族、ac7 L83/117/272、F3（closing 期注入错序帧 → 连接级 SEQUENCE_VIOLATION，与 ns 层无关）——全绿。

### §8.2 新代 open 路径的 aux 重置（§D5.2）

`tryOpenReplicationSession` 成功段（session 赋字后、subscribe 前）追加：

```ts
this.session = result.session;
// ★ 代际重置：新代 session 建成——清上一代残留的 round/channel/watchdog 簿记与 closeSequence
//（旧代 disposal 若仍悬挂，其身份守卫（§D1）不命中新代 session → 不触碰 aux；残留清理由新代 open 路径自担）
this.round.teardown();
this.channel.teardown();
this.watchdog.teardown();
this.closeSequence = undefined;
this.subscribe();
```

正常重连路径下此时 aux 已被前代处置清过（幂等 no-op）；**stuck-disposal 路径**（P3：gen1 处置挂在 drain 上、gen2 已建成）下此处是唯一的重置点——gen1 的 `wasLive`/in-flight 序号/`needsResync` 残留不得泄入 gen2 首轮 reconciling。`channel.teardown()` 置 `needsResync=true` 与既有断线路径（处置段 teardown）行为一致：gen1 未发送队列按 §16「断线期间不维持 update outbox」丢弃，恢复由 round diff + 既有 resync 机制修复（与现行断线重连语义逐字同构，非新行为）。

### §8.3 watchdog 复活门（peer-namespace.ts `onWatchdogEdge` L732-744）

```ts
private onWatchdogEdge(_predicate: WatchdogPredicate): void {
  if (this.isQuietState() || this.state === 'disconnected') return;   // ★ 静默域零复活（hub 侧 declareHubResync 已有同款门）
  ...既有逻辑...
}
```

堵漏：失联/GOAWAY 静默期 watchdog idle 探测命中 `needsResync` 边沿时，旧代码会 `setState('needs-resync')` + 发 RESYNC 帧（跨代/静默域复活 + 噪声帧）。hub 侧 `declareHubResync`（hub-namespace.ts:665）已有 `isQuietState` 门——peer 侧补齐对称缺口（`disconnected` 一并入静默域，见 §D7）。

### §8.4 applyStep2 的 SYNC_APPLIED 门（双侧，§D5.4；R1 #8 裁决 = 决策 (a) 对称放行）

**R1（#8）裁决**：drain 窗口（连接存活、epoch 未变）内，SYNC_APPLIED 与 UPDATE_ACK 同为「已接纳工作的 ACK」——按协议 §9.4 L250「已接纳 update 正常 apply/ACK」的同一纪律**照常发送**，完成在途 round 的收尾簿记；抑制既非协议义务（§6.3 只要求「停止 OPEN、不开始新 round」），初稿的「消耗死连接出站序列」理由不成立（drain 窗口连接存活，G5-③ 断言 connState 恒 ready），予以撤回。非对称消除后的门：

```ts
// peer：维持既有门不变（零改动）——applyStep2 已有 epoch 门（B-2d，peer-namespace.ts:785）：
//   if (outcome === 'ok' && this.host.connectionEpoch() === epoch) → sendChecked(SYNC_APPLIED)
//   （'disconnected' 照发：连接存活 + epoch 未变 = 在途 round 合法收尾；重连后 epoch 不符 → 零发送）
// hub：补 isQuietState 门（hub 通道无 'disconnected' 态；closing/终态 = 通道已静默，迟到
//   SYNC_APPLIED 属 Scope 1「迟到续体零 wire」家族）：
//   if (outcome === 'ok' && !this.isQuietState()) → sendChecked(SYNC_APPLIED)
```

peer 侧 round 结算后的状态推进由既有 B-1 守卫兜底（`onRoundSettled`：state ≠ 'reconciling' → return——drain 窗口 state='disconnected'，零迁移、不复活 live）；hub 侧在途 round 因 peer 照常回 Applied 而正常结算（`onRoundSettled` 的 closing 守卫 L783 已有）。零既有测试依赖此帧在 closing 期发出（§13.2 核对）。

---

## §9. §D6 — GOAWAY 同步静默（Scope 6 / AC5 / G5；R1 #4 修订 = 轻量/全量两层）

```ts
// peer-connection.ts onGoaway（L398-412 重写）
private onGoaway(message: { reasonCode: string; drainTimeoutMs: number }): void {
  this.goawayActive = true;
  if (message.reasonCode === 'SERVER_SHUTTING_DOWN' || message.reasonCode === 'REAUTH_REQUIRED') {
    this.enterBlocked();                            // 既有：收帧即全量静默（enterBlocked → onConnectionFatal，R3-4 锚）——不变
    return;
  }
  // ★ RC6 + R1（#4）：同步静默订阅先于异步 drain（#161 修订节）——收帧同步段执行**轻量层**
  //（onConnectionQuiesce：摘订阅/清 timer/closing 承诺结算/投影 disconnected），
  // **零处置排队**；session/lease 处置与 aux teardown 留在 deadline 回调（全量层）——与现状
  // 同时点同款，D5 计面逐值不变（§13.2 重推）。
  this.quiesceControllersLite();
  this.clearGoawayDrain();
  this.goawayDrainHandle = this.options.timer.setTimeout(() => {
    this.goawayDrainHandle = undefined;
    this.quiesceControllers();                      // 全量层（onConnectionFatal：轻量段幂等 no-op + 处置排队）
    this.sender?.teardown();                        // §8 既有：poll timer 清零
    const transport = this.transport;
    if (transport !== undefined && !transport.closed) transport.close(1001, 'goaway-drain');
  }, message.drainTimeoutMs);                       // ★ deadline 只管 transport close（§6.3 L149「之后发送方以 WS 1001 关闭」）
}

// 连接层新增（与既有 quiesceControllers L414-416 并列）：
private quiesceControllersLite(): void {
  for (const controller of this.controllers.values()) controller.onConnectionQuiesce();
}
```

- `quiesceControllers()`（全量，L414-416）本体不变；调用点 = deadline 回调（与现状同点）+ enterBlocked（既有）。新增 `quiesceControllersLite()` 仅用于 RESTARTING 收帧段。
- **两层分工**：轻量层满足 AC5/G5 全部锚（同步停新数据：摘订阅 + `disconnected` 投影 + `sendFacet.pullAndSendOne` 的 live 门（L106）三重保险 → 零 UPDATE 出站）；全量层（处置）保持在 deadline——「drain 不延迟**静默**」（静默已收帧完成），处置次序符合 §6.3「现有 namespace 到 deadline 前自然收口，之后发送方以 WS 1001 关闭」。
- 若 deadline 前先发生 transport 失联（pong 超时/网络断）：`onClose` → `onTemporaryFailure` → `onConnectionLost`（state 已 'disconnected' → 活跃分支）排队处置——处置时点仍与现状一致（现状在该点经 live 分支排队处置）。
- 连接级状态**不变**：drain 窗口内 `connState` 保持 `ready`（G5-③ companion、G1、D3 均断言）；`goawayActive` 在 `dialNow`（L190）复位 + `clearGoawayDrain`——drain 窗口内 pong 超时先触发重连时，迟到 deadline 不得关闭新 transport（D3 既有幂等锚，保持）。
- **死 seam 清理**：`PeerNamespaceHost.isGoawayDraining()`（peer-namespace.ts:52）+ 装配（peer-connection.ts:94）删除。复核：`grep -rn isGoawayDraining src test` 仅接口声明+装配，零消费者；`PeerNamespaceHost` 不在 index.ts 公共导出面——内部接口变更。

兼容核对（R1 后精确计面见 §13.2 D5 行）：G1/G2（sa7-dynamic）、D3（round2）、D5/D5B1（issue137）、R3-4/R3-5（review-revisions）——全绿。唯一时序翻转 = 本任务 G5 红灯契约要求的行为本身（静默时点），处置时点零翻转。

---

## §10. §D7 — 入站帧静默域扩展 `disconnected`（GOAWAY drain 窗口不变量）

**问题**：现行不变量「`disconnected` ⇒ transport 已死 ⇒ 无入站帧」由 dialNow 的 epoch 门（peer-connection.ts:239-242）隐性维持。§D6 在**连接存活**的 drain 窗口投影 `disconnected` 后，该不变量被打破：hub 迟发 UPDATE/RESYNC/OPEN_OK 等帧到达时，`onHubUpdate` 等按「非 quiet 且不 accepted」判 `NAMESPACE_STATE_VIOLATION` + `finalize('failed')`——静默期复活为终局失败 + ERROR 噪声帧。

**设计**：新谓词 `isInboundQuiet() = isQuietState() || state === 'disconnected'`，逐 handler 精确适用：

| Handler | 现状 | 新语义 | 豁免理由/保留语义 |
|---|---|---|---|
| `onSyncStep1/2`、`onSyncApplied`、`onResyncReceived`、`onHubUpdate`、`onUpdateAck` | `isQuietState()` 门（既有） | 改 `isInboundQuiet()`（+disconnected） | §6.3「停止 OPEN、不开始新 sync round」；失联期帧本不可达 |
| `onCloseOk` | 仅匹配收口 | 终态/disconnected 静默；closing 段按 §D4 | §D4 |
| `onErrorFrame` | `isQuietState()` + closing return | +disconnected 静默 | 静默期终局 ERROR 无处置面（连接将死） |
| `onOpenOk` | `state!=='opening'` → 非终局即 violation+finalize | 追加 disconnected 静默；**closing → finalize('failed') 保留** | D6（sa7-hardening-dynamic「closing 期迟到 OPEN_OK → finalize + E5 结算」绿灯锚不动） |
| `onBootstrapSnapshot` | 同上结构 | 追加 disconnected 静默 | 同上；导入续体自有 epoch 门（R4-1） |
| `onCloseRequest` | `isQuietState()` 门 | **不改**（disconnected 不豁免） | §12：hub 发起的 CLOSE_NAMESPACE 在 drain 窗口照常履行——本端为**接收方**，回发 CLOSE_OK（§D2 续体，出站方向）+ 处置；§D2 续体的 epoch 门防其落新连接 |
| `onIdentityChanged` | 仅 closing 豁免 | **不改** | 业务终局信号（conflicted）与连接生死正交，保留终局化 |

已接纳 apply 的 ACK 例外（R1 #8 后统一口径）：drain 窗口（连接存活、epoch 未变）内，`applyRemoteUpdate` 非 Step2 路径的 `UPDATE_ACK`（L822-829）与 Step2 路径的 `SYNC_APPLIED`（既有 epoch 门）**均照常发送**——§9.4 L250「已接纳 update 正常 apply/ACK」是 drain 窗口的协议义务，完成在途 round/窗口收尾簿记，不属于「新数据」（§6.3 仅禁「停止 OPEN、不开始新 round」）；重连后（epoch 不符）由既有 epoch 门拦截零发送。

---

## §11. §D8 — hub 侧迟到 open 续体中止与显式回收（Scope 1 / AC1+AC2 / H1）

### §11.1 中止谓词（hub-namespace.ts，§D8.1）

```ts
/** open 续体中止判别：终态 ∨ 通道已静默（closing）。不变量：进入 closing 的唯一出口是终态
 *  （收口链 setState('closed') / finishOpenError 在静默域内一律走 silent 分支）——
 *  hub 通道不跨连接存活，无需连接计数器；通道静默态即完备的代际信号。 */
private isOpenAborted(): boolean {
  return this.isTerminal() || this.state === 'closing';
}
```

### §11.2 决策 D-H1：authorize 恢复点不拦截 registry.open（中止保护资源账目，不保护调用点）

**证据链**（§0.1 探针 + 红灯契约推导）：
1. H1 时序下 authorize 恢复时通道已终局 `closed`，现行 guard（L239）在取得任何资源前拦死 → registry.open 零调用、零事件 → 锚①以 0 红灯；
2. 锚①绿灯判据「续体恢复后必有 `lease-released` 事件」在算术上**要求** registry.open 被调用并交付 lease 后回收——任何「authorize 恢复点中止」的修复都无法产生该事件（该时序下无其他 lease 来源；gen2 在断言之后才建立）；
3. 语义对称：peer 侧 B-2c（L186-195）的 abort 点同样位于 registry.open **返回之后**（取得完成 → 迟到判别 → `releaseLeaseOrNoop(result.lease)`）；「中止时对续体本地已取得的 lease/session 显式回收」（Scope 1 原文）以取得为前提。

**规则**：authorize 恢复点仅在**失败**（throw/拒绝）且已中止时走 silent 收口（不向死连接补发 ERROR）；authorize **成功**后续体进入 registry.open（取得阶段完整执行），中止判别自 registry.open 恢复点起逐点生效。

### §11.3 startOpen 各恢复点重写（§D8.3）

```ts
startOpen(message): void {
  if (this.openInFlight) return;
  this.openInFlight = true;
  this.openWaiters.push(() => undefined);
  void (async () => {
    let authz: NamespaceAuthorization;
    try {
      authz = await this.host.authorize(this.host.peerInstanceId(), this.namespaceId);
    } catch {
      if (this.isOpenAborted()) { this.finishOpenSilently(); return; }   // ★ 已静默：不向死连接发 INTERNAL_ERROR
      this.finishOpenError('INTERNAL_ERROR');
      return;
    }
    if (!authz.ok || !authz.permissions.read) {
      if (this.isOpenAborted()) { this.finishOpenSilently(); return; }   // ★ 同上（未授权不泄露存在性亦适用死连接）
      this.finishOpenError('NAMESPACE_UNAUTHORIZED');
      return;
    }
    let opened: Awaited<ReturnType<NamespaceRegistry['open']>>;
    try {
      opened = await this.host.registry.open(authz.localOwner, this.namespaceId);   // D-H1：取得阶段完整执行
    } catch {
      if (this.isOpenAborted()) { this.finishOpenSilently(); return; }
      this.finishOpenError('INTERNAL_ERROR');
      return;
    }
    if (this.isOpenAborted()) {
      // ★ H1 主修复点：registry.open 已交付、尚未赋字 → 显式回收局部 lease（零泄漏）
      this.finishOpenSilently(opened.ok ? opened.lease : undefined);
      return;
    }
    // R1（#5）：取得之后的**每一个失败出口**先判 isOpenAborted()——中止态一律静默回收
    //（finishOpenSilently），不得走 finishOpenError 向已静默连接补发 ERROR（总则 3 零 wire）；
    // 未中止才保持既有 ERROR 行为（活连接语义不变）。
    if (!opened.ok) {
      if (this.isOpenAborted()) { this.finishOpenSilently(); return; }     // R1 #5：中止 + 拒绝（无资源可回收）
      this.finishOpenError(opened.code === 'NAMESPACE_NOT_FOUND' ? 'NAMESPACE_NOT_FOUND' : 'INTERNAL_ERROR');
      return;
    }
    this.lease = opened.lease;
    // getStatus 判定（既有 try/catch）：catch 时同样先判中止——
    //   if (this.isOpenAborted()) { this.finishOpenSilently(); return; }    // R1 #5（lease 已赋字 → 字段回收）
    //   this.finishOpenError('INTERNAL_ERROR');
    if (this.isOpenAborted()) { this.finishOpenSilently(); return; }    // 已赋字：closeSessionAndRelease 兜底回收 this.lease
    // replication disabled / identity/mode 判定（既有）：每个失败出口同款两行——
    //   if (this.isOpenAborted()) { this.finishOpenSilently(); return; }    // R1 #5
    //   this.finishOpenError('REPLICATION_NOT_ENABLED' | 'REPLICATION_ID_MISMATCH' | 'REPLICATION_EPOCH_MISMATCH');
    let sessionResult: Awaited<ReturnType<NamespaceLease['openReplicationSession']>>;
    try {
      sessionResult = await this.lease.openReplicationSession({ localRole: 'hub', remoteInstanceId: this.host.peerInstanceId() });
    } catch {
      if (this.isOpenAborted()) { this.finishOpenSilently(); return; }
      this.finishOpenError('INTERNAL_ERROR');
      return;
    }
    if (this.isOpenAborted()) {
      // ★ E2 第二窗口：session 已交付、尚未赋字 → 先关 session 再回收 lease（ADR-0010 L90 次序）
      this.finishOpenSilently(undefined, sessionResult.ok ? sessionResult.session : undefined);
      return;
    }
    if (!sessionResult.ok) {
      if (this.isOpenAborted()) { this.finishOpenSilently(); return; }     // R1 #5
      this.finishOpenError(sessionResult.code === 'REPLICATION_NOT_ENABLED' ? 'REPLICATION_NOT_ENABLED' : 'INTERNAL_ERROR');
      return;
    }
    // 以下安装段（赋 session/openMode/hubIdentity/订阅/flushOpenWaitersOk/startBootstrap 或 reconciling）不变
  })();
}
```

### §11.4 finishOpenSilently 显式回收化（E2 修复，§D8.4）

```ts
/** §13.4 终局/已静默：零 wire、零状态机迁移；对续体局部已取得、尚未赋字的资源显式回收。 */
private finishOpenSilently(pendingLease?: NamespaceLease, pendingSession?: ReplicationSession): void {
  this.openWaiters = [];
  if (pendingSession !== undefined) {
    void pendingSession.close().catch(() => undefined);      // 先关 session（ADR-0010 L90）
  }
  if (pendingLease !== undefined && pendingLease !== this.lease) {
    void pendingLease.release().catch(() => undefined);      // 再释放未赋字 lease（幂等 same-promise）
  }
  void this.closeSessionAndRelease();                        // 已赋字段的 lease/session（幂等；hub 侧字段读取安全——见下）
}
```

hub `closeSessionAndRelease`（L840-860）**保留字段读取语义**（不改 claim 化）：hub 通道不跨连接，字段只被本通道 open 续体在 await 间隙外同步赋值，收口链与续体的两次回收经幂等 release 兑付恰一次；跨代错杀面（peer RC2）在 hub 结构性不存在。**E1 复活变体**（恢复时 state 尚 `closing`）由 `isOpenAborted()` 同一谓词拦截：中止于赋字/flush 之前 → 零 `OPEN_OK`/`BOOTSTRAP_SNAPSHOT`、零 `bootstrapping` 倒退（AC1「no late OPEN_OK/bootstrap」）。

**中止时 openWaiters 的处置裁决（R1 #6，决策 (a) = 维持静默丢弃）**：`onOpen` 在 closing 态压入的 waiter（期望收口后答复 `NAMESPACE_REOPEN_REQUIRES_RECONNECT`，hub-namespace.ts:189-196）与 opening 态合流的 waiter（重复 OPEN 等待再答 OPEN_OK/ERROR），在 startOpen 续体中止时随 `finishOpenSilently` 整体静默丢弃。依据：(1) 总则 3 迟到续体零 wire 优先——中止意味着通道已静默（closing/终态），向其补发任何答复帧（含 reopen 错误）与 Scope 1「no late OPEN_OK」同族；(2) 对端恢复路径明确：peer 侧由 `openTimeoutMs`（§18：open timeout 收口 namespace → failed → 断线投影 → 重连重 OPEN，§16）兜底，重连后按 §7 L166 收到 `NAMESPACE_REOPEN_REQUIRES_RECONNECT`——「每个请求都收到 OPEN_OK 或 ERROR」在**连接存活**的窗口内成立，静默连接上的例外由重连闭环；(3) 与现状行为一致（既有 `finishOpenSilently` 即清空 waiters，非回归）。登记 §13.3 不变式。

### §11.5 hub timer 卫生（RC3 对称项，§D8.5）

- `quiesceConnection()`（L574-581）追加 `this.clearAllTimers()`：连接静默同步段清 bootstrap 残留 timer（防静默期 fire → `finalize('failed')` 污染收口链的 `setState('closed')` 与 CLOSE_OK）。
- `onCloseRequest`（L538-559）同步段追加 `this.clearAllTimers()`：peer 发起 CLOSE 时 open/bootstrap timer 残留同理。
- 兼容核对：hub armTimer 回调自带 `isTerminal()` 门（L871），终局后 fire 零副作用——清理是防御性收敛，无行为回退面。

---

## §12. §D9 — Scope 7 裁决：生命周期权威归一（分工定责 + 死抽象清除）

**裁决：不重建共享 LifecycleQueue 类；按侧定责为两个显式单一权威，删除全部死抽象。** 理由：hub 通道（per-connection、无代际重建）与 peer 控制器（跨连接、epoch 所有权 + intent + settle-gate）生命周期形状不同构，强行单一类会重演「LifecycleQueue 零引用死抽象」事故（lifecycle-queue.ts L7-9 自述的历史）；Scope 7 明文允许「define separate authoritative duties and remove dead abstraction」。

| 侧 | 唯一权威 | 职责 | 附着机制（保留） |
|---|---|---|---|
| peer 控制器 | `cleanupTail` 队列（新原语 `enqueueLifecycle`，§D1） | 串行化：hub-CLOSE 收口续体、removeTarget 处置、loss/fatal/stop/finalize/closeTimeout 处置 | `Memoized`（removeTarget 承诺记忆化合流）+ `closeSettleResolve` gate（事件驱动结算，R3 纪律）——均非队列、无权威竞争 |
| hub 通道 | `closeQueue` promise 链（L93/542） | 串行化：peer-CLOSE 收口续体、连接收口处置 | open 续体**不排队而中止**（Scope 1：中止 ≠ 排队；其资源回收在续体内同步完成，§D8） |

死抽象清除清单：① hub `cleanupTail` 字段（L92，声明后零引用——SA1 grep 复核 `grep -n cleanupTail src/hub-namespace.ts` 仅 L92 一处）；② `isGoawayDraining` seam（§D6）；③ `lifecycle-queue.ts` 模块头注释更新为本节裁决（注释级改动，`Memoized` 本体不动）。

---

## §13. 既有绿灯锚兼容性影响清单（SA4/SA6/SA3 比对基准）

### 13.1 必须翻转的既有测试（1 个 IT）

| 测试 | 现断言 | 翻转后 | 理由 |
|---|---|---|---|
| `ws-replication-sa6-hardening-g1-g2-red.test.ts` AC3b（L190-231） | 伪造 CLOSE_OK 后 `closeSettled===false`、ns≠closed、closeTimeout 兜底 | ns≠closed（保持成立：经 violation 收口投影 `disconnected`）+ `closeSettled===true`（violation 结算）+ ERROR/blocked 断言可加 | C4 红灯契约（SA6 冻结，2026-08-30）显式推翻 #165 G4 旧决策「错配不完成 close——closeTimeout 兜底」（SA5 E8 考古登记）；AC3b 的原始意图「无效 ACK 不得完成 close」仍成立（close 不因伪造帧**成功**收口为 closed，而是显式违例收口） |

### 13.2 核对为绿的既有锚（关键项）

| 测试 | 核对结论 |
|---|---|
| `review-revisions R3-4/R3-5` | SHUTTING_DOWN→blocked 同步静默（不变）；RESTARTING deadline 静默断言在收帧段提前成立（订阅 undefined 仍真）、deadline 仍关 transport ✓ |
| `sa7-dynamic G1/G2` | G1 drain 窗口连接 ready ✓、deadline+closePeerSide→backoff→ns `disconnected`（提前于收帧段投影，waitNamespace 仍真）→重连 live ✓；G2 不变 ✓ |
| `sa7-round2 D3` | drain 窗口连接 ready ✓；pong 超时先于 deadline → dialNow 清 drain timer → 迟到 deadline 不关 wire2 ✓；重连 live ✓ |
| `sa7-issue137 D5`（SERVER_RESTARTING，R1 #4 精确重推） | **四检查点逐值不变**，根据 = 轻量/全量两层把处置时点钉在与现状完全相同的位置：① `beforePause`/`pausedPending` 基线：组成不变（resetCheck + watchdog idle（subscribe 起 armed，ackTimeoutMs=120s）+ poll；ns 在 live 态无 ns 级 timer）——轻量层 `clearAllTimers` 在 live 态清零个、`quiesceSync` 不动 timer、**零处置排队** ⇒ 收帧段唯一 delta = **+drain timer** → L544 `toBe(pausedPending+1)` 与现状逐值一致（初稿「全量收帧静默」会产生 −watchdog/±registry-idle 计面漂移，R1 已消除该风险）；② `advanceBy(1)` 后：drain fire 自清 + **全量层**（deadline 回调，与现状同点）：`sender.teardown`（−poll）+ `onConnectionFatal` 处置（watchdog teardown −1 + lease release → registry idle-eviction +1——三项与现状 deadline 回调的 `quiesceControllers→onConnectionFatal→cleanupResources` 完全同款同时点）→ L552 `toBe(pausedPending-1)` 不变；③ 大步推进 stale 零重武装：全量层处置已把 watchdog/round/channel 收口（身份守卫命中——epoch 未推进）→ L557 计面不增长 ✓；④ closePeerSide→backoff→重连：state 已 `disconnected`（轻量段投影）→ `onConnectionLost` 活跃分支排队处置（幂等，claim 已被全量层清空 → no-op）→ 重连 live ✓。B1 变体（SHUTTING_DOWN→`enterBlocked` 收帧即全量）：现状即如此（enterBlocked→onConnectionFatal→cleanupResources），断言 `toBeLessThan` 容差 → 不变 ✓ |
| `sa7-hardening-dynamic D6` | closing 期迟到 OPEN_OK → finalize('failed') + E5 结算——onOpenOk 的 closing 分支**保留**（§D7 表）✓ |
| `spec-b1-b2 B1`、`r3-r4 ⑤/⑦/⑧`、`ac6/ac7` 全 close 族 | seq>0 正常路径/矩阵分支行为不变；removeTarget 加 clearAllTimers 仅去除污染源 ✓ |
| `sa4-f1-f2-f3 F2/F3`、`sa4-r4-1` | gen 重开 openTimer 无条件武装（不变）；F3 错序帧走连接级 decode 违例（不经 ns handler）✓ |
| `sa6-hardening G2.1/G3/G4`、`ac1-ac5` | BOOTSTRAP_ACK 错配（hub 既有 fatal，不变）；CLOSE 同步停接纳（保留）；open/bootstrap/round 主路径零改动 ✓ |

### 13.3 判定为不变式而非翻转的点

- 断线后 ns `disconnected` 投影、重连 re-OPEN、无 outbox（§16）：全部保持。
- `UPDATE_ACK` 与 `SYNC_APPLIED`（Step2 路径）在 drain 窗口对已接纳工作照常发送（§9.4 协议义务，非「新数据」；R1 #8 统一口径）。
- **R1（#6）登记**：hub 侧 startOpen 续体中止时 openWaiters（closing 期 reopen-waiter / opening 期合流 waiter）静默丢弃——总则 3 零 wire 优先，peer 由 openTimeout→failed→重连闭环（§11.4 裁决 (a)）；与现状一致，非回归。

### 13.4 R1 建议新增红灯锚（供 SA6 决策；对应 SA2 红线测试思路）

| 锚 | 构造 | 断言（红灯→绿灯） | 对应设计条款 |
|---|---|---|---|
| P3b | gen1 live + saveGate 悬挂 + hub CLOSE（T1 挂 drain）→ 第二 ns 注入错配 UPDATE_ACK 触发 ACK_STATE_VIOLATION 连接 fatal（blocked）→ re-add（config-change rebuild）→ gen2 live → 放行 saveGate | gen2 保持 `live`、订阅仍 function、writePeer 收敛、hub gen2 通道不被迟到帧打穿 | §D1 排队前捕获（#1）+ 身份守卫（#3） |
| C4b | live 期注入 hub→peer `CLOSE_NAMESPACE`（`reasonCode:'hub-side-close'`）→ `waitNamespace('closing')`（`closeSequence===undefined`）→ 注入 `CLOSE_OK{ackedSequence: hubCloseSeq+7}` | ACK_STATE_VIOLATION ERROR 帧 + blocked + transport 关 + close 承诺结算；**不得**到达 `closed`（silent completion 即红） | §D4（#2） |
| L1 | live + removeTarget（drop 真实 CLOSE_OK）+ 断线（closing→disconnected settle）+ advanceMs(backoff) 重连 gen2（intent removed ⇒ 不重开）+ 放行悬挂 apply + advanceMs(ackTimeoutMs×3) | 对象图投影：watchdog 无 idle timer 残留（scheduler.pending 计面或内部投影）、`channel.queuedBytes===0`、`inFlightCount===0` | §D1 身份守卫（#3） |
| W1（#5 方向） | gen1 OPEN（authorize 门闩悬挂）+ registry.open 返回 NAMESPACE_NOT_FOUND 的注入 seam + 连接静默 → 放行 | 死亡连接出站帧数冻结（framesFrozen 模式）+ observer 零新事件 | §D8.3（#5） |
| W2（#6 方向） | hub authorize 悬挂期间同 ns 二次 OPEN（合流 waiter）→ 连接静默 → 放行 | peer 侧最终经 openTimeout `failed`（裁决 (a) 固化） | §11.4（#6） |
| W3（#8 方向） | live + 在途 round（Step2 已达、apply 悬挂）→ GOAWAY RESTARTING → 放行 apply | drain 窗口内 SYNC_APPLIED 照发（决策 (a) 固化：在途 round 收尾） | §D5.4（#8） |

---

## §14. 边界条件与并发矩阵（防弹自检）

| # | 场景 | 设计处置 | 依据条款 |
|---|---|---|---|
| 1 | hub authorize 挂起期间连接静默，恢复晚于收口链（H1） | authorize 成功 → registry.open → 中止 → 回收局部 lease（恰一次事件） | §D8 D-H1 |
| 2 | 同上但恢复早于收口链（E1 复活变体） | `isOpenAborted()`（含 closing）中止于赋字/flush 前：零 OPEN_OK/bootstrap、零状态倒退 | §D8 |
| 3 | registry.open 与赋字之间 / openReplicationSession 与赋字之间收口完成 | pendingLease / pendingSession 显式回收（先 session 后 lease） | §D8.4 |
| 4 | peer hub-CLOSE 收口续体挂 drain，断线重连 gen2 建成后续体恢复（P3） | claim 排队时捕获 → 只处置 gen1 资源；跨代零 CLOSE_OK/零迁移/零字段触碰 | §D1/§D2 |
| 5 | 同一 claim 被多事件重复排队（CLOSE 续体 + stop/finalize） | session.close/release 幂等 same-promise → 恰一次兑付 | §D1/ADR-0009 L42 |
| 6 | removeTarget 在 connState 非 ready（CLOSE 抑制） | seq≤0 → 本地收口 + 立即 settle，不等 closeTimeout | §D3 |
| 7 | removeTarget 与 CLOSE_OK 竞速后错配帧到达（C4） | closing 有 closeSequence 而错配 → ACK_STATE_VIOLATION fatal；violation 结算关闭承诺 | §D4 |
| 8 | hub 发起 CLOSE（closeSequence undefined）窗口入站 CLOSE_OK（R1 #2 修正） | peer 从未发出 CLOSE_NAMESPACE ⇒ 帧按定义 unmatched → 同款 fatal（不静默完成）；该窗口收口结算由 §D2 续体承担 | §D4 |
| 9 | GOAWAY RESTARTING drain 窗口内 hub 迟发 UPDATE/RESYNC/OPEN_OK/CLOSE | 数据/同步帧静默域忽略（disconnected 入域）；CLOSE 照常履行（本端回发 CLOSE_OK）；已接纳 apply 的 UPDATE_ACK/SYNC_APPLIED 照发 | §D7/§D5.4 |
| 10 | drain 窗口内 watchdog idle 探测命中 needsResync 边沿 | 复活门：静默域零迁移零 RESYNC 帧 | §D5.3 |
| 11 | drain 窗口内 pong 超时先触发重连（D3） | dialNow 清 drain timer + goawayActive 复位；迟到 deadline 幂等 no-op | §D6 |
| 12 | gen1 处置悬挂期间 gen2 open（stuck-disposal） | gen1 处置身份守卫不命中（session2≠session1）→ 零字段/aux 触碰；gen2 open 路径重置 round/channel/watchdog/closeSequence | §D1/§D5.2 |
| 13 | 断线停留 disconnected 期间旧 open/bootstrap/reconcile/close timer 武装 | onConnectionLost/Fatal 全分支 clearAllTimers（含 removeTarget 入 closing 时） | §D5.1/§D3 |
| 14 | closing 期迟到 SYNC_APPLIED/UPDATE_ACK（R1 #8 统一口径） | drain 窗口（连接存活、epoch 未变）照发（§9.4 已接纳工作 ACK 义务）；hub 通道 closing/终态静默（迟到续体零 wire）；重连后 epoch 门拦截 | §D5.4 |
| 15 | 停机 stop() 与悬挂处置并发 | stop 的 cleanupTail 排队于悬挂任务后，barrier 语义等待已接纳槽排空（不取消） | §D1/ADR-0008 L93 |
| 16 | 错配 CLOSE_OK 在终态/失联到达 | 静默忽略（承诺已结算，§13.4 迟到纪律，不复活不二次 fatal） | §D4 |
| 17 | SA2 #1 攻击：hub-CLOSE 续体 T1 挂 drain 期间连接 fatal（他 ns 违例/GOAWAY）→ blocked → re-add 重建 gen2 → 放行后 T2（fatal 保底排队）执行 | T2 的 claim 于 fatal 同步段捕获（= gen1 资源）；runDisposal 身份守卫（`this.session===session2≠session1`）不命中 → gen2 零触碰；T1/T2 各自完成 gen1 幂等处置 | §D1（R1 #1/#3） |
| 18 | SA2 #3 泄漏面：removeTarget 后断线重连但 intent='removed' → 新代永不 open → §D5.2 重置不可达 | gen1 处置身份守卫命中（`this.session` 保持捕获值）→ 照常清字段 + watchdog/round/channel teardown——零无限期残留（watchdog idle 自重武装链终止） | §D1（R1 #3） |

---

## §15. 协议假设依据 (Protocol Assumption Evidence)

| # | 假设 | 依据类型 | 依据内容（具体引用） | 风险 |
|---|---|---|---|---|
| 1 | GOAWAY 收帧后须同步停止 OPEN/新 round（含订阅静默）；deadline 只管 transport close，处置可至 deadline（R1 #4 两层分工） | 源码引用 + 现有测试引用 | 协议 §6.3 L149「收到 GOAWAY 后停止 OPEN，不开始新 sync round；现有 namespace 到 deadline 前自然收口，之后发送方以 WS 1001 关闭」；ADR-0010 #161 修订节 L296-304「GOAWAY/blocked/连接收口**同步静默订阅先于异步 drain**」（relevant_decisions 摘录——同步层 = 订阅静默，异步层 = drain 处置，与两层分工逐字对位）；红灯 G5 契约 | 低 |
| 2 | 错配 CLOSE_OK → `ACK_STATE_VIOLATION` connection fatal（1002 + ERROR + blocked） | 源码引用 + 现有测试引用 | hub `onBootstrapAck` 错配 → `connectionFatal('ACK_STATE_VIOLATION',1002)`（hub-namespace.ts:450-456）；`onUpdateAck` violation 同款（peer-namespace.ts:482-487 / update-channel.ts:97-116）；协议 §10.2 L283 + §13.1 L351（fatal/no-retry/1002）；ADR-0010 L147；C4 契约明文「对照 hub onBootstrapAck 错配策略」 | 低 |
| 3 | peer 侧「本地主动 close(transport) 不触发本地 onClose」为测试 seam 事实（G5-③ 断言 deadline 后连接仍 `ready`） | 源码引用 | harness.ts `makeEnd.close`（L580-587）只通知对端 closeListeners；`closePeerSide/closeHubSide`（L716-729）显式补本地通知并注释「真实 WS 语义」；sa7-dynamic G1 L196-198 同款注记 | 低（seam 行为，非生产假设） |
| 4 | registry observer 以 `lease-released.remainingLeases` 观测释放（无 lease-issued） | 源码引用 | `packages/namespace-registry/src/observer.ts:27`（事件联合仅 `lease-released`）；`lease.ts:213` 发射点；H1 契约使用同 seam | 低 |
| 5 | `session.close()`/`lease.release()` 幂等 same-promise（重复处置恰一次兑付） | 源码引用（ADR 条款） | ADR-0009 L42「重复 release 返回 exact same Promise」；ADR-0010 #134 修订节 L246「幂等 same-promise；永不 reject」；relevant_decisions 注记「恰一次释放落在幂等 same-promise 机制语义上」 | 低 |
| 6 | 入站（hub→peer）CLOSE_OK 仅在响应**本端 removeTarget 发出的** CLOSE_NAMESPACE 时合法；hub 发起 CLOSE_NAMESPACE 不产生发给 peer 的 CLOSE_OK（peer 的应答是本端出站方向） | 源码引用 | **R1（#2）重写依据**：协议 §5 消息注册表 L104 的 Result 语义——CLOSE_OK 的发送方恒为 CLOSE_NAMESPACE 的**接收方**（either 方向只说明发起方可双向，不产生「hub 对自身 CLOSE 的 CLOSE_OK」）；§12 L306「Receiver…发 CLOSE_OK」；peer 全库唯一 CLOSE_NAMESPACE 发送点 = `removeTarget`（peer-namespace.ts:561，grep）；hub 侧发送点为零（hub-connection.ts:323-326 将入站 CLOSE_OK 判方向异常）；peer 对 hub 发起 CLOSE 的应答 = §D2 续体出站 CLOSE_OK | 低 |
| 7 | registry.open 对活跃 entry 可并发签发多 lease（H1/P3 中 gen2 open 与 gen1 未释放 lease 并存） | 源码引用 + 设计期实测 | ADR-0009 L42（lease 计数语义）/ CONTEXT「空闲 Runtime」条；H1 现状红灯锚② SA6 预测 remaining=2 的前提；§0.1 探针运行无拒绝 | 低 |

---

## §16. 契约改动连锁审计 (Contract Change Caller Audit)

### 改动函数/接口

| 函数/接口 | 文件 | 改动前契约 | 改动后契约 |
|---|---|---|---|
| `PeerNamespaceController.onCloseOk` | peer-namespace.ts:512 | 任意非匹配 CLOSE_OK 静默忽略（无副作用） | closing 期除「closeSequence 有值且匹配」外一切入站 CLOSE_OK（错配，或 closeSequence===undefined 即 hub 发起窗口）、或活跃态未请求 → `host.connectionFatal('ACK_STATE_VIOLATION',1002)`（R1 #2：删除初稿 undefined 例外）；终态/disconnected 静默 |
| `PeerNamespaceController.removeTarget` | peer-namespace.ts:541 | live 族一律发 CLOSE 并等 CLOSE_OK/closeTimeout | 发送被抑制（seq≤0）时本地收口 + 同步结算（不等 closeTimeoutMs） |
| `PeerNamespaceController.onConnectionLost` / `onConnectionFatal` | peer-namespace.ts:621/640 | 分支不清 timer；watchdog/round/channel 推迟且可错代 | 全分支 clearAllTimers；处置经 claim 化 cleanupResources（**排队前捕获**，R1 #1）+ 身份守卫（R1 #3） |
| `PeerNamespaceController.onConnectionQuiesce`（R1 新增方法） | peer-namespace.ts（新） | 不存在 | GOAWAY 收帧段轻量静默（摘订阅/清 timer/closing 结算/投影 disconnected；零处置排队）——§D6/§D5.1 |
| `PeerNamespaceController.closeSessionAndRelease`（私有） | peer-namespace.ts:957 | 入口捕获当前字段 + 无条件 quiesceSync | 删除；由 `runDisposal(claim)` 取代（排队前捕获 + 身份守卫） |
| `PeerNamespaceHost.isGoawayDraining`（内部接口成员） | peer-namespace.ts:52 | 声明 + 装配、零消费 | 删除（内部接口，非 index.ts 公共面） |
| `PeerConnectionImpl.onGoaway` | peer-connection.ts:398 | RESTARTING 静默推迟到 deadline 回调 | 收帧同步段**轻量**静默（quiesceControllersLite→onConnectionQuiesce）；deadline 回调全量（quiesceControllers）+ 只关 transport（R1 #4 两层分工） |
| `HubNamespaceChannel.startOpen`（私有流程） | hub-namespace.ts:222 | 恢复点仅 isTerminal 判别；中止时不回收未赋字资源 | isOpenAborted（+closing）逐点中止 + pendingLease/pendingSession 显式回收；authorize 成功后取得阶段完整执行（D-H1） |
| `HubNamespaceChannel.finishOpenSilently`（私有） | hub-namespace.ts:377 | 无参、仅回收字段 | 可选参 pendingLease/pendingSession 显式回收 |
| `HubNamespaceChannel.quiesceConnection` / `onCloseRequest` | hub-namespace.ts:574/538 | 不清 timer | 同步段 clearAllTimers |

### Caller 清单（`git grep -n` 复核）

| Caller | 文件:行号 | 是否 await | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---|---|---|---|---|
| `onCloseOk` ← dispatchReady 'CLOSE_OK' | peer-connection.ts:363-365（`withController` 包裹） | 否（同步分发） | 否 | 否（同步帧分发栈，connectionFatal 自收口） | §D4：fatal 路径经 connectionFatal（自身含 blocked 迁移 + transport close，无未捕获异常面）；静默路径无副作用 |
| `removeTarget` ← `PeerConnectionImpl.removeTarget`（公共 API） | peer-connection.ts:170-174 | 是（透传 promise） | 否 | 否 | §D3：结算语义扩展（新增抑制路径同步 resolve）；调用方（宿主/测试）对 resolve 时点无破坏性假设（红灯 C4-④ 为新契约） |
| `onConnectionLost` ← onTemporaryFailure/requestRebuild | peer-connection.ts:623-625/646-648 | 否（同步循环） | 否 | 否 | §D5.1：同步段仅清 timer/摘订阅/投影；处置排队（fire-and-forget 一律显式 `.catch(()=>undefined)`——R1 #7 纪律） |
| `onConnectionFatal` ← enterBlocked / quiesceControllers（deadline 全量） | peer-connection.ts:610-612/414-416 | 否（同步循环） | 否 | 否 | 同上 |
| `onConnectionQuiesce`（R1 新增） ← quiesceControllersLite（onGoaway 收帧段） | peer-connection.ts（§D6 新增遍历） | 否（同步循环） | 否 | 否 | 同步段无 throw 面（摘订阅经 quiesceSync——纯字段操作）；零处置排队 |
| `cleanupResources` ← finalize/onTimerFired/onConnectionStopped/onConnectionLost/onConnectionFatal | peer-namespace.ts:910/1036/657/636/647 | 混合（stop 路径 await，其余 void+.catch） | 否 | 链尾 `this.cleanupTail` 吞错（enqueueLifecycle 保留）；**返回值 run 的 rejection 只传播给显式 await 方（ensureCloseMemo body），void 调用点一律 `.catch(()=>undefined)`（R1 #7）** | §D1：`runDisposal` 任务体结构性零 throw（unsubscribe 包 try/catch、close/release 各自 `.catch`）；session.close/release 自身不 reject（ADR 修订节 L246「永不 reject」） |
| `startOpen` ← `onOpenNamespace`（新通道） | hub-connection.ts:344-355 | 否（void IIFE） | 续体内逐段 try/catch（既有+扩展） | IIFE 内 return | §D8：全部 await 点 try/catch 或 guarded；中止路径零 throw |
| `finishOpenSilently` ← startOpen 各中止点 | hub-namespace.ts（§D8.3 各 guard） | 否 | 内部 `.catch(()=>undefined)` | — | 回收异常吞没于幂等 release（既有 releaseLeaseOrNoop 同款，peer-namespace.ts:923-927） |
| `quiesceConnection` ← close()/connectionFatal/onSequenceExhausted/cleanupAll | hub-connection.ts:186/410/455/387/391 | 否（同步） | 否 | 否 | clearAllTimers 幂等零异常 |
| `onGoaway` ← dispatchReady 'GOAWAY' | peer-connection.ts:375-377 | 否（同步） | 否 | 否 | quiesceControllers 同步段无 throw 面 |

### 风险评估

- 遗漏 caller 的代价：`onCloseOk` 的 fatal 副作用若在有未列 caller 的分发路径上触发，最坏为连接收口（其本身即设计语义）；所有新副作用路径都收敛到 `connectionFatal`/`enqueueLifecycle` 两个既有收口点，无新浮游 promise。
- 抓全方法：`git grep -n "\bonCloseOk\b\|\bonConnectionLost\b\|\bonConnectionFatal\b\|\bcleanupResources\b\|\bcloseSessionAndRelease\b\|\bfinishOpenSilently\b\|\bquiesceConnection\b\|\bonGoaway\b\|isGoawayDraining" -- 'packages/ws-replication/src/**/*.ts'`——全部命中已列于上表。

---

## §17. 文件清单（File Scope）

### ALLOW LIST

- `packages/ws-replication/src/peer-namespace.ts` — 修改，§D1（CleanupClaim（R1 无 epoch）/enqueueLifecycle/runDisposal 身份守卫（R1 #1/#3））、§D2（onCloseRequest 重写）、§D3（removeTarget/ensureCloseMemo）、§D4（onCloseOk，R1 #2 删例外）、§D5.1（onConnectionLost/onConnectionFatal/onConnectionQuiesce 两层（R1 #4））、§D5.3（onWatchdogEdge 复活门）、§D5.2（新代 aux 重置）、§D5.4（peer applyStep2 零改动——决策 (a)，仅注释钉死）、§D7（isInboundQuiet 逐 handler）、接口删 isGoawayDraining（估 −90/+140 行）
- `packages/ws-replication/src/peer-connection.ts` — 修改，§D6（onGoaway 轻量/全量两层 + quiesceControllersLite 新增 + deadline 全量+只关 transport（R1 #4））+ isGoawayDraining 装配删除（估 −6/+10 行）
- `packages/ws-replication/src/hub-namespace.ts` — 修改，§D8（isOpenAborted/startOpen 各恢复点含取得后失败出口中止判别（R1 #5）/finishOpenSilently 显式回收+waiter 裁决 (a)（R1 #6）/hub applyStep2 isQuietState 门）、§D8.5（quiesceConnection/onCloseRequest clearAllTimers）、§D9（死字段 cleanupTail 删除）（估 −20/+60 行）
- `packages/ws-replication/src/lifecycle-queue.ts` — 修改，仅模块头注释更新为 §D9 权威裁决（零代码改动）
- `packages/ws-replication/test/ws-replication-sa6-hardening-g1-g2-red.test.ts` — `[SA6 owned]` 修改，AC3b 断言翻转（§13.1：closeSettled false→true + violation 收口锚；G2.1 不动）。SA3 可调测试基建但不得替改断言语义
- `packages/ws-replication/test/ws-replication-issue171-red.test.ts` — `[SA6 owned]` 既有红灯契约文件，本任务绿灯目标（四锚转绿时如需零断言性微调——仅限注释/锚描述勘误，SA6 执行；预期无改动）。§13.4 P3b/C4b/L1/W1/W2/W3 为 SA6 决策项（如采纳则同文件或新文件，SA6 owned）

### DENY LIST

- `docs/protocols/instance-replication-v1.md` — wire 契约零变更（无新码/无字段/无时序表改动；本设计是对 §6.3/§12/§13.1 既有规定的落实）
- `packages/replication-protocol/**` — codec 层零触碰
- `packages/namespace-registry/**` — lease/session 语义层零触碰（observer/幂等 release 均为消费侧）
- `packages/ws-replication/src/index.ts` — 公共导出面零变更（isGoawayDraining 为内部接口成员）
- `packages/ws-replication/src/{hub-connection,update-channel,round-engine,fence-watchdog,backpressure,frame-io,error-mapping,defaults,validate,types,testing,liveness}.ts` — 本任务不改（hub-connection 的 quiesce 调用面已核对为兼容）
- `packages/ws-replication/test/` 其余全部测试文件 — 既有绿灯锚预期全绿（§13.2）；如 SA7 动态轮发现非预期翻转，须回到 SA1 修订设计而非就地改测试

---

## §18. 验收对照（AC × 设计条款）

| AC | 条款 | 验证面 |
|---|---|---|
| AC1 迟到续体不复活/不清新代 | §D1（排队前捕获+身份守卫）/§D2/§D5.2/§D8 | H1、P3 红灯四锚 + §13.4 P3b + 既有 B-1/B-2 族回归 |
| AC2 lease/session 恰一次释放、零泄漏（含新代永不 open 路径） | §D1（claim+幂等+身份守卫）/§D8.4 | H1-①②（observer 计数）+ §13.4 L1 + D5/E5 族回归 |
| AC3 CLOSE 未上线不等 closeTimeout | §D3 | C4 配套（构造性：sendControl 非 ready 返 0 的既有事实 peer-connection.ts:461-469）|
| AC4 错配 CLOSE_OK 显式收口（no silent completion，含 hub 发起 closing 窗口） | §D4 | C4 四锚 + §13.4 C4b + AC3b 翻转（§13.1） |
| AC5 GOAWAY 同步停新数据、deadline 只关 transport | §D6（轻量/全量两层）/§D7/§D5.3 | G5 三锚 + G1/D3/D5/D5B1/R3-5 回归（D5 计面逐值不变，§13.2） |
| AC6 typecheck / vitest --typecheck / git diff --check | 内部接口变更无公共面 | `pnpm run typecheck`、`pnpm exec vitest run packages/ws-replication --typecheck` |

---

## SA2 反馈逐条回应（R1）

> 评审文件：`task_issue-171_sa2_review.md`（verdict: reject；2 CRITICAL + 2 MAJOR + 4 MINOR）。逐条落实如下——每条均有**伪代码/规则实质改动**（非仅注释承认）；「已验证为成立的设计要点」八项（H1/D-H1、C4 链、G5 链、AC3 抑制路径、P3 主路径、死抽象清理、goawayActive 门）未回退。

| # | SA2 要求（严重度） | 是否落实 | 修订位置 | 修订内容摘要 |
|---|---|---|---|---|
| 1 | `cleanupResources` claim 在任务 lambda 内求值 = 执行期捕获，可杀新代；改为排队前捕获；§4.2 表与代码对齐；裁决 Lost/Fatal closing 分支排队不对称（CRITICAL） | ✅ | §4.1 `cleanupResources` 伪代码 + 注释；§4.2 表 + 不对称裁决段 | `const claim = this.claimForDisposal();` 移至 lambda **外**（caller 同步栈求值），注释载明 SA2 #1 攻击路径与封死机制；§4.2 表「捕获时点」列逐行改写为求值位置；不对称裁决 = **有意保底**（不变量 I-C：closing 的仅有入口均在同步段排队带 claim 处置 → Lost 侧无需重复；Fatal 侧保底防未来入口遗漏），零副作用前提明文 = 排队前捕获 + 幂等兑付 |
| 2 | 删除 `onCloseOk` 的 `closeSequence===undefined` 接受例外（协议上不可合法关联，silent completion 复活）；修正 §15#6 依据与 §D4/§D7 矛盾注释（CRITICAL） | ✅ | §7 全节重写；§2 RC5 行；§15#6；§D7 表 onCloseRequest 行 + ACK 例外段 | closing 期除「有值且匹配」外**一律** `connectionFatal('ACK_STATE_VIOLATION',1002)`；删除例外分支与「SA1 补充例外」段；依据重写 = §5 L104 Result 语义（CLOSE_OK 发送方恒为 CLOSE_NAMESPACE 接收方）+ peer 唯一发送点 removeTarget + hub 侧零发送（hub-connection.ts:323-326 判方向异常）；该窗口收口结算归 §D2 续体（fatal 后经非 ready 门零出站完成 closed+settle）；§D7 表区分入站 CLOSE_OK（fatal）与本端出站 CLOSE_OK（hub 发起 CLOSE 的应答，§D2） |
| 3 | epoch 守卫在「新代永不 open」（intent removed/终态）路径留下 watchdog/channel 永久泄漏；改身份守卫或补兜底（MAJOR） | ✅ | §4.1 `runDisposal` 伪代码 + 注释；`CleanupClaim` 删 epoch 字段 | 守卫改为 `this.session === claim.session`（自捕获以来未建新 session ⇒ aux 归本代，与代际无关）；注释逐点论证 P3（session2 建成 → 跳过 ✓）与泄漏面（openActiveTargets 跳过 → this.session 保持捕获值 → 照常 teardown ✓，引 fence-watchdog.ts:56-66 自重武装）；session 不复用 ⇒「先不等后复等」不可达，判据健全；epoch 判别仅保留于 §D2 续体 wire 门（独立局部变量） |
| 4 | D5 绿灯论证前提错误（现状处置在 deadline、设计移到收帧段）；须重推 D5/D5B1 四检查点精确 timer 账目，翻转则登记 §13.1（MAJOR） | ✅ | §9（§D6）重写为轻量/全量两层；§8.1 新增 `onConnectionQuiesce`；§13.2 D5 行精确重推 | **结构性消除翻转风险**：收帧段 = 轻量层（onConnectionQuiesce：摘订阅/清 timer/投影，**零处置排队**）→ 收帧段唯一 delta = +drain（live 态 ns timer 为零、watchdog/lease 不动）→ L544 `toBe(pausedPending+1)` 逐值不变；处置（watchdog teardown/lease release/registry idle 计面）保持在 **deadline 回调全量层**——与现状同点同款 → L552/L557 不变；D5B1（SHUTTING_DOWN 收帧即全量）现状即如此不变；四检查点账目逐项列于 §13.2；初稿错误论证（「watchdog 由处置段清——时点不变」的全量收帧静默版本）已撤回 |
| 5 | startOpen 取得后失败分支（!opened.ok / getStatus throw / REPLICATION_*_MISMATCH）未标 `isOpenAborted()` 先行判别，中止态会补发 ERROR（MINOR） | ✅ | §11.3 伪代码补齐 + R1（#5）规则行 | registry.open 之后**每一个失败出口**两行式：`if (this.isOpenAborted()) { this.finishOpenSilently(已取得资源); return; }` → 既有 finishOpenError；伪代码显式覆盖 !opened.ok / getStatus catch / replication disabled / identity+mode mismatch / sessionResult.ok 五处 |
| 6 | finishOpenSilently 整体静默丢弃 openWaiters 须二选一裁决，不得留白（MINOR） | ✅ | §11.4 新增裁决段（决策 (a)）；§13.3 登记 | 裁决 (a) 维持静默丢弃：总则 3 零 wire 优先（中止 = 通道已静默）+ 对端恢复路径明确（openTimeout→failed→重连后按 §7 L166 收 reopen 错误——「每个请求收到应答」在连接存活窗口成立）+ 与现状一致非回归 |
| 7 | `enqueueLifecycle` fire-and-forget 返回值 rejection 未contained；「单一权威」原语应自带吞错语义（MINOR） | ✅ | §4.1 enqueueLifecycle 注释；§D2/§D3/§D5.1 全部 `void` 调用点显式 `.catch(()=>undefined)`；§16 caller 表 cleanupResources 行改写 | 双层纪律：任务体结构性零 throw（runDisposal 的 unsubscribe 包 try/catch、close/release 各自 `.catch`）+ void 调用点显式 `.catch(()=>undefined)`；返回值 rejection 语义只传播给显式 await 方（ensureCloseMemo body）；链尾吞错保留 |
| 8 | drain 窗口 SYNC_APPLIED 抑制 vs UPDATE_ACK 放行非对称且理由错误（「消耗死连接出站序列」与连接存活事实相反）（MINOR） | ✅ | §8.4（§D5.4）重写（决策 (a)）；§D7 ACK 例外段统一口径；§14 行 14 | 裁决 (a)：peer 维持**既有 epoch 门零改动**——drain 窗口（连接存活、epoch 未变）SYNC_APPLIED 照发（§9.4「已接纳 update 正常 apply/ACK」同款义务，完成在途 round 收尾；B-1 守卫防 disconnected 复活）；hub 侧补 `isQuietState` 门（理由修正 = 通道已静默的迟到续体零 wire，非「死连接序列」）；初稿错误理由撤回并载明 |

**一致性自检（R1 后全文矛盾模式扫描）**：`grep -n "closeSequence===undefined\|epoch 守卫\|isInboundQuietState()" <file>` ——例外分支全部消除（仅存于 R1 修订记录与回应表的「已删除」描述）；`runDisposal` 守卫唯一形态 = 身份守卫；peer applyStep2 门 = 既有 epoch 门（`isInboundQuietState` 伪标识已随 #8 裁决移除）。§D7 表/§13.2/§14/§15/§16/§17/§18 与正文交叉引用已同步（§D5.2=aux 重置、§D5.3=复活门、§D5.4=SYNC_APPLIED 门）。
