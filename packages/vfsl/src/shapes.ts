/**
 * 形状体系（设计 §5）：别名解析后的物化形状类别（Cls 六值）+ 六个错误码
 * E304 / E306 / E307 / E309（#6）+ E310 / E311（#19 ROOT 完整性）的候选收集。
 *
 * - computeCls：迭代 Tarjan SCC 分解 + SCC 弹出即求值（§5.2 R4）——环 SCC 全成员
 *   取切环合成均匀值（表值与声明序/起点序无关）；分量池 = 顶层分量（§8-19 R5 钉死：
 *   体为 ref → 该 ref；体为联合 → 顶层成员；体为叶 → 该叶 localCls；容器叶内部嵌套
 *   ref 仅作图边，不入池）。
 * - clsOf：统一查询助手（§5.1 R3，含 union 行）——E304/E309 的一切查询位只经此助手。
 * - computeStrForm：两步法（§5.4 R3）——cycNames（on-cycle 灰 DFS + 反向传播）预填 ⊥、
 *   名字级 memo 帧栈迭代求值（memo-on-completion）；strFormOf 为 O(1) 查询助手（E306）。
 * - containsSync + pvCheck：E307（§5.5，反向可达 worklist；锚 = 标记记号 / 实参内
 *   最外层引入引用记号）。
 * - 桶级扫描：E309（§5.6 R4）——六值 Cls → 规格三分类桶（bucket(map)=bucket(container)），
 *   mixed 成员本身即异类锚；首成员不确定 → 整联合不裁决，中位不确定成员透明跳过。
 * - 命名空间根完整性（#19，spec §3）：E310 缺 ROOT（锚模块起始 1:1 硬编码）；
 *   E311 ROOT 非 map 形（锚类型表达式起点记号）——clsOf 一次查询，cycle/unknown
 *   不裁决（身份归还 E106/E301/终判通道，闭环证明见 #19 设计 §5）。
 *
 * 全部图遍历迭代实现（#5 §15.3 纪律）；「不裁决」类（'unknown'/'cycle'/⊥）的错误
 * 身份归还 E301 / E106 / 终判通道（§5.2/§5.4 闭环证明），无静默 ok:true 路径。
 */
import { ErrCode, makeIssue } from './errors.js';
import type { AstAlias, AstType, MarkerName } from './parser.js';
import type { VfslIssue } from './ir.js';

/** 候选（与 semantic.ts 的 Candidate 结构同构，聚合时并入同一候选池）。 */
export interface ShapeCandidate {
  issue: VfslIssue;
  code: number;
}

type Cls = 'scalar' | 'map' | 'container' | 'mixed' | 'cycle' | 'unknown';
type StrForm = boolean | null; // null = ⊥（不下裁决）

/** 判别联合窄化（walk 收集位与检查函数参数用）。 */
type MarkerNode = Extract<AstType, { kind: 'marker' }>;
type RecordNode = Extract<AstType, { kind: 'record' }>;
type UnionNode = Extract<AstType, { kind: 'union' }>;

/** 同步标记（E307 禁令对象；§5.5）。 */
const SYNC_MARKERS: ReadonlySet<MarkerName> = new Set(['YMap', 'YArray', 'YXmlFragment']);

// —— 模块级 walk（inPV = 纯值上下文旗标：仅 YPlainArray 文本实参子树置真，§5.6）——

function walkModule(
  t: AstType,
  inPV: boolean,
  visit: (t: AstType, inPV: boolean) => void,
): void {
  visit(t, inPV);
  switch (t.kind) {
    case 'object':
      for (const f of t.fields) walkModule(f.type, inPV, visit);
      break;
    case 'union':
      for (const m of t.members) walkModule(m, inPV, visit);
      break;
    case 'array':
      walkModule(t.element, inPV, visit);
      break;
    case 'record':
      walkModule(t.key, inPV, visit);
      walkModule(t.value, inPV, visit);
      break;
    case 'marker':
      walkModule(t.arg, t.marker === 'YPlainArray' ? true : inPV, visit);
      break;
    default:
      break; // primitive / literal / ref / pattern / generic-diag（无子节点）
  }
}

/** 任意深度 ref 收集（引用图边 / E301 收集器同源遍历，§9-10）。 */
function collectRefs(t: AstType, out: Set<string>): void {
  switch (t.kind) {
    case 'ref':
      out.add(t.name);
      return;
    case 'object':
      for (const f of t.fields) collectRefs(f.type, out);
      return;
    case 'union':
      for (const m of t.members) collectRefs(m, out);
      return;
    case 'array':
      collectRefs(t.element, out);
      return;
    case 'record':
      collectRefs(t.key, out);
      collectRefs(t.value, out);
      return;
    case 'marker':
      collectRefs(t.arg, out);
      return;
    default:
      return; // primitive / literal / pattern / generic-diag
  }
}

function nodePos(t: AstType): { line: number; column: number } {
  return t.kind === 'generic-diag' ? t.namePos : t.pos;
}

// —— 形状基础（§5.1/§5.2）——

/**
 * 局部 Cls（§5.2 localCls）：除联合外一切节点局部可定；generic-diag 恒 'unknown'
 * （必产自己的终判候选）。ref/union 不接受——查询位必须经 clsOf。
 */
function localCls(t: AstType): Cls {
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
      return 'scalar'; // YLeaf / YPlainArray（上下文无关，§8-3）
    case 'generic-diag':
      return 'unknown'; // §8-14：终判通道独占，不下裁决
    case 'ref':
    case 'union':
      throw new Error('internal: localCls 不接受 ref/union，查询位必须经 clsOf');
  }
}

/**
 * 成员类别折叠（§5.2）：'unknown' 主导传播；'cycle' 经 eff 移除（纯环 → 'cycle'）；
 * 任一 'mixed' → 'mixed'；全 scalar/map 同值；全 ∈ {map, container} → 'container'；
 * scalar 与 container/map 并存 → 'mixed'。
 */
function synthesize(values: Cls[]): Cls {
  for (const v of values) {
    if (v === 'unknown') return 'unknown';
  }
  const eff: Cls[] = [];
  for (const v of values) {
    if (v !== 'cycle') eff.push(v);
  }
  if (eff.length === 0) return 'cycle';
  for (const v of eff) {
    if (v === 'mixed') return 'mixed';
  }
  let hasScalar = false;
  let hasMap = false;
  let hasContainer = false;
  for (const v of eff) {
    if (v === 'scalar') hasScalar = true;
    else if (v === 'map') hasMap = true;
    else hasContainer = true;
  }
  if (hasScalar && !hasMap && !hasContainer) return 'scalar';
  if (!hasScalar && hasMap && !hasContainer) return 'map';
  if (!hasScalar) return 'container';
  return 'mixed';
}

/** 前置归一（§5.2）：多体名 → 扁平虚拟联合（某体本身是联合则成员直接拼入）。 */
function normalizedBodies(bodiesByName: Map<string, AstType[]>): Map<string, AstType[]> {
  const out = new Map<string, AstType[]>();
  for (const [name, bodies] of bodiesByName) {
    if (bodies.length === 1) {
      out.set(name, [bodies[0]!]);
    } else {
      const flat: AstType[] = [];
      for (const b of bodies) {
        if (b.kind === 'union') flat.push(...b.members);
        else flat.push(b);
      }
      out.set(name, flat);
    }
  }
  return out;
}

/**
 * 顶层分量（§5.2/§8-19）：体为 ref → 该 ref；体为联合 → 顶层成员（ref/叶）；
 * 体为叶 → 该叶。容器叶内部嵌套 ref 仅作图边（环归属与缩点依据），不入分量池。
 */
function topComponents(bodies: AstType[]): AstType[] {
  const comps: AstType[] = [];
  for (const b of bodies) {
    if (b.kind === 'union') comps.push(...b.members);
    else comps.push(b);
  }
  return comps;
}

// —— computeCls：迭代 Tarjan SCC 分解 + SCC 弹出即求值（§5.2 R4）——

function computeCls(
  bodiesByName: Map<string, AstType[]>,
  refsByName: Map<string, string[]>,
  refNames: Set<string>,
  declared: Set<string>,
): Map<string, Cls> {
  const memo = new Map<string, Cls>();
  const comp = (r: string): Cls => {
    if (!declared.has(r)) return 'unknown';
    return memo.get(r) ?? 'unknown'; // 防御性带保险——弹出序下被引用 SCC 必已 memo
  };

  const normalized = normalizedBodies(bodiesByName);

  // 自环名（归一体含指向自身的 ref，任意深度）
  const selfRefs = new Set<string>();
  for (const [name, refs] of refsByName) {
    if (refs.includes(name)) selfRefs.add(name);
  }

  interface TarjanFrame {
    name: string;
    edgeIndex: number;
    low: number;
  }
  const index = new Map<string, number>();
  const tstack: string[] = [];
  const onStack = new Set<string>();
  let counter = 0;

  /** SCC 弹出即求值（弹出序 = 缩点 DAG 依赖在前序——被引用 SCC 均已 memo）。 */
  const evaluate = (scc: string[]): void => {
    const sccSet = new Set(scc);
    const isCycle = scc.length > 1 || selfRefs.has(scc[0]!);
    // 分量池 = ∪ 各成员归一体顶层分量（§8-19 顶层分解钉死）
    const values: Cls[] = [];
    for (const name of scc) {
      for (const c of topComponents(normalized.get(name)!)) {
        if (c.kind === 'ref') {
          // 顶层环内 ref 一致记 'cycle' 分量；S 外 SCC 已求值经 comp 取值
          values.push(isCycle && sccSet.has(c.name) ? 'cycle' : comp(c.name));
        } else {
          values.push(localCls(c)); // 容器叶按 localCls 原子归类（内部联合/ref 不参与）
        }
      }
    }
    const v = synthesize(values);
    for (const name of scc) memo.set(name, v); // SCC 均匀指派——图函数，两序同值
  };

  for (const name of normalized.keys()) {
    if (index.has(name)) continue;
    const frames: TarjanFrame[] = [];
    const pushFrame = (n: string): void => {
      index.set(n, counter);
      frames.push({ name: n, edgeIndex: 0, low: counter });
      counter += 1;
      tstack.push(n);
      onStack.add(n);
    };
    pushFrame(name);
    while (frames.length > 0) {
      const f = frames[frames.length - 1]!;
      const edges = refsByName.get(f.name) ?? [];
      if (f.edgeIndex < edges.length) {
        const r = edges[f.edgeIndex]!;
        f.edgeIndex += 1;
        const ri = index.get(r);
        if (ri === undefined) {
          pushFrame(r); // 树边
        } else if (onStack.has(r)) {
          f.low = Math.min(f.low, ri); // 回边 / 栈内交叉边
        }
        // 已弹出 SCC 的节点 → 忽略（跨边）
      } else {
        frames.pop();
        if (f.low === index.get(f.name)) {
          // SCC 根：弹出 tstack 至 f.name → 求值
          const scc: string[] = [];
          for (;;) {
            const top = tstack.pop()!;
            onStack.delete(top);
            scc.push(top);
            if (top === f.name) break;
          }
          evaluate(scc);
        } else {
          // 非根：low 上溯给父帧（树边传播）
          const parent = frames[frames.length - 1];
          if (parent !== undefined) {
            parent.low = Math.min(parent.low, f.low);
          }
        }
      }
    }
  }

  // 第 2 步：未声明名显式入表（N1「表覆盖一切被引用名」承诺，§3.3/§5.2）
  for (const r of refNames) {
    if (!declared.has(r)) memo.set(r, 'unknown');
  }
  return memo;
}

// —— 统一查询助手 clsOf（§5.1 R3：含 union 行；查询位只经此助手）——

function clsOf(t: AstType, cls: Map<string, Cls>, declared: Set<string>): Cls {
  switch (t.kind) {
    case 'ref':
      if (!declared.has(t.name)) return 'unknown';
      return cls.get(t.name) ?? 'unknown'; // 表完备——?? 为防御性带保险
    case 'union':
      // union 行（§8-16）：与别名联合/多体虚拟联合同一 synthesize；成员恒非联合 → 深度 ≤ 2
      return synthesize(t.members.map((m) => clsOf(m, cls, declared)));
    default:
      return localCls(t);
  }
}

// —— computeStrForm：两步法（§5.4 R3：cycNames 预填 ⊥ + 名字级 memo 帧栈求值）——

function computeStrForm(
  bodiesByName: Map<string, AstType[]>,
  refsByName: Map<string, string[]>,
  declared: Set<string>,
): Map<string, StrForm> {
  const strCls = new Map<string, StrForm>();

  // 第一步 1a：on-cycle 检测（迭代灰 DFS，帧循环与 semantic.ts E106 同构）
  const onCycle = new Set<string>();
  const gray = new Set<string>();
  const black = new Set<string>();
  for (const name of bodiesByName.keys()) {
    if (black.has(name)) continue;
    interface CycleFrame {
      name: string;
      edgeIndex: number;
    }
    const frames: CycleFrame[] = [{ name, edgeIndex: 0 }];
    gray.add(name);
    while (frames.length > 0) {
      const f = frames[frames.length - 1]!;
      const edges = refsByName.get(f.name) ?? [];
      if (f.edgeIndex >= edges.length) {
        gray.delete(f.name);
        black.add(f.name);
        frames.pop();
        continue;
      }
      const r = edges[f.edgeIndex]!;
      f.edgeIndex += 1;
      if (gray.has(r)) {
        // 回边 → 祖先到栈顶帧段全员 on-cycle（帧段即一条真实环路径）
        const startIdx = frames.findIndex((fr) => fr.name === r);
        for (let i = startIdx; i < frames.length; i++) onCycle.add(frames[i]!.name);
      } else if (!black.has(r)) {
        gray.add(r);
        frames.push({ name: r, edgeIndex: 0 });
      }
    }
  }

  // 第一步 1b：反向传播（worklist，与 §5.5 containsSync 同款）→ cycNames
  const cycNames = new Set(onCycle);
  const referrers = new Map<string, string[]>();
  for (const [n, refs] of refsByName) {
    for (const r of refs) {
      const list = referrers.get(r) ?? [];
      if (!list.includes(n)) list.push(n);
      referrers.set(r, list);
    }
  }
  const queue = [...onCycle];
  while (queue.length > 0) {
    const n = queue.pop()!;
    for (const ref of referrers.get(n) ?? []) {
      if (!cycNames.has(ref)) {
        cycNames.add(ref);
        queue.push(ref);
      }
    }
  }

  // 第二步：名字级 memo 迭代求值（求值域 = 已声明名 \ cycNames，纯 DAG）
  for (const n of cycNames) strCls.set(n, null); // 预填 ⊥，永不进入求值域（§8-10 R3）
  for (const name of bodiesByName.keys()) {
    if (cycNames.has(name) || strCls.has(name)) continue;
    interface EvalFrame {
      name: string;
      bodyIndex: number;
      values: StrForm[];
    }
    const frames: EvalFrame[] = [{ name, bodyIndex: 0, values: [] }];
    while (frames.length > 0) {
      const f = frames[frames.length - 1]!;
      const bodies = bodiesByName.get(f.name)!;
      if (f.bodyIndex < bodies.length) {
        const b = bodies[f.bodyIndex]!;
        f.bodyIndex += 1;
        if (b.kind === 'ref') {
          const r = b.name;
          if (!declared.has(r)) {
            f.values.push(null); // 未声明 → ⊥（§8-13：E301 通道独占）
          } else {
            const v = strCls.get(r);
            if (v !== undefined) f.values.push(v);
            else frames.push({ name: r, bodyIndex: 0, values: [] }); // 引理：r ∉ cycNames 且不在栈上
          }
        } else {
          f.values.push(strFormOf(b, strCls, declared)); // 终端（此时 b 恒非 ref）
        }
      } else {
        strCls.set(f.name, fold(f.values)); // memo-on-completion：值收齐才写
        frames.pop();
      }
    }
  }
  return strCls;
}

/** 查询侧 O(1) 助手（§5.4）：string 形 = primitive string / pattern；其余 → false。 */
function strFormOf(t: AstType, strCls: Map<string, StrForm>, declared: Set<string>): StrForm {
  switch (t.kind) {
    case 'ref':
      if (!declared.has(t.name)) return null;
      return strCls.get(t.name) ?? null;
    case 'primitive':
      return t.name === 'string';
    case 'pattern':
      return true;
    case 'generic-diag':
      return null; // §8-14：终判通道独占
    default:
      return false; // number/unknown/字面量/对象/数组/record/marker/联合（§8-4）
  }
}

/** 无环名折叠（§8-10）：任一 false → false；否则任一 ⊥ → ⊥；否则 true。 */
function fold(values: StrForm[]): StrForm {
  for (const v of values) {
    if (v === false) return false;
  }
  for (const v of values) {
    if (v === null) return null;
  }
  return true;
}

// —— containsSync：反向可达（§5.5 第一步）——

function computeContainsSync(
  bodiesByName: Map<string, AstType[]>,
  refsByName: Map<string, string[]>,
): Set<string> {
  // 种子 = 体内容直接含同步标记节点的别名（任意 AST 深度；嵌套 YPlainArray 不屏蔽）
  const seeds = new Set<string>();
  for (const [name, bodies] of bodiesByName) {
    for (const b of bodies) {
      if (containsSyncMarker(b)) {
        seeds.add(name);
        break;
      }
    }
  }
  // 反向边 = { 引用者 → 被引用名 }（每别名体内全部 ref，任意深度，去重；多体取全部体并集）
  const referrers = new Map<string, string[]>();
  for (const [n, refs] of refsByName) {
    for (const r of refs) {
      const list = referrers.get(r) ?? [];
      if (!list.includes(n)) list.push(n);
      referrers.set(r, list);
    }
  }
  // worklist 自种子沿反向边传播 → 传递含同步标记的名字集
  const containsSync = new Set(seeds);
  const queue = [...seeds];
  while (queue.length > 0) {
    const n = queue.pop()!;
    for (const ref of referrers.get(n) ?? []) {
      if (!containsSync.has(ref)) {
        containsSync.add(ref);
        queue.push(ref);
      }
    }
  }
  return containsSync;
}

function containsSyncMarker(t: AstType): boolean {
  if (t.kind === 'marker') {
    if (SYNC_MARKERS.has(t.marker)) return true;
    return containsSyncMarker(t.arg); // 嵌套 YPlainArray / YLeaf 不屏蔽——禁令绝对覆盖整个子树
  }
  switch (t.kind) {
    case 'object':
      return t.fields.some((f) => containsSyncMarker(f.type));
    case 'union':
      return t.members.some(containsSyncMarker);
    case 'array':
      return containsSyncMarker(t.element);
    case 'record':
      return containsSyncMarker(t.key) || containsSyncMarker(t.value);
    default:
      return false; // primitive / literal / ref / pattern / generic-diag
  }
}

/** 第二步 pvCheck（§5.5）：每个 YPlainArray 节点走查其文本实参子树；不穿越 ref。 */
function pvCheck(
  t: AstType,
  containsSync: Set<string>,
  declared: Set<string>,
  add: (code: string, message: string, line: number, column: number) => void,
): void {
  switch (t.kind) {
    case 'marker':
      if (SYNC_MARKERS.has(t.marker)) {
        add(ErrCode.E307, `同步标记 ${t.marker} 出现在纯值上下文（YPlainArray 子树）`, t.pos.line, t.pos.column);
        return; // 不下降
      }
      pvCheck(t.arg, containsSync, declared, add); // YPlainArray / YLeaf：值语义标记在纯值上下文合法
      return;
    case 'generic-diag':
      return; // 跳过，不下裁决（终判通道独占，§8-14）
    case 'ref':
      // 锚 = 实参文本内的引用记号（§5.5 锚点规则）
      if (declared.has(t.name) && containsSync.has(t.name)) {
        add(ErrCode.E307, `别名 ${t.name} 经别名间接引入同步标记到纯值上下文`, t.pos.line, t.pos.column);
      }
      return; // 未声明 → 跳过（E301 候选已在池）
    case 'object':
      for (const f of t.fields) pvCheck(f.type, containsSync, declared, add);
      return;
    case 'array':
      pvCheck(t.element, containsSync, declared, add);
      return;
    case 'record':
      pvCheck(t.key, containsSync, declared, add); // 键位仍下降（§8-15 选项①）
      pvCheck(t.value, containsSync, declared, add);
      return;
    case 'union':
      for (const m of t.members) pvCheck(m, containsSync, declared, add);
      return;
    default:
      return; // primitive / literal / pattern
  }
}

// —— 六个错误码的候选收集（E304/E306/E307/E309 见 §5.3~§5.6；E310/E311 为 #19 ROOT 完整性）——

/** E304：标记实参形状（锚 = 标记名记号；一律经 clsOf）。 */
function checkE304(
  m: MarkerNode,
  cls: Map<string, Cls>,
  declared: Set<string>,
  add: (code: string, message: string, line: number, column: number) => void,
): void {
  const c = clsOf(m.arg, cls, declared);
  if (c === 'cycle' || c === 'unknown') return; // 不裁决（错误身份归还 E301/E106/终判通道）
  if (m.marker === 'YMap' || m.marker === 'YXmlFragment') {
    if (c !== 'map') {
      add(ErrCode.E304, `${m.marker} 实参非对象形（解析后形状: ${c}）`, m.pos.line, m.pos.column);
    }
  } else if (m.marker === 'YLeaf') {
    if (c !== 'scalar') {
      add(ErrCode.E304, `YLeaf 实参非标量形（解析后形状: ${c}）`, m.pos.line, m.pos.column);
    }
  }
  // YArray / YPlainArray：无形状约束
}

/** E306：Record 键 string 形（锚 = 键类型起点；⊥ 不裁决）。 */
function checkE306(
  r: RecordNode,
  strCls: Map<string, StrForm>,
  declared: Set<string>,
  add: (code: string, message: string, line: number, column: number) => void,
): void {
  if (strFormOf(r.key, strCls, declared) === false) {
    const p = nodePos(r.key);
    add(ErrCode.E306, 'Record 键类型非 string 形（string 形 = string / string & Pattern<…> / 其别名）', p.line, p.column);
  }
}

/** E309：同步物化上下文混合联合（§5.6 R4 桶级扫描；锚 = 首个异类成员起点）。 */
function checkE309(
  u: UnionNode,
  cls: Map<string, Cls>,
  declared: Set<string>,
  add: (code: string, message: string, line: number, column: number) => void,
): void {
  // 规格三分类桶折叠（§8-17）：map/container 同桶（物化细分非类别差异）；mixed 恒异类
  const bucket = (c: Cls): 'S' | 'C' | 'M' | null => {
    if (c === 'scalar') return 'S';
    if (c === 'map' || c === 'container') return 'C';
    if (c === 'mixed') return 'M';
    return null; // cycle / unknown → ⊥
  };
  const first = bucket(clsOf(u.members[0]!, cls, declared));
  if (first === null) return; // 首成员无确定类别 → 不裁决（T-q/T-y 锁定）
  for (const m of u.members) {
    const b = bucket(clsOf(m, cls, declared));
    if (b === null) continue; // 不确定成员透明跳过，不阻断后续确定成员比较
    if (b === 'M' || b !== first) {
      // mixed 成员本身即异类锚（含其为首成员）；否则首个与首成员桶不同的成员（左者胜）
      const p = nodePos(m);
      add(ErrCode.E309, '同步物化上下文混合联合：标量形与容器形并存', p.line, p.column);
      return; // 每联合至多一候选
    }
  }
}

/** E310：缺 ROOT（锚模块起始 1:1，硬编码——与声明位置、前导 trivia、BOM 无关；
 * 空文本无记号可锚亦成立）。declared 含 ROOT（含重复声明）即满足存在性——
 * 重复走既有 E302，不产 E310（semantic.ts:86-93）。 */
function checkE310(
  declared: Set<string>,
  add: (code: string, message: string, line: number, column: number) => void,
): void {
  if (!declared.has('ROOT')) {
    add(ErrCode.E310, '缺少 ROOT 别名: 模块未声明名为 ROOT 的命名空间根（大小写是契约，ROOT 固定物化为 Y.Map）', 1, 1);
  }
}

/** E311：ROOT 非 map 形，锚 ROOT 的类型表达式起点记号（nodePos）。逐声明体检查
 * （E302 多体场景每体独立裁决，各自入池由 min-position 裁定）。
 * cycle/unknown 不裁决——错误身份归还 E106/E301/终判通道（E304/E309 同纪律，
 * 闭环证明见 #19 设计 §5），无静默 ok:true 路径。 */
function checkE311(
  rootBodies: AstType[],
  cls: Map<string, Cls>,
  declared: Set<string>,
  add: (code: string, message: string, line: number, column: number) => void,
): void {
  for (const body of rootBodies) {
    const c = clsOf(body, cls, declared);
    if (c === 'cycle' || c === 'unknown') continue;
    if (c !== 'map') {
      const p = nodePos(body);
      add(ErrCode.E311, `ROOT 别名非 map 形: ROOT 固定物化为 Y.Map，仅接受裸对象 / YMap / Record / 全 map 形联合（解析后形状: ${c}）`, p.line, p.column);
    }
  }
}

// —— 入口：模块级候选收集（semantic.ts 聚合时调用）——

export function collectShapeCandidates(aliases: AstAlias[]): ShapeCandidate[] {
  const declared = new Set(aliases.map((a) => a.name));
  const bodiesByName = new Map<string, AstType[]>();
  for (const a of aliases) {
    const list = bodiesByName.get(a.name) ?? [];
    list.push(a.type);
    bodiesByName.set(a.name, list);
  }

  // 单遍模块 walk：ref 出现名（表完备输入）+ 四类检查位节点
  const refNames = new Set<string>();
  const markerNodes: MarkerNode[] = [];
  const recordNodes: RecordNode[] = [];
  const plainArrayNodes: MarkerNode[] = [];
  const unionNodes: UnionNode[] = [];
  for (const a of aliases) {
    walkModule(a.type, false, (t, inPV) => {
      if (t.kind === 'ref') refNames.add(t.name);
      if (t.kind === 'marker') {
        markerNodes.push(t);
        if (t.marker === 'YPlainArray') plainArrayNodes.push(t);
      }
      if (t.kind === 'record') recordNodes.push(t);
      if (t.kind === 'union' && !inPV) unionNodes.push(t);
    });
  }

  // 引用图（已声明 ref，任意深度，去重；未声明 ref 不入图——经 comp 直取 'unknown'）
  const refsByName = new Map<string, string[]>();
  for (const [name, bodies] of bodiesByName) {
    const refs = new Set<string>();
    for (const b of bodies) collectRefs(b, refs);
    const declaredRefs = [...refs].filter((r) => declared.has(r));
    if (declaredRefs.length > 0) refsByName.set(name, declaredRefs);
  }

  const cls = computeCls(bodiesByName, refsByName, refNames, declared);
  const strCls = computeStrForm(bodiesByName, refsByName, declared);
  const containsSync = computeContainsSync(bodiesByName, refsByName);

  const candidates: ShapeCandidate[] = [];
  const add = (code: string, message: string, line: number, column: number): void => {
    candidates.push({ issue: makeIssue(code, message, line, column), code: Number(code) });
  };
  for (const m of markerNodes) checkE304(m, cls, declared, add);
  for (const r of recordNodes) checkE306(r, strCls, declared, add);
  for (const p of plainArrayNodes) pvCheck(p.arg, containsSync, declared, add);
  for (const u of unionNodes) checkE309(u, cls, declared, add);

  // —— 命名空间根完整性（#19，spec §3「命名空间根」：E310/E311）——
  checkE310(declared, add);
  checkE311(bodiesByName.get('ROOT') ?? [], cls, declared, add);
  return candidates;
}
