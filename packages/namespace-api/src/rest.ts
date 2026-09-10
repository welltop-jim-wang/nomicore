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
 * **切片边界（issue #267；未映射结局一律 fail loud）**：本版只实现 step 1–2（route/
 * method 匹配 + role gate）与 step 6–10 的成功路径。step 3–5 的请求形状校验/limits/
 * signal 与 Registry 失败映射、observer **事件**契约由后续 ticket 叠加：凡非成功结局，
 * `handle` 以 rejection 结算，**不产生任何 HTTP 错误 Response**（不发明未评审的 4xx/5xx
 * problem shape）。后续错误契约票以 Response 替换 rejection 是纯加法，不 reorder 任何
 * 已实现的可观察顺序（SA8 B-3）。
 */
import type { InstanceRole, NamespaceRegistry } from '@nomicore/namespace-registry';
import { orchestrateCreateNamespace } from './create-namespace.js';

/**
 * 资源 limits 为预留构造面（ADR 0015 L22–28 五项构造注入之一）。本票**不校验、不执行**
 * （校验语义与执行属 FR-1 limits 票）；保留参数位使后续 ticket 不必改公共构造签名（与
 * B-2 observer 参数位同款逻辑）。
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
  /** 预留构造面：本票不校验不执行（FR-1）。 */
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
 * 非空且以 raw 形态捕获（percent-encoding 的拒绝属 step 3 延后项，不在路由层做）。
 */
const CREATE_NAMESPACE_ROUTE = /^\/v1\/owners\/([^/]+)\/namespaces$/;

/** 错误 body 临时值：完整 problem shape 属 FR-3 错误契约票（非冻结面，SA8 N-3）。 */
const METHOD_NOT_ALLOWED_CODE = 'METHOD_NOT_ALLOWED';

/** ADR 0015 L41 冻结 code（全决策集唯一定义点）。 */
const INSTANCE_ROLE_FORBIDDEN_CODE = 'INSTANCE_ROLE_FORBIDDEN';

const JSON_CONTENT_TYPE = 'application/json';

interface RestRouterConfig {
  readonly role: InstanceRole;
  readonly registry: NamespaceRegistry;
  readonly metricsObserver: () => void;
  readonly diagnosticObserver: () => void;
  readonly limits: RestRouterLimits | undefined;
}

/** 已知 path 的非 POST：405 + `Allow: POST`（ADR 0015 L68）。 */
function methodNotAllowedResponse(): Response {
  return new Response(JSON.stringify({ code: METHOD_NOT_ALLOWED_CODE }), {
    status: 405,
    headers: { 'content-type': JSON_CONTENT_TYPE, allow: 'POST' },
  });
}

/** Peer role gate：403 + 冻结 code（ADR 0015 L38–41）。 */
function roleForbiddenResponse(): Response {
  return new Response(JSON.stringify({ code: INSTANCE_ROLE_FORBIDDEN_CODE }), {
    status: 403,
    headers: { 'content-type': JSON_CONTENT_TYPE },
  });
}

/**
 * 构造 REST router（ADR 0015 L22–32）：读取 → 校验 → 复制 → 冻结。
 *
 * 判定顺序（B-3，不可 reorder）：raw path 匹配 → method gate（405）→ role gate（403）→
 * owner 段捕获 → body 读取 → 派生身份 → `Registry.create` → DTO 复制 → 恰一次
 * `lease.release()` → 201。Peer 在 role gate 前零 owner 解码、零 body 成员调用、
 * 零 Registry 触达。
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
  // 复制 + 冻结：role 等值读入（构造后改写调用方 options 不改变行为）；limits 存在时
  // 浅复制冻结（预留，未消费）。
  const config: RestRouterConfig = Object.freeze({
    role,
    registry,
    metricsObserver,
    diagnosticObserver,
    limits: limits === undefined ? undefined : Object.freeze({ ...limits }),
  });

  async function handle(request: Request): Promise<RestHandledResult> {
    const { pathname } = new URL(request.url); // raw path；非法 URL → rejection（fail loud）
    const match = CREATE_NAMESPACE_ROUTE.exec(pathname);
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
    return {
      matched: true,
      response: await orchestrateCreateNamespace(config.registry, ownerUserId, request),
    };
  }

  return Object.freeze({ handle });
}
