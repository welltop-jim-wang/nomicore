# 冲突门禁报告（设计后复审）

> **当前裁决状态：R2 复审 Verdict `clear`（2026-08-30，见文末「R2 复审」节）**——R1 的 CP-1/CP-2 已按总控裁决「维持 ADR 字面」在 SA1 设计 R2 修订中完整消解并经 SA8 核验；以下 R1 记录（verdict `conflict`）保留存档，其「需 Jim 裁决」条目已由总控径行裁决，不再待决。

- 被审对象：`wiki/raw/task_phase5-ws-namespace-sync_design.md`（SA1 设计，767 行，issue #136 / Phase 5 切片 6）
- 冲突基准：ADR 全集 `docs/adr/0001`–`0010`（含修订节）+ `CONTEXT.md` + Phase 5 规格（`docs/phases/phase-5-websocket-replication.md`、`docs/protocols/instance-replication-v1.md`——ADR 0010 指定的唯一 wire contract）；约束摘录见 `task_phase5-ws-namespace-sync_relevant_decisions.md`
- 审查日期：2026-08-30（run_id: issue-136-1787888033-8367, round 1，设计后复审）
- 依技能规定不重复前置门禁的全量 ADR 盘点（前置 verdict `clear`，10/10 no-conflict）；本报告聚焦设计新引入决策与基准的对照。SA6 冻结测试为代码，**不构成约束基准**（仅作设计动机的事实记录）。

## Verdict

`conflict`

（2 个冲突点，均为 evolution 级——设计意图修订既有决策且已自行登记增补候选，但未经 owner/Jim 正式裁决；**无 hard-violation，不触发自动停止**，交总控上报 Jim 裁决。）

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象（设计）要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| CP-1 | 中 | ADR 0010 L147：「每方向sequence从1严格递增，不回绕；**gap、repeat或错误ACK关联关闭连接**。」；协议 §1 不变量 2：「对端**严格按期望值接收**」；§13.1 `SEQUENCE_VIOLATION`（fatal，1002） | 设计 §4.1/§18.8：入站序列**回退/重复（≤ last）→ `SEQUENCE_VIOLATION` fatal（1002）；跳跃（> last+1）容忍**——视为传输丢失，继续在当前连接收敛，由 state-vector round 修复 | evolution | 直接违反 ADR 0010 L147 明文（gap → 关闭连接）。设计的收窄理由是 SA6 冻结测试要求「同一连接内丢帧后继续收敛」（测试为代码，非约束基准）；设计援引的协议 §1.9 修复清单（「重连、bootstrap 竞态和队列丢弃」）**不含连接内丢帧**，且 WebSocket 为可靠有序传输、连接内 gap 在真实传输下不可达，仅在注入测试下发生。设计 §23(b) 已自行把该裁决列为 ADR 0010 增补节登记候选（收口于切片 10）——构成「意图修订决策、未走正式 supersede」的演进 |
| CP-2 | 中 | ADR 0010 L165：「**普通超限以稳定错误关闭单个 channel；framing、认证等连接级错误才关闭整条连接**。」；协议 §9.4：「Peer等待 in-flight 窗口收口后开始新 round；**断线则**重连后重新 OPEN/reconcile」（同连接新 round 为默认、断线为例外的拓扑暗示）；§17：「窗口收口后由 Peer开始新 reconciliation」 | 设计 §10.5/§18.7：本地队列溢出 → 丢弃+needs-resync+RESYNC_REQUIRED（此半段符合协议 §17）→ 等 in-flight 窗口收口后**整连接重建**（close 1000 → 立即重拨 → 全部 target 重新 OPEN），而非同连接发起新 round；同连接其他 live namespace 全部被扰动一次（设计 R-2 自认代价） | evolution | 对 per-channel 队列超限采取连接级拆除，与 ADR 0010 L165 的单 channel 粒度原则直接相悖；协议字面未禁止自愿断连（§16 rebuild 机制存在），故非硬违反，但恢复拓扑偏离 §9.4/§17 的默认读法。驱动依据是冻结测试的 wire 帧计数算术（代码，非基准）。设计 §23(b) 已把「溢出重建拓扑」列为 ADR 0010 增补节登记候选——同属未正式化的演进 |

### 冲突点裁决定位（四级分布）

no-conflict：其余全部设计条款（对照摘要见下）；override-declared：0；**evolution：2（CP-1/CP-2，上报 Jim 裁决）**；hard-violation：0（无停止条件）。

## 设计条款对照摘要（无冲突项，抽样列示关键锚点）

| 设计条款 | 基准条款 | 对照结论 |
|---|---|---|
| §0 I-2/I-3/I-4/I-5/I-6（owner/token/内容不上 wire；ACK=sequenced apply+dirty；无 durable outbox；一连接一 ns 生命周期；网络状态不入 Runtime status） | 协议 §13.2 L380/§1.8；ADR 0010 非目标 L213/§16；ADR 0010 L90 | 一致 |
| §2 target `{namespaceId, localOwner}`、addTarget/removeTarget 幂等、wire 不传 owner | ADR 0010 L32-38；协议 §19 | 一致 |
| §4.2 HELLO/HELLO_ACK、nonce 回显、instanceId 安全文法、connectionId、HELLO_REQUIRED、重复 HELLO 拒绝 | 协议 §2/§6 | 一致（nonce 非密码学强度为观察项 O-3） |
| §4.3 连接 FSM（stopped→…→ready/backoff/blocked，full-jitter，GOAWAY 接收分类） | 协议 §15.1/§6.3 | 一致（GOAWAY 主动发送划归切片 9——范围切分，非冲突） |
| §5.1 namespace 11 态投影与转移表、终态后不重开、socket 断开 → disconnected+target 保留 | 协议 §16 | 一致 |
| §7 OPEN 矩阵（authorize 先于 Registry open → 不泄露存在性；NOT_FOUND/NOT_ENABLED 仅授权后可发；身份比较 → mode0/mode1/ID_MISMATCH/EPOCH_MISMATCH；重复 OPEN 合流；终态 → REOPEN_REQUIRES_RECONNECT） | 协议 §7.1/§7.2/§13.2；ADR 0010 L155-162 | 一致 |
| §8 单帧 bootstrap（不分块、TOO_LARGE 终止、duplicate → BOOTSTRAP_FAILED 不覆盖）、BOOTSTRAP_ACK 后强制 round 1 修复竞态、peer 经 importReplica 排他导入（expected=OPEN_OK 广告身份） | 协议 §8；ADR 0010 L61-67；ADR 0006 #133 修订节 | 一致（编码放置观察项 O-1） |
| §9 round 引擎（peer 隐式发起、hub 不自启、每方向每 round 一 Step1、双位为真才 live、空 diff 走完整流程、违例矩阵一律 SYNC_STATE_VIOLATION） | 协议 §9 | 一致 |
| §10.3 ACK 簿记（重复/迟到 ACK 容忍、never-sent → ACK_STATE_VIOLATION connection fatal、重复 UPDATE 照常 apply+ACK） | 协议 §10.2 | 一致（zombie 容忍为「unknown」的合理解释——曾被发出） |
| §10.4 ACK timeout 不重发、needs-resync、新 round 修复 | 协议 §18 | 一致 |
| §11 错误三层映射（含 §13.2 终态表逐码对齐：ID/EPOCH_MISMATCH→conflicted、REOPEN→closed、其余 terminal→failed、ACK_TIMEOUT→needs-resync） | 协议 §13.2 | 一致 |
| §11.3 peer degraded：hub→peer UPDATE 内存 apply + saveDoc 登记 + ACK 照发（session 层 bypass 承载，本包零分支）；hub degraded → PERSISTENCE_DEGRADED 拒收 | ADR 0010 L123-139；协议 §20 | 一致 |
| §12 IDENTITY_CHANGED 单帧（新身份）→ 双侧 conflicted、peer 零 apply、epoch 不变；检测机制为双节奏轮询 | 协议 §11；phase 切片 6 | 一致（检测机制基准未规定——观察项 O-2） |
| §13 close/cleanup：同步停接纳→等已接纳 apply 结算→session.close→lease.release→CLOSE_OK；绝不在 sequencer 槽内 await cleanup；单一生命周期队列+合流 | 协议 §12/§16/§21 | 一致 |
| §15 构造期响亮校验（含协议 §17 全部约束式）、绝不运行时 clamp、maxInFlightUpdates 默认 32 | 协议 §17/§10.2 | 一致 |
| 一切 apply 经 `openReplicationSession().applyRemoteUpdate()`（唯一 sequencer+槽内 dirty）、transport 零裸 Y.Doc | ADR 0009/0010；CONTEXT「ReplicationSession」avoid 清单 | 一致 |
| §20/§21 零既有包契约改动、既有交付物只读 | ADR 修订节冻结词汇（#134 拒绝码闭集等） | 一致 |

## 观察项（非冲突——不构成门禁依据，转 SA2 深审/Jim 参考）

- **O-1 bootstrap 编码不入 sequencer**（设计 §8）：协议 §8.1/ADR 0010 L63 明文「hub 在 namespace write sequencer 中读取复制身份并编码一次完整基线」；SA8 源码核实 `session.encodeDiff` = `Y.encodeStateAsUpdate(host.doc, sv)` **同步直读、不入 sequencer**（replication-session.ts L413-418，仅 apply/close 入队），且 DENY LIST 禁改 runtime 包——字面机制不可达。设计以「同步一致快照 + BOOTSTRAP_ACK 后强制 round 1（ADR 0010 L67 既有机制）」论证 wire 可观测语义等价，并发 enable/bump 竞态均安全失败（importReplica 身份不匹配 / fence watchdog）。**采等价性解释、不记冲突**；等价性论证的充分性属 SA2 深审范围，建议切片 10 ADR 增补节一并澄清该措辞。
- **O-2 fence-watchdog 轮询**（设计 §12）：协议 §11 只规定效果（bump 时 hub 发 IDENTITY_CHANGED），未规定检测机制；轮询（4096 让步预算 + ackTimeoutMs 空闲节奏）不违反任何条款。机制成本/测试拟合（预算量纲锚定测试 settle 预算）属 SA2 裁量。
- **O-3 HELLO nonce 非密码学随机**（设计 §4.2）：协议 §6.1 仅要求「由 Peer 随机生成」16 字节，未要求 CSPRNG（ADR 0010 L28 的 CSPRNG 要求仅限 namespaceId 生成）；不构成违反，安全影响由 SA2 评估。
- **O-4 submit 门不覆盖 SYNC_STEP2**（设计 §11.1.2/§18.1）：基准未规定 submit 权限的执行点；设计的 UPDATE-only 门使 submit:false 的重连同 peer 可经 reconcile Step2 传播其离线写——语义缺口未被任何条款禁止，但建议 Jim/SA2 显式确认此解释。
- **O-5 溢出判据含 in-flight**（设计 §10.2/§18.5）：对 `maxQueuedUpdateCount/Bytes` 采用 pending（in-flight+queued）口径，为**更保守的早触发**（未发送队列自身永不超上限，符合协议 §17 字面）；自愿提前 resync 为 §9.4「任一端可声明」所允许。不构成冲突。
- **O-6 §18.10 冻结断言算术冲突**：设计预登记 1 条 SA6 测试断言（wires>1 ∧ HELLO×2）不可满足，处置路径为 SA6 修测试——测试侧事项，不属本门禁基准。

## 结论

**Verdict: `conflict`——2 个冲突点（CP-1 序列跳跃容忍、CP-2 溢出整连接重建），均为 evolution 级；hard-violation 0，不触发自动停止。**

需 Jim 裁决的条目（二选一，每条独立裁决）：

1. **CP-1**：追认设计的「回退/重复 fatal、跳跃容忍」序列纪律（走 ADR 0010 增补节 + 协议 §1.2 措辞修订——设计 §23(b) 已列候选，建议提前到本任务收口前，避免实现与 ADR 长期背离）；或维持 ADR 0010 L147 字面（gap 关闭连接），此时 SA6 冻结测试的连接内丢帧用例须改为跨连接收敛断言，设计 §4.1/§18.8 相应回退。
2. **CP-2**：追认「队列溢出 → 窗口收口后整连接重建」的恢复拓扑（同走增补节，并接受 R-2 的多 ns 扰动代价）；或要求恢复为协议 §9.4/§17 默认的同连接新 round 拓扑，此时 SA6 冻结测试的 wire 帧计数断言须同步修订。

裁决前状态说明：两处设计行为**尚未经正式 ADR 修订授权**；若总控选择在 Jim 裁决前放行 SA3 实现，实现将按设计的 evolution 形态落地（设计 §23 已登记切片 10 收口），风险为裁决不利时的返工面集中在 `frame-io.ts`（序列判定）与 `peer-connection.ts`/`update-channel.ts`（溢出恢复路径）两处单点。

其余全部设计条款与 ADR 全集 + CONTEXT.md + Phase 5 规格一致（对照摘要见上）；设计引入的新决策点已登记至 `task_phase5-ws-namespace-sync_relevant_decisions.md`「设计后复审追加」节（16 条，含 2 条 ⚠ 冲突标记），供 SA2/SA3/SA4/SA7 全链复用。

---

# R2 复审（2026-08-30 追加节；R1 记录见上，保留不动）

- 被审对象：`wiki/raw/task_phase5-ws-namespace-sync_design.md` **R2 修订版（808 行）**——SA1 依总控裁决「维持 ADR 字面」（R1 报告选项 b）完成的原地修订
- 冲突基准：同 R1（ADR 全集 + CONTEXT.md + Phase 5 规格）；R1 的两处源码核实事实（session.encodeDiff 同步直读、E5.5′ fence 清队）在本轮直接复用
- 复审范围：① CP-1/CP-2 消解核验（含残留扫描）；② R2 修订是否引入新冲突；③ 观察项 O-1..O-6 在 R2 下的状态

## R2 Verdict

`clear`

## 1. CP-1/CP-2 消解核验（总控裁决路径 b「维持 ADR 字面」）

### CP-1 序列纪律 —— **已消解** ✅

- R2 §4.1 定案原文：「入站帧 sequence ≠ 期望值——**无论 gap（> 期望）、repeat 或回退（≤ last）——一律 `SEQUENCE_VIOLATION` connection fatal**：framing 仍可信时 best-effort 发 connection ERROR 后 `close(1002)`（协议 §14）；peer 连接 → `blocked`（协议 §15.1「1002/1008：blocked」），hub 连接 → `closed`。」
- 逐点对齐 ADR 0010 L147「每方向sequence从1严格递增，不回绕；**gap、repeat或错误ACK关联关闭连接**」：gap → 关闭连接 ✓；repeat/回退 → 关闭连接 ✓；「错误 ACK 关联」→ never-sent ackedSequence → `ACK_STATE_VIOLATION` fatal 1002（协议 §10.2/§13.1）✓；best-effort ERROR 先于 close（协议 §14）✓；peer → blocked（§15.1 永久协议错误路径）✓。
- 细化判读无新冲突：「曾被发出但已弃置」的迟到 ACK（zombie）判良性 no-op——该序列曾真实发出，不属协议 §10.2「Unknown」的字面射程；与 R1 对照摘要的判定一致。
- **残留扫描**（全文 grep「跳跃/容忍」）：「跳跃」仅现于 §18.8 修订史、§23 R2 收口状态段与 R2 回应表（历史语境）；「容忍」仅现于 ACK 簿记语境（zombie/幂等容忍——payload 字段级，非连接序列纪律）。现行设计面零残留。

### CP-2 溢出恢复拓扑 —— **已消解** ✅

- R2 §10.5 定案原文：「溢出（§10.2）与 ACK-timeout（§10.4）**统一为同连接恢复拓扑**……**已发送窗口等待 ACK 或连接断开**（协议 §17 字面）；in-flight 窗口收口后……由 **Peer 在同一连接**以 roundId+1 发起新 round」；「Hub 侧收 RESYNC_REQUIRED……**连接与其余 namespace 不受影响**——per-channel 粒度」。
- 逐点对齐协议 §9.4（「Peer等待 in-flight 窗口收口后开始新 round」）、§17（「已发送窗口等待 ACK 或连接断开；窗口收口后由 Peer开始新 reconciliation」）与 ADR 0010 L165 单 channel 粒度原则 ✓；§4.3 明文「**溢出恢复不再是重建触发器**……重建唯一入口收敛为 §14.1 重开矩阵（协议 §16「重新 add 必须重建连接」）」✓。
- **残留扫描**（全文 grep「整连接重建/重建/rebuild」）：现行设计面的全部「整连接重建」出现处（§5.1 L253、§14.1 L562）均为**协议 §16 明文的 re-add 重建路径**（closed/conflicted/failed ns 的重 add——基准本身规定的机制）；其余出现处全部为修订史（§10.5/§18.7）、R2 收口状态（§23）、测试移交清单期望形态（§18.11——跨连接收敛经协议既有 blocked→config-change/重 add 机制）与文件清单注释。零现行残留。

## 2. R2 修订是否引入新冲突 —— **无** ✅

逐项核验 R2 变更面（§4.1/§4.3/§5.1/§10.4/§10.5/§10.6/§14.2/§18.7/§18.8/§18.11/P-13/§22/§23）：

- §4.1/§10.5 等 CP 消解条款：合规（见上）。
- **§14.2 roundId per-target 持久（重写）**：协议 §1「连接内不回绕」只约束连接内单调——per-target 持久下任一连接内 roundId 仍严格递增不重复；进程重启丢弃计数器与协议 §21「进程重启丢弃……syncRoundId」相容（计数器仅在 PeerReplication 实例内存中）；hub「严格大于 lastRound（新连接初值 0）」是对 §9.1「Hub 收到**有效新 round**」的合法实现。无冲突。
- **P-13（新增）**：对 ADR 0010 L147 与协议 §1.2/§13.1 的引用经核对准确；「WS 可靠有序传输 ⇒ 连接内 gap 真实不可达」与 R1 裁决依据一致。
- **§18.11 对齐清单（新增，7 项）**：SA6 测试侧移交物，非门禁基准；其「期望新形态」全部使用协议既有机制（SEQUENCE_VIOLATION fatal、blocked→config-change 重建、re-add 重建 §16、timeout 本地收口）——设计未借测试修订夹带任何偏离基准的行为。清单外用例「ADR-literal 形态下仍绿」的逐项核对（§18.11 附注）逻辑自洽（丢帧后对端静默 ⇒ gap 不可观测 ⇒ 无违例；注入帧按 nextSeq ⇒ 序列连续）。
- **§23 风险表重构**：R-2 删除、R-3 重写为 ADR 字面成本的诚实登记、R-6 收窄为 7 处豁免断言——状态声明与核验结果一致；「R2 收口状态」段声明无 ADR 增补需求、无待 Jim 裁决残留——**经 SA8 独立核验确认属实**（两条 round-1 增补候选确已删除，R-1 演进位与 §23(c) O-1 措辞澄清为切片 10 文档收口候选、非偏离授权）。
- **新增编辑性观察项 O-7（非冲突）**：§6 第二句「OPEN_NAMESPACE 语义上属 peer→hub 方向帧，hub 侧收到（错向/敌意）交状态机按连接策略拒绝（`CONNECTION_POLICY_VIOLATION`）」——按字面直译「hub 收到 OPEN_NAMESPACE 即拒」与设计自身 §7（hub 正常处理 OPEN_NAMESPACE）及协议 §7.1 相抵；但任何自洽读法下（该句实际意图应为「hub 收到 hub→peer 方向帧属错向」）均无基准冲突，且 §7/§22（AC1 幸福路径仍绿）已无歧义地确立 OPEN 的处理面。**建议 SA1 在 SA3 实现 hub-connection 分发逻辑前澄清该句措辞**——§6 分发必须以 §7 为 OPEN_NAMESPACE 的唯一处理面，错向拒绝仅适用于 hub→peer 方向帧类（OPEN_OK/BOOTSTRAP_SNAPSHOT/IDENTITY_CHANGED 等）。

## 3. 观察项 O-1..O-6 在 R2 下的状态

| # | 观察项 | R1 状态 | R2 状态 |
|---|---|---|---|
| O-1 | bootstrap 编码不入 sequencer（采等价解释） | 观察 | **不变**（§8 零改动）；设计 §23(c) 已登记为切片 10 ADR 措辞澄清候选（采纳 R1 建议）——维持观察 |
| O-2 | fence-watchdog 双节奏轮询机制 | 观察 | **不变**（§12/R-1 零改动）——维持观察 |
| O-3 | HELLO nonce 非密码学随机 | 观察 | **不变**（§4.2 零改动）——维持观察 |
| O-4 | submit 门不覆盖 SYNC_STEP2（语义缺口） | 观察 | **不变**（§11.1.2/§18.1 零改动）——维持观察，仍建议 SA2/Jim 显式确认 |
| O-5 | 溢出判据含 in-flight（保守早触发，合规） | 观察 | **不变**（§10.2/§18.5 零改动）——维持观察 |
| O-6 | §18.10 冻结断言算术冲突 | 观察 | **已收编为正式移交**：扩编为 §18.11 对齐清单 7 项（#1 原算术冲突 + CP-1 连带 ×5 [#2/#4/#5/#6/#7] + CP-2 连带 ×1 [#3]），总控已裁决 SA6 修订；SA7 动态验证口径「清单内豁免、清单外全绿」 |
| O-7（新增） | §6 OPEN_NAMESPACE 措辞歧义（编辑性缺陷） | — | 观察项：建议 SA3 实现前由 SA1 澄清；任何自洽读法下无基准冲突 |

小误登记（措辞级，不影响裁决）：§4.1 R2 注记将「zombie 迟到 ACK 判一致」定位为「观察项 O-5 相邻」——该判定实际载于本报告 R1 对照摘要表与相关决议第 10 条，非 O-5 本体。

## R2 结论

**Verdict: `clear`**

- CP-1/CP-2 已按总控裁决「维持 ADR 字面」在 R2 修订中**完整消解**（§4.1/§10.5 定案 + 修订史溯源 + 残留扫描确认现行设计面零残留，现行「整连接重建」仅存于协议 §16 明文 re-add 路径）。
- R2 修订**未引入新冲突**：变更面逐项合规；新增 1 条编辑性观察项（O-7，§6 措辞歧义——建议 SA3 实现前澄清，非门禁阻塞）。
- 四级分布：no-conflict（全部现行条款）；override-declared 0；evolution 0；hard-violation 0；**待 Jim 裁决残留 0**（设计 §23「R2 收口状态」声明经独立核验属实）。
- 门禁链条状态：前置门禁 `clear` → R1 `conflict`（2 evolution，已由总控裁决路径 b 处置）→ **R2 `clear`**。设计可进入 SA2 破壁评审与 SA3 实现；SA6 须按 §18.11 清单完成 7 处测试修订后，SA7 方可以「清单内豁免、清单外全绿」口径收口。
- 相关决议文档「设计后复审追加」节第 1/2/16 条已同步更新为 R2 定案形态（撤除 ⚠ 冲突标记）。
