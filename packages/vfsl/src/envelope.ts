export const VFSL_LANG = 'vfsl';

/** 当前引擎已实现的最新方言版本。方言只增不改（设计文档 §9）。 */
export const VFSL_LATEST_DIALECT_VERSION = 1;

/**
 * `__schema__` 信封（设计文档 §6）：结构 + 语义层的唯一载体。
 * 整个信封作为单字符串值存入 doc（原子替换、可哈希、可 diff）。
 */
export interface SchemaEnvelope {
  readonly lang: typeof VFSL_LANG;
  /** 方言版本：语法子集 + 语义规格的版本，一经发布冻结。 */
  readonly version: number;
  /** 形如 `vfs3.assets@2` 的 schema 标识。 */
  readonly id: string;
  /** VFSL 文本本体（含全部 JSDoc）。 */
  readonly text: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * 解析 `__schema__` 信封。接受对象或 JSON 字符串两种输入。
 *
 * 结构不合法时返回 undefined 而不是抛错——对齐设计文档 §10.3：
 * “getSchema(doc) 对无 __schema__ 的 doc 返回 undefined，不抛错”。
 * 未知方言（version 超出引擎支持矩阵）是合法信封，由上层 DocScope 决定只读。
 */
export function parseSchemaEnvelope(raw: unknown): SchemaEnvelope | undefined {
  const value = typeof raw === 'string' ? tryParseJson(raw) : raw;
  if (!isRecord(value)) return undefined;
  const { lang, version, id, text } = value;
  if (lang !== VFSL_LANG) return undefined;
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) return undefined;
  if (typeof id !== 'string' || id.length === 0) return undefined;
  if (typeof text !== 'string' || text.length === 0) return undefined;
  return { lang, version, id, text };
}
