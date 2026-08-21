/**
 * @nomicore/vfsl —— VFSL 核心包公共入口（issue #5：parser；issue #20：evaluate；
 * issue #21：validateSnapshot；issue #53：validatePatch + 数组写入校验）。
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
 * - `validateSnapshot(derived, snapshot)` → `{ ok: true } | { ok: false, issues }`
 *   ——整份 JSON 快照校验（issue #21 设计 §2/§3）：值 schema 树解释器，全收集
 *   （上限 100 条 + 截断标记）；Pattern 走包内 NFA 子集模拟（ReDoS 防护，零运行时
 *   依赖）；同步、纯函数、不抛错（崩溃边界同款 E100）。
 * - `parseSchemaEnvelope(input)` → `{ ok: true; envelope; module } | { ok: false;
 *   issues: SchemaParseIssue[] }`——信封解析与方言路由（issue #52 / H1）：issues 是
 *   discriminated union（`kind:'envelope'` 独立信封错误域 / `kind:'vfsl'` 原文本错误）；
 *   形状校验 → 方言断言 → parseVfsl(text)；同步、纯函数、不抛错；
 * - `validatePatch` 与数组写入校验（issue #53）：结构守卫 + 最近结构边界重建，
 *   复用 validateSnapshot 的值 schema 解释器；同步、纯函数、不抛错；
 * - SchemaSource 接缝（issue #25 / ADR 0005 §1/§2）：`FileSchemaSource` 阶段态仓内
 *   文件源（读 Node fs——引擎包内**唯一**环境绑定面，浏览器/edge 不可用；DocSchemaSource
 *   终态另议）、`assertVfslDialect` 方言断言、`SchemaSourceError` 结构化错误。
 *
 * 编排：tokenize → parse（语法相位，失败以 VfslSyntaxError 内部异常承载）→
 * analyze（语义相位，E301/E302/E305/E106/E308 + min-position 聚合 + AST → IR）→
 * evaluate（求值相位，纯函数 IR → 派生物）→ validateSnapshot / validatePatch
 * （校验相位，共用值 schema 解释器，派生物纯数据只读消费）。
 * 公共面导出上述解析/求值/信封路由/全量与增量校验接缝、数组写入校验、
 * SchemaSource 接缝，以及 §7.1 + ADR 0003 类型；tokenizer/parser/semantic/evaluate/
 * validate/pattern/xml/envelope 等内部实现不导出（内部结构非公共契约）。
 */
import { tokenize } from './tokenizer.js';
import { parseModule, VfslSyntaxError } from './parser.js';
import { analyze } from './semantic.js';
import type { ParseVfslResult } from './ir.js';
import { validateEnvelopeShape, dialectIssueOrNull, envelopeCrashIssue } from './envelope.js';
import type { ParseSchemaEnvelopeResult } from './envelope.js';

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

export { evaluate } from './evaluate.js';

export { validateSnapshot } from './validate.js';
export type { ValidateIssue, ValidateResult } from './validate.js';

// issue #53 / H2：路径级写入校验——validatePatch（替换语义）+ 数组三操作
// （append/insert/delete，ADR 0004 D1 词表的运行时判定面）。同步、纯函数、不抛错；
// 结构守卫 + 最近结构边界重建整值校验（与 validateSnapshot 共用解释器）。
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
 */
export function parseSchemaEnvelope(input: unknown): ParseSchemaEnvelopeResult {
  try {
    const shape = validateEnvelopeShape(input);           // §3：ENV-1 / ENV-2+3
    if (!shape.ok) {
      return {
        ok: false,
        issues: shape.issues.map((issue) => ({ kind: 'envelope' as const, issue })),
      };
    }
    const dialect = dialectIssueOrNull(shape.envelope);   // §4：ENV-4
    if (dialect !== null) {
      return { ok: false, issues: [{ kind: 'envelope', issue: dialect }] };
    }
    const parsed = parseVfsl(shape.envelope.text);        // §5：透传（VFSL-E*）
    return parsed.ok
      ? { ok: true, envelope: shape.envelope, module: parsed.module }
      : {
          ok: false,
          issues: parsed.issues.map((issue) => ({ kind: 'vfsl' as const, issue })),
        };
  } catch (err) {
    // 崩溃边界（对齐 parseVfsl E100 最终防线，同款）：getter/Proxy 对抗输入等意外
    // 异常 → 独立 envelope issue（ENV-100），绝不外抛。命中 = 实现缺陷/对抗输入。
    return { ok: false, issues: [{ kind: 'envelope', issue: envelopeCrashIssue(err) }] };
  }
}
