/**
 * @nomicore/namespace-runtime —— readData 语义 schema 投影组合面（issue #273 / ADR-0016）。
 *
 * 本模块是 `readData` 成功分支的 schema 附加单点（ADR-0016 §分层 L75：「namespace-runtime
 * 组合两者」）：D3a 状态守卫（无 active schema → null）+ D3b 敌意 path 规范化守卫 +
 * `resolveSchemaAtPath` 消费（resolver 只见普通数组副本）+ D5 每次读整体 identity-memo
 * 深拷贝（detached、可变普通副本、不冻结、零缓存）。
 *
 * 错误处置双域划界（D4，SA1 设计 §7-D3b/D4；公共契约在 NamespaceRuntime.readData JSDoc
 * 同步记录）：
 * - 敌意/异态 path（非普通数组、Proxy 或重定义 `Symbol.iterator`、长度异型、非
 *   string|number 段、path 属性读取抛出的任意异常）→ `schema: null`（ADR-0016 情形③
 *   收敛；读恒 ok、`value` 语义零影响、绝不外抛——镜像 doc-runtime `safeSpreadPath`/
 *   E100 敌意面纪律）。收编点 = `normalizeReadPath` 的**内层 try**，它只包裹敌意 path
 *   扫描（输入域），**不包裹** `resolveSchemaAtPath` 调用——后续维护者不得把该内层
 *   try 误判为「F-1 前遗留的漏改」或误扩大到可信域；
 * - `InternalError`（可信域畸形 derived：ref 目标缺失、值树引用环、两树分歧、
 *   root/ROOT 缺失等——resolver 无顶层 catch 的刻意 loud 设计）→ throw 逃逸读面，
 *   internal-bug-only、生产不可达（`activeTools.derived` 恒为自身 P0/SCHEMA 写槽
 *   `compileSchemaEnvelope` ok 产物）。本模块对 resolver 调用不加任何 try/catch：
 *   `InternalError` 是唯一逃逸 throw 通道（敌意输入零 throw）。
 *
 * 组合顺序（D2，runtime.ts 落实）：值读先行——失败短路时本模块不可达（失败对象不带
 * schema 键）；成功读的 schema 由本模块产出（状态守卫先于 path 守卫：无 active schema
 * 时不触碰敌意对象）。
 *
 * 深拷贝输入 `resolved` 只来自 resolver ok 分支（D3b 已把敌意面收敛在 null），拷贝器
 * 按 `kind` 显式分派；memo 先登记后递归——共享节点保共享同构、假想环不发散（防御性：
 * resolver 自身游走已带身份守卫，但拷贝器是独立遍历，不依赖该实现细节）。docs/aliasDocs
 * 虽为 resolver 每调用新鲜产物（#272 L447–463），仍统一拷贝——隔离不变量由本模块独立
 * 保证，不依赖 resolver 内部新鲜性实现细节。
 */
import { resolveSchemaAtPath } from '@nomicore/vfsl';
import type { ReadDataSchemaProjection, ValueSchema } from '@nomicore/vfsl';
import type { RuntimeState } from './p0.js';

/**
 * readData 成功分支的 schema 投影入口（D3a + D3b + resolver + D5；runtime.ts readData
 * ready 分支消费）。返回 detached 深拷贝投影，或 null（无 active schema / 敌意或异态
 * path / resolver 两码收敛——null 单义，不细分原因，不是读的失败）。
 */
export function projectReadDataSchema(
  state: RuntimeState,
  path: readonly (string | number)[],
): ReadDataSchemaProjection | null {
  const tools = state.activeTools;
  // D3a 情形①：无 active schema（preparing/unavailable；fatal 期 schemaState 停留
  // 'preparing' 且 activeTools 未安装——B5 天然覆盖，不读 state.fatal）。状态守卫先于
  // path 守卫：无 active schema 时不触碰敌意对象（零敌意代码执行面、零无谓扫描）。
  if (state.schemaState !== 'ready' || tools === undefined) return null;
  // D3b 敌意 path 规范化守卫（F-1）：异态/异常 → null（情形③收敛，绝不外抛）。
  const normalized = normalizeReadPath(path);
  if (normalized === null) return null;
  // resolver 只见普通数组副本；可信域畸形 derived 的 InternalError 由此直通逃逸
  // （D4：不加 catch、不收敛 null、不降级码——唯一逃逸 throw 通道）。
  const resolved = resolveSchemaAtPath(tools.derived, normalized);
  if (!resolved.ok) return null; // 情形②/③：路径偏离 schema / 静态解析失败（两码同收敛）
  return detachReadSchemaProjection(resolved);
}

/**
 * 敌意 path 规范化（D3b，SA2 F-1 修订核心）：仅以普通属性读（length/[i]/
 * `Symbol.iterator` 同一性比较）扫描并拷贝入普通数组，全程包内层 try；任何异常、
 * 迭代器非标准、长度异型或非 string|number 段 → null（schema:null 收敛，绝不外抛）。
 * 绝不调用迭代协议（不 spread、不 for..of、不 Array.from）。
 *
 * 设计要点（SA1 设计 §7-D3b）：
 * 1. 内层 try 只包裹敌意 path 扫描本身，不包裹 resolveSchemaAtPath 调用（D4 可信域
 *    通道保持零 catch——两域处置在代码结构上物理分离）；
 * 2. 迭代纯度校验使「exotic-but-indexable 但索引读正常」的数组（重定义迭代器的真数组
 *    T1、对 Symbol.iterator 键抛出的 Proxy T2）确定收敛 null——敌意对象的语义不可信
 *    （可非确定、可有副作用），纪律是 fail-closed 收敛（null），与 doc-runtime
 *    `safeSpreadPath` 敌意数组坍缩为 `[]` 同一姿势的 schema 面对偶；
 * 3. 普通数组副本传 resolver——即便未来 resolver 内部消费方式演变（其 for..of/
 *    [...path] 均只见普通数组），防御自包含、不依赖 resolver 实现细节；
 * 4. 段语义不在此重复：本守卫只做句法域检查（普通数组 + string|number），段的语义
 *    合法性仍由 resolver 两码单义收敛（D3 原有「resolver 是段语义唯一裁决者」保持）。
 */
function normalizeReadPath(path: readonly (string | number)[]): Array<string | number> | null {
  try {
    if (!Array.isArray(path)) return null; // 防御（值通道 G0 已挡非数组；此处为内部直调者兜底）
    // 迭代纯度：重定义/Proxy 陷阱 → null（属性读 + 同一性比较，不调用迭代器——
    // 敌意迭代器函数从头到尾不被调用，T1 以调用计数器锚定）
    if (path[Symbol.iterator] !== Array.prototype[Symbol.iterator]) return null;
    const n = path.length; // 属性读，非迭代
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) return null;
    const out: Array<string | number> = [];
    for (let i = 0; i < n; i++) {
      const seg = path[i]; // 仅索引访问
      if (typeof seg !== 'string' && typeof seg !== 'number') return null; // 段域检查（B15 尾段 Symbol 在此被捕）
      out.push(seg);
    }
    return out; // 普通数组副本（原型 Array.prototype、标准迭代器）
  } catch {
    return null; // 敌意 trap/意外异常 → 收敛 null，绝不外抛
  }
}

/** identity-memo：同节点 → 同副本（保共享同构 + DAG 不膨胀 + 环不发散）。 */
type CloneMemo = Map<object, unknown>;

/**
 * D5：resolver ok 分支四件套整体深拷贝——每次读全新 wrapper + 全新四件套（零缓存）；
 * 可变普通副本（原型 Object.prototype，不冻结——红 #14 `Object.isFrozen` 锚）。
 */
function detachReadSchemaProjection(resolved: ReadDataSchemaProjection): ReadDataSchemaProjection {
  const memo: CloneMemo = new Map<object, unknown>();
  return {
    valueSchema: cloneValueSchema(resolved.valueSchema, memo),
    aliases: cloneValueSchemaRecord(resolved.aliases, memo),
    docs: cloneDocsRecord(resolved.docs),
    aliasDocs: cloneDocsRecord(resolved.aliasDocs),
  };
}

/**
 * 值语义子树克隆：逐 `kind` 显式分派（普通对象/数组字面量构造，不冻结）。容器节点
 * 先登记后递归（构造外壳 → memo.set → 递归填成员）——共享节点保共享、假想环不发散
 * （防御性；合法 derived 无环，见模块头注）。
 */
function cloneValueSchema(node: ValueSchema, memo: CloneMemo): ValueSchema {
  const memoized = memo.get(node);
  if (memoized !== undefined) return memoized as ValueSchema;
  switch (node.kind) {
    case 'object': {
      const out: Extract<ValueSchema, { kind: 'object' }> = { kind: 'object', fields: [] };
      memo.set(node, out); // 先登记后递归
      for (const field of node.fields) {
        out.fields.push({ name: field.name, value: cloneValueSchema(field.value, memo) });
      }
      if (node.keyPattern !== undefined) out.keyPattern = node.keyPattern;
      return out;
    }
    case 'array': {
      const out: Extract<ValueSchema, { kind: 'array' }> = { kind: 'array', element: node.element };
      memo.set(node, out); // 先登记后递归（外壳暂持原引用，递归返回后立即整替——单线程内不可观测）
      out.element = cloneValueSchema(node.element, memo);
      return out;
    }
    case 'union': {
      const out: Extract<ValueSchema, { kind: 'union' }> = { kind: 'union', members: [] };
      memo.set(node, out); // 先登记后递归
      for (const member of node.members) {
        out.members.push(cloneValueSchema(member, memo));
      }
      if (node.discriminator !== undefined) out.discriminator = cloneDiscriminator(node.discriminator);
      return out;
    }
    case 'optional': {
      const out: Extract<ValueSchema, { kind: 'optional' }> = { kind: 'optional', value: node.value };
      memo.set(node, out); // 先登记后递归
      out.value = cloneValueSchema(node.value, memo);
      return out;
    }
    case 'enum': {
      const out: Extract<ValueSchema, { kind: 'enum' }> = { kind: 'enum', values: [...node.values] };
      memo.set(node, out);
      return out;
    }
    case 'ref': {
      const out: Extract<ValueSchema, { kind: 'ref' }> = { kind: 'ref', name: node.name };
      memo.set(node, out);
      return out;
    }
    case 'pattern': {
      const out: Extract<ValueSchema, { kind: 'pattern' }> = { kind: 'pattern', regex: node.regex };
      memo.set(node, out);
      return out;
    }
    case 'scalar': {
      const out: Extract<ValueSchema, { kind: 'scalar' }> = { kind: 'scalar', type: node.type };
      memo.set(node, out);
      return out;
    }
    case 'xml': {
      const out: Extract<ValueSchema, { kind: 'xml' }> = { kind: 'xml' };
      memo.set(node, out);
      return out;
    }
  }
}

/** 判别式缓存克隆（纯数据：field 原语 + byValue 键为 String(字面量)——逐键构造，
 *  CreateDataPropertyOrThrow 语义防 '__proto__' 类键触发原型 setter）。 */
function cloneDiscriminator(discriminator: {
  field: string;
  byValue: Record<string, number>;
}): { field: string; byValue: Record<string, number> } {
  return {
    field: discriminator.field,
    byValue: cloneNumberRecord(discriminator.byValue),
  };
}

/** 别名表克隆：同 memo 传递——valueSchema 与 aliases 间共享节点产出同副本。 */
function cloneValueSchemaRecord(
  rec: Record<string, ValueSchema>,
  memo: CloneMemo,
): Record<string, ValueSchema> {
  // 键写入经 CreateDataPropertyOrThrow 语义（Object.fromEntries 逐键构造）——
  // '__proto__' 类键不触发原型 setter。键域同时结构性排除该键（VFSL tokenizer 标识符
  // 起始限 ASCII 字母，'_' 不可起始 → '__proto__' 不可作别名/语法路径段；SA2 N-5 独立
  // 核验成立）——双层防御，防未来重构退化为裸赋值。
  return Object.fromEntries(
    Object.keys(rec).map((k) => [k, cloneValueSchema(rec[k] as ValueSchema, memo)]),
  );
}

/** number 原语 record 克隆（判别式 byValue；同 CreateDataPropertyOrThrow 语义）。 */
function cloneNumberRecord(rec: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(rec));
}

/** docs/aliasDocs 克隆：新 record + 每条目新数组（[...entry]）；string 原语直传。
 *  键域与写入语义注释同 cloneValueSchemaRecord（N-5 判断依据保留）。 */
function cloneDocsRecord(rec: Record<string, readonly string[]>): Record<string, readonly string[]> {
  return Object.fromEntries(
    Object.keys(rec).map((k) => [k, [...(rec[k] as readonly string[])]]),
  );
}
