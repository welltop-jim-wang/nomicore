/**
 * SA2-F1 验收锚测试 — keyPattern 引擎错误家族通道（Issue #272 / ADR-0016 解析语义；
 * SA1 设计 §7-D7/§12 钉死）。
 *
 * 背景事实链（设计 §2-B15）：parser 不校验 Pattern 正则合法性（§9.1「合法性不在
 * 方言层校验」），semantic/evaluate 对 regex 原文透传、零编译——**evaluate ok 的
 * 合法派生物可携带不可编译/子集外/超限 keyPattern**。因此引擎错误不属「可信域
 * 畸形」（红线 1 的 InternalError throw 通道只管 ref 缺失等），而按内容级
 * fail-closed 收敛 `SCHEMA_PATH_NOT_FOUND`——与写侧 validate.ts L256–280 把四类
 * 引擎错误收敛为值级 issue 的处理对偶（写读同构 ⟺ 命题不因引擎错误崩溃）。
 *
 * 本文件锚定三枚确定性引擎错误（均为编译期、与输入段无关）：
 * 1. `Pattern<"[">`——PatternCompileError（语法非法：裸 `[`）；
 * 2. 反向引用形 `\1`——PatternUnsupportedError（子集外构造）；
 * 3. `a{20000}`——PatternTooLargeError（量词展开超 10_000 指令上限）。
 * 每个夹具先断言 parse + evaluate ok（合法派生物前提）且值树 Record 位携带该
 * keyPattern 原文，再断言：
 * - `['r','k']` → `{ok:false, code:'SCHEMA_PATH_NOT_FOUND'}`（内容级 fail-closed，
 *   不 throw InternalError、不误报 INVALID）；
 * - `['r',7]` → `{ok:false, code:'SCHEMA_PATH_INVALID'}`（形状层先行且独立——引擎
 *   错误不污染形状分类，D8）。
 * 断言全部经公共接缝可观测输出；无 skip/only。
 */
import { describe, expect, it } from 'vitest';
import { evaluate, parseVfsl, resolveSchemaAtPath } from '../src/index.js';
import { InternalError } from '../src/resolve.js';
import type { DerivedSchema, ValueSchema, VfslModule } from '../src/index.js';

function parseOk(text: string): VfslModule {
  const result = parseVfsl(text);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`前置 parseVfsl 失败（不应发生）：${JSON.stringify(result.issues)}`);
  }
  return result.module;
}

function evaluateOk(module: VfslModule): DerivedSchema {
  const result = evaluate(module);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`前置 evaluate 失败（不应发生）：${JSON.stringify(result.issues)}`);
  }
  return result.derived;
}

/** 前置不变量：取 ROOT 字段 f 的 Record 值 schema（逐层显式窄化后返回 kind:'object'）。 */
function recordAt(derived: DerivedSchema, fieldName: string): Extract<ValueSchema, { kind: 'object' }> {
  const rootNode = derived.values['ROOT'];
  if (rootNode === undefined || rootNode.kind !== 'object') {
    throw new Error('前置不变量：ROOT 应为 object');
  }
  const field = rootNode.fields.find((f) => f.name === fieldName);
  if (field === undefined) throw new Error(`前置不变量：ROOT 缺少字段 ${fieldName}`);
  if (field.value.kind !== 'object') throw new Error(`前置不变量：${fieldName} 值应为 Record object`);
  return field.value;
}

/** 断言解析结果 = 目标失败码（且整个过程不抛 InternalError——抛错会使断言失败）。 */
function expectFailure(derived: DerivedSchema, path: readonly (string | number)[], code: 'SCHEMA_PATH_NOT_FOUND' | 'SCHEMA_PATH_INVALID'): void {
  const r = resolveSchemaAtPath(derived, path);
  expect(r).toEqual({ ok: false, code, path: [...path] });
}

describe('resolveSchemaAtPath — keyPattern 引擎错误家族内容级 fail-closed（SA2-F1）', () => {
  it('PatternCompileError（Pattern<"[">）：Record 动态键段 → NOT_FOUND（不 throw）；number 段 → INVALID（形状先行）', () => {
    const text = `
type BadKey = string & Pattern<"[">;
type ROOT = YMap<{ r: Record<BadKey, YLeaf<string>> }>;
`.trim();
    const derived = evaluateOk(parseOk(text));
    // 合法派生物前提：值树 Record 位携带不可编译 keyPattern 原文（求值器零编译透传）
    expect(recordAt(derived, 'r').keyPattern).toBe('[');
    // 引擎错误 = 内容级拒绝（与失配同码同通道）：不 throw InternalError
    expectFailure(derived, ['r', 'k'], 'SCHEMA_PATH_NOT_FOUND');
    expectFailure(derived, ['r', 'key'], 'SCHEMA_PATH_NOT_FOUND');
    // 形状分类先于且独立于 keyPattern 判定：Record 位 number 段仍归 INVALID
    expectFailure(derived, ['r', 7], 'SCHEMA_PATH_INVALID');
  });

  it('PatternUnsupportedError（反向引用 \\1 子集外构造）：同上通道——NOT_FOUND / INVALID 隔离', () => {
    const text = `
type BadKey = string & Pattern<"\\\\1">;
type ROOT = YMap<{ r: Record<BadKey, YLeaf<string>> }>;
`.trim();
    const derived = evaluateOk(parseOk(text));
    expect(recordAt(derived, 'r').keyPattern).toBe('\\1');
    expectFailure(derived, ['r', 'k'], 'SCHEMA_PATH_NOT_FOUND');
    expectFailure(derived, ['r', 7], 'SCHEMA_PATH_INVALID');
  });

  it('PatternTooLargeError（{n,m} 展开超 10_000 指令）：同上通道——NOT_FOUND / INVALID 隔离', () => {
    const text = `
type BadKey = string & Pattern<"a{20000}">;
type ROOT = YMap<{ r: Record<BadKey, YLeaf<string>> }>;
`.trim();
    const derived = evaluateOk(parseOk(text));
    expect(recordAt(derived, 'r').keyPattern).toBe('a{20000}');
    expectFailure(derived, ['r', 'k'], 'SCHEMA_PATH_NOT_FOUND');
    expectFailure(derived, ['r', 7], 'SCHEMA_PATH_INVALID');
  });

  it('引擎错误通道与红线 1 不冲突：同派生物上 ref 缺失仍 throw InternalError（不被 fail-closed 吞掉）', () => {
    const text = `
type BadKey = string & Pattern<"[">;
type GoodKey = string & Pattern<"^[A-Za-z]{1,16}$">;
type Audit = YMap<{ note: YLeaf<string> }>;
type ROOT = YMap<{ bad: Record<BadKey, Audit>; good: Record<GoodKey, Audit> }>;
`.trim();
    const derived = evaluateOk(parseOk(text));
    const cloned = JSON.parse(JSON.stringify(derived)) as DerivedSchema;
    delete cloned.values['Audit'];
    delete cloned.aliases['Audit'];
    // bad 槽（keyPattern 编译失败）：内容级拒绝先结算 → NOT_FOUND，不因槽体 ref 缺失升级为 throw
    expectFailure(cloned, ['bad', 'k'], 'SCHEMA_PATH_NOT_FOUND');
    // good 槽（keyPattern 可判定、键段实测通过）→ 终点 = ref Audit，闭包解析点缺失 → InternalError（红线 1）
    expect(() => resolveSchemaAtPath(cloned, ['good', 'abc'])).toThrow(InternalError);
  });
});
