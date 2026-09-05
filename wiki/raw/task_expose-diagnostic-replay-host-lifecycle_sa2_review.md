# SA2 攻击评审报告

**Date**: 2026-09-02
**Verdict**: **R0 reject → R1 pass**(R0 判决 C1/M1/M2/M3 + m1/m2/m3 + i1/i2/i3;SA1 R1 修订逐条落实并经本 SA2 源码级复审确认——R1 复审章节见文末,R0 攻击点全文保留于下供审计溯源)

- 被审对象:`wiki/raw/task_expose-diagnostic-replay-host-lifecycle_design.md`(SA1 R0,633 行)
- 约束基准:`…_relevant_decisions.md`(红线清单 10 条 + SA8 设计后复审追加 D1–D12)+ `…_design_conflict_report.md`(verdict clear,6 项边界审视)
- 审查方法:全新视角通读设计 → 对设计的每个关键安全/正确性声明**独立源码验证**(引用行号均为本 worktree 实测)→ 竞态/边界/错误链路推演。已验证的关键源码锚:`registry.ts:1410-1440`(create 槽同步续段)、`registry.ts:1276-1288`(admitCreateAttempt per-key carrier 并行)、`create-diagnostic.ts`(createCreateDiag 吞没边界/一次性 emitter 读取)、`persistence/src/file.ts:91-93,147-162`(createDoc 全异步 fsp IO)、`adapters/file.ts:79-115`(配置形状)、`retention.ts:63-86`(sweepOnOpen 默认 true)、`adapters/file.ts:1455-1457`(构造完成自动 sweep)、`reader.ts:25-75,390`(strict reader 绝不抛 + 形状)、`plugin.ts:174`(单参工厂)、`app.ts:385-424`(performStop 顺序)、`internal.ts:40-45`(两参工厂)。
- 验证结论先行:设计的绝大多数 ADR 合规论证(write-slot 纪律、数据面隔离、单 writer、O(1) drain、三态语义表、词表、caller 审计)**经源码复核成立**,SA8 的 no-conflict 裁决未被推翻。但 D4 的核心安全声明(「永不误归因」)存在被源码事实击穿的竞态,另有三处完备性缺口。

---

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议 |
|---|--------|--------|---------|------|
| C1 | **CRITICAL** | D4 dispatcher 同步窗绑定(§5.2/§6.4) | 「永不误归因」论证不成立:微任务 FIFO 只按**入队序**执行,A 的关窗微任务入队于 A 续段**内**(即队尾),并发 create B 的失败 emit 微任务若已入队(入队更早),将在 A 关窗**之前**执行——此时 `bound` 仍为 A 的 adapter,B 的失败 emission 经 `bound.emitter.emit` **写入 A 的诊断流**(跨 namespace 误归因)。详见下文推演。 | 消灭全局 `bound` 时序状态:Registry 侧在 `initStream(ns)` 后直接局部持有 ns-bound emitter(#17/#18 不再走共享 dispatcher);initStream 之前的失败 emission 走恒丢弃+计数的 unattributed 通道。修订后重给「永不误归因」论证,同步更新 D4/§6.4/P4。 |
| M1 | **MAJOR** | §5.6 replay 工具错误收敛 | 接口承诺「纯同步、绝不抛」,但算法 ① 仅收敛 ENOENT 与 JSON/形状/文法违规;`readFileSync` 的 `EACCES`/`EISDIR`/`EPERM`/`EMFILE`/`EROFS` 等直接 throw。`readStreamStrict` 自身「绝不抛」(reader.ts:5),工具却在它之前就抛。 | ① 增加顶层 catch-all:非 ENOENT 的 fs 错误 → `failed{locator-invalid}`(或新增 `locator-unreadable` 码并入 D12 词表);设计明示收敛映射表。 |
| M2 | **MAJOR** | D12 `genesis-misplaced` 触发条件 / §5.6 ④ 连续性复核 | SA8 边界审视 6 点名的盲区 R0 未吸收:流形 `[update(乱序 seq…), genesis(seqK), …]` 中前置 attempt 因 `genesisSeen=false` 被跳过,`lastSeq`/`expectedNext` 均不推进;genesis 到达时触发条件「genesisSeen ∨ applied>0」皆 false → 被当合法基线;且 attempt 分支连续性复核以 `expectedNext ≠ null` 为前置——**被跳过前缀的 sequence 连续性从未被校验**。乱序/损坏前缀 + mid-genesis 的篡改流可报 `complete`,五条件之 2 的检测义务失守。CRDT 幂等只保证「genesis 为真全量基线」时的终态正确,不能替代检测义务。 | 采纳 SA8 建议:`genesis-misplaced` 触发条件并入「存在前置 attempt 记录」(哪怕全部被跳过);或对跳过前缀维护 firstSeenSeq 追踪,genesis 到达时校验衔接。更新 D12 表与 §5.6 伪代码,并防过度矫正(健康流仍 complete)。 |
| M3 | **MAJOR** | §5.2 ensureAdapter / §6.1 #2 / D3 成本注记 | 构造期默认 retention sweep 未备案:manager 的 `DiagnosticsRetentionConfig` 只含 maxAgeMs/maxBytesPerNamespace,透传后 adapter 收到 `sweepOnOpen: undefined` ⇒ `normalizeRetentionConfig` 默认 **true**(retention.ts:73/84)⇒ 构造完成自动 sweep(file.ts:1455-1457,ready 模式)。后果:(a) §6.1 同步 fs 动作清单 #2 漏列「构造期 sweep(目录枚举 + 每闭组 stat + 可能批量删除)」,清单自声称完备而实际不完备——误导 SA4/SA7 范围审查;(b) D3 只备案 `analyzeStreamForResume` O(stream),实际每 ns 每进程构造还有第二遍 sweep IO + **删除副作用发生在 open/import 槽内**;(c) 操作员无法关闭构造期 sweep(§8.2 备案「不暴露 sweepOnOpen」但未说明其后果是恒 true)。 | 显式裁决 manager 的 sweepOnOpen 策略:推荐恒传 `sweepOnOpen: false`(构造期零删除,retention 语义留显式 sweep/未来票),或备案默认 true 并把 sweep 列入 §6.1 #2 与 D3 成本注记。二择一写进设计。 |
| m1 | MINOR | D4/D8/§5.2/§6.4 丢弃词表 | 词表三值 `unattributed\|manager-closed\|stream-unavailable`,但 D4 dispatcher 伪代码仅两分支(`closed`/`bound===undefined`→`unattributed`);§5.2 文字「initStream 构造失败 → bound=undefined → #17/#18 以 stream-unavailable 丢弃」——按伪代码实际产出 `unattributed`。两处自相矛盾,SA3 无从裁决,操作员无法区分「无归属」与「构造失败」。 | dispatcher 增加 FAILED 哨符态(initStream 构造失败时置位)或修正 §5.2 文字;同步 §6.4 表格。若 C1 修订采用「Registry 局部持有 emitter」方案,本条随之消失。 |
| m2 | MINOR | §5.6 ④ 迭代控制 | 各分支写 `stopped = true; continue`,循环尾又注「stopped 后停止迭代」——SA3 可能实现为 continue 全量迭代或 break,record 级 issue 透传范围随实现漂移(R6 后置损坏行的 issues 是否透传无定义)。 | 明确 break 语义与 record 级 issue 透传截止点(stopped 处截断)。 |
| m3 | MINOR | §5.6 ① locator 读取 | `join(rootDir, 'namespaces', namespaceId, 'current.json')` 在 `readStreamStrict` 的安全文法门(其内部 `isSafeNamespaceId`,reader.ts:31 注释)**之前**执行;`namespaceId: '../../…'` 可使 readFileSync 逃逸 rootDir(只读,风险低,但破坏「工具只读日志目录」的封闭性,且与 reader 侧安全门不一致)。 | ① 前置包内 `isSafeNamespaceId`(未导出则随 D10 增量导出),非法即 `failed{locator-missing}`。 |
| i1 | INFO | D11 resolver 违约静默 | Registry 侧 `runtimeEmitterFor` 违约丢弃无事件通道——#150 no-op 先例对齐 + 唯一生产供应方构造性良构(ensureAdapter 自带 catch),可接受;建议可选加一跳 NDJSON 计数。 | 备案,不阻塞。 |
| i2 | INFO | §5.3 performStop 异常路径 | `registry.shutdown()` throw 时 `diagnostics.close()` 被跳过(同一 try 块);adapter 无常驻 fd/队列,实害为零。 | 可移入 finally,或备案。 |
| i3 | INFO | D9 表 R7 行的机制说明 | R7 预测(applied=0 → failed + genesis-missing)成立的原因是 SA6 夹具**不传 genesisUpdateBytes**(red test :703),而非「capture=false 抑制 genesis」——file.ts:88 明文 updateCapture 与 genesis **正交**。生产路径(capture=false、create 槽供 genesis)的流**有** genesis,首条 update-omitted 即 partial。预测本身正确,但建议设计补一句归因说明,防 SA3 把「capture=false ⇒ 无 genesis」当机制实现。 | 备案,随修订补充说明。 |

---

## C1 竞态完整推演(源码逐点锚定)

**前提事实(全部实测验证)**:

1. `admitCreateAttempt`(registry.ts:1276-1288)per-key carrier FIFO——**不同 namespace 的 create 并行**;
2. `persistence.createDoc` 为真实异步(file.ts:91-93 → core 的 `fsp.mkdir`/`fsp.writeFile`/`fsp.rename`,file.ts:147-162)——线程池回调(宏任务)settle promise,await 恢复微任务随之入队;
3. B 的 createDoc 失败 emit(`NAMESPACE_CREATE_FAILED` rejected / `NAMESPACE_REGISTRY_FATAL`,registry.ts:1395-1410 一带 catch 分支)位于 `diag.initStream`(registry.ts:1418)**之前**;
4. `createCreateDiag`(create-diagnostic.ts)构造期一次性读取 `diagnosticLog.emitter`,create 槽**全部** emit 走该共享 emitter——即本票 Host 注入的 dispatcher;
5. D4 关窗 `queueMicrotask(() => { if (bound === log) bound = undefined })` 在 `initStream` 内入队——**入队到当前微任务队列尾部**。

**交错时序**(caller 并发 `Promise.all([create(A), create(B)])`):

```
宏任务批次(线程池回调相邻到达):
  回调A:createDoc(A) settle 成功 → [A续段] 入队
  回调B:createDoc(B) settle 拒绝 → [B续段] 入队
微任务队列: [A续段, B续段]

A续段执行(initStream→factory→#17):
  queueMicrotask(A关窗) → 入队尾 → 队列变 [B续段, A关窗]
A续段结束

B续段执行(createDoc catch):          ← bound 仍 = A-log(A 关窗还没轮到!)
  emitOutcome(#NAMESPACE_CREATE_FAILED) → dispatcher.emit
  → bound.emitter.emit(emission)     ← B 的失败记录写入 A 的诊断流!!

A关窗执行:bound = undefined          ← 为时已晚
```

D4 论证 2 原文「微任务关窗在同步续段结束后 FIFO 执行 → 后续任何 create 的前置失败 emit……看到的 bound === undefined」——**FIFO 保证入队顺序执行,不保证 A 的关窗先于 B 已入队的失败 emit**。论证把「时间上后续」偷换为「队列序后续」,不成立。

**影响分级**:
- (a) B rejected 记录混入 A 流:adapter 对 A 流单调分配 sequence → **不产生 gap** → A 的 replay 照常 complete,**幽灵记录完全不可检测**——诊断流的归属完整性被静默破坏(比静默失败更糟:伪装成正常);
- (b) B 以 fatal(committed:true, effect:'update')失败:registry.ts catch 分支 `fatalFromBytes(true, state)` 携带 **B 的 doc bytes** 写入 A 流 → A 的 replay 应用外 namespace update → `identity-mismatch` → A 的 replay 沦为 partial——**A 的诊断面被 B 的故障实质性损坏**。

触发概率不高(需并发 create + createDoc 异步失败 + settle 批次相邻交错),但多 ns 并发 provision / 高负载 hub 下真实可现;且这是设计**自我声明**的安全红线(「误归因 = 数据完整性缺陷」「永不误归因(fail-safe 方向正确)」),声明被击穿即设计失格,与概率无关。

**修订方向(可执行)**:

- 首选:消灭全局 `bound`。Registry 在 `initStream(ns)` 之后把 **ns-bound emitter 解析到本次 create 尝试的局部状态**(本票已新增 `runtimeEmitterFor(ns)`——createDiag 可在 initStream 成功后立即调用并缓存,`#17/#18` 用局部 emitter;失败即回落到恒丢弃+`unattributed` 计数通道)。归属不再依赖任何跨微任务时序状态,竞态类别整体消失。需同步微调 #150 seam 语义说明(create-diagnostic.ts 增量,在 ALLOW LIST 内)。
- 不建议的替代:关窗改「同步栈检测/更多微任务位」——仍在时序域打补丁,推演负担只增不减。
- 修订后必须:(1) 重写 D4 正确性论证(应为「归属由 Registry 已知 namespaceId + 局部 emitter 引用决定,无共享可变窗」);(2) §6.4 失败矩阵补「createDoc 失败 emission 丢弃+计数」行;(3) P4 风险行更新(fail-safe 化声明随旧机制作废);(4) 对「成功 create 的 #17 记录被丢弃」给出与「无归属前置失败丢弃」可区分的观测信号(见错误处理链路审查)。

**红灯测试构想**:

1. **单元级(直接钉竞态)**:构造 manager,`initStream('ns-a')` 后**不** flush 微任务;手动 `queueMicrotask(() => dispatcher.emit(B 的 emission))` 模拟「入队晚于 A 续段、先于关窗」的迟到 emit → 断言:B 的 emission **未**出现在 ns-a 的 stream(丢弃 + `unattributed`/等价计数事件)。(当前设计下该测试红——正中竞态。)
2. **集成级**:并发 `Promise.all([create(A, valid), create(B, valid)])`,B 的 persistence 注入 `DocCreateOperationalError`(经测试 seam;控制 settle 顺序 A 先 B 后,如让 B 的 writeFile 延迟一拍)→ 断言:A 的 stream `readStreamStrict` 记录中无 B 的 attemptId;A 的 `replayNamespaceDiagnosticLog` = complete 且 `issues === []`。

---

## 协议假设依据审查

- **章节存在性**:§11 存在,7 条假设(P1–P7)✓。
- **依据可验证性**:全部为源码引用(带行号)、现有测试引用或官方文档;P6「设计期实测验证」引用 SA6 夹具健全性探针记录(简报 §夹具健全性探针 7/7 PASS,可定位、命令可重跑)✓。
- **无据推断扫描**:无「应该/通常/预计」类虚词;P4 风险显式标「中」并给出缓解指针 ✓。
- **结论:门禁通过,但一处依据链需随修订更新**——P4 的缓解「演进风险已 fail-safe 化,见 D4」依赖 D4 的「永不误归因」论证,而该论证被 C1 击穿。C1 修订后 P4 行必须同步重写。

## 错误处理链路审查

- **静默失败**:manager 全部丢弃路径有 NDJSON 计数事件 ✓;adapter/构造失败有 `diagnostic-log-manager-failed` / `storage-write-failed` 等事件 ✓。例外:i1(resolver 违约无通道,先例对齐,备案)。**但 C1 场景比静默失败更糟——误归因以「正常记录」形态伪装,现有健康面完全不可见**。
- **状态闭环**:无 UI 面(本票为配置/工具/健康事件);E4(rootDir 为普通文件)→ adapter disabled + NDJSON 事件 + create/open/read 业务照常 ✓。
- **降级路径**:E4、磁盘满等外部故障 → 业务不变 + 事件可观测,与 ADR-0012-LOG「初始化失败不影响 namespace create」明文一致 ✓。
- **虚假降级识别**:**未发现伪降级**。E4 是操作员外部配置错误(ADR 明文降级形态);ensureAdapter 失败有 manager-failed 响亮事件(非掩盖)。唯一倾向性风险:D4 的「窗失效 → 丢弃可观测」把「接线前提被打破(如 Registry 未来插入 await)导致**成功 create 的 #17 结局记录丢失**」与「正常无归属前置失败丢弃」混入同一 `unattributed` 计数——接线 bug 有被 generic 降级计数掩盖的倾向。要求:C1 修订时对「成功路径结局记录被丢弃」提供可区分信号(如独立 reason/事件),把接线回归从合法降级中隔离出来。
- **M1 补充**:replay 工具的「绝不抛」承诺即工具面的错误闭环;当前算法清单使该闭环在 EACCES/EISDIR 等场景破洞(M1)。

## 红线测试思路(汇总;细节已并入各攻击点)

| 攻击点 | 红灯测试方向 |
|---|---|
| C1 | 单元:initStream 后不 flush + 手动排队迟到 emit → 断言未写入 ns-a 流 + 计数事件;集成:并发 create + B 的 createDoc 注入 OperationalError(settle 晚 A 一拍)→ A 流无 B 痕迹、A replay complete/issues=[] |
| M1 | rootDir chmod 000 / current.json 路径被目录占据 → `replayNamespaceDiagnosticLog` 返回 failed{locator-invalid 或 locator-unreadable},不 throw |
| M2 | 夹具直写流 `[update(seq5), genesis(seq9), update(seq10)]` → ≠complete + genesis-misplaced(或等价);健康流仍 complete(防过度矫正) |
| M3 | manager ensureAdapter 构造(已存在过期闭组 + 激进 maxAge)→ 断言构造期删除行为与设计仲裁一致(false 策略:零删除;true 策略:`retention-swept` 事件 + 删除) |
| m1 | initStream 构造失败(rootDir 为文件)后 create 成功 → NDJSON reason 与修订后词表一致 |
| m2 | R6 变体(垃圾行后再置损坏行)→ 断言 record 级 issues 透传截止范围与设计一致 |
| m3 | `tool({rootDir, namespaceId: '../../x'})` → failed{locator-missing},断言未触达 rootDir 之外 |

## 复审程序

1. SA1 按本报告修订设计(C1 必须给出新机制与完整正确性论证;M1/M2/M3 二择一裁决并写入设计;m1–m3 一并处理);
2. 修订版交回 SA2 复审(C1 修订方案若改变 §5.2/§5.4 的 seam 形状,需同步 §10 ALLOW/DENY 与 §12 caller 审计);
3. SA8 的边界审视 6(= M2)与边界审视 5(locator 第三消费点)在修订版中应有显式回应(吸收或反驳)。

---

*SA2 R0 完——reject,控制权交回总控。*

---
---

# R1 复审(2026-09-02)——Verdict: **pass**

**被审对象**:SA1 R1 修订版(759 行,含 R1 修订摘要 / §9 回应表)。
**复审方法**:以 R0 攻击点为清单逐条核验修复机制,并对**修订引入的新代码路径**(emitStreamOutcome 数据通道 / attemptSeen 触发条件 / errno 收敛 / isSafeNamespaceId 前置门 / sweepOnOpen 备案)以全新攻击者视角重扫;全部关键声明经 worktree 源码独立实测。

## 一、R0 攻击点逐条核验

### C1(CRITICAL)→ ✅ 修复确认(机制正确且经源码逐点验证)

1. **机制成立**:R1 采用 SA2 建议的首选方案——`bound`/关窗微任务/dispatcher **全删**;归因 = 「调用点静态分类(initStream 前/后)+ namespaceId 数据查表」(D4 重写)。路由路径上不存在任何跨续段可变的共享状态;每条 post-initStream emission 的去向由本次调用自带的 namespaceId 字符串对 `Map<ns, adapter>` 的查表决定。
2. **调用点清单实测吻合**:`grep -n "diag\." packages/namespace-registry/src/registry.ts` 输出**恰 13 处**——`emitEarlyOutcome` ×3(`:1298/:1906/:1916`)+ `emitOutcome` ×9(`:1310/:1346/:1361/:1376/:1393/:1401/:1409/:1428/:1438`)+ `initStream` ×1(`:1418`)——与设计 §12 caller 表「emit 12 点(10 保留 + 2 改)+ initStream 1 点」逐点一致。
3. **静态分类完备性核验**:保留 `emitOutcome` 的 10 点全部位于各自 create 尝试的 `initStream` 之前——`:1298/:1310/:1346/:1361/:1376` 在 buildInitialDocument/createDoc 之前;`:1393/:1401/:1409` 在 `await persistence.createDoc` 的 catch 内(失败路径根本不走 `:1418` initStream);`:1906/:1916` 在公共入口同步段。待改 `emitStreamOutcome` 的 2 点(`:1428` #17 / `:1438` #18)在 initStream 之后的 try/catch 内。分类是代码位置属性,不随运行时时序变化 ✓。
4. **C1 竞态时序重跑**:A 续段 `[initStream(A)→Map[A] 落位 → factory → emitStreamOutcome(A) 查 Map[A] → 写 A 流]`;B 失败续段(createDoc catch)`[emitOutcome → 共享无归属通道 → unattributed 丢弃+计数]`。**B 的代码路径不携带任何可路由到 A 的状态**——无论宏任务/微任务批次如何交错(包括 R0 构造的 `[A续段, B续段, A关窗]` 批次,此时已无关窗可言),误归因在结构上不可达。R0 两种影响(幽灵 rejected 记录 / fatal-committed bytes 致 identity-mismatch)均不可达。
5. **观测可区分性落实**(R0 错误处理链路审查附加要求):三 reason 唯一产生方(D8 逐值+可达性)——`unattributed`=共享通道(事件不携 ns,词义本体)/ `stream-unavailable`=runtimeEmitterFor 丢弃桩(携 ns)/ `manager-closed`=close 后两通道;成功 create 的 #17/#18 丢弃不会被 generic 计数掩盖 ✓。§6.4 新增 C1 场景行 ✓。
6. **E4 路径附带核验**:E4(rootDir 普通文件)下 adapter 构造不抛、返回 disabled 模式并缓存;`emitStreamOutcome` → disabled emitter.emit → **实测** `file.ts:778/808` emit 管线门(`mode !== 'ready'` → 静默 return)——不 throw、不写盘,emitAttempt 吞没边界再兜一层;与 D8「E4 不落 stream-unavailable 分支」声明一致。
7. **P4 角色重定义合理**:R1 下插入 await 场景从「fail-safe 丢记录」升级为「emitStreamOutcome 仍查表命中、记录仍正确落流」;P4 风险「中→低」降级成立。

### M1(MAJOR)→ ✅

① fs errno 收敛:ENOENT → `locator-missing`;其余 errno(EACCES/EISDIR/EPERM/EMFILE/EROFS…)→ 新码 `locator-unreadable`;顶层 catch-all → 新码 `replay-internal-error`(结构性不可达防御深度);8 行收敛映射表明示。「纯同步、绝不抛」承诺完整兑现。新码不与 SA6 断言子串锚('genesis'/'gap'/'omitted'/'identity'/'invalid-json')冲突 ✓。

### M2(MAJOR)→ ✅(R0 攻击流形重推确认盲区堵死)

`attemptSeen` 在 attempt 分支**首行**置位(先于任何跳过/停止)。R0 攻击流形 `[update(seq5), genesis(seq9), update(seq10)]` 重推:update(seq5) 置 attemptSeen 后因无基跳过;genesis(seq9) 到达时 `attemptSeen=true` → 触发 `genesis-misplaced` → break;⑤ 补 `genesis-missing`;applied=0 → **failed**(D9 表新增 M2 构想行一致)。关键收口:**mid-genesis 永远到不了「合法基线」分支** ⇒ 被跳过前缀的连续性校验不再需要(misplaced 直接判负)——R0 盲区(「前置 seq 乱序仍可 complete」)结构性堵死。防过度矫正:健康流 genesis 恒为 stream 首条(合法 writer 只在建立时写 genesis),`attemptSeen=false` → R1/R2/R10 照常 complete ✓。SA8 边界审视 6 = 吸收 ✓。

### M3(MAJOR)→ ✅(裁决合理,四处落实)

裁决「备案默认 true」(manager 不传 sweepOnOpen,#154 内建原样消费)。决定性论证:(b) 恒传 false ⇒ 暴露的 retention 配置在生产永不生效 = **静默 no-op 配置面**(诚实性缺陷)——该论证优于 R0 建议的默认倾向,接受。落实四处:D3 成本注记(两遍构造期 IO:健康分析 O(stream) + sweep O(闭组数))、§5.2 构造期同步 fs 全清单、§6.1 #2 补全、§8.2 操作员杠杆明示(retention 双 `null` → 删除归零 / `enabled:false` → 整面关闭 / 遍历不可跳过及其理由)、§11-P8 新假设(源码依据 retention.ts:63-86 + file.ts:1455-1457,与本 SA2 R0 实测一致)✓。

### m1/m2/m3(MINOR)→ ✅ 全部落实

- **m1**:C1 方案下三值各有唯一产生方,`binding.emitter`(无归属通道)/丢弃桩(§5.2 伪代码)与 D8/§6.4 三处逐字一致——R0 矛盾结构性消失(正如 R0 预言「若 C1 修订采用 Registry 局部持有 emitter 方案,本条随之消失」)。
- **m2**:停止分支一律 **break**;record 级 issue 透传在停止点截断、stream 级(③)全量;R6 变体行为确定(仅垃圾行自身 invalid-json 透传)。
- **m3**:**实测** `isSafeNamespaceId` 为 `paths.ts:24` 导出的单源原语(非空 ∧ ≠`.`/`..` ∧ 无 C0/C1 控制字符 ∧ 无 `/`\`——足以堵死路径逃逸);**index.ts 当前未导出**(「此前未上公共面,增量 re-export」声明准确);`reader.ts:394` 同源消费(P9 依据准确)——零双源 ✓。违规 → `failed{locator-missing}`、零 fs 触达 ✓。SA8 边界审视 5 = 吸收(以单源导出回应)✓。

### i1/i2/i3(INFO)→ ✅ 备案/落实

- **i1**:维持备案,理由成立(Registry 包无 NDJSON sink;扩 observer 词表 = 公共观察面增长,超出可选建议收益;#150 no-op 先例 + 生产供应方构造性良构)。
- **i2**:finally 兜底(幂等 O(1);顺序语义仍由正序调用承担,finally 仅保证 closed 置位)——备案升格为结构性保证。
- **i3**:R7 归因注记补全(`file.ts:88` capture ⟂ genesis;生产 capture=false 流**有** genesis → 首条 update-omitted 即 partial;SA3 不得误实现)。

## 二、R1 新增面全新视角扫描(无新 CRITICAL/MAJOR)

- `emitStreamOutcome` 的 resolver 调用链:构造期非抛读取 + 每次调用 try/形状门/吞没(与 createRuntimeDiagResolver 共享单一包内 helper)——双 resolver 实例无状态差异,无新竞态面。
- 未来演进错用面:若 Registry 演进在 initStream 后新增 emit 点误用 `emitOutcome` → 记录进无归属通道(丢弃可观测)——fail-safe 方向(丢记录 ≠ 误归因);§12 已实测枚举全部 12+1 调用点,遗漏面闭合。
- `attemptSeen` 不改变 noop/rejected 记录的 lastSeq 推进语义(仍以 genesisSeen 为前置)。
- 新码(`locator-unreadable`/`replay-internal-error`)与 SA6 契约形状 `{code: string}` 与子串断言兼容。
- §10 ALLOW/DENY 与 §12 caller 审计已随 C1 修订同步(CreateDiag 内部接口加法、registry.ts 两调用点、index.ts isSafeNamespaceId re-export)——R0 复审程序 2 的要求满足。

## 三、R1 残留(非阻塞 note,SA3 实现期裁量)

| # | 级别 | 说明 | 处置建议 |
|---|---|---|---|
| N1 | MINOR-note | §5.6 顶层 catch-all「按已累计状态走 ⑤–⑦」未明示 ⑧ snapshot 取舍(catch-all 下若 applied>0 判 partial,snapshot 是否返回未定义)。该路径为「结构性不可达」防御深度,边角影响极小。 | 建议 SA3 保守实现:catch-all 分支 `snapshot = undefined`(防御路径不承诺快照);写入实现说明即可,无需设计返工。 |

## 四、R1 验证证据(命令+结果)

```
grep -n "diag\." packages/namespace-registry/src/registry.ts
→ 恰 13 行:emitEarlyOutcome ×3(1298/1906/1916)+ emitOutcome ×9(1310/1346/1361/1376/1393/1401/1409/1428/1438)+ initStream ×1(1418)
→ 与设计 §12「emit 12 点(10 保留+2 改)+ initStream 1」逐点一致;1428/1438 = 待改 emitStreamOutcome 的 #17/#18

sed -n '24,36p' packages/namespace-diagnostic-log/src/paths.ts
→ export function isSafeNamespaceId:非空 ∧ ≠'.'/'..' ∧ 无 C0/C1 控制字符 ∧ 无 '/'、'\' ——路径逃逸封死

grep -n "isSafeNamespaceId" packages/namespace-diagnostic-log/src/index.ts
→ 零命中(index 未上公共面;「增量 re-export」声明准确,零双源)

grep -n "isSafeNamespaceId" packages/namespace-diagnostic-log/src/reader.ts
→ :22 import + :168 manifest 门 + :394 readStreamStrict 前置门(P9 同源声明准确)

grep -n "mode !== 'ready'" packages/namespace-diagnostic-log/src/adapters/file.ts
→ :778/:808 emit 管线门(disabled/failed 静默 return,不 throw)——E4 下 emitStreamOutcome 数据通道安全
```

## 五、结论

**Verdict: pass**——R0 全部攻击点(C1/M1/M2/M3/m1/m2/m3/i1/i2/i3)在 R1 中修复或有理有据备案;C1 修复机制(数据键控归因)经源码逐点验证与竞态重跑确认竞态类别整体消灭;R1 新增面扫描无新 CRITICAL/MAJOR;残留仅 N1(结构性不可达路径的实现细节裁量)。同意放行至 SA3 实现与 SA4/SA7 验证(`pass` 不替代后续活链路验证)。

R0 红灯测试构想(C1/M1/M2/M3 各条)已在设计 §7.3/§10 R1 注记中登记为绿灯期增补用例建议——SA4/SA7 验证时应优先落实 C1 的并发 create 用例与 M2 的篡改流形用例。

---

*SA2 R1 复审完——pass,控制权交回总控。*
