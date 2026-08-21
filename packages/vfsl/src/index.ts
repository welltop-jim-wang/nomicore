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
 * 公共面导出上述解析/求值/全量与增量校验接缝、数组写入校验、SchemaSource 接缝，
 * 以及 §7.1 + ADR 0003 类型；tokenizer/parser/semantic/evaluate/validate/pattern/xml
 * 等内部实现不导出（内部结构非公共契约）。
 */
import { tokenize } from './tokenizer.js';
import { parseModule, VfslSyntaxError } from './parser.js';
import { analyze } from './semantic.js';
import type { ParseVfslResult } from './ir.js';

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
