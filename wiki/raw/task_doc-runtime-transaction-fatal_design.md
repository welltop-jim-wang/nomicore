# SA1 设计文档 — doc-runtime committed-aware transaction fatal 契约（issue #87，Phase 2）

- 任务：`wiki/raw/task_doc-runtime-transaction-fatal.md`（功能开发；ADR-0008「必要的底层演进」第 2 条兑付票）
- 红灯锚：`packages/doc-runtime/test/transaction-fatal-materialize-contract.test.ts`（16 用例）+ `packages/doc-runtime/test/apply-validated-mutation-fatal-contract.test.ts`（4 用例）——SA6 Phase 1 已锚定（17 红 / 3 护栏绿）
- 冲突基准：ADR 0001–0008 全集 + `CONTEXT.md`；边界条件 W1–W5（`task_doc-runtime-transaction-fatal_conflict_report.md`）
- 设计轮：**R3**（R1 首轮 → SA2 reject → R2 修订 → SA2 R2 复审 reject（唯一阻塞 = **R2-1**：R2「透传守卫的精确保留面」表两行断言与代码事实相悖——mutation try (A)–(G) 与 ⑥ try(3) 均存在调用方对象读取面）→ **R3 定点修订**：采用 SA2 推荐的**方案 A 结构化**，mutation (H)/(I) 移出 try + 全库零 instanceof 透传；R1/R2 骨架与 R2 已认可面（#2/#3/#4/#6/#8 真实落实、#5/#7 登记闭环、#1 transactGuarded 半边 + SA8 D3 推翻）不动）
- **R3 定点修订总览**（对应 SA2 R2 复审段 R2.2/R2.3；落实明细见文末「SA2 反馈逐条回应」表 R3 行）：

| R3 项 | 修订章节 | 修订实质 |
|---|---|---|
| R2-1 (CRITICAL) 方案 A | §3.3 / §3.4 / §7.2 | mutation (H)/(I) 物理移出 try（对齐 materializeRoot「④⑤⑥ 位于一切 catch 之外」结构）→ catch 收窄为 (A)–(G½) 且**删除 instanceof 透传**（伪造 branded 落 E205 ok:false，类 B 分级）；⑥ 三 catch instanceof 守卫**删除**（外来 branded 被 e201D 重分级 committed:true=位置事实，cause 保伪造实例）；「保留面」表重写为「catch 分级总表」——正确前提 = **try 块内存在调用方对象读取面（信封/value/derived），读取即执行外部代码**——全库**零 instanceof 透传** |
| nit-1 | §10 P-9 | 「dropped ⊆ 未声明键」→「dropped ⊆ 重建键集之外的 live 键（含 union 仲裁翻转下的投影差）」 |
| nit-2 | §7.6 用例 4 | 拒绝点归因 (C) → **(D)**（'not-a-number' 为 leaf 载体合法 string，extract 载体面接受，逻辑域归 validateLogicalSnapshot） |

- **R3.1 落文修正**（SA2 R3 verdict=**pass** 附条件闭环，非设计变更）：C-R3-1（必修）§15 ALLOW LIST 两处陈旧交叉引用修正——materialize.ts 条目删除已废除的「⑥ catch instanceof 守卫」变更指令（R3 零透传）、mutation.ts 条目对齐 R3 结构（~290 行 + prepareMutation）；C-R3-2（复核点）errDetail 嵌入段「」定界精确范围规格 + 锚安全实证 + SA4 复核命令（§3.4 表 / §12.6）。设计语义零变更。
- **R2 修订总览**（逐条对应 SA2 R1 攻击点 #1–#8；落实明细见文末「SA2 反馈逐条回应」表；其中 #1 的「⑥/mutation 透传保留」半边被 R3 推翻修正）：

| SA2 # | 严重度 | 修订章节 | 修订实质 |
|---|---|---|---|
| #1 | CRITICAL | §3.3 / §3.4 | `transactGuarded` 删除 instanceof 透传 → **无条件包装 E203**（cause 保原值，伪造 fatal 零信息损失）；推翻 SA8 D3 对应论证句；⑥/mutation 外层 catch 的透传保留并改写论证（透传面精确性） |
| #2 | CRITICAL | §7.2 (A) / §7.3 | own-key 纪律冻结（`Object.defineProperty` 终段写入 + `Object.hasOwn` 导航）+ value 缺失/undefined 与信封未知键的响亮拒绝 |
| #3 | MAJOR | §7.2 (G½) / §7.5 / §14 R-4 | 写前响亮预检：live 顶层键集 ⊄ 重建键集 → 单 issue 拒绝（对齐 F7「拒绝静默丢键」）；嵌套面显式移交；R-4 改写 |
| #4 | MINOR | §7.2 ⓪ | E202 消息参数化：mutation 侧指名 applyValidatedMutation，materialize 侧逐字不动（参数代入保证字节同一） |
| #5 | MINOR | §7.5 | (F)(G) 双读窗口独立条目登记 + 移交（W1 关系注明：W1 管响应形态，本项是检测宽度缺口） |
| #6 | MINOR | §3.3 / §6.3 | E203 引用段加「」引号定界 + AC-4 文本锚适用边界登记（约束 = 包装层自述 claims；被携带原文为证据引用，豁免） |
| #7 | MINOR | §4.5（新增） | sentinel 落点红灯锚覆盖缺口登记 + 补锚建议（SA6 owned） |
| #8 | NIT | §10 P-7 | git grep 无命中 exit code 笔误修正（exit 1） |

---

## §0. 总控移交的四项设计输入（本文档逐一定稿）

| # | 设计输入 | 定稿章节 |
|---|---|---|
| 1 | phase 取值集定稿（ADR-0008 留白） | §3.2（冻结表 + 演进纪律） |
| 2 | O2：E202 归类裁决 | §5（裁决：**不 fatal 化**） |
| 3 | U13「observer-boom 原样传播」与 branded fatal 包装的面冲突演进方式 | §6（裁决：U13 字节零改动保持绿；「原样传播」演进为「原样事实携带」） |
| 4 | O1：applyValidatedMutation fatal 契约面最小落地（不扩范围实现完整 mutation 管线） | §7（最小管线骨架 + set-only + 移交清单） |

另有一项**设计期新发现的红灯测试 fixture 缺陷**（SA6 apply 文件用例 2/3 的 observer 挂载时序），见 §8——R1 登记后 SA6 已对齐（SA2 评审 E-3 独立复现证实），§8 转为复核锚。

---

## §1. 任务类型与范围

**功能开发**：为 `@nomicore/doc-runtime` 冻结 committed-aware branded fatal 异常契约，使上层 Runtime 能区分「零写入 internal failure」与「transaction/observer 已提交后的 fatal」，不猜测、不虚假声称回滚。

**范围 = ADR-0008 演进条目 2 全部**：

1. 新增公共 branded 类 `DocRuntimeFatalError`（`committed: boolean` + 稳定 `phase: string`），经 `packages/doc-runtime/src/index.ts` 导出（AC-1）；
2. `materializeRoot` 的三类 internal fatal 场景以 branded fatal 交付，三相 phase 可机读区分（AC-2/AC-4/AC-5/AC-6）；
3. 领域结果联合面（ok:false + issues）不被 fatal 通道吞并（AC-3，护栏已绿，实现不得反向破坏）；
4. `applyValidatedMutation` 的 **fatal 契约面**最小落地（AC-6 / O1：不实现完整 validated mutation 管线）。

**明确不在范围**（O1 + ADR-0008 演进条目划分）：

- 完整 validated mutation 语义（delete / array-insert / array-delete、union 仲裁、未声明键处置、⑥ 对称重物化校验）——独立任务面；
- `readLogicalValueAtPath(doc, path)` schema-independent 签名改造（ADR-0008 演进条目 1）——独立任务面，本任务 `read.ts` 零改动；
- SCHEMA replacement 的 ROOT-content replacement helper（演进条目 3）——独立任务面；
- Runtime 层 `RuntimeWriteFatalError`、写能力永久关闭、`notifyDirty` 槽（ADR-0008 消费面）——`@nomicore/namespace-runtime` 包未建，本任务只提供事实契约（W4）。

---

## §2. 现状（代码实证基线）

### §2.1 materializeRoot 六阶段编排（现行，`materialize.ts:97-111`）

```
materializeRoot(derived, snapshot, doc)
 ├─ ⓪ assertOutermostTransactionContext(doc)   活动 transaction 语境 guard
 │     → throw 裸 Error「DOCRT-E202」三变体（A/B/C，消息逐字定稿）——写前、零写入
 ├─ prepare(derived, snapshot, doc)             ①②③ 共享崩溃边界（唯一 try/catch）
 │     ① validateLogicalSnapshot → 失败 ok:false + issues（引用零损透传）
 │     ② buildTopEntries（detached 构造）→ 单 issue fail-fast
 │     ③ probeRoot + ROOT 空置判定 → 单 issue
 │     catch-all → DOCRT-E200 单 issue（ok:false）——含「手造派生物」与对抗输入
 ├─ ④ doc.transact(set 循环)                    无 try/catch（INV-5 结构保证）
 │     observer 抛错 → 裸值原样传播（Error 或任意值）
 ├─ ⑤ verifyInstall                             顶层 size + 逐键同一性双断言
 │     偏离 → throw 裸 Error「DOCRT-E201」（变体 A size / B identity）
 ├─ ⑥ verifySnapshotIntact                      对称重物化 + productEqual
 │     偏离 → throw 裸 Error「DOCRT-E201 变体 C」；校验未能运行 → 变体 D
 └─ return { ok: true }
```

### §2.2 现行错误码家族（全部裸 `Error` + 消息前缀；`DocRuntimeFatalError` 全仓 grep 0 命中）

| 码 | 通道 | 场景 | committed 事实 |
|---|---|---|---|
| E100 | extract 崩溃边界（ok:false） | 读侧意外异常 | 不适用（读） |
| E200 | materialize ①②③ 崩溃边界（ok:false） | 写前意外异常（手造派生物 / 对抗快照 / 装配 RangeError） | false（零写入） |
| E201 | ⑤⑥ throw | 写后偏离（A/B）/ 语义偏离（C）/ 校验无法完成（D） | true（已提交） |
| E202 | ⓪ throw | 写前活动 transaction 语境拒绝（调用方契约破坏） | false（零写入） |

### §2.3 需求推演（Feature 切入点）

ADR-0008 把 fatal 契约定位为「事实披露」：doc-runtime 的 fatal **只携带事实**（committed / phase），不执行 Runtime 层动作（W4）。因此设计的本质不是新建错误处理流程，而是**给既有三处 loud 通道补 branded 身份 + 事实字段，并把一处被误收编进领域联合的 internal 异常改道 fatal**：

| 三相（AC-2） | 现行形态 | 缺失面 | 本设计动作 |
|---|---|---|---|
| observer cleanup throw | 裸值原样传播（Error / 任意值） | branded 身份、committed、phase | ④ 外包一层包装重抛（cause 携带原值，message 原样携带原始消息文本） |
| post-transaction verification | 裸 Error E201（A/B/C/D） | branded 身份、committed、phase | ⑤⑥ throw 点改 branded，**消息逐字不变** |
| 明确 pre-commit internal failure | 被收编为 E200 ok:false 单 issue | 整个 fatal 通道 | 从 prepare 崩溃边界**拆出**派生物不变量破坏类 → committed:false fatal |

关键推演：三相在管线中的**发生位置**天然互斥（⓪之前 / ④逃逸 / ⑤⑥ / 写前①②③），phase 取值即管线阶段的事实披露（ADR-0002：非 authority 式数据不变式体系）。

---

## §3. 核心设计

### §3.1 `DocRuntimeFatalError`（新文件 `src/fatal.ts`）

```ts
import * as Y from 'yjs';

/** fatal phase 取值集（v1 冻结，见 §3.2）。一经发布只增不改（ADR-0008「稳定 phase」）。 */
export type DocRuntimeFatalPhase =
  | 'observer-cleanup-throw'      // 事务调用栈异常逃逸（可达面 = observer cleanup 派发期抛错）
  | 'post-commit-verification'    // ⑤ verifyInstall / ⑥ verifySnapshotIntact 偏离或无法完成
  | 'pre-commit-internal';        // 写前 internal 不变量破坏（派生物畸形），零写入

/**
 * ADR-0008 原文命名的 branded fatal（W2'）。只携带事实（W4）：
 * 不调用 notifyDirty、不关闭写能力、不执行任何 Runtime 层动作。
 */
export class DocRuntimeFatalError extends Error {
  readonly committed: boolean;   // 诚实提交事实：true=事务已提交或保守视为已提交（W3）；false=确定零写入
  readonly phase: DocRuntimeFatalPhase; // 稳定管线阶段标识（冻结表 §3.2）

  constructor(
    phase: DocRuntimeFatalPhase,
    committed: boolean,
    message: string,
    options?: ErrorOptions,      // ES2022 ErrorOptions.cause——tsconfig.base target/lib = ES2022（实证见 §10）
  ) {
    super(message, options);     // 原生 cause 链：原始异常实例（Error 或任意 thrown 值）
    this.name = 'DocRuntimeFatalError';
    this.committed = committed;
    this.phase = phase;
  }
}
```

**类型面说明**：

- `constructor.name === 'DocRuntimeFatalError'`（AC-6 exact identity 锚）：类名即构造器名，另显式设 `this.name`（`Error.prototype.toString` 输出 `DocRuntimeFatalError: <message>`）。
- `extends Error` + target ES2022 原生 class（无 downlevel）→ `instanceof` 语义天然正确，**不需要** `Object.setPrototypeOf` 补丁（vitest esbuild 按 tsconfig target 保留原生 class；tsconfig.base.json 实证见 §10）。
- `cause` 经 `super(message, options)` 原生传递（ES2022 `ErrorOptions`）；非 Error thrown 值（string 等）作为 cause 同样合法（`cause?: unknown`）。
- 严格性核对：`exactOptionalPropertyTypes` / `noUncheckedIndexedAccess` / `verbatimModuleSyntax` 均兼容（无可选属性直赋 undefined、无索引访问、类型导入走 `import type`）。

### §3.2 phase 取值集定稿（v1 冻结表）——总控设计输入 #1

| phase 值 | committed（恒定） | 触发场景（管线位置） | message 码 | 通道前身 |
|---|---|---|---|---|
| `'observer-cleanup-throw'` | **true** | ④ `doc.transact` 调用栈逃逸的任何异常：observer cleanup 派发期抛 Error（已识别）、抛非 Error 值（未识别→保守 true，AC-5）、理论不可达的事务体引擎缺陷（D10 论证载荷不可使 set 抛错） | `DOCRT-E203`（新） | 裸值原样传播 |
| `'post-commit-verification'` | **true** | ⑤ verifyInstall 偏离（变体 A/B）与 ⑥ verifySnapshotIntact（变体 C 偏离 / D 校验未能运行）——事务已返回后 | `DOCRT-E201`（**保留，消息逐字不变**） | 裸 Error E201 |
| `'pre-commit-internal'` | **false** | 写前 internal 不变量破坏：`derived.structure` 非 root / ROOT 结构节点非 map 形 / 结构 ref 环 / ref 缺名（§4 拆分清单）——一切 doc 触碰之前 | `DOCRT-E204`（新） | E200 ok:false（拆出） |

**冻结纪律**（ADR-0008「稳定 phase」+ CONTEXT.md 方言「一经发布冻结，只增不改」文化同源）：

1. phase 值一经发布**只增不改不删**；未来新增 phase（如 mutation 侧 post-commit 面、SCHEMA replacement 面）须由后续 ADR/任务显式立项追加；
2. 每个 phase 的 committed 恒定值**随 phase 一并冻结**（上表第二列）——W3「committed:true 不得降格 false」由此可机读校验；
3. phase ↔ AC-2 术语映射：`observer-cleanup-throw` ↔ 「observer cleanup throw」；`post-commit-verification` ↔ 「post-transaction verification」（phase 命名取 committed 事实面）；`pre-commit-internal` ↔ 「明确 pre-commit internal failure」。

**三相两两互异 / 同场景稳定**（红灯断言）：phase 是静态字符串字面量，由 throw 点位置决定，同一场景重复触发恒同值；三相值两两不同——结构性满足，无需运行时机制。

**命名诚实性说明**（预防攻击）：`'observer-cleanup-throw'` 命名的是**逃逸点类别**（事务调用栈异常逃逸）。其可达种群经 D10 论证只有 observer cleanup 抛错（安装载荷 = copyJsonDomain 产物 + detached 类型，不可使 yjs `set` 抛错）；理论不可达的事务体内引擎缺陷若发生也落入本 phase（保守 committed:true 诚实——yjs 无事务回滚，transact 体内已执行的写入保留，实证见 §10）。message 文本明示「observer cleanup 派发期抛错」，不谎称已甄别具体来源。

### §3.3 新增内部构件（`src/fatal.ts` 内，不经 index.ts 导出）

```ts
/** 派生物不变量破坏 sentinel（包内）：仅由「合规调用者不可达」的手造派生物诊断点抛出。
 *  自身不携带 committed/phase——由捕获点按管线位置分类（prepare → pre-commit-internal；
 *  ⑥ scratch 侧 → E201 变体 D）。extends Error：extract 侧崩溃边界（E100）行为零变化。 */
export class DerivedInvariantError extends Error {
  constructor(message: string) { super(message); this.name = 'DerivedInvariantError'; }
}

/** ④/写事务统一包装器：materializeRoot 与 applyValidatedMutation 共用（exact identity 的结构性保证）。
 *  【R2 / SA2 #1】逃逸异常**无条件**包装为 DocRuntimeFatalError('observer-cleanup-throw', true, E203, { cause: 原值 })。
 *  无 instanceof 透传——分类权归 doc-runtime，不归抛错方（ADR-0007「事务开始后若未知 observer 抛错，
 *  视为 Runtime internal/fatal」的「视为」义务）。 */
export function transactGuarded(doc: Y.Doc, body: () => void): void {
  try {
    doc.transact(body);
  } catch (err) {
    // 【R2】删除 R1 的 `if (err instanceof DocRuntimeFatalError) throw err;` 透传——见下方论证。
    throw new DocRuntimeFatalError(
      'observer-cleanup-throw',
      true,
      `DOCRT-E203: Yjs 事务调用栈异常（observer cleanup 派发期抛错；写入已提交，不回滚、不补偿，` +
      `doc 保持事务留下的实际状态；未识别异常保守视为已提交）；原始异常原样携带（证据引用，非本 fatal 自述）：` +
      `「${errDetailOf(err)}」`,
      { cause: err },
    );
  }
}

function errDetailOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
```

**【R2 / SA2 #1】无条件包装论证（CRITICAL 修订核心）**：

1. **R1 的 instanceof 透传是「对内死代码、对外活漏洞」**：按本设计 D10 论证（§2.1 注、§3.2 注），事务体只含 copyJsonDomain 产物 + detached 类型上的 `set`/`clear`——**物理上不可能抛出 branded fatal**。透传守卫防的「内部 branded 自事务体逃逸被双重包装」对象不存在；而它放行的恰是唯一可达的命中来源：**observer（或引擎缺陷）抛出的外来 branded**。
2. **可伪造性**：`DocRuntimeFatalError` 是公共导出（§3.5，AC-1 要求），任何 observer 代码可 `new DocRuntimeFatalError('pre-commit-internal', false, 'spoof')` 并在 cleanup 派发期抛出 → R1 透传原样交付伪造 fatal → **committed 事实被降格**（事务实际已提交，SA2 E-1 实证 title 落盘 + update 发出）→ Runtime 按「committed:false 不调用 dirty notifier」→ 已提交写丢失 dirty notification（ADR-0006 链路失步）。这违反 ADR-0007 失败边界（归类义务在 doc-runtime，不在抛错方）与 ADR-0008/W3/AC-5（保守语义、committed:true 不降格）。
3. **无条件包装的正确性与零损失**：事务体不可能抛内部 branded（D10）⇒ 无条件包装在本设计下**永不双重包装**；对外来 branded（含伪造 fatal），包装为 E203 committed:true 是**诚实分类**（observer 抛错=已提交事实）且 `cause` 原样保留伪造实例——零信息损失，分类被纠正而非被信任。
4. **推翻 SA8 D3 论证句**：SA8 设计后复审（`task_doc-runtime-transaction-fatal_design_conflict_report.md` D3 行，依据栏末句）原文「**防御性 instanceof 透传杜绝双重包装**」随本修订**作废**——该「防御」防的是不存在的内部威胁（D10 下事务体不可抛 branded），开的是真实的外部伪造漏洞（SA2 评审 §0 明文指认；D3 行其余论证——「视为 internal/fatal 的可识别化强化 / 形态仍 throw / committed:true 是事实」——不受影响，继续有效）。R2 起以本节论证为准。
5. **红灯锚兼容**：SA6 17 红灯场景的 observer 只抛 `Error`/`string`（场景 E/F）→ 全部走包装路径，锚不受影响（SA2 §1.1 已核对）。补锚建议见 SA2 §4.1（observer 抛伪造 fatal → 断言交付 committed:true / phase `observer-cleanup-throw` / `err.cause === spoof 实例`）——登记于 §4.5 补锚清单。

**【R3 / SA2 R2-1】catch 分级总表（零 instanceof 透传原则；取代 R2「透传守卫的精确保留面」表——该表两行断言经 SA2 PoC-1/PoC-2 实证与代码事实相悖，随 R3 作废）**：

**原则**：全库（fatal.ts / materialize.ts / mutation.ts）**不存在任何 `instanceof DocRuntimeFatalError` 透传**——fatal 分级权 100% 归 doc-runtime；内部 fatal 的传递靠**结构**（throw 点物理位于一切 catch 之外），外来/伪造 branded 一律按**捕获位置的管线事实**重分级（cause 原样保留，零信息损失）。

**正确前提（R2 表两行断言的更正）**：try 块内存在**调用方对象读取面**（mutation 信封/value、snapshot、derived）——**读取即执行外部代码**（Proxy trap / getter 可抛任意值，含伪造 branded：`DocRuntimeFatalError` 是公共导出，任何调用方数据均可携带）。R2 表的错误在于把「外部执行面」窄化为「observer 派发」——`plainObjectOf(mutation)` 的 `getPrototypeOf`、`Object.keys(mutation)` 的 ownKeys trap、`mutation.value` getter、(F)/(G) 对 hostile value 的引用直读、⑥ 的 `derived.aliases`/`derived.structure` 二次读，全是事务体之外的外部代码执行面（SA2 PoC-1/PoC-2 实证投递路径）。

| catch 位置 | try 内调用方读取面（伪造 branded 投递路径） | try 内部 fatal 源？ | 分级处置（R3 定稿） |
|---|---|---|---|
| `transactGuarded`（④/(H) 事务体） | observer 派发（外部回调直接执行） | 无（D10：事务体仅 copyJsonDomain 产物 + detached 类型 set/clear，不可抛 branded） | **无条件包装** E203 committed:true（R2 定稿不变；cause 保原值） |
| `prepareMutation` catch（§7.2 (A)–(G½)；【R3 结构化】原 mutation 外层 catch 收窄） | (A1) `getPrototypeOf(mutation)`、(A2) `Object.keys(mutation)`（信封 Proxy trap）；(A5) `mutation.value` getter；(E) JSON 克隆读 proposed；(F) validateLogicalSnapshot 引用直读 hostile value；(G) copyJsonDomain 二读 | **无**（sentinel 由本 catch 自产 E204；(H)/(I) 已物理移出 try——transactGuarded/verifyInstall 的 E203/E201 不再经过任何 catch） | sentinel → E204 committed:false throw；**其余一律 E205 ok:false 单 issue**（含伪造 branded——类 B 分级：敌意用户数据不得升格 internal fatal，杜绝「一次敌意 value → Runtime 永久关写」DoS，守住 §4.1 类 B 判据） |
| `prepare` catch（materialize ①②③，先例对照） | snapshot getter/Proxy（引用直读，伪造 branded 落此） | 无 | sentinel → E204；其余 E200 ok:false（R1/R2 既有正确分级，本就无透传——SA2 R2.2 对照佐证） |
| ⑥ 三 catch（scratch 构造 / 双侧提取 / 产物比较） | **derived 二次读**：`makeRefResolver` 读 `derived.aliases[cur.name]`、`productEqual` 再访 `derived.structure.node`——计数型 Proxy（第 1 读过 prepare 同款机制、第 2 读抛伪造 branded）实证可达（PoC-2） | **无**（④⑤ 在 ⑥ 之前已抛出/返回——⑥ try 内无本包 branded throw 点；scratch 事务运行于零 observer 一次性 doc） | **【R3】删除 instanceof 守卫**：外来 branded → e201D 包装（branded committed:true / phase `post-commit-verification`——**⑥ 位置事实诚实**，杜绝「committed:false 谎报于已提交事务 → notifyDirty 丢失 → 持久化失步」链；cause 保伪造实例；message「」定界携带原文） |

**方案 A 论证（为何选结构化而非 Symbol brand）**：

1. **与 materializeRoot 自身纪律同构**：「④⑤⑥ 物理位于一切 catch 之外」（INV-5）本就是本包既定结构——mutation 的 (H)/(I) 移出 try 是把同一结构纪律应用到第二个公共入口，而非引入新机制；(A)–(G½) 收窄后的 catch 内**确无内部 fatal 源**，删除透传零代价。
2. **Symbol brand（方案 B）的劣势**：为「不存在的事件」（try 内内部 branded 逃逸）新增包内接缝与判别分支；且 brand 判定本身仍是「信任某类异常自报身份」的思路延续——结构化消除投递面比判别过滤更彻底。
3. **⑥ 守卫的「防未来演化」论证（R2）作废**：R2 保留⑥守卫的理由是「防未来内部演化误包装成变体 D」——但该收益以放行今日真实伪造面为代价（SA2 R2.2 对照佐证：同一判语「对内死代码、对外活漏洞」适用于此）；未来若 ⑥ try 内真出现内部 branded throw 点，正确做法是把该 throw 点移出 catch 或在引入时重新设计分级，而非预埋透传。
4. **e201D 包装的诚实性**：⑥ 运行于事务提交后——无论 try 内抛出的是引擎缺陷还是伪造 branded，「事务已提交」是捕获位置的管线事实，committed:true 恒诚实；伪造实例经 cause 保留、原文经「」定界嵌入，零信息损失；phase 归 `post-commit-verification`（校验防线内异常），不谎称已甄别来源。

**【R2 / SA2 #6】AC-4 文本锚适用边界登记**（E203 引用段定界）：E203 message 以「原始异常原样携带（证据引用，非本 fatal 自述）：「…」」内嵌原始异常文本（U13 子串锚机制基础，必须保留——「」定界不破坏子串匹配，`'observer-boom'` 仍是 message 子串）。适用边界——`ROLLBACK_CLAIM` 类文本锚（AC-4 / 未来 Runtime 文本过滤）约束的对象是**包装层自述 claims**；被携带的原始文本是**证据引用**（以「」显式定界），即使原文含「已自动回滚 / rolled back」也不构成 fatal 自身的回滚声称（fatal 自身 claims 仅「写入已提交，不回滚、不补偿」）。边界已同步登记于 §6.3；SA2 §4.8 补锚建议（observer 抛 `new Error('已自动回滚')` → 交付仍为 E203 / committed:true / phase `observer-cleanup-throw`）收入 §4.5 补锚清单。

消息红线自检（AC-4 文本面 / `ROLLBACK_CLAIM` 正则）：E203 **包装层自述**含「不回滚、不补偿」（负词声明，正则 `(已|已经|正在|将)\s*回滚|自动回滚|回滚…完成|rolled back` 不命中——负词「不回滚」的「不」不在前置词集内）；不含「自动回滚」「rolled back」。被携带的原文段以「」定界并按 §6.3 边界豁免（证据引用非自述）。§4 各消息同款自检。

### §3.4 materializeRoot 改造（`src/materialize.ts`，§伪代码）

```ts
export function materializeRoot(derived, snapshot, doc): MaterializeResult {
  assertOutermostTransactionContext(doc);          // ⓪ 不变：裸 Error E202（O2 裁决 §5）
  const ready = prepare(derived, snapshot, doc);   // ①②③ —— 拆分后的崩溃边界见 §4
  if (ready.kind === 'fail') return { ok: false, issues: ready.issues };
  transactGuarded(doc, () => {                     // ④ 唯一改动：裸 transact → 包装版
    for (const [key, value] of ready.entries) ready.rootMap.set(key, value);
  });
  verifyInstall(ready);                            // ⑤ throw 点改 branded（消息逐字不变）
  verifySnapshotIntact(derived, snapshot, doc);    // ⑥ e201C/e201D 改 branded（消息逐字不变）
  return { ok: true };
}
```

**⑤⑥ branded 化**（消息逐字保留，仅类替换——既有 `/DOCRT-E201/`、`toThrow('DOCRT-E201')`（子串）、变体文本锚全部保持绿）：

```ts
// verifyInstall 两处 throw（变体 A / B）：
throw new DocRuntimeFatalError('post-commit-verification', true, <原 DOCRT-E201 消息逐字>);
// e201C(detail) / e201D(detail) 工厂：同款替换；【R3】e201D 的 catch 包装路径（⑥ 三 catch）
// 一律携带 { cause: err }——从 R2 的「可选」升为必选：外来/伪造 branded 的实例保留面（§3.3 catch 分级总表）
```

**【R3.1/C-R3-2】errDetail 嵌入段「」定界的精确范围（落文规格 + 锚安全实证）**：

| 消息面 | 嵌入段定界 | 既有锚影响 |
|---|---|---|
| ⑤ verifyInstall（变体 A/B）与 ⑥ e201C（变体 C） | **不加定界，消息全量逐字不变**——嵌入的是本包自身诊断文本（键集/路径/摘要），非外来异常文本 | 37 处锚全绿（前缀形态） |
| ⑥ e201D **catch 路径**（三 catch 的 `（触发类…）：${errDetail(err)}` 嵌入段） | **恰对 `errDetail(err)` 插值段加「」**（`（触发类④）：「${errDetail(err)}」`）；模板骨架（`DOCRT-E201: …无法完成（` 前缀 + 触发类标签 + 末句「此形态不代表…未能运行」）**逐字不变**；`scratch.issue.message` 嵌入支（非 errDetail）不加定界（本包 issue 诊断文本） | **锚安全（实证）**：既有 37 处 E201 锚全部为前缀子串/正则形态（`toThrow('DOCRT-E201')` 13 处 + `toThrow(/DOCRT-E201/)` 24 处，本 worktree grep 全枚举）；变体 C/D 内部文本（触发类/无法完成/语义校验偏离/校验防线）**零测试锚**（grep 0 命中）——定界不破坏任何锚（SA2 E-12/V4 同结论） |
| E203（§3.3）/ E205（§7.2） | errDetailOf 插值段「」定界（R2/R3 已定稿） | 新码无锚 |
| E200（prepare 类 B/C 留守） | **不加定界，逐字不变**（rev2 Minor-2 锚定的冻结形态；与 E205 的风格差是字节同一承诺的代价，登记在案） | /DOCRT-E200/ 前缀锚 |

SA4 落文复核命令（C-R3-2）：`grep -rn "toThrow.*E201" packages/doc-runtime/test/` → 全部命中应为 `'DOCRT-E201'`（子串）或 `/DOCRT-E201/`（正则）前缀形态、零内部文本锚；实现侧 diff 核对 e201D 模板骨架逐字（仅 errDetail 插值段新增「」包裹）。

**INV-5 不变量演进声明**（SA3 须同步更新注释，防注释说谎）：原「④⑤⑥ 物理上位于一切 try/catch 之外（observer 抛错原样传播）」演进为——「④ 逃逸异常由 `transactGuarded` **无条件**包装为 branded fatal **loud 重抛**（cause 携带原始异常值、message 以「」定界原样携带原始消息文本），绝不吞并、绝不改写为 ok / 伪回滚形态；⑤⑥ 不在吞并性 catch 内；**mutation 侧 (H)/(I) 同构**（§7.2 R3：两入口的写事务与写后校验物理位于一切 catch 之外）」。loud 语义不变，形态从裸值升级为 branded 携带（§6）。

**⑥ 三 catch 守卫处置（【R3 / SA2 R2-1】推翻 R2 保留决定）**：`verifySnapshotIntact` 的三个 catch（scratch 构造 / 双侧提取 / 产物比较）**不加** `instanceof DocRuntimeFatalError` 守卫（R2 曾决定保留，经 SA2 PoC-2 实证作废）——⑥ try(3) 存在 **derived 二次读面**（`makeRefResolver` 读 `derived.aliases`、`productEqual` 再访 `derived.structure`，derived 是调用方入参）：计数型 Proxy 可使伪造 branded 恰在 ⑥ try 内抛出，守卫即原样透传 → committed:false 谎报于已提交事务（R1 #1 同链）。R3 定稿：外来 branded 被 e201D 包装为 branded committed:true（⑥ 位置事实诚实，cause 保伪造实例）——分级处置见 §3.3「catch 分级总表」。

### §3.5 导出面（`src/index.ts`，W2'/W4）

```ts
export { DocRuntimeFatalError } from './fatal.js';
export type { DocRuntimeFatalPhase } from './fatal.js';
export { applyValidatedMutation } from './mutation.js';
export type { MutationIssue, ApplyValidatedMutationResult } from './mutation.js';
```

- **不导出** `RuntimeWriteFatalError`（W2'/W4：两层命名互不侵占；红灯模块级断言 `mod['RuntimeWriteFatalError'] === undefined` 保持绿）；
- **不导出** `DerivedInvariantError` / `transactGuarded`（包内接缝；先例：`makeRefResolver` 的 `@internal` 导出模式，`extract.ts:230-232`）；
- `index.ts` 顶部文档注释同步：`materializeRoot` 条目「事务内 observer 抛错 loud 原样传播」改为「事务调用栈异常逃逸包装为 branded `DocRuntimeFatalError`（committed:true，phase `observer-cleanup-throw`，cause/message 原样携带原始异常）」；新增两条目（fatal 类 + applyValidatedMutation 最小面，措辞见 §7）。

---

## §4. E200 崩溃边界拆分裁决（「意外异常归类」= ADR 未枚举空间，W5 授权 SA1 定夺）

### §4.1 拆分判据：按「被破坏组件的信任边界」分类

`prepare` 的 catch-all（现行 E200）混装了三类性质不同的意外异常。判据：**哪一方损坏了**——

| 类 | 损坏方 | 举例 | 分类 | 理由 |
|---|---|---|---|---|
| A. 派生物不变量破坏 | **引擎内部链路**（evaluate 产物被手造/损坏） | `derived.structure` 非 root；ROOT 结构节点非 map 形；结构 ref 环；ref 缺名 | **committed:false fatal**（E204，phase `pre-commit-internal`） | `derived` 是引擎内部产物（evaluate 输出），任何合规调用者不可达；到达此处 = 引擎链路损坏 = internal failure——ADR-0008「任何 internal fatal 永久关闭 Runtime 写能力」处置**正确**；写前零触碰 doc |
| B. 外部输入敌对/超域 | **调用方数据**（snapshot / mutation value） | 对抗 Proxy 双读发散、getter 抛出 | **留 E200 领域联合**（ok:false） | snapshot 是公共 API 的外部输入，「任意 unknown」本就是被验证域；敌对输入是可预期失败——Runtime 不得因用户数据永久关闭写（W5） |
| C. 输入比例型资源极限 | 输入规模 × 引擎实现 | 极深 XML 装配 RangeError（rev2 Minor-2 锚定） | **留 E200 领域联合**（ok:false） | 与输入确定性成比例、可用更小输入重试成功；不指示引擎状态损坏；rev2 已冻结该形态（`materialize-root-rev2.test.ts:370` 锚 `/DOCRT-E200/` + ok:false——改道 fatal 即破坏既有绿灯，违反零回归门禁） |

### §4.2 prepare 拆分伪代码

```ts
function prepare(derived, snapshot, doc): Prepared {
  try {
    if (derived.structure.kind !== 'root') {
      throw new DerivedInvariantError('derived.structure 非 root（手造派生物）');   // 类 A → sentinel
    }
    const logical = validateLogicalSnapshot(derived, snapshot);
    if (!logical.ok) return { kind: 'fail', issues: logical.issues };              // 领域联合（不动）
    const top = buildTopEntries(derived, snapshot);
    if (top.kind === 'issue') return { kind: 'fail', issues: [top.issue] };        // 领域联合（不动）
    const probe = probeRoot(doc);
    ... // ③ 不动（ROOT 载体/非空 → 单 issue）
    return { kind: 'ready', rootMap: probe.map, entries: top.entries };
  } catch (err) {
    if (err instanceof DerivedInvariantError) {
      // 类 A：internal 不变量破坏 → committed:false fatal（写前、零写入）
      throw new DocRuntimeFatalError(
        'pre-commit-internal', false,
        `DOCRT-E204: 写前 internal 不变量破坏（${err.message}）——合规调用者不可达` +
        `（派生物仅可由 evaluate 产出，此处为 internal 缺陷类）；本调用零写入` +
        `（doc 状态不因本调用改变）；不补偿、不 fallback`,
        { cause: err },
      );
    }
    // 类 B/C：意外异常 → 领域联合（消息逐字不变，rev2 Minor-2 锚保持绿）
    const detail = err instanceof Error ? err.message : String(err);
    return { kind: 'fail', issues: [{ message: `DOCRT-E200: materialize 内部错误（意外异常）: ${detail}`, path: [] }] };
  }
}
```

### §4.3 sentinel 落点清单（全部为「手造派生物」诊断点，grep `手造` 全枚举）

| 落点 | 现行 throw | 改为 |
|---|---|---|
| `materialize.ts` prepare 首检（:448） | `new Error('derived.structure 非 root（手造派生物）')` | `DerivedInvariantError`（经 §4.2 catch → E204） |
| `materialize.ts` buildTopEntries（:204） | 同上消息 | `DerivedInvariantError`——prepare 供给链 → E204；⑥ scratch 供给链 → 被 `verifySnapshotIntact` (1) catch → **E201 变体 D**（branded committed:true，消息不变——⑥ 侧事务已提交，committed 事实由位置决定） |
| `materialize.ts` rootEntries（:497） | `new Error('ROOT 结构节点非 map 形（手造派生物）')` | `DerivedInvariantError`（→ E204） |
| `resolve.ts` makeRefResolver 环守卫（:23）/ 缺名（:31） | `new Error('结构 ref 环（…）'/'结构 ref 缺名（…）')` | `DerivedInvariantError`（materialize 供给链 → E204；read.ts 供给链见下） |
| `materialize.ts` verifySnapshotIntact（:281） | `new Error('derived.structure 非 root…')` | **不改**（⑥ 本地 catch → 变体 D，位置分类已定） |

**双副本登记（重要）**：`makeRefResolver` 存在两份逐字相同实现——`resolve.ts:15`（materialize 供给链）与 `extract.ts:233`（extract/read 供给链，rev1 声称「纯移动」的残留）。本任务**只改 `resolve.ts` 副本**；`extract.ts` 副本不动（其 throw 喂给 extract 的 E100 崩溃边界 / read.ts 内部处置，读侧通道不在本任务范围）。`DerivedInvariantError extends Error`，即使未来统一双副本，extract/read 侧行为零变化（catch-all 按 Error 处理）。

**类 B/C 留守 E200 的回归锚核对**：极深 XML RangeError（rev2 Minor-2，`/DOCRT-E200/` + ok:false + 恰 1 issue）✓ 留守；对抗 Proxy 双读（若有锚）✓ 留守。

### §4.4 错误码总表（本设计定稿后）

| 码 | 通道 | 形态 | phase | committed | 本任务变化 |
|---|---|---|---|---|---|
| E100 | extract 崩溃边界 | ok:false | — | — | 不变 |
| E200 | materialize ①②③ 类 B/C 意外异常 | ok:false | — | — | **收窄**（类 A 拆出）；消息不变 |
| E201 | ⑤⑥ 写后校验 | **branded throw** | `post-commit-verification` | true | 裸→branded，消息逐字不变 |
| E202 | ⓪ 事务语境拒绝 | 裸 Error throw | —（非 fatal） | —（零写入） | **不变**（§5） |
| E203 | ④ 事务调用栈异常逃逸 | **branded throw** | `observer-cleanup-throw` | true | **新增** |
| E204 | 写前 internal 不变量破坏 | **branded throw** | `pre-commit-internal` | false | **新增**（自 E200 拆出） |
| E205 | applyValidatedMutation 写前意外异常（类 B/C） | ok:false | — | — | **新增**（§7，mutation 侧 E200 同构） |

---

### §4.5 sentinel 落点的红灯锚覆盖缺口（【R2 / SA2 #7】登记 + 补锚建议）

**缺口（如实登记）**：E204 拆分判据（类 A → committed:false fatal）当前只有 **1/4** sentinel 落点被红灯锚锁定——prepare 首检（`materialize.ts:448`，SA6 场景 G）。其余三处（`buildTopEntries` :204 的 prepare 供给链、`rootEntries` :497、`resolve.ts:23/:31` 的环/缺名）**无回归锚**：SA3 若在某落点漏改（仍抛裸 `Error` → 被 catch-all 收编回 E200 ok:false），无锚变红，W3 的 committed:false 交付静默丢失。结构论证（四落点同入 prepare 同一 catch、同一 instanceof 判定）成立但**不可机读**。

**补锚建议（SA6 owned；非本设计硬门禁，SA4 静态评审时按结构论证核对四落点均改 sentinel）**：

1. 手造 ref 环派生物（`structure` 内自引用别名，如 `{...derived, structure: {kind:'root', node: {kind:'ref', name:'self'}}, aliases: {...derived.aliases, self: <该 ref 节点>}}` 形）→ 断言：throw `DocRuntimeFatalError` / `committed === false` / `phase` 非空且与 E203、E201 两相互异 / 0 update + state 字节不变 + ROOT 空置；
2. （可选加一）ROOT 结构节点非 map 形（union 成员含 leaf）→ 同款断言。

**同批补锚（SA2 §4 红线测试思路 #1/#2/#3/#5/#6 收录 + 【R3】R2.2 要求的敌意读投递路径锚，均 SA6 owned）**：

| SA2 思路 | 场景 | 断言要点 |
|---|---|---|
| #1 伪造 fatal（事务体投递） | materialize/apply 侧挂 observer 抛 `new DocRuntimeFatalError('pre-commit-internal', false, 'spoof')` | 交付 fatal `committed === true`（写入实际已提交：`root.get('title')==='t'`、updateCount≥1）、`phase === 'observer-cleanup-throw'`、`err.cause === spoof 实例`——锁定 transactGuarded 无条件包装 |
| #1 增补【R3/R2.2②】敌意读投递 a（mutation 信封/value 路径，PoC-1 封闭锚） | hostile value getter 在 (F) 校验读时抛伪造 `new DocRuntimeFatalError('pre-commit-internal', false, 'spoof')`（applyValidatedMutation，合规铺底 + 合规 set） | **ok:false + 单 issue（E205）**、零写入（state 字节不变）——**非 fatal 交付**（用户数据不得升格 internal fatal / Runtime 不得因此永久关写）；issue message 以「」定界含 'spoof' 原文 |
| #1 增补【R3/R2.2②】敌意读投递 b（⑥ derived 二次读路径，PoC-2 封闭锚） | 计数型 `derived.aliases` Proxy（第 1 读返回合法节点使 prepare/① 通过，⑥ `makeRefResolver` 第 2 读抛伪造 branded committed:false），materializeRoot 场景 | 交付 **e201D**：instanceof `DocRuntimeFatalError`、`committed === true`（⑥ 位置事实——事务实际已提交，updateCount≥1）、`phase === 'post-commit-verification'`、`cause === 伪造实例`——**非伪造 phase/committed 交付**（杜绝 committed:false 谎报 → notifyDirty 丢失链） |
| #2(a) `__proto__` | Record ROOT `type ROOT = Record<string, YLeaf<string>>` 铺底 `{a:'x'}`；`set(['__proto__'],'v')` | 不得「ok:true 且键静默不存在」——按 §7.3 定稿：own 键经 defineProperty 真实落键（ok:true 且读回键集含 own `'__proto__'`）或（若走 (F)/(G) 拒绝）ok:false 单 issue；对象值变体断言无原型劫持（`getPrototypeOf(proposed 重建产物)` 不变——经 (G) defineProperty 纪律保证） |
| #2(b) 原型链导航 | path `['r','constructor','x']` | 单 issue「中间容器缺失」类（own-key 判定），非「穿越不可下钻终态」误诊 |
| #2(c)/(d) 信封 | `{op:'set',path:['r','k']}` 无 value；`{op:'set',path,value,extra:1}` | 均 ok:false 单 issue；extract 读回原值不变（键未被静默清除）；state 字节不变 |
| #5 双读窗口 | 对抗 value 计数 Proxy（首读合法、次读发散） | 按 §7.5 移交登记的检测面缺口——断言**不出现未登记行为**（ok:true 且校验值≠落库值留待完整任务 ⑥ 锚定；本切片允许 ok:false（构造读异常 → E205）或 ok:true（两次读一致）两形态） |
| #6 文本边界 | observer 抛 `new Error('已自动回滚')` | 交付仍为 E203 / committed:true / phase `observer-cleanup-throw`（原文作为「」定界证据引用豁免文本锚） |

---

## §5. O2 裁决：E202 **不 fatal 化**——总控设计输入 #2

**裁决：E202（写前活动 transaction 语境拒绝）保持现行裸 `Error` throw，三变体消息逐字不变，`materializeRoot` 与 `applyValidatedMutation`（§7）同规。**

论证：

1. **语义归类**：E202 是**调用方契约破坏**（在未闭合外层事务 / cleanup 派发窗口内调用写入口），确定性检测、写前零写入——不是引擎 internal failure。ADR-0008 的 fatal 家族治理面是「任何 **internal** fatal」；E202 不属于该面。
2. **O2 语义重量警告**：若 fatal 化，Runtime 层按「internal fatal → 永久关闭全部写能力」处置——一次语境误用即永久关闭 namespace 写入，语义偏重（冲突报告 O2 原文）。ADR-0008 明文豁免：「该 ADR 只约束 internal fatal 面」——保持独立拒绝形态 no-conflict。
3. **判别机制留给 Runtime**：Runtime 以 `instanceof DocRuntimeFatalError` 驱动 fatal gate；裸 E202 非 instanceof → 走调用方错误处置（重试/上报），不触发写能力关闭、不 notifyDirty（零写入无 dirty 事实）。**登记为 Runtime 设计输入**（未来 `@nomicore/namespace-runtime` 任务的约束：fatal gate 判据 = instanceof DocRuntimeFatalError，不得按消息前缀判别）。
4. **回归零风险**：rev2 RT-2/RT-3/RT-4（`/DOCRT-E202/` + 「派发期间」「无法确认」「版本兼容性」「队列异常残留」「doc._transaction 非空」文本锚）与 materialize-root.test.ts E202 窗口锚全部不动即绿。

W3 自检：E202 零写入（写前拒绝）与 committed:false fatal 的零写入承诺同向；它不携带 committed 字段（非 fatal 通道成员），消息文本已明示「本函数零写入（doc 状态不因本调用改变）」。

---

## §6. U13 演进方式——总控设计输入 #3

**冲突**：`materialize-root.test.ts:595`（U13，rev1 RD5/RAC-5 收紧）`expect(() => materializeRoot(derived, { title: 't' }, doc)).toThrow('observer-boom')`，其注释声称「message 精确匹配（原样传播——异常必须是 observer 的原始错误，**非包装**）」；而 branded fatal 必须包装才能携带 committed/phase。

**裁决：U13 文件字节零改动、断言保持绿；「原样传播」契约演进为「原样事实携带」。**

### §6.1 机制实证（协议假设依据，详见 §10 表）

vitest `toThrow(string)` 的匹配语义 = **子串包含**（非全等）：`@vitest/expect@3.2.7` dist `def(["toThrow","toThrowError"])` 对 string 入参委托 chai 核心 `throws`；chai@5.3.3 核心实测（本 worktree node_modules，node 实跑）：

- message 含 `'observer-boom'` 子串 → 断言 PASS；
- message 不含 → 断言 FAIL。

即 U13 的**机械锚**是「错误 message 含 `observer-boom` 文本」，不是「错误对象 === 原始 Error 实例」。U13 注释中「精确匹配/非包装」的表述是对锚定意图的描述，其可执行形态是子串包含。

### §6.2 演进后的契约形态（保持 U13 四断言全绿）

E203 包装（§3.3）交付：

1. **message 原样携带**：`…原始异常原样携带（证据引用，非本 fatal 自述）：「observer-boom」…`——「」定界不破坏子串匹配（'observer-boom' 仍是 message 子串，P-1 实证语义）→ `toThrow('observer-boom')` 绿；
2. **cause 原实例**：`{ cause: originalError }`——原始 Error 实例身份可经 `err.cause` 取回（比现行裸传播更强的事实保留）；
3. **`observeCalls === 1` 绿**：包装发生在 transact 逃逸之后，无重入、无二次派发；
4. **`events.count === 1` + `root.get('title') === 't'` 绿**：包装器零写入、零补偿——doc 保持事务留下的实际状态。

### §6.3 契约措辞演进（登记，供 AC 门禁复核）

| 契约 | 演进前（rev1 U13 注释措辞） | 演进后（本设计冻结） |
|---|---|---|
| 形态 | 「错误 loud 原样传播（裸值）」 | 「错误 loud 原样携带：以 branded `DocRuntimeFatalError`（committed:true / phase `observer-cleanup-throw`）重抛，message 逐字含原始错误消息（「」定界证据引用）、cause 持原始 thrown 值」 |
| 不变量（不变） | 不吞并成伪 ok / 伪回滚；不改写成 E200/E201；不虚假声称回滚 | 同左——E203 是**新前缀**，不改写为 E200/E201；无补偿写 |

**AC-4 文本锚适用边界（【R2 / SA2 #6】登记）**：`ROLLBACK_CLAIM` 类文本锚的约束对象 = **包装层自述 claims**（「写入已提交，不回滚、不补偿」——恒不命中正则）；被携带的原始异常文本是**证据引用**（「」显式定界 + cause 链），即使原文含「已自动回滚 / rolled back」也不构成 fatal 自身的回滚声称，豁免文本锚判定。本边界对 AC-4 负面锚的现行红绿灯无影响（SA6 场景消息 'observer-boom' 等不触发正则）；补锚见 §4.5（SA2 思路 #6）。

**AC 门禁复核项**（移交）：U13 用例字节零改动且保持绿；SA6 注释是否随契约措辞更新由 SA6 自行决定（注释性、非断言性，不构成门禁条件）。

---

## §7. applyValidatedMutation 最小落地（O1）——总控设计输入 #4

**范围裁决：落地 = 「ADR-0007/PRD §6 冻结管线骨架」+ 仅 `set` 操作（含 `set([])` 整体替换）+ fatal 契约面；不实现 delete/array-insert/array-delete 语义与 mutation 侧 ⑥ 校验（移交清单见 §7.5）。**

### §7.1 公共面（新文件 `src/mutation.ts`）

```ts
/** mutation 领域 issue（ADR-0008「ROOT mutation 独立窄 issue 类型」；与 MaterializeIssue 同形不同名）。 */
export interface MutationIssue { message: string; path: Array<string | number>; }
export type ApplyValidatedMutationResult =
  | { ok: true }                                    // 成功只返回 {ok:true}（ADR-0007）
  | { ok: false; issues: MutationIssue[] };

export function applyValidatedMutation(
  derived: DerivedSchema,
  doc: Y.Doc,
  mutation: unknown,                                // ADR 未逐字冻结字段名；运行时校验形状
): ApplyValidatedMutationResult;
```

mutation 参数形状采用 SA6 测试的最小直译 `{ op: 'set', path: readonly (string|number)[], value: unknown }`（**本设计对齐该命名并冻结为 doc-runtime 侧 v1 事实**；完整四操作联合类型由 validated-mutation 独立任务定稿——SA6 文件头已预留此对齐登记）。公共类型暂不导出 mutation 参数的具名类型（避免提前冻结未定稿联合），仅导出结果/issue 类型。

### §7.2 管线（ADR-0007 冻结骨架逐句直译 + PRD §6 次序；【R2】含 SA2 #2/#3/#4 修订，【R3】含 R2-1 方案 A 结构化）

```ts
export function applyValidatedMutation(derived, doc, mutation): ApplyValidatedMutationResult {
  assertNoActiveTransaction(doc, 'applyValidatedMutation');   // ⓪ 【R2/#4】E202 裸 Error（§5 同规），
                                                              //    参数化指名本函数（消息方案见下）——一切 catch 之外
  const ready = prepareMutation(derived, doc, mutation);      // (A)–(G½) 写前只读+构造区（唯一 try/catch 所在，
  if (ready.kind === 'fail')                                  //           对齐 materializeRoot 的 prepare 结构）
    return { ok: false, issues: ready.issues };               // 领域联合（ok:false）——不 throw、零写入
  // —— (H)(I) 物理位于一切 catch 之外【R3/SA2 R2-1 方案 A，对齐 materializeRoot「④⑤⑥ 位于一切 catch 之外】：
  transactGuarded(doc, () => {                                // (H) 单次 Yjs transaction（与 ④ 同一包装器；
    ready.rootMap.clear();                                    //     observer 逃逸 → E203 committed:true 直接上抛；
    for (const [k, v] of ready.entries) ready.rootMap.set(k, v);   // 事务体仅 detached 产物 set/clear，D10）
  });
  verifyInstall({ rootMap: ready.rootMap, entries: ready.entries });  // (I) ⑤ 复用——E201 committed:true 直接上抛
  return { ok: true };
}

type MutationPrepared =
  | { kind: 'ready'; rootMap: Y.Map<unknown>; entries: Array<[string, unknown]> }
  | { kind: 'fail'; issues: MutationIssue[] };

function prepareMutation(derived, doc, mutation): MutationPrepared {
  try {
    // (A) 【R2/#2】mutation 信封校验（领域单 issue，零写入，逐项响亮拒绝）：
    //   A1. mutation 非 plain object（plainObjectOf 同款原型守卫）→ 单 issue；
    //   A2. 信封 own 键集必须恰为 {op, path, value}——含未知键（如 extra / 笔误 val）→
    //       单 issue「未知信封键 "…"（允许的键：op/path/value）」（闭环信封，杜绝笔误零反馈）；
    //   A3. op === 'set'；'delete'|'array-insert'|'array-delete' → 单 issue「…属 validated mutation
    //       独立任务面，本切片未支持」；其他 op 值 → 单 issue「未知操作 "…"」；
    //   A4. path 为 Array 且每段 string|number → 否则单 issue；
    //   A5. 【R2/#2c】Object.hasOwn(mutation,'value') 且 value !== undefined → 否则单 issue
    //       「set 需携带非 undefined value；清除字段属 delete 操作语义（独立任务面）」——
    //       杜绝「set(undefined) ≡ 隐式 delete」走私 delete 限制语义（ADR-0007：delete 禁
    //       ROOT/required/下标，独立操作面）。
    // (B) 派生物 guard：derived.structure.kind !== 'root' → DerivedInvariantError（→ catch → E204）
    // (C) extractYjsSnapshot(derived, doc)          当前 ROOT 结构检查（载体域）
    //     !ok → return { ok:false, issues: ex.issues }   ——「当前 ROOT 已损坏 → 普通失败，不承担 recovery」
    // (D) validateLogicalSnapshot(derived, ex.snapshot)  逻辑域双重确认（PRD §6 次序；载体合法而逻辑
    //     !ok → return { ok:false, issues }              错位（如 number 字段的 'not-a-number' string）在此拒绝）
    // (E) proposed = cloneJson(ex.snapshot)（extract 产物为纯有限 JSON → JSON 往返恒等，§7.6/P-6；
    //     own '__proto__' 键经 defineProperty 创建者往返保真——SA2 E-11 实证，克隆步不引入新丢键向量）
    //     placeSet(proposed, path, value)（§7.3 concrete-JSON 放置器，own-key 纪律）→ issue → return 单 issue
    // (F) validateLogicalSnapshot(derived, proposed)      完整 proposed ROOT 逻辑校验
    //     !ok → return { ok:false, issues }（完整 issues 透传——logical 保留完整 issues，ADR-0007）
    // (G) top = buildTopEntries(derived, proposed)        detached 构造（复用 ②；sentinel → E204；issue → return 单 issue）
    //     const rootMap = doc.getMap('ROOT')
    // (G½) 【R2/#3】写前响亮预检（拒绝静默丢键，对齐 materializeRoot F7 纪律）：
    //     const liveKeys = [...rootMap.keys()];            // live ROOT 顶层键集（yjs API，P-9）
    //     const rebuildKeys = new Set(top.entries.map(([k]) => k));   // clear+重建将落地的键集
    //     const dropped = liveKeys.filter((k) => !rebuildKeys.has(k)); // 将被 clear 抹除的 live 键
    //     if (dropped.length > 0)
    //       return { ok:false, issues: [{ path: [], message:
    //         `拒绝静默丢键：live ROOT 顶层存在结构树投影外的键 [${dropped.join('、')}]，` +
    //         `clear+重建将丢弃它们——未声明键处置属 validated-mutation 独立任务面；本调用零写入` }] };
    //     （检测面 = 顶层；嵌套子树未声明键移交 §7.5。dropped 语义 = 重建键集之外的 live 键——
    //       主要为未声明键，亦含 union 仲裁翻转下的投影差，P-9 R3 措辞）
    return { kind: 'ready', rootMap, entries: top.entries };
  } catch (err) {
    if (err instanceof DerivedInvariantError) throw /* E204 fatal，同 §4.2 逐字（语境词 applyValidatedMutation） */;
    // 【R3/SA2 R2-1】无 instanceof DocRuntimeFatalError 透传：本 try 内无内部 fatal 源
    // （sentinel 由本 catch 自产 E204；transactGuarded/verifyInstall 已物理移出）。try 内存在
    // 调用方对象读取面（信封 Proxy trap / value getter / proposed 引用直读——读取即执行外部代码）：
    // 敌意数据抛出的伪造 branded 一律落 E205 ok:false（类 B 分级——用户数据不得升格 internal fatal，
    // 杜绝「一次敌意 value → Runtime 永久关写」DoS，守住 §4.1 类 B 判据；SA2 PoC-1 投递路径封闭）。
    return { kind: 'fail', issues: [{ path: [],
      message: `DOCRT-E205: applyValidatedMutation 内部错误（意外异常）:「${errDetailOf(err)}」` }] };
  }
}
```

注：⓪ guard 与 (H)/(I) 均在一切 catch 之外（与 materializeRoot「⓪ 在外、④⑤⑥ 在外」双同构）；E203/E201/E204 自 throw 点直接上抛，不经过任何 catch——**全库零 instanceof 透传**（§3.3 catch 分级总表）。E205 message 以「」定界携带原始异常文本（证据引用纪律，同 §3.3/#6 边界；issue 为数据对象无 cause 字段，原文承载于 message）。

**【R2 / SA2 #4】⓪ E202 消息参数化方案**：`assertOutermostTransactionContext(doc)` 改造为 `assertNoActiveTransaction(doc: Y.Doc, fnName: string)`（materialize.ts `@internal` 导出）——窗口 A/B 消息模板中的函数名以 `${fnName}` 代入（变体 C 不含函数名，原文共享）；`materializeRoot` 调用点传 `'materializeRoot'`，参数代入后与现行 `E202_MSG_A/B/C` **逐字节同一**（17 处既有锚 + 文本锚零触碰）；mutation 侧传 `'applyValidatedMutation'`（消息指名本函数，杜绝「E202 指认 materializeRoot」的诊断谎言）。materialize.ts 内保留薄包装 `assertOutermostTransactionContext(doc) { assertNoActiveTransaction(doc, 'materializeRoot'); }`（调用点零改动、消息逐字锁死）。

### §7.3 placeSet：concrete-JSON 放置器（最小语义面；【R2 / SA2 #2】own-key 纪律冻结）

**策略**：沿**具体 JSON 快照**（extract 产物，非类型树）放置——路径导航只判定「结构不可达」，**合法性仲裁全部交给 (F) 完整校验 + (G) 构造**（双层兜底，均为领域联合零写入）。由此天然免掉 union 仲裁引擎（O1 禁区的核心复杂度）。

**own-key 纪律（冻结，仓库已付学费的危害类防复发）**：extract 侧同类问题（issue #73 R2.2/F-1）曾以赋值式写入对 `'__proto__'` Record 动态键造成「端到端零信号静默丢失 / 原型劫持」，已用 `putSnapshotKey`（defineProperty）修复并留整份回归测试（`extract-record-keyspace.test.ts`）；materialize 侧同款纪律在 `materialize.ts:629-631`（D13）。本设计把同款纪律**冻结进写侧第三条通道（placeSet）**：

- **终段写入一律 `Object.defineProperty(parent, key, { value, writable: true, enumerable: true, configurable: true })`**——own 数据属性直落，绕开 `Object.prototype.__proto__` accessor（杜绝标量静默忽略与对象值原型劫持，SA2 E-9 两变体）；own 键遮蔽原型 accessor（实证 T10，`obj['__proto__']` 可读回 own 值）→ (G) `mapEntries` 按 `Object.keys` 迭代可见该键 → 真实进入重建 entries → **请求的写真实发生**（Record 新键 `'__proto__'` 落 own 键，`rootMap.set('__proto__', v)` 在 yjs Map 内部存储无原型语义，P-8）。
- **中间段导航键存在性判定一律 `Object.hasOwn(obj, seg)`**——own 键才可下钻；原型成员名（`'constructor'`/`'toString'` 等，SA2 E-10 取到 function 的误判向量）按「中间容器缺失」单 issue 拒绝（诊断诚实：键实际不是 own 键）。
- 数组的中间段导航与终段判定不涉原型语义（`Array.isArray` + 整数边界），维持 §7.3 基础规则。

**规则全集（冻结）**：

- **中间段导航**（path[0..n-2]）：当前节点为 plain object → 段须为 string 且 `Object.hasOwn(obj, seg)`（缺失或仅原型成员 → 单 issue「中间容器缺失——set 不自动创建中间容器（原型成员不视为存在键）」，ADR-0007）；为数组 → 段须为非负整数且 < length（越界/非整数 → 单 issue）；其他（标量/终态）→ 单 issue「路径穿越不可下钻终态」。
- **终段**：父节点为 plain object → 段须为 string → `Object.defineProperty` 写入（已存在 own 键覆写 / 缺失键新建 own 数据属性均可——缺失键合法性由 (F) 仲裁：optional 缺失字段 ✓、Record 新键 ✓（含 `'__proto__'` 等 special key，own 落键）、封闭 map 未声明键 → (F)/(G) 拒绝）；父节点为数组 → 单 issue「set 终态不支持数组下标（ADR-0007 终态枚举：已有字段 / 缺失 optional 字段 / 新 Record 键）」。
- **空 path**（`set([])`）：proposed = value 整体（ADR-0007「允许整体替换 ROOT」）；非 map 形由 (F)/(G) 拒绝。
- **value 域**：(A5) 已响亮拒绝 undefined/缺失；其余任意 unknown（含对抗对象）引用直接放置——(F) 校验读取 / (G) copyJsonDomain 读取时 getter 抛出 → 落 E205 领域单 issue（类 B，§4.1 同构），零写入；(F)/(G) 双读发散窗口独立登记于 §7.5。

### §7.4 复用与明确的非目标

- **复用 ⑤ verifyInstall**（mutation 侧 (I)）：事务后顶层 size + 逐键同一性断言——observer 在 mutation 事务内偏离（不抛错、改键）→ branded E201 committed:true（与 materializeRoot 同 phase 同码）。ok:true 承诺 = INV-2 + INV-10（顶层精确键集 + 逐键同一，返回时点）。
- **不复用 ⑥ verifySnapshotIntact**：对称重物化是 materializeRoot rev2 的专属加固（INV-11）；mutation 侧 ⑥ 属完整 validated-mutation 任务（移交 §7.5）。不运行 ⑥ = 检测面较窄，**不构成 W1 违反**（W1 约束「检测到偏离 → 唯一相容形态 throw」，不强制检测面宽度）。
- **未支持操作（delete / array-insert / array-delete / 未知 op）→ 领域单 issue**（零写入、响亮、精确消息「validated mutation 完整语义属独立任务面」）。归类自检：这是**已公告能力边界**上的普通、可预期、零写入失败（W5「普通、可预期且零写入的写入失败使用领域化结果联合」的逐句情形）——非 internal、非 fatal、非静默降级（每条拒绝都是精确 issue，无 fallback）。

### §7.5 移交清单（完整 validated mutation 任务面，防「静默半成品」指控；【R2】含 #3 嵌套面与 #5 双读窗口登记）

| 移交项 | 归属 | 本切片状态 |
|---|---|---|
| delete / array-insert / array-delete 全语义 | 独立任务 | 领域单 issue 响亮拒绝（可识别消息，A3） |
| union 仲裁下的路径语义 | 独立任务 | concrete-JSON 放置 + (F)/(G) 仲裁兜底（§7.3） |
| **live 未声明键处置**（顶层：写前预检响亮拒绝 (G½)；**嵌套子树内未声明键检测面**：extract 投影不含、(G½) 只查顶层——嵌套偏离本切片不检测） | 独立任务 | 顶层 = 预检拒绝（零写入、指名键集）；嵌套面**显式移交**（非笼统「已登记」） |
| **(F)(G) 双读窗口（【R2 / SA2 #5】独立条目）**：对抗性 value（Proxy/getter 按读次发散）可使 (F) 校验的「读 #1」与 (G) copyJsonDomain 的「读 #2」发散——构造产物可能未经校验值落库且 ok:true。materializeRoot 侧同窗口存在但多一层 ⑥（scratch 三读，rev2 R-5 论证覆盖）；mutation 无 ⑥，窗口更宽 | 独立任务 | **登记接受 + 移交**：完整任务的 ⑥ 式产物回读仲裁（extract 落库产物 vs proposed 再比较）即为本窗口的结构性闭合；W1 关系注明——W1 管**响应形态**（检测到偏离 → throw），不管**检测面宽度**，本项是检测宽度缺口，不构成 W1 违反。本切片内该窗口的可达后果已收敛：getter 抛出 → E205 领域拒绝（零写入）；发散但不抛 → 留待完整任务（补锚见 §4.5 SA2 思路 #5） |
| mutation 侧 ⑥ 对称重物化校验 | 独立任务 | 不运行（§7.4） |
| mutation 参数具名公共类型冻结 | 独立任务 | 运行时校验 + 文档登记 |
| E205 与 E200 的语义对齐审查（两崩溃边界同构） | 独立任务复审 | 本设计声明同构（§4.1 判据共用） |

### §7.6 红灯用例走查（apply 文件 4 用例；R2 修订项与锚兼容性核对）

| 用例 | 管线轨迹 | 断言落点 |
|---|---|---|
| 1 导出面 | index 导出 | `typeof === 'function'` ✓ |
| 2 observer 抛错（fixture 已按 §8 对齐：observer 挂 seed 之后——SA6 已在 worktree 落实） | 铺底 ROOT → 挂 observer → (A)-(G) 过 → (G½) 不触发（ROOT 只含声明键 title/count，dropped 为空）→ (H) transact：clear+install 提交，cleanup 期 observer 抛 `Error('mutation-observer-boom')` → `transactGuarded` 无条件包装 → E203 branded | instanceof ✓ committed:true ✓ phase 字符串 ✓ title='t2' / count=7（clear+set 在 cleanup 派发前完成，实证 §10）✓ 无 rollback 声称（「」定界内 'mutation-observer-boom' 不触发正则）✓ |
| 3 exact identity | 同上 + materializeRoot 侧 E203 对照 | `thrownMutation.constructor === thrownMaterialize.constructor`——同一 `fatal.ts` 类、同一包装器，结构性成立 ✓ |
| 4 损坏 ROOT | (C) extract 载体面**通过**（count='not-a-number' 为 leaf 载体合法 string——copyPlainValue 只管载体域，逻辑类型归 validate）→ **(D) validateLogicalSnapshot(ex.snapshot)：number 字段持 string 逻辑错位 → ok:false + issues**【R3 nit 归因修正：拒绝点为 (D) 非 (C)】 | issues 非空 ✓ state 字节不变（C-G½ 全程只读）✓ 未 throw ✓ |

**R2 新增拒绝面与红灯锚兼容性**：(A) 信封校验（A1-A5）、(G½) 预检、own-key 纪律——SA6 锚只用合规信封 `{op:'set', path:['title'], value:'t2'}`、ROOT 只含声明键、path 不涉原型成员 → 三新增面均不触发，17 红灯 + 3 护栏预期转绿路径不受影响（SA2 §1.1/#2/#3「与红灯锚兼容性」独立核对一致）。

---

## §8. 红灯测试对齐事项（设计期新发现，SA6 owned fixture 时序缺陷）

**发现**：`apply-validated-mutation-fatal-contract.test.ts` 用例 2/3 的 observer 挂载在 **seed 之前**：

```ts
root.observe(() => { if (done) return; done = true; throw new Error('mutation-observer-boom'); });
const seed = materializeRoot(DERIVED_TWO, { title: 't', count: 7 }, doc);
expect(seed.ok).toBe(true);   // ← 恒不可达
```

**实证**（本 worktree，node + yjs@13.6.32 直跑）：observer 挂载后**第一次事务**（= seed 安装事务）即触发 one-shot 抛错，异常自 `doc.transact` 逃逸 → `materializeRoot` 在 seed 行**直接 throw**（现行裸 `Error('mutation-observer-boom')`；本设计落地后为 E203 branded fatal）→ `seed.ok` 永不可达 → 用例 2/3 在**任何正确实现下恒红**。该文件自己的注释（「先经 materializeRoot 铺底合法 ROOT……**再**在 ROOT 上挂 one-shot 抛错 observer」）描述的正是正确时序，代码与注释相反。

**对齐方式**（SA6 owned 文件，约 6 行位移，用例 2/3 各一处）：把 `root.observe(...)` 三行移到 `expect(seed.ok).toBe(true);` 之后。断言逻辑零变化。

**【R2 更新】对齐已落实**：SA6 已在 worktree 完成时序对齐（`apply-validated-mutation-fatal-contract.test.ts` 现行代码 = seed → `expect(seed.ok)` → 挂 observer，注释标注「时序纪律（SA1 设计 §8 对齐）」；SA2 评审 E-3 独立复现证实）。本节转为**历史登记 + 复核锚**：SA4 静态评审确认 apply 文件维持该时序。

其余 15 个 materialize 侧用例的 fixture 无需对齐（SA6 场景触发器验证 7/7 通过，红因 = 契约缺失）。

---

## §9. 兼容性保障（既有 218 用例零回归核对表）

| 既有锚族 | 锚形态 | 本设计动作 | 判定 |
|---|---|---|---|
| E201 家族（materialize-root R1 四向量 / rev2 RT-5 / R2 形态掩盖 / D1/D2 等） | `toThrow('DOCRT-E201')`（子串）、`/DOCRT-E201/`、变体文本、最终 ROOT 状态 | 消息逐字不变，仅类替换为 branded | 绿（子串/正则均命中不变文本） |
| E202 三变体（rev2 RT-2/3/4、materialize-root 窗口组） | `/DOCRT-E202/` + 「派发期间」「无法确认」「版本兼容性」「队列异常残留」「doc._transaction 非空」 | materialize 侧**逐字不动**（【R2】消息参数化以 `'materializeRoot'` 代入，字节同一；SA4 复核点：参数代入后与现行 `E202_MSG_A/B/C` diff 为空）；mutation 侧为新消息（指名 applyValidatedMutation，无既有锚） | 绿 |
| E200 崩溃边界（rev2 Minor-2 极深 XML） | ok:false + 恰 1 issue + `/DOCRT-E200/` + 0 update + state 不变 | 类 B/C 留守（§4.1） | 绿 |
| U13 observer 原样传播 | `toThrow('observer-boom')`（子串实证 §6.1）+ observeCalls=1 + updateCount=1 + title='t' | E203 message 含子串 + cause 原实例 + 包装器零写入 | 绿 |
| AC-3 护栏（logical 失败 / ROOT 非空 / PATH_NOT_ALLOWED） | ok:false + issues / code 断言 | validateLogicalSnapshot / probeRoot / read.ts 全不动 | 绿（保持） |
| extract/read 全族（E100、readLogicalValueAtPath 联合） | 各自结果联合 | extract.ts / read.ts 零改动；resolve.ts sentinel 对 extract 副本零影响（extract 用自己的 extract.ts:233 副本） | 绿 |
| 手造派生物 → E200（若有遗留锚） | —（grep 全枚举：无既有锚，仅 SA6 新锚要求 fatal） | 重分类无回归面 | 安全 |

**W1–W5 合规表**：

| 红线 | 落实点 |
|---|---|
| W1 写后唯一相容形态 throw | ⑤⑥/E203 全部 branded throw；无 ok:false 后门、无补偿、无回滚声称（消息正则自检 §3.3） |
| W2' 命名与最小字段面 | `DocRuntimeFatalError` + `committed` + `phase`（ADR-0008 原文）；不导出 RuntimeWriteFatalError |
| W3 零写入锚 + 诚实 committed | E204 写前零触碰（0 update / state 字节不变 / ROOT 空置——红灯用例 9 直锚）；committed:true 三处不降格；未识别 thrown 值保守 true（AC-5 + 3× 回归锚） |
| W4 分层红线 | fatal.ts 仅 import yjs；mutation.ts 仅 yjs + vfsl + 包内模块；无 Runtime/持久层 import；fatal 只携带事实（无 notifyDirty / 无写能力关闭动作） |
| W5 领域联合不吞并 | E100/E200(类 B/C)/E202/E205 + AC-3 全族留守联合；fatal 化仅类 A（ADR 未枚举空间内的收窄，判据 §4.1） |

---

## §10. 协议假设依据 (Protocol Assumption Evidence)

| # | 假设 | 依据类型 | 依据内容（具体引用/命令+输出） | 风险 |
|---|---|---|---|---|
| P-1 | vitest `toThrow(string)` = 子串包含（U13 兼容性的基石） | 设计期实测验证 + 源码引用 | 源码：`node_modules/.pnpm/@vitest+expect@3.2.7/.../dist/index.js:1417-1420`——string 入参委托 `this.throws(...)`（chai 核心）；实测：`node -e "chai.assert.throws(()=>{throw new Error('DOCRT-E203: …原样携带：observer-boom…')},'observer-boom')"` → PASS；不含子串 → FAIL（chai@5.3.3，本 worktree node_modules） | 低 |
| P-2 | yjs observer 抛错自 `doc.transact` 同步逃逸，且事务不回滚（已写值保留、update 已发出、单事务恰一次 type-observer 回调） | 设计期实测验证 + 既有测试引用 | 实测（yjs@13.6.32，node）：`root.observe(()=>{throw new Error('mutation-observer-boom')})` 后 `doc.transact(set×2)` → 调用方捕获该 Error、`title='t'` `count=7` 落盘、第二次事务 title='t2' 落盘；SA6 SCN-E 基线证据（updateCount=1、title='t'）；U13 断言 observeCalls=1 | 低 |
| P-3 | observer 挂载先于首次事务 → 首次事务即触发（§8 fixture 缺陷判定） | 设计期实测验证 | 同 P-2 复现脚本：seed 事务本身 THREW（`seed-transact THREW: Error | mutation-observer-boom`），second-transact 亦触发（one-shot 已在首事务消耗） | 低 |
| P-4 | ES2022 `ErrorOptions.cause` + 原生 class `extends Error` 的 `instanceof`/`constructor.name` 可用 | 源码引用 | `tsconfig.base.json`：`target: "ES2022"`, `lib: ["ES2022"]`（含 `ErrorOptions`/`Error.cause` 类型）；Node 20/24 原生支持；无 downlevel（vitest esbuild 按 target 保留原生 class，无需 `setPrototypeOf`） | 低 |
| P-5 | yjs `doc._transaction` / `doc._transactionCleanups` 谓词语义（⓪ guard，本设计不改动，仅依赖其现状） | 既有测试引用 + 源码引用 | rev2 RT-2/RT-3/RT-4 全绿锚定；`materialize.ts:132-146` 现行实现 + yjs@13.6.32 dist 类型声明（`Doc.d.ts:49/53`） | 低（零改动） |
| P-6 | extract 产物为纯有限 JSON → JSON 往返克隆恒等（§7.2 (E)） | 源码引用 | `extract.ts` copyPlainValue 域约束（INV-9 往返域对称：non-finite/undefined/bigint 读侧拒绝，`materialize.ts:586-590` 注释双向锚定）；故无 undefined/NaN/循环引用 | 低 |
| P-7 | DOCRT-E203/E204/E205 码未被占用 | 设计期实测验证 | `git grep -n "DOCRT-E203\|DOCRT-E204\|DOCRT-E205" -- 'packages/**' 'apps/**'` → **0 命中（无输出，exit 1——git grep 无命中时退出码为 1；R1 误记 exit 0，按 SA2 #8/SA8 V2 修正；结论不变）** | 低 |
| P-8 | 【R2/#2】own-key 写入纪律先例与可行性：defineProperty 建 own `'__proto__'` 键可读回/可枚举/可 JSON 往返；yjs `Y.Map.set` 键为内部存储无原型语义 | 既有测试引用 + 设计期实测验证（SA2 E-9/E-10/E-11/E-14 独立复现） | `extract-record-keyspace.test.ts`（issue #73 F-1）明文记载赋值式写入危害（静默丢键/原型劫持）与 putSnapshotKey 修复；`materialize.ts:572` 注释（own 键遮蔽原型 accessor，实证 T10）+ `:629-631`（D13 defineProperty 纪律）；SA2 E-11：defineProperty 建的 own `'__proto__'` 键经 JSON 往返保真 | 低 |
| P-9 | 【R2/#3】(G½) 预检判据成立：`rootMap.keys()` 反映 live 顶层键集；`dropped` = 重建键集之外的 live 键（**【R3 nit 措辞修正】主要为结构树未声明键（extract 按 D4 不投影未声明键、声明键全量入投影），亦含 union 仲裁翻转下另一成员声明键落在接受投影外的投影差**——行为与消息（「结构树投影外的键」）对投影事实的描述在两种情形下均准确且保守正确） | 源码引用 + 既有测试引用 | yjs `Y.Map.keys()` 公共 API（yjs@13.6.32）；extract D4「结构树未声明的键不入 extract 投影」（`materialize.ts:86-87` 注释 + extract.ts walk 投影规则）；SA2 apply 用例 4 以直接 Yjs 写入模拟外部注入 = 该场景在测试宇宙内被建模 | 低 |

## §11. 契约改动连锁审计 (Contract Change Caller Audit)

### 改动函数/通道

| 函数/通道 | 文件 | 改动前契约 | 改动后契约 |
|---|---|---|---|
| `materializeRoot` ④ 逃逸 | `src/materialize.ts:104` | observer 抛错 → 裸 thrown 值原样传播（Error 或任意值） | → `DocRuntimeFatalError`（E203，committed:true，cause=原值【R2：**无条件**包装，含伪造 branded——分类重铸不信任抛错方】，message 含原文）**throw 形态不变** |
| `materializeRoot` ⑤⑥ | `src/materialize.ts:155-176,242-289` | 写后偏离 → 裸 `Error`（E201 前缀）throw | → `DocRuntimeFatalError`（E201 前缀消息逐字不变）throw 形态不变 |
| `materializeRoot` prepare 类 A | `src/materialize.ts:446-475` | 手造派生物 → **return** ok:false + E200 单 issue | → **throw** `DocRuntimeFatalError`（E204，committed:false）——return→throw 形态变更 |
| `makeRefResolver`（resolve.ts 副本） | `src/resolve.ts:23,31` | 环/缺名 → 裸 `Error` | → `DerivedInvariantError`（extends Error；对既有 catch 行为无感，仅类型收窄） |
| `assertOutermostTransactionContext` → `assertNoActiveTransaction(doc, fnName)`【R2】 | `src/materialize.ts:132-146` | 固定三变体消息（指名 materializeRoot） | 参数化函数名；materialize 调用点代入 `'materializeRoot'` → **输出逐字节同一**（既有 17 锚零触碰）；新消费方 mutation.ts 传 `'applyValidatedMutation'`（新消息面，无既有锚） |
| `applyValidatedMutation` | `src/mutation.ts`（新） | 不存在 | 新增公共函数（结果联合 + branded fatal throw 面 + 【R2】(A) 信封五项校验 / (G½) 未声明键预检两个新拒绝面——均为领域单 issue，零写入；【R3】`prepareMutation` 助手收窄 catch 至 (A)–(G½) 且**无 branded 透传**（伪造落 E205），(H)/(I) 物理位于一切 catch 之外——E203/E201 直接上抛不经 catch） |
| 新导出 | `src/index.ts` | — | `DocRuntimeFatalError` / `DocRuntimeFatalPhase` / `applyValidatedMutation` / `MutationIssue` / `ApplyValidatedMutationResult`（纯增量） |

### Caller 清单（`git grep -n "\bmaterializeRoot\s*(" -- 'packages/**' 'apps/**'` 全枚举 + makeRefResolver caller）

| Caller | 文件:行号 | 是否 await | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---|---|---|---|---|
| 生产代码 | **无**（`@nomicore/namespace-runtime` 未建；doc-runtime 包内无其他 src caller——mutation.ts 只用 extract/buildTopEntries/verifyInstall/guard，不调 materializeRoot） | N/A | N/A | N/A | 无生产 caller 需迁移——ADR-0008 演进条目 2 先于 Runtime 实施的既定次序；Runtime 任务消费面已登记（§5 判据 + §3.2 冻结表） |
| 测试：transaction-fatal-materialize-contract.test.ts | SA6 新锚 | 同步 | `capture()`（本任务契约面） | ✅ | 预期消费新契约（红灯→绿） |
| 测试：apply-validated-mutation-fatal-contract.test.ts | SA6 新锚 | 同步 | `capture()` | ✅ | 同上（含 §8 fixture 对齐） |
| 测试：materialize-root.test.ts U13 | :595 | 同步 | `expect(...).toThrow('observer-boom')`（子串） | ✅ | message 含子串 → 绿（§6） |
| 测试：materialize-root.test.ts R1/E202 组、rev2 全组 | 各处 | 同步 | `toThrow` 各锚 | ✅ | 消息逐字不变 → 绿（§9 表） |
| `makeRefResolver` caller：materialize.ts(:206,:283) | 同步 | ✅（prepare catch / ⑥ catch，位置分类） | — | sentinel → E204 / 变体 D（§4.3） |
| `makeRefResolver` caller：extract.ts(:62)/read.ts(:26)——**使用 extract.ts:233 副本，非 resolve.ts** | 同步 | ✅ extract E100 边界(:68) | ✅ | 零改动（副本隔离，§4.3 双副本登记） |

### 风险评估

- **return→throw 形态变更（prepare 类 A）的遗漏 caller 代价**：调用方未捕获 → 冒泡。生产 caller 数 = 0（实证 grep）；测试 caller 中锚定该形态的只有 SA6 新红灯（要求正是 throw）。既有测试无「手造派生物→ok:false」锚（grep 全枚举，§9 末行）——**变更半径封闭**。
- **fatal 冒泡至进程顶层的风险面**：本包为库（无进程顶层）；未来 Runtime 槽内按 ADR-0008 处置（fatal gate → 关闭写 + reject 原始 fatal）。无 fire-and-forget 路径（同步 API）。

---

## §12. 实现步骤（SA3 黑盒锚点，建议次序）

1. **新建 `src/fatal.ts`**（§3.1/§3.3 全量：类 + phase 类型 + sentinel + **无条件包装版** transactGuarded + errDetailOf；~120 行）；
2. **改 `src/resolve.ts`**：环/缺名两处 throw 改 `DerivedInvariantError`（import 自 fatal.js；~8 行差）；extract.ts 副本不动；
3. **改 `src/materialize.ts`**：sentinel 三落点（:448/:204/:497）；prepare catch 拆分（§4.2）；④ 改 `transactGuarded`；⑤ 两处 + e201C/e201D 改 branded（消息逐字不动；**【R3】e201D 的 catch 包装路径一律携带 cause**）；**【R3】⑥ 三 catch 不加 instanceof 守卫**（零透传原则，§3.3 catch 分级总表——外来 branded 由 e201D 重分级）；INV-5/文件头注释同步（§3.4 演进声明）；`verifyInstall`/`assertNoActiveTransaction(doc, fnName)`（参数化，materializeRoot 调用点传 `'materializeRoot'`，【R2】SA4 复核：代入后与现行 E202_MSG_A/B/C 逐字节 diff 为空）/`buildTopEntries` 加 `@internal` export（供 mutation.ts）；
4. **新建 `src/mutation.ts`**（【R3 结构】`prepareMutation` 助手（(A)–(G½) + 唯一 try/catch：sentinel→E204、其余含伪造 branded→E205）+ 公共函数主体（⓪ 与 (H)/(I) 物理位于一切 catch 之外）；含 (A1-A5) 信封校验、(G½) 未声明键预检、§7.3 placeSet own-key 纪律（defineProperty/hasOwn）；~290 行）；
5. **改 `src/index.ts`**：新导出五项 + 文档注释同步（§3.5 措辞）；
6. **自检命令**（SA3/SA4 复跑）：
   - `npx vitest run packages/doc-runtime` → 期望 `Tests 235 passed (235)`（17 红转绿 + 3 护栏保持绿 + 218 既有零回归；§8 fixture 已由 SA6 对齐）；
   - `pnpm -r typecheck` / 根 typecheck → 0 error；
   - E202 参数化字节同一性复核：对 `assertNoActiveTransaction(doc,'materializeRoot')` 三变体消息与 git 基线 `E202_MSG_A/B/C` 做逐字节比对（diff 为空）；
   - 【R3.1/C-R3-2】e201D 定界锚安全复核：`grep -rn "toThrow.*E201" packages/doc-runtime/test/` → 全部为前缀子串/正则形态（37 处，零内部文本锚）；实现 diff 核对 e201D 模板骨架逐字（仅 errDetail 插值段新增「」）；
   - Node 20/24 CI（既有矩阵）。

## §13. 验收自检（对简报 AC）

| AC | 落点 | 判定 |
|---|---|---|
| AC-1 branded 形状 | §3.1 + §3.5 导出 | 红灯 1/2 转绿 |
| AC-2 三相区分 | §3.2 冻结表 + §3.3/§4.2 落点 | 红灯 3-7/9-13 转绿（三相互异 + 稳定） |
| AC-3 领域联合不吞并 | §4.1 判据 + §9 表 | 护栏 3 用例保持绿 |
| AC-4 不补偿/不 fallback/不声称 rollback | 消息正则自检（§3.3 包装层自述）+ 行为零改动（⑤⑥/④ 包装无写入）+ 文本锚边界登记（§6.3：约束包装层自述，「」定界证据引用豁免） | 红灯行为锚绿 |
| AC-5 未识别异常保守语义 | §3.3 包装器（任意 thrown 值——**含伪造 branded**——无条件 → committed:true） | 红灯 10/11 转绿（3× 回归锚） |
| AC-6 exact identity / commit / 最终状态 | 同一类 + 同一包装器（结构性保证）；E204 零写入 | 红灯 8/9 + apply 全组转绿（§8 已对齐） |
| AC-7 全量 typecheck/test + Node 20/24 CI | §12.6 | SA4/SA7 验证 |

## §14. 风险与缓解

| # | 风险 | 缓解 |
|---|---|---|
| R-1 | §8 fixture 缺陷未对齐 → Phase 4/7 恒红卡死 | 【R2 已闭合】SA6 已在 worktree 对齐（SA2 E-3 独立复现证实）；本节转为复核锚（SA4 确认时序维持） |
| R-2 | sentinel 误伤类 B/C（对抗输入被 fatal 化 → Runtime 误关写） | sentinel 仅 4 个「手造派生物」诊断点（§4.3 全枚举）；Proxy/getter/RangeError 路径不经 sentinel（代码路径分析 §4.1） |
| R-3 | 双副本 makeRefResolver 未来漂移 | §4.3 显式登记副本现状与改动边界；统一属后续重构任务 |
| R-4 | 【R2/#3 改写】mutation clear+rebuild 与 live 未声明键的交互 | **顶层**：写前响亮预检 (G½)——live 顶层键 ⊄ 重建键集 → 领域单 issue 拒绝（指名被丢键集、零写入、对齐 F7「拒绝静默丢键」）；**嵌套子树**未声明键检测面显式移交 §7.5（非笼统登记）。R1 的「生产面不可达」论证按 SA2 #3 作废（当前公共 API 现实下 applyValidatedMutation 的消费者恰是能直接摸 Y.Doc 的人） |
| R-5 | message 改动破坏既有子串/正则锚 | ⑤⑥/E200 消息逐字不变；E202 参数化代入后字节同一（§12 复核命令）；E203 新前缀；SA4 逐族核对（§9 表） |
| R-6 | phase 取值集被实现随手改名 | §3.2 冻结表 + 红灯「同场景稳定/三相互异」断言锁定可观察面 |
| R-7 | 【R2/#1 新增，R3 扩面闭环】observer/**调用方敌意数据**伪造 branded fatal 交付伪造 committed/phase（分类权外泄；两条具体伤害：用户数据→Runtime 永久关写 DoS；committed:false 谎报于已提交事务→notifyDirty 丢失） | 已消除（**R3 全库零 instanceof 透传**）：① transactGuarded 无条件包装（R2）；② mutation (H)/(I) 移出 try + catch 收窄 (A)–(G½) 无透传——伪造落 E205 ok:false（R3，PoC-1 路径封闭）；③ ⑥ 三 catch 守卫删除——外来 branded 被 e201D 重分级 committed:true + cause 保留（R3，PoC-2 路径封闭）。补锚 §4.5（思路 #1 三条投递路径锚）锁定 |
| R-8 | 【R2/#2 新增】placeSet 赋值式写入的 `__proto__` 静默丢键 / 原型劫持 / set(undefined) 隐式删除 / 信封笔误零反馈 | 已消除：own-key 纪律冻结（§7.3——defineProperty 终段写入 + hasOwn 导航）+ (A2)/(A5) 信封与 value 响亮拒绝（§7.2）；补锚 §4.5（SA2 思路 #2/#3）锁定 |

---

## §15. 文件清单（File Scope）

### ALLOW LIST

- `packages/doc-runtime/src/fatal.ts` — 新建（~120 行）：DocRuntimeFatalError / DocRuntimeFatalPhase / DerivedInvariantError（包内 sentinel）/ transactGuarded（【R2】无条件包装版，§3.1/§3.3）
- `packages/doc-runtime/src/mutation.ts` — 新建（**【R3.1/C-R3-1 修正】~290 行，R3 结构**）：applyValidatedMutation 最小落地（§7.2 R3 结构：公共函数主体（⓪ 与 (H)/(I) 物理位于一切 catch 之外）+ `prepareMutation` 助手（(A)–(G½) 唯一 try/catch：sentinel→E204、其余含伪造 branded→E205，无 instanceof 透传）；含 (A1-A5) 信封校验 + (G½) 未声明键预检 + placeSet own-key 纪律）
- `packages/doc-runtime/src/materialize.ts` — 修改（~±70 行）：sentinel 落点 ×3、prepare catch 拆分、④ transactGuarded、⑤⑥ branded（消息逐字不变；【R3】e201D catch 路径 cause 必选）、**【R3.1/C-R3-1 修正】⑥ 三 catch 不加 instanceof 守卫（R3 零透传原则，§3.3 catch 分级总表 / §3.4 / §12.3——R2 旧指令「⑥ catch instanceof 守卫」已废除，本条目原残留为摘要层陈旧短语）**、E202 消息参数化（fnName 代入，materialize 侧字节同一）、@internal 导出三接缝、注释同步（§3.4/§4）
- `packages/doc-runtime/src/resolve.ts` — 修改（~±8 行）：环/缺名 throw 改 DerivedInvariantError（仅本副本，§4.3）
- `packages/doc-runtime/src/index.ts` — 修改（~+14 行）：五项新导出 + 文档注释同步（§3.5）
- `packages/doc-runtime/test/apply-validated-mutation-fatal-contract.test.ts` — `[SA6 owned]` §8 fixture 时序对齐（**已由 SA6 落实**）；可含 §4.5 补锚（伪造 fatal / `__proto__` / 原型链导航 / 信封闭环 / E202 语境指名——SA2 思路 #1/#2/#3/#4/#6）
- `packages/doc-runtime/test/transaction-fatal-materialize-contract.test.ts` — `[SA6 owned]` 可含 §4.5 补锚（伪造 fatal 透传锁定、sentinel 变体（ref 环 → E204）、文本边界——SA2 思路 #1/#7/#6）；AC-3 护栏不动
- `packages/doc-runtime/test/materialize-root.test.ts` — `[SA6 owned]` 预期零改动（U13 断言保持绿；列出以覆盖注释性微调）
- `packages/doc-runtime/test/materialize-root-rev2.test.ts` — `[SA6 owned]` 预期零改动（E200/E201/E202 锚全部保持绿）

### DENY LIST

- `packages/doc-runtime/src/read.ts` — ADR-0008 演进条目 1（schema-independent 签名）属独立任务；本任务 AC-3 护栏依赖其现状
- `packages/doc-runtime/src/extract.ts` — 读侧通道不动（含其 makeRefResolver 副本，§4.3）
- `packages/doc-runtime/src/carrier.ts` / `packages/doc-runtime/src/xml-parse.ts` — 载体判定/XML 解析不动
- `packages/vfsl/**` — validateLogicalSnapshot 契约不动
- `packages/persistence/**` / `packages/dsh-persistence/**` — 持久层不涉（ADR-0006：持久化失败不并入 transaction fatal）
- `packages/doc-runtime/package.json` / `packages/doc-runtime/tsconfig.json` — 无新依赖（W4：fatal/mutation 仅用 yjs + vfsl + 包内模块；ES2022 已就位）
- `docs/adr/**` / `CONTEXT.md` — 本任务零 override（冲突报告 verdict=clear）
- `wiki/prd/0060-doc-runtime-validation-prd.md` — 规划面归完整 validated mutation 任务
- `.mabf/**` — 流水线内部状态，不入 diff

## SA2 反馈逐条回应（R2 修订对应 R1 攻击点 #1–#8；R3 修订对应 R2 复审段 R2-1 + 两 nit）

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|---|---|---|---|
| #1 (CRITICAL) transactGuarded 删除 instanceof 透传（方案 A 无条件包装，或模块私有 brand）+ 推翻 SA8 D3「防御性 instanceof 透传」论证句 | ✅（R2 落实 transactGuarded 半边；R2 新增的「保留面」表两行断言经 R2 复审 PoC 实证作废，R3 修正——见 R2-1 行） | §3.3（代码块 + 「无条件包装论证」五点）；§3.4；§7.2；§11 表 ④ 行；R-7 | R2 采用**方案 A**：catch 内无条件 `throw new DocRuntimeFatalError('observer-cleanup-throw', true, E203, { cause: err })`；论证 1-3（对内死代码/对外活漏洞 → 永不双重包装 + cause 零信息损失 + 分类重铸诚实）；论证 4 **明文推翻 SA8 D3 该句**。「透传守卫的精确保留面」表随 R3 由「catch 分级总表」取代 |
| **R2-1 (CRITICAL，R3)** 「保留面」表两行断言与代码事实相悖（mutation try (A)–(G) 与 ⑥ try(3) 均存在调用方对象读取面，伪造 branded 可透传）→ 按方案 A 结构化修订 + 重写表两行 + 补敌意读投递锚 | ✅ | §3.3（「catch 分级总表」取代「保留面」表——正确前提 = **try 块内存在调用方对象读取面，读取即执行外部代码**；四行分级 + 方案 A 四点论证）；§3.4（⑥ 守卫**删除**、e201D cause 必选）；§7.2（(H)/(I) 物理移出 try、`prepareMutation` 助手收窄 catch 至 (A)–(G½) 且无透传）；§4.5（补锚 #1 增补两条敌意读投递锚）；§11/§12/§14 R-7 | **全库零 instanceof 透传**：mutation (H)/(I) 移出 try（对齐 materializeRoot「④⑤⑥ 位于一切 catch 之外」双同构）→ 敌意数据伪造 branded 落 E205 ok:false（类 B 分级，杜绝「敌意 value → Runtime 永久关写」DoS）；⑥ 三 catch 守卫删除 → 外来 branded 被 e201D 重分级 committed:true（位置事实，cause 保伪造实例，杜绝「committed:false 谎报于已提交事务 → notifyDirty 丢失」链） |
| #2 (CRITICAL) placeSet 冻结 own-key 纪律（defineProperty 写入 + hasOwn 导航）+ (A) 增补 value 缺失/undefined 与信封未知键响亮拒绝 | ✅ | §7.2 (A1-A5)（信封五项校验：A2 未知键拒绝、A5 value 非 undefined——杜绝 set(undefined) 走私 delete 语义）；§7.3 全节重写（own-key 纪律冻结 + 危害类学费出处 + 规则全集：defineProperty 终段 / hasOwn 导航 / 数组段维持 / 空 path / value 域）；§11 表；R-8 | 终段一律 `Object.defineProperty`（own 数据属性，对齐 extract putSnapshotKey / materialize D13）；中间段导航一律 `Object.hasOwn`（原型成员名 → 「中间容器缺失」诚实诊断）；Record `'__proto__'` 新键 own 真实落键（请求的写真实发生，yjs Map 内部存储无原型语义，P-8） |
| #3 (MAJOR) clear+rebuild 静默抹除 live 未声明键 → 写前响亮预检（live 键集 ⊆ 重建键集）+ 嵌套面显式移交 + R-4 改写 | ✅ | §7.2 (G½)（预检伪代码：dropped = liveKeys − rebuildKeys 非空 → 领域单 issue 指名键集、零写入、F7 措辞对齐）；§7.5（「live 未声明键处置」行拆顶层=预检拒绝 / 嵌套=显式移交，非笼统登记）；§14 R-4 改写（「生产面不可达」论证按 SA2 作废）；P-9（判据成立性依据） | 预检置于 (G) 之后 (H) 之前；dropped = 重建键集之外的 live 键（R3 措辞见 nit-1 行）；R1 的 R-4 缓解论证撤回并替换 |
| #4 (MINOR) E202 消息指名错误函数名 → mutation.ts 自持消息 / 参数化 | ✅ | §7.2 ⓪ + 「E202 消息参数化方案」段；§9 E202 行；§11 表；§12.3/§12.6 | `assertNoActiveTransaction(doc, fnName)` 参数化（A/B 变体代入函数名，C 变体原文共享）；materialize 调用点传 `'materializeRoot'` → 与现行 `E202_MSG_A/B/C` **逐字节同一**（SA4 复核命令入 §12.6：diff 为空）；mutation 传 `'applyValidatedMutation'` |
| #5 (MINOR) (F)(G) 双读窗口独立登记 + W1 关系注明 | ✅ | §7.5 新增独立行（「(F)(G) 双读窗口」：Proxy/getter 按读次发散 → 构造产物可能未经校验值落库；materialize 侧有 ⑥ 三读覆盖、mutation 窗口更宽；登记接受 + 移交完整任务 ⑥ 式产物回读仲裁；W1 管**响应形态**不管**检测面宽度**——不构成 W1 违反）；§4.5 补锚表思路 #5 | 登记型闭环（SA2 放行条件允许）；本切片内可达后果收敛说明（getter 抛出 → E205 零写入拒绝；发散不抛 → 移交） |
| #6 (MINOR) E203 内嵌原文与 ROLLBACK_CLAIM 文本锚边界登记 / 引号定界 | ✅ | §3.3 E203 message 改「原始异常原样携带（证据引用，非本 fatal 自述）：「…」」（「」定界，子串锚不受影响）；§3.3 末段「AC-4 文本锚适用边界登记」；§6.2 条 1 措辞同步；§6.3 新增边界段；§13 AC-4 行；§4.5 补锚思路 #6 | 双管齐下：定界 + 边界登记（约束对象 = 包装层自述 claims；被携带原文 = 证据引用豁免） |
| #7 (MINOR) sentinel 4 落点仅 1/4 有红灯锚 → 补锚建议 | ✅ | §4.5 新增（缺口如实登记 + 补锚建议 1/2：ref 环 → E204 committed:false / phase 互异 / 零写入锚；同批收录 SA2 §4 思路 #1（含 R3 增补两条敌意读投递锚）/#2/#3/#5/#6 为 SA6 owned 补锚清单）；§15 ALLOW LIST 两个测试文件条目更新（可含补锚）；R-7/R-8 锁定 | 登记型闭环（SA2 放行条件允许「登记/补锚」）；结构性论证与机读锚缺口的差距如实声明 |
| #8 (NIT) P-7 exit code 笔误 | ✅ | §10 P-7 行 | 修正为「无输出，exit 1——git grep 无命中时退出码为 1（R1 误记 exit 0，按 SA2 #8/SA8 V2 修正；结论不变）」 |
| nit-1（R2.3 → R3 落文）P-9「dropped ⊆ 未声明键」在 union 仲裁翻转情形不严格 | ✅ | §10 P-9；§7.2 (G½) 注释 | 改为「dropped = 重建键集之外的 live 键（主要为结构树未声明键，亦含 union 仲裁翻转下的投影差）」——行为与消息保守正确不受影响 |
| nit-2（R2.3 → R3 落文）§7.6 用例 4 拒绝点归因应为 (D) 非 (C) | ✅ | §7.6 用例 4 行；§7.2 (C)/(D) 注释同步 | 'not-a-number' 为 leaf 载体合法 string（copyPlainValue 只管载体域）——extract 载体面通过，逻辑类型错位在 (D) validateLogicalSnapshot 拒绝；断言两归因下均通过，仅文档精度修正 |
| C-R3-1（必修，R3.1 落文）§15 两处陈旧交叉引用与 R3 正文矛盾（materialize.ts 条目残留「⑥ catch instanceof 守卫」已废除指令；mutation.ts 条目仍为 R2 描述） | ✅ | §15 materialize.ts / mutation.ts 条目（标注【R3.1/C-R3-1 修正】） | materialize 条目改为「⑥ 三 catch **不加** instanceof 守卫（R3 零透传原则，§3.3/§3.4/§12.3）」+ e201D cause 必选；mutation 条目对齐 R3 结构（~290 行、公共函数主体 + prepareMutation 助手、无透传）——SA3 依 §15 字面落文不再会加回已废除守卫 |
| C-R3-2（复核点，R3.1 落文）e201D/E205 errDetail 嵌入段「」定界按 37 处既有 E201 子串锚形态复核 | ✅（规格 + 实证 + 复核命令三件套） | §3.4 新增「errDetail 嵌入段「」定界的精确范围」表；§12.6 复核命令 | 精确范围：⑤/e201C 与 E200 全量逐字不加定界；e201D catch 路径恰对 errDetail 插值段加「」（模板骨架逐字）；E203/E205 定界（新码无锚）。锚安全实证：37 处 E201 锚全为前缀子串/正则（本 worktree grep 全枚举），变体 C/D 内部文本零测试锚（触发类/无法完成/语义校验偏离/校验防线 0 命中）|

**R3 修订一致性自检**（按 SKILL 修订协议执行，取代 R2 自检段）：

- `grep -n "instanceof DocRuntimeFatalError"` 全文命中均为**非活代码**位置——§3.3 R1 病灶引述/删除标记注释、catch 分级总表的「零透传原则」陈述与 PoC 路径描述、§5 Runtime fatal gate 判据登记（Runtime 层消费面，非本包 catch）、本回应表——**本包任何 catch 活代码均无透传分支** ✓；
- 「(H)/(I) 移出 try / prepareMutation」结构在 §7.2（伪代码）/§11（契约行）/§12.4（实现步骤）三处一致 ✓；⑥「守卫删除 + e201D cause 必选」在 §3.3（总表）/§3.4（⑤⑥ branded 化注释 + ⑥ 段落）/§12.3 一致 ✓；
- 「读取即执行外部代码」正确前提在 §3.3 catch 分级总表前导与 §7.2 catch 注释两处一致；R2 旧断言（「外部执行面仅 (H)」「⑥ 无外部代码执行面/无伪造面」）全文已无活断言残留（`grep` 仅命中本自检段的引述性提及；⑥ 总表行中「零 observer 一次性 doc」的 scratch 事实表述保留，但不再由其导出「无伪造面」结论——derived 二次读面才是决定性事实）✓；
- 敌意读投递锚两条（PoC-1→E205 / PoC-2→e201D）在 §4.5 补锚表与 §14 R-7 一致 ✓；P-9 措辞在 §7.2 (G½) 注释与 §10 P-9 一致 ✓；§7.6 用例 4 归因 (D) 与 §7.2 (C)/(D) 注释一致 ✓；
- R2 已认可面零回退：own-key 纪律（§7.3）、(G½)（§7.2）、E202 参数化（§7.2 ⓪/§12.6）、「」定界（§3.3/§6.3）、P-7（§10）均未被 R3 触碰 ✓；E205 message 增「」定界（§7.2 注 + 回应表 #6 行 R3 扩用）与 #6 边界登记一致 ✓；【R3.1】§15 两条目与 §3.3/§3.4/§12.3/§12.4 零矛盾（「⑥ catch instanceof 守卫」残留指令已删，grep 确认仅 §15 修正条目以否定语态引述）；「」定界范围表与 §3.3（E203）/§7.2（E205）/§9（E200 留守逐字）一致；markdown 代码围栏偶数配对 ✓。