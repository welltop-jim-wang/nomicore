# SA5 独立复现与分析报告 — Issue #226 创建诊断覆盖缺口与日志生命周期隔离

- 任务：Issue #226（bugfix）——`wiki/raw/task_issue-226.md`
- Worktree：`/home/wangjian/nomicore-fix-issue-226`（branch `mabf/issue-226`，HEAD `45a22f060eee924e4ed6a2d6fa64fb7cd6b2db08`）
- 阶段/角色：SA5 独立复现与分析轮（本轮职责 = 对已报告的两条缺陷链做**独立**的机制重建、源码锚点核对、规范条款逐字核对与可执行复现重跑；**不实施修复、不预裁设计**）
- 日期：2026-09-05（UTC）
- 前置产物（本轮输入，非本轮产出）：`20260905-bug-issue-226.md`（SA1 首轮报告，含 §7/§8 两轮复核补记）、`20260905-bug-issue-226-verify2-runs.md`（第二轮复核运行输出）、`20260905-bug-issue-226-verify3.md`（第三轮独立分析与复现）、`task_issue-226_conflict_report.md`（SA8 verdict clear，R5 维持）、`task_issue-226_relevant_decisions.md`
- 复现载体（既有红灯契约，本轮零改动重跑）：`packages/namespace-registry/test/registry-issue-226-red.test.ts`（T1–T11）、`packages/namespace-runtime/test/runtime-issue-226-red.test.ts`（T12–T13）
- **SA5 独立性声明**：本轮零产品代码改动（`src/**` 未触碰）、零测试文件改动、零配置改动；worktree 唯一写入 = 本报告文件。tracked 文件零修改（`git diff --stat` 为空；`git status --porcelain` 仅本任务既有未跟踪文件）。

## 0. 本轮结论（TL;DR）

| 项 | 结论 |
|---|---|
| 缺陷链 A：建流前 create 结局被无归属通道确定性丢弃（AC1） | **机制经本轮直接读源码独立重建成立，且可执行复现**——T1–T6、T11 红；T7 绿对照钉住边界 = `initStream` 之前 |
| 缺陷链 B：同步日志 I/O 位于业务关键路径（AC3/AC4） | **三个落点（create carrier 槽内建流+同步 append / open 槽内 adapter 构造 / Runtime write-sequencer 槽间窗口同步 emit）逐一源码核验成立，可执行复现**——T8–T10、T12、T13 红 |
| 红灯契约独立重跑（本轮，后台 Job `bash-1`） | `Tests 12 failed \| 1 passed (13)`、`Type Errors: no errors`、EXIT=1（预期红灯）；相邻绿灯基线 `30 passed (30)`、EXIT=0——失败归因于新增用例，非环境噪声 |
| 与既有证据链的一致性 | 失败形态与首轮 §3.2、§7.3、§8.1、verify3 §4 四轮记录逐条一致（T12/T13 墙钟 100/101ms vs 既有 101–103ms，属正常抖动；顺序断言为主判据）；SA1 报告全部可核主张经本轮独立抽查**属实，无需更正** |
| 红灯契约作为修复验收基线 | **确认有效**（判据确定性、Host 形状忠实、边界有 GREEN 对照、业务隔离面被守护、seam 零漂移、修复可翻绿） |

## 1. 独立重跑证据（本轮，后台 Job）

环境：node v24.13.0 / pnpm 10.28.2 / vitest 3.2.7；HEAD `45a22f060eee924e4ed6a2d6fa64fb7cd6b2db08`；tracked 零修改。命令与既有四轮完全一致：

```bash
# 红灯契约（可执行复现载体）
pnpm test packages/namespace-registry/test/registry-issue-226-red.test.ts \
          packages/namespace-runtime/test/runtime-issue-226-red.test.ts
# Test Files  2 failed (2)
#      Tests  12 failed | 1 passed (13)
# Type Errors  no errors        （RED_EXIT=1，预期红灯；Duration 11.91s）

# 相邻绿灯基线（环境健全性对照）
pnpm test packages/namespace-registry/test/registry-create-diagnostic-red.test.ts \
          packages/namespace-runtime/test/runtime-root-schema-diagnostic-red.test.ts
# Test Files  2 passed (2)
#      Tests  30 passed (30)
# Type Errors  no errors        （BASELINE_EXIT=0；Duration 5.05s）
```

失败形态逐条（本轮实测；主判据为确定性顺序断言，墙钟为 ≥2× 余量旁证）：

| 用例 | 本轮实测形态 | 缺陷链 |
|---|---|---|
| T1–T6（schema-compile / validation / input-snapshot / Persistence 运营 / Persistence fatal(committed:true) / create-document-internal fatal） | ns 数据键控通道 `expected +0 to be 1`（`waitNsRecords` L279 poll 超时包裹，`Caused by: AssertionError` 同形） | A |
| T7 GREEN 对照（#17/#18 已正确归属） | **通过（17ms）** | 边界证明 |
| T8 create 结算不等日志存储 | `expected 6 to be less than 3`（L471） | B1 |
| T9 shutdown 不等日志存储 | `expected 6 to be less than 3`（L504） | B1 |
| T10 open 结算不等 adapter 构造 | `expected 2 to be less than 1`（L531） | B2 |
| T11 被拒 create 零落盘 | 目录 poll `expected false to be true`（L615；成功 create 落盘对照半先行通过） | A（落盘面） |
| T12 下一业务写槽不被慢 emit 推迟 | `下一业务写槽被慢日志 emission 推迟 100ms: expected 100 to be less than 50`（L126；墙钟旁证先于顺序锚触发） | B3 |
| T13 close 不被慢 emit 延长 | `close 结算被慢日志 emission 延长至 101ms: expected 101 to be less than 50`（L159） | B3 |

各红用例的业务面 GREEN 锚（稳定窄 issue / branded fatal + committed 事实 / ok lease / FIFO 与终值）均**先行执行并通过**——业务结果不受日志缺陷影响（ADR-0011 隔离面在「不改业务结果」意义上仍守），红灯只锚定「归属到达」与「关键路径不延长」两个行为面。

## 2. 缺陷链 A 独立机制核验（本轮直接读源码）

### 2.1 seam 路由结构是静态的，不是运行时偶发

`packages/namespace-registry/src/create-diagnostic.ts`（本轮通读 L299–381）：

- `createCreateDiag`（L310–313）在 Registry 构造栈一次读取共享 `diagnosticLog.emitter`（L314–328，形状门：违约 → NOOP_DIAG），此后 emit 侧只用该引用；
- `emitOutcome(observedAt, e)`（L334–336）与 `emitEarlyOutcome(e)`（L338–342）——Registry 槽内结局的**全部**发射面——**恒走构造期捕获的共享 emitter**，不携带也不解析任何 namespaceId；
- 唯二的 namespace 数据键控路径：`emitStreamOutcome(namespaceId, …)`（L354–365，经 `resolveEmitterOnce(streamResolver, namespaceId)` 现场解析）与 `initStream(namespaceId, bytes)`（L370–379，建流缝；Host 违约同步 throw 被吞没）。

⇒ 凡在 `initStream` 之前发射的 create 结局只有共享 emitter 一条路可走。

### 2.2 Registry 发射点全部早于建流，且归属数据在发射时点已在手上

`packages/namespace-registry/src/registry.ts`：`admitCreateAttempt`（L1291–1304）把 `runCreateAttempt` 挂到同 key lifecycle carrier 链（L1298–1301）——下述发射全部发生在 carrier 槽内；槽内 `id.namespaceId`（受控 128-bit CSPRNG 候选 id，ADR-0010）自 L1311 起始终在手上：

| 行（本轮实测） | 发射 | 结局类别 | 相对建流 |
|---|---|---|---|
| L1316 | `emitEarlyOutcome`（input-snapshot 拒绝） | input-snapshot | **建流前** |
| L1328 | `emitOutcome`（schema-compile / validation 拒绝） | schema/validation | **建流前** |
| L1364、L1394 | `emitOutcome`（create-document-internal fatal） | 内部 fatal | **建流前** |
| L1411 | `emitOutcome`（DocCreateOperationalError → `NAMESPACE_CREATE_FAILED`） | Persistence 运营 | **建流前** |
| L1419、L1427 | `emitOutcome`（DocCreateFatalError / unknown → fatal，保留 committed 事实） | Persistence fatal | **建流前** |
| L1436 | `diag.initStream(id.namespaceId, state?.slice())` | 建立缝 | — |
| L1450、L1463 | `emitStreamOutcome`（#17 committed / #18 runtime-construction fatal） | post-commit | 建流后（数据键控） |

（公共入口同步段的停接纳/identity 拒绝 L1933/1943 亦走共享通道，但发生在 namespaceId 生成之前，本就无归属可用——非本缺陷链对象。）

### 2.3 生产供应方 = 恒丢弃 + 计数

`apps/yjs-server/src/diagnostics.ts`（本轮通读）：

- L74–76：`unattributedEmitter = { emit: () => drop(closed ? 'manager-closed' : 'unattributed') }`——恒丢弃 + NDJSON 计数，零路由；
- L114–116：`binding.emitter = unattributedEmitter`；L118–120 `initStream` → `ensureAdapter`；L123–127 `runtimeEmitterFor(ns)` → 缓存查表/构造；
- 文件头注释（L8–11）自述：「`binding.emitter` 恒丢弃 + 计数……**全部 initStream 之前的 create emission 落此通道**，绝不伪造归属」。

### 2.4 归因面结构与「既有绿灯为何漏网」

- `packages/namespace-diagnostic-log/src/emission.ts` L33–51：`NamespaceDiagnosticChangeEmission` 无任何 namespace 字段——归因唯一载体 = 接收 emitter 实例（#155 数据键控设计）。因此修复面只能在「数据键控消费点扩展」或「Host 侧按候选 ns 缓冲」两族方向上（SA1 §5.3 登记成立）。
- `packages/namespace-registry/test/registry-create-diagnostic-red.test.ts` L433–457（本轮直接读）：#150 契约的 Host binding 是**缓冲型**——`pending.push(emission)` 装载前缓冲、`initStream` 后 `for (const e of pending.splice(0)) fileLog.emitter.emit(e)` 重放进流。该形状与生产供应方（恒丢弃）不一致：既有绿灯覆盖「缓冲型 Host」，未覆盖生产 wiring ⇒ 建流前结局的生产确定性丢弃逃过既有测试。SA1 §1.4 定性成立。

### 2.5 判定

生产 wiring 下，§2.2 的全部建流前结局**零 namespace 归属、零落盘**（仅 NDJSON drop 计数）；且被拒 create 无后续 stream 可补记 ⇒ 落盘面同样为零（T11 红灯锚：候选 ns 目录从未建立）。这与 ADR-0011 覆盖条款（「namespace create，包括输入、schema、ROOT、duplicate、Persistence 与 post-commit Runtime construction 结局」）和 CONTEXT.md「被拒请求也属于变更尝试」直接冲突——**缺陷链 A 是明文契约的实现缺口，不是契约空白**。

## 3. 缺陷链 B 独立机制核验（本轮直接读源码）

### 3.1 B1：create lifecycle carrier 槽内的建流与同步 append

- `diag.initStream(...)`（registry.ts L1436）位于 `runCreateAttempt` 槽内（Persistence `createDoc` 成功后、runtime factory 之前），该槽经 `admitCreateAttempt`（L1298–1301）串行化在 lifecycle carrier 上；槽内 `emitStreamOutcome`（L1450/L1463）→ ns emitter `emit` 同步落盘。
- 生产 `initStream` → `ensureAdapter`（diagnostics.ts L84–112）→ `createFileDiagnosticLog` 构造器**全同步 fs**（本轮实测 `packages/namespace-diagnostic-log/src/adapters/file.ts` 行号）：`initializeGeneration` L857–898——recursive `mkdirSync`（L860）、manifest `'wx'` 不可变创建（L879）、genesis append（`runGenesis` L831 起）、current.json temp+rename（`writeCurrent` L901–915：`writeFileSync` + `renameSync` L906）；#153 reopen 健康证明/可证明尾部修复（`truncateSync` L948）；#154 构造期 retention sweep（`sweepOnOpen` 缺省 true，L316–317、L1455–1457）。
- 每 record 独立 `appendFileSync`：BIN frame L684 / JSONL line L699——无队列、无 batch、无 fsync（首切片形态，ADR-0012 amendment 明示）。
- 复现锚：T8（慢建流 120ms + 慢 append 120ms → `create:settled` 晚于 `initStream:end` 与 `emit:end`，红灯 `expected 6 to be less than 3`；墙钟 ≥240ms）、T9（慢建流 + 已接纳 create + shutdown——ADR-0009 L99「等待此前已接纳的 lifecycle 操作结算」+ amendment L140「create 的跨候选重试仍受 lifecycle carrier 串行化与 shutdown 已接纳操作屏障约束」，故 shutdown 结算被槽内建流同步延长，红灯同形）。

### 3.2 B2：open lifecycle 槽内 adapter 构造（reopen/repair/retention sweep）

registry.ts L1229：open 槽内 factory 第三参 `resolveRuntimeDiag(identity.namespaceId)` → `createRuntimeDiagResolver`（L779）→ `runtimeEmitterFor(ns)` → 缓存 miss 时经 `ensureAdapter` 同步构造 File adapter——locator 解析、reopen 健康证明、尾部修复 truncate、构造期 retention sweep 全部落在 open 槽内。diagnostics.ts 头注释自认落点（「构造期同步 fs……只发生在 Registry open/create/import 槽内」），并以「write sequencer 尚不存在——#153 纪律合规落点」自辩；但任务简报 AC3 点名的关键路径包含 Registry lifecycle carrier（ADR-0009 同 key 串行 / create 槽内清单），隔离条件在「不延长业务排序关键路径」意义上未满足。复现锚：T10（`ensureBlockMs=150` → `open:settled` 晚于 `ensure:end`，红灯 `expected 2 to be less than 1`）。

### 3.3 B3：Runtime write-sequencer 槽间窗口的同步 emit

本轮独立重建微任务序（`packages/namespace-runtime/src/sequencer.ts` L38–42 + `runtime.ts` 调用点 + `diagnostic.ts`）：

1. `enqueue` 内 `const settled = this.tail.then(run, run); this.tail = settled.then(noop, noop);`——**noop hop 在 enqueue 内先注册**；
2. 公共方法（runtime.ts L470–475 root-write、L491–494 schema-write、L515–518 enable-replication、L536–539 bump-epoch 等 8 处）在 `enqueue` 返回后注册 `settled.then(emitSlot)`——**注册序晚于 noop hop**；
3. 槽 N settle 时微任务队列 = `[C1(noop), C2(emitSlot)]`：noop 先跑 → tail（noop promise）resolve → 槽 N+1 的 `run` 排到队尾（emitSlot 之后）⇒ **emitSlot 的同步 `appendFileSync` 恰落在「本槽释放 → 下一槽启动」的关键窗口**；
4. `emitSlot`（diagnostic.ts L174 起）→ `emitAttempt`（L146 起）→ `env.emitter.emit(...)`（L149）——同步调用，无 deferral；
5. close barrier 经同一 `sequencer.enqueue` 挂接（`close.ts` L38–40 `enqueueCloseBarrier`）——同样排在上游槽 emitSlot 之后。

⇒ 慢或挂起的同步 emitter 直接推迟下一业务写槽启动与 close barrier 推进。#149/#151 注释（sequencer.ts 头/diagnostic.ts L10「emitSlot 由公共方法的 `.then` 回调调用——write sequencer slot 已释放之后」）的论证只覆盖**相对上一槽**，未覆盖**相对下一槽**——emit 位于链尾 hop 之前，仍在 sequencer 关键路径上。复现锚：T12（w1→w2 结算间隔 100ms，红灯 `expected 100 to be less than 50`；顺序锚 `notify:2` 晚于 `emit1:start`）、T13（close 结算 101ms，红灯同形）。

## 4. 规范条款逐字核对（本轮直接读 ADR 原文）

| 引用 | 核对 |
|---|---|
| ADR-0011 覆盖范围：「namespace create，包括输入、schema、ROOT、duplicate、Persistence 与 post-commit Runtime construction 结局」 | ✓ 逐字属实——建流前结局属明文覆盖项 |
| ADR-0011 隔离面：日志 emit/排队/持久化/背压/丢弃/关闭失败不得改变业务返回值、rejection、提交事实、sequencer 顺序或 Runtime 状态；emitter seam 以 non-throwing、有界、非阻塞方式同步接收 detached record；「日志不得引入第二个业务排序机构」；「emitter 不被 `await`」「adapter 慢、失败或队列满都不得延长 write slot 或阻塞 close/shutdown；Host shutdown 可 best-effort drain 日志，但 Registry/Persistence 的停止不得无限等待日志 sink」 | ✓ 逐字属实——业务结果隔离面仍守（各红用例 GREEN 锚），缺口在「不延长业务路径」意义上 |
| ADR-0012（诊断日志版 `0012-vfsl-validated-jsonl-and-framed-sidecar-change-log.md`）amendment（2026-08-28，#152 round 2）：「此处『有界』仅指 adapter 主动处理的数据量与操作数量受配置 payload/line limits 和单-record/单-frame 范围限制；它**不**表示底层文件系统延迟有时间上界，亦不表示 `emit` 可在任意调用点不阻塞。**任何将 File adapter 的 `emit` 接入 namespace 生命周期的调用点，必须位于 NamespaceRuntime write sequencer slot 之外，或在该 slot 已释放之后；不得在 slot 内执行同步 File adapter `emit`。** 不满足该条件的接线为不合规，必须由 #149–#151/#155 或后续接线票修复后方可启用」；queue/batch 为演进形态须另行定义 close/shutdown、flush、队列满、fsync 语义 | ✓ 逐字属实——本任务即该预留接线票；B3 的槽间窗口接线（以及按同一隔离精神经任务简报 AC3 延伸到 B1/B2 的 Registry carrier 槽内建流/构造）不满足该条件 |
| ADR-0008 L51（slot 步骤）：「每个真正写任务的槽依次执行：lifecycle/fatal gate、`DocHandle.getStatus()` writable gate、输入快照、领域校验和 detached 构造、一次 Yjs transaction、`await notifyDirty()`，然后才释放给下一任务」——不含日志 I/O | ✓ 属实 |
| ADR-0009：同 key open/create/generation close 按同步接纳顺序串行（carrier）；create 槽内清单「完整 snapshot、compile、validate、detached construction、Persistence create 和 Runtime construction 均在同一个 lifecycle 槽中执行」——不含日志建流；shutdown「取消全部 idle timer，等待此前已接纳的 lifecycle 操作结算，然后主动 close 全部 active/idle Runtime」；amendment「create 的跨候选重试仍受 lifecycle carrier 串行化与 shutdown 已接纳操作屏障约束」 | ✓ 属实——T9 机制锚：槽内建流被 shutdown 屏障等待 |
| ADR-0010：「由注入的受控 128-bit CSPRNG 生成 `ns-` + 32 位小写 hex；撞到当前 Registry entry 或目标 Persistence duplicate 时最多重试 8 次，耗尽以 `committed:false` Registry fatal 失败」 | ✓ 属实——AC1 归属锚：早结局发射时 Registry 已持有候选 id |
| CONTEXT.md「变更尝试」：「被拒请求也属于变更尝试，即使它从未读取输入或进入 transaction」 | ✓ 属实 |

（编号消歧：本报告「ADR-0012」均指诊断日志版 `0012-vfsl-validated-jsonl-and-framed-sidecar-change-log.md`。）

## 5. 红灯契约有效性评估（本轮独立判断）

1. **判据确定性**：主判据为事件迹 `indexOf` 顺序断言（T8/T9/T10/T12/T13——业务结算标记必须先行于日志存储完成标记），免定时器抖动；墙钟仅旁证且阈值取注入阻塞一半以下（100ms 阻塞 vs 50ms 阈值）。
2. **Host 形状忠实**：本轮直接读 `makeProductionShapedHost`（registry 红测试 L191–238）——共享通道恒丢弃+计数（L220–225）、`runtimeEmitterFor(ns)` 数据键控（L232）、`initStream(ns, bytes)` 建流（L226–231），与 diagnostics.ts 生产语义逐点对应；runtime 红测试用冻结 seam `diagnosticEmitter` + `clock` 成对注入慢同步 emitter（L109–110/L141–143），seam 形状（同步、void、不 throw）零发明。慢存储模拟（`Atomics.wait` 受控同步阻塞）位于 Host 供应方侧——与生产分层一致，被测对象即 amendment 明示的「无上界文件系统延迟」风险面。
3. **边界有 GREEN 对照**：T7 与 T11 前半钉住缺口边界 = 「`initStream` 之前」，证明数据键控通道与真实 File 落盘在建流后可用——红灯不误伤已工作面。
4. **业务隔离面被守护**：各红用例的业务面 GREEN 锚先行执行并通过（本轮输出可见 T1 业务断言先行、T12 `w1/w2 ok + 终值 3` 先行）。
5. **poll 消除合法延后伪红**：`waitNsRecords`（L276–281）对「结局归属到达数据键控通道」采用 1s poll——修复后 emission 可合法延后（ADR-0011「emitter 不被 await」）不会产生伪红。
6. **修复可翻绿**：断言面 = AC 明文行为面（结局以候选 ns 归属到达数据键控通道 / 业务结算标记先行于日志存储完成标记），不锚定特定实现形态——延迟同步 append 或 queue/batch 载体的合规修复均可翻绿。实现约束登记：T9/T13 的顺序断言要求日志 I/O 的排程**不先于** shutdown/close 结算续段——微任务级 deferral 不足以满足，须 macrotask/queue 级搬移或异步化（SA1 §5.4，本轮复核其推演成立）。

## 6. 与既有证据链的比对

- **失败分布四轮一致**：首轮 §3.2（12F\|1P）、§7.3 复核轮（12F\|1P）、§8.1 第二轮复核（12F\|1P）、verify3 §4（12F\|1P）、本轮（12F\|1P）——红灯稳定复现，无环境噪声。
- **失败形态一致**：T1–T6 `expected +0 to be 1`、T8/T9 `expected 6 to be less than 3`、T10 `expected 2 to be less than 1`、T11 `expected false to be true`、T12/T13 墙钟 100–103ms 区间抖动（顺序断言为主判据）。
- **SA1 报告与 verify3 全部可核主张经本轮独立抽查属实**：机制链条、代码锚点（本轮实测行号与所引一致，误差 ≤ 数行）、「缓冲型 Host 漏网」定性、ADR 逐字引用。未发现夸大、错引或需要更正之处。
- **登记面（非本红灯对象，维持登记不预裁）**：entry 碰撞候选重试（registry.ts L1311）与 Persistence `DOC_DUPLICATE` 重试（L1408）零发射（#150「恰一条最终结局」裁决覆盖重试成功场景）；id 预算耗尽 fatal（`throwIdGenerationFatal` L818 起）仅 observer 事件、零诊断发射（该终局无可用 ns id，归属策略属下游设计点，`_relevant_decisions.md` §设计敏感点 2 已登记）。

## 7. 给下游的移交确认

红灯契约文件无需修改即可作为修复验收基线；下游（设计/实现）红线经本轮复核前提全部成立，维持登记：

1. seam 字段名冻结（`diagnosticLog.emitter` / `initStream` / `runtimeEmitterFor`；Runtime `diagnosticEmitter`+`clock` 成对）；
2. emitter 公共 seam / record schema / manifest policy / 词表冻结——早结局补记不得新增 operation/stage/result 值，不得冒充 genesis 或伪称重放连续（ADR-0012 L24「genesis 只代表从该时点开始」）；
3. 早结局归属通道形态（数据键控消费点扩展 vs Host 侧按候选 ns 缓冲）为核心设计点；被拒 create 无后续 stream 可补记 ⇒ stream 须为该结局建立（T11 落点）；id 耗尽 fatal 归属需显式裁决；
4. 隔离载体形态（slot 外延迟同步 append vs queue/batch 切片——后者须另行定义 close/shutdown、flush、队列满、fsync 语义）；T9/T13 要求 macrotask/queue 级搬移或异步化，微任务级 deferral 不足；
5. shutdown 公共契约不变（同 Promise、`NamespaceRegistryShutdownError` 聚合、停止接纳；日志 drain 只能是有界 best-effort）；
6. 不得引入第二个业务排序机构（ADR-0011 L123）；notifyDirty 槽序不包裹不替代（L128）。

## 8. 本轮产出与边界

- 本文件：`wiki/raw/task_issue-226_sa5.md`（SA5 独立复现与分析报告）
- 复现载体（既有，本轮零改动重跑确认）：`packages/namespace-registry/test/registry-issue-226-red.test.ts`、`packages/namespace-runtime/test/runtime-issue-226-red.test.ts`
- 本轮运行证据：后台 Job `bash-1`（红灯 12F\|1P + 基线 30P 完整输出，关键摘录已录入 §1）
- **未实施任何修复**；`src/**`、既有测试、配置零改动。下游可以 SA1 报告 §1–§5 + verify3 + 本报告作为验收基线继续。
