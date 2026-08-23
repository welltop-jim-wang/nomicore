/**
 * SA6 红灯测试 — validatePatch：路径级写入校验 + 数组三操作（issue #53 / H2）。
 *
 * 契约来源（任务简报 AC + ADR 0003 §3/§4/§5 + ADR 0004 D1/D2 + CONTEXT「重建校验/
 * 结构树/封闭对象/整文档校验」）：
 *
 * - 接缝（简报「What to build」+ AC1，D1 词表镜像命名）：
 *     validatePatch(derived, base, path, value) → ValidateResult
 *     validateAppendToArray(derived, base, path, value) → ValidateResult
 *     validateInsertIntoArray(derived, base, path, index, value) → ValidateResult
 *     validateDeleteFromArray(derived, base, path, index) → ValidateResult
 *   `base` = 当前 ROOT 快照值（与 validateLogicalSnapshot 的 snapshot 同形状）；`path` =
 *   段数组（string | number），顶段即 ROOT 字段（不含 ROOT 前缀，ADR 0004 D5）；
 *   数组操作 `value` = 单元素值（D1 PathElementValue 的运行时面），insert/delete
 *   的 index 为显式参数。同步、纯函数、不抛错；结果纯 JSON 值。
 * - 两段判定（ADR 0002「结构 → 值」两步）：
 *   ① 结构守卫（结构树，与值语义正交）：路径存在性「任一成员出现即存在」
 *      （ADR 0003 §3）；leaf / plain / xml-fragment 为终态，拒绝下钻（ADR 0003
 *      §5、ADR 0004 D1「YPlainArray 只能整体替换」）；封闭对象未知键 → 路径不
 *      存在（CONTEXT「封闭对象」）；数组下标越界 = 运行时错误（替换语义，D1）。
 *      拒绝必须带精确 path（AC2）。
 *   ② 值校验：最近结构边界重建整值（base + patch 合并）整体过子 schema
 *      （CONTEXT「重建校验」）——判别联合只有看到判别字段才知道按哪个变体验；
 *      联合 no-match 复用 validateLogicalSnapshot 同一诊断生成器：报失败距离最小成员、
 *      消息带「联合成员 i/N」相对定位（ADR 0003 §3，AC3）；判别式缓存缺失/存在
 *      不改变可观测行为（ADR 0003 §3）。
 * - 数组合法下标替换通过；insert（含末尾 append 语义）/ delete 的元素类型校验
 *   （AC4）。
 * - 解释器单一来源：validateLogicalSnapshot 与 validatePatch 共用解释器（AC5）——可观测
 *   锚点：同重建值下 validatePatch 的 issue 与 validateLogicalSnapshot 的 issue 全等
 *   （message + path），ref 链解析行为一致。
 * - 全收集 + 上限语义与 validateLogicalSnapshot 一致（AC6）：一次调用收集全部问题，上限
 *   100 条真实 issue，超限末条为截断标记。
 *
 * 红灯现状：validatePatch / validateAppendToArray / validateInsertIntoArray /
 * validateDeleteFromArray 尚未实现（全仓无任何实现，仅 ADR/简报文本提及），包公共
 * 面 index.ts 无导出——本文件导入即失败，全部测试当前必然红（接缝缺失即红灯，非
 * 伪红）。断言全部锚定可观测运行时行为（结果形状 / issue 内容 / path 段数组 / 与
 * validateLogicalSnapshot 的等价性），不读取源码、不 grep 文本形状。
 */
import { describe, expect, it } from 'vitest';
import {
  parseVfsl,
  evaluate,
  validateLogicalSnapshot,
  validatePatch,
  validateAppendToArray,
  validateInsertIntoArray,
  validateDeleteFromArray,
} from '../src/index.js';
import type { DerivedSchema, VfslModule } from '../src/index.js';

// —— 测试契约类型（任务简报冻结的 ValidateResult 形状，镜像 validate.ts 导出）——

interface ValidateIssue {
  message: string;
  path: Array<string | number>;
}

type ValidateResult = { ok: true } | { ok: false; issues: ValidateIssue[] };

// —— fixture ——

/** 规格 §10 参考 fixture（与 validate-snapshot 侧测试同文本）：assets 判别联合 + plain + array。 */
const FIXTURE = `
/** vfs3.assets — 依据 issue #9 描述还原（原设计文档缺位） */
type AssetId = string & Pattern<"^[A-Za-z0-9_\\\\-]{1,64}$">;
type Audit = YMap<{ createdBy: YLeaf<string>; createdAt: YLeaf<number>; }>;
type AssetEntity =
  | { kind: "image"; url: YLeaf<string>; width: YLeaf<number>; height: YLeaf<number>; audit: Audit }
  | { kind: "text"; body: YXmlFragment<{ paragraphs: YArray<YLeaf<string>> }>; audit: Audit }
  | { kind: "file"; name: YLeaf<string>; size: YLeaf<number>; tags: YArray<YLeaf<string>>; audit: Audit };
type Attachments = YPlainArray<YLeaf<string>>;
type ROOT = YMap<{
  assets: Record<AssetId, AssetEntity>;
  attachments: Attachments;
  audit: Audit;
  notes?: YLeaf<string>;
  keywords: YLeaf<string>[];
}>;
`.trim();

/** 结构守卫 fixture：封闭对象 / leaf / YArray / YPlainArray 四类位。 */
const GUARD_FIXTURE = `
type ROOT = {
  profile: { displayName: string };
  name: string;
  items: YArray<YLeaf<string>>;
  attachments: YPlainArray<YLeaf<string>>;
};
`.trim();

/** 判别联合 fixture：kind 判别字段 + 成员互异字段（交叉写入 / 类型错场景）。 */
const UNION_FIXTURE = `
type ROOT = { m: { kind: "a"; x: string } | { kind: "b"; y: string } };
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

/** 深拷贝（JSON 往返）——测试间隔离。 */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** 递归删除全部 `discriminator` 键——构造「无判别式缓存」派生物（ADR 0003 §3 透明性）。 */
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

/** §10 fixture 的合法快照（每次调用返回新对象）。 */
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

/** 沿 path 应用替换（number 段按数组下标；测试辅助，等价于一次 patch 写入）。 */
function applyPath<T>(obj: T, path: Array<string | number>, value: unknown): T {
  const rebuilt = clone(obj) as Record<string, unknown>;
  let cur: unknown = rebuilt;
  for (let i = 0; i < path.length - 1; i++) {
    cur = (cur as Record<string, unknown>)[String(path[i]!)];
  }
  (cur as Record<string, unknown>)[String(path[path.length - 1]!)] = value;
  return rebuilt as unknown as T;
}

// —— 测试 ——

describe('validatePatch — 接缝：导出、签名、结果形状与纯函数性（AC1）', () => {
  it('AC1：validatePatch 与数组三操作均为包公共导出（函数）', () => {
    expect(typeof validatePatch).toBe('function');
    expect(typeof validateAppendToArray).toBe('function');
    expect(typeof validateInsertIntoArray).toBe('function');
    expect(typeof validateDeleteFromArray).toBe('function');
  });

  it('AC1：合法 patch → { ok: true }（恰含 ok 键，无多余字段）', () => {
    const derived = evaluateModule(GUARD_FIXTURE);
    const base = { profile: { displayName: 'jim' }, name: 'jim', items: ['a', 'b'], attachments: ['x'] };
    const result = validatePatch(derived, base, ['profile', 'displayName'], 'bob');
    expect(Object.keys(result)).toEqual(['ok']);
    expect(result).toEqual({ ok: true });
  });

  it('AC1：非法 patch → { ok: false, issues }——issue 恰含 message 与 path（无行列）', () => {
    const derived = evaluateModule(GUARD_FIXTURE);
    const base = { profile: { displayName: 'jim' }, name: 'jim', items: ['a', 'b'], attachments: ['x'] };
    const result = validatePatch(derived, base, ['zzz'], 1);
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
    const derived = evaluateModule(GUARD_FIXTURE);
    const base = { profile: { displayName: 'jim' }, name: 'jim', items: ['a', 'b'], attachments: ['x'] };
    const okResult = validatePatch(derived, base, ['name'], 'bob');
    expect(JSON.parse(JSON.stringify(okResult))).toEqual(okResult);
    const badResult = validatePatch(derived, base, ['zzz'], 1);
    expect(JSON.parse(JSON.stringify(badResult))).toEqual(badResult);
  });

  it('AC1：纯函数——同输入两次调用输出全等；derived 与 base 不被修改', () => {
    const derived = evaluateModule(GUARD_FIXTURE);
    const base = { profile: { displayName: 'jim' }, name: 'jim', items: ['a', 'b'], attachments: ['x'] };
    const derivedBefore = JSON.stringify(derived);
    const baseBefore = JSON.stringify(base);
    expect(validatePatch(derived, base, ['name'], 42)).toEqual(validatePatch(derived, base, ['name'], 42));
    expect(validatePatch(derived, base, ['profile', 'displayName'], 'bob')).toEqual(validatePatch(derived, base, ['profile', 'displayName'], 'bob'));
    expect(JSON.stringify(derived)).toBe(derivedBefore); // 校验不得污染输入派生物
    expect(JSON.stringify(base)).toBe(baseBefore); // 校验不得污染 base
  });

  it('AC1：同步、不抛错——结构拒绝/值拒绝/异常输入均以结果返回，异常不外泄', () => {
    const derived = evaluateModule(GUARD_FIXTURE);
    const base = { profile: { displayName: 'jim' }, name: 'jim', items: ['a', 'b'], attachments: ['x'] };
    expect(() => validatePatch(derived, base, ['name', 'deep'], 'x')).not.toThrow();
    expect(() => validatePatch(derived, base, ['items', 5], 'x')).not.toThrow();
    expect(() => validatePatch(derived, null, ['name'], 'x')).not.toThrow(); // base 非对象 → 拒绝而非抛错
    expect(validatePatch(derived, null, ['name'], 'x').ok).toBe(false);
    expect(validatePatch(derived, base, ['name', 'deep'], 'x').ok).toBe(false);
    expect(validatePatch(derived, base, ['items', 5], 'x').ok).toBe(false);
  });
});

describe('validatePatch — 结构守卫：未知键 / leaf 下钻 / plain 下钻 / 越界替换（AC2）', () => {
  const BASE = { profile: { displayName: 'jim' }, name: 'jim', items: ['a', 'b'], attachments: ['x'] };

  it('AC2：未知键路径——封闭对象深层未声明键拒绝，issue path 为精确段数组', () => {
    const derived = evaluateModule(GUARD_FIXTURE);
    const result = validatePatch(derived, BASE, ['profile', 'nickname'], 'n');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.path)).toContainEqual(['profile', 'nickname']);
    }
  });

  it('AC2：未知键路径——ROOT 层未声明键拒绝', () => {
    const derived = evaluateModule(GUARD_FIXTURE);
    const result = validatePatch(derived, BASE, ['zzz'], 1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.path)).toContainEqual(['zzz']);
    }
  });

  it('AC2：leaf 下钻——路径穿过 leaf 终态（再下钻一层）拒绝并带精确 path', () => {
    const derived = evaluateModule(GUARD_FIXTURE);
    const result = validatePatch(derived, BASE, ['name', 'deep'], 'x');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.path)).toContainEqual(['name', 'deep']);
    }
  });

  it('AC2：plain 下钻——YPlainArray 位拒绝下标下钻（只能整体替换，ADR 0004 D1）', () => {
    const derived = evaluateModule(GUARD_FIXTURE);
    const result = validatePatch(derived, BASE, ['attachments', 0], 'y');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.path)).toContainEqual(['attachments', 0]);
    }
  });

  it('AC2：xml-fragment 下钻——YXmlFragment 为结构树终态，下钻到此为止（ADR 0003 §5）', () => {
    const derived = evaluateModule(FIXTURE);
    const result = validatePatch(derived, validSnapshot(), ['assets', 'text1', 'body', 'deep'], '<p>x</p>');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.path)).toContainEqual(['assets', 'text1', 'body', 'deep']);
    }
  });

  it('AC2：数组下标越界 = 运行时错误（替换语义）——index ≥ length 拒绝并带精确 path', () => {
    const derived = evaluateModule(GUARD_FIXTURE);
    const result = validatePatch(derived, BASE, ['items', 5], 'x'); // length 2，替换下标 5
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.path)).toContainEqual(['items', 5]);
    }
  });

  it('AC2：plain 整体替换合法——YPlainArray 位收到整值数组通过（唯一允许的写入形态）', () => {
    const derived = evaluateModule(GUARD_FIXTURE);
    expect(validatePatch(derived, BASE, ['attachments'], ['y', 'z']).ok).toBe(true);
  });

  it('AC2：plain 整体替换值非法——非数组整值拒绝（纯值上下文按值 schema 校验）', () => {
    const derived = evaluateModule(GUARD_FIXTURE);
    const result = validatePatch(derived, BASE, ['attachments'], 'not-an-array');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.path)).toContainEqual(['attachments']);
    }
  });

  it('AC2：合法深层替换通过——封闭对象成员字段写入', () => {
    const derived = evaluateModule(GUARD_FIXTURE);
    expect(validatePatch(derived, BASE, ['profile', 'displayName'], 'bob').ok).toBe(true);
  });
});

describe('validatePatch — 重建语义：union 成员写入他成员字段 → any-of 全拒绝（AC3）', () => {
  it('AC3：向 union 成员写入他成员字段——重建后 any-of 全拒绝，报「联合成员 i/N」相对定位', () => {
    const derived = evaluateModule(FIXTURE);
    const base = validSnapshot();
    // img1 是 image 成员；body 是 text 成员独有字段（D2：类型层放行、运行时查成员适配）
    const result = validatePatch(derived, base, ['assets', 'img1', 'body'], '<p>x</p>');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const issue = result.issues.find((i) => i.path[0] === 'assets' && i.path[1] === 'img1' && i.path[2] === 'body');
      expect(issue).toBeDefined();
      // 重建后 { kind:"image", …, body } 三成员全拒绝：image 未知字段 body（距离 1）/
      // text 判别字段错（距离 1）→ 平局按声明序报成员 1/3；消息带「联合成员 i/N」（ADR 0003 §3）
      expect(issue!.message).toContain('联合成员 1/3');
    }
  });

  it('AC3：交叉写入与 validateLogicalSnapshot 同源——同重建值下 issue（message+path）与整快照校验全等（AC5 单一来源）', () => {
    const derived = evaluateModule(FIXTURE);
    const base = validSnapshot();
    const rebuilt = applyPath(base, ['assets', 'img1', 'body'], '<p>x</p>');
    const viaSnapshot = validateLogicalSnapshot(derived, rebuilt);
    expect(viaSnapshot.ok).toBe(false);
    const viaPatch = validatePatch(derived, base, ['assets', 'img1', 'body'], '<p>x</p>');
    expect(viaPatch.ok).toBe(false);
    if (!viaSnapshot.ok && !viaPatch.ok) {
      // validatePatch 复用同一解释器 → 同一重建值产出同一诊断（message + path 逐条全等）
      expect(viaPatch.issues).toEqual(viaSnapshot.issues);
    }
  });

  it('AC3：成员互异字段双向——a 写 b 字段 / b 写 a 字段均拒绝，报失败距离最小成员', () => {
    const derived = evaluateModule(UNION_FIXTURE);
    // base 命中 a：写 b 独有字段 y → 重建 {kind:"a",x,y}：a 未知键 y（距离 1）< b 判别错+缺 x（距离 2）→ 成员 1/2
    const r1 = validatePatch(derived, { m: { kind: 'a', x: 'x' } }, ['m', 'y'], 'yy');
    expect(r1.ok).toBe(false);
    if (!r1.ok) {
      const issue = r1.issues.find((i) => i.path[0] === 'm' && i.path[1] === 'y');
      expect(issue).toBeDefined();
      expect(issue!.message).toContain('联合成员 1/2');
    }
    // base 命中 b：写 a 独有字段 x → 重建 {kind:"b",y,x}：b 未知键 x（距离 1）< a 判别错+缺 y（距离 2）→ 成员 2/2
    const r2 = validatePatch(derived, { m: { kind: 'b', y: 'y' } }, ['m', 'x'], 'xx');
    expect(r2.ok).toBe(false);
    if (!r2.ok) {
      const issue = r2.issues.find((i) => i.path[0] === 'm' && i.path[1] === 'x');
      expect(issue).toBeDefined();
      expect(issue!.message).toContain('联合成员 2/2');
    }
  });

  it('AC3：命中成员自身字段类型错——重建后该成员拒绝，字段级 issue 带「联合成员 i/N」前缀与精确 path', () => {
    const derived = evaluateModule(UNION_FIXTURE);
    const result = validatePatch(derived, { m: { kind: 'a', x: 'x' } }, ['m', 'x'], 42);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const issue = result.issues.find((i) => i.path[0] === 'm' && i.path[1] === 'x');
      expect(issue).toBeDefined();
      expect(issue!.message).toContain('联合成员 1/2');
      expect(issue!.message).toContain('类型不匹配');
      expect(issue!.path).toEqual(['m', 'x']);
    }
  });

  it('AC3：命中成员自身字段合法写入——重建后 any-of 接受 → ok:true', () => {
    const derived = evaluateModule(UNION_FIXTURE);
    expect(validatePatch(derived, { m: { kind: 'a', x: 'x' } }, ['m', 'x'], 'new').ok).toBe(true);
  });

  it('AC3：判别式缓存透明——有/无缓存两派生物对交叉写入输出全等（ADR 0003 §3）', () => {
    const derived = evaluateModule(FIXTURE);
    const withoutCache = stripDiscriminators(clone(derived));
    const base = validSnapshot();
    const withCache = validatePatch(derived, base, ['assets', 'img1', 'body'], '<p>x</p>');
    const without = validatePatch(withoutCache, base, ['assets', 'img1', 'body'], '<p>x</p>');
    expect(withCache).toEqual(without);
    expect(withCache.ok).toBe(false);
  });
});

describe('validatePatch — 数组：下标替换 / insert（含末尾 append）/ delete 元素类型校验（AC4）', () => {
  const BASE = { profile: { displayName: 'jim' }, name: 'jim', items: ['a', 'b'], attachments: ['x'] };

  it('AC4：数组合法下标替换通过', () => {
    const derived = evaluateModule(GUARD_FIXTURE);
    expect(validatePatch(derived, BASE, ['items', 0], 'x').ok).toBe(true);
    expect(validatePatch(derived, BASE, ['items', 1], 'y').ok).toBe(true);
  });

  it('AC4：替换元素类型错——重建后元素校验拒绝，path 含下标段', () => {
    const derived = evaluateModule(GUARD_FIXTURE);
    const result = validatePatch(derived, BASE, ['items', 1], 42);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.path)).toContainEqual(['items', 1]);
    }
  });

  it('AC4：append 合法——末尾追加元素，重建数组通过', () => {
    const derived = evaluateModule(GUARD_FIXTURE);
    expect(validateAppendToArray(derived, BASE, ['items'], 'c').ok).toBe(true);
  });

  it('AC4：append 元素类型错——追加值非元素类型拒绝，path 为新元素下标', () => {
    const derived = evaluateModule(GUARD_FIXTURE);
    const result = validateAppendToArray(derived, BASE, ['items'], 42);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.path)).toContainEqual(['items', 2]);
    }
  });

  it('AC4：append 非数组路径拒绝（leaf 位置无数组语义）', () => {
    const derived = evaluateModule(GUARD_FIXTURE);
    const result = validateAppendToArray(derived, BASE, ['name'], 'x');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.path)).toContainEqual(['name']);
    }
  });

  it('AC4：insert 合法——中位插入通过', () => {
    const derived = evaluateModule(GUARD_FIXTURE);
    expect(validateInsertIntoArray(derived, BASE, ['items'], 0, 'x').ok).toBe(true);
    expect(validateInsertIntoArray(derived, BASE, ['items'], 1, 'y').ok).toBe(true);
  });

  it('AC4：insert 末尾 append 语义——index == length 插入通过', () => {
    const derived = evaluateModule(GUARD_FIXTURE);
    expect(validateInsertIntoArray(derived, BASE, ['items'], 2, 'c').ok).toBe(true);
  });

  it('AC4：insert 元素类型错——插入值非元素类型拒绝，path 为插入下标', () => {
    const derived = evaluateModule(GUARD_FIXTURE);
    const result = validateInsertIntoArray(derived, BASE, ['items'], 0, 42);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.path)).toContainEqual(['items', 0]);
    }
  });

  it('AC4：delete 合法——删除中位与末位均通过', () => {
    const derived = evaluateModule(GUARD_FIXTURE);
    expect(validateDeleteFromArray(derived, BASE, ['items'], 0).ok).toBe(true);
    expect(validateDeleteFromArray(derived, BASE, ['items'], 1).ok).toBe(true);
  });

  it('AC4：delete 后剩余元素类型校验——重建数组中残留非法元素拒绝（path 按重建后下标）', () => {
    const derived = evaluateModule(GUARD_FIXTURE);
    const badBase = { profile: { displayName: 'jim' }, name: 'jim', items: ['a', 42], attachments: ['x'] };
    const result = validateDeleteFromArray(derived, badBase, ['items'], 0); // 删除后残留 [42]
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.path)).toContainEqual(['items', 0]);
    }
  });

  it('AC4：delete 越界拒绝（D1 越界归运行时校验）', () => {
    const derived = evaluateModule(GUARD_FIXTURE);
    const result = validateDeleteFromArray(derived, BASE, ['items'], 5); // length 2
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.path)).toContainEqual(['items', 5]);
    }
  });

  it('AC4：delete 非数组路径拒绝', () => {
    const derived = evaluateModule(GUARD_FIXTURE);
    const result = validateDeleteFromArray(derived, BASE, ['name'], 0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.path)).toContainEqual(['name']);
    }
  });
});

describe('validatePatch — 全收集 + 上限语义与 validateLogicalSnapshot 一致（AC5/AC6）', () => {
  it('AC6：全收集——一次调用收集全部独立问题（多字段错一次报全）', () => {
    const derived = evaluateModule(UNION_FIXTURE);
    const result = validatePatch(derived, { m: { kind: 'a', x: 'x' } }, ['m'], { kind: 'a', x: 42, extra: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const paths = result.issues.map((i) => i.path);
      expect(paths).toContainEqual(['m', 'x']); // 命中成员内类型错
      expect(paths).toContainEqual(['m', 'extra']); // 命中成员内未知键
      expect(result.issues).toHaveLength(2); // 同调用一次报全，非短路
    }
  });

  it('AC6：上限语义——100 条真实 issue + 末条截断标记（与 validateLogicalSnapshot 同契约）', () => {
    const derived = evaluateModule('type ROOT = { items: number[] };');
    const base = { items: Array.from({ length: 150 }, () => 'not-a-number') };
    const result = validatePatch(derived, base, ['items', 0], 0); // 重建后仍 149 个坏元素
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toHaveLength(101); // 契约读法：上限 100 条真实 issue，超限末条为截断标记
      const marker = result.issues[100];
      expect(marker).toBeDefined();
      expect(marker!.message).toMatch(/截断|truncat/i); // 标记须可区分于真实 issue（措辞留给实现）
      expect(Array.isArray(marker!.path)).toBe(true);
      expect(result.issues.map((i) => i.path)).toContainEqual(['items', 1]);
    }
  });

  it('AC5：解释器单一来源——非联合值校验输出与 validateLogicalSnapshot 对同重建快照的输出全等', () => {
    const derived = evaluateModule(GUARD_FIXTURE);
    const base = { profile: { displayName: 'jim' }, name: 'jim', items: ['a', 'b'], attachments: ['x'] };
    const rebuilt = applyPath(base, ['profile', 'displayName'], 42);
    const viaSnapshot = validateLogicalSnapshot(derived, rebuilt);
    expect(viaSnapshot.ok).toBe(false);
    const viaPatch = validatePatch(derived, base, ['profile', 'displayName'], 42);
    expect(viaPatch.ok).toBe(false);
    if (!viaSnapshot.ok && !viaPatch.ok) {
      expect(viaPatch.issues).toEqual(viaSnapshot.issues); // message + path 逐条全等
    }
  });
});
