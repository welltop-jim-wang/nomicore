/**
 * @nomicore/doc-runtime — extractYjsSnapshot(derived, doc)：只读固定 ROOT，
 * 严格区分 Yjs 载体并提取普通 logical ROOT snapshot（ADR-0007 / issue #73）。
 *
 * 设计 §3.1/§4.3–§4.8（wiki/raw/task_doc-runtime-extract-yjs-snapshot_design.md）：
 * - 节点遍历全景表（§4.3）：root/map/array/xml-fragment/leaf/plain/union/ref 八 kinds
 *   全覆盖；缺失字段与未知键不报不进快照（D4，逻辑域归 validateLogicalSnapshot）；
 * - union 试验语义（§4.5）：判别式对提取器是死数据（D5/INV-4）；成员根载体前置判定
 *   （R2/#5）；Record 形成员试验 = 直接 walk（R2/#1）；三结局（接受/真 issue/软拒），
 *   首个接受者胜，全拒报声明序首真 issue，全软拒回退成员 0 提交提取；
 * - plain 值深拷贝 + JSON 值域断言（§4.6）：原型守卫（Date/类实例 → 真 issue）、
 *   bigint/数组内 undefined/function/symbol 内嵌 → 真 issue（D9② 申报词）、
 *   own '__proto__' 键经 defineProperty 安全写入（R2/#8）——snapshot 无 Yjs 泄漏（INV-1/2）；
 * - 崩溃边界（§4.8）：全函数体顶层 try/catch → DOCRT-E100 结构化返回，绝不外抛（INV-6）。
 */
import * as Y from 'yjs';
import type { DerivedSchema, StructureNode } from '@nomicore/vfsl';
import { carrierOf, probeRoot } from './carrier.js';

/** 提取 issue：fail-fast 单 issue（ADR-0007「Yjs 结构错误 fail-fast」）。 */
export interface ExtractIssue {
  message: string;
  /** 段数组：map/object/Record 用 string，Y.Array 用 number；[] 即 ROOT 自身（ADR-0007）。 */
  path: Array<string | number>;
  /** 结构树节点所需载体（词汇表：'Y.Map'|'Y.Array'|'Y.XmlFragment'|'plain value'；崩溃边界为 'internal'，D9①）。 */
  expected: string;
  /** doc 实际存储载体（词汇表另含 'Y.Text'；plain 域违规为 D9② 申报词；崩溃边界为 'internal'）。 */
  actual: string;
}

export type ExtractResult =
  | { ok: true; snapshot: unknown }
  | { ok: false; issues: ExtractIssue[] };

/** 遍历内部两结局（R2/#7/D12：'undetermined' 第三结局已删除——类型即不变式）。 */
type WalkResult =
  | { kind: 'value'; snapshot: unknown } // 干净提取
  | { kind: 'issue'; issue: ExtractIssue }; // 首个真结构错位（fail-fast，携带即止）

/** 成员试验三结局（试验层概念，与 WalkResult 两结局区分）：issue = 真结构错位；缺 issue = 软拒（仅缺必填）。 */
type TrialResult =
  | { accept: true; snapshot: unknown } // 零 issue 且零缺必填
  | { accept: false; issue?: ExtractIssue };

/**
 * 只读固定 ROOT，严格验证 Yjs 载体并提取普通 logical ROOT snapshot（ADR-0007）。
 * 同步、不抛错——fail-fast 单 issue 经返回值传递；任意输入不外抛（INV-6）。
 */
export function extractYjsSnapshot(derived: DerivedSchema, doc: Y.Doc): ExtractResult {
  try {
    if (derived.structure.kind !== 'root') {
      // 手造/篡改派生物 → loud 崩溃边界（B8），绝不静默产出垃圾快照
      throw new Error('derived.structure 非 root（手造派生物）');
    }
    const probe = probeRoot(doc); // §4.2（唯一触碰 doc 的入口；INV-7 只碰 'ROOT'）
    if (probe.carrier !== 'Y.Map') {
      // F5/T1/T2：yjs 异型 ROOT 原生 throw 收敛为 path [] 单 issue，绝不外抛
      return { ok: false, issues: [makeIssue([], 'Y.Map', probe.carrier)] };
    }
    const resolve = makeRefResolver(derived); // D8：包内自建解析器（vfsl resolve 为包内部件）
    const r = walk(derived.structure.node, probe.map, [], resolve); // root 内层节点（恒非 ref）
    if (r.kind === 'issue') {
      return { ok: false, issues: [r.issue] }; // fail-fast 单 issue（F2/INV-3）
    }
    return { ok: true, snapshot: r.snapshot }; // INV-1/INV-2 已由拷贝器保证
  } catch (err) {
    // 崩溃边界（D9①）：实现缺陷/不可达输入/手造派生物 → 结构化返回，绝不外抛（INV-6）
    const detail = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      issues: [{
        message: `DOCRT-E100: 内部错误（意外异常）: ${detail}`,
        path: [],
        expected: 'internal',
        actual: 'internal',
      }],
    };
  }
}

/**
 * 节点遍历（§4.3 全景表唯一分发点）：两结局（D12）。
 * 缺失检测先行（D4：get()===undefined 视同缺席）；错位即止不下钻（INV-3）。
 */
function walk(
  node: StructureNode,
  live: unknown,
  path: Array<string | number>,
  resolve: (node: StructureNode) => StructureNode,
): WalkResult {
  switch (node.kind) {
    case 'root':
      return walk(node.node, live, path, resolve); // 探针已在入口完成（§4.7）
    case 'map': {
      if (carrierOf(live) !== 'Y.Map') return mismatch(path, 'Y.Map', live);
      const ymap = live as Y.Map<unknown>;
      const first = node.fields[0];
      if (node.fields.length === 1 && first !== undefined && first.name === '<key>') {
        // Record 形态：按 Y.Map.keys() 插入序逐动态键下钻（§4.9）；undefined 值视同缺席（D4）
        const out: Record<string, unknown> = {};
        for (const key of ymap.keys()) {
          const v = ymap.get(key);
          if (v === undefined) continue;
          const r = walk(first.node, v, [...path, key], resolve);
          if (r.kind === 'issue') return r; // fail-fast（INV-3）
          out[key] = r.snapshot;
        }
        return { kind: 'value', snapshot: out };
      }
      // 封闭对象：按字段声明序遍历（§4.9）；缺席/undefined 跳过（D4，含 optional 与 required 同等）
      const out: Record<string, unknown> = {};
      for (const f of node.fields) {
        const v = ymap.get(f.name);
        if (v === undefined) continue;
        const r = walk(f.node, v, [...path, f.name], resolve);
        if (r.kind === 'issue') return r; // 首字段错位即止（INV-3）
        out[f.name] = r.snapshot;
      }
      return { kind: 'value', snapshot: out };
    }
    case 'array': {
      if (carrierOf(live) !== 'Y.Array') return mismatch(path, 'Y.Array', live);
      const ya = live as Y.Array<unknown>;
      const out: unknown[] = [];
      for (let i = 0; i < ya.length; i++) {
        const r = walk(node.element, ya.get(i), [...path, i], resolve); // i = number 段（F3）
        if (r.kind === 'issue') return r; // fail-fast（INV-3）
        out.push(r.snapshot);
      }
      return { kind: 'value', snapshot: out };
    }
    case 'xml-fragment': {
      if (carrierOf(live) !== 'Y.XmlFragment') return mismatch(path, 'Y.XmlFragment', live);
      return { kind: 'value', snapshot: (live as Y.XmlFragment).toString() }; // D7：XML 字符串投影
    }
    case 'leaf':
    case 'plain': {
      if (carrierOf(live) !== 'plain value') return mismatch(path, 'plain value', live);
      return copyPlainValue(live, path, ''); // §4.6 深拷贝 + 值域断言（可能返回真 issue）
    }
    case 'union':
      return walkUnion(node, live, path, resolve); // §4.5（恒两结局——出口 3 内联消化）
    case 'ref':
      return walk(resolve(node), live, path, resolve); // D8
  }
}

/**
 * union 提交层仲裁（§4.5.2 唯一权威，恒两结局）：
 * 1. 首个接受者胜（any-of + 声明序，INV-8）；2. 全拒 → 声明序首个真 issue；
 * 3. 全软拒 → 回退成员 0 提交提取（结构不裁决，逻辑相位报缺必填）。
 * 判别式（node.discriminator）零读取（D5/INV-4，构造性保证）。
 */
function walkUnion(
  node: Extract<StructureNode, { kind: 'union' }>,
  live: unknown,
  path: Array<string | number>,
  resolve: (node: StructureNode) => StructureNode,
): WalkResult {
  let firstIssue: ExtractIssue | undefined; // 声明序首个真 issue（跨试验保留）
  for (const member of node.members) { // 成员声明序（§4.9）
    const t = trialMember(resolve(member), live, path, resolve);
    if (t.accept) return { kind: 'value', snapshot: t.snapshot }; // 首个接受者胜
    if (t.issue !== undefined && firstIssue === undefined) firstIssue = t.issue;
  }
  if (firstIssue !== undefined) return { kind: 'issue', issue: firstIssue }; // 全拒但有真错位
  const first = node.members[0];
  if (first === undefined) throw new Error('union 无成员（手造派生物）'); // → 崩溃边界 E100
  // 全软拒：回退成员 0 提交提取（普通 walk——缺必填从软拒还原为跳过，D4）
  return walk(resolve(first), live, path, resolve);
}

/**
 * 成员试验（§4.5.1 三结局）：第一步恒为成员根载体前置判定（R2/#5）——
 * map 形成员要求 carrierOf(live) === 'Y.Map'，封死「live 非 Y.Map 时调 Y.Map API →
 * TypeError → E100 误分类」与「全可选成员裸接受」两病态；
 * 第二步按形态分流：Record 形成员无缺失概念、试验 = 直接 walk（R2/#1）；
 * 封闭 map 形成员逐字段检查——缺必填置软标记但不中断，真 issue 立即拒；
 * 其余形态载体判定内建于其 walk，试验 = 直接 walk。
 */
function trialMember(
  member: StructureNode,
  live: unknown,
  path: Array<string | number>,
  resolve: (node: StructureNode) => StructureNode,
): TrialResult {
  if (member.kind === 'map') {
    if (carrierOf(live) !== 'Y.Map') {
      return { accept: false, issue: mismatchIssue(path, 'Y.Map', live) }; // 前置判定拒 + 真 issue
    }
    const ymap = live as Y.Map<unknown>;
    const first = member.fields[0];
    if (member.fields.length === 1 && first !== undefined && first.name === '<key>') {
      // Record 形成员：键集即在场集，无「缺失」概念——试验 = 提交提取（walk）
      const r = walk(member, live, path, resolve);
      if (r.kind === 'issue') return { accept: false, issue: r.issue };
      return { accept: true, snapshot: r.snapshot };
    }
    // 封闭 map 形成员：字段声明序扫描（软标记不遮蔽真 issue 的发现）
    const out: Record<string, unknown> = {};
    let softReject = false;
    for (const f of member.fields) {
      const v = ymap.get(f.name);
      if (v === undefined) {
        if (!f.optional) softReject = true; // 缺必填 → 软标记（仅试验层概念）
        continue;
      }
      const r = walk(f.node, v, [...path, f.name], resolve);
      if (r.kind === 'issue') return { accept: false, issue: r.issue }; // 成员内 fail-fast
      out[f.name] = r.snapshot;
    }
    if (softReject) return { accept: false };
    return { accept: true, snapshot: out };
  }
  // 其余形态（array/xml-fragment/union/leaf/plain/root；resolve 后恒非 ref）：
  // 载体判定内建于其 walk，试验 = 直接 walk（value → 接受；issue → 拒 + issue）
  const r = walk(member, live, path, resolve);
  if (r.kind === 'issue') return { accept: false, issue: r.issue };
  return { accept: true, snapshot: r.snapshot };
}

/**
 * 结构树 ref 解析（D8）：每调用局部 memo（节点引用为键，O(1) 复用）+ inFlight 环守卫。
 * 合法 derived 经 E301/E106 保证无环有名；缺名/环仅手造派生物可触达 → 抛错由顶层
 * 崩溃边界收编为 DOCRT-E100（对齐 evaluate.ts 手造 IR loud 边界）。
 */
function makeRefResolver(derived: DerivedSchema): (node: StructureNode) => StructureNode {
  const memo = new Map<StructureNode, StructureNode>();
  return function resolve(node: StructureNode): StructureNode {
    const inFlight = new Set<string>();
    let cur: StructureNode = node;
    while (cur.kind === 'ref') {
      // 环守卫先于 memo 命中判定：合法输入两序等价，手造环必须在此 loud 抛出（→ E100），
      // 而非经 memo 命中陷入无限循环（D8「递归无环守卫」意图；镜像 vfsl walkRefChain 语义）
      if (inFlight.has(cur.name)) throw new Error(`结构 ref 环（${cur.name}）`);
      const hit = memo.get(cur);
      if (hit !== undefined) {
        cur = hit;
        continue;
      }
      inFlight.add(cur.name);
      const next = derived.aliases[cur.name]; // undefined = 未声明（Object.hasOwn 语义）
      if (next === undefined) throw new Error(`结构 ref 缺名（${cur.name}）`);
      memo.set(cur, next);
      cur = next;
    }
    return cur;
  };
}

/**
 * plain 值深拷贝到纯 JSON 域（§4.6）：非 JSON 值 → 真 issue（expected 恒 'plain value'；
 * actual 为 D9② 申报词；违规内部位置线进 message 不进 path——锚定声明节点位）。
 * 可达性（§4.8 实证口径）：bigint（直存/数组内嵌/跨端）、undefined（数组元素）、
 * non-plain object（Date/类实例原型守卫）、function/symbol（plain 子树内嵌 N1–N3）、
 * Y 类型内嵌（P22，actual = 词汇表载体名）。
 */
function copyPlainValue(v: unknown, path: Array<string | number>, loc: string): WalkResult {
  if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
    return { kind: 'value', snapshot: v }; // JSON 标量直通
  }
  const nested = carrierOf(v); // 嵌套位置再分类（顶层调用方已保证 'plain value'）
  if (nested !== null && nested !== 'plain value') {
    return plainDomainIssue(path, loc, nested); // Y 类型内嵌（P22 可达）→ actual = 词汇表载体名
  }
  if (typeof v === 'bigint') {
    return plainDomainIssue(path, loc, 'bigint'); // 可达真 issue（A1/D2/E1），绝不 E100
  }
  if (Array.isArray(v)) {
    const out: unknown[] = [];
    for (let i = 0; i < v.length; i++) {
      const el = v[i];
      if (el === undefined) return plainDomainIssue(path, `${loc}[${i}]`, 'undefined'); // JSON 静默 null 化 → loud 拒绝
      const r = copyPlainValue(el, path, `${loc}[${i}]`); // 位置线下钻（R2/#8）
      if (r.kind === 'issue') return r;
      out.push(r.snapshot);
    }
    return { kind: 'value', snapshot: out };
  }
  if (typeof v === 'object') { // 走到此处必非 Y 家族（carrierOf 粗判已滤）
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) {
      // 原型守卫（R2/#3）：Date/RegExp/Map/Set/类实例 → 真 issue，禁静默投影 {}
      const ctorName = (proto as { constructor?: { name?: string } }).constructor?.name ?? 'unknown';
      return plainDomainIssue(path, loc, 'non-plain object', `constructor: ${ctorName}`);
    }
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v)) {
      const val = (v as Record<string, unknown>)[k];
      if (val === undefined) continue; // 对象键 undefined：省略（= JSON 投影 + validate present() 惯例）
      const r = copyPlainValue(val, path, `${loc}.${k}`);
      if (r.kind === 'issue') return r;
      // R2/#8：defineProperty 写键——own '__proto__' 不落原型、不触发原型 setter
      Object.defineProperty(out, k, { value: r.snapshot, writable: true, enumerable: true, configurable: true });
    }
    return { kind: 'value', snapshot: out };
  }
  // function/symbol：plain 子树内嵌可达真 issue（N1–N3；R2.1/R-2 改判入可达组）
  return plainDomainIssue(path, loc, typeof v === 'function' ? 'function' : 'symbol');
}

/** plain 域违规 issue（D9② 申报词；位置线进 message，path 锚定声明节点）。 */
function plainDomainIssue(path: Array<string | number>, loc: string, word: string, extra?: string): WalkResult {
  const at = loc === '' ? '' : `，内部位置 ${loc}`;
  const extraPart = extra === undefined ? '' : `（${extra}）`;
  return {
    kind: 'issue',
    issue: {
      message: `纯值域违规（${renderPath(path)}${at}）：期望 plain value（JSON 值域），实际 ${word}${extraPart}`,
      path,
      expected: 'plain value',
      actual: word,
    },
  };
}

/** 载体错位 issue 构造（message 措辞自由域，F7 仅要求非空；模板统一便于日志检索）。 */
function makeIssue(path: Array<string | number>, expected: string, actual: string): ExtractIssue {
  return {
    message: `Yjs 载体错位（${renderPath(path)}）：期望 ${expected}，实际 ${actual}`,
    path,
    expected,
    actual,
  };
}

/** 错位 → WalkResult（actual 由 carrierOf 重判；null 不可达态 → 崩溃边界 E100）。 */
function mismatch(path: Array<string | number>, expected: string, live: unknown): WalkResult {
  return { kind: 'issue', issue: mismatchIssue(path, expected, live) };
}

/** 错位 → 直接取 issue（union 前置判定复用同款构造，R2/#5）。 */
function mismatchIssue(path: Array<string | number>, expected: string, live: unknown): ExtractIssue {
  const actual = carrierOf(live);
  if (actual === null) {
    // 不可达态（D9①）：undefined 被 D4 先行拦截、function/symbol 直接位 set 期即抛、
    // AbstractType 第五类变体公共写入路径造不出——到达即实现/环境缺陷信号
    throw new Error('载体判定不可达态（carrierOf 返回 null）');
  }
  return makeIssue(path, expected, actual);
}

/** path 渲染仅用于 message 文本（ADR-0007 禁的是 issue.path 的点号表示，不禁文本渲染）。 */
function renderPath(path: Array<string | number>): string {
  return path.length === 0 ? 'ROOT'
    : path.reduce<string>(
      (acc, seg) => (typeof seg === 'number' ? `${acc}[${seg}]` : `${acc}.${String(seg)}`),
      'ROOT',
    );
}
