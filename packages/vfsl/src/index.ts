/**
 * @nomicore/vfsl —— VFSL 核心包公共入口（issue #5：parser 最小端到端）。
 *
 * 公共接缝（PRD #3 冻结）：`parseVfsl(text)` → `{ ok: true; module } |
 * { ok: false; issues }`——同步、纯函数、**不抛错**：任意输入（含对抗性深嵌套、
 * 超长模块、超双精度字面量）的错误均仅经返回值传递（设计 §14/§15：语法相位深度
 * 预算 + 语义相位迭代 DFS + 顶层兜底 catch 三层达成）。
 *
 * 编排：tokenize → parse（语法相位，失败以 VfslSyntaxError 内部异常承载）→
 * analyze（语义相位，E301/E302/E106/E308 + min-position 聚合 + AST → IR）。
 * 公共面只导出 `parseVfsl` 与 §7.1 类型；tokenizer/parser/semantic 内部件不导出
 * （内部结构非公共契约）。
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

/**
 * PRD #3 冻结的公共接缝：解析 VFSL v1 文本（本切片构造子集）。
 */
export function parseVfsl(text: string): ParseVfslResult {
  try {
    const tokens = tokenize(text);
    const aliases = parseModule(tokens);
    return analyze(aliases);
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
