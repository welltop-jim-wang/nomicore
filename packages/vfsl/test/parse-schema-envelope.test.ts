/**
 * SA6 红灯测试 — parseSchemaEnvelope 信封解析与方言路由（issue #52 / H1，功能开发）。
 *
 * 契约来源：
 * - 任务简报 wiki/raw/task_vfsl-schema-envelope.md（Issue #52）：公共导出
 *   `parseSchemaEnvelope(input: unknown) → { ok: true; envelope; module } | { ok: false; issues }`；
 *   流程 = 信封形状校验（`{lang, version, id, text}` 四键齐备 + 类型校验；`id` 仅标签、
 *   不校验格式）→ 方言断言（`lang === 'vfsl' && version === 1`，否则只读 loud-fail）→
 *   `parseVfsl(text)` 透传（文本错误携带原行列）；
 * - docs/adr/0001（修订节：信封键名 `SCHEMA`，内部 `{lang, version, id, text}` 不变）+
 *   docs/adr/0005 §1（信封形状、消费方首动作 = 方言断言、id 是标签不是键）；
 * - 既有接缝纪律（PRD #3 / ADR 0003）：同步、纯函数、不抛错，错误经返回值传递。
 *
 * 验收锚点（AC1–AC6 逐条对应）：
 * - AC1 接缝形状：同步、纯函数、不抛错；成功返回 `{ok:true, envelope, module}`；
 * - AC2 信封形状负例：缺键 / 多键不拒（向前兼容加法）/ 类型错误（version 非 number、
 *   text 非 string 等）→ 结构化拒绝；
 * - AC3 方言断言：`{lang:'vfsl', version:2}` / `{lang:'other'}` → 拒绝且错误身份可区分
 *   「未知方言（只读）」（先于文本解析拒绝——loud-fail 只读）；
 * - AC4 合法信封透传：parseVfsl 的 ok/issues 原样返回（含行列）；
 * - AC5 `id` 任意字符串（含空串、撞名）不影响判定；
 * - AC6 信封/方言错误码不落入 parseVfsl 的 VFSL-E 码空间（可区分机制），文本错误
 *   透传仍保留 VFSL-E 前缀——两通道并存且可区分。
 *
 * 本文件状态演进：
 * - Phase 1（验收锚定）：`parseSchemaEnvelope` 尚不存在 → 静态 import 失败，12 条用例
 *   全红（构造性红灯，同 schemasource-seam.test.ts 先例）；
 * - Phase 2（SA3 实现 cb7a2c7 后）：12 条用例转绿；SA4 R1 reject F1（envelope.ts
 *   `envelopeCrashIssue` 的 `String(err)` 在 catch 内二次可抛）→ 追加本文件末 F1 回归锚
 *   （对抗 getter/Proxy 抛不可字符串化值 → 不外抛 + VFSL-ENV-E100 @ 0/0），修复前必红。
 * 断言全部锚定公共入口的运行时行为，不触碰任何内部实现。
 */
import { describe, expect, it } from 'vitest';
import { parseSchemaEnvelope, parseVfsl } from '../src/index.js';

/** CONTEXT.md / ADR 0005 冻结的信封形状。 */
interface SchemaEnvelope {
  lang: string;
  version: number;
  id: string;
  text: string;
}

/** PRD #3 冻结的 VfslIssue 形状。 */
interface VfslIssue {
  message: string;
  line: number;
  column: number;
}

/** 任务简报冻结的公共接缝返回形状。 */
type ParseSchemaEnvelopeResult =
  | { ok: true; envelope: SchemaEnvelope; module: { kind: 'vfsl-module'; aliases: unknown[] } }
  | { ok: false; issues: VfslIssue[] };

/** 合法文本（ROOT 必须 map 形，E311）。 */
const VALID_TEXT = 'type ROOT = {};';
const VALID_TEXT_2 = 'type ROOT = { a: string; };';

/** 语法错误文本：VFSL-E100（类型位置意外记号 ';'），line 3 / column 7。 */
const BAD_TEXT = 'type ROOT = {\n  a: string,\n  b?: ;\n};';

/**
 * 结构化拒绝断言（AC2/AC6 共用）：`{ok:false, issues}`，issues 非空、
 * 每条均为 `{message:string, line:number, column:number}`，且 message 不落入
 * parseVfsl 的 VFSL-E 码空间（AC6——独立前缀或明确区分机制的行为锚）。
 */
function expectRejected(result: unknown): { issues: VfslIssue[] } {
  const r = result as { ok: false; issues: VfslIssue[] };
  expect(r.ok).toBe(false);
  expect(Array.isArray(r.issues)).toBe(true);
  expect(r.issues.length).toBeGreaterThan(0);
  for (const issue of r.issues) {
    expect(typeof issue.message).toBe('string');
    expect(typeof issue.line).toBe('number');
    expect(typeof issue.column).toBe('number');
    expect(issue.message).not.toMatch(/^VFSL-E\d+:/);
  }
  return r;
}

/** 摘除单键（AC2 缺键用例构造）。 */
function omit<T extends object>(obj: T, key: keyof T): object {
  const { [key]: _removed, ...rest } = obj;
  return rest;
}

/**
 * 经公共入口调用被测接缝（当前导出尚不存在 → import 为 error 类型，显式标注返回形状；
 * SA3 实现后签名一致，标注恒成立）。
 */
function callEnvelope(input: unknown): ParseSchemaEnvelopeResult {
  return parseSchemaEnvelope(input) as ParseSchemaEnvelopeResult;
}

/** 断言文本合法并返回 module（fixture 自检 + 透传对照）。 */
function parseVfslOk(text: string): { kind: 'vfsl-module'; aliases: unknown[] } {
  const r = parseVfsl(text);
  expect(r.ok).toBe(true);
  if (!r.ok) {
    throw new Error(`fixture 应为合法文本: ${JSON.stringify(r.issues)}`);
  }
  return r.module;
}

/** 断言文本非法并返回 issues（fixture 自检 + 透传对照）。 */
function parseVfslIssues(text: string): VfslIssue[] {
  const r = parseVfsl(text);
  expect(r.ok).toBe(false);
  if (r.ok) {
    throw new Error('fixture 应为非法文本');
  }
  return r.issues;
}

describe('parseSchemaEnvelope — AC1 接缝形状（同步、纯函数、不抛错）', () => {
  it('合法信封 → 同步返回 { ok: true; envelope; module }，非 Promise、不抛错、纯函数', () => {
    const input = { lang: 'vfsl', version: 1, id: 'vfs3.assets@1', text: VALID_TEXT };
    let result: unknown;
    expect(() => {
      result = parseSchemaEnvelope(input);
    }).not.toThrow();
    // 同步：直接返回结果对象，不是 Promise/thenable
    expect(result).not.toHaveProperty('then');
    const r = result as ParseSchemaEnvelopeResult;
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.envelope).toEqual({
        lang: 'vfsl',
        version: 1,
        id: 'vfs3.assets@1',
        text: VALID_TEXT,
      });
      expect(r.module.kind).toBe('vfsl-module');
      // 纯函数：同输入两次调用结果一致
      expect(callEnvelope(input)).toEqual(r);
    }
  });

  it('任意非信封输入（null/undefined/原始值/数组/函数）→ 结构化拒绝而非抛错', () => {
    const hostile: unknown[] = [
      undefined,
      null,
      42,
      'string',
      true,
      [],
      [1, 2],
      {},
      () => 0,
    ];
    for (const input of hostile) {
      let result: unknown;
      expect(() => {
        result = parseSchemaEnvelope(input);
      }).not.toThrow();
      expectRejected(result);
    }
  });
});

describe('parseSchemaEnvelope — AC2 信封形状负例', () => {
  it('缺键（四键各自缺失 / 空对象）→ 结构化拒绝', () => {
    const base = { lang: 'vfsl', version: 1, id: 'x', text: VALID_TEXT };
    const missing: unknown[] = [
      {},
      omit(base, 'lang'),
      omit(base, 'version'),
      omit(base, 'id'),
      omit(base, 'text'),
    ];
    for (const input of missing) {
      expectRejected(callEnvelope(input));
    }
  });

  it('类型错误（version 非 number、text/lang/id 非 string）→ 结构化拒绝', () => {
    const cases: unknown[] = [
      { lang: 'vfsl', version: '1', id: 'x', text: VALID_TEXT },
      { lang: 'vfsl', version: 1, id: 'x', text: 42 },
      { lang: 1, version: 1, id: 'x', text: VALID_TEXT },
      { lang: 'vfsl', version: 1, id: 42, text: VALID_TEXT },
    ];
    for (const input of cases) {
      expectRejected(callEnvelope(input));
    }
  });

  it('多键不拒（向前兼容加法）：合法信封携带多余键 → ok:true，四键原值透传', () => {
    const input = {
      lang: 'vfsl',
      version: 1,
      id: 'x',
      text: VALID_TEXT,
      extra: 'future-field',
      flag: true,
    };
    const result = callEnvelope(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.envelope.lang).toBe('vfsl');
      expect(result.envelope.version).toBe(1);
      expect(result.envelope.id).toBe('x');
      expect(result.envelope.text).toBe(VALID_TEXT);
    }
  });
});

describe('parseSchemaEnvelope — AC3 方言断言（未知方言只读 loud-fail）', () => {
  it('{lang:"vfsl", version:2} 与 {lang:"other", version:1} → 拒绝，错误身份指向方言层', () => {
    const cases: unknown[] = [
      { lang: 'vfsl', version: 2, id: 'x', text: VALID_TEXT },
      { lang: 'other', version: 1, id: 'x', text: VALID_TEXT },
    ];
    for (const input of cases) {
      const result = callEnvelope(input);
      expect(result.ok).toBe(false);
      const { issues } = expectRejected(result);
      // 身份可区分「未知方言」：消息指向方言身份（lang/version），而非文本内容
      const joined = issues.map((i) => i.message).join('\n');
      expect(joined).toMatch(/方言|dialect/i);
    }
  });

  it('未知方言先于文本解析拒绝（只读 loud-fail）：同一非法文本 + 未知方言 → 方言错误而非文本错误', () => {
    const dialectBad = { lang: 'other', version: 1, id: 'x', text: BAD_TEXT };
    // 方言拒绝：结构化、指向方言层、不落入 VFSL-E 码空间
    const d = callEnvelope(dialectBad);
    const dIssues = expectRejected(d);
    const joinedD = dIssues.issues.map((i) => i.message).join('\n');
    expect(joinedD).toMatch(/方言|dialect/i);
    expect(joinedD).not.toMatch(/^VFSL-E\d+:/m);
    // 对照：同文本 + vfsl@1 → 文本错误原样透传（VFSL-E 码）
    const t = callEnvelope({ lang: 'vfsl', version: 1, id: 'x', text: BAD_TEXT });
    expect(t.ok).toBe(false);
    const tIssues = (t as { ok: false; issues: VfslIssue[] }).issues;
    expect(tIssues).toEqual(parseVfslIssues(BAD_TEXT));
    // 两通道可区分：方言拒绝 ≠ 文本错误
    expect(dIssues.issues).not.toEqual(tIssues);
  });
});

describe('parseSchemaEnvelope — AC4 合法信封透传（parseVfsl ok/issues 原样，含行列）', () => {
  it('ok:true 透传：module 与 parseVfsl(text).module 完全一致', () => {
    const text = 'type T = { a: string, b?: number; };\ntype ROOT = {};';
    const result = callEnvelope({ lang: 'vfsl', version: 1, id: 'x', text });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.module).toEqual(parseVfslOk(text));
    }
  });

  it('ok:false 透传：文本语法错误 issues 与 parseVfsl 完全一致（VFSL-E100 @ line 3, column 7）', () => {
    const result = callEnvelope({ lang: 'vfsl', version: 1, id: 'x', text: BAD_TEXT });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(parseVfslIssues(BAD_TEXT));
      expect(result.issues[0]!).toMatchObject({ line: 3, column: 7 });
      expect(result.issues[0]!.message).toMatch(/^VFSL-E\d+:/);
    }
  });
});

describe('parseSchemaEnvelope — AC5 id 仅标签（任意字符串不影响判定）', () => {
  it('id 空串与特殊字符（路径分隔符 / 中文 / 表情）→ 判定不受影响', () => {
    const cases: unknown[] = [
      { lang: 'vfsl', version: 1, id: '', text: VALID_TEXT },
      { lang: 'vfsl', version: 1, id: 'a/b\\c..中文 🎉 $%^', text: VALID_TEXT },
    ];
    for (const input of cases) {
      const result = callEnvelope(input);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.envelope.id).toBe((input as SchemaEnvelope).id);
      }
    }
  });

  it('撞名：两个信封同 id 不同 text → 各自按自己文本解析（id 不是键，无去重/注册表）', () => {
    const a = { lang: 'vfsl', version: 1, id: 'vfs3.assets@1', text: VALID_TEXT };
    const b = { lang: 'vfsl', version: 1, id: 'vfs3.assets@1', text: VALID_TEXT_2 };
    const ra = callEnvelope(a);
    const rb = callEnvelope(b);
    expect(ra.ok).toBe(true);
    expect(rb.ok).toBe(true);
    if (ra.ok && rb.ok) {
      expect(ra.module).toEqual(parseVfslOk(a.text));
      expect(rb.module).toEqual(parseVfslOk(b.text));
      expect(ra.module).not.toEqual(rb.module);
    }
  });
});

describe('parseSchemaEnvelope — AC6 错误码空间独立（不与 VFSL-E 混淆）', () => {
  it('信封/方言拒绝的 message 一律不落入 VFSL-E 码空间；文本错误透传仍保留 VFSL-E 前缀', () => {
    const rejections: unknown[] = [
      null,
      { lang: 'vfsl', version: 1, id: 'x' },
      { lang: 'vfsl', version: '1', id: 'x', text: VALID_TEXT },
      { lang: 'vfsl', version: 2, id: 'x', text: VALID_TEXT },
      { lang: 'other', version: 1, id: 'x', text: VALID_TEXT },
    ];
    for (const input of rejections) {
      expectRejected(callEnvelope(input));
    }
    // 对照：文本错误透传保留 parseVfsl 的 VFSL-E 码（两通道并存且可区分）
    const textErr = callEnvelope({ lang: 'vfsl', version: 1, id: 'x', text: BAD_TEXT });
    expect(textErr.ok).toBe(false);
    if (!textErr.ok) {
      expect(textErr.issues[0]!.message).toMatch(/^VFSL-E\d+:/);
    }
  });
});

describe('parseSchemaEnvelope — F1 回归锚：对抗 getter/Proxy 抛不可字符串化值（SA4 R1 reject F1）', () => {
  it('thrown 值不可字符串化（Object.create(null) / {toString:42} / Proxy get trap）→ 不外抛，{ok:false} + VFSL-ENV-E100 @ 0/0 恒单行', () => {
    // 设计 §7 边界表承诺：对抗 getter/Proxy 抛异常 → 顶层 catch → ENV-100，绝不外抛。
    // 当前实现 envelope.ts envelopeCrashIssue 的 `String(err)` 在 catch 内二次抛出
    // （TypeError: Cannot convert object to primitive value）→ 本条在修复前必须红。
    const hostile: unknown[] = [
      // SA4 最小复现：getter 抛 Object.create(null)（无 toString/valueOf）
      {
        get lang() {
          throw Object.create(null);
        },
        version: 1,
        id: 'x',
        text: VALID_TEXT,
      },
      // {toString:42}：toString 非函数 → ToPrimitive 抛 TypeError
      {
        get lang() {
          throw { toString: 42 };
        },
        version: 1,
        id: 'x',
        text: VALID_TEXT,
      },
      // Proxy get trap 抛不可字符串化值（属性读取路径注入点，SA4 A5 同源）
      new Proxy(
        { lang: 'vfsl', version: 1, id: 'x', text: VALID_TEXT },
        {
          get: () => {
            throw Object.create(null);
          },
        },
      ),
    ];
    for (const input of hostile) {
      let result: unknown;
      expect(() => {
        result = parseSchemaEnvelope(input);
      }).not.toThrow();
      expect(result).toHaveProperty('ok', false);
      const r = result as { ok: false; issues: VfslIssue[] };
      expect(r.issues.length).toBeGreaterThan(0);
      const issue = r.issues[0]!;
      expect(issue.message).toMatch(/^VFSL-ENV-E100:/);
      expect(issue.message).not.toMatch(/^VFSL-E\d+:/); // 不落入文本语法错误码空间
      expect(issue.line).toBe(0); // 坐标哨兵：崩溃边界无行列
      expect(issue.column).toBe(0);
      expect(issue.message).not.toMatch(/\n/); // 恒单行：detail 经 sanitizer 单行化
    }
  });
});
