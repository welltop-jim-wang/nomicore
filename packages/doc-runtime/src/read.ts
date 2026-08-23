/**
 * @nomicore/doc-runtime — readLogicalValueAtPath(doc, path)（ADR-0008 / issue #86）：
 * schema-independent 载体驱动投影读取——读取只依据 live Y.Doc 中的实际 Yjs/plain 载体
 * 转换目标子树，返回隔离的普通逻辑值（不依赖任何 VFSL/派生 schema）。
 *
 * 设计 §2–§4（wiki/raw/task_doc-runtime-root-carrier-projection-read_design.md）：
 * - 两阶段载体模型：G0 path 形态守卫 + N0 ROOT 探针（复用 carrier.ts probeRoot，唯一
 *   触碰 doc 的入口，只碰 'ROOT'）→ N1 导航循环（段纪律 D3 + 缺席吸收 D4 +
 *   不可下钻 C1/C2/C3）→ P1 定点投影 projectValue/copyPlainStrict（D6 双递归）；
 * - D2 两层分类器 navClassify：carrierOf 粗判 + read.ts 内部细判（ymap/yarray/xml/text/
 *   unknownShared/detached/plainObject/plainArray/scalar/nonPlainObject/violation）；
 *   其中 detached 守卫（R2 #2，INV-R13）：Yjs 家族载体 `v.doc === null`（未集成 doc）
 *   → 导航与投影一律响亮失败，封死「ok:true 空投影 + console.warn 噪声 + XML 内容
 *   静默蒸发」通道；
 * - D3 段纪律：map/object 必须 string 段，array 必须严格非负整数段（-0 合法归一 0；
 *   段从不拆分、从不解释，点号/空格是合法键名）；
 * - D4 缺席语义：Y.Map/plain object 缺键与 undefined 值、数组越界 → ok:true undefined
 *   （中间缺失立即结束）；数组在界 undefined（含空洞）→ 响亮失败（位置语义不可省略）；
 * - D5 键空间模型：导航与投影共用 readableOwnDataValue（own enumerable **data**
 *   property，descriptor 读零 accessor 执行，INV-R4/R5/R11）——accessor/non-enumerable/
 *   原型链/symbol 键一律键空间外 ≡ 缺席；readableArrayElement 同款 descriptor 纪律；
 * - D6 投影：Yjs 容器递归（projectValue）+ plain 域拷贝（copyPlainStrict，JSON 值域
 *   纪律：bigint/non-finite/数组 undefined/嵌套 Yjs/非 plain 原型 → 响亮失败）；
 *   输出键写入 defineProperty 四描述符全 true（INV-R7，不 freeze）；
 * - 失败单通道（D8/INV-R1/R2）：一切预期失败与崩溃边界（E100）统一
 *   { ok:false, code:'PATH_NOT_ALLOWED', path: 新鲜副本, message }，同步、不抛错；
 * - 模块级零可变态、零 memo、零订阅（INV-R9/R10）；成本 O(path + 目标子树)（INV-R12）。
 *
 * 注：projectValue/copyPlainStrict 的失败侧一律为判别联合 ProjectOutcome（禁 null/
 * undefined 哨兵——null 是合法投影值，R2 #1）。
 */
import * as Y from 'yjs';
import { carrierOf, probeRoot } from './carrier.js';

/**
 * readLogicalValueAtPath 结果联合（SA6 冻结形态 + message 纯增补，D5）。
 * - ok:true 恒携带 value（成功 = 目标子树普通值深拷贝；合法缺键 = value 显式为
 *   undefined，FC-3/INV-R3）；
 * - ok:false 恒携带 code:'PATH_NOT_ALLOWED' 与 path（整条尝试路径回显，fail-fast 单错；
 *   path 为调用方数组的新鲜副本，不别名）；SA4-F2 守卫：非数组 path 归一为 []；
 * - message?：诊断增补字段（非契约字段，应用逻辑不得依赖——归日志/诊断面消费）。
 */
export type ReadLogicalValueResult =
  | { ok: true; value: unknown }
  | { ok: false; code: 'PATH_NOT_ALLOWED'; path: readonly (string | number)[]; message?: string };

/**
 * 同步按路径读取目标子树逻辑值（ADR-0008）。同步、不抛错（INV-R1）。
 * 编排：G0 形态守卫 → N0 probeRoot（只碰 'ROOT'，INV-R8/R9）→ N1 导航循环 →
 * P1 定点投影；全程包在顶层 try/catch（崩溃边界 E100，D10/D8）。
 */
export function readLogicalValueAtPath(
  doc: Y.Doc,
  path: readonly (string | number)[],
): ReadLogicalValueResult {
  try {
    // G0 — SA4-F2 守卫前置：非数组 path 归一失败（绝不把垃圾输入当空 path 读全 ROOT）；
    // message 带 DOCRT-E100 前缀（与旧实现 G0 守卫可观测行为逐字一致，guards 前缀锚）
    if (!Array.isArray(path)) {
      return notAllowed(path, 'DOCRT-E100: path 必须是段数组（readonly (string | number)[]）');
    }

    // N0 — ROOT 探针（唯一 doc 触碰入口，INV-R8：只碰 'ROOT'；INV-R9：零写入零事件）
    const probe = probeRoot(doc); // throw → E100（第四级全失败，D9）
    if (probe.carrier !== 'Y.Map') {
      return notAllowed(path, `ROOT 载体非 Y.Map（实际 ${probe.carrier}）`); // C4
    }

    // N1 — 导航循环（段纪律 D3 + 缺席吸收 D4 + 不可下钻 C1/C2/C3）
    let cur: unknown = probe.map;
    for (let i = 0; i < path.length; i++) {
      const seg = path[i] as unknown; // 运行时野段（symbol 等）由下游 typeof 判拒，零抛点
      const c = navClassify(cur); // D2 两层分类器（Yjs 家族含 detached 前置判别）
      switch (c.k) {
        case 'ymap': {
          if (typeof seg !== 'string') return notAllowed(path, segMsg(i, seg, 'Y.Map', 'string')); // C1
          const v = c.v.get(seg);
          if (v === undefined) return okUndefined(); // 缺键/显式 undefined 一律吸收（D4）——中间缺失立即结束
          cur = v;
          break;
        }
        case 'yarray': {
          if (!isNonNegInt(seg)) return notAllowed(path, segMsg(i, seg, 'Y.Array', '非负整数')); // C1
          if (seg >= c.v.length) return okUndefined(); // 越界吸收（D4）
          const v = c.v.get(seg);
          if (v === undefined) return notAllowed(path, '数组位置 undefined 不可导航'); // 防御（attached 公共 API 不可达，探针 A1/E21）
          cur = v;
          break;
        }
        case 'plainObject': {
          if (typeof seg !== 'string') return notAllowed(path, segMsg(i, seg, 'plain object', 'string')); // C1
          const hit = readableOwnDataValue(c.v, seg); // D5 键空间助手（descriptor 读，零 accessor 执行）
          if (!hit.hit) return okUndefined(); // 键空间外 ≡ 缺席（D4/D5）
          cur = hit.value;
          break;
        }
        case 'plainArray': {
          if (!isNonNegInt(seg)) return notAllowed(path, segMsg(i, seg, 'plain array', '非负整数')); // C1
          const hit = readableArrayElement(c.v, seg); // D5（descriptor 守卫）
          if (hit.kind === 'none') return okUndefined(); // 越界吸收
          if (hit.kind === 'violation') return notAllowed(path, hit.msg); // 空洞/undefined 元素/accessor 下标 → C3（D4）
          cur = hit.value;
          break;
        }
        case 'xml':
          return notAllowed(path, 'Y.XmlFragment 是不可下钻终态（语义字符串）'); // C2（AC5 锚定）
        case 'text':
          return notAllowed(path, '未知 Yjs shared type（Y.Text 家族）不可下钻——无 toJSON fallback'); // C3
        case 'unknownShared':
          return notAllowed(path, `未知 Yjs shared type（${c.word}）不可下钻——无 toJSON fallback`); // C3
        case 'detached':
          return notAllowed(path, `detached Yjs 载体（${c.word}，未集成 doc）不可读——拒绝静默空投影`); // R2 #2（C3）
        case 'scalar':
          return notAllowed(path, '标量不可作为容器'); // C2（AC2 锚定）
        case 'nonPlainObject':
          return notAllowed(path, '非 plain 原型对象不可下钻'); // C3
        case 'violation':
          return notAllowed(path, c.msg); // bigint/function/symbol/undefined 出现在路径上 → C3
      }
    }

    // P1 — 定点投影（路径耗尽，D6 双递归）。ProjectOutcome 判别联合——禁 null/undefined
    // 哨兵（null 是合法投影值：fixture nothing:null / arr[3]===null）
    const r = projectValue(cur);
    if (r.kind === 'fail') return notAllowed(path, r.msg); // C3 透传
    return { ok: true, value: r.v }; // INV-R3：value 键恒显式构造（r.v 可为合法 null）
  } catch (err) {
    // 崩溃边界 E100（D10 含 RangeError 循环引用；E22 Proxy trap throw 收编）
    const detail = err instanceof Error ? err.message : String(err);
    return notAllowed(path, `DOCRT-E100: 内部错误（意外异常）: ${detail}`);
  }
}

// —— 公共失败/成功构造（D8/INV-R2/R3）——

/**
 * 统一失败构造：path 回显整条尝试路径的**新鲜副本**（不别名调用方数组）；message 恒非空。
 * SA4-F2 勘误守卫（强制）：catch 路径上 path 可能是非数组——无守卫的 `[...path]`
 * 会在 catch 块内部二次抛出，击穿「同步不抛错」（INV-R1）；类型外输入一律归一为 []。
 */
function notAllowed(path: unknown, message: string): ReadLogicalValueResult {
  const safePath: Array<string | number> = Array.isArray(path) ? [...path] : [];
  return { ok: false, code: 'PATH_NOT_ALLOWED', path: safePath, message };
}

/** 合法缺席/合法空值形态：value 键恒显式存在（FC-3/INV-R3）。 */
function okUndefined(): ReadLogicalValueResult {
  return { ok: true, value: undefined };
}

// —— N1 助手：载体细分类（D2 两层分类器）——

/** 段合法形态谓词（D3）：array 段必须严格非负整数（-0：-0>=0 为 true，归一 0）。 */
function isNonNegInt(seg: unknown): seg is number {
  return typeof seg === 'number' && Number.isInteger(seg) && seg >= 0;
}

/** 段型不符诊断消息（C1；message 非契约字段）。 */
function segMsg(i: number, seg: unknown, carrier: string, expected: string): string {
  return `第 ${i} 段 ${String(seg)} 与 ${carrier} 载体不符（期望 ${expected}）`;
}

/** Yjs 家族申报词（message 用）：取构造器名，兜底 Y.AbstractType。 */
function yjsWord(v: unknown): string {
  const ctor = (v as { constructor?: { name?: string } } | null | undefined)?.constructor?.name;
  return typeof ctor === 'string' && ctor.length > 0 ? ctor : 'Y.AbstractType';
}

/**
 * plain 记录判据（原型链级，冻结 AC3 fixture 实证：`protoObj` 带自定义 plain 中继原型
 * 链——`Object.create(proto)` 且链上各节点均为 plain 对象——仍须投影为 `{own:'v'}`；
 * 而 Date/类实例必须 loud）。判定：沿原型链上溯（带上限防循环），链上每个非
 * Object.prototype 节点的 own `constructor` 必须是缺失的（继承 Object）或为
 * Object/undefined——任一节点自有构造函数（Date/Map/Set/RegExp/类）→ 非 plain。
 * 全程 descriptor 读：零 getter/accessor 执行（INV-R4），零原型链 [[Get]]。
 */
function isPlainRecord(v: object): boolean {
  let cur: object | null = v;
  for (let depth = 0; depth < 32; depth++) {
    const proto = Object.getPrototypeOf(cur);
    if (proto === null) return true; // Object.prototype 或 null-proto 链尾
    if (proto !== Object.prototype) {
      const desc = Object.getOwnPropertyDescriptor(proto, 'constructor');
      if (desc !== undefined) {
        if (desc.get !== undefined || desc.set !== undefined) return false;
        if (typeof desc.value === 'function' && desc.value !== (Object as unknown)) return false;
      }
    }
    cur = proto;
  }
  return false; // 超深/循环链 → 保守 loud
}

/** 导航载体词汇表（D2 表格的机械翻译；Yjs 家族前置 detached 判别，R2 #2）。 */
type NavCarrier =
  | { k: 'ymap'; v: Y.Map<unknown> }
  | { k: 'yarray'; v: Y.Array<unknown> }
  | { k: 'xml'; v: Y.XmlFragment }
  | { k: 'text'; v: Y.Text }
  | { k: 'unknownShared'; v: Y.AbstractType<any>; word: string }
  | { k: 'detached'; v: Y.AbstractType<any>; word: string }
  | { k: 'plainObject'; v: Record<string, unknown> }
  | { k: 'plainArray'; v: unknown[] }
  | { k: 'scalar'; v: unknown }
  | { k: 'nonPlainObject'; v: object }
  | { k: 'violation'; v: unknown; msg: string };

function navClassify(v: unknown): NavCarrier {
  // detached 前置（R2 #2）：Yjs 家族且未集成 doc（v.doc === null，O(1) 属性读）→ 响亮失败，
  // 导航与投影一律拒之（不可借道/不可下钻）——INV-R13
  if (v instanceof Y.AbstractType) {
    if ((v as { doc: unknown }).doc === null) return { k: 'detached', v, word: yjsWord(v) };
  }
  switch (carrierOf(v)) {
    case 'Y.Map':
      return { k: 'ymap', v: v as Y.Map<unknown> };
    case 'Y.Array':
      return { k: 'yarray', v: v as Y.Array<unknown> };
    case 'Y.XmlFragment':
      return { k: 'xml', v: v as Y.XmlFragment };
    case 'Y.Text':
      return { k: 'text', v: v as Y.Text };
    case 'plain value':
      if (Array.isArray(v)) return { k: 'plainArray', v };
      if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        return { k: 'scalar', v };
      }
      if (typeof v === 'bigint') return { k: 'violation', v, msg: 'bigint 值出现在路径上（值域违规）' };
      if (typeof v === 'object') {
        // plain 记录判据（D2 修订：原型链级，见 isPlainRecord——冻结 AC3 fixture 的
        // protoObj 带自定义 plain 中继原型链仍须投影；Date/类实例 → nonPlainObject）
        if (isPlainRecord(v)) {
          return { k: 'plainObject', v: v as Record<string, unknown> };
        }
        return { k: 'nonPlainObject', v };
      }
      return { k: 'violation', v, msg: `值域违规（路径上）：${typeof v}` };
    default: {
      // carrierOf === null：AbstractType 第五类变体（已处理 detached）或 undefined/function/symbol
      if (v instanceof Y.AbstractType) return { k: 'unknownShared', v, word: yjsWord(v) };
      return { k: 'violation', v, msg: `值域违规（路径上）：${typeof v}` };
    }
  }
}

// —— D5 键空间/下标读取助手（descriptor 读，零 accessor 执行；INV-R4/R5/R11）——

/**
 * plain object 可读键空间 = own enumerable **data** property（ADR-0008 措辞）。
 * getOwnPropertyDescriptor 不执行 getter、不查原型链；accessor / non-enumerable /
 * undefined 值一律 NONE（键空间外 ≡ 缺席，D4/D5）——导航与投影共用（INV-R11）。
 */
function readableOwnDataValue(
  obj: Record<string, unknown>,
  key: string,
): { hit: true; value: unknown } | { hit: false } {
  const desc = Object.getOwnPropertyDescriptor(obj, key);
  if (desc === undefined) return { hit: false }; // 缺键 / 原型链（descriptor 不查原型链）
  if (desc.enumerable !== true) return { hit: false }; // non-enumerable 键空间外（AC3）
  if (desc.get !== undefined || desc.set !== undefined) return { hit: false }; // accessor：不执行、不产出（AC3）
  if (desc.value === undefined) return { hit: false }; // 吸收（D4）
  return { hit: true, value: desc.value };
}

/**
 * plain array 元素读取同款 descriptor 守卫：越界 NONE（吸收）；在界 undefined /
 * 稀疏空洞 / accessor 下标 → VIOLATION（位置语义不可省略，D4/D5，响亮失败）。
 */
function readableArrayElement(
  arr: unknown[],
  i: number,
):
  | { kind: 'ok'; value: unknown }
  | { kind: 'none' }
  | { kind: 'violation'; msg: string } {
  if (i >= arr.length) return { kind: 'none' }; // 越界吸收（D4）
  const desc = Object.getOwnPropertyDescriptor(arr, i);
  if (desc === undefined) return { kind: 'violation', msg: '数组位置 undefined 不可投影（稀疏空洞）' };
  if (desc.get !== undefined || desc.set !== undefined) {
    return { kind: 'violation', msg: '数组下标 accessor 不可读取（零副作用纪律）' };
  }
  if (desc.value === undefined) return { kind: 'violation', msg: '数组位置 undefined 不可投影' };
  return { kind: 'ok', value: desc.value };
}

// —— P1 定点投影（D6 双递归；ProjectOutcome 判别联合，R2 #1）——

/** 投影结局判别联合：禁 null/undefined 作失败哨兵（null 是完全合法的投影值）。 */
type ProjectOutcome = { kind: 'value'; v: unknown } | { kind: 'fail'; msg: string };

function failOut(msg: string): ProjectOutcome {
  return { kind: 'fail', msg };
}

/**
 * 路径耗尽处的转换：按实际载体分发（D2 表投影语义列）。
 * - detached（R2 #2）：Yjs 家族未集成 doc → 响亮失败（禁空投影）；
 * - Y.Map / Y.Array：递归投影（Yjs 容器分支）；
 * - Y.XmlFragment：toString() 语义字符串（终态，A2）；
 * - Y.Text / 未知 shared type：响亮失败（无 toJSON fallback，AC5）；
 * - 其余（scalar / plainObject / plainArray / nonPlainObject / violation）：
 *   copyPlainStrict（plain 域 JSON 值域拷贝器）。
 */
function projectValue(v: unknown): ProjectOutcome {
  if (v instanceof Y.AbstractType) {
    if ((v as { doc: unknown }).doc === null) {
      return failOut(`detached Yjs 载体（${yjsWord(v)}，未集成 doc）不可读——拒绝静默空投影`);
    }
  }
  switch (carrierOf(v)) {
    case 'Y.Map':
      return projectYMap(v as Y.Map<unknown>);
    case 'Y.Array':
      return projectYArray(v as Y.Array<unknown>);
    case 'Y.XmlFragment':
      return { kind: 'value', v: (v as Y.XmlFragment).toString() }; // 语义字符串（不锁逐字，A2）
    case 'Y.Text':
      return failOut('未知 Yjs shared type（Y.Text 家族）——无 toJSON fallback');
    case 'plain value':
      return copyPlainStrict(v, '目标'); // scalar / plainObject / plainArray / nonPlainObject / violation
    default: {
      if (v instanceof Y.AbstractType) {
        return failOut(`未知 Yjs shared type（${yjsWord(v)}）——无 toJSON fallback`);
      }
      return failOut(`值域违规（不可投影）：${typeof v}`);
    }
  }
}

/** Y.Map 投影：逐 keys() 递归；get(k)===undefined（含键显式存 undefined）→ 键省略（E1 吸收）。 */
function projectYMap(ymap: Y.Map<unknown>): ProjectOutcome {
  const out: Record<string, unknown> = {};
  for (const k of ymap.keys()) {
    const v = ymap.get(k);
    if (v === undefined) continue; // 吸收（D4/E1：yjs toJSON 同判省略）
    const r = projectValue(v); // Yjs 容器递归 / plain 域拷贝
    if (r.kind === 'fail') return r;
    putKey(out, k, r.v); // defineProperty 四真（AC6 陷阱：漏传描述符即事实冻结）
  }
  return { kind: 'value', v: out };
}

/** Y.Array 投影：逐下标递归；在界 undefined → 响亮失败（防御分支，attached 公共 API 不可达）。 */
function projectYArray(ya: Y.Array<unknown>): ProjectOutcome {
  const out: unknown[] = [];
  for (let i = 0; i < ya.length; i++) {
    const v = ya.get(i);
    if (v === undefined) return failOut('数组位置 undefined 不可投影');
    const r = projectValue(v);
    if (r.kind === 'fail') return r;
    out.push(r.v); // 数组下标无 __proto__ accessor 病理，可 push
  }
  return { kind: 'value', v: out };
}

/**
 * plain 域拷贝器（JSON 值域纪律，AC3/AC4 锚定面；与 extract.ts copyPlainValue 显式
 * 分叉，理由见设计 §3 D7）：
 * - number：Number.isFinite 拆支（NaN/±Infinity → 响亮失败，禁静默 null 化）；
 * - string/boolean/null：直通；bigint/undefined/function/symbol：响亮失败；
 * - Yjs 家族（carrierOf 粗判命中或 AbstractType）：响亮失败（嵌套 Yjs shared type，AC4）；
 * - plain array：逐元素 readableArrayElement（空洞/undefined/accessor → 响亮失败）+
 *   递归拷贝；
 * - plain object：proto 守卫（proto ∉ {Object.prototype, null} → 响亮失败，Date/类实例）
 *   + 逐 Object.keys 经 readableOwnDataValue（NONE → 键省略）+ 递归拷贝；
 *   输出键写入经 putKey（defineProperty 四真，'__proto__' 自有键安全，E8/E9）。
 */
function copyPlainStrict(v: unknown, loc: string): ProjectOutcome {
  if (typeof v === 'number') {
    return Number.isFinite(v) ? { kind: 'value', v } : failOut(`non-finite number（${loc}）`);
  }
  if (v === null || typeof v === 'string' || typeof v === 'boolean') {
    return { kind: 'value', v };
  }
  if (typeof v === 'bigint') return failOut(`bigint（${loc}）`);
  if (typeof v === 'undefined' || typeof v === 'function' || typeof v === 'symbol') {
    return failOut(`值域违规（${loc}）：${typeof v}`);
  }
  if (v instanceof Y.AbstractType) {
    return failOut(`嵌套 Yjs shared type（${yjsWord(v)}）`); // AC4：plain 域禁嵌套 Yjs（不问 attached，D5/E19 注记）
  }
  if (Array.isArray(v)) {
    const out: unknown[] = [];
    for (let i = 0; i < v.length; i++) {
      const hit = readableArrayElement(v, i);
      if (hit.kind === 'none') return failOut(`数组位置 undefined 不可投影（${loc}[${i}]）`);
      if (hit.kind === 'violation') return failOut(hit.msg);
      const r = copyPlainStrict(hit.value, `${loc}[${i}]`);
      if (r.kind === 'fail') return r;
      out.push(r.v);
    }
    return { kind: 'value', v: out };
  }
  // typeof v === 'object'（carrierOf 'plain value' 已保证；Date/类实例在此拒之——
  // 原型链级判据 isPlainRecord：冻结 AC3 fixture 的 protoObj（自定义 plain 中继原型链）
  // 放行；Date/RegExp/Map/Set/类实例 → 响亮失败，禁静默投影 {}）
  if (!isPlainRecord(v)) {
    return failOut(`非 plain 原型对象（${loc}）`);
  }
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v as Record<string, unknown>)) {
    const hit = readableOwnDataValue(v as Record<string, unknown>, k);
    if (!hit.hit) continue; // accessor / non-enumerable / undefined 值 → 键省略（吸收，D4/D5）
    const r = copyPlainStrict(hit.value, `${loc}.${k}`);
    if (r.kind === 'fail') return r;
    putKey(out, k, r.v);
  }
  return { kind: 'value', v: out };
}

/**
 * 输出键写入（D6 尾注 / INV-R7）：四描述符全 true——漏传时 defineProperty 默认
 * writable:false, configurable:false → 事实冻结 → AC6「顶层与嵌套均可写」红；
 * 且经 defineProperty 写入 ' __proto__' 自有键不触发原型 setter（E8/E9 防劫持）。
 */
function putKey(out: object, k: string, v: unknown): void {
  Object.defineProperty(out, k, { value: v, writable: true, enumerable: true, configurable: true });
}
