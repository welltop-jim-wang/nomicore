# 设计独立攻击评审 — Issue #226（SA1 design iteration 4 vs 已复核红灯契约 rev1）

- 被审对象：`wiki/raw/task_issue-226_design.md`（SA1 design iteration 4 recovery，331 行）
- 验收基准：`wiki/raw/task_issue-226_red_contract_rev1.md`（SA6 重新固话）+ `wiki/raw/task_issue-226_red_contract_rev1_conflict_recheck.md`（SA8 recheck clear）+ 其落地的两个测试文件（本轮逐行亲读）：
  - `packages/namespace-registry/test/registry-issue-226-red.test.ts`（修订后 13 用例，未跟踪）
  - `apps/yjs-server/test/diagnostic-replay-host-lifecycle-sa7.test.ts`（R3 修订 C1，已跟踪 M）
  - （`packages/namespace-runtime/test/runtime-issue-226-red.test.ts` 已删除——本轮 git status/ls 证实）
- 简报：`wiki/raw/task_issue-226.md`（AC1–AC5）；规范基准：ADR-0011 / ADR-0014（诊断日志版，含 2026-08-28 amendment）/ ADR-0008 / ADR-0009 / ADR-0010 / 根 CONTEXT.md 词条
- 评审方式：**全部独立重验**——不沿用 SA1/SA6/SA8 任何声明；生产锚点亲读（create-diagnostic.ts 全文、registry.ts L750–790/L1215–1240/L1290–1470、types.ts seam、diagnostics.ts 全文、sequencer.ts/runtime.ts emit 接线/close.ts、testing.ts、registry-surface §2.M、#149/#150/sa7-dynamic 测试锚文本）；ADR 条款回查原文；三套件后台 Job 独立重跑
- 边界：零生产代码改动（`src/**`、`apps/**/src/**` 未触碰）；唯一写入 = 本文件
- Worktree：`/home/wangjian/nomicore-fix-issue-226`（branch `mabf/issue-226`，HEAD `45a22f0`）

## Verdict

**approve**（`requiresConflictRecheck: false`）

设计（per-namespace 延迟投递泵 + create-diagnostic 路由改造 + Runtime 零改动 + 生产 wiring 延迟 wrapper）能够使**已复核的 rev1 红灯契约**翻绿，且不破坏 #149/#150/#155 基线与 ADR seam/时序要求。逐锚证明见 §2；基线零漂移证明见 §3；ADR 合规见 §4。非阻断观察项见 §5（移交 SA3）。

## 1. 本轮独立重跑证据（后台 Job，2026-09-06）

| 套件 | 结果 | 与 recheck §3 对照 |
|---|---|---|
| `registry-issue-226-red.test.ts`（修订后契约） | **12 failed \| 1 passed (13)**，Type Errors 0，10.95s；T11 于 NS_SECOND 目录到达 poll 确定性失败 | 一致（12F\|1P；T7 唯一绿） |
| `registry-create-diagnostic-red.test.ts` + `runtime-root-schema-diagnostic-red.test.ts`（#150+#149） | **30 passed (30)**，Type Errors 0 | 一致（零漂移基线在场） |
| `diagnostic-replay-host-lifecycle-sa7.test.ts`（#155 SA7） | **1 failed \| 5 passed (6)**，Type Errors 0（C1 于 L253 `dropsEarly toHaveLength(0)` 红） | 一致（C1 = #226 必红面） |

红灯态与 rev1/recheck 记录完全一致——被审契约的「修复前红」证据真实、可复现。

## 2. 设计 → 修订契约逐锚可实现性（本轮独立证明）

### 2.1 T1–T6（早结局归属）：内容锚 + 到达 poll 全满足

- 8 个建流前发射点（registry.ts L1316/1328/1364/1379/1394/1411/1419/1427——本轮亲读逐一对上）的 record 组装留在捕获点（设计 §3.2），泵只搬运已组装 emission ⇒ 各内容锚逐字段维持。本轮逐一核对锚值与生产分支：T3 `input:{status:'unsafe-input'}`（input-snapshot 分支原文）、T4 `stage:'transaction'/NAMESPACE_CREATE_FAILED/rejected`（DocCreateOperationalError 分支原文——同时是 C1 B 半锚值来源）、T5 `fatal committed:true effect:'update'`（DocCreateFatalError 分支 `fatalFromBytes(cause.committed, encodeDetachedState(...))`）、T6 `stage:'schema-compile'+sourcePhase:'create-document-internal'`（internal fatal 分支原文）、T1 `observedAt===NOW_ISO`（emitOutcome 复用槽内 createdAt / emitEarlyOutcome 单次 clock 读——DC-3 不变）。
- 早结局时候选 ns 必无 stream（initStream 仅在 Persistence 成功后 L1436 出现；duplicate 重试零发射、换新候选 id）⇒ 设计「init-stream(无 genesis) + emit」任务对无伪造成风险；`unattributedDrops===0`：生产形状下共享通道不再接收这些结局。
- `waitNsRecords` poll（1s）容纳 macrotask 级合法延后——vitest `expect.poll` = 真实 timer（vitest.config.ts 无 fake timers），drain（setImmediate check 阶段）必在 poll 间隔内执行。

### 2.2 T7（GREEN 对照）保持绿

成功 create = [init-stream(bytes), emit#17] 两任务同槽背靠背入队、同一次 drain sweep 内顺序执行 ⇒ per-ns FIFO 保持「initStream 先于 emit」次序（#150 DC-2 冻结次序在新载体下仍成立）；poll 到达 1 条记录时 `initStream:<ns>:start` 必已发生；`unattributedDrops===0` 不变；shutdown 不等泵 → 正常结算。T7(b)（#18 fatal）同构：L1436 入队 init-stream、L1463 入队 emit#18。

### 2.3 T8/T9/T10（R1 顺序锚 + 墙钟）：**确定性**可满足（非仅概率）

R1「到达 poll + 顺序」形状下，顺序锚成立是调度论必然，不依赖时运：

- 结算标记（`create:settled`/`shutdown:settled`/`open:settled`）在 `await <业务 Promise>` 续段的**同步语句**内 push（锚文本 L483/L529/L562 亲读）；
- 存储完成标记由测试 Host 在 drain 内 seam 调用栈里同步 push；drain 调度原语是 `setImmediate`——**check 阶段只能在 JS 栈清空后执行**，而标记 push → poll 首次 yield 之间是纯微任务链（本轮核实：测试注入 StubPersistence.saveDoc = resolved promise；ADR-0008 L51 notifyDirty = saveDoc 窄 seam ⇒ 写/结算路径零 macrotask 边界）；
- ⇒ 标记 push 时刻 drain 尚未运行、poll yield 后 drain 必执行 → 顺序断言「结算 < 存储完成」确定成立。墙钟锚（createMs<120/shutdownMs<100/openMs<75）由槽内残余 = O(1) 入队平凡满足。
- T10 专项：open 槽 factory 第三参 = wrapper（O(1)，不现场 `runtimeEmitterFor`）→ ensure（150ms）推迟到首写 emission 的 drain；用例「先 lease 写驱动 + poll ensure:end + 断言 open:settled 在前」与设计 §6(c) trace 逐点吻合。open 本身无 emission（operation 词表无 open）⇒ 无更早的 ensure 触发点，锚稳定。

### 2.4 T12/T13（R2 迁移后）：生产装配全链路注入成立

- 本轮亲证修订契约 T12/T13 的 `makeRegistry` 不覆写 runtimeFactory → 落 registry.ts 装配缺省 `createNamespaceRuntimeForRegistry`（L763–765 一带亲读）+ resolver 产出 emitter——即 #226 修复的实际改动面（wrapper 化点），注入形状与裁决 R2 四要件一致。
- 微任务序独立重建（sequencer.ts `enqueue`：noop hop 先注册于 enqueue 内；runtime.ts 各公共方法 `settled.then(emitSlot)` 后注册；调用方 await 续段最后注册）：w1 槽 settle → noop → **emitSlot(wrapper.emit = O(1) 入队)** → 调用方续段（w1Settled）→ w2 槽 run（不被存储阻塞）→ … → `writes:settled` push——全程微任务，setImmediate drain 无法插入 ⇒ `gap<50` 与「writes:settled < emit:2:start」确定成立。通道序号静态判别成立：#17=1、w1=2、w2=3（per-ns FIFO 序 = 发射序；测试 Host emitCount 按 ns 计数）。
- T13：close barrier 经同一 enqueue 挂队尾，emitSlot_w1（wrapper O(1)）先于 barrier run ⇒ shutdownMs<50；`emit:2:end` 由 drain 迟到产生、poll 到达后「shutdown:settled < emit:2:end」成立；close 自身零 emission（词表无 close 操作）⇒ 序号不受扰。
- 修复前仍红（本轮实测 12F|1P 内含 T12 146ms/T13 墙钟红形态）：pre-fix resolver 在 factory 调用点现场解析，emitSlot 内同步 100ms emit 位于槽间窗口/结算链 → 两锚皆红。红→绿翻转由「槽间窗口内是否同步触碰存储」决定 = #226 隔离语义本体，锚未弱化。

### 2.5 T11（真实 File adapter E2E）：genesis-less 建流机制在位

- Host 侧 `initStream(ns, undefined)` → `ensureAdapter(ns)` 无 genesis bytes 构造（apps/yjs-server/src/diagnostics.ts L84–112 本轮亲读；T11 测试 binding 同形）⇒ 被拒 create 的目录/manifest/current.json 在 drain 内建立；attempt 记录随后落盘。ADR-0014 L22「genesis 未成功写入时 stream 仍可记录诊断事实，但不得声称完整重放」原文覆盖该形态（本轮回查原文）。
- 成功对照半：drain sweep = initStream（adapter 构造期写 genesis seq1）→ emit#17（seq2）——sweep 为单次同步批，poll（current.json 存在）只能观察到 sweep 前后整态，无撕裂读 ⇒ `records≥2`、kinds 含 genesis-baseline+attempt 稳定成立。

### 2.6 C1（#155 SA7，R3）：三组新锚与设计机制逐点吻合

- B 半：DocCreateOperationalError 分支锚值（transaction/NAMESPACE_CREATE_FAILED/rejected）= T4 同一生产分支 ⇒ 内容锚直接成立；B 流经泵以 NS_B 数据键控建立（genesis-less），`namespaces/NS_B/current.json` poll 到达；`readStreamStrict` status ok + 恰 1 attempt（C1b 先例形状——本轮亲读 L325–360 确认 genesis-less 流读取先例在库）。
- `dropsEarly===0`（同步断言）与投递到达时机正交：post-fix 共享通道零流量、drop 事件零产生（只会多不会少的方向安全性成立）。
- A 半干净面：A 的 [init-stream(genesis), emit#17] 同 sweep 完成 ⇒ poll 后同步读到恰 2 条、sequence ['1','2']、segment 无 B marker（per-ns 队列隔离——A/B 不同 ns 不同队列，跨 ns 误归因不可达性反而强化）；A replay complete/issues=[]（genesis+committed update 在场）。
- 结尾 `drops===0` 断言位于 shutdown/close **之前**（L311–313 先于 L318–320）⇒ 迟到 drain 落 `manager-closed` 桩的既设计行为不会污染该锚。

## 3. 基线零漂移证明（#149/#150/#155）

| 基线 | 证明 |
|---|---|
| **#149**（14 用例） | 本轮亲读：全部用例经 `diagnosticEmitter`+`clock` **直注 Runtime 构造**（L183–650 十余处），零 registry 参与 ⇒ 设计「Runtime 零生产改动」下结构性零漂移。AC4 `emitCalls===2` 零 yield 同步锚（L608–639）保持：emitSlot_cb 注册序先于调用方续段（§2.4 微任务序），直注 emitter 同步计数不变 |
| **#150**（16 用例）+ `registry-create-diagnostic-code-source` + `registry-create-diagnostic-sa7-dynamic` | 本轮 grep+亲读：四文件全部 Host **无 `runtimeEmitterFor`**（全 repo 该成员仅 #226 契约与 SA7 两文件使用）⇒ resolver 缺席 → 设计 §3.2 路由表第 2 行 legacy 路径**逐字节现行**：早结局/emitStreamOutcome 走共享 emitter 同步发射、initStream 维持同步调用 ⇒ `waitAttempts`/poll/`flushMicrotasks`+计数稳定锚、sa7-dynamic 的「initStream 返回前同步读回」「停后 create 落 acceptance 记录（公共入口维持同步共享通道）」「shutdown 零 drain」锚全部不动 |
| **#155 其余 5 用例** | C1b/M2/镜像/fatal-unknown = Host/adapter 级直探（不经 registry 时序）零漂移；D8 进程级 E2E 见 §5(a) 观察项（维持绿，非阻断） |

## 4. ADR 合规独立复核（本轮回查原文，非转引）

| 条款 | 裁决 |
|---|---|
| ADR-0014 amendment **L250**（emit 调用点必须在 sequencer slot 之外/释放后） | 合规且**强于现状**：泵把 initStream/ensure/emit 全部移至 macrotask drain（业务槽与槽间窗口之外）。现状 emitSlot 位于「槽 N 释放 → 槽 N+1 启动」微任务窗口、慢 emit 推迟下一槽与调用方结算——恰为 ADR-0011 L129 所禁（「不得延长 write slot」），设计对此的诊断成立 |
| ADR-0014 **L252**（queue/batch 切片四类语义义务） | 不触发：adapter 首「片同步单 record append 语义一字不动，泵只搬调用点（选项 (a)）；泵自身的有界（256/drop-newest/保序）与 close/shutdown（零耦合）语义已在设计内定义，与 SA8 裁决 #1 一致 |
| ADR-0011 **L20/L24**（排队/丢弃/关闭失败不改业务；emitter seam non-throwing 有界非阻塞） | 入队 O(1) 非抛、drain 全程 try 收编、溢出丢弃在「日志允许缺失」授权域（L25「应尽力上报」为 best-effort 措辞——N1 建议维持非阻断） |
| ADR-0011 **L117**（emit 立即接收 detached record、不阻塞不 throw 不返 durability promise） | wrapper `{emit:(r)=>pump.enqueueEmit(ns,r)}` 即 seam 语义本身：立即接收（所有权在组装点转移）、void、非抛；真实 Host emit 延后属接线位置问题，归 L250 管辖而非 L117 |
| ADR-0011 **L123/L127**（不得引入第二个业务排序机构；emitter 不被 await） | 泵只序 per-ns 诊断投递（per-ns FIFO = emission 序 → ADR-0014 L67 sequence 连续性的载体），零业务排序面；全程无 await |
| ADR-0011 **L129** + ADR-0009 **L97–101**（shutdown 不得无限等待 sink；shutdown 公共契约） | 「不清泵、不等待、不注册 disposer」是「不得无限等待」的平凡满足；shutdown 同 Promise/聚合错误/停止接纳零改动；迟到投递收口走 Host 既有 `manager-closed` 词表（diagnostics.ts L74–76/L124 亲读） |
| ADR-0014 **L22/L24**（genesis 诚实缺席）+ **L268**（配置 stream 创建时冻结） | genesis-less 流只记 attempt 事实、不锚 replay complete（N4 边界保持）；延迟建流时 Host 侧配置冻结语义不变（配置非 per-attempt 状态） |
| ADR-0008 **L51** / ADR-0009 **L62**（槽内步骤清单） | 业务步骤全部留槽（含 Runtime construction——factory 第三参仍是槽内 O(1) 调用，只是产物内部为 wrapper）；仅日志工作出槽 |
| ADR-0010 **L28**（id 耗尽 fatal） | §7.1 边界裁决（零诊断发射）维持合理：全部候选已证明属他人，任选归属即伪造；recheck §7 已终裁非冲突 |
| seam 冻结 + 静态守卫 | types.ts 三成员 `{emitter; initStream?; runtimeEmitterFor?}` 零新增（亲读）；wrapper 实现既有 emitter 接口；registry-surface §2.M 三正则逐字符核对——`setTimeout\|setInterval\|clearTimeout\|clearInterval`（裸/globalThis）+ `Date.now(`，**均不含 setImmediate**；注入 scheduler 为纯 timer Map fake（testing.ts L77–110 亲读）⇒ 泵不经其调度、`pending()` 计面零影响；vitest 环境真实 timer、node 恒供 setImmediate（registry 服务端部署面） |

## 5. 非阻断观察项（移交 SA3，不构成 reject 依据）

1. **D8（#155 进程级 E2E）的修复后时序依赖**：verify-write 回复后**无 poll** 同步读流（L604–612），修复后依赖子进程「stdout 回复字节到达测试进程之前，同轮 check 阶段 drain 已完成 append」的轮内次序。分析结论： practically deterministic（回复须经管道跨进程、drain 在子进程同轮 check 阶段完成；测试侧另有 50ms 轮询窗），且停机时泵已空闲 ⇒ 停机后 drops===0 锚不受迟到 drain 影响——维持绿。但这是 #226 修复后唯一不带 poll 保护的跨进程读时序点，登记供 SA3 全量门知悉：若历史性偶发，按「到达 poll 化」处理（属 #155 文件非 C1 用例的微调，需另行小修，不属本设计缺陷）。
2. **R4**（registry-surface §2.M 注释固化 setImmediate 许可）随泵实现落地——与 rev1/recheck 移交一致。
3. **N1**（泵溢出内部丢弃计数，零成本预留）——建议项。
4. **Host 头注释过时**（diagnostics.ts L9–11「全部 initStream 之前的 create emission 落此通道」）——#226 兑现后语义退役，设计 §3.4 已建议顺带更新（文档级）。
5. **SA3 实现纪律**（recheck §8.2 重申，本轮从微任务序独立复核同意）：Registry/Runtime 结算路径不得引入 macrotask 让渡，否则 T8–T13 伪红——设计满足该约束（槽内残余 = O(1) 纯内存）。

## 6. 对设计自身主张的勘误核对

- SA1 §10 的三项冲突主张（C1 顺序锚封闭/C2 与 #149 互斥/C3 冻结缺陷 A）已经 SA8 design-conflict 独立复核成立并由 R1/R2/R3 落地消解；本轮对**修订后**契约的逐锚可实现性证明（§2）即是对「修订集是否足量」的独立收口——未发现残余不可满足锚。
- 设计 §5 T8–T13 行的「不可满足 → 阻断于 R1/R2」表述针对修订前冻结契约，与 rev1 后状态不再对应（历史陈述，非缺陷）；§2–§9 生产架构本体与修订后契约的映射经本轮逐锚验证成立。
- 设计 §1.2 B3 微任务序、§3.1 边界论证、§11 V1–V12 的抽样本轮全部复核属实（含 T6 锚注释引用的 registry.ts 分支行号）。

## 7. 本轮边界

- 零生产代码、零测试/守卫、零 git 操作；测试全部经后台 Job（`bash-9/10/11`）；唯一写入 = 本文件。
- 结构化结果：verdict `approve`、`requiresConflictRecheck: false`；artifactPaths = 本文件 + 被审设计 + 契约 recheck 报告。

Verdict: **approve** — `requiresConflictRecheck: false`
