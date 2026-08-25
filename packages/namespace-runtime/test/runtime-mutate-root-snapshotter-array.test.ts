/**
 * SA6 红灯测试（非冻结补充文件）— @nomicore/namespace-runtime 受控 snapshotter
 * **数组分支** R2 增补拒绝（issue #90 / SA2 R2 备注 N1 回流）。
 *
 * 来源：
 * - SA2 攻击评审报告（wiki/raw/task_namespace-runtime-write-sequencer_sa2_review.md）
 *   「红线测试思路」#2a/#2b/#2c（+ 同族补一条）——R1 攻击点 #2（CRITICAL：数组分支
 *   缺 symbol 键 / 非枚举 own 键 / accessor 下标三查，symbol 与非枚举键被静默丢弃、
 *   accessor getter 在快照期被执行，违反 ADR-0008 snapshotter 拒绝清单）；
 * - SA1 设计 R2 §4 D3 数组分支重写（①②③④⑤ 序）与 §6.2 #11（拒绝清单表）：
 *   ① `Object.getOwnPropertySymbols(v).length > 0` → 拒「数组携带 symbol 键」；
 *   ② `getOwnPropertyNames` 过滤 `'length'` 后与 `Object.keys` 数量比对 → 拒
 *   「数组携带非枚举 own 键」（含非枚举下标）；
 *   ③ **descriptor 全表扫描先于任何值读取**——`d === undefined` 拒稀疏空洞/原型链
 *   污染；`d.get/set ≠ undefined` 拒「accessor 下标」（getOwnPropertyDescriptor 是
 *   元数据读取、不执行 getter——拒绝先于任何输入侧代码执行）；
 *   ④ keys-vs-length 拒可枚举非索引 own 键；
 *   ⑤ 密集数组照收（正例零误伤）；`path` 数组走同分支免费覆盖（同族纪律）；
 * - 稳定码：`MUTATION_INPUT_NOT_PLAIN_DATA`（设计 R2 §6.2 #11 —— ok:false issue，
 *   snapshotter 全部拒绝类 + 读取面抛错收编，issue.message 前缀形态）。
 *
 * 本文件锚点（公共接缝可观测输出；不预设实现内部）：
 * - #2a array 携带 symbol own 键（`a[Symbol('x')] = 9`）→ resolved ok:false +
 *   issues 含稳定码 MUTATION_INPUT_NOT_PLAIN_DATA + 0 次更新事件 + state 字节不变 +
 *   0 次 notifier + 读取保留（零写入）；
 * - #2b array 携带非枚举 own 键（`Object.defineProperty(a,'meta',{enumerable:false})`）
 *   → 同上断言组；
 * - #2c array 下标为 accessor（`Object.defineProperty(a,0,{get(){...}})`）
 *   → ok:false + 稳定码 + **getter 调用数 === 0**（拒绝先于任何输入侧代码执行）+
 *   零写入零 notifier；
 * - 同族：mutation 信封 `path` 数组携带 symbol 键 → 同拒绝（数组纪律一致，path 不经
 *   信封形状校验绕道）；
 * - 正例零误伤：密集嵌套数组 value → ok:true + 提交值深等（防「拒一切数组」式过度实现）。
 *
 * 红灯现状（构造性红）：runtime.mutateRoot 尚未实现——全部用例在首个 mutateRoot 调用处红
 * （TypeError: runtime.mutateRoot is not a function）。
 *
 * 非冻结文件：SA3 不得修改 SA6 冻结测试（runtime-mutate-root-sequencer /
 * runtime-mutate-root-persistence / doc-runtime 两守卫）；本文件为补充锚，若 SA1/SA3 对
 * 实现内部（如 issue 字段命名）有设计修订，可对齐本文件而不动冻结面。
 */
import { describe, expect, it, beforeAll } from 'vitest';
import * as Y from 'yjs';
import type { DocHandle, User } from '@nomicore/persistence';
import { createNamespaceRuntimeWithSeam } from '../src/runtime.js';
import type { NamespaceRuntime } from '../src/index.js';

// —— 契约类型（测试侧声明）——

interface MutationIssue {
  message: string;
  path: Array<string | number>;
}

type MutateRootResult = { ok: true } | { ok: false; issues: MutationIssue[] };

type MutateRoot = (mutation: unknown) => Promise<MutateRootResult>;

interface MutateRootRuntime extends NamespaceRuntime {
  mutateRoot: MutateRoot;
}

// —— fixture ——

const OWNER: User = { userId: 'u-alice' };
const TEXT = 'type ROOT = { n: number; a: string; };';
const TEXT_TAGS = 'type ROOT = { n: number; a: string; tags: string[]; };';
const ENVELOPE = { lang: 'vfsl', version: 1, id: 'ns-1', text: TEXT } as const;
const ENVELOPE_TAGS = { lang: 'vfsl', version: 1, id: 'ns-1', text: TEXT_TAGS } as const;
const ROOT0 = { n: 1, a: 'x' };
const ROOT0_TAGS = { n: 1, a: 'x', tags: ['k'] };
const STABLE_CODE = 'MUTATION_INPUT_NOT_PLAIN_DATA';

function stateBytes(doc: Y.Doc): number[] {
  return [...Y.encodeStateAsUpdate(doc)];
}

function readValue(runtime: NamespaceRuntime, path: readonly (string | number)[]): unknown {
  const read = runtime.read(path);
  if (!read.ok) throw new Error(`读取应成功，实际 code=${read.code}`);
  return read.value;
}

function countUpdates(doc: Y.Doc): { count: number } {
  const counter = { count: 0 };
  doc.on('update', () => {
    counter.count += 1;
  });
  return counter;
}

/** 受控 seam 手柄（fake handle：owner/docId/doc 形状 + 可翻转状态机）。 */
function makeFakeHandle(opts: {
  doc: Y.Doc;
  statusMode?: 'ready' | 'persistence-degraded' | undefined;
}): {
  handle: DocHandle;
  setMode: (mode: 'ready' | 'persistence-degraded') => void;
} {
  let mode: 'ready' | 'persistence-degraded' = opts.statusMode ?? 'ready';
  const handle = {
    owner: OWNER,
    docId: 'ns-1',
    doc: opts.doc,
    getStatus: () => mode,
    release: async () => {},
  } as unknown as DocHandle;
  return { handle, setMode: (m) => { mode = m; } };
}

function makeDoc(schema: Record<string, unknown>, rootValues: Record<string, unknown>): Y.Doc {
  const doc = new Y.Doc();
  const sc = doc.getMap('SCHEMA');
  for (const [k, v] of Object.entries(schema)) sc.set(k, v);
  doc.getMap('META').set('docId', 'ns-1');
  const root = doc.getMap('ROOT');
  for (const [k, v] of Object.entries(rootValues)) {
    if (Array.isArray(v)) {
      // 载体纪律：`string[]` schema 派生为 Y.Array 载体（vfsl「裸 T[] 与 YArray 共用」）——
      // 种子侧必须物化真 Y.Array，否则 extract 在写前按 ADR-0007「当前 ROOT 结构损坏立即
      // 失败」正确报「期望 Y.Array，实际 plain value」（Y.Map.set 不自动转换）
      const ya = new Y.Array<string>();
      ya.insert(0, v);
      root.set(k, ya);
    } else {
      root.set(k, v);
    }
  }
  return doc;
}

async function readyRuntime(opts: {
  doc: Y.Doc;
  notifyDirty: () => Promise<void>;
}): Promise<MutateRootRuntime> {
  const ctl = makeFakeHandle({ doc: opts.doc });
  const runtime = createNamespaceRuntimeWithSeam({
    handle: ctl.handle,
    notifyDirty: opts.notifyDirty,
  }) as unknown as MutateRootRuntime;
  await expect.poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 }).toBe('ready');
  return runtime;
}

async function settleOf(p: Promise<unknown>): Promise<{ kind: 'resolved'; value: unknown } | { kind: 'rejected'; reason: unknown }> {
  try {
    return { kind: 'resolved', value: await p };
  } catch (reason) {
    return { kind: 'rejected', reason };
  }
}

function issuesOf(value: unknown): MutationIssue[] {
  if (typeof value !== 'object' || value === null) return [];
  const issues = (value as { issues?: unknown }).issues;
  return Array.isArray(issues) ? (issues as MutationIssue[]) : [];
}

/** 稳定码 MUTATION_INPUT_NOT_PLAIN_DATA 是否落在结果联合的 issue 域（设计 R2 §6.2 #11）。 */
function hasNotPlainCode(value: unknown): boolean {
  return issuesOf(value).some((issue) =>
    JSON.stringify(issue).includes(STABLE_CODE),
  );
}

/** 零写入断言组（公共接缝可观测）：0 更新事件、state 字节不变、0 notifier、读取保留。 */
async function assertZeroWriteRejection(
  runtime: MutateRootRuntime,
  doc: Y.Doc,
  mutation: unknown,
  notifierCalls: () => number,
): Promise<void> {
  const updates = countUpdates(doc);
  const before = stateBytes(doc);
  const settled = await settleOf(runtime.mutateRoot(mutation));
  expect(settled.kind).toBe('resolved'); // 输入缺陷属普通领域失败：ok:false 联合，不升格 internal fatal
  if (settled.kind !== 'resolved') return;
  expect(settled.value).toMatchObject({ ok: false });
  expect(issuesOf(settled.value).length).toBeGreaterThanOrEqual(1);
  expect(hasNotPlainCode(settled.value)).toBe(true); // 稳定码 MUTATION_INPUT_NOT_PLAIN_DATA
  expect(updates.count).toBe(0); // 零写入：0 次 Y.Doc 更新事件
  expect(stateBytes(doc)).toEqual(before); // 零写入：state 字节不变
  expect(notifierCalls()).toBe(0); // 未提交不登记 dirty
  expect(readValue(runtime, ['n'])).toBe(1); // 读取保留（只读面不受影响）
}

// —— 模块级动态取成员（构造性红观测点：mutateRoot 经 runtime 面方法）——

let mutateRootOfEntry: unknown;

beforeAll(async () => {
  const entry = (await import('../src/index.js')) as Record<string, unknown>;
  mutateRootOfEntry = entry['mutateRoot'];
});

describe('namespace-runtime snapshotter 数组分支 R2 拒绝（SA2 红线 #2a/#2b/#2c + 同族 + 正例）', () => {
  it('#2a：set value 数组携带 symbol own 键 → ok:false + MUTATION_INPUT_NOT_PLAIN_DATA + 零写入', async () => {
    const doc = makeDoc({ ...ENVELOPE }, ROOT0);
    let notifierCalls = 0;
    const runtime = await readyRuntime({
      doc,
      notifyDirty: async () => {
        notifierCalls += 1;
      },
    });
    // 哨兵：先确认公共面形状（红灯锚——当前 mutateRoot 未实现 → 此断言红）
    expect(typeof runtime.mutateRoot).toBe('function');
    expect(mutateRootOfEntry).toBeUndefined(); // 契约护栏：mutateRoot 是 runtime 面方法，非模块级导出

    const a = [1, 2] as unknown as Array<number> & Record<symbol, unknown>;
    a[Symbol('x')] = 9; // symbol 键不进 Object.keys / Object.getOwnPropertyNames——
    // R1 盲区：keys-vs-length 检测不到、被静默丢弃；R2 ① 必须拒绝
    await assertZeroWriteRejection(runtime, doc, { op: 'set', path: ['n'], value: a }, () => notifierCalls);
  });

  it('#2b：set value 数组携带非枚举 own 键 → ok:false + MUTATION_INPUT_NOT_PLAIN_DATA + 零写入', async () => {
    const doc = makeDoc({ ...ENVELOPE }, ROOT0);
    let notifierCalls = 0;
    const runtime = await readyRuntime({
      doc,
      notifyDirty: async () => {
        notifierCalls += 1;
      },
    });
    const a = [1, 2] as unknown as Record<string, unknown>;
    Object.defineProperty(a, 'meta', { value: 1, enumerable: false, configurable: true });
    await assertZeroWriteRejection(runtime, doc, { op: 'set', path: ['n'], value: a }, () => notifierCalls);
  });

  it('#2c：set value 数组下标为 accessor → ok:false + MUTATION_INPUT_NOT_PLAIN_DATA + getter 调用数 === 0 + 零写入', async () => {
    const doc = makeDoc({ ...ENVELOPE }, ROOT0);
    let notifierCalls = 0;
    const runtime = await readyRuntime({
      doc,
      notifyDirty: async () => {
        notifierCalls += 1;
      },
    });
    let getterCalls = 0;
    const a = [1, 2] as unknown as Record<string, unknown>;
    Object.defineProperty(a, '0', {
      get() {
        getterCalls += 1;
        return 5;
      },
      enumerable: true,
      configurable: true,
    });
    await assertZeroWriteRejection(runtime, doc, { op: 'set', path: ['n'], value: a }, () => notifierCalls);
    // 次序保证：descriptor 检查先于任何值读取——拒绝路径零输入侧代码执行（R1 盲区 c）
    expect(getterCalls).toBe(0);
  });

  it('同族（#2c 补）：mutation 信封 path 数组携带 symbol 键 → 同拒绝 + 零写入（数组纪律一致，不经信封校验绕道）', async () => {
    const doc = makeDoc({ ...ENVELOPE }, ROOT0);
    let notifierCalls = 0;
    const runtime = await readyRuntime({
      doc,
      notifyDirty: async () => {
        notifierCalls += 1;
      },
    });
    const path = ['n'] as unknown as Array<string> & Record<symbol, unknown>;
    path[Symbol('p')] = 1;
    await assertZeroWriteRejection(runtime, doc, { op: 'set', path, value: 2 }, () => notifierCalls);
  });

  it('正例零误伤（N1）：密集嵌套数组 value → ok:true + 提交值深等（防「拒一切数组」式过度实现）', async () => {
    const doc = makeDoc({ ...ENVELOPE_TAGS }, ROOT0_TAGS);
    let notifierCalls = 0;
    const runtime = await readyRuntime({
      doc,
      notifyDirty: async () => {
        notifierCalls += 1;
      },
    });
    const tags = ['x', 'y', 'z'];
    const res = await runtime.mutateRoot({ op: 'set', path: ['tags'], value: tags });
    expect(res).toEqual({ ok: true });
    expect(notifierCalls).toBe(1);
    expect(readValue(runtime, ['tags'])).toEqual(['x', 'y', 'z']);
    // 调用方对象在排队/执行后被改动，不影响已提交快照（隔离性）
    tags.push('mutated-later');
    expect(readValue(runtime, ['tags'])).toEqual(['x', 'y', 'z']);
  });
});
