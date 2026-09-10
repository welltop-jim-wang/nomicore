/**
 * REST 错误契约（ADR 0015 §错误契约 L163–174）——**包内私有**模块：不进
 * `package.json` exports，也不从 `src/index.ts` re-export。
 *
 * 单一定义点：
 * - 稳定 problem code 词表（客户端只按 `code` 分支；`INSTANCE_ROLE_FORBIDDEN` /
 *   `METHOD_NOT_ALLOWED` 为 #267 在树冻结值，逐字保持）；
 * - 固定 problem shape 构造器：键集 ⊆ `{code, message, issues?, issuesTruncated?}`，
 *   恒 `application/json`，`issuesTruncated` **仅在确实截断时出现**；
 * - 422 的 REST issue 映射（稳定 issue code、verbatim 定位透传、单条/总量 byte 预算
 *   与截断标记、byte 安全 message 截断）。
 *
 * 纪律：problem message 为固定人读文案，不携带源码位置（`position`/`line N`/
 * `column N`），也不回显任何输入片段；issue message 只透传底层诊断并在 UTF-8
 * codepoint 边界截断（ADR 0009 DQ-4：verbatim、不改写、不 sanitize）。
 */

/** 失败类别 → 稳定 problem code（ADR 0015 L165「客户端只按稳定 code 分支」）。 */
export const REST_PROBLEM_CODES = Object.freeze({
  /** 400：owner 段 percent-encoding 或不符合 Registry 安全文法。 */
  INVALID_OWNER: 'INVALID_OWNER',
  /** 400：首版不接受 query 参数。 */
  QUERY_PARAMETERS_NOT_SUPPORTED: 'QUERY_PARAMETERS_NOT_SUPPORTED',
  /** 400：无 body / 0 bytes。 */
  EMPTY_BODY: 'EMPTY_BODY',
  /** 400：平台 JSON 解析失败（通用文案，无源码位置）。 */
  MALFORMED_JSON: 'MALFORMED_JSON',
  /** 400：body bytes 不是合法 UTF-8（严格解码失败）。 */
  INVALID_BODY_ENCODING: 'INVALID_BODY_ENCODING',
  /** 400：顶层形状不合规（非 object/数组/键集/类型）。 */
  INVALID_REQUEST_SHAPE: 'INVALID_REQUEST_SHAPE',
  /** 400：非有限数或非安全整数。 */
  NUMBER_OUT_OF_RANGE: 'NUMBER_OUT_OF_RANGE',
  /** 403：Peer role gate（#267 冻结 code，逐字保持）。 */
  INSTANCE_ROLE_FORBIDDEN: 'INSTANCE_ROLE_FORBIDDEN',
  /** 405：已知 path 的非 POST（#267 在树 code，逐字保持）+ `Allow: POST`。 */
  METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',
  /** 413：body 超 `maxBodyBytes`。 */
  BODY_TOO_LARGE: 'BODY_TOO_LARGE',
  /** 413：schemaText 超 `maxSchemaTextBytes`（UTF-8 bytes）。 */
  SCHEMA_TEXT_TOO_LARGE: 'SCHEMA_TEXT_TOO_LARGE',
  /** 413：JSON depth 超 `maxJsonDepth`。 */
  JSON_DEPTH_EXCEEDED: 'JSON_DEPTH_EXCEEDED',
  /** 413：JSON nodes 超 `maxJsonNodes`。 */
  JSON_NODES_EXCEEDED: 'JSON_NODES_EXCEEDED',
  /** 415：Content-Type 缺失或不兼容。 */
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  /** 415：Content-Encoding 非缺失/`identity`。 */
  UNSUPPORTED_CONTENT_ENCODING: 'UNSUPPORTED_CONTENT_ENCODING',
  /** 422：VFSL schema invalid（derive 失败或 Registry `NAMESPACE_SCHEMA_INVALID`）。 */
  SCHEMA_INVALID: 'SCHEMA_INVALID',
  /** 422：ROOT 值 invalid（Registry `NAMESPACE_ROOT_INVALID`）。 */
  ROOT_INVALID: 'ROOT_INVALID',
} as const);

export type RestProblemCode = (typeof REST_PROBLEM_CODES)[keyof typeof REST_PROBLEM_CODES];

/** 本票定义映射的 HTTP 状态（503/500 族属后续票，维持 rejection）。 */
export type RestProblemStatus = 400 | 403 | 405 | 413 | 415 | 422;

/** problem message 固定文案（人读；不承诺逐字稳定，ADR 0015 L165）。 */
export const REST_PROBLEM_MESSAGES: Readonly<Record<RestProblemCode, string>> = Object.freeze({
  INVALID_OWNER: 'owner 段不符合安全文法或不允许 percent-encoding',
  QUERY_PARAMETERS_NOT_SUPPORTED: '首版不接受 query 参数',
  EMPTY_BODY: '请求 body 为空',
  MALFORMED_JSON: 'JSON 解析失败',
  INVALID_BODY_ENCODING: 'body 不是合法的 UTF-8 编码',
  INVALID_REQUEST_SHAPE: '请求形状非法：顶层必须恰好包含 schemaText 与 root',
  NUMBER_OUT_OF_RANGE: 'JSON 数字超出允许范围',
  INSTANCE_ROLE_FORBIDDEN: 'Peer role 不允许 create',
  METHOD_NOT_ALLOWED: '已知 path 只接受 POST',
  BODY_TOO_LARGE: 'body 超出大小上限',
  SCHEMA_TEXT_TOO_LARGE: 'schemaText 超出大小上限',
  JSON_DEPTH_EXCEEDED: 'JSON 深度超出上限',
  JSON_NODES_EXCEEDED: 'JSON 节点数超出上限',
  UNSUPPORTED_MEDIA_TYPE: 'Content-Type 必须是 application/json（仅可带 charset=utf-8）',
  UNSUPPORTED_CONTENT_ENCODING: 'Content-Encoding 只接受缺失或 identity',
  SCHEMA_INVALID: 'VFSL schema 校验失败',
  ROOT_INVALID: 'ROOT 值校验失败',
});

/** 受控 REST issue（ADR 0015 L165：稳定 code + 可选 line/column 或 path + 安全 message）。 */
export interface RestIssue {
  readonly code: string;
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
  readonly path?: readonly (string | number)[];
}

/** 固定 problem shape（未知顶层键禁止；`issuesTruncated` 仅在截断时出现）。 */
export interface RestProblemPayload {
  readonly code: RestProblemCode;
  readonly message: string;
  readonly issues?: readonly RestIssue[];
  readonly issuesTruncated?: boolean;
}

/** 内部失败信号：step 4/5 的 4xx/413 结算经此携带 problem payload。 */
export class RestProblemFailure extends Error {
  readonly status: RestProblemStatus;
  readonly payload: RestProblemPayload;

  constructor(status: RestProblemStatus, payload: RestProblemPayload) {
    super(payload.message);
    this.name = 'RestProblemFailure';
    this.status = status;
    this.payload = payload;
  }
}

/** 构造 problem 失败信号（未给 message 时用固定文案）。 */
export function createRestProblemFailure(
  status: RestProblemStatus,
  code: RestProblemCode,
  options: {
    readonly message?: string;
    readonly issues?: readonly RestIssue[];
    readonly issuesTruncated?: boolean;
  } = {},
): RestProblemFailure {
  return new RestProblemFailure(status, {
    code,
    message: options.message ?? REST_PROBLEM_MESSAGES[code],
    ...(options.issues === undefined ? {} : { issues: options.issues }),
    ...(options.issuesTruncated === true ? { issuesTruncated: true } : {}),
  });
}

/**
 * 从 problem payload 构造 Response：恒 `application/json`；`issues` 仅在存在时输出、
 * `issuesTruncated` 仅在 `true` 时输出（不发明 `false`）。`extraHeaders` 用于 405 的
 * `Allow: POST`（#267 冻结行为）。
 */
export function problemResponse(
  status: RestProblemStatus,
  payload: RestProblemPayload,
  extraHeaders?: Readonly<Record<string, string>>,
): Response {
  const body: Record<string, unknown> = { code: payload.code, message: payload.message };
  if (payload.issues !== undefined) body['issues'] = payload.issues;
  if (payload.issuesTruncated === true) body['issuesTruncated'] = true;
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...extraHeaders },
  });
}

// —— UTF-8 byte 工具（budget / 截断共用） ——

const UTF8_ENCODER = new TextEncoder();

/** UTF-8 byte 长度（非 UTF-16 code unit 数）。 */
export function utf8ByteLength(value: string): number {
  return UTF8_ENCODER.encode(value).length;
}

/**
 * 按 UTF-8 codepoint 边界截断到 ≤ `maxBytes` 且非空：首个 codepoint 即超上限时以
 * 单字节 ASCII `?` 兜底（保证「非空 + ≤ 上限」恒成立）。
 */
export function truncateToUtf8Bytes(value: string, maxBytes: number): string {
  if (utf8ByteLength(value) <= maxBytes) return value;
  let truncated = '';
  let used = 0;
  for (const character of value) {
    const size = utf8ByteLength(character);
    if (used + size > maxBytes) break;
    truncated += character;
    used += size;
  }
  return truncated.length > 0 ? truncated : '?';
}

// —— 422 issues 映射（来源族 → 稳定 issue code + verbatim 定位 + 双预算） ——

/** issue 来源族：derive/Registry `NAMESPACE_SCHEMA_INVALID` 或 `NAMESPACE_ROOT_INVALID`。 */
export type RestIssueSource = 'schema' | 'root';

export interface RestIssueBudgets {
  readonly maxIssues: number;
  readonly maxIssueMessageBytes: number;
  readonly maxIssuesTotalBytes: number;
}

export interface MappedRestIssues {
  readonly issues: readonly RestIssue[];
  readonly issuesTruncated: boolean;
}

const ISSUE_CODES: Readonly<Record<RestIssueSource, string>> = Object.freeze({
  schema: 'SCHEMA_ISSUE',
  root: 'ROOT_ISSUE',
});

/** 底层 issue 形状不可识别时的占位 message（仍受 byte 预算，不泄露输入）。 */
const ISSUE_PLACEHOLDERS: Readonly<Record<RestIssueSource, string>> = Object.freeze({
  schema: 'schema 校验失败',
  root: 'ROOT 值校验失败',
});

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

/**
 * 底层 issue 定位的防御式提取：`line`/`column` 成对正整数优先，否则 verbatim
 * `path`（恰为 `(string | number)[]` 时）；两者互斥，形状不符则降级为无定位 issue。
 */
function readIssueLocation(
  raw: Record<string, unknown>,
): { line: number; column: number } | { path: readonly (string | number)[] } | undefined {
  const line = raw['line'];
  const column = raw['column'];
  if (isPositiveInteger(line) && isPositiveInteger(column)) return { line, column };
  const path = raw['path'];
  if (Array.isArray(path)) {
    const segments = path as readonly unknown[];
    if (segments.every((segment) => typeof segment === 'string' || typeof segment === 'number')) {
      return { path: segments as readonly (string | number)[] };
    }
  }
  return undefined;
}

/**
 * 映射底层 issues（Schema 族 `VfslIssue` 或 ROOT 族 `ValidateIssue`）为受控 REST issues。
 *
 * 预算规则：`issues.length < maxIssues` 且（首条无条件保留 || 已累计 message bytes +
 * 本条 ≤ `maxIssuesTotalBytes`）；首条 message 额外受 `maxIssuesTotalBytes` 封顶
 * （极端小预算下仍保证非空）。任一预算停止 → `issuesTruncated: true`。
 */
export function mapRestIssues(
  source: RestIssueSource,
  rawIssues: readonly unknown[],
  budgets: RestIssueBudgets,
): MappedRestIssues {
  const code = ISSUE_CODES[source];
  const placeholder = ISSUE_PLACEHOLDERS[source];
  const firstMessageBudget = Math.min(budgets.maxIssueMessageBytes, budgets.maxIssuesTotalBytes);
  const issues: RestIssue[] = [];
  let accumulatedBytes = 0;
  let issuesTruncated = false;
  for (const raw of rawIssues) {
    const isFirst = issues.length === 0;
    if (!isFirst && issues.length >= budgets.maxIssues) {
      issuesTruncated = true;
      break;
    }
    const rawMessage =
      isPlainRecord(raw) && typeof raw['message'] === 'string' && raw['message'].length > 0
        ? raw['message']
        : placeholder;
    const message = truncateToUtf8Bytes(
      rawMessage,
      isFirst ? firstMessageBudget : budgets.maxIssueMessageBytes,
    );
    const messageBytes = utf8ByteLength(message);
    if (!isFirst && accumulatedBytes + messageBytes > budgets.maxIssuesTotalBytes) {
      issuesTruncated = true;
      break;
    }
    const location = isPlainRecord(raw) ? readIssueLocation(raw) : undefined;
    issues.push({
      code,
      message,
      ...(location ?? {}),
    });
    accumulatedBytes += messageBytes;
  }
  return { issues, issuesTruncated };
}
