/**
 * 递归下降解析器（§3 文法 / §4 分派 / §9 禁止清单 / §2.5 doc 挂载）。
 *
 * 产出 IR（§5.1）并收集结构化 issue；best-effort resync 尽量多收集（§4.3）。
 *
 * doc 挂载（§2.5）：
 * - 可挂载节点（类型别名 / 对象字段）前调用 consumeLeadingDoc()——leading-position-only 挂载。
 * - 非 leading 位置（分隔符/结构边界）的 doc token 经 skipTriviaAndDoc() 丢弃，不挂载、不报错。
 */
import { makeIssue, type InternalIssue, type IssueCategory } from './errors.js'
import type { FieldIR, MarkerName, ModuleIR, Token, TypeAliasIR, TypeIR } from './types.js'

const MARKER_NAMES: readonly MarkerName[] = ['YMap', 'YArray', 'YPlainArray', 'YLeaf', 'YXmlFragment', 'Pattern']

/** 占位类型节点：仅伴随 issue 出现，ok=false 时不返回 IR，不影响可序列化性。 */
const DUMMY: TypeIR = { kind: 'primitive', name: 'unknown' }

export interface Pos {
  line: number
  column: number
}

export class Parser {
  /** 别名声明表（§14.1：重复声明保留首次）。 */
  readonly decl = new Map<string, Pos>()
  /** 别名 → 类型表达式（保留首次声明）。 */
  readonly aliasTypes = new Map<string, TypeIR>()
  /** 引用名 → 首次出现位置（§10.2 未知引用锚点）。 */
  readonly refPositions = new Map<string, Pos>()
  private readonly patternPositions = new Map<TypeIR, Pos>()
  private readonly declarations: TypeAliasIR[] = []
  private readonly issues: InternalIssue[]
  private readonly tokens: Token[]
  private index = 0

  constructor(tokens: Token[], issues: InternalIssue[]) {
    this.tokens = tokens
    this.issues = issues
  }

  /** 模块级解析：Module := (TypeAlias)*（§3）。 */
  parseModule(): ModuleIR {
    while (true) {
      const doc = this.consumeLeadingDoc()
      const t = this.peek()
      if (t.type === 'eof') break // 游离 doc 丢弃（§2.5）
      if (t.type === 'identifier' && t.value === 'type') {
        this.parseTypeAlias(doc)
        continue
      }
      if (t.type === 'identifier' && t.value === 'interface') {
        this.issue('interface 不被 v1 支持（v1 仅支持 type 别名）', t, 'forbidden')
        this.next()
        this.resyncTopLevel()
        continue
      }
      this.issue('仅支持 type 别名声明', t, 'syntax')
      this.next()
      this.resyncTopLevel()
    }
    this.checkPatternContexts()
    return { declarations: this.declarations }
  }

  // ── 类型别名 ──────────────────────────────────────────────

  private parseTypeAlias(doc: string | null): void {
    this.next() // 'type'
    const t = this.peek()
    if (t.type !== 'identifier') {
      this.issue('类型别名缺少名称', t, 'syntax')
      this.resyncTopLevel()
      return
    }
    const nameToken = t
    this.next()
    const isNew = !this.decl.has(nameToken.value)
    if (!isNew) {
      this.issue(`重复的类型别名声明: ${nameToken.value}`, nameToken, 'semantic')
    } else {
      this.decl.set(nameToken.value, { line: nameToken.line, column: nameToken.column })
    }
    this.skipTriviaAndDoc()
    // §9.2a：自定义泛型参数
    if (this.peek().value === '<') {
      this.issue('自定义泛型参数不被 v1 支持', this.peek(), 'forbidden')
      this.skipToEquals()
    }
    this.skipTriviaAndDoc()
    if (this.peek().value !== '=') {
      this.issue('类型别名缺少 = ', this.peek(), 'syntax')
      this.resyncTopLevel()
      return
    }
    this.next() // '='
    this.skipTriviaAndDoc()
    const type = this.parseType()
    if (isNew) this.aliasTypes.set(nameToken.value, type)
    // §9.3：条件类型
    this.skipTrailingDocs()
    if (this.peek().type === 'identifier' && this.peek().value === 'extends') {
      this.issue('条件类型不被 v1 支持', this.peek(), 'forbidden')
      this.resyncTypeExpr()
    }
    this.skipTrailingDocs()
    if (this.peek().value === ';') this.next() // 分号可选（§3.1）
    this.declarations.push({
      kind: 'alias',
      name: nameToken.value,
      doc,
      type,
      line: nameToken.line,
      column: nameToken.column,
    })
  }

  // ── 类型表达式（§4.1 优先级：Union → Intersection → Array → Primary）──

  private parseType(): TypeIR {
    return this.parseUnion()
  }

  private parseUnion(): TypeIR {
    const members: TypeIR[] = [this.parseIntersection()]
    while (true) {
      this.skipTrailingDocs()
      if (this.peek().value !== '|') break
      this.next()
      this.skipTrailingDocs()
      members.push(this.parseIntersection())
    }
    if (members.length === 1) return members[0]
    return { kind: 'union', members }
  }

  private parseIntersection(): TypeIR {
    const left = this.parseArray()
    this.skipTrailingDocs()
    if (this.peek().value !== '&') return left
    const amp = this.next()
    this.skipTrailingDocs()
    const right = this.parseArray()
    // §9.7：& 多于 1 次 → 错误
    this.skipTrailingDocs()
    while (this.peek().value === '&') {
      this.issue('交叉类型仅支持一次 &', this.peek(), 'forbidden')
      this.next()
      this.skipTrailingDocs()
      this.parseArray()
    }
    // §9.7：仅 string & Pattern<"lit"> 合法
    if (!(left.kind === 'primitive' && left.name === 'string')) {
      this.issue('交叉类型仅允许 string & Pattern<"lit">', amp, 'forbidden')
    }
    if (!(right.kind === 'marker' && right.name === 'Pattern')) {
      this.issue('交叉类型仅允许 string & Pattern<"lit">', amp, 'forbidden')
    }
    return { kind: 'intersection', left, right }
  }

  private parseArray(): TypeIR {
    let base = this.parsePrimary()
    while (true) {
      this.skipTrailingDocs()
      if (this.peek().value !== '[') break
      const lb = this.next()
      this.skipTriviaAndDoc()
      if (this.peek().value === ']') {
        this.next()
        base = { kind: 'array', element: base }
        continue
      }
      this.issue('无效的数组类型', lb, 'syntax')
      this.resyncTypeExpr()
      break
    }
    return base
  }

  private parsePrimary(): TypeIR {
    this.skipTriviaAndDoc() // 防御：类型位置不应有游离 doc
    const t = this.peek()
    switch (t.type) {
      case 'number':
        this.next()
        return { kind: 'literal', value: Number(t.value) }
      case 'string':
        this.next()
        return { kind: 'literal', value: t.value }
      case 'punct':
        if (t.value === '{') return this.parseObject()
        if (t.value === '(') {
          this.next()
          const inner = this.parseType()
          this.skipTriviaAndDoc()
          if (this.peek().value === ')') {
            this.next()
          } else {
            this.issue('缺少闭合的 )', this.peek(), 'syntax')
            this.resyncTypeExpr()
            if (this.peek().value === ')') this.next()
          }
          return inner
        }
        if (t.value === '[') {
          // §9.11：前导 [ 即元组（T[] 是后缀）
          this.issue('元组类型不被 v1 支持', t, 'forbidden')
          this.resyncTypeExpr()
          return DUMMY
        }
        this.issue(`意外的符号: ${t.value}`, t, 'syntax')
        this.next()
        this.resyncTypeExpr()
        return DUMMY
      case 'identifier':
        return this.parseIdentifierType(t)
      case 'doc':
        // 游离 doc（防御性兜底）：丢弃后重试
        this.next()
        return this.parsePrimary()
      case 'eof':
        this.issue('缺少类型表达式', t, 'syntax')
        return DUMMY
    }
  }

  /** §4.2 标识符分派表（R2 修订：true/false/Record 无 <>/MarkerName 0 参）。 */
  private parseIdentifierType(t: Token): TypeIR {
    const value = t.value
    // 五原始类型（§4.2：Primitive 分派，优先级最高）
    if (value === 'string' || value === 'number' || value === 'boolean' || value === 'null' || value === 'unknown') {
      this.next()
      return { kind: 'primitive', name: value }
    }
    // §9.1 / §9.9：any / symbol 越界
    if (value === 'any' || value === 'symbol') {
      this.next()
      this.issue(`类型 ${value} 不在 v1 支持集合内`, t, 'forbidden')
      return DUMMY
    }
    // 布尔字面量（攻击点 2：在 TypeRef 之前匹配）
    if (value === 'true' || value === 'false') {
      this.next()
      return { kind: 'literal', value: value === 'true' }
    }
    if (value === 'Record') {
      this.next()
      if (this.peek().value === '<') return this.parseRecord(t)
      // §9.13：Record 必须带 <...>
      this.issue('Record 必须带类型参数: Record<K, V>', t, 'forbidden')
      return DUMMY
    }
    if ((MARKER_NAMES as readonly string[]).includes(value)) {
      this.next()
      return this.parseMarker(t, value as MarkerName)
    }
    // 其他 Identifier
    this.next()
    if (this.peek().value === '<') {
      // §9.2b：非 Record/Marker 的泛型应用 → 禁止
      this.issue('自定义泛型不被 v1 支持', t, 'forbidden')
      this.resyncTypeExpr()
      return DUMMY
    }
    this.recordRef(value, t)
    return { kind: 'ref', name: value }
  }

  /** §6 六标记类型（arity 强制）。 */
  private parseMarker(nameToken: Token, name: MarkerName): TypeIR {
    if (this.peek().value !== '<') {
      // 0 参（§4.2 攻击点 4b / §9.16）：YLeaf/YXmlFragment 合法，其余报 arity 错误
      if (name === 'YLeaf' || name === 'YXmlFragment') {
        return { kind: 'marker', name, argument: null }
      }
      this.issue(`${name} 必须带 1 个类型参数`, nameToken, 'forbidden')
      return { kind: 'marker', name, argument: null }
    }
    this.next() // '<'
    this.skipTriviaAndDoc()
    if (name === 'Pattern') {
      const argToken = this.peek()
      if (argToken.type === 'string') {
        this.next()
        const marker: TypeIR = { kind: 'marker', name, argument: argToken.value }
        this.patternPositions.set(marker, { line: nameToken.line, column: nameToken.column })
        this.skipTriviaAndDoc()
        if (this.peek().value === ',') {
          this.issue('Pattern 必须恰好 1 个参数', nameToken, 'forbidden')
          this.next()
          this.resyncTypeExpr()
          this.expectCloseAngle(nameToken)
        } else {
          this.expectCloseAngle(nameToken)
        }
        return marker
      }
      if (argToken.value === '>') {
        this.issue('Pattern 必须带 1 个 string 字面量参数', nameToken, 'forbidden')
        this.next()
        return { kind: 'marker', name, argument: null }
      }
      // §9.7：Pattern 参数必须是字符串字面量
      this.issue('Pattern 参数必须是字符串字面量', argToken, 'forbidden')
      this.next()
      this.resyncTypeExpr()
      this.expectCloseAngle(nameToken)
      return { kind: 'marker', name, argument: null }
    }
    if (name === 'YLeaf' || name === 'YXmlFragment') {
      // §6：0 参标记带参 → 错误
      this.issue(`${name} 不允许类型参数`, nameToken, 'forbidden')
      this.resyncTypeExpr()
      this.expectCloseAngle(nameToken)
      return { kind: 'marker', name, argument: null }
    }
    // YMap / YArray / YPlainArray：恰好 1 个 TypeIR 参数
    if (this.peek().value === '>') {
      this.issue(`${name} 必须带 1 个类型参数`, nameToken, 'forbidden')
      this.next()
      return { kind: 'marker', name, argument: null }
    }
    const argument = this.parseType()
    this.skipTriviaAndDoc()
    if (this.peek().value === ',') {
      this.issue(`${name} 必须恰好 1 个类型参数`, nameToken, 'forbidden')
      this.next()
      this.resyncTypeExpr()
      this.expectCloseAngle(nameToken)
    } else {
      this.expectCloseAngle(nameToken)
    }
    return { kind: 'marker', name, argument }
  }

  /** §9.8：Record 恰好 2 个类型参数。 */
  private parseRecord(nameToken: Token): TypeIR {
    this.next() // '<'
    this.skipTriviaAndDoc()
    if (this.peek().value === '>') {
      this.issue('Record 必须恰好 2 个类型参数: Record<K, V>', nameToken, 'forbidden')
      this.next()
      return { kind: 'record', key: DUMMY, value: DUMMY }
    }
    const key = this.parseType()
    this.skipTriviaAndDoc()
    if (this.peek().value === ',') {
      this.next()
      this.skipTriviaAndDoc()
    } else {
      this.issue('Record 必须恰好 2 个类型参数: Record<K, V>', nameToken, 'forbidden')
      if (this.peek().value === '>') {
        this.next()
        return { kind: 'record', key, value: DUMMY }
      }
      this.resyncTypeExpr()
      this.expectCloseAngle(nameToken)
      return { kind: 'record', key, value: DUMMY }
    }
    if (this.peek().value === '>') {
      this.issue('Record 必须恰好 2 个类型参数: Record<K, V>', nameToken, 'forbidden')
      this.next()
      return { kind: 'record', key, value: DUMMY }
    }
    const value = this.parseType()
    this.skipTriviaAndDoc()
    if (this.peek().value === ',') {
      this.issue('Record 必须恰好 2 个类型参数: Record<K, V>', nameToken, 'forbidden')
      this.next()
      this.resyncTypeExpr()
      this.expectCloseAngle(nameToken)
    } else {
      this.expectCloseAngle(nameToken)
    }
    return { kind: 'record', key, value }
  }

  // ── 对象字面量与字段 ───────────────────────────────────────

  private parseObject(): TypeIR {
    this.next() // '{'
    const fields: FieldIR[] = []
    while (true) {
      const doc = this.consumeLeadingDoc() // 字段级挂载点（§2.5）
      const t = this.peek()
      if (t.type === 'eof') {
        this.issue('缺少闭合的 }', t, 'syntax')
        break
      }
      if (t.value === '}') {
        this.next()
        break
      }
      fields.push(this.parseField(doc))
      // 分隔符位置（结构边界，§2.5 攻击点 5）：trailing doc（后跟标点/EOF）丢弃；
      // 后跟标识符/字符串键名的 doc 是下一字段的 leading doc，保留给挂载点。
      this.skipTrailingDocs()
      const s = this.peek()
      if (s.type === 'doc') continue // 下一字段的 leading doc，交给循环顶部 consumeLeadingDoc
      if (s.value === ';' || s.value === ',') {
        this.next()
        continue
      }
      if (s.value === '}' || s.type === 'eof') continue // 交给循环顶部闭合/报错
      this.issue('缺少字段分隔符', s, 'syntax')
    }
    return { kind: 'object', fields }
  }

  private parseField(doc: string | null): FieldIR {
    this.skipTriviaAndDoc()
    const t = this.peek()
    // §9.4 / §9.10：映射类型 / 索引签名（前导 [ 即禁止）
    if (t.value === '[') {
      this.next()
      const id = this.peek()
      if (id.type === 'identifier') {
        this.next()
        if (this.peek().value === 'in') this.issue('映射类型 (mapped type) 不被 v1 支持', t, 'forbidden')
        else if (this.peek().value === ':') this.issue('索引签名不被 v1 支持', t, 'forbidden')
        else this.issue('无效的字段声明', t, 'syntax')
      } else {
        this.issue('无效的字段声明', t, 'syntax')
      }
      this.resyncTypeExpr()
      return { kind: 'field', name: '', optional: false, doc: null, type: DUMMY, line: t.line, column: t.column }
    }
    if (t.type !== 'identifier' && t.type !== 'string') {
      this.issue('无效的字段声明', t, 'syntax')
      this.next()
      this.resyncTypeExpr()
      return { kind: 'field', name: '', optional: false, doc: null, type: DUMMY, line: t.line, column: t.column }
    }
    this.next() // 键名
    let optional = false
    if (this.peek().value === '?') {
      optional = true
      this.next()
    }
    if (this.peek().value !== ':') {
      this.issue('字段缺少冒号 :', this.peek(), 'syntax')
      // best-effort：边界处直接结束字段，否则继续尝试解析类型以多收集
      const s = this.peek()
      if (s.value === ';' || s.value === ',' || s.value === '}' || s.type === 'eof') {
        return { kind: 'field', name: t.value, optional, doc, type: DUMMY, line: t.line, column: t.column }
      }
      const type = this.parseType()
      return { kind: 'field', name: t.value, optional, doc, type, line: t.line, column: t.column }
    }
    this.next() // ':'
    this.skipTriviaAndDoc()
    const type = this.parseType()
    return { kind: 'field', name: t.value, optional, doc, type, line: t.line, column: t.column }
  }

  // ── doc 挂载（§2.5）───────────────────────────────────────

  /**
   * 在可挂载节点前消费 leading doc（most-recent-wins：连续 doc 取最后一个）。
   * 返回 null 表示无 doc。
   */
  private consumeLeadingDoc(): string | null {
    let doc: string | null = null
    while (true) {
      if (this.peek().type === 'doc') {
        doc = this.next().value
        continue
      }
      break
    }
    return doc
  }

  /** 跳过 doc token（非挂载的结构位置清场，§2.5）。 */
  private skipTriviaAndDoc(): void {
    while (this.peek().type === 'doc') this.next()
  }

  /**
   * 结构边界清场（trailing doc 处置）：丢弃后跟标点/EOF 的 doc（trailing/游离），
   * 保留后跟标识符/字符串的 doc——那是下一可挂载节点（别名 type 关键字或字段键名）的 leading doc，
   * 必须留给挂载点的 consumeLeadingDoc，避免误吞（红灯 fixture 与 jsdoc「相邻节点不错位」锚定此行为）。
   */
  private skipTrailingDocs(): void {
    while (true) {
      const t = this.peek()
      if (t.type !== 'doc') break
      const nxt = this.tokens[this.index + 1]
      if (nxt.type === 'identifier' || nxt.type === 'string') break
      this.next()
    }
  }

  /** §9.15：独立 Pattern 检测（合法上下文唯一：string & Pattern<"lit"> 的 right）。 */
  private checkPatternContexts(): void {
    for (const type of this.aliasTypes.values()) {
      this.walkPattern(type, null)
    }
  }

  private walkPattern(type: TypeIR, parent: { left: TypeIR } | null): void {
    if (type.kind === 'marker' && type.name === 'Pattern') {
      const legal = parent !== null && parent.left.kind === 'primitive' && parent.left.name === 'string'
      if (!legal) {
        const pos = this.patternPositions.get(type)
        this.issue('Pattern 仅可在 string & Pattern<"lit"> 中使用', pos ?? { line: 1, column: 1 }, 'forbidden')
      }
    }
    switch (type.kind) {
      case 'array':
        this.walkPattern(type.element, null)
        break
      case 'record':
        this.walkPattern(type.key, null)
        this.walkPattern(type.value, null)
        break
      case 'union':
        for (const m of type.members) this.walkPattern(m, null)
        break
      case 'intersection':
        this.walkPattern(type.left, null)
        this.walkPattern(type.right, { left: type.left })
        break
      case 'object':
        for (const f of type.fields) this.walkPattern(f.type, null)
        break
      case 'marker':
        if (typeof type.argument === 'object' && type.argument !== null) this.walkPattern(type.argument, null)
        break
      default:
        break
    }
  }

  // ── 错误恢复（§4.3）───────────────────────────────────────

  /** 类型表达式内 resync：跳到首个 depth=0 的 > 或字段边界（;/、}/EOF）。 */
  private resyncTypeExpr(): void {
    let depth = 0
    while (true) {
      const t = this.peek()
      if (t.type === 'eof') break
      if (t.value === '<') {
        depth++
        this.next()
        continue
      }
      if (t.value === '>') {
        if (depth > 0) {
          depth--
          this.next()
          continue
        }
        break
      }
      if (depth === 0 && (t.value === ';' || t.value === ',' || t.value === '}')) break
      this.next()
    }
  }

  /** 自定义泛型参数后跳到首个 depth=0 的 =。 */
  private skipToEquals(): void {
    let depth = 0
    while (true) {
      const t = this.peek()
      if (t.type === 'eof') break
      if (t.value === '<') {
        depth++
        this.next()
        continue
      }
      if (t.value === '>') {
        if (depth > 0) {
          depth--
          this.next()
          continue
        }
        break
      }
      if (depth === 0 && t.value === '=') break
      this.next()
    }
  }

  /** 顶层 resync：跳到下一个 type/interface/EOF。 */
  private resyncTopLevel(): void {
    while (true) {
      const t = this.peek()
      if (t.type === 'eof') break
      if (t.type === 'identifier' && (t.value === 'type' || t.value === 'interface')) break
      this.next()
    }
  }

  /** 期待闭合的 >；缺失则报错并尽力恢复。 */
  private expectCloseAngle(anchor: Token): void {
    this.skipTriviaAndDoc()
    if (this.peek().value === '>') {
      this.next()
      return
    }
    this.issue('缺少闭合的 >', this.peek(), 'syntax')
    this.resyncTypeExpr()
    if (this.peek().value === '>') this.next()
  }

  // ── 基础工具 ──────────────────────────────────────────────

  private peek(): Token {
    return this.tokens[this.index]
  }

  private next(): Token {
    const t = this.tokens[this.index]
    if (t.type !== 'eof') this.index++
    return t
  }

  private recordRef(name: string, t: Token): void {
    if (!this.refPositions.has(name)) {
      this.refPositions.set(name, { line: t.line, column: t.column })
    }
  }

  private issue(message: string, at: Pos, category: IssueCategory = 'syntax'): void {
    this.issues.push(makeIssue(message, at.line, at.column, category))
  }
}
