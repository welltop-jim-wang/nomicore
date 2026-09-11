/**
 * 请求 body 读取与解析后资源检查（ADR 0015 §JSON 处理与资源限制 L94–115）——
 * **包内私有**模块：不进 `package.json` exports，也不从 `src/index.ts` re-export。
 *
 * 职责（step 4/5）：
 * - 有界收集 body bytes：`Content-Length` 仅作提前拒绝优化，stream **始终**执行
 *   byte 上限；读取阶段尊重 `Request.signal`（中断 → `reader.cancel()` best-effort →
 *   普通 `Error` rejection，零 Registry 触达；读取完成后不再查阅 signal）；
 * - 严格 UTF-8 解码（`{ fatal: true }`）：失败 → 400 `INVALID_BODY_ENCODING`；
 * - 顶层形状检查（非数组 object、恰 `schemaText` + `root` 两个 own keys、`schemaText`
 *   必须 string——空串交 VFSL 领域）；
 * - 解析后以**显式栈迭代** DFS 检查 depth / nodes / 不安全整数，避免递归栈溢出。
 *
 * 所有 4xx/413 结算以 `RestProblemFailure` 抛出，由 `create-namespace.ts` 转换为
 * problem Response；abort 与其余内部异常原样 rejection（fail loud）。
 */
import { REST_PROBLEM_CODES, createRestProblemFailure } from './rest-problem.js';

/** abort（读取阶段客户端取消）的固定 rejection message（不产生任何 Response）。 */
export const ABORTED_BODY_READ_MESSAGE = 'REST create aborted during body read';

/** step 5a 形状检查产物（`root` 值合法性归 Registry/VFSL）。 */
export interface CreateRequestBody {
  readonly schemaText: string;
  readonly root: unknown;
}

function createAbortedError(signal: AbortSignal | undefined): Error {
  return signal === undefined
    ? new Error(ABORTED_BODY_READ_MESSAGE)
    : new Error(ABORTED_BODY_READ_MESSAGE, { cause: signal.reason });
}

/**
 * step 4：有界读取 + 严格 UTF-8 解码。
 *
 * 失败语义：
 * - 读前已 aborted / 读取期间 abort → 普通 `Error`（固定 message，cause 携带
 *   `signal.reason`）rejection，零 Response；
 * - `Content-Length` > 上限 → 413 `BODY_TOO_LARGE`（不读 stream）；
 * - body 为 null 或累计 0 bytes → 400 `EMPTY_BODY`；
 * - stream 累计 bytes > 上限 → best-effort `reader.cancel()` 后恒定 413
 *   `BODY_TOO_LARGE`（cancel 的 resolve/reject/throw 不参与结算）；
 * - 严格 UTF-8 解码失败 → 400 `INVALID_BODY_ENCODING`。
 */
export async function readBoundedBodyText(
  request: Request,
  maxBodyBytes: number,
): Promise<string> {
  const signal: AbortSignal | undefined = request.signal;
  if (signal !== undefined && signal.aborted) {
    throw createAbortedError(signal);
  }
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    const declared = Number(declaredLength);
    if (Number.isFinite(declared) && declared > maxBodyBytes) {
      throw createRestProblemFailure(413, REST_PROBLEM_CODES.BODY_TOO_LARGE);
    }
  }
  const body = request.body;
  if (body === null) {
    throw createRestProblemFailure(400, REST_PROBLEM_CODES.EMPTY_BODY);
  }
  const reader = body.getReader();
  let aborted = false;
  const onAbort = (): void => {
    aborted = true;
    // best-effort：abort 的结算不依赖 cancel 结果（也绝不把 rejection 变成 Response）。
    reader.cancel().catch(() => {});
  };
  if (signal !== undefined) signal.addEventListener('abort', onAbort, { once: true });
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      let outcome: Awaited<ReturnType<typeof reader.read>>;
      try {
        outcome = await reader.read();
      } catch (error) {
        if (aborted) throw createAbortedError(signal);
        throw error;
      }
      if (aborted) throw createAbortedError(signal);
      if (outcome.done) break;
      const chunk = outcome.value;
      if (chunk === undefined) continue;
      totalBytes += chunk.byteLength;
      if (totalBytes > maxBodyBytes) {
        // 超限：cancel 为 best-effort 且不参与结算——413 恒定产生。
        reader.cancel().catch(() => {});
        throw createRestProblemFailure(413, REST_PROBLEM_CODES.BODY_TOO_LARGE);
      }
      chunks.push(chunk);
    }
  } finally {
    // 读取完成 / 失败 / abort 一律移除监听（生命周期对称）。
    if (signal !== undefined) signal.removeEventListener('abort', onAbort);
  }
  if (totalBytes === 0) {
    throw createRestProblemFailure(400, REST_PROBLEM_CODES.EMPTY_BODY);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw createRestProblemFailure(400, REST_PROBLEM_CODES.INVALID_BODY_ENCODING);
  }
  return text;
}

/**
 * step 5a：顶层形状（ADR 0015 L72–75）——非数组 object、恰 `schemaText` + `root` 两个
 * own keys、`schemaText` 必须 string；`root` 显式存在即可（值合法性归 Registry/VFSL）。
 */
export function assertTopLevelShape(parsed: unknown): CreateRequestBody {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw createRestProblemFailure(400, REST_PROBLEM_CODES.INVALID_REQUEST_SHAPE);
  }
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== 2 ||
    !Object.prototype.hasOwnProperty.call(record, 'schemaText') ||
    !Object.prototype.hasOwnProperty.call(record, 'root')
  ) {
    throw createRestProblemFailure(400, REST_PROBLEM_CODES.INVALID_REQUEST_SHAPE);
  }
  const schemaText = record['schemaText'];
  if (typeof schemaText !== 'string') {
    throw createRestProblemFailure(400, REST_PROBLEM_CODES.INVALID_REQUEST_SHAPE);
  }
  return { schemaText, root: record['root'] };
}

/**
 * step 5c：解析后资源检查（**显式栈迭代**，pre-order 确定序；首个违例决定结算）：
 * - 进入容器时容器嵌套层级 > `maxJsonDepth` → 413 `JSON_DEPTH_EXCEEDED`；
 * - 每访问一个值节点（对象/数组/标量；键名不计）nodes > `maxJsonNodes` → 413
 *   `JSON_NODES_EXCEEDED`；
 * - number 非有限，或整数且非安全整数 → 400 `NUMBER_OUT_OF_RANGE`（`-0` 无额外语义）。
 */
export function assertPostParseResourceLimits(
  parsed: unknown,
  maxJsonDepth: number,
  maxJsonNodes: number,
): void {
  let nodes = 0;
  const stack: Array<{ readonly value: unknown; readonly containerDepth: number }> = [
    { value: parsed, containerDepth: 0 },
  ];
  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) break;
    nodes += 1;
    if (nodes > maxJsonNodes) {
      throw createRestProblemFailure(413, REST_PROBLEM_CODES.JSON_NODES_EXCEEDED);
    }
    const value = frame.value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
        throw createRestProblemFailure(400, REST_PROBLEM_CODES.NUMBER_OUT_OF_RANGE);
      }
      continue;
    }
    if (value === null || typeof value !== 'object') continue;
    const containerDepth = frame.containerDepth + 1;
    if (containerDepth > maxJsonDepth) {
      throw createRestProblemFailure(413, REST_PROBLEM_CODES.JSON_DEPTH_EXCEEDED);
    }
    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index -= 1) {
        stack.push({ value: value[index], containerDepth });
      }
    } else {
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record);
      for (let index = keys.length - 1; index >= 0; index -= 1) {
        const key = keys[index];
        if (key === undefined) continue;
        stack.push({ value: record[key], containerDepth });
      }
    }
  }
}
