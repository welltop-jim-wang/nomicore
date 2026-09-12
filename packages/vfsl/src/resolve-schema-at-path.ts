/**
 * 读路径语义 schema 解析（Issue #272 / ADR-0016「解析语义」节实施；SA1 设计
 * `wiki/raw/task_issue-272_design.md` §8 为落地蓝本）。
 *
 * `resolveSchemaAtPath(derived, path)`：给定派生 schema 与具体读路径，返回路径终点
 * 的语义 schema 投影四件套——值语义子树（ref 按名保留）+ 传递闭包别名表 +
 * docs/aliasDocs 注释寻址切片。供 namespace-runtime 的 readData 语义 schema 投影
 * （ADR-0016）组合使用。
 *
 * 形状预算（Issue #335 / ADR-0024 决策 5）：加法第三参 `options?` —— `depth`（≥0
 * 整数）自**路径终点**向下限定可展开容器层数（object/array 各计一层；optional/union/
 * enum/pattern/scalar/xml 透明或终态；ref 为终态边界），`maxChildrenPerNode` 合法但
 * 对投影零操作（投影是类型级、路径键控，无实例键）。预算在解析递归内生效：
 * valueSchema 同 depth 截断（被裁位放**投影层截断标记** `SchemaTruncationMarker`，
 * 携带成员级线索——ref 名优先、无 ref 名时容器 kind）、别名传递闭包随展开层收缩、
 * docs/aliasDocs 切片被裁路径省略，三者在**同一次遍历**内同步收缩（先裁后收集：
 * `depth` 耗尽位置零物化、零子位路径 emit）。无 `options`（含显式 `undefined`）时
 * 走既有代码路径，行为逐字节不变。
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
 * 预算读的失败面追加第四分：`options` 属敌意通道（封闭形状、own-property 语义）——
 * 非对象 / null / 数组 / 未知键 / 已知键非 ≥0 整数（含 present-undefined、NaN、±∞）/
 * 抛错 getter 与 Proxy 陷阱 → 判别联合 `SCHEMA_OPTIONS_INVALID`（同步、不抛；path 为
 * 已通过形状校验的调用方数组新鲜副本）。校验次序：path 形状守卫 → options 校验 →
 * derived 可信域守卫 → 路径游走（敌意通道全部先于可信域访问结算）。
 * 预算游走零新增 throw：值树环经调用内两相防御（进行中集重入**透传原节点引用** +
 * 完成表记忆化）终止、不发散、不泄漏裸异常；预算分支 ref 目标缺失经 `Object.hasOwn`
 * 守卫收敛既有 InternalError（与闭包收集同文同码）。
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

/**
 * 截断标记线索（ADR 0024 决策 5「成员的 ref 名优先，无 ref 名时给容器 kind」）：
 * 被裁位类型节点为 ref → ref 名；为容器 → 容器 kind。嵌套判别避免「别名恰好命名为
 * `object`/`array`」时的线索二义。
 */
export type SchemaTruncationClue =
  | { readonly via: 'ref'; readonly name: string }
  | { readonly via: 'container'; readonly containerKind: 'object' | 'array' };

/**
 * 投影层截断标记（ADR 0024 决策 5「截断节点选型」钉死）：投影层包装形态，
 * **非** ValueSchema 成员、**非**值域哨兵——判别字段复用 `kind` 字面量 `'truncated'`
 * （十案判别，消费方 `switch (node.kind)` 可穷举收窄）。标记不携带预算种类与被截容器
 * 子键清单（下次浅读或投影截断节点即下一层结构）。
 */
export interface SchemaTruncationMarker {
  readonly kind: 'truncated';
  readonly clue: SchemaTruncationClue;
}

/** 投影包装联合：无预算读恒纯 `ValueSchema`；预算读成员值位可出现标记。 */
export type BudgetedValueSchema = ValueSchema | SchemaTruncationMarker;

/** 预算 options（封闭形状：未知键非法；width 合法但对投影零操作）。 */
export interface ResolveSchemaBudgetOptions {
  /** 自目标节点向下允许展开的容器层数（≥0 整数；容器 = object/array 各一层）。 */
  readonly depth?: number;
  /** 每个被展开节点最多保留的子项数（投影通道无实例键，校验后不参与任何判定）。 */
  readonly maxChildrenPerNode?: number;
}

/** 读路径语义 schema 投影体（ADR-0016「投影体」四件套）。 */
export interface ReadDataSchemaProjection<V extends BudgetedValueSchema = ValueSchema> {
  /** 路径终点的值语义子树（ref 按名保留，不内联展开——ADR 0003 §4 同款纪律）。 */
  readonly valueSchema: V;
  /** 传递闭包内被 valueSchema 引用到的别名（自包含、递归安全、JSON 可序列化）。 */
  readonly aliases: Record<string, V>;
  /**
   * fieldDocs/markerDocs/memberDocs 的相关切片（ADR 0019 §7 三来源）：脊柱、终端子树
   * 后代、闭包别名内部的注释；合并序 field → marker → member 末位。
   */
  readonly docs: Record<string, readonly string[]>;
  /** aliasDocs 的相关切片（按别名名）。 */
  readonly aliasDocs: Record<string, readonly string[]>;
}

/** 预算读投影体（价值位与闭包体成员值位均可含截断标记——ADR 0024 L77 + 决策 5）。 */
export type BudgetedReadDataSchemaProjection = ReadDataSchemaProjection<BudgetedValueSchema>;

/** 结果联合：ok 分支 = 投影；失败分支 = 两枚稳定码 + path 新鲜副本回显（AC1）。 */
export type ResolveSchemaAtPathResult =
  | ({ readonly ok: true } & ReadDataSchemaProjection)
  | {
      ok: false;
      code: 'SCHEMA_PATH_NOT_FOUND' | 'SCHEMA_PATH_INVALID';
      /** 调用方数组的新鲜副本（AC1）。 */
      path: Array<string | number>;
    };

/** 预算读结果联合：ok = 预算投影四件套；失败 = 三码（追加 options 校验失败）。 */
export type BudgetedResolveSchemaAtPathResult =
  | ({ readonly ok: true } & BudgetedReadDataSchemaProjection)
  | {
      ok: false;
      code: 'SCHEMA_PATH_NOT_FOUND' | 'SCHEMA_PATH_INVALID' | 'SCHEMA_OPTIONS_INVALID';
      /** 调用方数组的新鲜副本（AC1；options 失败亦回显已通过形状校验的调用方数组副本）。 */
      path: Array<string | number>;
    };

/**
 * 公共类型守卫：运行时判别投影层截断标记（结构化判别：对象 + `kind === 'truncated'`
 * + clue 形状合法）。T3 detach 拷贝与外部消费方经本守卫判别。
 */
export function isSchemaTruncationMarker(node: unknown): node is SchemaTruncationMarker {
  if (node === null || typeof node !== 'object') return false;
  if (!('kind' in node) || node.kind !== 'truncated') return false;
  if (!('clue' in node) || node.clue === null || typeof node.clue !== 'object') return false;
  const clue = node.clue;
  if (!('via' in clue)) return false;
  if (clue.via === 'ref') return 'name' in clue && typeof clue.name === 'string';
  if (clue.via === 'container') {
    return (
      'containerKind' in clue && (clue.containerKind === 'object' || clue.containerKind === 'array')
    );
  }
  return false;
}

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
 *
 * 形状预算（ADR 0024 决策 5；`options` 加法第三参，**无 options 行为逐字节不变**）：
 * 预算在解析递归内生效——valueSchema 同 depth 截断、别名传递闭包随展开层收缩、
 * docs/aliasDocs 切片被裁路径省略，三者在同一次遍历内同步收缩（先裁后收集）。
 * 计层规则：容器（object/array）各计 1 层；optional/union/enum/pattern/scalar/xml
 * 透明或终态；ref 为终态边界（被裁位标记携带 ref 名）。计层原点 = 路径终点（到达
 * 终点前的路径游走段不受预算）。`maxChildrenPerNode` 合法但对投影零操作（投影是
 * 类型级、路径键控，无实例键）。截断标记为投影层包装（`kind:'truncated'`），
 * 不扩 ValueSchema 九 kind 冻结面；标记携带成员级类型线索（ref 名优先，无 ref 名
 * 时容器 kind）。
 *
 * `options` 属敌意通道（封闭形状，own-property 语义）：非对象 / null / 数组 / 未知
 * 键 / 已知键为非 ≥0 整数（含 present-undefined、NaN、±∞）→ 判别联合失败
 * `SCHEMA_OPTIONS_INVALID`（同步、不抛、path 为已通过形状校验的调用方数组新鲜副本）；
 * 敌意 getter/Proxy 的任何异常一律收敛同码，绝不泄漏裸异常。校验次序：
 * path 形状守卫 → options 校验 → derived 可信域守卫 → 路径游走（敌意通道先于可信域
 * 访问结算）。预算游走零新增 throw：值树环经调用内两相防御（进行中集透传原引用 +
 * 完成表记忆化）终止且不发散；预算分支 ref 目标缺失经 `Object.hasOwn` 守卫收敛
 * `InternalError`（与既有闭包收集同文同码）。每调用局部状态、零 memo（跨调用）、
 * 重复调用逐字节确定。
 */
export function resolveSchemaAtPath(
  derived: DerivedSchema,
  path: readonly (string | number)[],
): ResolveSchemaAtPathResult;
export function resolveSchemaAtPath(
  derived: DerivedSchema,
  path: readonly (string | number)[],
  options: ResolveSchemaBudgetOptions | undefined,
): BudgetedResolveSchemaAtPathResult;
export function resolveSchemaAtPath(
  derived: DerivedSchema,
  path: readonly (string | number)[],
  options?: ResolveSchemaBudgetOptions,
): ResolveSchemaAtPathResult | BudgetedResolveSchemaAtPathResult {
  // —— path 形状守卫（先于一切 derived 访问——敌意通道优先结算）——
  if (!Array.isArray(path)) {
    return { ok: false, code: 'SCHEMA_PATH_INVALID', path: [] };
  }
  for (const seg of path) {
    if (typeof seg !== 'string' && typeof seg !== 'number') {
      return { ok: false, code: 'SCHEMA_PATH_INVALID', path: [...path] };
    }
  }

  // —— options 校验（新；紧随 path 守卫、先于 derived 守卫——敌意通道优先结算）——
  // `undefined`（缺省或显式）→ 无预算分支：既有代码路径逐指令运行（零开销、零语义变化）。
  const budgeted = options !== undefined;
  let depth = Number.POSITIVE_INFINITY;
  if (budgeted) {
    const validated = validateBudgetOptions(options);
    if (validated === null) {
      return { ok: false, code: 'SCHEMA_OPTIONS_INVALID', path: [...path] };
    }
    depth = validated;
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
  if (!budgeted) {
    // —— 无预算分支（既有三步逐字运行；零语义变化）——
    const valueSchema: ValueSchema = V.length === 1
      ? V[0]!.node
      : { kind: 'union', members: V.map((c) => c.node) };

    // —— 别名传递闭包（§8.5）：值 schema 引用到的别名全集（插入序 = 发现序）——
    const aliases = collectAliasClosure(derived.values, valueSchema);

    // —— docs/aliasDocs 切片（§8.6）：脊柱 + 终点子树后代 + 闭包别名内部；空条目过滤——
    const { docs, aliasDocs } = sliceDocs(derived, noBudgetWant(spine, V, aliases), Object.keys(aliases));

    return { ok: true, valueSchema, aliases, docs, aliasDocs };
  }

  // —— 预算分支（ADR 0024 决策 5）：单遍历同步收缩（先裁后收集）——
  // 终点候选逐个以完整预算起算（计层原点 = 路径终点）；游走段（上）不受预算约束。
  const walk = new BudgetWalk(derived.values);
  const walked = V.map((c) => walk.walk(c.node, depth, c.path));
  const valueSchema: BudgetedValueSchema = walked.length === 1
    ? walked[0]!
    : budgetShell({ kind: 'union', members: walked });
  const aliases = walk.aliases();
  // docs/aliasDocs：want = 脊柱位 ∪ 渲染位（emitted，精确匹配）——被裁路径与其后代省略、
  // 被裁别名（被裁 ref 的目标）无条目；三源合并序/扫描序/空过滤/memberDocs 稀疏兼容照抄。
  const { docs, aliasDocs } = sliceDocs(
    derived,
    (k) => spine.has(k) || walk.emitted.has(k),
    Object.keys(aliases),
  );

  return { ok: true, valueSchema, aliases, docs, aliasDocs };
}

// —— options 校验（§6.5；敌意通道，全部 own-property 语义）——

/** ≥0 整数（Number.isInteger 已排除 NaN/±∞——「非有限数」规则覆盖）。 */
function isBudgetCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * 敌意通道属性读单点（options 属公共敌意入参；调用方已保证 object 形状、外层
 * try/catch 已武装）：仅读 own 属性——present-undefined 与抛错 getter 均在此结算。
 */
function ownOptionValue(options: object, key: string): unknown {
  return Object.hasOwn(options, key) ? (options as Record<string, unknown>)[key] : undefined;
}

/**
 * 预算 options 校验（§6.5）：`undefined` 不进入本函数（缺省 = 无预算）。
 * 返回合法 `depth`（缺席 = +∞）或 `null`（非法）。规则：对象（非 null/非数组）+
 * own 键集 ⊆ {depth, maxChildrenPerNode}（封闭形状）+ 在场键须为 ≥0 整数
 * （present-undefined 因而非法——与包 `exactOptionalPropertyTypes` 静态纪律对偶）。
 * 校验块整体 try/catch：抛错 getter/Proxy 陷阱的任何异常一律收敛非法，
 * 不泄漏任何裸异常、不使用 InternalError（InternalError 专属可信域畸形）。
 * `maxChildrenPerNode` 通过校验后在投影通道被忽略（width 对投影零操作）。
 */
function validateBudgetOptions(options: unknown): number | null {
  try {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) return null;
    for (const key of Object.keys(options)) {
      if (key !== 'depth' && key !== 'maxChildrenPerNode') return null;
    }
    let depth = Number.POSITIVE_INFINITY;
    if (Object.hasOwn(options, 'depth')) {
      const value = ownOptionValue(options, 'depth');
      if (!isBudgetCount(value)) return null;
      depth = value;
    }
    if (Object.hasOwn(options, 'maxChildrenPerNode')) {
      const value = ownOptionValue(options, 'maxChildrenPerNode');
      if (!isBudgetCount(value)) return null;
    }
    return depth;
  } catch {
    return null;
  }
}

// —— 预算游走（§6.3 计层规约 + §6.3.5 两相环防御）——

/**
 * 预算壳构造（实现内部单点桥接）：运行时形状 = 原九 kind 家族 + 成员值位可含标记
 * （公共面按 §6.8 pin 为浅层包装联合 `BudgetedValueSchema`，不公开平行类型族）。
 */
function budgetShell(shell: object): BudgetedValueSchema {
  return shell as BudgetedValueSchema;
}

/** 截断标记构造（每调用新鲜节点；不携带预算种类与被截容器子键清单）。 */
function truncationMarker(clue: SchemaTruncationClue): SchemaTruncationMarker {
  return { kind: 'truncated', clue };
}

/**
 * 该渲染位是否**被裁**（先裁后 emit 的谓词，评审 N1 精确化）：optional 对计层透明，
 * 其内位经透明包装后根位为标记 ⟹ 该语法位被裁、不入 emitted（如 `[]` d=1 的
 * `ROOT.config`）；union 壳（成员部分或全部标记）不算被裁——宿主位照常 emit
 * （§6.10 多重标记语义）。
 *
 * **环安全（SA4 R1 修复，§6.3.5 终止性硬约束）**：剥离链按**节点对象身份**去重——
 * 手造 optional 自引用环 / 2-环（透明环）重访即视为**未截断**并终止（环位经进行中集
 * 透传原引用、环上不可能存在标记，故「未截断」与 §6.3.5 透传语义一致）。无环输入的
 * 剥离链每节点至多出现一次，visited 集对既有输出零影响；本修复不拒收输入、不新增
 * throw（值树对象图环不在可信域 InternalError 清单内）。
 */
function isTruncated(node: BudgetedValueSchema): boolean {
  let current: BudgetedValueSchema = node;
  const stripped = new Set<BudgetedValueSchema>();
  while (current.kind === 'optional') {
    if (stripped.has(current)) return false; // 透明环重入：透传原引用、环上无标记
    stripped.add(current);
    current = current.value;
  }
  return current.kind === 'truncated';
}

/**
 * 预算游走上下文（§7.3；每调用局部、零跨调用状态——ADR 0016 L65 纯函数纪律）。
 * 两相环防御：`inProgress`（进入即登记、完成即移除）对环重入**透传原节点引用**
 * （不构造、不 emit、不抛；与无预算读共享原引用的输出语义同构）；`memo`（完成后
 * 写表）对 DAG 记忆化复用。渲染位路径集 `emitted` 供 docs 选键（精确匹配）。
 */
class BudgetWalk {
  /** 已渲染的语法路径集（容器壳位/字段值位/`<item>`/`<member N>`/终态自身/保留 ref 位/闭包锚）。 */
  readonly emitted = new Set<string>();
  private readonly values: Record<string, ValueSchema>;
  /** 进行中集（按节点对象身份；环重入透传的判据）。 */
  private readonly inProgress = new Set<ValueSchema>();
  /** 完成表（按节点对象身份；DAG 共享复用，含 MARKER 结果）。 */
  private readonly memo = new Map<ValueSchema, BudgetedValueSchema>();
  /** 已登记闭包别名名集（先登记后访问体：递归别名终止的既有纪律镜像）。 */
  private readonly closureNames = new Set<string>();
  /** 闭包发现序（插入序 = 发现序，与既有收集器一致；构建时按序物化）。 */
  private readonly closureOrder: string[] = [];
  private readonly closureEntries: Record<string, BudgetedValueSchema> = {};

  constructor(values: Record<string, ValueSchema>) {
    this.values = values;
  }

  /** 闭包别名表（发现序物化——`JSON.stringify` 键序与无预算分支一致）。 */
  aliases(): Record<string, BudgetedValueSchema> {
    const out: Record<string, BudgetedValueSchema> = {};
    for (const name of this.closureOrder) out[name] = this.closureEntries[name]!;
    return out;
  }

  /**
   * 入口协议（顺序固定）：完成表命中 → 记忆结果；进行中集命中 → 返回**原节点引用**
   * （环透传：不构造、不 emit、不抛）；否则进入即登记 → 渲染 → 移出 → 写表。
   */
  walk(node: ValueSchema, budget: number, path: string): BudgetedValueSchema {
    const memoized = this.memo.get(node);
    if (memoized !== undefined) return memoized;
    if (this.inProgress.has(node)) return node;
    this.inProgress.add(node);
    const result = this.render(node, budget, path);
    this.inProgress.delete(node);
    this.memo.set(node, result);
    return result;
  }

  /** 单位置渲染（预算判定 `budget === 0` 先于一切子位触达：先裁后收集、零物化）。 */
  private render(node: ValueSchema, budget: number, path: string): BudgetedValueSchema {
    switch (node.kind) {
      case 'object': {
        if (budget === 0) return truncationMarker({ via: 'container', containerKind: 'object' });
        this.emitted.add(path); // 容器壳位
        let pristine = true;
        const fields: Array<{ name: string; value: BudgetedValueSchema }> = [];
        for (const field of node.fields) {
          // 容器消耗一层：字段值位以 budget-1 渲染
          const child = this.walk(field.value, budget - 1, `${path}.${field.name}`);
          if (child !== field.value) pristine = false;
          if (!isTruncated(child)) this.emitted.add(`${path}.${field.name}`); // 先裁后 emit
          fields.push({ name: field.name, value: child });
        }
        // 身份短路：零标记子树 ⟹ 整体返回原节点引用（充足 depth ≡ 无预算的字节恒等基础）
        if (pristine) return node;
        return budgetShell({
          kind: 'object',
          fields,
          ...(node.keyPattern !== undefined ? { keyPattern: node.keyPattern } : {}),
        });
      }
      case 'array': {
        if (budget === 0) return truncationMarker({ via: 'container', containerKind: 'array' });
        this.emitted.add(path); // 容器壳位
        const child = this.walk(node.element, budget - 1, `${path}.<item>`);
        if (!isTruncated(child)) this.emitted.add(`${path}.<item>`);
        if (child === node.element) return node;
        return budgetShell({ kind: 'array', element: child });
      }
      case 'union': {
        // 透明（同预算；union 节点自身永不是标记位）；宿主位照常 emit（成员全标记亦然）
        this.emitted.add(path);
        let pristine = true;
        const members: BudgetedValueSchema[] = [];
        for (let i = 0; i < node.members.length; i++) {
          const member = node.members[i]!;
          const child = this.walk(member, budget, `${path}.<member ${i}>`);
          if (child !== member) pristine = false;
          if (!isTruncated(child)) this.emitted.add(`${path}.<member ${i}>`);
          members.push(child);
        }
        if (pristine) return node;
        return budgetShell({
          kind: 'union',
          members,
          ...(node.discriminator !== undefined ? { discriminator: node.discriminator } : {}),
        });
      }
      case 'optional': {
        // 透明：同预算、同语法路径（optional 不占路径段）；包装保留（标记位亦然）
        const child = this.walk(node.value, budget, path);
        if (child === node.value) return node;
        return budgetShell({ kind: 'optional', value: child });
      }
      case 'ref': {
        // 终态边界：预算耗尽 → ref 位标记（不查 values、不登记闭包 ⟹ depth:0 恒不触达别名体）
        if (budget === 0) return truncationMarker({ via: 'ref', name: node.name });
        const name = node.name;
        if (!this.closureNames.has(name)) {
          if (!Object.hasOwn(this.values, name)) {
            throw new InternalError(`值树未声明别名: ${name}`); // 镜像 collectAliasClosure 同文同码
          }
          this.closureNames.add(name); // 先登记名（占位）：递归别名终止
          this.closureOrder.push(name);
          // 锚名切换为别名名（B10 文法）；首发现预算渲染一次；自递归重入经 inProgress 透传原体
          this.closureEntries[name] = this.walk(this.values[name]!, budget, name);
          this.emitted.add(name); // 闭包体根锚
        }
        this.emitted.add(path); // 保留 ref 位
        return node;
      }
      case 'enum': {
        // 终态、预算无关；成员位 emit（F2 修复：ADR 0019 键文法允许 `${pos}.<member N>`）
        this.emitted.add(path);
        for (let i = 0; i < node.values.length; i++) this.emitted.add(`${path}.<member ${i}>`);
        return node;
      }
      default: {
        // pattern / scalar / xml：终态、预算无关、无内部声明位
        this.emitted.add(path);
        return node;
      }
    }
  }
}

/**
 * 无预算分支的 docs 选键谓词（既有语义逐字保留）：脊柱键 ∪ 终点候选子树后代
 * （`k === p || k.startsWith(p + '.')`）∪ 闭包别名内部键。
 */
function noBudgetWant(
  spine: Set<string>,
  endpoints: ValueCandidate[],
  aliases: Record<string, ValueSchema>,
): (key: string) => boolean {
  const endpointPaths = endpoints.map((c) => c.path);
  const aliasNames = Object.keys(aliases);
  return (k: string): boolean => {
    if (spine.has(k)) return true;
    for (const p of endpointPaths) {
      if (k === p || k.startsWith(`${p}.`)) return true;
    }
    for (const a of aliasNames) {
      if (k === a || k.startsWith(`${a}.`)) return true;
    }
    return false;
  };
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
      return; // enum/pattern/scalar/xml：值级终态，无匹配（ref/optional 已在规范化中解完）
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
        return; // enum/pattern/scalar/xml 终态
    }
  };
  visit(root);
  return aliases;
}

/**
 * docs/aliasDocs 切片（§8.6，D2/D3）：选键 = 调用方谓词 `want`（无预算分支 = 脊柱 ∪
 * 终点候选子树后代 ∪ 闭包别名内部；预算分支 = 脊柱 ∪ 渲染位 emitted 精确匹配）——
 * 键不发明、内容逐字；合并内容
 * `docs[k] = [...fieldDocs[k], ...markerDocs[k], ...memberDocs[k]]`
 * （field → marker → member 末位；fieldDocs 在 `<member N>` 键上恒无条目，实际合并 =
 * marker 在前 member 在后——ADR 0019 §7），合并为空则过滤（空条目不进切片）；
 * `aliasDocs[a]` 仅闭包别名（`aliasNames` 决定键与序）、浅拷贝。键序 = 表声明序扫描
 * （fieldDocs → markerDocs → memberDocs 条件键，去重并入；memberDocs 缺席即整遍跳过），
 * 逐调用确定。memberDocs 属条件稀疏表（ADR 0019 决策 5）：缺席是合法存量形状，在场但
 * 表级畸形 → InternalError（可信域 loud，见内联守卫）。前缀匹配安全性：语法段
 * （标识符、'<key>'/'<item>'/'<member N>'）均不含 '.'——'ROOT.a' 与 'ROOT.abc' 不串。
 */
function sliceDocs(
  derived: DerivedSchema,
  want: (key: string) => boolean,
  aliasNames: readonly string[],
): { docs: Record<string, readonly string[]>; aliasDocs: Record<string, readonly string[]> } {
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
