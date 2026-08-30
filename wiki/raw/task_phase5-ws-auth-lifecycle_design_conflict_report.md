# 冲突门禁报告（设计后复审 R2）

- 被审对象：`wiki/raw/task_phase5-ws-auth-lifecycle_design.md`（SA1 设计档案 **R1 修订版**，issue #138 Phase 5 切片 7：实例认证与连接生命周期；R0 → R1 差异面：§6 全节重写 + §6.5 测试锚变更 + §11 ALLOW 扩展 + §0.2/§8/§10/§12/§13/§14 联动，**D1/D2/D3/D5 与 §2–§5/§7–§9 零改动**）
- 冲突基准：ADR 全集 `docs/adr/0001`–`0010`（10 个，R2 轮全量逐个重读，无抽样）+ `CONTEXT.md` + 任务指定的 Phase 5 规格基准（`docs/phases/phase-5-websocket-replication.md` L146–151；`docs/protocols/instance-replication-v1.md` §2/§6.3/§13/§14/§15.1/§15.2/§19/§21——ADR 0010 L151 指定的唯一 wire contract，具 ADR 级约束力）
- 前置门禁：`wiki/raw/task_phase5-ws-auth-lifecycle_conflict_report.md`（verdict `clear`）；相关决议：`wiki/raw/task_phase5-ws-auth-lifecycle_relevant_decisions.md`（R2 已同步更新「设计引入的新决策点」节——R0 条目 1 作废、登记 1/1a–1e R1 决策点）
- 上一轮报告：本文件 R1 版（verdict `conflict`，CP-1/CP-2 均 evolution 同根，上报 Jim/总控）——总控裁决（2026-08-29，dispatch 第 5 行）**按协议字面契约**：ready 态收到的 drain 类 GOAWAY 无条件进入 draining（与 retryAfterMs 无关），一切 GOAWAY drain 路径无差别停新 OPEN 与新 sync round
- 审查日期：2026-08-29（run_id: issue-138-1787994136-4073122, round 1，SA8 设计门禁 R2）
- 审查焦点：① CP-1/CP-2 是否按总控裁决消解；② R1 修订是否引入**新**冲突
- 源码核实（证据用，非冲突基准）：`packages/ws-replication/src/{peer-connection,peer-namespace,round-engine,hub-connection}.ts`、`test/ws-replication-{sa7-dynamic,sa7-issue137-dynamic,api.test-d}.test.ts` 逐点核对 R1 新增引用

## Verdict

`clear`

**裁决分布：no-conflict 10/10 ADR（R1 修订面逐条吻合协议字面）；CP-1/CP-2 双消解（closed，复核证据见冲突点表）；新冲突 0；override-declared 0；evolution 0；hard-violation 0。放行——SA1 设计进入 SA2 全维度攻击评审。**

## CP-1/CP-2 消解复核（本轮核心）

| # | 原冲突（R1 轮裁决） | R1 修订面 | 协议字面复核 | 源码/锚核实 | 复核结论 |
|---|---|---|---|---|---|
| CP-1（原 evolution/高） | §15.1 L411 `ready ├─ local-stop/GOAWAY → draining` 无条件 vs R0「draining 转移以 retryAfterMs hint 存在为键；无 hint SERVER_RESTARTING 保持 ready」 | §6.1 裁决记录 + §6.2 伪代码：drain 类（SERVER_RESTARTING 及一切非永久类 reasonCode）从 ready 收到即 `setState('draining')` + `armDrainClose()`，**与 hint 无关**；hint 仅入 §6.3 deadline close 后重连调度（hint → `retryAfter + random()×cap`；无 hint → 普通 full-jitter backoff）；R0 `goawayReceived` 标志与键控伪代码「整体删除，全文零死引用」 | L411 边现在**字面满足**（任何 drain 类 GOAWAY → draining，不分 hint 有无）；§15.1 L435「SERVER_RESTARTING：关闭后按 retryAfterMs + jitter重连」由 §6.3 公式逐字落实（random=0 → 恰 retryAfterMs，红灯 #9 t=7000 轴）；L438 普通 backoff 家族承载无 hint 出口（G1 25ms 轴） | G1 现断言 `sa7-dynamic.test.ts:189` `expect(connectionState()).toBe('ready')` 实证存在（改锚点定位准确，§6.5-A1 恰 2 行：L189 断言值 + L188 注释）；§6.2 无条件分支与红灯 #9 断言逐字吻合（design §6.3 对账）；A2-a 把无 hint draining 面固化为契约级新锚（不依赖 legacy 文件） | **消解（closed）**。设计语义 = 协议字面 = 简报冻结契约表 GOAWAY 行（「Peer 收 GOAWAY → 连接 ready → draining（§15.1）」——前置门禁本就无条件，R0 键控实为偏离，R1 回归） |
| CP-2（原 evolution/中，随 CP-1 同根） | §6.3 L147「收到 GOAWAY 后停止 OPEN，**不开始新 sync round**」在无 hint 路径缺结构性门（R0 状态保持 ready → 出站门放行） | §6.1 落实点 3 + §6.2 出站纪律：无条件 draining 后 `sendControl`/`sendData` ready 门（`connStateValue !== 'ready' → 0`）覆盖**全部** drain 路径；blocked 类经 blocked 态同门 + sender teardown；两路径（入站 RESYNC_REQUIRED / 本地 ACK_TIMEOUT timer）精确区分并写入 §8.3 | L147 行为条款对两类 GOAWAY 无差别成立：drain 类出站门（draining）+ blocked 类出站门（blocked）均结构性拦截 OPEN_NAMESPACE / round Step1/Step2 / CLOSE_NAMESPACE；「停新 OPEN」另由 `addTarget` ready 分支不可达双保险 | 源码逐点核实：`peer-connection.ts:233-234`（onMessage 门只放行 handshaking/ready——draining 解码前丢弃，入站触发零扰动）；`:426`（sendControl ready 门）、`:438`（sendData ready 门）——draining 态恒拦；round 触发链 `peer-namespace.ts:447-451`（onResyncReceived→maybeStartRecovery）+ `:635-638`（startRound）+ `round-engine.ts:82-86`（startRound→host.send SYNC_STEP1）——Step1 必经 sendControl ready 门，draining 期零上 wire；A2-b 新锚（本地触发主锚 + 入站触发辅锚）钉死「STEP1 计数 === 基线」 | **消解（closed）**。SA8 R1 轮预判成立：「若 CP-1 裁字面 draining，则 draining 出站门自动覆盖，本条消解」——R1 恰走此路径，且设计额外补齐了入站触发变体的门分析 |

**R1 裁决作用域边界的复核（设计 §6.1 落实点 2，透明性核查）**：总控裁决落实到 blocked 类（SERVER_SHUTTING_DOWN/REAUTH_REQUIRED）时保持「blocked 直达、不经 draining」——设计显式声明该边界并给出依据。SA8 按冲突基准独立复核：**该读法是协议文本内部唯一自洽解**——① §15.1 GOAWAY 原因分级表 L436-437 明文「SERVER_SHUTTING_DOWN：blocked」「REAUTH_REQUIRED：blocked」；② L413 `permanent protocol failure → blocked` 提供出口边；③ draining 态自身出口仅 `namespaces closed/deadline → stopped | backoff`，**不存在 draining→blocked 边**——若强行 draining-then-blocked 将违反 L436-437 的 blocked 终局且无状态机边可走；④ R1 轮 SA8 已裁「分级细化通用边是协议自身认可的读法」（CP-1 减轻因素②，G2/B1 既有锚）；⑤ 裁决限定语「（与 retryAfterMs 无关）」仅对 drain 类有意义（blocked 类不携带 retryAfterMs 语义）。dispatch 日志「所有 GOAWAY 进入 draining」为转述层面的宽表述，与本轮基准（协议文本）无冲突。**裁定：no-conflict，非裁决战场的重新打开。**

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论（R1 修订版） |
|---|---|---|---|---|
| 0001 | VFSL 文本是 schema 的唯一真相源 | accepted（含 2026-08-19/08-21 修订节） | 否 | 设计不触 schema/投影/脚手架；SCHEMA/ROOT 仅作脱敏对象（§8.4）。无冲突 |
| 0002 | 全新重写、authority 出范围 | accepted | 否 | authorization 全部落在 ADR 0010 L37/L157 连接/namespace 授权域。无冲突 |
| 0003 | 求值器与派生 schema | accepted | 否 | 不触及。无冲突 |
| 0004 | vfsl-protocol 类型投影 | accepted | 否 | 不触及。无冲突 |
| 0005 | 投影生成管线 | accepted | 否 | 不触及。无冲突 |
| 0006 | Cordis 持久化插件 | accepted（含 #64/#79/#131/#133 修订节） | 否（弱） | 设计不改 Persistence 契约（DENY LIST 明禁）；drain 语义经 §21 域收口。无冲突 |
| 0007 | 逻辑验证与 Yjs Runtime Bridge | accepted（Runtime/open/read 由 0008 部分取代） | 否（弱） | 被取代条款不构成约束；raw 通道已定 ReplicationSession，本设计不触 apply 语义。无冲突 |
| 0008 | NamespaceRuntime 读写能力与单序列器 | accepted（含 #93、#132 修订节） | 是 | #132 status 边界：连接状态机/backoff/draining 全留 ws-replication 连接域（R1 改动全部在 peer-connection，未入 Runtime status）✓；L93 已接纳任务无条件排空经既有 settle/cleanup 链承载（§7 closeTail）✓。无冲突 |
| 0009 | NamespaceRegistry、租约与 Host 生命周期 | accepted（含 #131、#134 修订节） | 是 | 注入式 Timer 纪律：R1 新增 drainCloseHandle/backoffHandle 全走 `options.timer`（§6.2/§8.1 矩阵，clear 点列全）✓；L95 脱敏模型（§8.4）✓；#134 release 不取消已接纳 apply 与 §7 排空同向 ✓；`options.random ?? Math.random` 镜像既有交付形态（注记 N3 维持）。无冲突 |
| 0010 | Hub/Peer WebSocket Y.Doc 复制与最终一致 | accepted（含 #134 round-2、#133 round-2 修订节） | 是（权威 ADR） | **无冲突（R1 轮 CP-1/CP-2 已消解）**——L151 委托的协议 §15.1 L411 状态机边与 §6.3 L147 行为条款：§6.1/§6.2 无条件 draining + 状态键控无差别停 OPEN/round 字面落实（见消解复核表）。其余条款 R1 轮已逐条吻合且 R1 未触碰：L19（peer-only 状态机）✓、L37/L157（授权深 Adapter）✓、L145-L147（HELLO 协商/序列纪律）✓、L155/L156（verifyToken→instanceId 文法）✓、L158（撤销只关 channel）✓、L159（脱敏）✓、L165（连接级错误关整条连接）✓、L167（observer 归切片 8，§8.4 R1 勘误后与 phase 文档一致）✓、L174（交付物边界：R1 新增的 ALLOW 扩展仍在 `@nomicore/ws-replication` 内）✓、L179（停机顺序 §7 对齐 §21）✓ |

协议/规格基准对照（ADR 0010 L151 委托 + phase-5 任务指定；仅列 R1 差异面，其余沿用 R1 轮结论）：

| 文档 | 对照结论（R2） |
|---|---|
| instance-replication-v1.md §15.1 | **R2 核心**：L411 `ready ├─ local-stop/GOAWAY → draining` 由 §6.2 无条件分支字面满足（drain 类含未知 reasonCode——落回通用边，协议未枚举未知码）；L435-437 原因分级逐行对齐（RESTARTING→draining+retryAfter+jitter；SHUTTING_DOWN/REAUTH→blocked 直达，见作用域边界复核）；L438 无 hint→普通 backoff ✓；L424-431 full-jitter 公式/注入 seam 既有交付未动（§6.3 公式复用注入 random/timer）✓；draining 出口（`namespaces closed/deadline → stopped \| backoff`）经 §6.3 onGoawayClosed 两分支兑现（hint→backoff、无 hint→backoff）✓。无冲突 |
| instance-replication-v1.md §6.3 | L147「停止 OPEN，不开始新 sync round；现有 namespace 到 deadline 前自然收口」：停 OPEN/停 round 经出站 ready 门 + addTarget 不可达 + 入站门三重结构性成立（CP-2 消解）；「自然收口」= draining 期不强关既有 namespace（A2-b 辅锚断言 ns1 保持 live）✓；deadline close(1001) §6.2 armDrainClose ✓；「之后发送方以 WS 1001 关闭」的 hub 停机侧（立即关闭 vs 等 deadline）维持 R1 轮注记 N1 裁决域（AC-6 clear 域，红灯 #10 钉死）。无冲突 |
| instance-replication-v1.md §15.2 | Hub 不含 dial/backoff ✓（R1 改动全部 peer 侧 + hub 停机面）；「已建立连接只在 revoke/reauth 时关闭」与 D3/D5 一致 ✓。无冲突 |
| phase-5-websocket-replication.md | L146-151 验收链 `… → ready → draining / ↘ backoff / ↘ blocked`——R1 无条件 draining 后链路完整可达 ✓；切片 7 五条要求 D1–D5 对应不变（R1 未触碰）✓；测试 seam（fake duplex/fake scheduler/shutdown race）由红灯矩阵 + A2 新锚覆盖 ✓。无冲突 |
| 任务简报冻结契约表 | GOAWAY 行「Peer 收 GOAWAY → 连接 ready → draining（§15.1）」——R0 键控本偏离此表，R1 回归字面 ✓；红灯 #9 逐点对账（design §6.3）✓；「既有 10 IT 断言零改动」与 A2 追加（SA6 owned）相容——冻结契约文件按总控裁决方向扩展，非断言改写 ✓。无冲突 |

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| （无新增） | — | — | — | — | R1 修订面（§6 重写/§6.5 锚变更/§11 ALLOW 扩展/§8.3 新行/§12 A9/§13 R1 声明/§14 回应表）逐条对照 ADR 全集 + 协议 + phase-5 + 简报冻结契约：未发现任何新引入的直接违反、未声明推翻或未走 supersede 的实质演进。CP-1/CP-2 已消解（见上表，closed） |

## 结论

**Verdict: `clear` —— 放行。CP-1/CP-2 双消解（closed）；新冲突 0；无需 override、无需 Jim 裁决条目、无需停止运行。设计进入 SA2 全维度攻击评审。**

1. **CP-1 消解判据**（三条齐备）：① 设计文本 §6.1/§6.2 与协议 §15.1 L411 字面一致（drain 类无条件 draining，hint 只管 §6.3 重连调度——L435 字面）；② 分歧源（`goawayReceived` 标志 + 键控伪代码）整体删除、全文零死引用（design 自检 + SA8 通读复核）；③ 既有工件按「契约优先，工件随契约改锚」处置——G1 L189 恰 2 行改锚（源码实证现断言 `'ready'` 存在于 `sa7-dynamic.test.ts:189`，改锚点唯一且必要），A2-a 契约级固化无 hint 面。
2. **CP-2 消解判据**：无条件 draining 使出站 ready 门（源码实证 `peer-connection.ts:426/:438`）自动覆盖全部 drain 路径；入站门（`:233-234`）拦 RESYNC_REQUIRED；本地触发链（`peer-namespace.ts:447-451/:635-638` + `round-engine.ts:82-86`）Step1 必经 ready 门零上 wire；A2-b 双变体锚钉死。R0 的缺口（无 hint 路径状态保持 ready）随状态键控结构性闭合。
3. **D5 零改锚判据**（源码实证）：`sa7-issue137-dynamic.test.ts:517-579` 全文无 draining 窗口内连接状态断言；pending 计面断言（`pausedPending + 1` / `pausedPending - 1`）在「draining 进入仅 setState + armDrainClose、不 teardown sender」约束下成立——该约束已写入 §6.2 伪代码注记与相关决议 1c（SA3 实现红线；违反则 D5 破绿，SA4/SA7 比对锚）。
4. **R1 新增面 sweep 结论**：未知 reasonCode→drain 类（协议通用边）；hint 公式 `retryAfter + random()×cap` + attempt 不递增（L435 字面 + 协议未规定域的设计裁量）；timer 句柄纪律（§8.1 全 clear 点）；§13「R1 不改公共契约」声明与 accept/verifyToken/revoke 签名 R0/R1 一致——均 no-conflict。
5. **注记（非冲突，移交 SA2/SA3/SA7）**：
   - **N1（沿用）**：hub.close() GOAWAY 后立即 close(1001) 不等 drainTimeoutMs——前置门禁 AC-6 clear 裁决域 + 红灯 #10 零时间推进钉死；§15.2/§21「不无限等待网络 ACK」结构性满足。非本设计新引入。
   - **N2（沿用，R1 扩展至无差别）**：draining 入站门忽略对端帧（`:233-234`）——协议未规定 draining 入站处理；deadline close + 重连 reconcile 修复（§12/§16 同向）；代价为 drain 窗口 in-flight ACK 无法完成。设计取舍面，归 SA2。
   - **N3（沿用）**：`options.random ?? Math.random` 镜像既有交付形态（types.ts:112 先例）；协议 L431 经 seam 存在性 + 测试全注入满足；ADR 0009 #131「不回退全局随机源」作用域为 Registry randomBytes。若总控要求 ws-replication 同纪律属独立演进，另行立项。
   - **N4（已采纳勘误）**：§8.4「切片 9」→「切片 8」+ auth/authz failure 事件面回补登记——R1 落实，与 ADR 0010 L167/phase 切片划分一致。
   - **N5–N8（沿用，R1 未触碰对应面）**：closeTail settle 语义（N5）、handshaking 跳 GOAWAY（N6）、认证拒绝 1008 映射（N7）、revoke 命令式 API 与 §19 事件形式关系（N8）——结论同 R1 轮。
   - **NR-1（R2 新增，观察项归 SA2）**：drain 窗口内本地触发的 round 机械照常推进控制器本地状态（needs-resync→reconciling、roundId 递增、reconcile timer 武装）但零 wire 效应——「不开始新 sync round」在 wire 契约层面成立（无 round 上 wire，对端零感知；deadline teardown 归零，重连 reconcile 覆盖）。协议文本以 wire 行为为规治对象；本地状态推进是否应更早抑制属设计优劣判断，非门禁冲突。
   - **NR-2（R2 新增，SA3 红线提醒）**：§6.2「draining 进入点不 teardown sender」是 D5 pending 计面锚的结构前提（相关决议 1c）——SA3 若在 draining 进入点加 teardown 将破 D5 锚；SA4/SA7 以此为比对锚。
6. **范围核实**：§6.4 既有锚对账（G1 改锚/D5 零改锚/G2-B1 保持）经测试文件逐断言读证属实；§6.5 测试锚变更清单、§11 ALLOW 扩展（sa7-dynamic 移入 `[SA6 owned]`）、§13 caller 审计（R1 零增删）与源码/工件一致；改动面全部落在 `@nomicore/ws-replication`（ADR 0010 L174）。
7. **相关决议文档已同步**：`wiki/raw/task_phase5-ws-auth-lifecycle_relevant_decisions.md`「设计引入的新决策点」节更新为 R1 状态——原条目 1（hint 键控）作废，登记 1（无条件 draining）/1a（blocked 类作用域边界）/1b（未知码归类）/1c（draining 进入点不 teardown）/1d（hint 公式与 attempt 处置）/1e（测试锚变更），供 SA2/SA3/SA4/SA7 全链回查。
