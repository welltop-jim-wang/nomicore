/**
 * validateLogicalSnapshot 更名回归契约（issue #71 / ADR-0007，共享断言集）。
 *
 * 本模块把「更名后必须保持不变」的既有 validateSnapshot 校验行为固化为**可对任意
 * 校验函数执行的断言集**（registerBehaviorRegression）：
 *   - 值语义 / issues 形状（message + path 段数组，无行列）、全收集 + 100 条上限 +
 *     截断标记、联合三段（any-of 接受 / no-match 最近成员）、封闭对象 / 必填缺失 /
 *     Pattern / XML 良构；
 *   - 资源预算（§3.4）：Pattern 匹配步数 4M 钳制 loud、全局工作预算 WORK_LIMIT
 *     2×10⁸ 耗尽 fail-closed（单条 issue，与 E100 / 截断 / Pattern 三重可区分）；
 *   - 纯函数：同输入同输出、确定性、不修改派生 schema 与快照（纯数据只读遍历）；
 *   - 零写入：深度冻结的 derived / snapshot 输入下校验照常完成——任何对输入的写
 *     入尝试都会在 ESM 严格模式下抛 TypeError，被崩溃边界收编为 E100 或外抛，
 *     使本断言失败（红），故冻结输入即零写入的行为锚。
 *
 * 断言全部锚定可观测输出（结果形状 / issue 内容 / path 段数组 / 输入状态），不读取
 * 源码、不 grep 文本形状。消息措辞中「来源 validate.ts」标注的精确串与实现单点
 * 构造一致，其余仅断言 path 段数组与 ok 标志（措辞留给实现，与既有冻结套件同款
 * 纪律）。
 *
 * 双跑设计：本断言集被 `validate-logical-snapshot.test.ts` 以新名
 * `validateLogicalSnapshot` 执行（当前红灯——新名尚未导出）；SA6 验证阶段另以
 * 旧名 `validateSnapshot` 临时跑同断言集（绿），证明本契约精确描述当前行为。
 * 更名迁移（SA3）后新名执行转绿，即证明行为零回归。
 */
import { describe, expect, it } from 'vitest';
import { parseVfsl, evaluate } from '../src/index.js';
import type { VfslModule, DerivedSchema } from '../src/index.js';

// —— 测试契约类型（与既有冻结套件同款：不依赖包内类型名，避免随更名漂移）——

/** issue 形状：message + path 段数组（不复用 VfslIssue——无行列；段数组零转义）。 */
interface ValidateIssue {
  message: string;
  /** 段数组（如 ["assets","abc123","duration"]）；Record 键 / 数组下标均为段。 */
  path: Array<string | number>;
}

type ValidateResult =
  | { ok: true }
  | { ok: false; issues: ValidateIssue[] };

/** 被锚定的校验接缝：`(derived, snapshot)` → 结果联合（纯函数、不抛错）。 */
export type ValidateFn = (derived: unknown, snapshot: unknown) => ValidateResult;

// —— 规格 §10 vfs3.assets 参考 fixture（与 validate-snapshot.test.ts 同文本，已绿）——

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
  if (!result.ok) throw new Error(`前置 parseVfsl 失败（不应发生）：${JSON.stringify(result.issues)}`);
  return result.module;
}

/** parse → evaluate 全链路；断言 ok:true 并返回 derived（evaluate 已绿，前置条件）。 */
function evaluateModule(text: string): DerivedSchema {
  const result = evaluate(parseOk(text));
  if (!result.ok) throw new Error(`evaluate 失败（当前契约预期 ok:true）：${JSON.stringify(result.issues)}`);
  return result.derived;
}

/** 深拷贝（JSON 往返）——测试间隔离，避免共享对象被校验实现意外污染。 */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** 递归冻结（WeakSet 防御环）——零写入行为锚：写冻结对象在严格模式下抛 TypeError。 */
function deepFreeze<T>(value: T, seen: WeakSet<object>): T {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return value;
  seen.add(value);
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child, seen);
  }
  return value;
}

/**
 * 递归删除全部 `discriminator` 键——构造「无判别式缓存」派生物。
 * 对派生物数据（校验函数的输入）做纯数据操作，非源码断言；用于锚定
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

// —— 行为回归断言集（对任意校验函数执行；双跑：新名红 / 旧名绿验）——

export function registerBehaviorRegression(validate: ValidateFn): void {
  describe('行为回归（issue #71 更名契约）— 接缝：结果形状与 JSON 往返', () => {
    it('合法快照 → { ok: true }（恰含 ok 键，无多余字段）', () => {
      const result = validate(evaluateModule(FIXTURE), validSnapshot());
      expect(Object.keys(result)).toEqual(['ok']);
      expect(result).toEqual({ ok: true });
    });

    it('非法快照 → { ok: false, issues }——issue 恰含 message 与 path（无行列，不复用 VfslIssue）', () => {
      const result = validate(evaluateModule(FIXTURE), { extra: 1 });
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

    it('结果可 JSON 序列化往返（ok 与 not-ok 两分支）', () => {
      const derived = evaluateModule(FIXTURE);
      const okResult = validate(derived, validSnapshot());
      expect(JSON.parse(JSON.stringify(okResult))).toEqual(okResult);
      const badResult = validate(derived, { extra: 1 });
      expect(JSON.parse(JSON.stringify(badResult))).toEqual(badResult);
    });

    it('snapshot 为任意 JSON 值——非对象顶层（null/标量/数组）均 ok:false（逻辑 ROOT 固定物化为 Y.Map）', () => {
      const derived = evaluateModule(FIXTURE);
      for (const snap of [null, 42, 'str', true, []]) {
        expect(validate(derived, snap).ok).toBe(false);
      }
    });

    it('纯函数：同输入两次校验输出全等，派生物不被修改', () => {
      const derived = evaluateModule(FIXTURE);
      const snapshot = validSnapshot();
      const before = JSON.stringify(derived);
      expect(validate(derived, snapshot)).toEqual(validate(derived, snapshot));
      expect(JSON.stringify(derived)).toBe(before); // 校验不得污染输入派生物
    });

    it('编译一次、校验多次——同一派生物对多份快照独立校验', () => {
      const derived = evaluateModule(FIXTURE);
      const okSnap = validSnapshot();
      const badSnap = validSnapshot();
      (badSnap as Record<string, unknown>).extra = 1;
      expect(validate(derived, okSnap).ok).toBe(true);
      expect(validate(derived, badSnap).ok).toBe(false);
      expect(validate(derived, okSnap).ok).toBe(true);
    });

    it('派生 schema 以纯数据形态消费——JSON 往返后的派生物校验结果全等', () => {
      const derived = evaluateModule(FIXTURE);
      expect(validate(clone(derived), validSnapshot())).toEqual(validate(derived, validSnapshot()));
    });
  });

  describe('行为回归 — 结构校验：封闭对象 / 必填缺失 / path 段数组', () => {
    it('未知键 → 单条 issue，path 含键段，message 精确（来源 validate.ts）', () => {
      const snap = validSnapshot();
      (snap as Record<string, unknown>).extra = 1;
      const result = validate(evaluateModule(FIXTURE), snap);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.map((i) => i.path)).toContainEqual(['extra']);
        const issue = result.issues.find((i) => i.path.length === 1 && i.path[0] === 'extra');
        expect(issue?.message).toBe('未知字段 "extra"：封闭对象不接受未声明键');
      }
    });

    it('必填缺失 → 字段声明序首条：path ["assets"]，message 精确（来源 validate.ts）', () => {
      const result = validate(evaluateModule(FIXTURE), {});
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.map((i) => i.path)).toContainEqual(['assets']);
        const issue = result.issues.find((i) => i.path.length === 1 && i.path[0] === 'assets');
        expect(issue?.message).toBe('缺少必填字段 "assets"');
      }
    });

    it('嵌套路径：assets.img1.url 类型错 → path 段数组 ["assets","img1","url"]', () => {
      const snap = validSnapshot();
      (snap.assets as Record<string, Record<string, unknown>>).img1!.url = 42;
      const result = validate(evaluateModule(FIXTURE), snap);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.map((i) => i.path)).toContainEqual(['assets', 'img1', 'url']);
      }
    });

    it('Record 键特殊字符零转义：assets["abc.123"] → path 段原样（不按 "." 切分）', () => {
      const snap = validSnapshot();
      (snap.assets as Record<string, unknown>)['abc.123'] = { kind: 'image', url: 'u', width: 1, height: 1, audit: clone(AUDIT) };
      const result = validate(evaluateModule(FIXTURE), snap);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.map((i) => i.path)).toContainEqual(['assets', 'abc.123']);
      }
    });

    it('数组下标为 number 段：attachments[1] 类型错 → path ["attachments",1]', () => {
      const snap = validSnapshot();
      (snap.attachments as unknown[])[1] = 42;
      const result = validate(evaluateModule(FIXTURE), snap);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.map((i) => i.path)).toContainEqual(['attachments', 1]);
      }
    });

    it('YXmlFragment 良构要求：未闭合 XML → ok:false，path ["assets","text1","body"]', () => {
      const snap = validSnapshot();
      (snap.assets as Record<string, Record<string, unknown>>).text1!.body = '<b>';
      const result = validate(evaluateModule(FIXTURE), snap);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.map((i) => i.path)).toContainEqual(['assets', 'text1', 'body']);
      }
    });
  });

  describe('行为回归 — 值校验：枚举 / Record 键 Pattern / 联合', () => {
    it('枚举越界：kind "video" → ok:false，path 含 kind 段', () => {
      const snap = validSnapshot();
      (snap.assets as Record<string, Record<string, unknown>>).img1!.kind = 'video';
      const result = validate(evaluateModule(FIXTURE), snap);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.map((i) => i.path)).toContainEqual(['assets', 'img1', 'kind']);
      }
    });

    it('Record 键 Pattern 违规：assets["abc.123"] 触 AssetId 约束 → issue path 含键段', () => {
      const snap = validSnapshot();
      (snap.assets as Record<string, unknown>)['abc.123'] = { kind: 'image', url: 'u', width: 1, height: 1, audit: clone(AUDIT) };
      const result = validate(evaluateModule(FIXTURE), snap);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const keyIssue = result.issues.find((i) => i.path[0] === 'assets' && i.path[1] === 'abc.123');
        expect(keyIssue).toBeDefined();
      }
    });

    it('联合 any-of：image/text/file 三成员齐备的合法快照 → ok:true', () => {
      expect(validate(evaluateModule(FIXTURE), validSnapshot()).ok).toBe(true);
    });

    it('联合 no-match 最近成员：member1 判别式命中但字段类型错 → path 进成员内字段，message 含「联合成员 1/2」', () => {
      const derived = evaluateModule('type ROOT = { m: { kind: "image"; width: number } | { kind: "text"; body: string } };');
      const result = validate(derived, { m: { kind: 'image', width: 'x' } });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues).toHaveLength(1);
        expect(result.issues[0]!.message).toContain('联合成员 1/2');
        expect(result.issues[0]!.path).toEqual(['m', 'width']);
      }
    });

    it('判别式缓存透明：stripDiscriminators 后与带缓存输出全等（ok 与拒绝两分支）', () => {
      const derived = evaluateModule(FIXTURE);
      const withoutCache = stripDiscriminators(clone(derived));
      const okSnap = validSnapshot();
      expect(validate(withoutCache, okSnap)).toEqual(validate(derived, okSnap));
      const badSnap = validSnapshot();
      (badSnap.assets as Record<string, Record<string, unknown>>).img1!.url = 42;
      expect(validate(withoutCache, badSnap)).toEqual(validate(derived, badSnap));
    });
  });

  describe('行为回归 — 资源预算 I：全收集 + 100 条上限 + 截断标记', () => {
    it('同一调用一次报全：未知键 + url 类型错两问题同时收集', () => {
      const snap = validSnapshot();
      (snap as Record<string, unknown>).extra = 1;
      (snap.assets as Record<string, Record<string, unknown>>).img1!.url = 42;
      const result = validate(evaluateModule(FIXTURE), snap);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const paths = result.issues.map((i) => i.path);
        expect(paths).toContainEqual(['extra']);
        expect(paths).toContainEqual(['assets', 'img1', 'url']);
      }
    });

    it('上限语义：150 条真实 issue → 101 条输出，末条截断标记精确 message、path []', () => {
      const assets: Record<string, unknown> = {};
      for (let i = 0; i < 150; i++) {
        // '!' 违规 AssetId 键 Pattern → 每键恰 1 issue；值为合法 image 成员 → 无附加 issue
        assets['k' + i + '!'] = { kind: 'image', url: 'u', width: 1, height: 1, audit: clone(AUDIT) };
      }
      const result = validate(evaluateModule(FIXTURE), { assets, attachments: [], audit: clone(AUDIT), keywords: [] });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues).toHaveLength(101); // 上限 100 条真实 issue，超限末条为截断标记
        expect(result.issues[0]!.message).not.toMatch(/截断|truncat/i); // 前 100 条是真实 issue
        const marker = result.issues[100]!;
        expect(marker.message).toBe('校验问题超出 100 条上限，输出已截断（truncated）：另有 50 处问题未报告');
        expect(marker.path).toEqual([]);
      }
    });
  });

  describe('行为回归 — 资源预算 II：Pattern 匹配步数 4M 钳制 loud（「无法判定」非「不匹配」）', () => {
    it('(?=.*;)z × 5000 码元 → 单条精确 budget issue，path ["v"]', () => {
      const derived = evaluateModule('type ROOT = { v: string & Pattern<"(?=.*;)z"> };');
      const result = validate(derived, { v: 'x'.repeat(5000) });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues).toHaveLength(1);
        expect(result.issues[0]!.message).toBe('Pattern 匹配步数预算耗尽（输入长度 5000，预算 4000000）：无法在预算内判定匹配性');
        expect(result.issues[0]!.path).toEqual(['v']);
      }
    }, 15_000);
  });

  describe('行为回归 — 资源预算 III：全局工作预算 WORK_LIMIT=2×10⁸ 耗尽 fail-closed', () => {
    it('NFA 步数跨多次匹配累计超 2×10⁸ → 单条预算耗尽 issue（非 E100、非截断、非 Pattern），path []', () => {
      const derived = evaluateModule('type ROOT = { m: Record<string, string & Pattern<"(?=.*;)z">> };');
      const inner: Record<string, string> = {};
      // 每键值长 6000 → 单次匹配步数钳制于 4M，均计入全局工作账本；80 键累计 ≈ 3.2×10⁸ > 2×10⁸
      for (let i = 0; i < 80; i++) inner['k' + i] = 'a'.repeat(6000);
      const result = validate(derived, { m: inner });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues).toHaveLength(1); // 不进 emit 通道、无截断标记
        const msg = result.issues[0]!.message;
        expect(msg).toMatch(/^校验工作预算耗尽（全局已执行 \d+ 工作单位，上限 200000000）：无法在预算内完成整份校验$/);
        expect(Number(msg.match(/全局已执行 (\d+) 工作单位/)![1])).toBeGreaterThan(200_000_000);
        expect(result.issues[0]!.path).toEqual([]);
        expect(msg).not.toContain('VFSL-E100'); // 三重可区分：非 E100、非截断标记、非单次 Pattern 预算
        expect(msg).not.toContain('truncat');
        expect(msg).not.toContain('Pattern');
      }
    }, 180_000);
  });

  describe('行为回归 — 纯函数 / 零写入：冻结输入强锚', () => {
    it('深度冻结快照输入：不抛错且 ok:true（任何写输入尝试 → 严格模式 TypeError → E100/外抛 → 本断言失败）', () => {
      const derived = evaluateModule(FIXTURE);
      const snapshot = deepFreeze(validSnapshot(), new WeakSet());
      const snapshotJson = JSON.stringify(snapshot);
      const result = validate(derived, snapshot);
      expect(result).toEqual({ ok: true });
      expect(JSON.stringify(snapshot)).toBe(snapshotJson); // 输入逐字节不变
    });

    it('深度冻结 derived 输入：不抛错、ok:true，且与未冻结派生物的输出全等', () => {
      const derived = evaluateModule(FIXTURE);
      const frozen = deepFreeze(clone(derived), new WeakSet());
      const snapshot = validSnapshot();
      expect(validate(frozen, snapshot)).toEqual({ ok: true });
      expect(validate(frozen, snapshot)).toEqual(validate(derived, snapshot));
    });

    it('确定性：同输入三次输出全等', () => {
      const derived = evaluateModule(FIXTURE);
      const badSnap = validSnapshot();
      (badSnap.assets as Record<string, Record<string, unknown>>).img1!.url = 42;
      const a = validate(derived, badSnap);
      const b = validate(derived, badSnap);
      const c = validate(derived, badSnap);
      expect(a).toEqual(b);
      expect(b).toEqual(c);
    });
  });

  describe('行为回归 — 崩溃边界 E100 / 截断上限边界（SA6 去重合并补充）', () => {
    it('手造派生物（删 values.ROOT）→ 单条 E100 收编（path=[]，不抛错、不静默 ok:true）', () => {
      const derived = evaluateModule(FIXTURE);
      const d2 = { ...derived, values: { ...derived.values } };
      delete d2.values['ROOT'];
      const result = validate(d2, validSnapshot());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues).toHaveLength(1);
        expect(result.issues[0]!.message).toMatch(/^VFSL-E100: 内部错误（意外异常）: /);
        expect(result.issues[0]!.path).toEqual([]);
      }
    });

    it('截断边界：恰 100 条真实 issue → 无截断标记（100 条收口，末条为真实 issue）', () => {
      const derived = evaluateModule('type ROOT = { m: Record<string, string> };');
      const inner: Record<string, unknown> = {};
      for (let i = 0; i < 100; i++) inner['k' + i] = { oops: true };
      const result = validate(derived, { m: inner });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues).toHaveLength(100);
        expect(result.issues[99]!.path).toEqual(['m', 'k99']);
        expect(result.issues.some((i) => i.message.includes('truncat'))).toBe(false);
      }
    });
  });
}
