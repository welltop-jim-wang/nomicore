/**
 * Issue #319 红灯行为契约 — number 值域收窄核心：validate 与 validate-patch 统一判定（ADR 0021）。
 *
 * 契约来源：
 * - 任务简报 wiki/raw/task_issue-319.md（Issue #319 AC1~AC5）：裸 `number` 叶子拒绝
 *   NaN / +Infinity / -Infinity / -0，写入路径与校验路径同口径，失配消息细分（-0 经
 *   `Object.is` 单独识别，不得显示为 "0"）。
 * - docs/adr/0021-vfsl-number-domain-narrowing.md 决策 1（判定公式
 *   `typeof v === 'number' && Number.isFinite(v) && !Object.is(v, -0)`）、决策 3
 *   （四值细分消息；双路径同口径；文案不进冻结面）。
 * - wiki/raw/task_issue-319_sa6_contract.md §12 T1：AC1-1~AC2-1 / AC5 / AC6 / AC7 断言规格
 *   与消息规则①–④；本文件另含 SA1 设计 §12 T1-AC1-5（memo 序独立性，v1 合法 schema 形）
 *   与 D-B 锁定的联合位可观察形态（`number | string` 声明序 → 汇总 + 四值 detail 恰 2 条）。
 *
 * 断言纪律（SA6 §12「避免伪红/伪绿」）：全部断言走公共面运行时可观察输出
 * （ValidateResult 联合 / issue message+path / 包入口导出面），无源码 grep、无字符串形态
 * 断言、无 skip/only/todo、无 env override、无 fallback。旧实现（只做 `typeof`）必然红：
 * 四值被放行 → `ok:true`、`issues.length === 0`，取消息前的前置断言即失败。
 */
import { describe, expect, it } from 'vitest';
import {
  applyMutationAtBoundary,
  evaluate,
  parseVfsl,
  planMutationBoundary,
  validateAppendToArray,
  validateInsertIntoArray,
  validateLogicalSnapshot,
  validatePatch,
} from '../src/index.js';
import type {
  BoundaryMutationPayload,
  DerivedSchema,
  MutationBoundaryPlan,
  ValidateIssue,
  ValidateResult,
} from '../src/index.js';

function derivedOf(text: string): DerivedSchema {
  const parsed = parseVfsl(text);
  if (!parsed.ok) throw new Error(`前置 parseVfsl 失败: ${JSON.stringify(parsed.issues)}`);
  const evaluated = evaluate(parsed.module);
  if (!evaluated.ok) throw new Error(`前置 evaluate 失败: ${JSON.stringify(evaluated.issues)}`);
  return evaluated.derived;
}

/** 期望收窄拒绝；旧实现放行时以明确错误信息失败（非断言顺序依赖）。 */
function issuesOf(result: ValidateResult): ValidateIssue[] {
  if (result.ok) throw new Error('期望 ok:false（number 值域收窄拒绝），实际 ok:true');
  return result.issues;
}

/** path 段数组的可读键（顺序敏感深比较的辅助）。 */
const pathKey = (path: Array<string | number>): string => JSON.stringify(path);

interface FourValue {
  label: string;
  value: number;
  /** 规则④：消息须以期望值字面量结尾（允许尾随空白与单个 `。`/`.`）。 */
  tail: RegExp;
  /** 规则④反例：不得被更大域字面量误匹配（+Infinity 不得匹配 `-Infinity` 尾）。 */
  notTail?: RegExp;
}

/** 收窄四值（ADR 0021 决策 1 的补集；-0 必须 Object.is 识别——String(-0) === "0"）。 */
const FOUR: FourValue[] = [
  { label: 'NaN', value: Number.NaN, tail: /NaN\s*[。.]?$/ },
  { label: '+Infinity', value: Number.POSITIVE_INFINITY, tail: /Infinity\s*[。.]?$/, notTail: /-\s*Infinity\s*[。.]?$/ },
  { label: '-Infinity', value: Number.NEGATIVE_INFINITY, tail: /-\s*Infinity\s*[。.]?$/ },
  { label: '-0', value: -0, tail: /-\s*0\s*[。.]?$/ },
];

/** 消息规则①–④（SA6 §12 normative；整句文案不冻结）。 */
function expectNarrowedMessage(message: string, spec: FourValue): void {
  expect(message).toContain('期望 number（有限数且非 -0）'); // ① ADR 0021 决策 3 域短语逐字
  expect(message.startsWith('类型不匹配：')).toBe(false); // ② 不得退化为 typeof 分支
  expect(message.startsWith('VFSL-E100')).toBe(false); // ③ 不得走崩溃收编
  expect(spec.tail.test(message), `尾值字面量应为 ${spec.label}，实际消息：${message}`).toBe(true); // ④
  if (spec.notTail !== undefined) expect(spec.notTail.test(message)).toBe(false);
}

/** 断言「该值在给定 path 上恰 1 条收窄 issue」。 */
function expectSingleNarrowed(result: ValidateResult, path: Array<string | number>, spec: FourValue): void {
  const issues = issuesOf(result);
  expect(issues).toHaveLength(1);
  const issue = issues[0]!;
  expect(issue.path).toEqual(path);
  expectNarrowedMessage(issue.message, spec);
}

/** 有限数正控（AC1-2）：0 / 0.0（JS 同一值）/ 有限小数 / 次正规 / 极值。 */
const FINITE: number[] = [0, 0.5, -1, 1e308, 5e-324, Number.MAX_SAFE_INTEGER, -2.5e-7];

// ═══════════════════════════════════════════════════════════════════════════
// AC1：validate 四值全拒 + 消息细分 + 有限数放行
// ═══════════════════════════════════════════════════════════════════════════

describe('AC1-1 裸 number 叶：四值全拒 + 恰 1 条 + path [n] + 消息规则①–④', () => {
  const derived = derivedOf('type ROOT = { n: number };');

  it.each(FOUR)('$label → ok:false 恰 1 条（旧实现 ok:true，必红）', (spec) => {
    const result = validateLogicalSnapshot(derived, { n: spec.value });
    expect(result.ok).toBe(false);
    expectSingleNarrowed(result, ['n'], spec);
  });

  it('四值消息两两互异（细分正确；同一消息 → 必红）', () => {
    const messages = FOUR.map((spec) => {
      const issues = issuesOf(validateLogicalSnapshot(derived, { n: spec.value }));
      expect(issues).toHaveLength(1);
      return issues[0]!.message;
    });
    expect(new Set(messages).size).toBe(4);
  });

  it('-0 消息尾值必须是 -0 而非 0（String(-0) === "0" 的实现必红）', () => {
    const issues = issuesOf(validateLogicalSnapshot(derived, { n: -0 }));
    expect(issues).toHaveLength(1);
    const message = issues[0]!.message;
    expect(message).toMatch(/-\s*0\s*[。.]?$/);
    expect(message).not.toMatch(/(^|[^-\d])0\s*[。.]?$/);
  });
});

describe('AC1-2 有限数正控：0 / 有限小数 / 极值放行（回归锁）', () => {
  const derived = derivedOf('type ROOT = { n: number };');

  it.each(FINITE)('%s → ok:true', (value) => {
    expect(validateLogicalSnapshot(derived, { n: value }).ok).toBe(true);
  });

  it('0.0 与 0 为同一 JS 值 → 放行；-0 与 0 经 Object.is 区分 → -0 拒绝', () => {
    expect(validateLogicalSnapshot(derived, { n: 0.0 }).ok).toBe(true);
    expect(validateLogicalSnapshot(derived, { n: -0 }).ok).toBe(false);
    expect(Object.is(0, -0)).toBe(false);
  });
});

describe('AC1-3 嵌套位：数组元素 / Record 值 / optional 内层 / 联合成员位', () => {
  const derived = derivedOf(
    'type ROOT = { list: number[]; rec: Record<string, number>; o?: { v: number }; u: number | string };',
  );

  it.each(FOUR)('$label 在四处嵌套位逐位精确拒绝', (spec) => {
    // 数组元素位 → ['list', 0]
    expectSingleNarrowed(validateLogicalSnapshot(derived, { list: [spec.value], rec: { k: 0 }, o: { v: 0 }, u: 'x' }), ['list', 0], spec);
    // Record 值位 → ['rec', 'k']
    expectSingleNarrowed(validateLogicalSnapshot(derived, { list: [0], rec: { k: spec.value }, o: { v: 0 }, u: 'x' }), ['rec', 'k'], spec);
    // optional 内层 → ['o', 'v']
    expectSingleNarrowed(validateLogicalSnapshot(derived, { list: [0], rec: { k: 0 }, o: { v: spec.value }, u: 'x' }), ['o', 'v'], spec);
  });

  it.each(FOUR)('$label 在联合成员位（number | string 声明序）→ 恰 2 条：汇总 + 四值 detail', (spec) => {
    const issues = issuesOf(validateLogicalSnapshot(derived, { list: [0], rec: { k: 0 }, o: { v: 0 }, u: spec.value }));
    // D-B 锁定形态：段 1 两成员均矛盾 → 无候选 → 汇总（段 3）+ 下钻 detail = 恰 2 条
    expect(issues).toHaveLength(2);
    expect(issues.map((issue) => pathKey(issue.path))).toEqual([pathKey(['u']), pathKey(['u'])]);
    const summary = issues.find((issue) => issue.message.includes('不匹配任何联合成员'));
    expect(summary, `缺联合汇总条：${JSON.stringify(issues)}`).toBeDefined();
    const detail = issues.find((issue) => issue !== summary);
    expect(detail).toBeDefined();
    expectNarrowedMessage(detail!.message, spec); // 平局 argmin 取声明序在前（number 成员）
  });
});

describe('AC1-4 全收集顺序：声明序 num→str→bool，各恰 1 条（旧实现 2 条，必红）', () => {
  const derived = derivedOf('type ROOT = { num: number; str: string; bool: boolean };');

  it('{num:NaN, str:1, bool:"x"} → 恰 3 条且按声明序', () => {
    const issues = issuesOf(validateLogicalSnapshot(derived, { num: Number.NaN, str: 1, bool: 'x' }));
    expect(issues).toHaveLength(3);
    expect(issues.map((issue) => pathKey(issue.path))).toEqual([pathKey(['num']), pathKey(['str']), pathKey(['bool'])]);
    expectNarrowedMessage(issues[0]!.message, FOUR[0]!);
    // typeof 失配消息逐字节维持既有兼容面（ADR 0021 决策 3）
    expect(issues[1]!.message).toBe('类型不匹配：期望 string，实际 number');
    expect(issues[2]!.message).toBe('类型不匹配：期望 boolean，实际 string');
  });
});

describe('AC1-5 memo 序独立性：-0 与 0 不得共键污染（设计 §7 D-C；无哨兵键实现必红）', () => {
  const seq = derivedOf('type U = number | string;\ntype ROOT = { xs: U[]; };');

  it('{xs:[0,-0]} → ok:false 且 [xs,1] 收窄拒绝（无修复：0 的 memo 命中 → -0 静默接受）', () => {
    const issues = issuesOf(validateLogicalSnapshot(seq, { xs: [0, -0] }));
    expect(issues.map((issue) => pathKey(issue.path))).not.toContain(pathKey(['xs', 0])); // 0 合法放行
    const atSecond = issues.filter((issue) => pathKey(issue.path) === pathKey(['xs', 1]));
    expect(atSecond.length, `[xs,1] 应有拒绝 issue：${JSON.stringify(issues)}`).toBeGreaterThanOrEqual(1);
    const detail = atSecond.find((issue) => issue.message.includes('期望 number（有限数且非 -0）'));
    expect(detail, `[xs,1] 缺收窄 detail：${JSON.stringify(atSecond)}`).toBeDefined();
    expectNarrowedMessage(detail!.message, FOUR[3]!);
  });

  it('{xs:[-0,0]} → 仅 [xs,0] 拒绝，[xs,1] 零 issue（无修复：-0 的 contra 命中 → 0 被伪报）', () => {
    const issues = issuesOf(validateLogicalSnapshot(seq, { xs: [-0, 0] }));
    const keys = issues.map((issue) => pathKey(issue.path));
    expect(keys).toContain(pathKey(['xs', 0]));
    expect(keys).not.toContain(pathKey(['xs', 1]));
  });

  it('{xs:[0,NaN]} → [xs,1] 拒绝（NaN 键无 SameValueZero 碰撞——对照）', () => {
    const issues = issuesOf(validateLogicalSnapshot(seq, { xs: [0, Number.NaN] }));
    const keys = issues.map((issue) => pathKey(issue.path));
    expect(keys).toContain(pathKey(['xs', 1]));
    expect(keys).not.toContain(pathKey(['xs', 0]));
  });

  it('{xs:[0,0.5,-0,1]} 混序 → 仅 [xs,2] 拒绝', () => {
    const issues = issuesOf(validateLogicalSnapshot(seq, { xs: [0, 0.5, -0, 1] }));
    expect(issues.map((issue) => pathKey(issue.path))).not.toContain(pathKey(['xs', 0]));
    expect(issues.map((issue) => pathKey(issue.path))).not.toContain(pathKey(['xs', 1]));
    expect(issues.map((issue) => pathKey(issue.path))).not.toContain(pathKey(['xs', 3]));
    const atSecond = issues.filter((issue) => pathKey(issue.path) === pathKey(['xs', 2]));
    expect(atSecond.length).toBeGreaterThanOrEqual(1);
  });

  it('Record 值位同款：{rec:{k1:-0,k2:0}} → 仅 [rec,k1] 拒绝', () => {
    const rec = derivedOf('type ROOT = { rec: Record<string, number | string>; };');
    const issues = issuesOf(validateLogicalSnapshot(rec, { rec: { k1: -0, k2: 0 } }));
    const keys = issues.map((issue) => pathKey(issue.path));
    expect(keys).toContain(pathKey(['rec', 'k1']));
    expect(keys).not.toContain(pathKey(['rec', 'k2']));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC2：validate-patch 写路径同口径（四入口 × 四值；消息与 AC1-1 逐字节相同）
// ═══════════════════════════════════════════════════════════════════════════

type PlanOk = { ok: true; plan: MutationBoundaryPlan };
type PlanFail = { ok: false; result: { ok: false; issues: ValidateIssue[] } };
type ApplyOk = { ok: true; proposedBoundary: unknown };
type ApplyFail = { ok: false; result: { ok: false; issues: ValidateIssue[] } };

function planOf(derived: DerivedSchema, path: Array<string | number>, op: 'set' | 'array-insert'): PlanOk | PlanFail {
  return planMutationBoundary(derived, path, op) as never;
}

function applyOf(
  derived: DerivedSchema,
  plan: MutationBoundaryPlan,
  base: unknown,
  payload: BoundaryMutationPayload,
): ApplyOk | ApplyFail {
  return applyMutationAtBoundary(derived, plan, base, payload) as never;
}

describe('AC2-1 写路径同口径：validatePatch / append / insert / applyMutationAtBoundary 四值全拒', () => {
  const derived = derivedOf('type ROOT = { n: number; list: number[] };');
  const base = { n: 1, list: [] as number[] };
  const leaf = derivedOf('type ROOT = { n: number };');

  it.each(FOUR)('$label：四入口均 ok:false 恰 1 条、path rebase 正确、消息与 AC1-1 逐字节相同', (spec) => {
    // AC1-1 参考字面（同一四值在裸叶 validate 上的消息）
    const reference = issuesOf(validateLogicalSnapshot(leaf, { n: spec.value }));
    expect(reference).toHaveLength(1);
    const expectedMessage = reference[0]!.message;

    // ① validatePatch（路径级 set）
    const patch = validatePatch(derived, base, ['n'], spec.value);
    const patchIssues = issuesOf(patch);
    expect(patchIssues).toHaveLength(1);
    expect(patchIssues[0]!.path).toEqual(['n']);
    expect(patchIssues[0]!.message).toBe(expectedMessage);

    // ② validateAppendToArray（数组元素位 path 含下标）
    const appended = validateAppendToArray(derived, base, ['list'], spec.value);
    const appendIssues = issuesOf(appended);
    expect(appendIssues).toHaveLength(1);
    expect(appendIssues[0]!.path).toEqual(['list', 0]);
    expect(appendIssues[0]!.message).toBe(expectedMessage);

    // ③ validateInsertIntoArray（index 0）
    const inserted = validateInsertIntoArray(derived, base, ['list'], 0, spec.value);
    const insertIssues = issuesOf(inserted);
    expect(insertIssues).toHaveLength(1);
    expect(insertIssues[0]!.path).toEqual(['list', 0]);
    expect(insertIssues[0]!.message).toBe(expectedMessage);

    // ④ applyMutationAtBoundary（set 目标边界）
    const setPlan = planOf(derived, ['n'], 'set');
    expect(setPlan.ok).toBe(true);
    if (!setPlan.ok) throw new Error(`前置 planMutationBoundary(set) 失败：${JSON.stringify(setPlan.result.issues)}`);
    const setApplied = applyOf(derived, setPlan.plan, base, { op: 'set', value: spec.value });
    expect(setApplied.ok).toBe(false);
    if (setApplied.ok) throw new Error('期望 set 边界拒绝，实际 ok:true');
    expect(setApplied.result.issues).toHaveLength(1);
    expect(setApplied.result.issues[0]!.path).toEqual(['n']);
    expect(setApplied.result.issues[0]!.message).toBe(expectedMessage);

    // ⑤ applyMutationAtBoundary（array-insert 目标边界；boundaryBase = 边界子树值本身——数组）
    const insertPlan = planOf(derived, ['list'], 'array-insert');
    expect(insertPlan.ok).toBe(true);
    if (!insertPlan.ok) throw new Error(`前置 planMutationBoundary(array-insert) 失败：${JSON.stringify(insertPlan.result.issues)}`);
    const insertApplied = applyOf(derived, insertPlan.plan, [], { op: 'array-insert', index: 0, values: [spec.value] });
    expect(insertApplied.ok).toBe(false);
    if (insertApplied.ok) throw new Error('期望 array-insert 边界拒绝，实际 ok:true');
    expect(insertApplied.result.issues).toHaveLength(1);
    expect(insertApplied.result.issues[0]!.path).toEqual(['list', 0]);
    expect(insertApplied.result.issues[0]!.message).toBe(expectedMessage);
  });

  it('写路径有限数正控：四入口对 0 / 0.5 / -1 放行（回归锁）', () => {
    for (const value of [0, 0.5, -1]) {
      expect(validatePatch(derived, base, ['n'], value).ok).toBe(true);
      expect(validateAppendToArray(derived, base, ['list'], value).ok).toBe(true);
      expect(validateInsertIntoArray(derived, base, ['list'], 0, value).ok).toBe(true);
      const setPlan = planOf(derived, ['n'], 'set');
      if (!setPlan.ok) throw new Error('前置 plan 失败');
      const applied = applyOf(derived, setPlan.plan, base, { op: 'set', value });
      expect(applied.ok).toBe(true);
      // set 边界 relPath=[] → 整值替换：proposedBoundary = 边界子树值本身（scalar）
      if (applied.ok) expect(applied.proposedBoundary).toBe(value);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC5：相近负控（收窄不得波及相邻分支）
// ═══════════════════════════════════════════════════════════════════════════

describe('AC5 相近负控：typeof 失配 / unknown 叶 / 非 number 标量 / 枚举分支', () => {
  const derived = derivedOf('type ROOT = { n: number };');

  const TYPE_MISMATCH: Array<{ label: string; value: unknown; actual: string }> = [
    { label: 'string', value: 'x', actual: 'string' },
    { label: 'null', value: null, actual: 'null' },
    { label: 'boolean', value: true, actual: 'boolean' },
    { label: 'array', value: [], actual: 'array' },
    { label: 'object', value: {}, actual: 'object' },
  ];

  it.each(TYPE_MISMATCH)('$label → 既有 typeof 失配消息逐字节保持（不含收窄短语）', ({ value, actual }) => {
    const issues = issuesOf(validateLogicalSnapshot(derived, { n: value }));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.path).toEqual(['n']);
    expect(issues[0]!.message).toBe(`类型不匹配：期望 number，实际 ${actual}`);
    expect(issues[0]!.message).not.toContain('期望 number（有限数且非 -0）');
  });

  it('unknown 叶放行 NaN / 嵌套 NaN（收窄面仅裸 number）', () => {
    const u = derivedOf('type ROOT = { u: unknown };');
    expect(validateLogicalSnapshot(u, { u: Number.NaN }).ok).toBe(true);
    expect(validateLogicalSnapshot(u, { u: { deep: Number.NaN } }).ok).toBe(true);
    expect(validateLogicalSnapshot(u, { u: [Number.POSITIVE_INFINITY] }).ok).toBe(true);
  });

  it('null / string / boolean 标量分支不变（正控 + 失配）', () => {
    const scalars = derivedOf('type ROOT = { z: null; s: string; b: boolean };');
    expect(validateLogicalSnapshot(scalars, { z: null, s: 'x', b: true }).ok).toBe(true);
    const issues = issuesOf(validateLogicalSnapshot(scalars, { z: 0, s: 1, b: 'x' }));
    expect(issues.map((issue) => issue.message)).toEqual([
      '类型不匹配：期望 null，实际 number',
      '类型不匹配：期望 string，实际 number',
      '类型不匹配：期望 boolean，实际 string',
    ]);
  });

  it('枚举数值字面量不收窄：0 | 1 收 -0（=== 命中）、拒 NaN / 1.5（设计 §7 D-G）', () => {
    const e = derivedOf('type ROOT = { e: 0 | 1 };');
    expect(validateLogicalSnapshot(e, { e: -0 }).ok).toBe(true);
    expect(validateLogicalSnapshot(e, { e: 0 }).ok).toBe(true);
    expect(validateLogicalSnapshot(e, { e: 1 }).ok).toBe(true);
    for (const value of [Number.NaN, 1.5, 2]) {
      const issues = issuesOf(validateLogicalSnapshot(e, { e: value }));
      expect(issues).toHaveLength(1);
      expect(issues[0]!.message).toContain('值不在枚举内');
      expect(issues[0]!.message).not.toContain('期望 number（有限数且非 -0）');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC6 / AC7：零改动锁定（公共面）+ 排除面边界负控
// ═══════════════════════════════════════════════════════════════════════════

describe('AC6 零改动锁定：无新增公共 API / 无新增错误码', () => {
  it('收窄辅助全模块局部：不经包入口泄漏（不新增导出）', async () => {
    const pkg = await import('../src/index.js');
    const exported = Object.keys(pkg);
    for (const internal of [
      'isJsonFaithfulNumber',
      'renderNumberValue',
      'scalarAccepts',
      'scalarRejectMessage',
      'memoKey',
      'NEG_ZERO_MEMO_KEY',
    ]) {
      expect(exported, `内部符号 ${internal} 不得进入公共面`).not.toContain(internal);
    }
    expect(exported).toContain('validateLogicalSnapshot');
    expect(exported).toContain('validatePatch');
  });

  it('四值拒绝走既有 validate 消息通道（非新错误码 / 非 E100 banner）——四个值逐值复核', () => {
    const derived = derivedOf('type ROOT = { n: number };');
    for (const spec of FOUR) {
      const issues = issuesOf(validateLogicalSnapshot(derived, { n: spec.value }));
      expect(issues[0]!.message).not.toMatch(/^VFSL-E\d{3}: /);
    }
  });
});

describe('AC7 排除面边界：文本侧 -0 仍 E100、int/range 三形态仍 E301（零扩散）', () => {
  function singleParseIssue(text: string): { message: string; line: number; column: number } {
    const parsed = parseVfsl(text);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error(`期望 parseVfsl 失败，实际 ok:true：${text}`);
    expect(parsed.issues).toHaveLength(1);
    return parsed.issues[0]!;
  }

  it.each(['type ROOT = { e: -0 };', 'type ROOT = { e: -0 | 1 };', 'type ROOT = { e: -0.0 };'])(
    '-0 字面量仍 E100 且锚该字面量、消息引导写 0（ADR 0021 决策 2；字面量拓宽后不再走「未知记号: -」）：%s',
    (text) => {
      const issue = singleParseIssue(text);
      expect(issue.message).toMatch(/^VFSL-E100: /);
      expect(issue.message).toContain('数字字面量 -0 不在可写值域');
      expect(issue.message).toContain('请改写为 0');
    },
  );

  it.each(['int', 'Int', 'range', 'Range'])('%s 仍 E301「未知名引用」（int/range 三形态不在本任务）', (name) => {
    const issue = singleParseIssue(`type ROOT = { n: ${name} };`);
    expect(issue.message).toMatch(/^VFSL-E301: /);
    expect(issue.message).toContain('未知名引用');
  });

  it('number 文本侧正常 parse（收窄是运行时判定，不改文本面）', () => {
    const parsed = parseVfsl('type ROOT = { n: number };');
    expect(parsed.ok).toBe(true);
  });
});
