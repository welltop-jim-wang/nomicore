# 架构设计 — Issue #226 创建诊断覆盖与日志生命周期隔离（design, iteration 4 recovery）

- 任务：Issue #226（bugfix）— `wiki/raw/task_issue-226.md`（Parent PR #142）
- Worktree：`/home/wangjian/nomicore-fix-issue-226`（branch `mabf/issue-226`，HEAD `45a22f060eee924e4ed6a2d6fa64fb7cd6b2db08`）
- 派发标识：Host correlation `sa-8eafa2dd-4d4e-4524-a2b1-43da97be5827`（mabf-sa1 / design / iteration 4，child `0a3639b7`，label `issue-226-sa1-design-r4`）。**本文件为恢复重派（recovery respawn）轮产出**：此前 SA1 design 派发（iteration 0–3，盘上旧稿与 `task_issue-226_design_round2.md`）均未形成 durable settlement，**不是本轮输入**；本轮一切关键主张（代码锚点、微任务序、契约锚文本、ADR 引文、静态守卫正则）均由本轮亲自读源码/测试/规范重新核验（核验记录 §11）。本会话早段曾误以总控身份调用 `mabf_runner_start_task`（返回 already-active，零状态变更）与 `mabf_runner_start_sa`（被拒"dispatch sa-8eafa2dd is running"——该 running dispatch 即本会话自身，零状态变更），此后未再触碰 MABF 管理工具。
- 输入产物（Phase 0 已验收）：`task_issue-226.md`（简报 AC1–AC5）、`task_issue-226_sa5.md`（独立复现与分析）、`task_issue-226_sa6_red.md`（红灯契约固话/审计 R0）、`task_issue-226_conflict_report.md`（SA8 clear，R5 维持）、`task_issue-226_relevant_decisions.md`（规范摘录 + 设计敏感点 1–5）；红灯契约两文件（只读）。
- 规范基准（normative；ADR-0010 #172 修订 2：wiki/raw 非规范）：`docs/adr/0011-best-effort-namespace-diagnostic-change-log.md`、`docs/adr/0012-vfsl-validated-jsonl-and-framed-sidecar-change-log.md`（诊断日志版，含 2026-08-28 File adapter first slice amendment）、ADR-0008/0009/0010/0006 被引条款、根 `CONTEXT.md` 词条（namespace 诊断变更日志 / 变更尝试 / 语义 emission / storage projection / genesis baseline record / 诊断日志 stream generation / 写序列器）。
- 本轮边界：**仅设计，不实现生产修复**（`src/**`、`apps/**` 零改动）；红灯契约文件与一切既有测试零改动（§10 修订集是提给 SA6/总控的裁决项）。本轮唯一写入 = 本文件。

---

## 0. 结论摘要（TL;DR）

| 项 | 结论 |
|---|---|
| 缺口 A（AC1 归属）修复机制 | 建流前早结局改为**以候选 namespaceId 数据键控投递**：create 槽内 O(1) 组装语义 emission（载荷/observedAt 捕获点与现状完全同位）并入队；由 Registry 内部 **per-namespace 延迟投递泵**在业务槽外解析 `runtimeEmitterFor(候选ns)` 并 emit。被拒 create 由泵先经 `initStream(ns, undefined)` 建流（无 genesis——诚实缺席）再落结局记录（T11 落盘面） |
| 缺口 B（AC3/AC4 隔离）修复机制 | 一切可能触碰存储的 seam 调用（`initStream` 建流、`runtimeEmitterFor` 解析/adapter 构造、ns-bound emit）全部移出 Registry lifecycle carrier 槽与 Runtime write-sequencer 槽间窗口，改由泵在 macrotask（`setImmediate` 级）drain 中执行；carrier 槽内/sequencer 窗口内的残余日志工作 = O(1) 纯内存操作 |
| 隔离载体形态 | **amendment L250 选项 (a)：延迟同步 append（只移调用点）**。泵 ≠ ADR-0012 L252 的「逻辑 writer queue」切片：adapter 仍是首切片同步 append，泵不做 batch / 周期 flush / fsync、不拥有 stream 写入语义 ⇒ 不触发 L252 四类额外语义义务（§3.1 边界论证） |
| Runtime 包 | **零生产改动**（B3 由生产 wiring 侧延迟 wrapper 解决；任何 Runtime 侧发射时机改动都会击穿 #149 冻结绿锚 `emitCalls===2`，§10.2 证明） |
| Host（apps/yjs-server） | 零强制改动（binding 三成员名与 sync-only 契约不变；头注释更新可选） |
| ⚠️ 契约可实现性裁决（本轮独立） | **冻结红灯契约 T8/T9/T10/T12/T13 的顺序锚在任意实现下数学上不可满足**（结算标记 push 与同步 `indexOf` 断言之间无任何可执行调度点——存储完成事件要么早于标记〔顺序失败〕要么缺席〔-1 失败〕，微任务位置逐一枚举排除，§10.1）；**T12/T13 与 #149 AC4 同步锚互斥**（§10.2）；**新发现：#155 SA7 应用层 E2E 三处锚冻结了缺陷 A 行为本身**（B 的早结局必须落 unattributed 丢弃、B 必须无日志目录——AC1 兑现必翻红，§10.3） |
| 修订集 | **R1**（T8/T9/T10 顺序锚改「到达 poll + 顺序」）/ **R2**（T12/T13 注入形状 wrapper 化）/ **R3**（#155 SA7 C1 锚改 #226 后语义）为阻断项；R4（守卫注释固化 `setImmediate` 许可）为推荐项。修订后各锚仍证明修复前失败（§10.4） |
| verdict | **conflict**（契约层冲突；ADR 层设计合规）→ `requiresConflictRecheck: true` |

---

## 1. 缺陷机制回顾（本轮独立核验的锚点）

以下全部锚点为本轮直接读源码实测（行号以 HEAD `45a22f0` 为准）。

### 1.1 缺口 A：建流前 create 早结局被无归属通道确定性丢弃

- `packages/namespace-registry/src/create-diagnostic.ts`（本轮通读）：
  - `createCreateDiag`（L310–328）构造期一次读取共享 `diagnosticLog.emitter`（形状门：违约 → `NOOP_DIAG`），此后 emit 侧只用该引用；
  - `emitOutcome(observedAt, e)`（L334–336）与 `emitEarlyOutcome(e)`（L338–342）——Registry 槽内结局的**全部**发射面——**恒走构造期捕获的共享 emitter**，不携带也不解析任何 namespaceId；
  - 唯二的 namespace 数据键控路径：`emitStreamOutcome(namespaceId, …)`（L354–365，经 `resolveEmitterOnce(streamResolver, namespaceId)` 现场解析，三态路由含 legacy 回退）与 `initStream(namespaceId, bytes)`（L370–379，Host 违约同步 throw 被吞没）。
- `packages/namespace-registry/src/registry.ts` `runCreateAttempt`：发射点实测 **8 处全部建流前**——L1316 `emitEarlyOutcome`（input-snapshot 拒绝）、L1328 `emitOutcome`（schema-compile / validation 拒绝）、L1364 / L1379 / L1394 `emitOutcome`（create-document-internal fatal 三路）、L1411 `emitOutcome`（`DocCreateOperationalError` → `NAMESPACE_CREATE_FAILED`）、L1419 / L1427 `emitOutcome`（Persistence fatal 两路，保留 committed 事实）；L1436 `diag.initStream(id.namespaceId, state?.slice())`（建流缝）、L1450 / L1463 `emitStreamOutcome`（#17 committed / #18 runtime-construction fatal，建流后数据键控）。槽内 `id.namespaceId`（受控 128-bit CSPRNG 候选 id，ADR-0010 L28）自 L1311 起始终在手上——**归属锚在发射时点已可用**。
- 生产供应方 `apps/yjs-server/src/diagnostics.ts`：L74–76 `unattributedEmitter = { emit: () => drop(closed ? 'manager-closed' : 'unattributed') }`——恒丢弃 + NDJSON 计数、零路由；L114–128 binding 三成员（`emitter` / `initStream` → `ensureAdapter` / `runtimeEmitterFor(ns)` → 缓存查表/构造）。⇒ 生产 wiring 下 §1.1 的全部建流前结局零归属、零落盘，被拒 create 无后续 stream 可补记（T11 落盘面）。
- 冻结 seam 形状（`registry/src/types.ts` L720–724）：`{ emitter; initStream?; runtimeEmitterFor? }`——**修复不得新增成员名**（SA8/SA5 红线）。

### 1.2 缺口 B：同步日志 I/O 位于业务关键路径

- **B1（create carrier 槽内建流 + 同步 append）**：`registry.ts` L1436 `initStream`（→ Host `ensureAdapter` → `createFileDiagnosticLog` 构造器全同步 fs：recursive mkdir / manifest `'wx'` / genesis append / current.json temp+rename / reopen 健康分析 / 构造期 retention sweep）与 L1450/L1463 `emitStreamOutcome`（→ 每 record 独立 `appendFileSync`，`namespace-diagnostic-log/src/adapters/file.ts` L684/L699，无队列/batch/fsync）均位于 `runCreateAttempt` 槽内；槽经 `admitCreateAttempt`（L1297–1305）串行化在同 key lifecycle carrier 上。
- **B2（open/import 槽内 adapter 构造）**：open 槽 `registry.ts` L1229 `factory(handle, saveDoc, resolveRuntimeDiag(identity.namespaceId))`（import 槽同款 L1584；create 槽 L1440）——`createRuntimeDiagResolver`（create-diagnostic.ts L286–297）现场调 `runtimeEmitterFor(ns)`，缓存 miss 时同步构造 File adapter（reopen 健康证明 / 尾部修复 truncate / 构造期 retention sweep）。
- **B3（Runtime write-sequencer 槽间窗口同步 emit）**：本轮独立重建微任务序——`sequencer.ts` L38–42 `enqueue`：`settled = this.tail.then(run, run); this.tail = settled.then(noop, noop)`——**noop hop 在 enqueue 内先注册**；公共方法（`runtime.ts` L470–475 root-write、L491–494 schema-write、L515–518 enable-replication、L536–539 bump-epoch 等）在 `enqueue` 返回后注册 `settled.then(emitSlot)`（**注册序晚于 noop hop**）并 `return settled`；close barrier 经同一 `enqueue` 挂接（`close.ts` L38–40）。槽 N settle 时 settled 的回调按注册序入微任务队列 = `[noop_cb, emitSlot_cb, …]`：noop 先跑 → tail resolve → 下一槽 `run`（或 close barrier `run`）排到队尾（emitSlot 之后）⇒ **emitSlot 的同步 `emit` 恰落在「本槽释放 → 下一槽启动」关键窗口**；且 emitSlot 注册先于调用方 await 续段注册，慢 emit 同时推迟调用方结算（T12 墙钟 100ms 的机制根源）。#149/#151 注释（diagnostic.ts 头「slot 已释放之后」）只覆盖**相对上一槽**，未覆盖**相对下一槽**——emit 仍在 sequencer 关键路径上。

### 1.3 基线复现（本轮，后台 Job `bash-1`）

```bash
pnpm test packages/namespace-registry/test/registry-issue-226-red.test.ts \
          packages/namespace-runtime/test/runtime-issue-226-red.test.ts
# Test Files  2 failed (2)
#      Tests  12 failed | 1 passed (13)     ← T7 GREEN 对照唯一通过
# Type Errors  no errors        Duration 11.76s
```

与 SA5/SA6/verify3–6 各轮完全一致（红灯稳定，非环境噪声）。T12/T13 本轮实测先触发墙钟锚（101ms > 50ms）；墙钟满足后顺序锚仍将失败（§10.1 证明其不可满足）。

---

## 2. 设计总览：三支柱

```
┌─ Registry create/open 槽（lifecycle carrier 内，O(1) 纯内存）─────────────┐
│ 业务步骤不变（ADR-0009 L62 槽内清单原样；open/create/import 三处 factory   │
│ 第三参改为 O(1) 解析）。日志工作 = 组装语义 emission 载荷（载荷捕获点、    │
│ observedAt 纪律与现状逐字节同位）+ 入队 per-ns 泵（enqueue O(1)）          │
└──────────────┬─────────────────────────────────────────────────────────────┘
               │ enqueue（槽内/槽间窗口内，非阻塞内存操作）
               ▼
┌─ per-namespace 延迟投递泵（diag-pump，Registry 内部新模块）────────────────┐
│ 任务：{initStream(ns, bytes?)} | {emit(ns, emission)}                     │
│ per-ns FIFO + per-ns 单飞 drain；调度 = setImmediate 级 macrotask；        │
│ 有界 drop-newest；与 shutdown 零耦合；drain 全程非抛                      │
└──────────────┬─────────────────────────────────────────────────────────────┘
               │ drain 内（业务槽外）同步调用冻结 seam（成员名零新增）
               ▼
   Host binding（零改动）：initStream(ns, bytes) / runtimeEmitterFor(ns)
   → ensureAdapter（同步 fs：建流/reopen/repair/retention sweep）
   → ns emitter.emit（首切片同步 append——调用点已移出业务路径）

┌─ Runtime 包：零生产改动 ───────────────────────────────────────────────────┐
│ 发射调用点不动；生产 wiring 中 Runtime 收到的 emitter 是 Registry 解析器    │
│ 产出的**延迟 wrapper**（emit = O(1) 入队）⇒ B3 在生产路径消失；            │
│ 测试直接注入 seam 的既有契约（#149 AC4 emitCalls===2 等）不经 wrapper，    │
│ 行为零漂移                                                                │
└─────────────────────────────────────────────────────────────────────────────┘
```

- **支柱一（归属，AC1）**：早结局以候选 namespaceId 走数据键控通道（泵任务 → `runtimeEmitterFor(候选ns)` → emit）；被拒 create 由泵建立 genesis-less 流。
- **支柱二（隔离，AC3/AC4）**：一切存储触碰移入泵 drain（macrotask，业务排序路径之外）；open/create/import 槽对日志只做 O(1) 捕获与入队。
- **支柱三（wiring，B3）**：Runtime 发射时机不动；生产 emitter 换为延迟 wrapper，槽间窗口的 emitSlot 调用变为 O(1)。

---

## 3. 组件设计

### 3.1 diag-pump（新内部模块 `packages/namespace-registry/src/diag-pump.ts`）

**职责**：把「可能触碰存储的 seam 调用」从业务槽内/槽间窗口搬到 macrotask 级 drain；per-namespace FIFO 保序。

**任务类型**（判别联合，纯数据）：

```ts
type DiagPumpTask =
  | { kind: 'init-stream'; namespaceId: string; genesisUpdateBytes: Uint8Array | undefined }
  | { kind: 'emit'; namespaceId: string; emission: NamespaceDiagnosticChangeEmission };
```

（`emit` 任务携带**已组装完成**的语义 emission record——组装（含 issues 投影、observedAt）全部发生在捕获点（槽内，纯 CPU、无 I/O），drain 只做解析 + `emitter.emit(record)`。载荷捕获点与现状同位 ⇒ AC2 纪律与 `observedAt` 单源（DC-3：早结局单次 clock 读 / 槽内结局复用 createdAt）零漂移。）

**结构**：`Map<namespaceId, { queue: DiagPumpTask[]; draining: boolean }>`；每 ns 独立 FIFO、独立单飞 drain。

- **调度**：入队后若该 ns 未在 drain，则 `setImmediate(drainNs)` 一次（单飞：drain 中重复入队只补一次调度）。drainNs 同步顺序执行该 ns 队列全部任务（每任务 = 一次 seam 调用，首切片同步 append 语义不变），完毕置 `draining=false`。
- **为什么是 `setImmediate`（macrotask）而非其它**（设计敏感点 1 的裁决依据）：
  1. **微任务级 deferral 不足**：T9/T13 的语义要求日志 I/O 排程不先于 shutdown/close 结算续段；微任务 hop 仍在同一轮 PromiseJobs 排空内（§1.2 的 B3 机制正是微任务序），无法把存储搬出「槽释放 → 下一槽启动」窗口的判定域。
  2. **注入式 scheduler 结构性不可用**：registry 测试注入的 `createRegistryTestScheduler()`（testing.ts L77–110）是纯 Map fake——timer 只在 `advanceBy` 时触发；#226/#150/#155 契约测试均不 advance ⇒ 经注入 scheduler 调度的泵在测试下永不触发（早结局永远到不了 poll 判据 → 伪红）。注入 scheduler 仍是**时间**的唯一来源（泵不用时间）。
  3. **静态守卫合规**：`registry-surface.test.ts` §2.M 三正则逐字符核对（L279–284）——`HOST_GLOBAL_TIMER_BARE = /(?<![\w$.])(?:setTimeout|setInterval|clearTimeout|clearInterval)\s*\(/`、`HOST_GLOBAL_TIMER_GLOBALTHIS`（同四名 + globalThis 前缀）、`DATE_NOW`——**均不含 `setImmediate`** ⇒ 泵源码裸调 `setImmediate(` 不命中任何守卫，无需豁免（R4 建议把该许可写成守卫测试注释契约）。
  4. **环境**：registry 为服务端包（node 部署面：yjs-server）；node 恒提供 `setImmediate`。不做非 node 降级分支（包不支持该面，多余分支徒增守卫与审查面）。
- **有界与丢弃**：per-ns 队列容量上界（缺省 256 任务；可经构造 options 覆盖，不进公共面）。满 → **drop-newest**（保留已排队顺序——ADR-0011 L240 精神），静默丢弃。泵不是耐久结构：诊断是 best-effort observability，有界内存是隔离义务本身（ADR-0011「有界」接收），不承诺零丢。
- **非抛**：drain 全程 try/catch 收编——`resolveEmitterOnce` 既有非抛边界复用；`emit` 的同步 throw 由 `emitAttempt` 同款吞没边界收编（或等价地 drain 内逐任务 try）。Host 任何违约不外溢。
- **挂起隔离**：某 ns 的存储挂起（如 initStream 永不返回）只饿死该 ns 自己的 drain（per-ns 单飞），不阻塞其它 ns 的诊断投递，更不触及任何业务路径（drain 本就在业务路径外）。
- **寿命**：泵随 Registry 实例构造（`createCreateDiag` 装配点旁）、随实例 GC。**与 shutdown 零耦合**：不清泵、不等待、不注册 disposer（§7.5）。
- **不是「逻辑 writer queue」（ADR-0012 L252 边界论证）**：L252 管辖的是**以每 stream 至多一个逻辑 writer queue 替换 adapter 的同步 append**（batch / 周期 flush / fsync / 队列满四类语义义务的由来）。本设计中 adapter 的存储语义**一字未动**——每个 record 仍由 drain 内一次同步单-record append 落盘；泵只改变**调用点位置**（amendment L250 明文授权的「位于 write sequencer slot 之外」路径 = 选项 (a)）。泵自身的有界/丢弃是其作为调用方侧缓冲的局部纪律，不构成 stream 写入语义。若未来演进到 adapter 内 queue/batch，另行按 L252 定义四类语义——本设计明确不选该路。

### 3.2 `create-diagnostic.ts` 改造（发射面路由；`registry.ts` 槽体零改动）

`CreateDiag` 接口（方法名/签名）与 `registry.ts` 全部发射调用点（§1.1 清单）**保持不变**——改造全部收敛在 `createCreateDiag` 内部路由与 `createRuntimeDiagResolver`：

1. **构造期**：`streamResolver` 在场（Host 提供 `runtimeEmitterFor`）⇒ 同时构造泵实例；缺席 ⇒ 不构造泵，走 legacy 路径（见 4/5 的回退分支）。
2. **`emitOutcome` / `emitEarlyOutcome`（早结局，8 个调用点）**：resolver 在场 → 组装语义 emission（载荷/observedAt 与现状同位）后入队 `{emit, 候选ns, record}`，**并且若该 ns 尚无流**（被拒 create 无后续 stream）→ 先入队 `{init-stream, ns, undefined}`（同 ns 队列内建流在前、结局在后——与成功 create 的 initStream→#17 次序同构）。无 genesis bytes：被拒 create 无 committed doc，`initStream(ns, undefined)` 在既有签名域内（`bytes: Uint8Array | undefined`），不伪造 genesis-baseline（ADR-0012 L24：genesis 只代表某时点的完整 Y.Doc——无 doc ⇒ 诚实缺席；T11 只要求目录与文件存在）。Host 缺 `initStream` 成员（可选成员）→ 跳过建流任务，只投递 emit（resolver 在场而 initStream 缺席的 Host 形状：emit 仍数据键控，落盘与否由 Host 决定——Registry 不越权）。
3. **`initStream(namespaceId, bytes)`（成功路径建流）**：resolver 在场 → 入队 `{init-stream, ns, bytes}`（槽内 O(1)）；缺席 → 维持现行同步调用。
4. **`emitStreamOutcome(namespaceId, observedAt, e)`（#17/#18）**：resolver 在场 → 组装后入队 `{emit, ns, record}`（B1 的 emit 面搬移）；resolver 缺席 → **legacy 回退保持逐字节现行**（同步共享 emitter——#150 时代缓冲型 Host 的既有行为）。
5. **`createRuntimeDiagResolver`（B2+B3 的 wiring 支柱）**：resolver 在场时返回的 `RuntimeDiagResolved.emitter` 改为**延迟 wrapper**：`{ emit: (record) => pump.enqueueEmit(ns, record) }`（O(1) 非抛）；`clock: () => clock.now()` 不变。open/create/import 三处 factory 第三参（registry.ts L1229/L1440/L1584）由此变为 O(1)——**B2 的 adapter 构造与 B3 的生产 emit 同时出槽/出窗口**。wrapper 形状 = 既有 emitter seam（同步、void、不 throw）——Runtime 零感知、seam 冻结不破；observedAt 已在 record 组装时由注入 Clock 定源（AC2 同源纪律保持）。

**路由三态总表**（与 #155 `emitStreamOutcome` 既有三态路由同构，判据同为「resolver 是否静态在场」——无跨续段可变路由状态）：

| Host 形状 | 早结局（8 点） | initStream | #17/#18 | open/create/import 第三参 |
|---|---|---|---|---|
| 生产形状（有 `runtimeEmitterFor`） | 泵：建流(无 genesis)+emit，候选 ns 数据键控 | 泵任务 | 泵任务 | 延迟 wrapper（O(1)） |
| legacy 形状（无 `runtimeEmitterFor`，#150 缓冲型） | **同步共享 emitter（现行行为逐字节一致）** | 同步调用 | 同步共享 emitter（现行） | `undefined`（现行两参行为） |
| 违约（resolver 在场但解析 throw/畸形） | 泵 drain 内静默丢弃（既有 D11 边界） | 同左 | 同左 | wrapper 仍在（emit 时 drain 内丢弃） |

### 3.3 `registry.ts` 改动面

**槽体与发射调用点零改动**（§3.2 第 5 点覆盖的三处 factory 调用点签名不变——第三参仍由 `resolveRuntimeDiag(ns)` 产出，只是产物内部换成 wrapper）。唯一 wiring 点：`createCreateDiag(options.diagnosticLog, clock)`（L776）与 `createRuntimeDiagResolver(options.diagnosticLog, clock)`（L779）需共享同一泵实例——把两构造合并为单一装配函数（如在 create-diagnostic.ts 内新增 `createDiagRuntime(diagnosticLog, clock): { diag; resolveRuntimeDiag }`，registry.ts L776–779 改一行调用）。公共入口 acceptance/identity 拒绝（id 生成前，`registry.ts` create 入口段）的 `emitEarlyOutcome` 维持同步共享通道（无归属可用，非缺陷 A 对象——§7.2）。

### 3.4 Runtime 包与 Host：零改动论证

- **Runtime**：`sequencer.ts`/`runtime.ts`/`diagnostic.ts`/`close.ts` 零改动。B3 的修复完全在生产 wiring（Registry 供应的 emitter 是 wrapper）；直接注入 seam 的测试（#149 全部、#226 T12/T13）不经 wrapper，其观测行为与本设计正交（§10.2）。任何「Runtime 自己延迟 emitSlot」的方案都会把 seam 调用移出调用方续段 ⇒ #149 AC4 `emitCalls===2` 同步锚翻红——本设计显式排除该方案族。
- **Host**：`diagnostics.ts` 零强制改动。binding 三成员名/签名/sync-only 契约不变；泵从 Registry 侧调用既有成员。头注释中「全部 initStream 之前的 create emission 落此通道」的表述随 #226 兑现而过时——建议 SA3 顺带更新注释（文档级，非契约）。

---

## 4. AC 逐条兑现

| AC | 兑现机制 |
|---|---|
| **AC1**（建流前结局归属入流） | 8 个早结局发射点经泵以候选 ns 数据键控投递（§3.2.2）；被拒 create 由 `initStream(ns, undefined)` 建流后落记录（T11 落盘面）；duplicate 族维持既有登记（§7.2——entry 碰撞重试与 DOC_DUPLICATE 重试零发射（#150「恰一条最终结局」），id 耗尽 fatal 零发射（§7.1））。T1–T6 判据（poll 到达 + 内容锚 + `unattributedDrops===0`）全部满足：载荷组装与现状同位（stage/code/sourcePhase/result/input/observedAt 逐字段不变），仅传输通道与时机改变；poll 判据（`waitNsRecords` 1s）容纳 macrotask 级合法延后 |
| **AC2**（输入零访问 / detached snapshot 纪律） | 载荷捕获点、快照来源、observedAt 单源全部与现状同位（§3.1 载荷组装在捕获点完成；DC-3 单次 clock 读保持；`e.input.snapshot` = 接纳时 detached 快照；cycle-safe 拒绝 → `status:'unsafe-input'` 零回读——T1/T3 锚维持）。泵只搬运已 detached 的 record（所有权已在组装点转移） |
| **AC3**（建流/reopen/repair/retention/append 不在业务关键路径） | 建流（initStream 泵任务）、adapter 构造（resolveRuntimeDiag → wrapper，构造移入 drain 的 `runtimeEmitterFor` 调用）、同步 append（emit 泵任务）全部位于 carrier 槽与 sequencer 窗口之外（macrotask drain）；槽内/窗口内残余 = O(1) 入队 |
| **AC4**（慢/挂起存储不阻塞下一业务槽、不无限延长 create/shutdown；故障隔离） | 泵 drain 在业务排序路径外：慢/挂起存储不影响任何业务槽推进与 create/open/shutdown 结算（T8/T9/T10 墙钟面满足）；per-ns 单飞隔离挂起扩散（§3.1）；emitter throw / initStream 违约 / 解析违约全部被吞没边界收编（业务结果隔离面维持——各红用例 GREEN 锚先行）；初始化失败语义不变（Host 侧 `LOG_STREAM_INIT_FAILED` 独立 observer，Registry 不代发） |
| **AC5**（契约覆盖 + 修复前失败证明） | 13 用例翻绿映射见 §5；不可满足锚的修订集（R1/R2/R3）保证修订后仍证明修复前失败（§10.4） |

---

## 5. 13 用例映射（T1–T13）

| 用例 | 本设计下状态 | 机制 |
|---|---|---|
| T1–T6（早结局归属） | **翻绿** | 泵投递 → `runtimeEmitterFor(候选ns)` → ns 通道 poll 到达；内容锚因载荷组装同位而逐字段满足；`unattributedDrops===0`（生产形状下共享通道不再接收这些结局） |
| T7（GREEN 对照） | **保持绿** | 成功路径：initStream（泵）→ ensure → #17 emit（泵）；`waitNsRecords` poll 容纳延后；`events` 含 `initStream:<ns>:start`（poll 到达时必然已发生）；`unattributedDrops===0` 不变；shutdown 不等泵 → 正常结算 |
| T8（create 结算不等日志存储） | 墙钟锚**翻绿**（createMs ≪ 120：槽内仅 O(1) 入队）；**顺序锚不可满足**（§10.1——initStream:end 在同步断言时缺席 → indexOf -1）→ 阻断于 R1 |
| T9（shutdown 不等日志存储） | 墙钟锚**翻绿**（initStream 出槽 ⇒ create 槽快速结算 ⇒ shutdown 不含 200ms 存储）；**顺序锚不可满足** → R1 |
| T10（open 结算不等 adapter 构造） | 墙钟锚**翻绿**（factory 第三参 = wrapper O(1)，ensure 移入 drain）；**顺序锚不可满足** → R1 |
| T11（被拒 create 零落盘 → 须建流） | **翻绿** | 泵先 `initStream(NS_SECOND, undefined)`（真实 File adapter：目录+manifest 建立），后 emit 落 attempt 记录；成功对照半（genesis+attempt）不变 |
| T12（下一业务写槽不被慢 emit 推迟） | **生产路径已隔离**（wrapper O(1)——但本用例直接注入 Runtime seam，不经 wrapper）；**该用例顺序锚+墙钟锚对任意实现不可满足且与 #149 AC4 互斥**（§10.1/§10.2）→ R2 |
| T13（close 不被慢 emit 延长） | 同 T12 → R2 |

（§10 给出逐用例的不可满足性证明与修订形状；修订后 T8–T13 全部可翻绿且修复前仍红。）

---

## 6. 关键时序 trace

**(a) 成功 create（生产形状 Host，慢存储 120ms×2）**

```
调用方 → registry.create → carrier 槽：snapshot/compile/validate/createDoc/
  runtime factory(第三参=wrapper O(1))/entries.set/lease
  槽内日志工作：enqueue{init-stream ns bytes} + enqueue{emit #17}  ← O(1)
槽 settle → create() resolve（≈业务耗时；不含 240ms 存储）        ← T8 墙钟 ✓
… macrotask 边界 …
drain(ns)：initStream → ensureAdapter（120ms fs）→ emit #17（120ms append）
                                                      ← 业务路径外
```

**(b) 早结局（schema-compile 拒绝）**：槽内组装 record（observedAt=单次 clock 读）→ `enqueue{init-stream ns undefined}` + `enqueue{emit}` → 槽 settle（业务拒绝即刻返回）→ drain：建流（无 genesis）→ emit 落盘 → T1/T11 判据经 poll 到达。

**(c) open（B2）**：open 槽 factory 第三参 = wrapper（O(1)，**不调** `runtimeEmitterFor`）→ open settle（T10 墙钟 ✓）→ 首次写 emit 时 drain 内 `runtimeEmitterFor(ns)` → ensure（reopen/repair/retention）→ append——全部业务槽外。

**(d) Runtime 写（B3，生产 wiring）**：slot N settle → noop hop → emitSlot 调 wrapper.emit（**O(1) 入队**，微任务窗口内纯内存）→ 下一槽 run 启动不受存储影响 → macrotask 后 drain 落盘。#149 AC4（直接注入计数 emitter）不经 wrapper：emitCalls 同步 === 2 保持。

**(e) shutdown**：停接纳 → 等 carrier tails + admittedCreates（create 槽已不含存储）→ close runtimes → 聚合结算。泵不被等待、不清空（§7.5）——T9 墙钟 ✓；shutdown 公共契约（同 Promise、`NamespaceRegistryShutdownError` 聚合、停止接纳）零改动。

---

## 7. 边界 case 与裁决

### 7.1 id 生成耗尽 fatal（敏感点 2 边界）
8 次候选全部碰撞 → `committed:false` Registry fatal（ADR-0010 L28）。**裁决：维持零诊断发射**（现状：仅 observer 事件）。理由：该终局不存在任何「归属正确」的 namespaceId——所有候选均已证明属于他人，任选其一都是伪造归属（违反 Host 侧「绝不伪造归属」的词义本体与 ADR-0012 数据键控原则）；为它发明无 ns 的落盘面超出 ADR-0011 v1 词表（须 record schema 演进）。登记为边界 case 供 SA8 recheck 复核。

### 7.2 duplicate 族（AC1 明文词的登记面）
- entry 碰撞候选重试（registry.ts L1311）与 Persistence `DOC_DUPLICATE` 重试（L1408）：**零发射维持**（#150「恰一条最终结局」裁决——重试成功场景由最终结局单条覆盖；与 SA5 §6/SA6 §2 登记一致）。
- 公共入口 acceptance（`REGISTRY_NOT_ACCEPTING`）/ identity 拒绝：发生在 namespaceId 生成之前，**维持同步共享通道**（无归属可用，非缺陷 A 对象；亦不经泵——无 ns 键）。
- 最终 duplicate 可见终局 = id 耗尽 fatal（§7.1）。

### 7.3 Host 违约
resolver 在场但解析 throw/返回畸形 → drain 内静默丢弃（`resolveEmitterOnce` 既有非抛边界）；emitter 同步 throw → drain 内吞没；`initStream` 违约 throw → 同左。全部不改变业务结果（各红用例 GREEN 锚面）。

### 7.4 泵溢出
per-ns 256 上界，drop-newest 静默丢弃（保序）。诊断 best-effort 语义下可接受；不引入新健康词表（Registry 侧无日志健康通道——ADR-0011 L22：日志健康走 Host/adapter 侧独立 observer，Registry 不代发）。

### 7.5 shutdown 与 drain 预算（敏感点 3 裁决）
**Registry 侧不建立任何 drain 预算机制**：不清泵、不等待、不注册 disposer。依据：ADR-0011 L129「Registry/Persistence 的停止不得无限等待日志 sink」+ 首切片 adapter 无积压可冲（每 record 已同步落盘；泵内未执行任务为**尚未发生的** best-effort 投递，非未冲刷的已承诺数据）；shutdown 后 Host `manager.close()` 的 O(1) 收口使迟到 drain 落 `manager-closed` 丢弃桩（既有词表）。ADR-0009 shutdown 公共契约零改动。若未来 adapter 演进为 queue/batch（L252），drain 预算随四类语义另行定义——本设计不预写。

### 7.6 词表（敏感点 4）
零新增 operation/stage/result/update-omitted reason 值——本设计只改「同一 record 的传输通道与时机」，不改 record 内容面（AC5 内容锚逐字段维持即证明）。不触发 record schema 版本演进或新 stream generation。

### 7.7 测试 seam（敏感点 5）
`diagnosticLog` / `initStream` / `runtimeEmitterFor` / Runtime `diagnosticEmitter`+`clock` 成对——全部字段名冻结不变；本设计零新 seam 成员、零 testing subpath 变更（R2 的 wrapper 助手是修订项，属 SA6 重新固话的裁决域，见 §10.5）。

---

## 8. SA3 实现指引（文件级改动面）

1. **新增** `packages/namespace-registry/src/diag-pump.ts`：per-ns FIFO + 单飞 drain + `setImmediate` 调度 + 有界 drop-newest + 非抛边界。零公共导出（create-diagnostic.ts 相对导入；index.ts 不 re-export——模块导出纪律同 create-diagnostic.ts 先例）。
2. **改** `packages/namespace-registry/src/create-diagnostic.ts`：§3.2 路由（构造期泵装配、早结局/initStream/emitStreamOutcome 三面入泵、`createRuntimeDiagResolver` wrapper 化、legacy 回退保持）；装配函数合并（`createDiagRuntime` 或等价）。
3. **改** `packages/namespace-registry/src/registry.ts`：仅 L776–779 装配点一行级改动（共享泵实例）；槽体/发射调用点/三处 factory 调用点零改动。
4. **零改动**：`packages/namespace-runtime/src/**`、`apps/yjs-server/src/diagnostics.ts`（头注释更新可选）。
5. **测试（依 SA6 重新固话后的修订契约）**：R1/R2 修订后的红灯契约两文件；R3 修订后的 `apps/yjs-server/test/diagnostic-replay-host-lifecycle-sa7.test.ts` C1 用例。
6. **验证门**：修订后红灯契约全绿；相邻绿基线（#150 `registry-create-diagnostic-red` 18 用例、#149 `runtime-root-schema-diagnostic-red` 14 用例）保持绿（本轮核对：#150 判据全为 poll 型（`waitAttempts`/`expect.poll` 3s）或 poll 后同步计数（L545 在 poll 见到记录之后）；两处 `flushMicrotasks`（L544/L753）锚定业务槽推进与「恰一条」计数，与诊断到达时机正交——macrotask 延后在 3s poll 余量内）；根 `pnpm typecheck && pnpm test` 全量（含 §10.3 的 app E2E 修订后形态）；`registry-surface` 静态守卫（setImmediate 不命中，§3.1）。

**实现顺序建议**：diag-pump → create-diagnostic 路由（先 legacy 路径回归绿，再开泵路径）→ T1–T7/T11 翻绿验证 → 契约修订（SA6 固话后）→ T8–T13 → 全量回归。

---

## 9. 回归面与风险

| 面 | 评估 |
|---|---|
| #150（registry-create-diagnostic-red，18 用例；legacy 缓冲 Host） | 零漂移：无 resolver Host 全程同步共享通道（逐字节现行）；本轮核对判据全 poll 型/正交锚（§8.6） |
| #149（runtime-root-schema-diagnostic-red，14 用例） | 零漂移：Runtime 零改动；直接注入 seam 不经 wrapper；AC4 `emitCalls===2` 同步锚保持 |
| #153/#154（reopen/retention，file adapter 面） | 零漂移：adapter 语义与构造点不变（构造时机移入 drain——这些用例经直接 adapter/Host 测试，不经 Registry 槽时序） |
| #155（yjs-server E2E + replay） | **C1 用例三锚必翻红**（§10.3，缺陷 A 行为被冻结为期望——须 R3 修订）；replay/manager 直探用例（binding 直调）不受影响 |
| registry 静态守卫（§2.M） | setImmediate 不在三正则内（逐字符核对）；`Date.now` 零新增；无 cordis import |
| 注入 scheduler 面（idle timer 等） | 泵不用 scheduler：`scheduler.pending()` 计面零影响（idle/retention 用例零漂移） |
| 全量 259 files / 2854 tests | SA3 门禁（§8.6）；已知必红面 = §10.3 的三锚（R3 修订） |

---

## 10. 契约可实现性独立裁决与最小修订集（本轮核心裁决）

### 10.1 T8/T9/T10/T12/T13 顺序锚：任意实现下不可满足（证明）

统一结构：测试在 `await <业务 Promise>` 续段内同步 push 结算标记（T8 L462 `create:settled`、T9 L497 `shutdown:settled`、T10 L523 `open:settled`、T13 L154 `close:settled`；T12 以业务标记 `notify:2` 代替），随后在**同一同步段**（T9 间隔一次已 settle Promise 的 `await createPromise` = 微任务 hop；T12 间隔 GREEN 锚 + 同步 `readRoot`；T13 间隔一次 `await expect().resolves` hop）执行 `expect(events.indexOf(结算标记)).toBeLessThan(events.indexOf(存储完成标记))`。标记与断言之间**不存在任何实现代码可执行的调度点**（同步语句间无调度；微任务 hop 期间新排队微任务按 FIFO 必晚于测试续段）。而存储完成标记（`initStream:<ns>:end` / `emit:<ns>:end` / `ensure:<ns>:end` / `emit1:start`）由 Host 侧 binding（测试自供）在 seam 调用内同步 push。穷举存储执行位置：

1. **槽内/窗口内同步执行（现状）**：存储完成标记先于结算标记 → `indexOf` 顺序断言失败（当前红灯形态）。
2. **微任务级 deferral**：要么排在测试续段之前（存储标记先于结算标记 → 顺序失败），要么排在被测业务结算 Promise 链内（延迟被测墙钟——T8 `createMs<120`/T9 `shutdownMs<100`/T10 `openMs<75`/T12 `gap<50`/T13 `closeMs<50` 失败），要么排在测试续段之后（断言时缺席 → `indexOf === -1`，任何非负索引 < -1 恒假 → 失败）。微任务 FIFO 下不存在「标记 push 与断言之间」的可插入位置（T12 详证：emit1 的 100ms 同步块若插在 notify:2 之后、断言之前，则必然位于 w2 结算链内 → `gap ≥ 100` 翻红；若早于 notify:2 → 顺序锚翻红；macrotask → 缺席翻红）。
3. **macrotask 级 deferral（本设计）**：测试函数从结算到断言全程微任务链续段（无 yield 回事件循环）→ 断言时缺席 → -1 → 失败。

⇒ 五个顺序锚对实现空间封闭：**不存在任何实现使其通过**。判据缺陷本体：锚把「结算不等待存储完成」错误编码为「断言时刻存储已完成且晚于结算」——后者在同步断言域内不可观测。**修订形状（R1）**：先 `expect.poll` 等待存储完成标记**到达**（poll 循环让出事件循环 → macrotask drain 执行 → 标记入列），再断言 `indexOf(结算标记) < indexOf(存储完成标记)`——结算标记先 push、存储后到达，顺序天然成立且免墙钟抖动；修复前（槽内执行）存储完成标记先于结算标记 → 顺序断言仍红（§10.4）。

### 10.2 T12/T13 与 #149 AC4 冻结锚互斥（证明）

T12/T13 把慢同步 emitter 直接注入 Runtime 冻结 seam `diagnosticEmitter`（runtime 红测试 L109/L142）——不经过任何 Registry wiring。使其翻绿的唯一途径是 **Runtime 自身**把 seam 调用（`emitSlot` → `emitter.emit`）移出槽间窗口/调用方续段；而 #149 `runtime-root-schema-diagnostic-red.test.ts` AC4（L610–639）在两次 `await mutateData` 后**无任何 yield** 同步断言 `expect(emitCalls).toBe(2)`（本轮核对 L626–639：其间 `readOk`/`getStatus` 均同步）——任何把 emit **调用**排到调用方续段之后的改动（macrotask 必然；微任务多 hop 亦无法越过注册序上先于公共方法返回的调用方回调）使该锚得 0/1 → 翻红。⇒ 同一 Runtime 代码无法同时满足两者。**修订形状（R2）**：T12/T13 的注入形状改为「生产 wiring 同构」——经延迟 wrapper 包裹慢 emitter（wrapper.emit = O(1) 记录入队 + macrotask 后真实 emit），顺序锚改到达 poll + 顺序（同 R1 形状）。wrapper 助手从 `namespace-runtime/testing` 导出（既有 testing subpath 先例面；seam 字段名零新增——这是测试助手不是 seam 成员）。修订后：修复前（无 wrapper、直接同步 emit）墙钟/顺序锚仍红；修复后（生产 wiring 用 wrapper）绿。

### 10.3 新发现：#155 SA7 应用层 E2E 冻结了缺陷 A 行为本身

`apps/yjs-server/test/diagnostic-replay-host-lifecycle-sa7.test.ts`「C1 并发 create 交错」用例（L224–292）三处锚把**缺陷 A 的生产行为**断言为期望：

- L243–246：B（Persistence 运营失败，建流前结局）结算后**同步**断言 `dropsEarly.length === 1` 且 reason `'unattributed'`、事件不含 namespaceId；
- L265：`existsSync(join(rootDir,'namespaces',NS_B))` **=== false**（B 无日志目录）；
- L279–281：全程丢弃恰 1 条、全 `'unattributed'`。

AC1 明文要求 B 类结局「以正确 namespace 归属进入诊断流」→ 修复后 B 有自己的流与记录、零 unattributed 丢弃——三锚**必然翻红**（L243 为同步锚，与本设计 macrotask 投递正交性无关——语义面直接冲突）。这些锚是 #155 时代对当时 Host 语义的固化（diagnostics.ts 头注释自述），#226 正是要退役该语义。全 repo 检索确认含 `unattributed` 期望锚的测试仅两处：#226 契约自身（`unattributedDrops===0`——与修复同向）与此文件（与修复反向）。**修订形状（R3）**：期望改为 B 的结局以 `NS_B` 归属落 B 自己的流（1 条 attempt：stage `transaction`、code `NAMESPACE_CREATE_FAILED`、result `rejected`）、`namespaces/NS_B` 目录存在、全程 unattributed 丢弃 0；**C1 交叉归因性质保持并强化**（A 流仍恰 genesis+#17 两条、segment 全文不含 B marker、A replay complete）——该用例的攻防价值（跨 ns 误归因不可达）在修订后更严格。此项属全量门（259 files）必红面，**随本修复一并修订**，归入 SA6 重新固话范围。

### 10.4 修订后「修复前失败」证明保持

- R1（T8/T9/T10）：修复前存储在槽内同步完成 → 存储完成标记先于结算标记 → 到达 poll 即刻满足后，顺序断言仍红。✅
- R2（T12/T13）：修复前无 wrapper（生产与测试均直接同步 emit）→ 慢 emit 阻塞下一槽/close，墙钟与顺序锚均红。✅
- R3（app C1）：修复前 B 落 unattributed 丢弃、无目录 → 修订后锚（B 归属落盘、0 丢弃、目录存在）红。✅

### 10.5 最小修订集汇总（提请 SA6 重新固话 + SA8 recheck）

| # | 级别 | 对象 | 修订 |
|---|---|---|---|
| R1 | 阻断 | #226 红契约 T8/T9/T10 | 顺序锚改「到达 poll + 顺序」；墙钟降旁证可留 |
| R2 | 阻断 | #226 红契约 T12/T13 + `namespace-runtime/testing` | 注入形状 wrapper 化（testing 助手导出）；顺序锚同 R1 形状 |
| R3 | 阻断 | `apps/yjs-server/test/diagnostic-replay-host-lifecycle-sa7.test.ts` C1 | 三锚改 #226 后语义（B 归属落盘、0 unattributed、B 目录存在；A 流干净保持） |
| R4 | 推荐 | `registry-surface.test.ts` §2.M | 注释固化「`setImmediate` 为 diag-pump 显式许可的调度原语、三正则有意不含之」（零正则改动） |

---

## 11. 本轮核验记录（独立重验，未沿用失败轮结论）

| # | 主张 | 核验方式 | 结果 |
|---|---|---|---|
| V1 | 8 个建流前发射点 + initStream/emitStreamOutcome 落点 | 直接读 `registry.ts` L1290–1470 全段 | ✅（L1316/1328/1364/1379/1394/1411/1419/1427/1436/1450/1463） |
| V2 | 共享通道恒丢弃 + binding 三成员 + seam 冻结形状 | 直接读 `create-diagnostic.ts` L310–381、`diagnostics.ts` 全文、`types.ts` L720–724 | ✅ |
| V3 | B3 微任务序（emit 落槽间窗口且先于调用方续段） | 直接读 `sequencer.ts` L38–42 + `runtime.ts` L470–475（`return settled`）+ `close.ts` L38–40，独立重建注册序/队列序 | ✅ |
| V4 | B2 三处 factory 落点 | grep + 读 `registry.ts` L1229/L1440/L1584 | ✅ |
| V5 | 红灯基线复现 | 后台 Job `bash-1`：12F\|1P、Type Errors 0、11.76s（T12/T13 先触墙钟锚 101ms，与 SA6 登记一致） | ✅ |
| V6 | 顺序锚不可满足（§10.1） | 逐用例读两契约锚文本（T8 L462–474、T9 L495–505、T10 L521–532、T12 L113–131、T13 L147–163），标记 push → 断言之间语句级核对（同步/微任务 hop 分类），存储位置穷举 | ✅（含 T12 `readRoot` 同步性、T9/T13 hop 性质） |
| V7 | #149 AC4 `emitCalls===2` 为同步锚 | 读 `runtime-root-schema-diagnostic-red.test.ts` L608–639（断言间零 yield） | ✅ |
| V8 | #150 绿锚兼容 macrotask 延后 | 读 `registry-create-diagnostic-red.test.ts` 判据形态（L308–312 poll、L460–475 poll×2、L536–546 poll 后计数、L745–756 gate 用例）+ 缓冲 Host 形状（L437–457） | ✅（legacy Host 全程零漂移 + 判据全 poll/正交） |
| V9 | 静态守卫不含 setImmediate | 逐字符读 `registry-surface.test.ts` L279–284 三正则 | ✅ |
| V10 | 注入 scheduler 结构性不可用于泵 | 读 `testing.ts` L77–110（Map fake、仅 advanceBy 触发） | ✅ |
| V11 | **#155 SA7 C1 三锚冻结缺陷 A（本轮新发现）** | 读 `diagnostic-replay-host-lifecycle-sa7.test.ts` L224–292（L243–246/L265/L279–281）+ 全 repo `unattributed` 锚检索 | ✅（唯二反向锚 = 此文件） |
| V12 | ADR 条款 | ADR-0011（L20–25/L57/L117–129）、ADR-0012 诊断日志版（amendment L248–252、L24/L67/L240–242/L268）、ADR-0008 L51/L99、ADR-0009 L32/L62/L97–101、ADR-0010 L28——经 `_relevant_decisions.md` 摘录对照 + 关键条款回查原文 | ✅ |

---

## 12. 产出边界

- 本文件：`wiki/raw/task_issue-226_design.md`（设计阶段交付物，iteration 4 recovery respawn；覆盖失败轮旧稿）。
- **零生产代码改动、零测试/守卫改动、零 git 操作**；`src/**`、`apps/**` 未触碰。
- 结构化结果：恰一次 `structured_output`（verdict `conflict`、`requiresConflictRecheck: true`、artifactPaths = 本文件）。
- 移交：设计 §2–§9 为 ADR 合规生产架构（可直接进 SA3）；§10 修订集（R1/R2/R3 阻断 + R4 推荐）须先经 SA6 重新固话 + SA8 conflict recheck 后方可进入实现。

Verdict: **conflict**（契约层冲突——五个顺序锚实现空间封闭 + T12/T13 与 #149 互斥 + #155 SA7 三锚冻结缺陷 A；ADR 层设计合规）— `requiresConflictRecheck: true`
