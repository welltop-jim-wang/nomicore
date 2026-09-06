# SA1 设计独立攻击复核（attack review）— Issue #238 分段观测与 sent/applied/acked 关联

## 任务标识

- 复核对象：`wiki/raw/task_238_design_2026-09-06.md`（MABF round 1 design，自评 Verdict: approve）
- 任务：Issue #238 — BUG investigation: Hub→Peer UPDATE apply 延迟呈阶梯累积，最高 11 秒（OPEN）
- Worktree：`/home/wangjian/nomicore-fix-issue-238`（branch `mabf/issue-238`，HEAD `9e3f0bf` 实读；工作树 = SA5/SA6 产物 + wiki，未提交未推送）
- 复核人：独立攻击复核 SA（design-review 阶段；与 SA1/SA5/SA6/SA8 无身份重叠）
- 输入（全部实读）：
  - 被审设计 `task_238_design_2026-09-06.md` 全文（339 行）
  - SA5 `task_238_sa5_bug-analysis_2026-09-06.md`、SA6 `task_238_red_contract_validation_2026-09-06.md`
  - 两份 SA8 门禁报告：`task_238_conflict_report.md`（前置冲突门禁，clear）+ `task_238_design_conflict_recheck_2026-09-06.md`（设计后置复核，clear）+ `task_238_relevant_decisions.md`
  - Owner 评论 `IC_kwDOT8JVvs8AAAABS2CyWg`（本轮 gh 实读复读：仍为唯一评论、updatedAt=null 无编辑——结论边界原文逐字在案）
  - HEAD `9e3f0bf` 源码：namespace-runtime（sequencer/replication-session/runtime/internal/index）、namespace-registry（registry/types/lease/testing）、ws-replication（types/peer-namespace/hub-namespace/update-channel/liveness/defaults/observer）、persistence（lifecycle）、`docs/protocols/instance-replication-v1.md` §3/§10.2/§23、`packages/clock/src/system.ts`

## 复核方法（攻击性，不采信自评）

1. **锚点全量重验**：设计的全部 file:line 规范性锚点逐一对照 HEAD 实读（§三表）。
2. **门禁独立重推导**：G1–G4 不采信设计 §13 与 SA8 复核结论，从代码 + ADR/protocol 原文独立重推导（§攻击线 A5）。
3. **可执行证据独立复跑**：基线 repro 单测、全包套件、typecheck 相关面（§二）。
4. **Owner 评论 gh 复读**：确认无新增评论、原文与设计 R1–R5 映射逐字核对。
5. **过度声明猎杀**：全文档搜索任何把复现当作生产 11 秒阶段证明的断言（§攻击线 A2）。

## 一、独立复跑证据（本 worktree，2026-09-06T~18:0xZ）

| 命令 | 结果 |
|---|---|
| `pnpm exec vitest run packages/ws-replication/test/ws-replication-issue238-repro.test.ts --reporter=verbose` | **1 passed (1)，测试主体 34 ms，Type Errors no errors**（exit 0）——Owner 基线锚真实在场且绿 |
| `pnpm exec vitest run packages/ws-replication/test --reporter=dot` | **49 files / 348 tests passed，Type Errors no errors**（exit 0，14.4 s）——与 SA5 §10.1 / SA6 §3.5 登记值一致，零回归 |
| `gh issue view 238 --json comments` | 1 条评论（welltop-jim-wang，created 2026-09-06T13:39:25Z，updatedAt=null）——无新增；结论边界原文在案 |

## 二、攻击线与结果（每线给出攻击目标 → 独立证据 → 裁决）

### A1 攻击「基线保留」：新观测是否实际上动了 Owner 锚？

- 攻击：寻找设计任何条款使 `ws-replication-issue238-repro.test.ts` 或 driver `hubClock/peerClock` seam 语义漂移。
- 证据：repro 测试在场（untracked），断言面实读核对——`[5000,4000,3000,2000,1000]` 逐位（:147）、5×apply/5×ACK 计数、`wires===1`、`namespace-error===0`、`connection-state-changed===0`（SA6 强化项 :156/:160）、ns `live`、saveGate 单门闩；driver diff 实读——`hubClock/peerClock` 为加性可选、缺省不注入（dormant）。设计 §9 对两文件分别标「零改动」与「加性可选透传、缺省 dormant、基线行为不变」，§11.1 明示字节不动。新契约全部在新文件 `ws-replication-issue238-segmented-observation.test.ts`。
- **裁决：攻击失败。R1 满足**（且基线经本复核独立复跑为绿）。

### A2 攻击「过度声明」：是否存在复现 → 生产根因的越界断言？

- 攻击：全链文档（设计 + SA5 + SA6）搜索把复现当生产 11 秒阶段证明的表述；检查跨侧减法是否被表述为精确值。
- 证据：设计 §1 R2、§8.1（「复现中的慢 dirty 是 saveGate 测试替身……不作为生产缺陷证据」）、§8.2 决策树以「分段字段上线后首窗口数据」为判据、§5.3（跨侧减法「只可作 triage 近似」）与 §14.4（「任何文档/结论不得把 ack − apply 跨侧差表述为精确段值」）构成一致防线；SA5 §7.4/§11 与 SA6 §5 表格明示「生产 11 秒阶段证明 ✗（明示不承诺）」；Owner 评论结论边界原文与设计 R2 逐字对应（gh 复读确认）。
- **裁决：攻击失败。R2 满足**——边界声明完整且可执行（决策树 + 排除矩阵是「未证明」的建设性形态）。

### A3 攻击「四段判别力」：分段字段是否真覆盖 Owner 四段词汇？守恒式是否成立？

- 攻击 1：字段与 Owner 词汇的映射是否有缺口或偷换。
- 证据：Owner 词汇 = event-loop stall / sequencer queue wait / protected check+live apply / dirty notification。设计四字段 `queueWaitMs/protectedCheckMs/liveApplyMs/dirtyNotifyMs`（§4.1）+ event-loop 探针（§6）+ 槽级记账（§7）；「protected check+live apply」= 两字段之和的口径兼容在 §4.1 显式声明，与 SA5 §5 的 checkAndApply（R1–R5）分解兼容（其段 = 本设计 protectedCheck+liveApply 之和）。R1–R3 并入 protectedCheckMs 的裁决有依据（O(1) 同步投影读，实测锚：replication-session.ts R1 fatal/R2 identity/R3 writable 全为同步读）。
- 攻击 2：捕获锚点是否与真实槽结构逐位对齐（错位 = 段语义伪）。
- 证据（HEAD 实读）：admission = `host.sequencer.enqueue(...)` 前（replication-session.ts:488，设计称 :487 邻域）；slotStart = thunk 入口（:558 `runSessionApplySlot`）；applyStart 窗口 = R4 `protectedContentEvaluated`（:620）之后、R5 `Y.applyUpdate`（:640）之前；dirtyStart = R5.5 标记后、R6 `await notifyDirty()`（:665）前；dirtyDone = R6 resolve 后、R7 `return { ok: true }`（:678）前。全部为可插纯同步读的位置，零新增 await。**锚点逐位成立**。
- 攻击 3：守恒恒等式（§4.3）数学是否成立。
- 独立重推导：`sum = dirtyDone − admission`；`applyLatencyMs = t1 − t0`，t0 在 `session.applyRemoteUpdate` 调用前（peer-namespace.ts:1043 实读，含注释「§5.7：在调用 applyRemoteUpdate 前采样，完整覆盖同步接纳与 sequencer 排队」）、t1 在 `await pending` 结算续体。admission ≥ t0（同同步段）且 t1 ≥ dirtyDone（结算后续体）⟹ `sum ≤ applyLatencyMs` 恒成立；手动时钟域中同步段与微任务跳均不推进时钟 ⟹ 逐笔相等——与 SA5 §5 实测表（sum === applyLatencyMs 逐笔 ✓）一致。生产域残差 = t0→admission 同步段 + R7→续体微任务跳，ε=50 ms 断言合理。**恒等式成立且测试可执行**。
- 攻击 4：event-loop 探针是否为真判别面而非安慰剂。
- 证据：liveness.ts 头注（L5-6）确认「仅当 transport 提供 ping/onPong 才武装，缺面 dormant」先例在案；defaults.ts:41 `pingIntervalMs: 30_000` 确认；probe 不新增常驻 timer。§6 明示 delayMs 为停停下界信号、判别需多窗口对比——诚实边界。SA5 §11.2 确认 fake duplex 结构性排除 stall，故测试形态为「注入已知漂移的正向控制」是唯一可行形态（设计 §6 已如此规定）。
- **裁决：攻击失败。R3 满足**（四段均可判别、H1/H4 判别语义互斥可分、守恒式可断言）。

### A4 攻击「关联可靠性」：sequence 三事件面是否真在场、合并帧是否破坏关联？

- 证据（HEAD 实读）：protocol §3（L56-58）envelope「sequence | uint32，正常 frame 从 `1` 严格递增」+ §10.2 UPDATE_ACK「ackedSequence | varUint | UPDATE sequence」在案；发送侧 `host.sendData` 返回 seq（peer-namespace sendUpdateFrame :978 邻域，事件在 `seq>0 && observerOn` 才发射 ⟹ `sequence` 字段「恒在场」成立）；接收侧 `onHubUpdate(message.sequence)`（:536）/ hub `onUpdate(message.sequence)`（:579）已传入 apply 管线（applyRemoteUpdate 第二参）；ACK 侧 `onUpdateAck(message.ackedSequence)` → `channel.onAck` → `onUpdateAcked(info)`（update-channel.ts :44-46/:137-142，info 现形 `{bytes, latencyMs?}`——加性 `sequence` 属内部接口扩展）；channel `inFlight` Map 以 seq 为键（:66）。合并帧：takeItems/mergeItems 贪心合并（`Y.mergeUpdates`）实读确认——设计 §5.1「关联粒度 = wire 帧」的结构性事实成立且已文档化；SA5 §6 实证按时间/字节猜关联在合并下失效、sequence 逐位配对成功。零新增 wire 字段（G3）。
- **裁决：攻击失败。R4 满足**——帧级关联在设计明示的粒度上可靠；业务写级关联被显式划为不做（触 G3/非目标，§14.3）。

### A5 攻击四门（独立重推导，不采信设计 §13 / SA8 复核自评）

- **G1 槽序**：sequencer.ts 实读——`enqueue<T>(run)` 单参、链形 `settled = this.tail.then(run, run)` + `this.tail = settled.then(noop, noop)`（:38-42）；设计加性 `label?` 参 + 私有深度 + 槽样本缓冲不改链形；四戳零 await；样本 flush 在槽释放续体、sink 槽外调用、sink throw 自捕获。slotStart/admission 戳为纯读。index.ts 不导出 WriteSequencer（「模块零导出」:19-20 实读）⟹ label 参不进公共面。**未触发**。
- **G2 受保护判据**：`protectedContentEvaluated`（scratch clone 内容投影相等判据）零改动，仅计时；H3 修复支路显式走「先评审 + ADR-0010 修订节 + 行为等价测试」（§8.2），与 ADR-0010 #134 O-12「不得在未评审情况下预写」一致。**未触发**。
- **G3 wire**：全部变更 local（事件字段、结果联合可选字段、内部记账）；`sequence` 是把已在域的值放进事件对象；wire 字节全等断言入契约（§11.2-6）。**未触发**。
- **G4 冻结注册表**：逐面实读核验——`session.getStatus()`（O-11）零触碰；Runtime `getStatus()` replication 两态域零触碰；refusal 闭集（replication-session ok:false 分支）逐字节不动；lease `parseOpenSessionOptions` own 键集恰 `{localRole, remoteInstanceId}`、长度≠2 即拒（lease.ts:107-130 实读）——设计对 lease.ts 零改动、观测参数走 registry 构造 options，刻意避开该冻结面；runtime 公共面实数 12 键（owner/namespaceId/readData/getSchema/getMetadata/getActiveSchema/getStatus/mutateData/replaceSchema/enableReplication/bumpReplicationEpoch/close——本复核逐键清点），seam 输入加性可选不触键集；internal.ts 值导出恰两键（`createNamespaceRuntimeForRegistry` + `openReplicationSessionCoreForRegistry`），第三可选参不扩导出面（注：internal.ts 头注「十键」为陈旧注释，SA8 复核已如实登记）。事件型注册表 20→21：走 §23 自我声明 append-only 条款（L601-604「不改变任何 wire 字节……只增不改」实读）且为 Issue AC 第 7 项明文要求——**属被批准的演进，非未批准扩形**。
- **裁决：四门全部未触发**（独立重推导与设计 §13、SA8 复核一致）。

### A6 攻击「dormant 等价」：无 observer / 无 stageClock 时是否真零开销？

- 证据：现状 `t0 = this.observerOn ? this.host.now?.() : undefined`（peer/hub applyRemoteUpdate 实读）已是 observer 门控采样先例；设计 D7 把同纪律扩到 stageClock（无注入零读、clock throw 折叠为字段缺席——observer.ts:125 `safeNow` 折叠先例实读）与槽级 sink（无 sink 整条关闭）。§11.2-4/6/7 的 dormant/全等断言入契约。
- **裁决：攻击失败。等价规则完整且可测。**

### A7 攻击「跨产物一致性」：SA5/SA6/SA8 与设计是否互相矛盾或引用失实？

- 证据：设计 §8.1 的 persistence 审计锚实读成立（lifecycle.ts `saveDoc` = `dirtyGeneration += 1; scheduleFlush(cell.entry)`，resolve 前零重活——「H2 在树不可复现」为实）；SA6 强化的三断言（零 connection-state-changed、逐笔时间线、头注边界矩阵）在 repro 文件中在场；两份 SA8 报告的抽检声明经本复核独立重验全部成立（含其自我更正项：internal.ts「十键」陈旧注释如实标注）。冲突报告注记 1（基线不在 HEAD）→ SA5/SA6 轮消解 → 复核 §四-5 确认——链路自洽。
- **裁决：攻击失败。跨产物一致。**

## 三、设计锚点核验总表（HEAD `9e3f0bf` 实读）

| 设计断言 | 实读结果 |
|---|---|
| sequencer 包内私有、FIFO 链形 `tail.then(run, run)`（:38-42）、index 不导出 | ✓ |
| 槽结构 R4(:620)→R5(:640)→R5.5→R6(:665)→R7(:678)、A4 入队(:488) | ✓（设计 :487/:677 为邻域级偏差，见 F2） |
| `RuntimeReplicationSessionApplyResult` ok 分支 `Readonly<{ ok: true }>`（:81-83） | ✓ |
| `RuntimeReplicationHost` WeakMap 登记、不污染 runtime 键集（replication-session.ts:297-313） | ✓ |
| runtime 十二键（逐键清点） | ✓ |
| internal.ts 值导出两键、factory 现两参 | ✓ |
| registry options `...(x !== undefined ? {x} : {})` 模式（:2013-2021）、:746 默认 factory | ✓ |
| registry types.ts 镜像联合 `Readonly<{ ok: true }>`（:482-484）+ lease.ts `Equal<>` 镜像锁（:143-144/:384） | ✓——双侧同改即保持绿，不镜像即 TS 红（设计引用的先例成立） |
| lease 2 键严格校验（:107-130） | ✓ |
| peer applyRemoteUpdate t0（:1043）/结算续体发射（:1065-1079）/UPDATE_ACK 回 sequence（:1086-1090） | ✓ |
| peer sendUpdateFrame seq（:978 邻域）/`update-sent` 仅 `seq>0 && observerOn` 发射 | ✓ |
| hub 侧镜像（onUpdate :579 / sendUpdateFrame :808 邻域 / apply :855-901，t0 :867 / t1 :880） | ✓ |
| channel：`queued.push({bytes})`（:116）、inFlight Map seq 键（:66/:236）、onAck→onUpdateAcked info（:44-46/:137-142）、sentAt 记账（sendAndRegister 内 safeNow）、贪心合并 takeItems/mergeItems | ✓ |
| `degraded-bypass-applied` 现状无 latency 字段（types.ts:404-409） | ✓——设计「不加时延字段」与现状纪律一致 |
| liveness 缺面 dormant（liveness.ts:5-6）、`pingIntervalMs: 30_000`（defaults.ts:41） | ✓ |
| 事件联合现 20 型（types.ts 逐型计数） | ✓——第 21 型为 append-only 增量 |
| protocol §3 sequence / §10.2 ackedSequence / §23 append-only + §23.4 发射点与 clock 纪律 | ✓ |
| `@nomicore/clock` system.ts = `Date.now()`（可跳变 epoch 源，无单调生产源） | ✓——D3「组合根注入同一单调实例」前提成立 |
| persistence saveDoc = 同步登记（lifecycle.ts:581-590） | ✓ |
| driver `hubClock/peerClock` 加性 dormant seam（git diff 实读） | ✓ |

## 四、发现（全部非阻塞；处置意见随附）

- **F1（引用精度，SA3 修正）**：设计 §12 证据表「types.ts:120-128 safeNow 折叠先例」——`safeNow` 实际位于 `observer.ts:125`，`ReplicationClock` 类型在 `types.ts:260`，types.ts:132/:180 是 clock 选项槽位。纪律本身真实在案，仅引用错位；实现期引用应为 observer.ts:125。
- **F2（锚点邻域偏差，无需动作）**：admission 锚 :487 → 实为 :488；dirtyDone「:677 前」→ R7 return 实为 :678。均在「邻域」容差内，无语义漂移。
- **F3（命令面勘误，SA3 必须修正）**：§11.3 的 `pnpm --filter @nomicore/namespace-runtime test` 与 `pnpm --filter @nomicore/namespace-registry test` 在本 repo 为**空操作**（两包 package.json 仅有 typecheck/build 脚本，本复核实测 exit 0 且零输出）。聚焦面应以根 vitest 路径调用替代（如 `pnpm exec vitest run packages/namespace-runtime/test packages/namespace-registry/test`）；根门 `pnpm typecheck && pnpm test` 不受影响、仍然有效。
- **F4（随附约束，升格确认）**：ADR-0010 修订节一行登记「ok 分支加性可选 `stages`（issue #238 观测导出）」为**实现 PR 的必含项**（SA8 复核已从建议升为随附要求，设计 §15-6 已列——本复核确认其必要性：保守读法下这是消歧的唯一合规路径）。漏登不构成设计缺陷，但实现不得省略。
- **F5（实现期提醒）**：`sendQueueMs` 的具体管线（channel 记账 → 事件对象）经内部 host 接口回调传递，属包内接口的机械扩展（同 `onUpdateAcked` info 扩展先例）——设计已指明方向，具体形状由 SA3 落定；不得因此触公共面。
- **F6（诚实面登记）**：degraded-bypass 路径 `stages` 在结果中在场但 `degraded-bypass-applied` 事件按既有纪律不携时延字段（§3.4）——该事件面无分段可见性是设计明示的选择，非缺口；实现期不得顺手打破该纪律。

## 五、裁决

- 设计以零 wire 变更、零槽序变更、零受保护判据变更、零未批准冻结注册表扩形（事件型 20→21 走 §23 append-only + Issue AC #7 明文要求，属批准演进）实现 Owner R1–R5：基线锚真实、绿、且被设计显式冻结；四段判别 + 守恒式的锚点与数学均经独立重验成立；sequence 帧级关联的三个发射面值全部已在域；修复腿不预写无证据优化，按证据决策树闭合。
- 「复现 = 机制证明、非生产 11 秒阶段证明」的边界在设计、SA5、SA6 三层产物中一致保持；跨侧减法被降级为 triage 近似。
- 攻击复核未发现任何可推翻设计可实现性、边界合规性或 Owner 要求达成映射的缺陷；发现 F1–F6 全部为引用精度/命令勘误/随附约束级别，已给出处置意见，不构成 reject 依据。
- **Verdict: approve**（附条件：F3 命令勘误与 F4 ADR-0010 登记为 SA3 实现期必含项；F1/F5 为修正性提醒；F6 为纪律重申）。
