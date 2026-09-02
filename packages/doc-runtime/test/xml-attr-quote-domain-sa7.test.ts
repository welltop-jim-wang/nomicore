/**
 * SA7 补充动态验证测试 — XML 属性引号接受域一致性（issue #94，commit a2e6c52）。
 *
 * 规范权威：ADR-0007（逻辑校验域）；评审报告降为历史证据：
 * SA4 静态审核报告（wiki/raw/task_xml-attr-quote-domain_sa4_review.md）
 * 「动态审核重点」②③ 与 §1.5 附加攻击角落实跑 [B][C][D][E]——SA4 以一次性脚本验证、
 * 未入库锁定；本文件把这些角度固化为常驻回归锚，并补充设计 §8 实测 #3（quote-free
 * 字节一致性）的回归锁。全部断言为运行时行为（公共入口返回值 / 投影字符串 / throw /
 * 存储真值 getAttribute），零源码 grep 断言（SA6 W2 同纪律）。
 *
 * 覆盖矩阵（与 SA6 26 用例互补，不重复）：
 * - S-1 direct yjs API 写入 `"`+`'` 同存值（parse 侧不可构造、observer/direct 独有死角，
 *   设计 §3 否决外壳切换的决定性理由）→ 投影良构可再校验 + 存储真值无损；
 * - S-2 嵌套 Y.XmlFragment 子树（SA2 MINOR #2 递归分支）后代属性转义生效；
 * - S-3 quote-free 树：自建序列化器与 yjs 原生 toString 逐字节相同（§8 实测 #3 回归锁）；
 * - S-4 valueOf 对象属性值：与 yjs 原生隐式强转镜像（SA4 攻击角 [B]；防 String() 漂移）；
 * - S-5 detached fragment：xmlFragmentToString loud throw（拒绝静默空投影，SA4 [实测 #4]）；
 * - S-6 escapeAttrValue 纪律：只转义裸 `"`、不碰 `&`（§5.2 T-13 反例）、幂等；
 * - S-7 表示漂移不动点：extract → re-materialize → re-extract 逐字节稳定（§5.5 / SA4 [E]）；
 * - S-8 同一逻辑值两种写法（`'a"b'` vs `"a&quot;b"`）投影收敛到同一字节串（§4.4 加固价值）；
 * - S-9 readLogicalValueAtPath XML 终点与 extract 同一投影（D7 单一语义源，read.ts 复用 walk）；
 * - S-10 RT-E / RT-5 observer 注入 → ⑥ **变体 C**（非变体 D）特异性断言（SA4 动态重点②：
 *   检测面从「防线未能运行」升级为「检测到偏离」，时序一致性以断言级别锁定）。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { evaluate, parseVfsl, validateLogicalSnapshot } from '@nomicore/vfsl';
import type { DerivedSchema } from '@nomicore/vfsl';
import { extractYjsSnapshot, materializeRoot, readLogicalValueAtPath } from '../src/index.js';
import { escapeAttrValue, xmlFragmentToString } from '../src/xml-serialize.js';

function derivedOf(text: string): DerivedSchema {
  const parsed = parseVfsl(text);
  if (!parsed.ok) throw new Error(`前置 parseVfsl 失败（fixture 缺陷）：${JSON.stringify(parsed.issues)}`);
  const evaluated = evaluate(parsed.module);
  if (!evaluated.ok) throw new Error(`前置 evaluate 失败（fixture 缺陷）：${JSON.stringify(evaluated.issues)}`);
  return evaluated.derived;
}

const D_XML = () => derivedOf('type ROOT = { body: YXmlFragment<{ p: string }> };');

/** 提取 ROOT.body（XML 字符串）；失败 throw 携带 issues。 */
function extractBody(derived: DerivedSchema, doc: Y.Doc): string {
  const ex = extractYjsSnapshot(derived, doc);
  if (!ex.ok) throw new Error(`期望提取成功，实际失败：${JSON.stringify(ex.issues)}`);
  return (ex.snapshot as { body: string }).body;
}

/** 投影良构性锚：再过 validateLogicalSnapshot 必须 ok:true（AC-② 口径）。 */
function revalidateOk(derived: DerivedSchema, xml: string): void {
  const v = validateLogicalSnapshot(derived, { body: xml });
  expect(v).toEqual({ ok: true });
}

/** 单属性投影的引号计数锚：属性值已转义 ⇔ 整串恰含 2 个 `"`（外壳开+闭）。
 * 值内若残留裸 `"`（转义失效）则计数 >2——不锁 yjs 输出风格，只锁转义不变式 B。 */
function quoteCount(s: string): number {
  return s.split('"').length - 1;
}

describe('SA7 补充：direct yjs API 写入路径（observer/direct 独有死角）', () => {
  it("S-1：setAttribute('q', 'x\"y\\'z')（`\"` 与 `'` 同存——parse 不可构造）→ 投影良构可再校验 + 存储真值无损", () => {
    const derived = D_XML();
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    const frag = new Y.XmlFragment();
    const el = new Y.XmlElement('p');
    el.setAttribute('q', 'x"y\'z'); // 两种引号同存：任何引号外壳都无法无损包裹——只有转义可表示
    el.insert(0, [new Y.XmlText('t')]);
    frag.insert(0, [el]);
    root.set('body', frag);

    const body = extractBody(derived, doc);
    // 不变式 B：属性值段无裸 `"`（唯一属性 → 整串恰 2 个引号字符），且实体形式在场
    expect(quoteCount(body)).toBe(2);
    expect(body).toContain('&quot;');
    // 良构性 + 语义等价（值经实体解码还原 x"y'z）
    revalidateOk(derived, body);
    // 存储真值无损（Yjs 载体存真值，投影面负责语法——设计 §3 路径 C 否决理由）
    const stored = ((root.get('body') as Y.XmlFragment).get(0) as Y.XmlElement).getAttribute('q');
    expect(stored).toBe('x"y\'z');
  });

  it('S-2：嵌套 Y.XmlFragment 子树（direct API 嵌入）后代属性 `"` 转义生效（SA2 MINOR #2 递归分支）', () => {
    const derived = D_XML();
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    const outer = new Y.XmlFragment();
    const div = new Y.XmlElement('div');
    const nested = new Y.XmlFragment(); // fragment 直接占 element 子位
    const span = new Y.XmlElement('span');
    span.setAttribute('title', 'a"b');
    nested.insert(0, [span]);
    // 类型面 cast：yjs 声明 XmlElement.insert 只收 element|text，但运行时接受嵌套 fragment
    // ——SA2 MINOR #2 攻击构造的本体恰是「direct API 可达、类型不设防」的路径。
    div.insert(0, [nested as unknown as Y.XmlElement]);
    outer.insert(0, [div]);
    root.set('body', outer);

    const body = extractBody(derived, doc);
    expect(body).toContain('title="a&quot;b"');
    revalidateOk(derived, body);
    // 裸 `"` 只允许作为属性外壳（全树唯一属性 span.title → 恰 2 个引号字符）
    expect(quoteCount(body)).toBe(2);
  });
});

describe('SA7 补充：与 yjs 原生投影的镜像保真（设计 §8 实测 #3 回归锁）', () => {
  it('S-3：quote-free 复杂树（嵌套/`\'` 值/点冒名/多属性/文本 span）——自建序列化器与 yjs toString 逐字节相同', () => {
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    const frag = new Y.XmlFragment();
    const el = new Y.XmlElement('ns:item-2.x');
    el.setAttribute('b', '2');
    el.setAttribute('a', "1's");
    const child = new Y.XmlElement('inner');
    child.insert(0, [new Y.XmlText('text &amp; <literal>')]); // 文本渠道逐字（规则 1）
    el.insert(0, [child]);
    frag.insert(0, [el]);
    root.set('body', frag);

    expect(xmlFragmentToString(frag)).toBe(frag.toString()); // byte-equal（§8 实测 #3）
    expect(xmlFragmentToString(frag)).toContain("a=\"1's\""); // 属性字母序 + `'` 值不动（诊断锚）
  });

  it('S-4：valueOf 对象属性值——与 yjs 原生隐式强转镜像（42 而非 [object Object]；SA4 攻击角 [B]）', () => {
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    const frag = new Y.XmlFragment();
    const el = new Y.XmlElement('p');
    el.setAttribute('k', { valueOf: () => 42 } as unknown as string);
    frag.insert(0, [el]);
    root.set('body', frag);

    const ours = xmlFragmentToString(frag);
    expect(ours).toBe(frag.toString()); // 镜像 yjs `key + '="' + attrs[key] + '"'` 的 ToPrimitive
    expect(ours).toBe('<p k="42"></p>');
  });

  it('S-5：detached fragment → xmlFragmentToString loud throw（拒绝静默空投影；SA4 实测 #4）', () => {
    expect(() => xmlFragmentToString(new Y.XmlFragment())).toThrow(/detached|未集成/);
  });
});

describe('SA7 补充：转义纪律与表示漂移（设计 §5.2/§5.5）', () => {
  it('S-6：escapeAttrValue 只转义裸 `"`、不碰 `&`（T-13 反例防线）、幂等', () => {
    expect(escapeAttrValue('a"b')).toBe('a&quot;b');
    expect(escapeAttrValue('a&quot;b')).toBe('a&quot;b'); // 字面实体不动（不转义 &）
    expect(escapeAttrValue('&amp;<>\'')).toBe('&amp;<>\''); // 其余字符一律不动
    expect(escapeAttrValue(escapeAttrValue('a"b'))).toBe(escapeAttrValue('a"b')); // 幂等
    expect(escapeAttrValue('')).toBe('');
  });

  it('S-7：materialize → extract → re-materialize → re-extract 逐字节不动点（esc 幂等，SA4 攻击角 [E]）', () => {
    const derived = D_XML();
    const doc1 = new Y.Doc();
    const m1 = materializeRoot(derived, { body: `<p title='a"b'>x</p>` }, doc1);
    if (!m1.ok) throw new Error(`期望物化成功：${JSON.stringify(m1.issues)}`);
    const e1 = extractBody(derived, doc1);
    revalidateOk(derived, e1);

    const doc2 = new Y.Doc();
    const m2 = materializeRoot(derived, { body: e1 }, doc2);
    if (!m2.ok) throw new Error(`期望再物化成功：${JSON.stringify(m2.issues)}`);
    const e2 = extractBody(derived, doc2);
    revalidateOk(derived, e2);
    expect(e2).toBe(e1); // 一次到达不动点——跨 rematerialize 循环表示稳定

    // 存储真值（§5.5 表示漂移的显式接纳）：第一代存真值 a"b；第二代从投影再物化，
    // parse 侧逐字存储实体字面量 a&quot;b（一次性迁移，XML 语义等价——dec 后同为 a"b，
    // 且上方 e2 === e1 已证投影面一次到达不动点）。
    const attr = (d: Y.Doc) =>
      ((d.getMap('ROOT').get('body') as Y.XmlFragment).get(0) as Y.XmlElement).getAttribute('title');
    expect(attr(doc1)).toBe('a"b');
    expect(attr(doc2)).toBe('a&quot;b');
  });

  it('S-8：同一逻辑值两种写法（\'a"b\' vs "a&quot;b"）投影收敛到同一字节串（canonical 无歧义，§4.4）', () => {
    const derived = D_XML();
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const mA = materializeRoot(derived, { body: `<p title='a"b'>x</p>` }, docA);
    const mB = materializeRoot(derived, { body: `<p title="a&quot;b">x</p>` }, docB);
    if (!mA.ok || !mB.ok) throw new Error('两种写法均应物化成功');
    expect(extractBody(derived, docA)).toBe(extractBody(derived, docB));
  });
});

describe('SA7 补充：schema-independent 读路径 XML 语义', () => {
  it('S-9：readLogicalValueAtPath XML 终点返回实际载体的语义字符串', () => {
    const derived = D_XML();
    const doc = new Y.Doc();
    const m = materializeRoot(derived, { body: `<p title='a"b'>x</p>` }, doc);
    if (!m.ok) throw new Error('前置物化失败');
    const r = readLogicalValueAtPath(doc, ['body']);
    expect(r.ok).toBe(true);
    expect((r as { ok: true; value: string }).value).toBe(
      (doc.getMap('ROOT').get('body') as Y.XmlFragment).toString(),
    );
  });
});

describe('SA7 补充：observer 注入 → ⑥ 变体 C 特异性（SA4 动态审核重点②，检测面升级断言级锁定）', () => {
  it('S-10a：RT-E 场景（输入含 \'a"b\' + observer 注入 q=\'x"y\'）→ throw DOCRT-E201 **变体 C**（语义校验偏离，非变体 D）', () => {
    const derived = D_XML();
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    let done = false;
    root.observe(() => {
      if (done) return; // one-shot（G8 纪律）
      done = true;
      const body = root.get('body') as Y.XmlFragment;
      const el = body.get(0) as Y.XmlElement;
      el.setAttribute('q', 'x"y');
    });
    expect(() => materializeRoot(derived, { body: `<p title='a"b'>x</p>` }, doc)).toThrow(
      /DOCRT-E201[\s\S]*语义校验偏离[\s\S]*疑似 observer 修改已安装子树/,
    );
  });

  it('S-10b：RT-5 场景（rev2 同款：\'<p>t</p>\' + observer 注入 q=\'x"y\'）→ 修复后走变体 C（属性集差异被检测，非「防线未能运行」）', () => {
    const derived = D_XML();
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    let done = false;
    root.observe(() => {
      if (done) return;
      done = true;
      const body = root.get('body') as Y.XmlFragment;
      const el = body.get(0) as Y.XmlElement;
      el.setAttribute('q', 'x"y');
    });
    expect(() => materializeRoot(derived, { body: '<p>t</p>' }, doc)).toThrow(
      /DOCRT-E201[\s\S]*语义校验偏离/,
    );
  });
});
