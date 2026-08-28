# Design: Freeze the v1 diagnostic record contract and memory adapter（issue #148）

- worktree: `/home/wangjian/nomicore-fix-issue-148`
- branch: `fix/issue-148-on-docs-namespace-diagnostic-change-log`
- 规格冻结源：ADR 0011（`docs/adr/0011-best-effort-namespace-diagnostic-change-log.md`）、ADR 0012（`docs/adr/0012-vfsl-validated-jsonl-and-framed-sidecar-change-log.md`）、`CONTEXT.md` namespace 诊断变更日志词条（L105–L115）
- 状态：R4（SA4 审查后总控勘误批：C-1 事件类型面恢复 §8.1 判别联合 [SA3 实现对齐，非设计变更]；C-2 records() 恢复 `readonly DiagnosticChangeRecord[]` [实现对齐]；C-3 originalCount/truncated 同现同缺 [§6.2 已注]；C-4 marker 精确 14B [§6.1 已勘]；C-5 两事件成员 operation 可选化 [§8.1 已注]；nano-2 AGENTS.md 措辞、nano-4 testing.ts 文档注记随实现轮修复）。历史：R3 updateBytes 复制隔离（§2.6）；R2 SA2 反馈十条；总控 §11 六项裁决维持生效。

**总控 §11 裁决（2026-08-28）**：G1 ✅ 规范句为准（crc32c 双 carrier 必备）；G2 ✅ 批准 recordKind 二族联合（ADR 0012 要求 genesis baseline 但未定义形状，本设计是唯一诚实表达；风险已入 §10-J1，#152 评审复核）；G3 ✅ 批准（v1 存储不出现 result:'unknown'，与两 ADR 自洽）；G4 ✅ 批准（事件只带 issuePaths）；G5 ✅ 批准（工具实现策略）；G6 ✅ 批准（attemptId 超集 Pattern）。六项裁决全部生效，SA2 评审应攻击设计本身而非重审已裁决项。

---

## 目录

1. §1 模块定位与公共接缝
2. §2 v1 语义词表与 record TS 类型
3. §3 内建冻结 VFSL schema（逐字段）与指纹获取
4. §4 emitter 管线数据流与失败隔离
5. §5 输入捕获四策略算法
6. §6 issue/可变字段投影算法
7. §7 有界内存 adapter 契约
8. §8 健康 observability 接缝
9. §9 契约测试计划
10. §10 风险与遗留（judgement calls）
11. §11 规格冲突/缺口与裁决建议
12. §12 文件清单（File Scope）
13. §13 协议假设依据
14. §14 契约改动连锁审计

---

## §1 模块定位与公共接缝

### 1.1 包命名与位置

**决策**：新包 `packages/namespace-diagnostic-log`，npm 名 `@nomicore/namespace-diagnostic-log`。

论据：

1. `CONTEXT.md` L105 冻结词条名为「namespace 诊断变更日志（namespace diagnostic change log）」；包名逐词对应受控词汇，与 `namespace-runtime` / `namespace-registry` 命名族对齐。
2. 名称保留「diagnostic」与「namespace」双限定，直接反压 ADR 0011 的 _Avoid_ 清单（「审计账本、WAL、event sourcing、可靠恢复日志」）——不含 audit/wal/event 字样，防止下游误读为合规日志。
3. 备选否决：`diagnostic-log`（丢失 namespace 域限定，未来若有非 namespace 诊断流会撞名）；`change-log`（易误解为产品 changelog）；`ndcl`（缩写不进受控词汇）。

本包是**叶子 observability 模块**，不是 Persistence 真相源（ADR 0011 §Interface：「一个日志 adapter 不构成新的 Persistence 真相源；snapshot Persistence 与诊断日志独立演进」）。

### 1.2 依赖方向（单向，无环）

```text
@nomicore/namespace-registry / namespace-runtime / (future replication)   [#149/#150/#151 接线方，本票不接]
        │  仅依赖 emitter interface（ADR 0011 §Interface 小接口）
        ▼
@nomicore/namespace-diagnostic-log   ←── @nomicore/vfsl（compileSchemaEnvelope / validateLogicalSnapshot，
        │                               唯一 workspace 运行时依赖）
        ├── node:crypto（createHash，SHA-256；环境绑定面，本包内唯一，见 §5.2 论证）
        └── Buffer / TextEncoder（Node ≥20 全局，Base64 编码与 UTF-8 字节长）
```

- **不依赖** `@nomicore/clock`：`observedAt` 由 producer 用其注入 Clock 生成后以字符串传入（ADR 0012 §JSONL record：「`observedAt` 由完成操作的 producer 使用注入 Clock 生成」）。本包只导出纯 helper `observedAtFrom(now: () => number): string`（结构兼容 `Clock.now`，见 `packages/clock/src/contract.ts:14`），不引入 cordis 依赖链。
- **不依赖** yjs：本票消费的是 owned `Uint8Array` update bytes（ADR 0011 §Committed update：「底层 transaction 模块应在不暴露 live Y.Doc 的前提下返回或投递 owned bytes」），不编解码 Yjs 结构。

### 1.3 公共 exports（`packages/namespace-diagnostic-log/src/index.ts`）

```ts
// —— 冻结词表与 record 契约类型（§2）——
export type { Operation, Stage, SourceModule, LogSource, LogContext, DiagnosticIssue,
  IssuesProjection, InputCapture, AttemptResult, UpdateCarrier,
  AttemptRecord, GenesisBaselineRecord, DiagnosticChangeRecord,
  StreamId, Sequence, AttemptId, ObservedAt, StableCode, Crc32cHex, Base64, SegmentName, FrameOffset }

// —— 语义 emission 与 emitter 接缝（ADR 0011 §Interface 命名）——
export type { NamespaceDiagnosticChangeEmission, EmissionInput, EmissionResult, DiagnosticSemanticRecord }
export interface NamespaceDiagnosticChangeEmitter {
  emit(emission: NamespaceDiagnosticChangeEmission): void
}

// —— adapter 接缝（storage projection 归 adapter，ADR 0012 §VFSL record schema）——
export interface DiagnosticChangeSink {
  append(record: DiagnosticSemanticRecord): void
}

// —— 可复用 emitter 管线（R2/D-c2 修正表述：#152 File adapter 的 **attempt 记录路径**
//     复用同一管线、只换 sink；genesis-baseline record 不经 emission/sink 公共面，
//     #152 需增设 adapter 内部构造路径——不改 schema、不动 emission 面，备案见 §10-J1）——
export function createDiagnosticChangeEmitter(
  config: DiagnosticEmitterConfig, sink: DiagnosticChangeSink,
): NamespaceDiagnosticChangeEmitter

// —— 本票交付物：有界内存 adapter（emitter + sink 一体装配）——
export function createBoundedMemoryDiagnosticLog(
  config: DiagnosticLogConfig,
): BoundedMemoryDiagnosticLog

export interface BoundedMemoryDiagnosticLog {
  emitter: NamespaceDiagnosticChangeEmitter
  /** 本实例 streamId（构造时 CSPRNG 生成，log- + 32 hex） */
  readonly streamId: string
  /** 已接纳 record 的顺序快照（冻结引用，按 sequence 升序） */
  records(): readonly DiagnosticChangeRecord[]
  /** 低基数健康计数（accepted / dropped by reason / dropped by operation×reason / queueDepth） */
  stats(): DiagnosticMemoryStats
}

// —— 冻结 schema 资产（§3）——
export const RECORD_SCHEMA_ID: 'nomicore.namespace-diagnostic-change-record@1'
export const RECORD_SCHEMA_ENVELOPE: SchemaEnvelope          // 恰四键、深冻结（#152 manifest 内嵌用）
export function getRecordSchemaCompilation(): RecordSchemaCompilationResult  // 惰性一次编译 + 缓存；不抛错

// —— producer helper（#149+ 使用；Clock 结构注入）——
export function observedAtFrom(now: () => number): string

// —— 健康 observability（§8）——
export type { DiagnosticLogHealthEvent, DiagnosticLogHealthObserver }
```

测试子路径 `@nomicore/namespace-diagnostic-log/testing`（对齐 `@nomicore/clock/testing` 先例）：
确定性 `RandomSource`、事件收集型 observer、直接构造最终 record 的 fault-injection 接缝（见 §9.6）、
**带自定义 schema envelope 的 adapter/emitter 工厂**（生产构造器内部函数化——注入坏 envelope 驱动
`schema-compile-failed` failed 模式，R2/F-c1，见 §9.6）、**sequence 状态预置**（把 lastSequence 预置到
uint64 邻域驱动 exhausted 转换，R2/A-c1，见 §9.10）。

### 1.4 配置形状

```ts
export interface DiagnosticLogConfig {
  /** 输入捕获策略，默认 'digest'（ADR 0011 §输入捕获：「默认应为 digest 或更保守策略」） */
  inputPolicy: 'none' | 'digest' | 'redacted' | 'full'
  /** issues 投影策略，默认 'full'（judgement call，见 §10-J6） */
  issuesPolicy: 'none' | 'full' | 'redacted'
  /** committed update 捕获，默认 false（ADR 0011 §数据保护：「committed Yjs update 必须由 Host 明确启用」） */
  updateCapture: boolean
  /** 最终 record 紧凑 JSON 的 UTF-8 字节硬上限（不含结尾 \n），默认 1 MiB（ADR 0012 §投影） */
  lineBudgetBytes: number
  /** 单个 update payload 字节硬上限，默认 64 MiB、不得超过 uint32（ADR 0012 §Inline 与 sidecar） */
  payloadMaxBytes: number
  /** 内存队列容量（条数），默认 1024（judgement call，见 §10-J5） */
  capacity: number
  /** 健康观察者（可选，单实例；故障隔离见 §8.3） */
  observer?: DiagnosticLogHealthObserver
  /** 随机源注入接缝（CSPRNG 默认；测试注入确定性源），仅用于 streamId/attemptId */
  randomSource?: RandomSource
}
```

`createDiagnosticChangeEmitter` 取 `inputPolicy/issuesPolicy`（语义投影归 emitter）；adapter 取其余（物理投影归 adapter）——切分依据 ADR 0012 §VFSL record schema：「日志 adapter 独占 storage projection：先决定 inline/sidecar 并构造最终 record，再运行 VFSL」。

---

## §2 v1 语义词表与 record TS 类型

### 2.1 词表（全部冻结；schema 与 TS 单源，见 §3.2）

**operation**（6 值封闭，ADR 0012 §JSONL record 逐字）：

```ts
export type Operation =
  | 'namespace-create'
  | 'root-mutation'
  | 'schema-replacement'
  | 'replication-apply'
  | 'replication-enable'
  | 'replication-epoch-bump'
```

**stage**（8 值封闭，ADR 0011 §变更尝试与结局 逐字；v1 不折叠、不新增）：

```ts
export type Stage =
  | 'acceptance' | 'capability-gate' | 'input-snapshot' | 'schema-compile'
  | 'validation' | 'identity' | 'transaction' | 'dirty-notification'
```

stage 语义纪律（ADR 0011）：stage 是**结局所属的最后阶段**，不是状态机。`committed` 记录通常 stage=`transaction`；事务已提交但 dirty notification 失败 → producer 提交 `fatal + committed:true + effect:update + stage:'dirty-notification'`（schema 可表达，选择归 producer，日志层不发明语义）。

**result 严格判别联合**（ADR 0012 §JSONL record 六形状；fatal 显式携带 committed 布尔）：

```ts
export type AttemptResult =
  | { kind: 'committed'; effect: 'noop' }
  | { kind: 'committed'; effect: 'update'; update: UpdateCarrier }
  | { kind: 'committed'; effect: 'update-omitted'; reason: string }
  | { kind: 'rejected' }
  | { kind: 'fatal'; committed: false }
  | { kind: 'fatal'; committed: true; effect: 'unknown' }
  | { kind: 'fatal'; committed: true; effect: 'update'; update: UpdateCarrier }
  | { kind: 'fatal'; committed: true; effect: 'update-omitted'; reason: string }
```

- TS 用字面量 `false`/`true` 在**编译期**锁死「committed 事实 ↔ effect 存在」的相关性；VFSL v1 无布尔字面量（v1-spec §2 注记 8），schema 侧的残差见 §10-J2。
- ADR 0011 结局词表第 4 值 `unknown`（结果不可判定）在 v1 存储层**不出现**：v1 只写最终 record（ADR 0012：「首版默认每次变更尝试只写一条最终 attempt record，不写 attempt-started」），进程中断的尝试直接缺失（best-effort），不落 `result:'unknown'` 的记录。此为两份 ADR 的拼接结论，列入 §11-G3 备案。

**source / context**（ADR 0012 §JSONL record 逐字形状）：

```ts
export type LogSource =
  | { kind: 'local' }
  | { kind: 'replication'; direction: 'hub-to-peer' | 'peer-to-hub'; remoteInstanceId: string }

export interface LogContext {
  correlationId?: string
  runtimeGeneration?: string
  replicationId?: string
  replicationEpoch?: number
}
```

v1 不定义 actor（ADR 0012：「首版不定义 actor，等待授权主体模型稳定」）。

**顶层诊断字段**：`stage` 封闭枚举（顶层，ADR 0012：「顶层诊断 stage 使用日志 schema 的封闭枚举」）；`code`/`sourcePhase` 为安全 Pattern 字符串；`sourceModule` 标注稳定 code 的来源模块，封闭 4 值（ADR 0012：「不复制 Registry、Runtime、Persistence 与 replication 的全部错误枚举」——四模块名即此四值）：

```ts
export type SourceModule = 'registry' | 'runtime' | 'persistence' | 'replication'
```

**update-omitted 稳定 reason 词表**（v1 已知 3 值 + 开放 StableCode 形状；R2/D-c1 增补第三值）：
- `payload-too-large`（ADR 0012 给出）；
- `update-capture-disabled`（本设计补：Host 未启用 update 捕获时，committed/fatal-update 事实保留、update 省略——「payload 超限时保留 attempt metadata，记录 update-omitted 与稳定 reason，而不是丢掉整条记录」原则的配置侧同构）；
- `empty-update`（R2/D-c1 增补：producer 移交 **0 字节** owned bytes——空事务更新/空 genesis 边界。0 字节的 Base64 是空串，不匹配 P_BASE64（其尾部组强制非空），不设此分支会把 producer 输入缺陷误标为 `vfsl-validation-failed` 的 writer bug 信号，污染 ADR 0012「append 前 VFSL validation failure 是日志 writer bug」的语义。§7.4 物理化前置守卫转 update-omitted，§9.9 断言不触发 vfsl-validation-failed）。

### 2.2 输入捕获（四策略 × 可得性 → 七值封闭）

```ts
export type InputCapture =
  | { capture: 'none' }              // 策略 none：按策略不捕获
  | { capture: 'not-accessed' }      // capability/acceptance gate 在输入访问前拒绝（ADR 0011）
  | { capture: 'unavailable' }       // 受控快照失败 / 快照契约被违反（§5.4）
  | { capture: 'unsafe-input' }      // 快照失败：Proxy/accessor/循环等敌意输入（producer 判定）
  | { capture: 'digest'; digest: string; degraded?: 'projected-input-too-large' }
  | { capture: 'full'; value: unknown; digest: string }
  | { capture: 'redacted'; value: unknown; digest: string }
```

- `digest` 恒为安全快照 RFC 8785 JCS bytes 的 SHA-256 小写 hex（64 位），**与投影策略无关地对全量快照计算**（§5.2）——full/redacted 变体也携带 digest，保证跨策略可比对（judgement call，§10-J7）。
- `degraded` 仅出现在 digest 变体上：presence ⇔ full/redacted 投影超出 line 预算被降级（v1 唯一原因即字段值 `projected-input-too-large`，ADR 0012：「超出 line 预算时降级为 digest，并记录 projected-input-too-large」）。

### 2.3 issues 统一投影

```ts
export interface DiagnosticIssue {   // ADR 0012 §投影 逐字形状
  code?: string                      // plain string：ADR TS 快照即 plain（§10-J8 论证与预算）
  message: string                    // ≤ 4 KiB UTF-8，超限确定性截断（§6）
  path: (string | number)[]          // ≤ 256 段；string 段 ≤ 1 KiB
}

export interface IssuesProjection {
  policy: 'none' | 'full' | 'redacted'
  items: DiagnosticIssue[]           // ≤ 1000 条，超限截断
  truncated?: boolean                // presence ⇔ 发生过预算截断
  originalCount?: number             // 截断前的有效条数
}
```

`policy` 字段标明投影策略，防消费者误认脱敏后内容为原始 issue（ADR 0011 §数据保护：「若脱敏，记录必须标明 projection/redaction」）。

### 2.4 最终存储 record（冻结 schema 的 TS 孪生）

```ts
export type DiagnosticChangeRecord = AttemptRecord | GenesisBaselineRecord

export interface AttemptRecord {
  recordKind: 'attempt'
  streamId: string        // log- + 32 hex
  sequence: string        // 无前导零十进制字符串（uint64 值域）
  attemptId: string       // producer 受控关联 ID 或 att- + 32 hex
  operation: Operation
  stage: Stage
  observedAt: string      // UTC ISO 8601 毫秒精度
  durationMs?: number
  source: LogSource
  context?: LogContext
  code?: string           // StableCode Pattern；与 sourceModule 成对（emitter 强制）
  sourcePhase?: string    // StableCode Pattern
  sourceModule?: SourceModule
  issues?: IssuesProjection
  input: InputCapture
  result: AttemptResult
}

/** 新 stream 的 genesis 基线：当时完整 Y.Doc 的 update，不是变更尝试（§11-G2 裁决） */
export interface GenesisBaselineRecord {
  recordKind: 'genesis-baseline'
  streamId: string
  sequence: string
  observedAt: string
  source: LogSource
  context?: LogContext
  update: UpdateCarrier
}
```

`recordKind` 是本设计新增的顶层判别字段（论证见 §11-G2）：让「每个新 stream 尽力先记录 genesis baseline」（ADR 0012 §Stream 与 generation）的基线记录能以**非 attempt** 的诚实形状通过同一 schema，同时 replay 工具可稳定识别 genesis。

### 2.5 update 物理载体（两种 storage 形状，一次冻结服务 #152）

```ts
export type UpdateCarrier =
  | { storage: 'inline'; format: 'yjs-update-v1'; payloadLength: number; crc32c: string; base64: string }
  | { storage: 'sidecar'; format: 'yjs-update-v1'; segment: string; frameOffset: string; payloadLength: number; crc32c: string }
```

- inline：RFC 4648 标准 Base64、必须 padding、禁空白换行（ADR 0012 §Inline 与 sidecar）。
- sidecar：字段名逐字对齐 ADR 0012 示例（storage/format/segment/frameOffset/payloadLength），外加 `crc32c`——依据同节规范句「inline 与 sidecar 均记录 payloadLength 与 CRC32C」（示例省略该键属简写，裁决见 §11-G1）。
- `payloadLength` 为 JSON number（uint32 范围内，ADR 0012：「uint32 范围内的 payloadLength 为 JSON number」；范围校验归 storage validator/#152，VFSL 无数值区间语法）。
- `crc32c` 为 8 位小写 hex（ADR 0012：「inline update 同样保存 8 位小写 hex CRC32C」）。
- 本票内存 adapter 只产出 inline 形状；sidecar 形状在 schema 中完整可表达（#152 不改 schema 即可用），内存 adapter 的记录 JSON 与文件 JSONL 记录**逐字段同构**。

### 2.6 语义 emission（producer → emitter）与语义 record（emitter → sink）

```ts
/** producer 提交的 detached 语义结局。不出现 streamId/sequence/segment/offset/Base64/CRC。 */
export interface NamespaceDiagnosticChangeEmission {
  operation: Operation
  stage: Stage
  observedAt: string                       // producer 注入 Clock 生成；observedAtFrom helper
  durationMs?: number
  attemptId?: string                       // 缺失时由 writer 用 128-bit CSPRNG 生成 att-+32hex
  source: LogSource
  context?: LogContext
  code?: string                            // StableCode 形状，intake 校验（§4 步骤 1）
  sourcePhase?: string
  sourceModule?: SourceModule
  issues?: DiagnosticIssue[]               // 原始统一投影输入，预算在管线内施加
  input?: EmissionInput
  result: EmissionResult
}

export type EmissionInput =
  | { status: 'not-accessed' }             // gate 在输入访问前拒绝
  | { status: 'unavailable' }              // 受控快照失败（producer 判定）
  | { status: 'unsafe-input' }             // 输入敌意（producer 判定）
  | { snapshot: unknown }                  // 已生成的 detached frozen plain-data 安全快照（所有权移交）
// 省略 input 字段 ⇔ 无可捕获输入（按 none 处理）

export type EmissionResult =               // 语义镜像 of AttemptResult，update 以 owned bytes 表达
  | { kind: 'committed'; effect: 'noop' }
  | { kind: 'committed'; effect: 'update'; updateBytes: Uint8Array }
  | { kind: 'committed'; effect: 'update-omitted'; reason: string }
  | { kind: 'rejected' }
  | { kind: 'fatal'; committed: false }
  | { kind: 'fatal'; committed: true; effect: 'unknown' }
  | { kind: 'fatal'; committed: true; effect: 'update'; updateBytes: Uint8Array }
  | { kind: 'fatal'; committed: true; effect: 'update-omitted'; reason: string }

/** emitter 管线输出（语义投影已完成，物理投影未开始）——sink 消费 */
export interface DiagnosticSemanticRecord {
  attemptId: string
  operation: Operation
  stage: Stage
  observedAt: string
  durationMs?: number
  source: LogSource
  context?: LogContext
  code?: string
  sourcePhase?: string
  sourceModule?: SourceModule
  issues?: IssuesProjection
  input: InputCapture
  result: SemanticResult                  // 同 EmissionResult（updateBytes: Uint8Array）
}
```

所有权契约（ADR 0011 §Interface：「emit 的 interface 语义是立即接收一份由调用方持有权已转移或已复制的 detached record；不得阻塞、throw、返回 durability promise，亦不得保留调用方可变引用」）：emission 传入后 snapshot 的所有权移交日志管线（管线深冻结语义 record，敌意后变异在 strict mode 下 loud 抛 TypeError，属 producer bug）；**R3（总控裁决 2026-08-28）：updateBytes 改为 intake 时复制**——`Object.freeze` 对非空 typed array 在 V8 必抛「Cannot freeze array buffer views with elements」（node 实测确认），冻结无法机器强制 updateBytes 不可变异；ADR 明文允许「已转移**或已复制**」，复制是唯一可机器的隔离（payload ≤ payloadMaxBytes 有界，复制成本有上界）。因此 producer 在 emit 后变异原 updateBytes **不影响**已接纳 record（复制隔离），契约测试断言复制隔离而非 TypeError；plain-data snapshot 维持冻结语义不变。

---

## §3 内建冻结 VFSL schema 与指纹获取

### 3.1 冻结信封

```ts
export const RECORD_SCHEMA_ID = 'nomicore.namespace-diagnostic-change-record@1' as const
// RECORD_SCHEMA_ENVELOPE = { lang: 'vfsl', version: 1, id: RECORD_SCHEMA_ID, text: RECORD_SCHEMA_TEXT }
// 恰四键、深冻结；经 @nomicore/vfsl compileSchemaEnvelope 编译（严格封闭门 ENV-5 兜底自检）
```

id 逐字取自 ADR 0012 §VFSL record schema：「id 为 `nomicore.namespace-diagnostic-change-record@1`」；方言固定 `vfsl@1`，「不引用 latest」（同节）。文本用 `compileSchemaEnvelope`（`packages/vfsl/src/index.ts:303`）编译：恰四键严格封闭 → 方言断言 → parseVfsl → evaluate → 双指纹 + 深冻结五件套，同步纯函数不抛错——与「writer 启动时编译一次内建 schema 并缓存」（ADR 0012）对齐：本设计在 log 工厂构造时**急切编译一次**并缓存于实例外模块级（进程内文本唯一，编译产物可共享；失败进 failed 模式，见 §4 步骤 0）。

### 3.2 schema 与 TS 的单源纪律

所有 Pattern 字符串先定义为 TS 常量（`schema-patterns.ts`），schema 文本以模板字面量**插值**这些常量——TS intake 校验与 VFSL Pattern 永不漂移。全部 Pattern **零反斜杠**（规避 v1-spec §2 注记 6 的 `\\` 双写坑与 E202）：

```ts
export const P_STREAM_ID   = '^log-[0-9a-f]{32}$'
export const P_DECIMAL     = '^(0|[1-9][0-9]*)$'
export const P_BOUNDED_STR = '^.{1,256}$'        // `.` 不匹配行终止符（ECMAScript 语义）→ 天然禁换行
export const P_ISO_MS      = '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
export const P_STABLE_CODE = '^[A-Za-z0-9_.:-]{1,128}$'
export const P_CRC32C_HEX  = '^[0-9a-f]{8}$'
export const P_SHA256_HEX  = '^[0-9a-f]{64}$'
export const P_SEGMENT     = '^[0-9]{8}$'
export const P_BASE64      = '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})$'
```

Base64 Pattern 论证：`(?:[A-Za-z0-9+/]{4})*`（任意完整组）+ 恰一个尾部（2 字符+`==`、3 字符+`=`、或完整组）→ 总长恒为 4 的倍数、非空、padding 只在尾、单字符尾非法——RFC 4648 padded 标准形。引擎可行性已核实：`packages/vfsl/src/pattern.ts:298-356` 支持 `(?:)` 分组、alternation（split 指令）、`{m,n}` 量词展开（PatternTooLargeError 上限 10_000 指令，本组 Pattern 展开远低于上限）、字符类与 `^$` 锚定；NFA 子集模拟多项式完成（ReDoS 防护内建）。`^.{1,256}$` 中 `.` = 除行终止符外任意 UTF-16 码元（pattern.ts `any` 指令，L68）——正好同时实现「有界 + 无换行」双约束。

### 3.3 完整冻结 schema 文本（RECORD_SCHEMA_TEXT，逐字段注释即设计理由）

```vfsl
/** namespace 诊断变更日志 v1 存储 record 契约（issue #148 冻结）。
 *  单条最终 JSONL line 的逻辑形状；ADR 0011/0012 为规范来源。
 *  物理事实（segment/frame/offset 连续性、retention、跨记录不变量）不在本 schema，
 *  由 storage validator 负责（ADR 0012 §VFSL record schema 分工）。 */

/** record 身份的 stream 半段：log- + 32 位小写 hex，128-bit CSPRNG 生成（ADR 0012 §Stream 与 generation） */
type StreamId = string & Pattern<"^log-[0-9a-f]{32}$">;

/** record 身份的顺序半段：无前导零十进制字符串，uint64 值域；仅代表本 stream 的 append 顺序，
 *  不证明业务尝试无缺，也不是跨副本全局顺序（ADR 0012 §JSONL record） */
type Sequence = string & Pattern<"^(0|[1-9][0-9]*)$">;

/** 变更尝试关联 ID：producer 复用的既有受控关联 ID，或 writer 生成的 att- + 32 位小写 hex；
 *  有界且不含行终止符（`.` 语义），杜绝 JSONL 行注入 */
type AttemptId = string & Pattern<"^.{1,256}$">;

/** producer 侧完成时刻：UTC ISO 8601、毫秒精度、Z 后缀；由完成操作的 producer 用注入 Clock 生成 */
type ObservedAt = string & Pattern<"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$">;

/** 稳定诊断码：ASCII 受控字符集、≤128 字符；顶层 code/sourcePhase 与 update-omitted reason 共用。
 *  「安全 Pattern 字符串」（ADR 0012）——低基数、无控制字符、无自由文本 */
type StableCode = string & Pattern<"^[A-Za-z0-9_.:-]{1,128}$">;

/** CRC-32C（Castagnoli）8 位小写 hex：inline 与 sidecar update payload 的完整性侧写（ADR 0012 §Binary frame v1） */
type Crc32cHex = string & Pattern<"^[0-9a-f]{8}$">;

/** RFC 4648 标准 Base64（含必须 padding、无空白换行）：inline update 的物理表示（ADR 0012 §Inline 与 sidecar） */
type Base64 = string & Pattern<"^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})$">;

/** sidecar 所在 segment 名：固定 8 位十进制，00000001 起，00000000 保留（ADR 0012 §Segment rolling） */
type SegmentName = string & Pattern<"^[0-9]{8}$">;

/** sidecar frame 起点：指向 frame magic 首字节，十进制无前导零字符串；首 frame 偏移可为 0 */
type FrameOffset = string & Pattern<"^(0|[1-9][0-9]*)$">;

/** SHA-256 小写 hex（64 位）：安全快照 RFC 8785 JCS bytes 的摘要（ADR 0012 §投影） */
type Sha256Hex = string & Pattern<"^[0-9a-f]{64}$">;

/** committed Yjs update 的两种物理表示；inline 阈值只影响物理表示，不改语义。
 *  rejected 与 fatal committed:false 的 record 形状不声明 update 字段（封闭对象）→ 携带 update 即被拒绝，
 *  机器强制 ADR 0012「rejected 与 fatal committed:false 禁止携带 update」 */
type UpdateCarrier =
  | {
      storage: "inline";
      format: "yjs-update-v1";
      /** payload 字节数；与 Base64 解码长度的一致性归 storage validator（ADR 0012 分工） */
      payloadLength: number;
      crc32c: Crc32cHex;
      base64: Base64;
    }
  | {
      storage: "sidecar";
      format: "yjs-update-v1";
      segment: SegmentName;
      frameOffset: FrameOffset;
      payloadLength: number;
      crc32c: Crc32cHex;
    };

/** v1 封闭 operation 词表（ADR 0012 §JSONL record 逐字；新增 operation 需新 record schema 版本与 stream generation） */
type Operation =
  | "namespace-create"
  | "root-mutation"
  | "schema-replacement"
  | "replication-apply"
  | "replication-enable"
  | "replication-epoch-bump";

/** 结局所属阶段的封闭枚举（ADR 0011 §变更尝试与结局 8 值逐字；不折叠为统一 failed） */
type Stage =
  | "acceptance"
  | "capability-gate"
  | "input-snapshot"
  | "schema-compile"
  | "validation"
  | "identity"
  | "transaction"
  | "dirty-notification";

/** 稳定 code 的来源模块封闭枚举（ADR 0012：Registry、Runtime、Persistence 与 replication） */
type SourceModule =
  | "registry"
  | "runtime"
  | "persistence"
  | "replication";

/** 变更来源：本地写路径或可信复制路径（ADR 0012 §JSONL record 逐字形状）。
 *  remoteInstanceId 有界无换行：复制身份受控，violation 由 intake 拒绝（结构性，§4） */
type LogSource =
  | { kind: "local" }
  | {
      kind: "replication";
      direction: "hub-to-peer" | "peer-to-hub";
      remoteInstanceId: string & Pattern<"^.{1,256}$">;
    };

/** 受控关联上下文（ADR 0012 逐字形状）：全可选，缺失即未提供；
 *  owner/instanceId/epoch 不冻结在 manifest，按记录表达（同上） */
type LogContext = {
  correlationId?: string & Pattern<"^.{1,256}$">;
  runtimeGeneration?: string & Pattern<"^.{1,256}$">;
  replicationId?: string & Pattern<"^.{1,256}$">;
  replicationEpoch?: number;
};

/** issues 统一投影单条（ADR 0012 §投影 逐字形状）。message/path 的字节预算由确定性投影施加（截断+标记），
 *  不用 Pattern 表达——截断标记可能包含任意原文字符，Pattern 会误杀合法截断结果 */
type PathSegment = string | number;

type DiagnosticIssue = {
  /** 所属模块稳定码；ADR TS 快照即 plain string，预算由投影施加（256 字节截断） */
  code?: string;
  /** ≤4 KiB UTF-8，超限确定性截断且不拆分 code point */
  message: string;
  /** ≤256 段；string 段 ≤1 KiB（截断+标记） */
  path: PathSegment[];
};

/** issues 投影容器：policy 标明捕获策略（防误认脱敏内容为原始 issue，ADR 0011 §数据保护）；
 *  truncated/originalCount 仅在实际发生预算截断时出现（presence 语义） */
type IssuesProjection = {
  policy: "none" | "full" | "redacted";
  items: DiagnosticIssue[];
  truncated?: boolean;
  originalCount?: number;
};

/** 输入捕获：四策略 × 可得性的七值封闭（ADR 0011 §输入捕获 + ADR 0012 §投影）。
 *  digest 恒为安全快照 JCS bytes 的 SHA-256；degraded 仅在 digest 变体上出现，
 *  presence ⇔ full/redacted 投影超 line 预算降级（v1 唯一原因 projected-input-too-large） */
type InputCapture =
  | { capture: "none" }
  | { capture: "not-accessed" }
  | { capture: "unavailable" }
  | { capture: "unsafe-input" }
  | { capture: "digest"; digest: Sha256Hex; degraded?: "projected-input-too-large" }
  | { capture: "full"; value: unknown; digest: Sha256Hex }
  | { capture: "redacted"; value: unknown; digest: Sha256Hex };

/** 结局严格判别联合（ADR 0012 §JSONL record 六形状展开为 8 个具体成员）。
 *  判别字段 kind + effect 均为字符串字面量（VFSL v1 字面量仅 string/number）；
 *  fatal 的 committed 事实以显式 boolean 携带——VFSL 无法机器锁死「committed:true ⇒ effect 存在」
 *  （v1-spec §2 注记 8），该相关性由 TS 字面量类型 + emitter 唯一构造点 + 契约测试三重强制（§10-J2） */
type AttemptResult =
  | { kind: "committed"; effect: "noop" }
  | { kind: "committed"; effect: "update"; update: UpdateCarrier }
  | { kind: "committed"; effect: "update-omitted"; reason: StableCode }
  | { kind: "rejected" }
  | { kind: "fatal"; committed: boolean }
  | { kind: "fatal"; committed: boolean; effect: "update"; update: UpdateCarrier }
  | { kind: "fatal"; committed: boolean; effect: "update-omitted"; reason: StableCode }
  | { kind: "fatal"; committed: boolean; effect: "unknown" };

/** 最终 attempt record：一次变更尝试的完整结局；首版不写 attempt-started（ADR 0012）。
 *  记录身份是 (streamId, sequence)，不另设 recordId；无 namespaceId 字段——
 *  namespace 关联由 stream 归属（文件布局 namespaces/{namespaceId}/streams/{streamId}）表达 */
type AttemptRecord = {
  recordKind: "attempt";
  streamId: StreamId;
  sequence: Sequence;
  attemptId: AttemptId;
  operation: Operation;
  stage: Stage;
  observedAt: ObservedAt;
  /** 仅存在可靠 monotonic duration 来源时记录，毫秒（ADR 0012 §JSONL record） */
  durationMs?: number;
  source: LogSource;
  context?: LogContext;
  /** 所属模块已有稳定 code；与 sourceModule 成对出现（emitter 强制，schema 残差见 §10-J3） */
  code?: StableCode;
  sourcePhase?: StableCode;
  sourceModule?: SourceModule;
  issues?: IssuesProjection;
  input: InputCapture;
  result: AttemptResult;
};

/** 新 stream 的 genesis 基线 record：当时的完整 Y.Doc update，不是变更尝试
 *  （ADR 0012 §Stream 与 generation「每个新 stream 尽力先记录 genesis baseline」；
 *  形状裁决见设计 §11-G2——无 attemptId/operation/stage/result/input，诚实表达非尝试身份） */
type GenesisBaselineRecord = {
  recordKind: "genesis-baseline";
  streamId: StreamId;
  sequence: Sequence;
  observedAt: ObservedAt;
  source: LogSource;
  context?: LogContext;
  update: UpdateCarrier;
};

/** 根：attempt 与 genesis-baseline 两族 record 的封闭联合（全 map 形联合，满足 v1-spec §3 ROOT 约定） */
type ROOT = AttemptRecord | GenesisBaselineRecord;
```

语法自检清单（v1-spec §2/§3/§4 逐条核对，SA3 落地时以 `compileSchemaEnvelope` 结果为准）：

- 无括号分组（`PathSegment` 别名承载 `string | number`，避免 `( string | number )[]` → E100）。
- 无负数/小数字面量；无 `true/false/null` 字面量（布尔用 `boolean`，v1-spec §2 注记 8）。
- ROOT 为全 map 形联合（两成员均裸对象）→ 非 E311。
- 全部联合成员同形（容器形 or 标量形）无混合（E309）：`LogSource`/`InputCapture`/`AttemptResult`/`UpdateCarrier`/`ROOT` 全容器形成员；`Operation`/`Stage`/`SourceModule` 全字符串字面量（标量）。`PathSegment` 混合联合位于数组元素位 = 标量叶值（v1-spec §3 默认物化表第 4 行），非 E309。
- 无循环引用（E106）；别名全部可解析（E301）；无保留名别名（E303）。
- Pattern 全部零反斜杠（E202 免疫）；锚定显式 `^…$`（v1-spec §3 Pattern：「锚定不由方言隐含」）。
- JSDoc 全部紧邻可挂载节点、无悬空（E305）；`//` 行注释为忽略型。

### 3.4 指纹获取方式（冻结资产的变更纪律）

```ts
export function getRecordSchemaCompilation(): RecordSchemaCompilationResult {
  // 模块级单次缓存；compileSchemaEnvelope(RECORD_SCHEMA_ENVELOPE)
  //   ok  → { ok: true; envelope; module; derived; envelopeFingerprint; semanticFingerprint }（深冻结）
  //   !ok → { ok: false; issues: SchemaParseIssue[] }（不抛错；writer bug 信号）
}
```

- **冻结身份键 = `envelopeFingerprint`**（格式 `sha256:v1:<hex>`，对恰四键信封整体取指纹）。#152 打开既有 stream 时「manifest format/version 和 schema fingerprint 必须与内建冻结版本匹配；不匹配则旧 stream 保持只读，建立新 generation，不改写旧 manifest」（ADR 0012 §VFSL record schema）——比对双方都用 `getRecordSchemaCompilation().envelopeFingerprint`，单一来源。
- `semanticFingerprint` 一并导出（忽略 id/空白差异的语义身份），供工具诊断「文本排版漂移 vs 语义漂移」。
- **变更纪律**：schema 文本任何改动（含 JSDoc——文档注释进 semantic fingerprint）都会改变指纹 → 等价于新 record schema 版本：id 升 `@2`、新 stream generation、旧 stream 只读。契约测试把 `envelopeFingerprint` 钉成编译期常量断言（§9.8），指纹变化必须在测试里有意识地改常量，防止静默漂移。
- manifest 内嵌：#152 直接内嵌 `RECORD_SCHEMA_ENVELOPE`（「manifest.json …至少保存完整 record schema VFSL 四键信封」）——本包导出该对象即冻结物，不复制第二份文本。

---

## §4 emitter 管线数据流与每步失败隔离

### 4.1 总数据流

```text
producer（#149+）
  │ emit(emission)                        —— 同步、void、绝不 throw/阻塞（ADR 0011 §Interface）
  ▼
┌─ emitter 管线（语义投影，adapter 无关，#152 复用）──────────────────────────────┐
│ 0 管线级 try/catch 兜底（→ health pipeline-crashed/emitter，丢弃，绝不外抛）      │
│ 1 intake 结构校验（词表/形状/observedAt/attemptId/code Pattern）                 │
│     违规 → 丢弃 emission + health emission-dropped（§8）                        │
│ 2 attemptId 缺省（emission.attemptId ?? randomSource.attemptId()）              │
│ 3 输入投影（§5：策略×可得性 → InputCapture；JCS+SHA-256；预算与降级预备）        │
│ 4 issues 投影（§6：预算截断/脱敏 → IssuesProjection）                           │
│ 5 enrichment 清洗（context/code/durationMs/issue 条目级违规 → 丢字段+health）    │
│ 6 组装 DiagnosticSemanticRecord（深冻结）                                       │
│ 7 sink.append(semanticRecord)（同样防 throw）                                   │
└──────────────────────────────────────────────────────────────────────────────┘
  ▼
┌─ 内存 adapter（storage projection，ADR 0012「adapter 独占」）───────────────────┐
│ 0′ 构造时急切编译冻结 schema；失败 → failed 模式（health schema-compile-failed，  │
│    后续 append 全丢弃并计数，不再逐条发事件）                                    │
│ 1 分配 sequence（准备 append 时才分配：十进制字符串进位自增，uint64 全域无 number 失真，│
│    §4.3；丢弃也消耗 → 诚实 gap；达 uint64 max → exhausted 模式）                 │
│ 2 update 物理化：owned bytes → inline carrier（Base64+CRC32C+payloadLength）    │
│    或 update-omitted（empty-update / payload-too-large / update-capture-disabled）│
│ 3 组装最终 DiagnosticChangeRecord（含 streamId/sequence/recordKind）             │
│ 4 line 预算（§5.5）：序列化字节 > lineBudgetBytes →                              │
│      a input full/redacted → 降级 digest（+degraded 标记）+ health input-degraded│
│      b 仍超限 → 丢弃整条 record + health record-dropped/line-budget-exceeded    │
│ 5 VFSL 校验：validateLogicalSnapshot(compiled.derived, record)                  │
│      失败 → 丢弃 + health vfsl-validation-failed（writer bug，ADR 0012）         │
│ 6 入队：depth < capacity ? push(freeze(record)) : drop newest +                 │
│      health record-dropped/queue-full（保留已接纳顺序，ADR 0012 §Writer）         │
└──────────────────────────────────────────────────────────────────────────────┘
```

设计依据：

- 「业务 producer 只提交 semantic emission，不构造 segment/offset/Base64 等物理表示。日志 adapter 独占 storage projection：先决定 inline/sidecar并构造最终 record，再运行 VFSL」（ADR 0012 §VFSL record schema）→ emitter/adapter 的切分线正是**语义投影/物理投影**。
- 「首版不为 semantic emission 建立第二份 VFSL，避免双 schema 漂移」（同节）→ 语义 emission 只做廉价 TS 级形状校验（步骤 1），不做第二次 VFSL 校验；唯一的 VFSL 校验点在最终 record（步骤 5）。
- 「append 前 VFSL validation failure 是日志 writer bug：丢弃 record、增加低基数 metric并向独立结构化 observer 上报，不改变业务结果」（同节）→ 步骤 5 失败即丢弃 + §8 事件。
- 「writer queue 满时 drop newest，保留已排队顺序；不得为了记录 drop 再挤占同一队列」（ADR 0012 §Writer）→ drop 事件**只走 health observer**，绝不作为 record 入队。

### 4.2 每步失败隔离语义（汇总表）

| 步骤 | 失败模式 | 隔离动作 | producer 可见性 |
|---|---|---|---|
| emit 任意点 | 意外异常（含敌意 getter 二次抛） | 顶层 catch → 丢弃 + `pipeline-crashed/emitter` | 无（emit 返回 void，不 throw） |
| intake | 词表外 operation/stage、result 形状缺残、observedAt/attemptId/code 违 Pattern、source 违形（含 remoteInstanceId） | 丢弃 emission + `emission-dropped` | 无 |
| 输入投影 | 快照遍历抛出/超节点护栏/非 JSON 值（undefined/symbol/bigint/非有限数） | `capture:'unavailable'` + `input-projection-failed`；**不重读、不重试**（ADR 0011「不得为了记录完整请求重新读取」） | 无 |
| issues 投影 | 条目畸形（缺 message/path 非数组）**或 path 段非 JSON-safe**（段既非 string 亦非 `Number.isFinite` 的 number——NaN/±Infinity/undefined 段；稀疏数组 hole 读出 undefined 同拒） | 丢弃该条目（originalCount 只计有效条目）+ `enrichment-field-dropped/issues`（R2/C-b1：段级 JSON-safe——NaN 段在 JSONL 序列化为 `null`、strict reader 必拒，「writer 产出的行必须自己能读」） | 无 |
| enrichment | context.*、code/sourcePhase/sourceModule、durationMs 非有限 | 丢弃该字段 + `enrichment-field-dropped/<field>`；**不丢整条 record**（保住诊断事实本体） | 无 |
| sink.append 任意点 | 意外异常 | adapter 顶层 catch → 丢弃 + `pipeline-crashed/adapter` | 无 |
| schema 编译 | compileSchemaEnvelope !ok（构建期 bug） | 构造时一次 `schema-compile-failed`；failed 模式全丢弃 + 计数 | 无 |
| update 物理化 | bytes.length === 0（R2/D-c1）/ bytes > payloadMaxBytes | update-omitted/`empty-update` / update-omitted/`payload-too-large`（均保 attempt metadata，ADR 0012；**不得**产生 `vfsl-validation-failed`） | 无 |
| line 预算 | 序列化超限 | 先降级 input→digest；仍超限丢弃 + `record-dropped/line-budget-exceeded` | 无 |
| VFSL 校验 | 校验失败（writer bug / 测试注入） | 丢弃 + `vfsl-validation-failed`（只带 issuePaths，不带 message） | 无 |
| 队列 | 满员 | drop newest + `record-dropped/queue-full`；已接纳顺序不变 | 无 |
| observer | 任意 throw | 包 try/catch → fallback logger 稳定码（§8.3）；计数抑制 | 无 |

关键不变量：**任何单一路径的失败都不改变业务结果、不 throw、不阻塞**（ADR 0011 §产品契约「日志 emit、排队、持久化、背压、丢弃或关闭失败不得改变业务操作的返回值、rejection、提交事实、sequencer 顺序或 Runtime 状态」）。

### 4.3 sequence 分配与身份

- 内存路径：`streamId` 在 adapter **构造时**生成一次（`log-` + 32 hex，CSPRNG）；单实例单 stream，无跨实例碰撞域，故不做 ADR 0012 的碰撞重试（文件路径的 manifest 域才有碰撞问题；差异在 AGENTS.md 标注）。`sequence` 在步骤 1 分配（准备 append 时才分配，ADR 0012），从 1 起单调递增、不回绕；被丢弃的 record（line 预算/VFSL/队列满）同样消耗 sequence → 队列内出现 gap 是**诚实信号**（「sequence …仅代表该 stream 的 append 顺序，不证明业务尝试无缺」）。
- **sequence 生成纪律（R2/A-c1）**：sequence 以**十进制字符串缓存 + 数字符串进位**生成（`nextDecimal(s)`：自末位起逐位 +1、9→0 进位），全程不经 `number` 算术——JS number 超 2^53 后 `next++` 失真会产出重复/跳变、却仍匹配 `P_DECIMAL` 的十进制串（静默损坏），字符串进位覆盖 uint64 全域（上界 `18446744073709551615`）无失真；`stats().lastSequenceAssigned` 因此为 `string | null`（§7.2）。到达 uint64 max 后进入 **exhausted 模式**（ADR 0012 §JSONL record 逐字：「达到 uint64 最大值后 stream 进入 exhausted，后续日志 emission 丢弃并上报，业务不受影响」）：后续 append 丢弃 + stats 计数，事件抑制策略与 failed 模式一致（不逐条发事件）；`sequence-exhausted` reason 的词表演进方式备案于 §8.1 与 §10-J13。testing 子路径提供 lastSequence 预置接缝驱动 exhausted 邻域（§9.10）。
- `attemptId`：emission 携带则透传（受控关联 ID 复用，ADR 0012）；缺失时 intake 后立即用注入 `RandomSource`（默认 `node:crypto.randomBytes(16)` CSPRNG）生成 `att-` + 32 小写 hex。
- ADR 0011 的 `emitterSequence` 与 ADR 0012 的 stream `sequence` 在 v1 单写者模型下是同一概念（每 stream 单逻辑 writer queue），统一用 `sequence` 表达，不引入双计数。

### 4.4 随机源/时钟注入接缝

```ts
export interface RandomSource {
  /** n 字节密码学随机（生产默认 node:crypto.randomBytes；测试注入确定性序列） */
  randomBytes(n: number): Uint8Array
}
```

- `RandomSource` 仅两个用途：streamId（16B）、attemptId（16B）。生产默认 CSPRNG 是 ADR 硬要求（「受控 128-bit CSPRNG」）；注入接缝仅测试可用性服务，AGENTS.md 写明纪律。
- 时钟：管线内**零时钟依赖**（observedAt 是 producer 事实；adapter 不盖 appendedAt——ADR 0012：「首版不记录 appendedAt，排序以 sequence 为准，不按 wall clock 排序」）。`observedAtFrom(now)` 是给 producer 的纯 helper：`new Date(now()).toISOString()`（恒为 `YYYY-MM-DDTHH:MM:SS.sssZ`，与 P_ISO_MS 精确匹配；epoch 超出 ISO 表示域时 throw——producer 侧 bug，发生在 emit 之前，不违反 emit 不抛错契约）。

---

## §5 输入捕获四策略算法

### 5.1 策略×可得性决策表（确定性，无自由裁量）

| emission.input | policy=none | policy=digest | policy=redacted | policy=full |
|---|---|---|---|---|
| 省略 | `{capture:'none'}` | `{capture:'none'}` | `{capture:'none'}` | `{capture:'none'}` |
| `{status:'not-accessed'}` | `{capture:'not-accessed'}`（事实优先于策略，四列皆同） | | | |
| `{status:'unavailable'}` | `{capture:'unavailable'}` | | | |
| `{status:'unsafe-input'}` | `{capture:'unsafe-input'}` | | | |
| `{snapshot}` | `{capture:'none'}` | `{capture:'digest',digest}` | `{capture:'redacted',value:redact(s),digest}` | `{capture:'full',value:s,digest}` |

「事实优先于策略」：gate 前拒绝与快照失败由 producer 判定并原样入 record，任何策略不得改写事实（ADR 0011 §输入捕获：「capability/acceptance gate 在输入访问前拒绝时，记录 input.capture = not-accessed，不得随后序列化、hash 或检查原始请求」「快照失败时，记录稳定 issue 与 input.capture = unavailable/unsafe-input」）。

### 5.2 digest = SHA-256(RFC 8785 JCS bytes)：实现策略与论证

**JCS 规范化（纯 TS，`canonical-json.ts`）**——RFC 8785 在 ECMAScript 宿主下的实现要点：

```ts
function jcs(value: JsonValue): string {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new SnapshotContractViolation()   // §5.4
    return String(value)          // RFC 8785 §3.2.2.3：ECMAScript Number::toString（含 1e+21、-0→"0"）
  }
  if (typeof value === 'string') return JSON.stringify(value)
    // RFC 8785 §3.2.2.2 转义集：\" \\ \b \f \n \r \t + \u00xx 小写 hex；非 ASCII 不转义；
    // ES2019 well-formed JSON.stringify 将 lone surrogate 转义为 \udXXX —— RFC 未定义域上的
    // 确定性全函数扩展（与 vfsl sha256.ts 的 WTF-8 单射哲学同向：不替换、不坍缩）
  if (Array.isArray(value)) {
    // R2/C-b1：稀疏数组 hole 与显式 undefined 元素都是快照契约违反——map/join 会跳洞产出
    // 非 JSON 文本（如 "[,]"），而 JSON.stringify 把 hole 呈现为 null（digest 与嵌入值表示分叉）。
    // 逐槽显式检查，violation → SnapshotContractViolation（→ capture:'unavailable'，§5.4）。
    const parts: string[] = []
    for (let i = 0; i < value.length; i++) {
      if (!(i in value) || value[i] === undefined) throw new SnapshotContractViolation()
      parts.push(jcs(value[i] as JsonValue))
    }
    return '[' + parts.join(',') + ']'
  }
  // object：键按 UTF-16 code unit 序排序（RFC 8785 §3.2.3；JS `<` 即该序），递归
  const keys = Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + jcs(value[k])).join(',') + '}'
}
```

- 排序依据 RFC 8785 §3.2.3（UTF-16 code unit 排序，非 locale 比较）；数字序列化依据 §3.2.2.3（ECMAScript 格式）；字符串转义依据 §3.2.2.2。canonical 文本经 `TextEncoder`（全局，Node ≥20 与浏览器同语义）转 UTF-8 字节——文本中的非 ASCII 原样编码；lone surrogate 已被 JSON.stringify 转义为 ASCII 序列，**不经过** TextEncoder 的 U+FFFD 替换路径 → 全输入空间单射。
- `digest = createHash('sha256').update(bytes).digest('hex')`（小写 64 hex，匹配 P_SHA256_HEX）。
- KAT：RFC 8785 §Appendix 向量子集（键序 `\r` < `\u20ac` 等、`1e+21`、`-0`、`333333333.33333329`）+ SHA-256 标准向量（空串 `e3b0c442…`、`"abc"` `ba7816bf…`）进契约测试（§9.3）。

**SHA-256 用 node:crypto 而非纯 TS 的论证**：

1. **延迟面**：默认策略即 digest（ADR 0011），SHA-256 在 `emit()` 内同步执行——native 实现 ~1–2 GB/s vs 纯 TS ~50–100 MB/s（vfsl 参考实现的量级）；大快照下把 producer 可见 CPU 延迟压缩一个数量级，直接服务「emit 不得阻塞」的工程边界。
2. **先例与定位**：仓内 `node:crypto` 先例是 `packages/vfsl-codegen/src/header.ts:10`（node 绑定的工具面）；vfsl **引擎包**刻意避免 node:crypto 是为守住「引擎包内唯一环境绑定面 = FileSchemaSource」（`packages/vfsl/src/sha256.ts:4-9` 头注）。本包不是引擎包，是服务端 observability 模块（消费方 yjs-server，Node ≥20），不承担浏览器/edge 约束。
3. **正确性成本**：自写第三份 SHA-256（vfsl 内部一份不导出、vfsl-codegen 一份之后）只增加 KAT 负担不带收益；node:crypto 即 FIPS 级实现。
4. **不依赖 node:crypto 的部分依然纯 TS**：CRC32C 本就无 node API（Node 的 zlib.crc32 是 CRC-32/IEEE 非 Castagnoli），JCS 无原生等价——两者纯 TS + ADR/官方 KAT。
- 环境绑定面收口：`node:crypto` + `Buffer` 仅出现在 `digest.ts` 与 `carrier.ts` 两个内部模块；AGENTS.md 声明此唯一绑定面。

### 5.3 redacted / full 投影

- **full**：安全快照按引用嵌入 `value`（不再遍历；序列化时一次性读取）——零额外变换，schema `value: unknown` 接受任意 JSON 值（`packages/vfsl/src/validate.ts:322,458-460`：unknown 永不矛盾、恒接受）。
- **redacted（v1 确定性算法）**：结构保形、叶值脱敏——递归遍历快照，`string | number | boolean` 叶一律替换为固定标记 `"«redacted»"`，`null` 保留（区分「显式空」与「被脱敏值」），object/array 保形递归。记录以 `capture:'redacted'` 自我标明（ADR 0011 §数据保护：「记录必须标明 projection/redaction，而不能让消费者误认为是原始 issue」的同构纪律）；精确比对靠同记录携带的 digest。护栏：遍历节点数 > 1_000_000 → 视为投影失败走 `capture:'unavailable'` + `input-projection-failed`（防畸形巨型快照，非预期路径）。算法是 judgement call（ADR 未定义脱敏规则，见 §10-J4）。
- 两种投影的**降级预备**：digest 恒先算好（full/redacted 变体也携带）→ adapter 的 line 预算降级是纯字段手术（去 value、加 degraded 标记），**不再接触快照**。

### 5.4 输入前的零额外读取纪律

- 管线只消费 emission 携带的 `snapshot`（该操作已生成的同一份 detached frozen plain-data snapshot，ADR 0011：「快照成功后，日志只能消费该操作已经生成的同一份 detached frozen plain-data snapshot，不得再次遍历调用方原对象」）。**原始请求对象从不进入日志模块**——结构上不可重读。
- 快照契约防御：遍历中发现非 JSON 值（`undefined`/`symbol`/`bigint`/函数/非有限数）或遍历抛出（敌意 getter——快照本不该有，属 producer 违约）→ 立即放弃，`capture:'unavailable'` + health `input-projection-failed`，不重试不重读（「拒绝虚假降级」判别：这是快照契约被破坏的**异常路径**，降级到 unavailable 是文档化行为 + 健康上报，不是吞 bug）。
- **序列化分叉纪律（R2/C-b1）**：①**稀疏数组 hole / 显式 `undefined` 数组元素** → §5.2 jcs 数组分支逐槽检查直接判快照契约违反（`unavailable`），不允许 `[null,…]` 假象进入 record；②快照中的 **`-0`**：JCS 侧 `String(-0)` 归一为 `"0"`（RFC 8785 §3.2.2.3），digest 与序列化视图（`JSON.stringify(-0)` → `0`）天然同基；full 嵌入 value 中的 `-0` 在 JSON 视图呈现 `0`、内存对象保留 `-0`——round-trip 后仍为合法 number（§9.8 孪生不变量不破），不做深拷贝归一（成本不值），消费方以序列化视图为准；issues path 的 number 段则在投影处显式归一 `-0 → +0`（§6.2；段数小、廉价，保证内存对象与 JSON 视图逐字段一致）。

### 5.5 line 预算与超限处理顺序（默认 1 MiB）

```text
measure(record) = Buffer.byteLength(JSON.stringify(record))   // 紧凑 JSON、UTF-8 字节、不含结尾 \n
if measure ≤ lineBudgetBytes → 进入 VFSL 校验
else:
  if input.capture ∈ {full, redacted}:
      input ← { capture:'digest', digest, degraded:'projected-input-too-large' }
      health input-degraded {operation, fromPolicy}
      if measure ≤ lineBudgetBytes → 进入 VFSL 校验
  丢弃整条 record + health record-dropped {reason:'line-budget-exceeded', projectedRecordBytes, operation}
```

顺序逐字落实 ADR 0012 §投影：「输入导致超限时先降级为 digest；去掉输入后 record 仍超限则丢弃整条 record并通过健康面上报，不影响业务」。内存 adapter 无 sidecar，≳780 KiB 的 update（Base64 后超预算）必然走丢弃分支——这是 ADR 字面顺序在无 sidecar 环境的诚实后果（§10-J9 备案，测试覆盖）；update 本身超过 `payloadMaxBytes`（64 MiB）在更早的步骤 2 已转 update-omitted，不与本分支竞争。

---

## §6 issue 与可变字段投影算法

### 6.1 确定性截断原语（JSON 字面量字节预算 + code point 完整）

**预算基准（R2/E-c2 钉死）**：一切「UTF-8 bytes」预算（message 4 KiB、string 段 1 KiB、issue code 256B）按 **JSON 字符串字面量内容字节**计——`jsonLiteralBytes(s) = Buffer.byteLength(JSON.stringify(s)) - 2`（去掉两侧引号）。理由：受限资源本质是 JSONL line 的字节——ADR 0012「最终 JSONL line 默认硬上限 1 MiB」与「资源限制统一按 UTF-8 bytes 计算」的交集是**序列化后**的 UTF-8 字节。该基准下：lone surrogate 计 **6B**（well-formed JSON 转义 `\udXXX`）而非替换语义的 3B；`"`/`\` 计 2B；控制字符计 2B（`\b\t\n\f\r` 短转义）或 6B（`\u00xx`）；合法 astral 字符计 4B（UTF-8 原样）——与 `measure()`（§5.5）所量字节严格同基，消除「4095B（替换语义）不截断、序列化后 8190B」的二义。

```ts
const TRUNCATION_MARKER = '…[truncated]'   // JSON 字面量字节 = 14B（R4/C-4 勘误：…=3B + [truncated]=11B=14B；R1 原文「13B（[truncated]=10B）」系算术错误，SA2 R2.3-n1 曾标 cosmetic，SA4 C-4 实测 '…'×2048 在 2B 特例记账下穿透 4KiB 子预算 50% 后裁决改回精确基准；预算预留必须按 14B）

/** 单个 code point 在 JSON 字面量中的字节数（与 JSON.stringify 转义规则一一对应） */
function jsonLiteralCpBytes(cp: number): number {
  if (cp === 0x22 || cp === 0x5c) return 2                                    // \" \\
  if (cp === 0x08 || cp === 0x09 || cp === 0x0a || cp === 0x0c || cp === 0x0d) return 2  // \b\t\n\f\r
  if (cp < 0x20) return 6                                                     // \u00xx
  if (cp >= 0xd800 && cp <= 0xdfff) return 6                                  // lone surrogate → \udXXX
  if (cp < 0x80) return 1
  if (cp < 0x800) return 2
  if (cp < 0x10000) return 3
  return 4                                                                    // astral（合法代理对，UTF-8 原样）
}

function truncateUtf8(s: string, budgetBytes: number): string {
  // R2/E-c1：入口 loud 断言——budget < marker 字节数（14B，R4/C-4 勘误后）属内部不变量违反（正常不可达：
  // v1 全部调用点为冻结常量 4096/1024/256 ≥ 13）。throw 经 emit 顶层 catch 收编为
  // pipeline-crashed（内部 bug 信号），绝不静默产出超预算输出。
  if (budgetBytes < jsonLiteralBytes(TRUNCATION_MARKER)) throw new TruncationBudgetBelowMarker()
  if (jsonLiteralBytes(s) <= budgetBytes) return s
  const target = budgetBytes - jsonLiteralBytes(TRUNCATION_MARKER)
  let bytes = 0, cut = 0
  for (let i = 0; i < s.length; ) {          // 按 code point 前缀扫描（代理对不拆分）
    const cp = s.codePointAt(i)!
    const cpBytes = jsonLiteralCpBytes(cp)
    if (bytes + cpBytes > target) break
    bytes += cpBytes; i += cp > 0xffff ? 2 : 1; cut = i
  }
  return s.slice(0, cut) + TRUNCATION_MARKER  // marker JSON 字面量 14B（R4/C-4），总输出 ≤ budget
}
```

确定性来源：预算基准固定（JSON 字面量字节）、扫描顺序固定（前缀序）、code point 对齐固定。「截断不得拆分 Unicode code point」（ADR 0012 §投影）由逐 code point 累计保证；`…`（U+2026）本身是完整 code point。KAT（§9.4）：lone surrogate 计 6B、`\n`/`"` 计 2B、astral 计 4B；1365 个 lone surrogate（字面量 8190B）> 4096 → 截断且截断后序列化字节 ≤ 4096。

### 6.2 issues 投影（预算逐字对齐 ADR 0012）

```text
projectIssues(raw, policy):
  valid = raw 中满足下列条件的条目（R2/C-b1：有效性判定升级为段级 JSON-safe）：
    - 形状：{ code?: string, message: string, path: Array }（缺 message / path 非数组 → 整条丢弃）
    - path 逐段判定：typeof seg === 'string'
                     ∨ (typeof seg === 'number' ∧ Number.isFinite(seg))
      含非法段（NaN/±Infinity/undefined——稀疏数组 hole 读出 undefined 同判）的条目**整条丢弃**：
      NaN 段经 JSON.stringify 变 null、VFSL 拒 null 段，strict reader 必拒 →
      writer 不得产出自己读不回的行（§9.8 round-trip 不变量由此前提成立）
    - number 段 -0 归一为 +0（Object.is(seg,-0) ? 0 : seg——段级廉价，内存对象与 JSON 视图逐字段一致）
    （以上任一丢弃 → enrichment-field-dropped/issues 一次性上报）
  originalCount = valid.length          // 只计有效条目（§4.2）
  items = valid 前 1000 条，每条：
    code     : policy=redacted ? 保留（稳定码低敏） : code 截断至 256 字节（truncateUtf8，judgement §10-J8）
    message  : policy=redacted ? "«redacted»" : truncateUtf8(message, 4096)
    path     : 前 256 段；string 段 truncateUtf8(seg, 1024)；number 段（有限、已归一 -0）原样
  truncated = (valid.length > 1000) or 任一条目发生 message/path/code 截断 or 有畸形条目被丢弃（R4/C-3：畸形丢弃同样使投影有损，truncated 与 originalCount 必须同现同缺——presence 不变式恢复为「截断或有损丢弃 ⇔ 两键同时出现」，与 §3.3 冻结 schema JSDoc 的成对 presence 口径一致；originalCount 只计有效条目）
  return { policy, items, ...(truncated ? { truncated: true, originalCount } : {}) }
```

预算常量逐字来源（ADR 0012 §投影）：「每条 message 最大 4 KiB UTF-8，path 最多 256 个 segment，string segment 最大 1 KiB UTF-8，issues 最多 1000 条；超限时确定性截断并记录 truncated 与 originalCount。资源限制统一按 UTF-8 bytes 计算，截断不得拆分 Unicode code point」。预算字节基准 = JSON 字面量内容字节（§6.1，R2/E-c2）——「4 KiB UTF-8」按该值在 JSONL line 中实际占据的 UTF-8 字节解释。`truncated`/`originalCount` 为 presence 语义（VFSL `?` 可选字段；presence ⇔ 截断发生），与 ADR「超限时…记录」的时态一致。

### 6.3 其余可变尺寸字段的界

| 字段 | 界 | 机制 |
|---|---|---|
| issue.code | 256 B | 投影截断（schema plain string，§10-J8） |
| context.correlationId / runtimeGeneration / replicationId | ≤256 字符无换行 | Pattern（违规丢字段，enrichment 清洗） |
| source.remoteInstanceId | ≤256 字符无换行 | Pattern（结构性，违规丢 emission——来源身份不可诚实降级） |
| attemptId | ≤256 字符无换行 | Pattern（结构性，违规丢 emission） |
| 顶层 code/sourcePhase/reason | StableCode | Pattern（结构性；reason 由 emitter 自有词表构造，天然合规） |
| update base64 / input.value / issues 总量 | line 预算兜底 | §5.5 |

---

## §7 有界内存 adapter 契约

### 7.1 语义（逐条对齐验收标准 5 与 ADR 0012 §Writer）

- **容量**：`capacity` 条（默认 1024，judgement §10-J5）。每条 record 已过 line 预算（≤ lineBudgetBytes，默认 1 MiB）→ 实例最坏驻留 ≈ capacity × lineBudgetBytes；README 与 AGENTS.md 写明该上界与调参建议。
- **drop newest**：队列满时**丢弃新到者**，已接纳 record 及其顺序不变（「writer queue 满时 drop newest，保留已排队顺序」）。drop 只走 health + stats 计数，**绝不**作为 record 入队（「不得为了记录 drop 再挤占同一队列」）。
- **保序**：接纳序 = sequence 升序；`records()` 返回冻结引用数组，按接纳序。
- **永不 throw / 永不阻塞**：`append` 全同步、纯内存、O(record) CPU（Base64/CRC/序列化/校验均以 line 预算为上界）、整体 try/catch 兜底；无 IO、无 await、无锁。
- **失败模式**：构造时 schema 编译失败 → failed 模式（§4.2）；正常 append 路径的各类丢弃见 §4.2 表。
- **顺序保证边界**：单 emitter 实例内 FIFO。多 emitter 共享一个 adapter 实例 = 单队列交错但 sequence 仍全序（「内部每个 stream 同时最多一个逻辑 writer queue」的单写者模型）；跨 adapter 实例无全局序（ADR 0011：「每个 emitter 可分配本地单调 emitterSequence…不表示集群全局事务顺序」）。

### 7.2 读面（测试与工具）

```ts
export interface DiagnosticMemoryStats {
  streamId: string
  capacity: number
  queueDepth: number
  accepted: number
  droppedTotal: number
  droppedByReason: Readonly<Record<string, number>>                  // reason → count
  droppedByOperationReason: Readonly<Record<string, number>>        // `${operation}:${reason}` → count
  lastSequenceAssigned: string | null   // R2/A-c1：十进制字符串（uint64 全域无 number 失真）；gap 诊断：与 queueDepth 差 = 丢弃数
}
```

读面属「日志存储/工具模块的 interface」（ADR 0011 §Interface：「完整查询、导出、重放、保留与健康检查属于日志存储/工具模块的 interface，不扩张 NamespaceRuntime…」）——不进 Runtime/Registry 公共面。retention/删除（#154）与 replay（#155）本票不做；`records()` 是快照式只读，不承诺 lease。

### 7.3 CRC32C（inline carrier 必需，纯 TS）

参数逐字取 ADR 0012 §Binary frame v1（poly 0x1EDC6F41 / init 0xFFFFFFFF / refin true / refout true / xorout 0xFFFFFFFF），表驱动实现（256 项反射表，构造期生成），KAT 断言 `check("123456789") === 0xE3069283`（ADR 给出的检验值即现成 KAT）。输出写 8 位小写 hex（`P_CRC32C_HEX`）。文件 adapter 的 frame header 复用同一实现（#152 不改）；**注意**：本票只算 CRC 值本身，不构造 25-byte frame header（那是 #152）。

### 7.4 update 物理化（内存路径恒 inline）

```text
physicalize(result, updateCapture, payloadMaxBytes):   // result = 语义 record 的 SemanticResult
  result 不含 owned bytes（noop / rejected / fatal+false / effect:'unknown'
    / producer 已声明 update-omitted） → 原样保留（producer 语义不重写）
  result 携带 updateBytes:
    bytes.length === 0        → { …, effect:'update-omitted', reason:'empty-update' }
                               // R2/D-c1 前置守卫：0 字节 Base64 为空串、不匹配 P_BASE64
                               //（尾部组强制非空）；不设此分支会把 producer 输入缺陷误标为
                               // vfsl-validation-failed 的 writer bug 信号（ADR 0012 语义污染）
    !updateCapture            → { …, effect:'update-omitted', reason:'update-capture-disabled' }
    bytes.length > payloadMaxBytes
                               → { …, effect:'update-omitted', reason:'payload-too-large' }
    否则                       → { …, effect:'update', update: {
        storage:'inline', format:'yjs-update-v1',
        payloadLength: bytes.length,
        crc32c: hex8(crc32c(bytes)),
        base64: Buffer.from(bytes).toString('base64')   // RFC 4648 恒带 padding
      } }
```

不生成 sidecar 形状（内存无 .bin）；sidecar 形状的**可表达性**由 schema 冻结保证并由测试用手工构造 record 验证（§9.10）——这正是「本票冻结的 schema 不加修改即可服务 #152」的验收方式。

---

## §8 健康 observability 接缝

### 8.1 observer 接口与事件词表（冻结）

```ts
export interface DiagnosticLogHealthObserver {
  onEvent(event: DiagnosticLogHealthEvent): void   // 同步；可能 throw——必须被隔离（§8.3）
}

export type DiagnosticLogHealthEvent =
  | { type: 'emission-dropped'; reason: 'emission-shape'; operation?: Operation }
  | { type: 'pipeline-crashed'; stage: 'emitter' | 'adapter'; operation?: Operation }
  | { type: 'input-projection-failed'; operation: Operation }
  | { type: 'enrichment-field-dropped'; field: 'context.correlationId' | 'context.runtimeGeneration'
      | 'context.replicationId' | 'context.replicationEpoch' | 'code' | 'sourcePhase'
      | 'sourceModule' | 'durationMs' | 'issues'; operation: Operation }
  | { type: 'input-degraded'; operation: Operation; fromPolicy: 'full' | 'redacted' }
  | { type: 'record-dropped'; reason: 'line-budget-exceeded' | 'queue-full'
      operation?: Operation; projectedRecordBytes: number; queueDepth: number }   // R4/C-5：genesis-baseline record 无 operation 字段（形状事实），注入直通/未来 #152 genesis 路径下该位缺省
  | { type: 'vfsl-validation-failed'; recordKind: 'attempt' | 'genesis-baseline'
      operation?: Operation; issuePaths: string[]                                 // R4/C-5：同上
      projectedRecordBytes: number
      schemaId: typeof RECORD_SCHEMA_ID; schemaFingerprint: string }
  | { type: 'schema-compile-failed'; schemaId: typeof RECORD_SCHEMA_ID; issueCount: number }
```

注意：failed 模式（构造期 schema 编译失败）只发**一次** `schema-compile-failed`，后续 append 丢弃仅进 stats 计数、不逐条发 `record-dropped`（§4.1 步骤 0′）——故 `record-dropped` 的 reason 词表只有两值。

**R2/A-c1 备案（exhausted reason 的词表演进）**：ADR 0012 明文「达到 uint64 最大值后 stream 进入 exhausted，后续日志 emission 丢弃并上报，业务不受影响」。内存 adapter 达 `18446744073709551615` 后进入 exhausted 模式（后续 append 丢弃 + stats 计数；事件抑制策略与 failed 模式一致，不逐条发事件——防 10¹⁹ 级洪泛）。v1 冻结的 `record-dropped.reason` 词表（两值）**不含** exhausted 位：`sequence-exhausted` reason 由 #152 文件路径实际落地耗尽语义时以**联合成员追加**方式引入（TS 事件类型只增不改；VFSL schema 不受影响——sequence Pattern 已覆盖 uint64 全域；与 §10-J13 互为备案）。

### 8.2 低基数字段白名单（逐项对齐 ADR 0012 §VFSL record schema）

observer 事件只允许出现：

| 允许字段 | 来源依据 | 基数 |
|---|---|---|
| `type`/`reason`/`stage`/`field`/`fromPolicy`/`recordKind` | 「稳定 code」 | 固定词表（≤10 值） |
| `operation` | 「operation」 | 6 |
| `schemaId`/`schemaFingerprint` | 「schema id/fingerprint」 | 1（随构建冻结） |
| `issuePaths` | 「VFSL issue codes/paths」 | schema 形状有界（首 10 条，`$.a.b[0]` 形式拼接，无值预览） |
| `projectedRecordBytes`/`queueDepth`/`issueCount` | 「projected record byte size」（数值是值不是 label） | 数值 |

**禁入**（ADR 逐项）：原 record、input、Base64、update bytes、底层 message、Error/cause、stack。落地机制：`ValidateIssue.message` 在进事件前**整体丢弃**（只留 path）——validate.ts 的 message 含 40 字符值预览（`packages/vfsl/src/validate.ts:27`），属「原 record」衍生物。事件对象构造后深冻结。`streamId`/`namespaceId` 不进事件（ADR 0011 §数据保护：「日志字段不得进入默认低基数 metrics label」；namespace↔stream 关联由部署侧 metrics 外部维度承担）。

### 8.3 observer 故障隔离

```ts
function safeNotify(observer, event): void {
  try { observer.onEvent(event) } catch (err) {
    // 不重入 observer、不 throw、不计数入同一 observer
    fallbackLog(`DIAGNOSTIC_LOG_OBSERVER_FAILED observer_threw=${typeof err}`)  // 默认 console.error；可注入替换
  }
}
```

- observer throw → 单行稳定码 fallback 日志（低基数 logger，验收标准 4 的「observer 故障只经低基数 logger…上报」）；事件不重放、不排队。
- fallback logger 可注入（config `fallbackLog?: (line: string) => void`，默认 `console.error`）；自身 throw 视为部署错误，再包一层空 catch（最后防线，静默——此处无更外层通道，注释写明）。
- 事件不写入日志队列本身（「同一 JSONL中不写递归 health record」的内存路径同构纪律）。

---

## §9 契约测试计划（`packages/namespace-diagnostic-log/test/`）

全部为红灯契约测试（vitest，`packages/*/test/**/*.test.ts` 被 root vitest include 覆盖；`*.test-d.ts` 走 typecheck）。命名与映射：

### 9.1 词表与全 result 分支（AC1）— `record-vocabulary.test.ts`
- 6 operation × 8 EmissionResult 变体的矩阵抽样（全 8 变体至少各一次、全 6 operation 至少各一次）emit → 全部被接纳，最终 record 的 `result` 形状逐字段断言（含 fatal 的 committed 布尔与 effect 相关性）。
- `rejected` / `fatal+committed:false` 变体构造的 record **无** `update` 键（schema 封闭性机器强制的回归锚）。
- dirty-notification 场景：`fatal+committed:true+effect:update+stage:'dirty-notification'` 可表达。

### 9.2 emission 不变量 — `emitter-isolation.test.ts`
- 敌意 emission（getter 抛出的对象、超深嵌套、Proxy snapshot）→ emit 不 throw、不阻塞、健康事件落桶、record 或 capture 降级符合 §4.2 表。
- producer 不变异断言：emit 后再变异已移交快照 → strict mode TypeError（所有权契约锚）。

### 9.3 输入捕获四策略 — `input-capture.test.ts`
- 决策表全格（§5.1）：none/digest/redacted/full × 4 种可得性 = 16 组合的 `input.capture` 断言。
- digest KAT：RFC 8785 向量子集（键序/数字/转义）+ SHA-256 标准向量；lone surrogate 快照的确定性 digest。
- redacted 算法：叶值→`«redacted»`、null 保留、结构保形；>1M 节点护栏 → unavailable + 事件。
- 快照契约违反（含 symbol/bigint/非有限数的对象）→ unavailable + `input-projection-failed`，不重读（对同一 getter 只计一次触达的探针断言）。

### 9.4 issues 投影边界 — `issues-projection.test.ts`
- message 恰 4096B / 4097B / 多字节字符骑界（4095B + 3B 字符 → 截在字符前）；path 257 段（保前 256）；string 段 1025B；1001 条 issues；`truncated`/`originalCount` presence 语义；redacted 策略 message→`«redacted»`、code/path 保留；none 策略空 items；畸形条目丢弃且 originalCount 只计有效。
- **R2/C-b1 段级 JSON-safe**：`path:[0, NaN, 'x']` 与 `path:[1, Infinity]` → 整条丢弃、originalCount 只计有效、`enrichment-field-dropped/issues` 事件、items 不含该条；`path:[-0]` → 投影归一为 `0`（内存对象即 `0`，非 `-0`）；稀疏数组 `path`（`[,1]`，hole 读出 undefined）→ 整条丢弃。
- **R2/E-c2 预算基准 KAT（JSON 字面量字节）**：lone surrogate 计 6B（1365 个 lone surrogate 的 message 字面量 8190B > 4096 → 被截断，截断后序列化字节 ≤ 4096）；`\n`/`"` 计 2B、astral 计 4B 的逐单位断言。
- **R2/E-c1 小预算红灯**：`truncateUtf8(s, 12)`（< marker 14B，R4/C-4 勘误后）→ loud throw（`TruncationBudgetBelowMarker`）；并断言全部生产调用点常量（4096/1024/256）≥ 14B。

### 9.5 line 预算与降级 — `line-budget.test.ts`
- full 输入超预算 → record 仍被接纳、`input` 变 digest+degraded、`input-degraded` 事件、value 不在 record。
- 配置小 lineBudgetBytes 使 digest-only record 仍超限 → 丢弃 + `record-dropped/line-budget-exceeded`（含 projectedRecordBytes）+ 队列无此 record + 下一接纳 record 的 sequence 出现诚实 gap。
- update Base64 单独超预算（中预算 + 较大 update）→ 丢弃路径（§10-J9 锚）。

### 9.6 VFSL 校验失败注入（AC4）— `vfsl-gate.test.ts`（经 `testing` 子路径的 final-record 直通接缝）
- 手工构造违规最终 record 逐类喂入 adapter 的 VFSL+入队阶段：坏 streamId、词表外 operation/stage、rejected 带 update、多余顶层键、坏 Base64 形状、坏 CRC hex、坏 ISO、InputCapture 缺 digest——每类断言：丢弃、`vfsl-validation-failed` 事件只含 issuePaths（无 message）、不 throw。
- 冻结 schema 自身：`getRecordSchemaCompilation()` ok、`envelopeFingerprint` === 钉死常量、`RECORD_SCHEMA_ENVELOPE` 恰四键。
- sidecar 形状表达性：手工 sidecar carrier record 通过校验（#152 前置验收，§7.4）。
- **R2/F-c1 failed 模式注入**：testing 工厂注入坏 envelope（如 `text` 写非 map 形 ROOT）→ 构造期恰一次 `schema-compile-failed` 事件 + 后续 append 全丢弃 + **无**逐条 `record-dropped` + stats 对账（droppedByReason 计数）。

### 9.7 内存 adapter 语义（AC5）— `memory-adapter.test.ts`
- capacity=N，N+3 条 emission：前 N 条按序在 `records()`，3 条 drop newest + `record-dropped/queue-full` + stats 对账（droppedByReason / droppedByOperationReason / lastSequenceAssigned 与 queueDepth 差）。
- 顺序保持：交错不同 operation 的 emission，接纳序 == sequence 升序。
- `records()` 返回冻结对象（变异抛 TypeError）。

### 9.8 指纹与冻结纪律 — `schema-freeze.test.ts`
- `envelopeFingerprint` 与源内钉死常量相等（变更 = 有意识 bump + 本测试同步修改）。
- 9.1 全部 record 复跑 `validateLogicalSnapshot`（外部一致性）。
- **R2/C-b1 JSON round-trip 孪生不变量（通用断言，导出为测试 helper 供全部 suite 复用）**：对每个被接纳 record 断言 `validateLogicalSnapshot(derived, JSON.parse(JSON.stringify(record)))` ok——一次性防住所有「对象合法、字节非法」类分叉（NaN/±Infinity/undefined/hole/-0），与 §2.5「内存 JSON 与文件 JSONL 记录逐字段同构」承诺互为锚。

### 9.9 update 物理化 — `update-carrier.test.ts`
- CRC32C KAT（`"123456789"` → `0xE3069283`，ADR 逐字）+ 若干增量向量；inline carrier 字段断言（payloadLength=bytes.length、Base64 可解码 round-trip、crc 一致）。
- `payload-too-large`（超 payloadMaxBytes）/`update-capture-disabled`（默认配置）/`empty-update`（0 字节 bytes，R2/D-c1）三 reason 的 update-omitted 保 attempt metadata；`empty-update` 断言**无** `vfsl-validation-failed` 事件。

### 9.10 身份与 helper — `identity.test.ts`
- attemptId 缺省（注入确定性 RandomSource 断言 `att-`+32hex）/透传；streamId 构造期生成与稳定；`observedAtFrom` 与 P_ISO_MS 匹配。
- **R2/A-c1 sequence 生成纪律**：`nextDecimal` 进位直测（`"9"→"10"`、`"99"→"100"`、`"…51614"→"…51615"` 长进位链）；testing 子路径预置 lastSequence 至 `"18446744073709551614"` → 一次 append 得 `"18446744073709551615"`，再 append → exhausted 模式（丢弃 + stats 计数 + 无逐条事件 + 不 throw）；全程 `stats().lastSequenceAssigned` 为 string（无 number 失真）。
- `*.test-d.ts`：TS 字面量相关性（`fatal committed:false` 不得携带 effect 的编译期拒绝）、excess property 检查。
- **R2/F-c2 物理键黑名单（AC1 编译期锚）**：`expectTypeOf<NamespaceDiagnosticChangeEmission>()` 与 `expectTypeOf<EmissionResult>()` 的键集合 ∩ `{ base64, segment, frameOffset, crc32c, payloadLength, storage, retention }` = ∅——producer 面永不出现 JSONL/Base64/segment/frame/offset/retention 细节。

### 9.11 observer 隔离（AC4/AC5）— `observer-isolation.test.ts`
- observer 每事件必 throw → emit 不 throw、record 照常入队、fallbackLog 收到稳定码行；fallbackLog 自身 throw → 仍不外抛。

---

## §10 风险与遗留（judgement calls 清单）

| # | 决策 | 性质 | 风险与缓解 |
|---|---|---|---|
| J1 | `recordKind` 判别字段 + `GenesisBaselineRecord` 第二族 record | 判断（ADR 0012 要求基线记录但未给形状；§11-G2） | 若 #152 评审否决此形状 → 必须 bump schema 版本重建 generation（冻结纪律本身是安全网）；提前在 #152 勘察时复核。**R2/D-c2 备案：genesis record 在 v1 冻结的 emission/sink 公共面无构造路径**（`DiagnosticSemanticRecord` 是纯 attempt 形状）——这是设计事实而非缺陷：#152 需为 genesis 增设 adapter 内部构造路径（直通 storage projection 阶段），**不需要**改 schema、也不需要动 emission 面；§1.3 注释已修正为「attempt 记录路径复用同一管线」 |
| J2 | fatal `committed:boolean` 与 effect 的相关性不被 VFSL 机器锁死 | 受限（v1-spec §2 注记 8 无布尔字面量） | 三重强制：TS 字面量类型（编译期）+ emitter 唯一构造点 + 9.1 契约测试；schema 只放松不收紧（不会拒绝合法 record） |
| J3 | `code` 与 `sourceModule` 成对性（VFSL 无法表达跨字段依赖） | 判断 | 同 J2 的三重强制；§9.1 覆盖 |
| J4 | redacted 算法 = 叶值→`«redacted»`、null 保留 | 判断（ADR 未定义脱敏规则） | 保守默认（结构+digest 保留）；schema `value:unknown` 允许未来算法演化而不改 schema |
| J5 | 容量默认 1024 条（最坏 ≈ capacity×lineBudgetBytes 驻留） | 判断 | 配置可调；README 写明上界公式；不承诺字节级淘汰（retention 属 #154） |
| J6 | issuesPolicy 默认 'full' | 判断（ADR 只规定 input 默认 digest 或更保守） | issues 是诊断核心价值；脱敏环境显式配置 redacted；与 input 默认 digest 形成保守组合 |
| J7 | full/redacted 也携带 digest | 判断（额外 CPU O(snapshot)） | 跨策略可比对收益 > 成本；full 本就是 Host 显式启用 |
| J8 | issues[].code 为 plain string + 256B 截断（顶层 code 则 Pattern） | 依 ADR TS 快照（`code?: string`）+ 判断 | 截断确定性；不让业务码形状杀死整条诊断记录 |
| J9 | 内存路径大 update（Base64 超行预算）按 ADR 字面丢弃整条 record | 依 ADR 0012 §投影字面顺序 | 后果已文档化 + 9.5 测试锚；#152 的 sidecar 天然免除该分支 |
| J10 | SHA-256 走 node:crypto（环境绑定面） | 判断（§5.2 四点论证） | 绑定收口在 digest.ts/carrier.ts；若未来需要浏览器宿主，替换为纯 TS 实现不改变任何契约（digest 值不变） |
| J11 | 序列 Pattern 允许 "0"、内存从 1 起 | 判断（给 #152 起点自由度） | 两 adapter 兼容；无前导零语义不受影响 |
| J12 | enrichment 字段级违规丢字段而非丢 record；结构性违规丢 emission | 判断（「保住诊断事实」 vs 「loud」的权衡） | 两类路径都有 health 事件与测试；producer bug 可观测 |
| J13 | 内存 adapter 在 uint64 max 进入 exhausted 模式；v1 冻结事件词表不含 exhausted reason | 依 ADR 0012 §JSONL record（耗尽语义明文）+ 判断（词表演进时点归 #152） | 物理不可达（需 ~10¹⁹ 次 append）；sequence 以十进制字符串进位生成、无 number 失真（§4.3）；`sequence-exhausted` reason 由 #152 以联合成员追加方式引入（§8.1 备案），TS 事件类型只增不改、VFSL schema 不受影响 |

---

## §11 规格冲突/缺口与裁决建议

| # | 冲突/缺口 | 裁决（本设计采用） | 建议 |
|---|---|---|---|
| G1 | ADR 0012 §Inline 与 sidecar：规范句「inline 与 sidecar 均记录 payloadLength 与 CRC32C」，但同节 sidecar JSON 示例只含 storage/format/segment/frameOffset/payloadLength，无 crc32c | 规范句为准：两种 carrier 都带 `crc32c`（8 位小写 hex）；示例视为省略简写 | 建议后续 ADR 勘误补齐示例；#152 实现按本裁决 |
| G2 | ADR 0012 §Stream 与 generation 要求「每个新 stream 尽力先记录当前完整 Y.Doc 的 genesis baseline」，但 §JSONL record 只定义 attempt record（operation 封闭 6 值 + result 六形状），基线记录无家可归；replay 前提又依赖「有可用 genesis」 | schema 冻结为 `ROOT = AttemptRecord | GenesisBaselineRecord` 两族封闭联合，以顶层 `recordKind` 字面量判别；基线无 attemptId/operation/stage/result/input，诚实表达「非变更尝试」 | 请总控确认 #152/#153 接受该形状；若否，须先改 ADR 再动 schema（冻结纪律） |
| G3 | ADR 0011 结局词表含 `unknown`（缺可判定结局的诊断记录），ADR 0012 v1 只写最终 record、不写 attempt-started——存储层无处安放 `unknown` | 拼接结论：v1 存储不出现 `result:'unknown'`；进程中断的尝试以「记录缺失」表达（ADR 0012 明示该缺失属 best-effort 语义）；`effect:'unknown'` 仅在 fatal+committed:true 内表达 effect 不可知 | 与两 ADR 均自洽，无需修改；#155 replay 工具不得把缺失推断为任何结局（ADR 0011 原文） |
| G4 | ADR 0012 observer 白名单提「VFSL issue codes」，但 `validateLogicalSnapshot` 的 `ValidateIssue` 无 code 字段（`packages/vfsl/src/validate.ts:43-47` 只有 message+path，message 含值预览不可外泄） | 事件携带 `issuePaths`（首 10 条，无 message）；「codes」按不存在处理 | 若未来 ValidateIssue 增 code 字段（公共接缝变更），本包事件词表加同名字段即可（向后兼容） |
| G5 | ADR 0012 引用 CRC32C/RFC 8785 JCS/Base64 工具，仓内均无实现（勘察结论） | 本票落地：CRC32C 纯 TS（ADR KAT）、JCS 纯 TS（RFC 向量 KAT）、SHA-256 走 node:crypto、Base64 用 Buffer.toString('base64')（恒 padding） | 无冲突；#152 复用 CRC32C/JCS/Base64 同一实现，避免第二份 |
| G6 | attemptId 双来源（producer 受控 ID 形状无规格 / writer 生成 `att-`+32hex 有规格） | schema 取超集 `^.{1,256}$`（有界、无换行）；生成值是其子集 | producer 侧受控 ID 的形状约束留给 #149–#151 各自的接缝文档 |

---

## §12 文件清单（File Scope）

### ALLOW LIST

- `packages/namespace-diagnostic-log/**` — 新建包全套：`package.json`、`tsconfig.json`、`README.md`、`AGENTS.md`（Contract/Boundaries/Verification 三段式，含环境绑定面声明）、`src/index.ts`、`src/testing.ts`、`src/vocabulary.ts`、`src/emission.ts`、`src/record.ts`、`src/schema.ts`、`src/schema-patterns.ts`、`src/canonical-json.ts`、`src/digest.ts`、`src/crc32c.ts`、`src/carrier.ts`、`src/projection/input.ts`、`src/projection/issues.ts`、`src/pipeline.ts`、`src/sink.ts`、`src/adapters/memory.ts`、`src/health.ts`（文件名微调允许，目录与职责不变）
- `packages/namespace-diagnostic-log/test/*.test.ts`、`test/*.test-d.ts` — `[SA6 owned]` 契约红灯测试（§9 清单）
- `package.json`（仓库根） — 仅 `typecheck` script 追加一段 `tsc -p packages/namespace-diagnostic-log/tsconfig.json`（与既有逐包列举一致；1 行改动）
- `pnpm-lock.yaml` — **R2/G-b1 增补**：新包 importer 段差异（`pnpm install` 重新生成；除新增 `packages/namespace-diagnostic-log` importer 及其依赖解析外无其他改动）。依据：CI 使用 `pnpm install --frozen-lockfile`（`.github/workflows/ci.yml:33`），新包 `package.json` 一旦声明依赖（必然——至少 `@nomicore/vfsl`），缺此条目 install 步即 `ERR_PNPM_OUTDATED_LOCKFILE` 全线红；SA4 静态门禁核对 lockfile diff 仅含新包条目
- `CONTEXT.md`（仓库根） — 仅**新增**受控词条（「语义 emission（semantic emission）」「storage projection」「genesis baseline record」），不改既有词条；**R2/A-c2**：词条说明行同步收录 update-omitted 稳定 reason 词表（v1：`payload-too-large` / `update-capture-disabled` / `empty-update`）；若总控裁决不进本票，移出本清单
- `wiki/raw/task_diagnostic-log-v1-contract_design.md` — 本设计文档

### DENY LIST

- `packages/vfsl/**` — 引擎包稳定；本票只消费其公共接缝（compileSchemaEnvelope/validateLogicalSnapshot/matchPattern）
- `packages/namespace-runtime/**`、`packages/namespace-registry/**`、`packages/doc-runtime/**`、`packages/persistence/**` — 接线属 #149/#150/#151
- `packages/clock/**` — 本包不依赖（结构化 `now` helper 自带）
- `docs/adr/**`、`docs/vfsl/**` — 规格冻结源，任何冲突走 §11 裁决流程，不改原文
- `pnpm-workspace.yaml` — `packages/*` 通配已覆盖新包（已核实），无需改动
- `apps/**`、`domains/**` — 与本票无关

（SA6 拥有的测试文件一律不进 DENY LIST；SA3 仅可改测试基础设施，不改断言逻辑。）

---

## §13 协议假设依据 (Protocol Assumption Evidence)

本设计**无 HTTP/WS 端点、端口、跨进程生命周期类协议级假设**（纯进程内库设计）。存在以下运行时库行为假设，逐条给出仓内依据：

| 假设 | 依据类型 | 依据内容 | 风险等级 |
|---|---|---|---|
| `node:crypto.createHash('sha256')` 在 Node ≥20 可用且结果确定 | 源码先例 + 官方文档 | `packages/vfsl-codegen/src/header.ts:10` 已 `import { createHash } from 'node:crypto'` 于仓内运行路径；root `package.json` engines `node>=20` | 低 |
| `Buffer.from(bytes).toString('base64')` 输出 RFC 4648 padded 标准形（无空白/换行） | 源码先例 | `packages/vfsl/src/schema-check-cli.ts:57-59` 同款 Buffer 用法；Node 稳定 API 语义 | 低 |
| `TextEncoder` 为 Node ≥20 全局（JCS 文本 → UTF-8 字节） | 官方文档 | Node ≥11 全局；本仓 Node ≥20 | 低 |
| `new Date(ms).toISOString()` 恒输出 `YYYY-MM-DDTHH:MM:SS.sssZ`（毫秒 3 位） | 官方文档（ECMAScript Date.prototype.toISOString） | 与 P_ISO_MS 精确匹配；超域（\|ms\| > 8.64e15）throw 由 helper 在 producer 侧前置 | 低 |
| vfsl pattern 引擎支持 `(?:…)`、`\|`、`{m,n}`、字符类、`^$` 锚（Base64/ISO Pattern 可编译可判定） | 源码引用 | `packages/vfsl/src/pattern.ts:298-356`（分组/alternation/量词解析）、L98（10_000 指令上限）、L13-16（多项式完成） | 低（§9.6 冻结测试再验证） |
| `validateLogicalSnapshot` 对 `unknown` 标量恒接受 | 源码引用 | `packages/vfsl/src/validate.ts:322`（unknown 永不矛盾）、L458-460（恒 true） | 低 |

---

## §14 契约改动连锁审计 (Contract Change Caller Audit)

**无契约改动**：本设计只新建包与新增导出，不修改任何既有函数的签名、返回类型、throw 行为或时序。唯一触碰仓内既有文件的是根 `package.json` `typecheck` script 的追加式扩展（只增不改，无调用方语义影响）。

既有代码零 caller：`grep -rn "namespace-diagnostic-log" packages apps domains`（当前）为空——新包无历史调用方；#149/#150/#151 是未来接线方，届时依赖的 `NamespaceDiagnosticChangeEmitter` 接缝形状已由本设计 §2.6 冻结。

---

## 附：新包 README.md / AGENTS.md 骨架（实现期落地）

**AGENTS.md（三段式）**
- Contract：冻结 v1 record 契约（schema id/fingerprint 单源 `schema.ts`）；emit 同步、不 throw、不阻塞、所有权移交；四策略输入捕获只消费既有安全快照；line 预算先降级后丢弃；**update-omitted 稳定 reason 受控词表：v1 = `payload-too-large` / `update-capture-disabled` / `empty-update`（R2/A-c2）——新增 reason 属词表演进，须过设计评审并同步 CONTEXT.md**。
- Boundaries：storage projection 归 adapter（emitter 只做语义投影）；`node:crypto`/`Buffer` 仅出现于 `digest.ts`/`carrier.ts`（唯一环境绑定面）；不依赖 yjs/clock/registry；不改 ADR；VFSL 校验失败 = writer bug，丢弃 + 健康上报，永不外抛。
- Verification：`pnpm test`（vitest run --typecheck）覆盖 §9 全清单；改 `schema.ts` 任何字符必须同步 `schema-freeze.test.ts` 钉死指纹并视为 schema 版本变更。

**README.md**：公共 API 速览（§1.3）、配置表（§1.4）、容量/预算上界公式（§7.1）、best-effort 免责声明（ADR 0011 _Avoid_ 词条引用）。

---

## SA2 反馈逐条回应（R2 · 对 SA2 R1.1 评审报告 `task_diagnostic-log-v1-contract_sa2_review.md`）

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| G-b1（blocker）：ALLOW LIST 增补 `pnpm-lock.yaml` | ✅ 修 | §12 | 增补条目：仅新包 importer 段差异；引 CI `--frozen-lockfile` 依据（ci.yml:33）与 SA4 核对口径（lockfile diff 仅含新包条目） |
| C-b1（blocker）：issues 段级 JSON-safe + `-0`/稀疏数组 hole 注记 + JSON round-trip 孪生不变量 | ✅ 修 | §4.2（issues 投影行）、§5.2（jcs 数组分支逐槽检查 hole/undefined → SnapshotContractViolation）、§5.4（新增「序列化分叉纪律」：hole/unavailable、`-0` 的 digest 同基与视图差说明）、§6.2（段级判定 `string ∨ Number.isFinite(number)`，非法段整条丢弃；number 段 `-0→+0` 归一）、§9.4（NaN/±Infinity/-0/稀疏 path 红灯）、§9.8（round-trip 不变量升级为全 suite 通用 helper） | writer 不再产出自己读不回的行；「内存 JSON 与 JSONL 逐字段同构」承诺获得编译外机器锚 |
| D-c1：0 字节 updateBytes 前置守卫二选一写死 | ✅ 修（采纳方案 (a)） | §2.1（reason 词表 +`empty-update`，含 P_BASE64 空串不匹配论证）、§4.1 步骤 2、§4.2（update 物理化行）、§7.4（守卫分支置于最前）、§9.9（红灯：`empty-update` 保 metadata 且**无** `vfsl-validation-failed`） | producer 输入缺陷不再误标为 writer bug（ADR 0012「VFSL failure = writer bug」语义保持纯净） |
| D-c2：genesis 接缝备案 + §1.3 复用表述修正 | ✅ 修 | §10-J1（追加备案：v1 冻结 emission/sink 面无 genesis 构造路径；#152 增设 adapter 内部构造路径，不改 schema、不动 emission 面）、§1.3（注释修正为「attempt 记录路径复用同一管线」） | 设计事实显式化，防 #152 勘察按旧表述误判接缝已就绪 |
| A-c1：sequence 生成纪律 + exhausted 备案 | ✅ 修（采纳十进制字符串进位） | §4.1 步骤 1、§4.3（新增生成纪律段：字符串进位、无 number 失真、uint64 全域、exhausted 模式逐字对齐 ADR 0012）、§7.2（`lastSequenceAssigned: string \| null`）、§8.1（exhausted reason 备案段）、§10-J13（新增备案行）、§9.10（进位直测 + 预置接缝驱动 exhausted 邻域 + stats 类型断言） | 消除 2^53 失真静默损坏；耗尽语义与事件词表演进方式双双成文 |
| E-c1：truncateUtf8 预算 < marker 字节数行为写死 | ✅ 修（采纳入口 loud 断言） | §6.1（`TruncationBudgetBelowMarker` 断言 + 经顶层 catch 收编为 pipeline-crashed 的注释）、§9.4（budget=12 throw 红灯 + 生产常量 ≥14B 断言） | 内部不变量违反不静默超预算 |
| E-c2：预算基准钉死 | ✅ 修（采纳 JSON 字面量字节） | §6.1（全文重写：`jsonLiteralBytes`/`jsonLiteralCpBytes`，lone surrogate 6B、`"`/`\`/短转义 2B、`\u00xx` 6B、astral 4B；与 §5.5 `measure()` 同基论证）、§6.2（基准引用句）、§9.4（逐单位 KAT + 1365-lone-surrogate 向量） | 「4 KiB」在两种表示下的二义消除，预算即 JSONL 行字节 |
| F-c1：failed 模式可注入（或明文降级备案） | ✅ 修（开缝，不降级） | §1.3（testing 子路径增补「带自定义 envelope 的工厂」——生产构造器内部函数化）、§9.6（红灯：坏 envelope → 构造期恰一次 `schema-compile-failed` + 后续全丢弃 + 无逐条 `record-dropped` + stats 对账） | 冻结公共面上的事件变体与抑制逻辑脱离零覆盖死代码状态 |
| F-c2：emission 物理键黑名单 type 锚 | ✅ 修 | §9.10（`expectTypeOf` 键集合 ∩ `{base64,segment,frameOffset,crc32c,payloadLength,storage,retention}` = ∅，Emission 与 EmissionResult 双锚） | AC1「不暴露 JSONL/Base64/segment/frame/offset/retention」获得编译期直接锚 |
| A-c2：自造 reason 入受控词表 | ✅ 修 | §2.1（3 值词表成文并逐值论证）、§12（CONTEXT.md 新增词条的说明行收录三 reason）、附录 AGENTS.md（Contract 段词表化 + 「新增 reason 属词表演进、须过设计评审并同步 CONTEXT.md」纪律） | `update-capture-disabled`/`empty-update` 不再游离于受控词汇之外 |

**驳回项**：无——十条反馈全部采纳落实。

**一致性自检（修订后全文过一遍矛盾模式）**：`empty-update` 在 §2.1/§4.1/§4.2/§7.4/§9.9 五处出现且语义一致（前置守卫 → update-omitted，不触发 vfsl-validation-failed）；`sequence` 生成纪律在 §4.1/§4.3/§7.2/§8.1/§9.10/§10-J13 六处一致（十进制字符串、无 number、exhausted 抑制）；预算基准在 §5.5（measure）/§6.1/§6.2/§9.4 四处同基（JSON 字面量字节）；「#152 复用管线」表述在 §1.3 与 §10-J1 同步收窄为 attempt 路径；round-trip 不变量（§9.8）与段级 JSON-safe（§6.2）、jcs 逐槽检查（§5.2）三处互为前提闭环，无死引用。
