/**
 * SA6 红灯测试 — XML 属性引号接受域一致性（issue #94，Bug 修复）。
 *
 * 契约来源：
 * - 任务简报 wiki/raw/task_xml-attr-quote-domain.md（Issue #94 AC）：
 *   ① `<p title='a"b'>x</p>` 通过 logical validation 后，可由 `materializeRoot` 成功物化；
 *   ② `extractYjsSnapshot` 提取结果再次通过 `validateLogicalSnapshot`；
 *   ③ round-trip 只要求 XML 语义等价，不要求引号风格或字符串逐字相同；
 *   ④ 单引号、双引号、空属性、两种引号交错及需要转义的属性值有表驱动覆盖；
 *   ⑤ malformed XML 继续响亮失败，validation/construction 失败继续保持目标 doc 零写入；
 *   ⑥ 删除或改写现有「逻辑校验成功但属性双引号构造期拒绝」的错误契约测试（C-8）；
 *   ⑦ VFSL validator、materializer、canonical/extract 比较器对同一 XML 子集使用一致规则。
 * - SA5 根因报告 wiki/raw/20260823-bug-xml-attr-quote-domain.md：缺陷行
 *   `packages/doc-runtime/src/xml-parse.ts` scan() 属性循环——对已按配对引号正确解析出的
 *   属性值无条件拒绝 `value.includes('"')`（不区分外层引号是 ' 还是 "），把 extract 侧
 *   yjs XmlElement.toString() 零转义（`key + '="' + attrs[key] + '"'`）的序列化层表示
 *   缺陷前移成输入域收窄；VFSL `wellFormedXml`（vfsl/src/xml.ts）按 XML 规范接受单引号
 *   属性内 `"` 字面量（R2：`<p title="a>b">` 良构口径、配对引号扫描、值内一切字符为字面量）。
 *
 * 缺陷可观察契约（修复前必须红灯）：
 *   对 `{ body: '<p title=\'a"b\'>x</p>' }`：validateLogicalSnapshot → ok:true（宽域放行），
 *   而 materializeRoot → ok:false，issues[0].message = 「XML 解析失败（ROOT.body）：属性
 *   title 值含双引号」——本文件断言 materializeRoot 必须 ok:true（现实现返回 ok:false →
 *   红灯）；在提取侧要求提取结果可再校验且与输入 XML 语义等价。
 *
 * 语义等价比较器说明（AC-③/W2——禁逐字断言、禁引号风格断言）：
 * - 测试局部 mini 扫描器（token 识别镜像 wellFormedXml：元素 / 属性（单双引号等价、
 *   配对闭引号、重复属性 last-wins 入 Map）/ 文本 run / 注释·CDATA·PI 作为不透明逐字
 *   token）→ canonical 序列化（属性按名排序、一律双引号、自闭合/空元素统一显式闭合、
 *   文本与不透明 token 逐字）；两侧 canonical 串全等。
 * - 属性值在入 Map 前做**单遍实体解码**（quot/apos/amp/lt/gt + 十进制/十六进制数字引用；
 *   未知实体字面保留——与 wellFormedXml 实体宽松口径一致）：修复方向（SA5）是在 XML
 *   字符串投影面把属性值中的 `"` 转义为 `&quot;` 或按需改选单引号外壳，本比较器对两种
 *   修复形态均成立，且不因实体字面量（如 `<p title="a&quot;b">`）与裸 `"` 值的 XML 语义
 *   等价性误判。文本 span 不解码实体（规则 1：逐字往返）。
 * - 测试不锁 yjs 序列化器输出（只锁可观测语义），不允许出现源码 grep 断言。
 *
 * 表驱动覆盖（AC-④）行位说明：
 * - RED 行（若实现含 `value.includes('"')` 拒绝则红灯）：单引号外壳内 `"` 位于值中段/
 *   起首/末尾/相邻多 `"`/混合 `<>&` 字符/多属性交错/自闭合/嵌套元素。
 * - GREEN 行（当前已工作通道的回归锁，修复后仍须绿）：双引号外壳内 `'`、空属性（单/双
 *   引号）、实体字面量 `&quot;` 值——锁「修复不得破坏已工作通道、不得缩窄既有接受域」。
 *
 * malformed 行（AC-⑤）：`'` 外壳内裸 `'`、`"` 外壳内裸 `"`（两域同拒的边界）、未闭合
 * 属性值/标签、不匹配结束标签、无引号属性值、裸 `<`、非法属性名——每行断言
 * validateLogicalSnapshot ok:false 恰 1 issue → materializeRoot ok:false（issues 引用
 * 零损透传）+ 0 update 事件 + encodeStateAsUpdate 逐字节不变（零写入双证）。
 *
 * 零写入 fixture 纪律（实证自 yjs@13.6.32，与 materialize-root.test.ts 同款）：
 * `doc.getMap('ROOT')` 惰性创建空 map 零 update/state 不变；detached 子树集成前不可读；
 * observer one-shot（G8：无 guard 重入写 → 引擎无限递归 RangeError）。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { evaluate, parseVfsl, validateLogicalSnapshot } from '@nomicore/vfsl';
import type { DerivedSchema } from '@nomicore/vfsl';
import { extractYjsSnapshot, materializeRoot } from '../src/index.js';

// —— 测试契约类型（与 materialize-root.test.ts 同款）——

interface MaterializeIssue {
  message: string;
  path: Array<string | number>;
}

type MaterializeResult = { ok: true } | { ok: false; issues: MaterializeIssue[] };

// —— 测试辅助（零源码依赖；黑盒可观测输出锚定）——

function derivedOf(text: string): DerivedSchema {
  const parsed = parseVfsl(text);
  if (!parsed.ok) throw new Error(`前置 parseVfsl 失败（fixture 缺陷）：${JSON.stringify(parsed.issues)}`);
  const evaluated = evaluate(parsed.module);
  if (!evaluated.ok) throw new Error(`前置 evaluate 失败（fixture 缺陷）：${JSON.stringify(evaluated.issues)}`);
  return evaluated.derived;
}

/** doc 当前状态快照（encodeStateAsUpdate 字节序列；零写入断言用逐字节比较）。 */
function stateBytes(doc: Y.Doc): number[] {
  return [...Y.encodeStateAsUpdate(doc)];
}

/** 'update' 事件计数器（单事务/零写入锚）。 */
function countUpdates(doc: Y.Doc): { count: number } {
  const counter = { count: 0 };
  doc.on('update', () => {
    counter.count += 1;
  });
  return counter;
}

/** 提取 ROOT.body（XML 字符串）；失败 throw 携带 issues（便捷断言）。 */
function extractBody(dXml: DerivedSchema, doc: Y.Doc): string {
  const ex = extractYjsSnapshot(dXml, doc);
  if (!ex.ok) {
    throw new Error(`期望提取成功，实际失败：${JSON.stringify(ex.issues)}`);
  }
  const body = (ex.snapshot as { body: string }).body;
  expect(typeof body).toBe('string');
  return body;
}

// —— XML 语义等价比较器（W2 合规落地件；属性值单遍实体解码，文本/span 逐字）——

/** 属性值单遍实体解码（quot/apos/amp/lt/gt + 数字引用；未知实体字面保留）。 */
function decodeAttrEntities(v: string): string {
  return v.replace(/&(#[0-9]+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body: string) => {
    if (body.startsWith('#x')) {
      const code = parseInt(body.slice(2), 16);
      return Number.isNaN(code) ? m : String.fromCodePoint(code);
    }
    if (body.startsWith('#')) {
      const code = parseInt(body.slice(1), 10);
      return Number.isNaN(code) ? m : String.fromCodePoint(code);
    }
    switch (body.toLowerCase()) {
      case 'quot':
        return '"';
      case 'apos':
        return "'";
      case 'amp':
        return '&';
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      default:
        return m; // 未知实体：字面保留（宽松口径，与 wellFormedXml 一致）
    }
  });
}

type XmlTok =
  | { type: 'text'; text: string } // 文本 run（逐字，不解码实体——规则 1）
  | { type: 'span'; text: string } // 注释 / CDATA / PI（不透明逐字 token）
  | { type: 'element'; name: string; attrs: Array<[string, string]>; children: XmlTok[] };

function expectXmlSemanticallyEqual(actual: string, expected: string): void {
  expect(canonicalXml(actual)).toBe(canonicalXml(expected));
}

/** canonical 归一化：属性按名排序 + 一律双引号 + 显式闭合 + 属性值实体解码。 */
function canonicalXml(s: string): string {
  return scanXmlTokens(s).map(renderXmlTok).join('');
}

function renderXmlTok(t: XmlTok): string {
  if (t.type !== 'element') return t.text;
  const attrs = [...t.attrs].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const attrStr = attrs.map(([k, v]) => ` ${k}="${v}"`).join('');
  return `<${t.name}${attrStr}>${t.children.map(renderXmlTok).join('')}</${t.name}>`;
}

/** mini 扫描器：token 识别镜像 wellFormedXml（配对引号、值内一切字符为字面量）。 */
function scanXmlTokens(s: string): XmlTok[] {
  const roots: XmlTok[] = [];
  const stack: Array<{ name: string; attrs: Map<string, string>; children: XmlTok[] }> = [];
  let textStart = 0;
  let i = 0;
  const flushText = (end: number): void => {
    if (end <= textStart) return;
    const tok: XmlTok = { type: 'text', text: s.slice(textStart, end) };
    const top = stack[stack.length - 1];
    if (top !== undefined) top.children.push(tok);
    else roots.push(tok);
  };
  const pushSpan = (span: string): void => {
    const tok: XmlTok = { type: 'span', text: span };
    const top = stack[stack.length - 1];
    if (top !== undefined) top.children.push(tok);
    else roots.push(tok);
  };
  while (i < s.length) {
    const c = s[i]!;
    if (c !== '<') {
      i++;
      continue;
    }
    if (s.startsWith('<!--', i)) {
      const end = s.indexOf('-->', i + 4);
      if (end === -1) throw new Error(`XML 比较器：未闭合的注释：${s}`);
      flushText(i);
      pushSpan(s.slice(i, end + 3));
      textStart = end + 3;
      i = end + 3;
    } else if (s.startsWith('<![CDATA[', i)) {
      const end = s.indexOf(']]>', i + 9);
      if (end === -1) throw new Error(`XML 比较器：未闭合的 CDATA 段：${s}`);
      flushText(i);
      pushSpan(s.slice(i, end + 3));
      textStart = end + 3;
      i = end + 3;
    } else if (s.startsWith('<?', i)) {
      const end = s.indexOf('?>', i + 2);
      if (end === -1) throw new Error(`XML 比较器：未闭合的处理指令：${s}`);
      flushText(i);
      pushSpan(s.slice(i, end + 2));
      textStart = end + 2;
      i = end + 2;
    } else if (s.startsWith('</', i)) {
      const nameStart = i + 2;
      const name = readXmlName(s, nameStart);
      if (name === null) throw new Error(`XML 比较器：无效的结束标签：${s}`);
      let j = skipXmlSpace(s, nameStart + name.length);
      if (j >= s.length || s[j] !== '>') throw new Error(`XML 比较器：结束标签未闭合：${s}`);
      flushText(i);
      const top = stack.pop();
      if (top === undefined || top.name !== name) throw new Error(`XML 比较器：结束标签与开始标签不匹配：${s}`);
      const tok: XmlTok = { type: 'element', name: top.name, attrs: [...top.attrs.entries()], children: top.children };
      const parent = stack[stack.length - 1];
      if (parent !== undefined) parent.children.push(tok);
      else roots.push(tok);
      textStart = j + 1;
      i = j + 1;
    } else if (isXmlNameStart(s[i + 1])) {
      const name = readXmlName(s, i + 1)!;
      flushText(i);
      const attrs = new Map<string, string>();
      const children: XmlTok[] = [];
      let j = i + 1 + name.length;
      let selfClosing = false;
      for (;;) {
        j = skipXmlSpace(s, j);
        if (j >= s.length) throw new Error(`XML 比较器：标签未闭合：${s}`);
        if (s[j] === '/') {
          j = skipXmlSpace(s, j + 1);
          if (j >= s.length || s[j] !== '>') throw new Error(`XML 比较器：自闭合标签未闭合：${s}`);
          selfClosing = true;
          break;
        }
        if (s[j] === '>') break;
        const attrName = readXmlName(s, j);
        if (attrName === null) throw new Error(`XML 比较器：无效的属性：${s}`);
        j += attrName.length;
        j = skipXmlSpace(s, j);
        if (j >= s.length || s[j] !== '=') throw new Error(`XML 比较器：属性缺少 "="：${s}`);
        j = skipXmlSpace(s, j + 1);
        const q = s[j];
        if (q !== '"' && q !== "'") throw new Error(`XML 比较器：属性值必须加引号：${s}`);
        const end = s.indexOf(q, j + 1); // 配对闭引号（另一引号字符不闭合）
        if (end === -1) throw new Error(`XML 比较器：属性值引号未闭合：${s}`);
        // 属性值：单遍实体解码后入 Map（重复属性 last-wins）
        attrs.set(attrName, decodeAttrEntities(s.slice(j + 1, end)));
        j = end + 1;
      }
      const tok: XmlTok = { type: 'element', name, attrs: [...attrs.entries()], children };
      if (selfClosing) {
        const top = stack[stack.length - 1];
        if (top !== undefined) top.children.push(tok);
        else roots.push(tok);
      } else {
        stack.push({ name, attrs, children });
      }
      textStart = j + 1;
      i = j + 1;
    } else {
      throw new Error(`XML 比较器：文本中裸 < 后非合法标签起点：${s}`);
    }
  }
  if (stack.length > 0) throw new Error(`XML 比较器：标签未闭合：${s}`);
  flushText(s.length);
  return roots;
}

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

function skipXmlSpace(s: string, from: number): number {
  let i = from;
  while (i < s.length && (s[i] === ' ' || s[i] === '\t' || s[i] === '\n' || s[i] === '\r')) i++;
  return i;
}

// —— RT-A：核心缺陷复现（AC-①/②/③ 主锚）——

describe('xml-attr-quote-domain — RT-A：<p title=\'a"b\'>x</p> 逻辑合法且必须可由 materializeRoot 成功物化并完成 round-trip', () => {
  const dXml = derivedOf('type ROOT = { body: YXmlFragment<{ p: string }> };');
  const INPUT = '<p title=\'a"b\'>x</p>'; // 单引号属性内双引号：XML 规范与 VFSL 良构规则的合法字面量
  const snapshot = { body: INPUT };

  it('前置：validateLogicalSnapshot 放行（宽域接受——证明问题在物化层而非逻辑层）', () => {
    const r = validateLogicalSnapshot(dXml, snapshot);
    expect(r.ok).toBe(true);
    if (!r.ok) {
      throw new Error(`logical validation 放行是修复前的既定事实（SA5 实测），此处不应失败：${JSON.stringify(r.issues)}`);
    }
  });

  it('AC-①：materializeRoot 必须成功（现实现 ok:false + 「属性 title 值含双引号」→ 红灯）', () => {
    const doc = new Y.Doc();
    const events = countUpdates(doc);
    const result = materializeRoot(dXml, snapshot, doc) as MaterializeResult;
    // 新契约：逻辑合法的单引号属性内双引号必须可物化；现实现返回
    // { ok:false, issues:[{message:'XML 解析失败（ROOT.body）：属性 title 值含双引号', path:['body']}] }
    expect(result).toEqual({ ok: true });
    expect(events.count).toBe(1); // 成功路径单事务（rev1/RAC-4 契约在 XML 面锚定）
  });

  it('AC-②③：extractYjsSnapshot 提取结果可再通过 validateLogicalSnapshot 且与输入 XML 语义等价', () => {
    const doc = new Y.Doc();
    const result = materializeRoot(dXml, snapshot, doc) as MaterializeResult;
    expect(result).toEqual({ ok: true }); // 前置：物化成功（若失败则本测试断言此等待的修复）
    const body = extractBody(dXml, doc);
    // 语义等价（属性值实体解码 + 引号风格无关 + 属性序无关），不要求逐字相同（W2）
    expectXmlSemanticallyEqual(body, INPUT);
    // 提取结果再次通过逻辑校验（AC-② 主锚）
    const re = validateLogicalSnapshot(dXml, { body });
    expect(re.ok).toBe(true);
    if (!re.ok) {
      throw new Error(`提取结果必须通过 validateLogicalSnapshot：${JSON.stringify(re.issues)}`);
    }
  });
});

// —— RT-C：表驱动引号/转义矩阵（AC-④）——

describe('xml-attr-quote-domain — RT-C：表驱动矩阵（单引号/双引号/空属性/引号交错/需转义值）', () => {
  const dXml = derivedOf('type ROOT = { body: YXmlFragment<{ p: string }> };');

  const MATRIX: Array<{ label: string; input: string }> = [
    // —— 目标缺陷行（修复前红灯）：单引号外壳内 `"` 字面量（任何位置）——
    { label: 'T-1 单引号外壳内双引号（值中段）', input: '<p title=\'a"b\'>x</p>' },
    { label: 'T-2 单引号外壳内双引号（值起首）', input: '<p title=\'"ab\'>x</p>' },
    { label: 'T-3 单引号外壳内双引号（值末尾）', input: '<p title=\'ab"\'>x</p>' },
    { label: 'T-4 单引号外壳内相邻双引号', input: '<p title=\'a""b\'>x</p>' },
    { label: 'T-5 单引号外壳内多段双引号', input: '<p title=\'a"b"c\'>x</p>' },
    { label: 'T-6 单引号外壳内双引号 + <>& 字面量', input: '<p title=\'a"<b>&c\'>x</p>' },
    { label: 'T-7 双属性引号交错（单引号含" 且双引号含\'）', input: '<p title=\'a"b\' lang="c\'d">x</p>' },
    { label: 'T-8 自闭合元素 + 单引号外壳内双引号', input: '<img title=\'a"b\'/>' },
    { label: 'T-9 嵌套元素 + 单引号外壳内双引号', input: '<div><span title=\'a"b\'>x</span></div>' },
    // —— 回归锁行（修复前后都须绿）：已工作通道与既有接受域——
    { label: 'T-10 双引号外壳内单引号（对照组，SA5 实测两侧均过）', input: '<p title="a\'b">x</p>' },
    { label: 'T-11 空属性值（单引号）', input: '<p title=\'\'>x</p>' },
    { label: 'T-12 空属性值（双引号）', input: '<p title="">x</p>' },
    { label: 'T-13 实体字面量 &quot; 值（无需转义的合法形式）', input: '<p title="a&quot;b">x</p>' },
    { label: 'T-14 双引号外壳内 <>& 字面量（R2 既有域）', input: '<p title="a<b&c">x</p>' },
  ];

  it.each(MATRIX)('$label：validate ok:true → materializeRoot ok:true + 单事务 + extract 语义等价 + revalidate ok', ({ input }) => {
    const snapshot = { body: input };
    // 前置：逻辑校验放行（两条引号规则的共同接受域）
    expect(validateLogicalSnapshot(dXml, snapshot).ok).toBe(true);
    const doc = new Y.Doc();
    const events = countUpdates(doc);
    const result = materializeRoot(dXml, snapshot, doc) as MaterializeResult;
    expect(result).toEqual({ ok: true }); // 单引号属性内双引号行现为 ok:false → 红灯
    expect(events.count).toBe(1);
    const body = extractBody(dXml, doc);
    expectXmlSemanticallyEqual(body, input);
    expect(validateLogicalSnapshot(dXml, { body }).ok).toBe(true);
  });
});

// —— RT-D：malformed 响亮失败 + 零写入（AC-⑤）——

describe('xml-attr-quote-domain — RT-D：malformed XML 响亮失败（validation/construction 失败 → ok:false + 零写入）', () => {
  const dXml = derivedOf('type ROOT = { body: YXmlFragment<{ p: string }> };');

  const BAD: Array<{ label: string; input: string }> = [
    { label: 'M-1 单引号外壳内裸单引号（配对闭引号截断 → 残段非属性）', input: '<p title=\'a\'b\'>x</p>' },
    { label: 'M-2 双引号外壳内裸双引号（配对闭引号截断 → 残段非属性）', input: '<p title="a"b">x</p>' },
    { label: 'M-3 属性值引号未闭合', input: '<p title=\'a>x</p>' },
    { label: 'M-4 标签未闭合', input: '<p title=\'x\'>' },
    { label: 'M-5 结束标签与开始标签不匹配', input: '<p title=\'x\'></q>' },
    { label: 'M-6 属性值必须加引号', input: '<p title=a>x</p>' },
    { label: 'M-7 文本中裸 < 后非合法标签起点', input: 'a < b' },
    { label: 'M-8 非法属性名（数字开头）', input: '<p 1a=\'x\'>x</p>' },
  ];

  it.each(BAD)('$label：validate ok:false 恰 1 issue → materializeRoot ok:false（引用零损透传）+ 0 update + state 字节不变', ({ input }) => {
    const snapshot = { body: input };
    const direct = validateLogicalSnapshot(dXml, snapshot);
    expect(direct.ok).toBe(false);
    let directIssues: MaterializeIssue[] = [];
    if (!direct.ok) {
      expect(direct.issues).toHaveLength(1); // 单违规输入（锁本矩阵行为，非 validate 全收集语义）
      directIssues = direct.issues;
    }
    const doc = new Y.Doc();
    const before = stateBytes(doc);
    const events = countUpdates(doc);
    const result = materializeRoot(dXml, snapshot, doc) as MaterializeResult;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toHaveLength(1);
      expect(result.issues).toEqual(directIssues); // 引用零损透传（rev1/RAC-3 契约）
    }
    // 零写入双证：0 update 事件 + encodeStateAsUpdate 逐字节不变
    expect(events.count).toBe(0);
    expect(stateBytes(doc)).toEqual(before);
  });
});

// —— RT-E：canonical/extract 比较器一致规则（AC-⑦，检测面不假成功也不误报）——

describe('xml-attr-quote-domain — RT-E：consistency——含双引号值在 canonical/extract 面可扫描，且真实偏离仍被检测（E201 不假成功）', () => {
  const dXml = derivedOf('type ROOT = { body: YXmlFragment<{ p: string }> };');

  it('输入本身含单引号外壳内双引号 + observer 注入另一含双引号属性 → 修后 ⑥ 必须 throw DOCRT-E201（绝不假成功）', () => {
    // 前置：逻辑放行（宽域）
    expect(validateLogicalSnapshot(dXml, { body: '<p title=\'a"b\'>x</p>' }).ok).toBe(true);
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    let done = false;
    root.observe(() => {
      if (done) return; // one-shot（G8 纪律）
      done = true;
      const body = root.get('body') as Y.XmlFragment;
      const el = body.get(0) as Y.XmlElement; // <p>
      el.setAttribute('q', 'x"y'); // 注入含双引号属性值（与输入 title 值同域字符）
    });
    // 现实现：② 构造期拒绝 → 返回 ok:false（不 throw）→ 本断言红；
    // 修复后：② 放行安装 → observer 注入 → ⑥ canonical 双侧均可扫描（同域一致规则）→
    // real({title,q}) vs scratch({title}) 产物差异 → throw DOCRT-E201（变体 C），绝不 ok:true。
    expect(() => materializeRoot(dXml, { body: '<p title=\'a"b\'>x</p>' }, doc)).toThrow(/DOCRT-E201/);
  });
});
