/**
 * @nomicore/vfsl — VFSL v1 方言 parser 类型定义。
 *
 * 公共契约（冻结，不可改）：parseVfsl(text) → { ok:true, module } | { ok:false, issues:[{message,line,column}] }。
 * IR 形状（§5.1）为推荐形状：纯 JSON 数据，可序列化、可哈希（无 undefined/函数/Symbol/Map/Date）。
 */

/** 词法 token 类型（§2.1）。`//` 与块注释不产 token；仅 doc 注释产出 doc token。 */
export type TokenType = 'identifier' | 'string' | 'number' | 'punct' | 'doc' | 'eof'

export interface Token {
  type: TokenType
  value: string
  line: number // 1-indexed 起始行
  column: number // 1-indexed 起始列
}

/** 结构化错误（公共契约三字段，冻结）。 */
export interface Issue {
  message: string // 非空
  line: number // 1-indexed，落在源文本行内 [1, lineCount]
  column: number // 1-indexed，落在该行内 [1, lineText.length + 1]
}

/** 六标记类型名称（§6，大小写敏感是契约）。 */
export type MarkerName = 'YMap' | 'YArray' | 'YPlainArray' | 'YLeaf' | 'YXmlFragment' | 'Pattern'

/** 类型表达式 IR（判别联合，§5.1）。 */
export type TypeIR =
  | { kind: 'primitive'; name: 'string' | 'number' | 'boolean' | 'null' | 'unknown' }
  | { kind: 'literal'; value: string | number | boolean }
  | { kind: 'union'; members: TypeIR[] }
  | { kind: 'array'; element: TypeIR }
  | { kind: 'record'; key: TypeIR; value: TypeIR }
  | { kind: 'intersection'; left: TypeIR; right: TypeIR }
  | { kind: 'object'; fields: FieldIR[] }
  | { kind: 'ref'; name: string }
  | { kind: 'marker'; name: MarkerName; argument: TypeIR | string | null }

/** 对象字段 IR（§5.1）。可选性用 boolean 表达，缺文档用 null——禁用 undefined。 */
export interface FieldIR {
  kind: 'field'
  name: string
  optional: boolean
  doc: string | null
  type: TypeIR
  line: number
  column: number
}

/** 类型别名 IR（§5.1）。 */
export interface TypeAliasIR {
  kind: 'alias'
  name: string
  doc: string | null
  type: TypeIR
  line: number
  column: number
}

export interface ModuleIR {
  declarations: TypeAliasIR[]
}

/** parseVfsl 返回判别联合（§0.1，冻结）。 */
export type ParseResult =
  | { ok: true; module: ModuleIR }
  | { ok: false; issues: Issue[] }
