# SA4 静态验尸报告 — `@nomicore/ws-replication`（issue #136 切片 6，Phase 3）

**Date**: 2026-08-30（R1 / R2 / R3 / R4 复审 / R5 增量——R4-1/R4-2/R4-3 回流修复核对，见文末「SA4 R5 复审节」）
**Verdict（当前，R5）**: **pass** —— R4 reject 的三条回流项（12258c2：导入/session-open 续体 epoch 判别补全 + unsubscribe 句柄归属收进身份守卫）全部治本：R4 两条执行证据同源复现翻绿、SA6 R4-1 与 SA7 D2 红灯独立转绿、全量 165 文件/1953 IT + typecheck + diff-check 全绿；唯一残留（onCloseRequest CLOSE_OK epoch）v1 结构性不可达，登记切片 9。**审查链闭环：R1 reject → R2 pass → R3 pass → R4 reject → R5 pass（14 项自有发现全部收口）。R1–R4 各节原样保留于下/文末。**

**R1 Verdict（历史，保留）**: **reject**（3 条已获执行证据的设计偏离，修复面窄、方向明确；无需 needs-redesign——架构本身成立）

- **被审实现**: `packages/ws-replication`（commit 24642a9 实现 + 0cd1ae6 CI 接线 + 4333593 SA6 测试对齐；基线 `ff50d47..HEAD`，36 文件 +9019/−1）
- **设计定稿**: `task_phase5-ws-namespace-sync_design.md`（R4，915 行）+ `task_phase5-ws-namespace-sync_relevant_decisions.md`
- **SA2 评审**: R3 pass（附 3 条 SA3 实现注记——本轮逐条核验，见 §SA2 注记核验）
- **验证基线复核**: 本轮独立进程复跑 `pnpm exec vitest run packages/ws-replication` → **8 文件 / 67 测试全绿，exit 0**（/tmp/sa4-vitest.log）；`pnpm typecheck` → **exit 0**（枚举含 `packages/ws-replication/tsconfig.json`，/tmp/sa4-tc2.log）。绿灯属实——但绿灯之下存在 3 处冻结测试未覆盖的设计偏离（证据见下）。

---

## 审核结论

1. **设计一致性**: ❌ 偏离——3 条阻塞项（F1/F2/F3，均有执行证据）+ 4 条次要偏离（F5/F6/F7/F9）+ 1 条范围越界（F8，须 SA1 补勘误）。架构、模块分解（§3 十五文件逐一对应）、OPEN 矩阵（§7）、bootstrap 流水线（§8）、round 引擎（§9）、UPDATE 通道（§10）、错误映射三层（§11）、one-shot 终结器（§12.2）、removeTarget 七行矩阵（§13.1）、roundId per-target 持久（§14.2）、构造期校验（§15.1）均与设计对齐。
2. **读写路径一致性**: ✅ 一致——一切远端 apply 经 `session.applyRemoteUpdate()`（唯一 write sequencer + 槽内 dirty，`pendingApplies` 登记 → ACK 后置于 resolve，I-3 时序锚成立）；本地读取/编码经 session 窄能力（`encodeStateVector`/`encodeDiff`/`subscribeOwnedUpdates`）；transport 全程未接触裸 Y.Doc（peer 侧唯一 `new Y.Doc()` 是 §8 明文规定的 detached bootstrap 预演）。
3. **静默失败**: ❌ 发现——**F1**（hub 侧任何溢出面零 wire 信号 → 恢复 round 无触发面 → 持续性单向发散，执行证据 R-D）；**F3 附带**（closing 窗口序列违例静默放行）。
4. **降级方案**: ✅ 安全——degraded 判别表单点（`degradedDiscriminator`，lifecycle/fatal 旁证，不解析 message）；peer degraded bypass 完全由 session 层承载（本包零分支）；§5.2 disabled 副本地响亮 failed（拒绝虚假降级）✓。无新增不当降级。
5. **极端攻击**: ❌ 发现——**F3**（closing 窗口任意错序/重复帧被接纳且 `expectedSeq` 被注入帧改写——序列纪律可被远端在 closing 窗口内任意去同步）；F4（超限本地 update → `inFlight` 幽灵登记 seq 0 → ackTimeout 伪 needs-resync）。
6. **错误处理**: ⚠️ 缺口——async seam 收编面完整（authorize/registry.open/importReplica/openReplicationSession/applyRemoteUpdate 的 rejection + encode* 同步 throw 全部经 error-mapping 单点，⑥/⑧a/⑧b 绿灯佐证零 unhandled rejection）；缺口为 F5（uint32 耗尽设计的响亮 close(1008) 未实现，实际静默丢帧）与 F1（hub 溢出无信号）。
7. **架构评估**: ✅ 可行——分层（frame-io/lifecycle-queue/round-engine/update-channel/fence-watchdog/error-mapping/peer-*/hub-*）与设计 §3 精确对应，无绕过式硬编码、无 FIXME 堆积；不建议退回 SA1 重设计（F1 的一半成因是设计 §12「hub 侧等待」与 §10.2/§18.4「hub 同机制声明」的内部张力，见 F1 处置建议）。
8. **过度设计**: ✅ 精简为主，两处赘余——`OutboundQueue` 的 dataQueues/round-robin 机制从未被喂入（`sendData` 直发旁路，F6）；`hub-namespace.armTimer('close')` 无调用点（死配置）；peer-namespace `finalize('failed')` 空 if 块、`onRemoteOpen` 空 if 块（化妆性死代码）。

---

## 阻塞项（REJECT 依据，均有执行证据）

### F1（MAJOR）hub 侧溢出零 `RESYNC_REQUIRED` —— 恢复 round 无触发面，持续性单向发散

- **静态证据**: `RESYNC_REQUIRED` 帧的全部发送点仅在 peer 侧（`grep -rn "kind: 'RESYNC_REQUIRED'" src/` → `peer-namespace.ts:624`〔§10.2 溢出声明〕、`:638`〔§12 session 溢出边沿〕）。hub 侧对应路径 `hub-namespace.ts` `onLocalResyncEdge()`（:597-600，注释自认「不自己声明 RESYNC 帧」）与 `onWatchdogEdge('needsResync')`（:565-567，仅 `markSessionResyncEdge` + 置 needs-resync）均只改状态、零 wire 帧。
- **设计依据**: §10.2 溢出动作表「丢弃全部 queued；置 needsResync；**发 RESYNC_REQUIRED**{reasonCode:'send-queue-overflow'}（本端声明）」；§18.4「hub 溢出同机制（协议 §9.4『任一端可声明』，hub 溢出同机制）」。协议 §9.4 的「任一端可声明」正是 hub 侧让 peer 得知、从而发起恢复 round（round 恒由 peer 发起）的唯一通路。
- **执行证据（R-D，临时复现测试，跑毕已删）**: `maxInFlightUpdates:1, maxQueuedUpdateCount:1`，悬挂 peer saveGate（hub in-flight 不收口）→ hub 连写两笔 → 第二笔溢出 → `expect(run.hubFrames('RESYNC_REQUIRED').length).toBeGreaterThanOrEqual(1)` **FAIL：实际 0**；释放 gate 后 hub root `extra=5` / peer root `extra=77` 永久发散，peer 投影恒 `live`、无任何恢复 round。
- **影响**: hub→peer 方向任何溢出（channel live 溢出 / session fanout 容量 16 溢出边沿）后，hub 通道停发、peer 不知情、恢复 round（peer 唯一发起）永不启动——直至连接偶然重建。最终一致性承诺被静默打破，且无任何可观察信号（典型静默失败）。
- **处置（回流）**: **SA3**——hub 侧两个溢出路径补发 `RESYNC_REQUIRED`（peer 收到后按既有 §10.6 路径收敛，机制已就绪）；**SA1**——勘误 §12「命中分派」hub 分支与 §10.2/§18.4 的张力（明确「hub 命中 = 声明 + 等待」）；**SA6**——补 SA2 红灯思路 ③ 的 hub 侧变体（bootFanout + B 端慢消费 → 断言 RESYNC 到达且收敛）。

### F2（MAJOR）`everBeenLive` 豁免 open/reconcile 超时 —— 重连/恢复 round 可永久悬挂

- **静态证据**: `peer-namespace.ts:145`（`if (!this.everBeenLive) this.armTimer('open')`）、`:246`、`:337`、`:616`（reconcile 同款豁免）。设计 §5.1（opening → armed openTimeoutMs；round 启动 → armed reconcileTimeoutMs）与 §16 timer 清单（openTimeoutMs「OPEN 发出」/ reconcileTimeoutMs「round 启动」武装）**均无任何按「到达过 live」豁免的条款**；§9.3 同样无条件。
- **执行证据（R-C，临时复现，跑毕已删）**: 首连 live → `closePeerSide(1006)` → backoff 重连（authorize 第二次调用悬挂 → hub 永不回 OPEN_OK）→ `advanceMs(10_000)`（= 100× openTimeoutMs）→ `expect(run.namespaceState()).toBe('failed')` **FAIL：实际仍 `'opening'`**。设计语义应已 openTimeout 收口 failed（进而 §13.3 重连规则接管）。
- **影响**: 到达过 live 的 target，其后续一切 OPEN/round（重连、re-add 重建、溢出/ACK-timeout 恢复 round）都没有超时兜底——对端静默即永久停留 `opening`/`reconciling`，无终态、无收口、无 lease/session 释放（liveness 缺口 + 资源悬挂）。
- **处置（回流）**: **SA3**——按 §16 无条件武装两 timer（若担心恢复 round 被测试时间推进误伤，正确做法是调整 timer 值或测试推进量，不是删兜底）；**SA6**——补「重连后 hub 静默 → openTimeout failed」红灯。

### F3（CRITICAL）closing 窗口的 SEQUENCE_VIOLATION 宽赦 —— 序列纪律被实现侧旁路（违反 CP-1 总控裁决）

- **静态证据**: `peer-connection.ts:210-230`：入站解码抛 `SEQUENCE_VIOLATION` 且 `anyNamespaceClosing()`（**任意** namespace 处于 closing，与到达帧所属 ns 无关）时——重解该帧、把 `expectedSeq` 改写为**注入帧自带序列 +1**、照常 `dispatchReady` 分发**任意 kind** 帧。代码注释自认动机：「测试 seam 注入帧可能与出站序列计数器重叠造成 repeat——接受该 terminal 帧推进收口，不因序列伪影升级断连」——**为迁就测试 seam 在生产代码里放宽协议纪律**。
- **设计依据**: §4.1/§18.8（ADR 0010 L147 字面，总控裁决「维持 ADR 字面」）：「入站帧 sequence ≠ 期望值——**无论 gap、repeat 或回退——一律 SEQUENCE_VIOLATION connection fatal**」；设计 §18.11 前言明文「实现侧（SA3）以本设计为准、**不得为迁就现行断言偏离 ADR**」。SA6 的 §18.11 #2/#4/#5/#6/#7 五处测试正是按该裁决改成了「gap → blocked」期望——本块代码把同一条纪律在 closing 窗口内重新打开了。
- **执行证据（R-A/R-B 对照，临时复现，跑毕已删）**: closing 窗口注入 `sequence=1`（HELLO_ACK 已占用的 repeat 序列）ERROR 帧 → `expect(connectionState()).toBe('blocked')` **FAIL：实际 `'ready'`**（帧被放行分发）；对照组（非 closing、同一帧）→ `blocked` **PASS**。证明旁路精确存在于 closing 窗口，且放行后 `expectedSeq` 已被注入帧改写（后续诚实帧将反向触发 gap 误判 fatal——远端可在 closing 窗口内任意去同步序列基线）。
- **影响**: (a) ADR 字面序列纪律在 closing 窗口失效（closing 可被对端用悬挂 CLOSE_OK 拉长）；(b) 放行面不限于 terminal 帧（`dispatchReady` 全 kind 分发）；(c) `expectedSeq` 被注入帧改写后，紧随的诚实帧反而被判 fatal——把「注入/缺陷应响亮断连」的裁决改成了「先吞后炸」的非确定行为。
- **处置（回流）**: **SA3**——删除该宽赦分支（回归 §4.1 字面：fatal → blocked）；**SA6**——修复注入 seam 的序列记账（`nextHubSeq` 以「已见最大 +1」计算，与 hub 出站计数器竞态时撞号——正确做法是注入前 `settle` 后重算、或 seam 直接复用对端 outbound `lastSequence`，或把 ⑤d 期望改为 blocked 并另立无撞号形态覆盖 R3/#5d 语义）。**不得以生产码放宽换测试绿**。

---

## 次要发现（不阻塞，随阻塞项一并处理或登记）

| # | 发现 | 证据 | 处置 |
|---|---|---|---|
| F4 | 超限本地 update 的幽灵 in-flight：`sendUpdateFrame` 对 `> maxUpdateBytes` 返回 `0`，`UpdateChannel.sendAndRegister` 照样 `inFlight.set(0, bytes)`（hub/peer 两侧同构，`hub-namespace.ts:608-617`、`peer-namespace.ts:666-676`）——永不 ACK 的 seq 0 → ackTimeout 后伪 needs-resync（数据安全，round diff 修复；hub 侧叠加 F1 → 卡死 needs-resync） | 静态推理（路径确定） | SA3：超限时丢弃且**不入 inFlight**（同时避免 codec 编码抛 UPDATE_TOO_LARGE 误杀本地写——保留「丢弃由 round 修复」语义即可） |
| F5 | 出站 uint32 耗尽（§4.1 R3/#11）：设计「best-effort 发 CONNECTION_POLICY_VIOLATION 后 close(1008)」；实现 `emitOne` 抛普通 `Error`（无 `.code`），`sendChecked` 读不到 code → 静默吞掉返回 0，无 close、无 ERROR 帧（`frame-io.ts:161-168` + `hub-namespace.ts:722-737`） | 静态 | SA3：改抛带 code 的收口路径并按 §4.1 close(1008)（实践不可达，防御面补齐） |
| F6 | §4.4 连接级调度器半残：`OutboundQueue.dataQueues`/round-robin 从未被喂入（`sendData` 直发旁路，frame-io.ts:111-115）；`lowWater/highWater/maxQueuedBytesPerConnection` 仅存在于 defaults+validate，零字节记账、`CONNECTION_BACKPRESSURE` 无实现 | grep：三常量在 src 中除 defaults/validate 零引用 | 登记 SA1/切片 7（真实 WS 适配层必须接上；v1 内存同步 transport 下结构性不可达，故不阻塞）。另 §11.1 门序（设计 state→submit→size；实现 UPDATE 的 size 门在连接层先于 state/submit）角落码差异一并登记 |
| F7 | `oneShotTerminal` 防御分支：lease status 异读/disabled 时直接 `finalize('conflicted')` 零 wire；设计 §12.2 规定该防御路径「INTERNAL_ERROR 收口」（`hub-namespace.ts:571-595`） | 静态（理论不可达） | SA3 顺手对齐 |
| F8 | **范围越界（DENY LIST 命中）**：根 `package.json` 被修改（0cd1ae6，typecheck 枚举追加 `tsc -p packages/ws-replication/tsconfig.json`）。设计 §21 DENY LIST 明列根 package.json「零改动必要（P-12）」——但 P-12 该半句**事实错误**：根 typecheck 脚本是逐包枚举而非通配，不改则新包在 CI `pnpm typecheck` 门禁中永不触发（正是 §1.4 立法要堵的 CI 黑洞；且 vitest 半句为真：`vitest.config.ts` include `packages/*/test/**` 覆盖本包，无需改动）。本轮已验证改后 `pnpm typecheck` exit 0 且含本包 | `git diff ff50d47..HEAD -- package.json`（单行追加）；`.github/workflows/ci.yml` L36-40（`pnpm typecheck` / `pnpm test`） | **不要求回滚**（回滚 = 制造 CI 黑洞，与 §1.4 P0 立法冲突）；要求 **SA1** 补设计勘误：§21 ALLOW LIST 增补根 package.json（单行 typecheck 枚举追加，附理由）+ P-12 更正「typecheck 为枚举需追加、vitest 通配免改」 |
| F9 | GOAWAY 接收（SERVER_RESTARTING 分支）未「停止新 OPEN/round」（§4.3），仅安排 deadline 关连接（`peer-connection.ts:348-371`，代码注释自认「slice 9 前最小面」）；deadline 期间 namespace 照常 live | 静态 | 登记 SA1/切片 9（本切片无冻结测试覆盖；hub 主动 GOAWAY 属切片 9） |

## SA2 三条实现注记核验（SA2 R3 pass 附带移交项）

| 注记 | 核验结论 |
|---|---|
| ① §12.0 与 §11.1 围栏判别以 §11.1 权威块为准（适用域含 encode* throw） | ✅ 落实——`mapSessionRefusal`（ok:false 面）与 `mapEncodeThrow`（同步 throw 面）都先做 `fenceHit()` 判别、合流 `oneShotTerminal`（§12.2 one-shot）；closed 分支 → §13.4 本地收口（`error-mapping.ts:107-123`） |
| ② watchdog `lastPredicateValue` 初始化为 `false` | ✅ 落实——`fence-watchdog.ts:31`（`private lastPredicateValue = false`），边沿触发 + peer 侧仅 needsResync 边沿（N-2）同段落实（:106-112） |
| ③ N-1/N-2 红灯候选 ⑧/③ 建议优先落实 | ✅ 已由 SA6 落地（`ws-replication-r3-r4-regressions.test.ts` ③/⑧a/⑧b，本轮绿灯复核通过） |

## 门禁执行记录（skill §1.1–§1.7）

- **§1.1 Scope Creep Guard**: ALLOW LIST抽取自设计 §21；actual = `git diff --name-only ff50d47..HEAD`（36 文件）。逐项比对：`packages/ws-replication/{package.json,tsconfig.json,src/*.ts×15,test/*.ts×9}` 与 ALLOW 逐一精确匹配（15 个 src 文件与 §3/§21 清单零差）；`pnpm-lock.yaml` 在 ALLOW+白名单；`wiki/raw/task_phase5-*` 白名单豁免；**唯一越界 = 根 package.json（→F8）**。BLACKLIST（package-lock.json/yarn.lock/.DS_Store/TASK.md/*.bak）零命中 ✓。
- **§1.3 E2E spec 触发性**: N/A——本任务零 `.spec.ts`。
- **§1.4 vitest 触发性**: ✅ PASS——`pnpm test` = `vitest run --typecheck`，include `packages/*/test/**/*.test.ts` + typecheck include `packages/*/test/**/*.test-d.ts`（vitest.config.ts:5-11）覆盖本包 8 个测试文件；`pnpm typecheck` 经 0cd1ae6 后含本包（本轮 exit 0 复核）。CI：`.github/workflows/ci.yml` 单 workflow，push/PR 均跑两命令（node 20/24 矩阵）。（审计标记：1.4 vitest 触发性自检 = all-vitest-packages-triggered，本地 12 package 全触发）
- **§1.5 协议假设审查（P-1..P-14 逐条）**: **14/14 通过，其中 1 条（P-12）半失效但已被 SA3 补救（→F8）**。本轮独立复核的源码锚：P-2（`grep advanceBy test/` → 唯一调用点 driver.ts:497，仅 peer scheduler ✓）；P-3（replication-session apply→notifyDirty resolve 序 ✓）；P-4（replication-write.ts:423 `fenceStale` 同步段 ✓）；P-5（payloads.ts:607-611/617-621 encode/decode 双侧限检抛 ProtocolError ✓——注意实现走的是「decode 不带 limits + 连接层手工判」路径，见 hub-connection:257，语义等价且保留了 namespaceId 以构造 ns-scope ERROR，可接受）；P-9（FANOUT_CHANNEL_QUEUE_CAPACITY=16 / DEFERRAL=20，replication-session.ts:147/153/222 ✓）；P-14（types.ts:490/499-501/516 state/currentEpoch/replicationEpoch/needsResync 冻结形状 ✓）；P-12 vitest 半句 ✓ / typecheck 半句 ✗（→F8）。P-1/P-6/P-7/P-8/P-10/P-11/P-13 属契约/文档/实测传递型，与 relevant_decisions 及 SA2 前两轮独立核实一致，无「应该/预计」类空泛依据。
- **§1.6 契约改动连锁**: ✅ 未触发——基线内零既有包 src 改动（diff 仅 ws-replication + 根 package.json + lockfile + wiki），无任何 export 函数 throw/return 契约变化，caller 面零触碰。
- **§1.7 源码 grep 断言禁令**: ✅ PASS——9 个测试文件零 `readFileSync`；`toContain/not.toContain` 均作用于 wire 帧解码 JSON / safeMessage / 错误码数组（行为断言），非源码字符串断言。

## 其他静态守卫

- **I-7 零 native timer / 零全局随机**: ✅ src 全部延迟经注入 `timer.setTimeout/clearTimeout`；`Math.random` 仅作 `random` 未注入时的缺省（冻结契约明文允许）；`queueMicrotask` 非 timer（微任务）。测试零 real sleep（fake scheduler + settle/settleUntil 预算驱动）。
- **§4.1 序列分配点（R3/#7）**: ✅ 落实——序列号在 `OutboundQueue.emitOne`（实际出队发送）单点分配，入队不预占；测试 ⑦（CLOSE 插队 → 到达序严格 +1，CLOSE 序列=出队位）绿灯。
- **版本号策略**: ✅ 纯新建包 `0.1.0`，无既有包版本触碰。

## 验证证据（命令 + 结果）

| 命令（独立进程） | 结果 |
|---|---|
| `pnpm exec vitest run packages/ws-replication` | 8 文件 / 67 测试全绿，Type Errors no errors，exit 0（/tmp/sa4-vitest.log） |
| `pnpm typecheck` | exit 0，含 `tsc -p packages/ws-replication/tsconfig.json`（/tmp/sa4-tc2.log） |
| SA4 临时复现套件（4 it，**已删除**，未入仓） | **3 FAIL / 1 PASS**：R-A `expected 'ready' to be 'blocked'`（F3 旁路实证）；R-B PASS（非 closing 严格路径仍在——旁路窗口定位）；R-C `expected 'opening' to be 'failed'`（F2 超时缺失实证）；R-D `expected 0 to be ≥ 1`（F1 hub 零 RESYNC 实证）（/tmp/sa4-repro.log） |
| `grep -rn "kind: 'RESYNC_REQUIRED'" src/` | 仅 peer-namespace.ts:624/:638（hub 零发送点） |
| `grep -n "everBeenLive" src/peer-namespace.ts` | :145/:246/:337/:616 四处 timer 豁免 |
| `git diff ff50d47..HEAD --name-only` | 36 文件，与 §21 比对仅根 package.json 越界 |
| `git status --short` | 空（复现文件已删，worktree 干净） |

## 动态审核重点（交 SA7）

> 前提：F1/F2/F3 修复合入后再进入动态验证；以下按修复后形态 + 本轮静态不可闭合项列出。

1. **F1 修复后动态确认**：真实异步 transport（或人为延迟的内存 seam）下 hub 侧溢出 → wire 上出现 `RESYNC_REQUIRED` → peer 发起恢复 round → 双向收敛（静态只能证「帧会发」，投递时序须动态）。
2. **F3 修复后动态确认**：closing 窗口注入错序/重复帧 → `blocked` + 重建路径收敛；同时 SA6 seam 修复后 ⑤d 等用例不因序列撞号再红（CI `gh run view --log` 摘录 8 文件 67+N 测试触发证据）。
3. **watchdog 空闲节奏（§12 timer 面）**：冻结测试从不推进 hub scheduler（P-2）——hub 侧 fence 空闲检测（ackTimeoutMs 节奏）与 needsResync 边沿的**生产定时器路径**无任何测试覆盖，SA7 需以手动推进 hub scheduler 的专测或注入式 timer 观测确认其armed/重武装行为（静态已见 `startIdle` 实现正确，但零覆盖）。
4. **F6（真实背压）**：切片 7 真实 WS 适配接入后，`lowWater/highWater/maxQueuedBytesPerConnection` 与 `CONNECTION_BACKPRESSURE` 必须落地——届时为 SA7 重点（当前结构性不可达）。
5. **GOAWAY 接收（F9）**：SERVER_RESTARTING 的 deadline 关闭 + backoff 重连全链路（本切片无覆盖）。

## 裁决理由

实现主体质量高：设计 R4 的全部关键机制（四分类状态门、one-shot 终结器、三层检测面 + 边沿触发、encode* 同步 throw 收编、双侧 watchdog、七行 removeTarget 矩阵、blocked 重建裁决、dequeue 序列分配、I-3 ACK 时序、I-2 脱敏）逐条与源码事实精确对齐，67 项冻结验收全绿。但 **F3 是对总控 CP-1 裁决（ADR 0010 L147 序列纪律字面）的实现侧旁路，且注释自认是为迁就测试 seam**；**F1 打破最终一致性承诺且零信号（静默失败立法红线）**；**F2 抽掉了设计规定的两条超时兜底**。三者均已由执行证据坐实（非纸面推断），修复面均为局部（一处宽赦分支删除 + hub 两处补发 RESYNC + 两处 timer 无条件武装）+ 测试侧配套（SA6 seam 序列记账修复 + 两条新红灯），不触及架构与契约面。

**Verdict: reject —— SA3 修复 F1/F2/F3（F4–F7 顺手、F8 由 SA1 补勘误、F9 登记）后提交 SA4 复审（增量核对上述四处 + 复跑全量）。**

---

# SA4 R2 复审节 —— 回流修复增量核对 + 全量复跑（2026-08-30，同会话第二轮）

**Verdict: pass** —— R1 全部回流项治本落地，零新增阻塞；红灯锚定链（红→绿）双侧独立佐证；全量复跑与总控 verify2 一致。

- **被审增量**: `3f083db..HEAD`（c1ec56c SA6 红灯+seam+勘误 / ade002c SA3 R2 修复 / fa6d61c+3a18dfa 记录与测试对齐）——6 src + 4 test（新增 `ws-replication-sa4-f1-f2-f3-red.test.ts`）+ 4 wiki，全部落在 ALLOW LIST（`packages/ws-replication/**`、SA6-owned test、wiki 白名单）；零根配置新增改动、BLACKLIST 零命中。
- **全量复跑（独立进程）**: `pnpm test` → **162 文件 / 1941 测试全绿，Type Errors no errors，exit 0**（/tmp/sa4-r2-full3.log，与总控 verify2 逐值一致）；`pnpm typecheck` → **exit 0**（/tmp/sa4-r2-tc.log）；`pnpm exec vitest run packages/ws-replication` → 9 文件 / 70 测试全绿（/tmp/sa4-r2-pkg.log，含临时复验文件时 74 it）。

## 一、阻塞项修复逐条核对（对照 R1 执行证据）

| # | 修复核验（代码 diff + 静态 grep + 执行证据） | 治本判定 |
|---|---|---|
| **F3（CRITICAL）closing 序列宽赦** | `peer-connection.ts` 宽赦分支**整块删除**——`decodeFrame` import、`anyNamespaceClosing()` 辅助均移除（grep 零残留）；两连接唯一入站 decode 点（peer:211 / hub:170）均严格 `expectedSequence: this.expectedSeq` → codec 对 gap/repeat/回退一律 `SEQUENCE_VIOLATION` fatal（ADR 0010 L147 字面 / §4.1/§18.8 CP-1 定案恢复）。**执行证据翻绿**：R1 复现 R-A（closing 窗口注入 `sequence=1` 重复帧）→ 现 `blocked` + ns `disconnected`；对照 R-B（非 closing 同帧）维持 `blocked`——严格路径全时段无豁免。SA6 配套到位：`injectPeer/injectHub` 增显式 `{sequence}` + 静默期不变量文档化；⑤d 改无撞号形态（saveGate 保持悬挂 → hub 方向零出站 → 注入合法序列 → closeTimeout 本地收口），R3/#5d 语义断言全保留并新增 `CLOSE_OK×0`——覆盖等价成立 | ✅ 治本（删除而非收窄；生产码不再为测试 seam 让步） |
| **F1（MAJOR）hub 溢出零声明** | `hub-namespace.ts` 新增 `declareHubResync()`：**两个溢出面统一**（`onLocalResyncEdge`〔§10.2 channel live 溢出〕+ `onWatchdogEdge('needsResync')`〔§12 session 边沿〕）→ 发 `RESYNC_REQUIRED{reasonCode:'send-queue-overflow'}` + 置 needs-resync + 等 peer round；记忆化 `resyncDeclared`（一恢复周期恰一帧），`onRoundSettled` 进 live 时重置；quiet 态守卫；hub 收 peer 的 RESYNC（§10.6）仍不自声明（对端已声明，正确）；deferred 溢出仍走 `pendingResync`（§10.1 镜像条款，正确不声明）。设计 R4.2 §12 hub 分支「**声明 + 等待**」定案与之逐句对齐（明文「hub 侧不存在只等待零声明分支」）。**执行证据翻绿**：R1 复现 R-D（cap=1 + 悬挂 peer saveGate + hub 两笔写）→ 现 `RESYNC_REQUIRED` 恰 1 帧 + 释放 gate 后 `n/extra` 双侧收敛 + 回 `live`（R1 为 0 帧永久发散） | ✅ 治本（与协议 §9.4「任一端可声明」的恢复通路接通；SA6 F1 红灯同场景锚定） |
| **F2（MAJOR）everBeenLive 豁免** | `peer-namespace.ts`：`everBeenLive` 字段**整删**，四处 `armTimer('open'/'reconcile')` 无条件化（:142/:243/:334/:612）——grep 零残留，与 §5.1/§16/§9.3 无条件武装逐条对齐。**执行证据翻绿**：R1 复现 R-C（重连 + authorize 悬挂 + `openTimeoutMs=100`）→ `advanceMs(400)` 段内即收口 `failed`（R1 同场景 10× 时长仍 `'opening'`）。配套测试对齐合规：AC7 degraded(hub) 恢复段 `advanceMs(25_000)→(200)`——diff 实测**仅 1 行功能改动 + 注释，断言集 10 条零改动**（`git diff` 核实）；这正是 R1 F2 处置建议「调整 timer 值或测试推进量，不是删兜底」的执行（原 25s 大步推进在无条件武装后会误触 open@5s——测试形态缺陷，非兜底缺陷） | ✅ 治本（豁免机制删除，非调参掩盖） |

## 二、次要项与登记项核对

| # | 核验 | 判定 |
|---|---|---|
| F4 | `update-channel.ts:116` `sendAndRegister` 增 `if (seq <= 0) return;`——超限丢弃/连接收口的返回 0 不再登记 `inFlight`（幽灵 seq 0 消除；flushQueued 同路径覆盖） | ✅ |
| F5 | `frame-io.ts` 新增 `OutboundExhaustedError` + `onSequenceExhausted` 回调；双侧连接层（peer-connection/hub-connection）实现 §4.1 R3/#11 响亮收口：best-effort connection ERROR（`CONNECTION_POLICY_VIOLATION`）+ `close(1008)`，peer → `blocked`、hub → `closed`+cleanup；控制器 `sendChecked` 对无 `.code` 的该错误静默返回 0（不叠加 namespace ERROR，连接已收口）——符合设计「响亮收口」 | ✅（nano-note 见下） |
| F7 | `oneShotTerminal` 防御分支：identity 异读/disabled → `sendNsError('INTERNAL_ERROR')` + `finalize('failed')`——§12.2「防御：disabled/异读 → INTERNAL_ERROR 收口」对齐 | ✅ |
| F8 | 设计 R4.1：§21 ALLOW LIST 追认根 `package.json`（附总控裁决依据 + 0cd1ae6 + CI 门禁锚 ci.yml L36-40）；DENY 行同步收窄（根 package.json 移出，其余根配置仍 DENY）；**P-12 整行重写为双路径分述**（vitest 通配 ✓ / typecheck 逐包枚举须追加）——与 R1 F8 的实证（枚举性质 + CI 黑洞风险 + 改后 exit 0）完全一致 | ✅ 落实 |
| F6/F9 | 设计 §23 新增 **R-11**（§4.4 水位/round-robin/CONNECTION_BACKPRESSURE 半残 + UPDATE 门序角落差异 → 切片 7）与 **R-12**（GOAWAY SERVER_RESTARTING 未停新 OPEN/round → 切片 9），均注明 SA4 判不阻塞的理由与 SA7 动态审核重点编号 | ✅ 登记 |

**F5 nano-note（不阻塞，登记观察）**：(a) 耗尽 ERROR 帧以 `sequence: 0xffffffff` 发送——该序列已被最后一帧合法帧占用，接收端将判 repeat fatal（与紧随的 close(1008) 意图一致，best-effort 语义可接受）；(b) `OutboundExhaustedError` 在个别连接层未包裹调用点（peer `withController`/`onRemoteOpen` 的直发 sendControl、hub `onHello` 的 HELLO_ACK）理论穿透——前者需「先耗尽 2^32 帧再收到无通道帧」、后者 HELLO_ACK 恒为 seq 1，均处于 §4.1 自述「实践不可达」面，且主收口（ERROR+close）先于 throw 执行。登记供切片 7 顺手包裹，不影响本轮。

## 三、红灯锚定链复核（红→绿双侧佐证）

- **红侧**：SA6 红灯文件（3 it）于 c1ec56c（fix 前）独立进程实测 `3 failed | 67 passed`（简报记录 /tmp/sa6-f1f2f3-run.log），三个红锚与 SA4 R1 执行证据逐条同构（F1=R-D 零帧 / F2=R-C 停留 opening / F3=R-A 恒 ready）。
- **绿侧**：本轮 SA4 以 **R1 同源复现套件**（逐字同场景同断言）在修复后复跑 → **4/4 通过**（R-A/R-C/R-D 翻绿 + R-B 对照维持绿；/tmp/sa4-r2-rv.log，临时文件跑毕即删，worktree 干净）。R-C 复验首跑的「`waitNamespace('opening')` 预算耗尽、当前 failed」恰为修复生效的直接观测（openTimeout 在 400ms 推进段内 fire）——调整观测点后 4/4。
- **全量**：`pnpm test` 162/162 文件、1941/1941 测试、零 Type Errors、exit 0（与总控 verify2 逐值一致）；`pnpm typecheck` exit 0。

## 四、新偏离扫描（R2 增量）

- 修复未引入新设计偏离：F1 的声明点严格限定「本端溢出两面」（§10.6 接收面与 §10.1 deferred 面均不自声明）；F2 的无条件武装未产生新 wire 行为；F3 删除后 hub 侧本就严格（R1 已核）；F5 收口路径与 §4.1 nano-note 2 的保守选择（1008/blocked）一致。
- 范围守卫：R2 delta 全部在 ALLOW LIST 内；`git status` 干净（除本报告）。

## 五、R2 裁决

F1/F2/F3 修复均为**机制删除或通路接通**（宽赦整删、豁免整删、声明统一入口），非表面补丁——R1 三条执行证据在同源复现下全部翻绿，对照路径维持，红灯锚定链闭合，全仓零回归。F4/F5/F7 到位，F8 勘误与 F6/F9 登记落实。**Verdict: pass**——SA7 可进入动态验证（重点见 R1「动态审核重点」节，状态更新：#1/#2 已有静态+确定性测试覆盖、动态复核降级为建议项，#3/#4/#5 维持）。

---

# SA4 R3 复审节 —— SA7 D1/N1 回流修复窄幅增量核对（2026-08-30，同会话第三轮）

**Verdict（本 delta）: pass** —— D1/N1 修复治本、teardown 交互正确、零泄漏/零死 timer 论证成立（静态推演 + SA7 W1 动态锚双侧核验）；复跑包级 10 文件/74 IT、全量 163 文件/1945 IT、typecheck 全绿（与总控 verify3 逐值一致）。

- **被审 delta**: `3a18dfa..HEAD`（ffe8e84 SA7 红锚 W1/W2/G1/G2 + 报告 / f175e3e D1+N1 修复 / 167a6df dispatch log）——**src 仅 2 文件**（fence-watchdog.ts +10/−2、hub-connection.ts +3/−0）+ 1 新 SA7 测试文件 + 3 wiki，全部在 ALLOW LIST（`packages/ws-replication/**`）/白名单；零根配置、BLACKLIST 零命中。
- **复跑（独立进程）**: `pnpm exec vitest run packages/ws-replication` → **10 文件 / 74 IT 全绿，Type Errors no errors，exit 0**（/tmp/sa4-r3-pkg.log）；`pnpm test` → **163 文件 / 1945 IT 全绿，exit 0**（/tmp/sa4-r3-full.log，与 verify3 一致）；`pnpm typecheck` → **exit 0**（/tmp/sa4-r3-tc.log）。

## D1（MAJOR）修复核验 —— `startIdle` 到期回调

**缺陷回顾**（SA7 动态实证，R2 静态审漏判「startIdle 实现正确，但零覆盖」——SA4→SA7 两层门互补的实证）：原回调内递归 `startIdle()` 被 `if (this.idleArmed) return` 守卫挡死（`idleArmed` 在回调内从未清 false）→ idle 探测一次性、节奏死亡 → 空闲通道 fence/needsResync 检出延迟无上界（§16「每 ackTimeoutMs 探测 + 重武装」违约，静默失败面）。

**修复形态**（fence-watchdog.ts:58-70）：回调序 = `idleHandle=undefined` → `idleArmed=false` → `startIdle()`（重武装 H2）→ `probe()` → `onEvent()`。逐点核验：

1. **节奏恢复（零死 timer）**：`idleArmed` 的 true→false 迁移点全仓仅两处——到期回调（同步紧跟重武装）与 `teardown()`（紧跟 handle 清除）；两处 false→true 之间无 await、无让步点 → 单线程下零交错。任意空闲周期数后探测仍按 `ackTimeoutMs` 边界 fire。**动态锚**：SA7 W1 断言第二个 `ackTimeoutMs` 边界（2×−1ms 不 fire、+1ms fire）检出 fence 且恰 1 帧 `IDENTITY_CHANGED(epoch=2)`——节奏存活的直接证明（红锚在修复前实测 pending 2→0）。
2. **重武装先于 probe 的 teardown 交互（零泄漏——本修复的关键次序）**：probe 命中 fence → `onPredicateEdge` → one-shot 终结器 → `finalize` → `closeSessionAndRelease` → `watchdog.teardown()` 全部同步完成；因重武装（H2）先于 probe，teardown 时 `idleArmed=true ∧ idleHandle=H2` → `clearTimeout(H2)` 精确清除**本回调刚武装的下一周期 timer**。若次序倒置（probe 先、重武装后），teardown 会以 `idleArmed=false` 空转、随后的 startIdle 在死通道上武装永久 no-op 节奏（timer 泄漏）。**动态锚**：W1 断言 fence 后 `scheduler.pending()` 严格递减 + 再推进 30s 零新帧（既证 teardown 清除了 H2，也证 sticky 谓词电平恒真下边沿记忆不重复动作）。
3. **teardown 后的残余 `onEvent()` 有界无害**：probe 终局链返回后回调尾部的 `onEvent()` 仍会启动一条新微任务链（`chainRunning=false` → 重置预算 4096）——但 `closeSessionAndRelease` 已先置 `session=undefined`，probe 全程 no-op，链在 4096 让步内自然终止（§12 有界性保持；零 wire/零状态影响）。登记为可接受的常数级残余，不构成泄漏。
4. **复活路径**：peer 控制器跨连接复用（§14.2）——断线 teardown（idleArmed=false）→ 重连 `subscribe()` → `startIdle()` 重新武装 ✓（grep 核：startIdle 恰两处调用 peer:815/hub:303，均为会话建立点；teardown 恰两处 peer:834/hub:800，均为 closeSessionAndRelease）。
5. **§16/§12 对齐**：§16 末行「每 ackTimeoutMs 探测 + 重武装」字面达成；§12 机制 2「并重新武装微任务突发」由回调尾部 `onEvent()` 承载（未动）；hub/peer 双侧共用文件单点修复（N-2 对称性保持）。

## N1（nano）修复核验 —— hub HELLO timer 解除

`onHello` 在 `state='ready'` 同步段、发送 HELLO_ACK 之前 `clearTimeout(helloHandle)`——§16 行 1「HELLO_ACK 解除」字面达成（peer 侧 `onHelloAck → clearHello()` R1 起已有，N1 为 hub 侧对称缺口）。W1 旁证：修复前 live 期 hub `pending()=2`（idle + 残留 hello）、修复后武装面收敛。**残留（登记不阻塞）**：握手期夭折的连接（HELLO 未达即 close/fatal）hello timer 不清除、到期后经 state 守卫（`'handshaking'` 检查）成 no-op 并自移除——有界生命周期、零行为影响，与 R1/R2 既有接受面一致（如需彻底，切片 7 顺手在 connectionFatal/cleanupAll 一并 clear）。

## 结论

D1 修复是**次序敏感的单点机制修复**（清守卫 + 重武装前置），非行为面扩张；W1 红锚（修复前实测红：第二边界零探测、IDENTITY_CHANGED=0）转绿 + 零泄漏/边沿记忆/teardown 计面断言全过；N1 到位。全仓零回归（163/1945 + typecheck）。**本 delta Verdict: pass** —— SA7 fail-needs-fix 的回流闭合，R2 pass 判定在 D1/N1 修复后维持有效，可进入收口（SA7 报告的 R2 动态复核由总控另行派发）。

---

# SA4 R4 复审节 —— Spec 终审 B-1/B-2 回流修复（0324d8f）增量核对（2026-08-30，同会话第四轮）

**Verdict（本 delta）: reject** —— B-1/B-2 五个主窗口修复到位且红灯锚定全绿，但 **connectionEpoch 代际守卫不完备**：两处同族迟到续体窗口未接判别（附执行证据），其中一处已由并行 SA7 动态轮独立佐证。修复面机械（扩两处 epoch 捕获 + unsubscribe 归属修正），不触及架构。

- **被审 delta**: `60fbf41..3e1c5f7`（2a34d4a 双轴终审 R1 / 0336dce SA6 五条红灯 + G-1 / 0324d8f SA3 R4 修复 / 3e1c5f7 docs）——src 3 文件（peer-connection +16、peer-namespace +106/−28、harness +11/−2）+ 测试 + wiki，全在 ALLOW LIST；`git diff --check` **clean（G-1 ✓）**；`pnpm typecheck` exit 0。
- **复跑**：包级 12 文件中**仅 1 失败 = 并行 SA7 动态轮的在途诊断文件 `sa7r3-diag.test.ts`（未提交、其 D2 假设测试，预期红——见下 R4-2 佐证）**；其余 11 文件 / 80 IT 全绿（冻结 + SA4 红锚 + Spec 五红锚 + SA7 dynamic 已提交版）。全量 `pnpm test`：165 文件 1952 IT 中 1 failed（同一 SA7 在途文件）/ 1951 passed——**评审对象 delta 零失败**（与总控 verify4 一致；多出的 1 IT 来自 SA7 在途修改的 dynamic 文件，非本 delta）。

## 一、修复正面核验

| 项 | 核验 | 判定 |
|---|---|---|
| B-1 `onRoundSettled` 状态守卫（peer-namespace:604-610） | `state !== 'reconciling'` → 仅 `clearTimer('reconcile')` 返回——closing（§5.1 唯一出口 CLOSE_OK/closeTimeout→closed）、终态（不复活）、disconnected（零迁移）全兜住；live 重复结算本就由 engine `settled` 幂等 | ✅ 治本（红灯锚 1 过） |
| B-2a/b 导入迟到静默回收（:338-344） | `isConnectionDead()` → `releaseLeaseOrNoop(importResult.lease)` + 零 wire 零迁移（§8 L361 字面）；重连 `openActiveTargets` 重 OPEN → 已导入副本 → reconcile | ✅（红灯锚 2 过）——**但见 R4-1：判别面不完备** |
| B-2c startOpen 迟到（:143/:152-158/:182-188） | epoch 捕获 + 两个 await 边界判别 + lease 静默回收、不覆盖 `this.lease`；重连单 OPEN | ✅（红灯锚 3 过） |
| B-2d 投影先行（:557-569） | `onConnectionLost/onConnectionFatal` 同步 `setState('disconnected')` 后异步 cleanup——`openActiveTargets` 不再跳过滞留 live；cleanup 卡 session.close 屏障不再阻塞投影 | ✅ 概念正确（红灯锚 4 过） |
| B-2d ACK/Applied 代际守卫（:714/:741-753） | `applyStep2`/`applyRemoteUpdate` 捕获 epoch，resolve 后 `connectionEpoch() !== epoch` → 不发 SYNC_APPLIED/UPDATE_ACK | ✅（旧连接迟到 ACK 不落新连接） |
| B-2d cleanup 当前身份守卫（:888-896） | `this.session === session && this.lease === lease` 才 teardown 通道级状态（watchdog/round/channel）；旧 lease 恒 release | ✅ 概念正确——**但 unsubscribe 在守卫外（R4-2）** |
| B-2e rebuild 全控制器通知（peer-connection:490-493）+ sendControl ready 门（:396）+ HELLO 直发例外（:188） | §4.3 L228「重建期间所有 ns 投影 disconnected」字面达成；迟到控制器帧不再落入新连接 handshaking 窗口；HELLO 经 `this.outbound.sendControl` 直发绕过状态门（握手期合法发送） | ✅（红灯锚 5 过；门的副作用见 R4-4） |

## 二、阻塞项（执行证据）

### R4-1（MAJOR）epoch 守卫不完备：导入/session-open 续体未接判别 —— 良性断线致 ns 永久 failed + wire 垃圾帧

- **静态**：`connectionEpoch` 判别只接在 startOpen（:143）与 apply ACK 面（:714/:741）。`onBootstrapSnapshot` 的导入续体（:320-370，`importReplica` await + `tryOpenReplicationSession` await 后仅 `isConnectionDead()`）与 `openSessionAndStartRound`（:253-260，入口检查在 await **之前**，`openReplicationSession` await 后仅 `isConnectionDead()`）**均未捕获/比对 epoch**。`isConnectionDead()` = 终态 ∨ `'disconnected'`——一旦新生命周期离开 disconnected 停留域（`'opening'`），迟到续体照常推进。
- **可达性（确定性，无需慢盘假设）**：Registry 每 namespace carrier FIFO 串行化——断线重连后新生命周期的 `registry.open` **排队挂在停泊的导入 #1 之后** → 释放门闩时 state 恒为 `'opening'`（结构性可达，非时序巧合）。
- **执行证据（临时复现，跑毕即删，/tmp/sa4-r4-diag.log）**：bootstrap 导入悬挂（importHold）→ `closePeerSide(1006)` → backoff 重连 ready（state `opening`）→ 释放门闩 → **终态 `failed`**；wire #2 实测 `peer→hub: HELLO:1, BOOTSTRAP_ACK:2, SYNC_STEP1:3, OPEN_NAMESPACE:4`、`hub→peer: HELLO_ACK:1, ERROR:2, ERROR:3(NAMESPACE_STATE_VIOLATION ×2), OPEN_OK:4`——**旧连接的迟到续体在新生命周期 OPEN 之前发出 BOOTSTRAP_ACK+STEP1** → hub 无通道 → 2× NAMESPACE_STATE_VIOLATION → ns 永久 failed。一次良性 socket blip（或 §14.1 重建）期间导入在途即触发；违 §13.4「连接已断」半句（本 commit 自称完整实现的语义）与 §13.3 重连修复承诺。
- **处置（回流 SA3/SA6）**：两处续体入口捕获 `connectionEpoch()`，每个 await 后 `isConnectionDead() || epoch !== 当前` → 交付物静默回收（lease release / session close）+ 零 wire 零迁移；SA6 补红灯（blip×导入在途 → 重连 → 释放 → 断言 live + 单 OPEN + 零 NAMESPACE_STATE_VIOLATION——注意 staging：释放时 state 为 `opening`，非 `live`）。

### R4-2（MAJOR）`closeSessionAndRelease` 的 unsubscribe 在当前身份守卫之外 —— 旧 cleanup 误杀新 session listener，新连接上行静默死亡

- **静态**（peer-namespace:884-887）：`this.unsubscribe()` 无条件执行，位于 `this.session === session && this.lease === lease` 守卫（:888）**之前**且未在入口捕获——旧 cleanup 停泊于旧 `session.close()` 屏障（在途 apply 排空前不 resolve）期间，新生命周期已 `subscribe()` 登记新 listener；旧 cleanup 恢复后误调新 listener 的退订函数。
- **执行证据（临时复现，跑毕即删，/tmp/sa4-r4-c.log）**：hub→peer UPDATE 的 apply 悬挂（saveGate）→ 断线（投影先行）→ 重连（新 session + subscribe，round 因每-ns write sequencer 排在悬挂 apply 后）→ 释放 gate → round 收口 **live** → `writePeer({ext:9})` → **`UPDATE 帧 p2h = 0`、hub ext=undefined（peer ext=9）**——新连接上行静默死亡，零 wire 信号，state 恒 live（F1 类静默发散）。
- **独立佐证**：并行 SA7 动态轮在途诊断 `sa7r3-diag.test.ts`（D2 hypothesis「late cleanup unsubscribe kills NEW session listener」）实测红——两轴独立收敛同一缺陷。
- **处置（回流 SA3）**：`unsubscribe` 与 `session`/`lease` 同批入口捕获，仅退订自有 listener（移入同一当前身份条件）；SA6 补红灯（跨重连在途 apply → 恢复 live → peer 写收敛 hub + UPDATE ≥1）。

## 三、次要发现

| # | 发现 | 处置 |
|---|---|---|
| R4-3（MINOR） | `openSessionAndStartRound` 续体（`openReplicationSession` await 后）无 epoch 判别——与 R4-1 同族但窗口窄（该 seam 无持久化门闩，需事件循环滞涨跨完整重连） | 随 R4-1 一并修（同一 epoch 模式） |
| R4-4（nano） | sendControl 的 ready 门（peer-connection:396）以 connState 为判据，**抑制了当前连接握手期合法的 connection ERROR 帧**（`connectionFatal` 在 handshaking 态 → best-effort ERROR 不再发出，§4.1「framing 仍可信时 best-effort 发 connection ERROR」弱化；close code 仍正确送达） | 精确化：门按 epoch（帧属当前连接）而非 connState 判定，或对 connection 级 ERROR 豁免；登记切片 7 顺手 |

## 四、R4 裁决

B-1/B-2 修复架构方向正确（代际判别 + 投影先行 + 当前身份 cleanup 守卫），五个主窗口红灯锚定全过、全仓零回归（评审对象 164 文件 1951 IT 全绿 + typecheck + diff-check）；但代际守卫的**接线不完备**留下两条同族窗口（R4-1/R4-2），均已由执行证据坐实且其一获 SA7 并行动态轮独立佐证——分别产生「良性断线 → ns 永久 failed + 先于 OPEN 的垃圾控制帧」与「恢复后上行静默死亡（零信号发散）」，恰为 B-2 簇要关闭的 §13.4「连接已断」语义在姊妹路径上的残留。修复机械（两处 epoch 扩接 + unsubscribe 归属），不动架构与契约面。

**本 delta Verdict: reject —— SA3 修复 R4-1/R4-2（R4-3 随修、R4-4 登记切片 7）+ SA6 补两条红灯后提交 SA4 R5 增量复审。**

---

# SA4 R5 复审节 —— R4-1/R4-2/R4-3 回流修复（12258c2）窄幅增量核对（2026-08-30，同会话第五轮）

**Verdict（本 delta）: pass** —— 代际守卫接线补全到位（全部 await 点判别完备）、unsubscribe 句柄捕获归属正确、零新增面；R4 两条执行证据以同源复现套件复跑全部翻绿 + SA6/SA7 红灯锚定转绿；全量 165 文件 / 1953 IT + typecheck + diff-check 全绿（与 verify5 逐值一致）。

- **被审 delta**: `3e1c5f7..f49f12d`（6ab9e32 SA6 R4-1 红灯 + 设计 R-13 登记 / 12258c2 SA3 R5 修复 / f49f12d docs）——src **仅 peer-namespace.ts +38/−21** + 测试 + wiki，全在 ALLOW；`connectionEpoch` 不在冻结公共契约（`PeerNamespaceHost` 包内私有接口，api.test-d 零触碰）✓。
- **复跑（独立进程）**：R4 同源证据套件（临时文件，跑毕即删）→ **2/2 翻绿**：R4-A（迟到导入续体 → 静默回收、新生命周期收敛 live、wire 零 NAMESPACE_STATE_VIOLATION——R4 实测为 2×violation + failed）；R4-C（跨重连 cleanup 后 `writePeer` → hub 收敛 ext=9 + UPDATE ≥1——R4 实测 0 帧、hub undefined）。包级 12 文件 / 82 IT 全绿（含 SA6 `ws-replication-sa4-r4-1-red` 与 SA7 `D2` 红灯转绿）；全量 `pnpm test` 165 文件 / 1953 IT 全绿 exit 0；typecheck exit 0；`git diff --check` clean。

## 一、修复逐点核验

| 点 | 核验 | 判定 |
|---|---|---|
| **R4-1 导入续体 epoch**（:330-383） | 续体入口捕获 `connectionEpoch`；`importReplica` await 后 `isConnectionDead() ∨ epoch !== 当前` → **交付 lease 静默回收**（releaseLeaseOrNoop——赋值前路径）+ 零 wire 零迁移；`tryOpenReplicationSession(epoch)` await 后同判据 → 零 BOOTSTRAP_ACK/零 setState（赋值后路径的 lease 由连接丢失 cleanup 的**局部捕获 release** 兜底——`closeSessionAndRelease` 尾部按捕获局部量恒 release，已核无泄漏路径：赋值前后两路径回收责任划分闭合） | ✅ 治本（垃圾控制帧面消除——同源复现 R4-A 翻绿） |
| **R4-3 openSessionAndStartRound epoch**（:253-266） | 入口捕获；`tryOpen` await 后判别 → 零 wire 零迁移（session 已由 tryOpen 内部判别静默回收）；原 await 前的 `state !== 'opening'` 入口检查移除——入口唯一来源 `onOpenOk` 自带同款门，等价无损失 | ✅ |
| **tryOpenReplicationSession(epoch)**（:268-292） | 形参化 epoch；`openReplicationSession` await 后 `dead ∨ epoch` → `result.session.close()` 静默回收 + return false；catch/!ok 路径的 finalize 判据同步从 isTerminal 升级为 isConnectionDead（断开域零假 failed）；调用点恰 2 处（:255/:365）均传各自续体捕获的 epoch | ✅ |
| **R4-2 unsubscribe 句柄归属**（:891-910） | 入口捕获 `const unsubscribe = this.unsubscribe`；退订块**移入**当前身份守卫内且叠加 `this.unsubscribe === unsubscribe` 双重身份判别——迟到 cleanup（守卫外）既不触碰新 listener 也不清空 `this.unsubscribe`；`unsubscribe === undefined` 时跳过 ✓。边界穷举：迟到 cleanup（新 session 已开）→ 守卫失败 → 不退订 ✓；正常 cleanup → 三重身份一致 → 退订自有 ✓；同 session 不存在二次 subscribe（subscribe 每 session 恰一次）→ 无假阴性窗口 | ✅ 治本（同源复现 R4-C 翻绿；SA7 D2 红灯转绿独立佐证） |
| **epoch 判别完备性（全部 await 点清点）** | startOpen（2 处）✓ / openSessionAndStartRound ✓ / tryOpen ✓ / 导入续体（2 处）✓ / applyRemoteUpdate + applyStep2（R2/R4 已接）✓ / closeSessionAndRelease（身份守卫）✓ / removeTarget memo（cleanup 后零 wire）✓。**唯一残留**：`onCloseRequest` 的 CLOSE_OK 在 drain+cleanup await 后无 epoch 判别——但 v1 中 CLOSE_NAMESPACE 仅 peer 发送（grep 实证 src 唯一发送点 peer-namespace:522），hub 从不发送 → 该路径仅可达于注入/敌意帧，**v1 结构性不可达**；登记切片 9（hub 主动 close 编排落地时补 epoch 判别） | ✅（残留登记，不阻塞） |
| **零新增面** | 单文件 +38/−21；零公共契约/零 wire 码/零配置变更；无新导出；行为面只收窄（迟到续体零 wire）不扩张 | ✅ |

## 二、登记项核对

- **R-13**（6ab9e32 → 设计 §23）：SA4 R4-4（sendControl ready 门抑制握手期 connection ERROR 帧）已登记为 R-13，含「门不可简单删（服务 B-2e 重建语义）+ 切片 7 精确化（epoch 判据或 connection ERROR 豁免）」——与 SA4 R4 原建议一致 ✓。

## 三、R5 裁决

R4-1/R4-2/R4-3 修复为**守卫接线补全**（机制本身 R4 已立，本轮把 epoch 判别接到导入/session-open 两族续体的每个 await 点、把 unsubscribe 归属收进身份守卫），无行为扩张；R4 的两条执行证据在逐字同源复现下全部翻绿，SA6 R4-1 红灯与 SA7 D2 红灯独立转绿，全仓零回归（165/1953 + typecheck + diff-check，与 verify5 一致）。唯一残留（onCloseRequest CLOSE_OK epoch）v1 结构性不可达，已登记切片 9。

**本 delta Verdict: pass** —— R4 reject 回流闭合；连同 R2/R3 各 pass，本切片 SA4 审查链（R1 reject → R2 pass → R3 pass → R4 reject → R5 pass）对全部 14 项自有发现（F1-F9、D1/N1 核验、R4-1..4）形成闭环，可进入收口（Standards 轴意见与 SA7 动态终验由总控另行统筹）。
