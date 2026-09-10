/**
 * create 编排（ADR 0015 L18：**包内私有**）——不进 `package.json` exports 白名单，仅由
 * `./rest.js` 相对导入；外部消费者被打包面结构性阻断，私有性不依赖注释纪律。
 *
 * 固定顺序（B-3，不可 reorder；ADR 0015 step 4 → 6 → 7 → 8 → 9 → 10）：
 * step 4 有界读取（共享 `request-body.ts`：`Content-Length` 提前拒绝 + stream byte 上限 +
 * 严格 UTF-8）→ step 5 顶层形状与解析后资源检查 → `deriveSchemaIdentity` 派生身份 →
 * 组装完整 SCHEMA envelope（四键含原文 text）→ `Registry.create({ owner, schema, root })` →
 * 复制 owned plain DTO → 恰一次 `lease.release()`（等待 settle、失败不重试）→ 从 DTO 构造
 * 201（不设 Location）。
 *
 * 请求失败结算（ADR 0015 §错误契约 L163–174；#268）：step 4/5 的 400/413 与 step 6/7 的
 * 422 经 `rest-problem.ts` 构造固定 problem Response（含严格 UTF-8、空 body、malformed
 * JSON、形状、数字范围、limits 与 VFSL schema/ROOT 两族）。
 *
 * Registry 结局映射（ADR 0015 §错误契约 L175–L182；issue #269）：
 * - `REGISTRY_NOT_ACCEPTING` → 503（明确零提交、可稍后重新请求）；
 * - 窄 issue `NAMESPACE_CREATE_FAILED`（typed operational）→ 500，逐字 code；
 * - `NamespaceRegistryFatalError.committed === true` → 500 `NAMESPACE_CREATE_OUTCOME_UNKNOWN`
 *   （可能已提交、不得自动重试）；
 * - fatal `committed === false`、unknown exception、内部契约违例
 *   （`NAMESPACE_CREATE_INVALID_INPUT` / `NAMESPACE_ALREADY_EXISTS`）→ 500 `INTERNAL_ERROR`
 *   （committed 是 fatal 二分的唯一判别子；phase 仅作诊断信息）。
 * 其余窄 issue（`NAMESPACE_INVALID_IDENTITY` 等）保持 fail-loud rejection，不发明未评审映射。
 *
 * 取消边界（ADR 0015 L113）：body 读取段显式观察 `Request.signal`（入口同步判定 +
 * 读取段内观察 + 读取结算后同步再核对），中断以有界 rejection 结算、metrics
 * `aborted`、Registry 零触达；读取段内被观察到的 abort 优先于该段任何结局（含 #268 的
 * 413）。`Registry.create` 一经调用即全程不再观察 signal——客户端中断不传播，等待
 * create settle 并恰一次 release。
 *
 * 观测（ADR 0015 L186–L190）：每请求恰一个低基数 metrics 事件；diagnostic 仅三类
 * 事件（registry-fatal / unknown-exception / lease-release-failure），`cause` 恒为
 * exact 对象引用，绝不携带 schema/root/完整 issues；observer throw 一律隔离，
 * 不改变 HTTP 结果。#268 的 4xx/422 problem 结局保持零发射（metrics `rejected` 的
 * 发射策略归后续票）。`root` 值的领域合法性归 Registry/VFSL——REST 不预设其具体形状
 * （ADR 0015 L75）。
 */
import { deriveSchemaIdentity } from '@nomicore/vfsl';
import { NamespaceRegistryFatalError } from '@nomicore/namespace-registry';
import type { CreateNamespaceResult, NamespaceRegistry } from '@nomicore/namespace-registry';
import {
  REST_PROBLEM_CODES,
  REST_PROBLEM_MESSAGES,
  RestProblemFailure,
  createRestProblemFailure,
  mapRestIssues,
  problemResponse,
  utf8ByteLength,
  type RestIssueSource,
} from './rest-problem.js';
import {
  ABORTED_BODY_READ_MESSAGE,
  assertPostParseResourceLimits,
  assertTopLevelShape,
  readBoundedBodyText,
} from './request-body.js';
import type { RestDiagnosticEvent, RestMetricsEvent } from './rest.js';

/** SCHEMA envelope 上下文常量（ADR 0015 L119–125）。 */
const SCHEMA_LANG = 'vfsl';
const SCHEMA_VERSION = 1;

const JSON_CONTENT_TYPE = 'application/json';

/**
 * 构造期由 `rest.ts` 的 limits 门解析出的**有效 limits**（七键全为必填正安全整数、
 * 已冻结）。类型留在包私有模块（公共 `RestRouterLimits` 形状不变）。
 */
export interface ResolvedRestRouterLimits {
  readonly maxBodyBytes: number;
  readonly maxSchemaTextBytes: number;
  readonly maxJsonDepth: number;
  readonly maxJsonNodes: number;
  readonly maxIssues: number;
  readonly maxIssueMessageBytes: number;
  readonly maxIssuesTotalBytes: number;
}

/** step 6/7 的 422 problem Response（issues 受控映射 + 预算/截断）。 */
function validationProblemResponse(
  code: typeof REST_PROBLEM_CODES.SCHEMA_INVALID | typeof REST_PROBLEM_CODES.ROOT_INVALID,
  source: RestIssueSource,
  rawIssues: readonly unknown[],
  limits: ResolvedRestRouterLimits,
): Response {
  const mapped = mapRestIssues(source, rawIssues, {
    maxIssues: limits.maxIssues,
    maxIssueMessageBytes: limits.maxIssueMessageBytes,
    maxIssuesTotalBytes: limits.maxIssuesTotalBytes,
  });
  return problemResponse(422, {
    code,
    message: REST_PROBLEM_MESSAGES[code],
    issues: mapped.issues,
    ...(mapped.issuesTruncated ? { issuesTruncated: true } : {}),
  });
}

/**
 * metrics operation 常量（ADR 0015 L188「统一低基数事件」）：本 router 只有单一
 * create endpoint ⇒ 单一常量；未来第二个 endpoint 属另一 operation。
 */
const METRICS_OPERATION = 'namespace-create';

/**
 * body 读取阶段 abort 的包内私有 rejection（**不导出**）：本票 abort 的公共分类面是
 * metrics `outcome:'aborted'`；rejection 值形状非契约面，后续 server 票若需公共判别子
 * 再以加法提升（ADR 0015 L32：router 不拥有 listener/连接生命周期）。
 *
 * message/cause 逐字承接共享读取 seam 的既约事实（`request-body.ts` 的
 * `ABORTED_BODY_READ_MESSAGE` + `signal.reason`），使 abort 的 rejection 形态不因两票
 * 合入而改变（#268 `rest-create-body-read.test.ts` D6 断言固定 message + cause）。
 */
class RestBodyReadAbortedError extends Error {
  constructor(signal: AbortSignal) {
    super(ABORTED_BODY_READ_MESSAGE, { cause: signal.reason });
    this.name = 'RestBodyReadAbortedError';
  }
}

/** `orchestrateCreateNamespace` 依赖（私有面；唯一调用方 `./rest.js`）。 */
export interface CreateNamespaceOrchestrationDeps {
  readonly registry: NamespaceRegistry;
  readonly ownerUserId: string;
  readonly request: Request;
  readonly limits: ResolvedRestRouterLimits;
  readonly metricsObserver: (event: RestMetricsEvent) => void;
  readonly diagnosticObserver: (event: RestDiagnosticEvent) => void;
}

/**
 * observer 隔离发射（ADR 0015 L186）：全部调用点一律经 helper，使「observer throw
 * 不改变 HTTP 结果」成为结构性保证（而非逐分支 try/catch 的可遗漏面）。
 */
function emitMetrics(
  observer: (event: RestMetricsEvent) => void,
  event: RestMetricsEvent,
): void {
  try {
    observer(event);
  } catch {
    // 隔离：observer throw 一律不改变 HTTP 结果（同步 void 契约）。
  }
}

function emitDiagnostic(
  observer: (event: RestDiagnosticEvent) => void,
  event: RestDiagnosticEvent,
): void {
  try {
    observer(event);
  } catch {
    // 隔离：同上。
  }
}

/**
 * 最小 problem body（与骨架既有 403/405 形状同构；完整 problem shape 归 #268 的
 * 4xx/422 族）：构造 Response → 发射恰一个 metrics 事件 → 返回（发射与返回原子，无双发）。
 */
function errorResponse(
  metricsObserver: (event: RestMetricsEvent) => void,
  code: string,
  status: 500 | 503,
  outcome: 'failed' | 'unavailable',
): Response {
  const response = new Response(JSON.stringify({ code }), {
    status,
    headers: { 'content-type': JSON_CONTENT_TYPE },
  });
  emitMetrics(metricsObserver, { operation: METRICS_OPERATION, outcome, code, status });
  return response;
}

/**
 * step 4 读取 seam（与 #268 共享）：显式观察 `Request.signal`，且**读取段内被观察到的
 * abort 优先于该段任何结局**（含 #268 的 413/400）——
 * ①入口同步判定 `signal.aborted`（先于任何读取期检查）；
 * ②读取段内 abort：共享 `readBoundedBodyText` 自身观察 signal（`reader.cancel()` 使
 *   挂起的读有界结算并抛 abort rejection），本 seam 在读取结算处再核对 `signal.aborted`；
 * ③读取胜出后同步再核对 `signal.aborted`。
 *
 * 未被 abort 的读取失败（400/413 由 `RestProblemFailure` 承载）原样传播——#268 族。
 * Registry 零触达的结构保证：本函数返回后至 `registry.create` 调用之间只有同步代码。
 */
async function readRequestBody(
  request: Request,
  limits: ResolvedRestRouterLimits,
  metricsObserver: (event: RestMetricsEvent) => void,
): Promise<string> {
  const signal = request.signal; // 标准 Web Request 恒有 signal；缺失 ⇒ 自然 TypeError（fail loud）
  if (signal.aborted) return abortSettle(signal, metricsObserver); // 闸门①：读取段入口
  try {
    const text = await readBoundedBodyText(request, limits.maxBodyBytes); // #268：有界读取 + 严格 UTF-8
    if (signal.aborted) return abortSettle(signal, metricsObserver); // 闸门③：读胜出后再核对
    return text;
  } catch (error) {
    // 闸门②：读取段内 abort 优先于该段任何结局（含 413）；否则原样传播读取失败。
    if (signal.aborted) return abortSettle(signal, metricsObserver);
    throw error;
  }
}

/** abort 结算：metrics `{operation, outcome:'aborted'}`（无 code、无 status、零 diagnostic）+ 有界 rejection。 */
function abortSettle(signal: AbortSignal, metricsObserver: (event: RestMetricsEvent) => void): never {
  emitMetrics(metricsObserver, { operation: METRICS_OPERATION, outcome: 'aborted' });
  throw new RestBodyReadAbortedError(signal);
}

/**
 * Hub create 编排（REST router 私有实现面；ADR 0015 step 4–10）。
 *
 * 失败语义（ADR 0015 L163–182）：step 4/5 的 400/413 与 step 6/7 的 422 返回固定
 * problem Response；Registry 结局按 §错误契约 L175–L182 映射为 503/500 族；abort 与
 * 未映射窄 issue 以 rejection 结算。release 失败是本函数唯一被吞的错误（ADR 0015
 * L161）：不改变已知创建事实——仍 201、不重复调用 release——但以 diagnostic
 * `lease-release-failure` 上报 owner、release 前 DTO 副本 namespaceId 与 exact cause。
 */
export async function orchestrateCreateNamespace(
  deps: CreateNamespaceOrchestrationDeps,
): Promise<Response> {
  const { registry, ownerUserId, request, limits, metricsObserver, diagnosticObserver } = deps;
  const owner = Object.freeze({ userId: ownerUserId });
  let schemaText: string;
  let root: unknown;
  try {
    const text = await readRequestBody(request, limits, metricsObserver); // step 4（含 abort 边界）
    let parsed: unknown;
    try {
      parsed = JSON.parse(text); // step 4e：平台标准 JSON（重复 key = last-key-wins）
    } catch {
      // malformed JSON 只返回通用错误，绝不透传平台 SyntaxError 的源码位置。
      throw createRestProblemFailure(400, REST_PROBLEM_CODES.MALFORMED_JSON);
    }
    const shaped = assertTopLevelShape(parsed); // step 5a
    schemaText = shaped.schemaText;
    root = shaped.root;
    if (utf8ByteLength(schemaText) > limits.maxSchemaTextBytes) {
      // step 5b：schemaText 以 UTF-8 bytes 计（排他上限）。
      throw createRestProblemFailure(413, REST_PROBLEM_CODES.SCHEMA_TEXT_TOO_LARGE);
    }
    assertPostParseResourceLimits(parsed, limits.maxJsonDepth, limits.maxJsonNodes); // step 5c
  } catch (error) {
    if (error instanceof RestProblemFailure) {
      return problemResponse(error.status, error.payload);
    }
    throw error; // abort（读取 seam 已发射 metrics）/ 内部异常：维持 rejection（fail loud）
  }
  const derived = deriveSchemaIdentity(schemaText); // step 6：公共窄接口；同步、纯、不抛
  if (!derived.ok) {
    return validationProblemResponse(REST_PROBLEM_CODES.SCHEMA_INVALID, 'schema', derived.issues, limits);
  }
  const envelope = {
    lang: SCHEMA_LANG,
    version: SCHEMA_VERSION,
    id: derived.schemaId,
    text: schemaText,
  }; // 完整 SCHEMA envelope（四键；`text` 绝不进任何 response）
  let created: CreateNamespaceResult;
  try {
    created = await registry.create({
      owner,
      schema: envelope,
      root, // 值合法性归 Registry/VFSL（null 等显式值原样透传）
    }); // step 7：恰三键输入；接纳点——此后零 signal 观察
  } catch (error) {
    if (error instanceof NamespaceRegistryFatalError) {
      // committed 是 fatal 二分的唯一判别子（phase 只作诊断信息）。
      emitDiagnostic(diagnosticObserver, {
        kind: 'registry-fatal',
        cause: error,
        owner,
        operation: error.operation,
        phase: error.phase,
        committed: error.committed,
      });
      return error.committed
        ? errorResponse(metricsObserver, 'NAMESPACE_CREATE_OUTCOME_UNKNOWN', 500, 'failed') // 可能已提交：不得自动重试
        : errorResponse(metricsObserver, 'INTERNAL_ERROR', 500, 'failed'); // 提交前内部故障（R1）
    }
    emitDiagnostic(diagnosticObserver, { kind: 'unknown-exception', cause: error, owner });
    return errorResponse(metricsObserver, 'INTERNAL_ERROR', 500, 'failed');
  }
  if (!created.ok) {
    switch (created.code) {
      case 'NAMESPACE_SCHEMA_INVALID':
        // step 6/7 的 422（#268）：VFSL schema invalid。
        return validationProblemResponse(REST_PROBLEM_CODES.SCHEMA_INVALID, 'schema', created.issues, limits);
      case 'NAMESPACE_ROOT_INVALID':
        // step 7 的 422（#268）：ROOT 值 invalid。
        return validationProblemResponse(REST_PROBLEM_CODES.ROOT_INVALID, 'root', created.issues, limits);
      case 'REGISTRY_NOT_ACCEPTING':
        return errorResponse(metricsObserver, 'REGISTRY_NOT_ACCEPTING', 503, 'unavailable');
      case 'NAMESPACE_CREATE_FAILED':
        return errorResponse(metricsObserver, 'NAMESPACE_CREATE_FAILED', 500, 'failed');
      case 'NAMESPACE_CREATE_INVALID_INPUT':
      case 'NAMESPACE_ALREADY_EXISTS':
        // 内部契约违例（ADR 0015 L180）：REST 自行构造合法输入，正常路径不应出现；
        // 安全 500 + diagnostic（ADR 0015 L178 与 unknown exception 同类分组）。
        emitDiagnostic(diagnosticObserver, { kind: 'unknown-exception', cause: created, owner });
        return errorResponse(metricsObserver, 'INTERNAL_ERROR', 500, 'failed');
      default:
        // 未映射窄 issue（如 NAMESPACE_INVALID_IDENTITY）：保持 fail loud，不发明未评审映射。
        throw new Error(`unmapped registry issue: ${created.code}`, { cause: created });
    }
  }
  const lease = created.lease;
  // step 8：release 前复制 owned plain DTO（string 值拷贝 + frozen；envelope 含 text，
  // 绝不从 envelope 展开）。
  const dto = Object.freeze({
    namespaceId: lease.namespaceId,
    schema: Object.freeze({ lang: SCHEMA_LANG, version: SCHEMA_VERSION, id: derived.schemaId }),
  });
  try {
    await lease.release(); // step 9：恰一次、等待 settle；失败不重试、不二次调用
  } catch (error) {
    // release 失败不改变已知创建事实：仍 201；以 diagnostic 上报（ADR 0015 L161）。
    emitDiagnostic(diagnosticObserver, {
      kind: 'lease-release-failure',
      cause: error,
      owner,
      namespaceId: dto.namespaceId,
    });
  }
  emitMetrics(metricsObserver, { operation: METRICS_OPERATION, outcome: 'succeeded', status: 201 });
  return new Response(JSON.stringify(dto), {
    // step 10：release settle 之后从 DTO 构造；不设 location（AC1）。
    status: 201,
    headers: { 'content-type': JSON_CONTENT_TYPE },
  });
}
