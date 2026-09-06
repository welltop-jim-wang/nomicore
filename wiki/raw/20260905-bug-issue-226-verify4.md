# 独立故障分析与复现确认 — Issue #226（第四轮独立轮，2026-09-05）

- 任务：Issue #226（bugfix）——任务简报实际落点 `wiki/raw/task_issue-226.md`（委派指令所写 `task_226.md` 不存在，按 issue 编号唯一对应；简报内容 = 创建诊断覆盖缺口 + 日志生命周期隔离）
- Worktree：`/home/wangjian/nomicore-fix-issue-226`（branch `mabf/issue-226`，HEAD `45a22f060eee924e4ed6a2d6fa64fb7cd6b2db08`，与 origin/docs/namespace-diagnostic-change-log 对齐）
- 本轮性质：**恢复后的独立确认轮**（SA5 中断 → 三轮既有复核之后）。全部动作 = 独立重跑红灯契约与相邻绿灯基线（后台 Job）＋ 亲自读源码/ADR 逐点重建两条缺陷链机制。**零产品代码改动、零测试文件改动**（`git status --porcelain` 仅本任务既有未跟踪文件；`src/**` 与既有测试零触碰）。
- 环境：node v24.13.0 / pnpm 10.28.2 / vitest 3.2.7（`--typecheck` 开启）。

## 0. 结论（TL;DR）

**两条缺陷链在当前恢复工作树上均可复现，机制经本轮独立源码核验成立：**

| 缺陷链 | 复现结果 | 机制核验 |
|---|---|---|
| A. 建流前 create 结局被无归属通道确定性丢弃（AC1） | **T1–T6、T11 红**；T7 绿对照通过（缺口边界 = `initStream` 之前） | ✓ seam 静态结构 + 生产供应方恒丢弃 + 归因面无 ns 字段，逐一亲核 |
| B. 同步日志 I/O 位于业务关键路径（AC3/AC4） | **T8、T9、T10、T12、T13 红**（三个落点：create carrier 槽 / open 槽 / Runtime sequencer 槽间窗口） | ✓ carrier 串行化 + File adapter 全同步 fs + noop-hop 微任务序，逐一亲核 |

红灯重跑：`12 failed | 1 passed (13)`，`Type Errors: no errors`，EXIT=1（预期红灯）；相邻绿灯基线：`30 passed (30)`，EXIT=0——失败归因于 #226 新增用例，非环境噪声。失败形态与首轮 / §7 / §8 / verify3 四轮记录一致。

## 1. 独立重跑证据（本轮，后台 Job）

### 1.1 红灯契约（可执行复现载体，零改动重跑）

```bash
pnpm test packages/namespace-registry/test/registry-issue-226-red.test.ts \
          packages/namespace-runtime/test/runtime-issue-226-red.test.ts
# Test Files  2 failed (2)
#      Tests  12 failed | 1 passed (13)
# Type Errors  no errors        （RED_EXIT=1，预期红灯）
```

失败形态逐条（本轮实测，Job bash-1）：

| 用例 | 本轮实测形态 | 缺陷链 |
|---|---|---|
| T1 schema-compile 拒绝归因 | ns 数据键控通道 `expected +0 to be 1`（`waitNsRecords` L279 poll 超时包裹） | A |
| T2 validation 拒绝归因 | 同上 `expected +0 to be 1` | A |
| T3 input-snapshot 失败归因 | 同上 `expected +0 to be 1` | A |
| T4 Persistence 运营失败归因 | 同上 `expected +0 to be 1` | A |
| T5 Persistence fatal（committed:true）归因 | 同上 `expected +0 to be 1` | A |
| T6 create-document-internal fatal 归因 | 同上 `expected +0 to be 1` | A |
| T7 GREEN 对照（#17/#18 已正确归属） | **通过（19ms）** | 边界证明 |
| T8 create 结算不等日志存储 | `expected 6 to be less than 3`（L471 顺序锚） | B1 |
| T9 shutdown 不等日志存储 | `expected 6 to be less than 3`（L504） | B1 |
| T10 open 结算不等 adapter 构造 | `expected 2 to be less than 1`（L531） | B2 |
| T11 被拒 create 零落盘 | 候选 ns 目录 poll `expected false to be true`（L615；成功 create 落盘对照半先行通过） | A（落盘面） |
| T12 下一业务写槽不被慢 emit 推迟 | `下一业务写槽被慢日志 emission 推迟 104ms: expected 104 to be less than 50`（L126 墙钟旁证先触发） | B3 |
| T13 close 不被慢 emit 延长 | `close 结算被慢日志 emission 延长至 101ms: expected 101 to be less than 50`（L159） | B3 |

T12/T13 墙钟 104/101ms vs 前三轮 103/102/101ms——正常抖动（顺序断言为主判据，墙钟为 ≥2× 余量旁证）。各红用例的业务面 GREEN 锚（ok lease / 稳定 issue / branded fatal + committed 事实 / FIFO / 终值）均先行执行并通过——业务结果隔离面仍守，缺口在「不延长业务路径」意义上。

### 1.2 相邻绿灯基线（环境健全性对照，Job bash-2）

```bash
pnpm test packages/namespace-registry/test/registry-create-diagnostic-red.test.ts \
          packages/namespace-runtime/test/runtime-root-schema-diagnostic-red.test.ts
# Test Files  2 passed (2)
#      Tests  30 passed (30)
# Type Errors  no errors        （BASELINE_EXIT=0）
```

## 2. 缺陷链 A 独立源码核验（本轮亲自读原文）

1. **seam 静态结构**（`packages/namespace-registry/src/create-diagnostic.ts`，`createCreateDiag` L313–380）：构造栈一次读取共享 `emitter`（形状门违约 → NOOP_DIAG）；此后 `emitOutcome(observedAt, e)` 与 `emitEarlyOutcome(e)` **恒走该共享 emitter**，不携带也不解析任何 namespaceId。唯一的 namespace 数据键控路径是 `emitStreamOutcome(namespaceId, …)`（经 `runtimeEmitterFor` 现场解析）与 `initStream(namespaceId, bytes)` 建流缝。⇒ 凡 `initStream` 之前发射的 create 结局只有共享通道一条路——这是 seam 的静态结构，非运行时偶发。
2. **Registry 调用点**（`packages/namespace-registry/src/registry.ts`，grep 亲核）：`diag = createCreateDiag(...)` L776；槽内早结局发射点 L1316（input-snapshot `emitEarlyOutcome`）、L1328（schema-compile/validation `emitOutcome`）、L1364/L1379/L1394（create-document-internal fatal）、L1411（DocCreateOperationalError 拒绝）、L1419/L1427（Persistence fatal，保留 committed 事实）——**全部位于 `diag.initStream(id.namespaceId, …)`（L1436）之前**；建流后仅 L1450（#17 committed）/L1463（#18 runtime-construction fatal）走 `emitStreamOutcome` 数据键控。L1933/L1943 的公共入口同步段 `emitEarlyOutcome`（停接纳/identity 拒绝）发生在候选 namespaceId 生成之前，本就无归属可用，不属本缺陷链。归属数据在发射时点已在手上：整个槽内 `id.namespaceId`（受控 CSPRNG 候选 id）自 L1299 起即按 `id.key` 操作，却无数据键控通道可走。
3. **生产供应方确定性丢弃**（`apps/yjs-server/src/diagnostics.ts`，亲核）：`unattributedEmitter = { emit: () => drop(closed ? 'manager-closed' : 'unattributed') }`——恒丢弃 + NDJSON 计数、零路由；`binding.emitter = unattributedEmitter`；文件头注释自述「全部 initStream 之前的 create emission 落此通道，绝不伪造归属」。⇒ 生产 wiring 下 §2.2 全部建流前结局零 namespace 归属、零落盘——与 T1–T6（ns 通道 0 条）及 T11（候选 ns 目录从未建立）红灯形态逐点吻合。
4. **归因面结构**（`packages/namespace-diagnostic-log/src/emission.ts` L33–51，亲核）：`NamespaceDiagnosticChangeEmission` 无任何 namespace 字段——归因唯一载体 = 接收 emitter 实例（#155 数据键控设计）。⇒ 修复面只能在「数据键控消费点扩展」或「Host 侧按候选 ns 缓冲」两族方向（既有报告 §5.3 登记，其前提经本轮核验成立）。
5. **既有绿灯漏网原因**（既有报告 §1.4 定性，verify3 §1.5 已复核）：#150 契约 `registry-create-diagnostic-red.test.ts` 的 Host binding 为缓冲型（pending 缓冲 + initStream 后重放），与生产供应方（恒丢弃）形状不一致——本轮基线 30 绿即该缓冲型契约，绿灯不覆盖生产 wiring 的确定性丢弃。

## 3. 缺陷链 B 独立源码核验（本轮亲自读原文）

1. **B1 create carrier 槽内建流 + 同步 append**：`admitCreateAttempt`（registry.ts L1292–1306）把 `runCreateAttempt` 挂到 `carrier.tail`（同 key lifecycle carrier 串行）；槽内 L1436 `diag.initStream(...)` 与 L1450/L1463 `emitStreamOutcome` 全部落在 carrier 槽内。生产 `initStream` → `ensureAdapter` → `createFileDiagnosticLog` 构造器**全同步 fs**（`adapters/file.ts` 亲核）：`mkdirSync(recursive)` L860、manifest `'wx'` 不可变创建 L879、genesis append、current.json temp+`renameSync` L905–906、reopen 健康证明/可证明尾部修复 `truncateSync` L948、构造期 retention sweep（`sweepOnOpen` 缺省 true，L316–317/L1455–1457）；每 record 独立 `appendFileSync`（L684 BIN frame / L699 JSONL line），无队列、无 batch、无 fsync（文件头 L16 自述）。复现锚 T8（`expected 6 to be less than 3`）、T9（shutdown 等待已接纳 create——ADR-0009 L99/L140 亲核——故被槽内建流同步延长）。
2. **B2 open 槽内 adapter 构造**：registry.ts L1229 open 槽内 factory 第三参 `resolveRuntimeDiag(identity.namespaceId)` → `runtimeEmitterFor` → 缓存 miss 时 `ensureAdapter` 同步构造（diagnostics.ts L84–112 亲核）。复现锚 T10（`expected 2 to be less than 1`）。
3. **B3 Runtime write-sequencer 槽间窗口同步 emit**（`sequencer.ts` L38–42 + `runtime.ts` 亲核）：`enqueue` 内 `const settled = this.tail.then(run, run); this.tail = settled.then(noop, noop);`——**noop hop 在 enqueue 内先注册**；公共方法（runtime.ts L470–475 root-write、L491–494 schema-write、L515–518、L536–539 等）在 `enqueue` 返回后才注册 `settled.then(emitSlot)`。槽 N settle 时微任务队列 = `[noop, emitSlot]`：noop 先跑 → tail resolve → 槽 N+1 的 run 排到队尾（emitSlot 之后）→ **emitSlot 的同步 `appendFileSync` 恰落在「本槽释放 → 下一槽启动」的关键窗口**，且 close barrier 经同一 enqueue 挂接、同样排在上游 emitSlot 之后。复现锚 T12（w1→w2 间隔 104ms，`expected 104 to be less than 50`）、T13（close 结算 101ms，同形）。

## 4. 规范条款逐字核对（本轮直接读 ADR 原文）

| 引用 | 核对 |
|---|---|
| ADR-0011 L57（create 覆盖范围） | ✓ 逐字：「namespace create，包括输入、schema、ROOT、duplicate、Persistence 与 post-commit Runtime construction 结局」——建流前结局属明文覆盖项，缺陷链 A 是实现缺口而非契约空白 |
| ADR-0011 L117–129（隔离面） | ✓ 逐字：emitter seam 同步接收 detached record、不阻塞不 throw；「日志不得引入第二个业务排序机构」；「emitter 不被 await」；「adapter 慢、失败或队列满都不得延长 write slot 或阻塞 close/shutdown；Host shutdown 可 best-effort drain 日志，但 Registry/Persistence 的停止不得无限等待日志 sink」 |
| ADR-0012（诊断日志版）amendment L250 | ✓ 逐字：「『有界』……不表示底层文件系统延迟有时间上界，亦不表示 `emit` 可在任意调用点不阻塞。**任何将 File adapter 的 `emit` 接入 namespace 生命周期的调用点，必须位于 NamespaceRuntime write sequencer slot 之外，或在该 slot 已释放之后；不得在 slot 内执行同步 File adapter `emit`。**不满足该条件的接线为不合规，必须由 #149–#151/#155 或后续接线票修复后方可启用」——本任务即该预留接线票；L345 首切片取舍注记同核 |
| ADR-0009 L99/L101/L140 | ✓ 逐字：shutdown「等待此前已接纳的 lifecycle 操作结算」；「create 的跨候选重试仍受 lifecycle carrier 串行化与 shutdown 已接纳操作屏障约束」——T9 机制锚成立 |

## 5. 红灯契约有效性（本轮独立判断）

1. 主判据为事件迹 `indexOf` 顺序断言（T8/T9/T10/T12/T13），确定性、免定时器抖动；墙钟阈值取注入阻塞（100–200ms）一半以下，余量 ≥2×。
2. 慢存储模拟（`Atomics.wait` 受控同步阻塞）位于 Host 供应方侧，与生产分层一致；被测对象即 amendment 明示的「无上界文件系统延迟」风险面。
3. T7 与 T11 前半 GREEN 对照钉住缺口边界 = 「initStream 之前」，不误伤已工作面；各红用例业务面 GREEN 锚先行守护 ADR-0011 隔离面。
4. seam 字段名（`diagnosticLog.emitter` / `initStream` / `runtimeEmitterFor`；Runtime `diagnosticEmitter`+`clock`）零发明零漂移；`--typecheck` 通过排除类型面噪声。
5. 断言面 = AC 明文行为面（结局以候选 ns 归属到达数据键控通道 / 业务结算标记先行于日志存储完成标记），不锚定实现形态——延迟同步 append 或 queue/batch 载体的合规修复均可翻绿（T9/T13 顺序断言同时要求日志 I/O 排程不先于 shutdown/close 结算续段——微任务级 deferral 不足，须 macrotask/queue 级搬移或异步化）。

## 6. 与既有报告的比对

首轮报告（`20260905-bug-issue-226.md` §1–§8）与 verify3 的全部可核主张，经本轮第五次独立抽查（源码锚点、行号、ADR 逐字引用、红灯形态）**属实且一致**：本轮行号亲核结果 L776/L1229/L1316/L1328/L1364/L1379/L1394/L1411/L1419/L1427/L1436/L1450/L1463 与报告所引（±数行内）内容锚定一致；`emitOutcome` 除报告列举的 L1364/L1394 外另有 L1379 一处（同属 create-document-internal fatal 家族，不影响定性）。未发现夸大、错引或需更正之处。

## 7. 本轮产出与边界

- 本文件：`wiki/raw/20260905-bug-issue-226-verify4.md`（第四轮独立故障分析与复现确认）
- 复现载体（既有，本轮零改动重跑）：`packages/namespace-registry/test/registry-issue-226-red.test.ts`、`packages/namespace-runtime/test/runtime-issue-226-red.test.ts`
- **未实施任何修复**；`src/**` 与既有测试文件零改动。红灯契约继续构成修复验收基线，下游（设计/实现）可凭本确认开工。
- 委派指令所写简报路径 `wiki/raw/task_226.md` 不存在；实际简报为 `wiki/raw/task_issue-226.md`（issue 编号唯一对应，已按其内容执行）。
