# SA4 静态验尸报告

**Date**: 2026-08-30
**Verdict**: pass
**被审对象**: SA3 实现 commit `739e1bb`（fix(ws-replication): 实现真实 GOAWAY drain 窗口与关闭时序，issue #174）
**比对基准**: SA1 R2 设计（`task_issue-174-goaway-drain_design.md`）、SA2 R2 verdict pass（`_sa2_review.md` §11 四路径/四消费点比对基准）、SA6 红灯契约（简报 §SA6 + `ws-replication-issue174-goaway-drain-red.test.ts`）、SA8 约束清单（`_relevant_decisions.md`）

---

## 审核结论

1. **设计一致性：✅ 一致（§4.1–§4.7 逐条比对零偏离）**
   - §4.1 `shutdownWithGoaway`（hub-connection.ts:333-367）：双门重入防御 `closedFlag||drainActive`（:337，R2-M6）✓；handshaking 分支原样保留不发 GOAWAY（:338-341，SA5 论证/简报明令）✓；drainTail 结算闸先于一切武装（:344 resolve-only → `drainActive=true` → `state='draining'` → GOAWAY 直发，与设计伪代码序完全一致）✓；GOAWAY 发送失败 catch → `finishDrain()` 真降级响亮收口（:353-356）✓；注入 timer deadline=drainMs（:360-363）✓；提前完成初检（:366）✓。
   - §4.2 `dispatchReady` 前置门（:493-511）：窗口内 `OPEN_NAMESPACE` → `sendControlChecked(namespaceErrorFrame('NAMESPACE_REOPEN_REQUIRES_RECONNECT', nsId, sequence))` 显式拒绝（零授权/零建道/不杀连接，`namespaceErrorFrame` 三参签名与 frame-io.ts:45 一致）；`SYNC_STEP1` 无响应丢弃；其余帧照常分发。与处置矩阵 D1-D9 一致。
   - §4.3 提前完成观测：`HubChannelHost.onChannelSettled` 接口新增（hub-namespace.ts:66-68）+ `settledNotified` 记忆位（:98）+ `notifySettled()`（:845-849）+ 三入口函数尾部无条件调用——`finishOpenError` 尾部（:382，守卫跳过分支同样到达，R2-M5）✓、`onCloseRequest` closeQueue 尾部（:568，CLOSE_OK 上 wire + setState('closed') 之后，时序正确）✓、`finalize` 尾部（:841）✓。终态 setState 点独立枚举恰 4 处（:377/:561/:609/:837），第 4 处 `onConnectionClosed`(:609) 免通知——调用图推导经独立验证：cleanupAll 四调用方全部先置 closedFlag（close:318→326 / onTransportClosed:613→617 / connectionFatal:650→656 / onSequenceExhausted:698→700）✓。连接侧 `maybeFinishDrainEarly`（hub-connection.ts:382-389）首行双闸（`!drainActive || closedFlag`）保留防御纵深 ✓。
   - §4.4 `finishDrain`（:393-397）：幂等合流（`closedFlag||!drainActive` 早退）+ `clearDrainHandles()` + 复用既有 `close(1001,'hub-shutdown')`，deadline fire 不检查任何 channel/apply 状态（AC4）✓。
   - §4.5 `settle()`（:377-379）：`return this.drainTail ?? this.settleTail;` 与设计逐字一致；`HubReplicationImpl.close()`（:218-228）零改动 ✓（SA5「settle 聚合面不变」约束保持）。
   - §4.6 四路径互锁：`clearDrainHandles()` 单点（:400-406）被 close（:320，同步段首部）/ onTransportClosed（:615，既有体前）/ connectionFatal（:640，teardown 前）/ onSequenceExhausted（:693，teardown 前）四路径全调用 ✓；`close()` state `'draining'`→`'closed'` FSM 对齐（:319）✓；窗口期公共 close = force-close 逃生舱语义 ✓；`cleanupAll` 尾部 finally 释放 drainDone（:630-635）——清理异常也绝不悬挂 close Promise ✓。
   - §4.7 码型：`NAMESPACE_REOPEN_REQUIRES_RECONNECT`（retryable=reconnect、非 fatal-指控）采纳理由成立，零新 wire 码。
   - 协议对齐（`instance-replication-v1.md` 原文核对）：§6.3「收到 GOAWAY 后停止 OPEN，不开始新 sync round；现有 namespace 到 deadline 前自然收口，之后发送方以 WS 1001 关闭」逐句有实现面；§15.2 hub FSM `ready→draining→closed` 的 `draining` 首次真实驻留；§21 停机顺序（停止接纳+GOAWAY → 排空已接纳 apply → session close/lease release）在自然收口路径（CLOSE→drainPendingApplies→session close→lease release→CLOSE_OK→closed→1001）与 deadline 路径（1001 硬顶网络域 + cleanupAll 无 deadline 排空 Runtime 域，ADR-0008 L93/ADR-0010 L179 两域分离）均保持。
   - 改动量与设计估算同数量级（实际 +113/−14 与 +21/−0 vs 估算 +95/−25 与 +18/−0）；peer 侧零改动；零 wire/契约/配置变化。

2. **SA6 所有权核验（总控指令专项）：✅ 通过**
   - **SA3 提交不含 SA6 owned auth-lifecycle 测试**：`git show 739e1bb --name-only` = 恰 3 文件（hub-connection.ts / hub-namespace.ts / issue174 红灯测试），`ws-replication-auth-lifecycle-red.test.ts` 不在其中（该文件最后一次被提交是上游 issue #138 的 `01e6801`）——SA2 R2 可观测验证点 ③ 成立。
   - **工作区 +2 行 = SA6 §6.2.1 适配逐字一致**：`git diff --numstat` = `+2/-0`；插入内容与设计 §6.2.1/简报登记的两行（`await run.hubNode.scheduler.advanceBy(CONTRACT_TIMEOUTS.closeTimeoutMs);` + `await settle();`）逐字符一致，插入点在 `await closePromise` 前、GOAWAY 断言后，既有断言零改动（dispatch log：SA6 于 06:13-06:22 完成，先于 SA4 门禁；SA3 提交时间序与其无交叠）。
   - **红灯契约未被 SA3 弱化**（基线复红取证，见下节证据 4）：提交版测试在基线实现上的失败签名与 SA6 在简报中登记的红灯验证结果**逐字一致**——`4 failed (4)`，全部失败在 R1@85 / R2@125 / R3@164 / R4@228 首条 `expect(run.wire.hubSideClosed).toBe(false)` 实测 `true`；断言锚与简报契约表（R1-R4 四行）逐条对应；文件 git 历史单一提交 739e1bb（SA6 工作区原稿由 SA3 提交携带，内容行为等价性成立）。

3. **读写路径一致性：✅ 一致**（本修复为时序/协议修复，无数据源变更；settle 链写读同源——`drainTail` 在 `HubReplicationImpl.close()` 同步栈内先武装后 `map settle()` 消费，无竞态窗口）

4. **静默失败：✅ 无新增**。窗口内 `SYNC_STEP1` 丢弃是 §6.3 义务的履约（SA2 R1 已独立复核：round-engine 两分支（新 round 响应/重复违例 finalize）均破坏 R3 红线，丢弃是唯一满足契约的处置）；OPEN 拒绝显式 ERROR；GOAWAY 失败响亮收口；deadline 后迟到帧零投递零异常（R1 显式断言 `rejections.events === []` + 零响应帧 + 零 CLOSE_OK）。

5. **降级方案：✅ 安全**。GOAWAY 发送失败 → `finishDrain()` 是真降级（framing 不可信 = 外部故障域，对齐 ADR-0010 L165 连接级错误关闭整条连接），非静默回退；deadline 硬顶不等待网络 ACK（AC4）；已接纳 apply 槽无 deadline 不取消（ADR-0008 L93）——两等待域不混同不互相豁免。无 `if (!x) return fallback` 形态。

6. **极端攻击：✅ 安全（2 条 NOTE 级残留，均非阻塞、登记 SA7）**
   - 重入：双门防御 ✓（窗口期二次 `shutdownWithGoaway` 早退，drainTail 零覆盖）。
   - 窗口内新建 channel 竞态：不存在——`onOpenNamespace` 是唯一建道点且被前置门拦截，channels 映射在窗口内只减不增，`maybeFinishDrainEarly` 的遍历-收口在同一同步段内无竞态。
   - drainMs=0 / 手工 close 逃生舱 / 窗口期 revoke（channel 终态化计入提前完成）/ 窗口期 fatal（clearDrainHandles 路径 3）/ peer 抢先关（路径 2）——均有明确处置且幂等。
   - **NOTE-A（理论不可达）**：若 `outbound.sendControl(GOAWAY)` 内部触发序列耗尽回调（需单连接 2^32 出站帧），`onSequenceExhausted` 会在 shutdownWithGoaway 自己的同步段内置 closedFlag，方法继续武装 drainDeadline——fire 回调经 `finishDrain` 首行早退零行为影响，句柄至 fire 自清（≤drainMs 有界）。与设计伪代码同构（设计 §4.1 未枚举该交叠），非实现偏离。
   - **NOTE-B**：`cleanupAll` 的 try/finally 从 `settleTail` 赋值开始，前置语句（quiesce 循环/stopLiveness/摘监听/onConnectionClosed map）在 try 外——若其中某句同步抛错 drainDone 会悬挂；与设计 §4.6 伪代码放置完全一致，且这些语句为内部状态变更（无现实 throw 路径），`void cleanupAll()` 的拒绝形态是既有行为非本次引入。

7. **架构评估：✅ 可行**。无死胡同信号：零硬编码绕过、零 FIXME、未触及超出 Bug 影响面的模块（DENY LIST 全部未触碰：peer-connection/peer-namespace/frame-io/round-engine/defaults/replication-protocol/docs/ADR/namespace-registry/persistence/apps 均零 diff）。

8. **过度设计：✅ 精简**。4 个私有字段 + 4 个小私有方法 + 1 个包内通知面，无投机抽象；变更半径 = 设计 ALLOW LIST 精确集合。

### 流水线门禁附加项

- **§1.1 Scope Creep Guard：✅**。SA3 diff（0df6583..739e1bb）= 3 文件全部落在 ALLOW LIST；DENY LIST 零命中；黑名单（package-lock.json/yarn.lock/.DS_Store/TASK.md/*.bak）零命中。工作区未提交改动 = wiki 档案（白名单 `^wiki/raw/task_` + `bug-` 模式）+ SA6 owned auth-lifecycle +2 行（§6.2.1 授权，不属于 SA3 提交）。注：分支对 `origin/docs/phase-5-websocket-replication` 的全量 diff 含上游 issue #138 任务的既有提交（01e6801..f0fc191/0df6583，已归档任务），非本任务范围。
- **§1.3/§1.4 测试触发性：✅**。无 .spec.ts；新增 `.test.ts` 落在根 `vitest.config.ts` include `packages/*/test/**/*.test.ts` 内，CI（ci.yml `test` job，Node 20/24 矩阵）`pnpm test` = `vitest run --typecheck` 收集之——无孤儿测试。
- **§1.5 协议假设：✅**。设计 §10 P1-P7 章节齐全且依据可定位；P2（fake scheduler `at<=deadline` 边界 fire）/P3（控制帧同步上 wire、GOAWAY 先于 close 事件）经本次红灯契约 4/4 绿与 D4 真实 TCP 5.1s 窗口实证。
- **§1.6 契约改动连锁：✅**。`shutdownWithGoaway`（同步收口→异步窗口）全仓唯一生产 caller = `HubReplicationImpl.close()`（hub-connection.ts:222，同步 void 调用，方法内 GOAWAY 已包 try/catch 不抛）；`settle()` 唯一 caller = :225 Promise.all 聚合；`close()` state 改值观察方独立 grep 证实仅 issue137-r2:265 与 review-revisions:576-579（均在 fatal/exhaustion 路径，本就 'closed'）；`hub.close()` 测试域消费点 4 处（sa7-r1:312/:503、sa7-r2:363、auth-lifecycle:385/:393）与设计 §6.1/§11 比对基准一致；`apps/**` 对 HubConnection 零引用。无 uncaught rippling。
- **§1.7 源码 grep 断言禁令：✅**。红灯测试零 `readFileSync`、零源码字符串断言；全部锚在 wire 帧/transport 关闭观测/连接状态/持久化生效（saveEvents/rootValue）；driver/harness seam（hubFramesAll/injectPeer/wire.hubSideClosed/saveGate/settleUntil）为纯观测设施且未被 SA3 改动。

### 验证证据（SA4 独立执行）

| # | 命令 | 结果 |
|---|---|---|
| 1 | `npx vitest run packages/ws-replication/test/ws-replication-issue174-goaway-drain-red.test.ts`（HEAD=739e1bb） | `Test Files 1 passed (1)` / `Tests 4 passed (4)` / `Type Errors: no errors` / exit 0 |
| 2 | `npx vitest run packages/ws-replication`（含 SA6 +2 行适配的工作区） | `Test Files 25 passed (25)` / `Tests 179 passed (179)` / `Type Errors: no errors` / exit 0 / 10.08s；其中 auth-lifecycle 15/15、D4 真实 TCP 5117ms（GOAWAY→close 次序锚在真实 5s 间隔下保持绿） |
| 3 | `npx tsc -p packages/ws-replication/tsconfig.json` | exit 0（零错误） |
| 4 | **基线复红取证**：`git checkout 0df6583 -- <两个 src 文件>` → 跑红灯契约 → `git checkout HEAD --` 恢复 | 基线上 `Tests 4 failed (4)`，失败点 = R1@85/R2@125/R3@164/R4@228 `expect(run.wire.hubSideClosed).toBe(false)` `expected true to be false`——与 SA6 简报登记的红灯验证结果逐字一致；恢复后 sha256sum -c OK、git status 与交换前逐字节一致（仅余 SA6 auth-lifecycle M + wiki 未跟踪档案） |
| 5 | `git show 739e1bb --name-only` / `git diff --numstat <auth-lifecycle>` | SA3 提交零含 auth-lifecycle；工作区 diff 恰 `+2/-0` |

## 动态审核重点（交 SA7）

1. **vitest 退出时长无 +5s 尾巴**（SA2 红线 #4 / 设计 §6.1 残余边界）：sa7-r1 / sa7-r2 afterAll 若 peer.stop 超 3s race 兜底先行 → drain timer 残留 → 进程退出尾部最多 +closeTimeoutMs。静态推演正常路径零残留（destroy/peer.stop 先行 → 连接已 closedFlag → shutdownWithGoaway 首行早退）；需活链路观测（本次全量 10.08s 无异常尾巴，供参考）。
2. **drain 期 fatal 后 timer 计面回归**（SA2 红线 #1）：boot → hub.close() 窗口开启 → injectPeer 错序帧触发 SEQUENCE_VIOLATION fatal → 断言 `hubNode.scheduler.pending()` 回落（drainDeadline 已清）+ closePromise 正常结算。静态实现已见 `connectionFatal` :640 `clearDrainHandles()`，但该守卫**无现成测试锚**（SA6 契约 4 it 未覆盖此变体；非 AC 缺口——登记为 SA7 动态验证或后续加固项）。
3. **R4 变体——apply 越过 deadline**：saveGate 保持悬挂越过 deadline → transport 应在 deadline 1001 关闭（网络域硬顶）而 hub.close() Promise 等 apply 排空后才结算（Runtime 域 barrier，设计 §5 推论）。R4 只测了门内释放场景；动态确认两域独立结算时点。
4. **shutdownWithGoaway 重入**（SA2 红线 #3，可选）：双门静态已见（:337）；生产无重入路径（唯一调用点受 closed 门），动态可选验证。
5. **生产 Host 停机时长变化**（设计 §12-1 如实申报，非缺陷）：hub.close() 从「立即」变为 ≤closeTimeoutMs（缺省 5s）+ apply 尾长——部署侧确认可接受，必要时经既有 `timeouts.closeTimeoutMs` 调节。

## 结论

**pass**。SA3 实现与 SA1 R2 设计 §4.1-§4.7 逐条吻合、SA2 R2 比对基准（四路径/四消费点）完整落地、SA6 红灯契约 4/4 转绿且经基线复红取证确认未被弱化、175 既有基线全绿（含 SA6 §6.2.1 +2 行适配后的 AC-6 全断言原值）、typecheck 零错误、SA6 所有权边界零越界（SA3 提交不含 auth-lifecycle 文件）。SA7 可进入动态验证。
