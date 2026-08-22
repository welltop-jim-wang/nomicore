/**
 * @nomicore/vfsl —— VFSL 核心包公共入口（issue #5：parser；issue #20：evaluate；
 * issue #21（#71 更名）：validateLogicalSnapshot；issue #53：validatePatch + 数组写入校验）。
 *
 * 公共接缝（PRD #3 + ADR 0003 冻结）：
 * - `parseVfsl(text)` → `{ ok: true; module } | { ok: false; issues }`——同步、
 *   纯函数、**不抛错**：任意输入（含对抗性深嵌套、超长模块、超双精度字面量）的
 *   错误均仅经返回值传递（设计 §14/§15：语法相位深度预算 + 语义相位迭代 DFS +
 *   顶层兜底 catch 三层达成）；
 * - `evaluate(module)` → `{ ok: true; derived } | { ok: false; issues }`——求值器
 *   公共导出（ADR 0003 §1）：IR → 派生 schema（结构树 + 值 schema + 路径索引 +
 *   别名表），纯数据、可 JSON 序列化、无行列；同步、纯函数、不抛错（崩溃边界
 *   与 parseVfsl 同款 E100）；
 * - `validateLogicalSnapshot(derived, snapshot)` → `{ ok: true } | { ok: false, issues }`
 *   ——逻辑快照校验（issue #21 设计 §2/§3；issue #71 / ADR-0007 更名）：值 schema
 *   树解释器，输入为普通 JSON logical ROOT snapshot（不接受 Y.Doc/Y.Map/Y.Array
 *   等 live Yjs 载体）；全收集（上限 100 条 + 截断标记）；Pattern 走包内 NFA 子集
 *   模拟（ReDoS 防护，零运行时依赖）；同步、纯函数、不抛错（崩溃边界同款 E100）。
 * - `parseSchemaEnvelope(input)` → `{ ok: true; envelope; module } | { ok: false;
 *   issues: SchemaParseIssue[] }`——信封解析与方言路由（issue #52 / H1）：issues 是
 *   discriminated union（`kind:'envelope'` 独立信封错误域 / `kind:'vfsl'` 原文本错误）；
 *   形状校验 → 方言断言 → parseVfsl(text)；同步、纯函数、不抛错；
 * - `validatePatch` 与数组写入校验（issue #53）：结构守卫 + 最近结构边界重建，
 *   复用 validateLogicalSnapshot 的值 schema 解释器；同步、纯函数、不抛错；
 * - `getCompiled(input)` → `{ ok: true; module; derived } | { ok: false; issues:
 *   SchemaParseIssue[] }`——DocScope 编译缓存门面（issue #54 / H3）：信封或文本 →
 *   按**文本内容哈希**（sha-256，包内纯 TS 单射字节化）查进程级缓存，命中零
 *   parse/零 evaluate，未命中组合 parseVfsl + evaluate 一次、只存 ok 分支（深冻结
 *   后入册，失败可重试）；同步、纯函数、不抛错（全函数体顶层崩溃边界，ENV-100）；
 * - SchemaSource 接缝（issue #25 / ADR 0005 §1/§2）：`FileSchemaSource` 阶段态仓内
 *   文件源（读 Node fs——引擎包内**唯一**环境绑定面，浏览器/edge 不可用；DocSchemaSource
 *   终态另议）、`assertVfslDialect` 方言断言、`SchemaSourceError` 结构化错误。
 *
 * 编排：tokenize → parse（语法相位，失败以 VfslSyntaxError 内部异常承载）→
 * analyze（语义相位，E301/E302/E305/E106/E308 + min-position 聚合 + AST → IR）→
 * evaluate（求值相位，纯函数 IR → 派生物）→ validateLogicalSnapshot / validatePatch
 * （校验相位，共用值 schema 解释器，派生物纯数据只读消费）。
 * 公共面导出上述解析/求值/信封路由/全量与增量校验接缝、数组写入校验、
 * SchemaSource 接缝，以及 §7.1 + ADR 0003 类型；tokenizer/parser/semantic/evaluate/
 * validate/pattern/xml/envelope 等内部实现不导出（内部结构非公共契约）。
 */
import { tokenize } from './tokenizer.js';
import { parseModule, VfslSyntaxError } from './parser.js';
import { analyze } from './semantic.js';
import type { ParseVfslResult, VfslModule } from './ir.js';
import type { DerivedSchema } from './derived.js';
import { envelopeTextGate, vfslIssues, envelopeCrashIssue } from './envelope.js';
import type { ParseSchemaEnvelopeResult, SchemaParseIssue } from './envelope.js';
import { evaluate } from './evaluate.js';
import { sha256Hex } from './sha256.js';

export type {
  VfslIssue,
  VfslModule,
  VfslAlias,
  VfslField,
  VfslType,
  ParseVfslResult,
} from './ir.js';

export type {
  DerivedSchema,
  StructureNode,
  MapField,
  ValueSchema,
  ValueField,
  IndexEntry,
  Discriminator,
  EvaluateResult,
} from './derived.js';

export { evaluate };

export { validateLogicalSnapshot } from './validate.js';
export type { ValidateIssue, ValidateResult } from './validate.js';

// issue #53 / H2：路径级写入校验——validatePatch（替换语义）+ 数组三操作
// （append/insert/delete，ADR 0004 D1 词表的运行时判定面）。同步、纯函数、不抛错；
// 结构守卫 + 最近结构边界重建整值校验（与 validateLogicalSnapshot 共用解释器）。
export {
  validatePatch,
  validateAppendToArray,
  validateInsertIntoArray,
  validateDeleteFromArray,
} from './validate-patch.js';

// issue #25 / F1：SchemaSource 接缝（ADR 0005 §1/§2）——FileSchemaSource 阶段态仓内文件源、
// 方言断言助手与接缝层结构化错误；消费方（F2 生成器 / G dogfood / CI）经接缝取文本。
export { FileSchemaSource, assertVfslDialect, SchemaSourceError } from './schemasource.js';
export type {
  SchemaSource,
  SchemaEnvelope,
  SchemaSourceErrorCode,
  DialectAssertionInput,
} from './schemasource.js';

// issue #52 / H1：信封解析与方言路由公共接缝返回形状（设计 §2.2——公共面新增
// 1 值导出 parseSchemaEnvelope + 1 类型导出 ParseSchemaEnvelopeResult；
// validateEnvelopeShape/dialectIssueOrNull/envelopeCrashIssue 保持模块内部）。
export type {
  ParseSchemaEnvelopeResult,
  SchemaParseIssue,
  SchemaEnvelopeIssue,
  SchemaEnvelopeIssueCode,
} from './envelope.js';

/**
 * PRD #3 冻结的公共接缝：解析 VFSL v1 文本（本切片构造子集）。
 */
export function parseVfsl(text: string): ParseVfslResult {
  return parseVfslImplementation(text);
}

function parseVfslImplementation(text: string): ParseVfslResult {
  try {
    const tokens = tokenize(text);
    const { aliases, dangling } = parseModule(tokens);
    return analyze(aliases, dangling);
  } catch (err) {
    if (err instanceof VfslSyntaxError) {
      return { ok: false, issues: [err.issue] };
    }
    // 最终防线（设计 §15.4）：未预期异常 → 结构化 E100（崩溃边界转化，非虚假降级——
    // 不返回 ok:true、错误文本进 message）。该路径命中 = 实现缺陷，不得视为通过。
    return {
      ok: false,
      issues: [
        {
          message: `VFSL-E100: 内部错误（意外异常）: ${err instanceof Error ? err.message : String(err)}`,
          line: 1,
          column: 1,
        },
      ],
    };
  }
}

/**
 * Issue #52 / H1：信封解析与方言路由公共接缝。
 * 形状校验（ENV-1/2/3）→ 方言断言（ENV-4，未知方言只读 loud-fail，先于文本解析）
 * → parseVfsl(text) 透传（VFSL-E* 原样，含行列）。同步、纯函数、不抛错。
 *
 * 编排顺序即语义（设计 §5）：形状先于方言（键缺失/类型错时连自述什么方言都读不出）；
 * 方言先于文本（未知方言 → ENV-4 单条返回，parseVfsl 根本不被调用——「只读 loud-fail、
 * 不解释文本」是控制流事实，也是 AC3 顺序锚的机制根源）；透传零损（module/issues
 * 引用直通，不深拷贝、不重包装——AC4 全等由同源性结构性保证）。
 *
 * 编排实现（issue #54 / H3，D5）：形状 → 方言前缀经 envelope.ts 的 `envelopeTextGate`
 * 单点（与 getCompiled 编译缓存前探共用，校验决策点单源）；kind:'vfsl' 包装经
 * `vfslIssues` 单点。行为逐字节不变（执行序同构，构造点单源——H1 既有测试为回归锚）。
 */
export function parseSchemaEnvelope(input: unknown): ParseSchemaEnvelopeResult {
  try {
    const gate = envelopeTextGate(input); // §5 前缀单点（envelope.ts，H3 D5 抽出）
    if (!gate.ok) {
      return { ok: false, issues: gate.issues };
    }
    const parsed = parseVfsl(gate.envelope.text); // §5：透传（VFSL-E*）
    return parsed.ok
      ? { ok: true, envelope: gate.envelope, module: parsed.module }
      : { ok: false, issues: vfslIssues(parsed.issues) };
  } catch (err) {
    // 崩溃边界（对齐 parseVfsl E100 最终防线，同款）：getter/Proxy 对抗输入等意外
    // 异常 → 独立 envelope issue（ENV-100），绝不外抛。命中 = 实现缺陷/对抗输入。
    return { ok: false, issues: [{ kind: 'envelope', issue: envelopeCrashIssue(err) }] };
  }
}

// —— issue #54 / H3：DocScope 编译缓存门面（getCompiled）——

/**
 * getCompiled ok 分支：缓存共享的 IR + 派生 schema 条目。二者与
 * 返回容器均为深冻结对象（§D4.3）——消费者不得变异共享引用；ESM 严格模式下
 * 变异尝试抛 TypeError（loud，非静默降级）。
 */
export interface CompiledOk {
  ok: true;
  module: VfslModule; // parseVfsl ok 产物（IR）
  derived: DerivedSchema; // evaluate ok 产物（派生 schema）
}

/** getCompiled 公共返回形状：失败 issues 与 parseSchemaEnvelope 同域（SchemaParseIssue[]）。 */
export type GetCompiledResult =
  | CompiledOk
  | { ok: false; issues: SchemaParseIssue[] };

/**
 * DocScope 编译缓存门面（H3 / issue #54；ADR-0001「按内容哈希的编译缓存」）。
 * 同步、确定性、不抛错——全函数体顶层崩溃边界（§D11，同 H1 结构，ENV-100）。
 * 缓存键 = sha256(文本内容)（单射字节化：合法码点 UTF-8 + lone surrogate WTF-8 段，
 * §D8.2）——id/载体不参与。同一文本一次 parseVfsl + evaluate、处处取用同一对象
 * 引用；不同文本完全隔离（含仅相差未配对代理的文本）；失败不落缓存（可重试）。
 * v1 进程级无淘汰（§D3 论证）。
 *
 * 入参意图类型为 `string | SchemaEnvelope`（信封或文本，§4.1）；参数取 `unknown`
 * 以表达运行时姿态（与 H1 parseSchemaEnvelope 同源）：非 string 输入一律交 gate
 * 做 unknown 姿态校验——`getCompiled(42)`/`null`/函数 → ENV-1（§6）。
 */
export function getCompiled(input: unknown): GetCompiledResult {
  return getCompiledWith(input, parseVfslImplementation);
}

/** @internal 包内测试接缝：直接证明缓存命中不会再次解析；package exports 不暴露子路径。 */
export function getCompiledWith(
  input: unknown,
  parse: (text: string) => ParseVfslResult,
): GetCompiledResult {
  // 全函数体顶层崩溃边界（R2/A2 · D11——与 parseSchemaEnvelope 同结构）：正常路径
  // 无可抛点（parseVfsl/evaluate 各有自身 catch；sha256Hex 纯循环；deepFreeze 递归
  // 深度被 MAX_TYPE_NESTING=100 结构性封顶——SA2 已核查），此 catch 收编的是
  // 「不可达的实现缺陷信号」与对抗 getter/Proxy——ENV-100 结构化返回，绝不外抛。
  // kind 裁定：统一走 kind:'envelope'（ENV-100）——envelopeCrashIssue 单点构造优先，
  // 且崩溃点无行列语义（kind:'vfsl' 的 VfslIssue 形状不匹配）。
  try {
    // ① 形式判别（D6）：string → 文本通道（隐式 vfsl@1——文本无自述方言，无可断言
    //    对象）；否则信封通道，经 H1 前探门（形状 → 方言断言，未知方言先于文本解释）。
    let text: string;
    if (typeof input === 'string') {
      text = input;
    } else {
      const gate = envelopeTextGate(input); // 对抗 getter 抛出 → 顶层 catch（ENV-100）
      if (!gate.ok) {
        return { ok: false, issues: gate.issues }; // ENV-1/2/3/4 —— H1 同源构造，零损透传
      }
      text = gate.envelope.text;
    }

    // ② 内容哈希键（D2，单射字节化 §D8.2）+ 命中即返（D9：条目即返回值；
    //    命中 = O(sha256)，零 parse/零 evaluate）
    const key = sha256Hex(text);
    const hit = compiledCache.get(key);
    if (hit !== undefined) {
      return hit;
    }

    // ③ miss → 一次 parseVfsl + evaluate（简报：「同一文本一次 parseVfsl + evaluate」）
    const parsed = parse(text);
    if (!parsed.ok) {
      return { ok: false, issues: vfslIssues(parsed.issues) }; // 不落缓存（幂等重拒，可重试）
    }
    const evaluated = evaluate(parsed.module);
    if (!evaluated.ok) {
      return { ok: false, issues: vfslIssues(evaluated.issues) }; // message 零损透传；不落缓存（AC5 可重试）
    }

    // ④ 只存 ok 分支（D4）；深冻结后入册（D4.3——共享引用防变异），返回同一冻结对象
    const entry: CompiledOk = { ok: true, module: parsed.module, derived: evaluated.derived };
    compiledCache.set(key, deepFreeze(entry, new WeakSet<object>()));
    return entry;
  } catch (err) {
    return { ok: false, issues: [{ kind: 'envelope', issue: envelopeCrashIssue(err) }] };
  }
}

/**
 * v1 无淘汰论证（简报明文策略）：进程内命名空间数有界（每 Y.Doc 恰一份 SCHEMA
 * 信封，yjs-server 进程承载的活文档集有限），条目 = 纯数据 IR + 派生 schema（O(文本
 * 规模)，ADR-0003 §4），总量 ≈ 活命名空间数 × 单文本规模——有界。淘汰（LRU/
 * 弱引用/per-DocScope 生命周期）留 v2（§12 checklist）：届时引入 DocScope 实例
 * 工厂，本函数退化为默认实例薄壳，公共契约不变。
 */
const compiledCache = new Map<string, CompiledOk>();

/**
 * 深冻结（D4.3）：递归冻结纯数据产物（含数组与嵌套对象）；WeakSet 防御环（IR/派生物
 * 按契约为无环 DAG，防御性收口而非预期路径）；幂等（重复访问已冻对象即返回）。
 * 只冻 getCompiled 入册的 DocScope 缓存条目（容器 + IR + 派生 schema 引用图，一次 O(条目
 * 规模)，被命中摊薄）；evaluate 接缝本体的直接输出不冻结——求值器设计 §8.3 的 v1
 * 不冻结决策在其自身辖域内原样有效，本助手只是其逃逸条款「共享引用升格突变后果
 * 时再评估」的域内执行。
 */
function deepFreeze<T>(value: T, seen: WeakSet<object>): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (seen.has(value)) {
    return value;
  }
  seen.add(value);
  Object.freeze(value);
  for (const child of Object.values(value)) {
    deepFreeze(child, seen);
  }
  return value;
}
