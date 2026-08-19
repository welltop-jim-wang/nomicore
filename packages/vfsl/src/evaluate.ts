/**
 * 求值器核心（issue #20，ADR 0003 四决策落地）：IR(VfslModule) → 派生 schema。
 *
 * 纯函数、同步、**不抛错**：任何内部异常经顶层 catch 转为 `{ ok: false, issues:
 * [VFSL-E100 …] }`——与 parseVfsl 的 §15.4 崩溃边界逐项同款（instanceof 守卫
 * 镜像 index.ts:46；makeIssue 保证 'VFSL-E100:' 冻结前缀构造同源）。
 *
 * 实现权威（设计 §4.2）：结构树中 ref 的处置共四类，除此之外不存在第五种——
 *   解析点① ROOT 入口（resolveChain 后物化）；
 *   解析点② YMap 实参（materializeMapForm）；
 *   解析点③ Record 值位（resolveChain 后按全景表落行）；
 *   无子终态内联（决策 F4：链终点为 plain/leaf/xml-fragment → 直接产出终态节点）。
 * 其余一切结构形 ref 均为按名终态 `{ kind:'ref', name }`——O(文本规模) 的充分条件。
 *
 * 两树不对称（设计 §4.2 末）：结构树侧 Record 值位解析（索引/下钻可达）；值 schema
 * 侧 Record 值位仍 ref 终态（`values` 有自己的全量别名表支撑穿透）。
 */
import { makeIssue, ErrCode } from './errors.js';
import type { VfslModule, VfslType, VfslField } from './ir.js';
import { buildResolver, InternalError } from './resolve.js';
import type { Resolver } from './resolve.js';
import type {
  DerivedSchema,
  Discriminator,
  EvaluateResult,
  IndexEntry,
  MapField,
  StructureNode,
  ValueField,
  ValueSchema,
} from './derived.js';

/** 求值期共享状态（index 在 ROOT 物化遍历中就地填充，设计 §7.1）。 */
interface Ctx {
  R: Resolver;
  index: Record<string, IndexEntry>;
}

/**
 * 公共第二导出（ADR 0003 §1）：同步、纯函数、不抛错。
 * 前置条件：module 须为 parseVfsl 的 ok:true 产物；手工构造的 IR（含环、未声明
 * 名、非 map 形 ROOT、重名）落入 loud 内部错误边界 → ok:false E100，不静默产出
 * 垃圾派生物（设计 §2.2）。
 */
export function evaluate(module: VfslModule): EvaluateResult {
  try {
    const R = buildResolver(module);
    const index: Record<string, IndexEntry> = {};
    const ctx: Ctx = { R, index };
    const aliases: Record<string, StructureNode> = {};
    for (const a of module.aliases) {
      // 别名表物化一律 path=null 不产索引行（IR 声明序 → 表插入序，确定性）。
      aliases[a.name] = structureOf(a.type, ctx, null);
    }
    // ROOT 缺席（手造 IR）→ resolveChain(undefined) 抛 TypeError → 顶层 catch 收编。
    const rootType = module.aliases.find((a) => a.name === 'ROOT')?.type;
    const rootNode: StructureNode = { kind: 'root', node: structureOf(R.resolveChain(rootType), ctx, 'ROOT') };
    index['ROOT'] = { match: 'exact', node: rootNode };
    const values: Record<string, ValueSchema> = {};
    for (const a of module.aliases) values[a.name] = valueOf(a.type, ctx);
    const docs = collectDocs(module); // 新增：独立一遍，位于 try 内（异常 → E100）
    return {
      ok: true,
      derived: {
        aliases,
        structure: rootNode,
        values,
        index,
        aliasDocs: docs.aliasDocs,
        fieldDocs: docs.fieldDocs,
        markerDocs: docs.markerDocs,
      },
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, issues: [makeIssue(ErrCode.E100, `内部错误（意外异常）: ${detail}`, 1, 1)] };
  }
}

// —— §4.1 结构树物化（折叠规则全景表）——

function structureOf(t: VfslType, ctx: Ctx, path: string | null): StructureNode {
  switch (t.kind) {
    case 'primitive':
    case 'literal':
    case 'pattern':
      return { kind: 'leaf' };

    case 'ref': {
      // 决策 F4：按链终点分流——无子终态（plain/leaf/xml-fragment）内联，结构形按名。
      const r = ctx.R.resolveChain(t);
      if (isNoChildTerminal(r)) return terminalOf(r);
      return { kind: 'ref', name: t.name };
    }

    case 'object':
      return materializeObject(t, ctx, path);

    case 'array':
      return arrayNode(t.element, ctx, path);

    case 'record': {
      // §4.2 解析点③：值位先沿 ref 链取终形再物化（一律解析，非「联合特判」）。
      // 值位节点在自身语法路径处物化（§7.1：每节点为直接子项立行）。
      const childPath = path === null ? null : `${path}.<key>`;
      const valueNode = structureOf(ctx.R.resolveChain(t.value), ctx, childPath);
      const fields: MapField[] = [{ name: '<key>', optional: false, node: valueNode }];
      if (path !== null) {
        // §7.1 record 行：行内 node 与树内字段节点同一对象引用。
        const kp = keyPatternOf(t.key, ctx);
        indexRow(ctx, `${path}.<key>`, 'pattern', kp, valueNode);
      }
      return { kind: 'map', fields };
    }

    case 'union': {
      // 规则 3：全标量联合 → 原生叶子（成员细节入值 schema 枚举，两树正交）。
      if (ctx.R.typeCls(t) === 'scalar') return { kind: 'leaf' };
      // 分支列表（any-of）：先建 members，后条件附加判别式（缓存仅附加，§5.2）。
      const members = t.members.map((m) => structureOf(m, ctx, null)); // §7.2 union 停——成员不立行
      return unionNode(members, t, ctx);
    }

    case 'marker': {
      switch (t.marker) {
        case 'YMap':
          return materializeMapForm(t.arg, ctx, path); // 解析点②
        case 'YArray':
          return arrayNode(t.arg, ctx, path);
        case 'YXmlFragment':
          return { kind: 'xml-fragment' }; // 不透明终态；实参整体丢弃（ADR 0003 §5）
        case 'YLeaf':
          return { kind: 'leaf' };
        case 'YPlainArray':
          return { kind: 'plain' }; // 规则 4：整个实参子树纯值上下文终态，不递归
      }
    }
  }
}

/** §4.2 解析点② — YMap 实参（E304 不变量：实参必为 map 形）。 */
function materializeMapForm(arg: VfslType, ctx: Ctx, path: string | null): StructureNode {
  const r = ctx.R.resolveChain(arg);
  switch (r.kind) {
    case 'object':
      return materializeObject(r, ctx, path);
    case 'record':
      return structureOf(r, ctx, path); // 值位走解析点③（与 record 行同规则）
    case 'union': {
      // 决策 F1 透传，成员物化、结构形 ref 成员保持 ref 终态（§4.2 解析点②）。
      // E304 保证实参 map 形——全标量联合属非 map 形，手造 IR 落入 loud 边界（§9 I4）。
      if (ctx.R.typeCls(r) === 'scalar') {
        throw new InternalError('E304 不变量: YMap 实参非 map 形（全标量联合）');
      }
      const members = r.members.map((m) => structureOf(m, ctx, null)); // §7.2 union 停——成员不立行
      return unionNode(members, r, ctx);
    }
    case 'marker':
      if (r.marker === 'YMap') return materializeMapForm(r.arg, ctx, path); // 嵌套 YMap<YMap<…>>
      throw new InternalError(`E304 不变量: YMap 实参非 map 形（${r.marker}）`);
    default:
      throw new InternalError(`E304 不变量: YMap 实参非 map 形（${r.kind}）`);
  }
}

/** 裸对象 → map（字段声明序；字段位按 F4 分流）。 */
function materializeObject(
  t: Extract<VfslType, { kind: 'object' }>,
  ctx: Ctx,
  path: string | null,
): StructureNode {
  const fields: MapField[] = t.fields.map((f) => {
    // §7.1：字段节点在自身语法路径处物化（其下钻行以该路径为前缀）。
    const childPath = path === null ? null : `${path}.${f.name}`;
    const node = structureOf(f.type, ctx, childPath);
    if (path !== null) {
      // §7.1 map 行：f.node 与树内节点同一对象引用。
      indexRow(ctx, `${path}.${f.name}`, 'exact', undefined, node);
    }
    return { name: f.name, optional: f.optional, node };
  });
  return { kind: 'map', fields };
}

/** array 节点 + '<item>' pattern 行（裸 T[] 与 YArray 共用，§7.1）。 */
function arrayNode(elementType: VfslType, ctx: Ctx, path: string | null): StructureNode {
  const childPath = path === null ? null : `${path}.<item>`;
  const element = structureOf(elementType, ctx, childPath);
  if (path !== null) indexRow(ctx, `${path}.<item>`, 'pattern', undefined, element);
  return { kind: 'array', element };
}

/** 索引行落盘（keyPattern 仅 Record '<key>' 段携带；exactOptionalPropertyTypes 条件展开）。 */
function indexRow(
  ctx: Ctx,
  key: string,
  match: 'exact' | 'pattern',
  keyPattern: string | undefined,
  node: StructureNode,
): void {
  ctx.index[key] =
    keyPattern === undefined
      ? { match, node }
      : { match, keyPattern, node };
}

/** 决策 F4：链终点为无子终态（plain / leaf / xml-fragment）？ */
function isNoChildTerminal(r: VfslType): boolean {
  if (r.kind === 'marker') {
    return r.marker === 'YPlainArray' || r.marker === 'YXmlFragment' || r.marker === 'YLeaf';
  }
  return r.kind === 'primitive' || r.kind === 'literal' || r.kind === 'pattern';
}

/** 无子终态节点产出（O(1) 复制；ref 内联与直接拼写同形）。 */
function terminalOf(r: VfslType): StructureNode {
  if (r.kind === 'marker') {
    if (r.marker === 'YPlainArray') return { kind: 'plain' };
    if (r.marker === 'YXmlFragment') return { kind: 'xml-fragment' };
    return { kind: 'leaf' }; // YLeaf
  }
  return { kind: 'leaf' }; // primitive / literal / pattern
}

// —— §5.2 判别式检测（保守附加：全内联对象成员 + 公共非可选字面量字段 + 值两两互异）——

function unionNode(members: StructureNode[], t: Extract<VfslType, { kind: 'union' }>, ctx: Ctx): StructureNode {
  const d = detectDiscriminator(t, ctx);
  return d !== undefined ? { kind: 'union', members, discriminator: d } : { kind: 'union', members };
}

function detectDiscriminator(t: Extract<VfslType, { kind: 'union' }>, ctx: Ctx): Discriminator | undefined {
  // (a) 仅内联对象字面量成员；ref / 标记成员 → 不附加。
  if (!t.members.every((m) => m.kind === 'object')) return undefined;
  const first = t.members[0];
  if (first === undefined || first.kind !== 'object') return undefined; // 空联合（手造 IR 防御）
  // 候选按「首成员字段声明序」逐一遍历（E308 保证首成员字段无重名 → 序确定），
  // 取最先同时满足 (b)+(c) 的 F——纯语法判据，一经冻结永不漂移（§8.3）。
  for (const f of first.fields) {
    if (f.optional || f.type.kind !== 'literal') continue;
    const byValue: Record<string, number> = {};
    const seen = new Set<string>();
    let ok = true;
    for (let i = 0; i < t.members.length; i++) {
      // 显式注解切断 VfslType 递归推断循环（TS7022）。
      const m: VfslType = t.members[i]!;
      if (m.kind !== 'object') {
        ok = false;
        break;
      }
      // 显式注解切断 VfslType↔VfslField 相互递归下的推断循环（TS7022）。
      const mf: VfslField | undefined = m.fields.find((x) => x.name === f.name);
      // (b) 字段 F 在场且非可选且字面量；(c) 值两两互异（键恒 String(字面量)，§5.2 消费纪律）。
      if (mf === undefined || mf.optional || mf.type.kind !== 'literal') {
        ok = false;
        break;
      }
      const key = String(mf.type.value);
      if (seen.has(key)) {
        ok = false;
        break;
      }
      seen.add(key);
      byValue[key] = i; // 插入序 = 成员声明序
    }
    if (ok) return { field: f.name, byValue };
  }
  return undefined;
}

// —— §6 值 schema 映射（IR 同态，永不解析 ref）——

function valueOf(t: VfslType, ctx: Ctx): ValueSchema {
  switch (t.kind) {
    case 'primitive':
      return { kind: 'scalar', type: t.name };
    case 'literal':
      return { kind: 'enum', values: [t.value] }; // 单字面量 → 单元枚举（判别一致性断言依赖）
    case 'pattern':
      return { kind: 'pattern', regex: t.regex };
    case 'ref':
      return { kind: 'ref', name: t.name }; // 永不展开（含 Record 值位、无子终态目标）
    case 'object': {
      const fields: ValueField[] = t.fields.map((f) => ({
        name: f.name,
        value: f.optional ? { kind: 'optional', value: valueOf(f.type, ctx) } : valueOf(f.type, ctx),
      }));
      return { kind: 'object', fields };
    }
    case 'array':
      return { kind: 'array', element: valueOf(t.element, ctx) };
    case 'record': {
      // 决策 F2：object 变体 + '<key>' 字段 + 可选 keyPattern（与索引条目同源）。
      const kp = keyPatternOf(t.key, ctx);
      const fields: ValueField[] = [{ name: '<key>', value: valueOf(t.value, ctx) }];
      return kp === undefined ? { kind: 'object', fields } : { kind: 'object', fields, keyPattern: kp };
    }
    case 'union': {
      // 枚举折叠只认全字面量；否则 union 节点（判别式与结构树同源附加）。
      const literals = t.members.filter(isLiteral);
      if (literals.length === t.members.length) {
        return { kind: 'enum', values: literals.map((m) => m.value) }; // 声明序
      }
      const members = t.members.map((m) => valueOf(m, ctx));
      const d = detectDiscriminator(t, ctx);
      return d !== undefined ? { kind: 'union', members, discriminator: d } : { kind: 'union', members };
    }
    case 'marker': {
      switch (t.marker) {
        case 'YMap':
          return valueOf(t.arg, ctx); // 物化标记在值语义透明
        case 'YArray':
        case 'YPlainArray':
          return { kind: 'array', element: valueOf(t.arg, ctx) }; // 纯值数组就是 JSON 数组
        case 'YLeaf':
          return valueOf(t.arg, ctx);
        case 'YXmlFragment':
          return { kind: 'xml' }; // JSON 快照值为 XML 字符串（ADR 0003 §5）
      }
    }
  }
}

function isLiteral(t: VfslType): t is Extract<VfslType, { kind: 'literal' }> {
  return t.kind === 'literal';
}

/** Record 键约束（E306 不变量：键必为 string 形；索引条目与值树共用，同一结果）。 */
function keyPatternOf(keyType: VfslType, ctx: Ctx): string | undefined {
  const r = ctx.R.resolveChain(keyType);
  if (r.kind === 'pattern') return r.regex;
  if (r.kind === 'primitive' && r.name === 'string') return undefined; // 无约束键 → 省略键
  throw new InternalError(`E306 不变量: Record 键非 string 形（${r.kind}）`);
}

// —— docs 三表收集（ADR 0005 §3 落地；IR 全子树一遍遍历，ref 终态不展开）——

interface DocsTables {
  aliasDocs: Record<string, string[]>;
  fieldDocs: Record<string, string[]>;
  markerDocs: Record<string, string[]>;
}

/** 手造 IR loud 边界守卫（§3.4）：三锚统一写入入口——缺失/非数组抛 TypeError（→ E100），禁止静默规范化。 */
function put(table: Record<string, string[]>, key: string, docs: string[]): void {
  if (!Array.isArray(docs)) throw new TypeError(`docs 槽缺失或非数组（手造 IR）：${key}`);
  table[key] = docs; // 单值位：逐字引用（§4.2 纯度注）
}

/** §3.3 同路径嵌套标记按源序串联（守卫同 §3.4）。 */
function appendDocs(table: Record<string, string[]>, key: string, docs: string[]): void {
  if (!Array.isArray(docs)) throw new TypeError(`docs 槽缺失或非数组（手造 IR）：${key}`);
  table[key] = [...(table[key] ?? []), ...docs];
}

function collectDocs(module: VfslModule): DocsTables {
  const tables: DocsTables = { aliasDocs: {}, fieldDocs: {}, markerDocs: {} };
  for (const a of module.aliases) {
    put(tables.aliasDocs, a.name, a.docs); // 声明序 → 表插入序（确定性，同 aliases 表）
    walkDocs(a.type, a.name, tables);
  }
  return tables;
}

/** §3.2 路径文法：每别名树一遍遍历；ref 终态不穿越（ADR 0003 §4）。 */
function walkDocs(t: VfslType, path: string, tables: DocsTables): void {
  switch (t.kind) {
    case 'ref':
    case 'primitive':
    case 'literal':
    case 'pattern':
      return; // 终态
    case 'object':
      for (const f of t.fields) {
        const p = `${path}.${f.name}`;
        put(tables.fieldDocs, p, f.docs); // 三锚统一守卫入口（§3.4）
        walkDocs(f.type, p, tables);
      }
      return;
    case 'union':
      t.members.forEach((m, i) => walkDocs(m, `${path}.<member ${i}>`, tables));
      return;
    case 'array':
      walkDocs(t.element, `${path}.<item>`, tables);
      return;
    case 'record': {
      const p = `${path}.<key>`; // 合成字段：IR record 无 docs 槽 → 恒空数组
      put(tables.fieldDocs, p, []); // 字面量 [] 恒过守卫；走统一入口保持同形
      walkDocs(t.key, p, tables);
      walkDocs(t.value, p, tables);
      return;
    }
    case 'marker': {
      appendDocs(tables.markerDocs, path, t.docs); // §3.3 串联（守卫同 §3.4）
      // YMap/YXmlFragment/YLeaf 实参透明；YArray/YPlainArray 实参入 '<item>' 段
      const argPath = t.marker === 'YArray' || t.marker === 'YPlainArray' ? `${path}.<item>` : path;
      walkDocs(t.arg, argPath, tables);
      return;
    }
  }
}
