# SA2 攻击评审报告

**Date**: 2026-08-29（R1 首审；R2 复审追加节见文末；R3 复审追加节见最后）
**Verdict (R1)**: **reject**（A1/A2 修复后复审放行；A3–A6 为 LOW，随 R2 修订一并处理或显式声明即可）
**Verdict (R2)**: **reject（收窄至唯一必修 N1——一行级修复）**——A1–A6 六项全部确认已修且与协议/冻结锚兼容；R2 的 A2 修复在 §3.2 门 3 伪代码引入新 MEDIUM 缺陷 N1（`detachEarly()` 在 off 句柄赋值完成前可被同步重放型 transport 调用 → accept reject，违反 §8.2 硬不变量）。
**Verdict (R3，最新)**: **pass**——N1 修复（off 句柄 no-op 初始化 + listener 幂等早退 + 注册后同步收口段）经同步重放全场景推演确认「accept 恒 resolve」在一切 transport 形态下成立；早到缓冲资源语义（16×maxFrameBytes + helloTimeoutMs 封顶）完好；回归锚 A2-e 具判别力（resolves 断言 + 重放零流产计数 + 双关闭码变体 + fixture 治理放行）；N2 路由冻结（B1 pending 计面零扰动）、N3/N4/N5 逐项落实。两条 sub-LOW 备忘随放行记录（不构成修订义务）。详见文末 R3 复审节。

- 被审对象：`wiki/raw/task_phase5-ws-auth-lifecycle_design.md`（SA1 设计档案 **R1 修订版**，2026-08-29）
- 审查视角：全新开局（刻意不继承 R0/SA8 轮妥协），以 R1 文本为唯一基准做全维度攻击
- 约束基准：`task_phase5-ws-auth-lifecycle_relevant_decisions.md`（ADR 0010 为主 + 协议
  `instance-replication-v1.md` §2/§6.1–6.3/§13/§14/§15.1/§15.2/§19/§21 + phase-5 L112–119/L146–151）
  与任务简报冻结契约表 / 10 项红灯
- 源码/工件核对：`hub-connection.ts`、`peer-connection.ts`、`hub-namespace.ts`、`peer-namespace.ts`、
  `round-engine.ts`、`backpressure.ts`、`frame-io.ts`、`types.ts`、`validate.ts`、`defaults.ts`、
  `replication-protocol/src/{messages,errors}.ts`、`test/{driver,harness,issue137-driver}.ts`、
  `ws-replication-{auth-lifecycle-red,sa7-dynamic,sa7-issue137-dynamic,sa7-r2-transport,api.test-d}.test.ts`

---

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议（可执行修订要求） |
|---|--------|--------|---------|------|
| A1 | **MEDIUM（必修）** | D4 GOAWAY 生命周期——onClose draining 分支 | **draining 态吞掉 close-code 分类，1002/1008 永久失败被降格为临时失败**。§6.3 伪代码把 draining 态的一切 close 事件无条件路由 `onGoawayClosed()`（backoff / retryAfter 重连），且注释断言「draining 的唯一非本地来源即 GOAWAY」；§8.3 竞态表也只列出「对端先关（1001/1000）」。**该断言不成立**：close 事件的机器语义由 code 携带（协议 §14「WS close code 只做粗分类」+ §15.1 GOAWAY 原因分级 L439 明文「1002/1008：blocked」），与进入 draining 的前因无关。触发条件：drain 窗口内 hub 侧独立检测到协议/policy 错误（`connectionFatal` 1002/1008，hub-connection.ts:365-382 随时可发生——peer 冻结出站不阻止 hub 侧检测）或中间盒以 1008 强断。影响：对持续以 1002/1008 拒绝的对端**无限重连循环**，违反协议 §15.1 L439、phase L148「认证、版本、身份或 policy 永久错误进入 blocked 并等待配置变化」与 AC-5 permanent-failure blocking。注意 1011 在现路由下落 onGoawayClosed→backoff，恰与 L440「1011：继续 backoff」一致，**不受影响** | onClose 的 draining 分支前置 code 分类：`info.code ∈ {1002,1008}` → `clearDrainClose() + enterBlocked()`（复用既有分支语义）；其余（1000/1001/1006/1011…）→ `onGoawayClosed()`。与全部冻结锚兼容：G1/D5/红灯 #9/§6.5 A2-a/A2-b 均以 1001 关闭，零断言冲突 |
| A2 | **MEDIUM（必修）** | D1 upgrade 认证——早到帧缓冲资源面 | **认证窗口的早到帧缓冲无界，且认证等待无任何时限**——恰是信任边界最外侧的未认证 DoS 面。§3.2 门 3 `earlyFrames.push(bytes)` 无条数上限、无累计字节上限；`limits.maxFrameBytes` 只在 `decodeInbound`（frame-io.ts）解码点生效，缓冲存的是**未解码原始字节**，单帧大小与帧数上限双双缺位；`verifyToken` 为宿主注入（可能慢——外部认证后端），await 窗口 = 认证后端延迟，期间恶意 transport 可无限灌帧；并发 accept 叠加放大。违反 ADR 0010 L165「以下上限均为插件配置并提供安全默认值：最大 WS frame……per-connection 待发送字节」的资源纪律；与 AC-1「invalid credentials never allocate a protocol connection」的保护精神相悖（无效凭据方不获连接分配，却能消耗 hub 内存） | **零新 knob**（沿用 §7.1 的反新配置面立场）：门 3 记账累计字节——单帧 `> limits.maxFrameBytes`（复用既有 limit）或条数超过小常数（HELLO 是唯一合法早到帧，建议 16）→ 立即 `rejectUpgrade`（1009/1008）；同时显式声明认证等待的封顶策略（复用 `helloTimeoutMs` 起一个认证期 timer，或明文声明由 transport/宿主层超时负责——二选一，不得沉默） |
| A3 | LOW | D4 draining 双向冻结 vs §6.3 L147 | §6.2 出站纪律明列「round Step1/**Step2**、CLOSE_NAMESPACE 一并停发」+ 入站门整体丢帧——**在途 round 的完成帧也被冻结，drain 窗口成为死窗**。协议 L147 要求的是停「新 OPEN / 新 sync round」，紧接「**现有 namespace 到 deadline 前自然收口**」；设计的全冻结使自然收口在接收侧不可能，收口被整体推迟到重连 reconcile。数据安全无虞（Yjs 幂等合并 + §16 重连纪律，设计 §6.2 亦如此论证），SA8 N2 只裁决了**入站**面（「协议未规定 draining 入站处理」），**出站冻结未获同等对账**却被表述为「停新 OPEN/round 的结构性门（CP-2 消解）」。伴随 NR-1：本地 round 机械在 drain 窗口空转（needs-resync→reconciling、reconcile timer 武装至 deadline，零 wire 效应） | 二选一并**显式落文**： 在 §6.2/§6.3 增补「自然收口在接收侧被有意替换为重连 reconcile」的取舍声明，并登记到相关决议「设计引入的新决策点」（推荐——门细化与入站冻结组合无意义且与 A2-b 变体二锚冲突）； 在 peer-connection 层做 draining 出站白名单（{SYNC_STEP2, SYNC_APPLIED, UPDATE_ACK, CLOSE_NAMESPACE}）——须同步重审 A2-b 锚与入站门。NR-1 空转面随声明登记 |
| A4 | LOW | D1 内部一致性 | §3.2 门 5 伪代码与 §3.3 叙述的**摘监听/构造顺序互相矛盾**：§3.2 为「`offMessage(); offClose();` → 检查 → `new HubConnectionImpl(...)`」，§3.3 为「构造（内挂监听）→ 构造返回后 `offMessage(); offClose()` → 构造尾重放」。两顺序在现行 Set 型多监听 transport（harness `makeEnd`、TcpTransport）下均安全（同一同步块零交错），但 SA3 的实现基准必须唯一；若未来 transport 实现为单槽替换语义，§3.3 形态会摘错监听 | 统一为 §3.2 形态（先摘早到监听 → 再构造 → 构造尾重放 earlyFrames），§3.3 叙述同步修正 |
| A5 | LOW | D3 revoke 结算语义 | §5.3 `this.cleanupTail = this.closeSessionAndReleaseInternal()` 是**单字段覆写**而非链式：`terminateUnauthorized` 与并发 `onConnectionClosed`（closeQueue 链）各自赋值，后者覆写前者，`terminationSettled()` 可能读到更晚的 tail。方向保守（等更久），revoke 仍必 resolve——无正确性风险，但「revoke resolve 即该通道资源已收口」的强度弱于 §5.3 的声称 | 改链式（`this.cleanupTail = this.cleanupTail.then(...)` 形态）或在 §5.3 注明覆写语义与保守方向 |
| A6 | LOW | §11 文件治理 | `driver.ts` 标 `[SA6 owned]`「SA3 预期零改动」，但括注又允许 SA3「按冻结契约以正式类型为准回改镜像（仅类型层）」——SA4 比对 ALLOW LIST ↔ `git diff` 时该例外无登记，会误判越权 | 把镜像修正例外登记进 §13 审计表（白名单路径 + 触发条件），或划回 SA6 执行 |

### 验证通过面（本轮攻击未击穿、留档供 SA4/SA7 复用）

- **§0.1 现状引用逐行属实**：`accept` 同步分配（hub-connection.ts:76-84）、HELLO 无认证对照（:221-234）、`revoke` 零命中（`git grep revoke src/` 确认）、GOAWAY 忽略 retryAfterMs 且 drain 句柄不跟踪（peer-connection.ts:363-395）、close 无 GOAWAY 且 close 后 accept 仍分配（:90-100/:80-82）。
- **caller 审计完备**（独立 grep 复核）：`createHubReplication` 7 处构造（driver.ts:457/614、red:71 已传；issue137-driver.ts:104、spec-b1-b2:179、sa7-issue137:687、sa7-r2-transport:223 未传——与 §13 清单逐点一致）；`.accept(` 13 处、`hub.close()` 2 处全覆盖；apps/ 无包外消费方。
- **锚定位与内容逐行核实**：G1（sa7-dynamic:186-190，L189 现 `'ready'`——改锚点唯一且必要）、G2（:217-224）、D5（sa7-issue137:517-579，**确无 draining 窗口内连接状态断言**——「零改锚」前提成立）、B1（:583-631）；红灯 #9 时间轴（t=1000/5000/7000/7500）与 harness `closePeerSide` 已关闭仍自通知的语义（harness.ts:685-692）推演自洽；「draining 进入不 teardown sender」约束与 D5 的 `pending ±1` 计面自洽（§8.1/相关决议 1c 已立 SA3 红线）。
- **§12 协议假设抽查全部命中**：messages.ts:118-126（GOAWAY 字段）、frame-io.ts:28-57（safeMessage 静态表/namespaceErrorFrame）、errors.ts:105/115（注册表冻结值）、defaults.ts:36（closeTimeoutMs=5000）、harness.ts 微任务快照、TcpTransport pendingFrames 重放（sa7-r2-transport:132-144）。
- **§3.1 竞态分析正确**：HELLO 在 dialNow 同步发出（peer-connection.ts:209-217）与 `await verifyToken` 的相对次序推演（快 verifier 落正常监听 / 慢 verifier 落缓冲）两形态均闭环；§3.3 恰一次投递不变量成立。
- **fail-closed/fail-open 边界合规**（§9 表）：`verifyToken` 缺失走构造期响亮 `TypeError`（正常路径缺陷），运行期检查仅纵深防御——**非伪降级**；验证器抛错/畸形裁决归异常路径 fail-closed，划界正确。
- **revoke 链源码属实**：`startOpen` 续体的 `isTerminal` 迟到检查（hub-namespace.ts:238-241/:254 等）、`isQuietState`/`finalize`/`closeSessionAndRelease` 引用行号全对；`cleanupTail` 字段存在（:91）；opening 态撤销走既有迟到纪律成立。
- **§7.2 GOAWAY 直发豁免正当**：`sender.sendControl` paused 态确有 controlReserveBytes 额度判据、耗尽即 CONNECTION_BACKPRESSURE（backpressure.ts:77-90）——停机帧豁免与 connectionFatal 同型；GOAWAY→close 微任务 FIFO 帧序成立。
- **A2-a/A2-b 新锚可执行**：`injectHub`/`dropNextHubToPeer`/`hubFramesAll`/`advanceMs` seam 齐备；A2-b 变体一触发链（ACK_TIMEOUT→needs-resync→maybeStartRecovery→startRound→host.send，peer-namespace.ts:666-678/:688 + round-engine.ts:82-86）源码核实成立。

## 协议假设依据审查

**合规**。§12 章节存在，9 条假设（A1–A9），每条标注依据类型（源码引用/现有测试引用/设计期推演+源码/决策依据）并给出可定位的 file:line；无「应该/通常/预计」类无据推断；A7（HELLO 早到竞态）自我识别为「中（已消解）」并升级为结构性缓冲方案而非假设不出错；A8 的「红灯零时间推进 await closePromise」以红灯文件行号+A4 锁死。依据均可被 SA4 重放（引用可定位、无需运行时贴证——本设计无 HTTP/端口/第三方库运行时假设，§12 末行明示）。R1 裁决依据（A9）正确区分了「决策来源」与「源码推断」。

## 错误处理链路审查

- **静默失败**：`accept` 永不 reject（门 4 全 catch，红灯 #5 直锚 unhandledRejection 面）；拒绝路径统一静态 close reason（不区分无效/缺失/抛错——不给探测方分类信息）；`shutdownWithGoaway` try/catch。残留静默点两处且有边界：`terminationSettled` 吞清理异常（A5 注记）与零观测面下异常不可见（切片 8 回补已登记 §8.4）——可接受。
- **状态闭环**：认证失败四形态（缺失/拒绝/抛错/文法违例）全部收敛「undefined + 零分配 + 静态关闭 + 零验证后处理」；GOAWAY 两类各有确定终态（drain 类 draining→deadline close→backoff/hint 重连；blocked 类直达）。**唯一缺口 = A1**：draining 期 1002/1008 close 的终态（blocked）在闭环外。
- **降级路径**：验证器异常→拒绝（外部认证后端真异常域）；畸形成功裁决→信任边界防御性拒绝。上游依赖不可用时 hub 不挂、不半开——fail-closed 到位。
- **虚假降级识别**：**未发现**。逐条套用判据：「verifyToken 运行期缺失」在正常流程不应出现（类型必填+构造期 TypeError 响亮），设计正确地将其归为正常路径缺陷走响亮失败优先，运行期 fail-closed 仅为纵深防御而非降级掩盖；「认证后端抛错/返回垃圾」是真实的外部输入异常域，属合法 fail-closed。§9 表的四联分类与立法边界吻合。

## 红线测试思路

- **R1（A1，主红灯——修复后转绿）**：`boot({ random: () => 0 })` → live → `injectHub({kind:'GOAWAY', reasonCode:'SERVER_RESTARTING', drainTimeoutMs: 5000})` → settle 断言 `connectionState()==='draining'` → `wire.closePeerSide(1002, 'protocol-error')` → settle → **断言 `connectionState()==='blocked'`**（现设计得 `backoff`——红灯点）；推进 fake scheduler 越过原 drain deadline + 大步 60s → 断言 `dialCount===1`（blocked 零重拨）且无 stale drain-close 副作用（wire 帧冻结）。对照变体：`closePeerSide(1008)` 同断言；反向对照：`closePeerSide(1001)` → backoff（钉死 1011/1001 路由不被修复波及）。
- **R2（A2，主红灯）**：`makeAuthHub` + 可控 deferred verifier（构造后不立即 resolve）→ `hub.accept(wire.hubEnd, {token: TEST_TOKEN})`（不 await）→ 循环灌帧：先灌 1 帧合法 HELLO，再灌 16+ 帧垃圾字节（或单帧 > maxFrameBytes 的 buffer）→ resolve verifier 为 `{ok:true, instanceId: PEER_INSTANCE}` → settle → **断言 `wire.hubSideClosed===true` 且 `hub.connections.length===0`**（超界拒绝；现设计无界——红灯点）；边界内变体：恰 1 帧 HELLO → 正常分配 + HELLO_ACK 恰 1（防双投递回归，红灯 #1 的 `acks.length===1` 已部分覆盖）。
- **R3（A4，防回归断言，可并入 R2 边界内变体）**：早到 HELLO 恰一次投递（HELLO_ACK 恰 1、无 SEQUENCE_VIOLATION）——覆盖「摘监听/构造顺序」两种实现形态下的零双投递不变量。
- **A3/A5/A6**：文本级修订，无需新红灯；A3 若走白名单路线（b），须由 SA6 同步改 A2-b 变体二锚（与冻结契约联动，另行评审）。

## 结论

设计主体坚固：D1–D5 与冻结契约/协议字面/既有锚的对账经独立逐行复核成立，R1 裁决落实完整，竞态清单覆盖面广且源码引用零虚报。**两处必修**：A1（draining 期 close-code 分类被吞——AC-5 永久失败阻断在 drain 窗口存在漏洞，协议 §15.1 L439 明文冲突）与 A2（未认证窗口无界缓冲——ADR 0010 L165 资源纪律在信任边界最外侧失守）。二者修订均局部、锚兼容（现有 10 红灯 + G1/G2/D5/B1 + A2 新锚零冲突）。修复 A1/A2 并处置 A3–A6 后即可复审放行。

---

# SA2 攻击评审报告 — R2 复审（2026-08-29 追加）

**R2 Verdict**: **reject（收窄至唯一必修 N1——一行级修复）**

- 被审对象：`wiki/raw/task_phase5-ws-auth-lifecycle_design.md`（SA1 设计档案 **R2 修订版**，修订日志 R2 行）
- 复审方式：对 R2 修订面（§3.2/§3.3/§5.3/§6.2 声明/§6.3/§8.1-8.3/§9/§10/§11/§12 A10-A11/§13 例外表/§14 回应表/附录）独立重读 + 新引用逐点源码回查；R1 已验证面不重复展开，仅复核 R2 触碰面是否破坏 R1 结论（未破坏）
- 结论先行：**A1–A6 六项全部确认已修**，且修订与协议字面、冻结锚（10 基线红灯 + G1/G2/D5/B1 + §6.5 A2-a/b）逐点兼容；但 **R2 的 A2 修复本身在 §3.2 门 3 伪代码引入一个新 MEDIUM 缺陷（N1）**——`detachEarly()` 闭包在 off 句柄赋值完成前可被调用，同步重放型 transport（TcpTransport 实存形态）上将使 `accept` 以 reject 收场，违反设计自立的 §8.2「accept 永不 reject」硬不变量，且崩溃窗口恰是 A2 要防御的信任边界场景（注册时积压超界帧）。一行级修复后放行。

## A1–A6 逐条复审（R2 落实判定）

| # | R1 要求 | R2 落实 | 判定 | 复核证据与残留 |
|---|---|---|---|---|
| A1（MEDIUM 必修） | draining 分支前置 close-code 分类：1002/1008 → clearDrainClose+enterBlocked；其余 → onGoawayClosed | §6.3 伪代码逐字落实（1002/1008 → `clearDrainClose(); enterBlocked()`；其余 → `onGoawayClosed()`）；§8.1 给 enterBlocked 加 clearDrainClose 单点（双保险）；§8.3 新竞态行；§6.5 新锚 A2-c；§12 新依据 A10；§9/§10/附录联动 | **已修 ✓** | 分类与非 draining 态先例（`peer-connection.ts:495-500`）同构 ✓；1011 → onGoawayClosed → backoff 与 §15.1 L440 一致 ✓；锚兼容复核：G1/D5/红灯 #9/A2-a/A2-b 均以 1001 关闭 → 走 onGoawayClosed 不受影响；非 draining 路径 enterBlocked 时 drainCloseHandle 恒 undefined（armDrainClose 仅存在于 draining）→ 加 clear 零行为差、B1 pending 计面无扰动 ✓。残留（LOW，N2）：§8.1 括注「含 onGoaway blocked 分支」与 §6.2 blocked 分支（teardown+setState 直达、不经 enterBlocked）表述不符——该分支运行于 ready 态、drain timer 必不存在，属「空虚真」，无行为差异，但 SA3 实现基准应择一（改路由或注明空虚真）。另注：A2-c 的「零 stale drain-close 副作用」子断言不具判别力（stale fire 因 teardown 幂等 + `transport.closed` 守卫本就零副作用），判别核心是 blocked 断言——可接受，不要求改 |
| A2（MEDIUM 必修） | 早到缓冲有界（复用 maxFrameBytes + 小常数条数界）+ 认证等待封顶二选一显式落文 | §3.2 门 3 重写：单帧 > `limits.maxFrameBytes` → 1009；条数 ≥ `MAX_EARLY_FRAMES=16`（模块常数，零新 knob）→ 1008；两者帧到达同步段即拒（摘监听 + close + `authRejected`）；认证期 timer 复用 `helloTimeoutMs`（超时 → 1008）；§3.2 政策声明（否决 transport 层方案的成文理由：DuplexTransport 契约零超时面 `types.ts:48-54`）+ 资源账（16×maxFrameBytes + helloTimeoutMs，并发 N×）；`authRejected` 迟归不复活（门 4 try/catch 两路首检）；§8.1 authHandle 行/§8.2 补/§8.3 两行/§9 新行/§6.5 新锚 A2-d/§12 A11 | **实质已修 ✓，但引入新缺陷 N1（见下）** | 独立复核：W1 是全测试套件唯一 hub 侧 pending 锚（grep 证实）——`:75-76` 为下界断言（≥1，注释明言「不锁内部清单」）、`:117-118` 为相对递减；auth timer 在 boot 的 dial→accept 微任务窗内武装并清除，早于任何断言点 → 零冲突（§3.4 声明属实）✓；A2-d 可行性：`CONTRACT_LIMITS.maxFrameBytes=8MiB` 实存（harness:127-128）✓；门 4 出口必清 timer（try/catch 两路首动作 `clearAuthTimer`）→「accept 任何出口必清」成立 ✓；门 3 拒绝后后续帧落于已摘监听/已关 transport（makeEnd close 后 send 投递至空 listener 集）→ 零累积 ✓；hub.close()/早断线与 auth 窗口竞态路径复核无泄漏 ✓。残留：**N1（MEDIUM，必修）**、N3（LOW）、N5（LOW，行号漂移） |
| A3（LOW） | 双向冻结 vs L147「自然收口」显式声明并登记决策点（推荐声明路线 (a)） | §6.2「自然收口 vs 重连 reconcile 的取舍声明」：引用 L147 全句；显式承认在途 round 完成帧（STEP2/APPLIED/UPDATE_ACK）被冻结、「自然收口在接收侧被有意替换为重连 reconcile」；三条理由（协议显式义务仅停「新」/ §12 L313+§16 修复先例 / 白名单路线跨层耦合 + 与 A2-b 变体二锚冲突）；NR-1 空转面登记；呈报总控登记 relevant_decisions（SA8 维护文档，SA1 不代笔） | **已修 ✓** | 协议 §12 L313 原文逐字核实（「正常 close不等待丢失的 UPDATE_ACK；下次连接通过 state vector修复」）✓；对白名单路线的约束转述与 R1 评审原文一致 ✓；治理正确（决策点登记走总控→SA8，非 SA1 自记）✓ |
| A4（LOW） | 摘监听/构造顺序统一为单一基准 | §3.2 门 5（detachEarly → 检查 → 构造）+ §3.3 重写为唯一基准；新增不变量 4（单槽替换型 transport 稳健性——R1「构造→摘」形态在该语义下会摘错监听，废弃）；R1 矛盾叙述删除 | **已修 ✓** | 两形态（§3.2 伪代码/§3.3 叙述）现一致 ✓；单槽稳健性论证方向正确（①在早到监听仍在册时摘除）✓。注：正是该统一结构暴露了 N1（A4 本身无误） |
| A5（LOW） | cleanupTail 改链式或注明覆写语义 | §5.3 重写：`settleClose()` 单点，`this.cleanupTail = this.cleanupTail.then(() => op, () => op)` 链式追加；finalize/terminateUnauthorized/onConnectionClosed 三发起方统一汇入；强度声明恢复且范围准确（「revoke 观察到的 tail 覆盖其之前追加的一切 op；之后追加的由各自发起方等待」） | **已修 ✓** | 链式语义复核正确：op 同步启动、链只序化观察，revoke resolve ⟺ 先序清理全 settle ✓。残留（LOW，N4）：存储的 tail 若因清理体抛错（如 `session.close()` 未内捕——现状同款暴露，非 R2 新增）而 reject，`void this.settleClose()` 会产生 floating rejected promise（红灯 #5/D5/B1 的 probe 面）。建议存储前归一化（`…then(() => undefined, () => undefined)` 后再赋值）——belt-and-braces，非阻塞 |
| A6（LOW） | driver.ts 镜像修正例外登记 §13 | §13 新增例外表（路径 + 触发条件=字段级偏差 + 允许动作=纯类型层 + 禁止动作=越出类型层即 scope-creep reject）；§11 driver.ts 条目交叉引用 | **已修 ✓** | SA4 比对依据补全 ✓ |

## R2 新增攻击点（R2 修订引入/暴露）

| # | 严重度 | 攻击面 | 具体漏洞 | 建议（可执行修订要求） |
|---|--------|--------|---------|------|
| N1 | **MEDIUM（必修）** | §3.2 门 3 早到监听——off 句柄赋值前调用 | **`detachEarly()` 闭包在 `offMessage`/`offClose` 赋值完成前被调用 → `undefined()` TypeError → accept promise reject**。时序：`offMessage = transport.onMessage((bytes) => { … authRejected = true; detachEarly(); … })`——在**同步重放型 transport**上，`onMessage` 注册即同步重放积压帧（TcpTransport 实存形态，`sa7-r2-transport.test.ts` onMessage 内 `for (const bytes of replay) listener(bytes)` 先于 return 执行）；若积压帧触发单帧界/条数界，listener 在赋值语句完成前执行 `detachEarly()` → 读到未赋值的 `offMessage` → TypeError 从 `transport.onMessage(...)` 调用点同步抛出 → async `accept` 的返回 promise **reject**。三重违反：① §8.2「accept 永不 reject」硬不变量（红灯 #5 的 probe 面）；② 设计 A3 自己引用「listener 晚于数据到达是 transport 层真实存在的形态」（§12 A3 依据）作为早到缓冲的存在理由——崩溃窗口恰在该现实场景 + 恶意超界积压帧（A2 要防的信任边界输入）叠加处；③ 异常展开使 TcpTransport 的 replay 循环中途流产（pendingFrames 已 splice），剩余积压帧丢失、transport 未按设计关闭。fake wire（Set 型、微任务投递）无同步重放 → 冻结测试套件不会触发——属「伪绿」型缺陷，仅设计层可拦 | 一行级修复（任一）：① off 句柄初始化为 no-op：`let offMessage: () => void = () => {}; let offClose: () => void = () => {};`（detachEarly 任意时刻安全，重放期内拒绝照常生效、注册完成后重赋真句柄）；② 或 listener 内只置 `authRejected` 标志 + close，摘监听统一延至注册完成后的同步段（`if (authRejected) detachEarly()`）。同步更新 §3.3 不变量 5（重放同步段内拒绝路径的句柄安全性）与 §8.2 补注 |
| N2 | LOW | §8.1 措辞 | 括注「enterBlocked（…含 …onGoaway blocked 分支…）」与 §6.2 blocked 分支（teardown+setState 直达、不经 enterBlocked）不符——该分支处于 ready 态、drainCloseHandle 必为 undefined，属空虚真、零行为差异 | §8.1 括注改为「onGoaway blocked 分支（空虚真：ready 态无 drain 句柄）」或让 §6.2 blocked 分支经 enterBlocked（须复核 B1 pending 计面——enterBlocked 额外清 reset 句柄会使 pending -2，**不可取**；故推荐前者/注明空虚真） |
| N3 | LOW | §6.5 A2-d 认证超时变体锚 | 「`advanceMs(helloTimeoutMs)`」有误：`advanceMs(run, …)` 推进的是 **peer** scheduler（driver.ts:548-549），而 auth timer 在 **hub** scheduler（`makeAuthHub` 的 `node.scheduler` / boot 的 `hubNode.scheduler`）。照写则 timer 永不 fire、锚恒红（非静默假绿，但浪费 SA6/SA3 排障周期） | 锚文本改为「推进 makeAuthHub 节点的 hub scheduler `node.scheduler.advanceBy(helloTimeoutMs)`」 |
| N4 | LOW | §5.3 settleClose 尾巴归一化 | 存储的 `cleanupTail` 若因清理体抛错（`session.close()` 现无内捕——与现状 `void closeSessionAndRelease()` 同款暴露，非 R2 新增）而 reject，`void this.settleClose()` 即 floating rejected promise（红灯 #5/D5/B1 probe 面） | 存储前归一化：`this.cleanupTail = prev.then(() => op, () => op).then(() => undefined, () => undefined);`（terminationSettled 本就吞异常，归一化零语义损失） |
| N5 | LOW | §12 A11 行号漂移 | 引 `defaults.ts:19`（maxFrameBytes）/`:33`（helloTimeoutMs），实际 `:17`/`:32`——引用可定位性无损（同一冻结块），纯漂移 | 顺手校正 |

## R2 复审增量验证（命令+结果，供 SA4/SA7 复用）

- `sed -n 60,125p …/ws-replication-sa7-dynamic.test.ts`：W1 hub pending 锚实证——`:75-76` 下界断言（注释「只做下界 + 后续相对递减断言，不锁内部清单」）、`:117-118` 相对递减；`grep -rn "scheduler.pending" test/*.ts`（排除 peerNode）：**全套件唯一 hub 侧 pending 断言**——auth timer 瞬态零冲突（§3.4 声明属实）。
- `sed -n 128,150p …/ws-replication-sa7-r2-transport.test.ts`：TcpTransport.onMessage **注册即同步重放 pendingFrames**（`for (const bytes of replay) listener(bytes)` 于 return 前）——N1 崩溃窗口的实存载体；fake `makeEnd`/`src/testing.ts`（Set 型 + queueMicrotask）无此形态 → 冻结套件伪绿。
- `grep -n "CONTRACT_LIMITS" test/harness.ts`：`:127-128` `maxFrameBytes: 8*1024*1024`——A2-d 超大帧变体可行。
- `sed -n 305,320p docs/protocols/instance-replication-v1.md`：§12 L313 原文逐字核实（A3 取舍引用属实）。
- `grep -n "maxFrameBytes\|helloTimeoutMs" src/defaults.ts`：`:17`/`:32`（N5 漂移证据）。
- R2 未触碰面抽核：D1–D5 主体、§7、caller 审计、ALLOW/DENY 与 R1 复核结论一致（R2 修订声明「不改公共契约」属实——MAX_EARLY_FRAMES 为模块常数非导出配置，运行时 caller 面与类型面零变化）。

## R2 红灯测试思路增量

- **R-N1（必修锚，防伪绿——建议并入 A2-d 或独立 IT）**：测试本地构造**同步重放型 transport**（fixture 级，非 mock 被测对象——实现 DuplexTransport 五成员，`onMessage` 注册时同步重放预置积压，同 TcpTransport 形态；预置积压含 1 帧 > `CONTRACT_LIMITS.maxFrameBytes`）→ `makeAuthHub` + 立即 resolve 的 verifier → `const p = hub.accept(t, {token: TEST_TOKEN})` → `await expect(p).resolves.toBeUndefined()`（现 R2 伪代码 reject——红灯点）+ `collectUnhandledRejections()` 空 + transport 已关闭（1009）+ `hub.connections.length===0`。变体：预置 17 帧正常尺寸积压 → 条数界同断言。
- R1 节 R1/R2/R3 红灯思路已被 §6.5 A2-c/A2-d 采纳（A2-d 并入 R3 防回归变体）——SA6 落地时注意 N3 的 scheduler 修正。

## R2 结论

R2 对 A1–A6 的落实**精确、完整、锚兼容**（六项逐一确认，含我方建议的最小改动形态：A1 分类前置、A2 零新 knob 有界化 + 显式政策、A3 声明路线 + 治理正确、A4 单一基准 + 单槽稳健性补强、A5 链式、A6 白名单表）。**唯一阻断项 N1**：A2 修复的伪代码自身在同步重放型 transport 上破坏「accept 永不 reject」硬不变量——冻结测试套件测不到（伪绿），只能由设计层拦截，修复一行级（no-op 初始化或延后摘除）。N2–N5 为 LOW 随手处置。**N1 修复（+N2–N5 处置或声明）后，R3 复审即可放行。**

---

# SA2 攻击评审报告 — R3 复审（2026-08-29 追加）

**R3 Verdict**: **pass**

- 被审对象：`wiki/raw/task_phase5-ws-auth-lifecycle_design.md`（SA1 设计档案 **R3 修订版**，修订日志 R3 行，91365 字节）
- 复审范围：R3 修订面（§3.2 门 3 N1 修复/§3.3 不变量 6/§5.3 N4/§6.5 A2-d 修正 + A2-e 新锚/§8.1 N2/§8.2-8.3 措辞联动/§12 A11 校正 + A12 新行/§14 N1-N5 回应行/附录 R3 复扫）+ 四项指定验证点独立推演；R1/R2 已验证面不重复展开（R3 未触碰 D1–D5 主体/§7/caller 审计/ALLOW-DENY——抽样核对无漂移）

## 四项指定验证点（独立推演结论）

### 1. 同步重放形态下 accept 恒不 reject（N1 修复健全性）——**确认成立**

R3 三组件：① off 句柄 no-op 初始化（`let offMessage/offClose: () => void = () => {}`）；② listener 幂等早退（`if (authRejected) return`）+ 拒绝只置标志 + close（**listener 内零 detachEarly、零句柄引用**）；③ 注册完成后同步收口段（`if (authRejected || earlyClosed) { detachEarly(); return undefined; }`，置于 auth timer 武装**之前**）。全场景推演：

| 场景 | 推演 | 结果 |
|---|---|---|
| S1 注册期积压含超界帧（TcpTransport 型） | listener 在 `onMessage(...)` 赋值完成前被同步调用 → 置标志 + close(1009)，不触任何句柄 → 重放后续帧被幂等早退吸收 → 注册返回真句柄 → 收口段以**真句柄** detachEarly → return undefined | 零同步抛出；accept resolve undefined；重放循环零流产；1009 保留 ✓ |
| S2 注册期 17 帧积压（条数界） | 帧 1-16 入缓冲、第 17 帧 → 标志 + close(1008)、余帧早退 → 同 S1 | 同上，1008 ✓ |
| S3 await 期帧到达拒绝（fake wire 微任务） | listener 置标志 + close → 后续投递早退（不 push——缓冲冻结 ≤16）→ 验证器归 → 门 4 首动作 clearAuthTimer → `authRejected` → undefined | accept resolve undefined；timer 必清 ✓ |
| S4 全合法积压/正常流 | 收口段零开销通过 → timer 武装 → 门 4 → 门 5 detachEarly → 构造尾重放（§3.3 不变量 1-5 原样） | 与 R2 已验证行为一致 ✓ |
| S5 验证器永不 settle + 注册期已拒 | 收口段**立即** return undefined（timer 未武装零清理面）——比 R2 更优（R2 需等 verifier） | 无悬挂 await ✓ |
| S6 listener 零抛出核验 | listener 体 = byteLength 比较 + 数组 push + transport.close（makeEnd `if (self.closed) return` / TcpTransport `if (this.closedFlag) return` 前置守卫）——两类在册 transport 均无同步抛出路径 | §8.2「拒绝路径零抛出」声明成立 ✓ |

auth timer 出口穷举：门 0/1/2（武装前）、收口段（武装前）、门 4 两路（首动作清）、门 5（门 4 已清）、timer 自 fire——**无任何出口遗留武装 timer**，§8.1「任何出口必清」不变量成立。

### 2. 早到缓冲资源语义保持健全——**确认**

三界原样：单帧 `limits.maxFrameBytes`→1009、条数 `MAX_EARLY_FRAMES=16`→1008（模块常数零新 knob）、auth 等待 `helloTimeoutMs`→1008；资源账（16×maxFrameBytes + helloTimeoutMs + 并发 N×）原样；幂等早退保证拒后缓冲冻结（后续帧不 push）——**界不被 R3 修订削弱**；「迟归不复活」语义（门 4 首检 `authRejected`）在 try/catch 两路保留。R3 仅重排拒绝的时序（效果即时、摘除延后），未触碰任何界。

### 3. 回归锚充分性（A2-e）——**确认具判别力**

- **主用例**：本地同步重放 fixture（DuplexTransport 五成员、注册即同步重放预置积压、重放先于 return——TcpTransport 形态 `sa7-r2-transport.test.ts:132-144`）+ 预置超界帧 → `await expect(p).resolves.toBeUndefined()`（R2 伪代码下 p reject → 红）+ `collectUnhandledRejections()` 空 + 关闭码 1009 + 零分配 + **重放帧数计数断言（= 预置数——判别异常流产重放循环的 R2 副作用）**。双判别面（reject 面 + 流产面）均钉死。
- **变体**：17 帧正常尺寸 → 条数界（1008 + resolves）；治理放行（§11 红灯契约条目明示「A2-e 的同步重放 fixture 属 seam 层新增，允许」）——SA6/SA3 的 fixture 新增不与「SA3 不得改动断言」冲突，漏洞闭合。
- **总账**：红灯契约 15 IT（10 基线 + a/b/c/d/e）在 §6.5/§10/§11/附录四处一致；fixture 定位（seam 层、非 mock 被测对象）与文件头红线纪律相容。
- 一个小注（SA6 落地细节，非缺陷）：fixture 需自带 close 记录面以断言关闭码 1009/1008——锚文本「transport 已关闭（1009）」已隐含此要求。

### 4. B1 路由语义零扰动（N2）——**确认**

§8.1 现显式声明：onGoaway blocked 分支（SHUTTING_DOWN/REAUTH → teardown+setState 直达）**不经 enterBlocked、亦无 clearDrainClose 调用**——该分支处于 ready 态、drainCloseHandle 必为 undefined（armDrainClose 仅存在于 drain 类路径），空虚真安全；**路由冻结**并附禁止理由（强改经 enterBlocked 其额外 clearReset 使 B1 pending 计面 -2）。与 §6.2 blocked 分支伪代码（R3 未触碰）及附录自检（「enterBlocked 不被引入该分支」）三处一致。B1 锚（`sa7-issue137-dynamic:583-631`：blocked 直达 + pending 恰 -1）推演零扰动：该分支不新增任何 timer clear/武装，poll 计面独占 -1 ✓。enterBlocked 新增 clearDrainClose（R2 A1）对非 draining 入口为 undefined 守卫 no-op（同 `:622-627` clear 模式）→ D5/G2 同样零扰动 ✓。

## N2–N5 处置逐项判定

| # | R2 要求 | R3 落实 | 判定 |
|---|---|---|---|
| N2 | §8.1 注明空虚真 + 路由冻结（勿改路由——会破 B1） | §8.1 drainCloseHandle 行改注明 + 路由冻结 + B1 -2 禁止理由（与我方 R2 推演一致） | **✓**（见上第 4 点） |
| N3 | A2-d 超时变体改推进 hub scheduler | 锚文本改「`node.scheduler.advanceBy(helloTimeoutMs)`」+ 误用成因注记（advanceMs 绑 peerNode，driver.ts:548-549——引用核实） | **✓** |
| N4 | settleClose 存储前归一化 | `…then(() => op, () => op).then(() => undefined, () => undefined)` + 理由注记；terminationSettled 语义零损（本就吞异常） | **✓** |
| N5 | §12 A11 行号校正 | `defaults.ts:17/:32`（独立 grep 复核：maxFrameBytes=:17、helloTimeoutMs=:32）+ 漂移注记 | **✓** |

## R3 新增面扫描——未发现新缺陷

- listener 幂等早退置于 byteLength 检查之前：拒后超大帧不再二次 close（transport 已关）——语义正确。
- 收口段 `earlyClosed` 分支在在册 transport 上不可达（onClose 无同步重放形态）——防御性检查，行为无害（transport 已由对端关闭，零 close 副作用语义一致）。
- auth timer 回调内 `detachEarly()` 的「句柄必为真值」注释准确（timer 武装于收口段之后）。
- §12 A12 新依据行引用准确（TcpTransport:132-144 已于 R2 复核实证）。
- R3 未触碰 D1–D5 主体、§7、caller 审计、ALLOW/DENY、G1/G2/D5/B1 对账（抽样核对与 R1/R2 结论一致）。

## 放行备忘（sub-LOW，不构成修订义务，SA3/SA4/SA7 参考即可）

1. **await 期帧拒绝路径的监听滞留**（S3）：门 4 `authRejected` 分支返回时早到监听未摘除（挂在已关 transport 上直至 GC）。行为已吸收（幂等早退 + 已关 transport 双重防线，§8.3 行有载），零观测面、零累积——纯卫生学残留，SA3 若顺手在该分支补 `detachEarly()` 更佳（幂等、零风险），不强制。
2. **§8.1 authHandle 行清除点枚举措辞**：「早到预算拒绝路径（detachEarly 同步段）」作为清除点表述偏松（该路径的实际清除经由「timer 武装晚于收口段」+ 门 4 首动作）；「accept 任何出口必清」不变量本身成立（出口穷举见上）——措辞层面，无行为含义。

## R3 结论

**pass。** N1 修复采纳建议①（no-op 初始化）并叠加两道结构加固（listener 幂等早退 + 注册后同步收口段），经六场景推演与 timer 出口穷举确认「accept 恒 resolve」在一切 transport 实现形态下成立；早到缓冲三界原样、语义无削弱；A2-e 回归锚双判别面（reject + 重放流产）+ 治理放行完整；B1/G2/D5 路由与计面零扰动；N2–N5 逐项落实且引用核实。R1（A1–A6）+ R2（N1–N5）全部发现闭环，无新增缺陷。设计放行进入 SA3 实现——SA4/SA7 以本报告 R1「验证通过面」、R2「增量验证」与本节四项验证点为比对锚。
