/**
 * SA6 红灯/验收锚 — issue #237：ordinary Namespace mutation 用路径级校验替代完整 ROOT
 * 复制与全量校验（doc-runtime 层：applyValidatedMutation 内部管线）。
 *
 * 规范来源（任务材料，全部已并入本文件断言）：
 * - issue #237 正文验收标准（公共 interface / 严格 FIFO / 零写入 / 最小 edit / set、
 *   delete、批量 array-insert、批量 array-delete 走局部校验 / union/Record/optional/
 *   数组边界/嵌套引用与完整快照校验一致 / schema 要求时安全退化 ROOT / 提交后
 *   internal invariant 不再无条件重提重验完整 ROOT / 行为等价测试 / benchmark 保持
 *   dirty notification 与 wire update count）；
 * - Owner 2026-09-05T16:01Z 评论（phase-1 前置条件 = mutation 开始前 committed ROOT
 *   已符合 active schema（logical values + carrier topology）；删除热路径旧完整 ROOT
 *   validateLogicalSnapshot；不建 committed-generation/document-baseline 状态机；只
 *   提取/重建/校验 mutation 路径与最近必要语义边界；无关分支零访问/复制/校验；把
 *   「无关分支非法数据不再导致普通写失败」锚定为**已声明语义**而非疏漏）；
 * - Owner 2026-09-05T16:08Z 评论（mutation 路径导航检查局部 carrier topology；
 *   validation failure 在触碰 live Y.Doc 之前决定，禁止 live-write 后 undo）；
 * - Owner 2026-09-06T02:55Z 评论（大 ROOT 连续五笔叶子 mutation 的 instrumentation，
 *   不把 #238 replication latency 归因本 issue，不扩公共 API）；
 * - SA5 报告 wiki/raw/20260906-bug-237.md（红灯锚定清单 1–10）与 SA8 冲突门禁
 *   wiki/raw/task_237_conflict_report.md（E1–E4 文档修订义务随代码交付；文档义务与
 *   follow-up 见 wiki/raw/20260906-ac-issue-237.md，本文件不实现生产改动）。
 *
 * 红灯纪律（本仓惯例）：「必红」= 当前代码必须失败的红灯锚（缺陷契约）；
 * 「绿锁定」= 当前已满足、修复后不得回归的锁定锚。所有「必红」锚均用**确定性调用
 * 计数**（模块 seam 包装，不读源码、不 grep、不依赖墙钟计时）锚定热路径是否触碰
 * 完整 ROOT 提取/逻辑校验/提交后整树验证——大小无关、零 flake。等价性用例以
 * 「完整 proposed ROOT 全量校验」为 oracle（ADR-0007 明文前置）。
 *
 * 前置条件显式化：phase-1 契约要求「调用前文档合法（logical values + carrier
 * topology）」——除 R2-反转用例（其语义就是锚定 replication-unvalidated 形态不再被
 * 普通写扫描）外，每个用例都在 mutation 前断言基线合法性（extract + 全量逻辑校验）。
 *
 * 修复方向（SA3 owned，本文件只做行为锚）：applyValidatedMutation 内部沿 live
 * carrier + derived structure 导航 → 最近必要语义边界局部提取/重建/校验（复用
 * packages/vfsl/src/validate-patch.ts 家族批量接缝；vfsl 保持无 Yjs 依赖）→ 单
 * guarded transaction 最小 edit → 边界级提交后一致性验证；schema 语义要求更大
 * 上下文时允许安全退化到更高边界直至 ROOT；不建 committed-baseline 状态机。
 */
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { DerivedSchema } from '@nomicore/vfsl';
import { evaluate, parseVfsl, validateLogicalSnapshot } from '@nomicore/vfsl';
import { applyValidatedMutation, extractYjsSnapshot, materializeRoot } from '../src/index.js';

/** 完整 ROOT 热路径 seam 计数器（vi.hoisted——mock factory 提升期即可用）。 */
const counters = vi.hoisted(() => ({
  /** extractYjsSnapshot(derived, doc)：完整 ROOT 提取（walk 整树 + 拷贝）。 */
  fullExtract: 0,
  /** validateLogicalSnapshot(derived, snapshot)：完整 logical ROOT 值语义校验。 */
  fullLogicalValidate: 0,
  /** verifySnapshotIntact：提交后把完整 proposed ROOT 重物化进 scratch doc + 双侧整树提取比较。 */
  verifySnapshotIntact: 0,
}));

vi.mock('../src/extract.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/extract.js')>();
  return {
    ...mod,
    extractYjsSnapshot: ((...args: Parameters<typeof mod.extractYjsSnapshot>) => {
      counters.fullExtract += 1;
      return mod.extractYjsSnapshot(...args);
    }) as typeof mod.extractYjsSnapshot,
  };
});

vi.mock('../src/install-verify.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/install-verify.js')>();
  return {
    ...mod,
    verifySnapshotIntact: ((...args: Parameters<typeof mod.verifySnapshotIntact>) => {
      counters.verifySnapshotIntact += 1;
      return mod.verifySnapshotIntact(...args);
    }) as typeof mod.verifySnapshotIntact,
  };
});

vi.mock('@nomicore/vfsl', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@nomicore/vfsl')>();
  return {
    ...mod,
    validateLogicalSnapshot: ((...args: Parameters<typeof mod.validateLogicalSnapshot>) => {
      counters.fullLogicalValidate += 1;
      return mod.validateLogicalSnapshot(...args);
    }) as typeof mod.validateLogicalSnapshot,
  };
});

// ─────────────────────────────── fixture ───────────────────────────────

const TEXT_LIB_ITEM =
  'type Item = { name: string; qty: number };\n'
  + 'type ROOT = { target: { value: number; note?: string }; library: YArray<Item> };';

function derivedOf(text: string): DerivedSchema {
  const parsed = parseVfsl(text);
  if (!parsed.ok) throw new Error(`前置 parseVfsl 失败（fixture 缺陷）：${JSON.stringify(parsed.issues)}`);
  const evaluated = evaluate(parsed.module);
  if (!evaluated.ok) throw new Error(`前置 evaluate 失败（fixture 缺陷）：${JSON.stringify(evaluated.issues)}`);
  return evaluated.derived;
}

function librarySeed(n: number): Array<{ name: string; qty: number }> {
  return Array.from({ length: n }, (_, i) => ({ name: `item-${i}`, qty: i }));
}

function fixtureOf(text: string, seed: unknown): { derived: DerivedSchema; doc: Y.Doc } {
  const derived = derivedOf(text);
  const doc = new Y.Doc();
  const m = materializeRoot(derived, seed, doc);
  if (!m.ok) throw new Error(`前置 materializeRoot 失败（fixture 缺陷）：${JSON.stringify(m.issues).slice(0, 400)}`);
  return { derived, doc };
}

/** phase-1 前置条件断言：mutation 前 committed 文档合法（logical values + carrier topology）。 */
function expectValidBaseline(derived: DerivedSchema, doc: Y.Doc): void {
  const ex = extractYjsSnapshot(derived, doc);
  expect(ex.ok, `前置条件：carrier topology 合法（extract 失败: ${JSON.stringify(ex.ok ? '' : ex.issues).slice(0, 200)}）`).toBe(true);
  if (!ex.ok) throw new Error('unreachable');
  const v = validateLogicalSnapshot(derived, ex.snapshot);
  expect(v.ok, '前置条件：logical values 符合 active schema').toBe(true);
}

function stateBytes(doc: Y.Doc): number[] {
  return [...Y.encodeStateAsUpdate(doc)];
}

function eventsOf(doc: Y.Doc): { count: number; bytes: number[] } {
  const e = { count: 0, bytes: [] as number[] };
  doc.on('update', (u: Uint8Array) => {
    e.count += 1;
    e.bytes.push(u.byteLength);
  });
  return e;
}

function resetCounters(): void {
  counters.fullExtract = 0;
  counters.fullLogicalValidate = 0;
  counters.verifySnapshotIntact = 0;
}

function readTargetValue(doc: Y.Doc): unknown {
  return (doc.getMap('ROOT').get('target') as Y.Map<unknown>).get('value');
}

// ═══════════════════════ A-1【必红】热路径去全量（计数锚） ═══════════════════════

describe('A-1【必红】ordinary 叶子 mutation 热路径零完整 ROOT extract / validate / 提交后整树 verify', () => {
  it('set ["target","value"] 不得触发任何完整 ROOT extract / validateLogicalSnapshot / verifySnapshotIntact（当前: extract×3 + validate×2 + verify×1）', () => {
    const { derived, doc } = fixtureOf(TEXT_LIB_ITEM, { target: { value: 0 }, library: librarySeed(120) });
    expectValidBaseline(derived, doc); // phase-1 前置条件（含 carrier topology）
    const library = doc.getMap('ROOT').get('library');
    const ev = eventsOf(doc);

    resetCounters();
    const r = applyValidatedMutation(derived, doc, { op: 'set', path: ['target', 'value'], value: 7 });

    expect(r.ok).toBe(true);
    expect(readTargetValue(doc)).toBe(7);
    expect(counters.fullExtract, '【必红】当前每次普通写做 1×prepare 全提取 + 2×verify 全提取；契约 = 0（只沿路径触达）').toBe(0);
    expect(counters.fullLogicalValidate, '【必红】当前旧 ROOT + proposed ROOT 两次全量逻辑校验；契约 = 0（边界级校验）').toBe(0);
    expect(counters.verifySnapshotIntact, '【必红】当前提交后把完整 proposed ROOT 重物化进 scratch doc 双侧提取比较；契约 = 0（边界级提交后验证）').toBe(0);
    // 成功写保持：单次 Yjs transaction、最小 edit、无关 carrier identity 保留
    expect(doc.getMap('ROOT').get('library')).toBe(library);
    expect(ev.count).toBe(1);
    expect(ev.bytes[0]!).toBeLessThan(256);
  });

  it('delete 叶子 + 批量 array-insert / array-delete 同为零完整 ROOT 热路径调用（当前同样全部 >0）', () => {
    const { derived, doc } = fixtureOf(TEXT_LIB_ITEM, { target: { value: 1, note: 'n0' }, library: librarySeed(120) });
    expectValidBaseline(derived, doc);
    const library = doc.getMap('ROOT').get('library') as Y.Array<unknown>;
    const targetMap = doc.getMap('ROOT').get('target') as Y.Map<unknown>;
    const originalLength = library.length;

    resetCounters();
    const r1 = applyValidatedMutation(derived, doc, { op: 'array-insert', path: ['library'], index: 1, values: [{ name: 'inserted', qty: -1 }] });
    expect(r1.ok).toBe(true);
    expect(counters.fullExtract).toBe(0);
    expect(counters.fullLogicalValidate).toBe(0);
    expect(counters.verifySnapshotIntact).toBe(0);
    expect(library.length).toBe(originalLength + 1);

    resetCounters();
    const r2 = applyValidatedMutation(derived, doc, { op: 'array-delete', path: ['library'], index: 1, count: 1 });
    expect(r2.ok).toBe(true);
    expect(counters.fullExtract).toBe(0);
    expect(counters.fullLogicalValidate).toBe(0);
    expect(counters.verifySnapshotIntact).toBe(0);
    expect(library.length).toBe(originalLength);

    // 【C2 / SA2 裁决一】delete 腿修订：target.value 是必填字段——delete 必填属于
    // ADR-0007 L35 拒绝域且 A-6 oracle 同形决策为 ok:false，原断言（r3.ok===true 于
    // delete ['target','value']）在任何行为等价实现下不可满足。最小修订 = fixture 增
    // optional note?: string，delete 腿改删 note（optional 字段 = 合法删除目标；
    // 严禁放宽 delete 词表）。修订引用 Owner 2026-09-05T16:01Z + ADR-0007 修订节。
    resetCounters();
    const r3 = applyValidatedMutation(derived, doc, { op: 'delete', path: ['target', 'note'] });
    expect(r3.ok).toBe(true);
    expect(counters.fullExtract).toBe(0);
    expect(counters.fullLogicalValidate).toBe(0);
    expect(counters.verifySnapshotIntact).toBe(0);
    expect(targetMap.has('note'), 'optional 字段 note 必须已删除').toBe(false);
    expect(readTargetValue(doc), '必填 value 不受 delete note 影响').toBe(1);
  });
});

// ═══════════════════════ A-2【必红】无关分支非法数据语义反转（已声明语义） ═══════════════════════

describe('A-2【必红】无关 ROOT 分支不被普通写访问/复制/校验——非法数据不再阻断路径外 mutation（Owner 2026-09-05T16:01Z / ADR-0010 E3 已声明语义）', () => {
  it('mutation 路径合法、无关分支 library[0].qty 为非法 string（replication-unvalidated 形态）→ mutation 成功且无关分支原样保留（当前: 旧 ROOT 全量校验拒绝）', () => {
    const { derived, doc } = fixtureOf(TEXT_LIB_ITEM, { target: { value: 1 }, library: librarySeed(3) });
    // 经 live carrier 直接写坏无关叶子（绕过一切校验——replication-unvalidated / 损坏存量形态）
    const library = doc.getMap('ROOT').get('library') as Y.Array<Y.Map<unknown>>;
    const item0 = library.get(0)!;
    const libraryLengthBefore = library.length;
    doc.transact(() => {
      item0.set('qty', 'corrupt-not-a-number');
    });
    const ev = eventsOf(doc);

    const r = applyValidatedMutation(derived, doc, { op: 'set', path: ['target', 'value'], value: 42 });

    // 【必红】当前：ok:false（拒绝由无关分支的旧 ROOT 全量校验触发）；契约：ok:true——
    // 普通写只对自己触达的路径/边界负责，无关分支既不被发现也不被修复
    expect(r.ok).toBe(true);
    expect(readTargetValue(doc)).toBe(42);
    expect(item0.get('qty'), '无关分支非法值必须原样保留（不静默修复、不被扫描破坏）').toBe('corrupt-not-a-number');
    expect(library.length, '无关分支不得被改写').toBe(libraryLengthBefore);
    expect(ev.count, '成功写仍恰一次 Yjs transaction').toBe(1);
  });
});

// ═══════════════════════ A-3【绿锁定】失败面零写入契约 ═══════════════════════

describe('A-3【绿锁定】校验失败在触碰 live Y.Doc 前决定——零写入、零 update 事件、失败后文档不变（禁 write 后 undo）', () => {
  it('mutation 路径内非法新值 → ok:false + 状态字节不变 + 0 update 事件', () => {
    const { derived, doc } = fixtureOf(TEXT_LIB_ITEM, { target: { value: 1 }, library: librarySeed(3) });
    expectValidBaseline(derived, doc);
    const before = stateBytes(doc);
    const ev = eventsOf(doc);

    const r = applyValidatedMutation(derived, doc, { op: 'set', path: ['target', 'value'], value: 'not-a-number' });

    expect(r.ok).toBe(false);
    expect((r as { issues: unknown[] }).issues.length).toBeGreaterThan(0);
    expect(stateBytes(doc)).toEqual(before);
    expect(ev.count).toBe(0);
    expect(readTargetValue(doc)).toBe(1);
  });

  it('delete 不存在的键（拒绝 no-op）→ ok:false + 零写入', () => {
    const { derived, doc } = fixtureOf('type ROOT = { a: { b: number } };', { a: { b: 1 } });
    expectValidBaseline(derived, doc);
    const before = stateBytes(doc);
    expect(applyValidatedMutation(derived, doc, { op: 'delete', path: ['a', 'missing'] }).ok).toBe(false);
    expect(stateBytes(doc)).toEqual(before);
  });

  it('set 缺失中间容器（不自动创建）→ ok:false + 零写入', () => {
    const { derived, doc } = fixtureOf('type ROOT = { m?: { v: number }; n: number };', { n: 1 });
    expectValidBaseline(derived, doc);
    const before = stateBytes(doc);
    expect(applyValidatedMutation(derived, doc, { op: 'set', path: ['m', 'v'], value: 5 }).ok).toBe(false);
    expect(stateBytes(doc)).toEqual(before);
  });
});

// ═══════════════════════ A-4【绿锁定】导航路径 carrier topology 检查 ═══════════════════════

describe('A-4【绿锁定】mutation 导航路径上的局部 carrier topology 违规仍响亮零写入拒绝（不实例化不匹配 carrier；非 internal fatal）', () => {
  it('live 把 target 换装成 Y.Array（schema 声明 map）→ 路径 mutation ok:false + 零写入（而非 ok:true、fatal 或写后 undo）', () => {
    const { derived, doc } = fixtureOf('type ROOT = { target: { value: number }; tag: string };', { target: { value: 1 }, tag: 'x' });
    // 绕过校验直接替换 live carrier（replication-unvalidated 形态的拓扑违规）
    doc.getMap('ROOT').set('target', new Y.Array<unknown>());
    const before = stateBytes(doc);
    const ev = eventsOf(doc);

    const r = applyValidatedMutation(derived, doc, { op: 'set', path: ['target', 'value'], value: 2 });

    expect(r.ok).toBe(false);
    expect(stateBytes(doc)).toEqual(before);
    expect(ev.count).toBe(0);
  });

  it('数组 mutation 目标 live 载体不是 Y.Array（Y.Map 冒充）→ ok:false + 零写入', () => {
    const { derived, doc } = fixtureOf(TEXT_LIB_ITEM, { target: { value: 1 }, library: librarySeed(2) });
    const root = doc.getMap('ROOT');
    root.set('library', new Y.Map<unknown>()); // 拓扑违规（Schema: YArray）；原 Y.Array 已被覆盖移除
    const before = stateBytes(doc);
    const ev = eventsOf(doc);
    const r = applyValidatedMutation(derived, doc, { op: 'array-insert', path: ['library'], index: 0, values: [{ name: 'n', qty: 1 }] });
    expect(r.ok).toBe(false);
    expect(stateBytes(doc)).toEqual(before);
    expect(ev.count).toBe(0);
    expect(root.get('library')).toBeInstanceOf(Y.Map); // 违规 live 载体原样保留（零写入、不静默替换）
  });
});

// ═══════════════════════ A-5【绿锁定】批量数组整体校验 + 边界 ═══════════════════════

describe('A-5【绿锁定】批量 array-insert / array-delete 一次整体判定（不逐元素独立校验）：整批含非法元素即整批零写入拒绝；边界不 clamp', () => {
  const UNION_ARRAY_TEXT =
    'type E = { kind: "a"; x: number } | { kind: "b"; y: number };\n'
    + 'type ROOT = { items: YArray<E>; n: number };';

  it('array-insert 合法批量 → ok:true、单事务、数组与 carrier identity 保留、结果与完整 proposed 一致', () => {
    const { derived, doc } = fixtureOf(UNION_ARRAY_TEXT, { items: [{ kind: 'a', x: 1 }], n: 0 });
    expectValidBaseline(derived, doc);
    const arr = doc.getMap('ROOT').get('items') as Y.Array<unknown>;
    const ev = eventsOf(doc);
    const r = applyValidatedMutation(derived, doc, {
      op: 'array-insert', path: ['items'], index: 1,
      values: [{ kind: 'b', y: 2 }, { kind: 'a', x: 3 }],
    });
    expect(r.ok).toBe(true);
    expect(doc.getMap('ROOT').get('items')).toBe(arr); // carrier identity
    expect(arr.length).toBe(3);
    expect(ev.count).toBe(1);
    const after = extractYjsSnapshot(derived, doc);
    expect(after.ok).toBe(true);
    if (after.ok) {
      expect(after.snapshot).toEqual({ items: [{ kind: 'a', x: 1 }, { kind: 'b', y: 2 }, { kind: 'a', x: 3 }], n: 0 });
    }
  });

  it('array-insert 批量中任一元素非法（kind:"c" 非任何成员）→ 整批拒绝 + 零写入（整体判定，非逐元素部分接受）', () => {
    const { derived, doc } = fixtureOf(UNION_ARRAY_TEXT, { items: [{ kind: 'a', x: 1 }], n: 0 });
    expectValidBaseline(derived, doc);
    const before = stateBytes(doc);
    const ev = eventsOf(doc);
    const r = applyValidatedMutation(derived, doc, {
      op: 'array-insert', path: ['items'], index: 1,
      values: [{ kind: 'b', y: 2 }, { kind: 'c', x: 9 }],
    });
    expect(r.ok).toBe(false);
    expect(stateBytes(doc)).toEqual(before);
    expect(ev.count).toBe(0);
  });

  it('array-insert 批量元素类型错（x: string）→ 整批拒绝 + 零写入', () => {
    const { derived, doc } = fixtureOf(UNION_ARRAY_TEXT, { items: [], n: 0 });
    expectValidBaseline(derived, doc);
    const before = stateBytes(doc);
    const r = applyValidatedMutation(derived, doc, { op: 'array-insert', path: ['items'], index: 0, values: [{ kind: 'a', x: 'wrong' }] });
    expect(r.ok).toBe(false);
    expect(stateBytes(doc)).toEqual(before);
  });

  it('array-insert index 越界（> length）不 clamp → ok:false 零写入；index == length 允许（append）', () => {
    const { derived, doc } = fixtureOf(UNION_ARRAY_TEXT, { items: [{ kind: 'a', x: 1 }], n: 0 });
    expectValidBaseline(derived, doc);
    const before = stateBytes(doc);
    expect(applyValidatedMutation(derived, doc, { op: 'array-insert', path: ['items'], index: 5, values: [{ kind: 'a', x: 2 }] }).ok).toBe(false);
    expect(stateBytes(doc)).toEqual(before);
    expect(applyValidatedMutation(derived, doc, { op: 'array-insert', path: ['items'], index: 1, values: [{ kind: 'a', x: 2 }] }).ok).toBe(true);
  });

  it('array-delete 范围越界（count 超出尾部 / index 越界）不 clamp、不接受越界 no-op → ok:false 零写入', () => {
    const { derived, doc } = fixtureOf(UNION_ARRAY_TEXT, { items: [{ kind: 'a', x: 1 }, { kind: 'b', y: 2 }], n: 0 });
    expectValidBaseline(derived, doc);
    const before = stateBytes(doc);
    expect(applyValidatedMutation(derived, doc, { op: 'array-delete', path: ['items'], index: 1, count: 2 }).ok).toBe(false);
    expect(applyValidatedMutation(derived, doc, { op: 'array-delete', path: ['items'], index: 2, count: 1 }).ok).toBe(false);
    expect(stateBytes(doc)).toEqual(before);
    // 合法整段删除
    expect(applyValidatedMutation(derived, doc, { op: 'array-delete', path: ['items'], index: 0, count: 2 }).ok).toBe(true);
  });
});

// ═══════════════════════ A-6【绿锁定】行为等价：增量判定 ≡ 完整 proposed ROOT 全量校验 ═══════════════════════

describe('A-6【绿锁定】行为等价（ADR-0007 明文前置）：相同合法 base/mutation 上，增量判定 ≡「构造完整 proposed ROOT 后 validateLogicalSnapshot 全量校验」', () => {
  interface EquivCase {
    name: string;
    text: string;
    seed: unknown;
    mutation:
      | { op: 'set'; path: readonly (string | number)[]; value: unknown }
      | { op: 'delete'; path: readonly (string | number)[] }
      | { op: 'array-insert'; path: readonly (string | number)[]; index: number; values: readonly unknown[] }
      | { op: 'array-delete'; path: readonly (string | number)[]; index: number; count: number };
  }

  /** 完整 proposed ROOT oracle 的 JSON 侧 mutation 镜像（语义 = mutation.ts applyToJson 现行域规则）。 */
  function jsonMirror(root: unknown, m: EquivCase['mutation']): { kind: 'ok'; value: unknown } | { kind: 'issue' } {
    const navigate = (cur: unknown, path: readonly (string | number)[]): { kind: 'ok'; value: unknown } | { kind: 'issue' } => {
      for (const seg of path) {
        const obj = typeof cur === 'object' && cur !== null && !Array.isArray(cur)
          ? cur as Record<string, unknown> : null;
        if (obj !== null) {
          if (typeof seg !== 'string' || !Object.hasOwn(obj, seg)) return { kind: 'issue' };
          cur = obj[seg];
        } else if (Array.isArray(cur)) {
          if (typeof seg !== 'number' || !Number.isSafeInteger(seg) || seg < 0 || seg >= cur.length) return { kind: 'issue' };
          cur = cur[seg] as unknown;
        } else {
          return { kind: 'issue' };
        }
      }
      return { kind: 'ok', value: cur };
    };
    const finalParent = (): { kind: 'ok'; value: unknown } | { kind: 'issue' } => navigate(root, m.path.slice(0, -1));
    switch (m.op) {
      case 'set': {
        if (m.path.length === 0) return { kind: 'ok', value: m.value };
        const p = finalParent();
        if (p.kind !== 'ok') return p;
        const obj = typeof p.value === 'object' && p.value !== null && !Array.isArray(p.value)
          ? p.value as Record<string, unknown> : null;
        const seg = m.path[m.path.length - 1]!;
        if (obj === null || typeof seg !== 'string') return { kind: 'issue' };
        Object.defineProperty(obj, seg, { value: m.value, writable: true, enumerable: true, configurable: true });
        return { kind: 'ok', value: root };
      }
      case 'delete': {
        if (m.path.length === 0) return { kind: 'issue' };
        const p = finalParent();
        if (p.kind !== 'ok') return p;
        const obj = typeof p.value === 'object' && p.value !== null && !Array.isArray(p.value)
          ? p.value as Record<string, unknown> : null;
        const seg = m.path[m.path.length - 1]!;
        if (obj === null || typeof seg !== 'string' || !Object.hasOwn(obj, seg)) return { kind: 'issue' };
        delete obj[seg];
        return { kind: 'ok', value: root };
      }
      case 'array-insert': {
        const t = navigate(root, m.path);
        if (t.kind !== 'ok' || !Array.isArray(t.value) || m.index > t.value.length) return { kind: 'issue' };
        (t.value as unknown[]).splice(m.index, 0, ...m.values);
        return { kind: 'ok', value: root };
      }
      case 'array-delete': {
        const t = navigate(root, m.path);
        if (t.kind !== 'ok' || !Array.isArray(t.value)) return { kind: 'issue' };
        if (m.index >= t.value.length || m.index + m.count > t.value.length) return { kind: 'issue' };
        (t.value as unknown[]).splice(m.index, m.count);
        return { kind: 'ok', value: root };
      }
      default:
        return { kind: 'issue' };
    }
  }

  const CASES: EquivCase[] = [
    // set / delete —— 普通对象与嵌套对象
    { name: '嵌套叶子 set', text: 'type ROOT = { target: { value: number }; tag: string };', seed: { target: { value: 1 }, tag: 'x' }, mutation: { op: 'set', path: ['target', 'value'], value: 5 } },
    { name: 'set 非法类型（路径内拒绝）', text: 'type ROOT = { target: { value: number }; tag: string };', seed: { target: { value: 1 }, tag: 'x' }, mutation: { op: 'set', path: ['target', 'value'], value: 'bad' } },
    { name: 'delete 存在键', text: 'type ROOT = { target: { value: number }; tag: string };', seed: { target: { value: 1 }, tag: 'x' }, mutation: { op: 'delete', path: ['target', 'value'] } },
    { name: 'delete 必填键（proposed 缺失必填 → 拒绝）', text: 'type ROOT = { target: { value: number }; tag: string };', seed: { target: { value: 1 }, tag: 'x' }, mutation: { op: 'delete', path: ['target'] } },
    { name: '三跳嵌套 set', text: 'type ROOT = { a: { b: { c: number; d?: string } } };', seed: { a: { b: { c: 1 } } }, mutation: { op: 'set', path: ['a', 'b', 'c'], value: 9 } },
    { name: 'optional 字段填充（absent→value）', text: 'type ROOT = { a: { b: { c: number; d?: string } } };', seed: { a: { b: { c: 1 } } }, mutation: { op: 'set', path: ['a', 'b', 'd'], value: 'hi' } },
    { name: 'optional 字段删除（present→absent）', text: 'type ROOT = { a: { b: { c: number; d?: string } } };', seed: { a: { b: { c: 1, d: 'x' } } }, mutation: { op: 'delete', path: ['a', 'b', 'd'] } },
    { name: '缺失中间容器 set（不自动创建 → 拒绝）', text: 'type ROOT = { m?: { v: number }; n: number };', seed: { n: 1 }, mutation: { op: 'set', path: ['m', 'v'], value: 5 } },
    // 判别联合（kind 判别字段 + 成员互异字段）
    { name: 'union 成员内合法 set', text: 'type ROOT = { m: { kind: "a"; x: string } | { kind: "b"; y: string } };', seed: { m: { kind: 'a', x: 's' } }, mutation: { op: 'set', path: ['m', 'x'], value: 't' } },
    { name: 'union 交叉写非本成员字段（kind:"a" 时写 y → 拒绝）', text: 'type ROOT = { m: { kind: "a"; x: string } | { kind: "b"; y: string } };', seed: { m: { kind: 'a', x: 's' } }, mutation: { op: 'set', path: ['m', 'y'], value: 'q' } },
    { name: 'union 成员字段类型错', text: 'type ROOT = { m: { kind: "a"; x: string } | { kind: "b"; y: string } };', seed: { m: { kind: 'a', x: 's' } }, mutation: { op: 'set', path: ['m', 'x'], value: 5 } },
    { name: 'union 判别字段值非法', text: 'type ROOT = { m: { kind: "a"; x: string } | { kind: "b"; y: string } };', seed: { m: { kind: 'a', x: 's' } }, mutation: { op: 'set', path: ['m', 'kind'], value: 'zz' } },
    { name: 'union 整体替换为另一成员', text: 'type ROOT = { m: { kind: "a"; x: string } | { kind: "b"; y: string } };', seed: { m: { kind: 'a', x: 's' } }, mutation: { op: 'set', path: ['m'], value: { kind: 'b', y: 'r' } } },
    // Record（动态键 keyspace = 数据面）
    { name: 'Record 值内叶子 set', text: 'type ROOT = { assets: Record<string, { name: string; qty: number }>; n: number };', seed: { assets: { k1: { name: 'a', qty: 1 } }, n: 0 }, mutation: { op: 'set', path: ['assets', 'k1', 'qty'], value: 9 } },
    { name: 'Record 键缺失中间容器（不自动创建 → 拒绝）', text: 'type ROOT = { assets: Record<string, { name: string; qty: number }>; n: number };', seed: { assets: { k1: { name: 'a', qty: 1 } }, n: 0 }, mutation: { op: 'set', path: ['assets', 'k2', 'qty'], value: 9 } },
    { name: 'Record 动态键整体删除', text: 'type ROOT = { assets: Record<string, { name: string; qty: number }>; n: number };', seed: { assets: { k1: { name: 'a', qty: 1 } }, n: 0 }, mutation: { op: 'delete', path: ['assets', 'k1'] } },
    // 数组边界 + 嵌套引用（多级具名类型）
    { name: 'YArray 元素 map 内 set（数字段下标）', text: TEXT_LIB_ITEM, seed: { target: { value: 0 }, library: [{ name: 'a', qty: 1 }] }, mutation: { op: 'set', path: ['library', 0, 'qty'], value: 5 } },
    { name: 'YArray 下标越界 set', text: TEXT_LIB_ITEM, seed: { target: { value: 0 }, library: [{ name: 'a', qty: 1 }] }, mutation: { op: 'set', path: ['library', 9, 'qty'], value: 5 } },
    { name: 'YArray append（index == length）', text: TEXT_LIB_ITEM, seed: { target: { value: 0 }, library: [{ name: 'a', qty: 1 }] }, mutation: { op: 'array-insert', path: ['library'], index: 1, values: [{ name: 'b', qty: 2 }] } },
    { name: 'YArray 批量 insert 多元素', text: TEXT_LIB_ITEM, seed: { target: { value: 0 }, library: [{ name: 'a', qty: 1 }] }, mutation: { op: 'array-insert', path: ['library'], index: 1, values: [{ name: 'b', qty: 2 }, { name: 'c', qty: 3 }] } },
    { name: 'YArray insert 元素类型错（整批拒绝）', text: TEXT_LIB_ITEM, seed: { target: { value: 0 }, library: [] }, mutation: { op: 'array-insert', path: ['library'], index: 0, values: [{ name: 'b', qty: 'bad' }] } },
    { name: 'YArray insert index 越界', text: TEXT_LIB_ITEM, seed: { target: { value: 0 }, library: [{ name: 'a', qty: 1 }] }, mutation: { op: 'array-insert', path: ['library'], index: 3, values: [{ name: 'b', qty: 2 }] } },
    { name: 'YArray 批量 delete 合法段', text: TEXT_LIB_ITEM, seed: { target: { value: 0 }, library: [{ name: 'a', qty: 1 }, { name: 'b', qty: 2 }, { name: 'c', qty: 3 }] }, mutation: { op: 'array-delete', path: ['library'], index: 1, count: 2 } },
    { name: 'YArray delete count 越界（不 clamp）', text: TEXT_LIB_ITEM, seed: { target: { value: 0 }, library: [{ name: 'a', qty: 1 }, { name: 'b', qty: 2 }] }, mutation: { op: 'array-delete', path: ['library'], index: 1, count: 2 } },
    { name: 'YArray delete index 越界', text: TEXT_LIB_ITEM, seed: { target: { value: 0 }, library: [{ name: 'a', qty: 1 }, { name: 'b', qty: 2 }] }, mutation: { op: 'array-delete', path: ['library'], index: 2, count: 1 } },
    { name: '嵌套具名引用两层下钻 set（ref 链解析）', text: 'type Inner = { v: number; label?: string };\ntype Outer = { inner: Inner; note: string };\ntype ROOT = { box: Outer; n: number };', seed: { box: { inner: { v: 1 }, note: 'x' }, n: 0 }, mutation: { op: 'set', path: ['box', 'inner', 'v'], value: 9 } },
    { name: '嵌套具名引用 + optional 下钻 delete', text: 'type Inner = { v: number; label?: string };\ntype Outer = { inner: Inner; note: string };\ntype ROOT = { box: Outer; n: number };', seed: { box: { inner: { v: 1, label: 'l' }, note: 'x' }, n: 0 }, mutation: { op: 'delete', path: ['box', 'inner', 'label'] } },
    { name: '空路径 set（整体替换 = 唯一合法全量形态，行为等价不破）', text: 'type ROOT = { target: { value: number }; tag: string };', seed: { target: { value: 1 }, tag: 'x' }, mutation: { op: 'set', path: [], value: { target: { value: 2 }, tag: 'y' } } },
  ];

  for (const c of CASES) {
    it(c.name, () => {
      const { derived, doc } = fixtureOf(c.text, c.seed);
      // phase-1 前置条件：base 完整合法（carrier topology + logical values）——显式入测试
      expectValidBaseline(derived, doc);
      const baseEx = extractYjsSnapshot(derived, doc);
      if (!baseEx.ok) throw new Error('unreachable');

      // oracle：完整 proposed ROOT 全量校验
      const mirrored = jsonMirror(JSON.parse(JSON.stringify(baseEx.snapshot)) as unknown, c.mutation);
      const oracleOk = mirrored.kind === 'ok' && validateLogicalSnapshot(derived, mirrored.value).ok;

      const before = stateBytes(doc);
      const ev = eventsOf(doc);
      const r = applyValidatedMutation(derived, doc, { ...c.mutation } as never);

      // 决策等价：增量判定 ≡ 完整 proposed ROOT 全量校验
      expect(r.ok, '增量判定必须与完整 proposed ROOT 全量校验决策一致').toBe(oracleOk);
      if (r.ok) {
        // 结果等价：成功写入后的完整 doc ≡ oracle 完整 proposed ROOT（单事务、最小 edit 无行为差）
        expect(ev.count).toBe(1);
        const after = extractYjsSnapshot(derived, doc);
        expect(after.ok).toBe(true);
        if (after.ok && mirrored.kind === 'ok') {
          expect(after.snapshot).toEqual(mirrored.value);
        }
      } else {
        // 失败面等价：零写入、零 update 事件（失败判定先于任何 live 写——禁 undo）
        expect(stateBytes(doc)).toEqual(before);
        expect(ev.count).toBe(0);
      }
    });
  }
});

// ═══════════════════════ A-7【SA2 裁决二锚】set 整值替换修复语义（声明 carve-out） ═══════════════════════

describe('A-7【SA2 裁决二锚】set 整值替换修复语义（声明 carve-out；授权链：SA2 裁决二 / Owner 2026-09-05T16:01Z / SA8 C1）', () => {
  it('set 替换损坏载体目标位 = 修复成功（目标位旧载体不被读取——由合法写入整值修复而非拒绝；恰 1 update、三计数锚 = 0、无关分支零触碰）', () => {
    const { derived, doc } = fixtureOf(TEXT_LIB_ITEM, { target: { value: 0 }, library: librarySeed(3) });
    expectValidBaseline(derived, doc);
    const target = doc.getMap('ROOT').get('target') as Y.Map<unknown>;
    const library = doc.getMap('ROOT').get('library');
    // 经 live carrier 直接写坏目标位载体（绕过一切校验——replication-unvalidated / 损坏存量形态）
    doc.transact(() => {
      target.set('value', new Y.Map<unknown>());
    });
    const ev = eventsOf(doc);
    const libraryLength = (library as Y.Array<unknown>).length;

    resetCounters();
    const r = applyValidatedMutation(derived, doc, { op: 'set', path: ['target', 'value'], value: 7 });

    // 【该锚在 HEAD 9e3f0bf 为红（现行 extract 全量校验拒绝载体损坏）、修复后转绿——
    //   R6 set 目标位旧值（载体与内容）一律不读取、不诊断，合法 payload 写入即修复】
    expect(r.ok).toBe(true);
    expect(readTargetValue(doc)).toBe(7);
    expect(doc.getMap('ROOT').get('target')).toBe(target); // 父 map carrier identity 保留
    expect(counters.fullExtract, '修复写不得触发完整 ROOT extract').toBe(0);
    expect(counters.fullLogicalValidate, '修复写不得触发完整 logical 校验').toBe(0);
    expect(counters.verifySnapshotIntact, '修复写不得触发提交后整树 verify').toBe(0);
    expect(doc.getMap('ROOT').get('library')).toBe(library); // 无关 carrier identity 保留
    expect((library as Y.Array<unknown>).length).toBe(libraryLength); // 无关分支规模不变
    expect(ev.count, '成功写仍恰一次 Yjs transaction').toBe(1);
    expect(ev.bytes[0]!).toBeLessThan(256);
  });

  it('对称面（绿锁定）：array-insert 目标数组内既存损坏元素（R4 边界内）→ 整批 ok:false 零写入', () => {
    const { derived, doc } = fixtureOf(TEXT_LIB_ITEM, { target: { value: 0 }, library: librarySeed(3) });
    expectValidBaseline(derived, doc);
    const library = doc.getMap('ROOT').get('library') as Y.Array<Y.Map<unknown>>;
    // 经 live carrier 写坏数组边界内元素（绕过一切校验）
    doc.transact(() => {
      library.get(0)!.set('qty', 'corrupt-not-a-number');
    });
    const before = stateBytes(doc);
    const ev = eventsOf(doc);

    const r = applyValidatedMutation(derived, doc, {
      op: 'array-insert', path: ['library'], index: 1,
      values: [{ name: 'n', qty: 1 }],
    });

    // 提取型边界（R4 数组位）内既存损坏仍响亮拒绝——与 set 目标位修复语义互补成三分面
    expect(r.ok).toBe(false);
    expect(stateBytes(doc)).toEqual(before);
    expect(ev.count).toBe(0);
    expect(library.length).toBe(3);
  });
});
