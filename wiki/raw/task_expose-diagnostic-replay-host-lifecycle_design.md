# Design — Expose diagnostic replay and Host lifecycle configuration（issue #155 / SA1 R1）

- **任务类型**: Feature（ADR-0011 + ADR-0012-LOG 的 **Host/Registry 暴露与接线收口票**；ADR-0012-LOG 首切片 amendment 明文点名 #155 为接线修复票）
- **红灯契约**: `apps/yjs-server/test/diagnostic-replay-host-lifecycle-red.test.ts`（SA6，22 用例，两档红灯：config 面 `diagnostics` 键被拒 / `@nomicore/yjs-server` 入口无 `replayNamespaceDiagnosticLog` 导出）
- **约束基准**: `wiki/raw/task_expose-diagnostic-replay-host-lifecycle_relevant_decisions.md`（红线清单 10 条 + SA8 设计后复审追加 D1–D12）+ `…_conflict_report.md`（verdict clear，6 项边界审视）+ `…_sa2_review.md`（**R0 reject 判决：C1/M1/M2/M3/m1/m2/m3/i1/i2/i3——本 R1 逐条落实，回应表见 §9**）
- **依赖现状**: #148（契约+内存 adapter）、#149（Runtime ROOT/SCHEMA/replication 语义接线）、#150（Registry create 接线 + `diagnosticLog` seam）、#151（复制槽位诊断）、#152（File adapter）、#153（reopen/rolling/rotate）、#154（retention/租约/删除）全部已在 worktree 落地。

## R1 修订摘要（SA2 reject → 逐条落实）

| 攻击点 | 修订 | 落点 |
|---|---|---|
| **C1**（CRITICAL）dispatcher 同步窗竞态 | **消灭全局 `bound` 时序状态**：归因改为「调用点静态分类（initStream 前/后）+ namespaceId 数据查表」——`CreateDiag` 增 `emitStreamOutcome(ns, …)`（每次调用现场解析 ns-bound emitter），`binding.emitter` 降格为无归属丢弃通道（恒丢弃+`unattributed` 计数） | §4-D4 重写、§5.2、§5.4、§6.1/§6.4、§11-P4、§12 |
| **M1** replay 工具错误闭环破洞 | ① 增 fs errno 收敛映射（ENOENT→`locator-missing`；EACCES/EISDIR/EPERM/EMFILE/EROFS…→新码 `locator-unreadable`）+ 顶层 catch-all（→`replay-internal-error`，结构性不可达）+ 明示收敛映射表 | §5.6、§4-D12 |
| **M2** mid-genesis 篡改流可伪 complete | `genesis-misplaced` 触发条件并入 `attemptSeen`（存在前置 attempt 记录，哪怕全部被跳过）；采纳 SA8 边界审视 6 建议 | §4-D12、§5.6 ④ |
| **M3** 构造期 retention sweep 未备案 | 裁决**备案默认 true**（#154 内建原样消费；exposed retention 配置保持真实生产语义）；sweep 补入 §6.1 #2 同步 fs 清单 + D3 成本注记 + §8.2 后果实明示 + §11-P8 | §4-D3、§5.2、§6.1、§8、§11 |
| **m1** 丢弃词表三值 vs 伪代码两分支矛盾 | dispatcher 消灭后三值各有真实产生方（`unattributed`=共享通道 / `stream-unavailable`=解析丢弃桩 / `manager-closed`=停机后）；词表、§5.2、§6.4 同步一致 | §4-D8、§5.2、§6.4 |
| **m2** ④ 迭代控制歧义 | 停止分支一律 **break**（非 continue）；record 级 issue 透传在停止点截断、stream 级（③）全量——R6 变体由此确定 | §5.6 ④ |
| **m3** locator 读取逃逸 rootDir | ① 前置 `isSafeNamespaceId` 包内单源原语（index 增量 re-export，零双源）；违规 → `failed{locator-missing}`、零 fs 触达；采纳 SA8 边界审视 5 | §5.6 ①、§4-D12、§10 |
| **i1** resolver 违约静默 | 维持备案（#150 no-op 先例 + 生产供应方构造性良构）；理由见 §9 | §4-D11、§9 |
| **i2** performStop 异常路径跳过 close | close 幂等双保险：正序位置显式调用 + performStop 级 `finally` 兜底 | §5.3 |
| **i3** D9 R7 行机制归因 | 补夹具 vs 生产路径归因说明（capture ⟂ genesis，`file.ts:88`）；防 SA3 误实现「capture=false ⇒ 无 genesis」 | §4-D9 |

---

## §0. 一句话设计

**新增 Host 侧四个部件**：`AppConfig.diagnostics` 配置面（本地旁路、不进数据面）→ Host 诊断管理器（per-namespace File adapter 缓存 = 单 writer、健康 NDJSON、有界停机、**emission 归因全程数据键控——零时序窗**）→ Registry/Runtime 的**生产装配 emitter 注入**（补上 #149/#151 已实现但从未被生产组合根注入的最后一段线）→ `replayNamespaceDiagnosticLog` 离线 strict 重放工具（三态诚实报告 + owned bytes + **全错误类收敛、绝不抛**）。

---

## §1. 现状盘点——线已铺到哪里，断在哪里

### §1.1 已存在（本票纯消费，零改动）

| 部件 | 位置 | 状态 |
|---|---|---|
| 语义 emission / emitter / 冻结 record schema | `packages/namespace-diagnostic-log/src/{emission,record,schema,pipeline}.ts` | #148 ✅ |
| File adapter（同步有界 append、reopen 三分支、rolling、rotate、retention、删除） | `…/src/adapters/file.ts`（`createFileDiagnosticLog`） | #152/#153/#154 ✅ |
| strict reader（29 码词表、连续性状态机、historyTrimmed、earliestRetained） | `…/src/reader.ts`（`readStreamStrict`） | #152/#154 ✅ |
| Runtime 槽位语义接线（root-mutation / schema-replacement / replication-enable / replication-epoch-bump / replication-apply；emitSlot 在 slot 释放后） | `packages/namespace-runtime/src/{runtime,diagnostic,write,schema-write,replication-*,}.ts` | #149/#151 ✅ |
| Runtime seam 输入支持 `diagnosticEmitter` + `clock` 成对注入 | `…/src/runtime.ts:617-715`（`captureSeamInput`）、`:82-92`（`NamespaceRuntimeSeamInput`） | ✅ |
| Registry create 接线（#1–#18 结局点 + `initStream` stream 建立缝） | `packages/namespace-registry/src/{create-diagnostic,registry}.ts`（`registry.ts:1418` initStream、`:763` createCreateDiag） | #150 ✅ |
| 注入 seam 类型 | `…/src/types.ts:713-716`（`NamespaceRegistryDiagnosticLog = { emitter; initStream? }`） | #150 ✅ |

### §1.2 缺失（本票交付）

1. **配置面**：`parseAppConfig`（`apps/yjs-server/src/config.ts:552` 顶层键白名单）拒绝一切 `diagnostics` 键 → 操作员无法启用（SA6 红灯档 1）。
2. **Host 管理器**：yjs-server 组合根不构造任何 File adapter——`initStream`/emitter 无接收方。
3. **生产 emitter 注入的「最后一公里」断裂**——两处：
   - **Registry→Runtime**：生产工厂 `createNamespaceRuntimeForRegistry(handle, notifyDirty)`（`packages/namespace-runtime/src/internal.ts:40`，两参冻结签名）与 Registry 三处 `factory(handle, () => persistence.saveDoc(handle))` 调用点（`registry.ts:1211` open / `:1420` create / `:1557` import）**均不传 `diagnosticEmitter`** → 即使 Host 提供 `diagnosticLog`，Runtime 的 ROOT/SCHEMA/replication 槽位也永远零 emit。E1 要求的 `replication-enable`、E2 要求的 `root-mutation`/`schema-replacement`、E5 要求的跨重启续写 `replication-apply` **全部依赖本票补此线**。
   - **插件面**：`createNamespaceRegistryPlugin(config)`（`plugin.ts:168`）config 键集冻结（仅 `idleTimeoutMs`），无编程面注入 `diagnosticLog` 的通道（#150 设计 §12 明文：「若 Host 集成需要插件面，属后续票」= 本票）。
4. **重放工具**：`@nomicore/yjs-server` 入口无 `replayNamespaceDiagnosticLog` 导出（SA6 红灯档 2）；且 strict reader 只回 parsed record（inline Base64 / sidecar frame 引用），无 payload 物化原语。
5. **健康面**：File adapter `observer` 无接收方，健康事件（`LOG_STREAM_INIT_FAILED`、`storage-write-failed`、`retention-swept`…）无处上报。
6. **停机接线**：`performStop`（`app.ts:385-427`）无日志侧有界收口步骤。

### §1.3 关键结构事实（后续论证的锚）

- **emission 不携带 namespaceId**（ADR-0011 语义 emission 冻结形状）；namespace 归属由「哪个 adapter 实例接收 emit」决定（storage projection 归 adapter）。
- **Registry create 槽的同步续段事实**：`registry.ts:1417-1435`——`initStream(ns, bytes)` → `factory(...)` → `#17 committed emit`（或 catch 内 `#18 fatal emit`）之间**零 await、零微任务边界**（`await persistence.createDoc` 之后的同一同步续段）。#150 冲突报告 #1 已裁决：Registry lifecycle create slot ≠ NamespaceRuntime write sequencer slot，同步 File adapter 动作在 Registry 槽内是被明文允许的接线形态。**R1 注记（C1 修订后角色变化）**：本事实不再是 emission 归因的正确性前提（D4 已改为数据键控归因——即使未来 Registry 在此处插入 await，`emitStreamOutcome(ns)` 仍按 ns 查表正确落流）；它现在只支撑两点：emit/构造调用点的槽位合规论证（§6.1）与「initStream 先于 #17/#18，故共享通道/数据通道的调用点静态分类是完备的」。
- **first-slice File adapter 无队列、无常驻 fd、无 batch**：每条 record 独立 open-append-close（`file.ts:16-19` 文件头契约）→ 「shutdown drain」结构性无积压可冲。
- **生产 doc 的受控身份**：`META.docId = namespaceId`（`packages/namespace-registry/src/create-document.ts:70`）——replay identity 条件的比对源。

---

## §2. 需求推演（AC → 切入点）

| AC | 要求 | 现有断点 | 本票切入点 |
|---|---|---|---|
| AC1 | 配置启用（创建起、hub/peer 独立、不进 SCHEMA/META/ROOT/snapshot/wire） | config 白名单拒绝；组合根零构造 | §5.1 config 面 + §5.2 管理器 + §6.2 结构性隔离论证 |
| AC2 | 冻结-可调二分（格式策略→新 generation；retention 等可调不改解释） | 配置面不存在 | §4-D2：只暴露 updateCapture/inputPolicy（冻结类）与 retention（可调类）；rotate 机制由 #153 `analyzeStreamForResume` 既有语义承载（R10 已验证） |
| AC3 | 多 Runtime generation 单 writer；有界 drain | Runtime emitter 从未注入；无停机步骤 | §5.2 管理器 per-namespace 缓存（进程内恒一实例）+ §4-D7 O(1) 有界收口 |
| AC4 | strict replay、有效 genesis、连续 committed、owned bytes、不暴露 live Y.Doc、不自动拼接 | 工具不存在 + 无 payload 物化原语 | §5.6 replay 工具 + §4-D10 物化原语（日志包增量导出） |
| AC5 | 三态诚实报告 + 七类缺陷 + disclaimer | 同上 | §4-D9 状态语义仲裁表 + §4-D12 issue 码词表；disclaimer 经 API 契约文档化（R1 钉死 complete 时 `issues === []`，故 disclaimer 不可能是运行时字段） |
| AC6 | E2E 组合 | 全链断裂 | E1–E5 逐条走查（§7.2） |

---

## §3. 总体架构

```
                       apps/yjs-server（组合根 = 本票主战场）
 ┌──────────────────────────────────────────────────────────────────────────┐
 │ config.json                                                              │
 │   └─ diagnostics { enabled, rootDir, retention?, updateCapture?,         │
 │                    inputPolicy? }          ← §5.1（本地旁路，深冻结）      │
 │ main.ts ──parseAppConfig──► AppHandle.boot()                             │
 │   ├─ clock fiber ──► TimerService ──► persistence fiber                  │
 │   ├─ 【新】HostDiagnosticsManager（§5.2）                                  │
 │   │     ├─ Map<namespaceId, FileDiagnosticLog>   ← 单 writer 缓存         │
 │   │     ├─ binding.emitter = 无归属通道（恒丢弃+unattributed 计数）        │
 │   │     ├─ initStream(ns, genesisBytes) → ensureAdapter                  │
 │   │     ├─ runtimeEmitterFor(ns) → adapter.emitter / 丢弃桩（按 ns 查表）   │
 │   │     └─ observer → sink({event:'diagnostic-log', …})（健康 NDJSON）    │
 │   ├─ registry fiber = createNamespaceRegistryPlugin(cfg, {diagnosticLog}) │
 │   │     └─ createNamespaceRegistry(..., diagnosticLog)                   │
│   │          ├─ create 槽：#150 create-diag（R1 路由二分）              │
│   │          │   initStream 前 emit → 无归属通道；后 #17/#18 查表直达    │
 │   │          └─ open/create/import 三处 factory 调用点：【新】第三参        │
 │   │              { emitter = runtimeEmitterFor(ns), clock = () ⇒ clock }  │
 │   │              → internal seam → Runtime seam input                     │
 │   │              → Runtime diagEnv（#149/#151 槽位 emit，slot 释放后）     │
 │   └─ hub/peer replication plugin（零改动——日志不上 wire）                  │
 │ performStop(): … → registry.shutdown() → 【新】manager.close()（O(1)）     │
 │                 → persistence 排空窗 → persistence dispose → ctx dispose   │
 └──────────────────────────────────────────────────────────────────────────┘
 离线工具面（无进程）：index.ts 导出 replayNamespaceDiagnosticLog({rootDir, namespaceId})
   → current.json locator → readStreamStrict（强制 strict）
   → materializeStrictRecordUpdate（日志包【新】增量导出）→ detached Y.Doc
   → 五条件判定 → { status, lastAppliedSequence, issues, snapshot? }
```

---

## §4. 关键设计决策（D1–D12，含仲裁）

### D1（仲裁）：配置面形状 = SA6 PROPOSAL 逐字采纳

`AppConfig.diagnostics = { enabled: boolean; rootDir: string; retention?: { maxAgeMs?: number|null; maxBytesPerNamespace?: number|null }; updateCapture?: boolean; inputPolicy?: 'none'|'digest'|'redacted'|'full' }`。

- **理由**：SA6 红灯契约以此为锚（「键名/嵌套仲裁可改，行为断言不动」）；逐字采纳 → 红灯文件 import/gate 行零修订。hub/peer 通用（ADR-0010 静态拓扑下 Hub/Peer 是不同实例，各自本地旁路 = 各自配置）。
- `enabled:false` 是合法显式关闭（SA6 正例）；**缺整个 `diagnostics` 键 = 既有行为逐字节不变**（向后兼容锚）。
- 校验细则（violation path 粒度对齐 SA6 负例）：见 §5.1 表。

### D2（仲裁）：冻结/可调二分在配置面上的落点

ADR-0012-LOG 冻结类 = record/schema/frame 版本、committed update capture、input capture policy、inline threshold、line 上限；可调类 = retention/queue/batch/flush/fd/metrics。

- 本票配置面**只暴露** `updateCapture`（冻结类）、`inputPolicy`（冻结类）、`retention`（可调类）。inline threshold / line 上限 / roll targets / payloadMax **不暴露**（保持 adapter 内建冻结缺省——暴露即引入「同进程内冻结策略漂移」的操作员错误面，且 R10 已在 adapter 层验证 rotate 机制，无需配置面承载）。
- **冻结类变更 → 新 generation 的机制**：#153 `analyzeStreamForResume` 以 `resolved` 四值 + roll targets 对照 manifest，不匹配 → `stream-generation-rotated` + 新 generation（`file.ts:1398-1416`）。配置是 restart-only（`parseAppConfig` 在 boot/SIGHUP 换装各解析一次）→ 跨重启改 `updateCapture`/`inputPolicy` ⇒ reopen 健康证明失败 ⇒ rotate。**不自动拼接**（ADR 冻结；R10 断言）。
- **可调类变更不改变解释**：retention 不进 manifest（`retention.ts:10` 注释），跨重启改 retention ⇒ 同 stream 续写，零 generation 变化。

### D3：Host 管理器 = per-namespace adapter 缓存 = AC3 单 writer

- `Map<namespaceId, FileDiagnosticLog>`，进程寿命内**恒一实例**：Runtime generation 更替（idle close → reopen）复用同一 adapter 对象（`runtimeEmitterFor` 缓存命中）→ 「Multiple Runtime generations share one ordered namespace writer」以**对象同一性**直接兑现，不依赖文件层仲裁。
- 进程重启（E5）：新进程新管理器，`ensureAdapter` 经 `resumeStreamId` 缺省路径 → adapter 构造期 locator 三分支（`file.ts:237-287`）→ current.json 可用 → 健康证明 → **续写同一 stream**（sequence 续接、genesis 保留在首条）。adapter 构造期同步 fs（reopen 证明/修复）发生在 Registry open/create/import 槽（Runtime sequencer 尚不存在）——#153 纪律「构造期同步 fs 必须在 write sequencer slot 外」的合规落点（同 §1.3 第二条锚）。
- **成本注记（M3 补全）**：每次 adapter 构造包含**两遍**构造期 IO，均发生在 Registry open/create/import 槽内、每 namespace 每进程至多一次：
  1. 全 stream strict 健康分析（`analyzeStreamForResume`）——O(stream size)；
  2. **构造期 retention sweep**（#154 内建 `sweepOnOpen` 缺省 **true**——`retention.ts:73/84` 归一化缺省 + `file.ts:1455-1457` 构造完成自动执行，仅 `mode === 'ready'`）：目录枚举 + 每闭组 stat + **可能批量删除已关闭且无 reader lease 的 segment group**（绝不触碰当前 open group——#154 冻结安全约束）；O(闭组数)，远小于第 1 遍。操作员可经 `retention` 双 `null` 把删除行为归零（仅剩卫生遍历：orphan BIN / 遗留 `.deleting` 清理），经 `enabled:false` 完全关闭——**不支持完全跳过遍历**（不新增配置键，见 §8.2）。
  registry open 槽内的同步成本，#150 §8.5 成本声明同款（由该次 open 调用方承担）。**M3 裁决：manager 不传 `sweepOnOpen`（继承 #154 内建缺省 true，原样消费）**——理由：(a) #154 已内建并测试此执行面（T-A7 锚），本票不发明新策略；(b) D1 暴露的 `retention` 配置保持真实生产语义（每 ns 每进程构造时懒执行），若恒传 false 则暴露的 retention 限值在生产中永不生效 = 静默无效配置面（诚实性缺陷）；(c) 删除安全性（闭组/lease/open group 约束）已内建。被否替代：恒传 `sweepOnOpen: false`（构造期零删除）——代价是 retention 配置生产 no-op + 需未来票接线执行面，且 #154 的既有行为被本票悄悄改写。

### D4（R1 重写）：create 路径 emission 路由 = **数据键控归因**（时序窗已消灭）

emission 不携带 namespaceId（§1.3 锚 1），而 Registry `diagnosticLog.emitter` 是跨 namespace 共享的单 emitter。R0 用「共享 dispatcher + 微任务关窗」做归因——SA2 C1 证明**微任务 FIFO 只保证入队序执行，不保证 A 的关窗先于 B 已入队的失败 emit**：宏任务批次 `[A 续段, B 续段]` 交错下，A 续段内入队的关窗微任务排在 B 续段之后，B 的前置失败 emission 经 `bound.emitter.emit` **写入 A 的诊断流**（幽灵记录不可检测，或 fatal-committed bytes 造成 A 的 replay `identity-mismatch`——A 的诊断面被 B 的故障实质性损坏）。R1 **彻底消灭跨微任务时序状态**（SA2 修订方向首选）：归因只由两样东西决定——

1. **调用点静态分类**：`emitOutcome`/`emitEarlyOutcome`（各自 create 尝试的 `initStream` **之前**）vs `emitStreamOutcome`（`initStream` **之后**）——这是代码位置属性，不随运行时时序变化；
2. **namespaceId 数据值**：post-initStream emission 每次调用以本次尝试自己的 namespaceId 现场查 manager `Map<ns, adapter>`。

#### Host 侧（manager，详见 §5.2）——dispatcher / `bound` / 关窗微任务全部删除

```ts
// binding.emitter（#150 冻结类型成员）：语义 = 「无归属通道」——恒丢弃 + 计数，零路由逻辑
const unattributedEmitter: NamespaceDiagnosticChangeEmitter = {
  emit() { sink({ event: 'diagnostic-log-emission-dropped', reason: 'unattributed' }) },
}
// binding.initStream(ns, bytes)：ensureAdapter(ns, bytes) 建流 + 缓存（void 返回，#150 签名零改动）
// binding.runtimeEmitterFor(ns)：closed → 丢弃桩{manager-closed}；缓存命中/构造成功 → adapter.emitter；
//   构造 throw（结构性不可达，P3）→ 丢弃桩{stream-unavailable}（事件携 namespaceId——解析时已知归属）
//   丢弃桩：emit() → sink({ event:'diagnostic-log-emission-dropped', reason, namespaceId: ns })
```

#### Registry 侧（`create-diagnostic.ts`，C1 修订增量）——`CreateDiag` 接口增 `emitStreamOutcome`

```ts
export interface CreateDiag {
  /** initStream 之前的结局（acceptance/identity/input-snapshot/schema/validation/transaction 拒绝、
   *  createDoc catch）——经构造期捕获的共享 emitter = Host 无归属通道（丢弃 + unattributed 计数）。 */
  emitOutcome(observedAt: string, e: CreateEmissionArgs): void
  emitEarlyOutcome(e: CreateEmissionArgs): void
  /** initStream 之后的槽内结局（#17 committed / #18 runtime-construction fatal）：
   *  每次调用以 namespaceId **数据**现场解析 ns-bound emitter——零共享可变路由状态（C1）。 */
  emitStreamOutcome(namespaceId: string, observedAt: string, e: CreateEmissionArgs): void
  initStream(namespaceId: string, genesisUpdateBytes: Uint8Array | undefined): void
}
```

`registry.ts` 恰改两处调用点：`:1428`（#17 committed）与 `:1438`（#18 runtime-construction fatal）由 `diag.emitOutcome(...)` 改为 `diag.emitStreamOutcome(id.namespaceId, ...)`。其余 8 个 create 槽 emit 点（`:1298/:1310/:1346/:1361/:1376/:1393/:1401/:1409`）与公共入口 2 点（`:1906/:1916` acceptance/identity 拒绝）保持原方法——它们全部位于各自 create 尝试的 `initStream` 之前（**静态代码位置即可完备区分，无需任何运行时窗**）。`emitStreamOutcome` 内部：构造期非抛读取 `diagnosticLog.runtimeEmitterFor`（与 §5.4 resolver 同款形状门/吞没边界——D11），每次调用 `resolver(namespaceId)` → `emitAttempt(resolved, observedAt, e)`；解析违约 → 静默丢弃（i1 备案；生产供应方恒返回良构 emitter 或丢弃桩）。

#### 正确性论证（R1 重写——竞态类别整体消失）

1. **归因键是数据，不是时间**。每条 post-initStream emission 的去向由 namespaceId 字符串对 `Map<ns, adapter>` 的查表决定；每条 pre-initStream emission 的去向由调用哪个接口方法决定。路由路径上不存在任何跨续段可变的共享状态（R0 的 `bound` 已删除；`Map` 按 ns 键控、条目只在构造时新增、仅 `close()` 清空）。
2. **重跑 C1 交错时序**：宏任务批次 `[A 续段, B 续段]`——A 续段：`initStream(A)`（Map[A] 落位）→ `emitStreamOutcome(A)`（查 Map[A] → 写 A 流）；B 续段（createDoc catch）：`emitOutcome(#12)`（共享通道 → unattributed 丢弃计数）。即使两续段以任意顺序执行、或未来出现任何微任务交错，**没有任何读取操作能看见「别的 namespace 的绑定」**——查表键恒为本次调用自带的 namespaceId；B 从不调用 `emitStreamOutcome`（B 失败于 initStream 之前，静态落在共享通道）。C1 的两种影响（幽灵记录 / identity-mismatch 损坏）在结构上不可达。
3. **Registry 未来演进（initStream 与 #17 之间插入 await）**：R0 该场景丢记录（fail-safe 降级）；R1 该场景下 `emitStreamOutcome(A)` 仍查 Map[A] 命中 → **记录仍正确落流**——归因正确性不再依赖 #150 同步续段事实（§1.3 锚 2 / P4 由「正确性前提」降级为「无关」）。
4. **观测可区分性（SA2 错误处理链路审查要求）**：成功 create 的 #17/#18 记录被丢弃只剩三类可区分原因——`stream-unavailable`（解析未命中，防御深度，事件**携 namespaceId**）、`manager-closed`（停机后）、seam 违约静默（D11/i1，结构性不可达）；与合法降级 `unattributed`（initStream 之前的无归属失败，D4 显式裁决）互不混淆——接线回归不会被 generic 降级计数掩盖。
- **被拒 create 的 attempt 记录去向（显式裁决，R0 继承）**：无 home namespace（acceptance 拒绝甚至先于 namespaceId 生成；phase-5 后 entry/DOC_DUPLICATE 只是候选碰撞内部重试、非公共结局）→ 丢弃 + `unattributed` 计数事件。ADR-0011「日志允许缺失」+ 不存在可归属的 namespace 目录——这是唯一不伪造归属的诚实选项。
- E1 的 `namespace-create`（#17）经 `emitStreamOutcome(ns)` 查表直达正确 stream；`replication-enable` 不走本路径——它经 Runtime diagEnv 的 **ns-bound emitter**（D6），无归因歧义。

### D5：Registry seam 增量 + 插件面 host 注入通道

1. `NamespaceRegistryDiagnosticLog` **增量可选成员**（既有两成员一字不动，#150 冻结面零破坏）：
   ```ts
   /** #155：per-namespace emitter 数据键控解析（R1 起消费方两族：open/create/import 三处 factory
   *  第三参（D6）+ create 槽 initStream 后 #17/#18 的 emitStreamOutcome（D4/C1））。
   *  生产供应方（Host 管理器）恒返回良构 emitter：缓存命中/构造成功 → adapter.emitter；
   *  构造不可用 → 丢弃桩（每 emit 丢弃+计数 stream-unavailable/manager-closed——§5.2）。
   *  返回 undefined / throw / 畸形形状 = seam 违约，被 Registry 隔离为「无诊断」，
   *  绝不影响 open/create/import 结果（ADR-0011 §A；D11/i1）。 */
   readonly runtimeEmitterFor?: (namespaceId: string) => NamespaceDiagnosticChangeEmitter | undefined;
   ```
2. `createNamespaceRegistryPlugin(config, host?: Readonly<{ diagnosticLog?: NamespaceRegistryDiagnosticLog }>)` —— **第二参**注入，config 键集（`{idleTimeoutMs?}`）保持冻结（#112 §2.F / #150 §12 明文预留本通道给后续票）。缺省/不传 = 既有行为零变化。

### D6：Runtime internal seam 第三可选参（补生产注入最后一公里）

```ts
// packages/namespace-runtime/src/internal.ts（值导出仍恰两键——runtime-registry-internal-seam.test.ts:118 锚）
export interface RuntimeForRegistryDiagnostic {
  readonly emitter: NamespaceDiagnosticChangeEmitter;
  readonly clock: () => number;   // observedAt 唯一来源（#149 §5.2：emitter↔clock 成对）
}
export function createNamespaceRuntimeForRegistry(
  handle: DocHandle,
  notifyDirty: () => Promise<void>,
  diagnostic?: RuntimeForRegistryDiagnostic,   // ← 新增可选第三参
): NamespaceRuntime
```
- 透传：`createNamespaceRuntime(handle, notifyDirty, diagnostic?)` → `createNamespaceRuntimeWithSeam({ handle, notifyDirty, ...(diagnostic !== undefined ? { diagnosticEmitter: diagnostic.emitter, clock: diagnostic.clock } : {}) })`。`captureSeamInput` 既有成对校验/loud TypeError 语义零改动（Registry 侧先做形状门，见 §5.4—— loud 分支结构性不可达）。
- Registry 侧 `RuntimeFactory` 类型增宽为 `(handle, notifyDirty, diagnostic?) => any`；三处调用点（`registry.ts:1211/1420/1557`）统一经 §5.4 的解析器取第三参。testing `runtimeFactory` override（两参函数）对三参可选签名保持可赋值——零测试破坏。
- **emit 调用点位置不变**：#149/#151 的 emitSlot 仍在公共方法 `.then` 回调（slot 释放后）、acceptance 拒绝在公共方法同步段——本票只把 emitter 送进去，**不新增任何 emit 调用点、不触碰任何槽体**（write-slot 纪律论证见 §6.1）。

### D7：有界 drain = O(1) 结构性收口（AC3）

first-slice File adapter 每条 record 独立同步 append、无队列、无常驻 fd（§1.3 锚 3）⇒ **停机时不存在积压**。`manager.close()`：

1. `closed = true`（此后 `binding.emitter` 与丢弃桩均按 `manager-closed` 丢弃 + 计数事件）；
2. 释放 Map 引用。**零 fs 操作、零 await**——不执行停机 sweep（同步 fs 扫描无上界，违反有界要求）。

- 挂点：`performStop` 在 `registry.shutdown()` 完成之后（Runtime close barrier 排空 ⇒ 全部 slot 释放后 emit 已发生——#149 §7.1 注册序证明「全部写的 emit 微任务先于 barrier thunk」）、persistence 排空窗之前。顺序：replication drain → registry shutdown → **diagnostics close** → persistence 排空窗 → persistence dispose → ctx dispose。
- Registry shutdown / Persistence dispose 的等待链**不含任何日志侧 await**（Registry 从不 await emitter；manager.close() 同步 O(1)）→ 「cannot indefinitely delay」以结构性方式满足。未来切片若引入 writer queue（ADR-0012 amendment 目标态），须另行定义 drain 预算——本设计显式备案该边界。
- `main.ts` 零改动（watchdog 链不变；close 耗时 ≈ 0）。

### D8：健康面 = File adapter observer → NDJSON 事件（inspect health）

- 每个 adapter 构造时注入 `observer: { onEvent(e) { sink({ event: 'diagnostic-log', type: e.type, namespaceId, …e 其余冻结字段 }) } }`。事件词表/字段白名单 = `health.ts:23-117` 冻结面（低基数；streamId/segment/offset 刻意不进事件——包侧已保证）。
- 管理器自身事件（**R1 修订 m1：三值词表各附唯一产生方与可达性，消除 R0「词表三值 vs 伪代码两分支」矛盾**）：
  - `{event:'diagnostic-log-emission-dropped', reason:'unattributed'}`——**产生方：`binding.emitter`（共享无归属通道）**。可达性：常规（每个被拒/失败 create 的前置 emission 一次）。事件**不携 namespaceId**（无归属是该 reason 的词义本体——伪造归属正是要避免的缺陷）。
  - `{event:'diagnostic-log-emission-dropped', reason:'stream-unavailable', namespaceId}`——**产生方：`runtimeEmitterFor` 解析未命中时的丢弃桩**。可达性：结构性不可达（需 `createFileDiagnosticLog` 违反 P3 不抛契约实际 throw）；E4（rootDir 为普通文件）**不落此分支**——构造不抛、返回 disabled 模式 adapter（缓存命中），其 emitter 按 mode 静默丢弃且构造期已发 `LOG_STREAM_INIT_FAILED` 类健康事件。**与 `unattributed` 互斥可区分**（SA2 错误处理链路审查要求：成功 create 的 #17/#18 丢弃不会被 generic 无归属计数掩盖）。
  - `{event:'diagnostic-log-emission-dropped', reason:'manager-closed'}`——**产生方：`close()` 之后两条通道（共享通道/丢弃桩）**。可达性：停机窗口（Registry shutdown 后实际零迟到 emit，见 §5.2 close 注）。
  - `{event:'diagnostic-log-manager-failed', code}`——ensureAdapter 防御 catch（结构性不可达——adapter 工厂承诺不抛）。
- **namespaceId 入 NDJSON 的理由**：stdout NDJSON 是组合根既有结构化生命周期面（`provisioned`/`replica-reset`/`target-added` 均携 namespaceId 同款先例），非 metrics label——ADR-0011「日志字段不得进入默认低基数 **metrics label**」与 ADR-0010「不得出现在**高基数指标标签**」均不约束该通道；无 namespaceId 的健康事件对操作员不可定位。
- 不新增控制通道 op（如 `diagnostics-status`）：非 SA6 契约锚，健康事件流已覆盖「inspect health」语义（ADR-0011：dropped count、sink failure、queue health 尽力上报）。

### D9（仲裁）：replay 三态语义——failed = 无重放基，partial = 有基不完整

ADR 冻结：七类缺陷只能 partial/failed、complete 仅限五条件、R11（无日志）= failed 已被 SA6 钉死。partial/failed 细分是本设计裁决权：

> **failed = 重放无基**（未应用任何记录）：locator 缺失/不可解析、stream incompatible（不可解释）、**无有效 genesis**（含 retention 裁掉 genesis）。
> **partial = 重放有基**（genesis 已应用、已重放至少一个前缀）但完整性条件被破坏：中段 gap、中段损坏、update omitted、identity mismatch、尾行截断等。
> **complete = 五条件全满足且 issues 为空**（R1 钉死 `issues === []`）。

| SA6 用例 | applied 基数 | issues（码） | status | lastAppliedSequence | snapshot |
|---|---|---|---|---|---|
| R11 无日志目录/locator | 0 | `locator-missing` | **failed**（钉死） | null | 无 |
| R3 缺 genesis | 0 | `genesis-missing`（+扫描所得 `update-omitted` 等） | failed | null | 无 |
| R4 retention 裁剪 | 0 | `history-trimmed` + `genesis-missing` | failed | null | 无 |
| R7 capture 关闭 | 0 | `genesis-missing` + `update-omitted` | failed | null | 无 |
| R9 frameVersion=99 | 0 | `stream-incompatible` + `frame-version-unknown` | failed | null | 无 |
| R5 中段删行 | >0（前缀） | `sequence-gap` | **partial** | 前缀末 seq | 有（前缀态） |
| R6 中段垃圾行 | >0 | `invalid-json` | partial | 前缀末 seq | 有 |
| R8 identity 不符 | >0（全链） | `identity-mismatch` | partial | 末 seq | 有 |
| R1/R2/R10 健康链 | >0 | `[]` | **complete** | 末 seq | 有 |
| （M2 构想）篡改流 `[update(seq5), genesis(seq9), update(seq10)]` | 0 | `genesis-misplaced` + `genesis-missing` | **failed** | null | 无 |

- 「无 genesis ⇒ failed 而非 partial」的一致性论证：无 genesis 则不存在任何可诚实声称的重放状态（把缺失基底的增量 update 应用到空 doc 会虚构一个从未存在的文档状态）——与 R11「failed + snapshot 缺席」同族语义；ADR 对七类缺陷只钉「≠ complete」，failed 归属合法。M2 构想行同理：mid-genesis 被拒作基线（`attemptSeen` 触发 `genesis-misplaced`，§5.6 ④）⇒ 无有效基线 ⇒ failed（applied=0）。
- **R7 行机制归因注记（i3）**：R7 预测「applied=0 → failed + `genesis-missing`」成立的原因是 **SA6 夹具不传 `genesisUpdateBytes`**（red test :703），而**不是**「capture=false 抑制 genesis」——`file.ts:88` 明文 updateCapture 与 genesis **正交**。生产路径（capture=false、create 槽供给 genesis bytes）的流**有** genesis：genesis 正常应用（applied>0），首条 committed update 即 `update-omitted` → **partial**。SA3 不得把「capture=false ⇒ 无 genesis」当机制实现。
- **best-effort disclaimer 的承载方式（仲裁）**：R1 钉死 complete 时 `issues === []` → disclaimer 不可能是运行时 issue 字段。承载 = API 契约文档（类型 JSDoc + 本设计 §5.6）明示「complete 仅证明重放了该 best-effort stream 所持有的记录，不证明与生产 namespace 完全一致」（ADR-0011 原文）。AC5「preserving the disclaimer」= 语义保留于契约面，非输出字段。

### D10：payload 物化原语 = 日志包**增量公共导出**（replay 的存储投影逆向面）

CONTEXT.md「storage projection 归 adapter」——逆向物化（carrier/frame → owned bytes）同属存储投影，**不得在 app 侧二次实现**（Base64 canonical 严格性、NDCL frame 25 字节布局、CRC 输入域三处同构约束，双源必漂移）。日志包保持零 yjs 依赖（AGENTS 冻结），故物化原语只回 bytes，Y.Doc 构造归 app 工具：

```ts
// packages/namespace-diagnostic-log/src/reader.ts（增量；index.ts 增量 re-export）
export type StrictRecordUpdate =
  | { kind: 'update'; bytes: Uint8Array }        // owned 副本（可安全 applyUpdate）
  | { kind: 'omitted'; reason: string }          // committed 非-noop 且 effect='update-omitted'（reason 原样）
  | { kind: 'none' }                             // 无 update 载荷（noop/rejected/fatal-无-update…）
  | { kind: 'invalid'; code: string }            // 防御：entry.ok=false 或物化校验失败（复用 reader 码族）
export function materializeStrictRecordUpdate(
  request: StrictReadRequest,
  entry: StrictRecordRead,
): StrictRecordUpdate
```
实现只消费包内原语：`decodeBase64Strict`（carrier.ts:38）+ `decodeFrame`/`frameCrcOf`（frame.ts）+ `validateSidecarFrame` + `streamLayoutPaths`；inline 路径 re-check payloadLength/crc、sidecar 路径 re-check sequence/payloadLength/crc（纵深防御——strict 门已过仍复验）；一切失败收敛 `{kind:'invalid', code}`，绝不抛。

**R1 增量（m3，吸收 SA8 边界审视 5）——`isSafeNamespaceId` 增量 re-export**：`paths.ts:24` 的安全文法门此前未上公共面（仅包内 reader/file 消费）；replay 工具的 locator 前置门（§5.6 ①）复用**同一原语**（`index.ts` 增量 re-export `export { isSafeNamespaceId } from './paths.js'`，与 `readStreamStrict` 内部消费的 `reader.ts:394` 安全门同源）——**零双源**：app 侧不得复刻文法（路径派生/控制字符/分隔符规则与 writer 侧必须永不漂移），与 D10 物化原语同一单源纪律。

### D11：seam 违约姿态 = lenient 隔离（对齐 #150 冻结先例），非 loud

ADR-0011 §A「Runtime/Registry/复制实现仍防御 adapter 违约；…均被隔离」+ #150 `createCreateDiag` 先例（畸形 `diagnosticLog` → NOOP 单例，SA4 R1 B1 裁决）。本票同款：Registry 侧对 `runtimeEmitterFor` 的读取/调用/返回形状全部包在非抛边界内，违约 → 该 Runtime 无诊断。**不选 boot 期 loud**：与 #150 同一 seam 的既有姿态分裂会造成双规则；唯一生产供应方（管理器）构造性良构。业务隔离优先于响亮（此处响亮 = 让日志配置错误杀死 open/create，恰是 ADR 明文禁止的后果）。

### D12：replay issue 码词表（Host 工具层；`{code: string}` 冻结形状内；R1 修订 M1/M2/m3）

| code | 触发 | 词表依据 |
|---|---|---|
| `locator-missing` | current.json/目录缺失（readFileSync ENOENT）；**或 request.namespaceId 文法违规（m3 前置门，零 fs 触达）** | 本票（Host 工具层；物理类新码，语义自 ADR-0012 locator 条款 + paths.ts 安全文法单源） |
| `locator-invalid` | current.json 可读但内容违约（JSON parse ✗ / 形状 ✗ / streamId 文法 ✗） | 本票（同上） |
| `locator-unreadable` | **R1 新码（M1）**：读 current.json 时非 ENOENT 的 fs 错误（EACCES/EISDIR/EPERM/EMFILE/EROFS/…） | 本票（Host 工具层；ADR-0012 locator 冻结布局的工具侧对称——strict reader「绝不抛」契约（reader.ts:5）在工具入口的兑现） |
| `replay-internal-error` | **R1 新码（M1 防御深度）**：算法顶层 catch-all 收编的逃逸 throw（结构性不可达——各步骤均已收敛，见 §5.6 收敛映射表） | 本票（ADR-0011 三态诚实报告：内部意外不冒充可解释状态） |
| `stream-incompatible` | `readStreamStrict` status='incompatible' 的总括码（reader 原生码逐条并列透传） | ADR-0012「未知格式 → incompatible」 |
| `genesis-missing` | 无 genesis（或 genesis 被拒作基线——含 mid-genesis `genesis-misplaced` 场景、retention 裁掉 genesis） | ADR-0011 五条件之 1 |
| `genesis-misplaced` | **R1 触发条件扩（M2，吸收 SA8 边界审视 6）**：genesis 到达时 `genesisSeen ∨ applied>0 ∨ attemptSeen`（**存在前置 attempt 记录——哪怕全部因无基被跳过**）。合法 writer 只在 stream 建立时写首条 genesis ⇒ 前置 attempt + mid-genesis 只能出自篡改/adapter bug ⇒ 拒作基线 | ADR-0011 五条件之 1「有可用 genesis」（misplaced genesis 非合法基线）；五条件之 2 的检测义务（连续性复核不可被「前缀整体跳过」绕过） |
| `history-trimmed` | `read.historyTrimmed === true` | ADR「retention 裁剪 → partial/failed」 |
| `sequence-gap` | 本地连续性复核（BigInt 逐条比对） | 物理类沿用 strict reader 既有码族 |
| `invalid-json` / `line-unterminated` / `vfsl-invalid` / `frame-missing` / `crc-mismatch` / `manifest-*` … | reader record/stream issues 逐条透传（**record 级在停止点截断，stream 级全量——m2，见 §5.6 ④**） | 物理类沿用 strict reader 29 码族（零新码） |
| `update-omitted` | committed 非-noop 且 `effect='update-omitted'`（materialize kind='omitted'） | ADR-0011 五条件之 3；含子串 'omitted'（R7 锚） |
| `update-undecodable` | `Y.applyUpdate` throw（bytes 通过存储校验但 Yjs 拒绝） | ADR「可解码的 Yjs update」条件之 3 |
| `identity-mismatch` | 重放后 `META.docId ≠ namespaceId`（含 docId 缺席） | ADR-0011 五条件之 5；含子串 'identity'（R8 锚） |

语义类含 SA6 断言子串（'genesis'/'gap'/'omitted'/'identity'/'invalid-json'）；物理类 R1 新增恰两码（`locator-unreadable`/`replay-internal-error`，均为 M1 收敛映射的落点）；其余物理类零新码。update-omitted **稳定 reason 词表 v1 三值**不受影响（`reason` 仅透传进 issue 附带字段或不带——code 恒 `update-omitted`，不发明 reason 子码）。

---

## §5. 详细设计（per-file）

### §5.1 `apps/yjs-server/src/config.ts` —— 配置面（~90 行增量）

```ts
export interface DiagnosticsRetentionConfig {
  readonly maxAgeMs?: number | null;
  readonly maxBytesPerNamespace?: number | null;
}
export interface DiagnosticsConfig {
  readonly enabled: boolean;
  readonly rootDir: string;
  readonly retention?: Readonly<DiagnosticsRetentionConfig>;
  readonly updateCapture?: boolean;
  readonly inputPolicy?: 'none' | 'digest' | 'redacted' | 'full';
}
// AppConfig 增量：readonly diagnostics?: Readonly<DiagnosticsConfig>;
```

校验（并入既有 violations 管线；顶层白名单加 `'diagnostics'`）：

| 输入 | violation path | 规则 |
|---|---|---|
| `diagnostics` 非 plain object | `diagnostics` | must be an object |
| 未知子键（如 `wat`） | `diagnostics.wat` | unknown key（allowed: enabled, rootDir, retention, updateCapture, inputPolicy） |
| `enabled` 缺失/非 boolean | `diagnostics.enabled` | required boolean |
| `rootDir` 非非空 string | `diagnostics.rootDir` | non-empty string（`enabled:false` 亦必填——形状一致，SA6 正/负例均如此） |
| `updateCapture` 非 boolean | `diagnostics.updateCapture` | optional boolean |
| `inputPolicy` 越界（如 `'everything'`） | `diagnostics.inputPolicy` | optional enum 4 值 |
| `retention` 非对象 / 未知子键 | `diagnostics.retention` / `diagnostics.retention.<key>` | optional object，键集 {maxAgeMs, maxBytesPerNamespace} |
| `retention.maxAgeMs = -5` 等 | `diagnostics.retention.maxAgeMs` | `number | null`；number 须 safe integer ≥ 0（`0` 合法非无限、`null` 显式关闭——ADR-0012 §Retention 语义，与 `retention.ts:50-55` 值域同源） |

解析产物进 `deepFreeze`（既有纪律）。role×diagnostics 无交叉互斥（hub/peer 均合法）。缺省策略**不在 config 层展开**（`updateCapture ?? false`、`inputPolicy ?? 'digest'`、retention 缺省 → adapter 层默认 30d/1GiB）——config 是操作员意图的忠实载体。

### §5.2 `apps/yjs-server/src/diagnostics.ts` —— Host 管理器（新文件，~170 行）

```ts
export interface HostDiagnosticsManager {
  readonly binding: NamespaceRegistryDiagnosticLog;
  // binding.emitter   = 无归属通道（恒丢弃 + unattributed 计数；#150 冻结成员的 R1 语义）
  // binding.initStream= (ns, bytes) => ensureAdapter(ns, bytes)（建流+缓存；void）
  // binding.runtimeEmitterFor = (ns) => adapter.emitter | 丢弃桩（数据键控，D4）
  close(): void;                                     // O(1)、幂等、零 fs、零 await（D7）
}
export function createHostDiagnosticsManager(
  config: Readonly<DiagnosticsConfig>,               // 调用方已保证 enabled === true
  deps: { sink: EventSink; now: () => number },      // now = 组合根注入 Clock（禁墙钟）
): HostDiagnosticsManager
```

- **binding.emitter（无归属通道，R1——C1/m1）**：`{ emit() { closed ? dropped{manager-closed} : dropped{unattributed} } }`——零路由逻辑，不读任何共享可变绑定状态。消费方 = `createCreateDiag` 构造期捕获的共享 emitter（全部 initStream 之前的 create emission，见 D4 调用点清单）。
- `ensureAdapter(namespaceId, genesisUpdateBytes?)`（D3/D4；唯一构造点）：
  ```ts
  if (closed) return undefined;
  const cached = adapters.get(namespaceId); if (cached !== undefined) return cached;
  try {
    const log = createFileDiagnosticLog({
      rootDir: config.rootDir, namespaceId,
      ...(genesisUpdateBytes !== undefined ? { genesisUpdateBytes } : {}),
      ...(config.updateCapture !== undefined ? { updateCapture: config.updateCapture } : {}),
      ...(config.inputPolicy !== undefined ? { inputPolicy: config.inputPolicy } : {}),
      ...(config.retention !== undefined ? { retention: config.retention } : {}),
      observer: { onEvent: (e) => sink({ event: 'diagnostic-log', namespaceId, ...e }) },
      clock: { now: deps.now },
    });
    adapters.set(namespaceId, log); return log;
  } catch { sink({ event: 'diagnostic-log-manager-failed', namespaceId, code: 'ADAPTER_CONSTRUCTION_THREW' }); return undefined }
  ```
  - `resumeStreamId` 恒不传（缺省路径 = 显式 > current.json > 恰一候选扫描——`file.ts` 三分支；≥2 候选 → disabled + `locator-ambiguous`，绝不猜测，包语义原样继承）。
  - open 路径（无 genesisBytes）建流无 genesis：诚实缺席（ADR「genesis 未成功写入时 stream 仍可记录诊断事实，但不得声称完整重放」；replay 对此类流报 `genesis-missing` ≠ complete）。
  - **构造期同步 fs 全清单（M3 补全，对应 §6.1 #2）**：mkdir / manifest `'wx'` / genesis append / current.json rename + reopen 健康分析 O(stream) + **构造期 retention sweep**（`sweepOnOpen` 不传 → #154 内建缺省 true——`retention.ts:73/84` + `file.ts:1455-1457`，仅 ready 模式；目录枚举 + 每闭组 stat + 可能批量删除闭组；删除安全性 #154 内建：只删已关闭且无 reader lease 的 group、绝不删 open group）。E4（rootDir 为普通文件）：构造**不抛**——返回 disabled 模式 adapter 并缓存（`binding.emitter` 路径不变；其 emitter 按 mode 静默丢弃，健康事件由构造期 observer 发出）。
- **binding.initStream(namespaceId, genesisBytes)**（void，#150 签名零改动）：`ensureAdapter(namespaceId, genesisBytes)`——建流 + 缓存落位；失败（E4→disabled 缓存 / 不可达 throw→undefined 不缓存）对调用方不可见（Registry 侧吞没边界不变）。
- **binding.runtimeEmitterFor(namespaceId)**（D4 数据键控解析；R1 语义细化）：
  ```ts
  if (closed) return dropStub(namespaceId, 'manager-closed');
  const log = ensureAdapter(namespaceId);            // 缓存命中（create 路径恒命中——initStream 同步续段落位）
  return log !== undefined ? log.emitter : dropStub(namespaceId, 'stream-unavailable');
  // dropStub(ns, reason) = { emit() { sink({ event:'diagnostic-log-emission-dropped', reason, namespaceId: ns }) } }
  ```
  - 生产可达性：create 路径（`emitStreamOutcome`）恒命中缓存（`initStream` 与 `emitStreamOutcome` 之间无清除点——`close()` 仅在 Registry shutdown 后执行）；open/import 路径（factory 第三参）首次未命中 → 构造；构造失败仅限 throw（结构性不可达，P3）→ 丢弃桩 `stream-unavailable`（D8 可达性注）。
  - **归因不变式**：本函数的返回值由 `namespaceId` 参数与 `adapters`/`closed` 两个键控/单调状态决定——不存在任何「上一次调用留下的绑定」（R0 `bound` 已删除），并发交错下查表键恒为本次调用自带值。
- `close()`：`closed = true; adapters.clear()`（幂等；重复调用零副作用）。此后一切 emit 丢弃计数（Registry shutdown 后 runtime 已关——实际零迟到 emit；`emitStreamOutcome` 解析在 closed 后亦得 `manager-closed` 丢弃桩）。

### §5.3 `apps/yjs-server/src/app.ts` —— 组合根接线（~40 行增量）

- `boot()`：clock fiber await 之后、registry fiber 之前：
  ```ts
  this.diagnostics = this.config.diagnostics?.enabled === true
    ? createHostDiagnosticsManager(this.config.diagnostics, { sink: this.sink, now: () => requireClock(this.ctx).now() })
    : undefined;
  const registryFiber = ctx.plugin(createNamespaceRegistryPlugin(
    { ...(idleTimeoutMs 同现状) },
    this.diagnostics !== undefined ? { diagnosticLog: this.diagnostics.binding } : {},
  ));
  ```
- `performStop()`：`registry.shutdown()` 与 sink `registry-stopped` 之后、file 排空窗之前（正序位置，D7 顺序语义）：
  ```ts
  this.diagnostics?.close();
  this.sink({ event: 'diagnostics-closed' });
  ```
  **i2 修订（异常路径）**：现有 `performStop` 为单 try 块、catch 只 sink+rethrow——`registry.shutdown()` throw 时上述 close 被跳过。修法 = **幂等双保险**：正序位置显式调用（保证 D7 顺序：registry shutdown → diagnostics close → persistence 排空窗）+ 把外层 `catch { … throw }` 扩为 `catch { … throw } finally { this.diagnostics?.close() }`——close 幂等 O(1)，正序已关时 finally 是零成本 no-op；throw 路径上保证 `closed` 置位后才 rethrow（adapter 无常驻 fd/队列，实害本为零，i2 备案升格为结构性保证）。注意 finally 不承担顺序语义（正序调用才定义顺序）；仅兜底「closed 标志必然置位」。
- SIGHUP 换装零额外改动：reload 走 `app.stop()`（manager 关）→ 新 app boot（新 manager，adapter 经 current.json 续写；冻结策略变化 → rotate——AC2 换装路径天然覆盖）。

### §5.4 Registry 包（types/registry/plugin/create-diagnostic，~85 行增量）

- `types.ts`：`NamespaceRegistryDiagnosticLog` += `runtimeEmitterFor?`（D5）；JSDoc 声明 sync-only + 违约隔离（对齐既有 `initStream` 注释纪律）。
- `create-diagnostic.ts` 增量 helper（非抛边界，B1 同款模式——构造栈一次读取）：
  ```ts
  export function createRuntimeDiagResolver(
    diagnosticLog: NamespaceRegistryDiagnosticLog | undefined,
    clock: Clock,
  ): (namespaceId: string) => RuntimeForRegistryDiagnostic | undefined {
    const resolver = 非抛读取 diagnosticLog.runtimeEmitterFor（非函数 → undefined）;
    if (resolver === undefined) return () => undefined;
    return (namespaceId) => {
      try {
        const e = resolver(namespaceId);
        if (e == null || typeof e !== 'object' || typeof e.emit !== 'function') return undefined;  // D11 隔离
        return { emitter: e, clock: () => clock.now() };
      } catch { return undefined }
    };
  }
  ```
- **`create-diagnostic.ts` C1 修订增量**：(a) `CreateDiag` 接口 += `emitStreamOutcome(namespaceId, observedAt, e)`（D4 接口定义；`NOOP_DIAG` 单例同步加 no-op 实现——`diagnosticLog` 缺席/畸形时 create 槽全部行为与现状逐字节一致）；(b) `createCreateDiag` 构造期**追加非抛读取** `diagnosticLog.runtimeEmitterFor`（B1 同款形状门：非函数 → 无 resolver）；(c) `emitStreamOutcome` 实现 = 每次调用 `resolver(namespaceId)`（try + 形状门 + 吞没，与 `createRuntimeDiagResolver` 同款边界——形状门/吞没逻辑抽包内私有共享 helper，双处消费单一实现）→ 命中 → `emitAttempt(resolved, observedAt, e)`；resolver 缺席/违约 → 静默丢弃（D11/i1）。既有 `emitOutcome`/`emitEarlyOutcome`/`initStream` 逻辑零改动（emitAttempt 吞没内核复用）。
- `registry.ts`：`createRegistryInternal` 构造 `const resolveRuntimeDiag = createRuntimeDiagResolver(options.diagnosticLog, clock)`；`RuntimeFactory` 类型增宽第三可选参；三处 factory 调用点（`:1211/:1420/:1557`）改为：
  ```ts
  runtime = factory(handle, () => persistence.saveDoc(handle), resolveRuntimeDiag(identity.namespaceId));
  ```
  **C1 修订增量**：恰两处 emit 调用点改走数据通道——`:1428`（#17 committed）与 `:1438`（#18 runtime-construction fatal）`diag.emitOutcome(p.createdAt, {…})` → `diag.emitStreamOutcome(id.namespaceId, p.createdAt, {…})`。其余 emit 调用点（`:1298/:1310/:1346/:1361/:1376/:1393/:1401/:1409` + 公共入口 `:1906/:1916`）**零改动**（全部位于各自 create 尝试 `initStream` 之前——静态位置分类，D4）。
- `plugin.ts`：`createNamespaceRegistryPlugin(config, host?: Readonly<{ diagnosticLog?: NamespaceRegistryDiagnosticLog }>)`——工厂调用期对 host 形状做**lenient** 处理（undefined/缺 diagnosticLog = 不注入；D11），`apply` 内透传给 `createNamespaceRegistry`。

### §5.5 Runtime 包（internal/runtime，~25 行增量）

D6 伪代码逐字落地。`internal.ts` 值导出键集不变（恰两键）；`runtime.ts` 仅 `createNamespaceRuntime` 加可选第三参 + 条件展开进 seam input；`captureSeamInput` / `buildDiagnosticEnv` / 全部槽体**零改动**。

### §5.6 replay 工具（新文件 `apps/yjs-server/src/diagnostic-replay.ts` ~200 行 + index.ts 导出）

```ts
/** 诊断性重放（ADR-0012 §Strict reader 冻结报告形状）。
 *  即便 complete 也只证明重放了该 best-effort stream 所持有的记录，
 *  不证明与生产 namespace 完全一致（ADR-0011 best-effort disclaimer）。 */
export interface DiagnosticReplayIssue { readonly code: string }
export interface DiagnosticReplayResult {
  readonly status: 'complete' | 'partial' | 'failed';
  readonly lastAppliedSequence: string | null;
  readonly issues: readonly DiagnosticReplayIssue[];
  readonly snapshot?: Uint8Array;
}
export type ReplayNamespaceDiagnosticLogRequest = { rootDir: string; namespaceId: string };
export function replayNamespaceDiagnosticLog(request): DiagnosticReplayResult   // 纯同步、绝不抛
```

算法（严格对应 §4-D9/D12）：

```
前置门（m3）：isSafeNamespaceId(request.namespaceId)（包内单源原语，经 index 增量 re-export——D10；
  与 readStreamStrict 内部 reader.ts:394 安全门同一实现，零双源）
  违规 → failed{locator-missing}，零 fs 触达（namespaceId 无法构成安全路径 ⇒ 视同目标不存在；
  '../..' 之类输入不可使 readFileSync 逃逸 rootDir——工具只读日志目录的封闭性）
① locator：try { raw = readFileSync(join(rootDir,'namespaces',namespaceId,'current.json'),'utf8') }（ADR-0012 冻结布局；
  与 file.ts:244-267 resolveResumeCandidate 同一物理契约）
    catch (err)：err.code === 'ENOENT'（或目录缺失）→ failed{locator-missing}                 ← M1 收敛点
                 其他 errno（EACCES/EISDIR/EPERM/EMFILE/EROFS/…）→ failed{locator-unreadable}  ← M1 新收敛点
   raw 解析：JSON.parse throw / 形状 ✗（format≠'ndcl-current' | version≠1 | streamId 文法 ✗）
     → failed{locator-invalid}
② read = readStreamStrict({rootDir, namespaceId, streamId})          // replay 强制 strict（唯一读取模式）；自身绝不抛（P5）
   read.status === 'incompatible' → failed{stream-incompatible, …read.issues 码透传}
③ 预扫描：read.historyTrimmed → issues += history-trimmed；read.issues 码逐条透传
   （stream 级 issues 全量透传——不受 ④ 停止点影响：它们描述流本身，非「截至停止点的重放」）
④ doc = new Y.Doc()（detached；不暴露）；expectedNext = null；applied = 0；lastSeq = null；
   genesisSeen = false；attemptSeen = false；stopped = false
   逐 entry（read.records 有序）：
     entry.ok === false → issues += entry.issues 码透传；stopped = true；break
     rec = entry.record
     recordKind === 'genesis-baseline':
        genesisSeen ∨ applied > 0 ∨ attemptSeen → issues += genesis-misplaced；stopped = true；break   ← M2
          （R1 并入 attemptSeen：存在前置 attempt 记录——哪怕全部因无基被跳过——mid-genesis 即拒作基线；
           被跳过前缀的连续性复核失守（M2 盲区）由此堵死：misplaced genesis 永远到不了「合法基线」分支）
        materialize → update → applyUpdate try/catch（throw → issues += update-undecodable；stopped；break）→
          genesisSeen = true；applied++；lastSeq = seq；expectedNext = seq+1n
        materialize ≠ update → issues += (invalid 码|…)；stopped = true；break
     attempt：
        attemptSeen = true                                  ← M2（前置 attempt 事实先记——无论本条后续是否被跳过/停止）
        result.committed && effect === 'update-omitted' → issues += update-omitted（materialize kind='omitted' 同源）；stopped = true；break
        连续性复核：expectedNext ≠ null ∧ BigInt(seq) ≠ expectedNext → issues += sequence-gap；stopped = true；break
        result 携 update carrier（committed/fatal-committed 的 effect='update'）:
           genesisSeen === false → 跳过应用（无基不虚构状态；issues 已有 genesis-missing 兜底）但 lastSeq 不动
           否则 materialize → update → applyUpdate try/catch → applied++；lastSeq = seq；expectedNext = seq+1n
           materialize invalid → issues += invalid 码；stopped = true；break
        其他（committed noop / rejected / fatal-无-update）→ genesisSeen 时 lastSeq = seq；expectedNext = seq+1n
   ——迭代控制（m2）：各停止分支一律 **break**（非 continue）——record 级 issue 透传在停止点**截断**，
     停止点之后的 entry 级发现不再进入 issues（报告描述「截至停止点的重放事实」）；③ 的 stream 级
     issues 不受影响（全量）。R6 变体（垃圾行后再置损坏行）由此确定：仅垃圾行自身的 invalid-json 透传。
⑤ !genesisSeen → issues += genesis-missing（含 misplaced 被拒场景——无有效基线）
⑥ identity：applied > 0 时 doc.getMap('META').get('docId') !== namespaceId（含缺席/非 string）→ issues += identity-mismatch
⑦ status = issues.length === 0 && applied > 0 && read.status === 'ok' && !read.historyTrimmed ? 'complete'
           : applied > 0 ? 'partial' : 'failed'
⑧ snapshot = applied > 0 ? Y.encodeStateAsUpdate(doc) : undefined    // 每次调用新编码 = owned 副本（R2 篡改无关性）
顶层 catch-all（M1 防御深度；结构性不可达——①–⑧ 各步已收敛）：算法任何逃逸 throw → issues += replay-internal-error，
  按已累计状态走 ⑤–⑦（applied>0 → partial 否则 failed；lastAppliedSequence 取已推进值）——「纯同步、绝不抛」的最终闭环
```

**收敛映射表（M1 明示——「绝不抛」承诺的完整兑现清单）**：

| 错误类 | 触发点 | 收敛 |
|---|---|---|
| `namespaceId` 文法违规 | 前置门 | `failed{locator-missing}`（零 fs） |
| fs 读 locator：ENOENT | ① | `failed{locator-missing}` |
| fs 读 locator：其他 errno（EACCES/EISDIR/EPERM/EMFILE/EROFS/…） | ① | `failed{locator-unreadable}` |
| locator 内容违约（parse/形状/文法） | ① | `failed{locator-invalid}` |
| stream 未知格式 | ② | `failed{stream-incompatible}` + reader 码透传 |
| record 级损坏/gap/omitted/不可解码 | ③④ | 码透传 + break → D9 三态（partial/failed） |
| `Y.applyUpdate` throw | ④ | `update-undecodable` → break |
| 算法逃逸 throw（结构性不可达） | 顶层 catch-all | `replay-internal-error` → partial/failed |

（② `readStreamStrict` 绝不抛 = P5（reader.ts:5 契约）；`materializeStrictRecordUpdate` 绝不抛 = D10；BigInt 比对仅作用于 reader 已校验的十进制 sequence——无 throw 面。）

- R1 核对：genesis(1) + create(2) + m1..m3(3-5) + noop(6)——noop 走「其他」分支推进 lastSeq → `'6'` ✅；`issues === []` → complete ✅。
- R10 核对：locator 指向 gen2（current.json）→ 只重放 gen2 自身链（不自动拼接）→ complete、lastSeq = gen2 末条 ✅。
- **M2 防过度矫正核对**：健康流 genesis 恒为 stream 首条（合法 writer 只在建立时写 genesis baseline）→ genesis 到达时 `attemptSeen === false` → 合法基线照常应用 → complete 语义零变化（R1/R2/R10 回归锚）；`attemptSeen` 只在篡改/adapter-bug 流形（前置 attempt + mid-genesis）上触发 `genesis-misplaced`。
- 读侧零写入：工具只 readFileSync + 构造 detached doc——日志流字节不变（R2 断言）。

### §5.7 `apps/yjs-server/src/index.ts`（~15 行增量）

```ts
export { replayNamespaceDiagnosticLog } from './diagnostic-replay.js';
export type { DiagnosticReplayResult, DiagnosticReplayIssue, ReplayNamespaceDiagnosticLogRequest } from './diagnostic-replay.js';
export type { DiagnosticsConfig, DiagnosticsRetentionConfig } from './config.js';   // AppConfig.diagnostics 的类型可达性
```
（`parseAppConfig`/`AppConfig` 既有导出自动携带新可选字段。）

### §5.8 `apps/yjs-server/package.json`

`dependencies` += `"@nomicore/namespace-diagnostic-log": "workspace:*"`（File adapter / strict reader / 物化原语 / 类型）。

---

## §6. 合规性分析

### §6.1 write-slot 纪律（ADR-0012 amendment，点名本票）——emit 调用点全清单

| # | emit/同步 fs 调用点 | 执行位置 | slot 判定 |
|---|---|---|---|
| 1 | create 槽 emit（#150 既有结构；R1 路由改造：`:1298/…/:1409/:1906/:1916` 走共享无归属通道，`:1428/:1438` 改 `emitStreamOutcome(ns)` 数据键控解析） | Registry lifecycle create slot（公共入口同步段 / createDoc 后同步续段） | Runtime sequencer 尚不存在/从未进入——#150 冲突报告 #1 已裁决合规；R1 只改**路由**，emit 位置/槽位零变化 |
| 2 | `initStream` → File adapter 构造（mkdir / manifest `'wx'` / genesis append / current.json rename + reopen 健康分析 O(stream) + **构造期 retention sweep**：目录枚举 + 每闭组 stat + 可能批量删除闭组——#154 内建 `sweepOnOpen` 缺省 true（M3 补全），仅 ready 模式） | 同上（create 槽）/ Registry open/import 槽 | Runtime sequencer 不存在——#153「构造期纪律」合规落点（§1.3/§5.2-D3/M3） |
| 3 | root-mutation / schema-replacement / replication-enable / replication-epoch-bump emit（#149，既有 emitSlot） | 公共方法 `.then` 回调——write sequencer slot **已释放后** | 本票只注入 emitter，槽体零改动；同步 File append 发生在 slot 外 ✅ |
| 4 | replication-apply emit（#151，既有） | apply 槽 `.then` | 同上 ✅ |
| 5 | 丢弃计数事件（sink NDJSON：`unattributed` 共享通道 / `stream-unavailable`·`manager-closed` 丢弃桩） | `binding.emitter` / `runtimeEmitterFor` 丢弃桩内同步 | 不在 Runtime slot（只被 Registry create 槽 / factory 构造 / manager 解析调用）✅ |

**结论：本票不新增任何位于 NamespaceRuntime write sequencer slot 内的同步 File adapter `emit`/fs 调用点；新增代码只做「emitter 运送」与「slot 外工具读取」。**

### §6.2 数据面隔离（AC1）——结构性论证

- 管理器/adapter 从不接触任何 Y.Doc、DocHandle、lease、persistence 引用——只接收语义 emission 与 bytes → **不可能**写 SCHEMA/META/ROOT。
- snapshot bytes（ADR-0006：`Y.encodeStateAsUpdate` 三条目）与日志目录（`{logRoot}/namespaces/…`）物理分离；策略标记（`updateCapture`/`inputPolicy`/`diagnostics`/`logRoot`）无任何路径进入 doc 编码——E1 的 bytes 断言由结构保证，非过滤保证。
- 复制 wire：ws-replication 零改动（DENY）；诊断配置不进入任何 HELLO/OPEN/bootstrap/reconcile 帧。
- hub/peer 独立启用：配置 per-process 本地解析；peer 不带 `diagnostics` → 无 manager → Registry 无 `diagnosticLog` → 零日志行为（E5 peer 面零改动语义）。

### §6.3 多 generation 单 writer（AC3）

- 进程内：`Map` 缓存对象同一性（D3）；Registry entry 更替（idle close → reopen → 新 Runtime generation）不重建 adapter。
- 跨进程：current.json 续写（#153 resume 语义）；E5 断言 streamId 不变 / 恒 1 stream / sequence 连续 / genesis 首位——由 adapter 既有行为承载。
- 术语纪律：AC3 的 "Runtime generations"（ADR-0009 close→reopen）≠ AC2 的 stream generation（ADR-0012-LOG rotate）——本设计全程分用。

### §6.4 失败隔离矩阵（E4 等；R1 修订 C1/m1——行与丢弃词表一一对应）

| 故障 | 作用点 | 业务面后果 | 可观测 |
|---|---|---|---|
| logRoot 指向普通文件（E4） | adapter 构造 mkdir ENOTDIR → mode disabled（**构造不抛、disabled adapter 正常缓存**） | create/open/read 照常（emitter 按 mode 静默丢弃） | `diagnostic-log`/`storage-write-failed{stage:'manifest'}` NDJSON（构造期） |
| adapter 构造 throw（结构性不可达） | ensureAdapter catch | 该 ns 无日志（不缓存） | `diagnostic-log-manager-failed` |
| `runtimeEmitterFor` 违约 throw/畸形 | Registry 解析器 / `emitStreamOutcome` 边界 catch | 该 Runtime 无诊断 / 该条 emission 丢弃 | （无通道——D11/i1 备案，同 #150 no-op 先例） |
| emit 期磁盘满/EISDIR | adapter 事件（`storage-write-failed`/`pipeline-crashed`） | 业务返回值不变（producer 吞没 + adapter 门） | NDJSON 健康事件 |
| **并发 create 交错：B 的 createDoc 失败 emission（C1 场景）** | `emitOutcome` → `binding.emitter` 无归属通道 | **丢弃（绝不写入 A 的流——R1 数据键控归因）**；A 的 replay 仍 complete/issues=[] | `diagnostic-log-emission-dropped{unattributed}` |
| 无归属 create 前置失败 emit（acceptance/identity/validation/persist 拒绝） | 同上 | 丢弃（D4 显式裁决：不发明归属） | `diagnostic-log-emission-dropped{unattributed}` |
| initStream 后解析未命中（结构性不可达） | `runtimeEmitterFor` 丢弃桩 | #17/#18 丢弃 | `diagnostic-log-emission-dropped{stream-unavailable, namespaceId}`（与 unattributed 可区分——接线回归不被 generic 计数掩盖） |
| 停机迟到 emit | `close()` 后：`binding.emitter` / 丢弃桩 | 丢弃 | `diagnostic-log-emission-dropped{manager-closed}` |

### §6.5 数据保护（ADR-0011 §E）

- `inputPolicy` 缺省 `'digest'`、`updateCapture` 缺省 `false`——`full`/`true` 均需操作员显式配置（Host 明确启用条款）；JSDoc 注明 logRoot 须继承 namespace 数据同级或更严的访问控制/保留期（运维责任面，config 校验不做文件系统权限推断）。
- 健康事件字段白名单 = 包冻结面（§4-D8）；无 metrics label 消费。replay 工具返回 owned bytes 副本，不暴露 live Y.Doc（构造局部 `new Y.Doc()`，函数返回即不可达）。

---

## §7. 验证映射与风险

### §7.1 AC ↔ 设计条款

| AC | 条款 |
|---|---|
| AC1 | §5.1（配置面）+ §5.2/§5.3（启用接线）+ §6.2（隔离）+ D4（创建起：initStream 于 createDoc 后、factory 前） |
| AC2 | D2（冻结/可调落点）+ §5.1（retention 语义）——rotate 机制 = #153 既有（R10 锚） |
| AC3 | D3（单 writer）+ D7（有界 drain）+ §5.3（停机挂点） |
| AC4 | D9/D10 + §5.6（strict/genesis/连续/owned/不拼接/detached） |
| AC5 | D9 语义表 + D12 词表 + disclaimer 承载裁决 |
| AC6 | E1–E5 逐条：E1=provision→initStream+emitStreamOutcome(ns)+runtimeEmitterFor（replication-enable）+snapshot bytes 隔离；E2=verify-write/replace-schema 经 Runtime diagEnv；E3=SIGTERM 30s exit 0 + 停机后 strict ok；E4=构造失败隔离；E5=跨进程续写 + peer 不启用 |

### §7.2 E2E 依赖的既有契约（SA6 注记 3 的复核结论）

E5 的 hub 重启/peer 收敛编排与既有 T6（`hub-restart-static-target-red.test.ts`）同款原语；日志接线为纯增量（新 manager/新第三参），不改 hub 重启语义——若绿灯期发现交互出入，属实现缺口归 SA3（SA6 已备案）。

### §7.3 风险与缓解

| 风险 | 缓解 |
|---|---|
| ~~dispatcher 同步窗依赖 #150 的同步续段事实~~（R0 风险——C1 修订后**类别消灭**：`bound`/关窗微任务已删除，归因 = 调用点静态分类 + namespaceId 查表，不依赖任何时序事实） | D4 论证 1–3；SA2 构想的验证路径（绿灯期可测）：单元——initStream(ns-a) 后直接 `binding.emitter.emit(B)` → 断言不落 ns-a 流 + `unattributed` 计数；集成——并发 `Promise.all([create A, create B])` + B 的 createDoc 注入 `DocCreateOperationalError`（settle 晚 A 一拍）→ A 流无 B attemptId、A replay complete/issues=[] |
| mid-genesis 篡改流伪 complete（R0 盲区——M2） | §5.6 ④ `attemptSeen` 并入 `genesis-misplaced` 触发；防过度矫正锚：健康流 R1/R2/R10 照常 complete（`attemptSeen=false`） |
| open 槽内 adapter 构造的 strict 健康分析 + 构造期 retention sweep 成本（大 stream 重启变慢；M3 补全） | 每 ns 每进程恰一次 × 两遍（健康分析 O(stream) + sweep O(闭组数)）；#150 §8.5 成本声明同款；备案为已知代价（非阻塞）；操作员可经 retention 双 null 归零删除 |
| replay 对活跃 writer 的并发一致性 | reader 契约本就面向静态流（reader.ts §4.3 声明）；工具 JSDoc 注明离线使用 |
| 第三参签名演进破坏 internal seam 冻结 | 值导出键集不变（seam 测试 :118 锚）；可选参向后兼容；§12 caller 审计全列 |
| SA4 scope 比对 | §10 ALLOW/DENY 精确到文件 |

---

## §8. 非目标（显式备案）

1. **不实现异步 writer queue / batch / fsync**（ADR-0012 amendment 被否条款；首切片纪律）——AC2/AC3 相关措辞按目标态语义由「retention 可调 + O(1) drain」承载。
2. **不暴露** inline threshold / line 上限 / roll targets / payloadMax / sweepOnOpen 配置键（D2；R1 修订 M3——**后果明示**：`sweepOnOpen` 不暴露 ⇒ #154 内建缺省 true ⇒ 每次 adapter 构造（每 ns 每进程）执行一次 retention sweep（目录枚举 + 闭组 stat + 可能删除闭组；仅 ready 模式，见 §5.2/D3/§6.1 #2）。操作员杠杆：`retention` 双 `null` → 删除行为归零（仅剩卫生遍历：orphan BIN / 遗留 `.deleting`）；`enabled:false` → 整面关闭；**完全跳过遍历不可达**——不新增配置键、#154 内建执行面原样消费，暴露的 retention 限值因此保持真实生产语义（每 ns 每进程构造时懒执行），而非静默 no-op）。
3. **不新增**控制通道 diagnostics op、REST 管理面、metrics 导出（D8）。
4. **不实现** Host 数据删除请求 → `deleteNamespaceDiagnosticLog` 联动（app 当前无数据删除面；ADR 条款待相应票）。
5. **不改** SA6 测试断言；**不动** ws-replication / persistence / doc-runtime / vfsl（DENY）。
6. **不给**被拒 create 的无归属 emission 发明归属（D4 裁决：丢弃 + `unattributed` 计数）。

---

## §9. SA2 反馈逐条回应（R1 修订汇总表——对应 `…_sa2_review.md` 2026-09-02 reject 判决）

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| **C1**（CRITICAL）：D4「永不误归因」被击穿——微任务 FIFO 只按入队序，B 的失败 emit 可写入 A 的流；要求消灭全局 `bound` 时序状态、Registry 侧局部持有 ns-bound emitter、initStream 前失败走恒丢弃+计数通道、重写正确性论证、更新 D4/§6.4/P4 | ✅ | §4-D4 全文重写；§3 图；§5.2；§5.4；§6.1 #1/#5；§6.4；§7.1/§7.3；§11-P4；§12 | 首选方案落地：`bound`/关窗微任务/dispatcher 全删；`CreateDiag` += `emitStreamOutcome(ns, observedAt, e)`（registry.ts 恰 `:1428/:1438` 两点改调），每次调用以 namespaceId **数据**现场解析 ns-bound emitter（经 `runtimeEmitterFor` seam）；`binding.emitter` 降格为无归属通道（恒丢弃+`unattributed`）。正确性论证重写为「归因键是数据不是时间」（D4 论证 1–3：C1 交错时序重跑——B 的失败 emit 静态走共享通道，结构上不可能触达 A 的 adapter；未来插入 await 场景从「fail-safe 丢弃」升级为「仍正确落流」）。§6.4 补 C1 场景行；P4 风险降级 |
| **C1 附加要求**（错误处理链路审查）：「成功 create 的 #17 记录被丢弃」须与「无归属前置失败丢弃」可区分 | ✅ | D4 论证 4；D8；§6.4 | 三类可区分原因：`stream-unavailable`（解析未命中，**携 namespaceId**）/ `manager-closed`（停机）/ seam 违约静默（D11，不可达）——与 `unattributed` 互斥 |
| **M1**：§5.6 仅收敛 ENOENT 与 JSON/形状/文法，`readFileSync` 的 EACCES/EISDIR/EPERM/EMFILE/EROFS 直接 throw，违背「绝不抛」 | ✅ | §5.6 ① + 收敛映射表；D12 | ① 增 fs errno 收敛：ENOENT → `locator-missing`；其余 errno → **新码 `locator-unreadable`**（并入 D12 词表，依据 = strict reader 不抛契约的工具侧对称）；另加顶层 catch-all → **新码 `replay-internal-error`**（结构性不可达，防御深度）；明示完整收敛映射表（8 行） |
| **M2**：`genesis-misplaced` 触发条件盲区——`[update(乱序…), genesis, …]` 前缀被跳过、连续性从未校验，可伪 complete；SA8 边界审视 6 未吸收 | ✅ | D12 `genesis-misplaced` 行；§5.6 ④（`attemptSeen`）；D9 表新增 M2 构想行 | 采纳 SA8 建议一：触发条件并入「存在前置 attempt 记录」（`attemptSeen` 在 attempt 分支首行置位——无论该条后续被跳过/停止）；mid-genesis 永远到不了合法基线分支 → `genesis-misplaced` + applied=0 → failed。防过度矫正锚：健康流 genesis 恒首位、`attemptSeen=false`，R1/R2/R10 照常 complete（§5.6 防过度矫正核对）。SA8 边界审视 6 = **吸收** |
| **M3**：构造期默认 retention sweep 未备案（§6.1 #2 漏列 / D3 漏第二遍 IO + 删除副作用 / 操作员无法关闭）——二择一写进设计 | ✅ | D3 成本注记（M3 补全）；§5.2 构造期同步 fs 全清单；§6.1 #2；§8.2；§11-P8 | **裁决：备案默认 true**（manager 不传 `sweepOnOpen`，#154 内建原样消费）。理由：(a) #154 已内建并测试（T-A7）；(b) 暴露的 retention 配置保持真实生产语义——恒传 false 会造成静默 no-op 配置面（诚实性缺陷）；(c) 删除安全约束 #154 内建。被否替代（恒传 false）已记录。§6.1 #2 补全「构造期 sweep（目录枚举+闭组 stat+可能批量删除）」；D3 补第二遍 IO；§8.2 明示操作员杠杆（retention 双 null 归零删除 / enabled:false 关闭 / 不可跳过遍历） |
| **m1**：丢弃词表三值 vs D4 伪代码两分支、§5.2 文字矛盾（initStream 构造失败实际产出 `unattributed` 而非 `stream-unavailable`） | ✅ | D8；§5.2；§6.4 | C1 方案下矛盾**结构性消失**：三值各有唯一产生方（D8 逐值列出产生方+可达性）——`unattributed`=共享通道；`stream-unavailable`=`runtimeEmitterFor` 丢弃桩（**注**：E4 走 disabled-adapter 缓存路径不落此分支，D8 已明示）；`manager-closed`=close 后两通道。§5.2 伪代码与 D8/§6.4 三处逐字一致 |
| **m2**：④ 各分支 `stopped=true; continue` vs 循环尾「停止迭代」歧义；record 级 issue 透传截止无定义 | ✅ | §5.6 ④ | 停止分支一律 **break**（非 continue）；record 级 issue 透传在停止点**截断**（停止点后 entry 级发现不进 issues）；stream 级（③）全量透传。R6 变体（垃圾行后再置损坏行）由此确定：仅垃圾行自身 invalid-json 透传 |
| **m3**：`join(rootDir,…)` 在 reader 安全门之前，`namespaceId:'../../…'` 可使 readFileSync 逃逸 rootDir | ✅ | §5.6 前置门；D10；D12 `locator-missing` 行；§10 index.ts 条目 | ① 前置 `isSafeNamespaceId`（包内 `paths.ts:24` 单源原语，经日志包 index 增量 re-export——与 `reader.ts:394` 安全门同一实现，**零双源**）；违规 → `failed{locator-missing}`、零 fs 触达。SA8 边界审视 5（locator 第三消费点）= **吸收**（以单源导出而非 app 复刻文法回应） |
| **i1**：D11 resolver 违约静默无通道（建议可选加一跳 NDJSON 计数；备案不阻塞） | ✅（备案） | D11 维持；§6.4 违约行 | 维持备案：Registry 包无 NDJSON sink（app 级面）；经 registry observer 扩事件词表 = 公共观察面增长，超出「可选建议」收益；#150 no-op 先例对齐 + 唯一生产供应方构造性良构（§5.2 丢弃桩/缓存路径全覆盖）。不阻塞 |
| **i2**：`registry.shutdown()` throw 时 `diagnostics.close()` 被跳过（同一 try 块）；实害为零 | ✅ | §5.3 | 幂等双保险：正序位置显式调用（顺序语义）+ 外层 `catch{…throw}` 扩为 `catch{…throw} finally { close() }`（幂等 O(1)，正序已关时零成本 no-op；throw 路径保证 closed 置位后才 rethrow） |
| **i3**：D9 R7 行预测正确但机制归因缺失（夹具不传 genesisUpdateBytes ≠ capture 抑制 genesis） | ✅ | D9 R7 归因注记 | 补归因：`file.ts:88` 明文 updateCapture 与 genesis **正交**；生产 capture=false 流**有** genesis → 首条 update-omitted 即 **partial**（非 failed）；SA3 不得把「capture=false ⇒ 无 genesis」当机制实现 |
| **复审程序 3**：SA8 边界审视 6（=M2）与边界审视 5（locator 第三消费点）须显式回应（吸收或反驳） | ✅ | M2 行 / m3 行（上文） | 边界 6 = **吸收**（attemptSeen 并入触发条件）；边界 5 = **吸收**（isSafeNamespaceId 单源增量导出 + 前置门） |
| **协议假设审查附注**：P4 缓解依赖 D4「永不误归因」论证——C1 修订后 P4 行必须同步重写 | ✅ | §11-P4 | P4 重写：事实保留（源码引用不变），**角色重定义**——R1 起归因正确性不依赖本事实（数据键控）；风险由「中」降「低」（插入 await 场景从丢记录变为仍正确落流） |

---

## §10. 文件清单（File Scope）

### ALLOW LIST

- `apps/yjs-server/src/config.ts` — 修改：`DiagnosticsConfig`/`DiagnosticsRetentionConfig` 类型 + 校验（violation path 粒度对齐 SA6 负例）+ 顶层白名单加 `diagnostics` + `AppConfig.diagnostics`（~90 行；§5.1）
- `apps/yjs-server/src/diagnostics.ts` — 新建：HostDiagnosticsManager（per-namespace adapter 缓存 / **无归属通道 emitter（C1：取代 R0 dispatcher 同步窗）** / initStream / runtimeEmitterFor（含 `stream-unavailable`·`manager-closed` 丢弃桩）/ 健康映射 / O(1) close）（~170 行；§5.2）
- `apps/yjs-server/src/diagnostic-replay.ts` — 新建：`replayNamespaceDiagnosticLog` strict 重放工具（含 **isSafeNamespaceId 前置门（m3）+ fs errno 收敛与顶层 catch-all（M1）+ attemptSeen/break 语义（M2/m2）**）（~220 行；§5.6）
- `apps/yjs-server/src/index.ts` — 修改：增量导出 replay 工具与类型（~15 行；§5.7）
- `apps/yjs-server/src/app.ts` — 修改：manager 构造 + registry plugin host 注入 + performStop 收口步骤（含 **finally 兜底 close——i2**）（~45 行；§5.3）
- `apps/yjs-server/package.json` — 修改：dependencies += `@nomicore/namespace-diagnostic-log: workspace:*`（§5.8）
- `packages/namespace-registry/src/types.ts` — 修改：`NamespaceRegistryDiagnosticLog.runtimeEmitterFor?` 增量可选成员 + JSDoc（~25 行；§5.4）
- `packages/namespace-registry/src/create-diagnostic.ts` — 修改：`createRuntimeDiagResolver` 非抛解析器（~40 行；§5.4）**+ R1 追加（C1）：`CreateDiag` 接口 += `emitStreamOutcome(namespaceId, observedAt, e)`（含 `NOOP_DIAG` no-op 增量）+ 构造期非抛读取 `runtimeEmitterFor` + 形状门/吞没私有共享 helper（~35 行；§5.4 C1 修订增量）**
- `packages/namespace-registry/src/registry.ts` — 修改：`RuntimeFactory` 类型增宽 + 三处 factory 调用点第三参（`:1211/:1420/:1557`）（~40 行；§5.4）**+ R1 追加（C1）：恰两处 emit 调用点改 `emitStreamOutcome(id.namespaceId, …)`（`:1428` #17 / `:1438` #18；其余 10 个 emit 点零改动）（~4 行；§5.4 C1 修订增量）**
- `packages/namespace-registry/src/plugin.ts` — 修改：工厂第二可选参 `host?: { diagnosticLog? }` + 透传（~20 行；§5.4；config 键集冻结不动）
- `packages/namespace-runtime/src/internal.ts` — 修改：`RuntimeForRegistryDiagnostic` 类型 + `createNamespaceRuntimeForRegistry` 第三可选参（~15 行；§5.5；值导出键集不变）
- `packages/namespace-runtime/src/runtime.ts` — 修改：`createNamespaceRuntime` 第三可选参 → seam input 条件展开（~10 行；§5.5；槽体/captureSeamInput 零改动）
- `packages/namespace-diagnostic-log/src/reader.ts` — 修改：`materializeStrictRecordUpdate` 增量函数（纯包内原语；既有函数零改动）（~80 行；§4-D10）
- `packages/namespace-diagnostic-log/src/index.ts` — 修改：增量 re-export 物化原语（既有导出一字不动）+ **R1 追加（m3）：`isSafeNamespaceId` 增量 re-export（`paths.ts` 既有导出原样转发，零新实现）**（~10 行）
- `apps/yjs-server/test/diagnostic-replay-host-lifecycle-red.test.ts` — `[SA6 owned]` SA6 已交付红灯契约。本设计逐字采纳其 PROPOSAL 面（D1/D9/D12 含子串锚）→ 预期零改动；仅在仲裁偏离时修订 import/gate 行，断言逻辑零改动。**R1 注记**：SA2 评审「红灯测试构想」（C1/M1/M2/M3/m1/m2/m3 各条）为绿灯期增补用例建议——若 SA6 采纳落进本文件或新文件，属 `[SA6 owned]` 范畴，ALLOW 随 SA6 交付记录追加，不由本设计预制。

### DENY LIST

- `packages/ws-replication/**` — 复制 wire/协议零改动（AC1「不写入 replication wire state」的结构保证）
- `packages/persistence/**` — snapshot 布局/内容零改动（AC1）
- `packages/doc-runtime/**`、`packages/vfsl/**`、`packages/vfsl-protocol/**`、`packages/vfsl-codegen/**`、`packages/instance/**`、`packages/clock/**`、`packages/replication-protocol/**` — 非本票面
- `packages/namespace-diagnostic-log/src/adapters/file.ts` — File adapter 已由 #152–#154 冻结；本票纯消费
- `packages/namespace-diagnostic-log/src/{schema,record,emission,pipeline,sink,carrier,frame,storage-gate,retention,read-session,health,paths,testing}.ts` — 冻结契约面（schema 指纹被 schema-freeze 测试钉死；health 词表冻结）；仅 reader.ts/index.ts 按 ALLOW 增量
- `packages/namespace-runtime/src/{write,schema-write,replication-write,replication-session,diagnostic,sequencer}.ts` — #149/#151 槽体已冻结；本票只注入 emitter
- `packages/namespace-registry/src/{lease,observer,identity,errors,create-document,index,testing}.ts` — 非本票面（index.ts 若因类型可达性需 re-export `NamespaceRegistryDiagnosticLog` 已有导出则零改动；如需增量由 SA4 比对时按 warning 处理）
- `apps/yjs-server/src/{main,lifecycle,transport,transport.ts}.ts` 与 `apps/yjs-server/src/transport/**` — 停机链/锁/传输零改动（D7：close 在 app.stop 内）
- `docs/adr/**`、`CONTEXT.md` — 决策冻结源
- `apps/yjs-server/test/**` 其余文件 — 既有契约测试零改动

---

## §11. 协议假设依据 (Protocol Assumption Evidence)

| # | 假设 | 依据类型 | 依据内容（具体引用） | 风险 |
|---|---|---|---|---|
| P1 | E2E 进程原语可用：`spawn(tsx main.ts)` 产出 NDJSON 生命周期事件（`provisioned`/`ready`）、stdin 控制通道 op（`read`/`verify-write`/`replace-schema`）一问一答、SIGTERM → 有序停机 exit 0 | 现有测试引用 + 源码引用 | `apps/yjs-server/test/hub-restart-static-target-red.test.ts:26-27,197-201,243`（同款 spawn/waitForEvent/signalAndExpectExit(SIGTERM,30s,0) 全绿先例）；控制 op 实现于 `apps/yjs-server/src/app.ts:456-488`（dispatch 表含 read/verify-write/replace-schema） | 低 |
| P2 | 日志目录布局 `{rootDir}/namespaces/{namespaceId}/current.json`（恰 `{format:'ndcl-current',version:1,streamId}`）可被工具直读 | 源码引用 + 现有测试引用 | 写侧 `packages/namespace-diagnostic-log/src/adapters/file.ts:901-915`（writeCurrent 恰三键）+ 读侧 `file.ts:244-267`（resolveResumeCandidate 同一物理契约消费）；SA6 红灯夹具 `diagnostic-replay-host-lifecycle-red.test.ts:309-319`（currentStreamId 直读同布局） | 低 |
| P3 | `createFileDiagnosticLog` 构造**不向调用方抛**（含 rootDir 为普通文件的 ENOTDIR 路径） | 源码引用 | `file.ts:289-294`（工厂契约「绝不向 Host 抛」）+ `file.ts:1444-1448`（构造级 crash 包络 catch → failed 模式）+ `file.ts:858-864`（mkdir 失败 → notify + disabled，不抛） | 低 |
| P4 | Registry create 成功路径 `initStream` 与 #17/#18 emit 在同一同步续段（零 await）。**R1 重写（C1 修订后角色重定义）：本事实不再是归因正确性前提**——归因由调用点静态分类 + namespaceId 查表决定（D4），与本续段时序无关；事实本身仍成立并支撑 §6.1 槽位合规论证与「initStream 先于 #17/#18 ⇒ 调用点分类完备」 | 源码引用 | `packages/namespace-registry/src/registry.ts:1417-1435`（`await createDoc` 之后：encodeDetachedState(1417) → initStream(1418) → factory(1420) → makeEntry → emitOutcome → return，catch 分支 #18 同步）；#150 设计 §7 DC-2 冻结该次序 | 低（R0 为「中」——降级：未来 Registry 在此处插入 await，R0 丢记录（fail-safe），R1 `emitStreamOutcome(ns)` 仍查表命中、记录仍正确落流） |
| P5 | strict reader 对 status='ok' 且 record ok 的条目，其 inline/sidecar 载荷已全量交叉校验（物化原语可直接解码） | 源码引用 | `reader.ts:529-566`（checkSidecar/validateInlineCarrier 全量校验后才推入 ok 记录）+ `storage-gate.ts:53,78`（共享原语） | 低 |
| P6 | `Y.encodeStateAsUpdate` 每次返回新分配 Uint8Array（owned 副本语义，R2 篡改断言） | 官方文档引用 + 设计期实测验证 | yjs API 契约（encodeStateAsUpdate 无共享缓冲返回）；SA6 夹具健全性探针已实证「重复调用稳定、篡改返回 bytes 不影响后续」（简报 §夹具健全性探针 7/7 PASS 记录） | 低 |
| P7 | File adapter reopen 在当前 config 与 manifest 冻结策略一致时续写同一 stream（E5 跨进程 sequence 连续的前提） | 源码引用 + 现有测试引用 | `file.ts:1390-1441`（locator→健康证明→resume lastCommittedSequence 续接）；SA6 探针「重启/同 rootDir 续写同 stream」及 #153 契约测试 | 低 |
| P8 | **R1 新增（M3）**：adapter 构造期自动 retention sweep 缺省启用——manager 只透传 `retention.{maxAgeMs,maxBytesPerNamespace}`（不传 `sweepOnOpen`）⇒ 构造完成即执行一次 sweep（仅 ready 模式；目录枚举 + 闭组 stat + 可能删除已关闭且无 lease 的 group） | 源码引用 + 现有测试引用 | `retention.ts:63-86`（`normalizeRetentionConfig`：input null/undefined 与对象缺省两条路径 `sweepOnOpen` 均默认 `true`）+ `file.ts:1455-1457`（`if (mode === 'ready' && sweepOnOpen) sweepNow(...)`，注释明示「#154 构造完成自动 sweep（sweepOnOpen 默认 true）」） | 低（删除安全性 #154 内建：闭组 + reader lease + 绝不删 open group；成本 O(闭组数)，D3 已备案） |
| P9 | **R1 新增（m3）**：`isSafeNamespaceId` 是包内单源安全文法原语，可直接增量导出供工具前置门消费（零双源） | 源码引用 | `paths.ts:24-36`（导出函数：非空/≠`.`·`..`/无 C0/C1 控制字符/无 `/``\`）+ `reader.ts:394`（`readStreamStrict` 用同一函数做读侧前置门——工具门与 reader 门同源）+ `paths.ts` 文件头（「writer/reader 共享；零 node:fs」） | 低 |

（无 HTTP/WS 端点行为假设、无端口占用假设、无第三方库默认行为假设——本设计零新端点、零新端口、零新依赖引入 app 之外的运行时行为。）

---

## §12. 契约改动连锁审计 (Contract Change Caller Audit)

### 改动函数/类型

| 函数/类型 | 文件 | 改动前契约 | 改动后契约 |
|---|---|---|---|
| `createNamespaceRuntimeForRegistry` | `packages/namespace-runtime/src/internal.ts:40` | `(handle, notifyDirty) => NamespaceRuntime` | `(handle, notifyDirty, diagnostic?) => NamespaceRuntime`（可选第三参；不传 = 行为逐字节不变） |
| `createNamespaceRuntime` | `packages/namespace-runtime/src/runtime.ts:578` | `(handle, notifyDirty) => NamespaceRuntime` | 同上（可选第三参） |
| `RuntimeFactory`（内部类型） | `packages/namespace-registry/src/registry.ts:370` | `(handle, notifyDirty) => any` | `(handle, notifyDirty, diagnostic?) => any` |
| `NamespaceRegistryDiagnosticLog` | `packages/namespace-registry/src/types.ts:713` | `{ emitter; initStream? }` | += `runtimeEmitterFor?`（增量可选成员；两参既有成员一字不动）。**R1 语义注（C1，类型零变化）**：`emitter` 成员的生产语义 = 无归属通道（恒丢弃+计数）——消费方 `createCreateDiag` 的读取方式/吞没边界不变 |
| `CreateDiag`（registry 包内部接口，非公共面） | `packages/namespace-registry/src/create-diagnostic.ts:41` | `{ emitOutcome; emitEarlyOutcome; initStream }` | **R1（C1）**：+= `emitStreamOutcome(namespaceId, observedAt, e)`（纯加法；`NOOP_DIAG` 同步 no-op 增量——缺席路径行为逐字节不变；既有三成员签名/吞没语义零改动） |
| `createNamespaceRegistryPlugin` | `packages/namespace-registry/src/plugin.ts:168` | `(config?) => Plugin` | `(config?, host?) => Plugin`（可选第二参；config 键集冻结不动） |
| `AppConfig` | `apps/yjs-server/src/config.ts:36` | 9 键 | += `diagnostics?`（可选；缺省 = 既有行为） |
| `parseAppConfig` 顶层白名单 | `apps/yjs-server/src/config.ts:552` | 9 键 | += `'diagnostics'`（此前该键被拒——正是红灯；非放宽既有键） |

**无 return→throw 改动、无同步→异步改动、无 catch 语义改动**——全部为「新增可选参数/可选成员/新增导出」的加法契约（`CreateDiag.emitStreamOutcome` 为包内部接口加法，`emitAttempt` 吞没内核复用——新成员的 emit 路径同样被吞没边界覆盖）。

### Caller 清单（`git grep` 实测；值导出/类型导出与测试夹具路径已归并）

| Caller | 文件:行号 | 是否 await | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---|---|---|---|---|
| Registry open 工厂调用 | `packages/namespace-registry/src/registry.ts:1211` | 否（同步调用） | 外层 `try { factory(...) } catch` 已有（open-runtime-construction fatal 路径） | N/A | 本票在此传第三参 `resolveRuntimeDiag(ns)`（解析器自带非抛边界 D11——违约 → undefined，factory 收到 undefined = 既有两参行为） |
| Registry create 工厂调用 | `packages/namespace-registry/src/registry.ts:1420` | 否 | 同上（create-runtime-construction fatal） | N/A | 同上 |
| Registry import 工厂调用 | `packages/namespace-registry/src/registry.ts:1557` | 否 | 同上（import-runtime-construction fatal） | N/A | 同上 |
| internal seam 唯一生产消费方 | `packages/namespace-registry/src/registry.ts:751`（factory 缺省绑定） | 否 | 经上述三调用点外层 catch | N/A | 可选参透传；两参调用（测试 override）不受影响 |
| `createNamespaceRuntime` 唯一生产 caller | `packages/namespace-runtime/src/internal.ts:44` | 否 | seam 构造栈自带 loud TypeError（成对校验，`runtime.ts:703`）——Registry 解析器已预滤形状，loud 分支结构性不可达 | N/A | 条件展开进 seam input；`captureSeamInput` 零改动 |
| `createNamespaceRuntime` 测试 callers | `packages/namespace-runtime/test/runtime-acceptance-fullchain.test.ts:589`、`runtime-acceptance-production-assembly.test.ts:80` | 否 | 测试自持 | N/A | 两参调用对可选参签名兼容，零改动 |
| `createNamespaceRuntimeForRegistry` 测试 callers | `packages/namespace-registry/test/{registry-create-diagnostic-red:683, registry-phase5-replication-red:488,725, registry-create.test:1613, registry-phase5-replication-session-red:1369, registry-create-diagnostic-sa7-dynamic:310,642}`、`packages/namespace-runtime/test/{runtime-registry-internal-seam:94,219, runtime-registry-internal-sa7-dynamic:51}`、type guard `runtime-registry-internal-type-guard.test-d.ts:49` | 否 | 测试自持 | N/A | 两参调用兼容；seam 值导出键集断言（`runtime-registry-internal-seam.test.ts:118-128`「恰两键」）不受类型新增影响 |
| `createNamespaceRegistryPlugin` 生产 caller | `apps/yjs-server/src/app.ts:198` | 否（工厂调用期） | boot 失败 → ready reject → main exit(1) 既有链 | N/A | 本票改为传第二参 host；不传路径 = 既有 |
| `createNamespaceRegistryPlugin` 测试 callers | `packages/namespace-registry/test/{registry-plugin, registry-sa7-rev1:382, registry-sa7-cordis:176,222,330,385, registry-sa7-phase5-dynamic:126, registry-phase5-replication-session-round2-red:533-581}`、`apps/yjs-server/test/third-party-composition-red.test.ts:40,76` | 否 | 测试自持 | N/A | 单参调用对可选第二参兼容，零改动（含 `not.toThrow` 断言组） |
| `parseAppConfig` callers | `apps/yjs-server/src/{index,main,app,config}.ts` + `apps/yjs-server/test/{app-config-red, diagnostic-replay-host-lifecycle-red, third-party-composition-red}.test.ts` | 同步 | main.ts 既有 config-error → exit(1) 链 | N/A | 加法键；`app-config-red.test.ts` 的 unknown-key 断言不涉 `diagnostics`（红灯证据即当前拒绝行为），无既有测试断言「diagnostics 必须被拒」之外的漂移 |
| **`diag.emitOutcome`（CreateDiag 既有成员）** | `packages/namespace-registry/src/registry.ts`：create 槽 10 点（`:1298/:1310/:1346/:1361/:1376/:1393/:1401/:1409` + 公共入口 `:1906/:1916`）——**R1 零改动点** | 否（同步） | `emitAttempt` 吞没 try 边界（既有） | N/A | 保持走构造期共享 emitter（= Host 无归属通道，丢弃+计数）；这些点全部位于各自 create 尝试 `initStream` 之前（静态分类，D4） |
| **`diag.emitStreamOutcome`（R1 新成员）** | `packages/namespace-registry/src/registry.ts:1428`（#17）/`:1438`（#18）——**仅有的两个调用点** | 否（同步，createDoc 后同步续段内） | `emitStreamOutcome` 自带 resolver try/形状门/吞没（§5.4）；外层 `emitAttempt` 吞没内核复用 | N/A（Registry create 槽自身在 `runCreateAttempt` 的 carrier 链内，异常由 `admitCreateAttempt` 绿尾吸收——既有结构） | 每次调用以 `id.namespaceId` 现场解析（C1 数据键控）；resolver 违约 → 静默丢弃（D11/i1） |
| **`diag.initStream`（CreateDiag 既有成员）** | `packages/namespace-registry/src/registry.ts:1418`（唯一调用点）——**R1 零改动点** | 否（同步） | 既有吞没 try（`create-diagnostic.ts:272-281`，SA4 R1 B1） | N/A | Host 侧签名/语义不变（`ensureAdapter(ns, bytes)` 建流+缓存）；R0「同步窗建立」职责已随 dispatcher 删除而消失 |

### 风险评估

- **遗漏 caller 的代价**：可选参/可选成员契约下，未更新的 caller 保持既有两参/单参行为（零运行时差异）——本类加法契约的漏改后果 = 「该处不启用诊断」，非崩溃面。`emitStreamOutcome` 若有遗漏调用点（不存在——`grep "diag\." registry.ts` 实测 emit 点恰 12 + initStream 1，全部归类见 caller 表），后果 = 该点继续走无归属通道（丢弃可观测），非误归因。
- **抓全 caller 的方法**（已执行）：
  ```bash
  git grep -n "createNamespaceRuntimeForRegistry\s*(" -- 'apps/**/*.ts' 'packages/**/*.ts'
  git grep -n "createNamespaceRegistryPlugin\s*(" -- 'apps/**/*.ts' 'packages/**/*.ts'
  git grep -n "createNamespaceRuntime\s*(" -- 'apps/**/*.ts' 'packages/**/*.ts'
  grep -n "diag\.\(emit\|initStream\)" packages/namespace-registry/src/registry.ts   # R1 追加（C1）：CreateDiag 全调用点枚举
  ```
  生产 caller 恰各一处（registry.ts / app.ts / internal.ts）；其余为测试与 fixtures（`runtime/test/fixtures/registry-seam-audit-rev1/**` 为静态审计夹具，非运行时消费方）。CreateDiag 调用点实测：emit 12 点（10 保留 + 2 改 `emitStreamOutcome`）+ initStream 1 点（零改动）——与 §5.4/D4 清单一致。

---

*SA1 R1 完——C1/M1/M2/M3/m1/m2/m3/i1/i2/i3 逐条落实（§9 回应表），交回 SA2 R1 复审。*
