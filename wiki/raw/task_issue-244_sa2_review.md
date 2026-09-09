# SA2 独立设计攻击评审 — Issue #244（issue #233 切片 3：分块传输有界性加固与中止清理矩阵）

- Dispatch：`sa-2b96c08b-7824-41d0-bd91-84b628f74781`（mabf-sa2 / design-review / iteration 0）
- 评审对象：`wiki/raw/task_issue-244_design.md`（SA1 iteration 0，420 行，dispatch `sa-43e4de98`，SA1 自判可行/无阻塞、`requiresConflictRecheck=true` 已由 SA8 设计后复审履行且 clear）
- 上游输入：任务简报 `wiki/raw/task_issue-244.md`（零评论）+ SA6 已批准红灯契约 `wiki/raw/task_issue-244_sa6_contract.md` + 契约测试 `packages/ws-replication/test/ws-replication-issue244-ac-red.test.ts`（1044 行全文核读）+ SA8 前置门禁 `artifacts/sa8-conflict-gate-issue-244.md`（clear，R7–R10）+ **SA8 设计后复审 `artifacts/sa8-conflict-gate-issue-244-design.md`（clear，0 冲突，R11–R14 转交本评审）** + ADR 0013/0010 + `docs/protocols/instance-replication-v1.md`
- 工作区：worktree `nomicore-fix-issue-244`，分支 `mabf/issue-244`，HEAD `e2178f3`（与 SA1/SA6/SA8 各方 header 一致；`git status` 仅 6 个 untracked 产物文件，零 tracked 改动——本评审全部源码锚点因此有效）
- 评审方法与程序披露：`skills/attack-design/SKILL.md` 在本环境技能目录未注册（`.agents/skills/` 无该项；与 issue #243 SA2 同款披露）——按仓库既有 SA2 固定产物的同一程序执行：独立攻击视角、逐发现给触发条件/影响/可执行修订要求/测试构想、只读源码、零生产/测试/设计文件改动。本轮实读：契约测试全文（fixture/闸门/断言形态逐条）；`hub-namespace.ts`（onUpdateChunk 管线 646–708、transferViolation 710–717、DD-4 挂点 719–724/779/927、onCloseRequest 745–770、onResyncReceived 772–782、onConnectionClosed/quiesceConnection 807–835、watchdog/oneShotTerminal 857–899、declareHubResync 漏斗 910–936、onRoundSettled 1164–1182、finalize/settleClose 1210–1264、TimerKind/timers/armTimer 91/109–114/1424–1451、sendFacet shed 分派 133–147）；`peer-namespace.ts`（onHubUpdateChunk 637–692、transferViolation 694–702、onIdentityChanged 775–782、removeTarget 812–873、declareLocalResync 漏斗 1080–1108、maybeStartRecovery 1056–1063、applyOutcome fence 分支 1399–1403、finalize/cleanupResources 1451–1471、TIMER_DELAY_FIELD 96–102）；`hub-connection.ts`（构造校验 188–193、channels 436、channelHost 484–511、cleanupAll 890–910）；`peer-connection.ts`（controllers 59、host 102–131）；`update-transfer.ts` 全文（validateFirst 161–174、geometryConsistent 47–53、reset 88–96）；`update-channel.ts`（zombie/discardQueued→clearActiveTransfer/effectiveInFlightCount/sendOneChunk 96–120/170–245/390–445）；`validate.ts`/`defaults.ts`/`plugin.ts`/`harness.ts`/`types.ts`（事件联合 22 型逐行 side 核对、ResolvedTimeouts 先例 663–666）；ADR 0013 全文；协议 §9.4/§10.3/§13.2/§17/§18/§23.1–23.4；#245 issue body（`gh` 实取）。

## 1. Reviewed inputs

| 输入 | 状态 |
|---|---|
| `wiki/raw/task_issue-244.md`（Host 简报；`## Comments` 空） | 已读；AC1–AC7 与 issue body 一致 |
| `wiki/raw/task_issue-244_dispatch.md` | 已读；REST `[]`、零 owner 要求（与 SA6 §2/SA8 两轮一致） |
| `wiki/raw/task_issue-244_design.md`（SA1 iteration 0） | 已读（评审对象，420 行全文） |
| SA6 契约 + 红灯测试 | 已读；R1a/R1b/R2/R3/R4/R5a/R5b + N1–N4 断言形态逐条实读（含 `toContain`/`toHaveLength`/`filter(reason)` 结构投影） |
| SA8 前置门禁（R7–R10） | 已读；逐项核对设计 §6 落实 |
| SA8 设计后复审（R11–R14 转交） | 已读；四条注意项的事实主张全部独立复核（见 §5） |
| ADR 0013（L41/54/58/59/62/63/69–76/80/85–94/109）、ADR 0010、协议 §9.4/§13.2/§17/§18/§23 | 已读；冻结面逐字比对 |
| #245（OPEN，「issue #233 切片 4」，Blocked by #244） | `gh` 实取 body；登记四个事件类型 + 「aborted reason 闭集与切片 3 的全部中止路径一一对应」验收（见 R11 裁决 d） |

## 2. Verdict

**approve** —— 0 BLOCKER、0 MAJOR；**4 项 SA8 转交项全部裁决收口（R11/R12 为设计增量修订，R13/R14 为措辞修订）** + 2 项本评审独立措辞发现（W1/W2）。设计架构面（配置链、count 准入门、连接级槽位、滑动超时、事件 seam、发送端零改动）经源码级独立攻击后**全部成立**：§2 证据锚点抽样全量核验零漂移，SA6 契约 11 用例的转绿路径在 D1–D5 + 本评审 R11 增量下闭合，无不可实现点、无契约缺口。

裁决方式说明：dispatch 指令要求对 shed/epoch-fence wiring「assign or resolve 而非留给验证轮」——本评审以**裁决 (a)：wiring 拉回 #244 实现面**收口（附逐调用点接线规格，§5-R11），故 R11 不构成 reject 理由而是本评审吸收的有界设计增量；R12（补 `side`）为单字段类型面修订。两项修订均落在 SA8 设计后复审**预清理过的非冲突包络内**（R11 裁决「拉回 #244」仍属 ADR 0013 observer seam 已核对冻结面；R12 side 属 seam 结构惯例，SA8 明示两向裁决皆可）。

`requiresConflictRecheck: false` —— 本评审的全部修订不新增语义面：R11 拉回的两行 wiring 使用设计 D5 已有的 `clearInboundAssembly(reason)`/`teardownAbortReason` 机制（SA8 已核对）；R12 只补 seam 惯例字段（ADR L92 冻结的域键集不动）。R9 条件项照旧（父 PR #241 方向性返工则复审）。

## 3. 需求覆盖（AC → 设计 → 契约）

| Requirement | Design section | Assessment |
|---|---|---|
| AC1 四配置缺省 + 启动期校验链 + 零 clamp | §7-D1 | 覆盖；`assemblyTimeoutMs` 容器裁决 = timeouts（A5 裁决权在契约保留；R1a 断言两容器任一 `limitsRecord ?? timeoutsRecord` 实读核实——timeouts 选择满足）；`ResolvedTimeouts` 必填化有 `pingIntervalMs` 先例（types.ts:663–666 实读）；新键 Required 化不破坏 harness（`CONTRACT_LIMITS` 用包内自有 `WsReplicationLimits` 结构接口，非 `ReplicationLimits`——DENY LIST 可行性核实） |
| AC2 恶意申报分配前拒绝（count 维度） | §7-D2 | 覆盖；`geometryConsistent` 实读确认为上界单向判据（`chunkCount ≥ 1 ∧ totalBytes ≤ chunkCount × maxChunkBytes`，update-transfer.ts:47–53）——R2 的 65_536/4096 构型当前几何通过，count 门是唯一缺口维度，D2 命中正确；`>` 判定保 N2 边界；D2 落点（状态接纳门 + submit 门后、accept 前）与两侧源码插入点吻合（hub 668–684 / peer 661–673） |
| AC3 两错误码分类（含 R10 并发超额 → VIOLATION） | §7-D2/D3/D7 | 覆盖；`transferViolation` 签名已含两码联合（hub 711–717 / peer 694–702 实读）——D2/D3 复用单点类型相容；§13.2 注册表 L410–413 两码在册、retryable no/config 与简报一致 |
| AC4 滑动超时 → 弃 partial + RESYNC{EXPIRED} + 收敛 | §7-D4 | 覆盖；独立发射点裁决经源码证实为**必需**（两漏斗硬编码 `reasonCode:'send-queue-overflow'`——hub-namespace.ts:932 / peer-namespace.ts:1103，且 `resyncDeclared` 记忆化 hub:922–923 / peer:1090,1092——并入即错码或被吞）；hub TimerKind 现仅 `bootstrap/close`（:91）+ armTimer/`timers` Record/clearAllTimers seam（:109–114/:1424–1451）与 D4 扩展形态吻合；收敛链独立重推成立：`maybeStartRecovery` 门读**裸** `inFlightCount`（peer-namespace.ts:1058 实读），中间 chunk 不注册裸在途 + `markResyncReceived→discardQueued→clearActiveTransfer` 清 transfer 槽 → round 立即可开（设计 §2.3 论证比现实还保守） |
| AC5 中止矩阵全行丢弃 | §7-D5 + 本评审 R11 增量 | 覆盖（修订后）；丢弃面 7 行结构既有（DD-4 挂点全实读）；事件面 6 reason 在 R11 裁决后**全部** #244 接线（原设计留 shed/epoch-fence 两行无实现归属——见 §5-R11） |
| AC6 发送端中止簿记 | 非目标（基线绿） | 成立；zombieSeqs/`discardQueued→clearActiveTransfer` 单点/`effectiveInFlightCount` 唯一口径/teardown transferId 归 1（update-channel.ts:96/177–243/118–120/105–107 注释实读）与 SA6 §4 K7/K8/K9/S5/S7 绿灯互证 |
| AC7 全路径零部分写入 | §9（结构性） | 成立；`validateFirst` 全部先于分配、`completeIfExact` Σbytes 精确核对后恰一次 apply（update-transfer.ts 实读），新拒绝/中止路径全部先于 accept/apply |
| SA6 11 用例转绿闭合 | §12 | R1a/R1b→D1、R2→D2、R3→D4+D5、R4→D3、R5a/R5b→D5、N1–N4 保持——逐用例机制映射经源码独立验证成立（含 R3 三段断言链、R5a/R5b 事件时序先于 `setState('closed')` 可观察点） |

## 4. Owner 评论覆盖

Issue #244 零评论（dispatch REST `[]` + 简报 `## Comments` 空 + SA6 §2 + SA8 两轮一致）。无评论衍生约束或豁免；需求面 = issue body AC1–AC7。

## 5. SA8 转交项裁决（R11–R14）——本评审核心

### R11 · shed/epoch-fence 两行事件 wiring 的实现归属 → **裁决 (a)：拉回 #244 实现面**（设计增量修订）

- **触发条件**：busy inbound assembly 在场时发生连接 shed 或 epoch fence，期望 `chunked-update-aborted{reason:'shed'/'epoch-fence'}`。原设计 D5 表裁「本切片不接线」、§13 残差把 wiring+断言整体指给 SA7。
- **影响（为何不能维持原状）**：
  1. **角色错位**：SA7 是验证角色，无实现职权——两行 wiring 由此失去任何实现归属（SA8 已指出，本评审确认流程面无兜底）。
  2. **#245 验收死锁（本轮 `gh` 实取独立证实）**：#245 body 的验收含「chunked-update-aborted 的 reason 闭集与切片 3 的全部中止路径一一对应，计数不变量（每笔中止恰一事件）成立」。#244 不接线则该验收在 #245 侧只能由 #245 向 #244 的路径回填上下文——跨切片返工，正是切片边界要避免的形态。
  3. **词表半落地**：ADR 0013 L92 冻结的 reason 六值闭集若有两值在本切片路径上发生却永不发射，§23.1 登记将记录非行为（docs/AGENTS「不得虚构实现行为」的反向面：**已实现路径不登记可观测行为同样是文档-行为漂移**）。
  4. **自洽性**：设计 D5 已为 `resync-declared` 行接受「非门控完备性 wiring（SA7 动态面承接验证）」——同为无红灯断言的 wiring，拒绝 shed/epoch-fence 的同一理由将推翻其自身的 resync-declared 决策。
- **设计代价主张反驳（本评审独立核验）**：D5 表称 shed「发生在背压 drain 共享路径」、fence「骑 finalize(conflicted) 共享路径，需 per-facet 上下文穿透」——**实测两行的接线上下文都已就位，无需任何穿透**：
  - **shed**：两侧漏斗的 cause 参数在 `clearInboundAssembly()` 调用点已在作用域内（hub-namespace.ts:912–927 `declareHubResync(cause, …)` → :927 clear；peer-namespace.ts:1080–1098 同构），且 cause 联合已含 `'connection-shed'` 字面量（hub:916 / peer:1084 / observer 投影 types.ts:541）。wiring = 漏斗内一行条件：`clearInboundAssembly(cause === 'connection-shed' ? 'shed' : 'resync-declared')`。
  - **epoch-fence**：fence 终局入口全集**双侧恰 3 个**，全部是通道自有方法，且全部汇入设计 D5/§8.3 已有的 `teardownAbortReason` 消费链——hub `oneShotTerminal()`（hub-namespace.ts:869–899，watchdog/fence 帧处理合流点，`finalize('conflicted')` → `settleClose()` → **同步**调 `closeSessionAndRelease()`，:1259）；peer `onIdentityChanged()`（peer-namespace.ts:775–782）与 `applyOutcome` case `'fence'`（:1399–1403），二者 `finalize('conflicted')` → `cleanupResources()` → `claimForDisposal()`（同步捕获，排队前）→ `runDisposal(claim)`。wiring = 3 处入口各一行 `this.teardownAbortReason = 'epoch-fence'`（置于 finalize 之前，保证 claim 求值点前已置位）。
  - **非 live shed 分支语义澄清（修订设计须写明）**：hub `sendFacet.discardForConnectionPressure` 对非 live 通道只置 `pendingResync`（hub-namespace.ts:143–145），不清 assembly——这是**正确**行为而非矩阵缺口：needs-resync/reconciling 期接纳的入站 transfer 是合法跨 round 流量（onUpdateChunk busy 注释/ADR 0013 接收端规则的既有序言），此时丢弃反而错误；矩阵「连接 shed → partial 丢弃」在接收侧经 live 路径的 RESYNC 声明漏斗兑现（声明边即清）。修订文本应把该分支判定记为设计裁决而非遗漏。
- **可执行修订要求**（设计 §7-D5 表 + §8.3 表 + §1 非目标 + §13 残差同步改）：
  1. D5 reason 接线表删去「本切片不接线」行，改为两行：`shed` | 连接 shed（live 通道声明边） | 两漏斗 clear 调用点按 cause 判别 | SA7 动态断言；`epoch-fence` | epoch fence 终局 | hub `oneShotTerminal` / peer `onIdentityChanged` + `applyOutcome('fence')` 入口置位，`closeSessionAndRelease`/`runDisposal` 消费 | SA7 动态断言。
  2. D5「终局失败族不发事件」规则补**carve-out**：不发事件的是 failed 族（违例/远端 ERROR/revoke → `finalize('failed',…)`）；`conflicted` 族的 fence 入口经 `teardownAbortReason='epoch-fence'` **发射**（ADR 词表要求），避免实现轮把该规则误读到 fence 行。
  3. §13 残差项改写为「shed/epoch-fence/GOAWAY/queue-overflow/resync-declared 各行的**动态断言**归 SA7（wiring 已全部在本切片落地）」。
  4. **#245 登记同步（owner 域动作，设计 §13 须登记为移交项）**：#245 body 现文写「新增四个事件类型」含 aborted（本轮实取原文）——SA1 的 R7 裁决（aborted 归 #244、#245 承接成功三型）与 #245 现文不符，需 owner/总控把 #245 body 措辞同步为三型 + 引用 #244 已交付的 aborted；否则 SA7 在 #245 验收时会面对「验收文要求四型、代码三型在 #245 面外」的登记性假冲突。SA8 复审 §3 对 #245 body 的转述（「body 明确三型」）与实文有出入，以本轮 `gh` 实取为准。
- **测试构想**：SA7 动态场景各一——(i) shed：多 ns 背压构型（issue169/issue233 套件形态）触发 `discardForConnectionPressure` live 路径，断言被 shed 通道 `aborted{shed}` 恰一（busy 在场时）+ `resync-required{cause:'connection-shed'}` 互补在场；(ii) fence：`ac6-resync-close`/issue-176 形态驱动 epoch 冲突（或直接注入 IDENTITY_CHANGED），断言 `aborted{epoch-fence}` 恰一 + `identity-conflicted` 互补不重复 + 零 `namespace-failed`。实现轮红灯不强制（SA6 契约冻结面不含此二行——SA6 §15 已留 SA7），但 wiring 代码进 #244。

### R12 · 第 23 型缺 `side` 字段 → **裁决：补 `side: ReplicationObserverSide`**

- **触发条件**：任意消费者/登记表按 §23.1 结构消费 `chunked-update-aborted`。
- **影响**：实读证实 §23.1 登记表**每行都有 side 列**（协议 :658/:667/:673 连接域/channel 域/帧域三段表头均为 `| type | side | 字段 |`），且事件联合 22 型成员**全部**携带 `side`（types.ts:331–632 逐行核对：`ReplicationObserverSide` 或 `'hub'`/`'peer'` 字面量）。按设计现状第 23 型将成为唯一无 side 成员——§23.1 无法按既有表结构登记（该行 side 列无值可填），seam 一致性破例且无豁免收益。
- **裁决依据**：ADR 0013 L85 明文「对齐 §23 纪律」——§23 纪律含 side 判别（§23 开篇 + 表结构）；ADR L92 冻结的是**域键集**（namespaceId/transferId/reason/receivedChunks/receivedBytes），side 是 seam 结构性信封字段而非域字段，补 side 不触冻结面。`connectionId?` 维持缺席（ADR 对其余三型显式列出而对 aborted 未列——保持逐字忠实；发射侧可由 observer 实例判别）。契约兼容性实读证实零影响：契约测试用结构投影 `ChunkedAbortedLike`（`reason: string` + `filter(type)`，测试 :130–158）逐字段断言、无穷举键集断言——补 side 不碰任何红灯/负控；消费面 ws-server adapter 为转发型（apps/yjs-server/src/transport/ws-server.ts:133–147 实读）无 `event.side` 均匀读取点，零破坏面。
- **可执行修订要求**：D5 类型字面量加 `readonly side: ReplicationObserverSide;`；§6 R7 行与 D8 §23.1 登记措辞同步（登记行 side 列 = hub/peer）；删除「无 side/connectionId，与词表同源冻结」表述、改为「域键集逐字 ADR L92（无 connectionId）；side 为 §23 结构信封（22 型惯例 + ADR L85 对齐条款）」。
- **测试构想**：R3/R5a/R5b 事件断言各加一条 `aborted[0].side` 期望值断言（hub 侧场景 = 'hub'）——实现轮在契约文件外的新增测试中补（契约文件冻结不可改）；SA7 动态面双侧各覆盖一次（hub 侧 peer→hub assembly、peer 侧 hub→peer assembly）。

### R13 · GOAWAY 行表述内部不一致 → **裁决：GOAWAY 行 = 本切片已接线（connection-teardown reason），仅动态断言归 SA7**

- **触发条件**：读者据设计判断 GOAWAY drain 中止行是否有实现归属。
- **影响**：三处文本互相矛盾——§1 非目标称三行「发射 wiring 见 §7-D5 表」（暗示已接线）；D5 connection-teardown 行触发列**实际含**「GOAWAY drain deadline / stop」（hub `onConnectionClosed`/peer `onConnectionLost`+`onConnectionFatal`+`onConnectionStopped` 接线）；§13 残差却把「三行（含 GOAWAY）wiring + 动态断言」整体归 SA7。实现轮按 §13 执行则 GOAWAY 行事件缺失，按 D5 执行则 §13 不实。
- **裁决依据**：GOAWAY 无独立 reason（ADR 六值词表无 'goaway'）——其 drain deadline 在 peer 侧经连接失联/终收口（`onConnectionFatal`/`onConnectionStopped`，GOAWAY 静默窗 §D7 实读 peer-namespace.ts:940–949 等）、hub 侧经 `close()`→`cleanupAll` 汇入，全部落在 connection-teardown 接线面内。D5 表的映射是正确口径。
- **可执行修订要求**：统一三处为单一口径——「中止矩阵七行的**丢弃面**结构既有；**事件面**六 reason 全部 #244 接线（timeout/channel-teardown/connection-teardown（含 GOAWAY/stop）/resync-declared/shed/epoch-fence）；**断言面** = R3/R5a/R5b 契约红灯 + 其余行 SA7 动态断言」。R11 修订落地后 §13 残差自然只剩断言项。
- **测试构想**：SA7 用 GOAWAY drain 构型（issue-171 套件形态）断言 drain 窗内 busy assembly 被弃 + `aborted{connection-teardown}` 恰一 + 零 `namespace-failed`。

### R14 · R3 恢复断言措辞 → **裁决：按契约实文收紧**

- **触发条件**：实现轮据设计 §7-D4「R3 断言『恰含 EXPIRED』」理解转绿判据。
- **影响**：契约实文为三层组合而非「恰含」：`resyncReasons(ctx,'hubToPeer')` **`toContain('UPDATE_TRANSFER_EXPIRED')`**（测试 :752–755）+ peer 侧 `resync-required{cause:'remote-declared'}` **恰一**（:776–777，间接约束 hub→peer RESYNC 帧数恰一）+ `t1ChunksAfter` 恰一（:778–782，零续传）。措辞不精确可能诱导实现轮误以为需要/缺少精确帧数断言，或误改契约。
- **可执行修订要求**：设计 §7-D4 括注改为「R3 断言 = hubToPeer reason 列表 `toContain(EXPIRED)` + peer `remote-declared` 恰一（传递性约束帧数恰一）+ transferId=1 续传 chunk 恰一」。SA8 R14 的事实判定本轮实读证实成立。
- **测试构想**：无需新测试（纯文档精度；契约文件冻结）。

## 6. 本评审独立发现（非 SA8 移交）

### W1 · §8.1 伪码前置序把「submit 门」写成双侧共有（措辞，MINOR）

- **触发条件**：实现轮照 §8.1 首行注释「既有前置不动：quiet 门 → busy 分支 → 残渣判别 → 状态接纳门 → submit 门」改造 peer 侧。
- **影响**：peer `onHubUpdateChunk` 的 idle 首 chunk 段**无** submit 门（hub 专属——peer-namespace.ts:661–673 实读，仅状态接纳门后直接 accept；hub 侧才有 :678–683）。照抄会在 peer 侧虚构一道不存在的门或困惑于找不到插入参照。
- **可执行修订要求**：§8.1 注释改为「hub：quiet→busy→残渣→状态接纳门→submit 门；peer：quiet→busy→残渣→状态接纳门（无 submit 门）」；D2 插入点描述同步加「（submit 门如在场）之后」。
- **测试构想**：无（结构性——N3/K 系列既有覆盖）。

### W2 · D3 准入序段落自相矛盾（措辞，MINOR）

- **触发条件**：读者判断「既超 count 上限又遇并发槽满」的帧分类。
- **影响**：§7-D3 写「连接级并发门**先于** per 帧声明校验（D2 门之后的实际序为 D2 → D3 → accept……若某帧既超额又超限，**并发门先命中**）」——与自身伪码序（D2 → D3 → accept，:§8.1）矛盾：按伪码，双违例帧由 D2 先命中、分类 TOO_LARGE。契约对此中性（R2 构型槽空闲、R4 构型 count 合法，两序均可转绿），但设计必须只有一个权威口径，否则实现轮可能写出与设计意图相反的序。
- **可执行修订要求**：改为单一陈述——「准入序 = D2（count 声明门）→ D3（并发槽门）→ accept；双违例帧按 D2 分类 `UPDATE_TRANSFER_TOO_LARGE`（声明维度先判——与 K4 totalBytes 维度同族先例一致）；R2/R4 断言对该序不敏感（构型互斥）」。
- **测试构想**：可选：实现轮新增非契约用例注入「chunkCount>64 且 4 槽已满」帧，断言 TOO_LARGE（锁序）。

## 7. 攻击面探测记录（全部存活，即设计经受住攻击）

| 攻击面 | 攻击内容 | 结果 |
|---|---|---|
| 槽位泄漏 | 枚举 busy→idle 全部出口找漏归还：complete/首违例（assembler 自复位或从未 busy）、busy 违例（不自复位 → transferViolation → clear 兜底）、超时、七个 DD-4 清理挂点、连接消亡（Set 随连接死） | §8.2 单点归还 + `assemblySlotHeld` 守卫 + `has`/`delete` 幂等闭合；R4/N3/N4 覆盖三类归还 |
| 事件双发/漏发 | teardownAbortReason last-writer-wins（CLOSE 在途连接先断）、fire 后竞态 clear、重复 clear | busy 守卫至多一事件；clear 后 stale fire 零副作用（`if (!busy) return`）；closing 同步段先杀 timer（quiesceConnection/clearAllTimers 既有纪律 :808–810 实读） |
| 恶意申报绕过 | chunkCount=65_536/totalBytes=4096 几何骗过（`geometryConsistent` 上界单向——实读确认骗过）；跨帧 count 漂移 | 前者被 D2 count 门拦（R2）；后者 assembler 跨帧逐字节一致强制（update-transfer.ts:135–137 实读）→ VIOLATION |
| 超时误报/漏报 | 20s 前窗（N4）、进度重置语义、needs-resync 期 stall 的二次声明 | 每 chunk 重置 armTimer（clear+set）语义闭合；needs-resync 非 quiet → 超时仍可发收口帧（isQuietState 实读：closing/closed/conflicted/failed） |
| 收敛链断裂 | hub 超时后 peer round 能否立即开（窗口滞留） | `maybeStartRecovery` 门读裸 `inFlightCount`（:1058 实读），中间 chunk 不注册裸在途 + 槽已清 → 立即开（设计论证成立且保守） |
| 类型面破坏 | 新键 Required 化破坏 DENY 面文件 | harness.ts 用自有结构接口（实读）；`issue243-sa7-dynamic` ASM_LIMITS 两键直构不涉新键（:383 实读）——D2 拒绝方案的事实依据成立 |
| 配置容器/缺省 | R1a 两容器断言 vs D1 timeouts 裁决 | `limitsRecord ?? timeoutsRecord` 断言实读——timeouts 选择满足；`ResolvedTimeouts` 必填先例实读 |
| 内存上界公式 | `maxConcurrentAssemblies × maxChunkedUpdateBytes` 兑现 | count 门 + totalBytes 门 + 槽位三者合成（ADR L76）；非 live shed 不清 assembly 不破坏上界（单 assembly 仍受 totalBytes/count 封顶） |
| 契约转绿闭合 | 11 用例逐条机制映射 | 全部在 D1–D5 + R11 增量内闭合（§3 表）；事件时序（emit 先于 `setState('closed')` 可观察点——onCloseRequest/onConnectionClosed 链序实读）与 R5a/R5b 等待条件相容 |

## 8. 锚点核验（零漂移）

SA1 设计 §2 全部源码锚点本轮实读核对一致：types.ts:37–41（跨字段链注释在册）、defaults.ts（三新键缺失属实）、validate.ts:152（「跨字段链归 #244」注释在册）、hub-namespace.ts:126–128/198–201 与 peer-namespace.ts:163–165/237–240（per-(ns,方向) assembler 两键构造）、hub:651–717/719–724/779/927/1178–1181/1310–1312、peer:594/637–702/1027–1030/1098/1560–1562、hub:91/111–114/1426–1451、hub-connection.ts:436/484–511/896–905、peer-connection.ts:59/102–131、update-channel.ts:96/105–107/118–120/177–243/396–440、plugin.ts:154–155、types.ts:328–636（22 型）/663–666、replication-protocol 错误码注册（§13.2 L410–413）与 `UPDATE_TRANSFER_EXPIRED` 词表登记（§9.4 L262）——**设计无一虚构锚点**。SA8 复审 §2 的逐决策基线判定本轮抽查同意。

## 9. 残差登记（转 SA3/SA7/总控）

1. **SA3 实现增量（本评审裁定，随设计执行）**：R11 两行 wiring（两漏斗 cause 判别 + 3 个 fence 入口置位）；R12 `side` 字段；W2 序口径以 §8.1 伪码（D2→D3→accept）为准。
2. **SA7 动态断言面**：shed/epoch-fence/GOAWAY/queue-overflow/resync-declared 五行事件 + `side` 字段双侧覆盖 + 「chunk1@T+20s、chunk2@T+40s」跨窗滑动形态（SA6 §15 已记录的虚拟时间不可构造项）。
3. **总控/owner 移交**：#245 body 措辞同步（四型 → 三型 + 引用 #244 aborted；R11-d）。harness `CONTRACT_*` 注释对齐（设计 §13 既有残差，无依赖）。
4. **条件性复审**：父 PR #241 方向性返工 → 复审本设计与契约（SA8 R9 照旧）。

## 10. 结论

设计**可实现且契约完备**：SA6 契约 11 用例转绿路径闭合、AC1–AC7 全覆盖、锚点零漂移、发送端零改动与非目标边界成立。SA8 转交的 R11–R14 全部裁决收口：R11 拉回 #244（接线规格 herein，落在 D5 既有机制内，无新状态面）；R12 补 `side`；R13/R14/W1/W2 措辞统一。**approve**；`requiresConflictRecheck: false`（全部修订在 SA8 预清理的非冲突包络内）。`pass` 仅代表设计通过审查，不替代 SA4/SA7 对实现与活链路的验证。
