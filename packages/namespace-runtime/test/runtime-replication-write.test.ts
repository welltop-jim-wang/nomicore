/**
 * SA3-owned 单元/集成用例 — issue #132 新文档化通道的测试锚（设计 §4.10.1，
 * SA2 评审 #5 场景清单）：槽级（经 pack 内 seam 直构 runtime）锚定——
 * - REPLICATION_INPUT_INVALID 两型：(a) Proxy get trap 双读分叉（首读合法 32-hex、
 *   次读 'ZZZ'）→ 单读捕获闭合（结算后 META 中 replicationId ≠ 'ZZZ'）；
 *   (b) ownKeys/getter trap throw → 结算 ok:false issue（JSON 含码），绝不 raw
 *   rejection（rejection 通道为空或仅 RuntimeWriteFatalError）；
 * - 槽内 E4 corrupt fatal：构造后破坏 META（仅 seam 级可达——直构 runtime 后手工
 *   改 doc）→ RuntimeWriteFatalError（phase=write-slot-internal、committed:false）
 *   + status.fatal 置位 + 后续写 RUNTIME_WRITE_DISABLED；
 * - REPLICATION_NOT_ENABLED：未 enable 直接 bump → ok:false + message 含码；
 *   META 两键仍真缺席（has() false）；saveDoc 0 次；
 * - REPLICATION_META_ABSENT：无 META 载体种子（seedForTest 设施）+ enable →
 *   ok:false + message 含码；doc.share.has('META') 仍 false（未凭空造载体）、
 *   零 dirty。
 *
 * 驱动面：全部经 createNamespaceRuntimeWithSeam 直构（包内模块通道）——真实
 * Y.Doc/P0/编译，仅 handle/notifyDirty 受控；零网络、零 real-sleep。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { DocHandle, DocHandleStatus, User } from '@nomicore/persistence';
import { RuntimeWriteFatalError } from '../src/index.js';
import type { EnableReplicationInput, NamespaceRuntime } from '../src/index.js';
import { createNamespaceRuntimeWithSeam } from '../src/runtime.js';

// —— fixture ——

const OWNER: User = { userId: 'u-alice' };
const TEXT_VALID = 'type ROOT = { n: number; };';
const ENVELOPE = { lang: 'vfsl', version: 1, id: 'ns-1', text: TEXT_VALID } as const;
const ROOT0 = { n: 1 };
const REP_ID_PATTERN = /^[0-9a-f]{32}$/;

function fakeHandle(doc: Y.Doc): DocHandle {
  return {
    owner: OWNER,
    docId: 'ns-1',
    doc,
    getStatus: () => 'ready',
    release: async () => {},
  } as unknown as DocHandle;
}

function makeDoc(options: { withMeta?: boolean } = {}): Y.Doc {
  const doc = new Y.Doc();
  const sc = doc.getMap('SCHEMA');
  for (const [k, v] of Object.entries(ENVELOPE)) sc.set(k, v);
  if (options.withMeta !== false) {
    const meta = doc.getMap('META');
    meta.set('docId', 'ns-1');
    meta.set('createdAt', 1_700_000_123_456);
  }
  doc.getMap('ROOT').set('n', ROOT0.n);
  return doc;
}

async function readyOf(runtime: NamespaceRuntime): Promise<NamespaceRuntime> {
  await expect.poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 }).toBe('ready');
  return runtime;
}

function makeRuntime(
  doc: Y.Doc,
  opts: { notifyDirty?: () => Promise<void> } = {},
): { runtime: NamespaceRuntime; notify: () => number } {
  let calls = 0;
  const base = opts.notifyDirty;
  const notifyDirty = async (): Promise<void> => {
    calls += 1;
    if (base !== undefined) await base();
  };
  const runtime = createNamespaceRuntimeWithSeam({
    handle: fakeHandle(doc),
    notifyDirty,
  });
  return { runtime, notify: () => calls };
}

function enableOf(runtime: NamespaceRuntime, input: unknown) {
  return runtime.enableReplication(input as unknown as EnableReplicationInput);
}

function issuesText(result: unknown): string {
  const r = result as { issues?: unknown };
  return JSON.stringify(r.issues ?? result);
}

/** 收集 settled 结果/拒绝（resolve 值或 throw 值统一返回，不使测试直接崩散）。 */
async function settleOf(
  p: Promise<unknown>,
): Promise<{ kind: 'resolved'; value: unknown } | { kind: 'rejected'; reason: unknown }> {
  try {
    return { kind: 'resolved', value: await p };
  } catch (reason) {
    return { kind: 'rejected', reason };
  }
}

describe('REPLICATION_INPUT_INVALID：敌意输入经槽 E3 单读捕获 + 全探测收编（SA2 R1 #2）', () => {
  it('(a) Proxy get trap 双读分叉：首读 32-hex、次读 "ZZZ" —— 结算后 META 中 replicationId ≠ "ZZZ"（单读捕获闭合）', async () => {
    const doc = makeDoc();
    const { runtime, notify } = makeRuntime(doc);
    await readyOf(runtime);

    const FIRST = 'a'.repeat(32);
    let reads = 0;
    const fork = new Proxy(
      { replicationId: FIRST },
      {
        get(target, key, receiver) {
          if (key === 'replicationId') {
            reads += 1;
            // 双读分叉：首读合法、次读非法——双读实现会把 'ZZZ' 写入 META
            return reads === 1 ? FIRST : 'ZZZ';
          }
          return Reflect.get(target, key, receiver);
        },
      },
    );

    const settled = await settleOf(enableOf(runtime, fork));
    // 单读捕获：结果为成功（捕获值过格式门）或以 REPLICATION_INPUT_INVALID 拒绝——
    // 两类均可接受性；不变式 = META 永不含 'ZZZ'
    if (settled.kind === 'resolved') {
      expect((settled.value as { ok: boolean }).ok).toBe(true);
    } else {
      expect(settled.reason).toBeInstanceOf(RuntimeWriteFatalError);
      expect((settled.reason as RuntimeWriteFatalError).phase).toBe('unknown-pipeline-throw');
    }
    expect(reads).toBe(1); // 恰一次属性读（E3 捕获 + E5 消费同一常量）
    const meta = doc.getMap('META');
    expect(meta.get('replicationId')).not.toBe('ZZZ');
    expect(meta.get('replicationId')).toBe(FIRST);
    expect(notify()).toBe(1); // 成功槽恰一次 dirty
  });

  it('(b) ownKeys trap throw → 结算 ok:false issue（JSON 含 REPLICATION_INPUT_INVALID）；rejection 通道为空', async () => {
    const doc = makeDoc();
    const { runtime, notify } = makeRuntime(doc);
    await readyOf(runtime);

    const hostile = new Proxy(
      { replicationId: 'b'.repeat(32) },
      {
        ownKeys() {
          throw new Error('ownKeys trap boom');
        },
      },
    );
    const result = await enableOf(runtime, hostile);
    expect(result.ok).toBe(false);
    expect(issuesText(result)).toContain('REPLICATION_INPUT_INVALID');
    expect(doc.getMap('META').has('replicationId')).toBe(false); // 零写入
    expect(notify()).toBe(0); // 零 dirty
  });

  it('(b2) getter trap throw → 结算 ok:false issue（JSON 含 REPLICATION_INPUT_INVALID）；rejection 通道为空', async () => {
    const doc = makeDoc();
    const { runtime, notify } = makeRuntime(doc);
    await readyOf(runtime);

    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error('get trap boom');
        },
      },
    );
    // .then(null, …) 断言 rejection 通道为空（绝不 raw rejection / RuntimeWriteFatalError）
    let rejectedReason: unknown = '(no rejection)';
    const result = await enableOf(runtime, hostile).then(
      (value) => value,
      (reason) => {
        rejectedReason = reason;
        return null;
      },
    );
    expect(rejectedReason).toBe('(no rejection)');
    expect(result).not.toBeNull();
    expect((result as { ok: boolean }).ok).toBe(false);
    expect(issuesText(result)).toContain('REPLICATION_INPUT_INVALID');
    expect(doc.getMap('META').has('replicationId')).toBe(false);
    expect(notify()).toBe(0);
  });

  it('(c) 非对象/错型输入（null、缺键、多键、非法 hex、非 string）→ ok:false + REPLICATION_INPUT_INVALID、零写入零通知', async () => {
    const doc = makeDoc();
    const { runtime, notify } = makeRuntime(doc);
    await readyOf(runtime);

    const cases: unknown[] = [
      null,
      undefined,
      'not-an-object',
      {},
      { replicationId: 'c'.repeat(32), extra: 1 },
      { replicationId: 'xyz' },
      { replicationId: 'C'.repeat(32) }, // 大写 → 违约
      { replicationId: 42 },
    ];
    for (const input of cases) {
      const result = await enableOf(runtime, input);
      expect(result.ok).toBe(false);
      expect(issuesText(result)).toContain('REPLICATION_INPUT_INVALID');
    }
    expect(doc.getMap('META').has('replicationId')).toBe(false);
    expect(notify()).toBe(0);
  });
});

describe('槽内 E4 读取到损坏 META → internal fatal（拒绝虚假降级，D-3）', () => {
  it('构造后破坏 META（恰一键存在）→ RuntimeWriteFatalError（phase=write-slot-internal、committed:false）+ status.fatal 置位 + 后续写 RUNTIME_WRITE_DISABLED', async () => {
    const doc = makeDoc();
    const { runtime } = makeRuntime(doc);
    await readyOf(runtime);

    // 手工破坏（仅 seam 直构路径可达——生产写入面只经复制槽，结构性不可达）
    doc.getMap('META').set('replicationId', 'f'.repeat(32)); // 有 id 无 epoch → 恰一键存在

    const settled = await settleOf(enableOf(runtime, { replicationId: 'd'.repeat(32) }));
    expect(settled.kind).toBe('rejected');
    if (settled.kind !== 'rejected') return;
    const reason = settled.reason;
    expect(reason).toBeInstanceOf(RuntimeWriteFatalError);
    const fatal = reason as RuntimeWriteFatalError;
    expect(fatal.phase).toBe('write-slot-internal'); // 槽内不变量破坏分级
    expect(fatal.committed).toBe(false); // E4 尚零 doc 写

    // status.fatal 稳定摘要（REPLICATION 写槽独立码——诊断不失真）
    const st = runtime.getStatus();
    expect(st.fatal).not.toBeNull();
    expect(st.fatal?.code).toBe('NSRT-FATAL-REPLICATION-WRITE-INTERNAL');
    expect(st.rootWrite.enabled).toBe(false);
    expect(st.schemaWrite.enabled).toBe(false);
    expect(st.read.enabled).toBe(true);

    // 后续写（再 enable / mutateRoot）→ RUNTIME_WRITE_DISABLED 零写入
    const later = await enableOf(runtime, { replicationId: 'e'.repeat(32) });
    expect(later.ok).toBe(false);
    expect(issuesText(later)).toContain('RUNTIME_WRITE_DISABLED');
    const rootWrite = await runtime.mutateRoot({ op: 'set', path: ['n'], value: 9 });
    expect(rootWrite.ok).toBe(false);
    expect(JSON.stringify(rootWrite)).toContain('RUNTIME_WRITE_DISABLED');
  });

  it('fatal 后 E5.5 已更新的复制事实保留（bump 后 notify-dirty 失败 committed:true——事实不回滚）', async () => {
    const doc = makeDoc();
    let failing = false;
    const { runtime, notify } = makeRuntime(doc, {
      notifyDirty: () => (failing ? Promise.reject(new Error('notify down')) : Promise.resolve()),
    });
    await readyOf(runtime);

    expect((await enableOf(runtime, { replicationId: 'a'.repeat(32) })).ok).toBe(true);
    expect(notify()).toBe(1);
    const id0 = doc.getMap('META').get('replicationId');

    failing = true;
    const settled = await settleOf(runtime.bumpReplicationEpoch());
    expect(settled.kind).toBe('rejected');
    if (settled.kind !== 'rejected') return;
    const reason = settled.reason as RuntimeWriteFatalError;
    expect(reason).toBeInstanceOf(RuntimeWriteFatalError);
    expect(reason.phase).toBe('notify-dirty-failed');
    expect(reason.committed).toBe(true);
    expect(reason.message).toContain('REPLICATION write');

    // META 已提升（事实保留——不回滚）；status.replication 同步反映 committed 事实
    expect(doc.getMap('META').get('replicationId')).toBe(id0);
    expect(doc.getMap('META').get('replicationEpoch')).toBe(2);
    expect(runtime.getStatus().replication).toEqual({
      state: 'enabled',
      replicationId: id0,
      replicationEpoch: 2,
    });
  });
});

describe('REPLICATION_NOT_ENABLED / REPLICATION_META_ABSENT（runtime 侧行为，经 seam 直构）', () => {
  it('未 enable 直接 bump → ok:false + message 含码；META 两键仍真缺席（has() false）；saveDoc 0 次', async () => {
    const doc = makeDoc();
    const { runtime, notify } = makeRuntime(doc);
    await readyOf(runtime);

    // 基线：两键真缺席 → status disabled
    expect(runtime.getStatus().replication).toEqual({ state: 'disabled' });

    const result = await runtime.bumpReplicationEpoch();
    expect(result.ok).toBe(false);
    expect(issuesText(result)).toContain('REPLICATION_NOT_ENABLED');
    const meta = doc.getMap('META');
    expect(meta.has('replicationId')).toBe(false);
    expect(meta.has('replicationEpoch')).toBe(false);
    expect(notify()).toBe(0); // 零 dirty
  });

  it('无 META 载体种子（seedForTest 设施）+ enable → ok:false + message 含码；doc.share.has("META") 仍 false（未凭空造载体）、零 dirty', async () => {
    const doc = makeDoc({ withMeta: false }); // 无 META 载体（生产路径不可达，仅 seed）
    const { runtime, notify } = makeRuntime(doc);
    await readyOf(runtime);

    const result = await enableOf(runtime, { replicationId: 'a'.repeat(32) });
    expect(result.ok).toBe(false);
    expect(issuesText(result)).toContain('REPLICATION_META_ABSENT');
    expect(doc.share.has('META')).toBe(false); // 未凭空创建载体（防无 docId 的 META 损坏）
    expect(notify()).toBe(0);
  });
});

describe('复制槽基本语义（runtime 侧补充锚：幂等/单调/overflow 的槽级面）', () => {
  it('enable → 幂等再 enable（零通知、身份不变）→ bump → overflow 拒升；identity 不可变', async () => {
    const doc = makeDoc();
    const { runtime, notify } = makeRuntime(doc);
    await readyOf(runtime);

    expect((await enableOf(runtime, { replicationId: 'f'.repeat(32) })).ok).toBe(true);
    const id0 = doc.getMap('META').get('replicationId') as string;
    expect(id0).toMatch(REP_ID_PATTERN);
    expect(doc.getMap('META').get('replicationEpoch')).toBe(1);
    expect(notify()).toBe(1);

    // 幂等：零写入、零通知、身份/epoch 不变（E4 已启用 → {ok:true}）
    expect((await enableOf(runtime, { replicationId: '0'.repeat(32) })).ok).toBe(true);
    expect(doc.getMap('META').get('replicationId')).toBe(id0);
    expect(doc.getMap('META').get('replicationEpoch')).toBe(1);
    expect(notify()).toBe(1);

    // bump 单调推进
    expect((await runtime.bumpReplicationEpoch()).ok).toBe(true);
    expect(doc.getMap('META').get('replicationEpoch')).toBe(2);
    expect(doc.getMap('META').get('replicationId')).toBe(id0);
    expect(runtime.getStatus().replication).toEqual({ state: 'enabled', replicationId: id0, replicationEpoch: 2 });

    // overflow：拒升不回绕（经 doc 直改 META epoch = MAX——seam 级构造后注入面）
    doc.getMap('META').set('replicationEpoch', Number.MAX_SAFE_INTEGER);
    const rejected = await runtime.bumpReplicationEpoch();
    expect(rejected.ok).toBe(false);
    expect(issuesText(rejected)).toContain('REPLICATION_EPOCH_OVERFLOW');
    expect(doc.getMap('META').get('replicationEpoch')).toBe(Number.MAX_SAFE_INTEGER); // 不回绕
    expect(doc.getMap('META').get('replicationId')).toBe(id0);
  });
});

// ════════════════════════ 共享 gate（E1/E2）双入口等价性 ════════════════════════

/**
 * 共享 gate 专用 fixture（设计 §5.3 / SA2 R1 #4）：可控 getStatus / notifier 计数 +
 * 通知时刻 META 快照（观察到 E5 后已提交值）。不 mock 语义——计数与状态注入仅用于
 * 锁定访问纪律与短路顺序。
 */
function makeGateRuntime(
  doc: Y.Doc,
  opts: {
    /** getStatus 行为（缺省恒 'ready'）；构造期/观测期计数一并计入 statusCalls。 */
    status?: () => DocHandleStatus;
    /** null → 不绑定 notifyDirty（notifier absent 通道）；缺省为计数 notifier。 */
    notifyDirty?: (() => Promise<void>) | null;
  } = {},
): {
  runtime: NamespaceRuntime;
  statusCalls: () => number;
  notifyCalls: () => number;
  notifyMeta: () => { id: unknown; epoch: unknown };
} {
  let statusCount = 0;
  let notifies = 0;
  const seen: Array<{ id: unknown; epoch: unknown }> = [];
  const statusFn = opts.status ?? (() => 'ready' as const);
  const handle = {
    owner: OWNER,
    docId: 'ns-1',
    doc,
    getStatus: () => {
      statusCount += 1;
      return statusFn();
    },
    release: async () => {},
  } as unknown as DocHandle;
  const notifyDirty =
    opts.notifyDirty === null
      ? undefined
      : async (): Promise<void> => {
          notifies += 1;
          const meta = doc.getMap('META');
          seen.push({ id: meta.get('replicationId'), epoch: meta.get('replicationEpoch') });
          if (opts.notifyDirty !== undefined && opts.notifyDirty !== null) await opts.notifyDirty();
        };
  const runtime = createNamespaceRuntimeWithSeam({
    handle,
    ...(notifyDirty === undefined ? {} : { notifyDirty }),
  });
  return {
    runtime,
    statusCalls: () => statusCount,
    notifyCalls: () => notifies,
    notifyMeta: () => seen[seen.length - 1] ?? { id: undefined, epoch: undefined },
  };
}

/** hostile enable input：'replicationId' 属性读计数 + 合法值——探测 gate 是否提前触发
 *  E3-only 输入（fatal/non-ready/throw/absent 各拒绝路径必须零读取）。 */
function hostileInputFixture(): { input: unknown; reads: () => number } {
  let reads = 0;
  const proxy = new Proxy(
    { replicationId: 'a'.repeat(32) },
    {
      get(target, key, receiver) {
        if (key === 'replicationId') reads += 1;
        return Reflect.get(target, key, receiver);
      },
    },
  );
  return { input: proxy, reads: () => reads };
}

describe('共享 gate（E1/E2）：双入口短路顺序与访问纪律（设计 §5.3 / SA2 R1 #4）', () => {
  it('fatal 已置位：enable/bump 均零访问 getStatus、零调用 notifier；enable hostile input 零读取（E1 短路于一切）', async () => {
    const doc = makeDoc();
    const fx = makeGateRuntime(doc);
    await readyOf(fx.runtime);

    // 制造 fatal（E4 损坏：恰一键存在 → write-slot-internal committed:false；
    // 该造态调用自身过 E1/E2——此后 state.fatal 置位，方可测 E1 短路）
    doc.getMap('META').set('replicationId', 'f'.repeat(32));
    const fatalSeed = await settleOf(enableOf(fx.runtime, { replicationId: 'd'.repeat(32) }));
    expect(fatalSeed.kind).toBe('rejected');
    if (fatalSeed.kind !== 'rejected') return;
    expect((fatalSeed.reason as RuntimeWriteFatalError).committed).toBe(false);
    expect(fx.runtime.getStatus().fatal?.code).toBe('NSRT-FATAL-REPLICATION-WRITE-INTERNAL');

    // enable：E1 短路——getStatus/notifier/input 全部零接触
    let s = fx.statusCalls();
    let n = fx.notifyCalls();
    const hostile = hostileInputFixture();
    const settled = await settleOf(enableOf(fx.runtime, hostile.input));
    expect(settled.kind).toBe('resolved');
    if (settled.kind !== 'resolved') return;
    const result = settled.value as { ok: boolean; issues?: unknown[] };
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).toContain('RUNTIME_WRITE_DISABLED');
    expect(hostile.reads()).toBe(0); // E3-only 输入零读取
    expect(fx.statusCalls() - s).toBe(0); // getStatus 零访问
    expect(fx.notifyCalls()).toBe(n); // notifier 零调用
    expect(doc.getMap('META').has('replicationEpoch')).toBe(false); // META 零新写
    expect(doc.getMap('META').get('replicationId')).toBe('f'.repeat(32));

    // bump：同短路（无输入面）
    s = fx.statusCalls();
    n = fx.notifyCalls();
    const bump = await settleOf(fx.runtime.bumpReplicationEpoch());
    expect(bump.kind).toBe('resolved');
    if (bump.kind !== 'resolved') return;
    expect((bump.value as { ok: boolean }).ok).toBe(false);
    expect(JSON.stringify(bump.value)).toContain('RUNTIME_WRITE_DISABLED');
    expect(fx.statusCalls() - s).toBe(0);
    expect(fx.notifyCalls()).toBe(n);
    expect(doc.getMap('META').has('replicationEpoch')).toBe(false);
  });

  it('non-ready（persistence-degraded）：getStatus 恰一次、notifier 零访问；enable hostile input 零读取、bump 保持零输入面', async () => {
    const doc = makeDoc();
    const fx = makeGateRuntime(doc, { status: () => 'persistence-degraded' });
    await readyOf(fx.runtime); // P0 与 handle 状态无关，schema 照常 ready

    let s = fx.statusCalls();
    let n = fx.notifyCalls();
    const hostile = hostileInputFixture();
    const settled = await settleOf(enableOf(fx.runtime, hostile.input));
    expect(settled.kind).toBe('resolved');
    if (settled.kind !== 'resolved') return;
    const result = settled.value as { ok: boolean; issues?: unknown[] };
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).toContain('RUNTIME_WRITE_DISABLED');
    expect(fx.statusCalls() - s).toBe(1); // E2 恰一次瞬时观察
    expect(fx.notifyCalls()).toBe(n); // notifier 零访问（notifier 检查在非 ready 之后短路）
    expect(hostile.reads()).toBe(0); // 输入不进 E3
    expect(doc.getMap('META').has('replicationId')).toBe(false);
    expect(doc.getMap('META').has('replicationEpoch')).toBe(false);

    s = fx.statusCalls();
    n = fx.notifyCalls();
    const bump = await settleOf(fx.runtime.bumpReplicationEpoch());
    expect(bump.kind).toBe('resolved');
    if (bump.kind !== 'resolved') return;
    expect((bump.value as { ok: boolean }).ok).toBe(false);
    expect(JSON.stringify(bump.value)).toContain('RUNTIME_WRITE_DISABLED');
    expect(fx.statusCalls() - s).toBe(1);
    expect(fx.notifyCalls()).toBe(n);
    expect(doc.getMap('META').has('replicationEpoch')).toBe(false);
  });

  it('getStatus throw：enable/bump 双入口均 branded RuntimeWriteFatalError（write-slot-internal、committed:false）而非结果联合/裸异常；notifier 零访问；enable hostile input 零读取', async () => {
    // —— enable 入口（独立 Runtime fixture）——
    {
      const doc = makeDoc();
      let throwMode = false;
      const fx = makeGateRuntime(doc, {
        status: () => {
          if (throwMode) throw new Error('adapter getStatus boom (deterministic)');
          return 'ready';
        },
      });
      await readyOf(fx.runtime);
      throwMode = true; // 构造/P0 期已过——此后槽内 E2 的 getStatus 抛（adapter bug）

      let s = fx.statusCalls();
      let n = fx.notifyCalls();
      const hostile = hostileInputFixture();
      const settled = await settleOf(enableOf(fx.runtime, hostile.input));
      expect(settled.kind).toBe('rejected'); // 绝不 resolve 结果联合、也绝非原始 TypeError
      if (settled.kind !== 'rejected') return;
      const fatal = settled.reason;
      expect(fatal).toBeInstanceOf(RuntimeWriteFatalError);
      const f = fatal as RuntimeWriteFatalError;
      expect(f.phase).toBe('write-slot-internal');
      expect(f.committed).toBe(false); // 尚零 doc 写
      expect(hostile.reads()).toBe(0);
      expect(fx.notifyCalls()).toBe(n); // notifier 零访问/零调用
      expect(fx.statusCalls() - s).toBe(1); // E2 恰一次（throw 发生处）
      expect(doc.getMap('META').has('replicationId')).toBe(false); // META 零写

      // 恢复观察面（fatal 后 status 仍可读——读取保留）
      throwMode = false;
      expect(fx.runtime.getStatus().fatal?.code).toBe('NSRT-FATAL-REPLICATION-WRITE-INTERNAL');
    }

    // —— bump 入口（独立 Runtime fixture；bump 无输入面）——
    {
      const doc = makeDoc();
      let throwMode = false;
      const fx = makeGateRuntime(doc, {
        status: () => {
          if (throwMode) throw new Error('adapter getStatus boom (deterministic)');
          return 'ready';
        },
      });
      await readyOf(fx.runtime);
      throwMode = true;

      let s = fx.statusCalls();
      let n = fx.notifyCalls();
      const settled = await settleOf(fx.runtime.bumpReplicationEpoch());
      expect(settled.kind).toBe('rejected');
      if (settled.kind !== 'rejected') return;
      expect(settled.reason).toBeInstanceOf(RuntimeWriteFatalError);
      const f = settled.reason as RuntimeWriteFatalError;
      expect(f.phase).toBe('write-slot-internal');
      expect(f.committed).toBe(false);
      expect(fx.notifyCalls()).toBe(n); // notifier 零访问/零调用
      expect(fx.statusCalls() - s).toBe(1); // E2 恰一次（throw 发生处）
      expect(doc.getMap('META').has('replicationEpoch')).toBe(false); // META 零写
    }
  });

  it('notifier 未绑定：getStatus 恰一次后拒绝；enable input 不进入 E3、bump 保持零输入面', async () => {
    const doc = makeDoc();
    const fx = makeGateRuntime(doc, { notifyDirty: null }); // 未绑定（构造方义务 loud gate）
    await readyOf(fx.runtime);

    let s = fx.statusCalls();
    const hostile = hostileInputFixture();
    const settled = await settleOf(enableOf(fx.runtime, hostile.input));
    expect(settled.kind).toBe('resolved');
    if (settled.kind !== 'resolved') return;
    const result = settled.value as { ok: boolean; issues?: unknown[] };
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).toContain('RUNTIME_WRITE_DISABLED');
    expect(JSON.stringify(result)).toContain('notifyDirty 未绑定');
    expect(fx.statusCalls() - s).toBe(1); // E2 恰一次
    expect(hostile.reads()).toBe(0); // enable input 不进 E3
    expect(doc.getMap('META').has('replicationId')).toBe(false);

    s = fx.statusCalls();
    const bump = await settleOf(fx.runtime.bumpReplicationEpoch());
    expect(bump.kind).toBe('resolved');
    if (bump.kind !== 'resolved') return;
    expect((bump.value as { ok: boolean }).ok).toBe(false);
    expect(JSON.stringify(bump.value)).toContain('RUNTIME_WRITE_DISABLED');
    expect(fx.statusCalls() - s).toBe(1);
    expect(doc.getMap('META').has('replicationEpoch')).toBe(false);
  });

  it('成功路径：getStatus 恰一次；enable 仅在 gate-ready 后读取 hostile input 恰一次（进 E3）；bump 零输入面；两入口 notifier 均在 E5 后恰一次（通知时刻 META 已提交）', async () => {
    const doc = makeDoc();
    const fx = makeGateRuntime(doc);
    await readyOf(fx.runtime);

    let s = fx.statusCalls();
    let n = fx.notifyCalls();
    const hostile = hostileInputFixture();
    const enabled = await enableOf(fx.runtime, hostile.input);
    expect((enabled as { ok: boolean }).ok).toBe(true);
    expect(fx.statusCalls() - s).toBe(1); // E2 恰一次
    expect(hostile.reads()).toBe(1); // E3 单读捕获恰一次——gate 之后才读取 E3-only 输入
    expect(fx.notifyCalls()).toBe(n + 1); // E6 恰一次
    const id0 = doc.getMap('META').get('replicationId') as string;
    expect(fx.notifyMeta().id).toBe(id0); // 通知时刻 META 已提交（E5 之后才通知）
    expect(fx.notifyMeta().epoch).toBe(1);

    // bump：无输入参数（零输入读取面是结构事实）；E2 恰一次、notifier 在 E5 后恰一次
    s = fx.statusCalls();
    n = fx.notifyCalls();
    const bumped = await fx.runtime.bumpReplicationEpoch();
    expect((bumped as { ok: boolean }).ok).toBe(true);
    expect(fx.statusCalls() - s).toBe(1);
    expect(fx.notifyCalls()).toBe(n + 1);
    expect(fx.notifyMeta().id).toBe(id0); // 身份不变
    expect(fx.notifyMeta().epoch).toBe(2); // bump 通知时刻已提交 epoch 2
    expect(fx.runtime.getStatus().replication).toEqual({
      state: 'enabled',
      replicationId: id0,
      replicationEpoch: 2,
    });
  });
});
