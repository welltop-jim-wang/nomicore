/**
 * resolveSchemaAtPath 契约共享 fixture（Issue #272 / ADR-0016 解析语义）。
 *
 * 供两个测试文件共用（红契约 resolve-schema-at-path.test.ts 与 负控
 * resolve-schema-at-path-control.test.ts）：
 * - FIXTURE_TEXT：单一定义文本（与 SA6 报告第 5 节逐字一致）；
 * - 文档三表/值树全部契约字面量：派生 schema 求值输出确定（求值器为绿色基线，
 *   负控文件对每一条字面量做源表对账——红契约内的期望值即源表实际内容的逐字
 *   快照，杜绝夹具与期望漂移）；
 * - 测试不 read 生产实现源码——一切期望值都是运行时求值输出的字面量快照。
 *
 * 夹具设计意图（各 AC 覆盖位）：
 * - Record + keyPattern（assets: Record<AssetId, AssetEntity>）→ AC2 keyPattern
 *   fail-closed 与 Record 终点（keyPattern 在返回子树原样保留）；
 * - union（AssetEntity/U）→ AC2 静态 any-member 扩展、合成 union 终点（无判别式
 *   缓存）、解析与判别式/实际值无关；
 * - optional（notes?: / config?:）→ AC2 游走透明展开、返回子树原样保留；
 * - ref（audit/assets.<key>/u）→ AC2 ref 按名保留；畸形派生物（删表）→ InternalError；
 * - YPlainArray（attachments）→ 写侧 drillStep 终态（"只能整体替换"）的同构边界：
 *   整位可解析、内部位不可下钻（NOT_FOUND）；
 * - 文档注释恰落在：Audit/AssetEntity 别名级、Audit.createdBy / ROOT.audit /
 *   ROOT.notes / ROOT.keywords / ROOT.config 字段级 → AC3 docs/aliasDocs 切片
 *   键同构 + 内容逐字对账；ROOT 别名级无注释（消除 ROOT 别名级注释归属歧义）。
 */

/** 契约夹具文本（evaluate ok 前置由负控文件锚定；解析语义 6 条覆盖位见文件头）。 */
export const FIXTURE_TEXT = `
type AssetId = string & Pattern<"^[A-Za-z0-9_\\\\-]{1,64}$">;
/** 审计子文档 */
type Audit = YMap<{
  /** 谁创建的 */
  createdBy: YLeaf<string>;
}>;
/** 资产实体：封闭联合 */
type AssetEntity =
  | { kind: "image"; url: YLeaf<string>; audit: Audit }
  | { kind: "text"; body: YXmlFragment<{ paragraphs: YArray<YLeaf<string>> }>; audit: Audit };
type U = { kind: "a"; x: YLeaf<string> } | { kind: "b"; x: YArray<YLeaf<number>> };
type ROOT = YMap<{
  /** 根级审计字段 */
  audit: Audit;
  assets: Record<AssetId, AssetEntity>;
  /** 可选备注 */
  notes?: YLeaf<string>;
  /** 关键字 */
  keywords: YLeaf<string>[];
  u: U;
  /** 可选配置 */
  config?: YMap<{ retries: YLeaf<number> }>;
  attachments: YPlainArray<YLeaf<string>>;
}>;
`.trim();

// —— 文档注释字面量（逐字含前导/尾随空白；求值器逐字继承纪律）——

/** Audit 别名级注释（aliasDocs['Audit']）。 */
export const DOC_AUDIT_ALIAS = ' 审计子文档 ';
/** AssetEntity 别名级注释（aliasDocs['AssetEntity']）。 */
export const DOC_ASSET_ENTITY_ALIAS = ' 资产实体：封闭联合 ';
/** Audit.createdBy 字段级注释（fieldDocs['Audit.createdBy']）。 */
export const DOC_AUDIT_CREATEDBY = ' 谁创建的 ';
/** ROOT.audit 字段级注释（fieldDocs['ROOT.audit']）。 */
export const DOC_ROOT_AUDIT = ' 根级审计字段 ';
/** ROOT.notes 字段级注释（fieldDocs['ROOT.notes']）。 */
export const DOC_ROOT_NOTES = ' 可选备注 ';
/** ROOT.keywords 字段级注释（fieldDocs['ROOT.keywords']）。 */
export const DOC_ROOT_KEYWORDS = ' 关键字 ';
/** ROOT.config 字段级注释（fieldDocs['ROOT.config']）。 */
export const DOC_ROOT_CONFIG = ' 可选配置 ';

/**
 * 夹具派生 schema 上全部**非空** docs 位置 → 内容（含别名内部位 Audit.createdBy）。
 * 非空位置全集 = 上面 7 条注释的落点；空数组位置不计入（存在性不锁——切片是否
 * 保留空条目属设计自由度，红契约不约束）。
 */
export const ALL_NONEMPTY_DOCS: Record<string, readonly string[]> = {
  'Audit.createdBy': [DOC_AUDIT_CREATEDBY],
  'ROOT.audit': [DOC_ROOT_AUDIT],
  'ROOT.notes': [DOC_ROOT_NOTES],
  'ROOT.keywords': [DOC_ROOT_KEYWORDS],
  'ROOT.config': [DOC_ROOT_CONFIG],
};

/** 夹具派生 schema 上全部**非空** aliasDocs 位置 → 内容。 */
export const ALL_NONEMPTY_ALIAS_DOCS: Record<string, readonly string[]> = {
  Audit: [DOC_AUDIT_ALIAS],
  AssetEntity: [DOC_ASSET_ENTITY_ALIAS],
};

// —— 值 schema 构建块字面量（与求值器输出的对象内容全等；键序无关）——

/** scalar string 值 schema。 */
export const SCALAR_STRING = { kind: 'scalar', type: 'string' } as const;
/** scalar number 值 schema。 */
export const SCALAR_NUMBER = { kind: 'scalar', type: 'number' } as const;

/** Audit 别名的值 schema（无内层 ref）。 */
export const VALUE_AUDIT = {
  kind: 'object',
  fields: [{ name: 'createdBy', value: SCALAR_STRING }],
} as const;

/** AssetEntity 别名的值 schema（union + discriminator——判别式缓存属实现细节，内容按语义对账）。 */
export const VALUE_ASSET_ENTITY_UNION = {
  kind: 'union',
  members: [
    {
      kind: 'object',
      fields: [
        { name: 'kind', value: { kind: 'enum', values: ['image'] } },
        { name: 'url', value: SCALAR_STRING },
        { name: 'audit', value: { kind: 'ref', name: 'Audit' } },
      ],
    },
    {
      kind: 'object',
      fields: [
        { name: 'kind', value: { kind: 'enum', values: ['text'] } },
        { name: 'body', value: { kind: 'xml' } },
        { name: 'audit', value: { kind: 'ref', name: 'Audit' } },
      ],
    },
  ],
} as const;

/** U 别名的值 schema（union + discriminator；成员 x 各异型——合成 union 终点的候选源）。 */
export const VALUE_U_UNION = {
  kind: 'union',
  members: [
    {
      kind: 'object',
      fields: [
        { name: 'kind', value: { kind: 'enum', values: ['a'] } },
        { name: 'x', value: SCALAR_STRING },
      ],
    },
    {
      kind: 'object',
      fields: [
        { name: 'kind', value: { kind: 'enum', values: ['b'] } },
        { name: 'x', value: { kind: 'array', element: SCALAR_NUMBER } },
      ],
    },
  ],
} as const;

/** ROOT 别名的值 schema（[] 读路径终点 = 整棵 ROOT 值子树；含 Record/optional/ref/array）。 */
export const VALUE_ROOT = {
  kind: 'object',
  fields: [
    { name: 'audit', value: { kind: 'ref', name: 'Audit' } },
    {
      name: 'assets',
      value: {
        kind: 'object',
        fields: [{ name: '<key>', value: { kind: 'ref', name: 'AssetEntity' } }],
        keyPattern: '^[A-Za-z0-9_\\-]{1,64}$',
      },
    },
    { name: 'notes', value: { kind: 'optional', value: SCALAR_STRING } },
    { name: 'keywords', value: { kind: 'array', element: SCALAR_STRING } },
    { name: 'u', value: { kind: 'ref', name: 'U' } },
    {
      name: 'config',
      value: {
        kind: 'optional',
        value: { kind: 'object', fields: [{ name: 'retries', value: SCALAR_NUMBER }] },
      },
    },
    { name: 'attachments', value: { kind: 'array', element: SCALAR_STRING } },
  ],
} as const;

/** Record 值位（ROOT.assets 字段值）独立字面量：keyPattern 在返回子树原样保留。 */
export const VALUE_ASSETS_RECORD = VALUE_ROOT.fields[1]!.value;

/** ['u','x'] 合成 union 终点的两枚成员（候选：m0.x = scalar string；m1.x = array<number>）。 */
export const SYNTH_UNION_MEMBERS = [
  SCALAR_STRING,
  { kind: 'array', element: SCALAR_NUMBER },
] as const;
