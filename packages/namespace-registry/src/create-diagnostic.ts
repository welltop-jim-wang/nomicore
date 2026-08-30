/**
 * @nomicore/namespace-registry —— create 诊断日志接线模块（issue #150）：
 * CreateDiag 环境 / emission 组装 / 吞没防御 / issues 投影 / genesis bytes。
 *
 * 职责边界（SA1 设计 §6，对齐 #149 `namespace-runtime/src/diagnostic.ts` 先例）：
 * - producer 只做语义 emission（ADR-0011「Interface 与 seam」节）——operation 恒
 *   'namespace-create'、source 恒 {kind:'local'}，stage/code/sourcePhase/result/
 *   input/issues 全部摘自 Registry 既有业务流程事实（零发明）；物理投影
 *   （digest/base64/segment/stream 身份）全部留给 adapter。
 * - 防御义务（ADR-0011「Runtime/Registry/复制实现仍防御 adapter 违约」条款）：
 *   emitter 同步 throw、initStream 同步 throw、clock 故障、encode 失败、issues 畸形
 *   ——一律隔离吞没，绝不改变 create 返回值、Persistence 状态与 Registry 生命周期。
 * - observedAt 不变量（DC-3：每次 create 尝试恰一次 clock 读数用于时间戳）：槽内
 *   Clock 步已执行（快照成功后）→ 复用 createdAt 字符串（零额外读数——SA6 锚
 *   `clock.calls === 1`）；Clock 步之前终结 → 本助手读一次 clock；clock 故障 →
 *   该条 emission 丢弃（诚实缺席，绝不伪造时间戳）。
 * - issues 码派生单源（DC-4）：compile 类 code 派生与 P0 unavailable 摘要既有单源
 *   规则逐字对齐——`packages/namespace-runtime/src/p0.ts:134-148` `toIssueSummary`
 *   （envelope → `SCHEMA_ENVELOPE_${String(code)}` 不透明段透传、vfsl 文本 →
 *   `SCHEMA_TEXT_INVALID`；跨包不可值级 import `namespace-runtime/internal`
 *   ——其值导出恰 `createNamespaceRuntimeForRegistry` 一键，故按
 *   `schema-write.ts:315-317` 同源语义复制先例本地复刻并显式标注基准）。validate 类
 *   逐字段同形透传（零改写、零码派生）。
 *
 * 模块导出纪律（设计 §10/§12）：零导出到公共面（index.ts 不 re-export）；registry.ts
 * 经相对导入消费。
 */
import * as Y from 'yjs';
import type {
  DiagnosticIssue,
  EmissionInput,
  EmissionResult,
  NamespaceDiagnosticChangeEmitter,
  Stage,
} from '@nomicore/namespace-diagnostic-log';
import type { Clock } from '@nomicore/clock';
import { DocRuntimeFatalError } from '@nomicore/doc-runtime';
import type { NamespaceRegistryDiagnosticLog } from './types.js';

/** 诊断环境（构造栈一次成型）：diagnosticLog 缺席 = 全 no-op 单例。 */
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
   * 投影（→ DiagnosticIssue[]，含码派生）在 emitOutcome/emitEarlyOutcome 的吞没
   * try 边界内执行（SA2 R2-M2：畸形 issues 任何路径都不可改变业务结局）。
   * issuesKind 选择投影器：'compile'（vfsl SchemaParseIssue[]，码派生对齐
   * p0.toIssueSummary）| 'validate'（vfsl ValidateIssue[]，逐字段同形透传）。
   */
  readonly rawIssues?: readonly unknown[];
  readonly issuesKind?: 'compile' | 'validate';
  readonly input: EmissionInput;
}

/** 全 no-op 单例（diagnosticLog 缺席 = 日志禁用，行为与既有完全一致）。 */
const NOOP_DIAG: CreateDiag = Object.freeze({
  emitOutcome: () => undefined,
  emitEarlyOutcome: () => undefined,
  initStream: () => undefined,
});

/**
 * fatal 结果组装（对齐 #149 `diagnostic.ts:94-99` 同名先例）：committed:false 不带
 * effect（结构上事务未发生）；committed:true 且 bytes 有 → update / 无 → unknown
 * （诚实上报：提交了什么不可知——绝不编造无 bytes 的 update，SA2 R2-M3）。
 */
export function fatalFromBytes(committed: boolean, updateBytes: Uint8Array | undefined): EmissionResult {
  if (!committed) return { kind: 'fatal', committed: false };
  return updateBytes !== undefined
    ? { kind: 'fatal', committed: true, effect: 'update', updateBytes }
    : { kind: 'fatal', committed: true, effect: 'unknown' };
}

/**
 * create-document 段 fatal 结果组装（设计 §6.2 #12/#13）：seam internal fatal 保留
 * 原 committed 事实（committed:true 且无 owned bytes → 诚实 effect:'unknown'——
 * seam 失败不返回 doc，bytes 不可得）；未知异常按 pre-commit false。
 */
export function fatalFromCommitted(cause: unknown): EmissionResult {
  if (cause instanceof DocRuntimeFatalError && cause.committed === true) {
    return { kind: 'fatal', committed: true, effect: 'unknown' };
  }
  return { kind: 'fatal', committed: false };
}

/** genesis/update bytes 计算（doc 为 any-bridge；encode throw → undefined——诚实缺席）。 */
export function encodeDetachedState(doc: unknown): Uint8Array | undefined {
  try {
    // 全量 state；doc 已提交且无并发写（设计 §8.2 证明）。成功提交 ⟹ 可编码
    // （ADR-0006 #64：Persistence createDoc 内部已做过同款 encode 直写）。
    return Y.encodeStateAsUpdate(doc as never);
  } catch {
    return undefined; // 不可达防御 → bytes 诚实缺席
  }
}

/** early 结局的 observedAt：clock 故障（throw/非法 epoch）→ undefined（丢弃该条）。 */
function readEarlyObservedAt(clock: Clock): string | undefined {
  try {
    return new Date(clock.now()).toISOString();
  } catch {
    return undefined;
  }
}

/**
 * issues 投影（DC-4 展开；SA2 R2-M2 三层防御，只被 emitAttempt 在吞没 try 边界内调用）：
 * 1. 数组级——raw 非数组（或检查处 throw，如敌对 proxy）→ 空数组（调用方整组省略
 *    issues 字段，emission 照常发出）；
 * 2. 条目级——逐条形状检查（compile：kind 判别 + issue.message string + issue.code
 *    可 String 化；validate：message string + path 数组且段为 string/finite number），
 *    意外形状条目跳过该条；条目读取包在逐条 try/catch 内（敌意 getter throw 只废该条）；
 * 3. 整体级——任何逃逸 throw 由 emitAttempt 外层 try 收编 → 整条 emission 丢弃。
 */
function projectIssues(raw: readonly unknown[], kind: 'compile' | 'validate'): DiagnosticIssue[] {
  let items: readonly unknown[];
  try {
    if (!Array.isArray(raw)) return [];
    items = raw;
  } catch {
    return [];
  }
  const out: DiagnosticIssue[] = [];
  for (const item of items) {
    try {
      const projected = kind === 'compile' ? projectCompileIssue(item) : projectValidateIssue(item);
      if (projected !== undefined) out.push(projected);
    } catch {
      /* 条目级：意外形状/敌意 getter → 跳过该条，其余照常 */
    }
  }
  return out;
}

/**
 * compile 投影：SchemaParseIssue[] → DiagnosticIssue[]（顺序逐条保留；码派生与
 * p0.toIssueSummary 逐字同源，零新前缀——R2-M1）：
 *   {kind:'envelope', issue:{code, message, readOnly}} → {code:
 *     `SCHEMA_ENVELOPE_${String(issue.code)}`, message, path: []}（code 作不透明段
 *     透传，不假设数字串——p0.ts:136-138 注释冻结「ENV_TEST 读作
 *     SCHEMA_ENVELOPE_ENV_TEST」）；
 *   {kind:'vfsl', issue:{message, line, column}} → {code: 'SCHEMA_TEXT_INVALID',
 *     message, path: []}（line/column 无 DiagnosticIssue 词表位，不发明——message 已
 *     含 vfsl 冻结前缀）。
 */
function projectCompileIssue(item: unknown): DiagnosticIssue | undefined {
  if (item === null || typeof item !== 'object') return undefined;
  const rec = item as Record<string, unknown>;
  if (rec.kind === 'envelope') {
    const issue = rec.issue;
    if (issue === null || typeof issue !== 'object') return undefined;
    const issueRec = issue as Record<string, unknown>;
    if (typeof issueRec.message !== 'string') return undefined;
    if (issueRec.code === undefined || issueRec.code === null) return undefined;
    return { code: `SCHEMA_ENVELOPE_${String(issueRec.code)}`, message: issueRec.message, path: [] };
  }
  if (rec.kind === 'vfsl') {
    const issue = rec.issue;
    if (issue === null || typeof issue !== 'object') return undefined;
    const issueRec = issue as Record<string, unknown>;
    if (typeof issueRec.message !== 'string') return undefined;
    return { code: 'SCHEMA_TEXT_INVALID', message: issueRec.message, path: [] };
  }
  return undefined;
}

/** validate 投影：ValidateIssue[] → DiagnosticIssue[]（逐字段同形透传，零改写）。 */
function projectValidateIssue(item: unknown): DiagnosticIssue | undefined {
  if (item === null || typeof item !== 'object') return undefined;
  const rec = item as Record<string, unknown>;
  if (typeof rec.message !== 'string') return undefined;
  const path = rec.path;
  if (!Array.isArray(path)) return undefined;
  for (const segment of path) {
    if (typeof segment !== 'string') {
      if (typeof segment !== 'number' || !Number.isFinite(segment)) return undefined;
    }
  }
  return { message: rec.message, path: path as Array<string | number> };
}

/**
 * 语义 emission 共同内核（emitOutcome/emitEarlyOutcome 共用；两者只差 observedAt
 * 来源）。**吞没一切**（ADR-0011 producer 防御义务 + emit 接缝「不得阻塞、throw」
 * 语义）：emitter 同步 throw（AC4 锚）、issues 投影期任何异常一律隔离——绝不改变
 * 业务结果；emit 尝试恰一次，不重试。attemptId 省略 → emitter 管线 CSPRNG 生成
 * `att-`+32hex（pipeline.ts 既有）；durationMs/context 省略（无来源，不发明）。
 */
function emitAttempt(emitter: NamespaceDiagnosticChangeEmitter, observedAt: string, e: CreateEmissionArgs): void {
  try {
    // —— issues 投影在吞没 try 边界内执行（SA2 R2-M2）——
    const issues =
      e.rawIssues !== undefined && e.issuesKind !== undefined
        ? projectIssues(e.rawIssues, e.issuesKind)
        : undefined;
    emitter.emit({
      operation: 'namespace-create', // ADR-0012 v1 封闭词表
      stage: e.stage,
      observedAt, // 注入 Clock 同源 ISO（禁墙钟）
      source: { kind: 'local' }, // Registry 本地写路径
      ...(e.code !== undefined ? { code: e.code, sourceModule: 'registry' as const } : {}),
      ...(e.sourcePhase !== undefined ? { sourcePhase: e.sourcePhase } : {}),
      ...(issues !== undefined && issues.length > 0 ? { issues } : {}),
      input: e.input,
      result: e.result,
    });
  } catch {
    /* ADR-0011「Runtime/Registry/复制实现仍防御 adapter 违约」条款 + emit 接缝
       「不得阻塞、throw」语义：emitter 同步 throw（AC4 锚）、issues 投影期任何
       异常一律隔离——吞没，绝不改变业务结果；emit 尝试恰一次，不重试。 */
  }
}

/** CreateDiag 一次成型（构造栈内调用；diagnosticLog 缺席 → no-op 单例）。 */
export function createCreateDiag(
  diagnosticLog: NamespaceRegistryDiagnosticLog | undefined,
  clock: Clock,
): CreateDiag {
  if (diagnosticLog === undefined) return NOOP_DIAG;
  return {
    // 槽内结局：observedAt 由调用方保证为槽内 Clock 步的 createdAt 字符串（零额外读数）
    emitOutcome: (observedAt, e) => {
      emitAttempt(diagnosticLog.emitter, observedAt, e);
    },
    // Clock 步之前终结：诊断侧读一次 clock；clock 故障 → 该条 emission 丢弃
    emitEarlyOutcome: (e) => {
      const observedAt = readEarlyObservedAt(clock);
      if (observedAt === undefined) return;
      emitAttempt(diagnosticLog.emitter, observedAt, e);
    },
    // stream 建立缝：Host 函数同步 throw = 违约 → 吞没隔离（AC4「stream init 失败
    // 不改 create 结果」的 Registry 侧义务）；LOG_STREAM_INIT_FAILED 等健康事件由
    // Host 侧 adapter 的 observer 自行产生，Registry 不代发、不伪造。
    initStream: (namespaceId, genesisUpdateBytes) => {
      try {
        diagnosticLog.initStream?.(namespaceId, genesisUpdateBytes);
      } catch {
        /* Host 违约 → 吞没 */
      }
    },
  };
}
