/**
 * 语义阶段（§10）：别名引用图环检测（DFS 三色）+ 未知引用检查（含语法错误级联门控）。
 *
 * - §10.1：回边（目标在当前 DFS 栈上）即成环，issue 锚定回边所在别名声明位置。
 * - §10.2 门控（攻击点 7）：解析期已有 syntax/forbidden issue → 跳过未知引用检查，
 *   仅保留环检测（对 decl 不完整不敏感），并追加「语义检查已跳过」提示 issue（锚定 (1,1)）。
 * - §10.4：按环上成员集合去重，每环报一条 issue。
 * - 未知引用只报告一次（按引用名，锚定首次出现位置）。
 */
import { makeIssue, type InternalIssue } from './errors.js'
import type { TypeIR } from './types.js'

export interface Pos {
  line: number
  column: number
}

const WHITE = 0
const GRAY = 1
const BLACK = 2

export function runSemantic(
  aliasTypes: Map<string, TypeIR>,
  decl: Map<string, Pos>,
  refPositions: Map<string, Pos>,
  issues: InternalIssue[],
): void {
  const hasSyntaxIssue = issues.some((i) => i.category === 'syntax' || i.category === 'forbidden')

  // 引用图：别名 → 其类型表达式中引用的别名集合（§10.1 collectRefs）
  const edges = new Map<string, Set<string>>()
  for (const [name, type] of aliasTypes) {
    const out = new Set<string>()
    collectRefs(type, out)
    edges.set(name, out)
  }

  // DFS 三色环检测（§10.1）
  const color = new Map<string, number>()
  const reported = new Set<string>()
  const stack: string[] = []
  const dfs = (a: string): void => {
    color.set(a, GRAY)
    stack.push(a)
    for (const b of edges.get(a) ?? []) {
      if (!decl.has(b)) continue // 未知引用由 §10.2 单独报，不计入环
      const c = color.get(b) ?? WHITE
      if (c === GRAY) {
        // 回边 a→b：b 在当前 DFS 栈上 → 成环（§10.4 按成员集合去重）
        const idx = stack.indexOf(b)
        const members = idx >= 0 ? stack.slice(idx) : [a]
        const key = [...members].sort().join(',')
        if (!reported.has(key)) {
          reported.add(key)
          const pos = decl.get(a)!
          issues.push(makeIssue(`循环引用的类型别名: ${a} → ${b}`, pos.line, pos.column, 'semantic'))
        }
      } else if (c === WHITE) {
        dfs(b)
      }
    }
    stack.pop()
    color.set(a, BLACK)
  }
  for (const a of decl.keys()) {
    if ((color.get(a) ?? WHITE) === WHITE) dfs(a)
  }

  if (hasSyntaxIssue) {
    // §10.2 门控：显式声明语义检查在语法错误前提下不完整（loud，非静默降级）
    issues.push(makeIssue('检测到语法错误，语义检查（未知引用）已跳过，结果不完整', 1, 1, 'semantic'))
  } else {
    for (const [name, pos] of refPositions) {
      if (!decl.has(name)) {
        issues.push(makeIssue(`未知的类型引用: ${name}`, pos.line, pos.column, 'semantic'))
      }
    }
  }
}

/** §10.1 collectRefs：递归提取类型表达式中的别名引用（primitive/literal 无引用）。 */
function collectRefs(t: TypeIR, out: Set<string>): void {
  switch (t.kind) {
    case 'ref':
      out.add(t.name)
      break
    case 'array':
      collectRefs(t.element, out)
      break
    case 'record':
      collectRefs(t.key, out)
      collectRefs(t.value, out)
      break
    case 'union':
      for (const m of t.members) collectRefs(m, out)
      break
    case 'intersection':
      collectRefs(t.left, out)
      collectRefs(t.right, out)
      break
    case 'object':
      for (const f of t.fields) collectRefs(f.type, out)
      break
    case 'marker':
      if (typeof t.argument === 'object' && t.argument !== null) collectRefs(t.argument, out)
      break
    default:
      break
  }
}
