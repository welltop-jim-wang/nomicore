# Issue #151 设计文档 — trusted replication apply / 复制管理写接入 namespace 诊断变更日志

> SA1（Phase 2 architecture design）。输入：任务简报 `task_trusted-replication-management-diagnostic-change-log.md`、
> SA8 冲突门禁产物（`_conflict_report.md` verdict `clear` + 七条钉死约束；`_relevant_decisions.md`）、
> SA6 红灯契约 `task_trusted-replication-management-diagnostic-change-log_sa6_red.md`
> （15/15 真实红灯，测试文件 `packages/namespace-runtime/test/runtime-replication-diagnostic-red.test.ts`）、
> #149 先例设计 `task_root-schema-diagnostic-change-log_design.md` 及其已落地代码（`diagnostic.ts` 等）。
> 任务类型：feature。基线：`722bddf`（branch `fix/issue-151-on-docs-namespace-diagnostic-change-log`）。

---

## §0. 依赖与范围风险裁决（本设计的首要交付——总控点名要求）

### 0.1 基线事实（实测，非推断）

| 事实 | 证据 |
|---|---|
| 本 worktree（诊断日志谱系，基线 `722bddf`）**无** Phase 5 复制业务层 | `packages/namespace-runtime/src/` 无 `replication-write.ts` / `replication-session.ts`；`NamespaceLease`（`lease.ts:91-131`）无 `openReplicationSession`；SA6 红灯 15/15 以 `enableReplication is not a function` TypeError 失败 |
| Phase 5 复制实现存在于**分叉谱系**，不在本基线祖先链上 | `origin/main` tip = `b66615c`（Phase 5: Hub/Peer WebSocket Y.Doc replication #130），其父是 `b264aae`；本 worktree 基线 `722bddf` 同样以 `b264aae` 为祖先但走诊断日志谱系（#142→#156→#159→#166→#167）。`git merge-base HEAD b66615c` = `b264aae`——**两谱系已分叉** |
| 主线复制实现的「既有稳定形状」可逐字取得 | `git show b66615c:packages/namespace-runtime/src/replication-write.ts`（440 行，E1–E7 槽序）、`replication-session.ts`（889 行，open 门序 + apply 槽 R1–R7 + 受保护字段检查）、`packages/namespace-registry/src/lease.ts`（openReplicationSession 编排）、`errors.ts`（REPLICATION_* / NSRT-FATAL-REPLICATION-* 稳定码注册表）——SA6 红灯报告「契约来源与既有形状选取」节点名这些文件为形状锚 |
| 诊断接线基础设施（#149 产物）已在本基线 | `diagnostic.ts`（DiagnosticEnv / SlotDiag / emitAttempt / emitSlot / 结局 helpers）、`runtime.ts` seam 的 `diagnosticEmitter`+`clock` 成对字段、`write.ts` 的 S5 捕获窗口模式——#151 直接复用 |

### 0.2 裁决 R-1：不跨谱系依赖，在本 worktree 物化最小复制业务面

**否决的备选**：
- **(a) merge / cherry-pick `b66615c`**——否决。两谱系在 `b264aae` 分叉后各自演进了同名核心文件（主线 `write.ts` 无诊断接线、本基线 `write.ts` 有 #149 接线；主线 `runtime.ts` 十二键无 diagEnv、本基线十键有 diagEnv），文本冲突覆盖 `runtime.ts`/`write.ts`/`errors.ts`/`lease.ts` 全部接线对象；且会把 889 行 session 文件中的 outbound fanout/transport 机械整体拖入本票——SA8 盘点注记 3 明文「replication 业务实现属其交付票」。
- **(b) 只写诊断接线、等 Phase 5 交付票提供操作面**——否决。验收契约（SA6 15 用例）在操作面缺席时**结构性不可验证**（每用例在首个操作调用处 TypeError）；总控指令明文要求「只设计能在本 worktree 基线完成**并令验收契约可验证**的方案」。

**采纳**：在本 worktree 以主线 `b66615c` 定义处的形状/槽序/稳定码为「既有」锚，**物化验收契约消费面 + 诚实业务语义的最小闭包**（范围见 R-2），随后在其上接线诊断发射（本票的真正交付物）。物化代码的每一处与主线的偏差都必须是本设计显式裁决（R-3）或记录局限（§12），禁止静默漂移。

### 0.3 裁决 R-2：物化范围的最小闭包（进 / 不进）

**物化（≈1,100 行生产代码）**：

| 部件 | 来源 | 理由 |
|---|---|---|
| `replication-write.ts`：`enableReplication` / `bumpReplicationEpoch` 两写槽（E1–E7 槽序、INV-R1/R2/R3/R4/R7/R9、`readReplicationFacts` 读取器、E3 单读捕获 + 全探测收编） | 主线逐字端口（适配本基线 diag 接线） | AC1/AC2/AC3 的 enable/bump 全部 4 个用例 + AC4 两用例的直接消费面；META 两键原子安装/幂等/epoch 单调是「受控 identity context」的事实源 |
| `replication-session.ts`：会话核心（WeakMap host 登记、open 门序、apply 槽 R1–R7 + txStarted 二分探针、受保护字段 scratch 预演、终态机 open→closed/conflicted、epoch fence、Runtime close 终止） | 主线端口，**剥离 fanout**（见不物化） | AC1/AC2/AC3/AC5 的 apply 全部 8 个用例的直接消费面；R4 scratch 预演是 `REPLICATION_RAW_UPDATE_INVALID` 的既有判定通道（测试用例「raw update 损坏」经它拒绝） |
| `lease.openReplicationSession` 薄通道（released 门 + 输入形状校验 + 委托 runtime 会话核心） | 主线 lease.ts 的 ①②⑤⑥ 步，**剥离 ③角色门/④会话计数**（见 R-3.3 与 §12） | apply 用例经真实 Registry 链（create→lease→session）装配；lease 是 SA6 契约点名的会话入口 |
| `runtime` 公共面第十一/十二键 `enableReplication` / `bumpReplicationEpoch` | 主线同位（runtime.ts D2 十二键注释） | SA6 契约直呼 `runtime.enableReplication/bumpReplicationEpoch`；与 ROOT/SCHEMA 写共享唯一 WriteSequencer（INV-S1，AC4 槽序断言的结构基础） |
| `errors.ts` 复制稳定码族（REPLICATION_INPUT_INVALID / REPLICATION_NOT_ENABLED / REPLICATION_META_ABSENT / REPLICATION_EPOCH_OVERFLOW / REPLICATION_EPOCH_CONFLICTED / REPLICATION_SESSION_CLOSED / REPLICATION_RAW_UPDATE_INVALID / REPLICATION_PROTECTED_FIELDS_CHANGED / REPLICATION_SESSION_UNSUPPORTED / REPLICATION_SESSION_INPUT_INVALID / NSRT-FATAL-REPLICATION-WRITE-INTERNAL / NSRT-FATAL-REPLICATION-APPLY-INTERNAL + ReplicationMetaCorruptError / ReplicationSessionClosedError） | 主线 errors.ts 逐字（含 message 文案） | SA8 钉死 #3「stage/code/issues/committed 全部取自 replication 模块既有结果通道（以其定义处 append-only 注册表为准），零改 message」——本 worktree 创建该注册表时以主线原值为准，跨谱系单一注册表 |
| `write.ts` 的 `WriteSlot` 扩展（`'replication' | 'replication-apply'` 分支进 `markWriteFatal` / `writeFatalMessage` / `rejectWithWriteFatal`） | 主线同款扩展 | fatal 摘要稳定码分槽（status.fatal 诊断不失真）；既有 'root'/'schema' 分支逐字节不变 |

**不物化（→ §12 记录局限）**：outbound 扇出全套（`createSessionFanout` / SessionChannel / 微任务泵 / `subscribeOwnedUpdates` / `encodeStateVector` / `encodeDiff`）、lease 侧 hub-only 角色门与 `drawReplicationId`、每 Lease 活跃 session 计数 + `wrapCore` revoked 通道、公共 `getStatus().replication` 域、`beginResetFence`。理由：验收契约零消费；outbound 复制与 host 编排属 Phase 5 谱系交付票；物化它们只会扩大公共面爆炸半径。

### 0.4 裁决 R-3：三处契约驱动的业务行为仲裁（相对主线，全部显式）

| # | 仲裁点 | 主线行为 | 本设计行为 | 依据 |
|---|---|---|---|---|
| R-3.1 | **noop apply 的 notifyDirty** | R6 无条件 `await notifyDirty()` | **R5 捕获窗口零字节（零集成）⇒ 跳过 R6**，直接 `{ok:true}` | SA6 契约 AC3 用例「零写入零 dirty」断言 `saveCalls` 不变；ADR-0006「saveDoc 是 **mutation 后**的 dirty notification」+ 主线自身 INV-R3「零写入路径零通知」同向——主线 apply 槽对空 update 的无条件通知是其谱系内未覆盖场景，本契约裁回 INV-R3 原则。判定判据精确：捕获窗口有字节 ⟺ 本次 apply 在 CRDT 层产生了集成（会触发 dirty）；无字节 ⟺ 零集成零通知 |
| R-3.2 | **apply fatal 码字面量** | 常量名 `FATAL_REPLICATION_APPLY_WRITE_INTERNAL_CODE`，**值** `'NSRT-FATAL-REPLICATION-APPLY-INTERNAL'`（errors.ts:184） | 值取主线原值 `'NSRT-FATAL-REPLICATION-APPLY-INTERNAL'` | SA6 红灯两处断言 `'NSRT-FATAL-REPLICATION-APPLY-WRITE-INTERNAL'` 系从**常量名**转录的笔误（值从未存在于任何谱系）；SA6 报告注记 2 已预留「按合并后既有形状修订（红线不变，形状字段按设计仲裁）」协议——**SA6 需按其注记 2 修订测试文件两处字面量**（断言语义不变）。两谱系为同一 fatal 族维持单一 append-only 注册表是 SA8 钉死 #3 的目的本身 |
| R-3.3 | **lease.openReplicationSession 的角色门** | 实例静态 `role` 门：`localRole ≠ role` → `REPLICATION_ROLE_MISMATCH`；且 lease 侧 enable/bump 有 hub-only 门 | **方向无关薄通道**：localRole ∈ {hub, peer} 均可开（仅做 released 门 + 输入形状校验 + 委托） | 验收契约结构性要求：AC1/AC5 双方向用例在**同一** `createNamespaceRegistryForTesting` fixture（无 role 配置）上分别以 `localRole:'peer'` 与 `'hub'` 开 session。实例角色编排（role 注入、hub-only 管理写、drawReplicationId）是 Phase 5 host 装配关切，本 worktree registry 无 role 概念——强加默认 role 会击杀一半验收用例 |

---

## §1. 需求推演（Feature：三条 operation 接入诊断日志）

需求本质：把 ADR-0011 覆盖范围清单的最后两项（「trusted replication raw update apply」「写入复制身份或提升 epoch 等 replication management 操作」）词表化为三条 operation 的语义 emission，且：

1. **词表零新造**（SA8 钉死 #3）：`replication-apply` / `replication-enable` / `replication-epoch-bump` 已在 v1 封闭词表（`vocabulary.ts:17-19`）；source 双向字面量、context 四可选键、结局六分支、阶段八值全部冻结（`vocabulary.ts:23-46`）——本设计是纯消费方。
2. **既有结局保真**（AC2）：identity/epoch/capability/validation/transaction/dirty-notification/committed-aware fatal 七类结局的 stage/code/issues/committed 全部取自物化业务面的既有结果通道（§0.2 的稳定码族），日志层零改写。
3. **owned bytes 走事务 seam**（SA8 钉死 #1）：捕获点在 E5 `doc.transact` / R5 `Y.applyUpdate` 的订阅窗口内（#149 D-B 先例），禁止事务后全文档编码冒充。
4. **接线纪律**（SA8 钉死 #2）：emit 挂点在 write sequencer slot 释放之后（#149 §7.1 微任务序证明直接复用）；emit 不被 await、不延长槽、notifyDirty 槽序不动。
5. **业务隔离**（AC4/SA8 钉死 #5）：emitter 违约/队列满零业务影响——#149 的 emitAttempt 全吞没机械原样复用。

**最佳切入点**：#149 已把「公共方法 → sequencer slot → `.then(emitSlot)`」的接线骨架、per-attempt 收集器（SlotDiag）与捕获窗口模式全部落地并为 ROOT/SCHEMA 两 operation 验证。#151 的增量 = ①物化复制业务面（§0.2）②把骨架扩展到两个新公共键与一个会话面③emitAttempt 支持受控 source/context/sourceModule（现在硬编码 `{kind:'local'}` / `'runtime'`）④三条 operation 的完整结局映射表（§9）。

---

## §2. 设计总览

```
                    ┌─ runtime 公共面（十二键：+enableReplication +bumpReplicationEpoch）
调用方 ──enable/bump─┤   lifecycle≠ready → 同步 emit(acceptance, RUNTIME_WRITE_DISABLED, rejected, not-accessed)
                    │        │ ready
                    │        ▼
                    │   sequencer.enqueue(runEnableReplicationSlot / runBumpReplicationEpochSlot)
                    │        │ E1 fatal gate ──────────▶ diag: capability-gate / RUNTIME_WRITE_DISABLED
                    │        │ E2 writable+notifier ───▶ diag: capability-gate（fatal→NSRT-FATAL-REPLICATION-WRITE-INTERNAL）
                    │        │ E3 输入校验（enable）────▶ diag: validation / REPLICATION_INPUT_INVALID
                    │        │ E4 readReplicationFacts ─▶ diag: 幂等 noop（零结局写入）/ corrupt→fatal
                    │        │ E5 doc.transact（update 捕获窗口）
                    │        │ E5.5 state.replication 整替 + (bump) fence 旧 session
                    │        │ E6 await notifyDirty ───▶ diag: dirty-notification fatal
                    │        ▼
                    │   settled ──.then(emitSlot)──▶ emit（source {kind:'local'} + context {replicationId, replicationEpoch}）
                    │
lease ──openReplicationSession({localRole, remoteInstanceId})──▶ runtime 会话核心（WeakMap host）
                    │   released 门 / 输入形状门（registry 侧，零 emit——open 不是变更尝试）
                    ▼
ReplicationSession.applyRemoteUpdate(update)
    A1 终态 closed ──────▶ 同步 emit(acceptance, REPLICATION_SESSION_CLOSED, rejected, not-accessed)
    A1 终态 conflicted ──▶ 同步 emit(identity, REPLICATION_EPOCH_CONFLICTED, rejected, not-accessed)
    A2 形状/拷贝 ────────▶ 同步 emit(validation, REPLICATION_RAW_UPDATE_INVALID, rejected)
    A3 lifecycle≠ready ──▶ 同步 emit(acceptance, RUNTIME_WRITE_DISABLED, rejected, not-accessed)
    A4 入队（与 ROOT/SCHEMA/enable/bump 同一 sequencer，INV-S1）
        R1 fatal gate ───▶ diag: capability-gate / RUNTIME_WRITE_DISABLED
        R2 身份/epoch ────▶ diag: identity / REPLICATION_EPOCH_CONFLICTED（被动 fence）
        R3 writable+notifier（含 degraded bypass）▶ diag: capability-gate / fatal(NSRT-FATAL-REPLICATION-APPLY-INTERNAL)
        R4 scratch 预演 ──▶ diag: validation / REPLICATION_RAW_UPDATE_INVALID | REPLICATION_PROTECTED_FIELDS_CHANGED
        R5 Y.applyUpdate(doc, bytes, origin)（update 捕获窗口 + beforeTransaction 二分探针）
        R5.5 session 标记（rootValidation / memoryCaughtUp）
        R6 捕获窗口有字节 ⇒ await notifyDirty ──▶ diag: dirty-notification fatal(committed:true + 精确 bytes)
           捕获窗口零字节 ⇒ 跳过（R-3.1 仲裁：零写入零 dirty）
        ▼
    settled ──.then(emitSlot)──▶ emit（source {kind:'replication', direction, remoteInstanceId}
                                    + context {replicationId, replicationEpoch(会话冻结值)}）
                                    slot 内零结局写入 + 业务 ok:true ⇒ INV-DIAG 缺省组装：
                                    bytes→committed+update / 零字节→committed+noop
                                    （fatal rejection 路径槽内已显式写入结局）
```

九个结构性决策：

- **D-1（范围）**：§0.2/§0.3——物化最小闭包，形状锚定主线 `b66615c` 定义处。
- **D-2（公共面）**：`enableReplication` / `bumpReplicationEpoch` 为 runtime 第十一/十二键（主线同位），与既有八键共享唯一 WriteSequencer；seam（`diagnosticEmitter`+`clock`）零新增字段——host 经构造栈一次成型并以模块级 WeakMap 登记（主线 registerReplicationHost 同款：以 runtime 对象引用为键，零属性污染）。
- **D-3（会话核心）**：新文件 `replication-session.ts`（本 worktree 最小版）——open 门序（host 缺席→lifecycle→fatal→disabled）+ apply 槽 R1–R7 + close 幂等 barrier + 主动/被动 epoch fence + Runtime close 同步终止；**无 outbound fanout**（§12-L1）。会话冻结四域（localRole/remoteInstanceId/replicationId/replicationEpoch）+ `applyRemoteUpdate`/`getStatus`/`close` 恰合 SA6 契约消费子集。
- **D-4（lease 通道）**：`openReplicationSession` = released 门 + 输入形状校验（单读捕获 + 全探测 try/catch，`INSTANCE_ID_PATTERN = /^[a-z][a-z0-9-]{0,62}$/` 本地常量）+ 委托 `openReplicationSessionCoreForRegistry`（经 `@nomicore/namespace-runtime/internal` 第二值导出，主线同款）；**方向无关**（R-3.3）、无每-lease 会话计数（§12-L3）。open 本身**零 emit**（不是变更尝试——ADR-0011 排除面；AC5 用例断言 open/getStatus/close 零 emission）。
- **D-5（发射层）**：复用 #149 全部机械（SlotDiag 收集器 / emitSlot 槽后挂点 / emitAttempt 全吞没 / INV-DIAG 缺省组装仅对业务 ok:true 生效）；`diagnostic.ts` **四点**向后兼容扩展（【R1，SA2 #1】第四点新增）——`emitAttempt` 接受可选 `source`（缺省 `{kind:'local'}`）、可选 `context`（缺省省略）、可选 `sourceModule`（缺省 `'runtime'`，与 code 成对）、**可选 `input`（`SlotEmissionArgs.input`/`SlotDiag.input` 可选化 + 条件展开；省略 → record 面 `{capture:'none'}`，apply/bump 槽路径专用；ROOT/SCHEMA 恒传值不变，§7）**。既有 ROOT/SCHEMA 调用点零改动。
- **D-6（owned bytes）**：三处订阅窗口（enable/bump 的 E5 `doc.transact`、apply 的 R5 `Y.applyUpdate`）——单赋值 handler + try/finally 退订，#149 §6 模式逐位复用；实证依据见 §16（含「真增量对空 doc 不物化」「空 diff 零事件」两项关键行为）。
- **D-7（identity context 落点）**：全部走 per-record `context`（enable/bump：E4 之后各结局点携带 `{replicationId, replicationEpoch}` 事实；apply：恒携带会话冻结 `{replicationId, replicationEpoch}`——闭包常量零额外读取）；E4 之前的 gate 拒绝与 enable 的 validation 拒绝省略 context（零额外读取纪律，ADR-0011 §E）。不进 manifest、不作 stream 分代依据（SA8 钉死 #6）。
- **D-8（input 捕获）**：enable——E3 单读捕获的字符串为快照 `{snapshot:{replicationId: captured}}`，探测 throw → `{status:'unsafe-input'}`，E3 前 gate 拒绝 → `{status:'not-accessed'}`；bump——无调用方输入，省略 `input` 字段（policy `none`）；apply——A 层拒绝（未触输入）→ `{status:'not-accessed'}`（AC2 用例锚点），A2 形状拒绝 → `{status:'unavailable'}`，一切槽内路径（R1–R7）**省略 input**：raw update bytes 非 plain-data、不得作 snapshot（ADR-0011 §E 数据保护「未经控制的 transport payload」），committed 效果已由 `result.updateBytes` 权威表达（ADR-0011 §D「结构化 input 只表达请求意图」——apply 的意图由 source+context 完整表达）。
- **D-9（sourceModule）**：按**码的注册表来源**标注——`RUNTIME_WRITE_DISABLED`（runtime `write.ts disabled()` 复用）→ `'runtime'`；`REPLICATION_*` 与 `NSRT-FATAL-REPLICATION-*`（本票 errors.ts 复制注册表）→ `'replication'`。与 code 恒成对（pipeline §10-J3 会丢弃单侧字段）。

---

## §3. 业务隔离总纲（AC4 的结构保证——#149 四道防线全复用）

| 防线 | 机制（与 #149 §3 逐字同构，新增点标注） |
|---|---|
| emit 不改变返回值 | 三条 operation 的 emit 全部在 `settled.then(onOk,onErr)` 回调内（槽后）或公共入口同步段（acceptance 拒绝）；emitAttempt 自身 try/catch 全吞（`diagnostic.ts:123-144` 既有实现零改动） |
| emit 不延长 slot | emit 时点 = settled promise 微任务回调，slot 已终止（ADR-0012 amendment C；#149 §7.1 证明对 enable/bump/apply 三挂点逐字成立——同一 sequencer、同一 `.then` 注册次序） |
| emit 不改变 FIFO | enable/bump/apply 与 ROOT/SCHEMA 共享同一 sequencer 实例（INV-S1）；emit 回调注册晚于 sequencer 内部 `tail.then(noop)`、早于下一任务 thunk 排程——emit 顺序 ≡ 槽完成顺序 ≡ FIFO（AC4 用例「enable→bump FIFO：epoch 2 在 id 安装之后」的结构基础） |
| emit 不改变 capability | emit 路径零接触 `state.fatal`/`state.lifecycle`/handle/sequencer；敌意 emitter（AC4 用例 makeHostileEmitter）、队列满（capacity:1，drop 在 adapter 内）全部隔离；新增的 host/WeakMap/会话终态机不在 emit 路径上 |

补充隔离（本票特有面）：**诊断装配不改变无日志基线**——`diagEnv.emitter === undefined` 时 enable/bump/apply 槽体所有 `diag` 写入为可选链 no-op、emit 挂点零效果（#149 D-C 同款行为等价声明）。**【R2 修订，SA4 F1——窗口订阅的分化措辞】update 订阅窗口在两槽面分化**：enable/bump 的 E5 窗口是纯诊断附件（未装配 ⇒ 零订阅，行为等价）；**apply 的 R5 窗口是 R-3.1 业务判据载体，必须无条件挂接**（与 beforeTransaction 二分探针同待遇——探针承载 committed 二分业务事实，本就无条件）——无诊断基线下 `capturedUpdate !== undefined` 同构判定 R6 的 notifyDirty 门控，仅 `diag.updateBytes = capturedUpdate` 赋值保持 diag 条件。**禁止任何后续轮次把 apply 窗口退化为 diag 条件**（该退化使无日志基线的一切成功 apply 静默跳过持久化——ADR-0006 唯一持久化触发器被悬空，SA4 F1 P0 已证）；**会话面零日志副作用**——open/getStatus/close 无任何 emission 接线（AC5 用例 `emissions.length === 2` 断言锚点）。

---

## §4. 物化层 I：`packages/namespace-runtime/src/replication-write.ts`（enable/bump 两写槽）

主线 `b66615c:replication-write.ts` 逐字端口 + 三类适配（diag 接线 / 无 fanout 的 E5.5' / capture 窗口）。槽序 E1–E7 与不变量逐位保留：

```
E1  fatal gate（零输入访问）                          → diag: capability-gate / RUNTIME_WRITE_DISABLED
E2  writable gate + notifier 绑定（共享 gate，主线    → diag: capability-gate / RUNTIME_WRITE_DISABLED
    runReplicationWriteGate 私有 helper 原样端口）       或 fatal(NSRT-FATAL-REPLICATION-WRITE-INTERNAL,
                                                        phase=write-slot-internal, committed:false)
E3  输入校验（enable 专属；bump 无输入）              → diag: validation / REPLICATION_INPUT_INVALID
                                                        input: snapshot(捕获串) | unsafe-input(探测 throw)
E4  领域事实读取（readReplicationFacts 四出口）        → disabled+幂等 → return {ok:true}（零结局写入：
                                                        INV-DIAG 缺省组装 noop）；corrupt → fatal
                                                        (capability-gate / NSRT-FATAL-REPLICATION-WRITE-INTERNAL,
                                                        phase=write-slot-internal, committed:false)；
                                                        META 载体缺席 → validation / REPLICATION_META_ABSENT
E5  单 Yjs transaction（唯一 Y.Doc 写入口；两键同      → [捕获窗口]（D-6）
    事务原子安装；enable 幂等分支零事务）                  throw → fatal(transaction / …, committed:true 保守,
                                                        phase=unknown-pipeline-throw, bytes)
E5.5 复制事实同步整替（state.replication 整替）        → （投影步，无独立结局）
E5.5'（仅 bump）主动 fence：对 host 会话集合中冻结      → （无 fanout——经 host.sessions 实现，见 §5.4）
     (replicationId, replicationEpoch) 与新值不等者
     finalize('conflicted')
E6  同槽 await notifyDirty                            → throw → fatal(dirty-notification / …,
                                                        committed:true, phase=notify-dirty-failed, bytes)
E7  槽释放（promise settle）
```

**与主线的差异清单（全部显式）**：
1. `ReplicationWriteEnv` 去掉 `fanout: SessionFanout` 字段，改为 `sessions: SessionRegistry`（§5.4 的极简会话登记接口——`fenceStale(id, epoch)` 一个方法）；bump E5.5' 调用点与语义（nextEpoch 为全新值 ⇒ 全部现存 session 被 fence；**enable 槽不 fence**——主线显式裁决原样保留）不变。
2. 每个结局点插入一行 diag 写入（§9 映射表）；E5 加捕获窗口。
3. `markWriteFatal` / `writeFatalMessage` / `rejectWithWriteFatal` 经 `write.ts` 的 `WriteSlot` 扩展消费（§6.3），调用形状与主线逐字相同。

**保留的关键既有语义**（SA3 不得「优化」）：INV-R1（replicationId 一经安装永不被改写——enable 幂等零写、bump 只写 epoch）；INV-R2（两键只经本槽成对变更）；INV-R4（epoch 判据先于任何 +1，MAX_SAFE_INTEGER 拒绝不回绕）；INV-R9（E3 单读捕获 + 格式门 + 读取器结构守卫三重）；幂等 enable 弃用调用方传入 id（决策单点在槽内）；E5 事务 throw 保守 committed:true。

---

## §5. 物化层 II：`packages/namespace-runtime/src/replication-session.ts`（最小会话核心）

### 5.1 host 与登记（主线 §4.1 同款）

```ts
export interface RuntimeReplicationHost {
  readonly doc: Y.Doc;
  readonly handle: DocHandle;
  readonly state: RuntimeState;          // 复制域 state.replication（内部投影，不进公共 status——§12-L4）
  readonly sequencer: WriteSequencer;    // 与 ROOT/SCHEMA/enable/bump 同一实例（INV-S1）
  readonly notifyDirty: (() => Promise<void>) | undefined;
  readonly diagEnv: DiagnosticEnv;       // 【本票新增】会话 apply 的发射环境（构造栈一次成型）
  readonly sessions: SessionRegistry;    // 【替代主线 fanout】极简会话登记（attach/detach/fenceAll/terminateAll）
}
const replicationHosts = new WeakMap<NamespaceRuntime, RuntimeReplicationHost>();
export function registerReplicationHost(runtime, host) { replicationHosts.set(runtime, host); }
```

`SessionRegistry`（本票新概念，~40 行）：`Set<{ replicationId; replicationEpoch; finalize(terminal, cause?) }>` + `fenceStale(id, epoch)`（不等者 finalize('conflicted')——bump E5.5' 消费）+ `terminateAll('runtime-close')`（Runtime close 同步段消费）+ attach/detach。迭代删除限于当前被访元素（主线 R2.1 冻结纪律同款）。

### 5.2 open 门序（主线 openReplicationSessionCoreForRegistry 逐字，零 schemaState gate）

host 缺席 → `REPLICATION_SESSION_UNSUPPORTED`（测试替身 Runtime 显式能力缺席拒绝）→ lifecycle≠ready → `RUNTIME_WRITE_DISABLED` → fatal 已置位 → `RUNTIME_WRITE_DISABLED` → facts disabled → `REPLICATION_NOT_ENABLED` → 冻结 facts 建 core。open **零 emit**（非变更尝试）。

### 5.3 会话 core 与 apply 槽 R1–R7

冻结四域 + 三能力（applyRemoteUpdate / getStatus / close；**无** encodeStateVector / encodeDiff / subscribeOwnedUpdates——§12-L1）。终态机 open → closed（显式 close / Runtime close）| conflicted（epoch fence，终态不降级、幂等）。close = 幂等 same-promise + 恒绿空槽体 barrier（主线 INV-S11 逐字）。

apply 槽（主线 R1–R7 逐位端口 + R-3.1 仲裁 + diag 接线）：

```
A 层（会话方法同步段，未入队——镜像 D5.1 接纳门）：
A1 终态 closed(explicit) → refused + 同步 emit(acceptance, REPLICATION_SESSION_CLOSED, rejected, not-accessed)
A1 终态 conflicted       → refused + 同步 emit(identity, REPLICATION_EPOCH_CONFLICTED, rejected, not-accessed)
A1 终态 closed(runtime-close) → refused + 同步 emit(acceptance, RUNTIME_WRITE_DISABLED, rejected, not-accessed)
A2 非 Uint8Array / new Uint8Array(update) throw（陷阱安全拷贝，绝不用 slice()）
                         → refused + 同步 emit(validation, REPLICATION_RAW_UPDATE_INVALID, rejected, input=unavailable)
A3 lifecycle≠ready       → refused + 同步 emit(acceptance, RUNTIME_WRITE_DISABLED, rejected, not-accessed)
A4 host.sequencer.enqueue(runSessionApplySlot) —— INV-S1

R1 fatal gate            → diag: capability-gate / RUNTIME_WRITE_DISABLED / rejected
R2 身份/epoch gate（事实源 = state.replication 投影链单点，不读 live META）
   不等 → 被动 fence（同一 finalize）→ diag: identity / REPLICATION_EPOCH_CONFLICTED / rejected
R3 writable gate（getStatus throw → markWriteFatal + throw RuntimeWriteFatalError('write-slot-internal', false)
   + diag: capability-gate / fatal(NSRT-FATAL-REPLICATION-APPLY-INTERNAL, sourcePhase=write-slot-internal)）
   非 ready → degraded bypass 五条件合取（lifecycle ready ∧ fatal 未置位 ∧ direction 已冻结 ∧
   status==='persistence-degraded' ∧ notifier 已绑定 ∧ direction==='hub-to-peer'）——主线 O-1 逐字；
   不满足 → diag: capability-gate / RUNTIME_WRITE_DISABLED / rejected
   notifier 未绑定 → 同上拒绝
R4 受保护字段 scratch 预演（主线 protectedContentEvaluated 逐字端口：scratch 全量装载 + applyUpdate +
   内容投影相等判据；hub: SCHEMA+META 全保护，peer: META 全保护）
   invalid → diag: validation / REPLICATION_RAW_UPDATE_INVALID / rejected
   changed → diag: validation / REPLICATION_PROTECTED_FIELDS_CHANGED / rejected
R5 Y.applyUpdate(doc, bytes, applyOrigin symbol)——唯一 live Y.Doc 写入口
   [捕获窗口 + beforeTransaction 二分探针]（txStarted=false ⟺ committed:false；true ⟹ 保守 committed:true）
   throw → diag: transaction / fatal(NSRT-FATAL-REPLICATION-APPLY-INTERNAL, phase=txStarted?'unknown-pipeline-throw':…,
   committed=txStarted, bytes=捕获值)
R5.5 session 标记（rootValidation='replication-unvalidated' 置位永不清除；memoryCaughtUp=true 不回落）
R6 捕获窗口有字节 ⇒ await notifyDirty（throw → markWriteFatal + throw RuntimeWriteFatalError
   ('notify-dirty-failed', true) + diag: dirty-notification / fatal(NSRT-FATAL-REPLICATION-APPLY-INTERNAL,
   sourcePhase=notify-dirty-failed, committed:true, bytes)）
   捕获窗口零字节 ⇒ 跳过（R-3.1——零写入零 dirty），return {ok:true}
R7 槽释放；settled.then(emitSlot)——slot 内零结局写入 + ok:true ⇒ INV-DIAG 缺省组装
   （bytes → committed+update；零字节 → committed+noop）
```

 getStatus（每次全新深冻结对象）：`{ state, closedBy?, localRole, direction, remoteInstanceId, replicationId, replicationEpoch, currentEpoch, rootValidation, durability:{memoryCaughtUp, diskCaughtUp:false} }`——主线形状减去扇出域（observerFailures / needsResync，§12-L1）。direction 派生冻结：`localRole==='peer' ⇔ 'hub-to-peer'`（主线同款）。

### 5.4 fence 与 Runtime close 联动

- **主动 fence**（bump E5.5'）：`sessions.fenceStale(facts.replicationId, nextEpoch)`——nextEpoch 全新 ⇒ 全部冻结旧 epoch 的 session → conflicted 终态（AC2 用例「fence 后 apply」：session 在 bump 后被主动 fence，后续 apply 在 A1 以 `REPLICATION_EPOCH_CONFLICTED` 拒绝并记 stage `identity`——与被动 R2 同码同 stage，观测面等价）。
- **被动 fence**（apply R2）：事实投影不等 → finalize('conflicted') + 拒绝。
- **Runtime close**（runtime.ts close() 同步段，主线 R2-2 时序）：`state.lifecycle='closing'` 之后、barrier enqueue 之前 `sessions.terminateAll('runtime-close')`（conflicted 不降级；已接纳 apply 槽照常排空——FIFO barrier 语义保证）。close.ts barrier 本体**零改动**。

---

## §6. 物化层 III：runtime 公共面 / write.ts 扩展 / lease-registry 通道

### 6.1 `runtime.ts`（十键 → 十二键）

- `NamespaceRuntime` 接口 + 两成员（主线 runtime.ts:150/155 签名逐字）：`enableReplication(input) => Promise<{ok:true}|{ok:false;issues:unknown[]}>`、`bumpReplicationEpoch() => …`。
- 构造序增量（全部入队前、INV-N14 纪律）：
  - **V2.5 复制事实预投影**：`state.replication = readReplicationFacts(doc)`——损坏 → 构造 throw 零副作用（主线同款；预启用文档从 t=0 起诚实，无「preparing 期谎报 disabled」窗口）；
  - **V3c'''''** `replicationWriteEnv` / `replicationHost` 一次成型（doc/handle/state/notifyDirty/diagEnv/sequencer/sessions 同批捕获局部量）；
  - **V3f** `registerReplicationHost(frozen, host)`——WeakMap 以对象引用为键，零可枚举属性污染（`Object.keys(runtime)` 恰十二键）。
- 两公共方法体（镜像 mutateRoot 的接纳门 + emit 挂点形态）：

```ts
enableReplication: (input: EnableReplicationInput): Promise<EnableReplicationResult> => {
  if (state.lifecycle !== 'ready') {
    const result = disabled(lifecycleWriteRefusal(state.lifecycle));
    if (result.ok === false) {
      emitAttempt(diagEnv, { operation: 'replication-enable', stage: 'acceptance',
        result: { kind: 'rejected' }, code: RUNTIME_WRITE_DISABLED_CODE, sourceModule: 'runtime',
        input: { status: 'not-accessed' }, issues: result.issues as DiagnosticIssue[] });
    }
    return Promise.resolve(result);
  }
  const diag = diagEnv.emitter !== undefined ? createSlotDiag('replication-enable') : undefined;
  const settled = sequencer.enqueue(() => runEnableReplicationSlot(replicationWriteEnv, input, diag));
  void settled.then(
    (r) => { emitSlot(diagEnv, diag, { kind: 'fulfilled', value: r }); },
    (e) => { emitSlot(diagEnv, diag, { kind: 'rejected' }); },
  );
  return settled;
},
// bumpReplicationEpoch 同构（operation 'replication-epoch-bump'；thunk 无 input）
```

- `close()` 同步段插入 `sessions.terminateAll('runtime-close')`（§5.4）；barrier 链零改动。

### 6.2 `p0.ts`

`RuntimeState` 增一可选域 `replication?: NamespaceRuntimeReplicationStatus`（内部投影，V2.5/E5.5 两写入点；**不进 buildStatus**——公共 status 七键不变，§12-L4）。

### 6.3 `write.ts` / `errors.ts`

- `WriteSlot = 'root' | 'schema' | 'replication' | 'replication-apply'`；`markWriteFatal` / `writeFatalMessage` / `rejectWithWriteFatal` 增两分支（主线逐字：'replication' → NSRT-FATAL-REPLICATION-WRITE-INTERNAL / 「REPLICATION write」；'replication-apply' → NSRT-FATAL-REPLICATION-APPLY-INTERNAL / 「REPLICATION apply」）；既有 'root'/'schema' 渲染逐字节不变（runtime-write-fatal-message-rev1.test.ts 子串锚全保留）。
- `errors.ts` 增 §0.2 所列复制稳定码族 + `ReplicationMetaCorruptError` / `ReplicationSessionClosedError` / `RuntimeWriteFatalPhase` 不变（'write-slot-internal'/'notify-dirty-failed'/'unknown-pipeline-throw' 既有三值已覆盖）——全部主线原值原文案。

### 6.4 `internal.ts`

值导出 `openReplicationSessionCoreForRegistry`（+ 会话类型 re-export）——主线同款第二值导出；package.json exports 键集 `['.', './internal']` 不变；import 图审计谓词（`packages/namespace-registry/src/` 前缀白名单）自动放行。

### 6.5 `namespace-registry`：`lease.ts` / `types.ts` / `registry.ts`

- `types.ts`：`NamespaceLease` 增 `openReplicationSession(options) => Promise<ReplicationSessionOpenResult>`；新增公共类型 `ReplicationSession`（冻结四域 + applyRemoteUpdate/getStatus/close 恰七键——与 runtime core 逐字段同构，`Equal` 断言锁死）、`ReplicationSessionStatus`、`ReplicationSessionApplyResult`（六码闭集，主线逐字）、`OpenReplicationSessionOptions`、`ReplicationSessionOpenResult`、`REPLICATION_SESSION_INPUT_INVALID` 冻结文案常量。
- `lease.ts`：`createLeaseController` 增第四参 `deps: { openReplicationSessionCore }`（必选——无缺省即无降级；唯一生产调用方 registry.ts 同步更新）；方法体 = released 门（`NAMESPACE_LEASE_RELEASED`）→ `parseOpenSessionOptions`（主线逐字端口：单读捕获 + 全探测 try/catch；own 键集恰 {localRole, remoteInstanceId}、localRole ∈ {hub,peer}、remoteInstanceId 匹配 INSTANCE_ID_PATTERN）→ 委托 core。**无角色门 / 无会话计数 / 无 wrapCore**（R-3.3、§12-L3）——`session` 即冻结 core。
- `registry.ts`：issueLease 处 `createLeaseController(entry, observer, onReleased, { openReplicationSessionCore: openReplicationSessionCoreForRegistry })`（import 自 `@nomicore/namespace-runtime/internal`）。
- `testing.ts` 零改动（runtimeFactory 覆盖通道原样——fixture 注入的诊断 seam 经 `createNamespaceRuntimeWithSeam` 装配的 runtime 会在构造时登记 host，lease 委托链对新工厂产物同样成立；SA6 红灯注释所记 registry 包相对路径 import 属既有装配形态，不在本票改动面）。

---

## §7. 诊断发射层扩展（`diagnostic.ts`，向后兼容四点——【R1 修订，SA2 #1】第四点 = input 可选化）

```ts
export interface SlotEmissionArgs {
  readonly operation: Operation;
  readonly stage: Stage;
  readonly code?: string;
  readonly sourcePhase?: string;
  readonly issues?: DiagnosticIssue[];
  readonly input?: EmissionInput;       // 【#151 R1 第四点新增】可选——省略 = 本尝试无可捕获
                                        // 输入（emission 面省略 input 字段 → record 面投影
                                        // {capture:'none'}，§7 第 4 点）；ROOT/SCHEMA 既有
                                        // 调用恒传值，字节面零变化
  readonly result: EmissionResult;
  readonly source?: LogSource;          // 【#151 新增】缺省 {kind:'local'}——ROOT/SCHEMA 既有调用零改动
  readonly context?: LogContext;        // 【#151 新增】缺省省略——受控复制身份（D-7）
  readonly sourceModule?: SourceModule; // 【#151 新增】缺省 'runtime'——按码的注册表来源（D-9）
}
```

**四点扩展清单**（全部向后兼容——缺省/既有传值 = 既有行为，ROOT/SCHEMA emission 字节面零变化）：
1. `source`（缺省 `{kind:'local'}`）；
2. `context`（缺省省略）；
3. `sourceModule`（缺省 `'runtime'`，与 code 成对）；
4. **【R1，SA2 #1】`SlotEmissionArgs.input` 与 `SlotDiag.input` 可选化 + `emitAttempt`/`emitSlot` 条件展开**：
   - `SlotDiag.input` 类型放宽为 `EmissionInput | undefined`；`undefined` = 本尝试**无可捕获输入**（≠「拒绝先于输入访问」——那是 `{status:'not-accessed'}` 的专属语义，ADR-0011 §E）。`createSlotDiag` 的缺省初值保持 `{status:'not-accessed'}`（ROOT/SCHEMA/enable——有调用方输入的操作沿用）；**apply/bump 的槽 diag 以 `input: undefined` 构造**（apply 的 raw bytes 非 plain-data 不得作 snapshot（D-8 数据保护面）、bump 根本无调用方输入）——实现形态由 SA3 择一（扩展 `createSlotDiag` 显式参或直接字面量构造），契约不变。
   - `emitAttempt` / `emitSlot` 对 input **条件展开**：`...(e.input !== undefined ? { input: e.input } : {})`——省略时 emission 不携带 input 字段（不携带 `input: undefined` 值键）。
   - **record 面投影冻结**：emission 省略 input ⇒ record 面 `input.capture === 'none'`——管线既有单点 `projectInput(undefined) → {capture:'none'}`（`packages/namespace-diagnostic-log/src/projection/input.ts:58`；emission.ts §2.6「省略 input 字段 ⇔ 无可捕获输入，按 none 处理」）。**apply 一切槽内路径（§9.3 A-e…A-m）的 record 面期望恰 `{capture:'none'}`**——与 A-a/A-c 的 `{capture:'not-accessed'}`（接纳期拒绝、拒绝先于任何输入访问——红灯用例 9 既有断言锚）和 A-d 的 `{capture:'unavailable'}`（输入已访问但不可快照）三态严格区分，**committed/rejected 槽内记录不得谎称 not-accessed**（谎称将直接违反 ADR-0011 §E 的 not-accessed 语义）。SA6 可选在红灯用例 5 追加断言 `expect(rec.input).toEqual({ capture: 'none' })`（SA2 评审 §4.1 红线建议——若 SA3 误用 not-accessed，该断言即红）。

`emitAttempt` / `emitSlot` 签名与吞没语义零变化；`emitSlot` 的 INV-DIAG 缺省组装（outcome 缺失 + 业务 ok:true → bytes?update:noop）对 enable/bump/apply 的 committed 路径直接生效（§9 表「缺省组装」行）。新增一个结局 helper：

```ts
/** validation 拒绝 + 顶层稳定码（enable E3 / bump E4 域拒绝——issues 同源透传）。 */
export function diagValidationCode(diag: SlotDiag | undefined, code: string, issues: DiagnosticIssue[]): void {
  if (diag === undefined) return;
  diag.outcome = { stage: 'validation', result: { kind: 'rejected' }, code, issues };
}
```

（既有 `diagValidation` 无 code 形态保留——ROOT/SCHEMA 领域校验面继续使用。）

**槽后 emission 的 source/context 装配**：`SlotDiag` 增两个可选字段 `source?: LogSource` 与 `context?: LogContext`，`emitSlot` 把二者透传给 `emitAttempt`（缺省 undefined ⇒ emitAttempt 用缺省 local / 省略——ROOT/SCHEMA 既有槽零改动）。装配点：
- **apply**：会话 apply 槽的 diag 在创建时即携带 `source = {kind:'replication', direction, remoteInstanceId}` 与 `context = {replicationId, replicationEpoch}`（会话冻结闭包常量——R1–R7 全部槽内结局点的槽后 emission 恒带受控 source/context，D-7）；
- **enable/bump**：source 恒 local（缺省，不写）；`context` 由槽体在 E4 成功后一次写入——**裁决：context 的 epoch 取「本次尝试所确立的事实」**：enable 首装 = {id, 1}（E3 捕获 + 常量 1，E5 前已知）；bump = {id, nextEpoch}（E4 facts + 1 在槽内已知）；幂等 enable = 既有 {id, currentEpoch}（E4 facts 直读）。E4 之前的结局点（gate 拒绝/fatal）context 未写 ⇒ 省略——与 D-7 的「E4 前零 context」规则一致。

## §8. owned bytes 捕获窗口（三处，#149 §6 模式逐位复用）

```ts
// enable/bump 的 E5（replication-write.ts）：
let capturedUpdate: Uint8Array | undefined;
const updateHandler = (u: Uint8Array): void => { if (capturedUpdate === undefined) capturedUpdate = u; };
if (diag !== undefined) env.doc.on('update', updateHandler);
try {
  env.doc.transact(() => { /* META 两键 / epoch 键 */ });
} catch (err) { /* diagFatalTx(…, capturedUpdate) —— 分类在 catch 内（捕获值已就绪） */
} finally {
  if (diag !== undefined) { env.doc.off('update', updateHandler); diag.updateBytes = capturedUpdate; }
}

// apply 的 R5（replication-session.ts）：窗口夹住 Y.applyUpdate(doc, bytes, ctx.applyOrigin)
// 【R2 修订，SA4 F1——冻结判据】apply 窗口**无条件挂接**（业务事实源——capturedUpdate
//    是 R6 notifyDirty 门控（R-3.1「零字节 ⟺ 零集成 ⟺ 零通知」）的唯一判据，无诊断
//    基线同样成立）；仅 finally 内 diag 赋值以 diag 为条件：
//      host.doc.on('update', updateHandler);   // 无条件（≠ enable/bump 的 diag 条件窗口）
//      ... finally { host.doc.off('update', updateHandler);
//                    if (diag !== undefined) diag.updateBytes = capturedUpdate; }
//    + beforeTransaction 二分探针（主线 R2-6 逐字：探针晚于一切先注册 listener 注册；
//      finally 内 off 两者——探针本就无条件，承载 committed 二分业务事实）。
```

关键实证（§16）：事务 cleanup 原生投递面给出的增量对**基态链式重放**精确物化本槽效果、对**无基态空 doc 不物化**（真增量的结构性特征——防「事务后 `Y.encodeStateAsUpdate(doc)` 全文档编码」冒充，SA8 钉死 #1）；空 diff 集成零事件（⇒ 捕获 undefined ⟺ noop ⟺ 跳过 dirty，R-3.1 判据）。窗口互斥性：三窗口 + #149 两窗口全部开在各自槽体的同步段内、且所有写共享唯一 FIFO sequencer——**两窗口结构性不可能同时打开**。

---

## §9. stage / code / result / input / context 完整映射表（冻结契约——与红灯锚点逐一对应）

### 9.1 `replication-enable`（source 恒 `{kind:'local'}`；sourceModule 按 D-9）

| # | 业务结局点（槽位） | stage | code（sourceModule） | result | input | context |
|---|---|---|---|---|---|---|
| E-a | 公共方法 lifecycle≠ready（零入队） | acceptance | RUNTIME_WRITE_DISABLED（runtime） | rejected | not-accessed | — |
| E-b | E1 fatal 已置位 | capability-gate | RUNTIME_WRITE_DISABLED（runtime） | rejected | not-accessed | — |
| E-c | E2 getStatus throw | capability-gate | NSRT-FATAL-REPLICATION-WRITE-INTERNAL（replication）+ sourcePhase write-slot-internal | fatal committed:false | not-accessed | — |
| E-d | E2 非 ready / notifier 未绑定 | capability-gate | RUNTIME_WRITE_DISABLED（runtime） | rejected | not-accessed | — |
| E-e | E3 输入格式/形状拒绝（含探测 throw） | validation | REPLICATION_INPUT_INVALID（replication） | rejected | snapshot(捕获串) / unsafe-input(throw) | — |
| E-f | E4 facts corrupt throw | capability-gate | NSRT-FATAL-REPLICATION-WRITE-INTERNAL（replication）+ write-slot-internal | fatal committed:false | snapshot | — |
| E-g | E4 已 enabled（幂等重入）→ ok:true 零事务 | transaction（缺省组装） | — | **committed + noop** | snapshot | {replicationId, replicationEpoch:既有} |
| E-h | E4 disabled 且 META 载体缺席 | validation | REPLICATION_META_ABSENT（replication） | rejected | snapshot | — |
| E-i | E5 提交 + E6 成功 → ok:true | transaction（缺省组装） | — | **committed + update（捕获 bytes）** | snapshot | {replicationId, replicationEpoch:1} |
| E-j | E5 transact throw（保守 committed:true） | transaction | NSRT-FATAL-REPLICATION-WRITE-INTERNAL + unknown-pipeline-throw | fatal committed:true + effect update（bytes） | snapshot | {id, 1} |
| E-k | E6 notifyDirty throw | dirty-notification | NSRT-FATAL-REPLICATION-WRITE-INTERNAL + notify-dirty-failed | fatal committed:true + effect update（bytes） | snapshot | {id, 1} |

红灯锚：E-i（AC1/AC3 用例 1：stage transaction / source local / context {id,1} / META 两键链式重放 + 空doc不物化）、E-g（AC3 用例 2：noop 显式 + 身份不变）、E-e（AC2 用例 3：validation / REPLICATION_INPUT_INVALID / rejected / 零写入）。

### 9.2 `replication-epoch-bump`（source 恒 local）

| # | 业务结局点 | stage | code | result | input | context |
|---|---|---|---|---|---|---|
| B-a | lifecycle≠ready | acceptance | RUNTIME_WRITE_DISABLED（runtime） | rejected | — | — |
| B-b/B-d | E1/E2 gate（同 E-b/E-c/E-d） | capability-gate | 同 enable 对应行 | rejected / fatal committed:false | — | — |
| B-e′ | **E4 readReplicationFacts corrupt throw**（恰一键存在 / 键存在值 undefined / 格式违约 / 载体异型）【R1 修订补行，SA2 #2】 | capability-gate | NSRT-FATAL-REPLICATION-WRITE-INTERNAL（replication）+ sourcePhase write-slot-internal | **fatal committed:false**（此时尚零 doc 写） | — | — |
| B-e | E4 disabled（无谱系——两键真缺席**与 META 载体缺席同拒**，见下注） | validation | REPLICATION_NOT_ENABLED（replication） | rejected | — | — |
| B-f | E4 epoch ≥ MAX_SAFE_INTEGER | validation | REPLICATION_EPOCH_OVERFLOW（replication） | rejected | — | {id, MAX} |
| B-g | E5 提交（epoch+1 精确单键增量）+ E6 成功 | transaction（缺省组装） | — | committed + update（bytes） | — | {replicationId 不变, replicationEpoch:next} |
| B-h | E5 throw（保守 true） | transaction | NSRT-FATAL-REPLICATION-WRITE-INTERNAL + unknown-pipeline-throw | fatal committed:true + update（bytes） | — | {id, next} |
| B-i | E6 notifyDirty throw | dirty-notification | NSRT-FATAL-REPLICATION-WRITE-INTERNAL + notify-dirty-failed | fatal committed:true + update（bytes） | — | {id, next} |

（bump 无 noop 分支——epoch 严格单调，E5 恒有写。）

**【R1 修订补注，SA2 #2】bump 与 enable 的 E4 出口分野**：
- **corrupt**：`readReplicationFacts` throw 在两槽同走 internal fatal（enable E-f / bump B-e′，均 capability-gate + NSRT-FATAL-REPLICATION-WRITE-INTERNAL + write-slot-internal + committed:false——槽内不变量破坏，拒绝虚假降级立法）；
- **META 载体缺席**：enable 有专属出口 E-h（`REPLICATION_META_ABSENT`——防在其上凭空造载体安装全新谱系）；**bump 无 META_ABSENT 分支**——载体缺席经 `readReplicationFacts` 的「META 载体缺席 → disabled」出口归并入 B-e（`REPLICATION_NOT_ENABLED`，主线 bump 槽 E4 注释原文「两键真缺席与载体缺席在此同拒」）。分野依据：enable 是谱系安装写（载体在场是安装前提），bump 是零写路径的提升尝试（无谱系即无代际可提升，两种 disabled 判据无需区分）。
- input 列「—」= emission 面省略（bump 无调用方输入，§7 第 4 点）→ record 面投影 `{capture:'none'}`。

红灯锚：B-g（AC1/AC3 用例 4：context.epoch 递增 + identity 保留 + 精确单键增量链式重放）、B-e′（SA2 评审 §4.2 红线建议：seedForTest 等价构造 META 复制保留字段损坏 doc → bump → rejects `{phase:'write-slot-internal', committed:false}` + 记录 capability-gate / NSRT-FATAL-REPLICATION-WRITE-INTERNAL + 后续写全拒）。

### 9.3 `replication-apply`（source 恒 `{kind:'replication', direction, remoteInstanceId}`——direction 双字面量派生冻结 localRole；context 恒 {replicationId, replicationEpoch} 会话冻结值）

**【R1 修订，SA2 #1】input 列三态词表（record 面期望）**：「not-accessed」= emission `{status:'not-accessed'}` → record `{capture:'not-accessed'}`（接纳层拒绝、拒绝先于任何输入访问——A-a/A-b(A1)/A-c）；「unavailable」= `{status:'unavailable'}` → `{capture:'unavailable'}`（输入已访问但不可快照——A-d）；「省略」= emission 省略 input 字段（§7 第 4 点，`SlotDiag.input: undefined`）→ **record `{capture:'none'}`**（`projection/input.ts:58`——一切槽内路径 A-b(R2)/A-e…A-m，含 committed 行 A-j/A-k：raw bytes 非 plain-data 不得作 snapshot（D-8），效果由 `result.updateBytes` 权威表达）。三态不得混用——**committed 记录携带 not-accessed 即「谎称拒绝先于输入访问」的契约违规**。

| # | 业务结局点 | stage | code（sourceModule） | result | input |
|---|---|---|---|---|---|
| A-a | A1 终态 closed（explicit） | acceptance | REPLICATION_SESSION_CLOSED（replication） | rejected | not-accessed |
| A-b | A1 终态 conflicted / R2 事实不等（被动 fence） | **identity** | REPLICATION_EPOCH_CONFLICTED（replication） | rejected | not-accessed（A1）/ 省略（R2 槽内） |
| A-c | A1 终态 closed（runtime-close）/ A3 lifecycle≠ready | acceptance | RUNTIME_WRITE_DISABLED（runtime） | rejected | not-accessed |
| A-d | A2 非 Uint8Array / 拷贝 throw | validation | REPLICATION_RAW_UPDATE_INVALID（replication） | rejected | unavailable |
| A-e | R1 fatal 已置位 | capability-gate | RUNTIME_WRITE_DISABLED（runtime） | rejected | 省略 |
| A-f | R3 getStatus throw | capability-gate | NSRT-FATAL-REPLICATION-APPLY-INTERNAL（replication）+ write-slot-internal | fatal committed:false | 省略 |
| A-g | R3 非 ready 无 bypass / notifier 未绑定 | capability-gate | RUNTIME_WRITE_DISABLED（runtime） | rejected | 省略 |
| A-h | R4 scratch invalid（畸形字节） | validation | REPLICATION_RAW_UPDATE_INVALID（replication） | rejected | 省略 |
| A-i | R4 受保护内容改变 | validation | REPLICATION_PROTECTED_FIELDS_CHANGED（replication） | rejected | 省略 |
| A-j | R5 集成有字节 + R6 成功 → ok:true | transaction（缺省组装） | — | **committed + update（捕获 bytes = 精确 applied effect）** | 省略 |
| A-k | R5 集成零字节（空 diff）→ 跳过 R6 → ok:true | transaction（缺省组装） | — | **committed + noop（零写入零 dirty）** | 省略 |
| A-l | R5 throw（txStarted 二分：false→committed:false / true→保守 true+bytes） | transaction | NSRT-FATAL-REPLICATION-APPLY-INTERNAL + unknown-pipeline-throw | fatal（committed 按二分；true 时 effect update） | 省略 |
| A-m | R6 notifyDirty throw | dirty-notification | NSRT-FATAL-REPLICATION-APPLY-INTERNAL + notify-dirty-failed | **fatal committed:true + effect update（bytes）** | 省略 |

红灯锚：A-j（用例 5/6：hub-to-peer 与 peer-to-hub 双字面量 + 精确 owned bytes 链式重放）、A-k（用例 7：noop 显式 + saveCalls 不变）、A-b（用例 8：identity / REPLICATION_EPOCH_CONFLICTED）、A-a（用例 9：acceptance / SESSION_CLOSED / not-accessed）、A-h（用例 10：validation / RAW_UPDATE_INVALID）、A-m（用例 11：fatal committed:true + dirty-notification + 精确 bytes + 业务 rejection 保留 phase/committed）、A-f（用例 12：fatal committed:false + capability-gate + 既有 fatal 码）。

### 9.4 issues 通道

enable/bump 的 issues 元素形状 `{message, path: []}`（gate 级——主线 ReplicationManagementIssue 同款）；与业务返回**同源透传**（同一数组引用，零第二构造——#149 §9.3 纪律）。apply 的 refusal 是 `{code, message}` 单对象非 issues 数组（主线联合形状）——emission 顶层 `code` 承载、无 issues 字段（fatal throw 通道无 issues 载荷，#149 §9.3 同款裁决）。

---

## §10. SA8 七条钉死约束逐条对照

| # | 钉死约束 | 本设计落实 | 落点 |
|---|---|---|---|
| 1 | owned bytes 走 replication transaction seam；禁全文档编码冒充；noop/update-omitted 显式分置；reason 只用冻结三词表 | 三处订阅窗口（§8）捕获本事务增量；实证「空 doc 不物化」防冒充（§16 P2/P3/P5）；noop 经 INV-DIAG 缺省组装显式（A-k/E-g）；**本票零 update-omitted 产出**（payload 超限/捕获禁用属存储面策略，SA7 面；红灯注记 5 同判）——零新 reason 词表项 | §8/§9 |
| 2 | emit 在 slot 外或 slot 释放后；不被 await、不延长槽；notifyDirty 槽序不动；不引入第二排序机构 | 三挂点全部 `settled.then(emitSlot)`（#149 §7.1 微任务序证明逐字适用）；A 层拒绝在会话方法同步段（公共入口记录点，ADR-0011 §F）；E6/R6 仍在槽内原槽位；排序仍由唯一 WriteSequencer 承载（enable/bump/apply 全部 enqueue 同一实例） | §3/§6.1/§5.3 |
| 3 | 词表零新造；identity 承载 epoch 拒绝；code/issues/committed 取既有注册表零改 message；正常路径禁 unknown | 三 operation/双向 direction/context 四键/六分支/八阶段全部消费冻结词表（§1.1）；A-b 映射 stage `identity`；稳定码族主线原值端口（§0.2）；R-3.2 维持单一注册表；`fatal committed:true + effect unknown` 仅存储 schema 分支——本票 fatal committed:true 路径恒有捕获 bytes → effect `update`，零 unknown 产出 | §0.2/§9 |
| 4 | transport 排除面；关联只走受控 correlationId | 只发三条 operation；open/getStatus/close/心跳/连接零接线（§5.2/D-4）；本票 transport 面不存在（未物化）——结构性满足；correlationId 预留 context 键（本票零产出，无 transport 关联源） | §5.2/§9 |
| 5 | 日志故障零业务影响；不置位 fatal/degraded；producer 防御 emitter 违约；不扩张 replication wire interface | #149 emitAttempt 全吞没原样复用；emit 路径零写 state（§3 第四防线）；AC4 两用例的机制基础；**零 wire interface 新增**（lease/internal 面是既有 host 内部通道方向，非 wire） | §3 |
| 6 | 身份上下文走 per-record context；不进 manifest；epoch ≠ stream generation；日志配置不入 SCHEMA/META/ROOT | D-7：全部 per-record；emission 面无 stream/manifest 构造路径（#152 域）；diagEnv 是构造注入旁路状态，不写 Y.Doc | §2 D-7 |
| 7 | emission 公共面边界：不构造物理字段、不加 genesis 路径、不暴露 live Y.Doc；所有权移交后不变异；跨 stream 不去重 | 语义 emission 全复用 #149 形态（零物理键）；updateBytes 为捕获窗口产物 Uint8Array（emit 后 producer 零再触碰——窗口已关）；本地提交（#149 记录）与远端 apply（本票记录）双侧各留记录属预期、零去重 | §7/§8 |

---

## §11. 验收标准逐条对照（AC × 红灯用例）

| AC | 内容 | 本设计覆盖 | 转绿路径 |
|---|---|---|---|
| AC1 | 三条 operation 的 frozen v1 词表 + 受控 source/context | §9 三表（operation 字面量/source 双向/observedAt=注入 clock/attemptId att-+32hex 由管线生成） | 用例 1/4/5/6：操作面物化后 TypeError 消失；记录断言经 emit 挂点满足 |
| AC2 | 七类既有结局保留稳定 phase/code/issues/committed | §9 全表（identity/acceptance/validation/capability-gate/transaction/dirty-notification + committed-aware fatal 双向）；业务 rejection 保留 `RuntimeWriteFatalError{phase, committed}`（用例 11/12 的 `rejects.toMatchObject` 直接消费物化槽的既有抛出形状） | 用例 2/3/8/9/10/11/12 |
| AC3 | committed 复制事务 detached owned bytes；noop / update-omitted 显式 | §8 捕获窗口 + §16 实测（链式重放/空doc不物化/空diff零事件）；A-k/E-g noop 显式；update-omitted 零产出（存储面，红灯注记 5） | 用例 1/2/4/5/7 |
| AC4 | 日志故障/队列压力零业务影响 | §3 四防线 + 复用 #149 敌意 emitter/容量 drop 机械；FIFO 由 INV-S1 结构保证（enable→bump epoch 2 断言） | 用例 13（emit 恰 2 次 + throw 吞没 + fatal null）/14（accepted 1 dropped 1 + 业务完整） |
| AC5 | 双方向 + transport 隔离 | direction 派生冻结（§5.3）；session 面零接线（D-4/§5.2） | 用例 6（peer-to-hub 字面量）/15（open/status/close 零 emission，恰 2 条变更尝试） |

**SA6 侧前置动作（本设计的显式依赖）+ 硬排程序【R1 修订强化，SA2 #3】**：

1. **修订内容**：红灯文件两处 `'NSRT-FATAL-REPLICATION-APPLY-WRITE-INTERNAL'` 字面量（`:729` / `:782`）按 SA6 报告注记 2 协议修订为 `'NSRT-FATAL-REPLICATION-APPLY-INTERNAL'`（R-3.2；断言语义不变；修订后字面量必须与 `errors.ts` 注册表值逐字一致）。修订 commit 建议引用 R-3.2 + SA6 注记 2，使审计链闭合（SA2 §4.3 红线建议）。
2. **硬排程序（scheduling gate）**：**SA6 的两处字面量修订必须先于 SA4 转绿验证落地**——总控排程序为：SA3 实现 → SA6 字面量修订 → SA4 转绿验证。若 SA6 修订未先行，用例 11/12 将以字面量不等失败，**会被误读为实现缺陷**（SA2 攻击点 #3 点名的误诊风险）——该失败形态是排程序违约信号，不是 SA3 返工信号。
3. 除该两处字面量外，**测试文件零改动即应 15/15 转绿**；SA6 另可选按 §7 第 4 点 / §9.2 红灯锚建议追加 `capture:'none'` 与 B-e′ 两个断言锚（可选非必须——不追加不阻塞转绿）。

---

## §12. 记录的局限（「record any resulting limitation」纪律——物化面与主线 Phase 5 的登记差异）

| # | 局限 | 影响 | 归属（未来票） |
|---|---|---|---|
| L1 | 会话核心无 outbound 能力（无 `subscribeOwnedUpdates` / `encodeStateVector` / `encodeDiff` / fanout 队列/微任务泵/needsResync/observerFailures） | 本 worktree session 只能消费 trusted apply，不能向对端投递增量；session.getStatus 无扇出健康域 | Phase 5 谱系（#130 后续切片）合入时补齐；届时本票 session 文件被主线版本取代，诊断接线（emit 挂点/映射表）保持 |
| L2 | lease 无实例角色编排（role 注入 / hub-only 管理写门 / drawReplicationId CSPRNG 抽取） | 本 worktree lease.enableReplication 不存在（管理写只经 runtime 面）；openReplicationSession 双向均可开 | Phase 5 host 装配票（R-3.3 结构性要求本票如此） |
| L3 | lease 无每-Lease 活跃 session 计数与 wrapCore revoked 通道、release 不联动 session.close | lease release 后 session 不被强制终止（runtime 侧 lifecycle/fatal gate 仍兜底拒绝 apply；Runtime close 仍终止会话） | Phase 5 谱系 R2-5 编排 |
| L4 | 公共 `NamespaceRuntimeStatus` 无 `replication` 域（主线有；本票 state.replication 为内部投影） | 调查者不能经 runtime.getStatus() 读复制事实（经诊断记录的 context 可见） | Phase 5 谱系（公共 status 扩域涉既有七键锁面，本票不扩爆炸半径） |
| L5 | 无 `beginResetFence`（主线 reset/bootstrap 的受控 fence 入口） | 本 worktree 无 reset/bootstrap 消费方 | Phase 5 谱系切片 5+ |
| L6 | R-3.1（noop apply 跳过 notifyDirty）与主线 R6 无条件通知存在行为分叉 | 两谱系对空 update apply 的 saveCalls 观测不同；本票以 SA6 契约 + INV-R3/ADR-0006 为准 | 合并仲裁票：建议主线采约（INV-R3 自洽性） |

**合并策略声明**：本票对 `runtime.ts`/`write.ts`/`errors.ts`/`lease.ts` 的改动均为**加法**（新键/新分支/新码族），Phase 5 谱系合入时的文本冲突限于新增块；`replication-write.ts`/`replication-session.ts` 以主线版本为准覆盖合并，本票在这两个文件中的**诊断接线行**（diag 参数/结局写入/捕获窗口/emit 挂点）按 §9 映射表在合并时重放——映射表是接线知识的单一真相源，不依赖具体行号。

---

## §13. 边界条件与并发分析

1. **窗口互斥**：五个捕获窗口（#149 ROOT/SCHEMA + 本票 enable/bump/apply）全部开在槽体同步段、所有写共享唯一 FIFO sequencer——结构性不可能同时打开；fanout 缺席使 doc 无常驻 update 监听（主线 INV-S2 的每-runtime 恰一监听在本票退化为零监听，窗口期间临时挂接）。
2. **bump 与 apply 的 fence 竞争**：bump E5.5' 主动 fence（同步段，在 bump 槽内）与 apply A1 终态检查/R2 被动 fence（apply 槽内）经同一 sequencer 串行化——无并发窗口；finalize 幂等 + 终态不降级（conflicted 保持）保证两次 fence 收敛同一终态。
3. **enable 幂等与 in-flight apply**：enable 幂等分支零写零通知——对 in-flight session 零影响（身份不变 ⇒ session 冻结值继续匹配）。
4. **close 与已接纳 apply**：close() 同步段 terminateAll 只终态化 session（后续 apply 在 A1/A3 被拒）；已 enqueue 的 apply 槽在 barrier 之前照常排空（ADR-0008 已接纳任务无条件排空）。
5. **diag 未装配的行为等价**：`diagEnv.emitter === undefined` ⇒ 三槽体 diag 写入全 no-op、emit 挂点零效果（`emitSlot` 首行返回）；**【R2 修订，SA4 F1】窗口订阅分化**——enable/bump 的 E5 窗口随 diag 缺席零订阅；**apply 的 R5 窗口无条件订阅**（R-3.1 业务判据载体，§3/§8——无诊断基线下 R6 门控经同一 capturedUpdate 判定，两基线行为同构）。无日志基线行为等价（#149 D-C 同款：唯一差异是返回 promise 结算多一跳微任务，对 await 消费者不可观测）。
6. **敌意输入**：enable E3 单读捕获 + 全探测 try/catch（Proxy get/ownKeys trap throw 收编为 REPLICATION_INPUT_INVALID，绝不裸 reject、绝不升格 fatal——防「一次敌意 value → 永久禁写」DoS）；apply A2 `new Uint8Array(update)` 陷阱安全拷贝（绝不用 `update.slice()`——敌意子类可覆写）；lease parseOpenSessionOptions 同款收编。全部主线既有机械逐字保留。
7. **捕获 bytes 的所有权**：emit 时窗口已关（finally 退订在先），producer 此后零触碰——满足「所有权移交后不得再变异」（捕获值本身是 yjs 事件投递的数组，窗口内单赋值后不再有写入方；emit 后由 emitter 管线 slice 复制——#149 §2.6 既有）。
8. **epoch 与 stream generation 混同防御**：emission 面无 stream 身份构造路径（物理投影归 adapter）——结构性满足 SA8 #6。

---

## §14. 架构一致性论证

1. **与 #149 的关系**：零推翻、纯扩展。emitAttempt/emitSlot/SlotDiag/窗口模式/INV-DIAG 全部复用；diagnostic.ts 四点扩展向后兼容（缺省/既有传值 = 既有行为）；ROOT/SCHEMA 既有 emission 字节面零变化（source 缺省 local / sourceModule 缺省 runtime / context 缺省省略 / input 恒传值——【R1，SA2 #1】第四点对既有调用零影响）。
2. **与 ADR-0008**：enable/bump/apply 全部经唯一 WriteSequencer（「同一 namespace 内所有受控 Y.Doc 写共享唯一严格 FIFO write sequencer」逐字满足）；槽序 E1–E7/R1–R7 是 S1–S7 的复制变体（E3 输入校验/E4 领域事实/E5 事务/E5.5 同步投影/E6 notifier——主线已按此镜像设计）；committed-aware fatal 的 committed 事实沿 `RuntimeWriteFatalError{phase, committed}` 既有通道。
3. **与 ADR-0009**：lease 增量是能力面加法；internal.ts 第二值导出沿 issue #109 冻结通道扩张先例（主线 #134 同款）；observer seam 零触碰。
4. **与 ADR-0011/0012**：§10 已逐条对照七条钉死约束。
5. **与主线 Phase 5 谱系**：§0.2/§12——形状锚定、差异显式、合并策略声明。**无静默漂移**：三处行为仲裁（R-3.1/2/3）与六项局限（L1–L6）全部登记。

---

## §15. 实施注意（SA3）

1. **落地顺序**：① `errors.ts` 码族 + `write.ts` WriteSlot 扩展 → ② `p0.ts` state 域 → ③ `diagnostic.ts` 四点扩展 + `diagValidationCode`（含 input 可选化——apply/bump 槽 diag 的 `input: undefined` 构造形态在此定形）→ ④ `replication-write.ts`（可先不带 diag 落槽，再插结局行）→ ⑤ `replication-session.ts` → ⑥ `runtime.ts`（两键 + V2.5 + host + close fence）→ ⑦ `internal.ts` → ⑧ registry 三文件 → ⑨ 存量测试键集更新 → ⑩ 全量回归。
2. **存量测试更新**（公共面扩张的必然改面，全部在 ALLOW LIST）：
   - `runtime-close-lifecycle.test.ts:159` 十键断言 → 十二键（+`bumpReplicationEpoch`/`enableReplication`）；
   - `runtime-registry-internal-seam.test.ts:270` 十键断言 → 十二键；`:123` internal 值导出键集 `['createNamespaceRuntimeForRegistry']` → 追加 `'openReplicationSessionCoreForRegistry'`；
   - `registry-open.test.ts:879` lease 键集 → 追加 `openReplicationSession`；
   - **【R2 修订补录，SA4 F3】五个 registry 测试替身文件**（`registry-idle` / `registry-shutdown` / `registry-sa7-hostile` / `registry-sa7-rev1` / `registry-sa7-concurrency` `.test.ts`）：各含 `implements NamespaceRuntime` 的 stub runtime——十二键扩张后 TS 结构类型**强制**要求替身补两个新键，否则 CI typecheck 断；收容形态 = loud stub（`enableReplication`/`bumpReplicationEpoch` 返回 `REPLICATION_NOT_STUBBED` 显式失败 issue——被误用即以结果面拒绝暴露，不静默伪装 ok），**零断言改动**（SA4 逐 diff 核实）。
   - **【R2 修订补录，SA4 F3】类型面收容与版本纪律**：`namespace-registry/src/index.ts` +7 个 **type-only** re-export（`OpenReplicationSessionIssueCode` / `OpenReplicationSessionOptions` / `OpenReplicationSessionResult` / `ReplicationSession` / `ReplicationSessionApplyRefusalCode` / `ReplicationSessionApplyResult` / `ReplicationSessionStatus`——主线 b66615c registry index 同款 re-export 面；registry-surface「恰九个 value」断言不受影响，逐 diff 核实零运行时值导出）；两触及包 `package.json` **仅 version 字段 bump**（runtime 0.1.8→0.1.9 / registry 0.1.3→0.1.4——仓库既定纪律：#167 `722bddf` 同款只 bump 触及包；workspace 版本不入 lockfile，pnpm-lock 零 diff 属预期）。
   - 其余存量测试**零改动应全绿**（exports-audit 的 index 值导出一键锁不受影响——两方法在 runtime 对象上、不在 index；writeFatalMessage 既有渲染分支逐字节不变；上条五个替身文件是 typecheck 强制收容，不属「改冻结行为」）。
3. **SA6 前置**：红灯测试两处 fatal 码字面量修订（§11 末）——SA6 owned 文件、SA6 自己改；SA3 不准动断言。
4. **类型面**：`exactOptionalPropertyTypes` 纪律——context/可选字段用条件展开（`...(x !== undefined ? {x} : {})`），沿 emitAttempt 既有形态。
5. **禁止事项**：不得给 open/getStatus/close 加任何 emission；不得在 enable 槽加 fence（主线显式裁决）；不得「优化」E3 单读捕获为双读；不得给 R6 恢复无条件 notifyDirty（R-3.1 是契约）；不得把 raw bytes 放进 input.snapshot。
6. **回归命令**：`pnpm exec vitest run packages/namespace-runtime packages/namespace-registry` + `pnpm exec tsc -p tsconfig.typecheck.json --noEmit`。
7. **SA7 动态验证清单登记【R1 修订新增，SA2 攻击点 #4/#5 移交——非阻塞，SA7 阶段消费】**：
   - **(a) 物化面对账（防静默漂移的最后一道闸）**：`git diff b66615c -- packages/namespace-runtime/src/replication-write.ts packages/namespace-runtime/src/replication-session.ts` 语义 diff——**每一个差异点必须落在 §0.4 三仲裁（R-3.1/2/3）或 §12 L1–L6 登记内**（diag 接线行/捕获窗口/fence 经 SessionRegistry 的适配除外——它们是本票新增接线，不属「漂移」）；出现登记外差异即红，SA7 报告须逐差异点对账。
   - **(b) update-omitted 活链路（AC3 在 replication operation 上的显式分置）**：以 `makeLog({ updateCapture: false })` 配置跑一次 hub-to-peer committed apply → 断言 attempt record `result` 为 `committed + update-omitted` 且 reason ∈ 冻结三词表（预期 `update-capture-disabled`——`vocabulary`/CONTEXT.md 冻结），业务 `ok:true` 不变。该分支本票 producer 恒不产出（§10 钉死 #1 行），存储面承载——SA7 活链路兑现。
   - **(c)（沿 SA2 §4 红线建议，随 (a)/(b) 顺带）**：红灯全量 15/15 + 三个存量键集测试更新后的全量回归，构成 SA7 动态面的基线。

---

## §16. 协议假设依据 (Protocol Assumption Evidence)

| # | 假设 | 依据类型 | 依据内容 | 风险 |
|---|---|---|---|---|
| P1 | yjs `doc.transact` 事务 cleanup 经 `doc.on('update')` 投递本事务增量 bytes | 设计期实测 + 现有测试引用 | SA1 于本 worktree 实测（node 24.13.0 / yjs 13.6.32，探测脚本输出附于本表后）：enable 两键同事务捕获 92 bytes、bump 单键捕获 27 bytes；#149 已落地同款窗口（`write.ts:176-200`）并有 14 用例绿 | 低 |
| P2 | **捕获的事务增量对同源基态链式重放精确物化本槽效果；对无基态空 doc 不物化**（真增量反向鉴别——防全文档编码冒充） | 设计期实测 | 同上实测：E1a 基态+enable 增量重放 → META 两键精确；E1b/E2b/E3b 空 doc 应用捕获增量 → ROOT/SCHEMA/META size 全 0；E3a 基态+enable+apply 捕获增量重放 → n=42/a='x'/META id 精确 | 低 |
| P3 | `Y.applyUpdate` 的集成经同一 update 事件投递；**空 diff（`encodeStateAsUpdate(new Y.Doc())`）集成零事件** | 设计期实测 | 同上实测：E3 apply 捕获 27 bytes 与远端 diff 等长、live n=42；E4 空 diff（2 bytes）应用后 update 事件 fired=0——R-3.1「零字节 ⟺ noop ⟺ 零 dirty」判据与 A-k noop 缺省组装的机制基础 | 低 |
| P4 | 畸形 bytes（`[0xff,0xff,0x01]`）在 scratch clone 预演中 throw | 设计期实测 + 主线源码引用 | 同上实测 E5：scratch 抛 Error；主线 `protectedContentEvaluated`（b66615c replication-session.ts）同款判定 | 低 |
| P5 | emitter 管线对省略 attemptId 生成 `att-+32hex`、对 per-record context 四键做字段级清洗、code↔sourceModule 成对校验 | 现有源码引用 | `pipeline.ts:221`（CSPRNG attemptId）、`:162-201`（cleanContext）、`:239-241`（§10-J3 成对性）；#149 十四用例已验证 | 低 |
| P6 | emit 挂点微任务序（emit 在 slot 释放后、先于下一任务） | 现有源码引用 | `sequencer.ts` enqueue 机械（settled=tail.then(run); tail=settled.then(noop) 先注册、外部 .then(emit) 后注册）+ #149 §7.1 证明；AC4 队列满用例的 drop 顺序依赖此序 | 低 |
| P7 | WeakMap host 登记对 `Object.keys(runtime)` 零污染 | 现有测试引用 | 主线注释（b66615c runtime.ts V3f）：「Object.keys(runtime) 仍恰十二键，runtime-registry-internal-seam.test.ts 键集锁零改动即绿」——本票键集锁本身因公共两键扩张而更新（§15.2），WeakMap 不额外引入键 | 低 |
| P8 | 【R1 新增，SA2 #1/E-6】emission 省略 input 字段 ⇒ record 面投影恰 `{capture:'none'}`（非 not-accessed / unavailable） | 现有源码引用 + SA2 独立实核 | `packages/namespace-diagnostic-log/src/projection/input.ts:58`：`if (input === undefined) return { capture: 'none' }`；`emission.ts` §2.6 注释「省略 input 字段 ⇔ 无可捕获输入，按 none 处理」；SA2 评审 E-6 独立核对同一位点 | 低 |

**附：实测脚本与输出**（2026-08-31，本 worktree `packages/namespace-runtime` 目录下 node 直跑 yjs@13.6.32；探测 fixture 复刻红灯测试 makeDoc/buildRemoteDiff/emptyDiff 语义）：

```
E1 enable captured bytes: 92
E1a replay META.replicationId: a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6
E1a replay META.replicationEpoch: 1
E1b empty sizes ROOT/SCHEMA/META: 0 0 0
E2 bump captured bytes: 27
E2 replay epoch: 2 id kept: a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6
E2b empty sizes: 0 0 0
E3 remote diff bytes: 27 / apply captured bytes: 27 / live n: 42
E3a replay n: 42 a: x META id: a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6
E3b empty sizes: 0 0 0
E4 empty diff bytes: 2 / update fired: 0 / cap4: undefined
E5 corrupt bytes rejected by scratch preview: Error
```

**脚本可重建性注记【R1 修订，SA2 #6】**：探测脚本本体未随档（SA1 文件写权限限本设计文档——skill 硬门禁）；**机械重建路径**：红灯测试 helpers（`makeDoc` / `buildRemoteDiff` / `emptyDiff`，`runtime-replication-diagnostic-red.test.ts:107-132`）+ §16 各行的步骤描述（E1/E2 = 窗口夹 `doc.transact`；E3 = `Y.applyUpdate(doc, diff, Symbol())` 窗口捕获；E4 = 应用 `Y.encodeStateAsUpdate(new Y.Doc())`；E5 = scratch 全量装载后应用 `[0xff,0xff,0x01]`）。SA2 已按此路径独立重建并复现全部关键值（评审 E-7：92B 单事件 / 0-0-0 反向鉴别 / 空 diff fired=0 / 链式重放值 / corrupt 拒绝）——重建性已被第二方验证。

---

## §17. 契约改动连锁审计 (Contract Change Caller Audit)

### 改动函数/接口

| 函数/接口 | 文件 | 改动前契约 | 改动后契约 | throw 路径变化 |
|---|---|---|---|---|
| `NamespaceRuntime` 对象 | `runtime.ts` | 十键 | **十二键**（+enableReplication/bumpReplicationEpoch，均「不同步 throw、一切拒绝经 Promise 结算」） | 无 |
| `NamespaceLease` 对象 | `lease.ts`/`types.ts` | 九能力键 | **+openReplicationSession**（经返回 Promise 结算，不同步 throw） | 无 |
| `createLeaseController` | `lease.ts` | (entry, observer, onReleased?) | **+第 4 参 deps（必选）** | 无（唯一调用方同步更新） |
| `WriteSlot` | `write.ts` | 'root'\|'schema' | **+'replication'\|'replication-apply'**（markWriteFatal/writeFatalMessage/rejectWithWriteFatal 新分支；既有分支逐字节不变） | 无 |
| `emitAttempt`/`SlotEmissionArgs` | `diagnostic.ts` | 固定 source local / sourceModule runtime / **input 必填** | **四点扩展【R1，SA2 #1】**：+可选 source/context/sourceModule；+**input 可选化**（`SlotEmissionArgs.input`/`SlotDiag.input` 可选 + emitAttempt/emitSlot 条件展开——省略 → record 面 `{capture:'none'}`；ROOT/SCHEMA 恒传值，字节面零变化） | 无（吞没语义不变） |
| `internal.ts` 值导出 | `internal.ts` | 恰一键 | **恰两键**（+openReplicationSessionCoreForRegistry） | 无 |
| `RuntimeState` | `p0.ts` | 无复制域 | **+replication?: 内部投影**（不进公共 status） | 无 |

**无 return→throw / 同步→async / swallow→rethrow 类契约改动**：全部新函数（runEnableReplicationSlot/runBumpReplicationEpochSlot/runSessionApplySlot/openReplicationSessionCoreForRegistry）为**新建**，其 throw 行为（RuntimeWriteFatalError rejection 经 Promise）在各自联合类型注释中冻结；被修改的既有函数（markWriteFatal 等）只加分支不改既有路径。

### Caller 清单（被修改的既有符号）

| Caller | 文件:行 | 是否 await | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---|---|---|---|---|
| `markWriteFatal` / `writeFatalMessage` / `rejectWithWriteFatal`（WriteSlot 扩展的消费者） | `write.ts`（S2/S5/S6 自用）、`schema-write.ts`（同构自用）、`replication-write.ts`/`replication-session.ts`（新） | rejectWithWriteFatal 返回 Promise\<never\>，调用方一律 `return`（槽 async——异常入返回 Promise） | ✅ 槽体 catch 分类 | sequencer 链尾 noop（INV-W12） | 既有两槽零改动（'root'/'schema' 缺省分支不变）；新槽按 §9 表传 slot 参数 |
| `emitAttempt`（四点扩展的消费者【R1，SA2 #1】） | `runtime.ts:261/296`（既有 ROOT/SCHEMA acceptance emit）、新增 enable/bump/apply 挂点 | 否（同步 void） | ✅ emitAttempt 内部 try/catch 全吞（不变） | — | 既有调用零改动（缺省值=旧行为）；新调用传 source/context/sourceModule；apply/bump 槽调用省略 input（→ record `{capture:'none'}`） |
| `createLeaseController`（签名扩展的消费者） | `registry.ts:569`（唯一生产调用方；测试无直调——grep 实证） | 是（同步调用） | 否（纯构造） | — | 同步补第 4 参 `{openReplicationSessionCore: openReplicationSessionCoreForRegistry}` |
| `RuntimeState`（类型扩展的构造/消费者） | `runtime.ts`（构造 V2.5）、`replication-write.ts` E5.5、`replication-session.ts` R2/getStatus、`status.ts`（**不读复制域**） | — | — | — | status.ts 零改动（公共七键锁面保护）；新消费者全部内部面 |

### 风险评估

- 遗漏 caller 的代价：WriteSlot 分支漏传 → fatal 摘要码错槽（诊断失真，非崩溃）；emitAttempt 扩展漏传缺省 → 既有 emission 字节面变化（#149 回归测试即红——有守卫）。
- 抓全方法：`git grep -n "markWriteFatal\|writeFatalMessage\|rejectWithWriteFatal\|emitAttempt\|createLeaseController" -- 'packages/**/*.ts'`（设计期已执行：markWriteFatal 族消费者恰 write.ts/schema-write.ts 两既有 + 两新文件；emitAttempt 消费者恰 runtime.ts 既有两挂点 + 新挂点；createLeaseController 恰 registry.ts 一处）。

---

## §18. 文件清单（File Scope）

### ALLOW LIST

**新建（物化层——依赖落点，§0.2）**
- `packages/namespace-runtime/src/replication-write.ts` — 新建，§4：enable/bump 两写槽（E1–E7，主线 b66615c 逐字端口 + diag 接线 + 捕获窗口 + sessions fence 适配），约 500 行
- `packages/namespace-runtime/src/replication-session.ts` — 新建，§5：最小会话核心（host WeakMap / open 门序 / apply 槽 R1–R7 / 终态机 / fence / SessionRegistry），约 550 行

**修改（runtime 侧）**
- `packages/namespace-runtime/src/runtime.ts` — 修改，§6.1：接口+两键、V2.5 预投影、host/env 一次成型、V3f 登记、两方法体（接纳门+emit 挂点）、close() 同步段 terminateAll，约 +95 行
- `packages/namespace-runtime/src/errors.ts` — 修改，§6.3：复制稳定码族 + 两错误类（主线原值原文案），约 +55 行
- `packages/namespace-runtime/src/write.ts` — 修改，§6.3：WriteSlot 四值 + markWriteFatal/writeFatalMessage/rejectWithWriteFatal 两新分支（既有分支逐字节不变），约 +20 行
- `packages/namespace-runtime/src/p0.ts` — 修改，§6.2：RuntimeState +replication 内部域，约 +6 行
- `packages/namespace-runtime/src/diagnostic.ts` — 修改，§7：**四点向后兼容扩展**——SlotEmissionArgs +source/context/sourceModule + **input 可选化**、emitAttempt 条件展开、SlotDiag +source/context + **input 放宽为 `EmissionInput \| undefined`**、emitSlot 透传（source/context/input 三条件展开）、diagValidationCode，约 +55 行
- `packages/namespace-runtime/src/internal.ts` — 修改，§6.4：+openReplicationSessionCoreForRegistry 值导出 + 会话类型 re-export，约 +15 行

**修改（registry 侧）**
- `packages/namespace-registry/src/types.ts` — 修改，§6.5：NamespaceLease +openReplicationSession、ReplicationSession 公共类型族 + 冻结文案常量，约 +95 行
- `packages/namespace-registry/src/lease.ts` — 修改，§6.5：createLeaseController +deps 第 4 参、openReplicationSession 方法（released 门/输入形状校验/委托）、parseOpenSessionOptions + INSTANCE_ID_PATTERN 本地常量，约 +85 行
- `packages/namespace-registry/src/registry.ts` — 修改，§6.5：issueLease 处传 deps（+1 import +1 实参），约 +5 行

**修改（存量测试键集更新——公共面扩张的必然改面，§15.2）**
- `packages/namespace-runtime/test/runtime-close-lifecycle.test.ts` — 修改，键集断言十键→十二键（`:159`）
- `packages/namespace-runtime/test/runtime-registry-internal-seam.test.ts` — 修改，runtime 键集（`:270`）十→十二；internal 值导出键集（`:123`）+1 键
- `packages/namespace-registry/test/registry-open.test.ts` — 修改，lease 键集（`:879`）+openReplicationSession

**SA6 owned**
- `packages/namespace-runtime/test/runtime-replication-diagnostic-red.test.ts` — `[SA6 owned]` 红灯验收测试。**SA6 依其报告注记 2 协议修订两处 fatal 码字面量**（R-3.2：`NSRT-FATAL-REPLICATION-APPLY-WRITE-INTERNAL` → `NSRT-FATAL-REPLICATION-APPLY-INTERNAL`，断言语义不变）；SA3 禁改断言逻辑

**R2 修订追加（SA4 R1 F3——8 个实际改动文件的显式收容；代码不回滚，理由见各条）**
- `packages/namespace-registry/test/registry-idle.test.ts` — 修改，stub runtime 补两键 loud stub（`REPLICATION_NOT_STUBBED` 显式失败）——十二键类型面强制收容，零断言改动（SA4 逐 diff 核实）
- `packages/namespace-registry/test/registry-shutdown.test.ts` — 修改，同上 loud stub 收容
- `packages/namespace-registry/test/registry-sa7-hostile.test.ts` — 修改，同上 loud stub 收容
- `packages/namespace-registry/test/registry-sa7-rev1.test.ts` — 修改，同上 loud stub 收容
- `packages/namespace-registry/test/registry-sa7-concurrency.test.ts` — 修改，同上 loud stub 收容
- `packages/namespace-registry/src/index.ts` — 修改，+7 个 type-only re-export（`OpenReplicationSessionIssueCode`/`OpenReplicationSessionOptions`/`OpenReplicationSessionResult`/`ReplicationSession`/`ReplicationSessionApplyRefusalCode`/`ReplicationSessionApplyResult`/`ReplicationSessionStatus`）——公共复制会话类型的公共面收容（主线 b66615c registry index 同款）；零运行时值导出（registry-surface「恰九个 value」断言绿）
- `packages/namespace-runtime/package.json` — 修改，仅 version bump 0.1.8→0.1.9（触及包版本纪律——#167 `722bddf` 先例同款；lockfile 零 diff 属预期，workspace 版本不入 lockfile）
- `packages/namespace-registry/package.json` — 修改，仅 version bump 0.1.3→0.1.4（同上）

**R2 修订追加（SA4 owned 探针——修复后转绿的复现面）**
- `packages/namespace-runtime/test/runtime-replication-sa4-probe.test.ts` — `[SA4 owned]` F1/F2 复现探针（2 用例，SA4 评审 §附；修复前 2 failed = 缺陷可执行证据，修复后转绿入树）——SA4 自有产物，非 SA3 改动面

### DENY LIST

- `packages/namespace-diagnostic-log/**` — #148/#156/#159/#166 冻结的词表/emitter/adapter，本票纯消费方零改动（§1.1/P5）
- `packages/namespace-runtime/src/index.ts` — 公共导出面零变化（exports-audit 一键锁；两方法在 runtime 对象上不在 index）
- `packages/namespace-runtime/src/sequencer.ts` — emit 挂 then 链，机械零改动
- `packages/namespace-runtime/src/close.ts` / `status.ts` / `projection.ts` / `plain-data.ts` — barrier/公共七键 status/投影零改动（close fence 在 runtime.ts close() 同步段；state.replication 不进 buildStatus）
- `packages/namespace-runtime/src/schema-write.ts` — SCHEMA 槽零触碰（其 diag 调用形态经 diagnostic.ts 缺省值保持）
- `packages/namespace-registry/src/testing.ts` — runtimeFactory 通道零改动（§6.5）
- `packages/doc-runtime/**` / `packages/persistence/**` / `packages/dsh-persistence/**` / `packages/vfsl*/**` / `packages/clock/**` — 非接线对象
- `packages/namespace-runtime/test/*.test.ts` 与 `packages/namespace-registry/test/*.test.ts` 中**非 ALLOW LIST 已列文件**者 — 存量冻结行为测试零改动（全绿即回归证明）。【R2 修订收窄，SA4 F3】本条原措辞「非上述三文件、非红灯文件」的完备性声明有缺口：五个含 `implements NamespaceRuntime` 替身的 registry 测试因十二键扩张被 TS 结构类型**强制**要求补 loud stub（不补即 CI typecheck 断）——该五文件 + SA4 探针已上移 ALLOW（带 F3 理由），**原 DENY 对该五文件显式解除**；除此之外的存量测试仍零改动
- `pnpm-lock.yaml` — 零新增依赖（workspace 链接已存在：registry→runtime、runtime→diagnostic-log 均已登记），预期无 diff【R2 注：两 package.json 仅 version bump，workspace 版本不入 lockfile——SA4 F3 实测零 diff，本条声明维持】

---

## 附：SA2 反馈逐条回应（R1 修订，2026-08-31——reject 窄域闭合）

> 评审输入：`wiki/raw/task_trusted-replication-management-diagnostic-change-log_sa2_review.md`（verdict reject（窄域）；攻击点 #1 MAJOR / #2 / #3 必须，#4/#5/#6 登记）。修订均为实质改动（代码块/表格行/排程序），非「承认但不改」。

| SA2 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|---|:--:|---|---|
| #1【必须·MAJOR】声明第四点向后兼容扩展（input 可选化 + emitSlot/emitAttempt 条件展开，ROOT/SCHEMA 字节面零变化）；§9.3 表明示 apply 槽内行 record 面 `input.capture==='none'`；§17/§18 同步 | ✅ | §2 D-5 / §7（标题+代码块+四点清单+record 面投影冻结段）/ §9.3 表头注（三态词表：not-accessed / unavailable / 省略→`{capture:'none'}`，含「committed 记录携带 not-accessed 即契约违规」禁则与 SA6 可选断言锚）/ §17 改动函数表 emitAttempt 行 / §18 ALLOW LIST diagnostic.ts 行（+55 行） | `SlotEmissionArgs.input` 与 `SlotDiag.input` 可选化（`EmissionInput \| undefined`；apply/bump 槽 diag 以 `input: undefined` 构造）；`emitAttempt`/`emitSlot` 条件展开 `...(input !== undefined ? {input} : {})`；emission 省略 → record `{capture:'none'}`（证据 P8：`projection/input.ts:58`） |
| #2【必须】§9.2 补 bump E4 corrupt fatal 行 + META-absent/disabled 分野注记 | ✅ | §9.2 表新增 B-e′ 行（E4 readReplicationFacts corrupt throw → capability-gate / NSRT-FATAL-REPLICATION-WRITE-INTERNAL / write-slot-internal / fatal committed:false）+ 表下「bump 与 enable 的 E4 出口分野」注记（corrupt 两槽同 fatal；META 载体缺席在 bump 经 disabled 出口归并 B-e——主线「两键真缺席与载体缺席在此同拒」原文；enable E-h 是安装写专属守卫）+ B-e′ 红灯锚（SA2 §4.2 seedForTest 构造建议） | 表完备自洽：bump 9 结局点（原 8 行 + B-e′），与 enable 11 结局点、apply 13 结局点对齐 |
| #3【必须】§11 写明硬排程序：SA6 两处字面量修订先于 SA4 转绿验证落地 | ✅ | §11「SA6 侧前置动作」扩为三段：修订内容（含 `:729`/`:782` 位点与 commit 审计链建议）/ **硬排程序（scheduling gate）：SA3 实现 → SA6 字面量修订 → SA4 转绿验证**，并点名「修订未先行时用例 11/12 的字面量失败是排程序违约信号、不是 SA3 返工信号」/ 转绿边界声明（+SA6 两个可选断言锚不阻塞） | 流程闭合条件显式化，总控排程据此排序 |
| #4【建议】SA7 抽 diff 物化文件 vs `b66615c` 对账 R-3/L1–L6 | ✅（登记） | §15.7(a) | 语义 diff 逐差异点对账三仲裁 + 六局限 + 接线新增行豁免说明；登记外差异即红 |
| #5【建议】SA7 以 `updateCapture:false` 跑 replication apply 断言 update-omitted + 冻结 reason | ✅（登记） | §15.7(b) | `committed + update-omitted` + reason 预期 `update-capture-disabled`，业务 ok:true 不变——AC3 显式分置的活链路兑现 |
| #6【建议】探测脚本随档或注明可机械重建 | ✅（择替代方案） | §16 脚本可重建性注记 | SA1 文件写权限限本设计文档（skill 硬门禁），脚本本体无法落盘；改为注明机械重建路径（红灯 helpers `:107-132` + §16 步骤描述）+ SA2 E-7 已独立重建复现全部关键值（第二方验证） |

**一致性自检**（修订后全文执行）：`三点` 残留 0 处（§2 D-5 / §7 / §14.1 / §15.1 / §17 / §18 全部改为「四点」并同步内容）；`capture:'none'` 语义在 §7 / §9.2 注 / §9.3 表头注 / §16 P8 / §17 五处口径一致（省略 emission input ⇒ record `{capture:'none'}`，与 not-accessed/unavailable 严格三分）；`NSRT-FATAL-REPLICATION-APPLY-INTERNAL` 全文字面量唯一（旧字面量仅存于 R-3.2 / §11 / §18 的「修订对象」引述上下文）；B-e′ 行标签与 §9.2 锚注、§11 可选锚引用一致。

---

## R2 修订记录（SA4 R1 F1/F3 闭合，2026-08-31）

> 评审输入：`wiki/raw/task_trusted-replication-management-diagnostic-change-log_sa4_review.md`（verdict reject；F1 P0 / F2 P1 回流 SA3 修实现，F3 P2 回流 SA1 补文档）。SA1 动作仅文档（本节 + §15.2 + §18 + F1 注记）；**生产与测试代码零触碰**（skill 硬门禁）。F2（enable E3 成功后 `diag.input = {snapshot}` 赋值）是纯实现缺陷，设计的 §9.1 表 E-f…E-k input 列（snapshot）与 #149 `diagInputReady` 先例已正确表达契约——SA3 按修复方向落地即可，无需设计修订。

| SA4 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|---|:--:|---|---|
| F1（P0）SA1 同步：§13.5/§3「零 update 订阅」措辞收窄为 enable/bump 槽；apply 窗口是 R-3.1 业务判据载体必须无条件；设计补注防后续轮次回退 | ✅ | §3 补充隔离 / §8 apply R5 窗口代码注 / §13 边界 5 | 三处统一「窗口订阅分化」措辞：enable/bump E5 窗口 = 纯诊断附件（diag 条件）；**apply R5 窗口 = 无条件业务事实源**（capturedUpdate 是 R6 notifyDirty 门控唯一判据，无诊断基线同构成立；与 beforeTransaction 二分探针同待遇）；仅 `diag.updateBytes` 赋值保持 diag 条件；明文禁则「禁止任何后续轮次把 apply 窗口退化为 diag 条件」+ 退化后果（无日志基线 apply 静默零持久化，ADR-0006 触发器悬空） |
| F3（P2）8 个实际改动文件补进 §18 ALLOW LIST（5 测试替身字面命中 DENY——不接受回滚） | ✅ | §18「R2 修订追加」两组 + DENY 兜底条目收窄 + §15.2 两条补录 | ALLOW 追加：五个 registry 替身测试（loud stub `REPLICATION_NOT_STUBBED`，typecheck 强制收容、零断言改动）、`registry/src/index.ts`（+7 type-only re-export，主线同款、零运行时值）、两 package.json（仅 version bump，#167 先例）；DENY 兜底条目改「非 ALLOW LIST 已列文件」并对五文件显式解除（带 F3 理由）；pnpm-lock 条目补 R2 注（workspace 版本不入 lockfile，零 diff 维持） |
| F3 附带：SA4 探针文件入树后的 scope 覆盖 | ✅ | §18「R2 修订追加（SA4 owned）」 | `runtime-replication-sa4-probe.test.ts` 以 `[SA4 owned]` 入 ALLOW（修复后转绿入树）——防下一轮 scope 比对再报 |
| F1/F2 代码修复 | ➖（非 SA1 动作） | — | 回流 SA3：F1 = `replication-session.ts` R5 窗口无条件化（SA4 §F1 修复方向，与 §8 修订后的设计契约一致）；F2 = `replication-write.ts` E3 成功分支 `diag.input = {snapshot:{replicationId}}` 一行（§9.1 表既有契约，镜像 `diagInputReady`）。SA4 探针 A/B 转绿 + 红灯 15/15 不回归 = 复验面 |

**R2 一致性自检**：窗口条件性措辞三处（§3/§8/§13.5）与 §2 流程图 R6 行、§9.3 A-j/A-k 的 R-3.1 判据表述同构（capturedUpdate 业务判据 ⟺ 无条件窗口）；§18 ALLOW 现覆盖 `git diff --name-only 722bddf HEAD` 全部 24 个代码/测试文件（源码 11 + 测试 9 + index.ts + package.json×2 + 红灯文件——SA4 E-1 的 33 文件含 wiki 文档 9 个，非 scope 比对面）；DENY 无条目与 ALLOW 重叠。
