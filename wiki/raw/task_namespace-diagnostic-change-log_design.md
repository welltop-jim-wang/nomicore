# SA1 设计 — Issue #150: namespace create 生命周期与 genesis 接入诊断变更日志

- **Repository:** welltop-jim-wang/nomicore（worktree `/home/wangjian/nomicore-fix-issue-150`）
- **任务类型:** Feature（ADR-0011/0012 的 create 接线票，接线票清单 #149–#151/#155 之一）
- **红灯契约:** `packages/namespace-registry/test/registry-create-diagnostic-red.test.ts`（16 it，16/16 红，SA6 Phase 1 冻结）
- **上游契约源:** ADR-0011（best-effort 诊断变更日志）、ADR-0012（JSONL/framed 格式 + File adapter first-slice amendment）、ADR-0009（Registry create 行为）、ADR-0006（createDoc/DOC_DUPLICATE）、ADR-0007（compile/validate）、ADR-0008（Runtime/P0/写序列器纪律）
- **依赖现状:** `@nomicore/namespace-diagnostic-log`（#148 冻结 emission/record/vocabulary + #152 File adapter）已在 worktree 落地；`@nomicore/namespace-runtime` 已完成 #149 接线（`src/diagnostic.ts` 为本设计的直接先例——producer 只做语义 emission、emitAttempt 吞没一切、code↔sourceModule 成对）
- **设计轮次:** R2（R1 被 SA2 reject——三强制项 + LOW 文档项逐条落实，见文末回应表）

---

## §1 任务定位与范围

### 1.1 一句话目标

把 `NamespaceRegistry.create` 的**全部结局路径**（从公共入口的停接纳/身份拒绝，经槽内 duplicate/快照/编译/校验/Persistence 提交，到 post-commit Runtime 构造）接入可选注入的 namespace 诊断变更日志：每次尝试恰一条 `namespace-create` attempt 语义 emission；提交事实确立后向 Host 供给 detached genesis bytes 建立 stream；一切日志侧行为（emitter 违约、时钟故障、队列压力、stream 初始化失败）对 create 的返回值、Persistence 状态与 Registry 生命周期**零影响**。

### 1.2 范围内 / 范围外

**范围内（本票唯一交付）**：
- Registry 包新增 `diagnosticLog` 注入 seam（生产 options + testing overrides 等价面）；
- create 路径全结局点的 emission 接线（stage/code/result/input/issue 事实全部摘自 Registry 既有稳定面，零发明）；
- committed 后 genesis bytes 供给 + `initStream` stream 建立缝调用；
- `@nomicore/namespace-diagnostic-log` 进入 registry 包 `dependencies`（类型级消费）。

**范围外（显式排除）**：
- `open` 路径：ADR-0011「普通 read/open 不尝试修改 Y.Doc，不属于变更尝试」→ 零记录；
- `mutateRoot` / `replaceSchema`（`root-mutation` / `schema-replacement` operations）：归 #149（已完成）与 #151；
- `replication-*` operations：归 #155 及后续票；
- Cordis 插件配置面：`plugin.ts` config 键集冻结为 `{ idleTimeoutMs? }`（#112 §2.F），诊断日志启用是 Host **编程面**（`createNamespaceRegistry` 直连 options），不经插件配置——本票不改 `plugin.ts`；
- 诊断日志包（#148/#152 冻结契约）：只消费、不修改；
- shutdown 时 drain：ADR-0011 允许 Host best-effort drain，但 Registry 的停止不得无限等待日志 sink——本票 emit 恒同步 void、无在途队列，无需 drain 逻辑。

---

## §2 现状分析与需求推演

### 2.1 红灯根因（SA6 2026-08-30 验证：16/16 统一签名「0 记录 / 0 emit / 0 initStream」）

当前 worktree 的 create 路径（`registry.ts` `runCreateSlot` / `admitCreateSlot` / 公共入口 `create`）：

1. **seam 层缺席**：`CreateNamespaceRegistryOptions` / `NamespaceRegistryTestingOverrides` / `NamespaceRegistryInternalOptions` 均无 `diagnosticLog` 字段——测试经 `seam as never` 透传的注入被静默忽略；
2. **发射层缺席**：create 各结局路径零 `emit` 调用；
3. **stream 建立缝缺席**：`initStream` 零调用、genesis bytes 零供给；
4. **依赖层缺席**：`@nomicore/namespace-registry` 未依赖 `@nomicore/namespace-diagnostic-log`（测试以相对路径 `../../namespace-diagnostic-log/src/index.js` 引入真实 adapter 走通——包依赖修复属 SA3）。

所有 16 项失败均由「日志记录与 stream 初始化缺席」驱动；业务断言（create ok / createdAt / Clock 单读 / trap 计数 / 业务结果逐位一致）当前全绿——**修复必须保持这些业务面零漂移**（红灯测试的业务断言是隔离守卫，不是修复目标）。

### 2.2 需求推演（Feature 切入点）

create 路径的事实源与阶段已经全部存在于 Registry 既有代码中，日志只是**旁路投影**：

| 变更尝试事实 | 既有稳定来源（本设计的唯一事实源） |
|---|---|
| 停接纳拒绝 | `registry.ts` `create()` 入口 `acceptance !== 'running'` → `NOT_ACCEPTING_ISSUE`（code `REGISTRY_NOT_ACCEPTING`） |
| 身份/顶层形状拒绝 | `acceptCreateIdentity` → `NAMESPACE_INVALID_IDENTITY` / `NAMESPACE_CREATE_INVALID_INPUT`（`identity.ts`） |
| entry duplicate | `runCreateSlot` active/idle 分支 → `ALREADY_EXISTS_ISSUE`（`NAMESPACE_ALREADY_EXISTS`，ADR-0009「四源同码」） |
| payload 快照失败 | `snapshotCreatePayload` → `{ok:false}` → `CREATE_INVALID_INPUT_ISSUE` |
| Clock 读数 | `readCreatedAtOrFatal` 单次 `clock.now()` → `createdAt` ISO 字符串（ADR-0009 单次读数冻结） |
| schema 编译失败 | `createDocument` → `initial.kind === 'schema-invalid'` + verbatim issues（vfsl `SchemaParseIssue[]`） |
| ROOT 校验失败 | `createDocument` → `initial.kind === 'root-invalid'` + verbatim issues（vfsl `ValidateIssue[]`） |
| Persistence duplicate | `createDoc` throw `DocDuplicateError` → `ALREADY_EXISTS_ISSUE`（ADR-0006 `DOC_DUPLICATE` → Registry 同码） |
| Persistence 运营失败 | `createDoc` throw `DocCreateOperationalError` → `CREATE_FAILED_ISSUE`（`NAMESPACE_CREATE_FAILED`） |
| Persistence fatal | `DocCreateFatalError` / unknown throw → `NamespaceRegistryFatalError('create','lifecycle-slot-internal', cause.committed ?? false, cause)` |
| 提交成功 | `createDoc` resolve → `initial.doc`（doc-runtime `createInitialDocument` 单事务产物：SCHEMA 四键 / META 二键 / ROOT，ADR-0006 三条目布局） |
| post-commit 构造失败 | factory throw → `NamespaceRegistryFatalError('create','runtime-construction', true, cause)`（ADR-0009「以 committed:true Registry fatal reject；文档保留可 open」） |

**最佳切入点**：新建私有模块 `src/create-diagnostic.ts`（对齐 #149 `namespace-runtime/src/diagnostic.ts` 先例的职责边界），`registry.ts` 仅在既有结算点旁插一行调用——`registry.ts` 的 diff 控制在纯旁路插入，不动任何业务分支的判断与结算逻辑。

### 2.3 推演关键决策（Decision Record）

| # | 决策 | 理由 |
|---|---|---|
| DC-1 | genesis/update bytes 在 Registry create 槽内对 `initial.doc` 做 `Y.encodeStateAsUpdate`（不扩大 `create-document.ts` 契约） | 改 `CreateDocumentGatewayResult` 返回 bytes 会破坏既有 `registry-create.test.ts` 的 `createDocumentFactory` fixture 形状（scope creep）；ADR-0006 #64 已证明 Persistence `createDoc` 内部做过同款 encode（成功提交 ⟹ 可编码），槽内二次 encode 是幂等只读操作 |
| DC-2 | `initStream` 在 `createDoc` resolve（committed 事实确立）后、factory 调用前同步调用；factory 成败皆然 | lease 尚未签发、同 key 后续操作在 carrier FIFO 排队、P0 只读 SCHEMA（ADR-0008）⟹ 此刻无任何并发写，bytes 恒纯创建态（诚实 genesis）；factory 失败但文档已提交（ADR-0009「后续可 open」）时 namespace 已存在，stream 应已建立 |
| DC-3 | `observedAt` 的 Clock 不变量：**每次 create 尝试恰一次 clock 读数用于时间戳**——槽内 Clock 步已执行 ⟹ 复用 `createdAt` 字符串（零额外读数）；Clock 步之前终结的尝试 ⟹ 诊断侧读一次（业务侧零读数）；clock 故障 ⟹ 丢弃该条 emission（不伪造时间戳） | SA6 锚 `clock.calls === 1`（成功路径：业务读 1 + 诊断复用 0）；ADR-0009 Clock 单次读数冻结契约；ADR-0011 禁 `Date.now` 墙钟 |
| DC-4 | emission 的 issues 做 **producer 侧形状投影**（vfsl `SchemaParseIssue` / `ValidateIssue` → 诊断包 `DiagnosticIssue {code?, message, path}`），顺序逐条保留；**compile 类 issue 的 code 派生与 P0/SCHEMA 写槽既有单源规则逐字对齐**（envelope → `SCHEMA_ENVELOPE_${String(code)}`、vfsl 文本 → `SCHEMA_TEXT_INVALID`，见 §6.3.4）；投影整体在 create-diagnostic.ts 吞没 try 边界内执行（§6.3.1） | ADR-0012 冻结 emission.issues 形状 = 裸数组 `DiagnosticIssue[]`；诊断包 `projectIssues` 的 `isValidItem` 要求顶层 `message: string` + `path: Array`，vfsl 原形状（`{kind, issue}` / `{message, line, column}`）不过校验会被整条丢弃——红灯测试断言 `issues.items.length > 0`；issue 级 code 若另造前缀（R1 曾发明 `VFSL-ENV-E${…}`）会与 P0 unavailable 摘要（`p0.ts:134-148` `toIssueSummary`）及 SCHEMA 写槽（`schema-write.ts:315-317` 同源消费先例）产生码漂移——同一 vfsl 编译失败在不同模块出现两种码，破坏码域单源（SA2 R2-M1 落实） |
| DC-5 | 类型消费 = 纯 `import type`（零值级 import），对齐 #149 先例注释「避免值级引入诊断包模块导出拉入 reader/file 运行图」 | Registry 核心零 cordis/零新运行时依赖；emitter/initStream 实例全部由 Host 注入 |
| DC-6 | 测试未冻结的结局路径（入口 identity 拒绝、closing-entry fatal、clock fatal、`DocCreateFatalError`、unknown throw）由本设计给出**显式映射**（见 §6.2 总表） | 「SA1 漏列/含糊 = SA2 必攻击」；映射规则单源：stage = 尝试推进到的实际阶段在 8 值封闭词表内的投影，sourcePhase/code/committed 携带精确事实 |

---

## §3 契约锚点（SA6 红灯冻结，设计必须逐条满足）

### 3.1 注入 seam（字段名即锚点）

```ts
// 测试文件 :106-109 冻结形状（SA3 按此落地）
interface NamespaceRegistryDiagnosticLog {
  readonly emitter: NamespaceDiagnosticChangeEmitter;   // #148 冻结小接口（ADR-0011「Interface 与 seam」节）
  readonly initStream?: (namespaceId: string, genesisUpdateBytes: Uint8Array | undefined) => void;
}
```

- 经 `createNamespaceRegistryForTesting(persistence, { …, diagnosticLog })` 装配；
- 等价生产面 `CreateNamespaceRegistryOptions.diagnosticLog`；
- 测试以**真实 adapter**（`createBoundedMemoryDiagnosticLog` / `createFileDiagnosticLog`）装配——非 mock、非 fallback。

### 3.2 结局映射（测试冻结的 9 行；事实取 Registry 既有稳定码，零新码）

| 路径 | stage | code | result | input | initStream |
|---|---|---|---|---|---|
| 停接纳（shutdown 后 create） | `acceptance` | `REGISTRY_NOT_ACCEPTING` | `rejected` | `not-accessed`（零 trap） | 否 |
| entry duplicate | `acceptance` | `NAMESPACE_ALREADY_EXISTS` | `rejected` | `not-accessed`（schema/root 零 trap） | 否 |
| 持久层 duplicate（DOC_DUPLICATE） | `transaction` | `NAMESPACE_ALREADY_EXISTS` | `rejected` | `full`（快照已捕获） | 否 |
| payload 快照失败 | `input-snapshot` | `NAMESPACE_CREATE_INVALID_INPUT` | `rejected` | `unsafe-input`（accessor 零执行） | 否 |
| schema 编译失败 | `schema-compile` | `NAMESPACE_SCHEMA_INVALID` | `rejected` | `full` + issues 非空 | 否 |
| ROOT 校验失败 | `validation` | `NAMESPACE_ROOT_INVALID` | `rejected` | `full` + issues 非空 | 否 |
| Persistence 运营失败 | `transaction` | `NAMESPACE_CREATE_FAILED` | `rejected` | `full` | 否 |
| 成功提交 | `transaction` | **无**（ADR-0011「committed 无 code」；`sourceModule` 亦无——code↔sourceModule 成对） | `committed` + `effect:'update'` + 初始文档 owned bytes | `full` | **恰一次**，bytes = 提交初始文档 |
| 提交后 Runtime 构造失败 | `transaction` | `NAMESPACE_REGISTRY_FATAL` | `fatal committed:true` + `effect:'update'` + 初始文档 bytes | `full` | 是（见 DC-2） |

通用形状锚（`expectAttemptShape`）：`operation === 'namespace-create'`、`source` = `{kind:'local'}`、`attemptId` 匹配 `att-[0-9a-f]{32}`（producer 省略 → emitter 管线 CSPRNG 生成）、`observedAt === NOW_ISO`（注入 Clock 同源，禁墙钟）。

### 3.3 行为不变量（AC2–AC5）

- **AC2 genesis**：成功 create 后 `initStream` 恰一次、携带提交初始文档 detached bytes（空 Y.Doc 应用即物化 SCHEMA 四键 / META 二键 / ROOT）；真实 File adapter E2E：stream 上 `genesis-baseline`(seq 1) + `attempt`(seq 2)、manifest 存在、observedAt 同源注入 Clock；`clock.calls === 1`。
- **AC3**：合法 Proxy 输入下 logged 与无日志基线的 schema/root trap 计数相等（零额外读取）；排队后（createDoc gate 前）变异调用方原对象 → 记录 input 恒为槽内 frozen snapshot。
- **AC4 四不变**：emitter 违约 throw → create ok / status running / lease active / 创建恰一次 / emit 恰一次尝试；队列满（capacity 1）→ 第一条 accepted、第二条 queue-full drop（stats 计数），业务双创建均 ok；日志启用 vs 禁用 → 业务结果逐位一致且启用侧有记录；stream init 失败（真实 File adapter invalid roll targets）→ create ok + 独立健康 observer `LOG_STREAM_INIT_FAILED/invalid-roll-targets`（绝不手工伪造事件——事件由 Host 侧 file adapter 的 observer 产生，Registry 不代发）。
- **AC5**：延迟 stream 初始化以当时 Y.Doc 建新 stream → genesis 物化 `ROOT.n=2`（诚实当前态，非创建态 n=1）——该行为由 Host 侧 binding + file adapter 既有语义承载，Registry 只需保证首次 initStream 被调用且 bytes 诚实。

---

## §4 设计总览

```
Host（装配者，测试/生产同构）
  │  createNamespaceRegistry(persistence, { clock, scheduler, diagnosticLog? })
  │  diagnosticLog = { emitter: <#148 adapter emitter>, initStream?: <ADR-0012 stream 建立缝> }
  ▼
Registry（registry.ts — 业务主链零改动，仅结算点旁插一行）
  create() 公共入口 ──┬─ acceptance 拒绝 ──► diag.emitEntryOutcome(acceptance/REGISTRY_NOT_ACCEPTING/not-accessed)
  admitCreateSlot() ──┼─ identity 失败   ──► diag.emitEntryOutcome(identity/<issue.code>/not-accessed)
  runCreateSlot()  ───┼─ entry duplicate ─► diag.emitEarlyOutcome(acceptance/ALREADY_EXISTS/not-accessed)
                      ├─ closing fatal ×3 ► diag.emitEarlyOutcome(acceptance/FATAL+lifecycle-slot-internal/not-accessed)
                      ├─ 快照失败        ──► diag.emitEarlyOutcome(input-snapshot/CREATE_INVALID_INPUT/unsafe-input)
                      ├─ clock fatal     ──► (emission 丢弃 — 无时间戳可得，见 §6.4)
                      ├─ schema-invalid  ──► diag.emitOutcome(schema-compile/SCHEMA_INVALID + issues 投影/full)
                      ├─ root-invalid    ──► diag.emitOutcome(validation/ROOT_INVALID + issues 透传/full)
                      ├─ createDoc throw ──► diag.emitOutcome(transaction/<同码映射>/full)
                      ├─ createDoc ok    ──► genesis = encode(initial.doc); diag.initStream(ns, genesis.slice())   ← committed 确立
                      ├─ factory ok      ──► diag.emitOutcome(transaction/committed+update(encode bytes)/full) → issueLease
                      └─ factory throw   ──► diag.emitOutcome(transaction/FATAL committed:true + update/full) → throw
  ▼
create-diagnostic.ts（新私有模块 — 本设计的核心）
  · emission 组装（operation/source 固定、code↔sourceModule 成对、input/issues 投影、result 判别联合）
  · observedAt：复用 createdAt（零额外读数）或诊断侧单次读数（clock 故障 → 丢弃）
  · emit / initStream 全部 try/catch 吞没（ADR-0011「emitter seam 违约防御」条款的 producer 义务）
  ▼
Host 注入的 emitter（#148/#152 真实 adapter：memory bounded / file JSONL+framed）
```

---

## §5 注入 seam 类型设计

### 5.1 `types.ts` 新增（主入口可达声明图）

```ts
import type { NamespaceDiagnosticChangeEmitter } from '@nomicore/namespace-diagnostic-log';

/**
 * #150 诊断日志注入 seam：emitter 为 ADR-0011「Interface 与 seam」节冻结小接口；
 * initStream 为 ADR-0012 stream 建立缝（genesis bytes 由 producer 供给、
 * adapter 内部构造 genesis-baseline——CONTEXT.md「producer 只供 bytes」，
 * v1 emission/sink 公共面无 genesis 构造路径）。两成员均可选缺省：
 * 缺 emitter = 日志禁用（本 Registry 实例零诊断行为）；缺 initStream =
 * 只记录 attempt、不建立 stream（Host 选择延迟初始化——AC5 场景）。
 */
export interface NamespaceRegistryDiagnosticLog {
  readonly emitter: NamespaceDiagnosticChangeEmitter;
  readonly initStream?: (namespaceId: string, genesisUpdateBytes: Uint8Array | undefined) => void;
}
```

`CreateNamespaceRegistryOptions` 追加一个可选字段：

```ts
export interface CreateNamespaceRegistryOptions {
  readonly clock: Clock;
  readonly scheduler: RegistryTimeoutScheduler;
  readonly idleTimeoutMs?: number;
  readonly observer?: RegistryObserver;
  /** #150：可选 namespace 诊断变更日志（缺省 = 日志禁用，行为与既有完全一致）。 */
  readonly diagnosticLog?: NamespaceRegistryDiagnosticLog;
}
```

`index.ts` 类型导出白名单追加 `NamespaceRegistryDiagnosticLog`。

**声明纪律说明**：`types.ts` 头注禁令是「运行时对象 / 租约句柄 / 编辑器文档的命名类型标识符与内部 subpath 字面量」。`NamespaceDiagnosticChangeEmitter` 是 ADR-0011「Interface 与 seam」节明文要求业务模块依赖的**小 emitter 接口**（纯数据契约，非运行时对象/租约/文档类型），且为纯 `import type`（零运行时绑定、零值级引入诊断包运行图——对齐 #149 `namespace-runtime/src/diagnostic.ts:26-33` 同款先例）。这是唯一维护性合理的方案（结构性复制 emission 全类型会造成双源漂移）。

### 5.2 `registry.ts` / `testing.ts` 透传

- `NamespaceRegistryInternalOptions` 追加 `readonly diagnosticLog?: NamespaceRegistryDiagnosticLog`；
- `createNamespaceRegistry`（生产工厂）透传 `options.diagnosticLog`；
- `NamespaceRegistryTestingOverrides` 追加同款可选字段，`createNamespaceRegistryForTesting` 透传（对齐既有 runtimeFactory/observer/clock/createDocumentFactory 注入面模式）；
- `plugin.ts` **零改动**（见 §1.2 范围外；插件路径 = 日志禁用，Host 生产接线用编程面直连）。

### 5.3 依赖变更

`packages/namespace-registry/package.json`：

- `dependencies` 追加 `"@nomicore/namespace-diagnostic-log": "workspace:*"` 与 `"yjs": "^13.6.30"`（genesis encode 需要；yjs 目前在 devDependencies，src 值级消费后须上移——对齐 doc-runtime 先例）；
- `@nomicore/namespace-diagnostic-log` 与 yjs 均仅 `import type`/`import * as Y`（encode 单函数使用）级消费。

---

## §6 诊断接线模块设计（`src/create-diagnostic.ts` 新建）

### 6.1 模块职责与结构

对齐 #149 `diagnostic.ts` 先例：producer 只做语义 emission，物理投影（digest/base64/segment/stream 身份）全部留给 adapter。

```ts
// 模块头：零导出到公共面（index.ts 不 re-export；registry.ts 经相对导入消费）
import * as Y from 'yjs';
import type {
  DiagnosticIssue, EmissionInput, EmissionResult,
  NamespaceDiagnosticChangeEmitter, Stage,
} from '@nomicore/namespace-diagnostic-log';
import type { Clock } from '@nomicore/clock';
import type { NamespaceRegistryDiagnosticLog } from './types.js';

/** 诊断环境（构造栈一次成型）：diagnosticLog 缺席 = 全 no-op 的单例。 */
export interface CreateDiag {
  /** 槽内结局（observedAt 复用槽内 Clock 步的 createdAt 字符串——零额外读数）。 */
  emitOutcome(observedAt: string, e: CreateEmissionArgs): void;
  /** Clock 步之前终结的结局（observedAt 由本助手读一次 clock；clock 故障 → 丢弃）。 */
  emitEarlyOutcome(e: CreateEmissionArgs): void;
  /** stream 建立缝（committed 事实确立后调用；bytes 尽力供给）。 */
  initStream(namespaceId: string, genesisUpdateBytes: Uint8Array | undefined): void;
}

export interface CreateEmissionArgs {
  readonly stage: Stage;
  readonly result: EmissionResult;
  /** 与 sourceModule 'registry' 成对（emitAttempt 单点保证）。 */
  readonly code?: string;
  readonly sourcePhase?: string;
  /**
   * 原始（verbatim）issues——registry.ts 侧不投影，直接传业务结果里的原数组引用；
   * 投影（→ DiagnosticIssue[]，含码派生）在 emitOutcome/emitEarlyOutcome 的
   * 吞没 try 边界内执行（SA2 R2-M2：畸形 issues 任何路径都不可改变业务结局）。
   * issuesKind 选择投影器：'compile'（vfsl SchemaParseIssue[]，码派生对齐
   * p0.toIssueSummary）| 'validate'（vfsl ValidateIssue[]，逐字段同形透传）。
   */
  readonly rawIssues?: readonly unknown[];
  readonly issuesKind?: 'compile' | 'validate';
  readonly input: EmissionInput;
}

export function createCreateDiag(
  diagnosticLog: NamespaceRegistryDiagnosticLog | undefined,
  clock: Clock,
): CreateDiag;
/** genesis/update bytes 计算（doc 为 any-bridge；encode throw → undefined——诚实缺席）。 */
export function encodeDetachedState(doc: unknown): Uint8Array | undefined;
```

### 6.2 结局映射总表（全 18 结局点——SA6 冻结 9 行 + 测试未冻结的 9 行显式裁量）

stage 映射规则（单源）：**stage = 尝试推进到的实际阶段在 8 值封闭词表内的投影**；精确事实由 `code` / `sourcePhase` / `result.committed` 携带（ADR-0011「每条结局记录保留所属模块已有的稳定 code、phase、issues 顺序与 committed 事实」）。`sourceModule` 恒 `'registry'`（create 全部结局码出自 Registry 面；code↔sourceModule 成对，committed 记录两者皆无）。

| # | 结局点（registry.ts 位置） | stage | code | sourcePhase | result | input | observedAt 来源 | initStream |
|---|---|---|---|---|---|---|---|---|
| 1 | `create()` 入口 `acceptance !== 'running'`（:1041） | `acceptance` | `REGISTRY_NOT_ACCEPTING` | — | `{kind:'rejected'}` | `{status:'not-accessed'}` | 诊断侧读 clock | 否 |
| 2 | `admitCreateSlot` `acceptCreateIdentity` 失败（:782） | `identity` | `NAMESPACE_INVALID_IDENTITY` 或 `NAMESPACE_CREATE_INVALID_INPUT`（按 issue.code） | — | `{kind:'rejected'}` | `{status:'not-accessed'}` | 诊断侧读 clock | 否 |
| 3 | 槽内 entry duplicate（active/idle，:806） | `acceptance` | `NAMESPACE_ALREADY_EXISTS` | — | `{kind:'rejected'}` | `{status:'not-accessed'}` | 诊断侧读 clock | 否 |
| 4 | 槽内 closing 缺 closePromise fatal（:814） | `acceptance` | `NAMESPACE_REGISTRY_FATAL` | `lifecycle-slot-internal` | `{kind:'fatal',committed:false}` | `{status:'not-accessed'}` | 诊断侧读 clock | 否 |
| 5 | 槽内 closing await reject fatal（:829） | `acceptance` | 同上 | 同上 | 同上 | `{status:'not-accessed'}` | 诊断侧读 clock | 否 |
| 6 | 槽内 await 后仍 closing fatal（:843） | `acceptance` | 同上 | 同上 | 同上 | `{status:'not-accessed'}` | 诊断侧读 clock | 否 |
| 7 | 槽内 await 后新 entry duplicate（:839） | `acceptance` | `NAMESPACE_ALREADY_EXISTS` | — | `{kind:'rejected'}` | `{status:'not-accessed'}` | 诊断侧读 clock | 否 |
| 8 | payload 快照失败（:858） | `input-snapshot` | `NAMESPACE_CREATE_INVALID_INPUT` | — | `{kind:'rejected'}` | `{status:'unsafe-input'}` | 诊断侧读 clock | 否 |
| 9 | clock fatal（`readCreatedAtOrFatal` throw，:863） | — | — | — | — | — | **emission 丢弃**（clock 故障 → 无合法时间戳可得，不伪造——ADR-0011 best-effort 允许缺记录；业务 fatal 照常 reject） | 否 |
| 10 | schema-invalid（:893） | `schema-compile` | `NAMESPACE_SCHEMA_INVALID`（顶层 = Registry 稳定码，SA6 冻结） | — | `{kind:'rejected'}` | `{snapshot:{schema,root}}` + rawIssues（compile 投影：issue 级码 `SCHEMA_ENVELOPE_${code}` / `SCHEMA_TEXT_INVALID`，§6.3.4） | 复用 createdAt | 否 |
| 11 | root-invalid（:896） | `validation` | `NAMESPACE_ROOT_INVALID` | — | `{kind:'rejected'}` | `{snapshot:…}` + rawIssues（validate 投影：逐字段同形，§6.3.4） | 复用 createdAt | 否 |
| 12 | createDocument throw（:874，`create-document-internal`） | `schema-compile` | `NAMESPACE_REGISTRY_FATAL` | `create-document-internal` | `fatal`，`committed = cause instanceof DocRuntimeFatalError ? cause.committed : false`；committed:true 且无 owned bytes → `effect:'unknown'`，false → 无 effect | `{snapshot:…}` | 复用 createdAt | 否（未到 Persistence 提交点；seam 失败不返回 doc，bytes 不可得） |
| 13 | createDoc 不可达 input-invalid fatal（:901） | `schema-compile` | `NAMESPACE_REGISTRY_FATAL` | `create-document-internal` | `{kind:'fatal',committed:false}` | `{snapshot:…}` | 复用 createdAt | 否 |
| 14 | `DocDuplicateError`（:915） | `transaction` | `NAMESPACE_ALREADY_EXISTS` | — | `{kind:'rejected'}` | `{snapshot:…}` | 复用 createdAt | 否（已存在文档非本尝试产物） |
| 15 | `DocCreateOperationalError`（:918） | `transaction` | `NAMESPACE_CREATE_FAILED` | — | `{kind:'rejected'}` | `{snapshot:…}` | 复用 createdAt | 否 |
| 16 | `DocCreateFatalError`（:922）/ unknown throw（:939） | `transaction` | `NAMESPACE_REGISTRY_FATAL` | `lifecycle-slot-internal` | `fatal`，committed 原样传播（`cause.committed ?? false`）；committed:true 且 encode 可得 → `effect:'update'`+bytes，不可得 → `'unknown'` | `{snapshot:…}` | 复用 createdAt | 否（防御路径不建 stream；Host 可经延迟初始化补建——AC5 语义） |
| 17 | **成功**（:948-953） | `transaction` | —（无 code，无 sourceModule） | — | `state` 可得 → `{kind:'committed',effect:'update',updateBytes}`；`state === undefined`（encode 失败，不可达防御）→ **不构造该条 emission**（committed 无 bytes 不能伪装 update-omitted——v1 受控 reason 词表无 encode 失败位，扩词表须过设计评审；诚实缺席，见 §8.5 备案） | `{snapshot:…}` | 复用 createdAt | **是**（DC-2，传 `state?.slice()`） |
| 18 | **factory throw**（post-commit，:954-960） | `transaction` | `NAMESPACE_REGISTRY_FATAL` | `runtime-construction` | `fatalFromBytes(true, state)`——`state` 可得（encode 成功）→ `{kind:'fatal',committed:true,effect:'update',updateBytes}`（SA6 冻结锚在此分支）；`state === undefined`（encode 失败，不可达防御）→ `{kind:'fatal',committed:true,effect:'unknown'}`（**诚实 unknown，绝不构造无 bytes 的 update**——SA2 R2-M3） | `{snapshot:…}` | 复用 createdAt | **是**（DC-2：initStream 已在 factory 前调用，传 `state?.slice()`） |

**关于 stage 裁量的映射依据**（供 SA2 复核）：

- #2 `identity`：ADR-0011 八值词表中 `identity` 专为身份/形状接纳失败而设；入口 identity/形状拒绝（descriptor-only 检查，零 getter 执行）语义正合。`acceptance` 保留给停接纳（#1，SA6 冻结）与排他 duplicate（#3/#7/#14——「已接纳操作的 gate 决策」）。
- #4-6 `acceptance`：closing-entry 三 fatal 均发生在槽内 entry 检查段（fail-closed、零 payload/Clock/Persistence 访问），与 duplicate 同段；input `not-accessed` 诚实。
- #9/12/13 `schema-compile`：ADR-0009 把 Clock 读数非法归为 `create-document-internal`，Clock 读数与 createDocument 编排同属「create-document 编排段」（快照之后、Persistence 之前）；该段在词表内的伞形投影为 `schema-compile`，精确事实由 `sourcePhase:'create-document-internal'` 携带。#10 同段同名一致。
- #16 `transaction`：`createDoc` 调用栈内 = Persistence 提交段。
- `capability-gate` / `dirty-notification` 两值在本 create 路径不适用（无 capability 检查、无 dirty notification——create 不触 `saveDoc`，ADR-0006 #79）。

### 6.3 emission 组装与投影

#### 6.3.1 固定面

```ts
// emitOutcome / emitEarlyOutcome 的共同内核（两者只差 observedAt 来源，见 §6.3.2）
function emitAttempt(
  diag: { emitter: NamespaceDiagnosticChangeEmitter },
  clock: Clock,
  observedAt: string,
  e: CreateEmissionArgs,
): void {
  try {
    // —— issues 投影在吞没 try 边界内执行（SA2 R2-M2）——
    // rawIssues 数组级防御见 §6.3.4：非数组 → 整组省略 issues 字段（不 throw）；
    // 数组内逐条形状防御 → 跳过该条。投影器 throw（敌意 getter 等）→ 整条 emission
    // 丢弃（catch 收编）——任何路径都到不了业务调用栈。
    const issues =
      e.rawIssues !== undefined && e.issuesKind !== undefined
        ? projectIssues(e.rawIssues, e.issuesKind)
        : undefined;
    diag.emitter.emit({
      operation: 'namespace-create',        // ADR-0012 v1 封闭词表
      stage: e.stage,
      observedAt,                            // 注入 Clock 同源 ISO（禁墙钟）
      source: { kind: 'local' },             // Registry 本地写路径
      ...(e.code !== undefined ? { code: e.code, sourceModule: 'registry' as const } : {}),
      ...(e.sourcePhase !== undefined ? { sourcePhase: e.sourcePhase } : {}),
      ...(issues !== undefined && issues.length > 0 ? { issues } : {}),
      input: e.input,
      result: e.result,
      // attemptId 省略 → emitter 管线 CSPRNG 生成 att-+32hex（pipeline.ts:221 既有）
      // durationMs 省略（无 monotonic 来源，不发明）；context 省略（create 无 correlation 输入面）
    });
  } catch {
    /* ADR-0011「Runtime/Registry/复制实现仍防御 adapter 违约」条款 + emit 接缝
       「不得阻塞、throw」语义：emitter 同步 throw（AC4 锚）、issues 投影期任何
       异常一律隔离——吞没，绝不改变业务结果；emit 尝试恰一次，不重试。 */
  }
}
```

#### 6.3.2 observedAt / Clock 不变量（DC-3 展开）

```
不变量 C1（每次 create 尝试恰一次 clock 读数用于时间戳）：
  (a) 槽内 Clock 步已执行（快照成功后的全部结局点 #10-#18）
      → observedAt = 该次业务读数产物 createdAt（`new Date(clock.now()).toISOString()`），
        诊断侧零额外读数。SA6 锚 `clock.calls === 1` 成立。
  (b) Clock 步之前终结（#1-#8，业务零读数）
      → 诊断侧读一次：ts = new Date(clock.now()).toISOString()；
        clock.now() throw / toISOString RangeError（非法 epoch）→ 该条 emission 丢弃
        （诚实缺席，不伪造时间戳；业务结算零改动）。
  (c) clock fatal（#9）：业务读数本身失败 → 诊断侧无时间戳来源 → emission 丢弃。
      （#9 调用点仍调用 emitOutcome 作防御一致，但 createdAt 不可得——实现上
      readCreatedAtOrFatal 的 catch 路径无字符串可传，设计直接规定：不构造 emission。）
```

#### 6.3.3 input 投影（AC3 的机制保证）

```
  pre-input 拒绝（#1-#7）      → { status: 'not-accessed' }
  快照失败（#8）               → { status: 'unsafe-input' }   // 不回读敌意输入
  快照成功后（#10-#18）        → { snapshot: { schema: payload.schema, root: payload.root } }
```

- `payload` 是 `snapshotCreatePayload` 的 clonePlainData 深冻结产物——emission **只引用快照字段、永不触碰 `inputRef` 原对象**（AC3「logged 与基线 trap 计数相等」：诊断侧零次原对象 get trap）；排队后变异调用方引用不影响记录（AC3 第二锚）。
- `inputPolicy`（none/digest/redacted/full）由 adapter 配置——producer 只供 snapshot，策略投影归 adapter（ADR-0011 输入捕获五条；CONTEXT.md「producer 只供语义」）。快照对象组装为一次性新容器 `{schema, root}`（两字段引用已冻结克隆），所有权随 emit 移交。
- `not-accessed` / `unsafe-input` 是 producer 判定的**事实**，任何策略不得改写（诊断包 `projectInput`「事实优先于策略」——`full` 策略下仍输出 not-accessed，SA6 断言锚）。

#### 6.3.4 issues 投影（DC-4 展开；SA2 R2-M1/R2-M2 落实）

**码派生单源对齐**：compile 类 issue 的 code 派生与 P0 unavailable 摘要的既有单源规则**逐字对齐**（`packages/namespace-runtime/src/p0.ts:134-148` `toIssueSummary`，`@internal` 导出仅同包消费——`schema-write.ts:315-317` 即「同包直接 import `toIssueSummary` 后重组」的同源消费先例；registry 跨包不可 import（`namespace-runtime/src/internal.ts` 值导出恰 `createNamespaceRuntimeForRegistry` 一键，且 `namespace-runtime/**` 属本设计 DENY LIST），故本模块按同源规则做**语义复制并显式标注同源基准**，不发明任何新前缀）：

```ts
// create-diagnostic.ts 内部（零公共导出）；仅被 emitAttempt 在吞没 try 边界内调用
//
// compile 投影：SchemaParseIssue[] → DiagnosticIssue[]（顺序逐条保留）
//   {kind:'envelope', issue:{code, message, readOnly}}
//     → { code: `SCHEMA_ENVELOPE_${String(issue.code)}`,   // 与 p0.toIssueSummary 逐字同源：
//                                                          // code 作不透明段透传，不假设数字串
//                                                          // （p0.ts:136-138 注释冻结「ENV_TEST 读作
//                                                          //   SCHEMA_ENVELOPE_ENV_TEST」）
//        message: issue.message, path: [] }
//   {kind:'vfsl', issue:{message, line, column}}
//     → { code: 'SCHEMA_TEXT_INVALID',                      // 同源（p0.ts:145）；R1 曾发明的
//                                                          // VFSL-ENV-E 前缀已废除（SA2 R2-M1）
//        message: issue.message, path: [] }
//     // line/column 无 DiagnosticIssue 词表位，不发明（message 已含 vfsl 冻结前缀）
//
// validate 投影：ValidateIssue[] → DiagnosticIssue[]（逐字段同形透传，零改写、零码派生）
//   {message, path: Array<string|number>} → { message, path }   // 已是 DiagnosticIssue 子形状
function projectIssues(raw: readonly unknown[], kind: 'compile' | 'validate'): DiagnosticIssue[];
```

**数组级防御（SA2 R2-M2）**——投影只被 `emitAttempt` 在吞没 try 边界内调用（§6.3.1），防御分三层，任何一层异常都不出 create-diagnostic.ts：

1. **数组级**：`raw` 非数组（或 proxy/敌意对象在 `Array.isArray` 检查处 throw）→ **整组省略 issues 字段**（emission 照常发出，只是无 issues）——绝不向上抛；正常路径 `raw` 恒为 vfsl 冻结数组（`SchemaParseIssue[]` / `ValidateIssue[]`），此层为防御纵深；
2. **条目级**：逐条形状检查（compile：`kind` 判别 + `issue.message` string + `issue.code` 可 String 化；validate：`message` string + `path` 数组且段为 string/finite number）——意外形状条目**跳过该条**，其余照常携带；条目读取包在逐条 try/catch 内（敌意 getter throw 只废该条）；
3. **整体级**：投影器自身任何 throw（不可达防御）→ 由 `emitAttempt` 的外层 try 收编 → 整条 emission 丢弃（该结局无诊断记录——诚实缺席，不改业务结局）。

- SA6 断言 `issues.items.length > 0` 由正常路径保证：BAD_SCHEMA（`type ROOT = { n: ;`）触发 vfsl parse 失败 → `{kind:'vfsl'}` 条目 → `SCHEMA_TEXT_INVALID` 投影非空；
- 顶层 `emission.code` 保持 Registry 稳定码 `NAMESPACE_SCHEMA_INVALID` / `NAMESPACE_ROOT_INVALID`（SA6 冻结，与 #149 的「顶层 code = 首条 issue 码」不同——那是 Runtime 写路径的裁量，本票 Registry 面被 SA6 契约冻结）；
- 业务结果中的 issues 保持 verbatim 透传**零改动**（DQ-4 既有契约）——投影只发生在 emission 构造侧、只读 raw 数组（不 clone、不改写、不回写）。

#### 6.3.5 genesis / update bytes 与 initStream（DC-1/DC-2 展开）

```ts
export function encodeDetachedState(doc: unknown): Uint8Array | undefined {
  try {
    return Y.encodeStateAsUpdate(doc as never);   // 全量 state；doc 已提交且无并发写（§8.2 证明）
  } catch {
    return undefined;   // 不可达防御（Persistence createDoc 内部已做过同款 encode——
                        // ADR-0006 #64「初始完整 snapshot 已提交（Y.encodeStateAsUpdate(doc) 直写）」，
                        // 成功提交 ⟹ 可编码）；失败 → bytes 诚实缺席
  }
}
```

**槽内次序（成功路径，伪码级冻结）**：

```
handle = await persistence.createDoc(...)            // committed 事实确立（resolve 即提交点）
const state  = encodeDetachedState(initial.doc)      // ① 全量 state（owned bytes；失败 → undefined）
diag.initStream(id.namespaceId, state?.slice())      // ② stream 建立缝：独立副本（slice）移交 Host
try {
  runtime = factory(handle, …)                       // ③ Runtime 构造（P0 入 sequencer，只读 SCHEMA）
  entry = makeEntry(…); entries.set(…)
  if (state !== undefined) {                         // ④ committed 有 bytes 才构造 emission
    diag.emitOutcome(createdAt, { stage:'transaction',
      result:{kind:'committed', effect:'update', updateBytes: state},   // state 原件随 emission 移交
      input:{snapshot:{schema:payload.schema, root:payload.root}} })    // （emitter 管线 intake 再 slice 复制）
  }                                                  //    state undefined → 不构造（§6.2 #17——不伪装 update-omitted）
  return issueLease(entry)
} catch (cause) {
  …（既有 fatal 逻辑零改动）
  diag.emitOutcome(createdAt, { stage:'transaction', code:'NAMESPACE_REGISTRY_FATAL',
    sourcePhase:'runtime-construction',
    result: fatalFromBytes(true, state),             // ⑤ SA2 R2-M3：bytes-aware 组装——
    input:{snapshot:…} })                            //    state 可得 → update+bytes；undefined → 诚实 unknown
  throw new NamespaceRegistryFatalError('create','runtime-construction',true,cause)
}
```

**`fatalFromBytes(committed, bytes)`**（模块内 helper，对齐 #149 `diagnostic.ts:94-99` 同名先例）：

```ts
function fatalFromBytes(committed: boolean, updateBytes: Uint8Array | undefined): EmissionResult {
  if (!committed) return { kind: 'fatal', committed: false };
  return updateBytes !== undefined
    ? { kind: 'fatal', committed: true, effect: 'update', updateBytes }
    : { kind: 'fatal', committed: true, effect: 'unknown' };   // encode 缺席 → 诚实 unknown，
}                                                               // 绝不构造无 bytes 的 update（R2-M3）
```

**SA6 锚的可达性说明**：红灯 AC2 fatal 用例断言 `effect === 'update'` 且 bytes 物化初始文档——该用例的 encode 必然成功（Persistence createDoc 已提交、无并发写，§8.2），故 `state !== undefined`、走 update 分支；`effect:'unknown'` 只在 encode 失败的不可达防御路径出现。

- `state.slice()` 与 `state` 两份**独立 buffer**：initStream 收到的副本与 emission 引用不共享底层内存——Host 若在 initStream 内变异 buffer，emission 副本不受影响（emitter 管线 intake 亦会 slice——双保险）。
- `encodeDetachedState` 失败（不可达防御）：initStream 仍调用、传 `undefined`（file adapter 对 `undefined` 跳过 genesis 写但建立 stream——ADR-0012「genesis 未成功写入时 stream 仍可记录诊断事实」）；成功路径 emission 丢弃（不能发明 `update-omitted` 受控 reason——v1 词表仅 `payload-too-large` / `update-capture-disabled` / `empty-update`，新增 reason 须过设计评审，本票不扩词表）。
- **initStream 恒在 emit 之前**（固定次序）：语义干净（stream 先立、attempt 随后），Host 的 pending-buffer binding（AC2 File E2E：emit 先缓冲、initStream 后直通）与直通 binding 均兼容——SA6 契约「不锁定 emit/initStream 相对 create() 结算的先后」由同步调用天然满足（两者都在 create Promise 结算前完成）。
- `initStream` 本体 try/catch 吞没（Host 函数 throw = 违约，隔离；AC4「stream init 失败不改 create 结果」的 Registry 侧义务）。`LOG_STREAM_INIT_FAILED` 健康事件由 Host 侧 adapter 的 observer 产生（file adapter 构造期失败内部上报——`file.ts:952` 源码既有），Registry **不代发、不伪造**。

### 6.4 防御汇总（ADR-0011「Runtime/Registry/复制实现仍防御 adapter 违约」条款的 producer 义务全表）

| 故障注入 | 防御机制 | 业务影响 |
|---|---|---|
| emitter.emit 同步 throw（AC4） | `emitAttempt` 顶层 try/catch 吞没；恰一次尝试不重试 | 零（create 结果/Persistence/生命周期不变；SA6 断言 emitCalls===1） |
| initStream 同步 throw | try/catch 吞没（§8.5） | 零 |
| clock.now() throw / 非法 epoch（入口/早期路径） | 时间戳不可得 → emission 丢弃 | 零（业务结算零改动） |
| clock fatal（槽内 Clock 步） | 不构造 emission（业务 fatal 照常 reject） | 零 |
| encodeDetachedState throw | bytes 缺席：initStream 传 undefined；成功路径**不构造 emission**（§6.2 #17）；factory-fatal 路径 `fatalFromBytes(true, undefined)` → 诚实 `effect:'unknown'`（§6.2 #18，SA2 R2-M3） | 零 |
| raw issues 非数组 / 投影器 throw | **数组级**：整组省略 issues 字段（emission 照常）；**整体级**：外层 try 收编 → emission 丢弃——投影只在吞没 try 边界内执行（SA2 R2-M2，§6.3.4） | 零 |
| raw issues 单条意外形状 / 敌意 getter | **条目级**：跳过该条（逐条 try/catch），其余照常 | 零 |
| diagnosticLog 整体缺席 | 短路 no-op（零 emit、零读数、零 encode、零投影） | 零（日志禁用 = 既有行为逐位一致，AC4 baseline） |

---

## §7 registry.ts 插点伪码（全结局点一览）

`registry.ts` 改动模式统一：**既有判断/结算逻辑零改动，仅在 return/throw 前旁插一行 diag 调用**。

```ts
// ── 构造栈 ──
const diag = createCreateDiag(options.diagnosticLog, clock);   // 缺席 → no-op 单例

// ── create() 公共入口（同步段）──
async create(input: unknown): Promise<CreateNamespaceResult> {
  if (acceptance !== 'running') {
    diag.emitEarlyOutcome({ stage: 'acceptance', code: 'REGISTRY_NOT_ACCEPTING',
      result: { kind: 'rejected' }, input: { status: 'not-accessed' } });   // ← 插点 #1
    return NOT_ACCEPTING_ISSUE;
  }
  return admitCreateSlot(input);
}

// ── admitCreateSlot（同步接纳段）──
const outcome = acceptCreateIdentity(inputRef);
if (!outcome.ok) {
  diag.emitEarlyOutcome({ stage: 'identity', code: outcome.issue.code,
    result: { kind: 'rejected' }, input: { status: 'not-accessed' } });     // ← 插点 #2
  return Promise.resolve(outcome.issue);
}

// ── runCreateSlot（槽内；仅列插点，业务分支照旧）──
if (current !== undefined && (active || idle)) {
  diag.emitEarlyOutcome({ stage:'acceptance', code:'NAMESPACE_ALREADY_EXISTS',
    result:{kind:'rejected'}, input:{status:'not-accessed'} });             // ← 插点 #3
  return ALREADY_EXISTS_ISSUE;
}
if (closing) {
  if (closePromise === undefined) { …observer…;
    diag.emitEarlyOutcome({ stage:'acceptance', code:'NAMESPACE_REGISTRY_FATAL',
      sourcePhase:'lifecycle-slot-internal',
      result:{kind:'fatal',committed:false}, input:{status:'not-accessed'} }); // ← #4
    throw …; }
  try { await current.closePromise } catch (cause) { …observer…;
    diag.emitEarlyOutcome({ …同 #4 形… });                                  // ← #5
    throw …; }
  const after = entries.get(key);
  if (after !== undefined && (active || idle)) {
    diag.emitEarlyOutcome({ stage:'acceptance', code:'NAMESPACE_ALREADY_EXISTS',
      result:{kind:'rejected'}, input:{status:'not-accessed'} });           // ← #7
    return ALREADY_EXISTS_ISSUE; }
  if (after !== undefined) { …observer…;
    diag.emitEarlyOutcome({ …同 #4 形… });                                  // ← #6
    throw …; }
}

const payload = snapshotCreatePayload(inputRef);
if (!payload.ok) {
  diag.emitEarlyOutcome({ stage:'input-snapshot', code:'NAMESPACE_CREATE_INVALID_INPUT',
    result:{kind:'rejected'}, input:{status:'unsafe-input'} });             // ← 插点 #8
  return CREATE_INVALID_INPUT_ISSUE;
}

const createdAt = readCreatedAtOrFatal(id);   // clock fatal（#9）→ throw 路径零 emission（§6.3.2c）

try { initial = createDocument(…) } catch (cause) { …observer…;
  diag.emitOutcome(createdAt, { stage:'schema-compile', code:'NAMESPACE_REGISTRY_FATAL',
    sourcePhase:'create-document-internal',
    result: <fatalFromCommitted(cause)>,                                     // ← #12
    input:{snapshot:{schema:payload.schema, root:payload.root}} });
  throw …; }
if (!initial.ok) {
  if (kind === 'schema-invalid') {
    diag.emitOutcome(createdAt, { stage:'schema-compile', code:'NAMESPACE_SCHEMA_INVALID',
      result:{kind:'rejected'},
      rawIssues: initial.issues, issuesKind: 'compile',                        // ← #10（投影在 diag 内吞没 try 中）
      input:{snapshot:{schema:payload.schema, root:payload.root}} });
    return schemaInvalidIssue(initial.issues); }
  if (kind === 'root-invalid') {
    diag.emitOutcome(createdAt, { stage:'validation', code:'NAMESPACE_ROOT_INVALID',
      result:{kind:'rejected'}, rawIssues: initial.issues, issuesKind: 'validate', // ← #11（同上）
      input:{snapshot:…} });
    return rootInvalidIssue(initial.issues); }
  …不可达守卫 fatal…（插点 #13 同 #12 形）
}

try { handle = await persistence.createDoc(…) } catch (cause) {
  if (cause instanceof DocDuplicateError) {
    diag.emitOutcome(createdAt, { stage:'transaction', code:'NAMESPACE_ALREADY_EXISTS',
      result:{kind:'rejected'}, input:{snapshot:…} });                      // ← 插点 #14
    return ALREADY_EXISTS_ISSUE; }
  if (cause instanceof DocCreateOperationalError) { …observer…;
    diag.emitOutcome(createdAt, { stage:'transaction', code:'NAMESPACE_CREATE_FAILED',
      result:{kind:'rejected'}, input:{snapshot:…} });                      // ← #15
    return CREATE_FAILED_ISSUE; }
  if (cause instanceof DocCreateFatalError) { …observer…;
    diag.emitOutcome(createdAt, { stage:'transaction', code:'NAMESPACE_REGISTRY_FATAL',
      sourcePhase:'lifecycle-slot-internal',
      result: fatalFromBytes(cause.committed, encodeDetachedState(initial.doc)), // ← #16a
      input:{snapshot:…} });
    throw …; }
  …observer…;
  diag.emitOutcome(createdAt, { …同 #16a 形，committed:false… });            // ← #16b
  throw …;
}

// ── committed 事实确立（DC-2 冻结次序）──
const state = encodeDetachedState(initial.doc);
diag.initStream(id.namespaceId, state?.slice());                            // ← 插点 #17a/#18a

try {
  runtime = factory(handle, …); entry = makeEntry(…); entries.set(key, entry);
  if (state !== undefined) {                                                  // ← #17 前置守卫：
    diag.emitOutcome(createdAt, { stage:'transaction',                        //   encode 失败（不可达防御）
      result:{kind:'committed', effect:'update', updateBytes: state},         //   → 不构造 emission（§6.2 #17）
      input:{snapshot:{schema:payload.schema, root:payload.root}} });         //   无 code（committed 无 code）
  }
  return issueLease(entry);
} catch (cause) {
  …（既有 release/observer/fatal 逻辑零改动）…
  diag.emitOutcome(createdAt, { stage:'transaction', code:'NAMESPACE_REGISTRY_FATAL',
    sourcePhase:'runtime-construction',
    result: fatalFromBytes(true, state),                                      // ← #18（SA2 R2-M3：bytes-aware——
    input:{snapshot:…} });                                                    //   state 可得 → update+bytes；
  throw new NamespaceRegistryFatalError('create','runtime-construction',true,cause);  //   undefined → 诚实 unknown）
}
```

辅助（create-diagnostic.ts 内）：`fatalFromCommitted(cause)`：`cause instanceof DocRuntimeFatalError && cause.committed === true` → `{kind:'fatal',committed:true,effect:'unknown'}`（无 owned bytes——seam 失败不返回 doc）；否则 `{kind:'fatal',committed:false}`。`fatalFromBytes(committed, bytes)`：见 §6.3.5 定义（false → 无 effect；true + bytes → `update`；true 无 bytes → `unknown`——对齐 #149 `diagnostic.ts:94-99` 同名先例）。`projectIssues(raw, kind)`：见 §6.3.4（仅 emitAttempt 吞没 try 内调用）。

---

## §8 时序与合规性

### 8.1 ADR-0012 amendment C（File adapter emit 接线纪律）合规声明

amendment 条款（规范性，本票被点名）：「任何将 File adapter 的 `emit` 接入 namespace 生命周期的调用点，必须位于 NamespaceRuntime write sequencer slot 之外，或在该 slot 已释放之后；不得在 slot 内执行同步 File adapter `emit`。」

**本设计合规性论证**：
- create 的全部 emission/initStream 调用点位于 **Registry lifecycle carrier slot** 内（或公共入口同步段）——Registry lifecycle slot 与 NamespaceRuntime write sequencer 是两个并列机构（ADR-0011「变更尝试的业务排序继续由现有 Registry lifecycle slot 或 namespace write sequencer 决定，日志不得引入第二个业务排序机构」）；
- create 期（createDoc 前、factory 前）Runtime **尚未构造**——其 write sequencer 不存在，emission 结构性在其外（决议原文「create 期 Runtime 尚未构造，天然在 slot 外」）；
- post-commit 段（factory 之后，插点 #17/#18）：Runtime 已构造、P0 可能已入 sequencer 队列，但 emission 运行在 **Registry create slot 的调用栈**内，从未进入也从不阻塞 Runtime write sequencer slot（P0 的结算独立异步）；P0 只读 SCHEMA 不写（ADR-0008），encode 结果不受其影响；
- 与 #149（Runtime 写路径）的 emitSlot-在-slot-释放后模式不同是**有意为之**：那是 amendment 对 Runtime sequencer 的要求；Registry create slot 不是 Runtime sequencer slot，且 emitter 恒同步 void、不被 await（ADR-0011 时序条款「emitter 不被 `await`」）。**emit 的耗时不在本设计处作任何有界性声明**——emit 是同步调用，Host 侧 adapter 的执行（含 File adapter first slice 的同步磁盘 append）耗时由该次 create 尝试的调用方承担（见 §8.5 成本声明）；「数据有界 ⟹ 延迟有界」不成立（磁盘 I/O 延迟不受数据量上界约束），R1 曾作此暗示性声明，R2 移除（SA2 LOW）。

### 8.2 genesis 纯创建态证明（无并发写窗口）

`encodeDetachedState(initial.doc)` 执行点（createDoc resolve 后、factory 前）：
1. lease 尚未签发——调用方无任何写入口；
2. 同 key 后续 create/open 在同一 carrier FIFO 排队（§5 carrier 模型），本槽未结算它们不执行；
3. 不同 key 的操作写不同 doc（Persistence 按 `(owner.userId, docId)` 分区）；
4. P0（factory 内启动）只读 SCHEMA 标准四键（ADR-0008 P0 条款），不写。
⟹ encode 产物恒为提交时刻的纯创建态（SCHEMA 四键 / META 二键 / ROOT 全量），对空 Y.Doc 应用即精确物化——SA6「初始文档 owned bytes：create 事务无 pre-state，全量即精确 effect，无 #149 增量基态问题」。

### 8.3 Clock 单读不变量与既有锚

- 成功路径：业务读 1（`readCreatedAtOrFatal`）+ 诊断复用 0 = `clock.calls === 1`（SA6 冻结锚）；
- 既有 `registry-create.test.ts` 的 manual clock 计数断言（「每通过 gate 的 create slot 恰读一次」）：那些用例**不注入 diagnosticLog** → diag no-op 短路，零额外读数——既有断言零漂移；
- 注入日志且早期拒绝路径：业务 0 + 诊断 1 = 1（SA6 停接纳测试用恒定 clock，`observedAt === NOW_ISO` 断言由诊断侧读数满足）。

### 8.4 与 ADR-0011 其他条款对照

| 条款 | 本设计落实 |
|---|---|
| 「日志不得成为 createDoc、Yjs transaction、dirty notification 或 replication ACK 的成功前置条件」 | 全部插点在业务结算**之后**旁路（return 值已确定 / throw 已确定），零前置条件 |
| 「日志实现不得因失败将 namespace 标记为 fatal、persistence-degraded 或只读，也不得触发业务请求重试」 | 诊断侧零状态写入（不触 entries/carriers/acceptance/entry.phase） |
| 「acceptance 前拒绝在对应公共入口记录」 | 插点 #1/#2 在公共入口同步段 |
| 「已接纳操作在取得既有槽后记录真实 gate、snapshot、validation 和 transaction 结局」 | 插点 #3-#18 按槽内真实阶段 |
| 「emit 的 interface 语义是立即接收 detached record；不得阻塞、throw、返回 durability promise」 | producer 组装 plain emission（快照字段引用冻结克隆、bytes 独立副本）后同步移交；emit try/catch 防御违约 |
| 「日志队列溢出可以丢弃记录…健康信号…不构成日志完整性证明」 | 队列/丢弃行为全在 adapter（capacity/stats）；Registry 零感知 |
| 数据保护「full 输入与 committed Yjs update 必须由 Host 明确启用」 | updateCapture/inputPolicy 由 Host 在 adapter 配置——producer 只供语义，Host 不启用则 adapter 投影为 update-omitted/digest |
| 「日志字段不得进入默认低基数 metrics label」 | Registry 无 metrics 面；record 字段只进 adapter |

### 8.5 initStream/emit 的同步成本、shutdown 行为与 sync-only 契约（SA2 LOW 落实）

**sync-only 契约**（seam 形状，SA6 冻结签名的语义澄清）：
- `initStream` 与 `emitter.emit` 均为 **同步 void** 调用；Registry **永不 await** 二者的返回值——Host 若在 void 函数里返回 Promise，该 Promise 被 Registry 忽略（floating promise 的处置责任在 Host binding，Registry 不附加 `.catch`、不持有引用）；
- Host 若在 `initStream` 内同步 throw（违约），Registry 侧 try/catch 吞没（§6.4）——AC4「stream init 失败不改 create 结果」的 Registry 侧义务；`LOG_STREAM_INIT_FAILED` 等健康事件由 Host 侧 adapter 的 observer 自行产生，Registry 不代发、不伪造、不缓存。

**同步成本声明**：
- `emit` 与 `initStream` 在 create 槽（或公共入口同步段）内**同步执行**，其全部耗时（含 Host 侧 File adapter 构造期的 `mkdirSync`/`writeFileSync` manifest/genesis 同步 append）计入该次 create 尝试的墙钟耗时，由 create 调用方承担——这是 ADR-0012 amendment「emit 不得在 Runtime write sequencer slot 内」纪律下、create 路径（Registry slot，非 Runtime slot）被决议明文允许的代价结构；
- 成本量级：memory adapter 纯内存 O(record)；File adapter first slice 每次有界 I/O（manifest 一次 'wx' 写 + genesis 一条 append + current.json 一次 rename）。Registry 不引入任何异步化/队列化缓解——那是 adapter 层的演进自由（#152 后续切片），不在本票。

**shutdown 行为**：
- Registry shutdown **不调用** `initStream`、**不做日志 drain**（ADR-0011「Host shutdown 可 best-effort drain 日志，但 Registry/Persistence 的停止不得无限等待日志 sink」——drain 是 Host 侧对 adapter 的动作，不是 Registry 的）；
- 在途 create 槽内的同步 emit/initStream 是 run-to-completion 的——shutdown 的 `await carrier.tail`（registry.ts:982 既有）自然等待其完成，无新增等待点；
- 本设计零异步日志状态（无队列、无在途 Promise、无 timer）⟹ Registry 停止路径零新增资源、零死等风险。

**encode 失败的静默 best-effort 备案**：
- `encodeDetachedState` 失败（§6.2 #17/#18 的 `state === undefined`）为不可达防御路径（ADR-0006 #64：Persistence createDoc 提交即依赖同款 encode，成功提交 ⟹ 可编码）；一旦到达，处置为：initStream 仍调用（bytes `undefined`，stream 建立而 genesis 缺席——ADR-0012「genesis 未成功写入时 stream 仍可记录诊断事实」）、成功路径不构造 emission、factory-fatal 路径 `effect:'unknown'`；
- 该缺席是**静默的**（Registry 无诊断日志健康通道，不为日志层自身的缺席伪造事件——与「不代发 LOG_STREAM_INIT_FAILED」同款纪律）；观测性缺口在此显式备案：检测手段 = stream 有 manifest 而无 genesis-baseline 记录（Host 侧 readStreamStrict 可见），ADR-0011「这些健康信号本身也不构成日志完整性证明」允许此类最佳努力缺席。

---

## §9 业务影响与兼容性评估

### 9.1 业务零改动声明

- `runCreateSlot` / `admitCreateSlot` / `create()` 的**全部判断分支、结算值、throw 时机、observer 事件、handle release 调用、carrier/cleanup 微任务序零改动**——诊断插点只在既有 return/throw 语句前旁插；
- `snapshotCreatePayload` / `clonePlainData` / `acceptCreateIdentity` / `readCreatedAtOrFatal` / `createDocument` 零改动；
- open/shutdown/idle 状态机零改动（open 不接线——§1.2）。

### 9.2 既有测试兼容

| 既有套件 | 影响 |
|---|---|
| `registry-create.test.ts`（50 用例） | 不注入 diagnosticLog → no-op 短路；manual clock 计数、overrides 形状（新增可选字段）、业务断言全部零漂移 |
| `registry-open.test.ts` / surface / plugin 套件 | plugin.ts/types 既有字段零改动；新增可选字段不破坏类型/运行时 |
| 红灯测试 `registry-create-diagnostic-red.test.ts`（16 it） | 设计逐锚落地后 16/16 转绿（§3 映射表 ↔ §6.2 总表一一对应）；测试文件**无需改动** |
| `tsc -p tsconfig.typecheck.json`（CI 门禁） | 新增 `import type`（诊断包）+ `import * as Y`（yjs 上移 dependencies）经 workspace link 解析；测试文件相对路径 import 不受影响 |

### 9.3 构建与依赖影响

- `pnpm-lock.yaml` 随 dependencies 变更更新（workspace 内部版本，无外部新包）；
- 运行时新增值级依赖：仅 `yjs`（encode 单函数；registry 包本已传递依赖 yjs via doc-runtime/namespace-runtime devDep——上移为直接 dependencies 是诚实化，无版本变化 `^13.6.30`）；
- 诊断包保持**纯类型消费**（`import type`）——registry 不拉入诊断包 reader/file 运行图（对齐 #149 先例注释）。

### 9.4 性能影响

- 日志禁用：一次 undefined 判断短路，零开销；
- 日志启用：每次 create 尝试一次 emission 组装（plain 对象字面量，纯内存）+ 成功路径一次 `encodeStateAsUpdate`（O(初始文档大小) 纯 CPU；Persistence createDoc 内部已做过同量级 encode）+ initStream/emit 同步调用。**CPU 侧开销**为 create 路径（detached 构造 + 单事务 + Persistence 写盘）同数量级内的常数因子；**I/O 侧开销**取决于 Host 装配的 adapter（memory adapter 纯内存；File adapter 为同步磁盘 I/O——其延迟特征不由本设计声明，成本归属见 §8.5，Host 可用 memory adapter 规避）；对延迟敏感的 Host 装配面即日志启用决策本身（ADR-0011「启用与否在 namespace 创建时确定」）。

---

## §10 文件清单（File Scope）

### ALLOW LIST

- `packages/namespace-registry/src/create-diagnostic.ts` — **新建**，create 诊断接线私有模块（CreateDiag 环境、emission 组装、emitAttempt 吞没、issues/input 投影 helper、encodeDetachedState、initStream 隔离调用；约 200 行，§6 全部设计落此）
- `packages/namespace-registry/src/registry.ts` — **修改**，三处：`NamespaceRegistryInternalOptions` 增 `diagnosticLog` 字段、构造栈 `createCreateDiag` 一行、§7 全部插点（每结局点 1-4 行旁插；合计约 55 行增量，业务分支零改动）
- `packages/namespace-registry/src/types.ts` — **修改**，`NamespaceRegistryDiagnosticLog` 接口定义 + `CreateNamespaceRegistryOptions.diagnosticLog` 可选字段 + `import type`（约 18 行）
- `packages/namespace-registry/src/testing.ts` — **修改**，`NamespaceRegistryTestingOverrides` 增可选 `diagnosticLog` + 工厂透传两行（约 8 行）
- `packages/namespace-registry/src/index.ts` — **修改**，类型导出白名单追加 `NamespaceRegistryDiagnosticLog`（1 行）
- `packages/namespace-registry/package.json` — **修改**，dependencies 增 `@nomicore/namespace-diagnostic-log: workspace:*` 与 `yjs: ^13.6.30`（devDependencies 中 yjs 上移）
- `pnpm-lock.yaml` — **修改**，依赖变更的 lockfile 更新（若 install 产出 diff）
- `packages/namespace-registry/test/registry-create-diagnostic-red.test.ts` — `[SA6 owned]` 验收红灯测试（已存在，16/16 红）。SA3 落地后**无需改动即转绿**；SA3 仅可改测试基础设施，不得改断言逻辑。

### DENY LIST

- `packages/namespace-registry/src/plugin.ts` — 插件 config 键集冻结（#112 §2.F `{idleTimeoutMs?}` 单键）；诊断日志经编程面 options 注入，不经插件配置（若 Host 集成需要插件面，属后续票）
- `packages/namespace-registry/src/create-document.ts` — create-document 契约（含 testing factory 注入形状）冻结；bytes 在 Registry 槽内 encode（DC-1）
- `packages/namespace-registry/src/identity.ts` / `errors.ts` / `lease.ts` / `observer.ts` — 既有稳定面零改动（observer 事件词表不加诊断事件——诊断走独立 emitter seam）
- `packages/namespace-diagnostic-log/**` — #148/#152 冻结契约，本票只消费不修改
- `packages/namespace-runtime/**`、`packages/doc-runtime/**`、`packages/persistence/**`、`packages/vfsl/**` — 下游稳定层零改动
- `packages/namespace-registry/test/registry-create.test.ts` / `registry-open.test.ts` / surface / plugin 等既有测试 — 既有契约不动

---

## §11 协议假设依据 (Protocol Assumption Evidence)

**无外部协议级假设**：本设计不涉及 HTTP/WS 端点、端口占用、进程时序、CI runner 资源或第三方库「应该会」行为——纯进程内同步代码接线。但涉及六项**内部接缝行为假设**，逐项给出源码级依据：

| 假设 | 依据类型 | 依据内容（具体引用） | 风险等级 |
|---|---|---|---|
| emitter 管线接受本设计组装的 emission 形状（observedAt ISO / code 正则 / 词表 / result 判别联合 / attemptId 缺省生成） | 源码引用 | `packages/namespace-diagnostic-log/src/pipeline.ts:62-99`（intakeValid：`RE_ISO_MS`/`RE_STABLE_CODE`/isStage/isOperation）；`:221`（attemptId 缺省 `att-`+32hex）；`schema-patterns.ts:22-25`（`P_ISO_MS`/`P_STABLE_CODE` 常量定义，`RE_` 副本在 :42-44——覆盖 `NAMESPACE_*` 码与 `runtime-construction` 等 phase——字符集 `[A-Za-z0-9_.:-]`） | 低 |
| emission.issues 经 `projectIssues` 投影后至少一条存活（红灯锚 `items.length > 0`） | 源码引用 | `packages/namespace-diagnostic-log/src/projection/issues.ts:82-92`（`isValidItem`：顶层 `message: string` + `path: Array` + 段 string/finite number——本设计 §6.3.4 投影产物逐条满足）；BAD_SCHEMA（vfsl 语法错误）→ `compileSchemaEnvelope` 返回 `{kind:'vfsl', issue: VfslIssue}` 条目（`packages/vfsl/src/index.ts:316-318` parse 阶段包装）→ 投影为 `{code:'SCHEMA_TEXT_INVALID', message, path:[]}` 非空 | 低 |
| compile issue 码派生规则 = `SCHEMA_ENVELOPE_${String(code)}` / `SCHEMA_TEXT_INVALID`（既有单源，非本设计发明） | 源码引用 | `packages/namespace-runtime/src/p0.ts:134-148`（`toIssueSummary`——P0 unavailable 摘要唯一构造点，注释冻结「code 作不透明段透传，不假设数字串」）；`packages/namespace-runtime/src/schema-write.ts:315-317`（SCHEMA 写槽**同包直接 import** `toIssueSummary` 后重组为 `toReplacementIssue`——同源消费先例；本设计跨包不可直接 import（`namespace-runtime/src/internal.ts` 值导出恰一键 `createNamespaceRuntimeForRegistry`，且 `namespace-runtime/**` 在 DENY LIST）→ 按同源规则做**语义复制**并显式标注基准） | 低 |
| `initStream(namespaceId, genesisUpdateBytes)` 语义 = adapter 以该 bytes 构造 genesis-baseline（seq 1）且 `undefined` 合法跳过 | 源码引用 | `packages/namespace-diagnostic-log/src/adapters/file.ts:810-832`（`runGenesis`：`config.genesisUpdateBytes` undefined/空 → 跳过；非空 → genesis record）；`:873-875`（`initializeGeneration` 在 manifest 后调 `runGenesis`——seq 1）；`:987`（resume 路径忽略 genesis bytes）；红灯测试 `:419-431`（Host binding 以该签名装配真实 adapter） | 低 |
| memory adapter capacity/stats 行为（满员 drop newest + `droppedByReason['queue-full']` 计数） | 源码引用 | `packages/namespace-diagnostic-log/src/adapters/memory.ts:306-314`（`gateAndEnqueue` 满员分支：`notifyRecordDropped('queue-full',…)` + `countDrop`）；`:362-373`（stats 面） | 低 |
| `Y.encodeStateAsUpdate(initial.doc)` 在 createDoc resolve 后可行且产物 = 提交内容 | 源码引用 + ADR 引用 | ADR-0006 #64「创建成功前初始完整 snapshot 已提交（`Y.encodeStateAsUpdate(doc)` 直写；FilePersistence 以 temp→rename 完成为提交点）」——Persistence 提交路径本身依赖同款 encode；`packages/namespace-registry/src/registry.ts:911-913`（createDoc resolve 后 Registry 持有 `initial.doc` 引用）；§8.2 并发安全证明 | 低 |

---

## §12 契约改动连锁审计 (Contract Change Caller Audit)

**无契约改动**：本设计不修改任何既有函数的签名、返回类型、throw 语义或 catch 行为——仅新增可选注入字段与新增内部旁路模块。逐项声明如下：

### 改动函数

| 函数/接口 | 文件 | 改动前契约 | 改动后契约 |
|---|---|---|---|
| （新增）`createCreateDiag` / `encodeDetachedState` / `projectIssues(raw, kind)` / `fatalFromBytes` / `fatalFromCommitted` | `src/create-diagnostic.ts`（新文件） | 不存在 | 新内部模块函数，仅 `registry.ts` 相对导入消费（`projectIssues`/`fatalFromBytes` 为模块内私有，不经 CreateDiag 接口暴露）；零公共导出 |
| `NamespaceRegistryInternalOptions` | `src/registry.ts:153` | 8 字段 | 追加**可选** `diagnosticLog?`（结构宽化——既有构造点全部兼容） |
| `CreateNamespaceRegistryOptions` | `src/types.ts:352` | 4 字段 | 追加**可选** `diagnosticLog?`（结构宽化） |
| `NamespaceRegistryTestingOverrides` | `src/testing.ts:28` | 7 字段 | 追加**可选** `diagnosticLog?`（结构宽化；testing 工厂透传） |
| `runCreateSlot` / `admitCreateSlot` / `create()` | `src/registry.ts` | 返回值联合 / throw 语义冻结 | **签名与结算语义零改动**——仅结算语句前旁插 diag 调用（§7） |

### Caller 清单（结构宽化字段的全部消费方）

| Caller | 文件:行号 | 是否受影响 | 处置方案 |
|---|---|---|---|
| `createNamespaceRegistry`（生产工厂） | `src/registry.ts:1080-1092` | 否（新字段可选） | 追加一行透传 `options.diagnosticLog` |
| `createNamespaceRegistryForTesting`（testing 工厂） | `src/testing.ts:102-136` | 否（新字段可选） | 追加透传两行（overrides → internal） |
| `createNamespaceRegistryPlugin.apply` | `src/plugin.ts:164-168` | 否（不传新字段 → 日志禁用，行为不变） | 零改动（DENY LIST） |
| 既有测试装配（`registry-create.test.ts` / `registry-open.test.ts` 等） | `packages/namespace-registry/test/*` | 否（`as never`/字面量 overrides 均兼容可选新字段） | 零改动 |
| 红灯测试装配 `makeRegistry` | `test/registry-create-diagnostic-red.test.ts:262-276` | 否——本设计即为其冻结 seam 的落地 | `[SA6 owned]` 转绿无改动 |

### 风险评估

- **无 return→throw / Promise 形状 / 同步性 / catch 语义改动**——SA4 §1.5 五类契约改动清单逐项为零；
- 唯一新增的运行时行为（emit/initStream/encode）全部位于 try/catch 吞没内（§6.4 防御表），且诊断缺席时短路——对任何不注入 `diagnosticLog` 的既有 caller（含 plugin 路径）**运行时行为逐位不变**；
- 新增值级 import（`yjs`）无副作用（纯函数库）；诊断包纯类型消费。

---

## SA2 反馈逐条回应

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|---|---|---|---|
| **R2-M1**（强制）：compile issue 码对齐 P0/#149 既有 `SCHEMA_ENVELOPE_${code}` / `SCHEMA_TEXT_INVALID`，禁止发明 VFSL 前缀 | ✅ | §2.3 DC-4；§6.2 表 #10；§6.3.4；§11 表第 2/3 行 | 删除 R1 发明的 `VFSL-ENV-E${…}` 前缀；`projectIssues(raw,'compile')` 码派生与 `p0.ts:134-148 toIssueSummary` 逐字同源（envelope → `SCHEMA_ENVELOPE_${String(code)}` 不透明段透传、vfsl 文本 → `SCHEMA_TEXT_INVALID`）；跨包 internal 不可 import（`internal.ts` 值导出一键）→ 按 `schema-write.ts:315-317` 同源语义复制先例落地并显式标注基准；顶层 code 保持 Registry 稳定码（SA6 冻结不受影响） |
| **R2-M2**（强制）：raw issue 投影移入 create-diagnostic.ts 吞没 try 边界 + 数组级防御，畸形 issues 不得改变业务结局 | ✅ | §6.1 `CreateEmissionArgs`（`rawIssues`+`issuesKind` 取代投影产物字段）；§6.3.1（投影在 `emitAttempt` try 内执行）；§6.3.4 三层防御；§6.4 防御表两行；§7 插点 #10/#11 改传 raw | registry.ts 不再调用投影函数——`emitOutcome/emitEarlyOutcome` 收 raw 数组，投影（含码派生、形状检查、敌意 getter 防御）整体在 create-diagnostic.ts 吞没 try 边界内：数组级（非数组/检查 throw → 整组省略 issues 字段，emission 照常）→ 条目级（逐条 try/catch 跳过意外条目）→ 整体级（投影器任何 throw → 外层 catch 收编 → emission 丢弃）；任何路径异常都不出 create-diagnostic.ts、不触业务调用栈 |
| **R2-M3**（强制）：factory-throw committed fatal 必须 bytes-aware（`fatalFromBytes(true, state)`），encode 缺席产出诚实 `unknown` 而非非法 update | ✅ | §6.2 表 #17/#18；§6.3.5（`fatalFromBytes` 定义 + 槽内次序伪码 ⑤）；§7 插点 #18；§6.4 防御表 | 删除 R1 硬编码的 `{kind:'fatal',committed:true,effect:'update',updateBytes: state}`（state undefined 时构造出无 bytes 的 update——intake 必丢、语义非法）；改为 `fatalFromBytes(true, state)`：state 可得 → `update`+bytes（SA6 AC2 fatal 锚在此分支）；`undefined` → 诚实 `effect:'unknown'`（对齐 #149 `diagnostic.ts:94-99` 先例）；成功路径 #17 同步补显式 `state !== undefined` 守卫（undefined → 不构造 emission，不伪装 update-omitted——v1 reason 词表无 encode 失败位） |
| **LOW-a**：移除「有界数据 → 有界延迟」声明 | ✅ | §8.1 末条 | R1「emit 是有界同步操作；File adapter first slice 每 emit 至多一条 JSONL 有界同步 append」的暗示性声明移除，改为显式否认（磁盘 I/O 延迟不受数据量上界约束）；成本归属改述于 §8.5 |
| **LOW-b**：文档化 initStream 同步成本 / shutdown 行为 / sync-only 契约 / encode 失败静默 best-effort | ✅ | §8.5（新增节） | sync-only：两者恒同步 void、Registry 永不 await（Host 返回 Promise 被忽略、floating promise 责任在 Host）、throw 吞没、不代发健康事件；成本：同步 I/O 计入该次 create 尝试、由调用方承担（amendment 纪律下 create 路径被决议允许的代价结构），量级逐项列出；shutdown：不调 initStream、不 drain、在途同步调用由既有 `await carrier.tail` 覆盖、零新增异步状态；encode 失败：静默缺席 + 检测手段（stream 有 manifest 无 genesis）+ ADR-0011 允许性依据，观测性缺口显式备案 |
| **LOW-c**：引用修正 | ✅ | §3.1/§5.1/§6.1/§6.3.1/§6.4/§8.1 | 「ADR-0011 §A/§Interface」字母节引用全部替换为决议文档实际节名/条款引文（「Interface 与 seam」节、「Runtime/Registry/复制实现仍防御 adapter 违约」条款、「emitter 不被 await」时序条款）；§11 新增 issues 投影与码派生两项源码依据（`projection/issues.ts:82-92`、`p0.ts:134-148`、`schema-write.ts:315-317`、`vfsl index.ts:316-318`）；§6.3.1 attemptId 注释补 `pipeline.ts:221` 精确行号 |

**一致性自检记录（R2）**：全文检索 `VFSL-ENV-E`（仅存于 §6.3.4 的「已废除」说明，无活引用）、`effect:'update', updateBytes: state` 硬编码形态（已全部替换为 `fatalFromBytes`/显式守卫）、`projectCompileIssues`（已全部替换为 `projectIssues(raw, kind)`）、字母节引用（已清零）；§6.2 表 ↔ §6.3.1/6.3.4/6.3.5 ↔ §6.4 ↔ §7 插点 ↔ §11 依据逐行对齐；SA6 契约（§3 全部锚点）零改动——R2 修订不触碰 seam 形状、stage/code/result 冻结映射与 16 项断言中的任何一项。
