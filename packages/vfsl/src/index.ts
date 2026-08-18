/**
 * @nomicore/vfsl — VFSL v1 方言 parser
 *
 * 公共接缝（契约，冻结，不可改）：
 *   parseVfsl(text) → { ok: true, module: ModuleIR } | { ok: false, issues: [{ message, line, column }] }
 *
 * 四阶段流水线（§1）：tokenize → parse（含 doc 挂载与禁止清单）→ semantic（环检测 + 未知引用）→ build IR。
 * 任一 issue 存在即返回 { ok:false, issues }；ok=true 当且仅当 issues.length === 0 且解析完整。
 * 纯函数：无副作用、确定性、零运行时依赖（§11）。
 */
import { Parser } from './parser.js'
import { runSemantic } from './semantic.js'
import { tokenize } from './tokenizer.js'
import { toPublicIssue } from './errors.js'
import type { ParseResult } from './types.js'

export type { ParseResult, Issue, ModuleIR, TypeAliasIR, FieldIR, TypeIR, MarkerName } from './types.js'

export function parseVfsl(text: string): ParseResult {
  const { tokens, issues } = tokenize(text)
  const parser = new Parser(tokens, issues)
  const module = parser.parseModule()
  runSemantic(parser.aliasTypes, parser.decl, parser.refPositions, issues)
  const publicIssues = issues.map(toPublicIssue)
  if (publicIssues.length > 0) {
    return { ok: false, issues: publicIssues }
  }
  return { ok: true, module }
}
