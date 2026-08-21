/**
 * 设计强制守卫测试 A（issue #54 / H3，SA3 实现）——SHA-256 缓存键的正确性与单射性。
 *
 * 依据：task_docscope-compile-cache_design.md §5.4（R2/A1 扩展 RT-1 两层）。
 * SA6 验收测试无法观察哈希正确性与键单射性（键不外露——正确但非单射的错误哈希
 * 照样过 AC1/AC2，正是 SA2 A1 的教训）。本测试把哈希钉死在标准答案上（FIPS 180-4 /
 * RFC 3629 KAT，期望值经 node:crypto 独立复核，设计 §9 #3/#7）、把单射性钉死在
 * 攻击对上（lone surrogate / U+FFFD——R1 的 U+FFFD 替换编码下三者坍缩同键必红，
 * R2 的 WTF-8 区别性段（ED A0 80–ED BF BF）下全绿）。
 *
 * 断言形态冻结（设计 §5.4 原文）；本文件不在 SA6 owned 清单内，由 SA3 实现并维护。
 */
import { describe, expect, it } from 'vitest';
import { evaluate, getCompiled, parseVfsl } from '../src/index.js';
import { sha256Hex } from '../src/sha256.js';

describe('sha256Hex — KAT（FIPS 180-4 / RFC 3629 标准答案，设计 §5.3 锚定）', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
     '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
    ['ä', '33e6d73fee82904c8d7afb78de1154d1e8dc2a0edb08120e63df5b9385c2d9cc'],          // 2 字节 UTF-8
    ['中文abc', '0f3f66d4223ba850a775f6fac666ed7265eba9c88c9867c03679a1c28125b89f'],      // 3 字节
    ['aä𝐀🙂', '2485e7c89fa37590f1654be2b9489d351208ece915011e65047d063313c1f693'],      // 星面（代理对路径）
  ])('sha256Hex(%j) === 标准答案', (input, expected) => {
    expect(sha256Hex(input)).toBe(expected);
  });

  it('确定性：同文本两次调用恒等；相邻文本（仅空白差异）键必异（AC2 机制根基）', () => {
    const t = 'type ROOT = { a: string; };';
    expect(sha256Hex(t)).toBe(sha256Hex(t));
    expect(sha256Hex(t)).not.toBe(sha256Hex(`${t}\n`));
    expect(sha256Hex(t)).not.toBe(sha256Hex('type  ROOT = { a: string; };'));
  });
});

// RT-1 KAT 层（R2/A1，SA2 红线锚点——R1 的 U+FFFD 替换编码下必红、WTF-8 下绿）：
// lone surrogate 与 U+FFFD、lone surrogate 彼此——键必须互异（WTF-8 期望摘要经
// 手构字节序列 + node:crypto 复核，设计 §9 #7）。
describe('sha256Hex — 键单射性（WTF-8 代理段，设计 §D8.2 锚定 / SA2 A1）', () => {
  it.each([
    ['\uD800', '91a681b998555fb475479817b126c94e57e52011fa1842c5d188795a4a05226b'],  // ED A0 80
    ['\uDC00', 'b2d612a08bec1f41120ebd961f62ef19678375b5788c70d3f8f4c02e345ed412'],  // ED B0 80
    ['\uFFFD', '83d544ccc223c057d2bf80d3f2a32982c32c3c0db8e2674820da5064783fb097'],  // EF BF BD（对照）
  ])('WTF-8 单射向量 sha256Hex(%j) === 期望', (input, expected) => {
    expect(sha256Hex(input)).toBe(expected);
  });

  it('lone surrogate / U+FFFD / 彼此键互异（INV-2 单射辖域；R1 替换编码下坍缩同键 → 红）', () => {
    expect(sha256Hex('\uD800')).not.toBe(sha256Hex('\uFFFD'));
    expect(sha256Hex('\uD800')).not.toBe(sha256Hex('\uDC00'));
    expect(sha256Hex('\uFFFD')).not.toBe(sha256Hex('\uDC00'));
    expect(sha256Hex('\uDBFF')).not.toBe(sha256Hex('\uDFFF'));
  });
});

// RT-1 集成层（R2/A1）：攻击对走完整 getCompiled——doc 注释与字符串字面量两个
// 「藏身处」各一对（tokenize/parse/evaluate 均接受 lone surrogate，fixture 先自检）。
// R1 设计下第二成员命中第一成员条目（引用互异断言 + 深相等断言双红）；R2 下全绿。
describe('getCompiled — 键单射性集成锚（SA2 A1 攻击对）', () => {
  /** 新鲜直编对照（不经缓存）。 */
  function freshDerived(text: string): unknown {
    const p = parseVfsl(text);
    expect(p.ok).toBe(true);
    if (!p.ok) throw new Error('fixture 自检失败（parseVfsl）');
    const e = evaluate(p.module);
    expect(e.ok).toBe(true);
    if (!e.ok) throw new Error('fixture 自检失败（evaluate）');
    return e.derived;
  }
  type Ok = { ok: true; module: unknown; derived: unknown };
  function okOf(r: ReturnType<typeof getCompiled>): Ok {
    expect(r.ok).toBe(true);
    return r as Ok;
  }
  // 藏身处 1：doc 注释（块注释任意码点 + 码元级切片，tokenizer.ts:131-178）
  // 藏身处 2：字符串字面量（value += cc 任意码点，tokenizer.ts:218-266）
  const PAIRS: Array<[string, string]> = [
    ['/** note \uD800 */ type ROOT = { a: string; };', '/** note \uFFFD */ type ROOT = { a: string; };'],
    ['type ROOT = { a: "\uD800"; };', 'type ROOT = { a: "\uFFFD"; };'],
  ];
  it.each(PAIRS.map((pair, i) => [`藏身处-${i + 1}`, pair] as const))(
    '%s：仅相差 lone surrogate vs U+FFFD 的两条合法文本 → 独立条目、各自派生物正确',
    (_label, [textP, textQ]) => {
      const p = okOf(getCompiled(textP));
      const q = okOf(getCompiled(textQ));
      expect(p).not.toBe(q); // 容器引用互异（R1 坍缩下红）
      expect(p.module).not.toBe(q.module);
      expect(p.derived).not.toBe(q.derived);
      expect(p.derived).toEqual(freshDerived(textP)); // 各自派生物对应自身文本
      expect(q.derived).toEqual(freshDerived(textQ)); // （R1 下 Q 命中 P 条目 → 红）
    },
  );
});
