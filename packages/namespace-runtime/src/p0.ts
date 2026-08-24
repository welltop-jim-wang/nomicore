/**
 * @nomicore/namespace-runtime —— P0 槽体（D7）：gate → 四键投影 → compile → 安装/分级失败。
 *
 * P0 语义（ADR-0008「P0 与 active schema」节 + SA6 冻结契约）：
 * - P0 是 write sequencer 真实队首节点（D6 微任务起步）；槽体异步执行，绝不在构造
 *   调用栈内同步结算（INV-N1）；
 * - P0 只读取 SCHEMA 标准四键、调用 compileSchemaEnvelope 并构造 schema-dependent
 *   tools；不读取、提取或验证 ROOT（INV-N3：零 Y.Doc 写任务）；
 * - 失败三级分级：
 *   ⑥ 正常 compile failure（结果联合内 ok:false + 非空 issues）→ unavailable +
 *      稳定 issue 摘要（D7.4 派生规则），rootWrite 关 / schemaWrite 可修复；
 *   ⑤ 畸形 ok:true（最小形状守卫失败）/ ok:false 零 issues / 任何抛出（含 p0Gate
 *      reject、注入 compile throw、投影杂散异常）→ ⑦ fatal（permanent，全部写关、
 *      读取保留、摘要稳定不含原始异常——INV-N7）。
 *
 * INV-N12：槽体整体 try/catch——本函数返回的 promise 永不 reject（unhandled
 * rejection 不存在；sequencer 链尾 noop 仅是第二道保险）。
 *
 * fatalCause（R2 修订，SA2 #6）：包内诊断锚点——闭包 state 私有字段，不出现在任何
 * 公共面（INV-N5/N7 不变）；其消费/上报登记为后续观测面 issue 的显式验收点。
 */
import type * as Y from 'yjs';
import type {
  CompileSchemaEnvelopeOk,
  CompileSchemaEnvelopeResult,
  DerivedSchema,
  SchemaEnvelope,
  SchemaParseIssue,
  VfslModule,
} from '@nomicore/vfsl';
import { FATAL_P0_INTERNAL_CODE, FATAL_P0_INTERNAL_MESSAGE } from './errors.js';
import { projectSchemaEnvelope } from './projection.js';

/** Runtime 可变运行态（闭包私有；唯一可变源——P0 终态迁移单点写入，JS 单线程无竞态）。 */
export interface RuntimeState {
  schemaState: 'preparing' | 'ready' | 'unavailable';
  /** unavailable 时的稳定 issue 摘要（冻结 {code,message} 纯字符串对；INV-N7）。 */
  schemaIssue?: Readonly<{ code: string; message: string }>;
  /** ready 时的 active schema 五字段身份（冻结；INV-N8 双指纹取自 compile 产物引用）。 */
  activeInfo?: Readonly<ActiveSchemaInfo>;
  /** active schema tools（module/derived）——内部保留，永不进任何公共面（D8）。 */
  activeTools?: { module: VfslModule; derived: DerivedSchema };
  /** fatal 稳定摘要（冻结；一经置位永久为真——INV-N6）。 */
  fatal?: Readonly<{ code: string; message: string }>;
  /** 包内诊断锚点（R2 修订，SA2 #6）：原始 internal 异常，不进任何公共面。 */
  fatalCause?: unknown;
}

/** active schema 身份投影（D8）：五键恰好；module/derived/validator 永不出现。 */
export interface ActiveSchemaInfo {
  readonly lang: string;
  readonly version: number;
  readonly id: string;
  readonly envelopeFingerprint: string;
  readonly semanticFingerprint: string;
}

/** P0 槽体运行时环境（构造栈一次成型——INV-N14：纯数据闭包，thunk/槽体零读 seam 输入）。 */
export interface P0Env {
  readonly doc: Y.Doc;
  readonly state: RuntimeState;
  /** 编译前可控门（undefined = 无门）。显式 undefined 联合型（非 exactOptional）——
   *  构造栈一次成型时允许惰性传 undefined。 */
  readonly p0Gate: Promise<void> | undefined;
  readonly compile: (envelope: SchemaEnvelope) => CompileSchemaEnvelopeResult;
}

/**
 * P0 槽体（D7）。整体 try/catch：一切路径（既有分级 + 杂散 throw）收敛到结构化致命
 * 或数据级 unavailable——本 async 函数永不 reject（INV-N12）。
 */
export async function runP0(env: P0Env): Promise<void> {
  try {
    // ① [扩展位：lifecycle/fatal gate]——P0 是队首首个任务，构造门已验 handle，
    //    v1 无前置 fatal 可能；真实写槽将在此步检查 lifecycle/fatal（文档位）
    // ② [扩展位：写门]——P0 零 Y.Doc 写，不受 persistence-degraded 阻止（ADR-0008
    //    明文）；构造接受的 degraded handle 上 P0 照常执行
    if (env.p0Gate !== undefined) {
      await env.p0Gate; // 编译前可控门（reject → ⑦ fatal）
    }
    // ③ 四键投影（与公共 getSchemaEnvelope 同源单点——projectSchemaEnvelope；唯二
    //    触碰 SCHEMA 的路径之一；mode 'p0'：违规键省略——live 引用绝不进 compile 输入）
    const projection = projectSchemaEnvelope(env.doc, 'p0'); // SchemaEnvelope 形状 | null
    // ④ compile（env.compile 已在构造栈捕获为局部函数引用——不再读 seam 输入）
    const result = env.compile(projection as SchemaEnvelope);
    //    原始投影直入——校验权单源在 compile 严格门：null → ENV-1（实际收到 null）、
    //    缺键 → ENV-2、错型 → ENV-3，全部结构化 ok:false，绝非异常。
    //    `as` 收窄是记录「投影是原始数据，验证不在此层」的类型层声明。
    if (result.ok) {
      // ⑤ 最小形状守卫（防注入 seam 返回畸形 ok:true——结果联合之外的值按 internal
      //    fault 分级，loud）：envelope 三身份字段 + 双指纹 + module/derived 存在且
      //    类型正确，否则 throw → ⑦
      assertCompiledShape(result);
      installActive(result, env.state);
    } else {
      // ⑥ 正常 compile failure → unavailable（结果联合内的失败，非 fatal）
      if (result.issues.length === 0) {
        // ok:false 且零 issue = 结果联合外的契约违背（vfsl 各失败阶段恒产出 ≥1 条，
        // 源码佐证）→ internal fault，loud
        throw new Error(
          'compile 注入返回 ok:false 且零 issues——结果联合之外的状态，按 internal fault 分级',
        );
      }
      const first = result.issues[0];
      if (first === undefined) {
        throw new Error('compile 返回的 issues 数组为空——按 internal fault 分级');
      }
      env.state.schemaState = 'unavailable';
      env.state.schemaIssue = Object.freeze(toIssueSummary(first)); // 摘要一经结算冻结
    }
    // 结算即出队：promise settle，任务节点随链推进消失（无残留任务记录）
  } catch (err) {
    // ⑦ internal fault → fatal（permanent）
    env.state.fatal = Object.freeze({
      code: FATAL_P0_INTERNAL_CODE,
      message: FATAL_P0_INTERNAL_MESSAGE,
    });
    env.state.fatalCause = err; // 包内诊断锚点（不进任何公共面）
    // 恒定文案：不插值原始异常（测试锁定 message 不含哨兵文本）；schema.state 保持
    // 'preparing'（P0 未结算成 ready/unavailable——仍在三态集合内）
  }
}

/** D7.4 unavailable issue 摘要派生规则（首条 issue，稳定映射；摘要冻结于 errors 侧）。
 *  @internal 导出（issue #91）：SCHEMA 写槽 S4' 同款码派生消费（toReplacementIssue）。 */
export function toIssueSummary(issue: SchemaParseIssue): { code: string; message: string } {
  if (issue.kind === 'envelope') {
    // code 作不透明段透传（R2 修订，SA2 #5）：分隔符语义明确，不假设数字串——
    // vfsl 闭集码读作 SCHEMA_ENVELOPE_5/SCHEMA_ENVELOPE_100；注入 ENV_TEST 读作
    // SCHEMA_ENVELOPE_ENV_TEST（运行时不校验码域——测试注入必须能流过）
    return {
      code: `SCHEMA_ENVELOPE_${String(issue.issue.code)}`,
      message: issue.issue.message,
    };
  }
  return {
    code: 'SCHEMA_TEXT_INVALID',
    message: issue.issue.message,
  };
}

/** D8 installActive：五字段冻结身份 + 内部 tools 保留；state → 'ready'（终态锁定）。
 *  @internal 导出（issue #91）：SCHEMA 写槽 S5.5 复用为「安装 active schema 单点」。
 *  增补 `delete state.schemaIssue`（恢复卫生——P0 unavailable 摘要不残留；P0 调用点
 *  preparing→ready 时该字段恒 undefined → no-op，零回归）。 */
export function installActive(compiled: CompileSchemaEnvelopeOk, state: RuntimeState): void {
  const info = Object.freeze({
    lang: compiled.envelope.lang,
    version: compiled.envelope.version,
    id: compiled.envelope.id,
    envelopeFingerprint: compiled.envelopeFingerprint, // 直接引用，零重算——
    semanticFingerprint: compiled.semanticFingerprint, // 「与 compileSchemaEnvelope
    // 产物逐字节一致」的结构性保证
  });
  state.activeInfo = info;
  state.activeTools = { module: compiled.module, derived: compiled.derived }; // 内部保留
  state.schemaState = 'ready';
  delete state.schemaIssue; // unavailable 摘要不残留（status.ts 仅 unavailable 态投影，可观测面零变化）
}

/** D7 ⑤ 最小形状守卫：结果联合之外的畸形 ok:true → throw（→ ⑦ loud 分级）。
 *  【R1.1/A1】检查面扩展：envelope own 键集**恰** {lang,version,id,text}（多键/缺键均拒）
 *  + lang/id/text string + version number + **text string**（原守卫漏检 text/键集——
 *  {…, text: 42} 或 {…, extra: 1} 曾可漏过，随后在组合 seam ①b 被降级为普通 ok:false，
 *  构成「internal 产物劣化伪装成调用方领域失败」的分级漂移）——违规一并走 internal
 *  fault；扩展对 P0 零回归（P0 ⑤ 违约本就 throw → ⑦ fatal；真实 vfsl 编译产物恒过：
 *  五件套递归深冻结 + ENV-5 拒多余键。守卫唯一触发面 = 注入 seam / 未来 vfsl 回归）。
 *  逐字段判型（对象态先验后再进成员，防对 undefined/原始值取成员抛裸 TypeError）。
 *  @internal 导出（issue #91）：SCHEMA 写槽 S4' 消费同一守卫。 */
export function assertCompiledShape(compiled: CompileSchemaEnvelopeOk): void {
  const c = compiled as unknown as Record<string, unknown>;
  const envelope = c.envelope;
  let envOk = false;
  if (typeof envelope === 'object' && envelope !== null) {
    const envelopeRecord = envelope as Record<string, unknown>;
    const envKeysOk =
      Object.keys(envelopeRecord).length === 4 &&
      Object.prototype.hasOwnProperty.call(envelopeRecord, 'lang') &&
      Object.prototype.hasOwnProperty.call(envelopeRecord, 'version') &&
      Object.prototype.hasOwnProperty.call(envelopeRecord, 'id') &&
      Object.prototype.hasOwnProperty.call(envelopeRecord, 'text');
    envOk =
      envKeysOk &&
      typeof envelopeRecord.lang === 'string' &&
      typeof envelopeRecord.version === 'number' &&
      typeof envelopeRecord.id === 'string' &&
      typeof envelopeRecord.text === 'string';
  }
  const ok =
    envOk &&
    typeof c.envelopeFingerprint === 'string' &&
    typeof c.semanticFingerprint === 'string' &&
    typeof c.module === 'object' &&
    c.module !== null &&
    typeof c.derived === 'object' &&
    c.derived !== null;
  if (!ok) {
    throw new Error(
      'compile 注入返回畸形 ok:true（envelope 恰四键封闭/四值型/双指纹/module/derived 形状缺失）——按 internal fault 分级',
    );
  }
}
