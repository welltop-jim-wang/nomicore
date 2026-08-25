# issue #93 round 2 修订设计 — 公共面收口、生产装配、fatal 边界与停接纳扩展（rev1）

- 任务：nomicore issue #93 修订轮（round 2），run_id `issue-93-1787626988-603033`，PR #114 双轴人工评审 5 项 merge-blocking + 2 项建议逐项修复。
- 设计者：SA1。对象包：`packages/namespace-runtime`（主）+ `packages/doc-runtime/src/schema-replace.ts`（单文件）。
- 前置门禁：SA8 Phase 0 verdict `clear-with-adjudications`
  （`wiki/raw/task_namespace-runtime-integration-acceptance-rev1_conflict_report.md`，裁决 A–F + G/H/I）。
  本文全部契约在「SA1 设计约束清单」7 条边界内；每条 D-x 标注对应裁决编号与评审项号。
- 基准文档：ADR-0007 / ADR-0008 全文（已读）、`wiki/raw/task_namespace-runtime-integration-acceptance-rev1_relevant_decisions.md`（已读）、CONTEXT.md 停接纳词条（L75–77）、TASK.md。
- 事实核查源（全部已读）：`packages/namespace-runtime/src/{index,runtime,projection,write,schema-write,p0,errors,status,close,sequencer}.ts`、
  `packages/doc-runtime/src/{schema-replace,fatal}.ts`（及 replace/materialize/mutation 的 E200/E205 catch 边界）、
  涉事测试锚全文（exports-audit / close-lifecycle / public-surface-ownership / fullchain / boundary-supplementary / sa7-dynamic / materialize-root-rev2:357-394 / p0-sequencer / sync-read-face / metadata-proto-key / snapshotter-array）、`packages/namespace-runtime/package.json`。

## §0. 输入、约束与死锁检查

### 0.1 评审项 → 设计契约映射

| 评审项 | 级别 | 设计契约 | SA8 裁决 |
|---|---|---|---|
| 1 testing seam 公共面泄漏 | High/阻断 | D-1 | A + G |
| 2 生产装配路径端到端缺失 | High/阻断 | D-5 | E① |
| 3 pre-commit fatal 真实持久化全链缺失 | Medium/阻断 | D-6 | E② |
| 4 close 后三 getter 仍可读 | High/阻断 | D-2 | B + H |
| 5 未知 preparation 异常未 fatal 化 | Medium/阻断 | D-3 | C |
| 6 非法 SCHEMA 载体静默映射 null | 建议 | D-4 | D |
| 7 walker 重复漂移 | 建议 | D-7 | F |

### 0.2 SA8 约束清单遵从声明（逐条）

1. 公共面（A/G）→ D-1 全部兑现；`package.json` exports 键集维持 `{"." : "./src/index.ts"}` 不变（已核实现状恰此一键）。
2. close 停接纳（B/H）→ D-2 全部兑现；CONTEXT.md 词条修订文字见 §2.7。
3. schema-replace 边界（C）→ D-3 兑现；**资源极限例外整体撤销**（闭环论证见 §3.2——SA8 授权的两条路之一）；replace.ts / materialize.ts / mutation.ts 零改动。
4. 载体分流（D）→ D-4 兑现；p0 模式终点恒 unavailable（机械保证见 §4.4）。
5. 测试形态（E）→ D-5/D-6 兑现；两形态分立测试文件（§5.4 落点裁决）。
6. walker 共享（F）→ D-7 兑现；共享原语层、不统一遍历器。
7. 文档对齐（AC7）→ ADR 0008 正文**零改动**（新码 NSRT-SCHEMA-E2 落 errors.ts，归属条款 L125；新 DOCRT-E206 落 doc-runtime 侧惯例注册——doc-runtime 码注册即「码定义处」，同条款哲学）；CONTEXT.md 仅停接纳词条修订。

### 0.3 死锁检查

**无死锁。** 7 条约束两两相容性逐一核对：D-1 的 import 路径切换与 D-5 的包内生产工厂导入互不冲突（前者 `../src/runtime.js` 消费 seam，后者同文件消费 `createNamespaceRuntime`）；D-2 的 getter 门禁（key 仅 lifecycle）与 D-4 的载体分流（ready 期才可达投影）正交；D-3 撤销 E200 例外与 ADR-0007 L54 经 SA8 C 明文裁定相容（零写入仍成立）；D-7 的原语层不动两 walker 语义，不与 F-3/snapshotter 锚冲突。唯一潜在张力（D-2 与 CONTEXT 词条现行文字）已由 SA8 B 裁定为词条修订义务（AC7），非约束冲突。

---

## §1. D-1 公共面收口：testing seam 撤出公共入口（评审项 1；裁决 A/G）

### 1.1 目标与不变量

AC6：公共 exports 不暴露包内 detached/testing seam（seam 输入类型 `NamespaceRuntimeSeamInput` 字段引用 `DocHandle`——值与类型必须一并撤出，否则公共类型面仍暴露 DocHandle，即裁决 G 点名对象）。
ADR-0008 L91「测试通过**包内**确定性 seam 注入」——「包内」机械含义 = 包内模块通道（相对路径导入），**不是**子路径 export。不新增 `"./testing"` 键（private:true 无包外消费方，子路径没有任何兑付对象，只留下须维护的公共契约）。

### 1.2 index.ts 精确新公共面

**值导出恰一键**：

```ts
export { RuntimeWriteFatalError } from './errors.js';
```

**类型导出保留清单（恰 11 个，与裁决 G 清单逐一对应）**：

```ts
export type {
  NamespaceRuntime,
  NamespaceRuntimeReadResult,
  RuntimeReadDisabledResult,
} from './runtime.js';
export type { NamespaceRuntimeStatus } from './status.js';
export type { ActiveSchemaInfo } from './p0.js';
export type { RuntimeWriteFatalPhase } from './errors.js';
export type { RootMutationIssue, MutateRootResult } from './write.js';
export type { ReplaceSchemaInput, SchemaReplacementIssue, ReplaceSchemaResult } from './schema-write.js';
```

**删除项（仅两处）**：
- 第 17 行 `export { createNamespaceRuntimeWithSeam } from './runtime.js';`（值）；
- 类型导出块中的 `NamespaceRuntimeSeamInput`（类型）。

运行时可探测键集从 `['RuntimeWriteFatalError', 'createNamespaceRuntimeWithSeam']` 收缩为 `['RuntimeWriteFatalError']`（类型导出无运行时存在——exports-audit 的 `Object.keys` 探测天然只看值导出）。

### 1.3 seam 撤出方式（runtime.ts 零语义改动）

`createNamespaceRuntimeWithSeam`（runtime.ts:134）与 `NamespaceRuntimeSeamInput`（runtime.ts:52）**保留 runtime.ts 模块级导出，逐字节不动**。生产工厂 `createNamespaceRuntime`（runtime.ts:240-245）同样不动。唯一改动是 index.ts 不再 re-export seam。测试改经包内相对路径 `'../src/runtime.js'` 消费（与 D-5 的生产工厂导入同通道，文件内可同时出现两 import）。

### 1.4 index.ts 头注「公共面纪律」段落新文字

```
 * 公共面纪律（AC1/AC2/AC6/AC9 锚定；issue #93 round 2 收口）：
 * - 值导出恰一键：RuntimeWriteFatalError（ADR-0008 点名的稳定 rejection 形状——
 *   instanceof 判别 committed/phase 是上层「不得自动重试非幂等写」纪律的依赖面）；
 * - 测试 seam（createNamespaceRuntimeWithSeam + NamespaceRuntimeSeamInput）与生产
 *   工厂 createNamespaceRuntime 一并保留包内（runtime.ts 模块级导出，ADR-0008
 *   「测试通过包内确定性 seam 注入」「生产工厂保留包内」——「包内」= 包内模块通道
 *   相对导入，不经本入口，亦不设 ./testing 子路径 export）；本入口对二者零
 *   re-export——seam 输入类型含 DocHandle，随值一并撤出公共面（AC6 点名对象）；
 * - 不导出 WriteSequencer / 运行态；构造/投影错误类别仍不导出（code+message
 *   字符串消费）；
 * - handler/Y.Doc/sequencer 永不从本入口出现；mutateRoot 是 runtime 面方法而非模块级导出。
```

### 1.5 测试 import 路径切换（19 个文件中的 18 个值导入）

机械改动：`import { createNamespaceRuntimeWithSeam } from '../src/index.js'` → `from '../src/runtime.js'`。**不改任何行为断言。** 全量清单（文件:行）：

| # | 文件:行 | 备注 |
|---|---|---|
| 1 | metadata-proto-key.test.ts:29 | 纯 seam 值导入 |
| 2 | runtime-acceptance-degraded-two-adapter.test.ts:34 | 纯 seam 值导入 |
| 3 | runtime-acceptance-fullchain.test.ts:36 | **拆分**：`RuntimeWriteFatalError` 留 index，seam 移 runtime.js |
| 4 | runtime-boundary-supplementary.test.ts:24 | 纯 seam 值导入 |
| 5 | runtime-close-lifecycle.test.ts:34 | **拆分**：同 3 |
| 6 | runtime-close-sa7-dynamic.test.ts:27 | 纯 seam 值导入 |
| 7 | runtime-mutate-root-persistence.test.ts:36 | 纯 seam 值导入 |
| 8 | runtime-mutate-root-sa7-dynamic.test.ts:27 | **拆分**：同 3 |
| 9 | runtime-mutate-root-sequencer.test.ts:65 | 纯 seam 值导入 |
| 10 | runtime-mutate-root-snapshotter-array.test.ts:45 | 纯 seam 值导入 |
| 11 | runtime-p0-sequencer.test.ts:43 | 纯 seam 值导入 |
| 12 | runtime-public-surface-ownership.test.ts:55 | **拆分**：保留 `import * as publicEntry from '../src/index.js'`（审计探测面） |
| 13 | runtime-replace-schema-persistence.test.ts:39 | 纯 seam 值导入 |
| 14 | runtime-replace-schema-sa7-dynamic.test.ts:41 | **拆分**：同 3 |
| 15 | runtime-replace-schema-sequencer.test.ts:74 | 纯 seam 值导入 |
| 16 | runtime-sync-read-face.test.ts:38 | 纯 seam 值导入 |
| 17 | runtime-write-fatal-message-rev1.test.ts:40 | **拆分**：同 3 |
| 18 | runtime-acceptance-exports-audit.test.ts:18 | 特殊：`import * as publicEntry` 不变，断言改锚（§9.1） |

2 个仅类型导入文件（runtime-close-lifecycle-type-guard.test-d.ts:29、runtime-replace-schema-type-guard.test-d.ts:22）只导入 `NamespaceRuntime` 类型——公共面保留项，**零改动**。已核实：`NamespaceRuntimeSeamInput` 在测试中无类型导入（仅 public-surface-ownership.test.ts:24 注释提及，注释随 §9.2 更新）。

---

## §2. D-2 close 停接纳扩展至三个数据投影 getter（评审项 4；裁决 B/H）

### 2.1 目标与裁决要点

ADR-0008 L93「首次调用同步进入 closing，**立即停止接纳公共 read 和 write**」；L28–32 把 `getSchemaEnvelope / getMetadata / getActiveSchema` 明文归入「## 读取能力」节——它们是公共 read 的组成部分。三个 getter 在 lifecycle ≠ ready（closing/closed）时同步 loud 拒绝；`getStatus` 明文保留全生命周期可用（生命周期/能力观测面，close 生命周期自身依赖它观察 closing/closed 与 close 摘要——既有锚 close-lifecycle:191/210/222/354）。

**三条硬边界（SA8 B）逐条兑现**：
1. 门禁 key **只有** `state.lifecycle !== 'ready'`——绝不 keyed on fatal / schemaState / handle 状态（裁决 H：fatal 期 getter 照常——ADR-0008 L81–87「保留读取」；unavailable/preparing 期 getter 照常——p0-sequencer:196 已有 unavailable 期 `getSchemaEnvelope()` 投影锚、sync-read-face:97 已有 preparing 期 `getActiveSchema()` null 锚，两者原样绿）。
2. 拒绝必须发生在触碰 live Y.Doc **之前**（与 read() 停接纳分支同款纪律）。
3. closing 期排空观察期内 `getStatus` 持续可用（既有排空锚依赖，不动）。

### 2.2 门禁位置（精确到方法体）

runtime.ts 十键闭包对象（runtime.ts:183-231）的三个 getter 方法体**首行**——公共面层，先于一切投影/state 读取：

```ts
getSchemaEnvelope: () => {
  // D2（#93 rev2，SA8 裁决 B）：数据投影 getter 停接纳——key 仅 lifecycle（裁决 H：
  // 绝不 keyed on fatal/schemaState）；拒绝先于触碰 live Y.Doc（INV 同 read() 分支）
  if (state.lifecycle !== 'ready') {
    throw new RuntimeReadDisabledError('getSchemaEnvelope', state.lifecycle);
  }
  return projectSchemaEnvelope(doc, 'public');
},
getMetadata: () => {
  if (state.lifecycle !== 'ready') {
    throw new RuntimeReadDisabledError('getMetadata', state.lifecycle);
  }
  return projectMetadata(doc);
},
getActiveSchema: () => {
  if (state.lifecycle !== 'ready') {
    throw new RuntimeReadDisabledError('getActiveSchema', state.lifecycle);
  }
  return state.activeInfo ?? null; // D8：preparing/unavailable/fatal 期 null 照常
},
```

`owner` / `namespaceId` 是构造期冻结的身份投影（非数据读取），`read()` 走既有结果联合（runtime.ts:186-194 不动），`getStatus` 完全不动（status.ts 零改动）。

### 2.3 拒绝形状与包内类落点裁决

**落点裁决：errors.ts 新建包内类 `RuntimeReadDisabledError`，不从 index.ts 导出。**
理由（对照先例）：现有类各绑定单一用途稳定码——`SchemaProjectionError`=NSRT-SCHEMA-E1（值域）、`MetaProjectionError`=NSRT-META-E1/E2（值域/载体双码）、`NamespaceRuntimeCloseError`=NSRT-CLOSE-RELEASE-FAILED（close 域）。复用任一现有类都会错置域且码不符（生命周期拒绝 ≠ schema 投影失败）。新建类沿 `NamespaceRuntimeConstructionError`/`NamespaceRuntimeCloseError` 先例：类不导出、code+message 字符串消费。

```ts
// errors.ts 追加（append-only 注册表——ADR-0008 L125 归属条款）
/** closing/closed 期数据投影 getter 停接纳错误（#93 rev2，SA8 裁决 B）：同步 loud
 *  throw 稳定码 RUNTIME_READ_DISABLED——getter 返回类型非结果联合（ADR-0008 L30-32
 *  冻结），生命周期拒绝复用 read 域停接纳码族（L117 已注册）+ getter 域 message
 *  文案（L119「区分域靠 message 文案，不另设新码」的码族纪律）。类不导出。 */
export class RuntimeReadDisabledError extends Error {
  readonly code = RUNTIME_READ_DISABLED_CODE; // 'RUNTIME_READ_DISABLED'（errors.ts:49 既有常量）

  constructor(
    getter: 'getSchemaEnvelope' | 'getMetadata' | 'getActiveSchema',
    lifecycle: 'closing' | 'closed',
  ) {
    super(
      `${RUNTIME_READ_DISABLED_CODE}: ${getter} 已停接纳——Runtime lifecycle 为 ${lifecycle}` +
        '（close 已停止接纳公共数据投影读取）；本调用不触碰 live Y.Doc',
    );
    this.name = 'RuntimeReadDisabledError';
  }
}
```

形状要点：
- **同步 loud throw**（getter 本就是 sync；非 Promise、非结果联合——为 getter 增设联合分支 = 修订 ADR-0008 L30–32 冻结的返回类型，超出评审项 4 要求，SA8 B 明文排除）。
- **稳定码** `RUNTIME_READ_DISABLED`：read() 停接纳（L117）已注册的 read 域码族；getter 拒绝复用该码族 + message 区分域（L119 纪律）。
- **message 分 getter 域 + lifecycle 值**：插值仅来自两个闭集（getter 名三值、lifecycle 两值）——模板恒定，稳定可锚。
- **不返回静默 null**：null 已被「载体缺席」语义占用（D-4），混用即虚假降级。
- **零触碰 live Y.Doc**：门禁在 `projectSchemaEnvelope(doc, …)` / `projectMetadata(doc)` 之前；getActiveSchema 不触 doc（仅闭包 state）。
- getter 面已有 loud 通道先例：NSRT-SCHEMA-E1 / NSRT-META-E1/E2 稳定码 throw 与 F-3 锚的原始 RangeError（SA8 B 排除法引用）——本通道是该词汇纪律内的最小新形状。

### 2.4 fatal 期照常（负向锚）

fatal 置位不改 `state.lifecycle`（仍 'ready'）→ 三 getter 照常。既有锚已锁：runtime-replace-schema-sa7-dynamic.test.ts:378-379（E204 fatal 后 `getSchemaEnvelope()?.id === 'ns-1'`、`getActiveSchema()?.id === 'ns-1'`）原样绿；本设计另加显式负向锚 T2.3（§8）。

### 2.5 runtime.ts 接口 JSDoc 同步修订

`NamespaceRuntime` 接口三个 getter 的 JSDoc（runtime.ts:89-94）追加一行（示例）：
`lifecycle≠ready（closing/closed）期同步 throw RuntimeReadDisabledError（code RUNTIME_READ_DISABLED，包内类）——close 停接纳覆盖全部公共数据投影；getStatus 不受影响（全生命周期观测面）。`
十键注释块（runtime.ts:16-22）「read/write 接纳门（lifecycle gate）住在公共方法层（D4/D5.1）」句扩为「read/write **与三数据投影 getter** 的接纳门（lifecycle gate）住在公共方法层」。

### 2.6 门禁先于投影的可观测证明（对抗锚）

F-3 先例复用：cyclic META 值 + closed 期调 `getMetadata()` → 收到 `RuntimeReadDisabledError`（code RUNTIME_READ_DISABLED）而非原始 RangeError——证明门禁先于深拷贝递归（零触碰 live Y.Doc 的行为证据）。锚 T2.5（§8）。

### 2.7 CONTEXT.md 停接纳词条修订（AC7 义务；SA8 B ③ 逐字方向）

**旧文（L75-77，删去末句「四个观测/投影 getter……不在停接纳范围」与旧 _Avoid_ 第三分句）→ 新文：**

```
**停接纳（stop-acceptance）**:
close 首次调用同步进入 `closing` 后，capability 槽立即停止接纳新调用：read 同步结果联合返回 `RUNTIME_READ_DISABLED` 分支（lifecycle 失败不是路径缺陷，不借用路径失败码）；三个数据投影 getter（getSchemaEnvelope / getMetadata / getActiveSchema）与 read 同属停接纳范围——同步 loud throw 稳定码 `RUNTIME_READ_DISABLED`（getter 返回类型非结果联合，拒绝通道为 throw；message 区分 getter 域与 lifecycle 值）；mutateRoot/replaceSchema 经 Promise settle 含 `RUNTIME_WRITE_DISABLED` 的零写入结果——该码与 fatal 后排队写、写前 writable gate（handle 非 ready：persistence-degraded / released / disposed）、notifyDirty 未绑定共用同一码族，message 文案区分域；close 前已接纳任务仍无条件排空。internal fatal 只永久禁写并保留读取，不触发 read/getter 停接纳。getStatus 全生命周期可用（生命周期观测面，非数据投影），不在停接纳范围。
_Avoid_: 把 lifecycle 失败伪装成路径失败码、把停接纳误解为取消已接纳任务、把停接纳误读为 getStatus 不可用
```

_Avoid_ 行收窄：第三分句「观测 getter 不可用」→「getStatus 不可用」（三数据投影 getter 现已在停接纳范围内，「误读为不可用」不再成立）。

---

## §3. D-3 schema-replace 未知异常 fatal 化——判别器闭环与整体撤销（评审项 5；裁决 C）

### 3.1 目标

`packages/doc-runtime/src/schema-replace.ts` `prepareSchemaReplace`（:136-208）现行 catch 末段（:202-206）把 `DerivedInvariantError` sentinel 之外的一切意外异常降级为 `DOCRT-E200 ok:false`——内部 bug（TypeError 等）伪装成调用方领域失败、Runtime 保持可写，正是 A4 红线（sa7-dynamic:365 锚已为 sentinel 裁定禁止）的分级漂移类推。评审项 5 要求未知内部异常成为 `DocRuntimeFatalError('pre-commit-internal', committed:false)` 并触发写禁用。

**改动半径（SA8 C 硬边界）**：只动 schema-replace.ts 的 catch 分级、其头注与单元锚；schema-write.ts / write.ts / p0.ts 的 fatal 机械零改动（透传通道已存在：schema-write.ts:167-174 `instanceof DocRuntimeFatalError` → `rejectWithWriteFatal(env, err.committed, err.phase, err, 'schema')` → `RuntimeWriteFatalError(phase='pre-commit-internal', committed=false)` → 永久禁写保读）；replace.ts / materialize.ts / mutation.ts 零改动。

### 3.2 判别器闭环论证（SA8 C 的必答题）

SA8 C 给出两条路：①保留「可判别资源极限」例外，判别器须确定性且 SA2 可对抗审查（禁止宽泛 `instanceof RangeError`——`new Array(-1)` 同抛 RangeError）；②无可靠判别器则例外整体撤销。**本设计选择 ②：例外整体撤销。** 论证如下。

#### 3.2.1 候选判别器逐一排除

**候选一：消息特征**——`err instanceof RangeError && err.message === 'Maximum call stack size exceeded'`。
否决理由：该字符串是 V8 的**引擎实现细节**，非 ECMAScript 契约。判别器的正确性依附于 Node/V8 当前消息目录：任何引擎升级改写该文案，都会把「深输入 → E200 领域失败」静默翻转成「深输入 → fatal 永久禁写」——恰好是该例外存在要防止的回归。即使配 canary 测试（真溢出用例），漂移也只能在 CI 变红**之后**被发现，判别器自身不闭合。SA2 可对抗审查的标准是「确定性判据」，一个引用外部未契约化字符串的判据不满足。

**候选二：抛点帧特征**——检查 `err.stack` 顶部帧属于 extract/build 递归函数。
否决理由：栈溢出时 V8 截断 stack trace（溢出本身的产物），帧信息不可靠；`Error.prepareStackTrace` 覆写、stack 缺失等形态使其非确定。SA8 列为候选族但同等不达「确定性」门槛。

**候选三：深度先验**——catch 内用迭代式（显式栈）测量输入深度，深度超阈值且异常为 RangeError → E200。
否决理由：引擎独立但机械代价不成比例：(a) 需要一个对 Yjs 容器（Y.Map/Y.Array/Y.XmlFragment 嵌套）与 plain snapshot 双域的**溢出免疫深度行走器**——为 catch 分级新写一段有自身 bug 面的遍历代码；(b) 引入魔法阈值（无客观定标）；(c) 探针自身失败（如遇敌意载体）还需 fallback 策略（保守 fatal——则探针在最难案例上失效）。而为判别器所保护的「深输入溢出直达 catch」场景，经 R2 事实核对（§3.2.2 修正 2）本就已被 extract/validate 自有边界吸收为领域级失败——例外的实际保护面进一步收窄到「未来新增无边界组件的溢出」，为它引入三层新机械违背「分级权归捕获位置、判据最小化」的包哲学。

**输入伪造面补查（任一判别器的共同弱点）**：doc-runtime 直接调用方可传带 getter 陷阱的 derived/envelope，陷阱内 `throw new RangeError('Maximum call stack size exceeded')` 可命中任一消息/形状判别器。经 Runtime 公共面不可达（快照器拒类实例、envelope 四值型守卫先掷 schema-compile-throw），但 doc-runtime 是独立公共包——判别器把它误分为 E200 的面是永久的。

#### 3.2.2 撤销的代价审计（R2 整体改写——SA2 R1 攻击点 #1 MUST：R1 版「keep-root 的 doc 深度由既往全部经受控写入建立（每笔都过快照闸）」为虚假前提，本节按事实重写；撤销方向不变，载荷论证重建）

- **【R2 事实修正 1：前置闸的真实作用域】** snapshotter 前置闸（write.ts S3 `snapshotMutation` → copyFrozen）只冻结**调用方输入** `{schema, root?}`，从不遍历 live Y.Doc——其保证仅覆盖 **provide-root 的公共面输入深度**（该面论证成立，SA2 R1 §0 已独立复核：write.ts:247-256 整体 catch，栈溢出同收编为 `MUTATION_INPUT_NOT_PLAIN_DATA`）。**doc 的源深度不受任何前置闸约束**：`createDoc` 接受任意深度预构建 Y.Doc（本设计 §11 第 3 行自认「含任意顶层条目形态」；fullchain:57-72 makeDoc 即绕过快照闸直建初始内容的实例），`loadDoc` 仅校验 `META.docId`（ADR-0006 #64 修订节）。R1 的「残余可达面 = 递归帧成本差边际带」一句**撤回**（其前提为假；SA8 裁决 C 的授权论证引用了同款前提——本设计按事实修正载荷论证；方向裁决本身不依赖该前提，依据是 §3.2.1 判别器闭环 + 下述修正 2/3 的真实可达面）。
- **【R2 事实修正 2：深 doc × keep-root 的真实落点——比 SA2 R1 §1.1 推演链更早被吸收】** keep-root 分支 ①d（schema-replace.ts:158-164）的两个递归组件**各自拥有全函数体崩溃边界**：`extractYjsSnapshot`（extract.ts:52-80，INV-6「绝不外抛」——`walk` 递归溢出被自身 catch 收敛为 `DOCRT-E100` ok:false issues）与 `validateLogicalSnapshot`（vfsl validate.ts `interpret` 全函数体 try/catch :598-646——`validateValue` 递归溢出收敛为 `VFSL-E100` / 工作预算耗尽 ok:false issues）。因此**真实深 doc 的 keep-root 栈溢出在到达 prepare 的 catch 之前就被这两层自有边界吸收为领域级 ok:false**——不产生 E206、不 fatal、Runtime 保持可写、**provide-root 修复通道不锁死**（深损坏 doc 的原地修复路径保持开放——T3.4 新锚把它从不可观测变为 SA7 可验）。哪一层先吸收（extract 还是 validate）取决于两者每层帧成本与引擎栈容量之比——**非契约面**，T3.4 断言按「任一 E 层吸收」书写（§8）。
- **【R2 事实修正 3：E206 在 keep-root 分支的可达面 = 结构性空集】** keep-root prepare 体内全部可抛组件盘点：extract/validate（自有边界，不外抛）、`probeSchemaMap` 第五态（公共 API 造不出，schema-replace.ts:260）、`envelopeShapeIssue`（纯 `Object.keys`/`typeof` 元数据读；经公共面 envelope 恒为真实 compile 冻结产物，Proxy 陷阱不可达）。故 **keep-root 分支的 catch 覆盖是纯纵深防御**——为未来可能新增进 prepare 的无边界组件兜底：任何未来逃逸异常按本设计一律 fatal（保守方向的有意识选择，决策记录见 §3.2.3）。E206 的真实可达触发面 = **provide-root 的 `buildTopEntries` 裸 throw**（手造派生物——δ/T3.1 锚；经公共面 compile 为真实产物同样不可达，seam/doc-runtime 直接调用方可达）+ doc-runtime 直接调用方的垃圾输入。
- **E206 触发面内的后果**：`DocRuntimeFatalError('pre-commit-internal', committed:false)` → 零写入仍字面成立（ADR-0007 L54「doc 状态不因本调用改变」——撤销不违反 ADR，SA8 C 明文）；Runtime 写禁用、读保留（ADR-0008 fatal 通道语义）。过报方向 = ADR「未知异常保守视为」钦定的保守方向。
- **E200 分支无合法领域流量**：prepare 的全部领域失败（envelope 形状 ①b、SCHEMA 载体探针 ①c、validate/build issues ①d、ROOT 载体 ①d'）都以 `{kind:'fail', issues}` **返回**、不经 catch；catch 只承接真意外异常（sentinel、裸 throw、探针第五态——公共 API 造不出）。已核实 E200 在 schema-replace 的现存锚面：**零**（doc-runtime 无 replaceSchemaAndRoot 直接单测；namespace-runtime 侧 sa7-dynamic 仅在注释中以「非 E200」表述 A4 红线）。该分支是纯误分级桶，删除无行为回归。
- **评审对齐**：评审项 5 原文要求「未知 schema preparation 异常必须进入 fatal」——撤销是逐字兑现；保留例外反而是评审未要求的 carve-out。

**闭环结论：选 ②。** catch 命中除 `DerivedInvariantError` 外一律 `DocRuntimeFatalError('pre-commit-internal', false)`。

#### 3.2.3 有意识决策记录（R2 增补——SA2 R1 攻击点 #1.3）

撤销例外的**接受面**（明示，非默认继承）：

1. **provide-root × 手造派生物裸 throw（δ 面）→ E206 fatal → 该实例永久禁写**（旧 E200 下为 ok:false 可重试）。接受理由：A4 红线类推（internal 缺陷不得伪装领域失败，sa7-dynamic:365 已为 sentinel 裁定同类红线）+ 评审项 5 逐字要求 + 该面经 Runtime 公共面结构性不可达（真实 compile 产物不触发 buildTopEntries 裸 throw）——受害面限于 seam 注入与 doc-runtime 直接调用方的垃圾输入。
2. **未来任何新增进 prepare 的无边界代码若逃逸异常 → 一律 fatal（保守方向的有意识默认）**。代价：逃逸即锁写（含该实例的修复通道）；收益：internal bug 永不静默降级为「可重试领域失败」——与 ADR-0008「未知异常保守视为」方向一致。**今天**该纵深防御在 keep-root 分支无可达触发（§3.2.2 修正 3），在 provide-root 分支的可达触发即第 1 条。
3. **与 CONTEXT「载体投影读取」词条既有排除声明对齐**：该词条已声明「持久化文件被其他程序错误修改不在运行时读取契约范围内」——本轮对称声明**写面**边界：跨程序损坏/超深文件的「任意形态写修复」不在本轮保护面。本轮承诺的写面行为是：(a) 损坏/超深 doc 上的 keep-root 得到**结构化领域失败**（extract/validate 自有 E 层吸收——零写入、Runtime 保持可写、可改走 provide-root 修复，T3.4 锚定）；(b) 未知逃逸异常得到 loud fatal（T3.1 锚）。除此之外不承诺「任何损坏 doc 都可原地写修复」。
4. **修复操作指引（文档级，随 §3.4 头注落位）**：对疑似超深/损坏 doc，直接走 provide-root `replaceSchema({schema, root})`——该分支不读旧 doc 深度（快照闸只作用于调用方输入；probeRoot 只查顶层载体；clear+install 替换全部内容），或带外重建 doc；**不要先试 keep-root**（虽然经修正 2 它也只得到领域失败，不会锁死——但 provide-root 一步到位）。

### 3.3 新 catch 契约（精确伪代码）

```ts
} catch (err) {
  if (err instanceof DerivedInvariantError) {
    // ① sentinel → E204（现状逐字节保留——A4 红线锚 sa7-dynamic γ 365-384 零回归）
    throw new DocRuntimeFatalError(
      'pre-commit-internal', false,
      `DOCRT-E204: 写前 internal 不变量破坏（${err.message}）——合规调用者不可达` +
        `（派生物仅可由 evaluate 产出，此处为 internal 缺陷类）；本调用零写入` +
        `（doc 状态不因本调用改变）；不补偿、不 fallback`,
      { cause: err },
    );
  }
  // ② 其余一切未知异常 → fatal（rev2：资源极限例外整体撤销——判别器闭环论证见设计
  //    §3.2；DOCRT-E206 为 append-only 下一空码，E100/E200-E205 已占用）
  const detail = err instanceof Error ? err.message : String(err);
  throw new DocRuntimeFatalError(
    'pre-commit-internal', false,
    `DOCRT-E206: replaceSchemaAndRoot 写前未知内部异常（意外抛出）：「${detail}」——` +
      `非领域失败、非 DerivedInvariantError sentinel，按 internal fatal 分级（ADR-0008` +
      `「未知异常保守视为」哲学；本 round 撤销资源极限例外）；唯一事务尚未开始，` +
      `确定零写入（doc 状态不因本调用改变）；不补偿、不 fallback`,
    { cause: err },
  );
}
```

要点：
- **E204 消息逐字节不动**（既有 A4 锚含 cause instanceof Error 与 phase/committed 断言）。
- **DOCRT-E200 模块名制消息从本文件删除**（`DOCRT-E200: replaceSchemaAndRoot 内部错误（意外异常）` 分支不复存在）；模块名制 E200 文案在 replace.ts:157 / materialize.ts:160 原样保留（零改动声明）。E206 消息沿 E203/E204 先例**插值原始异常 detail**（doc-runtime 层消息惯例——证据引用文本；Runtime 层 `RuntimeWriteFatalError` message 仍恒定模板，原始异常经 `cause` 零损失保留）。
- **committed 恒 false**：prepare 在唯一事务（transactGuarded）之前，结构上零写入——诚实 committed 事实，兑现 ADR「committed:false 不调用 dirty notifier」。
- `probeSchemaMap` 第五态 throw（:260）随之落入 ② → fatal（原 E200）：公共 API 造不出的态，保守方向正确。

### 3.4 schema-replace.ts 头注相应修订

文件头「① prepare（唯一 try/catch，崩溃边界 DOCRT-E200 模块名制；DerivedInvariantError → E204 …）」与 `prepareSchemaReplace` JSDoc（:131-135）改写为：

```
 * ① prepare（唯一 try/catch，崩溃边界两级 fatal 制——rev2/评审项 5/SA8 裁决 C；
 *    R2 修订作用域——SA2 R1 #1：snapshotter 前置闸只作用于 provide-root 公共面输入）：
 *    DerivedInvariantError sentinel → E204 pre-commit-internal committed:false（不变）；
 *    其余一切意外异常 → DOCRT-E206 pre-commit-internal committed:false（资源极限
 *    例外已整体撤销——判别器闭环见设计 §3.2。provide-root 公共面深输入先被
 *    snapshotter 受控快照闸拦截（MUTATION_INPUT_NOT_PLAIN_DATA——只冻结调用方
 *    输入，不遍历 live Y.Doc）；keep-root 的 doc 源深度不受前置闸约束，但其递归
 *    组件 extractYjsSnapshot/validateLogicalSnapshot 各自拥有全函数体崩溃边界
 *    （DOCRT-E100 / VFSL-E100 结构化返回，绝不外抛）——真实深 doc 的溢出在到达
 *    本 catch 之前已被吸收为领域级 ok:false，不产生本 fatal；本 catch 对 keep-root
 *    的覆盖是纵深防御：未来新增的无边界组件逃逸异常一律按 internal fatal 分级
 *    （保守方向的有意识选择——代价与接受面见设计 §3.2.3 决策记录）。
 *    无 SA2 可审的确定性判别器能把「深输入递归溢出」与「内部 bug 恰抛 RangeError」
 *    区分开（消息特征依赖 V8 实现细节、帧特征在栈溢出时不可靠、深度先验引入
 *    溢出免疫探针+魔法阈值的新机械）——按 ADR「未知异常保守视为」撤销例外，
 *    零写入承诺仍字面成立）。
 *    领域失败（envelope 形状/载体探针/validate/build issues）一律 {kind:'fail'}
 *    返回、不经 catch——E200 领域桶在本文件无合法流量，已删除（replace.ts /
 *    materialize.ts / mutation.ts 的 E200/E205 面服务各自直接调用方，零改动）。
 *    修复指引：疑似超深/损坏 doc 直接走 provide-root（不读旧 doc 深度），勿先试
 *    keep-root（设计 §3.2.3 第 4 条）。
```

`@throws` JSDoc（:99-101）追加一行：`` `DOCRT-E206`（① 写前未知内部异常——非 sentinel 的意外抛出，零写入）``。

### 3.5 replace.ts / materialize.ts / mutation.ts 零改动声明

三者不在 Runtime 写路径上的同款 catch-all 保留原样（SA8 C/I 已核查：mutation.ts 直接消费 buildTopEntries 且自带 sentinel→E204 处理；schema-write.ts 只调 replaceSchemaAndRoot）。doc-runtime 直接调用面（E200/E205）与 Runtime 写面（E206 fatal）的分级不对称是**两层失败哲学的自然结果**（下层：输入驱动失败走联合，ADR-0007 L54 直接条款 + materialize-root-rev2:369-393 锚；上层：结果联合之外的异常一律 fatal，ADR-0008），SA8 I 已登记为「未来 doc-runtime E200 边界统一票」的参考，**本轮严禁顺手改动**。

---

## §4. D-4 SCHEMA 载体缺席/异型分流（评审项 6；裁决 D）

### 4.1 目标与分流判据

projection.ts:67-73 现行把「载体异型」（同名 Y.Text/Y.Array/Y.XmlFragment，`getMap('SCHEMA')` throw）与「载体缺席」（share 无 'SCHEMA' 键）同映射为 null——载体损坏与合法缺席不可区分，是虚假降级（NSRT-META-E2 同款理由）。分流：

| 载体态 | public 模式（getSchemaEnvelope） | p0 模式（P0 槽） |
|---|---|---|
| **缺席**（`!doc.share.has('SCHEMA')`） | `null` 保留（合法态：schema 尚未写入；persistence 共享套件「Permissive: correct docId, no SCHEMA」锁定） | `null` → compile ENV-1 收编 → unavailable（数据级） |
| **异型**（getMap throw） | **loud throw `SchemaProjectionError` code `NSRT-SCHEMA-E2`**（载体异常——镜像 NSRT-META-E1（值域）/E2（载体）双码先例） | `null`（**数据级 unavailable，禁 fatal**——机械见 §4.4） |
| Y.Map 存在 | 恰四键投影（E1 值域守卫照常） | 同左（违规键省略照常） |

### 4.2 新码注册（errors.ts append-only；ADR-0008 L125 归属条款）

`SchemaProjectionError` 的 code 从单值宽化为双码并列（**镜像 `MetaProjectionError` 的 E1|E2 先例——同类双码一个类的既有形态**，不新建第二个 schema 类）：

```ts
// errors.ts 修订（append-only：code 联合加宽，类名/name 不变）
export class SchemaProjectionError extends Error {
  readonly code: 'NSRT-SCHEMA-E1' | 'NSRT-SCHEMA-E2';

  constructor(code: 'NSRT-SCHEMA-E1' | 'NSRT-SCHEMA-E2', message: string) {
    super(message);
    this.name = 'SchemaProjectionError';
    this.code = code;
  }
}
```

类仍不从 index.ts 导出（code+message 字符串消费）。E1 构造点（projection.ts:85-88）同步加首参 `'NSRT-SCHEMA-E1'`，message 逐字节不动。

### 4.3 projection.ts 载体分支精确伪代码

```ts
export function projectSchemaEnvelope(doc: Y.Doc, mode: SchemaProjectionMode): SchemaEnvelope | null {
  // ① 载体缺席 → null（双模式同判——生产合法可达，保留宽容）
  if (!doc.share.has('SCHEMA')) {
    return null;
  }
  // ② 载体异型分流（rev2/评审项 6/SA8 裁决 D）：损坏 ≠ 缺席——public 模式 loud
  //    （镜像 projectMetadata ② 的 META-E2 形态）；p0 模式数据级 null（→ ENV-1 →
  //    unavailable——禁 fatal，保 SCHEMA write 修复路径）
  let sc: Y.Map<unknown>;
  try {
    sc = doc.getMap('SCHEMA');
  } catch (err) {
    if (mode === 'public') {
      throw new SchemaProjectionError(
        'NSRT-SCHEMA-E2',
        `SCHEMA 载体异型（同名条目非 Y.Map，观测异常：` +
          `${err instanceof Error ? err.message : String(err)}）——公共读取面拒绝把载体损坏` +
          `静默映射为缺席 null（NSRT-SCHEMA-E2）`,
      );
    }
    return null; // p0 模式：终点 unavailable（数据级），绝非 fatal
  }
  // ③ 四键投影 + 值域守卫（现状不动）
  ...
}
```

### 4.4 p0 模式禁 fatal 的机械保证

p0 模式**在该分支永不 throw**（return null）→ `runP0`（p0.ts:80-130）的 catch（:120）对该载体态结构性不可达 → 不可能被收编为 `NSRT-FATAL-P0-INTERNAL`。P0 随后 `env.compile(null as SchemaEnvelope)` → 真实 `compileSchemaEnvelope(null)` 返回 `ok:false` + ENV-1 issue（结构化，非异常）→ `schemaState='unavailable'` + `schemaIssue={code:'SCHEMA_ENVELOPE_1', …}`（p0.ts:116-117 数据级路径）。**p0.ts 零改动。**

设计裁决记录（SA8 D 授权的两个 p0 终点中选「保持 null→ENV-1」）：不选「p0 模式可区分载体摘要」变体，理由 (a) p0 模式投影结果无任何公共直接消费方（唯一消费方 compile），终点可观测面已是 unavailable 摘要 + public getter 的 E2 loud（下述组合）；(b) 变体需改 projection 返回联合与 runP0 分支，扩大改动半径换诊断措辞，违背最小机械。

**「P0 unavailable + getSchemaEnvelope() throw E2」可观测组合（SA8 D 明示义务）**：同一异型载体 doc 上，P0 结算为 unavailable（`status.schema.state==='unavailable'`、`status.schema.issue.code==='SCHEMA_ENVELOPE_1'`、`status.fatal===null`）的同时，public `getSchemaEnvelope()` 稳定收到 E2 throw——数据级收编（ROOT 写不可用）与 loud 载体诊断（getter 面）并存，诊断面自洽。锚 T4.2（R2 修正——SA2 R1 #4：组合锚在 §8 矩阵为 T4.2；T4.3 是缺席对照）。

**修复路径保留的精确语义（防 SA2 追问）**：ADR-0008 L59「SCHEMA write 仍可修复」指的是 compile 失败类 unavailable（缺席/坏文本）——SCHEMA write ①c 探针惰性创建可修复**缺席**；对**异型**载体，replaceSchema 在 S5 `probeSchemaMap` 返回 `carrier!=='Y.Map'` → ok:false 单 issue（schema-replace.ts:150-155 现行行为，本轮不动）——即 v1 SCHEMA write 不能清除顶层异型载体（doc 级重建属带外修复）。本设计保留的是「写路径不被 fatal 永久关闭、修复**尝试**仍可发生且得到诚实领域 issue」，不是声称异型可原地修复。fatal 化才会把该面也永久关闭——这正是裁决 D 禁 fatal 的依据。

### 4.5 projection.ts 头注相应修订

头注「载体处置遵循……单一判据」节（projection.ts:15-22）SCHEMA 行改写：

```
 * - SCHEMA 载体缺席 → null（经 createDoc/loadDoc 生产路径合法可达——两者均只
 *   校验 META.docId，完全不触碰 SCHEMA；共享套件「Permissive: correct docId,
 *   no SCHEMA, no ROOT」显式锁定宽容）；
 * - SCHEMA 载体异型（同名 Y.Text 等）→ 分流（rev2，评审项 6/SA8 裁决 D）：
 *   public 模式 loud throw（SchemaProjectionError / NSRT-SCHEMA-E2——载体损坏
 *   ≠ 缺席，静默映射 null 即虚假降级，镜像 META-E2 判据）；p0 模式 null →
 *   compile ENV-1 收编 → 数据级 unavailable（禁 fatal——保 SCHEMA write 修复
 *   路径；runP0 catch 对该态结构性不可达）；
 * - META 载体缺席/异型 → loud throw（NSRT-META-E2，生产路径不可达——……不变）。
```

函数 JSDoc 三分支描述（:49-57）同步：② 载体异型从「→ null」改「public throw E2 / p0 null」。

---

## §5. D-5 生产装配路径真实端到端验收（评审项 2；裁决 E①）

### 5.1 形态（SA8 E① 排除法已锁定）

- 构造：测试经**包内相对路径** `import { createNamespaceRuntime } from '../src/runtime.js'`（runtime.ts:240-245 包内生产工厂——AC1 锁定 `entry.createNamespaceRuntime === undefined`，公共导出违反 AC6/ADR-0008 L91；实现 Registry 违反 L107「Registry 另行设计」；包内导入是唯一同时满足评审意图与两条 ADR 边界的形态）。
- handle：真实 `persistence.createDoc(OWNER, docId, doc)` 产物（预构建 Y.Doc → 真实编码入库）。
- notifyDirty：`() => { dirty += 1; return persistence.saveDoc(handle); }`——**ADR-0008 L45「由构造方绑定 `persistence.saveDoc(handle)`」的逐字调用形**（runtime.ts:236-238 注释明文的未来 Registry 确切形；计数器是观测不是注入）。
- compiler：**不注入 compile**（真实 `compileSchemaEnvelope`——解析/求值/校验全真实）。
- doc-runtime：真实（read/applyValidatedMutation/replaceSchemaAndRoot 全链）。
- 双 Adapter：MemoryPersistence（公开 I/O hook 共享 store 跨实例读）+ FilePersistence（真实磁盘 + 全新实例 crash-restart）。

### 5.2 场景（两 Adapter 各一全链）

`P0 → 读 → ROOT write → SCHEMA replacement → 跨实例/crash-restart 持久化 → close`：

1. P0 真实编译结算：`getActiveSchema()` 五键身份（lang/version/id/双指纹非空串）；
2. 载体投影读取：`read(['n'])`/`read(['tags',0])`（Y.Map 字段 + Y.Array 元素）；
3. ROOT write：`mutateRoot({op:'set',…})` ok:true → `read` 见新值 → **dirty 计数恰 +1**；
4. SCHEMA replacement（提供完整 root）：ok:true → 单 update 事件（单事务）→ active 同步切换（`getActiveSchema().id` 新值）→ dirty 恰再 +1；
5. 持久化证明：Memory——flush 后 `reader.loadDoc` 全新实例见新 SCHEMA/ROOT（非 live 别名）；File——`restart()`（同 rootDir 全新 FilePersistence 空缓存）`loadDoc` 见同样状态（crash-restart）；
6. close：`close()` → closing（同步可观测）→ closed → `handle.getStatus()==='released'` → `read` 返回 `RUNTIME_READ_DISABLED` 结果联合分支 → `mutateRoot`/`replaceSchema` settle 含 `RUNTIME_WRITE_DISABLED` 的零写入结果 → **post-close `getSchemaEnvelope()` throw `RUNTIME_READ_DISABLED`**（D-2 在生产构造路径上的集成确认）。

断言面纪律：不注入任何 fault/gate（那是 seam fullchain 的分工）；dirty 计数是「生产绑定真实生效」的行为证据（每笔成功写恰一次 notify；P0/close 零 notify）。

### 5.3 与既有 seam fullchain 的关系（并存，断言面分工）

| | seam fullchain（runtime-acceptance-fullchain.test.ts 既有） | production-assembly（本设计新增） |
|---|---|---|
| 构造器 | `createNamespaceRuntimeWithSeam`（注入 notifier/compile） | `createNamespaceRuntime`（真实绑定） |
| 证明面 | 故障注入链（observer 逃逸 committed fatal、compile throw pre-commit fatal）、受控门 | 生产构造链（Registry 未来调用形）、真实 dirty 绑定、真实落盘 |
| 关系 | 保留并继续扩充（D-6） | 并存互补——SA8 E 明文「两个互补测试，勿强行合一」 |

### 5.4 落点裁决：新建测试文件

`packages/namespace-runtime/test/runtime-acceptance-production-assembly.test.ts`（新建，[SA6 owned]）。理由：(a) fullchain 的文件身份是「seam 注入链验收」（其 fixture helper 全部经 seam 构造），混入第二构造哲学会模糊审计线索；(b) 生产装配测试本身是 AC1/AC6 相邻的审计产物，独立文件名可被评审者直接定位；(c) 文件级 import 隔离使「零 seam 依赖」性质局部可检（文件内 grep 无 WithSeam）。

---

## §6. D-6 pre-commit fatal 真实持久化全链（评审项 3；裁决 E②）

### 6.1 注入点与「其余全真」边界

真实组件下 pre-commit fatal 公共面结构性不可达（真实 `compileSchemaEnvelope` 一切输入返回结果联合；E204 需手造派生物）——评审要求的「真实持久化全链」= **故障注入点之外的整链全真**（SA8 E② 授权解读；ADR-0008 L91 明文列举 seam 注入物含「fault」）。seam 构造器**只注入 compile throw**（按 envelope id 分发——P0 用真实编译，proposed 才 throw；复用 sa7-dynamic `dispatchCompile` 机制），其余一切全真：真实 `createDoc` handle、notifyDirty 绑真实 `saveDoc` + 计数、Memory + File 双 Adapter。

### 6.2 用例矩阵（落点：runtime-acceptance-fullchain.test.ts AC5 describe 块追加）

**U-1 Memory × pre-commit fatal（schema-compile-throw committed:false）**——红灯性质：首跑即绿（存量能力补验收；评审缺口是覆盖不是行为）。断言面（SA8 E② 逐项）：
1. seam compile 分发：`id==='ns-1'` → 真实 compile；`id==='ns-2'` → `throw new Error('PRECOMMIT_COMPILE_BOOM')`；
2. P0 真实结算 ready（proposed 注入不影响 P0）；
3. `replaceSchema({schema: ENV2, root:{…}})` → rejection `RuntimeWriteFatalError`：`phase==='schema-compile-throw'`、`committed===false`、`cause instanceof Error`；
4. **notifier 恰 0 次**（committed:false 不调 dirty notifier——基线 0 且无成功写）；
5. **零 update / 字节不变**（`countUpdates` 恒 0 + `Y.encodeStateAsUpdate` 逐字节相等）；
6. **fatal 摘要置位**：`status.fatal.code==='NSRT-FATAL-SCHEMA-WRITE-INTERNAL'`（SCHEMA 槽独立摘要码）；
7. **fatal 后读照常 + 后续写 RUNTIME_WRITE_DISABLED**：`read(['n'])` ok:true 原值；`getActiveSchema()?.id==='ns-1'`（fatal 期 getter 照常——D-2 负向锚复用）；`mutateRoot`/`replaceSchema` 后续 settle `ok:false` 且 JSON 含 `RUNTIME_WRITE_DISABLED`、零字节变化；
8. **close 排空 release 恰一次**：`close()` → closed → `handle.getStatus()==='released'`。

**U-2 File × pre-commit fatal**（FilePersistence 至少覆盖义务）：同 U-1 断言面 + 持久层零写入证明——fatal 前无任何成功写 → fatal + close 后 `restart()` 全新 FilePersistence `loadDoc` → SCHEMA 仍 ENV1 原文、ROOT 原值、META 原样（durable 零写入）。

**U-3 File × committed fatal（建议补充面；SA8 E②「建议同时补 committed fatal 的 File 面」）**：**经生产工厂** `createNamespaceRuntime(handle, () => writer.saveDoc(handle))`（observer 逃逸是 doc 级注入，与生产构造器兼容——D-5/D-6 组合最大化两构造器覆盖）+ `doc.getMap('ROOT').observe(() => { throw … })` → `mutateRoot` rejection `committed===true` → 槽内 best-effort `saveDoc` 恰一次（计数 1）→ flush + `restart()` 新实例见已提交值（不虚假回滚的 durable 证据）→ fatal 摘要 `NSRT-FATAL-WRITE-INTERNAL` → 读保留 → 后续写 RUNTIME_WRITE_DISABLED → close 照常。

**U-4（可选补充变体，采纳）Memory × P0 期 compile throw → NSRT-FATAL-P0-INTERNAL 全链**：seam compile 恒 throw → P0 fatal：notifier 恰 0、doc 字节不变、`status.fatal.code==='NSRT-FATAL-P0-INTERNAL'`、`schema.state==='preparing'`、读立即可用（read 不等 P0）、全部写 RUNTIME_WRITE_DISABLED、close 排空 release 恰一次。补齐「P0 fatal × 真实持久化」面（round 1 仅 fake-handle 覆盖）。

---

## §7. D-7 descriptor-safe 共享原语层（评审项 7；裁决 F）

### 7.1 模块与导出原语清单

新模块 `packages/namespace-runtime/src/plain-data.ts`（包内实现模块，index.ts 不导出——ADR 对包内模块结构沉默，无条款冲突）：

```ts
/** own enumerable data property 的 descriptor 事实（零执行：getOwnPropertyDescriptor
 *  元数据读，不触发 accessor、不读原型链值）。三分消费者的公共底座。
 *  【R2——SA2 R1 #3】'non-enumerable' 携带 value：数组元素面（readableArrayElement）
 *  现行语义是「照常读值」（不检查 enumerable），需要值；对象键面（readableOwnDataValue）
 *  才把 non-enumerable 归为 skip——两个消费面有意不同，kind 必须带值以支撑前者。 */
export type OwnDataFact =
  | { kind: 'missing' }          // 无 own descriptor（缺键 / 原型链）
  | { kind: 'non-enumerable'; value: unknown } // own 但 enumerable !== true（data 值已知，零执行）
  | { kind: 'accessor' }         // desc.get/set 存在（不执行）
  | { kind: 'undefined-value' }  // own enumerable data 值为 undefined
  | { kind: 'ok'; value: unknown };
export function ownDataFact(target: object, key: string | number): OwnDataFact;

/** plain record 判据（原型链上溯 ≤32 层防循环，链上每个非 Object.prototype 节点的
 *  own constructor 须缺失或为 Object/undefined——Date/Map/Set/RegExp/类实例 → 非
 *  plain；全程 descriptor 读）。[projection 消费——write.ts 的对象分支用更严的单级
 *  原型判据（子类即拒），语义不同，不共用——防行为回归] */
export function isPlainRecord(v: object): boolean;

/** defineProperty 四真安全写入（writable/enumerable/configurable 全 true）——
 *  '__proto__' 等 own 键不触发原型 setter、不劫持产物原型（E8/E9/F-1 纪律；
 *  仓内先例 read.ts putKey / extract.ts putSnapshotKey / detached-build.ts
 *  copyJsonDomain）。 */
export function putPlainKey(out: object, key: string, value: unknown): void;

/** Yjs 家族申报词（构造器名，兜底 'Y.AbstractType'）——message 用。 */
export function yjsFamilyWord(v: unknown): string;

/** 诊断词（finite 描述 / 构造器名 / typeof 三态）——message 用。 */
export function describePlainValue(v: unknown): string;
```

### 7.2 消费方式（各自语义保持——不统一遍历器）

**projection.ts 消费**：
- `readableOwnDataValue`（:245-263）改为 `ownDataFact` 薄适配：missing/**non-enumerable**/accessor → `{kind:'skip'}`（对象键面：non-enumerable 属键空间外——现行 :249-254 语义）；undefined-value → `{kind:'undefined'}`；ok → `{kind:'ok', value}`——**三分语义与全部 message 逐字节不变**；
- `readableArrayElement`（:267-285）改为越界前查 + `ownDataFact` 适配，四种 violation message 原样；**【R2——SA2 R1 #3①】`'non-enumerable'` → `{kind:'ok', value: fact.value}`（照常读值）**——现行 :267-285 **不检查 enumerable**（non-enumerable data 下标照常投影其值），与 readableOwnDataValue 的 skip **有意不同**（数组元素无键空间概念）；**【R2.1——SA2 R2 A】子情形：`'non-enumerable' ∧ fact.value===undefined` → 维持现行 violation「数组位置 undefined 不可投影」**——projection.ts:281-283 的 `desc.value === undefined` 检查不区分枚举性，`Object.defineProperty(arr, 1, {})`（默认 value:undefined、enumerable:false）一行可达、现行即走该 violation；若映射①无条件 ok+fact.value，此形态会漂移为 copyMetaValue(undefined) 的 E1「值域违规：undefined」（同码 NSRT-META-E1 同 loud、仅消息漂移——消息即断言面，仍须锁死）；T7.2 双分支锁定该语义；
- `putMetaKey`（:206-208）→ `putPlainKey` 直调（同一 defineProperty 调用）；`isPlainRecord`/`yjsWord`/`describe` 本地副本删除，改 import；
- copyMetaValue 递归体（含 F-3 的深递归 → 原始 RangeError 路径）**位置与形态不动**。

**write.ts copyFrozen 消费**：
- 对象分支 R1 四查的 per-key descriptor 检查（:333-337）改 `ownDataFact` kind 分派：missing → throw `属性 "k" 无 own descriptor`；accessor → throw `accessor 属性 "k"`；non-enumerable → throw `非枚举 own 键`（结构性不可达——names/keys 长度比对先行拦截，防御分支保留）；undefined-value **不在此查**（维持现行「值读取期 throw `键 "k" 值为 undefined`」次序）；
- 数组分支 ③ 全表扫描（:296-304）改 `ownDataFact(arr, String(i))`：missing → `index i 无 own 属性（稀疏空洞或原型链污染——不读原型值）`；accessor → `accessor 下标（index i）`；**【R2——SA2 R1 #3②】`'non-enumerable'` → 防御性 throw「数组携带非枚举 own 键」**（与 ② 全局拦截消息字面量对齐；结构性不可达——② names/keys 比对先行拦截非枚举面）；**`'undefined-value'` → ③ 阶段放行**（③ 只查 missing/accessor/non-enumerable——现行 :296-304 亦不查值 undefined），**维持 ⑤ 值读取期 throw `数组元素 undefined（index i）` 次序**（两阶段消息字面量相同、行为等价，但「③ descriptor 全表扫完才读值」的次序是 SA2 R2 #2 攻击点的锁定面）；
- 产物写入（:346-351 inline defineProperty）→ `putPlainKey(out, k, copyFrozen(raw, ancestors))`；
- **①②③④⑤ 查序逐位保留**（③ descriptor 全表扫描仍先于任何 `v[i]` 值读取——SA2 R2 #2 攻击点的次序保证）；symbol 键/names-keys 比对/单级原型判据/祖先集循环检测**留在 write.ts**（write 专属语义，见 7.1 注记）。

**不统一遍历器的声明**（SA8 F）：两 walker 的失败语义（throw vs 收编 issue/skip）、冻结纪律（不冻结 vs 后序递归冻结）、循环策略（原型链 32 层上限 vs 祖先路径集）、plain 判据（链上溯 vs 单级严格）是各自被测试锚锁定的契约面——原语层只共享 **descriptor 读取事实、安全写入、申报词** 三族纯函数，遍历器与失败分级各自保留。

### 7.3 零行为回归硬验收

机械等价论证：`ownDataFact` 是对同款 `getOwnPropertyDescriptor` 判定序列的纯提取（同输入 → 同 kind；**R2 补全：kind 全集五值 × 三消费面的映射已在 §7.2 逐格写明——含数组元素面 non-enumerable→照常读值、write 数组 ③ 的 non-enumerable→防御 throw 与 undefined-value→放行两处 R1 缺口，SA3 无自由裁量点**）；消费端 kind → message 映射逐条对齐现行字面量；`putPlainKey` 是同一 defineProperty 调用。硬验收 = §13 零回归边界全量绿（重点：snapshotter 四查次序锚、F-3 RangeError 锚、metadata-proto-key 全量、sync-read-face 全量）+ T7.2 新增语义锁定锚。

---

## §8. 测试矩阵（SA6 红灯锚定全量清单）

> 「红」= 对当前 HEAD 断言失败（SA6 红灯落点）；「绿(存量)」= 验收记录型（首跑即绿，评审缺口是覆盖非行为）；「绿(保留)」= 既有锚不动、必须持续绿。

### D-1（seam 撤出）

| 用例 | 文件 | 场景 | 预期 | 契约 |
|---|---|---|---|---|
| T1.1 | runtime-acceptance-exports-audit.test.ts | `Object.keys(publicEntry).sort()` | **红**：现 2 键 → 绿：`['RuntimeWriteFatalError']` | D-1 |
| T1.2 | 同上 | `entry.createNamespaceRuntimeWithSeam` | **红**：现 function → 绿：undefined | D-1 |
| T1.3 | 同上 | `typeof entry.RuntimeWriteFatalError === 'function'`（唯一值导出形状） | 绿（改锚保留） | D-1 |
| T1.4 | 同上（新增 it） | 读 package.json 断言 `exports` 键集恰 `['.']`（无 ./testing 子路径——配置审计非源码文本审计；断言的是当前真实现状，首跑必绿——R2 如实标注，SA2 R1 #5） | **绿（存量审计锚）**——防未来回潮的锁定锚 | D-1/裁决A |
| T1.5 | 全部 18 个切换文件 | 既有断言全量 | 绿（仅 import 路径机械切换） | D-1 |

### D-2（getter 停接纳）

| 用例 | 文件 | 场景 | 预期 | 契约 |
|---|---|---|---|---|
| T2.1 | runtime-close-lifecycle.test.ts（改锚 184-221 块） | close 排空后三 getter 各自调用 | **红**：现不抛且值不变 → 绿：同步 throw；`err.code==='RUNTIME_READ_DISABLED'`；message 含 `'closed'` 与各自 getter 名；三 err 均非 Promise | D-2 |
| T2.2 | 同文件（新增 it） | 写槽挂 S6 notifier 门期 close → closing 窗口内三 getter throw（message 含 `'closing'`）；放行排空 closed 后 throw（`'closed'`）；全窗口 `getStatus()` 可用且 `lifecycle` 真话 | **红**（新行为） | D-2 |
| T2.3 | 同文件（fatal×close 用例内追加） | compile throw → fatal 置位（lifecycle 仍 ready）→ 三 getter 照常（envelope/meta 投影、activeInfo）；close 后才 throw | **红**（显式负向锚；sa7-dynamic:378-379 为既有隐式负向锚保持绿） | D-2/H |
| T2.4 | 同文件（新增 it） | F-3 同款 cyclic META 注入 + close → `getMetadata()` throw `RUNTIME_READ_DISABLED`（非 RangeError）——门禁先于深拷贝递径的零触碰证明 | **红**（新行为） | D-2 |
| T2.5 | p0-sequencer.test.ts:196 / sync-read-face.test.ts:97 等 | unavailable/preparing 期（lifecycle ready）getter 照常 | 绿（保留——门禁不 keyed on schemaState） | D-2/H |
| T2.6 | close-lifecycle:191/203-207/210/222 等 | getStatus 全生命周期 + 七键位值 | 绿（保留） | D-2 |

### D-3（schema-replace fatal 化）

| 用例 | 文件 | 场景 | 预期 | 契约 |
|---|---|---|---|---|
| T3.1 | runtime-replace-schema-sa7-dynamic.test.ts（新增注入路径 δ） | seam compile 分发返回 ok:true + **非 map 形 structure node 裸 throw** 派生物（如 `structure.node = 42`）→ replaceSchema | **红**：现 settle resolved `{ok:false, issues:[DOCRT-E200…]}` → 绿：rejection `RuntimeWriteFatalError`，`phase==='pre-commit-internal'`、`committed===false`、`cause instanceof Error`（cause message 含 `DOCRT-E206`） | D-3 |
| T3.2 | 同上（δ 续） | 零写入面：notifier 恰 0、`countUpdates===0`、stateBytes 不变、SCHEMA/ROOT/active 不变；fatal 摘要 `NSRT-FATAL-SCHEMA-WRITE-INTERNAL`；读照常（`read(['n'])` 原值、`getActiveSchema()?.id==='ns-1'`）；后续两写 RUNTIME_WRITE_DISABLED | 随 T3.1 红转绿 | D-3 |
| T3.3 | 同文件 γ（333-388 现存） | DerivedInvariantError sentinel → E204 | 绿（保留——A4 红线零回归） | D-3① |
| T3.4 | runtime-replace-schema-sa7-dynamic.test.ts（新增 ε 路径，R2——SA2 R1 #1.4） | **真实深 doc × keep-root**：迭代构建 DEEP 层嵌套 Y.Map ROOT 的预构建 doc（循环 `cur.set('n', next)` 逐层嵌套——构建本身零递归；SCHEMA/META 正常四键；DEEP 取 20_000–50_000——materialize-root-rev2:365-367 同量级标定先例「depth≥10_000 溢出点确定落在递归装配、取 20_000 留 2× 余量」，Node 20/24 双栈安全上限内取大值，SA6 落锚前以浅路径 read + P0 ready 预检 fixture 可用性）→ createDoc → keep-root `replaceSchema({schema: ENV2})` | **绿（存量行为锚——R2 修订断言面）**：settle **resolved** `{ok:false}`，issues[0].message 匹配 `/DOCRT-E100\|VFSL-E100\|校验工作预算耗尽/`（extract/validate 哪层吸收非契约——§3.2.2 修正 2）；零 update + stateBytes 不变；`status.fatal===null`、写位未禁；**同 runtime 后续 provide-root `replaceSchema({schema, root: 浅完整 root})` ok:true——修复通道开放**；`read` 照常。**为何不按 SA2 R1 §4 原案锚 E206 rejection**：经 R2 事实核对（extract.ts:52-80 INV-6 / validate.ts interpret :598-646 全函数体 try/catch），真实深 doc 的溢出在到达 prepare catch 之前已被两层自有边界吸收——锚 E206 将是永不通过的伪锚；E206 分类面由 seam δ（T3.1）确定性覆盖（两方案择一：**选真实深 doc 锚真实行为 + δ 锚分类面**，弃「seam 注入 extract-throw」——extract 自有边界使其结构性不可外抛，无可注入点）。若 DEEP 在 CI 构建面不稳（yjs 编码/集成限制），回退：降至 20_000（rev2 先例值）重标定；再不稳则保留 δ 面并在此行登记回退决议。**【R2.1——SA2 R2 B】timeout 取舍**：extract/validate 的逐层 path 复制使墙钟成本 ~O(DEEP²)——50_000 层有超 vitest 默认 5s 的风险；取舍：**深度取 20_000（rev2 标定先例值——depth≥10_000 溢出已确定、20_000 留 2× 余量）+ 用例级显式 `it('…', { timeout: 30_000 })` 双保险**；不取「更大深度换溢出确定性」（确定性已在 20_000 充分，只会放大墙钟） | D-3/SA2 R1 #1 |

### D-4（载体分流）

| 用例 | 文件 | 场景 | 预期 | 契约 |
|---|---|---|---|---|
| T4.1 | runtime-schema-carrier-split.test.ts（新建，[SA6 owned]） | **fixture 前提（R2——SA2 R1 #2）**：doc 预先**不含** SCHEMA 载体（persistence permissive 接受，对照 T4.3/共享套件）——createDoc 后经 `handle.doc.getText('SCHEMA').insert(0,'x')` 创建 Y.Text 异型条目；**勿复用仓内标准 makeDoc（预建 SCHEMA Y.Map 四键）**——已含同名 Y.Map 时 `getText('SCHEMA')` 将 throw（yjs 同名异型机理，即 projection.ts:67-73 所依赖者）→ fixture 自身错误（伪红）；SA6 落锚加前置断言 `handle.doc.share.has('SCHEMA')===false`（注入前）。异型创建先例：doc-runtime extract-yjs-snapshot.test.ts:518（`doc.getArray('SCHEMA').insert(…)` 于全新无 SCHEMA doc）→ ready 期 `getSchemaEnvelope()` | **红**：现返回 null → 绿：throw `SchemaProjectionError`，`err.code==='NSRT-SCHEMA-E2'`，message 含载体观测信息；sync throw 非 Promise | D-4 |
| T4.2 | 同上 | 同 doc：P0 结算 → `status.schema.state==='unavailable'`、`schema.issue.code==='SCHEMA_ENVELOPE_1'`、`status.fatal===null`（数据级收编、零 fatal 污染）+ **组合锚**：同 doc `getSchemaEnvelope()` throw E2 | unavailable 部分绿（存量）；E2 组合部分**红**（随 D-4 转绿） | D-4 |
| T4.3 | 同上 | 缺席对照：无 SCHEMA doc（persistence permissive）→ `getSchemaEnvelope()===null` + P0 unavailable（ENV-1）——缺席宽容零回归 | 绿（保留+显式化） | D-4 |
| T4.4 | 同上 | 异型 doc 上 `replaceSchema` → ok:false 单 issue（`SCHEMA 载体不是 Y.Map…`，S5 探针现行行为）——写路径开放且诚实（修复路径保留语义） | 绿（显式锚定现行行为） | D-4 |
| T4.5 | persistence 共享套件 | 「Permissive: correct docId, no SCHEMA」缺席宽容 | 绿（保留） | D-4 |

### D-5（生产装配）

| 用例 | 文件 | 场景 | 预期 | 契约 |
|---|---|---|---|---|
| T5.1 | runtime-acceptance-production-assembly.test.ts（新建，[SA6 owned]） | Memory 全链（§5.2 六步 + dirty 计数恰每成功写 +1） | 绿(存量)——唯 post-close `getSchemaEnvelope()` throw 断言**红**（随 D-2 转绿） | D-5/D-2 |
| T5.2 | 同上 | File 全链 + crash-restart + release/close | 同上 | D-5 |

### D-6（pre-commit fatal 真实持久化）

| 用例 | 文件 | 场景 | 预期 | 契约 |
|---|---|---|---|---|
| T6.1=U-1 | runtime-acceptance-fullchain.test.ts（AC5 块追加） | Memory × schema-compile-throw committed:false 全链（§6.2 U-1 八断言面） | 绿(存量) | D-6 |
| T6.2=U-2 | 同上 | File × pre-commit fatal + restart durable 零写入 | 绿(存量) | D-6 |
| T6.3=U-3 | 同上 | File × committed fatal（observer 逃逸，**经生产工厂**）+ restart 见提交值 | 绿(存量) | D-6/D-5 |
| T6.4=U-4 | 同上 | Memory × P0 期 compile throw → NSRT-FATAL-P0-INTERNAL 真实持久化全链 | 绿(存量) | D-6 |

### D-7（原语层）

| 用例 | 文件 | 场景 | 预期 | 契约 |
|---|---|---|---|---|
| T7.1 | 既有全量（§13 清单） | 纯机械提取后的行为等价 | 绿（零新红——重构无行为变化，回归集即验收面） | D-7 |
| T7.2 | metadata-proto-key.test.ts 扩展（R2——SA2 R1 #3/§4；R2.1 增补姊妹断言与通道注释——SA2 R2 A/C） | **注入通道【R2.1】**：核心约束 = 注入后**不经 loadDoc decode**（yjs ContentAny 在同一 doc 实例内本地持有原对象引用——F-3 的 cyclic META 直注即存在性证明：decode 无法还原环；反之 ContentAny 编解码会把 descriptor 标准化）；**fake handle（直接持自建 Y.Doc，close-lifecycle makeFakeHandle 同款）与 createDoc 后经 `handle.doc` 直注两通道均可**（两者注入后均无 decode），勿经「另实例 loadDoc 读回」通道。场景①：live META 注入 `Object.defineProperty(arr, 0, {value:5, enumerable:false})` 数组值 → `getMetadata()['arr']` **照常投影该元素值 5**（其余元素原样）；场景②（**R2.1 姊妹断言**）：同数组另一下标 `Object.defineProperty(arr, 1, {})`（non-enumerable ∧ value undefined）→ `getMetadata()` throw `MetaProjectionError` code `NSRT-META-E1`，message 含 `数组位置 undefined 不可投影`（**锁定现行 violation 消息，防漂移到「值域违规：undefined」**——§7.2 R2.1 子情形的行为证据） | 场景①：**绿（存量语义锁定锚）**——锁死「数组元素面 non-enumerable 下标可读」现行语义，防 SA3 适配 ownDataFact 时按对象面 skip 先例发明行为（§7.2 R2 映射①的行为证据）；场景②：**绿（存量消息锁定锚）**——两场景均为现行行为锚定（D-7 提取前后的不变量） | D-7 |

---

## §9. 改锚清单（全部既有断言修改：文件:行 / 旧锚 / 新锚 / 理由）

### 9.1 runtime-acceptance-exports-audit.test.ts

| 位置 | 旧锚 | 新锚 | 理由 |
|---|---|---|---|
| :21-24 | 键集 `['RuntimeWriteFatalError','createNamespaceRuntimeWithSeam']` + 用例名「无生产构造器/运行态/包内 seam 泄漏」 | 键集 `['RuntimeWriteFatalError']`；用例名改「值导出恰一键——seam 已撤出公共面（AC6 rev2）」 | D-1/裁决 A：seam 值撤出 index.ts |
| :27-43 | forbidden 清单（不含 seam） | forbidden 清单追加 `'createNamespaceRuntimeWithSeam'`（与 createNamespaceRuntime 并列 toBeUndefined） | D-1：公共面对 seam 零暴露的正向锁定 |
| :45-49 | `typeof entry.createNamespaceRuntimeWithSeam === 'function'`；用例名「seam 构造器是唯一导出构造路径」 | 删除该断言；用例改「唯一值导出 RuntimeWriteFatalError 是 function；seam 经包内模块通道 `'../src/runtime.js'` 消费（本文件头注契约来源行同步改）」 | D-1/裁决 A |
| :10-12（头注） | 「只导出类型 + @internal 包内确定性 seam 构造器」 | 「值导出恰 RuntimeWriteFatalError；seam 与生产工厂保留 runtime.ts 模块级、不经本入口」 | D-1 |

### 9.2 runtime-public-surface-ownership.test.ts

| 位置 | 旧锚 | 新锚 | 理由 |
|---|---|---|---|
| :55 | `import { createNamespaceRuntimeWithSeam } from '../src/index.js'` | `from '../src/runtime.js'`（:56 `import * as publicEntry` 不变） | D-1 |
| :84-88 | `expect(entry.createNamespaceRuntimeWithSeam).toBeTypeOf('function')`；用例名「包内 seam 是唯一导出构造路径」 | `expect(entry.createNamespaceRuntimeWithSeam).toBeUndefined()`；用例名「生产构造器与测试 seam 均不从公共 package entry 导出（seam 经包内模块通道消费）」 | D-1/裁决 A |
| :21-24（头注） | 「seam 构造器从同一入口导出」 | 「seam 从包内 `'../src/runtime.js'` 导入（AC6 rev2：公共入口零 seam 暴露）」 | D-1 |

### 9.3 runtime-close-lifecycle.test.ts

| 位置 | 旧锚 | 新锚 | 理由 |
|---|---|---|---|
| :34 | `import { createNamespaceRuntimeWithSeam, RuntimeWriteFatalError } from '../src/index.js'` | 拆分：`RuntimeWriteFatalError` 留 index；seam 改 `'../src/runtime.js'` | D-1 |
| :184-187 | 「四 getter 闭前基线捕获（post-close 继续可用 + 数据原样）」 | 保留三 getter 闭前捕获（正值面：ready 期投影工作）；注释改「闭前基线（post-close 停接纳对照）」；`getStatus()` 闭前值保留 | D-2 |
| :212-221 | post-close 三 getter `not.toThrow()` + 值不变（toEqual envBefore/metaBefore/activeBefore） | post-close 三 getter 各自同步 throw：`err.code==='RUNTIME_READ_DISABLED'`、`err.message` 含 `'closed'` 与 getter 名；闭前捕获值仅作对照说明（不再断言相等——读取已停接纳）；`envBefore` 四键相等断言（:216）保留（ready 期投影正确性） | D-2/裁决 B：round 1 锚解除（词条向 ADR 0008 收敛，SA8 判定非行为回归） |

### 9.4 runtime-acceptance-fullchain.test.ts

| 位置 | 旧锚 | 新锚 | 理由 |
|---|---|---|---|
| :36 | `import { createNamespaceRuntimeWithSeam, RuntimeWriteFatalError } from '../src/index.js'` | `import { RuntimeWriteFatalError } from '../src/index.js';` + `import { createNamespaceRuntimeWithSeam } from '../src/runtime.js';` | D-1 |

### 9.5 其余 14 个仅动 import 行文件（其中 3 个为拆分行——mutate-root-sa7-dynamic / replace-schema-sa7-dynamic / write-fatal-message-rev1，见 §1.5 备注列；断言零变化；R2 标签修正——SA2 R1 #6）

metadata-proto-key:29 / degraded-two-adapter:34 / boundary-supplementary:24 / close-sa7-dynamic:27 / mutate-root-persistence:36 / mutate-root-sa7-dynamic:27（该文件 :27 为拆分行，`RuntimeWriteFatalError` 留 index）/ mutate-root-sequencer:65 / mutate-root-snapshotter-array:45 / p0-sequencer:43 / replace-schema-persistence:39 / replace-schema-sa7-dynamic:41（拆分行）/ replace-schema-sequencer:74 / sync-read-face:38 / write-fatal-message-rev1:40（拆分行）。理由同 D-1（seam 消费通道切换，`'../src/index.js'` 的类型导入行不动）。

---

## §10. 文件清单（File Scope）

### ALLOW LIST

**生产源码（src）：**
- `packages/namespace-runtime/src/index.ts` — 修改，D-1：删 seam 值/类型导出 + 头注公共面纪律段重写（净 -3 行 / 注释 ~+10 行）
- `packages/namespace-runtime/src/runtime.ts` — 修改，D-2：三 getter 门禁（每处 +3 行）+ import RuntimeReadDisabledError + 接口 JSDoc/十键注释同步（≈ +25 行）
- `packages/namespace-runtime/src/errors.ts` — 修改，D-2：新增 RuntimeReadDisabledError 类（≈ +20 行）；D-4：SchemaProjectionError code 宽化为 E1|E2 双码（≈ +6 行）
- `packages/namespace-runtime/src/projection.ts` — 修改，D-4：载体分支 mode 分流 + E2 构造 + 头注/JSDoc 修订；D-7：消费 plain-data.ts、删本地 isPlainRecord/yjsWord/describe/putMetaKey 并适配 readableOwnDataValue/readableArrayElement（净 ≈ -60/+30 行）
- `packages/namespace-runtime/src/write.ts` — 修改，仅 D-7：copyFrozen 两分支 descriptor 读改 ownDataFact 分派 + 产物写入改 putPlainKey（消息与查序逐字节保留，≈ ±40 行）
- `packages/namespace-runtime/src/plain-data.ts` — **新建**，D-7：共享 descriptor-safe 原语层（≈ 120 行，含头注纪律）
- `packages/doc-runtime/src/schema-replace.ts` — 修改，仅 D-3：catch 两级 fatal 制 + E206 消息 + 头注/JSDoc/@throws 修订（≈ ±45 行）

**测试（[SA6 owned]——SA6 创建/改写红灯与验收锚；SA3 仅可动测试基础设施，不动断言逻辑）：**
- `packages/namespace-runtime/test/runtime-acceptance-exports-audit.test.ts` — [SA6 owned] 修改，D-1 改锚（§9.1）+ T1.4
- `packages/namespace-runtime/test/runtime-public-surface-ownership.test.ts` — [SA6 owned] 修改，D-1 改锚（§9.2）
- `packages/namespace-runtime/test/runtime-close-lifecycle.test.ts` — [SA6 owned] 修改，D-1 import + D-2 改锚与新用例 T2.1–T2.4（§9.3/§8）
- `packages/namespace-runtime/test/runtime-acceptance-fullchain.test.ts` — [SA6 owned] 修改，D-1 import（§9.4）+ D-6 U-1..U-4 新用例
- `packages/namespace-runtime/test/runtime-acceptance-production-assembly.test.ts` — [SA6 owned] **新建**，D-5 T5.1/T5.2
- `packages/namespace-runtime/test/runtime-schema-carrier-split.test.ts` — [SA6 owned] **新建**，D-4 T4.1–T4.5
- `packages/namespace-runtime/test/runtime-replace-schema-sa7-dynamic.test.ts` — [SA6 owned] 修改，D-1 import + D-3 注入路径 δ（T3.1/T3.2）
- `packages/namespace-runtime/test/metadata-proto-key.test.ts`、`runtime-acceptance-degraded-two-adapter.test.ts`、`runtime-boundary-supplementary.test.ts`、`runtime-close-sa7-dynamic.test.ts`、`runtime-mutate-root-persistence.test.ts`、`runtime-mutate-root-sa7-dynamic.test.ts`、`runtime-mutate-root-sequencer.test.ts`、`runtime-mutate-root-snapshotter-array.test.ts`、`runtime-p0-sequencer.test.ts`、`runtime-replace-schema-persistence.test.ts`、`runtime-replace-schema-sequencer.test.ts`、`runtime-sync-read-face.test.ts`、`runtime-write-fatal-message-rev1.test.ts` — [SA6 owned] 修改，各仅 seam import 行切换（§9.5，断言零变化）

**文档（docs）：**
- `CONTEXT.md` — 修改，仅停接纳词条（L75-77）按 §2.7 新文字修订（AC7 义务；SA8 裁决 B ③）

### DENY LIST

- `docs/adr/0007-*.md`、`docs/adr/0008-*.md` 及其余 `docs/adr/000*.md` — ADR 正文零改动（SA8 约束 7：全部裁决在既有条款与 L125 注册表归属机制内兑现）
- `packages/namespace-runtime/package.json` — exports 键集维持 `{"."}` 不变（裁决 A：不新增 ./testing 键）
- `packages/doc-runtime/src/{replace,materialize,mutation,extract,detached-build,carrier,tx-guard,install-verify,fatal,read}.ts` — doc-runtime 仅 schema-replace.ts 在本轮半径内（SA8 C/I）；materialize-root-rev2 与 E100/E200/E205 既有锚面不动
- `packages/namespace-runtime/src/{sequencer,status,close,schema-write,p0}.ts` — D-2/D-3/D-6 零改动（门禁在 runtime.ts 公共面层；fatal 透传通道已存在；p0 模式禁 fatal 由 projection 分流保证）
- `packages/persistence/**`、`packages/vfsl/**` — 本轮零改动
- `TASK.md`、`docs/namespace-runtime*.md`（如存在包级 README/docs） — 本轮不触碰（AC7 的 docs 对齐面由本设计 + CONTEXT 词条承担；如 SA4 静态评审发现包级文档与公共面表述冲突，属新攻击点另行处理）

---

## §11. 协议假设依据 (Protocol Assumption Evidence)

| 假设 | 依据类型 | 依据内容（具体引用） | 风险等级 |
|---|---|---|---|
| `doc.getMap('SCHEMA')` 在同名非 Y.Map 条目上 throw | 源码引用 | projection.ts:67-73 注释「实测 §12 #2」+ 现行 catch 依赖；schema-replace.ts probeSchemaMap:244-259 四级探针同款依赖 | 低 |
| `doc.share.has('SCHEMA')` 只读探测不创建条目 | 源码引用 | projection.ts:62-66 现行使用（注释引 Doc.d.ts:44 公开 typed 属性） | 低 |
| createDoc 接受预构建 Y.Doc（含任意顶层条目形态） | 现有测试引用 | runtime-acceptance-fullchain.test.ts:57-79（makeDoc → createDoc）；ADR-0006 #64「持久层仅校验 META.docId」 | 低 |
| createDoc 后经 `handle.doc` live 注入异型 SCHEMA 可达（绕过持久层编码面） | 现有测试引用 | runtime-boundary-supplementary.test.ts:72（F-3 同款注入技术：`handle.doc.getMap('META').set(cyc)`） | 低 |
| Memory/FilePersistence 公开 I/O hook 与 restart 形可用 | 现有测试引用 | fullchain:84-98（makeMemoryPair）、:186-203（withFilePair/restart） | 低 |
| **doc 源深度无前置闸（R2 新增——SA2 R1 #1.5：与 §3.2.2 对账，消除 R1 内部矛盾）** | 源码引用 + 事实修正 | `snapshotMutation` 只冻结调用方输入、不遍历 live Y.Doc（write.ts:247-256，SA2 R1 §0 复核 ✓）；createDoc 接受任意深度预构建 doc（上行 + fullchain:57-72）；loadDoc 仅校验 META.docId（ADR-0006 #64）。**深 doc × keep-root 的溢出由 extract/validate 各自的全函数体崩溃边界吸收为领域级 ok:false**（extract.ts:52-80 INV-6「绝不外抛」；vfsl validate.ts `interpret` :598-646 全函数体 try/catch）——不产生 E206、不锁修复通道（T3.4 锚定） | 低 |
| Node/V8 引擎行为依赖 | 设计决策 | **无**——D-3 选择整体撤销后，唯一候选引擎假设（V8 RangeError 消息串）被消除；全设计零 HTTP/WS/端口/进程生命周期假设 | 无 |

## §12. 契约改动连锁审计 (Contract Change Caller Audit)

### 改动函数/方法

| 成员 | 文件 | 改动前契约 | 改动后契约 |
|---|---|---|---|
| `getSchemaEnvelope` | packages/namespace-runtime/src/runtime.ts:90,195 | `() => SchemaEnvelope \| null`（一切 lifecycle 可调；异型载体 → null） | 同返回类型；lifecycle≠ready → **throw** RuntimeReadDisabledError（code RUNTIME_READ_DISABLED）；ready 期异型载体 → **throw** SchemaProjectionError E2（D-4） |
| `getMetadata` | runtime.ts:92,196 | `() => Record<string, unknown>`（一切 lifecycle 可调） | 同返回类型；lifecycle≠ready → throw RuntimeReadDisabledError |
| `getActiveSchema` | runtime.ts:94,197 | `() => ActiveSchemaInfo \| null`（一切 lifecycle 可调） | 同返回类型；lifecycle≠ready → throw RuntimeReadDisabledError |
| `prepareSchemaReplace`（经 `replaceSchemaAndRoot` 外显） | packages/doc-runtime/src/schema-replace.ts:136-208 | 非 sentinel 意外异常 → return `{ok:false, issues:[DOCRT-E200…]}` | 非 sentinel 意外异常 → **throw** `DocRuntimeFatalError('pre-commit-internal', false, DOCRT-E206, {cause})` |
| `index.ts` 值导出 | index.ts:17 | 含 `createNamespaceRuntimeWithSeam` | 删除该值导出（模块消费方须改 `'../src/runtime.js'`） |

### Caller 清单

| Caller | 文件:行 | 是否 await | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---|---|---|---|---|
| 三 getter 全部生产调用方 | **无**（已 grep 核实：`packages/*/src` 与 apps 零调用；仅 runtime.ts 自身定义；schema-write.ts:178-179 仅注释提及） | N/A（sync） | N/A | N/A | 无生产涟漪；唯一调用方是测试（下行） |
| getter 测试调用方（ready 期） | sync-read-face:91-144、p0-sequencer:106-238、boundary-supplementary:87-135、sa7-dynamic:378-379、fullchain:110-145 等 | 否（sync） | — | — | 零影响（lifecycle===ready，门禁不触发）——零回归面 |
| getter 测试调用方（post-close） | runtime-close-lifecycle.test.ts:185-221（**唯一**，已全量 grep 核实） | 否（sync） | `expect(() => …)` 包装 | — | §9.3 改锚：not.toThrow → toThrow(code) ——round 1 锚解除（SA8 判定） |
| `replaceSchemaAndRoot` 唯一消费方 | packages/namespace-runtime/src/schema-write.ts:162（S5；已 grep 核实无其他，doc-runtime 无直接单测） | 否（sync 调用，结果在 async 槽内） | ✅ :167-174 catch：`instanceof DocRuntimeFatalError` → `rejectWithWriteFatal(env, err.committed, err.phase, err, 'schema')` 透传；未知异常 → unknown-pipeline-throw committed:true | sequencer 链尾恒绿 noop（sequencer.ts:26-40） | **零改动即正确**：E206 fatal 走既有 branded 透传分支 → RuntimeWriteFatalError(phase='pre-commit-internal', committed=false) → 永久禁写保读；rejection 经槽 Promise 送达 + 链尾消化无 unhandled |
| seam 值导入消费方 | 18 个测试文件（§1.5 全量清单） | — | — | — | import 路径机械切换 `'../src/runtime.js'`，断言零变化 |

### 风险评估

- 遗漏 getter caller 的代价：post-close throw 未捕获 → 测试进程 unhandled → CI 红（可即时发现）；生产面已核实零 caller，无运行时风险。
- 遗漏 seam 导入的代价：模块解析失败 → typecheck/test 即时红。抓全方法：`git grep -n "createNamespaceRuntimeWithSeam" -- 'packages/**'`（本轮已执行，§1.5 即全集：runtime.ts 定义 + index.ts re-export + 18 测试文件 + exports-audit/public-surface-ownership 注释）。
- E206 新 throw 的越级逃逸面：schema-write.ts S5 catch 全覆盖（branded/未知两分支），sequencer 链尾第二道消化——双层防御齐备。

## §13. 零回归边界（必须原样绿的既有行为锚）

| # | 锚 | 所在 | 关联 D-x | 为何不动 |
|---|---|---|---|---|
| 1 | snapshotter 数组分支四查次序（①②③④ 先于值读取；敌意 Proxy calls===0） | runtime-mutate-root-snapshotter-array.test.ts 全量 + write.ts:277-316 | D-7 | ownDataFact 仅提取 descriptor 读，查序与消息逐位保留 |
| 2 | F-3：循环 META → `getMetadata()` 抛**原始 RangeError**（登记态、无稳定 code、fatal 零污染、其余读取面照常） | runtime-boundary-supplementary.test.ts:66-96 | D-2/D-4/D-7 | 深递归在 copyMetaValue（位置不动）；ready 期门禁不触发；fatal 不 keyed on 数据缺陷 |
| 3 | fatal message rev1 子串锚（NSRT-WRITE-FATAL 模板、术语纪律「永久禁用……读取仍保留」） | runtime-write-fatal-message-rev1.test.ts 全量 | D-3/D-6 | writeFatalMessage/标记机械零改动；E206 只影响 cause，不改 Runtime 层 message |
| 4 | A4 红线：DerivedInvariantError → pre-commit-internal branded rejection（非 E200 ok:false）+ 零写入 + notifier 0 | runtime-replace-schema-sa7-dynamic.test.ts:333-388（γ） | D-3 | sentinel 分支逐字节保留 |
| 5 | 十键键集恰（owner…close）+ 无事件订阅键 | runtime-close-lifecycle.test.ts:153-177 | D-2 | 门禁不加键 |
| 6 | 七键 status 键集 + closing/closed 位值 + close 摘要稳定 | runtime-close-lifecycle.test.ts:375-412、:328-371 | D-2 | status.ts 零改动 |
| 7 | close 幂等（同 Promise 实例）/排空不取消/release 恰一次/release 失败双通道 | runtime-close-lifecycle.test.ts:179-371、runtime-close-sa7-dynamic.test.ts 全量 | D-2 | close 机械零改动 |
| 8 | read() 停接纳结果联合（RUNTIME_READ_DISABLED、path echo、非抛非 Promise） | runtime-close-lifecycle:195-201、fullchain:167-173 | D-2 | read 分支不动 |
| 9 | fatal 期 read 保留（ok:true）+ close 后才停 | runtime-close-lifecycle.test.ts:414-441 | D-2 | 门禁 key 仅 lifecycle |
| 10 | unavailable 期 getter 照常投影（TEXT_BAD envelope）/ preparing 期 getActiveSchema null | runtime-p0-sequencer.test.ts:183-197、runtime-sync-read-face.test.ts:87-97 | D-2/D-4 | 门禁不 keyed on schemaState；缺席 null 保留 |
| 11 | P0 unavailable 摘要派生（SCHEMA_ENVELOPE_\*/SCHEMA_TEXT_INVALID）+ SCHEMA write 修复路径 | runtime-p0-sequencer.test.ts、schema-write S4 流 | D-4 | p0.ts/schema-write.ts 零改动 |
| 12 | persistence 缺席宽容（「Permissive: correct docId, no SCHEMA」） | persistence 共享套件 | D-4 | 缺席分支 null 保留 |
| 13 | meta proto-key 四真（own '__proto__' 键、原型恒 Object.prototype、String() 可消费） | metadata-proto-key.test.ts 全量 | D-7 | putPlainKey = 同一 defineProperty 调用 |
| 14 | 极深 XML 树装配溢出 → DOCRT-E200 ok:false + 零写入（materializeRoot 面） | materialize-root-rev2.test.ts:369-393 | D-3 | materialize.ts 零改动（SA8 C/I 边界） |
| 15 | degraded 两 Adapter 面（persistence-degraded 阻写不阻读、降级竞态、最新 live doc 最终持久化） | runtime-acceptance-degraded-two-adapter.test.ts 全量 | 全部 | write/p0/schema-write 槽机械零改动（仅 import 行切换） |
| 16 | fullchain 既有三用例（Memory 全链 / File 全链 / committed fatal × Memory） | runtime-acceptance-fullchain.test.ts:100-316 | D-5/D-6 | 断言零变化，仅 import 拆分 + 追加新用例 |
| 17 | sync read 面全量（P0 pending 读取立即可用、四键忽略额外键、META 深拷贝独立副本） | runtime-sync-read-face.test.ts 全量 | D-4/D-7 | ready 期投影行为不变 |
| 18 | 类型面双 guard（close 十键 / replaceSchema 输入联合） | runtime-close-lifecycle-type-guard.test-d.ts、runtime-replace-schema-type-guard.test-d.ts | D-1 | 类型导出清单保留项完整（11 类型） |
| 19 | **深 doc × keep-root → 领域级 E 层吸收（DOCRT-E100 / VFSL-E100 / 预算）零写入 + fatal 零置位 + provide-root 修复通道开放**（R2 新增锚——SA2 R1 #1.4） | T3.4（本轮新增 ε 用例锚定） | D-3 | extract.ts:52-80 / validate.ts interpret :598-646 自有崩溃边界不动（本轮零触碰两文件）；锚定目的是把「深 doc 不产生 E206」从隐性行为变为显性契约 |

## §14. 一致性自检与交付声明

- **自检**：全文「seam」出现在公共面的表述统一为「撤出 index.ts / 保留 runtime.ts 模块级 / 测试经 `'../src/runtime.js'`」；「停接纳」在三 getter 面统一为「同步 throw RUNTIME_READ_DISABLED（key 仅 lifecycle）」；「E200」在 schema-replace 统一为「已删除/落 E206」，在 replace/materialize/mutation 统一为「保留不动」；「NSRT-SCHEMA-E2」统一为「public throw / p0 数据级收编」。**R2 增检**：「doc 源深度」相关表述统一为「无前置闸 + extract/validate 双层自有边界吸收」（§3.2.2 修正 2 ↔ §3.4 头注 ↔ §11 新行 ↔ T3.4 ↔ §13#19 五处对账一致）；「ownDataFact kind 映射」在 §7.1 类型 ↔ §7.2 两消费面 ↔ T7.2 三处对账一致（数组元素面 non-enumerable = 照常读值；write 数组 ③ = 防御 throw + undefined-value 放行）。
- **SA8 约束清单死锁**：无（§0.3）。
- **SA2 评审**：R1 verdict=reject（1 MUST + 3 SHOULD + 2 NICE）已逐条落实，见文末「SA2 R1 反馈逐条回应」表；D-1/D-2/D-4/D-5/D-6 与 D-7 主体经 SA2 独立复核坚实，本轮未改动其契约内容。
- **产出**：本文件即唯一设计产出；SA1 不改 src/test/docs 任何文件。

## SA2 R1 反馈逐条回应

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| #1 [MUST] D-3 代价审计虚假前提修正（五条：①§3.2.2 诚实版 ②§3.4 头注作用域 ③有意识决策记录 ④T3.4 锚 ⑤§11 补行） | ✅ | §3.2.2（整体改写）/ §3.2.1（候选三引用同步对账）/ §3.2.3（新增）/ §3.4（头注重写）/ §8 T3.4（新增）/ §11（新增 doc 源深度行）/ §13（新增 #19） | ①撤回「受控写建立深度/帧成本差边际带」假前提，改写为三条 R2 事实修正：闸作用域仅 provide-root 公共面输入（snapshotMutation 不遍历 live Y.Doc）；**深 doc × keep-root 的溢出在到达 prepare catch 之前已被 extract（extract.ts:52-80 INV-6）/ validate（validate.ts interpret :598-646）各自的全函数体崩溃边界吸收为领域级 ok:false——不产生 E206、不锁修复通道**（比 SA2 R1 §1.1 推演链的落点更早被吸收）；keep-root 的 E206 可达面 = 结构性空集（catch 覆盖为纯纵深防御）。②头注「snapshotter 先拦截」句作用域限定为 provide-root 公共面输入 + 修复指引。③§3.2.3 决策记录：接受面三条（δ 面 fatal 化 / 未来无边界组件逃逸一律 fatal 的有意识默认 / 与 CONTEXT「载体投影读取」排除声明对齐——「跨程序损坏文件的写修复不在本轮保护面」）+ 修复操作指引（疑似深/损坏 doc 直接走 provide-root）。④T3.4：真实深 doc（迭代构建 20_000–50_000 层嵌套，materialize-root-rev2:365-367 标定先例）→ keep-root → **锚真实行为**（resolved ok:false + `/DOCRT-E100\|VFSL-E100\|预算/` + 零写入 + fatal 零置位 + 同 runtime provide-root 修复成功）——**择一声明**：不按 R1 §4 原案锚 E206（经源码核实在该场景结构性不可达，锚之即伪锚）；亦弃「seam 注入 extract-throw」（extract 自有边界使其不可外抛，无可注入点）；E206 分类面由 δ（T3.1）覆盖。含 CI 不稳回退预案。⑤§11 新行与 §3.2.2 对账消除 R1 内部矛盾。 |
| #2 [SHOULD] T4.1 fixture 前提（预置不含 SCHEMA；getText 异型 throw 伪红警示；share.has 前置断言） | ✅ | §8 T4.1 场景列 | 补 fixture 前提全句（预置不含 SCHEMA 载体 / 勿复用标准 makeDoc / getText-throw 机理警示 / `share.has('SCHEMA')===false` 前置断言）；先例引用修正为 extract-yjs-snapshot.test.ts:518（从缺席起步的异型创建先例——原「F-3:72 同款技术」引用不当：F-3 是向**已存在** Y.Map set 值，非创建异型同名条目） |
| #3 [SHOULD] ownDataFact kind 映射补全两处 + non-enumerable 数组下标可读锁定锚 | ✅ | §7.1（OwnDataFact 类型 'non-enumerable' 携带 value）/ §7.2（两处显式映射）/ §7.3（等价论证补全声明）/ §8 T7.2（新增锚） | ①readableArrayElement：'non-enumerable' → 照常读值（ok+fact.value）——与 readableOwnDataValue 的 skip **有意不同**（数组元素无键空间概念），类型层为支撑此语义给 non-enumerable kind 携带 value；②write 数组 ③：'non-enumerable' → 防御性 throw「数组携带非枚举 own 键」（与 ② 全局拦截消息对齐，结构性不可达）、'undefined-value' → ③ 放行、维持 ⑤ 值读取期 throw 次序（消息字面量相同的次序锁定）；T7.2：live Y.Doc META 注入 defineProperty 非枚举下标数组（不经 persistence round-trip——编码会标准化 descriptor）→ getMetadata 照常投影该元素，锁死语义防 SA3 发明行为 |
| #4 [SHOULD] §4.4 交叉引用错位 | ✅ | §4.4 末句 | 「锚 T4.3」→「锚 T4.2（R2 修正标注）」——组合锚在 §8 矩阵为 T4.2，T4.3 是缺席对照；矩阵本身不动 |
| #5 [NICE] T1.4 红灯标记失实 | ✅ | §8 T1.4 预期列 | 「**红**（新增）」→「**绿（存量审计锚）**——防未来回潮的锁定锚」+ 如实标注说明（断言当前 package.json 真实现状，首跑必绿） |
| #6 [NICE] §9.5 标签与内容不符 | ✅ | §9.5 标题 | 「其余 14 个纯切换文件」→「其余 14 个仅动 import 行文件（其中 3 个为拆分行——mutate-root-sa7-dynamic / replace-schema-sa7-dynamic / write-fatal-message-rev1，见 §1.5 备注列；断言零变化）」 |
| R2.1 [SHOULD] §7.2 映射①子情形（SA2 R2 pass 后顺手项 A） | ✅ | §7.2 映射①行 + §8 T7.2 场景② | 补「`'non-enumerable' ∧ fact.value===undefined` → 维持现行 violation『数组位置 undefined 不可投影』」（projection.ts:281-283 现行不区分枚举性；无条件 ok+fact.value 会漂移为 E1「值域违规：undefined」——同码同 loud 仅消息漂移，消息即断言面须锁死）；T7.2 增姊妹断言（`Object.defineProperty(arr, 1, {})` → NSRT-META-E1 + 消息含现行 violation 文本），标注为存量消息锁定锚 |
| R2.1 [NICE] T3.4 timeout 取舍（顺手项 B） | ✅ | §8 T3.4 条目末 | 增「深度取 20_000（rev2 标定先例值）+ 用例级显式 `{ timeout: 30_000 }` 双保险」取舍说明——O(DEEP²) path 复制墙钟成本下 50_000 有超 vitest 默认 5s 风险，不取「更大深度换确定性」（20_000 已充分） |
| R2.1 [NICE] T7.2 注入通道注释（顺手项 C） | ✅ | §8 T7.2 场景列首 | 写明核心约束 = 注入后不经 loadDoc decode（ContentAny 本地持原引用，F-3 cyclic 直注为存在性证明；decode 会标准化 descriptor）；fake handle 与 createDoc 后 `handle.doc` 直注两通道均可，勿经另实例 loadDoc 读回 |
