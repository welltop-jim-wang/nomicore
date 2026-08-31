/**
 * SA3-owned 包内测试 — issue #134（Phase 5 切片 3/4：expose trusted ReplicationSession）
 * 会话核心单元/槽级锚（设计 wiki/raw/task_namespace-lease-replication-session_design.md
 * §9.1 T-1..T-8 + 包内单元锚：open 门序/fanout 隔离/origin 谓词逐项/R 门序短路/
 * gate 访问计数）。
 *
 * 驱动面：全部经包内 seam `createNamespaceRuntimeWithSeam` 直构（真实 Y.Doc/P0/编译，
 * 仅 handle/notifyDirty/p0Gate 受控——沿 runtime-replication-write.test.ts 先例）+
 * 相对通道消费 `openReplicationSessionCoreForRegistry`（../src/replication-session.js）
 * 直取 core——不依赖 registry 层；SA2 R2 §5 注记：runtime 包内不 import
 * @nomicore/namespace-registry（依赖方向禁止——跨包真锁在 lease.ts src Equal 断言）。
 *
 * 确定性 Yjs 纪律（SA6 §7.2）：远端 update 以 live doc 全量状态 bootstrap 独立 Y.Doc
 * 后仅写**新键**（并发键胜者按随机 clientID 决胜）；快照重放同 clientID 无冲突。
 *
 * Round-2 加严（评审项 10 允许范围，仅此一档）：fanout listener 直存 callback 原始
 * 参数（不先 slice）并断言每投递数组独立且 buffer 不共享——断言语义不变（更强）。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { DocHandle, DocHandleStatus, User } from '@nomicore/persistence';
import { RuntimeWriteFatalError } from '../src/index.js';
import type { NamespaceRuntime } from '../src/index.js';
import { createNamespaceRuntimeWithSeam } from '../src/runtime.js';
import {
  openReplicationSessionCoreForRegistry,
} from '../src/replication-session.js';
import type {
  RuntimeReplicationSessionApplyResult,
  RuntimeReplicationSessionCore,
  RuntimeReplicationSessionStatus,
} from '../src/replication-session.js';

// ─────────────────────────────── fixture ───────────────────────────────

const OWNER: User = { userId: 'u-alice' };
const TEXT_VALID =
  'type ROOT = { n: number; a?: string; ext?: number; k1?: number; k2?: number; k3?: number; };\n';
const ENVELOPE = { lang: 'vfsl', version: 1, id: 'ns-1', text: TEXT_VALID } as const;
const REP_ID = 'a'.repeat(32);

/** 种子文档：SCHEMA 信封 + META（docId/createdAt + 可选复制保留字段——预启用场景）。 */
function seedDoc(opts: { epoch?: number; enabled?: boolean } = {}): Y.Doc {
  const doc = new Y.Doc();
  const sc = doc.getMap('SCHEMA');
  for (const [k, v] of Object.entries(ENVELOPE)) sc.set(k, v);
  const meta = doc.getMap('META');
  meta.set('docId', 'ns-1');
  meta.set('createdAt', 1_700_000_123_456);
  if (opts.enabled !== false) {
    meta.set('replicationId', REP_ID);
    meta.set('replicationEpoch', opts.epoch ?? 1);
  }
  doc.getMap('ROOT').set('n', 1);
  return doc;
}

interface RuntimeHarness {
  readonly runtime: NamespaceRuntime;
  notifyCount(): number;
  statusCount(): number;
  setStatus(f: () => DocHandleStatus): void;
}

/** 直构 runtime（真实 Y.Doc/P0/编译；notifyDirty/handleStatus/p0Gate 均受控）。 */
function makeRuntime(
  doc: Y.Doc,
  opts: {
    bindNotify?: boolean;
    notifyDirty?: () => Promise<void>;
    p0Gate?: Promise<void>;
    handleStatusOverride?: () => DocHandleStatus | undefined;
  } = {},
): RuntimeHarness {
  let notifyCount = 0;
  let statusCount = 0;
  let statusFn: () => DocHandleStatus | undefined = opts.handleStatusOverride ?? (() => undefined);
  const notifyDirty = opts.bindNotify === false ? undefined : async () => {
    notifyCount += 1;
    if (opts.notifyDirty !== undefined) await opts.notifyDirty();
  };
  const handle = {
    owner: OWNER,
    docId: 'ns-1',
    doc,
    getStatus: () => {
      statusCount += 1;
      return statusFn() ?? 'ready';
    },
    release: async () => {},
  } as unknown as DocHandle;
  const runtime = createNamespaceRuntimeWithSeam({
    handle,
    ...(notifyDirty !== undefined ? { notifyDirty } : {}),
    ...(opts.p0Gate !== undefined ? { p0Gate: opts.p0Gate } : {}),
  });
  return {
    runtime,
    notifyCount: () => notifyCount,
    statusCount: () => statusCount,
    setStatus: (f) => {
      statusFn = f;
    },
  };
}

async function readyOf(runtime: NamespaceRuntime): Promise<void> {
  await expect.poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 }).toBe('ready');
}

function openSession(
  runtime: NamespaceRuntime,
  role: 'hub' | 'peer' = 'hub',
  remoteInstanceId = 'peer-a',
): RuntimeReplicationSessionCore {
  const opened = openReplicationSessionCoreForRegistry(runtime, { localRole: role, remoteInstanceId });
  if (!opened.ok) throw new Error(`open 应成功，实际 ${JSON.stringify(opened)}`);
  return opened.core;
}

/** 生成「远端实例状态更新」：live 全量 bootstrap + 新键写入（零并发冲突——确定性）。 */
function makeRemoteUpdate(
  liveDoc: Y.Doc,
  mutate: (doc: Y.Doc) => void,
): { update: Uint8Array; replica: Y.Doc } {
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(liveDoc));
  mutate(peer);
  return { update: Y.encodeStateAsUpdate(peer), replica: peer };
}

type Settled = { kind: 'resolved'; value: unknown } | { kind: 'rejected'; reason: unknown };

async function settleOf(p: Promise<unknown>): Promise<Settled> {
  try {
    return { kind: 'resolved', value: await p };
  } catch (reason) {
    return { kind: 'rejected', reason };
  }
}

async function flushMicrotasks(budget = 60): Promise<void> {
  for (let i = 0; i < budget; i += 1) await Promise.resolve();
}

/** settle 收编 → resolve 值（非 resolved 返回 undefined）。 */
function settledValue(s: Settled): unknown {
  return s.kind === 'resolved' ? s.value : undefined;
}

function settledOk(s: Settled): boolean {
  return s.kind === 'resolved' && (s.value as { ok?: unknown }).ok === true;
}

/** apply 结果断言助手：resolved ok:false + 指定 code。 */
function expectRefusal(settled: Settled, code: string): void {
  expect(settled.kind, `期望 resolved（拒绝经返回 Promise 结算），实际 ${settled.kind}`).toBe('resolved');
  if (settled.kind !== 'resolved') throw new Error('unreachable');
  const v = settled.value as { ok?: unknown; code?: unknown; message?: unknown };
  expect(v.ok).toBe(false);
  expect(v.code).toBe(code);
  expect(typeof v.message).toBe('string');
  expect(JSON.stringify(v)).toContain(code);
}

// ─────────────────────────────── 类型锁面（T-1） ───────────────────────────────

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;
type AssertTrue<T extends true> = T;

/** 公共十键形状副本（§3.1 字面形状——不跨包 import registry；双向自锁冗余防线；
 *  跨包真锁 = registry lease.ts src Equal 断言（SA2 R2 §5 推荐路径 (a)）。 */
type PublicCoreShape = {
  readonly localRole: 'hub' | 'peer';
  readonly remoteInstanceId: string;
  readonly replicationId: string;
  readonly replicationEpoch: number;
  encodeStateVector(): Uint8Array;
  encodeDiff(remoteStateVector: Uint8Array): Uint8Array;
  subscribeOwnedUpdates(listener: (update: Uint8Array) => void): () => void;
  applyRemoteUpdate(update: Uint8Array): Promise<RuntimeReplicationSessionApplyResult>;
  getStatus(): Readonly<RuntimeReplicationSessionStatus>;
  close(): Promise<void>;
};

type PublicStatusShape = {
  readonly state: 'open' | 'closed' | 'conflicted';
  readonly closedBy?: 'explicit-close' | 'runtime-close';
  readonly localRole: 'hub' | 'peer';
  readonly direction: 'hub-to-peer' | 'peer-to-hub';
  readonly remoteInstanceId: string;
  readonly replicationId: string;
  readonly replicationEpoch: number;
  readonly currentEpoch: number;
  readonly rootValidation: 'none' | 'replication-unvalidated';
  readonly durability: Readonly<{ readonly memoryCaughtUp: boolean; readonly diskCaughtUp: false }>;
  readonly observerFailures: number;
  /** R2-3（F-1）：fanout 投递队列溢出标记——status 第 11 字段（sticky、继续投递）。 */
  readonly needsResync: boolean;
};

// ─────────────────────────────── open 门序单元锚 ───────────────────────────────

describe('open 门序（host 缺席→lifecycle→fatal→disabled→冻结建 core；零 schema gate）', () => {
  it('disabled 命名空间 open → REPLICATION_NOT_ENABLED（O-7 稳定拒绝）；enable 后 open 成功', async () => {
    const doc = seedDoc({ enabled: false });
    const { runtime, notifyCount } = makeRuntime(doc);
    await readyOf(runtime);
    const opened = openReplicationSessionCoreForRegistry(runtime, {
      localRole: 'hub',
      remoteInstanceId: 'peer-a',
    });
    expect(opened.ok).toBe(false);
    if (!opened.ok) {
      expect(opened.code).toBe('REPLICATION_NOT_ENABLED');
      expect(opened.message).toContain('REPLICATION_NOT_ENABLED');
    }
    // enable 后（同一 runtime）open 成功
    expect((await runtime.enableReplication({ replicationId: REP_ID })).ok).toBe(true);
    expect(notifyCount()).toBe(1);
    expect(openSession(runtime, 'hub').replicationEpoch).toBe(1);
  });

  it('host 缺席（非 runtime.ts 构造的替身 Runtime）→ REPLICATION_SESSION_UNSUPPORTED（显式能力缺席）', () => {
    const fake = { getStatus: () => ({}) } as unknown as NamespaceRuntime;
    const opened = openReplicationSessionCoreForRegistry(fake, {
      localRole: 'hub',
      remoteInstanceId: 'peer-a',
    });
    expect(opened.ok).toBe(false);
    if (!opened.ok) {
      expect(opened.code).toBe('REPLICATION_SESSION_UNSUPPORTED');
      expect(opened.message).toContain('REPLICATION_SESSION_UNSUPPORTED');
    }
  });

  it('Runtime close 后 open → RUNTIME_WRITE_DISABLED（lifecycle 门）；随时序早于 disabled 检查', async () => {
    const { runtime } = makeRuntime(seedDoc());
    await readyOf(runtime);
    await runtime.close();
    const opened = openReplicationSessionCoreForRegistry(runtime, {
      localRole: 'hub',
      remoteInstanceId: 'peer-a',
    });
    expect(opened.ok).toBe(false);
    if (!opened.ok) {
      expect(opened.code).toBe('RUNTIME_WRITE_DISABLED');
      expect(opened.message).toContain('RUNTIME_WRITE_DISABLED');
    }
  });

  it('direction 派生冻结：peer ⇔ hub-to-peer；hub ⇔ peer-to-hub（星型拓扑唯一对端）', async () => {
    const { runtime } = makeRuntime(seedDoc());
    await readyOf(runtime);
    const peer = openSession(runtime, 'peer', 'hub-1');
    const hub = openSession(runtime, 'hub', 'peer-a');
    expect(peer.getStatus().direction).toBe('hub-to-peer');
    expect(hub.getStatus().direction).toBe('peer-to-hub');
    expect(peer.getStatus().localRole).toBe('peer');
    expect(hub.getStatus().localRole).toBe('hub');
  });
});

// ─────────────────────────────── T-1：类型锁面 ───────────────────────────────

describe('T-1 类型锁面：Core/Status 与公共形状双向自锁（包内字面副本；跨包真锁在 lease.ts）', () => {
  it('十键/十一字段逐字段 Equal（形状漂移 → 编译期红）', () => {
    type _coreEqual = AssertTrue<Equal<RuntimeReplicationSessionCore, PublicCoreShape>>;
    type _statusEqual = AssertTrue<Equal<RuntimeReplicationSessionStatus, PublicStatusShape>>;
    const core: _coreEqual = true;
    const status: _statusEqual = true;
    expect(core).toBe(true);
    expect(status).toBe(true);
  });
});

// ─────────────────────────────── T-2：敌意子类陷阱安全 ───────────────────────────────

describe('T-2 敌意 Uint8Array 子类：陷阱安全拷贝（INV-S15；拒绝全经 Promise 结算）', () => {
  it('class EvilBytes extends Uint8Array { slice(){ throw } }：instanceof 通过、slice 同步 throw 被中性化 → resolved ok:false RAW_UPDATE_INVALID、零写入、零 notify', async () => {
    const doc = seedDoc();
    const { runtime, notifyCount } = makeRuntime(doc);
    await readyOf(runtime);
    const session = openSession(runtime, 'hub');

    class EvilBytes extends Uint8Array {
      override slice(): never {
        throw new Error('evil slice trap');
      }
    }
    // 敌意字节 = 畸形 payload（Yjs 无法解码 → scratch 预演拒；若实现误用 update.slice()
    // 则在接纳层同步 throw——本测试以「绝不同步 throw」锚定陷阱安全构造）
    const evil = new EvilBytes([0xff, 0xff, 0xde, 0xad, 0x00, 0x00, 0x00, 0x00]);
    expect(evil instanceof Uint8Array).toBe(true);

    let syncThrow: unknown;
    let applyPromise: Promise<unknown> | undefined;
    try {
      applyPromise = session.applyRemoteUpdate(evil);
    } catch (err) {
      syncThrow = err;
    }
    expect(syncThrow, '敌意子类的任何拒绝必须经返回 Promise 结算——绝不同步 throw').toBeUndefined();
    const settled = await settleOf(applyPromise as Promise<unknown>);
    expectRefusal(settled, 'REPLICATION_RAW_UPDATE_INVALID');
    expect(doc.getMap('ROOT').get('k1')).toBeUndefined(); // 零写入
    expect(doc.getMap('META').get('replicationId')).toBe(REP_ID); // 受保护域零触碰
    expect(notifyCount()).toBe(0); // saveDoc 0 次
  });

  it('非 Uint8Array 输入（string/null）：resolved ok:false RAW_UPDATE_INVALID、零写入、零 notify', async () => {
    const doc = seedDoc();
    const { runtime, notifyCount } = makeRuntime(doc);
    await readyOf(runtime);
    const session = openSession(runtime, 'hub');
    for (const bad of ['nope', null, { bytes: new Uint8Array(4) }] as Array<unknown>) {
      let syncThrow: unknown;
      let p: Promise<unknown> | undefined;
      try {
        p = session.applyRemoteUpdate(bad as Uint8Array);
      } catch (err) {
        syncThrow = err;
      }
      expect(syncThrow).toBeUndefined();
      expectRefusal(await settleOf(p as Promise<unknown>), 'REPLICATION_RAW_UPDATE_INVALID');
    }
    expect(doc.getMap('ROOT').get('k1')).toBeUndefined();
    expect(notifyCount()).toBe(0);
  });
});

// ─────────────────────────────── T-3：conflicted 终态停投 ───────────────────────────────

describe('T-3 epoch fence：conflicted 终态 + 存量订阅停止投递（共用摘除点）；新 session 照常', () => {
  it('bump 后旧 session apply 被 fence 零写入并转终态；mutateData 对存量订阅零新增投递；新 session 正常', async () => {
    const doc = seedDoc();
    const { runtime } = makeRuntime(doc);
    await readyOf(runtime);
    const session1 = openSession(runtime, 'hub', 'peer-a');
    const events1: Uint8Array[] = [];
    session1.subscribeOwnedUpdates((u) => events1.push(u));

    expect((await runtime.bumpReplicationEpoch()).ok).toBe(true); // E5.5 整替 state.replication
    const afterBump = events1.length;
    expect(afterBump).toBe(0); // R2-1（F-3）：bump 槽同步投影步主动 fence——fence 取消该
    // channel 全部未投递排队项 ⇒ bump 的 META 写（origin null，E5 已入队）零投递给旧 session
    expect(session1.replicationEpoch).toBe(1); // 冻结值不漂移（INV-S5）

    const { update } = makeRemoteUpdate(doc, (peer) => {
      peer.getMap('ROOT').set('ext', 7);
    });
    const fenced = await settleOf(session1.applyRemoteUpdate(update));
    expectRefusal(fenced, 'REPLICATION_EPOCH_CONFLICTED');
    expect(doc.getMap('ROOT').get('ext')).toBeUndefined(); // 零写入
    expect(runtime.getStatus().replication).toMatchObject({ state: 'enabled', replicationEpoch: 2 });
    const st1 = session1.getStatus();
    expect(st1.state).toBe('conflicted');
    expect(st1.currentEpoch).toBe(2); // fence 可观测
    expect(st1.replicationEpoch).toBe(1);

    // 终态停投对存量订阅成立（SA2 R1 #4：conflicted 转换处 fanout.detach）
    expect((await runtime.mutateData({ op: 'set', path: ['n'], value: 9 })).ok).toBe(true);
    await flushMicrotasks();
    expect(events1.length, 'conflicted 后存量订阅零新增投递').toBe(afterBump);

    // 对照：新 session 冻结 epoch 2 → 照常收 + 照常 apply（显式 reset/bootstrap 等价物）
    const session2 = openSession(runtime, 'hub', 'peer-b');
    expect(session2.replicationEpoch).toBe(2);
    const events2: Uint8Array[] = [];
    session2.subscribeOwnedUpdates((u) => events2.push(u));
    expect((await runtime.mutateData({ op: 'set', path: ['n'], value: 10 })).ok).toBe(true);
    await flushMicrotasks();
    expect(events2.length).toBe(1);
    expect(session2.getStatus().state).toBe('open');
    const applied = await settleOf(
      session2.applyRemoteUpdate(
        makeRemoteUpdate(doc, (peer) => {
          peer.getMap('ROOT').set('ext', 8);
        }).update,
      ),
    );
    expect(settledOk(applied)).toBe(true);
    expect(doc.getMap('ROOT').get('ext')).toBe(8);
    expect(events1.length).toBe(afterBump); // 全程 session1 零新增
  });
});

// ─────────────────────────────── T-4：close barrier 结算序 + never-reject ───────────────────────────────

describe('T-4 close barrier：apply 先 settle、close 后 settle；全路径 unhandledRejection 为 0', () => {
  it('notifyDirty 门挂起在途 apply：close 同步停接纳 + barrier 排于其后；never-reject', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      const doc = seedDoc();
      let releaseNotify: () => void = () => {};
      const notifyGate = new Promise<void>((resolve) => {
        releaseNotify = resolve;
      });
      const { runtime } = makeRuntime(doc, {
        notifyDirty: () => notifyGate, // 受控门：R6 await 挂起 → 在途 apply 悬置
      });
      await readyOf(runtime);
      const session = openSession(runtime, 'hub');

      const order: string[] = [];
      const applyPromise = session.applyRemoteUpdate(
        makeRemoteUpdate(doc, (peer) => {
          peer.getMap('ROOT').set('k1', 1);
        }).update,
      );
      void applyPromise.then(() => order.push('apply'));
      const closePromise = session.close(); // 幂等 same-promise 缓存
      const closePromise2 = session.close();
      expect(closePromise2).toBe(closePromise); // 幂等：同一 Promise 实例
      void closePromise.then(() => order.push('close'));

      await flushMicrotasks(80);
      expect(order, 'notify 门未放行前：apply 与 close 均未 settle').toEqual([]);
      expect(session.getStatus().state).toBe('closed'); // 同步段终态标记即时可观测

      releaseNotify();
      await flushMicrotasks(80);
      expect(order, 'barrier 语义：apply 先 settle、close 后 settle').toEqual(['apply', 'close']);
      expect(doc.getMap('ROOT').get('k1')).toBe(1); // 已接纳 apply 照常提交

      // 后接纳的 apply 在接纳层 A1 被拒（不入队）
      const late = await settleOf(
        session.applyRemoteUpdate(
          makeRemoteUpdate(doc, (peer) => {
            peer.getMap('ROOT').set('k2', 2);
          }).update,
        ),
      );
      expectRefusal(late, 'REPLICATION_SESSION_CLOSED');
      expect(doc.getMap('ROOT').get('k2')).toBeUndefined();

      // 终态 SV/diff 同步 throw（getter 域 throw 通道）
      expect(() => session.encodeStateVector()).toThrow();
      expect(() => session.encodeDiff(new Uint8Array([0]))).toThrow();

      // close 恒绿：Runtime close 后再 close（barrier 经 sequencer 排空）亦不 reject
      await runtime.close();
      const c3 = await settleOf(session.close());
      expect(c3.kind).toBe('resolved');
      await flushMicrotasks(40);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
    expect(unhandled, 'session.close() 全路径零 unhandled rejection（never-reject）').toHaveLength(0);
  });
});

// ─────────────────────────────── T-5：status 新鲜冻结 ───────────────────────────────

describe('T-5 getStatus 产物的新鲜度与冻结（INV-S16）', () => {
  it('每次调用全新深冻结对象；突变副本不影响后续读数', async () => {
    const { runtime } = makeRuntime(seedDoc());
    await readyOf(runtime);
    const session = openSession(runtime, 'hub');
    const s1 = session.getStatus();
    const s2 = session.getStatus();
    expect(s1).not.toBe(s2);
    expect(Object.isFrozen(s1)).toBe(true);
    expect(Object.isFrozen(s1.durability)).toBe(true);
    expect(Object.isFrozen(s2)).toBe(true);

    // 突变副本（严格模式赋值 → frozen 抛 TypeError 或 no-op——二者均不得污染后续读数）
    let threw = false;
    try {
      (s1 as unknown as { durability: { memoryCaughtUp: boolean } }).durability.memoryCaughtUp = true;
    } catch {
      threw = true;
    }
    void threw; // 冻结纪律：赋值路径被 frozen 拦截（严格模式下 throw）
    expect(session.getStatus().durability.memoryCaughtUp).toBe(false); // 后续读数不被污染
    expect(session.getStatus()).not.toBe(s1);
  });
});

// ─────────────────────────────── T-6：memoryCaughtUp 初值 ───────────────────────────────

describe('T-6 durability.memoryCaughtUp 初值冻结 false；apply 成功后置 true 不回落', () => {
  it('fresh session（未 apply）→ false；apply ok 后 → true；diskCaughtUp 字面 false', async () => {
    const doc = seedDoc();
    const { runtime } = makeRuntime(doc);
    await readyOf(runtime);
    const session = openSession(runtime, 'hub');
    const before = session.getStatus().durability;
    expect(before.memoryCaughtUp).toBe(false);
    expect(before.diskCaughtUp).toBe(false); // 结构性永不声称磁盘已追上

    const { update } = makeRemoteUpdate(doc, (peer) => {
      peer.getMap('ROOT').set('k1', 1);
    });
    expect(settledOk(await settleOf(session.applyRemoteUpdate(update)))).toBe(true);
    const after = session.getStatus().durability;
    expect(after.memoryCaughtUp).toBe(true);
    expect(after.diskCaughtUp).toBe(false);
    expect(JSON.stringify(session.getStatus())).toMatch(/memory/i); // SA6 /memory/i 锚同款判别面
  });
});

// ─────────────────────────────── T-7：敌意 SV 与非函数 listener ───────────────────────────────

describe('T-7 敌意 state vector 照实抛（可信域契约）；非函数 listener 订阅时同步 TypeError', () => {
  it('encodeDiff(畸形 SV) → Yjs 原生错误（不经结果联合）；subscribeOwnedUpdates(非函数) → 同步 TypeError', async () => {
    const { runtime } = makeRuntime(seedDoc());
    await readyOf(runtime);
    const session = openSession(runtime, 'hub');
    // 畸形 SV：照实抛（Yjs 原生错误——调用方为 Host 组装的可信 transport）
    expect(() => session.encodeDiff(new Uint8Array([0xff, 0xff, 0xde, 0xad]))).toThrow();
    // 形状门禁：非函数 listener → 订阅时同步 TypeError
    let syncThrow: unknown;
    try {
      session.subscribeOwnedUpdates(5 as never);
    } catch (err) {
      syncThrow = err;
    }
    expect(syncThrow).toBeInstanceOf(TypeError);
    // 运行期 throw 由扇出层自捕获（不断扇出、不 fatal）——见 observer 隔离测试
  });
});

// ─────────────────────────────── T-8：P0 preparing 期 open ───────────────────────────────

describe('T-8 P0 preparing 期 open 合法（无 schema gate——有意行为，防 SA3 自行加门）', () => {
  it('p0Gate 挂起期（schemaState=preparing）open 成功且 facts 诚实；P0 就绪后 apply 可用', async () => {
    let releaseP0: () => void = () => {};
    const p0Gate = new Promise<void>((resolve) => {
      releaseP0 = resolve;
    });
    const doc = seedDoc();
    const { runtime } = makeRuntime(doc, { p0Gate });
    expect(runtime.getStatus().schema.state).toBe('preparing');

    const opened = openReplicationSessionCoreForRegistry(runtime, {
      localRole: 'hub',
      remoteInstanceId: 'peer-a',
    });
    expect(opened.ok, 'preparing 期 open 必须成功（无 schemaState gate）').toBe(true);
    if (!opened.ok) throw new Error('unreachable');
    const session = opened.core;
    expect(session.getStatus().replicationId).toBe(REP_ID); // 构造期 V2.5 预投影——facts 诚实
    expect(session.getStatus().replicationEpoch).toBe(1);
    expect(session.getStatus().state).toBe('open');

    releaseP0();
    await readyOf(runtime);
    const applied = await settleOf(
      session.applyRemoteUpdate(
        makeRemoteUpdate(doc, (peer) => {
          peer.getMap('ROOT').set('k1', 1);
        }).update,
      ),
    );
    expect(settledOk(applied)).toBe(true);
    expect(doc.getMap('ROOT').get('k1')).toBe(1);
  });
});

// ─────────────────────────────── apply 门序短路（R1–R3 单元锚） ───────────────────────────────

describe('apply 门序短路：fatal / writable(含 hub 与 peer degraded 分叉) / notifier 未绑定', () => {
  it('fatal 后：apply R1 拒 RUNTIME_WRITE_DISABLED 零写入；open 同拒；读取保留', async () => {
    const doc = seedDoc();
    const { runtime } = makeRuntime(doc, {
      notifyDirty: () => Promise.reject(new Error('notify channel down (deterministic)')),
    });
    await readyOf(runtime);
    const session = openSession(runtime, 'hub');

    // 首笔 apply：notify 失败 → RuntimeWriteFatalError committed:true（R6 诚实 fatal）
    const first = await settleOf(
      session.applyRemoteUpdate(
        makeRemoteUpdate(doc, (peer) => {
          peer.getMap('ROOT').set('ext', 7);
        }).update,
      ),
    );
    expect(first.kind).toBe('rejected');
    expect(first.kind).toBe('rejected');
    if (first.kind !== 'rejected') throw new Error('unreachable');
    expect(first.reason).toBeInstanceOf(RuntimeWriteFatalError);
    expect((first.reason as RuntimeWriteFatalError).committed).toBe(true);
    expect(runtime.getStatus().fatal).not.toBeNull();
    expect(doc.getMap('ROOT').get('ext')).toBe(7); // committed:true 事实保留（INV-S12）

    // 后续 apply：R1 fatal gate → ok:false RUNTIME_WRITE_DISABLED 零写入
    const later = await settleOf(
      session.applyRemoteUpdate(
        makeRemoteUpdate(doc, (peer) => {
          peer.getMap('ROOT').set('k1', 1);
        }).update,
      ),
    );
    expectRefusal(later, 'RUNTIME_WRITE_DISABLED');
    expect(doc.getMap('ROOT').get('k1')).toBeUndefined();

    // open 同拒（open 门序 fatal 检查）
    const opened = openReplicationSessionCoreForRegistry(runtime, {
      localRole: 'hub',
      remoteInstanceId: 'peer-b',
    });
    expect(opened.ok).toBe(false);
    if (!opened.ok) expect(opened.code).toBe('RUNTIME_WRITE_DISABLED');

    // 读取保留
    expect(runtime.readData(['n'])).toMatchObject({ ok: true, value: 1 });
  });

  it('hub degraded（peer→hub 方向）：R3 拒 RUNTIME_WRITE_DISABLED 零写入；session 未终态 → SV 照常；getStatus 恰一次', async () => {
    const doc = seedDoc();
    const { runtime, statusCount, setStatus } = makeRuntime(doc);
    await readyOf(runtime);
    const session = openSession(runtime, 'hub'); // localRole hub → direction peer-to-hub
    setStatus(() => 'persistence-degraded');

    const before = statusCount();
    const applied = await settleOf(
      session.applyRemoteUpdate(
        makeRemoteUpdate(doc, (peer) => {
          peer.getMap('ROOT').set('ext', 7);
        }).update,
      ),
    );
    expectRefusal(applied, 'RUNTIME_WRITE_DISABLED');
    expect(statusCount(), 'R3 的 getStatus() 瞬时观察恰一次（短路顺序 fatal→getStatus→notifier）').toBe(before + 1);
    expect(doc.getMap('ROOT').get('ext')).toBeUndefined(); // 零写入
    expect(session.getStatus().state).toBe('open'); // 未终态
    expect(() => session.encodeStateVector()).not.toThrow(); // 读/SV 保留（O-5a）
  });

  it('peer degraded（hub→peer 方向）：bypass 放行——内存生效 + saveDoc 照常登记（#79）', async () => {
    const doc = seedDoc();
    const { runtime, notifyCount, setStatus } = makeRuntime(doc);
    await readyOf(runtime);
    const session = openSession(runtime, 'peer', 'hub-1'); // direction hub-to-peer
    setStatus(() => 'persistence-degraded');

    const applied = await settleOf(
      session.applyRemoteUpdate(
        makeRemoteUpdate(doc, (peer) => {
          peer.getMap('ROOT').set('ext', 7);
        }).update,
      ),
    );
    expect(settledOk(applied), 'degraded 期 hub→peer trusted apply 必须放行（O-1 六条件合取）').toBe(true);
    expect(doc.getMap('ROOT').get('ext')).toBe(7); // 内存已追上
    expect(notifyCount()).toBe(1); // bypass 路径仍 await notifyDirty（ADR 0010 L135）
    expect(session.getStatus().durability.memoryCaughtUp).toBe(true);
    expect(session.getStatus().durability.diskCaughtUp).toBe(false);
  });

  it('notifier 未绑定：open 成功但 apply R3 拒 RUNTIME_WRITE_DISABLED 零写入（D6.4：无绑定不得写）', async () => {
    const doc = seedDoc();
    const { runtime } = makeRuntime(doc, { bindNotify: false });
    await readyOf(runtime);
    const session = openSession(runtime, 'hub');
    const applied = await settleOf(
      session.applyRemoteUpdate(
        makeRemoteUpdate(doc, (peer) => {
          peer.getMap('ROOT').set('ext', 7);
        }).update,
      ),
    );
    expectRefusal(applied, 'RUNTIME_WRITE_DISABLED');
    expect(JSON.stringify(settledValue(applied))).toContain('notifyDirty 未绑定');
    expect(doc.getMap('ROOT').get('ext')).toBeUndefined();
  });

  it('非 ready 的 released/disposed：R3 同拒 RUNTIME_WRITE_DISABLED（handle 失效不得绕过，L136）', async () => {
    const doc = seedDoc();
    const { runtime, setStatus } = makeRuntime(doc);
    await readyOf(runtime);
    const session = openSession(runtime, 'hub');
    for (const s of ['released', 'disposed'] as const) {
      setStatus(() => s);
      const applied = await settleOf(
        session.applyRemoteUpdate(
          makeRemoteUpdate(doc, (peer) => {
            peer.getMap('ROOT').set('k1', 1);
          }).update,
        ),
      );
      expectRefusal(applied, 'RUNTIME_WRITE_DISABLED');
      expect(doc.getMap('ROOT').get('k1')).toBeUndefined();
    }
  });

  it('getStatus() adapter 违约 throw → markWriteFatal + RuntimeWriteFatalError(committed:false)；后续写全拒、读取保留', async () => {
    const doc = seedDoc();
    const { runtime, setStatus } = makeRuntime(doc);
    await readyOf(runtime);
    const session = openSession(runtime, 'hub');
    let adapterBroken = true;
    setStatus(() => {
      if (adapterBroken) throw new Error('adapter bug (deterministic)');
      return 'ready';
    });
    const applied = await settleOf(
      session.applyRemoteUpdate(
        makeRemoteUpdate(doc, (peer) => {
          peer.getMap('ROOT').set('ext', 7);
        }).update,
      ),
    );
    expect(applied.kind).toBe('rejected');
    if (applied.kind !== 'rejected') throw new Error('unreachable');
    expect(applied.reason).toBeInstanceOf(RuntimeWriteFatalError);
    expect((applied.reason as RuntimeWriteFatalError).committed).toBe(false);
    adapterBroken = false; // 状态读取面恢复（buildStatus 的 ready 期瞬时观察会调用 getStatus）
    expect(runtime.getStatus().fatal).not.toBeNull();
    expect(doc.getMap('ROOT').get('ext')).toBeUndefined();
    expect(runtime.readData(['n'])).toMatchObject({ ok: true, value: 1 });
  });

  it('lifecycle 接纳层 A3：Runtime close 后 apply 即时拒 RUNTIME_WRITE_DISABLED、零入队零写入', async () => {
    const doc = seedDoc();
    const { runtime, notifyCount } = makeRuntime(doc);
    await readyOf(runtime);
    const session = openSession(runtime, 'hub');
    await runtime.close();
    const applied = await settleOf(
      session.applyRemoteUpdate(
        makeRemoteUpdate(doc, (peer) => {
          peer.getMap('ROOT').set('ext', 7);
        }).update,
      ),
    );
    expectRefusal(applied, 'RUNTIME_WRITE_DISABLED');
    expect(JSON.stringify(settledValue(applied))).toContain('close 已停止接纳会话 apply');
    expect(notifyCount()).toBe(0);
    expect(doc.getMap('ROOT').get('ext')).toBeUndefined();
  });
});

// ─────────────────────────────── 受保护字段检查（R4 单元锚） ───────────────────────────────

describe('R4 受保护字段检查：hub 侧 SCHEMA/META 全保护；peer 侧 SCHEMA 放行、META 保护', () => {
  it('hub：SCHEMA 变更新键 → REPLICATION_PROTECTED_FIELDS_CHANGED 零写入零 notify；重复稳定', async () => {
    const doc = seedDoc();
    const { runtime, notifyCount } = makeRuntime(doc);
    await readyOf(runtime);
    const session = openSession(runtime, 'hub');
    const { update } = makeRemoteUpdate(doc, (peer) => {
      peer.getMap('SCHEMA').set('note', 'mutated-by-peer');
    });
    const r1 = await settleOf(session.applyRemoteUpdate(update));
    expectRefusal(r1, 'REPLICATION_PROTECTED_FIELDS_CHANGED');
    expect(doc.getMap('SCHEMA').get('note')).toBeUndefined(); // 零写入
    expect(doc.getMap('ROOT').get('n')).toBe(1);
    expect(notifyCount()).toBe(0);
    const r2 = await settleOf(session.applyRemoteUpdate(update));
    expectRefusal(r2, 'REPLICATION_PROTECTED_FIELDS_CHANGED'); // 拒绝行为稳定
  });

  it('hub：META.replicationId 变更 → 拒绝；保留字段不变（D-9 全键保护收紧）', async () => {
    const doc = seedDoc();
    const { runtime } = makeRuntime(doc);
    await readyOf(runtime);
    const session = openSession(runtime, 'hub');
    const { update } = makeRemoteUpdate(doc, (peer) => {
      peer.getMap('META').set('replicationId', 'f'.repeat(32));
    });
    const r = await settleOf(session.applyRemoteUpdate(update));
    expectRefusal(r, 'REPLICATION_PROTECTED_FIELDS_CHANGED');
    expect(doc.getMap('META').get('replicationId')).toBe(REP_ID);
    expect(doc.getMap('META').get('replicationEpoch')).toBe(1);
  });

  it('hub：META 其它键（createdAt）变更 → 同样拒绝（全 META 键保护——D-9 对 L105 最小集的收紧）', async () => {
    const doc = seedDoc();
    const { runtime } = makeRuntime(doc);
    await readyOf(runtime);
    const session = openSession(runtime, 'hub');
    const { update } = makeRemoteUpdate(doc, (peer) => {
      peer.getMap('META').set('createdAt', 123456789);
    });
    const r = await settleOf(session.applyRemoteUpdate(update));
    expectRefusal(r, 'REPLICATION_PROTECTED_FIELDS_CHANGED');
    expect(doc.getMap('META').get('createdAt')).toBe(1_700_000_123_456);
  });

  it('peer：SCHEMA 放行（hub→peer 单向复制）、ROOT 放行、META 仍拒（L105/L120）', async () => {
    const doc = seedDoc();
    const { runtime } = makeRuntime(doc);
    await readyOf(runtime);
    const session = openSession(runtime, 'peer', 'hub-1');
    const uSchema = makeRemoteUpdate(doc, (peer) => {
      peer.getMap('SCHEMA').set('note', 'from-hub');
    });
    expect(settledOk(await settleOf(session.applyRemoteUpdate(uSchema.update)))).toBe(true);
    expect(doc.getMap('SCHEMA').get('note')).toBe('from-hub');

    const uRoot = makeRemoteUpdate(doc, (peer) => {
      peer.getMap('ROOT').set('ext', 7);
    });
    expect(settledOk(await settleOf(session.applyRemoteUpdate(uRoot.update)))).toBe(true);
    expect(doc.getMap('ROOT').get('ext')).toBe(7);

    const uMeta = makeRemoteUpdate(doc, (peer) => {
      peer.getMap('META').set('replicationEpoch', 999);
    });
    const r3 = await settleOf(session.applyRemoteUpdate(uMeta.update));
    expectRefusal(r3, 'REPLICATION_PROTECTED_FIELDS_CHANGED');
    expect(doc.getMap('META').get('replicationEpoch')).toBe(1);
  });

  it('判据 (a) 边界：删后同值重写 = 内容未变 = 允许（零写入拒绝不触发）', async () => {
    const doc = seedDoc();
    const { runtime } = makeRuntime(doc);
    await readyOf(runtime);
    const session = openSession(runtime, 'hub');
    // peer 写 ROOT.k1=5（新键、无并发冲突——确定性），随后 mock 远端在 SCHEMA 的
    // 同值重写（内容投影相等——scratch 与 live 的 SCHEMA 全键值投影相等 ⟹ 放行）
    const first = makeRemoteUpdate(doc, (peer) => {
      peer.getMap('ROOT').set('k1', 5);
    });
    expect(settledOk(await settleOf(session.applyRemoteUpdate(first.update)))).toBe(true);
    expect(doc.getMap('ROOT').get('k1')).toBe(5);

    // 「远端重放同一 SCHEMA 内容」的等价构造：以当前 live 状态 bootstrap 远端，
    // 重写 SCHEMA.id 为同值（删除+同值重写 —— 内容投影相等 ⟹ (a) 判据放行）
    const replay = makeRemoteUpdate(doc, (peer) => {
      peer.getMap('SCHEMA').delete('id');
      peer.getMap('SCHEMA').set('id', ENVELOPE.id);
    });
    const r = await settleOf(session.applyRemoteUpdate(replay.update));
    expect(settledOk(r), '删后同值重写 = 内容未变 = 允许（判据 (a) 边界）').toBe(true);
    expect(doc.getMap('SCHEMA').get('id')).toBe(ENVELOPE.id);
  });

  it('畸形字节 → REPLICATION_RAW_UPDATE_INVALID（scratch 预演兼畸形过滤器；live 零触碰）', async () => {
    const doc = seedDoc();
    const { runtime, notifyCount } = makeRuntime(doc);
    await readyOf(runtime);
    const session = openSession(runtime, 'hub');
    const r = await settleOf(session.applyRemoteUpdate(new Uint8Array([0xff, 0xff, 0xde, 0xad])));
    expectRefusal(r, 'REPLICATION_RAW_UPDATE_INVALID');
    expect(doc.getMap('ROOT').get('n')).toBe(1);
    expect(notifyCount()).toBe(0);
  });
});

// ─────────────────────────────── fanout 隔离 / 回声抑制 / observer 隔离 ───────────────────────────────

describe('fanout 扇出：多 channel 广播；apply 源 origin 回声抑制；字节副本；observer 抛错隔离', () => {
  it('本地业务写投全部 channel；apply@A 源抑制（A 不收、B 收）；投递字节为独立副本', async () => {
    const doc = seedDoc();
    const { runtime } = makeRuntime(doc);
    await readyOf(runtime);
    const sessionA = openSession(runtime, 'hub', 'peer-a');
    const sessionB = openSession(runtime, 'hub', 'peer-b');
    const eventsA: Uint8Array[] = [];
    const eventsB: Uint8Array[] = [];
    sessionA.subscribeOwnedUpdates((u) => eventsA.push(u)); // R2-10 加严：直存原始参数
    sessionB.subscribeOwnedUpdates((u) => eventsB.push(u));

    // 1) 本地业务写（origin null）→ 两个 channel 均投递
    expect((await runtime.mutateData({ op: 'set', path: ['n'], value: 7 })).ok).toBe(true);
    await flushMicrotasks();
    expect(eventsA.length).toBe(1);
    expect(eventsB.length).toBe(1);
    expect(eventsA[0]).toBeDefined();
    // R2-10 加严：数组互异 + 全幅独立 buffer（byteOffset=0、length=全幅、buffer 不共享）
    expect(eventsA[0]).not.toBe(eventsB[0]);
    expect((eventsA[0] as Uint8Array).byteOffset).toBe(0);
    expect((eventsA[0] as Uint8Array).length).toBe((eventsA[0] as Uint8Array).buffer.byteLength);
    expect((eventsA[0] as Uint8Array).buffer).not.toBe((eventsB[0] as Uint8Array).buffer);

    // 2) apply@A（源 origin = A token）→ A 回声抑制、B 照常收
    const { update } = makeRemoteUpdate(doc, (peer) => {
      peer.getMap('ROOT').set('ext', 7);
    });
    expect(settledOk(await settleOf(sessionA.applyRemoteUpdate(update)))).toBe(true);
    await flushMicrotasks();
    expect(eventsA.length).toBe(1); // 排除源 origin
    expect(eventsB.length).toBe(2);
    // R2-10 加严：同一 session 的相邻投递 buffer 亦不共享
    expect((eventsB[0] as Uint8Array).buffer).not.toBe((eventsB[1] as Uint8Array).buffer);

    // 3) 字节不可变：突变已交付副本不影响 live doc 与后续投递
    const delivered = eventsB[1] as Uint8Array;
    delivered.fill(0xff);
    expect(doc.getMap('ROOT').get('ext')).toBe(7);
    expect((await runtime.mutateData({ op: 'set', path: ['n'], value: 8 })).ok).toBe(true);
    await flushMicrotasks();
    expect(eventsB.length).toBe(3);
    expect(eventsA.length).toBe(2); // 后续本地写继续投给 A（扇出未被破坏）
  });

  it('observer 抛错：事务不回滚、Runtime 不 fatal、其他 session 扇出不受影响、observerFailures 计数', async () => {
    const doc = seedDoc();
    const { runtime } = makeRuntime(doc);
    await readyOf(runtime);
    const sessionA = openSession(runtime, 'hub', 'peer-a');
    const sessionB = openSession(runtime, 'hub', 'peer-b');
    const eventsB: Uint8Array[] = [];
    sessionA.subscribeOwnedUpdates(() => {
      throw new Error('observer channel down (deterministic)');
    });
    sessionB.subscribeOwnedUpdates((u) => eventsB.push(u));

    expect((await runtime.mutateData({ op: 'set', path: ['n'], value: 5 })).ok).toBe(true);
    await flushMicrotasks();
    expect(runtime.getStatus().fatal).toBeNull(); // 不使 Runtime fatal（T-2 和解）
    expect(doc.getMap('ROOT').get('n')).toBe(5); // 已提交事务不被 observer 拖垮
    expect(eventsB.length).toBe(1); // 其他 session 不受失败 observer 阻断
    expect(sessionA.getStatus().observerFailures).toBe(1); // 自捕获计数（ADR 0007 L54「记录」面）

    expect((await runtime.mutateData({ op: 'set', path: ['n'], value: 6 })).ok).toBe(true);
    await flushMicrotasks();
    expect(eventsB.length).toBe(2);
    expect(sessionA.getStatus().observerFailures).toBe(2); // 无界纯计数、不熔断（O-10 显式选择）
    expect(runtime.getStatus().fatal).toBeNull();
  });

  it('unsubscribe 后不再投递；终态 session（close 后）订阅为 no-op 永不投递', async () => {
    const doc = seedDoc();
    const { runtime } = makeRuntime(doc);
    await readyOf(runtime);
    const session = openSession(runtime, 'hub');
    const received: Uint8Array[] = [];
    const unsubscribe = session.subscribeOwnedUpdates((u) => received.push(u));
    expect((await runtime.mutateData({ op: 'set', path: ['n'], value: 9 })).ok).toBe(true);
    await flushMicrotasks();
    expect(received.length).toBe(1);
    unsubscribe();
    expect((await runtime.mutateData({ op: 'set', path: ['n'], value: 10 })).ok).toBe(true);
    await flushMicrotasks();
    expect(received.length).toBe(1); // unsubscribe 后不再投递

    await session.close();
    const noop = session.subscribeOwnedUpdates((u) => received.push(u));
    expect((await runtime.mutateData({ op: 'set', path: ['n'], value: 11 })).ok).toBe(true);
    await flushMicrotasks();
    expect(received.length).toBe(1); // no-op 订阅永不投递
    noop(); // 幂等无害
  });
});

// ─────────────────────────────── 共享唯一 FIFO（AC-3 包内锚） ───────────────────────────────

describe('唯一 sequencer：apply 与业务写共享严格 FIFO；dirty 先于 resolve', () => {
  it('提交序 [applyA, write, applyB]：settle 序逐槽累计；apply A resolve 时其 dirty 已完成', async () => {
    const doc = seedDoc();
    const { runtime } = makeRuntime(doc);
    await readyOf(runtime);
    const session = openSession(runtime, 'hub');
    const { update: uA } = makeRemoteUpdate(doc, (peer) => {
      peer.getMap('ROOT').set('k1', 1);
    });
    const { update: uB } = makeRemoteUpdate(doc, (peer) => {
      peer.getMap('ROOT').set('k2', 2);
    });
    const order: string[] = [];
    const pA = session.applyRemoteUpdate(uA).then((r) => {
      order.push('applyA');
      return r;
    });
    const pW = runtime.mutateData({ op: 'set', path: ['n'], value: 9 });
    void pW.then(() => order.push('write'));
    const pB = session.applyRemoteUpdate(uB).then((r) => {
      order.push('applyB');
      return r;
    });
    const rA = await settleOf(pA);
    expect(settledOk(rA)).toBe(true);
    expect(order, 'apply A resolve 时 dirty 已登记（R6 先于 resolve）；业务写未至').toEqual(['applyA']);
    expect(await pW).toEqual({ ok: true });
    expect(settledOk(await settleOf(pB))).toBe(true);
    expect(order, '通知序 = 提交序 [applyA, write, applyB]（唯一 FIFO）').toEqual(['applyA', 'write', 'applyB']);
    expect(doc.getMap('ROOT').get('k1')).toBe(1);
    expect(doc.getMap('ROOT').get('k2')).toBe(2);
  });
});
