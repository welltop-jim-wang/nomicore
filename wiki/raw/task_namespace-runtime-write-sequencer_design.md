# 设计文档 — @nomicore/namespace-runtime：唯一 write sequencer 与 validated ROOT write（issue #90）

- 任务类型：feature（功能开发）
- 修订史：R1 初版（2026-08-24）→ **R2 修订（2026-08-24，落实 SA2 R1 reject 评审全部 5 个攻击点：#1 CRITICAL 公共类型 `MutateRootResult` 放宽 `issues: unknown[]`（D9 重写 + §7.2 逐文件核对表 + tsc 全绿门）；#2 CRITICAL snapshotter 数组分支增补 symbol 键/非枚举 own 键/accessor 下标三项拒绝与 descriptor-先于值读取次序（D3 重写）；#3 HIGH §7.2 方法论逐文件化；#4 MEDIUM 导出源统一 errors.ts；#5 LOW §6.2 #8 fatal 路径 notifier 停滞覆盖。差异段标注「R2 修订」）**
- 契约基准：ADR-0008「单一 write sequencer」「ROOT write 与 SCHEMA write（ROOT 子集）」「Fatal 与失败通道（ROOT mutation 部分）」「读取能力」节 + ADR-0007（写管线/零写入/observer no-rollback 继续有效条款）+ ADR-0006 #79 修订节（saveDoc/getStatus 契约）+ SA8 前置门禁 `clear`（Phase 0）+ **SA8 设计后复审 `clear`（2026-08-24，「设计引入的新决策点」7 条登记于 relevant_decisions 追加节——R2 修订不反转其中任何一条语义方向：#2 的拒绝侧增补是追加节第 4 条「拒绝侧细化」的同方向加强，无需回 SA8 复审）**（约束清单见 relevant_decisions）
- 前置交付（本 worktree HEAD= df22660 已含）：#89 Runtime 骨架七键 + 队首 P0 + sequencer FIFO 骨架；#87 `applyValidatedMutation` set-only 管线与 `DocRuntimeFatalError` committed-aware 契约；#79 persistence degraded 窗口语义
- 设计产出：本文件。SA3 按此实现 `packages/namespace-runtime/src/**` 与 `packages/doc-runtime/src/index.ts` 的恢复导出；SA2 评审攻击面即本文件。

---

## §0. 任务定位与交付边界

本任务在 #89 骨架之上交付 ADR-0008 的**写侧子集**：

1. **唯一 write sequencer 的真实写槽**：`runtime.mutateRoot(mutation)` 唯一公共 ROOT 写入口，同步接纳定序、严格 FIFO、notifier 屏障后释放槽；
2. **validated ROOT write**：槽内调用 `@nomicore/doc-runtime` `applyValidatedMutation`（set-only 现状）完成「检查当前 ROOT → 模拟 → 完整校验 → detached 构造 → 单事务提交」；
3. **fatal 与失败通道（ROOT 部分）**：窄结果联合（ok:false + issues，零写入）+ internal fatal 走 `RuntimeWriteFatalError` rejection（committed/phase 稳定字段）+ 永久关写保读；
4. **doc-runtime 公共面恢复导出**：`applyValidatedMutation` + 类型名目 `MutationIssue` / `ApplyValidatedMutationResult`（简报「关键上下文 3」，SA8 注记 N2 明确属本任务范围）。

**延后项（后续 issue，本设计只留扩展位，不预写形状——SA8 注记 N1）**：

| 延后项 | 本任务的态度 |
|---|---|
| `replaceSchema`（SCHEMA write） | 不实现。槽体七步序对 SCHEMA write 同样适用（ADR 原文「每个真正写任务」），mutateRoot 槽即该序的首个真实实例；schemaWrite 能力位已在 #89 status 投影中就位，不动 |
| `close()` barrier | 不实现。lifecycle 恒 `'ready'`；写槽 S1 lifecycle gate 是扩展位（v1 只判 fatal） |
| 公共事件订阅 / 队列进度观测 | 不实现（ADR：v1 无公共事件订阅，队列进度属日志/metrics/trace） |
| Registry / 生产构造器出口 | 生产工厂 `createNamespaceRuntime` 仍保留包内不导出；本任务仅为其补 notifyDirty 绑定参数（§4 D6.3） |
| validated mutation 其余三操作（delete/array-insert/array-delete） | `applyValidatedMutation` set-only 现状直通——未知 op 由其 A3 领域单 issue 拒绝（SA8 注记 N3） |

**禁止事项**：不引入绕过 sequencer 的 Y.Doc 写旁路（AC5）；不在 src 运行时代码内置 schema 文本（ADR-0001）；不实现 SCHEMA write/close/事件订阅；不修改 doc-runtime 管线实现（mutation.ts 契约已冻结，本任务只动其 index.ts 导出面）。

---

## §1. 契约来源与现状盘点

### 1.1 ADR-0008/0007/0006 条款 → 本设计消费映射

| ADR 条款（摘） | 本设计落点 |
|---|---|
| 「同一 namespace 内所有受控 Y.Doc 写共享唯一严格 FIFO write sequencer；v1 公开两个窄方法：`runtime.mutateRoot(mutation)`…」 | D1（八键公共面 + mutateRoot 接纳语义）、D7（sequencer 泛化） |
| 「写方法调用时同步决定接纳顺序。输入引用在排队期间可以变化；任务取得槽后立即用受控 snapshotter 复制并递归冻结 plain data，之后编译、校验、构造和提交只使用该内部快照。snapshotter 只接受 primitive、finite number、null、plain object/array，拒绝 accessor、class instance、特殊对象、symbol key、循环引用及其他非 plain data」 | D3（受控 snapshotter：对象/数组**两分支**全覆盖拒绝规则——R2 修订补齐数组分支 symbol 键/非枚举 own 键/accessor 下标三查，与对象分支四查对齐；递归冻结 + defineProperty 写入纪律） |
| 「每个真正写任务的槽依次执行：lifecycle/fatal gate、`DocHandle.getStatus()` writable gate、输入快照、领域校验和 detached 构造、一次 Yjs transaction、`await notifyDirty()`，然后才释放给下一任务」 | D2（槽体 S1–S7，逐位对应；gate 段零输入访问 INV-W3） |
| 「`notifyDirty` 是由构造方绑定 `persistence.saveDoc(handle)` 的窄接缝；Runtime 不依赖整个 `DocPersistence`。成功只表示 live commit 与 dirty notification 已登记，不表示已经落盘」 | D6（seam 扩展 + 生产工厂绑定 + 完成信号语义） |
| 「`persistence-degraded` 阻止 ROOT…写；它不阻止 read 或不写 Y.Doc 的 P0。gate 是瞬时观察：检查后才发生的降级不撤销已提交事务，dirty notification 仍必须登记最新 live doc」 | D2 S2（瞬时观察）+ §6.2 #12（检查后降级：提交 + 登记不撤销） |
| 「ROOT write 依赖 active schema tools。没有可用 schema 时零写入失败；…按 ADR 0007 的 validated mutation 管线检查当前 ROOT、模拟并校验完整 proposed ROOT、detached 构造并单事务提交」 | D4（执行时 active schema 绑定）+ D2 S4/S5（unavailable 零写入失败 + applyValidatedMutation 唯一写入口） |
| 「ROOT write 在自己的槽开始时使用当时 active schema；它不绑定调用时 schema generation」 | D4（FIFO 结构性保证：写槽必在 P0 结算后启动） |
| 「读取只观察调用瞬间已经提交的 live Y.Doc，不等待已接纳但尚未提交的写。调用方需要 read-your-write 时必须先等待对应写 Promise」 | INV-W10（读取面零改动——#89 交付已满足，本任务以测试锁定） |
| 「普通、可预期且零写入的读取或写入失败使用领域化结果联合；ROOT mutation…使用…独立的窄 issue 类型」 | D9（`RootMutationIssue` 构造侧窄名目 + `MutateRootResult` 联合——R2 修订：公共联合 issues 放宽 `unknown[]` 以兼容 SA6 冻结孪生，「窄」的落点是 ROOT 与未来 SCHEMA 各自独立、不合并巨型联合） |
| 「任何 internal fatal——无论 committed 与否——都永久关闭该 Runtime 的全部写能力并保留读取：`committed:false` 不调用 dirty notifier；`committed:true` 或未知异常保守视为可能已提交，在当前槽内 best-effort `notifyDirty()`，但始终 reject 原始 fatal；不补偿、不 fallback、不声称 rollback；post-commit fatal 以带 `committed:true` 的稳定 `RuntimeWriteFatalError` reject…；已排队的后续写仍按 FIFO 取得槽，且不访问输入、零写入返回 `RUNTIME_WRITE_DISABLED`」 | D5（fatal 分类表 + `RuntimeWriteFatalError` 形状 + best-effort 恰一次预算 + 永久关写 + 队列不毒死） |
| ADR-0007：「`applyValidatedMutation(derived, doc, mutation)`：同步完成当前 ROOT 结构/逻辑检查、…detached 子树构造和单次 Yjs transaction」「成功只返回 `{ ok:true }`」「零写入承诺覆盖所有验证失败和 detached 构造失败」「NamespaceRuntime 将来按 namespace 串行化所有业务写入：轮到 mutation 时先检查 writable gate，同步调用 `applyValidatedMutation`，成功后立即调用 persistence `saveDoc` 标脏」 | D2 S5/S6（槽体即该条款的逐句直译；本任务恢复其公共导出兑现「公共入口」名目） |
| ADR-0006 #79：「saveDoc 是 mutation 后的 dirty notification：…entry 处于 `persistence-degraded` 不构成拒绝理由」「gate 检查通过后才转为 degraded 的 mutation…其内存事务保留、saveDoc 正常登记」「`getStatus()` 只表示调用瞬间状态」 | D6（notifier 语义）+ §6.2 #12/#13（degraded 窗口行为） |

### 1.2 前置交付消费面（已核实源码，本设计只读消费）

- `@nomicore/doc-runtime`：
  - `applyValidatedMutation(derived, doc, mutation): ApplyValidatedMutationResult`（`mutation.ts:68-86`）——⓪ E202 裸 Error（tx-guard，一切 catch 之外）→ (A)–(G½) 唯一 try/catch（领域失败 ok:false / 敌意数据 E205 ok:false 类 B 分级 / 派生物畸形 E204 committed:false branded throw）→ (H) `transactGuarded` 单事务（observer 逃逸 → E203 committed:true）→ (I) `verifyInstall`（E201 committed:true）；(H)(I) 物理位于一切 catch 之外。**当前未从 index.ts 导出**（commit 21b0eed 下架）——本任务恢复（§4 D8）。
  - `DocRuntimeFatalError { committed: boolean; phase: 'observer-cleanup-throw' | 'post-commit-verification' | 'pre-commit-internal' }`（`fatal.ts:26-41`，已导出）——只携带事实，不做任何 Runtime 层动作（W4 契约：分类权归 catch 位置）。
  - `readLogicalValueAtPath(doc, path)`（#86/#89 已消费，零变化）。
  - 管线内部事实（写槽设计的依赖）：(E) `cloneJson` 只克隆 extract 产物，调用方 value 以引用直落 proposed；(G) `buildTopEntries` → `copyJsonDomain` 对 plain object/array **构造全新容器**（`detached-build.ts:185-212`，INV-7 引用隔离 + defineProperty 安全写入）——即**递归冻结快照值流入 doc 存储前必被克隆为全新可变普通值**，冻结不外泄、不影响持久化编码（§12 #6）。
- `@nomicore/vfsl`：`compileSchemaEnvelope` / `DerivedSchema` / `SchemaEnvelope` / `CompileSchemaEnvelopeResult`（#89 已消费，零变化）；`state.activeTools.derived` 即 P0 安装的编译产物引用。
- `@nomicore/persistence`：`DocHandle { owner, docId, doc, getStatus(), release() }`、`saveDoc(handle): Promise<void>`（degraded 不构成拒绝理由；仅 foreign/released 拒绝——`lifecycle.ts:216-229`）、`createMemoryPersistence`（测试设施）。零变化，纯消费。

### 1.3 SA6 冻结契约归纳（四测试文件的可观测锚点，SA3 只可补充不可收窄）

**`packages/namespace-runtime/test/runtime-mutate-root-sequencer.test.ts`（12 用例，AC1–AC9）**：

| 锚点 | 出处（行） |
|---|---|
| `typeof runtime.mutateRoot === 'function'`；`entry['mutateRoot'] === undefined`（runtime 面方法，非模块级导出） | 294-296 |
| 成功：`toEqual({ ok: true })`、恰 1 次 update 事件、state 字节变化、read-your-write（await 后读到新值）、notifier 恰 1 次 | 300-311 |
| FIFO：A 提交后 notifier 挂住 → A 的 Promise 未 resolve、B 不执行（read 仍见 A 值）；放行后 A、B 依序 resolve；notifier 计 2；最终值为 B 的 | 314-359 |
| 单项校验失败：ok:false + issues（message:string / path:array）+ 0 事件 + 字节不变 + 0 notifier + 后续写照常成功 | 361-404 |
| fatal gate（P0 compile throw 注入）：ok:false + `RUNTIME_WRITE_DISABLED`（JSON.stringify(issue) 含该码）+ **输入零访问（Proxy 计数 0）** + 0 事件 + 字节不变 + 0 notifier + 读取保留 + 再次写仍 settle disabled | 406-449 |
| degraded（真实 persistence 降级后构造）：P0 照常 ready、`rootWrite.enabled false`、`read.enabled true`；写被拒（disabled + 零访问 + 零写入 + 0 notifier + 读取保留） | 451-496 |
| 检查后降级（notifier 内翻转 fake handle 状态）：第一笔 ok:true + 1 事件 + 新值可读 + `rootWrite.enabled` 转 false；第二笔 disabled + 零访问 + 无新增事件 + 字节不变 | 498-534 |
| 快照时点：p0Gate 挂住期间 `mut.value = 999` → 槽开始快照获胜（读到 999，非调用时 7） | 536-558 |
| 非_plain 输入（class instance / symbol key / circular / NaN / function / 信封为 primitive 42）：resolved ok:false + issues ≥1 + 0 事件 + 字节不变 + 0 notifier + 读取保留（**输入缺陷属普通领域失败，不升格 internal fatal**） | 560-600 |
| preparing 期接纳：p0Gate resolve 后按已安装 schema 成功提交；`schema.state === 'ready'` | 602-625 |
| schema-unavailable（注入 compile ok:false）：ok:false + issues ≥1 + 0 事件 + 字节不变 + 0 notifier + 读取保留 + `schemaWrite.enabled === true` | 627-663 |
| fatal committed:true（ROOT observer throw 注入）：pA **rejected** + `reason instanceof entry['RuntimeWriteFatalError']`（值为构造器函数）+ `committed === true` + `phase` string + notifier 恰 1 + 提交值保留（read=9）+ `status.fatal` 非 null（code/message string、无 stack/cause 键）+ rootWrite/schemaWrite false + read true + 已排队 pB 仍 FIFO 取槽（resolved disabled + disabled 码 + 输入零访问 + 零写入） | 665-724 |
| fatal committed:false（seam 注入畸形 derived——P0 最小形状守卫放行、写槽内暴露 E204）：rejected + `committed === false` + phase string + 0 notifier + 0 事件 + 字节不变 + 写位全关 + 读取保留 | 726-775 |

**`packages/namespace-runtime/test/runtime-mutate-root-persistence.test.ts`（2 用例，AC7/AC10）**：seam 注入 `notifyDirty: () => writer.saveDoc(handle)`（生产绑定形态直译）；E2E：写 → saveDoc 登记 → debounce flush → **全新 Persistence 实例** loadDoc 读到写入值；degraded 全链：gate 通过后降级 → 提交 + 登记 → 后续写被拦（disabled + 字节不变）→ retry 覆盖 → 全新实例看到降级窗口前的写。

**`packages/doc-runtime/test/public-surface-guard.test.ts` + `public-surface-type-guard.test-d.ts`（SA6 已更新，2+2 用例）**：`applyValidatedMutation` 值导出存在且为函数；值导出面恰含此一个 mutation 入口（正则 `^applyValidatedMutation$` 唯一命中）；五项既有值导出仍在位；类型名目 `MutationIssue` / `ApplyValidatedMutationResult` 可导入（TS2305 机制）。

**#89 冻结五测试文件（本任务必须保持全绿）**：公共面禁键（doc/handle/docHandle/yDoc/sequencer/persistence）不出现、五读取方法同步、seam 构造形状（notifyDirty 为可选增广——五文件均未传，不可破坏）、`entry.createNamespaceRuntime === undefined`。**已核实无「恰七键」键数断言**（ownership 测试只查必需键存在 + 禁键缺席）——第八键 `mutateRoot` 增广合法。

---

## §2. 需求推演（Feature）：不变量清单

切入点唯一性判断：本任务**不新建包、不改任何既有函数的行为契约**，全部改动是（a）namespace-runtime 包内新增写槽模块 + 对既有模块的**加法式增广**（sequencer 泛化是签名放宽、seam 是可选字段、公共面是加键、index 是加导出），（b）doc-runtime index.ts 恢复两行导出（加法）。风险面集中在：**槽序时间线正确性、fatal 分级诚实性、快照隔离完备性、公共面封闭性延续**。

不变量（SA4/SA7 验收时可逐条对照；编号续接 #89 的 INV-N 系列）：

- **INV-W1（同步接纳定序）**：`mutateRoot(mutation)` 调用**同步**把槽链入 sequencer 尾（接纳顺序 = 调用顺序，与运行态无关）；调用本身不同步 throw、不同步结算（任何状态下调用都返回 pending Promise——含 fatal/degraded/unavailable，拒绝一律发生在槽内）。
- **INV-W2（槽序不可换位）**：S1 lifecycle/fatal gate → S2 writable gate（+notifier 绑定检查）→ S3 槽起点输入快照 → S4 执行时 active schema → S5 单事务管线 → S6 同槽 await notifyDirty → S7 槽释放。与 ADR-0008 槽序逐位对应，不可重排。
- **INV-W3（gate 段零输入访问）**：S1/S2 拒绝路径（fatal / 非 ready 状态 / notifier 未绑定）对输入对象**零属性读取**（Proxy get/ownKeys/getOwnPropertyDescriptor/has 全零）、零 Y.Doc 写、零 notifier 调用，settle `ok:false` 且 issues 含稳定码 `RUNTIME_WRITE_DISABLED`。
- **INV-W4（快照时点 = 槽开始）**：输入只在 S3 被读取一次，复制为**递归冻结的 plain-data snapshot**；S4 之后一切阶段只消费该内部快照。排队期间调用方对输入引用的任何后续变化不影响本任务（槽开始前的变化则会被捕获——快照时点是槽开始，不是调用时）。
- **INV-W5（执行时 active schema）**：槽开始时读取 `state.activeTools`（不绑定调用时 generation）。结构性保证：P0 是队首真实节点，任何写槽必在 P0 settle 后启动——preparing（无 fatal）在 S4 不可达；unavailable → 零写入 `ok:false`（SCHEMA write 仍可修复）。
- **INV-W6（单事务无旁路）**：槽内唯一 Y.Doc 写入口 = `applyValidatedMutation(derived, doc, snapshot)`，调用前后槽体零 Y.Doc 写旁路。成功写恰 1 次 Y.Doc update 事件；普通失败（ok:false）0 事件、state 字节不变、0 notifier。
- **INV-W7（notifier 屏障）**：事务成功后在**同一槽内** `await notifyDirty()`，resolve 后槽才释放（下一项才开始执行）；成功写 notifier 恰 1 次。完成信号语义 = live commit 与 dirty notification **两者已登记**（不含落盘）。
- **INV-W8（fatal 永久关写 + 队列不毒死）**：任何写槽 internal fatal → `state.fatal` 置位（冻结稳定摘要 `{code,message}`，不含原始 Error/stack/cause——INV-N7 延续；`fatalCause` 包内诊断锚点延续）+ `state.schemaState` 不变。后续（含已排队）写仍 FIFO 取槽：零访问、零写入、`RUNTIME_WRITE_DISABLED`；读取面不受影响。
- **INV-W9（fatal 双通道诚实）**：fatal 一律以稳定 `RuntimeWriteFatalError`（导出类，`committed: boolean` + `phase: 稳定字符串` + ES2022 `cause` 原样保留）reject，绝不收敛成 ok:false。`committed:false` → 0 notifier；`committed:true`（或未知异常保守 true）→ 当前槽内 best-effort notifyDirty **恰一次**（自身失败被吞没——原始 fatal 优先传播）；不补偿、不 fallback、不声称 rollback；上层不得自动重试非幂等写。
- **INV-W10（read 不进 sequencer）**：读取面零改动（#89 交付透传语义）；read 只观察调用瞬间已提交状态，不等待已接纳未提交写；read-your-write 由调用方 await 写 Promise 实现。
- **INV-W11（公共面封闭延续）**：公共对象变八键（+`mutateRoot`），禁键（doc/handle/…）仍不在 own/原型链任何层；`Object.freeze` 延续；`mutateRoot` 是 runtime 面方法而非模块级导出；index 新增值导出**恰一个** `RuntimeWriteFatalError`（instanceof 消费面）。
- **INV-W12（内部零 unhandled rejection）**：sequencer 链尾恒绿延续（#89 INV-N12）；槽 reject 只影响调用方持有的返回 Promise，队列链不因此断裂。

---

## §3. 包结构与模块职责

```
packages/namespace-runtime/
├── package.json         # 修改：版本 0.1.0 → 0.1.1（硬门禁 9）
├── tsconfig.json        # 不改（include 仅 src/**，#89 §7.1 决议延续；write.ts 落 src/ 自动入 tsc）
├── test/                # SA6 冻结七测试文件——本任务不改
└── src/
    ├── index.ts         # 修改：+RuntimeWriteFatalError 值导出 + errors.ts phase 类型导出 + write.ts 结果类型导出（§4 D8'/D9）
    ├── runtime.ts       # 修改：seam +notifyDirty 字段；WriteEnv 一次成型；公共面第八键；
    │                    #       生产工厂补 notifier 绑定参数（§4 D1/D6）
    ├── sequencer.ts     # 修改：enqueue 泛化 Promise<void> → Promise<T>（§4 D7，~10 行）
    ├── write.ts         # 新建：写槽 S1–S7 + 受控 snapshotter + fatal 分类/mark + 结果联合类型
    │                    # （RootMutationIssue/MutateRootResult；§4 D2/D3/D5/D9，~260 行）
    ├── errors.ts        # 修改：RuntimeWriteFatalError 类 + RuntimeWriteFatalPhase 类型【R2：同源声明于此】
    │                    # + 写 fatal 稳定 code/message + disabled 码常量（§4 D5/D9）
    ├── p0.ts            # 不改（P0 槽体/状态机零变化；写槽只读消费其 RuntimeState/activeTools）
    ├── status.ts        # 不改（fatal 公式已天然覆盖写 fatal：位值推导 !fatal 不区分来源）
    └── projection.ts    # 不改（读取面零变化，INV-W10）

packages/doc-runtime/
├── package.json         # 修改：版本 0.1.7 → 0.1.8（硬门禁 9）
└── src/index.ts         # 修改：恢复 export { applyValidatedMutation } + 两类型名目；头注释同步（§4 D8）
                          # mutation.ts 及其余 src 一律不改（管线契约冻结）
```

模块职责边界：`write.ts` 是写槽唯一实现（槽体/snapshotter/fatal 分类）；`errors.ts` 只登记类别与稳定码（延续「分类权归捕获位置」哲学——write.ts 决定分级，errors.ts 只承载形状）；`runtime.ts` 只做构造序与公共面组装（延续 INV-N14 单读纪律）。

---

## §4. 核心设计决策

### D1 公共面第八键与 mutateRoot 接纳语义（AC1 / INV-W1/W11）

```ts
// runtime.ts 公共面（#89 七键 + 第八键）
export interface NamespaceRuntime {
  /* …#89 七键原样… */
  /** 唯一公共 ROOT 写入口：同步接纳定序（FIFO 由调用顺序决定）；
   *  不同步 throw、不同步结算——任何拒绝（gate/校验/快照）都经返回的 Promise 结算；
   *  internal fatal 经 Promise rejection（RuntimeWriteFatalError）。 */
  readonly mutateRoot: (mutation: unknown) => Promise<MutateRootResult>;
}

// 构造尾（V3e 延续；writeEnv 见 D6.2）
const runtime: NamespaceRuntime = {
  /* …七键原样… */
  mutateRoot: (mutation: unknown): Promise<MutateRootResult> =>
    sequencer.enqueue(() => runRootWriteSlot(writeEnv, mutation)),
};
return Object.freeze(runtime);
```

- **同步接纳**：`enqueue` 在调用栈内同步拼接 `this.tail`（D7）——接纳顺序即调用顺序；返回的 Promise 即该槽完成信号（含结果联合值或 fatal rejection）。`enqueue` 与闭包构造均无可抛点（thunk 是纯调用——延续 #89 INV-N14：`runRootWriteSlot` 是 async 函数，**同步段永不 throw**，全部异常进入返回 Promise）。
- **参数类型 `unknown`**：与 `applyValidatedMutation` 公共入口同形状纪律（运行时校验信封，类型层不收窄——SA6 锚点「形状 `{ op:'set', path, value }`（与 applyValidatedMutation 公共入口同形状）」；A1–A5 信封校验单源在 doc-runtime 管线内，本层不重复）。
- **八键 vs #89 INV-N5**：不变量演进为「八键恰好 + 禁键缺席」（§1.3 已核实 #89 冻结测试无键数断言，增广不破绿）。`mutateRoot` 在任何状态下都可调用（含 preparing/fatal/unavailable/degraded）——接纳与执行分离，拒绝一律槽内结算（ADR「已排队的后续写仍按 FIFO 取得槽」的正面表述）。

### D2 写槽七步序（AC1–AC7 / INV-W2–W7）

```
runRootWriteSlot(writeEnv, input): Promise<MutateRootResult>   // write.ts，唯一写槽实现

  // ── S1 lifecycle/fatal gate（零输入访问）────────────────────────
  if (writeEnv.state.fatal !== undefined)
    return disabled('fatal 已置位（internal fault 已永久关闭本 Runtime 全部写）');
  //    [扩展位：lifecycle gate——v1 恒 'ready'，close 属后续 issue]

  // ── S2 writable gate + notifier 绑定检查（瞬时观察；零输入访问）──
  let handleStatus: DocHandleStatus;
  try { handleStatus = writeEnv.handle.getStatus(); }
  catch (err) { throw fatalOf('write-slot-internal', false, 'getStatus() 抛错（adapter 契约违背）', err); }
  //   adapter bug → 统一 fatal（committed:false——此时尚零 doc 写）；与 #89 D9「原样传播」的
  //   差异：那是同步读取面（调用方直接观测 adapter bug），这里是写槽（必须经 Promise 结算，
  //   统一 fatal 形状防止裸异常逃逸出结果联合之外的第二通道）
  if (handleStatus !== 'ready')
    return disabled(`DocHandle 状态 ${handleStatus} 不可写（persistence-degraded 阻止全部 Y.Doc 写；released/disposed 同拒）`);
  if (writeEnv.notifyDirty === undefined)
    return disabled('notifyDirty 未绑定——构造方必须绑定 persistence.saveDoc(handle)（ADR-0008 窄接缝）；'
                  + '无持久化绑定的 Runtime 拒绝一切 Y.Doc 写，杜绝「提交成功但永无 dirty 登记」的静默失信');
  const notifyDirty = writeEnv.notifyDirty;          // 单读捕获（此后不再读 env 字段语义）

  // ── S3 槽起点输入快照（本槽第一次也是唯一一次读取输入）──────────
  const snap = snapshotMutation(input);              // D3；拒绝 → ok:false（类 B：输入缺陷不升格 fatal）
  if (snap.kind === 'issue') return { ok: false, issues: [snap.issue] };

  // ── S4 执行时 active schema（不绑定调用时 generation）───────────
  if (writeEnv.state.schemaState === 'unavailable')
    return { ok: false, issues: [issue('SCHEMA_UNAVAILABLE: 无可用 active schema（P0 编译失败）——'
      + 'ROOT write 零写入失败；SCHEMA write 仍可修复', [])] };
  const tools = writeEnv.state.activeTools;
  if (writeEnv.state.schemaState !== 'ready' || tools === undefined)
    throw fatalOf('write-slot-internal', false,
      'schemaState/activeTools 不变量破坏（ready 必含 tools；preparing 必已被 P0 settle 或 fatal）', undefined);
  //   结构上不可达（D4）——loud internal fatal（拒绝虚假降级立法：正常系统该条件恒真，
  //   出现即包缺陷，不静默跳过、不伪 ok）

  // ── S5 领域校验 + detached 构造 + 单事务（唯一 Y.Doc 写入口）─────
  let result: ApplyValidatedMutationResult;
  try {
    result = applyValidatedMutation(tools.derived, writeEnv.doc, snap.value);
  } catch (err) {                                     // D5 fatal 分类（唯一 throw 通道）
    if (err instanceof DocRuntimeFatalError)
      return rejectWithWriteFatal(writeEnv, err.committed, err.phase, err.message, err);
    return rejectWithWriteFatal(writeEnv, true, 'unknown-pipeline-throw', errDetailOf(err), err);
  }
  if (!result.ok) return { ok: false, issues: result.issues };   // 领域失败透传（零写入由管线承诺）

  // ── S6 同槽 await notifyDirty（完成信号 = live commit + dirty 登记两者）──
  try { await notifyDirty(); }
  catch (err) {                                       // 写已提交而登记通道损坏——诚实 fatal
    markWriteFatal(writeEnv, err);
    throw new RuntimeWriteFatalError('notify-dirty-failed', true, NOTIFY_DIRTY_FAILED_MSG(errDetailOf(err)), { cause: err });
  }   // 不二次尝试 notifier：本槽 notifier 调用预算恰 1 次（S6 本次即已消耗——D5.3）

  // ── S7 槽释放（promise settle；sequencer 自动放行下一项）─────────
  return { ok: true };
```

`disabled(reason)` = `{ ok: false, issues: [{ message: 'RUNTIME_WRITE_DISABLED: ' + reason + '——本调用零写入、输入零访问', path: [] }] }`（D9）。

**槽序与 ADR 逐位对照**：lifecycle/fatal gate（S1）→ writable gate（S2）→ 输入快照（S3）→ 领域校验与 detached 构造（S4 schema 可用性 + S5 管线 (A)–(G½)）→ 一次 Yjs transaction（S5 (H)(I)）→ `await notifyDirty()`（S6）→ 释放（S7）。notifier 绑定检查是 S2 gate 簇的 v1 增补（ADR 槽序假设构造方已绑定；本设计把该义务变成 loud gate 而非静默无登记成功——§4 D6.4 论证）。

**时间线关键性质**（§6.1 逐 tick 展开）：事务在 S5 **同步**完成（applyValidatedMutation 是同步函数）——notifier 挂住期间（S6 await），doc 已含新值而写 Promise 未 resolve：read 观察到已提交状态（INV-W10）、下一写未启动（INV-W7）、调用方 await 未返回（完成信号未发）——三者在同一时间窗内并存，正是 SA6 FIFO 用例的确定性编排点。

### D3 受控 snapshotter（AC3 / INV-W4）【R2 修订：数组分支增补三查 + descriptor-先于值读取次序】

```
snapshotMutation(input): { kind: 'ok'; value: unknown } | { kind: 'issue'; issue: RootMutationIssue }

  try { return { kind: 'ok', value: copyFrozen(input, new Set()) }; }
  catch (e) { return { kind: 'issue', issue: { message: `MUTATION_INPUT_NOT_PLAIN_DATA: ${e.message}`, path: [] } }; }
  // 整体 try/catch：敌意 getter/Proxy trap 在快照读取面抛错 → 类 B 分级（ok:false），
  // 与 doc-runtime E205 哲学一致——用户数据不得升格 internal fatal（防「一次敌意 value →
  // Runtime 永久关写」DoS；SA6 冻结注释明文「输入缺陷属普通领域失败」）

copyFrozen(v, ancestors: Set<object>): unknown          // 返回值已递归冻结；拒绝 → throw（上方收编）
  null                      → null
  string | boolean          → v                          // 不可变标量直通
  number                    → Number.isFinite(v) ? v : throw '非有限 number（NaN/±Infinity）'
  undefined | symbol | bigint | function → throw `非 plain data 值（${typeof v}）`
                              // bigint：JSON 值域外（逻辑快照校验域），早拒 + 明确 issue 优于下游校验报错

  // ── 数组分支【R2 修订：①②③ 查全量前置，任何 v[i] 值读取之前完成】──────────────
  Array.isArray(v)          → 原型须 === Array.prototype（子类/异构 → throw '非 plain 数组'）
                              ancestors.has(v) → throw '循环引用'
                              ① Object.getOwnPropertySymbols(v).length > 0 → throw '数组携带 symbol 键'
                                 // symbol 键不进 Object.keys——缺本查即静默丢弃（R1 盲区 a）
                              ② names = Object.getOwnPropertyNames(v).filter(k => k !== 'length')
                                 keys  = Object.keys(v)
                                 names.length !== keys.length → throw '数组携带非枚举 own 键'
                                 // getOwnPropertyNames 对数组恒含不可枚举的 'length'（自身长度属性），
                                 // 过滤后与可枚举键集比对：非枚举数据键（含非枚举下标）在此暴露
                                 // （R1 盲区 b；`'length'` 本身不可被重定义为 accessor——实测
                                 //  「Cannot redefine property: length」，§12 #11，无逃逸面）
                              ③ for i in [0, v.length):                    // descriptor 全表扫描（先于值读取）
                                   d = Object.getOwnPropertyDescriptor(v, String(i))
                                   d === undefined → throw `index ${i} 无 own 属性（稀疏空洞或原型链污染——不读原型值）`
                                   d.get !== undefined || d.set !== undefined → throw `accessor 下标（index ${i}）`
                                 // getOwnPropertyDescriptor 是元数据读取，不执行 getter（Proxy 侧走
                                 // getOwnPropertyDescriptor trap 而非 get trap）——拒绝先于任何输入侧代码
                                 // 执行（SA2 红灯断言 calls === 0 的次序保证；R1 盲区 c）
                              ④ Object.keys(v).length !== v.length → throw '数组携带可枚举非索引 own 键'
                                 // 额外 own 可枚举属性（arr.foo = 1 等）——与 ② 互补：
                                 // ② 拒绝非枚举面、④ 拒绝可枚举面，两者共同覆盖全部非索引 own 键
                              ⑤ ancestors.add(v)
                                 out = new Array(v.length)
                                 for i in [0, v.length):
                                   raw = v[i]                                    // ③ 已证无 accessor：纯数据读取
                                   raw === undefined → throw `数组元素 undefined（index ${i}）`
                                   out[i] = copyFrozen(raw, ancestors)
                                 ancestors.delete(v)
                                 return Object.freeze(out)

  // ── 对象分支（R1 四查原样：proto/symbol/非枚举/accessor 齐备）─────────────────
  typeof v === 'object'     → proto = Object.getPrototypeOf(v)
                              proto !== Object.prototype && proto !== null
                                → throw `非 plain 对象（constructor: ${proto.constructor?.name ?? 'unknown'}）`
                                // 覆盖一切 class instance / Y.AbstractType / Date/Map/Set——Yjs shared
                                // type 与类实例同走此拒绝（SA6 冻结：class instance 值必须被拒）
                              ancestors.has(v) → throw '循环引用'
                              Object.getOwnPropertySymbols(v).length > 0 → throw 'symbol 键'
                              names = Object.getOwnPropertyNames(v); keys = Object.keys(v)
                              names.length !== keys.length → throw '非枚举 own 键'
                              for k of keys:
                                d = Object.getOwnPropertyDescriptor(v, k)
                                d.get !== undefined || d.set !== undefined → throw `accessor 属性 "${k}"`
                              ancestors.add(v)
                              out = Object.create(Object.prototype)      // 或 {}——原型纪律同源
                              for k of keys:
                                raw = v[k]; raw === undefined → throw `键 "${k}" 值为 undefined`
                                Object.defineProperty(out, k,
                                  { value: copyFrozen(raw, ancestors), writable: true, enumerable: true, configurable: true })
                                // defineProperty 写入纪律（仓内先例 read.ts putKey / extract.ts
                                // putSnapshotKey / projection.ts putMetaKey——'__proto__' 自有键
                                // 不触发原型 setter、不劫持产物原型；裸赋值禁止）
                              ancestors.delete(v)
                              return Object.freeze(out)
  其他（不可达兜底）        → throw `非 plain data（${typeof v}）`
```

设计要点：

- **【R2 修订】数组/对象分支纪律对齐**：ADR-0008 拒绝清单（「拒绝 accessor、class instance、特殊对象、symbol key、循环引用及其他非 plain data」）不区分对象/数组载体——R1 数组分支只查「原型 + keys-vs-length + 空洞」，漏了 symbol 键（`Object.keys` 不含 symbol）、非枚举 own 键（同理）、accessor 下标（且 R1 的 `v[i]` 读取会**执行** getter）。R2 将对象分支的四查纪律完整移植到数组分支（① symbol ② 非枚举 ③ descriptor ④ 非索引键），并以「descriptor 全表扫描先于任何值读取」的次序保证拒绝路径零输入侧代码执行。设计期 node 实测（§12 #11）：三例 R1 盲区输入在 R1 检测下全部绕过（`keys===len`），R2 分支全部拒绝且 accessor 例 getter 调用数为 0；密集数组照收、空洞/非枚举下标/可枚举额外键各得其所拒绝。SA8 追加决策点 4（relevant_decisions）已注册「拒绝侧细化」方向——本增补为同方向加强（拒绝 → 更多拒绝），不反转任何已注册语义。
- **`path` 数组同纪律**：mutation 信封的 `path` 经同一 `copyFrozen` 数组分支快照——SA2 红灯族「path 数组携带 symbol 键 → 拒绝」由同分支免费覆盖；快照器不认识信封形状，但数组纪律对一切嵌套数组一致。
- **冻结序为后序**：子快照先冻结、父后冻结（递归返回时产物已冻结）——快照自槽起点起不可被任何后续阶段（含调用方）突变。
- **循环检测用祖先路径集**（enter add / exit delete）：真环拒绝；**非环共享引用（DAG）按 JSON 语义复制为多份**（与 `JSON.stringify` 行为一致，不引入 identity map——快照的用途是隔离与冻结，不是保共享）。
- **信封形状校验单源在 doc-runtime**：snapshotter 不认识 `{op,path,value}`（primitive 42 快照成功 → A1 报「信封形状错误」；SA6 冻结用例即此路径）。快照器只守「plain data」一条纪律。
- **冻结值流入 doc 的安全性**（§1.2 / §12 #6 依据）：快照值经 placeSet 落入 proposed 后，`buildTopEntries` → `copyJsonDomain` 对 plain 容器**构造全新对象**（detached-build.ts:185-212 INV-7 引用隔离 + defineProperty 安全写入）——doc 存储收到的是全新可变普通值；读取面另有 `copyPlainStrict` 深拷贝（read.ts:355/403）双保险。冻结是槽内隔离手段，不外泄、不影响 Yjs 编码与持久化 round-trip。
- **冻结 path 数组**对下游无害：A4 `Array.isArray` ✓、placeSet `path.slice()` ✓。

### D4 执行时 active schema（AC4 / INV-W5）

**结构性保证（非时序巧合）**：P0 在构造返回前已是 sequencer 队首真实 pending 节点（#89 INV-N1）；`mutateRoot` 的槽只能链在 P0 之后（唯一入队口在构造完成的 runtime 面方法上）。因此写槽启动时 P0 **必然已 settle**，`schemaState ∈ { ready, unavailable, preparing∧fatal }`：

| S4 观测 | 行为 |
|---|---|
| `ready` + `activeTools` 存在 | 用该 derived 执行 S5（「当时 active schema」——若未来 SCHEMA write 上线，槽间切换天然生效） |
| `unavailable` | 零写入 `ok:false`（`SCHEMA_UNAVAILABLE` issue；`schemaWrite.enabled` 不受影响——ADR「正常 compile failure 仅使 ROOT write unavailable」） |
| `preparing` 且无 fatal | **结构上不可达** → loud internal fatal（`write-slot-internal`，committed:false）——不是降级场景，是包缺陷报警 |
| `ready` 但 `activeTools` 缺失 | 同上（installActive 的原子性由 #89 单点写入保证） |

preparing 期接纳的写（SA6 AC4 用例）：排队期间 P0 结算 ready → 槽启动读到已安装 tools → 成功提交。「不绑定调用时 schema generation」由此免费成立——槽内根本没有调用时快照可言。

### D5 Fatal 与失败通道（AC9 / INV-W8/W9）

#### D5.1 `RuntimeWriteFatalError`（公共 rejection 形状，ADR-0008 命名）

```ts
// errors.ts（新增——类与 phase 类型【R2 修订：声明与导出同源，均落 errors.ts】；
// index.ts 从 './errors.js' 值/类型导出；write.ts import 消费——见 D8'）
export type RuntimeWriteFatalPhase =
  | DocRuntimeFatalPhase                       // 'observer-cleanup-throw' | 'post-commit-verification'
                                              // | 'pre-commit-internal'（doc-runtime 三相位透传）
  | 'unknown-pipeline-throw'                  // applyValidatedMutation 逃逸的未知异常（保守 committed:true）
  | 'notify-dirty-failed'                     // S6 notifier rejection（写已提交，登记通道损坏）
  | 'write-slot-internal';                    // 槽内不变量破坏（结构不可达报警）/ getStatus() adapter 违背

export class RuntimeWriteFatalError extends Error {
  readonly committed: boolean;
  readonly phase: RuntimeWriteFatalPhase;
  constructor(phase: RuntimeWriteFatalPhase, committed: boolean, message: string, options?: ErrorOptions) {
    super(message, options); this.name = 'RuntimeWriteFatalError';
    this.committed = committed; this.phase = phase;
  }
}
```

- `committed` 诚实语义：true = 事务已提交或保守视为已提交（ADR W3：不得降格 false）；false = 确定零写入。
- `phase` 是**稳定字符串**（doc-runtime 三相位自 `DocRuntimeFatalPhase` 导入联合——冻结表「只增不改不删」延续；runtime 侧三相位 v1 注册）。
- message 模板稳定前缀 + 「」定界证据引用原始异常文本（仓内 E203 惯例）；`cause`（ES2022 ErrorOptions）零信息损失保留原始 fatal——「始终 reject 原始 fatal」的载体是 cause + committed/phase 事实，**rejection 值本身恒为稳定 branded 类**（SA6 `instanceof` 锚点）。
- 该类**只携带事实**（延续 doc-runtime W4 哲学）：不调用 notifyDirty、不关写能力——一切 Runtime 层动作在 write.ts 槽内完成。

#### D5.2 fatal 分类表（唯一裁决点 = write.ts 槽体 catch 位置）

| 触发源 | committed | phase | 槽内 notifier | 零写入? |
|---|---|---|---|---|
| E203 observer-cleanup-throw（事务 cleanup 派发期 observer 抛错——SA6 committed:true 用例的注入路径） | `true`（透传） | `'observer-cleanup-throw'` | best-effort 恰 1 次 | 否（提交保留，不回滚） |
| E201 post-commit-verification（verifyInstall 偏离） | `true`（透传） | `'post-commit-verification'` | best-effort 恰 1 次 | 否 |
| E204 pre-commit-internal（派生物畸形——SA6 committed:false 用例的注入路径） | `false`（透传） | `'pre-commit-internal'` | **不调用** | 是 |
| `applyValidatedMutation` 逃逸未知异常（理论可达面：E202 裸 Error——窗口 B 残留等） | `true`（**保守**，ADR「未知异常保守视为可能已提交」） | `'unknown-pipeline-throw'` | best-effort 恰 1 次 | 未知（按已提交对待） |
| S6 `notifyDirty()` rejection（写已提交、登记通道损坏） | `true` | `'notify-dirty-failed'` | **已消耗**（S6 即本槽唯一一次尝试，不重试） | 否 |
| S4/S2 槽内不变量破坏（结构不可达）/ getStatus() throw | `false`（gate 段尚零 doc 写） | `'write-slot-internal'` | 不调用 | 是 |

#### D5.3 fatal 路径执行序（write.ts）

```
rejectWithWriteFatal(env, committed, phase, detail, cause): Promise<never>   // async——best-effort 需 await
  markWriteFatal(env, cause)                    // ① 同步先行：state.fatal = freeze({code,message}（稳定注册，
                                                //    不插值原始文本——INV-N7 延续）)；state.fatalCause = cause
                                                //    （包内诊断锚点，#89 R2 立法延续）；S1 已保证此处 fatal 未置位
  if (committed)                                // ② committed:true（含保守）→ 槽内 best-effort 恰一次
    try { await env.notifyDirty?.(); } catch { /* 吞没：best-effort 不得掩盖/替换原始 fatal */ }
  throw new RuntimeWriteFatalError(phase, committed, STABLE_MSG(phase, committed, detail), { cause })
```

- **notifier 调用预算不变量**：每个 fatal 槽 notifier 调用总数 **≤ 1**——E203/E201/unknown 路径在 fatal 路径内调 1 次；notify-dirty-failed 路径的 1 次已在 S6 消耗（fail 的那次就是尝试）；committed:false 与 gate 段 fatal 为 0。SA6 committed:true 用例断言 `notifierCalls === 1` 锚定此预算。
- **永久关写 + 队列不毒死**：`markWriteFatal` 后，已排队/后续写经 S1 → disabled（零访问、零写入、`RUNTIME_WRITE_DISABLED`）——FIFO 持续流转与写能力永久关闭同时成立（SA8 冲突点对照 4 的显式裁决）。`schemaState` 不迁移（fatal 摘要独立投影，#89 状态机不动）。
- **不虚假回滚**：E203/E201/notify-dirty-failed 后 doc 保持事务留下的实际状态（提交值可读——SA6 断言 read=9）；不补偿、不 fallback。
- **生产工厂/Registry 提示**：`committed:true` 的 rejection 上层不得自动重试非幂等写（ADR 原文）——属消费方纪律，本包以 branded 字段提供判别面。

#### D5.4 与 P0 fatal 的关系

写槽 fatal 与 P0 fatal 共享 `state.fatal` 槽位（一经置位永久为真，INV-N6 延续）但 code 不同（`NSRT-FATAL-WRITE-INTERNAL` vs `NSRT-FATAL-P0-INTERNAL`）——status 投影稳定摘要可区分来源；两者互斥先行（P0 fatal 时写根本进不了 S5，反之写 fatal 时 P0 早已 settle）。

### D6 notifyDirty 窄接缝（AC7/AC10 / INV-W7）

#### D6.1 seam 扩展（可选字段增广，非破坏）

```ts
export interface NamespaceRuntimeSeamInput {
  readonly handle: DocHandle;
  readonly p0Gate?: Promise<void>;
  readonly compile?: (envelope: SchemaEnvelope) => CompileSchemaEnvelopeResult;
  /** mutation 后 dirty notification 接缝（ADR-0008 原文命名）：构造方绑定
   *  persistence.saveDoc(handle)；测试经 seam 注入确定性 notifier。缺省 = 未绑定
   *  （写槽 S2 loud 拒绝，见 D6.4）。 */
  readonly notifyDirty?: () => Promise<void>;
}
```

`captureSeamInput`（V1，INV-N14 单读纪律延续）：`notifyDirty` 若提供必须是 function（否则构造栈 TypeError，零副作用——与 p0Gate/compile 同规）；捕获为局部常量后闭包持有，入队后零读取。

#### D6.2 WriteEnv 一次成型（构造栈，纯数据闭包）

```ts
// write.ts
export interface WriteEnv {
  readonly doc: Y.Doc;                  // V3a 捕获的 live Y.Doc 引用
  readonly handle: DocHandle;           // S2 瞬时观察专用（getStatus）
  readonly state: RuntimeState;         // 与 P0 共享的唯一可变源
  readonly notifyDirty: (() => Promise<void>) | undefined;   // 显式 undefined 联合（exactOptionalPropertyTypes，
}                                                            //  沿 P0Env.p0Gate 先例）
// runtime.ts 构造序（V3c 延续）：
const writeEnv: WriteEnv = { doc, handle, state, notifyDirty: captured.notifyDirty };
```

`mutateRoot` 的 thunk `() => runRootWriteSlot(writeEnv, mutation)` 是纯调用（env 纯数据 + 实参传递，零属性读取于求值点、无可抛点——mutation 引用仅被捕获不被读取，Proxy 零触发）。

#### D6.3 生产工厂绑定（包内，Registry 未来使用）

```ts
export function createNamespaceRuntime(handle: DocHandle, notifyDirty: () => Promise<void>): NamespaceRuntime {
  return createNamespaceRuntimeWithSeam({ handle, notifyDirty });
}
```

绑定义务显式化为必填参数（ADR「由构造方绑定」——未来 Registry 传 `() => persistence.saveDoc(handle)`）。该函数仍不导出（AC1 延续）；签名加参属包内私有函数演进（§13 caller 审计：全仓 grep 零调用）。

#### D6.4 未绑定 = loud gate，不是静默 no-op（拒绝虚假降级立法）

**判据**：功能完备的系统里，写路径的 notifier 恒已绑定（构造方义务）——未绑定不是「异常路径降级场景」，是构造配置缺陷。两种反面方案均被否决：

- ❌ 缺省 no-op（`async () => {}`）：写成功但 dirty 永不登记 → 持久层永不落盘 → 「成功只表示 live commit 与 dirty notification 已登记」的完成信号语义被静默击穿——**虚假降级，立法命中**。
- ❌ 构造期强制必填 seam：SA6 冻结锚点明文 `notifyDirty?`（可选）；且 #89 五个冻结测试均未传该字段（它们不写，但构造必须合法）。

**裁决**：可选字段（契约形状服从冻结锚点）+ **写槽 S2 loud gate**——未绑定时一切 `mutateRoot` settle `ok:false` + `RUNTIME_WRITE_DISABLED`（message 指明未绑定与构造方义务），零写入、零输入访问。阻断而非静默；任何当前冻结测试不可达（新测试全传 notifier，旧测试不写）。

### D7 sequencer 泛化（AC1 / INV-W1/W12）

```ts
// sequencer.ts（唯一排序机构；模块零导出延续）
export class WriteSequencer {
  private tail: Promise<unknown> = Promise.resolve();

  /** 入队：前项 settle（含 reject）后本项才开始执行；返回值即本项完成信号（携带槽结果）。 */
  enqueue<T>(run: () => Promise<T>): Promise<T> {
    const settled = this.tail.then(run, run);   // 前项失败不阻断 FIFO
    this.tail = settled.then(noop, noop);       // 链尾恒绿：队列永不因单项失败断裂
    return settled;
  }
}
```

- 唯一改动：`Promise<void>` → 泛型 `Promise<T>` + `tail: Promise<unknown>`——写槽需要完成信号**携带结果联合值 / rejection**；P0 用法 `void sequencer.enqueue(() => runP0(env))`（T=void）零变化。
- 「前项 settle 后项方启」+「返回完成信号」两性质是 mutateRoot 接纳/屏障的全部依赖（#89 D6 扩展位预言的兑现，头注释同步改写为「真实写槽已挂接」）。

### D8 doc-runtime 公共面恢复导出（AC5 前置 / SA8 注记 N2）

```ts
// packages/doc-runtime/src/index.ts（+2 行值/类型导出；头注释删「awaits issue #76」措辞）
export { applyValidatedMutation } from './mutation.js';
export type { MutationIssue, ApplyValidatedMutationResult } from './mutation.js';
```

- 实现零改动：`mutation.ts` 管线契约冻结（#87 交付），本任务只恢复 21b0eed 下架的导出（#76 已 CLOSED，set-only 现状即收口形态）。
- 消费方：namespace-runtime `write.ts`（唯一生产 caller）；SA6 两守卫测试翻转锚定；doc-runtime 既有内部 seam 测试（`../src/mutation.js` 相对导入）不受公共导出影响。
- 版本 bump：`@nomicore/doc-runtime` 0.1.7 → 0.1.8。

### D9 结果联合与稳定码（AC1/AC2/AC6 / INV-W9）【R2 修订：公共联合 issues 放宽 `unknown[]`——SA2 攻击点 #1】

```ts
// write.ts（index.ts 类型导出）
/** ROOT mutation issue 元素形状名目（ADR-0008「独立的窄 issue 类型」；与 doc-runtime
 *  MutationIssue 结构同一、名目独立——不与未来 SCHEMA replacement issue 合并）。
 *  【R2 修订】本接口是**构造侧纪律与文档类型**：runtime 内部构造的每个 issue 恒为
 *  `{ message, path }` 此形状（disabled/snapshot/unavailable/管线透传四来源全部如此）；
 *  公共联合的 issues 元素类型放宽为 unknown（见下），调用方需要元素形状时以本名目
 *  为文档锚（运行时恒成立，类型层由冻结测试孪生强制——§7.2）。 */
export interface RootMutationIssue { message: string; path: Array<string | number>; }
export type MutateRootResult = { ok: true } | { ok: false; issues: unknown[] };
```

**【R2 修订】放宽依据（设计期 tsc 实证，§12 #11）**：vitest `--typecheck` 通道（tsconfig.typecheck.json 含 `packages/*/test/**`）编译 SA6 冻结测试的本地 `MutateRootRuntime extends NamespaceRuntime` 重声明，派生接口成员可赋值性要求**每个冻结孪生的本地 Result ⊑ MutateRootResult**。两冻结文件孪生取值不同：

- sequencer 孪生（`runtime-mutate-root-sequencer.test.ts:70-81`）：`issues: MutationIssue[]`（本地 `{message, path}` 形状）；
- persistence 孪生（`runtime-mutate-root-persistence.test.ts:44-46`）：`issues: unknown[]`。

`unknown[] ⊑ T[]` 仅当 `T = unknown`——公共联合元素类型必须取 `unknown` 方能使两孪生同时编译（R1 取 `RootMutationIssue[]` 使 persistence 孪生 TS2430：`Interface 'MutateRootRuntime' incorrectly extends…'unknown[]' is not assignable to 'RootMutationIssue[]'`，设计期已用仓库 tsc 5.9.3 + repo flags 复现并验证修订形状零错——命令与输出见 §12 #11）。「窄」的语义落点不变：ROOT mutation 与未来 SCHEMA replacement 是**各自独立**的结果联合（不合并巨型 write issue），ADR 条款不约束 issues 数组的元素静态宽度；SA6 契约锚点 3 亦只写 `{ ok: false, issues }` 不锁元素类型。**收窄风险单向**：`RootMutationIssue[]` 与 doc-runtime `MutationIssue[]` 均可赋值给 `unknown[]`（生产侧构造不变），反向不成立——放宽只发生在公共类型声明，不改变任何运行时构造。

稳定码注册表（errors.ts，均出现在 issue.message 内——SA6 `hasDisabledCode` 以 JSON.stringify 含码判定）：

| 码 | 通道 | 场景 |
|---|---|---|
| `RUNTIME_WRITE_DISABLED` | ok:false issue | fatal 已置位 / handle 非 ready（degraded、released、disposed）/ notifier 未绑定（D6.4） |
| `MUTATION_INPUT_NOT_PLAIN_DATA` | ok:false issue | snapshotter 拒绝（D3 全部拒绝类 + 读取面抛错收编） |
| `SCHEMA_UNAVAILABLE` | ok:false issue | S4 unavailable（零写入失败，SCHEMA write 可修复） |
| （领域 issues 透传） | ok:false issues | applyValidatedMutation A–G½ 全部领域失败（信封形状/路径/校验/构造/G½ 丢键预检/E205）——message 原样透传，不重写不改码 |
| `NSRT-FATAL-WRITE-INTERNAL`（code） | status.fatal 摘要 | 写槽 fatal 的稳定摘要 code（message 恒定文案，不含原始异常——INV-N7） |

### D8' index.ts 导出面（AC2 / INV-W11）【R2 修订：phase 类型与 error 类同源导出自 errors.ts——消除 D5.1/§3/§11 与本节的声明地矛盾】

```ts
export { createNamespaceRuntimeWithSeam } from './runtime.js';
export { RuntimeWriteFatalError } from './errors.js';          // 唯一新增值导出（instanceof 消费）
export type { RuntimeWriteFatalPhase } from './errors.js';     // 与类同源（D5.1 声明地）——不经 write.ts 转手
export type { NamespaceRuntime, NamespaceRuntimeSeamInput } from './runtime.js';
export type { NamespaceRuntimeStatus } from './status.js';
export type { ActiveSchemaInfo } from './p0.js';
export type { RootMutationIssue, MutateRootResult } from './write.js';
```

【R2 修订】R1 的 D5.1/§3/§11 把 `RuntimeWriteFatalPhase` 放在 errors.ts 声明、D8' 却从 `'./write.js'` re-export——SA3 直译将在两文件间二选一产生分歧。R2 统一为「类型声明与值导出同源」：`RuntimeWriteFatalError` + `RuntimeWriteFatalPhase` 都在 errors.ts 声明并从 errors.ts 导出；write.ts 只承载结果联合类型（RootMutationIssue / MutateRootResult），并 `import { RuntimeWriteFatalError } from './errors.js'`（含 type-only import RuntimeWriteFatalPhase——verbatimModuleSyntax 纪律）用于槽体构造。

#89 头注释「不导出错误类别」条款修订为：「构造/投影错误类别仍不导出（code+message 字符串消费）；`RuntimeWriteFatalError` 是 ADR-0008 点名的稳定 rejection 形状，例外值导出（instanceof 判别 committed/phase 是上层「不得自动重试非幂等写」纪律的依赖面）」。

---

## §5. 关键伪代码（SA3 实现蓝本）

```ts
// write.ts —— 常量与辅助（示意；完整槽体见 §4 D2/D3/D5）
const FATAL_WRITE_INTERNAL_CODE = 'NSRT-FATAL-WRITE-INTERNAL';
const FATAL_WRITE_INTERNAL_MESSAGE =
  'ROOT write internal fault：写管线产生结果联合之外的 internal fatal；本 Runtime 全部写已永久关闭，读取保留。';

function markWriteFatal(env: WriteEnv, cause: unknown): void {
  env.state.fatal = Object.freeze({ code: FATAL_WRITE_INTERNAL_CODE, message: FATAL_WRITE_INTERNAL_MESSAGE });
  env.state.fatalCause = cause;            // 包内诊断锚点（不进任何公共面——#89 R2 立法延续）
}

function disabledIssue(reason: string): RootMutationIssue {
  return { message: `RUNTIME_WRITE_DISABLED: ${reason}——本调用零写入、输入零访问`, path: [] };
}

async function rejectWithWriteFatal(
  env: WriteEnv, committed: boolean, phase: RuntimeWriteFatalPhase, detail: string, cause: unknown,
): Promise<never> {
  markWriteFatal(env, cause ?? detail);
  if (committed) {
    try { await env.notifyDirty?.(); } catch { /* best-effort 吞没——原始 fatal 优先传播 */ }
  }
  throw new RuntimeWriteFatalError(
    phase, committed,
    `NSRT-WRITE-FATAL: ROOT write internal fatal（phase=${phase}, committed=${committed}）；本 Runtime 全部写已永久关闭，` +
    `读取保留；不补偿、不 fallback、不声称回滚；上层不得自动重试非幂等写。原始异常证据引用：「${detail}」`,
    cause === undefined ? undefined : { cause },
  );
}

function errDetailOf(err: unknown): string { return err instanceof Error ? err.message : String(err); }
```

```ts
// runtime.ts —— 构造序增量（#89 V1/V2/V3 骨架不动，只做加法）
// V1 captureSeamInput 增补（p0Gate/compile 同款三行式）：
//   notifyDirty 若提供必须 function → 捕获局部（INV-N14 单读）
// V3c 增补：const writeEnv: WriteEnv = { doc, handle, state, notifyDirty: captured.notifyDirty };
// V3e 增补第八键：
//   mutateRoot: (mutation: unknown): Promise<MutateRootResult> =>
//     sequencer.enqueue(() => runRootWriteSlot(writeEnv, mutation)),
// 生产工厂（D6.3）：
export function createNamespaceRuntime(handle: DocHandle, notifyDirty: () => Promise<void>): NamespaceRuntime {
  return createNamespaceRuntimeWithSeam({ handle, notifyDirty });
}
```

```ts
// 槽体主函数 runRootWriteSlot 与 snapshotMutation/copyFrozen 全文见 §4 D2/D3（逐行即伪代码级
// 定稿——SA3 直译；模块内部自由度：辅助函数拆分/命名/合并，槽序与拒绝分类不得变）。
```

---

## §6. 边界条件、并发与时序分析

### 6.1 时间线（关键场景逐 tick；µ = 微任务，T = 测试可控时点）

| 时刻 | 事件 | 可观测状态 |
|---|---|---|
| T0 | `mutateRoot(A)` 同步链尾（接纳 #1）；`mutateRoot(B)` 同步链尾（接纳 #2） | 两 Promise 均 pending；`getStatus()` 不变（status 无队列字段——INV-N11 延续） |
| T0+µ₁ | A 槽启动：S1/S2 gate（零输入访问）→ S3 快照 A → S4 tools → S5 **同步**完成事务 | doc update 事件 +1；`read` 立即可见新值（read 不等 Promise——INV-W10）；A 的 Promise 仍 pending（S6 未过） |
| T0+µ₂ | A 槽 `await notifyDirty()`（挂住——测试 deferred 控制） | B 未启动（未快照、未写）；notifier 计 1；read 见 A 值；A/B Promise 均 pending |
| T1 | notifier resolve → A 槽 return `{ok:true}` → A 的 Promise resolve → 链放行 B | `await pA` 返回；B 槽启动 |
| T1+µ | B 槽全流程同上 | notifier 计 2；最终值为 B 的（严格按接纳顺序——SA6 FIFO 用例断言 `['A','B']`） |
| F0 | （fatal 变体）A 槽 S5 抛 E203：markWriteFatal → best-effort notifier（1 次）→ throw RuntimeWriteFatalError | A 的 Promise **reject**（instanceof/committed/phase 可判）；`status.fatal` 非 null；写位全 false；read 保留已提交值；B 槽随后启动 → S1 → disabled（零访问/零写入）→ B 的 Promise resolve ok:false |

### 6.2 边界条件清单

| # | 条件 | 行为 | 依据 |
|---|---|---|---|
| 1 | preparing 期调用 mutateRoot | 正常接纳（排队 P0 后）；槽启动时 P0 已 settle → 按终态走 ready/unavailable/disabled | D4/INV-W1 |
| 2 | fatal 已置位后调用/已排队 | settle `{ok:false}` + `RUNTIME_WRITE_DISABLED`；零访问（Proxy 0）、零写入、0 notifier；可无限次重复调用不挂死 | D2 S1/INV-W8 |
| 3 | handle `persistence-degraded`（构造前已降级） | S2 拒绝（disabled）；P0/read 不受影响（#89 既有行为不动） | D2 S2/AC7 |
| 4 | gate 通过后才降级（notifier 期间/flush 失败） | 事务保留、notifier 照常登记（saveDoc degraded 不拒——ADR-0006）；**下一笔**才被新 gate 拦 | D2 S2/S6/§6.2 #12 |
| 5 | handle 外部 release/disposed（调用方违约） | S2 非 ready → disabled（零写入）；读取面继续（#89 边界延续） | D2 S2 |
| 6 | `handle.getStatus()` 在槽内 throw | 统一 fatal `write-slot-internal`（committed:false，此时尚零 doc 写）+ 永久关写——不裸异常逃逸第二通道 | D2 S2 |
| 7 | notifier 未绑定（seam 缺省）+ 调用 mutateRoot | S2 loud gate：disabled + message 指明构造方义务；零写入零访问 | D6.4 |
| 8 | notifier 永久挂住 | **两处 notifier await 共用同一停滞语义【R2 修订，SA2 #5】**：(a) S6 成功路径挂住 → 槽永不释放、后续写永排队；(b) **fatal 路径的 best-effort notifier 挂住**（D5.3 ②）→ fatal rejection 永不送达调用方、已排队写永不取槽（同样停滞，无第二通道）。两处均**无 timeout、无取消**（ADR close「无条件排空」同哲学）；停滞是持久层存活信号，静默 timeout 反而制造「槽释放但登记未完成」的语义破坏。可观测性缓解（fatal 路径独有）：`markWriteFatal` 同步先行（D5.3 ① 先于 ②）——notifier 挂住期间 `status.fatal` 已可观测、后续（S6 成功路径的）新调用经 S1 拒绝为 disabled——SA2 红灯构想 #5 锁定「停滞而非静默跳过/降级」。read 不受影响 | D2 S6/D5.3/§10 R4 |
| 9 | notifier rejection（saveDoc foreign/rejected——调用方违约或持久层契约违背） | fatal `notify-dirty-failed`（committed:true——写已提交）；不重试（预算已耗）；诚实 reject | D5.2/D5.3 |
| 10 | 排队期间调用方改输入内容 | 槽开始快照获胜（SA6 AC3：读到 999 非调用时 7） | D3/INV-W4 |
| 11 | 输入非 plain——**对象分支**：class/symbol 键/循环/NaN/function/undefined 值/accessor/非枚举键/bigint/嵌套 Yjs 类型；**数组分支【R2 修订，SA2 #2】**：symbol 键（①）/非枚举 own 键含非枚举下标（②）/accessor 下标（③，descriptor 先于值读取——**getter 零执行**）/可枚举非索引 own 键（④）/稀疏空洞与原型链污染位（③ 的 own-descriptor 判定，不读原型值）/子类数组原型 | ok:false + `MUTATION_INPUT_NOT_PLAIN_DATA`；零写入、0 notifier；拒绝路径零输入侧代码执行（accessor 例 `calls === 0`——SA2 红灯断言） | D3（两分支四查对齐） |
| 12 | 输入为敌意 Proxy（trap 抛错） | 快照读取面抛错 → 收编 ok:false（类 B——不升格 fatal，防 DoS） | D3 |
| 13 | 输入信封为 primitive / 缺键 / 未知 op / 未知键 | 快照通过（primitive 是 plain data）→ applyValidatedMutation A1–A5 领域单 issue 透传 ok:false | D3/§1.2 |
| 14 | schema unavailable | S4 ok:false + `SCHEMA_UNAVAILABLE`；`schemaWrite.enabled` 仍 true（ADR：可修复） | D4 |
| 15 | ROOT observer 抛错（外部注册） | S5 (H) E203 → fatal committed:true + best-effort notifier 1 次 + 提交值保留不回滚 | D5.2 |
| 16 | seam 注入畸形 derived（P0 守卫放行） | S5 (B) E204 → fatal committed:false + 0 notifier + 零写入 | D5.2 |
| 17 | applyValidatedMutation 逃逸未知异常（E202 窗口 B 残留等理论面） | 保守 committed:true + best-effort notifier + reject（ADR「未知异常保守」强制的过报方向——多登记一次 saveDoc 无害：登记的是当前最新 live doc） | D5.2 |
| 18 | E202 窗口 B 是否实际可达 | 正常路径不可达：fatal gate 先拦（observer 抛错必先触发 E203 fatal → 后续写进不了 S5）；仅当同一 doc 上有外部写者留下残留 cleanup 时可达——外部违约写者本就出局（ADR：业务调用方不得取得可写 Yjs 引用） | D5.2/§1.2 |
| 19 | 同一 tick 多笔写 | 接纳顺序 = 调用顺序（enqueue 同步拼尾）；逐槽串行 | D7/INV-W1 |
| 20 | 前笔普通失败 | 链尾恒绿 + 槽返回值联合——后续写照常（不毒死） | D7/AC1 |
| 21 | 调用方丢弃 rejection Promise | unhandled rejection 归调用方（fatal 契约要求消费方处理）；内部链恒绿无自伤 | INV-W12 |
| 22 | 快照值含 own `'__proto__'` 键 | defineProperty 写入保真（快照器纪律）；下游 copyJsonDomain/placeAt 同纪律，全链无原型劫持 | D3 |
| 23 | 写槽与读取并发（S5 事务期间 read 被调） | JS 单线程：read 只能在槽间/await 间隙运行，观察到的是已提交快照——无 torn read | INV-W10 |
| 24 | 两 Runtime 同 handle（seam 违约） | 不检测（#89 边界延续：独占性是租约移交契约）；FIFO 各自独立，写序不受本设计保护 | §10 R6 |
| 25 | mutateRoot 后立即 read（同 tick） | read 观察调用瞬间已提交状态（写大概率未执行——排队中）；read-your-write 必须 await 写 Promise | INV-W10/AC8 |

### 6.3 数据一致性

- 写路径对 doc 的全部变更收敛于 applyValidatedMutation 单事务（INV-W6）；槽内其余步骤零 doc 写（S3/S4 纯内存、S6 只触持久层登记）。
- 快照→管线→doc 的值传递链全程 plain-data（快照冻结 → copyJsonDomain 全新容器 → doc 存储）；调用方对象自 S3 起不可达（排队期间变更与已执行写无因果）。
- `state` 单点写者纪律延续：P0 写 schemaState/activeInfo/fatal（P0 域），写槽写 fatal/fatalCause（写域）——两域互斥先行（D5.4），JS 单线程无竞态窗口。

---

## §7. 构建集成与类型纪律

### 7.1 typecheck 双通道（本任务的关键集成事实）

**通道 A（`pnpm typecheck`）**：七包 `tsc -p` 串联；namespace-runtime include 仅 `src/**`（#89 §7.1 决议延续——`write.ts` 落 src/ 自动入检；测试文件不入本通道）。doc-runtime include 不变。

**通道 B（`pnpm test` = `vitest run --typecheck`）**：`vitest.config.ts` `typecheck.tsconfig: './tsconfig.typecheck.json'`，其 include 含 **`packages/*/test/**/*.ts`（全部测试文件，非仅 .test-d.ts）**——SA6 测试字面量会被编译并对照 src 类型检查。红灯证据即证：2 处 `notifyDirty does not exist in type 'NamespaceRuntimeSeamInput'`（对象字面量 excess property 检查）来自 sequencer/persistence 两测试文件的 seam 字面量。**本设计的 seam 可选字段（D6.1）正是其唯一消解路径**（简报明文「SA3 扩展后自然消解」）。

### 7.2 SA6 冻结文件类型核对表【R2 修订：逐文件全量核对——SA2 攻击点 #1/#3；R1 只核对了 sequencer 一文件，漏 persistence 孪生导致 TS2430】

**方法论**：通道 B（§7.1）把**全部** `packages/*/test/**/*.ts` 编入同一 tsc 程序——任何冻结文件里的 extends 重声明、seam 直接字面量都是对 src 类型的硬约束。R2 对每个 SA6 冻结文件列出「以 src 类型为约束的声明」及可赋值性结论（R1 的核对缺口即 #1 的根因，已修复并实测验证）：

| 冻结文件 | src 约束点 | 冻结侧形状（文件:行） | 可赋值性结论（R2 类型下） |
|---|---|---|---|
| `runtime-mutate-root-sequencer.test.ts` | ① seam 直接字面量；② `MutateRootRuntime extends NamespaceRuntime`；③ 动态取成员 | ① `:466-471` `{ handle, notifyDirty: async () => { notifierCalls += 1 } }`；② `:70-81` 本地 `MutationIssue = { message: string; path: Array<string \| number> }`、`MutateRootResult = { ok:true } \| { ok:false; issues: MutationIssue[] }`、`mutateRoot: (mutation: unknown) => Promise<…>`；③ `:265-273` beforeAll 动态 import + Record cast | ① `notifyDirty?: () => Promise<void>` ✓（async 返回 `Promise<void>`；`readyRuntime` 走 Record + `as never` 无约束）；② `SeqResult ⊑ MutateRootResult`：`MutationIssue[] ⊑ unknown[]` ✓；③ Record cast 无约束 ✓（实测：probe-r2 零错，§12 #11） |
| `runtime-mutate-root-persistence.test.ts` | ① seam 直接字面量；② `MutateRootRuntime extends NamespaceRuntime` | ① `:92-96` `{ handle, notifyDirty: notifier }`（notifier: `() => Promise<void>`）；② `:44-46` `mutateRoot: (mutation: unknown) => Promise<{ ok:true } \| { ok:false; issues: unknown[] }>` | ① ✓；② `PersResult ⊑ MutateRootResult`：`unknown[] ⊑ unknown[]` ✓——**R1 形状（issues: RootMutationIssue[]）在此 TS2430，R2 放宽后通过**（实测：probe-r1 报 TS2430 / probe-r2 零错，§12 #11） |
| doc-runtime `public-surface-guard.test.ts` | index 值导出面 | `:34-49` hasOwnProperty + typeof function + 值导出面恰 `^applyValidatedMutation$` 一个 | D8 导出 `applyValidatedMutation` 值导出 ✓；既有五值导出不动 ✓；无新增 mutation 姊妹导出 ✓ |
| doc-runtime `public-surface-type-guard.test-d.ts` | index 类型导出面 | `:22-45` import type 十名目（含 `MutationIssue` / `ApplyValidatedMutationResult`） | D8 类型导出两名目 ✓（其余八名目 #87 前已导出） |
| #89 五冻结测试（ownership / sync-read / p0-sequencer / boundary-supplementary / metadata-proto-key） | ① seam 直接字面量（均不传 notifyDirty）；② `NamespaceRuntime` 类型消费（无 mutateRoot 重声明） | 各文件 `createNamespaceRuntimeWithSeam({ handle, p0Gate?, compile? })` 字面量 + `import type { NamespaceRuntime }` 局部注解 | ① 可选字段增广：不传即不绑定 ✓（excess property 不触发）；② 接口加法成员对既有七键消费零影响 ✓；p0-sequencer 注入字面量走 `unknown` + `as` 双cast（`:124-131` 实读核实）不经 src 类型约束 ✓ |

**tsc 全绿门（显式验收门，SA2 红线 #1）**：SA3 实现后必须满足

```bash
./node_modules/.bin/tsc -p tsconfig.typecheck.json --noEmit   # 零错（与 pnpm test typecheck 阶段同一程序）
```

现状基线该命令 4 错（2×TS2305 doc-runtime 类型名目缺失 + 2×TS2353 seam notifyDirty——SA2 评审实跑复现与本设计 §12 #7 一致）；实现后须零错——两个冻结孪生同时编译通过是该门的必查项（反向锚：sequencer 孪生在修订前后都必须编译，防放宽反向破坏）。

**其余类型纪律**（沿 R1）：

- `entry['RuntimeWriteFatalError']` 动态取成员无类型约束（Record cast）；`entry['mutateRoot']` 必须 undefined——**禁止任何模块级 mutateRoot 导出**（命名纪律）。
- `exactOptionalPropertyTypes`：WriteEnv.notifyDirty 取显式 `(() => Promise<void>) | undefined` 联合（沿 P0Env.p0Gate 先例），不用 `?:`。
- `verbatimModuleSyntax`：write.ts 消费 errors.ts 的类型一律 `import type`；通道 A/B 均编译全部 src（tsconfig.typecheck.json 亦含 `packages/*/src/**`），实现须双通道零错。

### 7.3 依赖、版本与 lockfile

- 新增 import：`applyValidatedMutation` / `DocRuntimeFatalError` /（type）`DocRuntimeFatalPhase` / `ApplyValidatedMutationResult`——全部来自既有依赖 `@nomicore/doc-runtime`（package.json 已在 dependencies，**零新依赖、lock 零改动**）。
- 版本 bump（硬门禁 9）：`@nomicore/namespace-runtime` 0.1.0 → 0.1.1；`@nomicore/doc-runtime` 0.1.7 → 0.1.8（两包均有实质改动）。
- CI（Node 20/24 矩阵 `pnpm typecheck` + `pnpm test`）：零配置改动——vitest 通配自动收集两个新测试文件；tsc 串联已含两包。

### 7.4 测试收集

`packages/*/test/**/*.test.ts` 通配命中两新文件；`.test-d.ts` 通配命中 doc-runtime 类型守卫更新。SA6 冻结文件零触碰。

---

## §8. 全局兼容与影响评估

| 面 | 影响 |
|---|---|
| doc-runtime 源码 | `index.ts` +2 行导出 + 头注释（**唯一**触碰；mutation.ts 及其余零改动——#87 契约冻结） |
| doc-runtime 既有 15 测试文件 | 零改动零回归：内部 seam 相对导入（`../src/mutation.js`）与公共导出正交；`apply-validated-mutation-*` 系列不经 index |
| namespace-runtime #89 五冻结测试 | 零改动保持全绿（§1.3 核实：无键数断言、seam 可选增广、notifyDirty 不传不写即不可达） |
| pnpm-lock.yaml / 根 package.json / vitest.config.ts / tsconfig* / CI | 零改动（§7.3） |
| ADR 一致性 | 无推翻（SA8 verdict clear）：本设计是 ADR-0008 写侧条款的直接兑付；延后项按原条款留扩展位 |
| 架构一致性 | 校验/构造/事务决策点单源在 doc-runtime 管线（本层零重复实现——write.ts 只做编排/快照/分级）；snapshotter 的 plain-data 判据与 read.ts `copyPlainStrict` / extract `copyPlainValue` / mutation `plainObjectOf` / projection `copyMetaValue` 同族同判（原型链/有限数/own enumerable data/symbol 拒绝——见 §10 R1 的复制性论证）；defineProperty 写入纪律第 5 处回流（putKey/putSnapshotKey/putMetaKey/copyJsonDomain 之后） |
| 公共面演进 | NamespaceRuntime 七键→八键（加法）；index 值导出 +1（RuntimeWriteFatalError）——均为加法式版本演进，无收窄 |

---

## §9. 验收标准映射

| AC（简报） | 设计条目 | 测试锚（SA6 文件:行） |
|---|---|---|
| AC1 同步定序 FIFO、单项失败不毒死队列 | D1/D7（同步接纳 + 链尾恒绿）、INV-W1/W12 | sequencer:314-359（FIFO）、361-404（失败不毒死） |
| AC2 槽前 gate（lifecycle/fatal + writable）；不可写零访问零写入 | D2 S1/S2、INV-W3 | sequencer:406-449（fatal gate）、451-496（degraded）、665-724 尾段（fatal 后队列流转） |
| AC3 槽起点递归冻结快照、后续不读调用方对象 | D3、INV-W4 | sequencer:536-558（快照时点）、560-600（非 plain 拒绝） |
| AC4 执行时 active schema；preparing/unavailable 结算语义 | D4、INV-W5 | sequencer:602-625（preparing 期接纳）、627-663（unavailable 零写入） |
| AC5 前后无写旁路 + 调用 applyValidatedMutation + 恢复导出 | D2 S5、INV-W6、D8 | sequencer:276-311（恰 1 事件）；doc-runtime 两守卫文件（导出正锚） |
| AC6 同槽 await notifier、resolve 后下一项才执行 | D2 S6/S7、INV-W7 | sequencer:314-359（屏障）、276-311（notifier 恰 1 次） |
| AC7 degraded 阻 ROOT 不阻 read/P0；检查后降级仍登记 | D2 S2/S6、§6.2 #4/#12 | sequencer:451-534；persistence:134-179（degraded 全链） |
| AC8 read 不进 sequencer、read-your-write 经 await | INV-W10（零改动声明） | sequencer:276-311/314-359（read 观察已提交值两断言点） |
| AC9 窄结果联合 + fatal rejection 通道 | D5/D9、INV-W8/W9 | sequencer:665-724（committed:true）、726-775（committed:false） |
| AC10 确定性 + 真实 Persistence 集成 + 全量绿 + Node 20/24 | §7.1-7.4（**含 §7.2 tsc 全绿门：`tsc -p tsconfig.typecheck.json --noEmit` 零错——SA2 红线 #1 必查项**） | persistence:102-179（跨实例持久化）；红灯证据（16 failed → 实现后全绿） |

---

## §10. 风险登记与开放问题

| # | 风险/边界 | 评级 | 处置 |
|---|---|---|---|
| R1 | snapshotter 是仓内第 5 处 plain-data 判据实现（read/extract/mutation/projection 同族）——复制漂移风险 | 低 | 各处判据**语义同族但职责不同**（投影/提取/校验/深拷贝/冻结快照——输入输出域与失败通道各异，无法单源合并且不应跨包下沉）；本设计以 §8 一致性表显式锚定同族判据（原型链 Object.prototype/null、有限数、own enumerable data、symbol 拒绝），SA4 可对照。未来如出现第 6 处再议公共 helper（登记开放问题，非本任务范围） |
| R2 | notifier 未绑定 gate 是 ADR 槽序未列的 v1 增补步骤 | 低 | D6.4 论证链完整（虚假降级立法 + 冻结锚点可选性 + 任何现有测试不可达）；ADR 槽序假设构造方义务已履行，本 gate 是义务的 loud 执行器，不与任何条款冲突 |
| R3 | 未知异常（E202 等）保守 committed:true 会过报（实际零写入也登记一次 dirty） | 低 | ADR 明文「未知异常保守视为可能已提交」——过报方向是强制的且无害（saveDoc 登记的是当前最新 live doc，ADR-0006 语义下多登记不破坏一致性）；不设计降格（W3：不得降格 false） |
| R4 | notifier 挂住 → 队列无限停滞（无 timeout/取消） | 中→低 | ADR 纪律（close「无条件排空、不取消、不设内部 timeout」同哲学）：停滞是持久层存活信号，静默 timeout 反而制造「槽释放但登记未完成」的语义破坏。测试 seam 的确定性 resolve/reject 即生产可观测面；未来观测面 issue（metrics/alert）承接 |
| R5 | `fatalCause` 只存不报（#89 R4 遗留延续） | 低 | 包内诊断锚点定位不变；「消费/上报」仍登记为后续观测面 issue 的显式验收点（不得长期沉默） |
| R6 | 同 handle 双 Runtime（seam 违约）无防护，写序可能交叉 | 低 | #89 边界延续：独占性是租约移交契约（v1 无 Registry）；ADR「业务调用方不得取得可写 Yjs 引用」是上游纪律。Registry 落地时收口 |
| R7 | 第八键 + 新导出是公共面版本演进，下游（未来调用方）可能依赖 mutateRoot 的同时误期待 replaceSchema | 低 | ADR v1 两方法中本任务只交付其一（SA8 N1 范围切分）；类型面不存在 replaceSchema 键，误期待在编译期即失败 |
| R8 | `WriteSequencer.enqueue` 泛化改动共享模块（P0 依赖同文件） | 低 | 签名放宽（`Promise<void>` → `Promise<T>`，void 是 T 的实例）——P0 调用点零改动零行为变化；§13 caller 审计闭合 |
| R9 | 【R2 新增】公共联合 `issues: unknown[]` 放宽后，调用方静态面上失去元素形状提示（D9 放宽是冻结孪生强制的） | 低 | 三重缓解：① `RootMutationIssue` 名目保留导出并文档化为「运行时恒成立的元素形状」（构造侧纪律——四来源 disabled/snapshot/unavailable/管线透传全部 `{message, path}`）；② SA6 契约锚点 3 本就只写 `{ ok: false, issues }` 不锁元素类型（运行时形状由 12+2 冻结用例的行为断言锁定——`issue.message` typeof string / `issue.path` isArray 等）；③ 收窄风险单向（生产侧窄类型可赋值 unknown[]，未来若冻结锚点演进可无痛收窄公共类型） |

---

## SA2 反馈逐条回应（R2 修订）

评审来源：`wiki/raw/task_namespace-runtime-write-sequencer_sa2_review.md`（verdict reject，2026-08-24；2 CRITICAL / 1 HIGH / 1 MEDIUM / 1 LOW）。

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| #1 CRITICAL：D9 `MutateRootResult` 使 persistence 冻结孪生（`issues: unknown[]`）TS2430，typecheck 通道必红、AC10 不可达 → 放宽 ok:false 分支为 `issues: unknown[]`；`RootMutationIssue` 保留为文档类型与构造侧纪律 | ✅ | §4 D9（类型块 + 「R2 修订：放宽依据」段）、§1.1 映射表 D9 行、§9 AC9/AC10 行、§10 R9 | `MutateRootResult = { ok: true } \| { ok: false; issues: unknown[] }`；`RootMutationIssue` 保留导出并重定位为「构造侧纪律 + 元素形状文档名目」（内部四来源恒产 `{message, path}`）。设计期用仓库 tsc 5.9.3 + repo flags 双向实测：R1 形状复现 TS2430（persistence 孪生），R2 形状两孪生同时零错（§12 #11 命令与输出全录）；放宽方向论证（`unknown[] ⊑ T[]` 仅当 T=unknown；SA6 契约锚点 3 只写 `{ok:false, issues}` 不锁元素类型；收窄风险单向） |
| #2 CRITICAL：D3 数组分支缺三项检查（symbol own 键 / 非枚举 own 键 / accessor 下标）——symbol 与非枚举键被静默丢弃、accessor getter 在 S3 被执行，违反 ADR-0008 拒绝清单 | ✅ | §4 D3（数组分支整段重写：①②③④⑤ 序 + 「数组/对象分支纪律对齐」「path 数组同纪律」要点）、§1.1 映射表 snapshotter 行、§6.2 #11 | 数组分支移植对象分支四查纪律：① `getOwnPropertySymbols > 0` 拒；② `getOwnPropertyNames` 过滤 `'length'` 后与 `Object.keys` 数量比对拒非枚举（含非枚举下标）；③ **descriptor 全表扫描先于任何值读取**——`d === undefined` 拒（空洞/原型链污染，不读原型值）、`get/set ≠ undefined` 拒 accessor（getOwnPropertyDescriptor 是元数据读取不执行 getter——SA2 红灯 `calls === 0` 的次序保证）；④ keys-vs-length 拒可枚举非索引键（与 ② 互补覆盖）。设计期 node 实测：R1 三盲区全部绕过、R2 分支全部拒绝且 getter 调用 0、密集数组照收（§12 #11）；`path` 数组走同分支免费覆盖其红灯族；`length` 不可重定义为 accessor（实测 `Cannot redefine property: length`）——无逃逸面。与 SA8 追加决策点 4 同方向（拒绝侧加强），无需回 SA8 |
| #3 HIGH：§7.2「设计期已核对」只覆盖 sequencer 一文件——方法论缺口是 #1 根因；要求逐文件列出全部 src 类型约束点 + 显式 tsc 全绿门 | ✅ | §7.2（整节重写为逐文件核对表）、§9 AC10 行、§13（SA4 复核命令 + tsc） | 五行核对表逐文件列出：两 #90 测试文件（seam 字面量行号 + extends 孪生形状行号 + 可赋值性结论）、doc-runtime 两守卫文件（值/类型导出面）、#89 五冻结文件（seam 字面量不传 notifyDirty + 接口加法兼容 + p0-sequencer 注入双 cast 实读核实）。新增显式验收门：`./node_modules/.bin/tsc -p tsconfig.typecheck.json --noEmit` 零错（现状基线 4 错的构成 + 两孪生同编为必查项 + sequencer 孪生「修订前后都必须编译」反向锚） |
| #4 MEDIUM：`RuntimeWriteFatalPhase` 声明地（errors.ts）与导出地（write.js re-export）自相矛盾 → 统一同源 | ✅ | §4 D5.1（注释明确「类与 phase 类型均落 errors.ts」）、§4 D8'（`export type { RuntimeWriteFatalPhase } from './errors.js'`，write.ts 只承载结果联合类型并 import 消费）、§3 模块树、§11 ALLOW LIST（errors.ts/index.ts/write.ts 条目同步） | 类型声明与值导出同源：`RuntimeWriteFatalError` + `RuntimeWriteFatalPhase` 都在 errors.ts 声明并从 errors.ts 导出；消除 R1 的 D5.1/§3/§11 与 D8' 二选一分歧，去掉无谓 re-export 间接层 |
| #5 LOW：§6.2 #8 只描述 S6 成功路径挂住；fatal 路径 best-effort notifier 挂住同样使 rejection 永不送达、队列停滞 | ✅（措辞/覆盖扩展，行为零变化） | §6.2 #8 | 扩展为「两处 notifier await 共用同一停滞语义」：(a) S6 成功路径 + (b) fatal best-effort 路径（D5.3 ②）；点名 fatal 路径的可观测性缓解——`markWriteFatal` 同步先行使 `status.fatal` 在挂住窗口内已可观测、新调用经 S1 拒 disabled；援引 SA2 红灯构想 #5（「停滞而非静默跳过/降级」锁定用例），供 SA6/SA4 落地 |

---

## §11. 文件清单（File Scope）

### ALLOW LIST

- `packages/namespace-runtime/src/write.ts` — **新建**，写槽 S1–S7 + 受控 snapshotter（数组分支四查【R2】）+ fatal 分类/mark + 结果联合类型 `RootMutationIssue`/`MutateRootResult`（issues: unknown[]【R2】）（§4 D2/D3/D5/D9，约 270 行）
- `packages/namespace-runtime/src/runtime.ts` — 修改，seam `+notifyDirty` 可选字段（V1 校验+捕获三行式）、WriteEnv 一次成型、公共面第八键 `mutateRoot`、生产工厂加 notifier 必填参数（§4 D1/D6，约 +45 行）
- `packages/namespace-runtime/src/sequencer.ts` — 修改，`enqueue` 泛化 `Promise<T>` + tail `Promise<unknown>` + 头注释「真实写槽已挂接」（§4 D7，约 6 行增量）
- `packages/namespace-runtime/src/errors.ts` — 修改，`RuntimeWriteFatalError` 类 + `RuntimeWriteFatalPhase` 类型（【R2】同源声明于此）+ `NSRT-FATAL-WRITE-INTERNAL` code/message 常量 + `RUNTIME_WRITE_DISABLED` 等稳定码常量（§4 D5/D9，约 +45 行）
- `packages/namespace-runtime/src/index.ts` — 修改，`+RuntimeWriteFatalError` 值导出 + `RuntimeWriteFatalPhase`（自 errors.js【R2】）+ `RootMutationIssue`/`MutateRootResult`（自 write.js）类型导出 + 头注释修订（§4 D8'，约 +6 行）
- `packages/namespace-runtime/package.json` — 修改，版本 0.1.0 → 0.1.1（硬门禁 9）
- `packages/doc-runtime/src/index.ts` — 修改，恢复 `export { applyValidatedMutation }` + `MutationIssue`/`ApplyValidatedMutationResult` 类型导出 + 头注释（§4 D8，+3 行）
- `packages/doc-runtime/package.json` — 修改，版本 0.1.7 → 0.1.8（硬门禁 9）
- `packages/namespace-runtime/test/runtime-mutate-root-sequencer.test.ts` — `[SA6 owned]` 已存在（冻结验收锚，本任务不改；转绿即验收）。SA3 不得改断言逻辑
- `packages/namespace-runtime/test/runtime-mutate-root-persistence.test.ts` — `[SA6 owned]` 同上
- `packages/doc-runtime/test/public-surface-guard.test.ts` — `[SA6 owned]` SA6 已更新（守卫翻转正锚），本任务不改
- `packages/doc-runtime/test/public-surface-type-guard.test-d.ts` — `[SA6 owned]` 同上

### DENY LIST

- `packages/namespace-runtime/src/p0.ts` — P0 槽体/状态机/形状守卫零改动（写槽只读消费 RuntimeState/activeTools；§3）
- `packages/namespace-runtime/src/status.ts` — 六键 status 投影零改动（fatal 位公式已天然覆盖写 fatal：`!fatal` 不区分来源）
- `packages/namespace-runtime/src/projection.ts` — 读取面零变化（INV-W10）
- `packages/namespace-runtime/tsconfig.json` — include src/** 决议延续（#89 §7.1；write.ts 落 src/ 自动入检）
- `packages/doc-runtime/src/mutation.ts` 及 doc-runtime 其余全部 src — 管线契约冻结（#87 交付；本任务只动 index.ts 导出面）
- `packages/vfsl/**`、`packages/vfsl-protocol/**`、`packages/vfsl-codegen/**` — 编译契约消费方，不改
- `packages/persistence/**`、`packages/dsh-persistence/**` — 持久层契约稳定，只消费类型与测试设施
- `packages/namespace-runtime/test/` 其余五文件（#89 冻结）— 任何 SA 不得改
- 根 `package.json`（typecheck 已含七包）、`pnpm-lock.yaml`（零新依赖）、`vitest.config.ts`、`tsconfig.base.json`、`tsconfig.typecheck.json`、`.github/workflows/**` — 通配/串联已覆盖，零改动
- `docs/adr/**`、`CONTEXT.md` — 决策文本，工程任务不动

---

## §12. 协议假设依据 (Protocol Assumption Evidence)

| # | 假设 | 依据类型 | 依据内容（具体引用） | 风险等级 |
|---|---|---|---|---|
| 1 | `.then` 回调恒以微任务执行（绝不同步运行）；async 函数同步段永不 throw（异常进返回 Promise）——mutateRoot「同步接纳、不同步结算」的机制根源 | 官方文档引用（规范语义）+ 仓内先例 | ECMAScript PromiseJobs/NewPromiseResolveThenableJob；#89 设计 §12 #5 同款论证（P0 微任务起步已实证交付）；`sequencer.ts:33` 既有注释 | 低 |
| 2 | yjs 事务 cleanup 派发期 observer 抛错会从 `doc.transact` 调用栈内传播出来，且**写入已生效不回滚**——E203 committed:true 的可达性（SA6 committed:true 用例注入路径） | 现有测试引用（双源） | `packages/doc-runtime/test/sa7-fatal-dynamic-verify.test.ts:108-126`：observer 抛任意值 → 交付 committed:true / phase `observer-cleanup-throw`、**写入已落盘**断言；`replace-root-content.test.ts:551`；`fatal.ts:64-77` transactGuarded 源码（catch 位置=管线位置事实） | 低 |
| 3 | `applyValidatedMutation` 对畸形派生物（structure 非 root）抛 E204 `DocRuntimeFatalError` committed:false、零写入——SA6 committed:false 用例注入路径 | 现有测试引用 + 源码引用 | `mutation.ts:139-141/169-181`（(B) guard → DerivedInvariantError → E204）；`apply-validated-mutation-fatal-contract.test.ts`（committed fatal 契约面：exact identity / commit 状态 / Y.Doc 最终状态三断言组） | 低 |
| 4 | `saveDoc(handle)` 在 entry `persistence-degraded` 时仍 resolve（递增 dirtyGeneration）；仅 foreign/released handle 拒绝——S6 完成信号语义与「检查后降级仍登记」的持久层依据 | 源码引用 + ADR 条款 | `packages/persistence/src/lifecycle.ts:216-229`（「degraded is NOT a rejection reason」注释 + foreign/released throw）；ADR-0006 #79 修订节原文（relevant_decisions 摘录 L75-77） | 低 |
| 5 | MemoryPersistence `createDoc` 返回 handle 持有调用方传入的同一 live Y.Doc 实例——写槽对 `env.doc` 的事务即测试对 `doc` 的观测对象 | 现有测试引用 | `packages/persistence/src/testing.ts:241-244`：`expect(handle.doc).toBe(doc)`；#89 设计 §12 #10 同款锚定 | 低 |
| 6 | 递归冻结快照值流入 doc 存储前必被 `copyJsonDomain` 克隆为全新可变普通值（defineProperty 安全写入）——冻结不外泄进 doc/读取面/持久化编码 | 源码引用 | `detached-build.ts:185-212`：plain array/object 分支构造 `out = []` / `out = {}` 全新容器（INV-7 引用隔离注释）+ defineProperty；读取面另有 `read.ts:355/403` copyPlainStrict 深拷贝（ADR-0008「返回值是可变普通深拷贝」）双保险 | 低 |
| 7 | vitest `--typecheck` 会编译 `packages/*/test/**/*.ts`（经 tsconfig.typecheck.json include）——SA6 seam 字面量/接口扩展必须对 src 类型可赋值 | 设计期实测验证（红灯证据）+ 源码引用 | `vitest.config.ts:7-11`（`typecheck.tsconfig`）+ `tsconfig.typecheck.json` include 列表；简报红灯证据：`pnpm test` typecheck 阶段 2 处 `notifyDirty does not exist in type 'NamespaceRuntimeSeamInput'`——即该通道对 .test.ts 字面量做 excess property 检查的直接实证 | 低（已纳入 §7.2 设计约束） |
| 8 | namespace-runtime 测试文件不经 `pnpm typecheck`（include 仅 src/**），但经通道 B 全量编译——两通道互补全覆盖 | 源码引用 | `packages/namespace-runtime/tsconfig.json`（include src/**）+ 根 `package.json:13` typecheck 串联 + §12 #7 通道 B 实证 | 低 |
| 9 | `applyValidatedMutation` 成功恰产生 1 次 Y.Doc update 事件、普通失败 0 次（state 字节不变） | 现有测试引用 | `apply-validated-mutation-nested-path-repro.test.ts:39-58`（成功提交断言）；#87 全套件（`pnpm test` 基线 1002 用例绿——简报「现状基线」）；SA6 sequencer:300-311 以本行为为锚 | 低 |
| 10 | `enqueue` 泛化后 P0 用法（T=void）与既有队列行为零变化 | 源码引用 + 类比已有验证 | `runtime.ts:102` 唯一既有调用点（`void sequencer.enqueue(() => runP0(env))`）；泛型化是签名放宽（void ∈ T）；#89 五冻结测试（runtime-p0-sequencer 等）回归锚定 | 低 |
| 11 | 【R2 新增，SA2 #1/#2】(a) 公共联合 `issues: unknown[]` 是两冻结孪生同时编译的唯一形状；(b) 数组分支三盲区（symbol 键/非枚举键/accessor 下标）在 R1 检测下全部绕过、R2 四查下全部拒绝且 accessor 例 getter 零执行；(c) 数组 `length` 不可重定义为 accessor | 设计期实测验证（三组命令 + 输出） | (a) `tsc --noEmit --strict --exactOptionalPropertyTypes --noUncheckedIndexedAccess --target ES2022 --module ESNext --moduleResolution bundler`（仓库 node_modules/.bin/tsc 5.9.3）：probe-r1（R1 形状 issues: RootMutationIssue[] + 两孪生）→ `TS2430: Interface 'PersRuntime' incorrectly extends…'unknown[]' is not assignable to type 'RootMutationIssue[]'`（sequencer 孪生通过）；probe-r2（issues: unknown[] + 两孪生 + 生产侧窄类型构造）→ **零错**。(b) node 实测：`[1,2]+symbol 键` / `+非枚举 'meta'` / `+accessor index 0` 三例在 R1 检测（keys.length !== length）下均为 false（绕过）；R2 分支仿真分别拒绝（symbol 键/非枚举 own 键/accessor 下标 0，getter calls = 0——descriptor 先于值读取），密集数组 accept、空洞/非枚举下标/可枚举额外键各拒绝。(c) `Object.defineProperty(a,'length',{get(){…}})` → `TypeError: Cannot redefine property: length`——length accessor 异形结构性不存在 | 低（(a) 已消解：D9 放宽；SA2 评审独立复现同结论） |

---

## §13. 契约改动连锁审计 (Contract Change Caller Audit)

### 改动函数/类型

| 函数/类型 | 文件 | 改动前契约 | 改动后契约 |
|---|---|---|---|
| `WriteSequencer.enqueue` | `packages/namespace-runtime/src/sequencer.ts:35` | `(run: () => Promise<void>) => Promise<void>` | `(run: () => Promise<T>) => Promise<T>`（泛型放宽；模块不导出，包内私有） |
| `createNamespaceRuntime` | `packages/namespace-runtime/src/runtime.ts:122` | `(handle: DocHandle) => NamespaceRuntime` | `(handle: DocHandle, notifyDirty: () => Promise<void>) => NamespaceRuntime`（包内私有，不导出） |
| `NamespaceRuntimeSeamInput` | `packages/namespace-runtime/src/runtime.ts:38` | `{ handle, p0Gate?, compile? }` | `+notifyDirty?: () => Promise<void>`（可选字段增广，非破坏） |
| `NamespaceRuntime` | `packages/namespace-runtime/src/runtime.ts:48` | 七键（含 5 读取方法） | `+mutateRoot: (mutation: unknown) => Promise<MutateRootResult>`（接口加法） |
| `@nomicore/doc-runtime` index | `packages/doc-runtime/src/index.ts` | 不导出 mutation 入口 | `+applyValidatedMutation` 值导出 + `MutationIssue`/`ApplyValidatedMutationResult` 类型导出（纯加法） |

**无 return→throw / catch→rethrow / 同步变异步 类改动**：本设计不修改任何既有函数体的 throw 行为、返回类型或 async 性；全部是签名放宽与接口/导出加法。

### Caller 清单

| Caller | 文件:行号 | 是否 await | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---|---|---|---|---|
| `sequencer.enqueue`（P0 用法） | `packages/namespace-runtime/src/runtime.ts:102` | 否（`void` 丢弃——P0 完成信号无消费方） | N/A（runP0 全 catch，INV-N12） | sequencer 链尾 noop | 泛型化后 T=void 零变化；无需改动 |
| `sequencer.enqueue`（mutateRoot 槽，新增） | `packages/namespace-runtime/src/runtime.ts`（D1 第八键） | 是（返回调用方，由调用方 await） | 槽体内部全分类（gate/快照/管线 fatal——D2/D5） | sequencer 链尾 noop（INV-W12） | 新增 caller，设计内闭合 |
| `createNamespaceRuntime` | **全仓 grep 零调用**（仅 index.ts 注释提及；ownership 测试断言 `entry.createNamespaceRuntime === undefined`） | — | — | — | 加参无连锁；未来 Registry 是唯一预期 caller（D6.3） |
| `NamespaceRuntimeSeamInput` 消费（构造调用字面量） | namespace-runtime 七个测试文件（#89 五冻结 + #90 两新）；生产侧无（工厂包内） | 否（同步构造） | N/A（V1 校验 throw 属构造契约） | — | 可选字段增广：不传即不绑定（#89 五文件合法延续）；#90 两文件的 `notifyDirty` 字面量正是红灯 TS 报错点，加字段即消解（§12 #7） |
| `NamespaceRuntime` 类型消费 | 全部测试文件（`import type`）+ `MutateRootRuntime extends`（sequencer:70-81、persistence:44-46） | — | — | — | 接口加法：既有七键消费零影响；extends 重声明要求各孪生 `TestResult ⊑ MutateRootResult`——【R2】sequencer（`MutationIssue[]`）与 persistence（`unknown[]`）两孪生逐文件核对见表 §7.2，放宽 `issues: unknown[]` 后同时编译（§12 #11 实测） |
| `applyValidatedMutation`（新增公共 caller） | `packages/namespace-runtime/src/write.ts`（S5，新增） | 同步调用（非 await——函数是同步的） | 是（唯一 try/catch：DocRuntimeFatalError 分级 + 未知异常保守，D5.2） | rejectWithWriteFatal 统一 fatal 通道 | 设计内闭合 |
| `applyValidatedMutation`（既有内部 caller） | doc-runtime 测试经 `../src/mutation.js` 相对导入（4 文件） | 同步 | 各测试自持 | — | **不经 index.ts**——公共导出恢复与其正交，零影响 |
| `entry.createNamespaceRuntimeWithSeam`（index 值导出） | 七测试文件 + write.ts 不涉及 | 同步 | 测试自持 | — | 导出面不变（仅新增 RuntimeWriteFatalError 值导出——冻结锚点要求其存在） |

### 风险评估

- **遗漏 caller 的代价**：enqueue 泛化若漏改调用点 → 类型不匹配编译红（通道 A/B 双覆盖，非运行时风险）；createNamespaceRuntime 加参若存在隐藏 caller → 同样编译红。两处均已 grep 闭合（`git grep -n "createNamespaceRuntime\b"` 仅定义+注释+缺席断言）。
- **抓全 caller 的方法**（SA4 复核命令）：
  ```bash
  git grep -n "\bcreateNamespaceRuntime\b" -- 'packages/**/*.ts'
  git grep -n "\.enqueue(" -- 'packages/namespace-runtime/**/*.ts'
  git grep -n "applyValidatedMutation" -- 'packages/**/*.ts'
  git grep -n "createNamespaceRuntimeWithSeam" -- 'packages/**/*.ts'
  # 【R2 新增，SA2 红线 #1】typecheck 通道全绿门（与 pnpm test typecheck 阶段同一程序）：
  ./node_modules/.bin/tsc -p tsconfig.typecheck.json --noEmit   # 实现后必须零错
  ```

---

## 附：交付声明（R2）

R1 交付面全部保持（简报 10 条验收标准 §9 映射、SA8 前置门禁与设计后复审双 clear、SA6 四测试文件可观测断言 §1.3 逐行归纳、槽序与 ADR-0008 逐位对应、fatal 通道逐句兑付、notifyDirty loud gate、#89 五冻结测试零触碰全绿兼容、文件清单/协议假设/契约审计三章齐备）。

**R2 修订落实 SA2 R1 reject 评审全部 5 个攻击点**（2 CRITICAL / 1 HIGH / 1 MEDIUM / 1 LOW，逐条回应表见上）：

1. **#1 CRITICAL（类型契约）**：`MutateRootResult` 公共联合 issues 放宽 `unknown[]`——设计期 tsc 双向实测（R1 形状 TS2430 复现 / R2 形状两冻结孪生同时零错），§7.2 重写为逐文件核对表并增设 `tsc -p tsconfig.typecheck.json --noEmit` 全绿显式验收门；
2. **#2 CRITICAL（snapshotter 拒绝清单）**：数组分支增补 symbol 键 / 非枚举 own 键（含非枚举下标）/ accessor 下标三查与「descriptor 全表扫描先于任何值读取」次序（getter 零执行）——node 实测三盲区从全部绕过转为全部拒绝，密集数组照收；`path` 数组同纪律免费覆盖；与 SA8 追加决策点 4 同方向（无需回 SA8）；
3. **#3 HIGH（方法论）**：§7.2 从单文件核对扩展为全部 SA6 冻结文件 + #89 五文件的逐文件 src 约束点核对表；
4. **#4 MEDIUM（一致性）**：`RuntimeWriteFatalPhase` 与 `RuntimeWriteFatalError` 统一同源声明并导出自 errors.ts，消除 R1 声明地/导出地矛盾；
5. **#5 LOW（覆盖）**：§6.2 #8 扩展为两处 notifier await 共用停滞语义（含 fatal best-effort 路径的可观测性缓解）。

每条修订均有设计期实证（命令 + 输出录于 §12 #11）支撑，非形式承认。交出控制权，等待 SA2 复审。
