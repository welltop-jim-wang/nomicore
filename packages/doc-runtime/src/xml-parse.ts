/**
 * @nomicore/doc-runtime — XML 字符串 → detached Y.XmlFragment 结构解析器（issue #74 §4.6）。
 *
 * 模块内部件（不进公共面）。两阶段结构：
 * ① 扫描器：显式标签栈、零递归，**骨架逐条镜像 vfsl `xml.ts` 的 `wellFormedXml`**（同一
 *    token 识别、同一 readXmlName/skipXmlSpace 字符集），产出纯数据中间树；输入虽已过
 *    ① 的 wellFormedXml，解析器不信任输入——任何扫描异常响亮失败（F8）。
 * ② 装配器：递归建 Y 类型（Y.XmlText(span) / Y.XmlElement(name) + setAttribute +
 *    insert(0, kids)），深度受 JS 栈上界约束（溢出 RangeError → E200，与 validate.ts
 *    对深嵌套的处置同款）。
 *
 * 四条语义规则（每条都有 yjs 实测依据，见设计 §4.6）：
 * 1. 文本 span 逐字保留、不解码实体——yjs XmlText.toString() 不做 XML 转义（A13/A22），
 *    解码再存储会产出非良构字符串；逐字 span 是唯一可再校验的往返策略（T11-4 实证）。
 * 2. 注释 / CDATA / 处理指令以逐字 XmlText 承载（Yjs 无对应节点类型；B3/B6 字节往返）。
 * 3. 属性值含 `"` → 响亮拒绝：yjs XmlElement.toString() 不转义属性值（A12 实证引号截断、
 *    产出非良构 XML）。其余字符（`<` `>` `&` `'`）安全（引号到引号字面量扫描）。
 * 4. 重复属性 last-wins、自闭合/空元素输出显式闭合标签、单引号值重排为双引号、标签内
 *    空白规格化——全部是 yjs 序列化器的既定投影，往返为**语义等价**而非逐字（ADR-0007）。
 *
 * ⚠️ 文法镜像同步义务：本扫描器骨架镜像 vfsl `xml.ts`（后者不导出——vfsl 公共面最小化
 * 纪律），两侧字符集/惰性 span 识别必须同步演化（设计 §4.6 登记）。
 */
import * as Y from 'yjs';

export type XmlParseResult =
  | { ok: true; fragment: Y.XmlFragment }
  | { ok: false; reason: string };

/** 中间树（纯数据，与 yjs 无关）。注释/CDATA/PI 一律为逐字 text 节点（规则 2）。 */
type XmlNode =
  | { type: 'text'; text: string }
  | { type: 'element'; name: string; attrs: Array<[string, string]>; children: XmlNode[] };

/**
 * 解析入口：扫描 → 中间树 → 装配 detached Y.XmlFragment。
 * 空字符串 → 空 fragment（wellFormedXml('') === null 合法；toString '' 往返合法，A16）；
 * 顶层森林（多顶层元素 + 顶层文本）→ fragment 多子节点（A14）。
 */
export function parseXmlToFragment(text: string): XmlParseResult {
  const tree = scan(text);
  if (tree.kind === 'err') return { ok: false, reason: tree.reason };
  const fragment = new Y.XmlFragment();
  if (tree.nodes.length > 0) {
    fragment.insert(0, tree.nodes.map(assembleNode));
  }
  return { ok: true, fragment };
}

/** 装配器：中间树节点 → Y.XmlElement / Y.XmlText（递归；属性源序 set，last-wins 规则 4）。 */
function assembleNode(node: XmlNode): Y.XmlElement | Y.XmlText {
  if (node.type === 'text') return new Y.XmlText(node.text); // 逐字 span（规则 1/2）
  const el = new Y.XmlElement(node.name);
  for (const [k, v] of node.attrs) el.setAttribute(k, v);
  if (node.children.length > 0) {
    el.insert(0, node.children.map(assembleNode));
  }
  return el;
}

// —— 阶段① 扫描器（骨架镜像 vfsl xml.ts wellFormedXml）——

type ScanResult =
  | { kind: 'ok'; nodes: XmlNode[] }
  | { kind: 'err'; reason: string };

function scan(s: string): ScanResult {
  const roots: XmlNode[] = [];
  const stack: Array<Extract<XmlNode, { type: 'element' }>> = [];
  let textStart = 0; // 待冲刷文本跨度起点（[textStart, i) 为逐字文本 run）
  let i = 0;
  const len = s.length;

  /** 把 [textStart, end) 的文本 run 追加为逐字文本节点（规则 1）。 */
  const flushText = (end: number): void => {
    if (end <= textStart) return;
    const span = s.slice(textStart, end);
    const top = stack[stack.length - 1];
    const node: XmlNode = { type: 'text', text: span };
    if (top !== undefined) top.children.push(node);
    else roots.push(node); // 顶层文本（A14：顶层文本合法）
  };

  /** 惰性 span（注释/CDATA/PI）以逐字文本节点承载（规则 2）。 */
  const pushSpan = (span: string): void => {
    const top = stack[stack.length - 1];
    const node: XmlNode = { type: 'text', text: span };
    if (top !== undefined) top.children.push(node);
    else roots.push(node); // 顶层注释/CDATA/PI（A14 顶层文本同语义）
  };

  while (i < len) {
    const c = s[i]!;
    if (c !== '<') {
      i++; // 文本（顶层或元素内）：任意内容，逐码元推进
      continue;
    }
    if (s.startsWith('<!--', i)) {
      const end = s.indexOf('-->', i + 4);
      if (end === -1) return { kind: 'err', reason: '未闭合的注释 <!--' };
      flushText(i);
      pushSpan(s.slice(i, end + 3));
      textStart = end + 3;
      i = end + 3;
    } else if (s.startsWith('<![CDATA[', i)) {
      const end = s.indexOf(']]>', i + 9);
      if (end === -1) return { kind: 'err', reason: '未闭合的 CDATA 段' };
      flushText(i);
      pushSpan(s.slice(i, end + 3));
      textStart = end + 3;
      i = end + 3;
    } else if (s.startsWith('<?', i)) {
      const end = s.indexOf('?>', i + 2);
      if (end === -1) return { kind: 'err', reason: '未闭合的处理指令 <?' };
      flushText(i);
      pushSpan(s.slice(i, end + 2));
      textStart = end + 2;
      i = end + 2;
    } else if (s.startsWith('<!DOCTYPE', i)) {
      return { kind: 'err', reason: 'DOCTYPE 声明不支持' };
    } else if (s.startsWith('</', i)) {
      // 结束标签：< / name S* '>'
      const nameStart = i + 2;
      const name = readXmlName(s, nameStart);
      if (name === null) return { kind: 'err', reason: `无效的结束标签：${s.slice(nameStart, nameStart + 20)}` };
      let j = skipXmlSpace(s, nameStart + name.length);
      if (j >= len || s[j] !== '>') return { kind: 'err', reason: `结束标签未闭合：</${name}>` };
      flushText(i); // 闭合前的尾部文本属于被关元素（当前栈顶）
      const top = stack.pop();
      if (top === undefined || top.name !== name) return { kind: 'err', reason: `结束标签与开始标签不匹配：</${name}>` };
      // 已闭合元素挂到其父（或顶层 roots）——扫描器收拢树结构的关键一步
      const parent = stack[stack.length - 1];
      if (parent !== undefined) parent.children.push(top);
      else roots.push(top);
      textStart = j + 1;
      i = j + 1;
    } else if (isXmlNameStart(s[i + 1])) {
      // 开始标签：< name attr* ('/>' | '>' 子内容 '</name>')
      const name = readXmlName(s, i + 1)!;
      flushText(i); // 入栈/挂载前冲刷前置文本 run（'Hello <b>…' 中 'Hello ' 属于当前栈顶）
      const attrs: Array<[string, string]> = [];
      let j = i + 1 + name.length;
      for (;;) {
        j = skipXmlSpace(s, j);
        if (j >= len) return { kind: 'err', reason: `标签未闭合：<${name}>` };
        if (s[j] === '/') {
          j = skipXmlSpace(s, j + 1);
          if (j >= len || s[j] !== '>') return { kind: 'err', reason: `自闭合标签未闭合：<${name}/>` };
          // 自闭合元素：无子内容，直接挂到当前栈顶/顶层
          const el: XmlNode = { type: 'element', name, attrs, children: [] };
          const top = stack[stack.length - 1];
          if (top !== undefined) top.children.push(el);
          else roots.push(el);
          textStart = j + 1;
          i = j + 1;
          break;
        }
        if (s[j] === '>') {
          const el: Extract<XmlNode, { type: 'element' }> = { type: 'element', name, attrs, children: [] };
          stack.push(el);
          textStart = j + 1;
          i = j + 1;
          break;
        }
        // 属性：name S* '=' S* ("…" | '…')——引号强制，值内一切字符为字面量
        const attrStart = j;
        const attrName = readXmlName(s, j);
        if (attrName === null) return { kind: 'err', reason: `无效的属性：${s.slice(attrStart, attrStart + 20)}` };
        j += attrName.length;
        j = skipXmlSpace(s, j);
        if (j >= len || s[j] !== '=') return { kind: 'err', reason: `属性缺少 "="：${attrName}` };
        j = skipXmlSpace(s, j + 1);
        if (j >= len || (s[j] !== '"' && s[j] !== "'")) return { kind: 'err', reason: `属性值必须加引号：${attrName}` };
        const quote = s[j]!;
        const valueEnd = s.indexOf(quote, j + 1); // 配对闭引号（另一引号字符不闭合）
        if (valueEnd === -1) return { kind: 'err', reason: `属性值引号未闭合：${attrName}` };
        const value = s.slice(j + 1, valueEnd);
        if (value.includes('"')) {
          // D7 规则 3：yjs 序列化器不转义属性值（A12）——双引号值必产出不可再校验文档
          return { kind: 'err', reason: `属性 ${attrName} 值含双引号` };
        }
        attrs.push([attrName, value]); // 重复属性 last-wins：yjs setAttribute 覆盖（规则 4）
        j = valueEnd + 1;
      }
    } else {
      return { kind: 'err', reason: '文本中裸 < 后非合法标签起点' };
    }
  }

  if (stack.length > 0) return { kind: 'err', reason: `标签未闭合：<${stack[stack.length - 1]!.name}>` };

  // 收尾：冲刷尾部文本 run（顶层尾部文本 → 顶层 text 节点，A14）
  flushText(len);
  return { kind: 'ok', nodes: roots };
}

// —— 字符工具（逐字镜像 vfsl xml.ts：同一字符集，同步演化义务）——

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
