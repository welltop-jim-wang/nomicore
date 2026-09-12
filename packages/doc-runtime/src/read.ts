/**
 * @nomicore/doc-runtime — readLogicalValueAtPath(doc, path)（ADR-0008 / issue #86）：
 * schema-independent 载体驱动投影读取——读取只依据 live Y.Doc 中的实际 Yjs/plain 载体
 * 转换目标子树，返回隔离的普通逻辑值（不依赖任何 VFSL/派生 schema）。
 *
 * 规范权威：ADR-0008（载体驱动投影读取域）；设计记录（历史证据，非规范）：
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
 * 形状预算（ADR-0024 决策 1/2/3/6，issue #334）：公共面三参化
 * readLogicalValueAtPath(doc, path, options?)——options 在场即预算语义；缺席/显式 undefined
 * ≡ 无 options（逐字节现行为，R1）。depth/maxChildrenPerNode 预算贯通既有双递归
 * （projectValue/projectYMap/projectYArray/copyPlainStrict，F10 不新增第二条读路径）：
 * - 容器 = Y.Map / Y.Array / plain object / plain array，各计一层；标量与 Y.XmlFragment 是
 *   终态（预算 no-op，B2）；depth:0 把目标容器折叠为同形空容器（{} / []）并至多记一条
 *   depth 条目（omitted = 被折容器 raw 直接子项数，B5）；width 只在父路径记一条
 *   （omitted = rawTotal - maxChildrenPerNode，B6）；
 * - 零物化边界（B8）：折叠子项与超出保留前缀的子项一律不 get / 不 descriptor.value 读值、
 *   不递归；折叠/裁减判定只按「是否容器」与 raw 子槽数（B15——detached/值域判别不前置）；
 *   detached Yjs 容器（doc === null）折叠按 B16/R9：rawTotal := 0 且零公共 count 读，
 *   d ≥ 1 展开/保留物化仍走现行响亮守卫；
 * - 截断省略是值内唯一形态（键省略，B12）；深度折叠节点只记 depth 单条（B3）；空容器折叠
 *   不记条目（B4）；条目 path 与 path 实参同基（B9）且逐层新鲜（不别名调用方数组）；
 * - 预算读成功面恒四键 {ok,value,truncated,truncations}，truncated === truncations.length>0
 *   （B14）；非法 options 响亮拒绝 READ_OPTIONS_INVALID——定序 G0 → options 校验 → N0
 *   （V1），零 doc 触碰（V2）、零外抛、绝不执行 options accessor（V3）。
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
 * 形状预算 options（ADR-0024 决策 1；SA6 §12.1）。封闭形状：
 * - 仅 depth / maxChildrenPerNode 两个可选轴；任一未知 own enumerable string 键 → 响亮失败；
 * - 轴值必须是 ≥0 的有限整数（-0 合法 ≡ 0）；负数/非整数/非有限数/类型不符 → 响亮失败；
 * - exactOptionalPropertyTypes 下显式 `depth: undefined` 是编译错误；运行时「键在场、值
 *   undefined ≡ 缺席」（R1/H11）；
 * - 宿主必须是 Object.prototype / null 原型的 plain 对象（数组/类实例/自定义原型 → 失败）。
 */
export interface ReadLogicalValueAtPathOptions {
  depth?: number;
  maxChildrenPerNode?: number;
}

/**
 * 截断清单条目（ADR-0024 决策 3；SA6 §12.1）。path 为 ROOT 基绝对路径（与 path 实参同基，
 * 逐层新鲜——不别名调用方数组、不跨调用共享）：
 * - kind:'depth'：path 尾段即被折容器键名（键名唯一在场位置，值内已省略）；omitted =
 *   被折容器 raw 直接子项数（Y.Map.size 含 undefined 值键 / Y.Array.length / plain array
 *   length / plain object own enumerable data 键数）——**不是后代总数**；
 * - kind:'width'：只在父路径记一条，不逐键罗列；omitted = rawTotal - maxChildrenPerNode；
 * - omitted ≥ 1；(path,kind) 唯一；条目顺序 = 遍历序，不承诺稳定（R6）。
 */
export interface ReadLogicalValueTruncationEntry {
  path: readonly (string | number)[];
  kind: 'depth' | 'width';
  omitted: number;
}

/**
 * 三参（形状预算）读结果联合（ADR-0024 决策 1/2/3；SA6 §12.4 决议）。与
 * ReadLogicalValueResult 分离（双结果类型 + 重载）：新失败码 READ_OPTIONS_INVALID 只属于
 * 本联合，不污染无 options 的既有联合（runtime 的 Extract 派生因此零泄漏）。
 * 预算成功面恒四键：{ok,value,truncated,truncations}——truncations 恒在场（空清单仍是数组）。
 */
export type ReadLogicalValueAtPathBudgetResult =
  | {
      ok: true;
      value: unknown;
      truncated: boolean;
      truncations: readonly ReadLogicalValueTruncationEntry[];
    }
  | { ok: false; code: 'PATH_NOT_ALLOWED'; path: readonly (string | number)[]; message?: string }
  | { ok: false; code: 'READ_OPTIONS_INVALID'; path: readonly (string | number)[]; message: string };

/**
 * 同步按路径读取目标子树逻辑值（ADR-0008）。同步、不抛错（INV-R1）。
 * 编排：G0 形态守卫 → options 校验（V1：仅第三参在场时；G0 优先）→ N0 probeRoot（只碰
 * 'ROOT'，INV-R8/R9）→ N1 导航循环（预算盲，B13）→ P1 定点投影（预算贯通递归）；
 * 全程包在顶层 try/catch（崩溃边界 E100，D10/D8）。
 * - 2 参重载：ReadLogicalValueResult（旧两键成功面逐字不变，F1）；
 * - 3 参重载：ReadLogicalValueAtPathBudgetResult（四键成功面 + 截断事实 + 新失败分支）。
 */
export function readLogicalValueAtPath(
  doc: Y.Doc,
  path: readonly (string | number)[],
): ReadLogicalValueResult;
export function readLogicalValueAtPath(
  doc: Y.Doc,
  path: readonly (string | number)[],
  options: ReadLogicalValueAtPathOptions,
): ReadLogicalValueAtPathBudgetResult;
export function readLogicalValueAtPath(
  doc: Y.Doc,
  path: readonly (string | number)[],
  options?: ReadLogicalValueAtPathOptions,
): ReadLogicalValueResult | ReadLogicalValueAtPathBudgetResult {
  try {
    // G0 — SA4-F2 守卫前置：非数组 path 归一失败（绝不把垃圾输入当空 path 读全 ROOT）；
    // message 带 DOCRT-E100 前缀（与旧实现 G0 守卫可观测行为逐字一致，guards 前缀锚）。
    // V1 定序：G0 优先于 options 校验（path 与 options 双非法 → PATH_NOT_ALLOWED）。
    if (!Array.isArray(path)) {
      return notAllowed(path, 'DOCRT-E100: path 必须是段数组（readonly (string | number)[]）');
    }

    // OPT — options 校验（V1：G0 早退之后、N0 之前的最小 diff 位；V2：非法 options 在
    // N0 前短路 → 零 doc 触碰（fresh doc 的 ROOT 不被惰性创建、零 update 事件）；
    // V3：校验总函数内层 try 收编一切探测期异常，零外抛、零 accessor 执行、零 options 变异）。
    let ctx: ProjectionCtx;
    if (options === undefined) {
      ctx = { budget: null, truncations: [] }; // 缺席/显式 undefined ≡ 无 options（legacy 门控）
    } else {
      const validated = validateReadOptions(options);
      if (!validated.ok) return optionsInvalid(path, validated.msg); // V5/V6 新失败分支
      ctx = { budget: validated.budget, truncations: [] };
    }

    // N0 — ROOT 探针（唯一 doc 触碰入口，INV-R8：只碰 'ROOT'；INV-R9：零写入零事件）
    const probe = probeRoot(doc); // throw → E100（第四级全失败，D9）
    if (probe.carrier !== 'Y.Map') {
      return notAllowed(path, `ROOT 载体非 Y.Map（实际 ${probe.carrier}）`); // C4
    }

    // N1 — 导航循环（段纪律 D3 + 缺席吸收 D4 + 不可下钻 C1/C2/C3）；B13：预算盲——
    // options 不改变段纪律/载体分类/失败分类/缺席吸收；吸收早退按模式出 2 键/4 键
    let cur: unknown = probe.map;
    for (let i = 0; i < path.length; i++) {
      const seg = path[i] as unknown; // 运行时野段（symbol 等）由下游 typeof 判拒，零抛点
      const c = navClassify(cur); // D2 两层分类器（Yjs 家族含 detached 前置判别）
      switch (c.k) {
        case 'ymap': {
          if (typeof seg !== 'string') return notAllowed(path, segMsg(i, seg, 'Y.Map', 'string')); // C1
          const v = c.v.get(seg);
          if (v === undefined) return okUndefined(ctx); // 缺键/显式 undefined 一律吸收（D4）——中间缺失立即结束
          cur = v;
          break;
        }
        case 'yarray': {
          if (!isNonNegInt(seg)) return notAllowed(path, segMsg(i, seg, 'Y.Array', '非负整数')); // C1
          if (seg >= c.v.length) return okUndefined(ctx); // 越界吸收（D4）
          const v = c.v.get(seg);
          if (v === undefined) return notAllowed(path, '数组位置 undefined 不可导航'); // 防御（attached 公共 API 不可达，探针 A1/E21）
          cur = v;
          break;
        }
        case 'plainObject': {
          if (typeof seg !== 'string') return notAllowed(path, segMsg(i, seg, 'plain object', 'string')); // C1
          const hit = readableOwnDataValue(c.v, seg); // D5 键空间助手（descriptor 读，零 accessor 执行）
          if (!hit.hit) return okUndefined(ctx); // 键空间外 ≡ 缺席（D4/D5）
          cur = hit.value;
          break;
        }
        case 'plainArray': {
          if (!isNonNegInt(seg)) return notAllowed(path, segMsg(i, seg, 'plain array', '非负整数')); // C1
          const hit = readableArrayElement(c.v, seg); // D5（descriptor 守卫）
          if (hit.kind === 'none') return okUndefined(ctx); // 越界吸收
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
    // 哨兵（null 是合法投影值：fixture nothing:null / arr[3]===null）。预算经 ctx + d/p 线程
    // 贯通同一递归（F10）：legacy 模式 d/p 不被读取（门控关闭，逐字节现行为）；budget 模式
    // d₀ = 归一化 depth、p₀ = path 的新鲜副本（B9 与实参同基，不别名调用方数组）。
    const r = projectValue(
      cur,
      ctx,
      ctx.budget === null ? 0 : ctx.budget.depth,
      ctx.budget === null ? path : safeSpreadPath(path),
    );
    if (r.kind === 'fail') return notAllowed(path, r.msg); // C3 透传
    if (ctx.budget === null) return { ok: true, value: r.v }; // INV-R3：value 键恒显式构造（r.v 可为合法 null）
    return {
      ok: true,
      value: r.v,
      truncated: ctx.truncations.length > 0, // B14：truncated === (truncations.length > 0)
      truncations: ctx.truncations, // 恒在场（空清单仍是数组，决策 3）
    };
  } catch (err) {
    // 崩溃边界 E100（D10 含 RangeError 循环引用；E22 Proxy trap throw 收编）。
    // F1/P1+P9：detail 提取可能执行敌意代码（非 Error 抛出物的 hostile toString /
    // Error 子类的 throwing message getter / instanceof 的 Proxy getPrototypeOf trap）
    // —— 经 safeDetail 内层 try 收编（回退 'unstringifiable'），绝不二次抛（INV-R1）。
    // V4：options 域缺陷不得经本通道出现（校验在 N0 前短路且自身零外抛）；预算读下 E100
    // 仍返回 PATH_NOT_ALLOWED 成员（budget 联合含该成员形状），只表示内部 bug。
    return notAllowed(path, `DOCRT-E100: 内部错误（意外异常）: ${safeDetail(err)}`);
  }
}

// —— 公共失败/成功构造（D8/INV-R2/R3）——

/**
 * 统一失败构造：path 回显整条尝试路径的**新鲜副本**（不别名调用方数组）；message 恒非空。
 * SA4-F2 勘误守卫（强制）：catch 路径上 path 可能是非数组——无守卫的 `[...path]`
 * 会在 catch 块内部二次抛出，击穿「同步不抛错」（INV-R1）；类型外输入一律归一为 []。
 * F1/P10 延伸：path 可能是 Proxy 包装数组（Array.isArray → true 过 G0，但 spread 触发
 * Symbol.iterator/长度读取 trap）——拷贝经 safeSpreadPath 内层 try 收编（回退 []）。
 */
function notAllowed(path: unknown, message: string): ReadLogicalValueResult {
  return { ok: false, code: 'PATH_NOT_ALLOWED', path: safeSpreadPath(path), message };
}

/**
 * 安全 path 拷贝（F1/P10，SA4-F2 守卫的自然延伸——已防「非数组」，再防「数组但敌意」）：
 * Proxy 包装数组的 `[...path]` 可触发 trap 抛错；内层 try：任何异常回退 []
 * （不外抛，INV-R1）。正常数组输入下与 `[...path]` 行为逐字节一致（回归面零）。
 */
function safeSpreadPath(path: unknown): Array<string | number> {
  if (!Array.isArray(path)) return [];
  try {
    return [...path];
  } catch {
    return [];
  }
}

/**
 * 安全错误详情提取（F1/P1+P9；R2-F1a 收窄）：err 是任意敌方抛出物——`err.message`
 * （throwing getter）或 `String(err)`（hostile toString）均可抛，`instanceof` 亦可能
 * 触发 Proxy getPrototypeOf trap；内层 try：一切异常回退 'unstringifiable'
 * （INV-R1 绝不二次抛）。R2-F1a（NEW1/NEW2）：Error 子类可用 own **数据属性**把
 * message 覆写为敌意对象/Symbol——属性读不抛、内层 try 原样放行，而调用方模板插值
 * `${safeDetail(err)}` 的 ToString 发生在本函数返回之后（内层 try 之外）→ 必须
 * 在返回前做原始 string 收窄（yjsWord 同款模式：typeof raw === 'string' ? raw : 回退）。
 */
function safeDetail(err: unknown): string {
  try {
    const raw = err instanceof Error ? err.message : String(err);
    return typeof raw === 'string' ? raw : 'unstringifiable';
  } catch {
    return 'unstringifiable';
  }
}

/** 合法缺席/合法空值形态：value 键恒显式存在（FC-3/INV-R3）。模式感知：legacy 恰两键、预算读恰四键。 */
function okUndefined(ctx: ProjectionCtx): ReadLogicalValueResult | ReadLogicalValueAtPathBudgetResult {
  if (ctx.budget === null) return { ok: true, value: undefined };
  return {
    ok: true,
    value: undefined,
    truncated: ctx.truncations.length > 0,
    truncations: ctx.truncations,
  };
}

// —— OPT 阶段：options 校验与预算线程（ADR-0024 决策 1；SA6 §12.5 V1–V6）——

/** 段路径类型（ROOT 基绝对路径；递归线程与截断条目共用）。 */
type Path = readonly (string | number)[];

/** 归一化预算：缺席轴以 +Infinity 填充（depth/width 判定统一为纯算术；哨兵永不外泄）。 */
type ValidatedBudget = { depth: number; maxChildrenPerNode: number };

/**
 * 投影上下文（调用局部；模块级零可变态，INV-R9/R10）：
 * - budget === null → legacy 无 options 模式：全部预算逻辑经该判据门控关闭（逐字节现行为）；
 * - truncations 为调用级新鲜累加器（legacy 模式恒空零写入；每次调用独立 → S27 身份互异）。
 */
interface ProjectionCtx {
  budget: ValidatedBudget | null;
  truncations: ReadLogicalValueTruncationEntry[];
}

/**
 * options 校验总函数（V1–V3；非导出，不新增公共校验器）：
 * - 宿主判定（严格判据）：非对象/数组/非 Object.prototype|null 原型 → 非法（与数据载体侧
 *   isPlainRecord 刻意不同：options 是调用方控制面输入，封得更紧——R7）；
 * - 键空间 = own enumerable string 键（symbol/非 enumerable/继承键天然忽略——R8）；
 * - accessor 键 → 非法且**绝不执行**（descriptor 读本身零副作用，INV-R4 同源）；
 * - 未知键 → 非法（含值为 undefined 的未知键）；已知键值 undefined ≡ 缺席（R1）；
 * - 轴值必须 typeof number ∧ Number.isInteger ∧ Number.isFinite ∧ ≥0；-0 归一 0（H10）；
 * - 整体内层 try：Object.keys/getOwnPropertyDescriptor/getPrototypeOf 的 Proxy trap 抛
 *   一律收编为非法（策略 A，绝不外抛）；全程零 getter/setter 执行、零 options 变异。
 */
function validateReadOptions(
  raw: unknown,
): { ok: true; budget: ValidatedBudget } | { ok: false; msg: string } {
  try {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return { ok: false, msg: `options 必须是封闭形状的 plain 对象（实际 ${describeOptions(raw)}）` };
    }
    const proto = Object.getPrototypeOf(raw);
    if (proto !== Object.prototype && proto !== null) {
      return { ok: false, msg: 'options 宿主必须是 Object.prototype 或 null 原型的 plain 对象' };
    }
    let depth = Number.POSITIVE_INFINITY;
    let maxChildrenPerNode = Number.POSITIVE_INFINITY;
    for (const key of Object.keys(raw)) {
      if (key !== 'depth' && key !== 'maxChildrenPerNode') {
        return { ok: false, msg: `options 含未知键（封闭形状）：${key}` };
      }
      const desc = Object.getOwnPropertyDescriptor(raw, key);
      if (desc === undefined) continue; // 敌意 ownKeys 谎报的键：无 descriptor ≡ 非 own 属性，忽略
      if (desc.get !== undefined || desc.set !== undefined) {
        return { ok: false, msg: `options.${key} 不得为 accessor（零 accessor 执行纪律）` };
      }
      const value = desc.value;
      if (value === undefined) continue; // 键在场、值 undefined ≡ 缺席（R1）
      if (typeof value !== 'number' || !Number.isInteger(value) || !Number.isFinite(value) || value < 0) {
        return { ok: false, msg: `options.${key} 必须是 ≥0 的有限整数` };
      }
      const normalized = value === 0 ? 0 : value; // -0 ≡ 0（H10）
      if (key === 'depth') depth = normalized;
      else maxChildrenPerNode = normalized;
    }
    return { ok: true, budget: { depth, maxChildrenPerNode } };
  } catch {
    return { ok: false, msg: 'options 探测期异常（敌意对象）——已收编为 READ_OPTIONS_INVALID' };
  }
}

/** 诊断词汇（message 非契约字段）：非法 options 的实际类型。 */
function describeOptions(raw: unknown): string {
  if (raw === null) return 'null';
  if (Array.isArray(raw)) return 'array';
  return typeof raw;
}

/**
 * options 域失败构造（V5/V6）：path 为 path 实参的**新鲜回显副本**（非数组 → []；Proxy 敌意
 * 经 safeSpreadPath 收编——与 PATH_NOT_ALLOWED / E100 的 path 回显纪律一致）；message 恒非空；
 * **不得**携带 value/truncated/truncations。
 */
function optionsInvalid(path: unknown, message: string): ReadLogicalValueAtPathBudgetResult {
  return { ok: false, code: 'READ_OPTIONS_INVALID', path: safeSpreadPath(path), message };
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
 * - 预算折叠（仅 budget 模式且 d === 0）：容器（Y.Map/Y.Array/plain object/plain array）
 *   折叠为同形空容器 + 至多一条 depth 条目；判定只按「是否容器」与 raw 子槽数（B15：
 *   detached 判别与值域判别**不前置**——被折子项即便内含不可表示值、Y.Text 或 detached
 *   载体也不在折叠处失败；只有被展开/保留并物化时才走下方响亮失败分支）；
 * - detached（R2 #2）：Yjs 家族未集成 doc → 响亮失败（禁空投影）；
 * - Y.Map / Y.Array：递归投影（Yjs 容器分支；预算经 ctx/d/p 贯通）；
 * - Y.XmlFragment：toString() 语义字符串（终态，A2；预算 no-op，B2）；
 * - Y.Text / 未知 shared type：响亮失败（无 toJSON fallback，AC5）；
 * - 其余（scalar / plainObject / plainArray / nonPlainObject / violation）：
 *   copyPlainStrict（plain 域 JSON 值域拷贝器）。
 */
function projectValue(v: unknown, ctx: ProjectionCtx, d: number, p: Path): ProjectOutcome {
  // 预算折叠（B1/B2/B3/B4/B5/B15；仅 budget 模式且层数耗尽——d 为 +Infinity 时恒不触发）
  if (ctx.budget !== null && d === 0) {
    const folded = budgetFold(v);
    if (folded !== null) {
      if (folded.rawTotal >= 1) {
        ctx.truncations.push({ path: p, kind: 'depth', omitted: folded.rawTotal }); // 空容器折叠不记条目（B4）
      }
      return { kind: 'value', v: folded.empty };
    }
    // 终态（标量 / Y.XmlFragment / 值域违规）与折叠无关 → 落到下方现行分支（预算 no-op）
  }
  if (v instanceof Y.AbstractType) {
    if ((v as { doc: unknown }).doc === null) {
      return failOut(`detached Yjs 载体（${yjsWord(v)}，未集成 doc）不可读——拒绝静默空投影`);
    }
  }
  switch (carrierOf(v)) {
    case 'Y.Map':
      return projectYMap(v as Y.Map<unknown>, ctx, d, p);
    case 'Y.Array':
      return projectYArray(v as Y.Array<unknown>, ctx, d, p);
    case 'Y.XmlFragment':
      return { kind: 'value', v: (v as Y.XmlFragment).toString() }; // 语义字符串（不锁逐字，A2）
    case 'Y.Text':
      return failOut('未知 Yjs shared type（Y.Text 家族）——无 toJSON fallback');
    case 'plain value':
      return copyPlainStrict(v, '目标', ctx, d, p); // scalar / plainObject / plainArray / nonPlainObject / violation
    default: {
      if (v instanceof Y.AbstractType) {
        return failOut(`未知 Yjs shared type（${yjsWord(v)}）——无 toJSON fallback`);
      }
      return failOut(`值域违规（不可投影）：${typeof v}`);
    }
  }
}

/**
 * 预算折叠判据（B5/B15/B16；仅 budget 模式 d===0 时调用）：
 * 容器 = Y.Map / Y.Array / plain array / plain object（isPlainRecord 命中）；返回 raw 直接
 * 子槽数（Y.Map.size 含 undefined 值键 / Y.Array.length / plain array length / plain object
 * own enumerable data 键数）与同形空容器（{} / []，proto = Object.prototype）。
 * 零值读取、零 accessor 执行、零递归（B8）；非容器返回 null（终态预算 no-op）。
 * detached 例外（B16③④/R9）：Yjs 家族未集成容器（doc === null）rawTotal 契约定义为 0 且
 * 连公共 count 读也不执行——yjs 对未集成类型的 size/length 报「Invalid access」并以 0 回退，
 * 契约不依赖该回退值（prelim 内容非文档状态）；d ≥ 1 的展开/保留物化仍走现行守卫。
 */
function budgetFold(v: unknown): { rawTotal: number; empty: unknown } | null {
  if (v instanceof Y.Map) {
    if ((v as { doc: unknown }).doc === null) return { rawTotal: 0, empty: {} }; // B16④：零 count 读
    return { rawTotal: v.size, empty: {} };
  }
  if (v instanceof Y.Array) {
    if ((v as { doc: unknown }).doc === null) return { rawTotal: 0, empty: [] }; // B16④：零 count 读
    return { rawTotal: v.length, empty: [] };
  }
  if (Array.isArray(v)) return { rawTotal: v.length, empty: [] };
  if (v !== null && typeof v === 'object' && isPlainRecord(v)) {
    return { rawTotal: plainDataSlotCount(v as Record<string, unknown>), empty: {} };
  }
  return null;
}

/**
 * plain object 的 own enumerable **data** 键序列（含 undefined 值键——B5/B7：undefined 值
 * 键占保留额度但被吸收）；accessor / non-enumerable / 原型链键不占槽（D5 键空间同源）。
 * 全程 descriptor 读：零 getter/accessor 执行（INV-R4）。
 */
function plainDataSlotKeys(obj: Record<string, unknown>): string[] {
  const keys: string[] = [];
  for (const k of Object.keys(obj)) {
    const desc = Object.getOwnPropertyDescriptor(obj, k);
    if (desc === undefined || desc.enumerable !== true) continue;
    if (desc.get !== undefined || desc.set !== undefined) continue;
    keys.push(k);
  }
  return keys;
}

/** raw 直接子槽数（plain object 口径：own enumerable data 键数，见 plainDataSlotKeys）。 */
function plainDataSlotCount(obj: Record<string, unknown>): number {
  let n = 0;
  for (const k of Object.keys(obj)) {
    const desc = Object.getOwnPropertyDescriptor(obj, k);
    if (desc === undefined || desc.enumerable !== true) continue;
    if (desc.get !== undefined || desc.set !== undefined) continue;
    n++;
  }
  return n;
}

/**
 * Y.Map 投影：逐 keys() 递归；get(k)===undefined（含键显式存 undefined）→ 键省略（E1 吸收）。
 * 预算分支（B6/B7/B8）：rawTotal = size（O(1)，含 undefined 值键）；保留前 K 个 raw 槽位
 * （插入序，不承诺稳定），超出前缀的槽位**零 get**；rawTotal > K 时在父路径记单条 width 条目。
 */
function projectYMap(ymap: Y.Map<unknown>, ctx: ProjectionCtx, d: number, p: Path): ProjectOutcome {
  const out: Record<string, unknown> = {};
  if (ctx.budget !== null) {
    const rawTotal = ymap.size; // 计数读（零值读）；含 undefined 值键
    const kept = Math.min(rawTotal, ctx.budget.maxChildrenPerNode);
    if (rawTotal > kept) {
      ctx.truncations.push({ path: p, kind: 'width', omitted: rawTotal - kept }); // B6/B11：父路径单条
    }
    let i = 0;
    for (const k of ymap.keys()) {
      if (i >= kept) break; // B8：超出保留前缀的槽位一律不读（零 get、零递归）
      i++;
      const v = ymap.get(k); // 仅保留槽位允许读值
      if (v === undefined) continue; // 吸收（D4/E1）；槽位仍占保留额度（B7）
      const r = projectValue(v, ctx, d - 1, [...p, k]); // 容器子项耗一层；终态子项忽略 d（B1）
      if (r.kind === 'fail') return r; // fail-fast 透传
      putKey(out, k, r.v); // defineProperty 四真（AC6 陷阱：漏传描述符即事实冻结）
    }
    return { kind: 'value', v: out };
  }
  // legacy（无 options，逐字节现行为；新增逻辑全部经 ctx.budget 门控关闭）
  for (const k of ymap.keys()) {
    const v = ymap.get(k);
    if (v === undefined) continue; // 吸收（D4/E1：yjs toJSON 同判省略）
    const r = projectValue(v, ctx, d, p); // Yjs 容器递归 / plain 域拷贝
    if (r.kind === 'fail') return r;
    putKey(out, k, r.v); // defineProperty 四真（AC6 陷阱：漏传描述符即事实冻结）
  }
  return { kind: 'value', v: out };
}

/**
 * Y.Array 投影：逐下标递归；在界 undefined → 响亮失败（防御分支，attached 公共 API 不可达）。
 * 预算分支（B6/B8）：rawTotal = length；保留前 K 个下标，超出前缀**零 get**；rawTotal > K
 * 时在父路径记单条 width 条目。
 */
function projectYArray(ya: Y.Array<unknown>, ctx: ProjectionCtx, d: number, p: Path): ProjectOutcome {
  const out: unknown[] = [];
  if (ctx.budget !== null) {
    const rawTotal = ya.length;
    const kept = Math.min(rawTotal, ctx.budget.maxChildrenPerNode);
    if (rawTotal > kept) {
      ctx.truncations.push({ path: p, kind: 'width', omitted: rawTotal - kept });
    }
    for (let i = 0; i < kept; i++) {
      const v = ya.get(i); // 仅保留下标允许读值
      if (v === undefined) return failOut('数组位置 undefined 不可投影');
      const r = projectValue(v, ctx, d - 1, [...p, i]);
      if (r.kind === 'fail') return r;
      out.push(r.v); // 数组下标无 __proto__ accessor 病理，可 push
    }
    return { kind: 'value', v: out };
  }
  // legacy（无 options，逐字节现行为）
  for (let i = 0; i < ya.length; i++) {
    const v = ya.get(i);
    if (v === undefined) return failOut('数组位置 undefined 不可投影');
    const r = projectValue(v, ctx, d, p);
    if (r.kind === 'fail') return r;
    out.push(r.v); // 数组下标无 __proto__ accessor 病理，可 push
  }
  return { kind: 'value', v: out };
}

/**
 * plain 域拷贝器（JSON 值域纪律，AC3/AC4 锚定面；与 extract.ts copyPlainValue 显式
 * 分叉，理由见设计 §3 D7）：
 * - 预算折叠（仅 budget 模式且 d === 0）：plain 容器（array / plain object）折叠为同形空
 *   容器 + 至多一条 depth 条目（B15 同款：折叠处零值读零递归，判定不前置 Yjs/值域判别——
 *   被折子项即便内含 Y.Text/嵌套 Yjs/不可表示值也不在折叠处失败）；
 * - number：Number.isFinite 拆支（NaN/±Infinity → 响亮失败，禁静默 null 化）；
 * - string/boolean/null：直通；bigint/undefined/function/symbol：响亮失败；
 * - Yjs 家族（carrierOf 粗判命中或 AbstractType）：响亮失败（嵌套 Yjs shared type，AC4；
 *   仅 d ≥ 1 时可达——d === 0 的容器形态已在折叠分支返回）；
 * - plain array：逐元素 readableArrayElement（空洞/undefined/accessor → 响亮失败）+
 *   递归拷贝；预算模式只读前 K 个下标（B8 零物化），rawTotal > K 时记单条 width 条目；
 * - plain object：proto 守卫（proto ∉ {Object.prototype, null} → 响亮失败，Date/类实例）
 *   + 逐 Object.keys 经 readableOwnDataValue（NONE → 键省略）+ 递归拷贝；预算模式槽位序列
 *   = own enumerable data 键序列（accessor/非 enumerable 不占槽；undefined 值键占额度并被
 *   吸收——B5/B7），只读前 K 个槽位，rawTotal > K 时记单条 width 条目；
 *   输出键写入经 putKey（defineProperty 四真，'__proto__' 自有键安全，E8/E9）。
 */
function copyPlainStrict(v: unknown, loc: string, ctx: ProjectionCtx, d: number, p: Path): ProjectOutcome {
  // 预算折叠（B1/B3/B4/B5/B15；仅 budget 模式且层数耗尽——d 为 +Infinity 时恒不触发）
  if (ctx.budget !== null && d === 0) {
    const folded = budgetFold(v);
    if (folded !== null) {
      if (folded.rawTotal >= 1) {
        ctx.truncations.push({ path: p, kind: 'depth', omitted: folded.rawTotal });
      }
      return { kind: 'value', v: folded.empty };
    }
  }
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
    if (ctx.budget !== null) {
      const rawTotal = v.length;
      const kept = Math.min(rawTotal, ctx.budget.maxChildrenPerNode);
      if (rawTotal > kept) {
        ctx.truncations.push({ path: p, kind: 'width', omitted: rawTotal - kept }); // B6/B11
      }
      for (let i = 0; i < kept; i++) {
        const hit = readableArrayElement(v, i); // 仅保留下标允许 descriptor 读（B8）
        if (hit.kind === 'none') return failOut(`数组位置 undefined 不可投影（${loc}[${i}]）`);
        if (hit.kind === 'violation') return failOut(hit.msg);
        const r = copyPlainStrict(hit.value, `${loc}[${i}]`, ctx, d - 1, [...p, i]);
        if (r.kind === 'fail') return r;
        out.push(r.v);
      }
      return { kind: 'value', v: out };
    }
    // legacy（无 options，逐字节现行为）
    for (let i = 0; i < v.length; i++) {
      const hit = readableArrayElement(v, i);
      if (hit.kind === 'none') return failOut(`数组位置 undefined 不可投影（${loc}[${i}]）`);
      if (hit.kind === 'violation') return failOut(hit.msg);
      const r = copyPlainStrict(hit.value, `${loc}[${i}]`, ctx, d, p);
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
  if (ctx.budget !== null) {
    const slotKeys = plainDataSlotKeys(v as Record<string, unknown>); // own enumerable data 键（含 undefined 值键）
    const rawTotal = slotKeys.length;
    const kept = Math.min(rawTotal, ctx.budget.maxChildrenPerNode);
    if (rawTotal > kept) {
      ctx.truncations.push({ path: p, kind: 'width', omitted: rawTotal - kept }); // B6/B11
    }
    for (let i = 0; i < kept; i++) {
      const k = slotKeys[i] as string; // 前 kept 槽位（前缀在 raw 子槽序上先取，B7）
      const hit = readableOwnDataValue(v as Record<string, unknown>, k);
      if (!hit.hit) continue; // undefined 值 → 键省略（吸收，占额度）
      const r = copyPlainStrict(hit.value, `${loc}.${k}`, ctx, d - 1, [...p, k]);
      if (r.kind === 'fail') return r;
      putKey(out, k, r.v);
    }
    return { kind: 'value', v: out };
  }
  // legacy（无 options，逐字节现行为）
  for (const k of Object.keys(v as Record<string, unknown>)) {
    const hit = readableOwnDataValue(v as Record<string, unknown>, k);
    if (!hit.hit) continue; // accessor / non-enumerable / undefined 值 → 键省略（吸收，D4/D5）
    const r = copyPlainStrict(hit.value, `${loc}.${k}`, ctx, d, p);
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
