# SA2 独立设计攻击评审 — Issue #243（issue #233 切片 2：协商 CAP_CHUNKED_UPDATE 超限 UPDATE live 分块传输）

- Dispatch：`sa-ee7fd906-cb2d-4a4d-b043-13d508d54521`（mabf-sa2 / design-review / iteration 2）
- 评审对象：`wiki/raw/task_issue-243_design.md`（SA1 iteration-2 修订版，dispatch `sa-2f765e76`，491 行——SA2 iteration-1 reject（F6/F7）后的落实版：F6 = 路径 B（协商限定 ack-timeout 弃置时刻声明，DD-7）、F7 = 发射点全集闭合 + 漏斗收敛（DD-8））
- 上游输入：SA6 契约（approve）+ SA8 前置门禁（clear，D1/D2/W1–W4）+ SA8 复核 r1（clear，O1–O4）+ r2（clear + 必答观察 O5）+ **SA8 r3 定向复核（clear，C1–C41 + O6–O8——F6 路径 B 的强制复核义务已由该报告履行）**
- 工作区：worktree `nomicore-fix-issue-243`，分支 `mabf/issue-243`，HEAD `c20aeb0`（与全部七方 header 一致；`git status` 仅 9 个 untracked 产物/fixture 文件，零 tracked 改动——iteration-1 评审以来的全部源码锚点因此保持有效）
- 评审方法：全量实读 iteration-2 设计 + 全部固定输入；对本轮 dispatch 点名五面（协商限定 ack-timeout RESYNC 发射 / assembly 清理 / v1 不变 / 恢复行为 / 契约与测试要求）逐面独立攻击。本轮新实读：peer-namespace 的 onRoundSettled/onAckTimeoutFired（PN6b）/maybeStartRecovery/startPeriodicReconcile/declareLocalResync 漏斗/onWatchdogEdge 内联声明/onResyncReceived/onHubUpdate 状态门/sendFacet shed 分派/channel host 接线/emitResyncRequired cause 联合/sendChecked 失败语义/onTimerFired 周期 round 先例（:883–:981、:561–:587、:158–:242、:1286–:1299、:1576–:1580）；hub-namespace 的 onSyncStep1/onResyncReceived/onWatchdogEdge/onLocalResyncEdge/declareHubResync 漏斗/onAckTimeoutFired/onRoundSettled/onFieldViolation/onUpdate 门（:560–:623、:741–:818、:1044–:1056）；update-channel 全文复验（deliver/overflows/discardQueued/markResyncReceived/markSessionResyncEdge/sendAndRegister/pullAndSendOne/takeItems/resetForLive/discardForConnectionPressure/abandonInFlight/teardown/armAckTimer/UpdateChannelHost 接口）；两 connection 握手/decode/draining 名单/dispatch 占位；**hub reauth drain 生命周期（beginReauth/maybeFinishDrainEarly/finishDrain/clearDrainHandles :524–:599——本轮补查 C17 角落的独立复核）**；negotiation/payloads codec 与门控/plugin 键集/defaults/backpressure/红灯 fixture；生产 `kind:'RESYNC_REQUIRED'` sendChecked 发射点全集 grep。SA2 纪律：未运行测试、未改任何生产/测试/设计文件。
- 程序披露：`skills/attack-design/SKILL.md` 在本环境技能目录未注册（`.agents/skills/` 无该项）；本评审按仓库既有 SA2 固定产物（iteration-0/1 两轮）的同一程序与格式执行——独立攻击视角、逐发现给触发条件/影响/可执行修订、只读源码、原位更新本文件。

## 1. Reviewed inputs

| 输入 | 状态 |
|---|---|
| `wiki/raw/task_issue-243.md`（Host 简报，零评论） | 已读；8 条 AC 与 issue body 一致 |
| `wiki/raw/task_issue-243_design.md`（SA1 iteration-2，491 行） | 已读（评审对象） |
| `wiki/raw/task_issue-243_sa6_contract.md`（approve）+ 红灯 fixture | 已读；A1–A3、P1–P3、NC0–NC2、限值/`ackTimeoutMs=60s` 虚拟/`rewriteChunkCapability` 只改写两握手帧均本轮实读复验 |
| `wiki/raw/20260908-sa8-conflict-gate-issue-243.md`（clear，D1/D2/W1–W4） | 已读 |
| `wiki/raw/task_issue-243_design_conflict_recheck.md`（r1 clear，O1–O4）/ `_r2.md`（clear + O5） | 已读；O5 条款原文本轮重读（§5 映射） |
| `wiki/raw/task_issue-243_design_conflict_recheck_r3.md`（clear，C1–C41 + O6–O8） | 已读；对本轮 dispatch 为「SA8 iteration-3 clear」的事实输入；其载重结论（C1/C5/C6/C8/C12/C13/C15/C17/C23/C24/C27/C30–C33）本轮独立复验同意 |
| SA2 iteration-1 评审（本文件前一版，reject F6/F7；F1–F5 验证通过） | 已读；本版为原位更新：F6/F7 acceptance 三条款逐条裁断（§7/§8） |
| ADR 0013 / ADR 0010 / 协议 §6.1–6.3、§9.4、§10.2–10.3、§13.2 / CONTEXT 词条 | 已读（:20–:25/:46–:54/:56–:63/:78–:81；§9.4 :250–266「任一端可声明…始终由 Peer 发起」+ reason 词表现状登记列） |
| 源码锚点 | 逐项实读；**零漂移**（§6） |

## 2. Verdict

**pass（approve）** —— 0 BLOCKER、0 MAJOR、0 MINOR；2 项非阻塞观察（N12/N13）+ 2 项维持登记（N8/N9）。

主体结论：**SA2 iteration-1 的两项 MAJOR（F6、F7）全部验证为已正确、完整落实**（§7/§8 逐条款核验，含源码级独立复核），且 F6/F7 修订未触碰已放行的 F1–F5 维持面（§6/§14）。架构一致性、单一事实源、生命周期对称、文件范围、验收映射全部通过。

- **F6（= SA8 r2 O5，路径 B）**：五处不实断言全改（全文残留扫描零命中）；协商限定为**结构性**保证（`abortedTransfer=true ⟺ activeTransfer 在场 ⟹ chunkable 载体 ⟹ 已协商`——不是配置纪律而是构造性不可能）；peer 漏斗声明的记忆化不吞声明不变量本轮独立重推成立（§7-C）；协议依据（§9.4「任一端可声明」+ 既有 reason + 既有帧型）与 ADR 0013:54「同构处置」的 hub 镜像读法相容；**强制定向 SA8 复核已由 r3 履行且 clear**——O5 条件性冲突正式解除。
- **F7**：发射点全集静态核验成立（本轮 grep 实证生产 `RESYNC_REQUIRED` sendChecked 恰 3 处 = 设计 §2 全集行；收敛后 2 漏斗）；漏斗收敛零行为变化声明经源码逐行比对成立（§8-B）；hub 单漏斗三调用点表述与源码一致。
- 其余：v1 全组态逐字节不变（§9）、恢复闭环 R3 论证本轮独立重推完整（§10）、SA6 契约/D1/D2/W1–W4/§12 测试映射齐备（§13）。

**requiresConflictRecheck: false** —— F6 路径 B 触发的定向复核义务已由 SA8 r3 履行完毕（clear）；本轮通过不含任何新的语义修订面，无需新的冲突轮。实现轮若引入本评审与 SA8 r3 均未覆盖的语义偏离，按 SA8 r2 §3 既有规则另行触发。

## 3. 需求覆盖

| Requirement | Design section | Assessment |
|---|---|---|
| AC1 超限 live 传输 + 单 ACK、零 SYNC | §7 DD-3/DD-4、§12 | 覆盖；红灯 P1/P2/P3 零编辑转绿路径维持（F5 公式未触碰） |
| AC2 每帧 ≤ maxUpdateBytes/maxFrameBytes | §7 DD-3.2（切片几何）、§12 | 覆盖；`ceil(totalBytes/maxUpdateBytes)` + 链式不变量 |
| AC3 恰一次 sequenced apply；失败先于 apply | §7 DD-4、§9 | 覆盖；校验序 0–6 先于分配、live Y.Doc 零写入 |
| AC4 多 ns RR 穿插；背压/公平不回归 | §7 DD-3.1/.4、§12 | 覆盖；载体=队列项 + wheel `queuedCount()>0` 留轮（backpressure.ts:218-223 实读），backpressure 零改动 |
| AC5 ACK 锚 = 末 chunk 出站；ackTimeoutMs 不变 | §7 DD-3.6（N2 措辞校正）、§12 | 覆盖；断言面（ackedSequence==末 chunk 帧序）不受 armAckTimer 幂等重锚影响 |
| AC6 未协商 v1 逐字节一致（全部组态） | §7 DD-2.3/DD-3.3/DD-7.5、§12 | **覆盖且因 F6 扩展**：除超限丢弃形态外，ack-timeout 观测形态入断言域（§12 新增未协商 ack-timeout 负控——`abortedTransfer` 结构性恒 false ⇒ PN6b 原体 ⇒ 零 RESYNC 帧） |
| AC7 双 seam 绿 | §11、§12 | 覆盖；fake-duplex（红灯转绿）+ 真实 WS 镜像新文件 |
| AC8 首 chunk 基础校验 | §7 DD-4 校验矩阵、§12 | 覆盖；P4-R 超界申报注入；分类完备化归 #244 合法 |
| What to build：Hub fan-out 不回送来源 | §7 DD-6 | 覆盖（applyOrigin 回声抑制复用） |
| 非目标不静默扩大 | §1 | 覆盖；#244/#245/#246 分工与 DENY 一致（含 F6 发射点登记归 #246） |

## 4. Owner评论覆盖

| Comment ID | Updated at | Design section | Assessment |
|---|---|---|---|
| （无评论） | — | — | Issue #243 零评论：dispatch 声明（REST 刷新于 dispatch 前，空）与 Host 简报 `## Comments` 空、SA6 §2、SA8 门禁/r1/r2/r3 §1.1、SA2 前两轮八方一致。无评论衍生约束或豁免；需求面 = issue body 8 条 AC |

## 5. 上游事实与SA8约束

| Fact or constraint | Design response | Assessment |
|---|---|---|
| SA6 P1–P3/NC0–NC2/R1–R3 基线、A1–A3 | §5 承接表、§7 DD-1–DD-5、§12 | 全部承接；fixture 三关键事实（1MiB+缺省 4MiB 组合、ackTimeoutMs=60s 虚拟、代理只改写两握手帧）本轮实读复验——红灯断言面与 F6 新行为零交集成立 |
| D1 临时期分配上界 | DD-4 校验序 1–6 先于分配 | 合格（维持两轮裁定；F6/F7 未触碰） |
| D2 配置旋钮切分 | DD-1/DD-2：`maxChunkedUpdateBytes` 全量拥有、跨字段链归 #244、P4-S 有测试 | 合格（维持） |
| W1–W4 | §6 表、§11 DENY | 遵守；W2 边界扩展一处（F6 §9.4 发射点登记 append 归 #246 追认）——SA8 r3 O6 同裁定，登记面非语义面 |
| SA8 r1 O1–O4 / r2 O1′–O5′ | §6 表 | 全部落实闭环（维持 r2/r3 裁定） |
| **SA8 r2 O5（必答观察，条件性冲突）** | 路径 B：DD-7 + 五处断言全改 + §12 F6 双向行 | **已落实并解除**：SA8 r3 §4 正式结算（选择路径 B 且五处全改 ⇒「维持现文即升级冲突」条款不触发）；「路径 B 须随附定向复核」由 r3 报告履行、结论 clear——本轮独立复核同意其 C1–C10/C30–C32 全部载重判断（§7） |
| **SA8 r3 O6/O7/O8（登记性）** | O6 → §1/§11（#246 追认）；O7 → R10 家族 + §12 负控；O8 → 挂点 4 + §12 中止/清理行 | 承接得当（O7 的门保持显式化建议见 N13；O8 属实现完备性，SA4/SA7 按 §12 行验收） |

## 6. 设计内部一致性

- **锚点真实性**：设计 §2 全表 + DD-7/DD-8 修订面引证本轮实读复验，与 HEAD `c20aeb0` **零漂移**——含 F6/F7 绑定面的更正后表述：peer `onAckTimeoutFired` PN6b 零 wire（:906-915）、`declareLocalResync` 漏斗（:939-960，cause 联合已含 `ack-timeout`/`session-fanout-overflow`）、`onWatchdogEdge` 内联声明（:962-981）、hub `declareHubResync` 单漏斗（:796-815）及三调用点（:749/:785-792/:817-818）、hub `onSyncStep1` 零 setState（:560-567）、双方 `onRoundSettled` 的 `resyncDeclared=false` 同块清零（peer :901 / hub :1053）、`abandonInFlight` 无 discardQueued 且先清 inFlight 后上抛（:340-348）、`armAckTimer` 幂等（:364-372）、`inFlightCount` 仅计 inFlight.size（:86-88）、drain 名单（hub :718-732 现含 RESYNC_REQUIRED/UPDATE 不含 0x42——DD-5 扩充必要且正确；peer 允许名单 :391-397 不含 0x42 零改动成立）。iteration-1 §6「唯二例外即 F6/F7 绑定面」的两处漂移已被本版 §2 吸收且与源码一致。
- **发射点全集（F7 事实基础）**：本轮 grep 实证——生产 `kind: 'RESYNC_REQUIRED'` sendChecked 发射点**恰 3 处**（peer :953 漏斗、peer :974 内联、hub :809 漏斗；其余匹配为 codec 构造/收帧 dispatch/注释），与设计 §2 行逐字一致；收敛后全集 = 2 漏斗 = 挂点全集，静态判据成立。
- **§14 修订映射自洽**：F6/F7 两行的落点声明逐条与正文核对属实（DD-3.7/DD-4 挂点/§9/§13-R3/§12 五处 + DD-7/DD-8/§3/§5/§6/§8/§10/§11/R2/R10/R11 全部落位）；F1–F5 行「维持落实」声明与正文实读相符（本版仅随 F6/F7 触点同步措辞，语义面未触碰）。
- **残留断言扫描**：全文检索「已清除/必发/无信号」——全部命中均为正确限定形态（「F6 闭合后无信号残留仅剩真停摆族」「可持有 transfer 的弃置路径必发…」含 ack-timeout∧transfer 枚举），iteration-1 指出的五处不实断言零残留。
- 其余交叉引用（DD-2↔DD-3↔DD-4↔DD-7↔DD-8↔§9↔§12、§5↔SA6、§6↔SA8 r1/r2/r3）一致；无死引用、无旧 API。

## 7. F6 落实裁断（iteration-1 §13-F6 acceptance 三条款逐条）

### A. 「设计文本零不实断言（五处全改）」——通过

五处逐一核对：①DD-3.7 括注现为「中止信号捕获 + 双角色分派」并如实保留历史更正注记；②DD-4 挂点行 2 现为「本端任何 wire RESYNC_REQUIRED 发射点」语义（含 F6 新增调用点枚举）；③§9 恢复现文为两方向对称闭合 + PN6b 原体子路径限定；④§13-R3 闭合论证现含 peer ack-timeout 声明边（「可持有 transfer 的」量词使论证为真，见 §10 重推）；⑤§12 原「无 stale assembly 误判」行改为 F6 双向行 + 未协商负控、断言=真实行为。全文残留扫描零命中。

### B. 「§12 新测试行断言与所选语义一致且双向」——通过

§12 F6 行：peer→hub（恰一帧 peer RESYNC_REQUIRED → round 收敛 → 新 transferId 整笔收齐 → hub ns 不 failed、零 UPDATE_TRANSFER_VIOLATION）、hub→peer（对偶）、未协商负控（归 AC6 行：ack-timeout 零 RESYNC 帧）三段落锚；N11 方向标注在行。两方向的载体保留语义（ack-timeout 不清队列——源码 :340-348 实读）使「新 transferId 整笔收齐」对两方向均自然可构造（peer 侧载体保留经 drain 重传；hub 侧冻结队列同构）。测试构型自洽：混合窗口在途直发帧 + transfer 进行中 + 延迟 ACK 逾时，与 DD-7 问题回顾的触发链逐环节对应（timer 锚于更早直发帧、中间 chunk 不解堵 ACK 队列——armAckTimer 回调 :369-371 实读确认只有 inFlight 非空才 abandon）。

### C. 「路径 B：新增 wire 行为有协议依据并可追认，SA8 定向复核通过」——通过

- **协议依据（本轮独立复核）**：协议 §9.4:264「任一端可声明当前增量连续性作废，但始终由 Peer 用新 roundId 发起下一轮」——peer 在协商子路径发 RESYNC_REQUIRED 属字面许可；hub 既有 `:817-818` 同源行为实读在案。reasonCode 复用既有 `send-queue-overflow`（hub 漏斗全部 cause 共用该 reason 的既有先例，:811 实读），零新帧型、零新 reason、零新 observer cause（`emitResyncRequired` 联合已含 `ack-timeout`，:1486-1494 实读）——不触犯 §9.4「新增 reason 必须先登记后发射」纪律；发射点登记列属现状文档 append，归 #246（O6/W2 边界内）。
- **结构性协商限定（本轮独立重推）**：`chunkable(item)` 定义含 `(negotiated & CAP_CHUNKED_UPDATE) ≠ 0`（DD-2.3）；transfer 仅在 `pullAndSendOne` 先窥队首 chunkable 时初始化（DD-3.4，facet live 门 + 槽位前置）；协商位握手期定死、连接生命周期不变（DD-1.3/dialNow 复位）。故 `abortedTransfer = (activeTransfer !== undefined) = true` ⟹ 已协商——**未协商连接上新 wire 行为构造性不可达**（SA8 r3 C1 同结论，本轮源码链独立验证：`pullAndSendOne` 唯一 transfer 初始化点 + `chunkable` 唯一进入条件）。`abortedTransfer` 由通道在 `activeTransfer` 在场判定（结构门）而非控制器自估——R10 守门形状正确。
- **SA8 定向复核**：r3 报告（C1–C10 F6 路径 + C30–C32 落实映射）结论 clear，O5 条款正式解除（r3 §4）。本轮对其载重判断逐项独立复验同意；其中 C17（drain 期 RESYNC 被丢角落）本轮补做源码级独立复核：`drainActive` 仅经 `clearDrainHandles()` 复位，其唯一调用链 `finishDrain() → close(1001,'hub-reauth')`（:590-599 实读）——**drain 窗口的唯一出口是连接死亡**，故被丢声明恒由挂点 4（终态/静默单点）兜底清 assembly，无「drain 解除后连接存活 + stale assembly」残留窗口。C17/O8 裁定成立。

### D. 记忆化不吞声明不变量（DD-7.6，本轮独立重推 + 源码逐点核验）——成立

断言：`abortedTransfer === true` ⟹ 本端 `resyncDeclared === false` ⟹ 漏斗必真实发射。推演链逐环源码验证：①`resyncDeclared=true` 仅置位于两漏斗（peer :951/:972[收敛前]、hub :807），且**每条漏斗调用路径在进入漏斗前已置 channel.needsResync**（queue-overflow：deliver :117-121 先置后声明；send-failed：sendAndRegister :238-243 / chunk 拒绝 DD-3.5 同构；connection-shed：discardForConnectionPressure :334-337 先置、facet 后声明；session 边沿：markSessionResyncEdge :169-173；ack-timeout：abandonInFlight :346 先置后上抛）；②`resyncDeclared` 复位唯一发生在 `onRoundSettled` 回 live 分支（peer :901 / hub :1053 实读，grep 全集确认无其他复位点），而该结算边同时 `resetForLive()`（清 needsResync）；③F2 不变量 needsResync ⇒ 无 activeTransfer（全部置位路径经 discardQueued 单点或 abandonInFlight 显式清除）。故 needsResync ∧ activeTransfer 结构性互斥 ⇒ 漏斗记忆化开启期间 abandonInFlight 不可能见到 activeTransfer ⇒ F6 子路径声明不被吞、`emitResyncRequired('ack-timeout')` 恰一次（两分支互斥、cause 同串）。hub 侧同理（其声明被吞 ⟺ 无 transfer ⟺ 无 assembly 可滞留）。

### E. 时序与先例（DD-7.7）——成立

漏斗指令序（sendChecked :952-956 → setState → emit → maybeStartRecovery :959，本轮实读）保证 RESYNC 先于恢复 round STEP1（同出站队列同向 FIFO）；`abandonInFlight` 先清 inFlight（zombie 不计 `inFlightCount`，:86-88）⇒ `maybeStartRecovery` 的 §9.4 窗口收口门即时通过；timer 栈内发 wire + 同步发起 round 均为既有模式（hub :817-818 / peer `onTimerFired('periodic-reconcile') → startPeriodicReconcile` :1576-1580 实读）。与 PN6b `deferTask` 的差异仅为进程内调度次序，wire 序不变。

## 8. F7 落实裁断（iteration-1 §13-F7 acceptance 三条款逐条）

### A. 「锚点/清单覆盖全部声明发射点（静态判据：sendChecked 调用点全集 == 挂点全集）」——通过

§2「发射点全集」行（peer 两处 :939-960/:962-981 + hub 单漏斗 :796-815 及三调用点 :749/:785-792/:817-818）与本轮 grep 实证**逐项一致**；DD-4 挂点行 2 语义钉死为「本端任何 wire RESYNC_REQUIRED 发射点」并附静态 grep 判据；§12 有对应「发射点静态核验」行。F6 新增声明走既有 peer 漏斗——不新增发射点，判据不被 F6 破坏（DD-8.4）。

### B. 「新测试行入 §12」——通过

§12 F7 行：hub→peer transfer 进行中（peer busy assembly）+ 注入 peer session 溢出边沿 → 断言经漏斗发 RESYNC ∧ 本端 assembly 清除 + resyncEpisode 置位 → 恢复 round → hub 新 transferId 首 chunk 正常收齐 → peer ns 不 failed。（构型细节见 N12。）

### C. 「hub 单漏斗表述与源码一致」——通过

`declareHubResync` :796-815 单漏斗（quiet 门 :805-806 + 记忆化 :806-807 + sendChecked :808-812 + setState :813 + emit :814，无 maybeStartRecovery——hub 等待 peer round，round 发起权垄断保持）；三调用点（watchdog session 边沿 :749 / onLocalResyncEdge :785-792 / ack-timeout :817-818）实读一致。

### D. 漏斗收敛零行为变化声明（DD-8.2）——源码级逐行比对成立

现内联路径（:962-981）指令序：quiet/disconnected 门（:967）→ `markSessionResyncEdge()`（:969，无条件、先于记忆化门）→ `if (resyncDeclared) return`（:970）→ `clearTimer('periodic-reconcile')` → `resyncDeclared=true` → `sendChecked RESYNC{send-queue-overflow}` → `setState('needs-resync')` → `emitResyncRequired('session-fanout-overflow')` → `maybeStartRecovery()`。收敛方案（`markSessionResyncEdge` 保持漏斗调用前 + 漏斗体）与该序**逐行等价**：漏斗体恰为记忆化门 → clearTimer → 置位 → 同帧同 reason sendChecked → setState → emit(cause)（cause 传 `'session-fanout-overflow'`，已在漏斗联合类型 :944-947）→ maybeStartRecovery；quiet/disconnected 前置门与 fence 分派留在收敛点之外不动。`markSessionResyncEdge` 幂等（= markResyncReceived = needsResync + discardQueued，:165-174 实读）。收敛是纯结构改动，wire/observer/状态迁移零漂移 ⇒ v1 与协商观测均不变（SA8 r3 C13 同结论，本轮独立比对同意）。

### E. 挂点生命周期闭合

挂点 1（onResyncReceived :561/:661——收帧清本端 inbound assembly + 置标记，peer 另发起恢复 round）+ 挂点 2/3（两漏斗内记忆化门后清 + 置；恢复结算边 `onRoundSettled` 回 live 清）+ 挂点 4（终态/静默单点）四点闭合；「不挂周期结算面」行维持（下行 transfer 跨周期 round 存活——hub `onSyncStep1` 零 setState 实读为锚）。记忆化吞掉的重复声明不重复置位（该恢复周期首次发射已置、结算边消费）；hub 漏斗 quiet 早退不发射即不置位（quiet 态由挂点 4 收口）。

## 9. v1 不变性攻击（dispatch 点名面③）

| ID | 场景 | 预期 | 裁断 |
|---|---|---|---|
| V1（通过） | 未协商连接任意组态（含 ack-timeout） | v1 逐字节 | `chunkable ≡ false` ∧ transfer 结构性缺席（§7-B 链）⇒ `abortedTransfer ≡ false` ⇒ PN6b 原体（clearTimer + setState + emit + deferTask，:906-915 现体逐字节保持）⇒ 零新 wire 帧；超限丢弃形态两时序窗 v1 同刻同形（F1 维持面未触碰，DD-2.3 矩阵实读） |
| V2（通过） | 协商连接无 transfer 的 ack-timeout（纯直发帧超时） | PN6b 原体 | `abortedTransfer=false` 分支显式保持原体（DD-7.2）；新帧仅出现在「协商 ∧ transfer 中止」子路径——改道面收窄原则在弃置信号面的对偶 |
| V3（通过） | F7 收敛路径（session-fanout-overflow 声明） | 观测逐字节等价 | §8-D 指令级等价；`#231` 观测面（同帧/同 reason/同状态序/同 observer cause）不变 |
| V4（通过） | 漏斗内新挂点（清 assembly/置标记）对未协商连接 | 零可观测差 | 未协商连接 decode 门控 1002 先于一切 chunk 处理（payloads :830-835 实读）⇒ assembly 结构性不存在 ⇒ 挂点为 no-op |
| V5（通过） | `onAckTimeout` 签名扩展（+boolean） | 行为中立的接口加宽 | 两实现适配（§10）；hub 忽略参数行为不变；false 分支 PN6b 逐字节——签名变化本身零 wire/observer 面 |
| V6（通过） | SA6 冻结面（P1–P3/NC0–NC2/R1–R3） | 零编辑转绿不受 F6/F7 影响 | fixture `ackTimeoutMs=60s` 虚拟（test :93-95 实读）——红灯断言面不含 ack-timeout 路径；漏斗收敛 wire 零漂移 |

## 10. 恢复行为攻击（dispatch 点名面④；R3 闭合论证本轮独立重推）

**全部「可持有 transfer」的发送端弃置路径重枚举**（对 DD-3.7 九路径 + ack-timeout 逐条独立核验）：

| 路径 | wire 信号 / 连接死亡 | 核验 |
|---|---|---|
| 1 deliver 溢出（live） | `declareLocalResync('queue-overflow')`（channel host :121 委托链实读） | ✓ |
| 2 deliver 溢出（deferred） | 结构性无 transfer（deferred ⇒ 非 live ⇒ transfer 已清/未建） | ✓ |
| 3 markResyncReceived（对端声明） | 对端声明即 wire 信号；本端队列（含载体）随之清空 | ✓ |
| 4 markSessionResyncEdge | 收敛后经漏斗 wire 声明（F7） | ✓ |
| 5 shed（live） | facet 漏斗声明（peer :162-165 / hub :124-127 实读）；非 live 分支结构性无 transfer | ✓ |
| 6 sendAndRegister 发送拒绝 | `declare('send-failed')` wire（:238-243） | ✓ |
| 7 超限-队列空 | wire 声明（同 6）；且 transfer 在场 ⇒ 队列非空 ⇒ 无交集 | ✓ |
| 8 chunk 出站拒绝 | 同 6（DD-3.5） | ✓ |
| 9 teardown | 连接死亡 → 对端 quiesce → 挂点 4 | ✓ |
| ack-timeout ∧ transfer | hub 既有 wire 声明（:817-818）；peer F6 新增（DD-7） | ✓ |
| ack-timeout ∧ 无 transfer | PN6b 无 wire——**本轮验证该子路径无 stale 窗口**：(a) transfer 未初始化的 chunkable 队首项从未发出任何 chunk ⇒ 对端无对应 assembly；(b) 末 chunk 已出站（activeTransfer 已清）⇒ WS FIFO 保证对端 assembly 必然收齐消费（busy 路径无状态门）或随连接死亡收口 | ✓ |

配合方向序论证（残渣/声明/round 帧同向 FIFO）与恢复结算清理边（needs-resync 期间夭折 assembly），「新 transferId 撞 stale busy assembly」与「live 下残渣」均协议内不可达，fail-loud 保留为防御深度——**R3 论证完整且两方向对称**（SA8 r3 C15 同结论，本轮独立重推同意）。

其余恢复面核验：round 发起权垄断保持（hub 漏斗无 maybeStartRecovery，实读）；零新增轮次（声明搭乘 PN6b/漏斗既有恢复 round；B(ii′) 因触发第二轮被否决——否决理由成立）；`resyncEpisode` 仅 declare/收声明两类边置位、仅恢复结算边清除、周期 round 不置不清（hub `onSyncStep1` 零 setState、peer `pendingResync → round+1` 分支 :892-896 保持标记，实读）；transferId 单调不复用 + dialNow 归 1。双端交叉声明（同周期互发 RESYNC）收敛：双侧记忆化防重复帧、peer 单点发起 round、hub 等待——无死锁面。

## 11. 状态机与并发攻击（新增面）

| ID | Initial state | Trigger | Expected | 裁断 |
|---|---|---|---|---|
| A20（通过） | F6 分派可达性 | ack-timer 触发 | `abortedTransfer=true` 时 ns 状态必为 live ⇒ 外层 `live \|\| needs-resync` 门通过 | activeTransfer ⟹ live（needsResync/reconciling ⇒ transfer 已清——DD-3.8 延后 + F2 不变量）；门在 :907 实读 |
| A21（通过） | 恢复周期内重复边沿 | 同周期二次 ack-timeout/溢出 | 记忆化吞声明、无重复帧 | §7-D 不变量 + `emitResyncRequired` 恰一次（PN5 注释 :958 实读） |
| A22（通过） | needs-resync 期间镜像门接纳的夭折首 chunk | 后续同 transfer chunk / 结算 | busy 追加（无状态门）→ 结算边清除；无跨 transferId busy 冲突 | 每 (ns,方向) 至多 1 transfer（FIFO）+ WS 同向序 ⇒ 异 id 首 chunk 到达前旧 assembly 必已收齐或清除 |
| A23（通过） | hub 声明（任意 cause）+ peer→hub 入站 assembly 在场 | 漏斗挂点触发 | hub 自身 inbound assembly 清 + 对端（peer）杀出向载体 → round → 干净重传/round diff | 挂点 2 全 cause 覆盖使该组合闭合（F7 修复的负载承载面，非仅 session 边沿） |
| A24（通过） | reauth drain 窗内 F6 声明到达 hub | drainActive 丢 RESYNC | 连接死亡兜底清 assembly | `finishDrain → close(1001)` 唯一出口（:590-599 实读）；无存活连接残留窗 |
| A25（通过） | F6 声明 sendChecked 编码面抛 | 编码超限 | `sendNsErrorNoWrap + finalize('failed','send-failed')`（:1286-1299 实读）+ 连接大概率死亡 → 挂点 4 | 设计 §8 路线⑤ 错误列表述与源码一致 |
| A26–A30（通过） | iteration-1 A13–A19 维持面 | — | — | 源码零 tracked 改动 + 设计维持面未触碰（§14 表），结论随 HEAD 复验维持 |

## 12. 契约影响审查

| API or contract | 核验 | 裁断 |
|---|---|---|
| `UpdateChannelHost.onAckTimeout(abortedTransfer)` 签名扩展 | 两实现适配点入 §10/§11 ALLOW；hub 忽略参数（行为不变） | 无缺口 |
| 漏斗挂点新增（清 assembly + 置标记） | 唯一实现点 = 两漏斗记忆化门后（DD-8.3）；静态判据可 grep | 无双写/漂移面 |
| `resyncEpisode` 标记 | ns 控制器私有；置位/清除挂点全集 = onResyncReceived + 两漏斗 + 结算边 | 单一事实源保持（round-engine DENY 不触碰） |
| SA6 A1（wire 位唯一门控） | `abortedTransfer` 是协商位的结构后果而非第二 feature-flag | 相容（SA8 r3 C9 同裁定） |
| wire/schema 消费者 | 零 wire 格式变化、零词表新增；§9.4 发射点登记 append 归 #246 | 相容 |
| plugin 三封闭键集（N1 维持） | `chunkedUpdate`/`maxChunkedUpdateBytes` 入键集（§8/§11） | 必要且在 ALLOW |

## 13. 文件范围与验收设计审查

- **ALLOW vs 触点**：F6/F7 全部触点（update-channel、peer/hub-namespace、types.ts 签名）有 DD 归因；DENY 零冲突（replication-protocol 零触达与零 wire 格式变化自洽；round-engine/observer/backpressure 维持 DENY 且正文确不需触达）。
- **§12 完备性**：AC1–AC8 全行 + F1–F7 行 + 漏斗收敛零漂移回归行 + 发射点静态核验行 + P4-S/P4-R + 未协商双负控（混合队列 + ack-timeout）+ N11 方向标注 + 全量回归行（root test + typecheck + watchdog/recovery/backpressure/fairness 套件）。R10/R11 实现轮守门项有测试锚。
- **红灯文件零编辑承诺**：F5 公式未触碰 + fixture 三事实复验——承诺维持成立。

## 14. Non-blocking observations

1. **N12（§12 F7 行测试构型澄清）**：F7 场景中 hub 的原下载载体在对端（peer）声明到达后经 `markResyncReceived → discardQueued` 弃置——原数据经恢复 round 的 STEP2 diff 回流，**不会**以新 transferId 重发为 chunk 流。行内「hub 新 transferId 首 chunk 正常收齐」需要测试在 round 结算回 live 后**注入一笔新的超限写**来产生新 transfer。建议 SA3/SA7 构造时按此理解（一句话澄清即可，断言本质——ns 不 failed、assembly 干净、新 transferId 落锚——不变）。对照：F6 两方向载体保留（ack-timeout 不清队列），「整笔重传」自然成立，无此细节。
2. **N13（O7 对齐的显式化建议）**：DD-7.2 的 peer 分派落点宜显式注明「保持在 `onAckTimeoutFired` 既有 `live || needs-resync` 外层门内（:907）」——与 SA8 r3 O7 同旨。结构性上 activeTransfer ⟹ live 使该门在 F6 子路径恒通过（A20），显式句只消除实现轮把分派提出门外的歧义，随 R10 一并由 §12 未协商负控 + 实现轮评审守门。
3. **N8/N9（维持登记）**：跨 ns 聚合内存上界（#244 `maxConcurrentAssembliesPerConnection`）与 chunkable 双时刻求值（R8 by design）——维持 iteration-1 登记，无动作。
4. **N10（前版观察清单状态）**：N7（B(i) 局限）已采纳进 DD-7 备选否决；N11（方向标注）已入 §12——处置完毕。

## 15. 裁决汇总

- **F6/F7（iteration-1 MAJOR）验证结论：全部正确、完整落实。** F6 以路径 B（协商限定弃置时刻声明）闭合：五处断言全改、结构门使未协商 v1 逐字节不变成为构造性保证、记忆化不变量独立重推成立、协议依据与既有先例充分、强制定向 SA8 复核已由 r3 履行且 clear（O5 解除）；F7 以「语义钉死 + 漏斗收敛 + 静态判据」三重闭合：发射点全集 grep 实证一致、收敛零行为变化经源码逐行比对成立、hub 单漏斗表述与源码一致。
- **维持面无回退**：F1–F5 与 N1–N6 落实维持（本版零语义触碰，源码 HEAD 未变）；D1/D2/W1–W4、SA6 A1–A3/红灯契约、架构一致性（责任归属/单一事实源/生命周期对称/零平行机制）、文件范围、验收映射全部通过。
- **本轮新增攻击面（A20–A25/V1–V6/§10 重推）零命中**：含 drain 窗口角落（本轮源码级独立复核 C17 成立）、交叉声明、PN6b 无 transfer 子路径的 stale 窗口排除、夭折首 chunk 的 busy 冲突排除。
- **结论：pass（approve）。** 设计可进实现轮；`requiresConflictRecheck: false`（F6 路径 B 复核义务已履行完毕，本轮无新语义面）。N12/N13 为实现轮参考性澄清，不构成修订要求；`pass` 不替代 SA4/SA7 对实现与活链路的后续验证（含 O8 的挂点 4 实现覆盖与 R10/R11 守门项）。
