/**
 * @nomicore/doc-runtime — ② detached builder 收敛 seam（issue #88 设计 §3 / D2）。
 *
 * 自 materialize.ts 纯移动（issue #88 设计 §3.1，resolve.ts 先例纪律）：签名与实现逐字
 * 不变——buildTopEntries / rootEntries / buildValue / buildUnion / mapEntries /
 * copyJsonDomain + 形状/域/issue/renderPath 辅助与内部遍历类型。移动使 materializeRoot
 * 与 replaceRootContent 及 ⑥ scratch 构造共享同一实现，杜绝复制漂移（AC-1 单源落点）。
 *
 * 导出面（R3 定稿，SA2 零裁量——设计 §3.1 写死）：
 * - `buildTopEntries` —— 构造接缝（materialize/replace 的 ② 与 install-verify 的
 *   scratch 构造共用）；
 * - `buildDetachedValue` —— mutation 局部 carrier 提交前的 detached 子树构造；
 * - `@internal plainObjectOf / recordSlotOf / declaredFieldOf / makeIssue` —— 包内共享
 *   辅助（唯一消费方 = install-verify 的 productEqual/deepEqualValue/keysetOf 与
 *   materialize 留守 prepare 的载体/非空 issue；walk @internal 包内复用接缝先例——
 *   extract.ts:86-88，不经 index.ts 公共入口导出）；
 * - `@internal` 类型 `Path / Resolver / BuildIssue` —— 供 install-verify 的
 *   ScratchInstall/ProductComparison/productEqual 签名消费；
 * - 其余一切模块私有。
 */
import * as Y from 'yjs';
import type { DerivedSchema, StructureNode } from '@nomicore/vfsl';
import { carrierOf } from './carrier.js';
import { makeRefResolver } from './resolve.js';
import { parseXmlToFragment } from './xml-parse.js';

/** 构造域 issue（名义类型：与 MaterializeIssue/ReplaceIssue 结构同一——纯 TS 结构化
 * 兼容，无运行时转换；issue #88 设计 §3.1/§10）。 */
export type BuildIssue = {
  message: string;
  path: Array<string | number>; // 段数组：map/object/Record 用 string，Y.Array 用 number；[] 即 ROOT 自身
};

/** 遍历内部两结局（构造侧无软拒概念，D5）。 */
type BuildResult = { kind: 'value'; value: unknown } | { kind: 'issue'; issue: BuildIssue };
type EntriesResult = { kind: 'ok'; entries: Array<[string, unknown]> } | { kind: 'issue'; issue: BuildIssue };
/** @internal 包内共享类型（issue #88 设计 §3.1：install-verify 签名消费）。 */
export type Path = Array<string | number>;
/** @internal 包内共享类型（issue #88 设计 §3.1：install-verify 签名消费）。 */
export type Resolver = (node: StructureNode) => StructureNode;

/** ② 顶层 detached 构造（⑥ scratch 与 prepare 共用；rev2 RD8）：D8 解析器 + rootEntries。
 * 环/缺名 throw → prepare 侧收编 E200；⑥ scratch 侧收编 E201 变体 D（触发类④）。 */
export function buildTopEntries(derived: DerivedSchema, snapshot: unknown):
  | { kind: 'ok'; entries: Array<[string, unknown]> }
  | { kind: 'issue'; issue: BuildIssue } {
  if (derived.structure.kind !== 'root') {
    // 对齐 extract/materialize B8 loud 边界（手造派生物）：prepare 侧 → E200；⑥ scratch 侧
    // → E201 变体 D（触发类④——real 侧已过，理论不可达，防御性收敛）
    throw new Error('derived.structure 非 root（手造派生物）');
  }
  const resolve = makeRefResolver(derived); // D8 共享解析器（环守卫先于 memo 命中）
  const top = rootEntries(derived.structure.node, snapshot, resolve);
  if (top.kind === 'issue') return { kind: 'issue', issue: top.issue };
  return { kind: 'ok', entries: top.entries };
}

/**
 * ROOT 顶层特化（§4.3）：产物是 entries 而非 detached map——安装目标是 doc.getMap('ROOT')
 * 本身（ADR-0003），不能把 detached map「换上去」；detached 不可读（P2），entries 必须
 * 构造期随身携带，④ 直接消费。全 map 形联合 ROOT 逐成员试验（声明序，首个成功胜）。
 * 非 map/union 成员 → throw → E200（R2-M1 定谳：ADR-0003「ROOT 必须 map 形」是派生物
 * 合法性约束，非 map 形成员只可能来自手造派生物——loud 收编，无跳过分支）。
 */
function rootEntries(node: StructureNode, snap: unknown, resolve: Resolver): EntriesResult {
  const n = resolve(node); // root 内层（恒非 ref；手造 ref 链在此收敛，环/缺名 → E200）
  if (n.kind === 'map') return mapEntries(n, snap, [], resolve);
  if (n.kind === 'union') {
    let firstIssue: BuildIssue | undefined; // 声明序首真 issue（R2-M2）
    for (const member of n.members) { // 成员声明序（INV-8）；成员只允许 map/union 形——
      // 非 map/union 成员落入函数末尾 throw → E200（R2-M1 定谳：不跳过）
      const r = rootEntries(member, snap, resolve);
      if (r.kind === 'ok') return r; // 首个成功成员胜（实证 T12：两种成员形状各自成功）
      if (firstIssue === undefined) firstIssue = r.issue;
    }
    return issue([], `联合 ROOT 无可构造成员（全 map 形联合的 ${n.members.length} 个成员均拒；首个失败：${firstIssue!.message}）`);
  }
  throw new Error('ROOT 结构节点非 map 形（手造派生物）'); // ADR-0003「ROOT 必须 map 形」→ E200
}

/**
 * 节点构造遍历（§4.3 全景表唯一分发点）：八 kinds 与 extract 对称。
 * map/array/xml-fragment 位有形状断言（D4）；leaf/plain 同支走 copyJsonDomain（D6）；
 * union 递归试验；ref 经共享解析器（D8）。
 */
export function buildDetachedValue(
  derived: DerivedSchema,
  node: StructureNode,
  value: unknown,
  path: Path,
): BuildResult {
  return buildValue(node, value, path, makeRefResolver(derived));
}

function buildValue(node: StructureNode, v: unknown, path: Path, resolve: Resolver): BuildResult {
  switch (node.kind) {
    case 'root':
      return buildValue(node.node, v, path, resolve); // 嵌套 root = 手造 → E200 路径同 extract 透传语义
    case 'ref':
      return buildValue(resolve(node), v, path, resolve); // 环/缺名 → throw → E200
    case 'map': {
      const r = mapEntries(node, v, path, resolve);
      if (r.kind === 'issue') return r;
      const ymap = new Y.Map<unknown>();
      for (const [key, value] of r.entries) ymap.set(key, value);
      return { kind: 'value', value: ymap };
    }
    case 'array': {
      if (!Array.isArray(v)) return shapeIssue(path, '数组', v);
      const items: unknown[] = [];
      for (let i = 0; i < v.length; i++) {
        const r = buildValue(node.element, v[i], [...path, i], resolve); // i = number 段
        if (r.kind === 'issue') return r;
        items.push(r.value);
      }
      const yarr = new Y.Array<unknown>();
      yarr.insert(0, items); // 一次 insert 整装（P1）
      return { kind: 'value', value: yarr };
    }
    case 'xml-fragment': {
      if (typeof v !== 'string') return shapeIssue(path, 'XML 字符串', v);
      const parsed = parseXmlToFragment(v);
      if (!parsed.ok) return issue(path, `XML 解析失败（${renderPath(path)}）：${parsed.reason}`); // F8
      return { kind: 'value', value: parsed.fragment };
    }
    case 'leaf':
    case 'plain':
      return copyJsonDomain(v, path, ''); // 同支（D6：yjs 存储层同载体，往返域对称）
    case 'union':
      return buildUnion(node, v, path, resolve);
  }
}

/**
 * union 构造试验（D5/§4.4）：试验 = 完整递归构造尝试，首个成功成员胜（any-of + 声明序，
 * INV-8）；失败产物是可丢弃的 detached 垃圾（未集成任何 doc，GC 回收，INV-1 不受影响）。
 * 无软拒概念——必填性是值域概念归 ① 校验；试验只有二值结局。全拒 → 单 issue 附声明序
 * 首真 issue 摘要（R2-M2，对齐 extract walkUnion「首真 issue」纪律）。判别式零读取（死数据）。
 */
function buildUnion(node: Extract<StructureNode, { kind: 'union' }>, v: unknown, path: Path, resolve: Resolver): BuildResult {
  let firstIssue: BuildIssue | undefined;
  for (const member of node.members) { // 成员声明序（INV-8）
    const r = buildValue(resolve(member), v, path, resolve);
    if (r.kind === 'value') return r; // 首个构造成功者胜
    if (firstIssue === undefined) firstIssue = r.issue; // 丢弃的是其余成员的细节，首成员细节保留
  }
  return issue(path, `联合节点无可构造成员（${renderPath(path)}）：${node.members.length} 个成员的结构形状均不符（首个失败：${firstIssue!.message}）`); // F6
}

/**
 * map 节点键值收集（D9 核心）：按快照键迭代（Object.keys 枚举序，INV-8）——写侧若按声明
 * 字段迭代，快照中「声明外的键」会被静默丢弃（数据丢失伪降级）；封闭形快照键查不到声明
 * 字段 = 单 issue（F7，诚实快照不可达——可达向量 = 对抗 Proxy 双读发散 / 手造派生物）。
 * Record 形（单字段 '<key>'）：一切键都是动态键。undefined 值视同缺席（present 惯例）。
 */
function mapEntries(node: Extract<StructureNode, { kind: 'map' }>, snap: unknown, path: Path, resolve: Resolver): EntriesResult {
  const obj = plainObjectOf(snap); // D4 原型守卫：typeof object && 非 null && 非数组 && 原型为 Object.prototype/null
  if (obj === null) return shapeIssue(path, 'map 形普通对象', snap);
  const slot = recordSlotOf(node); // Record 形判定：fields 恰一且 name === '<key>'（与 extract.ts:100 同款约定）
  const entries: Array<[string, unknown]> = [];
  for (const key of Object.keys(obj)) { // 快照键枚举序（INV-8；与 validate §9.2 同一 JS 语义）
    const v = obj[key]; // own 数据属性遮蔽原型 accessor（实证 T10：own '__proto__' 键可经此读到）
    if (v === undefined) continue; // present 惯例：undefined 视同缺席（validate L158 同款）
    const childNode = slot !== undefined ? slot : declaredFieldOf(node, key);
    if (childNode === undefined) {
      return issue([...path, key], `快照含结构树未声明字段 "${key}"——拒绝静默丢键`); // F7
    }
    const r = buildValue(childNode, v, [...path, key], resolve);
    if (r.kind === 'issue') return { kind: 'issue', issue: r.issue };
    entries.push([key, r.value]);
  }
  return { kind: 'ok', entries };
}

/**
 * JSON 域深拷贝（D6/§4.5，extract copyPlainValue 的输入向孪生）：六词同表（INV-9 落文）
 * bigint / non-finite number / undefined（数组元素）/ non-plain object / function / symbol
 * （+ 内嵌 Y 类型用载体词）——与 extract.ts:261-308 逐词对齐；全部可达（unknown 位实证：
 * Y.Map 实例 / bigint / function / NaN / Date / 数组内 undefined 均通过 ①）。一切容器
 * （数组/对象）重建新实例（INV-7：yjs set 按引用存储，A19——不拷贝即共享）。
 */
function copyJsonDomain(v: unknown, path: Path, loc: string): BuildResult {
  if (typeof v === 'number') { // number 拆支（对齐 extract R2.3）
    if (!Number.isFinite(v)) return domainIssue(path, loc, 'non-finite number'); // NaN/±Infinity 可达（§2.2）
    return { kind: 'value', value: v }; // 有限 number 直通
  }
  if (v === null || typeof v === 'string' || typeof v === 'boolean') {
    return { kind: 'value', value: v }; // JSON 标量直通（标量不可变，无引用隔离问题）
  }
  const c = carrierOf(v); // carrier.ts 粗判复用
  if (c !== null && c !== 'plain value') {
    return domainIssue(path, loc, c); // 内嵌 Y 类型：跨 doc 集成 live 引用会移动/劫持源类型，必须拒绝
  }
  if (typeof v === 'bigint') return domainIssue(path, loc, 'bigint');
  if (Array.isArray(v)) {
    const out: unknown[] = [];
    for (let i = 0; i < v.length; i++) {
      const el = v[i];
      if (el === undefined) return domainIssue(path, `${loc}[${i}]`, 'undefined');
      const r = copyJsonDomain(el, path, `${loc}[${i}]`);
      if (r.kind === 'issue') return r;
      out.push(r.value); // 新数组——INV-7 引用隔离
    }
    return { kind: 'value', value: out };
  }
  if (typeof v === 'object') { // 走到此处必非 Y 家族（粗判已滤）
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) {
      // 原型守卫（对齐 extract R2/#3 判例）：Date/RegExp/Map/Set/类实例 → 拒绝，禁静默投影 {}
      const ctorName = (proto as { constructor?: { name?: string } }).constructor?.name ?? 'unknown';
      return domainIssue(path, loc, 'non-plain object', `constructor: ${ctorName}`);
    }
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v)) {
      const val = (v as Record<string, unknown>)[k];
      if (val === undefined) continue; // present 惯例（与 mapEntries/validate 三方一致）
      const r = copyJsonDomain(val, path, `${loc}.${k}`);
      if (r.kind === 'issue') return r;
      // defineProperty 安全写入（对齐 extract putSnapshotKey/D13：own '__proto__' 键
      // 不落原型、不触发原型 setter）
      Object.defineProperty(out, k, { value: r.value, writable: true, enumerable: true, configurable: true });
    }
    return { kind: 'value', value: out };
  }
  // undefined（数组元素位已拦截；防 buildValue 直入防御）与 function/symbol 尾支
  if (v === undefined) return domainIssue(path, loc, 'undefined');
  return domainIssue(path, loc, typeof v === 'function' ? 'function' : 'symbol');
}

// —— 形状/域断言与 issue 构造（单点定义，SA3 防走样）——

/** D4 原型守卫：map 形普通对象（typeof object && 非 null && 非数组 && 原型为 Object.prototype 或 null）。
 * @internal 包内共享辅助（issue #88 设计 §3.1：唯一消费方 = install-verify 的
 * productEqual / deepEqualValue / keysetOf；walk @internal 接缝先例）。 */
export function plainObjectOf(v: unknown): Record<string, unknown> | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return null;
  return v as Record<string, unknown>;
}

/** Record 形判定：fields 恰一且 name === '<key>'（与 extract.ts:100 同款约定，两侧逐字相同）。
 * @internal 包内共享辅助（issue #88 设计 §3.1：唯一消费方 = install-verify 的 productEqual）。 */
export function recordSlotOf(node: Extract<StructureNode, { kind: 'map' }>): StructureNode | undefined {
  const first = node.fields[0];
  if (node.fields.length === 1 && first !== undefined && first.name === '<key>') return first.node;
  return undefined;
}

/** 封闭 map 形：查声明字段（字段声明序）。
 * @internal 包内共享辅助（issue #88 设计 §3.1：唯一消费方 = install-verify 的 productEqual）。 */
export function declaredFieldOf(node: Extract<StructureNode, { kind: 'map' }>, key: string): StructureNode | undefined {
  for (const f of node.fields) {
    if (f.name === key) return f.node;
  }
  return undefined;
}

/** issue 构造器（统一出口）：shapeIssue / domainIssue / makeIssue 全部收敛到此。 */
function issue(path: Path, message: string): { kind: 'issue'; issue: BuildIssue } {
  return { kind: 'issue', issue: makeIssue(path, message) };
}

/** issue 构造器（统一出口）：跨模块消费方 = materialize 留守 prepare 的载体 issue /
 * 非空 ROOT issue 两处（实源码 464/467）+ builder 内部 issue/shapeIssue/domainIssue
 * 同源（issue #88 设计 §3.1 R3 增补 / SA2 R2-A1）。@internal 包内共享。
 */
export function makeIssue(path: Path, message: string): BuildIssue {
  return { message, path };
}

/** 形状词（D4）：null / array / object / string / number / boolean / bigint / function /
 *  symbol；object 子类附（constructor: Date）式申报（对齐 extract D9② 申报词纪律）。
 *  词只进 message 文本，不进结构化字段。 */
function wordOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'object') {
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) {
      const ctorName = (proto as { constructor?: { name?: string } }).constructor?.name ?? 'unknown';
      return `object（constructor: ${ctorName}）`;
    }
    return 'object';
  }
  return typeof v; // string / number / boolean / bigint / function / symbol / undefined
}

/** F4 形状错位 issue（恒 issue 变体——可同时赋给 BuildResult 与 EntriesResult）。 */
function shapeIssue(path: Path, expected: string, v: unknown): { kind: 'issue'; issue: BuildIssue } {
  return issue(path, `快照形状错位（${renderPath(path)}）：期望 ${expected}，实际 ${wordOf(v)}`);
}

/** F5 纯值域违规 issue（六词同表；位置线进 message，path 锚定声明节点位——与 extract 同纪律）。 */
function domainIssue(path: Path, loc: string, word: string, extra?: string): { kind: 'issue'; issue: BuildIssue } {
  const at = loc === '' ? '' : `，内部位置 ${loc}`;
  const extraPart = extra === undefined ? '' : `（${extra}）`;
  return issue(path, `纯值域违规（${renderPath(path)}${at}）：期望 plain value（JSON 值域），实际 ${word}${extraPart}`);
}

/** path 渲染仅用于 message 文本（ADR-0007 禁的是 issue.path 的点号表示，不禁文本渲染）；
 *  与 extract.ts renderPath 同款实现思路。 */
function renderPath(path: Path): string {
  return path.length === 0 ? 'ROOT'
    : path.reduce<string>(
      (acc, seg) => (typeof seg === 'number' ? `${acc}[${seg}]` : `${acc}.${String(seg)}`),
      'ROOT',
    );
}
