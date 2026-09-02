/**
 * @nomicore/namespace-runtime —— 诊断日志接线（issue #149）：DiagnosticEnv /
 * per-attempt 收集器（SlotDiag）/ 槽外 emission（emitAttempt / emitSlot）/
 * 槽内结局写入 helpers。
 *
 * 职责边界（设计 §5–§8）：
 * - producer 只做语义 emission（ADR-0011 §E / ADR-0012 §B）——stage/code/sourcePhase/
 *   issues/input/result 全部摘自既有业务事实，零发明、零第二构造（issues 同源引用
 *   透传）；物理投影（digest/base64/segment/stream 身份）全部留给 adapter。
 * - emit 调用点纪律（ADR-0012 amendment C）：emitSlot 由公共方法的 `.then` 回调调用
 *   （write sequencer slot 已释放之后；设计 §7.1 的微任务序证明）；acceptance 拒绝
 *   （零入队路径）在公共方法调用栈内同步 emitAttempt。
 * - emitAttempt 吞没一切（ADR-0011 §A producer 防御义务）：emitter 同步 throw /
 *   违约 clock（NaN/超域 epoch）——绝不改变业务返回值、FIFO、dirty notification 与
 *   Runtime capability（AC4 四不变）。
 * - INV-DIAG（设计 §7.3，SA2 #2 立法）：outcome 缺失 + 业务成功（fulfilled 且
 *   r.ok === true）→ 缺省组装 transaction/committed（bytes→update / 零事件→noop）；
 *   outcome 缺失 + 业务拒绝（ok:false resolve）或业务 rejection（fatal throw）→
 *   **不 emit 该记录**——宁可缺记录，绝不把业务拒绝伪装成 committed（Objective 的
 *   存在目的；ADR-0011 §B「日志层不得发明成功语义」）；设计 §13.7「ok:false ⇒
 *   result.kind !== 'committed'」机制守卫可捕获本违约。
 *
 * 模块零导出到公共面（index.ts 不 re-export——诊断实现是包内模块；runtime.ts /
 * write.ts / schema-write.ts 经相对导入消费）。
 */
import type {
  DiagnosticIssue,
  EmissionInput,
  EmissionResult,
  LogContext,
  LogSource,
  NamespaceDiagnosticChangeEmitter,
  Operation,
  SourceModule,
  Stage,
} from '@nomicore/namespace-diagnostic-log';

/**
 * 诊断环境（构造栈一次成型）。emitter 与 clock **成对**（设计 §5.2 构造期 loud 校验）：
 * 装配 emitter 而缺 clock ⇒ 构造 TypeError——observedAt 的唯一来源是注入 Clock
 * （ADR-0012 §observedAt），无 Date.now 系统墙钟缺省。
 * 【R1 修订，SA2 #5 / INFO-1】类型面以判别联合表达该配对：未装配 = 两字段俱 undefined
 * （全部既有测试 + 生产路径——零行为变化）；装配 = emitter 与 clock 俱在。
 * emitAttempt 仅在 emitter 分支读取 clock——结构性保证非 undefined。
 */
export type DiagnosticEnv =
  | { readonly emitter: undefined; readonly clock: undefined }
  | { readonly emitter: NamespaceDiagnosticChangeEmitter; readonly clock: () => number };

/** DiagnosticEnv 一次成型（构造栈内调用；总函数形态——任意输入组合给出良构 env。
 *  成对性由 captureSeamInput 的校验前置保证（emitter 在 ⇒ clock 在），本函数只是
 *  类型面落地；「emitter 在而 clock 缺」在构造期已被 loud TypeError 拦截，不可达。 */
export function buildDiagnosticEnv(
  emitter: NamespaceDiagnosticChangeEmitter | undefined,
  clock: (() => number) | undefined,
): DiagnosticEnv {
  return emitter !== undefined && clock !== undefined
    ? { emitter, clock }
    : { emitter: undefined, clock: undefined };
}

/** 槽内结局片段（单点写入——最后一个结局点胜；槽内无并发，确定性）。 */
export interface SlotOutcome {
  readonly stage: Stage;
  readonly result: EmissionResult;
  /** 与 sourceModule 成对（emitAttempt 单点保证——设计 §7.2 / §10-J3）。 */
  readonly code?: string;
  /** 【issue #151 D-9】code 的注册表来源：'runtime'（RUNTIME_WRITE_DISABLED 等）/
   *  'replication'（REPLICATION_* / NSRT-FATAL-REPLICATION-*）。缺省 'runtime'
   *  （emitAttempt 缺省）——ROOT/SCHEMA 既有槽零改动。 */
  readonly sourceModule?: SourceModule;
  readonly sourcePhase?: string;
  readonly issues?: DiagnosticIssue[];
}

/** per-attempt 收集器（槽内诊断事实 → 槽外 emission；diag === undefined ⇔ 未装配
 *  emitter——槽体全部写入经 helpers 的可选链形态 no-op，无日志基线行为等价）。 */
export interface SlotDiag {
  readonly operation: Operation;
  /** 输入捕获态：初始 not-accessed；S3 失败→unsafe-input；S3 成功→{snapshot}
   *  （同一 frozen 快照引用——AC5 零额外读取的机制保证）。
   *  【issue #151】放宽为 `EmissionInput | undefined`：undefined = 本尝试**无可捕获
   *  输入**（≠「拒绝先于输入访问」——那是 {status:'not-accessed'} 的专属语义，
   *  ADR-0011 §E）——apply/bump 槽以 undefined 构造（D-8）；省略 → record 面
   *  {capture:'none'}（projection/input.ts 单点）。 */
  input: EmissionInput | undefined;
  /** 槽体各结局点单点写入（最后一个结局点胜——槽内无并发，确定性）。 */
  outcome: SlotOutcome | undefined;
  /** S5 捕获窗口产物（槽体在窗口 finally 内赋值；fatal 分类在窗口收口之后读取）。 */
  updateBytes: Uint8Array | undefined;
  /** 【issue #151 D-7】受控变更来源（apply 会话槽恒带 replication source；enable/bump
   *  缺省 local——发射层透传，缺省即既有行为，零改动）。 */
  source?: LogSource;
  /** 【issue #151 D-7】受控身份 context（per-record；enable/bump 槽 E4 后写入；
   *  apply 槽创建时即携会话冻结值）。 */
  context?: LogContext;
}

/** 公共方法对槽完成信号的结算事实（emitSlot 签名载荷——SA2 #2 修订：缺省组装仅在
 *  业务 fulfilled 且 r.ok === true 时生效）。 */
export type SlotSettle<T> = { kind: 'fulfilled'; value: T } | { kind: 'rejected' };

/** createSlotDiag：仅当 diagEnv.emitter 装配时由公共方法构造。 */
export function createSlotDiag(operation: Operation): SlotDiag {
  return { operation, input: { status: 'not-accessed' }, outcome: undefined, updateBytes: undefined };
}

/** fatal 结果组装（设计 §7.3 effect 判定表）：committed:false 不带 effect（结构上
 *  事务未发生）；committed:true 且 bytes 有→update / 无→unknown（诚实上报：提交了
 *  什么不可知——绝不编造 effect）。 */
function fatalFromBytes(committed: boolean, updateBytes: Uint8Array | undefined): EmissionResult {
  if (!committed) return { kind: 'fatal', committed: false };
  return updateBytes !== undefined
    ? { kind: 'fatal', committed: true, effect: 'update', updateBytes }
    : { kind: 'fatal', committed: true, effect: 'unknown' };
}

/** observedAt 本地 helper（设计 §4/§7.2——与诊断包 observedAtFrom 同一 ISO 表达式
 *  `new Date(now()).toISOString()`，非序列化规则复制；避免值级引入诊断包模块导出拉入
 *  reader/file 运行图）。epoch 超出 ISO 表示域时 throw——producer 侧 bug，发生在
 *  emit 之前（emitAttempt 的 try/catch 吞没：记录缺失即最终表现，不伪造时间戳）。 */
function observedAtMs(now: () => number): string {
  return new Date(now()).toISOString();
}

/** emitAttempt 载荷。code 与 sourceModule 的成对性由 emitAttempt 单点保证（§7.2）。
 *  【issue #151 四点向后兼容扩展】input 可选化（省略 ⇒ record 面 {capture:'none'}——
 *  不携带 input: undefined 值键）+ source/context/sourceModule 可选（缺省 = 既有
 *  行为：local / 省略 / 'runtime'）——ROOT/SCHEMA 既有调用零改动、字节面零变化。 */
export interface SlotEmissionArgs {
  readonly operation: Operation;
  readonly stage: Stage;
  readonly code?: string;
  readonly sourcePhase?: string;
  readonly issues?: DiagnosticIssue[];
  readonly input?: EmissionInput;
  readonly result: EmissionResult;
  readonly source?: LogSource;
  readonly context?: LogContext;
  readonly sourceModule?: SourceModule;
}

/** 语义 emission（ADR-0011 §E）。emitter 未装配 = 零 emit 零成本；emitter 装配后
 *  clock 必在（判别联合窄化）。**吞没一切**——日志属 best-effort observability，
 *  任何日志侧故障不得改变业务结果。 */
export function emitAttempt(env: DiagnosticEnv, e: SlotEmissionArgs): void {
  if (env.emitter === undefined) return; // 判别联合窄化：此后 env.clock 必在（成对校验）
  try {
    env.emitter.emit({
      operation: e.operation,
      stage: e.stage,
      observedAt: observedAtMs(env.clock),
      // 【issue #151 D-7/D-9】source 缺省 {kind:'local'}（ADR-0012 source 词表；Runtime
      // 本地写路径）；sourceModule 缺省 'runtime' 且与 code 恒成对（§10-J3 单侧即丢）。
      ...(e.source !== undefined ? { source: e.source } : { source: { kind: 'local' } }),
      ...(e.code !== undefined ? { code: e.code, sourceModule: e.sourceModule ?? 'runtime' } : {}),
      ...(e.sourcePhase !== undefined ? { sourcePhase: e.sourcePhase } : {}),
      ...(e.issues !== undefined ? { issues: e.issues } : {}),
      ...(e.context !== undefined ? { context: e.context } : {}),
      // 【R1，SA2 #1】input 条件展开：省略 = 本尝试无可捕获输入（record 面投影
      // {capture:'none'}——projection/input.ts 单点）；不携带 `input: undefined` 值键。
      ...(e.input !== undefined ? { input: e.input } : {}),
      result: e.result,
      // attemptId 省略 → emitter 管线 CSPRNG 生成（att-+32hex，pipeline.ts 既有）；
      // durationMs 省略（无可靠 monotonic 来源，不发明——ADR-0012 §observedAt）；
      // context 省略时缺省不携带（全可选字段，仅 replication 身份/关联提供）
    });
  } catch {
    /* ADR-0011 §A：adapter 同步 throw（含敌意 emitter，AC4 锚点）/ 违约 clock（NaN/
       超域 epoch 在 observedAtMs 内 throw）一律隔离——吞没，绝不改变业务结果。 */
  }
}

/** 槽后 emission（设计 §7.3 组装契约）。emitSlot 仅由公共方法的 `.then(onOk, onErr)`
 *  回调调用——此时 write sequencer slot 已释放（设计 §7.1 时序证明）。 */
export function emitSlot<T extends { ok: boolean }>(
  env: DiagnosticEnv,
  diag: SlotDiag | undefined,
  settle: SlotSettle<T>,
): void {
  if (env.emitter === undefined || diag === undefined) return;
  if (diag.outcome !== undefined) {
    // 槽体显式结局——唯一常规路径（设计 §9 的 25 结局点映射表）
    emitAttempt(env, {
      operation: diag.operation,
      ...(diag.input !== undefined ? { input: diag.input } : {}),
      stage: diag.outcome.stage,
      ...(diag.outcome.code !== undefined ? { code: diag.outcome.code } : {}),
      ...(diag.outcome.sourceModule !== undefined ? { sourceModule: diag.outcome.sourceModule } : {}),
      ...(diag.outcome.sourcePhase !== undefined ? { sourcePhase: diag.outcome.sourcePhase } : {}),
      ...(diag.outcome.issues !== undefined ? { issues: diag.outcome.issues } : {}),
      result: diag.outcome.result,
      // 【issue #151】source/context 透传（apply 槽恒带；enable/bump 缺省 local/省略）
      ...(diag.source !== undefined ? { source: diag.source } : {}),
      ...(diag.context !== undefined ? { context: diag.context } : {}),
    });
    return;
  }
  // ── INV-DIAG（内部不变量，SA2 #2 立法）：缺省组装仅对「业务成功」生效 ──
  if (settle.kind === 'fulfilled' && settle.value.ok === true) {
    emitAttempt(env, {
      operation: diag.operation,
      ...(diag.input !== undefined ? { input: diag.input } : {}),
      stage: 'transaction',
      ...(diag.source !== undefined ? { source: diag.source } : {}),
      ...(diag.context !== undefined ? { context: diag.context } : {}),
      result: diag.updateBytes !== undefined
        ? { kind: 'committed', effect: 'update', updateBytes: diag.updateBytes }
        : { kind: 'committed', effect: 'noop' },
    });
    return;
  }
  // outcome 缺失 + 业务拒绝（ok:false resolve）或业务 rejection（fatal throw）：
  // 设计 §9 映射表某拒绝/fatal 点漏写 diag outcome——**不 emit 该记录**（亮式不变量
  // 违约：宁可缺记录，绝不把业务拒绝伪装成 committed——Objective「区分 committed 与
  // expected rejections」的存在目的；ADR-0011 §B「日志层不得发明成功语义」）。
  // 本票无 producer 健康通道（SA8 已裁观察项）；设计 §13.7 补测清单的「ok:false ⇒
  // result.kind !== 'committed'」机制守卫可捕获本违约。
  return; // INV-DIAG: unreachable in a complete slot implementation (design §9 table)
}

// ── 槽内结局写入 helpers（设计 §8.1/§8.2：每个结局点一行；diag undefined 即 no-op）──

/** capability-gate 领域拒绝（RUNTIME_WRITE_DISABLED / SCHEMA_UNAVAILABLE 等）——
 *  issues 同源透传（与业务返回值同一数组引用，零第二构造——设计 §9.3 透传侧裁决）。 */
export function diagCapGate(diag: SlotDiag | undefined, code: string, issues: DiagnosticIssue[]): void {
  if (diag === undefined) return;
  diag.outcome = { stage: 'capability-gate', result: { kind: 'rejected' }, code, issues };
}

/** capability-gate fatal（S2 getStatus 抛错 / S4 结构不可达守卫）——committed:false，
 *  无 issues 载荷（throw 通道：RuntimeWriteFatalError 无 issues 字段，§9.3 裁决）。
 *  【issue #151】sourceModule 可选（D-9：复制域 fatal 码传 'replication'；缺省
 *  'runtime'——ROOT/SCHEMA 既有调用零改动）。 */
export function diagFatalCapGate(
  diag: SlotDiag | undefined,
  code: string,
  sourceModule?: SourceModule,
): void {
  if (diag === undefined) return;
  diag.outcome = {
    stage: 'capability-gate',
    result: { kind: 'fatal', committed: false },
    code,
    sourcePhase: 'write-slot-internal',
    ...(sourceModule !== undefined ? { sourceModule } : {}),
  };
}

/** S3 快照失败：input ← unsafe-input；记录 rejected + 单 issue——拒绝先于任何值读取，
 *  记录不回读敌意输入（accessor 零执行×2，AC3/AC5 锚点）。 */
export function diagInputSnapshotFail(
  diag: SlotDiag | undefined,
  code: string,
  issue: DiagnosticIssue,
): void {
  if (diag === undefined) return;
  diag.input = { status: 'unsafe-input' };
  diag.outcome = { stage: 'input-snapshot', result: { kind: 'rejected' }, code, issues: [issue] };
}

/** S3 快照成功：input ← {snapshot}（唯一 payload 来源——同一 frozen 快照引用，
 *  诊断侧零第二次遍历调用方原对象：AC5 Proxy 零额外读取的机制保证）。 */
export function diagInputReady(diag: SlotDiag | undefined, snapshot: unknown): void {
  if (diag === undefined) return;
  diag.input = { snapshot };
}

/** validation 拒绝（S5 领域失败 / SCHEMA S3′b 形状检查失败）——issues 同源透传，
 *  无顶层 code（领域校验面按 ADR-0011 §B 保留 issues 通道，§9.3）。 */
export function diagValidation(diag: SlotDiag | undefined, issues: DiagnosticIssue[]): void {
  if (diag === undefined) return;
  diag.outcome = { stage: 'validation', result: { kind: 'rejected' }, issues };
}

/** transaction fatal（S5 DocRuntimeFatalError / 未知异常）——effect 按 §7.3 表由
 *  updateBytes 实参裁决。分类在 catch 内执行（JS 语义 catch 先于 finally）：读取窗口
 *  局部捕获值（事件在 transact 调用栈内、throw 之前已派发——捕获值在 catch 时已就绪），
 *  不依赖 diag.updateBytes 的 finally 赋值序。 */
export function diagFatalTx(
  diag: SlotDiag | undefined,
  code: string,
  committed: boolean,
  phase: string,
  updateBytes: Uint8Array | undefined,
  sourceModule?: SourceModule,
): void {
  if (diag === undefined) return;
  diag.outcome = {
    stage: 'transaction',
    result: fatalFromBytes(committed, updateBytes),
    code,
    sourcePhase: phase,
    ...(sourceModule !== undefined ? { sourceModule } : {}),
  };
}

/** dirty-notification fatal（S6 notifier 失败）——committed:true（写已提交），
 *  effect 由 diag.updateBytes 裁决（正常必有 bytes → update）。 */
export function diagDirtyFatal(diag: SlotDiag | undefined, code: string, sourceModule?: SourceModule): void {
  if (diag === undefined) return;
  diag.outcome = {
    stage: 'dirty-notification',
    result: fatalFromBytes(true, diag.updateBytes),
    code,
    sourcePhase: 'notify-dirty-failed',
    ...(sourceModule !== undefined ? { sourceModule } : {}),
  };
}

/** schema-compile 失败（S4 compile ok:false）——rejected；issues 为结构化
 *  {code, message, path:[]}（toIssueSummary 码派生单源：SCHEMA_TEXT_INVALID /
 *  SCHEMA_ENVELOPE_*），顶层 code = 首条 issue 的结构化码。 */
export function diagCompileFail(diag: SlotDiag | undefined, issues: DiagnosticIssue[]): void {
  if (diag === undefined) return;
  const first = issues[0];
  diag.outcome = {
    stage: 'schema-compile',
    result: { kind: 'rejected' },
    ...(first !== undefined && first.code !== undefined ? { code: first.code } : {}),
    issues,
  };
}

/** schema-compile throw（S4 compile 抛错 / ok:false 零 issues / 畸形 ok:true 守卫）——
 *  committed:false（编译结构上先于一切 doc 写，诚实零写入）；无 issues 载荷（§9.3）。 */
export function diagFatalCompileThrow(diag: SlotDiag | undefined, code: string): void {
  if (diag === undefined) return;
  diag.outcome = {
    stage: 'schema-compile',
    result: { kind: 'fatal', committed: false },
    code,
    sourcePhase: 'schema-compile-throw',
  };
}

/** 【issue #151】validation 拒绝 + 顶层稳定码（enable E3 / bump E4 域拒绝——issues
 *  同源透传）。与既有 `diagValidation`（无顶层 code，ROOT/SCHEMA 领域校验面）并存：
 *  复制管理域的拒绝码字段固定来自结果面稳定码族（REPLICATION_*）。 */
export function diagValidationCode(
  diag: SlotDiag | undefined,
  code: string,
  issues: DiagnosticIssue[],
  sourceModule?: SourceModule,
): void {
  if (diag === undefined) return;
  diag.outcome = {
    stage: 'validation',
    result: { kind: 'rejected' },
    code,
    issues,
    ...(sourceModule !== undefined ? { sourceModule } : {}),
  };
}
