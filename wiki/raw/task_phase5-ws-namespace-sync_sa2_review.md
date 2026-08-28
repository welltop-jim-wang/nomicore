# SA2 攻击评审报告 — `@nomicore/ws-replication` namespace 同步状态机（issue #136 切片 6）

**Date**: 2026-08-30（R1）/ 2026-08-30（R2 重审，见文末「SA2 R2 重审节」）
**Verdict**: **reject**（R1：3 CRITICAL + 4 MAJOR 设计漏洞需 SA1 修订设计后重审；修订面集中且互不纠缠，一轮可收口）
**R2 重审最终 Verdict**: reject（窄幅）——R1 #1–#13 全部收口核验通过；R3 新增面发现 1 条 MAJOR 阻塞项（N-1）+ 1 条 MINOR 伴随修订（N-2）。
**R3 重审（最终）Verdict**: **pass**——R4 按 R2 放行条件逐点收口 N-1（四点增补）/N-2（三处更正）/nano-notes ×3，零新漏洞引入。详见文末「SA2 R3 重审节」。
**被审对象**: `wiki/raw/task_phase5-ws-namespace-sync_design.md`（R1 审 R2.1 版 814 行；R2 重审 R3 版 890 行；R3 窄幅核对 R4 版 915 行）
**审查视角**: 全新开局，刻意不以 R1/R2 妥协为前提；ADR 字面（relevant_decisions 摘录）为约束基准。
**源码核实基线**: 所有攻击点均以 worktree 实际源码/测试核实（证据命令见文末「验证证据」节），非纸面推断。

---

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议修订 |
|---|--------|--------|---------|---------|
| 1 | **CRITICAL** | §11.3 入站 UPDATE 状态门 | **「非 live → `NAMESPACE_STATE_VIOLATION`」的 blanket 拒绝击穿设计自身的两条恢复路径**。触发序列 A（ACK-timeout，§10.4）：peer ack 计时 fire → needs-resync → 同连接发 Step1(r+1)；**该路径在 Step1 到达前对 hub 零 wire 通知**——hub 通道仍是 live，hub 本地写经单 observer fan-out 持续向 peer 发新 UPDATE（窗口 = Step1 单向传播延迟，真实网络为一个 RTT 的全部 hub 流量）。触发序列 B（溢出，§10.5）：peer 置 needs-resync → RESYNC_REQUIRED 在途，hub 尚未处理，且 hub 已发出的 in-flight UPDATE 仍在到达。两种序列下 peer 处于 needs-resync / 恢复 reconciling（均非 live）却**结构性必然**收到 hub UPDATE → 按 §11.3 字面发 `NAMESPACE_STATE_VIOLATION` → ns failed → hub 亦 failed。§11.3 括注「结构性：hub 仅 live 期 fan-out」的前提在上述窗口为假——这是把「对端尚未得知恢复意图」的时序窗口误判为协议违例。协议 §10.1「普通 UPDATE 只允许在 live 状态发送」是**发送方**约束；§9.4「发出后不再发送新 UPDATE；**已接纳 update 正常 apply/ACK**」给出的是兼容读法。 | §11.3 状态门收窄为「无生命周期 / OPEN_OK 前 / bootstrapping」三类；peer 在 needs-resync 与恢复期 reconciling 收到 hub UPDATE → 照常 `applyRemoteUpdate` + UPDATE_ACK（Yjs 幂等，收敛由 round 保证）。冻结测试不受影响（AC7 锚仅钉 OPEN_OK 前场景）。 |
| 2 | **CRITICAL** | §11.1 拒绝码映射 × §12 fence 检测 | **epoch bump 与 peer 流量竞态使终态非确定且违反协议 §11**。源码事实（replication-session.ts:450-453 A1 与 :568-580 R2）：session 被 E5.5′ fence 或被动 fence 后，`applyRemoteUpdate()` 即时结算 `REPLICATION_EPOCH_CONFLICTED`。设计 §11.1 将该码映射 `INTERNAL_ERROR`（failed，「通道已终局，收口优先」）。竞态：busy 通道上 hub bump → 在途 peer UPDATE 到达 → apply 拒绝 `REPLICATION_EPOCH_CONFLICTED` → wire `INTERNAL_ERROR` → peer **failed**；而 §12 watchdog 探测命中 → IDENTITY_CHANGED → peer **conflicted**。两条路径在微任务序上赛跑（frame handler 在 `await applyRemoteUpdate()` 让步点上与 watchdog 探测 continuation 交错），同一物理事件（bump）非确定地产出 failed/conflicted 二态。violates 协议 §11「Hub发送 IDENTITY_CHANGED并关闭该 namespace session，Peer进入 conflicted」（效果义务）与 §13.2（epoch 域 → conflicted）；§12 自述「不能等下一笔 peer UPDATE 才被动发现」却未规定被动发现**先**到时的行为。 | §11.1 映射表对 `REPLICATION_EPOCH_CONFLICTED`（及 fenced 判定）增加围栏判别：拒绝时读 `session.getStatus()`（`state==='conflicted'` 或 `currentEpoch !== replicationEpoch`，或对照自有 lease `runtime.replication`）→ 命中即走 §12.2 路径（恰一帧 IDENTITY_CHANGED + 双侧 conflicted）；未命中（真正的内部异常）才落 `INTERNAL_ERROR`。附带收益：该判别即 fence 的**确定性**事件驱动检测钩子，watchdog 退化为纯空闲兜底。 |
| 3 | **CRITICAL** | session 层 fanout 溢出信号未被消费 | **`FANOUT_CHANNEL_QUEUE_CAPACITY=16` 溢出静默丢增量且无恢复触发（replication-session.ts:147/258-261）**。owned update 到达 ws 层 listener 前先经 session fanout 有界队列（每投递让步 20 微任务，replication-session.ts:222）；队列满 → **弃新项 + 置 session `status.needsResync`（sticky）**，被丢项永不进入 ws 层 update-channel——§10.2 判据不触发、无 RESYNC、无新 round、无 ACK timeout（无 in-flight）→ **健康连接上 hub→peer（多 peer fan-out）或 peer 上行（本地连写突发）单向静默发散，无界持续**。可达性：窗口/队列容量失衡是结构性的——`maxInFlightUpdates` 默认 32 > 16；当 ≥17 次提交落在单个 20 让步窗口内（内存持久化/连续 sequencer 槽间无 macrotask 边界）即溢出。CONTEXT.md《ReplicationSession》词条明文冻结义务：「fanout 投递有界队列溢出将 session 标记 needs-resync（sticky）——**transport 须 reset/bootstrap**」——本设计全文（§10/§12 watchdog 谓词仅 `state!=='open' ∨ currentEpoch≠epoch`）未消费该信号，属义务遗漏而非裁量。冻结测试写突发 ≤3 笔故不暴露（SA7 动态验证也不会暴露——需专门构造）。 | watchdog 双节奏探测谓词扩编：`state!=='open' ∨ currentEpoch!==replicationEpoch ∨ status.needsResync`，**边沿触发**（false→true 跃迁才动作；sticky 标志永不清除，电平触发会死循环）；命中 → 按 §10.2 同构处置（丢弃本端未发送队列、置 needs-resync、peer 端发 RESYNC_REQUIRED 并在窗口收口后开新 round；hub 端按 §10.6 等待 peer round）。§12 标题与预算论证同步扩为「fence + session 溢出」检测。 |
| 4 | MAJOR | §14.1 幂等行 × §4.3 blocked 重建 | 内部矛盾：§14.1「addTarget 幂等——活跃/opening 中重复 add → 合流、零新 OPEN」 vs §4.3「blocked ──config-change（addTarget 触发的重建）──▶ disconnected」。§18.11 #4 修订后的冻结用例在 ns 处于活跃态（disconnected）+ 连接 blocked 时 `addTarget(run.target)` 并期待重建→live——即 blocked 连接上**对既有 target 的重复 add 也必须触发重建**，与 §14.1 幂等行按字面互斥。SA3 按哪条读都会挂另一条（读 §14.1 则冻结用例 #4 红；读 §4.3 则幂等锚被破坏）。 | 显式 reconcile：连接处于 `blocked` 时，任何 `addTarget`（含对既有活跃 target 的重复 add）一律视为 config-change → 整连接重建；§14.1 幂等合流行限定于非 blocked 连接。补一句重建扰动界限（blocked 下重复 add 的重建风暴由 Host 配置纪律约束，v1 接受）。 |
| 5 | MAJOR | §13.1 removeTarget/CLOSE 状态矩阵不完备 | 四个不可达 wire 的状态未定义 removeTarget 行为：(a) `targeted`（hub 无通道——若照发 CLOSE，hub 按 §6 无通道规则回 `NAMESPACE_STATE_VIOLATION`，且若 OPEN 将被拒则必发生）；(b) `disconnected`（transport 已关，CLOSE 无处可发）；(c) 终态 `conflicted`/`failed`（§13.1 只写了 closed 的复用，conflicted/failed 的 cleanup 已结算，行为未写）；(d) `closing` 期间到达 terminal namespace ERROR（终态不降级原则应收敛为 closed 而非 failed，未写）。SA3 自行补齐易产生多余 wire 帧或卡 `closing`。 | 补全 removeTarget × ns 状态矩阵：targeted/disconnected/终态一律本地收口（置 closed/intent=removed、零 wire 帧、复用/结算 cleanup Promise）；closing 中收到 terminal ERROR → 维持 closing 语义收敛 closed（§13.4 迟到纪律扩至「迟到 ERROR」）。 |
| 6 | MAJOR | §7 authorize() 异常路径缺失 | `NamespaceAuthorizer` 是 Host 注入的 async Adapter；设计只规定 `{ok:false}` 分支，未规定 **reject/throw**（Adapter 故障：后端不可达、bug）时的行为。未规定 → SA3 若不 catch：OPEN 处理 Promise 链断裂 → unhandled rejection + hub 通道滞留 opening（peer 侧靠 openTimeout 收口，hub 侧通道泄漏至连接关闭）。同类 seam 中 `dial()` throw 已被 §4.3 显式处理（→backoff），authorize 是同构缺口。 | §7.1 增补：authorize rejection → 捕获 → `INTERNAL_ERROR` namespace ERROR（failed，不泄露存在性——与 Registry open 失败同款处理）；帧处理入口统一「一切 async seam 异常 → error-mapping 单点」契约，测试注入 rejecting authorize 验证。 |
| 7 | MAJOR | §4.1 × §4.4 序列号消费点 vs 控制帧优先 | §4.4 控制帧「恒先、无上限保留额度」+ data per-namespace round-robin：若序列号在**入队时**分配（encode 时传 `EncodeOptions.sequence`），控制帧插队会造成实际到达序与序列序错乱 → 接收端按 §4.1 判 `SEQUENCE_VIOLATION` fatal——**实现自伤**（CLOSE/RESYNC/IDENTITY_CHANGED 插队即断连）。设计未钉序列号消费时点。 | frame-io 契约明文：序列号只在**实际出队发送时**分配（dequeue 点单点分配），入队不占序；并把「同一连接同一方向按实际交付序严格 +1」写为 SA4/SA7 静态/动态检查项。 |
| 8 | MINOR | §8 快照帧身份来源（O-1 附带） | BOOTSTRAP_SNAPSHOT 携带的 hubIdentity 取自 §7 step 3 读值还是发送时重读未钉死：bump 插入两读之间时，旧值 + 新 doc 编码 → importReplica 身份不匹配 → BOOTSTRAP_FAILED（安全失败但多余）；发送时重读则一致通过。 | 钉死为「与 encodeDiff 同步段后重读 lease status」，消除窗口（两种读法都安全，仅为减少虚假失败）。 |
| 9 | MINOR | §18.1 submit 门语义缺口登记不完整（O-4） | UPDATE-only 门使 submit:false 的重连同 peer 可经 reconcile Step2 diff 向 hub 传播**离线写**——设计 §18.1 只论证了「为何不拦 Step2」（AC1 锚），未在 §23 风险表面登记该数据面后果（目前只在 relevant_decisions #5）。 | §23 增行显式登记（离线写经 Step2 上行的授权语义缺口 → Jim/切片 10 裁决候选）；不要求本切片改行为（冻结测试锚死）。 |
| 10 | MINOR | §12 预算锚定测试常量 | watchdog 4096 让步预算的量纲论证直接依赖 harness 常量（settle=300 / settleUntil=3000，harness.ts:198/207）——SA6 未来上调 settle 预算会**静默**破坏 fence 检测（用例超时）。 | 设计/测试双向钉一条不变量注释（「watchdog 预算须 > harness settle 预算之和」），或在 harness 常量旁登记耦合；#2 修好后 watchdog 仅剩空闲兜底，敏感度下降。 |
| 11 | MINOR | §4.1 出站 uint32 耗尽 | 每方向 2^32 帧后行为未定义（ADR「不回绕」只禁回绕）。 | 定义响亮收口：接近/达到上限 → connection ERROR + close（不回绕、不静默错序）。 |
| 12 | MINOR | §4.3 `drainTimeoutMs` 措辞 | GOAWAY 的 drainTimeoutMs 是**帧字段**（payloads.ts:225；协议 §6.3「接收时开始计算本地 elapsed deadline」），§4.3 行文易被读成本地配置项——冻结 `ReplicationTimeouts` 只有 6 字段，SA3 若自造配置字段即违约。 | 措辞改为「按 GOAWAY 帧 drainTimeoutMs 字段计算的本地 deadline」。 |
| 13 | MINOR | hub 侧 reconcile/bootstrap 期排队未成文 | §5.3（reconcile 期有界队列 + pendingResync 链）只写 peer 侧；hub 通道在 B 端 bootstrap/RESYNC 等待期同样会收到单 observer fan-out 交付，镜像语义（入队/丢弃/pendingResync → 新 round 由 peer 发起）结构上必要但未落字。 | §10 增一句 hub 通道对称条款（复用同一 update-channel 结构与 §10.6 等待语义）。 |

---

## 协议假设依据审查

**结论：通过（章节存在、依据可验证、无「应该/预计」类空泛推断）。**

- §19 章节存在，P-1..P-13 逐条给出依据类型与可定位引用。本轮独立抽查核验（命令见文末）：P-2（driver.ts:475-478 唯一 advanceBy、仅 peer scheduler）✓；P-3（replication-session.ts R5/R6 + `await notifyDirty()` 后 resolve）✓；P-4（replication-write.ts:416-423 E5.5′ fenceStale 同步段 + session.ts:380-386 finalize 清队）✓；P-5（payloads.ts UPDATE/BOOTSTRAP 双侧限检抛 `ProtocolError`）✓；P-7（registry.ts owner 先核对、零存在性泄露）✓；P-8（importReplica registry.ts:1919）✓；P-9（fanout 泉 20 让步、每投递 slice、applyOrigin 回声抑制、null-origin 恒投）✓；P-12（vitest.config.ts include `packages/*/test/**`）✓。
- P-13（R2 新增）引用 ADR 0010 L147 原文与 RFC 6455，与 SA8 CP-1 裁决基准一致，无实测冒充。
- P-10 采 SA6 已实测记录并显式「不锁字节」，传递干净。
- 依据均可被 SA4 复跑（行号引用已逐一命中）。**注意**：P-2/P-4 等锚定的行号属实现细节，SA4 静态门禁时应按符号而非行号复核——非缺陷，仅提示。

## 错误处理链路审查

- **静默失败**：发现 1 处 CRITICAL（#3：session 层溢出丢项无任何 wire/投影/恢复信号——典型静默失败）；1 处 MAJOR（#6：authorize rejection 未定义→潜在 unhandled rejection）。
- **状态闭环**：#5 的 removeTarget 状态矩阵缺口（targeted/disconnected/终态/closing 中 ERROR）会导致 `closing` 悬挂或多余帧；其余终态路径（ERROR→§11.2 映射、timeout→本地收口）闭环完整。
- **降级路径**：§11.1/§11.3 degraded 判别表（RUNTIME_WRITE_DISABLED + lease status 旁证，不解析 message 文本）设计正确且旁证字段（lifecycle/fatal）经 types.ts:169-178 核实存在；peer 侧 hub-to-peer degraded bypass 由 session 层承载、本包零分支，边界清晰。
- **虚假降级识别**：未发现「把正常路径前提缺失伪装成降级」——§5.2 disabled 副本本地响亮 failed（拒绝静默降级为 bootstrap）是正确方向的 loud assert。但发现**镜像病症**：#1 是「把正常的时序窗口误判为协议违例」（假违例），§11.3 的结构性理由为假前提，同样是前提校验缺失类缺陷，按同等严重度处置。

## O-1..O-7 深审结论（总控移交项）

| # | 观察项 | SA2 裁定 |
|---|---|---|
| O-1 | bootstrap 编码不入 sequencer（encodeDiff 同步直读，源码核实 replication-session.ts:413-417 属实） | **采等价性解释，通过**。竞态穷举：bump 插入「§7 step3 身份读」与「§8 编码」之间 → 快照 META epoch 与广告不一致 → importReplica 严格拒绝（#133 R2 双源不一致是有意拒绝条件）→ BOOTSTRAP_FAILED 安全失败；编码后安装前的内容竞态由强制 round 1 修复（ADR 0010 L67 既有机制）。附 MINOR #8（钉死发送时重读，消除多余虚假失败）。切片 10 措辞澄清建议维持。 |
| O-2 | fence-watchdog 双节奏轮询 | **机制可用，但需两处加固**：(a) 探测谓词缺 `status.needsResync`（CRITICAL #3）；(b) 预算锚定 harness 常量（MINOR #10）。#2 修复后 apply-refusal 判别成为确定性检测钩子，watchdog 退化为空闲兜底（空闲检测延迟 = ackTimeoutMs，协议未设上界，可接受）。有界性论证（4096 让步预算 vs 无界链饿死 macrotask）成立。 |
| O-3 | HELLO nonce 非密码学随机 | **通过**。协议 §6.1 仅要求「随机生成」；nonce 仅握手活性绑定，认证属切片 7 bearer。零修订。 |
| O-4 | submit 门不覆盖 SYNC_STEP2 | **解释可接受，登记不完整**（MINOR #9）：UPDATE-only 是冻结 AC1 锚（submit:false 须先 live）的唯一可行读法；但离线写经 Step2 上行的数据面后果应在设计 §23 显式登记交 Jim/切片 10，而非只留在 SA8 摘录里。 |
| O-5 | 溢出判据含 in-flight | **通过**。保守早触发 + 冻结测试算术（AC6 cap=1 第二笔即溢出）联立唯一解；未发送队列自身永不超上限，符合协议 §17 字面。 |
| O-6 | 冻结断言算术冲突 | **已收口**。§18.11 #1 + SA6 R2 修订（peerFramesAll 基面）已落地，经任务简报 R2 表与测试文件核对一致。 |
| O-7 | §6 方向纪律措辞 | **R2.1 已澄清，通过**。现文 OPEN_NAMESPACE=peer→hub、hub 收到即 §7 正常路径；错向 = hub 收 hub→peer 专用帧（HELLO_ACK/OPEN_OK/BOOTSTRAP_SNAPSHOT/IDENTITY_CHANGED）→ `CONNECTION_POLICY_VIOLATION` 1008；peer 侧 OPEN_NAMESPACE 错向例外与冻结 AC2 用例（injectHub OPEN → TARGET_NOT_REQUESTED）逐字对齐。 |

## 红线测试思路（每漏洞对应的红灯 IT 编写方向）

1. **#1（恢复窗口 UPDATE 容忍）**：live 后以 saveGate 悬挂 hub 第一笔 apply 使 UPDATE_ACK 迟到 → `advanceMs(ackTimeoutMs)` 使 peer 进 needs-resync 并发出 Step1(r+1)；**在 Step1 仍在途时** hub 侧写一笔（fan-out → UPDATE 到 peer）→ 断言 peer 对该 UPDATE 照常 apply+ACK、ns 最终回 live 且 `getNamespaceState() !== 'failed'`、wire 上零 `NAMESPACE_STATE_VIOLATION`。现设计下该用例红（ns failed）。
2. **#2（bump×流量竞态终态确定）**：live 通道；`bumpHubEpoch()` 后立即注入一笔 peer UPDATE（严格 nextSeq）→ 断言 peer 终态恰为 `conflicted`、`hubFrames('IDENTITY_CHANGED')` 恰 1、errorCodes 不含 `INTERNAL_ERROR`。现设计下红（INTERNAL_ERROR → failed）。
3. **#3（session fanout 溢出消费）**：peer live；不 settle 连发 20 笔本地写（`for(...){ void run.writePeer({n:i}) }`，超过冻结容量 16）→ settleUntil 断言 hub 最终收敛 `rootValue('hub','n')===19`（即溢出触发了 RESYNC/新 round）。现设计下红（静默丢项、无任何恢复触发、永不收敛）。同类 hub 侧用 bootFanout 对 B 端连发 20 笔 A 写。
4. **#4（blocked 重建）**：冻结 §18.11 #4 已覆盖（blocked + `addTarget` 既有活跃 target → 重建 → live）；本条要求设计矩阵与该用例不再互斥（测试侧无新增，设计侧修订）。
5. **#5（removeTarget 不可达路径）**：三用例—— 未 start 时 add→remove → 断言 closed、零帧； closePeerSide(1006) 后 removeTarget → 断言 resolve、投影 closed、无 CLOSE_NAMESPACE 帧； 活跃态 removeTarget 后注入 terminal ERROR → 断言终态 closed（非 failed）。
6. **#6（authorize 异常）**：authorize = `async () => { throw new Error('authz down') }` → 注入 OPEN → 断言 hub 回 `INTERNAL_ERROR` namespace ERROR、peer failed、进程零 unhandled rejection（vitest `onUnhandledRejection`/process 监听断言）。
7. **#7（序列分配点）**：saveGate 悬挂使 UPDATE 积压 ≥2 → removeTarget（CLOSE 控制帧插队）→ 断言接收端按**实际到达序**每方向 sequence 严格 +1（解码序即序列序）；现设计若入队分配序则红（SEQUENCE_VIOLATION 自伤）。
8. **#8–#13**：#8 双读窗口用「bump 与 OPEN_OK(mode0) 竞态注入」断言不产生 BOOTSTRAP_FAILED 假失败（或显式接受安全失败并注释）；#10 在 harness settle 常量旁加耦合注释断言（文档性）；其余为设计文本修订，无独立红灯。

## 裁决理由与放行条件

R2.1 的两大回退（CP-1 序列纪律、CP-2 溢出同连接恢复）本身执行干净、无残留（SA8 R2 复审 clear 经本轮独立复核属实）；但 **CP-2 把恢复搬回同一连接后，§11.3 的接收端状态门没有同步收窄**——恢复拓扑与接收门互斥，形成 #1；#2/#3 则是 hub 状态面（fence 映射）与 session 层冻结信号（sticky needsResync）的消费遗漏。三条 CRITICAL 均为设计文本级修订（映射表、状态门、watchdog 谓词），不动公共契约面、不动冻结测试断言、不触碰 ADR 字面。

**Reject；SA1 按本清单修订设计（至少 #1–#7）后提交 R3 重审。**

---

## 验证证据（命令 + 结果摘要）

- `grep -n "applyRemoteUpdate\|REPLICATION_EPOCH_CONFLICTED..." packages/namespace-runtime/src/replication-session.ts` → A1 接纳层 ：450-453 返回 `REPLICATION_EPOCH_CONFLICTED`（conflicted session）；槽 R2 :568-580 被动 fence 同码（#2 依据）。
- `sed -n '216,293p' packages/namespace-runtime/src/replication-session.ts` → fanout 泵每项 20 让步、队列容量检查 :258、溢出弃新置 sticky `needsResync`、`doc.on('update')` 单 observer、applyOrigin 回声抑制、null-origin 恒投（#3/F-2/F-3/F-9 依据）。
- `grep -n "FANOUT_CHANNEL_QUEUE_CAPACITY\|FANOUT_DELIVERY_DEFERRAL_MICROTASKS" ...` → `= 16`（:147）/`= 20`（:153）。
- `grep -n "E5.5\|fenceStale" packages/namespace-runtime/src/replication-write.ts` → :416-423 bump 槽 E5.5′ 同步 fenceStale（P-4 ✓）。
- `grep -n "SEQUENCE_VIOLATION\|CONNECTION_POLICY_VIOLATION\|TARGET_NOT_REQUESTED\|ACK_TIMEOUT..." packages/replication-protocol/src/errors.ts` → 设计引用的全部 wire 码存在且 fatal/closeCode/terminalState 元数据齐备（:100-130）。
- `grep -n "direction" packages/replication-protocol/src/messages.ts` → 注册表含 direction 域，codec 不强制、供状态机消费（O-7 ✓）。
- `sed -n '605,625p;468,486p' packages/replication-protocol/src/payloads.ts` → BOOTSTRAP/UPDATE 双侧字段超限抛 `ProtocolError('..._TOO_LARGE')`（P-5 ✓）；`:225` GOAWAY 携带 drainTimeoutMs 帧字段（#12 依据）。
- `sed -n '470,482p' packages/ws-replication/test/driver.ts` → 唯一 advanceBy 仅推进 `run.peerNode.scheduler`（P-2 ✓）。
- `grep -n "budget\|300\|3000" packages/ws-replication/test/harness.ts` → settle=300（:198）、settleUntil 预算 3000（:207）（#10 依据）。
- `sed -n '36,119p;120,176p' packages/ws-replication/test/ws-replication-ac6-resync-close.test.ts` → SA6 R2 对齐修订（#3 同连接两帧 STEP1/#4 跨连接收敛/#5 无丢帧 close）与设计 §18.11 期望形态逐条一致；`grep TARGET_NOT_REQUESTED ws-replication-ac1-ac2-open.test.ts` → :252-264 错向 OPEN 注入锚（O-7 ✓）。
- `grep -n "lifecycle\|fatal" packages/namespace-registry/src/types.ts` → `NamespaceRuntimeStatusProjection` 含 lifecycle/fatal（:169-178，§11.1 旁证可行）；`registry.ts:1919 importReplica`（P-8 ✓）；`vitest.config.ts:5-11` include 通配（P-12 ✓）。
- `grep -n "fanout 投递\|transport 须" CONTEXT.md` → :126 ReplicationSession 词条冻结「transport 须 reset/bootstrap」义务（#3 依据）。
- 协议基准：`docs/protocols/instance-replication-v1.md` §9.4 L248（已接纳 update 正常 apply/ACK）、§10.1 L261（UPDATE live 限制为发送方约束）、§11 L293（IDENTITY_CHANGED 义务）、§17 L488、§18 L520、§6.3 L139-147。

（本报告为 SA2 唯一产出文件；未修改任何生产代码、测试代码或 SA1 设计文档。）

---

# SA2 R2 重审节（同会话第二轮；被审对象 = 设计 R3 版，890 行）

**Date**: 2026-08-30
**最终 Verdict**: **reject（窄幅）**——R1 全部 13 条收口核验通过；R3 新增内容发现 **1 条 MAJOR 阻塞项（N-1）+ 1 条 MINOR 伴随修订（N-2）**。两者合计约一条设计增补的体量；SA1 完成 N-1（含 N-2 一句话）修订后即可放行，无需再全量重审（下轮仅核对该增补条款）。

## 一、R1 #1–#13 逐条复核（全部 ✅ 收口）

| R1# | 严重度 | R3 收口形态（设计条款） | SA2 复核结论 |
|---|---|---|---|
| 1 | CRITICAL | §11.1 第 1 步/§11.3 双侧重写为四分类：无生命周期/opening/bootstrapping/**首轮 reconciling（本连接未达 live）**→ 违例；**needs-resync/恢复期 reconciling（到达过 live）/live → 照常 apply+ACK**；closing/终态 → 静默忽略 | ✅ **收口且优于建议**。「到达过 live」按连接作用域判定正确（新连接重置——首轮 reconcile 期间对端结构性不可能合法发 UPDATE，判违例成立；恢复期按 §9.4 镜像接纳）；hub 侧 §11.1 与 peer 侧 §11.3 镜像一致；submit/size 门次序保留；AC7「OPEN_OK 前」冻结锚属违例类不受影响（AC5 live 重复 UPDATE、AC4/AC6 各态逐一比对无冲突）。 |
| 2 | CRITICAL | §11.1 映射块前置围栏判别（`state==='conflicted' ∨ currentEpoch!==replicationEpoch`，P-14）→ §12.2 **one-shot 终结器**（记忆化，恰一帧 IDENTITY_CHANGED + 双侧 conflicted）；帧处理钩子与 watchdog 探测合流同一终结器 | ✅ **收口**。非确定性消除：apply 拒绝码是同步事实，钩子在任何 await 让步点前即成立；两检测面共享记忆化终结器，谁先到都产出同一终态（协议 §11 效果义务达成）。`REPLICATION_SESSION_CLOSED`（显式 close、epoch 未动）不命中围栏 → 仍落 INTERNAL_ERROR，分类正确。peer 侧防御性对称保留（结构性不可达）无害。**残余缺口见 N-1（同一竞态家族的姊妹面）**。 |
| 3 | CRITICAL | §12 扩为「fence + session 溢出」双问题三层检测：watchdog 谓词扩 `∨ status.needsResync`、**边沿触发**（每通道 lastPredicateValue，sticky 永不清除故禁电平触发）、命中分派（fence → §12.2；needsResync 边沿 → §10.2 同构 + §10.5/§10.6 恢复）；§10.2 增第三溢出信号面指针；§16 timer 行更名 | ✅ **收口**。CONTEXT「transport 须 reset/bootstrap」义务落地为「连接内 reset = 新 round；bootstrap 留给重连」——与 CP-2 同连接拓扑自洽。边沿触发硬约束正确；溢出结构性伴随 ≥16 项待投递（listener 交付即通道事件 → 触发探测突发），静默期由 timer 节奏兜底，检测面完备。**作用域缺口见 N-2**。 |
| 4 | MAJOR | §14.1 新增 blocked 行：blocked 下**任何 addTarget（含重复 add 既有 target）= config-change → 整连接重建**；幂等合流行限定「连接非 blocked 时」 | ✅ 收口。两规则不再互斥；§18.11 #4 冻结用例（blocked + 重复 add → 重建 → live）与 §14.1 幂等锚（AC1，ready 连接）各自成立；扰动界限（Host 配置纪律）已注。 |
| 5 | MAJOR | §13.1 重写为七行全矩阵（targeted/disconnected → 本地收口零 wire 帧，点名禁发多余 CLOSE；conflicted/failed → resolve + 投影迁 closed、事实保内部；closing 中 terminal ERROR → 维持 closing 收敛 closed） | ✅ 收口。四个缺口全补；「conflicted/failed → 投影 closed」与 §14.1 re-add（closed 行 → 重建）一致；§13.4 迟到纪律扩至「迟到 ERROR/IDENTITY_CHANGED」自洽（closing 期 IDENTITY_CHANGED 只推进收口——与 §11.1「closing → 静默忽略」不冲突：前者是收口方向裁决，后者是 UPDATE 数据帧处理）。 |
| 6 | MAJOR | §7 第 1 步增 rejection 分支（→ INTERNAL_ERROR、不泄露存在性）+ 通用契约「一切 async seam（authorize/dial/registry.open/importReplica/openReplicationSession/applyRemoteUpdate）异常一律 error-mapping 单点收编，零 unhandled rejection」 | ✅ 收口（原则正确）。**但 seam 清单漏同步 throw 面 → N-1**。 |
| 7 | MAJOR | §4.1 钉死序列号只在 dequeue 实际发送时单点分配；「实际交付序严格 +1」列 SA4/SA7 检查项 | ✅ 收口。 |
| 8 | MINOR | §8 第 3 步钉死身份发送时重读（encodeDiff 同步段后） | ✅ 收口（nano-note 见下：bump 落在 encode 与重读之间仍会安全失败 BOOTSTRAP_FAILED——#133 R2 严格口径，无害，措辞「保证一致通过安装」略过强）。 |
| 9 | MINOR | §23 R-9 显式登记 submit 门 UPDATE-only 的离线写传播缺口（Jim/切片 10 裁决候选） | ✅ 收口。 |
| 10 | MINOR | §12 不变量「4096 > 3300」双向登记 + §23 R-10 | ✅ 收口。 |
| 11 | MINOR | §4.1 出站 uint32 耗尽 → CONNECTION_POLICY_VIOLATION + close 1008（响亮、不回绕） | ✅ 收口（nano-note 见下：1008/blocked 不自愈，retryable 1011 + 重连可自愈——因计数器按连接重置；现选择保守可接受，实践不可达）。 |
| 12 | MINOR | §4.3 GOAWAY 行改为「按帧字段 drainTimeoutMs 计算的本地 deadline」，明示非配置项 | ✅ 收口。 |
| 13 | MINOR | §10.1 增 hub 侧对称条款（同一 UpdateChannelState / pendingResync / 新 round 恒 peer 发起 / 终局忽略） | ✅ 收口。 |

R3 约束遵守声明经核对属实：§2 契约面零触碰、§4.1/§10.5 ADR 字面定案零改动、既有冻结断言零影响（新测试候选独立列于 §18.11 R3 追加节，与本人 R1 红灯思路一致）。

## 二、R3 新增内容扫描 —— 新发现

### N-1（MAJOR，本轮唯一阻塞项）：encode* 同步 throw 面未被围栏判别与 seam 契约覆盖

- **源码事实**：session 的 `encodeStateVector()`/`encodeDiff()` 在**任何终态**（closed **或** conflicted）**同步 throw `ReplicationSessionClosedError`**（replication-session.ts:410/:414；类导出于 namespace-runtime/src/errors.ts:208，registry types.ts:526 文档化该 throw 契约）。
- **触发条件**（全部生产可达，且均发生在 watchdog 探测之前——帧处理同步段先于任何让步，探测每 8 让步一次无法抢占）：
  1. **fence × 恢复 round**：hub bump（E5.5′ 同步 fence hub 通道 session）→ 在检测到达前，peer 的 `SYNC_STEP1(r+1)` 到达 → §9.1.2 hub 「发自己的 Step1(r, hub sv)」调 `session.encodeStateVector()` → 同步 throw；
  2. **fence × Step2 编码**：hub 收 Step1 后调 `session.encodeDiff(对端 sv)`（§9.1.3）同类 throw；
  3. **fence × bootstrap 快照**：OPEN(mode0) 处理中 bump 插入 → §8.1 `session.encodeDiff(空 sv)` throw；
  4. **close 竞态**：§13.2 对端 CLOSE 触发 `session.close()` 后，已在途的 round 步骤编码同类 throw。
- **影响**：R3 #2 的围栏判别只挂在「apply **拒绝码**结算」上（ok:false 结果），throw 面完全不覆盖；§7 通用契约的 seam 枚举（authorize/dial/registry.open/importReplica/openReplicationSession/applyRemoteUpdate）也不含 encode* 两同步面。未规定的后果二选一，都不可接受：throw 穿透帧分发 → 微任务上下文 uncaught exception（进程级风险，违反 R3 自己立的「零 unhandled rejection」目标）；或被泛化 catch 误映射 → ns failed 而非 conflicted + 零 IDENTITY_CHANGED——与 R1 #2 同一竞态家族（bump × 流量 → 协议 §11 效果义务违反）在姊妹路径上复发。peer reconcile timeout 兜底只能产出 failed，不能修复终态类别。
- **修订要求**（一条增补）：§7 seam 契约清单补入 `session.encodeStateVector()/encodeDiff()`（标注为**同步 throw 面**：`ReplicationSessionClosedError`）；§11.1 围栏判别适用域从「apply 拒绝码」扩为「**一切 session 能力调用异常/拒绝结算**」——捕获该 throw 后同款判别：`state==='conflicted'`（∨ currentEpoch≠epoch）→ §12.2 one-shot 终结器（IDENTITY_CHANGED + conflicted）；`state==='closed'` → 按 §13.4 迟到纪律/cleanup 收口（INTERNAL_ERROR 域）。§9.1.2/§9.1.3/§8.1 三处编码调用显式注明「经 error-mapping 单点」。顺带补一小句：closing/终态通道收到 SYNC* 帧的处置（建议静默忽略，与 §11.1 第四类对齐——§9.2 违例矩阵无 closing/终态行，现状未规定）。
- **红灯测试构想**：live 通道触发本地溢出进入恢复 round；在 peer Step1(r2) 在途时 `bumpHubEpoch()` → 断言 hub 不崩溃（零 uncaught）、peer 终态恰 `conflicted`、`hubFrames('IDENTITY_CHANGED')` 恰 1、errorCodes 不含 INTERNAL_ERROR。变体：OPEN(mode0) 处理与 bump 竞态 → 断言 conflicted（而非 BOOTSTRAP_FAILED 卡死/崩溃）。

### N-2（MINOR，N-1 的伴随修订）：watchdog/溢出检测机制作用域写死「hub 侧」，与命中分派的 peer 分支自相矛盾

- §12 标题、机制第 1 条（「hub 通道持 watchdog」）、§16 timer 行（侧=hub）均写 hub；但 §12「命中分派」含 peer 分支（「peer 端发 RESYNC_REQUIRED…」），且 §12 问题二的可达性论证与 §18.11 R3 追加 ③（20 笔连发 = **peer 本地写**突发）都以 peer 侧为暴露面。peer 侧 session fanout 溢出只有轮询 `status.needsResync` 一条发现路径——若 SA3 按「hub 侧」字面实现，peer 本地连写溢出将无检测面，R1 #3 在 peer 侧复发、红灯 ③ 必红。
- **修订要求**（一句话）：§12 机制/§16 timer 行显式声明 watchdog（至少 needsResync 边沿判据）**peer 通道对称持有**（fence 两判据在 peer 结构性不命中，仅溢出边沿生效）；fence-watchdog.ts 职责注释同步。

### Nano-notes（不阻塞，随下轮修订顺手收口或登记即可）

1. §8 第 3 步「重读保证帧身份与快照内容一致通过安装」措辞过强：bump 落在「encodeDiff 之后、重读之前」时身份(N+1)≠内容(N) → importReplica 严格拒绝 → 多余 BOOTSTRAP_FAILED（安全失败，#133 R2 有意口径）。建议措辞降为「最小化不一致窗口；残余窗口安全失败」。
2. §4.1 uint32 耗尽采 close 1008 → peer blocked（需 Host 干预）；因序列计数器按连接重置，retryable 分类（如 1011 → backoff 重连自愈）成本更低。现保守选择可接受（实践不可达），登记即可。
3. §18.11「R3 追加」节首句「SA2 R3 攻击评审」应为「SA2 R1 攻击评审」（导致设计 R3 的评审轮次笔误，纯文档性）。

## 三、协议假设依据审查（R3 增量）

P-14 新增（session status 作围栏/溢出判别面）**核实通过**：state/currentEpoch/needsResync 字段冻结形状、A1(:450-453)/R2 被动 fence(:568-580) 同码产出、容量 16 溢出置 sticky（:258-261）、CONTEXT 义务原文——与本人 R1 独立核实结果一致。P-1–P-13 无变动。依据可验证性维持 R1 通过结论。

## 四、错误处理链路审查（R3 增量）

- 静默失败：R1 #3 已收口；**N-2 若不修，peer 侧溢出将退化为新的静默失败面**（这正是 N-2 列为伴随必改而非纯措辞的原因）。
- 状态闭环：R1 #5 已收口（七行矩阵 + closing 迟到 ERROR）；N-1 的 closing/终态 SYNC* 帧处置是最后一块未规定拼图。
- 降级/虚假降级：四分类状态门修复了 R1「假违例」病症；无新增虚假降级。
- unhandled rejection：R3 立了正确原则但枚举漏同步 throw 面（N-1）——原则对、清单缺。

## 五、最终裁决

**Verdict: reject（窄幅）**。R1 三条 CRITICAL、四条 MAJOR 的收口质量全部核验通过（四分类状态门、one-shot 终结器合流、边沿触发扩谓词三处机制均与源码事实精确对齐，且未触碰契约面/ADR 字面/冻结断言）；阻塞项仅 **N-1**（+N-2 一句话伴随修订）——它是 R1 #2/#6 已确立原则在姊妹代码路径上的完备性缺口，修订体量约一个设计小节。SA1 完成 N-1/N-2 增补后提交 R4，SA2 下轮**仅核对该增补条款**即可放行（无需全量重审）；nano-notes 三条随附收口与否不影响裁决。

## 六、R2 重审验证证据（增量）

- `grep -n "ReplicationSessionClosedError" packages/namespace-runtime/src/replication-session.ts` → :45 import、**:410/:414 `encodeStateVector`/`encodeDiff` 终态同步 throw**；`errors.ts:208` 类导出；`namespace-registry/src/types.ts:526` 该 throw 契约文档化（N-1 依据，且类可被 ws 包按类型捕获）。
- `grep -n "encodeStateVector\|encodeDiff" wiki/raw/task_phase5-ws-namespace-sync_design.md` → 仅 2 处（§9 RoundState 注释/§8 快照），**零 throw/异常/收编字样**——R3 全文未覆盖该面（N-1 成立的直接文本证据）；§7 seam 枚举（设计 :309-315）不含 encode*。
- R3 收口条款定位：§11.1 四分类（:474-510）/§11.3 镜像（:529-535）/§12 三层检测+one-shot（:544-562）/§14.1 blocked 行（:615）/§13.1 七行矩阵（:570-582）/§7 rejection（:307-315）/§4.1 消费点+uint32（:200-201）/§8 重读（:345）/§10.2 第三信号面（:439）/§10.1 hub 对称（:430）/§23 R-9/R-10（:840-841）/P-14（:758）。
- watchdog「hub 侧」字面 vs peer 分支矛盾（N-2）：设计 §12 标题/机制第 1 条（:550-553）/§16 timer 行（:669）vs 命中分派 peer 分支（:556）与 §18.11 R3 追加 ③（:737）。

（R2 重审同为本文件原地追加；R1 全文保留于上。仍未修改任何生产代码、测试代码或 SA1 设计文档。）

---

# SA2 R3 重审节（同会话第三轮，窄幅核对；被审对象 = 设计 R4 版，915 行）

**Date**: 2026-08-30
**最终 Verdict**: **pass**——按 R2 放行条件逐点核对，N-1（四点增补）、N-2（三处更正）、nano-notes ×3 全部收口且无新漏洞引入。SA1 设计（R4 版）通过 SA2 破壁评审，同意放行进入 SA3 实现。

## 一、N-1 核对（MAJOR 阻塞项 → ✅ 四点增补全部到位）

| 放行条件（R2 节 N-1 修订要求） | R4 落实位置与内容 | SA2 核对结论 |
|---|---|---|
| ① seam 清单补入 encode* 两同步 throw 面 | §7 第 1 步（:311-318）：async seam 五项之外新增「**同步 throw 面**：`encodeStateVector()`/`encodeDiff()` 在终态 session（closed **或** conflicted）同步 throw `ReplicationSessionClosedError`」——源码锚（replication-session.ts:410/:414 + registry types.ts:526 契约文档）与 SA2 R2 独立核实一致；三处编码调用点强制 try/catch 交 error-mapping 单点、禁止穿透帧分发同步段 | ✅ |
| ② 围栏判别扩适用域 | §11.1 判别块（:506-518）：适用域 =「**一切 session 能力调用的异常/拒绝结算（不限于 apply）**」，显式枚举 (a) apply ok:false + (b) encode* 同步 throw（三处调用点、帧处理同步段内捕获）；命中 fence → §12.2 one-shot（IDENTITY_CHANGED + 双侧 conflicted）；**`state==='closed'`（未命中围栏）→ §13.4 迟到纪律收口 + INTERNAL_ERROR 域本地终局（零 wire 假码）**——closed 分支是 R2 要求之外的正确补全（区分 fence 与 close 竞态两域） | ✅ 优于要求 |
| ③ 三处编码调用点逐一注明 | §8.1 快照（:348「编码异常面」）、§9.1.2 hub Step1 sv（:388，标注「fence × 恢复 round 在途 Step1 的**核心竞态路径**，N-1 红灯场景」）、§9.1.3 Step2 diff（:389）——另 §9.1.1 peer Step1（:387）也补注（超出承诺的三处，peer 侧实际路径为 closed → §13.4 收口，与 §11.3 防御性条款一致） | ✅ 覆盖面 ≥ 要求 |
| ④ §9.2 矩阵补 closing/终态 SYNC* 处置 | §9.2 首行（:400）：closing/终态通道收 SYNC*（Step1/Step2/Applied/RESYNC）→ **静默忽略**（cleanup 优先、零写入零回发零违例码、§13.4 迟到纪律、「违例矩阵只适用于活跃态通道」）；RESYNC 行尾注交叉引用（:405） | ✅ 与 §11.1 第四类对齐自洽 |

确定性论证同步扩面（§11.1 附注 :525）：「apply 拒绝码与 encode\* throw 都是**同步事实**，在任何 await 让步点之前即成立——watchdog 探测每 8 让步一次无法抢占」，四类竞态（fence × 恢复 round Step1/Step2 编码、fence × bootstrap 快照、close × 在途 round）统一收编——与 SA2 R2 的时序分析逐字吻合。N-1 红灯候选 ⑧（含 OPEN(mode0) × bump 变体）已入 §18.11 移交清单（:750）。

## 二、N-2 核对（MINOR 伴随 → ✅ 三处更正全部到位）

- §12 标题（:557「**双侧通道**」）+ 机制第 1 条（:566）：「**每条 ns 通道（hub 与 peer 对称）各持一个 watchdog 实例**（同一 fence-watchdog.ts）」；显式注记「peer 通道 fence 两判据结构性不命中（peer Runtime 永不 bump，ADR 0010 hub-only 管理权），**peer 侧仅 `needsResync` 边沿生效**（peer 本地连写突发的唯一发现路径——若按 hub 侧字面实现则 R1 #3 在 peer 侧复发）」——与 R2 判定的复发条件逐字对应；机制第 2 条 timer 节奏同步双侧（:567）。
- §16 timer 行（:682）：「hub + peer（双侧对称；peer 仅 needsResync 边沿生效——fence 判据结构性不命中）」，hub/peer 判据差异分列。
- §3 模块注释（:170）：fence-watchdog.ts「每通道 epoch-fence/session-溢出 watchdog（双节奏，双侧对称——peer 仅 needsResync 边沿）」。

红灯 ③ 的 peer 侧前提（R2 节判定「必红」条件）就此解除。

## 三、nano-notes ×3 收口确认

1. §8 身份读取点措辞（:350）：校准为「重读**最小化**不一致窗口…**残余窗口安全失败**：bump 落在 encodeDiff 之后、重读之前 → importReplica 按 #133 R2 严格双源不一致拒绝 → BOOTSTRAP_FAILED（有意的安全口径，**非缺陷**）」——过强措辞已撤，残余窗口定性正确。✅
2. §4.1 uint32 耗尽选择注记（:201）：保守选择理由（永久性配置级信号更贴近「计数器不可信」事实）+ 备选形态（1011/backoff 自愈，因计数器按连接重置）登记供切片 10 复议——行为定义未改。✅
3. §18.11 轮次笔误（:750）：更正为「SA2 R1 攻击评审」+ 笔误说明。✅

## 四、R4 增量零副作用核查（窄幅扫描改动面）

- **改动面收敛**：890→915（+25 行）全部落在声明位置（§7/§8/§9.1/§9.2/§11.1/§12/§16/§18.11/§3/§4.1 注记）；§2 契约面、§4.1/§10.5 ADR 字面定案、既有冻结断言零触碰（§4.1 仅追加文字注记，uint32 行为定义未变）。✅
- **新条款自洽性**：§9.2 表头「一律 SYNC_STATE_VIOLATION」与首行「静默忽略」的表面张力由首行自带限定（「非违例——违例矩阵只适用于活跃态通道」）消解，自洽；§12.0 钩子描述仍写「任何 applyRemoteUpdate() 拒绝结算」未并列 encode* throw——权威块 §11.1 适用域已扩 (a)+(b) 且 §12.0 整体引用「§11.1 的围栏判别」，属措辞级引用滞后、无行为歧义（SA3 以 §11.1 为准即可），**登记为 SA3 实现注记，不构成阻塞**。
- **peer 侧对称性**：§9.1.1 peer Step1 编码 throw 处置经 §11.1 判别——peer 会话 fence 结构性不命中，实际路径 state==='closed' → §13.4 收口；与 §11.3「防御性对称保留：命中即按 conflicted 终局收口」语义一致，无 wire 帧越权（peer 不发 IDENTITY_CHANGED）。✅

## 五、最终裁决

**Verdict: pass。**

三轮累计：R1（3 CRITICAL + 4 MAJOR + 6 MINOR）→ R3 全收口；R2（N-1 MAJOR + N-2 MINOR）→ R4 全收口。设计对全部 21 个攻击点（R1 13 + R2 2 + nano 3×2 轮）形成闭环，关键机制（四分类状态门、one-shot 终结器、三层检测面 + 边沿触发、encode* 同步 throw 收编、双侧 watchdog、七行 removeTarget 矩阵、blocked 重建裁决、序列分配点）均与依赖包源码事实（replication-session.ts / replication-write.ts / errors.ts / registry types）精确对齐，且全程零触碰冻结契约面、ADR 字面定案与冻结测试断言。

**SA3 实现注记（非阻塞，随任务移交）**：① §12.0 与 §11.1 的围栏判别描述以 §11.1 权威块为准（适用域含 encode* throw）；② watchdog `lastPredicateValue` 初始化为 `false`（勿以首次探测读值作基线，否则预存溢出漏检）；③ N-1/N-2 红灯候选 ⑧ 与 ③ 已在 §18.11 移交清单，建议 SA6 优先落实。

**验证证据（R3 轮增量）**：`grep -n "R4\|N-1\|N-2\|ReplicationSessionClosedError" design.md`（定位全部修订点）；`sed -n '299-328p'`（§7 seam 扩全）、`sed -n '495-534p'`（§11.1 围栏判别扩域 (a)/(b)+closed 分支）、`sed -n '385-408p'`（§9.1 四处编码异常面 + §9.2 首行）、`sed -n '557-586p'`（§12 双侧对称 + peer 边沿限定）、`:170`（§3 注释）、`:201`（uint32 注记）、`:350`（§8 措辞校准）、`:682`（§16 timer 行）、`:750`（§18.11 笔误更正 + 红灯 ⑧）、`:905-915`（R4 回应表 5 条）、`wc -l` = 915。源码锚复用 R2 轮核实（replication-session.ts:410/:414、errors.ts:208、types.ts:526）。

（R3 重审同为本文件原地追加；R1/R2 全文保留于上。仍未修改任何生产代码、测试代码或 SA1 设计文档。SA2 评审链闭合：reject → reject（窄幅）→ **pass**。）
