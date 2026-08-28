# Spec review 终审报告 — issue #137（Phase 5：multiplex namespaces with bounded fair backpressure）

- 审查轴：**Spec review（规格符合性）**；独立终审，不与其他 review 轴交换上下文；不改代码/测试、不 push、不开 PR
- **审查 diff range（逐字）：`6f2676f..179495b`**（`git diff 6f2676f..179495b`；基点 6f2676f = PR #160 merge commit，终点 179495b = 分支 `fix/issue-137-on-docs-phase-5-websocket-replication` HEAD）
- diff 构成：22 文件 +3882/−82——`packages/ws-replication`（7 src + 4 test + package.json 版本行）+ `wiki/raw/task_phase5-ws-multiplex-backpressure*` 10 份任务档案
- 规格基准：issue #137 原文 AC-1~AC-7（简报 `task_phase5-ws-multiplex-backpressure.md` §Acceptance criteria 逐字收录）；设计定稿 R3 `…_design.md`（715 行，D1–D11 见 `…_relevant_decisions.md` 末节）；wire contract `docs/protocols/instance-replication-v1.md` §10/§13.1/§14/§17/§18；AC 门禁核对表 `…_ac_checklist.md`
- 方法：diff 全量逐文件精读（src 7/7、test 4/4）；AC 逐条对实现锚点到行号；协议语义以 wire contract 字面复核；AC 核对表证据真实性核验——**含本轴独立复跑**：`pnpm exec vitest run packages/ws-replication --no-typecheck` → **13 文件 84 IT 全绿，exit 0**（2026-08-29 01:56 本 worktree 实跑），与 checklist/SA7 报告记录吻合

---

## Verdict: **clear**（无阻断发现；3 条非阻断留痕，见 §5）

> **R2 复终审（2026-08-29，更新后 diff `6f2676f..a32eb1e`）：Verdict: clear** —— 见 §7；R1 三条非阻断留痕维持，R2 新增 1 条信息级留痕 N-4。

---

## 1. AC-1~AC-7 逐条比对

| AC | 判定 | 实现锚点与证据（文件:行号） | 测试承担 |
|---|---|---|---|
| AC-1（单连接按 namespaceId 多路复用；禁止同连接重开已关闭 ns） | ✅ 完整覆盖（已绿域零重做，符合 R0-1） | open/reopen/状态机路径**零 diff**——peer-namespace/hub-namespace 改动恰为 facet 适配器 + host 钩子 + sendUpdateFrame 改道（`peer-namespace.ts:92-106,147-153,743-757`；`hub-namespace.ts:99-115,153-159,659-670`）；namespaceId 直携不变量未触碰 | 既有 `ws-replication-ac1-ac2-open.test.ts`（12 IT，含 NAMESPACE_REOPEN_REQUIRES_RECONNECT 矩阵，本轴复跑绿）+ 红锚文件 bootMulti 单连接 multiplex 全部 target 守卫 |
| AC-2（有界 count/bytes、可配窗口、ACK timeout、**未发送合并**） | ✅ 完整覆盖 | 有界/窗口/timeout 为 #136 已绿域（`update-channel.ts:124-130 overflows`、`:236-244 armAckTimer` 语义不变）；**合并 = 本任务新实现**：判据恰为 D8 钉死的 `queuedCount > avail`（`update-channel.ts:177-178`），贪心累计原始字节 ≤ maxUpdateBytes 且至少一项（`:181-189`），`Y.mergeUpdates` 仅多笔时调用（`:198-200`）；核减口径 = 入账字节之和（`:188,193`——SA2 #1 账务一致性修复逐字落实）；合并产物一帧/一序列号/一项 inFlight（`:169-172`） | 红锚 `AC-2:`（窗口 1 + saveGate 扣 ACK → 4 写 2 帧 < 4 + 双侧收敛 n=14 + 本地状态保留守卫）；本轴复跑绿 |
| AC-3（溢出只丢该 ns 未发送增量 + needs-resync + 本地已接受 Y.Doc 状态保留） | ✅ 完整覆盖 | per-ns 溢出路径逐字不动（`update-channel.ts:80-89`：discardQueued + live→declareLocalResync / deferred→notePendingResync）；连接级 shed 同构（D6）：`discardForConnectionPressure` = discardQueued + needsResync（`:211-214`）+ facet 按 live 性分派 declareLocalResync/declareHubResync/pendingResync（`peer-namespace.ts:97-105`、`hub-namespace.ts:102-113`）；全程无 Y.Doc 回滚面 | 红锚 `AC-5:` 守卫断言逐字对应 AC-3 三要素：恰 A needs-resync / B live / `rootValue('peer', a, 'blurb')===BLOB[2]`（本地已接受状态保留）/ 连接 ready |
| AC-4（control/error/ACK 优先 + data RR 每轮每 ns 至多一帧） | ✅ 完整覆盖 | control 恒先：OutboundQueue control 队列入队即排空、不经水位闸门（`frame-io.ts:115-136`；sender.sendControl 只做观察 + 额度判据，不阻塞 control——`backpressure.ts:71-85`）；RR：插入序 wheel + 旋转游标，一次 pass 每 ns 至多一次 `pullAndSendOne`（`backpressure.ts:136-161`，`:157`）；「消费即进展」R3 方案 A 逐字落实（`:157` + `update-channel.ts:164-172` 前置五条任一不满足 → false 不消费；消费后无条件 true） | 红锚 `AC-6a+AC-4:` 恢复段帧序恰 `[a,b,a,b,a,b]`；control 优先由红锚 `AC-6b:`（高压下 UPDATE_ACK ≥1 照常出）承担；SA7 D4 锚 R2-N1 活性（超限项消费后合法项同一 drain 收敛、超限项零 wire 帧） |
| AC-5（连接总压收口 queued ns + control 保留额度 + 耗尽可能 = 分类连接失败） | ✅ 完整覆盖 | 记账域 = Σ facet.queuedBytes() 只计未发送 data（`backpressure.ts:236-241`）；触发严格大于、停止 Σ ≤ cap（`:216-222`，`total <= cap → return`——AC-5 数值 60KB==cap 不触发/90KB 触发逐值吻合）；victim = 最大 queued、并列取 wheel 序先者（`:244-257` 严格 `>` 保先者）；保留额度 = lowWater 字节、暂停段按 onEmitted 实际编码字节记账（`:96-101`）；耗尽谓词逐字为 R2 钉死的 `controlReserveUsed + frameBytes > lowWater`（`:79`），触发帧不发送即收口；判据确定性：measureFrame 探针序列号 0 与真实序列号帧长逐字节相同——envelope sequence 为定长 4 字节 BE 字段（`replication-protocol/src/envelope.ts:181 writeBe32`，本轴核实） | 红锚 `AC-5:`（90KB>60KB → 恰收口 A → 恢复 round 补齐收敛）；SA7 D3a（lowWater=1 首控制帧即触发）/D3b（缺省 64KiB 大 BOOTSTRAP 帧不上 wire）/D3c（lowWater=100 精确放行 floor(100/ackBytes) 帧——异形谓词 `used ≥ lowWater` 会多发 1 帧即红）三互补面 |
| AC-6（bufferedAmount 高/低水位闸门 + Cordis 调度 + 不阻塞 Runtime sequencer） | ✅ 完整覆盖 | 鸭子类型属性读取、缺失/非 number/非有限/throw → 0=无压力（`peer-connection.ts:446-461`、`hub-connection.ts:402-410`）；hysteresis：`> highWater` 暂停 / 暂停段 `≤ lowWater` 恢复并立即 drain / 两水位间保持（`backpressure.ts:166-174` + `:176-181`）；观察时机恰三处（sendControl/tryEmitData·dataGateOpen/poll 到期）；poll = 注入 ReplicationTimer、`BACKPRESSURE_POLL_INTERVAL_MS = 1_000` 冻结常量、仅暂停段武装、stale fire 零副作用不重武装（`:55,183-194`）；零 native timer（本轴 grep 核实）；不进 sequencer 为结构属性——backpressure.ts 不 import Runtime/Lease/Registry（依赖方向保证），且红锚实测暂停段本地写照常完成 | 红锚 `AC-6a+AC-4:`（2×highWater 下零 UPDATE 帧 + peer 本地 13/23 + 连接 ready）与 `AC-6b:`（hub 高压零 fan-out + UPDATE_ACK 照常 + hub 本地 n=9）；SA7 D5（GOAWAY drain-close 前 teardown、poll timer pending 恰回退 1） |
| AC-7（测试演示 fairness / no starvation / independent failure / queue·window limits / reconnect repair / bounded memory under adversarial traffic） | ✅ 完整覆盖（六轴均有真实测试承担） | — | fairness/no-starvation：红锚恢复段严格交替 + D4 活性守卫；independent failure：红锚 AC-5（A shed/B live）+ #136 套件；queue/window limits：既有 ac5-live/spec-b1-b2（per-ns 上限）+ AC-5 连接 cap；reconnect repair：D3a/D3b/D3c 均含撤压重连恢复闭环 + #136 ac6-resync-close 套件；bounded memory：三层上限（per-ns count/bytes、连接 cap shed、control 额度耗尽收口）各自有测试承担 + D4 敌意注入（20039B 超限项 > 8KB maxUpdateBytes）——结构性演示（无 RSS 直测），与协议 §17 上限语义等价的标准诠释 |

**小结：AC-1~AC-7 无缺失、无部分实现、无语义偏差。** 五个重点判据逐一复核全部与钉死文本逐字吻合：合并判据 `queuedCount > avail`（update-channel.ts:178）、耗尽谓词 `used + frame > lowWater`（backpressure.ts:79）、shed 严格大于触发 + `Σ ≤ cap` 停止（:218-222）、RR 每轮每 ns 至多一帧（:157）、「消费即进展」（update-channel.ts:164-172）。

## 2. 范围蔓延核验（设计 §14 ALLOW/DENY）

- **ALLOW LIST 对账**：7 个 src 文件全部在 §14 ALLOW 内（backpressure.ts 新建 275 行 vs 预估 ~220；frame-io +59/−? 、update-channel +116、peer/hub-connection、peer/hub-namespace 修改量与 §6 预估同量级）；测试面 = SA6 owned 三件（harness.ts 仅 saveGates 最小扩展 10 行、issue137-driver.ts、红锚文件）+ SA7 新增 1 件（sa7-issue137-dynamic.test.ts——设计 §4.3「SA7 动态验证按 SA2 §5-F3 配方扩展」明文预期的新增面，非对既有 73 IT 的改动）。
- **DENY LIST 零触碰**（本轴以 `git diff --name-only` 全量核实）：types.ts / defaults.ts / validate.ts / index.ts / round-engine.ts / fence-watchdog.ts / lifecycle-queue.ts / error-mapping.ts / testing.ts / replication-protocol/** / namespace-registry/** / namespace-runtime/** / doc-runtime/** / apps/** / docs/** ——全部零 diff。R0-4（冻结公共契约面）成立：backpressure.ts 不经 index.ts 导出；`DuplexTransport` 零新字段（鸭子类型读取落在连接层私有方法）。
- **设计外能力零引入**：无新消息码/字段/错误码（CONNECTION_BACKPRESSURE 复用注册表既有条目 `errors.ts:108`）；无新配置字段（poll 间隔为包内冻结常量，D2）；无 observer 接口/transport 抽象层（R0-3 成立）；无新状态机状态（R0-1 成立：连接态/ns 态枚举零 diff）；简报 §范围边界各项（分布式 Registry/多 hub/p2p/awareness/durable outbox/第二 transport/认证细节/apps composition root）零夹带。
- **唯一范围偏差**：`packages/ws-replication/package.json` 0.1.0→0.1.1 不在 §14 ALLOW LIST 内——SA4 已登记为 F2 文档债（LOW·非阻断，回流 SA1 备忘；见 sa4_review.md §1.1/§F2）。本轴复核：私有包（`private: true`）版本字段零运行时影响，且仓库存在逐任务 patch bump 惯例（其他包 0.1.1/0.2.2 等版本随各自 feature commit 演进，无 changesets 设施）。维持 SA4 F2 定性，**非阻断**（见 §5 N-1）。
- wiki/raw 10 份任务档案为流水线规定产物，不属范围蔓延。

## 3. 协议语义正确性（以 wire contract 为基准）

- **序列号单点分配**：✅ `emitOne` 仍是唯一 `lastSeq` 变更点（`frame-io.ts:147-164`）；control（sendControl→drain）与 data（`emit`，:130-132）同经此点；「实际交付序 = 序列序」成立——control 插队只跳过未出队 data 项（未消费序列号），无 SEQUENCE_VIOLATION 自伤面；uint32 耗尽响亮收口路径保留（onSequenceExhausted 直发 + close(1008)）。
- **ACK 守恒**：✅ 合并帧消费一个序列号、登记一项 inFlight（update-channel.ts:169-172）；hub apply 合并增量（含全部 increments）后单 ACK 对应 ackedSequence；onAck 簿记无特例（:97-109）；核减口径防 phantom 字节（:188,193）——overflows/facet.queuedBytes/连接 cap 三套记账口径互逆一致（SA2 #1 修复落实）。
- **needs-resync 状态机**：✅ shed 后 peer `declareLocalResync`（RESYNC_REQUIRED{reasonCode:'send-queue-overflow'} + needs-resync + `maybeStartRecovery` 等 in-flight 窗口收口后同连接新 round——peer-namespace.ts:688-707，逐字符合 §9.4「发出后不再发送新 UPDATE；已接纳 update 正常 apply/ACK；Peer 等待 in-flight 窗口收口后开始新 round」）；hub「声明 + 等待 peer 新 round」（hub-namespace.ts:640-650）符合 §10.5「round 恒由 peer 发起」；非 live 通道 `pendingResync` 分派与 #136 §5.3 同款；needs-resync 非 sticky（resetForLive → live），与 §10.2 语义一致；shed 不触发重建/重连（AC-5 锚连接保持 ready）。
- **CONNECTION_BACKPRESSURE 分类失败路径**：✅ 注册表条目 fatal=yes/retryable=yes/1011（errors.ts:108）与 §13.1/§14 逐字吻合；hub 侧 `connectionFatal('CONNECTION_BACKPRESSURE', 1011)`（hub-connection.ts:139→365-380：best-effort ERROR 直发 + close(1011) + closed + cleanup）；peer 侧 `failConnectionBackpressure`（peer-connection.ts:536-558：豁免 ERROR 直发绕过额度判据 → close(1011) → `onTemporaryFailure` backoff——retryable 语义，**不走** enterBlocked）；收端分类 1011 ∉ {1002,1008} → temporary（:500-504）；重入守卫（state ∈ {stopped/backoff/blocked/draining}）+ 收口 ERROR 直发使递归面为零（I-4 幂等来源 = 连接自身状态守卫，不依赖 transport.closed——逐字落实）；两侧连接收口路径（stop/enterBlocked/onTemporaryFailure/requestRebuild/scheduleDrainClose/hub close/onTransportClosed/connectionFatal/onSequenceExhausted）全部补 sender.teardown()，§8 矩阵含 R2 补行（GOAWAY drain-close）全覆盖。
- **有意的 wire 行为 delta（已登记，非发现）**：peer 收口 ERROR 改直发绕过 ready 门（peer-connection.ts:507-527）——handshaking 期 fatal 从 0 ERROR 帧变恰 1 帧。设计 §6.3 R2/§10 行 9 明文登记（协议 §14 best-effort 义务落实、#136 R-13 收口方向），既有 73 IT 零断言触及（本轴复跑证实零回归），SA7 D2 锚定新语义。**有意、已审、已锚定**。
- **SA4 F1 修复正确性复核**：deliver 快速路径闸门先行（update-channel.ts:74）——dataGateOpen 非纯读（暂停段撤压 → resume → 同步 drain 重入消费窗口空位），闸门先求值使窗口检查读到 drain 后真值，「窗口有空位 ∧ 闸门开」在发送时刻成立；杜绝了 inFlight = max+1 的超窗发射。修法正确且最小（commit 8f9751e 恰 1 文件 +5/−1）。

## 4. AC 门禁核对表证据真实性核验

| checklist 声明 | 本轴核验结果 |
|---|---|
| 84/84 两轮全绿（sa7-r137-full3/full4-vitest.exit=0） | ✅ 退出码文件存在且内容为 0（`.mabf-bg/sa7-r137-full3-vitest.exit`、`…-full4-vitest.exit`、`…-tsc5.exit` 均 = 0）；**本轴独立复跑：13 文件 84 IT 全绿，exit 0**（73 既有 + 4 红锚 + 7 SA7，计数与 checklist 拆解一致） |
| 四红锚转绿（AC-2 合并 2<4 / AC-6a 高压零帧 + [a,b,a,b,a,b] / AC-5 恰 A needs-resync / AC-6b 零 fan-out + ACK 照常） | ✅ 断言逐字存在于 `ws-replication-issue137-ac1-ac7-red.test.ts`（`AC-2:` :58 / `AC-6a+AC-4:` :97 / `AC-5:` :145 / `AC-6b:` :203，按 diff 全文精读）；SA3 未改断言（红锚文件仅出现于 SA3 实现 commit 9d4d0e2 的首次入库，此后零改动；F1 修复 commit 8f9751e 恰 1 src 文件） |
| SA7 D1–D5 七 IT | ✅ 存在于 `ws-replication-sa7-issue137-dynamic.test.ts`（D1/D2/D3a/D3b/D3c/D4/D5 共 7 it，本轴 grep + 复跑确认） |
| 「既有 73 IT 零回归」 | ✅ 复跑确认 73 既有全绿；DENY 面与其余测试文件零 diff |
| `git diff --check` clean | ✅ 本轴复跑 `git diff --check 6f2676f..179495b` → exit 0 |

## 5. 发现清单

### 阻断项（blocking-findings）：**无**

### 非阻断留痕（不阻塞发布；供后续轮次/归档参考）

- **N-1（LOW·文档债，与 SA4 F2 同一项）**：`package.json` 0.1.0→0.1.1 未列入设计 §14 ALLOW LIST。证据：diff `packages/ws-replication/package.json` 版本单行；设计 §14 ALLOW 无此文件（DENY 亦无）。零运行时影响（private 包）、仓库有逐任务 patch bump 惯例；建议下轮设计修订按 doc-runtime R4 先例以字段粒度补列「仅限 patch bump」，避免逐轮重复争议。
- **N-2（LOW·设计文本形式偏差，零行为 delta）**：`onAck` drain 触发条件与设计 §6.2 文本「inFlight 空位 ∧ queued 非空 → requestDataDrain()」差一个合取项——实现仅判 `queued.length > 0`（`update-channel.ts:101`）。窗口满时 requestDataDrain → drainData → pullAndSendOne 前置③（`:166`）自限返回 false → 全轮零进展退出，且窗口前置先于闸门检查（⑤在③后），该空调用零水位读取、零发射、零副作用。行为与设计逐语义等价，仅形式差；无需处置。
- **N-3（LOW·边界语义注记，F4  sanctioned 族）**：deliver 直发快速路径存在双读闸门微窗口——`update-channel.ts:74` 闸门检查通过后，发送点 `tryEmitData` 内再次 observeWater（`backpressure.ts:88-92`）；若其间 resume-drain 的同步发射把真实 bufferedAmount 推过 highWater（真实 WS 下可达；fake seam 静态值下不可达），该帧经 F4（seq=0）丢弃且不置 needs-resync——设计 §4.5 注记 a 将此边界建模为「过冲 ≤1 帧/方向」（发出），实现实际为「丢弃」。丢弃属 #136 已接受的 F4 处置族（与大小门丢弃同构，协议 §10.1 round diff 修复语义覆盖）：持续写下一次 deliver 即经队列路径自愈；静默连接上修复延迟至下一 round 成因（重连/RESYNC/溢出）。有界、无 AC 违反；登记供下轮设计修订知悉（如需精确对齐注记 a 的「过冲」措辞或接受「丢弃」为定案）。

## 6. 结论

diff `6f2676f..179495b` 对 issue #137 的 AC-1~AC-7 **完整覆盖、无部分实现、无语义偏差**；范围恰好落在设计 §14 ALLOW LIST 内（唯一偏差为已登记的 package.json 版本行文档债）；DENY 面与三条红线（已绿域零重做 / 两级队列属主不混同 / 不提前提取 transport seam）全部保持；wire contract 语义（序列单点、ACK 守恒、needs-resync 状态机、CONNECTION_BACKPRESSURE 分类失败）逐项复核正确；AC 核对表证据真实成立（含本轴独立复跑 84/84 + tsc 退出码核验）。**Verdict: clear**，非阻断留痕 N-1/N-2/N-3 如上。

---

## 7. R2 复终审（repair-and-repeat：Standards 轴 B1 修复后）

- 触发：Standards 轴 R1 verdict blocking-findings（恰 1 阻断 B1：onGoaway blocked 直达路径缺 sender teardown）→ 修复轮（SA3 代码 + SA1 设计 R4 对齐）→ 本轴按 repair-and-repeat 纪律对更新后 diff 复终审。
- **更新后 diff range（逐字）：`6f2676f..a32eb1e`**；新增 delta = `179495b..a32eb1e`：commit `622c291`（B1 修复：peer-connection.ts +5 / sa7 测试 +52）+ commit `a32eb1e`（wiki 档案：设计 R4 +30、dispatch 封口、两轴终审报告入库）。
- 方法：聚焦新增 delta 精读 + 全范围无回归确认；**本轴独立复跑** `pnpm exec vitest run packages/ws-replication --no-typecheck` → **13 文件 85 IT 全绿，exit 0**（2026-08-29 02:14 本 worktree 实跑；85 = R1 基线 84 + D5 变体 1），与 SA3 证据声明吻合。

### 7.1 B1 修复核验（622c291）

- **与设计 §8（R4 对齐后 739 行）teardown 矩阵一致性**：✅ 修复在 onGoaway `SERVER_SHUTTING_DOWN`/`REAUTH_REQUIRED` 直达分支 `setState('blocked')` 前补 `this.sender?.teardown()`（`peer-connection.ts:374-375`），与 §8 R4 成文的「blocked 两个入口均承担 teardown 义务」（① `enterBlocked()` :562；② onGoaway 直达分支——不经 enterBlocked）逐字对应；与同 handler 内 `scheduleDrainClose` 路径（:391）同型。（注：§8 行引用 :362-371 为修复前 blob 行号的缺口定位描述，修复后分支位于 :369-376——设计 R4 修订记录已明示「SA3 并行补实现」，引用指向缺口而非修复后位置，非失真。）
- **行为面不变性（仅资源清理，无超范围变化）**：✅ 逐行核验——blocked 分类语义不变（`setState('blocked')` 原样，无重拨编排，#136 G2 分类语义保持；`setState` 为裸 setter 无副作用）；wire 零变化（teardown 不发射任何帧）；协议状态机/close code/错误分类零触碰；效果仅为 poll timer 清除 + wheel/reserve 复位。修复前泄漏机理（poll 回调在 `tornDown=false ∧ paused=true` 下于 stale 高压 getter 上 1s 周期无限重武装，`backpressure.ts:196-200`）由 teardown 的 `tornDown=true` + `clearPoll` 闭合；红绿对照证据真实（`.mabf-bg/sa3-r137-b1-red.log`：未修复时 D5 变体 1 failed/7 skipped）。
- **D5 变体用例断言与 AC/协议语义一致性**：✅ —— GOAWAY(SERVER_SHUTTING_DOWN) → blocked 符合 §15.1/#136 分类；注入帧取 hub 方向下一期望序列（wire 纪律正确，不引入 SEQUENCE_VIOLATION 干扰）；`drainTimeoutMs: 0` 在 blocked 直达分支不被消费（仅 scheduleDrainClose 使用），语义自洽；主锚 `pending 恰回退 1` 锚定 poll 清除；`advanceBy(60s)` 后保持 blocked（无重拨编排）+ pending 不增长（零重武装）+ peerToHub wire 冻结 + 零 unhandled rejection——全部与 AC-6 timer 纪律（注入 scheduler、零 native timer）一致。

### 7.2 设计 R4 核验（a32eb1e；4 处落文 + 修订记录，diff 证实纯文本对齐、零架构/行为变更）

- **§8 blocked 双入口 teardown 义务**：与修复后实现一致（见 7.1）✓。
- **§15 B-2 补入（SA7 N2 回流——F4 round-repair 墓碑边界运维指导）**：运维登记类文本，无行为面含义；内容与 SA7 报告 N2 一致（被弃超限项为同链后续 delta 的 left-origin；修复 diff 含墓碑内容、`maxUpdateBytes < 单笔真实增量（含墓碑）` 时修复自身超限；指导 `maxUpdateBytes ≥ 单笔真实增量（含墓碑）`），落在协议 §17「配置保证单笔必可发送」既定边界内 ✓。
- **§15 B-8（本轴 R1 留痕 N-2/N-3 回流）转述保真核验**：✅ 无失真——
  - N-2 转述：「实现仅判 `queued.length > 0`（差『inFlight 空位』合取项）……前置③先于闸门检查⑤自限 false……零水位读取/零发射/零副作用，行为与 §6.2 文本逐语义等价（纯形式差）」——与本报告 §5 N-2 逐字吻合 ✓；
  - N-3 转述：「双读闸门微窗口（闸门检查 → tryEmitData 再观察，其间 resume-drain 同步发射可把真实 bufferedAmount 推过 highWater；真实 WS 可达、fake 静态值不可达）——实现为 F4 丢弃（seq=0、不置 needs-resync）而注记 a 建模为『过冲 ≤1 帧/方向（发出）』」——与本报告 §5 N-3 逐字吻合 ✓；处置（下轮修订二选一：对齐措辞 / 接受「丢弃」为定案）合理；
  - §4.5 注记 a 已加 B-8 指针（R4 注），「过冲 vs 丢弃」关系显式化，无残留自相矛盾 ✓。
- **dispatch log 增量**：R1 两轴 verdict 与本轴留痕数量的转述（Standards blocking-findings 恰 B1 / Spec clear + 3 非阻断）准确 ✓。

### 7.3 证据与无回归确认

| 项 | 结果 |
|---|---|
| SA3 证据 | `.mabf-bg/sa3-r137-b1-vitest.exit` / `-vitest2.exit` / `-tsc.exit` 均 EXIT=0 ✓（文件存在、内容核实） |
| 本轴独立复跑 | 13 文件 **85/85** 全绿，exit 0（02:14 实跑）——R1 84 IT 基线 + D5 变体 1 IT，零回归 |
| diff 面 | 新增 delta 仅触及 `peer-connection.ts`（+5，ALLOW LIST 内）与 sa7 测试文件（+52，新增用例非改动既有断言）；DENY 面零触碰保持；wiki 档案面为流程产物 |
| 红线保持 | R0-1 已绿域零重做 / R0-2 两级队列属主 / R0-3 无 transport seam 提取——修复轮零触及 |

### 7.4 R2 新增留痕（非阻断）

- **N-4（LOW·信息级）**：teardown 后 `dataGateOpen()`/`armPoll()` 无 `tornDown` 守卫——post-blocked 的 live 交付在 stale 高压 getter 下可触发一次 `enterPause` + 武装**单发** poll（`backpressure.ts:96-98,177-181,192-201`）。有界性论证：回调 `tornDown` 早退（:196）零副作用零重武装；`enterPause` 的 paused 守卫（:177-178）使重复交付不再叠臂——全程至多一次单发 fire，非泄漏、无 wire/AC 影响；D5 变体的 `pending ≤ pausedPending` 断言对该面天然耐受。设计 §8 防御声称「teardown 后 pollHandle 恒 undefined」在「teardown 后仍有闸门读取」形态下严格说来仅结论成立（零副作用/不重武装）而路径描述不周延。建议（可选，下轮修订）：`dataGateOpen`/`armPoll` 加 tornDown 早退，或 §8 防御注记补一句路径豁免。**不阻断**。

### 7.5 R2 结论

R1 三条非阻断留痕（N-1 package.json 文档债 / N-2 onAck 形式差 / N-3 双读闸门边界）**维持**——其中 N-2/N-3 已被设计 R4 §15 B-8 无失真收纳为下轮修订输入，非阻断定性不变。B1 修复正确、最小、与设计 §8 R4 矩阵一致，D5 变体断言与 AC/协议语义一致，SA3 证据真实，本轴独立复跑 85/85 零回归。**R2 Verdict: clear。**
