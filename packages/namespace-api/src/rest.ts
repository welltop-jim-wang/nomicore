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
 * **切片边界（issue #268；剩余未映射结局仍 fail loud）**：本版实现 step 1–2（route/
 * method 匹配 + role gate）、step 3（owner/query/Content-Type/Encoding 检查）与
 * step 4–10（有界读取 + 严格 UTF-8 + 平台 JSON + 形状/资源检查 + 成功路径），
 * 4xx/422 一律经 `./rest-problem.js` 构造固定 problem shape。仍以 rejection 结算的
 * 未映射结局：body 读取阶段 abort、Registry fatal、503 `REGISTRY_NOT_ACCEPTING` 与
 * 安全 500 族（`NAMESPACE_CREATE_FAILED`/`NAMESPACE_CREATE_OUTCOME_UNKNOWN`/
 * `INTERNAL_ERROR`、`NAMESPACE_CREATE_INVALID_INPUT`/`NAMESPACE_ALREADY_EXISTS`）——
 * 后续票收敛；observer **事件**契约（FR-4）亦延后（本版零发射）。
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
 * 未知键与越界值在**构造时**抛普通 `TypeError`；有效值为七键合并默认后的冻结对象。
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
 * 构造选项（ADR 0015 L22–28）。构造时同步完成读取 → 校验 → 复制 → 冻结；之后零动态更新。
 * 构造配置错误一律抛普通 `TypeError`（不承诺稳定文案，ADR 0015 L30）。
 *
 * `metricsObserver` / `diagnosticObserver` 必须显式注入——传 no-op 也必须是显式决定
 * （ADR 0015 L186；B-2）。本票不发射任何事件（事件发射契约属 FR-4）：零参 `() => void`
 * 签名使后续事件化收窄（增加参数）不破坏既有少参调用方。
 */
export interface RestRouterOptions {
  /** 值必须同源自 composition root 的 Instance identity（ADR 0012；禁止第二配置源）。 */
  readonly role: InstanceRole;
  readonly registry: NamespaceRegistry;
  /** 同步 void observer；事件契约延后（本票零发射）。 */
  readonly metricsObserver: () => void;
  /** 同步 void observer；事件契约延后（本票零发射）。 */
  readonly diagnosticObserver: () => void;
  /** Partial 覆盖默认 limits；未知键/越界值/跨字段违约在构造时抛普通 `TypeError`。 */
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
  readonly metricsObserver: () => void;
  readonly diagnosticObserver: () => void;
  readonly limits: ResolvedRestRouterLimits;
}

/**
 * limits 构造门（ADR 0015 L103–113）：Partial 覆盖 + 未知键/越界值 TypeError +
 * 合并默认后的跨字段不变量 `maxSchemaTextBytes <= maxBodyBytes` + 冻结有效值。
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
  if (resolved.maxSchemaTextBytes > resolved.maxBodyBytes) {
    throw new TypeError('limits.maxSchemaTextBytes 不得大于 maxBodyBytes（按合并默认后的有效值判定）');
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
 * step 3 owner/query/Content-Type/Content-Encoding → step 4 有界读取 → step 5 形状/
 * 资源检查 → 派生身份 → `Registry.create` → DTO 复制 → 恰一次 `lease.release()` → 201。
 * Peer 在 role gate 前零 owner 解码、零 body 成员调用、零 Registry 触达；step 3 失败
 * 同样零 body 读取与零 Registry 触达。
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
      response: await orchestrateCreateNamespace(config.registry, ownerUserId, request, config.limits),
    };
  }

  return Object.freeze({ handle });
}
