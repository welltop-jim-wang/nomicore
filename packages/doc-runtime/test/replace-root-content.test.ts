/**
 * SA6 红灯测试 — @nomicore/doc-runtime replaceRootContent(derived, snapshot, doc)
 * —— 原子 ROOT-content replacement helper（issue #88，功能开发）。
 *
 * 契约来源：
 * - 任务简报 wiki/raw/task_doc-runtime-atomic-root-replace.md（Issue #88 AC-1~AC-8）：
 *   将 materialization 的 detached 构造能力收敛为包内可复用 seam，并提供保留顶层
 *   `doc.getMap('ROOT')` identity 的原子内容替换能力。
 * - docs/adr/0008（本任务直接授权来源）：
 *   - 「3. SCHEMA replacement 可复用 detached builder 与原子 ROOT-content replacement
 *     helper，不复制 materialization 逻辑。」
 *   - 「提供完整 ROOT 时保留顶层 `doc.getMap('ROOT')` identity，在同一 transaction 内
 *     清空并安装已 detached 构造的内容；其下旧 Yjs 子类型 identity 可失效。」
 *   - 「新 SCHEMA 的编译、最终 ROOT 校验或 detached 构造失败均发生在 transaction 前，
 *     SCHEMA/ROOT 零写入，active tools 不变。」
 *   - 「任何 internal fatal——无论 committed 与否……不补偿、不 fallback、不声称 rollback」；
 *     「不是业务公共 API」封装边界（「Runtime 不公开 handle、Y.Doc、ROOT/SCHEMA/META
 *     live 引用或生产构造器」；ADR-0007「不公开可跨时间执行的 prepared mutation，避免
 *     TOCTOU」）。
 * - docs/adr/0007（继续有效部分）：「materializeRoot……内部先执行 validateLogicalSnapshot，
 *   再构造未集成到任何 doc 的 detached Yjs 子树」；「零写入承诺覆盖所有验证失败和 detached
 *   构造失败」；「事务开始后若未知 observer 抛错，视为 Runtime internal/fatal，不虚假声称
 *   自动回滚，也不尝试 fallback」；「XML string 与 Y.XmlFragment 只承诺语义等价
 *   round-trip，不承诺字符串逐字相同」。
 * - docs/adr/0003：map→Y.Map、array→Y.Array、xml-fragment→Y.XmlFragment、plain→纯值；
 *   ROOT 固定物化为 Y.Map（doc.getMap('ROOT')）。
 *
 * 本文件是 SA3 实现的唯一行为锚点（SA1 设计不得收窄下列可观测契约，仅可补充）：
 * - 公共接缝：`replaceRootContent(derived: DerivedSchema, snapshot: unknown, doc: Y.Doc)`
 *   经 `packages/doc-runtime/src/index.ts` 包公共入口导出（与 materializeRoot 同文件同款
 *   `exports["."] = "./src/index.ts"`）；同步、可预期失败经返回值传递（领域化结果联合，
 *   ADR-0008「普通、可预期且零写入的失败使用领域化结果联合」）。
 * - 结果联合（沿仓内 extractYjsSnapshot / materializeRoot 惯例）：
 *   `{ ok: true } | { ok: false; issues: ReplaceIssue[] }`——逻辑校验失败保留**完整**
 *   issues（与 validateLogicalSnapshot 直调结果逐条一致）；materialization 失败**恰 1 条**
 *   issue（fail-fast）。
 * - AC-1（复用同一 detached builder，不复制 Y.Map/Y.Array/XML/plain 构造规则）：
 *   同一输入分别经 materializeRoot 与 replaceRootContent 安装后，extractYjsSnapshot 读回
 *   全等（等价锚）；同一构造失败输入的失败面（issue message + path）两入口逐条一致。
 * - AC-2（detached builder 为包内能力，不作为业务公共 API / 可跨时间执行的 prepared
 *   mutation 暴露）：包公共入口导出面恰为四个已文档化接缝（无 builder/seam 泄漏）；
 *   replaceRootContent 同步完结、返回结算结果联合（无 deferred/prepared 句柄），同参
 *   二次调用无跨调用捕获状态。
 * - AC-3（完整验证 + detached 构造成功后，才允许 transaction 内清空并安装）：逻辑校验
 *   失败与构造失败均先于任何事务（0 update 事件、state 逐字节不变、旧 ROOT 内容原封不动）；
 *   成功路径恰 1 次 update 事件（单 transaction 清空 + 安装）。
 * - AC-4（顶层 doc.getMap('ROOT') identity 保持，旧子类型 identity 可失效）：替换后
 *   `doc.getMap('ROOT')` 与调用前严格同一实例（===）；旧 Yjs 子类型（Y.Map/Y.Array/
 *   Y.XmlFragment）引用即失效（新实例替换、快照外键清除）。
 * - AC-5（前置验证/构造失败零变化）：0 'update' 事件 + Y.encodeStateAsUpdate 逐字节不变。
 * - AC-6（transaction observer/fatal 服从 committed-aware no-rollback 契约）：事务内未知
 *   observer 抛错 → 错误 loud 原样传播（toThrow('observer-boom')），不吞并成伪 ok:true /
 *   伪回滚结果；写入已实际提交（update 已发出、新值已落盘——不虚假回滚）；事务内 observer
 *   同步重入（不抛错）→ 写后偏离不得以 ok:true 返回（throw DOCRT-E201 家族——W1 唯一相容
 *   形态），且不补偿、不声称回滚（doc 保持 observer 留下的实际状态）。
 * - AC-7（行为覆盖空/非空 ROOT、全部载体种类、构造失败、observer 边界）：见下述分组。
 *
 * 红灯现状（构造性红灯，同 materialize-root.test.ts 先例）：`replaceRootContent` 尚未
 * 实现/未从包入口导出，本文件静态具名 import 在 vitest 收集阶段即失败（"does not provide
 * an export named 'replaceRootContent'"），全部用例红；SA1 设计、SA3 实现并导出后转绿。
 * 本文件不预设实现内部结构（不读源码、不 grep 文本形状），全部断言锚定
 * replaceRootContent 的可观测输出。
 *
 * 断言纪律（与 materialize-root.test.ts 同款）：
 * - 黑盒可观测输出锚定，不读源码、不 grep 实现文本；
 * - observer 一律 one-shot（G8：无 guard 重入写 → 引擎无限递归 RangeError）；
 * - XML 断言经语义归一化比较器（CDATA/PI/comment = 不透明逐字 span token；属性排序 +
 *   引号归一 + 显式闭合），禁逐字断言（W2/W3）。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { evaluate, parseVfsl, validateLogicalSnapshot } from '@nomicore/vfsl';
import type { DerivedSchema } from '@nomicore/vfsl';
// 构造性红灯：replaceRootContent 尚未实现/导出（materializeRoot 为已实现对照物，仅 G5 组用）。
import { extractYjsSnapshot, materializeRoot, replaceRootContent } from '../src/index.js';

// —— 测试契约类型（任务简报 AC + ADR-0008 冻结；与 materializeRoot 同形惯例）——

/** 替换 issue：message 非空字符串；path 段数组（materialization 失败恰 1 条——fail-fast）。 */
interface ReplaceIssue {
  message: string;
  path: Array<string | number>;
}

type ReplaceResult =
  | { ok: true }
  | { ok: false; issues: ReplaceIssue[] };

/** materializeRoot 结果（G5 等价对照用；与仓内导出类型同形）。 */
interface MaterializeIssue {
  message: string;
  path: Array<string | number>;
}

type MaterializeResult =
  | { ok: true }
  | { ok: false; issues: MaterializeIssue[] };

// —— 测试辅助 ——

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

/** 'update' 事件计数器（AC-3/AC-5 单事务/零写入锚）。 */
function countUpdates(doc: Y.Doc): { count: number } {
  const counter = { count: 0 };
  doc.on('update', () => {
    counter.count += 1;
  });
  return counter;
}

// —— XML 语义等价比较器（W2/W3 合规落地件，测试局部 helper；materalize-root.test.ts 同款设计）——
//
// 两侧各过一遍测试侧 mini 扫描器（token 识别：元素 / 属性（单双引号等价、重复属性
// last-wins 入 Map）/ 文本 run / 注释·CDATA·PI 不透明逐字 token）产出 token 树 →
// canonical 序列化（属性按名排序、一律双引号、self-closing 统一显式闭合、不透明 token
// 逐字输出）→ canonical 串全等。覆盖实测 yjs 投影差异（引号重排 / 字母序 / 闭合展开 /
// last-wins），不锁 yjs 序列化器输出（ADR-0007「只承诺语义等价」）。禁止逐字断言投影形态。

type XmlTok =
  | { type: 'text'; text: string } // 文本 run（逐字，不解码、不折叠空白）
  | { type: 'span'; text: string } // 注释 / CDATA / PI（不透明逐字 token）
  | { type: 'element'; name: string; attrs: Array<[string, string]>; children: XmlTok[] };

function expectXmlSemanticallyEqual(actual: string, expected: string): void {
  expect(canonicalXml(actual)).toBe(canonicalXml(expected));
}

function canonicalXml(s: string): string {
  return scanXmlTokens(s).map(renderXmlTok).join('');
}

function renderXmlTok(t: XmlTok): string {
  if (t.type !== 'element') return t.text; // 文本与不透明 span 逐字
  const attrs = [...t.attrs].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)); // 按名排序
  const attrStr = attrs.map(([k, v]) => ` ${k}="${v}"`).join(''); // 一律双引号
  return `<${t.name}${attrStr}>${t.children.map(renderXmlTok).join('')}</${t.name}>`; // 显式闭合
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
      flushText(i); // 闭合标签起点即冲刷点：尾部文本 run 属于被关元素（与 xml-parse.ts 同款）
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
        attrs.set(attrName, s.slice(j + 1, end)); // 重复属性 last-wins（§4.4）
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
      throw new Error(`XML 比较器：裸 "<" 标记：${s}`);
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

// —— fixtures：全载体种类（map/array/xml-fragment/leaf/plain/union/ref/Record，ADR-0003）——

const VFSL_RICH = [
  'type Audit = YMap<{ createdBy: YLeaf<string>; createdAt: YLeaf<number> }>;',
  'type AssetEntity =',
  '  | { kind: "image"; url: YLeaf<string>; width: YLeaf<number>; height: YLeaf<number>; audit: Audit }',
  '  | { kind: "text"; body: YXmlFragment<{ p: string }>; audit: Audit }',
  '  | { kind: "file"; name: YLeaf<string>; size: YLeaf<number>; tags: YArray<YLeaf<string>>; audit: Audit };',
  'type ROOT = YMap<{',
  '  assets: Record<string, AssetEntity>;',
  '  attachments: YPlainArray<YLeaf<string>>;',
  '  audit: Audit;',
  '  keywords: YArray<YLeaf<string>>;',
  '}>;',
].join('\n');

const SNAP_NEW = {
  assets: {
    img1: { kind: 'image', url: 'https://cdn/x.png', width: 640, height: 480, audit: { createdBy: 'alice', createdAt: 111 } },
    doc1: { kind: 'text', body: '<p b="2" a=\'1\'>hello</p>', audit: { createdBy: 'bob', createdAt: 222 } },
  },
  attachments: ['x', 'y'],
  audit: { createdBy: 'root', createdAt: 999 },
  keywords: ['k1', 'k2'],
};

/** G5 等价对照的提取产物形状（粗类型——仅断言读回 JSON 形状）。 */
interface AssetSnap {
  kind: string;
  url?: string;
  body?: string;
  name?: string;
  width?: number;
  height?: number;
  size?: number;
  tags?: string[];
  audit: { createdBy: string; createdAt: number };
}

interface RichSnap {
  assets: Record<string, AssetSnap>;
  attachments: string[];
  audit: { createdBy: string; createdAt: number };
  keywords: string[];
}

// ============================================================================
// G1（AC-4 + AC-3）：非空 ROOT 原子替换 + 顶层 identity 保留 + 旧子类型 identity 失效
// ============================================================================

describe('replaceRootContent — G1（AC-4/AC-3）：非空 ROOT 在单 transaction 内清空并安装新内容', () => {
  it('非空 ROOT：ok:true + 顶层 doc.getMap(\'ROOT\') identity 保持 + 旧子类型 identity 失效 + 恰 1 次 update + 读回与新快照等价', () => {
    const derived = derivedOf(VFSL_RICH);
    expect(validateLogicalSnapshot(derived, SNAP_NEW).ok).toBe(true); // 前置：新快照逻辑合法

    // 手工 yjs 构造旧内容（与结构树同形但值不同 + 一个快照外键 stale）
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    const oldAudit = new Y.Map<unknown>();
    oldAudit.set('createdBy', 'old-root');
    oldAudit.set('createdAt', 1);

    const oldFileTags = new Y.Array<unknown>();
    oldFileTags.insert(0, ['old-a', 'old-b']);
    const oldFileOwnTags = new Y.Array<unknown>(); // 防回归：每实例恰集成一次（yjs 二次集成 _prelimContent=null 崩溃）
    oldFileOwnTags.insert(0, ['old-a', 'old-b']);
    const oldFileAudit = new Y.Map<unknown>();
    oldFileAudit.set('createdBy', 'old-carol');
    oldFileAudit.set('createdAt', 2);
    const oldFile = new Y.Map<unknown>();
    oldFile.set('kind', 'file');
    oldFile.set('name', 'old.txt');
    oldFile.set('size', 5);
    oldFile.set('tags', oldFileOwnTags);
    oldFile.set('audit', oldFileAudit);

    const oldTextAudit = new Y.Map<unknown>();
    oldTextAudit.set('createdBy', 'old-bob');
    oldTextAudit.set('createdAt', 3);
    const oldBody = new Y.XmlFragment();
    oldBody.insert(0, [new Y.XmlElement('old')]);
    const oldText = new Y.Map<unknown>();
    oldText.set('kind', 'text');
    oldText.set('body', oldBody);
    oldText.set('audit', oldTextAudit);

    const oldAssets = new Y.Map<unknown>();
    oldAssets.set('file1', oldFile);
    oldAssets.set('text1', oldText);

    root.set('assets', oldAssets);
    root.set('attachments', ['old1', 'old2']); // plain array（纯值）
    root.set('audit', oldAudit);
    root.set('keywords', oldFileTags); // 复用 array 实例作为旧 keywords
    root.set('stale', 42); // 快照外键：替换后必须消失
    const rootIdentity = doc.getMap('ROOT'); // 顶层身份捕获（与 root 同一实例）

    const events = countUpdates(doc);
    const result = replaceRootContent(derived, SNAP_NEW, doc) as ReplaceResult;
    expect(result.ok).toBe(true);

    // AC-4 顶层 identity：与调用前严格同一 Y.Map 实例
    expect(doc.getMap('ROOT')).toBe(rootIdentity);
    // AC-4 旧子类型 identity 失效：新实例替换、旧引用不再可达
    expect(root.get('assets')).not.toBe(oldAssets);
    expect(root.get('audit')).not.toBe(oldAudit);
    expect(root.get('keywords')).not.toBe(oldFileTags);
    expect(root.get('stale')).toBeUndefined(); // 清空安装：快照外键已清除

    // AC-3 单 transaction：恰 1 次 update 事件
    expect(events.count).toBe(1);

    // 读回：全部载体种类（map/array/xml/plain/leaf/union/ref/Record）与新快照等价
    const ex = extractYjsSnapshot(derived, doc);
    expect(ex.ok).toBe(true);
    if (!ex.ok) throw new Error(`期望提取成功，实际失败：${JSON.stringify(ex.issues)}`);
    const s = ex.snapshot as RichSnap;
    expect(Object.keys(s.assets).sort()).toEqual(['doc1', 'img1']);
    expect(s.assets['img1']).toEqual({
      kind: 'image',
      url: 'https://cdn/x.png',
      width: 640,
      height: 480,
      audit: { createdBy: 'alice', createdAt: 111 },
    });
    expect(s.assets['doc1']?.kind).toBe('text');
    expect(s.assets['doc1']?.audit).toEqual({ createdBy: 'bob', createdAt: 222 });
    expectXmlSemanticallyEqual(s.assets['doc1']?.body ?? '', SNAP_NEW.assets.doc1.body); // XML 语义等价（W2/W3）
    expect(s.attachments).toEqual(['x', 'y']);
    expect(s.audit).toEqual({ createdBy: 'root', createdAt: 999 });
    expect(s.keywords).toEqual(['k1', 'k2']);

    // 新内容整体可再次通过逻辑校验（安装产物 = 完整 logical ROOT snapshot）
    expect(validateLogicalSnapshot(derived, ex.snapshot).ok).toBe(true);
  });
});

// ============================================================================
// G2（AC-7）：空 ROOT / 缺席 ROOT happy path
// ============================================================================

describe('replaceRootContent — G2（AC-7）：空与缺席 ROOT 均为 happy path', () => {
  it('空 ROOT（已存在空 Y.Map）→ ok:true + 读回等价 + 恰 1 次 update', () => {
    const derived = derivedOf('type ROOT = { title: YLeaf<string>; count: YLeaf<number> };');
    const doc = new Y.Doc();
    doc.getMap('ROOT'); // 空 ROOT（惰性创建，零 update）
    const root = doc.getMap('ROOT');
    const events = countUpdates(doc);
    const result = replaceRootContent(derived, { title: 't', count: 7 }, doc) as ReplaceResult;
    expect(result.ok).toBe(true);
    expect(events.count).toBe(1); // 单事务
    const ex = extractYjsSnapshot(derived, doc);
    expect(ex.ok).toBe(true);
    if (!ex.ok) throw new Error(`期望提取成功，实际失败：${JSON.stringify(ex.issues)}`);
    expect(ex.snapshot).toEqual({ title: 't', count: 7 });
    expect(root.get('title')).toBe('t');
  });

  it('缺席 ROOT（全新 doc，探针惰性创建）→ ok:true + ROOT 恰好新键 + 恰 1 次 update', () => {
    const derived = derivedOf('type ROOT = { title: YLeaf<string> };');
    const doc = new Y.Doc(); // ROOT 完全缺席
    const events = countUpdates(doc);
    const result = replaceRootContent(derived, { title: 'fresh' }, doc) as ReplaceResult;
    expect(result.ok).toBe(true);
    expect(events.count).toBe(1);
    const root = doc.getMap('ROOT');
    expect(root.get('title')).toBe('fresh');
    expect(root.size).toBe(1); // 恰好新键
  });
});

// ============================================================================
// G3（AC-5 + AC-3）：前置验证/构造失败 → 零写入（0 update + 字节不变 + 旧内容原封不动）
// ============================================================================

describe('replaceRootContent — G3（AC-5/AC-3）：前置失败零写入', () => {
  it('逻辑校验失败 → ok:false 且 issues 与 validateLogicalSnapshot 直调逐条一致；0 update + 字节不变 + 旧 ROOT 内容原封不动', () => {
    const derived = derivedOf('type ROOT = { a: YLeaf<string>; b: YLeaf<number> };');
    const bad = { a: 123, b: 'x', extra: 1 }; // 类型错 ×2 + 未知键 ×1（AC-1 同款多违规）
    const direct = validateLogicalSnapshot(derived, bad);
    expect(direct.ok).toBe(false);
    let directIssues: ReplaceIssue[] = [];
    if (!direct.ok) {
      directIssues = direct.issues;
      expect(direct.issues.length).toBeGreaterThanOrEqual(2); // 前置确认多违规
    }
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    root.set('a', 'old'); // 旧内容（种子）
    root.set('b', 1);
    const before = stateBytes(doc);
    const events = countUpdates(doc);
    const result = replaceRootContent(derived, bad, doc) as ReplaceResult;
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('期望失败，实际成功');
    //「保留完整 issues」：与直调 validateLogicalSnapshot 逐条一致（内容 + 顺序）
    expect(result.issues).toEqual(directIssues);
    // 零写入双证：0 update 事件 + state 逐字节不变；旧内容未被触碰
    expect(events.count).toBe(0);
    expect(stateBytes(doc)).toEqual(before);
    expect(root.get('a')).toBe('old');
    expect(root.get('b')).toBe(1);
  });

  it('detached 构造失败（NaN 通过 ① 逻辑校验、② 构造域拒绝）→ ok:false 恰 1 issue + 0 update + 字节不变 + 旧内容原封不动', () => {
    const derived = derivedOf('type ROOT = { title: YLeaf<string>; count: YLeaf<number> };');
    const bad = { title: 't', count: Number.NaN };
    expect(validateLogicalSnapshot(derived, bad).ok).toBe(true); // 前置：① 通过（NaN 属 number 类型面）
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    root.set('title', 'old');
    root.set('count', 1);
    const before = stateBytes(doc);
    const events = countUpdates(doc);
    const result = replaceRootContent(derived, bad, doc) as ReplaceResult;
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('期望失败，实际成功');
    expect(result.issues).toHaveLength(1); // materialization 失败 fail-fast 单 issue
    expect(result.issues[0]?.path).toEqual(['count']);
    expect(result.issues[0]?.message).toContain('non-finite number'); // 六词同表词（CONTEXT.md 标记类型惯例）
    expect(events.count).toBe(0);
    expect(stateBytes(doc)).toEqual(before);
    expect(root.get('title')).toBe('old'); // 0 update + 字节不变：旧内容原封不动
    expect(root.get('count')).toBe(1);
  });

  it('ROOT 载体非 Y.Map（Y.Array）→ ok:false 恰 1 issue（[] 路径）+ 0 update + 字节不变', () => {
    const derived = derivedOf('type ROOT = { title: YLeaf<string> };');
    const doc = new Y.Doc();
    doc.getArray('ROOT'); // 异型 ROOT（Y.Array）
    const before = stateBytes(doc);
    const events = countUpdates(doc);
    const result = replaceRootContent(derived, { title: 't' }, doc) as ReplaceResult;
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('期望失败，实际成功');
    expect(result.issues).toHaveLength(1); // fail-fast
    expect(result.issues[0]?.path).toEqual([]); // [] 即 ROOT 自身
    expect(events.count).toBe(0);
    expect(stateBytes(doc)).toEqual(before);
  });
});

// ============================================================================
// G4（AC-6）：transaction observer/fatal 服从 committed-aware no-rollback 契约
// ============================================================================

describe('replaceRootContent — G4（AC-6）：observer 边界 committed-aware no-rollback', () => {
  it('事务内未知 observer 抛错 → 错误 loud 原样传播（toThrow("observer-boom")）+ 不虚假回滚（update 已发出、新值已落盘）', () => {
    const derived = derivedOf('type ROOT = { title: YLeaf<string>; count: YLeaf<number> };');
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    root.set('title', 'old');
    root.set('count', 1);
    const events = countUpdates(doc);
    let observeCalls = 0;
    root.observe(() => {
      observeCalls += 1;
      throw new Error('observer-boom');
    });
    // ADR-0007 失败边界：事务开始后未知 observer 抛错 → 错误 loud 传播，绝不吞并成伪
    // ok:true / 伪「已回滚」结果（原样传播契约——异常须为 observer 原始错误）。
    expect(() => replaceRootContent(derived, { title: 'new', count: 7 }, doc)).toThrow('observer-boom');
    expect(observeCalls).toBe(1); // yjs 单事务恰一次 type-observer 回调
    // committed-aware no-rollback：写入已实际提交（update 已发出、新值已落盘），不虚假回滚
    expect(events.count).toBe(1);
    expect(root.get('title')).toBe('new');
    expect(root.get('count')).toBe(7);
  });

  it('事务内 observer 同步重入不抛错（delete 计划键）→ 写后偏离不得以 ok:true 返回（throw E201 家族）+ 不补偿、不声称回滚', () => {
    const derived = derivedOf('type ROOT = { title: YLeaf<string>; count: YLeaf<number> };');
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    root.set('title', 'old');
    root.set('count', 1);
    let done = false;
    root.observe(() => {
      if (done) return; // one-shot（G8 纪律）
      done = true;
      root.delete('count'); // 清除后、安装后同步删除计划键 → 最终内容偏离新快照
    });
    // W1 唯一相容形态：写后偏离 → throw E201 家族（不返回 ok:false——事务已提交；不补偿；
    // 不声称已回滚——doc 保持 observer 留下的实际状态）。
    expect(() => replaceRootContent(derived, { title: 'new', count: 7 }, doc)).toThrow(/DOCRT-E201/);
    expect(root.get('title')).toBe('new'); // 首事务已提交（no-rollback）
    expect(root.get('count')).toBeUndefined(); // 保持 observer 留下的实际状态（无补偿修复）
  });
});

// ============================================================================
// G5（AC-1）：与 materializeRoot 复用同一 detached 构造管线（等价锚）
// ============================================================================

describe('replaceRootContent — G5（AC-1）：与 materializeRoot 共享同一 detached builder（行为等价锚）', () => {
  it('同一输入分别经 materializeRoot 与 replaceRootContent 安装 → extract 读回全等（map/array/xml/plain/leaf/union/ref/Record 全载体）', () => {
    const derived = derivedOf(VFSL_RICH);
    expect(validateLogicalSnapshot(derived, SNAP_NEW).ok).toBe(true);
    const docMat = new Y.Doc();
    const mat = materializeRoot(derived, SNAP_NEW, docMat) as MaterializeResult;
    expect(mat.ok).toBe(true);
    const docRep = new Y.Doc();
    const rep = replaceRootContent(derived, SNAP_NEW, docRep) as ReplaceResult;
    expect(rep.ok).toBe(true);

    const exMat = extractYjsSnapshot(derived, docMat);
    const exRep = extractYjsSnapshot(derived, docRep);
    expect(exMat.ok).toBe(true);
    expect(exRep.ok).toBe(true);
    if (!exMat.ok || !exRep.ok) {
      throw new Error(`期望双侧提取成功：mat=${JSON.stringify(exMat)} rep=${JSON.stringify(exRep)}`);
    }
    // 同管线双侧读回全等（构造规则复用的行为锚：复制规则若有任何 Y.Map/Y.Array/XML/plain
    // 细节漂移，双侧读回即发散）
    expect(exRep.snapshot).toEqual(exMat.snapshot);
    // 读回与输入语义等价（XML 经语义比较器，W2/W3）
    const s = exRep.snapshot as RichSnap;
    expect(s.assets['img1']).toEqual({
      kind: 'image',
      url: 'https://cdn/x.png',
      width: 640,
      height: 480,
      audit: { createdBy: 'alice', createdAt: 111 },
    });
    expectXmlSemanticallyEqual(s.assets['doc1']?.body ?? '', SNAP_NEW.assets.doc1.body);
    expect(s.attachments).toEqual(['x', 'y']);
    expect(s.keywords).toEqual(['k1', 'k2']);
    expect(s.audit).toEqual({ createdBy: 'root', createdAt: 999 });
  });

  it('同一构造失败输入 → 两入口 ok:false 的 issues 逐条一致（message + path 全等）——同一失败面的构造规则等价锚', () => {
    const derived = derivedOf('type ROOT = { title: YLeaf<string>; count: YLeaf<number> };');
    const bad = { title: 't', count: Number.NaN };
    expect(validateLogicalSnapshot(derived, bad).ok).toBe(true); // ① 通过
    const docMat = new Y.Doc();
    const mat = materializeRoot(derived, bad, docMat) as MaterializeResult;
    const docRep = new Y.Doc();
    const rep = replaceRootContent(derived, bad, docRep) as ReplaceResult;
    expect(mat.ok).toBe(false);
    expect(rep.ok).toBe(false);
    if (mat.ok || rep.ok) throw new Error('期望两侧均失败');
    // 共享构造规则的失败面等价：message + path 逐条一致（独立复制实现任何细节漂移即发散）
    expect(rep.issues).toEqual(mat.issues as ReplaceIssue[]);
  });
});

// ============================================================================
// G6（AC-2）：detached builder 为包内能力，不作为公共 API / prepared mutation 暴露
// ============================================================================

describe('replaceRootContent — G6（AC-2）：包内 seam 封装边界', () => {
  it('包公共入口（src/index.ts）导出面恰为四个已文档化接缝——无 detached builder / prepared mutation 泄漏', async () => {
    const pkg = await import('../src/index.js');
    // 黑盒模块级断言（运行时公共面；类型导出被擦除，不在键集中）：
    // 若 SA3 把 detached builder seam 或其他内部能力暴露为公共 API，此处变红。
    expect(Object.keys(pkg).sort()).toEqual([
      'extractYjsSnapshot',
      'materializeRoot',
      'readLogicalValueAtPath',
      'replaceRootContent',
    ]);
  });

  it('replaceRootContent 同步完结并返回结算结果联合（{ok:true} 无附加句柄）；同参二次调用无跨调用捕获状态', () => {
    const derived = derivedOf('type ROOT = { title: YLeaf<string> };');
    const doc = new Y.Doc();
    const first = replaceRootContent(derived, { title: 't1' }, doc) as ReplaceResult;
    expect(first).toEqual({ ok: true }); // 无 deferred/prepared 句柄字段（toEqual 精确形状）
    const second = replaceRootContent(derived, { title: 't1' }, doc) as ReplaceResult;
    expect(second).toEqual({ ok: true }); // 同一输入再次执行：无跨调用捕获状态（无 TOCTOU 准备物）
    expect(doc.getMap('ROOT').get('title')).toBe('t1');
  });
});

// ============================================================================
// G7（AC-3/AC-6 事务纪律）：未闭合外层 doc.transact 内调用 → 与 materializeRoot 同款 ⓪ 拒绝
// ============================================================================

describe('replaceRootContent — G7（事务纪律）：未闭合外层事务内调用 → 零写入 loud 拒绝', () => {
  it('外层 doc.transact 未闭合 → 任何写入前 loud fail（throw DOCRT-E202）+ 0 update + 字节不变 + 旧 ROOT 内容原封不动', () => {
    const derived = derivedOf('type ROOT = { title: YLeaf<string>; count: YLeaf<number> };');
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    root.set('title', 'old');
    root.set('count', 1);
    const before = stateBytes(doc);
    const events = countUpdates(doc);
    // 与 materializeRoot rev2/RD7-P1 同款前置 guard：内部事务并入外层 → 单事务承诺与
    // 写后校验窗口失效 → 任何写入前 loud 拒绝（本函数零写入）。
    expect(() => {
      doc.transact(() => {
        replaceRootContent(derived, { title: 'new', count: 7 }, doc);
      });
    }).toThrow(/DOCRT-E202/);
    expect(events.count).toBe(0); // 拒绝先于一切事务
    expect(stateBytes(doc)).toEqual(before); // 零写入双证
    expect(root.get('title')).toBe('old'); // 旧内容原封不动
    expect(root.get('count')).toBe(1);
  });
});
