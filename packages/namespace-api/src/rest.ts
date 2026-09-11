/**
 * @nomicore/namespace-api/rest —— 公共 REST router 面（ADR 0015 §模块与装配 L18–32）。
 *
 * Host 无关的普通 Module（**不是** Cordis plugin）：标准 Web `Request → Response` +
 * 判别结果表达 route 是否匹配；不拥有 listener、authentication、authorization、
 * CORS、TLS、Request ID、全局并发或 graceful drain——这些属于未来 server/composition
 * root（FR-5）。除构造期冻结配置外 router 零状态（无队列、无锁、无定时器、无缓存）。
 *
 * **role 单真相（SA8 B-1 / ADR 0012）**：`RestRouterOptions.role` 的值必须由
 * composition root 从 Instance service（`instanceId + role` 唯一生产来源）读取后注入；
 * 禁止从环境变量、第二份配置文件或 router 内部默认值产生。本包内零 role 默认值、
 * 零独立 role 配置源；类型只认 `InstanceRole` 联合（自 `@nomicore/namespace-registry`
 * 公共 re-export 导入，与 `@nomicore/instance` 同一联合）。
 *
 * **切片边界（#267 骨架 → #268 入站校验 → #269 失败语义/取消/观测）**：step 1–2（route/
 * method 匹配 + role gate）与 step 6–10 的成功路径来自 #267；#268 叠加 step 3（owner/
 * query/Content-Type/Encoding 检查）与 step 4–5（有界读取 + 严格 UTF-8 + 平台 JSON +
 * 形状/资源检查 + limits），4xx/422 一律经 `./rest-problem.js` 构造固定 problem shape；
 * #269 叠加 **Registry 失败映射**（503 / 500 `NAMESPACE_CREATE_FAILED` / 500
 * `NAMESPACE_CREATE_OUTCOME_UNKNOWN` / 500 `INTERNAL_ERROR`）、**body 读取阶段的
 * `Request.signal` 取消边界**（中断以有界 `handle` rejection 结算，Registry 零触达）
 * 与 **observer 事件发射**（metrics 低基数事件 / diagnostic 三类事件，ADR 0015
 * L186–190）。仍未映射的窄 issue（如 `NAMESPACE_INVALID_IDENTITY`）保持 `handle`
 * rejection；metrics `rejected` outcome 的发射策略（含 4xx/422 族）归后续票。
 * 读取段内 abort 优先于 413 的排序不变量由 `src/create-namespace.ts` 的共享读取 seam 保证。
 */
import type { InstanceRole, NamespaceRegistry } from '@nomicore/namespace-registry';
import { orchestrateCreateNamespace, type ResolvedRestRouterLimits } from './create-namespace.js';
import {
  REST_PROBLEM_CODES,
  REST_PROBLEM_MESSAGES,
  problemResponse,
  type RestProblemCode,
  type RestProblemStatus,
} from './rest-problem.js';

/**
 * 资源 limits 构造面（ADR 0015 L22–28 五项构造注入之一）。Host 用 Partial 覆盖默认值；
 * 未知键与越界值在**构造时**抛普通 `TypeError`；有效值为七键合并默认后的冻结对象，且
 * 恒满足 `maxSchemaTextBytes <= maxBodyBytes`（只给出一键时默认值向显式值收敛，两键都
 * 显式给出且矛盾时抛 `TypeError`——见 `resolveLimits`）。
 */
export interface RestRouterLimits {
  readonly maxBodyBytes?: number;
  readonly maxSchemaTextBytes?: number;
  readonly maxJsonDepth?: number;
  readonly maxJsonNodes?: number;
  readonly maxIssues?: number;
  readonly maxIssueMessageBytes?: number;
  readonly maxIssuesTotalBytes?: number;
}

/**
 * metrics-safe observer 事件（ADR 0015 L188）：**低基数、无敏感字段**。
 *
 * 键集恰为 `{operation, outcome, code?, status?}`——绝不携带 owner、namespaceId、
 * issues、schema/root 或 cause。`operation` 为同一 router 恒定的常量
 * （`'namespace-create'`）；`code` 出现时必须等于同一 Response body 的稳定 code；
 * abort 无 Response 因而无 `code` 无 `status`；成功（2xx）不携带 `code`。
 */
export interface RestMetricsEvent {
  readonly operation: string;
  readonly outcome: 'succeeded' | 'rejected' | 'unavailable' | 'failed' | 'aborted';
  /** 非 2xx 且非 abort 时出现；必须等于 response body 的稳定 code。 */
  readonly code?: string;
  /** 存在 HTTP Response 时出现（abort 无 status）。 */
  readonly status?: number;
}

/**
 * diagnostic observer 事件（ADR 0015 L161/L190）：**敏感运维面**，仅三类 kind。
 *
 * - `kind`：`registry-fatal`（Registry branded fatal）| `unknown-exception`
 *   （unknown exception 与内部契约违例，ADR 0015 L178 同类分组）|
 *   `lease-release-failure`（Lease release 失败，仍 201）。
 * - `cause` 恒为「跨过边界的那颗错误对象」的 **exact 引用**——router 不序列化、
 *   不改写、不展开字段。
 * - 可选字段只在其事实来源诚实可得时出现：`operation`/`phase`/`committed` 取自
 *   branded fatal（仅 `registry-fatal`）；`namespaceId` 取自 release 前的 DTO 副本
 *   （仅 `lease-release-failure`）；`owner` 为本请求提交给 `Registry.create` 的 owner。
 * - **绝不携带** schema 原文、root 或完整 validation issues。
 *
 * Host 须把该 Adapter 视为敏感运维接口，自行负责访问控制、采样与脱敏（ADR 0015 L190）。
 */
export interface RestDiagnosticEvent {
  readonly kind: 'registry-fatal' | 'unknown-exception' | 'lease-release-failure';
  readonly cause: unknown;
  readonly owner?: Readonly<{ userId: string }>;
  readonly operation?: string;
  readonly phase?: string;
  readonly committed?: boolean;
  readonly namespaceId?: string;
}

/**
 * 构造选项（ADR 0015 L22–28）。构造时同步完成读取 → 校验 → 复制 → 冻结；之后零动态更新。
 * 构造配置错误一律抛普通 `TypeError`（不承诺稳定文案，ADR 0015 L30）。
 *
 * `metricsObserver` / `diagnosticObserver` 必须显式注入——传 no-op 也必须是显式决定
 * （ADR 0015 L186；B-2）。两个 observer 均为同步 void 事件回调：事件类型见
 * `RestMetricsEvent` / `RestDiagnosticEvent`；observer throw 一律隔离，不改变 HTTP 结果
 * （ADR 0015 L186）。零参 `() => void`（显式 no-op）与 `(...args) => void` 记录器按
 * TS 少参函数可赋值规则保持兼容。
 */
export interface RestRouterOptions {
  /** 值必须同源自 composition root 的 Instance identity（ADR 0012；禁止第二配置源）。 */
  readonly role: InstanceRole;
  readonly registry: NamespaceRegistry;
  /** 同步 void observer：每请求恰一个低基数 metrics 事件（ADR 0015 L188）。 */
  readonly metricsObserver: (event: RestMetricsEvent) => void;
  /** 同步 void observer：仅三类敏感 diagnostic 事件（ADR 0015 L190）。 */
  readonly diagnosticObserver: (event: RestDiagnosticEvent) => void;
  /** Partial 覆盖默认 limits；未知键/越界值，以及两键显式给出时的跨字段矛盾，构造时抛普通 `TypeError`。 */
  readonly limits?: RestRouterLimits;
}

/**
 * `handle` 判别结果（ADR 0015 L32）：未匹配交还 server 按 raw path 选择其他 route family；
 * 匹配则携带 Response。
 */
export type RestHandledResult =
  | Readonly<{ matched: false }>
  | Readonly<{ matched: true; response: Response }>;

/** Host 无关 REST router 公共接口（无 dispose：构造不获取任何资源）。 */
export interface RestRouter {
  handle(request: Request): Promise<RestHandledResult>;
}

/**
 * 单一冻结匹配器（ADR 0015 L65–68）：大小写敏感、`$` 锚无尾随斜杠、段数恰 5、owner 段
 * 非空且以 raw 形态捕获（percent-encoding 的拒绝在 step 3a 执行，不在路由层做）。
 */
const CREATE_NAMESPACE_ROUTE = /^\/v1\/owners\/([^/]+)\/namespaces$/;

/** 七项 limits 默认值（ADR 0015 L103–111 逐字）。 */
const DEFAULT_LIMITS: ResolvedRestRouterLimits = Object.freeze({
  maxBodyBytes: 4 * 1024 * 1024,
  maxSchemaTextBytes: 256 * 1024,
  maxJsonDepth: 64,
  maxJsonNodes: 100_000,
  maxIssues: 100,
  maxIssueMessageBytes: 1024,
  maxIssuesTotalBytes: 64 * 1024,
});

const LIMIT_KEYS = [
  'maxBodyBytes',
  'maxSchemaTextBytes',
  'maxJsonDepth',
  'maxJsonNodes',
  'maxIssues',
  'maxIssueMessageBytes',
  'maxIssuesTotalBytes',
] as const satisfies readonly (keyof RestRouterLimits)[];

interface RestRouterConfig {
  readonly role: InstanceRole;
  readonly registry: NamespaceRegistry;
  readonly metricsObserver: (event: RestMetricsEvent) => void;
  readonly diagnosticObserver: (event: RestDiagnosticEvent) => void;
  readonly limits: ResolvedRestRouterLimits;
}

/**
 * limits 构造门（ADR 0015 L103–113）：Partial 覆盖 + 未知键/越界值 TypeError +
 * 跨字段不变量 `maxSchemaTextBytes <= maxBodyBytes`（对**有效值**恒成立）+ 冻结有效值。
 *
 * 跨字段不变量（#268 AC2）的判定口径：错误门守卫的是调用方的**矛盾指令**——两键都被
 * 显式给出且 `maxSchemaTextBytes > maxBodyBytes` ⇒ TypeError；只给出一键时，另一键的
 * 默认值按不变量向显式值**收敛**（schemaText 必须装进 body：显式 body 上限压缩默认
 * schema 上限；显式 schema 上限抬升默认 body 上限），既不静默接受违反 ADR 的有效配置，
 * 也不因不可达的默认值组合拒绝调用方（#269 C5 契约要求 `{maxBodyBytes: 16}` 可构造，
 * 且读取段内 abort 仍先于 413）。
 */
function resolveLimits(candidate: unknown): ResolvedRestRouterLimits {
  if (candidate === undefined) return DEFAULT_LIMITS;
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new TypeError('limits 必须是 plain object 或 undefined');
  }
  const record = candidate as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!(LIMIT_KEYS as readonly string[]).includes(key)) {
      throw new TypeError(`未知 limits 键: ${key}`);
    }
  }
  const resolved: Record<(typeof LIMIT_KEYS)[number], number> = {
    maxBodyBytes: DEFAULT_LIMITS.maxBodyBytes,
    maxSchemaTextBytes: DEFAULT_LIMITS.maxSchemaTextBytes,
    maxJsonDepth: DEFAULT_LIMITS.maxJsonDepth,
    maxJsonNodes: DEFAULT_LIMITS.maxJsonNodes,
    maxIssues: DEFAULT_LIMITS.maxIssues,
    maxIssueMessageBytes: DEFAULT_LIMITS.maxIssueMessageBytes,
    maxIssuesTotalBytes: DEFAULT_LIMITS.maxIssuesTotalBytes,
  };
  for (const key of LIMIT_KEYS) {
    const value = record[key];
    if (value === undefined) continue; // 未给出的键用默认值
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(`limits.${key} 必须是正安全整数`);
    }
    resolved[key] = value;
  }
  const bodyExplicit = record['maxBodyBytes'] !== undefined;
  const schemaTextExplicit = record['maxSchemaTextBytes'] !== undefined;
  if (bodyExplicit && schemaTextExplicit) {
    if (resolved.maxSchemaTextBytes > resolved.maxBodyBytes) {
      throw new TypeError('limits.maxSchemaTextBytes 不得大于 maxBodyBytes（两键显式给出时的矛盾指令）');
    }
  } else if (bodyExplicit) {
    // 显式 body 上限压缩默认 schema 上限：schemaText 必须装进 body，默认值不可达。
    resolved.maxSchemaTextBytes = Math.min(resolved.maxSchemaTextBytes, resolved.maxBodyBytes);
  } else if (schemaTextExplicit) {
    // 显式 schema 上限抬升默认 body 上限：schemaText 必须装得进 body。
    resolved.maxBodyBytes = Math.max(resolved.maxBodyBytes, resolved.maxSchemaTextBytes);
  }
  return Object.freeze({ ...resolved });
}

/**
 * owner 安全文法的包内私有镜像（D7 / SA8 O-3）：逐条镜像
 * `packages/namespace-registry/src/identity.ts` 的 `isMinimalSafeString`（L88–99）——
 * 非空、≠ `.`/`..`、不含 U+0000–001F/U+007F–009F 控制字符、不含 `/`（0x2F）与 `\`
 * （0x5C）；不 trim、不归一化、不追加任何 ASCII/长度/首字符白名单（#110 设计 §4 冻结
 * 最小集）。**锁步义务**：Registry 文法演进时本镜像必须同步（统一导出可另立票决策）。
 */
function isSafeOwnerUserId(segment: string): boolean {
  if (segment.length === 0) return false;
  if (segment === '.' || segment === '..') return false;
  for (let index = 0; index < segment.length; index += 1) {
    const code = segment.charCodeAt(index);
    if ((code >= 0x0000 && code <= 0x001f) || (code >= 0x007f && code <= 0x009f)) return false;
    if (code === 0x002f || code === 0x005c) return false;
  }
  return true;
}

/**
 * Content-Type 判定（ADR 0015 L70；D10）：缺失/空 → 拒绝；媒体类型必须
 * `application/json`（大小写不敏感、参数前 OWS 容忍）；至多 1 个参数且必须
 * `charset=utf-8`（名/值大小写不敏感、值可带可选双引号；参数名/`=`/值两侧容忍
 * 可选 SP/HTAB——设计定死的宽松解析规则）。
 */
function isSupportedContentType(value: string | null): boolean {
  if (value === null) return false;
  const [mediaType, ...parameters] = value.split(';');
  if (mediaType === undefined || mediaType.trim().toLowerCase() !== 'application/json') return false;
  if (parameters.length === 0) return true;
  if (parameters.length > 1) return false;
  const parameter = parameters[0] ?? '';
  const separator = parameter.indexOf('=');
  if (separator < 0) return false;
  if (parameter.slice(0, separator).trim().toLowerCase() !== 'charset') return false;
  let charset = parameter.slice(separator + 1).trim();
  if (charset.length >= 2 && charset.startsWith('"') && charset.endsWith('"')) {
    charset = charset.slice(1, -1).trim();
  }
  return charset.toLowerCase() === 'utf-8';
}

/** Content-Encoding 判定（ADR 0015 L71）：缺失通过；`identity`（大小写/空白容忍）通过。 */
function isSupportedContentEncoding(value: string | null): boolean {
  if (value === null) return true;
  return value.trim().toLowerCase() === 'identity';
}

/** 单 code、固定文案的 problem Response（step 3 与 role/method gate 共用）。 */
function simpleProblemResponse(status: RestProblemStatus, code: RestProblemCode): Response {
  return problemResponse(status, { code, message: REST_PROBLEM_MESSAGES[code] });
}

/** 已知 path 的非 POST：405 problem + `Allow: POST`（ADR 0015 L68）。 */
function methodNotAllowedResponse(): Response {
  return problemResponse(
    405,
    { code: REST_PROBLEM_CODES.METHOD_NOT_ALLOWED, message: REST_PROBLEM_MESSAGES.METHOD_NOT_ALLOWED },
    { allow: 'POST' },
  );
}

/** Peer role gate：403 problem + 冻结 code（ADR 0015 L38–41）。 */
function roleForbiddenResponse(): Response {
  return problemResponse(403, {
    code: REST_PROBLEM_CODES.INSTANCE_ROLE_FORBIDDEN,
    message: REST_PROBLEM_MESSAGES.INSTANCE_ROLE_FORBIDDEN,
  });
}

/**
 * 构造 REST router（ADR 0015 L22–32）：读取 → 校验 → 复制 → 冻结。
 *
 * 判定顺序（B-3，不可 reorder）：raw path 匹配 → method gate（405）→ role gate（403）→
 * step 3 owner/query/Content-Type/Content-Encoding → step 4 有界读取（读取段内
 * `Request.signal` abort 优先于任何读取期检查，含 413）→ step 5 形状/资源检查 →
 * 派生身份 → `Registry.create` → DTO 复制 → 恰一次 `lease.release()` → 201。Peer 在
 * role gate 前零 owner 解码、零 body 成员调用、零 Registry 触达；step 3 失败同样零 body
 * 读取与零 Registry 触达；body 读取阶段 abort 以有界 rejection 结算且 Registry 零触达；
 * Registry 接纳后不再观察 signal（不传播客户端取消，等待 create settle 与 release）。
 */
export function createRestRouter(options: RestRouterOptions): RestRouter {
  const candidate: unknown = options;
  if (candidate === null || typeof candidate !== 'object') {
    throw new TypeError('rest router options 必须是对象');
  }
  const { role, registry, metricsObserver, diagnosticObserver, limits } =
    candidate as RestRouterOptions;
  if (role !== 'hub' && role !== 'peer') {
    throw new TypeError('role 必须是 hub | peer（值须来自 Instance identity）');
  }
  const registryCandidate: unknown = registry;
  if (
    registryCandidate === null ||
    typeof registryCandidate !== 'object' ||
    typeof (registryCandidate as { create?: unknown }).create !== 'function'
  ) {
    throw new TypeError('registry 必须是 NamespaceRegistry（create 必须是函数）');
  }
  const metricsObserverCandidate: unknown = metricsObserver;
  if (typeof metricsObserverCandidate !== 'function') {
    throw new TypeError('metricsObserver 必须显式注入（no-op 须显式）');
  }
  const diagnosticObserverCandidate: unknown = diagnosticObserver;
  if (typeof diagnosticObserverCandidate !== 'function') {
    throw new TypeError('diagnosticObserver 必须显式注入（no-op 须显式）');
  }
  // 复制 + 冻结：role 等值读入（构造后改写调用方 options 不改变行为）；limits 经构造门
  // 解析为「合并默认后的有效值」冻结对象，handle 期间零解引用失败可能。
  const config: RestRouterConfig = Object.freeze({
    role,
    registry,
    metricsObserver,
    diagnosticObserver,
    limits: resolveLimits(limits),
  });

  async function handle(request: Request): Promise<RestHandledResult> {
    const url = new URL(request.url); // raw path；非法 URL → rejection（fail loud）
    const match = CREATE_NAMESPACE_ROUTE.exec(url.pathname);
    if (match === null) {
      return { matched: false }; // path 匹配先于 method 判定（AC6）
    }
    if (request.method !== 'POST') {
      return { matched: true, response: methodNotAllowedResponse() }; // method gate 先于 role gate
    }
    if (config.role !== 'hub') {
      return { matched: true, response: roleForbiddenResponse() }; // 至此零 owner 解码 / 零 body 读取 / 零 Registry 触达
    }
    const ownerUserId = match[1];
    if (ownerUserId === undefined) {
      // 不可达：regex 的 `([^/]+)` 在匹配成功时必捕获非空段。fail loud，不编造 owner。
      throw new Error('不可达：canonical route 匹配必须捕获 owner 段');
    }
    // step 3a：owner 的 percent-encoding 拒绝 + Registry 安全文法镜像（双检）。
    if (ownerUserId.includes('%') || !isSafeOwnerUserId(ownerUserId)) {
      return {
        matched: true,
        response: simpleProblemResponse(400, REST_PROBLEM_CODES.INVALID_OWNER),
      };
    }
    // step 3b：首版不接受 query 参数（裸 `?` 无参数视为无 query）。
    if (url.search !== '') {
      return {
        matched: true,
        response: simpleProblemResponse(400, REST_PROBLEM_CODES.QUERY_PARAMETERS_NOT_SUPPORTED),
      };
    }
    // step 3c / 3d：媒体层检查先于 body 读取（trapped Request 零消费契约）。
    if (!isSupportedContentType(request.headers.get('content-type'))) {
      return {
        matched: true,
        response: simpleProblemResponse(415, REST_PROBLEM_CODES.UNSUPPORTED_MEDIA_TYPE),
      };
    }
    if (!isSupportedContentEncoding(request.headers.get('content-encoding'))) {
      return {
        matched: true,
        response: simpleProblemResponse(415, REST_PROBLEM_CODES.UNSUPPORTED_CONTENT_ENCODING),
      };
    }
    return {
      matched: true,
      response: await orchestrateCreateNamespace({
        registry: config.registry,
        ownerUserId,
        request,
        limits: config.limits,
        metricsObserver: config.metricsObserver,
        diagnosticObserver: config.diagnosticObserver,
      }),
    };
  }

  return Object.freeze({ handle });
}
