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

---

# R2 复审节（同会话第二轮，2026-08-30）

- **审查 diff range（逐字）：`ff50d47..51bcbd5`**（`git diff ff50d47..51bcbd5`；R1→R2 增量 `f557b68..51bcbd5` = 红锚 0336dce/6ab9e32 + 修复 0324d8f/12258c2 + wiki 过程文档；增量 src 仅 `peer-connection.ts` +16/−2、`peer-namespace.ts` 约 +120/−21，测试 +2 新文件/+2 追加/−1 EOF 行，全在 ALLOW）
- 方法：R1 结论对未变更文件继续有效；本轮 = R1 基线 + delta 逐行精读（src delta 全部、新增/变更测试全部、harness delta）+ 红锚断言真实性逐条核验 + 新机制（connectionEpoch 代际守卫 / 投影先行 / sendControl ready 门 / cleanup 当前身份守卫）偏离扫描。静态复审，未重跑测试（绿灯引 SA4 R5 / SA7 R4 / 总控 verify5 三方一致记录：包级 12 文件/82 IT、全仓 165 文件/1953 IT、typecheck、diff-check 全绿）。

## R2.1 R1 阻塞项逐条消解核验

| R1 项 | 修复形态（代码核验，行号为当前版本） | 红锚（断言真实性核验） | 结论 |
|---|---|---|---|
| **B-1** onRoundSettled 无守卫 | `peer-namespace.ts:615-624`：`state !== 'reconciling'` → 只清 reconcile timer、零迁移（注释明引 §5.1 L250/§13.4）——closing/终态/断开期迟到结算不再复活 live | `ws-replication-spec-b1-b2-red.test.ts:58-93`：saveGate 悬挂本端 Step2 apply + `waitHubSent('SYNC_APPLIED')` 锁定对端 Applied 已收 + removeTarget + `dropNextHubFrame('CLOSE_OK')`（消除随机序，收口只走 closeTimeout）→ 释 gate → 断言 closed 达成、closePromise 结算、**re-add 后 dialCount 增加**并回 live——断言确为「不复活 + 收口 + re-add 非 no-op」语义本体 | ✅ 消解 |
| **B-2a** 导入终态不回收 lease | `:349-357`：迟到判别（isConnectionDead ∨ epoch 漂移）→ `releaseLeaseOrNoop(importResult.lease)`（§8 L361 字面落实），零 wire 零迁移 | 无公共观测面（Registry 无 lease 列表 API，简报已记录理由）→ SA7 R3 终态变体动态闭项 `ws-replication-sa7-dynamic.test.ts` B2a IT：导入悬挂 + removeTarget 至 closed → 冻结 wire 快照 → 释导入 → 断言**双向零新帧、零 BOOTSTRAP_ACK、零 ERROR、投影恒 closed** + re-add 重建后写双向收敛（回收未损伤持久化面）+ 零 unhandled rejection | ✅ 消解 |
| **B-2b** 导入迟到遇 disconnected 假迁移 | 同上判别面 + `:368-372` 发 BOOTSTRAP_ACK 前二次 epoch 兜底——不再 setState('reconciling')/发迟到控制帧；重连由 openActiveTargets 重 OPEN（已导入副本走 mode1 reconcile） | 同文件 `:95-115`：importHold 悬挂于 bootstrapping → 断线 → disconnected → 释导入 → 重连 → 断言 **OPEN_NAMESPACE 恰 2**（重 OPEN 发生）+ 收敛 live | ✅ 消解 |
| **B-2c** startOpen 迟到续体 | `:143` 入口捕获 epoch；registry.open await 后 `:154-160` 判别 → 迟到交付 lease 即释、**不覆盖 this.lease、不发 OPEN**；getStatus 后 `:187-193` 同款判别 + lease 回收 | 同文件 `:117-141`：harness 新增 loadGate 单次门闩卡住 registry.open → 断线 → 重连（Registry carrier FIFO 排队 #2）→ 释门闩 → 断言 **OPEN 恰 1**（迟到续体零 wire）+ 收敛 live | ✅ 消解 |
| **B-2d** 在途 apply 跨重连 | 三件套：① 投影先行——`onConnectionLost/onConnectionFatal`（`:563-584`）同步置 'disconnected'、cleanup 异步（openActiveTargets 不再跳过滞留 'live'）；② `applyRemoteUpdate:754` 与 `applyStep2:727` 入口捕获 epoch，迟到 ACK/Applied 零 wire；③ `closeSessionAndRelease:891-910` 当前身份守卫（`this.session===session && this.lease===lease` 才 teardown 通道级状态；unsubscribe 入口捕获 + 双重身份判别——SA4 R4-2/SA7 D2 修复面） | 同文件 `:143-168`：saveGate 悬挂 hub→peer UPDATE apply → 断线 → 25ms 快速重连 → 断言 **OPEN×2**（re-OPEN 发生）→ 释 gate → 断言收敛 **live + hub/peer n=1**（迟到 ACK 不再误 failed）——AC6 重连修复承诺在竞态下成立；+ SA7 D2 IT：live 后 writePeer → 当前连接 UPDATE ≥1 + 双向收敛（新 listener 未被误杀） | ✅ 消解 |
| **B-2e** rebuild 不投影 disconnected | `peer-connection.ts:490-494`：requestRebuild 通知全部控制器 `onConnectionLost()`（§4.3 L228 字面落实）+ `:396` sendControl ready 状态门（迟到帧不落新连接 handshaking 窗口） | 同文件 `:170-227`：双 namespace 装配 → A remove→closed→re-add 触发重建 → 断言**全 wire OPEN 恰 4**（A×2 + **B×2**——兄弟 ns 重 OPEN）+ B 后续写后 B 恒 live（非误 failed） | ✅ 消解 |
| **G-1** EOF 空行 | r3-r4-regressions.test.ts −1 行；本轮实测 `git diff --check ff50d47..51bcbd5` **exit 0** | —（门禁项） | ✅ 消解 |

**B-1/B-2 七项（含 SA4 R4-1/R4-2/R4-3 同族回流）全部治本消解**：修复为机制级（代际判别 + 投影先行 + 当前身份守卫），非断言迁就；6 条新红锚全部为行为级断言（wire 帧计数/状态投影/收敛数据/错误码，零源码 grep），并经 SA4 R5 同源复现与 SA7 R4 三连跑独立转绿。

## R2.2 delta 偏离扫描（新机制专项）

- **connectionEpoch 机制**：私有于包内 `PeerNamespaceHost`（公共契约面零触碰，api.test-d.ts 无 delta）✓；`dialNow`（peer-connection.ts:169）唯一递增点 ✓；全部 await 续体（registry.open / getStatus / importReplica / openReplicationSession / apply×2 / openSessionAndStartRound）判别完备（SA4 R5 逐点核对，本复审抽核一致）。
- **sendControl ready 门**：HELLO 握手帧正确绕行（`peer-connection.ts:188` 直发 outbound）✓；副作用「握手期 connection ERROR 被抑制」已由 SA4 R4-4 登记为设计 **R-13**（设计 §23 新增行；切片 7 精确化：epoch 判据或 connection 级 ERROR 豁免）——本复审同意该定级（nano，诊断面弱化、close code 仍正确），不另立发现。
- **投影先行**：'disconnected' 期 onOwnedUpdate 不投递（AC6「断线写零 UPDATE」锚保持）✓；removeTarget 的 'disconnected' 行即时结算 + 残留 cleanup 后台静默回收——与设计 §13.1 该行「lease/session 若残留则走静默回收」字面一致 ✓（R1 形态下该行仅在 cleanup 完成后可达；R2 形态更贴设计文本）。cleanup 双链（closeMemo/cleanupTail）并发下的 lease 双释放可能性为 R1 既有形态，且 Registry `lease.release` same-Promise 幂等 + `onReleased` 恰一次（lease.ts:202-218）→ 良性，不立发现。
- **re-add while 'disconnected' 组合复验**：'disconnected' 投影与连接 ready 结构性不共存（openActiveTargets 在 ready 同步段即收编全部 disconnected+active 控制器）→「re-add 后无人重 OPEN」窗口不存在 ✓（排除一疑似缺口）。
- 冻结测试零断言改动（delta 中既有测试文件仅 r3-r4 的 EOF 一行删除 + sa7-dynamic 纯追加）✓；harness 变更仅新增 loadGate 门闩（测试基建 hook，SA3 许可面）✓；wiki 变更均为过程文档 ✓。

## R2.3 新增判断性意见（NON-BLOCKING，delta 暴露的残余面）

- **N2-1（MINOR）round 引擎迟到续体缺 round 代际判别**：`round-engine.ts:188-195` `applyStep2Safely` 续体无条件写当前 `this.state.remoteDiffAppliedLocally`——「reconciling 期断线 + 本端 Step2(r1) apply 悬挂 + 悬挂跨重连 + startRound(r2) 已 resetState」时，r1 的迟到结算把 r2 的 flag 置位；此后 hub 的 SYNC_APPLIED(r2) 到达即 settle → **live 投影可能早于本端 r2 diff apply 完成一个窗口**。数据面零损失（r2 diff 随后照常 apply，CRDT 合并收敛；§9.2 帧入口的 roundId/relatedStep1Sequence 校验不受污染——wire 有序保证 hub SYNC_APPLIED(r2) 必在其 Step2(r2) 之后到达，r2 apply 已入 sequencer 排队）；后果为瞬态提前 live，自愈。当前测试矩阵未覆盖「reconciling 态断线 + 跨重连悬挂」组合（B-1 红锚断线后不重连；B-2d/D2 红锚断线于 live 态）。建议：`applyStep2Safely` 启动时捕获 `currentRound`、续体比对后再置位（与 connectionEpoch 同模式）。
- **N2-2（MINOR）身份守卫跳过 teardown 的残留面**：`closeSessionAndRelease` 当前身份守卫失配时整体跳过 watchdog/round/channel teardown——旧连接 channel 的陈旧 inFlight/zombie 集合带入新生命周期；陈旧 in-flight 永无 ACK → ack timer 触发一次 needs-resync → 多余一个恢复 round（数据安全、带宽代价；watchdog 经回调探测当前 session、round 由 startRound 重置，均不自伤）。可达性需旧 cleanup 屏障跨越完整重连 + 重 OPEN（病态持久化悬挂域）。建议：守卫失配分支补「round 未 running 时补 teardown round/channel」或登记演进位。

## R2.4 全轴复验结论

- 7 AC / What-to-build：维持 R1「完整交付」结论；本轮新增 8 IT（5 Spec 红锚 + 1 SA4 红锚 + 2 SA7 闭项/红锚）进一步补强 AC6（重连修复竞态面）与 AC7（故障清理竞态面）断言证据——AC 映射充分性较 R1 提升。
- 设计/协议符合性：R1 符合面全部维持；§13.4「已终局/连接已断」半句现已完整实现；§4.3 L228、§5.1 L250、§8 L361 字面均落实。
- scope creep：delta 零公共面扩张、零非目标夹带 ✓。
- R1 非阻塞意见处置：N-4/N-5/N-6/N-7/N-8/N-10 维持 open（登记/演进位面，不阻塞）；N-1..N-3、N-9、N-11、N-12 维持 R1 记录；sendControl 门的副作用角已由 R-13 登记覆盖。

## R2.5 R2 最终结论

**clear**——R1 全部阻塞项（B-1、B-2a~e、G-1）治本消解且红锚真实充分；delta 扫描无新阻塞发现，仅两条 MINOR 判断性意见（N2-1/N2-2，均窄窗口、数据安全、自愈，建议登记或随切片 7 顺手收口）。本节结论取代 R1 §8 的 has-blocking-findings 作为本轴当前有效结论。
