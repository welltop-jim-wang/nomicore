/**
 * 词法层：text → Token[]（设计 §4）。
 *
 * 关键机制：延迟错误记号（§4.1）——词法错误（E201/E202/E203/未知字符 E100）
 * 不在 tokenize 时立即抛出，而是产出 `kind: 'error'` 记号（携带错误码、消息、
 * 位置）并停止词法。parser 单向左到右消费记号流，任何位置读到 error 记号即
 * 以该码失败——使「文本序首个错误胜出」由构造达成（反例 `type A = ( "abc`：
 * `(` 的 E100 在未闭合字符串的 E201 之前）。
 *
 * 记号全集 Day 1 即 v1 全量（§4.2）：本切片文法用不到的 `(` `)` `[ ] < > & ?`
 * 也必须产出，作为 E100/E102/E104 等锚点记号。
 *
 * 行列基准（§4.3）：line/column 均 1 起；column 按 Unicode 码点计；`\n` 换行、
 * `\r` 永不占列（`\r\n` 合并为一次换行，孤立 `\r` 按空白 trivia 不换行）；tab
 * 按 1 列；text 首码点 U+FEFF 剥离且不占列（§9.2），文本中部 U+FEFF 按未知
 * 字符 → E100。EOF 记号位置 = 扫描结束位（空文本为 (1,1)，保证 ≥1）。
 */
export type TokenKind = 'ident' | 'string' | 'number' | 'punct' | 'error' | 'eof';

export interface Token {
  kind: TokenKind;
  /** ident：名称；punct：标点字符；string：转义解码后文本；number：原文；error/eof：'' */
  value: string;
  /** number 记号：双精度数值（超双精度为 Infinity，由 parser 字面量分支判定 E100，§7.3） */
  num?: number;
  line: number;
  column: number;
  /** error 记号：词法错误码（三位数字串） */
  code?: string;
  /** error 记号：人类可读消息（无前缀，前缀由 errors.ts 构造） */
  message?: string;
}

/** 单字符标点全集（§4.2）：v1 全量，为 #6~#9 铺路。 */
const PUNCT = new Set(['{', '}', '(', ')', '[', ']', '<', '>', ',', ';', ':', '?', '|', '&', '=']);

function isAsciiLetter(cp: number): boolean {
  return (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a);
}

function isIdentStart(cp: number): boolean {
  return isAsciiLetter(cp); // ASCII 冻结（规格 §4）：`$` / `_` / 非 ASCII 均不可作起始
}

function isIdentChar(cp: number): boolean {
  return isAsciiLetter(cp) || (cp >= 0x30 && cp <= 0x39) || cp === 0x5f; // [A-Za-z0-9_]
}

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0; // 码元游标（代理对按 2 码元推进，column 恒按码点计）
  let line = 1;
  let column = 1;

  // §9.2：text 首码点为 U+FEFF → 剥离且不占 line 1 任何列
  if (text.codePointAt(0) === 0xfeff) {
    i = 1;
  }

  const fail = (code: string, message: string, atLine: number, atColumn: number): void => {
    tokens.push({ kind: 'error', value: '', code, message, line: atLine, column: atColumn });
  };

  scan: while (i < text.length) {
    const cp = text.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);

    // —— trivia：空白（不产出记号）——
    if (ch === ' ' || ch === '\t') {
      i += 1;
      column += 1;
      continue;
    }
    if (ch === '\n') {
      i += 1;
      line += 1;
      column = 1;
      continue;
    }
    if (ch === '\r') {
      // \r\n 合并为一次换行；孤立 \r 按空白 trivia（不换行、不进位）——未冻结角落
      // 的确定性选择（设计 §4.3，与历史实现「孤立 \r 触发换行」不同，不采纳）。
      if (text[i + 1] === '\n') {
        i += 2;
        line += 1;
        column = 1;
      } else {
        i += 1;
      }
      continue;
    }

    // —— 注释（trivia）：行注释 / 块注释 / 文档注释——
    if (ch === '/') {
      const next = text[i + 1];
      if (next === '/') {
        // 行注释至 \n / \r；文本在 EOF 结束而无换行时视同 eol（注记 10，合法）
        i += 2;
        column += 2;
        while (i < text.length && text[i] !== '\n' && text[i] !== '\r') {
          const c = text.codePointAt(i)!;
          i += c > 0xffff ? 2 : 1;
          column += 1;
        }
        continue;
      }
      if (next === '*') {
        // 块 / 文档注释本切片均按忽略型 trivia（区分留给 JSDoc issue，§4.4）；
        // 未闭合 → E203（锚起始 `/*`）。`*/` 首现即闭合（不嵌套）。
        const startLine = line;
        const startCol = column;
        i += 2;
        column += 2;
        let closed = false;
        while (i < text.length) {
          const c = text[i];
          if (c === '*' && text[i + 1] === '/') {
            i += 2;
            column += 2;
            closed = true;
            break;
          }
          if (c === '\n') {
            i += 1;
            line += 1;
            column = 1;
          } else if (c === '\r') {
            if (text[i + 1] === '\n') {
              i += 2;
              line += 1;
              column = 1;
            } else {
              i += 1;
            }
          } else {
            const c = text.codePointAt(i)!;
            i += c > 0xffff ? 2 : 1;
            column += 1;
          }
        }
        if (!closed) {
          fail('203', '块注释未闭合', startLine, startCol);
          break scan;
        }
        continue;
      }
      fail('100', `未知记号: '/'`, line, column);
      break scan;
    }

    // —— 标识符（ASCII 冻结）——
    if (isIdentStart(cp)) {
      const startLine = line;
      const startCol = column;
      let value = '';
      while (i < text.length) {
        const c = text.codePointAt(i)!;
        if (!isIdentChar(c)) break;
        value += String.fromCodePoint(c);
        i += c > 0xffff ? 2 : 1;
        column += 1;
      }
      tokens.push({ kind: 'ident', value, line: startLine, column: startCol });
      continue;
    }

    // —— 数字字面量（[0-9]+，无符号十进制整数）——
    if (cp >= 0x30 && cp <= 0x39) {
      const startLine = line;
      const startCol = column;
      let raw = '';
      while (i < text.length) {
        const c = text.codePointAt(i)!;
        if (c < 0x30 || c > 0x39) break;
        raw += String.fromCodePoint(c);
        i += 1;
        column += 1;
      }
      // 记号值 = 双精度数值（超域为 Infinity，parser 判 E100，§7.3）
      tokens.push({ kind: 'number', value: raw, num: Number(raw), line: startLine, column: startCol });
      continue;
    }

    // —— 字符串字面量（"…"，仅 \" 与 \\ 两个转义；解码后作为记号值）——
    if (ch === '"') {
      const startLine = line;
      const startCol = column;
      i += 1;
      column += 1;
      let value = '';
      let closed = false;
      let err: { code: string; message: string; line: number; column: number } | null = null;
      while (i < text.length) {
        const c = text.codePointAt(i)!;
        const cc = String.fromCodePoint(c);
        if (cc === '"') {
          i += 1;
          column += 1;
          closed = true;
          break;
        }
        if (cc === '\\') {
          const nxtCode = text.charCodeAt(i + 1); // 码元级取码（0x22 = '"'，0x5c = '\'）
          if (nxtCode === 0x22 || nxtCode === 0x5c) {
            value += String.fromCharCode(nxtCode);
            i += 2;
            column += 2;
            continue;
          }
          // 其余（含行终止 / EOF）→ E202 锚该反斜杠；E202 先于 E201 暴露（文本序，§4.4）
          err = { code: '202', message: '非法转义序列（仅允许 \\" 与 \\\\）', line, column };
          break;
        }
        if (cc === '\n' || cc === '\r') {
          // 跨行即未闭合（注记 10）→ E201 锚起始 "
          err = { code: '201', message: '字符串字面量未闭合（不得跨行）', line: startLine, column: startCol };
          break;
        }
        value += cc;
        i += c > 0xffff ? 2 : 1;
        column += 1;
      }
      if (err !== null) {
        fail(err.code, err.message, err.line, err.column);
        break scan;
      }
      if (!closed) {
        fail('201', '字符串字面量未闭合', startLine, startCol);
        break scan;
      }
      tokens.push({ kind: 'string', value, line: startLine, column: startCol });
      continue;
    }

    // —— 单字符标点 ——
    if (PUNCT.has(ch)) {
      tokens.push({ kind: 'punct', value: ch, line, column });
      i += 1;
      column += 1;
      continue;
    }

    // —— 未知字符 → E100（`$`、`-`、`.`、非 ASCII、文本中部 U+FEFF 等）——
    fail('100', `未知记号: ${ch}`, line, column);
    break scan;
  }

  // EOF 记号位置 = 扫描结束位（空文本为 (1,1)，保证 ≥1）；错误后亦追加，parser 在
  // error 记号即败，EOF 仅为边界提供 ≥1 的锚位。
  tokens.push({ kind: 'eof', value: '', line, column });
  return tokens;
}
