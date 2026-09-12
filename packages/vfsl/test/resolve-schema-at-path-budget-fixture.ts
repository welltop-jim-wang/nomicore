/**
 * Issue #335 预算通道共享夹具（SA6 §12.3 第一行；设计 §10 ALLOW）。
 *
 * 内容：
 * - `BUDGET_FIXTURE_TEXT`：预算专用 VFSL 文本（可选/必填孪生、容器×union 对偶、
 *   ref 内嵌 ref、深链、别名枚举成员注释锚位、Record 槽位）——与既有 #272 夹具正交；
 * - `BUDGET_NO_BUDGET_DIGESTS`：无预算读 `sha256(JSON.stringify(result))` 冻结字面量
 *   （实现前 HEAD `ba11f32` 录制；负控逐字节对账、预算读的零标记等价锚）；
 * - `BUDGET_MARKER_MATRIX`：§6.3.4 计层矩阵的逐 (path, depth) 标记集合字面量（测试
 *   运行时对账；条目形如 `` `${语法路径} => ${线索}` ``；线索 = `ref:<名>` /
 *   `container:<object|array>`）；
 * - `BUDGET_DOCS_BY_DEPTH`：docs 精确键集矩阵（被裁路径省略 / 脊柱键保留 pin）；
 * - 毒化派生物构造器（`poisonedFixtureDerived`，P3 哨兵）与手造环状/递归/多引用
 *   派生物构造器（F1/§6.3.5、S4 首发现 pin；环状类含 union 自引用、容器 2-环与
 *   **optional 自环/2-环**——SA4 R1 截断谓词环安全回归的夹具面）。
 *
 * 期望值全部是**运行时求值输出的字面量快照**（负控文件对账），或由设计 §6.3/§6.3.4
 * 计层规约独立推导；本文件不读生产实现源码。
 */
import { evaluate, parseVfsl } from '../src/index.js';
import type { DerivedSchema, MapField, StructureNode, ValueField, ValueSchema } from '../src/index.js';
import { FIXTURE_TEXT } from './resolve-schema-at-path-fixture.js';

/** 预算夹具文本：可选/必填孪生、union 对偶、ref 内嵌 ref、深链、别名枚举成员注释。 */
export const BUDGET_FIXTURE_TEXT = `
/** 审计 */
type Audit = YMap<{
  /** 审计员 */
  by: YLeaf<string>;
  /** 备注行 */
  notes: YLeaf<string>[];
}>;
/** 账本 */
type Ledger = YMap<{
  /** 账本名 */
  title: YLeaf<string>;
  /** 审计引用 */
  audit: Audit;
}>;
type Pair =
  | { kind: "a"; /** 甲名 */ name: YLeaf<string> }
  | { kind: "b"; /** 乙量 */ count: YLeaf<number> };
type Mode = /** 开 */ "on" /** 关 */ | "off";
type ROOT = YMap<{
  /** 浅引用位 */
  shallow: Ledger;
  /** 深链位 */
  deep: YMap<{ mid: YMap<{ leaf: Ledger }> }>;
  /** 联合位 */
  pair: Pair;
  /** 内联联合位 */
  inlPair: { kind: "a"; name: YLeaf<string> } | { kind: "b"; count: YLeaf<number> };
  /** 孪生位 */
  plain: { kind: "a"; name: YLeaf<string> };
  /** 可选位 */
  opt?: YMap<{ retries: YLeaf<number> }>;
  /** 必填位 */
  req: YMap<{ retries: YLeaf<number> }>;
  /** 模式 */
  mode: Mode;
  /** 模式表 */
  modes: YArray<Mode>;
  /** 模式字典 */
  modeMap: Record<string, Mode>;
}>;
`.trim();

/** 夹具别名闭包发现序（`[]` 无预算读；负控对账 + 预算闭包收缩基线）。 */
export const BUDGET_ALIAS_ORDER: readonly string[] = ['Ledger', 'Audit', 'Pair', 'Mode'];

/** `[]` 无预算读的非空 docs 键全集（非空内容过滤后的实际输出键）。 */
export const BUDGET_NO_BUDGET_DOCS_KEYS: readonly string[] = [
  'Audit.by',
  'Audit.notes',
  'Ledger.title',
  'Ledger.audit',
  'Pair.<member 0>.name',
  'Pair.<member 1>.count',
  'ROOT.shallow',
  'ROOT.deep',
  'ROOT.pair',
  'ROOT.inlPair',
  'ROOT.plain',
  'ROOT.opt',
  'ROOT.req',
  'ROOT.mode',
  'ROOT.modes',
  'ROOT.modeMap',
  'Mode.<member 0>',
  'Mode.<member 1>',
];

/** `[]` 无预算读的非空 aliasDocs 键（发现序）。 */
export const BUDGET_NO_BUDGET_ALIAS_DOCS_KEYS: readonly string[] = ['Ledger', 'Audit'];

/** 无预算读整投影冻结摘要（sha256(JSON.stringify(result))；HEAD 录制）。 */
export const BUDGET_NO_BUDGET_DIGESTS: Readonly<Record<string, string>> = {
  '[]': 'e600851a81744bd5ebca61aed5c7011bef6ca535c9a1d5deef6ee9020db45121',
  '["shallow"]': '5c43ce3b15a0eae6c50ba954910ef5e881e1dc284424c6e31618a621b331a496',
  '["shallow","title"]': '20f38a379a3f3d3b9d1eacb1cc19227c002fd303761474dfe5c2e074e1b55cd7',
  '["shallow","audit"]': '014252fa1ee034ab174d195a210a913d57c5f03069c194f27fe3a297f8391132',
  '["deep","mid","leaf"]': 'cf54d298b1c7b9fe61df5836867e70c38db1f223c1953f89e4748858d6ce1be5',
  '["pair"]': '062d13d03cc626a9747bbbcb51bced75b5271ea563696b9a1cbdc12d6804c848',
  '["inlPair"]': '506725be7d3ca2333d08ad486c83c491f051232daa693c4cd60b634b3efab0cb',
  '["plain"]': '2446b43a109c01785bd815819cf81b95224cdd9919975d997bf7fa30bbc5dda1',
  '["opt"]': 'a31f69140b8debb3044a6c2a76de4588cd4ef935443873118efcac24a7001877',
  '["req"]': 'd01e75f1e907a4ce34b8858035f92e6e873add607c1b2ef068df3bd9188f8c5d',
  '["req","retries"]': '3e911b515021f2d75f7660a9907c527e78eeb388ebf2d71834f81bdd76f72efc',
  '["mode"]': '22d6bffec3ba4786d1e1102b8c4ce0be27d012560a24df34f40abc4f5fb4d3ea',
  '["modes"]': '101995ffafd1e476a51738831988be79f1782ad49ac1d18b05b04bee3b25eac3',
  '["modes",0]': 'cb1c1e1c002768e2f7d9cb8831f39b40e7358b5d33a638e24ff243af4e7ac96b',
  '["modeMap","k"]': '4e76635c56461e6294adac06f41423daa6351254b5d350ae9ffcc901f053cde8',
  '["nope"]': '09ba64ad18349c6b347c5f18d4ce2f4d73c7084696af90b73b3811c2823d2fab',
  '[0]': '66daaf30651de6a87650ee4f17775aac4b7440e4aa1c0a70850f4a1056da0994',
};

/** 无预算读失败路径的形状（负控对账）。 */
export const BUDGET_NO_BUDGET_FAILURES: Readonly<Record<string, string>> = {
  '["nope"]': 'SCHEMA_PATH_NOT_FOUND',
  '[0]': 'SCHEMA_PATH_INVALID',
};

/** 语法路径清单（测试辅助；键与 `BUDGET_NO_BUDGET_DIGESTS` 一致）。 */
export function digestKey(path: readonly (string | number)[]): string {
  return JSON.stringify(path);
}

/** 单条计层矩阵格：某 (path, depth) 下的标记集合（`` `${语法路径} => ${线索}` ``，已排序）。 */
export interface BudgetMarkerCase {
  readonly path: readonly (string | number)[];
  /** 终点语法路径（valueSchema 根锚；别名体根锚 = 别名名）。 */
  readonly base: string;
  readonly byDepth: Readonly<Record<number, readonly string[]>>;
}

/**
 * §6.3.4 计层矩阵（预算夹具）：标记位置 + 线索逐格字面量。
 * 线索文本：`ref:<别名名>` / `container:object` / `container:array`。
 */
export const BUDGET_MARKER_MATRIX: readonly BudgetMarkerCase[] = [
  {
    path: [],
    base: 'ROOT',
    byDepth: {
      0: ['ROOT => container:object'],
      1: [
        'ROOT.deep => container:object',
        'ROOT.inlPair.<member 0> => container:object',
        'ROOT.inlPair.<member 1> => container:object',
        'ROOT.mode => ref:Mode',
        'ROOT.modeMap => container:object',
        'ROOT.modes => container:array',
        'ROOT.opt => container:object',
        'ROOT.pair => ref:Pair',
        'ROOT.plain => container:object',
        'ROOT.req => container:object',
        'ROOT.shallow => ref:Ledger',
      ],
      2: [
        'Ledger.audit => ref:Audit',
        'ROOT.deep.mid => container:object',
        'ROOT.modeMap.<key> => ref:Mode',
        'ROOT.modes.<item> => ref:Mode',
      ],
      3: ['Audit.notes => container:array', 'ROOT.deep.mid.leaf => ref:Ledger'],
      4: [],
      9: [],
    },
  },
  {
    path: ['shallow'],
    base: 'ROOT.shallow',
    byDepth: {
      0: ['ROOT.shallow => ref:Ledger'],
      1: ['Ledger.audit => ref:Audit'],
      2: ['Audit.notes => container:array'],
      3: [],
      4: [],
    },
  },
  {
    path: ['deep', 'mid', 'leaf'],
    base: 'ROOT.deep.mid.leaf',
    byDepth: {
      0: ['ROOT.deep.mid.leaf => ref:Ledger'],
      1: ['Ledger.audit => ref:Audit'],
      2: ['Audit.notes => container:array'],
      3: [],
    },
  },
  {
    path: ['shallow', 'audit'],
    base: 'ROOT.shallow.audit',
    byDepth: {
      0: ['ROOT.shallow.audit => ref:Audit'],
      1: ['Audit.notes => container:array'],
      2: [],
    },
  },
  {
    path: ['req'],
    base: 'ROOT.req',
    byDepth: {
      0: ['ROOT.req => container:object'],
      1: [],
    },
  },
  {
    path: ['plain'],
    base: 'ROOT.plain',
    byDepth: {
      0: ['ROOT.plain => container:object'],
      1: [],
    },
  },
  {
    path: ['pair'],
    base: 'ROOT.pair',
    byDepth: {
      0: ['ROOT.pair => ref:Pair'],
      1: [],
    },
  },
  {
    path: ['inlPair'],
    base: 'ROOT.inlPair',
    byDepth: {
      0: [
        'ROOT.inlPair.<member 0> => container:object',
        'ROOT.inlPair.<member 1> => container:object',
      ],
      1: [],
    },
  },
  {
    path: ['mode'],
    base: 'ROOT.mode',
    byDepth: {
      0: ['ROOT.mode => ref:Mode'],
      1: [],
      9: [],
    },
  },
  {
    path: ['modes'],
    base: 'ROOT.modes',
    byDepth: {
      0: ['ROOT.modes => container:array'],
      1: ['ROOT.modes.<item> => ref:Mode'],
      2: [],
    },
  },
  {
    path: ['modeMap', 'k'],
    base: 'ROOT.modeMap.<key>',
    byDepth: {
      0: ['ROOT.modeMap.<key> => ref:Mode'],
      1: [],
    },
  },
  {
    path: ['shallow', 'title'],
    base: 'ROOT.shallow.title',
    byDepth: {
      0: [],
      1: [],
      3: [],
    },
  },
];

/**
 * `['opt']` / `['req']` 可选孪生对偶（G2.2）：两者的终点类型位在 depth=0 处被裁
 * （可选位经 optional 透明包装保留），depth≥1 全净。断言由 markerMatrix 覆盖，
 * 本常量仅记录对偶关系供测试引用。
 */
export const BUDGET_OPTIONAL_TWIN_PATHS = {
  optional: ['opt'],
  required: ['req'],
} as const;

/** docs 精确键集矩阵格（G5.2 被裁省略 / 脊柱保留 pin / 收缩）。 */
export interface BudgetDocsCase {
  readonly path: readonly (string | number)[];
  readonly depth: number;
  readonly docsKeys: readonly string[];
  readonly aliasDocsKeys: readonly string[];
}

/** docs/aliasDocs 收缩矩阵（预算夹具；键集精确相等）。 */
export const BUDGET_DOCS_MATRIX: readonly BudgetDocsCase[] = [
  { path: [], depth: 0, docsKeys: [], aliasDocsKeys: [] },
  { path: [], depth: 1, docsKeys: ['ROOT.inlPair'], aliasDocsKeys: [] },
  {
    path: [],
    depth: 2,
    docsKeys: [
      'Ledger.title',
      'Pair.<member 0>.name',
      'Pair.<member 1>.count',
      'ROOT.shallow',
      'ROOT.deep',
      'ROOT.pair',
      'ROOT.inlPair',
      'ROOT.plain',
      'ROOT.opt',
      'ROOT.req',
      'ROOT.mode',
      'ROOT.modes',
      'ROOT.modeMap',
      'Mode.<member 0>',
      'Mode.<member 1>',
    ],
    aliasDocsKeys: ['Ledger'],
  },
  {
    path: [],
    depth: 3,
    docsKeys: [
      'Audit.by',
      'Ledger.title',
      'Ledger.audit',
      'Pair.<member 0>.name',
      'Pair.<member 1>.count',
      'ROOT.shallow',
      'ROOT.deep',
      'ROOT.pair',
      'ROOT.inlPair',
      'ROOT.plain',
      'ROOT.opt',
      'ROOT.req',
      'ROOT.mode',
      'ROOT.modes',
      'ROOT.modeMap',
      'Mode.<member 0>',
      'Mode.<member 1>',
    ],
    aliasDocsKeys: ['Ledger', 'Audit'],
  },
  {
    path: ['shallow'],
    depth: 0,
    docsKeys: ['ROOT.shallow'],
    aliasDocsKeys: [],
  },
  {
    path: ['shallow'],
    depth: 1,
    docsKeys: ['Ledger.title', 'ROOT.shallow'],
    aliasDocsKeys: ['Ledger'],
  },
  {
    path: ['shallow'],
    depth: 2,
    docsKeys: ['Audit.by', 'Ledger.title', 'Ledger.audit', 'ROOT.shallow'],
    aliasDocsKeys: ['Ledger', 'Audit'],
  },
  {
    // 脊柱键双位保留：`ROOT.shallow`（首段终）∪ `Ledger.audit`（段驱动锚名切换后的命中位）
    path: ['shallow', 'audit'],
    depth: 0,
    docsKeys: ['Ledger.audit', 'ROOT.shallow'],
    aliasDocsKeys: [],
  },
  {
    path: ['shallow', 'audit'],
    depth: 1,
    docsKeys: ['Audit.by', 'Ledger.audit', 'ROOT.shallow'],
    aliasDocsKeys: ['Audit'],
  },
  {
    path: ['mode'],
    depth: 0,
    docsKeys: ['ROOT.mode'],
    aliasDocsKeys: [],
  },
  {
    path: ['mode'],
    depth: 1,
    docsKeys: ['ROOT.mode', 'Mode.<member 0>', 'Mode.<member 1>'],
    aliasDocsKeys: [],
  },
];

/** 毒化哨兵的未声明别名名（P3：仅经闭包/展开遍历可达）。 */
export const POISON_ALIAS = 'MissingAlias';

function parseOk(text: string): ReturnType<typeof parseVfsl> & { ok: true } {
  const result = parseVfsl(text);
  if (!result.ok) {
    throw new Error(`前置 parseVfsl 失败（不应发生）：${JSON.stringify(result.issues)}`);
  }
  return result;
}

function evaluateOk(text: string): DerivedSchema {
  const result = evaluate(parseOk(text).module);
  if (!result.ok) {
    throw new Error(`前置 evaluate 失败（不应发生）：${JSON.stringify(result.issues)}`);
  }
  return result.derived;
}

/** 预算夹具派生物（每次调用新对象图）。 */
export function budgetFixtureDerived(): DerivedSchema {
  return evaluateOk(BUDGET_FIXTURE_TEXT);
}

/** 把别名体内的 ref 改名（毒化构造；只作用于值树节点，不触结构树）。 */
function renameRefs(node: ValueSchema, from: string, to: string): void {
  switch (node.kind) {
    case 'object':
      for (const f of node.fields) renameRefs(f.value, from, to);
      return;
    case 'array':
      renameRefs(node.element, from, to);
      return;
    case 'union':
      for (const m of node.members) renameRefs(m, from, to);
      return;
    case 'optional':
      renameRefs(node.value, from, to);
      return;
    case 'ref':
      if (node.name === from) node.name = to;
      return;
    default:
      return;
  }
}

/**
 * 毒化派生物（P3 哨兵）：既有 #272 夹具（`FIXTURE_TEXT` 只读复用）的
 * `values.AssetEntity` 体内 `ref:Audit` 改名为未声明别名 `MissingAlias`——只有经
 * 闭包/展开遍历（`[]` depth≥4 或 `['assets','img1']` depth≥2）才会触达；`{depth:0}`
 * 必须 ok（零越界遍历），无预算读必须 `throw InternalError`（可信域畸形通道不变）。
 */
export function poisonedFixtureDerived(): DerivedSchema {
  const derived = evaluateOk(FIXTURE_TEXT);
  const assetEntity = derived.values['AssetEntity'];
  if (assetEntity === undefined) {
    throw new Error('前置不变量违反：毒化夹具缺 AssetEntity 别名');
  }
  renameRefs(assetEntity, 'Audit', POISON_ALIAS);
  return derived;
}

/** 手造派生 schema 骨架（结构树仅需满足根形状；预算夹具路径均为 `[]`）。 */
function handMade(values: Record<string, ValueSchema>): DerivedSchema {
  const rootMap: StructureNode = { kind: 'map', fields: [] as MapField[] };
  return {
    aliases: { ROOT: rootMap },
    structure: { kind: 'root', node: rootMap },
    values,
    index: {},
    aliasDocs: {},
    fieldDocs: {},
    markerDocs: {},
  };
}

/**
 * 透明环（union 自引用，§6.3.5）：`ROOT.ring` = union，成员 object 的 `self` 指回该
 * union。任意预算必须终止（重入透传原引用），`{}` 与无预算读引用级同构。
 */
export function unionRingDerived(): DerivedSchema {
  const ring: { kind: 'union'; members: ValueSchema[] } = { kind: 'union', members: [] };
  ring.members.push({
    kind: 'object',
    fields: [
      { name: 'self', value: ring },
      { name: 'x', value: { kind: 'scalar', type: 'string' } },
    ],
  });
  const root: ValueSchema = {
    kind: 'object',
    fields: [{ name: 'ring', value: ring }],
  };
  return handMade({ ROOT: root });
}

/**
 * 容器环（对象自环 + 2-环，§6.3.5）：`ROOT.head` = A，A.next = B，B.next = A。
 * 有限预算在完成一次环回前耗尽 → 有界壳 + 标记；未耗尽 → 重入透传 + 身份短路。
 */
export function containerRingDerived(): DerivedSchema {
  const a: { kind: 'object'; fields: ValueField[] } = { kind: 'object', fields: [] };
  const b: { kind: 'object'; fields: ValueField[] } = { kind: 'object', fields: [] };
  a.fields.push({ name: 'next', value: b }, { name: 'leaf', value: { kind: 'scalar', type: 'string' } });
  b.fields.push({ name: 'next', value: a }, { name: 'leaf', value: { kind: 'scalar', type: 'string' } });
  const root: ValueSchema = { kind: 'object', fields: [{ name: 'head', value: a }] };
  return handMade({ ROOT: root });
}

/**
 * 透明环（optional 自引用，§6.3.5；SA4 R1 回归）：`ROOT.x` = optional 自环（`value`
 * 指回自身）。同一环节点同时落在截断谓词 `isTruncated` 的三个调用点——object 字段值位
 * `x`、array `<item>`（`ROOT.arr`）、union 成员位（`ROOT.u`）——并经 `ref:'RingAlias'`
 * 进入闭包体（别名体 = `object{self: 同环}`）。任意预算必须终止（重入透传原引用、环上
 * 无标记、无裸异常），`{}`/充足 depth 与无预算读**引用级**同构。
 */
export function optionalRingDerived(): DerivedSchema {
  const cycle: { kind: 'optional'; value: ValueSchema } = {
    kind: 'optional',
    value: undefined as unknown as ValueSchema,
  };
  cycle.value = cycle;
  return optionalRingSkeleton(cycle);
}

/**
 * 透明环（optional 2-环，§6.3.5；SA4 R1 回归）：`a.value = b`、`b.value = a`，布点与
 * 自环夹具一致。剥离链 `a → b → a` 对 2-环同样必须终止（重访即未截断）。
 */
export function optionalTwoCycleDerived(): DerivedSchema {
  const a: { kind: 'optional'; value: ValueSchema } = {
    kind: 'optional',
    value: undefined as unknown as ValueSchema,
  };
  const b: { kind: 'optional'; value: ValueSchema } = { kind: 'optional', value: a };
  a.value = b;
  return optionalRingSkeleton(a);
}

/** 环夹具 ROOT 字段序（断言取位用；值位含义见 `optionalRingSkeleton`）。 */
export const OPTIONAL_RING_FIELDS: readonly string[] = ['x', 'arr', 'u', 'ringRef'];

/** 环夹具骨架：ROOT 四字段（x/arr/u/ringRef）+ 闭包别名 RingAlias（体内含同一环节点）。 */
function optionalRingSkeleton(cycle: ValueSchema): DerivedSchema {
  const root: ValueSchema = {
    kind: 'object',
    fields: [
      { name: 'x', value: cycle },
      { name: 'arr', value: { kind: 'array', element: cycle } },
      { name: 'u', value: { kind: 'union', members: [cycle] } },
      { name: 'ringRef', value: { kind: 'ref', name: 'RingAlias' } },
    ],
  };
  const ringAlias: ValueSchema = {
    kind: 'object',
    fields: [
      { name: 'self', value: cycle },
      { name: 'leaf', value: { kind: 'scalar', type: 'string' } },
    ],
  };
  return handMade({ ROOT: root, RingAlias: ringAlias });
}

/**
 * 合法递归别名（别名级自引用，按名引用不是对象图环）：`values.ROOT` 含 `ref:ROOT`。
 * `{}` 必须与无预算读引用级同构（闭包条目 = 原体引用；§6.1 递归包含例外）。
 */
export function recursiveAliasDerived(): DerivedSchema {
  const root: ValueSchema = {
    kind: 'object',
    fields: [
      { name: 'me', value: { kind: 'ref', name: 'ROOT' } },
      { name: 'x', value: { kind: 'scalar', type: 'string' } },
    ],
  };
  return handMade({ ROOT: root });
}

/**
 * 多引用跨预算（S4 首发现 pin）：同一别名 `Shared` 先经深链（剩余预算小）发现、
 * 再经浅位（剩余预算大）引用。闭包条目按**首发现预算**渲染一次（`Shared.c` 标记），
 * 浅位引用复用同一条目——逐调用确定。
 */
export function multiRefDerived(): DerivedSchema {
  const shared: ValueSchema = {
    kind: 'object',
    fields: [
      { name: 'leaf', value: { kind: 'scalar', type: 'string' } },
      {
        name: 'c',
        value: { kind: 'object', fields: [{ name: 'd', value: { kind: 'scalar', type: 'number' } }] },
      },
    ],
  };
  const root: ValueSchema = {
    kind: 'object',
    fields: [
      {
        name: 'deepFirst',
        value: {
          kind: 'object',
          fields: [
            {
              name: 'mid',
              value: { kind: 'object', fields: [{ name: 'inner', value: { kind: 'ref', name: 'Shared' } }] },
            },
          ],
        },
      },
      {
        name: 'shallowSecond',
        value: {
          kind: 'object',
          fields: [{ name: 'inner', value: { kind: 'ref', name: 'Shared' } }],
        },
      },
    ],
  };
  return handMade({ ROOT: root, Shared: shared });
}
