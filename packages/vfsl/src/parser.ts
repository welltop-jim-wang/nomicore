/**
 * 语法层：Token[] → 内部 AST（带位置）（设计 §5）。
 *
 * 递归下降 + 判定顺序 1~7 逐条映射；语法相位错误以内部异常 `VfslSyntaxError`
 * 承载（throw 而非 result-union：单错误模型下控制流最简；该类型不导出，不构成
 * 接缝，§3.3）。「文本序首个错误胜出」由「单向左到右消费记号流 + 任何位置读到
 * error 记号即以该码失败」构造达成（§4.1）。
 *
 * 资源界（#5 §15.2 → #7 R2 §4.6）：使 parseTypeExpr 递归的入口有两个——
 * parseObjectType（`{`）与 parseIdentType 的 marker 分支（五标记 `<`）——共用统一
 * 类型嵌套深度预算 `MAX_TYPE_DEPTH = 100`（原 MAX_OBJECT_DEPTH 更名，值与 v1 承诺
 * 不变；当前嵌套深度：入口 +1、正常出口 -1，§10.7 权威读法）守卫递归栈与序列化
 * 两个资源界；联合成员在 while 循环内逐个解析即返回不叠栈、字面量/原始/ref 是
 * 叶子、generic-diag 平衡扫描是循环；超限 → E100 资源上限口径，锚预算耗尽处构造
 * 起点记号（`{` / 标记 Ident）。v1 生命周期内不得调升/调降（行为稳定承诺）。
 */
import { ErrCode, makeIssue } from './errors.js';
import type { DocLead, Token } from './tokenizer.js';
import type { VfslIssue } from './ir.js';

/** 类型嵌套深度预算（§4.6；统一计数器：对象 `{` 与 marker `<` 两个递归入口共用；
 * 不导出、不进公共面，变更须回总控走设计修订）。 */
const MAX_TYPE_DEPTH = 100;

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
  | { kind: 'union'; members: AstType[]; pos: Pos }
  // 标记类型（EBNF Marker 产生式，§4.3）：pos 保留——#6 的 E304 锚点是「标记记号」
  | { kind: 'marker'; name: 'YMap' | 'YArray' | 'YPlainArray' | 'YLeaf' | 'YXmlFragment'; type: AstType; pos: Pos; docs: string[] };

export interface AstField {
  name: string;
  namePos: Pos;
  optional: boolean;
  type: AstType;
  /** 挂载的文档注释原文（M2 回收；无 doc 时为空数组）。 */
  docs: string[];
}

export interface AstAlias {
  kind: 'alias';
  name: string;
  namePos: Pos;
  type: AstType;
  declIndex: number;
  /** 挂载的文档注释原文（M1 回收；无 doc 时为空数组）。 */
  docs: string[];
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

/** parseModule 内部返回结构（§4.4，不构成公共契约）：dangling 只保留 E305 锚点行列。 */
interface ParseResult {
  aliases: AstAlias[];
  dangling: Array<{ line: number; column: number }>;
}

export function parseModule(tokens: Token[]): ParseResult {
  return new Parser(tokens).parseModule();
}

class Parser {
  private index = 0;
  /** 当前类型嵌套深度（对象 `{` 与 marker 实参共用，§4.6；权威读法：当前嵌套深度，非累计进入数）。 */
  private depth = 0;
  /** E305 候选（DocLead 自带锚点行列，§4.2 集中式记账）。 */
  private dangling: DocLead[] = [];
  /** 最近一次 next() 记入 dangling 的条数（claimDocs 的回收窗口，每次消费重置）。 */
  private depositedByLast = 0;
  /** 已回收上树条数（docTotal 不变量核对用，§4.5）。 */
  private claimed = 0;
  /** 全量记号携带的 doc 总数（构造时一次算好；§4.5 会计基准）。 */
  private readonly docTotal: number;

  constructor(private readonly tokens: Token[]) {
    this.docTotal = tokens.reduce((n, t) => n + (t.leadDocs?.length ?? 0), 0);
  }

  /** 前瞻（offset 0 起）。不抛错——仅「读取并消费」才在 error 记号上失败。 */
  private peek(offset = 0): Token | undefined {
    return this.tokens[this.index + offset];
  }

  /** 读取并消费下一记号；任何位置读到 error 记号即以该码失败（§4.1 普适规则）。
   * 集中式记账（§4.2【R2 · SA2 #3】）：除 error 记号外，消费记号携带的 leadDocs
   * 一律并入 dangling（默认悬空候选）；挂载锚位随后经 claimDocs() 回收。 */
  private next(): Token | undefined {
    const t = this.tokens[this.index];
    if (t === undefined) return undefined;
    this.index += 1;
    if (t.kind === 'error') {
      throw this.errFromToken(t); // 读到即抛、不记账（§4.5：该路径不变量不运行）
    }
    this.depositedByLast = t.leadDocs?.length ?? 0;
    if (t.leadDocs !== undefined) {
      this.dangling.push(...t.leadDocs);
    }
    return t;
  }

  /** 挂载锚位专用（§4.2）：回收「刚消费记号」存入 dangling 的 leadDocs（取 body 数组）。
   * 同步性约束：必须在锚位记号被 next() 消费之后、任何下一次 next() 之前调用；
   * 全 parser 恰三个调用点（M1/M2/M3）。 */
  private claimDocs(): string[] {
    const n = this.depositedByLast;
    this.depositedByLast = 0;
    this.claimed += n;
    return this.dangling.splice(this.dangling.length - n, n).map((d) => d.body);
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
  parseModule(): ParseResult {
    const aliases: AstAlias[] = [];
    for (;;) {
      const tok = this.peek();
      if (tok === undefined || tok.kind === 'eof') {
        // EOF 位（§4.2）：EOF 是正常返回路径上唯一不经 next() 消费的记号——显式
        // 记账（模块末尾悬空 doc 的载体；SA6 用例 4 / 空模块仅一条 doc）
        if (tok !== undefined && tok.kind === 'eof' && tok.leadDocs !== undefined) {
          this.dangling.push(...tok.leadDocs);
        }
        break;
      }
      if (tok.kind === 'error') throw this.errFromToken(tok);
      if (tok.kind === 'ident' && tok.value === 'type') {
        this.next();
        // M1（§4.2）：模块层声明起点回收——紧跟消费，同步性约束内
        const docs = this.claimDocs();
        aliases.push(this.parseTypeAlias(aliases.length, docs));
        continue;
      }
      if (tok.kind === 'ident' && tok.value === 'interface') {
        throw this.err(ErrCode.E105, 'interface 声明族不在 v1 子集（判定顺序第 1 条）', tok);
      }
      throw this.err(ErrCode.E100, `模块层意外记号: ${this.tokenDesc(tok)}`, tok);
    }
    // docTotal 不变量（§4.5）：任何一条 doc 既未挂载也未记悬空 → 构造性排除的
    // 缺陷（静默丢失不可能）；throw 普通 Error → index.ts 顶层兜底 → E100 内部错误
    if (this.claimed + this.dangling.length !== this.docTotal) {
      throw new Error('internal: doc 记账不平衡');
    }
    return { aliases, dangling: this.dangling.map((d) => ({ line: d.line, column: d.column })) };
  }

  // —— 类型别名（判定顺序第 2/7 条）——
  private parseTypeAlias(declIndex: number, docs: string[]): AstAlias {
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
    return { kind: 'alias', name: nameTok.value, namePos: posOf(nameTok), type, declIndex, docs };
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
    if (MARKER_NAMES.has(v)) {
      if (this.peekPunct('<')) {
        // 标记类型（EBNF Marker 产生式，§4.3）：实参接受完整 TypeExpr（形状约束
        // E304 留 #6）。M3 回收（同步性——parsePrimaryType 的 case 'ident' 直通本
        // 函数，中间零次 next()，depositedByLast 未被重置）；统一深度预算守卫（§4.6）。
        const docs = this.claimDocs();
        this.depth += 1;
        if (this.depth > MAX_TYPE_DEPTH) {
          // 锚预算耗尽处的标记 Ident 记号（与「锚预算耗尽处 `{`」同构，§4.6）
          throw this.err(
            ErrCode.E100,
            `嵌套深度超过实现上限 ${MAX_TYPE_DEPTH}（实现资源上限，非方言判定；该文本可从 v1 文法推导）`,
            tok,
          );
        }
        try {
          this.next(); // 消费 '<'
          const arg = this.parseTypeExpr();
          const gt = this.next();
          if (gt === undefined || !(gt.kind === 'punct' && gt.value === '>')) {
            throw this.err(ErrCode.E100, `标记实参缺右尖括号 '>'`, gt);
          }
          return {
            kind: 'marker',
            name: v as 'YMap' | 'YArray' | 'YPlainArray' | 'YLeaf' | 'YXmlFragment',
            type: arg,
            pos: posOf(tok),
            docs,
          };
        } finally {
          this.depth -= 1; // 正常出口深度回退（parseObjectType 同款）
        }
      }
      throw this.err(ErrCode.E100, `裸引用保留名: ${v}（判定顺序第 7 条）`, tok);
    }
    if (v === 'Record') {
      if (this.peekPunct('<')) {
        // 切片外 v1 合法构造（§8）：Record<K,V> 拒绝而非假接受（#6 领地）
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
    if (this.depth > MAX_TYPE_DEPTH) {
      // 深度预算（§4.6）：第 101 层 '{' 被读到 → E100 资源上限口径（锚预算耗尽处）
      throw this.err(
        ErrCode.E100,
        `嵌套深度超过实现上限 ${MAX_TYPE_DEPTH}（实现资源上限，非方言判定；该文本可从 v1 文法推导）`,
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
        // M2（§4.2）：属性声明起点回收——紧跟消费，同步性约束内
        const docs = this.claimDocs();
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
        fields.push({ name: nameTok.value, namePos: posOf(nameTok), optional, type, docs });
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
