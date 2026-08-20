/**
 * SA6 红灯测试 — validateSnapshot：整份 JSON 快照校验（issue #21）。
 *
 * 契约来源（任务简报冻结接缝 + ADR 0003 + 规格 §10 fixture）：
 * - 签名 `validateSnapshot(derived, snapshot)`：输入派生 schema（编译一次、校验
 *   多次）+ 任意 JSON 值；输出 `{ ok: true } | { ok: false, issues: [{ message,
 *   path }] }`；
 * - issue 带**路径段数组**（如 `["assets","abc123","duration"]`）而非行列（不复用
 *   VfslIssue）；Record 键可含任意字符，段数组零转义问题（不采用 RFC 6901 字符串）；
 * - **全收集 + 上限**：与 parseVfsl 的单错误模型不同（单错误模型只管方言层），
 *   快照校验收集全部问题，上限 100 条，超限末条为截断标记；
 * - 结构校验：封闭对象未知键拒绝、必填字段缺失报告、leaf/plain 位置不接受下钻内容；
 * - 值校验：原始类型 / 字面量枚举 / optional / Pattern（含 ReDoS 对抗用例）；
 * - 联合（ADR 0003 §3）：any-of 接受语义（至少一个成员接受即接受）；有/无判别式
 *   缓存两路径输出全等（缓存缺失/存在不得改变任何可观测行为，含错误输出）；no-match
 *   报失败距离最小成员（平局按声明序），消息标注「联合成员 i/N」相对定位；
 * - YPlainArray 子树：纯值上下文嵌套 JSON 校验（普通 JSON 数组/对象，混合联合合法）；
 * - YXmlFragment（ADR 0003 §5）：JSON 快照中其值为 XML 字符串，运行时校验仅要求
 *   良构 XML；
 * - 规格 §10 fixture 的合法/非法快照各至少一例。
 *
 * 红灯现状：validateSnapshot 尚未在包公共面导出（index.ts 仅 parseVfsl / evaluate），
 * 全部测试当前必然失败（接缝缺失即红灯，非伪红）；SA3 实现公共导出后转绿。断言
 * 全部锚定 validateSnapshot 的可观测输出（结果形状 / issue 内容 / path 段数组），
 * 不读取源码、不 grep 文本形状。
 */
import { describe, expect, it } from 'vitest';
import { parseVfsl, evaluate, validateSnapshot } from '../src/index.js';
import type { DerivedSchema, VfslModule } from '../src/index.js';

// —— 测试契约类型（任务简报冻结的 validateSnapshot 接缝形状）——

/** issue 形状：message + path 段数组（不复用 VfslIssue——无行列；段数组零转义）。 */
interface ValidateIssue {
  message: string;
  /** 段数组（如 ["assets","abc123","duration"]）；Record 键 / 数组下标均为段。 */
  path: Array<string | number>;
}

type ValidateResult =
  | { ok: true }
  | { ok: false; issues: ValidateIssue[] };

// —— 规格 §10 vfs3.assets 参考 fixture（与 parse / evaluate 侧测试同文本，已绿）——

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

// —— 测试辅助 ——

function parseOk(text: string): VfslModule {
  const result = parseVfsl(text);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`前置 parseVfsl 失败（不应发生）：${JSON.stringify(result.issues)}`);
  }
  return result.module;
}

/** parse → evaluate 全链路；断言 ok:true 并返回 derived（evaluate 已绿，前置条件）。 */
function evaluateModule(text: string): DerivedSchema {
  const result = evaluate(parseOk(text));
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`evaluate 失败（当前契约预期 ok:true）：${JSON.stringify(result.issues)}`);
  }
  return result.derived;
}

/** 深拷贝（JSON 往返）——测试间隔离，避免共享对象被校验实现意外污染。 */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * 递归删除全部 `discriminator` 键——构造「无判别式缓存」派生物。
 * 对派生物数据（validateSnapshot 的输入）做纯数据操作，非源码断言；用于锚定
 * ADR 0003 §3「缓存的缺失/存在不得改变任何可观测行为（含错误输出）」。
 */
function stripDiscriminators<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripDiscriminators(v)) as unknown as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'discriminator') continue;
      out[k] = stripDiscriminators(v);
    }
    return out as unknown as T;
  }
  return value;
}

const AUDIT = { createdBy: 'jim', createdAt: 1724000000000 };

/** §10 fixture 的合法快照（每次调用返回新对象，避免测试间共享）。 */
function validSnapshot(): Record<string, unknown> {
  return {
    assets: {
      img1: { kind: 'image', url: 'https://example.com/a.jpg', width: 800, height: 600, audit: clone(AUDIT) },
      text1: { kind: 'text', body: '<p>hello</p>', audit: clone(AUDIT) },
      file1: { kind: 'file', name: 'report.pdf', size: 2048, tags: ['a', 'b'], audit: clone(AUDIT) },
    },
    attachments: ['note.txt', 'photo.png'],
    audit: clone(AUDIT),
    keywords: ['asset', 'demo'],
    notes: 'optional note',
  };
}

// —— 测试 ——

describe('validateSnapshot — 接缝：签名、结果形状与 JSON 往返', () => {
  it('AC1：validateSnapshot 为包公共导出（函数）', () => {
    expect(typeof validateSnapshot).toBe('function');
  });

  it('AC1：合法快照 → { ok: true }（恰含 ok 键，无多余字段）', () => {
    const result = validateSnapshot(evaluateModule(FIXTURE), validSnapshot());
    expect(Object.keys(result)).toEqual(['ok']);
    expect(result).toEqual({ ok: true });
  });

  it('AC1：非法快照 → { ok: false, issues }——issue 恰含 message 与 path（无行列，不复用 VfslIssue）', () => {
    const result = validateSnapshot(evaluateModule(FIXTURE), { extra: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result)).toEqual(['ok', 'issues']);
      expect(Array.isArray(result.issues)).toBe(true);
      const first = result.issues[0];
      expect(first).toBeDefined();
      expect(Object.keys(first!)).toEqual(['message', 'path']);
      expect(typeof first!.message).toBe('string');
      expect(Array.isArray(first!.path)).toBe(true);
    }
  });

  it('AC1：结果可 JSON 序列化往返（ok 与 not-ok 两分支）', () => {
    const derived = evaluateModule(FIXTURE);
    const okResult = validateSnapshot(derived, validSnapshot());
    expect(JSON.parse(JSON.stringify(okResult))).toEqual(okResult);
    const badResult = validateSnapshot(derived, { extra: 1 });
    expect(JSON.parse(JSON.stringify(badResult))).toEqual(badResult);
  });

  it('AC1：纯函数——同输入两次校验输出全等，派生物不被修改', () => {
    const derived = evaluateModule(FIXTURE);
    const snapshot = validSnapshot();
    const before = JSON.stringify(derived);
    expect(validateSnapshot(derived, snapshot)).toEqual(validateSnapshot(derived, snapshot));
    expect(JSON.stringify(derived)).toBe(before); // 校验不得污染输入派生物
  });

  it('AC1：编译一次、校验多次——同一派生物对多份快照独立校验', () => {
    const derived = evaluateModule(FIXTURE);
    const okSnap = validSnapshot();
    const badSnap = validSnapshot();
    (badSnap as Record<string, unknown>).extra = 1;
    expect(validateSnapshot(derived, okSnap).ok).toBe(true);
    expect(validateSnapshot(derived, badSnap).ok).toBe(false);
    expect(validateSnapshot(derived, okSnap).ok).toBe(true);
  });

  it('AC1：派生 schema 以纯数据形态消费——JSON 往返后的派生物校验结果全等', () => {
    const derived = evaluateModule(FIXTURE);
    expect(validateSnapshot(clone(derived), validSnapshot())).toEqual(validateSnapshot(derived, validSnapshot()));
  });

  it('AC1：snapshot 为任意 JSON 值——非对象顶层（null/标量/数组）均报 issue', () => {
    const derived = evaluateModule(FIXTURE);
    for (const snap of [null, 42, 'str', true, []]) {
      expect(validateSnapshot(derived, snap).ok).toBe(false); // ROOT 固定物化为 Y.Map：非对象快照整体拒绝
    }
  });
});

describe('validateSnapshot — 结构校验：封闭对象 / 必填缺失 / leaf·plain 不下钻', () => {
  it('AC：封闭对象未知键拒绝——ROOT 层未声明键报错且路径为段数组', () => {
    const snap = validSnapshot();
    snap.extraKey = 1;
    const result = validateSnapshot(evaluateModule(FIXTURE), snap);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.path)).toContainEqual(['extraKey']);
    }
  });

  it('AC：封闭对象未知键拒绝——判别联合命中成员内的未声明键（含路径下钻）', () => {
    const snap = validSnapshot();
    (snap.assets as Record<string, unknown>).img1 = {
      kind: 'image',
      url: 'https://example.com/a.jpg',
      width: 800,
      height: 600,
      audit: clone(AUDIT),
      unexpected: true,
    };
    const result = validateSnapshot(evaluateModule(FIXTURE), snap);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.path)).toContainEqual(['assets', 'img1', 'unexpected']);
    }
  });

  it('AC：必填字段缺失报告 + 未知键——多错误一次报全（全收集语义）', () => {
    const result = validateSnapshot(evaluateModule(FIXTURE), { assets: {}, unknownKey: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const paths = result.issues.map((i) => i.path);
      expect(paths).toContainEqual(['attachments']); // 必填缺失
      expect(paths).toContainEqual(['audit']); // 必填缺失
      expect(paths).toContainEqual(['keywords']); // 必填缺失
      expect(paths).toContainEqual(['unknownKey']); // 未知键
      expect(result.issues).toHaveLength(4); // 同一调用一次报全
    }
  });

  it('AC：optional 字段缺失合法（notes 可缺省）', () => {
    const snap = validSnapshot();
    delete snap.notes;
    expect(validateSnapshot(evaluateModule(FIXTURE), snap).ok).toBe(true);
  });

  it('AC：leaf 位置不接受下钻内容——标量字段收到对象/数组即报错', () => {
    const derived = evaluateModule(FIXTURE);
    const snapA = validSnapshot();
    snapA.notes = { deep: true }; // YLeaf<string> 位置收到对象
    const rA = validateSnapshot(derived, snapA);
    expect(rA.ok).toBe(false);
    if (!rA.ok) {
      expect(rA.issues.map((i) => i.path)).toContainEqual(['notes']);
    }

    const snapB = validSnapshot();
    (snapB.keywords as unknown[])[1] = { deep: true }; // YLeaf<string>[] 元素收到对象
    const rB = validateSnapshot(derived, snapB);
    expect(rB.ok).toBe(false);
    if (!rB.ok) {
      const p = rB.issues.map((i) => i.path).find((path) => path[0] === 'keywords');
      expect(p).toBeDefined();
      expect(p!.length).toBe(2); // ["keywords", <元素段>]
    }
  });

  it('AC：plain 位置不接受下钻内容——YPlainArray 收到非数组对象即报错', () => {
    const derived = evaluateModule(FIXTURE);
    const snap = validSnapshot();
    snap.attachments = { nested: true };
    const result = validateSnapshot(derived, snap);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.path)).toContainEqual(['attachments']);
    }
  });
});

describe('validateSnapshot — 值校验：原始类型 / 字面量枚举 / optional / Pattern', () => {
  it('AC：原始类型校验——string/number/boolean/null/unknown 各自认领值域', () => {
    const derived = evaluateModule('type ROOT = { s: string; n: number; b: boolean; z: null; u: unknown };');
    expect(validateSnapshot(derived, { s: 'x', n: 3.14, b: false, z: null, u: { anything: 1 } }).ok).toBe(true);
    const bad = validateSnapshot(derived, { s: 42, n: '42', b: 'true', z: 'null' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      const paths = bad.issues.map((i) => i.path);
      expect(paths).toContainEqual(['s']);
      expect(paths).toContainEqual(['n']);
      expect(paths).toContainEqual(['b']);
      expect(paths).toContainEqual(['z']);
      expect(bad.issues).toHaveLength(4); // unknown 接受任意值 → 不报
    }
  });

  it('AC：字面量枚举——命中成员值通过，未声明字面量拒绝', () => {
    const derived = evaluateModule(FIXTURE);
    expect(validateSnapshot(derived, validSnapshot()).ok).toBe(true); // kind: image/text/file 均在枚举内
    const snap = validSnapshot();
    (snap.assets as Record<string, unknown>).img1 = {
      kind: 'video', // 不在 "image" | "text" | "file" 枚举
      url: 'u', width: 1, height: 1, audit: clone(AUDIT),
    };
    const bad = validateSnapshot(derived, snap);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.issues.map((i) => i.path)).toContainEqual(['assets', 'img1', 'kind']);
    }
  });

  it('AC：字面量联合（枚举）——端口 80/443 接受，8080 拒绝', () => {
    const derived = evaluateModule('type ROOT = { port: 80 | 443 };');
    expect(validateSnapshot(derived, { port: 80 }).ok).toBe(true);
    expect(validateSnapshot(derived, { port: 443 }).ok).toBe(true);
    const bad = validateSnapshot(derived, { port: 8080 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.issues.map((i) => i.path)).toContainEqual(['port']);
    }
  });

  it('AC：Pattern 正则——匹配通过、不匹配拒绝（锚定由正则显式表达）', () => {
    const derived = evaluateModule('type ROOT = { name: string & Pattern<"^[a-z]{2,4}$"> };');
    expect(validateSnapshot(derived, { name: 'ab' }).ok).toBe(true);
    expect(validateSnapshot(derived, { name: 'abcd' }).ok).toBe(true);
    const bad = validateSnapshot(derived, { name: 'AB' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.issues.map((i) => i.path)).toContainEqual(['name']);
    }
  });

  it('AC：Record 键 Pattern——fixture AssetId 合法键通过、含 "." 键拒绝', () => {
    const derived = evaluateModule(FIXTURE);
    expect(validateSnapshot(derived, validSnapshot()).ok).toBe(true);
    const snap = validSnapshot();
    (snap.assets as Record<string, unknown>)['abc.123'] = {
      kind: 'image', url: 'u', width: 1, height: 1, audit: clone(AUDIT),
    };
    // 键不满足 ^[A-Za-z0-9_\-]{1,64}$（含 "."）→ 键模式失败
    expect(validateSnapshot(derived, snap).ok).toBe(false);
  });

  it('AC：Pattern ReDoS 对抗——灾难性回溯正则对长非匹配输入不挂死（vitest 默认 5s 超时兜底）', () => {
    // 经典灾难性回溯 (a+)+$：对 'a'*32+'!' 朴素 RegExp 需指数级回溯（远超 5s）；
    // 实现须有 ReDoS 防护（安全引擎 / 输入长度上限等）——对抗成功即通过
    const derived = evaluateModule('type ROOT = { name: string & Pattern<"(a+)+$"> };');
    const result = validateSnapshot(derived, { name: 'a'.repeat(32) + '!' });
    expect(result.ok).toBe(false); // 值确实不匹配该正则（$ 前有 '!'）
  });
});

describe('validateSnapshot — 联合：any-of 接受 / 判别式缓存透明 / no-match 最小距离', () => {
  it('AC：联合 any-of 接受语义——三种 kind 各自命中成员即接受（判别式缓存跳转路径）', () => {
    const derived = evaluateModule(FIXTURE);
    expect(validateSnapshot(derived, validSnapshot()).ok).toBe(true); // image/text/file 三成员齐备
    for (const asset of [
      { kind: 'image', url: 'u', width: 1, height: 1, audit: clone(AUDIT) },
      { kind: 'text', body: '<p>x</p>', audit: clone(AUDIT) },
      { kind: 'file', name: 'n', size: 1, tags: [], audit: clone(AUDIT) },
    ]) {
      const single = validateSnapshot(derived, {
        assets: { a1: asset }, attachments: [], audit: clone(AUDIT), keywords: [],
      });
      expect(single.ok).toBe(true);
    }
  });

  it('AC：联合 any-of 无判别式缓存路径——ref 成员按名解析后逐成员尝试', () => {
    // A 为 ref 成员（非内联对象）→ evaluate 不附判别式缓存 → 纯「逐个尝试」路径
    const derived = evaluateModule('type A = { kind: "a"; x: string }; type ROOT = { m: A | { kind: "b"; x: string } };');
    expect(validateSnapshot(derived, { m: { kind: 'a', x: 'ok' } }).ok).toBe(true);
    expect(validateSnapshot(derived, { m: { kind: 'b', x: 'ok' } }).ok).toBe(true);
    expect(validateSnapshot(derived, { m: { kind: 'c', x: 'ok' } }).ok).toBe(false);
  });

  it('AC：判别式缓存透明——有/无缓存两路径对匹配快照输出全等（ADR 0003 §3）', () => {
    const derived = evaluateModule(FIXTURE);
    const withoutCache = stripDiscriminators(clone(derived));
    expect(validateSnapshot(derived, validSnapshot())).toEqual(validateSnapshot(withoutCache, validSnapshot()));
  });

  it('AC：判别式缓存透明——有/无缓存两路径对 no-match 快照输出全等（含错误输出）', () => {
    const derived = evaluateModule(FIXTURE);
    const withoutCache = stripDiscriminators(clone(derived));
    const snap = validSnapshot();
    (snap.assets as Record<string, unknown>).img1 = { kind: 'video' }; // 判别值未命中缓存 → 回流同一诊断生成器
    const withCache = validateSnapshot(derived, snap);
    const without = validateSnapshot(withoutCache, snap);
    expect(withCache).toEqual(without);
    expect(withCache.ok).toBe(false);
  });

  it('AC：no-match 报失败距离最小成员——「联合成员 i/N」相对定位（fixture：text 成员失败距离最小）', () => {
    const derived = evaluateModule(FIXTURE);
    const snap = validSnapshot();
    (snap.assets as Record<string, unknown>).img1 = { kind: 'video' }; // 三成员均不匹配
    const result = validateSnapshot(derived, snap);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // 距离：text 成员仅缺 body/audit 两字段（image 缺 4、file 缺 4）→ 报成员 2/3
      expect(result.issues.some((i) => i.message.includes('联合成员 2/3'))).toBe(true);
    }
  });

  it('AC：no-match 平局按声明序——等距时报先声明成员', () => {
    const derived = evaluateModule('type ROOT = { m: { kind: "a"; x: string } | { kind: "b"; x: string } };');
    const result = validateSnapshot(derived, { m: { x: 42 } }); // 两成员同样缺 kind 且 x 类型错 → 平局
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.message.includes('联合成员 1/2'))).toBe(true);
    }
  });

  it('AC：候选分支 dive 的字段级 issue 带「联合成员 i/N」相对定位（ADR 0003 §3 字面）', () => {
    // kind 命中 image（text 被判别值硬矛盾过滤）→ 候选分支下钻，width 类型错
    const derived = evaluateModule('type ROOT = { m: { kind: "image"; width: number } | { kind: "text"; body: string } };');
    const result = validateSnapshot(derived, { m: { kind: 'image', width: 'x' } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]!.message).toContain('联合成员 1/2：');
      expect(result.issues[0]!.path).toEqual(['m', 'width']);
    }
  });
});

describe('validateSnapshot — YPlainArray 纯值上下文嵌套 JSON', () => {
  // 测试文本修正（设计 §11.1，SA2 #2 授权）：原文本 `YPlainArray<{…}[]>` 派生为双重
  // 数组，两条断言在忠实实现下均不可满足——按 §11.1 定稿去掉多余一层 `[]`，
  // 断言逻辑零改动；双重数组语义由下一用例锁定。
  it('AC：纯值上下文嵌套 JSON——元素为对象时按封闭对象校验（含下钻路径）', () => {
    const derived = evaluateModule('type ROOT = { items: YPlainArray<{ name: string; count: number }> };');
    expect(validateSnapshot(derived, { items: [{ name: 'a', count: 1 }] }).ok).toBe(true);
    expect(validateSnapshot(derived, { items: [] }).ok).toBe(true);
    const bad = validateSnapshot(derived, { items: [{ name: 'a', count: 'x' }] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      const p = bad.issues.map((i) => i.path).find((path) => path[path.length - 1] === 'count');
      expect(p).toBeDefined();
      expect(p![0]).toBe('items'); // ["items", <元素段>, "count"]
      expect(p!.length).toBe(3);
    }
  });

  // 双重数组锁例（设计 §11.1-2）：`YPlainArray<T[]>` 忠实解释 = 元素是 `T[]`（#20 冻结
  // 映射 `YPlainArray<T> → { kind:'array', element: valueOf(T) }`，此处 T 本身又是一层
  // array）。禁止任何「拍平兜底」（§11.1-3 负面清单）。
  it('AC：双重数组忠实解释——YPlainArray<{…}[]> 元素为数组（#20 映射锁例）', () => {
    const derived = evaluateModule('type ROOT = { items: YPlainArray<{ name: string; count: number }[]> };');
    expect(validateSnapshot(derived, { items: [[{ name: 'a', count: 1 }]] }).ok).toBe(true); // 元素是 {…}[]
    expect(validateSnapshot(derived, { items: [{ name: 'a', count: 1 }] }).ok).toBe(false); // 单层对象不是数组
  });

  it('AC：纯值上下文混合联合合法——标量与对象成员并存，任一命中即接受', () => {
    const derived = evaluateModule('type ROOT = { items: YPlainArray<string | { a: number }> };');
    expect(validateSnapshot(derived, { items: ['s', { a: 1 }] }).ok).toBe(true);
    expect(validateSnapshot(derived, { items: [{ b: 1 }] }).ok).toBe(false); // 对象成员封闭：未知键 b 拒绝
    expect(validateSnapshot(derived, { items: [42] }).ok).toBe(false); // 非联合成员
  });
});

describe('validateSnapshot — YXmlFragment：XML 字符串 + 良构要求（ADR 0003 §5）', () => {
  it('AC：快照值为 XML 字符串——良构通过、非良构拒绝、非字符串拒绝', () => {
    const derived = evaluateModule(FIXTURE);
    const okSnap = validSnapshot();
    (okSnap.assets as Record<string, unknown>).text1 = {
      kind: 'text', body: '<p>hello <b>world</b></p>', audit: clone(AUDIT),
    };
    expect(validateSnapshot(derived, okSnap).ok).toBe(true);

    const malformedSnap = validSnapshot();
    (malformedSnap.assets as Record<string, unknown>).text1 = {
      kind: 'text', body: '<p>unclosed', audit: clone(AUDIT),
    };
    const malformed = validateSnapshot(derived, malformedSnap);
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) {
      expect(malformed.issues.map((i) => i.path)).toContainEqual(['assets', 'text1', 'body']);
    }

    const typeSnap = validSnapshot();
    (typeSnap.assets as Record<string, unknown>).text1 = {
      kind: 'text', body: 42, audit: clone(AUDIT),
    };
    expect(validateSnapshot(derived, typeSnap).ok).toBe(false); // 非字符串
  });
});

describe('validateSnapshot — path 段数组：Record 键特殊字符零转义', () => {
  it('AC：含特殊字符 Record 键时段数组无歧义——整段相等、零转义', () => {
    const derived = evaluateModule('type ROOT = { m: Record<string, { v: number }> };');
    const result = validateSnapshot(derived, {
      m: {
        'a.b|c[d]': { v: 'x' },
        '路径/段': { v: 'x' },
        v: { v: 'x' }, // 键与字段同名也不混淆（段数组天然消歧）
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const paths = result.issues.map((i) => i.path);
      expect(paths).toContainEqual(['m', 'a.b|c[d]', 'v']);
      expect(paths).toContainEqual(['m', '路径/段', 'v']);
      expect(paths).toContainEqual(['m', 'v', 'v']);
      expect(result.issues).toHaveLength(3);
    }
  });
});

describe('validateSnapshot — 全收集 + 100 条上限 + 截断标记', () => {
  it('AC：全收集上限——100 条真实 issue + 末条截断标记', () => {
    const derived = evaluateModule('type ROOT = { items: number[] };');
    const snap = { items: Array.from({ length: 150 }, () => 'not-a-number') };
    const result = validateSnapshot(derived, snap);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toHaveLength(101); // 契约读法：上限 100 条真实 issue，超限末条为截断标记
      const marker = result.issues[100];
      expect(marker).toBeDefined();
      expect(marker!.message).toMatch(/截断|truncat/i); // 标记须可区分于真实 issue（具体措辞留给实现）
      expect(Array.isArray(marker!.path)).toBe(true);
    }
  });
});

describe('validateSnapshot — 规格 §10 fixture：合法 / 非法快照', () => {
  it('AC：fixture 合法快照（六标记全出现、三成员齐备、含可选 notes）→ ok:true', () => {
    expect(validateSnapshot(evaluateModule(FIXTURE), validSnapshot()).ok).toBe(true);
  });

  it('AC：fixture 非法快照——多处独立错误一次报全（值/结构/嵌套 ref 内错误）', () => {
    const derived = evaluateModule(FIXTURE);
    const snap = {
      assets: {
        img1: { kind: 'image', url: 42, width: '800', height: 600, audit: { createdBy: 'j', createdAt: 'x' } },
      },
      attachments: 'not-an-array',
      audit: { createdBy: 7, createdAt: 1724000000000 },
      keywords: [true],
      notes: 42,
    };
    const result = validateSnapshot(derived, snap);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const paths = result.issues.map((i) => i.path);
      expect(paths).toContainEqual(['assets', 'img1', 'url']); // url 非 string
      expect(paths).toContainEqual(['assets', 'img1', 'width']); // width 非 number
      expect(paths).toContainEqual(['assets', 'img1', 'audit', 'createdAt']); // 嵌套 Audit ref 内类型错误
      expect(paths).toContainEqual(['attachments']); // plain 位置收到字符串
      expect(paths).toContainEqual(['audit', 'createdBy']); // Audit ref 内类型错误
      expect(paths).toContainEqual(['notes']); // optional 在场但类型错
      expect(paths.some((p) => p[0] === 'keywords' && p.length === 2)).toBe(true); // 数组元素类型错
      expect(result.issues).toHaveLength(7);
    }
  });
});
