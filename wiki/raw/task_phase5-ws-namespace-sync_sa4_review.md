# SA4 静态验尸报告 — `@nomicore/ws-replication`（issue #136 切片 6，Phase 3）

**Date**: 2026-08-30
**Verdict**: **reject**（3 条已获执行证据的设计偏离，修复面窄、方向明确；无需 needs-redesign——架构本身成立）

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
- **§1.4 vitest 触发性**: ✅ PASS——`pnpm test` = `vitest run --typecheck`，include `packages/*/test/**/*.test.ts` + typecheck include `packages/*/test/**/*.test-d.ts`（vitest.config.ts:5-11）覆盖本包 8 个测试文件；`pnpm typecheck` 经 0cd1ae6 后含本包（本轮 exit 0 复核）。CI：`.github/workflows/ci.yml` 单 workflow，push/PR 均跑两命令（node 20/24 矩阵）。
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
