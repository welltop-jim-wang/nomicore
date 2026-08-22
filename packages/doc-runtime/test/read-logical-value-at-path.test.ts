/**
 * SA6 红灯测试 — @nomicore/doc-runtime readLogicalValueAtPath(derived, doc, path)（issue #75，功能开发）。
 *
 * 契约来源：
 * - 任务简报 wiki/raw/task_read-logical-value-at-path.md（Issue #75）6 条验收标准：
 *   AC1 path 统一为 `readonly (string | number)[]`；空 path 显式读取完整 ROOT；
 *   AC2 schema 不允许的路径返回 `PATH_NOT_ALLOWED`；
 *   AC3 合法 optional/Record 缺键和非负整数数组越界返回 `ok:true, value:undefined`；
 *   AC4 负数、非整数或字符串数组下标非法；
 *   AC5 leaf/plain/XML 为不可下钻终态；plain 数组只允许整体读取；
 *   AC6 读取成本与目标子树规模相关，返回值修改不影响 live doc；
 * - docs/adr/0007（直接治理 ADR）：`readLogicalValueAtPath(derived, doc, path)` 同步按路径读取，
 *   只转换目标子树；依赖 create/open/update 已建立并维持的结构不变量，普通读取不重复验证；
 *   空路径表示显式读取整个 ROOT；合法 optional/Record/数组缺失返回 `undefined`；路径统一为
 *   `readonly (string | number)[]`（map/object/Record 用 string，Y.Array 用 number；禁点号字符串
 *   与 JSON Pointer）；leaf、plain、XML 是不可下钻终态；「普通读取成本与目标 path 子树规模相关」；
 *   「Yjs 结构与路径/操作错误 fail-fast」；「底层能力各自保留领域化结果联合，不合并成巨型 issue 类型」；
 * - PRD 0060 §5（readLogicalValueAtPath 条目）：同步 API；不执行 I/O，不重复结构/逻辑验证；
 *   `schema 不允许的路径返回 PATH_NOT_ALLOWED`；`合法 optional/Record 缺键和非负整数数组越界返回
 *   ok:true, value:undefined`；`负数、非整数或字符串数组下标非法`；`leaf/plain/XML 均不可下钻；
 *   plain 数组不支持元素级读取`；只转换目标子树，返回与 live doc 解耦的普通值副本，不返回 Yjs 类型；
 * - wiki/raw/task_read-logical-value-at-path_conflict_report.md 注记 B：`PATH_NOT_ALLOWED` 为任务层
 *   稳定错误码命名，保持为 @nomicore/doc-runtime 领域化结果联合（`{ ok:false, code:… }` 形态），
 *   不得并入逻辑校验的 issues 体系。
 *
 * 本文件是 SA3 实现的唯一行为锚点（SA1 设计不得收窄下列可观测契约，仅可补充）：
 * - 公共接缝：`readLogicalValueAtPath(derived: DerivedSchema, doc: Y.Doc, path: readonly
 *   (string | number)[])` 经 `packages/doc-runtime/src/index.ts` 包公共入口导出；同步、不抛错
 *   （错误经返回值传递，与 extractYjsSnapshot / vfsl 公共接缝纪律同源）；
 * - 结果联合（注记 B 冻结形态；沿仓内 `{ ok, … }` 惯例）：
 *     `{ ok: true; value: unknown }`（成功：目标子树普通值副本；空 path = 完整 ROOT 副本）
 *     `{ ok: false; code: 'PATH_NOT_ALLOWED'; path: Array<string | number> }`
 *     （schema 不允许的路径；fail-fast 单错，path 回显整条尝试路径——与 ExtractIssue.path
 *     精确锚定先例一致；不并入 issues 数组体系）；
 * - AC3 缺键形态：`{ ok: true; value: undefined }`——value 键必须显式存在且值为 undefined
 *   （PRD「返回 ok:true, value:undefined」措辞冻结，禁止省略 value 键）；
 * - 成功 value 为与 live doc 解耦的普通值深拷贝：无 Yjs 类型泄漏（不返回 Y.Map/Y.Array/
 *   Y.XmlFragment/Y.Text），JSON 往返无损；XML 为字符串投影，只承诺语义等价（ADR-0007）；
 * - AC6 行为锚点（不锁实现）：目标子树读取只返回目标子树（非全树）；读取不重复全树验证——
 *   doc 中与目标无关的兄弟子树结构损坏不影响目标读取（ADR「只按 path 快速执行」的可观测面）；
 *   返回值修改不影响 live doc（重读原值 + extractYjsSnapshot 实证）。
 *
 * 红灯现状（构造性红灯，同 extract-yjs-snapshot.test.ts 先例）：`packages/doc-runtime/src/index.ts`
 * 尚未导出 readLogicalValueAtPath——本文件静态 import 命名导出即失败，vitest 报告
 * "does not provide an export named 'readLogicalValueAtPath'"（ESM 命名导出解析失败），
 * 全部用例红；`tsc -p packages/doc-runtime/tsconfig.json` 同步报 TS2305（无该导出成员）。
 * SA3 实现公共导出后转绿。本文件不预设实现内部结构（不读源码、不 grep 文本形状），
 * 全部断言锚定 readLogicalValueAtPath 的可观测输出。
 *
 * fixture 构建纪律（实证自 yjs@13.6，同 extract 测试）：plain JS 数组/对象可作 Y.Map 值存储
 * （载体 'plain value'）；Y.Map 值可为嵌套 Y.Array/Y.Map/Y.XmlFragment（载体 = 各自类型名）；
 * Yjs 类型必须先挂接到 doc（经 set/insert 集成）再读取；同一 Y.XmlFragment 实例不可挂两处
 * （已集成类型再 set 会抛错）——xmlBody 与 doc1.body 各建独立 fragment。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { evaluate, parseVfsl } from '@nomicore/vfsl';
import type { DerivedSchema } from '@nomicore/vfsl';
// 构造性红灯：index.ts 尚不导出 readLogicalValueAtPath，本 import 在模块加载阶段即失败（全用例红）。
// SA3 在 packages/doc-runtime/src/index.ts 导出后转绿。
import { readLogicalValueAtPath } from '../src/index.js';
import { extractYjsSnapshot } from '../src/index.js';

// —— 测试契约类型（注记 B + PRD §5 + ADR-0007 冻结）——

/**
 * readLogicalValueAtPath 结果联合（SA6 冻结形态，SA1 不得收窄）：
 * - ok:true 恒携带 value（成功 = 目标子树普通值副本；AC3 缺键 = value 显式存在且为 undefined）；
 * - ok:false 恒携带 code:'PATH_NOT_ALLOWED' 与 path（整条尝试路径回显，fail-fast）。
 */
type ReadLogicalValueResult =
  | { ok: true; value: unknown }
  | { ok: false; code: 'PATH_NOT_ALLOWED'; path: readonly (string | number)[] };

// —— 测试辅助 ——

function derivedOf(text: string): DerivedSchema {
  const parsed = parseVfsl(text);
  if (!parsed.ok) throw new Error(`前置 parseVfsl 失败（fixture 缺陷）：${JSON.stringify(parsed.issues)}`);
  const evaluated = evaluate(parsed.module);
  if (!evaluated.ok) throw new Error(`前置 evaluate 失败（fixture 缺陷）：${JSON.stringify(evaluated.issues)}`);
  return evaluated.derived;
}

/** 成功读取：断言 ok:true 并返回 value（AC 成功形态）。 */
function expectOkValue(result: ReadLogicalValueResult): unknown {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`期望 ok:true，实际 code=${result.code}（path: ${JSON.stringify(result.path)}）`);
  }
  return result.value;
}

/** AC3 缺键形态：ok:true 且 value 键显式存在、值为 undefined（禁省略 value 键）。 */
function expectUndefinedValue(result: ReadLogicalValueResult): void {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`期望 ok:true（合法缺键），实际 code=${result.code}`);
  }
  expect(Object.prototype.hasOwnProperty.call(result, 'value')).toBe(true);
  expect(result.value).toBeUndefined();
}

/** AC2/AC4/AC5 非法路径形态：ok:false + code:'PATH_NOT_ALLOWED' + path 回显尝试路径（fail-fast）。 */
function expectNotAllowed(result: ReadLogicalValueResult, attemptedPath: readonly (string | number)[]): void {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error('期望 PATH_NOT_ALLOWED，实际 ok:true');
  }
  expect(result.code).toBe('PATH_NOT_ALLOWED'); // 注记 B：领域化错误码，不并入 issues 体系
  expect(result.path).toEqual(attemptedPath); // 锚定整条尝试路径（与 ExtractIssue.path 先例一致）
}

/** 普通值深拷贝断言：递归无 Yjs 类型泄漏（PRD「不返回 Yjs 类型」）。 */
function expectNoYjsLeak(v: unknown): void {
  if (
    v instanceof Y.Map || v instanceof Y.Array
    || v instanceof Y.XmlFragment || v instanceof Y.Text || v instanceof Y.AbstractType
  ) {
    throw new Error('返回值泄漏 Yjs 类型');
  }
  if (Array.isArray(v)) {
    for (const el of v) expectNoYjsLeak(el);
    return;
  }
  if (v !== null && typeof v === 'object') {
    for (const k of Object.keys(v)) {
      expectNoYjsLeak((v as Record<string, unknown>)[k]);
    }
  }
}

/** XML 语义等价归一化（ADR-0007：只承诺语义等价，不承诺逐字 round-trip）。 */
function normalizeXml(xml: string): string {
  return xml.replace(/>\s+</g, '><').trim();
}

/** 深度归一化：把普通值里所有形如 XML 的字符串归一化（供 toEqual 比较，不锁逐字序列化）。 */
function normalizeXmlDeep(v: unknown): unknown {
  if (typeof v === 'string' && v.trimStart().startsWith('<')) return normalizeXml(v);
  if (Array.isArray(v)) return v.map(normalizeXmlDeep);
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>)) {
      out[k] = normalizeXmlDeep((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

// —— 规格 fixture：覆盖 map/leaf/optional/Record(YPattern 键)/Y.Array/plain 数组/xml/union/ref 全形态 ——
// （与 extract-yjs-snapshot.test.ts 同构文本子集；ADR-0001 测试 fixture 例外）

const FIXTURE = `
/** 资产 ID：Record 键 Pattern（禁 "." 与 "|"，允许字母数字下划线连字符） */
type AssetId = string & Pattern<"^[A-Za-z0-9_\\\\-]{1,64}$">;

/** 资产实体：按 kind 判别的封闭联合（image 为纯 leaf 成员，text 含 xml-fragment 终态） */
type AssetEntity =
  | { kind: "image"; url: YLeaf<string>; width: YLeaf<number>; height: YLeaf<number> }
  | { kind: "text"; body: YXmlFragment<{ paragraphs: YArray<YLeaf<string>> }> };

/** 附件：与 Yjs 同步无关的纯值数组（plain 终态，不支持元素级读取） */
type Attachments = YPlainArray<YLeaf<string>>;

/** ROOT：命名空间根文档；assets 键集受 AssetId Pattern 约束；keywords 为 Y.Array；notes 可选 */
type ROOT = YMap<{
  title: YLeaf<string>;
  assets: Record<AssetId, AssetEntity>;
  attachments: Attachments;
  notes?: YLeaf<string>;
  keywords: YArray<YLeaf<string>>;
  xmlBody: YXmlFragment<{ paragraphs: YArray<YLeaf<string>> }>;
}>;
`.trim();

const DERIVED = derivedOf(FIXTURE);

/** 与 FIXTURE 完全匹配的 live Y.Doc（正确载体；notes 在场）。 */
function buildDoc(): Y.Doc {
  const doc = new Y.Doc();
  const root = doc.getMap('ROOT');

  const img1 = new Y.Map();
  img1.set('kind', 'image');
  img1.set('url', 'https://cdn/x.png');
  img1.set('width', 10);
  img1.set('height', 20);

  const xml = new Y.XmlFragment();
  const p = new Y.XmlElement('p');
  p.insert(0, [new Y.XmlText('Hello ')]);
  const b = new Y.XmlElement('b');
  b.insert(0, [new Y.XmlText('world')]);
  p.insert(1, [b]);
  xml.insert(0, [p]);

  const doc1 = new Y.Map();
  doc1.set('kind', 'text');
  doc1.set('body', xml);

  const assets = new Y.Map();
  assets.set('img1', img1);
  assets.set('doc1', doc1);

  const keywords = new Y.Array();
  keywords.insert(0, ['k1', 'k2']);

  const xmlBody = new Y.XmlFragment(); // 独立 fragment（同实例不可挂两处）
  const p2 = new Y.XmlElement('p');
  p2.insert(0, [new Y.XmlText('Hello ')]);
  const b2 = new Y.XmlElement('b');
  b2.insert(0, [new Y.XmlText('world')]);
  p2.insert(1, [b2]);
  xmlBody.insert(0, [p2]);

  root.set('title', 'Hello');
  root.set('assets', assets);
  root.set('attachments', ['x', 'y']);
  root.set('notes', 'set');
  root.set('keywords', keywords);
  root.set('xmlBody', xmlBody);
  return doc;
}

/** 期望 logical ROOT（普通 JSON；XML 为语义等价投影）。 */
const EXPECTED_ROOT = {
  title: 'Hello',
  assets: {
    img1: { kind: 'image', url: 'https://cdn/x.png', width: 10, height: 20 },
    doc1: { kind: 'text', body: '<p>Hello <b>world</b></p>' },
  },
  attachments: ['x', 'y'],
  notes: 'set',
  keywords: ['k1', 'k2'],
  xmlBody: '<p>Hello <b>world</b></p>',
};

// —— AC1：path 统一为 readonly (string | number)[]；空 path 显式读取完整 ROOT ——

describe('AC1 — 空 path 读取完整 ROOT；path 形态（readonly (string | number)[]）', () => {
  it('[] → ok:true，value 为完整 logical ROOT 普通值副本（JSON 往返无损、无 Yjs 泄漏）', () => {
    const doc = buildDoc();
    const value = expectOkValue(readLogicalValueAtPath(DERIVED, doc, []));
    expect(normalizeXmlDeep(value)).toEqual(EXPECTED_ROOT);
    expect(JSON.parse(JSON.stringify(value))).toEqual(value); // 普通 JSON = 无 live Yjs 类型混入
    expectNoYjsLeak(value);
  });

  it('readonly (string | number)[] 变量路径可读深层子树（map string 段 + 数组 number 段混合）', () => {
    const doc = buildDoc();
    const path: readonly (string | number)[] = ['assets', 'img1', 'url'];
    const value = expectOkValue(readLogicalValueAtPath(DERIVED, doc, path));
    expect(value).toBe('https://cdn/x.png');
    // 元组形态（as const）同样可传
    expect(expectOkValue(readLogicalValueAtPath(DERIVED, doc, ['assets', 'img1', 'url'] as const)))
      .toBe('https://cdn/x.png');
  });

  it('边界：全新空 doc（ROOT 未建）→ [] 读取 { }', () => {
    const doc = new Y.Doc();
    const value = expectOkValue(readLogicalValueAtPath(DERIVED, doc, []));
    expect(value).toEqual({});
    expectNoYjsLeak(value);
  });
});

// —— AC2：schema 不允许的路径返回 PATH_NOT_ALLOWED ——

describe('AC2 — schema 不允许的路径 → { ok:false, code:"PATH_NOT_ALLOWED", path 回显 }', () => {
  it('未知 ROOT 字段 → PATH_NOT_ALLOWED，path 回显 ["nope"]', () => {
    const doc = buildDoc();
    expectNotAllowed(readLogicalValueAtPath(DERIVED, doc, ['nope']), ['nope']);
  });

  it('Record 键违反 AssetId Pattern（含空格与 !）→ PATH_NOT_ALLOWED（非「合法缺键」）', () => {
    const doc = buildDoc();
    expectNotAllowed(readLogicalValueAtPath(DERIVED, doc, ['assets', 'bad key!']), ['assets', 'bad key!']);
  });

  it('union 成员内未知字段 → PATH_NOT_ALLOWED，path 回显整条尝试路径', () => {
    const doc = buildDoc();
    expectNotAllowed(readLogicalValueAtPath(DERIVED, doc, ['assets', 'img1', 'nope']), ['assets', 'img1', 'nope']);
  });
});

// —— AC3：合法 optional/Record 缺键和非负整数数组越界 → ok:true, value:undefined ——

describe('AC3 — 合法缺键 → { ok:true, value:undefined }（value 键显式存在）', () => {
  it('缺席 optional 字段 → ok:true value:undefined', () => {
    const doc = buildDoc();
    doc.getMap('ROOT').delete('notes'); // 构造 notes 缺席
    expectUndefinedValue(readLogicalValueAtPath(DERIVED, doc, ['notes']));
  });

  it('缺席 Record 键（键合法但未在场）→ ok:true value:undefined', () => {
    const doc = buildDoc();
    expectUndefinedValue(readLogicalValueAtPath(DERIVED, doc, ['assets', 'missing-key']));
  });

  it('非负整数数组下标越界 → ok:true value:undefined', () => {
    const doc = buildDoc();
    expectUndefinedValue(readLogicalValueAtPath(DERIVED, doc, ['keywords', 5]));
  });

  it('正向对照：optional 在场 / Record 键在场 / 下标在场 → 返回实际值', () => {
    const doc = buildDoc();
    expect(expectOkValue(readLogicalValueAtPath(DERIVED, doc, ['notes']))).toBe('set');
    expect(expectOkValue(readLogicalValueAtPath(DERIVED, doc, ['keywords', 1]))).toBe('k2');
    const entity = expectOkValue(readLogicalValueAtPath(DERIVED, doc, ['assets', 'img1']));
    expect(normalizeXmlDeep(entity)).toEqual(EXPECTED_ROOT.assets.img1);
  });
});

// —— AC4：负数、非整数或字符串数组下标非法 ——

describe('AC4 — Y.Array 下标：负数/非整数/字符串非法 → PATH_NOT_ALLOWED', () => {
  it('负数下标 -1 → PATH_NOT_ALLOWED', () => {
    const doc = buildDoc();
    expectNotAllowed(readLogicalValueAtPath(DERIVED, doc, ['keywords', -1]), ['keywords', -1]);
  });

  it('非整数下标 1.5 → PATH_NOT_ALLOWED', () => {
    const doc = buildDoc();
    expectNotAllowed(readLogicalValueAtPath(DERIVED, doc, ['keywords', 1.5]), ['keywords', 1.5]);
  });

  it('字符串下标 "0" → PATH_NOT_ALLOWED（Y.Array 段必须为 number；string 仅用于 map/Record）', () => {
    const doc = buildDoc();
    expectNotAllowed(readLogicalValueAtPath(DERIVED, doc, ['keywords', '0']), ['keywords', '0']);
  });

  it('正向对照：合法非负整数下标 → 返回元素', () => {
    const doc = buildDoc();
    expect(expectOkValue(readLogicalValueAtPath(DERIVED, doc, ['keywords', 0]))).toBe('k1');
  });
});

// —— AC5：leaf/plain/XML 为不可下钻终态；plain 数组只允许整体读取 ——

describe('AC5 — 终态不可下钻；plain 数组只允许整体读取', () => {
  it('leaf 不可下钻：["title","x"] → PATH_NOT_ALLOWED', () => {
    const doc = buildDoc();
    expectNotAllowed(readLogicalValueAtPath(DERIVED, doc, ['title', 'x']), ['title', 'x']);
  });

  it('plain 数组只允许整体读取：["attachments",0] → PATH_NOT_ALLOWED；["attachments"] → 全量普通副本', () => {
    const doc = buildDoc();
    expectNotAllowed(readLogicalValueAtPath(DERIVED, doc, ['attachments', 0]), ['attachments', 0]);
    const value = expectOkValue(readLogicalValueAtPath(DERIVED, doc, ['attachments']));
    expect(value).toEqual(['x', 'y']);
    expectNoYjsLeak(value);
  });

  it('xml-fragment 不可下钻：["xmlBody","child"] → PATH_NOT_ALLOWED；["xmlBody"] → XML 字符串（语义等价）', () => {
    const doc = buildDoc();
    expectNotAllowed(readLogicalValueAtPath(DERIVED, doc, ['xmlBody', 'child']), ['xmlBody', 'child']);
    const value = expectOkValue(readLogicalValueAtPath(DERIVED, doc, ['xmlBody']));
    expect(typeof value).toBe('string');
    expect(normalizeXml(value as string)).toBe('<p>Hello <b>world</b></p>'); // 语义等价，不锁逐字
  });
});

// —— AC6：读取成本与目标子树规模相关；返回值修改不影响 live doc ——

describe('AC6 — 目标子树读取（成本与子树规模相关）+ 返回副本与 live doc 解耦', () => {
  it('目标子树读取只返回目标子树（非全树）：["assets"] → 仅 assets 的普通副本', () => {
    const doc = buildDoc();
    const value = expectOkValue(readLogicalValueAtPath(DERIVED, doc, ['assets']));
    expect(normalizeXmlDeep(value)).toEqual(EXPECTED_ROOT.assets);
    expect(Object.keys(value as Record<string, unknown>)).toEqual(['img1', 'doc1']); // 不含 ROOT 其他键
    expectNoYjsLeak(value);
  });

  it('返回值修改不影响 live doc：push/改写/嵌套写后重读原值，extractYjsSnapshot 实证 doc 未变', () => {
    const doc = buildDoc();
    // 读 keywords → 突变返回的数组
    const kw = expectOkValue(readLogicalValueAtPath(DERIVED, doc, ['keywords'])) as string[];
    kw.push('k3');
    kw[0] = 'mutated';
    // 读 assets → 突变返回的嵌套对象
    const assets = expectOkValue(readLogicalValueAtPath(DERIVED, doc, ['assets'])) as {
      img1: { url: string };
    };
    assets.img1.url = 'hacked';
    // 重读 → 原值
    expect(expectOkValue(readLogicalValueAtPath(DERIVED, doc, ['keywords']))).toEqual(['k1', 'k2']);
    expect(normalizeXmlDeep(expectOkValue(readLogicalValueAtPath(DERIVED, doc, ['assets']))))
      .toEqual(EXPECTED_ROOT.assets);
    // live doc 实证（独立读取路径 extractYjsSnapshot 为 ground truth）
    const snapshot = extractYjsSnapshot(DERIVED, doc);
    expect(snapshot.ok).toBe(true);
    if (snapshot.ok) {
      const s = snapshot.snapshot as { keywords: string[]; assets: { img1: { url: string } } };
      expect(s.keywords).toEqual(['k1', 'k2']);
      expect(s.assets.img1.url).toBe('https://cdn/x.png');
    }
  });

  it('不重复全树验证：与目标无关的兄弟子树结构损坏不影响目标读取（ADR「只按 path 快速执行」）', () => {
    // 场景 A：目标 title 完好；兄弟 assets 载体错位（plain object 冒充 Y.Map）
    const docA = new Y.Doc();
    const rootA = docA.getMap('ROOT');
    rootA.set('title', 'Hello');
    rootA.set('assets', { fake: 'plain object instead of Y.Map' }); // 结构不变量损坏（不在目标路径上）
    expect(expectOkValue(readLogicalValueAtPath(DERIVED, docA, ['title']))).toBe('Hello');
    // 场景 B：目标 assets.img1.url 完好；兄弟 title 载体错位（Y.Map 冒充 leaf）
    const docB = new Y.Doc();
    const rootB = docB.getMap('ROOT');
    rootB.set('title', new Y.Map()); // 结构不变量损坏（不在目标路径上）
    const img1 = new Y.Map();
    img1.set('kind', 'image');
    img1.set('url', 'https://cdn/x.png');
    img1.set('width', 10);
    img1.set('height', 20);
    const assets = new Y.Map();
    assets.set('img1', img1);
    rootB.set('assets', assets);
    expect(expectOkValue(readLogicalValueAtPath(DERIVED, docB, ['assets', 'img1', 'url'])))
      .toBe('https://cdn/x.png');
  });
});
