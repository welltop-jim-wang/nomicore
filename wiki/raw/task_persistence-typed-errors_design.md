# SA1 设计 — issue #108 persistence：typed load/create 错误与 committed-aware create fatal

- **版本 R1.1**（2026-05-29 外科修订：闭合 SA2 R2 复审 PASS 附注记 N-1~N-6，报告 `wiki/raw/task_persistence-typed-errors_sa2_review_r2.md`；纯文档级，零行为/范围/测试结局变更。R1：逐条闭合 A-1~A-8；R0 骨架保留）
- run_id: issue-108-1787670535-603033
- worktree: /home/wangjian/nomicore-fix-issue-108（branch `fix/issue-108-on-docs-namespace-registry`，基线 HEAD **ba1b6b4**——R2 复审期 rebase 后；亲证 `packages/persistence` 最后触达仍为 279d3ba，两新提交仅涉 namespace-runtime，与本设计无关，全部代码引用仍有效）
- 任务类型: feature（Phase 2，ADR-0009 实施顺序第 2 步「typed error 演进」）
- 输入: `wiki/raw/task_persistence-typed-errors.md`（AC1–AC8）、`wiki/raw/task_persistence-typed-errors_sa8_gate.md`（verdict clear，两个裁决点）、ADR-0009 L72–L83 / ADR-0006 #64/#79 修订节
- 现状亲读: contract.ts / lifecycle.ts / memory.ts / file.ts / testing.ts / index.ts / service.ts 全文；probe.ts L1–L60+L340–L400+L546；memory-persistence.test.ts / file-persistence.test.ts / file-persistence-sa7-dynamic.test.ts / sa7-supplementary.test.ts / persistence-contract.test.ts / module-graph-regression.test.ts / core-dsh-boundary.test.ts / issue-79 双套件 / namespace-runtime 5 个挂钩子测试 / dsh profile.ts + dsh-profile-acceptance.test.ts

---

## §0 背景与 AC 对照

### 0.1 问题本质

Persistence 的 `loadDoc`/`createDoc` 失败通道今天是**裸异常透传**：调用方（未来的 NamespaceRegistry，ADR-0009 L56/L81）只能靠异常文本猜测「这是运营失败（可映射公开 issue）还是内部 bug（fatal）还是文档已提交」。ADR-0009 §Persistence 错误演进（L72–L83）授权并要求 Persistence 在 Registry 实施前完成四类稳定分类。本设计交付该分类。

同时存在一个**结构性歧义**（SA8 裁决点 1）：Memory `write` 在 signal aborted 时**早退 resolve**（提交段未执行但 write resolved），File `writeCommittedSnapshot` 以 `rename` 为提交点、resolve 即已提交——「write resolved ⇒ committed」对两 Adapter 不一致，committed-aware fatal 无从谈起。§3 裁决。

### 0.2 AC 对照（设计落点索引）

| AC | 要求 | 设计落点 |
|---|---|---|
| AC1 | 稳定 typed load operational error，保留原始 cause，message 不拼接 cause | §1.1 `DocLoadOperationalError`；§2 L1 行；§5 EC1 |
| AC2 | 稳定 typed create operational error，明确 `committed:false` | §1.2 `DocCreateOperationalError`（字面 `false` 类字段）；§2 R1/W2 行；§5 EC3/EC4 |
| AC3 | committed-aware create fatal：稳定 phase + committed + 原始 cause | §1.3 `DocCreateFatalError` + `DocCreateFatalPhase` 四值；§2 R2/R3、W1/W3/W4/W5 行；§5 EC5–EC7/EC9 + EC10（R1：委托模型 committed:true 自洽锚） |
| AC4 | duplicate 独立稳定类型，不与 operational/fatal 混合 | §1.4：`DocDuplicateError` 逐字节不变，无共享基类；§5 EC8 |
| AC5 | File 提交点与 post-commit failure 分类准确，不虚假声称 rollback | §3（rename=提交点，语义不变）+ §2 W4/W5（committed:true）+ §5 EC5（真实 `.snapshot` 留存断言 + rollback 负锁 + 重试得 duplicate）+ EC10（committed:true 与读权威一致的公共面证据） |
| AC6 | unknown/internal 不降级为 operational | §2：encode→fatal、restore/validate→裸传、dispose 竞态→fatal（绝不 operational）；§5 EC2/EC6/EC7/EC9 |
| AC7 | Memory/File 同一组 load/create 错误契约 + exact cause + 敏感文本负锁测试 | §5 `describePersistenceErrorContract` 共享套件（两 Adapter 同一 fixture 契约 + 同一断言组，`wrapIo` 统一注入机制） |
| AC8 | 全量 typecheck/test + Node 20/24 CI | §4 变更全部 additive；§6 不变量逐字锁定；§10 caller 审计 |

### 0.3 SA8 留下的两个裁决点 — 结论先行

1. **commit-fact 诚实来源** → §3：**候选 (a) 收紧 IO seam，以「观察通道公理」为纲**（committed 的事实基准 = 该实例读路径采信的 store）——`write` resolve ⟺ 基准 store 已持有快照；无法提交必须 reject。Memory 的 `if (signal.aborted) return` 早退 resolve **删除**，abort 门（`throwIfAborted`）移至 **io.write 入口（flat hook 之前）**（R1 按 SA2 A-1 裁决，§3.5 方案 (a)——消除委托模型的 committed 说谎窗口）。四路径影响分析见 §3.3。
2. **Persistence fatal phase 词汇分层** → §1.3：Persistence 域四值 `'probe-read' | 'snapshot-encode' | 'store-write' | 'post-commit'`（create 管线阶段命名），与 Registry 三值 `runtime-construction/create-document-internal/lifecycle-slot-internal`（ADR-0009 L89–L93，Registry 层构造期阶段）**零词面重叠、零语义混淆**：前者描述 Persistence create 的存储管线位置，后者描述 Registry 侧 Runtime/文档构造/槽位。

---

## §1 错误类型谱系（contract.ts，完整 TS 签名逐字）

### 1.0 既有基线（不改，仅引用）

```ts
// contract.ts L44–L51 现状，逐字节保留（AC4）
export class DocDuplicateError extends Error {
  readonly code: 'DOC_DUPLICATE' = 'DOC_DUPLICATE'
  constructor(message = 'createDoc duplicate: the (owner, docId) already exists') {
    super(message)
    this.name = 'DocDuplicateError'
  }
}
```

### 1.1 typed load operational error

```ts
/**
 * Stable typed load operational error (issue #108, ADR-0009 L76/L81).
 *
 * Thrown only when the underlying store READ rejected (I/O unavailable,
 * permission, sweep failure …) while the lifecycle is current. The exact
 * original failure is preserved on `cause` (identity-stable); the stable
 * `message` never concatenates the cause, identifiers, or store paths.
 * Corruption/validate failures and disposed-race failures are NOT this type
 * (they stay loud non-operational channels — see design §2).
 */
export class DocLoadOperationalError extends Error {
  readonly code: 'DOC_LOAD_OPERATIONAL' = 'DOC_LOAD_OPERATIONAL'
  /** The exact original store-read failure. Never concatenated into message. */
  readonly cause: unknown
  constructor(cause: unknown, message = 'loadDoc operational failure: the underlying store read rejected') {
    super(message)
    this.name = 'DocLoadOperationalError'
    this.cause = cause
  }
}
```

### 1.2 typed create operational error（committed:false）

```ts
/**
 * Stable typed create operational error (issue #108, ADR-0009 L77/L81).
 *
 * Thrown only when a store-level I/O operation the create itself performed
 * rejected (probe read or the initial snapshot write) while the lifecycle is
 * current. `committed` is the authoritative literal fact: an operational
 * create failure ALWAYS predates the commit point, so the store is unchanged.
 *
 * Boundary (R1/A-5): this classification TRUSTS the PersistenceIO contract
 * (§3.1). The lifecycle cannot re-verify the store after a rejection (re-read
 * verification was rejected as TOCTOU-prone, §3.2 (c)). If an adapter or a
 * wired write hook VIOLATES the contract by partially committing and then
 * rejecting, this error's committed:false would be wrong for the violated
 * portion — that is an adapter bug (seam violation), NOT an operational
 * failure misclassification. AC6 is conserved by CONTRACT (§3.1 obligations:
 * no synchronous throw, no reject-after-partial-commit, resolve ⟺ committed),
 * not by mechanism.
 */
export class DocCreateOperationalError extends Error {
  readonly code: 'DOC_CREATE_OPERATIONAL' = 'DOC_CREATE_OPERATIONAL'
  /** Authoritative: nothing was committed (the failure predates the commit point). */
  readonly committed: false = false
  /** The exact original store failure. Never concatenated into message. */
  readonly cause: unknown
  constructor(cause: unknown, message = 'createDoc operational failure: the store rejected before commit') {
    super(message)
    this.name = 'DocCreateOperationalError'
    this.cause = cause
  }
}
```

### 1.3 committed-aware create fatal

```ts
/**
 * Stable phase vocabulary for create fatal failures — Persistence create
 * pipeline stages (issue #108). Layered SEPARATELY from the Registry fatal
 * phases of ADR-0009 L89–L93 (runtime-construction / create-document-internal /
 * lifecycle-slot-internal), which describe Registry-side construction stages;
 * these describe where the Persistence create pipeline failed.
 */
export type DocCreateFatalPhase =
  | 'probe-read'        // claim 阶段 store 读证据获取被生命周期终结（committed:false）
  | 'snapshot-encode'   // Y.encodeStateAsUpdate 内部失败，pre-commit（committed:false）
  | 'store-write'       // 提交写被生命周期终结（abort），提交段未执行（committed:false）
  | 'post-commit'       // 提交点跨越之后的任何失败（committed:true）

/**
 * Frozen phase → authoritative commit fact. post-commit is the only true.
 * Exported (R1/A-7, additive): SA6/未来消费方可直接锁定映射表本身，无需
 * 逐 phase 构造实例反推。
 */
export const DOC_CREATE_FATAL_PHASE_COMMITTED: Readonly<Record<DocCreateFatalPhase, boolean>> = Object.freeze({
  'probe-read': false,
  'snapshot-encode': false,
  'store-write': false,
  'post-commit': true,
})

/**
 * Committed-aware create fatal (issue #108, ADR-0009 L78/L81, ADR-0008 §Fatal
 * 同款纪律). Carries the stable pipeline phase, the AUTHORITATIVE commit fact
 * (derived from the frozen phase map — callers can trust it and must never
 * re-derive or second-guess), and the exact original cause. Never claims,
 * promises, or performs rollback: a committed:true fatal leaves the committed
 * snapshot in the store; the caller must not retry create (a retry observes
 * DOC_DUPLICATE).
 */
export class DocCreateFatalError extends Error {
  readonly code: 'DOC_CREATE_FATAL' = 'DOC_CREATE_FATAL'
  readonly phase: DocCreateFatalPhase
  /** Authoritative commit fact for the initial snapshot (derived from phase). */
  readonly committed: boolean
  /** The exact original failure. Never concatenated into message. */
  readonly cause: unknown
  constructor(phase: DocCreateFatalPhase, cause: unknown, message = 'createDoc fatal: internal create failure') {
    super(message)
    this.name = 'DocCreateFatalError'
    this.phase = phase
    this.committed = DOC_CREATE_FATAL_PHASE_COMMITTED[phase]
    this.cause = cause
  }
}
```

### 1.4 谱系关系裁决

- **无共享基类**。四个类型（`DocDuplicateError` + 三个新类型）是互相独立的 `Error` 直接子类。理由：
  1. AC4 要求 duplicate 与 operational/fatal 不混合——兄弟并列 + 两两 `instanceof` 天然互斥，无基类串扰面；
  2. `code` 是四个互斥字符串字面量类型（`DOC_DUPLICATE` / `DOC_LOAD_OPERATIONAL` / `DOC_CREATE_OPERATIONAL` / `DOC_CREATE_FATAL`），TS 层面不可能串；
  3. 共享基类（如 `PersistenceDocError`）在本仓库没有任何消费方需求（Registry 尚未实施，且 ADR-0009 只要求「typed operational / duplicate / fatal」三分类映射，按 `instanceof` 或 `code` 单点判别即够）——引入即 YAGNI。
  **代价登记（R1/A-7，接受）**：未来 Registry 若需要 `isPersistenceError(x)` 一类「任意持久层错误」判别，须枚举 4 个类型（或改判 `code` 前缀）。判定为可接受：4 是封闭小集、且 Registry 需要的粒度本就是 operational/duplicate/fatal 三分支（ADR-0009 L81），「任意持久层错误」这个粒度没有已冻结的消费场景；届时若真需要，加共享基类属 additive 重构（给四类加中间基类不破坏既有 instanceof 判别）。
- **cause 保留方式**：自有可枚举类字段（与 `DocDuplicateError.code` 同一模式），**不用** ES2022 `super(message, { cause })`。理由：(a) Error-options 安装的 `cause` 是**非可枚举**属性，`toEqual`（own-enumerable 键比对）与序列化面不可见，而本仓库测试惯例是 `toMatchObject`/`toEqual`（SA8 gate、现有套件均如此）；(b) 类字段模式与现有 `DocDuplicateError` 完全一致（tsconfig `target: ES2022` ⇒ `useDefineForClassFields: true` ⇒ 带初始化器/构造器赋值的类字段是 own enumerable 属性，`toMatchObject({ code, committed, phase })` 直接可断言）。注意 `cause` 可枚举 ⇒ `JSON.stringify(err)` 会包含 `cause` 键；Error 型 cause 序列化为 `{}`（Error 无 own-enumerable 属性）不泄漏文本——EC1/EC3/EC5 负锁同时断言 `JSON.stringify(err)` 不含敏感 token（ belt-and-braces，见 §5.2）。
- **稳定 message**：三个新类型的 message 是**编译期常量默认参数**，lifecycle 全部调用点只传 cause/phase、永不传自定义 message ⇒ message 永不包含 cause 文本、owner/docId、路径。SA6 用字面量全等断言锁死（§5.2 N4）。

### 1.5 index.ts 导出（additive）

```ts
// index.ts 新增（既有导出逐字不动）
export {
  DOC_CREATE_FATAL_PHASE_COMMITTED,   // R1/A-7：冻结映射导出（additive）
  DocCreateFatalError,
  DocCreateOperationalError,
  DocDuplicateError,          // 既有，位置不动
  DocLoadOperationalError,
  type DocCreateFatalPhase,
  // …既有导出不动…
} from './contract.js'

export { type PersistenceIO } from './lifecycle.js'   // wrapIo 选项签名所需（见 §4.4）
```

`PersistenceIO` 类型进入包根导出是 additive（类型only），模块图不变（contract.ts 仍是叶；lifecycle.ts 不反向 import 任何 src 模块；index.ts 聚合再导出不违反 module-graph-regression.test.ts 的「非 index 不得反 import barrel」守卫）。

---

## §2 分类表（lifecycle 每个失败点 × 类型 × committed × cause × 理由）

### 2.1 load 路径（`loadDoc` → `loadSlowPath` → `resolveLoad` → read ticket → `routeOwnedRead`）

| # | 失败点 | 现状 | 新分类 | committed | cause | 理由 |
|---|---|---|---|---|---|---|
| L0 | `loadDoc` 入口 `assertReadable()`（已 disposed） | 裸 `Error('persistence is disposed')` | **保持裸传（逐字不变）** | — | — | 操作尚未开始的生命周期拒绝，非运营失败非内部 bug；现有测试断言 `/disposed/`；Registry 未来以自身 not-accepting 通道处理 |
| L1 | `io.read` 拒绝（epoch current：io down / EACCES / tmp 清扫失败…） | `ReadError` 值路由 → `routeOwnedRead` 裸 rethrow | **`DocLoadOperationalError`**（AC1） | — | `snapshot.err` **exact identity**（`toBe` 可断言） | store 级运营失败的唯一正确归类；ADR-0009 L81「Registry 只把 typed operational error 映射为公开 load issue」的前提。并发 load 共享同一 ticket ⇒ **同一个**包装实例Reject 全体（EC1 断言同一性） |
| L2 | `io.read` 拒绝但 epoch stale（dispose 先发生） | `routeOwnedRead` 首分支裸 `Error('persistence is disposed')` | **保持裸传（逐字不变）** | — | — | dispose 竞态不是 store 运营失败；谎报 operational 违反 AC6；现有 memory 测试 L415 `/restore aborted\|disposed/` 依赖此字面 |
| L3 | restore/validate：`Y.applyUpdate` 损坏 / `META.docId` 不匹配 | 裸 `Error`（动态 message 含 docId） | **保持裸传（message 逐字不变）** | — | — | **裁决：裸传而非独立类型**。①损坏是完整性事实，不是运营失败（AC6 禁止降级），也不是 create 管线 fatal（load 无提交点概念，为它发明 `DocLoadFatalError` 无消费方：Registry 对 unknown exception 的保守处理正是所要的诚实行为）；②dsh probe `isMetaMismatch` 按 `/META\.docId/` 匹配 message、memory/file 测试同款断言——裸传保零回归；③公开脱敏是 Registry 层职责（ADR-0009 L95），Persistence 内部错误携带 docId 属既有事实，不在本 issue 收敛 |
| L4 | `handleStatusOf` / `loadSlowPath` 完整性自检 | 裸 integrity `Error` | 保持裸传 | — | — | 内部不变量 bug，loud，不分类（分类反而给 bug 一个可映射的伪装） |
| L5（R1/A-2 补） | `loadSlowPath` L277 `assertReadable()`：读 ticket 已完成/合流后、handle 签发循环重入前发现 disposed（含 loop 重入与并发合流后续体） | 裸 `Error('persistence is disposed')` | **保持裸传（逐字不变）** | — | — | 与 L0/L2 同族：生命周期终结拒绝，非 store 运营失败（AC6 禁降级）；既有 memory 测试 L416/L434 的 `/disposed/` 断言覆盖同字面 |
| L6（R1/A-2 补） | 适配器层出口（先于 lifecycle）：FilePersistence `validateIdentity`（loadDoc/createDoc/saveDoc 前置）、`resolveSnapshotPaths` invalid key、构造器 `rootDir` TypeError；MemoryPersistence 构造无对应层 | 裸 `Error`/`TypeError` | **保持裸传（逐字不变）** | — | — | 调用方输入缺陷 / 装配错误，未进入任何 store 交互，无提交事实可言；file 测试 L305–L327（unsafe grammar 逐例）与 L49–L51 已锚定 |
| L7（R1/A-2 补） | `io.read`/`io.write` **同步 throw**（hook/包装实现首个 await 前抛出）——理论逃逸：`createReadTicket` L328 的 `this.io.read(...)` 调用不在任何分类 try 内，同步 throw 经 `resolveLoad`/`startReadTicket` 冒泡为裸 rejection（reading cell 未 set，无残留） | 理论裸传 | **不新增分类；以 §3.1 新增契约句封死**：「PersistenceIO 方法不得同步 throw，一切失败必须经 returned Promise 拒绝」 | — | — | 分类格点全部锚定在 await 位点；契约句保证 seam 失败必经 Promise ⇒ 落入 R1/W2 等既有格。违反该句属 seam 违约（与 A-5 同类，§1.2 边界声明覆盖） |

### 2.2 create 路径（`createDoc` claim 段 → 写段 → 注册段）

| # | 失败点 | 现状 | 新分类 | committed | cause | 理由 |
|---|---|---|---|---|---|---|
| C0 | 入口 `assertWritable()` / `validateCreateDoc`（disposed / META.docId 不匹配） | 裸 `Error` | **保持裸传（逐字不变）** | — | — | 前置输入缺陷与生命周期拒绝：调用方自身 bug / 状态，无提交事实可言；probe `isMetaMismatch` 与既有测试 `/META\.docId/` 锚定不动 |
| C1 | cache 命中 / creating 并发 claim / 读见快照 / 并发 claim 落败 | `DocDuplicateError` | **不变（AC4）** | — | — | 既有判定全部在写路径之前，逐字节保留 |
| R1 | claim 段 probe read 拒绝（无论 ticket 由 load 还是 create 发起），**epoch current** | 裸传 raw 异常 | **`DocCreateOperationalError`**（AC2） | `false` | raw 拒绝值 **exact identity** | **裁决：create operational 而非裸传**。probe read 是 create 自己的 duplicate 证据获取，属 store 级运营失败；裸传会使 Registry 把每次 store 抖动当 unknown（保守视为可能已提交）——而事实上什么都没写，**不诚实**。committed:false 权威（写路径未进入） |
| R2 | 同上但 **epoch stale**（含等待并发 load 的 `rawPromise` 拒绝竞态 dispose） | 裸传 | **`DocCreateFatalError('probe-read', …)`** | `false` | raw 拒绝值 exact | **裁决：fatal 而非 operational**。dispose 已终结生命周期，无法再核实 store 健康状况——不得谎报 operational（AC6）；committed:false 权威（写路径未进入） |
| R3 | probe read 成功（missing）但 `assertCurrentEpoch` 拒绝 | 裸 `Error('createDoc rejected: persistence is disposed')` | **`DocCreateFatalError('probe-read', …)`** | `false` | 原 disposed Error（旧字面保留在 cause.message） | 同 R2；旧裸字面作为 cause 保留，外层 message 换稳定 fatal 文案 |
| W1 | `Y.encodeStateAsUpdate(doc)` 失败（pre-commit internal） | 裸传 | **`DocCreateFatalError('snapshot-encode', …)`**（AC6） | `false` | encode 异常 exact | **裁决：fatal 而非裸传/operational**。Yjs 内部失败 = internal，AC6 禁降级；包装成 fatal 给 Registry 稳定 non-operational 分类 + 权威 committed:false（未到写路径），比裸 unknown 更诚实可用 |
| W2 | `io.write` 拒绝，**epoch current** | 裸传 | **`DocCreateOperationalError`**（AC2） | `false` | write 拒绝值 exact | 依据 §3.1 观察通道公理「reject ⇒ 基准 store 未被本次 write 改变」⇒ committed:false 权威；ADR-0009 L77 逐字对应。边界：seam 违约（部分提交后 reject）下 committed:false 对被违约部分不实——属 adapter bug 类，见 §1.2 边界声明（R1/A-5） |
| W3 | `io.write` 拒绝，**epoch stale**（dispose-abort 竞态） | 裸 `Error`（write resolve-但-未提交的旧歧义路径或 raw abort） | **`DocCreateFatalError('store-write', …)`** | `false` | 拒绝值 exact，两个变体各有确定性锚：①Memory/File 入口 abort 门的 `signal.reason`（AbortError）——EC7；②已进入写后在 hook 内显式 reject 的自持异常——§5.4.2 修订构造（两锚互补，见 §3.5 取舍说明） | **裁决：不得谎报 operational**。abort 属生命周期终结，非 store 运营失败；§3.1（R1：abort 门在 io.write 入口，见 §3.5 方案 (a)）下 reject ⇒ 写管线未进入或未触碰任何 store ⇒ committed:false 权威且与读路径可观察状态一致（委托模型矛盾窗口已结构性消除，§3.5） |
| W4 | 提交点跨越后第一种失败：**`assertCurrentEpoch` 拒绝**（dispose 在提交完成后、注册前竞态；本设计不为此增加任何 seam——分类只依赖「write resolved」这一既有事实） | 裸 `Error('createDoc rejected: persistence is disposed')` | **`DocCreateFatalError('post-commit', …)`**（AC3/AC5） | **`true`** | 原 disposed Error exact | write resolved ⇒ 提交段已执行（§3）⇒ 快照已在 store；Registry 据此禁止重试 create、允许 open——这是本 issue 的核心动机场景。**不删 store 内容、message 无 rollback 字样**（AC5） |
| W5 | 提交点跨越后：entry 注册段（`createEntry`/`cells.set`/`issueHandle`）异常 | 裸传（实际不可达：纯对象/Map/Set 构造） | **`DocCreateFatalError('post-commit', …)`** | **`true`** | 原异常 exact | 同 W4：写已 resolved ⇒ committed；防御性兜底分类，保持格点完备（每个 catch 都有确定归类，无「漏网裸传」） |
| C2 | 任意失败后的 claim 清理（`cells.delete`） | catch 内清理后 rethrow | **行为不变**（清理先于分类 rethrow，对所有分类/裸传/duplicate 一视同仁） | — | — | 清理与分类正交；`cur?.state === 'creating' && cur.claim === claim` 守卫逐字保留 |

### 2.3 分类不变量（SA6 逐条锁）

- I-1：`DocCreateOperationalError.committed === false` 恒成立（字面类型 + 唯二构造点 R1/W2 都在提交点之前）。
- I-2：`DocCreateFatalError.committed` 由冻结 phase 表唯一决定：`post-commit ⇒ true`，其余三值 ⇒ `false`；不存在 committed 与 phase 矛盾的实例（构造点唯一，且 phase↔committed 映射冻结于 contract.ts）。
- I-3：四个 code 两两互斥；四类实例两两 `instanceof` 互斥（无公共子类）。
- I-4：`saveDoc`/`flush`/degraded/retry 的全部拒绝与吞咽通道**不变**（本 issue 非目标）；`foreign or released DocHandle`、`persistence integrity:*` 裸字面逐字保留。
- I-5（R1/A-1）：**观察通道公理**——`committed` 的事实基准 = 该实例读路径会采信的 store（Memory 无 hook/probe 模型 = 私有 mirror；Memory 委托模型 = read hook 的共享 store（`??` 短路使 hook 为唯一读权威）；File = 磁盘 `.snapshot`）。`io.write` resolve ⟺ 基准 store 已持有快照；reject ⟹ 本次 write 未改变基准 store。Memory 的 abort 门位于 io.write **入口**（§3.5 方案 (a)）⇒ abort-during-hook 的写运行至完成 ⇒ committed:true 与基准 store 可读一致（EC10 锚定）。

---

## §3 commit-fact 裁决（SA8 裁决点 1）

### 3.1 裁决

**采用候选 (a)：IO seam 语义收紧，以「观察通道公理」为纲（R1 按 SA2 A-1 重述）**：

> **观察通道公理**：`committed` 的事实基准是**该实例读路径会采信的 store**——Memory 无 hook / probe 观察模型 = 私有 mirror（读走 mirror）；Memory 委托模型 = read hook 的共享 store（memory.ts L52–L55：wired read hook 是唯一读权威，`??` 短路使 mirror 永不被咨询）；File = 磁盘 `.snapshot`。`io.write` 的 resolve/reject 必须与该基准一致。

契约（lifecycle.ts `PersistenceIO` 注释 L12–L24 重写为）：

> - **`write` resolve ⟺ 基准 store 已持有本次快照**（提交段已执行：Memory = flat hook 副作用 + 私有 mirror set；File = temp→rename 完成）。**A write must never resolve without having executed its commit segment**（禁止 silent no-op resolve——R0 剔除的 Memory aborted 早退 resolve 即违例）。
> - **`write` reject ⟹ 本次 write 未改变基准 store**。abort 语义由**入口门**承载：一旦 `signal.aborted` 已置位，`write` 不得再**进入**其管线（Memory：入口 `throwIfAborted`，位于 flat hook 之前——R1/§3.5 方案 (a)；File：入口 + mkdir 后 + writeFile 后三道门，全部位于 rename 之前）。已通过入口门的 write **运行至完成**（含 hook 副作用与提交段；File 的 rename 一旦执行即完成）——完成 ⇒ resolve ⇒ committed（与基准 store 一致，见 §3.5 EC10 锚定）。
> - **seam 违约定义**（Adapter bug 类，lifecycle 不防御、只声明）：①`write` 部分提交后 reject；②`read`/`write` 同步 throw——**PersistenceIO 方法不得同步 throw，一切失败必须经 returned Promise 拒绝**（R1/A-2 契约句：lifecycle 的分类 catch 全部锚定在 await 位点，同步 throw 会绕过分类格点与 deferred 语义，见 §2.1 L7）。违反任一条 ⇒ 分类字段对被违约部分不实，属 Adapter bug，非分类伪降级（§1.2 边界声明）。
> - `read` must honor `signal` the same way（abort ⇒ 经 Promise reject，never a fabricated verdict，never a synchronous throw）。

落地改动一处代码语义：memory.ts `write` 的 `if (signal.aborted) return`（L59–L60，早退 resolve）**删除**，改为 `signal.throwIfAborted()` 提至 **flat hook 之前**（io.write 入口）；hook 之后直接 mirror set，无第二道门（§3.5 方案 (a) 裁决——R0 把门保留在 hook 后，被 SA2 A-1 证伪）。File 零改动（`writeCommittedSnapshot` 的 `throwIfAborted` ×3 全在 rename 之前，已满足上述契约）。

### 3.2 候选否决理由

| 候选 | 内容 | 否决理由 |
|---|---|---|
| (b) `write` 返回 `committed: boolean` | resolve 值携带提交事实 | ①破坏性改形：`PersistenceIO.write`、`DocStoreHooks.write`、全部 fixture/store 注入实现（memory/file/issue-79/sa7/namespace-runtime×5/dsh probe）都要改签名，测试面 churn 巨大；②信息冗余：reject ⇒ 未提交已由 (a) 给出，resolve ⇒ 已提交由 (a) 给出，boolean 无增量信息；③引入「说谎面」：Adapter 可以 resolve `{committed:false}` 与 resolve 语义自相矛盾，(a) 下说谎只能靠 reject-after-commit（被契约禁止且 File 结构性不可能） |
| (c) lifecycle 提交后复核 store（重读验证） | create catch 里重读 store 判 committed | ①TOCTOU：复核读自身可能失败/竞态，递归问题；②每次 create 多一次 IO；③把「提交事实」从 seam 契约降级为启发式，比 (a) 更不诚实 |
| (a′) hook 即唯一写权威（wired write hook 跳过 mirror set） | 曾评估 | **被现状否决**：dsh probe 的 `memoryIo.writeSnapshot` 是「同步纯观察，零存储」通道（probe.ts L114–L136，注释明言），存储靠 Memory 私有 mirror——sole-authority 会让 probe 的 memory 场景一无所存，直接摧毁 probe 及其确定性测试。保留「hook=观察/注入，mirror=提交段」现状结构 |

### 3.3 四路径影响分析（零回归证明）

**关键事实**：`abortController.abort()` 只在 `dispose()` 中调用，且 dispose 同步先做 `closed = true; epoch += 1` 再 abort（lifecycle.ts L257–L259）。因此对任何在 dispose 前启动的操作，**`signal.aborted ⇒ epoch stale**。四路径逐一：

| 路径 | 旧语义（aborted ⇒ write resolve） | 新语义（abort ⇒ 入口门 reject，或（写已进入）运行至完成 resolve；R1.1/N-2 三结局化） | 等价性 |
|---|---|---|---|
| **Memory create（写段）** | resolve → `assertCurrentEpoch` 抛裸 disposed Error | 两种确定结局（§3.5 方案 (a)）：①abort 先于 io.write 进入 ⇒ 入口门 reject（AbortError）⇒ W3 `committed:false`（store 两处均未触碰）；②abort 落在已进入的写中途（hook 未完）⇒ hook 完成 + mirror set ⇒ resolve ⇒ W4 `committed:true`（基准 store 可读，EC10 锚定） | **行为演进点（本 issue 目标）**：从「裸 disposed、无提交事实」变为「typed fatal + 与读路径一致的权威 committed」。无既有测试断言该通道字面（SA2 亲证：`grep 'createDoc rejected'` 全仓仅 src 一处）；共享套件 dispose-race 用例的断言（settlement instanceof Error、scheduler 0、后续 /disposed/）在新分类下全部保持 |
| **File create（写段）** | 无早退 resolve 问题；reject 点全在 rename 前 | 零代码改动 | 字节等价。abort-after-rename 窗口（rename 完成但 abort 已发）⇒ write resolve ⇒ W4 `committed:true`——**生产行为，外部不可确定性构造**（rename 完成与 create 续体之间无外部可 interleaved 的间隙），由 §5 EC5 在 wrapIo 层确定性锚定同一分类逻辑 |
| **flush（Memory/File 共享）** | resolve → `if (!isCurrent(epoch)) return`（try 段静默早退） | **三种结局**（R1.1/N-2；见下方 bullet 的三情形复核）：①abort 先于 io.write 进入 ⇒ 入口门 reject（AbortError）→ `catch { if (!isCurrent) return }`；②写已进入、hook reject（如 L437）→ `catch { if (!isCurrent) return }`；③写已进入、运行至完成（hook 完成 + 提交段）→ resolve → try 段 `if (!isCurrent) return`（如 L461/L490） | **可观察等价**：三结局都在 `isCurrent` 早退（catch 或 try 之二择一），`savedGeneration` 不推进、`degraded` 不置位、`scheduleRetry` 不触发、finally 的 stale 早退路径相同（`entry.flushing` 残留 true 亦同——entry 已被 dispose 拆除；结局③的晚到提交被 §6.5「排空+清序」清除，不可观察）。既有佐证：memory 测试 L437（结局②）与 L461/L490（结局③）**今天已分别覆盖 reject 与 resolve 两分支**且断言相同结局（timers 0、status disposed）；结局①（入口门）无既有用例，由 §5.4.2 R1 重构后的确定性构造覆盖（其 hook reject 属结局②的 identity 变体、EC7 经 seam 自查属结局①的 AbortError 变体） |
| **load（read）** | read 拒绝语义本就如此（File `readFile({signal})` reject；Memory hooked read 委托 hook） | 零改动 | 字节等价 |

**hooked Memory 写的 abort 门位置（R1 按 §3.5 方案 (a) 重写）**：abort 门位于 io.write **入口**（flat hook 之前）；hook 一经进入即运行至完成，随后无第二道门、mirror 照常 set ⇒ write resolve ⇒ committed:true——对委托模型（hook store = 读权威，store 可读）与 probe/无 hook 模型（mirror = 读权威，mirror 已 set）**两模型同时诚实**（R0「门在 hook 后」在委托模型下制造 `committed:false` + store 可读的矛盾，被 SA2 A-1 击穿，详见 §3.5）。`MemoryPersistenceOptions.writeSnapshot` 的契约义务相应改写为：**「hook 一经进入应运行至完成（含自身全部副作用）或在其副作用开始前 reject；不得部分提交后 reject」（§3.1 seam 违约定义）**；abort 检查由 adapter 入口门统一承担，hook 不再被要求自查 abort（仍可自行参考 signal）。既有绿灯在 (a) 下逐一复核：
- memory L437「aborted flush rejection」（hook 在 abort 上 reject）：入口门先过（写已进入）→ hook reject ⇒ flush catch stale 早退——结局不变；
- memory L461「never-settling writer」/ L490「dispose during flush」（hook 在 abort 上 **resolve**）：R0 语义为门 reject ⇒ catch stale 早退；(a) 语义为 hook 完成 + mirror set ⇒ resolve ⇒ **try 段** stale 早退——两分支结局相同（timers 0、status disposed、savedGeneration 不推进）；晚到的 mirror set 发生在 `core.dispose()` 的 `allSettled` 返回之前、被随后的 `snapshots.clear()` 清除（见 §4.3 dispose 不变量重述），不可观察；
- probe 观察通道：abort 先于 io.write 进入的尝试不再到达 `memoryIo.writeSnapshot`（hook 不再被调用）——SA2 亲证 probe 从不在写中途 dispose，该变化对 probe 场景**不可观察**；已进入的写照常被观察。此处显式声明而非沉默（R1/A-1 连带 ③）。

### 3.4 wrapIo 注入缝（两 Adapter 对称 additive，测试构造的统一机制）

`wrapIo` 是本设计**唯一新增的 seam**，服务于 AC7 的确定性故障/门控注入（理由：见 §5.1「构造可行性」——committed:true 与带门控的失败在两 Adapter 上都无法经公共面确定性构造）：

```ts
// contract.ts 不动；lifecycle.ts 已导出的 PersistenceIO 经 index.ts 类型再导出（§1.5）

// memory.ts MemoryPersistenceOptions 新增（file.ts FilePersistenceOptions 同款）
export interface MemoryPersistenceOptions {
  // …既有字段逐字不动…
  /**
   * Around-seam over this adapter's real I/O (fault injection / composition).
   * Receives the adapter's default io (Memory: entry-abort-gate → writeSnapshot
   * hook → mirror set, per §3.5 方案 (a); File: mkdir → writeFile tmp → rename)
   * and returns the io the lifecycle will use. The returned io MUST uphold the
   * PersistenceIO contract: write resolves ⟺ committed; rejects leave the
   * store unchanged; no synchronous throw.
   */
  readonly wrapIo?: ((io: PersistenceIO) => PersistenceIO) | undefined
}
```

装配（两 Adapter 同形，file.ts 中 baseIo 即现有 `readCommittedSnapshot/writeCommittedSnapshot` 闭包）：

```ts
const baseIo: PersistenceIO = { read: …, write: … }          // 现有实现原样
const io = options.wrapIo !== undefined ? options.wrapIo(baseIo) : baseIo
this.core = new PersistenceLifecycle(io, { … })
```

- 生产默认不传 ⇒ 行为与今天逐字节一致；File 的默认路径仍是**真实 mkdir→tmp→rename**（AC5 的提交点本体不动）。
- `wrapIo` 包住的是**含 flat hook 在内**的完整内层 io（Memory）；与 flat hook 可组合、顺序明确（flat hook 在内、wrapIo 在外），文档化。
- 无生产消费方（additive）；SA8 gate 的 probe 确定性前提不受影响（probe 不使用 wrapIo）。
- **不进入生产插件工厂签名（R1/A-3）**：`createMemoryPersistencePlugin` / `createFilePersistencePlugin` 的 options 类型由 `Omit<…, 'scheduler'>` 收紧为 **`Omit<…, 'scheduler' | 'wrapIo'>`**（一行级，§4.3/§4.4）——与本仓「测试缝挡在生产路径外」的既有风格一致（`seedForTest` 不进包根、`createMemoryHandleForTest` 走非包路径）；wrapIo 只经 adapter 构造器（测试直接 `new`/`createMemoryPersistence` 装配）。可选 SA6 静态锚：typecheck 级断言向插件工厂传 `wrapIo` 编译失败（`.typetest.ts` 或 expectTypeOf）。

### 3.5 A-1 裁决：delegation 模型 committed 说谎窗口（R1 新增）

**攻击复述（SA2 A-1，经公共生产 options，不用 wrapIo）**：MemoryPersistence 同时接线 `readSnapshot`+`writeSnapshot` 且委托同一共享 store（委托模型——memory-persistence.test.ts L89–L108、issue-79 L160–L175、namespace-runtime 5 个 hook 测试的现存装配形状）。时序：①`io.write` 进入 → `await writeSnapshot` 完成 ⇒ 共享 store 已有字节；②`dispose()`（closed/epoch++/abort）；③R0 的 abort 门（hook 后）抛 ⇒ write reject；④catch 判 stale ⇒ W3 `committed:false`；⑤`makeFresh()`（同 hooks、空 mirror）`loadDoc` 从共享 store **读回内容**——`committed:false` 与读路径可观察状态直接矛盾，违反 §3.1 自身公理。R0 的「hook 副作用可能已发生」散文辩护只对 probe 模型成立（probe 存储在 mirror），对委托模型不成立——且新共享套件的 Memory fixture 本身就是委托模型。

**方案对照（SA2 要求四维，逐维裁决）**：

| 维度 | 方案 (a)：abort 门移到 io.write 入口（hook 前） | 方案 (b)：保留门在 hook 后 + 三件套（事实域限定 doc + hook 义务扩写 + 窗口钉死红灯） |
|---|---|---|
| **cause 形态**（W3 abort 竞态） | ①abort 先于写进入 ⇒ 入口门 `signal.reason`（AbortError）；②已进入后 hook 内显式 reject ⇒ hook 自持异常（identity）。§5.4.2 与 EC7 由此成为**互补双锚**（identity 变体 + AbortError 变体各一）——SA2 预判二者将同构（均 AbortError），但 §5.4.2 采用「entered 门 + dispose 后显式 reject」确定性构造（见下），保住 identity 锚，覆盖面更宽，此为取舍 | 恒为 hook 后门的 AbortError——形态单一；§5.4.2 与 EC7 事实上同构（同一道门、同一种 cause） |
| **观察通道**（委托模型下 committed 事实） | abort-during-hook ⇒ hook 完成（store 有字节）+ mirror set ⇒ resolve ⇒ **committed:true**，与读权威可读一致——**窗口结构性消除**；残余不诚实仅剩「hook 部分提交后 reject」= seam 违约 = adapter bug 类（§1.2/§3.1 声明） | `committed:false` 但 hook store 可读的矛盾**继续存在**，仅被「事实域限定为 adapter 自有提交段」的 doc 宣布为 out-of-contract——把本 issue 要消灭的字段级说谎合法化 |
| **dispose 不变量** | 机制重述（强度不变）：「无 mirror 写晚于 `snapshots.clear()`」改由 **排空+清序**保证——abort 前已进入的写，其晚到 mirror set 发生在 `core.dispose()` 的 `allSettled(inFlight)` 返回**之前**（写必在某个 tracked op 内），随后 `snapshots.clear()` 清除之 ⇒ disposed 实例数据不可复活（memory.ts dispose 注释同步改写，§4.3） | 原机制保留（abort 门阻止 dispose 后 mirror 写），注释不动 |
| **§5.4.2 / EC7 取舍** | §5.4.2 改为确定性构造：hook 挂 entered 门 → 测试 await entered → dispose → release → hook **显式 throw 自持异常**（契约允许：副作用开始前 reject）⇒ W3 identity-cause；EC7 保持 seam AbortError-cause。两锚互补 | §5.4.2 维持 reject-on-abort hook（identity-cause）；EC7 同门同构 |

**裁决：方案 (a)。** 理由：(a) 从结构上消除矛盾（观察通道维度是决定项——(b) 把「committed 字段与读路径可观察状态矛盾」写进契约，恰是本 issue 立项要消灭的不诚实，只是从 message 猜测换成字段级）；(a) 的三项代价全部有界且可验证：cause 形态变化由互补双锚覆盖、dispose 不变量换机制不换强度（§4.3 重述）、probe 观察通道变化不可观察（§3.3 末段声明）。(b) 的唯一优势（不动 memory.ts 门位置）以容忍结构谎言为代价，不可接受。

**连带修订落实位置**：①门位置 → §3.1/§4.3（`throwIfAborted` 提至 hook 前）；②§5.4.2 cause 形态 → §5.4 修订 2（entered 门 + dispose 后显式 reject 的确定性构造）；③dispose 不变量重述 → §4.3 memory.ts 注释改写 + §6 新增不变量条目；④probe 观察通道说明 → §3.3 末段；⑤窗口锚定用例 → §5.3 **EC10**（SA2 A-1 红灯思路在方案 (a) 下的自洽绿灯形态：公共 flat hooks、不经 wrapIo，Memory 专属）。

---

## §4 变更规格（文件 × 改动要点；ALLOW/DENY 总表见 §8）

### 4.1 `packages/persistence/src/contract.ts`（修改，+≈65 行，0 删除）

1. 追加 §1.1/§1.2/§1.3 的三个类 + `DocCreateFatalPhase` 类型 + 冻结映射常量（**R1/A-7：映射常量导出** `export const DOC_CREATE_FATAL_PHASE_COMMITTED`，随 index.ts additive 导出）。
2. `DocDuplicateError` 与其余全部现有声明**逐字不动**。

### 4.2 `packages/persistence/src/lifecycle.ts`（修改，+≈45/−≈12 行）

1. **`PersistenceIO` 契约注释重写**为 §3.1 文案（接口签名不动）。
2. **import 扩展**：`DocCreateFatalError, DocCreateOperationalError, DocLoadOperationalError`（来自 `./contract.js`，DAG 不变）。
3. **claim 段分类**（§2.2 R1/R2/R3）：两个 `await …rawPromise` 位点与随后的 `assertCurrentEpoch` 位点包 try/catch，按 epoch current/stale 归类（伪代码见 §2.2；实现要点：`this.isCurrent(epoch) ? new DocCreateOperationalError(err) : new DocCreateFatalError('probe-read', err)`；`assertCurrentEpoch` 的裸 disposed Error 包成 `DocCreateFatalError('probe-read', err)`）。
4. **写段/注册段分类**（§2.2 W1–W5）：create op 内三段式 try/catch——encode 段（→`'snapshot-encode'` fatal）、write 段（current→operational / stale→`'store-write'` fatal）、提交后段（`assertCurrentEpoch` + `createEntry` + `cells.set` + `issueHandle` 整体 → `'post-commit'` fatal）；外层 catch 只做 claim 清理（守卫逐字保留）后 rethrow 已分类错误。
5. **load 路由分类**（§2.1 L1）：`routeOwnedRead` 的 `snapshot instanceof ReadError` 分支改为 `throw new DocLoadOperationalError(snapshot.err)`（`cells.delete(key)` 清理保持在前）。 disposed-first 分支与 restore/validate 分支逐字不动。
6. **潜在 unhandledRejection 修复（必改）**：`createReadTicket` 中 `completion` deferred 在「create 发起的 read ticket 被拒且无并发 load 等待 completion」时无人 await ⇒ 进程级 unhandledRejection（现状潜伏 bug，新 EC4/EC6 用例必然踩中）。修复：构造 ticket 时给 completion 挂 no-op 吸收 handler：

```ts
// The create path awaits `rawPromise` directly; when a create-started ticket
// rejects with no concurrent load attached, `completion` would otherwise be a
// forever-unhandled rejection. Awaited consumers still observe the rejection.
completion.catch(() => {})
```

   （挂在 deferred 本体上，不改变任何 await 方的观察结果；resolve 路径无此事件。）
7. `saveDoc`/`flush`/`scheduleRetry`/`maybeEvict`/`dispose`/`seedForTest`/句柄与状态机：**零改动**。

### 4.3 `packages/persistence/src/memory.ts`（修改，+≈12/−4 行）

1. **`write` 闭包 abort 门移位（R1/§3.5 方案 (a)）**：

```ts
write: async (key, snapshot, signal) => {
  signal.throwIfAborted()                       // 入口门：abort ⇒ 未进入管线 ⇒ reject（store 两处均未触碰）
  if (options.writeSnapshot) await options.writeSnapshot(key, snapshot, signal)
  this.snapshots.set(key, { snapshot: snapshot.slice() })   // 已进入的写运行至完成（与 File 的 rename 同构）
},
```

   （R0 版本把 `throwIfAborted` 放在 hook 后——被 SA2 A-1 证伪的委托模型窗口，见 §3.5。）
2. **`dispose()` 注释不变量重述（R1/A-1 连带 ②）**：`MemoryPersistence` 类 doc 与 `dispose` 处注释中「the aborted-signal guard already prevents any mirror write after dispose」改为新机制陈述：**「dispose 经 `core.dispose()` 先排空全部在-flight I/O（每个写都在某个 tracked op 内），abort 前已进入的写其晚到 mirror set 发生在 `allSettled` 返回之前，随后 `snapshots.clear()` 清除之——disposed 实例的数据不可复活」**（IO-3 语义不变，机制由 abort 门改为排空+清序）。
3. **io 闭包内联注释同步改写（R1.1/N-3 补，第三处注释）**：memory.ts L50–L55 现有注释「Byte-order and await-depth identical to the pre-core restore/flush paths; **the commit segment (mirror set) sits after the aborted-signal guard** …」的第二句在方案 (a) 下**变假**（提交段 = hook 副作用 + mirror set，门在 io.write 入口、hook 之前）。新文案：**「the abort gate sits at io.write ENTRY (before any hook side effect); a write that has entered runs to completion — hook side effects + mirror set — and resolving means committed (§3.5/ADR observability axiom)」**；「Byte-order and await-depth identical…」句复核保留（await 深度确实不变），仅替换语义句。read 侧注释（`??` 短路、hook 唯一读权威）逐字不动。
4. **`writeSnapshot` 注释契约义务改写（R1/A-1）**：「hook 一经进入应运行至完成（含自身全部副作用）或在其副作用开始前 reject；**不得部分提交后 reject**（§3.1 seam 违约定义）」；abort 检查由 adapter 入口门承担。
5. `MemoryPersistenceOptions` 追加 `wrapIo`（§3.4），构造器按 §3.4 装配；`readSnapshot` 语义逐字不动。
6. **`createMemoryPersistencePlugin` options 收紧（R1/A-3）**：`Omit<MemoryPersistenceOptions, 'scheduler'>` → `Omit<MemoryPersistenceOptions, 'scheduler' | 'wrapIo'>`（类型级一行；profile.ts 现有调用只传 schedule/memoryIo，兼容零改动）。

### 4.4 `packages/persistence/src/file.ts`（修改，+≈11/−1 行）

1. `FilePersistenceOptions` 追加 `wrapIo`（§3.4），构造器把现有 `io` 闭包提为 `baseIo` 后按 wrapIo 装配。`readCommittedSnapshot`/`writeCommittedSnapshot`/身份校验**逐字不动**。
2. **`createFilePersistencePlugin` options 收紧（R1/A-3）**：`Omit<FilePersistenceOptions, 'scheduler'>` → `Omit<FilePersistenceOptions, 'scheduler' | 'wrapIo'>`（类型级一行）。

### 4.5 `packages/persistence/src/index.ts`（修改，+7 行）

§1.5 的 additive 导出（4 个 error 值/类型 + 冻结映射常量 + `PersistenceIO` 类型）。既有导出与分组逐字不动。

### 4.6 `packages/persistence/src/testing.ts`（修改，**+≈250–300**/−≈15 行；R1/A-8 按 SA2 建议放宽估算）

§5 全部：`createPersistenceIoFaultSeam`（含 §5.3 修订草图）+ `describePersistenceErrorContract` + `PersistenceIoFaults`/fixture 接口 + 既有两处修订（§5.4）。既有 `describeDocCreateContract`/`describeDocPersistenceContract` 其余用例逐字不动。

---

## §5 共享契约测试规格（AC7；SA6 红灯依据）

### 5.1 构造可行性总论（为什么需要 wrapIo + fault seam）

对「分类逻辑」的红灯构造必须**确定性**且**只经公共面**（不碰 src 内部）。逐类核查：

| 类别 | 无 seam 可构造性 | 结论 |
|---|---|---|
| L1 load operational | Memory 可（flat read hook throw）；**File 不可注入任意 exact-identity 异常**（chmod 只能给真实 EACCES errno，无身份引用） | 需要 wrapIo（两 Adapter 同一机制、同一 exact-identity cause） |
| W2 create operational | 同上 | wrapIo |
| R1 probe-read operational | 同上 | wrapIo |
| R2/R3、W3 fatal committed:false | **可**（hold read/write + dispose，公共面），但需门控注入 | wrapIo（`holdNext*`） |
| W1 encode fatal | 公共面不可（Yjs 正常输入不抛）| 独立文件 `vi.mock('yjs', …importActual…)` 部分 mock `encodeStateAsUpdate` throw（Memory 一个 Adapter 即可——分类在共享 lifecycle，Adapter 无关） |
| W4/W5 fatal committed:true | **不可**：写 resolved 与 create 续体之间无外部可 interleaved 的间隙（File rename 完成到 assertCurrentEpoch 是同一微任务链；Memory 同构）| wrapIo 的 **after-commit hold**：`write: async (k,s,sig) => { await io.write(k,s,sig); enteredResolve(); await gate }`（R1/A-6 形态统一）——内层真实提交完成（File=真实 rename、.snapshot 落盘；Memory=hook store 写+mirror set）后挂起，dispose 再放行 ⇒ write resolve + epoch stale ⇒ 确定性命中 `'post-commit'` 分类，且 store 可观察地持有已提交内容。公共 flat hooks 路径的同构锚 = EC10 |

### 5.2 断言纪律（所有新用例统一）

- **N1 类型/字段**：`expect(err).toBeInstanceOf(DocLoadOperationalError)` 等 + `expect(err).toMatchObject({ code: '…', … })`；`committed`/`phase` 用全等断言。
- **N2 exact cause**：`expect((err as {cause: unknown}).cause).toBe(injectedReason)` —— 同一对象引用（`toBe`）。
- **N3 敏感文本负锁**：cause 携带哨兵串（如 `'TOP-SECRET-CAUSE-TOKEN-7f3a'`）与伪造路径（如 `'/etc/sekrit/root/users/alice'`），断言 `err.message`、`err.name`、`String(err.stack ?? '')`、`JSON.stringify(err)` 四者均 `not.toContain(哨兵串)` 且（File 用例）`not.toContain(rootDir 实值)`。
- **N4 稳定 message 全等**：`expect(err.message).toBe('loadDoc operational failure: the underlying store read rejected')` 等三条字面量——比 not.toContain 更强的「不拼接」锁。
- **N5 rollback 负锁（AC5）**：`expect(err.message).not.toMatch(/rollback|compensat|undo/i)`；并以行为证伪 rollback：committed:true 用例后 store 内容仍在（makeFresh 读回）、重试 create 得 `DOC_DUPLICATE`。
- **N6 裸传负锁（AC6）**：corruption/disposed 类用例断言 `not.toBeInstanceOf` 三新类型 + 既有正则。

### 5.3 共享套件 `describePersistenceErrorContract(factory)`（testing.ts 新增）

**fixture 契约**（两 Adapter 各自实现，套件只见此面）：

```ts
export interface DocPersistenceErrorContractFixture {
  readonly persistence: DocPersistenceWithCreate
  /** 同一已提交 store 上的全新 Adapter（空 cache）。Memory=同 DocStoreHooks；File=同 rootDir 真实 FS。 */
  readonly makeFresh: () => DocPersistence
  /** 向 store 直写原始快照字节（EC2 构造损坏/错 META 内容）。 */
  writeCommitted(owner: User, docId: string, bytes: Uint8Array): Promise<void>
  readonly dispose: () => Promise<void>
}

export type DocPersistenceErrorContractFactory =
  () => Promise<DocPersistenceErrorContractFixture> | DocPersistenceErrorContractFixture
```

**fault seam**（testing.ts 提供，两 fixture 复用同一实现——这是「同一组」的机制保证）：

```ts
export interface PersistenceHold { readonly entered: Promise<void>; release(): void }
export interface PersistenceIoFaults {
  /** 下一次 read 直接 reject(reason)，不触达真实 io。 */
  failNextRead(reason: unknown): void
  /** 下一次 write 在提交段之前 reject(reason)，store 不变。 */
  failNextWrite(reason: unknown): void
  /** 下一次 write 在提交段之前挂起；release() 放行真实提交。 */
  holdNextWriteBeforeCommit(): PersistenceHold
  /** 下一次 write 在真实提交完成之后挂起；release() 放行 resolve。 */
  holdNextWriteAfterCommit(): PersistenceHold
  /** 下一次 read 挂起；release() 后返回 value（不触达真实 io）。 */
  holdNextReadThen(value: Uint8Array | undefined): PersistenceHold
}
export interface PersistenceIoFaultSeam {
  readonly faults: PersistenceIoFaults
  wrap(io: PersistenceIO): PersistenceIO
}
export function createPersistenceIoFaultSeam(): PersistenceIoFaultSeam
```

实现要点（SA3 照抄级；**R1/A-6 修正接口形态**：公开面 `PersistenceHold.entered` 是 Promise，内部 arming 产出 resolver 函数——草图不再把 Promise 当函数调）：

```ts
// 内部 arming（不导出）：单发槽 + 三件套
function armHold(): { enteredResolve(): void; gate: Promise<void>; release(): void; hold: PersistenceHold }
//   hold = { entered: new Promise(r => …), release } —— 公开 PersistenceHold 形状
```

```ts
// wrapIo 返回的 io 必须自身满足 PersistenceIO 契约（§3.4 文档义务）。
// R1.1/N-6 注释理由更新：holdBefore 放行前的 signal 自查是 wrap 层对
// 「不得在 abort 后放行提交段」的**自洽契约保证**——对任意被包装的
// 内层 io 形状成立（wrap 不假设内层门位/门数）；对当前两 Adapter 的
// 内层实现（Memory：入口门在 hook 前；File：入口+两道准备段门）而言
// 属冗余防御（内层门已覆盖此情形），保留无害且使 wrap 不依赖内层细节：
wrap.write = async (key, snapshot, signal) => {
  const fail = take(failWrite)                 // 单发失败槽
  if (fail !== undefined) throw fail.reason    // 提交段之前拒绝，store 不变
  const holdBefore = take(holdBeforeSlot)
  if (holdBefore !== undefined) {
    holdBefore.enteredResolve()                // 内部 resolver；测试 await 的是 hold.entered（Promise）
    await holdBefore.gate                      // 测试在此期间 dispose
    signal.throwIfAborted()                    // 契约自查：abort ⇒ 不放行提交段 ⇒ reject
    return io.write(key, snapshot, signal)     // 未 abort（先 release 后 dispose 的对照路径）⇒ 真实提交
  }
  await io.write(key, snapshot, signal)        // 真实提交段（File=mkdir→tmp→rename；Memory=入口门→hook→mirror set）
  const holdAfter = take(holdAfterSlot)
  if (holdAfter !== undefined) {
    holdAfter.enteredResolve()                 // 此刻提交已成事实（File 可断言 .snapshot 在盘上）
    await holdAfter.gate                       // 测试在此期间 dispose ⇒ write 仍 resolve ⇒ committed:true
  }
}
// wrap.read 同理：failNextRead 直接 throw reason；holdNextReadThen 在 gate 后返回 value，不触达真实 io
```

**用例清单**（两 Adapter 全跑同一组；⚠ 标注时序纪律）：

| # | 用例 | 构造手法（经 wrapIo/公共面，不碰 src 内部） | 核心断言 |
|---|---|---|---|
| EC1 | load operational（typed + exact cause + 负锁 + 共享实例） | `failNextRead(new Error('io down: TOP-SECRET-CAUSE-TOKEN-7f3a'))`；两个并发 `loadDoc` | 两 rejection 是**同一个** `DocLoadOperationalError` 实例（ticket 共享）；N1–N4 全套；heal 后重试 load 成功（reading cell 自愈） |
| EC2 | load corruption 不降级（AC6） | `writeCommitted(owner, docId, encodeStateAsUpdate(错 META doc 的 Y.Doc))` → `loadDoc` | 裸 `Error`，`/META\.docId/`，`not.toBeInstanceOf` 三新类型 |
| EC3 | create operational（写前拒绝，committed:false） | `failNextWrite(new Error('io down: TOP-SECRET-…'))` → `createDoc` | `DocCreateOperationalError`、`committed === false`、cause `toBe`、N3/N4；`doc.isDestroyed === false`；`scheduler.pending() === 0`；`makeFresh().loadDoc → null`；heal 后同 key 重试成功且 `handle.doc === doc`（无 stale claim——既有用例语义并入） |
| EC4 | create operational（probe read 拒绝，R1 类） | `failNextRead(reason)` → `createDoc`（claim 段自探测读被拒，epoch current） | 同 EC3 类型 + cause；store 空；同 key 可重试。⚠ 该用例同时回归验证 §4.2.6 的 unhandledRejection 修复（vitest 默认对 unhandled rejection 判败） |
| EC5 | create fatal **committed:true**（AC3/AC5 核心） | ⚠ 时序：`holdNextWriteAfterCommit()` → `createDoc`（不 await）→ `await hold.entered`（真实提交已完成：File 可断言 `.snapshot` 已在盘上）→ `const d = fixture.dispose()`（不 await——dispose 会等 inFlight 的 create）→ `hold.release()` → `await d` → 收 `createDoc` rejection | `DocCreateFatalError`、`phase === 'post-commit'`、`committed === true`、cause `instanceof Error`；N5：message 无 rollback 字样；**行为证伪 rollback**：`makeFresh().loadDoc` 读回已提交内容（File=磁盘 `.snapshot` 解码出 ROOT 值）；重试 `createDoc` 得 `DOC_DUPLICATE`；`doc.isDestroyed === false`（所有权未转移，ADR-0006 失败条款） |
| EC6 | create fatal committed:false（probe-read abort，R2/R3 类） | `holdNextReadThen(undefined)` → `createDoc`（不 await）→ `await entered` → `fixture.dispose()`（不 await）→ `release()` → `await dispose` → 收 rejection | `phase === 'probe-read'`、`committed === false`、cause `instanceof Error`；store 空（`makeFresh → null`）；随后 `loadDoc/createDoc` 裸 `/disposed/`（L0/C0 通道不变锚） |
| EC7 | create fatal committed:false（store-write abort，W3 类） | `holdNextWriteBeforeCommit()` → `createDoc` → `await entered` → `fixture.dispose()`（不 await）→ `release()`（seam 契约自查 `throwIfAborted` ⇒ write reject，真实提交段从未执行）→ `await dispose` → 收 rejection | `phase === 'store-write'`、`committed === false`、cause `instanceof Error`（= `signal.reason` AbortError）；store 空（Memory：共享 store 无字节；File：`.snapshot` 不存在）；`scheduler.pending() === 0`。exact-cause-identity 的 abort 变体由 §5.4.2 修订用例锚定（hook 自持异常对象 reject） |
| EC8 | duplicate 独立性（AC4） | 既有 duplicate 构造（cache/store 路径） | `DocDuplicateError` `not.toBeInstanceOf` 三新类型；三新类型实例 `not.toBeInstanceOf(DocDuplicateError)`；`new Set([四个 code]).size === 4` |
| EC9 | encode fatal committed:false（W1 类；**独立文件**，仅 Memory fixture） | `vi.mock('yjs', async (orig) => ({ …await orig(), encodeStateAsUpdate: () => { throw encodeFault } }))` → `createDoc` | `phase === 'snapshot-encode'`、`committed === false`、cause `toBe(encodeFault)`；store 空；`doc.isDestroyed === false`。Adapter 无关性理由：分类在共享 lifecycle，一处锚定即覆盖两 Adapter（File 侧重复 mock 无增量） |
| EC10（R1/A-1） | **委托模型 abort-during-hook ⇒ committed:true 自洽锚**（SA2 A-1 红灯思路在 §3.5 方案 (a) 下的绿灯形态；**Memory 专属补充用例，放 `memory-persistence.test.ts`，不入共享套件**——构造机制是 Memory 公共 flat hooks，File 无对应公共注入面） | **只经公共生产 options，不经 wrapIo**（委托 fixture：`readSnapshot`+`writeSnapshot` 委托同一共享 store）；`writeSnapshot = async (key, snapshot, signal) => { enteredResolve(); await gate; return store.write(key, snapshot, signal) }`（hook 在 io.write 入口门通过后进入、于 abort 后完成自身提交——与 File rename 在途同构，契约允许）→ `createDoc`（不 await）→ `await entered` → `fixture.dispose()`（不 await）→ `release()` → `await dispose` → 收 rejection | `DocCreateFatalError`、`phase === 'post-commit'`、**`committed === true`**；**`makeFresh().loadDoc` 非 null 且读回内容**（读权威=共享 store，与 committed 一致——窗口消除的直接证据）；`doc.isDestroyed === false`；`scheduler.pending() === 0`；随后 `loadDoc/createDoc` 裸 `/disposed/` |

**fixture 接线**（测试文件侧，SA6）：
- Memory（`memory-persistence.test.ts`）：`createDocStore()` + flat hooks（读写委托 store，复用现有 create-suite fixture 形状——即委托模型，§3.5 攻击所在配置，EC1–EC8 在其上通过即证明窗口已消除）+ `wrapIo: seam.wrap`；`makeFresh` 同形；`writeCommitted = (o,d,b) => store.write(toKey(o,d), b)`。**EC10 亦在此文件**（公共 flat hooks 直构，不经 seam）。
- File（`file-persistence.test.ts`）：真实 mkdtemp rootDir，**只用 wrapIo**（默认 io=真实 FS）——EC5 即在真实 rename 提交点上锚定 AC5；`makeFresh = () => new FilePersistence({ rootDir, scheduler })`；`writeCommitted` 直接写 `{rootDir}/users/{u}/{d}.snapshot` 文件。EC10 无 File 对应（公共面无写注入缝；真实 rename 竞态不可确定性构造，R-1 + EC5 已锚定同一分类逻辑）。
- 两 fixture 都提供 `dispose`；File 用例后 `afterAll` 清理临时目录（既有模式）。

### 5.4 既有测试修订（必须，随契约演进的必然后果；SA8 冲突点 #2 已背书）

1. **testing.ts L447–472「does not cache, commit, or destroy…when the initial write fails」**：`store.write = async () => { throw new Error('io down') }` 保留；L456–457 `expect(err.message).toContain('io down')` 改为：`expect(err).toBeInstanceOf(DocCreateOperationalError)` + `expect((err as DocCreateOperationalError).committed).toBe(false)` + `expect((err as {cause: unknown}).cause).toBe(ioDownError)`（捕获 hook 抛出的同一实例）+ `expect(err.message).not.toContain('io down')`。其余断言（doc 未销毁、scheduler 0、fresh null、无 stale claim 重试成功）逐字保留。
2. **testing.ts L580–L612「settles an in-flight create when dispose races it」**：旧 hook「abort 时 **resolve**（未写）」在 §3.1 契约下是违规实现（resolve-without-commit）。**R1/A-1 连带①：改为 entered 门 + dispose 后显式 reject 的确定性构造**（不依赖 abort-listener 微拍时序——方案 (a) 下若写尚未进入，入口门会先以 `signal.reason` reject，listener 形态不再确定触发）：

```ts
const writeAborted = new Error('write aborted')           // 自持实例 ⇒ cause identity 锚
let releaseWrite: (() => void) | undefined
let writeEntered: (() => void) | undefined
const writeEnteredPromise = new Promise<void>((r) => { writeEntered = r })
store.write = (_key, _snapshot, _signal) => new Promise<void>((resolve, reject) => {
  writeEntered!()
  releaseWrite = () => reject(writeAborted)               // dispose 之后才放行 ⇒ hook 显式 reject（副作用开始前，契约允许）
})
```

   时序：`const creating = persistence.createDoc(...)` → `await withTimeout(writeEnteredPromise, …)`（确定性确认写已进入——入口门已过）→ `const d = fixture.dispose()`（不 await）→ `releaseWrite!()` → `await d` → 收 rejection。加严断言：`DocCreateFatalError`、`phase === 'store-write'`、`committed === false`、`err.cause === writeAborted`（exact-identity 变体；与 EC7 的 `signal.reason` AbortError 变体互补双锚，§3.5 取舍说明）。原有断言（settlement 非 TestTimeoutError、instanceof Error、pending 0、后续 `/disposed/`）全部保持；hook 未写 ⇒ store 空，与 committed:false 自洽。
3. **file-persistence-sa7-dynamic.test.ts L115**：`rejects.toMatchObject({ code: 'EACCES' })` → 该失败现在被包装为 load operational。改为 `rejects.toMatchObject({ code: 'DOC_LOAD_OPERATIONAL' })` + `expect((err as DocLoadOperationalError).cause).toMatchObject({ code: 'EACCES' })`（用例内先捕获 rejection）。用例其余部分（tmp 留存、chmod 痊愈后可读）逐字保留——它升格为「真实 FS errno → operational 包装 + cause 保真」的 File 专属锚。

### 5.5 不新增的测试（显式）

- 不给 saveDoc/flush/degraded/retry 写新用例（非目标，既有 issue-79 双套件继续覆盖）。
- 不在本 issue 给 File 接入旧 `describeDocCreateContract`（见 §7 OQ-2）。

---

## §6 行为不变量（必须逐字/逐字节不变 — SA4/SA7 回归基准）

1. `DocDuplicateError`：类名、`code:'DOC_DUPLICATE'`、`name`、默认 message、lifecycle `duplicateError()` 的动态 message 构造（含 owner/key）逐字节不变；duplicate 三判定路径与「写路径之前」时序不变。
2. 裸通道字面（全部保留）：`'persistence is disposed'`（loadDoc/saveDoc/createDoc 入口）、`'createDoc rejected: persistence is disposed'`（仅作为 fatal cause 存续）、`'foreign or released DocHandle'`、`doc META.docId … does not match requested docId …`、`persisted META.docId … does not match requested docId …`、`persistence integrity:*` 两条、FilePersistence 身份校验/`invalid persistence key` 文案、`required Cordis service …` 文案。
3. `saveDoc`/flush 调度/degraded→retry 恢复/generation 单飞/eviction/`seedForTest`：行为逐字节不变（§3.3 已证 aborted-write 分支迁移的可观察等价性）。
4. `loadDoc` null 语义、并发 load 合流、create/load 同键协调、U8 claim 结算：不变。
5. dispose 语义：AbortSignal 排空、timers 清零、closed 后拒绝面不变。**R1/A-1 重述**：Memory mirror 不变量由「排空+清序」保证——任何晚到的 mirror set（abort 前已进入的写）都发生在 `core.dispose()` 的 `allSettled(inFlight)` 返回之前、被随后的 `snapshots.clear()` 清除；**不存在晚于 `snapshots.clear()` 的 mirror 写**（每个写都在某个 tracked op 内）；disposed 实例数据不可复活（IO-3 语义不变，机制陈述见 §4.3）。
6. File 默认 IO（mkdir→writeFile tmp→rename、tmp 清扫、ENOENT 静默）与磁盘布局逐字节不变。**R1.1/N-1 措辞修正**：不传 `wrapIo` ⇒ io 装配走默认实现，该选项本身零行为增量——**Memory 默认实现的 abort 语义变化（门移至 io.write 入口）是本设计的核心变更点，权威描述见 §4.3/§3.5**（SA4/SA7 以 §4.3 + §3.3 末段 bullet 为回归基线，勿以本条「默认实现」短语推断 Memory abort 行为不变）。
7. 模块图与静态守卫：contract.ts 依赖叶地位、无反向 barrel import、生产 src 无 host-global timer API（新增代码不得引入 `setTimeout(`/`Date.now(` 等裸调用——新代码全部是类型/分类逻辑，天然满足）；`module-graph-regression.test.ts`/`core-dsh-boundary.test.ts` 必须保持绿。
8. probe 确定性：dsh probe 的 memoryIo 观察通道语义、S3 duplicate/meta-mismatch 判定、事件流不变。R1/A-1 注记：方案 (a) 下「abort 先于 io.write 进入」的尝试不再到达 writeSnapshot hook——probe 从不在写中途 dispose（SA2 亲证），该变化对 probe 场景不可观察（§3.3 末段）。
9. `packages/persistence` 导出面：纯 additive（§1.5），既有消费者零改动（probe.ts、dsh profile、namespace-runtime、issue-79 套件均无需一行变更——§10 审计）。
10. **插件工厂签名（R1/A-3）**：`createMemoryPersistencePlugin`/`createFilePersistencePlugin` 不接受 `wrapIo`（也不接受 `scheduler`）——测试缝只经 adapter 构造器。

---

## §7 风险与开放问题

| # | 风险/开放问题 | 处置 |
|---|---|---|
| R-1 | 生产行为「abort 恰落在 File rename 在途」产生 committed:true fatal，外部不可确定性构造（rename 完成到 create 续体间无外部间隙） | 接受：分类逻辑（write resolved ⇒ committed:true）由 EC5 在 wrapIo 层确定性锚定且 Adapter 无关；真实 FS 的提交点本体由 EC5(File fixture) + 既有 file 用例（rename 落盘、chmod 0o444 覆盖写、tmp 残留）共同锚定。写明不追求真实竞态复现 |
| R-2 | `cause` 为 own-enumerable 字段：非 Error 型 cause（如裸字符串）会被 `JSON.stringify(err)` 泄漏 | lifecycle 构造点的 cause 恒为 throw 出来的异常（异常对象或 Error）；文档已声明 cause 属内部观察面、公开脱敏是 Registry 职责（ADR-0009 L95）。负锁 N3 对 Error cause 已锁 `JSON.stringify` 安全 |
| R-3 | `vi.mock('yjs')` 部分 mock（EC9）若与 vitest 版本隔离语义冲突 | 回退方案：EC9 降级为「类型 + 分类表」静态锚（SA6 断言 `DOC_CREATE_FATAL_PHASE_COMMITTED` 行为经四 phase 构造实例锁定 committed 映射），encode 分支标注不可达性说明。不阻塞其余用例 |
| R-4 | wrapIo 属测试性 seam 进入生产 options（SA2 攻击点，判 MEDIUM 即 A-3） | **R1/A-3 已收敛**：wrapIo 不进入两生产插件工厂签名（`Omit<…,'scheduler'\|'wrapIo'>`，§3.4/§4.3/§4.4），只经 adapter 构造器；与本仓「测试缝挡在生产路径外」风格一致（`seedForTest`/`createMemoryHandleForTest` 先例）。保留在 adapter 构造器的辩护：Memory 既有 `readSnapshot/writeSnapshot` 即同类注入缝（全部消费方是测试/probe）；wrapIo 是 around 形状、additive、默认不传零影响、且是 AC7「同一组测试跑两 Adapter」的最小充分机制（备选无 seam 方案已被 §5.1 构造可行性表否决） |
| R-5 | ADR-0006 缺指向 ADR-0009 §Persistence 错误演进的交叉引用；**且其 #64 修订节「失败时不返回 handle、不缓存、不销毁传入 doc，所有权仍归调用方；**原始 I/O 错误原样上抛**」的字面与本实现的 typed 包装存在张力（R1/A-4 点名）** | **取代关系声明**：该「原样上抛」字样由 **ADR-0009 §Persistence 错误演进（L72–L83，2026-08-25 accepted，晚于 0006 全部修订节）明文授权演进**——SA8 Phase 0 冲突点 #1 已裁决 no-conflict（ADR 语料库的现行有效条款集 = 0006 减去被 0009 演进的错误通道字样）。**「原样」的意图保全与载体**：条款意图是调用方可 exact 观察原始失败、不吞不伪装；新契约下载体从「抛出的错误即原始异常」变为「typed 包装经 `error.cause` **exact identity** 携带原始异常（不重抛、不改写、不拼接）」——AC7 锁定 `err.cause === 原异常`（toBe 级），意图零损。#64 节其余条款（不返回 handle/不缓存/不销毁 doc/所有权归调用方/duplicate 判定/temp→rename 提交点）逐字维持效力。本 issue 不改 ADR 正文（0006 补交叉引用属语料卫生，建议独立 docs PR）；**PR 描述必须点名本条取代关系**，防后继读者按 0006 字面误判违约 |
| OQ-1 | Registry 实施时对 `DocCreateFatalError.committed:false` 的重试建议格式 | Registry 层决策（ADR-0009「不公开 retryable 猜测」仍约束其公开面）；Persistence 只交付事实 |
| OQ-2 | File 未接入旧 `describeDocCreateContract`（#64 遗留的 ADR-0006 实施注记缺口，#58 后未补） | 本 issue 不扩：旧套件是 store-replacement 模型，接入 File 需绕过真实 FS，与 AC5 相悖；错误契约面已由新共享套件双 Adapter 覆盖。建议后续以「FS-backed fixture」专项任务收口 |

---

## §8. 文件清单（File Scope）

### ALLOW LIST

| 文件 | 类型 | 理由（对应章节） |
|---|---|---|
| `packages/persistence/src/contract.ts` | 修改（+≈65） | §1 三个 error 类 + phase 类型 + 冻结映射（R1/A-7 导出） |
| `packages/persistence/src/lifecycle.ts` | 修改（+≈45/−≈12） | §4.2：seam 契约注释（含 R1/A-2 同步 throw 禁句）、claim/写段/注册段分类、load 路由包装、completion 守卫 |
| `packages/persistence/src/memory.ts` | 修改（+≈12/−4） | §4.3：abort 门移至 io.write 入口（R1/A-1）+ 三处注释重述（类 doc/dispose「排空+清序」、io 闭包 L50–L55 语义句（R1.1/N-3）、`writeSnapshot` 义务）+ wrapIo + 工厂 options 收紧（R1/A-3） |
| `packages/persistence/src/file.ts` | 修改（+≈11/−1） | §4.4：wrapIo（additive）+ 工厂 options 收紧（R1/A-3） |
| `packages/persistence/src/index.ts` | 修改（+7） | §1.5 additive 导出（含冻结映射） |
| `packages/persistence/src/testing.ts` | 修改（**+≈250–300**/−≈15；R1/A-8） | §5：fault seam + 共享错误套件 + 两处既有修订（§5.4.2 为 R1/A-1 确定性重构） |
| `packages/persistence/test/memory-persistence.test.ts` | 修改 `[SA6 owned]` | §5.3：接入 `describePersistenceErrorContract`（Memory fixture）+ **EC10**（R1/A-1 委托模型自洽锚，公共 flat hooks 直构） |
| `packages/persistence/test/file-persistence.test.ts` | 修改 `[SA6 owned]` | §5.3：接入 `describePersistenceErrorContract`（File fixture，真实 FS） |
| `packages/persistence/test/file-persistence-sa7-dynamic.test.ts` | 修改 `[SA6 owned]` | §5.4.3：EACCES 断言改锚 operational 包装 + cause |
| `packages/persistence/test/persistence-encode-fatal.test.ts` | 新建 `[SA6 owned]` | §5.3 EC9：yjs 部分 mock 的 encode fatal 用例（Memory） |

（SA3 仅可因实现需要对上述 src 文件做等价微调、对测试文件做基础设施性修订；断言逻辑属 SA6。）

### DENY LIST

- `packages/persistence/src/service.ts` — scheduler/clock 桥接，本任务不动
- `packages/persistence/package.json` — 无依赖/导出路径变更（`.` 与 `./testing` 已覆盖）
- `packages/dsh-persistence/**` — probe/profile/record/测试全部不动（§10 审计证明零影响）
- `packages/namespace-runtime/**` — Registry/Runtime 层不在本 issue
- `packages/clock/**`、`packages/vfsl*/**`、`packages/doc-runtime/**`、`domains/**`、`apps/**` — 无关
- `docs/adr/**` — 不动 ADR 正文（§7 R-5）
- `wiki/raw/task_persistence-typed-errors_sa8_gate.md` 等其他 SA 产出 — 只读

---

## §9. 协议假设依据 (Protocol Assumption Evidence)

**无协议级假设**：本设计仅涉及 TypeScript 类型/错误分类/测试构造，不含 HTTP/WS 端点、端口、进程时序或第三方服务行为假设。与运行环境相关的三条底层行为依据如下（非协议级，附证据）：

| 假设 | 依据类型 | 依据内容 | 风险等级 |
|---|---|---|---|
| `AbortSignal.throwIfAborted()` 在本仓 TS/Node 环境可用 | 源码引用 | `packages/persistence/src/file.ts` L110/L112/L114 现有调用（typecheck/test 全绿的基线） | 低 |
| chmod 0o555 目录使 `writeFile` 以 EACCES 拒绝、0o000 使 `readFile`/`rm` 以 EACCES 拒绝（Linux/macOS runner） | 现有测试引用 | `file-persistence-sa7-dynamic.test.ts` L169（「r-x: bob's flush writeFile fails with EACCES」，现绿）、L109（EACCES tmp 清扫用例，现绿） | 低（仅 File 专属补充用例依赖；共享套件经 wrapIo 注入，不依赖 chmod） |
| `useDefineForClassFields: true`（target ES2022 默认）下类字段为 own-enumerable，`toMatchObject` 可断言 | 源码引用 | `tsconfig.base.json` `target: ES2022`；既有 `DocDuplicateError.code` 字段已被 `assertDuplicateError`（testing.ts L272 `toMatchObject({ code: 'DOC_DUPLICATE' })`）以同模式断言且全绿 | 低 |

---

## §10. 契约改动连锁审计 (Contract Change Caller Audit)

### 改动函数/通道

| 通道 | 文件 | 改动前契约 | 改动后契约 |
|---|---|---|---|
| `PersistenceIO.write`（seam 语义） | `lifecycle.ts` L21–L24 注释 + `memory.ts` L57–L61 | aborted ⇒ 早退 resolve（未提交）；「failed write leaves store unchanged」仅口头 | 观察通道公理 + abort 入口门（R1：Memory 门在 hook 前，§3.1/§3.5）；resolve ⟺ 基准 store 已持有快照；reject ⟹ 基准 store 未被本次 write 改变；禁止同步 throw（R1/A-2） |
| `loadDoc` store 读失败通道 | `lifecycle.ts` routeOwnedRead | 裸 rethrow 原异常 | `DocLoadOperationalError`（cause=原异常 exact） |
| `createDoc` 失败通道 | `lifecycle.ts` claim/写/注册段 | 全部裸传 | §2.2 分类（operational/fatal/duplicate） |
| `MemoryPersistenceOptions`/`FilePersistenceOptions` | memory.ts/file.ts | — | additive `wrapIo`（默认不传=现状） |
| 插件工厂 options 类型（R1/A-3） | memory.ts `createMemoryPersistencePlugin` / file.ts `createFilePersistencePlugin` | `Omit<…, 'scheduler'>`（wrapIo 会自动泄入） | `Omit<…, 'scheduler' \| 'wrapIo'>`（wrapIo 只经 adapter 构造器） |
| 包导出 | index.ts | — | additive（§1.5，含冻结映射 R1/A-7） |

### Caller 清单（含是否 await / 直接 try-catch / 顶层 catch-all 三栏）

| Caller | 位置 | 是否 await | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---|---|---|---|---|
| lifecycle `createDoc` 写段（io.write 唯一写调用方之一） | `lifecycle.ts` L196 | ✅ | ✅（本设计新增分类 catch） | — | §2.2 W2/W3 分类 |
| lifecycle `flush`（io.write 另一调用方） | `lifecycle.ts` L461 | ✅ | ✅（既有 catch→degraded/retry；stale 早退） | `startFlush` 的 `.catch(() => {})` | 零改动：§3.3 flush 行证 abort 下**三结局**（入口门 reject→catch stale 早退 / 已进入后 hook reject→catch stale 早退 / 已进入后运行至完成 resolve→try 段 stale 早退，R1.1/N-2）可观察等价（`savedGeneration` 不推进、degraded 不置位；结局③晚到提交被 §6.5 排空+清序清除）；R2 复审已独立 trace 验证 |
| lifecycle `createDoc` claim 段（io.read 经 rawPromise） | `lifecycle.ts` L175/L182 | ✅ | ➕（本设计新增） | — | §2.2 R1/R2 分类 |
| lifecycle `driveLoadRead`/`routeOwnedRead`（io.read） | `lifecycle.ts` L351/L364 | ✅ | ✅（ReadError 值路由） | driver `.then` 吸收 | L1 包装；`completion.catch(()=>{})` 守卫修复潜伏 unhandledRejection（§4.2.6） |
| dsh probe `svc.createDoc`（duplicate/meta-mismatch 场景） | `dsh-persistence/src/probe.ts` L372/L388 | ✅ | ✅（instanceof `DocDuplicateError` / `isMetaMismatch` 消息正则，else 原样 rethrow） | probe 顶层 try（L177） | **零影响**：duplicate 通道不变（AC4）；meta-mismatch 裸传不变（§2.2 C0）；probe 无 store 读失败场景（memory 观察通道不注入 read 失败） |
| dsh profile（memoryIo flat hooks 透传；`createMemoryPersistencePlugin` 调用方） | `dsh-persistence/src/profile.ts` L62–L63 | —（装配） | — | — | 零影响：flat hook 语义不变（§3.2 (a′) 否决保留现状）；R1/A-3 工厂 options 收紧后 profile 现有调用（只传 schedule/memoryIo）兼容零改动；`wrapIo` 不被 profile 暴露（不扩 dsh 面） |
| 插件工厂调用方（R1/A-3 新增行）：dsh profile、core-dsh-boundary.test.ts（memory 与 file 两工厂均在此调用） | `profile.ts` L59/L75 / `core-dsh-boundary.test.ts` L44–45（memory+file 装配）/ L64（file 工厂缺 clock 负向）/ L71（file 工厂缺 clock 再覆盖）/ L78（file 工厂负向 C）/ `file-persistence.test.ts` L394（R1.1/N-4 修正：原引 `memory-persistence.test.ts` L116 有误——该行实为 `Y.encodeStateAsUpdate` 调用，非工厂调用方；memory 侧工厂调用方即 core-dsh-boundary 上述各行） | —（装配） | — | — | 均不传 `wrapIo`/`scheduler` ⇒ `Omit` 收紧零破坏；可选 SA6 typecheck 级静态锚（向工厂传 wrapIo 编译失败） |
| namespace-runtime 5 个测试的 flat-hook Memory 装配 | `runtime-acceptance-*` / `runtime-close-sa7-dynamic` 等 | ✅ | 按用例 | — | 零影响：hooks 双挂（读写都委托 store），无 aborted-write 依赖（dispose 前先 settle，§3.3）；R1 方案 (a) 下 abort-during-hook 若发生将完成提交（committed 诚实），但现用例不产生该交错 |
| memory/file/issue-79/sa7 测试的 `writeSnapshot` 注入 | 各测试文件 | ✅ | 按用例 | — | 零影响：失败注入靠 hook throw（reject 路径本就如此）；唯一 resolve-on-abort hook 在共享套件 L580–L612 → §5.4.2 R1 确定性重构（entered 门 + dispose 后显式 reject） |
| 共享套件断言（'io down' 通道） | `testing.ts` L455–457 | ✅ | — | — | §5.4.1 修订（预授权） |
| File EACCES loadDoc 断言 | `file-persistence-sa7-dynamic.test.ts` L115 | ✅ | — | — | §5.4.3 修订 |
| 未来 NamespaceRegistry | 未实施 | — | — | — | 本设计即其消费契约（ADR-0009 L81 映射规则） |

### 风险评估

- 遗漏 caller 的代价：未捕获的 `DocCreateFatalError` 冒泡到宿主顶层（dsh probe 顶层 try 已兜底；Cordis Host 无全局 exit-on-rejection 行为变更——本设计只**包装**既有 throw 通道，不新增 throw 点位：每个新增 throw 都替换一个既有裸 throw）。
- 抓全方法（已执行）：`grep -rn "loadDoc\|createDoc\|writeSnapshot\|readSnapshot" packages/ --include=*.ts` + 逐文件亲读（本设计「现状亲读」清单）；结论即上表，无遗漏 caller。

---

## SA2 反馈逐条回应（R1 闭合 A-1~A-8（REJECT → R2 复审 PASS）；R1.1 闭合 R2 注记 N-1~N-6；报告 `task_persistence-typed-errors_sa2_review.md` / `task_persistence-typed-errors_sa2_review_r2.md`）

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| A-1 (HIGH)：delegation 模型 committed:false 说谎窗口——显式二选一 + (a)/(b) 四维对照表 + 连带修订（§3.1 公理重述、§3.3 末段重写、§5.3 窗口锚定用例、memory.ts dispose 注释不变量） | ✅ **选方案 (a)：abort 门移至 io.write 入口（hook 前）** | §3.5（新增：攻击复述 + 四维对照表【cause 形态/观察通道/dispose 不变量/§5.4.2 与 EC7 取舍】+ 裁决理由）；§3.1（观察通道公理重述 + 门位置）；§3.3（表第一行双结局 + 末段重写：既有绿灯 L437/L461/L490 逐一复核 + probe 不可观察声明）；§2.2 W3 行（cause 双变体）；§2.3 I-5；§4.3（门移位代码 + dispose 注释「排空+清序」不变量重述 + writeSnapshot 义务改写）；§5.3 EC10（SA2 红灯思路在 (a) 下的自洽绿灯形态：公共 flat hooks、不经 wrapIo、Memory 专属）；§5.4.2（entered 门 + dispose 后显式 reject 确定性重构，identity-cause 与 EC7 AbortError-cause 互补双锚）；§6.5/§6.8；§8/§10 同步 | (b) 被拒：它把「committed 字段与读路径可观察状态矛盾」写进契约，恰是本 issue 要消灭的字段级说谎；(a) 三项代价（cause 形态、dispose 机制重述、probe 观察）全部有界可验证 |
| A-2 (MEDIUM)：分类表补 3 行 + seam 同步 throw 契约句 | ✅ | §2.1 新增 L5（loadSlowPath L277 assertReadable 出口）/L6（适配器层 validateIdentity/构造 TypeError 出口）/L7（io.read 同步 throw 逃逸→契约封死）三行；§3.1 第三 bullet 增「**PersistenceIO 方法不得同步 throw，一切失败必须经 returned Promise 拒绝**」；§4.2.1 注明契约句入注释 | 零代码行为变更（L5/L6 本就裸传保持；L7 以契约句封死理论逃逸） |
| A-3 (MEDIUM)：wrapIo 泄进生产插件工厂签名 | ✅ 采纳收紧（未选书面保留论证） | §3.4 新增 bullet；§4.3.6/§4.4.2（`Omit<…,'scheduler'\|'wrapIo'>`；条号经 R1.1/N-3 插项顺延）；§6.10；§8 规模；§10 新增「插件工厂 options 类型」通道行 + 工厂调用方 caller 行（profile/core-dsh-boundary/测试工厂，均不传 wrapIo ⇒ 零破坏）+ 可选 typecheck 级 SA6 静态锚 | 与本仓 seedForTest/createMemoryHandleForTest 挡板风格对齐 |
| A-4 (MEDIUM)：R-5 点名 ADR-0006 #64「原始 I/O 错误原样上抛」取代关系 | ✅ | §7 R-5 重写：点名该句由 ADR-0009 §Persistence 错误演进（更晚 + 明文授权，SA8 冲突点 #1 已裁决）取代；「原样」意图载体 = `error.cause` exact identity（AC7 `toBe` 级锁定，不重抛/不改写/不拼接）；#64 其余条款逐字有效；PR 描述必须点名 | 后继读者不再按 0006 字面误判违约 |
| A-5 (MEDIUM)：§1.2 类型 doc 补 W2 边界声明 + 与 §3.1 互指 | ✅ | §1.2 `DocCreateOperationalError` doc 追加 Boundary 段（信任 seam 契约、(c) 复核已否、seam 违约 ⇒ adapter bug 而非伪降级、AC6 以契约守恒而非机制）；§2.2 W2 行互指 §1.2/§3.1；§3.1 seam 违约定义处互指 §1.2 | 双向互指闭合 |
| A-6 (MINOR)：fault-seam 草图 `entered()` 调用形态矛盾 | ✅ | §5.3 实现要点重写：内部 `armHold()` 返回 `{ enteredResolve(): void; gate; release; hold }`，草图改调 `holdBefore.enteredResolve()`/`holdAfter.enteredResolve()`，公开面维持 `PersistenceHold.entered: Promise<void>`；armHold 签名块给出 | SA3 照抄可编译 |
| A-7 (MINOR)：冻结映射导出或登记代价 | ✅ 双管：导出 + 登记 | §1.3 映射改 `export const DOC_CREATE_FATAL_PHASE_COMMITTED`（doc 注明 R1/A-7）；§1.5/§4.1/§8 index 与规模同步（+7）；§1.4 追加「无共享基类代价登记」段（未来 isPersistenceError 需枚举 4 类或判 code 前缀；届时加中间基类属 additive 重构） | additive 零风险 |
| A-8 (MINOR)：testing.ts 规模估算放宽 | ✅ | §4.6 与 §8 均改为 **+≈250–300**/−≈15，注明按 SA2 建议放宽（9–10 EC × N1–N6 全套 + seam ~60 + fixture 接口 ~30） | 防 SA3/SA6 被行数锚绑架 |

### R2 复审注记 N-1~N-6（verdict PASS 附注；R1.1 一行级闭合，零行为/范围/测试结局变更）

| 注记 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| N-1 (MEDIUM-note)：§6.6「wrapIo 不传时与现状不可区分」在 R1 下自相矛盾 | ✅ | §6.6 | 改写为「不传 wrapIo ⇒ io 装配走默认实现，该选项零行为增量；Memory 默认实现的 abort 语义变化是本设计核心变更点，权威描述见 §4.3/§3.5」，并显式声明 SA4/SA7 回归基线以 §4.3 + §3.3 末段 bullet 为权威 |
| N-2 (MINOR)：§3.3 flush 行与 §10 flush 行仍是 R0 二元框架 | ✅ | §3.3 表头 + flush 行；§10 flush caller 行 | 表列头改「abort ⇒ 入口门 reject，或（写已进入）运行至完成 resolve」；flush 行三结局化（①入口门 reject→catch stale 早退 ②已进入后 hook reject→catch stale 早退 ③已进入后运行至完成→try 段 stale 早退），结局③晚到提交标注被 §6.5 排空+清序清除、结局①②的用例覆盖（§5.4.2 identity 变体 / EC7 AbortError 变体）写明；§10 行同步三结局 + 「见 §3.3 bullet」指引 |
| N-3 (MINOR)：§4.3 注释清单漏 memory.ts io 闭包注释 L50–L55 | ✅ | §4.3 新增第 3 条（后续条目顺延为 4/5/6；A-3 回应表与 §8 同步更新条号与描述） | 列入修订清单并给出新文案（门在 io.write 入口、hook 之前；已进入的写运行至完成、resolve 即 committed）；「Byte-order and await-depth identical…」句复核保留（await 深度不变），仅替换语义句；read 侧注释不动 |
| N-4 (MINOR)：§10 caller 行「memory-persistence.test.ts L116」引用有误 | ✅ | §10 插件工厂调用方行 | 修正为 core-dsh-boundary.test.ts L44–45/L64/L71/L78 + profile.ts L59/L75 + file-persistence.test.ts L394；行内显式标注修正说明（L116 实为 `Y.encodeStateAsUpdate` 调用）；「零调用方传 wrapIo」主张不受影响 |
| N-5 (TRIVIAL)：头注基线 HEAD 279d3ba 过时 | ✅ | 文档头注 | 更新为 **ba1b6b4** + rebase 说明（persistence 包最后触达仍为 279d3ba、两新提交仅涉 namespace-runtime、代码引用仍有效） |
| N-6 (MINOR)：§5.3 wrap 草图注释理由是 R0 推理 | ✅ | §5.3 wrap.write 草图注释 | 改写为「wrap 层对 PersistenceIO 契约的自洽自查（对任意被包装 io 形状成立，不假设内层门位/门数）；对当前两 Adapter 内层实现属冗余防御，保留无害且使 wrap 不依赖内层细节」——防 SA3 把陈旧推理抄进 testing.ts 注释 |

**修订自检（SKILL 一致性检查）**：全文 `throwIfAborted`/门位置表述统一为「io.write 入口、hook 前」（§0.3/§3.1/§3.3/§4.3/§5.3 草图注释/EC7/EC10）；「committed 事实基准 = 读路径采信的 store」在 §2.3 I-5/§3.1/§3.5/EC10 一致；§5.4.2 与 EC7 的互补（identity vs AbortError）在 §2.2 W3/§3.5 对照表/EC7 行/§5.4.2 四处一致；R0 被否的「门在 hook 后」表述仅存于 §3.1/§4.3/§3.5 的历史对照说明中并明确标记为已废弃；flush 三结局表述在 §3.3 表/§3.3 bullet/§10 三处一致（R1.1）；「与现状不可区分」陈旧短语已全文清除（R1.1/N-1）。
