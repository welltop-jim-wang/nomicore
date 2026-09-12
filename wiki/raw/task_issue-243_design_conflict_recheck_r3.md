# SA8 设计后冲突复核第三轮（SA1 iteration-2 修订版定向复核：F6 路径 B + F7 收敛）— Issue #243（issue #233 切片 2）

- Dispatch：`sa-c1888857-d428-4c3b-9bbe-948725c80c0c`（mabf-sa8 / conflict-gate / iteration 3）
- 复核对象：`wiki/raw/task_issue-243_design.md`（SA1 iteration-2 修订版，dispatch `sa-2f765e76`，491 行——SA2 iteration-1 reject（F6/F7）后的 F6/F7 落实版，其 §14 自映射修订落实、§15 明示申请本定向复核）
- 复核范围（dispatch 点名五面）：①协商限定（negotiated-only）的 ack-timeout→RESYNC_REQUIRED 路径；②接收端 assembly 清理；③v1 行为不变；④恢复 round 语义；⑤SA2 F6/F7 两项 MAJOR 的成文落实——逐面对照 ADR 全集 + `CONTEXT.md` + `docs/protocols/instance-replication-v1.md`（经 ADR 0013「接受后以该文档修订为唯一 wire 权威」条款纳入）+ 已批准 SA6 红灯契约（`wiki/raw/task_issue-243_sa6_contract.md`，approve）
- 裁决基准（仅此二者为自动阻塞依据）：`docs/adr/` ADR 全集（无被 supersede 的相关 ADR；ADR 0013 状态「提议」但为该特性线操作性决策，W1 维持）+ 根 `CONTEXT.md`
- 工作区：worktree `nomicore-fix-issue-243`，分支 `mabf/issue-243`，HEAD `c20aeb0`（与简报/前置门禁/SA6/SA2 前两轮/设计七方 header 一致；`git status` 仅 8 个 untracked 产物/fixture 文件，零 tracked 改动）
- 结论：**无冲突（clear）** —— 41 项裁决检查 0 项 ADR/CONTEXT 矛盾、0 项阻塞、0 项需 override；F6 路径 B（协商限定 ack-timeout 声明）与 F7 漏斗收敛全部与 ADR 0013/0010、协议 §6.2/§9.4/§6.3、CONTEXT 词条及 SA6 契约相容；**SA8 r2 O5 的条件性冲突条款正式解除**（路径 B 已按 SA2/S8 双方预授的修法落实并本轮定向复核通过）；3 项登记性观察（O6–O8，均无需回设计）
- 程序披露：`sa8-conflict-gate` 技能在本环境技能目录未注册（`.agents/skills/` 无该项、skill 工具报 unknown）；本复核按仓库既有 SA8 固定产物（前置门禁 + r1 + r2）的同一程序与格式重建执行——裁决基准不变（ADR 全集 + CONTEXT.md 为唯一自动阻塞依据）、只读、逐点实读源码锚点、独立 REST 评论复验。

## 1. 输入与证据

| 证据 | 位置 | 状态 |
|---|---|---|
| SA1 iteration-2 设计修订版 | `wiki/raw/task_issue-243_design.md`（491 行） | 本复核对象；§14 F6/F7 修订映射与正文逐处核对（§5） |
| SA2 iteration-1 攻击评审 | `wiki/raw/task_issue-243_sa2_review.md`（reject，2 MAJOR（F6/F7）+ N7–N11；F1–F5 验证通过） | F6/F7 的 required change + acceptance（§13）为本轮裁决基准之一（dispatch 点名） |
| SA8 前置门禁 / r1 / r2 | `20260908-sa8-conflict-gate-issue-243.md`（clear，D1/D2/W1–W4）/ `task_issue-243_design_conflict_recheck.md`（clear，O1–O4）/ `task_issue-243_design_conflict_recheck_r2.md`（clear + 必答观察 O5） | r2 §3 路径 B 预授条款 + 「路径 B 语义修订须随附定向 SA8 复核」即本轮程序依据 |
| SA6 红灯契约 | `wiki/raw/task_issue-243_sa6_contract.md` + `packages/ws-replication/test/ws-replication-issue243-ac-red.test.ts` | approve；本轮实读复验 fixture 三处（§2.1-C9） |
| ADR 0013 / ADR 0010 | `docs/adr/0013-…md`（协商 :20-25 / 消息形态 :46 / 发送端 :48-54 / 接收端 :56-63 / 错误码 :78-81）；`docs/adr/0010-…md`（round 由 Peer 发起 :149） | 逐条对照（§2） |
| 协议文档 | `docs/protocols/instance-replication-v1.md` §6.1-6.3（:117-157）/ §9.4（:250-266）/ §10.2-10.3（:288-313）/ §13.2（:386-416） | RESYNC 声明语义与 reason 词表、drain 名单、错误码注册 |
| CONTEXT.md | 「分块复制传输」:141-143 /「UPDATE_CHUNK」:145-147 /「CAP_CHUNKED_UPDATE」:149-151 | 「中断即丢弃并回退 state_vector reconciliation」恢复语义词条 = O5 条款基准 |
| 源码锚点 | 设计 §2 全表 + F6/F7 绑定面（peer-namespace :883-981 / hub-namespace :560-567、:740-818、:1044-1056 / update-channel :86、:160-178、:326-372 / 两 connection 握手与占位与 drain / negotiation / frame-io / 红灯 fixture） | 本轮实读 16 处（§5），零漂移；生产 `RESYNC_REQUIRED` sendChecked 发射点全集 grep 实证恰 3 处 |

### 1.1 Owner 评论扫描（dispatch 要求复验）

dispatch 声明：issue #243 评论经 REST 于 dispatch 前即刻刷新——**空**（无 owner 要求）。本轮独立复验：`gh api repos/welltop-jim-wang/nomicore/issues/243/comments` → `[]`（exit 0）；issue state=open、updated_at 2026-09-08T13:40:07Z。与 Host 简报 `## Comments` 空、SA6 §2、SA8 门禁 §1.1、r1 §1.1、r2 §1.1、SA2 §4（两轮）八方一致：**无评论衍生约束或豁免**，需求面 = issue body 8 条 AC。

## 2. dispatch 点名五面逐项裁决

### 2.1 ①协商限定的 ack-timeout→RESYNC_REQUIRED 路径（F6 路径 B，DD-7）：无冲突

设计决策：`abandonInFlight()` 入口捕获 `abortedTransfer = (activeTransfer !== undefined)`（显式清除之前），经 `host.onAckTimeout(abortedTransfer)` 上抛；peer `onAckTimeoutFired` 分派——`true` → `declareLocalResync('ack-timeout')` 单漏斗（wire RESYNC_REQUIRED + needs-resync + observer + 恢复 round），`false` → PN6b 原体逐字节；hub 不变（既有 `declareHubResync('ack-timeout')`）。

| # | 核验点 | 上游条款 | 裁决 |
|---|---|---|---|
| C1 | **结构门成立**：`abortedTransfer=true` ⟺ abandonInFlight 时刻 `activeTransfer` 在场 ⟹ 载体为 chunkable ⟹ `(negotiated & CAP_CHUNKED_UPDATE) ≠ 0`；transfer 初始化仅对 chunkable 项（DD-3.4 先窥），协商位握手期定死、连接生命周期内不变（dialNow 复位） | ADR 0013:23「未协商 ⇒ 发送方不得分块，超限行为保持 v1（丢弃 + needs-resync，#231 观测不变）」 | **一致且结构性**：未协商连接上新 wire 行为不可达——不是配置纪律而是构造性不可能（无 chunkable ⟹ 无 transfer ⟹ abortedTransfer 恒 false ⟹ PN6b 原体） |
| C2 | **peer 声明的协议许可**：任一端可作废增量连续性；round 恒由 peer 以新 roundId 发起 | 协议 §9.4:264「任一端可声明当前增量连续性作废，但始终由 Peer 用新 roundId 发起下一轮」；ADR 0010:149 | 一致：peer 在协商子路径发 RESYNC_REQUIRED 属字面许可；hub 既有 `:817-818` 行为同源（本轮实读） |
| C3 | **wire 零增量**：帧型 = 既有 `RESYNC_REQUIRED`、reasonCode = 既有 `send-queue-overflow`（hub 全部 cause 共用该 reason 的既有先例，`hub-namespace.ts:811` 实读）；observer cause `ack-timeout` 在既有联合类型中（`peer-namespace.ts:1487-1493` 实读） | 协议 §9.4 reason 词表 append-only（「新增 reason 必须先登记后发射」）；§13.2 registry | 一致：零新帧型、零新 reason、零新 observer cause/事件类型——不触犯任何 append-only 前置登记纪律 |
| C4 | **ADR 0013:54 对齐**：「ACK timeout ⇒ 停发后续 chunk、末 chunk 序入 zombie 簿记、needs-resync 同构处置」——设计把「同构处置」读为镜像 hub 的漏斗声明（chunked 子路径限定），发送侧三义务（停发/zombie/needs-resync）逐项在 DD-3.7 落实 | ADR 0013:54 | 一致：hub 既有行为即漏斗声明（`:817-818`），peer 在「协商 ∧ transfer 中止」取同一读法是 ADR 条款的对称延伸，不引入新自由度；abortedTransfer=false 子路径保持 v1 PN6b，未与「同构」条款产生双向强制（ADR 对 peer 无 transfer 形态的历史行为冻结于 v1 观测） |
| C5 | **接收端零新增弃置触发**：闭合完全复用 ADR 0013:58 既有清单第 5 边「收到 RESYNC_REQUIRED ⇒ 全部丢弃」——hub `onResyncReceived`（:661-666 实读：markResyncReceived + setState needs-resync）即 DD-4 挂点 1 | ADR 0013:58 | 一致：接收端清理触发面在 ADR 已枚举集合内，本决策只保证发送端信号可达 |
| C6 | **记忆化不吞声明不变量（DD-7.6）**：`resyncDeclared=true` ⟺ 未结算恢复周期 ⟹ channel.needsResync=true（双端漏斗/边沿内同步置位、结算边同步双清——peer `:898-901`/hub `:1050-1053` 实读同块清零）⟹（F2 不变量 needsResync ⇒ 无 activeTransfer）⟹ abandonInFlight 不可能见到 activeTransfer。故 abortedTransfer=true 子路径漏斗必真实发射；observer 事件恰一次（两分支互斥、cause 字符串相同） | 设计自定不变量 × 源码事实 | **成立**（本轮独立推演 + 源码逐点核验）；#231 观测面（`resync-required{ack-timeout}` 恰一次）两分支下均保持 |
| C7 | **时序与同向序（DD-7.4/7.7）**：漏斗序 sendChecked（:952-956）→ setState → emit → maybeStartRecovery（:959）；abandonInFlight 先清 inFlight（:344）再上抛（:347）且 `inFlightCount` 只计 inFlight.size（zombie 不计，:86-88 实读）⟹ maybeStartRecovery 的 §9.4 窗口收口门即时通过、round 同步发起；RESYNC 与 STEP1 同一出站队列同向 FIFO ⟹ 声明先于 round 帧；残渣 chunk（弃置前出站）先于声明到达对端 | 协议 §1 单向有序不变量；§9.4「Peer 等待 in-flight 窗口收口后开始新 round」 | 成立：timer 栈内发 wire + 同步 round 发起均为既有模式（hub :817-818 / peer periodic-reconcile :1575-1579 先例，SA2 已核）；与 PN6b `deferTask` 的差异仅为进程内调度次序，wire 序不变 |
| C8 | **hub→peer 方向对称闭合**：hub 既有 wire 声明（:817-818）→ peer `onResyncReceived`（:561-567 实读：markResyncReceived + needs-resync + maybeStartRecovery）清 inbound assembly + 置 resyncEpisode（挂点 1/3） | ADR 0013:54/:58 | 成立：两方向均「弃置时刻 wire 声明 → 接收端既有边清理」 |
| C9 | **SA6 契约零交集**：fixture `ackTimeoutMs=60_000` 虚拟（test :94 实读）——红灯断言面（P1/P2/P3/NC0-2）不触达 ack-timeout 路径；`rewriteChunkCapability` 只改写两握手帧（:123-141 实读）、限值 `maxQueuedUpdateBytes=1MiB`（:87）+ 缺省 `maxChunkedUpdateBytes=4MiB` 维持「无跨字段链」裁定 | SA6 §12 A1–A3、§15 | 相容：F6 新行为与冻结红灯断言面结构性无交集；A1（wire 位唯一门控）不被 F6 破坏——`abortedTransfer` 是协商位的结构后果（transfer 在场 ⇒ 已协商），非第二 feature-flag 门 |
| C10 | **可达性收窄的实现守门（R10）**：`abortedTransfer` 由通道在 `activeTransfer` 在场判定（结构门）而非控制器自估；§12 AC6 未协商 ack-timeout 负控（零 RESYNC_REQUIRED 帧）+ F6 双向行 | 设计 R10 | 已设防（实现轮守门项，非本轮冲突面） |

**裁决：无冲突。** 路径 B 在协议字面（§9.4 任一端可声明 + 既有 reason 词表）、ADR 0013:54「同构处置」的 hub 镜像读法、:58 接收端既有弃置边内闭合；协商限定为结构性保证。

### 2.2 ②接收端 assembly 清理（DD-4 挂点表 + DD-8 漏斗收敛，F7）：无冲突

| # | 核验点 | 上游条款 | 裁决 |
|---|---|---|---|
| C11 | **挂点清单 vs ADR 0013:58 枚举**：挂点 1（onResyncReceived）与挂点 4（终态/静默单点：连接断开、close/终态、GOAWAY drain、epoch fence）为 ADR 字面边；挂点 2/3（本端 wire 声明发射点 + 恢复结算边 resyncEpisode）为枚举之外的**加性安全边** | ADR 0013:58 | 一致：r2 §2.3-4 已裁定同类第六边（恢复结算边）为「加性、无冲突」；挂点 2 与之同理且因果更强——本端声明送达对端 ⇒ 对端 markResyncReceived 弃置其在途载体（含 transfer 项）⇒ 本端 inbound assembly 必然残缺，清理是 ADR:58 对端边在本端的直接投影；零 durable 残留原则全程保持 |
| C12 | **发射点全集静态核验（F7 判据）**：生产 `kind:'RESYNC_REQUIRED'` sendChecked 发射点 grep 实证**恰 3 处**——peer `declareLocalResync` :953、peer `onWatchdogEdge` 内联 :974、hub `declareHubResync` :809（其余匹配均为测试/codec） | 设计 DD-8.1 判据 | 属实：DD-8 收敛后全集 = 两漏斗 == 挂点全集，判据可静态 grep（§12 行在）；hub 单漏斗三调用点（watchdog session 边沿 :741-750 / onLocalResyncEdge :785-792 / ack-timeout :817-818）实读与设计表述一致 |
| C13 | **F7 收敛零行为变化声明**：漏斗体（memo 门 :949 → clearTimer :950 → resyncDeclared=true :951 → sendChecked :952-956 → setState :957 → emit(cause) :958 → maybeStartRecovery :959）与内联声明段（:970-980）指令序逐行等价（同帧同 reason 同状态序同 observer cause）；`markSessionResyncEdge` 保持漏斗调用前无条件执行（幂等：`markResyncReceived` = needsResync + discardQueued，:165-174 实读，重复零漂移） | SA2 F7 备选接受条件 | **成立**（本轮源码逐行比对）：收敛是纯结构改动，`cause='session-fanout-overflow'` 已在漏斗联合类型（:944）；行为面零漂移 ⇒ v1/协商观测均不变 |
| C14 | **挂点落位（漏斗内、记忆化门后）**：被记忆化吞掉的重复声明不重复置位/清理（恢复周期内首次发射已置 resyncEpisode、结算边消费）；hub 漏斗 quiet 早退（:805）不发射即不置位——quiet 态由终态/静默单点收口 | 设计 DD-8.3 | 成立：置位/清除生命周期闭环（peer :901 / hub :1053 同块清零） |
| C15 | **R3 闭合论证完整性（本轮重推）**：发送端全部可持有 transfer 的弃置路径必发 wire 信号或杀连接——路径 1（queue-overflow → 漏斗，channel host 委托 :225 实读）、3/4（对端声明/session 边沿 → markResyncReceived/markSessionResyncEdge + 本端或对端漏斗声明）、5（shed live → facet 漏斗声明 :162-169 实读；非 live 分支结构性无 transfer）、6/8（发送/出站拒绝 → 漏斗）、9（teardown → 连接死亡 → 对端 quiesce 收口）、ack-timeout∧transfer（hub 既有 + peer F6 新增）；路径 2（deferred 溢出）与 7（超限-队列空）结构性无 transfer 交集（载体在场 ⟹ 队列非空/needsResync=false） | CONTEXT「分块复制传输」:142「中断即丢弃并回退 state-vector reconciliation」 | **成立且两方向对称**：SA8 r2 O5 指出的唯一无信号反例（peer ack-timeout）已消除；该词条的恢复语义首次在两个方向以 wire 信号落地——**O5 条件性冲突条款解除** |
| C16 | **残渣方向序 + live 行 fail-loud 保留**：残渣与 round 帧同向有序先于结算到达非 live 态（r2 §2.3-2 已独立推演，本轮维持）；live 行 `idle∧chunkIndex>0` 保留响亮 VIOLATION 为防御深度（B(i) 否决理由——hub 在重传首 chunk 到达时处于 live） | ADR 0013:43「错序/重复即对端 bug ⇒ 响亮 violation」 | 一致：协议内不可达防御面未弱化（N7 采纳正确） |
| C17 | **drain 窗口角落（本轮补查）**：hub `drainActive` 丢弃名单现含 RESYNC_REQUIRED（:718-732 实读）——F6 声明若在 reauth drain 窗到达 hub 会被静默丢，挂点 1 不触发；但 drain 收口 = WS 1001 关闭/连接拆除 → 挂点 4（终态/静默单点，含 GOAWAY drain）清 assembly | 协议 §6.3:156「其余会启动新工作的迟到 namespace frame 静默丢弃…deadline 到达后以 WS 1001 关闭」 | 一致：无超越连接死亡的 stale-assembly 窗口；设计挂点表第 4 行已显式列 GOAWAY drain——覆盖成立，登记为观察 O8（实现轮须确保该单点实现真覆盖 assembly） |

**裁决：无冲突。** 接收端清理生命周期（发射点全集 + onResyncReceived + 恢复结算边 + 终态单点）闭合，F7 的枚举缺口以「语义钉死 + 静态判据 + 漏斗收敛」三重落实。

### 2.3 ③v1 行为不变（AC6 / ADR 0013:23）：无冲突

| # | 核验点 | 裁决 |
|---|---|---|
| C18 | 未协商连接：`chunkable ≡ false` ∧ `activeTransfer` 结构性缺席（F1/r2 已 clear）∧ `abortedTransfer` 结构性恒 false（C1）→ deliver 直发条件与 v1 逐字节同义、PN6b 原体覆盖全部 ack-timeout、零新 wire 帧 | 一致（F6 是纯协商子路径行为；AC6 断言域从「超限丢弃形态」扩展到「ack-timeout 观测形态」——§12 未协商 ack-timeout 负控新增行恰为该面守门） |
| C19 | 协商连接上无 transfer 的 ack-timeout（纯直发帧超时）：`abortedTransfer=false` → PN6b 原体逐字节（零 wire、deferTask 恢复）——新帧仅出现在「协商 ∧ transfer 中止」子路径 | 一致：改道面收窄原则（F1）在弃置信号面的对偶 |
| C20 | #231 观测不变：`resync-required{ack-timeout}` 恰一次、cause 词表零新增（C3/C6）；F7 收敛路径 `session-fanout-overflow` 观测逐字节等价（C13） | 一致（ADR 0013:23「#231 观测不变」在全部新增面上保持） |
| C21 | SA6 NC2/R1/R2/R3 冻结面：F6/F7 修订零触达（红灯断言面不含 ack-timeout，C9；漏斗收敛为源内结构改动，wire/observer 零漂移，C13） | 相容：红灯文件「随实现零编辑转绿」承诺不受 F6/F7 影响 |
| C22 | B(iii)/B(ii′) 等备选对 v1 面的潜在侵蚀均被否决（弃置载体 = 协商连接可观测量变化走 v1 round 修复——设计已在 DD-7 备选否决中显式排除） | 一致：所选路径是对 v1 面侵蚀最小的闭合方案（结构门 + 既有帧型） |

### 2.4 ④恢复 round 语义：无冲突

| # | 核验点 | 上游条款 | 裁决 |
|---|---|---|---|
| C23 | **零新增轮次**：弃置时刻声明搭乘 PN6b/漏斗既有恢复 round（两分支本都要发起 round：PN6b deferTask(:911-913) / 漏斗 :959）；B(ii′)（重传前声明）被否决正因其触发第二轮 | 协议 §9.4:266「合并为至多一个紧随其后的 round」 | 一致：声明不制造额外 round，恰把既有 round 升级为「有信号」形态 |
| C24 | **round 发起权垄断**：round 恒由 peer 以新 roundId 发起；hub 漏斗无恢复发起（实读 :796-815 无 maybeStartRecovery），hub 结算等待 peer | 协议 §9.1:220/§9.4:264；ADR 0010:149 | 一致：F6 保持该垄断（peer 声明 + peer 发起恢复 round；hub 声明 + 等待 peer round——双向均然） |
| C25 | **「发出后不再发送新 UPDATE」**：声明后 channel needsResync ⇒ `pullAndSendOne` 首前置 false（DD-3.4 分支序）——UPDATE/chunk 均停 | 协议 §9.4:264 | 一致 |
| C26 | **「Peer 等待 in-flight 窗口收口后开始新 round」**：maybeStartRecovery `inFlightCount>0` 延后（:919）；abandonInFlight 已清 inFlight（zombie 不计入，C7）⟹ 无额外等待；周期 round 延后判据扩为有效口径（DD-3.8，r2 已 clear）——peer 决不在自身 transfer 在场时发起 round（B(iv) 否决的安全前提） | 协议 §9.4:264/:266 | 一致 |
| C27 | **hub 收 STEP1 不迁出 live**（:560-567 实读零 setState）：F6 闭合论证的关键锚点成立——hub 在 peer 恢复 round 期间保持 live/needs-resync（收声明后），`onSyncStep1` 仅 quiet 门、needs-resync 非 quiet ⟹ round 正常推进；hub 结算门允许 needs-resync → live（:1049 实读） | 协议 §15 状态机；设计 §2 锚点 | 一致：round 语义零变化（round-engine 在 DENY，resyncEpisode 在 ns 控制器） |
| C28 | **周期 round 与恢复 round 区分维持**：resyncEpisode 仅 declare/收声明两类边置位、仅恢复结算边清除；周期 round 不置不清（hub onSyncStep1 无状态迁移）；peer `pendingResync → 再开 round+1` 分支保持标记至真正回 live（:892-896 实读） | 设计 DD-4 挂点行 3（r2 §2.3-3 已裁定） | 一致：下行 transfer 跨周期 round 存活续收不误杀 |
| C29 | **transferId 恢复语义**：任何 resync/终态不复位、恢复后新 transferId 整笔重传落干净 assembly（C15 闭合）；dialNow 重建归 1 = 新连接作用域 | ADR 0013:32；CONTEXT Avoid「transferId 当跨连接持久标识」 | 一致 |

### 2.5 ⑤SA2 F6/F7 两项 MAJOR 的成文落实：已落实且合格

| # | 核验点 | SA2 acceptance 条款 | 裁决 |
|---|---|---|---|
| C30 | **F6 五处不实断言全改**：DD-3.7 括注（现文 = 中止信号捕获 + 双角色分派，无「已清除」断言）、DD-4 挂点行 2（现文 = 发射点全集语义）、§9 恢复（现文 = 两方向对称闭合 + PN6b 原体子路径）、§13-R3（现文 = 完整闭合论证含 peer ack-timeout 声明）、§12（现文 = F6 双向行 + 未协商负控，断言 = 真实行为）——本轮全文检索无旧断言残留 | F6 acceptance 第 1 条「设计文本零不实断言（五处全改）」 | **通过** |
| C31 | **F6 §12 测试行双向 + 断言一致**：peer→hub（恰一帧 peer RESYNC → round 收敛 → 新 transferId 整笔收齐 → hub ns 不 failed）、hub→peer（对偶）、未协商负控（ack-timeout 零 RESYNC 帧）；N11 方向标注在行 | F6 acceptance 第 2 条 | 通过（实现轮执行） |
| C32 | **F6 路径 B 协议依据 + 可追认**：依据 = §9.4「任一端可声明」+ ADR 0013:54「同构处置」（hub 镜像）+ :58 既有接收边（C2/C4/C5）；追认面 = §9.4 发射点登记 append（O6）+ §10.2/10.3 修订随 #246（W2 边界内） | F6 acceptance 第 3 条「新增 wire 行为有协议依据并可追认（#246），SA8 定向复核通过」 | **通过（即本报告）** |
| C33 | **F7 锚点完备 + 收敛 + 静态判据**：§2 行改「发射点全集」（peer 两处/hub 单漏斗三调用点）、DD-4 挂点行 2/3 语义钉死为「任何 wire 发射点」、DD-8 收敛含零行为变化声明（C13 源码级成立）、§12 F7 行 + 发射点静态 grep 行 | F7 acceptance 全部三条 | **通过**：grep 实证 3 处（C12），收敛后 2 漏斗 |
| C34 | **N7–N11 处置**：N7（B(i) 单独不闭合）已显式采纳进 DD-7 备选否决；N8/N9 维持登记；N10 确认移除；N11 已入 §12 F6/F7 行 | SA2 §14 | 全部处置 |

### 2.6 交叉维持面回查（F6/F7 修订未触碰已裁面）

| # | 项 | 回查结论 |
|---|---|---|
| C35 | D1 临时期分配上界（DD-4 校验序 0–6 先于分配） | 未触碰，维持 r1/r2 裁定（遵守） |
| C36 | D2 配置旋钮切分（`maxChunkedUpdateBytes` 全量拥有、无跨字段链——fixture 1MiB+4MiB 组合实读复验、P4-S 回退有测试） | 未触碰；F6/F7 不涉配置面（遵守） |
| C37 | W1（ADR 0013 状态）/ W2（协议文档滞后——F6 发射点登记 append 归 #246 追认，属登记面非语义面）/ W3（零新 observer 事件类型：F6 经漏斗 emit 为既有事件 + 既有 cause）/ W4（零新诊断 emission） | 遵守（W2 边界扩展一处，可追认，见 O6） |
| C38 | 文件范围：F6/F7 全部触点（update-channel / peer-namespace / hub-namespace / types.ts 的 onAckTimeout 签名）在 ALLOW 且有 DD 归因；DENY 零冲突（replication-protocol 零触达 = 零 wire 格式变化的一致性成立；round-engine/observer/backpressure 维持 DENY） | 遵守 |
| C39 | SA6 A1–A3 维持（C9）；D1/D2/W 与 r2 §4 回查面无回退 | 相容 |
| C40 | `requiresConflictRecheck` 程序合规：SA1 §15 正确申请（SA8 r2 §3「路径 B 语义修订须随附定向 SA8 复核」+ SA2 §2 同裁定）——本报告即该要求的一次性履行 | 程序闭合 |
| C41 | 设计内部一致性：§14 映射与正文逐处核对无「附录承认正文未改」；唯一遗留语义门（O7 实现细节）不构成文本矛盾 | 自洽 |

## 3. 本轮观察（登记性，均无需回设计）

- **O6 — §9.4 发射点登记 append 待 #246 追认（W2 边界内）**：协议 §9.4 词表的「现状登记」列现为「既有发射点：hub-namespace / peer-namespace 溢出声明」；F6 新增 peer ack-timeout 发射点（既有 reason `send-queue-overflow`、零新词表）与 F7 收敛后的发射点集合变化，属该登记列的 append。词表纪律（「新增 reason 必须先登记后发射」）不被触犯——零新 reason；登记列是发射点现状文档而非规范闭集，且 §9.4 修订权属 #246（ADR 0013 落地条款）。可追认，与 W2 既有先例（transfer 1 槽、drain 名单 +1）同构。#246 落地时须一并登记（设计 §11 DENY 行已明示归属）。
- **O7 — F6 分派的实现守门细节**：peer 漏斗无 quiet 态早退（hub 漏斗有 `isQuietState` 门 :805——peer 漏斗依赖调用方门）。设计 DD-7.2 把分派落在 `onAckTimeoutFired`（:906-915）修订内、其外层 `live || needs-resync` 门保持——本轮源码核验该门在（:907），且 `activeTransfer` 在场 ⇒ 状态必为 live（needs-resync ⟹ transfer 已清；reconciling ⟹ DD-3.8 延后/facet live 门使 transfer 不能在场），门通过无歧义。实现轮不得把分派提出该门外（防 quiet/disconnected 态漏斗裸发）。随 R10 一并由 §12 未协商负控 + 实现轮评审守门。
- **O8 — 终态/静默单点对 assembly 的实现覆盖**：挂点 4 在协议 §6.3 drain、epoch fence、连接拆除各收口形态下都必须实际清 assembly（含本轮 C17 补查的 drain 期 RESYNC 被丢角落——由 drain 收口的连接死亡兜底）。设计挂点表已列全这些形态；属实现完备性而非设计冲突，SA4/SA7 轮按 §12 中止/清理行验收。

## 4. 与 SA8 r2 §3-O5 条款的正式结算

- **O5 条款原文**：「若 SA1 既不更正断言、也不登记/闭合该子路径而维持现文进实现轮，则构成与 CONTEXT『中断即丢弃并回退 reconciliation』恢复语义的未管理偏离，升级为冲突，回设计」——**不触发**：SA1 已选路径 B（闭合）且五处断言全改（C30）。
- **路径 B 的定向复核要求**：「任一路径的修订建议随附定向 SA8 复核（本结论不自动延伸到该修订）」——**已履行**：本报告即对该修订（DD-7 决策 + 五备选否决 + DD-8 联动）的独立复核，结论 clear（§2.1/2.2/2.4）。
- **O5 后续状态**：**解除**。peer ack-timeout 子路径不再属 R2 无信号族；R2 残余收缩为「发送侧真停摆（bug/世界暂停）」族（设计 §13 R2 本版已如实收窄），系统性收口归 #244 `assemblyTimeoutMs`（W3 边界不变）。

## 5. 设计引证源码锚点实读核验记录（本轮 16 处）

`update-channel.ts`（`inFlightCount` 仅计 inFlight.size :86-88 / `markResyncReceived`+`markSessionResyncEdge` :164-174 / `abandonInFlight` 无 discardQueued、先清 inFlight 后上抛 :340-348 / `resetForLive` :327-330 / `armAckTimer` 幂等 :364-372）；`peer-namespace.ts`（channel host 接线含 `onAckTimeout: () => this.onAckTimeoutFired()` :221-239 / facet shed 分派 live→漏斗 :158-170 / `onRoundSettled` live 分支同块清 resyncDeclared :883-904 / **`onAckTimeoutFired` PN6b 零 wire :906-915** / `maybeStartRecovery` :917-923 / **`declareLocalResync` 漏斗（cause 联合含 ack-timeout/session-fanout-overflow）:939-960** / **`onWatchdogEdge` 内联声明 :962-981** / `onResyncReceived` :561-567 / `emitResyncRequired` cause 联合 :1486-1494）；`hub-namespace.ts`（**`onSyncStep1` 零 setState :560-567** / watchdog session 边沿→漏斗 :741-750 / `onLocalResyncEdge`→漏斗 :785-792 / **`declareHubResync` 单漏斗 quiet 门+记忆化 :796-815** / **`onAckTimeoutFired`→漏斗 :817-818** / `onRoundSettled` needs-resync 可结算+清 resyncDeclared :1044-1056 / `onResyncReceived` :661-666）；`hub-connection.ts`（drainActive 名单含 RESYNC_REQUIRED/UPDATE 不含 0x42 :718-732 / HELLO_ACK selected=0 :707）；`peer-connection.ts`（HELLO optional=0 :337 / UPDATE_CHUNK 占位 :525-530）；`negotiation.ts`（`selectCapabilities` :26-29）；`frame-io.ts`（`decodeInbound` 无 selectedCapabilities :59-68）；红灯 fixture（LIMITS/TIMEOUTS/`rewriteChunkCapability` :85-141）；生产 `RESYNC_REQUIRED` sendChecked 发射点 grep 全集 = {peer :953, peer :974, hub :809}——**设计与 HEAD 零锚点漂移；SA2 §6「唯二例外即 F6/F7 绑定面」的更正已被本版 §2 吸收且与源码一致**。

## 6. 裁决汇总

- 检查项合计：**41**（C1–C10 F6 路径 10、C11–C17 接收清理 7、C18–C22 v1 不变 5、C23–C29 恢复 round 7、C30–C34 F6/F7 落实 5、C35–C41 交叉维持 7）+ 锚点实读 16 处归档（§5）+ 评论扫描复验 1（§1.1）
- 分布：无冲突/对齐 **41**；登记性观察 **3**（O6/O7/O8——均非冲突，实现轮/#246/#246+实现守门承接）；阻塞 **0**；与 ADR/CONTEXT 矛盾需 override **0**；SA8 r2 O5 条件性冲突 **解除**（§4）
- 门禁结论：**clear** —— SA1 iteration-2 设计修订版（F6 路径 B + F7 漏斗收敛）与 ADR 全集、CONTEXT.md、协议条款及已批准 SA6 契约一致，**设计可进实现轮**；F6/F7 触发的定向复核义务经本报告履行完毕，后续无需新的冲突轮（除非实现轮引入本报告未覆盖的语义偏离——届时按 SA8 r2 §3 既有规则另行触发）
