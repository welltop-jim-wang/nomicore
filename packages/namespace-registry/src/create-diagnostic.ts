/**
 * @nomicore/namespace-registry —— create 诊断日志接线模块（issue #150/#155/#226/
 * #249）：CreateDiag 环境 / emission 组装 / 吞没防御 / issues 投影 / genesis bytes /
 * per-namespace 延迟投递泵（diag-pump）路由。
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
 * #226（创建诊断覆盖 + 生命周期隔离；SA1 design §3.2/§3.3）路由三态：
 * - seam 提供 `runtimeEmitterFor`（生产形状）→ **泵路径**：一切可能触碰存储的
 *   seam 调用（initStream 建流 / runtimeEmitterFor 解析 / ns-bound emit）入队
 *   per-namespace diag-pump，在 macrotask drain（业务槽外）执行；槽内/槽间窗口内
 *   残余 = O(1) 组装 + 入队。建流前早结局（8 点）以**候选 namespaceId 数据键控**
 *   投递（被拒 create 无后续 stream → 泵先 `initStream(ns, undefined)` genesis-less
 *   建流——ADR-0012 L22「genesis 未成功写入时 stream 仍可记录诊断事实」——再落
 *   结局记录）；`createRuntimeDiagResolver` 产物 emitter = 延迟 wrapper
 *   （emit = O(1) 入队）——open/create/import 三处 factory 第三参与 Runtime
 *   write-sequencer 槽间窗口的 emitSlot 同步存储同步出关键路径。
 * - seam 未提供 `runtimeEmitterFor`（#150 时代 Host 形状）→ **legacy 路径逐字节
 *   现行**（同步共享 emitter / initStream 同步调用）——#150 冻结契约零漂移面；
 *   #249 候选级结局在 legacy 为 no-op（D-1 裁决，见 `emitCandidateOutcome`）。
 * - 公共入口 acceptance/identity 拒绝（namespaceId 生成之前，无归属可用）→ 恒走
 *   同步共享通道（非缺陷 A 对象；SA1 §7.2）。
 *
 * #249（AC4 + 满队上报装配）：`CreateDiag.emitCandidateOutcome` 新方法（泵路径
 * 实现 + legacy/NOOP no-op）——entry collision / DOC_DUPLICATE 每个碰撞候选一条
 * rejected 记录（冻结词表零演进，设计 §6.3）；`CreateEmissionArgs` 增可选
 * `sourceModule`（缺省 'registry'——DOC_DUPLICATE 候选取 'persistence'，code↔
 * sourceModule 成对纪律）；泵构造接线 `reportDrop`（第三参 options.reportPumpDrop
 * ——满队丢弃逐条低基数上报，落点为 registry.ts 侧内部 observer seam）。
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
  NamespaceDiagnosticChangeEmission,
  SourceModule,
  Stage,
} from '@nomicore/namespace-diagnostic-log';
import type { Clock } from '@nomicore/clock';
import { DocRuntimeFatalError } from '@nomicore/doc-runtime';
import { createDiagPump, type DiagPump, type DiagPumpDeps, type DiagPumpDropReport } from './diag-pump.js';
import type { NamespaceRegistryDiagnosticLog } from './types.js';

/** 诊断环境（构造栈一次成型）：diagnosticLog 缺席 = 全 no-op 单例。 */
export interface CreateDiag {
  /** 槽内结局（observedAt 复用槽内 Clock 步的 createdAt 字符串——零额外读数）。
   *  #226：`namespaceId` = 本次 attempt 的候选 id（建流前早结局的归属键——槽内
   *  发射时点恒在手；公共入口无 id → 不调用本方法）。 */
  emitOutcome(namespaceId: string, observedAt: string, e: CreateEmissionArgs): void;
  /** Clock 步之前终结的结局（observedAt 由本助手读一次 clock；clock 故障 → 丢弃）。
   *  #226：`namespaceId` = 候选 id（槽内）；`undefined` = 公共入口 acceptance /
   *  identity 拒绝（id 生成前，无归属可用 → 恒同步共享通道）。 */
  emitEarlyOutcome(namespaceId: string | undefined, e: CreateEmissionArgs): void;
  /** #155（§4-D4/C1）：initStream 之后的槽内结局（#17 committed / #18 runtime-construction
   *  fatal）——每次调用以 namespaceId **数据**路由 ns-bound emitter（零共享可变
   *  路由状态——C1 竞态类别整体消灭）；#226：路由经泵延迟投递（drain 内解析
   *  emitter）；resolver 缺席/违约 → legacy 回退 / 静默丢弃（D11/i1）。 */
  emitStreamOutcome(namespaceId: string, observedAt: string, e: CreateEmissionArgs): void;
  /** stream 建立缝（committed 事实确立后调用；bytes 尽力供给）。 */
  initStream(namespaceId: string, genesisUpdateBytes: Uint8Array | undefined): void;
  /** #249（AC4）：候选级被拒结局（entry collision / DOC_DUPLICATE）——每个碰撞/
   *  duplicate 候选 = 一次独立 create 变更尝试（CONTEXT.md L148–150），以
   *  `rejected`（冻结词表内预期失败零提交——ADR-0012 L80–87）落到**候选 namespaceId
   *  的流**。observedAt 语义同 emitEarlyOutcome：复用槽内 Clock 步产物；`undefined`
   *  （entry collision 判定在 Clock 步之前）→ 本助手读一次 clock；clock 故障 → 该条
   *  丢弃（诚实缺席）。路由：仅 ns-bound（泵）路径发射——legacy（#150 共享 emitter
   *  形状）与日志禁用（NOOP_DIAG）为 no-op（design 裁决 D-1：legacy 无「namespace
   *  的诊断流」承载；#150 冻结契约「恰一条最终结局」零漂移）。归属 = 候选 id 的流
   *  （碰撞候选 id 即既有 namespace 的 id）；该 ns 无流时 genesis-less 补建一次。 */
  emitCandidateOutcome(namespaceId: string, observedAt: string | undefined, e: CreateEmissionArgs): void;
}

export interface CreateEmissionArgs {
  readonly stage: Stage;
  readonly result: EmissionResult;
  /** 与 sourceModule 成对（emitAttempt 单点保证）。 */
  readonly code?: string;
  readonly sourcePhase?: string;
  /** #249：稳定 code 的来源模块（ADR-0012 封闭 4 值）。缺省 'registry'——既有全部
   *  调用点零漂移（assembleEmission 原 hardcode）；DOC_DUPLICATE 候选记录取
   *  'persistence'（该码的所属模块——ADR-0011 L51「保留所属模块已有稳定 code」+
   *  ADR-0012 L89「code 与 sourcePhase…标注 source module」；emitter 管线强制
   *  code↔sourceModule 成对，单侧缺失即丢字段+健康事件——pipeline.ts §10-J3）。 */
  readonly sourceModule?: SourceModule;
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
  emitCandidateOutcome: () => undefined, // #249：日志禁用 = 零行为（含零 clock 读数）
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
 * issues 投影（DC-4 展开；SA2 R2-M2 三层防御，只在 assembleEmission 的吞没 try
 * 边界内调用）：
 * 1. 数组级——raw 非数组（或检查处 throw，如敌对 proxy）→ 空数组（调用方整组省略
 *    issues 字段，emission 照常发出）；
 * 2. 条目级——逐条形状检查（compile：kind 判别 + issue.message string + issue.code
 *    可 String 化；validate：message string + path 数组且段为 string/finite number），
 *    意外形状条目跳过该条；条目读取包在逐条 try/catch 内（敌意 getter throw 只废该条）；
 * 3. 整体级——任何逃逸 throw 由 assembleEmission 外层 try 收编 → 整条 emission 丢弃。
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
 * 语义 emission 组装（emitAttempt 与泵路径共用；载荷字段与 #150/#155 现状逐字节
 * 同位——#226 只改传输通道与时机，不改 record 内容面：AC5 内容锚逐字段维持）。
 * **吞没一切**（ADR-0011 producer 防御义务 + emit 接缝「不得阻塞、throw」语义）：
 * issues 投影期任何异常一律隔离——绝不改变业务结果；组装失败 → 该条 emission
 * 丢弃（诚实缺席；与既有 emitAttempt 吞没边界同语义）。attemptId 省略 → emitter
 * 管线 CSPRNG 生成 `att-`+32hex（pipeline.ts 既有）；durationMs/context 省略（无
 * 来源，不发明）。
 */
function assembleEmission(
  observedAt: string,
  e: CreateEmissionArgs,
): NamespaceDiagnosticChangeEmission | undefined {
  try {
    // —— issues 投影在吞没 try 边界内执行（SA2 R2-M2）——
    const issues =
      e.rawIssues !== undefined && e.issuesKind !== undefined
        ? projectIssues(e.rawIssues, e.issuesKind)
        : undefined;
    return {
      operation: 'namespace-create', // ADR 0011 v1 封闭 operation 词表
      stage: e.stage,
      observedAt, // 注入 Clock 同源 ISO（禁墙钟）
      source: { kind: 'local' }, // Registry 本地写路径
      ...(e.code !== undefined
        ? { code: e.code, sourceModule: e.sourceModule ?? ('registry' as const) }
        : {}), // code↔sourceModule 成对（#249：sourceModule 缺省 'registry'——既有零漂移）
      ...(e.sourcePhase !== undefined ? { sourcePhase: e.sourcePhase } : {}),
      ...(issues !== undefined && issues.length > 0 ? { issues } : {}),
      input: e.input,
      result: e.result,
    };
  } catch {
    /* ADR-0011「Runtime/Registry/复制实现仍防御 adapter 违约」条款 + emit 接缝
       「不得阻塞、throw」语义：issues 投影期任何异常一律隔离——吞没，绝不改变
       业务结果；组装尝试恰一次，不重试。 */
    return undefined;
  }
}

/**
 * legacy 同步发射（#150 时代 Host 形状 + 公共入口无归属拒绝；与 #150 既有行为
 * 逐字节一致）：直接 emit；emitter 同步 throw → 吞没（AC4 锚）。emit 尝试恰一次，
 * 不重试。
 */
function emitAttempt(emitter: NamespaceDiagnosticChangeEmitter, observedAt: string, e: CreateEmissionArgs): void {
  const record = assembleEmission(observedAt, e);
  if (record === undefined) return; // 组装失败（issues 投影违约）→ 该条丢弃
  try {
    emitter.emit(record);
  } catch {
    /* emitter 同步 throw（AC4 锚）→ 吞没，绝不改变业务结果 */
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

/** #226：非抛读取 seam `initStream` 成员（泵路径的建流调用面；缺席 → undefined）。 */
function readInitStreamMember(
  diagnosticLog: NamespaceRegistryDiagnosticLog,
): ((namespaceId: string, genesisUpdateBytes: Uint8Array | undefined) => void) | undefined {
  try {
    const candidate = (diagnosticLog as { initStream?: unknown }).initStream;
    return typeof candidate === 'function'
      ? (candidate as (namespaceId: string, genesisUpdateBytes: Uint8Array | undefined) => void)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * #155 单次解析 + 形状门（非抛；每次调用独立 try——D11 隔离：解析 throw / 返回
 * undefined / 畸形形状（非 object / emit 非函数）→ undefined）。双消费方共用单一
 * 实现：`emitStreamOutcome` 的 legacy 回退面与泵 drain 的 ns 解析面。
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

/** 装配产物（registry.ts 构造期一次取得——设计 §3.3：两构造共享同一泵实例）。 */
export interface CreateDiagRuntimeAssembled {
  /** CreateDiag（发射面路由；接口签名见上）。 */
  readonly diag: CreateDiag;
  /** per-namespace Runtime 诊断解析器（非抛；缺省 → 恒 undefined 解析器）。 */
  readonly resolveRuntimeDiag: (namespaceId: string) => RuntimeDiagResolved | undefined;
}

/**
 * #249：泵装配窄回调（registry.ts 侧接线到内部 observer seam——本模块与
 * observer.ts 保持解耦）。absent → 泵侧 reportDrop 缺席 → 满队丢弃静默
 * （既有行为零漂移）。
 */
export interface CreateDiagRuntimeOptions {
  /** 满队丢弃上报（泵依赖 `DiagPumpDeps.reportDrop` 的装配面）。 */
  readonly reportPumpDrop?: (drop: DiagPumpDropReport) => void;
}

/**
 * 单一诊断装配（#150/#155/#226/#249 共用；registry.ts 构造期一次调用）：
 * `diagnosticLog` 缺席/畸形 emitter → 恒 no-op diag + undefined 解析器（零日志
 * 行为、零开销——与既有完全一致）；emitter 在场 + 无 `runtimeEmitterFor` →
 * legacy 路径（#150 缓冲型 Host 逐字节现行）；emitter 在场 + 有
 * `runtimeEmitterFor` → #226 泵路径（见文件头路由三态）。
 */
export function createDiagRuntime(
  diagnosticLog: NamespaceRegistryDiagnosticLog | undefined,
  clock: Clock,
  options: CreateDiagRuntimeOptions = {},
): CreateDiagRuntimeAssembled {
  if (diagnosticLog == null) {
    return { diag: NOOP_DIAG, resolveRuntimeDiag: () => undefined }; // undefined/null 均 = 日志禁用
  }
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
  if (emitter === undefined) {
    return { diag: NOOP_DIAG, resolveRuntimeDiag: () => undefined };
  }
  // #155（§4-D4/C1）：构造期一次非抛读取 runtimeEmitterFor（双消费方共享同一
  // resolveEmitterOnce 形状门/吞没边界——D11）。
  const streamResolver = readRuntimeEmitterResolver(diagnosticLog);
  if (streamResolver === undefined) {
    // —— legacy 路径（#150 缓冲型 Host 形状；逐字节现行行为）——
    return {
      diag: {
        // 槽内结局：observedAt 由调用方保证为槽内 Clock 步的 createdAt 字符串
        // （零额外读数）；namespaceId 参数在 legacy 形状下无归属通道可寻——忽略
        // （共享 emitter 是 #150 时代冻结语义，行为不变）。
        emitOutcome: (_namespaceId, observedAt, e) => {
          emitAttempt(emitter, observedAt, e);
        },
        // Clock 步之前终结：诊断侧读一次 clock；clock 故障 → 该条 emission 丢弃。
        // namespaceId=undefined（公共入口）与槽内候选 id 在 legacy 形状下同路——
        // 恒同步共享 emitter（与 #150 既有行为逐字节一致）。
        emitEarlyOutcome: (_namespaceId, e) => {
          const observedAt = readEarlyObservedAt(clock);
          if (observedAt === undefined) return;
          emitAttempt(emitter, observedAt, e);
        },
        // #155（§4-D4/C1）：initStream 之后的槽内结局——legacy 回退（seam 静态无
        // resolver）→ 共享 emitter（#150 契约锚：#17/#18 落共享通道）。归因键仍
        // 是调用点静态分类 + namespaceId 数据；#150 时代 Host 无 ns-bound 通道。
        emitStreamOutcome: (_namespaceId, observedAt, e) => {
          emitAttempt(emitter, observedAt, e);
        },
        // stream 建立缝：Host 函数同步 throw = 违约 → 吞没隔离（AC4「stream init
        // 失败不改 create 结果」的 Registry 侧义务）；LOG_STREAM_INIT_FAILED 等健康
        // 事件由 Host 侧 adapter 的 observer 自行产生，Registry 不代发、不伪造。
        // 属性读取（`initStream` getter）与函数调用均在同一吞没 try 内（SA4 R1 B1）。
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
        // #249（design 裁决 D-1）：legacy 形状只有共享 emitter，无「namespace 的
        // 诊断流」承载——候选级结局 no-op（#150 冻结契约「恰一条最终结局」绿锚
        // registry-create-diagnostic-red L529 + sa7-dynamic `emitCalls === 10` 均由此
        // 保护；生产形状的覆盖义务经 runtimeEmitterFor 泵路径兑现——ADR-0011 L57）。
        emitCandidateOutcome: () => undefined,
      },
      resolveRuntimeDiag: () => undefined, // 两参既有行为零漂移（#150 时代形状）
    };
  }

  // —— #226 泵路径（生产形状：有 runtimeEmitterFor）——
  const initStreamMember = readInitStreamMember(diagnosticLog);
  // drain 内建流调用面（成员缺席 → no-op——路由层已保证缺席时不入队建流任务；
  // 双保险收编 Host 违约 throw）。
  const pumpInitStream = (namespaceId: string, genesisUpdateBytes: Uint8Array | undefined): void => {
    try {
      initStreamMember?.(namespaceId, genesisUpdateBytes);
    } catch {
      /* Host 违约（同步 throw）→ 吞没（drain 内，业务路径外） */
    }
  };
  // drain 内 ns-bound emitter 解析（resolveEmitterOnce 非抛边界复用）。
  const pumpResolveEmitter = (namespaceId: string): NamespaceDiagnosticChangeEmitter | undefined =>
    resolveEmitterOnce(streamResolver, namespaceId);
  // #249：满队丢弃上报装配（observer 缺席时 registry.ts 仍传回调——dispatchObserver
  // 自行 no-op；泵级 seam 可测性与生产接线同构；缺席 → 静默，既有行为零漂移）。
  const pump: DiagPump =
    options.reportPumpDrop === undefined
      ? createDiagPump({ initStream: pumpInitStream, resolveEmitter: pumpResolveEmitter })
      : createDiagPump({
          initStream: pumpInitStream,
          resolveEmitter: pumpResolveEmitter,
          reportDrop: options.reportPumpDrop,
        });
  // 泵侧「该 ns 已有流」登记（seed 决策：被拒 create 的补建流只发生一次——
  // SA1 §3.2「若该 ns 尚无流」；成功路径 initStream 亦登记——同一 ns 的后续
  // 早结局（终局后重试/重建场景）不重复补建）。
  const streamedNamespaces = new Set<string>();
  const enqueueInitStreamTask = (namespaceId: string, genesisUpdateBytes: Uint8Array | undefined): void => {
    streamedNamespaces.add(namespaceId);
    pump.enqueueInitStream(namespaceId, genesisUpdateBytes);
  };
  /** 被拒 create 的 genesis-less 补建流（诚实缺席 genesis——ADR-0012 L22）。 */
  const seedRejectedStreamIfAbsent = (namespaceId: string): void => {
    if (initStreamMember === undefined || streamedNamespaces.has(namespaceId)) return;
    enqueueInitStreamTask(namespaceId, undefined);
  };
  /** 泵投递（emission 已在捕获点组装完毕——泵只搬运；drop 语义由 drain 内
   *  解析违约/emitter throw 的既有吞没边界承载）。 */
  const enqueueEmit = (namespaceId: string, emission: NamespaceDiagnosticChangeEmission): void => {
    pump.enqueueEmit(namespaceId, emission);
  };

  return {
    diag: {
      // 槽内结局（#226）：以候选 namespaceId 数据键控投递——先补建流（被拒 create
      // 无后续 stream）再落结局记录（同 ns 队列 FIFO：建流在前、结局在后——与成功
      // create 的 initStream→#17 次序同构）；载荷组装在捕获点完成（字段/observedAt
      // 与 #150/#155 现状同位，零漂移）。
      emitOutcome: (namespaceId, observedAt, e) => {
        const record = assembleEmission(observedAt, e);
        if (record === undefined) return;
        seedRejectedStreamIfAbsent(namespaceId);
        enqueueEmit(namespaceId, record);
      },
      // Clock 步之前终结：#226 槽内（namespaceId 在场）→ 泵投递（先补建流）；
      // 公共入口拒绝（namespaceId=undefined，id 生成前无归属可用）→ 同步共享通道
      // （SA1 §7.2：非缺陷 A 对象——共享通道的丢弃语义在该面保持）。
      emitEarlyOutcome: (namespaceId, e) => {
        const observedAt = readEarlyObservedAt(clock);
        if (observedAt === undefined) return;
        if (namespaceId === undefined) {
          emitAttempt(emitter, observedAt, e);
          return;
        }
        const record = assembleEmission(observedAt, e);
        if (record === undefined) return;
        seedRejectedStreamIfAbsent(namespaceId);
        enqueueEmit(namespaceId, record);
      },
      // #155（§4-D4/C1）：initStream 之后的槽内结局——泵投递（stream 已由成功路径
      // 的 initStream 任务建立/排队，无需补建；per-ns FIFO 保持 initStream → #17/#18
      // 次序）。解析违约（throw/畸形/undefined）→ drain 内静默丢弃（D11/i1）。
      emitStreamOutcome: (namespaceId, observedAt, e) => {
        const record = assembleEmission(observedAt, e);
        if (record === undefined) return;
        enqueueEmit(namespaceId, record);
      },
      // stream 建立缝（成功路径）：O(1) 入队（真实建流在 drain 内——AC3 隔离面）。
      // initStream 成员缺席 → no-op（Host 选择延迟初始化——既有可选成员语义）。
      initStream: (namespaceId, genesisUpdateBytes) => {
        if (initStreamMember === undefined) return;
        enqueueInitStreamTask(namespaceId, genesisUpdateBytes);
      },
      // #249（AC4）：候选级被拒结局（entry collision / DOC_DUPLICATE）——与
      // emitEarlyOutcome/emitOutcome 同构的 ns-bound 泵投递（零新机制）：observedAt
      // 复用槽内 Clock 步产物（DOC_DUPLICATE——零额外读数）；undefined（entry
      // collision——判定在 Clock 步之前）→ 侧读一次 clock；clock 故障 → 该条诚实
      // 缺席。随后 genesis-less 补建流（如缺）再落记录——per-ns FIFO 保持建流先于
      // 记录。归属 = 候选 namespaceId 的流（碰撞候选 id 即既有 namespace 的 id——
      // 设计 §6.4；unattributed 通道恒零）。
      emitCandidateOutcome: (namespaceId, observedAt, e) => {
        const ts = observedAt ?? readEarlyObservedAt(clock);
        if (ts === undefined) return;
        const record = assembleEmission(ts, e);
        if (record === undefined) return;
        seedRejectedStreamIfAbsent(namespaceId);
        enqueueEmit(namespaceId, record);
      },
    },
    // #155（§5.4）+ #226（支柱三 wiring）：RuntimeFactory 第三参 = 延迟 wrapper
    // （O(1) 解析——**不**现场调 runtimeEmitterFor：B2 adapter 构造出槽；emitter
    // = O(1) 入队——B3 槽间窗口 emit 出窗）。wrapper 形状 = 既有 emitter seam
    // （同步、void、不 throw）——Runtime 零感知；违约 Host 的解析失败移到 drain
    // 内静默丢弃（设计路由表第 3 行）。
    resolveRuntimeDiag: (namespaceId) => ({
      emitter: {
        emit: (emission) => {
          enqueueEmit(namespaceId, emission);
        },
      },
      clock: () => clock.now(),
    }),
  };
}
