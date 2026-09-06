# 独立分析与复现 — Issue #226（第三轮独立轮，2026-09-05）

- 任务：Issue #226（bugfix）——`wiki/raw/task_issue-226.md`（创建诊断覆盖缺口 + 日志生命周期隔离）
- Worktree：`/home/wangjian/nomicore-fix-issue-226`（branch `mabf/issue-226`，HEAD `45a22f060eee924e4ed6a2d6fa64fb7cd6b2db08`）
- 本轮性质：**独立分析与复现轮**（本文件为该轮 bug-analysis 产出物）。全部动作 = 直接读源码独立重建两条缺陷链的机制推理 ＋ 逐字核对被引规范条款 ＋ 后台 Job 独立重跑红灯契约与相邻绿灯基线。**零产品代码改动、零测试文件改动**（`git status --porcelain` 仅本任务既有未跟踪文件；`src/**` 未触碰）。
- 前置产物：`20260905-bug-issue-226.md`（SA1 首轮报告，含 §7/§8 两轮复核补记）。本轮为第三轮独立确认，**结论与首轮一致，无需更正**。

## 0. 本轮结论（TL;DR）

| 项 | 结论 |
|---|---|
| 缺陷链 A（建流前 create 结局被无归属通道确定性丢弃，AC1） | **机制经本轮独立源码核验成立，且可执行复现**（T1–T6、T11 红） |
| 缺陷链 B（同步日志 I/O 位于业务关键路径，AC3/AC4） | **三个落点（create carrier 槽 / open 槽 / Runtime sequencer 槽间窗口）逐一源码核验成立，可执行复现**（T8–T10、T12、T13 红） |
| 红灯契约独立重跑 | `12 failed \| 1 passed (13)`，`Type Errors: no errors`，EXIT=1（预期红灯）；相邻绿灯基线 `30 passed (30)`，EXIT=0——失败归因于新增用例，非环境噪声 |
| 首轮报告准确性 | 机制链条、代码锚点、ADR 引用经本轮逐点独立抽查**全部属实**（详见 §4），无需更正 |

## 1. 缺陷链 A 独立源码核验

### 1.1 seam 路由结构（本轮直接读 `packages/namespace-registry/src/create-diagnostic.ts`）

`createCreateDiag`（L310–380）在构造栈一次读取共享 emitter（L315–328，形状门违约 → NOOP_DIAG），此后：

- `emitOutcome(observedAt, e)`（L334–336）与 `emitEarlyOutcome(e)`（L338–342）**恒走构造期捕获的共享 emitter**——两者是 Registry 槽内结局的全部发射面，**不携带也不解析任何 namespaceId**；
- 唯二的 namespace 数据键控路径是 `emitStreamOutcome(namespaceId, …)`（L354–365，经 `runtimeEmitterFor` 现场解析）与 `initStream(namespaceId, bytes)`（L370–379，建流缝，Host 违约同步 throw 被吞没）。

⇒ **凡在 `initStream` 之前发射的 create 结局，只有共享 emitter 一条路可走；该通道无归属能力是 seam 的静态结构，不是运行时偶发。**

### 1.2 Registry 调用点（本轮直接读 `packages/namespace-registry/src/registry.ts`）

`admitCreateAttempt`（L1291–1304）把 `runCreateAttempt` 挂到同 key lifecycle carrier 链（L1298–1301）——即全部下述发射均发生在 carrier 槽内。`runCreateAttempt`（L1306–1470）发射点顺序：

| 行 | 发射 | 结局类别 | 相对建流 |
|---|---|---|---|
| L1316 | `emitEarlyOutcome`（input-snapshot 拒绝） | input-snapshot | **建流前** |
| L1328 | `emitOutcome`（schema-compile / validation 拒绝） | schema/validation | **建流前** |
| L1364、L1394 | `emitOutcome`（create-document-internal fatal） | 内部 fatal | **建流前** |
| L1411 | `emitOutcome`（DocCreateOperationalError → `NAMESPACE_CREATE_FAILED` 拒绝） | Persistence 运营 | **建流前** |
| L1419、L1427 | `emitOutcome`（DocCreateFatalError / unknown → fatal，保留 committed 事实） | Persistence fatal | **建流前** |
| L1436 | `initStream`（建流） | — | 建立缝 |
| L1450、L1463 | `emitStreamOutcome`（#17 committed / #18 runtime-construction fatal） | post-commit | 建流后（数据键控） |

**归属数据在发射时点已存在**：整个槽内 `id.namespaceId`（受控 CSPRNG 候选 id，ADR-0010）始终在手上（L1311 起即按 `id.key` 操作），却无数据键控通道可走。

### 1.3 生产供应方确定性丢弃（本轮直接读 `apps/yjs-server/src/diagnostics.ts`）

- L74–76：`unattributedEmitter = { emit: () => drop(closed ? 'manager-closed' : 'unattributed') }`——**恒丢弃 + NDJSON 计数**，零路由；
- L114–116：`binding.emitter = unattributedEmitter`；L118–120 `initStream` → `ensureAdapter`；L123–127 `runtimeEmitterFor(ns)` → 缓存查表/构造；
- 文件头注释（L9–11）自述语义：「`binding.emitter` 恒丢弃 + 计数……**全部 initStream 之前的 create emission 落此通道**，绝不伪造归属」。

⇒ 生产 wiring 下，§1.2 的全部建流前结局**零 namespace 归属、零落盘**（仅 NDJSON drop 计数）——与 T1–T6（ns 数据键控通道 0 条）与 T11（候选 ns 目录从未建立）的红灯形态逐点吻合。

### 1.4 归因面结构（本轮直接读 `packages/namespace-diagnostic-log/src/emission.ts`）

`NamespaceDiagnosticChangeEmission`（L33–51）无任何 namespace 字段——归因唯一载体是**哪个 emitter 实例接收 emission**（#155 数据键控设计）。因此修复面只能在「数据键控消费点扩展（发射点携带 ns 走 `runtimeEmitterFor`）」或「Host 侧按候选 ns 缓冲」两族方向上（首轮报告 §5.3 登记，本轮核验其前提成立）。

### 1.5 既有绿灯为何漏网（本轮直接读 `packages/namespace-registry/test/registry-create-diagnostic-red.test.ts`）

L435–457 的 #150 契约 Host binding 是**缓冲型**：`pending.push(emission)` 装载前缓冲、`initStream` 后 `pending.splice(0)` 重放进流。该形状与生产供应方（恒丢弃）不一致——既有绿灯覆盖「缓冲型 Host」，未覆盖生产 wiring，建流前结局的生产确定性丢弃因此逃过既有测试。首轮报告 §1.4 定性成立。

## 2. 缺陷链 B 独立源码核验

### 2.1 B1：create lifecycle carrier 槽内的建流与同步 append

- `diag.initStream(...)`（registry.ts L1436）位于 `runCreateAttempt` 槽内（Persistence createDoc 成功后、runtime factory 之前），而该槽经 `admitCreateAttempt`（L1298–1301）串行化在 lifecycle carrier 上；
- 生产 `initStream` → `ensureAdapter` → `createFileDiagnosticLog` 构造器**全同步 fs**（本轮直接读 `packages/namespace-diagnostic-log/src/adapters/file.ts`）：`initializeGeneration` L857–898——recursive `mkdirSync`（L860）、manifest `'wx'` 不可变创建（L879）、genesis append（L894–896）、current.json temp+rename（L902–915，`writeFileSync`+`renameSync`）；#153 reopen 健康证明/可证明尾部修复（`truncateSync` L948）；#154 构造期 retention sweep（`sweepOnOpen` 缺省 true，L316–317、L1455–1457）；
- 槽内 `emitStreamOutcome`（L1450/1463）→ ns emitter `emit` → **每 record 独立 `appendFileSync`**（file.ts L684 BIN frame / L699 JSONL line；无队列、无 batch、无 fsync——首切片形态，文件头 L16 自述）；
- 复现锚：T8（慢建流 120ms + 慢 append 120ms → `create:settled` 晚于 `initStream:end`，红灯 `expected 6 to be less than 3`；墙钟 ≥240ms）、T9（慢建流 + shutdown——ADR-0009 L99「等待此前已接纳的 lifecycle 操作结算」+ L140「create 的跨候选重试仍受 lifecycle carrier 串行化与 shutdown 已接纳操作屏障约束」，故 shutdown 结算被槽内建流同步延长，红灯 `expected 6 to be less than 3`）。

### 2.2 B2：open lifecycle 槽内 adapter 构造

registry.ts L1229：open 槽内 factory 第三参 `resolveRuntimeDiag(identity.namespaceId)` → `runtimeEmitterFor` → 缓存 miss 时经 `ensureAdapter` 同步构造 File adapter（diagnostics.ts L84–112）——locator 解析、reopen 证明、尾部修复、retention sweep 全部落在 open 槽内。复现锚：T10（`ensureBlockMs=150` → `open:settled` 晚于 `ensure:end`，红灯 `expected 2 to be less than 1`）。

### 2.3 B3：Runtime write-sequencer 槽间窗口的同步 emit

本轮独立重建微任务序（`packages/namespace-runtime/src/sequencer.ts` L38–42 + `runtime.ts` 调用点）：

1. `enqueue` 内 `const settled = this.tail.then(run, run); this.tail = settled.then(noop, noop);`——**noop hop 在 enqueue 内先注册**；
2. 公共方法（runtime.ts L470–475 root-write、L491–494 schema-write、L515–518、L536–539 等 8 处）在 `enqueue` 返回后注册 `settled.then(emitSlot)`——**注册序晚于 noop hop**；
3. 槽 N settle 时微任务队列 = `[noop, emitSlot]`：noop 先跑 → tail（noop promise）resolve → 槽 N+1 的 `run` 排到队尾（emitSlot 之后）→ **emitSlot 的同步 `appendFileSync` 恰落在「本槽释放 → 下一槽启动」的关键窗口**；
4. close barrier 经同一 `sequencer.enqueue` 挂接（`close.ts` L38–40 `enqueueCloseBarrier`）——同样排在上游槽 emitSlot 之后。

⇒ 慢或挂起的同步 emitter 直接推迟下一业务写槽启动与 close barrier 推进；#149/#151 注释的「slot 已释放之后」论证只覆盖相对上一槽，未覆盖相对下一槽。复现锚：T12（w1→w2 结算间隔 103ms，红灯 `expected 103 to be less than 50`；顺序锚 `notify:2` 晚于 `emit1:start`）、T13（close 结算 103ms，红灯同形）。

## 3. 规范条款逐字核对（本轮直接读 ADR 原文）

| 引用 | 核对 |
|---|---|
| ADR-0011 覆盖范围：「namespace create，包括输入、schema、ROOT、duplicate、Persistence 与 post-commit Runtime construction 结局」 | ✓ 逐字属实（`0011-best-effort-namespace-diagnostic-change-log.md`）——建流前结局属明文覆盖项，缺陷链 A 是实现缺口而非契约空白 |
| ADR-0012（诊断日志版）amendment：「任何将 File adapter 的 `emit` 接入 namespace 生命周期的调用点，必须位于 NamespaceRuntime write sequencer slot 之外，或在该 slot 已释放之后；不得在 slot 内执行同步 File adapter `emit`。不满足该条件的接线为不合规，必须由 #149–#151/#155 或后续接线票修复后方可启用」；「『有界』……不表示底层文件系统延迟有时间上界」 | ✓ 逐字属实（amendment L248/L250）——本任务即该预留接线票；B3 的槽间窗口接线（以及按同一隔离精神经 ADR-0009 carrier 延伸到 B1/B2 的槽内建流/构造）不满足该条件 |
| ADR-0009：「shutdown 取消全部 idle timer，**等待此前已接纳的 lifecycle 操作结算**，然后主动 close 全部 active/idle Runtime」「create 的跨候选重试仍受 lifecycle carrier 串行化与 shutdown 已接纳操作屏障约束」 | ✓ 属实（L99/L101/L140）——T9 机制锚：槽内建流被 shutdown 屏障等待 |
| ADR-0011 隔离面（emitter seam 同步接收、不阻塞不 throw；emitter 不被 await；adapter 慢/失败不得延长 write slot 或阻塞 close/shutdown；不得引入第二个业务排序机构） | ✓ 属实——业务结果 GREEN 锚（T1–T6/T8/T10/T12/T13 均先行通过业务断言）证明当前隔离面在「不改变业务结果」意义上仍守，缺口在「不延长业务路径」意义上 |

## 4. 独立重跑证据（本轮，后台 Job `bash-1`）

环境：node v24.13.0 / pnpm 10.28.2 / vitest 3.2.7；HEAD `45a22f060eee924e4ed6a2d6fa64fb7cd6b2db08`（branch `mabf/issue-226`）；tracked 文件零修改（零产品代码/零测试改动确认）。

```bash
# 红灯契约（可执行复现载体）
pnpm test packages/namespace-registry/test/registry-issue-226-red.test.ts \
          packages/namespace-runtime/test/runtime-issue-226-red.test.ts
# Test Files  2 failed (2)
#      Tests  12 failed | 1 passed (13)
# Type Errors  no errors        （RED_EXIT=1，预期红灯）

# 相邻绿灯基线（环境健全性对照）
pnpm test packages/namespace-registry/test/registry-create-diagnostic-red.test.ts \
          packages/namespace-runtime/test/runtime-root-schema-diagnostic-red.test.ts
# Test Files  2 passed (2)
#      Tests  30 passed (30)
# Type Errors  no errors        （BASELINE_EXIT=0）
```

失败形态逐条（与首轮 §3.2 / §7.3 / §8.1 三轮记录一致）：

| 用例 | 本轮实测形态 | 缺陷链 |
|---|---|---|
| T1–T6（schema-compile / validation / input-snapshot / Persistence 运营 / Persistence fatal(committed:true) / create-document-internal fatal） | ns 数据键控通道 `expected +0 to be 1`（`waitNsRecords` poll 超时包裹，L279） | A |
| T7 GREEN 对照（#17/#18 已正确归属） | **通过（16ms）** | 边界证明 |
| T8 create 结算不等日志存储 | `expected 6 to be less than 3`（L471） | B1 |
| T9 shutdown 不等日志存储 | `expected 6 to be less than 3`（L504） | B1 |
| T10 open 结算不等 adapter 构造 | `expected 2 to be less than 1`（L531） | B2 |
| T11 被拒 create 零落盘 | 目录 poll `expected false to be true`（L615；成功 create 落盘对照半先行通过） | A |
| T12 下一业务写槽不被慢 emit 推迟 | `下一业务写槽被慢日志 emission 推迟 103ms: expected 103 to be less than 50`（L126） | B3 |
| T13 close 不被慢 emit 延长 | `close 结算被慢日志 emission 延长至 103ms: expected 103 to be less than 50`（L159） | B3 |

T12/T13 墙钟 103ms vs 首轮 103 / §7 102 / §8 101——正常抖动（顺序断言为主判据，墙钟为 ≥2× 余量旁证）。

## 5. 红灯契约有效性评估（本轮独立判断）

1. **判据确定性**：主判据为事件迹 `indexOf` 顺序断言（T8/T9/T10/T12/T13），免定时器抖动；墙钟阈值取注入阻塞一半以下。
2. **Host 形状忠实**：本轮直接读 `registry-issue-226-red.test.ts` L191–238 `makeProductionShapedHost`——共享通道恒丢弃+计数（L220–225）、`runtimeEmitterFor(ns)` 数据键控构造（L232）、`initStream` 建流（L226–231），与 diagnostics.ts 生产语义逐点对应；seam 字段名（`diagnosticLog.emitter` / `initStream` / `runtimeEmitterFor`；Runtime `diagnosticEmitter`+`clock` 成对）零发明。慢存储模拟（`Atomics.wait` 受控同步阻塞）位于 Host 供应方侧，与生产分层一致，被测对象即 amendment 明示的「无上界文件系统延迟」风险面。
3. **边界有 GREEN 对照**：T7 与 T11 前半钉住缺口边界 = 「initStream 之前」，证明数据键控通道与真实 File 落盘在建流后可用——红灯不误伤已工作面。
4. **业务隔离面被守护**：各红用例的业务面 GREEN 锚（ok lease / 稳定 issue / branded fatal + committed 事实 / FIFO / 终值）先行执行并通过。
5. **修复可翻绿**：断言面 = AC 明文行为面（结局以候选 ns 归属到达数据键控通道 / 业务结算标记先行于日志存储完成标记），不锚定特定实现形态——延迟同步 append 或 queue/batch 载体的合规修复均可翻绿（T9/T13 的顺序断言同时要求日志 I/O 排程不得先于 shutdown/close 结算续段，微任务级 deferral 不足，须 macrotask/queue 级搬移或异步化——首轮 §5.4 约束成立）。

## 6. 与首轮报告的比对

首轮报告（`20260905-bug-issue-226.md`）§1–§8 全部可核主张经本轮逐点独立抽查**属实**：机制链条（§1.1/§2）、代码锚点（行号误差 ≤ 数行，内容锚定明确）、「缓冲型 Host 漏网」定性（§1.4）、ADR 逐字引用（§1.2/§2.4）、红灯形态（§3.2/§7.3/§8.1）。未发现夸大、错引或需要更正之处。§5 的下游红线（seam 字段冻结、词表冻结、early-outcome 补记不得冒充 genesis、shutdown 契约不变、不引入第二个业务排序机构）经本轮核验其前提全部成立，维持登记、不预裁设计。

## 7. 本轮产出与边界

- 本文件：`wiki/raw/20260905-bug-issue-226-verify3.md`（第三轮独立分析与复现记录）
- 复现载体（既有，本轮零改动重跑确认）：`packages/namespace-registry/test/registry-issue-226-red.test.ts`、`packages/namespace-runtime/test/runtime-issue-226-red.test.ts`
- **未实施任何修复**；`src/**` 与既有测试文件零改动。下游（设计/实现）可以首轮报告 §1–§5 + 本轮确认作为验收基线继续。
