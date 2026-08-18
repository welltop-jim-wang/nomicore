/**
 * 语法层：Token[] → 内部 AST（带位置）（设计 §5）。
 *
 * 递归下降 + 判定顺序 1~7 逐条映射；语法相位错误以内部异常 `VfslSyntaxError`
 * 承载（throw 而非 result-union：单错误模型下控制流最简；该类型不导出，不构成
 * 接缝，§3.3）。「文本序首个错误胜出」由「单向左到右消费记号流 + 任何位置读到
 * error 记号即以该码失败」构造达成（§4.1）。
 *
 * 资源界（§15.2）：`parseObjectType` 是唯一使 parseTypeExpr 递归的入口，模块内
 * 常量 `MAX_OBJECT_DEPTH = 100`（当前嵌套深度：入口 +1、正常出口 -1，§10.7 权威
 * 读法）守卫递归栈与序列化两个资源界；超限 → E100 资源上限口径，锚预算耗尽处
 * `{` 记号。v1 生命周期内不得调升/调降（行为稳定承诺）。
 */
import { ErrCode, makeIssue } from './errors.js';
import type { Token } from './tokenizer.js';
import type { VfslIssue } from './ir.js';

/** 当前嵌套深度预算（§15.2；不导出、不进公共面，变更须回总控走设计修订）。 */
const MAX_OBJECT_DEPTH = 100;

export interface Pos {
  line: number;
  column: number;
}

/** 内部 AST（带位置，不导出为契约；锚点为 #6~#9 的 E304/E309 预留）。 */
export type AstType =
  | { kind: 'primitive'; name: 'string' | 'number' | 'boolean' | 'null' | 'unknown'; pos: Pos }
  | { kind: 'literal'; value: string | number; pos: Pos }
  | { kind: 'ref'; name: string; pos: Pos } // TypeRef（E301/E106 锚点）
  | { kind: 'generic-diag'; name: string; namePos: Pos; ltPos: Pos } // 判定顺序第 6 条延迟构造（§5.4）
  | { kind: 'object'; fields: AstField[]; pos: Pos }
  | { kind: 'union'; members: AstType[]; pos: Pos };

export interface AstField {
  name: string;
  namePos: Pos;
  optional: boolean;
  type: AstType;
}

export interface AstAlias {
  kind: 'alias';
  name: string;
  namePos: Pos;
  type: AstType;
  declIndex: number;
}

/** 语法相位内部异常（§3.3）：`parseVfsl` 顶层 catch 转为 { ok: false }。 */
export class VfslSyntaxError extends Error {
  constructor(readonly issue: VfslIssue) {
    super(issue.message);
    this.name = 'VfslSyntaxError';
  }
}

/** 保留名集合（规格 §4，16 名；`true`/`false` 是普通 Ident，不在集合内——注记 8）。 */
const RESERVED_NAMES = new Set([
  'type', 'Record', 'Pattern',
  'string', 'number', 'boolean', 'null', 'unknown',
  'any', 'extends', 'interface',
  'YMap', 'YArray', 'YPlainArray', 'YLeaf', 'YXmlFragment',
]);

/** 六个标记的标准拼写（规格 §6 大小写契约）。 */
const MARKER_NAMES = new Set(['YMap', 'YArray', 'YPlainArray', 'YLeaf', 'YXmlFragment']);

/** 五个原始类型名。 */
const PRIMITIVE_NAMES = new Set(['string', 'number', 'boolean', 'null', 'unknown']);

function posOf(t: Token): Pos {
  return { line: t.line, column: t.column };
}

/** 节点锚点位置：generic-diag 无单一 pos（携带 namePos/ltPos），取 namePos（§5.1/§5.4）。 */
function nodePos(t: AstType): Pos {
  return t.kind === 'generic-diag' ? t.namePos : t.pos;
}

export function parseModule(tokens: Token[]): AstAlias[] {
  return new Parser(tokens).parseModule();
}

class Parser {
  private index = 0;
  /** 当前对象嵌套深度（§10.7 权威读法：当前嵌套深度，非累计进入数）。 */
  private depth = 0;

  constructor(private readonly tokens: Token[]) {}

  /** 前瞻（offset 0 起）。不抛错——仅「读取并消费」才在 error 记号上失败。 */
  private peek(offset = 0): Token | undefined {
    return this.tokens[this.index + offset];
  }

  /** 读取并消费下一记号；任何位置读到 error 记号即以该码失败（§4.1 普适规则）。 */
  private next(): Token | undefined {
    const t = this.tokens[this.index];
    if (t === undefined) return undefined;
    this.index += 1;
    if (t.kind === 'error') {
      throw this.errFromToken(t);
    }
    return t;
  }

  private peekPunct(value: string): boolean {
    const t = this.peek();
    return t !== undefined && t.kind === 'punct' && t.value === value;
  }

  private err(code: string, message: string, anchor: Token | undefined): VfslSyntaxError {
    return new VfslSyntaxError(makeIssue(code, message, anchor?.line ?? 1, anchor?.column ?? 1));
  }

  private errFromToken(t: Token): VfslSyntaxError {
    // 词法错误记号：以 tokenizer 判定的码与位置失败（E100/E201/E202/E203）
    return new VfslSyntaxError(
      makeIssue(t.code ?? ErrCode.E100, t.message ?? '词法错误', t.line, t.column),
    );
  }

  private tokenDesc(t: Token | undefined): string {
    if (t === undefined) return '文件末尾';
    switch (t.kind) {
      case 'ident':
        return `标识符 '${t.value}'`;
      case 'punct':
        return `标点 '${t.value}'`;
      case 'string':
        return '字符串字面量';
      case 'number':
        return `数字字面量 '${t.value}'`;
      case 'eof':
        return '文件末尾';
      case 'error':
        return '词法错误记号';
    }
  }

  // —— 模块层（判定顺序第 1 条：前导 interface → E105）——
  parseModule(): AstAlias[] {
    const aliases: AstAlias[] = [];
    for (;;) {
      const tok = this.peek();
      if (tok === undefined || tok.kind === 'eof') break;
      if (tok.kind === 'error') throw this.errFromToken(tok);
      if (tok.kind === 'ident' && tok.value === 'type') {
        this.next();
        aliases.push(this.parseTypeAlias(aliases.length));
        continue;
      }
      if (tok.kind === 'ident' && tok.value === 'interface') {
        throw this.err(ErrCode.E105, 'interface 声明族不在 v1 子集（判定顺序第 1 条）', tok);
      }
      throw this.err(ErrCode.E100, `模块层意外记号: ${this.tokenDesc(tok)}`, tok);
    }
    return aliases;
  }

  // —— 类型别名（判定顺序第 2/7 条）——
  private parseTypeAlias(declIndex: number): AstAlias {
    const nameTok = this.next();
    if (nameTok === undefined || nameTok.kind !== 'ident') {
      throw this.err(ErrCode.E100, `期望别名声明名，实际 ${this.tokenDesc(nameTok)}`, nameTok);
    }
    if (RESERVED_NAMES.has(nameTok.value)) {
      throw this.err(ErrCode.E303, `别名名占用保留名: ${nameTok.value}`, nameTok);
    }
    if (this.peekPunct('<')) {
      throw this.err(ErrCode.E102, '自定义泛型参数不在 v1 子集（判定顺序第 2 条）', this.peek());
    }
    if (!this.peekPunct('=')) {
      throw this.err(ErrCode.E100, `期望 '='，实际 ${this.tokenDesc(this.peek())}`, this.peek());
    }
    this.next(); // 消费 '='
    const type = this.parseTypeExpr();
    const term = this.next();
    if (term === undefined || !(term.kind === 'punct' && term.value === ';')) {
      throw this.err(ErrCode.E100, `别名缺少终止分号 ';'（注记 4），实际 ${this.tokenDesc(term)}`, term);
    }
    return { kind: 'alias', name: nameTok.value, namePos: posOf(nameTok), type, declIndex };
  }

  // —— 类型表达式 = 联合（注记 2：允许前导 '|'）——
  private parseTypeExpr(): AstType {
    return this.parseUnionType();
  }

  private parseUnionType(): AstType {
    let members: AstType[] = [];
    if (this.peekPunct('|')) {
      this.next();
    }
    members.push(this.parsePostfixType());
    while (this.peekPunct('|')) {
      this.next();
      members.push(this.parsePostfixType());
    }
    if (members.length === 1) {
      return members[0]!; // 单成员联合坍缩（§7.3）
    }
    return { kind: 'union', members, pos: nodePos(members[0]!) };
  }

  // —— 后缀类型（完整 v1 的 ArrayType 位：`[]` 属切片外构造，拒绝）——
  private parsePostfixType(): AstType {
    const t = this.parsePrimaryType();
    while (this.peekPunct('[')) {
      // 不消费循环——首个错误即败；锚 '[' 记号（§8：v1 合法、本切片未实现）
      throw this.err(ErrCode.E100, '数组类型后缀 [] 属 v1 合法构造、本切片未实现（待后续 issue 落地）', this.peek());
    }
    this.dispatchContinuation(t);
    return t;
  }

  /**
   * 类型表达式的续位分派（§5.2）：'&' 族四案例（【R2 · SA2 #6】）与 'extends'
   * （判定顺序第 3 条）。'&' 未冻结角落的确定性选择已登记（§5.5）。
   */
  private dispatchContinuation(prev: AstType): void {
    const tok = this.peek();
    if (tok === undefined) return;
    if (tok.kind === 'punct' && tok.value === '&') {
      const isString = prev.kind === 'primitive' && prev.name === 'string';
      if (isString) {
        const p1 = this.peek(1);
        if (p1 !== undefined && p1.kind === 'ident' && p1.value === 'Pattern') {
          const p2 = this.peek(2);
          if (p2 !== undefined && p2.kind === 'punct' && p2.value === '<') {
            throw this.err(ErrCode.E100, 'string & Pattern<…> 属 v1 合法构造、本切片未实现（待后续 issue 落地）', tok);
          }
          throw this.err(ErrCode.E100, 'Pattern 脱离 string & Pattern<…> 语境（判定顺序第 7 条）', p1);
        }
      }
      throw this.err(ErrCode.E100, '交叉类型仅允许 string & Pattern<…>', tok);
    }
    if (tok.kind === 'ident' && tok.value === 'extends') {
      throw this.err(ErrCode.E103, '条件类型不在 v1 子集（判定顺序第 3 条）', tok);
    }
  }

  // —— 主类型（判定顺序在此分派；「类型位置」语境）——
  private parsePrimaryType(): AstType {
    const tok = this.next();
    if (tok === undefined) {
      throw this.err(ErrCode.E100, '类型位置缺记号（文件末尾）', tok);
    }
    switch (tok.kind) {
      case 'punct':
        if (tok.value === '{') {
          return this.parseObjectType(tok);
        }
        if (tok.value === '(') {
          throw this.err(ErrCode.E100, '括号分组不在 v1 子集（注记 5）', tok);
        }
        throw this.err(ErrCode.E100, `类型位置意外记号: ${this.tokenDesc(tok)}`, tok);
      case 'string':
        return { kind: 'literal', value: tok.value, pos: posOf(tok) };
      case 'number':
        // 【R2 · SA2 #2】超双精度（Number.isFinite 为假）→ E100 锚该数字记号（§7.3）
        if (tok.num === undefined || !Number.isFinite(tok.num)) {
          throw this.err(ErrCode.E100, '数字字面量超出可序列化数值域（双精度上限 ≈1.8e308；实现值域上限，非方言判定）', tok);
        }
        return { kind: 'literal', value: tok.num, pos: posOf(tok) };
      case 'ident':
        return this.parseIdentType(tok);
      case 'eof':
        throw this.err(ErrCode.E100, '类型位置缺记号（文件末尾）', tok);
      case 'error':
        throw this.errFromToken(tok); // next() 已抛，防御性分支
    }
  }

  /** 类型位置的 Ident 分派（判定顺序 1/3/5/7 条 + 第 6 条 generic-diag）。 */
  private parseIdentType(tok: Token): AstType {
    const v = tok.value;
    if (v === 'interface') {
      throw this.err(ErrCode.E105, 'interface 声明族不在 v1 子集（判定顺序第 1 条）', tok);
    }
    if (v === 'extends') {
      throw this.err(ErrCode.E103, '条件类型不在 v1 子集（判定顺序第 3 条）', tok);
    }
    if (v === 'any') {
      throw this.err(ErrCode.E101, 'any 类型被禁止（判定顺序第 5 条）', tok);
    }
    if (v === 'Record' || MARKER_NAMES.has(v)) {
      if (this.peekPunct('<')) {
        // 切片外 v1 合法构造（§8）：Record<K,V> / YMap<…> 等，拒绝而非假接受
        throw this.err(ErrCode.E100, `${v}<…> 属 v1 合法构造、本切片未实现（待后续 issue 落地）`, tok);
      }
      throw this.err(ErrCode.E100, `裸引用保留名: ${v}（判定顺序第 7 条）`, tok);
    }
    if (v === 'type' || v === 'Pattern') {
      if (v === 'Pattern' && this.peekPunct('<')) {
        throw this.err(ErrCode.E100, '裸 Pattern 脱离 string & Pattern<…> 语境（判定顺序第 7 条）', tok);
      }
      throw this.err(ErrCode.E100, `保留名出现在类型位置: ${v}（判定顺序第 7 条）`, tok);
    }
    if (PRIMITIVE_NAMES.has(v)) {
      if (this.peekPunct('<')) {
        // 保留名后随 '<'（判定顺序第 7 条）：锚该原始类型名记号，非 '<'
        throw this.err(ErrCode.E100, `保留名后随 '<': ${v}<…>（判定顺序第 7 条）`, tok);
      }
      return { kind: 'primitive', name: v as 'string' | 'number' | 'boolean' | 'null' | 'unknown', pos: posOf(tok) };
    }
    // 非保留名（含 true/false——注记 8：普通 Ident，未声明即 E301）
    if (this.peekPunct('<')) {
      return this.parseGenericDiag(tok);
    }
    return { kind: 'ref', name: v, pos: posOf(tok) };
  }

  /**
   * generic-diag 构造（判定顺序第 6 条的延迟终判，§5.4）：语法相位消费该 Ident 与
   * 平衡角括号扫描（depth 计数，只认 < / > 单字符记号）；扫描中任何位置读到 error
   * 记号 → 即以其码失败（§4.1 普适规则的显式延伸，禁止吞词法错误直奔 EOF）。
   * 产出节点不携带 IR 等价物；终判（已声明 → E100 锚 '<'；未声明 → E301 锚
   * 引用记号）在语义相位进行。该节点永远产生语义相位 issue，不可能进入 ok:true。
   */
  private parseGenericDiag(nameTok: Token): AstType {
    const namePos = posOf(nameTok);
    const ltTok = this.next()!; // peekPunct('<') 已确认
    const ltPos = posOf(ltTok);
    let angleDepth = 1;
    for (;;) {
      const tok = this.next();
      if (tok === undefined || tok.kind === 'eof') {
        throw this.err(ErrCode.E100, '泛型实参角括号未闭合', ltTok);
      }
      if (tok.kind === 'punct' && tok.value === '<') {
        angleDepth += 1;
      } else if (tok.kind === 'punct' && tok.value === '>') {
        angleDepth -= 1;
        if (angleDepth === 0) break;
      }
      // 其余记号（Ident / ',' / 字面量等）跳过继续扫描
    }
    return { kind: 'generic-diag', name: nameTok.value, namePos, ltPos };
  }

  // —— 封闭对象字面量（注记 3；判定顺序第 4 条：字段名位 '[' → E104）——
  private parseObjectType(openTok: Token): AstType {
    this.depth += 1;
    if (this.depth > MAX_OBJECT_DEPTH) {
      // 【R2 · SA2 #1】深度预算：第 101 层 '{' 被读到 → E100 资源上限口径（§15.2）
      throw this.err(
        ErrCode.E100,
        `嵌套深度超过实现上限 ${MAX_OBJECT_DEPTH}（实现资源上限，非方言判定；该文本可从 v1 文法推导）`,
        openTok,
      );
    }
    try {
      const fields: AstField[] = [];
      if (this.peekPunct('}')) {
        this.next();
        return { kind: 'object', fields, pos: posOf(openTok) }; // 空对象（注记 3）
      }
      for (;;) {
        const nameTok = this.next();
        if (nameTok === undefined) {
          throw this.err(ErrCode.E100, '期望字段名，实际文件末尾', nameTok);
        }
        if (nameTok.kind === 'punct' && nameTok.value === '[') {
          throw this.err(ErrCode.E104, 'mapped type 不在 v1 子集（判定顺序第 4 条）', nameTok);
        }
        if (nameTok.kind === 'ident' && RESERVED_NAMES.has(nameTok.value)) {
          // 【R2 · SA2 #3】字段名位保留名 → E100 锚该保留名记号（keyword-token 读法，
          // 与类型位/声明名位同族；论证见设计 §5.5 注）
          throw this.err(ErrCode.E100, `字段名位保留名: ${nameTok.value}`, nameTok);
        }
        if (nameTok.kind !== 'ident') {
          throw this.err(ErrCode.E100, `期望字段名标识符，实际 ${this.tokenDesc(nameTok)}`, nameTok);
        }
        let optional = false;
        if (this.peekPunct('?')) {
          this.next();
          optional = true;
        }
        if (!this.peekPunct(':')) {
          throw this.err(ErrCode.E100, `期望 ':'，实际 ${this.tokenDesc(this.peek())}`, this.peek());
        }
        this.next(); // 消费 ':'
        const type = this.parseTypeExpr();
        fields.push({ name: nameTok.value, namePos: posOf(nameTok), optional, type });
        const sep = this.next();
        if (sep === undefined) {
          throw this.err(ErrCode.E100, '期望字段分隔符，实际文件末尾', sep);
        }
        if (sep.kind === 'punct' && (sep.value === ';' || sep.value === ',')) {
          // 尾分隔符合法：循环顶遇 '}' 即闭合
          if (this.peekPunct('}')) {
            this.next();
            break;
          }
          continue;
        }
        if (sep.kind === 'punct' && sep.value === '}') {
          break; // 末字段无分隔符合法
        }
        throw this.err(ErrCode.E100, `期望字段分隔符 ';' 或 ','，实际 ${this.tokenDesc(sep)}`, sep);
      }
      return { kind: 'object', fields, pos: posOf(openTok) };
    } finally {
      this.depth -= 1; // 正常出口深度回退（SA2 R2-1 权威读法）
    }
  }
}
