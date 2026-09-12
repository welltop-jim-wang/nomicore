# SA8 设计后冲突复核第二轮（SA2 五项 MAJOR 修订版定向复核）— Issue #243（issue #233 切片 2）

- Dispatch：`sa-3153d4b7-3c1a-43ad-b76f-e0ed746742ce`（mabf-sa8 / conflict-gate / iteration 2）
- 复核对象：`wiki/raw/task_issue-243_design.md`（SA1 设计修订版，dispatch `sa-330a4264`，436 行，mtime 2026-09-08 23:31——SA2 reject（F1–F5）后的整体修订，其 §14 自映射修订落实）
- 复核范围（dispatch 点名五面）：①F1 收窄后的未协商回退行为；②F2 全部 transfer 清理路径；③F3 idle 态非首 chunk 恢复语义；④F4 有效窗口口径；⑤F5 协商能力捕获——逐面对照 ADR 全集 + `CONTEXT.md` + `docs/protocols/instance-replication-v1.md`（经 ADR 0013「接受后以该文档为唯一 wire 权威」条款纳入）+ 已批准 SA6 红灯契约（`wiki/raw/task_issue-243_sa6_contract.md`，approve）
- 裁决基准（仅此二者为自动阻塞依据）：`docs/adr/` ADR 全集（无被 supersede 的相关 ADR；ADR 0013 状态「提议」但为该特性线操作性决策，W1 维持）+ 根 `CONTEXT.md`
- 工作区：worktree `nomicore-fix-issue-243`，分支 `mabf/issue-243`，HEAD `c20aeb0`（与简报/前置门禁/SA6/SA2/设计五方 header 一致；`git status` 仅 7 个 untracked 产物文件，零 tracked 改动）
- 结论：**无冲突（clear）** —— 63 项检查 0 项 ADR/CONTEXT 矛盾、0 项阻塞、0 项需 override；F1/F3/F4/F5 四项修订全部与 ADR/协议/SA6 契约一致；**F2 修订发现 1 项高优先级必答观察（O5，条件性冲突）**：设计 DD-3.7/R3 的「发送端全部弃置路径必发 RESYNC/CLOSE/ERROR 或杀连接」断言在 **peer 侧 ack-timeout 路径（PN6b：peer 不发 wire RESYNC_REQUIRED）不成立**，残留一扇可使对端 namespace 终局 failed 的窗口——详见 §3，须 SA1 修订或如实登记后方可进实现轮

## 1. 输入与证据

| 证据 | 位置 | 状态 |
|---|---|---|
| SA1 设计修订版 | `wiki/raw/task_issue-243_design.md`（436 行） | 本复核对象；§14 修订映射自洽，正文五处 F 标记（DD-1.3/DD-2.3/DD-3.3/.4/.6/.7/DD-4）与本轮逐面核验 |
| SA2 攻击评审 | `wiki/raw/task_issue-243_sa2_review.md`（reject，5 MAJOR + N1–N6） | 五项 MAJOR 的修订要求（§13）为本轮裁决基准之一（dispatch 点名） |
| SA6 红灯契约 | `wiki/raw/task_issue-243_sa6_contract.md` + `packages/ws-replication/test/ws-replication-issue243-ac-red.test.ts` | approve；P1/P2/P3 红 + NC0/NC1/NC2 绿；fixture wire 代理 `rewriteChunkCapability`（:121-135）本轮实读复验 |
| SA8 前置门禁 / iter-1 复核 | `20260908-sa8-conflict-gate-issue-243.md`（clear，D1/D2/W1–W4）/ `task_issue-243_design_conflict_recheck.md`（clear，O1–O4） | O1/O2 = SA2 F1/F4 承接面；O3/O4 已在设计 §6 落实（本轮核验） |
| ADR 0013 | `docs/adr/0013-chunked-live-update-transfer.md` | 协商 :20-25 / 消息形态 :27-46 / 发送端 :48-54 / 接收端 :56-63 / 配置链 :65-76 / 错误码 :78-81 |
| ADR 0010 + 协议文档 | `docs/adr/0010-…md`；`docs/protocols/instance-replication-v1.md` §5/§6.1-6.3/§10.2-10.3/§13.2 | ACK durability / 窗口语义 / drain 语义 / 错误码注册基线 |
| CONTEXT.md | 「分块复制传输」L141-143 /「UPDATE_CHUNK」L145-147 /「CAP_CHUNKED_UPDATE」L149-151 | Avoid 清单（逐片 apply / 跨重连保留 partial / transferId 跨连接标识）全程有效 |
| 源码锚点 | 设计 §2 全表 + 五面修订各自引证 | 本轮实读抽验 20 处，零漂移（§5） |

### 1.1 Owner 评论扫描（dispatch 要求）

- dispatch 声明：issue #243 评论经 REST 于 dispatch 前即刻刷新——**空**（无 owner 要求）。
- 本轮独立复验：`gh api repos/welltop-jim-wang/nomicore/issues/243/comments` → `0`（exit 0）。与 Host 简报 `## Comments` 空、SA6 §2、SA8 门禁 §1.1、SA8 iter-1 §1.1、SA2 §4 六方一致：**无评论衍生约束或豁免**，需求面 = issue body 8 条 AC。

## 2. dispatch 点名五面逐项裁决

### 2.1 F1 —— 收窄后的未协商回退行为（SA8 O1 承接面）：无冲突

设计 DD-2.3 定义 `chunkable(item) = bytes > maxUpdateBytes ∧ bytes ≤ maxChunkedUpdateBytes ∧ (negotiated & CAP_CHUNKED_UPDATE) ≠ 0 ∧ nextTransferId ≤ 0xffffffff`；仅 chunkable 项改道入有界队列，¬chunkable 超限项（未协商 ∨ 超 `maxChunkedUpdateBytes` ∨ transferId 域耗尽）保持 v1 deliver 时刻直发分支判定。

| # | 核验点 | 上游条款 | 裁决 |
|---|---|---|---|
| 1 | 未协商连接 `chunkable ≡ false` ∧ `activeTransfer` 结构性缺席 → deliver 直发条件（DD-3.3）字面退化为 v1 的 `dataGateOpen() && inFlight.size < max`；超限项走同一 `sendAndRegister` 路径/分支/可观测量 | ADR 0013:23「未协商 ⇒ 不得分块，超限行为保持 v1（丢弃 + needs-resync，#231 观测不变）」+ issue body 末句 | **一致且强于原方案**：等价性由「改道范围收窄」结构性成立（全部组态，含混合队列窗），不再依赖刻画测试的单一写形态。本轮实读 `update-channel.ts:105-114`（直发前置裸口径）与 `:219-234`（超限双分支：队列空 → declare `send-failed`/`update-too-large`；队列非空 → `noteUpdateDropped('update-too-large')`）逐字核对——v1 行为面与设计 DD-2.3 行 3 描述零偏差 |
| 2 | 窗口满/闸门关/deferred 时 ¬chunkable 项入队 → drain 时刻判定 | v1 自身该组态行为（`pullAndSendOne`→`takeItems`→`sendAndRegister`） | 一致（「这本来就是 v1 在该组态下的行为」论证成立；`takeItems` 贪心上界使超限首项恒单独成帧，:307 实读） |
| 3 | `bytes > maxChunkedUpdateBytes` 回退 v1（协商连接，P4-S） | 前置门禁 D2「隐含回退须写明并测试」；ADR 0013:59 接收端首 chunk 上界使直发必被 TOO_LARGE 拒，回退是唯一可恢复路径 | 一致（显式分派矩阵 + §12 P4-S 测试：deliver 直发时刻判定、与 v1 同刻同形） |
| 4 | transferId 域耗尽回退 v1 | ADR 0013:32「从 1 严格递增，不回绕」——耗尽后分块结构性不可能 | 一致（R8 登记，防御面） |
| 5 | chunkable 项 deferred 模式入队不违反「channel live 进入分块」 | ADR 0013:50 | 一致：chunk **出站**经 `pullAndSendOne`，其 facet 层 live 门（:269 文档化前置①）保持；队列持完整 update 为 ADR:51 字面 |
| 6 | SA6 契约相容 | NC2/R1/R2/R3（未协商逐字节）+ P4-S 负控 | 相容：未协商路径零代码语义变化（`chunkable ≡ false` 使 DD-3.3 新前置在未协商组态与 v1 同义）；新增 §12 F1 未协商混合队列负控恰为 SA2 F1 acceptance 要求（零额外 RESYNC、排队项照发、`update-dropped{update-too-large}` 不变） |

**裁决：无冲突。** 该修订属 ADR 0013:23 面语义微调（进入分块判据引入 `chunkable` 组合条件），实现面语义**更强**（全组态逐字节等价 ⊃ 单写形态等价），ADR:50 进入条件（超限 ∧ 已协商 ∧ live）被 `chunkable` 完整包含且外加两项结构性必要条件（尺寸上界/ID 域）——均为 ADR 自身规则（:59 接收端上界、:32 不回绕）的发送端镜像，无新自由度。

### 2.2 F2 —— 全部 transfer 清理路径：单点方案成立，但发现一项必答观察（O5，见 §3）

设计 DD-3.7：私有 `clearActiveTransfer()` 为唯一清除点，内联于 `discardQueued()`（结构性单点：任何清队列路径自动同步终止 transfer）；`abandonInFlight()`（ACK timeout）显式调用且**不弃队列**（修正原设计事实错误）；九路径枚举 + 「needsResync ⇒ 无 activeTransfer」推论。

| # | 核验点 | 事实核验（本轮实读） | 裁决 |
|---|---|---|---|
| 1 | `discardQueued` 是全部队列清空路径的汇聚点 | `update-channel.ts:184-187`；调用点全集：deliver 溢出 :117、`markResyncReceived` :168、`sendAndRegister` 超限-队列空 :222（no-op）、`sendAndRegister` 发送拒绝 :242、`discardForConnectionPressure` :335、`teardown` :355——除新路径（chunk 出站拒绝，DD-3.5 自带 discardQueued）外**穷尽**；`queued` 的其余突变仅 `push` :126（deliver）与 `takeItems` shift :308/:315（transfer 在场时结构性不可达，DD-3.4 分支序） | 成立 |
| 2 | 九路径枚举完备性 | 1/2=deliver 溢出 live/deferred（:116-124）；3=`markResyncReceived`；4=`markSessionResyncEdge`（:172-174 委托 3）；5=shed（:334-337）；6=发送拒绝（:238-245）；7=超限-队列空（:219-226，与 transfer 无交集——载体在场则队列非空，核验成立）；8=chunk 出站拒绝（新增，设计自带）；9=teardown（:351-357） | 完备 |
| 3 | **`abandonInFlight` 不调用 `discardQueued`——原设计事实错误，本版修正属实** | `:340-348` 实读：inFlight→zombie + disarm timer + `needsResync` + `onAckTimeout()`，**无 discardQueued**；v1 冻结队列跨 ack-timeout 保留语义（恢复后 `resetForLive` 放行续排）字面在码 | 修正属实；「不得改为 discardQueued」正确（否则改变 v1 语义，违反逐字节等价纪律） |
| 4 | 「needsResync ⇒ 无 activeTransfer」推论 | `needsResync` 全部置位点：:101（deliver 首行，pre-existing）、:119（溢出）、:168（markResyncReceived）、:223/:243（sendAndRegister）、:336（shed）、:346（abandonInFlight——显式清除覆盖）、:356（teardown）——每条路径均经清除点 | 成立：`resetForLive` 恢复后 `pullAndSendOne` 不可能见到悬挂 transfer，僵尸续传结构性不可达（SA2 F2 后果链闭环） |
| 5 | 守恒不变量 `activeTransfer ≠ undefined ⇒ queued[0] === 载体` | 初始化不 shift（DD-3.4 先窥）；清除与队列清空在 `discardQueued` 内原子同步；末 chunk 出站时刻才 shift + 核减 | 成立；wheel 以 `queuedCount()>0` 留轮（`backpressure.ts:218-221` 实读）使 transfer 期间 drain 持续可达——DD-3 备选否决理由（旁路槽 → 摘轮 → 停摆）属实 |
| 6 | SA2 F2 acceptance 场景闭环（queue-overflow 中途终止） | deliver 溢出 → 单点清 transfer + `declareLocalResync('queue-overflow')` wire 声明 → 对端 `onResyncReceived` 弃置其队列并清 assembly（DD-4 挂点 1）→ 残渣 chunk 落 needs-resync 良性行（F3 表）→ 恢复 round 收敛 → 新 transferId 正常收齐 | 闭环（§12 F2 行测试：无续传 chunk、无僵尸、对端 ns 不 failed） |
| 7 | ack-timeout 路径的载体保留 + 新 transferId 整笔重传 | 见 **O5**（§3）——重传公式本身与 ADR 相容（ADR:54「ACK timeout ⇒ 停发后续 chunk、末 chunk 序入 zombie 簿记、needs-resync 同构处置」逐项满足；重传是「队列持完整 update + 出队惰性切片 + resetForLive 放行」的自然延续），但设计的**接收端已清除断言**在 peer→hub 方向不成立 | **必答观察（条件性冲突）** |

**裁决：F2 修订主体（结构性单点 + 事实修正 + 九路径枚举）无冲突**；ack-timeout 子路径的接收端清理断言存在方向性缺口——不构成 ADR 文本矛盾（ADR:54/:58 条款均满足；缺口位于 ADR 沉默面 + #244 延期面），但设计以错误事实断言掩盖了一扇终端失败窗口，须按 §3-O5 处理后方可进实现轮。

### 2.3 F3 —— idle 态非首 chunk 恢复语义（ADR 0013:60 沉默面）：无冲突

设计 DD-4：残渣判别表（quiet 静默 / `needs-resync`|`reconciling` 良性丢弃 / `live` 保留 fail-loud VIOLATION）+ `resyncEpisode` 标记（declare 边与 `onResyncReceived` 置位，`onRoundSettled` 回 live 分支清除）+ 恢复结算清理边 + busy 路径无状态门 + 方向序论证。

| # | 核验点 | 上游条款 | 裁决 |
|---|---|---|---|
| 1 | 残渣良性丢弃（needs-resync/reconciling 态，不 ERROR 不 failed 不建 assembly） | CONTEXT「分块复制传输」：**「中断即丢弃并回退 state_vector reconciliation」**——该词条的接收端实例化；ADR 0013:60 对该形态沉默（slice 2 交付物须补定义，SA2 F3 裁定） | 一致：多 chunk transfer 中途 resync 边沿必然产生残渣（发送侧弃置需单向传播期），按「resync 丢弃语义」良性处理正是词条承诺的恢复路径；live 行 fail-loud 为防御深度（非吞错——判据是 ns 状态，§9 已自辩） |
| 2 | 方向序论证（残渣不漏进 live-idle） | WS 单向有序（协议 §1 不变量） | 论证成立（本轮独立推演）：残渣 chunk 由发送端在处理对端 RESYNC **之前**发出，而对端恢复 round 的 STEP2/APPLIED 由发送端在处理 RESYNC（同向先行帧）**之后**发出——同向序保证残渣先于 round 结算到达，全部落入 busy 行（assembly 尚未清）或 needs-resync/reconciling 行（已清） |
| 3 | `resyncEpisode` 标记不误杀周期 round 并行 transfer | 设计 §2 锚点「hub 收 STEP1 不迁出 live」——`hub-namespace.ts:560-567` 实读：`onSyncStep1` 仅 `round.onStep1`，零 setState | 成立：周期 round 不置标记（置位点仅 declare/收声明两类，`peer-namespace.ts:939-960`/`:561-567`、`hub-namespace.ts:796-815`/`:661-666` 实读）→ 结算不清 → hub→peer 下行 transfer 的 busy assembly 跨周期 round 存活续收（busy 无状态门承接）——这正是「hub 收 STEP1 不迁出 live」锚点的接收端对偶 |
| 4 | 恢复结算清理边（新增）为加性安全 | ADR 0013:58 枚举五边之外的第六边（收口「needs-resync 期间经镜像门接纳的夭折首 chunk → stale busy assembly → 恢复后新 transferId 撞校验 1 误判」） | 加性、无冲突：闭合 SA2 F2+F3 复合类的第二扇门；清除点 `onRoundSettled` 回 live 分支实读在（peer `:881-904`——`pendingResync → 再开 round` 分支先行返回、标记保持到真正回 live；hub `:1044-1056`——非 reconciling/needs-resync 早退，live 不经此边） |
| 5 | 新 transfer 首 chunk 不被结算清理边误杀 | 方向序（round 末帧同向先于任何恢复后数据帧） | 成立：peer 结算先于 hub 结算（APPLIED 发送方先于接收方），新 transfer 只能在发送端 `resetForLive` 后初始化——严格晚于对端结算清除 |
| 6 | busy 路径无状态门（仅 quiet 静默前置） | ADR 0013:60 后续 chunk 判据未含状态门；hub STEP1 不迁出 live 使跨 round chunk 流为常态 | 一致（首 chunk 时刻状态门已判，busy 复查无价值且会误杀并行态合法 chunk） |

**裁决：无冲突。** 接收端残渣生命周期语义（含 `resyncEpisode` 标记与恢复结算边）整体落在 ADR 0013:56-63 的沉默面与「既有清理财路、零 durable 残留」原则内，方向与 CONTEXT 词条一致；「不挂 `resetForLive` 周期面」的原论证经标记门控精化后依然成立。#246 转正时协议 §10.3 可追认（W2 边界内）。

### 2.4 F4 —— 有效窗口口径（SA8 O2 承接面）：无冲突

设计 DD-3.6：`effectiveInFlightCount() = inFlight.size + (activeTransfer !== undefined ? 1 : 0)` 为唯一口径，统一用于 deliver 直发前置、`pullAndSendOne` 新 transfer 初始化前置、DD-3.8 延后判据；「直发路径逐字节不变」显式限定于无 transfer 组态；包内只读访问器（不经 index.ts 导出，N6 并入）。

| # | 核验点 | 上游条款 | 裁决 |
|---|---|---|---|
| 1 | 有效口径与「整笔占 1 槽」的相容性 | ADR 0013:51「整笔占 1 个 in-flight 窗口槽直至 ACK」；:52「window 空位允许时本 ns 小 update 可在 chunk 间穿插」；协议 §10.2「每 namespace 每方向 ≤ 32 in-flight / 窗口满只暂停该 namespace 发送」 | 一致：有效口径是使两条同时成立的唯一读法（iter-1 O2 条件性冲突的「裸口径」分支被明确否决） |
| 2 | 槽位转换 1→1 算术 | — | 成立（本轮独立验算）：transfer 期间 `inFlight.size ≤ max-1`（有效占用 ≤ max）→ 末 chunk 注册后 `inFlight.size ≤ max`、activeTransfer 清除、有效占用不变 → **裸 `inFlight.size ≤ max` 恒成立（含末 chunk 注册后、ACK 前）**——设计 §12 F4 行断言可满足 |
| 3 | `takeItems` 零改动论证 | `update-channel.ts:299-318`（`avail = max - inFlight.size`） | 成立：takeItems 仅在 `activeTransfer === undefined` 分支可达（DD-3.4 分支序），该组态下有效口径 ≡ 裸口径 |
| 4 | DD-3.8 延后判据扩为有效口径 | `peer-namespace.ts:928-936`（startPeriodicReconcile 现裸 `inFlightCount>0`） | 一致：避免 transfer 中途被周期 round 抢占；`maybeStartRecovery` :919 守卫**不**改的论证成立（needsResync 置位后 activeTransfer 必已清除，两口径同义——§2.2 核验 4） |
| 5 | 未协商组态等价性 | — | 成立：无 transfer 时有效口径恒等于裸口径，v1 逐字节不变（F1 等价性论证的组成部分） |

**裁决：无冲突。** iter-1 O2 的条件性冲突警示（「若 SA1 坚持裸口径即构成冲突，须回设计」）——本版明确选择有效口径，冲突分支不触发。

### 2.5 F5 —— 协商能力捕获：无冲突

设计 DD-1.3：peer 在 `onHelloAck` 身份校验通过后、`setState('ready')` 前逐字捕获 `negotiated = message.selectedCapabilities`（不与本地 offered 求交）；交集为 hub 侧 `onHello` 单点职责（`selectCapabilities`）；`dialNow()` 重建复位 0；§8「∩ offered」表述已删除（单一表述）。

| # | 核验点 | 上游条款 | 裁决 |
|---|---|---|---|
| 1 | peer 逐字捕获 = 协议字面 | 协议 §6.2「selectedCapabilities = required 满足后的交集」（HELLO_ACK 字段由 **hub** 计算）；ADR 0013:22「`selectedCapabilities` 取交集（既有机制，零新字段）」；CONTEXT「CAP_CHUNKED_UPDATE」：「双方 optional 交集经 `selectedCapabilities` 生效」——交集经该字段**生效**，消费方逐字读取 | 一致：peer 消费权威结果，不复制 hub 职责制造第二事实源 |
| 2 | hub 单点交集 | `negotiation.ts:26-29` `selectCapabilities(required, optional, supported)` 纯函数已导出（本轮实读：`ok = (required & ~supported) === 0`、`selected = optional & supported`）；`onHello` 参数结构 :633-639 现无 `optionalCapabilities`（补字段可行）；`requiredCapabilities !== 0 → UNSUPPORTED_CAPABILITY` :660-663 既有分支保留 | 一致 |
| 3 | 捕获点时序可行 | `peer-connection.ts:402-441` 实读：身份校验（hubInstanceId/protocolVersion/nonce）→ connectionId 赋值 → clearHello → `setState('ready')`——设计钉死于「身份校验后、ready 前」，现无 `selectedCapabilities` 字段（补读一点） | 可行 |
| 4 | 与冻结红灯契约的和解（F5 裁决依据复核） | fixture `rewriteChunkCapability`（test :121-135）本轮实读：**只改写 HELLO.optionalCapabilities / HELLO_ACK.selectedCapabilities 两握手帧，其余逐字节透传**——peer 本地旋钮关、本地 offered 恒 0 | 成立：逐字捕获是唯一使代理置位被消费的公式；「∩ offered」读法下 `negotiated ≡ 0` → P1/P2 永红，击穿 §11「红灯文件零编辑转绿」承诺与 SA6 A1（判据 = wire 协商位）——DD-1 备选否决理由属实 |
| 5 | 恶意/异常 hub 选中未申报位的面 | SA6 A1「不另加实例级 feature-flag」 | 一致：wire 握手为唯一事实源（协议字面）；selected ⊆ hub 支持集，peer 消费不破坏任何不变量 |
| 6 | `dialNow` 复位 0 / hub 单握手生命周期 | ADR 0013:32（transferId 连接作用域的协商面对偶）；A12 已核 | 一致 |

**裁决：无冲突。** 设计正文单一表述（§8 状态机「逐字捕获 hub 侧交集结果」），SA2 F5 指出的自相矛盾已消除。

## 3. O5（必答观察，条件性冲突）—— peer 侧 ack-timeout 的无信号弃置击穿 R3 闭合论证

**发现**：设计 DD-3.7 `abandonInFlight` 条目断言「（接收端 assembly）已在本端 ack-timeout 声明边清除」，§13-R3 断言「发送端全部弃置路径必发 RESYNC/CLOSE/ERROR 或杀连接」。本轮实读证实该断言**只在 hub→peer 方向成立**：

- **hub 侧**：`hub-namespace.ts:817-818` `onAckTimeoutFired() → declareHubResync('ack-timeout')`——**发 wire RESYNC_REQUIRED**（记忆化）→ peer `onResyncReceived`（:560-567）清队列 + 清 inbound assembly + 置标记 → hub 恢复后新 transferId 重传到达干净 assembly ✓。
- **peer 侧**：`peer-namespace.ts:906-915` `onAckTimeoutFired()` 仅 `setState('needs-resync')` + `emitResyncRequired('ack-timeout')`（observer 事件）——**PN6b：peer 不发 RESYNC_REQUIRED（本地边沿通知），零 wire 帧**。且该行为是 v1 冻结面：为闭合本缺口而在 peer ack-timeout 路径加发 wire RESYNC 将改变未协商连接的 v1 可观测量，违反 ADR 0013:23 逐字节等价——**设计不得走该修法**。

**后果链（peer→hub 方向，协商连接）**：transfer T1 进行中（chunk 0..k 已出站、末 chunk 未出站）且在途直发帧 ACK 逾期触发 ack-timeout → `abandonInFlight` 显式清 transfer（载体保留 queued[0]）→ peer 本地 needs-resync + 恢复 round（STEP1/STEP2/APPLIED，hub 响应正常即完成）→ **hub 全程未离开 live**（`onSyncStep1` 不迁移状态，:560-567）且未收到任何 resync 信号、`resyncEpisode` 未置位 → T1 的 busy assembly 残留 → peer 结算回 live → `resetForLive` → drain 先窥 chunkable 载体 → **新 transferId T2 的首 chunk 到达 hub 时撞 busy 冲突 → 校验 1 → `UPDATE_TRANSFER_VIOLATION` → hub namespace 终局 failed**（fatal/retryable no）。这正是 SA2 F2/F3 警示的「合法降级路径 → 对端 ns 终局 failed」伤害类，经 F2 修订新引入的重传公式在唯一无信号路径上重新打开。触发窗口窄（需 hub ACK 路径持续逾期 `ackTimeoutMs` 而 round 路径仍响应），但设计 §9 自宣的恢复不变量（「transfer 中止后与 v1 同构——needs-resync → 下一轮双向 reconciliation 修复」）在该子路径不成立——修复不是 reconciliation 而是终局失败。

**冲突等级裁决：条件性冲突（现登记为必答观察，不阻塞）**——理由：

1. ADR 0013:54（ACK timeout ⇒ 停发 + zombie + needs-resync 同构）逐项满足；重传公式本身是「队列持完整 update + 出队惰性切片 + resetForLive 放行」（ADR:51/50）的自然延续，非 ADR 违反。
2. hub 侧残留 assembly 的清理边在 ADR 0013:58 枚举之外（该枚举同样不含此形态）；ADR 对无信号停摆的系统性回答是 `assemblyTimeoutMs`（:63），已按 W3 切片边界归 #244——slice 2 无超时下的残留即 R2 已登记形态（暴露上界 = 每 (ns,方向) 一个 `maxChunkedUpdateBytes`，连接拆除收口）。**新内容**是「残留 + 发送端无信号恢复重传」的组合使 R2 从「无害残留」升级为「误判终局」，而设计以不实断言（DD-3.7 括注 + R3 闭合论证）宣称已覆盖。
3. CONTEXT「分块复制传输」「中断即丢弃并回退 state_vector reconciliation」词条：无信号中断下接收端无从「丢弃」，词条描述的是信号可达面的机制意图——文本不构成直接矛盾；但若 SA1 **既不修订也不如实登记**该子路径，其 §9/R3 与词条恢复语义的偏离将成为未管理偏离。

**要求（二选一，进实现轮前落实）**：

- **路径 A（登记式，最小）**：更正 DD-3.7 括注与 R3 论证（明示 PN6b 不对称：peer ack-timeout 为唯一无 wire 信号弃置路径），将该子路径登记为 R2 族残余（伤害面、触发条件、#244 `assemblyTimeoutMs` + 中止矩阵收口），并在 §12 补一条「peer ack-timeout 中途终止 transfer」测试：断言恢复后行为（接受 #244 前的 terminal-failed 形态**或**设计显式选择的任何收口），使断言与实现一致。
- **路径 B（slice 2 内闭合）**：为该子路径补收口——候选（SA1 裁定，SA8 不做设计）：(i) 校验 1 的 busy∧不同 transferId 首形态按 ns 状态判别（镜像 F3 残渣表，needs-resync/reconciling 良性弃旧纳新；live 保持 fail-loud——A9 攻击面不弱化）；(ii) peer 在重传无信号中止的 chunked 载体前先声明 wire resync（仅协商连接可触达，未协商 v1 观测不变，AC6 不破）；(iii) 无信号中止时直接弃置 chunked 载体（仅协商连接可观测量变化，走 v1 语义的 round 修复）。
- **条件性冲突条款**：若 SA1 既不更正断言、也不登记/闭合该子路径而维持现文进实现轮，则构成与 CONTEXT「中断即丢弃并回退 reconciliation」恢复语义的未管理偏离，**升级为冲突，回设计**。
- 任一路径的修订建议随附定向 SA8 复核（本结论不自动延伸到该修订；若仅路径 A 的登记式更正——语义面零变化——则无需再复核，登记核验归 SA2/实现轮承接）。

## 4. D1/D2/W1–W4 与 SA6 契约相容性回查（修订版维持面）

| 项 | 修订版落点 | 回查结论 |
|---|---|---|
| D1 临时期分配上界 | DD-4 校验序 0–6 全部先于分配（ADR:59 四条件映射：#4 totalBytes≤maxChunked、#5 totalBytes≤chunkCount×maxUpdateBytes、#0 codec chunkCount≥1；`chunkCount ≤ maxChunksPerUpdate` 随配置归 #244——iter-1 三层论证未被五项修订触碰，维持成立） | 遵守 |
| D2 配置旋钮切分 | DD-2：slice 2 全量拥有 `maxChunkedUpdateBytes`（缺省 4MiB = ADR:71 配置表值，`defaults.ts` 现值 11 字段实读、Partial 合并先例在）；跨字段链整体归 #244（SA6 fixture `maxQueuedUpdateBytes=1MiB` + 缺省 4MiB 实读复验——建链即构造期 TypeError 击穿冻结契约）；回退 P4-S 写明并有测试；N1 三封闭键集扩展入 §8/§11（`plugin.ts:147-153` 键集实读确认现状不含两新键——N1 要求属实） | 遵守 |
| W1 ADR 0013 状态「提议」 | §11 DENY 零改动；F1/F3 面微调经本定向复核追认 | 遵守 |
| W2 协议文档滞后 | §11 DENY 零改动；transfer 1 槽（有效口径实现面）、单 ACK 末 chunk 序、hub drainActive 名单 +`'UPDATE_CHUNK'`（`hub-connection.ts:718-732` 实读现含 UPDATE 不含 0x42——扩充必要且为 §6.3「其余会启动新工作的迟到 namespace frame 静默丢弃」类条款覆盖）、残渣判别/`resyncEpisode` 生命周期均为 ADR 0013 已决内容、其沉默面显式定义或类条款延伸，#246 可追认 | 遵守（无不可追认偏离） |
| W3 observer 四事件/中止矩阵后置 | 零新事件类型：中间 chunk 零 `update-sent`；末 chunk 发射**既有** `update-sent` 类型（SA2 N2 裁定接受，#238 三事件面配对维持）；`update-acked/applied` bytes=totalBytes 推广同裁定；四 `chunked-update-*` 仍归 #245 | 遵守 |
| W4 诊断纪律 | apply 复用 `ReplicationSession.applyRemoteUpdate`，零新 emission 调用点 | 遵守 |
| SA6 A1（wire 位唯一门控） | DD-1.5 字面 + F5 逐字捕获使代理注入被消费 | 相容（零编辑转绿可行） |
| SA6 A2（缺省 4MiB 接纳） | DD-2.1 + DD-4 校验 4 | 相容 |
| SA6 A3（ACK 锚/恰一次 apply+dirty） | DD-3.6/DD-4（N2 措辞校正不影响断言面 `ackedSequence`==末 chunk 帧序） | 相容 |
| SA6 P3（合法单 chunk，totalBytes < maxUpdateBytes） | 不校验 `totalBytes > maxUpdateBytes`（R6，iter-1 已裁决与 SA6 P3 相容） | 相容 |
| SA6 fixture 构造可行性 | 无跨字段链 + 缺省 4MiB + `chunkable(20KB)` 于 8KiB/1MiB/4MiB 组态为真（预算/域均过） | 相容 |
| iter-1 O3/O4 | O3：`dialNow` 重建 transferId 归 1 已钉死（DD-3.2）；O4：P4-S/P4-R 改名全篇统一 | 已落实 |

## 5. 设计 §2 锚点与五面修订引证的实读核验记录（本轮）

`update-channel.ts`（deliver 直发前置裸口径 :105-114 / 溢出分支 :116-124 / `overflows` :179-182 / `discardQueued` :184-187 及六调用点 / `sendAndRegister` 超限双分支 :210-236 与发送拒绝 :238-245 / `pullAndSendOne` 五前置 :285-296 / `takeItems` 贪心上界 :299-318 / `resetForLive` :327-330 / `discardForConnectionPressure` :334-337 / **`abandonInFlight` :340-348 无 discardQueued** / `teardown` :351-357 / `armAckTimer` 幂等 :364-372 / `onAck` 最老重锚 :138-144 / `inFlightCount` 访问器 :86）；`peer-connection.ts`（HELLO optional=0 :331-339 / `onHelloAck` 结构与身份序 :402-441 / draining 允许名单不含 0x42 :391-397 / UPDATE_CHUNK 占位 :525-530 / decode 调用点 :365-368）；`hub-connection.ts`（`onHello` 参数结构 :633-639 / required 门 :660-663 / HELLO_ACK selected=0 :703-710 / **drainActive 名单含 UPDATE 不含 UPDATE_CHUNK** :718-732 / 占位 :790-795 / decode 调用点 :609-612）；`peer-namespace.ts`（**`onAckTimeoutFired` PN6b 无 wire 帧 :906-915** / `onResyncReceived` :560-567 / `onHubUpdate` 状态门+尺寸门 :569-587 / `onRoundSettled` 含 pendingResync 分支 :881-904 / `maybeStartRecovery` :917-923 / `startPeriodicReconcile` :928-936 / `declareLocalResync` :939-960 / shed 声明分派 :162-165）；`hub-namespace.ts`（**`onSyncStep1` 不迁出 live :560-567** / `onFieldViolation` :592-597 / `onUpdate` 状态门+submit 门 :599-623 / `declareHubResync` :796-815 / **`onAckTimeoutFired → declareHubResync('ack-timeout')` :817-818** / `onRoundSettled` :1044-1056 / shed :124-127）；`backpressure.ts`（`tryEmitData` 严格接纳 :124-136 / `drainData` wheel `queuedCount()===0` 摘轮 :201-228）；`negotiation.ts`（`selectCapabilities` :26-29）；`frame-io.ts`（`decodeInbound` 现无 selectedCapabilities :59-68）；`plugin.ts`（三封闭键集 :147-153）；`defaults.ts`（11 字段 :16-28）；红灯 fixture（`rewriteChunkCapability` wire 代理 :121-135、限值 :85-91、NC0 断言 :327-332）——**抽验全数属实，设计与 HEAD 无锚点漂移；SA2 §6「零漂移」结论维持**。

## 6. 裁决汇总

- 检查项合计：**63**（F1 面 6、F2 面 7、F3 面 6、F4 面 5、F5 面 6、D1/D2/W1–W4+SA6 相容 12、锚点实读 20 处归档、评论扫描复验 1）
- 分布：无冲突/对齐 **62**；必答观察 **1**（O5——F2 面第 7 检查项：条件性冲突，SA1 按 §3 路径 A 登记或路径 B 闭合则消解，维持现文不动即升级为冲突回设计；iter-1 O1–O4 全部已落实闭环）；阻塞 **0**；与 ADR/CONTEXT 矛盾需 override **0**
- 门禁结论：**clear** —— SA2 五项 MAJOR 中 F1/F3/F4/F5 的修订与 ADR/CONTEXT/协议/SA6 契约全部一致，设计可进实现轮的**前置条件**为 O5 的落实（登记或闭合，二选一；路径 A 登记式更正（语义面零变化）无需再触发 SA8 复核，路径 B 语义修订须随附定向 SA8 复核——本结论不自动延伸到该修订）
