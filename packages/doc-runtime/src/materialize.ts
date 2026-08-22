/**
 * @nomicore/doc-runtime — materializeRoot(derived, snapshot, doc)：验证后安全物化
 * logical ROOT 到 Yjs（ADR-0007 / issue #74）。extract 的方向反转孪生（JSON→doc，写侧）。
 *
 * 设计 §4.1–§4.8（wiki/raw/task_doc-runtime-materialize-root_design.md）+ 修订轮 rev1
 * （wiki/raw/task_doc-runtime-materialize-root-rev1_design.md，PR #84 owner Review 闭环）：
 * - 五阶段编排（D1+RD1）：① validateLogicalSnapshot（逻辑宽域，失败 → issues 引用零损透传，
 *   不重包装——AC-1 `toEqual` 契约）② detached 构造（结构窄域，失败 → 单 issue fail-fast）
 *   ③ probeRoot 探针 + ROOT 空置判定（复用 carrier.ts，零修改）④ 单次 doc.transact 安装
 *   ⑤ verifyInstall 事务后 ROOT 顶层完整性校验（rev1/RD1/INV-10：size + 逐键同一性双断言，
 *   偏离 → throw DOCRT-E201——F11，W1 三禁：不返回 ok:false、不补偿修复、不声称已回滚）。
 *   ①②③ 共享崩溃边界（意外异常 → DOCRT-E200 单 issue）；④ 物理上位于一切 try/catch
 *   之外（INV-5）：observer 抛错 → 原样 loud 传播（AC-6），绝不吞并成伪 ok/伪回滚。
 * - 按快照键迭代（D9）：封闭 map 形快照键查不到声明字段 = 单 issue「拒绝静默丢键」；
 *   undefined 值视同缺席（present 惯例）；Record 形判定 = 单字段 '<key>'（与 extract
 *   同款约定）；键写入一律经 defineProperty（own '__proto__' 键不落原型）。
 * - union 构造试验（D5/§4.4）：递归构造尝试、首个成功成员胜、无软拒概念；全拒 → 单
 *   issue 附声明序首真 issue 摘要（R2-M2，对齐 extract walkUnion「首真 issue」纪律）。
 * - copyJsonDomain（D6/§4.5）：leaf 与 plain 同支；六词同表（bigint / non-finite number /
 *   undefined（数组元素）/ non-plain object / function / symbol + 内嵌 Y 类型载体词）——
 *   INV-9 往返域对称：extract 读侧拒绝的值，写侧同表拒绝；一切容器重建新实例（INV-7
 *   输入引用隔离）；原型守卫（Date/类实例 → 拒绝，禁静默投影 {}）。
 * - ROOT 顶层特化 rootEntries（§4.3）：产物是 entries 而非 detached map（安装目标是
 *   doc.getMap('ROOT') 本身，detached 不可读 P2）；全 map 形联合 ROOT 逐成员试验；
 *   非 map/union 成员 → throw → E200（R2-M1 定谳：手造派生物 loud，无跳过分支）。
 */
import * as Y from 'yjs';
import type { DerivedSchema, StructureNode } from '@nomicore/vfsl';
import { validateLogicalSnapshot } from '@nomicore/vfsl';
import { carrierOf, probeRoot } from './carrier.js';
import { makeRefResolver } from './resolve.js';
import { parseXmlToFragment } from './xml-parse.js';

/** 物化 issue：与 ValidateIssue 同形（message + path 段数组）。logical 失败时数组元素即
 *  validateLogicalSnapshot 原生 issue（引用透传）；materialization 失败恒单条（fail-fast）。 */
export interface MaterializeIssue {
  message: string;
  path: Array<string | number>; // 段数组：map/object/Record 用 string，Y.Array 用 number；[] 即 ROOT 自身
}

export type MaterializeResult =
  | { ok: true } // 成功不携带额外载荷（exactOptionalPropertyTypes：无多余键）
  | { ok: false; issues: MaterializeIssue[] };

/** 遍历内部两结局（构造侧无软拒概念，D5）。 */
type BuildResult = { kind: 'value'; value: unknown } | { kind: 'issue'; issue: MaterializeIssue };
type EntriesResult = { kind: 'ok'; entries: Array<[string, unknown]> } | { kind: 'issue'; issue: MaterializeIssue };
type Path = Array<string | number>;
type Resolver = (node: StructureNode) => StructureNode;

/**
 * 唯一公共物化入口（ADR-0007）：同步、错误经返回值传递（④/⑤ 的异常是唯一例外——D1/RD1）。
 *
 * ⚠️ 前置条件（契约前提，R2 修订增补）：本函数的事务必须是该 Y.Doc 的**最外层事务**——
 * 调用方不得在未闭合的 doc.transact 内调用。若被外层事务包裹，本函数事务并入外层，
 * observer 与 update 延迟至外层 cleanup 才执行：⑤ 完整性校验将空转通过并返回 ok:true，
 * 随后 observer 的 ROOT 删改不受检测（且返回时计划 set 尚未提交）——检测面失效。
 *
 * 成功语义（ok:true 的完整承诺，PR #84 owner Review 修订轮 R1 定谳 / INV-10）：
 * 1. 全部计划 set 已在单次 Y.transact 提交（ADR-0006 单 update 单元）；
 * 2. 本函数返回时，ROOT 顶层恰为计划键集且逐键值与安装值严格同一——在上述前置条件成立的
 *    前提下，任何同步重入的 observer 对 ROOT 顶层的 delete / 覆写 / 插入额外键都会被
 *    ⑤ verifyInstall 检测，检测到偏离即 throw DOCRT-E201（Runtime internal/fatal 家族：
 *    写入已提交、不回滚、不补偿、不返回 ok:false；doc 保持 observer 留下的实际状态）。
 *
 * 检测面边界（明文）：⑤ 覆盖 ROOT 顶层（exact-by-construction），检测基准是**身份同一性**
 * （===）而非语义等价——语义等价的异实例重插亦触发 E201（有意保守）。不覆盖：observer 对
 * 已安装子树内部的嵌套就地修改、异步修改（契约时点 = 本函数返回时）、以及前置条件被破坏时
 * 的全部 observer 反应——该面由 ADR-0007 observer 纪律治理（Yjs observer 不得向事务调用栈
 * 抛异常；Runtime 编排边界：业务调用方不得取得可写 Yjs 引用）。observer 抛错时错误原样
 * 传播（F10），⑤ 不运行。
 */
export function materializeRoot(derived: DerivedSchema, snapshot: unknown, doc: Y.Doc): MaterializeResult {
  const ready = prepare(derived, snapshot, doc); // ①②③ + E200 崩溃边界（唯一 try/catch 所在）
  if (ready.kind === 'fail') return { ok: false, issues: ready.issues }; // INV-3/INV-4
  // ④ 单事务安装 —— 本函数体内没有任何 try/catch（INV-5 的结构性保证）：
  // 事务体内只含对已验证载荷的 set 循环（D10：copyJsonDomain 产物 + detached 类型均不可使
  // yjs set 抛错——唯一抛源 = observer/引擎缺陷 → 原样 loud 传播）。
  doc.transact(() => {
    for (const [key, value] of ready.entries) ready.rootMap.set(key, value);
  });
  verifyInstall(ready); // ⑤ 新增（RD1/INV-10）：顶层完整性校验——只读、无副作用、不在任何
  //                     try/catch 内；observer 抛错时（F10）④ 已 loud 传播，⑤ 不运行
  return { ok: true }; // ok:true 语义 = INV-2 + INV-10（JSDoc 前置条件段 + 成功语义段）
}

/**
 * ⑤ 事务后顶层完整性校验（RD1，INV-10）。双断言缺一不可（G5 实证：observer 同轮
 * delete 计划键 + insert 额外键可保持 size 相等而同一性破坏——只查 size 会漏报）。
 * 只读；任何偏离 → throw DOCRT-E201（W1 唯一相容形态：不返回 ok:false——事务已提交，
 * 「失败⟹文档不变」只覆盖验证/构造失败域；不补偿修复——「不覆盖、不合并、不 fallback」；
 * 不声称已回滚——message 明示写入已提交、doc 保持 observer 留下的实际状态）。
 */
function verifyInstall(ready: { rootMap: Y.Map<unknown>; entries: Array<[string, unknown]> }): void {
  const { rootMap, entries } = ready;
  if (rootMap.size !== entries.length) {
    // 覆盖向量：delete 计划键（size 减）/ insert 额外键（size 增）/ 组合
    throw new Error(
      `DOCRT-E201: ROOT 顶层安装完整性偏离：期望 ${entries.length} 个键，事务提交后实际 ` +
      `${rootMap.size} 个（实际键集：${JSON.stringify([...rootMap.keys()])}）——疑似 observer ` +
      `同步重入修改 ROOT；写入已提交，不回滚、不补偿，doc 保持 observer 留下的实际状态`,
    );
  }
  for (const [key, value] of entries) {
    if (rootMap.get(key) !== value) {
      // 覆盖向量：overwrite 计划键（值不同一）/ delete 后重插异值 / delete 单键（size 断言亦会抓，
      // 此处兜底）。严格同一性（===）对标量（不可变）与引用类型（yjs set 按引用存储，A19/G5 实证
      // 集成后 get 返回同一实例）均正确：同值重插（G4）不误报。
      throw new Error(
        `DOCRT-E201: ROOT 顶层安装完整性偏离：键 "${key}" 的值在事务提交后与安装值不同一——` +
        `疑似 observer 覆写或删除后重插异值；写入已提交，不回滚、不补偿，doc 保持 observer 留下的实际状态`,
      );
    }
  }
}

type Prepared =
  | { kind: 'ready'; rootMap: Y.Map<unknown>; entries: Array<[string, unknown]> }
  | { kind: 'fail'; issues: MaterializeIssue[] };

/** ①②③ 共享崩溃边界（D1）：任何意外异常 → DOCRT-E200 单 issue（F9）。 */
function prepare(derived: DerivedSchema, snapshot: unknown, doc: Y.Doc): Prepared {
  try {
    if (derived.structure.kind !== 'root') {
      throw new Error('derived.structure 非 root（手造派生物）'); // 对齐 extract B8 loud 边界
    }
    // ① 逻辑校验（值域宽域）：失败 → 引用零损透传（D2，INV-4；validateLogicalSnapshot
    //    自身不抛错，其 E100/预算截断形态原样返回）
    const logical = validateLogicalSnapshot(derived, snapshot);
    if (!logical.ok) return { kind: 'fail', issues: logical.issues };

    // ② detached 构造（结构域窄域）：任何失败 → 单 issue（INV-3）；产物全是 detached
    //    类型与新克隆（对 doc 零触碰）
    const resolve = makeRefResolver(derived); // D8 共享解析器（环守卫先于 memo 命中）
    const top = rootEntries(derived.structure.node, snapshot, resolve);
    if (top.kind === 'issue') return { kind: 'fail', issues: [top.issue] };

    // ③ ROOT 探针 + 空置判定（D3）：只读触碰 'ROOT'（INV-6）
    const probe = probeRoot(doc);
    if (probe.carrier !== 'Y.Map') {
      return { kind: 'fail', issues: [makeIssue([], `ROOT 载体不是 Y.Map（期望 Y.Map，实际 ${probe.carrier}）——无法安装物化子树`)] };
    }
    if (probe.map.size > 0) {
      return { kind: 'fail', issues: [makeIssue([], `目标 ROOT 非空（现有 ${probe.map.size} 个键）——不覆盖、不合并、不 fallback`)] };
    }
    return { kind: 'ready', rootMap: probe.map, entries: top.entries };
  } catch (err) {
    // 崩溃边界（①②③ 范围）：实现缺陷 / 手造派生物 / 对抗输入（getter/Proxy 抛出）
    const detail = err instanceof Error ? err.message : String(err);
    return { kind: 'fail', issues: [{ message: `DOCRT-E200: materialize 内部错误（意外异常）: ${detail}`, path: [] }] };
  }
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
    let firstIssue: MaterializeIssue | undefined; // 声明序首真 issue（R2-M2）
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
  let firstIssue: MaterializeIssue | undefined;
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

/** D4 原型守卫：map 形普通对象（typeof object && 非 null && 非数组 && 原型为 Object.prototype 或 null）。 */
function plainObjectOf(v: unknown): Record<string, unknown> | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return null;
  return v as Record<string, unknown>;
}

/** Record 形判定：fields 恰一且 name === '<key>'（与 extract.ts:100 同款约定，两侧逐字相同）。 */
function recordSlotOf(node: Extract<StructureNode, { kind: 'map' }>): StructureNode | undefined {
  const first = node.fields[0];
  if (node.fields.length === 1 && first !== undefined && first.name === '<key>') return first.node;
  return undefined;
}

/** 封闭 map 形：查声明字段（字段声明序）。 */
function declaredFieldOf(node: Extract<StructureNode, { kind: 'map' }>, key: string): StructureNode | undefined {
  for (const f of node.fields) {
    if (f.name === key) return f.node;
  }
  return undefined;
}

/** issue 构造器（统一出口）：shapeIssue / domainIssue / makeIssue 全部收敛到此。 */
function issue(path: Path, message: string): { kind: 'issue'; issue: MaterializeIssue } {
  return { kind: 'issue', issue: makeIssue(path, message) };
}

function makeIssue(path: Path, message: string): MaterializeIssue {
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
function shapeIssue(path: Path, expected: string, v: unknown): { kind: 'issue'; issue: MaterializeIssue } {
  return issue(path, `快照形状错位（${renderPath(path)}）：期望 ${expected}，实际 ${wordOf(v)}`);
}

/** F5 纯值域违规 issue（六词同表；位置线进 message，path 锚定声明节点位——与 extract 同纪律）。 */
function domainIssue(path: Path, loc: string, word: string, extra?: string): { kind: 'issue'; issue: MaterializeIssue } {
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
