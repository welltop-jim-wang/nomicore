/**
 * 校验核心（issue #21 设计 §3~§5/§8~§10）：值 schema 树解释器——整份 JSON 快照校验。
 *
 * validateSnapshot 是值 schema（`derived.values`）的解释器；结构树（aliases /
 * structure / index）**零消费**（设计 §1.2——两树正交，读取即设计违约，SA4 静态锚点）。
 *
 * 架构要点（设计 §2/§3/§5/§8，SA3 防走样附录 1~10 逐条兑现）：
 * - 同步、纯函数、不抛错：一切 per-call 中间态（ref 解析 memo、正则编译缓存、
 *   count/contra 记忆化、工作账本、issue 收集器）均为调用局部对象；不落模块级缓存；
 *   不修改 derived 与 snapshot（纯数据只读遍历）；结果为纯 JSON 值。
 * - 崩溃边界：任何内部异常（含手造/篡改派生物导致的引用环、未知名、深嵌套栈溢出
 *   RangeError）经顶层 catch 收编为 `{ ok:false, issues:[VFSL-E100 …] }`；E100 前缀
 *   经模板字面量直书（ValidateIssue 不经 makeIssue——那会引入 line/column 字段）。
 * - 资源账本（§3.4，R2 新增）：全局工作预算 WORK_LIMIT = 2×10⁸ + (解析后节点, 值)
 *   双记忆化（countMemo/contraMemo，各 65_536 条封顶清空重建）——兑现 ADR 0003 §4
 *   的消费者预算委托（菱形联合链从 2^k 坍缩为线性）。计费点全覆盖：三个解释器函数
 *   进入（含 memo 命中）、NFA 步、正则编译（产物指令数）、快照键/数组元素访问
 *   （含纯遍历与计数态）、emit/overflow 记账、preview（每次 48，仅物化态）。
 * - 联合三段算法（§5.2 唯一权威）：段 0 判别式缓存跳转（仅加速静默接受，输出与无
 *   缓存路径全等）→ 段 1 候选过滤（硬矛盾判定，contraMemo）→ 段 2 接受扫描（精确
 *   计数不短路，countMemo 顺带产出距离）→ 段 3 报告（候选分支仅下钻 / 无候选分支
 *   汇总 + 下钻）。countIssues 以计数 sink 跑完整校验（不 emit、不构造消息）。
 * - emit 消息构造门控（R4，附录 10）：emit(path, makeMessage) thunk——计数态
 *   （issues ≥ 100）与计数 sink 不调用 makeMessage、不运行 preview（preview 每次
 *   调用计 48 单位，全局 ≤ 100 次）；path 一律冻结副本。
 * - preview（§4 R3 定稿）：40 字符提前终止的增量序列化（禁 JSON.stringify().slice()）。
 */
import { compile, match } from './pattern.js';
import {
  PatternBudgetExceeded,
  PatternCompileError,
  PatternTooLargeError,
  PatternUnsupportedError,
} from './pattern.js';
import type { CompiledPattern } from './pattern.js';
import { wellFormedXml } from './xml.js';
import type { DerivedSchema, Discriminator, ValueField, ValueSchema } from './derived.js';
import { InternalError } from './resolve.js';

/** 校验 issue：message + path 段数组（不复用 VfslIssue——无行列；段数组零转义）。 */
export interface ValidateIssue {
  message: string;
  /** 段数组（如 ["assets","abc123","duration"]）；对象/Record 键为 string 段，数组下标为 number 段。 */
  path: Array<string | number>;
}

export type ValidateResult =
  | { ok: true }
  | { ok: false; issues: ValidateIssue[] };

/** 全收集上限（§8：100 条真实 issue，超限末条为截断标记）。 */
const ISSUE_LIMIT = 100;
/** 全局工作预算（§3.4/§5.7-3 冻结：R3 重标定 16M → 2×10⁸，v1 契约合计 1.887×10⁸ 的兜底）。 */
const WORK_LIMIT = 200_000_000;
/** countMemo / contraMemo 容量上界（超出清空重建——记忆化是性能优化、非正确性依赖）。 */
const MEMO_CAP = 65_536;

/** 全局工作预算耗尽（调用级终态；与 E100、单次 Pattern 预算三重可区分）。 */
class WorkBudgetExceeded extends Error {
  constructor(readonly work: number) {
    super(`校验工作预算耗尽（全局已执行 ${work} 工作单位，上限 200000000）`);
    this.name = 'WorkBudgetExceeded';
  }
}

type Sink = (path: Array<string | number>, makeMessage: () => string) => void;

/** 调用局部上下文（一次 validateSnapshot 调用的全部中间态；随调用销毁——纯函数契约）。 */
interface Ctx {
  values: Record<string, ValueSchema>;
  /** ref 节点 → 解析目标（迭代解析 memo；对象引用做键）。 */
  refMemo: Map<ValueSchema, ValueSchema>;
  /** 正则编译缓存（键 = 模式串；同模式一次调用内只编译一次）。 */
  regexCache: Map<string, CompiledPattern>;
  /** 全局工作计数（每次调用从 0 起）。 */
  work: number;
  /** countIssues 结果记忆化（外键 = 解析后节点对象；内键 = 快照值，对象按引用同一性）。 */
  countMemo: Map<ValueSchema, Map<unknown, number>>;
  /** contradicts 结果记忆化（同键异桶）。 */
  contraMemo: Map<ValueSchema, Map<unknown, boolean>>;
  memoEntries: number;
  issues: ValidateIssue[];
  overflow: number;
  /** 发射 sink（物化态；countIssues 期间切换为计数 sink 并在结束时恢复）。 */
  emit: Sink;
}

function charge(ctx: Ctx, n: number): void {
  ctx.work += n;
  if (ctx.work > WORK_LIMIT) throw new WorkBudgetExceeded(ctx.work);
}

/** 物化态发射 sink（§8.1）：达 100 条后转计数态（overflow++，不构造消息、不调用 makeMessage）。 */
function emitIssue(ctx: Ctx, path: Array<string | number>, makeMessage: () => string): void {
  charge(ctx, 1); // emit/overflow 记账本身是工作（§3.4 R3 补行）
  if (ctx.issues.length < ISSUE_LIMIT) {
    ctx.issues.push({ message: makeMessage(), path: [...path] }); // path 冻结副本
  } else {
    ctx.overflow += 1;
  }
}

function createCtx(values: Record<string, ValueSchema>): Ctx {
  const ctx: Ctx = {
    values,
    refMemo: new Map(),
    regexCache: new Map(),
    work: 0,
    countMemo: new Map(),
    contraMemo: new Map(),
    memoEntries: 0,
    issues: [],
    overflow: 0,
    emit: () => {}, // 占位——立即替换为绑定 ctx 的发射 sink
  };
  ctx.emit = (path, makeMessage) => emitIssue(ctx, path, makeMessage);
  return ctx;
}

// —— §3.1 值树 ref 解析器（迭代 while 循环；in-flight 环检测；菱形链只解析一次）——

function resolveValues(t: ValueSchema, ctx: Ctx): ValueSchema {
  const inFlight = new Set<string>();
  let node: ValueSchema = t;
  while (node.kind === 'ref') {
    const hit = ctx.refMemo.get(node);
    if (hit !== undefined) {
      node = hit;
      continue;
    }
    if (inFlight.has(node.name)) throw new InternalError(`值树引用环: ${node.name}`);
    inFlight.add(node.name);
    const next = Object.hasOwn(ctx.values, node.name) ? ctx.values[node.name] : undefined; // own 守卫：手造 ref 名命中原型链继承名 → 未声明 loud E100（SA4 F2）
    if (next === undefined) throw new InternalError(`值树未声明别名: ${node.name}`);
    ctx.refMemo.set(node, next);
    node = next;
  }
  return node;
}

// —— §3.3 运行时类型名（诊断用）——

function jsonTypeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'object') return 'object';
  if (typeof v === 'string') return 'string';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'undefined') return 'undefined';
  return '非 JSON 值'; // function / symbol / bigint
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** present(k) = hasOwn 且值非 undefined（undefined 视同缺席——JSON 序列化本就丢弃，冻结）。 */
function present(obj: Record<string, unknown>, k: string): boolean {
  return Object.hasOwn(obj, k) && obj[k] !== undefined;
}

function enumContains(values: Array<string | number>, value: unknown): boolean {
  for (const v of values) if (v === value) return true; // 严格相等（类型形随严格相等自然对齐）
  return false;
}

// —— §4 R3 定稿 preview：40 字符提前终止的增量序列化（禁全量 stringify；每次调用计 48）——

function preview(value: unknown, ctx: Ctx): string {
  charge(ctx, 48); // 常数上界计费（仅物化态被调用——thunk 门控，§3.4）
  const LIMIT = 40;
  let out = '';
  let done = false;
  const push = (s: string): void => {
    if (done) return;
    const room = LIMIT - out.length;
    if (s.length > room) {
      out += s.slice(0, room) + '…';
      done = true;
    } else {
      out += s;
    }
  };
  const stringifyStr = (s: string): void => {
    push('"');
    // 先按剩余空间截取原始串（每原始字符至少产出 1 字符 → 截断由 push 兜底），
    // 逐码元转义——长串在 40 字符处停，成本被产出字符数封顶
    const room = LIMIT - out.length;
    for (const ch of s.slice(0, room)) {
      const cp = ch.codePointAt(0)!;
      if (ch === '"') push('\\"');
      else if (ch === '\\') push('\\\\');
      else if (ch === '\n') push('\\n');
      else if (ch === '\r') push('\\r');
      else if (ch === '\t') push('\\t');
      else if (cp < 0x20) push(`\\u${cp.toString(16).padStart(4, '0')}`);
      else push(ch);
    }
    push('"');
  };
  const walk = (v: unknown): void => {
    if (done) return;
    if (v === null) {
      push('null');
    } else if (typeof v === 'string') {
      stringifyStr(v);
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      push(String(v));
    } else if (typeof v === 'undefined') {
      push('undefined');
    } else if (typeof v === 'function') {
      push('function');
    } else if (typeof v === 'symbol') {
      push('symbol');
    } else if (typeof v === 'bigint') {
      push(String(v));
    } else if (Array.isArray(v)) {
      push('[');
      let firstItem = true;
      for (const item of v) {
        if (done) return;
        if (!firstItem) push(',');
        firstItem = false;
        walk(item);
      }
      push(']');
    } else {
      push('{');
      let firstKey = true;
      for (const k of Object.keys(v as Record<string, unknown>)) {
        if (done) return;
        if (!firstKey) push(',');
        firstKey = false;
        stringifyStr(k);
        push(':');
        walk((v as Record<string, unknown>)[k]);
      }
      push('}');
    }
  };
  walk(value);
  return out;
}

// —— §6.5 四类 loud 失败（使用时暴露：校验位被到达才编译判定；未到达的位不暴露）——

function compileOrCache(regex: string, ctx: Ctx): CompiledPattern {
  const cached = ctx.regexCache.get(regex);
  if (cached !== undefined) return cached;
  const compiled = compile(regex);
  ctx.regexCache.set(regex, compiled);
  charge(ctx, compiled.size); // 正则编译一次：编译产物指令数（§3.4）
  return compiled;
}

function emitPatternError(err: unknown, regex: string, path: Array<string | number>, ctx: Ctx): void {
  if (err instanceof PatternCompileError) {
    ctx.emit(path, () => `Pattern 正则无法编译：/${regex}/（${err.detail}）`);
  } else if (err instanceof PatternUnsupportedError) {
    ctx.emit(path, () => `Pattern 正则含匹配器不支持的构造：${err.construct}（子集清单见设计 §6.2）`);
  } else if (err instanceof PatternTooLargeError) {
    ctx.emit(path, () => `Pattern 正则程序规模超限：/${regex}/ 编译产物超过 10000 指令（量词展开 ${err.copies} 份）`);
  } else if (err instanceof PatternBudgetExceeded) {
    ctx.emit(path, () => `Pattern 匹配步数预算耗尽（输入长度 ${err.inputLen}，预算 ${err.budget}）：无法在预算内判定匹配性`);
  } else {
    throw err; // 意外异常 → 顶层崩溃边界（E100）
  }
}

/** Record keyPattern 逐键判定（使用时暴露：键位被到达才编译；同模式一次调用内编译一次）。 */
function validateKeyPattern(regex: string, key: string, path: Array<string | number>, ctx: Ctx): void {
  try {
    const compiled = compileOrCache(regex, ctx);
    if (!match(compiled, key, (n) => charge(ctx, n))) {
      ctx.emit(path, () => `Record 键 "${key}" 不满足 Pattern 正则 /${regex}/`);
    }
  } catch (err) {
    emitPatternError(err, regex, path, ctx);
  }
}

// —— §5 联合：候选过滤 + 零 issue 接受 + 最小距离报告（三段算法，唯一权威 §5.2）——

/** 计数 sink 完整校验（精确计数、不短路；距离 = issue 数，O4；嵌套递归照常）。 */
function countIssues(node: ValueSchema, value: unknown, ctx: Ctx): number {
  charge(ctx, 1); // 进入（含 memo 命中查询本身——§3.4）
  const resolved = resolveValues(node, ctx);
  const inner = ctx.countMemo.get(resolved);
  const hit = inner?.get(value);
  if (hit !== undefined) return hit;

  let count = 0;
  const savedEmit = ctx.emit;
  ctx.emit = () => {
    count += 1;
    charge(ctx, 1); // 计数记账同样是工作
  };
  try {
    validateValue(resolved, value, [], ctx);
  } finally {
    ctx.emit = savedEmit;
  }
  memoStore(ctx, ctx.countMemo, resolved, value, count);
  return count;
}

/** 硬矛盾判定（§5.3 封闭定义；候选过滤；contraMemo 记忆化）。 */
function contradicts(value: unknown, node: ValueSchema, ctx: Ctx): boolean {
  charge(ctx, 1); // 进入（含 memo 命中查询本身）
  const resolved = resolveValues(node, ctx);
  const inner = ctx.contraMemo.get(resolved);
  const hit = inner?.get(value);
  if (hit !== undefined) return hit;

  const result = contradictsInner(value, resolved, ctx);
  memoStore(ctx, ctx.contraMemo, resolved, value, result);
  return result;
}

function contradictsInner(value: unknown, node: ValueSchema, ctx: Ctx): boolean {
  switch (node.kind) {
    case 'scalar':
      if (node.type === 'unknown') return false; // unknown 永不矛盾
      if (node.type === 'null') return value !== null;
      return typeof value !== node.type;
    case 'enum':
      return !enumContains(node.values, value);
    case 'pattern':
      return typeof value !== 'string'; // 匹配性属段 2 软判定
    case 'array':
      return !Array.isArray(value);
    case 'xml':
      return typeof value !== 'string'; // 良构性属段 2 软判定
    case 'object': {
      if (!isPlainObject(value)) return true;
      const byName = new Map<string, ValueField>();
      for (const f of node.fields) byName.set(f.name, f);
      if (byName.has('<key>')) return false; // Record 形态：键 Pattern 违规属软判定
      const obj = value as Record<string, unknown>;
      // 必填字面量字段缺席或值错 = 不可挽回的成员排除（判别字段缺席即排除——平局红灯的直接驱动）
      for (const f of node.fields) {
        const inner = resolveValues(f.value, ctx);
        if (inner.kind === 'optional') continue; // 非必填不参与矛盾判定
        if (inner.kind !== 'enum') continue;
        const isPresent = present(obj, f.name);
        if (isPresent ? !enumContains(inner.values, obj[f.name]) : true) return true;
      }
      return false;
    }
    case 'union': {
      // 全部子成员矛盾（递归；子成员 ref 解析）
      for (const m of node.members) {
        if (!contradicts(value, m, ctx)) return false;
      }
      return true;
    }
    case 'optional':
      throw new InternalError('I3 不变量: 值树成员位出现 optional 包装');
    case 'ref':
      return false; // 已解析（分发前 resolveValues）
  }
}

function memoStore<V>(
  ctx: Ctx,
  map: Map<ValueSchema, Map<unknown, V>>,
  key: ValueSchema,
  value: unknown,
  result: V,
): void {
  if (ctx.memoEntries >= MEMO_CAP) {
    // 容量封顶：清空重建（记忆化是性能优化、非正确性依赖；时间界交还全局预算兜底）
    ctx.countMemo.clear();
    ctx.contraMemo.clear();
    ctx.memoEntries = 0;
  }
  let inner = map.get(key);
  if (inner === undefined) {
    inner = new Map();
    map.set(key, inner);
  }
  inner.set(value, result);
  ctx.memoEntries += 1;
}

/** §5.2 段 3 下钻：以发射 sink 对成员跑完整校验，相对路径 re-base 到联合值 path。 */
function dive(member: ValueSchema, value: unknown, path: Array<string | number>, ctx: Ctx): void {
  validateValue(member, value, path, ctx);
}

function validateUnion(node: Extract<ValueSchema, { kind: 'union' }>, value: unknown, path: Array<string | number>, ctx: Ctx): void {
  const members = node.members.map((m) => resolveValues(m, ctx)); // ref 成员先解析
  const N = members.length;
  if (N === 0) throw new InternalError('I3 不变量: 联合无成员（手造派生物）');

  // —— 段 0（可选快速路径）：判别式缓存跳转——仅加速静默接受，不改变任何输出 ——
  if (node.discriminator !== undefined && isPlainObject(value)) {
    const raw = (value as Record<string, unknown>)[node.discriminator.field];
    if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') { // 判别键仅三类字面量（String() 永不抛）；own 守卫防原型链继承名命中（SA4 F1）
      const key = String(raw);
      const hit = Object.hasOwn(node.discriminator.byValue, key) ? node.discriminator.byValue[key] : undefined;
      if (hit !== undefined && countIssues(members[hit]!, value, ctx) === 0) {
        return; // 命中且零 issue：接受，零输出（与全扫描输出全等）
      }
      // 命中但有 issue → 落入下方完整流程（输出与无缓存路径全等）
    }
  }

  // —— 段 1：候选过滤（硬矛盾判定）——
  const candidates: number[] = [];
  for (let i = 0; i < N; i++) {
    if (!contradicts(value, members[i]!, ctx)) candidates.push(i);
  }

  // —— 段 2：接受扫描——候选按声明序逐个 countIssues，首个零 issue → 接受（顺带产出距离，O4）——
  const distances: number[] = [];
  for (let i = 0; i < N; i++) distances.push(countIssues(members[i]!, value, ctx));
  for (const i of candidates) {
    if (distances[i] === 0) return;
  }

  // —— 段 3：报告——
  if (candidates.length > 0) {
    const winner = argmin(candidates, distances);
    dive(members[winner]!, value, path, ctx); // 候选分支：仅字段级 issue，无汇总混入（7 计数锚点）
  } else {
    const winner = argmin(range(N), distances);
    ctx.emit([...path], () => `不匹配任何联合成员（any-of 全拒绝）：失败距离最小的成员为联合成员 ${winner + 1}/${N}（距离 ${distances[winner]}）`);
    dive(members[winner]!, value, path, ctx); // 无候选分支：汇总 + 下钻双输出
  }
}

/** 最小距离（严格 < 扫描——平局取声明序在前者，跨实现稳定）。 */
function argmin(indices: number[], distances: number[]): number {
  let best = indices[0]!;
  for (const i of indices) {
    if (distances[i]! < distances[best]!) best = i;
  }
  return best;
}

function range(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(i);
  return out;
}

// —— §4 节点校验规则全景表（validateValue 唯一分发点；ref 分发前已解析）——

function validateValue(node: ValueSchema, value: unknown, path: Array<string | number>, ctx: Ctx): void {
  charge(ctx, 1); // 每次进入计费（§3.4）
  const t = resolveValues(node, ctx);
  switch (t.kind) {
    case 'scalar': {
      const ok =
        t.type === 'unknown' ? true : t.type === 'null' ? value === null : typeof value === t.type;
      if (!ok) {
        ctx.emit([...path], () => `类型不匹配：期望 ${t.type}，实际 ${jsonTypeOf(value)}`);
      }
      break;
    }
    case 'enum': {
      if (!enumContains(t.values, value)) {
        ctx.emit(
          [...path],
          () => `值不在枚举内：期望 ${t.values.map(String).join(' | ')}，实际 ${jsonTypeOf(value)} ${preview(value, ctx)}`,
        );
      }
      break;
    }
    case 'pattern': {
      if (typeof value !== 'string') {
        ctx.emit([...path], () => `类型不匹配：期望 string，实际 ${jsonTypeOf(value)}`);
        break;
      }
      try {
        const compiled = compileOrCache(t.regex, ctx); // 使用时暴露：到达本行才编译
        if (!match(compiled, value, (n) => charge(ctx, n))) {
          ctx.emit([...path], () => `不匹配 Pattern 正则 /${t.regex}/`);
        }
      } catch (err) {
        emitPatternError(err, t.regex, [...path], ctx);
      }
      break;
    }
    case 'object': {
      validateObject(t, value, path, ctx);
      break;
    }
    case 'array': {
      if (!Array.isArray(value)) {
        ctx.emit([...path], () => `类型不匹配：期望数组，实际 ${jsonTypeOf(value)}`);
        break;
      }
      const element = resolveValues(t.element, ctx);
      for (let i = 0; i < value.length; i++) {
        charge(ctx, 1); // 数组元素被访问（含达 100 条后计数态继续遍历的元素——§3.4 R3 补行）
        validateValue(element, value[i], [...path, i], ctx); // i 为 number 段（O1）
      }
      break;
    }
    case 'xml': {
      if (typeof value !== 'string') {
        ctx.emit([...path], () => `类型不匹配：期望 XML 字符串，实际 ${jsonTypeOf(value)}`);
        break;
      }
      const detail = wellFormedXml(value);
      if (detail !== null) {
        ctx.emit([...path], () => `YXmlFragment 值不是良构 XML：${detail}`);
      }
      break;
    }
    case 'union': {
      validateUnion(t, value, path, ctx);
      break;
    }
    case 'optional':
      throw new InternalError('I3 不变量: 值树成员位出现 optional 包装');
    case 'ref':
      break; // 分发前已解析，执行中不出现
  }
}

// —— §4.1 object 节点两形态（'<key>' 字段存在 → Record 形态）——

function validateObject(
  node: Extract<ValueSchema, { kind: 'object' }>,
  value: unknown,
  path: Array<string | number>,
  ctx: Ctx,
): void {
  if (!isPlainObject(value)) {
    ctx.emit([...path], () => `类型不匹配：期望对象，实际 ${jsonTypeOf(value)}`);
    return;
  }
  const obj = value as Record<string, unknown>;
  // 字段名索引（调用局部；进入 object 节点时构建——消除「键数 × 字段数」的未计费线性扫描）
  const byName = new Map<string, ValueField>();
  for (const f of node.fields) byName.set(f.name, f);

  // Record 形态：动态键空间，空对象合法；无必填缺失、无未知键
  const slotField = byName.get('<key>');
  if (slotField !== undefined) {
    const slot = resolveValues(slotField.value, ctx);
    const keyPattern = node.keyPattern;
    for (const k of Object.keys(value)) {
      charge(ctx, 1); // 快照对象键被访问（§3.4 R3 补行）
      if (keyPattern !== undefined) {
        validateKeyPattern(keyPattern, k, [...path, k], ctx); // 键违规不阻断值校验——全收集语义
      }
      validateValue(slot, obj[k], [...path, k], ctx);
    }
    return;
  }

  // 封闭对象形态
  // (1) 必填缺失——字段声明序
  for (const f of node.fields) {
    if (f.value.kind === 'optional') continue;
    // unknown 恒接受（§4 scalar unknown 行：含 undefined）且 present() 语义「undefined
    // 视同缺席」——两规则闭合即「unknown 字段缺席视同接受」：红灯「原始类型校验」恰 4 条
    // 锚点（u 缺席不报），设计 §11 对账同口径
    const inner = resolveValues(f.value, ctx);
    if (inner.kind === 'scalar' && inner.type === 'unknown') continue;
    if (!present(obj, f.name)) {
      ctx.emit([...path, f.name], () => `缺少必填字段 "${f.name}"`);
    }
  }
  // (2) 未知键——快照键枚举序（Object.keys：整数形态键数值升序先行，§9.2 精确读法）
  for (const k of Object.keys(value)) {
    charge(ctx, 1); // 含不进 validateValue 的纯遍历键（未知键只 emit 不下钻，但枚举即访问）
    if (!byName.has(k)) {
      ctx.emit([...path, k], () => `未知字段 "${k}"：封闭对象不接受未声明键`);
    }
  }
  // (3) 在场字段值校验——字段声明序（optional 包装在此解包）
  for (const f of node.fields) {
    if (!present(obj, f.name)) continue;
    const inner = f.value.kind === 'optional' ? f.value.value : f.value;
    validateValue(inner, obj[f.name], [...path, f.name], ctx);
  }
}

// —— §2 公共接缝 ——

/**
 * 第三公共导出（issue #21）：整份 JSON 快照校验——值 schema 树解释器。
 *
 * 同步、纯函数、不抛错；不修改 `derived` 与 `snapshot`（纯数据只读遍历）；结果纯
 * JSON 值（JSON 往返全等）；编译一次、校验多次（一切中间态调用局部，不落模块级
 * 缓存）。前置条件：`derived` 须为 `evaluate` 的 ok:true 产物；篡改数据（删判别式
 * 键是测试合法操作——缓存非契约；造环/删别名属手造垃圾）落入 loud E100 边界，
 * 不静默产出 ok:true。
 */
export function validateSnapshot(derived: DerivedSchema, snapshot: unknown): ValidateResult {
  try {
    const ctx = createCtx(derived.values);
    const rootType = ctx.values['ROOT'];
    if (rootType === undefined) throw new InternalError('值树缺少 ROOT 别名');
    const root = resolveValues(rootType, ctx);
    validateValue(root, snapshot, [], ctx); // path 起点 = []
    if (ctx.overflow > 0) {
      // 截断标记（§8.2 唯一追加点）：恰在真实 issue 数 > 100 时出现（=100 无标记）
      ctx.issues.push({
        message: `校验问题超出 100 条上限，输出已截断（truncated）：另有 ${ctx.overflow} 处问题未报告`,
        path: [],
      });
    }
    return ctx.issues.length === 0 ? { ok: true } : { ok: false, issues: ctx.issues };
  } catch (err) {
    if (err instanceof WorkBudgetExceeded) {
      // §3.4 预算耗尽消费路径（与 E100 同为调用级终态，但三重可区分；不进 emit 通道、无截断标记）
      return {
        ok: false,
        issues: [
          {
            message: `校验工作预算耗尽（全局已执行 ${err.work} 工作单位，上限 200000000）：无法在预算内完成整份校验`,
            path: [],
          },
        ],
      };
    }
    // 崩溃边界（§2.2/§10 R2/R3）：detail = err instanceof Error ? err.message : String(err)
    const detail = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      issues: [{ message: `VFSL-E100: 内部错误（意外异常）: ${detail}`, path: [] }],
    };
  }
}
