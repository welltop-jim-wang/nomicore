/**
 * 读路径语义 schema 解析（Issue #272 / ADR-0016「解析语义」节实施；SA1 设计
 * `wiki/raw/task_issue-272_design.md` §8 为落地蓝本）。
 *
 * `resolveSchemaAtPath(derived, path)`：给定派生 schema 与具体读路径，返回路径终点
 * 的语义 schema 投影四件套——值语义子树（ref 按名保留）+ 传递闭包别名表 +
 * docs/aliasDocs 注释寻址切片。供 namespace-runtime 的 readData 语义 schema 投影
 * （ADR-0016）组合使用。
 *
 * 解析语义与写侧路径守卫 drillStep（validate-patch.ts，issue #53 §3.3 规则 1，
 * 母法 ADR-0003 §3 any-of）同构：同一路径在写守卫合法 ⟺ 在读投影可解析。结构侧
 * 逐字复用 `drillStep` 本体（单源、不分叉——SA8 红线 3）；值侧镜像游走产出投影。
 *
 * 错误通道三分（互斥、全覆盖）：
 * ① path 敌意通道 + 值内容级拒绝 → 判别联合（SCHEMA_PATH_NOT_FOUND /
 *    SCHEMA_PATH_INVALID，path 为调用方数组的新鲜副本）；keyPattern 引擎四类错误
 *    （PatternCompileError/PatternUnsupportedError/PatternTooLargeError/
 *    PatternBudgetExceeded）不属可信域畸形——合法派生物可携带不可判定 Pattern
 *    （parser §9.1 推迟合法性校验，evaluate 原文透传零编译），四类按内容级
 *    fail-closed 收敛 SCHEMA_PATH_NOT_FOUND（与写侧 validate.ts L256–280 值级
 *    处理对偶）。
 * ② derived 可信域畸形（ref 目标缺失、值树引用环、两树分歧、root/ROOT 缺失、
 *    derived 非对象）与 keyPattern 判定中四类之外的意外异常 → throw
 *    `InternalError`（沿 validate-patch 先例；本函数无顶层 catch、不降级失败码）。
 * ③ 正常解析 → ok 投影。
 *
 * 同步、纯函数、零 memo（无跨调用状态；正则编译产物仅按正则串在单次调用内局部
 * 缓存，失败不缓存）。返回的 valueSchema/aliases 与调用方 derived 共享节点
 * （derived 不可变契约 + getCompiled 深冻结条目下引用即安全），消费者不得变异；
 * detached 深拷贝属 namespace-runtime 组合边界（ADR-0016 交付纪律）。解析与实际
 * 值/判别式缓存无关（ADR-0003 §3 透明性，全程不读 discriminator 键）。
 */
import type { DerivedSchema, StructureNode, ValueSchema } from './derived.js';
import { InternalError, walkRefChain } from './resolve.js';
import type { RefChainLens } from './resolve.js';
import { drillStep, structureLens } from './validate-patch.js';
import type { DrillResult } from './validate-patch.js';
import {
  PatternBudgetExceeded,
  PatternCompileError,
  PatternTooLargeError,
  PatternUnsupportedError,
  compile,
  match,
} from './pattern.js';
import type { CompiledPattern } from './pattern.js';

/** 读路径语义 schema 投影体（ADR-0016「投影体」四件套）。 */
export interface ReadDataSchemaProjection {
  /** 路径终点的值语义子树（ref 按名保留，不内联展开——ADR 0003 §4 同款纪律）。 */
  readonly valueSchema: ValueSchema;
  /** 传递闭包内被 valueSchema 引用到的别名（自包含、递归安全、JSON 可序列化）。 */
  readonly aliases: Record<string, ValueSchema>;
  /**
   * fieldDocs/markerDocs/memberDocs 的相关切片（ADR 0019 §7 三来源）：脊柱、终端子树
   * 后代、闭包别名内部的注释；合并序 field → marker → member 末位。
   */
  readonly docs: Record<string, readonly string[]>;
  /** aliasDocs 的相关切片（按别名名）。 */
  readonly aliasDocs: Record<string, readonly string[]>;
}

/** 结果联合：ok 分支 = 投影；失败分支 = 两枚稳定码 + path 新鲜副本回显（AC1）。 */
export type ResolveSchemaAtPathResult =
  | ({ readonly ok: true } & ReadDataSchemaProjection)
  | {
      ok: false;
      code: 'SCHEMA_PATH_NOT_FOUND' | 'SCHEMA_PATH_INVALID';
      /** 调用方数组的新鲜副本（AC1）。 */
      path: Array<string | number>;
    };

/**
 * 读路径语义 schema 解析（ADR-0016「解析语义」节）。
 *
 * 同步、纯函数、零 memo（无跨调用状态）。`derived` 属**可信域入参**（evaluate ok
 * 产物契约）——可信域 throw 清单：ref 目标缺失（游走中/终点闭包）、值树引用环、
 * 结构/值两树分歧、derived 非对象或 root/ROOT 缺失、keyPattern 判定中四类引擎
 * 错误之外的意外异常——上列情形 throw `InternalError`（沿 validate-patch 先例），
 * 不进结果联合、不降级失败码，本函数无顶层 catch。**keyPattern 引擎四类错误
 * （PatternCompileError/PatternUnsupportedError/PatternTooLargeError/
 * PatternBudgetExceeded）不属可信域 throw**——合法派生物可携带不可判定 Pattern
 * （parser §9.1 推迟合法性校验），四类按内容级 fail-closed 收敛
 * SCHEMA_PATH_NOT_FOUND（与写侧 validate.ts L256–280 值级处理对偶）。
 * `path` 属敌意通道：非数组 → SCHEMA_PATH_INVALID（path=[]）；含非 string|number
 * 段 → SCHEMA_PATH_INVALID（path=全量新鲜副本）；段被结构树拒绝 → 按形状级
 * INVALID / 内容级 NOT_FOUND 分类，失败 path 均为调用方数组的新鲜副本。
 * 返回的 valueSchema/aliases 与调用方 derived 共享节点（不可变契约），消费者不得
 * 变异；detached 深拷贝属 namespace-runtime 组合边界。解析与实际值/判别式缓存
 * 无关。
 */
export function resolveSchemaAtPath(
  derived: DerivedSchema,
  path: readonly (string | number)[],
): ResolveSchemaAtPathResult {
  // —— path 形状守卫（先于一切 derived 访问——敌意通道优先结算）——
  if (!Array.isArray(path)) {
    return { ok: false, code: 'SCHEMA_PATH_INVALID', path: [] };
  }
  for (const seg of path) {
    if (typeof seg !== 'string' && typeof seg !== 'number') {
      return { ok: false, code: 'SCHEMA_PATH_INVALID', path: [...path] };
    }
  }

  // —— derived 形状守卫（可信域畸形 → InternalError，loud、不降级）——
  // 本函数消费的五张表 + 两树入口全部在场才算「evaluate ok 产物形状」；任一缺失 =
  // 手造/篡改派生物 → InternalError（throw 通道纯度：本函数不向调用方泄漏裸 TypeError）。
  if (
    derived === null ||
    typeof derived !== 'object' ||
    !Object.hasOwn(derived, 'structure') ||
    !Object.hasOwn(derived, 'values') ||
    !Object.hasOwn(derived, 'aliases') ||
    !Object.hasOwn(derived, 'fieldDocs') ||
    !Object.hasOwn(derived, 'markerDocs') ||
    !Object.hasOwn(derived, 'aliasDocs')
  ) {
    throw new InternalError('derived 无效（可信域契约：须为 evaluate ok 产物）');
  }
  if (derived.structure.kind !== 'root') {
    throw new InternalError('结构树缺少 root 节点（手造派生物）');
  }
  if (!Object.hasOwn(derived.values, 'ROOT')) {
    throw new InternalError('值树缺少 ROOT 别名');
  }

  const sLens: RefChainLens<StructureNode> = structureLens(derived.aliases);
  const regexCache = new Map<string, CompiledPattern>(); // 每调用局部：成功产物缓存，失败不缓存

  // 结构候选集（对象身份去重，镜像 guardWalk 初始化）；值候选集（有序、身份去重）。
  let S = new Set<StructureNode>([walkRefChain(derived.structure.node, sLens)]);
  let V: ValueCandidate[] = [{ node: derived.values['ROOT']!, path: 'ROOT' }];
  // 脊柱键（沿 P 每段命中的候选语法路径；终点子树后代/闭包别名内部键在切片时并入）。
  const spine = new Set<string>();

  for (const seg of path) {
    // —— 第 1 步：结构侧（合法性 + 失败分类；drillStep 本体复用 = 同构不漂移）——
    const drill: DrillResult = drillStep(S, seg, sLens);
    if (drill.out.size === 0) {
      return { ok: false, code: classifyStructureReject(drill.forms, seg), path: [...path] };
    }

    // —— 第 2 步：值侧（投影推进：规范化 → 形态匹配 → 出候选 + 脊柱键 + keyPattern 实测）——
    const ctx: MatchCtx = {
      seg,
      values: derived.values,
      out: [],
      seen: new Set<ValueSchema>(),
      visited: new Set<ValueSchema>(),
      spine,
      regexCache,
      keyPatternRejected: false,
    };
    for (const cand of V) {
      matchValueCandidate(ctx, cand.node, cand.path);
    }
    if (ctx.out.length === 0) {
      if (ctx.keyPatternRejected) {
        // 内容级 fail-closed（失配或引擎四类错误同形，D7）——不细分拒绝原因
        return { ok: false, code: 'SCHEMA_PATH_NOT_FOUND', path: [...path] };
      }
      // 结构侧放行而值侧零候选且未经过任何 keyPattern 判定路径 = 手造/篡改两树分歧
      throw new InternalError(
        `两树形状分歧: 值树无候选接纳段 "${String(seg)}"（结构树已放行；派生 schema 两树须同源于求值器）`,
      );
    }
    S = drill.out;
    V = ctx.out;
  }

  // —— 终点合成（§8.4）：单候选原样；多候选 = 合成 union（恰两键、恒无判别式）——
  const valueSchema: ValueSchema = V.length === 1
    ? V[0]!.node
    : { kind: 'union', members: V.map((c) => c.node) };

  // —— 别名传递闭包（§8.5）：值 schema 引用到的别名全集（插入序 = 发现序）——
  const aliases = collectAliasClosure(derived.values, valueSchema);

  // —— docs/aliasDocs 切片（§8.6）：脊柱 + 终点子树后代 + 闭包别名内部；空条目过滤——
  const { docs, aliasDocs } = sliceDocs(derived, spine, V, aliases);

  return { ok: true, valueSchema, aliases, docs, aliasDocs };
}

// —— 值侧候选（命中收集时的原样节点——optional/ref 包装保留；path = 语法路径）——

interface ValueCandidate {
  node: ValueSchema;
  path: string;
}

/** 单段值侧匹配上下文（一次 resolveSchemaAtPath 调用内、单段作用域的状态）。 */
interface MatchCtx {
  seg: string | number;
  values: Record<string, ValueSchema>;
  out: ValueCandidate[];
  /** 身份去重：一个值节点单段至多收一次（镜像 drillStep Set 语义）。 */
  seen: Set<ValueSchema>;
  /** 单段身份访问守卫（镜像 drillStep expand 的 visited；环状手造派生物不发散）。 */
  visited: Set<ValueSchema>;
  /** 脊柱键集合（跨段累积，引用主函数集合）。 */
  spine: Set<string>;
  /** 正则编译成功产物缓存（每调用局部）。 */
  regexCache: Map<string, CompiledPattern>;
  /** 本段是否经过 Record keyPattern 内容级拒绝（失配或引擎四类错误，D7）。 */
  keyPatternRejected: boolean;
}

/** 值侧出候选收集：脊柱键全量记录；候选按对象身份去重（首见路径胜出，D4）。 */
function emitValue(ctx: MatchCtx, node: ValueSchema, path: string): void {
  ctx.spine.add(path);
  if (!ctx.seen.has(node)) {
    ctx.seen.add(node);
    ctx.out.push({ node, path });
  }
}

/**
 * 值侧单候选规范化 + 匹配（镜像结构侧 drillStep 的 expand/matchNode 的值域对应）。
 * 规范化：optional 透明解包（语法路径不变，仅字段值位可能出现——B7）；ref 逐跳
 * 查表（own 守卫；缺失 → InternalError「值树未声明别名」）且**锚名切换**为该 ref
 * 的名（被引别名内部键锚定在它自己名下——B10 文法）；in-flight 名集防环（作用域 =
 * 单次候选规范化，D9——合法递归别名深路径不误报）。
 */
function matchValueCandidate(ctx: MatchCtx, raw: ValueSchema, path: string): void {
  const inFlight = new Set<string>();
  let node = raw;
  let anchor = path;
  for (;;) {
    if (node.kind === 'optional') {
      node = node.value;
      continue;
    }
    if (node.kind === 'ref') {
      const name = node.name;
      if (inFlight.has(name)) throw new InternalError(`值树引用环: ${name}`);
      if (!Object.hasOwn(ctx.values, name)) throw new InternalError(`值树未声明别名: ${name}`);
      inFlight.add(name);
      node = ctx.values[name]!;
      anchor = name;
      continue;
    }
    break;
  }
  matchValueNode(ctx, node, anchor);
}

/** 值侧形态匹配（镜像 drillStep.matchNode：map 精确字段优先 → '<key>' 槽；array
 *  非负整数段；union 静态全成员展开——「任一成员出现即存在」（ADR 0003 §3）。 */
function matchValueNode(ctx: MatchCtx, node: ValueSchema, anchor: string): void {
  if (ctx.visited.has(node)) return;
  ctx.visited.add(node);
  const seg = ctx.seg;
  switch (node.kind) {
    case 'object': {
      if (typeof seg !== 'string') return; // 形状层拒绝：对象位只收 string 段（D8）
      // 精确字段优先（声明序，命中即收其 value 为出候选）
      for (const f of node.fields) {
        if (f.name === seg) {
          emitValue(ctx, f.value, `${anchor}.${f.name}`);
          return;
        }
      }
      // 精确未中且存在 '<key>' 字段 → Record 动态键段（键 Pattern 属值级：
      // validate-patch.ts 注释口径，母法 ADR-0003 §3——结构侧 drillStep 放行不验）
      for (const f of node.fields) {
        if (f.name === '<key>') {
          acceptRecordSlot(ctx, f.value, node.keyPattern, anchor);
          return;
        }
      }
      // 封闭对象字段未中 → 内容级无候选（结构侧对偶放行面已先行判定，D8）
      return;
    }
    case 'array': {
      if (typeof seg === 'number' && Number.isInteger(seg) && seg >= 0) {
        emitValue(ctx, node.element, `${anchor}.<item>`); // 读侧无 base、无越界概念
      }
      return;
    }
    case 'union': {
      // 全成员展开（成员 i 语法路径 0 基；成员 ref/optional 经 matchValueCandidate 再规范化）
      for (let i = 0; i < node.members.length; i++) {
        matchValueCandidate(ctx, node.members[i]!, `${anchor}.<member ${i}>`);
      }
      return;
    }
    default:
      return; // enum/pattern/scalar/int/range/xml：值级终态，无匹配（ref/optional 已在规范化中解完）
  }
}

/**
 * Record '<key>' 槽接纳判定（D7 单点分类器）：keyPattern 在场 → 正则实测该段；
 * 失配或引擎四类错误（编译期三类 + 运行期 PatternBudgetExceeded）一律记内容级
 * keyPattern 拒绝（与失配同标记、同通道 NOT_FOUND、不细分原因）；四类之外的意外
 * 异常包装 InternalError 上抛（validate.ts「意外异常 → 顶层崩溃」通道在无顶层
 * catch 约束下的忠实翻译——本函数 throw 的只有 InternalError）。
 */
function acceptRecordSlot(
  ctx: MatchCtx,
  slot: ValueSchema,
  keyPattern: string | undefined,
  anchor: string,
): void {
  if (keyPattern === undefined) {
    emitValue(ctx, slot, `${anchor}.<key>`);
    return;
  }
  let compiled = ctx.regexCache.get(keyPattern);
  if (compiled === undefined) {
    try {
      compiled = compile(keyPattern);
      ctx.regexCache.set(keyPattern, compiled); // 成功才缓存；失败同调用内确定性重拒
    } catch (err) {
      if (isPatternEngineError(err)) {
        ctx.keyPatternRejected = true;
        return;
      }
      throw new InternalError(`Pattern 判定意外异常: ${errorDetail(err)}`);
    }
  }
  try {
    const matched = match(compiled, ctx.seg as string, () => {});
    if (!matched) {
      ctx.keyPatternRejected = true;
      return;
    }
    emitValue(ctx, slot, `${anchor}.<key>`);
  } catch (err) {
    if (isPatternEngineError(err)) {
      ctx.keyPatternRejected = true;
      return;
    }
    throw new InternalError(`Pattern 判定意外异常: ${errorDetail(err)}`);
  }
}

/** 引擎四类错误精确识别（镜像 validate.ts emitPatternError 的分支形状）。 */
function isPatternEngineError(err: unknown): boolean {
  return (
    err instanceof PatternCompileError ||
    err instanceof PatternUnsupportedError ||
    err instanceof PatternTooLargeError ||
    err instanceof PatternBudgetExceeded
  );
}

function errorDetail(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 失败分类（D8 形状级 vs 内容级）：`SCHEMA_PATH_INVALID`（野段形状）当且仅当每个
 * 被尝试的候选形态都在形状层拒绝该段——形态集中既无「object/map + string 段」也
 * 无「array + 非负整数段」的可行组合，且无终态形态（leaf/plain/xml-fragment）在场；
 * 其余（任一候选内容级拒绝：终态/未知字段/keyPattern 失配与引擎不可判定/union 全
 * 员无该字段）→ `SCHEMA_PATH_NOT_FOUND`。分类先于且独立于 keyPattern 判定——引擎
 * 错误不可能把 INVALID 例翻成 NOT_FOUND。
 */
function classifyStructureReject(
  forms: Set<string>,
  seg: string | number,
): 'SCHEMA_PATH_NOT_FOUND' | 'SCHEMA_PATH_INVALID' {
  const mapFeasible = forms.has('map') && typeof seg === 'string';
  const arrayFeasible = forms.has('array') && typeof seg === 'number' && Number.isInteger(seg) && seg >= 0;
  const hasTerminal = forms.has('leaf') || forms.has('plain') || forms.has('xml-fragment');
  return !mapFeasible && !arrayFeasible && !hasTerminal
    ? 'SCHEMA_PATH_INVALID'
    : 'SCHEMA_PATH_NOT_FOUND';
}

/**
 * 别名传递闭包（§8.5）：深度优先遍历 valueSchema 收集被引用的别名（含递归别名——
 * 名集去重、单名闭包、终止、JSON 可序列化）；ref 目标缺失（Object.hasOwn 守卫）→
 * InternalError（终点 ref 缺失锚定）。aliases[n] = values[n] **原样引用**（含在场
 * discriminator——D5/D6），插入序 = 发现序（确定性）。
 */
function collectAliasClosure(
  values: Record<string, ValueSchema>,
  root: ValueSchema,
): Record<string, ValueSchema> {
  const aliases: Record<string, ValueSchema> = {};
  const names = new Set<string>();
  const visitedNodes = new Set<ValueSchema>(); // 结构环防御（手造派生物不发散）
  const visit = (node: ValueSchema): void => {
    if (visitedNodes.has(node)) return;
    visitedNodes.add(node);
    switch (node.kind) {
      case 'object':
        for (const f of node.fields) visit(f.value);
        return;
      case 'array':
        visit(node.element);
        return;
      case 'union':
        for (const m of node.members) visit(m);
        return;
      case 'optional':
        visit(node.value);
        return;
      case 'ref': {
        const name = node.name;
        if (names.has(name)) return;
        if (!Object.hasOwn(values, name)) throw new InternalError(`值树未声明别名: ${name}`);
        names.add(name);
        const body = values[name]!;
        aliases[name] = body;
        visit(body);
        return;
      }
      default:
        return; // enum/pattern/scalar/int/range/xml 终态
    }
  };
  visit(root);
  return aliases;
}

/**
 * docs/aliasDocs 切片（§8.6，D2/D3）：选键 = 脊柱键集合 ∪ 终点候选子树后代键
 * （k === p || k.startsWith(p + '.')）∪ 闭包别名内部键（k === a || k.startsWith(
 * a + '.')）——键不发明、内容逐字；合并内容
 * `docs[k] = [...fieldDocs[k], ...markerDocs[k], ...memberDocs[k]]`
 * （field → marker → member 末位；fieldDocs 在 `<member N>` 键上恒无条目，实际合并 =
 * marker 在前 member 在后——ADR 0019 §7），合并为空则过滤（空条目不进切片）；
 * `aliasDocs[a]` 仅闭包别名、浅拷贝。键序 = 表声明序扫描（fieldDocs → markerDocs →
 * memberDocs 条件键，去重并入；memberDocs 缺席即整遍跳过），逐调用确定。memberDocs
 * 属条件稀疏表（ADR 0019 决策 5）：缺席是合法存量形状，在场但表级畸形 →
 * InternalError（可信域 loud，见内联守卫）。前缀匹配安全性：语法段（标识符、
 * '<key>'/'<item>'/'<member N>'）均不含 '.'——'ROOT.a' 与 'ROOT.abc' 不串。
 */
function sliceDocs(
  derived: DerivedSchema,
  spine: Set<string>,
  endpoints: ValueCandidate[],
  aliases: Record<string, ValueSchema>,
): { docs: Record<string, readonly string[]>; aliasDocs: Record<string, readonly string[]> } {
  const endpointPaths = endpoints.map((c) => c.path);
  const aliasNames = Object.keys(aliases);

  const want = (k: string): boolean => {
    if (spine.has(k)) return true;
    for (const p of endpointPaths) {
      if (k === p || k.startsWith(`${p}.`)) return true;
    }
    for (const a of aliasNames) {
      if (k === a || k.startsWith(`${a}.`)) return true;
    }
    return false;
  };

  // 第三来源（ADR 0019 §7）：memberDocs 条件稀疏键——缺席 → 整遍扫描跳过（不使用 M4 的
  // 投影输出逐字节不变）。在场但表级畸形（null / 非对象 / 数组）→ InternalError：这是本
  // 函数新增的访问路径，裸扫会泄漏 `Object.keys(null)` 型 TypeError；**不得**把该键加入
  // 函数头必填键清单（SA8 F3.1：无 memberDocs 键的手造派生 schema 须照常解析）。
  const rawMemberDocs: unknown = derived.memberDocs;
  if (
    rawMemberDocs !== undefined &&
    (rawMemberDocs === null || typeof rawMemberDocs !== 'object' || Array.isArray(rawMemberDocs))
  ) {
    throw new InternalError('memberDocs 畸形（可信域契约：在场须为 Record<string, string[]>）');
  }
  const memberDocs = rawMemberDocs as Record<string, string[]> | undefined;

  // 三源合并单点（ADR 0019 §7）：field → marker → member 末位；空合并由各扫描处过滤。
  const merged = (k: string): string[] => [
    ...(derived.fieldDocs[k] ?? []),
    ...(derived.markerDocs[k] ?? []),
    ...(memberDocs?.[k] ?? []),
  ];

  const docs: Record<string, readonly string[]> = {};
  for (const k of Object.keys(derived.fieldDocs)) {
    if (!want(k)) continue;
    const content = merged(k);
    if (content.length > 0) docs[k] = content;
  }
  for (const k of Object.keys(derived.markerDocs)) {
    if (docs[k] !== undefined || !want(k)) continue; // 去重并入（fieldDocs 已出的键跳过）
    const content = merged(k);
    if (content.length > 0) docs[k] = content;
  }
  for (const k of memberDocs !== undefined ? Object.keys(memberDocs) : []) {
    if (docs[k] !== undefined || !want(k)) continue; // 去重并入（前两遍已出的键跳过）
    const content = merged(k);
    if (content.length > 0) docs[k] = content;
  }
  const aliasDocs: Record<string, readonly string[]> = {};
  for (const a of aliasNames) {
    const arr = derived.aliasDocs[a];
    if (arr !== undefined && arr.length > 0) aliasDocs[a] = [...arr];
  }
  return { docs, aliasDocs };
}
