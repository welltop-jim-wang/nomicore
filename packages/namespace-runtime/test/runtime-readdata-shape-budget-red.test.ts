/**
 * issue #336（ADR-0024 T3）主缝预算契约 —— **红灯**（SA6 契约产物的替代面：本任务无
 * `task_issue-336_sa6_contract.md`，验收权威 = Issue AC + ADR-0024 验收节 L120–130 +
 * SA1 设计 §12-T1 用例规格）。
 *
 * 红灯机理（当前 HEAD `cdfdff6`）：runtime `readData` 仍是单参、成功分支恰三键
 * `{ ok, value, schema }`、第二实参被忽略——本文件全部五键/预算/失败码断言在
 * `truncated`/`truncations`/`READ_OPTIONS_INVALID` 处红；SA3 在 runtime 组合层落位
 * （双通道同预算 + 五键信封 + 接缝净化）后转绿。
 *
 * 用例组（设计 §12-T1）：
 * A 五键恒形 / B depth 截断与清单 / C omitted 计数语义 / D 两通道对齐（主缝断言 +
 * F-x 敌意夹具延拓）/ E width 对投影无操作 / F READ_OPTIONS_INVALID 矩阵 + 差分 +
 * 敌意净化面（F-x1～F-x6）/ G 零物化哨兵 / H schema:null 与 always-on。
 *
 * 断言纪律（设计 §7.6-F-1 N3 钉死）：预算读结果只用 `expectReadDataOkKeys`（五键键集）
 * + 定点断言（`r.value` / `r.truncated` / `r.truncations` / `r.schema` 逐字段）——
 * **不**对含标记投影做 `expectReadDataOk` 整形状断言（helper `schema` 保持纯面）。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { readLogicalValueAtPath } from '@nomicore/doc-runtime';
import type { ReadLogicalValueAtPathOptions } from '@nomicore/doc-runtime';
import type { NamespaceRuntime } from '../src/index.js';
import { expectReadDataOkKeys } from './helpers/readdata-ok-shape.js';
import {
  createBudgetRuntimeFromHandle,
  descriptorGetSplitProxy,
  makeBudgetHandle,
  makeBudgetRuntime,
  makeBudgetRuntimeWithDoc,
  nonEnumerableDepthOptions,
  statefulDescriptorProxy,
  throwOnceDescriptorProxy,
  throwingGetProxy,
  waitForSchemaReady,
} from './runtime-readdata-shape-budget-fixture.js';

// ───────────────────────── 形状校准（单点 cast，不改值、不吞错） ─────────────────────────

interface TruncationEntry {
  readonly path: readonly (string | number)[];
  readonly kind: 'depth' | 'width';
  readonly omitted: number;
}

interface BudgetOkShape {
  readonly ok: true;
  readonly value: unknown;
  readonly schema: unknown;
  readonly truncated: boolean;
  readonly truncations: readonly TruncationEntry[];
}

interface FailureShape {
  readonly ok: false;
  readonly code: string;
  readonly path: readonly (string | number)[];
  readonly message?: string;
}

/** 成功前提断言（ok:false → loud throw，绝不假绿）。 */
function ok(r: unknown, label: string): BudgetOkShape {
  if ((r as { ok?: unknown }).ok !== true) {
    throw new Error(`${label}：契约前提失败（期望 ok:true，实际 ${JSON.stringify(r)}）`);
  }
  return r as BudgetOkShape;
}

/** 失败前提断言。 */
function failure(r: unknown, label: string): FailureShape {
  if ((r as { ok?: unknown }).ok !== false) {
    throw new Error(`${label}：契约前提失败（期望 ok:false，实际 ${JSON.stringify(r)}）`);
  }
  return r as FailureShape;
}

/** 敌意 options 通道：公共类型面不接受非封闭形状——测试经单点 cast 进入运行时校验面。 */
const asOptions = (value: unknown): ReadLogicalValueAtPathOptions =>
  value as ReadLogicalValueAtPathOptions;

const FAILURE_KEYS = ['code', 'message', 'ok', 'path'] as const;

function expectFailureKeys(r: object, label: string): void {
  expect(Object.keys(r).sort(), `${label}：失败分支键集不得含截断键`).toStrictEqual([...FAILURE_KEYS]);
}

// ───────────────────────── 两通道对齐 recipe（T2 §6.10：归一后位置集比较） ─────────────────────────

function normalizeSegment(seg: string | number): string {
  return typeof seg === 'number' ? '<item>' : seg;
}

function positionKey(path: readonly (string | number)[]): string {
  return path.map(normalizeSegment).join('\u0000');
}

/** 走投影标记位（object 字段名 / array `<item>` / union 成员剥离 / optional 透明 / ref 终态）。 */
function collectMarkers(
  node: unknown,
  path: Array<string | number>,
  out: Array<Array<string | number>>,
): void {
  if (node === null || typeof node !== 'object') return;
  const rec = node as Record<string, unknown>;
  switch (rec.kind) {
    case 'truncated':
      out.push([...path]);
      return;
    case 'object': {
      const fields = (rec.fields ?? []) as Array<{ name: string; value: unknown }>;
      for (const field of fields) collectMarkers(field.value, [...path, field.name], out);
      return;
    }
    case 'array':
      collectMarkers(rec.element, [...path, '<item>'], out);
      return;
    case 'union': {
      const members = (rec.members ?? []) as unknown[];
      for (const member of members) collectMarkers(member, path, out);
      return;
    }
    case 'optional':
      collectMarkers(rec.value, path, out);
      return;
    default:
      return; // ref / enum / pattern / scalar / xml：终态，无标记位
  }
}

/**
 * 终点子树标记位置集（以读取路径为前缀归一为 ROOT 基——与值通道 truncations 条目同基）。
 * 闭包体（`schema.aliases`）标记按设计 §12-T1-D 走弱断言（单独返回），不并入精确集。
 */
function projectionMarkers(
  schema: unknown,
  readPath: readonly (string | number)[],
): { readonly terminal: Set<string>; readonly aliasMarkers: number } {
  const rec = (schema ?? null) as Record<string, unknown> | null;
  if (rec === null || typeof rec !== 'object') return { terminal: new Set(), aliasMarkers: 0 };
  const raw: Array<Array<string | number>> = [];
  collectMarkers(rec.valueSchema, [], raw);
  const prefix = readPath.map(normalizeSegment);
  const terminal = new Set(raw.map((p) => positionKey([...prefix, ...p.map(normalizeSegment)])));
  let aliasMarkers = 0;
  const aliases = (rec.aliases ?? {}) as Record<string, unknown>;
  for (const name of Object.keys(aliases)) {
    const found: Array<Array<string | number>> = [];
    collectMarkers(aliases[name], [], found);
    aliasMarkers += found.length;
  }
  return { terminal, aliasMarkers };
}

/** 值通道 depth 条目位置集（数字段归一 `<item>`）。 */
function depthEntries(r: BudgetOkShape): Set<string> {
  return new Set(
    r.truncations.filter((e) => e.kind === 'depth').map((e) => positionKey(e.path)),
  );
}

/** 对齐断言：终点子树标记集 ≡ 值通道 depth 条目集（集合相等、顺序无关）。 */
function expectChannelsAligned(r: BudgetOkShape, readPath: readonly (string | number)[], label: string): void {
  const markers = projectionMarkers(r.schema, readPath);
  expect([...markers.terminal].sort(), `${label}：两通道截断位置集合必须一一对应`).toStrictEqual(
    [...depthEntries(r)].sort(),
  );
  // 闭包体标记弱断言（存在性 ⊆ 引用位裁剪并集——本 fixture 无多引用跨预算构造）。
  expect(markers.aliasMarkers, `${label}：闭包体标记数不得超过终点子树标记位`).toBeLessThanOrEqual(
    markers.terminal.size,
  );
}

// ═════════════════════════════ 组 A：五键恒形 ═════════════════════════════

describe('组 A：成功分支恒五键（预算读 + 无预算读；ADR-0024 决策 4）', () => {
  it('A1 无 options 读：恒五键、truncated=false、truncations 为空数组且恒在场（恰三键 → 五键破坏性修订）', async () => {
    const runtime = await makeBudgetRuntime();
    const r = ok(runtime.readData([]), 'A1');
    expectReadDataOkKeys(r);
    expect(r.truncated).toBe(false);
    expect(Array.isArray(r.truncations)).toBe(true);
    expect(r.truncations).toStrictEqual([]);
    expect(r.value).toStrictEqual({ title: 'hello', count: 3, meta: { content: 'hi', extra: 7 }, tags: ['a', 'b', 'c', 'd', 'e'] });
    await runtime.close();
  });

  it('A2 触发截断的预算读：恒五键、truncated === (truncations.length > 0)（B14）', async () => {
    const runtime = await makeBudgetRuntime();
    const r = ok(runtime.readData(['meta'], { depth: 0 }), 'A2');
    expectReadDataOkKeys(r);
    expect(r.truncations.length).toBeGreaterThan(0);
    expect(r.truncated).toBe(r.truncations.length > 0);
    await runtime.close();
  });

  it('A3 未触发截断的预算读（充足 depth）：恒五键、truncated=false、truncations=[]', async () => {
    const runtime = await makeBudgetRuntime();
    const r = ok(runtime.readData(['meta'], { depth: 9 }), 'A3');
    expectReadDataOkKeys(r);
    expect(r.truncated).toBe(false);
    expect(r.truncations).toStrictEqual([]);
    await runtime.close();
  });
});

// ═════════════════════════════ 组 B：depth 截断与清单 ═════════════════════════════

describe('组 B：depth 截断省略 + 条目三字段（path 同基 / 尾段即被裁键名 / omitted）', () => {
  it('B1 readData([], {depth:1})：被裁容器折叠为同形空容器、其子键全省略；depth 条目 path 尾段即被裁键名', async () => {
    const runtime = await makeBudgetRuntime();
    const r = ok(runtime.readData([], { depth: 1 }), 'B1');
    expect(r.value).toStrictEqual({ title: 'hello', count: 3, meta: {}, tags: [] });
    const entries = [...r.truncations].sort((a, b) => positionKey(a.path).localeCompare(positionKey(b.path)));
    expect(entries).toStrictEqual([
      { path: ['meta'], kind: 'depth', omitted: 2 },
      { path: ['tags'], kind: 'depth', omitted: 5 },
    ]);
    // 键名的唯一在场位置 = 清单条目尾段（值内已省略）
    expect(entries.map((e) => e.path[e.path.length - 1])).toStrictEqual(['meta', 'tags']);
    await runtime.close();
  });

  it('B2 depth:0 目标容器骨架读：同形空容器 + 单条 depth 条目，value 键恒在场（ADR-0024 L26）', async () => {
    const runtime = await makeBudgetRuntime();
    const r = ok(runtime.readData(['meta'], { depth: 0 }), 'B2');
    expect(Object.prototype.hasOwnProperty.call(r, 'value')).toBe(true);
    expect(r.value).toStrictEqual({});
    expect(r.truncations).toStrictEqual([{ path: ['meta'], kind: 'depth', omitted: 2 }]);
    await runtime.close();
  });

  it('B3 数组目标 depth:0：同形空数组 + 单条 depth 条目（omitted = 元素数）', async () => {
    const runtime = await makeBudgetRuntime();
    const r = ok(runtime.readData(['tags'], { depth: 0 }), 'B3');
    expect(r.value).toStrictEqual([]);
    expect(r.truncations).toStrictEqual([{ path: ['tags'], kind: 'depth', omitted: 5 }]);
    await runtime.close();
  });
});

// ═════════════════════════════ 组 C：omitted 计数语义 ═════════════════════════════

describe('组 C：omitted = 被截容器直接子项数（非后代总数）+ width 父路径单条', () => {
  it('C1 depth 条目 omitted = 直接子项数：blob 直接子项 2、每子项 3 后代（后代总数 6）→ omitted === 2', async () => {
    const runtime = await makeBudgetRuntime({ raw: true });
    const r = ok(runtime.readData(['blob'], { depth: 0 }), 'C1');
    expect(r.truncations).toHaveLength(1);
    const entry = r.truncations[0]!;
    expect(entry.kind).toBe('depth');
    expect(entry.omitted).toBe(2); // 直接子项数（p、q）
    expect(entry.omitted).not.toBe(6); // 显式排除「后代总数」口径（6 = 3 + 3）
    expect(r.value).toStrictEqual({});
    await runtime.close();
  });

  it('C2 width 条目：rawTotal 5 保留 3 → 父路径单条 {kind:width, omitted:2}，被裁子键零罗列', async () => {
    const runtime = await makeBudgetRuntime();
    const r = ok(runtime.readData(['tags'], { maxChildrenPerNode: 3 }), 'C2');
    expect(r.value).toStrictEqual(['a', 'b', 'c']);
    expect(r.truncations).toStrictEqual([{ path: ['tags'], kind: 'width', omitted: 2 }]);
    await runtime.close();
  });
});

// ═════════════════════════════ 组 D：两通道对齐（主缝断言） ═════════════════════════════

describe('组 D：同一预算下值截断位置与投影截断标记一一对应（ADR-0024 L81）', () => {
  it('D1 readData([], {depth:1})：终点子树标记集 ≡ 值通道 depth 条目集（{meta, tags}）', async () => {
    const runtime = await makeBudgetRuntime();
    const r = ok(runtime.readData([], { depth: 1 }), 'D1');
    expectChannelsAligned(r, [], 'D1');
    const markers = projectionMarkers(r.schema, []);
    expect([...markers.terminal].sort()).toStrictEqual([positionKey(['meta']), positionKey(['tags'])].sort());
    await runtime.close();
  });

  it('D2 readData(["meta"], {depth:0})：终点位标记与 depth 条目同基（读取路径为前缀）', async () => {
    const runtime = await makeBudgetRuntime();
    const r = ok(runtime.readData(['meta'], { depth: 0 }), 'D2');
    expectChannelsAligned(r, ['meta'], 'D2');
    const markers = projectionMarkers(r.schema, ['meta']);
    expect([...markers.terminal]).toStrictEqual([positionKey(['meta'])]);
    await runtime.close();
  });

  it('D3 F-x1 非 enumerable own depth：两通道同盲 → 五键 ok、零截断、投影与无预算读逐字节相等', async () => {
    const runtime = await makeBudgetRuntime();
    const plain = ok(runtime.readData([]), 'D3-plain');
    const r = ok(runtime.readData([], asOptions(nonEnumerableDepthOptions(7))), 'D3');
    expectReadDataOkKeys(r);
    expect(r.truncated).toBe(false);
    expect(r.truncations).toStrictEqual([]);
    expect(JSON.stringify(r.schema)).toBe(JSON.stringify(plain.schema));
    await runtime.close();
  });

  it('D4 F-x2 继承键污染（Object.prototype.depth）：own-enumerable 键空间对继承键双盲 → 同 D3（try/finally 还原）', async () => {
    const runtime = await makeBudgetRuntime();
    const plain = ok(runtime.readData([]), 'D4-plain');
    let polluted: BudgetOkShape | undefined;
    try {
      Object.defineProperty(Object.prototype, 'depth', {
        value: 7,
        enumerable: true,
        configurable: true,
        writable: true,
      });
      polluted = ok(runtime.readData([], asOptions({})), 'D4');
    } finally {
      delete (Object.prototype as Record<string, unknown>)['depth'];
    }
    const r = polluted!;
    expectReadDataOkKeys(r);
    expect(r.truncated).toBe(false);
    expect(r.truncations).toStrictEqual([]);
    expect(JSON.stringify(r.schema)).toBe(JSON.stringify(plain.schema));
    await runtime.close();
  });

  it('D5 F-x3 descriptor/get 分叉 Proxy（desc depth=1 / get 1.5）：两通道按 descriptor 视图（1）对齐，get trap 零调用，无 schema:null 静默组合', async () => {
    const runtime = await makeBudgetRuntime();
    const probe = descriptorGetSplitProxy(1, 1.5);
    const r = ok(runtime.readData([], asOptions(probe.options)), 'D5');
    expectReadDataOkKeys(r);
    expect(probe.getCalls()).toBe(0); // 零 [[Get]] 执行锚
    expect(r.truncated).toBe(true);
    expect(r.schema).not.toBeNull(); // ER-1 静默形态（ok ∧ schema:null ∧ truncated）不得出现
    expectChannelsAligned(r, [], 'D5');
    expect([...projectionMarkers(r.schema, []).terminal].sort()).toStrictEqual(
      [positionKey(['meta']), positionKey(['tags'])].sort(),
    );
    await runtime.close();
  });

  it('D6 F-x4 抛错 get trap Proxy（descriptor 诚实 depth=1）：五键 ok、get trap 零调用、绝不 throw、两通道对齐', async () => {
    const runtime = await makeBudgetRuntime();
    const probe = throwingGetProxy(1);
    const r = ok(runtime.readData([], asOptions(probe.options)), 'D6');
    expectReadDataOkKeys(r);
    expect(probe.getCalls()).toBe(0);
    expectChannelsAligned(r, [], 'D6');
    await runtime.close();
  });
});

// ═════════════════════════════ 组 E：width 对投影无操作 ═════════════════════════════

describe('组 E：仅 width 触发的预算读，schema 与同路径无预算读逐字节相等（ADR-0024 L125）', () => {
  it('E1 readData(["tags"], {maxChildrenPerNode:3}).schema ≡ readData(["tags"]).schema（toStrictEqual + JSON 逐字节）', async () => {
    const runtime = await makeBudgetRuntime();
    const budgeted = ok(runtime.readData(['tags'], { maxChildrenPerNode: 3 }), 'E1-budget');
    const plain = ok(runtime.readData(['tags']), 'E1-plain');
    expect(budgeted.truncated).toBe(true); // 证明 width 确实触发
    expect(budgeted.schema).toStrictEqual(plain.schema);
    expect(JSON.stringify(budgeted.schema)).toBe(JSON.stringify(plain.schema));
    await runtime.close();
  });
});

// ═════════════════════════════ 组 F：READ_OPTIONS_INVALID 矩阵 + 差分 + 敌意净化面 ═════════════════════════════

describe('组 F：READ_OPTIONS_INVALID 公共失败分支（同步、不抛、不借码；ADR-0024 L30）', () => {
  const HOSTILE_CASES: ReadonlyArray<{ name: string; value: unknown }> = [
    { name: '未知键', value: { depth: 1, extra: true } },
    { name: '负数', value: { depth: -1 } },
    { name: '非整数', value: { depth: 1.5 } },
    { name: 'NaN', value: { depth: Number.NaN } },
    { name: 'Infinity', value: { depth: Number.POSITIVE_INFINITY } },
    { name: '-Infinity', value: { depth: Number.NEGATIVE_INFINITY } },
    { name: 'string', value: 'depth' },
    { name: 'number', value: 42 },
    { name: 'null', value: null },
    { name: '数组', value: [1] },
    { name: '类实例', value: new Date() },
    { name: '自定义原型对象', value: Object.assign(Object.create({ inherited: true }), { depth: 1 }) },
    { name: 'accessor 键', value: { get depth() { return 1; } } },
    { name: 'width 未知键', value: { maxChildrenPerNode: 2, bogus: 1 } },
  ];

  it('F1 基础矩阵：非法 options → 恰四键 {ok,code,path,message}，path 新鲜回显、message 非空、绝不含截断键', async () => {
    const runtime = await makeBudgetRuntime();
    for (const c of HOSTILE_CASES) {
      const r = failure(runtime.readData(['meta'], asOptions(c.value)), `F1/${c.name}`);
      expect(r.code, `F1/${c.name}`).toBe('READ_OPTIONS_INVALID');
      expectFailureKeys(r as object, `F1/${c.name}`);
      expect(r.path, `F1/${c.name}：path 新鲜回显`).toStrictEqual(['meta']);
      expect(typeof r.message === 'string' && r.message.length > 0, `F1/${c.name}：message 恒非空`).toBe(true);
      expect((r as { truncated?: unknown }).truncated, `F1/${c.name}：失败分支不得带截断键`).toBeUndefined();
    }
    await runtime.close();
  });

  it('F2 无 options 调用恒不产生该码（结构不可达）+ 五键成功面', async () => {
    const runtime = await makeBudgetRuntime();
    const r = ok(runtime.readData(['meta']), 'F2');
    expectReadDataOkKeys(r);
    expect((r as { code?: unknown }).code).toBeUndefined();
    await runtime.close();
  });

  it('F3 差分矩阵：runtime 接受集 ≡ readLogicalValueAtPath 接受集（T1 单一校验权威，确定性夹具）', async () => {
    const { runtime, doc } = await makeBudgetRuntimeWithDoc();
    for (const c of HOSTILE_CASES) {
      const r = runtime.readData(['meta'], asOptions(c.value));
      const t1 = readLogicalValueAtPath(doc, ['meta'], asOptions(c.value));
      expect(r.ok, `F3/${c.name}：接受集必须与 T1 权威一致`).toBe(t1.ok);
      if (!r.ok && !t1.ok) {
        expect(r.code, `F3/${c.name}`).toBe(t1.code);
      } else if (r.ok && t1.ok) {
        expect(r.value, `F3/${c.name}`).toStrictEqual(t1.value);
        expect(r.truncations, `F3/${c.name}`).toStrictEqual(t1.truncations);
      }
    }
    await runtime.close();
  });

  it('F4 净化证明：{depth: undefined}（≡ 缺席）→ 五键 ok、零截断、投影与无 options 读 JSON 相等', async () => {
    const runtime = await makeBudgetRuntime();
    const plain = ok(runtime.readData([]), 'F4-plain');
    const r = ok(runtime.readData([], asOptions({ depth: undefined })), 'F4');
    expectReadDataOkKeys(r);
    expect(r.truncated).toBe(false);
    expect(r.truncations).toStrictEqual([]);
    expect(JSON.stringify(r.schema)).toBe(JSON.stringify(plain.schema));
    await runtime.close();
  });

  it('F5 空 options {}：五键 ok、零截断（无预算等价）', async () => {
    const runtime = await makeBudgetRuntime();
    const r = ok(runtime.readData([], asOptions({})), 'F5');
    expectReadDataOkKeys(r);
    expect(r.truncated).toBe(false);
    expect(r.truncations).toStrictEqual([]);
    await runtime.close();
  });

  it('F6 定序：非法 path + 非法 options → PATH_NOT_ALLOWED（G0 优先于 options 校验）', async () => {
    const runtime = await makeBudgetRuntime();
    const r = failure(
      runtime.readData('not-an-array' as unknown as readonly (string | number)[], asOptions({ depth: -1 })),
      'F6',
    );
    expect(r.code).toBe('PATH_NOT_ALLOWED');
    expectFailureKeys(r as object, 'F6');
    await runtime.close();
  });

  it('F7 定序：closing/closed + 非法 options → RUNTIME_READ_DISABLED（lifecycle gate 先于一切 options 触达）', async () => {
    const runtime = await makeBudgetRuntime();
    await runtime.close();
    const r = failure(runtime.readData(['meta'], asOptions({ depth: -1 })), 'F7');
    expect(r.code).toBe('RUNTIME_READ_DISABLED');
    expectFailureKeys(r as object, 'F7');
  });

  it('F-x5 状态化 descriptor trap（首次校验通过、其后抛错）→ 恰四键 READ_OPTIONS_INVALID（出口① 重派发单源收编）、绝不 throw', async () => {
    const runtime = await makeBudgetRuntime();
    const probe = statefulDescriptorProxy(1, 3); // T1 校验 2 次 descriptor 读；第 3 次起抛错
    const r = failure(runtime.readData(['meta'], asOptions(probe.options)), 'F-x5');
    expect(r.code).toBe('READ_OPTIONS_INVALID');
    expectFailureKeys(r as object, 'F-x5');
    expect(r.path).toStrictEqual(['meta']);
    expect(typeof r.message === 'string' && r.message.length > 0).toBe(true);
    expect(probe.descriptorCalls()).toBe(4); // T1 #1/#2 → 净化 #3 抛（出口①）→ 重派发 #4 抛 → T1 收编
    await runtime.close();
  });

  it('F-x6 交替 descriptor trap（净化失败而重派发又成功）→ 恰四键 READ_OPTIONS_INVALID（出口② 接缝终态成员）、绝不 throw', async () => {
    const runtime = await makeBudgetRuntime();
    const probe = throwOnceDescriptorProxy(1, 3); // 仅第 3 次 descriptor 读抛错
    const r = failure(runtime.readData(['meta'], asOptions(probe.options)), 'F-x6');
    expect(r.code).toBe('READ_OPTIONS_INVALID');
    expectFailureKeys(r as object, 'F-x6');
    expect(r.path).toStrictEqual(['meta']);
    expect(typeof r.message === 'string' && r.message.length > 0).toBe(true);
    expect(probe.descriptorCalls()).toBe(5); // 净化 #3 抛（失败）→ 重派发 #4/#5 通过 → 出口② 构造成员
    await runtime.close();
  });
});

// ═════════════════════════════ 组 G：零物化哨兵 ═════════════════════════════

describe('组 G：零物化——被截子树内含不可表示值时预算读仍 ok（ADR-0024 L124）', () => {
  it('G1 readData(["sentinel"], {depth:0}) 折叠含有 non-finite 的子树 → ok:true（零递归）；无预算读同路径响亮失败（哨兵真实）', async () => {
    const runtime = await makeBudgetRuntime({ raw: true });
    const folded = ok(runtime.readData(['sentinel'], { depth: 0 }), 'G1-budget');
    expect(folded.value).toStrictEqual({});
    expect(folded.truncations).toStrictEqual([{ path: ['sentinel'], kind: 'depth', omitted: 2 }]);
    const plain = failure(runtime.readData(['sentinel']), 'G1-plain');
    expect(plain.code).toBe('PATH_NOT_ALLOWED');
    await runtime.close();
  });
});

// ═════════════════════════════ 组 H：schema:null 与 always-on ═════════════════════════════

describe('组 H：schema:null 单义 + 预算参数不是 schema 开关（ADR-0016 L22 / ADR-0024 L75）', () => {
  it('H1 preparing 期（P0 前）预算读：值通道照常、五键共存、schema 为 null', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { handle } = await makeBudgetHandle();
    const runtime = createBudgetRuntimeFromHandle(handle, { p0Gate: gate });
    expect(runtime.getStatus().schema.state).toBe('preparing');
    const r = ok(runtime.readData(['count'], { depth: 1 }), 'H1');
    expectReadDataOkKeys(r);
    expect(r.value).toBe(3);
    expect(r.schema).toBeNull();
    release();
    await waitForSchemaReady(runtime);
    await runtime.close();
  });

  it('H2 路径偏离 schema（raw 键）+ 预算：值通道照常、五键共存、schema 为 null', async () => {
    const runtime = await makeBudgetRuntime({ raw: true });
    const r = ok(runtime.readData(['rogue'], { depth: 1 }), 'H2');
    expectReadDataOkKeys(r);
    expect(r.value).toBe('x');
    expect(r.schema).toBeNull();
    await runtime.close();
  });
});
