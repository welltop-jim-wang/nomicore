/**
 * 词法分析（§2）。
 *
 * - 逐字符扫描，维护 line（遇换行 +1）与 column（遇换行重置为 1）。
 * - `//` 行注释与块注释（非 doc）不产出 token，直接跳过且不存储文本（§2.4）。
 * - doc 注释产出 doc token，value 为去掉首尾定界符的正文（trim 外层空白），遇首个闭合序列即闭合（§2.4 已知限制）。
 * - 字符串字面量保留字面原文（含转义反斜杠），不做反转义（§2.3）。
 * - CRLF：`\r` 仅触发换行语义、不推进 column（§2.2）。
 * - EOF token 位置 = (line, max(1, column))，即扫描结束位置（§2.2）。
 * - 未闭合块注释 / 未终止字符串 → 词法 issue（锚定起始位置），best-effort 继续。
 */
import { makeIssue, type InternalIssue } from './errors.js'
import type { Token } from './types.js'

const PUNCT_CHARS = '{}[]()<>;,?:=|&.'

function isIdentStart(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '$' || ch === '_'
}

function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || (ch >= '0' && ch <= '9')
}

export function tokenize(text: string): { tokens: Token[]; issues: InternalIssue[] } {
  const tokens: Token[] = []
  const issues: InternalIssue[] = []
  let i = 0
  let line = 1
  let column = 1
  const len = text.length

  const newline = (): void => {
    line++
    column = 1
  }

  while (i < len) {
    const ch = text[i]

    // 空白
    if (ch === ' ' || ch === '\t') {
      i++
      column++
      continue
    }
    if (ch === '\n') {
      i++
      newline()
      continue
    }
    if (ch === '\r') {
      i++
      if (text[i] === '\n') i++ // \r\n 视作一个换行
      newline()
      continue
    }

    // 注释三分法（§2.4）：// 行注释 / /* */ 块注释 / /** */ doc
    if (ch === '/') {
      const n1 = text[i + 1]
      if (n1 === '/') {
        // 行注释：跳到换行（不含换行）
        while (i < len && text[i] !== '\n' && text[i] !== '\r') {
          i++
          column++
        }
        continue
      }
      if (n1 === '*') {
        const isDoc = text[i + 2] === '*'
        const startLine = line
        const startCol = column
        i += isDoc ? 3 : 2
        column += isDoc ? 3 : 2
        let body = ''
        let closed = false
        while (i < len) {
          if (text[i] === '*' && text[i + 1] === '/') {
            i += 2
            column += 2
            closed = true
            break
          }
          const c = text[i]
          if (c === '\n') {
            i++
            newline()
            continue
          }
          if (c === '\r') {
            i++
            if (text[i] === '\n') i++
            newline()
            continue
          }
          body += c
          i++
          column++
        }
        if (!closed) {
          issues.push(makeIssue('未闭合的注释', startLine, startCol, 'lexical'))
        }
        if (isDoc) {
          tokens.push({ type: 'doc', value: body.trim(), line: startLine, column: startCol })
        }
        continue
      }
      // 孤立 '/'：v1 语法无除法/正则，报词法错误避免静默丢弃
      issues.push(makeIssue(`无法识别的字符: ${ch}`, line, column, 'lexical'))
      i++
      column++
      continue
    }

    // 双引号字符串（§2.3）：\ 转义下一字符，保留字面原文
    if (ch === '"') {
      const startLine = line
      const startCol = column
      i++
      column++
      let value = ''
      let closed = false
      while (i < len) {
        const c = text[i]
        if (c === '"') {
          i++
          column++
          closed = true
          break
        }
        if (c === '\\') {
          value += c
          i++
          column++
          if (i < len) {
            value += text[i]
            i++
            column++
          }
          continue
        }
        if (c === '\n' || c === '\r') break // 未闭合即终止
        value += c
        i++
        column++
      }
      if (!closed) {
        issues.push(makeIssue('未终止的字符串', startLine, startCol, 'lexical'))
      }
      tokens.push({ type: 'string', value, line: startLine, column: startCol })
      continue
    }

    // 数字字面量（§4.2：数字 token 不经 identifier 分派，直接构造 Literal(number)）
    if (ch >= '0' && ch <= '9') {
      const startLine = line
      const startCol = column
      let value = ''
      while (i < len && text[i] >= '0' && text[i] <= '9') {
        value += text[i]
        i++
        column++
      }
      tokens.push({ type: 'number', value, line: startLine, column: startCol })
      continue
    }

    // 标识符（§2.1：字母/$/_ 起始，含字母/数字/$/_；关键字由 parser 按值分派）
    if (isIdentStart(ch)) {
      const startLine = line
      const startCol = column
      let value = ''
      while (i < len && isIdentPart(text[i])) {
        value += text[i]
        i++
        column++
      }
      tokens.push({ type: 'identifier', value, line: startLine, column: startCol })
      continue
    }

    // 标点
    if (PUNCT_CHARS.includes(ch)) {
      tokens.push({ type: 'punct', value: ch, line, column })
      i++
      column++
      continue
    }

    // 无法识别的字符：loud 报错，不静默丢弃
    issues.push(makeIssue(`无法识别的字符: ${ch}`, line, column, 'lexical'))
    i++
    column++
  }

  // EOF token（§2.2）：位置 = 扫描结束位置，column 取 max(1, 当前列)
  tokens.push({ type: 'eof', value: '', line, column: Math.max(1, column) })
  return { tokens, issues }
}
