/**
 * SA6 红灯测试 — @nomicore/doc-runtime materializeRoot(derived, snapshot, doc)（issue #74，功能开发）。
 *
 * 契约来源：
 * - 任务简报 wiki/raw/task_doc-runtime-materialize-root.md（Issue #74，AC-1~AC-6）：
 *   `materializeRoot(derived, snapshot, doc)` 是唯一公共物化入口——内部先执行
 *   validateLogicalSnapshot，再构造未集成到任何 doc 的 detached Yjs 子树，确认目标 ROOT
 *   为空后以一次 Y.transact 安装；验证或构造失败时目标 doc 零写入；不覆盖、不合并、
 *   不 fallback。
 * - docs/adr/0007（逻辑验证与 Yjs Runtime Bridge 分层）：「逻辑校验保留完整 issues，
 *   Yjs 结构与路径/操作错误 fail-fast」；「零写入承诺覆盖所有验证失败和 detached 构造
 *   失败」；「事务开始后若未知 observer 抛错，视为 Runtime internal/fatal，不虚假声称
 *   自动回滚，也不尝试 fallback」；「XML string 与 Y.XmlFragment 只承诺语义等价
 *   round-trip，不承诺字符串逐字相同」。
 * - docs/adr/0003（派生 schema 结构树）：map→Y.Map、array→Y.Array、xml-fragment→
 *   Y.XmlFragment、plain（YPlainArray）→纯值；ROOT 固定物化为 Y.Map（doc.getMap('ROOT')）。
 * - docs/adr/0006（doc 三条目布局）：materializeRoot 只写 ROOT 子树，SCHEMA/META 是
 *   兄弟条目、不在本能力写入面内。
 *
 * 本文件是 SA3 实现的唯一行为锚点（SA1 设计不得收窄下列可观测契约，仅可补充）：
 * - 公共接缝：`materializeRoot(derived: DerivedSchema, snapshot: unknown, doc: Y.Doc)`
 *   经 `packages/doc-runtime/src/index.ts` 包公共入口导出（与 extractYjsSnapshot 同文件
 *   同款 `exports["."] = "./src/index.ts"`）；同步、错误经返回值传递。
 * - 结果联合（沿仓内 extractYjsSnapshot / validateLogicalSnapshot 的 `{ ok, issues }`
 *   惯例）：`{ ok: true } | { ok: false; issues: MaterializeIssue[] }`——
 *   AC-1 逻辑校验失败保留**完整** issues（全收集，与 validateLogicalSnapshot 直调结果
 *   完全一致）；物化失败（如目标 ROOT 非空）**恰 1 条** issue（materialization 侧
 *   fail-fast，ADR-0007「Yjs 结构与路径/操作错误 fail-fast」）。
 * - AC-2：目标 ROOT 非空 → 响亮失败（ok:false + 单 issue），不 overwrite、不 merge、
 *   不 fallback（失败后 doc 状态逐字节不变、零 update 事件）。ROOT 缺席/为空 → 成功。
 * - AC-3：物化子树载体严格按结构树：map→Y.Map、array→Y.Array、xml-fragment→
 *   Y.XmlFragment、plain→纯值深拷贝（与输入快照引用隔离，输入再突变不影响 doc）。
 * - AC-4：全部构造成功后单次 transaction 安装（成功路径恰 1 次 'update' 事件）；任何
 *   前置失败（逻辑校验失败 / ROOT 非空）→ 0 次 'update' 事件且 state 逐字节不变。
 * - AC-5：XML string 物化后经 extractYjsSnapshot 提取，提取值可再次通过
 *   validateLogicalSnapshot；与输入只承诺语义等价（归一化比较），不要求逐字相同。
 * - AC-6：事务期间未知 observer 抛错 → 错误 loud 传播（toThrow），绝不吞并成伪
 *   ok:true 或「已回滚」的失败结果；且不虚假回滚（写入已实际提交：update 已发出、
 *   ROOT 值已落盘——yjs 实证 observer 抛错不触发事务回滚，本测试不承诺回滚）。
 *
 * fixture 构建纪律（实证自 yjs@13.6.32，见 .mabf/scratch-yjs.mjs 验证）：
 * - `doc.getMap('ROOT')` 惰性创建空 map：零 update 事件、state 不变（AC-4 零写入
 *   断言的前提）；空/惰性 map 的 .size/.keys() 可安全读取（非 'Invalid access'）；
 * - detached 子树类型在集成到 doc 前不可读取内容（yjs 'Invalid access'），故 AC-3/AC-4
 *   只断言物化**后**的 doc 侧载体与内容（构造内部实现不预设）；
 * - `ymap.set(k, plainObj)` 以**引用**存储（实证 stored === input），plain 深拷贝契约
 *   因此必须用「物化后突变输入 → doc 不变」的行为断言锚定，而非仅类型检查；
 * - 事务内 observer 抛错：错误经 Y.transact 传播、update 事件仍发出、值不回滚。
 *
 * 红灯现状（构造性红灯，同 extract-yjs-snapshot.test.ts 先例）：`materializeRoot` 尚
 * 未实现/未从包入口导出，本文件静态具名 import 在 vitest 收集阶段即失败（"does not
 * provide an export named 'materializeRoot'"），全部用例红。SA3 实现并导出后转绿；
 * 本文件不预设实现内部结构（不读源码、不 grep 文本形状），全部断言锚定
 * materializeRoot 的可观测输出。
 *
 * —— rev1（PR #84 owner Review 修订轮；设计 wiki/raw/task_doc-runtime-materialize-root-rev1_design.md）——
 * - RAC-1（P1/RD1）：`ok:true` 语义升级为 INV-2 + INV-10——本函数返回时 ROOT 顶层恰为计划
 *   键集且逐键值与安装值严格同一（契约前提：本函数事务必须是 doc 的**最外层事务**，R-7）。
 *   ⑤ verifyInstall 在事务正常返回后、`return {ok:true}` 前检测顶层偏离（delete / overwrite /
 *   insert extra / 组合），偏离 → throw `DOCRT-E201`（F11：不回滚、不补偿、不返回 ok:false）。
 *   R1 组 E201 偏离检测用例在 SA3 实现 ⑤ 之前为**行为性红灯**（现实现④后无条件返回 ok:true）。
 * - RAC-2（RD2）：detached 构造失败（逻辑校验已通过）→ ok:false + 恰 1 issue + 0 update +
 *   state 字节不变（原子性主锚，§3.3）；10 行矩阵（unknown 位 Date/bigint/NaN/±Infinity/
 *   Y.Map/Y.Array/数组内 undefined + number 标量位 NaN）；XML attr-`"` 构造期拒绝行
 *   （原 C-8/X-F9）已按 issue #94 AC-⑥ 删除——新契约见 test/xml-attr-quote-domain.test.ts。
 * - RAC-3（RD3）：xml-parse 表驱动 17 成功 + 8 逻辑失败；成功行断言**语义等价**（W2：
 *   测试局部 `expectXmlSemanticallyEqual` 比较器——canonical 解析 + 属性排序无关 + 引号归一
 *   + last-wins），禁逐字断言。attr 值含 `"` 的「有意 materialization 约束」是 issue #94
 *   修复对象的错误契约（C-8/X-F9），已删除；修复后属性值经投影面转义（&quot; 或按需改选
 *   引号外壳），round-trip 语义等价契约由 xml-attr-quote-domain.test.ts 承担。
 * - RAC-4（RD4）：extractYjsSnapshot 全量语义比较（union 各 variant / Record 键集 /
 *   Y.Array 顺序 / leaf 值 / XML 语义比较器）+ 嵌套 plain 深结构 clone 隔离行为断言。
 * - RAC-5（RD5→§6）：U13 收紧——`toThrow('observer-boom')`（message 精确匹配，F10 原样传播
 *   + ⑤ 未改写守卫）+ `observeCalls === 1`（yjs 单事务恰一次 type-observer 回调）。
 * 测试纪律：既有 U1–U12 断言零改动；U13 仅增强；observer 一律 one-shot（G8：无 guard 重入写
 * → 引擎无限递归 RangeError）；不读源码、不 grep 实现文本（黑盒可观测输出锚定）。
 *
 * —— rev2（PR #84 owner Review 修订轮；简报 wiki/raw/task_doc-runtime-materialize-root-rev2.md，
 * 决议/红线见 -rev2_relevant_decisions.md / -rev2_conflict_report.md）——
 * - RAC-P1（P1/T-1 改造）：rev1 T-1 characterization（外层事务内调用 → 先返回 ok:true、外层
 *   cleanup 后偏离落地且无 E201）按简报明文要求改造为**拒绝测试**：调用方在未闭合的
 *   doc.transact 内调用 → 任何写入前 loud fail + doc 零写入（0 update、
 *   encodeStateAsUpdate/encodeStateVector 字节不变、ROOT 空置、同步删改 observer 未触发）。
 *   R2 批（设计 §7.1 RT-6）收紧：SA1 设计定稿后拒绝形态 = throw DOCRT-E202（§3.4 三变体
 *   消息逐字定稿），throw 支断言正则由占位 /DOCRT-/ 收紧为 /DOCRT-E202/；返回支保留为
 *   兼容占位（设计 §3.5 定稿 throw，返回支理论不可达）。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { evaluate, parseVfsl, validateLogicalSnapshot } from '@nomicore/vfsl';
import type { DerivedSchema } from '@nomicore/vfsl';
// 构造性红灯：materializeRoot 尚未实现/导出，本 import 在收集阶段即失败（全用例红）。
// SA3 在 packages/doc-runtime/src 实现并导出 materializeRoot 后转绿。
import { extractYjsSnapshot, materializeRoot } from '../src/index.js';

// —— 测试契约类型（任务简报 AC-1 + ADR-0007 冻结）——

/** 物化 issue：message 非空字符串；path 段数组（materialization 失败恰 1 条——fail-fast）。 */
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

/** 'update' 事件计数器（AC-4 单事务/零写入锚）。 */
function countUpdates(doc: Y.Doc): { count: number } {
  const counter = { count: 0 };
  doc.on('update', () => {
    counter.count += 1;
  });
  return counter;
}

/** XML 语义等价归一化（AC-5：只承诺语义等价，不承诺逐字 round-trip）：折叠标签间空白。 */
function normalizeXml(xml: string): string {
  return xml.replace(/>\s+</g, '><').trim();
}

// —— XML 语义等价比较器（rev1/RAC-3，设计 §4.4；W2 合规落地件，测试局部 helper）——
//
// 两侧各过一遍测试侧 mini 扫描器（token 识别镜像 vfsl wellFormedXml：元素 / 属性（单双
// 引号等价、重复属性 last-wins 入 Map）/ 文本 run / 注释·CDATA·PI 作为不透明逐字 token）
// 产出 token 树 → canonical 序列化（属性按名排序、一律双引号、空元素/self-closing 统一
// 显式闭合、文本与不透明 token 逐字输出）→ canonical 串全等。
// 覆盖实测 yjs 投影差异（X-2 引号重排 / X-4 字母序 / X-12 闭合展开 / X-14 last-wins），
// 不锁 yjs 序列化器输出（ADR-0007「只承诺语义等价」的测试化）。禁止逐字断言投影形态。

type XmlTok =
  | { type: 'text'; text: string } // 文本 run（逐字，不解码、不折叠空白——规则 1/2 逐字即语义）
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
        // 自闭合：立即挂到当前栈顶/顶层（无子内容）
        const top = stack[stack.length - 1];
        if (top !== undefined) top.children.push(tok);
        else roots.push(tok);
      } else {
        // 非自闭合：token 树在结束标签处收拢（children 引用同一数组，闭标签时读出）
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

/** XML 名：[A-Za-z_:][A-Za-z0-9_.:-]*（与 vfsl xml.ts / doc-runtime xml-parse.ts 同字符集）。 */
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

// —— 规格 §10 vfs3.assets 参考 fixture（与 extract 侧同文本；ADR-0001 测试 fixture
// 例外）：覆盖 map/array/xml-fragment/leaf/plain/union/ref/Record 全形态 ——

const FIXTURE = `
/** vfs3.assets — 依据 issue #9 描述还原（原设计文档缺位） */

/** 资产 ID：键约束由 Pattern 定义，禁 "." 与 "|" */
type AssetId = string & Pattern<"^[A-Za-z0-9_\\\\-]{1,64}$">;

/** 审计信息：所有写入留痕 */
type Audit = YMap<{
  createdBy: YLeaf<string>;
  createdAt: YLeaf<number>;
}>;

/** 资产实体：按 kind 判别的封闭联合 */
type AssetEntity =
  | { kind: "image"; url: YLeaf<string>; width: YLeaf<number>; height: YLeaf<number>; audit: Audit }
  | { kind: "text"; body: YXmlFragment<{ paragraphs: YArray<YLeaf<string>> }>; audit: Audit }
  | { kind: "file"; name: YLeaf<string>; size: YLeaf<number>; tags: YArray<YLeaf<string>>; audit: Audit };

/** 附件：与 Yjs 同步无关的纯值数组 */
type Attachments = YPlainArray<YLeaf<string>>;

/** ROOT：命名空间根文档，assets 键集受 AssetId 的 Pattern 约束 */
type ROOT = YMap<{
  assets: Record<AssetId, AssetEntity>;
  attachments: Attachments;
  audit: Audit;
  /** @semantic 可选说明字段 */
  notes?: YLeaf<string>;
  keywords: YLeaf<string>[];
}>;
`.trim();

const DERIVED = derivedOf(FIXTURE);

/** 全形态正确逻辑 ROOT（普通 JSON；XML body 为字符串，与 Y.XmlFragment.toJSON() 投影一致）。 */
const EXPECTED_SNAPSHOT = {
  assets: {
    img1: {
      kind: 'image',
      url: 'https://cdn/x.png',
      width: 10,
      height: 20,
      audit: { createdBy: 'alice', createdAt: 111 },
    },
    doc1: {
      kind: 'text',
      body: '<p>Hello <b>world</b></p>',
      audit: { createdBy: 'bob', createdAt: 222 },
    },
    f1: {
      kind: 'file',
      name: 'readme.txt',
      size: 12,
      tags: ['a', 'b'],
      audit: { createdBy: 'carol', createdAt: 333 },
    },
  },
  attachments: ['x', 'y'],
  audit: { createdBy: 'root', createdAt: 999 },
  keywords: ['k1', 'k2'],
};

describe('materializeRoot — AC-1：logical 失败保留完整 issues；materialization 失败返回单 issue', () => {
  it('逻辑校验失败 → ok:false，issues 与 validateLogicalSnapshot 直调结果完全一致（完整保留，非 fail-fast 单条）', () => {
    const derived = derivedOf('type ROOT = { a: string; b: number };');
    const bad = { a: 123, b: 'x', extra: 1 }; // 类型错 ×2 + 未知键 ×1
    const direct = validateLogicalSnapshot(derived, bad);
    expect(direct.ok).toBe(false);
    let directIssues: MaterializeIssue[] = [];
    if (!direct.ok) {
      // 块内收窄提取（TS 收窄不跨块），供块外对比断言使用
      directIssues = direct.issues;
      expect(direct.issues.length).toBeGreaterThanOrEqual(2); // 前置确认多违规
    }
    const doc = new Y.Doc();
    const result = materializeRoot(derived, bad, doc) as MaterializeResult;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // 「保留完整 issues」：与直调 validateLogicalSnapshot 的结果逐条一致（内容 + 顺序）
      expect(result.issues).toEqual(directIssues);
      expect(result.issues.length).toBeGreaterThanOrEqual(2);
      for (const issue of result.issues) {
        expect(typeof issue.message).toBe('string');
        expect(issue.message.length).toBeGreaterThan(0);
        expect(Array.isArray(issue.path)).toBe(true);
      }
    }
  });

  it('物化失败（目标 ROOT 非空）→ ok:false 且恰 1 条 issue（materialization 失败 fail-fast 单 issue）', () => {
    const derived = derivedOf('type ROOT = { title: string };');
    const doc = new Y.Doc();
    doc.getMap('ROOT').set('title', 'old');
    const result = materializeRoot(derived, { title: 'new' }, doc) as MaterializeResult;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toHaveLength(1);
      const issue = result.issues[0];
      expect(issue).toBeDefined();
      expect(typeof issue?.message).toBe('string');
      expect((issue?.message ?? '').length).toBeGreaterThan(0);
    }
  });
});

describe('materializeRoot — AC-2：目标 ROOT 非空响亮失败，不 overwrite、merge 或 fallback', () => {
  it('ROOT 已含数据 → 响亮失败：既有内容不 overwrite、快照新键不 merge、doc 无其他写入（不 fallback）', () => {
    const derived = derivedOf('type ROOT = { title: string; count: number };');
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    root.set('title', 'old');
    const before = stateBytes(doc);
    const events = countUpdates(doc);
    const result = materializeRoot(derived, { title: 'new', count: 7 }, doc) as MaterializeResult;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toHaveLength(1); // 响亮失败：单 issue
    }
    expect(events.count).toBe(0); // 前置检查失败即止：未发起任何事务
    expect(stateBytes(doc)).toEqual(before); // 不 overwrite / 不 merge / 不 fallback：状态逐字节不变
    expect(root.get('title')).toBe('old'); // overwrite 缺席
    expect(root.has('count')).toBe(false); // merge 缺席
  });

  it('ROOT 为异型载体（Y.Array，即使为空）→ 响亮失败单 issue，状态不变', () => {
    const derived = derivedOf('type ROOT = { title: string };');
    const doc = new Y.Doc();
    doc.getArray('ROOT'); // ROOT 已以 Y.Array 存在（空）
    const before = stateBytes(doc);
    const events = countUpdates(doc);
    const result = materializeRoot(derived, { title: 't' }, doc) as MaterializeResult;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toHaveLength(1);
    }
    expect(events.count).toBe(0);
    expect(stateBytes(doc)).toEqual(before);
  });

  it('正向对照：ROOT 缺席（空 doc）与 ROOT 为空 Y.Map → 物化成功（AC-2 非空边界成立的前提）', () => {
    const derived = derivedOf('type ROOT = { title: string };');
    // 缺席：全新 doc（getMap 惰性创建空 map）
    const doc1 = new Y.Doc();
    const r1 = materializeRoot(derived, { title: 'a' }, doc1) as MaterializeResult;
    expect(r1.ok).toBe(true);
    expect(doc1.getMap('ROOT').get('title')).toBe('a');
    // 已集成但为空的 ROOT map
    const doc2 = new Y.Doc();
    const r2 = doc2.getMap('ROOT');
    r2.set('x', 1);
    r2.delete('x');
    const result2 = materializeRoot(derived, { title: 'b' }, doc2) as MaterializeResult;
    expect(result2.ok).toBe(true);
    expect(doc2.getMap('ROOT').get('title')).toBe('b');
    expect(doc2.getMap('ROOT').has('x')).toBe(false);
  });
});

describe('materializeRoot — AC-3：detached 构造正确区分 Y.Map / Y.Array / Y.XmlFragment 与 plain deep clone', () => {
  it('全形态 fixture → 结构树各节点载体正确：map→Y.Map、array→Y.Array、xml-fragment→Y.XmlFragment、plain→纯值', () => {
    const doc = new Y.Doc();
    const result = materializeRoot(DERIVED, EXPECTED_SNAPSHOT, doc) as MaterializeResult;
    expect(result.ok).toBe(true);
    const root = doc.getMap('ROOT');
    // 键空间恰为快照声明字段（notes 缺席不落键、无构造垃圾键）
    expect(new Set(root.keys())).toEqual(new Set(Object.keys(EXPECTED_SNAPSHOT)));
    const assets = root.get('assets');
    expect(assets).toBeInstanceOf(Y.Map); // Record → Y.Map
    const img1 = (assets as Y.Map<unknown>).get('img1');
    expect(img1).toBeInstanceOf(Y.Map); // union 成员（image）→ Y.Map
    const audit = (img1 as Y.Map<unknown>).get('audit');
    expect(audit).toBeInstanceOf(Y.Map); // ref→Audit（map 别名）→ Y.Map
    const f1 = (assets as Y.Map<unknown>).get('f1');
    expect((f1 as Y.Map<unknown>).get('tags')).toBeInstanceOf(Y.Array); // YArray<YLeaf> → Y.Array
    const doc1 = (assets as Y.Map<unknown>).get('doc1');
    expect((doc1 as Y.Map<unknown>).get('body')).toBeInstanceOf(Y.XmlFragment); // xml-fragment → Y.XmlFragment
    const attachments = root.get('attachments');
    expect(Array.isArray(attachments)).toBe(true); // YPlainArray → plain 纯值数组
    expect(attachments).not.toBeInstanceOf(Y.AbstractType); // 严禁物化成 Yjs 类型
    expect(root.get('keywords')).toBeInstanceOf(Y.Array); // YLeaf<string>[] → Y.Array
  });

  it('plain deep clone：物化后突变输入快照对象，doc 内容不受影响（引用不共享）', () => {
    const doc = new Y.Doc();
    const input = JSON.parse(JSON.stringify(EXPECTED_SNAPSHOT)) as typeof EXPECTED_SNAPSHOT;
    const result = materializeRoot(DERIVED, input, doc) as MaterializeResult;
    expect(result.ok).toBe(true);
    const root = doc.getMap('ROOT');
    const storedAttachments = root.get('attachments');
    expect(storedAttachments).not.toBe(input.attachments); // 深拷贝：实例不同（yjs set 实证按引用存储，故必须拷贝）
    // 物化后突变输入（plain 数组 / 嵌套 map 内 plain 值 / 顶层 plain 值）
    input.attachments.push('MUTATED');
    input.assets.img1.audit.createdBy = 'MUTATED';
    input.audit.createdAt = 0;
    // doc 内容不受影响
    expect(JSON.stringify(root.get('attachments'))).toBe(JSON.stringify(['x', 'y']));
    const img1 = (root.get('assets') as Y.Map<unknown>).get('img1') as Y.Map<unknown>;
    // 突变隔离断言：doc 侧嵌套 audit 是 Y.Map 实例（AC-3 载体断言），非 plain object——
    // vitest toEqual 对 Y.Map vs plain object 比较 own 可枚举键（含 Y.Map 内部字段）永不相等，
    // 故把条目投影为 plain object 后与原对象整体比较（与「突变输入快照 doc 不受影响」意图等价）。
    expect(Object.fromEntries((img1.get('audit') as Y.Map<unknown>).entries())).toEqual({ createdBy: 'alice', createdAt: 111 });
    expect((root.get('audit') as Y.Map<unknown>).get('createdAt')).toBe(999);
  });
});

describe('materializeRoot — AC-4：全部构造成功后才执行单次 transaction；前置失败时 Y.Doc state/update 不变', () => {
  it('成功物化 → 恰 1 次 update 事件（单次 Y.transact 安装，非逐节点多事务）', () => {
    const doc = new Y.Doc();
    const events = countUpdates(doc);
    const result = materializeRoot(DERIVED, EXPECTED_SNAPSHOT, doc) as MaterializeResult;
    expect(result.ok).toBe(true);
    expect(events.count).toBe(1);
    // 安装完成性抽查（与 AC-3 载体断言互补）
    const root = doc.getMap('ROOT');
    expect(root.get('assets')).toBeInstanceOf(Y.Map);
    expect(root.get('attachments')).toEqual(['x', 'y']);
    expect(root.get('keywords')).toBeInstanceOf(Y.Array);
  });

  it('逻辑校验失败（前置失败）→ 0 update 事件且 state 逐字节不变（零写入）', () => {
    const derived = derivedOf('type ROOT = { title: string };');
    const doc = new Y.Doc();
    const before = stateBytes(doc);
    const events = countUpdates(doc);
    const result = materializeRoot(derived, { title: 42 }, doc) as MaterializeResult;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.length).toBeGreaterThanOrEqual(1);
    }
    expect(events.count).toBe(0);
    expect(stateBytes(doc)).toEqual(before);
  });

  it('ROOT 非空（物化前置检查失败）→ 0 update 事件且 state 不变', () => {
    const derived = derivedOf('type ROOT = { title: string };');
    const doc = new Y.Doc();
    doc.getMap('ROOT').set('title', 'old');
    const before = stateBytes(doc);
    const events = countUpdates(doc);
    const result = materializeRoot(derived, { title: 'new' }, doc) as MaterializeResult;
    expect(result.ok).toBe(false);
    expect(events.count).toBe(0);
    expect(stateBytes(doc)).toEqual(before);
  });

  it('只写 ROOT：SCHEMA/META 兄弟条目物化前后保持不变（ADR-0006 三条目布局写入边界）', () => {
    const derived = derivedOf('type ROOT = { title: string };');
    const doc = new Y.Doc();
    doc.getMap('SCHEMA').set('lang', 'vfsl'); // 信封垃圾（非本能力面，仅验证不受触碰）
    doc.getMap('META').set('docId', 'm-1');
    const schemaBefore = JSON.stringify([...doc.getMap('SCHEMA').entries()]);
    const metaBefore = JSON.stringify([...doc.getMap('META').entries()]);
    const result = materializeRoot(derived, { title: 't' }, doc) as MaterializeResult;
    expect(result.ok).toBe(true);
    expect(JSON.stringify([...doc.getMap('SCHEMA').entries()])).toBe(schemaBefore);
    expect(JSON.stringify([...doc.getMap('META').entries()])).toBe(metaBefore);
  });
});

describe('materializeRoot — AC-5：XML string 物化后提取可再次通过逻辑校验，不要求字符串逐字相同', () => {
  it('XML 物化 → extractYjsSnapshot 提取 → 归一化语义等价且 validateLogicalSnapshot 再次通过（ok:true）', () => {
    const doc = new Y.Doc();
    const result = materializeRoot(DERIVED, EXPECTED_SNAPSHOT, doc) as MaterializeResult;
    expect(result.ok).toBe(true);
    const ex = extractYjsSnapshot(DERIVED, doc);
    expect(ex.ok).toBe(true);
    if (!ex.ok) {
      throw new Error(`期望提取成功，实际失败：${JSON.stringify(ex.issues)}`);
    }
    const extracted = ex.snapshot as { assets: { doc1: { body: unknown } } };
    const body = extracted.assets.doc1.body;
    expect(typeof body).toBe('string'); // XML 值物化为 Y.XmlFragment，提取回 XML 字符串
    // 语义等价（折叠标签间空白后比较），不承诺字符串逐字相同（ADR-0007）
    expect(normalizeXml(body as string)).toBe('<p>Hello <b>world</b></p>');
    // AC-5 主锚：提取出的普通 logical ROOT 再次通过完整逻辑校验
    const revalidate = validateLogicalSnapshot(DERIVED, extracted);
    expect(revalidate.ok).toBe(true);
  });
});

describe('materializeRoot — AC-6：observer 抛错边界按 ADR 0007 处理，不虚假承诺事务回滚', () => {
  it('ROOT observer 抛错 → 错误 loud 原样传播（toThrow("observer-boom")），不吞并成伪 ok/伪回滚结果；写入已提交（不虚假回滚）', () => {
    const derived = derivedOf('type ROOT = { title: string };');
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    let observeCalls = 0;
    root.observe(() => {
      observeCalls += 1;
      throw new Error('observer-boom');
    });
    const events = countUpdates(doc);
    // ADR-0007 失败边界：事务开始后未知 observer 抛错 → Runtime internal/fatal——
    // 不得捕获吞并成 {ok:true} 或「已回滚」的失败结果；错误必须 loud 原样传播（F10）。
    // rev1 收紧（RD5/RAC-5）：message 精确匹配 'observer-boom'（原样传播契约——异常必须
    // 是 observer 的原始错误，非包装/E200/E201；同时守卫 ⑤ 未把 observer 错误改写成 E201）。
    expect(() => materializeRoot(derived, { title: 't' }, doc)).toThrow('observer-boom');
    // rev1 收紧（RD5/RAC-5）：yjs 事务级批处理——单事务恰一次 type-observer 回调（P-R3/V6 实测）
    expect(observeCalls).toBe(1);
    // yjs 实证语义：observer 抛错不触发事务回滚——写入已实际提交（update 已发出、值已落盘）。
    // 本断言锚定「不虚假承诺事务回滚」：若实现伪造回滚（删除已写内容/多事务清理），此处变红。
    expect(events.count).toBe(1);
    expect(root.get('title')).toBe('t');
  });
});

// —— rev1 / R1（RAC-1，设计 §2/§10）：observer 同步重入不抛错修改 ROOT 顶层 → ⑤
// verifyInstall 检测偏离 throw DOCRT-E201（F11）——
//
// 契约（INV-10 / §2.2）：`ok:true` = INV-2（全部计划 set 已在单次 Y.transact 提交）+
// INV-10（返回时 ROOT 顶层恰为计划键集且逐键值与安装值严格同一）。检测基准是身份
// 同一性（===）而非语义等价。observer 一律 one-shot（G8 纪律：无 guard 的重入写 →
// 引擎无限递归 RangeError）。断言不锁 update 总数（observer 重入事务数非本函数契约，
// §2.3 R-5；只锁「首事务已提交」≥1）。

describe('materializeRoot — R1（rev1/RAC-1）：observer 重入不抛错（delete/overwrite/insert/combo）→ throw DOCRT-E201', () => {
  const derived = derivedOf('type ROOT = { title: string; count: number };');

  it('delete 计划键 → throw DOCRT-E201；最终 ROOT：title 缺席、count 保留（写入已提交、不回滚、不补偿）', () => {
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    let done = false;
    root.observe(() => {
      if (done) return; // one-shot（G8 纪律）
      done = true;
      root.delete('title');
    });
    const events = countUpdates(doc);
    // ⑤ 检测偏离 → 响亮失败（F11）。SA3 实现 ⑤ 之前：现实现④后无条件 ok:true → 本断言红
    expect(() => materializeRoot(derived, { title: 't', count: 7 }, doc)).toThrow('DOCRT-E201');
    // 首事务已提交（INV-2）；observer 重入事务数非本函数契约（R-5），不锁总数
    expect(events.count).toBeGreaterThanOrEqual(1);
    // 最终 ROOT 状态逐键断言（owner：明确断言返回结果和最终 ROOT 状态）
    expect(root.get('title')).toBeUndefined();
    expect(root.get('count')).toBe(7);
  });

  it('overwrite 计划键 → throw DOCRT-E201；最终 ROOT：title 被覆写为 HACKED（不补偿修复写入）', () => {
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    let done = false;
    root.observe(() => {
      if (done) return;
      done = true;
      root.set('title', 'HACKED');
    });
    const events = countUpdates(doc);
    expect(() => materializeRoot(derived, { title: 't', count: 7 }, doc)).toThrow('DOCRT-E201');
    expect(events.count).toBeGreaterThanOrEqual(1);
    expect(root.get('title')).toBe('HACKED');
    expect(root.get('count')).toBe(7);
  });

  it('insert 额外键 → throw DOCRT-E201；最终 ROOT：extra 键在（鸽笼断言：计划键全在 ⇒ 无额外键）', () => {
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    let done = false;
    root.observe(() => {
      if (done) return;
      done = true;
      root.set('extra', 'E');
    });
    const events = countUpdates(doc);
    expect(() => materializeRoot(derived, { title: 't', count: 7 }, doc)).toThrow('DOCRT-E201');
    expect(events.count).toBeGreaterThanOrEqual(1);
    expect(root.get('extra')).toBe('E');
    expect(root.get('title')).toBe('t');
  });

  it('组合向量（delete 计划键 + insert 额外键）→ throw DOCRT-E201（G5：size 相等而身份破坏——双断言缺一不可，P-R6）', () => {
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    let done = false;
    root.observe(() => {
      if (done) return;
      done = true;
      root.delete('title');
      root.set('extra', 'x');
    });
    const events = countUpdates(doc);
    expect(() => materializeRoot(derived, { title: 't', count: 7 }, doc)).toThrow('DOCRT-E201');
    expect(events.count).toBeGreaterThanOrEqual(1);
    // 最终 ROOT：size 2===2（count+extra）而 title 同一性破坏——size 断言单查会漏报
    expect(root.get('title')).toBeUndefined();
    expect(root.get('count')).toBe(7);
    expect(root.get('extra')).toBe('x');
  });

  it('正向对照：observer 不触 ROOT 顶层 → ok:true 且 ROOT 逐键等于快照（无假阳性）', () => {
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    let observeCalls = 0;
    root.observe(() => {
      observeCalls += 1; // 诚实 observer：只计数，不写
    });
    const result = materializeRoot(derived, { title: 't', count: 7 }, doc) as MaterializeResult;
    expect(result.ok).toBe(true);
    expect(observeCalls).toBe(1); // 单事务恰一次 type-observer 回调（P-R3）
    expect(root.get('title')).toBe('t');
    expect(root.get('count')).toBe(7);
  });

  it('同值重插不误报（G4）：delete + 同值重插同实例 → 身份同一性保持 → ok:true（⑤ 检测偏离，非检测活动）', () => {
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    let done = false;
    root.observe(() => {
      if (done) return;
      done = true;
      root.delete('title');
      root.set('title', 't'); // 同值重插（primitive：同一值即同一实例）
    });
    const result = materializeRoot(derived, { title: 't', count: 7 }, doc) as MaterializeResult;
    expect(result.ok).toBe(true);
    expect(root.get('title')).toBe('t');
    expect(root.get('count')).toBe(7);
  });
});

describe('materializeRoot — R2（rev2/P1）：活动外层 transaction 内调用 → loud fail + doc 零写入（T-1 拒绝测试）', () => {
  it('调用方在未闭合 doc.transact 内调用（契约前提破坏）→ 绝不为 ok:true；0 update、state/vector 字节不变、ROOT 空置、observer 未触发', () => {
    // rev2/P1（PR #84 owner Review / issue #74）：materializeRoot 必须在**任何写入前**检测
    // doc 是否处于活动 transaction（rev1 JSDoc 前置条件段升格为运行时 guard，不能只靠文档
    // 声明）。本用例由 rev1 T-1 characterization（先返回成功、后发生未检测偏离——先错行为）
    // 改造为拒绝测试，锚定修复后的契约。
    //
    // 拒绝形态（SA8 重点裁决一 / W1 澄清）：guard 在写入前触发、doc 未变，throw 与 {ok:false}
    // 两形态均与零写入纪律相容，形态与错误身份/消息归 SA1 设计定稿——本用例按「绝不为
    // ok:true」主断言 + 占位形态断言编写（设计定稿后按设计对齐，勿阻塞 SA3 形态选择）。
    //
    // 零写入断言面（ADR-0006 三条目布局 / CONTEXT.md 零写入）：0 update 事件 +
    // Y.encodeStateAsUpdate 逐字节不变 + Y.encodeStateVector 不变 + ROOT 空置 + 同步删改
    // observer 未触发（写路径从未进入——若 guard 缺席，外层事务 cleanup 期 observer 必触发）。
    const derived = derivedOf('type ROOT = { title: string; count: number };');
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    const before = stateBytes(doc);
    const beforeVector = [...Y.encodeStateVector(doc)];
    const events = countUpdates(doc);
    let observeCalls = 0;
    let done = false;
    root.observe(() => {
      if (done) return; // one-shot（G8 纪律：无 guard 的删改重入 → 事务链无限增长 → RangeError）
      done = true;
      observeCalls += 1; // 攻击向量（rev1 T-1 同款：外层 cleanup 期删计划键 + 插额外键）
      root.delete('title');
      root.set('extra', 'E');
    });
    let result: MaterializeResult | undefined;
    let thrown: unknown;
    doc.transact(() => {
      try {
        result = materializeRoot(derived, { title: 't', count: 7 }, doc);
      } catch (err) {
        thrown = err; // 捕捉形态以区分 throw / 返回（断言面不受调用语境影响）
      }
    });
    // (a) 主断言：绝不为 ok:true（当前实现：内部事务并入外层 → ⑤ 空转 → ok:true → 红灯）
    if (thrown !== undefined) {
      // 形态断言（RT-6 收紧，设计 §7.1：E202 三变体消息已逐字定稿，SA2 #2 建议）：
      // guard 拒绝形态定稿 throw（设计 §3.5），错误码 DOCRT-E202（窗口 A/B/C 三变体
      // 均以 "DOCRT-E202:" 起头——E202_MSG_A/B/C，设计 §3.4 逐字定稿）
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toMatch(/DOCRT-E202/);
    } else {
      expect(result?.ok).not.toBe(true); // 主锚：任何形态都不得返回成功
      expect(result?.ok).toBe(false); // 占位形态断言（返回支）：结构化失败 {ok:false, issues}
      if (result !== undefined && !result.ok) {
        expect(Array.isArray(result.issues)).toBe(true);
        expect(result.issues.length).toBeGreaterThanOrEqual(1);
      }
    }
    // (b) 零写入双证 + 强化锚：0 update 事件（无事务内容提交）
    expect(events.count).toBe(0);
    // state 逐字节不变（encodeStateAsUpdate 含删除集；encodeStateVector 为 client/clock 面）
    expect(stateBytes(doc)).toEqual(before);
    expect([...Y.encodeStateVector(doc)]).toEqual(beforeVector);
    // ROOT 保持空置（无任何键落地）
    expect(root.size).toBe(0);
    expect([...root.keys()]).toEqual([]);
    // 写路径从未进入：同步删改 observer 未触发（guard 缺席时外层 cleanup 期必然触发）
    expect(observeCalls).toBe(0);
  });
});

describe('materializeRoot — R1（rev1/R-8）：身份级保守（T-4，可选）', () => {
  it('语义等价异实例替换（delete + 重插 deep-equal 不同实例）→ 亦 throw DOCRT-E201（检测基准 === 而非语义等价，有意保守）', () => {
    const derived = derivedOf('type ROOT = { u: { nested: YLeaf<number> } };');
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    let done = false;
    root.observe(() => {
      if (done) return;
      done = true;
      root.delete('u');
      root.set('u', { nested: 1 }); // 语义等价（deep-equal）但不同实例（plain object vs 安装的 detached Y.Map）
    });
    const events = countUpdates(doc);
    expect(() => materializeRoot(derived, { u: { nested: 1 } }, doc)).toThrow('DOCRT-E201');
    expect(events.count).toBeGreaterThanOrEqual(1);
    expect(root.get('u')).toEqual({ nested: 1 });
  });
});

describe('materializeRoot — R1（rev1/INV-10 退化）：空 entries（全 optional 空快照）+ observer → ⑤ 无操作', () => {
  it('entries 为空 → size 0===0 恒过：ok:true 且 0 update（B2/T14 语义；yjs 空事务无内容不发 update）', () => {
    const derived = derivedOf('type ROOT = { title?: string };');
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    let fired = 0;
    root.observe(() => {
      fired += 1;
    });
    const events = countUpdates(doc);
    const result = materializeRoot(derived, {}, doc) as MaterializeResult;
    expect(result.ok).toBe(true);
    expect(fired).toBe(0); // 空事务：无类型变更 → type-observer 不回调（yjs 实证）
    expect(events.count).toBe(0); // 空事务：hasContent=false → 无 update 事件（yjs 实证）
  });
});

// —— rev1 / R2（RAC-2，设计 §3）：detached 构造失败零写入（原子性主锚，§3.3）——
//
// 每行统一断言模板（顺序即断言顺序——先证前置再证失败，owner 反馈 #2 原文要求）：
// (1) 前置 validateLogicalSnapshot ok:true（证明走的是构造失败支路，非逻辑失败支路）；
// (2) materializeRoot ok:false；(3) 恰 1 条 materialization issue（INV-3 fail-fast，
// message 非空 + path 数组形态）；(4) 零写入双证：0 update 事件 + state 字节不变。
// 现实现行为已实测达标（设计 §9.3 8/8）——本组为验收锚（绿）。

describe('materializeRoot — R2（rev1/RAC-2）：detached 构造失败 → ok:false + 恰 1 issue + 0 update + state 字节不变', () => {
  const CASES: Array<{ name: string; vfsl: string; makeSnapshot: () => unknown }> = [
    { name: 'C-1 unknown 位 Date（non-plain object）', vfsl: 'type ROOT = { u: unknown };', makeSnapshot: () => ({ u: new Date(0) }) },
    { name: 'C-2 unknown 位 bigint', vfsl: 'type ROOT = { u: unknown };', makeSnapshot: () => ({ u: 10n }) },
    { name: 'C-3 unknown 位 NaN（non-finite number）', vfsl: 'type ROOT = { u: unknown };', makeSnapshot: () => ({ u: NaN }) },
    { name: 'C-4a unknown 位 +Infinity（non-finite number）', vfsl: 'type ROOT = { u: unknown };', makeSnapshot: () => ({ u: Infinity }) },
    { name: 'C-4b unknown 位 -Infinity（non-finite number）', vfsl: 'type ROOT = { u: unknown };', makeSnapshot: () => ({ u: -Infinity }) },
    { name: 'C-5a unknown 位 Y.Map 实例（内嵌 Y 类型）', vfsl: 'type ROOT = { u: unknown };', makeSnapshot: () => ({ u: new Y.Map() }) },
    { name: 'C-5b unknown 位 Y.Array 实例（内嵌 Y 类型）', vfsl: 'type ROOT = { u: unknown };', makeSnapshot: () => ({ u: new Y.Array() }) },
    { name: 'C-6 unknown[] 数组内 undefined', vfsl: 'type ROOT = { u: unknown; arr: unknown[] };', makeSnapshot: () => ({ u: 1, arr: [undefined] }) },
    { name: 'C-7 number 标量位 NaN（typeof NaN === number 过 ①）', vfsl: 'type ROOT = { n: number };', makeSnapshot: () => ({ n: NaN }) },
    // C-8/X-F9（XML 属性值含双引号 → 构造期拒绝）已按 issue #94 AC-⑥ 删除/改写：该契约将
    // 「extract 侧 yjs 零转义序列化表示缺陷」前移为输入域收窄，与 VFSL wellFormedXml 宽域
    // 不一致（SA5 根因，见 wiki/raw/20260823-bug-xml-attr-quote-domain.md）。新契约见
    // test/xml-attr-quote-domain.test.ts（RT-A/RT-C）：单引号属性内双引号必须
    // materializeRoot ok:true + round-trip 语义等价。
  ];

  it.each(CASES)('$name：先证 validateLogicalSnapshot ok:true（构造失败支路），再证 ok:false + 恰 1 issue + 0 update + state 字节不变', ({ vfsl, makeSnapshot }) => {
    const derived = derivedOf(vfsl);
    const snapshot = makeSnapshot();
    // (1) 前置：逻辑校验通过——AC-4「构造失败」分支被触达（非逻辑失败支路）
    expect(validateLogicalSnapshot(derived, snapshot).ok).toBe(true);
    const doc = new Y.Doc();
    const before = stateBytes(doc);
    const events = countUpdates(doc);
    // (2) 物化失败
    const result = materializeRoot(derived, snapshot, doc) as MaterializeResult;
    expect(result.ok).toBe(false);
    // (3) 恰 1 条 materialization issue（INV-3 fail-fast；message 非空 + path 数组形态）
    if (!result.ok) {
      expect(result.issues).toHaveLength(1);
      const issue = result.issues[0];
      expect(issue).toBeDefined();
      expect(typeof issue?.message).toBe('string');
      expect((issue?.message ?? '').length).toBeGreaterThan(0);
      expect(Array.isArray(issue?.path)).toBe(true);
    }
    // (4) 零写入双证（原子性主锚，§3.3）：0 update 事件 + Y.encodeStateAsUpdate 逐字节不变
    expect(events.count).toBe(0);
    expect(stateBytes(doc)).toEqual(before);
  });
});

// —— rev1 / R3（RAC-3，设计 §4）：xml-parse 表驱动——
//
// 成功行断言模板（W2 合规——语义等价，禁逐字）：materialize ok + 单事务（events.count===1）
// + extract 提取与【输入】经 expectXmlSemanticallyEqual 语义比较 + revalidate ok（AC-5 主锚）。
// 逻辑失败行模板：direct validate ok:false 恰 1 issue → materialize ok:false 恰 1 issue
// （引用零损透传 toEqual）+ 0 update + state 不变。
// 原构造失败行 X-F9（attr-`"` 定谳锁定，与 R2 组 C-8 同锚）已按 issue #94 AC-⑥ 删除/改写：
// 单引号属性内双引号的「构造期拒绝」是缺陷（SA5 根因），新行为契约（materialize ok:true +
// round-trip 语义等价 + 语义比较器含属性值实体解码）见 test/xml-attr-quote-domain.test.ts。

describe('materializeRoot — R3（rev1/RAC-3）：xml-parse 表驱动（成功 17 行 + 逻辑失败 8 行）', () => {
  const dXml = derivedOf('type ROOT = { body: YXmlFragment<{ p: string }> };');

  const SUCCESS: Array<{ label: string; input: string }> = [
    { label: 'X-1 属性值含裸 < &（引号内字面量往返）', input: '<p title="a<b&c">x</p>' },
    { label: 'X-2 单引号属性（→ 双引号重排）', input: "<e k='v'/>" },
    { label: 'X-3 双引号包裹单引号值', input: '<p title="a\'b">x</p>' },
    { label: 'X-4 属性字母序重排', input: '<e b="2" a="1"/>' },
    { label: 'X-5 空属性值', input: '<e k=""/>' },
    { label: 'X-6 元素内注释逐字承载', input: '<p>x<!-- note -->y</p>' },
    { label: 'X-7 顶层 CDATA 逐字承载', input: '<![CDATA[a < b]]>' },
    { label: 'X-8 顶层处理指令逐字承载', input: '<?pi data?>' },
    { label: 'X-9 多根 fragment', input: '<p>a</p><p>b</p>' },
    { label: 'X-10 顶层文本 + 混合内容', input: 'top text <b/>' },
    { label: 'X-11 空 XML（空 fragment）', input: '' },
    { label: 'X-12 self-closing（→ 显式闭合展开）', input: '<e/>' },
    { label: 'X-13 空元素', input: '<e></e>' },
    { label: 'X-14 重复属性 last-wins', input: "<e k='v' k='w'/>" },
    { label: 'X-15 格式化 whitespace（文本 span 逐字保留）', input: '<p>\n  <b>x</b>\n</p>' },
    { label: 'X-16 实体字面量逐字保留（不解码）', input: '<p>x &amp; y &lt; z</p>' },
    { label: 'X-17 元素名字符集宽域', input: '<ns:item-2.x/>' },
  ];

  it.each(SUCCESS)('$label：materialize ok + 单事务 + extract 语义等价 + revalidate ok', ({ input }) => {
    const doc = new Y.Doc();
    const events = countUpdates(doc);
    const result = materializeRoot(dXml, { body: input }, doc) as MaterializeResult;
    expect(result.ok).toBe(true);
    expect(events.count).toBe(1); // 单事务（U8 语义在 XML 面锚定）
    const ex = extractYjsSnapshot(dXml, doc);
    expect(ex.ok).toBe(true);
    if (!ex.ok) {
      throw new Error(`期望提取成功，实际失败：${JSON.stringify(ex.issues)}`);
    }
    const body = (ex.snapshot as { body: string }).body;
    expect(typeof body).toBe('string');
    // W2：语义等价比较（canonical 解析 + 属性排序无关 + 引号归一 + last-wins），禁逐字断言
    expectXmlSemanticallyEqual(body, input);
    // revalidate（AC-5 主锚在表驱动面的落位）
    expect(validateLogicalSnapshot(dXml, ex.snapshot).ok).toBe(true);
  });

  const BAD: Array<{ label: string; input: string }> = [
    { label: 'X-F1 标签未闭合', input: '<p>' },
    { label: 'X-F2 结束标签与开始标签不匹配', input: '<p></b>' },
    { label: 'X-F3 未闭合的注释', input: '<!--' },
    { label: 'X-F4 未闭合的 CDATA 段', input: '<![CDATA[a' },
    { label: 'X-F5 未闭合的处理指令', input: '<?pi' },
    { label: 'X-F6 DOCTYPE 声明不支持（校验/构造两侧同拒）', input: '<!DOCTYPE x>' },
    { label: 'X-F7 文本中裸 < 后非合法标签起点', input: 'x < y' },
    { label: 'X-F8 属性值必须加引号', input: '<e k=v/>' },
  ];

  it.each(BAD)('$label：validate ok:false 恰 1 issue → materialize ok:false 恰 1 issue（引用零损透传）+ 0 update + state 不变', ({ input }) => {
    const direct = validateLogicalSnapshot(dXml, { body: input });
    expect(direct.ok).toBe(false);
    let directIssues: MaterializeIssue[] = [];
    if (!direct.ok) {
      // 恰 1（单违规输入——RAC-3 字面锚；锁的是这 8 行行为而非 validate 的全收集语义）
      expect(direct.issues).toHaveLength(1);
      directIssues = direct.issues;
    }
    const doc = new Y.Doc();
    const before = stateBytes(doc);
    const events = countUpdates(doc);
    const result = materializeRoot(dXml, { body: input }, doc) as MaterializeResult;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toHaveLength(1); // 透传侧同锁
      expect(result.issues).toEqual(directIssues); // 引用零损透传（D2/F1）
    }
    expect(events.count).toBe(0);
    expect(stateBytes(doc)).toEqual(before);
  });
});

// —— rev1 / R4（RAC-4，设计 §5）：extractYjsSnapshot 全量语义比较 + 嵌套 clone 隔离——
// instanceof 断言可能假绿（载体正确但内容丢失/篡改）——本组以完整语义比较为锚：
// union 各 variant 整对象全量 / Record 键集 / Y.Array 元素与顺序 / leaf 标量 / XML 经
// 语义比较器（W3，禁退化为字节相等）；嵌套 plain 深结构以「突变输入 → extract 不变」
// 的行为断言锁定全深度 clone 隔离（引用不等断言只证顶层实例分离）。

describe('materializeRoot — R4（rev1/RAC-4）：extractYjsSnapshot 完整语义比较 + 嵌套 clone 隔离', () => {
  it('用例 A：全形态 fixture（DERIVED/EXPECTED_SNAPSHOT）逐域完整比较（union 三 variant / Record 键集 / Y.Array 顺序 / leaf 值 / XML 语义比较 / revalidate）', () => {
    const doc = new Y.Doc();
    const result = materializeRoot(DERIVED, EXPECTED_SNAPSHOT, doc) as MaterializeResult;
    expect(result.ok).toBe(true);
    const ex = extractYjsSnapshot(DERIVED, doc);
    expect(ex.ok).toBe(true);
    if (!ex.ok) {
      throw new Error(`期望提取成功，实际失败：${JSON.stringify(ex.issues)}`);
    }
    const extracted = ex.snapshot as {
      assets: {
        img1: { kind: string; url: string; width: number; height: number; audit: { createdBy: string; createdAt: number } };
        doc1: { kind: string; body: string; audit: { createdBy: string; createdAt: number } };
        f1: { kind: string; name: string; size: number; tags: string[]; audit: { createdBy: string; createdAt: number } };
      };
      attachments: string[];
      audit: { createdBy: string; createdAt: number };
      keywords: string[];
    };
    // Record 全部 key（键集断言；顺序不断言——extract 按 yjs 插入序，语义上无序键集）
    expect(new Set(Object.keys(extracted.assets))).toEqual(new Set(['img1', 'doc1', 'f1']));
    // union variant 1（image）：整对象全量（含 audit 嵌套与全部 leaf 标量）
    expect(extracted.assets.img1).toEqual({
      kind: 'image',
      url: 'https://cdn/x.png',
      width: 10,
      height: 20,
      audit: { createdBy: 'alice', createdAt: 111 },
    });
    // union variant 2（text）：body 走 XML 语义比较器（W3），其余全量
    const { body, ...doc1Rest } = extracted.assets.doc1;
    expect(doc1Rest).toEqual({ kind: 'text', audit: { createdBy: 'bob', createdAt: 222 } });
    expectXmlSemanticallyEqual(body, '<p>Hello <b>world</b></p>');
    // union variant 3（file）：tags 顺序敏感（Y.Array 元素与顺序，owner 原文）
    expect(extracted.assets.f1).toEqual({
      kind: 'file',
      name: 'readme.txt',
      size: 12,
      tags: ['a', 'b'],
      audit: { createdBy: 'carol', createdAt: 333 },
    });
    // 顶层 map 字段（audit / attachments / keywords——plain 纯值与 Y.Array 顺序）
    expect(extracted.audit).toEqual({ createdBy: 'root', createdAt: 999 });
    expect(extracted.attachments).toEqual(['x', 'y']);
    expect(extracted.keywords).toEqual(['k1', 'k2']);
    // revalidate（U12 主锚保留）
    expect(validateLogicalSnapshot(DERIVED, extracted).ok).toBe(true);
  });

  const DEEP_VFSL = 'type ROOT = { m: YMap<{ a: YLeaf<number> }>; tags: YArray<YLeaf<string>>; body: YXmlFragment<{ p: string }>; blob: YPlainArray<YLeaf<string>>; u: unknown };';
  interface DeepSnapshot {
    m: { a: number };
    tags: string[];
    body: string;
    blob: string[];
    u: { nested: { deep: Array<number | string | null>; inner?: unknown } };
  }
  const makeDeepSnapshot = (): DeepSnapshot => ({
    m: { a: 1 },
    tags: ['x', 'y'],
    body: '<p>Hi <b>there</b></p>',
    blob: ['p1', 'p2'],
    u: { nested: { deep: [1, 'two', null] } },
  });

  it('用例 B：深层多形态 fixture 整树语义比较（非 XML 域 toEqual 原值——含 u 嵌套深结构；XML 域语义比较器）', () => {
    const derived = derivedOf(DEEP_VFSL);
    const doc = new Y.Doc();
    const result = materializeRoot(derived, makeDeepSnapshot(), doc) as MaterializeResult;
    expect(result.ok).toBe(true);
    const ex = extractYjsSnapshot(derived, doc);
    expect(ex.ok).toBe(true);
    if (!ex.ok) {
      throw new Error(`期望提取成功，实际失败：${JSON.stringify(ex.issues)}`);
    }
    const s = ex.snapshot as DeepSnapshot;
    expect(s.m).toEqual({ a: 1 });
    expect(s.tags).toEqual(['x', 'y']);
    expectXmlSemanticallyEqual(s.body, '<p>Hi <b>there</b></p>');
    expect(s.blob).toEqual(['p1', 'p2']);
    expect(s.u).toEqual({ nested: { deep: [1, 'two', null] } }); // unknown 位嵌套深结构整树
  });

  it('用例 C：materialize 后突变输入三个嵌套点（plain 数组 / unknown 位嵌套深数组 / 嵌套对象改写）→ extract 回到原值（全深度 clone 隔离行为断言）', () => {
    const derived = derivedOf(DEEP_VFSL);
    const input = makeDeepSnapshot();
    const doc = new Y.Doc();
    const result = materializeRoot(derived, input, doc) as MaterializeResult;
    expect(result.ok).toBe(true);
    // 突变输入的三个嵌套点（SA6 冻结纪律延伸：引用不等断言只证顶层实例分离，行为断言证全深度隔离）
    input.blob.push('MUTATED'); // YPlainArray 声明位 plain 数组
    input.u.nested.deep.push('MUTATED'); // unknown 位嵌套深数组（copyJsonDomain 数组分支）
    input.u.nested.inner = { hacked: true }; // unknown 位嵌套对象改写（对象分支）
    const ex = extractYjsSnapshot(derived, doc);
    expect(ex.ok).toBe(true);
    if (!ex.ok) {
      throw new Error(`期望提取成功，实际失败：${JSON.stringify(ex.issues)}`);
    }
    const s = ex.snapshot as DeepSnapshot;
    expect(s.blob).toEqual(['p1', 'p2']); // doc 侧不受输入突变影响
    expect(s.u).toEqual({ nested: { deep: [1, 'two', null] } });
  });
});
