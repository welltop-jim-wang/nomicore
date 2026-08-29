# Issue #149 设计文档 — NamespaceRuntime ROOT/SCHEMA 写路径接入诊断变更日志

> SA1 出品 · 任务类型 Bug 修复 · 父 PR #142（`docs/namespace-diagnostic-change-log`）
> 红灯契约：`packages/namespace-runtime/test/runtime-root-schema-diagnostic-red.test.ts`（14 it，2026-08-29 验证 14/14 红）
> 依赖状态：#148 的 v1 contract 已由 #156（`7ceede1`，"Freeze the v1 diagnostic record contract and memory adapter"）落地并合并；#159/#166（stream 持久化与修复）亦已合并。**依赖满足，无阻塞**。worktree 现状以 git log 证实。

---

## §1. 根因推演（Bug 的最深层原因）

红灯症状：14 个测试全部因「`log.records()` 恒 0 / `emitCalls` 恒 0」失败——业务断言全部先行通过。这不是某条路径漏发记录的单点缺陷，而是**接线整体缺失**：NamespaceRuntime 的写管线在诞生时（#89/#90/#91/#92）早于诊断日志契约（#142/#148/#156），从未存在任何 emission 通道。缺口按层拆解为四层（与 SA5 划分一致）：

| 层 | 缺口 | 现状证据 |
|---|---|---|
| L1 依赖层 | `@nomicore/namespace-diagnostic-log` 不在 namespace-runtime 的 `dependencies` | `packages/namespace-runtime/package.json`（当前仅 doc-runtime/persistence/vfsl/yjs） |
| L2 注入层 | `NamespaceRuntimeSeamInput` 无 `diagnosticEmitter` / `clock` 字段；`captureSeamInput` 不捕获 | `runtime.ts:53-64`（seam 接口）、`runtime.ts:313-389`（捕获器） |
| L3 发射层 | `runRootWriteSlot` / `runSchemaWriteSlot` / 公共方法接纳层零 emit——每条既有结局点（disabled/fatal/快照拒绝/领域失败/成功）均无诊断产出 | `write.ts:77-166`、`schema-write.ts:102-199`、`runtime.ts:233-252` |
| L4 payload 层 | 成功事务的精确 update bytes 无捕获机制——`applyValidatedMutation` / `replaceSchemaAndRoot` 成功只返回 `{ok:true}`（ADR-0007 冻结，正确且不可动），槽内无人消费事务增量 | `mutation.ts:40-54`、`schema-replace.ts:123-149` |

修复 = 把四层缺口一次补齐，同时**不改变任何业务面行为**（返回值、槽序、zero-write 承诺、fatal 通道、dirty notification、capability 状态）。

## §2. 设计总览

```
调用方 ──mutateRoot/replaceSchema──▶ runtime.ts 公共方法层
   │ lifecycle≠ready                      │ lifecycle===ready
   ▼                                      ▼
[acceptance 拒绝]                  sequencer.enqueue(thunk)
   同步 emit(acceptance,                  │ FIFO 取槽
   RUNTIME_WRITE_DISABLED,                ▼
   rejected, not-accessed)        runRootWriteSlot / runSchemaWriteSlot
                                        │ S1 fatal gate ──▶ diag: capability-gate 拒绝
                                        │ S2 writable gate ─▶ diag: capability-gate（三种结局）
                                        │ S3 受控快照 ──────▶ diag: input-snapshot 或 input←snapshot
                                        │ S4 schema 门/编译 ▶ diag: capability-gate / schema-compile
                                        │ S5 事务（update 窗口：doc.on('update') 夹住同步调用）
                                        │     │            ▶ diag: validation / transaction(fatal)
                                        │ S6 notifyDirty ──▶ diag: dirty-notification fatal
                                        │ S7 return
                                        ▼
                              settled promise（slot 释放）
                                        │ .then(emit, emit) ← emit 点在 slot 之外
                                        ▼
                          emitAttempt（try/catch 吞没一切）
                                        ▼
                    NamespaceDiagnosticChangeEmitter.emit（语义 emission）
                                        ▼
                adapter（memory/File）独立做 storage projection + VFSL 门
```

三个结构性决策（详见 §4–§7）：

- **D-A（发射点）**：emit 挂在 `sequencer.enqueue(...)` 返回 promise 的 `.then` 链上——**write sequencer slot 已释放之后**的微任务内、且先于下一任务取得槽（§7 时序证明）。acceptance 拒绝（零入队路径）在公共方法调用栈内同步 emit。二者共同满足 ADR-0012 首切片 amendment C「emit 调用点必须位于 write sequencer slot 之外或该 slot 已释放之后」。
- **D-B（owned bytes）**：S5 外围用 `doc.on('update')` 订阅窗口捕获**该事务的增量 update**（yjs 事务 cleanup 原生投递面），零 doc-runtime 改动（§6 协议依据 + 与「改 doc-runtime 签名」备选方案的对比裁决）。
- **D-C（诊断通道）**：槽函数新增**可选第三参数** `diag`（per-attempt 收集器）；`diag === undefined ⇔ 未装配 emitter`，此时槽体所有写入点退化为 `diag?.x()` 可选链——无日志基线**行为等价**（await 消费者可观测面不变；【R1 修订，SA2 #6】非「逐字节不变」：emit 挂点使全部写调用返回的 promise 成为 settled 的派生 promise、结算多一跳微任务——对 await/then 消费者不可观测，但时序敏感的内部测试是回归风险点，SA4 验收含全量套件零回归，§13.5）。

## §3. 业务隔离总纲（AC4 的结构保证）

ADR-0011 §A 的隔离要求由以下四道防线承载，每道都有机制（非约定）支撑：

| 防线 | 机制 |
|---|---|
| emit 不改变返回值 | emit 在 `.then(onOk, onErr)` 回调内执行：onOk 分支 `emit(); return r;`，onErr 分支 `emit(); throw e;`——emit 自身被 try/catch 全吞（§7.2），原值/原 rejection 原样传播 |
| emit 不延长 slot | emit 时点 = settled promise 的微任务回调，slot（thunk→settled）已终止；「慢 emit」只占用自身微任务，不落在任何 slot 持续窗口内（amendment C 合规） |
| emit 不改变 FIFO | emit 回调注册晚于 sequencer 内部 `tail.then(noop)` 接线、早于下一任务 thunk 排程：settled resolve 时微任务依序 [noop, emit]，下一任务挂在 noop 产物 tail 之后——emit 顺序 ≡ 槽完成顺序 ≡ FIFO（§7.1 证明） |
| emit 不改变 capability | emit 路径零接触 `state.fatal` / `state.lifecycle` / handle；emitter throw / queue full / clock 违约全部吞没于 `emitAttempt` 的 try/catch，无任何向业务状态的写路径 |

## §4. L1 依赖层

`packages/namespace-runtime/package.json` 的 `dependencies` 增加一行：

```json
"@nomicore/namespace-diagnostic-log": "workspace:*"
```

- 依赖方向合法性：诊断包仅依赖 `@nomicore/vfsl` + node:crypto/Buffer（其 index.ts 头注声明），不依赖 namespace-runtime——无环。
- 本包对它的值级依赖**恰一处**：运行期调用 `emitter.emit(...)`（接口方法调用）；其余全部 **type-only import**（`import type`，`verbatimModuleSyntax` 下擦除）。**不引入诊断包的任何值级模块导出**（含 `observedAtFrom`——值引入会经其 `index.ts` 运行图拉入 reader/file 等模块；observedAt 由本包 3 行本地 helper 实现，见 §7.2 注记）。【R1 修订，SA2 #4】
- 实施注意（SA3）：pnpm workspace 加依赖后需 `pnpm install` 更新 lockfile 与 node_modules 链接；`tsconfig.base.json` 为 `moduleResolution: bundler`、无 project references，包名解析依赖 workspace 链接建立。红灯测试自身的相对路径 import（`../../namespace-diagnostic-log/src/index.js`）无需改动。

## §5. L2 注入层（seam 扩展）

### 5.1 `NamespaceRuntimeSeamInput` 新增两个可选字段

```ts
export interface NamespaceRuntimeSeamInput {
  readonly handle: DocHandle;
  readonly p0Gate?: Promise<void>;
  readonly compile?: (envelope: SchemaEnvelope) => CompileSchemaEnvelopeResult;
  readonly notifyDirty?: () => Promise<void>;
  /** [新增] 诊断发射接缝：ADR-0011 §E emitter 接口。缺省 = 未装配（零 emit、零 update 订阅）。 */
  readonly diagnosticEmitter?: NamespaceDiagnosticChangeEmitter;
  /** [新增] 诊断 observedAt 的注入 Clock（结构兼容 @nomicore/clock Clock.now /
   *  诊断包 emission.ts observedAtFrom）。
   *  【R1 修订，SA2 #5】与 diagnosticEmitter 成对：装配 emitter 而缺 clock ⇒ 构造期
   *  loud 拒绝（§5.2）——消除「装配日志而静默走系统墙钟」形态；生产装配（未来
   *  Registry 票）必须显式注入 Clock（与 SA8 冲突点 #4 移交裁决呼应）。 */
  readonly clock?: () => number;
}
```

### 5.2 `captureSeamInput` 校验与捕获（沿 INV-N14 纪律：构造栈内有限次读取、入队前完成、违者零副作用 throw）

```ts
// 新增捕获分支（落位于既有 doc 捕获之后——doc 局部量已可用；与 compile/notifyDirty 同款三行式）：
let diagnosticEmitter: NamespaceDiagnosticChangeEmitter | undefined;
if (rec.diagnosticEmitter !== undefined) {
  const e = rec.diagnosticEmitter;
  if (typeof e !== 'object' || e === null || typeof (e as { emit?: unknown }).emit !== 'function') {
    throw new TypeError('input.diagnosticEmitter 若提供必须是含 emit 方法的对象（NamespaceDiagnosticChangeEmitter 契约）');
  }
  diagnosticEmitter = e as NamespaceDiagnosticChangeEmitter;
  // 【loud assert，非静默降级；R1 修订 SA2 #1：校验对象 = doc（handle.doc，Y.Doc 事件面），
  // 不是 handle——DocHandle 契约（persistence/src/contract.ts）只有 owner/docId/doc/
  // getStatus/release 五键，无 on/off；on/off 是 Y.Doc（handle.doc）的事件面标配】
  // 装配诊断发射即要求 doc 具备事务事件订阅面：缺 on/off 属上游契约破坏，构造期 loud
  // 拒绝（沿「残缺 handle 校验前置于 enqueue」先例，INV-N4），绝不静默吞掉后把
  // 「应有 update 的记录」降级成 noop/omitted。
  const d = doc as unknown as Record<string, unknown>;
  if (typeof d.on !== 'function' || typeof d.off !== 'function') {
    throw new TypeError('装配 diagnosticEmitter 时 handle.doc（Y.Doc）必须具备 on/off 方法（yjs 事务事件契约——owned bytes 捕获依赖）');
  }
}
let clock: (() => number) | undefined;
if (rec.clock !== undefined) {
  if (typeof rec.clock !== 'function') {
    throw new TypeError('input.clock 若提供必须是 function（() => number，epoch ms）');
  }
  clock = rec.clock as () => number;
}
// 【R1 修订，SA2 #5】成对 loud 校验：装配 emitter 而缺 clock ⇒ 拒绝（无墙钟缺省——
// observedAt 的唯一来源是注入 Clock，ADR-0012 §observedAt）
if (diagnosticEmitter !== undefined && clock === undefined) {
  throw new TypeError('装配 diagnosticEmitter 时必须同时注入 clock（() => number）——observedAt 不接受静默系统墙钟');
}
```

要点：
- **校验对象精度（R1，SA2 #1）**：事件面校验读取的是 `doc`（= `handle.doc`，runtime.ts 既有 doc 捕获局部量）——`handle` 本身无 on/off（DocHandle 契约五键）。红灯套件的 Proxy handle 例（`get` trap 仅劫持 `getStatus`，其余 `Reflect.get` 透传）下，`h.doc` 透传真 Y.Doc，校验通过——**不炸任何合法装配**。
- **条件校验的半径**：`doc.on/off` 与 clock 成对校验仅在 `diagnosticEmitter` 提供时生效——未装配诊断的既有调用路径（全部现有测试与生产装配）构造行为零变化。
- `DiagnosticEnv` 在构造栈一次成型（emitter 装配 ⇔ clock 必在）。【R3 修订：对齐 SA3 实现的判别联合形态——未装配态 `clock` 同为 `undefined`（R1 删除 `Date.now()` 缺省后的类型面必然：未装配时不存在任何可调 clock），装配态两字段同现；成对性由 §5.2 构造期 loud 校验前置保证，`buildDiagnosticEnv` 总函数只做类型面落地】

```ts
// 新文件 diagnostic.ts（SA3 实现形态）
export type DiagnosticEnv =
  | { readonly emitter: undefined; readonly clock: undefined }                    // 未装配（现状生产路径）
  | { readonly emitter: NamespaceDiagnosticChangeEmitter; readonly clock: () => number }; // 装配（成对成立）

/** 总函数形态：任意输入组合给出良构 env；「emitter 在而 clock 缺」已在构造期被
 *  loud TypeError 拦截（§5.2），本函数内不可达——防御性归一为未装配态。 */
export function buildDiagnosticEnv(
  emitter: NamespaceDiagnosticChangeEmitter | undefined,
  clock: (() => number) | undefined,
): DiagnosticEnv {
  return emitter !== undefined && clock !== undefined
    ? { emitter, clock }
    : { emitter: undefined, clock: undefined };
}
```

`DiagnosticEnv` 不进 `WriteEnv`/`SchemaWriteEnv`（那是 per-runtime 槽环境，而 emit 点在槽外）；槽内只接 collector（§7.3）。

## §6. L4 payload 层 — owned update bytes 捕获（D-B）

### 6.1 机制：yjs 事务投递面 + 订阅窗口

新文件 `packages/namespace-runtime/src/diagnostic.ts` 提供：

```ts
/**
 * 事务 update 捕获窗口：订阅 → 同步执行 run → 退订（try/finally 保证异常路径同样退订）。
 * 窗口内 run 同步完结（applyValidatedMutation / replaceSchemaAndRoot 均为同步函数，
 * 内部恰一个 doc.transact）；JS run-to-completion 保证窗口内无其他代码运行——
 * 事件时序完全确定（0 或 1 次派发）。
 */
export function withUpdateCapture<T>(doc: Y.Doc, run: () => T): { value: T; update: Uint8Array | undefined } {
  let captured: Uint8Array | undefined;
  const handler = (u: Uint8Array): void => { if (captured === undefined) captured = u; };
  doc.on('update', handler);
  try {
    const value = run();
    return { value, update: captured };
  } finally {
    doc.off('update', handler); // try/finally：throw 路径同样退订；captured 已在 throw 前赋值
  }
}
```

> 实施注：SA3 落地时槽内采用「handler 写槽体局部变量 + try/finally 只负责退订」的等价形态（§8 伪代码）——fatal 路径（S5 throw）下捕获值经局部变量自然保留，供槽内 catch 的诊断写入读取。

### 6.2 协议依据（关键假设的源码证据）

本设计唯一的协议级假设是「yjs 事务 update 事件的派发时机与 payload 语义」。证据（yjs@13.6.32，worktree 实测锁定版本）：

- `node_modules/.pnpm/yjs@13.6.32/node_modules/yjs/src/utils/Transaction.js:362-367`：
  ```js
  doc.emit('afterTransactionCleanup', [transaction, doc])
  if (doc._observers.has('update')) {
    const encoder = new UpdateEncoderV1()
    const hasContent = writeUpdateMessageFromTransaction(encoder, transaction)
    if (hasContent) {
      doc.emit('update', [encoder.toUint8Array(), transaction.origin, doc, transaction])
  ```
  证明三点：① payload 由 `writeUpdateMessageFromTransaction` 从**该 transaction** 写出——是事务增量，不是事务后整文档编码（ADR-0011 §D「不得冒充」红线的正面满足）；② `hasContent === false`（事务零内容变更）时**不派发**——「窗口内零事件 ⇔ effect: noop」的机制依据；③ `encoder.toUint8Array()` 新分配——owned bytes，无共享缓冲。
- `yjs/src/utils/Doc.js:172-174`（公开文档注释）："Changes that happen inside of a transaction are bundled... the observer fires _after_ the transaction is finished and all changes that happened inside the transaction are sent as one message"——单事务捆绑为**一次**派发。
- 派发同步性：cleanup 循环在 `transact(doc, f)` 调用栈内同步执行（`Transaction.js` 的 `transact` 实现 + `cleanupTransactionsArray` 调用位置）——窗口（on → S5 → off）必然覆盖派发点。
- 窗口内「恰 0/1 次」的结构性论证：S5 同步执行；`applyValidatedMutation` 内部 prepare 阶段纯读、事务段恰一次 `transactGuarded`（`mutation.ts:48`）；`replaceSchemaAndRoot` 同构（`schema-replace.ts:131`）。run-to-completion 下窗口内不可能有第三方代码开启另一事务。handler 的 `if (captured === undefined)` 首-赋值是对结构性不可达的多事件分支的保守防御（取首事件，不 merge——避免引入 `Y.mergeUpdates` 依赖与语义争议）。

### 6.3 与 ADR-0011 §D Consequences 的合规论证

ADR-0011 §D：「底层 transaction 模块应在不暴露 live Y.Doc 的前提下返回或投递 owned bytes」；Consequences：「doc-runtime/replication transaction seam 未来需要提供 owned update bytes；该演进不得暴露 live Y.Doc」。

本设计的读法与合规性：
1. **「投递」的实现面就是 yjs 事务 cleanup 的 update 事件**——它是 transaction 层的原生投递通道；本票在 runtime 侧订阅该通道，捕获点与事务执行零距离（同一调用栈），语义与「doc-runtime 内部捕获再上抛」**编码级等价**（同一事务、同一 payload 编码器 `writeUpdateMessageFromTransaction`——无第二编码路径）。
2. **不暴露 live Y.Doc**：doc 引用始终在 runtime 闭包内（构造期捕获，现状既有事实）；对外只交出 `Uint8Array`（owned 副本）。诊断记录、emitter、公共面均无 Y.Doc 引用。
3. **被否决的备选**：给 `applyValidatedMutation` / `replaceSchemaAndRoot` 增加可选 capture 参数。否决理由：a) ADR-0007 明文「applyValidatedMutation 成功只返回 `{ ok:true }`，不返回 snapshot、Yjs update 或内部类型」——返回形状冻结；参数面演进同样是 doc-runtime 公共契约改动，扩大 caller 审计半径（doc-runtime 直接调用方与测试群），与「本票改动半径最小化」冲突；b) 诊断是 producer（namespace-runtime）的职责边界——doc-runtime 无诊断知识，不该为单一 caller 演进公共签名；c) yjs 事件面与 seam 内捕获的 payload 完全同源，无信息损失。若未来 replication（#150/#151）需要同能力，本助手可原样提升至共享层——本票不做超前抽象。
4. **红线复检**：不用 `Y.encodeStateAsUpdate(doc)`（事务后整文档）冒充事务 update——本设计从不调用它；不用 mutation input / 逻辑 diff / 重放 materialization 冒充（ADR-0011 §D 明令禁止的三种冒充面全部不触碰）。

### 6.4 事务增量的可重放性契约（R2 修订——修正「空 Y.Doc 物化」错误声称）

> 【R2 修订，SA3 实施期矛盾】R1 版设计（沿 SA6 红灯注释）曾以「增量 bytes 应用到**全新空 Y.Doc** 可观察到该次事务效果」为 owned bytes 的行为证明。**该声称机制上不成立**；本节冻结修正后的消费契约。producer 侧（§6.1–§6.3 捕获机制、§9 映射、§7 发射）**零改动**——矛盾仅在测试/消费方的应用方式。

**机制事实（设计期实测验证，证据见 §14 P8）**：

1. 两槽事务体均为 **clear + 全量 set 重写**（`rootMap.clear()` + 全 entries set；SCHEMA clear + 恰四次 set）——新 items 的 **left origin**（同 parentSub 前驱 item 的 ID）与 clear 的 **delete set** 全部指向 **pre-state struct**。
2. 增量 bytes 应用到**空 Y.Doc 不物化**：缺失的 origin struct 使整个 update 静默丢弃（实测 `store.clients` 空、ROOT keys 空、不抛错、无可见效果；delete-set-only 引用 missing items 同样静默 no-op）。增量对空 doc 无效不是缺陷，是 yjs CRDT 增量语义的必然——增量只在**其基线上下文**中有意义。
3. **正确消费契约：同源基态 + 依序增量链**。基态 = 该 namespace **事务前 pre-state** 的 state update（同 clientID——`makeDoc()` 每次调用产生新 clientID，基态必须与被测 runtime 的 doc 同源）；`applyUpdate(base) → applyUpdate(tx₁) → applyUpdate(tx₂) → …` 链式应用后，doc 状态 ≡ 最后一笔事务后的源 doc 状态。实测：base→tx₁ 得 `n=42, a='x'`；base→tx₁→tx₂ 得 `n=7`——与红灯断言值一致。

**这正是 ADR-0011 的原生重放语义**：CONTEXT.md「namespace 诊断变更日志」术语定义——「**连续的** committed Yjs updates 可用于诊断性重放」——增量链而非孤立单条；ADR-0012 的 genesis baseline record 正是为「新 stream 的基线」而设（本票 emission 面不构造 genesis，但消费契约与之对齐：重放工具 = 基线 + 增量链）。

**消费纪律注记（R3 修订：链洞的静默不物化——增量重放的固有性质）**：若增量链存在**洞**（如 adapter queue-full 丢弃了中间一条 committed 记录——ADR-0011 §A「日志队列溢出可以丢弃记录」授权的 drop；或消费方跳读），洞**之后**的增量在「基态 + 残链」上静默不物化（与事实 2 同机制：洞后增量的 left origin 引用洞中事务创建的 item）。这是增量链重放的固有性质而非缺陷，且与日志定位声明完全一致——CONTEXT.md 术语定义：「尽力记录……日志不参与业务提交、**不承诺完整性或恢复能力**」（_Avoid_: 审计账本、WAL、event sourcing、可靠恢复日志）。重放工具的消费纪律：以 `AttemptRecord.sequence` 严格递增检测链洞（洞可观测、可上报），洞后增量不应用于重放断言；诊断性重放是尽力而为的观测工具，不是恢复机制。

**为什么不改为携带整文档编码（保真 ADR-0011 §D 事务增量限制）**：

- ADR-0011 §D 明文「日志不能通过事务后编码整个文档来冒充该次 transaction update」——切到整文档即踩红线；
- 增量 bytes 的记录层语义**正确无缺**：每条 committed / fatal committed:true 记录的 bytes 精确表达该事务在其基线上的效果；消费方持基态即可完整重放；
- 基态获取对消费方零成本：诊断日志消费工具与 namespace 同仓，基线即 genesis baseline record（#152 已交付）或任一时点快照；
- 「增量 + 基态 ≡ 事务后状态」的等价由实测钉死（§14 P8），不削弱「精确事务 effect」的验收力——反而更强：链式重放下可对**每条事务的中间态**分别断言（base→tx₁ 的中间态对整文档冒充不成立——应用整文档₁ 直接跳到终态，无法停在 tx₁ 边界；单条增量 bytes 的 payloadLength 亦远小于整文档编码，双重可鉴别）。

**SA6 红灯测试的相应修订要求（精确规格）见 §13.8。**

## §7. L3 发射层（D-A）

### 7.1 emit 挂点与 FIFO 顺序证明

`runtime.ts` 公共方法改造（mutateRoot 为例；replaceSchema 同构）：

```ts
mutateRoot: (mutation: unknown): Promise<MutateRootResult> => {
  if (state.lifecycle !== 'ready') {
    const result = disabled(lifecycleWriteRefusal(state.lifecycle));
    emitAttempt(diagEnv, {                    // SlotEmission 形态（§7.2 签名）
      operation: 'root-mutation', stage: 'acceptance',
      result: { kind: 'rejected' }, code: RUNTIME_WRITE_DISABLED_CODE,
      sourceModule: 'runtime', input: { status: 'not-accessed' },
      issues: result.issues as DiagnosticIssue[],  // 【R1，SA2 #3】gate 拒绝与业务返回同源透传
    }); // 同步 emit：零入队路径无 slot，公共入口即记录点（ADR-0011 §F）
    return Promise.resolve(result);
  }
  const diag = diagEnv.emitter !== undefined ? createSlotDiag('root-mutation') : undefined;
  return sequencer.enqueue(() => runRootWriteSlot(writeEnv, mutation, diag)).then(
    // 【R1 修订，SA2 #2】emitSlot 签名带入结算事实（onOk 收 r、onErr 收 rejection）——
    // 缺省组装仅在 r.ok === true 时生效（§7.3）；slot 已释放（settled 后微任务）
    (r) => { emitSlot(diagEnv, diag, { kind: 'fulfilled', value: r }); return r; },
    (e) => { emitSlot(diagEnv, diag, { kind: 'rejected' }); throw e; },  // fatal rejection 原样传播
  );
},
```

顺序证明（sequencer.ts:38-42 源码 + ECMAScript PromiseJobs 规范）：
- `enqueue` 内部：`settled = tail.then(run)`；`tail = settled.then(noop)`（先注册）；外部 `.then(emit)`（后注册）。
- thunk 完成 → `settled` settle → 微任务依注册序入队：`[noop, emit]`。`noop` 执行使 `tail` settle → 若下一任务已 enqueue，其 `run` 挂在 tail 之后，排在 `emit` 之后。
- 推论 ①：**emit 在本 slot 终止后执行**（slot = thunk 启动到 settled settle）——amendment C 合规。推论 ②：**emit 先于下一任务 thunk 启动**——emit 顺序 ≡ 槽完成顺序 ≡ FIFO，`capacity` 满时的 drop 顺序亦与业务顺序一致（AC4 队列满锚点：第 1 条 accepted、第 2 条 dropped）。推论 ③：`await mutateRoot()` 恢复时 emit 必已执行（外层 promise 在 emit 回调 return 后才 settle）——AC4 `emitCalls === 2` 的同步断言无 flaky 窗口。

### 7.2 emitAttempt：吞没一切（producer 防御义务）

```ts
// diagnostic.ts
/** 【R1 修订，SA2 #4】observedAt 本地 helper——与诊断包 observedAtFrom（emission.ts:105-107）
 *  同一 ISO 表达式（new Date(now()).toISOString()），非序列化规则复制；不引入诊断包值级
 *  模块导出（§4）。epoch 超出 ISO 表示域时 throw——producer 侧 bug，发生在 emit 之前。 */
function observedAtMs(now: () => number): string {
  return new Date(now()).toISOString();
}

export function emitAttempt(env: DiagnosticEnv, e: SlotEmission): void {
  if (env.emitter === undefined) return;
  try {
    env.emitter.emit({
      operation: e.operation,
      stage: e.stage,
      observedAt: observedAtMs(env.clock),    // 注入 Clock（ADR-0012；§5.2 成对校验保证必在）
      source: { kind: 'local' },             // ADR-0012 source 词表；Runtime 本地写路径
      ...(e.code !== undefined ? { code: e.code, sourceModule: 'runtime' as const } : {}), // 成对（§10-J3）
      ...(e.sourcePhase !== undefined ? { sourcePhase: e.sourcePhase } : {}),
      ...(e.issues !== undefined ? { issues: e.issues } : {}),
      input: e.input,
      result: e.result,
      // attemptId 省略 → emitter 管线 CSPRNG 生成 att-+32hex（pipeline.ts:221）
      // durationMs 省略（无可靠 monotonic 来源，不发明——ADR-0012 §observedAt）
      // context 省略（Runtime 无 runtimeGeneration/replication 身份可提供，全可选字段）
    });
  } catch {
    /* ADR-0011 §A：adapter 同步 throw 一律隔离——吞没，绝不改变业务结果。
       含 observedAtMs 对违约 clock（NaN/超域 epoch）的 throw：日志属 best-effort
       observability（ADR-0011 总纲），此处无第二真相源可发明（不得伪造时间戳），
       记录缺失即最终表现；producer 侧健康通道沿 ADR-0011 §F observer seam 留待
       未来票，本票不扩张公共面。 */
  }
}
```

- code↔sourceModule 成对性：pipeline §10-J3 会丢弃单侧字段——本设计从源头保证成对出现或成对省略。
- 敌意 emitter（emit 内 throw，AC4 注入）：吞没后业务 promise 照常 settle；`emitCalls` 计数在 throw 前已自增——`===2` 断言成立。
- 队列满（adapter 内部 drop，memory.ts:307-313）：emit 正常返回，drop 只进 adapter stats——业务无感知（AC4 锚点 `accepted===1 / droppedTotal===1 / queueDepth===1`）。

### 7.3 SlotDiag：per-attempt 收集器（槽内诊断事实 → 槽外 emission）

```ts
// diagnostic.ts
export interface SlotOutcome {
  readonly stage: Stage;
  readonly result: EmissionResult;
  readonly code?: string;            // 与 sourceModule 成对
  readonly sourcePhase?: string;
  readonly issues?: DiagnosticIssue[];
}
export interface SlotDiag {
  readonly operation: Operation;
  /** 输入捕获态：初始 not-accessed；S3 失败→unsafe-input；S3 成功→{snapshot}（同一 frozen 快照）。 */
  input: EmissionInput;
  /** 槽体各结局点单点写入（最后一个结局点胜——槽内无并发，确定性）。 */
  outcome: SlotOutcome | undefined;
  /** S5 捕获窗口产物（槽体 S5 后赋值）。 */
  updateBytes: Uint8Array | undefined;
}
```

- `createSlotDiag(operation)` 仅在 `diagEnv.emitter !== undefined` 时由公共方法构造——`diag === undefined ⇔ 未装配`。
- **emitSlot 组装契约（R1 修订，SA2 #2：签名带入结算事实；缺省组装仅在业务成功时生效——结构性杜绝「业务拒绝被伪装成 committed 记录」）**：

```ts
type SlotSettle<T> = { kind: 'fulfilled'; value: T } | { kind: 'rejected' };

function emitSlot<T extends { ok: boolean }>(env: DiagnosticEnv, diag: SlotDiag | undefined,
                                             settle: SlotSettle<T>): void {
  if (env.emitter === undefined || diag === undefined) return;
  if (diag.outcome !== undefined) {
    emitAttempt(env, { operation: diag.operation, input: diag.input, ...diag.outcome }); // 槽体显式结局——唯一常规路径
    return;
  }
  // ── INV-DIAG（内部不变量，SA2 #2 立法）：缺省组装仅对「业务成功」生效 ──
  if (settle.kind === 'fulfilled' && settle.value.ok === true) {
    emitAttempt(env, { operation: diag.operation, input: diag.input, stage: 'transaction',
      result: diag.updateBytes !== undefined
        ? { kind: 'committed', effect: 'update', updateBytes: diag.updateBytes }
        : { kind: 'committed', effect: 'noop' } });
    return;
  }
  // outcome 缺失 + 业务拒绝（ok:false resolve）或业务 rejection（fatal throw）：
  // §9 映射表（25 结局点）某拒绝/fatal 点漏写 diag outcome——**不 emit 该记录**（亮式
  // 不变量违约：宁可缺记录，绝不把业务拒绝伪装成 committed——Objective「区分 committed
  // 与 expected rejections」的存在目的；ADR-0011 §B「日志层不得发明成功语义」）。
  // 本票无 producer 健康通道（SA8 已裁观察项）；源码锚点注释标记此处，SA6 补测清单
  // （§13.7）的「ok:false ⇒ result.kind !== 'committed'」机制守卫可捕获本违约。
  return; // INV-DIAG: unreachable in a complete slot implementation (design §9 table)
}
```

- **effect 判定表**（槽体显式 outcome 的 fatal/committed 组装，唯一裁决）：

| 槽内结局 | emission result |
|---|---|
| committed（S7 成功，经 INV-DIAG 缺省组装）且 `updateBytes` 有 | `{kind:'committed', effect:'update', updateBytes}` |
| committed 且 `updateBytes` 无（零事件=事务无内容变更） | `{kind:'committed', effect:'noop'}` |
| fatal `committed:false`（S2/S4 类） | `{kind:'fatal', committed:false}`（不带 bytes——结构上事务未发生） |
| fatal `committed:true` 且 `updateBytes` 有（S5 事务后 fatal / S6） | `{kind:'fatal', committed:true, effect:'update', updateBytes}` |
| fatal `committed:true` 且 `updateBytes` 无（保守过报但事务未派发） | `{kind:'fatal', committed:true, effect:'unknown'}`（诚实：提交了什么不可知） |

## §8. 槽体改动（write.ts / schema-write.ts 逐结局点）

槽函数签名（可选参数加法扩展，既有调用零改动兼容）：

```ts
export async function runRootWriteSlot(env: WriteEnv, input: unknown, diag?: SlotDiag): Promise<MutateRootResult>
export async function runSchemaWriteSlot(env: SchemaWriteEnv, input: unknown, diag?: SlotDiag): Promise<ReplaceSchemaResult>
```

### 8.1 ROOT 写槽（write.ts）——每个结局点前一行 `diag?.…` 写入

> 【R1 修订，SA2 #3】gate/acceptance 类拒绝的诊断 issues 与业务返回**同源透传**（同一 `disabled(...)` 返回值的 issues 数组，零第二构造）；fatal 类（throw 通道）无 issues 载荷不发明（§9.3 裁决）。写入形态统一为「先构造业务返回值 `r`，再 `diag?.…(r.issues)`」。

```
S1 fatal gate        → r = disabled('fatal 已置位…'); diag?.capGateDisabled(r.issues)
                        // capability-gate / RUNTIME_WRITE_DISABLED / rejected / input 保持 not-accessed / issues 同源透传
S2 getStatus throw   → 在调 rejectWithWriteFatal 前：diag?.fatalCapGate(false)  // capability-gate / NSRT-FATAL-WRITE-INTERNAL / write-slot-internal / committed:false（fatal 通道无 issues 载荷，§9.3）
S2 handle ≠ ready    → r = disabled('DocHandle 状态 … 不可写'); diag?.capGateDisabled(r.issues)
S2 notifyDirty 未绑  → r = disabled('notifyDirty 未绑定 …'); diag?.capGateDisabled(r.issues)
S3 snap.kind=issue   → diag?.inputSnapshotFail(snap.issue)          // input-snapshot / MUTATION_INPUT_NOT_PLAIN_DATA / rejected / input←unsafe-input / issues=[snap.issue] 透传
S3 成功              → diag?.inputReady(snap.value)                 // input←{snapshot: snap.value}（唯一 payload 来源）
S4 unavailable       → r = { ok:false, issues:[SCHEMA_UNAVAILABLE issue] }; diag?.capGate(SCHEMA_UNAVAILABLE_CODE, r.issues)
                        // capability-gate / SCHEMA_UNAVAILABLE / rejected / input 已是 snapshot / issues 同源透传
S4 结构不可达 fatal  → 调 rejectWithWriteFatal 前：diag?.fatalCapGate(false)   // capability-gate / NSRT-FATAL-WRITE-INTERNAL / write-slot-internal
S5 窗口（diag 存在时；R1 修订 SA2 #1：可选链不可赋值——显式 if 守卫）:
     doc.on('update', h); try { result = applyValidatedMutation(...) }
     finally { doc.off('update', h); if (diag !== undefined) diag.updateBytes = captured }
     · 领域失败 (ok:false)      → diag?.validation(result.issues)   // validation / rejected / issues 透传（{message,path}，无结构化 code）
     · DocRuntimeFatalError     → diag?.fatalTx(err.committed, err.phase)  // transaction / NSRT-FATAL-WRITE-INTERNAL / sourcePhase=err.phase（无 issues 载荷）
     · 未知异常                  → diag?.fatalTx(true, 'unknown-pipeline-throw') // 保守 committed:true；bytes 有→update / 无→unknown
S6 notifyDirty throw → markWriteFatal 后、throw 前：diag?.dirtyFatal()  // dirty-notification / NSRT-FATAL-WRITE-INTERNAL / notify-dirty-failed / fatal committed:true（effect 由 §7.3 表裁决——正常必有 bytes → update）
S7 return {ok:true}  → （无需显式写 outcome——emitSlot 按 INV-DIAG 契约（§7.3）仅在 r.ok===true 时缺省组装 transaction + committed）
```

> S7 的组装：`emitSlot` 的缺省分支**仅当业务 fulfilled 且 `r.ok === true`**（§7.3 INV-DIAG）——成功路径零额外写入行，槽体 diff 最小化。**一切 ok:false 拒绝与 fatal rejection 必须显式写 outcome**：漏写时 emitSlot 走 INV-DIAG 违约分支（不 emit 该记录 + 源码锚点注释）——结构性杜绝「业务拒绝被伪装成 committed 记录」（SA2 #2），把「§9 表 25 点完备」从纪律约束升级为结构保证。

### 8.2 SCHEMA 写槽（schema-write.ts）——与 ROOT 槽同构，差异点

```
S1/S2 三种拒绝（issues 同源透传——diag?.capGateDisabled(r.issues)，同 §8.1 形态）、S2 fatal(getStatus throw)、S3 快照失败/成功：同 ROOT 槽，但 fatal 码为 NSRT-FATAL-SCHEMA-WRITE-INTERNAL（slot 分码，markWriteFatal 既有机制）
S3 形状检查失败（shapeOfReplaceInput issue）→ diag?.validation([shape.issue])  // validation / rejected / input 已是 snapshot / issues 透传（快照成功后的信封形状校验——与 ROOT 槽 parseMutation 信封失败同族同 stage，两槽一致性）
S4 compile ok:false → diag?.compileFail(r.issues)  // schema-compile / rejected / 顶层 code=首条 toIssueSummary().code / issues={code,message,path:[]} 结构化 / input 已是 snapshot
S4 compile throw（含 assertCompiledShape 守卫）→ 调 rejectWithWriteFatal 前：diag?.fatalCompileThrow()  // schema-compile / NSRT-FATAL-SCHEMA-WRITE-INTERNAL / schema-compile-throw / fatal committed:false（无 issues 载荷，§9.3）
S5 窗口：replaceSchemaAndRoot 同款（if (diag !== undefined) diag.updateBytes = captured——同 §8.1 R1 精度形态）
     · 领域失败 → validation / rejected / issues 透传
     · DocRuntimeFatalError / 未知异常 → transaction / fatal（slot='schema' 分码；无 issues 载荷）
S6 → dirtyFatal()（schema 分码）
S7 → 缺省组装（transaction / committed / update|noop——仅 r.ok===true 时生效，§7.3 INV-DIAG）
```

S4 compile 失败的诊断 issues 结构化映射（业务面 `toReplacementIssue` 的 message 前缀拼接不动；诊断面直接从 `toIssueSummary` 取结构化 code）：

```ts
const issues = r.issues.map((i) => { const s = toIssueSummary(i); return { code: s.code, message: s.message, path: [] }; });
diag?.compileFail(issues);  // 顶层 code = issues[0].code（SCHEMA_TEXT_INVALID / SCHEMA_ENVELOPE_*——p0.ts:134-148 既有码派生单源）
```

## §9. stage/code/result/input 完整映射表（冻结契约——与红灯锚点逐一对应）

### 9.1 ROOT mutation（operation = `root-mutation`）

| # | 槽内结局点 | stage | code | sourcePhase | sourceModule | result | input |
|---|---|---|---|---|---|---|---|
| R1 | 公共方法 lifecycle≠ready（close 后写） | `acceptance` | `RUNTIME_WRITE_DISABLED` | — | runtime | rejected + issues† | not-accessed |
| R2 | S1 fatal 已置位的排队写 | `capability-gate` | `RUNTIME_WRITE_DISABLED` | — | runtime | rejected + issues† | not-accessed |
| R3 | S2 handle 非 ready（degraded/released/disposed） | `capability-gate` | `RUNTIME_WRITE_DISABLED` | — | runtime | rejected + issues† | not-accessed |
| R4 | S2 notifyDirty 未绑定 | `capability-gate` | `RUNTIME_WRITE_DISABLED` | — | runtime | rejected + issues† | not-accessed |
| R5 | S2 getStatus 抛错 | `capability-gate` | `NSRT-FATAL-WRITE-INTERNAL` | `write-slot-internal` | runtime | fatal committed:false | not-accessed |
| R6 | S3 快照失败（敌意 accessor/非 plain） | `input-snapshot` | `MUTATION_INPUT_NOT_PLAIN_DATA` | — | runtime | rejected + issues | unsafe-input |
| R7 | S4 schema unavailable | `capability-gate` | `SCHEMA_UNAVAILABLE` | — | runtime | rejected + issues | snapshot |
| R8 | S4 结构不可达守卫 | `capability-gate` | `NSRT-FATAL-WRITE-INTERNAL` | `write-slot-internal` | runtime | fatal committed:false | snapshot |
| R9 | S5 领域失败（信封/校验/构造） | `validation` | — | — | — | rejected + issues | snapshot |
| R10 | S5 DocRuntimeFatalError | `transaction` | `NSRT-FATAL-WRITE-INTERNAL` | `err.phase`（透传） | runtime | fatal committed:err.committed；effect 按 §7.3 表 | snapshot |
| R11 | S5 未知异常 | `transaction` | `NSRT-FATAL-WRITE-INTERNAL` | `unknown-pipeline-throw` | runtime | fatal committed:true；effect update 或 unknown | snapshot |
| R12 | S6 notifyDirty 失败 | `dirty-notification` | `NSRT-FATAL-WRITE-INTERNAL` | `notify-dirty-failed` | runtime | fatal committed:true；effect update（必带 bytes） | snapshot |
| R13 | S7 成功 | `transaction` | — | — | — | committed；effect update（有 bytes）或 noop（零事件） | snapshot |

### 9.2 SCHEMA replacement（operation = `schema-replacement`）

| # | 槽内结局点 | stage | code | sourcePhase | sourceModule | result | input |
|---|---|---|---|---|---|---|---|
| S1′ | 公共方法 lifecycle≠ready | `acceptance` | `RUNTIME_WRITE_DISABLED` | — | runtime | rejected + issues† | not-accessed |
| S2′a | S1 fatal 已置位 | `capability-gate` | `RUNTIME_WRITE_DISABLED` | — | runtime | rejected + issues† | not-accessed |
| S2′b | S2 handle 非 ready / notifyDirty 未绑 | `capability-gate` | `RUNTIME_WRITE_DISABLED` | — | runtime | rejected + issues† | not-accessed |
| S2′c | S2 getStatus 抛错 | `capability-gate` | `NSRT-FATAL-SCHEMA-WRITE-INTERNAL` | `write-slot-internal` | runtime | fatal committed:false | not-accessed |
| S3′a | S3 快照失败 | `input-snapshot` | `MUTATION_INPUT_NOT_PLAIN_DATA` | — | runtime | rejected + issues | unsafe-input |
| S3′b | S3 形状检查失败（非对象/缺 schema/未知键） | `validation` | — | — | — | rejected + issues | snapshot |
| S4′a | compile ok:false（畸形 text/envelope） | `schema-compile` | 首条 issue 码（`SCHEMA_TEXT_INVALID` / `SCHEMA_ENVELOPE_*`） | — | runtime | rejected + issues | snapshot |
| S4′b | compile throw / 畸形 ok:true 守卫 | `schema-compile` | `NSRT-FATAL-SCHEMA-WRITE-INTERNAL` | `schema-compile-throw` | runtime | fatal committed:false | snapshot |
| S5′a | replaceSchemaAndRoot 领域失败 | `validation` | — | — | — | rejected + issues | snapshot |
| S5′b | DocRuntimeFatalError / 未知异常 | `transaction` | `NSRT-FATAL-SCHEMA-WRITE-INTERNAL` | err.phase / `unknown-pipeline-throw` | runtime | fatal；effect 按 §7.3 表 | snapshot |
| S6′ | notifyDirty 失败 | `dirty-notification` | `NSRT-FATAL-SCHEMA-WRITE-INTERNAL` | `notify-dirty-failed` | runtime | fatal committed:true；effect update | snapshot |
| S7′ | S7 成功（keep-root / replace-root 两分支同形） | `transaction` | — | — | — | committed；effect update 或 noop | snapshot |

### 9.3 issues 通道裁决（R1 修订，SA2 #3——消除「同类结局两种保真度」留白）

ADR-0011 §B：「每条结局记录保留所属模块**已有的**稳定 code、phase、issues 顺序与 committed 事实。」据此按**业务结算通道**三分裁决（冻结）：

| 业务结算通道 | issues 通道 | 依据与形态 |
|---|---|---|
| 领域结果联合 `ok:false`（表中标 † 的 R1–R4/S1′–S2′b，以及既有 R6/R7/R9/S3′a/S3′b/S4′a/S5′a） | **透传业务返回的 issues 数组，同源同序** | 业务面 `disabled(...)`/快照器/管线已构造结构化 issues——「已有的」存在即保留（§8.1 形态：先构造返回值 `r`，再 `diag?.…(r.issues)`——同一数组引用，零第二构造、零顺序重排） |
| fatal rejection（throw 通道：R5/R8/R10/R11/R12/S2′c/S4′b/S5′b/S6′） | **不携带 issues** | `RuntimeWriteFatalError` 携带 phase/committed/稳定 message，**无 issues 载荷**——「已有的 issues」不存在；ADR-0011 §B 措辞是「保留已有」，非要求日志层新造（fatal 的分类信息由 code+sourcePhase+sourceModule 结构化承载） |
| committed 成功（R13/S7′） | **不携带 issues** | 业务成功无 issues；不发明 |

红灯契约相容性：红灯对 gate 记录未断言 issues（两可），本裁决取保真侧（选项 a）；SA6 补测清单（§13.7）可按本表钉死。

**红灯锚点核对**（14 it 全覆盖；R2 注记：carrier 重放断言的应用形态已按 §6.4 修正为「基态链式」——测试修订规格 §13.8，断言值不变）：R13（committed 全字段+carrier 可重放+Clock）、R9（validation/digest/issues）、R6（input-snapshot/unsafe-input/accessor 零执行×2）、AC5 Proxy 零额外读取（§10.2）、R1+S1′（acceptance 成对/not-accessed/full 策略下仍 not-accessed）、R5+R2（fatal-before-commit 两连记录）、R12（dirty fatal committed:true+精确 bytes+live doc 已提交）、R7（SCHEMA_UNAVAILABLE/digest）、R4（notifyDirty 未绑/not-accessed）、S7′×2（keep-root 与 replace-root 各带精确事务 bytes；replace-root input full 含 {schema,root}）、S4′a（SCHEMA_TEXT_INVALID/digest）、S4′b（schema-compile-throw committed:false/digest）、AC4 emit throw（emitCalls===2+业务四不变）、AC4 队列满（accepted/dropped/queueDepth+FIFO）。

## §10. 验收标准逐条对照

### 10.1 AC1（冻结分类全覆盖）

§9 两表共 25 个结局点，覆盖两槽全部既有 return/throw 路径（对照 write.ts/schema-write.ts 源码逐点核对，无遗漏）。operation/stage/result 判别联合全部取自冻结词表（vocabulary.ts 8 值 stage / 6 值 operation——`root-mutation`、`schema-replacement` 均在词表内，ADR-0012 §A）；日志层零新造分类。

### 10.2 AC2（owned bytes）与 AC3/AC5（输入纪律）

- **精确事务 bytes**：S5 捕获窗口产出（§6）——消费契约按 §6.4（R2 修订）：**同源基态 + 依序增量链**重放。红灯 `applyCarrier` 断言（修订后形态，规格 §13.8）：base→tx₁ 得 `ROOT.n=42, ROOT.a='x'`；SCHEMA keep-root 记录得 `SCHEMA.text=ENV_KEEP.text`（ROOT 未动）；replace-root 记录（链含前一笔）同事务含 SCHEMA 四键+ROOT 三键终态。整文档编码冒充在链式重放下可鉴别：单条增量 payloadLength 远小于整文档编码，且 base→「整文档」直接跳终态、无法停在单事务边界（中间态断言面）。【R1 版曾声称「应用到全新空 Y.Doc 可观察事务效果」——机制上不成立（增量 left origin 依赖 pre-state struct），已废止，详见 §6.4】
- **no-op / update-omitted 显式**：零事件 → `effect:'noop'`（§6.2 ②）；bytes 超 payload 上限 / updateCapture 关闭由 adapter 守卫降级为 `update-omitted` + 受控 reason（memory.ts:211-230 既有）——producer 不发明 reason 词表。
- **live Y.Doc 不逃逸**：emission 只含 `Uint8Array` 与 plain data；doc 引用不出 runtime 闭包。
- **not-accessed**：R1–R5/S1′–S2′c 在槽序上先于 S3（零输入访问），emission input 固定 `{status:'not-accessed'}`——`inputPolicy:'full'` 下依然如此（事实优先于策略，projection/input.ts:54 决策表）。
- **快照后只消费既有快照**：emission input.snapshot ≡ S3 的 `snap.value`（同一 frozen 对象引用）——零第二次遍历调用方原对象。AC5 Proxy 锚点：`logged.gets === baseline.gets` 的机制保证 = 诊断只读 snap.value（frozen 副本），对原 Proxy 零触碰。
- **敌意 accessor 零执行**：S3 拒绝先于任何值读取（copyFrozen descriptor 全表扫描前置，write.ts 既有 R2 四查纪律）；unsafe-input 记录不回读原输入（emission 只带 status 标记）——`fired === 0` 两次断言（拒绝时+记录后）均成立。

### 10.3 AC4（故障隔离）

§3 四道防线 + §7.2 吞没。两红灯锚点：emitter throw（业务/顺序/dirty/capability 四不变 + emitCalls===2）与队列满（drop newest 只进 adapter stats）。

## §11. 边界条件与并发分析

| 场景 | 分析 | 结论 |
|---|---|---|
| 并发 mutateRoot×N（未 await 串接） | 每 attempt 独立 SlotDiag + 独立捕获窗口；窗口在各自槽的同步段内，槽间 FIFO 串行——窗口永不交叠 | 记录不串扰；emit 顺序=FIFO（§7.1） |
| emit 回调先于下一槽启动 vs close barrier | close barrier 也是 enqueue 的一项，排在队尾：全部写的 emit 微任务先于 barrier thunk（§7.1 注册序） | 无「close 后 emit 仍挂起」窗口；Host shutdown 不等待日志（ADR-0011 §F） |
| hostile emitter throw / queue full / clock NaN | emitAttempt 全吞没（§7.2） | 业务四不变 |
| 敌意 doc（缺 on/off） | 构造期 loud TypeError（§5.2，仅装配 emitter 时启用该校验） | 不把「应有 update 的记录」静默降级；未装配诊断的路径零新校验 |
| 捕获 handler 自身抛错 | handler 体为单赋值闭包，无可抛点；不做额外 try/catch（保持零成本，注释说明） | 不存在「自有 observer 抛错被 transactGuarded 包装成 E203」的向量 |
| 窗口内多事件（结构性不可达） | 首-赋值保守取首（§6.1） | 诊断面不崩溃、不 merge 语义争议 |
| fatal committed:true 但零 bytes（未知异常且事务未派发） | effect:'unknown'（§7.3 表）——诚实而非编造 | 与 EmissionResult 判别联合吻合 |
| `durationMs` / `context` / `attemptId` | 全部省略（无可靠来源/无身份可提供/emitter CSPRNG 生成） | 不发明字段（ADR-0012） |
| P0 与 close barrier | P0 非 变更尝试（ADR-0011 §B 排除面：open 导致的编译不写 Y.Doc）；close 非 变更尝试 | 二者零 emit——`p0.ts`/`close.ts` 零改动 |
| 未装配 emitter（现状生产路径） | diagEnv.emitter undefined → diag undefined → 槽体全部 `diag?.` 可选链 no-op；零订阅、零 emit | 既有全部测试**行为等价**（await 消费者可观测面不变；R1 修订 SA2 #6：`.then` 挂点使返回 promise 为派生 promise、结算多一跳微任务——非逐字节同一，全量回归由 §13.5 锁定，重点 runtime-close-lifecycle / runtime-close-sa7-dynamic / runtime-p0-sequencer） |

## §12. 架构一致性论证

| 既有规范 | 本设计的遵守方式 |
|---|---|
| ADR-0007「成功只返回 {ok:true}」 | `applyValidatedMutation`/`replaceSchemaAndRoot` 零改动；owned bytes 走 yjs 事件投递（§6.3），公共业务返回形状不动 |
| ADR-0007「零写入承诺 / observer no-rollback」 | 捕获 handler 只读订阅（单向读取事务投递），不参与事务、不写 doc；退订恢复原状（多播 observer 面零副作用） |
| ADR-0008 单 sequencer / 槽序 INV-W2 | S1–S7 顺序零重排；诊断写入是槽内同步段的旁路记录，不插入新阶段；emit 在槽外（§7.1） |
| ADR-0008 稳定码族（RUNTIME_WRITE_DISABLED 四域合一） | 顶层 code 全部复用 errors.ts 既有常量，零新码、零改 message 文案；区分域靠 stage+sourcePhase+issues（诊断结构字段），不动业务 issue 文本 |
| ADR-0008「已排队后续写零输入访问」 | R2/S2′a 的 not-accessed 恰是该承诺的日志镜像 |
| ADR-0011 §A 日志不改业务 / §E emitter seam | §3 四道防线；type-only 依赖 emitter 接口 |
| ADR-0011 §B 结局/阶段词表 | §9 两表严格落 8 值 stage + 6 形状 result（EmissionResult）；fatal 携带既有 committed 事实，不重新分类 |
| ADR-0011 §C 输入捕获 | 四态映射（§9 input 列）；唯一 payload 来源 = S3 既有快照；不建第二套序列化 |
| ADR-0011 §D owned bytes | §6；三种冒充面零触碰；transaction-seam 授权捕获点的合规论证见 §6.3 |
| ADR-0011 §F 时序/sequencer | acceptance 前拒绝在公共入口记录；已接纳操作记录真实槽内结局；emit 不被 await；notifyDirty 槽序原样（S6 在 emit 之前——emit 在槽外）；日志不延长 write slot |
| ADR-0011 数据保护 | emission 无 token/stack/原始 Authorization；issue 透传的是既有结构化 `{message,path}`（message 为既有领域文案，非 stack） |
| ADR-0012 §A 词表/attemptId/observedAt | operation 在冻结词表内；attemptId 委托 emitter CSPRNG；observedAt=注入 Clock 经本地 `observedAtMs`（§7.2——与诊断包 observedAtFrom 同一 ISO 表达式） |
| ADR-0012 §B producer 只做语义 emission | emission 无 streamId/sequence/segment/Base64/CRC——物理投影全部留给 adapter（memory.ts 既有） |
| ADR-0012 amendment C（emit 调用点纪律） | emit 点结构性位于 slot 之外（§7.1）——本票即 amendment 点名的接线修复票；File adapter 未来装配经同一 emitter 接口，调用点已合规 |
| CONTEXT.md 术语（语义 emission / storage projection / genesis 排除） | 本票产出全部是语义 emission；不新增 genesis 构造路径；不新增 update-omitted reason |
| #89–#93 冻结行为（十键公共面/导出审计） | `index.ts` 零改动（值导出仍恰 RuntimeWriteFatalError 一键）；runtime 对象键集不变；seam 扩展是加法可选字段 |

## §13. 实施注意（SA3）

1. `package.json` 加依赖后跑 `pnpm install`（lockfile 更新）；类型导入用 `import type { ... } from '@nomicore/namespace-diagnostic-log'`（**值级依赖恰一处**：`emitter.emit` 方法调用；【R1 修订，SA2 #4】`observedAtFrom` **不引入**——observedAt 用 diagnostic.ts 本地 3 行 helper `observedAtMs`（§7.2，与 emission.ts:105-107 同一 ISO 表达式），避免值引入拉入诊断包 index 运行图）。
2. 新文件 `diagnostic.ts`：`DiagnosticEnv` / `SlotDiag` / `SlotOutcome` / `SlotSettle` / `createSlotDiag` / `emitAttempt` / `emitSlot`（含 INV-DIAG 违约分支，§7.3）/ `observedAtMs` / 槽内 helper（`capGateDisabled` 等——建议 SlotDiag 为 plain 对象 + diagnostic.ts 内自由函数，避免 class）。
3. `write.ts`/`schema-write.ts`：每个结局点一行 `diag?.…`（gate 拒绝按 §8「先构造 r 再传 r.issues」形态）；S5 窗口按 §8 形态（handler 写外部局部变量 + try/finally 退订 + `if (diag !== undefined)` 显式守卫赋值）；**不改** `disabled`/`rejectWithWriteFatal`/`markWriteFatal`/`snapshotMutation` 签名与文案。
4. `runtime.ts`：seam 校验/捕获（§5.2——**事件面校验对象是 doc 局部量，不是 handle**；clock 成对校验）、`DiagnosticEnv` 构造（V3 批次内一次成型）、公共方法两处 emit 挂点（§7.1——onOk/onErr 携带结算事实传 `emitSlot`）。
5. 转绿验证：`npx vitest run packages/namespace-runtime/test/runtime-root-schema-diagnostic-red.test.ts`（14/14 绿）+ 全量既有 namespace-runtime 测试零回归（重点：runtime-acceptance-exports-audit / runtime-mutate-root-* / runtime-replace-schema-* / **runtime-close-lifecycle / runtime-close-sa7-dynamic** / runtime-p0-sequencer——时序敏感面，SA2 #6）+ `pnpm --filter @nomicore/namespace-runtime typecheck`。
6. 测试文件 `runtime-root-schema-diagnostic-red.test.ts` 为 SA6 owned：SA3 不得改断言；若基础设施层面问题（import 解析等）优先修生产侧装配。
7. 【R1 修订追加，SA2 §4 建议——供 SA6 补测/SA4 验收参考】25 点中红灯未覆盖结局点的行为断言（每例同时断言业务结果与记录分类；采纳 INV-DIAG 契约后「ok:false ⇒ result.kind !== 'committed'」是自动机制守卫）：R3（handle.release 后写）、R8（S4 结构不可达 fatal）、S2′b（SCHEMA 槽 notifyDirty 未绑）、S2′c（SCHEMA 槽 getStatus 抛错）、S3′b（replaceSchema 未知键）、S5′a（keep-root 与新 schema 不兼容）、S6′（SCHEMA 槽 notifyDirty 失败——基态链式重放，§6.4/§13.8）；§5.2 校验对象守卫两例（doc 无 on/off ⇒ 构造 throw；真 Y.Doc ⇒ 不 throw）。
8. 【R2 修订——SA6 红灯测试修订精确规格（`runtime-root-schema-diagnostic-red.test.ts`，SA6 owned；本条为对既有断言面的**唯一授权变更**，其余断言一律不动）】背景：原版 `applyCarrier` 以空 Y.Doc 直接应用增量 bytes——按 §6.4 机制事实**必然全红**（增量不物化），这不是 producer 缺陷而是消费形态错误。修订四步：
   a. **基态捕获**：每个涉及 carrier 重放的 it，在 `makeWriter()` 之后、**任何 `mutateRoot`/`replaceSchema` 调用之前**（此时 `handle.doc` 处于 `makeDoc()` pre-state，clientID 与后续事务同源）加一行：
      ```ts
      const baseState = Y.encodeStateAsUpdate(handle.doc); // 事务前基态（同 clientID）
      ```
      禁止提升为模块级共享常量——`makeDoc()` 每次调用产生新 clientID，基态必须按 it 局部捕获。
   b. **`applyCarrier` 改为基态链式应用**（保持 inline/format/payloadLength 三断言不变）：
      ```ts
      /** 同源基态 + 既有增量链 + 本条 carrier → 重放 doc（ADR-0011「连续 committed updates 诊断性重放」消费形态，设计 §6.4）。 */
      function applyCarrier(carrier: UpdateCarrier, baseState: Uint8Array, prior: UpdateCarrier[] = []): Y.Doc {
        expect(carrier.storage).toBe('inline');
        expect(carrier.format).toBe('yjs-update-v1');
        const bytes = new Uint8Array(Buffer.from(carrier.base64, 'base64'));
        expect(bytes.length).toBe(carrier.payloadLength);
        const fresh = new Y.Doc();
        Y.applyUpdate(fresh, baseState);        // 基态先立（pre-state struct 就位——origin 可解析）
        for (const p of prior) Y.applyUpdate(fresh, new Uint8Array(Buffer.from(p.base64, 'base64')));
        Y.applyUpdate(fresh, bytes);            // 本条事务增量
        return fresh;
      }
      ```
   c. **调用点逐处更新（恰好 3 处 it、4 个调用——L167 / L380 / L477 / L483；R3-1 修正：R2 版误记「4 it / 5 调用」，SCHEMA ×2 两调用同属一 it）**：
      - ROOT committed（AC1/AC2 用例，L167）：`applyCarrier(updateCarrierOf(rec.result), baseState)`——断言**不变**（`n===42 && a==='x'`，实测 base→tx₁ 即得）；
      - fatal-after-commit（notify-dirty-failed 用例，L380）：同上单基态（该 it 仅一笔写，无 prior）；
      - SCHEMA committed ×2（keep-root + replace-root **同一 it**，L477/L483）：`recs[0]`（L477）用 `applyCarrier(..., baseState)`；`recs[1]`（L483）用 `applyCarrier(..., baseState, [updateCarrierOf(recs[0].result)])`——第二笔事务的 left origin 依赖第一笔后的状态，**链式依序**是机制必需；断言**不变**（① SCHEMA=ENV_KEEP.text 且 ROOT 未动；② ENV_REPLACE.text + ROOT_REPLACE 三键）。
   d. **可选反向鉴别断言（不强制，防「整文档冒充」回归）**：任一 carrier 的 bytes 应用到**无基态空 doc** 后 `getMap('ROOT').size === 0 && getMap('SCHEMA').size === 0`（真增量不物化——§6.4 事实 2；若 producer 改为整文档编码则会物化、立即红）。
   修订后转绿判据不变：14/14（应用形态修正不新增/不删减 it）。

## §14. 协议假设依据 (Protocol Assumption Evidence)

| # | 假设 | 依据类型 | 依据内容（具体引用） | 风险等级 |
|---|---|---|---|---|
| P1 | yjs 事务 cleanup 同步派发 `update` 事件；payload = **该事务的增量** bytes（`writeUpdateMessageFromTransaction`），非整文档编码；新分配（owned） | 源码引用 | yjs@13.6.32 `src/utils/Transaction.js:362-367`（`doc.emit('afterTransactionCleanup')` → `writeUpdateMessageFromTransaction(encoder, transaction)` → `hasContent` 时 `doc.emit('update', [encoder.toUint8Array(), …])`） | 低 |
| P2 | 事务零内容变更 → 不派发 update 事件（`hasContent===false` 分支跳过 emit） | 源码引用 | 同上 `Transaction.js:366`（`if (hasContent)` 守卫）——「零事件 ⇔ effect noop」的机制依据 | 低 |
| P3 | 单事务捆绑为一次派发；observer 在事务结束后触发 | 官方文档引用（随包源码注释） | yjs `src/utils/Doc.js:172-174`："Changes that happen inside of a transaction are bundled... the observer fires _after_ the transaction is finished and all changes... are sent as one message" | 低 |
| P4 | 派发发生在 `doc.transact(f)` 调用栈内（同步）——订阅窗口（on → S5 → off）必然覆盖 | 源码引用 | `transact` 实现（`Transaction.js:412` 起）内同步调用 cleanup；S5 调用方 `mutation.ts:48`/`schema-replace.ts:131` 的 `transactGuarded` → `doc.transact`（`fatal.ts:64-66`） | 低 |
| P5 | `sequencer.enqueue` 返回 promise 于 thunk settle 时 settle；外部 `.then` 回调依注册序在内部 `tail.then(noop)` 之后、下一任务 thunk 之前执行 | 源码引用 + 规范 | `sequencer.ts:38-42`（`settled = tail.then(run)`; `tail = settled.then(noop)` 先注册）+ ECMAScript PromiseJobs FIFO 派发语义 | 低 |
| P6 | memory adapter emit 同步入队、capacity 满时 drop newest 且只进 stats；emitter 管线不 throw、词表外/形状违规丢 emission | 现有测试引用 + 源码引用 | `adapters/memory.ts:307-313`（queue-full 分支）、`pipeline.ts:288-309`（emit 全 catch）；#156 已随 7ceede1 合并并测试冻结 | 低 |
| P7 | pnpm workspace `workspace:*` 依赖 + `pnpm install` 后，包名 `import type` 可被 tsc(bundler resolution)/vitest 解析 | 类比已有依赖验证 | 同仓既有四条 workspace 依赖（`@nomicore/doc-runtime` 等）同机制运行；根 `pnpm-workspace.yaml` 含 `packages/*` | 低 |
| P8 | 事务增量 bytes 应用到**空 Y.Doc 不物化**（left origin/delete set 引用 pre-state struct，缺失则整包静默丢弃、不抛错）；**同源基态（事务前 pre-state，同 clientID）+ 依序增量链**完全重放至精确事务终态 | 设计期实测验证 | SA1 于设计期在 worktree（yjs@13.6.32）跑最小实验（2026-08-29，R2）：`doc(pre-state n=1,a='x') → transact(clear+set n=42,a='x')` 捕获增量（38 bytes）→ 空_doc 应用后 `store.clients=[]、ROOT.keys=[]、不抛错`；`base→tx₁` 得 `n=42,a='x'`，`base→tx₁→tx₂` 得 `n=7`；clear-only delete set 对空 doc 静默 no-op。§6.4 契约与 §13.8 测试规格全部以此为机制依据 | 低（已实测钉死） |

无网络端口、进程生命周期、跨 job 资源类假设。

## §15. 契约改动连锁审计 (Contract Change Caller Audit)

### 改动函数/接口

| 函数/接口 | 文件 | 改动前契约 | 改动后契约 |
|---|---|---|---|
| `NamespaceRuntimeSeamInput` | `packages/namespace-runtime/src/runtime.ts:53-64` | 4 字段（handle/p0Gate?/compile?/notifyDirty?） | +2 可选字段（diagnosticEmitter?/clock?）——加法扩展；R1 修订后附一条成对约束（装配 emitter 而缺 clock ⇒ 构造 throw，§5.2），对既有不装配路径零影响 |
| `runRootWriteSlot` | `packages/namespace-runtime/src/write.ts:77` | `(env, input) => Promise<MutateRootResult>` | `(env, input, diag?) => Promise<MutateRootResult>`——可选参数追加；返回联合、throw 面、槽序零变化 |
| `runSchemaWriteSlot` | `packages/namespace-runtime/src/schema-write.ts:102` | `(env, input) => Promise<ReplaceSchemaResult>` | `(env, input, diag?) => Promise<ReplaceSchemaResult>`——同上 |

**无** return→throw、Promise 形状反转、同步→async、catch swallow→rethrow、nullable 翻转类改动。`disabled`/`rejectWithWriteFatal`/`markWriteFatal`/`snapshotMutation`/`captureSeamInput` 既有导出签名零变化（后者仅内部新增两个捕获分支）。

### Caller 清单

| Caller | 文件:行号 | 是否 await | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---|---|---|---|---|
| `mutateRoot` 公共方法 | `runtime.ts:241`（`sequencer.enqueue(() => runRootWriteSlot(writeEnv, mutation))`） | await（经 enqueue 返回 promise） | 槽体自全 catch（INV-W12，sequencer 链尾消化） | sequencer 链尾 noop | 本票同步改为 `enqueue(...).then(emitOk, emitErr)`——diag 作第三实参传入；`.then` 双分支保证 emit 后原值/原 rejection 传播 |
| `replaceSchema` 公共方法 | `runtime.ts:251` | 同上 | 同上 | 同上 | 同上（schemaWriteEnv + diag） |
| 测试直接调用 | `grep -rn "runRootWriteSlot\|runSchemaWriteSlot" packages/namespace-runtime/test/` → 仅 `runtime-acceptance-exports-audit.test.ts:39-40`（导出面**负向**断言：不得从公共入口导出）与 `runtime-registry-internal-seam.test.ts:133`（同负向清单）——**无任何直接调用** | N/A | N/A | N/A | 零处置：可选参数对不传者透明；导出面零变化故负向断言不破 |
| doc-runtime 内部（`applyValidatedMutation`/`replaceSchemaAndRoot` 的 caller 即写槽） | `write.ts:137` / `schema-write.ts:162` | 同步调用（非 await） | 槽内既有 try/catch（fatal 分类） | — | 本票不改这两个函数；槽内调用点外仅包订阅窗口（on/off 对称，try/finally 退订）——异常路径 bytes 保留、原异常原样传播至既有 catch |
| `createNamespaceRuntime`（生产工厂，seam 的 caller） | `runtime.ts:274-279` | 同步构造 | 构造 throw 契约不变 | — | 传参 `{handle, notifyDirty}` 不变——新字段缺省 = 未装配诊断，与现状行为等价（§2 D-C R1 注记：写调用经 .then 挂点返回派生 promise，await 消费者可观测面不变） |

### 风险评估

- 遗漏 caller 的代价：槽函数若存在未知直接调用者且依赖 `arguments.length`（不存在此模式——全仓 grep 证实仅 runtime.ts 两处调用）；seam 新字段对结构化传参（`Record<string,unknown>` as never）透明。
- 抓全 caller 的方法（已执行）：`git grep -n "runRootWriteSlot\|runSchemaWriteSlot\|createNamespaceRuntimeWithSeam" -- 'packages/**/*.ts'`——结果：runtime.ts（定义+2 调用点）、write.ts/schema-write.ts（定义）、测试（导出面负向断言 + seam 装配调用 `createNamespaceRuntimeWithSeam`（传参结构兼容，新字段经 Record 透传））。

## §16. 文件清单（File Scope）

### ALLOW LIST

- `packages/namespace-runtime/package.json` — 修改，§4：dependencies 增加 `@nomicore/namespace-diagnostic-log: workspace:*`（L1 依赖层缺口，1 行）
- `packages/namespace-runtime/src/diagnostic.ts` — 新建，§5–§8：DiagnosticEnv / SlotDiag / createSlotDiag / emitAttempt / emitSlot / update 捕获助手（L2/L3/L4 发射与捕获的唯一新模块，约 150–200 行）
- `packages/namespace-runtime/src/runtime.ts` — 修改，§5/§7：seam 接口 +2 可选字段、captureSeamInput +2 捕获分支（含条件性 doc.on/off 校验）、DiagnosticEnv 构造、mutateRoot/replaceSchema 各自的 emit 挂点（acceptance 同步 emit + `enqueue().then()` 槽后 emit），约 +60 行、零删改既有行为行
- `packages/namespace-runtime/src/write.ts` — 修改，§8.1：runRootWriteSlot +可选 diag 参数、每个结局点一行诊断写入、S5 捕获窗口，约 +30 行（`disabled`/`rejectWithWriteFatal`/`snapshotMutation`/`copyFrozen` 零触碰）
- `packages/namespace-runtime/src/schema-write.ts` — 修改，§8.2：同 ROOT 槽形态 + S4 结构化 code 映射，约 +30 行
- `packages/namespace-runtime/test/runtime-root-schema-diagnostic-red.test.ts` — `[SA6 owned]` 既有红灯验收测试（SA6 已写就）；SA3 落地后应 14/14 转绿；SA3/SA6 仅可在测试基础设施层（import 解析等）协作，断言逻辑禁改
- `pnpm-lock.yaml` — 修改（由 `pnpm install` 产生）：workspace 依赖链接的 lockfile 登记（§4 实施注意；若仓库不提交 lockfile 则此条自动空转，SA3 按仓库惯例处理）

### DENY LIST

- `packages/namespace-diagnostic-log/**` — #156/#159/#166 已冻结交付的 emitter/adapter/词表契约，本票是纯消费方，零改动（§6.3/P6）
- `packages/doc-runtime/**` — 本票经 yjs 事务投递面捕获 owned bytes，doc-runtime 零改动（§6.3 备选方案否决论证）；ADR-0007 冻结其返回形状
- `packages/namespace-runtime/src/sequencer.ts` — emit 挂在 enqueue 返回 promise 的 then 链，sequencer 机械零改动
- `packages/namespace-runtime/src/index.ts` — 公共导出面零变化（runtime-acceptance-exports-audit 锚定）
- `packages/namespace-runtime/src/p0.ts` / `close.ts` / `status.ts` / `projection.ts` / `plain-data.ts` / `errors.ts` — P0 与 close 非变更尝试（ADR-0011 §B 排除面）零 emit；errors.ts 稳定码注册表零新码
- `packages/namespace-runtime/src/internal.ts` — 内部通道导出面零变化
- `packages/namespace-registry/**` / `packages/persistence/**` / `packages/dsh-persistence/**` / `packages/vfsl*/**` / `packages/clock/**` — 非本票接线对象；Registry 侧接线属后续票（ADR-0011 §F「未来 Registry 使用」）
- 其余 `packages/namespace-runtime/test/*.test.ts`（非红灯新文件）— 既有冻结行为测试，本票对其零改动（行为回归 = 全绿即证明）

---

## 附：SA2 反馈逐条回应（R1 修订，2026-08-29）

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| #1 CRITICAL：§5.2 loud-assert 校验对象写错（`h.on/h.off` 是 handle 记录；DocHandle 契约无 on/off——照抄即 14/14 永红） | ✅ | §5.2、§8.1 | 校验对象改为 **doc 局部量**（`handle.doc`，Y.Doc 事件面）：`const d = doc as …; if (typeof d.on !== 'function' \|\| typeof d.off !== 'function') throw`；分支落位注明「在既有 doc 捕获之后」；报错文案显式「handle.doc（Y.Doc）」；补 Proxy handle 例透传论证（`h.doc` 经 Reflect.get 得真 Y.Doc——合法装配不炸）。§8.1 `diag.updateBytes = captured` 同族 TS 精度问题一并修正为 `if (diag !== undefined) diag.updateBytes = captured`（§8.2 同步） |
| #2 HIGH：emitSlot 缺省组装可伪造 committed（ok:false 是 resolve 非 reject；rejection+无 outcome 未定义） | ✅ | §7.1、§7.3、§8.1、§8.2 | emitSlot 签名带入结算事实：onOk 传 `{kind:'fulfilled', value:r}`、onErr 传 `{kind:'rejected'}`；组装契约三分支——① outcome 显式 → 按 outcome；② outcome 缺失 + fulfilled + **`r.ok === true`** → 缺省 transaction/committed（bytes→update / 零事件→noop）；③ outcome 缺失 + ok:false 或 rejection → **INV-DIAG 违约：不 emit 该记录 + 源码锚点注释**——绝不缺省 committed。§8.1/8.2 的 S7 行同步改引新契约；§13.7 登记「ok:false ⇒ result.kind ≠ committed」机制守卫供 SA6 钉死 |
| #3 MEDIUM：gate/acceptance 记录省略 issues 与 ADR-0011 §B 不一致且无裁决 | ✅ | §9.1、§9.2（标 †）、新增 §9.3、§8.1、§8.2、§7.1 | 裁决选**透传侧（选项 a）**：§9.3 按业务结算通道三分冻结——领域联合 ok:false（R1–R4/S1′–S2′b 及既有 issues 面）**同源同序透传**（同一 `disabled(...)` 返回值 issues 数组引用，零第二构造）；fatal throw 通道无 issues 载荷不发明（ADR-0011 §B「保留已有」的相容性论证）；committed 无 issues。§8 槽体形态统一「先构造 r 再 `diag?.…(r.issues)`」；§7.1 acceptance 伪代码补 `issues: result.issues` |
| #4 LOW：§4 type-only 叙述与 §13.1 observedAtFrom 值引入自相矛盾 | ✅ | §4、§7.2、§13.1 | 裁决选**本地实现**：diagnostic.ts 3 行 `observedAtMs`（与 emission.ts:105-107 同一 ISO 表达式，非序列化规则复制）；§4 修订为「值级依赖恰一处 = emitter.emit 方法调用，不引入诊断包任何值级模块导出（含 observedAtFrom——避免经 index 运行图拉入 reader/file）」；§13.1 同步 |
| #5 LOW：clock 缺省墙钟形态（静默降级面） | ✅ | §5.1、§5.2 | 采纳 loud 方案：删除 `() => Date.now()` 缺省；**装配 diagnosticEmitter 而缺 clock ⇒ 构造期 TypeError**（observedAt 唯一来源是注入 Clock——ADR-0012；红灯 14 例全部成对注入 clock，不受影响；与 SA8 冲突点 #4 移交 Registry 票的「生产装配必须显式注入」呼应） |
| #6 LOW：「逐字节不变」表述过强（.then 挂点产生派生 promise/多一跳微任务） | ✅ | §2 D-C、§11、§13.5 | 措辞修正为「**行为等价（await 消费者可观测面不变）**」并显式登记派生 promise/微任务跳差异；§13.5 回归重点面补 runtime-close-lifecycle / runtime-close-sa7-dynamic / runtime-p0-sequencer |

一致性自检（R1）：全文「逐字节」行为断言残留 0 处（§6.3 已改「编码级等价」——payload 编码器同源的语义断言）；§5.2/§8.1/§8.2/§13.4 校验对象表述统一为 doc；§7.3 契约与 §8.1/§8.2 S7 行、§13.7 守卫描述一致；§9.3 三分裁决与 §8 透传形态、§7.1 acceptance issues 一致；§12/§15 的 observedAt/promise 等价表述与 §4/§7.2/§2 D-C 同步；ALLOW/DENY LIST 文件集零变化（修订均为既有条目内的设计内容修正）。

## R2 修订记录（SA3 实施期矛盾修正，2026-08-29）

| 矛盾 | 是否解决 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| SA3 发现：事务增量 bytes 正确但**无法物化到空 Y.Doc**（left origin/delete set 引用 pre-state struct）——R1 版设计「应用到全新空 Y.Doc 可观察事务效果」的声称（沿 SA6 红灯原注释）机制上不成立 | ✅ | 新增 §6.4、§10.2、§14 P8 | §6.4 冻结修正后的消费契约：**同源基态（事务前 pre-state、同 clientID）+ 依序增量链**——实测 base→tx₁ 得 n=42/a='x'、base→tx₁→tx₂ 得 n=7（=红灯断言值）；这正是 ADR-0011 术语定义「**连续的** committed Yjs updates 可用于诊断性重放」的原生语义、与 genesis baseline record（#152）消费形态对齐。**保真 ADR-0011 §D 事务增量限制不放松**：仍不携带整文档编码（冒充红线）——增量在源 doc 上下文中语义精确无缺，矛盾仅在消费方应用方式；§14 新增 P8（设计期实测验证：空 doc 应用 store.clients=[]/ROOT 空/不抛错；基态链式完全重放）。producer 侧零改动（§6.1–§6.3/§7/§9 全部不变） |
| 红灯测试消费形态随之必须修订（SA6 owned 文件） | ✅ | 新增 §13.8、§13.7 措辞 | §13.8 给出 SA6 精确修订规格（四步）：a. 每 it 在 makeWriter 后、任何写调用前局部捕获 `baseState = Y.encodeStateAsUpdate(handle.doc)`（禁模块级常量——makeDoc 每次新 clientID）；b. `applyCarrier(carrier, baseState, prior=[])` 改基态链式应用（inline/format/payloadLength 三断言原样）；c. 恰 4 处 it 5 个调用点更新——单笔写传 baseState、SCHEMA×2 的 recs[1] 传 `[recs[0] 的 carrier]` 作 prior（第二笔 origin 依赖第一笔后状态）；全部终态断言值不变；d. 可选反向鉴别断言（真增量对无基态空 doc 不物化——防整文档冒充回归）。转绿判据不变 14/14 |
| §7.3/§9.3 内部引用错误（§13.6 应为 §13.7——补测清单实际在第 7 条） | ✅ | §7.3 注释、§9.3 末段 | 两处 §13.6 → §13.7 |

一致性自检（R2）：全文「全新/空 Y.Doc 物化」声称残留 0 处（§10.2 已改写并留废止注记指向 §6.4）；§6.4（契约）→§13.8（测试规格）→§14 P8（证据）→§9.1 锚点注记（应用形态）四点联动一致；§13.7 的 S6′ 条目与 §6.4 术语统一为「基态链式重放」；producer 侧章节（§5/§6.1–6.3/§7/§8/§9 映射表）零改动——SA3 已实施代码与本修订后的设计一致（捕获机制本就产事务增量，无需变更）；ALLOW/DENY LIST 文件集零变化（红灯测试文件本就在 ALLOW LIST 且标 SA6 owned，其断言面变更由 §13.8 规格授权）。

## R3 修订记录（SA2 R3 评审通过重放契约；R3-1 计数修正 + 两项对齐，2026-08-29）

**背景**：SA2 R3 评审**通过** §6.4 修正后的重放契约（同源基态 + 依序增量链）；唯一遗留 R3-1 计数错误，另附两项可选对齐，本记录全部落实。

| 项 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| R3-1：§13.8c 调用点计数错误（「4 处 it、5 个调用」→ 实为 **3 it / 4 调用**） | ✅ | §13.8c | 修正为「恰好 3 处 it、4 个调用——L167 / L380 / L477 / L483」；SCHEMA ×2 的两个调用（L477/L483）同属一 it（`AC1/AC2 committed ×2`），逐行号标注；保留 R2 版误记的更正说明 |
| 对齐项 1：§5.2 DiagnosticEnv 措辞与 SA3 实现的判别联合形态对齐 | ✅ | §5.2 | 设计原为宽字段 interface（`emitter: … \| undefined; clock: () => number`）——对齐为实现形态的**判别联合**（未装配态两字段同 `undefined`；装配态两字段同现）+ `buildDiagnosticEnv` 总函数；注记「未装配态 clock 为 undefined 是 R1 删除 Date.now() 缺省后的类型面必然；成对性由 §5.2 构造期 loud 校验前置保证」。§7.1/§7.2 的 `env.emitter === undefined` narrow 与判别联合兼容（TS 判别收窄），零改动 |
| 对齐项 2：补记链洞（missing-prior）静默降级 | ✅ | §6.4 | 新增「消费纪律注记」：链有洞（queue-full drop / 跳读）时洞后增量在残链上静默不物化（与 §6.4 事实 2 同机制）；定性为增量重放固有性质而非缺陷，与 ADR-0011/CONTEXT.md 定位声明逐字一致（「不承诺完整性或恢复能力」；queue-full drop 为 §A 授权；_Avoid_ 审计账本/WAL/恢复日志）；消费纪律 = sequence 严格递增检测链洞、洞后增量不用于重放断言 |

一致性自检（R3）：§13.8c 行号（L167/L380/L477/L483）与红灯测试当前源码逐一对齐（3 it 分布：L143 it→L167、L353 it→L380、L449 it→L477+L483）；§5.2 判别联合与 SA3 已实施 `diagnostic.ts:43-57`（DiagnosticEnv 类型 + buildDiagnosticEnv）逐字对应；§6.4 消费纪律注记与 §14 P8 证据、§11 queue-full 行为面无冲突（drop 只影响日志侧重放链，业务面四不变仍由 §3 防线保证）；producer 侧章节零改动；ALLOW/DENY LIST 文件集零变化。
