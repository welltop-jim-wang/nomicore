/**
 * SA6 红灯测试 — @nomicore/doc-runtime readLogicalValueAtPath(doc, path) schema-independent
 * 载体投影读取（issue #86 / ADR-0008，功能开发）。
 *
 * 契约来源：
 * - 任务简报 wiki/raw/task_doc-runtime-root-carrier-projection-read.md（Issue #86）7 条验收标准
 *   （AC1–AC7，本文件覆盖 AC1–AC6 的可观测行为面；AC7 调用面调整 + 全量 typecheck/test 为
 *   SA3 实现期的完成判据，类型层锚点在 read-logical-value-at-path-schema-independent.test-d.ts）；
 * - docs/adr/0008（直接治理 ADR）「读取能力」节 + 「必要的底层演进」第 1 条（相关决议文档
 *   wiki/raw/task_doc-runtime-root-carrier-projection-read_relevant_decisions.md 原文摘录）：
 *   签名去掉 derived；Y.Map 用 string segment、Y.Array 用严格非负整数 segment，plain
 *   object/array 同理；map/object 缺键或数组越界均成功返回 undefined，中间缺失立即结束；
 *   plain object 仅读 own enumerable string data property，不走原型链、不执行 accessor；
 *   plain subtree 仅允许 JSON-compatible plain value，禁止嵌套 Yjs shared type；
 *   Y.XmlFragment 是不可下钻终态，返回语义字符串；未知 Yjs shared type 响亮失败，不使用
 *   toJSON() fallback；空 path 深拷贝完整 ROOT；非空 path 只转换目标子树；返回值是可变
 *   普通深拷贝，不做运行时冻结；预期路径、载体和 lifecycle 失败使用同步结果联合，只有
 *   internal bug 才抛异常；
 * - docs/adr/0007 仍生效条款：路径统一为 readonly (string | number)[]（map/object/Record 用
 *   string，Y.Array 用 number；禁点号字符串与 JSON Pointer）；leaf、plain、XML 是不可下钻
 *   终态；XML string 与 Y.XmlFragment 只承诺语义等价 round-trip；底层能力各自保留领域化
 *   结果联合。
 *
 * 本文件是 SA3 实现的唯一行为锚点（SA1 设计不得收窄下列可观测契约，仅可补充）：
 * - 公共接缝：`readLogicalValueAtPath(doc: Y.Doc, path: readonly (string | number)[])`
 *   经 packages/doc-runtime/src/index.ts 包公共入口导出；同步、不抛错（错误经返回值传递，
 *   与 extractYjsSnapshot / vfsl 公共接缝纪律同源）；
 * - 结果联合（SA6 冻结形态——issue #75 注记 B 的延续，签名改造不改变错误通道）：
 *     { ok: true; value: unknown }                       （成功：目标子树普通值深拷贝）
 *     { ok: false; code: 'PATH_NOT_ALLOWED'; path: readonly (string | number)[]; message?: string }
 *   （预期 path/载体失败；fail-fast 单错，path 回显整条尝试路径——与 ExtractIssue.path
 *    精确锚定先例一致；不并入 issues 数组体系；message 为诊断增补，非契约字段，
 *    应用逻辑不得依赖——沿 issue #75 R4 纪律）；
 * - schema-independent 的可观测面：读取只依据 live Y.Doc 的实际载体（Y.Map / Y.Array /
 *   Y.XmlFragment / plain value）与路径段纪律，不依赖任何 VFSL/派生 schema——无 schema
 *   文档可读；任意 string 键（含空格/点号段）可导航；「schema 未知字段」不再是
 *   PATH_NOT_ALLOWED，而是「容器缺键 → ok:true, value:undefined」或「值域违规 → 失败」；
 * - AC3 锚点：plain object 的 own enumerable **data** property 才参与投影；accessor
 *   不执行（可观测副作用为零）且不产出；原型链属性不参与；non-enumerable 不参与；
 * - AC4 锚点：plain 子树的 JSON-compatible 纪律——嵌套 Yjs shared type / bigint /
 *   non-finite number / 数组内 undefined → 响亮失败（ok:false），绝不静默丢弃或转换；
 * - AC5 锚点：Y.XmlFragment（含 Y.XmlElement 子类）目标 → 语义字符串，不可下钻；
 *   Y.Text / Y.XmlText 等不在导航 vocabulary 的 Yjs shared type → 响亮失败（无 toJSON
 *   fallback——ok:false，而非字符串投影）；
 * - AC6 锚点：返回值为可变普通深拷贝——无 live 引用、不做运行时 freeze、突变不影响
 *   live doc（重读原值实证）。
 *
 * 红灯现状（构造性红灯：签名改造未实施）：当前实现为 issue #75 冻结的 schema-aware
 * 三参签名 readLogicalValueAtPath(derived, doc, path)。本文件全部以新双参签名调用——
 * 运行时 derived 参数位置收到 Y.Doc → `derived.structure` 取空 → 顶层崩溃边界返回
 * { ok:false, code:'PATH_NOT_ALLOWED', path:[], message:'DOCRT-E100…' }：
 * - 一切期望 ok:true 的用例红（实际 ok:false）；
 * - 一切期望失败 + 非空 path 回显的用例红（实际 path 为 []）；
 * - tsc / vitest typecheck 对双参调用报 TS2554（期望 3 参数，实得 2）。
 * SA3 实现 readLogicalValueAtPath(doc, path) 并转绿；本文件不预设实现内部结构
 * （不读源码、不 grep 文本形状），全部断言锚定公共接缝的可观测输出。
 *
 * fixture 构建纪律（yjs@13.6 实证，探针见 .scratch/ 与 packages/doc-runtime 探针脚本）：
 * - plain 数组/对象以引用原样存入 Y.Map：set/get 不触发 accessor、不深拷贝、
 *   prototype 保留、identity 保留（live doc 内存视图）；
 * - bigint（plain object 值）、NaN/Infinity、undefined（plain 数组元素）、function、
 *   Date、嵌套 Yjs shared type（Y.Map/Y.Array/Y.Text/Y.XmlText/Y.XmlElement 作为 plain
 *   对象值或 plain 数组元素）均可经公共 API 置入 Y.Map（yjs 仅检查顶层内容类型）；
 * - Y.XmlText instanceof Y.Text；Y.XmlElement instanceof Y.XmlFragment；
 * - 同一直读场景不经过 encode/apply（读取契约 = 观察调用瞬间的 live Y.Doc 内存视图）。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
// 构造性红灯：index.ts 当前导出的是三参 schema-aware 签名；本文件以双参调用——
// 运行时全部走崩溃边界（ok:false, path:[]），全部用例红；tsc 报 TS2554。
import { readLogicalValueAtPath } from '../src/index.js';

// —— 测试契约类型（SA6 冻结形态，SA1 不得收窄；相应 ADR-0008 同步结果联合）——

/**
 * readLogicalValueAtPath(doc, path) 结果联合（冻结形态）：
 * - ok:true 恒携带 value（成功 = 目标子树普通值深拷贝；合法缺键 = value 显式存在且为 undefined）；
 * - ok:false 恒携带 code:'PATH_NOT_ALLOWED'（预期 path/载体失败统一错误通道）与
 *   path（整条尝试路径回显，fail-fast 单错）；message 为诊断增补（非契约字段）。
 */
type ReadLogicalValueResult =
  | { ok: true; value: unknown }
  | { ok: false; code: 'PATH_NOT_ALLOWED'; path: readonly (string | number)[]; message?: string };

// —— 测试辅助 ——

/** 成功读取：断言 ok:true 并返回 value（AC 成功形态）。 */
function expectOkValue(result: ReadLogicalValueResult): unknown {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`期望 ok:true，实际 code=${result.code}（path: ${JSON.stringify(result.path)}）`);
  }
  return result.value;
}

/** 合法缺键形态：ok:true 且 value 键显式存在、值为 undefined（禁省略 value 键）。 */
function expectUndefinedValue(result: ReadLogicalValueResult): void {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`期望 ok:true（合法缺键），实际 code=${result.code}`);
  }
  expect(Object.prototype.hasOwnProperty.call(result, 'value')).toBe(true);
  expect(result.value).toBeUndefined();
}

/**
 * AC2/AC5/AC6 失败形态：ok:false + code:'PATH_NOT_ALLOWED' + path 回显整条尝试路径
 * （fail-fast；与 issue #75 冻结的注记 B 形态一致，路径/载体失败共用同步结果联合）。
 */
function expectNotAllowed(result: ReadLogicalValueResult, attemptedPath: readonly (string | number)[]): void {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error(`期望 PATH_NOT_ALLOWED，实际 ok:true（value=${JSON.stringify(result.value)}）`);
  }
  expect(result.code).toBe('PATH_NOT_ALLOWED');
  expect(result.path).toEqual(attemptedPath); // 锚定整条尝试路径（与 ExtractIssue.path 先例一致）
}

/** 普通值深拷贝断言：递归无 Yjs 类型泄漏（ADR「返回值不含 live 引用」）。 */
function expectNoYjsLeak(v: unknown): void {
  if (
    v instanceof Y.Map || v instanceof Y.Array
    || v instanceof Y.XmlFragment || v instanceof Y.Text || v instanceof Y.AbstractType
  ) {
    throw new Error('返回值泄漏 Yjs 类型（live 引用混入）');
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

/** JSON 域纯副本断言：JSON 往返无损（无 bigint/undefined/NaN/函数等非 JSON 值混入）。 */
function expectJsonRoundTrip(v: unknown): void {
  expect(JSON.parse(JSON.stringify(v))).toEqual(v);
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

// —— 规格 fixture ——
// schema-independent：fixture 不依赖任何 VFSL 文本/派生 schema；内容即为「live Y.Doc 实际载体」。

interface Fixture {
  doc: Y.Doc;
  /** accessor 触发计数器（AC3 锚点：读取必须零触发）。 */
  counters: { secretReads: number; protoReads: number };
}

/** 干净 ROOT：全部 JSON-compatible 载体（Y.Map / plain object / Y.Array / plain array / 标量 / XmlFragment 家族）。 */
function buildDoc(): Fixture {
  const doc = new Y.Doc();
  const root = doc.getMap('ROOT');
  const counters = { secretReads: 0, protoReads: 0 };

  // 标量
  root.set('title', 'Hello');
  root.set('count', 42);
  root.set('flag', true);
  root.set('nothing', null);

  // plain object 子树（内含嵌套 plain object 与 plain array）
  root.set('meta', { createdBy: 'jim', tags: ['a', 'b'], nested: { deep: 'value' } });

  // Y.Array
  const items = new Y.Array();
  items.insert(0, ['k1', 'k2']);
  root.set('items', items);

  // Y.Map 子树（内含嵌套 Y.Array）
  const cfg = new Y.Map();
  cfg.set('mode', 'fast');
  cfg.set('limit', 10);
  const extra = new Y.Array();
  extra.insert(0, [1, 2]);
  cfg.set('extra', extra);
  root.set('cfg', cfg);

  // Y.XmlFragment（终态）
  const xmlBody = new Y.XmlFragment();
  const p = new Y.XmlElement('p');
  p.insert(0, [new Y.XmlText('Hello ')]);
  const b = new Y.XmlElement('b');
  b.insert(0, [new Y.XmlText('world')]);
  p.insert(1, [b]);
  xmlBody.insert(0, [p]);
  root.set('xmlBody', xmlBody);

  // Y.XmlElement（Y.XmlFragment 子类，同属终态家族）
  const xmlEl = new Y.XmlElement('p');
  xmlEl.insert(0, [new Y.XmlText('hi')]);
  root.set('xmlEl', xmlEl);

  // plain array
  root.set('arr', [1, 'two', true, null, { n: 'obj' }]);

  // plain object：own enumerable data + own enumerable accessor（secret）
  const acc: Record<string, unknown> = { own: 'x' };
  Object.defineProperty(acc, 'secret', {
    enumerable: true,
    configurable: true,
    get() { counters.secretReads++; return 's'; },
  });
  root.set('acc', acc);

  // plain object：原型链（继承 data + 继承 accessor）
  const proto = Object.create({ inherited: 'from-proto' });
  Object.defineProperty(proto, 'inheritedGetter', {
    enumerable: true,
    configurable: true,
    get() { counters.protoReads++; return 'pg'; },
  });
  const protoObj = Object.create(proto);
  protoObj.own = 'v';
  root.set('protoObj', protoObj);

  // plain object：own 非 enumerable data property
  const nonEnum: Record<string, unknown> = { visible: 'v' };
  Object.defineProperty(nonEnum, 'hidden', {
    value: 'h', writable: true, enumerable: false, configurable: true,
  });
  root.set('nonEnum', nonEnum);

  // plain object：空对象
  root.set('empty', {});

  // schema-independent 的可观测面：任意 string 段（空格 + 点号在段内，非点号字符串路径）
  root.set('sp ace.key', 'dotty');

  return { doc, counters };
}

/** 期望 logical ROOT（普通 JSON；XML 为语义等价投影；accessor/prototype/非 enumerable 均不产出）。 */
const EXPECTED_ROOT = {
  title: 'Hello',
  count: 42,
  flag: true,
  nothing: null,
  meta: { createdBy: 'jim', tags: ['a', 'b'], nested: { deep: 'value' } },
  items: ['k1', 'k2'],
  cfg: { mode: 'fast', limit: 10, extra: [1, 2] },
  xmlBody: '<p>Hello <b>world</b></p>',
  xmlEl: '<p>hi</p>',
  arr: [1, 'two', true, null, { n: 'obj' }],
  acc: { own: 'x' },
  protoObj: { own: 'v' },
  nonEnum: { visible: 'v' },
  empty: {},
  'sp ace.key': 'dotty',
};

/** 损坏子树（AC4/AC5 红用）：plain 容器内嵌 Yjs / 非 JSON-compatible 值 / 未知 shared type。 */
function addBadValues(fx: Fixture): void {
  const root = fx.doc.getMap('ROOT');
  root.set('badNested', { ok: 1, ys: new Y.Map() }); // plain object 内嵌 Y.Map
  root.set('badNestedArray', [{ ys: new Y.Array() }]); // plain array 元素内嵌 Y.Array
  root.set('badText', { t: new Y.Text('x') }); // plain object 内嵌 Y.Text
  root.set('big', { v: 1n }); // bigint（非 JSON-compatible）
  root.set('nan', NaN); // non-finite number（非 JSON-compatible）
  root.set('arrU', [1, undefined]); // plain 数组内 undefined（非 JSON-compatible）
  root.set('textVal', new Y.Text('hi')); // 未知 shared type（导航 vocabulary 之外，Y.Text）
  root.set('xmlTextVal', new Y.XmlText('hi')); // 未知 shared type（Y.XmlText extends Y.Text）
}

// —— AC1：签名去掉 derived；空 path 深拷贝完整 ROOT；非空 path 只转换目标子树 ——

describe('AC1 — readLogicalValueAtPath(doc, path)：schema-independent 双参签名', () => {
  it('[]（空 path）→ ok:true，value 为完整 ROOT 普通值深拷贝（JSON 往返无损、无 Yjs 泄漏、非 live 引用）', () => {
    const fx = buildDoc();
    const value = expectOkValue(readLogicalValueAtPath(fx.doc, []));
    expect(normalizeXmlDeep(value)).toEqual(EXPECTED_ROOT);
    expectJsonRoundTrip(value);
    expectNoYjsLeak(value);
    // 深拷贝：与 live 值不同一引用（顶层与嵌套）
    expect(value).not.toBe(fx.doc.getMap('ROOT'));
    const liveMeta = fx.doc.getMap('ROOT').get('meta') as Record<string, unknown>;
    expect((value as Record<string, unknown>)['meta']).not.toBe(liveMeta);
    // 全 ROOT 投影对 accessor 零触发（AC3 纪律在空 path 下同样成立）
    expect(fx.counters.secretReads).toBe(0);
    expect(fx.counters.protoReads).toBe(0);
  });

  it('非空 path 只转换目标子树：["meta"] → 仅 meta 的普通副本（不含 ROOT 其他键）', () => {
    const fx = buildDoc();
    const value = expectOkValue(readLogicalValueAtPath(fx.doc, ['meta'])) as Record<string, unknown>;
    expect(normalizeXmlDeep(value)).toEqual(EXPECTED_ROOT.meta);
    expect(Object.keys(value)).toEqual(['createdBy', 'tags', 'nested']); // 不含 ROOT 其他键
    expectNoYjsLeak(value);
  });

  it('深层子树：["meta","nested","deep"] → "value"（plain object 链）', () => {
    const fx = buildDoc();
    expect(expectOkValue(readLogicalValueAtPath(fx.doc, ['meta', 'nested', 'deep']))).toBe('value');
  });

  it('schema-independent：无任何派生 schema 的文档、任意 string 段（含空格/点号）可导航读取', () => {
    const fx = buildDoc();
    expect(expectOkValue(readLogicalValueAtPath(fx.doc, ['sp ace.key']))).toBe('dotty');
    expect(expectOkValue(readLogicalValueAtPath(fx.doc, ['title']))).toBe('Hello');
  });

  it('边界：全新空 doc（ROOT 未建）→ [] 读取 { }', () => {
    const doc = new Y.Doc();
    const value = expectOkValue(readLogicalValueAtPath(doc, []));
    expect(value).toEqual({});
    expectNoYjsLeak(value);
  });
});

// —— AC2：Y.Map/plain object 用 string segment；Y.Array/plain array 用严格非负整数 segment；合法缺键 → undefined ——

describe('AC2 — 载体 segment 纪律 + 合法缺失 → { ok:true, value:undefined }', () => {
  it('Y.Map string segment：["cfg","limit"] → 10；plain object string segment：["meta","createdBy"] → "jim"', () => {
    const fx = buildDoc();
    expect(expectOkValue(readLogicalValueAtPath(fx.doc, ['cfg', 'limit']))).toBe(10);
    expect(expectOkValue(readLogicalValueAtPath(fx.doc, ['meta', 'createdBy']))).toBe('jim');
  });

  it('Y.Array 非负整数 segment：["items",0] → "k1"；plain array 非负整数 segment：["arr",1] → "two"', () => {
    const fx = buildDoc();
    expect(expectOkValue(readLogicalValueAtPath(fx.doc, ['items', 0]))).toBe('k1');
    expect(expectOkValue(readLogicalValueAtPath(fx.doc, ['arr', 1]))).toBe('two');
    expect(expectOkValue(readLogicalValueAtPath(fx.doc, ['arr', 4]))).toEqual({ n: 'obj' });
  });

  it('map/object 缺键 → ok:true value:undefined（Y.Map 顶层缺键；plain object 缺键；中间缺失立即结束）', () => {
    const fx = buildDoc();
    expectUndefinedValue(readLogicalValueAtPath(fx.doc, ['nope']));
    expectUndefinedValue(readLogicalValueAtPath(fx.doc, ['meta', 'missing']));
    // 中间缺失立即结束：缺失的中间容器后续段不再下钻，同样成功 undefined
    expectUndefinedValue(readLogicalValueAtPath(fx.doc, ['meta', 'missing', 'deep']));
    expectUndefinedValue(readLogicalValueAtPath(fx.doc, ['absentTop', 'x', 'y']));
  });

  it('数组越界 → ok:true value:undefined（Y.Array 越界；plain array 越界；中间越界立即结束）', () => {
    const fx = buildDoc();
    expectUndefinedValue(readLogicalValueAtPath(fx.doc, ['items', 99]));
    expectUndefinedValue(readLogicalValueAtPath(fx.doc, ['arr', 99]));
    expectUndefinedValue(readLogicalValueAtPath(fx.doc, ['arr', 99, 'x']));
  });

  it('非法 segment（段型与载体不符）：number 段上 Y.Map / plain object、string 段上 Y.Array / plain array → PATH_NOT_ALLOWED', () => {
    const fx = buildDoc();
    expectNotAllowed(readLogicalValueAtPath(fx.doc, ['cfg', 0]), ['cfg', 0]); // number 段上 Y.Map
    expectNotAllowed(readLogicalValueAtPath(fx.doc, ['meta', 0]), ['meta', 0]); // number 段上 plain object
    expectNotAllowed(readLogicalValueAtPath(fx.doc, ['items', '0']), ['items', '0']); // string 段上 Y.Array
    expectNotAllowed(readLogicalValueAtPath(fx.doc, ['arr', '0']), ['arr', '0']); // string 段上 plain array
  });

  it('Y.Array / plain array 下标：负数、非整数 → PATH_NOT_ALLOWED（严格非负整数 segment）', () => {
    const fx = buildDoc();
    expectNotAllowed(readLogicalValueAtPath(fx.doc, ['items', -1]), ['items', -1]);
    expectNotAllowed(readLogicalValueAtPath(fx.doc, ['items', 1.5]), ['items', 1.5]);
    expectNotAllowed(readLogicalValueAtPath(fx.doc, ['arr', -1]), ['arr', -1]);
    expectNotAllowed(readLogicalValueAtPath(fx.doc, ['arr', 2.5]), ['arr', 2.5]);
  });

  it('标量不可作为容器：["title",0] / ["title","x"] → PATH_NOT_ALLOWED（plain 标量非容器）', () => {
    const fx = buildDoc();
    expectNotAllowed(readLogicalValueAtPath(fx.doc, ['title', 0]), ['title', 0]);
    expectNotAllowed(readLogicalValueAtPath(fx.doc, ['title', 'x']), ['title', 'x']);
  });
});

// —— AC3：plain object 仅读 own enumerable data property；不走原型链、不执行 accessor ——

describe('AC3 — plain object 投影纪律（own enumerable data property only）', () => {
  it('own enumerable accessor：不执行（副作用计数器零触发）且不产出该键', () => {
    const fx = buildDoc();
    const value = expectOkValue(readLogicalValueAtPath(fx.doc, ['acc'])) as Record<string, unknown>;
    expect(value).toEqual({ own: 'x' }); // secret 键不产出
    expect(Object.keys(value)).toEqual(['own']);
    expect(fx.counters.secretReads).toBe(0); // accessor 未被执行
  });

  it('不走原型链：继承 data property 与继承 accessor 均不参与投影（且不触发）', () => {
    const fx = buildDoc();
    const value = expectOkValue(readLogicalValueAtPath(fx.doc, ['protoObj'])) as Record<string, unknown>;
    expect(value).toEqual({ own: 'v' }); // inherited 与 inheritedGetter 均不产出
    expect(Object.keys(value)).toEqual(['own']);
    expect(fx.counters.protoReads).toBe(0); // 原型链 accessor 未被触发
  });

  it('own 非 enumerable data property 不参与投影', () => {
    const fx = buildDoc();
    const value = expectOkValue(readLogicalValueAtPath(fx.doc, ['nonEnum'])) as Record<string, unknown>;
    expect(value).toEqual({ visible: 'v' });
    expect('hidden' in value).toBe(false);
  });

  it('empty plain object → {}', () => {
    const fx = buildDoc();
    const value = expectOkValue(readLogicalValueAtPath(fx.doc, ['empty'])) as Record<string, unknown>;
    expect(value).toEqual({});
  });

  it('先证明 live 值 accessor 可触发（fixture 自证），随后读取必须零触发且不产出该键', () => {
    const fx = buildDoc();
    // fixture 自证：live 值直接访问 accessor 确实触发——证明计数器机制有效、
    // 构造在 live doc 内存视图中（而非已 JSON 化的副本）
    const live = fx.doc.getMap('ROOT').get('acc') as { secret: string };
    expect(live.secret).toBe('s');
    expect(fx.counters.secretReads).toBe(1);
    // 契约：读取投影必须零触发（自证之后的读取不得再触发）
    const value = expectOkValue(readLogicalValueAtPath(fx.doc, ['acc'])) as Record<string, unknown>;
    expect(value).toEqual({ own: 'x' });
    expect(fx.counters.secretReads).toBe(1);
  });
});

// —— AC4：plain subtree 只接受 JSON-compatible plain value，嵌套 Yjs shared type 响亮失败 ——

describe('AC4 — plain 子树 JSON-compatible 纪律（违规 → 同步结果联合失败，绝不静默转换）', () => {
  it('plain object 内嵌 Y.Map：["badNested"] → PATH_NOT_ALLOWED（响亮失败，非转换/丢弃）', () => {
    const fx = buildDoc();
    addBadValues(fx);
    const r = readLogicalValueAtPath(fx.doc, ['badNested']);
    expectNotAllowed(r, ['badNested']);
  });

  it('plain array 元素内嵌 Y.Array：["badNestedArray"] → PATH_NOT_ALLOWED', () => {
    const fx = buildDoc();
    addBadValues(fx);
    expectNotAllowed(readLogicalValueAtPath(fx.doc, ['badNestedArray']), ['badNestedArray']);
  });

  it('plain object 内嵌 Y.Text：["badText"] → PATH_NOT_ALLOWED', () => {
    const fx = buildDoc();
    addBadValues(fx);
    expectNotAllowed(readLogicalValueAtPath(fx.doc, ['badText']), ['badText']);
  });

  it('bigint（plain object 值）：["big"] → PATH_NOT_ALLOWED（非 JSON-compatible）', () => {
    const fx = buildDoc();
    addBadValues(fx);
    expectNotAllowed(readLogicalValueAtPath(fx.doc, ['big']), ['big']);
  });

  it('non-finite number：["nan"] → PATH_NOT_ALLOWED（JSON 数域之外，禁静默 null 化）', () => {
    const fx = buildDoc();
    addBadValues(fx);
    expectNotAllowed(readLogicalValueAtPath(fx.doc, ['nan']), ['nan']);
  });

  it('plain 数组内 undefined：["arrU"] → PATH_NOT_ALLOWED（禁静默 null 化）', () => {
    const fx = buildDoc();
    addBadValues(fx);
    expectNotAllowed(readLogicalValueAtPath(fx.doc, ['arrU']), ['arrU']);
  });
});

// —— AC5：Y.XmlFragment 是返回语义字符串的不可下钻终态；未知 Yjs shared type 不使用通用 fallback ——

describe('AC5 — XmlFragment 终态 + 未知 shared type 无 toJSON fallback', () => {
  it('["xmlBody"] → XML 语义字符串（不锁逐字）', () => {
    const fx = buildDoc();
    const value = expectOkValue(readLogicalValueAtPath(fx.doc, ['xmlBody']));
    expect(typeof value).toBe('string');
    expect(normalizeXml(value as string)).toBe('<p>Hello <b>world</b></p>');
  });

  it('Y.XmlElement（Y.XmlFragment 子类）目标 → 语义字符串', () => {
    const fx = buildDoc();
    const value = expectOkValue(readLogicalValueAtPath(fx.doc, ['xmlEl']));
    expect(typeof value).toBe('string');
    expect(normalizeXml(value as string)).toBe('<p>hi</p>');
  });

  it('XmlFragment 不可下钻：["xmlBody","child"] → PATH_NOT_ALLOWED', () => {
    const fx = buildDoc();
    expectNotAllowed(readLogicalValueAtPath(fx.doc, ['xmlBody', 'child']), ['xmlBody', 'child']);
  });

  it('未知 shared type（Y.Text）：["textVal"] → PATH_NOT_ALLOWED——不使用 toJSON()/toString() 通用 fallback', () => {
    const fx = buildDoc();
    addBadValues(fx);
    const r = readLogicalValueAtPath(fx.doc, ['textVal']);
    expectNotAllowed(r, ['textVal']); // ok:false——若实现以 toJSON fallback 返回 "hi" 则本用例红
    expect(r).not.toHaveProperty('value');
  });

  it('未知 shared type（Y.XmlText extends Y.Text）：["xmlTextVal"] → PATH_NOT_ALLOWED', () => {
    const fx = buildDoc();
    addBadValues(fx);
    expectNotAllowed(readLogicalValueAtPath(fx.doc, ['xmlTextVal']), ['xmlTextVal']);
  });

  it('ROOT 载体异型（Y.Array / Y.Text）：读取 → 同步结果联合失败（非抛异常）', () => {
    const arrDoc = new Y.Doc();
    arrDoc.getArray('ROOT').insert(0, ['x']);
    const r1 = readLogicalValueAtPath(arrDoc, ['a']);
    expectNotAllowed(r1, ['a']); // 非空 path：避免与崩溃边界 path:[] 形态混淆
    const textDoc = new Y.Doc();
    textDoc.getText('ROOT').insert(0, 'hi');
    expectNotAllowed(readLogicalValueAtPath(textDoc, ['a']), ['a']);
  });
});

// —— AC6：返回值不含 live 引用、不做运行时 freeze；突变不影响 live doc ——

describe('AC6 — 可变普通深拷贝（无 live 引用、不 freeze、与 live doc 解耦）', () => {
  it('读取 Y.Map 子树：无 Yjs 泄漏 + JSON 往返无损', () => {
    const fx = buildDoc();
    const value = expectOkValue(readLogicalValueAtPath(fx.doc, ['cfg']));
    expect(normalizeXmlDeep(value)).toEqual(EXPECTED_ROOT.cfg);
    expectJsonRoundTrip(value);
    expectNoYjsLeak(value);
  });

  it('不做运行时 freeze：顶层与嵌套普通对象均可写（可变深拷贝）', () => {
    const fx = buildDoc();
    const value = expectOkValue(readLogicalValueAtPath(fx.doc, ['meta'])) as {
      createdBy: string; tags: string[]; nested: { deep: string };
    };
    expect(Object.isFrozen(value)).toBe(false);
    expect(Object.isFrozen(value.tags)).toBe(false);
    expect(Object.isFrozen(value.nested)).toBe(false);
    value.createdBy = 'mutated';
    value.tags.push('c');
    value.nested.deep = 'mutated';
    // 深度解耦：live doc 原值不受突变影响（经 live 视图重读实证）
    const live = fx.doc.getMap('ROOT').get('meta') as { createdBy: string; tags: string[]; nested: { deep: string } };
    expect(live.createdBy).toBe('jim');
    expect(live.tags).toEqual(['a', 'b']);
    expect(live.nested.deep).toBe('value');
  });

  it('返回值修改不影响 live doc：重读原值 + live 视图实证（Y.Map / plain array 双通道）', () => {
    const fx = buildDoc();
    // plain array：读 → 突变返回副本
    const arr = expectOkValue(readLogicalValueAtPath(fx.doc, ['arr'])) as unknown[];
    arr.push('hacked');
    arr[0] = 'mutated';
    // Y.Map 子树：读 → 突变嵌套返回副本
    const cfg = expectOkValue(readLogicalValueAtPath(fx.doc, ['cfg'])) as { extra: number[]; mode: string };
    cfg.extra.push(99);
    cfg.mode = 'hacked';
    // 重读 → 原值
    expect(expectOkValue(readLogicalValueAtPath(fx.doc, ['arr']))).toEqual([1, 'two', true, null, { n: 'obj' }]);
    expect(normalizeXmlDeep(expectOkValue(readLogicalValueAtPath(fx.doc, ['cfg'])))).toEqual(EXPECTED_ROOT.cfg);
    // live 视图实证（ground truth）
    const liveRoot = fx.doc.getMap('ROOT');
    expect(liveRoot.get('arr')).toEqual([1, 'two', true, null, { n: 'obj' }]);
    expect((liveRoot.get('cfg') as Y.Map<unknown>).get('mode')).toBe('fast');
  });

  it('失败通道同步 + 单错回显：预期 path/载体失败一律经返回值（ok:false 联合），不抛异常，path 回显整条尝试路径', () => {
    const fx = buildDoc();
    addBadValues(fx);
    // 调用本身不抛出（同步失败通道：仅 internal bug 才抛，ADR-0008）
    expect(() => readLogicalValueAtPath(fx.doc, ['arr', -1])).not.toThrow();
    expect(() => readLogicalValueAtPath(fx.doc, ['badNested'])).not.toThrow();
    expect(() => readLogicalValueAtPath(fx.doc, ['textVal'])).not.toThrow();
    // 失败结果必然携带冻结联合的失败侧形态：code:'PATH_NOT_ALLOWED' + 整条尝试路径回显
    expectNotAllowed(readLogicalValueAtPath(fx.doc, ['items', '0']), ['items', '0']);
    expectNotAllowed(readLogicalValueAtPath(fx.doc, ['arr', -1]), ['arr', -1]);
    expectNotAllowed(readLogicalValueAtPath(fx.doc, ['badNested']), ['badNested']);
    expectNotAllowed(readLogicalValueAtPath(fx.doc, ['textVal']), ['textVal']);
  });
});
