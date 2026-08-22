/**
 * 路径级写入校验（issue #53 / H2）：validatePatch + 数组三操作——统一写入管线
 * （§7）判定核心的增量形态。ADR 0002「结构 → 值」两步判定：
 *
 * ① 结构守卫（§3.2）：结构树节点集游走（ADR 0003 §3「任一成员出现即存在」；
 *    leaf / plain / xml-fragment 为终态拒绝下钻；数组越界归运行时）——只消费
 *    `derived.structure` + `derived.aliases`（结构树域）与 base 的 presence/长度；
 *    `derived.index` 零消费（语法路径键空间 ≠ 运行时路径，D12）。
 * ② 值校验（§3.4）：最近结构边界重建整值（CONTEXT「重建校验」）后整体过子
 *    schema——判别联合只有看到判别字段才知道按哪个变体验；复用 validate.ts 的
 *    共享解释器（validateSubtree），issue 按绝对路径 rebase（D5）。
 *
 * 工程纪律：
 * - 同步、纯函数、不抛错：一切 per-call 中间态（节点集、ref memo）均为调用局部；
 *   不修改 derived 与 base；结果为纯 JSON 值。
 * - 崩溃边界：任何内部异常（手造/篡改派生物导致的环、未知名、两树分歧、深嵌套
 *   栈溢出）经顶层 catch 收编为单条 `VFSL-E100` 结果（issue path = []，与
 *   validateLogicalSnapshot 同款，F6）；不存在静默 ok:true 路径。
 * - 重建一律计算键展开（`{ ...o, [k]: v }`），禁 `__proto__` 字面与点赋值——
 *   patch 键 `'__proto__'` 落为自有属性而非原型设置；读取侧 Object.hasOwn 守卫。
 * - 节点集按对象身份去重（R2 冻结③）：每步 ≤ O(结构树节点数)，总界 O(路径长 × N)。
 * - base 段检查两段式（R2 冻结②）：每步先对父容器做形态判定（string 段 → plain
 *   object；number 段 → Array），再对子值做在场/越界判定——spread 塌缩静默
 *   ok:true 路径在入口处封死。
 * - 值树游标恒归一化（R2 冻结①）：初始化与每次取子前后经共享值树透镜解析 ref
 *   链（解 optional 仅字段位）；边界产出节点恒为非 ref/optional——解释器入口
 *   resolveValues 对其为恒等操作，与「边界保持 ref 委托解释器解析」语义等价。
 */
import type { DerivedSchema, StructureNode, ValueSchema } from './derived.js';
import { InternalError, walkRefChain } from './resolve.js';
import type { RefChainLens } from './resolve.js';
import { validateSubtree } from './validate.js';
import type { ValidateResult } from './validate.js';

// —— 通用小工具（与 validate.ts 冻结语义一致）——

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

/** present(k) = hasOwn 且值非 undefined（undefined 视同缺席——与 validate.ts 冻结语义一致）。 */
function present(obj: Record<string, unknown>, k: string): boolean {
  return Object.hasOwn(obj, k) && obj[k] !== undefined;
}

// —— §4.1 共享解析核心的透镜实例（walkRefChain 参数化；报错文案逐字节对齐各自域）——

/** 结构树透镜（本票新增；查表带 own 守卫）。 */
function structureLens(aliases: Record<string, StructureNode>): RefChainLens<StructureNode> {
  return {
    isRef: (n): n is Extract<StructureNode, { kind: 'ref' }> => n.kind === 'ref',
    nameOf: (n) => (n as Extract<StructureNode, { kind: 'ref' }>).name,
    lookup: (name) => (Object.hasOwn(aliases, name) ? aliases[name] : undefined),
    cycleError: (name) => new InternalError(`结构树引用环: ${name}`),
    missingError: (name) => new InternalError(`结构树未声明别名: ${name}`),
  };
}

/** 值树透镜（与 validate.ts resolveValues 同一算法、同一报错文案）。 */
function valueLens(values: Record<string, ValueSchema>): RefChainLens<ValueSchema> {
  return {
    isRef: (n): n is Extract<ValueSchema, { kind: 'ref' }> => n.kind === 'ref',
    nameOf: (n) => (n as Extract<ValueSchema, { kind: 'ref' }>).name,
    lookup: (name) => (Object.hasOwn(values, name) ? values[name] : undefined),
    cycleError: (name) => new InternalError(`值树引用环: ${name}`),
    missingError: (name) => new InternalError(`值树未声明别名: ${name}`),
  };
}

// —— §3.2 结构守卫：节点集游走 + base 两段式检查 + 边界判定 ——

type Op = 'replace' | 'append' | 'insert' | 'delete';

/** 边界（值校验的重建点，§3.3）：prefix = rebase 前缀；node = 边界值 schema 节点。 */
interface Boundary {
  prefix: Array<string | number>;
  node: ValueSchema;
  /** 合并基值（relPath 非空时必为 plain object 或 Array——守卫逐跳形态检查保证）。 */
  base: unknown;
  relPath: Array<string | number>;
}

type GuardResult = { ok: true; boundary: Boundary } | { ok: false; result: ValidateResult };

/** 单步结构下钻（R2 冻结③：对象身份去重 Set + 每步 visited——工作量界 O(路径长 × N)）。 */
interface DrillResult {
  out: Set<StructureNode>;
  /** 尝试过的候选形态（拒绝消息取序用，R2 冻结④）。 */
  forms: Set<string>;
  /** 本次下钻穿过了 union（S 解析后含 union 且命中非空）——§3.3 规则 1 的触发条件。 */
  crossedUnion: boolean;
  /** 命中是否经精确字段匹配。 */
  viaExact: boolean;
  /** 命中是否经 Record '<key>' 槽。 */
  viaRecord: boolean;
  /** 命中是否经数组元素位。 */
  viaArray: boolean;
}

function drillStep(S: Set<StructureNode>, seg: string | number, lens: RefChainLens<StructureNode>): DrillResult {
  const out = new Set<StructureNode>();
  const visited = new Set<StructureNode>(); // 每步身份去重：一个节点每步至多展开一次
  const forms = new Set<string>();
  let sawUnion = false;
  let viaExact = false;
  let viaRecord = false;
  let viaArray = false;

  const matchNode = (n: StructureNode): void => {
    forms.add(n.kind);
    switch (n.kind) {
      case 'map': {
        if (typeof seg !== 'string') return; // 对象位只收 string 段（D7；拒绝归矩阵行 6）
        let exact = false;
        for (const f of n.fields) {
          if (f.name === seg) {
            out.add(f.node);
            viaExact = true;
            exact = true;
          }
        }
        if (!exact) {
          // 精确未中且存在 '<key>' 字段 → Record 动态键放行（键 Pattern 属值级，§3.3 规则 2）
          for (const f of n.fields) {
            if (f.name === '<key>') {
              out.add(f.node);
              viaRecord = true;
            }
          }
        }
        return;
      }
      case 'array': {
        if (typeof seg === 'number' && Number.isInteger(seg) && seg >= 0) {
          out.add(n.element);
          viaArray = true;
        }
        return; // 越界不在此判——越界是 base 长度问题
      }
      case 'union': {
        sawUnion = true;
        for (const m of n.members) expand(m); // 「任一成员出现即存在」（ADR 0003 §3）
        return;
      }
      default:
        return; // leaf / plain / xml-fragment / root：终态，不接受下钻
    }
  };

  const expand = (n: StructureNode): void => {
    if (visited.has(n)) return;
    visited.add(n);
    if (n.kind === 'ref') {
      const next = lens.lookup(n.name);
      if (next === undefined) throw lens.missingError(n.name);
      expand(next); // 解析目标按对象身份共享（aliases 单次物化）→ 去重有效
      return;
    }
    matchNode(n);
  };

  for (const n of S) expand(n);
  return { out, forms, crossedUnion: sawUnion && out.size > 0, viaExact, viaRecord, viaArray };
}

/** 拒绝消息取序（R2 冻结④）：leaf > plain > xml-fragment > array > map。 */
const KIND_ORDER: ReadonlyArray<string> = ['leaf', 'plain', 'xml-fragment', 'array', 'map'];

function structureRejectMessage(forms: Set<string>, seg: string | number): string {
  const kind = KIND_ORDER.find((k) => forms.has(k));
  switch (kind) {
    case 'leaf':
      return `路径不存在："${seg}" 位是原生叶子（leaf）终态，不接受下钻`;
    case 'plain':
      return `路径不存在："${seg}" 位是 YPlainArray 纯值终态，只能整体替换`;
    case 'xml-fragment':
      return `路径不存在："${seg}" 位是 YXmlFragment 不透明终态，路径下钻守卫到此为止（ADR 0003 §5）`;
    case 'array':
      return `路径段类型错误：数组位置需要整数 number 下标段，收到 ${jsonTypeOf(seg)}`;
    case 'map':
      return typeof seg === 'string'
        ? `路径不存在：未知字段 "${seg}"（封闭对象不接受未声明键）`
        : `路径段类型错误：对象位置需要 string 键段，收到 ${jsonTypeOf(seg)}`;
    default:
      // 形态全集外的候选（手造派生物）——确定性兜底，不静默
      return `路径不存在：段 "${seg}" 无法在结构树中下钻`;
  }
}

/** 数组三操作结构侧前置判定（§3.5）：目标位节点集经解析后须含 array 候选（union-of-arrays 由值校验兜住）。 */
function targetHasArrayCandidate(
  nodeSet: Set<StructureNode>,
  lens: RefChainLens<StructureNode>,
  seg: string | number,
): { ok: true } | { ok: false; message: string } {
  const visited = new Set<StructureNode>();
  let sawLeaf = false;
  let sawPlain = false;
  let sawXml = false;
  let sawArray = false;
  let sawMap = false;
  const walk = (n: StructureNode): void => {
    if (visited.has(n)) return;
    visited.add(n);
    if (n.kind === 'ref') {
      const next = lens.lookup(n.name);
      if (next === undefined) throw lens.missingError(n.name);
      walk(next);
      return;
    }
    switch (n.kind) {
      case 'array':
        sawArray = true;
        return;
      case 'leaf':
        sawLeaf = true;
        return;
      case 'plain':
        sawPlain = true;
        return;
      case 'xml-fragment':
        sawXml = true;
        return;
      case 'map':
        sawMap = true;
        return;
      case 'union':
        for (const m of n.members) walk(m);
        return;
      case 'root':
        return;
    }
  };
  for (const n of nodeSet) walk(n);
  if (sawArray) return { ok: true };
  if (sawLeaf) return { ok: false, message: `路径不存在："${seg}" 位是原生叶子（leaf）终态，不接受下钻` };
  if (sawPlain) return { ok: false, message: `路径不存在："${seg}" 位是 YPlainArray 纯值终态，只能整体替换` };
  if (sawXml) {
    return { ok: false, message: `路径不存在："${seg}" 位是 YXmlFragment 不透明终态，路径下钻守卫到此为止（ADR 0003 §5）` };
  }
  if (sawMap) {
    return typeof seg === 'string'
      ? { ok: false, message: `路径不存在：未知字段 "${seg}"（封闭对象不接受未声明键）` }
      : { ok: false, message: `路径段类型错误：对象位置需要 string 键段，收到 ${jsonTypeOf(seg)}` };
  }
  return { ok: false, message: `路径不存在：段 "${seg}" 无法在结构树中下钻` };
}

function rejectRow4(seg: number, len: number, path: Array<string | number>): ValidateResult {
  return {
    ok: false,
    issues: [{ message: `数组下标越界：下标 ${seg} 超出当前长度 ${len}（替换语义要求 0 ≤ n < len）`, path: [...path] }],
  };
}

function rejectRow11(
  seg: string | number,
  expected: 'plain object' | '数组',
  actual: unknown,
  path: Array<string | number>,
): ValidateResult {
  return {
    ok: false,
    issues: [
      {
        message: `路径穿越缺失或类型不符的容器：段 "${seg}" 需要 ${expected}，实际 ${jsonTypeOf(actual)}（字段级写入不自动创建/修复中间容器；请整体写入该容器值）`,
        path: [...path],
      },
    ],
  };
}

function rejectRow12(actual: unknown, path: Array<string | number>): ValidateResult {
  return {
    ok: false,
    issues: [
      {
        message: `目标数组缺失或当前值不是数组：实际 ${jsonTypeOf(actual)}（append/insert/delete 需要在场数组值）`,
        path: [...path],
      },
    ],
  };
}

/**
 * 结构守卫（§3.2）：结构段判定先于一切 base 检查；base 检查两段式（R2 冻结②）；
 * 边界判定按 §3.3 五规则（优先级命中即止，union 穿越首次即冻结）。一切守卫拒绝
 * = 恰 1 条 issue，path = 完整尝试路径（D3/D6/F6）；异常 → 顶层 run() 收编 E100。
 */
function guardWalk(
  derived: DerivedSchema,
  base: Record<string, unknown>,
  path: Array<string | number>,
  op: Op,
  index?: number,
): GuardResult {
  if (derived.structure.kind !== 'root') {
    throw new InternalError('结构树缺少 root 节点（手造派生物）');
  }
  const sLens = structureLens(derived.aliases);

  let S = new Set<StructureNode>([walkRefChain(derived.structure.node, sLens)]);
  let b: unknown = base;
  let boundary: Boundary | undefined; // 规则 1：第一个被穿越的 union 位（首次即冻结）
  let parentBase: unknown = base; // 终段父容器（推进前）——规则 2/3 的边界基值
  let finalViaRecord = false;
  let finalViaArray = false;

  for (let i = 0; i < path.length; i++) {
    const seg = path[i]!;
    const isFinal = i === path.length - 1;

    // —— 结构段判定（先于一切 base 检查：路径不存在时无需看 base）——
    const drill = drillStep(S, seg, sLens);
    if (drill.out.size === 0) {
      return {
        ok: false,
        result: { ok: false, issues: [{ message: structureRejectMessage(drill.forms, seg), path: [...path] }] },
      };
    }

    // —— union 穿越（首次即冻结；边界 = 第一个被穿越的 union 位，§3.3 规则 1）——
    if (boundary === undefined && drill.crossedUnion) {
      boundary = { prefix: path.slice(0, i), base: b, relPath: path.slice(i), node: null as unknown as ValueSchema };
    }

    // —— 数组三操作结构侧前置判定（目标位须含 array 候选；终态行 7/8/9）——
    if (op !== 'replace' && isFinal) {
      const target = targetHasArrayCandidate(drill.out, sLens, seg);
      if (!target.ok) {
        return { ok: false, result: { ok: false, issues: [{ message: target.message, path: [...path] }] } };
      }
    }

    // —— base 段检查（R2 冻结②：① 形态 → ② 在场/越界）——
    // ① 形态检查（对父容器 b）：string 段 → plain object；number 段 → Array
    if (typeof seg === 'string') {
      if (!isPlainObject(b)) {
        return { ok: false, result: rejectRow11(seg, 'plain object', b, path) };
      }
    } else if (!Array.isArray(b)) {
      return { ok: false, result: rejectRow11(seg, '数组', b, path) };
    }

    // ② 在场/越界检查
    if (op === 'replace') {
      if (isFinal) {
        // 终段 replace：object 形不查在场（写入即创建/覆盖）；array 形查越界（矩阵行 4）
        if (typeof seg === 'number' && seg >= (b as unknown[]).length) {
          return { ok: false, result: rejectRow4(seg, (b as unknown[]).length, path) };
        }
      } else if (typeof seg === 'string') {
        if (!present(b as Record<string, unknown>, seg)) {
          return { ok: false, result: rejectRow11(seg, 'plain object', undefined, path) };
        }
      } else if (!(seg >= 0 && seg < (b as unknown[]).length)) {
        return { ok: false, result: rejectRow11(seg, '数组', undefined, path) };
      }
    } else if (isFinal) {
      // 终段数组三操作：查在场且子值须为 Array（矩阵行 12，F5）
      let child: unknown;
      if (typeof seg === 'string') {
        if (!present(b as Record<string, unknown>, seg)) {
          return { ok: false, result: rejectRow12(undefined, path) };
        }
        child = (b as Record<string, unknown>)[seg];
      } else {
        const arr = b as unknown[];
        if (!(seg >= 0 && seg < arr.length)) {
          return { ok: false, result: rejectRow12(undefined, path) };
        }
        child = arr[seg];
      }
      if (!Array.isArray(child)) {
        return { ok: false, result: rejectRow12(child, path) };
      }
    } else if (typeof seg === 'string') {
      if (!present(b as Record<string, unknown>, seg)) {
        return { ok: false, result: rejectRow11(seg, 'plain object', undefined, path) };
      }
    } else if (!(seg >= 0 && seg < (b as unknown[]).length)) {
      return { ok: false, result: rejectRow11(seg, '数组', undefined, path) };
    }

    // —— 节点集推进 + base 游标推进 ——
    S = drill.out;
    if (isFinal) {
      parentBase = b; // 终段父容器（= 目标位父容器，推进前）
      finalViaRecord = drill.viaRecord;
      finalViaArray = drill.viaArray;
    }
    b = typeof seg === 'string' ? (b as Record<string, unknown>)[seg] : (b as unknown[])[seg];

    // —— insert/delete 下标域检查（D2 闭区间 [0, len]；D1 越界归运行时）——
    if ((op === 'insert' || op === 'delete') && isFinal) {
      const len = (b as unknown[]).length; // row 12 已保证目标为 Array
      const inRange = op === 'insert' ? index! >= 0 && index! <= len : index! >= 0 && index! < len;
      if (!inRange) {
        return {
          ok: false,
          result: {
            ok: false,
            issues: [
              {
                message:
                  op === 'insert'
                    ? `数组下标越界：下标 ${index} 超出当前长度 ${len}（insert 允许 0 ≤ n ≤ len）`
                    : `数组下标越界：下标 ${index} 超出当前长度 ${len}（delete 允许 0 ≤ n < len）`,
                path: [...path, index!],
              },
            ],
          },
        };
      }
    }
  }

  // —— 边界定夺（§3.3 五规则，按优先级命中即止）——
  let prefix: Array<string | number>;
  let baseAtBoundary: unknown;
  let relPath: Array<string | number>;
  if (boundary !== undefined) {
    // 规则 1：第一个被穿越的 union 位
    prefix = boundary.prefix;
    baseAtBoundary = boundary.base;
    relPath = boundary.relPath;
  } else if (op === 'replace' && finalViaRecord) {
    // 规则 2：终段经 '<key>' 放行（Record 动态键）→ Record 位（键 Pattern 随写入判定，D4）
    prefix = path.slice(0, path.length - 1);
    baseAtBoundary = parentBase;
    relPath = [path[path.length - 1]!];
  } else if (op === 'replace' && finalViaArray) {
    // 规则 3：终段为数组下标 → 数组位（元素写入的重建单位是数组，AC6#2 冻结）
    prefix = path.slice(0, path.length - 1);
    baseAtBoundary = parentBase;
    relPath = [path[path.length - 1]!];
  } else if (op !== 'replace') {
    // 规则 4：数组三操作 → 目标数组位
    prefix = path;
    baseAtBoundary = b;
    relPath = [];
  } else {
    // 规则 5：其余（终态整值替换 / 封闭对象字段写入 / union 位整值替换）→ 目标位本身
    prefix = path;
    baseAtBoundary = b;
    relPath = [];
  }
  const node = descendValues(derived.values, prefix);
  return { ok: true, boundary: { prefix, node, base: baseAtBoundary, relPath } };
}

/**
 * 值树游标下钻（R2 冻结①）：初始化与每次取子前后恒归一化——解 optional（仅字段位）
 * → 共享值树透镜解析 ref 链至非 ref（memo 调用局部，纯函数契约）；边界产出节点恒
 * 为归一化节点（非 ref、非 optional）。归一化后游标非 object/array 无法按段取子 =
 * 手造/篡改派生物的两树分歧 → InternalError → E100（loud，不静默降级）。
 */
function descendValues(values: Record<string, ValueSchema>, prefix: Array<string | number>): ValueSchema {
  const memo = new Map<ValueSchema, ValueSchema>();
  const vLens = valueLens(values);
  if (!Object.hasOwn(values, 'ROOT')) throw new InternalError('值树缺少 ROOT 别名');
  let cur = walkRefChain(values['ROOT']!, vLens, memo);
  for (const seg of prefix) {
    cur = walkRefChain(cur, vLens, memo); // 取子前归一化
    if (cur.kind === 'object') {
      if (typeof seg !== 'string') throw new InternalError('两树形状分歧: 值树游标为对象而路径段非 string');
      let field: ValueSchema | undefined;
      for (const f of cur.fields) {
        if (f.name === seg) {
          field = f.value;
          break;
        }
      }
      if (field === undefined) {
        for (const f of cur.fields) {
          if (f.name === '<key>') {
            field = f.value;
            break;
          }
        }
      }
      if (field === undefined) throw new InternalError(`两树形状分歧: 值树缺少字段 "${seg}"`);
      cur = field;
      if (cur.kind === 'optional') cur = cur.value; // 仅对象字段位可能出现 optional 包装（D10）
    } else if (cur.kind === 'array') {
      if (typeof seg !== 'number' || !Number.isInteger(seg) || seg < 0) {
        throw new InternalError('两树形状分歧: 值树游标为数组而路径段非非负整数');
      }
      cur = cur.element;
    } else {
      throw new InternalError('两树形状分歧: 值树游标非 object/array 无法按段取子');
    }
  }
  return walkRefChain(cur, vLens, memo); // 取子后归一化；边界产出节点恒归一化
}

// —— §3.5 统一重建原语（四种 op 共用；拷贝式、零原地突变）——

/** 沿 relPath 取子（读取侧 Object.hasOwn 守卫——原型污染防护纪律）。 */
function childValue(v0: unknown, head: string | number): unknown {
  if (typeof head === 'number') return (v0 as unknown[])[head];
  const obj = v0 as Record<string, unknown>;
  return Object.hasOwn(obj, head) ? obj[head] : undefined;
}

/**
 * rebuildOp（§3.5）：relPath 为空 → op 直接作用于 v0；非空 → 沿 relPath 拷贝式下降
 * （对象用计算键展开 `{...o, [k]: 下层}`，数组用切片），在末端应用 op——全程零
 * 原地突变（纯函数契约）；计算键防原型污染（'__proto__' 落为自有属性而非原型设置）。
 */
function rebuildOp(v0: unknown, relPath: Array<string | number>, op: Op, payload: unknown, index?: number): unknown {
  if (relPath.length === 0) {
    switch (op) {
      case 'replace':
        return payload;
      case 'append':
        return [...(v0 as unknown[]), payload];
      case 'insert': {
        const arr = v0 as unknown[];
        const idx = index!;
        return [...arr.slice(0, idx), payload, ...arr.slice(idx)];
      }
      case 'delete': {
        const arr = v0 as unknown[];
        const idx = index!;
        return [...arr.slice(0, idx), ...arr.slice(idx + 1)];
      }
    }
  }
  const head = relPath[0]!;
  const rest = relPath.slice(1);
  const child = rebuildOp(childValue(v0, head), rest, op, payload, index);
  if (typeof head === 'number') {
    const arr = v0 as unknown[];
    return [...arr.slice(0, head), child, ...arr.slice(head + 1)];
  }
  return { ...(v0 as Record<string, unknown>), [head]: child };
}

// —— §3.4 值校验段：共享解释器 + 路径 rebase ——

function finish(derived: DerivedSchema, boundary: Boundary, rebuilt: unknown): ValidateResult {
  const sub = validateSubtree(derived.values, boundary.node, rebuilt);
  if (sub.ok) return { ok: true };
  return {
    ok: false,
    issues: sub.issues.map((issue) => ({ message: issue.message, path: [...boundary.prefix, ...issue.path] })),
  };
}

// —— §3.6 输入规整与 loud 边界 ——

/** 顶层崩溃边界（F6）：任何内部异常收编为单条 E100（issue path = []，与 validateLogicalSnapshot 同款）。 */
function run(fn: () => ValidateResult): ValidateResult {
  try {
    return fn();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, issues: [{ message: `VFSL-E100: 内部错误（意外异常）: ${detail}`, path: [] }] };
  }
}

/** path 规整：非数组 / 空数组 / 含非 string|number 段 → 拒绝（issue path = []，F6）。 */
function normalizePath(path: unknown): { ok: true } | { ok: false; result: ValidateResult } {
  if (!Array.isArray(path) || path.length === 0) {
    return { ok: false, result: { ok: false, issues: [{ message: 'patch 路径无效：须为非空 string|number 段数组', path: [] }] } };
  }
  for (const seg of path) {
    if (typeof seg !== 'string' && typeof seg !== 'number') {
      return { ok: false, result: { ok: false, issues: [{ message: 'patch 路径无效：须为非空 string|number 段数组', path: [] }] } };
    }
  }
  return { ok: true };
}

/** index 规整：非有限整数 → 拒绝（issue path = 完整尝试路径，F6）。 */
function normalizeIndex(index: unknown, path: Array<string | number>): { ok: true } | { ok: false; result: ValidateResult } {
  if (typeof index !== 'number' || !Number.isInteger(index)) {
    return {
      ok: false,
      result: { ok: false, issues: [{ message: `数组下标无效：须为整数，收到 ${jsonTypeOf(index)}`, path: [...path] }] },
    };
  }
  return { ok: true };
}

function rejectUndefinedValue(path: Array<string | number>): ValidateResult {
  return {
    ok: false,
    issues: [{ message: 'patch 值不能为 undefined（JSON 值域外；数组删除请用 validateDeleteFromArray）', path: [...path] }],
  };
}

// —— 公共接缝（§3.1；D1 命名与 SA6 测试导出名逐字一致）——

/**
 * 路径级写入校验：结构守卫（路径存在性）+ 最近结构边界重建整值校验。
 * 同步、纯函数、不抛错；不修改 derived 与 base；结果纯 JSON 值。
 */
export function validatePatch(derived: DerivedSchema, base: unknown, path: Array<string | number>, value: unknown): ValidateResult {
  return run(() => {
    const p = normalizePath(path);
    if (!p.ok) return p.result;
    if (!isPlainObject(base)) {
      return { ok: false, issues: [{ message: '当前文档值（base）缺失或不是对象：无法定位 ROOT 容器', path: [...path] }] };
    }
    if (value === undefined) return rejectUndefinedValue(path);
    const g = guardWalk(derived, base, path, 'replace');
    if (!g.ok) return g.result;
    const rebuilt = rebuildOp(g.boundary.base, g.boundary.relPath, 'replace', value);
    return finish(derived, g.boundary, rebuilt);
  });
}

/** 数组追加（value = 单元素）：目标数组在场 + 重建后过子 schema。 */
export function validateAppendToArray(derived: DerivedSchema, base: unknown, path: Array<string | number>, value: unknown): ValidateResult {
  return run(() => {
    const p = normalizePath(path);
    if (!p.ok) return p.result;
    if (!isPlainObject(base)) {
      return { ok: false, issues: [{ message: '当前文档值（base）缺失或不是对象：无法定位 ROOT 容器', path: [...path] }] };
    }
    if (value === undefined) return rejectUndefinedValue(path);
    const g = guardWalk(derived, base, path, 'append');
    if (!g.ok) return g.result;
    const rebuilt = rebuildOp(g.boundary.base, g.boundary.relPath, 'append', value);
    return finish(derived, g.boundary, rebuilt);
  });
}

/** 数组插入（index ∈ [0, len]，len = 末尾 append 位，D2）：重建后过子 schema。 */
export function validateInsertIntoArray(
  derived: DerivedSchema,
  base: unknown,
  path: Array<string | number>,
  index: number,
  value: unknown,
): ValidateResult {
  return run(() => {
    const p = normalizePath(path);
    if (!p.ok) return p.result;
    if (!isPlainObject(base)) {
      return { ok: false, issues: [{ message: '当前文档值（base）缺失或不是对象：无法定位 ROOT 容器', path: [...path] }] };
    }
    if (value === undefined) return rejectUndefinedValue(path);
    const idx = normalizeIndex(index, path);
    if (!idx.ok) return idx.result;
    const g = guardWalk(derived, base, path, 'insert', index);
    if (!g.ok) return g.result;
    const rebuilt = rebuildOp(g.boundary.base, g.boundary.relPath, 'insert', value, index);
    return finish(derived, g.boundary, rebuilt);
  });
}

/** 数组删除（index ∈ [0, len-1]）：重建删除后数组过子 schema——残留元素也校验。 */
export function validateDeleteFromArray(
  derived: DerivedSchema,
  base: unknown,
  path: Array<string | number>,
  index: number,
): ValidateResult {
  return run(() => {
    const p = normalizePath(path);
    if (!p.ok) return p.result;
    if (!isPlainObject(base)) {
      return { ok: false, issues: [{ message: '当前文档值（base）缺失或不是对象：无法定位 ROOT 容器', path: [...path] }] };
    }
    const idx = normalizeIndex(index, path);
    if (!idx.ok) return idx.result;
    const g = guardWalk(derived, base, path, 'delete', index);
    if (!g.ok) return g.result;
    const rebuilt = rebuildOp(g.boundary.base, g.boundary.relPath, 'delete', undefined, index);
    return finish(derived, g.boundary, rebuilt);
  });
}
