/**
 * YXmlFragment 良构性检查（issue #21 设计 §7；ADR 0003 §5 映射执行）。
 *
 * 零依赖单遍扫描 + 显式标签栈（无递归）。片段语义（R2 放宽，SA2 #7）：
 * 多顶层元素森林 + 顶层字符数据均合法——`Y.XmlFragment.toJSON()` 投影可含顶层
 * Y.XmlText（纯文本或文本与元素混合），顶层文本放行是「与投影一致」口径的必然；
 * 规则统一为「仅要求标签栈平衡与良构结构」。
 *
 * 属性值为原子单元：从开引号扫描到配对闭引号（另一引号字符不闭合），引号内一切
 * 字符（含 '<' 与 '>'）为字面量——`<p title="a>b">` 良构（R2 成文）。
 * 实体宽松（接受裸 & 与未声明实体——Y 投影侧已转义，宽松度冻结）；
 * `<!DOCTYPE` → 不支持（片段投影不携带）；未闭合注释/CDATA/PI → 非良构。
 */

/** 良构 → null；非良构 → 拒绝原因（诊断 detail）。 */
export function wellFormedXml(s: string): string | null {
  const stack: string[] = [];
  let i = 0;
  const len = s.length;

  while (i < len) {
    const c = s[i]!;
    if (c !== '<') {
      i++; // 文本（顶层或元素内）：任意内容，逐码元推进
      continue;
    }
    if (s.startsWith('<!--', i)) {
      const end = s.indexOf('-->', i + 4);
      if (end === -1) return '未闭合的注释 <!--';
      i = end + 3;
    } else if (s.startsWith('<![CDATA[', i)) {
      const end = s.indexOf(']]>', i + 9);
      if (end === -1) return '未闭合的 CDATA 段';
      i = end + 3;
    } else if (s.startsWith('<?', i)) {
      const end = s.indexOf('?>', i + 2);
      if (end === -1) return '未闭合的处理指令 <?';
      i = end + 2;
    } else if (s.startsWith('<!DOCTYPE', i)) {
      return 'DOCTYPE 声明不支持';
    } else if (s.startsWith('</', i)) {
      // 结束标签：< / name S* '>'
      const nameStart = i + 2;
      const name = readXmlName(s, nameStart);
      if (name === null) return `无效的结束标签：${s.slice(nameStart, nameStart + 20)}`;
      let j = skipXmlSpace(s, nameStart + name.length);
      if (j >= len || s[j] !== '>') return `结束标签未闭合：</${name}>`;
      const top = stack.pop();
      if (top === undefined || top !== name) return `结束标签与开始标签不匹配：</${name}>`;
      i = j + 1;
    } else if (isXmlNameStart(s[i + 1])) {
      // 开始标签：< name attr* ('/>' | '>' 子内容 '</name>')
      const name = readXmlName(s, i + 1)!;
      let j = i + 1 + name.length;
      for (;;) {
        j = skipXmlSpace(s, j);
        if (j >= len) return `标签未闭合：<${name}>`;
        if (s[j] === '/') {
          j = skipXmlSpace(s, j + 1);
          if (j >= len || s[j] !== '>') return `自闭合标签未闭合：<${name}/>`;
          i = j + 1;
          break;
        }
        if (s[j] === '>') {
          stack.push(name);
          i = j + 1;
          break;
        }
        // 属性：name S* '=' S* ("…" | '…')——引号强制，值内一切字符为字面量
        const attrStart = j;
        const attrName = readXmlName(s, j);
        if (attrName === null) return `无效的属性：${s.slice(attrStart, attrStart + 20)}`;
        j += attrName.length;
        j = skipXmlSpace(s, j);
        if (j >= len || s[j] !== '=') return `属性缺少 "="：${attrName}`;
        j = skipXmlSpace(s, j + 1);
        if (j >= len || (s[j] !== '"' && s[j] !== "'")) return `属性值必须加引号：${attrName}`;
        const quote = s[j]!;
        const valueEnd = s.indexOf(quote, j + 1); // 配对闭引号（另一引号字符不闭合）
        if (valueEnd === -1) return `属性值引号未闭合：${attrName}`;
        j = valueEnd + 1;
      }
    } else {
      return '文本中裸 < 后非合法标签起点';
    }
  }

  if (stack.length > 0) return `标签未闭合：<${stack[stack.length - 1]}>`;
  return null;
}

/** XML 名：[A-Za-z_:][A-Za-z0-9_.:-]*（良构性检查用的实用子集）。 */
function readXmlName(s: string, from: number): string | null {
  const first = s[from];
  if (first === undefined || !isXmlNameStart(first)) return null;
  let i = from + 1;
  while (i < s.length && isXmlNameChar(s[i]!)) i++;
  return s.slice(from, i);
}

function isXmlNameStart(c: string | undefined): boolean {
  return c !== undefined && ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || c === ':');
}

function isXmlNameChar(c: string): boolean {
  return isXmlNameStart(c) || (c >= '0' && c <= '9') || c === '.' || c === '-';
}

/** XML S：空格 / 制表 / 换行 / 回车。 */
function skipXmlSpace(s: string, from: number): number {
  let i = from;
  while (i < s.length && (s[i] === ' ' || s[i] === '\t' || s[i] === '\n' || s[i] === '\r')) i++;
  return i;
}
