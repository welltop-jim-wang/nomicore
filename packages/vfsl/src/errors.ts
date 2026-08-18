/**
 * 内部 issue 构造与分类（§8）。
 *
 * category 是解析期内部标签（§10.2 门控判定用），返回前剥离——
 * 最终 { ok:false, issues } 的每条 issue 严格只有 message/line/column 三字段（§0.1 冻结）。
 */
import type { Issue } from './types.js'

export type IssueCategory = 'lexical' | 'syntax' | 'forbidden' | 'semantic'

export interface InternalIssue {
  message: string
  line: number
  column: number
  category: IssueCategory
}

export function makeIssue(message: string, line: number, column: number, category: IssueCategory): InternalIssue {
  return { message, line, column, category }
}

export function toPublicIssue(issue: InternalIssue): Issue {
  return { message: issue.message, line: issue.line, column: issue.column }
}
