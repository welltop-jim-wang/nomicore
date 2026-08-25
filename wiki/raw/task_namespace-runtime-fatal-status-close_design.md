# SA1 设计（R1 修订）— @nomicore/namespace-runtime：close 生命周期、七键 capability status 与 fatal×close 交叉（issue #92）

- 任务类型：功能开发（新增 close 生命周期能力 + getStatus 七键演进 + fatal 语义验收收口）
- 基线：HEAD 588fa2b（#89 骨架 + #90 write sequencer/fatal 主体 + #91 原子 SCHEMA replacement 均已合入）
- 契约源：ADR-0008「生命周期、状态与所有权」+「Fatal 与失败通道」+「读取能力」+「单一 write sequencer」节（SA8 Phase 0 verdict `clear`，N1 裁定本任务是**兑付**非演进）
- 红灯锚：`packages/namespace-runtime/test/runtime-close-lifecycle.test.ts`（8 用例，2026-08-25 实测 8 failed 真红）+ `runtime-close-lifecycle-type-guard.test-d.ts`（3 用例，TS2339×3 + TS2344×1 实报）
- 修订记录：**R1（2026-08-25）**——落实 SA2 攻击评审（verdict=pass）附带修订要求 R-1(b)/R-2/R-3/R-4 + R-5 记录（逐条回应表见 §10 之后；设计方向零变更，全部为文档/注释/判定式精确化）

---

## §0. 任务定位与交付边界

本任务是 ADR-0008 在 #89/#90/#91 三个子集实施后的**剩余条款兑付**：

1. **close 生命周期**：公共第十键 `close()`；lifecycle 状态机 `ready → closing → closed`；closing 起立即停止接纳公共 read/write；close barrier 入 sequencer 队尾、无条件排空已接纳任务、无 timeout；barrier 恰调一次 `handle.release()`；release 失败 → close Promise reject 但 Runtime 仍 closed；后续 close 返回同一已结算 Promise。
2. **getStatus 七键**：lifecycle 三态真话 + 第七键 `close` 摘要（稳定 `{code,message}` 或 null）；closing/closed 期三能力位恒 false。
3. **fatal 验收收口与 fatal×close 交叉**：#90 已交付的 fatal 通道（`RuntimeWriteFatalError` / `markWriteFatal` / `rejectWithWriteFatal` / S1 fatal gate）**零改写**，本任务只补交叉语义（fatal 后 close 照常；排空期内 fatal 写槽照常 fatal 语义）与回归锚验证。

**非目标（显式排除）**：
- 不实现 Registry（ADR-0008「Registry 另行设计」）；
- 不提供公共事件订阅 / 队列进度观测（AC8 负向锁定；ADR「v1 不提供公共事件订阅；队列进度和内部事件属于日志、metrics 与 trace」——本任务连内部日志/metrics 面也不建设，保持闭包纯函数性与确定性可测）；
- 不触碰 doc-runtime / persistence / vfsl 源码（fatal 契约、DocHandle.release、compile 严格门均只读消费）；
- 不改写任何 #89/#90/#91 已交付行为面（写槽槽序、fatal 分类表、snapshotter、投影器全部原样）。

---

## §1. 契约来源与现状盘点

### 1.1 ADR/CONTEXT 条款 → 本设计消费映射

| 条款（ADR-0008 除非注明） | 本设计落点 |
|---|---|
| 「`close()` 幂等。首次调用同步进入 `closing`，立即停止接纳公共 read 和 write，并在队尾加入 close barrier」 | D2（close 方法）/ D4（read 停接纳）/ D5（write 停接纳） |
| 「此前已接纳任务无条件排空，不取消、不设内部 timeout」 | D5.2（槽内不设 lifecycle gate 的裁决）/ INV-C7 / §6.1 时间线 |
| 「barrier 只调用一次 `handle.release()`」 | D3（barrier 槽体）/ INV-C4 |
| 「无论 release 成败，Runtime 都进入 `closed`，失败时 close Promise reject，后续 close 返回同一个已结算 Promise」 | D3 / INV-C2/C5 |
| 「结构化瞬时 capability status……lifecycle、read、ROOT write、SCHEMA write，以及稳定且不含原始 Error/stack/SCHEMA 全文/ROOT 数据的 schema、fatal、close issue 摘要。status 不暴露队列长度、任务类型或 sequence」 | D6（七键 buildStatus）/ INV-C8 |
| 「v1 不提供公共事件订阅」 | D2（十键面，无事件键）/ INV-C11 |
| 「预期路径、载体和 lifecycle 失败使用同步结果联合，只有 internal bug 才抛异常」（读取能力节） | D4（read 拒绝走结果联合新分支，非抛） |
| 「普通、可预期且零写入的读取或写入失败使用领域化结果联合」（失败通道节） | D5（write 拒绝复用 disabled() 领域联合） |
| 「已排队的后续写仍按 FIFO 取得槽，且不访问输入、零写入返回 `RUNTIME_WRITE_DISABLED`」 | D5.3（S1 fatal gate 原样保留）+ D5.1（lifecycle 拒绝同码族） |
| fatal 五条 bullet（committed 语义/notifier 计数/不补偿/稳定 rejection/排队零写入） | 零改写（§8 零回归清单逐项核对） |
| ADR-0006：release 幂等、lease 语义；#79 entry 级 getStatus | §12 #4（barrier 与 handle 层状态不反灌，N6 分层） |
| CONTEXT.md「写序列器」：close barrier 加入同一队列队尾；P0 先例（「不写 Y.Doc」的队列节点） | D3（barrier = sequencer.enqueue(release 槽)——#90 sequencer.ts 扩展位注释的兑现） |

### 1.2 前置交付消费面（已核实源码，本设计只读消费）

- `sequencer.ts`：promise-chain FIFO（`enqueue`：前项 settle 后本项才执行；返回值即完成信号；链尾恒绿）。**零改动**——「close barrier = enqueue(release 槽)」扩展位（sequencer.ts:15-17 注释）所需的两个挂接性质（前项 settle 后启 + 返回完成信号）已具备。
- `write.ts`：`disabled()`（RUNTIME_WRITE_DISABLED 稳定码构造，共享给 SCHEMA 槽）、`markWriteFatal`、`rejectWithWriteFatal`、S1 fatal gate——全部原样消费。
- `errors.ts`：NSRT-* 稳定码注册表 + `RuntimeWriteFatalError`——append-only 扩展（D9）。
- `p0.ts`：`RuntimeState`（闭包私有唯一可变源）——扩展 lifecycle/close 域字段（D1）；P0 槽体零改动。
- `doc-runtime` `ReadLogicalValueResult`：`{ok:true;value} | {ok:false;code:'PATH_NOT_ALLOWED';path;message?}`——read 透传的既有联合，本设计在其上**加法扩展**（D4）。
- `persistence` `DocHandle`（contract.ts:16-30）：`release(): Promise<void>`、`getStatus(): DocHandleStatus`——barrier 唯一触碰点。

### 1.3 SA6 冻结契约归纳与让渡点裁决

SA6 红灯锚（不可收窄）与「契约冻结边界」节显式让渡给 SA1 的四个决策点，裁决如下：

| 让渡点（SA6 原文） | SA1 裁决 | 裁决依据 |
|---|---|---|
| closing/closed 期 read 拒绝的具体 code 字面量 | **新增结果联合分支 `RUNTIME_READ_DISABLED`**（不借用 `PATH_NOT_ALLOWED`）——`NamespaceRuntime.read` 返回类型宽化为 `NamespaceRuntimeReadResult = ReadLogicalValueResult \| RuntimeReadDisabledResult`（后者 `{ok:false; code:'RUNTIME_READ_DISABLED'; path; message}`） | ADR「lifecycle 失败使用同步结果联合」要求联合**表达** lifecycle 失败；借用 PATH_NOT_ALLOWED 会把生命周期失败伪装成路径缺陷（调用方按 code 分支时误分类），属语义造假。新增分支是加法扩展：既有消费者 `if (read.ok)` / `read.code` 判别全部编译兼容（§13 Caller 清单逐文件核对） |
| closing/closed 期 write 拒绝的具体码 | **复用 `RUNTIME_WRITE_DISABLED` 稳定码**（经 `disabled()` 共享构造，reason 文案区分 lifecycle 域） | 同码族先例：fatal 后排队写（S1 gate）、writable gate、notifier 未绑定三处已共用此码 + 「本调用零写入、输入零访问」尾注；lifecycle 拒绝同属「零写入、不访问输入」的领域化失败。SA6 明文「`RUNTIME_WRITE_DISABLED` 归 SA1 决策」 |
| close 摘要的 code 字面量 | **`NSRT-CLOSE-RELEASE-FAILED`**（+ 恒定 message 常量，见 D9） | errors.ts NSRT-* 命名族（NSRT-FATAL-P0-INTERNAL / NSRT-FATAL-WRITE-INTERNAL / NSRT-FATAL-SCHEMA-WRITE-INTERNAL 先例） |
| close rejection 的 reason 类名 | **包内 `NamespaceRuntimeCloseError`**（稳定 message + `cause` 零信息损失保留原始异常；**不从 index.ts 导出**） | `RuntimeWriteFatalError` 先例（稳定 branded wrapper + cause；message 恒定不插值原始文本）；ADR-0008 未给 close rejection 命名公共形状 → 最小公共面：分类消费走 `getStatus().close`（ADR 明文把 close issue 摘要放在 status）或 `reason.code` 字符串，沿「构造/投影错误类别不导出、按 code/message 字符串消费」纪律。导出留待 Registry 落地时有真实消费者再议（§10 开放问题） |

类型面锚（test-d）三用例的落点：`close` 成员 → D2；`getStatus().close` 键 → D6；lifecycle 三态联合 → D6（接口精确声明 `'ready' | 'closing' | 'closed'`，不用 string）。

---

## §2. 需求推演（Feature）：不变量清单

- **INV-C1（lifecycle 单向状态机）**：`ready → closing → closed` 单向；`ready→closing` 仅在 `close()` 首次调用的同步段写入；`closing→closed` 仅在 close barrier 槽体单点写入（成功/失败两路都写）。无回迁、无跳态、无第二写入点。构造即 `'ready'`。
- **INV-C2（close 幂等）**：`close()` 所有调用（并发/顺序/已结算后）返回**同一 Promise 实例**（首次创建并缓存于闭包）；因此 barrier 恰入队一次、rejection reason 身份恒定。
- **INV-C3（barrier 是队列终节点）**：close 后公共写接纳门同步拒绝（零入队），故 barrier 之后永无新节点；barrier 之前的节点恰为 close 前已接纳任务（P0 / 写槽）。
- **INV-C4（release 恰一次且后置）**：`handle.release()` 仅在 barrier 槽体内调用恰一次，且因 promise-chain FIFO 必然发生在全部已接纳任务 settle 之后。
- **INV-C5（closed 恒达 + 失败双通道）**：无论 release 结局，lifecycle 必达 `'closed'`。失败时：`state.closeIssue` 冻结稳定摘要注册 + close Promise reject（稳定 `NamespaceRuntimeCloseError`，cause 保留原始）；成功时：close 摘要 null + resolve。
- **INV-C6（停接纳的结算形状）**：lifecycle ≠ ready 时——`read()` 同步返回 `ok:false` 结果联合分支（非抛、非 Promise、不触碰 live Y.Doc）；`mutateRoot`/`replaceSchema` **不入队**、经返回 Promise settle `ok:false`（领域化联合，`RUNTIME_WRITE_DISABLED` 码）、零输入访问、零 doc 副作用。
- **INV-C7（已接纳任务无条件排空）**：写槽/P0 槽体内**无 lifecycle gate**——槽只保留既有 fatal/writable/管线门；close 不取消任何已接纳任务、不设 timeout；排空期内槽内 fatal 语义照常（队列链尾恒绿保证单项 rejection 不断裂 barrier）。
- **INV-C8（七键 status 纪律）**：键集恰 `{lifecycle,read,rootWrite,schemaWrite,schema,fatal,close}`；lifecycle 三态真话；closing/closed 期三能力位恒 false（由 lifecycle 域短路决定，不依赖 handle 观察）；close 摘要稳定 `{code,message} | null`，不含原始 Error/stack；不暴露队列长度/任务类型/sequence；无数组值字段；每次调用全新对象。
- **INV-C9（fatal × close 正交）**：fatal 摘要置位后不受 close 影响，反之 close 摘要不受 fatal 影响；fatal 后 `read.enabled` 保持 true（lifecycle 仍 ready）、`close()` 后才 false；fatal 后 close 照常排空 + release。
- **INV-C10（术语分域维持，#90 R2 立法）**：fatal 域 message（`writeFatalMessage` 模板 / FATAL_*_MESSAGE 常量 / S1 fatal gate disabled 文案）**零字节改动**，不含 closing/closed/永久关闭措辞；close 域 message（read/write 接纳拒绝、close 摘要、close rejection）**可且应当**使用 lifecycle 术语——两域字符串互不串味。
- **INV-C11（公共面恰十键）**：`owner/namespaceId/read/getSchemaEnvelope/getMetadata/getActiveSchema/getStatus/mutateRoot/replaceSchema/close`；无 on/off/subscribe/unsubscribe/emit/addEventListener/removeEventListener/once 等事件键（AC8）。
- **INV-C12（barrier 全 catch）**：release reject / release 同步 throw / release 返回非 thenable（adapter 契约违背；thenable 判定与 ECMAScript 一致——对象/函数两形态均受理，仅非 object/function、null、then 不可调用三形判违背【R1 修订，SA2 #4】）全部收敛为 D3 失败通道（closed + 摘要 + 稳定 reject），绝无裸 throw 逃逸；close Promise 的 rejection 即全部结局（调用方持有 promise，unhandled 属调用方责任——与 fatal rejection 同款 API 契约）。

---

## §3. 模块职责与文件布局

| 模块 | 职责 | 本任务改动 |
|---|---|---|
| `src/close.ts` | **新建**：`CloseEnv` + `runCloseBarrier`（barrier 槽体：thenable 守卫 → release → closed 迁移 / 失败通道） | §4 D3 |
| `src/runtime.ts` | 公共面第十键 `close`；read/write 接纳门（lifecycle gate）；`RuntimeReadDisabledResult`/`NamespaceRuntimeReadResult` 类型；seam V1 增补 release 形状守卫；closeEnv 一次成型 | §4 D2/D4/D5/D10 |
| `src/status.ts` | `NamespaceRuntimeStatus` 七键 + lifecycle 感知 buildStatus + close 摘要投影 + handle 观察短路 | §4 D6 |
| `src/p0.ts` | `RuntimeState` 扩展 `lifecycle`/`closeIssue?`/`closeCause?` 三字段（类型级）+ ① 扩展位注释裁决标注（≤2 行【R1 修订，SA2 #3】；P0 槽体行为零改动） | §4 D1/D5.2 |
| `src/errors.ts` | append-only：`NSRT-CLOSE-RELEASE-FAILED` code/message 常量、`RUNTIME_READ_DISABLED` 码、`NamespaceRuntimeCloseError`（包内类） | §4 D9 |
| `src/index.ts` | +2 类型导出（`NamespaceRuntimeReadResult`/`RuntimeReadDisabledResult`）+ 头注释 | §4 D11 |
| `src/write.ts` / `src/schema-write.ts` | **注释级**：S1「扩展位：lifecycle gate」注释兑现为裁决标注（接纳门在公共方法层，槽内不设——INV-C7） | §4 D5.2 |
| `src/sequencer.ts` | **零改动**（barrier 经既有 `enqueue` 挂接；扩展位注释仍准确） | — |
| `src/projection.ts` | **零改动**（投影器不参与 lifecycle gate，D7） | — |

依赖方向（无环）：`close.ts → errors.ts + p0.ts(type)`；`runtime.ts → close.ts + status.ts + write.ts + schema-write.ts + p0.ts`；`status.ts → p0.ts(type)`。

---

## §4. 核心设计决策

### D1 lifecycle 状态机宿主：RuntimeState 扩展（不引入第二可变源）

`p0.ts` 的 `RuntimeState` 是闭包私有「唯一可变源」（#89 立法：JS 单线程无竞态、读取方法零写）。lifecycle 与 close 摘要并入同一对象，避免出现两个可变源：

```ts
export interface RuntimeState {
  schemaState: 'preparing' | 'ready' | 'unavailable';
  schemaIssue?: Readonly<{ code: string; message: string }>;
  activeInfo?: Readonly<ActiveSchemaInfo>;
  activeTools?: { module: VfslModule; derived: DerivedSchema };
  fatal?: Readonly<{ code: string; message: string }>;
  fatalCause?: unknown;
  /** 【#92】Runtime 生命周期（INV-C1）：ready→closing 仅 close() 首调用同步段写入；
   *  closing→closed 仅 close barrier 槽体单点写入（成功/失败两路）。 */
  lifecycle: 'ready' | 'closing' | 'closed';
  /** 【#92】close issue 稳定摘要（仅 release 失败时注册并 Object.freeze——INV-C5）。 */
  closeIssue?: Readonly<{ code: string; message: string }>;
  /** 【#92】包内诊断锚点：release 失败原始异常（不进任何公共面；公共通道经 close
   *  rejection 的 cause）。沿 fatalCause（#90 R2，SA2 #6）先例。 */
  closeCause?: unknown;
}
```

构造点初始化 `const state: RuntimeState = { schemaState: 'preparing', lifecycle: 'ready' }`。写入点单点化：`state.lifecycle` 的全部写入仅两处（close() 同步段、runCloseBarrier）；P0/写槽**只读** `fatal`/`schemaState`/`activeTools` 域，零触碰 lifecycle 域。`exactOptionalPropertyTypes`：`closeIssue` 仅在失败时赋值（沿 `schemaIssue` 先例，绝不显式写 undefined）。

### D2 close() 公共方法：幂等、同步进 closing、队尾 barrier、同一 Promise 实例

```ts
// runtime.ts（V3c''' closeEnv 一次成型——纯数据闭包，沿 writeEnv/schemaWriteEnv 先例）
const closeEnv: CloseEnv = { handle, state };
let closePromise: Promise<void> | undefined;   // 幂等缓存（INV-C2 的载体）

// 公共面第十键（interface 成员）：
readonly close: () => Promise<void>;
// JSDoc：幂等（所有调用同一实例）；首次调用同步进入 closing 并立即停止接纳公共
// read/write；close 前已接纳任务无条件排空（不取消、无 timeout）；barrier 恰调一次
// handle.release()；release 失败 → 本 Promise reject（稳定 reason，cause 保留原始），
// 但 Runtime 仍 closed；后续调用返回同一已结算 Promise。
// 【R1 修订，SA2 #2/R-2】重入语义（文档化要求，SA3 须写入 close 的 JSDoc）：
// 在已接纳任务的槽体/notifier 回调内**同步**调用 close() 属 FIFO 队尾语义——barrier
// 排在该任务之后，良定义无害（该写照常 settle、release 仍恰一次且晚于它）；但在
// notifier 内 **await 本 close Promise 之后才放行**将构成自等待死锁（该写等 notifier
// → notifier 等 barrier → barrier 等该写 settle）——close 与该写双双永挂起，属
// 「不取消、不设内部 timeout」的契约行为，调用方不得如此使用。

close: (): Promise<void> => {
  if (closePromise !== undefined) return closePromise;      // 幂等（含已结算后）
  state.lifecycle = 'closing';                              // 同步迁移（返回前可观测，INV-C1）
  closePromise = sequencer.enqueue(() => runCloseBarrier(closeEnv)); // 队尾 barrier（INV-C3/C4）
  return closePromise;
},
```

关键性质论证：

- **「同步进入 closing」与「barrier 后置」同时成立**：`enqueue` 经 `.then` 微任务排程（sequencer.ts:33-37 注释，#89 INV-N1 机制根源），thunk 绝不在 close() 调用栈内同步执行；lifecycle 写入在同步段完成，测试「close() 返回前 `lifecycle === 'closing'`」即时可观测。
- **幂等性不依赖 state 而依赖 promise 缓存**：并发第二次调用在同一同步 tick 内到达时 `closePromise` 已赋值 → 返回同实例；已结算后同理（AC7「后续 close 返回同一个已结算 Promise」）。
- **close() 是全函数**：任何状态下调用都不 throw、不 reject 除 release 失败外的原因。
- **thunk 纯调用**（`() => runCloseBarrier(closeEnv)`）：零属性读取、零字面量构造、无可抛点——沿 INV-N14 纪律。

### D3 close barrier 槽体（新模块 close.ts）：release 恰一次、closed 恒达、失败双通道

```ts
// close.ts（新建）
import type { DocHandle } from '@nomicore/persistence';
import { CLOSE_RELEASE_FAILED_CODE, CLOSE_RELEASE_FAILED_MESSAGE, NamespaceRuntimeCloseError } from './errors.js';
import type { RuntimeState } from './p0.js';

/** barrier 运行时环境（构造栈一次成型——纯数据闭包，槽体零读 seam 输入）。 */
export interface CloseEnv {
  readonly handle: DocHandle;
  readonly state: RuntimeState;
}

/**
 * close barrier 槽体（ADR-0008「生命周期、状态与所有权」节逐句兑现）：
 * - 经 sequencer.enqueue 挂接 → 必然在全部已接纳任务 settle 之后执行（FIFO，INV-C4）；
 * - barrier 只调用一次 handle.release()（close 幂等保证入队一次，INV-C2/C4）；
 * - 无论 release 成败，lifecycle 都进入 'closed'（INV-C5）；失败时 closeIssue 冻结注册
 *   + reject 稳定 NamespaceRuntimeCloseError（cause 零信息损失保留原始异常）；
 * - 不取消、不设内部 timeout（ADR 原文；release 永不 settle → close Promise 永挂起，
 *   属 ADR 契约行为）；
 * - release 返回非 thenable = adapter 契约违背（DocHandle.release(): Promise<void>，
 *   contract.ts:29）——拒绝虚假降级立法：不静默当成功，收敛为同一失败通道（INV-C12）。
 *   【R1 修订，SA2 #4/R-4】thenable 判定与 ECMAScript 一致：**对象形态与函数形态**
 *   （带可调用 `.then` 的 function）均为 thenable——后者接收并正常 await（拒绝它会把
 *   实际可能成功的 release 误报为失败通道，违反诚实报告）；仅「非 object 且非
 *   function」「null」「`.then` 不可调用」三形判为契约违背。
 */
export async function runCloseBarrier(env: CloseEnv): Promise<void> {
  try {
    const releaseResult: unknown = env.handle.release();
    if (
      (typeof releaseResult !== 'object' && typeof releaseResult !== 'function') || // 【R1 修订，SA2 #4】：function-thenable 同为 thenable（ECMAScript），接收
      releaseResult === null ||
      typeof (releaseResult as { then?: unknown }).then !== 'function'
    ) {
      throw new TypeError('handle.release() 必须返回 Promise<void>（DocHandle 契约）——非 thenable 返回属 adapter 契约违背');
    }
    await releaseResult;
    env.state.lifecycle = 'closed';           // 成功路：唯一迁移点（INV-C1）
  } catch (err) {
    env.state.lifecycle = 'closed';           // 失败路：closed 恒达（ADR「无论 release 成败」）
    env.state.closeIssue = Object.freeze({    // 稳定摘要（恒定文案，不插值原始异常——INV-C5/C8）
      code: CLOSE_RELEASE_FAILED_CODE,
      message: CLOSE_RELEASE_FAILED_MESSAGE,
    });
    env.state.closeCause = err;               // 包内诊断锚点（不进任何公共面）
    throw new NamespaceRuntimeCloseError(err === undefined ? undefined : { cause: err });
  }
}
```

- **barrier 不是写槽**：无输入快照、无 schema、无 notifier——独立于 write.ts/schema-write.ts 的第三类队列节点（与 P0「不写 Y.Doc」的队列节点先例同族，CONTEXT.md「写序列器」条目明文不违例）。
- **不检查 handle 状态**：ADR「barrier 只调用一次 handle.release()」是无条件指令——persistence-degraded / 外部已 release（幂等 resolve，contract.ts:29 + ADR-0006「release 幂等」）都不阻止 barrier。
- **失败通道的 closeIssue 在 throw 之前注册**：rejection 送达调用方时 `getStatus().close` 已可观测（沿 #90 D5.3「markWriteFatal 同步先行」执行序哲学）。
- **async 全 catch**：同步 throw / reject / 非 thenable 三路全部收敛（INV-C12）；本函数的 rejection 由 sequencer 链尾 noop 消化（队列无影响）+ closePromise 送达调用方。

### D4 read 停接纳：lifecycle gate + 结果联合新分支 `RUNTIME_READ_DISABLED`

```ts
// runtime.ts 类型（公共形状，随 NamespaceRuntime 接口导出）
/** closing/closed 期 read 拒绝分支（#92）：ADR-0008 读取能力节「预期路径、载体和
 *  lifecycle 失败使用同步结果联合」——lifecycle 失败不是路径缺陷，独立稳定码。 */
export interface RuntimeReadDisabledResult {
  readonly ok: false;
  readonly code: 'RUNTIME_READ_DISABLED';
  readonly path: readonly (string | number)[];
  readonly message: string;
}
export type NamespaceRuntimeReadResult = ReadLogicalValueResult | RuntimeReadDisabledResult;

// runtime.ts 公共面
read: (path: readonly (string | number)[]): NamespaceRuntimeReadResult => {
  const lifecycle = state.lifecycle;          // 单读捕获
  return lifecycle === 'ready'
    ? readLogicalValueAtPath(doc, path)       // D3 零包装透传（INV 延续：ready 期逐字节不变）
    : readDisabled(lifecycle, path);          // lifecycle gate 即时生效（不等待 P0/排空）
},

// runtime.ts 包内 helper（不导出）
function readDisabled(lifecycle: 'closing' | 'closed', path: unknown): RuntimeReadDisabledResult {
  let echo: readonly (string | number)[] = [];
  if (Array.isArray(path)) {
    try { echo = [...path]; } catch { echo = []; }   // 敌意 Proxy 数组防御（沿 read.ts safeSpreadPath 纪律）
  }
  return {
    ok: false,
    code: RUNTIME_READ_DISABLED_CODE,
    path: echo,                                       // 新鲜副本（不别名调用方数组——沿 notAllowed 纪律）
    message: `${RUNTIME_READ_DISABLED_CODE}: Runtime lifecycle 为 ${lifecycle}——` +
      'close 已停止接纳公共读取；本调用不触碰 live Y.Doc',
  };
}
```

- **同步、非抛、非 Promise**：红灯锚 case 2/4 的三重锁（`not.toThrow` / `not.toBeInstanceOf(Promise)` / `ok === false`）全满足；gate 在透传**之前**，「read 拒绝不等待 P0」（case 4：P0 仍 preparing 时 read 立即拒）。
- **message 插值仅 lifecycle 字面量**（'closing'/'closed' 闭集字符串）——稳定；属 close 域术语，与 fatal 域文案分域（INV-C10）。
- **为什么不借用 `PATH_NOT_ALLOWED`**：见 §1.3 让渡点裁决——借用会把生命周期失败伪装成路径缺陷，破坏按 code 分支的调用方分类。
- **加法类型扩展的编译兼容性**：`NamespaceRuntimeReadResult` 新分支与 `ReadLogicalValueResult` 的 ok:false 变体结构同族（code/path/message）；既有消费者全部经 `if (read.ok)` 判别后访问 `.value`/`.code`（§13 Caller 清单 11 文件逐一核对），零编译回归。

### D5 write 停接纳：公共方法层接纳门（acceptance gate）；槽内不设 lifecycle gate

#### D5.1 接纳门（runtime.ts 公共面）

```ts
mutateRoot: (mutation: unknown): Promise<MutateRootResult> => {
  if (state.lifecycle !== 'ready') {
    // 接纳拒绝：不入队（INV-C3）、零输入访问（mutation 引用仅存在不被读取——Proxy 零触发）、
    // 经返回 Promise settle 领域化联合（不同步 throw）
    return Promise.resolve(disabled(
      `Runtime lifecycle 为 ${state.lifecycle}——close 已停止接纳公共写；` +
      'close 前已接纳任务仍无条件排空，本调用不入队',
    ));
  }
  return sequencer.enqueue(() => runRootWriteSlot(writeEnv, mutation));  // 原样（#90 D1）
},
replaceSchema: (input: ReplaceSchemaInput): Promise<ReplaceSchemaResult> => {
  if (state.lifecycle !== 'ready') {
    return Promise.resolve(disabled(/* 同款 lifecycle reason */));
  }
  return sequencer.enqueue(() => runSchemaWriteSlot(schemaWriteEnv, input));  // 原样（#91 D1）
},
```

- **`Promise.resolve(disabled(...))` 的即时结算**是契约要求而非捷径：红灯锚 case 3 明文要求新写「在 A（已接纳挂起写）结算前即 settle ok:false（不入队）」。接纳拒绝不是排队任务——ADR「立即停止接纳」。#90 D1 的「不同步 throw、不同步结算」纪律约束的是**已接纳**路径（FIFO 定序）；拒绝路径的纪律是「任何拒绝都经返回的 Promise 结算」（不 throw）——本设计满足两者。
- **零副作用证明**：拒绝分支不创建 thunk、不读 `mutation`/`input`、不触碰 sequencer/doc——`stateBytes` 不变（case 3 断言）；`disabled()` 尾注「本调用零写入、输入零访问」如实。

#### D5.2 槽序定位：ADR「lifecycle/fatal gate」的 lifecycle 半边在接纳层兑现

ADR-0008 写槽条款「每个真正写任务的槽依次执行：lifecycle/fatal gate、……」。#90 实现把 lifecycle 半边留作扩展位（write.ts:81 注释「v1 恒 'ready'，close 属后续 issue」）。#92 兑现方式：**lifecycle gate 住在公共方法层（接纳时点），槽内只保留 fatal gate**。理由：

1. **结构性不可达**：槽内任务全部来自 lifecycle === 'ready' 期的 enqueue（接纳门保证）；它们执行时 lifecycle 可能已是 'closing'（close 后排空中）——但这恰是「已接纳任务」，ADR 明文要求**无条件排空**。槽内若设 lifecycle gate 并拒绝，将直接违反「此前已接纳任务无条件排空」。
2. **时点语义**：ADR 对 close 的要求是「立即**停止接纳**公共 read 和 write」——接纳（acceptance）时点即公共方法调用时点；JS run-to-completion 保证接纳门的 check-then-enqueue 与 close() 的 transition 之间无并发交错（同一同步段内原子）。
3. write.ts:81 / schema-write.ts（S1 扩展位）**与 p0.ts:74-75（① 扩展位）**注释更新为裁决标注（注释级，§11 ALLOW【R1 修订，SA2 #3/R-3】）：「lifecycle gate 已于 #92 兑现于公共方法接纳层（runtime.ts D5.1）；槽内不设——已接纳任务无条件排空（ADR-0008）」。p0.ts:74-75 原注释「真实写槽将在此步检查 lifecycle/fatal（文档位）」在 #92 后与 D5.2 裁决直接矛盾（lifecycle 半边已移至接纳层，槽内只留 fatal 半边）——不刷新将留下自相矛盾的文档位（≤2 行，P0 槽体行为零改动）。

#### D5.3 fatal gate 原样（零改写）

S1 fatal gate（`env.state.fatal !== undefined → disabled(...)`）逐字节保留：fatal 后（lifecycle 仍 ready）新写照常入队 → 槽内 S1 拒绝 → FIFO 语义与 RUNTIME_WRITE_DISABLED 措辞不变（#90 锚 + rev1 措辞锚零回归，§8）。接纳门先判 lifecycle、槽内先判 fatal：两域正交（INV-C9）——fatal+ready 走槽内 S1（既有锚），closing/closed 走接纳门（新锚）。

### D6 getStatus 七键：lifecycle 三态投影 + close 摘要 + handle 观察短路

```ts
// status.ts（修改后全量）
export interface NamespaceRuntimeStatus {
  readonly lifecycle: 'ready' | 'closing' | 'closed';        // 三态联合（类型面锚：toEqualTypeOf 精确匹配）
  readonly read: { readonly enabled: boolean };
  readonly rootWrite: { readonly enabled: boolean };
  readonly schemaWrite: { readonly enabled: boolean };
  readonly schema: {
    readonly state: 'preparing' | 'ready' | 'unavailable';
    readonly issue?: Readonly<{ code: string; message: string }>;
  };
  readonly fatal: Readonly<{ code: string; message: string }> | null;
  readonly close: Readonly<{ code: string; message: string }> | null;   // 第七键（#92）
}

export function buildStatus(handle: DocHandle, state: RuntimeState): NamespaceRuntimeStatus {
  const lifecycle = state.lifecycle;
  const fatal = state.fatal ?? null;
  // writableNow 瞬时观察仅在 ready 期执行（短路）：closing/closed 期写位由 lifecycle 域
  // 恒 false 决定——release 后 handle 处于 'released'，观察无信息增益，且隔离 adapter bug
  // （handle.getStatus() throw）对 post-close 状态读取面的干扰。ready 期 throw 原样传播
  // （#89/#90 既有契约：sync 方法，internal bug 可抛）——零回归。
  const writableNow = lifecycle === 'ready' && handle.getStatus() === 'ready';
  return {
    lifecycle,
    read: { enabled: lifecycle === 'ready' },
    rootWrite: {
      enabled: lifecycle === 'ready' && fatal === null && state.schemaState !== 'unavailable' && writableNow,
    },
    schemaWrite: { enabled: lifecycle === 'ready' && fatal === null && writableNow },
    schema:
      state.schemaState === 'unavailable' && state.schemaIssue !== undefined
        ? { state: state.schemaState, issue: state.schemaIssue }
        : { state: state.schemaState },
    fatal,
    close: state.closeIssue ?? null,
  };
}
```

- **read.enabled 语义**：`lifecycle === 'ready'`——fatal 不 gate read（fatal 后 true，INV-C9）；close 后 false（红灯锚 case 6「fatal 后 read.enabled true → close 后 false」逐拍吻合）。外部违约 release（lifecycle 仍 ready）时保持 true（runtime-boundary-supplementary 锚零回归：read 位不观察 handle）。
- **closing/closed 期三能力位恒 false**：由 `lifecycle === 'ready'` 合取短路保证（红灯锚 case 2/5/8）；不暴露队列长度/任务类型/sequence、无数组值字段（既有 INV-N11 纪律延续）。
- **close 摘要**：`state.closeIssue ?? null`——ready/closing 期与成功 close 后恒 null；release 失败后稳定 `{code,message}`（冻结对象、跨调用同引用）。`?? null` 保证永不输出 undefined 值键（exactOptionalPropertyTypes 纪律）。
- **schema/fatal 摘要不受 close 影响**：buildStatus 不触碰两者与 lifecycle 的交叉（红灯锚 case 6「schema.state ready 保持」/「fatal 摘要原样」/ case 8）。

### D7 gate 边界裁决：只 gate `read`/`mutateRoot`/`replaceSchema` 三能力；投影 getter 不 gate

ADR「立即停止接纳公共 read 和 write」的解读与边界：

1. **capability status 模型只命名一个 read 能力**：ADR 原文「lifecycle、read、ROOT write、SCHEMA write」四能力槽——`read` 即路径投影读取（`readLogicalValueAtPath` 透传，「读取只观察调用瞬间已经提交的 live Y.Doc」节唯一的公共读方法）；getSchemaEnvelope/getMetadata 是 SCHEMA/META 投影，getActiveSchema/getStatus 是身份/能力观测面。
2. **ADR 未给 getter 任何 lifecycle 失败通道**：它们的契约是 `SchemaEnvelope | null` / `Record` / 同步返回；gate 它们只能发明 throw（违反「只有 internal bug 才抛异常」）或静默 null（虚假降级）。ADR 不要求、也不可行。
3. **getStatus 必须在 closed 后继续工作**：lifecycle='closed' 本身只能经 getStatus 观测（红灯锚全依赖）；getActiveSchema 与 status.schema 同源（观测面家族）。
4. **仓库先例**：#89 R3 边界（外部违约 release 后「读取面继续观察 live Y.Doc 引用，不崩」）确立投影面对 handle 层状态变化的继续可用性；close 后 getter 沿同一性质（纯内存投影、零副作用、不延租约）。

裁决：lifecycle gate 仅作用于 read/mutateRoot/replaceSchema（capability 三槽）；getSchemaEnvelope/getMetadata/getActiveSchema/getStatus 全生命周期可用。close 域消息（D4 read-disabled message）明文「不触碰 live Y.Doc」与 getter 的继续投影不矛盾——前者是能力停接纳，后者是观测面。

### D8 fatal × close 正交性（交叉语义总表）

| 场景 | lifecycle | fatal | 行为 | 红灯锚 |
|---|---|---|---|---|
| fatal 置位（P0/写槽 internal fault） | ready | 非 null | 写位 false（既有公式 `fatal===null` 合取）、read 位 true、read() ok:true | case 6 前半 |
| fatal 后 close | closing→closed | 非 null（原样） | barrier 照常 release 恰一次、closed、fatal 摘要逐字段不变、read 转拒、close 摘要 null | case 6 |
| 排空期内写槽 fatal（committed:true） | closing | 置位 | 该写按 #90 fatal 语义 settle（rejection + 槽内 best-effort notifier 恰一次 + 不虚假回滚）；**队列链尾恒绿 → barrier 照常执行** → release 恰一次、closed | case 7 |
| closing 期新写 | closing | 任意 | 接纳门拒绝（不入队、零访问）——fatal 与 lifecycle 拒绝互不掩盖，lifecycle 先判（接纳层） | case 3 |
| close 后 getStatus | closed | 任意 | 七键真话：三能力位 false + 两摘要各自独立 | case 5/8 |

机制保证：fatal 域（`state.fatal`/`fatalCause`）与 close 域（`lifecycle`/`closeIssue`/`closeCause`）字段级分离、写入点级分离（fatal 写入点在 p0.ts ⑦ / write.ts markWriteFatal；close 写入点在 D2/D3 两处）、buildStatus 读侧零交叉。

### D9 稳定码注册（errors.ts，append-only）与术语分域

```ts
/** close barrier release 失败稳定 code（#92；NSRT-* 命名族）。 */
export const CLOSE_RELEASE_FAILED_CODE = 'NSRT-CLOSE-RELEASE-FAILED' as const;

/** close barrier release 失败稳定 message（恒定文案：不含原始异常文本/stack；close 域
 *  术语——与 fatal 域文案分域（INV-C10））。 */
export const CLOSE_RELEASE_FAILED_MESSAGE =
  'close barrier 的 handle.release() 失败：Runtime 已进入 closed（生命周期不受 release 成败影响）；' +
  '原始异常经 close Promise rejection 的 cause 与包内诊断锚点保留，不进 status 摘要。' as const;

/** closing/closed 期 read 停接纳稳定码（#92；与 RUNTIME_WRITE_DISABLED 对偶的 read 域码）。 */
export const RUNTIME_READ_DISABLED_CODE = 'RUNTIME_READ_DISABLED' as const;

/** close rejection 稳定形状（#92，包内类——不导出，沿 NamespaceRuntimeConstructionError
 *  先例：code+message 字符串消费 / getStatus().close 分类；cause 零信息损失）。 */
export class NamespaceRuntimeCloseError extends Error {
  readonly code = CLOSE_RELEASE_FAILED_CODE as const;
  constructor(options?: ErrorOptions) {
    super(CLOSE_RELEASE_FAILED_MESSAGE, options);
    this.name = 'NamespaceRuntimeCloseError';
  }
}
```

术语分域核对（INV-C10）：
- fatal 域字符串（`writeFatalMessage` 模板、`FATAL_P0/WRITE/SCHEMA_WRITE_INTERNAL_MESSAGE`、S1 fatal gate disabled reason）**零字节改动**——rev1 措辞锚（`expectNoClosingWording` + `expectDisableRetainWording`）继续绿。
- 新增 close 域字符串（read-disabled message、write 接纳拒绝 reason、`CLOSE_RELEASE_FAILED_MESSAGE`）使用 lifecycle 术语（closing/closed/close）——SA6 冻结边界明文允许（「lifecycle 状态值/'closed' 出现在 status.lifecycle 等新面，与 fatal message 分域不冲突」）。
- `CLOSE_RELEASE_FAILED_MESSAGE` 不含字面量 'stack'、不含任何哨兵可泄漏面（红灯锚 case 5 `JSON.stringify(closeSum)` 断言面）。

### D10 seam V1 增补 release 形状守卫（loud-early）

`captureSeamInput` 在 handle 形状检查中增补（紧跟 getStatus 检查）：

```ts
if (typeof h.release !== 'function') {
  throw new TypeError('handle.release 必须为 function（DocHandle 契约）');
}
```

依据：#92 起 release 成为 barrier 的 load-bearing 依赖；契约违背（缺 release）应在构造栈 loud 拒绝（INV-N4：一切校验前置于 enqueue、throw 路径零副作用），而非深埋 barrier 内 TypeError。**零回归证据**：`git grep -n "release:" packages/namespace-runtime/test` → 8 处 fakeHandle 全部提供 release 函数；其余 6 个测试文件经真实 `createMemoryPersistence.createDoc/loadDoc` 签发 handle（contract.ts:16-30 实现 release）。无外部包调用 seam（§13）。

### D11 导出面与版本 bump

- `index.ts`：`export type { NamespaceRuntimeReadResult, RuntimeReadDisabledResult } from './runtime.js'`（+2 类型导出，公共形状可名名化；值导出面不变——`NamespaceRuntimeCloseError` 不导出，D9）。头注释补一行十键面/七键面声明。
- `package.json`：`0.1.4 → 0.1.5`（HG #9）。doc-runtime/persistence 源码零触碰 → 不连带 bump。

---

## §5. 关键伪代码（SA3 实现蓝本）

```ts
// ═══ runtime.ts 构造序增量（嵌在既有 V1→V3 序内，次序不变） ═══
// V1 captureSeamInput：+release 形状守卫（D10）
// V3 状态初始化：
const state: RuntimeState = { schemaState: 'preparing', lifecycle: 'ready' };   // D1
// V3c''' closeEnv 一次成型（D2/D3）：
const closeEnv: CloseEnv = { handle, state };
// V3d 之后、公共面构造之前：
let closePromise: Promise<void> | undefined;

// ═══ 公共面（十键；Object.freeze(runtime) 收尾不变） ═══
const runtime: NamespaceRuntime = {
  owner,                                            // 原样
  namespaceId: docId,                               // 原样
  read: (path) => {                                 // D4：lifecycle gate → 透传/新分支
    const lifecycle = state.lifecycle;
    return lifecycle === 'ready'
      ? readLogicalValueAtPath(doc, path)
      : readDisabled(lifecycle, path);
  },
  getSchemaEnvelope: () => projectSchemaEnvelope(doc, 'public'),  // 原样（D7：不 gate）
  getMetadata: () => projectMetadata(doc),                         // 原样（D7）
  getActiveSchema: () => state.activeInfo ?? null,                 // 原样（D7）
  getStatus: () => buildStatus(handle, state),                     // D6（七键）
  mutateRoot: (mutation) => {                                      // D5.1 接纳门 + 原样 enqueue
    if (state.lifecycle !== 'ready') return Promise.resolve(disabled(lifecycleWriteRefusal(state.lifecycle)));
    return sequencer.enqueue(() => runRootWriteSlot(writeEnv, mutation));
  },
  replaceSchema: (input) => {                                      // D5.1 同款
    if (state.lifecycle !== 'ready') return Promise.resolve(disabled(lifecycleWriteRefusal(state.lifecycle)));
    return sequencer.enqueue(() => runSchemaWriteSlot(schemaWriteEnv, input));
  },
  close: () => {                                                   // D2
    if (closePromise !== undefined) return closePromise;
    state.lifecycle = 'closing';
    closePromise = sequencer.enqueue(() => runCloseBarrier(closeEnv));
    return closePromise;
  },
};

// helper（runtime.ts 包内）：
function lifecycleWriteRefusal(lifecycle: 'closing' | 'closed'): string {
  return `Runtime lifecycle 为 ${lifecycle}——close 已停止接纳公共写；close 前已接纳任务仍无条件排空，本调用不入队`;
}
// readDisabled 见 D4。
// 注：接纳门 helper 以「单读 state.lifecycle 到局部量再插值」实现，避免模板串内
// 反复读成员（伪代码简化写法，SA3 以等价最小实现为准）。
```

`close.ts` 全量与 `status.ts` 全量见 D3/D6（即最终形态，非示意）。`disabled()`/`markWriteFatal`/`rejectWithWriteFatal`/`writeFatalMessage`/sequencer/两写槽/P0 全部原样。

---

## §6. 边界条件、并发与时序分析

### 6.1 时间线（µ = 微任务；T = 测试可控时点）

**场景 A：close 时有挂起的已接纳写（红灯锚 case 3）**

| 时刻 | 事件 | 可观测 |
|---|---|---|
| t0 | `mutateRoot(A)` 接纳（lifecycle=ready） | 队列 [P0✓, A]；A 的 promise pending |
| t1 | A 槽执行至 S6，await notifyDirty（gate 挂住） | doc 已提交 n=42；A pending |
| t2 | `close()` 同步段：lifecycle='closing'；barrier enqueue | **close() 返回前** `lifecycle==='closing'`；release 计数 0 |
| t2' | `close()` 第二次调用 | 返回**同一 Promise 实例**（缓存命中） |
| t3 | `mutateRoot(99)` / `replaceSchema(...)` | lifecycle≠ready → `Promise.resolve(disabled)` 即时 settle ok:false；stateBytes 不变；A 仍 pending |
| T | gate.resolve() → A 的 S6 resolve → A settle {ok:true} | A promise resolved |
| t4 | 链尾推进 → barrier thunk：release() → resolve → lifecycle='closed' | release 计数 1；closePromise resolved；read() 拒；三能力位 false；close 摘要 null |

**场景 B：release 失败（红灯锚 case 5）**：t4 处 release() reject → catch：lifecycle='closed'、closeIssue 冻结注册、closeCause 存档、throw NamespaceRuntimeCloseError → closePromise reject（reason 含 cause=原始 Error）；后续 close() 返回同一 rejected promise（同一 reason 实例）；getStatus().close 稳定且跨调用同引用。

**场景 C：close 时 P0 仍 preparing（红灯锚 case 4）**：队列 [P0(gate 挂住), barrier]；close() 后 read() 立即拒（gate 不等待 P0）；P0 属已接纳任务 → gate resolve → P0 settle → barrier release 恰一次 → closed。

**场景 D：排空期写槽 fatal（红灯锚 case 7）**：队列 [P0✓, A(fatal 路径), barrier]；A reject RuntimeWriteFatalError（committed:true + notifier 恰一次）→ 链尾 noop 消化 → barrier 照常 release → closePromise resolve（队列不因单项 fatal 断裂）。

### 6.2 边界条件清单

| # | 边界 | 行为 | 依据 |
|---|---|---|---|
| 1 | close 并发/重复/已结算后调用 | 同一 Promise 实例；release 恰一次 | INV-C2/C4 |
| 2 | close 时队列空（P0 已结算） | barrier 下一微任务即执行 | §6.1 场景 A 退化 |
| 3 | close 时 P0 preparing（gate 挂住） | P0 无条件结算于 barrier 前；read 拒绝不等待 P0 | INV-C7；case 4 |
| 4 | release reject / 同步 throw / 返回非 thenable | 同一失败通道（closed + 摘要 + 稳定 reject） | INV-C12 |
| 5 | release 永不 settle | close Promise 永挂起（不取消、无 timeout——ADR 原文契约行为） | D3 |
| 6 | 外部违约 handle.release() 后再 close | barrier 调 release()（幂等 resolve）→ closed | contract.ts:29 + ADR-0006 |
| 7 | persistence-degraded handle + close | barrier 照常 release（barrier 不检查 handle 状态） | D3 |
| 8 | fatal 置位后 close | release 照常恰一次；fatal 摘要不变；read 由 true 转 false | INV-C9；case 6 |
| 9 | closing 期 hostile path（Proxy 数组）read | gate 先拒（不进透传）；path 回显防御拷贝（catch 回退 []） | D4 |
| 10 | closing 期 getStatus | 'closing'、三能力位 false、close 摘要 null（release 未执行） | D6 |
| 11 | barrier 执行中（await release 未决）getStatus | 同上（'closing'） | D6 |
| 12 | getStatus 在 ready 期且 handle.getStatus() throw | 原样传播（既有 loud 契约零变化）；closing/closed 期短路不再观察 handle | D6 |
| 13 | close() 在写槽/notifier 回调内重入【R1 修订，SA2 #2/R-2——原「公共 API 不可达」论证失实，已改写】 | **可达**（seam 注入的 notifier 闭包可经可变盒子在构造后捕获 runtime——生产 notifier=saveDoc 不会，但 seam 是包内导出的确定性注入面）。**同步调用 close()** = FIFO 队尾语义：barrier 挂当前槽之后，良定义无害（当前写照常 settle、release 仍恰一次且晚于该写、close 正常结算）；**在 notifier 内 `await close()` 之后才 resolve** = 自等待死锁（该写等 notifier → notifier 等 barrier → barrier 等该写 settle）→ close 与该写双双永挂起——与边界 #5 同族，属 ADR「不取消、不设内部 timeout」契约行为，非缺陷；已文档化于 D2 close JSDoc 设计要求（调用方不得如此使用） | D2/D3/INV-C7；§10 R5 |
| 14 | barrier 之后 enqueue | 结构不可能（接纳门 + barrier 终节点） | INV-C3 |
| 15 | release 返回 function-thenable（typeof 'function' 且带可调用 then）【R1 修订，SA2 #4/R-4】 | **接收并正常 await**（ECMAScript：函数形态同为 thenable；判定式已含 function 分支）——按其 settlement 走成功/失败通道，与对象形态 thenable 同待遇；仅非 object/function、null、then 不可调用三形判契约违背 | D3 |

### 6.3 数据一致性

- **lifecycle/closeIssue 单写者**：`state.lifecycle` 仅 D2/D3 两写点；`closeIssue`/`closeCause` 仅 D3 catch 一写点（冻结后只读）。JS 单线程 + 写点均在同步段内完成 → 无撕裂观测。
- **摘要冻结**：`closeIssue` 与既有 fatal/schemaIssue 同款 `Object.freeze`；status 每次调用构造全新外层对象（无共享可变引用——#89 D9 纪律延续）。
- **双通道一致性**：closePromise 结局（resolve/reject）与 `state.lifecycle`/`closeIssue` 在 barrier 同步段内先行落定、rejection 微任务送达时状态已可观测（markWriteFatal 同步先行哲学）。

---

## §7. 构建集成与类型纪律

### 7.1 typecheck 双通道（#89 §7.1 决议延续）

- **通道 A**：`pnpm typecheck` → `tsc -p packages/namespace-runtime/tsconfig.json`（include 仅 `src/**`）——`close.ts` 落 src/ 自动入检；测试文件不经此通道。
- **通道 B**：`pnpm test`（vitest run --typecheck）→ `tsconfig.typecheck.json` include `packages/*/test/**/*.ts`——`runtime-close-lifecycle.test.ts`（行为锚，SA6 实测「Type Errors: no errors」）与 `runtime-close-lifecycle-type-guard.test-d.ts`（typecheck.include `**/*.test-d.ts`）在此通道红/绿翻转。
- **通道 C**：`tsc -p tsconfig.typecheck.json --noEmit`（简报门禁）——SA6 红灯证据：全仓仅 4 错、全部在 test-d 文件（预期红）；修绿后必须 0 错。

### 7.2 SA6 冻结文件类型核对表

| 文件 | 类型依赖 | 本设计满足方式 |
|---|---|---|
| runtime-close-lifecycle.test.ts | `createNamespaceRuntimeWithSeam`/`NamespaceRuntime`/`DocHandle`/`RuntimeWriteFatalError`；status/close 经 `as unknown as` 宽化 | 宽化断言不依赖新类型声明；seam 输入形状零变化（只增 release 校验，输入面不变） |
| runtime-close-lifecycle-type-guard.test-d.ts | `runtime.close` 成员存在 + returns `Promise<void>`；`getStatus().close` 键；lifecycle `toEqualTypeOf<'ready'\|'closing'\|'closed'>()` | D2 成员精确 `() => Promise<void>`；D6 接口精确三态联合 + 第七键（非可选、非 string 放宽） |

### 7.3 strict 面纪律

`strict + exactOptionalPropertyTypes + noUncheckedIndexedAccess` 全开（tsconfig.base.json）：`closeIssue?` 仅失败时赋值（沿 schemaIssue 先例）；status 输出 `closeIssue ?? null`（无 undefined 值键）；模板串插值均为闭集 string 字面量。零新依赖（pnpm-lock 不动）。

---

## §8. 既有测试影响评估（演进清单 + 零回归清单）

### 8.1 既有锚演进清单（简报「既有锚的演进注意」逐项处置）

| 既有锚 | #92 后状态 | 处置 |
|---|---|---|
| `runtime-public-surface-ownership.test.ts`（SA8 N2 要求给出演进清单） | **断言面零改动仍全绿**（代码级核实：line 141 `lifecycle==='ready'` 在未 close 的 runtime 上断言——三态联合下仍真；line 104-114 键存在性/禁止键检查不涉 close；line 134-162 无精确键集锁、lifecycle 仅 typeof + 'ready' 断言）。【R1 修订，SA2 #5/R-5 记录在案】SA2 攻击评审独立复核（V7）确认本结论为真——简报 L53「该测试需随之更新」的预期系过虑，设计以代码级核实**推翻**之。**据此立法：SA3/SA6 不得据简报 L53 字面「顺手」修改本冻结锚的断言面**（SA6 owned 文件；任何演进须走 SA6 修订轮显式立项） | 仅头注释（line 36「close 属后续 issue，v1 恒 'ready'」）过时——**可选**注释级刷新（≤2 行，ALLOW LIST 登记）；断言与行为均不需改 |
| `runtime-write-fatal-message-rev1.test.ts`（#90 R2 立法锚） | `expectNoClosingWording` 继续绿：fatal 域字符串零字节改动（INV-C10）；closing 期写拒绝 reason 是**独立字符串**，不进入该断言面（该测试场景 lifecycle 恒 ready，接纳门不触发） | 零改动（[SA6 owned] 冻结锚，§11 ALLOW 登记「本任务预期零改动」） |
| 其余 #89/#90/#91 锚（12 文件——§11 ALLOW 冻结锚名单减去上行的 rev1） | 设计保证零回归（下表逐项） | 零改动（[SA6 owned] 冻结锚，§11 ALLOW 登记「本任务预期零改动」；仅 SA2 评审轮显式要求时由 SA6 演进） |

### 8.2 零回归核对表（每锚一行：为何绿）

| 既有锚文件 | 关键断言面 | 零回归依据 |
|---|---|---|
| runtime-sync-read-face | read 透传/缺键 ok:true undefined/`PATH_NOT_ALLOWED`（line 160） | 全部在 lifecycle=ready 期触发——gate 不分流；透传分支逐字节不变（D4） |
| runtime-p0-sequencer | P0 队首/微任务起步/lifecycle 'ready'（line 99）/read 锚 | P0 槽体与 sequencer 零改动；read 锚均 ready 期 |
| runtime-mutate-root-sequencer / -persistence / -sa7-dynamic / -snapshotter-array | FIFO/fatal 分类/notifier 计数/snapshotter/禁用码 | 写槽与 fatal 通道零改写；测试不 close → 接纳门不分流（lifecycle 恒 ready） |
| runtime-replace-schema-sequencer / -persistence / -sa7-dynamic / -type-guard | SCHEMA 写槽/原子替换/类型面 | 同上；replaceSchema 类型签名零变化（仅体内先判 lifecycle——分支不可达） |
| runtime-boundary-supplementary | 外部 release 后 read.enabled true（line 120）/getMetadata RangeError | lifecycle 仍 ready → read 位 true（D6 公式）；投影器零改动 |
| metadata-proto-key | META 投影 | projection.ts 零改动 |
| runtime-close-lifecycle（本任务 SA6 锚，现红） | 8 用例 | SA3 按本设计修绿（§9 映射） |

---

## §9. 验收标准映射（AC1–AC9）

| AC | 条款摘要 | 落点 | 红灯锚用例 |
|---|---|---|---|
| AC1 | internal fatal 永久关闭两类写、保留 read、摘要稳定 | #90 交付零改写（D5.3/D8）；close 引入后 fatal 摘要不变（INV-C9） | case 6 前半 + #90 既有锚 |
| AC2 | committed fatal 槽内 best-effort dirty notify + 始终 reject 原始 fatal + 明确 committed | rejectWithWriteFatal 零改写；排空期内同语义（D8 场景 D） | case 7 |
| AC3 | committed:false 不通知；未知异常保守 committed | #90 零改写（S1/S5 catch 原样） | #90 既有锚（回归） |
| AC4 | fatal 后排队任务 FIFO 取槽、零输入访问、RUNTIME_WRITE_DISABLED | S1 fatal gate 原样（D5.3） | #90 既有锚（回归） |
| AC5 | getStatus 七键、lifecycle/read/rootWrite/schemaWrite/schema/fatal/close、不暴露队列内部 | D6 | case 8 + test-d #2/#3 |
| AC6 | close 同步进 closing、停接纳、无条件排空、barrier 队尾 | D2/D4/D5/INV-C1/C3/C6/C7 | case 2/3/4 |
| AC7 | barrier release 恰一次；失败 close reject 但仍 closed；后续同 Promise | D3/INV-C2/C4/C5 | case 3/5 + test-d #1 |
| AC8 | 无公共事件订阅；队列进度仅内部 | D2 十键面/INV-C11 | case 1 |
| AC9 | 确定性测试全绿 + typecheck/test + Node 20/24 CI | §7 三通道 + §11 版本 bump；全部门禁绿后收尾 | 全部 |

---

## §10. 风险登记与开放问题

| # | 风险/开放点 | 评估与处置 |
|---|---|---|
| R1 | close Promise rejection 若调用方不 catch → unhandled rejection | API 契约（AC7 明文 reject）；与 fatal rejection 同款责任归属。文档化于 close JSDoc；不吞没 |
| R2 | release 永挂起 → close 永挂起 | ADR 明文「不设内部 timeout」——契约行为非缺陷；文档化 |
| R3 | release 返回**真**非 thenable（非 object/function、null、then 不可调用）的 barrier 期拒绝（D3 thenable 守卫） | 拒绝虚假降级立法的兑现：adapter 契约违背必须 loud；V1 守卫（D10）已把可静态检测的违背前移到构造栈。【R1 修订，SA2 #4/R-4】判定式已增 function 分支——function-thenable（带可调用 then 的函数）按 ECMAScript 同为 thenable，接收并正常 await（拒绝它会把实际可能成功的 release 误报为失败通道，违反诚实报告）；守卫的「契约执法」辖域收窄为**真正**的非 thenable 三形 |
| R4 | `NamespaceRuntimeCloseError` 不导出，上游只能 duck-typing | v1 最小公共面裁决（§1.3）；Registry 落地时有真实分类消费者再议导出（开放问题 O1，非阻塞） |
| R5 | 【R1 修订新增，SA2 #2/R-2】notifier 内 `await close()` 后才放行 → 自等待死锁（该写等 notifier → notifier 等 barrier → barrier 等该写 settle；close 与该写双双永挂起） | seam 注入面可达（生产 notifier=saveDoc 不会）；与 R2 同族——ADR「不取消、不设内部 timeout」契约行为，非缺陷。处置=文档化：D2 close JSDoc 设计要求已增补重入语义说明（§6.2 #13）；同步重入（不 await）则是良定义 FIFO 队尾语义、无害。零代码变更 |
| O2 | getter（getSchemaEnvelope 等）post-close 行为未受 ADR 明文约束 | D7 裁决（继续可用）已给四重论证；若 SA2/SA8 复审判定应收紧，属 ADR 未覆盖面的新决策——须升级总控，不在本任务擅断。【R1 修订，SA2 #1/R-1 方案 (b) 登记】**现状无行为锚**：SA6 两锚文件未覆盖 getter post-close 行为（case 8 仅锁 getStatus）——D7 属 SA8 登记的受保护解释性决策，缺红灯拦截即可无声漂移（任何后续任务「顺手」给 getter 加 lifecycle gate/throw 无锚可拦）。登记义务：**首个触碰 getter 面的任务必须先补验收锚**；推荐路径=SA6 修订轮在 case 8 增补断言（close 后 `getSchemaEnvelope()` 非 null 且四键与闭前 toEqual、`getMetadata()` toEqual 闭前、`getActiveSchema()` 非 null、均 `not.toThrow()`——SA2 红线测试思路 #1）；本登记（方案 b）在补锚前持续有效，与方案 (a) 并行不悖 |
| O3 | 内部观测面（日志/metrics/trace） | ADR 归属明确但 v1 不建设（§0 非目标）；fatalCause/closeCause 包内锚点已为其预留 |

## SA2 反馈逐条回应（R1 修订）

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| R-1（MEDIUM，攻击点 #1）：D7 裁决无验收锚——方案 (a) SA6 修订轮补锚 或 (b) SA1 登记 | ✅（本设计兑现方案 b；方案 a 留 SA6 轨道） | §10 O2 条目 | 登记「D7 现状无行为锚——首个触碰 getter 面的任务必须先补锚」+ 无声漂移风险说明 + 供 SA6 采用的 case 8 增补断言规格（getSchemaEnvelope/getMetadata/getActiveSchema post-close 可用性）；推荐 (a)+(b) 并行（沿 SA2 建议） |
| R-2（LOW，攻击点 #2）：§6.2 #13 论证失实（「公共 API 不可达」不成立）+ 重入语义未定义 | ✅ | §6.2 #13（改写）/ D2 JSDoc 块（增补）/ §10 R5（新增） | 改写为：可达（seam 闭包经可变盒子捕获 runtime）；同步调用 close() = FIFO 队尾语义、良定义无害（当前写照常 settle、release 仍恰一次且晚于该写）；notifier 内 await close() = 自等待死锁，属「不取消、无 timeout」契约行为；close JSDoc 设计要求增补重入语义文档化（SA3 须写入）——零代码变更 |
| R-3（LOW，攻击点 #3）：p0.ts:74-75 ① 扩展位注释与 D5.2 裁决矛盾、未列入演进 | ✅ | §11 ALLOW p0.ts 条目（放宽）/ §3 模块表 p0.ts 行 / D5.2 第 3 点 | 放宽为「类型级 + ① 扩展位注释级刷新（≤2 行）」，与 write.ts/schema-write.ts 同款 D5.2 裁决标注；行数估算 14→16 |
| R-4（LOW，攻击点 #4）：D3 thenable 守卫把 function-thenable 误判为契约违背 | ✅（采纳判定式分支方案） | D3 docstring + 判定式（增 `typeof === 'function'` 分支）/ §10 R3 / §6.2 新增 #15 | function-thenable 按 ECMAScript 同为 thenable——接收并正常 await（规范一致执法；拒绝会把实际可能成功的 release 误报为失败，违反诚实报告）；守卫辖域收窄为真正非 thenable 三形（非 object/function、null、then 不可调用）；新契约已入 §6.2 #15 可供 SA6 锚定（若采纳 SA2 红线思路 #3 的 function-thenable 用例，预期=close 按其 settlement 正常结算） |
| R-5（INFO，攻击点 #5）：简报 L53「ownership 锚需更新」预期被设计推翻——记录在案 | ✅（记录确认） | §8.1 第 1 行处置列 | 增记 SA2 V7 独立复核确认 + 立法：「SA3/SA6 不得据简报 L53 字面『顺手』修改该冻结锚的断言面」（SA6 owned 文件，演进须走 SA6 修订轮显式立项）；另修正 §8.1 处置列与 §11 ALLOW 名单的 DENY 措辞漂移（两处「零改动（DENY）」→「零改动（[SA6 owned] 冻结锚，ALLOW 登记）」） |

---

## §11. 文件清单（File Scope）

### ALLOW LIST

- `packages/namespace-runtime/src/close.ts` — **新建**，close barrier 槽体（CloseEnv + runCloseBarrier + thenable 守卫 + 失败通道）（§4 D3，约 70 行）
- `packages/namespace-runtime/src/runtime.ts` — 修改：公共第十键 close + closeEnv/closePromise 闭包 + read/write 接纳门 + `RuntimeReadDisabledResult`/`NamespaceRuntimeReadResult` 类型 + readDisabled/lifecycleWriteRefusal helper + captureSeamInput 增 release 形状守卫 + 头注释（§4 D2/D4/D5/D10，约 +60 行）
- `packages/namespace-runtime/src/status.ts` — 修改：七键 `NamespaceRuntimeStatus`（lifecycle 三态 + close 键）+ lifecycle 感知 buildStatus（handle 观察短路）+ 头注释（§4 D6，净改约 30 行）
- `packages/namespace-runtime/src/p0.ts` — 修改：`RuntimeState` +`lifecycle`/`closeIssue?`/`closeCause?` 三字段与注释（类型级）**+ ① 扩展位注释级刷新（≤2 行）**【R1 修订，SA2 #3/R-3】——p0.ts:74-75 原注释「真实写槽将在此步检查 lifecycle/fatal（文档位）」与 D5.2 裁决（lifecycle 半边已兑现于接纳层、槽内只留 fatal 半边）矛盾，须刷新为同款裁决标注；P0 槽体行为零改动（§4 D1/D5.2，约 +16 行）
- `packages/namespace-runtime/src/errors.ts` — 修改（append-only）：`CLOSE_RELEASE_FAILED_CODE`/`CLOSE_RELEASE_FAILED_MESSAGE`/`RUNTIME_READ_DISABLED_CODE` 常量 + `NamespaceRuntimeCloseError` 包内类（§4 D9，约 +28 行）
- `packages/namespace-runtime/src/index.ts` — 修改：+`NamespaceRuntimeReadResult`/`RuntimeReadDisabledResult` 类型导出 + 头注释一行（§4 D11，约 +4 行）
- `packages/namespace-runtime/src/write.ts` — 修改，**注释级**：S1 扩展位注释兑现为 lifecycle gate 接纳层裁决标注（§4 D5.2，≤4 行，零行为改动）
- `packages/namespace-runtime/src/schema-write.ts` — 修改，**注释级**：同款扩展位裁决标注（§4 D5.2，≤4 行，零行为改动）
- `packages/namespace-runtime/package.json` — 修改，版本 0.1.4 → 0.1.5（HG #9；doc-runtime/persistence 零触碰不连带 bump）
- `packages/namespace-runtime/test/runtime-close-lifecycle.test.ts` — `[SA6 owned]` 已存在（本任务红灯锚，2026-08-25 实测 8 failed 真红）；SA3 修绿不得改断言逻辑；SA6 修订轮可自主演进
- `packages/namespace-runtime/test/runtime-close-lifecycle-type-guard.test-d.ts` — `[SA6 owned]` 同上（3 用例类型面锚）
- `packages/namespace-runtime/test/runtime-public-surface-ownership.test.ts` — `[SA6 owned]`（#89 冻结锚）修改，**可选注释级**（§8.1：断言面零改动仍绿；仅刷新 line 36 头注释对十键/七键/三态的过时描述，≤2 行。SA3 亦可完全不动）
- 以下 **#89/#90/#91 冻结验收锚**均 `[SA6 owned]` 且**本任务预期零改动**（§8.2 零回归设计保证；仅当 SA2 评审轮显式要求演进时由 SA6 修改，SA3 不改断言逻辑）：`runtime-sync-read-face.test.ts`、`runtime-p0-sequencer.test.ts`、`runtime-mutate-root-sequencer.test.ts`、`runtime-mutate-root-persistence.test.ts`、`runtime-mutate-root-sa7-dynamic.test.ts`、`runtime-mutate-root-snapshotter-array.test.ts`、`runtime-replace-schema-sequencer.test.ts`、`runtime-replace-schema-persistence.test.ts`、`runtime-replace-schema-sa7-dynamic.test.ts`、`runtime-replace-schema-type-guard.test-d.ts`、`runtime-write-fatal-message-rev1.test.ts`、`runtime-boundary-supplementary.test.ts`、`metadata-proto-key.test.ts`

### DENY LIST

- `packages/namespace-runtime/src/sequencer.ts` — barrier 经既有 `enqueue` 挂接，零行为改动；扩展位注释（「close barrier = enqueue(release 槽)」）在 #92 后仍准确
- `packages/namespace-runtime/src/projection.ts` — 投影器不参与 lifecycle gate（D7）；零改动
- `packages/namespace-runtime/tsconfig.json` — include src/** 决议延续（#89 §7.1；close.ts 落 src/ 自动入检）
- `packages/doc-runtime/**` — fatal 契约（#87/#91 交付）与读取联合只读消费，零触碰
- `packages/persistence/**`、`packages/dsh-persistence/**` — DocHandle/release 契约消费方，零触碰
- `packages/vfsl/**`、`packages/vfsl-protocol/**`、`packages/vfsl-codegen/**` — 编译轨道零交集
- 根 `package.json`、`pnpm-lock.yaml`、`vitest.config.ts`、`tsconfig.base.json`、`tsconfig.typecheck.json`、`.github/workflows/**` — 零新依赖、门禁配置已覆盖
- `docs/adr/**`、`CONTEXT.md` — ADR 兑付非修订
- `apps/**`、`domains/**`、`tests/**` — 无交集

---

## §12. 协议假设依据 (Protocol Assumption Evidence)

| # | 假设 | 依据类型 | 依据内容（具体引用） | 风险等级 |
|---|---|---|---|---|
| 1 | barrier thunk 绝不在 close() 调用栈内同步执行（enqueue 经 `.then` 微任务排程）——「同步进入 closing」与「barrier 后置于全部已接纳任务」可同时成立 | 官方文档引用（规范语义）+ 源码引用 | ECMAScript PromiseJobs/NewPromiseResolveThenableJob；`packages/namespace-runtime/src/sequencer.ts:33-37`（「绝不在 enqueue 调用栈内同步运行（INV-N1 机制根源）」——#89 交付并经 5 文件冻结锚实证） | 低 |
| 2 | promise-chain FIFO：barrier 恰在全部先入队任务 settle 之后执行 | 源码引用 + 现有测试引用 | `sequencer.ts:38-42`（`this.tail.then(run, run)` 尾接尾 + 返回 settled）；`runtime-mutate-root-sequencer.test.ts` FIFO 锚（#90 合入基线全绿——简报「上一任务基线 84 files / 1078 tests」） | 低 |
| 3 | 链尾恒绿：排空期单项 fatal rejection 不阻断 barrier 执行 | 源码引用 + 现有测试引用 | `sequencer.ts:23-26/40`（`settled.then(noop, noop)`——「单项失败不阻断 FIFO」）；#90「fatal 后 FIFO 继续」锚 | 低 |
| 4 | `DocHandle.release()` 幂等且返回 `Promise<void>`；外部已 release 后 barrier 再调仍 resolve | 源码引用 + ADR 条款 | `packages/persistence/src/contract.ts:29`（接口签名）；ADR-0006「release 幂等且仅释放本次使用权」（relevant_decisions L59）；ADR-0008「barrier 只调用一次 handle.release()」 | 低 |
| 5 | `Promise.resolve(v)` 返回已兑现 promise：接纳拒绝即时 settle（先于队列内 pending 任务） | 官方文档引用（规范语义）+ 红灯锚 | ECMAScript Promise resolve function 语义；`runtime-close-lifecycle.test.ts` case 3 明文要求「新写在 A 结算前即 settle ok:false（不入队）」 | 低 |
| 6 | JS run-to-completion：close() 同步段内 lifecycle 迁移与接纳门 check-then-enqueue 无并发交错 | 官方文档引用 + 仓内先例 | ECMAScript 执行模型（同步代码不可分割）；#90 设计 INV-W1 同款论证（mutateRoot 同步接纳定序依赖） | 低 |
| 7 | vitest `--typecheck` 经 `tsconfig.typecheck.json` 编译 `packages/*/test/**/*.ts`（含 `.test-d.ts`）——类型面红/绿翻转可依赖 | 设计期实测验证（红灯证据）+ 源码引用 | `vitest.config.ts:6-11`（typecheck.include + tsconfig）；简报红灯证据：`pnpm exec vitest run --typecheck ...test-d.ts` → exit 1、3 failed（TS2339×3 + TS2344×1 实报）；`tsc -p tsconfig.typecheck.json --noEmit` → exit 2、全仓仅 4 错全在该文件 | 低 |
| 8 | 既有全部 fake handle fixture 均提供 release 函数——V1 增补 release 形状守卫（D10）零回归 | 设计期实测验证（grep，2026-08-25） | `git grep -n "release:" packages/namespace-runtime/test` → 8 处（close-lifecycle/mutate-root-sequencer/mutate-root-sa7-dynamic/mutate-root-snapshotter-array/replace-schema-sequencer/replace-schema-sa7-dynamic/write-fatal-message-rev1 全含 `release:` 函数成员）；其余测试经真实 `createMemoryPersistence.createDoc/loadDoc` 签发 handle（实现 release） | 低 |
| 9 | handle `getStatus()` 在 ready 期 throw 时 buildStatus 原样传播（既有 loud 契约）——本设计仅对 closing/closed 期短路该观察 | 源码引用 | `status.ts:12-14`（「handle.getStatus() 自身 throw → 原样传播（adapter bug，loud）」既有头注释与实现）；短路分支仅在 lifecycle≠ready 时跳过观察（D6），ready 期路径逐字节不变 | 低 |

---

## §13. 契约改动连锁审计 (Contract Change Caller Audit)

### 改动函数/类型

| 函数/类型 | 文件 | 改动前契约 | 改动后契约 |
|---|---|---|---|
| `NamespaceRuntime`（接口） | `packages/namespace-runtime/src/runtime.ts:59` | 九键；`read: (path) => ReadLogicalValueResult` | **十键**（+`close: () => Promise<void>`，加法）；`read` 返回宽化 `NamespaceRuntimeReadResult`（加法联合分支） |
| `NamespaceRuntimeStatus`（接口） | `packages/namespace-runtime/src/status.ts:25` | 六键；`lifecycle: 'ready'` 单值 | 七键（+`close`）；`lifecycle: 'ready' \| 'closing' \| 'closed'` 三态 |
| `NamespaceRuntime.read`（方法返回型） | runtime.ts:65 | ready 期透传 `ReadLogicalValueResult` | 同前 + lifecycle≠ready 期返回 `RuntimeReadDisabledResult`（ok:false / code:'RUNTIME_READ_DISABLED'——**非抛、非降级 null**，走同步结果联合） |
| `captureSeamInput`（V1 守卫） | runtime.ts:170 | 校验 handle 的 getStatus/owner/docId/doc 形状 | **新增一条 throw 路径**：`typeof handle.release !== 'function' → TypeError`（构造栈同步 throw，零副作用——INV-N4 家族既有 throw 契约的扩展） |
| `RuntimeState`（接口） | p0.ts:35 | 六字段 | +`lifecycle`（必填，构造初始化 'ready'）+`closeIssue?`+`closeCause?`（内部类型，不出公共面） |
| `buildStatus`（函数） | status.ts:38 | 签名 `(handle, state) => NamespaceRuntimeStatus`（六键） | 签名不变；产物七键；行为增量：closing/closed 期短路 handle 观察 + 三能力位恒 false |
| 新增 `close`/`runCloseBarrier`/`NamespaceRuntimeCloseError`/常量 | close.ts / errors.ts | — | 新函数/新类/新常量（无既有 caller——纯增量，无连锁） |

**无「return→throw」「sync→async」「swallow→rethrow」类翻转**：唯一新 throw 路径在 captureSeamInput（构造守卫家族，本就 throw 语义）；`read` 新分支是联合加法（原两分支逐字节不变）；`buildStatus` 签名不变。

### Caller 清单

**A. `createNamespaceRuntimeWithSeam` / `captureSeamInput` 的 caller（V1 新 throw 路径审计）**

| Caller | 文件:行号 | 是否 await | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---|---|---|---|---|
| 包内生产工厂 | `src/runtime.ts:163`（createNamespaceRuntime → seam） | 同步调用 | ❌ 裸调用（throw 即向 Registry 上层传播——构造 throw 契约预期） | N/A（构造错误本就同步 throw：NamespaceRuntimeConstructionError 同款） | 无需处置：真实 handle（contract.ts:16-30）恒有 release 函数 |
| 测试 ×14 文件 | `test/runtime-close-lifecycle.test.ts:144`、`runtime-public-surface-ownership.test.ts:92/129`、`runtime-sync-read-face.test.ts:87`、`runtime-p0-sequencer.test.ts:90` 等（`git grep -l createNamespaceRuntimeWithSeam` 全集 14 test 文件 + 2 src） | 同步调用 | 部分构造失败用例显式 `expect(...).toThrow()`（ownership:121） | 无 | 零处置：§12 #8 grep 实证全部 fake handle 提供 release 函数；真实 handle 由 persistence 实现 |

**B. `runtime.read` 的 caller（返回联合宽化审计）**

> 三栏判定说明：`read` 是同步函数且改动是**联合加法**（不新增 throw/不异步化），「是否 await / try/catch / catch-all」三栏对其不适用（N/A）——审计轴改为编译兼容性；触发三栏硬审计的 throw 类改动仅 captureSeamInput（表 A）与 closePromise rejection（表 D），两表均含三栏。

| Caller | 文件 | 用法形态 | 编译兼容性 |
|---|---|---|---|
| `readValue` helper ×6 文件 | mutate-root-sequencer:109 / write-fatal-message-rev1:106 / replace-schema-persistence:60 / replace-schema-sequencer:129 / mutate-root-snapshotter-array:79 / mutate-root-sa7-dynamic:55 | `if (!read.ok) throw; read.value` | ✅ 判别联合窄化后 `.value` 仅在 ok:true 分支（新分支 ok:false 不参与） |
| 直接调用 ×5 文件 | sync-read-face:93/152/157（`if (!read.ok) ... read.code`）、p0-sequencer:154-157/166/234、close-lifecycle（ok 断言）、boundary-supplementary:90/127（`toEqual({ok:true,value})`）、public-surface-ownership:168 | 全部经 `if (read.ok)`/`if (!read.ok)` 判别后访问 `.value`/`.code` | ✅ 新分支与既有 ok:false 变体结构同族（code/path/message 均存在）；`toEqual({ok:true,...})` 场景全在 ready 期（gate 不分流，产物逐字节不变） |
| 生产代码 | 无（包外零消费者——`git grep @nomicore/namespace-runtime` 仅命中本包 src/test） | — | ✅ 无下游连锁 |

**C. `runtime.getStatus()` 的 caller（lifecycle 三态 + 第七键审计）**

> 三栏判定说明：同表 B——同步函数、类型联合加法、零 throw 路径变化（closing/closed 期短路 handle 观察反而**减少**了一处可抛点），三栏 N/A。

| Caller | 文件 | 用法形态 | 兼容性 |
|---|---|---|---|
| 测试 ×14 文件 | 所有 runtime 测试（`.schema.state` / `.read.enabled` / `.fatal` / `.lifecycle`） | `lifecycle` 断言仅 `runtime-p0-sequencer:99` 与 `public-surface-ownership:141`（均 `toBe('ready')`，未 close 场景） | ✅ 三态联合下 'ready' 断言仍真；无任何 exhaustive switch/收窄依赖单值 |
| 生产代码 | `src/runtime.ts:140`（唯一 getStatus 挂接点） | buildStatus 签名未变 | ✅ |

**D. `sequencer.enqueue` 的 caller（barrier 挂接审计——closePromise rejection 连锁）**

| Caller | 文件:行号 | 是否 await | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---|---|---|---|---|
| P0 入队 | `src/runtime.ts:129` | 否（`void` 丢弃完成信号） | N/A——runP0 全 catch（INV-N12，永不 reject） | sequencer 链尾 noop（sequencer.ts:40） | 零新增风险（#89 既有） |
| mutateRoot 写槽 | `src/runtime.ts:144`（D5.1 改后） | 是（返回给公共调用方） | 否——槽结果/fatal rejection 经返回 Promise 送达调用方（#90 契约） | sequencer 链尾 noop | 零新增（#90 既有） |
| replaceSchema 写槽 | `src/runtime.ts:149`（D5.1 改后） | 是（同上） | 否（#91 契约） | sequencer 链尾 noop | 零新增（#91 既有） |
| close barrier（**新增**） | `src/runtime.ts` close 键（D2） | 是（closePromise 缓存并返回给公共调用方） | 否——**有意**：barrier rejection 就是 close 的契约结算（AC7「失败时 close Promise reject」），catch 它等于吞掉契约 | sequencer 链尾 noop（队列对 barrier rejection 免疫） | rejection 送达调用方（R1 风险登记：unhandled 属调用方责任，与 fatal rejection 同款 API 契约）；同一 promise 缓存保证重复 close 不产生新 rejection 通道 |

### 风险评估

- **遗漏 caller 的代价**：`read` 联合宽化若漏列消费者 → 潜在编译断点；`captureSeamInput` 新 throw 若漏列构造点 → 潜在测试红。抓取命令与结果：`git grep -ln "createNamespaceRuntimeWithSeam" packages/ apps/ domains/ tests/`（16 文件：2 src + 14 test，全部列入上表）；`git grep -n "\.read(" packages/namespace-runtime/test`（§13-B 全集）；包外零消费者（`git grep -l "@nomicore/namespace-runtime"` 仅本包命中）。
- **最大风险点**：无（全部为加法扩展或不可达分支；唯一行为收窄——closing/closed 期 read/write 停接纳——正是本任务验收目标，由 SA6 红灯锚正向锁定）。
