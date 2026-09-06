/**
 * issue #231 红灯契约——`resync-required{cause:'send-failed'}` 子因判别：
 * 「UPDATE 确定性超限（update-too-large）」与「发送路径拒绝（send-frame-rejected）」
 * 必须在 observer 事件上可区分，并携带安全数值/状态上下文（updateBytes/maxUpdateBytes/
 * channelState/connectionState/queuedUpdateCount/queuedUpdateBytes/inFlightCount/
 * bufferedAmount?），同时零泄漏（Yjs bytes / 文档内容 / token / owner / 异常原文）。
 *
 * 契约来源：GitHub issue #231 acceptance criteria；docs/protocols/instance-replication-v1.md
 * §23（observer seam append-only——保留 cause:'send-failed'，追加 reason 与上下文字段；
 * 其余 cause 事件形状逐字节不变）。
 *
 * AC 映射：
 *  AC1 → T1（peer 超限）/ T2（hub 超限）/ T2b（bufferedAmount 可观测）；
 *        T8/T9（队列非空超限静默丢弃 → update-dropped，append-only 第 20 型——
 *        无 resync 声明路径（R2-1/D4 活性保持）的唯一观测信号；peer/hub 双侧）；
 *  AC2 → T3（peer admission 拒绝返回 0）/ T4（hub admission 拒绝返回 0）/
 *        T5（peer 发送路径异常折叠——try/catch → 0 同桶）；
 *  AC3 → 两条路径 × hub/peer 双角色；
 *  AC4 → T6（observer 每事件必 throw——协议零影响）+ 各用例 safe-field 深扫 +
 *        T7（无 observer 行为逐帧等价）；
 *  AC5 → 各用例断言 wire RESYNC_REQUIRED 帧不变 + 恢复 round 收敛（状态机/wire 零变化）。
 *
 * 红线纪律（与既有套件一致）：真实 yjs / Registry / Runtime；fake-duplex 内存双端；
 * fake scheduler（零 real sleep）；零源码 grep 断言；全部锚在 observer 事件 /
 * wire 帧 / 状态投影 / 持久化值。
 */
import { describe, expect, it } from 'vitest';
import { createHubReplication, createPeerReplication } from '@nomicore/ws-replication';
import type {
  DuplexTransport,
  ReplicationObserver,
  ReplicationObserverEvent,
} from '@nomicore/ws-replication';
import { decodeMessage, type DecodedMessage } from '@nomicore/replication-protocol';
import { bootMulti } from './issue137-driver.js';
import { ISSUE137_SCHEMA } from './issue137-driver.js';
import { collectUnhandledRejections, DEFAULT_PEER_VERIFIER, TEST_TOKEN } from './driver.js';
import {
  HUB_INSTANCE,
  HUB_OWNER,
  PEER_INSTANCE,
  PEER_OWNER,
  deferred,
  makeNode,
  makeWire,
  okLease,
  schemaReady,
  settle,
  settleUntil,
} from './harness.js';

// ═══════════════════════════ 本地观测辅助（零 src 触碰） ═══════════════════════════

class Collector {
  readonly events: ReplicationObserverEvent[] = [];
  observer: ReplicationObserver = (event) => {
    this.events.push(event);
  };
  of(type: ReplicationObserverEvent['type']): ReplicationObserverEvent[] {
    return this.events.filter((e) => e.type === type);
  }
}

type ResyncEvent = Extract<ReplicationObserverEvent, { type: 'resync-required' }>;
type DroppedEvent = Extract<ReplicationObserverEvent, { type: 'update-dropped' }>;

function resyncEvents(collector: Collector): ResyncEvent[] {
  return collector.of('resync-required') as ResyncEvent[];
}

function droppedEvents(collector: Collector): DroppedEvent[] {
  return collector.of('update-dropped') as DroppedEvent[];
}

/** 指定 namespace 的 RESYNC_REQUIRED wire 帧。 */
function resyncFrames(decoded: readonly DecodedMessage[], nsId: string): DecodedMessage[] {
  return decoded.filter(
    (f) => f.message.kind === 'RESYNC_REQUIRED' && f.message.namespaceId === nsId,
  );
}

/** 帧协议语义摘要（kind#seq；Yjs 载荷含随机 client id——摘要不跨运行逐字节比）。 */
function summarize(decoded: readonly DecodedMessage[]): string[] {
  return decoded.map((f) => `${f.message.kind}#${f.header.sequence}`);
}

/** 注入异常哨兵——绝不允许出现在任何事件 JSON（异常原文禁入 safe-field）。 */
const THROW_SENTINEL = 'SENTINEL-231-THROW-f3a9c1';

/** issue #231 后 resync-required 冻结键集（与 T9 ALLOWED_KEYS / api test-d 同源）。 */
const RESYNC_ALLOWED_KEYS = new Set([
  'type', 'side', 'connectionId', 'namespaceId', 'cause', 'reason',
  'updateBytes', 'maxUpdateBytes', 'channelState', 'connectionState',
  'queuedUpdateCount', 'queuedUpdateBytes', 'inFlightCount', 'bufferedAmount',
]);

/** update-dropped 冻结键集（与 resync-required 上下文同形；reason 必填）。 */
const DROPPED_ALLOWED_KEYS = new Set([
  'type', 'side', 'connectionId', 'namespaceId', 'reason',
  'updateBytes', 'maxUpdateBytes', 'channelState', 'connectionState',
  'queuedUpdateCount', 'queuedUpdateBytes', 'inFlightCount', 'bufferedAmount',
]);

/** safe-field 深扫（T9 同纪律）：键集白名单 + 零 sentinel + 零二进制/Error + 数值有限。 */
function assertSafeFields(events: readonly ReplicationObserverEvent[], label: string): void {
  const sentinels = [TEST_TOKEN, 'hub-owner-9f38', 'peer-owner-7e21', THROW_SENTINEL, 'zzzzzzzz'];
  for (const event of events) {
    const text = JSON.stringify(event);
    for (const sentinel of sentinels) {
      expect(text.includes(sentinel), `${label}: ${event.type} 泄漏哨兵 ${sentinel}`).toBe(false);
    }
    const seen = new Set<unknown>();
    const visit = (value: unknown): void => {
      if (value === null || typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      if (value instanceof Uint8Array || value instanceof ArrayBuffer || value instanceof DataView) {
        throw new Error(`${label}: ${event.type} 含二进制对象`);
      }
      if (value instanceof Error) throw new Error(`${label}: ${event.type} 含 Error`);
      for (const v of Object.values(value)) visit(v);
    };
    visit(event);
    if (event.type === 'resync-required') {
      for (const key of Object.keys(event)) {
        expect(RESYNC_ALLOWED_KEYS.has(key), `${label}: resync-required 意外键 ${key}`).toBe(true);
      }
      const ev = event as ResyncEvent;
      for (const key of ['updateBytes', 'maxUpdateBytes', 'queuedUpdateCount', 'queuedUpdateBytes', 'inFlightCount', 'bufferedAmount'] as const) {
        const value = ev[key];
        if (value !== undefined) {
          expect(
            typeof value === 'number' && Number.isFinite(value) && value >= 0,
            `${label}: resync-required.${key} 必须为有限非负数值`,
          ).toBe(true);
        }
      }
    }
    if (event.type === 'update-dropped') {
      for (const key of Object.keys(event)) {
        expect(DROPPED_ALLOWED_KEYS.has(key), `${label}: update-dropped 意外键 ${key}`).toBe(true);
      }
      const ev = event as DroppedEvent;
      for (const key of ['updateBytes', 'maxUpdateBytes', 'queuedUpdateCount', 'queuedUpdateBytes', 'inFlightCount', 'bufferedAmount'] as const) {
        const value = ev[key];
        if (value !== undefined) {
          expect(
            typeof value === 'number' && Number.isFinite(value) && value >= 0,
            `${label}: update-dropped.${key} 必须为有限非负数值`,
          ).toBe(true);
        }
      }
    }
  }
}

// ═══════════════════════════ AC1：update-too-large（确定性超限） ═══════════════════════════

describe('issue #231 AC1：单笔 UPDATE 超限 → update-too-large', () => {
  const TOO_LARGE_LIMITS = {
    maxUpdateBytes: 8_192,
    maxInFlightUpdates: 8, // 窗口有空位 → live 直发路径
    maxQueuedUpdateCount: 100,
    maxQueuedUpdateBytes: 1_048_576,
  } as const;

  it('T1（peer）：超限直发 → resync-required{send-failed, update-too-large, updateBytes, maxUpdateBytes, 上下文} + wire/恢复不变', async () => {
    const probe = collectUnhandledRejections();
    try {
      const peerEvents = new Collector();
      const hubEvents = new Collector();
      const run = await bootMulti({
        count: 1,
        limits: TOO_LARGE_LIMITS,
        timeouts: { ackTimeoutMs: 60_000 },
        peerObserver: peerEvents.observer,
        hubObserver: hubEvents.observer,
      });
      const a = run.nsIds[0]!;
      const BIG = 'z'.repeat(20_000); // 编码后 ≈20KB > maxUpdateBytes 8KB（单笔超限直发）

      await run.peerWrite(a, { blurb: BIG });
      await settle();

      // ★ AC1 核心锚：子因 + 实际字节数 + 限制值 + 失败时刻上下文
      const matches = resyncEvents(peerEvents).filter((e) => e.cause === 'send-failed');
      expect(matches).toHaveLength(1);
      const ev = matches[0]!;
      expect(ev.side).toBe('peer');
      expect(ev.namespaceId).toBe(a);
      expect(ev.reason).toBe('update-too-large');
      expect(ev.updateBytes).toBeGreaterThan(8_192);
      expect(ev.maxUpdateBytes).toBe(8_192);
      expect(ev.channelState).toBe('needs-resync'); // 事件在决策落定后发射（§23.4）
      expect(ev.connectionState).toBe('ready'); // 连接健康——问题在业务体量/配置，不在连接
      expect(ev.queuedUpdateCount).toBe(0);
      expect(ev.queuedUpdateBytes).toBe(0);
      expect(ev.inFlightCount).toBe(0);
      // makeWire transport 无 bufferedAmount 面 → 字段必须缺失（非 0——0 是真实读数）
      expect('bufferedAmount' in ev).toBe(false);

      // AC5：wire 零变化——RESYNC_REQUIRED{send-queue-overflow} 照旧；连接不杀
      expect(resyncFrames(run.frames('peerToHub'), a).length).toBeGreaterThanOrEqual(1);
      expect(run.connectionState()).toBe('ready');
      // 恢复状态机不变：恢复 round（state-vector diff）收敛 hub
      await settleUntil(
        () => run.rootValue('hub', a, 'blurb') === BIG,
        '恢复 round 后 hub 收敛 blurb=BIG',
      );
      // 对端事件形状逐字节不变（append-only 范围纪律：remote-declared 零新字段）
      const remote = resyncEvents(hubEvents).find((e) => e.cause === 'remote-declared');
      expect(remote).toBeDefined();
      expect(Object.keys(remote!)).toEqual(
        expect.arrayContaining(['type', 'side', 'namespaceId', 'cause']),
      );
      expect('reason' in remote!).toBe(false);
      expect('updateBytes' in remote!).toBe(false);

      assertSafeFields([...peerEvents.events, ...hubEvents.events], 'T1');
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });

  it('T2（hub）：超限直发 → resync-required{send-failed, update-too-large}（hub 侧）+ peer 收敛', async () => {
    const probe = collectUnhandledRejections();
    try {
      const peerEvents = new Collector();
      const hubEvents = new Collector();
      const run = await bootMulti({
        count: 1,
        limits: TOO_LARGE_LIMITS,
        timeouts: { ackTimeoutMs: 60_000 },
        peerObserver: peerEvents.observer,
        hubObserver: hubEvents.observer,
      });
      const a = run.nsIds[0]!;
      const BIG = 'z'.repeat(20_000);

      await run.hubWrite(a, { blurb: BIG });
      await settle();

      const matches = resyncEvents(hubEvents).filter((e) => e.cause === 'send-failed');
      expect(matches).toHaveLength(1);
      const ev = matches[0]!;
      expect(ev.side).toBe('hub');
      expect(ev.namespaceId).toBe(a);
      expect(ev.reason).toBe('update-too-large');
      expect(ev.updateBytes).toBeGreaterThan(8_192);
      expect(ev.maxUpdateBytes).toBe(8_192);
      expect(ev.channelState).toBe('needs-resync');
      expect(ev.connectionState).toBe('ready');
      expect(ev.queuedUpdateCount).toBe(0);
      expect(ev.queuedUpdateBytes).toBe(0);
      expect(ev.inFlightCount).toBe(0);
      expect('bufferedAmount' in ev).toBe(false);

      // wire 不变：hub → peer RESYNC_REQUIRED 照旧；恢复 round 收敛 peer
      expect(resyncFrames(run.frames('hubToPeer'), a).length).toBeGreaterThanOrEqual(1);
      await settleUntil(
        () => run.rootValue('peer', a, 'blurb') === BIG,
        '恢复 round 后 peer 收敛 blurb=BIG',
      );
      assertSafeFields([...peerEvents.events, ...hubEvents.events], 'T2');
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });

  it('T2b：adapter 可观测时 bufferedAmount 字段存在且为真实读数（withPressure seam）', async () => {
    const peerEvents = new Collector();
    const hubEvents = new Collector();
    const run = await bootMulti({
      count: 1,
      limits: TOO_LARGE_LIMITS,
      timeouts: { ackTimeoutMs: 60_000 },
      peerObserver: peerEvents.observer,
      hubObserver: hubEvents.observer,
      withPressure: true, // 双端暴露 bufferedAmount 属性（缺省 0）
    });
    const a = run.nsIds[0]!;
    await run.peerWrite(a, { blurb: 'z'.repeat(20_000) });
    await settle();
    const ev = resyncEvents(peerEvents).find((e) => e.cause === 'send-failed');
    expect(ev).toBeDefined();
    expect(ev!.reason).toBe('update-too-large');
    expect(ev!.bufferedAmount).toBe(0); // 可观测 ∧ 无压力 → 真实读数 0（字段存在）
    assertSafeFields([...peerEvents.events, ...hubEvents.events], 'T2b');
  });
});

// ═══════════════════════════ AC2：send-frame-rejected（发送路径拒绝） ═══════════════════════════

describe('issue #231 AC2：UPDATE 未超限但发送路径返回非正 sequence → send-frame-rejected', () => {
  // admission 拒绝构型（合法限额链：lowWater < highWater ≤ cap）：makeWire 无
  // bufferedAmount 面 → P2 交接账本无退休证据、单调累积；逐笔小写（每笔均 ≤
  // maxUpdateBytes）直至统一账本投影超 cap → tryEmitData 返回 0（零 throw、零 gap、
  // 连接保持 ready——正是 issue 要求区分的「连接/状态/背压拒绝」形态）。
  const ADMISSION_LIMITS = {
    maxUpdateBytes: 1_024,
    maxQueuedUpdateBytes: 1_024,
    maxInFlightUpdates: 8,
    lowWater: 256,
    highWater: 512,
    maxQueuedBytesPerConnection: 512,
  } as const;

  it('T3（peer）：连接级 admission 返回 0 → resync-required{send-failed, send-frame-rejected} + 连接存活 + 恢复收敛', async () => {
    const probe = collectUnhandledRejections();
    try {
      const peerEvents = new Collector();
      const hubEvents = new Collector();
      const run = await bootMulti({
        count: 1,
        limits: ADMISSION_LIMITS,
        timeouts: { ackTimeoutMs: 60_000 },
        peerObserver: peerEvents.observer,
        hubObserver: hubEvents.observer,
      });
      const a = run.nsIds[0]!;

      // 逐笔小写直至拒绝（帧长 ≈ 数十至百余字节；cap 512 ⇒ 数笔内确定性触发）
      let lastWritten = 0;
      let rejected: ResyncEvent | undefined;
      for (let index = 1; index <= 20; index += 1) {
        await run.peerWrite(a, { n: index });
        await settle();
        lastWritten = index;
        rejected = resyncEvents(peerEvents).find((e) => e.cause === 'send-failed');
        if (rejected !== undefined) break;
      }

      // ★ AC2 核心锚：未超限（updateBytes < maxUpdateBytes）但发送路径拒绝
      expect(rejected, '20 笔小写内必触发连接级 admission 拒绝').toBeDefined();
      const ev = rejected!;
      expect(ev.side).toBe('peer');
      expect(ev.reason).toBe('send-frame-rejected');
      expect(ev.updateBytes).toBeGreaterThan(0);
      expect(ev.updateBytes).toBeLessThanOrEqual(1_024);
      expect(ev.maxUpdateBytes).toBe(1_024);
      expect(ev.channelState).toBe('needs-resync');
      expect(ev.connectionState).toBe('ready'); // ★ 连接健康但帧被拒——issue 的核心判别
      expect(ev.queuedUpdateCount).toBe(0);
      expect(ev.queuedUpdateBytes).toBe(0);
      expect(ev.inFlightCount).toBe(0); // 每笔 settle 后 ACK 已收妥
      expect('bufferedAmount' in ev).toBe(false);

      // AC5：连接不杀（admission 拒绝非连接病理）+ RESYNC_REQUIRED 照旧 + 恢复收敛
      expect(run.connectionState()).toBe('ready');
      expect(resyncFrames(run.frames('peerToHub'), a).length).toBeGreaterThanOrEqual(1);
      await settleUntil(
        () => run.rootValue('hub', a, 'n') === lastWritten,
        `恢复 round 后 hub 收敛 n=${lastWritten}（当前 ${String(run.rootValue('hub', a, 'n'))}）`,
      );
      assertSafeFields([...peerEvents.events, ...hubEvents.events], 'T3');
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });

  it('T4（hub）：连接级 admission 返回 0 → resync-required{send-failed, send-frame-rejected}（hub 侧）+ peer 收敛', async () => {
    const probe = collectUnhandledRejections();
    try {
      const peerEvents = new Collector();
      const hubEvents = new Collector();
      const run = await bootMulti({
        count: 1,
        limits: ADMISSION_LIMITS,
        timeouts: { ackTimeoutMs: 60_000 },
        peerObserver: peerEvents.observer,
        hubObserver: hubEvents.observer,
      });
      const a = run.nsIds[0]!;

      let lastWritten = 0;
      let rejected: ResyncEvent | undefined;
      for (let index = 1; index <= 20; index += 1) {
        await run.hubWrite(a, { n: 100 + index });
        await settle();
        lastWritten = 100 + index;
        rejected = resyncEvents(hubEvents).find((e) => e.cause === 'send-failed');
        if (rejected !== undefined) break;
      }

      expect(rejected, '20 笔小写内必触发连接级 admission 拒绝').toBeDefined();
      const ev = rejected!;
      expect(ev.side).toBe('hub');
      expect(ev.reason).toBe('send-frame-rejected');
      expect(ev.updateBytes).toBeGreaterThan(0);
      expect(ev.updateBytes).toBeLessThanOrEqual(1_024);
      expect(ev.maxUpdateBytes).toBe(1_024);
      expect(ev.channelState).toBe('needs-resync');
      expect(ev.connectionState).toBe('ready');
      expect(ev.queuedUpdateCount).toBe(0);
      expect(ev.queuedUpdateBytes).toBe(0);
      expect(ev.inFlightCount).toBe(0);
      expect('bufferedAmount' in ev).toBe(false);

      expect(resyncFrames(run.frames('hubToPeer'), a).length).toBeGreaterThanOrEqual(1);
      await settleUntil(
        () => run.rootValue('peer', a, 'n') === lastWritten,
        `恢复 round 后 peer 收敛 n=${lastWritten}（当前 ${String(run.rootValue('peer', a, 'n'))}）`,
      );
      assertSafeFields([...peerEvents.events, ...hubEvents.events], 'T4');
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });

  it('T5（peer）：发送路径异常（transport.send throw）折叠为 0 → 同桶 send-frame-rejected，异常原文零泄漏', async () => {
    const probe = collectUnhandledRejections();
    try {
      const peerEvents = new Collector();
      const hubEvents = new Collector();
      const hubNode = makeNode('hub');
      const peerNode = makeNode('peer');
      const lease = okLease(
        await hubNode.registry.create({
          owner: HUB_OWNER,
          schema: ISSUE137_SCHEMA,
          root: { n: 1, blurb: 'seed' },
        }),
      );
      await schemaReady(lease);
      const enabled = await lease.enableReplication();
      if (!enabled.ok) throw new Error(`enableReplication 失败：${JSON.stringify(enabled)}`);
      const nsId = lease.namespaceId;
      const hub = createHubReplication({
        instanceId: HUB_INSTANCE,
        registry: hubNode.registry,
        authorize: async () => ({
          ok: true as const,
          localOwner: HUB_OWNER,
          permissions: { read: true, submit: true },
        }),
        timer: hubNode.scheduler,
        verifyToken: DEFAULT_PEER_VERIFIER,
        observer: hubEvents.observer,
      });

      // 故障注入 seam：包装 peer 端 transport——武装后首个 UPDATE 帧发送抛错
      // （单发：序列已分配而帧未出站，连接随后死于 sequence gap——属注入的预期代价，
      //  断言只落在「异常折叠 → send-frame-rejected」与「异常原文零泄漏」）。
      let armed = false;
      const wire = makeWire();
      const throwingEnd: DuplexTransport = {
        send(bytes) {
          if (armed && decodeMessage(bytes).message.kind === 'UPDATE') {
            armed = false;
            throw new Error(THROW_SENTINEL);
          }
          wire.peerEnd.send(bytes);
        },
        close(code, reason) {
          wire.peerEnd.close(code, reason);
        },
        get closed() {
          return wire.peerEnd.closed;
        },
        onMessage(listener) {
          return wire.peerEnd.onMessage(listener);
        },
        onClose(listener) {
          return wire.peerEnd.onClose(listener);
        },
      };
      const peer = createPeerReplication({
        instanceId: PEER_INSTANCE,
        hubInstanceId: HUB_INSTANCE,
        registry: peerNode.registry,
        dial: () => {
          void hub.accept(wire.hubEnd, { token: TEST_TOKEN });
          return throwingEnd;
        },
        timer: peerNode.scheduler,
        targets: [{ namespaceId: nsId, localOwner: PEER_OWNER }],
        observer: peerEvents.observer,
      });
      peer.start();
      await settleUntil(() => peer.getNamespaceState(nsId) === 'live', 'live');

      armed = true;
      const writeLease = okLease(await peerNode.registry.open(PEER_OWNER, nsId));
      await schemaReady(writeLease);
      const written = await writeLease.mutateData({ op: 'set', path: ['n'], value: 2 });
      if (!written.ok) throw new Error(`peer 业务写失败：${JSON.stringify(written)}`);
      await writeLease.release();
      await settle();

      const matches = resyncEvents(peerEvents).filter((e) => e.cause === 'send-failed');
      expect(matches).toHaveLength(1);
      const ev = matches[0]!;
      expect(ev.reason).toBe('send-frame-rejected'); // 异常折叠与返回 0 同桶
      expect(ev.updateBytes).toBeGreaterThan(0);
      expect(ev.connectionState).toBe('ready');
      // 注入的异常原文（Error/message）绝不入事件
      assertSafeFields([...peerEvents.events, ...hubEvents.events], 'T5');
      await peer.stop();
      await settle();
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });
});

// ═══════════════════════════ AC1 补盲：队列非空超限静默丢弃 → update-dropped（第 20 型） ═══════════════════════════

describe('issue #231 AC1 补盲：队列非空时超限项 F4 静默丢弃 → update-dropped（无 resync 声明路径的唯一观测信号）', () => {
  // 构型：maxInFlightUpdates=1 + 接收侧 saveGate 扣留 dirty 登记（ACK = apply + dirty
  // 登记）——第一笔小写占满在途窗口，BIG 与后续小写进入未发送队列；释放门闩 → ACK →
  // drain 贪心取帧拉出孤立的超限 BIG（合并上界 ≤ maxUpdateBytes ⇒ BIG 独占一帧、
  // 小写留队）→ 命中「队列非空」分支：F4 丢弃语义继续 drain（R2-1/D4 活性保持），
  // 不声明 resync。本路径在评审前对 observer 完全不可见（AC1 缺口）。
  //
  // 接收侧投影纪律（Yjs 时钟缺口实测钉死）：后续小写与 BIG 同 client、时钟在其后——
  // BIG 被丢后小写 update 在接收侧 pending（deleteSet 先行 ⇒ 旧值暂不可见），
  // 帧仍发送并被 ACK（D4「消费即进展」活性）；修复 = 下一次 reconciliation 的
  // state-vector diff（SYNC_STEP2 走控制帧路径，不受 maxUpdateBytes 单帧门约束），
  // diff 补齐 BIG 时钟段后 pending 一并整合 → 全量收敛。
  const DROP_LIMITS = {
    maxUpdateBytes: 8_192,
    maxInFlightUpdates: 1,
    maxQueuedUpdateCount: 100,
    maxQueuedUpdateBytes: 1_048_576,
  } as const;
  const DROP_TIMEOUTS = { ackTimeoutMs: 60_000, reconcileIntervalMs: 5_000 } as const;

  it('T8（peer）：恰一 update-dropped{update-too-large} + 零 resync-required + D4 活性 + 下次 reconciliation 修复', async () => {
    const probe = collectUnhandledRejections();
    try {
      const peerEvents = new Collector();
      const hubEvents = new Collector();
      const run = await bootMulti({
        count: 1,
        limits: DROP_LIMITS,
        timeouts: DROP_TIMEOUTS,
        peerObserver: peerEvents.observer,
        hubObserver: hubEvents.observer,
      });
      const a = run.nsIds[0]!;
      const BIG = 'z'.repeat(20_000);

      // 扣留 hub 侧 dirty 登记 → 第一笔小写的 ACK 被扣 → 窗口（=1）保持满
      const gate = deferred();
      run.hubNode.persistence.saveGate = gate;
      await run.peerWrite(a, { n: 11 }); // 在途（ACK 被扣）
      await run.peerWrite(a, { blurb: BIG }); // 窗口满 → 未发送队列
      await run.peerWrite(a, { n: 12 }); // 未发送队列（BIG 之后）
      await settle();
      // 窗口被占：线上仅一笔 UPDATE；尚无任何失败观测
      expect(run.framesOf('peerToHub', a).filter((f) => f.message.kind === 'UPDATE')).toHaveLength(1);
      expect(resyncEvents(peerEvents)).toHaveLength(0);
      expect(droppedEvents(peerEvents)).toHaveLength(0);

      // 释放 dirty → ACK → drain 拉出 BIG（孤立超限帧）→ F4 丢弃（队列尚有小写）
      run.hubNode.persistence.saveGate = undefined;
      gate.resolve();
      await settle();

      // ★ AC1 补盲核心锚：恰一 update-dropped{update-too-large}（计数不变量：
      //   每笔超限丢弃恰一事件——本分支不伴随 resync 声明）
      const dropped = droppedEvents(peerEvents);
      expect(dropped).toHaveLength(1);
      const ev = dropped[0]!;
      expect(ev.side).toBe('peer');
      expect(ev.namespaceId).toBe(a);
      expect(ev.reason).toBe('update-too-large');
      expect(ev.updateBytes).toBeGreaterThan(8_192);
      expect(ev.maxUpdateBytes).toBe(8_192);
      expect(ev.channelState).toBe('live'); // 本路径无状态迁移（R2-1/D4）
      expect(ev.connectionState).toBe('ready'); // 连接健康——问题在业务体量/配置
      expect(ev.queuedUpdateCount).toBe(1); // 被丢弃项已出队；残余 = 后续小写
      expect(ev.queuedUpdateBytes).toBeGreaterThan(0);
      expect(ev.inFlightCount).toBe(0); // ACK 先收妥再 drain
      expect('bufferedAmount' in ev).toBe(false); // makeWire 无 bufferedAmount 面
      // 零 resync 声明（双侧事件 + 双侧 wire 帧）
      expect(resyncEvents(peerEvents)).toHaveLength(0);
      expect(resyncEvents(hubEvents)).toHaveLength(0);
      expect(droppedEvents(hubEvents)).toHaveLength(0);
      expect(resyncFrames(run.frames('peerToHub'), a)).toHaveLength(0);
      expect(resyncFrames(run.frames('hubToPeer'), a)).toHaveLength(0);

      // AC5/R2-1/D4 活性：连接与 channel 不迁移；同一 drain 后续 pass 照发合法小写
      // （第二笔 UPDATE 出站并被 ACK）——丢失项修复留给下一次 reconciliation
      expect(run.connectionState()).toBe('ready');
      expect(run.peer.getNamespaceState(a)).toBe('live');
      expect(run.framesOf('peerToHub', a).filter((f) => f.message.kind === 'UPDATE')).toHaveLength(2);
      expect(run.framesOf('hubToPeer', a).filter((f) => f.message.kind === 'UPDATE_ACK')).toHaveLength(2);
      // 接收侧投影纪律：BIG 恒缺失；后续小写因 Yjs 时钟缺口 pending（n≠12）——
      // 本地已接受状态完整保留（peer 侧 n=12/blurb=BIG）
      expect(run.rootValue('hub', a, 'blurb')).toBe('seed');
      expect(run.rootValue('hub', a, 'n')).not.toBe(12);
      expect(run.rootValue('peer', a, 'n')).toBe(12);
      expect(run.rootValue('peer', a, 'blurb')).toBe(BIG);

      // 修复路径（R2-1/D4 既定立场）：下一次 periodic reconciliation round 的
      // state-vector diff 补齐被丢弃段（控制帧路径）→ 缺口填上后 pending 整合
      await run.peerNode.scheduler.advanceBy(5_000);
      await settleUntil(
        () =>
          run.rootValue('hub', a, 'n') === 12 &&
          run.rootValue('hub', a, 'blurb') === BIG &&
          run.peer.getNamespaceState(a) === 'live', // round 结算落定（§23.4 决策落定后口径）
        `reconcile diff 后 hub 全量收敛且回到 live（当前 n=${String(run.rootValue('hub', a, 'n'))} state=${String(run.peer.getNamespaceState(a))}）`,
      );
      // 常规 round 非 resync 声明——计数不变量终态：仍恰一 update-dropped、零 resync-required
      expect(droppedEvents(peerEvents)).toHaveLength(1);
      expect(resyncEvents(peerEvents)).toHaveLength(0);
      expect(resyncEvents(hubEvents)).toHaveLength(0);
      expect(run.peer.getNamespaceState(a)).toBe('live');

      assertSafeFields([...peerEvents.events, ...hubEvents.events], 'T8');
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });

  it('T9（hub）：同构——hub→peer 方向队列非空超限丢弃 → update-dropped（hub 侧）', async () => {
    const probe = collectUnhandledRejections();
    try {
      const peerEvents = new Collector();
      const hubEvents = new Collector();
      const run = await bootMulti({
        count: 1,
        limits: DROP_LIMITS,
        timeouts: DROP_TIMEOUTS,
        peerObserver: peerEvents.observer,
        hubObserver: hubEvents.observer,
      });
      const a = run.nsIds[0]!;
      const BIG = 'z'.repeat(20_000);

      // 镜像：扣留 peer 侧 dirty 登记 → hub→peer 方向窗口保持满
      const gate = deferred();
      run.peerNode.persistence.saveGate = gate;
      await run.hubWrite(a, { n: 11 }); // 在途（ACK 被扣）
      await run.hubWrite(a, { blurb: BIG }); // 窗口满 → 未发送队列
      await run.hubWrite(a, { n: 12 }); // 未发送队列
      await settle();
      expect(run.framesOf('hubToPeer', a).filter((f) => f.message.kind === 'UPDATE')).toHaveLength(1);
      expect(resyncEvents(hubEvents)).toHaveLength(0);
      expect(droppedEvents(hubEvents)).toHaveLength(0);

      run.peerNode.persistence.saveGate = undefined;
      gate.resolve();
      await settle();

      const dropped = droppedEvents(hubEvents);
      expect(dropped).toHaveLength(1);
      const ev = dropped[0]!;
      expect(ev.side).toBe('hub');
      expect(ev.namespaceId).toBe(a);
      expect(ev.reason).toBe('update-too-large');
      expect(ev.updateBytes).toBeGreaterThan(8_192);
      expect(ev.maxUpdateBytes).toBe(8_192);
      expect(ev.channelState).toBe('live');
      expect(ev.connectionState).toBe('ready');
      expect(ev.queuedUpdateCount).toBe(1);
      expect(ev.queuedUpdateBytes).toBeGreaterThan(0);
      expect(ev.inFlightCount).toBe(0);
      expect('bufferedAmount' in ev).toBe(false);
      expect(resyncEvents(peerEvents)).toHaveLength(0);
      expect(resyncEvents(hubEvents)).toHaveLength(0);
      expect(droppedEvents(peerEvents)).toHaveLength(0);
      expect(resyncFrames(run.frames('peerToHub'), a)).toHaveLength(0);
      expect(resyncFrames(run.frames('hubToPeer'), a)).toHaveLength(0);

      expect(run.connectionState()).toBe('ready');
      expect(run.peer.getNamespaceState(a)).toBe('live');
      expect(run.framesOf('hubToPeer', a).filter((f) => f.message.kind === 'UPDATE')).toHaveLength(2);
      expect(run.framesOf('peerToHub', a).filter((f) => f.message.kind === 'UPDATE_ACK')).toHaveLength(2);
      expect(run.rootValue('peer', a, 'blurb')).toBe('seed'); // BIG 恒缺失
      expect(run.rootValue('peer', a, 'n')).not.toBe(12); // 小写 pending（Yjs 时钟缺口）
      expect(run.rootValue('hub', a, 'n')).toBe(12); // 本地已接受状态完整保留
      expect(run.rootValue('hub', a, 'blurb')).toBe(BIG);

      // 修复路径同构：peer 发起的 periodic round（round 恒由 peer 发起，§10.5）——
      // hub STEP2 diff 补齐 peer 缺口 → pending 整合 → 全量收敛
      await run.peerNode.scheduler.advanceBy(5_000);
      await settleUntil(
        () =>
          run.rootValue('peer', a, 'n') === 12 &&
          run.rootValue('peer', a, 'blurb') === BIG &&
          run.peer.getNamespaceState(a) === 'live', // round 结算落定
        `reconcile diff 后 peer 全量收敛且回到 live（当前 n=${String(run.rootValue('peer', a, 'n'))} state=${String(run.peer.getNamespaceState(a))}）`,
      );
      expect(droppedEvents(hubEvents)).toHaveLength(1);
      expect(resyncEvents(peerEvents)).toHaveLength(0);
      expect(resyncEvents(hubEvents)).toHaveLength(0);
      expect(run.peer.getNamespaceState(a)).toBe('live');

      assertSafeFields([...peerEvents.events, ...hubEvents.events], 'T9');
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });
});

// ═══════════════════════════ AC4：隔离与等价性 ═══════════════════════════

describe('issue #231 AC4：observer throw 隔离与无 observer 等价（新路径不破纪律）', () => {
  const TOO_LARGE_LIMITS = {
    maxUpdateBytes: 8_192,
    maxInFlightUpdates: 8,
    maxQueuedUpdateCount: 100,
    maxQueuedUpdateBytes: 1_048_576,
  } as const;

  it('T6：observer 每事件必 throw——RESYNC_REQUIRED 照发、恢复收敛、零 unhandled', async () => {
    const probe = collectUnhandledRejections();
    try {
      const throwing: ReplicationObserver = () => {
        throw new Error('observer boom (sentinel-obs-boom-231)');
      };
      const run = await bootMulti({
        count: 1,
        limits: TOO_LARGE_LIMITS,
        timeouts: { ackTimeoutMs: 60_000 },
        peerObserver: throwing,
        hubObserver: throwing,
      });
      const a = run.nsIds[0]!;
      const BIG = 'z'.repeat(20_000);
      await run.peerWrite(a, { blurb: BIG });
      await settle();
      expect(resyncFrames(run.frames('peerToHub'), a).length).toBeGreaterThanOrEqual(1);
      expect(run.connectionState()).toBe('ready');
      await settleUntil(
        () => run.rootValue('hub', a, 'blurb') === BIG,
        'throw 隔离下恢复 round 仍收敛',
      );
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });

  it('T7：无 observer 行为逐帧等价（wire kind#seq 摘要全等 + 同构收敛）', async () => {
    const probe = collectUnhandledRejections();
    try {
      const runScenario = async (observed: boolean) => {
        const peerEvents = new Collector();
        const hubEvents = new Collector();
        const run = await bootMulti({
          count: 1,
          limits: TOO_LARGE_LIMITS,
          timeouts: { ackTimeoutMs: 60_000 },
          ...(observed
            ? { peerObserver: peerEvents.observer, hubObserver: hubEvents.observer }
            : {}),
        });
        const a = run.nsIds[0]!;
        const BIG = 'z'.repeat(20_000);
        await run.peerWrite(a, { blurb: BIG });
        await settleUntil(
          () => run.rootValue('hub', a, 'blurb') === BIG,
          '恢复收敛',
        );
        await settle();
        return {
          peerToHub: summarize(run.frames('peerToHub')),
          hubToPeer: summarize(run.frames('hubToPeer')),
          hubBlurb: run.rootValue('hub', a, 'blurb'),
          eventCount: peerEvents.events.length + hubEvents.events.length,
        };
      };
      const plain = await runScenario(false);
      const observed = await runScenario(true);
      expect(plain.eventCount).toBe(0); // 无 observer = 零事件（本就该恒零）
      expect(observed.eventCount).toBeGreaterThan(0);
      expect(plain.peerToHub).toEqual(observed.peerToHub);
      expect(plain.hubToPeer).toEqual(observed.hubToPeer);
      expect(plain.hubBlurb).toBe(observed.hubBlurb);
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });
});
