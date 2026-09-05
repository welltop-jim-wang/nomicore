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
  /** #155（§4-D4/C1）：initStream 之后的槽内结局（#17 committed / #18 runtime-construction
   *  fatal）——每次调用以 namespaceId **数据**现场解析 ns-bound emitter（零共享可变
   *  路由状态——C1 竞态类别整体消灭）；resolver 缺席/违约 → 静默丢弃（D11/i1）。 */
  emitStreamOutcome(namespaceId: string, observedAt: string, e: CreateEmissionArgs): void;
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
  emitStreamOutcome: () => undefined,
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
      operation: 'namespace-create', // ADR 0011 v1 封闭 operation 词表
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

/**
 * #155（§4-D4/§4-D5/C1 共享原语）——非抛读取 seam `runtimeEmitterFor`（B1 同款形状门：
 * 构造期一次读取；非函数 / 敌意 getter throw → undefined——此后不再触碰该属性）。
 */
function readRuntimeEmitterResolver(
  diagnosticLog: NamespaceRegistryDiagnosticLog,
): ((namespaceId: string) => unknown) | undefined {
  try {
    const candidate = (diagnosticLog as { runtimeEmitterFor?: unknown }).runtimeEmitterFor;
    return typeof candidate === 'function' ? (candidate as (namespaceId: string) => unknown) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * #155 单次解析 + 形状门（非抛；每次调用独立 try——D11 隔离：解析 throw / 返回
 * undefined / 畸形形状（非 object / emit 非函数）→ undefined）。双消费方共用单一
 * 实现：`emitStreamOutcome`（create 槽数据键控路由）与 `createRuntimeDiagResolver`
 * （open/create/import 三处 RuntimeFactory 第三参）。
 */
function resolveEmitterOnce(
  resolver: ((namespaceId: string) => unknown) | undefined,
  namespaceId: string,
): NamespaceDiagnosticChangeEmitter | undefined {
  if (resolver === undefined) return undefined;
  try {
    const candidate = resolver(namespaceId);
    if (candidate == null || typeof candidate !== 'object' || typeof (candidate as { emit?: unknown }).emit !== 'function') {
      return undefined;
    }
    return candidate as NamespaceDiagnosticChangeEmitter;
  } catch {
    return undefined;
  }
}

/**
 * #155（§5.4）Runtime 诊断解析产物（结构形状与 `@nomicore/namespace-runtime/internal`
 * 的 `RuntimeForRegistryDiagnostic` 逐字段同构——本模块不 import internal subpath
 * （模块边界静态守卫：Registry 包内仅 registry.ts 可消费 internal），结构性等价
 * 使 registry.ts 的 `RuntimeFactory` 第三参直接消费本产物）。
 */
export interface RuntimeDiagResolved {
  readonly emitter: NamespaceDiagnosticChangeEmitter;
  readonly clock: () => number;
}

/**
 * #155（§5.4）Runtime 诊断解析器（非抛边界；registry.ts 构造期一次成型、三处
 * factory 调用点现场解析）：`diagnosticLog` 缺席/无 `runtimeEmitterFor` → 恒 undefined
 * 解析器（两参既有行为零漂移）；命中 → `{ emitter, clock: () => clock.now() }`
 * （emitter↔clock 成对——#149 §5.2：observedAt 唯一来源 = Registry 注入 Clock）。
 */
export function createRuntimeDiagResolver(
  diagnosticLog: NamespaceRegistryDiagnosticLog | undefined,
  clock: Clock,
): (namespaceId: string) => RuntimeDiagResolved | undefined {
  const resolver = diagnosticLog == null ? undefined : readRuntimeEmitterResolver(diagnosticLog);
  if (resolver === undefined) return () => undefined;
  return (namespaceId: string): RuntimeDiagResolved | undefined => {
    const emitter = resolveEmitterOnce(resolver, namespaceId);
    if (emitter === undefined) return undefined;
    return { emitter, clock: () => clock.now() };
  };
}

/**
 * CreateDiag 一次成型（构造栈内调用；diagnosticLog 缺席/畸形 → no-op 单例）。
 *
 * 【SA4 R1 B1 修订】seam 对象属性读取全部纳入**真非抛边界**：`emitter` 在构造栈内
 * 一次读取并做最小形状校验（非 null/object 且 `emit` 为 function）；null、敌意
 * getter（Proxy trap throw）、畸形对象（缺失/非函数 emit）一律收敛为「日志禁用」
 * （NOOP_DIAG）——此后 emit/initStream 不再读取 `diagnosticLog` 本体属性
 * （emit 侧只用构造期捕获的 emitter 引用），日志侧任何异常都不可能触达 create
 * 业务调用栈（SA6 AC4 隔离面在 seam 对象层的补全：create ok/duplicate resolve
 * 恒不受违约装配影响）。
 */
export function createCreateDiag(
  diagnosticLog: NamespaceRegistryDiagnosticLog | undefined,
  clock: Clock,
): CreateDiag {
  if (diagnosticLog == null) return NOOP_DIAG; // undefined/null 均 = 日志禁用（SA4 R1 B1：收紧为 == null）
  let emitter: NamespaceDiagnosticChangeEmitter | undefined;
  try {
    const candidate = (diagnosticLog as { emitter?: unknown }).emitter;
    if (
      candidate !== null &&
      typeof candidate === 'object' &&
      typeof (candidate as { emit?: unknown }).emit === 'function'
    ) {
      emitter = candidate as NamespaceDiagnosticChangeEmitter;
    }
  } catch {
    emitter = undefined;
  }
  if (emitter === undefined) return NOOP_DIAG;
  // #155（§4-D4/C1）：构造期一次非抛读取 runtimeEmitterFor（双消费方共享同一
  // resolveEmitterOnce 形状门/吞没边界——D11）。
  const streamResolver = readRuntimeEmitterResolver(diagnosticLog);
  return {
    // 槽内结局：observedAt 由调用方保证为槽内 Clock 步的 createdAt 字符串（零额外读数）
    emitOutcome: (observedAt, e) => {
      emitAttempt(emitter, observedAt, e);
    },
    // Clock 步之前终结：诊断侧读一次 clock；clock 故障 → 该条 emission 丢弃
    emitEarlyOutcome: (e) => {
      const observedAt = readEarlyObservedAt(clock);
      if (observedAt === undefined) return;
      emitAttempt(emitter, observedAt, e);
    },
    // #155（§4-D4/C1）：initStream 之后的槽内结局——每次调用以 namespaceId **数据**
    // 现场解析 ns-bound emitter（Map 键控查表；零共享可变路由状态——C1 竞态类别消灭）。
    // 路由三态（与 D4/§6.4 逐字一致）：
    //   1. seam 提供 runtimeEmitterFor 且本次解析命中 → ns-bound emitter（生产路径）；
    //   2. seam 提供 runtimeEmitterFor 但本次解析违约（throw/畸形/undefined）→ 静默
    //      丢弃（D11/i1 备案：生产供应方恒返回良构 emitter 或丢弃桩）；
    //   3. seam 未提供 runtimeEmitterFor（#150 时代 Host 形状）→ **legacy fallback**：
    //      退回构造期捕获的共享 emitter——与 #150 既有行为逐字节一致（#150 SA6 契约
    //      锚：共享 emitter 接收 #17/#18）。fallback 是 seam 的静态属性（无 resolver），
    //      不含任何跨续段可变路由状态——C1 论证不受影响（归因键仍是调用点静态分类 +
    //      namespaceId 数据；生产 Host 管理器恒提供 resolver ⇒ 生产恒走数据键控）。
    emitStreamOutcome: (namespaceId, observedAt, e) => {
      const resolved = resolveEmitterOnce(streamResolver, namespaceId);
      if (resolved !== undefined) {
        emitAttempt(resolved, observedAt, e);
        return;
      }
      if (streamResolver === undefined) {
        emitAttempt(emitter, observedAt, e);
        return;
      }
      /* resolver 在场但解析违约 → 静默丢弃（D11/i1） */
    },
    // stream 建立缝：Host 函数同步 throw = 违约 → 吞没隔离（AC4「stream init 失败
    // 不改 create 结果」的 Registry 侧义务）；LOG_STREAM_INIT_FAILED 等健康事件由
    // Host 侧 adapter 的 observer 自行产生，Registry 不代发、不伪造。属性读取
    // （`initStream` getter）与函数调用均在同一吞没 try 内（SA4 R1 B1）。
    initStream: (namespaceId, genesisUpdateBytes) => {
      try {
        const initStream = (diagnosticLog as {
          initStream?: (namespaceId: string, genesisUpdateBytes: Uint8Array | undefined) => void;
        }).initStream;
        initStream?.(namespaceId, genesisUpdateBytes);
      } catch {
        /* Host 违约（同步 throw / 敌意 getter）→ 吞没 */
      }
    },
  };
}
