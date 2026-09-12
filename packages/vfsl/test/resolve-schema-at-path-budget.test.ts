/**
 * Issue #335 红灯契约（运行时）— 投影通道形状预算：三参化 + 截断标记 + 闭包/切片收缩。
 *
 * 契约来源：SA6 `wiki/raw/task_issue-335_sa6_contract.md` §12.2 断言组 G2–G8（含
 * §12.4 计层矩阵、§13 红证据）、设计 `wiki/raw/task_issue-335_design.md` §6.3/§6.3.4/
 * §6.3.5/§6.5–§6.9 与母法 ADR 0024 决策 5。
 *
 * 红灯纪律（SA6 §12.3）：本文件经**动态接缝**取导出（顶层不静态 import 新名目），
 * 以保住包 tsc 对运行时红文件零报错；HEAD 上第三参被静默忽略（P1）→ 标记集合为空、
 * 闭包/切片恒全量、毒化 `{depth:0}` 照抛，逐条在目标断言处红。断言一律经公共入口
 * `parseVfsl` → `evaluate` → `resolveSchemaAtPath` 的**运行时返回结构**（禁止源码
 * 字符串/正则断言）；不 skip/only、不改验收语义。
 *
 * SA4 R1 修复回归（iteration 1）：F1 锚补手造 optional 透明环（自环 + 2-环）——四态
 * （`{depth:0}`/`{depth:N}`/`{}`/width-only）终止且 ok、无裸异常、`{}` 与无预算读
 * **引用级**同构、重复调用逐引用确定（§6.3.5 测试口径；环状输出不可 stringify）。
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import * as vfsl from '../src/index.js';
import { evaluate, parseVfsl, resolveSchemaAtPath } from '../src/index.js';
import type { DerivedSchema, VfslModule } from '../src/index.js';
import { InternalError } from '../src/resolve.js';
import { FIXTURE_TEXT } from './resolve-schema-at-path-fixture.js';
import {
  EXPECTED_DOCS,
  M4_CONTRACT_PATHS,
  M4_ROOT_ALIAS_DOCS,
  M4_ROOT_ALIAS_ORDER,
  M4_TEXT,
} from './resolve-schema-at-path-member-docs-fixture.js';
import {
  BUDGET_ALIAS_ORDER,
  BUDGET_DOCS_MATRIX,
  BUDGET_FIXTURE_TEXT,
  BUDGET_MARKER_MATRIX,
  BUDGET_NO_BUDGET_ALIAS_DOCS_KEYS,
  BUDGET_NO_BUDGET_DIGESTS,
  BUDGET_NO_BUDGET_DOCS_KEYS,
  POISON_ALIAS,
  budgetFixtureDerived,
  containerRingDerived,
  digestKey,
  multiRefDerived,
  optionalRingDerived,
  optionalTwoCycleDerived,
  OPTIONAL_RING_FIELDS,
  poisonedFixtureDerived,
  recursiveAliasDerived,
  unionRingDerived,
} from './resolve-schema-at-path-budget-fixture.js';

// —— 动态接缝与运行时观察形状（类型面由 -budget.test-d.ts 锚定）——

type Clue =
  | { readonly via: 'ref'; readonly name: string }
  | { readonly via: 'container'; readonly containerKind: 'object' | 'array' };

interface ObservedNode {
  readonly kind: string;
  readonly clue?: Clue;
  readonly fields?: ReadonlyArray<{ readonly name: string; readonly value: ObservedNode }>;
  readonly element?: ObservedNode;
  readonly members?: readonly ObservedNode[];
  readonly value?: ObservedNode;
  readonly name?: string;
  readonly values?: readonly (string | number)[];
}

interface ObservedOk {
  readonly ok: true;
  readonly valueSchema: ObservedNode;
  readonly aliases: Readonly<Record<string, ObservedNode>>;
  readonly docs: Readonly<Record<string, readonly string[]>>;
  readonly aliasDocs: Readonly<Record<string, readonly string[]>>;
}

interface ObservedFail {
  readonly ok: false;
  readonly code: string;
  readonly path: readonly (string | number)[];
}

type ObservedResult = ObservedOk | ObservedFail;

/** 预算接缝（HEAD 上第三参被静默忽略 = 红灯机制 1；实现后解释预算）。 */
type BudgetSeam = (
  derived: DerivedSchema,
  path: readonly (string | number)[],
  options?: unknown,
) => ObservedResult;

const budget = resolveSchemaAtPath as unknown as BudgetSeam;

// —— 前置辅助（evaluate 为绿色基线）——

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

function fixture272(): DerivedSchema {
  return evaluateOk(FIXTURE_TEXT);
}

function m4(): DerivedSchema {
  return evaluateOk(M4_TEXT);
}

function expectOk(result: ObservedResult, reason: string): ObservedOk {
  if (!result.ok) {
    throw new Error(`#335 预算通道缺失/失败（${reason}）：${result.code} path=${JSON.stringify(result.path)}`);
  }
  return result;
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function aliasesKeys(result: ObservedOk): string[] {
  return Object.keys(result.aliases);
}

function markerClueText(clue: Clue | undefined): string {
  if (clue === undefined) return 'unknown';
  return clue.via === 'ref' ? `ref:${clue.name}` : `container:${clue.containerKind}`;
}

function collectMarkers(node: ObservedNode, path: string, out: string[]): void {
  switch (node.kind) {
    case 'truncated':
      out.push(`${path} => ${markerClueText(node.clue)}`);
      return;
    case 'object':
      for (const f of node.fields ?? []) collectMarkers(f.value, `${path}.${f.name}`, out);
      return;
    case 'array':
      if (node.element !== undefined) collectMarkers(node.element, `${path}.<item>`, out);
      return;
    case 'union':
      (node.members ?? []).forEach((m, i) => collectMarkers(m, `${path}.<member ${i}>`, out));
      return;
    case 'optional':
      if (node.value !== undefined) collectMarkers(node.value, path, out);
      return;
    default:
      return;
  }
}

/** 投影内全部标记的 ``路径 => 线索`` 集合（valueSchema 以 base 为根锚 + 全部闭包体以别名名为根锚）。 */
function markerDigest(result: ObservedOk, base: string): string[] {
  const out: string[] = [];
  collectMarkers(result.valueSchema, base, out);
  for (const [name, body] of Object.entries(result.aliases)) collectMarkers(body, name, out);
  return out.sort();
}

function collectKinds(node: ObservedNode, out: Set<string>): void {
  if (node.kind === 'truncated') return; // 标记是投影层形态、不入九 kind 扫描
  out.add(node.kind);
  if (node.kind === 'object') for (const f of node.fields ?? []) collectKinds(f.value, out);
  if (node.kind === 'array' && node.element !== undefined) collectKinds(node.element, out);
  if (node.kind === 'union') for (const m of node.members ?? []) collectKinds(m, out);
  if (node.kind === 'optional' && node.value !== undefined) collectKinds(node.value, out);
}

const BUDGET_PATHS: ReadonlyArray<readonly (string | number)[]> = BUDGET_MARKER_MATRIX.map((c) => c.path);

// —— G2/G3：计层规则与截断标记（§6.3.4 矩阵逐格）——

describe('#335 G2/G3 计层规则与截断标记', () => {
  it('G3.1/G3.5 预算夹具全深度标记集合精确相等（多标/少标/弱断言均红）', () => {
    const derived = budgetFixtureDerived();
    for (const matrixCase of BUDGET_MARKER_MATRIX) {
      for (const [depthText, expected] of Object.entries(matrixCase.byDepth)) {
        const depth = Number(depthText);
        const result = expectOk(
          budget(derived, matrixCase.path, { depth }),
          `path=${digestKey(matrixCase.path)} depth=${depth}`,
        );
        expect(markerDigest(result, matrixCase.base)).toEqual([...expected].sort());
      }
    }
  });

  it('G3.1 无预算读恒零标记（同一夹具全路径反例锚）', () => {
    const derived = budgetFixtureDerived();
    for (const path of BUDGET_PATHS) {
      const result = expectOk(resolveSchemaAtPath(derived, path) as ObservedResult, digestKey(path));
      expect(markerDigest(result, 'ROOT')).toEqual([]);
    }
  });

  it('G2.2 optional 透明孪生：opt/req 裁切 depth 相同（d0 双侧被裁、d1 双侧全净）', () => {
    const derived = budgetFixtureDerived();
    const opt0 = expectOk(budget(derived, ['opt'], { depth: 0 }), 'opt d0');
    const req0 = expectOk(budget(derived, ['req'], { depth: 0 }), 'req d0');
    expect(opt0.valueSchema).toEqual({
      kind: 'optional',
      value: { kind: 'truncated', clue: { via: 'container', containerKind: 'object' } },
    });
    expect(req0.valueSchema).toEqual({
      kind: 'truncated',
      clue: { via: 'container', containerKind: 'object' },
    });
    for (const path of [['opt'], ['req']]) {
      const d1 = expectOk(budget(derived, path, { depth: 1 }), `${digestKey(path)} d1`);
      expect(markerDigest(d1, `ROOT.${String(path[0])}`)).toEqual([]);
      expect(JSON.stringify(d1)).toBe(JSON.stringify(resolveSchemaAtPath(derived, path)));
    }
  });

  it('G2.3 union 透明：宿主位永不标记、成员位按索引标记；与去 union 孪生同 depth 裁切', () => {
    const derived = budgetFixtureDerived();
    const d0 = expectOk(budget(derived, ['inlPair'], { depth: 0 }), 'inlPair d0');
    expect(d0.valueSchema.kind).toBe('union');
    expect(markerDigest(d0, 'ROOT.inlPair')).toEqual([
      'ROOT.inlPair.<member 0> => container:object',
      'ROOT.inlPair.<member 1> => container:object',
    ]);
    // 去 union 的同构孪生（plain）：同一 depth 裁切状态一致（d0 被裁、d1 全净）
    const plain0 = expectOk(budget(derived, ['plain'], { depth: 0 }), 'plain d0');
    expect(markerDigest(plain0, 'ROOT.plain')).toEqual(['ROOT.plain => container:object']);
    for (const path of [['inlPair'], ['plain']]) {
      const d1 = expectOk(budget(derived, path, { depth: 1 }), `${digestKey(path)} d1`);
      expect(markerDigest(d1, `ROOT.${String(path[0])}`)).toEqual([]);
      expect(JSON.stringify(d1)).toBe(JSON.stringify(resolveSchemaAtPath(derived, path)));
    }
  });

  it('G2.4 字面量联合（enum）终态：不计层、不产生标记、任意 depth ≡ 无预算', () => {
    const derived = budgetFixtureDerived();
    // 终点为内联 enum（单候选 `plain.kind`；合成 union `inlPair.kind` 两枚 enum 成员）
    for (const path of [['plain', 'kind'], ['inlPair', 'kind']]) {
      const baseline = JSON.stringify(resolveSchemaAtPath(derived, path));
      for (const depth of [0, 1, 2, 9]) {
        const result = expectOk(budget(derived, path, { depth }), `${digestKey(path)} d${depth}`);
        expect(markerDigest(result, 'ROOT')).toEqual([]);
        expect(JSON.stringify(result)).toBe(baseline);
      }
    }
  });

  it('G2.5 ref 终态边界：ref 位标记携带 ref 名、ref 不内联、被裁 ref 目标别名缺席', () => {
    const derived = fixture272();
    const d0 = expectOk(budget(derived, ['assets', 'img1'], { depth: 0 }), 'assets.img1 d0');
    expect(d0.valueSchema).toEqual({
      kind: 'truncated',
      clue: { via: 'ref', name: 'AssetEntity' },
    });
    expect(aliasesKeys(d0)).toEqual([]);
    const d1 = expectOk(budget(derived, ['assets', 'img1'], { depth: 1 }), 'assets.img1 d1');
    expect(d1.valueSchema).toEqual({ kind: 'ref', name: 'AssetEntity' }); // 不内联
    expect(aliasesKeys(d1)).toEqual(['AssetEntity']);
    expect(markerDigest(d1, 'ROOT.assets.<key>')).toEqual([
      'AssetEntity.<member 0>.audit => ref:Audit',
      'AssetEntity.<member 1>.audit => ref:Audit',
    ]);
    const d2 = expectOk(budget(derived, ['assets', 'img1'], { depth: 2 }), 'assets.img1 d2');
    expect(d2.valueSchema).toEqual({ kind: 'ref', name: 'AssetEntity' });
    expect(aliasesKeys(d2)).toEqual(['AssetEntity', 'Audit']);
    expect(markerDigest(d2, 'ROOT.assets.<key>')).toEqual([]);
  });

  it('G2.5 ref 终态边界：终点 ref 位标记的线索为 ref 名（含 [#272] audit 位）', () => {
    const derived = fixture272();
    const audit0 = expectOk(budget(derived, ['audit'], { depth: 0 }), 'audit d0');
    expect(audit0.valueSchema).toEqual({ kind: 'truncated', clue: { via: 'ref', name: 'Audit' } });
    expect(aliasesKeys(audit0)).toEqual([]);
    const audit1 = expectOk(budget(derived, ['audit'], { depth: 1 }), 'audit d1');
    expect(audit1.valueSchema).toEqual({ kind: 'ref', name: 'Audit' });
    expect(aliasesKeys(audit1)).toEqual(['Audit']);
    expect(markerDigest(audit1, 'ROOT.audit')).toEqual([]);
    // ROOT 终点 d0：容器位标记（容器 kind 线索）
    const root0 = expectOk(budget(derived, [], { depth: 0 }), '[] d0');
    expect(root0.valueSchema).toEqual({
      kind: 'truncated',
      clue: { via: 'container', containerKind: 'object' },
    });
    expect(aliasesKeys(root0)).toEqual([]);
    expect(root0.docs).toEqual({});
  });

  it('G2.6 终态终点 no-op：scalar/xml/pattern 终点任意 depth ≡ 无预算', () => {
    const derived = fixture272();
    for (const path of [['notes'], ['audit', 'createdBy'], ['config', 'retries']]) {
      const baseline = JSON.stringify(resolveSchemaAtPath(derived, path));
      for (const depth of [0, 1, 3]) {
        const result = expectOk(budget(derived, path, { depth }), `${digestKey(path)} d${depth}`);
        expect(JSON.stringify(result)).toBe(baseline);
      }
    }
  });

  it('G2.7 确定性 + depth 单调前沿下移（不跨层跳变）', () => {
    const derived = budgetFixtureDerived();
    const once = expectOk(budget(derived, [], { depth: 2 }), '[] d2');
    const twice = expectOk(budget(derived, [], { depth: 2 }), '[] d2 again');
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
    // 单调：裁切前沿恰好下移一个容器层——d2 的 ref 位标记（Ledger.audit）在 d3 展开为目标
    // 体（闭包内 Audit），前沿标记改为 Audit.notes；不出现跨层跳变或残留上层标记。
    const d3 = expectOk(budget(derived, [], { depth: 3 }), '[] d3');
    expect(markerDigest(once, 'ROOT')).toEqual([
      'Ledger.audit => ref:Audit',
      'ROOT.deep.mid => container:object',
      'ROOT.modeMap.<key> => ref:Mode',
      'ROOT.modes.<item> => ref:Mode',
    ]);
    expect(markerDigest(d3, 'ROOT')).toEqual([
      'Audit.notes => container:array',
      'ROOT.deep.mid.leaf => ref:Ledger',
    ]);
  });

  it('G3.2/G3.3 标记形状：kind=truncated + 线索嵌套判别（ref 名优先 / 容器 kind 可区分）', () => {
    const derived = budgetFixtureDerived();
    const root0 = expectOk(budget(derived, [], { depth: 0 }), '[] d0');
    expect(root0.valueSchema).toEqual({
      kind: 'truncated',
      clue: { via: 'container', containerKind: 'object' },
    });
    const modes0 = expectOk(budget(derived, ['modes'], { depth: 0 }), 'modes d0');
    expect(modes0.valueSchema).toEqual({
      kind: 'truncated',
      clue: { via: 'container', containerKind: 'array' },
    });
    const mode0 = expectOk(budget(derived, ['mode'], { depth: 0 }), 'mode d0');
    expect(mode0.valueSchema).toEqual({ kind: 'truncated', clue: { via: 'ref', name: 'Mode' } });
  });

  it('G3.4 标记是投影层形态：derived 深比较零变异、非标记节点 kind ⊂ 九 kind', () => {
    const derived = budgetFixtureDerived();
    const before = JSON.stringify(derived);
    const result = expectOk(budget(derived, [], { depth: 1 }), '[] d1');
    expect(JSON.stringify(derived)).toBe(before);
    const kinds = new Set<string>();
    collectKinds(result.valueSchema, kinds);
    for (const body of Object.values(result.aliases)) collectKinds(body, kinds);
    for (const kind of kinds) {
      expect(['object', 'array', 'xml', 'union', 'enum', 'pattern', 'scalar', 'optional', 'ref']).toContain(kind);
    }
  });

  it('G1.2（运行时）公共守卫 isSchemaTruncationMarker 判别标记形态', () => {
    const guard = (vfsl as unknown as { isSchemaTruncationMarker?: (node: unknown) => boolean })
      .isSchemaTruncationMarker;
    expect(typeof guard).toBe('function');
    if (guard === undefined) return;
    const derived = budgetFixtureDerived();
    const result = expectOk(budget(derived, [], { depth: 0 }), '[] d0');
    expect(guard(result.valueSchema)).toBe(true);
    expect(guard({ kind: 'truncated', clue: { via: 'ref', name: 'X' } })).toBe(true);
    expect(guard({ kind: 'truncated', clue: { via: 'container', containerKind: 'array' } })).toBe(true);
    expect(guard({ kind: 'object', fields: [] })).toBe(false);
    expect(guard({ kind: 'truncated', clue: { via: 'bogus' } })).toBe(false);
    expect(guard({ kind: 'truncated' })).toBe(false);
    expect(guard(null)).toBe(false);
  });
});

// —— G4：别名闭包收缩（精确集合）——

describe('#335 G4 别名闭包收缩', () => {
  it('G4.1 aliases 键集 = 展开位可达 ref 的传递闭包（预算夹具精确集合）', () => {
    const derived = budgetFixtureDerived();
    expect(aliasesKeys(expectOk(budget(derived, [], { depth: 0 }), '[] d0'))).toEqual([]);
    expect(aliasesKeys(expectOk(budget(derived, [], { depth: 1 }), '[] d1'))).toEqual([]);
    expect(aliasesKeys(expectOk(budget(derived, [], { depth: 2 }), '[] d2'))).toEqual([
      'Ledger',
      'Pair',
      'Mode',
    ]);
    expect(aliasesKeys(expectOk(budget(derived, [], { depth: 3 }), '[] d3'))).toEqual([
      'Ledger',
      'Audit',
      'Pair',
      'Mode',
    ]);
    expect(aliasesKeys(expectOk(budget(derived, [], { depth: 4 }), '[] d4'))).toEqual([
      ...BUDGET_ALIAS_ORDER,
    ]);
  });

  it('G4.1/G4.2 [#272] 闭包随展开层收缩（被裁 ref 缺席、展开 ref 内容与无预算读同名别名一致）', () => {
    const derived = fixture272();
    expect(aliasesKeys(expectOk(budget(derived, ['assets', 'img1'], { depth: 0 }), 'd0'))).toEqual([]);
    expect(aliasesKeys(expectOk(budget(derived, ['assets', 'img1'], { depth: 1 }), 'd1'))).toEqual([
      'AssetEntity',
    ]);
    expect(aliasesKeys(expectOk(budget(derived, ['assets', 'img1'], { depth: 2 }), 'd2'))).toEqual([
      'AssetEntity',
      'Audit',
    ]);
    expect(aliasesKeys(expectOk(budget(derived, [], { depth: 1 }), '[] d1'))).toEqual([]);
    expect(aliasesKeys(expectOk(budget(derived, [], { depth: 2 }), '[] d2'))).toEqual(['Audit', 'U']);
    expect(aliasesKeys(expectOk(budget(derived, [], { depth: 3 }), '[] d3'))).toEqual([
      'Audit',
      'AssetEntity',
      'U',
    ]);
    // 展开 ref 的闭包条目在 d≥2 与无预算读同名别名一致（净体 = 原节点引用）
    const d2 = expectOk(budget(derived, ['assets', 'img1'], { depth: 2 }), 'd2');
    const plainResult = resolveSchemaAtPath(derived, ['assets', 'img1']) as ObservedOk;
    expect(d2.aliases['AssetEntity']).toBe(plainResult.aliases['AssetEntity']);
    expect(d2.aliases['Audit']).toBe(plainResult.aliases['Audit']);
  });

  it('G4.3 递归别名终止、单名闭包、JSON 可序列化', () => {
    const derived = recursiveAliasDerived();
    const result = expectOk(budget(derived, [], {}), 'recursive {}');
    expect(aliasesKeys(result)).toEqual(['ROOT']);
    expect(JSON.parse(JSON.stringify(result))).toEqual(
      JSON.parse(JSON.stringify(resolveSchemaAtPath(derived, []))),
    );
    expect(JSON.stringify(result)).toBe(JSON.stringify(resolveSchemaAtPath(derived, [])));
  });

  it('G4.4 越界遍历哨兵：毒化派生物 {depth:0} ok，与无预算 throw 构成差分', () => {
    const poisoned = poisonedFixtureDerived();
    expect(() => resolveSchemaAtPath(poisoned, [])).toThrow(InternalError);
    const d0 = expectOk(budget(poisoned, [], { depth: 0 }), 'poison [] d0');
    expect(d0.valueSchema.kind).toBe('truncated');
    expect(aliasesKeys(d0)).toEqual([]);
    // 触达位（展开足够深）仍必须走可信域 throw 通道（InternalError，非裸 TypeError）
    let thrown: unknown;
    try {
      budget(poisoned, [], { depth: 4 });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(InternalError);
    expect((thrown as Error).message).toContain(POISON_ALIAS);
  });

  it('G4.4 [#272 型] {depth:N} 毒化三态差分（d0 ok / 浅位 d1 ok / 触达位 d2 throw）', () => {
    const poisoned = poisonedFixtureDerived();
    expect(expectOk(budget(poisoned, ['assets', 'img1'], { depth: 0 }), 'd0').ok).toBe(true);
    expect(expectOk(budget(poisoned, ['assets', 'img1'], { depth: 1 }), 'd1').ok).toBe(true);
    expect(() => budget(poisoned, ['assets', 'img1'], { depth: 2 })).toThrow(InternalError);
  });
});

// —— G5：docs/aliasDocs 切片收缩 ——

describe('#335 G5 docs/aliasDocs 切片收缩', () => {
  it('G5.2 精确键集矩阵（被裁路径省略 / 脊柱键保留 pin / aliasDocs 随闭包）', () => {
    const derived = budgetFixtureDerived();
    for (const matrixCase of BUDGET_DOCS_MATRIX) {
      const result = expectOk(
        budget(derived, matrixCase.path, { depth: matrixCase.depth }),
        `${digestKey(matrixCase.path)} d${matrixCase.depth}`,
      );
      expect(Object.keys(result.docs)).toEqual([...matrixCase.docsKeys]);
      expect(Object.keys(result.aliasDocs)).toEqual([...matrixCase.aliasDocsKeys]);
    }
  });

  it('G5.1 预算切片 ⊆ 无预算键集且共享键内容逐字相等（三源合并序不变）', () => {
    const derived = budgetFixtureDerived();
    for (const path of BUDGET_PATHS) {
      const baseline = resolveSchemaAtPath(derived, path) as ObservedOk;
      for (const options of [{}, { depth: 0 }, { depth: 1 }, { depth: 2 }, { maxChildrenPerNode: 3 }]) {
        const result = expectOk(budget(derived, path, options), `${digestKey(path)} ${JSON.stringify(options)}`);
        for (const [key, content] of Object.entries(result.docs)) {
          expect(baseline.docs[key]).toEqual(content);
        }
        for (const [key, content] of Object.entries(result.aliasDocs)) {
          expect(baseline.aliasDocs[key]).toEqual(content);
        }
      }
    }
  });

  it('G5.2 被裁别名无 aliasDocs 条目、被裁路径键缺席（#272 d1/d2 差分）', () => {
    const derived = fixture272();
    const d1 = expectOk(budget(derived, ['assets', 'img1'], { depth: 1 }), 'd1');
    expect(Object.keys(d1.docs)).toEqual([]);
    expect(Object.keys(d1.aliasDocs)).toEqual(['AssetEntity']);
    const d0 = expectOk(budget(derived, [], { depth: 1 }), '[] d1');
    expect(Object.keys(d0.docs)).toEqual(['ROOT.notes']);
    expect(Object.keys(d0.aliasDocs)).toEqual([]);
    const d2 = expectOk(budget(derived, [], { depth: 2 }), '[] d2');
    expect(Object.keys(d2.docs)).toEqual([
      'Audit.createdBy',
      'ROOT.audit',
      'ROOT.notes',
      'ROOT.keywords',
      'ROOT.config',
    ]);
    expect(Object.keys(d2.aliasDocs)).toEqual(['Audit']);
  });

  it('G5.3 键文法不发明新键（预算键 ⊆ 无预算键）', () => {
    const derived = m4();
    const baseline = resolveSchemaAtPath(derived, []) as ObservedOk;
    const result = expectOk(budget(derived, [], { depth: 1 }), 'm4 [] d1');
    for (const key of Object.keys(result.docs)) {
      expect(Object.hasOwn(baseline.docs, key)).toBe(true);
    }
    for (const key of Object.keys(result.aliasDocs)) {
      expect(Object.hasOwn(baseline.aliasDocs, key)).toBe(true);
    }
  });
});

// —— G6：width 对投影无操作 ——

describe('#335 G6 width 无操作', () => {
  it('G6.1 width-only ≡ 无预算读（逐字节；合法 width 全值域）', () => {
    const derived = budgetFixtureDerived();
    for (const path of BUDGET_PATHS) {
      const baseline = JSON.stringify(resolveSchemaAtPath(derived, path));
      for (const maxChildrenPerNode of [0, 1, 3, 1000]) {
        const result = expectOk(budget(derived, path, { maxChildrenPerNode }), `${digestKey(path)} w${maxChildrenPerNode}`);
        expect(JSON.stringify(result)).toBe(baseline);
      }
    }
  });

  it('G6.2 {depth,maxChildrenPerNode} ≡ {depth}', () => {
    const derived = budgetFixtureDerived();
    for (const path of BUDGET_PATHS) {
      for (const depth of [0, 1, 2, 3]) {
        const withWidth = expectOk(
          budget(derived, path, { depth, maxChildrenPerNode: 1 }),
          `${digestKey(path)} d${depth} w1`,
        );
        const withoutWidth = expectOk(budget(derived, path, { depth }), `${digestKey(path)} d${depth}`);
        expect(JSON.stringify(withWidth)).toBe(JSON.stringify(withoutWidth));
      }
    }
  });

  it('G6.3 非法 width 走 options 失败面（不得静默忽略）', () => {
    const derived = budgetFixtureDerived();
    for (const maxChildrenPerNode of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '1', null]) {
      const result = budget(derived, [], { maxChildrenPerNode });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('SCHEMA_OPTIONS_INVALID');
    }
  });
});

// —— G7：options 校验（判别联合、不抛、无部分截断）——

describe('#335 G7 options 校验', () => {
  it('G7.1 空 options {} ≡ 无预算（逐字节）', () => {
    const derived = budgetFixtureDerived();
    for (const path of BUDGET_PATHS) {
      const result = expectOk(budget(derived, path, {}), `${digestKey(path)} {}`);
      expect(JSON.stringify(result)).toBe(JSON.stringify(resolveSchemaAtPath(derived, path)));
    }
  });

  it('G7.2 非法 options 矩阵 → 判别失败、同步不抛、path 新鲜副本回显', () => {
    const derived = budgetFixtureDerived();
    const invalid: unknown[] = [
      null,
      42,
      'depth',
      [],
      { depth: -1 },
      { depth: 1.5 },
      { depth: Number.NaN },
      { depth: Number.POSITIVE_INFINITY },
      { depth: '1' },
      { depth: undefined },
      { maxChildrenPerNode: -1 },
      { maxChildrenPerNode: undefined },
      { unknownKey: 1 },
      { depth: 1, extra: true },
    ];
    for (const options of invalid) {
      const path = ['shallow'];
      let result: ObservedResult | undefined;
      expect(() => {
        result = budget(derived, path, options);
      }).not.toThrow();
      if (result === undefined) throw new Error('非法 options 未结算');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('SCHEMA_OPTIONS_INVALID');
        expect(result.path).toEqual(['shallow']);
        expect(result.path).not.toBe(path); // 新鲜副本
      }
    }
  });

  it('G7.2 次序：path 形状违约胜、options 违约先于游走期 NOT_FOUND', () => {
    const derived = budgetFixtureDerived();
    const shapeInvalidPath = [true] as unknown as readonly (string | number)[];
    const bothInvalid = budget(derived, shapeInvalidPath, { depth: -1 });
    expect(bothInvalid.ok).toBe(false);
    if (!bothInvalid.ok) {
      expect(bothInvalid.code).toBe('SCHEMA_PATH_INVALID');
      expect(bothInvalid.path).toEqual([true]);
    }
    const notFoundWithBadOptions = budget(derived, ['nope'], { depth: -1 });
    expect(notFoundWithBadOptions.ok).toBe(false);
    if (!notFoundWithBadOptions.ok) {
      expect(notFoundWithBadOptions.code).toBe('SCHEMA_OPTIONS_INVALID');
      expect(notFoundWithBadOptions.path).toEqual(['nope']);
    }
  });

  it('G7.2 次序：options 校验先于 derived 可信域守卫（敌意通道不漏 InternalError）', () => {
    // 手造畸形派生物（缺五表）——无 options 时 throw InternalError（可信域通道）；
    // options 非法时必须以 SCHEMA_OPTIONS_INVALID 判别失败结算，不泄漏 InternalError。
    const malformed = { structure: { kind: 'root' } } as unknown as DerivedSchema;
    expect(() => resolveSchemaAtPath(malformed, [])).toThrow(InternalError);
    let result: ObservedResult | undefined;
    expect(() => {
      result = budget(malformed, [], { depth: -1 });
    }).not.toThrow();
    if (result === undefined) throw new Error('非法 options + 畸形派生物未结算');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('SCHEMA_OPTIONS_INVALID');
  });

  it('G7.3 合法预算 → ok 且行为按 G2–G6（无 options 回显键）', () => {
    const derived = budgetFixtureDerived();
    const result = expectOk(budget(derived, [], { depth: 1 }), '[] d1');
    expect(Object.keys(result)).toEqual(['ok', 'valueSchema', 'aliases', 'docs', 'aliasDocs']);
    expect(Object.hasOwn(result, 'truncated')).toBe(false);
  });

  it('G7.4 敌意 options（抛错 getter / Proxy）不泄漏裸异常', () => {
    const derived = budgetFixtureDerived();
    const hostileGetter = {
      get depth(): number {
        throw new Error('boom-depth');
      },
    };
    const hostileKeys = new Proxy(
      {},
      {
        ownKeys(): string[] {
          throw new Error('boom-ownKeys');
        },
      },
    );
    for (const options of [hostileGetter, hostileKeys]) {
      let result: ObservedResult | undefined;
      expect(() => {
        result = budget(derived, [], options);
      }).not.toThrow();
      if (result === undefined) throw new Error('敌意 options 未结算');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('SCHEMA_OPTIONS_INVALID');
        expect(result.path).toEqual([]);
      }
    }
  });
});

// —— G8：无预算逐字节回归锚（含第三参调用）——

describe('#335 G8 无预算逐字节回归锚', () => {
  it('G8.1 预算夹具无预算基线冻结（14+ 路径摘要与失败码）', () => {
    const derived = budgetFixtureDerived();
    for (const [key, digest] of Object.entries(BUDGET_NO_BUDGET_DIGESTS)) {
      const path = JSON.parse(key) as (string | number)[];
      const result = resolveSchemaAtPath(derived, path) as ObservedResult;
      expect(sha256(JSON.stringify(result))).toBe(digest);
    }
  });

  it('G8.2 显式 undefined 第三参 ≡ 缺省（逐字节）', () => {
    const derived = budgetFixtureDerived();
    for (const path of BUDGET_PATHS) {
      const result = expectOk(budget(derived, path, undefined), `${digestKey(path)} undefined`);
      expect(JSON.stringify(result)).toBe(JSON.stringify(resolveSchemaAtPath(derived, path)));
    }
  });

  it('G8.3 充足 depth ≡ 无预算（逐字节；含闭包体内嵌 ref 的深链）', () => {
    const derived = budgetFixtureDerived();
    for (const path of BUDGET_PATHS) {
      const result = expectOk(budget(derived, path, { depth: 32 }), `${digestKey(path)} d32`);
      expect(JSON.stringify(result)).toBe(JSON.stringify(resolveSchemaAtPath(derived, path)));
    }
  });

  it('G8.4 零跨调用状态：预算读与无预算读交错互不影响', () => {
    const derived = budgetFixtureDerived();
    const baseline = JSON.stringify(resolveSchemaAtPath(derived, []));
    expectOk(budget(derived, [], { depth: 1 }), 'd1');
    expect(JSON.stringify(resolveSchemaAtPath(derived, []))).toBe(baseline);
    expectOk(budget(derived, [], { depth: 2 }), 'd2');
    expect(JSON.stringify(resolveSchemaAtPath(derived, []))).toBe(baseline);
  });

  it('G8.3 [#272] 充足 depth ≡ 无预算（14 路径含两枚失败码）', () => {
    const derived = fixture272();
    const paths: ReadonlyArray<readonly (string | number)[]> = [
      [],
      ['audit'],
      ['assets'],
      ['assets', 'img1'],
      ['assets', 'img1', 'url'],
      ['notes'],
      ['keywords'],
      ['u', 'x'],
      ['config'],
      ['config', 'retries'],
      ['nope'],
      [0],
      ['keywords', -1],
      ['u'],
    ];
    for (const path of paths) {
      const result = budget(derived, path, { depth: 32 });
      expect(JSON.stringify(result)).toBe(JSON.stringify(resolveSchemaAtPath(derived, path)));
    }
  });
});

// —— F2 锚：enum（字面量联合）成员注释键（评审 F2 修复的逐字节差分）——

describe('#335 F2 锚 enum 成员注释键', () => {
  it('零标记态（{} / 充足 depth / width-only）与无预算读逐字节相等（M4 型 16 路径）', () => {
    const derived = m4();
    for (const path of M4_CONTRACT_PATHS) {
      const baseline = JSON.stringify(resolveSchemaAtPath(derived, path));
      for (const options of [{}, { depth: 4 }, { maxChildrenPerNode: 1 }, { depth: 4, maxChildrenPerNode: 3 }]) {
        const result = expectOk(budget(derived, path, options), `${digestKey(path)} ${JSON.stringify(options)}`);
        expect(JSON.stringify(result)).toBe(baseline);
      }
    }
  });

  it('M4 `[]` 零标记态 docs = 23 键、aliasDocs 与闭包序与无预算一致', () => {
    const derived = m4();
    const result = expectOk(budget(derived, [], { depth: 4 }), 'm4 [] d4');
    expect(result.docs).toEqual(EXPECTED_DOCS);
    expect(Object.keys(result.docs)).toHaveLength(23);
    expect(aliasesKeys(result)).toEqual([...M4_ROOT_ALIAS_ORDER]);
    expect(result.aliasDocs).toEqual(M4_ROOT_ALIAS_DOCS);
  });

  it('被裁宿主位下的 enum 成员键省略（裁剪语义不因 F2 修复而扩大或缩小）', () => {
    const derived = m4();
    const d1 = expectOk(budget(derived, [], { depth: 1 }), 'm4 [] d1');
    expect(Object.hasOwn(d1.docs, 'ROOT.recInline.<key>.<member 0>')).toBe(false);
    expect(Object.hasOwn(d1.docs, 'ROOT.inlineItems.<item>.<member 0>')).toBe(false);
    expect(Object.hasOwn(d1.docs, 'Status.<member 0>')).toBe(false);
    // 未裁宿主位的 enum 终态成员键仍在（内联 enum 是终态、不因预算丢失）
    expect(Object.hasOwn(d1.docs, 'ROOT.mode.<member 0>')).toBe(true);
  });

  it('enum 终态终点任意 depth：docs 含成员键且 ≡ 无预算（`[mode]` / `[s]`）', () => {
    const derived = m4();
    const mode0 = expectOk(budget(derived, ['mode'], { depth: 0 }), "['mode'] d0");
    expect(mode0.docs).toEqual({
      'ROOT.mode.<member 0>': [' 开 '],
      'ROOT.mode.<member 1>': [' 关 '],
    });
    const status0 = expectOk(budget(derived, ['s'], { depth: 0 }), "['s'] d0");
    expect(status0.docs).toEqual({}); // ref 位被裁 ⇒ 无闭包 ⇒ 无闭包锚键（脊柱 ROOT.s 不在三表中）
    const status1 = expectOk(budget(derived, ['s'], { depth: 1 }), "['s'] d1");
    expect(status1.docs).toEqual({
      'Status.<member 0>': [' 草稿：可继续编辑 '],
      'Status.<member 1>': [' 已提交：只可追加备注 '],
    });
    expect(status1.aliasDocs).toEqual({ Status: [' 订单生命周期状态 '] });
    expect(JSON.stringify(status1)).toBe(JSON.stringify(resolveSchemaAtPath(derived, ['s'])));
  });
});

// —— F1 锚：环语义（§6.3.5 两相防御；不发散、无裸异常、透传同构、确定）——

/** 取字段值位（按名；缺位即前置不变量违反——环夹具形状由 F1 环构造器固定）。 */
function fieldValue(
  fields: ReadonlyArray<{ readonly name: string; readonly value: ObservedNode }>,
  name: string,
): ObservedNode {
  const field = fields.find((f) => f.name === name);
  if (field === undefined) throw new Error(`前置不变量违反：缺字段 ${name}`);
  return field.value;
}

/** 取手造环夹具 ROOT 的字段值位（`handMade` 值树形状固定；字段名见 `OPTIONAL_RING_FIELDS`）。 */
function ringField(derived: DerivedSchema, name: string): ObservedNode {
  const root = derived.values['ROOT'] as unknown as ObservedNode;
  return fieldValue(root.fields ?? [], name);
}

/** SA4 R1 四态探针（`{depth:0}` / `{depth:N}` / `{}` / width-only）。 */
const OPTIONAL_RING_PROBE_OPTIONS: ReadonlyArray<unknown> = [
  { depth: 0 },
  { depth: 1 },
  { depth: 2 },
  { depth: 100 },
  {},
  { maxChildrenPerNode: 1 },
];

/**
 * SA4 R1 回归协议（手造 optional 透明环：自环 / 2-环）——四态（`{depth:0}` /
 * `{depth:N}` / `{}` / width-only）终止且 ok、无裸异常；`{}`/充足 depth 与无预算读
 * **引用级**同构（环状输出不可 `JSON.stringify`，以引用相等断言）；重复调用逐引用确定。
 * 环位无标记（透明环重入即透传原引用，§6.3.5），有界预算的标记只出现在环外容器位与
 * ref 终态边界位。
 */
function expectOptionalRingProtocol(derived: DerivedSchema, label: string): void {
  const baseline = resolveSchemaAtPath(derived, []) as ObservedOk;
  expect(baseline.ok).toBe(true);
  expect(baseline.valueSchema).toBe(derived.values['ROOT']);
  expect(aliasesKeys(baseline)).toEqual(['RingAlias']);
  const ringAlias = derived.values['RingAlias'] as unknown as ObservedNode;
  expect(baseline.aliases['RingAlias']).toBe(ringAlias);
  const cycle = ringField(derived, 'x');

  // 四态：结算即证明不挂起；且不抛裸异常（RangeError/TypeError 均会在此红）
  for (const options of OPTIONAL_RING_PROBE_OPTIONS) {
    let result: ObservedResult | undefined;
    expect(
      () => {
        result = budget(derived, [], options);
      },
      `${label} ${JSON.stringify(options)} 不得抛裸异常`,
    ).not.toThrow();
    if (result === undefined) {
      throw new Error(`${label} ${JSON.stringify(options)} 未结算（预算游走不终止）`);
    }
    expect(result.ok, `${label} ${JSON.stringify(options)} 应为 ok`).toBe(true);
  }

  // `{depth:0}`：终点容器折叠为单标记（零物化、不触达环位）；标记每调用新鲜 → 深比较确定
  const d0 = expectOk(budget(derived, [], { depth: 0 }), `${label} d0`);
  expect(d0.valueSchema.kind).toBe('truncated');
  expect(d0.valueSchema.clue).toEqual({ via: 'container', containerKind: 'object' });
  expect(aliasesKeys(d0)).toEqual([]);
  const d0Again = expectOk(budget(derived, [], { depth: 0 }), `${label} d0 again`);
  expect(d0Again.valueSchema).toEqual(d0.valueSchema);

  // `{depth:1}`：ROOT 有界壳——环位（object 字段值位 / union 成员位）透传原引用；array 位
  // 与 ref 位标记；被裁 ref ⇒ 目标别名缺席
  const d1 = expectOk(budget(derived, [], { depth: 1 }), `${label} d1`);
  expect(d1.valueSchema.kind).toBe('object');
  expect(d1.valueSchema).not.toBe(baseline.valueSchema);
  const d1Fields = d1.valueSchema.fields ?? [];
  expect(d1Fields.map((f) => f.name)).toEqual([...OPTIONAL_RING_FIELDS]);
  expect(fieldValue(d1Fields, 'x')).toBe(cycle); // object 字段值位：透明环重入透传原引用
  expect(fieldValue(d1Fields, 'arr').kind).toBe('truncated');
  expect(fieldValue(d1Fields, 'arr').clue).toEqual({ via: 'container', containerKind: 'array' });
  expect(fieldValue(d1Fields, 'u').kind).toBe('union'); // union 透明：宿主位在场、成员环位透传
  expect((fieldValue(d1Fields, 'u').members ?? [])[0]).toBe(cycle);
  expect(fieldValue(d1Fields, 'ringRef').kind).toBe('truncated');
  expect(fieldValue(d1Fields, 'ringRef').clue).toEqual({ via: 'ref', name: 'RingAlias' });
  expect(aliasesKeys(d1)).toEqual([]);

  // `{}`/充足 depth/width-only/显式 undefined：与无预算读引用级同构（含闭包体内环）
  for (const options of [{}, { depth: 2 }, { depth: 100 }, { maxChildrenPerNode: 3 }, undefined]) {
    const ok = expectOk(budget(derived, [], options), `${label} ${JSON.stringify(options)}`);
    expect(ok.valueSchema).toBe(baseline.valueSchema);
    expect(aliasesKeys(ok)).toEqual(['RingAlias']);
    expect(ok.aliases['RingAlias']).toBe(ringAlias);
  }

  // 重复调用逐引用确定（无跨调用状态；环状输出不可 stringify）
  const again = expectOk(budget(derived, [], {}), `${label} {} again`);
  expect(again.valueSchema).toBe(baseline.valueSchema);
  expect(again.aliases['RingAlias']).toBe(ringAlias);
  const d1Again = expectOk(budget(derived, [], { depth: 1 }), `${label} d1 again`);
  const d1AgainFields = d1Again.valueSchema.fields ?? [];
  expect(fieldValue(d1AgainFields, 'x')).toBe(cycle);
  expect(fieldValue(d1AgainFields, 'arr')).toEqual(fieldValue(d1Fields, 'arr'));
  expect(fieldValue(d1AgainFields, 'u')).toBe(fieldValue(d1Fields, 'u'));
  expect(fieldValue(d1AgainFields, 'ringRef')).toEqual(fieldValue(d1Fields, 'ringRef'));
}

describe('#335 F1 环语义', () => {
  it('SA4 R1 透明环（optional 自环）：终止、无裸异常、{} 引用同构、逐引用确定', () => {
    const derived = optionalRingDerived();
    const cycle = ringField(derived, 'x');
    expect(cycle.kind).toBe('optional');
    expect(cycle.value).toBe(cycle); // 纯自环（对象身份）
    expectOptionalRingProtocol(derived, 'optional 自环');
  });

  it('SA4 R1 透明环（optional 2-环）：终止、无裸异常、{} 引用同构、逐引用确定', () => {
    const derived = optionalTwoCycleDerived();
    const a = ringField(derived, 'x');
    const b = a.value;
    expect(a.kind).toBe('optional');
    expect(b).toBeDefined();
    expect(b).not.toBe(a);
    expect(b!.value).toBe(a); // a → b → a 2-环（对象身份）
    expectOptionalRingProtocol(derived, 'optional 2-环');
  });

  it('透明环（union 自引用）：任意预算终止且不抛裸异常；{} 与无预算读引用级同构', () => {
    const derived = unionRingDerived();
    const baseline = resolveSchemaAtPath(derived, []) as ObservedOk;
    expect(baseline.ok).toBe(true);
    expect(aliasesKeys(baseline)).toEqual([]);
    for (const depth of [0, 1, 2, 5, 100]) {
      let result: ObservedResult | undefined;
      expect(() => {
        result = budget(derived, [], { depth });
      }).not.toThrow();
      if (result === undefined) throw new Error(`透明环 d${depth} 未结算`);
      expect(result.ok).toBe(true);
    }
    const d0 = expectOk(budget(derived, [], { depth: 0 }), 'ring d0');
    expect(markerDigest(d0, 'ROOT')).toEqual(['ROOT => container:object']);
    const d1 = expectOk(budget(derived, [], { depth: 1 }), 'ring d1');
    expect(markerDigest(d1, 'ROOT')).toEqual(['ROOT.ring.<member 0> => container:object']);
    for (const options of [{}, { maxChildrenPerNode: 1 }, { depth: 50 }]) {
      const result = expectOk(budget(derived, [], options), `ring ${JSON.stringify(options)}`);
      // 重入透传 + 身份短路：与原环状结构共享同一批原节点（引用相等；环状输出不可 stringify）
      expect(result.valueSchema).toBe(baseline.valueSchema);
      expect(aliasesKeys(result)).toEqual([]);
    }
  });

  it('容器环（2-环）：有限 depth 有界壳 + 标记；未耗尽/无预算透传原结构', () => {
    const derived = containerRingDerived();
    const baseline = resolveSchemaAtPath(derived, []) as ObservedOk;
    expect(aliasesKeys(baseline)).toEqual([]);
    const d1 = expectOk(budget(derived, [], { depth: 1 }), 'ring d1');
    expect(markerDigest(d1, 'ROOT')).toEqual(['ROOT.head => container:object']);
    const d2 = expectOk(budget(derived, [], { depth: 2 }), 'ring d2');
    expect(markerDigest(d2, 'ROOT')).toEqual(['ROOT.head.next => container:object']);
    for (const options of [{}, { maxChildrenPerNode: 1 }, { depth: 3 }, { depth: 20 }]) {
      let result: ObservedResult | undefined;
      expect(() => {
        result = budget(derived, [], options);
      }).not.toThrow();
      if (result === undefined) throw new Error(`容器环 ${JSON.stringify(options)} 未结算`);
      expect(result.ok).toBe(true);
      const ok = result as ObservedOk;
      // 未耗尽（b=∞ 或 ≥3）→ 重入透传 + 身份短路：与原环状结构共享同一批原节点
      // （环状输出不可 JSON.stringify——引用相等断言，§6.3.5 测试口径）。
      expect(ok.valueSchema).toBe(baseline.valueSchema);
      expect(aliasesKeys(ok)).toEqual([]);
    }
    // 有限 depth 输出有界、可序列化、逐调用确定
    const finite = expectOk(budget(derived, [], { depth: 2 }), 'ring d2 again');
    const finite2 = expectOk(budget(derived, [], { depth: 2 }), 'ring d2 third');
    expect(JSON.stringify(finite2)).toBe(JSON.stringify(finite));
  });

  it('合法递归别名（ref:ROOT）：{} ≡ 无预算读（引用级同构 + JSON 可序列化）', () => {
    const derived = recursiveAliasDerived();
    const baseline = resolveSchemaAtPath(derived, []) as ObservedOk;
    expect(baseline.valueSchema).toBe(derived.values['ROOT']);
    expect(baseline.aliases['ROOT']).toBe(derived.values['ROOT']);
    const result = expectOk(budget(derived, [], {}), 'recursive {}');
    expect(result.valueSchema).toBe(baseline.valueSchema);
    expect(result.aliases['ROOT']).toBe(baseline.aliases['ROOT']);
    expect(JSON.stringify(result)).toBe(JSON.stringify(baseline));
    const d0 = expectOk(budget(derived, [], { depth: 0 }), 'recursive d0');
    expect(d0.valueSchema.kind).toBe('truncated');
    expect(aliasesKeys(d0)).toEqual([]);
  });

  it('S4 多引用跨预算：闭包按首发现预算渲染一次、逐调用确定（非最大预算渲染）', () => {
    const derived = multiRefDerived();
    const result = expectOk(budget(derived, [], { depth: 4 }), 'multiRef d4');
    expect(aliasesKeys(result)).toEqual(['Shared']);
    expect(markerDigest(result, 'ROOT')).toEqual(['Shared.c => container:object']);
    const again = expectOk(budget(derived, [], { depth: 4 }), 'multiRef d4 again');
    expect(JSON.stringify(again)).toBe(JSON.stringify(result));
    const baseline = resolveSchemaAtPath(derived, []) as ObservedOk;
    expect(markerDigest(baseline, 'ROOT')).toEqual([]);
  });
});

// —— §6.3.4 修正格：[u] depth=2 无标记 ≡ 无预算（SA6 矩阵算术漂移的修正锚）——

describe('#335 §6.3.4 矩阵修正锚', () => {
  it("['u'] depth=2 展开 x 数组、元素 scalar 原样、零标记 ≡ 无预算", () => {
    const derived = fixture272();
    const d2 = expectOk(budget(derived, ['u'], { depth: 2 }), "['u'] d2");
    expect(markerDigest(d2, 'ROOT.u')).toEqual([]);
    expect(JSON.stringify(d2)).toBe(JSON.stringify(resolveSchemaAtPath(derived, ['u'])));
    const d1 = expectOk(budget(derived, ['u'], { depth: 1 }), "['u'] d1");
    expect(markerDigest(d1, 'ROOT.u')).toEqual([
      'U.<member 1>.x => container:array',
    ]);
  });

  it("['u','x'] 合成 union 终点：d0 成员位标记（scalar 原样）、d≥1 ≡ 无预算", () => {
    const derived = fixture272();
    const baseline = JSON.stringify(resolveSchemaAtPath(derived, ['u', 'x']));
    const d0 = expectOk(budget(derived, ['u', 'x'], { depth: 0 }), "['u','x'] d0");
    expect(d0.valueSchema.kind).toBe('union');
    expect(markerDigest(d0, 'ROOT.u.x')).toEqual(['ROOT.u.x.<member 1> => container:array']);
    const d1 = expectOk(budget(derived, ['u', 'x'], { depth: 1 }), "['u','x'] d1");
    expect(JSON.stringify(d1)).toBe(baseline);
    expect(markerDigest(d1, 'ROOT.u.x')).toEqual([]);
  });
});
