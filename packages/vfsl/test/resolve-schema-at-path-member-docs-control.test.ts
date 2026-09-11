/**
 * SA6 负控测试 — issue #308（docs 切片并入 memberDocs 第三来源）。
 *
 * 契约来源：SA6 验收契约 §6/§12.5（C1–C9）；目标（AC2）：**不使用 M4 的 schema 投影
 * 输出逐字节不变** + 空条目过滤 / 未选中键不泄漏 / 守卫不得要求 memberDocs /
 * 四件套形状与确定性 / 非 docs 部分不变 / 存量不变量保持。
 *
 * 本文件在实现前后**均须全绿**：C1/C2/C3/C8 为冻结摘要逐路径对账（摘要录制于实现前
 * HEAD `4d4208b`，SA6 §12.4），C4–C7/C9 为行为不变量。断言一律经公共入口
 * `parseVfsl` → `evaluate` → `resolveSchemaAtPath`，不读源码、不 grep 文本、不 skip/only。
 *
 * C9 的可执行面 = 既有 M4-free 不变量族（镜像 `resolve-schema-at-path.test.ts`
 * L449–485：docs 键 ⊆ fieldDocs∪markerDocs 且内容 = field+marker）；「既有测试文件
 * 零改动仍绿」由实现报告的 runner 记录 + `git status` 证据锚定（禁止修改既有测试）。
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { evaluate, parseVfsl, resolveSchemaAtPath } from '../src/index.js';
import type { DerivedSchema, VfslModule } from '../src/index.js';
import { FIXTURE_TEXT } from './resolve-schema-at-path-fixture.js';
import { FIXTURE_B, SPEC_FIXTURE } from './union-member-docs-fixture.js';
import {
  FIXTURE_B_PROJECTION_DIGESTS,
  FIXTURE_TEXT_PROJECTION_DIGESTS,
  M4_CONTRACT_PATHS,
  M4_NONDOCS_DIGESTS,
  M4_STRIPPED_PROJECTION_DIGESTS,
  M4_TEXT,
  SPEC_FIXTURE_PROJECTION_DIGESTS,
  UNRELATED_MEMBER_DOC_KEY,
  UNRELATED_MEMBER_DOC_TEXT,
} from './resolve-schema-at-path-member-docs-fixture.js';
import type { ProjectionDigestCase } from './resolve-schema-at-path-member-docs-fixture.js';

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function parseOk(text: string): VfslModule {
  const result = parseVfsl(text);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`前置 parseVfsl 失败（不应发生）：${JSON.stringify(result.issues)}`);
  }
  return result.module;
}

function evaluateOk(text: string): DerivedSchema {
  const result = evaluate(parseOk(text));
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`前置 evaluate 失败（不应发生）：${JSON.stringify(result.issues)}`);
  }
  return result.derived;
}

/** JSON 深拷贝（派生 schema 纯数据契约；手造对照在拷贝上构造，不污染共享派生物）。 */
function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function m4(): DerivedSchema {
  return evaluateOk(M4_TEXT);
}

function memberDocsOf(derived: DerivedSchema): Record<string, string[]> {
  const table = derived.memberDocs;
  if (table === undefined) {
    throw new Error('前置不变量违反：M4 派生物 memberDocs 键缺席（#306 已合入面）');
  }
  return table;
}

/** 剥离 `memberDocs` 键的 M4 派生物克隆（表缺席对照；ADR 0019 决策 5 条件稀疏）。 */
function strippedClone(): DerivedSchema {
  const derived = deepClone(m4());
  delete derived.memberDocs;
  return derived;
}

function okOf(derived: DerivedSchema, path: readonly (string | number)[]) {
  const r = resolveSchemaAtPath(derived, path);
  expect(r.ok, `${JSON.stringify(path)} 期望 ok:true，实际 ${JSON.stringify(r)}`).toBe(true);
  if (!r.ok) throw new Error('unreachable（上方断言已拦）');
  return r;
}

/** 整投影逐字节摘要对账（`sha256(JSON.stringify(resolve结果))`）。 */
function expectProjectionDigest(derived: DerivedSchema, c: ProjectionDigestCase, label: string): void {
  const r = resolveSchemaAtPath(derived, c.path);
  expect(r.ok, `${label} 路径 ${JSON.stringify(c.path)} 期望 ok:true`).toBe(true);
  expect(sha256(JSON.stringify(r)), `${label} 路径 ${JSON.stringify(c.path)} 摘要`).toBe(c.sha256);
}

describe('C1/C2 — M4-free 夹具整投影逐字节不变（AC2）', () => {
  it('C1：FIXTURE_TEXT 6 条读路径冻结摘要 + docs 无 <member 键', () => {
    const derived = evaluateOk(FIXTURE_TEXT);
    for (const c of FIXTURE_TEXT_PROJECTION_DIGESTS) {
      expectProjectionDigest(derived, c, 'C1 FIXTURE_TEXT');
      const r = okOf(derived, c.path);
      expect(Object.keys(r.docs).every((k) => !k.includes('<member '))).toBe(true);
    }
  });

  it('C2：SPEC_FIXTURE 4 条 + FIXTURE_B 3 条读路径冻结摘要 + docs 无 <member 键', () => {
    const spec = evaluateOk(SPEC_FIXTURE);
    for (const c of SPEC_FIXTURE_PROJECTION_DIGESTS) {
      expectProjectionDigest(spec, c, 'C2 SPEC_FIXTURE');
      const r = okOf(spec, c.path);
      expect(Object.keys(r.docs).every((k) => !k.includes('<member '))).toBe(true);
    }
    const fixtureB = evaluateOk(FIXTURE_B);
    for (const c of FIXTURE_B_PROJECTION_DIGESTS) {
      expectProjectionDigest(fixtureB, c, 'C2 FIXTURE_B');
      const r = okOf(fixtureB, c.path);
      expect(Object.keys(r.docs).every((k) => !k.includes('<member '))).toBe(true);
    }
  });
});

describe('C3/C6 — memberDocs 键缺席惰性 + 守卫不得要求 memberDocs（SA8 F3.1）', () => {
  it('C3：剥离 memberDocs 键后 17 条读路径与旧实现逐字节相同', () => {
    const derived = strippedClone();
    expect(Object.hasOwn(derived, 'memberDocs')).toBe(false);
    for (const c of M4_STRIPPED_PROJECTION_DIGESTS) {
      expectProjectionDigest(derived, c, 'C3 剥离克隆');
    }
  });

  it('C6：无 memberDocs 键的派生物与含表派生物均 ok:true（必填键清单未动）', () => {
    const stripped = strippedClone();
    const withTable = m4();
    for (const path of M4_CONTRACT_PATHS) {
      expect(okOf(stripped, path).ok).toBe(true);
      expect(okOf(withTable, path).ok).toBe(true);
    }
  });
});

describe('C4/C5 — 空条目过滤不变 + 未选中键不泄漏', () => {
  it('C4：memberDocs[U.<member 0>] = [] → 空合并不成键（仅断言缺席；U.<member 1> 在场由 M1 锚定）', () => {
    const derived = deepClone(m4());
    memberDocsOf(derived)['U.<member 0>'] = [];
    const r = okOf(derived, ['u']);
    expect(r.docs['U.<member 0>']).toBeUndefined();
    expect(Object.keys(r.docs)).not.toContain('U.<member 0>');
  });

  it('C5：未选中 memberDocs 键不得泄漏进任何契约路径切片', () => {
    const derived = deepClone(m4());
    derived.memberDocs = { [UNRELATED_MEMBER_DOC_KEY]: [UNRELATED_MEMBER_DOC_TEXT] };
    for (const path of M4_CONTRACT_PATHS) {
      const r = okOf(derived, path);
      expect(JSON.stringify(r.docs)).not.toContain(UNRELATED_MEMBER_DOC_TEXT);
      expect(Object.keys(r.docs)).not.toContain(UNRELATED_MEMBER_DOC_KEY);
    }
    // 替换整表后 Mixed 只剩 M3 marker 条目（member 来源被移走）
    expect(okOf(derived, ['m']).docs).toEqual({ 'Mixed.<member 0>': [' 载体甲 '] });
  });
});

describe('C7 — 四件套形状 / 确定性 / 可序列化（M4 schema 亦然）', () => {
  it('ok 分支恰 5 键；两次调用全等；JSON 往返全等（契约路径全集）', () => {
    const derived = m4();
    for (const path of M4_CONTRACT_PATHS) {
      const r = okOf(derived, path);
      expect(Object.keys(r).sort()).toEqual(['aliasDocs', 'aliases', 'docs', 'ok', 'valueSchema']);
      const again = okOf(derived, path);
      expect(JSON.stringify(again)).toBe(JSON.stringify(r));
      expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    }
  });
});

describe('C8 — M4 schema 非 docs 部分不变（F3.3：合并只在 docs 表层面）', () => {
  it('sha256(JSON.stringify({valueSchema, aliases, aliasDocs})) 逐路径 == 冻结摘要', () => {
    const derived = m4();
    for (const c of M4_NONDOCS_DIGESTS) {
      const r = okOf(derived, c.path);
      const payload = { valueSchema: r.valueSchema, aliases: r.aliases, aliasDocs: r.aliasDocs };
      expect(sha256(JSON.stringify(payload)), `C8 路径 ${JSON.stringify(c.path)}`).toBe(c.sha256);
    }
  });
});

describe('C9 — 存量 M4-free 不变量保持（镜像既有 resolve-schema-at-path.test.ts L449–485）', () => {
  it('docs 键 ⊆ fieldDocs∪markerDocs、内容逐字 = field+marker；aliasDocs/aliases ⊆ 源表', () => {
    const derived = evaluateOk(FIXTURE_TEXT);
    expect(derived.memberDocs).toBeUndefined(); // M4-free 面条件键缺席
    const fieldKeys = new Set(Object.keys(derived.fieldDocs));
    const markerKeys = new Set(Object.keys(derived.markerDocs));
    const aliasDocKeys = new Set(Object.keys(derived.aliasDocs));
    const valueKeys = new Set(Object.keys(derived.values));
    const paths: Array<Array<string | number>> = [
      [],
      ['notes'],
      ['audit'],
      ['audit', 'createdBy'],
      ['config'],
      ['keywords'],
      ['assets'],
      ['assets', 'img1'],
      ['assets', 'img1', 'url'],
      ['u', 'x'],
      ['attachments'],
    ];
    for (const p of paths) {
      const r = okOf(derived, p);
      for (const [k, v] of Object.entries(r.docs)) {
        expect(fieldKeys.has(k) || markerKeys.has(k), `不发明键 ${k}`).toBe(true);
        expect(v).toEqual([...(derived.fieldDocs[k] ?? []), ...(derived.markerDocs[k] ?? [])]);
      }
      for (const [k, v] of Object.entries(r.aliasDocs)) {
        expect(aliasDocKeys.has(k), `aliasDocs 不发明键 ${k}`).toBe(true);
        expect(v).toEqual(derived.aliasDocs[k]);
      }
      for (const k of Object.keys(r.aliases)) {
        expect(valueKeys.has(k), `aliases ⊆ values：${k}`).toBe(true);
      }
    }
  });
});
