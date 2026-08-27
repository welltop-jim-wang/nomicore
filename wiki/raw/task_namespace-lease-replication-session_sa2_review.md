# SA2 攻击评审报告 — issue #134（Phase 5 切片 3/4：expose trusted NamespaceLease ReplicationSession）

- **Date**: 2026-08-28
- **被审对象**: `wiki/raw/task_namespace-lease-replication-session_design.md`（SA1 R0，701 行）
- **评审基线**: ebc5419（worktree `/home/wangjian/nomicore-fix-issue-134`）
- **约束基准**: `task_namespace-lease-replication-session_relevant_decisions.md`（ADR 条款摘录 + SA8 设计后复审追加节，含 C-1/C-2/R-1..R-6）
- **Verdict**: **reject**（两项 HIGH 阻断；机制层架构经全维度攻击未破——阻断项全部为类型计划/文档清单/规约精化级修订，预期零机制返工，修订后复审应很快）

---

## 0. 评审方法与实证声明

本次评审不采信设计文本的自述，对全部可实证声明独立复跑：

| 实证项 | 命令/方式 | 结果 |
|---|---|---|
| SA6 类型面 5 探针对设计 §3.1 字面形状的可满足性 | `npx tsc --noEmit --strict`（TS 5.9.3）模拟 `registry-phase5-replication-session-surface.test-d.ts` 全部 5 探针对抗 `interface ReplicationSession/Status` 字面形状 | **exit 0 全过**（含 `getStatus(): Readonly<ReplicationSessionStatus>` → `Readonly<Record<string, unknown>>` 的隐式索引签名问题——实测可赋值） |
| §3.3 Equal 类型锁的可满足性 | 同上，模拟 §3.2 core（5 码 apply 联合）vs §3.1 公共（6 码联合）的 `Equal<Core, Public>` | **TS2344 红**（详见 HIGH-1）；core 并入第 6 码后 exit 0（修法可行） |
| Yjs origin 回传语义（INV-S3 根基） | node + 仓库 yjs 13.6.32：本地 `transact`（→ `null`）+ 非空 `Y.applyUpdate(doc, update, Symbol)`（→ symbol）+ 管理 transact（→ `null`） | `origins: [ 'null', 'Symbol(sessionA)', 'null' ]`——设计 §13 声称**独立证实** |
| scratch 判据 (a) 反例构造 | 同上：① 删 META.replicationId 后同值重设 ② 删 META.replicationEpoch 不重设 ③ 畸形字节 `[0xff,0xff,0xff,0xde,0xad]` | ① 投影相等（**允许**——O-12 裁决推论，见 INFO-1）② 投影变化（拒 ✓）③ scratch 上同步 throw（拒 ✓） |
| 敌意 Uint8Array 子类 | 同上：`class EvilBytes extends Uint8Array { slice(){throw} }`；`instanceof` / `slice()` / `new Uint8Array(evil)` | instanceof 通过、`slice()` **throw**（MEDIUM-1 实证）；`new Uint8Array(evil)` 安全（返回纯 Uint8Array，绕过被覆写的 slice） |
| 基线事实 | grep/读码：`doc.on('update')` 全 src 零既有挂接（INV-S2 事实基础 ✓）；runtime index 值导出恰一键 ✓；`runtime-registry-internal-seam.test.ts:270` 十二键锁与 L122 一键锁（及头注「精确键集断言由实现时同步演进」先例）✓；审计白名单 `packages/namespace-registry/src/` ✓；§13 引用的 #132 degraded retry 测试存在 ✓ | 全部属实 |

---

## 1. 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞（设计锚点） | 攻击场景 | 建议修复 |
|---|--------|--------|---------------------|---------|---------|
| 1 | **HIGH** | 类型锁计划自相矛盾（契约一致性） | §3.2 `RuntimeReplicationSessionApplyRefusalCode` 为 **5 码**（L211–214，「NAMESPACE_LEASE_RELEASED 由 registry 包装层前置映射，不经 core」）vs §3.1 `ReplicationSessionApplyRefusalCode` 为 **6 码**（L118–124，含 `NAMESPACE_LEASE_RELEASED`）；§3.3（L245）却断言 `Equal<RuntimeReplicationSessionCore, ReplicationSession>` **十键逐字段相等** | SA3 按文实现 → `lease.ts` Equal 断言**必然编译红**（实证：TS2344 "Type 'false' does not satisfy the constraint 'true'"）；SA3 要么擅自改联合（未授权设计决策）、要么丢锁（O-3 锁面机制失守）——两者都造成「设计声明 vs 仓库事实」漂移，SA4 静态验尸必撞 | core 侧联合并入第 6 码 `'NAMESPACE_LEASE_RELEASED'`（注释明示 core 永不结算该码、registry 包装层 `revoked()` 是唯一产出点；实证该形状 Equal 通过）。备选：九键 Equal + apply 键单向结构断言（弱化锁面，不推荐） |
| 2 | **HIGH** | SA8 放行条件 C-1 未落入文档同步清单（放行条件核查） | §10 phase-5 行（L606）仅列「方法名 / role 注入 / status 词汇 / 受保护常量与白名单空集 / 切片 9 role 必传注记」——**无 needs-resync 推迟对账注记**。SA8 设计复审 C-1 明文要求「必须在 phase-5 文档增补中显式登记（切片 3『needs-resync 通知』→ 切片 6 队列属主），或设计补充『切片 3 无队列 ⇒ 空实现不可达』的明示声明」；relevant_decisions「设计后复审追加」文档同步条目也已把该注记列为必含项（约束基准） | SA3 照 §10 执行文档同步 → phase-5 切片 3 文本「Observer failure 隔离和 `needs-resync` 通知」与实现（无队列、无 needs-resync）留下未对账偏差 → Phase 5 收口一致性审查（阶段门禁第 1 条）阻断，或后续读者误判 needs-resync 已交付 | §10 phase-5 行追加：「切片 3『needs-resync 通知』对账注记——本切片无队列 ⇒ ADR 0010 L113 唯一触发面（队列溢出）结构性不可达；needs-resync 与队列属主 = 切片 6」（一行） |
| 3 | **MEDIUM** | apply 接纳层敌意输入击穿「一切拒绝经 Promise 结算」承诺（安全/敌意输入） | §4.4 A2（L322–323）：`instanceof Uint8Array` 通过后「立即 `bytes = update.slice()`」——无陷阱防护。§3.1（L168）承诺「一切拒绝经返回 Promise 的 ok:false 结果结算」 | 可信域内的敌意 `class Evil extends Uint8Array { slice(){ throw } }`：instanceof 通过 → 接纳层同步 throw（或 async 实现下变成非 `RuntimeWriteFatalError` 的裸 rejection）——实证 slice 确实 throw 且 instanceof 通过。与既有纪律不一致：设计在 §5.1 ② 为 open 输入引用了 enableReplication E3「全探测 try/catch」（replication-write.ts L269–298 先例）却未延伸到 A2 | A2 防御拷贝冻结为陷阱安全构造：`bytes = new Uint8Array(update)`（实证绕过被覆写的 slice、返回纯 Uint8Array、经不可截获的整型索引读取复制），或把 slice 纳入 try/catch → `REPLICATION_RAW_UPDATE_INVALID`。设计明文写出该构造 |
| 4 | **MEDIUM** | conflicted 终态的 fanout 摘除未在机制上写明（生命周期/正确性） | §4.3（L311–312）close() 路径「fanout.detach」明确；R2 conflicted 转换（§4.4 L333、§8 L562「fence 顺带终态化」）**未写 detach**；INV-S2（L544）「channel 随 core 终态摘除」只是总则措辞 | SA3 只在 close() 实现摘除 → epoch fence 后，被 fence session 的**存量** listener 持续收到后续业务写投递，与「终态 session …订阅永不投递」（§3.1 L165、§4.3 终态三联拒）精神冲突；transport 层可能据旧 session 字节继续错误同步 | R2 的 conflicted 转换同步执行与 close() 相同的终态摘除路径（`fanout.detach(channel)`）——设计一句话明示「两种终态共用同一摘除点」 |
| 5 | **MEDIUM** | session.close() 的 Promise 结算语义未冻结（生命周期） | §3.1（L172–174）「幂等 close：所有调用返回同一 Promise 实例；首次调用同步段标记终态 + 退订；已接纳 apply 槽照常排空（不取消——**沿 runtime.close barrier 语义**）」——引用了 barrier 语义却从未说明本 Promise **等待什么**、**是否可能 reject**；§4.3（L312）同样未定 | 两种实现（立即结算 vs 排队 barrier 等在途 apply 排空）都能过 SA6 用例 4⑥，SA3 二择一即产生未授权设计决策；§5.2（L444–446）`void activeSession.close()` fire-and-forget 隐含「close 永不 reject」前提——若 SA3 实现 barrier 语义且 reject，产生 unhandled rejection | 冻结一种语义并声明「close() 永不 reject」。建议：resolve 时点与「先于 close() 接纳的 apply 槽排空」挂钩（真 barrier，镜像 INV-C4；对切片 6/9 优雅停机「等待已被 Runtime 接纳的 apply 槽完成」更直接友好）；或明示「立即结算，排空由 Runtime close barrier 兜底」——二择一写死 |
| 6 | LOW | getStatus() 产物新鲜度/冻结未声明（契约一致性） | §3.1（L170）`getStatus(): Readonly<ReplicationSessionStatus>`——未声明「每次调用返回全新冻结对象」；状态域含随时间变化字段（state/currentEpoch/rootValidation/observerFailures/memoryCaughtUp） | SA3 返回共享可变对象 → 调用方突变 `status.currentEpoch` 等污染后续读数（或反之共享冻结对象无法反映变化） | 一句话：每次调用全新 + 深冻结（沿 runtime `buildStatus` 先例，status.ts L77） |
| 7 | LOW | memoryCaughtUp 初值未冻结（资源与确定性） | §3.1（L148）与 §4.4 R5.5（L337）只定义「apply 成功后置 true」——open 时刻初值未定义；SA6 用例 11 仅以 `/memory/i` 正则锚键名，不锁初值 | SA3 任意二择；切片 6 transport 若以该位参与 ACK/live 判定（如 reconciliation round 空 diff），初值歧义会变成行为分歧 | 冻结初值（建议 `false` + 语义注记「尚无经本 session 的 raw apply」）并列入 ADR 0010 增补节词汇注册 |
| 8 | LOW | encodeDiff/subscribe 的敌意输入行为未定义（安全/敌意输入） | §3.1（L163）`encodeDiff(remoteStateVector)` 对畸形 SV 的行为（裸 Yjs/lib0 throw？稳定码？）未定义；（L166）`subscribeOwnedUpdates(非函数)` 行为未定义 | 可信域调用方传入损坏 SV → 原生解码异常裸抛，与「终态 throw ReplicationSessionClosedError」的受控 throw 面并存，消费方无稳定判别 | 各一句话冻结（建议：畸形 SV → 照实抛 Yjs 原生错误并在 JSDoc 声明为可信域契约；非函数 listener → 订阅时 TypeError 或按投递期自捕获计数——择一写死） |
| 9 | LOW | Runtime close 后 encodeStateVector「照常」断言缺机制支撑（生命周期） | §5.5（L488）「`encodeStateVector`/`getStatus` 照常（doc 内存存活、会话观测面诚实）」——Runtime close 后 `handle.release()` 已执行，doc 生命周期归 Persistence（ADR 0006：引用归零后 flush/驱逐；dispose 可能 destroy doc） | 停止序违约的 transport（未按 ADR 0010 L179 先关 session）在 shutdown+dispose 后调 SV → 行为未定义（destroyed doc 上 encodeStateVector 可能 throw/空），设计的「照常」承诺无法兑现 | 软化该断言为 best-effort 并注记 ADR 0010 L179 停止序要求（session 应先于 Registry shutdown 关闭）；或实证 persistence 驱逐路径后重述承诺 |
| 10 | LOW | §14 命名笔误未修正（SA8 R-4 遗留） | §14 表第 5 行（L687）`openRuntimeReplicationSessionForRegistry` vs §0/§3.2/D-2 的 `openReplicationSessionCoreForRegistry` | SA3/SA4 对导出名与 ADR 0009 注记核名时歧义（SA8 已裁决以 §3.2 为准，但设计文本应自净） | 修正该单元格（一词） |
| 11 | INFO | 判据 (a) 允许「删后同值重写」——已裁决语义的边界点名（正确性） | O-12/§4.6 判据 (a)：实证「删 META.replicationId 后同值重设」投影相等 → **允许**；item 身份（Yjs clock）改变但无任何不变量依赖 item 身份 | 未来的审查者可能把该行为误判为漏洞反复重开议题；恶意 peer 也可借此向 SCHEMA/META 注入大量同值重写历史（doc 膨胀放大 O(doc) snapshot 成本——可信域威胁，危害有界） | 在 ADR 0010 增补节判据登记中点名该边界（「删后同值重写 = 内容未变 = 允许」）+ 一句历史膨胀注记；非机制修改 |
| 12 | INFO | scratch 预演 O(doc) 每 apply 的 CPU/内存放大（资源与确定性） | §4.6（L381）性能注记已声明「正确性优先，增量检查留待后续」 | 大 doc + 高频 apply：每 apply 全量 clone（CPU + 约一个 doc 大小的瞬时内存峰值）串行占用唯一 sequencer，业务写延迟被线性放大 | 建议把该已知成本登记进 ADR 0010 增补节（含「增量检查」演进位）；本切片接受 |
| 13 | INFO | subscribeOwnedUpdates 会投递 enable/bump 的 META 事务字节（契约一致性/切片 6 交接） | O-10/INV-S3：null origin 恒投全部 channel——enable/bump 的事务字节属本地 updates，照投 | 切片 6 transport 若把该字节直接回灌 peer session → 被 peer 侧 META 全键保护拒绝（epoch 传播须走 IDENTITY_CHANGED 控制消息，phase-5 切片 6 L98）——不是本切片缺陷，但属高危踩坑点 | 在 §10 phase-5 注记或 ADR 增补节加一句：「META 触碰的管理写字节不得经 raw 回灌对端；epoch 传播走控制面」 |
| 14 | INFO | observerFailures 无界计数 + 失败 listener 不熔断（资源与确定性） | O-10/D-13：listener throw 自捕获计数、扇出不断 | 永久失败的 listener 每次投递都消耗一份 `slice()` 副本并 +1 计数（无 circuit-breaker/自动退订） | O-10 的显式选择（ADR 0007 L54「记录」面），切片 6 队列/背压属主解决——接受，无需改设计 |
| 15 | INFO | §4.1 伪代码时点笔误 | L264 `registerReplicationHost(runtime, host)` 置于「V3d（sequencer 创建）之后」，但 `runtime` 字面量 V3e 才构造 | 无实质风险（SA3 自会放在对象创建后、工厂返回前）；文本自洽性 | 注明登记点在 V3e 后、`createNamespaceRuntimeWithSeam` 返回前 |
| 16 | INFO | P0 preparing 期 open session 为隐式允许——建议明示 | §3.2/§8 open 门序（host → lifecycle → fatal → facts disabled）无 schemaState 检查 | preparing/unavailable 期 open：facts 已在构造期 V2.5 预投影（诚实）、apply 不依赖 active schema——行为正确且合理，但设计未把「不做 schema gate」写成显式裁决 | 一句话明示「schemaState 非 open 门（apply 与 active schema 无关——有意行为）」防 SA3 自行加门 |

**未成立的攻击（攻击后确认防住，供 SA4/SA7 复用）**：FIFO 交错（apply/业务写/管理写/close barrier 全部经同一 WriteSequencer 同步接纳定序，bump 落两 apply 槽间确定性 fence——O-8 与 ADR 0008 L47「gate 瞬时观察」同构成立）；R2–R5 槽内零 await ⇒ fence/scratch/apply 间无 TOCTOU；回声抑制谓词（symbol 恒等 + null 全投——origin 语义独立实证）；listener 重入（apply/close/subscribe 重入皆因 enqueue 微任务化而无死锁，快照迭代防变异）；敌意 Proxy options（§5.1 ② 全探测 try/catch 沿 E3 纪律）；畸形字节在 scratch 预演被拦、live doc 永不被触碰；release 与在途 apply（INV-S11 排空 + 包装层 revoked 前置映射）；idle 不可能与挂起 session 共存（release 同步 close）；degraded 矩阵完备（含 notifier 未绑定与 getStatus() throw 两角）；role 闭环（hub 实例结构性无法获得 hub-to-peer 方向 ⇒ 无法获得 bypass）；peer 三管理写角色拒绝 JSON 逐字节稳定（冻结常量 issue）；值导出面两侧零突破（registry index 现状核实：types.ts const 不经 index 转出）；SA6 20 行为用例 + 5 类型探针逐条有实现路径且类型面实证可满足；新词汇与既有注册表零冲突（`REPLICATION_SESSION_INPUT_INVALID` vs 既有 `REPLICATION_INPUT_INVALID` 为不同串）。

---

## 2. 逐维度结论

### 2.1 正确性攻击 —— 通过（两处规约精度缺口：#4/#5）

- **槽序交错**：R1–R7 与 S1–S7/E1–E7 共享唯一 `WriteSequencer` 闭包实例（host 持构造序引用，结构性不出现第二队列）；接纳层 A0–A4 全同步 ⇒ FIFO 由同步接纳序决定。bump 落在两 apply 槽之间：[applyA(epoch1 过 gate 提交), bump, applyB(R2 fence → conflicted 零写入)]——确定性成立，与 O-8 声明一致。
- **TOCTOU**：槽体 R1→R5.5 无 await（首个 await 在 R6 notifyDirty），fence 重读（`state.replication` 投影链单点）与 `Y.applyUpdate` 之间无交错窗口——真无 TOCTOU。
- **scratch 判据 (a) 反例**：同值重写允许（#11，O-12 裁决推论）；删不重设拒绝、畸形字节 scratch 上 throw（均实证）；SCHEMA 容器嵌套/非 primitive 值保守判「已改变」；比较对象（scratch-after vs live-current）在无 await 窗口内同基线。
- **fan-out**：构造期恰一 `doc.on('update')`（全 src grep 证实零既有挂接）；同步扇出在事务内，listener 自捕获永不入 Yjs transaction 栈（T-2 闭合）；慢 listener 延长槽占用（SA8 R-3 已登记，接受）。
- **committed 边界**：R6 失败 → `RuntimeWriteFatalError(committed:true)` + markWriteFatal 同步先行 + 不重试——与 S6/E6 逐字节同构；bypass 路径同样 await notifyDirty（D-5）。

### 2.2 安全/敌意输入攻击 —— 一处实证击穿（#3），其余防住

- 敌意 options（Proxy/getter/ownKeys）：§5.1 ② 单读捕获 + 全探测 try/catch（沿 E3 立法）✓。
- apply 字节：`instanceof Uint8Array` + slice 捕获——**slice 可被子类覆写 throw（#3）**；巨大 update 的资源面为已声明权衡（#12，可信域 + 切片 6 上限属主）；Buffer 伪装（Uint8Array 子类）经 `new Uint8Array(update)` 拷贝后中性化。
- listener 敌意回调：throw 自捕获计数；重入 apply/close/subscribe 因 enqueue 微任务化 + 迭代快照而无死锁无变异。
- 冻结四域逃逸：session 为 `Object.freeze` 恰十键字面量；wrapCore 以构造期捕获常量直读四域——结构性不漂移（getStatus 产物新鲜度待 #6 补一句）。

### 2.3 生命周期攻击 —— 通过（#5 语义冻结 + #9 断言软化）

- release×在途 apply：release 同步 close（停接纳+退订+终态）+ 已接纳槽照常排空 + 包装层 revoked 前置映射 `NAMESPACE_LEASE_RELEASED`——与 ADR 0009 L42 逐句对齐。
- Runtime close barrier：apply 先接纳则先于 barrier（FIFO）；后接纳则 A3 拒——SA6 用例 16 锚。
- idle：release 必 close session ⇒ idle 超时关 Runtime 时不可能挂着 open session（结构性消除）；idle 窗口再 open = 新 Lease 新槽（用例 18）。
- conflicted 再 open：槽位按 `state==='open'` 判占，fence 释放后新 session 冻结新 epoch（用例 17）；状态洁净性依赖 #4 的摘除补写。
- P0 preparing 期 open：隐式允许且无害（#16 建议明示）。

### 2.4 契约一致性攻击 —— SA6 锚点全通、ADR 六步映射成立；类型锁自相矛盾（#1）

- **SA6 20 行为用例**：逐条核对 §9 矩阵 + 直接读测试断言，全部有实现路径、零锚改形（§11「SA6 零同步」核对成立：能力方法名/open 两域输入/结果联合/role 注入点/冻结四域属性/EXISTS/CLOSED/EPOCH_CONFLICTED/ROLE_PERMISSION/durability/四冻结词——逐项与测试断言对上）。
- **SA6 5 类型探针**：以设计 §3.1 字面形状（interface 形式）实证全部可满足（含此前担心的 `Readonly<Interface>` → `Readonly<Record<string, unknown>>` 隐式索引签名问题——TS 5.9 实测通过）。
- **ADR 0010 六步**：lifecycle(A3/R1)/角色(open 冻结 direction + R3 谓词 + R4 常量策略——结构性执行而非槽位步骤，可接受读法)/身份+epoch(R2)/受保护检查(R4)/一次 applyUpdate(R5)/observer 事务内扇出/await saveDoc(R6)/释放(R7)——逐位对应。
- **类型面纪律**：registry types.ts 纯结构性零 Runtime 命名类型/零内部 subpath 字面量 ✓；Equal 锁在声明图外 lease.ts 先例成立 ✓——**但锁本身不可满足（#1）**。
- **稳定词汇**：新增 10 码 + 1 fatal 码与既有注册表零冲突；复用词零改名；`REPLICATION_NOT_ENABLED` 复用面向 open 的 message 文案语义仍贴切。

### 2.5 资源与确定性攻击 —— 通过（#7 初值 + #12 已知成本登记）

- SA6 Yjs 纪律（远端 update 只写新键）在 SA3 侧可守（scratch-check 与槽序不制造并发；§14 审计同款用法）；SA3 自有测试文件（runtime-replication-session.test.ts）须沿 makeRemoteUpdate 模式——设计已列 SA3 owned。
- scratch O(doc)/apply 已声明（#12 建议登记 ADR）；observerFailures 为纯计数无内存问题（#14）。
- durability 词汇：`diskCaughtUp: false` 字面量类型结构性防 durable 误读 ✓；memoryCaughtUp 初值待冻结（#7）。

### 2.6 放行条件核查 —— C-1 未落实（#2）、C-2 齐备、R-1..R-6 有归属

- **C-1**：设计 §10 phase-5 行**不含** needs-resync 推迟对账注记——SA8 放行条件 + relevant_decisions 约束基准双重要求 ⇒ **阻断项 #2**。
- **C-2**：ADR 0010 增补节/ADR 0009 两注记/internal 键集锁测试演进均已在 §10 + §12 ALLOW 列齐——执行性条件交 SA3/SA4 核验，设计侧无缺口。
- **R-1**（role 缺省 'hub'）：SA2 评估——缺省 'hub' 是零回归唯一解（必填将击穿 135 文件绿基线），危害 containment 成立（hub 侧 META 全键收紧持续拒漂移 update；bypass 因 direction 冻结结构性不可被误配 hub 获得）；维持缺省 + 切片 9 必传注记即可，**不建议**本切片加显式 opt-in。
- **R-2**（origin 不透出）：合规上限型条款读法，切片 6 如需为加法扩展——接受。
- **R-3**（同步扇出槽内耗时）：接受，交 SA7 观测。
- **R-4**（命名笔误）：设计文本未自净（#10）。
- **R-5/R-6**：码名单义性/phase 词对齐均无碍（R-6 的三个 phase 串与 errors.ts 既有 `RuntimeWriteFatalPhase` 词汇一致，核对成立）。

---

## 3. 协议假设依据审查

- **章节存在**：§13 存在，6 项假设逐项给出依据类型与具体引用（设计期实测 + 源码引用 + ADR 引用 + 现有测试引用）；无 HTTP/WS/端口/跨进程类假设（声明与本切片非目标一致）。
- **「应该/通常/预计」类无据推断**：未发现——表格措辞为断言式并附证据。
- **实测依据可验证性**：4 项核心实测（origin 回传、diff 语义、scratch 投影判别、畸形字节 throw）**由 SA2 独立复跑全部证实**（§0 表）；「实测命令与完整输出已附于设计过程记录」——输出摘录已内联（§13 表），命令以文字描述（「packages/namespace-runtime 下 node 实测」）未贴逐字命令，属可改进但不构成 reject 依据（SA2 已代为完整复跑；外部引用 y-protocols/yjs 文档未给 URL，建议 SA3 补链接）。saveDoc degraded resolve 依据锚定 #132 既有测试（文件存在性核实 ✓）。
- **结论**：依据可被 SA4 验证 ✓，无虚据。

## 4. 错误处理链路审查

- **静默失败**：无。apply 全部拒绝路径经 ok:false 结果联合或 `RuntimeWriteFatalError` rejection 二通道（§5.3 映射表穷尽）；fanout listener 失败计数 `observerFailures`（记录面，ADR 0007 L54 合规）；open 全部拒绝经 Promise 结算——唯一例外是 #3 的敌意子类击破接纳层（修复后闭环）。
- **状态闭环**：fatal → markWriteFatal 同步先行（status.fatal 在 notifier 挂起窗口可观测）；fence → session `conflicted` 终态可观测；close/release → `closed` 终态 + Lease getStatus 单一真相源。闭环成立。
- **降级路径**：degraded 矩阵完备（hub 拒/peer bypass/released/disposed/notifier 未绑定/getStatus throw→fatal 五角俱全，§4.5）；恢复路径（retry 合一）沿用 persistence 既有行为。
- **虚假降级识别**：逐项检查 `REPLICATION_SESSION_UNSUPPORTED`（host 缺席——生产构造期无条件登记，缺席=测试替身/版本错配的**显式能力拒绝**，非把 bug 降级掩盖，loud 码 + 恒定文案 ✓）；`REPLICATION_NOT_ENABLED`（真实领域状态：未 enable）；未发现「正常流程前提缺失被包装成降级」的伪降级。✓

## 5. 红灯测试思路（每漏洞对应；供 SA3/SA6 参照）

1. **#1（类型锁）**：`pnpm typecheck` 本身即红灯（lease.ts Equal 断言编译错）；修后绿。可另在 surface.test-d 或包内 test-d 加 `Equal<core 类型, 公共类型>` 双向探针防回退。
2. **#2（C-1 注记）**：文档一致性检查（SA4 静态）：phase-5 切片 3 节必须含「needs-resync → 切片 6」对账字样；非 IT。
3. **#3（敌意子类）**：`class EvilBytes extends Uint8Array { slice(){ throw new Error('hostile') } }`；`const r = await settleOf(session.applyRemoteUpdate(new EvilBytes(8)))` → 断言 `r.kind==='resolved' && r.value.ok===false && code==='REPLICATION_RAW_UPDATE_INVALID'`（绝不同步 throw、绝不 rejection）+ live doc 零变化 + saveEvents 不增。
4. **#4（conflicted 摘除）**：session1 subscribe 收集；`bumpReplicationEpoch()` → session1 apply 被 fence（conflicted）；随后 `mutateRoot` 成功 → 断言 session1 的 listener **零新增投递**（终态停投对存量订阅同样成立）；对照 session2（新开）照常收。
5. **#5（close 语义）**：按冻结语义写：受控 notifyDirty 门挂起 apply → 调 `close()` → 断言 close Promise 与该 apply Promise 的结算序（barrier 语义：apply 先 settle；立即语义：close 先 settle——二择一按修订后设计断言）；另测 `void session.close()` 全路径无 unhandled rejection（`process.on('unhandledRejection')` 捕获计数为 0）。
6. **#6（status 新鲜冻结）**：`const s1 = session.getStatus(); const s2 = session.getStatus();` → `s1 !== s2`、`Object.isFrozen(s1)===true`；突变副本后再次读取不受影响。
7. **#7（memoryCaughtUp 初值）**：fresh session（未 apply）`getStatus().durability.memoryCaughtUp === <冻结初值>`；apply 成功后 === true。
8. **#8（encodeDiff 敌意 SV）**：`settleOfThrow(() => session.encodeDiff(new Uint8Array([0xff,0xff,0xde,0xad])))` → 按冻结行为断言（文档化 throw 或稳定拒绝）。
9. **#9（close 后 SV）**：SA7 动态可选：registry.shutdown() 后 `session.encodeStateVector()` 按软化后文档断言（best-effort 或明确不承诺）。

## 6. 阻断项与通过条件（reject）

**阻断项（必须修订设计文本后复审）**：

1. **HIGH-1**：消除 §3.2/§3.1/§3.3 类型锁矛盾（推荐：core 侧 apply 联合并入 `'NAMESPACE_LEASE_RELEASED'` 并注释产出点归属——实证 Equal 通过）。
2. **HIGH-2**：§10 phase-5 行补 needs-resync 推迟对账注记（C-1 落实）。

**强烈建议同轮一并修订（非阻断，但均为 SA3 二择一分歧源）**：MEDIUM-1（A2 陷阱安全拷贝构造写死）、MEDIUM-2（conflicted 终态摘除明示）、MEDIUM-3（close() 结算语义 + never-reject 声明）、LOW-1/2/3（status 冻结/初值/敌意输入一句话各）、LOW-5（§14 笔误）、INFO-16（P0 preparing 期 open 显式裁决）。INFO-11/12/13 建议随 §10 文档同步落入 ADR 0010 增补节。

**通过条件**：修订版设计对上述各项逐条落实并在「SA2 反馈逐条回应」表 mapping 到具体章节；机制层（槽序/seam/扇出/锁面结构）零改动预期——复审仅核修订点，不做全量重审。架构本体（唯一 sequencer 挂接、WeakMap host seam、fanout/origin、scratch 判据、degraded 矩阵、生命周期词义）经全维度攻击**存活**，无需返工。

---

## 7. 验证证据汇总（命令 + 结果）

```text
# 1) SA6 类型面 5 探针 vs 设计 §3.1 字面形状（TS 5.9.3 strict）
npx tsc --noEmit --strict /tmp/sa2-probe/probe3.ts          → exit 0（全过）

# 2) §3.3 Equal 锁矛盾实证
npx tsc --noEmit --strict /tmp/sa2-probe/probe4.ts          → exit 2
  error TS2344: Type 'false' does not satisfy the constraint 'true'（Equal<Core,Public> === false）
# 修法验证（core 并入第 6 码）：
npx tsc --noEmit --strict /tmp/sa2-probe/probe5.ts          → exit 0

# 3) Yjs 语义独立复跑（yjs 13.6.32，仓库依赖）
node /tmp/sa2-probe/origin-check.mjs
  → origins: [ 'null', 'Symbol(sessionA)', 'null' ]        （origin 回传/回声抑制根基 ✓）
node /tmp/sa2-probe/yjs-check2.mjs
  → META proj equal after same-value-rewrite: true          （判据 (a) 允许同值重写 → INFO-1）
  → META proj changed after delete-only: true               （删键被拒 ✓）
  → malformed throws on scratch: true                       （畸形字节预演拦截 ✓）
  → hostile subclass slice throws: true / instanceof: true  （MEDIUM-1 实证）
  → new Uint8Array(subclass) ok, ctor Uint8Array            （修法实证）

# 4) 基线事实核验
grep -rn "\.on('update'" packages/*/src --include='*.ts'    → 零命中（INV-S2 事实基础 ✓）
runtime-registry-internal-seam.test.ts:270 十二键锁 / :122 一键锁 + 头注演进先例 → 在案 ✓
test/helpers/registry-seam-audit.ts:51 'packages/namespace-registry/src/' 白名单 → 在案 ✓
packages/namespace-registry/src/index.ts 值导出面（types.ts const 不经 index）→ 核实 ✓
registry-phase5-replication-red.test.ts:662 degraded retry 用例（§13 依据）→ 在案 ✓
```

（以上探针脚本位于 /tmp/sa2-probe/，未触碰 worktree 任何文件；SA2 本轮唯一写入 = 本评审文件。）
