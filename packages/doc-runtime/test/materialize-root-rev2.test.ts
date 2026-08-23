/**
 * SA6 红灯测试（rev2 修订轮）— @nomicore/doc-runtime materializeRoot 嵌套子树就地修改
 * 边界 + Minor 硬化（PR #84 owner Review / issue #74）。
 *
 * 契约来源：
 * - 任务简报 wiki/raw/task_doc-runtime-materialize-root-rev2.md（P1 见 materialize-root.test.ts
 *   T-1 拒绝测试改造；本文件承载 Medium 与 Minor 两项）：
 *   - Medium：verifyInstall() 只检查 ROOT 顶层 key 数与顶层 value 引用 identity；同步 observer
 *     若保持顶层引用不变、仅原地修改已安装子树（如 `const u = root.get('u') as Y.Map; u.set('n', 2)`），
 *     顶层 identity 校验仍通过、函数返回 {ok:true}，但 logical snapshot 已偏离输入。成功语义
 *     二选一（owner 选项 1 / 选项 2），本文件断言先按**选项 1** 编写：ok:true 须保证完整
 *     logical snapshot 未偏离 → 嵌套偏离 → 不得 ok:true（写后偏离检测形态受 W1 红线约束
 *     = throw，E201 家族——占位断言，SA1 定稿后对齐）；若 SA1 定稿选选项 2（有限保证 +
 *     characterization），本组按设计调整为 characterization 断言。
 *   - Minor-1：CDATA / PI / comment 为 raw Y.XmlText opaque span 承载，是 **lexical-token
 *     round-trip**（非结构化 XML 节点语义，ADR-0003 终态节点 + 不定义结构映射立场）；
 *     补元素内部混合内容（文本/元素/注释/CDATA/PI 交错）round-trip 测试。
 *   - Minor-2：detached XML/Yjs assembly 抛异常进入 DOCRT-E200 后仍零写入的确定性覆盖
 *     （受控 seam 属 SA2 设计评审面，本轮以**极深树**方式确定性触发）。
 * - docs/adr/0007：零写入承诺覆盖所有验证失败和 detached 构造失败；「Yjs 结构与路径/操作
 *   错误 fail-fast」；XML 只承诺语义等价 round-trip（W2：断言禁收紧为逐字字节相同）。
 * - SA8 rev2 门禁边界（-rev2_conflict_report.md）：W1（写后偏离唯一相容形态 = throw）、
 *   W2（XML 断言禁逐字）、W3（语义比较禁退化为字节相等）。
 *
 * 断言纪律（与 materialize-root.test.ts 同款）：
 * - 黑盒可观测输出锚定，不读源码、不 grep 实现文本；
 * - observer 一律 one-shot（G8：无 guard 重入写 → 引擎无限递归 RangeError）；
 * - XML 断言经语义归一化比较器（CDATA/PI/comment = 不透明逐字 span token，lexical-token
 *   载体特征），禁逐字断言（W2/W3）；
 * - 占位断言（错误形态/身份归 SA1 设计定稿）：以注释标注，定稿后对齐，不预设实现内部结构。
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

type MaterializeResult =
  | { ok: true }
  | { ok: false; issues: MaterializeIssue[] };

// —— 测试辅助（与 materialize-root.test.ts 同款，本文件自包含）——

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

/** 'update' 事件计数器（零写入/单事务锚）。 */
function countUpdates(doc: Y.Doc): { count: number } {
  const counter = { count: 0 };
  doc.on('update', () => {
    counter.count += 1;
  });
  return counter;
}

// —— XML 语义等价比较器（逐字复制自 materialize-root.test.ts：canonical 解析 + 属性排序
// 无关 + 引号归一 + last-wins；注释/CDATA/PI = 不透明逐字 span token。W2/W3 合规落地件）——

type XmlTok =
  | { type: 'text'; text: string }
  | { type: 'span'; text: string }
  | { type: 'element'; name: string; attrs: Array<[string, string]>; children: XmlTok[] };

function expectXmlSemanticallyEqual(actual: string, expected: string): void {
  expect(canonicalXml(actual)).toBe(canonicalXml(expected));
}

function canonicalXml(s: string): string {
  return scanXmlTokens(s).map(renderXmlTok).join('');
}

function renderXmlTok(t: XmlTok): string {
  if (t.type !== 'element') return t.text; // 文本与不透明 span 逐字
  const attrs = [...t.attrs].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const attrStr = attrs.map(([k, v]) => ` ${k}="${v}"`).join('');
  return `<${t.name}${attrStr}>${t.children.map(renderXmlTok).join('')}</${t.name}>`;
}

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
        const end = s.indexOf(q, j + 1);
        if (end === -1) throw new Error(`XML 比较器：属性值引号未闭合：${s}`);
        attrs.set(attrName, s.slice(j + 1, end));
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
  if (stack.length > 0) throw new Error(`XML 比较器：标签未闭合：${stack[stack.length - 1]!.name}`);
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

// —— Medium fixture：同一 ROOT 含嵌套 Y.Map / Y.Array / Y.XmlFragment 三形态 ——

const DERIVED_NESTED = derivedOf(
  'type ROOT = { u: YMap<{ n: YLeaf<number> }>; tags: YArray<YLeaf<string>>; body: YXmlFragment<{ p: string }> };',
);

const SNAP_NESTED = { u: { n: 1 }, tags: ['a', 'b'], body: '<p>x</p>' };

// —— rev2 / Medium（owner 选项 1 语义：ok:true 须保证完整 logical snapshot 未偏离）——
//
// 场景：同步 observer 保持 ROOT 顶层引用不变、仅**原地修改已安装嵌套子树**（Y.Map /
// Y.Array / Y.XmlFragment 各一例）。顶层 keyset+identity 双断言（rev1 ⑤ verifyInstall）对
// 该场景盲区 → 当前实现返回 ok:true（红灯）。选项 1 下修复 = 完整语义校验（extract/
// fingerprint），嵌套偏离 → 写后检测 throw（W1 唯一相容形态，E201 家族——占位断言，
// SA1 定稿后对齐）。写已提交、不虚假回滚（R1 同款纪律）：断言最终 ROOT 保留嵌套偏离、
// 顶层引用未变、首事务已提交。

describe('materializeRoot — R2（rev2/Medium）：嵌套子树就地修改边界（owner 选项 1：嵌套偏离 → 不得 ok:true）', () => {
  it('同步 observer 仅原地修改嵌套 Y.Map（u.set(\'n\', 2)，顶层引用不变）→ throw DOCRT-E201 家族（不得 ok:true）', () => {
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    let uRef: Y.Map<unknown> | undefined;
    let done = false;
    root.observe(() => {
      if (done) return; // one-shot（G8 纪律）
      done = true;
      uRef = root.get('u') as Y.Map<unknown>; // 已安装嵌套子树引用（顶层键未动）
      uRef.set('n', 2); // 原地修改嵌套值——顶层 size/identity 双断言盲区
    });
    const events = countUpdates(doc);
    // 主锚（选项 1）：嵌套偏离 → 不得 ok:true。写后偏离检测形态受 W1 红线约束 = throw。
    // 当前实现：⑤ 只验顶层 → 返回 ok:true → 本断言红（SA3 完整语义校验后转绿）。
    // 占位：错误码/消息按 SA1 设计定稿对齐（R1 顶层偏离先例为 DOCRT-E201 家族）。
    expect(() => materializeRoot(DERIVED_NESTED, SNAP_NESTED, doc)).toThrow(/DOCRT-E201/);
    // 写已提交、不虚假回滚：顶层引用未变 + 嵌套偏离已落地
    expect(root.get('u')).toBe(uRef);
    expect(uRef?.get('n')).toBe(2);
    expect(events.count).toBeGreaterThanOrEqual(1); // 首事务已提交（INV-2）
  });

  it('同步 observer 仅原地修改嵌套 Y.Array（tags.insert(1, [\'z\'])，顶层引用不变）→ throw DOCRT-E201 家族（不得 ok:true）', () => {
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    let arrRef: Y.Array<unknown> | undefined;
    let done = false;
    root.observe(() => {
      if (done) return;
      done = true;
      arrRef = root.get('tags') as Y.Array<unknown>;
      arrRef.insert(1, ['z']); // 原地插入——数组引用不变，内容偏离
    });
    const events = countUpdates(doc);
    expect(() => materializeRoot(DERIVED_NESTED, SNAP_NESTED, doc)).toThrow(/DOCRT-E201/);
    expect(root.get('tags')).toBe(arrRef);
    expect(arrRef?.toArray()).toEqual(['a', 'z', 'b']);
    expect(events.count).toBeGreaterThanOrEqual(1);
  });

  it('同步 observer 仅原地修改嵌套 Y.XmlFragment（body.insert 追加 XmlText，顶层引用不变）→ throw DOCRT-E201 家族（不得 ok:true）', () => {
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    let fragRef: Y.XmlFragment | undefined;
    let done = false;
    root.observe(() => {
      if (done) return;
      done = true;
      fragRef = root.get('body') as Y.XmlFragment;
      fragRef.insert(fragRef.length, [new Y.XmlText('HACKED')]); // 原地追加——引用不变，内容偏离
    });
    const events = countUpdates(doc);
    expect(() => materializeRoot(DERIVED_NESTED, SNAP_NESTED, doc)).toThrow(/DOCRT-E201/);
    expect(root.get('body')).toBe(fragRef);
    expect(fragRef?.toString()).toBe('<p>x</p>HACKED');
    expect(events.count).toBeGreaterThanOrEqual(1);
  });

  it('正向对照：同步 observer 只读嵌套子树（不写）→ ok:true 且 extract 完整语义等价（防过度拒绝假阳性）', () => {
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    let observeCalls = 0;
    root.observe(() => {
      observeCalls += 1;
      const u = root.get('u') as Y.Map<unknown> | undefined;
      void u?.get('n'); // 只读，不写——诚实 observer
    });
    const result = materializeRoot(DERIVED_NESTED, SNAP_NESTED, doc) as MaterializeResult;
    expect(result.ok).toBe(true);
    expect(observeCalls).toBe(1); // 单事务恰一次 type-observer 回调（P-R3）
    const ex = extractYjsSnapshot(DERIVED_NESTED, doc);
    expect(ex.ok).toBe(true);
    if (!ex.ok) {
      throw new Error(`期望提取成功，实际失败：${JSON.stringify(ex.issues)}`);
    }
    const s = ex.snapshot as { u: { n: number }; tags: string[]; body: string };
    expect(s.u).toEqual({ n: 1 });
    expect(s.tags).toEqual(['a', 'b']);
    expectXmlSemanticallyEqual(s.body, '<p>x</p>');
    expect(validateLogicalSnapshot(DERIVED_NESTED, ex.snapshot).ok).toBe(true);
  });
});

// —— rev2 / Minor-1：CDATA / PI / comment 是 lexical-token round-trip（非结构化 XML 节点
// 语义，ADR-0003 终态节点 + 不定义结构映射立场）——元素内部混合内容——
//
// 断言经语义归一化比较器：注释/CDATA/PI 为不透明**逐字 span token**（lexical-token 载体
// 特征以 characterization 锁定，W2：不收紧为公共逐字 round-trip 承诺，禁逐字字节断言）。

describe('materializeRoot — R2（rev2/Minor-1）：元素内部混合内容 lexical-token round-trip', () => {
  it('单元素内 文本/元素/注释/CDATA/PI 交错 → materialize ok + 单事务 + extract 语义等价 + revalidate ok', () => {
    const derived = derivedOf('type ROOT = { body: YXmlFragment<{ p: string }> };');
    const input = '<p>pre <!--c--> mid <b>bold</b> <![CDATA[raw <&>]]> post <?pi go?> end</p>';
    const doc = new Y.Doc();
    const events = countUpdates(doc);
    const result = materializeRoot(derived, { body: input }, doc) as MaterializeResult;
    expect(result.ok).toBe(true);
    expect(events.count).toBe(1); // 单事务（U8 语义在 XML 面锚定）
    const ex = extractYjsSnapshot(derived, doc);
    expect(ex.ok).toBe(true);
    if (!ex.ok) {
      throw new Error(`期望提取成功，实际失败：${JSON.stringify(ex.issues)}`);
    }
    const body = (ex.snapshot as { body: string }).body;
    expect(typeof body).toBe('string');
    // W2/W3：语义等价比较（CDATA/PI/comment 逐字 span + 元素/文本语义归一化），禁逐字断言
    expectXmlSemanticallyEqual(body, input);
    // AC-5 主锚：提取出的逻辑 ROOT 再次通过完整逻辑校验
    expect(validateLogicalSnapshot(derived, ex.snapshot).ok).toBe(true);
  });
});

// —— rev2 / Minor-2：detached XML/Yjs assembly 抛异常 → DOCRT-E200 → 零写入的确定性覆盖——
//
// ADR-0007「零写入承诺覆盖所有验证失败和 detached 构造失败」的直接验收强化。受控 seam 是否
// 引入生产代码测试钩子属 SA2 设计评审面（SA8 门禁无条款障碍）；本轮以**极深树**方式确定性
// 触发：wellFormedXml / 本包扫描器均为迭代式（显式栈，深度对调用栈免疫）→ ① 逻辑校验
// 100% 通过（触发点不在逻辑失败支路）；② detached 装配器 assembleNode 递归、深度受 JS 栈
// 上界约束（xml-parse.ts 明文：溢出 RangeError → E200，与 validate.ts 对深嵌套同款处置）
// → RangeError 落入 prepare 共享崩溃边界 → DOCRT-E200 单 issue + 零写入。
// 深度标定（scratch 实测，Node 24 / tsx）：depth=2_000 溢出点落在 ④ 安装期（raw throw +
// 部分写入——INV-5 结构保证的预期行为，非本测试锚定面）；depth≥10_000 溢出点确定落在 ②
// detached 装配（E200 + 0 update + state 不变）。取 20_000 留 2× 余量。

describe('materializeRoot — R2（rev2/Minor-2）：detached 装配栈溢出 → DOCRT-E200 后零写入（确定性覆盖）', () => {
  it('极深 XML 树（20_000 层）→ ① 通过、② 装配溢出 → ok:false + 恰 1 issue（DOCRT-E200）+ 0 update + state 字节不变', () => {
    const derived = derivedOf('type ROOT = { body: YXmlFragment<{ p: string }> };');
    const DEPTH = 20_000;
    const deep = '<p>'.repeat(DEPTH) + 'x' + '</p>'.repeat(DEPTH);
    // (1) 前置：① 逻辑校验通过（wellFormedXml 迭代式，深 XML 不递归）——证明触发点落在
    //     ② detached 构造支路（E200 路径），而非 ① 逻辑失败支路（VFSL-E100 兜底路径）
    expect(validateLogicalSnapshot(derived, { body: deep }).ok).toBe(true);
    const doc = new Y.Doc();
    const before = stateBytes(doc);
    const events = countUpdates(doc);
    // (2) 构造崩溃边界：意外异常 → DOCRT-E200 单 issue（fail-fast）
    const result = materializeRoot(derived, { body: deep }, doc) as MaterializeResult;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toHaveLength(1);
      const issue = result.issues[0];
      expect(issue).toBeDefined();
      expect(issue?.message).toMatch(/DOCRT-E200/);
      expect(Array.isArray(issue?.path)).toBe(true);
    }
    // (3) 零写入双证：0 update 事件 + Y.encodeStateAsUpdate 逐字节不变
    expect(events.count).toBe(0);
    expect(stateBytes(doc)).toEqual(before);
  });
});

// —— rev2 / R2 批（SA1 设计 §7.1 测试规格完整落地；设计定稿
// wiki/raw/task_doc-runtime-materialize-root-rev2_design.md，SA2 R4 pass）——
//
// 断言语义唯一锚 = §7/§7.1 对齐表 + §4.2 对称重物化（extract(real) ≡ extract(scratch)；
// E201 变体 C/D throw）+ §3.4 ⓪ guard 伪代码（E202 三变体消息逐字定稿）：
// - RT-2：窗口 B（cleanup/observer 派发中）拒绝——throw /DOCRT-E202/ + 「派发期间」文本锚
//   + stateBytes 跨调用不变 + update 计数不增 + ROOT 空置；afterAllTransactions 例外对照组
//   ok:true（PA-9：队列已重置 []，放行正确——防 SA3 误拒）。
// - RT-3：窗口 C fail-closed 三形态（delete _transaction / cleanups={} → 变体 C 文本锚
//   「无法确认」「版本兼容性」；truthy 垃圾 tx → §3.1 收敛口径断言 A「doc._transaction 非空」）
//   + 三形态 stateBytes 不变。
// - RT-4：cleanup 队列 wedge（update 回调抛异常卡死队列，PA-10/R-7）→ 顶层调用 → throw
//   /DOCRT-E202/ + B 变体诊断分支「队列异常残留」（锁 loud 方向，绝不 ok:true）。
// - RT-5：observer 向已安装 XmlElement 注入含双引号属性值 → extract 侧 toString 不转义 →
//   canonical 扫描失败 → 变体 D → toThrow(/DOCRT-E201/)（主锚：不可扫描也绝不假成功）。
// - RT-1.5：三掩盖形态（R2 判据击穿向量回归锚——窄成员掩盖宽成员声明键 / 必填缺席成员掩盖
//   Record 动态键 / 判别联合经 ref 掩盖成员独有字段，vfs3.assets idiom）攻击
//   toThrow(/DOCRT-E201/) + 诚实对照 ok:true + extract 投影锁定。
// - RT-1.6：删除向量（R3 判据击穿向量回归锚——D1 宽严格联合 delete 宽成员声明键 / D2 判别
//   联合经 ref delete 成员独有字段）攻击 toThrow(/DOCRT-E201/) + 诚实对照 ok:true。
//
// 红灯现状（当前实现无 ⓪ guard 无 ⑥ 校验）：RT-2 主 / RT-3 ×3 / RT-4 / RT-5 / RT-1.5 攻击 ×3 /
// RT-1.6 攻击 ×2 共 11 用例红（假成功 ok:true 或非 E202/E201 错误形态）；对照/诚实用例绿。

describe('materializeRoot — R2（rev2/RT-2）：窗口 B（cleanup/observer 派发中）→ throw DOCRT-E202（派发期间文本锚）+ 零写入', () => {
  it('OTHER map observer 回调内调用 → throw /DOCRT-E202/ + 消息含「派发期间」；stateBytes 跨调用不变、update 计数不增、ROOT 空置', () => {
    // 触发手法照设计 §9.2/§7.1 RT-2：观察 OTHER map（不观察 ROOT——避免安装与触发耦合），
    // 回调由 doc.transact(() => other.set('seed', 1)) 触发；回调入口即窗口 B
    // （tx===null 且 _transactionCleanups.length>0，PA-2）。
    const derived = derivedOf('type ROOT = { title: string; count: number };');
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    const other = doc.getMap('OTHER');
    const events = countUpdates(doc);
    let thrown: unknown;
    let stateAtEntry: number[] | undefined;
    let stateAfter: number[] | undefined;
    let countAtEntry = 0;
    let countAfter = 0;
    let done = false;
    other.observe(() => {
      if (done) return; // one-shot（G8 纪律）
      done = true;
      stateAtEntry = stateBytes(doc);
      countAtEntry = events.count;
      try {
        materializeRoot(derived, { title: 't', count: 7 }, doc);
      } catch (err) {
        thrown = err;
      }
      stateAfter = stateBytes(doc); // 调用后立即（同步回调内）：本函数零写入 → 逐字节不变
      countAfter = events.count; // materializeRoot 不得新增 update 事件
    });
    doc.transact(() => {
      other.set('seed', 1);
    });
    // (a) 窗口 B 拒绝：当前实现无 ⓪ guard → 假成功 ok:true（§9.2 实证）→ 本断言红
    expect(thrown).toBeInstanceOf(Error);
    const msg = (thrown as Error).message;
    expect(msg).toMatch(/DOCRT-E202/);
    expect(msg).toContain('派发期间'); // 变体 B 文本锚（§3.4 E202_MSG_B 逐字定稿）
    // (b) 本函数零写入：stateBytes 跨调用逐字节不变
    expect(stateAfter).toEqual(stateAtEntry);
    // (c) update 事件计数不因 materializeRoot 增加
    expect(countAfter).toBe(countAtEntry);
    // (d) ROOT 键集保持空置（外层只写 OTHER）
    expect(root.size).toBe(0);
    expect([...root.keys()]).toEqual([]);
  });

  it('对照组：afterAllTransactions 回调内调用 → ok:true + extract 投影语义等价（§3.1 B 行明文例外，防 SA3 误拒）', () => {
    // PA-9/E2b：afterAllTransactions 回调执行时 _transactionCleanups 已重置 []，该窗口内新开
    // transact 自含完整生命周期（observer 在 transact 返回前派发完毕）→ 放行是正确行为。
    const derived = derivedOf('type ROOT = { title: string; count: number };');
    const doc = new Y.Doc();
    let result: MaterializeResult | undefined;
    let thrown: unknown;
    const listener = (): void => {
      doc.off('afterAllTransactions', listener); // 先摘除：本回调内新事务链尾会再次 emit
      try {
        result = materializeRoot(derived, { title: 't', count: 7 }, doc);
      } catch (err) {
        thrown = err;
      }
    };
    doc.on('afterAllTransactions', listener);
    doc.transact(() => {
      doc.getMap('OTHER').set('seed', 1); // 触发一次完整事务生命周期 → afterAllTransactions
    });
    expect(thrown).toBeUndefined();
    expect(result?.ok).toBe(true);
    const ex = extractYjsSnapshot(derived, doc);
    expect(ex.ok).toBe(true);
    if (!ex.ok) {
      throw new Error(`期望提取成功，实际失败：${JSON.stringify(ex.issues)}`);
    }
    expect(ex.snapshot).toEqual({ title: 't', count: 7 });
  });
});

describe('materializeRoot — R2（rev2/RT-3）：窗口 C fail-closed 三形态 → throw DOCRT-E202 + 变体文本锚 + stateBytes 不变', () => {
  const derived = derivedOf('type ROOT = { title: string };');
  const CASES_C: Array<{ name: string; mutate: (doc: Y.Doc) => void; variantA: boolean }> = [
    {
      name: 'C-1 delete doc._transaction（字段缺失 → fall-through 窗口 C）',
      mutate: (doc) => {
        delete (doc as unknown as { _transaction?: unknown })._transaction;
      },
      variantA: false,
    },
    {
      name: 'C-2 doc._transactionCleanups = {}（非 Array → fall-through 窗口 C）',
      mutate: (doc) => {
        (doc as unknown as { _transactionCleanups?: unknown })._transactionCleanups = {};
      },
      variantA: false,
    },
    {
      name: 'C-3 doc._transaction = {}（truthy 垃圾 → §3.1 收敛口径断言 A：不做形态嗅探）',
      mutate: (doc) => {
        (doc as unknown as { _transaction?: unknown })._transaction = {};
      },
      variantA: true,
    },
  ];

  it.each(CASES_C)('$name：toThrow /DOCRT-E202/ + 文本锚（C=「无法确认」「版本兼容性」/ A=「doc._transaction 非空」）+ stateBytes 不变', ({ mutate, variantA }) => {
    // §3.1 C 行 + §3.4 伪代码单一口径（R2/#3）：窗口 C 为 fall-through 定义——字段缺失/非
    // Array 队列/垃圾值全部 fail-closed；truthy 垃圾 tx 按 A 收敛（消息事实性宣称「非空」为真）。
    const doc = new Y.Doc();
    const before = stateBytes(doc);
    mutate(doc);
    let thrown: unknown;
    try {
      materializeRoot(derived, { title: 't' }, doc);
    } catch (err) {
      thrown = err;
    }
    // 当前实现无 ⓪ guard：三形态均在 ④ transact 抛 raw TypeError（_transaction 缺失致 yjs
    // transact 不建事务 / cleanups.push 失败 / 垃圾 tx 无事务上下文）——非 /DOCRT-E202/ → 红
    expect(thrown).toBeInstanceOf(Error);
    const msg = (thrown as Error).message;
    expect(msg).toMatch(/DOCRT-E202/);
    if (variantA) {
      expect(msg).toContain('doc._transaction 非空'); // E202_MSG_A 文本锚（§3.4 逐字）
    } else {
      expect(msg).toContain('无法确认'); // E202_MSG_C 文本锚
      expect(msg).toContain('版本兼容性'); // E202_MSG_C 文本锚
    }
    // 零写入：三形态均断言 stateBytes 逐字节不变（写前拒绝）
    expect(stateBytes(doc)).toEqual(before);
  });
});

describe('materializeRoot — R2（rev2/RT-4）：cleanup 队列 wedge（update 回调抛异常卡死）→ 顶层调用 throw DOCRT-E202 诊断分支', () => {
  it('一次性抛异常 update 回调 → 外层 transact 抛出（队列卡死，PA-10）→ 顶层调用 → throw /DOCRT-E202/ + 消息含「队列异常残留」', () => {
    // SA2 E3/R-7：update 回调抛异常自 cleanupTransactions 逃逸 → 队列排空尾部不执行 →
    // _transactionCleanups 永久非空 → 此后无辜顶层调用命中窗口 B；E202-B 末句诊断分支
    // 「队列异常残留……请勿继续复用该 doc 实例」。本用例锁 loud 方向（绝不 ok:true）。
    const derived = derivedOf('type ROOT = { title: string };');
    const doc = new Y.Doc();
    doc.on('update', () => {
      throw new Error('wedge-boom'); // 抛异常 update 回调（wedge 触发器）
    });
    // 前置：外层 transact 确实因 update 回调抛异常（wedge 成立——cleanup 队列卡死）
    let outerThrown: unknown;
    try {
      doc.transact(() => {
        doc.getMap('OTHER').set('seed', 1);
      });
    } catch (err) {
      outerThrown = err;
    }
    expect(outerThrown).toBeInstanceOf(Error);
    // 顶层再调 materializeRoot：当前实现无 guard → wedged doc 上 ④ 不触发 cleanup →
    // ⑤ 空转 → 假成功 ok:true → 本断言红（SA3 实现后 guard 窗口 B → throw E202-B）
    let thrown: unknown;
    try {
      materializeRoot(derived, { title: 't' }, doc);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    const msg = (thrown as Error).message;
    expect(msg).toMatch(/DOCRT-E202/);
    expect(msg).toContain('队列异常残留'); // B 变体诊断分支文本锚（§3.4 E202_MSG_B 末句）
  });
});

describe('materializeRoot — R2（rev2/RT-5）：不可扫描 XML（observer 注入含双引号属性值）→ 绝不假成功（throw DOCRT-E201）', () => {
  it('one-shot observer 对已安装 XmlElement setAttribute(\'q\', \'x"y\') → toThrow(/DOCRT-E201/)（变体 C 或 D 皆可——主锚「不可扫描也绝不 ok:true」）', () => {
    // §7.1 RT-5 / §4.3：yjs XmlElement.toString() 不转义属性值（A12）→ 提取侧输出
    // `<p q="x"y">t</p>` 非良构 → ⑥ canonical 扫描失败 → 变体 D（canonical 扫描失败支）。
    // 断言主锚：绝不假成功——toThrow(/DOCRT-E201/)（变体 C 或 D 均以 DOCRT-E201 起头）。
    const derived = derivedOf('type ROOT = { body: YXmlFragment<{ p: string }> };');
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    let done = false;
    root.observe(() => {
      if (done) return; // one-shot（G8 纪律）
      done = true;
      const body = root.get('body') as Y.XmlFragment;
      const el = body.get(0) as Y.XmlElement; // <p>
      el.setAttribute('q', 'x"y'); // 属性值含双引号 → 提取侧不可扫描
    });
    // 当前实现无 ⑥ → 返回 ok:true → 本断言红（SA3 实现 ⑥ 后：canonical 失败 → 变体 D throw）
    expect(() => materializeRoot(derived, { body: '<p>t</p>' }, doc)).toThrow(/DOCRT-E201/);
  });
});

// —— rev2 / RT-1.5（R3/F-R2-1 配套）：掩盖形态负对照 + 诚实对照（判据演进回归锚）——
//
// 三掩盖形态是 R2 版「按成员投影 any-of」判据的击穿向量（有损成员掩盖投影内真偏离）；R4
// 对称重物化（extract(real) ≡ extract(scratch)）下攻击使 real 侧产物偏离 scratch 侧 → E201-C；
// 诚实路径双侧同管线产物一致 → ok:true。攻击均设在嵌套字段位（⑤ 盲区）、one-shot observer
// 改成员独有/动态/宽成员声明键——ROOT 顶层引用不变。schema 联合均含 ref 或嵌套联合以触发
// ⑥ 的 ref 解析与全键集比较。

const VFSL_WIDE_NARROW = 'type ROOT = { u: { x: YLeaf<number>; k: YLeaf<number> } | { x: YLeaf<number> } };';
const SNAP_WIDE_NARROW = { u: { x: 1, k: 2 } };
const VFSL_OPTIONAL_RECORD = 'type ROOT = { u: { b: YArray<YLeaf<string>> } | Record<string, YLeaf<string>> };';
const SNAP_OPTIONAL_RECORD = { u: { q: 'z' } };
const VFSL_ASSET_UNION = [
  'type TextAsset = { kind: YLeaf<string>; body: YXmlFragment<{ p: string }> };',
  'type ImageAsset = { kind: YLeaf<string>; url: YLeaf<string>; width: YLeaf<number>; height: YLeaf<number> };',
  'type AssetEntity = TextAsset | ImageAsset;',
  'type ROOT = { asset: AssetEntity };',
].join('\n');
const SNAP_ASSET = { asset: { kind: 'text', body: '<p>hello</p>' } };

describe('materializeRoot — R2（rev2/RT-1.5）：掩盖形态负对照（窄成员/必填缺席成员/判别联合经 ref）+ 诚实对照', () => {
  it('形态 A：窄成员掩盖宽成员声明键——uRef.set(\'k\', 9) → toThrow(/DOCRT-E201/)（前置 ① validate ok）', () => {
    const derived = derivedOf(VFSL_WIDE_NARROW);
    expect(validateLogicalSnapshot(derived, SNAP_WIDE_NARROW).ok).toBe(true); // 前置：① 通过（攻击支路可达）
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    let done = false;
    root.observe(() => {
      if (done) return; // one-shot（G8 纪律）
      done = true;
      const uRef = root.get('u') as Y.Map<unknown>;
      uRef.set('k', 9); // k 是宽成员声明键、窄成员未声明——R2 版判据被窄成员有损 equal 掩盖
    });
    // 当前实现无 ⑥ → ok:true → 红（SA3 对称重物化：real {u:{x:1,k:9}} vs scratch {u:{x:1,k:2}} → diff → E201-C）
    expect(() => materializeRoot(derived, SNAP_WIDE_NARROW, doc)).toThrow(/DOCRT-E201/);
  });

  it('形态 A 诚实对照：无 observer → ok:true + extract 投影 {u:{x:1,k:2}}', () => {
    const derived = derivedOf(VFSL_WIDE_NARROW);
    const doc = new Y.Doc();
    const result = materializeRoot(derived, SNAP_WIDE_NARROW, doc) as MaterializeResult;
    expect(result.ok).toBe(true);
    const ex = extractYjsSnapshot(derived, doc);
    expect(ex.ok).toBe(true);
    if (!ex.ok) {
      throw new Error(`期望提取成功，实际失败：${JSON.stringify(ex.issues)}`);
    }
    expect(ex.snapshot).toEqual(SNAP_WIDE_NARROW); // 诚实路径投影（build/extract 双侧同仲裁）
  });

  it('形态 B：必填缺席成员掩盖 Record 动态键——uRef.set(\'q\', \'HACKED\') → toThrow(/DOCRT-E201/)', () => {
    const derived = derivedOf(VFSL_OPTIONAL_RECORD);
    expect(validateLogicalSnapshot(derived, SNAP_OPTIONAL_RECORD).ok).toBe(true);
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    let done = false;
    root.observe(() => {
      if (done) return;
      done = true;
      const uRef = root.get('u') as Y.Map<unknown>;
      uRef.set('q', 'HACKED'); // q 是 Record 动态键——{b} 成员（必填缺席）的有损 equal 是 R2 版掩盖向量
    });
    expect(() => materializeRoot(derived, SNAP_OPTIONAL_RECORD, doc)).toThrow(/DOCRT-E201/);
  });

  it('形态 B 诚实对照：无 observer → ok:true + extract 投影 {u:{q:\'z\'}}', () => {
    const derived = derivedOf(VFSL_OPTIONAL_RECORD);
    const doc = new Y.Doc();
    const result = materializeRoot(derived, SNAP_OPTIONAL_RECORD, doc) as MaterializeResult;
    expect(result.ok).toBe(true);
    const ex = extractYjsSnapshot(derived, doc);
    expect(ex.ok).toBe(true);
    if (!ex.ok) {
      throw new Error(`期望提取成功，实际失败：${JSON.stringify(ex.issues)}`);
    }
    expect(ex.snapshot).toEqual(SNAP_OPTIONAL_RECORD); // extract 仲裁选 Record 成员（{b} 必填缺席被拒）
  });

  it('形态 C：判别联合经 ref 掩盖成员独有字段——bodyRef.insert 追加 → toThrow(/DOCRT-E201/)（vfs3.assets 同款 idiom）', () => {
    const derived = derivedOf(VFSL_ASSET_UNION);
    expect(validateLogicalSnapshot(derived, SNAP_ASSET).ok).toBe(true);
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    let done = false;
    root.observe(() => {
      if (done) return;
      done = true;
      const asset = root.get('asset') as Y.Map<unknown>;
      const bodyRef = asset.get('body') as Y.XmlFragment;
      bodyRef.insert(bodyRef.length, [new Y.XmlText('HACKED')]); // body 是 text 成员独有字段、image 成员未声明
    });
    expect(() => materializeRoot(derived, SNAP_ASSET, doc)).toThrow(/DOCRT-E201/);
  });

  it('形态 C 诚实对照：无 observer → ok:true + extract 投影 body 语义等价（W2/W3 语义比较器）', () => {
    const derived = derivedOf(VFSL_ASSET_UNION);
    const doc = new Y.Doc();
    const result = materializeRoot(derived, SNAP_ASSET, doc) as MaterializeResult;
    expect(result.ok).toBe(true);
    const ex = extractYjsSnapshot(derived, doc);
    expect(ex.ok).toBe(true);
    if (!ex.ok) {
      throw new Error(`期望提取成功，实际失败：${JSON.stringify(ex.issues)}`);
    }
    const s = ex.snapshot as { asset: { kind: string; body: string } };
    expect(s.asset.kind).toBe('text');
    expectXmlSemanticallyEqual(s.asset.body, '<p>hello</p>'); // XML 经语义比较器（禁逐字，W2/W3）
  });
});

// —— rev2 / RT-1.6（R4/F-R3-1 配套）：删除向量负对照 + 诚实对照（判据演进回归锚）——
//
// D1/D2 是 R3 版「无损锚定 any-of」判据的击穿向量（删除使 P 缩水 → 宽松成员平凡无损 +
// extract 仲裁漂移/回退）；R4 对称重物化下删除使 real 侧 extract 产物键集缩水 → 与 scratch
// 侧全键集产物不等 → E201-C（键集支）。

describe('materializeRoot — R2（rev2/RT-1.6）：删除向量负对照（D1 宽严格联合 / D2 判别联合经 ref）+ 诚实对照', () => {
  it('D1：删除宽成员声明键——uRef.delete(\'k\') → toThrow(/DOCRT-E201/)（real 侧 extract 键集缩水 + 仲裁漂移）', () => {
    const derived = derivedOf(VFSL_WIDE_NARROW);
    expect(validateLogicalSnapshot(derived, SNAP_WIDE_NARROW).ok).toBe(true);
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    let done = false;
    root.observe(() => {
      if (done) return;
      done = true;
      const uRef = root.get('u') as Y.Map<unknown>;
      uRef.delete('k'); // 删除宽成员声明键 → real 侧产物 {u:{x:1}}（仲裁漂移窄成员）vs scratch {u:{x:1,k:2}}
    });
    // 当前实现无 ⑥ → ok:true → 红（SA3 对称重物化：全键集比较立判 → E201-C）
    expect(() => materializeRoot(derived, SNAP_WIDE_NARROW, doc)).toThrow(/DOCRT-E201/);
  });

  it('D1 诚实对照：无 observer → ok:true + extract 投影 {u:{x:1,k:2}}', () => {
    const derived = derivedOf(VFSL_WIDE_NARROW);
    const doc = new Y.Doc();
    const result = materializeRoot(derived, SNAP_WIDE_NARROW, doc) as MaterializeResult;
    expect(result.ok).toBe(true);
    const ex = extractYjsSnapshot(derived, doc);
    expect(ex.ok).toBe(true);
    if (!ex.ok) {
      throw new Error(`期望提取成功，实际失败：${JSON.stringify(ex.issues)}`);
    }
    expect(ex.snapshot).toEqual(SNAP_WIDE_NARROW);
  });

  it('D2：判别联合经 ref 删除成员独有字段——assetRef.delete(\'body\') → toThrow(/DOCRT-E201/)（vfs3.assets 同款 idiom）', () => {
    const derived = derivedOf(VFSL_ASSET_UNION);
    expect(validateLogicalSnapshot(derived, SNAP_ASSET).ok).toBe(true);
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    let done = false;
    root.observe(() => {
      if (done) return;
      done = true;
      const asset = root.get('asset') as Y.Map<unknown>;
      asset.delete('body'); // text 成员独有字段被删 → 双成员软拒 → extract 回退成员 0，产物键集缩水
    });
    expect(() => materializeRoot(derived, SNAP_ASSET, doc)).toThrow(/DOCRT-E201/);
  });

  it('D2 诚实对照：无 observer → ok:true + extract 产物含 body 且语义等价', () => {
    const derived = derivedOf(VFSL_ASSET_UNION);
    const doc = new Y.Doc();
    const result = materializeRoot(derived, SNAP_ASSET, doc) as MaterializeResult;
    expect(result.ok).toBe(true);
    const ex = extractYjsSnapshot(derived, doc);
    expect(ex.ok).toBe(true);
    if (!ex.ok) {
      throw new Error(`期望提取成功，实际失败：${JSON.stringify(ex.issues)}`);
    }
    const s = ex.snapshot as { asset: { kind: string; body: string } };
    expect(s.asset.kind).toBe('text');
    expectXmlSemanticallyEqual(s.asset.body, '<p>hello</p>');
  });
});
