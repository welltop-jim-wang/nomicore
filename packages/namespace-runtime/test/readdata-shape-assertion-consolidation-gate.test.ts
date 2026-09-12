/**
 * issue #333（T0 pre-factor）+ issue #336（T3 五键修订）验收门 —— readData 成功分支
 * 「恒五键」形状断言集中化。
 *
 * 任务类型 = 纯测试重构（零行为变化、零产品代码/公共类型变化）。因此本文件不是行为
 * 红灯契约，而是**收敛门 + 回归契约的执行面**：
 *
 * - **T0 前（历史）本门为红**：runtime/registry 两个测试树里把成功形状
 *   `{ ok:true, value, schema }` / `['ok','schema','value']` 字面写死的断言（family A/B）
 *   正是本门要消除的**结构性缺口**。红的原因即「未集中化」本身（失败消息给出逐条清单），
 *   不是环境/fixture/入口错误。
 * - **T0 后本门转绿**：所有成功形状断言经统一 helper / 集中化形状构造表达。
 * - **T3（issue #336）**：形状经 T0 单点修订为恒五键（`readdata-ok-shape.ts`），
 *   family B 判定随 `SUCCESS_SHAPE_KEYS` 常量自动随动；本文件正负样本同步五键化。
 *
 * 行为零变化由既有 readData 套件承担（`runtime-readdata-hostile-path-guard`、
 * `runtime-readdata-schema-projection-red/control`、registry readData 相关套件），
 * 并由 SA6 报告记录的突变探针 M1/M2 证明这些断言对形状变化是敏感的（T3 五键修订
 * 必然击穿旧断言 → 必须集中化）。
 *
 * 门项：
 *   1. 作用域覆盖非空（防仪器空转——扫描路径写错/空目录时不得伪绿）；
 *   2. family A 归零；
 *   3. family B 归零；
 * 仪器敏感性自控（正样本必中 / 负样本不得误伤）见文件下半部分——若正负样本断言失败，
 * 说明仪器本身缺陷，门结果不可信。
 */
import { describe, expect, it } from 'vitest';
import {
  scanReadDataShapeAssertions,
  scanSourceForSuccessShapeAssertions,
  scanSourceForSuccessShapeProducers,
  countByFile,
  formatShapeAssertionInventory,
  SHAPE_ASSERTION_SCOPE,
} from './helpers/readdata-shape-assertion-scan.js';

const scan = scanReadDataShapeAssertions();
const familyA = scan.assertionSites.filter((site) => site.kind === 'deep-equal-literal');
const familyB = scan.assertionSites.filter((site) => site.kind === 'exact-key-set-literal');

describe('issue #333 T0 + issue #336 T3 验收门：readData 成功分支恒五键形状断言已集中化', () => {
  it('作用域覆盖非空且位置正确（防仪器空转）：两个测试树均被扫描、代表性文件在场', () => {
    // 108 个 .ts（HEAD 实测）——阈值取保守下界，避免新增/删除测试文件误伤。
    expect(scan.filesScanned.length).toBeGreaterThanOrEqual(80);
    for (const anchor of [
      'packages/namespace-runtime/test/runtime-readdata-hostile-path-guard.test.ts',
      'packages/namespace-registry/test/registry-idle.test.ts',
      'packages/namespace-registry/test/registry-open.test.ts',
      'packages/namespace-registry/test/readdata-docs-adr0016-sync-control.test.ts',
    ]) {
      expect(scan.filesScanned, `作用域缺少代表文件 ${anchor}`).toContain(anchor);
    }
    // 作用域声明与实际扫描同源（防「声明了两个树、实际只扫一个」）。
    expect([...SHAPE_ASSERTION_SCOPE].sort()).toEqual([
      'packages/namespace-registry/test',
      'packages/namespace-runtime/test',
    ]);
  });

  it('family A：成功形状深等字面量断言归零（AC1）', () => {
    expect(
      familyA,
      `family A（readData 成功分支恒五键深等字面量）仍有 ${familyA.length} 处未集中化：\n${formatShapeAssertionInventory(
        familyA,
      )}\n按文件分布：${JSON.stringify(countByFile(familyA))}`,
    ).toEqual([]);
  });

  it('family B：恒五键键集字面量断言归零（与 family A 同属形状集中化半径）', () => {
    expect(
      familyB,
      `family B（readData 成功分支恒五键键集字面量）仍有 ${familyB.length} 处未集中化：\n${formatShapeAssertionInventory(
        familyB,
      )}\n按文件分布：${JSON.stringify(countByFile(familyB))}`,
    ).toEqual([]);
  });
});

// ── 仪器敏感性自控（正样本必中 / 负样本不得误伤；对齐 #274 docs-sync 控制文件先例）──

describe('仪器敏感性：正样本（必须命中）', () => {
  const POSITIVE_SAMPLES: readonly { name: string; source: string; kind: string }[] = [
    {
      name: 'family A：单行恒五键 toEqual',
      source: "expect(r).toEqual({ ok: true, value: 3, schema: null, truncated: false, truncations: [] });",
      kind: 'deep-equal-literal',
    },
    {
      name: 'family A：单行恰三键 toEqual（超集匹配——T3 修订后仍属未集中化形状）',
      source: "expect(r).toEqual({ ok: true, value: 3, schema: null });",
      kind: 'deep-equal-literal',
    },
    {
      name: 'family A：toStrictEqual + 键序无关',
      source: "expect(r).toStrictEqual({ schema: null, value: 3, ok: true });",
      kind: 'deep-equal-literal',
    },
    {
      name: 'family A：多行 + schema 对象字面量',
      source:
        "expect(r).toEqual({\n  ok: true,\n  value: { content: 'hi' },\n  schema: { valueSchema: { kind: 'scalar', type: 'number' }, aliases: {}, docs: {}, aliasDocs: {} },\n});",
      kind: 'deep-equal-literal',
    },
    {
      name: 'family A：ok: true as const',
      source: 'expect(r).toEqual({ ok: true as const, value: 3, schema: null });',
      kind: 'deep-equal-literal',
    },
    {
      name: 'family A：取反深等同样写死形状',
      source: 'expect(r).not.toEqual({ ok: true, value: 3, schema: null });',
      kind: 'deep-equal-literal',
    },
    {
      name: 'family B：Object.keys(...).sort() 恒五键',
      source:
        "expect(Object.keys(r).sort()).toEqual(['ok', 'schema', 'truncated', 'truncations', 'value']);",
      kind: 'exact-key-set-literal',
    },
    {
      name: 'family B：展开写法 + 键序无关',
      source:
        "expect([...Object.keys(r)].sort()).toEqual(['value', 'truncations', 'ok', 'truncated', 'schema']);",
      kind: 'exact-key-set-literal',
    },
  ];

  for (const sample of POSITIVE_SAMPLES) {
    it(`${sample.name} → 命中`, () => {
      const sites = scanSourceForSuccessShapeAssertions(sample.source, 'positive-sample.ts');
      expect(sites, `正样本未命中（仪器漏报）：${sample.name}`).toHaveLength(1);
      expect(sites[0]!.kind).toBe(sample.kind);
    });
  }

  it('形状制造点：readData 测试替身字面量被盘点（报告项）；五键替身同被盘点', () => {
    const producers = scanSourceForSuccessShapeProducers(
      "const stub = () => ({ ok: true, value: 'marker', schema: null });",
      'producer-sample.ts',
    );
    expect(producers).toHaveLength(1);
    expect([...producers[0]!.keys].sort()).toEqual(['ok', 'schema', 'value']);
    expect(producers[0]!.isAssertionArgument).toBe(false);
    const fiveKey = scanSourceForSuccessShapeProducers(
      "const stub = () => ({ ok: true, value: 'marker', schema: null, truncated: false, truncations: [] });",
      'producer-sample.ts',
    );
    expect(fiveKey).toHaveLength(1);
    expect([...fiveKey[0]!.keys].sort()).toEqual(['ok', 'schema', 'truncated', 'truncations', 'value']);
  });
});

describe('仪器敏感性：负样本（不得误伤）', () => {
  const NEGATIVE_SAMPLES: readonly { name: string; source: string }[] = [
    {
      name: 'doc-runtime 成功分支恰两键 {ok,value}（ADR-0016 分层，不在 T0 作用域）',
      source: 'expect(hit).toEqual({ ok: true, value: 3 });',
    },
    {
      name: 'toMatchObject 加法兼容断言（负控文件刻意保持新旧形状均可绿）',
      source: 'expect(r).toMatchObject({ ok: true, value: 3, schema: null });',
    },
    {
      name: '失败分支形状（ok 非 true）',
      source: "expect(r).toEqual({ ok: false, code: 'PATH_NOT_ALLOWED', path: ['x'] });",
    },
    {
      name: '已集中化：toEqual(<形状构造调用>)',
      source: 'expect(r).toEqual(readDataOk(3, null));',
    },
    {
      name: '已集中化：hoisted 期望对象（AC1「等价的集中化形状构造」形态）',
      source: 'const expected = { ok: true, value: 3, schema: null };\nexpect(r).toEqual(expected);',
    },
    {
      name: 'ok 初值非字面 true（动态判定，不能静态断言形状）',
      source: 'expect(r).toEqual({ ok: flag, value: 3, schema: null });',
    },
    {
      name: 'doc-runtime 恰两键键集断言',
      source: "expect(Object.keys(hit).sort()).toEqual(['ok', 'value']);",
    },
    {
      name: '恰三键键集断言（T3 五键修订后不再是成功形状——仪器不得命中）',
      source: "expect(Object.keys(r).sort()).toEqual(['ok', 'schema', 'value']);",
    },
    {
      name: 'schema 投影体四键键集（不是成功分支键集）',
      source: "expect(Object.keys(r.schema).sort()).toEqual(['aliasDocs', 'aliases', 'docs', 'valueSchema']);",
    },
  ];

  for (const sample of NEGATIVE_SAMPLES) {
    it(`${sample.name} → 不命中`, () => {
      const sites = scanSourceForSuccessShapeAssertions(sample.source, 'negative-sample.ts');
      expect(sites, `负样本误伤（仪器过报）：${sample.name}\n${formatShapeAssertionInventory(sites)}`).toEqual([]);
    });
  }

  it('失败分支/两键生产者不被盘点为成功形状制造点', () => {
    expect(
      scanSourceForSuccessShapeProducers("const f = () => ({ ok: false, code: 'PATH_NOT_ALLOWED', path: [] });", 'n.ts'),
    ).toEqual([]);
    expect(scanSourceForSuccessShapeProducers("const f = () => ({ ok: true, value: 1 });", 'n.ts')).toEqual([]);
  });
});
