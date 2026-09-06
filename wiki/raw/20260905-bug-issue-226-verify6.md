# Issue #226 红灯契约与复现证据独立确认 — 总控裁决轮（2026-09-05，verify6）

- 任务：Issue #226（bugfix）——`wiki/raw/task_issue-226.md`（创建诊断覆盖缺口 + 日志生命周期隔离）
- Worktree：`/home/wangjian/nomicore-fix-issue-226`（branch `mabf/issue-226`，HEAD `45a22f0`，与全部前轮一致；`git diff --stat` 为空——tracked 零修改，产品代码未被触碰）
- 本轮性质：**总控（Controller）独立确认轮**。背景：此前七次 SA5 派发均以 Host settlement interrupted 终止（durable work records 无有效 sa-completed 业务结果）；按委派指令，本轮由总控会话**亲自**独立重跑红灯契约与复现证据、逐点亲读源码/ADR 锚点，不派发 SA、不修改产品代码。
- 环境：node v24.13.0 / pnpm 10.28.2 / vitest 3.2.7（`--typecheck` 开启）。
- 输入（前置产物，非本轮产出）：`20260905-bug-issue-226.md`（首轮，含 §7/§8 补记）、`-verify2-runs.md`、`-verify3.md`、`-verify4.md`、`-verify5.md`、`task_issue-226_sa5.md`、`task_issue-226_conflict_report.md`（SA8 clear，R5 复核维持）、`task_issue-226_relevant_decisions.md`、`task_issue-226_dispatch.md`。

## 0. 裁决结论（TL;DR）

**红灯契约与复现证据经本轮独立确认全部有效，verdict = clear：**

| 项 | 本轮独立结果 |
|---|---|
| 红灯契约重跑（后台 Job `bash-1`） | `Test Files 2 failed (2)`、`Tests 12 failed \| 1 passed (13)`、`Type Errors: no errors`、`RED_EXIT=1`（预期红灯）——与既有七轮（首轮 §3.2、§7.3、§8.1、verify2、verify3、verify4、sa5、verify5）**逐轮一致** |
| 相邻绿灯基线（后台 Job `bash-2`） | `30 passed (30)`、`Type Errors: no errors`、`BASELINE_EXIT=0`——失败归因于 #226 新增用例，非环境噪声 |
| 缺陷链 A（建流前结局确定性丢弃，AC1） | 机制经本轮亲读源码核验成立；T1–T6、T11 红，T7 绿对照通过（23ms）钉住边界 = `initStream` 之前 |
| 缺陷链 B（同步日志 I/O 在业务关键路径，AC3/AC4） | 三个落点（create carrier 槽 / open 槽 / Runtime sequencer 槽间窗口）经本轮亲读源码核验成立；T8、T9、T10、T12、T13 红 |
| SA8 冲突门禁 | verdict clear（2026-09-05T08:20Z 首判，09:25Z R5 复核维持）；本轮对 ADR-0011 覆盖条款与 ADR-0012 amendment L250 原文抽查**逐字属实**，未见任何新冲突信号 |
| 红灯契约作为修复验收基线 | **确认有效，无需修改即可移交下游**（判据确定性 / Host 形状忠实 / 边界 GREEN 对照 / 业务隔离面守护 / poll 消伪红 / 修复可翻绿，六项全部成立，见 §4） |

## 1. 本轮独立重跑证据（后台 Job，命令与前七轮完全一致）

```bash
# 红灯契约（可执行复现载体）
pnpm test packages/namespace-registry/test/registry-issue-226-red.test.ts \
          packages/namespace-runtime/test/runtime-issue-226-red.test.ts
# Test Files  2 failed (2)
#      Tests  12 failed | 1 passed (13)
# Type Errors  no errors        （RED_EXIT=1，预期红灯；Duration 14.28s）

# 相邻绿灯基线（环境健全性对照）
pnpm test packages/namespace-registry/test/registry-create-diagnostic-red.test.ts \
          packages/namespace-runtime/test/runtime-root-schema-diagnostic-red.test.ts
# Test Files  2 passed (2)
#      Tests  30 passed (30)
# Type Errors  no errors        （BASELINE_EXIT=0；Duration 7.21s）
```

失败形态逐条（本轮实测）：

| 用例 | 本轮实测形态 | 缺陷链 |
|---|---|---|
| T1–T6（schema-compile / validation / input-snapshot / Persistence 运营 / Persistence fatal committed:true / create-document-internal fatal） | ns 数据键控通道 `expected +0 to be 1`（`waitNsRecords` L279 poll 1s 超时包裹） | A |
| T7 GREEN 对照（#17/#18 已正确归属） | **通过（23ms）** | 边界证明 |
| T8 create 结算不等日志存储 | `expected 6 to be less than 3`（L471 顺序锚） | B1 |
| T9 shutdown 不等日志存储 | `expected 6 to be less than 3`（L504） | B1 |
| T10 open 结算不等 adapter 构造 | `expected 2 to be less than 1`（L531） | B2 |
| T11 被拒 create 零落盘 | 候选 ns 目录 poll `expected false to be true`（L615；成功 create 落盘 GREEN 对照先行通过） | A（落盘面） |
| T12 下一业务写槽不被慢 emit 推迟 | `下一业务写槽被慢日志 emission 推迟 101ms: expected 101 to be less than 50`（L126；顺序锚 `notify:2` 晚于 `emit1:start` 同判据族） | B3 |
| T13 close 不被慢 emit 延长 | `close 结算被慢日志 emission 延长至 101ms: expected 101 to be less than 50`（L159） | B3 |

T12/T13 墙钟 101/101ms，落在既有七轮 100–104ms 区间内（顺序断言为主判据，墙钟阈值取注入阻塞 100ms 的一半以下，余量 ≥2×）。各红用例的业务面 GREEN 锚（ok lease / 稳定窄 issue / branded fatal + committed 事实 / FIFO 与终值 3）均先行执行并通过——业务结果不受日志缺陷影响，红灯只锚定「归属到达」与「关键路径不延长」两个行为面。

## 2. 源码锚点独立抽查（本轮亲自读原文，全部属实）

1. **seam 路由静态结构**（`packages/namespace-registry/src/create-diagnostic.ts`，本轮通读）：`createCreateDiag` 构造期一次捕获共享 `diagnosticLog.emitter`（形状门：null/敌意 getter/畸形 → NOOP_DIAG）；`emitOutcome`/`emitEarlyOutcome`——槽内结局全部发射面——恒走该共享 emitter 引用，不携带也不解析任何 namespaceId；唯二数据键控路径 = `emitStreamOutcome(namespaceId, …)`（resolver 现场解析，缺席时 legacy fallback 走共享 emitter）与 `initStream(namespaceId, bytes)`（建流缝，Host 同步 throw 吞没）。⇒ `initStream` 之前的结局只有无归属共享通道一条路，是 seam 的静态结构。
2. **Registry 发射点全部早于建流**（`packages/namespace-registry/src/registry.ts`，本轮亲核）：`admitCreateAttempt` 把 `runCreateAttempt` 挂同 key lifecycle carrier 链；槽内 `id.namespaceId`（受控 128-bit CSPRNG 候选 id）自接纳起在手上。input-snapshot 拒绝（`emitEarlyOutcome`）、schema-compile/validation 拒绝（`emitOutcome`，含 buildInitialDocument 返回 invalid 分支）、create-document-internal fatal、Persistence 运营（`NAMESPACE_CREATE_FAILED`）与 fatal（保留 committed 事实）全部在建流前发射；`diag.initStream(id.namespaceId, state)` 位于 Persistence createDoc 成功后、runtime factory 之前（槽内）；`emitStreamOutcome`（#17 committed / #18 runtime-construction fatal）在建流后走数据键控通道。
3. **生产供应方恒丢弃**（`apps/yjs-server/src/diagnostics.ts`，本轮通读）：`unattributedEmitter = { emit: () => drop(closed ? 'manager-closed' : 'unattributed') }` 恒丢弃 + NDJSON 计数、零路由；`binding.emitter = unattributedEmitter`；`initStream` → `ensureAdapter`；`runtimeEmitterFor(ns)` → 缓存 miss 时同步构造 File adapter。文件头注释自述「全部 initStream 之前的 create emission 落此通道，绝不伪造归属」。⇒ 生产 wiring 下建流前结局零归属、零落盘；被拒 create 无后续 stream 可补记（T11 落盘面红灯锚成立）。
4. **open 槽内 adapter 构造**（registry.ts L1229 一带，本轮亲核）：open 槽 factory 第三参 `resolveRuntimeDiag(identity.namespaceId)` → `runtimeEmitterFor(ns)` → 缓存 miss 时 `ensureAdapter` 同步构造（reopen 健康证明 / 尾部修复 / 构造期 retention sweep 全同步 fs）。
5. **File adapter 全同步 fs**（`packages/namespace-diagnostic-log/src/adapters/file.ts`，本轮亲核行号）：`mkdirSync` L860、manifest `'wx'` L879、current.json `writeFileSync`+`renameSync` L905–906、尾部修复 `truncateSync` L948、`sweepOnOpen` 缺省 true（L316–317、L1455–1457）；每 record 独立 `appendFileSync`（BIN L684 / JSONL L699）——无队列、无 batch、无 fsync。
6. **Runtime sequencer 槽间窗口**（`packages/namespace-runtime/src/sequencer.ts` + `runtime.ts` + `close.ts`，本轮亲核）：`enqueue` 内 `const settled = this.tail.then(run, run); this.tail = settled.then(noop, noop);`——noop hop 在 enqueue 内先注册；公共方法（runtime.ts root-write L470–475 / schema-write L491–494 / enable-replication L515–518 / bump-epoch L536–539）在 enqueue 返回后才注册 `settled.then(emitSlot)`。槽 N settle 时微任务队列 = `[noop, emitSlot]`：noop 先跑 → tail resolve → 槽 N+1 的 run 排到 emitSlot 之后 ⇒ 同步 emit 恰落「本槽释放 → 下一槽启动」关键窗口；close barrier 经同一 `enqueue` 挂接，同样排在上游槽 emitSlot 之后。`emitSlot → emitAttempt → env.emitter.emit` 同步调用无 deferral。⇒ 慢同步 emitter 直接推迟下一业务写槽与 close barrier（T12/T13 机制锚成立）。
7. **规范条款逐字核对**（本轮直接读 ADR 原文）：ADR-0011 覆盖范围明文「namespace create，包括输入、schema、ROOT、duplicate、Persistence 与 post-commit Runtime construction 结局」；ADR-0012（诊断日志版）amendment L250 明文「任何将 File adapter 的 `emit` 接入 namespace 生命周期的调用点，必须位于 NamespaceRuntime write sequencer slot 之外，或在该 slot 已释放之后；不得在 slot 内执行同步 File adapter `emit`。不满足该条件的接线为不合规，必须由 #149–#151/#155 或后续接线票修复后方可启用」——本任务即该预留接线票；`docs/adr/` 共 **13 个文件**（与 SA8 R5 勘误一致）。⇒ 缺陷链 A 是明文契约的实现缺口（非契约空白），缺陷链 B 是 amendment 明文点名的违规接线——两者均有直接规范依据。

## 3. 与既有证据链的一致性

- **失败分布八轮一致**：12 failed | 1 passed (13)，红灯稳定复现，无环境噪声。
- **失败形态一致**：T1–T6 `expected +0 to be 1`、T8/T9 `expected 6 to be less than 3`、T10 `expected 2 to be less than 1`、T11 `expected false to be true`、T12/T13 墙钟 100–104ms 区间。
- **既有报告可核主张经本轮独立抽查属实**：机制链条、代码锚点（本轮亲读与所引行号一致，误差 ≤ 数行）、「缓冲型 Host 漏网」定性（#150 契约 Host binding 缓冲重放 vs 生产恒丢弃形状不一致——verify5 §2.4/sa5 §2.4 已直接读证，本轮复核其引述与测试文件 L191–238 逐点对应）、ADR 逐字引用。未发现夸大、错引或需更正之处。
- **登记面维持**（非红灯对象，不预裁）：entry 碰撞候选重试与 Persistence `DOC_DUPLICATE` 重试零发射（#150「恰一条最终结局」裁决覆盖）；id 预算耗尽 fatal 仅 observer 事件、零诊断发射（归属策略属下游设计点，`_relevant_decisions.md` §设计敏感点 2 已登记）。

## 4. 红灯契约有效性判定（本轮独立判断，维持前轮结论）

1. **判据确定性**：主判据为事件迹 `indexOf` 顺序断言与 ns 通道到达断言，免定时器抖动；墙钟仅旁证且阈值取注入阻塞一半以下。
2. **Host 形状忠实**：registry 红测试 `makeProductionShapedHost`（L191–238）——共享通道恒丢弃+计数、`runtimeEmitterFor(ns)` 数据键控、`initStream(ns, bytes)` 建流——与 `diagnostics.ts` 生产语义逐点对应（本轮对读两侧源文确认）；runtime 红测试以冻结 seam `diagnosticEmitter`+`clock` 成对注入慢同步 emitter，seam 形状零发明；慢存储模拟（`Atomics.wait` 受控阻塞）位于 Host 供应方侧，与生产分层一致。
3. **边界有 GREEN 对照**：T7 与 T11 前半钉住缺口边界 = 「`initStream` 之前」，不误伤已工作面。
4. **业务隔离面被守护**：各红用例业务面 GREEN 锚先行通过。
5. **poll 消除合法延后伪红**：`waitNsRecords` 1s poll——修复后 emission 合法延后不会产生伪红。
6. **修复可翻绿**：断言面 = AC 明文行为面，不锚定特定实现形态；延迟同步 append 或 queue/batch 载体的合规修复均可翻绿。实现约束（移交下游）：T9/T13 顺序断言要求日志 I/O 排程不先于 shutdown/close 结算续段——微任务级 deferral 不足，须 macrotask/queue 级搬移或异步化。

## 5. 治理记录（本轮边界）

- **七次 SA5 派发中断**：durable work records 显示 SA5 派发均以 Host settlement interrupted 终止（无有效 sa-completed 业务结果）；唯一次成功落盘的 SA5 产物为 `task_issue-226_sa5.md`（retry5，13:02Z）与 `20260905-bug-issue-226-verify5.md`。本轮按委派指令由总控亲自执行独立确认，未派发新 SA；派发日志已补记本轮（第 3 行）。
- **零产品代码改动**：`git diff --stat` 为空；`git status --porcelain` 仅本任务既有未跟踪文件（两个红灯测试 + wiki 材料）+ 本报告。两个红灯测试文件本轮零改动（既有复现载体，仅重跑）。
- **⚠️ 陈旧 REPORT.md 异常登记**：worktree 根 `REPORT.md` 为**前一任务 #155 的遗留**（`status: complete`、`run_id: controller-…-155-…`、`branch: mabf/issue-155`），与本任务（issue-226 / `mabf/issue-226`）不符。本轮**未改写、未消费**该文件；`.mabf-done` 不存在，完成事务未成立。issue-runner/外层调度在处理 issue-226 完成事务时必须以带 `run_id`/`branch` 匹配 `mabf/issue-226` 的新 REPORT.md 为准，不得读取该遗留文件。
- **完成事务状态**：issue-226 本地完成事务**未成立**——修复尚未实施（红灯仍红），SA5→SA7 完成链未走完，故本轮不写 `status: complete`、不写 `.mabf-done`。

## 6. 给下游的移交

红灯契约两文件**无需修改即可作为修复验收基线**。下游（设计/实现）红线维持既有登记（seam 字段名冻结、emitter 公共 seam / record schema / manifest policy / 词表冻结、早结局补记不得冒充 genesis 或伪称重放连续、早结局归属通道形态与隔离载体形态为核心设计点、shutdown 公共契约不变、不得引入第二个业务排序机构），详见 `task_issue-226_sa5.md` §7 与 `20260905-bug-issue-226-verify5.md` §7。SA8 已建议设计后执行 conflict recheck。

## 7. 本轮产出

- 本文件：`wiki/raw/20260905-bug-issue-226-verify6.md`（总控独立确认轮报告）
- 运行证据：后台 Job `bash-1`（红灯 12F|1P，RED_EXIT=1）与 `bash-2`（基线 30P，BASELINE_EXIT=0）完整输出，关键摘录已录入 §1
- 派发日志补记一行（无新 SA 派发，本轮为总控亲自执行）
