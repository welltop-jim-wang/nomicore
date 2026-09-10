/**
 * create 编排（ADR 0015 L18：**包内私有**）——不进 `package.json` exports 白名单，仅由
 * `./rest.js` 相对导入；外部消费者被打包面结构性阻断，私有性不依赖注释纪律。
 *
 * 固定顺序（B-3，不可 reorder；ADR 0015 step 4 → 6 → 7 → 8 → 9 → 10）：
 * 最小 body 读取 → 机械提取（顶层 object、`schemaText` string、`root` 键存在）→
 * `deriveSchemaIdentity` 派生身份 → 组装完整 SCHEMA envelope（四键含原文 text）→
 * `Registry.create({ owner, schema, root })` → 复制 owned plain DTO → 恰一次
 * `lease.release()`（等待 settle、失败不重试）→ 从 DTO 构造 201（不设 Location）。
 *
 * 未映射结局一律 fail loud（rejection，不发明 HTTP 错误映射；FR-3 错误契约票替换）；
 * `root` 值的领域合法性归 Registry/VFSL——REST 不预设其具体形状（ADR 0015 L75）。
 */
import { deriveSchemaIdentity } from '@nomicore/vfsl';
import type { NamespaceRegistry } from '@nomicore/namespace-registry';

/** SCHEMA envelope 上下文常量（ADR 0015 L119–125）。 */
const SCHEMA_LANG = 'vfsl';
const SCHEMA_VERSION = 1;

const JSON_CONTENT_TYPE = 'application/json';

/**
 * Hub 成功路径编排（REST router 私有实现面；ADR 0015 step 4–10）。
 *
 * 失败语义（D5）：body/JSON 异常原样传播；顶层形状不合规、`deriveSchemaIdentity`
 * `ok:false`、`registry.create` 窄 issue 均以内部 `Error` rejection 结算（携带 cause），
 * 不产生任何 HTTP 错误 Response。release 失败是本函数唯一被吞的错误（ADR 0015 L161）：
 * 不改变已知创建事实——仍 201、不重复调用 release。
 */
export async function orchestrateCreateNamespace(
  registry: NamespaceRegistry,
  ownerUserId: string,
  request: Request,
): Promise<Response> {
  const body: unknown = await request.json(); // step 4 最小读取（有界/严格 UTF-8/signal = FR-1）
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('unmapped request shape（400 映射延后）');
  }
  const record = body as Readonly<Record<string, unknown>>;
  const schemaText = record['schemaText'];
  if (typeof schemaText !== 'string' || !('root' in record)) {
    // 机械提取前置（仅查键存在与 string 类型）；不是 step 5 的 400 Response 校验策略。
    throw new Error('unmapped request shape（400 映射延后）');
  }
  const derived = deriveSchemaIdentity(schemaText); // step 6：公共窄接口；同步、纯、不抛
  if (!derived.ok) {
    throw new Error('unmapped VFSL issues（422 映射延后）', { cause: derived.issues });
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
    root: record['root'], // 值合法性归 Registry/VFSL（null 等显式值原样透传）
  }); // step 7：恰三键输入
  if (!created.ok) {
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
