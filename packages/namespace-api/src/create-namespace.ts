/**
 * create 编排（ADR 0015 L18：**包内私有**）——不进 `package.json` exports 白名单，仅由
 * `./rest.js` 相对导入；外部消费者被打包面结构性阻断，私有性不依赖注释纪律。
 *
 * 固定顺序（B-3，不可 reorder；ADR 0015 step 4 → 6 → 7 → 8 → 9 → 10）：
 * step 4 有界读取 + 严格 UTF-8 + 平台 JSON → step 5 顶层形状与解析后资源检查 →
 * `deriveSchemaIdentity` 派生身份 → 组装完整 SCHEMA envelope（四键含原文 text）→
 * `Registry.create({ owner, schema, root })` → 复制 owned plain DTO → 恰一次
 * `lease.release()`（等待 settle、失败不重试）→ 从 DTO 构造 201（不设 Location）。
 *
 * 错误结算（ADR 0015 §错误契约 L163–174）：step 4/5 的 400/413 与 step 6/7 的 422 经
 * `rest-problem.ts` 构造固定 problem Response；abort、Registry fatal 与其余未映射结局
 * 一律 fail loud（rejection，不发明 HTTP 映射——503/500 族属后续票）。
 * `root` 值的领域合法性归 Registry/VFSL——REST 不预设其具体形状（ADR 0015 L75）。
 */
import { deriveSchemaIdentity } from '@nomicore/vfsl';
import type { NamespaceRegistry } from '@nomicore/namespace-registry';
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
  assertPostParseResourceLimits,
  assertTopLevelShape,
  readBoundedBodyText,
} from './request-body.js';

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
 * Hub 成功路径编排（REST router 私有实现面；ADR 0015 step 4–10）。
 *
 * 失败语义（ADR 0015 L163–174）：step 4/5 的 400/413（含严格 UTF-8、空 body、
 * malformed JSON、形状、数字范围）与 step 6/7 的 422（VFSL schema invalid / ROOT
 * invalid）返回固定 problem Response；abort 与 Registry fatal 等未映射结局以
 * `Error` rejection 结算。release 失败是本函数唯一被吞的错误（ADR 0015 L161）：
 * 不改变已知创建事实——仍 201、不重复调用 release。
 */
export async function orchestrateCreateNamespace(
  registry: NamespaceRegistry,
  ownerUserId: string,
  request: Request,
  limits: ResolvedRestRouterLimits,
): Promise<Response> {
  let schemaText: string;
  let root: unknown;
  try {
    const text = await readBoundedBodyText(request, limits.maxBodyBytes); // step 4
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
    throw error; // abort / 内部异常：维持 rejection（fail loud）
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
  }; // 完整 SCHEMA envelope（四键；`text` 绝不进 201 response）
  const created = await registry.create({
    owner: { userId: ownerUserId },
    schema: envelope,
    root, // 值合法性归 Registry/VFSL（null 等显式值原样透传）
  }); // step 7：恰三键输入
  if (!created.ok) {
    // step 7 分叉：恰映射 VFSL schema/ROOT 两族为 422；其余 code（含
    // NAMESPACE_CREATE_INVALID_INPUT / NAMESPACE_ALREADY_EXISTS / not-accepting 与
    // NAMESPACE_INVALID_IDENTITY 兜底）维持 rejection——安全 500/503 族属后续票。
    if (created.code === 'NAMESPACE_SCHEMA_INVALID') {
      return validationProblemResponse(REST_PROBLEM_CODES.SCHEMA_INVALID, 'schema', created.issues, limits);
    }
    if (created.code === 'NAMESPACE_ROOT_INVALID') {
      return validationProblemResponse(REST_PROBLEM_CODES.ROOT_INVALID, 'root', created.issues, limits);
    }
    throw new Error(`unmapped registry issue: ${created.code}`, { cause: created });
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
  } catch {
    // release 失败不改变已知创建事实：仍 201（diagnostic 上报属 FR-4 观测票）。
  }
  return new Response(JSON.stringify(dto), {
    // step 10：release settle 之后从 DTO 构造；不设 location（AC1）。
    status: 201,
    headers: { 'content-type': JSON_CONTENT_TYPE },
  });
}
