/**
 * 信封解析与方言路由——信封层（issue #52 / H1，Phase 2 引擎前置）内部实现。
 *
 * 定位：doc 顶层 `SCHEMA` 键（ADR-0001 命名修订）下的信封 `{ lang, version, id, text }`
 * 到达引擎侧后的第一个消费动作——「这份数据是不是它自称的 schema、说的是哪种方言、
 * 文本按该方言如何解释」。编排函数 `parseSchemaEnvelope` 本体在 `index.ts` 与
 * `parseVfsl` 同址（本模块零 index 依赖，避免模块环，见设计 §2.1）。
 *
 * 领地划分（设计 §1.2 错误通道三分）：
 * - 方言层：`VfslIssue`，前缀 `VFSL-E<码>:`（errors.ts 21 码冻结注册表），管文本是否合法方言；
 * - 信封层（本模块）：独立 `SchemaEnvelopeIssue`，前缀 `VFSL-ENV-E<码>:`，管这份
 *   数据是不是它自称的 schema、方言认不认识——**不复用** `VfslIssue`/errors.ts 注册表；
 * - 接缝层：`SchemaSourceError`（throw），管这份来源能不能交出信封。
 *
 * 本模块只含纯校验件；编排（形状 → 方言 → 文本透传）在 index.ts。设计 §3/§4/§6 为规则
 * 冻结源，实现细节（含单读物化）在 SA3 自由度内。
 */
import { assertVfslDialect, SchemaSourceError } from './schemasource.js';
import type { SchemaEnvelope } from './schemasource.js';
import type { VfslIssue, VfslModule } from './ir.js';

/** 信封层错误码注册表（ENVELOPE 码空间——与 errors.ts 方言层 21 码互斥，见设计 §6.1）。 */
export const EnvelopeErrCode = {
  ENV_1: '1',      // 非对象（原始值 / null / undefined / 函数 / 数组）
  ENV_2: '2',      // 必需键缺失（一条列全）
  ENV_3: '3',      // 键类型错误（一条列全）
  ENV_4: '4',      // 未知方言（只读 loud-fail）
  ENV_5: '5',      // 多余键（严格封闭：恰含四键——issue #72 compile 入口专属）
  ENV_100: '100',  // 崩溃边界（意外异常——对齐 parseVfsl E100 兜底口径）
} as const;

export type SchemaEnvelopeIssueCode = (typeof EnvelopeErrCode)[keyof typeof EnvelopeErrCode];

/** 信封自身的错误域：没有文本行列；readOnly 仅在未知方言时为 true。 */
export interface SchemaEnvelopeIssue {
  code: SchemaEnvelopeIssueCode;
  message: string;
  readOnly: boolean;
}

/** 统一 issues 数组的 discriminated union：既可统一遍历，又不混淆信封与 VFSL 文本错误。 */
export type SchemaParseIssue =
  | { kind: 'envelope'; issue: SchemaEnvelopeIssue }
  | { kind: 'vfsl'; issue: VfslIssue };

/**
 * 信封层 issue 构造——**唯一构造点**：冻结前缀 `VFSL-ENV-E<码>: ` + 单行结构性保证。
 * 任何动态值（ENV-4 内嵌 assertVfslDialect 原消息、ENV-100 内嵌 err.message）都无法
 * 令 message 出现行终止符，从而无法伪造行首 `VFSL-E<码>:` 的文本通道行。
 */
export function makeEnvelopeIssue(
  code: SchemaEnvelopeIssueCode,
  message: string,
  readOnly = false,
): SchemaEnvelopeIssue {
  return {
    code,
    message: `VFSL-ENV-E${code}: ${sanitizeEnvelopeMessage(message)}`,
    readOnly,
  };
}

/**
 * 单行 sanitizer（设计 R2 #1 冻结，模块内部）：四种 Unicode 行终止符（\n、\r、\u2028、
 * \u2029——ECMAScript 行终止符全集，也是 `/m` 正则 `^` 的分行边界）一律替换为可见转义
 * `\\n` / `\\r` / `\\u2028` / `\\u2029`。**逐字符类映射**（非交替分支——CRLF 整体匹配在
 * 相等分支下会误映射，逐字符处理则 `\r\n` 忠实转义为 `\\r\\n`）。纯函数、确定性。
 * 在唯一构造点**后置**执行：ENV-4 的动态值插值发生在冻结资产 assertVfslDialect 内部
 * （DENY LIST，不可预转义），后置组合整串净化是唯一可行的单点（设计 §4）。
 */
const LINE_TERMINATOR_ESCAPES: Record<string, string> = {
  '\n': '\\n',
  '\r': '\\r',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
};
function sanitizeEnvelopeMessage(body: string): string {
  return body.replace(/[\n\r\u2028\u2029]/g, (c) => LINE_TERMINATOR_ESCAPES[c] as string);
}

/** 四键契约（v1-spec §7 表序冻结：lang, version, id, text）。 */
const ENVELOPE_KEYS = [
  { key: 'lang', expect: 'string' },
  { key: 'version', expect: 'number' },
  { key: 'id', expect: 'string' },
  { key: 'text', expect: 'string' },
] as const;

/** 恰四键集合（由 ENVELOPE_KEYS 派生——四键契约单源，不重复手写键名；issue #72 ENV-5 用）。 */
const ENVELOPE_KEY_SET = new Set<string>(ENVELOPE_KEYS.map((entry) => entry.key));

export type EnvelopeShapeResult =
  | { ok: true; envelope: SchemaEnvelope }
  | { ok: false; issues: SchemaEnvelopeIssue[] };

/**
 * §3 形状校验：输入门（ENV-1 早出单条）→ 四键 own-key + typeof 扫描（ENV-2/ENV-3
 * 同类聚合、并行全收集，至多 2 条）→ 恰四键回显（§3.4：重建新对象，多余键不夹带；
 * 防御性副本；单读物化——getter 首读值即校验与回显共用值，SA2 NOTE-a）。
 */
export function validateEnvelopeShape(input: unknown): EnvelopeShapeResult {
  // §3.1 输入门（早出，单条 ENV-1）：原始值 / null / undefined / 函数
  if (typeof input !== 'object' || input === null) {
    return {
      ok: false,
      issues: [
        makeEnvelopeIssue(
          EnvelopeErrCode.ENV_1,
          `信封必须是对象（{ lang, version, id, text } 四键），实际收到 ${
            input === null ? 'null' : typeof input
          }`,
        ),
      ],
    };
  }
  // §3.1 数组单列（不并入「缺四键」：确定性诊断是形状类型错了而非键缺失）
  if (Array.isArray(input)) {
    return {
      ok: false,
      issues: [
        makeEnvelopeIssue(
          EnvelopeErrCode.ENV_1,
          `信封必须是对象（{ lang, version, id, text } 四键），实际收到数组（长度 ${input.length}）`,
        ),
      ],
    };
  }

  // §3.2/§3.3：四键 own-key（Object.hasOwn，不用 in——原型链来源拒绝）存在性 →
  // typeof 匹配；缺键与类型错并行全收集，键各有独立判定，信息不丢。单读物化：
  // 读取一次存入局部表，校验与回显共用（敌意 getter 两次读值不一致无法进入回显）。
  const src = input as Record<string, unknown>;
  const values: Record<string, unknown> = {};
  const missing: string[] = [];
  const typeErrors: string[] = [];
  for (const { key, expect } of ENVELOPE_KEYS) {
    if (!Object.hasOwn(src, key)) {
      missing.push(key);
      continue;
    }
    const value = src[key];
    values[key] = value;
    if (typeof value !== expect) {
      typeErrors.push(`${key} 应为 ${expect}，实际 ${typeof value}`);
    }
  }
  if (missing.length > 0 || typeErrors.length > 0) {
    const issues: SchemaEnvelopeIssue[] = [];
    if (missing.length > 0) {
      issues.push(
        makeEnvelopeIssue(
          EnvelopeErrCode.ENV_2,
          `信封缺少必需键: ${missing.join('、')}（信封四键契约: lang, version, id, text）`,
        ),
      );
    }
    if (typeErrors.length > 0) {
      issues.push(
        makeEnvelopeIssue(EnvelopeErrCode.ENV_3, `信封键类型错误: ${typeErrors.join('；')}`),
      );
    }
    return { ok: false, issues };
  }

  // §3.4 恰四键回显：重建新对象而非引用输入（多余键不夹带；防御性副本；四值恒
  // primitive 无别名问题）。`as` 收窄由前置 typeof 判定背书。
  return {
    ok: true,
    envelope: {
      lang: values.lang as string,
      version: values.version as number,
      id: values.id as string,
      text: values.text as string,
    },
  };
}

/**
 * §4 方言路由：复用 assertVfslDialect（断言语义单点冻结资产，schemasource.ts:93-103），
 * `SchemaSourceError('dialect-mismatch')` 就地转译 ENV-4；非方言断言异常原样上抛
 * （落 §5 顶层崩溃边界 ENV-100）。重写判定会分叉决策点——未来 v2 方言只增不改时漏改
 * 一处即静默错误解释。
 */
export function dialectIssueOrNull(envelope: SchemaEnvelope): SchemaEnvelopeIssue | null {
  try {
    assertVfslDialect(envelope);
    return null;
  } catch (err) {
    if (err instanceof SchemaSourceError && err.code === 'dialect-mismatch') {
      return makeEnvelopeIssue(
        EnvelopeErrCode.ENV_4,
        `未知方言（只读 loud-fail，不解释 text）: ${err.message}`,
        true,
      );
    }
    throw err;
  }
}

/**
 * H1 编排前缀（形状 → 方言）单点（issue #54 / H3，D5）：validateEnvelopeShape
 * （ENV-1/2/3）→ dialectIssueOrNull（ENV-4）→ 成功交回**恰四键回显信封**（含 text）。
 * parseSchemaEnvelope（index.ts）与 getCompiled 编译缓存前探共用——校验决策点
 * 单源，信封命中路径得以免重复 parseVfsl（ADR-0001「性能依赖编译缓存」）。
 * 纯函数；可能因对抗 getter/Proxy 抛出（由各公共入口的崩溃边界收编 ENV-100）。
 */
export function envelopeTextGate(
  input: unknown,
): { ok: true; envelope: SchemaEnvelope } | { ok: false; issues: SchemaParseIssue[] } {
  const shape = validateEnvelopeShape(input); // ENV-1 / ENV-2+3（单读物化）
  if (!shape.ok) {
    return { ok: false, issues: shape.issues.map((issue) => ({ kind: 'envelope' as const, issue })) };
  }
  const dialect = dialectIssueOrNull(shape.envelope); // ENV-4（assertVfslDialect 单点复用）
  if (dialect !== null) {
    return { ok: false, issues: [{ kind: 'envelope', issue: dialect }] };
  }
  return { ok: true, envelope: shape.envelope };
}

/**
 * #72 严格编译前缀单点（形状 → 封闭 → 方言，设计 §3/§5）：validateEnvelopeShape 复用
 * （ENV-1/2/3，同类聚合 + 单读物化）→ 编译入口单 issue 坍缩（首条即全部：ENV-2 优先
 * 于 ENV-3，设计 §3.2）→ 严格封闭 ENV-5（own 字符串键恰为四键，含不可枚举；symbol
 * 键不在数据面，设计 §3.4）→ dialectIssueOrNull 复用（ENV-4）。
 * 与 envelopeTextGate（H1 容忍门）的差异面恰为 #72 的 AC 增量（恰四键 + 恒单条），
 * 见设计 §3.5——两门共享底层决策点（validateEnvelopeShape + assertVfslDialect），
 * 差异是两票各自冻结的契约而非实现漂移。
 * 纯函数；对抗 getter/Proxy 可抛出——由公共入口（compileSchemaEnvelope）顶层崩溃
 * 边界收编 ENV-100。
 */
export function envelopeStrictGate(
  input: unknown,
): { ok: true; envelope: SchemaEnvelope } | { ok: false; issues: SchemaParseIssue[] } {
  // ① 形状（ENV-1 早出 / ENV-2+3 同类聚合）——复用 H1 扫描单点
  const shape = validateEnvelopeShape(input);
  if (!shape.ok) {
    // ② 编译入口单 issue 坍缩：首条即全部（ENV-2 优先于 ENV-3，设计 §3.2）；类内
    //    信息不丢——ENV-2/ENV-3 消息各自列全该类全部问题（既有聚合消息）
    const first = shape.issues[0] as SchemaEnvelopeIssue;
    return { ok: false, issues: [{ kind: 'envelope', issue: first }] };
  }
  // ③ 严格封闭（ENV-5）：own 字符串键（含不可枚举；symbol 键不在数据面，设计 §3.4）
  //    恰为四键——形状通过后 input 必为非 null 非数组对象（ENV-1 早出保证）
  const extra = Object.getOwnPropertyNames(input as object).filter(
    (key) => !ENVELOPE_KEY_SET.has(key),
  );
  if (extra.length > 0) {
    return {
      ok: false,
      issues: [
        {
          kind: 'envelope',
          issue: makeEnvelopeIssue(
            EnvelopeErrCode.ENV_5,
            `信封多余键: ${extra.join('、')}（严格封闭：恰含 lang, version, id, text 四键）`,
          ),
        },
      ],
    };
  }
  // ④ 方言（ENV-4）——复用断言单点
  const dialect = dialectIssueOrNull(shape.envelope);
  if (dialect !== null) {
    return { ok: false, issues: [{ kind: 'envelope', issue: dialect }] };
  }
  return { ok: true, envelope: shape.envelope };
}

/** kind:'vfsl' 包装单点（原 index.ts 内联 map 提出共用，语义零变）。 */
export function vfslIssues(issues: VfslIssue[]): SchemaParseIssue[] {
  return issues.map((issue) => ({ kind: 'vfsl' as const, issue }));
}

/**
 * §6.1 崩溃边界 issue（顶层 catch 收编用；detail 经唯一构造点 sanitizer 单行化）。
 *
 * F1 修复（SA4 R1 reject）：detail 计算自身可抛——对抗 getter/Proxy 可抛出**不可
 * 字符串化**的 thrown 值（`Object.create(null)`、`{toString:42}` 等），`instanceof`
 * / `err.message` / `String(err)`（ToPrimitive → toString）在 catch 块内部二次抛出，
 * 无外层守卫即逃逸出 parseSchemaEnvelope，击穿「绝不外抛」契约。修复：detail 计算
 * 包 try/catch 守卫，二次异常降为确定性占位正文（含 thrown 值 typeof），仍经
 * makeEnvelopeIssue 单行净化——崩溃边界在任何对抗输入下都产出结构化 ENV-100。
 */
export function envelopeCrashIssue(err: unknown): SchemaEnvelopeIssue {
  const detail = crashDetail(err);
  return makeEnvelopeIssue(EnvelopeErrCode.ENV_100, `内部错误（意外异常）: ${detail}`);
}

/**
 * 崩溃 detail 计算守卫（F1 修复，模块内部）：`instanceof`/`err.message`/`String(err)`
 * 任一步抛（原型伪装 Error 的 message getter、不可字符串化 thrown 值）→ 确定性占位
 * 正文。占位正文静态可判定（无动态值），sanitizer 单行化对其恒为幂等。
 */
function crashDetail(err: unknown): string {
  try {
    return err instanceof Error ? err.message : String(err);
  } catch {
    return `不可字符串化的异常值（${typeof err}）`;
  }
}

/** 公共接缝返回形状（index.ts 经此 re-export）。 */
export type ParseSchemaEnvelopeResult =
  | { ok: true; envelope: SchemaEnvelope; module: VfslModule }
  | { ok: false; issues: SchemaParseIssue[] };
