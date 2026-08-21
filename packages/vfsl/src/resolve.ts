/**
 * 包内共享解析器（ADR 0003 §4「解析动作由包内共享解析器完成」；issue #20）。
 *
 * 求值期一切「沿别名链取最终形状」的动作集中于此模块（内部件，不进公共面；
 * 后续 validateSnapshot 票复用）。四个能力（设计 §3.1）：
 *
 * （1）bodies: Map<string, VfslType>——别名名 → 身体（module.aliases 一次展开；
 *      E302 保证合法模块名唯一；手造 IR 重名 → throw Internal，不静默覆盖）；
 * （2）resolveChain(t)——迭代循环沿 ref 链走到非 ref；重入（环）→ throw Internal
 *      （E106 不变量）；名缺席 → throw Internal（E301 不变量）；
 * （3）computeCls——名字级 memo 帧栈迭代（memo-on-completion；E106 保证纯 DAG），
 *      Cls = 'scalar' | 'map' | 'container'（IR 侧三桶折叠）；
 * （4）typeCls(t)——任意类型 Cls 查询（ref 查表 / union 折叠 / 其余 localCls），
 *      以 Resolver 方法形态暴露（issue #29 收敛，沿 resolveChain 先例）。
 *
 * 共享解析核心（issue #53 收敛，ADR 0003 §4）：while 循环算法全仓恰一份——
 * `walkRefChain<T>`（本文件）+ 三个参数化透镜（IR 透镜 = resolveChain 内部委托；
 * 值树透镜 = validate.ts resolveValues 内部委托；结构树透镜 = validate-patch.ts
 * 新增）。报错文案经各透镜工厂逐字节还原；memo 语义按 next-hop（可选）。
 *
 * 一切 Internal 均属 loud 边界：顶层 catch 收编为 E100（设计 §9），无静默降级。
 */
import type { VfslModule, VfslType } from './ir.js';

/** 求值期内部错误（不变量违反 = 解析层缺陷或手造 IR；顶层 catch → E100）。 */
export class InternalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InternalError';
  }
}

/** IR 侧三桶形状类别（求值器使用子集：解析层六值 Cls 的 ok 模块可达折叠）。 */
export type Cls = 'scalar' | 'map' | 'container';

/** 解析器能力面（结构树物化与值树映射共用的查询通道）。 */
export interface Resolver {
  bodies: Map<string, VfslType>;
  cls: Map<string, Cls>;
  /** 沿 ref 链迭代取终形（重入/缺席 → Internal；undefined → TypeError）。 */
  resolveChain(t: VfslType | undefined): VfslType;
  /** 任意类型查询 Cls（ref 查表；union 折叠；其余 localCls）——方法形态（issue #29 收敛）。 */
  typeCls(t: VfslType): Cls;
}

export function buildResolver(module: VfslModule): Resolver {
  const bodies = new Map<string, VfslType>();
  const seen = new Set<string>();
  for (const a of module.aliases) {
    if (seen.has(a.name)) {
      // I6（设计 §9）：E302 已保证合法模块名唯一；手造 IR 重名不得静默后者覆盖
      // （否则产出 ok:true 垃圾派生物）。
      throw new InternalError(`重复别名 ${a.name}`);
    }
    seen.add(a.name);
    bodies.set(a.name, a.type);
  }
  const cls = computeCls(bodies);
  return {
    bodies,
    cls,
    resolveChain: (t) => resolveChain(t, bodies),
    typeCls: (t) => typeCls(t, cls, bodies), // 闭包委托（沿 resolveChain 先例）
  };
}

/**
 * ref 链解析透镜（ADR 0003 §4「解析动作由包内共享解析器完成」的参数化实例）。
 * 三个类型域（IR / 值树 / 结构树）各提供一个透镜：报错文案经透镜工厂逐字节
 * 还原（IR 侧无冒号、值树/结构树侧带冒号）；查表责任在调用方（own 守卫 / Map.get）。
 */
export interface RefChainLens<T> {
  isRef(node: T): boolean;
  /** 仅在 isRef 为真时被调用。 */
  nameOf(node: T): string;
  lookup(name: string): T | undefined;
  cycleError(name: string): Error;
  missingError(name: string): Error;
}

/**
 * 包内共享解析核心（ADR 0003 §4；issue #53 收敛 resolve 双份——全仓 while 循环
 * 算法恰一份）：迭代沿 ref 链走到非 ref。环 → lens.cycleError（loud）；未知名 →
 * lens.missingError（loud）；memo（可选）按 next-hop 语义逐访问节点读写——与
 * #31 resolveValues 现状逐位一致。ref 链任意长度无栈增长。
 */
export function walkRefChain<T>(node: T, lens: RefChainLens<T>, memo?: Map<T, T>): T {
  const inFlight = new Set<string>();
  let cur = node;
  while (lens.isRef(cur)) {
    if (memo !== undefined) {
      const hit = memo.get(cur);
      if (hit !== undefined) {
        cur = hit;
        continue;
      }
    }
    const name = lens.nameOf(cur);
    if (inFlight.has(name)) throw lens.cycleError(name);
    inFlight.add(name);
    const next = lens.lookup(name);
    if (next === undefined) throw lens.missingError(name);
    if (memo !== undefined) memo.set(cur, next);
    cur = next;
  }
  return cur;
}

/**
 * 迭代沿 ref 链走到非 ref 类型（ref 链任意长度无栈增长，设计 §4.3）。
 * 重入（环，E106 不变量）→ Internal；名缺席（E301 不变量）→ Internal；
 * undefined（手造 IR 缺 ROOT）→ TypeError——均由顶层 catch 收编为 E100。
 */
function resolveChain(t: VfslType | undefined, bodies: Map<string, VfslType>): VfslType {
  if (t === undefined) {
    throw new TypeError('resolveChain: 空类型（手造 IR：ROOT 缺席）');
  }
  return walkRefChain(t, {
    isRef: (n): n is Extract<VfslType, { kind: 'ref' }> => n.kind === 'ref',
    nameOf: (n) => (n as Extract<VfslType, { kind: 'ref' }>).name,
    lookup: (name) => bodies.get(name),
    cycleError: (name) => new InternalError(`引用环: ${name}`),
    missingError: (name) => new InternalError(`未声明别名 ${name}`),
  });
}

/**
 * 局部归类（设计 §3.1 localCls；镜像 shapes.ts localCls——YPlainArray 上下文
 * 无关按标量形；对标记实参不下降，computeCls 不进入 YPlainArray 子树）。
 * 不接受 ref/union——查询位必须经 typeCls。
 */
function localCls(t: VfslType): Cls {
  switch (t.kind) {
    case 'primitive':
    case 'literal':
    case 'pattern':
      return 'scalar';
    case 'object':
    case 'record':
      return 'map';
    case 'array':
      return 'container';
    case 'marker':
      if (t.marker === 'YMap') return 'map';
      if (t.marker === 'YArray' || t.marker === 'YXmlFragment') return 'container';
      return 'scalar'; // YLeaf / YPlainArray
    case 'ref':
    case 'union':
      throw new InternalError('internal: localCls 不接受 ref/union，查询位必须经 typeCls');
  }
}

/**
 * 成员类别折叠（设计 §3.1 fold；镜像 shapes.ts synthesize 的 ok 模块可达子集）：
 *   全 scalar → 'scalar'；无 scalar 全 map → 'map'；无 scalar 含 container → 'container'；
 *   scalar 与 map/container 并存 → throw Internal（E309 不变量——非纯值全域的混合
 *   联合已被解析层拒绝；安全论证链 = 设计 §3.1 三防线 D1/D2/D3）。
 */
function fold(values: Cls[]): Cls {
  let hasScalar = false;
  let hasMap = false;
  let hasContainer = false;
  for (const v of values) {
    if (v === 'scalar') hasScalar = true;
    else if (v === 'map') hasMap = true;
    else hasContainer = true;
  }
  if (hasScalar && !hasMap && !hasContainer) return 'scalar';
  if (!hasScalar && hasMap && !hasContainer) return 'map';
  if (!hasScalar) return 'container';
  throw new InternalError('E309 不变量: 混合联合（标量形与容器形并存）');
}

/** 任意类型查询 Cls（ref 查表；union 折叠；其余 localCls）——Resolver.typeCls 的闭包委托目标。 */
function typeCls(t: VfslType, cls: Map<string, Cls>, bodies: Map<string, VfslType>): Cls {
  switch (t.kind) {
    case 'ref': {
      if (!bodies.has(t.name)) {
        throw new InternalError(`未声明别名 ${t.name}`);
      }
      const v = cls.get(t.name);
      if (v === undefined) {
        // memo-on-completion 保证被引用名必已 memo——这里兜底防手造 IR 的环绕序。
        throw new InternalError(`internal: 别名 ${t.name} 未求值`);
      }
      return v;
    }
    case 'union':
      // 成员恒非内联联合（文法）；ref 成员查表（深度 = 图直径，非嵌套深度）。
      return fold(t.members.map((m) => typeCls(m, cls, bodies)));
    default:
      return localCls(t);
  }
}

/**
 * 名字级 memo 帧栈迭代求值（设计 §3.1（3）；镜像 shapes.ts computeStrForm 第二步：
 * memo-on-completion，E106 保证纯 DAG——帧栈只沿名字级 ref 依赖下降）。
 * 名字依赖 = 身体为 ref → 目标名；身体为联合 → 顶层 ref 成员名；其余无依赖。
 * 重入（环，手造 IR）→ throw Internal。
 */
function computeCls(bodies: Map<string, VfslType>): Map<string, Cls> {
  const memo = new Map<string, Cls>();
  const inFlight = new Set<string>();

  /** 名字级依赖：身体顶层的 ref 名集合（联合成员为 ref 时查表；其余 localCls 原子归类）。 */
  const topRefs = (t: VfslType): string[] => {
    if (t.kind === 'ref') return [t.name];
    if (t.kind === 'union') {
      const refs: string[] = [];
      for (const m of t.members) {
        if (m.kind === 'ref') refs.push(m.name);
      }
      return refs;
    }
    return [];
  };

  interface Frame {
    name: string;
    refIndex: number;
    refs: string[];
    values: Cls[];
  }

  /** 名字的 Cls 求值（依赖值已收齐；ref 身体 → 单依赖值；联合 → fold；其余 localCls）。 */
  const computeFor = (name: string, values: Cls[]): Cls => {
    const body = bodies.get(name)!;
    if (body.kind === 'ref') return values[0]!;
    if (body.kind === 'union') {
      const memberCls: Cls[] = [];
      let refIdx = 0;
      for (const m of body.members) {
        if (m.kind === 'ref') {
          memberCls.push(values[refIdx]!);
          refIdx += 1;
        } else {
          memberCls.push(localCls(m));
        }
      }
      return fold(memberCls);
    }
    return localCls(body);
  };

  for (const name of bodies.keys()) {
    if (memo.has(name)) continue;
    const frames: Frame[] = [{ name, refIndex: 0, refs: topRefs(bodies.get(name)!), values: [] }];
    inFlight.add(name);
    while (frames.length > 0) {
      const f = frames[frames.length - 1]!;
      if (f.refIndex < f.refs.length) {
        const r = f.refs[f.refIndex]!;
        f.refIndex += 1;
        const mv = memo.get(r);
        if (mv !== undefined) {
          f.values.push(mv);
          continue;
        }
        if (inFlight.has(r)) {
          throw new InternalError(`引用环: ${r}`);
        }
        if (!bodies.has(r)) {
          throw new InternalError(`未声明别名 ${r}`);
        }
        inFlight.add(r);
        frames.push({ name: r, refIndex: 0, refs: topRefs(bodies.get(r)!), values: [] });
      } else {
        memo.set(f.name, computeFor(f.name, f.values)); // memo-on-completion：值收齐才写
        inFlight.delete(f.name);
        frames.pop();
        const parent = frames[frames.length - 1];
        if (parent !== undefined) parent.values.push(memo.get(f.name)!);
      }
    }
  }
  return memo;
}
