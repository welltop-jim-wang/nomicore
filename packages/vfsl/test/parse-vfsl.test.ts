/**
 * SA6 红灯测试 — parseVfsl 幸福路径与边界条件（issue #5 切片内构造）。
 *
 * 契约来源：
 * - docs/vfsl/v1-spec.md（frozen）：§2 语法子集、注记 3/4/9、§4 引用解析时机、
 *   §9.2 BOM 剥离；
 * - PRD #3（wiki/raw/20260818-prd-vfsl-v1.md）：公共接缝 parseVfsl(text) →
 *   { ok: true, module } | { ok: false, issues }；只测外部行为；IR 可 JSON 序列化。
 *
 * 本切片构造：类型别名 / 原始类型（string number boolean null unknown）/ 封闭对象 /
 * `?:` 可选属性 / 字面量联合（字符串与数字两类）。
 * 断言一律经公共入口 parseVfsl；不测 tokenizer / 内部 AST（内部结构非公共契约）。
 */
import { describe, expect, it } from 'vitest';
import { parseVfsl } from '../src/index.js';

/** PRD #3 冻结的公共接缝返回形状。 */
type ParseResult =
  | { ok: true; module: unknown }
  | { ok: false; issues: { message: string; line: number; column: number }[] };

/** 迷你 fixture：覆盖本切片全部构造（别名 / 五原始类型 / 封闭对象 / ?: 可选 / 字面量联合）。 */
const MINI_FIXTURE = `
type Mode = "fast" | "safe";
type Port = 80 | 443;
type Host = string;
type Count = number;
type IsTls = boolean;
type Empty = null;
type Meta = unknown;
type Server = {
  host: Host;
  port: Port;
  mode: Mode;
  count?: Count;
  isTls?: boolean;
  none: null;
  meta: unknown;
  info: { label: string };
};
type ROOT = {};
`.trim();

const FIXTURE_ALIASES = [
  'Mode',
  'Port',
  'Host',
  'Count',
  'IsTls',
  'Empty',
  'Meta',
  'Server',
] as const;

function expectOk(result: ParseResult): unknown {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`期望 ok: true，实际 ok: false（issues: ${JSON.stringify(result.issues)}）`);
  }
  return result.module;
}

/** PRD 验收：IR 可 JSON 序列化（内容哈希缓存的前提）——序列化往返须无损。 */
function expectJsonRoundTrip(value: unknown): void {
  expect(JSON.parse(JSON.stringify(value))).toEqual(value);
}

describe('parseVfsl — 幸福路径：迷你 fixture 全量解析', () => {
  it('迷你 fixture 解析成功，module 可序列化且含全部别名', () => {
    const module = expectOk(parseVfsl(MINI_FIXTURE));

    expect(module).toBeTypeOf('object');
    expect(module).not.toBeNull();

    // IR 必须可 JSON 序列化（PRD #3 验收：内容哈希缓存的前提）
    expectJsonRoundTrip(module);

    // 序列化输出中可见全部已声明别名（minimal anchor，不锁定 IR 具体形状）
    const serialized = JSON.stringify(module);
    for (const name of FIXTURE_ALIASES) {
      expect(serialized).toContain(name);
    }
  });

  it('空文本：语法层容忍空模块（不报 E100/E203），语义相位要求 ROOT → VFSL-E310@1:1', () => {
    const result = parseVfsl('');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toHaveLength(1);
      const issue = result.issues[0];
      expect(issue?.message).toMatch(/^VFSL-E310: /);
      expect(issue?.line).toBe(1);
      expect(issue?.column).toBe(1);
    }
  });

  it('纯空白文本：语法层容忍空模块，语义相位要求 ROOT → VFSL-E310@1:1', () => {
    const result = parseVfsl(' \n\t  ');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toHaveLength(1);
      const issue = result.issues[0];
      expect(issue?.message).toMatch(/^VFSL-E310: /);
      expect(issue?.line).toBe(1);
      expect(issue?.column).toBe(1);
    }
  });

  it('仅注释文本：语法层容忍空模块（注释是词法级 trivia），语义相位要求 ROOT → VFSL-E310@1:1', () => {
    const result = parseVfsl('// 只有一行注释，没有别名');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toHaveLength(1);
      const issue = result.issues[0];
      expect(issue?.message).toMatch(/^VFSL-E310: /);
      expect(issue?.line).toBe(1);
      expect(issue?.column).toBe(1);
    }
  });

  it('行注释与块注释作为 trivia 出现在任意记号边界，不影响解析', () => {
    const text = `
// 前导行注释
type A = string; /* 尾部块注释 */
/* 块注释 */ type B = { x: number }; // 行尾注释
type ROOT = {};
`;
    const module = expectOk(parseVfsl(text));
    expect(JSON.stringify(module)).toContain('A');
    expect(JSON.stringify(module)).toContain('B');
  });

  it('对象字段分隔符 ; 与 , 等价，允许混合与尾分隔符（注记 3）', () => {
    const module = expectOk(parseVfsl('type T = { a: string, b?: number; };\ntype ROOT = {};'));
    expect(JSON.stringify(module)).toContain('T');
  });

  it('空对象字面量合法（注记 3）', () => {
    const module = expectOk(parseVfsl('type T = {};\ntype ROOT = {};'));
    expect(JSON.stringify(module)).toContain('T');
  });

  it('联合允许 TS 风格前导 |（注记 2）', () => {
    const module = expectOk(parseVfsl('type T = | "a" | "b";\ntype ROOT = {};'));
    expect(JSON.stringify(module)).toContain('T');
  });

  it('前向引用合法：别名解析与声明顺序无关（§4 引用解析时机）', () => {
    const module = expectOk(parseVfsl('type A = B; type B = string;\ntype ROOT = {};'));
    const serialized = JSON.stringify(module);
    expect(serialized).toContain('A');
    expect(serialized).toContain('B');
  });

  it('UTF-8 BOM 剥离且不报错，BOM 不占列（§9.2）', () => {
    const module = expectOk(parseVfsl('\uFEFFtype A = string;\ntype ROOT = {};'));
    expect(JSON.stringify(module)).toContain('A');
  });

  it('任意位置空白不参与语法推导（注记 9）：紧凑写法与分散写法均可解析', () => {
    const compact = expectOk(parseVfsl('type T={a:string,b?:number};\ntype ROOT = {};'));
    const spread = expectOk(parseVfsl('type T = {\n  a: string;\n  b?: number;\n};\ntype ROOT = {};'));
    expect(JSON.stringify(compact)).toContain('T');
    expect(JSON.stringify(spread)).toContain('T');
  });
});
