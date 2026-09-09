/**
 * issue #243（slice 2）实现轮绿灯镜像与修订面验收 —— 旋钮（chunkedUpdate: true）协商
 * 的 CAP_CHUNKED_UPDATE 超限 UPDATE live 分块传输。
 *
 * 本文件承载设计 §11/§12 的实现轮证据：
 *  - knob-off 缺省（HELLO optionalCapabilities=0，v1 逐字节——与冻结 NC2/R1-R3 互补）；
 *  - knob-on 全链路（P1/P2 同构镜像：零 wire 代理、真协商位）+ N2 三事件面配对
 *    （update-sent/update-acked/update-applied：sequence=末 chunk 帧序、bytes=totalBytes）；
 *  - hub→peer 方向镜像（hub 业务写 → hub 通道分块下行，DD-3 双侧对称实现共用面）；
 *  - P4-S（协商但 bytes > maxChunkedUpdateBytes → 回退 v1：deliver 时刻丢弃 + send-failed/
 *    update-too-large，零 chunk 帧——D2 隐含回退）；P4-R（首 chunk 超上界申报 →
 *    UPDATE_TRANSFER_TOO_LARGE、分配前拒绝、ns 级收口、live Y.Doc 零写入——D1）；
 *  - AC8 结构违例（busy ∧ 异 transferId → UPDATE_TRANSFER_VIOLATION、apply 前零写入）；
 *  - F1 未协商混合队列负控（队列滞留项 + 超限写：v1 drain 窗口语义——F4 静默丢弃 +
 *    update-dropped{update-too-large}，零额外 RESYNC——等价性不依赖单一写形态）；
 *  - F2 queue-overflow 中途终止（transfer 中止、无僵尸续传、对端 ns 不 failed）；
 *  - F6 ack-timeout 中途终止（双向 + 未协商负控）：peer→hub 恰一帧 wire RESYNC_REQUIRED
 *    （仅协商连接）、接收端 doomed assembly 清理、round 收敛后新 transferId 整笔重传、
 *    对端 ns 零 failed；未协商（结构性无 transfer）零 RESYNC 帧（PN6b 原体）；
 *  - F4 窗口混合穿插（maxInFlightUpdates=2 + 直发穿插 transfer：任意帧序合法、收敛、
 *    零 resync）。
 *  - F3 残渣判别（idle∧chunkIndex>0 到达形态，wire 注入确定性构造——见 K12/K13）：
 *    live 下 fail-loud（UPDATE_TRANSFER_VIOLATION + ns 终局 failed + apply 前零写入）；
 *    needs-resync 下良性丢弃（零 ERROR/零 failed/零 apply——合法 resync 恢复语义）。
 *    （注：真实传输中残渣与 round 帧同向有序、必然先于恢复 round 结算到达非 live 态
 *    [DD-4 方向序论证]；fake-duplex 零延迟下「对端声明后仍继续出站」的残渣窗口结构性
 *    不可构造——声明帧与数据帧同泵送达，发送端必然在下一帧前收口 [markResyncReceived →
 *    discardQueued]，故判别行以对齐序列注入表达。）
 *  - K14（F7 动态行）：hub→peer transfer 进行中（peer busy assembly）+ peer session
 *    fanout 溢出边沿（20 笔并发写，watchdog 非 fence 谓词）→ 声明经单漏斗
 *    （cause=session-fanout-overflow）∧ 本端 assembly 清除 + resyncEpisode 置位 →
 *    恢复 round 收敛 → hub 新 transferId（2）整笔收齐，peer ns 零 failed；
 *  - K15（AC4 多 ns RR 穿插行）：单连接双 ns 队列积压 → drain 逐轮每 ns 恰一帧严格
 *    交替（chunk × 他 ns UPDATE 无饥饿穿插）、全量收敛零 resync。
 *
 * 纪律：与既有套件一致——真实 yjs / Registry / Runtime；fake-duplex；fake scheduler
 * （advanceBy 驱动 ack-timeout/水位 poll）；零 real sleep；零源码 grep 断言。
 */
import { describe, expect, it } from 'vitest';
import {
  createHubReplication,
  createPeerReplication,
  type DuplexTransport,
  type HubReplication,
  type PeerReplication,
  type ReplicationLimits,
  type ReplicationObserver,
  type ReplicationObserverEvent,
  type ReplicationTimeouts,
} from '@nomicore/ws-replication';
import {
  CAP_CHUNKED_UPDATE,
  decodeMessage,
  encodeMessage,
  type DecodedMessage,
} from '@nomicore/replication-protocol';
import { DEFAULT_PEER_VERIFIER, TEST_TOKEN, collectUnhandledRejections } from './driver.js';
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
  type ReplicaNode,
  type Wire,
} from './harness.js';

// ═══════════════════════════ 场景配置 ═══════════════════════════

const SCHEMA = Object.freeze({
  lang: 'vfsl',
  version: 1,
  id: 'issue243-chunked-live',
  text: 'type ROOT = { n: number; blurb: string; };\n',
});

/** R1 同款极限构型：maxUpdateBytes=8KiB，大写 20KB → 目标分块 ≈3 帧。 */
const LIMITS: Readonly<Partial<ReplicationLimits>> = {
  maxUpdateBytes: 8 * 1024,
  maxQueuedUpdateCount: 100,
  maxQueuedUpdateBytes: 1 * 1024 * 1024,
  maxInFlightUpdates: 8,
};

const BIG = 'z'.repeat(20_000); // 编码后 ≈20,029B > maxUpdateBytes 8KiB

const BIG2 = 'q'.repeat(20_000);

type ChunkMsg = Extract<DecodedMessage['message'], { kind: 'UPDATE_CHUNK' }>;
type AckMsg = Extract<DecodedMessage['message'], { kind: 'UPDATE_ACK' }>;
type ResyncEvent = Extract<ReplicationObserverEvent, { type: 'resync-required' }>;

function makeCollector(): { events: ReplicationObserverEvent[]; observer: ReplicationObserver } {
  const events: ReplicationObserverEvent[] = [];
  return {
    events,
    observer: (event: ReplicationObserverEvent): void => {
      events.push(event);
    },
  };
}

/** 帧观察（无协商门控——协商由旋钮真实建立；带 CAP 上下文解码与全部既有帧同构）。 */
function decodeWire(bytes: Uint8Array): DecodedMessage {
  return decodeMessage(bytes, { selectedCapabilities: CAP_CHUNKED_UPDATE });
}

/**
 * 测试侧 data 水位暂停代理（真实 transport seam 等价物）：第 N 个 data 帧（UPDATE /
 * UPDATE_CHUNK——control 帧不计数、不受闸门）出站后把 bufferedAmount 抬到 high
 * （> highWater → 发送方暂停，transfer 中途停摆的可控构造）；release() 归零 → poll/
 * 观察恢复 → drain 续排。控制帧恒不受 data 闸门约束（与生产语义一致）。
 */
function withDataPauseProxy(
  end: DuplexTransport,
  opts: { pauseAfterDataFrames: number; high: number; low: number },
): { end: DuplexTransport; release(): void } {
  let dataFrames = 0;
  let level = 0;
  const wrapped: DuplexTransport = {
    send(bytes) {
      end.send(bytes);
      let kind: string;
      try {
        kind = decodeWire(bytes).message.kind;
      } catch {
        kind = '?';
      }
      if (kind === 'UPDATE' || kind === 'UPDATE_CHUNK') {
        dataFrames += 1;
        if (dataFrames === opts.pauseAfterDataFrames) level = opts.high;
      }
    },
    close(code?: number, reason?: string) {
      end.close(code, reason);
    },
    get closed() {
      return end.closed;
    },
    onMessage(listener) {
      return end.onMessage(listener);
    },
    onClose(listener) {
      return end.onClose(listener);
    },
    get bufferedAmount() {
      return level;
    },
  };
  return {
    end: wrapped,
    release: () => {
      level = opts.low;
    },
  };
}

const PAUSE_HIGH = 600 * 1024; // > 缺省 highWater 512KiB；<< maxQueuedBytesPerConnection 8MiB
const PAUSE_LOW = 0; // ≤ 缺省 lowWater 64KiB → 观察即恢复

// ═══════════════════════════ 本地组装（knob-on/off，双方向可写） ═══════════════════════════

interface LiveContext {
  readonly hubNode: ReplicaNode;
  readonly peerNode: ReplicaNode;
  readonly hub: HubReplication;
  readonly peer: PeerReplication;
  readonly nsId: string;
  readonly peerEvents: ReplicationObserverEvent[];
  readonly hubEvents: ReplicationObserverEvent[];
  readonly pausePeer: (() => void) | undefined;
  readonly pauseHub: (() => void) | undefined;
  getWire(): Wire;
  /** peer 业务写（独立 business lease；写完成 = 本地 sequencer 已执行）。 */
  peerWrite(value: Readonly<{ n?: number; blurb?: string }>): Promise<void>;
  /** hub 业务写（hub 自有 doc；经 hub→peer 通道下行）。 */
  hubWrite(value: Readonly<{ n?: number; blurb?: string }>): Promise<void>;
  frames(dir: 'peerToHub' | 'hubToPeer', nsId?: string): DecodedMessage[];
  chunks(dir: 'peerToHub' | 'hubToPeer'): ChunkMsg[];
  rootValue(side: 'hub' | 'peer', key: 'blurb' | 'n'): unknown;
  advance(ms: number): Promise<void>;
}

async function bootChunked(opts: {
  knob: boolean;
  hubLimits?: Readonly<Partial<ReplicationLimits>>;
  peerLimits?: Readonly<Partial<ReplicationLimits>>;
  timeouts?: Readonly<Partial<ReplicationTimeouts>>;
  pausePeerAfterDataFrames?: number;
  pauseHubAfterDataFrames?: number;
}): Promise<LiveContext> {
  const hubNode = makeNode('hub');
  const peerNode = makeNode('peer');
  const lease = okLease(
    await hubNode.registry.create({
      owner: HUB_OWNER,
      schema: SCHEMA,
      root: { n: 1, blurb: 'seed' },
    }),
  );
  await schemaReady(lease);
  const enabled = await lease.enableReplication();
  if (!enabled.ok) throw new Error(`enableReplication 失败：${JSON.stringify(enabled)}`);
  const nsId = lease.namespaceId;

  const peerEvents = makeCollector();
  const hubEvents = makeCollector();
  let activeWire: Wire | undefined;
  let peerPause: (() => void) | undefined;
  let hubPause: (() => void) | undefined;
  const hubLimits = opts.hubLimits ?? LIMITS;
  const peerLimits = opts.peerLimits ?? LIMITS;
  const timeouts: Readonly<Partial<ReplicationTimeouts>> = opts.timeouts ?? { ackTimeoutMs: 60_000 };

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
    limits: hubLimits,
    timeouts,
    observer: hubEvents.observer,
  });

  const peer = createPeerReplication({
    instanceId: PEER_INSTANCE,
    hubInstanceId: HUB_INSTANCE,
    registry: peerNode.registry,
    dial: () => {
      const wire = makeWire();
      const hubEnd =
        opts.pauseHubAfterDataFrames === undefined
          ? wire.hubEnd
          : (() => {
              const p = withDataPauseProxy(wire.hubEnd, {
                pauseAfterDataFrames: opts.pauseHubAfterDataFrames!,
                high: PAUSE_HIGH,
                low: PAUSE_LOW,
              });
              hubPause = p.release;
              return p.end;
            })();
      const peerEnd =
        opts.pausePeerAfterDataFrames === undefined
          ? wire.peerEnd
          : (() => {
              const p = withDataPauseProxy(wire.peerEnd, {
                pauseAfterDataFrames: opts.pausePeerAfterDataFrames!,
                high: PAUSE_HIGH,
                low: PAUSE_LOW,
              });
              peerPause = p.release;
              return p.end;
            })();
      activeWire = wire;
      void hub.accept(hubEnd, { token: TEST_TOKEN });
      return peerEnd;
    },
    timer: peerNode.scheduler,
    targets: [{ namespaceId: nsId, localOwner: PEER_OWNER }],
    limits: peerLimits,
    timeouts,
    observer: peerEvents.observer,
    chunkedUpdate: opts.knob,
  });

  peer.start();
  await settleUntil(() => peer.getConnectionState() === 'ready', '连接 ready');
  await settleUntil(() => peer.getNamespaceState(nsId) === 'live', 'namespace live');

  const businessWrite = async (
    node: ReplicaNode,
    owner: typeof HUB_OWNER,
    value: Readonly<{ n?: number; blurb?: string }>,
  ): Promise<void> => {
    const business = okLease(await node.registry.open(owner, nsId));
    await schemaReady(business);
    for (const [key, v] of Object.entries(value)) {
      const result = await business.mutateData({ op: 'set', path: [key], value: v });
      if (!result.ok) throw new Error(`业务写失败：${JSON.stringify(result)}`);
    }
    await business.release();
  };

  return {
    hubNode,
    peerNode,
    hub,
    peer,
    nsId,
    peerEvents: peerEvents.events,
    hubEvents: hubEvents.events,
    pausePeer: peerPause,
    pauseHub: hubPause,
    getWire: () => {
      if (activeWire === undefined) throw new Error('peer 尚未拨号');
      return activeWire;
    },
    peerWrite: (value) => businessWrite(peerNode, PEER_OWNER, value),
    hubWrite: (value) => businessWrite(hubNode, HUB_OWNER, value),
    frames: (dir, filterNs) =>
      (dir === 'peerToHub' ? activeWire?.peerToHub : activeWire?.hubToPeer)!
        .map((bytes) => decodeWire(bytes))
        .filter((f) => filterNs === undefined || (f.message as { namespaceId?: string }).namespaceId === filterNs),
    chunks: (dir) => {
      const wire = activeWire!;
      const list = dir === 'peerToHub' ? wire.peerToHub : wire.hubToPeer;
      const out: ChunkMsg[] = [];
      for (const bytes of list) {
        const decoded = decodeWire(bytes);
        if (decoded.message.kind === 'UPDATE_CHUNK') out.push(decoded.message as ChunkMsg);
      }
      return out;
    },
    rootValue: (side, key) => {
      const node = side === 'hub' ? hubNode : peerNode;
      const owner = side === 'hub' ? HUB_OWNER : PEER_OWNER;
      const doc = node.persistence.peek(owner, nsId);
      if (doc === undefined) throw new Error(`${side} 缺副本 ${nsId}`);
      return (doc.getMap('ROOT') as unknown as Map<string, unknown>).get(key);
    },
    advance: async (ms) => {
      // 双端虚拟时钟同步推进（timer 归属各自节点 scheduler）
      await peerNode.scheduler.advanceBy(ms);
      await hubNode.scheduler.advanceBy(ms);
      await settle();
    },
  };
}

// ═══════════════════════════ 双 ns 装配（AC4：chunk × 其他 ns 数据帧 RR 穿插） ═══════════════════════════

const SCHEMA_B = Object.freeze({
  lang: 'vfsl',
  version: 1,
  id: 'issue243-chunked-rr-b',
  text: 'type ROOT = { n: number; blurb: string; };\n',
});

interface PairContext {
  readonly hubNode: ReplicaNode;
  readonly peerNode: ReplicaNode;
  readonly hub: HubReplication;
  readonly peer: PeerReplication;
  readonly nsA: string;
  readonly nsB: string;
  readonly peerEvents: ReplicationObserverEvent[];
  readonly hubEvents: ReplicationObserverEvent[];
  getWire(): Wire;
  peerWrite(nsId: string, value: Readonly<{ n?: number; blurb?: string }>): Promise<void>;
  frames(dir: 'peerToHub' | 'hubToPeer', nsId?: string): DecodedMessage[];
  chunks(dir: 'peerToHub' | 'hubToPeer'): ChunkMsg[];
  rootValue(side: 'hub' | 'peer', nsId: string, key: 'blurb' | 'n'): unknown;
  releasePeer(): void;
  advance(ms: number): Promise<void>;
}

/** 单连接双 ns（同 hub 双 lease、peer 双 target）——协商 knob-on、可停 data 闸门。 */
async function bootChunkedPair(opts: {
  pausePeerAfterDataFrames: number;
  peerLimits: Readonly<Partial<ReplicationLimits>>;
  hubLimits?: Readonly<Partial<ReplicationLimits>>;
  timeouts?: Readonly<Partial<ReplicationTimeouts>>;
}): Promise<PairContext> {
  const hubNode = makeNode('hub');
  const peerNode = makeNode('peer');
  const leaseA = okLease(
    await hubNode.registry.create({
      owner: HUB_OWNER,
      schema: SCHEMA,
      root: { n: 1, blurb: 'seed' },
    }),
  );
  await schemaReady(leaseA);
  const enabledA = await leaseA.enableReplication();
  if (!enabledA.ok) throw new Error(`enableReplication A 失败：${JSON.stringify(enabledA)}`);
  const leaseB = okLease(
    await hubNode.registry.create({
      owner: HUB_OWNER,
      schema: SCHEMA_B,
      root: { n: 1, blurb: 'seed' },
    }),
  );
  await schemaReady(leaseB);
  const enabledB = await leaseB.enableReplication();
  if (!enabledB.ok) throw new Error(`enableReplication B 失败：${JSON.stringify(enabledB)}`);
  const nsA = leaseA.namespaceId;
  const nsB = leaseB.namespaceId;

  const peerEvents = makeCollector();
  const hubEvents = makeCollector();
  let activeWire: Wire | undefined;
  let releasePeerGate: (() => void) | undefined;
  const timeouts = opts.timeouts ?? { ackTimeoutMs: 60_000 };

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
    limits: opts.hubLimits ?? opts.peerLimits,
    timeouts,
    observer: hubEvents.observer,
  });

  const peer = createPeerReplication({
    instanceId: PEER_INSTANCE,
    hubInstanceId: HUB_INSTANCE,
    registry: peerNode.registry,
    dial: () => {
      const wire = makeWire();
      const pause = withDataPauseProxy(wire.peerEnd, {
        pauseAfterDataFrames: opts.pausePeerAfterDataFrames,
        high: PAUSE_HIGH,
        low: PAUSE_LOW,
      });
      releasePeerGate = pause.release;
      activeWire = wire;
      void hub.accept(wire.hubEnd, { token: TEST_TOKEN });
      return pause.end;
    },
    timer: peerNode.scheduler,
    targets: [
      { namespaceId: nsA, localOwner: PEER_OWNER },
      { namespaceId: nsB, localOwner: PEER_OWNER },
    ],
    limits: opts.peerLimits,
    timeouts,
    observer: peerEvents.observer,
    chunkedUpdate: true,
  });

  peer.start();
  await settleUntil(() => peer.getConnectionState() === 'ready', '连接 ready');
  await settleUntil(() => peer.getNamespaceState(nsA) === 'live', 'nsA live');
  await settleUntil(() => peer.getNamespaceState(nsB) === 'live', 'nsB live');

  return {
    hubNode,
    peerNode,
    hub,
    peer,
    nsA,
    nsB,
    peerEvents: peerEvents.events,
    hubEvents: hubEvents.events,
    getWire: () => {
      if (activeWire === undefined) throw new Error('peer 尚未拨号');
      return activeWire;
    },
    peerWrite: async (nsId, value) => {
      const business = okLease(await peerNode.registry.open(PEER_OWNER, nsId));
      await schemaReady(business);
      for (const [key, v] of Object.entries(value)) {
        const result = await business.mutateData({ op: 'set', path: [key], value: v });
        if (!result.ok) throw new Error(`业务写失败：${JSON.stringify(result)}`);
      }
      await business.release();
    },
    frames: (dir, filterNs) =>
      (dir === 'peerToHub' ? activeWire?.peerToHub : activeWire?.hubToPeer)!
        .map((bytes) => decodeWire(bytes))
        .filter((f) => filterNs === undefined || (f.message as { namespaceId?: string }).namespaceId === filterNs),
    chunks: (dir) => {
      const wire = activeWire!;
      const list = dir === 'peerToHub' ? wire.peerToHub : wire.hubToPeer;
      const out: ChunkMsg[] = [];
      for (const bytes of list) {
        const decoded = decodeWire(bytes);
        if (decoded.message.kind === 'UPDATE_CHUNK') out.push(decoded.message as ChunkMsg);
      }
      return out;
    },
    rootValue: (side, nsId, key) => {
      const node = side === 'hub' ? hubNode : peerNode;
      const owner = side === 'hub' ? HUB_OWNER : PEER_OWNER;
      const doc = node.persistence.peek(owner, nsId);
      if (doc === undefined) throw new Error(`${side} 缺副本 ${nsId}`);
      return (doc.getMap('ROOT') as unknown as Map<string, unknown>).get(key);
    },
    releasePeer: () => {
      if (releasePeerGate === undefined) throw new Error('peer 尚未拨号');
      releasePeerGate();
    },
    advance: async (ms) => {
      // 双端虚拟时钟同步推进（timer 归属各自节点 scheduler；水位 poll = ackTimeoutMs/100）
      await peerNode.scheduler.advanceBy(ms);
      await hubNode.scheduler.advanceBy(ms);
      await settle();
    },
  };
}

// ═══════════════════════════ 观测辅助 ═══════════════════════════

function syncRoundFrames(ctx: LiveContext): DecodedMessage[] {
  return [...ctx.frames('peerToHub'), ...ctx.frames('hubToPeer')].filter((f) =>
    ['SYNC_STEP1', 'SYNC_STEP2', 'SYNC_APPLIED'].includes(f.message.kind),
  );
}

function ackFrames(ctx: LiveContext, dir: 'peerToHub' | 'hubToPeer', nsId: string): AckMsg[] {
  return ctx
    .frames(dir, nsId)
    .filter((f): f is { header: DecodedMessage['header']; message: AckMsg } => f.message.kind === 'UPDATE_ACK')
    .map((f) => f.message);
}

function nsErrorFrames(ctx: LiveContext, dir: 'peerToHub' | 'hubToPeer'): string[] {
  return ctx
    .frames(dir)
    .filter((f) => f.message.kind === 'ERROR')
    .map((f) => (f.message as Extract<DecodedMessage['message'], { kind: 'ERROR' }>).code);
}

function resyncFrames(ctx: LiveContext, dir: 'peerToHub' | 'hubToPeer'): number {
  return ctx.frames(dir).filter((f) => f.message.kind === 'RESYNC_REQUIRED').length;
}

function failedEvents(events: ReplicationObserverEvent[]): ReplicationObserverEvent[] {
  return events.filter((e) => e.type === 'namespace-failed');
}

// ═══════════════════════════ 契约测试 ═══════════════════════════

describe('issue #243 切片 2 实现轮：协商 CAP_CHUNKED_UPDATE 分块 live 传输（knob-on/off 绿灯镜像与修订面）', () => {
  it('K0（knob-off 缺省）：HELLO.optionalCapabilities=0（v1 wire 逐字节——协商位零漂移）', async () => {
    const ctx = await bootChunked({ knob: false });
    try {
      const wire = ctx.getWire();
      const hello = decodeWire(wire.peerToHub[0]!);
      expect(hello.message.kind).toBe('HELLO');
      const helloMsg = hello.message as Extract<DecodedMessage['message'], { kind: 'HELLO' }>;
      expect(helloMsg.optionalCapabilities).toBe(0);
      expect(helloMsg.optionalCapabilities & CAP_CHUNKED_UPDATE).toBe(0);
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });

  it('K1（knob-on 镜像 P1/P2 + N2 事件配对）：协商位经真握手建立；超限 update 分块 live 传输——hub 收敛、零 resync、单 ACK=末 chunk 序、update-sent/acked/applied 三事件配对', async () => {
    const ctx = await bootChunked({ knob: true });
    try {
      const wire = ctx.getWire();
      // 协商面：HELLO 携带 optional 位、HELLO_ACK 携带 selected 位（hub 单点交集）
      const hello = decodeWire(wire.peerToHub[0]!);
      expect(hello.message.kind).toBe('HELLO');
      expect(
        (hello.message as Extract<DecodedMessage['message'], { kind: 'HELLO' }>).optionalCapabilities &
          CAP_CHUNKED_UPDATE,
      ).not.toBe(0);
      const helloAck = wire.hubToPeer.map((b) => decodeWire(b)).find((f) => f.message.kind === 'HELLO_ACK');
      expect(helloAck).toBeDefined();
      expect(
        (helloAck!.message as Extract<DecodedMessage['message'], { kind: 'HELLO_ACK' }>)
          .selectedCapabilities & CAP_CHUNKED_UPDATE,
        'HELLO_ACK.selected 必须携带交集位',
      ).not.toBe(0);

      const syncBaseline = syncRoundFrames(ctx).length;
      const savesBefore = ctx.hubNode.persistence.saveEvents.filter((e) => e.docId === ctx.nsId).length;
      await ctx.peerWrite({ blurb: BIG });
      await settleUntil(
        () =>
          ctx.rootValue('hub', 'blurb') === BIG &&
          ackFrames(ctx, 'hubToPeer', ctx.nsId).length === 1,
        'hub 收敛且单 ACK 到达',
      );

      // AC1：零 resync、零新增 SYNC
      expect(ctx.peerEvents.filter((e) => e.type === 'resync-required')).toHaveLength(0);
      expect(syncRoundFrames(ctx).length - syncBaseline).toBe(0);

      // AC2/AC8：帧形状
      const chunks = ctx.chunks('peerToHub');
      expect(chunks.length).toBeGreaterThanOrEqual(2);
      const maxUpdateBytes = LIMITS.maxUpdateBytes!;
      const maxFrameBytes = 8 * 1024 * 1024;
      for (const [index, chunk] of chunks.entries()) {
        expect(chunk.bytes.byteLength).toBeLessThanOrEqual(maxUpdateBytes);
        expect(chunk.chunkIndex).toBe(index);
      }
      expect(new Set(chunks.map((c) => c.transferId)).size).toBe(1);
      expect(new Set(chunks.map((c) => c.chunkCount)).size).toBe(1);
      expect(new Set(chunks.map((c) => c.totalBytes)).size).toBe(1);
      expect(chunks.reduce((s, c) => s + c.bytes.byteLength, 0)).toBe(chunks[0]!.totalBytes);
      // 帧全长上限（wire 字节级）
      for (const bytes of wire.peerToHub) {
        if (decodeWire(bytes).message.kind === 'UPDATE_CHUNK') {
          expect(bytes.byteLength).toBeLessThanOrEqual(maxFrameBytes);
        }
      }

      // AC3：hub 恰一次 dirty
      const savesAfter = ctx.hubNode.persistence.saveEvents.filter((e) => e.docId === ctx.nsId).length;
      expect(savesAfter - savesBefore).toBe(1);

      // AC5 + N2：单 ACK；ackedSequence = 末 chunk 帧序；三事件面配对（序列关联键）
      const lastChunkSeq = ctx
        .frames('peerToHub')
        .filter((f) => f.message.kind === 'UPDATE_CHUNK')
        .at(-1)!.header.sequence;
      const acks = ackFrames(ctx, 'hubToPeer', ctx.nsId);
      expect(acks).toHaveLength(1);
      expect(acks[0]!.ackedSequence).toBe(lastChunkSeq);
      const totalBytes = chunks[0]!.totalBytes;
      const sent = ctx.peerEvents.filter(
        (e): e is Extract<ReplicationObserverEvent, { type: 'update-sent' }> => e.type === 'update-sent',
      );
      const sentFinal = sent.find((e) => e.sequence === lastChunkSeq);
      expect(sentFinal).toBeDefined();
      expect(sentFinal!.bytes).toBe(totalBytes);
      expect(sent.length, '中间 chunk 不发射 update-sent（仅末 chunk）').toBe(1);
      const acked = ctx.peerEvents.find(
        (e): e is Extract<ReplicationObserverEvent, { type: 'update-acked' }> =>
          e.type === 'update-acked' && e.sequence === lastChunkSeq,
      );
      expect(acked).toBeDefined();
      expect(acked!.bytes).toBe(totalBytes);
      const applied = ctx.hubEvents.find(
        (e): e is Extract<ReplicationObserverEvent, { type: 'update-applied' }> =>
          e.type === 'update-applied' && e.sequence === lastChunkSeq,
      );
      expect(applied).toBeDefined();
      expect(applied!.bytes).toBe(totalBytes);

      expect(ctx.peer.getNamespaceState(ctx.nsId)).toBe('live');
      expect(ctx.peer.getConnectionState()).toBe('ready');
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });

  it('K2（hub→peer 方向镜像）：hub 业务写超限 → hub 通道分块下行 → peer 收齐恰一次 apply + 单 ACK', async () => {
    const ctx = await bootChunked({ knob: true });
    try {
      const savesBefore = ctx.peerNode.persistence.saveEvents.filter((e) => e.docId === ctx.nsId).length;
      await ctx.hubWrite({ blurb: BIG });
      await settleUntil(
        () =>
          ctx.rootValue('peer', 'blurb') === BIG &&
          ackFrames(ctx, 'peerToHub', ctx.nsId).length === 1,
        'peer 收敛且单 ACK 回程',
      );
      const chunks = ctx.chunks('hubToPeer');
      expect(chunks.length).toBeGreaterThanOrEqual(2);
      const lastChunkSeq = ctx
        .frames('hubToPeer')
        .filter((f) => f.message.kind === 'UPDATE_CHUNK')
        .at(-1)!.header.sequence;
      const acks = ackFrames(ctx, 'peerToHub', ctx.nsId);
      expect(acks).toHaveLength(1);
      expect(acks[0]!.ackedSequence).toBe(lastChunkSeq);
      expect(ctx.peerEvents.filter((e) => e.type === 'resync-required')).toHaveLength(0);
      const savesAfter = ctx.peerNode.persistence.saveEvents.filter((e) => e.docId === ctx.nsId).length;
      expect(savesAfter - savesBefore, 'peer 恰一次 apply → dirty 恰一次').toBe(1);
      expect(ctx.peer.getNamespaceState(ctx.nsId)).toBe('live');
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });

  it('K3（P4-S，D2 回退）：协商连接上 bytes > maxChunkedUpdateBytes → v1 同刻同形回退——零 chunk、丢弃 + needs-resync、round diff 恢复', async () => {
    const tight: Readonly<Partial<ReplicationLimits>> = {
      ...LIMITS,
      maxChunkedUpdateBytes: 6 * 1024, // < 大写 20KB → 不可分块
    };
    const ctx = await bootChunked({ knob: true, hubLimits: tight, peerLimits: tight });
    try {
      await ctx.peerWrite({ blurb: BIG });
      await settleUntil(
        () => ctx.rootValue('hub', 'blurb') === BIG && ctx.peer.getNamespaceState(ctx.nsId) === 'live',
        'v1 round 恢复后收敛且回 live',
      );
      await settle();
      expect(ctx.chunks('peerToHub'), '不可分块超限项必须零 chunk 帧').toHaveLength(0);
      expect(ctx.frames('peerToHub', ctx.nsId).filter((f) => f.message.kind === 'UPDATE')).toHaveLength(0);
      const resyncs = ctx.peerEvents.filter((e): e is ResyncEvent => e.type === 'resync-required');
      expect(resyncs).toHaveLength(1);
      expect(resyncs[0]!.cause).toBe('send-failed');
      expect(resyncs[0]!.reason, '超上限回退的失败子因 = update-too-large（v1 同形）').toBe('update-too-large');
      expect(ctx.peer.getNamespaceState(ctx.nsId)).toBe('live');
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });

  it('K4（P4-R，D1 有界分配）：首 chunk 申报 totalBytes > maxChunkedUpdateBytes → UPDATE_TRANSFER_TOO_LARGE、ns 级收口、apply 前零写入', async () => {
    const ctx = await bootChunked({
      knob: true,
      hubLimits: { ...LIMITS, maxChunkedUpdateBytes: 10 * 1024 }, // hub 上界 10KiB < 20KB 申报
      peerLimits: LIMITS, // peer 端仍可分块（不对称端点是合法组态）
    });
    try {
      const hubBlurbBefore = ctx.rootValue('hub', 'blurb');
      const hubSavesBefore = ctx.hubNode.persistence.saveEvents.filter((e) => e.docId === ctx.nsId).length;
      await ctx.peerWrite({ blurb: BIG });
      await settleUntil(
        () =>
          ctx.hubEvents.some((e) => e.type === 'namespace-failed') &&
          ctx.frames('hubToPeer', ctx.nsId).some((f) => f.message.kind === 'ERROR'),
        'hub 首 chunk 上界违例收口',
      );
      await settle();
      expect(ctx.chunks('peerToHub').length, '发送端按自身配置正常分块出站').toBeGreaterThanOrEqual(2);
      expect(nsErrorFrames(ctx, 'hubToPeer')).toContain('UPDATE_TRANSFER_TOO_LARGE');
      expect(failedEvents(ctx.hubEvents).length, 'hub ns 终局 failed（TOO_LARGE = fatal/config 族）').toBe(1);
      // 分配前拒绝 → apply 前零写入（live Y.Doc 零写入——AC3）
      expect(ctx.rootValue('hub', 'blurb')).toBe(hubBlurbBefore);
      expect(ctx.hubNode.persistence.saveEvents.filter((e) => e.docId === ctx.nsId).length).toBe(hubSavesBefore);
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });

  it('K5（AC8 结构违例）：busy assembly ∧ 异 transferId 首 chunk → UPDATE_TRANSFER_VIOLATION、ns 级收口、零 apply', async () => {
    const ctx = await bootChunked({ knob: true });
    try {
      const wire = ctx.getWire();
      const hubBlurbBefore = ctx.rootValue('hub', 'blurb');
      const nextSeq = () =>
        ctx.frames('peerToHub').reduce((max, f) => Math.max(max, f.header.sequence), 0) + 1;
      // (a) 合法 chunk0（transferId=1，chunkCount=3）——hub assembly busy
      wire.peerEnd.send(
        encodeMessage(
          {
            kind: 'UPDATE_CHUNK',
            namespaceId: ctx.nsId,
            transferId: 1,
            chunkIndex: 0,
            chunkCount: 3,
            totalBytes: 2400,
            bytes: new Uint8Array(800),
          },
          { sequence: nextSeq() },
        ),
      );
      await settle();
      // (b) 不同 transferId 的 chunk0 撞 busy assembly → 校验 1（busy ∧ 异 id）VIOLATION
      wire.peerEnd.send(
        encodeMessage(
          {
            kind: 'UPDATE_CHUNK',
            namespaceId: ctx.nsId,
            transferId: 2,
            chunkIndex: 0,
            chunkCount: 3,
            totalBytes: 2400,
            bytes: new Uint8Array(800),
          },
          { sequence: nextSeq() },
        ),
      );
      await settleUntil(
        () => ctx.hubEvents.some((e) => e.type === 'namespace-failed'),
        'hub busy-冲突违例收口',
      );
      await settle();
      expect(nsErrorFrames(ctx, 'hubToPeer')).toContain('UPDATE_TRANSFER_VIOLATION');
      expect(failedEvents(ctx.hubEvents).length).toBe(1);
      expect(ctx.rootValue('hub', 'blurb'), '重组失败先于 apply——live Y.Doc 零写入').toBe(hubBlurbBefore);
      // 未完成 assembly 不得 apply：无 ACK、无 dirty
      expect(ackFrames(ctx, 'hubToPeer', ctx.nsId)).toHaveLength(0);
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });

  it('K6（F1 未协商混合队列负控）：队列滞留项 + 超限写 → v1 drain 窗口语义——F4 静默丢弃 + update-dropped{update-too-large}、零额外 RESYNC、排队项照发', async () => {
    const ctx = await bootChunked({
      knob: false,
      peerLimits: { maxUpdateBytes: 8 * 1024, maxQueuedUpdateCount: 100, maxQueuedUpdateBytes: 1 * 1024 * 1024, maxInFlightUpdates: 2 },
    });
    try {
      // hub save 门闩：阻塞 ACK → 窗口保持满 → A1/A2 直发占满 2 槽后 B（超限）与 C 排队。
      // （注：门闩 + 多笔排队 apply 下的 hub 持久化投影存在 v1 基线既有的怪异性——已
      // 在 HEAD 独立复现（探针），非 slice 2 引入；本测试的 F1 断言面 = 发送端 v1
      // drain 窗口语义，全部经 wire 帧/observer 事件断言，不读 hub 文档投影。）
      ctx.hubNode.persistence.saveGate = deferred();
      await ctx.peerWrite({ n: 2 }); // A1
      await ctx.peerWrite({ n: 3 }); // A2
      await ctx.peerWrite({ blurb: BIG }); // B：> maxUpdateBytes（未协商 → 不可分块）
      await ctx.peerWrite({ n: 4 }); // C
      await settle();
      const gate = ctx.hubNode.persistence.saveGate;
      ctx.hubNode.persistence.saveGate = undefined;
      if (gate !== undefined) gate.resolve();
      await settleUntil(
        () =>
          ctx.peer.getNamespaceState(ctx.nsId) === 'live' &&
          ctx.frames('peerToHub', ctx.nsId).filter((f) => f.message.kind === 'UPDATE').length === 3 &&
          ctx.peerEvents.some((e) => e.type === 'update-dropped'),
        'A1/A2/C 全部出站且 peer 回 live',
      );
      await settle();
      // v1 逐字节：零 chunk 帧、零 RESYNC 帧、超限项静默丢弃（队列非空 → 无 resync 声明）
      expect(ctx.chunks('peerToHub'), '未协商连接零 UPDATE_CHUNK 帧').toHaveLength(0);
      expect(resyncFrames(ctx, 'peerToHub'), 'F4 静默丢弃路径零额外 RESYNC（v1 drain 时刻判定）').toBe(0);
      expect(ctx.peerEvents.filter((e) => e.type === 'resync-required')).toHaveLength(0);
      const dropped = ctx.peerEvents.filter(
        (e): e is Extract<ReplicationObserverEvent, { type: 'update-dropped' }> =>
          e.type === 'update-dropped',
      );
      expect(dropped, '超限项静默丢弃恰一次 update-dropped（v1 形状不变）').toHaveLength(1);
      expect(dropped[0]!.reason).toBe('update-too-large');
      expect(dropped[0]!.updateBytes).toBeGreaterThan(8 * 1024);
      // 排队项照发：A1/A2（B 之前）与 C（B 之后）各以单 UPDATE 帧出站——FIFO 与
      // 「消费即进展」语义保持（B 自身永不上 wire——hub 零 UPDATE_TOO_LARGE 违例）
      const updates = ctx.frames('peerToHub', ctx.nsId).filter((f) => f.message.kind === 'UPDATE');
      expect(updates).toHaveLength(3);
      for (const u of updates) {
        expect((u.message as Extract<DecodedMessage['message'], { kind: 'UPDATE' }>).update.byteLength).toBeLessThanOrEqual(8 * 1024);
      }
      expect(nsErrorFrames(ctx, 'hubToPeer'), '超限项未上 wire → hub 零 UPDATE_TOO_LARGE 违例').not.toContain('UPDATE_TOO_LARGE');
      expect(ctx.hubEvents.filter((e) => e.type === 'update-applied'), 'hub 恰收三笔合法帧并 apply').toHaveLength(3);
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });
  it('K7（F2 queue-overflow 中途终止）：transfer 中并发写触发队列溢出 → 单点终止（无后续 chunk、无僵尸续传）、对端 ns 不 failed、round 收敛', async () => {
    const ctx = await bootChunked({
      knob: true,
      peerLimits: { ...LIMITS, maxQueuedUpdateCount: 1 }, // 载体占 1 槽后第二笔超限写即溢出
      pausePeerAfterDataFrames: 1, // chunk0 出站后停摆 → transfer 在场且 hub assembly busy
    });
    try {
      const release = ctx.pausePeer;
      expect(release).toBeDefined();
      await ctx.peerWrite({ blurb: BIG }); // T1 chunk0 出站后暂停
      await settle();
      await ctx.peerWrite({ blurb: BIG2 }); // 队列满（载体在队）→ 溢出：丢弃 + RESYNC
      await settle();
      expect(resyncFrames(ctx, 'peerToHub'), 'queue-overflow 必须发 wire RESYNC（弃置路径 1）').toBe(1);
      const overflowResyncs = ctx.peerEvents.filter(
        (e): e is ResyncEvent => e.type === 'resync-required' && e.cause === 'queue-overflow',
      );
      expect(overflowResyncs).toHaveLength(1);
      // 恢复 round 收敛（两笔内容都经 state-vector diff 修复）
      release!();
      await settleUntil(
        () => ctx.rootValue('hub', 'blurb') === BIG2 && ctx.peer.getNamespaceState(ctx.nsId) === 'live',
        'round 收敛且回 live',
      );
      await settle();
      // 中止后无续传：peer→hub 只存在 T1 的中止前缀（无 T2、无 chunkIndex 续传）
      const chunks = ctx.chunks('peerToHub');
      expect(chunks.length, 'transfer 随队列溢出单点终止——不再有 chunk 出站').toBe(1);
      expect(chunks[0]!.chunkIndex).toBe(0);
      expect(failedEvents(ctx.hubEvents), '对端 ns 不得因中止 transfer 终局 failed').toHaveLength(0);
      expect(failedEvents(ctx.peerEvents)).toHaveLength(0);
      expect(ctx.peer.getNamespaceState(ctx.nsId)).toBe('live');
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });

  it('K8（F6 peer→hub，协商）：ack-timeout 弃置时有 chunked transfer 在场 → 恰一帧 wire RESYNC_REQUIRED（漏斗）→ hub doomed assembly 清理 → round 收敛 → 新 transferId 整笔重收，hub ns 零 failed', async () => {
    const ctx = await bootChunked({
      knob: true,
      timeouts: { ackTimeoutMs: 400 },
      pausePeerAfterDataFrames: 2, // S(1) + chunk0(2) 后停摆 → transfer 中途在场
    });
    try {
      const release = ctx.pausePeer;
      expect(release).toBeDefined();
      // 混合窗口：直发 S 在途但 ACK 迟滞（hub save 门闩 → S 已入 hub 但无 ACK →
      // ack timer 到期触发弃置；帧序保持完整——wire 丢帧会破坏接收端序列纪律）
      ctx.hubNode.persistence.saveGate = deferred();
      await ctx.peerWrite({ n: 9 }); // S（direct UPDATE；hub 已收未 ACK）
      await ctx.peerWrite({ blurb: BIG }); // T1：chunk0 出站后 data 闸门暂停
      await settle();
      expect(ctx.chunks('peerToHub'), 'T1 前缀已出站（中止前状态）').toHaveLength(1);
      expect(ctx.rootValue('hub', 'blurb'), 'hub 只收 chunk0——未 apply').toBe('seed');

      // ackTimeout 到期 → abandonInFlight（abortedTransfer=true）→ peer 漏斗 RESYNC；
      // 放行 hub save 门闩（round 的 hub 侧 apply 与随后的 T2 需要）
      await ctx.advance(450);
      const k8gate = ctx.hubNode.persistence.saveGate;
      ctx.hubNode.persistence.saveGate = undefined;
      if (k8gate !== undefined) k8gate.resolve();
      await settleUntil(
        () =>
          resyncFrames(ctx, 'peerToHub') === 1 &&
          ctx.rootValue('hub', 'blurb') === BIG,
        'peer 弃置时刻声明 + 恢复 round 收敛',
      );
      await settle();
      expect(resyncFrames(ctx, 'peerToHub'), 'F6 子路径恰一帧 RESYNC_REQUIRED（仅协商连接）').toBe(1);
      const ackTimeoutResyncs = ctx.peerEvents.filter(
        (e): e is ResyncEvent => e.type === 'resync-required' && e.cause === 'ack-timeout',
      );
      expect(ackTimeoutResyncs, 'observer 面恰一次 resync-required{ack-timeout}（漏斗 emit，cause 不变）').toHaveLength(1);
      // hub 侧收 RESYNC：markResyncReceived + 清 doomed assembly（挂点 1）→ 零 violation
      expect(failedEvents(ctx.hubEvents), 'hub ns 不得因 T1 中途弃置终局 failed').toHaveLength(0);

      // 放行 data 闸门 → 恢复后 drain 以新 transferId 整笔重传 → hub 干净 assembly 收齐
      release!();
      await ctx.advance(10);
      await settleUntil(
        () => ctx.rootValue('hub', 'blurb') === BIG && ctx.peer.getNamespaceState(ctx.nsId) === 'live',
        'T2 重收且回 live',
      );
      await settle();
      const chunks = ctx.chunks('peerToHub');
      const t2 = chunks.filter((c) => c.transferId === 2);
      expect(t2.length, '新 transferId 整笔重传（T2 = transferId 2，从 chunk 0 起）').toBe(3);
      for (const [index, chunk] of t2.entries()) {
        expect(chunk.chunkIndex).toBe(index);
      }
      expect(failedEvents(ctx.hubEvents)).toHaveLength(0);
      expect(ctx.peer.getNamespaceState(ctx.nsId)).toBe('live');
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });

  it('K9（F6 hub→peer，协商）：对偶构型——hub ack-timeout 弃置在场 transfer → hub 既有漏斗 wire RESYNC（对称）→ peer 清理 doomed assembly → round 收敛 → 重收，peer ns 零 failed', async () => {
    const ctx = await bootChunked({
      knob: true,
      timeouts: { ackTimeoutMs: 400 },
      pauseHubAfterDataFrames: 2, // S(1) + chunk0(2) 后停摆（hub 出站）
    });
    try {
      const release = ctx.pauseHub;
      expect(release).toBeDefined();
      // 对偶构型：hub 直发 S 在途但 ACK 迟滞（peer save 门闩 → S 已入 peer 未 ACK）
      ctx.peerNode.persistence.saveGate = deferred();
      await ctx.hubWrite({ n: 9 }); // S（direct hub→peer；peer 已收未 ACK）
      await ctx.hubWrite({ blurb: BIG }); // T1（hub→peer）：chunk0 后暂停
      await settle();
      expect(ctx.chunks('hubToPeer')).toHaveLength(1);
      expect(ctx.rootValue('peer', 'blurb'), 'peer 只收 chunk0——未 apply').toBe('seed');

      await ctx.advance(450); // hub ack timer 到期 → abandon + declareHubResync('ack-timeout')
      const k9gate = ctx.peerNode.persistence.saveGate;
      ctx.peerNode.persistence.saveGate = undefined;
      if (k9gate !== undefined) k9gate.resolve();
      await settleUntil(
        () =>
          resyncFrames(ctx, 'hubToPeer') === 1 &&
          ctx.rootValue('peer', 'blurb') === BIG,
        'hub 声明 + 恢复 round 收敛',
      );
      await settle();
      expect(resyncFrames(ctx, 'hubToPeer'), 'hub 弃置路径既有 wire 声明（F6 对称面）').toBe(1);
      expect(failedEvents(ctx.peerEvents), 'peer ns 不得因 T1 中途弃置终局 failed').toHaveLength(0);
      expect(failedEvents(ctx.hubEvents)).toHaveLength(0);

      release!();
      await ctx.advance(10);
      await settleUntil(
        () => ctx.rootValue('peer', 'blurb') === BIG && ctx.peer.getNamespaceState(ctx.nsId) === 'live',
        'T2 重收且 peer 回 live',
      );
      await settle();
      const t2 = ctx.chunks('hubToPeer').filter((c) => c.transferId === 2);
      expect(t2.length, 'hub 侧新 transferId 整笔重传').toBe(3);
      for (const [index, chunk] of t2.entries()) {
        expect(chunk.chunkIndex).toBe(index);
      }
      expect(ctx.peer.getNamespaceState(ctx.nsId)).toBe('live');
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });

  it('K10（F6 未协商负控）：无 chunked transfer 的 ack-timeout（结构性不可达面）→ PN6b 原体——零 RESYNC_REQUIRED 帧、本地边沿 + round 恢复', async () => {
    const ctx = await bootChunked({ knob: false, timeouts: { ackTimeoutMs: 400 } });
    try {
      ctx.hubNode.persistence.saveGate = deferred();
      await ctx.peerWrite({ blurb: 'small-1' }); // direct UPDATE（hub 已收未 ACK）
      await settle();
      await ctx.advance(450); // ack-timeout → abandon（结构性无 transfer → abortedTransfer=false）
      const k10gate = ctx.hubNode.persistence.saveGate;
      ctx.hubNode.persistence.saveGate = undefined;
      if (k10gate !== undefined) k10gate.resolve();
      await settleUntil(
        () => ctx.rootValue('hub', 'blurb') === 'small-1' && ctx.peer.getNamespaceState(ctx.nsId) === 'live',
        'PN6b 本地边沿 + round 恢复收敛',
      );
      await settle();
      expect(resyncFrames(ctx, 'peerToHub'), '未协商 ack-timeout 零 wire RESYNC（v1 逐字节）').toBe(0);
      const ackTimeoutEvents = ctx.peerEvents.filter(
        (e): e is ResyncEvent => e.type === 'resync-required' && e.cause === 'ack-timeout',
      );
      expect(ackTimeoutEvents, 'PN6b 本地 observer 通知恰一次').toHaveLength(1);
      expect(failedEvents(ctx.hubEvents)).toHaveLength(0);
      expect(ctx.peer.getNamespaceState(ctx.nsId)).toBe('live');
      expect(ctx.peer.getConnectionState()).toBe('ready');
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });

  it('K11（F4 窗口混合穿插）：maxInFlightUpdates=2 下直发帧与 chunked transfer 穿插——任意时刻不超窗（末 chunk 注册后 ACK 前）、全量收敛、零 resync', async () => {
    const ctx = await bootChunked({
      knob: true,
      peerLimits: { ...LIMITS, maxInFlightUpdates: 2 },
    });
    try {
      await ctx.peerWrite({ n: 2 }); // 直发（窗口 1/2）
      await ctx.peerWrite({ n: 3 }); // 直发（窗口 2/2）
      await ctx.peerWrite({ blurb: BIG }); // 窗口满 → 入队 → ACK 后 transfer
      await ctx.peerWrite({ n: 4 }); // 排队（FIFO 在 transfer 之后）
      await settleUntil(
        () =>
          ctx.rootValue('hub', 'n') === 4 &&
          ctx.rootValue('hub', 'blurb') === BIG &&
          ackFrames(ctx, 'hubToPeer', ctx.nsId).length === 4,
        '四笔（2 UPDATE + transfer + 1 UPDATE）全量收敛',
      );
      await settle();
      expect(ctx.peerEvents.filter((e) => e.type === 'resync-required')).toHaveLength(0);
      const updates = ctx.frames('peerToHub', ctx.nsId).filter((f) => f.message.kind === 'UPDATE');
      expect(updates).toHaveLength(3);
      expect(ctx.chunks('peerToHub')).toHaveLength(3);
      expect(ctx.rootValue('hub', 'n')).toBe(4);
      expect(ctx.rootValue('hub', 'blurb')).toBe(BIG);
      expect(ctx.peer.getNamespaceState(ctx.nsId)).toBe('live');
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });

  it('K12（F3 残渣判别·live 防御面）：live 协商连接注入 idle∧chunkIndex>0 残渣形态 → fail-loud——UPDATE_TRANSFER_VIOLATION + ns 终局 failed、apply 前零写入（协议内不可达防御）', async () => {
    const ctx = await bootChunked({ knob: true });
    try {
      const wire = ctx.getWire();
      const hubBlurbBefore = ctx.rootValue('hub', 'blurb');
      const hubSavesBefore = ctx.hubNode.persistence.saveEvents.filter((e) => e.docId === ctx.nsId).length;
      const nextSeq = () =>
        ctx.frames('peerToHub').reduce((max, f) => Math.max(max, f.header.sequence), 0) + 1;
      // hub 空闲（无 busy assembly）且 live——残渣形态（首帧即 chunkIndex>0）
      wire.peerEnd.send(
        encodeMessage(
          {
            kind: 'UPDATE_CHUNK',
            namespaceId: ctx.nsId,
            transferId: 7,
            chunkIndex: 1,
            chunkCount: 3,
            totalBytes: 2400,
            bytes: new Uint8Array(800),
          },
          { sequence: nextSeq() },
        ),
      );
      await settleUntil(
        () => ctx.hubEvents.some((e) => e.type === 'namespace-failed'),
        'hub 残渣防御性收口',
      );
      await settle();
      expect(nsErrorFrames(ctx, 'hubToPeer')).toContain('UPDATE_TRANSFER_VIOLATION');
      expect(failedEvents(ctx.hubEvents).length, 'live 残渣形态 = 协议内不可达 → 响亮 VIOLATION').toBe(1);
      expect(ctx.rootValue('hub', 'blurb'), '违例先于 apply——live Y.Doc 零写入').toBe(hubBlurbBefore);
      expect(ctx.hubNode.persistence.saveEvents.filter((e) => e.docId === ctx.nsId).length).toBe(hubSavesBefore);
      expect(ackFrames(ctx, 'hubToPeer', ctx.nsId)).toHaveLength(0);
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });

  it('K13（F3 残渣判别·recovery 面）：对端 RESYNC 声明清 busy assembly 后，needs-resync 下到达的残渣 chunk → 良性丢弃——零 ERROR/零 failed/零 apply（合法 resync 恢复语义；非违例）', async () => {
    const ctx = await bootChunked({ knob: true });
    try {
      const wire = ctx.getWire();
      const hubBlurbBefore = ctx.rootValue('hub', 'blurb');
      const hubSavesBefore = ctx.hubNode.persistence.saveEvents.filter((e) => e.docId === ctx.nsId).length;
      const syncBaseline = syncRoundFrames(ctx).length;
      const nextSeq = () =>
        ctx.frames('peerToHub').reduce((max, f) => Math.max(max, f.header.sequence), 0) + 1;
      // (a) 合法 chunk0（transferId=1，chunkCount=3）——hub assembly busy
      wire.peerEnd.send(
        encodeMessage(
          {
            kind: 'UPDATE_CHUNK',
            namespaceId: ctx.nsId,
            transferId: 1,
            chunkIndex: 0,
            chunkCount: 3,
            totalBytes: 2400,
            bytes: new Uint8Array(800),
          },
          { sequence: nextSeq() },
        ),
      );
      await settle();
      // (b) 对端 wire RESYNC 声明（对齐序列注入）→ hub 挂点 1：清 busy assembly +
      // 置 resyncEpisode + needs-resync（hub 不发起 round——等待 peer；fake peer 静默 ⇒
      // hub 确定性停留 needs-resync，供残渣判别构造）
      wire.peerEnd.send(
        encodeMessage(
          {
            kind: 'RESYNC_REQUIRED',
            namespaceId: ctx.nsId,
            reasonCode: 'send-queue-overflow',
          },
          { sequence: nextSeq() },
        ),
      );
      await settleUntil(
        () => ctx.hubEvents.filter((e) => e.type === 'resync-required' && e.cause === 'remote-declared').length === 1,
        'hub 收 RESYNC 声明',
      );
      // (c) 同笔 transfer 的残渣 chunk1（声明弃置前已出站的帧）→ needs-resync ∧ idle ∧
      // chunkIndex>0 → 良性丢弃（resync 恢复的正常事件，非违例）
      wire.peerEnd.send(
        encodeMessage(
          {
            kind: 'UPDATE_CHUNK',
            namespaceId: ctx.nsId,
            transferId: 1,
            chunkIndex: 1,
            chunkCount: 3,
            totalBytes: 2400,
            bytes: new Uint8Array(800),
          },
          { sequence: nextSeq() },
        ),
      );
      await settle();
      expect(failedEvents(ctx.hubEvents), '残渣到达不得使 hub ns 终局 failed').toHaveLength(0);
      const hubErrors = nsErrorFrames(ctx, 'hubToPeer');
      expect(
        hubErrors.filter((code) => code === 'UPDATE_TRANSFER_VIOLATION' || code === 'UPDATE_TRANSFER_TOO_LARGE'),
        '残渣丢弃零 UPDATE_TRANSFER_* 违例帧（needs-resync 行 = 良性，非 fail-loud 行）',
      ).toHaveLength(0);
      expect(ctx.rootValue('hub', 'blurb'), '残渣丢弃不触发 apply——live Y.Doc 零写入').toBe(hubBlurbBefore);
      expect(ctx.hubNode.persistence.saveEvents.filter((e) => e.docId === ctx.nsId).length).toBe(hubSavesBefore);
      expect(ackFrames(ctx, 'hubToPeer', ctx.nsId), '未收齐不 ACK').toHaveLength(0);
      expect(syncRoundFrames(ctx).length - syncBaseline, '残渣丢弃零新增 SYNC 帧').toBe(0);
      expect(ctx.peer.getNamespaceState(ctx.nsId), 'fake peer 未参与注入——保持 live').toBe('live');
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });

  it('K14（F7 session 边沿中的 inbound transfer）：hub→peer transfer 进行中（peer busy assembly）+ peer session fanout 溢出边沿 → 声明经单漏斗（cause=session-fanout-overflow）∧ 本端 assembly 清除 + resyncEpisode 置位 → 恢复 round 收敛 → hub 新 transferId 首 chunk 正常收齐，peer ns 零 failed', async () => {
    const ctx = await bootChunked({ knob: true, pauseHubAfterDataFrames: 1 });
    try {
      const release = ctx.pauseHub;
      expect(release, 'hub data 闸门暂停代理必须在位').toBeDefined();
      const hubSavesBefore = ctx.hubNode.persistence.saveEvents.filter((e) => e.docId === ctx.nsId).length;
      // (a) hub→peer T1（transferId=1）：chunk0 出站后 data 闸门暂停 → peer busy assembly
      await ctx.hubWrite({ blurb: BIG });
      await settle();
      const t1Prefix = ctx.chunks('hubToPeer');
      expect(t1Prefix.length, 'T1 前缀（chunk0）已出站').toBe(1);
      expect(t1Prefix[0]!.chunkIndex).toBe(0);
      expect(ctx.rootValue('peer', 'blurb'), '只收 chunk0——未 apply').toBe('seed');

      // (b) peer session fanout 溢出边沿（20 笔并发本地写——FANOUT 16 容量溢出 → sticky
      // needsResync → watchdog 非 fence 谓词边沿 → onWatchdogEdge → 收敛后的单漏斗
      // declareLocalResync('session-fanout-overflow')，DD-8——本端 inbound（busy）assembly
      // 清除 + resyncEpisode 置位）
      const probe = collectUnhandledRejections();
      try {
        const lease = okLease(await ctx.peerNode.registry.open(PEER_OWNER, ctx.nsId));
        await schemaReady(lease);
        await Promise.all(
          Array.from({ length: 20 }, (_, i) =>
            lease.mutateData({ op: 'set', path: ['n'], value: i + 1 }),
          ),
        );
        await lease.release();
        await settleUntil(
          () => resyncFrames(ctx, 'peerToHub') === 1,
          'peer session 溢出边沿 → 漏斗 wire RESYNC（恰一帧）',
        );
        await settle();
        const sessionOverflow = ctx.peerEvents.filter(
          (e): e is ResyncEvent => e.type === 'resync-required' && e.cause === 'session-fanout-overflow',
        );
        expect(sessionOverflow, 'session 边沿声明必须经漏斗（cause=session-fanout-overflow）恰一次').toHaveLength(1);
        expect(resyncFrames(ctx, 'peerToHub'), 'F7 子路径恰一帧 RESYNC_REQUIRED').toBe(1);
        expect(failedEvents(ctx.peerEvents), '声明边不得使本端 ns 终局 failed').toHaveLength(0);

        // (c) hub 收声明 → 弃置 T1 载体（markResyncReceived → discardQueued）→ 无后续 T1 chunk
        release!();
        await settleUntil(
          () => ctx.peer.getNamespaceState(ctx.nsId) === 'live' && ctx.rootValue('peer', 'blurb') === BIG,
          '恢复 round 收敛（T1 数据经 round diff 回流 peer）且回 live',
        );
        await settle();
        const chunksAfterDeclare = ctx.chunks('hubToPeer');
        expect(
          chunksAfterDeclare.filter((c) => c.transferId === 1).length,
          'T1 弃置后不得有续传 chunk（单点终止）',
        ).toBe(1);
        expect(failedEvents(ctx.peerEvents), '恢复收敛后 peer ns 零 failed').toHaveLength(0);
        expect(failedEvents(ctx.hubEvents)).toHaveLength(0);

        // (d) 恢复后新超限写 → hub 新 transferId（2）整笔分块 → peer 干净 assembly 收齐
        // （声明边清除了 busy 残渣 + 结算边消费 resyncEpisode——新首 chunk 不撞 busy 冲突）
        await ctx.hubWrite({ blurb: BIG2 });
        await settleUntil(
          () =>
            ctx.rootValue('peer', 'blurb') === BIG2 &&
            ackFrames(ctx, 'peerToHub', ctx.nsId).length >= 1 &&
            ctx.peer.getNamespaceState(ctx.nsId) === 'live',
          'T2（transferId=2）整笔收齐且回 live',
        );
        await settle();
        const t2 = ctx.chunks('hubToPeer').filter((c) => c.transferId === 2);
        expect(t2.length, 'T2 整笔 3 chunk（新 transferId）').toBe(3);
        for (const [index, chunk] of t2.entries()) {
          expect(chunk.chunkIndex).toBe(index);
        }
        expect(ctx.rootValue('peer', 'blurb')).toBe(BIG2);
        expect(ctx.rootValue('hub', 'blurb')).toBe(BIG2);
        expect(ctx.hubNode.persistence.saveEvents.filter((e) => e.docId === ctx.nsId).length - hubSavesBefore).toBeGreaterThanOrEqual(1);
        expect(failedEvents(ctx.peerEvents), 'peer ns 全程零 failed（F7 窗口闭合）').toHaveLength(0);
        expect(ctx.peer.getNamespaceState(ctx.nsId)).toBe('live');
        await settle();
        expect(probe.events, '零 unhandled rejection').toEqual([]);
      } finally {
        probe.dispose();
      }
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });

  it('K15（AC4 多 ns RR 穿插）：单连接双 ns——nsB 持续小写 + nsA 大写（3 chunk）同队列积压 → data 闸门释放后 drain 逐轮每 ns 恰一帧严格交替（chunk 与他 ns UPDATE 穿插、无饥饿），全量收敛零 resync', async () => {
    const ctx = await bootChunkedPair({
      pausePeerAfterDataFrames: 1,
      peerLimits: LIMITS,
      timeouts: { ackTimeoutMs: 400 }, // 水位 poll 间隔 = ackTimeoutMs/100 = 4ms（虚拟推进可触发恢复）
    });
    try {
      // (a) 首笔直发（闸门暂停代理：第 1 个 data 帧出站后 highWater 抬升 → data 闸门关）
      await ctx.peerWrite(ctx.nsB, { n: 1 });
      await settle();
      // (b) 闸门关期间积压：nsB 三笔小写 + nsA 一笔大写（chunkable，20KB→3 chunk）
      await ctx.peerWrite(ctx.nsB, { n: 2 });
      await ctx.peerWrite(ctx.nsB, { n: 3 });
      await ctx.peerWrite(ctx.nsA, { blurb: BIG });
      await ctx.peerWrite(ctx.nsB, { n: 4 });
      await settle();
      // (c) 释放闸门 → RR drain：wheel 每轮每 ns 至多一帧 → nsB(2) nsA(c0) nsB(3) nsA(c1)
      //     nsB(4) nsA(c2)——chunk 帧与另一 ns 的 UPDATE 帧逐轮交替，无任何 ns 饿死
      ctx.releasePeer();
      await ctx.advance(10); // 水位 poll（4ms）触发 resume → 立即 drain（RR 逐轮每 ns 一帧）
      await settleUntil(
        () =>
          ctx.rootValue('hub', ctx.nsA, 'blurb') === BIG &&
          ctx.rootValue('hub', ctx.nsB, 'n') === 4 &&
          ctx.peer.getNamespaceState(ctx.nsA) === 'live' &&
          ctx.peer.getNamespaceState(ctx.nsB) === 'live',
        '双 ns 全量收敛且回 live',
      );
      await settle();
      const dataFrames = ctx
        .frames('peerToHub')
        .filter((f) => f.message.kind === 'UPDATE' || f.message.kind === 'UPDATE_CHUNK');
      const kinds = dataFrames.map((f) => f.message.kind);
      const nsIds = dataFrames.map((f) => (f.message as { namespaceId: string }).namespaceId);
      // 帧序 = B1(直发,闸门关闭前) + [B2, A0, B3, A1, B4, A2]（drain 释放后逐轮交替段）
      expect(kinds).toEqual([
        'UPDATE',
        'UPDATE',
        'UPDATE_CHUNK',
        'UPDATE',
        'UPDATE_CHUNK',
        'UPDATE',
        'UPDATE_CHUNK',
      ]);
      expect(nsIds).toEqual([ctx.nsB, ctx.nsB, ctx.nsA, ctx.nsB, ctx.nsA, ctx.nsB, ctx.nsA]);
      const aChunks = ctx.chunks('peerToHub').filter((c) => c.namespaceId === ctx.nsA);
      expect(aChunks.length, 'nsA 整笔 3 chunk（逐轮穿插出站）').toBe(3);
      for (const [index, chunk] of aChunks.entries()) {
        expect(chunk.chunkIndex).toBe(index);
        expect(chunk.transferId).toBe(aChunks[0]!.transferId);
      }
      expect(ctx.peerEvents.filter((e) => e.type === 'resync-required'), 'RR 穿插全程零 resync').toHaveLength(0);
      expect(ctx.peerEvents.filter((e) => e.type === 'namespace-failed')).toHaveLength(0);
      expect(ctx.hubEvents.filter((e) => e.type === 'namespace-failed')).toHaveLength(0);
      expect(ctx.rootValue('hub', ctx.nsA, 'blurb')).toBe(BIG);
      expect(ctx.rootValue('hub', ctx.nsB, 'n')).toBe(4);
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });
});
