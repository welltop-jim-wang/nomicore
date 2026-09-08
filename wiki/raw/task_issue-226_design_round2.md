# 架构设计（第 2 轮，iteration 1）— Issue #226 创建诊断覆盖与日志生命周期隔离

- 任务：Issue #226（bugfix）— `wiki/raw/task_issue-226.md`（Parent PR #142）
- Worktree：`/home/wangjian/nomicore-fix-issue-226`（branch `mabf/issue-226`，HEAD `45a22f060eee924e4ed6a2d6fa64fb7cd6b2db08`）
- 本轮角色：SA1 design iteration 1（对 `task_issue-226_design.md`（iteration 0，2026-09-05 23:09 落盘）的独立复核轮 + 定稿轮）
- 输入产物：`task_issue-226.md`、`task_issue-226_sa5.md`（独立复现）、`task_issue-226_sa6_red.md`（红灯契约审计 R0）、`task_issue-226_conflict_report.md`（SA8 clear R5 维持）、`task_issue-226_relevant_decisions.md`、`20260905-bug-issue-226*.md`（首轮 + verify2–6）、`task_issue-226_design.md`（iteration 0）
- 规范基准：`docs/adr/0011-best-effort-namespace-diagnostic-change-log.md`、`docs/adr/0014-vfsl-validated-jsonl-and-framed-sidecar-change-log.md`（含 2026-08-28 File adapter first slice amendment）、ADR-0008/0009/0010 被引条款、`CONTEXT.md` 词条
- 本轮边界：**仅设计，不实现生产修复**（`src/**` 零改动）；红灯契约文件零改动（§6 修订建议提给 SA6/总控裁决）

---

## 0. 结论摘要（TL;DR）

| 项 | 结论 |
|---|---|
| iteration 0 设计 | **维持确认**。三支柱（per-ns 延迟投递泵 / 早结局数据键控归属 / 生产 wiring 延迟 wrapper + Runtime 零改动）经本轮逐锚点独立复核成立，ADR 合规（§2–§4） |
| ⚠️ 阻断性发现 | **独立确认**：冻结红灯契约 5 个顺序锚用例（T8/T9/T10/T12/T13）在**任意**实现下不可满足（本轮从零重做了微任务/macrotask 级 trace，§5）；T12/T13 与 #149 冻结绿契约（AC4 同步 `emitCalls===2` 锚）互斥。SA6 R0 审计的「修复可翻绿」判断在断言面级成立、在时序窗口级不成立 |
| 修订集分级（本轮细化） | **阻断项 = R1/R2/R4**（T8/T9/T10 到达等待化；T12/T13 Host 形状 wrapper 化；`createDeferredChangeEmitter` 导出）。**R3 降级为推荐项**：`setImmediate` 在 `registry-surface.test.ts` §2.M 三条正则文本之外（本轮逐字符复核），守卫可过、无需豁免即可实现——R3 只是「把隐式缺口写成显式契约」的加固建议，不阻断实现 |
| verdict | **conflict**（契约层冲突；ADR 层无冲突）→ `requiresConflictRecheck: true`。进入 SA3 实现前须 SA6 契约修订（R1/R2/R4）+ SA8 recheck |

---

## 1. 本轮独立复核记录（round 2 的证据增量）

iteration 0 的全部载荷断言本轮从源码/测试文本重新核验，未沿用其结论：

| # | 断言 | 复核方式 | 结果 |
|---|---|---|---|
| V1 | 红灯契约 13 用例结构与判据形态 | 通读两文件全文（registry 622 行 / runtime 165 行） | ✅ T1–T6/T11 到达锚均 poll 型（`waitNsRecords`/`expect.poll`）；T8/T9/T10/T12/T13 顺序锚 = push 业务标记后**同步段内** `indexOf` 断言（T9 L497→504、T13 L154→163 之间仅 `await` 已 settle Promise 的微任务 resumption，无 macrotask 窗口） |
| V2 | #149 冻结绿契约禁止 Runtime 侧发射延迟 | `runtime-root-schema-diagnostic-red.test.ts` AC4（L610–639）：两次 `await mutateData` 后**无 yield** 同步断言 `expect(emitCalls).toBe(2)`（其间的 `readOk`/`getStatus` 均同步） | ✅ 任何把 emit 排到 caller resumption 之后的改动都翻红该锚 |
| V3 | B3 attach-order（emit 落在槽间窗口） | `sequencer.ts` `enqueue`：`this.tail = settled.then(noop, noop)`；`runtime.ts` 8 处 `emitSlot(diagEnv, …)` 注册在裸 `settled` 上（L470–541 同族）；`emitSlot` 同步调 `emitAttempt` → `emitter.emit` | ✅ emit 回调注册先于下一槽 run（下一槽挂在 noop hop 之后的 tail 上），微任务 FIFO ⇒ emit 恰在「本槽释放 → 下一槽启动」窗口 |
| V4 | B1/B2 生产落点 | `registry.ts`：8 处建流前早结局（L1316/1328/1364/1379/1394/1411/1419/1427）+ `initStream`（L1436）+ `emitStreamOutcome`（L1450/1463）均在 `runCreateAttempt` 槽内；open 槽 factory 第三参 `resolveRuntimeDiag(ns)`（L1229）、import 槽同款（≈L1584）槽内现场解析；公共入口 acceptance/identity 拒绝（L1933/1943）在 id 生成前 | ✅ `create-diagnostic.ts`：`createCreateDiag` 构造期捕获共享 emitter，早结局恒走共享通道（生产 `diagnostics.ts:74-76` unattributedEmitter = 恒丢弃+计数） |
| V5 | 虚拟 scheduler 排除注入式延迟 | `testing.ts:77-110`：timer 只存 Map、仅 `advanceBy` 触发；#226/#150 契约测试均不 advance | ✅ 注入式 `scheduler.setTimeout(fn, 0)` 在两套契约下永不触发 |
| V6 | 静态守卫正则不含 `setImmediate` | `registry-surface.test.ts` §2.M（L274–285）三条正则逐字符：`HOST_GLOBAL_TIMER_BARE`/`GLOBALTHIS` = `setTimeout|setInterval|clearTimeout|clearInterval`，`DATE_NOW` = `Date.now(`；扫描范围 = registry `src/*.ts` 全部（含 testing.ts，零豁免） | ✅ `setImmediate(` 文本不命中任何一条 ⇒ **无需豁免即可过守卫**；persistence/clock 包同型守卫不覆盖 registry/diagnostic-log 包；namespace-diagnostic-log 无 timer 守卫 |
| V7 | #150 绿契约对 macrotask 延后安全 | `registry-create-diagnostic-red.test.ts`（18 用例）：到达断言全部 poll 型（`waitAttempts` L308、`expect.poll` 3s @ L419/466/785 等）；两处 `flushMicrotasks`（L544/L753）锚定的是**业务槽推进**（createDoc 进入 gate）与「恰一条记录」计数，均与诊断到达时点正交 | ✅ 早结局/initStream 从槽内同步 → macrotask（<1ms 量级）后移，在 3s poll 余量内 |
| V8 | ADR-0011/0012 时序条款 | ADR-0011「时序与 sequencer」节（业务排序独占、emitter 不被 await、adapter 慢/满不得延长 write slot 或阻塞 close/shutdown）；ADR-0014 amendment：「emit 接入 namespace 生命周期的调用点必须位于 write sequencer slot 之外或 slot 已释放之后」+ queue/batch 为演进形态须另定义四类语义 | ✅ 设计选项 (a)（保持同步 append、只移调用点）为 amendment 显式授权路径 |

复核中修正 iteration 0 的两处小误差（不影响结论）：①§5.1 早结局发射点实为 **8 处**（iteration 0 列 7 处，漏 L1379）；②R3 从阻断降级为推荐（见 §6）。

---

## 2. 设计定稿（确认 iteration 0 三支柱，具体化接口）

```
┌─ Registry lifecycle carrier 槽（create/open/import，O(1)）──────────────┐
│ 业务步骤零改动（ADR-0009 L62 清单原样）；日志工作 = 组装语义载荷 +       │
│ observedAt（槽内单次 clock 读，DC-3）+ pump.enqueue（O(1) 内存操作）     │
└──────────────┬─────────────────────────────────────────────────────────┘
               ▼
┌─ per-namespace 延迟投递泵 diag-pump（registry 包内部模块）──────────────┐
│ 单飞 drain：ambient setImmediate 级 macrotask；per-ns FIFO；有界        │
│ drop-newest；drain 全程非抛；Registry shutdown 不等待/不清空            │
└──────────────┬──────────────────────────────────────────────────────────┘
               ▼ drain 内（业务槽外/sequencer 窗口外）同步调用冻结 seam
   Host binding（零改动）：initStream(ns, bytes) / runtimeEmitterFor(ns)
   → ensureAdapter（同步 fs：建流/reopen/修复/retention sweep）→ ns emit
```

### D1 泵（`packages/namespace-registry/src/diag-pump.ts` 新增，零公共导出）

```ts
type DiagPumpTask =
  | { kind: 'resolve'; namespaceId: string }                    // open/import 槽末 warm：解析一次、丢弃结果
  | { kind: 'init-stream'; namespaceId: string; genesisUpdateBytes: Uint8Array | undefined }
  | { kind: 'emit'; namespaceId: string; observedAt: string; args: CreateEmissionArgs }        // 数据键控投递
  | { kind: 'emit-shared'; observedAt: string; args: CreateEmissionArgs };                     // legacy 回退（无 runtimeEmitterFor 的 Host）
```

语义条款（与 iteration 0 §3.2 一致，本轮确认）：

1. **per-ns FIFO**：同 ns 任务严格按入队序 drain；跨 ns 独立单飞。泵只给**日志投递**排序——ADR-0011「日志不得引入第二个业务排序机构」保持（业务排序仍由 carrier/sequencer 独占；投递序按构造与业务序一致）。
2. **单飞 drain**：enqueue 时无在飞 drain 则调度一个 ambient `setImmediate`；drain 至空清位；天然合并。
3. **有界 drop-newest**：每 ns 待投递硬上限（内部常量 `DIAG_PUMP_MAX_PENDING = 1024`，本切片不做配置面）；溢出静默丢弃（observer 词表冻结——不发明新事件类型）。
4. **非抛边界**：drain 整体 try/catch；单任务失败由既有 `resolveEmitterOnce`/`emitAttempt` 吞没边界收编、不重试（「emit 尝试恰一次」保持）；调度本身 throw（病态宿主）→ 该 ns 队列整体静默终止。
5. **shutdown 无关**：Registry shutdown 不等待/不取消/不清空泵（ADR-0011 L129）；残留任务照常 drain，投递目标由 Host 决定（生产：manager closed → 丢弃桩 + `manager-closed` 计数，现有语义）。
6. **内存回收**：drain 至空删该 ns 队列条目；泵按 namespaceId **数据**键控，无共享可变绑定（#155 C1 纪律保持）。
7. **非 queue/batch 切片**：drain 内每任务仍是对冻结 seam 的单条同步调用（`initStream` 恰一次、每 record 恰一次 `emit`）；不触发 ADR-0014 L252 的 close/flush/队列满/fsync 四类额外语义义务（泵自身的有界/丢弃/寿命已在条款 3–5 显式定义）。

### D2 早结局数据键控归属（AC1）

- `CreateDiag` 内部接口（registry 包内部，非公共 seam）：`emitOutcome/emitEarlyOutcome/emitStreamOutcome` 补 `namespaceId` 参数；`initStream` 补 ns——语义全部改为「槽内 O(1) 组装 + 入队」。**公共 seam（`NamespaceRegistryDiagnosticLog` 三成员名与 sync-only 契约）零改动**。
- 调用点：`registry.ts` 8 处早结局（L1316–L1427）+ initStream（L1436）+ #17/#18（L1450/1463）补传 `id.namespaceId`；公共入口 L1933/L1943 维持同步共享通道（id 生成前，无归属可用——见 §4.3）。
- 路由三态：①seam 有 `runtimeEmitterFor` → 入队 `emit` 任务，drain 中现场解析（miss 且该 ns 无先行 init-stream → 静默丢弃）；②seam 无 `runtimeEmitterFor`（#150 缓冲型 Host）→ 入队 `emit-shared`（drain 中 `emitAttempt(sharedEmitter, …)`，行为与现行逐字节等价、仅时点 macrotask 化）；③解析违约（throw/畸形/undefined）→ 静默。
- **槽内捕获纪律（AC2）**：observedAt 槽内单次定值（`emitEarlyOutcome` 读一次 clock；`emitOutcome` 复用槽内 Clock 步 createdAt），延迟投递只透传——不产生第二次 clock 读数；载荷只携带既有 detached 事实（`snapshotCreatePayload` 快照引用或 `{status:'unsafe-input'}`、已物化 issues 数组）；issues 投影仍在 `emitAttempt` 吞没边界内（drain 时点）。
- **归属诚实性**：早结局 = 普通 `attempt` record，携自身 observedAt，绝不冒充 genesis；被拒 create 由 Host `ensureAdapter(候选ns)` 建流（manifest/current.json/attempt 落盘、**无 genesis-baseline**）；replay 诚实报 partial。成功 create：泵 FIFO 保证 `[init-stream(genesis)] → [#17]` → `#18` 同序。词表零新增。

### D3/D4 落点

- **create（B1）**：`encodeDetachedState` 留槽内（业务事实捕获，与现行同）；initStream/#17/#18/早结局 → 入队。create 槽内 Persistence 成功与 factory 构造之间零 fs 路径。
- **open/import（B2）**：`createRuntimeDiagResolver` 返回**惰性 wrapper** `(ns) => ({ emitter: pumpBackedEmitter(ns), clock: () => clock.now() })`——构造 O(1)、不调用 `runtimeEmitterFor`（L1229/≈L1584/create ≈L1440 落点全部消除）；`pumpBackedEmitter(ns).emit(record)` = 入队 `emit` 任务（O(1)、非抛——Runtime 侧 emitAttempt 已组装 record 含 observedAt，wrapper 只透传引用）。槽末追加 `resolve` warm 任务：drain 中触发 Host `ensureAdapter`（reopen 健康证明/尾部修复/retention sweep），结果丢弃——保持「open 后 adapter 存在」的生产行为等价，并满足修订后 T10 的 `ensure:<ns>:end` 到达锚。
- **D5 Runtime 零改动（关键裁决，本轮复核强制成立）**：V2 的 #149 冻结锚使任何 Runtime 侧发射时机搬移（哪怕一个微任务 hop）翻红 `emitCalls===2`；B3 由生产 wiring 侧 wrapper 消解（Runtime 收到的 emitter 即 D4 wrapper，`emitSlot` 窗口内只做 O(1) 入队）；File adapter `emit` 调用点移至泵 drain（amendment「slot 之外」合规）。
- **D6 Host 零强制改动**：`apps/yjs-server/src/diagnostics.ts` binding 三成员实现不变；`HostDiagnosticsManager.close()` 维持 O(1)；仅头注释更新（构造期同步 fs 落点描述改为「Registry 延迟投递泵 drain 内——业务槽外」）。
- **D7 延迟原语 = ambient `setImmediate`**：非 timer（无延迟/墙钟语义），语义「当前微任务排空之后的下一轮事件循环」——T9/T13 类「日志标记不得先于 shutdown/close 结算续段」的最弱充分原语。注入式 scheduler 延迟被 V5 排除；微任务级被方向性排除（先于 caller resumption 落地，顺序锚反向）。**守卫复核结论（本轮细化）**：`setImmediate` 在 §2.M 三条正则文本之外（V6），实现无需豁免即可过守卫——R3 降级为推荐项。
- **D8 `createDeferredChangeEmitter(inner, defer?)`**（`packages/namespace-diagnostic-log` 新导出）：把任意 emitter 包成 O(1) 入队 + 单飞 macrotask drain 的延迟 emitter（FIFO/有界/drop-newest/非抛语义与 D1 同构，实现下沉共享避免双实现漂移）。用途：修订后 T12/T13 的 Host 形状（生产同款 wrapper）+ Host 组合根复用。`defer?` 参数化为非 Node 目标预留。公共面 +1 export，须 SA4/SA6 评审确认（R4）。

---

## 3. AC 逐条满足路径

| AC | 机制 | 契约锚 |
|---|---|---|
| AC1 早结局归属 | D2：候选 ns 入泵 → `runtimeEmitterFor(候选ns)` 数据键控投递；被拒 create 由 Host 建流（无 genesis，诚实 partial）；归属锚 = 候选 id 自 CSPRNG 生成起在手 | T1–T6（poll 型，**直接可翻绿**）、T11（候选 ns 目录落盘，poll 型） |
| AC2 输入零访问/detached 快照 | 公共入口 L1933/L1943 维持同步共享通道（caller 栈、非关键路径）；槽内只捕获既有快照/物化 issues；observedAt 槽内单次定值 | T1/T3 + #150 既有 AC2/AC3 绿契约（Proxy 零额外读取、快照后变异不影响记录）不回归 |
| AC3 存储触碰出关键路径 | D3/D4：carrier 槽内 = O(1) 入队；建流/adapter 构造/append 全入泵 drain；Runtime 窗口内（生产）= wrapper O(1) 入队 | T8/T9/T10/T12/T13——**须先完成 §6 修订**（R1/R2/R4）；修订后：业务标记先行 + 日志标记 poll 到达在后 |
| AC4 慢/挂起存储隔离 + shutdown 有界 | create/open 槽零 fs；shutdown 不等待泵（公共契约逐句不变：同 Promise、`NamespaceRegistryShutdownError` 聚合、停止接纳）；全程非抛；初始化失败 → Host 侧健康面（`LOG_STREAM_INIT_FAILED`/丢弃桩），Registry 不代发 | T8/T9（墙钟锚：业务结算不等待日志的直接度量，与延迟正交，天然满足）+ #150/#149 既有 AC4 隔离绿契约不回归 |
| AC5 契约覆盖 + 修复前失败 | 既有红灯契约即验收基线（12F\|1P，八轮稳定 + SA6 R0 复跑）；修订集 §6 + 回归面 §7 | 修订后 13/13 绿；未修订即实现：T1–T7/T11 中 8 绿 + 5 个顺序锚以「标记缺席」（`indexOf === -1`）形态维持红——红灯形态可区分（vs 次序颠倒），SA4 可据此识别非机制性失败 |

## 4. 边界裁决（维持 iteration 0 §8 五条，本轮复核依据）

1. **duplicate 候选重试零发射**：维持 #150 冻结裁决「公共 create 恰一条最终结局」；AC1 字面的 duplicate 由两层满足（重试后 committed 记录 + 重试耗尽 id 生成 fatal）。#150 AC1 DOC_DUPLICATE 用例断言「恰 1 条 attempt」——泵下唯一入队任务即最终结局，维持。
2. **id 预算耗尽 fatal 维持零诊断发射**：全部候选与他人 ns 碰撞，任何归属都是伪造归属；为它发明 stage/归因 = 词表演进。健康信号由 observer 事件承担。
3. **公共入口 acceptance/identity 拒绝维持同步共享通道**：发生在 namespaceId 生成前（V4：L1933/L1943 在公共 create 入口、id 生成之前），无归属可用；落在无归属通道是诚实行为，非本缺陷链对象。
4. **legacy 回退时序**：`emit-shared` 任务入队于 init-stream 任务之后（#17/#18 在 initStream 之后入队），FIFO 保证共享通道先收到 → Host 缓冲重放语义与现行等价。
5. **词表/manifest/genesis 诚实性**：零新增 operation/stage/result/reason 值；被拒 create 流无 genesis；重试成功新 stream 的 genesis 不回溯。

---

## 5. ⚠️ 阻断性发现（独立确认）：5 个顺序锚对实现空间封闭

**共同结构**：测试在业务结算后同步 push 业务标记，随后在**无 macrotask 窗口的同步段**内 `indexOf` 断言「业务标记 < 日志标记」。日志标记只能由日志执行落点产生，其可能时点穷尽于三类：

| 时点类 | 结局 |
|---|---|
| A. 槽内同步（现状） | 日志标记先于业务标记（顺序锚反向；墙钟锚同败）——当前红灯形态 |
| B. 微任务级（queueMicrotask/Promise hop/nextTick） | 日志在 caller resumption **之前**执行 ⇒ 标记仍先于业务标记（顺序反向），且阻塞计入同段墙钟 |
| C. macrotask 级（setImmediate/真实 timer） | 日志在断言同步段**之后**执行 ⇒ `indexOf === -1`，`k < -1` 恒假（标记缺席） |

逐用例（本轮独立 trace，窗口 = 业务标记 push 与断言间的 yield 点）：

| 用例 | push→断言窗口 | B 类结局 | C 类结局 |
|---|---|---|---|
| T8（L462→471/474） | 无 yield | initStream/emit 先于 create:settled 且计入 createMs | initStream:end = −1 |
| T9（L497→504/505；L500 `await` 已 settle 的 createPromise = 微任务） | 仅微任务 | drain 微任务入队于 shutdown 结算前 → 先于 testCont 执行 → 先于 shutdown:settled | initStream:end = −1 |
| T10（L523→531/532） | 无 yield | ensure 先于 open:settled 且计入 openMs | ensure:end = −1 |
| T12（L118→126/131） | 无 yield | emit1 只可能落 w1 结算前（顺序✗）或 notify:2 后 w2 结算前（gap≈100ms✗）——两锚互补，恰满足其一 | emit1:start = −1 |
| T13（L154→159/163；L157 `await` 已 resolve 的断言链 = 微任务） | 仅微任务 | emit1 先于 close 结算（closeMs✗） | emit1:end = −1 |

**T12/T13 与 #149 互斥（V2）**：两测试把裸慢 emitter **直连** Runtime seam；#149 AC4 冻结「emit 在 caller resumption 前同步完成」（`emitCalls===2` 无 yield 断言）。满足 T12/T13 顺序锚需要 emit 为 macrotask（C 类）⇒ #149 翻红；满足 #149 需要 emit 同步/微任务 ⇒ T12/T13 锚败。Runtime 层不可同时满足——D5（Runtime 零改动 + 生产 wrapper + 修订 T12/T13 Host 形状）是唯一同时保住 #149 绿契约与 AC3 生产语义的解。

**结论**：5 个顺序锚用例的「绿条件」需要日志标记落在 push 与断言之间的同步段内——该段无任何事件循环产线点，结构性不存在。这是契约文本的时序窗口缺陷，不是实现选择问题；对照同文件 T1–T7/T11 的 poll 型等待形态（正确先例已在套件内）。**SA6 R0 的「修复可翻绿、契约无需修正」审计结论在断言面级成立、在本节时序窗口级不成立——须重新固话。**

---

## 6. 最小修订集（提请 SA6 重新固话 + SA8 recheck；均为测试/守卫层，零 ADR 修订）

| # | 文件 | 修订 | 级别（本轮分级） |
|---|---|---|---|
| R1 | `registry-issue-226-red.test.ts` T8/T9/T10 | 业务标记 push 后、顺序断言前，对日志标记改 `expect.poll(events.includes(...), {interval:5, timeout:1000})` 到达等待（同文件 `waitNsRecords` 先例）；墙钟锚维持 | **阻断** |
| R2 | `runtime-issue-226-red.test.ts` T12/T13 | `diagnosticEmitter: createDeferredChangeEmitter(makeSlowSyncEmitter(...))`（生产同款 wrapper 形状）；断言改 poll 到达后校验顺序 + 墙钟。保 #149（D5）；测试形状对齐修复后生产 wiring（裸慢 emitter 直连 Runtime 在修复后生产中结构性不存在） | **阻断** |
| R4 | `namespace-diagnostic-log` 公共面 | +`createDeferredChangeEmitter` 导出（R2 依赖；公共面增长须评审留痕） | **阻断**（R2 依赖） |
| R3 | `registry-surface.test.ts` §2.M | 显式登记 `diag-pump.ts` 单点 `setImmediate(` 条目（注记：非 timer、仅诊断投递、零墙钟语义） | **推荐**（本轮降级：V6 复核 `setImmediate` 在三条正则文本之外，守卫可过、不登记不阻断；登记仅把隐式缺口变成显式契约，可在 SA6 触及该文件时顺带） |

修订后验收矩阵：修复 + R1/R2/R4 ⇒ 13/13 绿；#149（14）/ #150（18）/ surface 守卫全绿保持。**未修订即实现**：T1–T7/T11 → 8 绿（T7 维持绿：FIFO 使 init-stream 先于 committed record drain，poll 到达时 events 已含 `initStream:start`）；T8/T9/T10/T12/T13 以「标记缺席」形态维持红（可识别）。

---

## 7. 回归面（不得翻红）

`registry-create-diagnostic-red.test.ts`（18）、`runtime-root-schema-diagnostic-red.test.ts`（14）、`registry-surface.test.ts`（§2.M 经 V6 文本复核可过）、registry/runtime 全量套件、`pnpm typecheck`。重点盯防：
- **#150 到达时点后移**：早结局/initStream 从槽内同步 → macrotask（<1ms 量级 vs 3s poll 余量）——V7 复核两处 `flushMicrotasks` 均锚业务推进与计数，与到达时点正交，预测零回归；SA3 实现轮全量实证。
- **#149 全套**：Runtime 零改动 ⇒ 结构性安全（V2/V3）。
- **测试收尾残任务**：泵残留 drain 在用例断言全部完成后才触发（macrotask 晚于测试同步尾）——Host 侧记账无害，无 post-assert 同步检查面。

## 8. SA3 实施切片（本设计不实现）

| 文件 | 改动 |
|---|---|
| `packages/namespace-registry/src/diag-pump.ts` | **新增**（D1 全条款） |
| `packages/namespace-registry/src/create-diagnostic.ts` | `CreateDiag` 四方法 +ns 与入队语义；resolver 惰性 wrapper；legacy `emit-shared` 回退；构造期接收泵 |
| `packages/namespace-registry/src/registry.ts` | 10 个槽内调用点（L1316–L1463）补 ns 入队；open/import 槽末 warm 入队；装配处传泵；业务步骤零改动；L1933/L1943 不动 |
| `packages/namespace-diagnostic-log/src/*` + `index.ts` | `createDeferredChangeEmitter` 与导出（R4） |
| `apps/yjs-server/src/diagnostics.ts` | 仅头注释 |
| `packages/namespace-runtime/**` | **零改动** |
| 测试/守卫 | R1/R2/R4（SA6 重新固话后）；R3 顺带 |

切片顺序：(1) 泵 + D3 → T8/T9 红灯形态变化验证；(2) D2 → T1–T6/T11 翻绿；(3) D4 → T10；(4) D8+R2 → T12/T13；(5) 全量回归（§7）。

## 9. 风险与开放问题

1. **契约修订前置**（§5/§6）：未经 SA6 修订 + SA8 recheck 即实现，5 个顺序锚用例无法全绿——流程门禁，非技术风险。R4 是公共面增长，须显式评审留痕。
2. **setImmediate 依赖**：Node ≥15（仓库 Node ≥20 达标）；非 Node 目标经 D8 `defer?` 参数化预留。
3. **drain 线程级阻塞**：慢 fs 在 drain 中仍阻塞整线程（单线程固有）；本设计消除的是业务排序关键路径内的阻塞（AC3/AC4 规范所指）——与现状相比严格改善（现状同类阻塞在槽内）。
4. **per-ns 公平性**：某 ns drain 长阻塞推迟其他 ns drain；跨 ns 无顺序契约，best-effort 语义内可接受（登记，不处理）。
5. **开放问题（SA6 裁决）**：R2 wrapper 化后是否保留一条「Host 误接线」守护测试（文档性断言：裸慢 emitter 直连 Runtime 会阻塞——wiring 纪律反面教材）。

## 10. 结论

- 生产架构设计完整且 ADR 合规（§2–§4）：AC1 数据键控延迟投递归属；AC2 纪律零漂移；AC3「一切存储触碰入泵、槽内 O(1)」；AC4「泵非阻塞 + shutdown 无关 + 全程非抛」；Runtime 零改动、Host 注释级。
- **阻断性发现经本轮独立复核确认**（§5，含从零重做的微任务/macrotask trace 与 #149 互斥证明）：冻结红灯契约 5 个顺序锚用例对实现空间封闭——须先落地阻断修订集 R1/R2/R4（R3 为推荐加固），经 SA6 重新固话 + SA8 recheck 后方可进入 SA3 实现。
- 本轮零产品代码、零测试改动；唯一产物为本文件。

Verdict: **conflict**（契约层冲突，ADR 层无冲突）— `requiresConflictRecheck: true`
