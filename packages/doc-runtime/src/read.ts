/**
 * @nomicore/doc-runtime — readLogicalValueAtPath(derived, doc, path)（ADR-0007 / issue #75）：
 * 同步按路径读取 Yjs 子树逻辑值。
 *
 * 设计 §3/§4（wiki/raw/task_read-logical-value-at-path_design.md）：
 * - 两阶段模型（D1）：Phase A 纯 schema 许可判定（零 doc 访问、presence-independent），
 *   Phase B 活数据解析 + 定点转换（复用 extract.ts walk，D7——单一转换语义源）；
 * - 导航权威 = 结构树 + ref 解析器（D2，弃用 derived.index）；Record keyPattern = values
 *   树锁步双游标 + vfsl pattern 引擎（D3，compilePattern/matchPattern 公共接缝）；
 * - union 导航 = any-of 逐成员活导航、声明序首个真实 value 胜（D4/rev1 D17 精确化：
 *   missing 不胜出、仅记账继续后序成员）；Phase B 对 Record 键
 *   有意零 keyPattern 检查（D15/R1，与 extract walkUnion 零消费纪律同源）；
 * - 合法缺键（optional/Record 键/非负整数越界）= 吸收式 undefined（D8）；
 * - 失败单通道（D5/D6）：C1/C2/C3 一律 { ok:false, code:'PATH_NOT_ALLOWED', path, message? }，
 *   顶层崩溃边界绝不外抛（D11，对齐 extract INV-6）；
 * - per-call 局部 memo（D13）：Phase A 键 (resolve 后节点引用, i)、Phase B 键 (节点引用,
 *   live 引用, i)，把重叠联合最坏 2^n 回溯折叠为多项式；patternCache 同为 per-call
 *   局部（R6/INV-11，模块级零可变态）。
 */
import type * as Y from 'yjs';
import type { DerivedSchema, StructureNode, ValueField, ValueSchema } from '@nomicore/vfsl';
import { compilePattern, matchPattern } from '@nomicore/vfsl';
import type { CompiledPattern } from '@nomicore/vfsl';
import { carrierOf, probeRoot } from './carrier.js';
import { makeRefResolver, walk } from './extract.js';

/**
 * readLogicalValueAtPath 结果联合（SA6 冻结形态 + message 纯增补，D5）。
 * - ok:true 恒携带 value（成功 = 目标子树普通值副本；合法缺键 = value 显式为 undefined，FC-3）；
 * - ok:false 恒携带 code:'PATH_NOT_ALLOWED' 与 path（整条尝试路径回显，fail-fast 单错）；
 * - message?：诊断增补字段（非契约字段，应用逻辑不得依赖——归日志/诊断面消费；R4）。
 */
export type ReadLogicalValueResult =
  | { ok: true; value: unknown }
  | { ok: false; code: 'PATH_NOT_ALLOWED'; path: readonly (string | number)[]; message?: string };

/**
 * 同步按路径读取目标子树逻辑值（ADR-0007）。同步、不抛错（FC-1/INV-3）。
 * 编排：Phase A 谓词先行（D14/R3——被拒路径零 doc 触碰，含零惰性创建）→ probeRoot
 * 后置（只碰 'ROOT'，INV-7）→ Phase B 活数据解析 + 定点转换（D7 复用 walk）。
 */
export function readLogicalValueAtPath(
  derived: DerivedSchema,
  doc: Y.Doc,
  path: readonly (string | number)[],
): ReadLogicalValueResult {
  try {
    if (derived.structure.kind !== 'root') {
      // 手造派生物守卫（对齐 extract L53）→ C3 崩溃边界
      throw new Error('derived.structure 非 root（手造派生物）');
    }
    const resolveS = makeRefResolver(derived); // 复用 extract D8 解析器（环守卫 + memo）
    const resolveV = makeValuesResolver(derived.values); // values 树专用解析器（同款环守卫，§4.3）
    const patternCache = new Map<string, CompiledPattern>(); // R6：per-call 局部（禁模块级可变态）
    const memoA: Map<StructureNode, Map<number, boolean>> = new Map(); // R2/D13：Phase A memo
    const memoB: Map<StructureNode, Map<unknown, Map<number, NavOutcome>>> = new Map(); // R2/D13：Phase B memo

    // Phase A 先行（R3/D14）：纯 schema 许可判定——被拒路径零 doc 触碰（含零惰性创建）
    if (
      !isPathAllowed(
        derived.structure.node,
        derived.values['ROOT'],
        path,
        0,
        resolveS,
        resolveV,
        patternCache,
        memoA,
      )
    ) {
      return notAllowed(path, '路径不被 schema 允许'); // C1——此刻 doc 未被触碰（INV-10）
    }
    // probeRoot 后置（R3/D14）：Phase A 通过后才触碰 doc（INV-7：只碰 'ROOT'；唯一触碰 doc 的入口）
    const probe = probeRoot(doc);
    if (probe.carrier !== 'Y.Map') {
      return notAllowed(path, 'ROOT 载体非 Y.Map（不变量外输入）'); // C2：整树不可读（open 期必已被拒）
    }
    // Phase B：活数据解析 + 定点转换（rev1：三态收束到冻结两态公共联合）
    const r = resolveLive(derived.structure.node, probe.map, path, 0, resolveS, path, memoB);
    if (r.kind === 'value') return { ok: true, value: r.value }; // FC-3：value 键恒显式构造
    if (r.kind === 'missing') return { ok: true, value: undefined }; // rev1：合法缺席（FC-3 同款显式构造）
    return notAllowed(path, '路径无法在 live 数据上解析（不变量外输入）'); // rev1：reject → C2 单通道（D6 不变）
  } catch (err) {
    // 崩溃边界（D11，对齐 extract §4.8）：一切异常（含手造派生物/lockstep 断裂/pattern 引擎
    // throw/深递归 RangeError）统一 C3，绝不外抛（FC-1）
    const detail = err instanceof Error ? err.message : String(err);
    return notAllowed(path, `DOCRT-E100: 内部错误（意外异常）: ${detail}`);
  }
}

/**
 * 统一失败构造：path 回显整条尝试路径的**新鲜副本**（不别名调用方数组）；message 恒非空。
 * SA4-F2 勘误守卫（强制）：catch 路径上 path 可能是**非数组**——JS/运行时动态调用方传入
 * null/undefined/number 等不可展开值时，Phase A 的 `segs.length` 已抛 TypeError 进入顶层
 * catch，此时无守卫的 `[...path]` 会在 **catch 块内部二次抛出**（TypeError: path is not
 * iterable），逃逸公共函数，击穿 FC-1「同步、不抛错」/INV-3/D11「收编一切异常」承诺
 * （SA4 已实测复现）。守卫将一切类型外 path 归一为 `[]`：裸 string 等可迭代类型外值
 * （`'zz'` 曾被拆分为 `['z','z']` 回显——SA4 N2）同样归一，消除怪异回显。
 * 「收编者自身无抛点」闭环（设计勘误复检）：全函数任意 `[...path]`/`[...fullPath]`
 * 展开点均在 try 内 → 顶层 catch → 本守卫构造返回，绝不外抛（FC-1）。
 */
function notAllowed(path: unknown, message: string): ReadLogicalValueResult {
  const safePath: Array<string | number> = Array.isArray(path) ? [...path] : []; // SA4-F2 守卫
  return { ok: false, code: 'PATH_NOT_ALLOWED', path: safePath, message };
}

// —— Phase A：纯 schema 许可判定（D1/D14，零 doc 访问）——

/** 段合法形态谓词（D9）：map/Record 段必须 string。 */
function validMapSeg(seg: unknown): seg is string {
  return typeof seg === 'string';
}

/** 段合法形态谓词（D9）：array 段必须非负整数（-0：-0>=0 为 true，属性访问语义归一为 0）。 */
function validArraySeg(seg: unknown): boolean {
  return typeof seg === 'number' && Number.isInteger(seg) && seg >= 0;
}

/** Record 形态判别（extract.ts L100 同款）：单 '<key>' 字段。 */
function isRecordForm(node: Extract<StructureNode, { kind: 'map' }>): boolean {
  const first = node.fields[0];
  return node.fields.length === 1 && first !== undefined && first.name === '<key>';
}

/**
 * 纯 schema 许可判定：结构树游标 + values 锁步游标沿 segs[i..] 下钻。
 * 只回答「schema 是否允许这条路径」，不看任何 live 数据（presence-independent，D1）。
 * R2/D13：入口/出口为 memo 挂点（键 = resolve 后节点对象引用 + 深度 i）——重叠联合最坏
 * 2^n 回溯折叠为多项式（健全性：同节点对象恒对应同一 values 游标，与到达路径无关，§4.3）。
 */
function isPathAllowed(
  node: StructureNode,
  vCursor: ValueSchema | undefined,
  segs: readonly (string | number)[],
  i: number,
  resolveS: (node: StructureNode) => StructureNode,
  resolveV: (v: ValueSchema | undefined) => ValueSchema,
  pc: Map<string, CompiledPattern>,
  memo: Map<StructureNode, Map<number, boolean>>,
): boolean {
  node = resolveS(node); // ref 链解析（含环守卫）；memo 键取 resolve 后节点
  const hit = memo.get(node)?.get(i);
  if (hit !== undefined) return hit; // R2：同一 (节点, 深度) 结果确定
  const out = decide(node, vCursor, segs, i, resolveS, resolveV, pc, memo);
  let byDepth = memo.get(node);
  if (byDepth === undefined) {
    byDepth = new Map();
    memo.set(node, byDepth);
  }
  byDepth.set(i, out);
  return out;
}

/** decide = isPathAllowed 的 switch 分发体（下钻一律递归回 isPathAllowed 入口，保 memo 挂点）。 */
function decide(
  node: StructureNode,
  vCursor: ValueSchema | undefined,
  segs: readonly (string | number)[],
  i: number,
  resolveS: (node: StructureNode) => StructureNode,
  resolveV: (v: ValueSchema | undefined) => ValueSchema,
  pc: Map<string, CompiledPattern>,
  memo: Map<StructureNode, Map<number, boolean>>,
): boolean {
  if (i === segs.length) return true; // 路径耗尽 = 目标节点本身恒许可
  const seg = segs[i]!; // noUncheckedIndexedAccess 纪律
  switch (node.kind) {
    case 'root':
      return isPathAllowed(node.node, vCursor, segs, i, resolveS, resolveV, pc, memo);
    case 'map': {
      if (!validMapSeg(seg)) return false; // number 段上 map/Record（D9）
      const first = node.fields[0]!;
      if (isRecordForm(node)) {
        const vObj = resolveV(vCursor); // 锁步：Record 位 values 必为 object（断裂 → throw → C3）
        if (vObj.kind !== 'object') throw new Error(`lockstep 断裂：Record 位 values=${vObj.kind}`);
        if (vObj.keyPattern !== undefined && !keyAllowed(vObj.keyPattern, seg, pc)) return false; // D3 引擎；许可 = any-of 并集语义（D15/R1，§4.5）
        return isPathAllowed(first.node, vChild(vObj, '<key>'), segs, i + 1, resolveS, resolveV, pc, memo);
      }
      const vObj = resolveV(vCursor);
      if (vObj.kind !== 'object') throw new Error(`lockstep 断裂：map 位 values=${vObj.kind}`);
      const f = node.fields.find((x) => x.name === seg);
      if (f === undefined) return false; // 未知封闭字段（AC2 用例 4）
      return isPathAllowed(f.node, vChild(vObj, seg), segs, i + 1, resolveS, resolveV, pc, memo);
    }
    case 'array': {
      if (!validArraySeg(seg)) return false; // 负数/非整数/字符串下标（AC4 用例 11-13）
      const vArr = resolveV(vCursor);
      if (vArr.kind !== 'array') throw new Error(`lockstep 断裂：array 位 values=${vArr.kind}`);
      return isPathAllowed(node.element, vArr.element, segs, i + 1, resolveS, resolveV, pc, memo);
    }
    case 'union': {
      // 纯 schema any-of（ADR-0003 存在性语义）：路径存在性为任一成员出现即存在
      const vu = resolveV(vCursor);
      if (vu.kind !== 'union') throw new Error(`lockstep 断裂：union 位 values=${vu.kind}`);
      return node.members.some((m, idx) =>
        isPathAllowed(m, vu.members[idx]!, segs, i, resolveS, resolveV, pc, memo)); // 成员序同源（IR 同构）
    }
    case 'leaf':
    case 'plain':
    case 'xml-fragment':
      return false; // 终态下钻（AC5；plain 元素级读取 D10）
    case 'ref':
      throw new Error('不可达：ref 应已由 resolveS 解析（手造派生物）'); // → C3 崩溃边界（防御）
  }
}

/**
 * values 树 ref 解析（§4.3 锁步表「ref name」行）：镜像 makeRefResolver 的环守卫 + memo。
 * undefined 游标（values 表缺位，手造派生物）= lockstep 断裂 → throw → C3。
 */
function makeValuesResolver(values: Record<string, ValueSchema>): (v: ValueSchema | undefined) => ValueSchema {
  const memo = new Map<ValueSchema, ValueSchema>();
  return function resolveV(v: ValueSchema | undefined): ValueSchema {
    const inFlight = new Set<string>();
    let cur: ValueSchema | undefined = v;
    while (cur !== undefined && cur.kind === 'ref') {
      // 环守卫先于 memo 命中判定（镜像 makeRefResolver D8 语义）：合法输入两序等价，手造环必须 loud 抛出
      if (inFlight.has(cur.name)) throw new Error(`values ref 环（${cur.name}）`);
      const hit = memo.get(cur);
      if (hit !== undefined) {
        cur = hit;
        continue;
      }
      inFlight.add(cur.name);
      const next = values[cur.name]; // undefined = 未声明（Object.hasOwn 语义）
      if (next === undefined) throw new Error(`values ref 缺名（${cur.name}）`);
      memo.set(cur, next);
      cur = next;
    }
    if (cur === undefined) throw new Error('values 游标为空（手造派生物：values 表缺位）');
    return cur;
  };
}

/**
 * 取 object 字段的 values 子树：optional 解包 → 按名取字段（ref 解析由消费点 resolveV 承担）。
 * 任一步落空（字段缺失 / 非 object 形）= lockstep 断裂 → throw → C3 崩溃边界（禁静默降级）。
 */
function vChild(vObj: { kind: 'object'; fields: ValueField[] }, name: string): ValueSchema {
  const f = vObj.fields.find((x) => x.name === name);
  if (f === undefined) throw new Error(`lockstep 断裂：values 无字段 ${name}`);
  return f.value.kind === 'optional' ? f.value.value : f.value; // optional 解包（结构 optional ↔ values {kind:'optional'} 包装）
}

/**
 * keyPattern 判定（D3 引擎）：R6——pc 为 readLogicalValueAtPath 函数体内创建的 per-call 局部
 * Map（禁模块级可变态，对齐 validate compileOrCache per-ctx 纪律）。编译错/预算耗尽 →
 * throw → 顶层 catch → C3（DOCRT-E100 前缀；fail-closed，非「不匹配」——R4 统一裁定）。
 */
function keyAllowed(regex: string, key: string, pc: Map<string, CompiledPattern>): boolean {
  let compiled = pc.get(regex);
  if (compiled === undefined) {
    compiled = compilePattern(regex);
    pc.set(regex, compiled);
  }
  return matchPattern(compiled, key); // R5：双参薄包装（charge no-op 已封进包装，§4.7）
}

// —— Phase B：活数据解析 + 定点转换（T7 吸收式缺键）——

/**
 * 活导航三态结局（rev1/D16，AC-R1；owner 建议形态逐字采纳；包内私有类型——
 * 公共结果联合冻结为两态，missing/reject 不得泄漏（INV-14，SA8 注记 3））：
 * - value  = 实际产出：路径耗尽处 walk 快照（恒非 undefined，见完备性论证）或中段不下钻场景不产此态；
 * - missing = 合法缺席：且仅由三源产生（Record 缺键 / optional 缺席 / 非负整数越界，D8 三源）；
 * - reject = 本分支拒绝：段型不符 / 载体错位 / required 缺席 / 成员无此字段 / 终点 walk issue。
 */
type NavOutcome =
  | { kind: 'value'; value: unknown }
  | { kind: 'missing' }
  | { kind: 'reject' };

/**
 * R2/D13：入口/出口为 memo 挂点（键 = resolve 后节点引用 + live 引用 + 深度 i；健全性
 * 论证 §4.3：导航只依赖这三者与 segs[i..]，live 原始值按值作键、Yjs 对象按引用作键）。
 */
function resolveLive(
  node: StructureNode,
  live: unknown,
  segs: readonly (string | number)[],
  i: number,
  resolveS: (node: StructureNode) => StructureNode,
  fullPath: readonly (string | number)[],
  memo: Map<StructureNode, Map<unknown, Map<number, NavOutcome>>>,
): NavOutcome {
  node = resolveS(node);
  const hit = memo.get(node)?.get(live)?.get(i);
  if (hit !== undefined) return hit;
  const out = navigate(node, live, segs, i, resolveS, fullPath, memo);
  let byLive = memo.get(node);
  if (byLive === undefined) {
    byLive = new Map();
    memo.set(node, byLive);
  }
  let byDepth = byLive.get(live);
  if (byDepth === undefined) {
    byDepth = new Map();
    byLive.set(live, byDepth);
  }
  byDepth.set(i, out);
  return out;
}

/** navigate = resolveLive 的 switch 分发体（下钻一律递归回 resolveLive 入口，保 memo 挂点）。 */
function navigate(
  node: StructureNode,
  live: unknown,
  segs: readonly (string | number)[],
  i: number,
  resolveS: (node: StructureNode) => StructureNode,
  fullPath: readonly (string | number)[],
  memo: Map<StructureNode, Map<unknown, Map<number, NavOutcome>>>,
): NavOutcome {
  if (i === segs.length) {
    // 路径耗尽：定点转换（D7 复用 extract.ts 同一 walk——union 试验/plain 拷贝/安全写入全在闭环内）
    const r = walk(node, live, [...fullPath], resolveS);
    return r.kind === 'issue' ? { kind: 'reject' } // rev1：终点 issue = reject
                              : { kind: 'value', value: r.snapshot }; // rev1：快照恒非 undefined（INV-12）
  }
  const seg = segs[i]!;
  switch (node.kind) {
    case 'root':
      return resolveLive(node.node, live, segs, i, resolveS, fullPath, memo);
    case 'map': {
      if (typeof seg !== 'string') return { kind: 'reject' }; // rev1：段型不符（D9 自校验义务不变）
      if (carrierOf(live) !== 'Y.Map') return { kind: 'reject' }; // rev1：载体错位（C2/成员回退）
      const ymap = live as Y.Map<unknown>;
      const first = node.fields[0]!;
      if (isRecordForm(node)) {
        // D15/R1 不变：Phase B 有意零 keyPattern 检查（§4.5 反例走查仍成立，本修订不触）
        const v = ymap.get(seg);
        if (v === undefined) return { kind: 'missing' }; // rev1：Record 缺键（D8 三源之一）
        return resolveLive(first.node, v, segs, i + 1, resolveS, fullPath, memo);
      }
      const f = node.fields.find((x) => x.name === seg);
      if (f === undefined) return { kind: 'reject' }; // rev1：本成员无此字段（D15/D18）
      const v = ymap.get(seg);
      if (v === undefined) {
        return f.optional ? { kind: 'missing' } // rev1：optional 缺席（D8 三源之一）
                          : { kind: 'reject' }; // rev1：required 缺席（C2，三分法不变）
      }
      return resolveLive(f.node, v, segs, i + 1, resolveS, fullPath, memo);
    }
    case 'array': {
      if (typeof seg !== 'number' || !Number.isInteger(seg) || seg < 0) return { kind: 'reject' }; // rev1（D9）
      if (carrierOf(live) !== 'Y.Array') return { kind: 'reject' }; // rev1
      const ya = live as Y.Array<unknown>;
      if (seg >= ya.length) return { kind: 'missing' }; // rev1：非负整数越界（D8 三源之一）
      return resolveLive(node.element, ya.get(seg), segs, i + 1, resolveS, fullPath, memo);
    }
    case 'union': {
      // rev1/D17：value-first 仲裁（AC-R2 四规则；INV-7 精确化——声明序迭代不变）
      let sawMissing = false;
      for (const m of node.members) { // 声明序（INV-7，零改动）
        const r = resolveLive(m, live, segs, i, resolveS, fullPath, memo);
        if (r.kind === 'value') return r; // 规则 1：首个真实 value 胜出
        if (r.kind === 'missing') sawMissing = true; // 规则 2：missing 不胜出，继续后序成员
      }
      return sawMissing ? { kind: 'missing' } : { kind: 'reject' }; // 规则 3/4 + mixed 优先级（§3.3）
    }
    case 'leaf':
    case 'plain':
    case 'xml-fragment':
      return { kind: 'reject' }; // rev1：终态下钻（Phase A 已拒，防御）
    case 'ref':
      throw new Error('不可达：ref 应已由 resolveS 解析（手造派生物）'); // → C3 崩溃边界（防御）
  }
}
