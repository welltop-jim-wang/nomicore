/**
 * SA6 红灯契约测试 — @nomicore/namespace-runtime readData 语义 schema 投影
 * （Issue #273 / ADR-0016，feature：readData 成功分支升级为 { ok, value, schema }）。
 *
 * 契约来源：
 * - 任务简报（issue #273）AC1–AC4：成功分支形状 `{ ok: true, value,
 *   schema: ReadDataSchemaProjection | null }`；`null` 三情形各有测试锚定；值缺席照常
 *   返 schema（路径键控）+ 空路径 [] 返 ROOT 投影；投影隔离（每次读 detached 深拷贝、
 *   不冻结、零缓存——调用方 mutation 不污染 runtime 活 schema 与后续读数）；always-on
 *   无新增公共方法/参数、失败分支不变；
 * - docs/adr/0016（已接受）：结果形状/投影体四件套/解析语义（与 #272
 *   resolveSchemaAtPath 同构）/交付纪律（每次读深拷贝）；ADR-0008 ADR-0016 修订节：
 *   derived 只经 readData 语义 schema 投影的受控只读深拷贝进入公共面；
 * - 投影语义预期值由**同源公共 API 独立求值**：`compileSchemaEnvelope` +
 *   `resolveSchemaAtPath`（vfsl 公共入口，#272 已落地并经其门禁绿）——测试不读生产
 *   实现源码、不做字符串断言，全部断言为可观测运行时行为（结果形状 / schema 内容 /
 *   引用隔离 / null 语义）。
 *
 * 红灯现状（能力缺口 = 成功分支缺 schema）：HEAD 上 runtime.readData 成功分支是
 * doc-runtime `ReadLogicalValueResult` 的零包装透传 `{ ok: true, value }`（runtime.ts
 * D3 零包装），本文件每条契约断言在 `schema` 键处红灯（toHaveProperty / toEqual /
 * 引用隔离断言失败）；SA3 在 namespace-runtime 组合边界附加 `resolveSchemaAtPath`
 * 投影的每次读深拷贝后翻绿。类型面锚（成功分支 schema 进公共联合）见
 * runtime-readdata-schema-red.test-d.ts。
 *
 * 负控（失败分支与 doc-runtime 读取面保持不变的绿断言）见
 * runtime-readdata-schema-projection-control.test.ts——两文件共同构成验收契约。
 */
import { describe, expect, it } from 'vitest';
import { createNamespaceRuntimeWithSeam } from '../src/runtime.js';
import type { NamespaceRuntime } from '../src/index.js';
import { compileSchemaEnvelope, resolveSchemaAtPath } from '@nomicore/vfsl';
import type { ValueSchema } from '@nomicore/vfsl';
import { ENV_273, makeHandle, makeReadyRuntime, deferred } from './readdata-schema-projection-fixture.js';

// ───────────────────────── 目标契约形状（本地声明；运行时翻绿依赖点） ─────────────────────────

/**
 * 目标 readData 结果联合（ADR-0016 结果形状）——本文件断言按目标形状写，通过
 * 单点窄接口把「当前零包装联合」校准到目标形状（当前实现每键缺失 → 断言红灯，
 * SA3 落位后窄接口处的形状假设与公共联合收敛）。类型级锚（编译期）由
 * runtime-readdata-schema-red.test-d.ts 负责。
 */
type TargetProjection = {
  valueSchema: ValueSchema;
  aliases: Record<string, ValueSchema>;
  docs: Record<string, readonly string[]>;
  aliasDocs: Record<string, readonly string[]>;
};
type TargetReadDataResult =
  | { ok: true; value: unknown; schema: TargetProjection | null }
  | { ok: false; code: 'PATH_NOT_ALLOWED'; path: readonly (string | number)[]; message?: string }
  | { ok: false; code: 'RUNTIME_READ_DISABLED'; path: readonly (string | number)[]; message: string };

/** 单点窄接口：仅形状校准，不改值、不吞错（ok:false → loud throw，绝不假绿）。 */
function readOk(runtime: NamespaceRuntime, path: readonly (string | number)[]): {
  ok: true;
  value: unknown;
  schema: TargetProjection | null;
} {
  const r = runtime.readData(path) as unknown as TargetReadDataResult;
  if (!r.ok) {
    throw new Error(`契约前提失败：readData(${JSON.stringify(path)}) 应成功，实际 code=${r.code}`);
  }
  return r;
}

/** 独立投影预言机：同一信封经 vfsl 公共 API 编译 + 解析（与 runtime 未来组合
 *   resolveSchemaAtPath 同源同库；求值确定性 → 深层 toEqual 成立）。 */
function oracle(path: readonly (string | number)[]): TargetProjection {
  const compiled = compileSchemaEnvelope(ENV_273);
  if (!compiled.ok) {
    throw new Error(`预言机前提失败：信封编译失败 ${JSON.stringify(compiled.issues)}`);
  }
  const resolved = resolveSchemaAtPath(compiled.derived, path);
  if (!resolved.ok) {
    throw new Error(`预言机前提失败：路径 ${JSON.stringify(path)} 解析 ${resolved.code}`);
  }
  return {
    valueSchema: resolved.valueSchema,
    aliases: resolved.aliases,
    docs: resolved.docs,
    aliasDocs: resolved.aliasDocs,
  };
}

const PROJ = (valueSchema: ValueSchema, extra?: Partial<TargetProjection>): TargetProjection => ({
  valueSchema,
  aliases: {},
  docs: {},
  aliasDocs: {},
  ...extra,
});

// ───────────────────────── AC1/AC2：成功分支形状与投影内容（红灯） ─────────────────────────

describe('issue #273 AC1/AC2：readData 成功分支形状与投影内容（红：成功分支缺 schema）', () => {
  it('空路径 []：ok:true value=ROOT 普通投影，schema=ROOT 值子树投影四件套（逐字等于独立预言机）', async () => {
    const runtime = await makeReadyRuntime();
    const r = readOk(runtime, []);
    // 形状纪律：ok 分支恰三键 {ok, value, schema}（先断言键集——红灯原因最干净）
    expect(Object.keys(r).sort()).toEqual(['ok', 'schema', 'value']);
    expect(r.schema).toBeDefined();
    expect(r.value).toEqual({
      count: 3,
      title: 'hello',
      meta: { content: 'hi' },
      tags: ['a', 'b', 'c'],
      skus: { ab: 1, ZZ1: 9 },
      rogue: 'x',
    });
    expect(r.schema).toEqual(oracle([]));
    await runtime.close();
  });

  it('标量终点：readData(["count"]) → value 3，schema.valueSchema = {kind:"scalar",type:"number"}（字面量锚，非预言机派生）', async () => {
    const runtime = await makeReadyRuntime();
    const r = readOk(runtime, ['count']);
    expect(r.schema).toEqual(PROJ({ kind: 'scalar', type: 'number' }));
    expect(r.value).toBe(3);
    await runtime.close();
  });

  it('ref 别名终点：readData(["meta"]) → value 深拷贝，schema 按名保留 ref + 别名传递闭包 + 注释切片', async () => {
    const runtime = await makeReadyRuntime();
    const r = readOk(runtime, ['meta']);
    expect(r.value).toEqual({ content: 'hi' });
    expect(r.schema).toEqual(oracle(['meta']));
    // 独立字面量锚：ref 按名保留、闭包含 Meta、docs/aliasDocs 键同构 + 内容逐字
    expect(r.schema!.valueSchema).toEqual({ kind: 'ref', name: 'Meta' });
    expect(r.schema!.aliases).toEqual({
      Meta: {
        kind: 'object',
        fields: [{ name: 'content', value: { kind: 'scalar', type: 'string' } }],
      },
    });
    expect(Object.keys(r.schema!.docs).sort()).toEqual(['Meta.content', 'ROOT.meta']);
    expect(r.schema!.docs['ROOT.meta']!.join(' ').trim()).toBe('元数据');
    expect(r.schema!.docs['Meta.content']!.join(' ').trim()).toBe('备注内容');
    expect(r.schema!.aliasDocs).toEqual({ Meta: [' 备注实体 '] });
    await runtime.close();
  });

  it('别名内深读：readData(["meta","content"]) → value "hi"，schema = scalar string，docs = 脊柱两键', async () => {
    const runtime = await makeReadyRuntime();
    const r = readOk(runtime, ['meta', 'content']);
    expect(r.value).toBe('hi');
    expect(r.schema).toEqual(oracle(['meta', 'content']));
    expect(r.schema!.valueSchema).toEqual({ kind: 'scalar', type: 'string' });
    expect(r.schema!.aliasDocs).toEqual({});
    await runtime.close();
  });

  it('数组元素终点：readData(["tags",1]) → value "b"，schema = array 元素 scalar string', async () => {
    const runtime = await makeReadyRuntime();
    const r = readOk(runtime, ['tags', 1]);
    expect(r.value).toBe('b');
    expect(r.schema).toEqual(oracle(['tags', 1]));
    expect(r.schema!.valueSchema).toEqual({ kind: 'scalar', type: 'string' });
    await runtime.close();
  });

  it('Record 合法键：readData(["skus","ab"]) → value 1，schema = scalar number（Record 槽值）', async () => {
    const runtime = await makeReadyRuntime();
    const r = readOk(runtime, ['skus', 'ab']);
    expect(r.value).toBe(1);
    expect(r.schema).toEqual(oracle(['skus', 'ab']));
    expect(r.schema!.valueSchema).toEqual({ kind: 'scalar', type: 'number' });
    await runtime.close();
  });

  it('值缺席照常返 schema（路径键控非值键控）：["nick"]（optional 缺席）与 ["skus","cd"]（Record 动态键缺席）→ value undefined + schema 非 null', async () => {
    const runtime = await makeReadyRuntime();
    const nick = readOk(runtime, ['nick']);
    expect(nick.value).toBeUndefined();
    expect(nick.schema).toEqual(oracle(['nick']));
    expect(nick.schema!.valueSchema).toEqual({
      kind: 'optional',
      value: { kind: 'scalar', type: 'string' },
    });
    const sku = readOk(runtime, ['skus', 'cd']);
    expect(sku.value).toBeUndefined();
    expect(sku.schema).toEqual(oracle(['skus', 'cd']));
    expect(sku.schema!.valueSchema).toEqual({ kind: 'scalar', type: 'number' });
    await runtime.close();
  });
});

// ───────────────────────── AC2：schema:null 三情形（红灯） ─────────────────────────

describe('issue #273 AC2：schema:null 三情形（红：成功分支缺 schema 键）', () => {
  it('情形① 无 active schema（preparing，p0Gate 未放行）：读恒成功 value 正确，schema 为 null', async () => {
    const gate = deferred();
    const { handle } = await makeHandle();
    const runtime = createNamespaceRuntimeWithSeam({ handle, p0Gate: gate.promise });
    expect(runtime.getStatus().schema.state).toBe('preparing');
    const r = readOk(runtime, ['count']);
    expect(r.value).toBe(3);
    expect(r).toHaveProperty('schema');
    expect(r.schema).toBeNull();
    gate.resolve();
    await expect.poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 }).toBe('ready');
    await runtime.close();
  });

  it('情形① 无 active schema（unavailable，编译失败态）：读恒成功，schema 为 null', async () => {
    const { handle } = await makeHandle({ text: 'type ROOT = {' });
    const runtime = createNamespaceRuntimeWithSeam({ handle });
    await expect.poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 2_000 }).toBe('unavailable');
    const r = readOk(runtime, ['count']);
    expect(r.value).toBe(3);
    expect(r).toHaveProperty('schema');
    expect(r.schema).toBeNull();
    await runtime.close();
  });

  it('情形① 无 active schema（fatal，编译内部故障态）：读保留且恒成功，schema 为 null', async () => {
    const { handle } = await makeHandle();
    const runtime = createNamespaceRuntimeWithSeam({
      handle,
      compile: () => {
        throw new Error('probe: compile seam internal fault');
      },
    });
    await expect.poll(() => runtime.getStatus().fatal, { interval: 10, timeout: 2_000 }).not.toBeNull();
    const r = readOk(runtime, ['count']);
    expect(r.value).toBe(3);
    expect(r).toHaveProperty('schema');
    expect(r.schema).toBeNull();
    await runtime.close();
  });

  it('情形② 路径偏离 schema（raw 复制式 schema 外数据在场）：["rogue"] 读成功 value "x"，schema 为 null', async () => {
    const runtime = await makeReadyRuntime();
    const r = readOk(runtime, ['rogue']);
    expect(r.value).toBe('x');
    expect(r).toHaveProperty('schema');
    expect(r.schema).toBeNull();
    await runtime.close();
  });

  it('情形③ 静态解析失败（Record keyPattern 失配）：["skus","ZZ1"] 数据在场读成功 value 9，schema 为 null；同 map 合法键 "ab" 照常非 null（对照）', async () => {
    const runtime = await makeReadyRuntime();
    const bad = readOk(runtime, ['skus', 'ZZ1']);
    expect(bad.value).toBe(9);
    expect(bad).toHaveProperty('schema');
    expect(bad.schema).toBeNull();
    const good = readOk(runtime, ['skus', 'ab']);
    expect(good.schema).not.toBeNull();
    await runtime.close();
  });
});

// ───────────────────────── AC3：投影隔离（每次读 detached 深拷贝） ─────────────────────────

describe('issue #273 AC3：投影隔离——每次读深拷贝、detached、不冻结、零缓存（红）', () => {
  it('两次读内容全等但零引用共享（结果对象/valueSchema/aliases/docs/aliasDocs 五层引用均不共享；三次连续读互不共享 = 零缓存）', async () => {
    const runtime = await makeReadyRuntime();
    const a = readOk(runtime, ['meta']);
    const b = readOk(runtime, ['meta']);
    expect(a.schema).toEqual(b.schema);
    expect(a.schema).toEqual(oracle(['meta']));
    expect(a.schema).not.toBe(b.schema);
    expect(a.schema!.valueSchema).not.toBe(b.schema!.valueSchema);
    expect(a.schema!.aliases).not.toBe(b.schema!.aliases);
    expect(a.schema!.aliases['Meta']).not.toBe(b.schema!.aliases['Meta']);
    expect(a.schema!.docs).not.toBe(b.schema!.docs);
    expect(a.schema!.aliasDocs).not.toBe(b.schema!.aliasDocs);
    const c = readOk(runtime, ['meta']);
    expect(c.schema).not.toBe(a.schema);
    expect(c.schema).not.toBe(b.schema);
    await runtime.close();
  });

  it('调用方改写返回投影（别名体字段表替换 / docs 键内容污染 / valueSchema 附加属性）后，后续读数与 live schema 均不受影响', async () => {
    const runtime = await makeReadyRuntime();
    const pristine = oracle(['meta']);
    const base = runtime.getActiveSchema();

    const first = readOk(runtime, ['meta']);
    expect(first.schema).toBeDefined();
    const p = first.schema;
    if (p === null) throw new Error('契约前提失败：ready 态路径内读 schema 应为投影');
    // 投影是可变普通副本（不冻结）——契约明示「可变、不冻结」
    expect(Object.isFrozen(p.valueSchema)).toBe(false);
    expect(Object.isFrozen(p.aliases)).toBe(false);
    expect(Object.isFrozen(p.docs)).toBe(false);
    // 1) 深改 valueSchema 引用图：给 ref 节点附加属性
    (p.valueSchema as Record<string, unknown>)['tainted'] = true;
    // 2) 替换别名体
    (p.aliases as Record<string, unknown>)['Meta'] = { kind: 'scalar', type: 'number' };
    // 3) 污染 docs 数组（读侧返回值上的内容级改写）
    (p.docs as Record<string, unknown>)['ROOT.meta'] = ['corrupted'];
    (p.docs as Record<string, readonly string[]>)['Meta.content'] = [];

    // 再次读取：新投影逐字等于 pristine（不被上一读的改写污染）且不是同一对象
    const second = readOk(runtime, ['meta']);
    expect(second.schema).toEqual(pristine);
    expect(second.schema).not.toBe(p);
    expect(second.schema!.valueSchema).toEqual(pristine.valueSchema);
    expect(second.schema!.aliases).toEqual(pristine.aliases);
    expect(second.schema!.docs).toEqual(pristine.docs);
    expect(second.schema!.aliasDocs).toEqual(pristine.aliasDocs);

    // live active schema 身份未被读侧 mutation 触碰（指纹身份不变）
    expect(runtime.getActiveSchema()).toEqual(base);
    await runtime.close();
  });

  it('改写第二次读的投影不影响第一次已返回的投影对象（读间零共享双向成立）', async () => {
    const runtime = await makeReadyRuntime();
    const first = readOk(runtime, ['meta']);
    const second = readOk(runtime, ['meta']);
    expect(second.schema).toBeDefined();
    const snapshot = oracle(['meta']);
    (second.schema as unknown as { docs: Record<string, unknown> }).docs['ROOT.meta'] = ['evil'];
    expect(first.schema).toEqual(snapshot);
    await runtime.close();
  });
});
