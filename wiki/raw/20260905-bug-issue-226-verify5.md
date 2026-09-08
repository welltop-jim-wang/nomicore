# 独立故障分析与复现确认 — Issue #226（第五轮独立轮，2026-09-05）

- 任务：Issue #226（bugfix，`仅 Bug 修复任务执行` 诊断阶段）——任务简报实际落点 `wiki/raw/task_issue-226.md`（委派指令所写 `wiki/raw/task_226.md` 不存在；issue 编号唯一对应，简报内容 = 创建诊断覆盖缺口 + 日志生命周期隔离，与 GitHub issue #226 标题/AC 一致）
- Worktree：`/home/wangjian/nomicore-fix-issue-226`（branch `mabf/issue-226`，HEAD `45a22f060eee924e4ed6a2d6fa64fb7cd6b2db08`，tracked 零修改）
- 本轮性质：**独立复现与故障分析轮**。全部动作 = 后台 Job 独立重跑红灯契约与相邻绿灯基线 ＋ 亲自逐点读源码/ADR 重建两条缺陷链机制 ＋ 红灯契约 Host 形状与生产 wiring 逐点比对。**零产品代码改动、零测试文件改动、零配置改动**（`git diff --stat` 为空；`git status --porcelain` 仅本任务既有未跟踪文件 ＋ 本报告）。
- 环境：node v24.13.0 / pnpm 10.28.2 / vitest 3.2.7（`--typecheck` 开启）。
- 前置产物（本轮输入，非本轮产出）：`20260905-bug-issue-226.md`（SA1 首轮，含 §7/§8 复核补记）、`-verify2-runs.md`、`-verify3.md`、`-verify4.md`、`task_issue-226_sa5.md`、`task_issue-226_conflict_report.md`（SA8 verdict clear）、`task_issue-226_relevant_decisions.md`。

## 0. 结论（TL;DR）

**两条缺陷链在本轮独立重跑中均可复现，机制经本轮亲自读源码逐点核验成立，全部 ADR 引用逐字属实：**

| 缺陷链 | 复现结果（本轮实测） | 机制核验（本轮亲自读源码） |
|---|---|---|
| A. 建流前 create 结局被无归属通道确定性丢弃（AC1） | **T1–T6、T11 红**；T7 绿对照通过（19ms 内）——缺口边界 = `initStream` 之前 | ✓ seam 静态结构（共享 emitter 无归属）＋ 生产供应方恒丢弃 ＋ emission 面无 ns 字段 |
| B. 同步日志 I/O 位于业务关键路径（AC3/AC4） | **T8、T9、T10、T12、T13 红**（三个落点：create carrier 槽 / open 槽 / Runtime sequencer 槽间窗口） | ✓ carrier 串行化 ＋ File adapter 全同步 fs ＋ noop-hop 微任务序 |

红灯契约独立重跑（后台 Job `bash-1`）：`Tests 12 failed | 1 passed (13)`、`Type Errors: no errors`、`RED_EXIT=1`（预期红灯）；相邻绿灯基线（后台 Job `bash-2`）：`30 passed (30)`、`BASELINE_EXIT=0`——失败归因于 #226 新增用例，非环境噪声。失败形态与既有五轮记录（首轮 §3.2、§7.3、§8.1、verify3 §4、verify4 §1.1、sa5 §1）逐条一致。

## 1. 独立重跑证据（本轮，后台 Job）

命令与既有五轮完全一致（本轮零改动重跑）：

```bash
# 红灯契约（可执行复现载体）
pnpm test packages/namespace-registry/test/registry-issue-226-red.test.ts \
          packages/namespace-runtime/test/runtime-issue-226-red.test.ts
# Test Files  2 failed (2)
#      Tests  12 failed | 1 passed (13)
# Type Errors  no errors        （RED_EXIT=1，预期红灯；Duration 13.82s）

# 相邻绿灯基线（环境健全性对照）
pnpm test packages/namespace-registry/test/registry-create-diagnostic-red.test.ts \
          packages/namespace-runtime/test/runtime-root-schema-diagnostic-red.test.ts
# Test Files  2 passed (2)
#      Tests  30 passed (30)
# Type Errors  no errors        （BASELINE_EXIT=0；Duration 6.85s）
```

失败形态逐条（本轮实测；主判据为确定性顺序断言/到达断言，墙钟为 ≥2× 余量旁证）：

| 用例 | 本轮实测形态 | 缺陷链 |
|---|---|---|
| T1 schema-compile 拒绝归因 | ns 数据键控通道 `expected +0 to be 1`（`waitNsRecords` L279 poll 1s 超时包裹，`Caused by: AssertionError expected +0 to be 1`） | A |
| T2 validation 拒绝归因 | 同上 | A |
| T3 input-snapshot 失败归因 | 同上 | A |
| T4 Persistence 运营失败归因 | 同上 | A |
| T5 Persistence fatal（committed:true）归因 | 同上 | A |
| T6 create-document-internal fatal 归因 | 同上 | A |
| T7 GREEN 对照（#17/#18 已正确归属） | **通过（18ms）**——钉住缺口边界 = 建流前 | 边界证明 |
| T8 create 结算不等日志存储 | `expected 6 to be less than 3`（L471 顺序锚） | B1 |
| T9 shutdown 不等日志存储 | `expected 6 to be less than 3`（L504） | B1 |
| T10 open 结算不等 adapter 构造 | `expected 2 to be less than 1`（L531） | B2 |
| T11 被拒 create 零落盘 | 候选 ns 目录 poll `expected false to be true`（L615；成功 create 落盘 GREEN 对照半先行通过） | A（落盘面） |
| T12 下一业务写槽不被慢 emit 推迟 | `下一业务写槽被慢日志 emission 推迟 101ms: expected 101 to be less than 50`（L126；顺序锚 `notify:2` 晚于 `emit1:start` 为同判据族） | B3 |
| T13 close 不被慢 emit 延长 | `close 结算被慢日志 emission 延长至 101ms: expected 101 to be less than 50`（L159） | B3 |

T12/T13 墙钟 101/101ms vs 既有五轮 100–104ms——正常抖动（顺序断言为主判据，墙钟阈值取注入阻塞 100ms 的一半以下，余量 ≥2×）。各红用例的业务面 GREEN 锚（ok lease / 稳定窄 issue / branded fatal + committed 事实 / FIFO 与终值 3）均先行执行并通过——业务结果不受日志缺陷影响（ADR-0011 隔离面在「不改业务结果」意义上仍守），红灯只锚定「归属到达」与「关键路径不延长」两个行为面。

## 2. 缺陷链 A 独立源码核验（本轮亲自读原文）

### 2.1 seam 路由结构是静态的（`packages/namespace-registry/src/create-diagnostic.ts`，本轮通读 L290–381）

- `createCreateDiag`（L310–313）在 Registry 构造栈一次读取共享 `diagnosticLog.emitter`（L315–328，形状门：null/敌意 getter/畸形 emit → NOOP_DIAG），此后 emit 侧只用该引用；
- `emitOutcome(observedAt, e)`（L334–336）与 `emitEarlyOutcome(e)`（L338–342）——Registry 槽内结局的**全部**发射面——**恒走构造期捕获的共享 emitter**，不携带也不解析任何 namespaceId；
- 唯二的 namespace 数据键控路径：`emitStreamOutcome(namespaceId, …)`（L354–365，经 `resolveEmitterOnce(streamResolver, namespaceId)` 现场解析；resolver 缺席时 legacy fallback 仍走共享 emitter）与 `initStream(namespaceId, bytes)`（L370–379，建流缝，Host 同步 throw 被吞没）。

⇒ 凡在 `initStream` 之前发射的 create 结局只有共享 emitter 一条路可走；该通道无归属能力是 seam 的静态结构，不是运行时偶发。

### 2.2 Registry 发射点全部早于建流，归属数据在发射时点已在手上（`registry.ts`，本轮逐行亲核）

`admitCreateAttempt`（L1291–1304）把 `runCreateAttempt` 挂到同 key lifecycle carrier 链（L1298–1301）——下述发射全部发生在 carrier 槽内；槽内 `id.namespaceId`（受控 128-bit CSPRNG 候选 id，ADR-0010 L28 亲核）自 L1297 起始终在手上：

| 行（本轮实测） | 发射 | 结局类别 | 相对建流 |
|---|---|---|---|
| L1316 | `emitEarlyOutcome`（input-snapshot 拒绝） | input-snapshot | **建流前** |
| L1328 | `emitOutcome`（prepare 期 schema-compile / validation 拒绝） | schema/validation | **建流前** |
| L1364 | `emitOutcome`（buildInitialDocument throw → create-document-internal fatal） | 内部 fatal | **建流前** |
| L1379 | `emitOutcome`（buildInitialDocument 返回 schema-invalid/root-invalid） | schema/validation | **建流前**（verify4 §6 登记的额外点，本轮复核属实） |
| L1394 | `emitOutcome`（buildInitialDocument 不可达 input-invalid → fatal） | 内部 fatal | **建流前** |
| L1411 | `emitOutcome`（DocCreateOperationalError → `NAMESPACE_CREATE_FAILED`） | Persistence 运营 | **建流前** |
| L1419、L1427 | `emitOutcome`（DocCreateFatalError / unknown → fatal，保留 committed 事实） | Persistence fatal | **建流前** |
| L1436 | `diag.initStream(id.namespaceId, state?.slice())` | 建立缝 | — |
| L1450、L1463 | `emitStreamOutcome`（#17 committed / #18 runtime-construction fatal） | post-commit | 建流后（数据键控） |

（公共入口同步段停接纳/identity 拒绝 L1933/L1943 亦走共享通道，但发生在 namespaceId 生成之前，本就无归属可用——非本缺陷链对象。）

### 2.3 生产供应方 = 恒丢弃 + 计数（`apps/yjs-server/src/diagnostics.ts`，本轮通读 L1–135）

- L74–76：`unattributedEmitter = { emit: () => drop(closed ? 'manager-closed' : 'unattributed') }`——恒丢弃 + NDJSON 计数，零路由；
- L114–116：`binding.emitter = unattributedEmitter`；L118–120 `initStream` → `ensureAdapter`；L123–127 `runtimeEmitterFor(ns)` → 缓存查表/构造；
- 文件头注释 L9–11 自述：「`binding.emitter` 恒丢弃 + 计数……**全部 initStream 之前的 create emission 落此通道**，绝不伪造归属」。

⇒ 生产 wiring 下 §2.2 全部建流前结局**零 namespace 归属、零落盘**（仅 drop 计数）；被拒 create 无后续 stream 可补记 ⇒ 落盘面同样为零（T11 红灯锚：候选 ns 目录从未建立）。

### 2.4 归因面结构与「既有绿灯为何漏网」

- `packages/namespace-diagnostic-log/src/emission.ts` L33–51（本轮亲核）：`NamespaceDiagnosticChangeEmission` 无任何 namespace 字段——归因唯一载体 = 接收 emitter 实例（#155 数据键控设计）。修复面只能在「数据键控消费点扩展」或「Host 侧按候选 ns 缓冲」两族方向上。
- `packages/namespace-registry/test/registry-create-diagnostic-red.test.ts` L433–457（本轮亲核）：#150 契约的 Host binding 是**缓冲型**——`pending.push(emission)` 装载前缓冲、`initStream` 后 `for (const e of pending.splice(0)) fileLog.emitter.emit(e)` 重放进流。该形状与生产供应方（恒丢弃）不一致：既有绿灯（本轮基线 30 绿即含该面）覆盖「缓冲型 Host」，未覆盖生产 wiring ⇒ 建流前结局的生产确定性丢弃逃过既有测试。

### 2.5 判定

与 ADR-0011 L57 覆盖条款（「namespace create，包括输入、schema、ROOT、duplicate、Persistence 与 post-commit Runtime construction 结局」——本轮逐字亲核）和 CONTEXT.md「变更尝试」（「被拒请求也属于变更尝试，即使它从未读取输入或进入 transaction」）直接冲突——**缺陷链 A 是明文契约的实现缺口，不是契约空白**。

## 3. 缺陷链 B 独立源码核验（本轮亲自读原文）

### 3.1 B1：create lifecycle carrier 槽内的建流与同步 append

- `diag.initStream(...)`（registry.ts L1436）位于 `runCreateAttempt` 槽内（Persistence `createDoc` 成功后、runtime factory 之前）；槽经 `admitCreateAttempt`（L1298–1301）串行化在同 key lifecycle carrier 上；槽内 `emitStreamOutcome`（L1450/L1463）→ ns emitter `emit` 同步落盘。
- 生产 `initStream` → `ensureAdapter`（diagnostics.ts L84–112）→ `createFileDiagnosticLog` 构造器**全同步 fs**（`packages/namespace-diagnostic-log/src/adapters/file.ts` 本轮亲核行号）：recursive `mkdirSync` L860、manifest `'wx'` 不可变创建 L879、genesis append（runGenesis 链）、current.json temp+rename（`writeFileSync` L905 + `renameSync` L906）、reopen 健康证明/可证明尾部修复 `truncateSync` L948、#154 构造期 retention sweep（`sweepOnOpen` 缺省 true，L316–317、L1455–1457）。
- 每 record 独立 `appendFileSync`（BIN frame L684 / JSONL line L699）——无队列、无 batch、无 fsync（文件头 L16 自述，首切片形态）。
- 复现锚：T8（慢建流+慢 append 120ms 级 → `create:settled` 晚于 `initStream:end`/`emit:end`，红灯 `expected 6 to be less than 3`）；T9（慢建流 + 已接纳 create + shutdown——ADR-0009 L99「等待此前已接纳的 lifecycle 操作结算」+ L140「create 的跨候选重试仍受 lifecycle carrier 串行化与 shutdown 已接纳操作屏障约束」（本轮逐字亲核），故 shutdown 结算被槽内建流同步延长）。

### 3.2 B2：open lifecycle 槽内 adapter 构造（reopen/repair/retention sweep）

registry.ts L1229（本轮亲核）：open 槽内 factory 第三参 `resolveRuntimeDiag(identity.namespaceId)` → `runtimeEmitterFor(ns)` → 缓存 miss 时 `ensureAdapter` 同步构造 File adapter——locator 解析、reopen 健康证明、尾部修复 truncate、构造期 retention sweep 全部落在 open 槽内。diagnostics.ts 头注释 L22–25 自认落点（「构造期同步 fs……只发生在 Registry open/create/import 槽内」），并以「write sequencer 尚不存在」自辩；但任务简报 AC3 点名的关键路径包含 Registry lifecycle carrier（ADR-0009 同 key 串行），隔离条件在「不延长业务排序关键路径」意义上未满足。复现锚：T10（`ensureBlockMs=150` → `open:settled` 晚于 `ensure:end`，红灯 `expected 2 to be less than 1`）。

### 3.3 B3：Runtime write-sequencer 槽间窗口的同步 emit

本轮独立重建微任务序（`packages/namespace-runtime/src/sequencer.ts` L38–42 + `runtime.ts` 调用点 + `diagnostic.ts`，全部亲核）：

1. `enqueue` 内 `const settled = this.tail.then(run, run); this.tail = settled.then(noop, noop);`——**noop hop 在 enqueue 内先注册**（L39–40）；
2. 公共方法（runtime.ts L470–475 root-write、L491–494 schema-write、L515–518 enable-replication、L536–539 bump-epoch）在 `enqueue` 返回后才注册 `settled.then(emitSlot)`——**注册序晚于 noop hop**；
3. 槽 N settle 时微任务队列 = `[noop, emitSlot]`：noop 先跑 → tail（noop promise）resolve → 槽 N+1 的 `run`（早已注册在 tail 上）排到队尾（emitSlot 之后）⇒ **emitSlot 的同步 `appendFileSync` 恰落在「本槽释放 → 下一槽启动」的关键窗口**；
4. `emitSlot`（diagnostic.ts L174 起）→ `emitAttempt`（L146 起）→ `env.emitter.emit(...)`（L149）——同步调用，无 deferral；`diagnostic.ts` 注释自述「emitSlot 仅由公共方法的 `.then` 回调调用——write sequencer slot 已释放」——该论证只覆盖**相对上一槽**，未覆盖**相对下一槽**；
5. close barrier 经同一 `sequencer.enqueue` 挂接（close.ts L38–40 `enqueueCloseBarrier`）——同样排在上游槽 emitSlot 之后。

⇒ 慢或挂起的同步 emitter 直接推迟下一业务写槽启动与 close barrier 推进。复现锚：T12（w1→w2 结算间隔 101ms，红灯 `expected 101 to be less than 50`；顺序锚 `notify:2` 晚于 `emit1:start`）、T13（close 结算 101ms，同形）。

## 4. 规范条款逐字核对（本轮直接读 ADR 原文）

| 引用 | 核对结果 |
|---|---|
| ADR-0011 L57（create 覆盖范围） | ✓ 逐字属实：「namespace create，包括输入、schema、ROOT、duplicate、Persistence 与 post-commit Runtime construction 结局」——建流前结局属明文覆盖项 |
| ADR-0011 L117–129（隔离面） | ✓ 逐字属实：「不得阻塞、throw、返回 durability promise」；「日志不得引入第二个业务排序机构」；「emitter 不被 `await`」；「adapter 慢、失败或队列满都不得延长 write slot 或阻塞 close/shutdown；Host shutdown 可 best-effort drain 日志，但 Registry/Persistence 的停止不得无限等待日志 sink」 |
| ADR-0014（诊断日志版 `0014-vfsl-validated-jsonl-and-framed-sidecar-change-log.md`）amendment | ✓ 逐字属实：「此处『有界』……不表示底层文件系统延迟有时间上界，亦不表示 `emit` 可在任意调用点不阻塞。**任何将 File adapter 的 `emit` 接入 namespace 生命周期的调用点，必须位于 NamespaceRuntime write sequencer slot 之外，或在该 slot 已释放之后；不得在 slot 内执行同步 File adapter `emit`。** 不满足该条件的接线为不合规，必须由 #149–#151/#155 或后续接线票修复后方可启用」——本任务即该预留接线票；`packages/namespace-diagnostic-log/AGENTS.md` Boundaries 段以同文复述该纪律（#153 起明确覆盖构造期同步 fs） |
| ADR-0008 L51（slot 步骤） | ✓ 逐字属实：「lifecycle/fatal gate、`DocHandle.getStatus()` writable gate、输入快照、领域校验和 detached 构造、一次 Yjs transaction、`await notifyDirty()`，然后才释放给下一任务」——不含日志 I/O |
| ADR-0009 L62 / L99 / L140 | ✓ 逐字属实：create 槽内清单「完整 snapshot、compile、validate、detached construction、Persistence create 和 Runtime construction 均在同一个 lifecycle 槽中执行」——不含日志建流；shutdown「等待此前已接纳的 lifecycle 操作结算」；「create 的跨候选重试仍受 lifecycle carrier 串行化与 shutdown 已接纳操作屏障约束」——T9 机制锚成立 |
| ADR-0010 L28 | ✓ 逐字属实：「由注入的受控 128-bit CSPRNG 生成 `ns-` + 32 位小写 hex；撞到当前 Registry entry 或目标 Persistence duplicate 时最多重试 8 次，耗尽以 `committed:false` Registry fatal 失败」——早结局发射时 Registry 已持有候选 id（AC1 归属锚） |

（编号消歧：本报告「ADR-0014」均指诊断日志版 `0014-vfsl-validated-jsonl-and-framed-sidecar-change-log.md`。）

## 5. 红灯契约有效性评估（本轮独立判断）

1. **判据确定性**：主判据为事件迹 `indexOf` 顺序断言（T8/T9/T10/T12/T13）与 ns 通道到达断言（T1–T6 `waitNsRecords` poll），免定时器抖动；墙钟仅旁证且阈值取注入阻塞（100–150ms）一半以下，余量 ≥2×。
2. **Host 形状忠实**：本轮直接读 `makeProductionShapedHost`（registry 红测试 L191–238）——共享通道恒丢弃+计数（L220–225）、`runtimeEmitterFor(ns)` 数据键控（L232）、`initStream(ns, bytes)` 建流（L226–231），与 `diagnostics.ts` 生产语义逐点对应（L74–76/L116/L118–127）；runtime 红测试用冻结 seam `diagnosticEmitter` + `clock` 成对注入慢同步 emitter（runtime.ts L599/L705–723 成对校验亲核），seam 形状（同步、void、不 throw）零发明。慢存储模拟（`Atomics.wait` 受控同步阻塞）位于 Host 供应方侧——与生产分层一致，被测对象即 amendment 明示的「无上界文件系统延迟」风险面。
3. **边界有 GREEN 对照**：T7 与 T11 前半钉住缺口边界 = 「`initStream` 之前」，不误伤已工作面。
4. **业务隔离面被守护**：各红用例业务面 GREEN 锚先行执行并通过（本轮输出可见 T12 `w1/w2 ok + 终值 3` 先行）。
5. **poll 消除合法延后伪红**：`waitNsRecords`（L276–281）对归属到达采用 1s poll——修复后 emission 可合法延后（ADR-0011「emitter 不被 await」）不会产生伪红。
6. **修复可翻绿**：断言面 = AC 明文行为面（结局以候选 ns 归属到达数据键控通道 / 业务结算标记先行于日志存储完成标记），不锚定特定实现形态——延迟同步 append 或 queue/batch 载体的合规修复均可翻绿。实现约束：T9/T13 的顺序断言要求日志 I/O 的排程**不先于** shutdown/close 结算续段——微任务级 deferral 不足以满足，须 macrotask/queue 级搬移或异步化。

## 6. 与既有证据链的比对

- **失败分布六轮一致**：首轮 §3.2、§7.3、§8.1、verify3 §4、verify4 §1.1、sa5 §1、本轮——全部 `12 failed | 1 passed (13)`，红灯稳定复现，无环境噪声。
- **失败形态一致**：T1–T6 `expected +0 to be 1`、T8/T9 `expected 6 to be less than 3`、T10 `expected 2 to be less than 1`、T11 `expected false to be true`、T12/T13 墙钟 100–104ms 区间抖动（顺序断言为主判据）。
- **既有报告全部可核主张经本轮独立抽查属实**：机制链条、代码锚点（本轮实测行号 L776/L1229/L1316/L1328/L1364/L1379/L1394/L1411/L1419/L1427/L1436/L1450/L1463、file.ts L316/L684/L699/L860/L879/L905/L906/L948/L1455、sequencer.ts L38–42、runtime.ts L470–539/L599、close.ts L38–40、diagnostic.ts L146–174、emission.ts L33–51、diagnostics.ts L74–127 与所引全部一致，误差 ≤ 数行）、「缓冲型 Host 漏网」定性（本轮亲核 #150 契约 L433–457）、ADR 逐字引用（§4 表）。未发现夸大、错引或需更正之处。
- **登记面（非红灯对象，维持登记不预裁）**：entry 碰撞候选重试（registry.ts L1311）与 Persistence `DOC_DUPLICATE` 重试（L1408）零发射（#150「恰一条最终结局」裁决覆盖重试成功场景）；id 预算耗尽 fatal（L1269–1273）仅 observer 事件、零诊断发射（该终局无可用 ns id，归属策略属下游设计点，`task_issue-226_relevant_decisions.md` §设计敏感点 2 已登记）。

## 7. 给下游的移交确认

红灯契约文件无需修改即可作为修复验收基线；下游（设计/实现）红线经本轮复核前提全部成立，维持登记：

1. seam 字段名冻结（`diagnosticLog.emitter` / `initStream` / `runtimeEmitterFor`；Runtime `diagnosticEmitter`+`clock` 成对）；
2. emitter 公共 seam / record schema / manifest policy / 词表冻结——早结局补记不得新增 operation/stage/result 值，不得冒充 genesis 或伪称重放连续（ADR-0014 L24「genesis 只代表从该时点开始」）；
3. 早结局归属通道形态（数据键控消费点扩展 vs Host 侧按候选 ns 缓冲）为核心设计点；被拒 create 无后续 stream 可补记 ⇒ 须为该结局建立 stream（T11 落点）；id 耗尽 fatal 归属需显式裁决；
4. 隔离载体形态（slot 外延迟同步 append vs queue/batch 切片——后者须另行定义 close/shutdown、flush、队列满、fsync 语义）；T9/T13 要求 macrotask/queue 级搬移或异步化，微任务级 deferral 不足；
5. shutdown 公共契约不变（同 Promise、`NamespaceRegistryShutdownError` 聚合、停止接纳；日志 drain 只能是有界 best-effort）；
6. 不得引入第二个业务排序机构（ADR-0011）；notifyDirty 槽序不包裹不替代。

## 8. 本轮产出与边界

- 本文件：`wiki/raw/20260905-bug-issue-226-verify5.md`（第五轮独立故障分析与复现确认）
- 复现载体（既有，本轮零改动重跑确认）：`packages/namespace-registry/test/registry-issue-226-red.test.ts`（T1–T11）、`packages/namespace-runtime/test/runtime-issue-226-red.test.ts`（T12–T13）
- 本轮运行证据：后台 Job `bash-1`（红灯 12F|1P，RED_EXIT=1）与 `bash-2`（基线 30P，BASELINE_EXIT=0）完整输出，关键摘录已录入 §1
- **未实施任何修复**；`src/**`、既有测试、配置零改动（`git diff --stat` 为空）。下游可以首轮 §1–§5 + verify3/verify4/sa5 + 本报告作为验收基线继续。
- 委派指令所写简报路径 `wiki/raw/task_226.md` 不存在；实际简报为 `wiki/raw/task_issue-226.md`（issue 编号唯一对应，已按其内容执行）。
