/**
 * SA7 动态验证 — issue #133（Phase 5: bootstrap import, archive, and guarded
 * replica reset）registry 侧活链路攻击。
 *
 * 覆盖（对应 SA7 任务简报重点 1a/2/3/6/7 的 registry 编排面）：
 * - §1a 真实 MemoryPersistence + Registry 全链：create(导入)→ 业务写 → release
 *   （零-handle dirty）→ 立即 resetReplica——有限结算且归档内容含最后写入值
 *   （SA6 REG「在途写+reset」的真实持久化版）。
 * - §2 resetReplica 并发矩阵真跑（每场景 ×50 轮 + 随机微任务交错）：
 *   2a 并发 open+reset：恰两形态（open 先→lease 被强制 released；reset 先→open
 *   NOT_FOUND），无第三结局、无挂起；2b reset × import：两序各自结果面（reset 先→
 *   NOT_FOUND+import 成功；import 先→reset 成功且归档导入副本）；2c reset × shutdown
 *   并发（writeArchive 在途窗口）：双方有限结算、shutdown 幂等 same-Promise、零
 *   unhandled rejection（进程级监听）；2d 同 key 双 reset 并发：恰一成功、第二
 *   NOT_FOUND、单次归档、无挂起。
 * - §3 forceReleasing 观测面：reset 强制失效路径零 entry-idle 事件、lease-released
 *   恰等于未决 lease 数；对照组（自然 release 至零 lease）entry-idle 照发。
 * - §6 identity 守卫动态边界（registry 链）：6a enable(导入 epoch1)→bump epoch→
 *   flush 落盘→以旧 epoch reset → RESET_IDENTITY_MISMATCH + 文档完好 + open 恢复，
 *   以当前 epoch reset 成功；6b 导入后立即 reset（未 flush 窗口）：守卫读到导入
 *   字节身份。
 * - §7 registry 公共面动态守卫：实例运行时可枚举键恰六面，无 removeNamespace/
 *   deleteNamespace/closeNamespace 等禁词面。
 *
 * 真实性纪律：真实 yjs / 真实 MemoryPersistence / 真实 Registry + Runtime；
 * fault 注入仅经自定义 wrapIo（设计 §4.6 规格化面）；零 real sleep（fake scheduler
 * + advanceBy；真实异步排空用微任务 drain / setImmediate 事件栅栏）；全部竞态用例包
 * withTimeout（超时即失败，不许静默挂起）。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createMemoryPersistence } from '@nomicore/persistence';
import type {
  DocPersistence,
  PersistenceIO,
  User,
} from '@nomicore/persistence';
import { createTestScheduler, withTimeout } from '@nomicore/persistence/testing';
import type { TestScheduler } from '@nomicore/persistence/testing';
import {
  createNamespaceRegistryForTesting,
  createRegistryTestScheduler,
} from '@nomicore/namespace-registry/testing';
import type { RegistryTestScheduler } from '@nomicore/namespace-registry/testing';
import type {
  NamespaceLease,
  NamespaceOwner,
  NamespaceRegistry,
  RegistryRandomBytes,
} from '@nomicore/namespace-registry';

// ═══════════════════════════════ 基础设施 ═══════════════════════════════

const SCHEMA_ENVELOPE = Object.freeze({
  lang: 'vfsl',
  version: 1,
  id: 'phase5-sa7-bootstrap-dyn',
  text: 'type ROOT = { n: number; };\n',
});
const FIXED_MS = 1_700_000_123_456;
const ALICE: User = Object.freeze({ userId: 'u-alice' });
const BOB: NamespaceOwner = Object.freeze({ userId: 'u-bob' });
const NS_B = `ns-${'b'.repeat(32)}`;
const NS_C = `ns-${'c'.repeat(32)}`;
const ID_A = 'a'.repeat(32);

type AnyResult = Readonly<{ ok: true; lease?: NamespaceLease } | { ok: false; code: string; message: string }>;

function okLease(result: AnyResult | undefined): NamespaceLease {
  expect(result, `期望成功，实际：${JSON.stringify(result)}`).toMatchObject({ ok: true });
  const r = result as { ok: boolean; lease?: NamespaceLease };
  if (!r.ok || r.lease === undefined) throw new Error('unreachable');
  return r.lease;
}

function okIssue(result: AnyResult | undefined): { code: string } {
  expect(result, `期望领域拒绝，实际：${JSON.stringify(result)}`).toMatchObject({ ok: false });
  return result as { code: string };
}

/** 确定性 PRNG（mulberry32）：每轮随机化调用次序与微任务交错深度（复跑可再现）。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function yieldMicrotasks(count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) await Promise.resolve();
}

async function drainMacrotask(): Promise<void> {
  await new Promise<void>((resolve) => { setImmediate(resolve); });
}

function collectUnhandledRejections(): { events: unknown[]; dispose(): void } {
  const events: unknown[] = [];
  const onRejection = (reason: unknown): void => { events.push(reason); };
  process.on('unhandledRejection', onRejection);
  return {
    events,
    dispose() { process.off('unhandledRejection', onRejection); },
  };
}

function makeSeedDoc(
  docId: string,
  opts: { replicationId?: string; replicationEpoch?: number; root?: number } = {},
): Y.Doc {
  const doc = new Y.Doc();
  const sc = doc.getMap('SCHEMA');
  for (const [k, v] of Object.entries(SCHEMA_ENVELOPE)) sc.set(k, v);
  const meta = doc.getMap('META');
  meta.set('docId', docId);
  meta.set('createdAt', FIXED_MS);
  if (opts.replicationId !== undefined) meta.set('replicationId', opts.replicationId);
  if (opts.replicationEpoch !== undefined) meta.set('replicationEpoch', opts.replicationEpoch);
  doc.getMap('ROOT').set('n', opts.root ?? 42);
  return doc;
}

/** 微任务预算内等待 Runtime P0 就绪（真实 Runtime 全链确定性栅栏）。 */
async function schemaReady(lease: NamespaceLease): Promise<void> {
  for (let i = 0; i < 400; i += 1) {
    const status = lease.getStatus() as unknown as {
      lease?: string;
      runtime?: { schema?: { state?: string } };
    };
    if (status.lease === 'released') return;
    if (status.runtime?.schema?.state === 'ready') return;
    await Promise.resolve();
  }
  throw new Error(`schema 未在微观任务预算内就绪：${JSON.stringify(lease.getStatus())}`);
}

function leaseMeta(lease: NamespaceLease): Record<string, unknown> {
  return lease.getMetadata();
}

function leaseReadN(lease: NamespaceLease): unknown {
  const read = lease.readData(['n']) as { ok?: boolean; value?: unknown };
  expect(read.ok, `期望读取成功，实际：${JSON.stringify(read)}`).toBe(true);
  return read.value;
}

// ═══════════════════════════════ io 探针（自定义 wrapIo，设计 §4.6 规格化面） ═══════════════════════════════

interface HoldGate {
  readonly entered: Promise<void>;
  release(): void;
}

interface IoProbe {
  readonly archiveWrites: Array<{ key: string; bytes: Uint8Array }>;
  readonly removes: string[];
  holdAfterArchiveCommit(): HoldGate;
  wrap(io: PersistenceIO): PersistenceIO;
}

function makeIoProbe(): IoProbe {
  const archiveWrites: Array<{ key: string; bytes: Uint8Array }> = [];
  const removes: string[] = [];
  let archiveHold: { resolveEntered: () => void; gate: Promise<void> } | undefined;

  function armHold(): HoldGate & { gate: Promise<void>; resolveEntered: () => void } {
    let resolveEntered!: () => void;
    const entered = new Promise<void>((resolve) => { resolveEntered = resolve });
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => { releaseGate = resolve });
    return { entered, gate, resolveEntered, release: releaseGate };
  }

  return {
    archiveWrites,
    removes,
    holdAfterArchiveCommit() {
      const armed = armHold();
      archiveHold = { resolveEntered: armed.resolveEntered, gate: armed.gate };
      return { entered: armed.entered, release: armed.release };
    },
    wrap(io) {
      return {
        async read(key, signal) { return await io.read(key, signal) },
        async write(key, snapshot, signal) { await io.write(key, snapshot, signal) },
        async writeArchive(key, snapshot, signal) {
          await io.writeArchive!(key, snapshot, signal);
          archiveWrites.push({ key, bytes: snapshot.slice() });
          const held = archiveHold;
          if (held !== undefined) {
            archiveHold = undefined;
            held.resolveEntered();
            await held.gate;
          }
        },
        async remove(key, signal) {
          await io.remove!(key, signal);
          removes.push(key);
        },
      };
    },
  };
}

function decodeToDoc(bytes: Uint8Array): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, bytes);
  return doc;
}

// ═══════════════════════════════ Registry 夹具（真实 Memory + 真实 Runtime） ═══════════════════════════════

type ObserverEvent = { readonly type: string } & Record<string, unknown>;

interface RoundFixture {
  readonly registry: NamespaceRegistry;
  readonly persistence: DocPersistence;
  readonly scheduler: TestScheduler;
  readonly regScheduler: RegistryTestScheduler;
  readonly probe: IoProbe;
}

function makeCounterRandomBytes(): RegistryRandomBytes {
  let counter = 0;
  return (length: number): Uint8Array => {
    if (length !== 16) throw new Error(`受控随机源必须按 16 字节请求，实际 ${length}`);
    counter += 1;
    const hex = counter.toString(16).padStart(32, '0');
    const out = new Uint8Array(16);
    for (let i = 0; i < 16; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  };
}

function makeRoundFixture(opts: { observer?: unknown } = {}): RoundFixture {
  const scheduler = createTestScheduler();
  const probe = makeIoProbe();
  const persistence = createMemoryPersistence({
    scheduler,
    schedule: { debounceMs: 1, maxDirtyMs: 1 },
    wrapIo: probe.wrap,
  });
  const regScheduler = createRegistryTestScheduler();
  const registry = createNamespaceRegistryForTesting(persistence, {
    clock: { now: () => FIXED_MS },
    scheduler: regScheduler,
    idleTimeoutMs: 25,
    randomBytes: makeCounterRandomBytes(),
    ...(opts.observer !== undefined ? { observer: opts.observer } : {}),
  } as never);
  return { registry, persistence, scheduler, regScheduler, probe };
}

/** 种子：受信导入 identity 文档并发起 lease（真实 import 管线 + Runtime 构造）。
 *  round-2 演进（设计 §7 caller audit）：第 4 参数 = Hub 广告 expected 身份
 *  （= 文档自身身份——本测试模型的 hub 广告与文档身份一致）。 */
async function seedIdentityDoc(
  fx: RoundFixture,
  owner: NamespaceOwner = ALICE,
  docId: string = NS_B,
  opts: { replicationEpoch?: number; root?: number } = {},
): Promise<NamespaceLease> {
  const lease = okLease(await fx.registry.importReplica(owner, docId, makeSeedDoc(docId, {
    replicationId: ID_A,
    replicationEpoch: opts.replicationEpoch ?? 1,
    root: opts.root ?? 5,
  }), {
    replicationId: ID_A,
    replicationEpoch: opts.replicationEpoch ?? 1,
  }) as AnyResult | undefined);
  return lease;
}

// ═══════════════════════════════ §1a 真实 MemoryPersistence + Registry 全链 ═══════════════════════════════

describe('SA7 §1a settle 排空活性（真实 MemoryPersistence + Registry 全链）', () => {
  it('导入→业务写→release（零-handle dirty）→立即 resetReplica：有限结算且归档内容含最后写入值', { timeout: 20_000 }, async () => {
    const fx = makeRoundFixture();
    const lease = await seedIdentityDoc(fx, ALICE, NS_B, { replicationEpoch: 1, root: 5 });
    await schemaReady(lease);

    // 在途写（不 await）→ release（entry 零-handle dirty，flush 未发生）→ 立即 reset
    const writeP = lease.mutateData({ op: 'set', path: ['n'], value: 77 }) as Promise<{ ok: boolean }>;
    const releaseP = lease.release();
    const resetP = fx.registry.resetReplica(ALICE, NS_B, {
      replicationId: ID_A,
      replicationEpoch: 1,
    }) as Promise<AnyResult | undefined>;
    const [writeRes, , resetRes] = await Promise.all([
      withTimeout(writeP, 5_000, 'in-flight ROOT write to settle'),
      releaseP,
      withTimeout(resetP, 5_000, 'immediate resetReplica over zero-handle dirty entry'),
    ]);
    expect(writeRes.ok, `业务写应成功：${JSON.stringify(writeRes)}`).toBe(true);
    expect(resetRes, `reset 应成功：${JSON.stringify(resetRes)}`).toMatchObject({ ok: true });

    // 归档内容含最后写入值（真实持久化排空：settle 强制 flush 后归档终态字节）
    expect(fx.probe.archiveWrites).toHaveLength(1);
    const archived = decodeToDoc(fx.probe.archiveWrites[0]!.bytes);
    expect(archived.getMap('ROOT').get('n')).toBe(77);
    expect(archived.getMap('META').get('replicationId')).toBe(ID_A);
    expect(archived.getMap('META').get('replicationEpoch')).toBe(1);
    // 终态：主键移除 + bootstrap eligibility
    expect(fx.probe.removes).toEqual([`${ALICE.userId}\u0000${NS_B}`]);
    expect(await withTimeout(fx.persistence.loadDoc(ALICE, NS_B), 5_000, 'post-reset load')).toBeNull();
    expect(okIssue(await fx.registry.open(ALICE, NS_B) as AnyResult | undefined).code).toBe('NAMESPACE_NOT_FOUND');
    await fx.registry.shutdown();
  });
});

// ═══════════════════════════════ §2 resetReplica 并发矩阵真跑 ═══════════════════════════════

describe('SA7 §2 resetReplica 并发矩阵真跑（×50 轮 + 随机微任务交错）', () => {
  it('2a 并发 open+reset ×50：恰两形态（open 先→lease 强制 released；reset 先→open NOT_FOUND），无第三结局、无挂起', { timeout: 120_000 }, async () => {
    const rnd = mulberry32(0x5a7a_0011);
    let openFirst = 0;
    let resetFirst = 0;
    for (let round = 0; round < 50; round++) {
      const fx = makeRoundFixture();
      const seedLease = await seedIdentityDoc(fx);
      await seedLease.release();

      const openLeads = rnd() < 0.5;
      await yieldMicrotasks(Math.floor(rnd() * 4));
      const firstP = (openLeads ? fx.registry.open(ALICE, NS_B) : fx.registry.resetReplica(ALICE, NS_B, {
        replicationId: ID_A,
        replicationEpoch: 1,
      })) as Promise<AnyResult | undefined>;
      await yieldMicrotasks(Math.floor(rnd() * 4));
      const secondP = (openLeads ? fx.registry.resetReplica(ALICE, NS_B, {
        replicationId: ID_A,
        replicationEpoch: 1,
      }) : fx.registry.open(ALICE, NS_B)) as Promise<AnyResult | undefined>;

      const [first, second] = await Promise.all([
        withTimeout(firstP, 5_000, `round ${round} first op`),
        withTimeout(secondP, 5_000, `round ${round} second op`),
      ]);
      const openResult = openLeads ? first : second;
      const resetResult = openLeads ? second : first;
      expect(resetResult, `round ${round} reset 应成功：${JSON.stringify(resetResult)}`).toMatchObject({ ok: true });

      if (openResult?.ok === true) {
        // 形态一（open 先）：lease 被 reset 强制失效（released），无第三结局
        const lease = (openResult as { lease: NamespaceLease }).lease;
        expect(lease.getStatus(), `round ${round}`).toMatchObject({ lease: 'released' });
        openFirst += 1;
      } else {
        // 形态二（reset 先）：open NOT_FOUND
        expect((openResult as { code?: string }).code, `round ${round}`).toBe('NAMESPACE_NOT_FOUND');
        resetFirst += 1;
      }
      // 两序终态一致：归档恰一次、主键移除、再 open NOT_FOUND
      expect(fx.probe.archiveWrites, `round ${round} 归档恰一次`).toHaveLength(1);
      expect(await withTimeout(fx.persistence.loadDoc(ALICE, NS_B), 5_000, `round ${round} final load`)).toBeNull();
      expect(okIssue(await fx.registry.open(ALICE, NS_B) as AnyResult | undefined).code).toBe('NAMESPACE_NOT_FOUND');
    }
    expect(openFirst + resetFirst).toBe(50);
    expect(openFirst, '两种形态均应被抽到').toBeGreaterThan(0);
    expect(resetFirst, '两种形态均应被抽到').toBeGreaterThan(0);
  });

  it('2b reset × import 并发 ×50：reset 先→NOT_FOUND+import 成功；import 先→reset 成功（导入副本被归档）', { timeout: 120_000 }, async () => {
    const rnd = mulberry32(0xb00b_1e5e);
    let importFirstCount = 0;
    let resetFirstCount = 0;
    for (let round = 0; round < 50; round++) {
      const fx = makeRoundFixture(); // 全新实例：key 缺席起步（崩溃后 bootstrap 场景）
      const importLeads = rnd() < 0.5;
      const importDoc = makeSeedDoc(NS_B, { replicationId: ID_A, replicationEpoch: 2, root: 9 });
      const expected = { replicationId: ID_A, replicationEpoch: 2 };

      await yieldMicrotasks(Math.floor(rnd() * 4));
      const firstP = (importLeads
        ? fx.registry.importReplica(ALICE, NS_B, importDoc, expected)
        : fx.registry.resetReplica(ALICE, NS_B, expected)) as Promise<AnyResult | undefined>;
      await yieldMicrotasks(Math.floor(rnd() * 4));
      const secondP = (importLeads
        ? fx.registry.resetReplica(ALICE, NS_B, expected)
        : fx.registry.importReplica(ALICE, NS_B, importDoc, expected)) as Promise<AnyResult | undefined>;

      const [first, second] = await Promise.all([
        withTimeout(firstP, 5_000, `round ${round} first op`),
        withTimeout(secondP, 5_000, `round ${round} second op`),
      ]);
      const importResult = importLeads ? first : second;
      const resetResult = importLeads ? second : first;

      if (importLeads) {
        // import 先：导入成功（lease 领走）→ reset 成功归档导入副本（lease 被强制失效）
        importFirstCount += 1;
        const lease = okLease(importResult);
        expect(resetResult, `round ${round} reset 应成功：${JSON.stringify(resetResult)}`).toMatchObject({ ok: true });
        expect(lease.getStatus(), `round ${round} 导入 lease 应被 reset 强制失效`).toMatchObject({ lease: 'released' });
        expect(fx.probe.archiveWrites).toHaveLength(1);
        const archived = decodeToDoc(fx.probe.archiveWrites[0]!.bytes);
        expect(archived.getMap('ROOT').get('n')).toBe(9); // 归档内容 = 导入副本
        expect(archived.getMap('META').get('replicationEpoch')).toBe(2);
      } else {
        // reset 先：key 缺席 → NOT_FOUND（不触归档 seam）；import 成功（bootstrap）
        resetFirstCount += 1;
        expect(okIssue(resetResult).code).toBe('NAMESPACE_NOT_FOUND');
        expect(fx.probe.archiveWrites).toHaveLength(0);
        const lease = okLease(importResult);
        expect(lease.namespaceId).toBe(NS_B);
        const reopened = okLease(await fx.registry.open(ALICE, NS_B) as AnyResult | undefined);
        await reopened.release();
        await lease.release();
      }
      // 两序终态自洽：import 先 → 导入副本被归档（主键移除）；reset 先 → 导入副本存活（主键在）
      const finalLoad = await withTimeout(fx.persistence.loadDoc(ALICE, NS_B), 5_000, `round ${round} final load`);
      if (importLeads) {
        expect(finalLoad).toBeNull();
        expect(fx.probe.removes).toHaveLength(1);
      } else {
        expect(finalLoad).not.toBeNull();
        await finalLoad!.release();
        expect(fx.probe.removes).toHaveLength(0);
      }
    }
    expect(importFirstCount + resetFirstCount).toBe(50);
    expect(importFirstCount).toBeGreaterThan(0);
    expect(resetFirstCount).toBeGreaterThan(0);
  });

  it('2c reset × shutdown 并发（writeArchive 在途窗口）：双方有限结算、shutdown 幂等 same-Promise、零 unhandled rejection', { timeout: 30_000 }, async () => {
    const unhandled = collectUnhandledRejections();
    try {
      // 变体一：reset 在途（归档写挂起）→ shutdown → 关门等待 → 双方结算
      const fx = makeRoundFixture();
      const seedLease = await seedIdentityDoc(fx);
      await seedLease.release();
      const hold = fx.probe.holdAfterArchiveCommit();
      const resetP = fx.registry.resetReplica(ALICE, NS_B, {
        replicationId: ID_A,
        replicationEpoch: 1,
      }) as Promise<AnyResult | undefined>;
      void Promise.resolve(resetP).catch(() => {});
      await withTimeout(hold.entered, 5_000, 'reset archive write to enter hold');
      const shutdownP = fx.registry.shutdown();
      expect(fx.registry.getStatus()).toMatchObject({ state: 'shutting-down' }); // 同步段可观测
      hold.release();
      const [resetRes] = await Promise.all([
        withTimeout(resetP, 5_000, 'in-flight reset to settle across shutdown'),
        withTimeout(shutdownP, 5_000, 'shutdown to settle'),
      ]);
      expect(resetRes).toMatchObject({ ok: true }); // 已接纳槽按自身事实完整结算
      expect(fx.registry.shutdown()).toBe(shutdownP); // 幂等 same-Promise（AC12）
      expect(fx.registry.getStatus()).toMatchObject({ state: 'stopped' });
      expect(fx.probe.archiveWrites).toHaveLength(1);
      await drainMacrotask();
      expect(unhandled.events, '进程级零 unhandled rejection').toEqual([]);

      // 变体二：shutdown 先行 → reset 不被接纳（REGISTRY_NOT_ACCEPTING）
      const fx2 = makeRoundFixture();
      await fx2.registry.shutdown();
      const rejected = await fx2.registry.resetReplica(ALICE, NS_B, {
        replicationId: ID_A,
        replicationEpoch: 1,
      }) as AnyResult | undefined;
      expect(okIssue(rejected).code).toBe('REGISTRY_NOT_ACCEPTING');
      expect(fx2.probe.archiveWrites).toHaveLength(0);
      await drainMacrotask();
      expect(unhandled.events).toEqual([]);
    } finally {
      unhandled.dispose();
    }
  });

  it('2d 同 key 双 reset 并发 ×50：恰一成功、第二 NOT_FOUND、单次归档、无挂起', { timeout: 120_000 }, async () => {
    const rnd = mulberry32(0xd00d_2025);
    for (let round = 0; round < 50; round++) {
      const fx = makeRoundFixture();
      const seedLease = await seedIdentityDoc(fx);
      await seedLease.release();

      await yieldMicrotasks(Math.floor(rnd() * 4));
      const firstP = fx.registry.resetReplica(ALICE, NS_B, {
        replicationId: ID_A,
        replicationEpoch: 1,
      }) as Promise<AnyResult | undefined>;
      await yieldMicrotasks(Math.floor(rnd() * 4));
      const secondP = fx.registry.resetReplica(ALICE, NS_B, {
        replicationId: ID_A,
        replicationEpoch: 1,
      }) as Promise<AnyResult | undefined>;

      const [first, second] = await Promise.all([
        withTimeout(firstP, 5_000, `round ${round} first reset`),
        withTimeout(secondP, 5_000, `round ${round} second reset`),
      ]);
      // 恰一成功：先接纳者归档成功，后者见 key 缺席 → NOT_FOUND（无双重归档）
      expect(first, `round ${round} 先接纳 reset 应成功：${JSON.stringify(first)}`).toMatchObject({ ok: true });
      expect(okIssue(second).code).toBe('NAMESPACE_NOT_FOUND');
      expect(fx.probe.archiveWrites, `round ${round} 单次归档`).toHaveLength(1);
      expect(fx.probe.removes).toHaveLength(1);
      expect(await withTimeout(fx.persistence.loadDoc(ALICE, NS_B), 5_000, `round ${round} final load`)).toBeNull();
      expect(okIssue(await fx.registry.open(ALICE, NS_B) as AnyResult | undefined).code).toBe('NAMESPACE_NOT_FOUND');
    }
  });
});

// ═══════════════════════════════ §3 forceReleasing 观测面 ═══════════════════════════════

describe('SA7 §3 forceReleasing 观测面（observer 计数断言）', () => {
  it('reset 强制失效路径：零 entry-idle 事件、lease-released 恰等于未决 lease 数', { timeout: 20_000 }, async () => {
    const events: ObserverEvent[] = [];
    const observer = (event: unknown): void => { events.push(event as ObserverEvent) };
    const fx = makeRoundFixture({ observer });
    const l1 = await seedIdentityDoc(fx); // 未决 lease #1
    const l2 = okLease(await fx.registry.open(ALICE, NS_B) as AnyResult | undefined); // 未决 lease #2

    expect(events.filter((e) => e.type === 'entry-idle')).toHaveLength(0);
    const reset = await withTimeout(fx.registry.resetReplica(ALICE, NS_B, {
      replicationId: ID_A,
      replicationEpoch: 1,
    }) as Promise<AnyResult | undefined>, 5_000, 'reset with two outstanding leases');
    expect(reset).toMatchObject({ ok: true });

    // 两 lease 均被强制失效；lease-released 恰等于未决 lease 数（2）
    expect(l1.getStatus()).toMatchObject({ lease: 'released' });
    expect(l2.getStatus()).toMatchObject({ lease: 'released' });
    const released = events.filter((e) => e.type === 'lease-released');
    expect(released).toHaveLength(2);
    const remaining = released.map((e) => e.remainingLeases).sort();
    expect(remaining).toEqual([0, 1]); // 快照迭代逐个递减
    // 强制失效路径零 entry-idle（该 entry 从未进入 idle——径直 closing）
    expect(events.filter((e) => e.type === 'entry-idle')).toHaveLength(0);
    expect(events.filter((e) => e.type === 'idle-arm-failed')).toHaveLength(0);
    expect(fx.probe.archiveWrites).toHaveLength(1); // 归档照常完成
    await fx.registry.shutdown();
  });

  it('对照组（自然 release 至零 lease）：entry-idle 照发（恰一次）', { timeout: 20_000 }, async () => {
    const events: ObserverEvent[] = [];
    const observer = (event: unknown): void => { events.push(event as ObserverEvent) };
    const fx = makeRoundFixture({ observer });
    const lease = await seedIdentityDoc(fx);
    expect(events.filter((e) => e.type === 'entry-idle')).toHaveLength(0);

    await lease.release(); // 自然释放至零 lease → idle 武装 + entry-idle 事件
    expect(events.filter((e) => e.type === 'lease-released')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'entry-idle')).toHaveLength(1);

    // idle 到期 → beginIdleClose → entry 移除；entry-idle 不再增加
    await fx.regScheduler.advanceBy(25);
    expect(events.filter((e) => e.type === 'entry-idle')).toHaveLength(1);
    expect(fx.probe.archiveWrites).toHaveLength(0); // 无归档副作用
    // 主键完好：open 恢复新 generation
    const reopened = okLease(await fx.registry.open(ALICE, NS_B) as AnyResult | undefined);
    await schemaReady(reopened);
    expect(leaseReadN(reopened)).toBe(5);
    await reopened.release();
    await fx.registry.shutdown();
  });
});

// ═══════════════════════════════ §6 identity 守卫动态边界（registry 链） ═══════════════════════════════

describe('SA7 §6 identity 守卫动态边界（registry 链）', () => {
  it('6a 导入(epoch1)→bump epoch→flush 落盘→旧 epoch reset 拒绝+文档完好+open 恢复；当前 epoch reset 成功', { timeout: 30_000 }, async () => {
    const fx = makeRoundFixture();
    const lease = await seedIdentityDoc(fx, ALICE, NS_B, { replicationEpoch: 1, root: 5 });
    await schemaReady(lease);

    // 身份演进：bumpReplicationEpoch（真实写槽）→ flush 落盘（持久快照身份 = 2）
    const bump = await lease.bumpReplicationEpoch();
    expect((bump as { ok?: boolean }).ok, `bump 应成功：${JSON.stringify(bump)}`).toBe(true);
    await fx.scheduler.advanceBy(1); // flush 落盘
    await lease.release();

    // 以旧 epoch（1）reset → RESET_IDENTITY_MISMATCH + 零部分删除
    const stale = await withTimeout(fx.registry.resetReplica(ALICE, NS_B, {
      replicationId: ID_A,
      replicationEpoch: 1,
    }) as Promise<AnyResult | undefined>, 5_000, 'stale-epoch reset');
    expect(okIssue(stale).code).toBe('NAMESPACE_RESET_IDENTITY_MISMATCH');
    expect(fx.probe.archiveWrites).toHaveLength(0);
    expect(fx.probe.removes).toHaveLength(0);

    // 文档完好 + open 恢复（epoch 2、ROOT 5）
    const reopened = okLease(await fx.registry.open(ALICE, NS_B) as AnyResult | undefined);
    await schemaReady(reopened);
    expect(leaseMeta(reopened).replicationEpoch).toBe(2);
    expect(leaseReadN(reopened)).toBe(5);
    await reopened.release();

    // 以当前 epoch（2）reset → 成功（守卫接受当前持久身份）
    const fresh = await withTimeout(fx.registry.resetReplica(ALICE, NS_B, {
      replicationId: ID_A,
      replicationEpoch: 2,
    }) as Promise<AnyResult | undefined>, 5_000, 'current-epoch reset');
    expect(fresh).toMatchObject({ ok: true });
    expect(fx.probe.archiveWrites).toHaveLength(1);
    const archived = decodeToDoc(fx.probe.archiveWrites[0]!.bytes);
    expect(archived.getMap('META').get('replicationEpoch')).toBe(2);
    expect(okIssue(await fx.registry.open(ALICE, NS_B) as AnyResult | undefined).code).toBe('NAMESPACE_NOT_FOUND');
    await fx.registry.shutdown();
  });

  it('6b 导入后立即 reset（未 flush 窗口）：守卫读到导入字节身份（当前身份成功 / 陈旧身份拒绝+完好）', { timeout: 30_000 }, async () => {
    // 正向：导入 epoch 7（create 提交点已落盘）→ 立即以导入身份 reset → 成功
    const ok = makeRoundFixture();
    const lease = await seedIdentityDoc(ok, ALICE, NS_B, { replicationEpoch: 7, root: 3 });
    await lease.release(); // 零 flush 窗口（导入提交点即持久事实）
    const reset = await withTimeout(ok.registry.resetReplica(ALICE, NS_B, {
      replicationId: ID_A,
      replicationEpoch: 7,
    }) as Promise<AnyResult | undefined>, 5_000, 'immediate reset after import');
    expect(reset).toMatchObject({ ok: true }); // 守卫读到导入字节身份（epoch 7）
    expect(ok.probe.archiveWrites).toHaveLength(1);
    const archived = decodeToDoc(ok.probe.archiveWrites[0]!.bytes);
    expect(archived.getMap('META').get('replicationEpoch')).toBe(7);
    expect(archived.getMap('ROOT').get('n')).toBe(3);
    await ok.registry.shutdown();

    // 负控：导入 epoch 7 → 以陈旧身份（epoch 6）reset → 拒绝 + 导入副本完好可恢复
    const bad = makeRoundFixture();
    const lease2 = await seedIdentityDoc(bad, ALICE, NS_C, { replicationEpoch: 7, root: 4 });
    await lease2.release();
    const stale = await withTimeout(bad.registry.resetReplica(ALICE, NS_C, {
      replicationId: ID_A,
      replicationEpoch: 6,
    }) as Promise<AnyResult | undefined>, 5_000, 'stale-identity reset after import');
    expect(okIssue(stale).code).toBe('NAMESPACE_RESET_IDENTITY_MISMATCH');
    expect(bad.probe.archiveWrites).toHaveLength(0);
    const recovered = okLease(await bad.registry.open(ALICE, NS_C) as AnyResult | undefined);
    await schemaReady(recovered);
    expect(leaseMeta(recovered).replicationEpoch).toBe(7);
    expect(leaseReadN(recovered)).toBe(4);
    await recovered.release();
    await bad.registry.shutdown();
  });
});

// ═══════════════════════════════ §7 registry 公共面动态守卫 ═══════════════════════════════

describe('SA7 §7 registry 公共面动态守卫（运行时可枚举键）', () => {
  it('registry 实例运行时可枚举键恰六面；主入口无 removeNamespace/deleteNamespace/closeNamespace 等禁词面', async () => {
    const fx = makeRoundFixture();
    const instanceKeys = Object.keys(fx.registry).sort();
    expect(instanceKeys).toEqual(['create', 'getStatus', 'importReplica', 'open', 'resetReplica', 'shutdown']);
    const forbiddenInstance = [
      'removeNamespace', 'deleteNamespace', 'closeNamespace', 'dropNamespace',
      'archiveNamespace', 'listNamespaces', 'resetAllNamespaces', 'removeAllNamespaces',
      'destroyNamespace', 'purgeNamespace',
    ];
    for (const name of forbiddenInstance) {
      expect(instanceKeys, `registry 实例不得含 ${name}`).not.toContain(name);
    }

    const mod = (await import('@nomicore/namespace-registry')) as Record<string, unknown>;
    const moduleKeys = [...Object.keys(mod), ...Object.getOwnPropertyNames(mod)];
    for (const name of forbiddenInstance) {
      expect(moduleKeys, `registry 主入口不得导出 ${name}`).not.toContain(name);
    }
    await fx.registry.shutdown();
  });
});
