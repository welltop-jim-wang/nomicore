/**
 * Pattern 执行引擎：包内 NFA 子集模拟匹配器（issue #21 设计 §6，O3 定稿；R2 重设计）。
 *
 * 为什么不用原生 RegExp（设计 §6.1 否决表）：同步单线程下无法中断运行中的原生匹配
 * （worker/超时/watchdog 均破坏同步纯函数签名或引入运行时依赖）；且 ReDoS 红灯
 * `(a+)+$ × 'a'*32+'!'` 正是原生引擎的指数回溯死局。本引擎 = 无捕获字节码 + 宽度
 * 优先子集模拟：子集内模式**多项式完成**（定理 T1 线性 / T2 二次，设计 §6.4）——
 * 挂死结构性不可能；零运行时依赖（包内纯 TS）；同步；确定性。
 *
 * 运行路径完全不出现原生 RegExp 构造（连编译探测也不用，杜绝引擎间行为差异）。
 * 反向引用 `\1`~`\9` 按子集外构造 loud 拒（§6.2.1 收窄）。
 *
 * 步数预算退居规模护栏：`min(4_000_000, max(8_192, 1_024×len + 512×len² + 16_384))`
 * （R3 形状对齐定理分列——线性项覆盖 T1 类、二次项覆盖 T2 类）；耗尽 → loud
 * PatternBudgetExceeded（fail-closed，不冒充「不匹配」）。步数经 charge 钩子同步计入
 * 全局工作预算（依赖注入，无模块级状态）。
 *
 * lookMemo 稀疏物化（R4 存储规约，SA4 静态锚点）：`Map<Look 指令, Map<pos, boolean>>`
 * 只有被写的 (Look, pos) 槽才占内存——**禁止稠密预分配** `new Array(len+1)` /
 * `new Uint8Array(len+1)`（分配不是计费步、双预算对其失明；200 条空前瞻 × 10⁷ 码元
 * 可在 ~600 计费单位下物化 2×10⁹ 槽，V8 OOM 不可 catch）。
 */

// —— 公共（包内）类型与错误 ——

/** 编译失败（语法非法，如 `Pattern<"[">` 的裸 `[`）——§6.5 第一类 loud。 */
export class PatternCompileError extends Error {
  constructor(readonly detail: string) {
    super(detail);
    this.name = 'PatternCompileError';
  }
}

/** 子集外构造（反向引用 / 后行断言 / 命名分组 / Unicode 属性转义 / 内联标志 / 类内八进制）——§6.5 第二类 loud。 */
export class PatternUnsupportedError extends Error {
  constructor(readonly construct: string) {
    super(construct);
    this.name = 'PatternUnsupportedError';
  }
}

/** 编译期程序规模超限（{n,m} 展开超 10_000 指令）——§6.5 第三类 loud。 */
export class PatternTooLargeError extends Error {
  constructor(readonly copies: number) {
    super(`程序规模超限（量词展开 ${copies} 份）`);
    this.name = 'PatternTooLargeError';
  }
}

/** 匹配步数预算耗尽（运行期，携带单匹配上下文）——§6.5 第四类 loud。 */
export class PatternBudgetExceeded extends Error {
  constructor(readonly inputLen: number, readonly budget: number) {
    super(`匹配步数预算耗尽（输入长度 ${inputLen}，预算 ${budget}）`);
    this.name = 'PatternBudgetExceeded';
  }
}

/** 字符集合（区间表；negated = 补类，编译期求补）。 */
interface CharSet {
  negated: boolean;
  ranges: Array<[number, number]>;
}

/** 无捕获字节码指令（无 Save / 无 Backref；Split 无优先序标注——布尔语义不需要）。 */
type Instr =
  | { op: 'char'; cp: number }
  | { op: 'class'; setId: number }
  | { op: 'any' } // 除行终止符外任意 UTF-16 码元（无 s 标志语义）
  | { op: 'assertStart' }
  | { op: 'assertEnd' }
  | { op: 'wordB'; neg: boolean } // \b / \B
  | { op: 'jmp'; x: number }
  | { op: 'split'; x: number; y: number }
  | { op: 'look'; neg: boolean; sub: number; subMatch: number } // 前瞻：锚定子模拟
  | { op: 'match' };

/** 编译产物（validate.ts 调用局部 regexCache 缓存；不可变消费）。 */
export interface CompiledPattern {
  prog: Instr[];
  sets: CharSet[];
  /** 指令数（编译计费 = 产物指令数；规模上限 10_000）。 */
  size: number;
}

/** 模拟运行期共享状态（一次 match 调用局部；lookMemo 稀疏物化）。 */
interface MatchCtx {
  prog: Instr[];
  sets: CharSet[];
  input: string;
  len: number;
  budget: number;
  steps: number;
  lookMemo: Map<Instr, Map<number, boolean>>;
  /** 全局工作预算钩子（validate.ts 注入；每步 1 单位）。 */
  charge: (n: number) => void;
}

const MAX_PROGRAM_SIZE = 10_000;

// —— 预定义类（ECMAScript WhiteSpace ∪ LineTerminator / ASCII 数字 / ASCII 词字符）——

const DIGIT: Array<[number, number]> = [[0x30, 0x39]];
const SPACE: Array<[number, number]> = [
  [0x09, 0x0d], [0x20, 0x20], [0xa0, 0xa0], [0x1680, 0x1680], [0x2000, 0x200a],
  [0x2028, 0x2029], [0x202f, 0x202f], [0x205f, 0x205f], [0x3000, 0x3000], [0xfeff, 0xfeff],
];
const WORD: Array<[number, number]> = [[0x30, 0x39], [0x41, 0x5a], [0x5f, 0x5f], [0x61, 0x7a]];

const PREDEFINED: Record<string, CharSet> = {
  d: { negated: false, ranges: DIGIT },
  D: { negated: true, ranges: DIGIT },
  s: { negated: false, ranges: SPACE },
  S: { negated: true, ranges: SPACE },
  w: { negated: false, ranges: WORD },
  W: { negated: true, ranges: WORD },
};

function isLineTerminator(cp: number): boolean {
  return cp === 0x0a || cp === 0x0d || cp === 0x2028 || cp === 0x2029;
}

function isWordChar(cp: number): boolean {
  return (cp >= 0x30 && cp <= 0x39) || (cp >= 0x41 && cp <= 0x5a) || cp === 0x5f || (cp >= 0x61 && cp <= 0x7a);
}

function setHas(set: CharSet, cp: number): boolean {
  let hit = false;
  for (const [a, b] of set.ranges) {
    if (cp >= a && cp <= b) {
      hit = true;
      break;
    }
  }
  return set.negated ? !hit : hit;
}

/** 区间表合并（排序 + 相邻/重叠归并）——类表构造期归一。 */
function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  let [lo, hi] = sorted[0]!;
  for (let i = 1; i < sorted.length; i++) {
    const [a, b] = sorted[i]!;
    if (a <= hi + 1) {
      if (b > hi) hi = b;
    } else {
      out.push([lo, hi]);
      [lo, hi] = [a, b];
    }
  }
  out.push([lo, hi]);
  return out;
}

// —— 语法分析（设计 §6.2 冻结子集 + Annex B 宽松解析；纯手写，零 RegExp）——

type AstNode =
  | { kind: 'empty' }
  | { kind: 'char'; cp: number }
  | { kind: 'class'; set: CharSet }
  | { kind: 'any' }
  | { kind: 'assertStart' }
  | { kind: 'assertEnd' }
  | { kind: 'wordB'; neg: boolean }
  | { kind: 'concat'; items: AstNode[] }
  | { kind: 'alt'; arms: AstNode[] }
  | { kind: 'repeat'; node: AstNode; min: number; max: number | null }
  | { kind: 'look'; neg: boolean; node: AstNode };

/** 字符类成员：单字符或补类（多字符类不可作区间端点，Annex B）。 */
type ClassAtom = { kind: 'char'; cp: number } | { kind: 'class'; set: CharSet };

function isHexDigit(c: string | undefined): boolean {
  return (
    c !== undefined &&
    ((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'))
  );
}

function isAsciiLetter(c: string | undefined): c is string {
  return c !== undefined && ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'));
}

/** 控制转义 `\cX`：X % 32（X ∈ A-Za-z）。 */
function controlValue(c: string): number {
  return c.codePointAt(0)! % 32;
}

class Parser {
  private i = 0;

  constructor(private readonly s: string) {}

  private peek(): string | undefined {
    return this.s[this.i];
  }

  /** 顶层：交替式 + 收尾校验（悬空 `)` 等 → 编译失败）。 */
  parse(): AstNode {
    const node = this.parseAlternation();
    if (this.i < this.s.length) {
      throw new PatternCompileError(`意外的字符 "${this.s[this.i]}"`);
    }
    return node;
  }

  private parseAlternation(): AstNode {
    const arms = [this.parseConcat()];
    while (this.peek() === '|') {
      this.i++;
      arms.push(this.parseConcat());
    }
    return arms.length === 1 ? arms[0]! : { kind: 'alt', arms };
  }

  private parseConcat(): AstNode {
    const items: AstNode[] = [];
    while (this.i < this.s.length && this.s[this.i] !== '|' && this.s[this.i] !== ')') {
      items.push(this.parseTerm());
    }
    if (items.length === 0) return { kind: 'empty' };
    return items.length === 1 ? items[0]! : { kind: 'concat', items };
  }

  private parseTerm(): AstNode {
    const node = this.parseAtom();
    const c = this.peek();
    if (c === '*') {
      this.i++;
      this.skipLazy();
      return { kind: 'repeat', node, min: 0, max: null };
    }
    if (c === '+') {
      this.i++;
      this.skipLazy();
      return { kind: 'repeat', node, min: 1, max: null };
    }
    if (c === '?') {
      this.i++;
      this.skipLazy();
      return { kind: 'repeat', node, min: 0, max: 1 };
    }
    if (c === '{') {
      const q = this.tryParseBraceQuantifier();
      if (q !== null) {
        this.skipLazy();
        return { kind: 'repeat', node, min: q.min, max: q.max };
      }
      // 非法量词形 → `{` 按字面量（Annex B；下一轮 parseAtom 消费）
    }
    return node;
  }

  /** 惰性后缀 `?`（惰性/贪婪编译同形——布尔语义下等价，§6.2）。 */
  private skipLazy(): void {
    if (this.peek() === '?') this.i++;
  }

  /** `{n}` `{n,}` `{n,m}` 合法形 → 量词；否则返回 null（`{` 留作字面量）。 */
  private tryParseBraceQuantifier(): { min: number; max: number | null } | null {
    const start = this.i;
    this.i++; // 消费 '{'
    const minStr = this.readDigits();
    if (minStr === '') {
      this.i = start;
      return null;
    }
    const min = Number(minStr);
    const c = this.peek();
    if (c === '}') {
      this.i++;
      return { min, max: min };
    }
    if (c === ',') {
      this.i++;
      const maxStr = this.readDigits();
      if (this.peek() === '}') {
        this.i++;
        return { min, max: maxStr === '' ? null : Number(maxStr) };
      }
    }
    this.i = start;
    return null;
  }

  private readDigits(): string {
    const start = this.i;
    while (this.i < this.s.length && this.s[this.i]! >= '0' && this.s[this.i]! <= '9') this.i++;
    return this.s.slice(start, this.i);
  }

  private parseAtom(): AstNode {
    const c = this.peek();
    if (c === undefined) {
      throw new PatternCompileError('正则表达式意外结束');
    }
    if (c === '(') {
      this.i++;
      if (this.peek() === '?') {
        this.i++;
        const next = this.peek();
        if (next === ':') {
          this.i++;
          const node = this.parseAlternation();
          this.expectCloseParen();
          return node;
        }
        if (next === '=') {
          this.i++;
          const node = this.parseAlternation();
          this.expectCloseParen();
          return { kind: 'look', neg: false, node };
        }
        if (next === '!') {
          this.i++;
          const node = this.parseAlternation();
          this.expectCloseParen();
          return { kind: 'look', neg: true, node };
        }
        if (next === '<') {
          throw new PatternUnsupportedError('后行断言（lookbehind）');
        }
        if (isAsciiLetter(next)) {
          throw new PatternUnsupportedError('内联标志（如 (?i）'); // §6.2 子集外构造枚举
        }
        throw new PatternCompileError(`意外的字符 "?"（${next === undefined ? '正则表达式结束' : `"${next}"`}）`);
      }
      // 捕获形分组——编译时一律不分配捕获槽（布尔 test 语义；两形同构，§6.2）
      const node = this.parseAlternation();
      this.expectCloseParen();
      return node;
    }
    if (c === ')') {
      throw new PatternCompileError('意外的 ")"（缺少配对 "("）');
    }
    if (c === '[') return this.parseClass();
    if (c === '.') {
      this.i++;
      return { kind: 'any' };
    }
    if (c === '^') {
      this.i++;
      return { kind: 'assertStart' };
    }
    if (c === '$') {
      this.i++;
      return { kind: 'assertEnd' };
    }
    if (c === '*' || c === '+' || c === '?') {
      throw new PatternCompileError(`量词 "${c}" 缺少被修饰的原子`);
    }
    if (c === '\\') return this.parseEscape();
    // 普通字符（含 `{` `}` `]`——均按字面量，Annex B PatternCharacter）
    this.i++;
    return { kind: 'char', cp: c.codePointAt(0)! };
  }

  private expectCloseParen(): void {
    if (this.peek() !== ')') {
      throw new PatternCompileError('分组未闭合（缺少 ")"）');
    }
    this.i++;
  }

  /** 类外转义（设计 §6.2 冻结表：控制转义 / 预定义类 / 断言 / IdentityEscape 宽松立场）。 */
  private parseEscape(): AstNode {
    const c = this.s[this.i + 1];
    if (c === undefined) {
      throw new PatternCompileError('正则表达式以 "\\" 结束');
    }
    switch (c) {
      case 'n': this.i += 2; return { kind: 'char', cp: 0x0a };
      case 'r': this.i += 2; return { kind: 'char', cp: 0x0d };
      case 't': this.i += 2; return { kind: 'char', cp: 0x09 };
      case 'f': this.i += 2; return { kind: 'char', cp: 0x0c };
      case 'v': this.i += 2; return { kind: 'char', cp: 0x0b };
      case '0': this.i += 2; return { kind: 'char', cp: 0x00 };
      case 'd': case 'D': case 's': case 'S': case 'w': case 'W':
        this.i += 2;
        return { kind: 'class', set: PREDEFINED[c]! };
      case 'b': this.i += 2; return { kind: 'wordB', neg: false };
      case 'B': this.i += 2; return { kind: 'wordB', neg: true };
      case 'c': {
        const x = this.s[this.i + 2];
        if (isAsciiLetter(x)) {
          this.i += 3;
          return { kind: 'char', cp: controlValue(x) };
        }
        throw new PatternCompileError('"\\c" 后非字母（控制转义必须为 \\cA-\\cZ / \\ca-\\cz）');
      }
      case 'x': {
        if (isHexDigit(this.s[this.i + 2]) && isHexDigit(this.s[this.i + 3])) {
          const cp = Number.parseInt(this.s.slice(this.i + 2, this.i + 4), 16);
          this.i += 4;
          return { kind: 'char', cp };
        }
        // 非完整形 → 降级为字面量 'x'（Annex B IdentityEscape 统一处置，R3）
        this.i += 2;
        return { kind: 'char', cp: 0x78 };
      }
      case 'u': {
        const h = this.s.slice(this.i + 2, this.i + 6);
        if (isHexDigit(h[0]) && isHexDigit(h[1]) && isHexDigit(h[2]) && isHexDigit(h[3])) {
          const cp = Number.parseInt(h, 16);
          this.i += 6;
          return { kind: 'char', cp };
        }
        // 非完整形 → 降级为字面量 'u'；其后 token 流按正常量词规则（`\u{2}` ≡ 'uu'，R3 实测对齐）
        this.i += 2;
        return { kind: 'char', cp: 0x75 };
      }
      case 'p':
        if (this.s[this.i + 2] === '{') throw new PatternUnsupportedError('Unicode 属性转义 \\p{...}');
        this.i += 2;
        return { kind: 'char', cp: 0x70 }; // 裸 \p → IdentityEscape 字面量
      case 'P':
        if (this.s[this.i + 2] === '{') throw new PatternUnsupportedError('Unicode 属性转义 \\P{...}');
        this.i += 2;
        return { kind: 'char', cp: 0x50 };
      case 'k':
        if (this.s[this.i + 2] === '<') throw new PatternUnsupportedError('命名引用 \\k<...>');
        this.i += 2;
        return { kind: 'char', cp: 0x6b }; // 裸 \k → IdentityEscape 字面量
      case '1': case '2': case '3': case '4': case '5':
      case '6': case '7': case '8': case '9':
        throw new PatternUnsupportedError('反向引用'); // §6.2.1 收窄：\1~\9 子集外
      default:
        // IdentityEscape（Annex B 宽松立场）：\ + 任意非保留前缀字符 → 该字符字面量
        // （含语法字符转义 \\ \. \* \+ \? \( \) \[ \] \{ \} \| \^ \$ \/）
        this.i += 2;
        return { kind: 'char', cp: c.codePointAt(0)! };
    }
  }

  /** 字符类 `[...]` / `[^...]`（编译期求补；区间端点可为类内转义）。 */
  private parseClass(): AstNode {
    this.i++; // '['
    let negated = false;
    if (this.peek() === '^') {
      negated = true;
      this.i++;
    }
    const ranges: Array<[number, number]> = [];
    // ']' 紧跟在 '[' 后 → 字面量成员（[]]）；紧跟 '[^' 后 → 类关闭（[^] = 匹配任意码元）
    if (!negated && this.peek() === ']') {
      this.i++;
      ranges.push([0x5d, 0x5d]);
    }
    for (;;) {
      const c = this.peek();
      if (c === undefined) throw new PatternCompileError('字符类未闭合（缺少 "]"）');
      if (c === ']') {
        this.i++;
        break;
      }
      if (c === '\\') {
        const atom = this.parseClassEscape();
        if (atom.kind === 'char') {
          ranges.push([atom.cp, atom.cp]);
          this.tryClassRange(ranges);
        } else {
          mergeInto(ranges, atom.set);
          // 补类后若跟 '-' → '-' 为字面量（Annex B：多字符类不可作区间端点）
          if (this.peek() === '-') {
            this.i++;
            ranges.push([0x2d, 0x2d]);
          }
        }
        continue;
      }
      if (c === '[') {
        this.i++;
        ranges.push([0x5b, 0x5b]); // '[' 类内字面量（Annex B）
        continue;
      }
      this.i++;
      const cp = c.codePointAt(0)!;
      ranges.push([cp, cp]);
      this.tryClassRange(ranges);
    }
    return { kind: 'class', set: { negated, ranges: mergeRanges(ranges) } };
  }

  /** 单字符原子后若随合法区间 → 合并为区间（已消费左侧原子；降序区间 → 双字面量，Annex B）。 */
  private tryClassRange(ranges: Array<[number, number]>): void {
    if (this.s[this.i] !== '-' || this.s[this.i + 1] === ']' || this.s[this.i + 1] === undefined) return;
    this.i++; // 消费 '-'
    const right = this.parseClassAtomForRange();
    if (right.kind === 'char') {
      const left = ranges.pop()![0];
      if (right.cp >= left) {
        ranges.push([left, right.cp]);
      } else {
        ranges.push([left, left], [right.cp, right.cp]);
      }
    } else {
      ranges.push([0x2d, 0x2d]);
      mergeInto(ranges, right.set);
    }
  }

  private parseClassAtomForRange(): ClassAtom {
    const c = this.peek();
    if (c === undefined) throw new PatternCompileError('字符类未闭合（缺少 "]"）');
    if (c === '\\') return this.parseClassEscape();
    this.i++;
    return { kind: 'char', cp: c.codePointAt(0)! };
  }

  /** 类内转义全集（R2 枚举）：\\ \] \^ \-、类内 \b=U+0008、预定义类、控制/十六进制转义、IdentityEscape。 */
  private parseClassEscape(): ClassAtom {
    const c = this.s[this.i + 1];
    if (c === undefined) {
      throw new PatternCompileError('正则表达式以 "\\" 结束');
    }
    switch (c) {
      case 'b': this.i += 2; return { kind: 'char', cp: 0x08 }; // 类内 \b = 退格（与类外词边界义不同）
      case 'd': case 'D': case 's': case 'S': case 'w': case 'W':
        this.i += 2;
        return { kind: 'class', set: PREDEFINED[c]! };
      case 'n': this.i += 2; return { kind: 'char', cp: 0x0a };
      case 'r': this.i += 2; return { kind: 'char', cp: 0x0d };
      case 't': this.i += 2; return { kind: 'char', cp: 0x09 };
      case 'f': this.i += 2; return { kind: 'char', cp: 0x0c };
      case 'v': this.i += 2; return { kind: 'char', cp: 0x0b };
      case '0': this.i += 2; return { kind: 'char', cp: 0x00 };
      case '1': case '2': case '3': case '4': case '5':
      case '6': case '7': case '8': case '9':
        throw new PatternUnsupportedError('类内 legacy 八进制转义'); // 显式收窄，不进子集
      case 'c': {
        const x = this.s[this.i + 2];
        if (isAsciiLetter(x)) {
          this.i += 3;
          return { kind: 'char', cp: controlValue(x) };
        }
        throw new PatternCompileError('"\\c" 后非字母（控制转义必须为 \\cA-\\cZ / \\ca-\\cz）');
      }
      case 'x': {
        if (isHexDigit(this.s[this.i + 2]) && isHexDigit(this.s[this.i + 3])) {
          const cp = Number.parseInt(this.s.slice(this.i + 2, this.i + 4), 16);
          this.i += 4;
          return { kind: 'char', cp };
        }
        this.i += 2;
        return { kind: 'char', cp: 0x78 }; // 非完整形 → 字面量 'x'
      }
      case 'u': {
        const h = this.s.slice(this.i + 2, this.i + 6);
        if (isHexDigit(h[0]) && isHexDigit(h[1]) && isHexDigit(h[2]) && isHexDigit(h[3])) {
          const cp = Number.parseInt(h, 16);
          this.i += 6;
          return { kind: 'char', cp };
        }
        this.i += 2;
        return { kind: 'char', cp: 0x75 }; // 非完整形 → 字面量 'u'
      }
      case 'p':
        if (this.s[this.i + 2] === '{') throw new PatternUnsupportedError('Unicode 属性转义 \\p{...}');
        this.i += 2;
        return { kind: 'char', cp: 0x70 };
      case 'P':
        if (this.s[this.i + 2] === '{') throw new PatternUnsupportedError('Unicode 属性转义 \\P{...}');
        this.i += 2;
        return { kind: 'char', cp: 0x50 };
      case 'k':
        if (this.s[this.i + 2] === '<') throw new PatternUnsupportedError('命名引用 \\k<...>');
        this.i += 2;
        return { kind: 'char', cp: 0x6b };
      default:
        // 类内 IdentityEscape：\ + 非保留前缀 → 字面量（含 \\ \] \^ \-）
        this.i += 2;
        return { kind: 'char', cp: c.codePointAt(0)! };
    }
  }
}

function mergeInto(target: Array<[number, number]>, set: CharSet): void {
  const raw = set.negated ? complementRanges(set.ranges) : set.ranges;
  for (const r of raw) target.push(r);
}

/** 补类展开（编译期求补——类表只存正向区间；`[^]` 空集补 = 全码元）。 */
function complementRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let next = 0;
  for (const [a, b] of ranges) {
    if (a > next) out.push([next, a - 1]);
    if (b + 1 > next) next = b + 1;
  }
  if (next <= 0xffff) out.push([next, 0xffff]);
  return out;
}

// —— 编译（无捕获字节码；程序规模上限 10_000；量词展开计数）——

class Codegen {
  prog: Instr[] = [];
  sets: CharSet[] = [];
  copies = 0;

  emit(ast: AstNode): void {
    this.gen(ast);
    this.push({ op: 'match' });
  }

  private push(instr: Instr): void {
    this.prog.push(instr);
    if (this.prog.length > MAX_PROGRAM_SIZE) {
      throw new PatternTooLargeError(this.copies);
    }
  }

  private pushAll(ins: Instr[]): void {
    for (const i of ins) this.push(i);
  }

  private gen(n: AstNode): void {
    switch (n.kind) {
      case 'empty':
        return;
      case 'char':
        this.push({ op: 'char', cp: n.cp });
        return;
      case 'class': {
        const setId = this.sets.length;
        this.sets.push(n.set);
        this.push({ op: 'class', setId });
        return;
      }
      case 'any':
        this.push({ op: 'any' });
        return;
      case 'assertStart':
        this.push({ op: 'assertStart' });
        return;
      case 'assertEnd':
        this.push({ op: 'assertEnd' });
        return;
      case 'wordB':
        this.push({ op: 'wordB', neg: n.neg });
        return;
      case 'concat':
        for (const item of n.items) this.gen(item);
        return;
      case 'alt': {
        // 各臂先编入独立子程序，再按基址重定位拼接：
        //   Split(A1, S2); [A1]; Jmp(S2); Split(A2, S3); [A2]; Jmp(S3); …; Split(Ak, cont); [Ak]
        // （空臂 = 零指令；末臂落入 cont，无 Jmp）
        const armCodes: Array<SubProgram> = [];
        for (const arm of n.arms) armCodes.push(this.compileSub(arm));
        for (let i = 0; i < armCodes.length; i++) {
          const sub = armCodes[i]!;
          const split = this.prog.length;
          const armEntry = split + 1;
          const armEnd = armEntry + sub.code.length;
          const cont = i === armCodes.length - 1 ? armEnd : armEnd + 1; // 非末臂后随 Jmp 占 1 槽
          this.push({ op: 'split', x: armEntry, y: cont });
          this.appendRelocated(sub);
          if (i < armCodes.length - 1) {
            this.push({ op: 'jmp', x: this.prog.length + 1 });
          }
        }
        return;
      }
      case 'repeat':
        this.genRepeat(n);
        return;
      case 'look': {
        // 布局：Look 指令 → Jmp(越过子程序) → [子程序] → Match(子) → 主流程续点。
        // 子程序先独立编译（长度已知，可精确布局）；主流程经 Jmp 跳过子程序区段——
        // 子程序只经 anchoredMatch 进入，主流程绝不穿过（否则 Match 终态阻断 Look 可达性）。
        const sub = this.compileSub(n.node);
        this.copies += sub.copies;
        const lookPos = this.prog.length;
        const subEntry = lookPos + 2; // [Look, Jmp, 子程序…]
        const subMatch = subEntry + sub.code.length;
        const cont = subMatch + 1;
        this.push({ op: 'look', neg: n.neg, sub: subEntry, subMatch });
        this.push({ op: 'jmp', x: cont });
        this.appendRelocated(sub);
        this.push({ op: 'match' });
        return;
      }
    }
  }

  /**
   * 原子编译到独立子程序（内部 Jmp/Split/Look 目标为子程序内相对偏移，appendRelocated
   * 按基址重定位）——嵌套量词/交替（如 `(a+)+`）的内部跳转不因副本重排而失效。
   */
  private compileSub(n: AstNode): SubProgram {
    const sub = new Codegen();
    sub.gen(n);
    return { code: sub.prog, sets: sub.sets, copies: sub.copies };
  }

  /** 子程序按当前基址重定位后拼入主程序（Jmp/Split/Look 目标 + 指令基址；class setId + 类表基址）。 */
  private appendRelocated(sub: SubProgram): void {
    const setBase = this.sets.length;
    this.sets.push(...sub.sets);
    const base = this.prog.length;
    for (const instr of sub.code) {
      switch (instr.op) {
        case 'jmp':
          this.push({ op: 'jmp', x: instr.x + base });
          break;
        case 'split':
          this.push({ op: 'split', x: instr.x + base, y: instr.y + base });
          break;
        case 'look':
          this.push({ op: 'look', neg: instr.neg, sub: instr.sub + base, subMatch: instr.subMatch + base });
          break;
        case 'class':
          this.push({ op: 'class', setId: instr.setId + setBase });
          break;
        default:
          this.push(instr);
      }
    }
  }

  private genRepeat(n: { node: AstNode; min: number; max: number | null }): void {
    const sub = this.compileSub(n.node);
    if (sub.code.length === 0) return; // 空原子重复任意次 = ε（{0,} 空迭代由闭包 pc 去重守卫，零发射）

    // 量词展开计数（诊断消息用）：外层发射次数 ×（子程序内部展开 + 原子本体）
    const emissions = n.max === null ? n.min + 1 : n.max;
    this.copies += emissions * (sub.copies + 1);

    if (n.max === null) {
      // {min,}：min 个副本 + 星形循环
      //   L0: Split(L_node, L_cont); [atom]; Jmp(L0)
      for (let i = 0; i < n.min; i++) this.appendRelocated(sub);
      const loop = this.prog.length;
      this.push({ op: 'split', x: loop + 1, y: loop + 2 + sub.code.length }); // y = Jmp 之后的续点
      this.appendRelocated(sub);
      this.push({ op: 'jmp', x: loop });
      return;
    }

    // {n,m}：n 个副本 + (m−n) 个可选副本（Split(atom, 下一 Split/续点) 链）；{n} 即 n 个副本
    for (let i = 0; i < n.min; i++) this.appendRelocated(sub);
    const extra = n.max - n.min;
    for (let i = 0; i < extra; i++) {
      this.push({ op: 'split', x: this.prog.length + 1, y: this.prog.length + 1 + sub.code.length });
      this.appendRelocated(sub);
    }
  }
}

/** 独立编译的子程序（appendRelocated 前为自洽相对偏移；copies 用于规模错误消息）。 */
interface SubProgram {
  code: Instr[];
  sets: CharSet[];
  copies: number;
}

// —— 子集模拟（宽度优先，逐消费轮推进；无回溯栈、无递归、活内存 O(|prog|)）——

function matchBudget(len: number): number {
  // 冻结（R3 形状对齐定理分列：线性项覆盖 T1 类、二次项覆盖 T2 类；4M 为绝对护栏）
  return Math.min(4_000_000, Math.max(8_192, 1_024 * len + 512 * len * len + 16_384));
}

/** 计费步（闭包访问 / 转移 / lookMemo 命中各 1 步；经 charge 钩子同步计入全局工作预算）。 */
function tick(mc: MatchCtx): void {
  mc.steps++;
  mc.charge(1);
  if (mc.steps > mc.budget) {
    throw new PatternBudgetExceeded(mc.len, mc.budget);
  }
}

/** ε 闭包：追随 Jmp/Split；断言按 pos 谓词过滤；Look 查 lookMemo（未命中则锚定子模拟）。pc 去重。 */
function closure(mc: MatchCtx, seed: Set<number>, pos: number): Set<number> {
  const seen = new Set<number>();
  const stack: number[] = [];
  for (const pc of seed) {
    if (!seen.has(pc)) {
      seen.add(pc);
      stack.push(pc);
    }
  }
  while (stack.length > 0) {
    const pc = stack.pop()!;
    tick(mc);
    const instr = mc.prog[pc]!;
    switch (instr.op) {
      case 'jmp':
        pushIfNew(instr.x);
        break;
      case 'split':
        pushIfNew(instr.x);
        pushIfNew(instr.y);
        break;
      case 'assertStart':
        if (pos === 0) pushIfNew(pc + 1);
        break;
      case 'assertEnd':
        if (pos === mc.len) pushIfNew(pc + 1);
        break;
      case 'wordB': {
        const prev = pos > 0 ? isWordChar(mc.input.charCodeAt(pos - 1)) : false;
        const next = pos < mc.len ? isWordChar(mc.input.charCodeAt(pos)) : false;
        // \b：边界为真时通过；\B：边界为假时通过
        if ((prev !== next) !== instr.neg) pushIfNew(pc + 1);
        break;
      }
      case 'look': {
        // lookMemo 稀疏物化：(Look 指令, pos) → 布尔；命中也计 1 步（查询即工作）
        const inner = mc.lookMemo.get(instr);
        let result: boolean;
        if (inner !== undefined && inner.has(pos)) {
          tick(mc);
          result = inner.get(pos)!;
        } else {
          result = anchoredMatch(mc, instr.sub, instr.subMatch, pos);
          let m = mc.lookMemo.get(instr);
          if (m === undefined) {
            m = new Map();
            mc.lookMemo.set(instr, m);
          }
          m.set(pos, result);
        }
        const passes = instr.neg ? !result : result;
        if (passes) pushIfNew(pc + 1);
        break;
      }
      case 'match':
        break; // 终态：无后继（由调用方检测）
      default:
        break; // char/class/any 由 step 消费
    }
  }
  return seen;

  function pushIfNew(target: number): void {
    if (!seen.has(target)) {
      seen.add(target);
      stack.push(target);
    }
  }
}

/** 消费一轮输入码元：对 S 中每个可消费状态做单字符转移（断言/跳转态已由闭包处理）。 */
function step(mc: MatchCtx, S: Set<number>, cp: number): Set<number> {
  const next = new Set<number>();
  for (const pc of S) {
    tick(mc);
    const instr = mc.prog[pc]!;
    switch (instr.op) {
      case 'char':
        if (instr.cp === cp) next.add(pc + 1);
        break;
      case 'class':
        if (setHas(mc.sets[instr.setId]!, cp)) next.add(pc + 1);
        break;
      case 'any':
        if (!isLineTerminator(cp)) next.add(pc + 1);
        break;
      default:
        break;
    }
  }
  return next;
}

/** 前瞻锚定子模拟（无重播种；共享步数预算与 lookMemo；结果是 (子程序, pos, 输入) 的确定函数）。 */
function anchoredMatch(mc: MatchCtx, sub: number, subMatch: number, start: number): boolean {
  let S = closure(mc, new Set([sub]), start);
  if (S.has(subMatch)) return true;
  for (let pos = start; pos < mc.len; pos++) {
    S = closure(mc, step(mc, S, mc.input.charCodeAt(pos)), pos + 1);
    if (S.has(subMatch)) return true;
  }
  return false;
}

// —— 公共（包内）入口 ——

/** 编译（语法非法 / 子集外构造 / 程序规模超限 → 对应 loud 错误；非静默）。 */
export function compile(regex: string): CompiledPattern {
  const parser = new Parser(regex);
  const ast = parser.parse();
  const gen = new Codegen();
  gen.emit(ast);
  return { prog: gen.prog, sets: gen.sets, size: gen.prog.length };
}

/**
 * test 语义：非锚定搜索（存在任一起点的前缀匹配即 true）。
 * 步数预算耗尽 → PatternBudgetExceeded（fail-closed；不冒充「不匹配」）。
 */
export function match(compiled: CompiledPattern, input: string, charge: (n: number) => void): boolean {
  const len = input.length;
  const budget = matchBudget(len);
  const mc: MatchCtx = {
    prog: compiled.prog,
    sets: compiled.sets,
    input,
    len,
    budget,
    steps: 0,
    lookMemo: new Map(),
    charge,
  };
  const mainMatch = compiled.prog.length - 1;
  // 初态闭包（pos = 0；空串匹配于此判定，如 'a?' × ''）
  let S = closure(mc, new Set([0]), 0);
  if (S.has(mainMatch)) return true;
  // 逐起点重播种 = 非锚定搜索（存在任一起点的前缀匹配即 true）；本轮闭包在 pos + 1 处求值
  for (let pos = 0; pos < len; pos++) {
    const stepped = step(mc, S, input.charCodeAt(pos));
    stepped.add(0); // ∪ {start}——重播种：匹配可从任何位置开始
    S = closure(mc, stepped, pos + 1);
    if (S.has(mainMatch)) return true;
  }
  // 终轮（pos = len）：闭包已在上轮求值，兜底核对（覆盖 len = 0 无循环路径）
  return S.has(mainMatch);
}
