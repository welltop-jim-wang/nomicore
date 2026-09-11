/**
 * 核心纯发射器（§3）：派生 schema 的结构树 × 值树并行走查 → TS 类型文本。
 *
 * 两树不对称是求值器冻结契约（evaluate.ts 文件头明文）：结构侧 ref 仅在四个解析点
 * 展开，其余结构形 ref 为按名终态；值侧 ref 永不展开（values 有自己的全量别名表支撑
 * 穿透）。故同一位点上结构侧可能是已解析终形而值侧仍是 ref——五类合法配对实测见
 * 设计 §10 行 10。
 *
 * 【规则 0 · 值侧 ref 优先（R2/SA2 #1）】emitNode 首查值侧：`value.kind === 'ref'` →
 * 一律发射 `PathSchema<别名名, kindOf(别名名)>`，不论结构侧为何（ref 终态或经解析点
 * ①–④ 产出的已解析终形——两形同义，不属失配）。kindOf 沿 aliases 表取结构节点
 * （条目本身为 ref 则沿别名链解析，遇环 → throw），按 kind 映射为外壳 kind。
 *
 * 结构/值失配 = 响亮失败（拒绝虚假降级）：仅两侧均非 ref 时，kind 组合不在配对表
 * （§3.2 表）→ throw，绝不静默降级；未知 kind 同理。
 */
import type {
  DerivedSchema,
  MapField,
  StructureNode,
  ValueSchema,
} from '@nomicore/vfsl';
import { buildHeader } from './header.js';
import { PROTOCOL_EXPORT_NAMES, PROTOCOL_IMPORT_LINE } from './protocol-surface.js';
import { projectUnionMembers, projectValue } from './valuetype.js';
import { tsdocInline, tsdocLines } from './docs.js';

export interface GenerateProjectionOptions {
  /** 源文本（仅用于头注哈希；缺失时头注写 `sha256:<未提供>`，仍确定性）。 */
  sourceText?: string;
  /**
   * 无分号输出模式（issue #222）：面向强制 semicolon-free TypeScript 的消费仓
   * （Oxlint `@stylistic/semi: never` + `@stylistic/member-delimiter-style` multiline none）。
   * 开启后全文零分号——语句终止符（import/别名声明）省略、对象类型字面量与接口成员
   * 逐行无分隔符（多字段字面量转为多行布局）。默认 false，分隔符布局保持既有格式。
   * 多行 doc 块仅在此模式下消除 `/**` 后的行尾空格；默认模式保留既有字节。
   * 生成与 --check 必须使用同一取值（两种格式字节不同，混用必报过期）。
   */
  semicolonFree?: boolean;
}

/** ROOT 形态范围限界（§3.2.1）：F2 仅支持封闭 map 形（裸对象 / YMap）。 */
export class UnsupportedRootShapeError extends Error {
  readonly shape: string;

  constructor(shape: string) {
    super(
      `ROOT 形态不支持（F2 仅支持封闭 map 形：裸对象/YMap；得到 ${shape}）` +
        '——Record/联合形 ROOT 需协议层顶层动态键/成员并集语义，见 #44',
    );
    this.name = 'UnsupportedRootShapeError';
    this.shape = shape;
  }
}

/**
 * ref→ROOT 拦截（§3.4 R3 处置段 (a) 案，总控定夺）：ROOT 仅作入口根、不作引用目标——
 * 三检查点任一抵达 ROOT（值侧 ref 目标 / kindOf 链解析 / 段② 走查）→ 命名化 loud throw
 * （与 §3.2.1 同构；CLI 顶层 catch → 结构化 stderr + exit 2）。被引用 ROOT 的协议层
 * 扩展见 #44。
 */
export class UnsupportedRootReferenceError extends Error {
  readonly path: string;

  constructor(path: string) {
    super(
      `ROOT 不可被引用（F2 仅支持 ROOT 作入口根——顶层键 = ROOT 的字段；引用位 ${path} 抵达 ROOT）` +
        '——被引用 ROOT 需协议层引用目标语义，见 #44',
    );
    this.name = 'UnsupportedRootReferenceError';
    this.path = path;
  }
}

/**
 * 异形联合成员（§3.2 union 行，R3/SA2 R2-3）：联合成员结构 kind 无诚实单值
 * （VfslKind 五值词汇表无联合 kind）——禁止默认 'map' 误标（PathKind/序列编辑 API
 * 门禁失真），命名化响亮拒绝（CLI → exit 2 + 登记后续票）。
 */
export class UnsupportedUnionKindError extends Error {
  readonly kinds: string[];

  constructor(kinds: string[]) {
    super(
      `联合成员结构 kind 异形（F2 仅支持全员同形联合；得到 ${kinds.join(' | ')}）` +
        '——异形联合需协议层 PathKind 联合语义，见 #44',
    );
    this.name = 'UnsupportedUnionKindError';
    this.kinds = kinds;
  }
}

/**
 * 别名 × 协议导出名碰撞（§4，N3 守卫，issue #45）：段② 发射前置检查命中——领域别名
 * 与 `@nomicore/vfsl-protocol` 导出面（12 名冻结名单，protocol-surface.ts）同名。
 * 生成物以模块增广方式接线协议：文件作用域内 import 绑定 `PathSchema` 与本地同名 export
 * 同声明空间冲突（TS2440）；段③ 增广体内别名名解析优先命中被增广模块的导出——泛型名 →
 * 生成物编译错误（TS2314），非泛型名 → 编译干净但静默绑定协议类型、路径投影语义损坏。
 * 故全量拦截、响亮失败（独立错误码，CLI 顶层 catch → 结构化 stderr + exit 2），
 * 指引领域作者重命名别名（协议名冻结于 ADR-0004，领域别名是自由变量）。
 */
export class AliasProtocolExportCollisionError extends Error {
  /** 独立错误码（AC-3）：生成器发射层命名空间（与 parse 层 `VFSL-E<nnn>`、接缝层三码互斥）。 */
  readonly code = 'alias-protocol-export-collision';
  /** 全部碰撞别名（声明序，确定性）。 */
  readonly aliases: readonly string[];

  constructor(aliases: readonly string[]) {
    super(
      `领域别名与协议导出名碰撞：${aliases.map((a) => `'${a}'`).join('、')}` +
        '——生成物以模块增广方式接线协议，增广体内别名名会解析到协议导出' +
        '（泛型名 → 生成物编译错误；非泛型名 → 静默绑定协议类型、路径投影语义损坏）；' +
        `'@nomicore/vfsl-protocol' 的导出名不得作领域别名，请重命名领域别名`,
    );
    this.name = 'AliasProtocolExportCollisionError';
    this.aliases = aliases;
  }
}

/** 发射上下文：派生 schema 八槽（第八槽 memberDocs 条件在场）的只读视图 + 输出格式开关（纯函数，无状态）。 */
interface EmitTables {
  aliases: Record<string, StructureNode>;
  values: Record<string, ValueSchema>;
  aliasDocs: Record<string, string[]>;
  fieldDocs: Record<string, string[]>;
  markerDocs: Record<string, string[]>;
  /**
   * 成员级文档注释（ADR 0019 决策 5，issue #307 消费）：条件稀疏——整键仅在模块至少
   * 一名成员携带 doc 时在场，且只收非空条目。无 M4 输入的存量派生物此槽为 undefined，
   * 四个发射位因此输出零新字节（逐字节不变）。
   */
  memberDocs: Record<string, string[]> | undefined;
  /** 无分号模式（issue #222，见 GenerateProjectionOptions.semicolonFree）。 */
  readonly semicolonFree: boolean;
}

/**
 * N3（§4）：段② 发射前置守卫。别名名 × 协议导出面（12 名冻结名单）碰撞 → 命名化响亮失败，
 * 先于一切发射（失败零产出）。ROOT 不在协议导出面（ROOT 是 ADR-0003 根别名约定、非别名侧
 * 可声明名），集合成员测试天然排除，无需特判。不重复检查 parse 层保留名（RESERVED_NAMES
 * 16 名已在解析层拒收，parser.ts E303——单一真相，发射层不二次裁决）。
 */
function assertNoProtocolNameCollision(aliases: Record<string, StructureNode>): void {
  const collisions = Object.keys(aliases).filter((name) => PROTOCOL_EXPORT_NAMES.has(name));
  if (collisions.length > 0) throw new AliasProtocolExportCollisionError(collisions);
}

/**
 * §3.0 纯发射器：同输入逐字节同输出（CI regen-diff 前提）。
 * 输入 = evaluate 的派生 schema 八槽（输入形状冻结，不得改）；opts.sourceText 仅入头注哈希。
 */
export function generateProjection(derived: DerivedSchema, opts?: GenerateProjectionOptions): string {
  const tables: EmitTables = {
    aliases: derived.aliases,
    values: derived.values,
    aliasDocs: derived.aliasDocs,
    fieldDocs: derived.fieldDocs,
    markerDocs: derived.markerDocs,
    // 第四张 docs 表（#307 D1）：逐字引用，不复制、不规范化；四个发射位唯一数据入口。
    memberDocs: derived.memberDocs,
    semicolonFree: opts?.semicolonFree === true,
  };

  // §3.2 root 行 + §3.2.1 范围限界：剥壳取内层 map（封闭字段）；非封闭 map/联合形 → 响亮拒绝
  if (derived.structure.kind !== 'root') {
    throw new UnsupportedRootShapeError(`'${derived.structure.kind}' 形`);
  }
  const root = derived.structure.node;
  if (root.kind !== 'map' || isRecordForm(root)) {
    throw new UnsupportedRootShapeError(describeRootShape(root));
  }
  const rootValueSchema = derived.values['ROOT'];
  if (rootValueSchema === undefined) {
    throw new Error(`未知别名 'ROOT'（派生 schema values 槽缺 ROOT）`);
  }
  const rootValue = resolveValueRef(rootValueSchema, derived.values);
  if (rootValue.kind !== 'object') {
    throw desync(root, rootValue, 'ROOT');
  }

  // N3 守卫（§4）：段② 发射前置检查——别名名 × 协议导出面碰撞 → 命名化响亮失败
  assertNoProtocolNameCollision(derived.aliases);

  // 段② 具名别名声明（声明序 = aliases 键序；ROOT 除外；未引用的别名也发射【既有行为不变】）
  const aliasLines: string[] = [];
  for (const name of Object.keys(derived.aliases)) {
    if (name === 'ROOT') continue;
    aliasLines.push(emitAlias(name, tables));
  }

  // 段③ 增广载体（D5：顶层键 = ROOT 的字段，路径无 ROOT 前缀【逐行搬移，逻辑不变】）
  const augmentationLines: string[] = [];
  augmentationLines.push(`declare module '@nomicore/vfsl-protocol' {`);
  const rootDoc = tsdocLines(derived.aliasDocs['ROOT'], '  ', tables);
  if (rootDoc !== '') augmentationLines.push(rootDoc);
  augmentationLines.push('  interface VfslPathMap {');
  for (const field of root.fields) {
    augmentationLines.push(emitInterfaceMember(field, rootValue, tables));
  }
  augmentationLines.push('  }');
  augmentationLines.push('}');

  // §3.1 布局冻结：头注 / import 行 / 段② / 段③，相邻非空段恰一空行（段②空时连空行消失）
  // 无分号模式：接线行剥尾分号（PROTOCOL_IMPORT_LINE 仍为唯一数据源，派生而非另存副本）。
  const importLine = tables.semicolonFree ? PROTOCOL_IMPORT_LINE.replace(/;$/, '') : PROTOCOL_IMPORT_LINE;
  const sections = [
    [buildHeader(opts?.sourceText)],
    [importLine],
    aliasLines,
    augmentationLines,
  ].filter((section) => section.length > 0);
  return `${sections.map((section) => section.join('\n')).join('\n\n')}\n`;
}

// ---------------------------------------------------------------------------
// 段② 别名声明 / 段③ 接口成员
// ---------------------------------------------------------------------------

function emitAlias(name: string, tables: EmitTables): string {
  const node = tables.aliases[name]!;
  const value = tables.values[name]!;
  const doc = tsdocLines(tables.aliasDocs[name], '', tables);
  const head = doc === '' ? '' : `${doc}\n`;
  const term = tables.semicolonFree ? '' : ';';
  if (node.kind === 'union' && value.kind === 'union') {
    // 判别联合（§3.8）：成员声明序、成员互异；外壳 kind = 成员同形 kind（map 形 → 'map'）
    const common = unionKind(node, tables, name);
    // 无分号模式：map 成员字面量多行化后以 `  | ` 列为基准缩进（内层 +2、闭括号对齐 `|` 列）
    const members = emitUnionBodyMembers(node, value, name, tables, tables.semicolonFree ? '  ' : '', common);
    // #307 发射位 1（ADR 0019 决策 6.1）：成员 doc 块位于对应 `  | ` 成员行上方（缩进与 `|` 列
    // 对齐）；无 doc 时 lines 装配与既有 `  | ${members.join('\n  | ')}` 逐字节相同。
    const lines: string[] = [];
    members.forEach((text, i) => {
      const memberDoc = memberBlock(tables, name, i, '  ');
      if (memberDoc !== '') lines.push(memberDoc);
      lines.push(`  | ${text}`);
    });
    return `${head}export type ${name} =\n${lines.join('\n')}${term}`;
  }
  // #307 发射位 2（ADR 0019 决策 6.2）：坍缩别名（leaf×enum / leaf×union，含标量联合）
  // 有成员 doc 条目时转多行逐成员布局。W1 判据（SA6 §12.2）= 该位点 `<member N>` 键在
  // memberDocs 表中存在非空条目，N 覆盖值侧成员序号——不按值侧 kind / 成员数量推测；
  // 按位点独立。闸门闭合（无 M4 输入、M3 优先位、全部成员无条目、非 leaf 结构形）
  // → 既有单行路径逐字保留。成员文本由 projectUnionMembers 分段（与单行形态严格同源）。
  const memberCount = value.kind === 'enum' ? value.values.length : value.kind === 'union' ? value.members.length : 0;
  if (node.kind === 'leaf' && memberCount > 0) {
    const gated = Array.from({ length: memberCount }, (_, i) => memberDocsAt(tables, name, i)).some(
      (d) => d !== undefined,
    );
    if (gated) {
      const lines: string[] = [];
      projectUnionMembers(value, tables.values).forEach((text, i) => {
        const memberDoc = memberBlock(tables, name, i, '  ');
        if (memberDoc !== '') lines.push(memberDoc);
        lines.push(`  | ${text}`);
      });
      return `${head}export type ${name} =\n${lines.join('\n')}${term}`;
    }
  }
  return `${head}export type ${name} = ${emitInner(node, value, name, tables, '')}${term}`;
}

function emitInterfaceMember(
  field: MapField,
  rootValue: Extract<ValueSchema, { kind: 'object' }>,
  tables: EmitTables,
): string {
  const fieldPath = `ROOT.${field.name}`;
  const valueField = rootValue.fields.find((f) => f.name === field.name);
  if (valueField === undefined) throw desync(field.node, rootValue, fieldPath);
  const doc = tsdocLines(tables.fieldDocs[fieldPath], '    ', tables);
  const prefix = doc === '' ? '    ' : `${doc}\n    `;
  const key = isIdentifier(field.name) ? field.name : `'${field.name}'`;
  const { optional, value } = splitOptional(valueField.value);
  const term = tables.semicolonFree ? '' : ';';
  return `${prefix}${key}${optional}: ${emitNode(field.node, value, fieldPath, tables, '    ')}${term}`;
}

// ---------------------------------------------------------------------------
// emitNode / emitInner（§3.2 并行走查）
// ---------------------------------------------------------------------------

function emitNode(node: StructureNode, value: ValueSchema, path: string, tables: EmitTables, indent: string): string {
  const doc = tsdocLines(tables.markerDocs[path], '', tables);
  const kind =
    value.kind === 'ref'
      ? kindOfAlias(value.name, tables, path)
      : node.kind === 'union'
        ? unionKind(node, tables, path)
        : kindLiteral(node, tables, path);
  const inner = emitInner(node, value, path, tables, indent);
  return `${doc === '' ? '' : `${doc} `}PathSchema<${inner}, '${kind}'>`;
}

function emitInner(node: StructureNode, value: ValueSchema, path: string, tables: EmitTables, indent: string): string {
  // 规则 0：值侧 ref 优先——引用位内容 = 别名名（外壳 kind 由 kindOfAlias 定，见 emitNode）。
  // 检查点①/③（§3.4 R3）：值侧 ref 目标为 ROOT（含段② 直引形态 `X = ROOT`）→ 响亮拒绝
  if (value.kind === 'ref') {
    if (value.name === 'ROOT') throw new UnsupportedRootReferenceError(path);
    return value.name;
  }
  switch (node.kind) {
    case 'map': {
      if (value.kind !== 'object') throw desync(node, value, path);
      if (isRecordForm(node)) {
        // Record 形（动态键）：Pattern 键 → string；值位 = '<key>' 子树
        const valueField = value.fields.find((f) => f.name === '<key>');
        if (valueField === undefined) throw desync(node, value, path);
        const { value: inner } = splitOptional(valueField.value);
        return `Record<string, ${emitNode(node.fields[0]!.node, inner, `${path}.<key>`, tables, indent)}>`;
      }
      return emitObjectMembers(node.fields, value, path, tables, indent);
    }
    case 'array': {
      if (value.kind !== 'array') throw desync(node, value, path);
      // 裸 T[] 与 YArray 同形（D1）：下标段可解析、元素子表 = 元素节点的完整 PathSchema 树
      return `Record<\`\${number}\`, ${emitNode(node.element, value.element, `${path}.<item>`, tables, indent)}>`;
    }
    case 'plain': {
      if (value.kind !== 'array') throw desync(node, value, path);
      // R2.6 残留 1（注释级决策，v1 范围）：纯值上下文（YPlainArray 实参）内的
      // fieldDocs/markerDocs 无发射位——纯值终态丢弃 docs（v1 明示范围，语义无损）。
      return `${projectValue(value.element, tables.values)}[]`;
    }
    case 'union': {
      if (value.kind !== 'union') throw desync(node, value, path);
      // §3.2 union 行（R3）：成员结构 kind 全员同形 → 该 kind；异形 → 响亮拒绝
      const common = unionKind(node, tables, path);
      // #307 发射位 3（ADR 0019 决策 6.3）：成员 doc 行内前置（`/** d */ Member | …`），
      // 紧跟成员起点；`|` join 文法不变。无 doc 成员前缀为空串 → 输出逐字节同既有。
      return emitUnionBodyMembers(node, value, path, tables, indent, common)
        .map((text, i) => memberInlinePrefix(tables, path, i) + text)
        .join(' | ');
    }
    case 'leaf': {
      // scalar / enum / pattern / 标量联合（可空叶 = 值侧标量联合 → T | null）
      if (value.kind !== 'scalar' && value.kind !== 'enum' && value.kind !== 'pattern' && value.kind !== 'union') {
        throw desync(node, value, path);
      }
      // #307 发射位 4（ADR 0019 决策 6.4）：内联枚举 / 标量联合成员 doc 同行内前置。
      // scalar / pattern 无成员边界 → 原样；无 doc 前缀为空串 → 输出逐字节同既有。
      if (value.kind === 'enum' || value.kind === 'union') {
        return projectUnionMembers(value, tables.values)
          .map((text, i) => memberInlinePrefix(tables, path, i) + text)
          .join(' | ');
      }
      return projectValue(value, tables.values);
    }
    case 'xml-fragment': {
      if (value.kind !== 'xml') throw desync(node, value, path);
      return 'string'; // 不透明终态（ADR 0003 §5）：内层结构丢弃
    }
    default:
      throw desync(node, value, path);
  }
}

/**
 * 封闭 map → 对象类型字面量（含花括号；键一律加引号，§3.5；可选性以 ?: 在字段位表达）。
 * 默认模式：单行 `{ 'a': X; 'b': Y }`（逐字节保持 §3.9 v3 既有格式）。
 * 无分号模式（issue #222）：多行、成员逐行无分隔符（member-delimiter-style multiline=none），
 * 成员 doc 由行内位移至成员上一行；空 map 收敛为 `{}`。
 */
function emitObjectMembers(
  structFields: MapField[],
  valueObj: Extract<ValueSchema, { kind: 'object' }>,
  path: string,
  tables: EmitTables,
  indent: string,
): string {
  const parts: string[] = [];
  const childIndent = tables.semicolonFree ? `${indent}  ` : indent;
  for (const f of structFields) {
    const fieldPath = `${path}.${f.name}`;
    const valueField = valueObj.fields.find((vf) => vf.name === f.name);
    if (valueField === undefined) throw desync(f.node, valueObj, fieldPath);
    const { optional, value } = splitOptional(valueField.value);
    const body = `'${f.name}'${optional}: ${emitNode(f.node, value, fieldPath, tables, childIndent)}`;
    if (!tables.semicolonFree) {
      const doc = tsdocLines(tables.fieldDocs[fieldPath], '');
      parts.push(doc === '' ? body : `${doc} ${body}`);
    } else {
      const doc = tsdocLines(tables.fieldDocs[fieldPath], childIndent, tables);
      parts.push(doc === '' ? `${childIndent}${body}` : `${doc}\n${childIndent}${body}`);
    }
  }
  if (!tables.semicolonFree) return `{ ${parts.join('; ')} }`;
  if (parts.length === 0) return '{}';
  return `{\n${parts.join('\n')}\n${indent}}`;
}

/** 联合成员发射（声明序，common = 全员同形成员 kind）：
 *  值侧 ref → 规则 0（完整 PathSchema 外壳）；map×object → 裸对象字面量（§3.9 样例）；
 *  其余同形成员 → 内层发射（去外壳——别名声明与内联联合同构）。 */
function emitUnionBodyMembers(
  node: Extract<StructureNode, { kind: 'union' }>,
  value: Extract<ValueSchema, { kind: 'union' }>,
  path: string,
  tables: EmitTables,
  indent: string,
  common: string,
): string[] {
  return node.members.map((m, i) => {
    const memberValue = value.members[i];
    const memberPath = `${path}.<member ${i}>`;
    if (memberValue === undefined) throw desync(m, value, memberPath);
    if (memberValue.kind === 'ref') {
      return emitNode(m, memberValue, memberPath, tables, indent);
    }
    if (common === 'map') {
      if (m.kind === 'map' && memberValue.kind === 'object') {
        return emitObjectMembers(m.fields, memberValue, memberPath, tables, indent);
      }
      return emitNode(m, memberValue, memberPath, tables, indent);
    }
    return emitInner(m, memberValue, memberPath, tables, indent);
  });
}

// ---------------------------------------------------------------------------
// 成员 doc 查键与渲染（#307：ADR 0019 决策 6 四发射位的唯一 doc 查找点全集）
// ---------------------------------------------------------------------------

/**
 * 成员 doc 单点查键（#307 D1）：只按发射位语法路径 + 声明序索引查 `${path}.<member ${i}>`，
 * 绝不枚举表（键序与实现无关，确定性由声明序循环保证）。空数组条目视同缺席（W1 判据
 * 「存在非空条目」；合法派生物由 evaluate 冻结契约保证只收非空条目，此处为手造 derived
 * 的稳健性收口：不产出孤立空格字节）。
 */
function memberDocsAt(tables: EmitTables, path: string, i: number): readonly string[] | undefined {
  const docs = tables.memberDocs?.[`${path}.<member ${i}>`];
  return docs !== undefined && docs.length > 0 ? docs : undefined;
}

/** 块位成员 doc（#307 W2，发射位 1/2）：每条 doc 一块、逐行叠加；无条目 → ''（不产行）。 */
function memberBlock(tables: EmitTables, path: string, i: number, indent: string): string {
  return tsdocLines(memberDocsAt(tables, path, i), indent, tables);
}

/** 行内位成员 doc（#307 W2，发射位 3/4）：逐块单空格串联 + 尾单空格（紧跟成员起点）；无条目 → ''。 */
function memberInlinePrefix(tables: EmitTables, path: string, i: number): string {
  const docs = memberDocsAt(tables, path, i);
  return docs === undefined ? '' : `${tsdocInline(docs, tables)} `;
}

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

/**
 * kindOf（规则 0）：沿 aliases 表取别名结构节点 kind；条目为 ref 则沿链解析，遇环 throw
 * （纵深防御，正常输入不可达——E106 已在解析层拒绝一切别名环）。
 * 检查点②（§3.4 R3）：kindOf 链解析抵达 ROOT → UnsupportedRootReferenceError。
 */
function kindOfAlias(name: string, tables: EmitTables, path: string, stack: readonly string[] = []): string {
  if (name === 'ROOT') throw new UnsupportedRootReferenceError(path);
  if (stack.includes(name)) throw new Error(`ref cycle at alias '${name}'`);
  const node = tables.aliases[name];
  if (node === undefined) throw new Error(`unknown alias '${name}'`);
  if (node.kind === 'ref') return kindOfAlias(node.name, tables, path, [...stack, name]);
  return kindLiteral(node, tables, path);
}

/** 结构节点 kind → 外壳 kind（map → 'map'；union → 同形裁决〔R3，SA2 R2-3〕；其余同名）。 */
function kindLiteral(node: StructureNode, tables: EmitTables, path: string): string {
  switch (node.kind) {
    case 'map':
      return 'map';
    case 'union':
      // 规则 0/§3.4 kindOf 引用位同形裁决：成员结构 kind 全员同形 → 该 kind；
      // 异形 → UnsupportedUnionKindError——禁止默认 'map'（PathKind 门禁失真）
      return unionKind(node, tables, path);
    case 'array':
      return 'array';
    case 'plain':
      return 'plain';
    case 'leaf':
      return 'leaf';
    case 'xml-fragment':
      return 'xml-fragment';
    case 'ref':
      // 值侧非 ref 时结构侧为 ref 是两树失配（值侧永不解析）；防御路径仍走别名链
      return kindOfAlias(node.name, tables, path);
    case 'root':
      throw new Error('root 节点仅能出现在入口');
  }
}

/** 成员结构 kind（ref 成员沿别名链取 kind——`A | B` 别名混合联合的同形判定基础）。 */
function structureKind(node: StructureNode, tables: EmitTables, path: string): string {
  return node.kind === 'ref' ? kindOfAlias(node.name, tables, path) : kindLiteral(node, tables, path);
}

/**
 * §3.2 union 行同形裁决（R3，SA2 R2-3）：联合成员结构 kind 全员同形 → 该 kind
 * （VfslKind 五值词汇表无联合 kind，同形才存在诚实单值）；异形 → UnsupportedUnionKindError
 * 响亮拒绝——禁止对异形联合默认 'map'（PathKind/序列编辑 API 门禁失真）。
 */
function unionKind(node: Extract<StructureNode, { kind: 'union' }>, tables: EmitTables, path: string): string {
  const kinds = node.members.map((m) => structureKind(m, tables, path));
  const first = kinds[0];
  if (first === undefined || kinds.some((k) => k !== first)) {
    throw new UnsupportedUnionKindError(kinds);
  }
  return first;
}

/** 值侧 ref 沿 values 表解析（仅 ROOT 入口使用——接口成员需展开值对象）。 */
function resolveValueRef(v: ValueSchema, values: Record<string, ValueSchema>, stack: readonly string[] = []): ValueSchema {
  if (v.kind !== 'ref') return v;
  if (stack.includes(v.name)) throw new Error(`value ref cycle at '${v.name}'`);
  const target = values[v.name];
  if (target === undefined) throw new Error(`unknown alias '${v.name}'`);
  return resolveValueRef(target, values, [...stack, v.name]);
}

/** Record 形 map：fields 恰一 '<key>'（动态键段固定名）。 */
function isRecordForm(node: Extract<StructureNode, { kind: 'map' }>): boolean {
  return node.fields.length === 1 && node.fields[0]?.name === '<key>';
}

/** 结构/值失配（§3.2 守卫）：仅两侧均非 ref 时命中——求值器契约破坏，响亮失败。 */
function desync(node: StructureNode, value: ValueSchema, path: string): never {
  throw new Error(`structure/value desync at ${path} (structure=${node.kind}, value=${value.kind})`);
}

function splitOptional(v: ValueSchema): { optional: string; value: ValueSchema } {
  return v.kind === 'optional' ? { optional: '?', value: v.value } : { optional: '', value: v };
}

/** 接口成员键：合法 TS identifier 不加引号（§3.5，契约推导）；否则加引号。 */
function isIdentifier(name: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
}

/** §3.2.1 诊断用实际形态描述。 */
function describeRootShape(node: StructureNode): string {
  switch (node.kind) {
    case 'union':
      return `联合形（${node.members.length} 个成员）`;
    case 'map':
      return 'Record 形（动态键）';
    default:
      return `'${node.kind}' 形`;
  }
}
