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
import type { DocHandle, User } from '@nomicore/persistence';
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
