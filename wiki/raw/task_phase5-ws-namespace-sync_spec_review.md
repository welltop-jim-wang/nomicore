# Spec review 终审报告 — issue #136（Phase 5 切片 6：`@nomicore/ws-replication`）

- 审查轴：**Spec review（规格符合性）**；独立审查，不涉实现、不改代码
- **审查 diff range（逐字）：`ff50d47..f557b68`**（`git diff ff50d47..f557b68`；已核验 `f557b68` == 分支 `fix/issue-136-on-docs-phase-5-websocket-replication` HEAD，`ff50d47` 存在）
- diff 构成：41 文件 +9949/−1——`packages/ws-replication`（15 src + 10 test + package.json/tsconfig）+ 根 `package.json` typecheck 枚举单行 + `pnpm-lock.yaml` 登记 + `wiki/raw/task_phase5-ws-namespace-sync*` 12 份过程文档
- 规格基准：任务简报 `wiki/raw/task_phase5-ws-namespace-sync.md`（What-to-build + 7 条 AC 原文）、设计定稿 R4.2 `…_design.md`（929 行）、`docs/protocols/instance-replication-v1.md`（587 行）、`docs/phases/phase-5-websocket-replication.md`（226 行）、AC 清单 `…_ac_checklist.md`（7/7 ✅）
- 方法：diff 全量逐文件精读（src 15/15、test 10/10）；设计条款逐节对照；协议不变量逐项核验；测试断言抽查到行号。**静态终审**——未重跑测试（绿灯证据引自总控 verify3.log 与 SA4/SA7 复跑记录：163 文件/1945 IT + typecheck 全绿）；本报告全部发现来自 diff 独立精读，且**不复述**已修复并验证的既往项（SA4 F1–F9、SA7 D1/N1 已分别由 ade002c/f175e3e 修复并转绿）

---

## 1. 需求符合性（What-to-build × 7 条 AC）

**What-to-build 逐项**：authorization ✓（§19 authorizer + spy 证据）、open ✓、absent-replica bootstrap ✓、matching-replica 双向 reconciliation ✓、live updates ✓、acknowledgements ✓、resync ✓、orderly namespace close ✓——**无缺失/半成品条目**。

| AC | 结论 | 断言证据（抽查核实到行号） |
|---|---|---|
| AC1 | ✅ 交付且有断言 | `ws-replication-ac1-ac2-open.test.ts:53-106`（HELLO/OPEN 精确字段、全 wire 扫描零 owner、authorize 恰（PEER_INSTANCE, nsId) 一次、序列 HELLO=1 严格 +1）、`:148-166`（submit:false → live 后 UPDATE 拒 NAMESPACE_UNAUTHORIZED、零写入零 ACK 零回显）、`:254-292`（幂等 add/remove + closed 后 re-add 重建）；类型面 `ws-replication-api.test-d.ts:96-111`（ReplicationTarget 精确两字段、§19 形状）。HUB_OWNER 独立性由端到端证明（授权结果驱动 `registry.open`，错 owner 则 NOT_FOUND 走不到 OPEN_OK） |
| AC2 | ✅ | 同文件 `:109-237` 五类拒绝（未授权/缺失/禁用/谱系/epoch）+ 不泄露（deny 与 missing 同码 UNAUTHORIZED、safeMessage 无 owner 串）+ read:false + 合流（2×OPEN_OK）+ REOPEN_REQUIRES_RECONNECT ×2 + TARGET_NOT_REQUESTED；mode 选择证据在 ac3 `:34-35`（mode0）与 ac4 `:50-53`（mode1） |
| AC3 | ✅ | `ws-replication-ac3-bootstrap.test.ts:29-76`（恰 1 帧快照、快照含 META/SCHEMA/ROOT 全量、ACK.ackedSequence=快照帧序、ACK 后紧邻 SYNC_STEP1(roundId=1)、peer 侧身份落地）、`:78-87`（TOO_LARGE 零快照帧）、`:89-118`（duplicate → BOOTSTRAP_FAILED、不覆盖 n=99、快照仅一次）、`:120-139`（timeout → failed、零重发零 ACK） |
| AC4 | ✅ | `ws-replication-ac4-reconcile.test.ts:39-96`（timeline 证明 peer Step1 先于 hub Step1、relatedStep1Sequence/ackedSequence 交叉校验、双向数据互换后 live）、缺 Applied→reconciling 悬挂→timeout failed、错序 Step2 / 重复 Step1 → SYNC_STATE_VIOLATION、空 diff（≤4 字节）完整流程进 live（`:185-205`） |
| AC5 | ✅ | `ws-replication-ac5-live.test.ts:30-52`（单槽 apply+dirty→ACK 序列对应、saveEvents+1）、`:54-70`（saveGate 门闩：ACK 只在 dirty 释放后发出）、`:72-96`（bootFanout：A 方向零回声 UPDATE、B 收敛并 ACK）、`:98-119`（窗口 2 抑制第三笔、ACK 后放行）、`:121-131`（重复 update 仍 ACK×2）、`:133-146`（99999 → ACK_STATE_VIOLATION + 连接关闭 + blocked）、`:148-159`（UPDATE_TOO_LARGE 零写入零 ACK） |
| AC6 | ✅（主路径；一处竞态缺口见 §5 B-2d） | `ws-replication-ac6-resync-close.test.ts:40-71`（溢出→needs-resync→RESYNC×1→同连接 roundId=2→diff 补齐）、`:73-102`（ACK timeout 不重发→跨连接收敛）、正常 close（`:103-143`：CLOSE_OK 只在在途 apply settle 后、ackedSequence=CLOSE 帧序、幂等 remove、re-add 重建）、terminal ERROR→failed 零后续帧（`:144-160`）、IDENTITY_CHANGED 恰 1 帧/peer epoch 不变/META 零 UPDATE（`:161-177`）、socket 1006→disconnected+断线写零帧+重连修复（`:178-205`）、bootstrap 中断线重连重 bootstrap（`:206-224`）；+ F1/F2 红灯 `ws-replication-sa4-f1-f2-f3-red.test.ts:28-95` + r3-r4 ②⑧ bump 竞态 |
| AC7 | ✅ | `ws-replication-ac7-faults.test.ts` 12 用例（错序 OPEN 前 UPDATE/重复 SYNC_APPLIED/APPLY_FAILED 零写入/degraded 双侧/cleanup 竞态×2/合流/构造校验×3/保护检查×2/错误 round）+ r3-r4 11 用例 + sa7-dynamic W1/W2/G1/G2 4 用例；fake-duplex + 全虚拟时间、零 real sleep（harness.ts:198-216 settle/settleUntil；driver.ts advanceMs 仅驱动 fake scheduler）；用例计数 65 行为 it + 9 类型 it = 74，与 checklist「74 IT」一致 |

## 2. 设计定稿（R4.2）符合性

- **§2 冻结契约面**：逐字段一致——`src/types.ts:18-144`（10 limits/6 timeouts/3 backoff 字段、DuplexTransport/ReplicationTimer、NamespaceAuthorization/Authorizer、ReplicationTarget 精确两字段、Hub/Peer options 与公共面、PeerConnectionState 8 态、PeerNamespaceState 11 态）；`src/index.ts:4-27`（2 工厂 + 3 DEFAULT_* + 16 类型导出）；`src/defaults.ts:16-44` 冻结值与 §2 注释值逐值一致（8MiB/4MiB/2MiB/512KiB/4MiB/256/32/8MiB/64KiB/512KiB；10s/5s/10s/10s/5s/10s；100/30s/10s）；`src/testing.ts` `/testing` 子路径 ✓。`ws-replication-api.test-d.ts` 以 expectTypeOf 逐字段锚定。
- **§4.1 序列纪律 ADR 字面**：✅——发送侧序列在出队时单点分配（`frame-io.ts:173-189`，F4 幽灵登记已防 `update-channel.ts:116`）；接收侧 `expectedSeq` 仅 decode 成功后推进（hub-connection.ts:169-178、peer-connection.ts 同构），codec 层强校验（replication-protocol `envelope.ts:127-128`）；gap/repeat/回退一律 SEQUENCE_VIOLATION + close 1002 + peer blocked（F3 红灯绿）。uint32 耗尽响亮收口 close(1008)（frame-io.ts:173-179 + hub-connection.ts:364-385）。
- **§10.5 溢出同连接恢复**：✅——peer 溢出/ACK timeout/session 边沿三面统一 needs-resync + 窗口收口后同连接 round+1（`peer-namespace.ts:585-640` + `update-channel.ts:50-149`）；hub「声明+等待」R4.2 定案（`hub-namespace.ts:561-622`，F1 红灯与 SA7 W2 绿）。
- **§11 错误映射**：✅ 三层单点（`error-mapping.ts` 全域 + `lookupError().terminalState` 驱动）；degraded 判别表旁证单点 ✓；R3/#2 围栏判别钩子 ✓——但谓词口径与 §11.1 字面有一处偏差（→ §6 N-1）。
- **§12 围栏判别 + one-shot 终结器**：✅ 三层检测面（帧处理钩子 + 4096/8 微任务突发 + 每 ackTimeoutMs 空闲探测，D1 重武装修复形态正确——`fence-watchdog.ts:56-66` 清守卫→重武装→probe 次序）；one-shot 记忆化恰一帧 + 重读当前身份 + 防御 INTERNAL_ERROR（`hub-namespace.ts:572-602`）；peer 收 IDENTITY_CHANGED 零 apply 本地 epoch 不变（`peer-namespace.ts:438-444`）。
- **§13 close/cleanup 矩阵**：七行矩阵 ✅（`peer-namespace.ts:457-497`；§13.1 targeted/disconnected 零 wire 本地收口、活跃→closing+CLOSE+closeTimeout、closing 合流、closed 复用 memo、conflicted/failed 立即 resolve）；§13.2 hub 收 CLOSE 次序（停接纳→drain→session.close→release→CLOSE_OK）✓ `hub-namespace.ts:501-518`；⑤d closing×terminal ERROR 维持 closing ✓ `peer-namespace.ts:446-453`。**两处守卫缺口见 §5 B-1/B-2**。
- **§16 timer 清单**：✅ 全覆盖——helloTimeout 双侧（hub 侧 N1 解除已修 hub-connection.ts:219；peer 侧 peer-connection.ts:249）、open/bootstrap/reconcile/close/ack 计时全部无条件武装（F2 修复）、ack 单计时器覆盖最老 in-flight、backoff delay/resetAfterMs 检查、watchdog 空闲节奏；hub close timer 无调用点为死配置（hub 不发 CLOSE，→ §6 N-11）。
- 其余节：§5.2 OPEN 决策（含 disabled 本地响亮失败、NOT_FOUND→hasLocalReplica=false、OPEN_OK mode/身份一致性校验）✓；§5.3 非 live 有界队列 + 溢出丢弃安全性论证 ✓；§6 hub 入站分发/方向纪律/无通道统一 NAMESPACE_STATE_VIOLATION ✓；§7 OPEN 矩阵冻结次序（授权先于 Registry、存在性不泄露、身份比较、0a 合流/0b 重开拒绝）✓；§8 单帧快照/排他导入/身份重读/超时收口 ✓；§9 round 引擎违例矩阵 ✓（`round-engine.ts`）；§13.3 断线收口（unsubscribe 在 session.close 之后、零 UPDATE 帧）✓；§13.5 stop/close 编排 ✓；§14.1 重开矩阵（blocked 任意 addTarget 重建）✓；§14.2 roundId per-target 持久（bootstrap 中断不消耗计数器）✓；§15.1 构造期响亮校验（零 clamp）✓ `validate.ts`；§17 测试基建 ✓；§18.4 hub 溢出对称 ✓；§19 授权面 ✓；§20 保护检查经 session 层 ✓。
- **§21 ALLOW/DENY**：diff 全部落 ALLOW（新包 + 测试 + 根 package.json typecheck 枚举单行——R4.1 勘误追认条目——+ pnpm-lock 登记 + wiki/raw 文档面）；DENY 面（replication-protocol/namespace-registry/namespace-runtime/persistence/apps/domains/vitest.config 等）零触碰 ✓。

## 3. 协议/Phase 符合性与非目标夹带

- 协议不变量 I-1..I-12 面：一 message 一 frame ✓；序列严格 ✓；namespaceId 直携 ✓；单生命周期（I-5）✓；HELLO_ACK 前零 namespace 帧 ✓；大小门在 live apply 前 ✓；一切远端 apply 经 session 唯一 sequencer + 槽内 dirty ✓（transport 全程未触裸 Y.Doc；peer 唯一 `new Y.Doc()` 为 §8 明文的 detached 预演 peer-namespace.ts:294）；ACK=sequenced apply+dirty ✓；identity/epoch 不自动覆盖 ✓；owner/token/SCHEMA/ROOT/stack/cause 零上 wire ✓（safeMessage 静态常量表单点 frame-io.ts:30-32）。
- 零 native timer/零全局随机（I-7）✓：src 全域仅注入 `timer.setTimeout/clearTimeout` 与可注入 `random`（缺省 Math.random 为 §2 冻结面）。
- **非目标零夹带**：src 内无真实 WebSocket 适配/bearer upgrade、无 observability observer/metrics、无 resetReplica 编排入口、无 GOAWAY 主动发送（仅 §0 允许的接收语义与被动分类）、无 namespace discovery/通配 selector、无 durable outbox、无第二种 transport（grep 全 src 核实）。GOAWAY 接收为最小面且实现注释自认切片 9 前不做完整编排（peer-connection.ts:336-348）。
- 依赖锁定：yjs/y-protocols/lib0 与 replication-protocol 同 spec 区间、同一 lockfile 单解析（yjs 13.6.32/y-protocols 1.0.7/lib0 0.2.117）✓。

## 4. 门禁合规

- **G-1（blocking，琐碎）**：`git diff --check ff50d47..f557b68` **exit 2**——`packages/ws-replication/test/ws-replication-r3-r4-regressions.test.ts:342: new blank line at EOF`。设计 §22 验证命令与 phase-5 §阶段门禁 L224 均含 `git diff --check`；总控验证基线（verify3.log）与 SA4/SA7 复跑只覆盖 vitest/typecheck，本项漏网。修复为一行删除（SA6-owned 测试文件）。
- `pnpm typecheck`/`pnpm test`：本审查未重跑；以总控亲跑 + SA4 R3 + SA7 R2 三份一致记录（163 文件/1945 IT 全绿、零类型错误）为准，无反证。

## 5. 可疑不正确行为（BLOCKING——代码证据充分、冻结测试未覆盖）

### B-1 removeTarget × reconcile 竞态：`onRoundSettled` 无状态守卫，closing 被复活为 live，CLOSE_OK 被吞，target 永久假活

- 证据：
  - `peer-namespace.ts:570-583` `onRoundSettled()` **无任何状态/终态守卫**，无条件 `setState('live')` + `channel.resetForLive()`（对比 hub 侧 `hub-namespace.ts:731` 至少有 `!this.isTerminal()`——'closing' 仍非终态，hub 靠 close 链末端 `setState('closed')` 自愈；peer 侧无自愈面）。
  - 触发链：reconciling 期 hub 的 SYNC_APPLIED（对本端 Step2）已收（`round-engine.ts:165` 置位）→ removeTarget（`peer-namespace.ts:469-481`：intent=removed、state='closing'、CLOSE 已发、close timer 武装）→ 本端 Step2 apply 在途结算（慢 saveDoc）→ `round-engine.ts:188-203` `applyStep2Safely` 续体无通道状态门 → `checkSettled` 双位齐 → `onRoundSettled` → **state 'closing'→'live' 复活**。
  - 后续全部收口件失效：CLOSE_OK 到达时 `onCloseOk` 仅认 'closing'（`peer-namespace.ts:428-436`）→ 忽略；close timer fire 仅认 'closing'（`:883-892`）→ no-op；cleanup memo 只清资源不回写状态（`:499-507` + `:822-840`）。
  - 终局：投影 **'live'（谎报）**、intent='removed'、session/lease 已释放、hub 通道已正常 closed；re-add 同 target 为 no-op（`peer-connection.ts:131-132` 非终态仅置 intent 合流）；`openActiveTargets` 跳过 'live'（`:371-381`）→ **该 namespace 永久静默停摆**，违设计 §5.1 L250（closing 唯一出口 CLOSE_OK/closeTimeout→closed）与 §13.4 L609（终态不复活、零状态机迁移）。
- 触发条件均为普通操作面：removeTarget 是冻结公共 API；「hub SYNC_APPLIED 先于本端 Step2 apply 结算」在 hub 持久化快于 peer 时为常态竞态。
- 测试缺口：AC7 cleanup 竞态用例（`ws-replication-ac7-faults.test.ts:121-144`）锚定的是 **live 态**在途 UPDATE apply；「reconciling 态在途 Step2 apply + 对端 SYNC_APPLIED 已收 + removeTarget」组合无任何用例。
- 修法方向（建议，非本报告职责）：`onRoundSettled` 加「state==='reconciling' 才进 live，否则只清 reconcile timer」守卫（closing/终态迟到结算只推进收口）。

### B-2 §13.4「已终局/**连接已断**」只实现了前半句——异步续体守卫簇（late-result 纪律缺口）

设计 §13.4（L609）明文：「任何异步操作（authorize、import、apply、CLOSE_OK…）resolve 时发现自己所属 ns 已终局/**连接已断**：只做资源回收，零 wire 帧、零状态机迁移」。实现的所有续体守卫只判 `isTerminal()`（`peer-namespace.ts:798-800`，仅 closed/conflicted/failed）；`isQuietState()`（`:802-809`）亦不含 'disconnected'。放大器：`PeerConnectionImpl.sendControl` **无连接状态门**（`peer-connection.ts:386-389`，仅查 outbound 存在）——迟到帧可落在新连接的 handshaking 窗口（hub 判 HELLO_REQUIRED 断连，`hub-connection.ts:180-187`）或 ready 窗口。子项：

- **B-2a 导入终态不回收 lease**：`peer-namespace.ts:318` 终态分支直接 return，`importResult.lease` 从未 release（注释自称「静默回收」但无对应调用）——违设计 §8 L361「resolve 后发现 ns 已终态 → 仅做 lease/session 静默回收」字面；Registry lease 泄漏（每次断线×在途导入竞态一份）。
- **B-2b 导入迟到遇 disconnected 照常推进**：socket 断开在 `importReplica` 在途 → `onConnectionLost` 置 'disconnected'（`:518-531`，非终态）→ 续体 `:318` 通过 → `:324-335` 赋 lease、开 session、发 BOOTSTRAP_ACK（旧 transport 丢弃或新连接错发）、**`setState('reconciling')`** → `openActiveTargets` 不处理 'reconciling' → 重连不重 OPEN → reconcile 超时 `finalize('failed')`（`:883-895`）——一次普通断线把 bootstrap 中 namespace 卡入 failed，直至人工 re-add。
- **B-2c startOpen 迟到续体**：`:151/:177` 同样只判 isTerminal——'disconnected' 时照常发 OPEN_NAMESPACE 并 `:165` 覆盖赋值 `this.lease`（旧 lease 永不 release）；若迟到 OPEN 落在新连接 handshaking 窗口 → hub HELLO_REQUIRED 连接 fatal（peer blocked）；若落在 ready 后 → 与重连自身 OPEN 形成双 OPEN → hub 合流回 2×OPEN_OK（§7.1 合法形态）→ 第二帧命中 `onOpenOk:199-204`（state≠'opening' → NAMESPACE_STATE_VIOLATION + failed）——**自伤式违例**。
- **B-2d（本簇最重）在途 apply 跨重连 → AC6 重连修复承诺不成立**：hub→peer UPDATE 的 apply 在途（saveDoc 悬挂）时 socket 断开 → `onConnectionLost` 的 'disconnected' 投影要等 `cleanupResources`（`:528-530`），而 cleanup 卡在 `session.close()` 屏障（`:822-826`；屏障语义见 `namespace-runtime/src/replication-session.ts:528-541`「resolve 时点=已接纳槽排空」）→ **状态滞留 'live'**；backoff 计时器独立走完 → 重连 ready → `openActiveTargets` 跳过 'live'（`peer-connection.ts:371-381`）→ **新连接永不重 OPEN**；gate 释放后 `:711-717` ACK 续体（isQuietState 不含 'disconnected'/'live' 滞留态）把**旧连接的 UPDATE_ACK 发到新连接** → hub 新连接无该 ns 通道 → `withChannel` 回 NAMESPACE_STATE_VIOLATION（`hub-connection.ts:313-322`）→ peer `finalize('failed')`。若 saveDoc 长期悬挂，投影永久滞留 'live' 且零流量（静默发散形态）。违 AC6「socket loss → disconnected → 重连按 §13.3 修复」承诺与 §13.4 L609。测试缺口：AC6 socket-loss 用例（ac6 `:178-205`）断线前已 settle（无在途 apply）；AC7「socket 断开与在途 apply」用例只验 drain 完成、**不重连**；AC6 bootstrap 断线用例（`:206-224`）断线发生在快照到达前（import 未开始）。
- **B-2e rebuild 不投影 namespace disconnected**：`requestRebuild`（`peer-connection.ts:473-485`）只做连接级 setState + close + 立即重拨，**不通知任何 namespace 控制器**——违设计 §4.3 L228「重建期间所有 namespace 投影 disconnected」字面。多 target 场景：兄弟活跃 ns（'live'）在新连接不被 `openActiveTargets` 重 OPEN，其首笔本地写把 UPDATE 发到无通道的新连接 → hub NAMESPACE_STATE_VIOLATION → 误 failed。冻结 re-add 用例为单 target 且被 re-add 者已显式置 'targeted'，故此面零覆盖。

**B-1/B-2 共同性质**：全部是「断开/收口 × 在途异步操作」竞态窗口的状态机守卫缺口；数据面无损坏风险（收敛由 state-vector diff 保证），但控制面会出现谎报投影、误 failed、永久停摆或 lease/session 泄漏——与既往 SA4 F1（静默发散）/F2（悬挂无兜底）同一严重度类别。全部 74 冻结用例绿，但无一覆盖上述组合。

## 6. 判断性意见（NON-BLOCKING）

- **N-1 围栏判别谓词两侧不一致且宽于 §11.1 字面**：`error-mapping.ts:33-35` `fenceHit = state!=='open' ∨ epoch 漂移`（把 **closed** 也判为 fence）；§11.1（设计 L511-516）谓词为「state==='conflicted' ∨ epoch 漂移」，且明文「state==='closed'（围栏未命中）→ 按 §13.4 迟到纪律收口（INTERNAL_ERROR 域本地终局，零 wire 假码）」。后果链：`mapEncodeThrow` 的 closed 分支（`error-mapping.ts:115-117`）成死代码；「session closed 而通道仍活跃」时帧处理钩子会把本应静默本地收口的事件送进 one-shot 终结器 → 发出**身份未变的 IDENTITY_CHANGED** + 终态 conflicted（把可经重连自愈的 failed 升级为需人工 reset 的 conflicted）。可达性被封堵于「通道持有 lease → Registry idle 仅在最后 lease release 后武装（namespace-registry #112 状态机）+ 协议 §21 停机顺序（ws-replication 先 drain）」之下，属结构性近似不可达；`fence-watchdog.ts:107` 的探测谓词反倒是窄口径（与设计 §12 L566 字面 `state!=='open'` 相反）——两份实现互换了两处设计的谓词宽窄。建议对齐 §11.1 窄谓词并删除死分支。
- **N-2 重复 ACK 无幂等容忍**：`update-channel.ts:74-86` 对「已 ACK 过的序列」（首 ACK 已删 inFlight）第二次 ACK 判 'violation' → ACK_STATE_VIOLATION 连接 fatal；设计 §10.3 L451 明文「zombieSeqs.has(seq) **或已 ACK 过的序列** → 良性 no-op（幂等容忍）」。诚实实现对下不可达（WS 不复制帧），严格化方向为 safe-fail；但与设计字面不符，且 §10.3 标注「双端对称」。
- **N-3 ACK 收口不重置计时**：`update-channel.ts:74-80` 仅在 inFlight 清零时解除计时器；最老 in-flight 被 ACK 而窗口非空时，剩余项沿用「最老发送时刻+ackTimeoutMs」的旧死线（设计 §10.3 L451「删除 **+ 重置计时**」；§16 L678「单计时器覆盖最老 in-flight」语义含混）。后果：次老项的有效 ack 预算被压缩，可能提前触发 needs-resync/恢复 round——数据安全（diff 修复），仅带宽/抖动代价。
- **N-4 GOAWAY→blocked 路径不通知 namespace 控制器**：`peer-connection.ts:340-344` 仅 `setState('blocked')`（对比 enterBlocked :449-451 有 onConnectionFatal 通知）；随后 hub 关连接时 `onClose:421` 在 blocked 提前返回 → ns 投影滞留 'live'（违协议 §16「socket 断开 → 控制器投影 disconnected」）、session/lease 不收口；此后 addTarget 重建时 `openActiveTargets` 跳过 'live'。与已登记的 R-12（切片 9 停机编排演进位）相邻，但「blocked 后 socket close 不投影 disconnected」比 R-12 文本更具体、且属本切片已实现的 GOAWAY 接收面内部。G2 用例（sa7-dynamic `:217-223`）只断言连接态，未断言 ns 投影。
- **N-5 hub 侧 ack timeout 只置 needs-resync、不声明 RESYNC_REQUIRED**：`hub-namespace.ts:624-626`。若 hub→peer 方向 ACK 单独失联而 peer 侧无恙，hub 通道停发且无恢复触发面（round 恒由 peer 发起）→ 单向静默停发直至对端事件/重连。设计 §10.4 字面仅书 peer 语义、§16 L678「hub 对称」未指明声明义务——**当前形态符合设计字面**；但对照 R4.2「hub 溢出=声明+等待」定案（设计 L569），建议演进位对称化或显式登记。
- **N-6 closing 窗口的 OPEN_OK/BOOTSTRAP_SNAPSHOT 被判违例降级 failed**：`peer-namespace.ts:199-204` / `:277-283`。R3/#5d 明文枚举仅「迟到 ERROR/IDENTITY_CHANGED」（设计 L595），故不违字面；但与 §13.4「零 wire 帧、零状态机迁移」精神不符（多回一帧 NAMESPACE_STATE_VIOLATION + 误分类 failed；failed 与 closed 的 re-add 恢复路径相同，实际影响≈误报）。注意：AC1 合流用例（ac1-ac2 `:240-251`）实际驱动了此路径——hub 回 2×OPEN_OK 后真实 peer 控制器收第二帧时 state≠'opening' → failed——但用例只断言 wire 面（OPEN_OK×2、authorize 计数），**未断言 peer 终态**，绿灯不证明合流后 peer 健康。
- **N-7 hub 侧 open 在途×连接断开的资源泄漏**：`hub-namespace.ts:225-227`（registry.open resolve 时通道已终态 → `finishOpenSilently` 时 `this.lease` 尚未赋值（:237）→ opened lease 不 release）；`:287-289`（openReplicationSession resolve 时已终态 → `this.session` 未赋值（:297）→ 新 session 不 close）。`finishOpenSilently:348-352` 只清已赋值字段。socket 断于 open 在途即可达；纯资源泄漏，无数据影响。
- **N-8 hub closing 态重开 OPEN 的 waiter 永不兑现**：`hub-namespace.ts:160-167` 压入「close 完成后答 REOPEN_REQUIRES_RECONNECT」的 waiter，但三个 flush 点（`:326-352`）均在 open 流程内；close 链（`:501-518`）完成后无任何 waiter 调用 → 该 OPEN 零应答（对端靠 openTimeout 收口）。本包 peer 结构性不产生同连接重开（re-add 必重建连接），仅注入/异端可达；实现意图未闭环。
- **N-9 两处实现自创语义（设计未规定，方向合理）**：hub 收 CLOSE_OK 合成 `onErrorFrame('NAMESPACE_STATE_VIOLATION')`（`hub-connection.ts:276-279`；hub 永不发 CLOSE）；hub 收 GOAWAY → CONNECTION_POLICY_VIOLATION（`:286-288`；注册表 direction=either，hub 收 GOAWAY 语义设计未书）。建议补登记进设计演进位。
- **N-10 CLOSE 接纳停止非字面「同步」**：hub `onCloseRequest:501-505` 在 closeQueue 下一微任务才置 'closing'；peer `onCloseRequest:412-426` 全程不置 'closing'（drain 窗口内投影仍 live、ws 层仍接纳，由 session.close 屏障兜底）。实际窗口由传输有序性 + 对端停发纪律封闭；v1 hub 永不发 CLOSE（peer 侧为休眠对称面）。协议 §12「Receiver 同步停止 session 接纳」字面 vs 实现为「下一微任务停止」。
- **N-11 死代码/化妆项**（既往已部分登记）：`onConnectionReady` 无调用点（`peer-namespace.ts:551-557`，功能由 openActiveTargets 内联）；`finalize` 空 if 块（`:790-791`）；`onRemoteOpen` 空 if 块（`peer-connection.ts:324-326`）；OutboundQueue dataQueues/round-robin 从未喂入（`frame-io.ts:101-104`，R-11 已登记切片 7）；hub `armTimer('close')` 无调用点（`hub-namespace.ts:814-822`，hub 不发 CLOSE 故结构性无需）；`onAckTimeoutFired` 的 512 微任务推迟（`peer-namespace.ts:592-603`）为测试可观测性驱动的幻数（有注释、功能正确，建议登记解释）。另：`testing.ts` 内存双端 close 不自通知本端（`testing.ts:22-28`），与真实 WS 语义有别，harness 以 `closePeerSide/closeHubSide` 同模补偿（harness.ts:158-174），已文档化——切片 7 接真实 transport 时注意。
- **N-12 测试充分性意见（不阻塞）**：① ac1-ac2 `:250` 合流用例 authorize 计数断言为 `≥1`，弱于冻结锚「恰一次」（实现行为正确——`hub-namespace.ts:199-201` openInFlight 门闩——仅断言强度不足）；② peer 本地 disabled 副本响亮失败（§5.2/§15.2；`peer-namespace.ts:178-182`）无专测——AC2 的「禁用」锚仅盖 hub 侧 REPLICATION_NOT_ENABLED（ac1-ac2 `:196-208`）；③ 建议为 B-1/B-2 簇补红灯用例（现有 gate/drop/inject seam 足以确定性构造）。

## 7. 测试与 AC 映射充分性总评

AC 清单 7/7 ✅ 的**断言证据逐条抽查属实**（§1 表内行号），关键用例断言的确实是 AC 语义本身（时序、帧序、收敛、终态、零泄漏），无「断言实现细节冒充行为」的错位；基建真实（真 yjs/Registry/Runtime/codec，仅 Persistence 为可编程 stub；fake scheduler + 零 real sleep；注入 seam 保序撞号纪律有 driver.inject* 注释约束）。充分性缺口集中在 §5 所列竞态组合与 §6 N-12 的三处断言/覆盖弱化——它们不否定 7/7 的既有结论，但意味着「绿」不等于对本报告 B-1/B-2 场景的免疫。

## 8. 最终结论

**has-blocking-findings**

- 需求面（7 AC + What-to-build）：完整交付，无缺失/半成品；无 scope creep。
- 设计/协议符合面：主干逐项符合（§2 契约面逐字段、§4.1 序列纪律 ADR 字面、§10.5 同连接恢复、§11 三层映射、§12 三层检测+one-shot、§13 七行矩阵、§16 timer 清单均落实）。
- 阻塞项：**B-1**（onRoundSettled 无守卫 → removeTarget×reconcile 竞态永久假活）、**B-2 簇**（§13.4「连接已断」半句未实现 → 五组迟到续体竞态，最重者为 AC6 重连修复承诺在在途 apply 跨重连时不成立）、**G-1**（`git diff --check` exit 2，一行可修）。
- 建议流转：B-1/B-2 回流实现侧修复 + SA6 补红灯（N-12③）；G-1 一行修复；N-1..N-12 按判断性意见登记或顺手收口后，本轴可复审转 clear。
