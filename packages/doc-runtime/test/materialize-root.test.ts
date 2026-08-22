/**
 * SA6 红灯测试 — @nomicore/doc-runtime materializeRoot(derived, snapshot, doc)（issue #74，功能开发）。
 *
 * 契约来源：
 * - 任务简报 wiki/raw/task_doc-runtime-materialize-root.md（Issue #74，AC-1~AC-6）：
 *   `materializeRoot(derived, snapshot, doc)` 是唯一公共物化入口——内部先执行
 *   validateLogicalSnapshot，再构造未集成到任何 doc 的 detached Yjs 子树，确认目标 ROOT
 *   为空后以一次 Y.transact 安装；验证或构造失败时目标 doc 零写入；不覆盖、不合并、
 *   不 fallback。
 * - docs/adr/0007（逻辑验证与 Yjs Runtime Bridge 分层）：「逻辑校验保留完整 issues，
 *   Yjs 结构与路径/操作错误 fail-fast」；「零写入承诺覆盖所有验证失败和 detached 构造
 *   失败」；「事务开始后若未知 observer 抛错，视为 Runtime internal/fatal，不虚假声称
 *   自动回滚，也不尝试 fallback」；「XML string 与 Y.XmlFragment 只承诺语义等价
 *   round-trip，不承诺字符串逐字相同」。
 * - docs/adr/0003（派生 schema 结构树）：map→Y.Map、array→Y.Array、xml-fragment→
 *   Y.XmlFragment、plain（YPlainArray）→纯值；ROOT 固定物化为 Y.Map（doc.getMap('ROOT')）。
 * - docs/adr/0006（doc 三条目布局）：materializeRoot 只写 ROOT 子树，SCHEMA/META 是
 *   兄弟条目、不在本能力写入面内。
 *
 * 本文件是 SA3 实现的唯一行为锚点（SA1 设计不得收窄下列可观测契约，仅可补充）：
 * - 公共接缝：`materializeRoot(derived: DerivedSchema, snapshot: unknown, doc: Y.Doc)`
 *   经 `packages/doc-runtime/src/index.ts` 包公共入口导出（与 extractYjsSnapshot 同文件
 *   同款 `exports["."] = "./src/index.ts"`）；同步、错误经返回值传递。
 * - 结果联合（沿仓内 extractYjsSnapshot / validateLogicalSnapshot 的 `{ ok, issues }`
 *   惯例）：`{ ok: true } | { ok: false; issues: MaterializeIssue[] }`——
 *   AC-1 逻辑校验失败保留**完整** issues（全收集，与 validateLogicalSnapshot 直调结果
 *   完全一致）；物化失败（如目标 ROOT 非空）**恰 1 条** issue（materialization 侧
 *   fail-fast，ADR-0007「Yjs 结构与路径/操作错误 fail-fast」）。
 * - AC-2：目标 ROOT 非空 → 响亮失败（ok:false + 单 issue），不 overwrite、不 merge、
 *   不 fallback（失败后 doc 状态逐字节不变、零 update 事件）。ROOT 缺席/为空 → 成功。
 * - AC-3：物化子树载体严格按结构树：map→Y.Map、array→Y.Array、xml-fragment→
 *   Y.XmlFragment、plain→纯值深拷贝（与输入快照引用隔离，输入再突变不影响 doc）。
 * - AC-4：全部构造成功后单次 transaction 安装（成功路径恰 1 次 'update' 事件）；任何
 *   前置失败（逻辑校验失败 / ROOT 非空）→ 0 次 'update' 事件且 state 逐字节不变。
 * - AC-5：XML string 物化后经 extractYjsSnapshot 提取，提取值可再次通过
 *   validateLogicalSnapshot；与输入只承诺语义等价（归一化比较），不要求逐字相同。
 * - AC-6：事务期间未知 observer 抛错 → 错误 loud 传播（toThrow），绝不吞并成伪
 *   ok:true 或「已回滚」的失败结果；且不虚假回滚（写入已实际提交：update 已发出、
 *   ROOT 值已落盘——yjs 实证 observer 抛错不触发事务回滚，本测试不承诺回滚）。
 *
 * fixture 构建纪律（实证自 yjs@13.6.32，见 .mabf/scratch-yjs.mjs 验证）：
 * - `doc.getMap('ROOT')` 惰性创建空 map：零 update 事件、state 不变（AC-4 零写入
 *   断言的前提）；空/惰性 map 的 .size/.keys() 可安全读取（非 'Invalid access'）；
 * - detached 子树类型在集成到 doc 前不可读取内容（yjs 'Invalid access'），故 AC-3/AC-4
 *   只断言物化**后**的 doc 侧载体与内容（构造内部实现不预设）；
 * - `ymap.set(k, plainObj)` 以**引用**存储（实证 stored === input），plain 深拷贝契约
 *   因此必须用「物化后突变输入 → doc 不变」的行为断言锚定，而非仅类型检查；
 * - 事务内 observer 抛错：错误经 Y.transact 传播、update 事件仍发出、值不回滚。
 *
 * 红灯现状（构造性红灯，同 extract-yjs-snapshot.test.ts 先例）：`materializeRoot` 尚
 * 未实现/未从包入口导出，本文件静态具名 import 在 vitest 收集阶段即失败（"does not
 * provide an export named 'materializeRoot'"），全部用例红。SA3 实现并导出后转绿；
 * 本文件不预设实现内部结构（不读源码、不 grep 文本形状），全部断言锚定
 * materializeRoot 的可观测输出。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { evaluate, parseVfsl, validateLogicalSnapshot } from '@nomicore/vfsl';
import type { DerivedSchema } from '@nomicore/vfsl';
// 构造性红灯：materializeRoot 尚未实现/导出，本 import 在收集阶段即失败（全用例红）。
// SA3 在 packages/doc-runtime/src 实现并导出 materializeRoot 后转绿。
import { extractYjsSnapshot, materializeRoot } from '../src/index.js';

// —— 测试契约类型（任务简报 AC-1 + ADR-0007 冻结）——

/** 物化 issue：message 非空字符串；path 段数组（materialization 失败恰 1 条——fail-fast）。 */
interface MaterializeIssue {
  message: string;
  path: Array<string | number>;
}

type MaterializeResult =
  | { ok: true }
  | { ok: false; issues: MaterializeIssue[] };

// —— 测试辅助 ——

function derivedOf(text: string): DerivedSchema {
  const parsed = parseVfsl(text);
  if (!parsed.ok) throw new Error(`前置 parseVfsl 失败（fixture 缺陷）：${JSON.stringify(parsed.issues)}`);
  const evaluated = evaluate(parsed.module);
  if (!evaluated.ok) throw new Error(`前置 evaluate 失败（fixture 缺陷）：${JSON.stringify(evaluated.issues)}`);
  return evaluated.derived;
}

/** doc 当前状态快照（encodeStateAsUpdate 字节序列；零写入断言用逐字节比较）。 */
function stateBytes(doc: Y.Doc): number[] {
  return [...Y.encodeStateAsUpdate(doc)];
}

/** 'update' 事件计数器（AC-4 单事务/零写入锚）。 */
function countUpdates(doc: Y.Doc): { count: number } {
  const counter = { count: 0 };
  doc.on('update', () => {
    counter.count += 1;
  });
  return counter;
}

/** XML 语义等价归一化（AC-5：只承诺语义等价，不承诺逐字 round-trip）：折叠标签间空白。 */
function normalizeXml(xml: string): string {
  return xml.replace(/>\s+</g, '><').trim();
}

// —— 规格 §10 vfs3.assets 参考 fixture（与 extract 侧同文本；ADR-0001 测试 fixture
// 例外）：覆盖 map/array/xml-fragment/leaf/plain/union/ref/Record 全形态 ——

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

/** 全形态正确逻辑 ROOT（普通 JSON；XML body 为字符串，与 Y.XmlFragment.toJSON() 投影一致）。 */
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

describe('materializeRoot — AC-1：logical 失败保留完整 issues；materialization 失败返回单 issue', () => {
  it('逻辑校验失败 → ok:false，issues 与 validateLogicalSnapshot 直调结果完全一致（完整保留，非 fail-fast 单条）', () => {
    const derived = derivedOf('type ROOT = { a: string; b: number };');
    const bad = { a: 123, b: 'x', extra: 1 }; // 类型错 ×2 + 未知键 ×1
    const direct = validateLogicalSnapshot(derived, bad);
    expect(direct.ok).toBe(false);
    let directIssues: MaterializeIssue[] = [];
    if (!direct.ok) {
      // 块内收窄提取（TS 收窄不跨块），供块外对比断言使用
      directIssues = direct.issues;
      expect(direct.issues.length).toBeGreaterThanOrEqual(2); // 前置确认多违规
    }
    const doc = new Y.Doc();
    const result = materializeRoot(derived, bad, doc) as MaterializeResult;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // 「保留完整 issues」：与直调 validateLogicalSnapshot 的结果逐条一致（内容 + 顺序）
      expect(result.issues).toEqual(directIssues);
      expect(result.issues.length).toBeGreaterThanOrEqual(2);
      for (const issue of result.issues) {
        expect(typeof issue.message).toBe('string');
        expect(issue.message.length).toBeGreaterThan(0);
        expect(Array.isArray(issue.path)).toBe(true);
      }
    }
  });

  it('物化失败（目标 ROOT 非空）→ ok:false 且恰 1 条 issue（materialization 失败 fail-fast 单 issue）', () => {
    const derived = derivedOf('type ROOT = { title: string };');
    const doc = new Y.Doc();
    doc.getMap('ROOT').set('title', 'old');
    const result = materializeRoot(derived, { title: 'new' }, doc) as MaterializeResult;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toHaveLength(1);
      const issue = result.issues[0];
      expect(issue).toBeDefined();
      expect(typeof issue?.message).toBe('string');
      expect((issue?.message ?? '').length).toBeGreaterThan(0);
    }
  });
});

describe('materializeRoot — AC-2：目标 ROOT 非空响亮失败，不 overwrite、merge 或 fallback', () => {
  it('ROOT 已含数据 → 响亮失败：既有内容不 overwrite、快照新键不 merge、doc 无其他写入（不 fallback）', () => {
    const derived = derivedOf('type ROOT = { title: string; count: number };');
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    root.set('title', 'old');
    const before = stateBytes(doc);
    const events = countUpdates(doc);
    const result = materializeRoot(derived, { title: 'new', count: 7 }, doc) as MaterializeResult;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toHaveLength(1); // 响亮失败：单 issue
    }
    expect(events.count).toBe(0); // 前置检查失败即止：未发起任何事务
    expect(stateBytes(doc)).toEqual(before); // 不 overwrite / 不 merge / 不 fallback：状态逐字节不变
    expect(root.get('title')).toBe('old'); // overwrite 缺席
    expect(root.has('count')).toBe(false); // merge 缺席
  });

  it('ROOT 为异型载体（Y.Array，即使为空）→ 响亮失败单 issue，状态不变', () => {
    const derived = derivedOf('type ROOT = { title: string };');
    const doc = new Y.Doc();
    doc.getArray('ROOT'); // ROOT 已以 Y.Array 存在（空）
    const before = stateBytes(doc);
    const events = countUpdates(doc);
    const result = materializeRoot(derived, { title: 't' }, doc) as MaterializeResult;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toHaveLength(1);
    }
    expect(events.count).toBe(0);
    expect(stateBytes(doc)).toEqual(before);
  });

  it('正向对照：ROOT 缺席（空 doc）与 ROOT 为空 Y.Map → 物化成功（AC-2 非空边界成立的前提）', () => {
    const derived = derivedOf('type ROOT = { title: string };');
    // 缺席：全新 doc（getMap 惰性创建空 map）
    const doc1 = new Y.Doc();
    const r1 = materializeRoot(derived, { title: 'a' }, doc1) as MaterializeResult;
    expect(r1.ok).toBe(true);
    expect(doc1.getMap('ROOT').get('title')).toBe('a');
    // 已集成但为空的 ROOT map
    const doc2 = new Y.Doc();
    const r2 = doc2.getMap('ROOT');
    r2.set('x', 1);
    r2.delete('x');
    const result2 = materializeRoot(derived, { title: 'b' }, doc2) as MaterializeResult;
    expect(result2.ok).toBe(true);
    expect(doc2.getMap('ROOT').get('title')).toBe('b');
    expect(doc2.getMap('ROOT').has('x')).toBe(false);
  });
});

describe('materializeRoot — AC-3：detached 构造正确区分 Y.Map / Y.Array / Y.XmlFragment 与 plain deep clone', () => {
  it('全形态 fixture → 结构树各节点载体正确：map→Y.Map、array→Y.Array、xml-fragment→Y.XmlFragment、plain→纯值', () => {
    const doc = new Y.Doc();
    const result = materializeRoot(DERIVED, EXPECTED_SNAPSHOT, doc) as MaterializeResult;
    expect(result.ok).toBe(true);
    const root = doc.getMap('ROOT');
    // 键空间恰为快照声明字段（notes 缺席不落键、无构造垃圾键）
    expect(new Set(root.keys())).toEqual(new Set(Object.keys(EXPECTED_SNAPSHOT)));
    const assets = root.get('assets');
    expect(assets).toBeInstanceOf(Y.Map); // Record → Y.Map
    const img1 = (assets as Y.Map<unknown>).get('img1');
    expect(img1).toBeInstanceOf(Y.Map); // union 成员（image）→ Y.Map
    const audit = (img1 as Y.Map<unknown>).get('audit');
    expect(audit).toBeInstanceOf(Y.Map); // ref→Audit（map 别名）→ Y.Map
    const f1 = (assets as Y.Map<unknown>).get('f1');
    expect((f1 as Y.Map<unknown>).get('tags')).toBeInstanceOf(Y.Array); // YArray<YLeaf> → Y.Array
    const doc1 = (assets as Y.Map<unknown>).get('doc1');
    expect((doc1 as Y.Map<unknown>).get('body')).toBeInstanceOf(Y.XmlFragment); // xml-fragment → Y.XmlFragment
    const attachments = root.get('attachments');
    expect(Array.isArray(attachments)).toBe(true); // YPlainArray → plain 纯值数组
    expect(attachments).not.toBeInstanceOf(Y.AbstractType); // 严禁物化成 Yjs 类型
    expect(root.get('keywords')).toBeInstanceOf(Y.Array); // YLeaf<string>[] → Y.Array
  });

  it('plain deep clone：物化后突变输入快照对象，doc 内容不受影响（引用不共享）', () => {
    const doc = new Y.Doc();
    const input = JSON.parse(JSON.stringify(EXPECTED_SNAPSHOT)) as typeof EXPECTED_SNAPSHOT;
    const result = materializeRoot(DERIVED, input, doc) as MaterializeResult;
    expect(result.ok).toBe(true);
    const root = doc.getMap('ROOT');
    const storedAttachments = root.get('attachments');
    expect(storedAttachments).not.toBe(input.attachments); // 深拷贝：实例不同（yjs set 实证按引用存储，故必须拷贝）
    // 物化后突变输入（plain 数组 / 嵌套 map 内 plain 值 / 顶层 plain 值）
    input.attachments.push('MUTATED');
    input.assets.img1.audit.createdBy = 'MUTATED';
    input.audit.createdAt = 0;
    // doc 内容不受影响
    expect(JSON.stringify(root.get('attachments'))).toBe(JSON.stringify(['x', 'y']));
    const img1 = (root.get('assets') as Y.Map<unknown>).get('img1') as Y.Map<unknown>;
    // 突变隔离断言：doc 侧嵌套 audit 是 Y.Map 实例（AC-3 载体断言），非 plain object——
    // vitest toEqual 对 Y.Map vs plain object 比较 own 可枚举键（含 Y.Map 内部字段）永不相等，
    // 故把条目投影为 plain object 后与原对象整体比较（与「突变输入快照 doc 不受影响」意图等价）。
    expect(Object.fromEntries((img1.get('audit') as Y.Map<unknown>).entries())).toEqual({ createdBy: 'alice', createdAt: 111 });
    expect((root.get('audit') as Y.Map<unknown>).get('createdAt')).toBe(999);
  });
});

describe('materializeRoot — AC-4：全部构造成功后才执行单次 transaction；前置失败时 Y.Doc state/update 不变', () => {
  it('成功物化 → 恰 1 次 update 事件（单次 Y.transact 安装，非逐节点多事务）', () => {
    const doc = new Y.Doc();
    const events = countUpdates(doc);
    const result = materializeRoot(DERIVED, EXPECTED_SNAPSHOT, doc) as MaterializeResult;
    expect(result.ok).toBe(true);
    expect(events.count).toBe(1);
    // 安装完成性抽查（与 AC-3 载体断言互补）
    const root = doc.getMap('ROOT');
    expect(root.get('assets')).toBeInstanceOf(Y.Map);
    expect(root.get('attachments')).toEqual(['x', 'y']);
    expect(root.get('keywords')).toBeInstanceOf(Y.Array);
  });

  it('逻辑校验失败（前置失败）→ 0 update 事件且 state 逐字节不变（零写入）', () => {
    const derived = derivedOf('type ROOT = { title: string };');
    const doc = new Y.Doc();
    const before = stateBytes(doc);
    const events = countUpdates(doc);
    const result = materializeRoot(derived, { title: 42 }, doc) as MaterializeResult;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.length).toBeGreaterThanOrEqual(1);
    }
    expect(events.count).toBe(0);
    expect(stateBytes(doc)).toEqual(before);
  });

  it('ROOT 非空（物化前置检查失败）→ 0 update 事件且 state 不变', () => {
    const derived = derivedOf('type ROOT = { title: string };');
    const doc = new Y.Doc();
    doc.getMap('ROOT').set('title', 'old');
    const before = stateBytes(doc);
    const events = countUpdates(doc);
    const result = materializeRoot(derived, { title: 'new' }, doc) as MaterializeResult;
    expect(result.ok).toBe(false);
    expect(events.count).toBe(0);
    expect(stateBytes(doc)).toEqual(before);
  });

  it('只写 ROOT：SCHEMA/META 兄弟条目物化前后保持不变（ADR-0006 三条目布局写入边界）', () => {
    const derived = derivedOf('type ROOT = { title: string };');
    const doc = new Y.Doc();
    doc.getMap('SCHEMA').set('lang', 'vfsl'); // 信封垃圾（非本能力面，仅验证不受触碰）
    doc.getMap('META').set('docId', 'm-1');
    const schemaBefore = JSON.stringify([...doc.getMap('SCHEMA').entries()]);
    const metaBefore = JSON.stringify([...doc.getMap('META').entries()]);
    const result = materializeRoot(derived, { title: 't' }, doc) as MaterializeResult;
    expect(result.ok).toBe(true);
    expect(JSON.stringify([...doc.getMap('SCHEMA').entries()])).toBe(schemaBefore);
    expect(JSON.stringify([...doc.getMap('META').entries()])).toBe(metaBefore);
  });
});

describe('materializeRoot — AC-5：XML string 物化后提取可再次通过逻辑校验，不要求字符串逐字相同', () => {
  it('XML 物化 → extractYjsSnapshot 提取 → 归一化语义等价且 validateLogicalSnapshot 再次通过（ok:true）', () => {
    const doc = new Y.Doc();
    const result = materializeRoot(DERIVED, EXPECTED_SNAPSHOT, doc) as MaterializeResult;
    expect(result.ok).toBe(true);
    const ex = extractYjsSnapshot(DERIVED, doc);
    expect(ex.ok).toBe(true);
    if (!ex.ok) {
      throw new Error(`期望提取成功，实际失败：${JSON.stringify(ex.issues)}`);
    }
    const extracted = ex.snapshot as { assets: { doc1: { body: unknown } } };
    const body = extracted.assets.doc1.body;
    expect(typeof body).toBe('string'); // XML 值物化为 Y.XmlFragment，提取回 XML 字符串
    // 语义等价（折叠标签间空白后比较），不承诺字符串逐字相同（ADR-0007）
    expect(normalizeXml(body as string)).toBe('<p>Hello <b>world</b></p>');
    // AC-5 主锚：提取出的普通 logical ROOT 再次通过完整逻辑校验
    const revalidate = validateLogicalSnapshot(DERIVED, extracted);
    expect(revalidate.ok).toBe(true);
  });
});

describe('materializeRoot — AC-6：observer 抛错边界按 ADR 0007 处理，不虚假承诺事务回滚', () => {
  it('ROOT observer 抛错 → 错误 loud 传播（toThrow），不吞并成伪 ok/伪回滚结果；写入已提交（不虚假回滚）', () => {
    const derived = derivedOf('type ROOT = { title: string };');
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    root.observe(() => {
      throw new Error('observer-boom');
    });
    const events = countUpdates(doc);
    // ADR-0007 失败边界：事务开始后未知 observer 抛错 → Runtime internal/fatal——
    // 不得捕获吞并成 {ok:true} 或「已回滚」的失败结果；错误必须 loud 传播
    expect(() => materializeRoot(derived, { title: 't' }, doc)).toThrow();
    // yjs 实证语义：observer 抛错不触发事务回滚——写入已实际提交（update 已发出、值已落盘）。
    // 本断言锚定「不虚假承诺事务回滚」：若实现伪造回滚（删除已写内容/多事务清理），此处变红。
    expect(events.count).toBe(1);
    expect(root.get('title')).toBe('t');
  });
});
