/**
 * SA6 红灯测试 — @nomicore/doc-runtime extractYjsSnapshot(derived, doc)（issue #73，功能开发）。
 *
 * 契约来源：
 * - 任务简报 wiki/raw/task_doc-runtime-extract-yjs-snapshot.md（Issue #73）：
 *   `extractYjsSnapshot(derived, doc)` 只读取固定 ROOT，严格区分 Y.Map/Y.Array/
 *   Y.XmlFragment/plain 载体，首个结构错误即停止，成功返回普通 logical ROOT snapshot，
 *   SCHEMA 与 META 不在本能力范围；AC2 遍历覆盖 root/map/array/xml/leaf/plain/union/ref
 *   且 Yjs 与 plain 载体错位响亮失败；AC3 fail-fast 单 issue 携带精确 string/number path、
 *   expected 与 actual，错误节点不继续下钻；AC4 成功快照与 live doc 解耦、XML 语义等价
 *   而非逐字 round-trip；AC6 行为测试覆盖结构错位、Record、union/ref、plain 与 XML；
 * - docs/adr/0007（Yjs bridge 独立为 @nomicore/doc-runtime）：只读固定 ROOT；路径统一为
 *   `readonly (string | number)[]`（map/object/Record 用 string，Y.Array 用 number；禁点号
 *   字符串与 JSON Pointer）；leaf/plain/XML 是不可下钻终态；底层能力保留领域化结果联合，
 *   Yjs 结构错误 fail-fast；XML string 与 Y.XmlFragment 只承诺语义等价 round-trip；
 * - docs/adr/0003（派生 schema 结构树）：root/map/array/xml-fragment/leaf/plain/union/ref
 *   节点形状（map 字段声明序、Record 动态键段 '<key>'、ref 按名经 aliases 解析不内联、
 *   union any-of + 判别式缓存不改变可观测行为、xml-fragment 为不透明终态、JSON 快照中
 *   XML 值为字符串（与 Y.XmlFragment.toJSON() 投影一致））；
 * - CONTEXT.md：ROOT 固定物化为 Y.Map，Yjs 映射为 doc 根 getMap('ROOT')；Yjs 与 plain
 *   载体严格区分。
 *
 * 本文件是 SA3 实现的唯一行为锚点（SA1 设计不得收窄下列可观测契约，仅可补充）：
 * - 公共接缝：`extractYjsSnapshot(derived: DerivedSchema, doc: Y.Doc)` 经
 *   `packages/doc-runtime/src/index.ts` 包公共入口导出（与 @nomicore/vfsl 同款
 *   `exports["."] = "./src/index.ts"`）；
 * - 结果联合（沿仓内 parseVfsl / validateLogicalSnapshot 的 `{ ok, issues }` 惯例；
 *   ADR-0007「领域化结果联合」）：`{ ok: true; snapshot: unknown } |
 *   { ok: false; issues: ExtractIssue[] }`——fail-fast 单 issue 即 `issues.length === 1`；
 * - ExtractIssue：`{ message: string; path: Array<string | number>; expected: string;
 *   actual: string }`——path 精确到首个错位节点（数组下标为 number）；expected/actual
 *   词汇表冻结为运行时载体名：'Y.Map' / 'Y.Array' / 'Y.XmlFragment' / 'Y.Text' /
 *   'plain value'（expected 依结构树节点所需载体；actual 依 doc 实际存储载体；
 *   root/map → 'Y.Map'，array → 'Y.Array'，xml-fragment → 'Y.XmlFragment'，
 *   leaf/plain → 'plain value'；含缺失字段不报——缺失属 validateLogicalSnapshot 逻辑域，
 *   见 ADR-0007「ROOT 载体提取和逻辑校验」两步分离）；message 仅要求非空字符串（措辞
 *   属 SA1 自由）；
 * - 不抛错纪律：yjs 对「ROOT 已以异型构造函数存在」的 getMap/getArray 原生 throw
 *   （'Type with the name ROOT has already been defined with a different constructor'）
 *   必须被转化收敛为 `{ ok: false, issues: [issue] }`，绝不外抛（与 vfsl 公共接缝
 *   「同步、不抛错，错误经返回值传递」纪律同源）。
 *
 * 红灯现状（构造性红灯，同 parse-schema-envelope.test.ts / schemasource-seam.test.ts
 * 先例）：`../src/index.js` 尚不存在（新包无 src），本文件静态 import 即失败——vitest
 * 报告 Failed to resolve import，全部用例红。SA3 建立包 src 并实现公共导出后转绿；
 * 本文件不预设实现内部结构（不读源码、不 grep 文本形状），全部断言锚定
 * extractYjsSnapshot 的可观测输出。
 *
 * fixture 构建纪律（实证自 yjs@13.6）：plain JS 数组/对象可作 Y.Map 值存储（载体 =
 * 'plain value'）；Y.Map 值可为嵌套 Y.Array/Y.Map/Y.XmlFragment/Y.Text（载体 = 各自
 * 类型名）；Yjs 类型必须先挂接到 doc（经 set/insert 集成）再读取，故 fixture 一律
 * 先构建后读取、经 extract 路径读取；`doc.getArray('ROOT')` 与 `doc.getMap('ROOT')`
 * 互斥——异型载体先创建后，同名的 getMap/getArray 抛错。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { evaluate, parseVfsl } from '@nomicore/vfsl';
import type { DerivedSchema } from '@nomicore/vfsl';
// 构造性红灯：新包 src 尚不存在，本 import 在 vitest 收集阶段即失败（全用例红）。
// SA3 建立 packages/doc-runtime/src/index.ts 并导出 extractYjsSnapshot 后转绿。
import { extractYjsSnapshot } from '../src/index.js';

// —— 测试契约类型（任务简报 AC3 + ADR-0007 冻结）——

/** fail-fast 单 issue：精确 string/number path + expected + actual（AC3）。 */
interface ExtractIssue {
  message: string;
  /** 段数组：map/object/Record 用 string，Y.Array 用 number；[] 即 ROOT 自身。 */
  path: Array<string | number>;
  /** 结构树节点所需载体（词汇表：'Y.Map'/'Y.Array'/'Y.XmlFragment'/'plain value'）。 */
  expected: string;
  /** doc 实际存储载体（词汇表另含 'Y.Text'）。 */
  actual: string;
}

type ExtractResult =
  | { ok: true; snapshot: unknown }
  | { ok: false; issues: ExtractIssue[] };

// —— 测试辅助 ——

function derivedOf(text: string): DerivedSchema {
  const parsed = parseVfsl(text);
  if (!parsed.ok) throw new Error(`前置 parseVfsl 失败（fixture 缺陷）：${JSON.stringify(parsed.issues)}`);
  const evaluated = evaluate(parsed.module);
  if (!evaluated.ok) throw new Error(`前置 evaluate 失败（fixture 缺陷）：${JSON.stringify(evaluated.issues)}`);
  return evaluated.derived;
}

/** 断言失败结果：ok:false + 恰 1 条 issue（fail-fast 单 issue，AC3），返回该 issue。 */
function expectSingleIssue(result: ExtractResult): ExtractIssue {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error(`期望 ok:false，实际 ok:true（snapshot: ${JSON.stringify(result.snapshot)}）`);
  }
  expect(result.issues).toHaveLength(1);
  const issue = result.issues[0];
  expect(issue).toBeDefined();
  if (!issue) throw new Error('issues 数组为空');
  expect(typeof issue.message).toBe('string');
  expect(issue.message.length).toBeGreaterThan(0);
  return issue;
}

/** 断言 issue 的精确 path 与 expected/actual 词汇（AC3 锚）。 */
function expectIssueAt(issue: ExtractIssue, path: Array<string | number>, expected: string, actual: string): void {
  expect(issue.path).toEqual(path);
  expect(issue.expected).toBe(expected);
  expect(issue.actual).toBe(actual);
}

/** 断言 ok:true 并返回 snapshot。 */
function expectOkSnapshot(result: ExtractResult): unknown {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`期望 ok:true，实际 ok:false（issues: ${JSON.stringify(result.issues)}）`);
  }
  return result.snapshot;
}

/** XML 语义等价归一化（AC4：只承诺语义等价，不承诺逐字 round-trip）：
 * 折叠标签间空白后比较结构与文本内容；不排序属性、不改写文本。 */
function normalizeXml(xml: string): string {
  return xml.replace(/>\s+</g, '><').trim();
}

/** AC4 执行：整体深度比较前把快照中的 XML body 归一化，使 toEqual 不锁定
 * XML 的逐字序列化（只承诺语义等价；EXPECTED_SNAPSHOT 为归一化规范形）。 */
function withNormalizedXml(snapshot: unknown): unknown {
  const s = snapshot as { assets: { doc1: { body: unknown } } };
  const body = s.assets.doc1.body;
  return {
    ...s,
    assets: {
      ...s.assets,
      doc1: { ...s.assets.doc1, body: typeof body === 'string' ? normalizeXml(body) : body },
    },
  };
}

// —— 规格 §10 vfs3.assets 参考 fixture（与 parse/evaluate/validate 侧同文本；ADR-0001
// 测试 fixture 例外）：覆盖 map/array/xml-fragment/leaf/plain/union/ref/Record 全形态 ——

const FIXTURE = `
/** vfs3.assets — 依据 issue #9 描述还原（原设计文档缺位） */

/** 资产 ID：键约束由 Pattern 定义，禁 "." 与 "|" */
type AssetId = string & Pattern<"^[A-Za-z0-9_\\\\-]{1,64}$">;

/** 审计信息：所有写入留痕 */
type Audit = YMap<{
  createdBy: YLeaf<string>;
  createdAt: YLeaf<number>;
}>;

/** 资产实体：按 kind 判别的封闭联合 */
type AssetEntity =
  | { kind: "image"; url: YLeaf<string>; width: YLeaf<number>; height: YLeaf<number>; audit: Audit }
  | { kind: "text"; body: YXmlFragment<{ paragraphs: YArray<YLeaf<string>> }>; audit: Audit }
  | { kind: "file"; name: YLeaf<string>; size: YLeaf<number>; tags: YArray<YLeaf<string>>; audit: Audit };

/** 附件：与 Yjs 同步无关的纯值数组 */
type Attachments = YPlainArray<YLeaf<string>>;

/** ROOT：命名空间根文档，assets 键集受 AssetId 的 Pattern 约束 */
type ROOT = YMap<{
  assets: Record<AssetId, AssetEntity>;
  attachments: Attachments;
  audit: Audit;
  /** @semantic 可选说明字段 */
  notes?: YLeaf<string>;
  keywords: YLeaf<string>[];
}>;
`.trim();

const DERIVED = derivedOf(FIXTURE);

/** 构建与 FIXTURE 完全匹配的 live Y.Doc（正确载体）；返回 doc 与可变引用（供突变解耦测试）。 */
function buildFullDoc(): {
  doc: Y.Doc;
  refs: { audit: Y.Map<unknown>; img1: Y.Map<unknown>; tags: Y.Array<unknown>; xml: Y.XmlFragment };
} {
  const doc = new Y.Doc();
  const root = doc.getMap('ROOT');

  const auditImg = new Y.Map();
  auditImg.set('createdBy', 'alice');
  auditImg.set('createdAt', 111);

  const auditDoc = new Y.Map();
  auditDoc.set('createdBy', 'bob');
  auditDoc.set('createdAt', 222);

  const auditFile = new Y.Map();
  auditFile.set('createdBy', 'carol');
  auditFile.set('createdAt', 333);

  const img1 = new Y.Map();
  img1.set('kind', 'image');
  img1.set('url', 'https://cdn/x.png');
  img1.set('width', 10);
  img1.set('height', 20);
  img1.set('audit', auditImg);

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
  doc1.set('audit', auditDoc);

  const tags = new Y.Array();
  tags.insert(0, ['a', 'b']);

  const f1 = new Y.Map();
  f1.set('kind', 'file');
  f1.set('name', 'readme.txt');
  f1.set('size', 12);
  f1.set('tags', tags);
  f1.set('audit', auditFile);

  const assets = new Y.Map();
  assets.set('img1', img1);
  assets.set('doc1', doc1);
  assets.set('f1', f1);

  const rootAudit = new Y.Map();
  rootAudit.set('createdBy', 'root');
  rootAudit.set('createdAt', 999);

  root.set('assets', assets);
  root.set('attachments', ['x', 'y']); // plain 载体（YPlainArray → 纯值上下文）
  root.set('audit', rootAudit);
  root.set('keywords', new Y.Array()); // Y.Array 载体（YLeaf<string>[] → array 节点）
  const keywords = root.get('keywords') as Y.Array<string>;
  keywords.insert(0, ['k1', 'k2']);

  return { doc, refs: { audit: rootAudit, img1, tags, xml } };
}

/** FIXTURE 正确 doc 的期望逻辑 ROOT（普通 JSON；XML body 为 toJSON 投影值）。 */
const EXPECTED_SNAPSHOT = {
  assets: {
    img1: {
      kind: 'image',
      url: 'https://cdn/x.png',
      width: 10,
      height: 20,
      audit: { createdBy: 'alice', createdAt: 111 },
    },
    doc1: {
      kind: 'text',
      body: '<p>Hello <b>world</b></p>',
      audit: { createdBy: 'bob', createdAt: 222 },
    },
    f1: {
      kind: 'file',
      name: 'readme.txt',
      size: 12,
      tags: ['a', 'b'],
      audit: { createdBy: 'carol', createdAt: 333 },
    },
  },
  attachments: ['x', 'y'],
  audit: { createdBy: 'root', createdAt: 999 },
  keywords: ['k1', 'k2'],
};

describe('extractYjsSnapshot — 幸福路径：全形态 fixture → 普通 logical ROOT snapshot（AC4 解耦）', () => {
  it('正确载体 doc → ok:true，snapshot 为普通 JSON（可 JSON 往返，无 Yjs 对象泄漏）', () => {
    const { doc } = buildFullDoc();
    const snapshot = expectOkSnapshot(extractYjsSnapshot(DERIVED, doc));
    expect(withNormalizedXml(snapshot)).toEqual(EXPECTED_SNAPSHOT);
    // 普通逻辑快照：JSON 往返无损 = 无 live Yjs 类型混入（AC「成功返回普通 logical ROOT snapshot」）
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it('成功快照与 live doc 解耦：提取后突变 doc，snapshot 保持不变（AC4）', () => {
    const { doc, refs } = buildFullDoc();
    const snapshot = expectOkSnapshot(extractYjsSnapshot(DERIVED, doc));
    const before = JSON.stringify(snapshot);
    // 对 live doc 做各类突变（map 覆写 / 嵌套 map / Y.Array / Y.XmlFragment / plain 值）
    doc.getMap('ROOT').set('notes', 'changed');
    refs.img1.set('url', 'changed-url');
    refs.audit.set('createdBy', 'hacker');
    refs.tags.insert(2, ['c']);
    refs.xml.insert(0, [new Y.XmlElement('i')]);
    doc.getMap('ROOT').set('attachments', ['z']);
    doc.getMap('ROOT').set('keywords', new Y.Array());
    // 快照为提取时点的普通值，不受 live doc 后续突变影响
    expect(JSON.stringify(snapshot)).toBe(before);
    expect(withNormalizedXml(snapshot)).toEqual(EXPECTED_SNAPSHOT);
  });
});

describe('extractYjsSnapshot — root：ROOT 固定物化为 Y.Map，异型载体响亮失败（AC2 root）', () => {
  it('ROOT 为 Y.Array → 单 issue，path []，expected Y.Map / actual Y.Array，且不外抛（yjs 原生 throw 被收敛）', () => {
    const doc = new Y.Doc();
    doc.getArray('ROOT').insert(0, [1, 2, 3]);
    const issue = expectSingleIssue(extractYjsSnapshot(DERIVED, doc));
    expectIssueAt(issue, [], 'Y.Map', 'Y.Array');
  });

  it('ROOT 为 Y.XmlFragment → 单 issue，path []，expected Y.Map / actual Y.XmlFragment', () => {
    const doc = new Y.Doc();
    doc.getXmlFragment('ROOT');
    const issue = expectSingleIssue(extractYjsSnapshot(DERIVED, doc));
    expectIssueAt(issue, [], 'Y.Map', 'Y.XmlFragment');
  });
});

describe('extractYjsSnapshot — map 字段载体错位：fail-fast 单 issue + 错误节点不继续下钻（AC2 map / AC3）', () => {
  it('首个声明字段即错位 → 单 issue 锚定该字段，后续错位字段不再报告（fail-fast 单 issue）', () => {
    const derived = derivedOf('type ROOT = { a: string; b: string };');
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    root.set('a', new Y.Array());
    root.set('b', new Y.Map());
    const issue = expectSingleIssue(extractYjsSnapshot(derived, doc));
    expectIssueAt(issue, ['a'], 'plain value', 'Y.Array');
    expect(issue.path).not.toContain('b');
  });

  it('错位节点不继续下钻：a 处应为 Y.Map 实为 Y.Array（内含垃圾），issue 只锚 a 字段，不下钻元素', () => {
    const derived = derivedOf('type ROOT = { a: { x: string }; b: { y: string } };');
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    const arr = new Y.Array();
    const garbage = new Y.Map();
    garbage.set('x', new Y.Map());
    arr.insert(0, [garbage]);
    root.set('a', arr);
    root.set('b', new Y.Map());
    const issue = expectSingleIssue(extractYjsSnapshot(derived, doc));
    expectIssueAt(issue, ['a'], 'Y.Map', 'Y.Array');
  });
});

describe('extractYjsSnapshot — array：Y.Array 下标用 number 路径 + 元素载体错位（AC2 array / ADR-0007 路径）', () => {
  it('数组元素为 Y.Map（期望 plain）→ 单 issue 锚 tags[1]（number 下标段）', () => {
    const derived = derivedOf('type ROOT = { tags: string[] };');
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    const tags = new Y.Array();
    root.set('tags', tags);
    tags.insert(0, ['ok']);
    const nested = new Y.Map();
    nested.set('k', 'v');
    tags.insert(1, [nested]);
    tags.insert(2, ['x']);
    const issue = expectSingleIssue(extractYjsSnapshot(derived, doc));
    expectIssueAt(issue, ['tags', 1], 'plain value', 'Y.Map');
  });

  it('array 节点放置 plain JS 数组 → Yjs/plain 错位方向一：expected Y.Array / actual plain value', () => {
    const derived = derivedOf('type ROOT = { keywords: YLeaf<string>[] };');
    const doc = new Y.Doc();
    doc.getMap('ROOT').set('keywords', ['a', 'b']); // plain 载体（非 Y.Array）
    const issue = expectSingleIssue(extractYjsSnapshot(derived, doc));
    expectIssueAt(issue, ['keywords'], 'Y.Array', 'plain value');
  });
});

describe('extractYjsSnapshot — plain：纯值上下文严格区分 Yjs 载体（AC2 plain / AC6 plain）', () => {
  it('plain 节点放置 Y.Array → Yjs/plain 错位方向二：expected plain value / actual Y.Array', () => {
    const derived = derivedOf('type ROOT = { attachments: YPlainArray<string> };');
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    const arr = new Y.Array();
    root.set('attachments', arr);
    arr.insert(0, ['a', 'b']);
    const issue = expectSingleIssue(extractYjsSnapshot(derived, doc));
    expectIssueAt(issue, ['attachments'], 'plain value', 'Y.Array');
  });

  it('plain 节点放置 plain JS 数组 → ok，snapshot 原样提取（逻辑值与 array 节点相同，载体不同）', () => {
    const derived = derivedOf('type ROOT = { attachments: YPlainArray<string> };');
    const doc = new Y.Doc();
    doc.getMap('ROOT').set('attachments', ['a', 'b']);
    const snapshot = expectOkSnapshot(extractYjsSnapshot(derived, doc));
    expect(snapshot).toEqual({ attachments: ['a', 'b'] });
  });
});

describe('extractYjsSnapshot — leaf：Yjs 类型放标量位 → 载体错位（AC2 leaf）', () => {
  it('leaf 位放 Y.Text → 单 issue 锚 profile.name，expected plain value / actual Y.Text', () => {
    const derived = derivedOf('type ROOT = { profile: { name: string } };');
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    const profile = new Y.Map();
    root.set('profile', profile);
    profile.set('name', new Y.Text('x'));
    const issue = expectSingleIssue(extractYjsSnapshot(derived, doc));
    expectIssueAt(issue, ['profile', 'name'], 'plain value', 'Y.Text');
  });

  it('leaf 位放 Y.Map → 单 issue 锚 profile.name，expected plain value / actual Y.Map', () => {
    const derived = derivedOf('type ROOT = { profile: { name: string } };');
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    const profile = new Y.Map();
    root.set('profile', profile);
    profile.set('name', new Y.Map());
    const issue = expectSingleIssue(extractYjsSnapshot(derived, doc));
    expectIssueAt(issue, ['profile', 'name'], 'plain value', 'Y.Map');
  });
});

describe('extractYjsSnapshot — Record：动态键逐键下钻（AC6 Record）', () => {
  it('Record 正确：多动态键各自按值载体提取 → ok，snapshot 保留全部键', () => {
    const derived = derivedOf('type ROOT = { m: Record<string, { a: string }> };');
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    const m = new Y.Map();
    root.set('m', m);
    const k1 = new Y.Map();
    k1.set('a', 'x');
    const k2 = new Y.Map();
    k2.set('a', 'y');
    m.set('k1', k1);
    m.set('k2', k2);
    const snapshot = expectOkSnapshot(extractYjsSnapshot(derived, doc));
    expect(snapshot).toEqual({ m: { k1: { a: 'x' }, k2: { a: 'y' } } });
  });

  it('Record 值放置 plain 对象（期望 Y.Map）→ 单 issue 锚 assets.img1', () => {
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    const assets = new Y.Map();
    root.set('assets', assets);
    assets.set('img1', { kind: 'image' }); // plain 载体
    const issue = expectSingleIssue(extractYjsSnapshot(DERIVED, doc));
    expectIssueAt(issue, ['assets', 'img1'], 'Y.Map', 'plain value');
  });
});

describe('extractYjsSnapshot — union/ref：判别式成员选择 + ref 经 aliases 解析（AC6 union/ref）', () => {
  it('判别联合三成员（image/text/file）各自正确提取（成员字段互异，按 kind 判别）', () => {
    const { doc } = buildFullDoc();
    const snapshot = expectOkSnapshot(extractYjsSnapshot(DERIVED, doc));
    expect(withNormalizedXml(snapshot)).toEqual(EXPECTED_SNAPSHOT);
  });

  it('union 成员内字段载体错位 → 单 issue 锚深路径 assets.img1.url（含 Record+union+ref 链路）', () => {
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    const assets = new Y.Map();
    root.set('assets', assets);
    const img1 = new Y.Map();
    img1.set('kind', 'image');
    img1.set('url', new Y.Map()); // 应为 plain string
    img1.set('width', 1);
    img1.set('height', 2);
    const audit = new Y.Map();
    audit.set('createdBy', 'alice');
    audit.set('createdAt', 111);
    img1.set('audit', audit);
    assets.set('img1', img1);
    const issue = expectSingleIssue(extractYjsSnapshot(DERIVED, doc));
    expectIssueAt(issue, ['assets', 'img1', 'url'], 'plain value', 'Y.Map');
  });

  it('ref 目标（Audit 别名 → map 节点）载体错位 → 单 issue 锚 assets.img1.audit', () => {
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    const assets = new Y.Map();
    root.set('assets', assets);
    const img1 = new Y.Map();
    img1.set('kind', 'image');
    img1.set('url', 'u');
    img1.set('width', 1);
    img1.set('height', 2);
    img1.set('audit', { createdBy: 'alice', createdAt: 111 }); // plain 载体，期望 Y.Map
    assets.set('img1', img1);
    const issue = expectSingleIssue(extractYjsSnapshot(DERIVED, doc));
    expectIssueAt(issue, ['assets', 'img1', 'audit'], 'Y.Map', 'plain value');
  });
});

describe('extractYjsSnapshot — XML：Y.XmlFragment → XML 字符串，语义等价（AC2 xml / AC4 / AC6 XML）', () => {
  it('正确 Y.XmlFragment → ok；snapshot 值为 XML 字符串，归一化后语义等价（非逐字承诺）', () => {
    const { doc } = buildFullDoc();
    const snapshot = expectOkSnapshot(extractYjsSnapshot(DERIVED, doc));
    const body = (snapshot as { assets: { doc1: { body: unknown } } }).assets.doc1.body;
    expect(typeof body).toBe('string');
    // 语义等价锚：结构与文本内容保留（折叠标签间空白后比较），不承诺逐字 round-trip
    expect(normalizeXml(body as string)).toBe('<p>Hello <b>world</b></p>');
  });

  it('xml-fragment 位放置 plain XML 字符串（期望 Y.XmlFragment）→ 单 issue 锚 assets.doc1.body', () => {
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    const assets = new Y.Map();
    root.set('assets', assets);
    const doc1 = new Y.Map();
    doc1.set('kind', 'text');
    doc1.set('body', '<p>x</p>'); // plain 载体
    const audit = new Y.Map();
    audit.set('createdBy', 'bob');
    audit.set('createdAt', 222);
    doc1.set('audit', audit);
    assets.set('doc1', doc1);
    const issue = expectSingleIssue(extractYjsSnapshot(DERIVED, doc));
    expectIssueAt(issue, ['assets', 'doc1', 'body'], 'Y.XmlFragment', 'plain value');
  });
});

describe('extractYjsSnapshot — SCHEMA/META 不在本能力范围：只读取固定 ROOT（AC）', () => {
  it('SCHEMA/META 为任意垃圾载体 + ROOT 正确 → 仍 ok（不读取、不验证 SCHEMA/META）', () => {
    const derived = derivedOf('type ROOT = { title: string };');
    const doc = new Y.Doc();
    doc.getArray('SCHEMA').insert(0, [1, 2, 3]); // SCHEMA 应为信封，此处为 Y.Array 垃圾
    doc.getMap('META').set('docId', 42); // META 应为字符串 docId，此处为数字垃圾
    doc.getMap('ROOT').set('title', 'ok');
    const snapshot = expectOkSnapshot(extractYjsSnapshot(derived, doc));
    expect(snapshot).toEqual({ title: 'ok' });
  });

  it('全 optional ROOT + 空 doc（无 ROOT 条目）→ ok，snapshot {}（ROOT 缺失按空 map，不外抛）', () => {
    const derived = derivedOf('type ROOT = { notes?: YLeaf<string> };');
    const doc = new Y.Doc();
    const snapshot = expectOkSnapshot(extractYjsSnapshot(derived, doc));
    expect(snapshot).toEqual({});
  });
});
