/**
 * SA6 验收契约 fixture/harness — issue #268（REST create 入站校验、资源 limits 与
 * 4xx/422 problem 契约）。非 `*.test.ts`，不被 vitest 收集；只承载共享 fixture、
 * 请求构造与 **problem shape 运行时校验器**。
 *
 * 边界纪律（与 `rest-contract-harness.ts` 同款）：
 * - 不 mock 被测 seam：所有请求走真实 `Request` → `createRestRouter().handle()`；需要
 *   Registry 才能到达的分支（ROOT invalid）用真实 MemoryPersistence + 真实 Registry
 *   testing 入口；不需要触达 Registry 的分支（owner/query/media/body/limits/schema
 *   invalid）一律用 `createPoisonRegistry()`（任何成员调用即 throw），把「零 Registry
 *   触达」变成断言可观测的事实。
 * - problem shape 校验器只观察运行时 response（状态、头、JSON body 形状），不读源码、
 *   不做字符串源码断言。
 *
 * 契约假设（PROPOSAL，待 SA1/SA2 仲裁；见 SA6 报告 §12.1）：
 * - H5：错误 response 固定 problem shape = `{ code, message }` + 可选
 *   `issues` / `issuesTruncated`（未知顶层键不允许）；
 * - H6：客户端可分支的稳定 `code` 与失败类别一一对应（本 harness 的 scenario 表把
 *   「类别」固化为可执行矩阵；具体 code 词表归设计，断言只锁可分性/稳定性/格式）；
 * - H7：REST issue = `{ code, message }` + 可选 `line`/`column`（正整数对）或
 *   `path`（`(string|number)[]`），message 受 UTF-8 byte 上限约束。
 */
import type { NamespaceRegistry } from '@nomicore/namespace-registry';
import {
  createRestRouter,
  type RestRouter,
  type RestRouterLimits,
  type RestRouterOptions,
} from '../src/rest.js';
import {
  CREATE_URL,
  ROOT_VALUE,
  SCHEMA_TEXT,
  createContractRegistry,
  createMemoryFixture,
  createPoisonRegistry,
  type PersistenceFixture,
} from './rest-contract-harness.js';

export { CREATE_PATH, CREATE_URL, OWNER_USER_ID, ROOT_VALUE, SCHEMA_TEXT } from './rest-contract-harness.js';
export type { RestRouterLimits, RestRouterOptions } from '../src/rest.js';

export const NOOP_OBSERVER = (): void => {};

/** 真实 MemoryPersistence + Registry testing 入口的受控 fixture（仅 422/201 分支需要）。 */
export async function withRealRegistry<T>(
  run: (registry: NamespaceRegistry, fixture: PersistenceFixture) => Promise<T>,
): Promise<T> {
  const fixture = await createMemoryFixture();
  const registry = createContractRegistry(fixture.persistence);
  try {
    return await run(registry, fixture);
  } finally {
    await registry.shutdown();
    await fixture.dispose();
    await fixture.cleanup();
  }
}

// —— 构造入口 ——

export function hubRouter(registry: NamespaceRegistry, limits?: RestRouterLimits): RestRouter {
  const base = {
    role: 'hub' as const,
    registry,
    metricsObserver: NOOP_OBSERVER,
    diagnosticObserver: NOOP_OBSERVER,
  };
  return limits === undefined ? createRestRouter(base) : createRestRouter({ ...base, limits });
}

/** Peer router（role gate 先于 step 3/4）：用于 403 problem shape 断言。 */
export function peerRouter(registry: NamespaceRegistry): RestRouter {
  return createRestRouter({
    role: 'peer',
    registry,
    metricsObserver: NOOP_OBSERVER,
    diagnosticObserver: NOOP_OBSERVER,
  });
}

/** 仅供「构造配置门」负向用例：把任意 unknown 当 limits 注入（不经过类型系统伪装合法）。 */
export function hubRouterWithUntypedLimits(registry: NamespaceRegistry, limits: unknown): RestRouter {
  return createRestRouter({
    role: 'hub',
    registry,
    metricsObserver: NOOP_OBSERVER,
    diagnosticObserver: NOOP_OBSERVER,
    limits,
  } as unknown as RestRouterOptions);
}

// —— 契约输入常量（VFSL / JSON 边界 fixture）——

/** ROOT 必须是 map 形（VFSL-E311），故数值/深层结构一律挂在字段上。 */
export const NUMBER_SCHEMA_TEXT = 'type ROOT = { n: number };';
export const UNKNOWN_FIELD_SCHEMA_TEXT = 'type ROOT = { v: unknown };';
export const NUMBER_ARRAY_SCHEMA_TEXT = 'type ROOT = { v: number[] };';
export const TWO_FIELD_SCHEMA_TEXT = 'type ROOT = { a: string; b: string };';

/** deriveSchemaIdentity ok、但 ROOT 值类型不匹配（ROOT 领域 422 的输入）。 */
export const ROOT_MISMATCH_ROOT = Object.freeze({ n: 'not-a-number' });

/** 未知名引用：derive 失败（E301），message 远超默认 1024-byte 上限。 */
export const LONG_UNKNOWN_REF_SCHEMA_TEXT = `type ROOT = { a: ${'Z'.repeat(1500)} };`;

/** 字段名长度参数化：150×1 用于默认 maxIssues=100；70×1100 用于默认 issues 总预算 64 KiB。 */
export function manyFieldsSchemaText(count: number, nameLength: number): string {
  const fields = Array.from(
    { length: count },
    (_, index) => `${'f'.repeat(nameLength)}${index}: string;`,
  ).join(' ');
  return `type ROOT = { ${fields} };`;
}

/** 恰好 `targetBytes` UTF-8 bytes 的合法 VFSL 文本（注释填充，语义等价基础 schema）。 */
export function exactByteSchemaText(targetBytes: number): string {
  const head = `${SCHEMA_TEXT}// `;
  const padded = head.length + 1;
  if (targetBytes < padded) throw new Error(`exactByteSchemaText 最小长度 ${padded}，请求 ${targetBytes}`);
  return `${head}${'a'.repeat(targetBytes - padded)}\n`;
}

/** 原始 JSON body 请求（不经过 JSON.stringify，可构造 malformed / 重复 key / `-0` 字面量）。 */
export function rawJsonRequest(url: string, rawBody: string, headers?: Record<string, string>): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: rawBody,
  });
}

/** 合法 JSON body 请求（可被 headers 覆盖内容类型；覆盖时若给出空对象则不设 content-type）。 */
export function jsonBodyRequest(
  url: string,
  body: unknown,
  headers?: Record<string, string>,
): Request {
  const resolved = headers === undefined ? { 'content-type': 'application/json' } : headers;
  return new Request(url, {
    method: 'POST',
    headers: resolved,
    body: JSON.stringify(body),
  });
}

/** 无 body 请求（body 为 null 的 Web Request）。 */
export function bodylessRequest(url: string, headers?: Record<string, string>): Request {
  return new Request(url, {
    method: 'POST',
    headers: headers === undefined ? { 'content-type': 'application/json' } : headers,
  });
}

/** 流式 body 请求：无 Content-Length，用于证明 byte 上限在 stream 上同样执行。 */
export function streamedJsonRequest(
  url: string,
  chunks: readonly Uint8Array[],
  headers?: Record<string, string>,
): Request {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Request(url, {
    method: 'POST',
    headers: headers === undefined ? { 'content-type': 'application/json' } : headers,
    body: stream,
    // Node/undici：流式 body 必须显式 duplex。
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
}

/** 深层嵌套原始 body（避免 JSON.stringify/构造深树的栈噪声；depth ≥ 1000 时后者会溢出）。 */
export function deepNestedRootRawBody(depth: number, innermostLiteral: string): string {
  return `{"schemaText":${JSON.stringify(UNKNOWN_FIELD_SCHEMA_TEXT)},"root":{"v":${'['.repeat(depth)}${innermostLiteral}${']'.repeat(depth)}}}`;
}

/** UTF-8 byte 长度（Node Buffer 与浏览器 TextEncoder 同语义，测试侧用 TextEncoder 保持同源）。 */
export function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

// —— problem shape（H5/H7）运行时校验器 ——

export interface RestIssueShape {
  readonly code: string;
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
  readonly path?: readonly (string | number)[];
}

export interface ProblemShape {
  readonly code: string;
  readonly message: string;
  readonly issues?: readonly RestIssueShape[];
  readonly issuesTruncated?: boolean;
}

export interface ProblemObservation {
  readonly status: number;
  readonly rawText: string;
  readonly body: ProblemShape;
}

export const PROBLEM_CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;

const PROBLEM_KEYS = new Set(['code', 'message', 'issues', 'issuesTruncated']);
const ISSUE_KEYS = new Set(['code', 'message', 'line', 'column', 'path']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 读取并校验错误 response 的固定 problem shape（状态 + content-type + 键集 + 类型）。
 * `maxIssueMessageBytes` 给出时同时校验每条 issue message 的 UTF-8 byte 上限。
 */
export async function observeProblem(
  response: Response,
  expectedStatus: number,
  maxIssueMessageBytes?: number,
): Promise<ProblemObservation> {
  if (response.status !== expectedStatus) {
    const preview = (await response.clone().text()).slice(0, 200);
    throw new Error(
      `契约违例：期望 HTTP ${expectedStatus}，实际 ${response.status}；body=${preview}`,
    );
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!/^application\/json\b/.test(contentType)) {
    throw new Error(`契约违例：错误 response content-type 应为 application/json，实际 ${contentType}`);
  }
  const rawText = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(`契约违例：错误 response 不是合法 JSON：${rawText.slice(0, 200)}`);
  }
  if (!isPlainObject(parsed)) {
    throw new Error('契约违例：错误 response body 必须是 JSON object');
  }
  for (const key of Object.keys(parsed)) {
    if (!PROBLEM_KEYS.has(key)) {
      throw new Error(`契约违例：problem shape 出现未知键 ${JSON.stringify(key)}`);
    }
  }
  const code = parsed['code'];
  const message = parsed['message'];
  if (typeof code !== 'string' || !PROBLEM_CODE_PATTERN.test(code)) {
    throw new Error(`契约违例：problem.code 必须是稳定 UPPER_SNAKE 字符串，实际 ${JSON.stringify(code)}`);
  }
  if (typeof message !== 'string' || message.length === 0) {
    throw new Error(`契约违例：problem.message 必须是非空字符串，实际 ${JSON.stringify(message)}`);
  }
  const rawIssues = parsed['issues'];
  let issues: RestIssueShape[] | undefined;
  if (rawIssues !== undefined) {
    if (!Array.isArray(rawIssues)) {
      throw new Error('契约违例：problem.issues 必须是数组');
    }
    issues = rawIssues.map((issue, index) => assertRestIssue(issue, index, maxIssueMessageBytes));
  }
  const rawTruncated = parsed['issuesTruncated'];
  if (rawTruncated !== undefined && typeof rawTruncated !== 'boolean') {
    throw new Error(`契约违例：issuesTruncated 必须是 boolean，实际 ${JSON.stringify(rawTruncated)}`);
  }
  const issuesTruncated = rawTruncated as boolean | undefined;
  if (issuesTruncated === true && issues === undefined) {
    throw new Error('契约违例：issuesTruncated=true 时必须携带 issues 数组');
  }
  return {
    status: response.status,
    rawText,
    body: {
      code,
      message,
      ...(issues === undefined ? {} : { issues }),
      ...(issuesTruncated === undefined ? {} : { issuesTruncated }),
    },
  };
}

/** 单条 REST issue 的受控形状（H7）：稳定 code、可选 line/column 对或 path。 */
export function assertRestIssue(
  value: unknown,
  index: number,
  maxMessageBytes?: number,
): RestIssueShape {
  if (!isPlainObject(value)) {
    throw new Error(`契约违例：issues[${index}] 必须是 JSON object`);
  }
  for (const key of Object.keys(value)) {
    if (!ISSUE_KEYS.has(key)) {
      throw new Error(`契约违例：issues[${index}] 出现未知键 ${JSON.stringify(key)}`);
    }
  }
  const code = value['code'];
  const message = value['message'];
  if (typeof code !== 'string' || !PROBLEM_CODE_PATTERN.test(code)) {
    throw new Error(`契约违例：issues[${index}].code 非稳定 UPPER_SNAKE 字符串：${JSON.stringify(code)}`);
  }
  if (typeof message !== 'string' || message.length === 0) {
    throw new Error(`契约违例：issues[${index}].message 必须是非空字符串`);
  }
  if (maxMessageBytes !== undefined && utf8Bytes(message) > maxMessageBytes) {
    throw new Error(
      `契约违例：issues[${index}].message ${utf8Bytes(message)} bytes 超过上限 ${maxMessageBytes}`,
    );
  }
  const line = value['line'];
  const column = value['column'];
  const path = value['path'];
  if ((line === undefined) !== (column === undefined)) {
    throw new Error(`契约违例：issues[${index}] 的 line/column 必须成对出现`);
  }
  if (line !== undefined) {
    if (!Number.isInteger(line) || (line as number) < 1) {
      throw new Error(`契约违例：issues[${index}].line 必须是正整数`);
    }
    if (!Number.isInteger(column) || (column as number) < 1) {
      throw new Error(`契约违例：issues[${index}].column 必须是正整数`);
    }
    if (path !== undefined) {
      throw new Error(`契约违例：issues[${index}] 不得同时携带 line/column 与 path`);
    }
  }
  if (path !== undefined) {
    if (!Array.isArray(path)) {
      throw new Error(`契约违例：issues[${index}].path 必须是数组`);
    }
    for (const segment of path) {
      if (typeof segment !== 'string' && typeof segment !== 'number') {
        throw new Error(`契约违例：issues[${index}].path 段必须是 string | number`);
      }
    }
  }
  return {
    code,
    message,
    ...(line === undefined ? {} : { line: line as number, column: column as number }),
    ...(path === undefined ? {} : { path: path as readonly (string | number)[] }),
  };
}

// —— 文本扫描辅助（泄露 / 源码位置断言）——

/** 迭代收集 JSON 值中所有 string 叶子（避免递归栈噪声）。 */
export function collectStringLeaves(value: unknown): string[] {
  const out: string[] = [];
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current === 'string') {
      out.push(current);
    } else if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
    } else if (isPlainObject(current)) {
      for (const item of Object.values(current)) stack.push(item);
    }
  }
  return out;
}

/** 断言 response 文本不包含任何 secret 子串（schema/root 片段零泄露）。 */
export function assertNoSecrets(rawText: string, secrets: readonly string[]): void {
  for (const secret of secrets) {
    if (secret.length === 0) continue;
    if (rawText.includes(secret)) {
      throw new Error(`契约违例：错误 response 泄露输入片段 ${JSON.stringify(secret.slice(0, 60))}`);
    }
  }
}

export function makeSchemaSentinel(schemaText: string, sentinel: string): string {
  return `// ${sentinel}\n${schemaText}`;
}

export function makeRootSentinel(schemaText: string, field: string, sentinel: string): string {
  return JSON.stringify({ schemaText, root: { [field]: sentinel } });
}

// —— 失败类别 scenario 矩阵（H6：code 与失败类别一一对应、可被客户端分支）——

export type FailureScenarioKey =
  | 'invalid-owner'
  | 'query-parameter'
  | 'empty-body'
  | 'malformed-json'
  | 'request-shape'
  | 'number-range'
  | 'unsupported-media-type'
  | 'unsupported-content-encoding'
  | 'body-too-large'
  | 'schema-text-too-large'
  | 'json-depth-exceeded'
  | 'json-nodes-exceeded'
  | 'schema-invalid'
  | 'root-invalid';

export interface FailureScenarioSpec {
  readonly key: FailureScenarioKey;
  readonly expectedStatus: 400 | 413 | 415 | 422;
  /** 该类别必须与其它类别给出不同稳定 code（客户端只按 code 分支）。 */
  readonly distinctCode: true;
}

export const FAILURE_SCENARIOS: readonly FailureScenarioSpec[] = [
  { key: 'invalid-owner', expectedStatus: 400, distinctCode: true },
  { key: 'query-parameter', expectedStatus: 400, distinctCode: true },
  { key: 'empty-body', expectedStatus: 400, distinctCode: true },
  { key: 'malformed-json', expectedStatus: 400, distinctCode: true },
  { key: 'request-shape', expectedStatus: 400, distinctCode: true },
  { key: 'number-range', expectedStatus: 400, distinctCode: true },
  { key: 'unsupported-media-type', expectedStatus: 415, distinctCode: true },
  { key: 'unsupported-content-encoding', expectedStatus: 415, distinctCode: true },
  { key: 'body-too-large', expectedStatus: 413, distinctCode: true },
  { key: 'schema-text-too-large', expectedStatus: 413, distinctCode: true },
  { key: 'json-depth-exceeded', expectedStatus: 413, distinctCode: true },
  { key: 'json-nodes-exceeded', expectedStatus: 413, distinctCode: true },
  { key: 'schema-invalid', expectedStatus: 422, distinctCode: true },
  { key: 'root-invalid', expectedStatus: 422, distinctCode: true },
];

export interface ScenarioEnv {
  readonly router: RestRouter;
  readonly request: Request;
  readonly teardown: () => Promise<void>;
}

const NO_TEARDOWN = async (): Promise<void> => {};

/**
 * 构造失败类别场景。凡在 step 6（derive）之前必须失败的类别一律用 poison registry，
 * 把「零 Registry 触达」变成断言可观测事实；仅 `root-invalid` 需要真实 Registry。
 */
export async function buildFailureScenario(key: FailureScenarioKey): Promise<ScenarioEnv> {
  switch (key) {
    case 'invalid-owner':
      return {
        router: hubRouter(createPoisonRegistry()),
        request: jsonBodyRequest('http://localhost/v1/owners/%61lice/namespaces', {
          schemaText: SCHEMA_TEXT,
          root: ROOT_VALUE,
        }),
        teardown: NO_TEARDOWN,
      };
    case 'query-parameter':
      return {
        router: hubRouter(createPoisonRegistry()),
        request: jsonBodyRequest(`${CREATE_URL}?page=1`, { schemaText: SCHEMA_TEXT, root: ROOT_VALUE }),
        teardown: NO_TEARDOWN,
      };
    case 'empty-body':
      return {
        router: hubRouter(createPoisonRegistry()),
        request: bodylessRequest(CREATE_URL),
        teardown: NO_TEARDOWN,
      };
    case 'malformed-json':
      return {
        router: hubRouter(createPoisonRegistry()),
        request: rawJsonRequest(CREATE_URL, '{"schemaText": "type ROOT = { title: string };", '),
        teardown: NO_TEARDOWN,
      };
    case 'request-shape':
      return {
        router: hubRouter(createPoisonRegistry()),
        request: rawJsonRequest(CREATE_URL, '[]'),
        teardown: NO_TEARDOWN,
      };
    case 'number-range':
      return {
        router: hubRouter(createPoisonRegistry()),
        request: rawJsonRequest(
          CREATE_URL,
          `{"schemaText":${JSON.stringify(NUMBER_SCHEMA_TEXT)},"root":{"n":9007199254740993}}`,
        ),
        teardown: NO_TEARDOWN,
      };
    case 'unsupported-media-type':
      return {
        router: hubRouter(createPoisonRegistry()),
        request: jsonBodyRequest(
          CREATE_URL,
          { schemaText: SCHEMA_TEXT, root: ROOT_VALUE },
          { 'content-type': 'text/plain' },
        ),
        teardown: NO_TEARDOWN,
      };
    case 'unsupported-content-encoding':
      return {
        router: hubRouter(createPoisonRegistry()),
        request: jsonBodyRequest(
          CREATE_URL,
          { schemaText: SCHEMA_TEXT, root: ROOT_VALUE },
          { 'content-type': 'application/json', 'content-encoding': 'gzip' },
        ),
        teardown: NO_TEARDOWN,
      };
    case 'body-too-large':
      return {
        router: hubRouter(createPoisonRegistry(), { maxBodyBytes: 64, maxSchemaTextBytes: 16 }),
        request: rawJsonRequest(CREATE_URL, `{"pad":"${'x'.repeat(128)}"}`),
        teardown: NO_TEARDOWN,
      };
    case 'schema-text-too-large':
      return {
        router: hubRouter(createPoisonRegistry(), { maxSchemaTextBytes: 32 }),
        request: jsonBodyRequest(CREATE_URL, { schemaText: 'a'.repeat(64), root: {} }),
        teardown: NO_TEARDOWN,
      };
    case 'json-depth-exceeded':
      return {
        router: hubRouter(createPoisonRegistry()),
        request: rawJsonRequest(CREATE_URL, deepNestedRootRawBody(100, '0')),
        teardown: NO_TEARDOWN,
      };
    case 'json-nodes-exceeded':
      return {
        router: hubRouter(createPoisonRegistry(), { maxJsonNodes: 10 }),
        request: jsonBodyRequest(CREATE_URL, {
          schemaText: NUMBER_ARRAY_SCHEMA_TEXT,
          root: { v: Array.from({ length: 40 }, (_, index) => index) },
        }),
        teardown: NO_TEARDOWN,
      };
    case 'schema-invalid':
      return {
        router: hubRouter(createPoisonRegistry()),
        request: jsonBodyRequest(CREATE_URL, { schemaText: 'type ROOT = {', root: {} }),
        teardown: NO_TEARDOWN,
      };
    case 'root-invalid': {
      const fixture: PersistenceFixture = await createMemoryFixture();
      const registry = createContractRegistry(fixture.persistence);
      return {
        router: hubRouter(registry),
        request: jsonBodyRequest(CREATE_URL, { schemaText: TWO_FIELD_SCHEMA_TEXT, root: {} }),
        teardown: async () => {
          await registry.shutdown();
          await fixture.dispose();
          await fixture.cleanup();
        },
      };
    }
  }
}
