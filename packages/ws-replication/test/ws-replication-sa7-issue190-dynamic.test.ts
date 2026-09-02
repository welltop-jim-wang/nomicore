/**
 * SA7 动态补充 —— issue #190：`acceptTrusted`/`accept` 共享有界早到帧 admission 的
 * 边界值、双入口 parity 与 token 路径保真（AC4）。
 *
 * 与 SA6 红灯文件（ws-replication-issue190-red.test.ts，越界面拒绝语义）互补：
 * - B1 恰 16 帧（= MAX_EARLY_FRAMES 契约值）：条数界是「第 17 帧才拒」——恰在界值
 *   的积压必须被接纳（零帧限拒绝、零 auth-upgrade-rejected 事件、连接照常分配）。
 *   下游 1002/'protocol-error' 是既有构造尾重放对非 HELLO 字节的收口语义（非
 *   admission 拒绝面），断言目标 = admission 观测面不出现 'upgrade-frame-limit'。
 * - B2 恰 maxFrameBytes 单帧：单帧界为严格不等式（`>`）——等值帧必须被接纳
 *   （零 1009、零拒绝事件、连接照常分配）。
 * - P1/P2 accept()（token 验证路径）parity：共享机制在 token 路径同样发射
 *   observer `auth-upgrade-rejected`（'frame-too-large'/'early-frame-limit'）+
 *   close(1009|1008, 'upgrade-frame-limit') + 恒 resolve undefined + 零分配 +
 *   验证器零调用（admission 拒绝先于门 4——A2-e 锚未覆盖 observer/验证器面）。
 * - F1 AC4 保真（绿灯）：常规 token 验证行为不变——合法 bearer + 认证后合法
 *   HELLO → ready 连接 + 恰 1 个 HELLO_ACK 上 wire + 零拒绝事件。
 *
 * 红线纪律（与 SA6 同源）：零源码 grep 断言；零 mock 被测对象（fixture 级同步重放
 * transport / 内存双端 wire）；断言 = 可观察运行时行为。
 */
import { describe, expect, it } from 'vitest';
import { createHubReplication } from '@nomicore/ws-replication';
import type {
  DuplexTransport,
  HubReplication,
  PeerTokenVerifier,
  ReplicationObserver,
  ReplicationObserverEvent,
} from '@nomicore/ws-replication';
import { decodeMessage, encodeMessage } from '@nomicore/replication-protocol';
import { collectUnhandledRejections, makeAuthorizer, DEFAULT_PEER_VERIFIER, TEST_TOKEN } from './driver.js';
import { CONTRACT_LIMITS, HUB_INSTANCE, PEER_INSTANCE, makeNode, makeWire, settle } from './harness.js';

/** MAX_EARLY_FRAMES 契约值（§3.2 R2 A2：HELLO 为唯一合法早到帧，16 = 充裕余量）。 */
const MAX_EARLY_FRAMES = 16;

/** 同步重放型 transport（与 issue190-red fixture 同构；见 sa7-r2-transport:132-144）。 */
function makeReplayTransport(backlog: readonly Uint8Array[]): {
  readonly transport: DuplexTransport;
  replayedCount(): number;
  closeInfos(): ReadonlyArray<{ code: number; reason: string }>;
  sent(): ReadonlyArray<Uint8Array>;
} {
  let closed = false;
  let replayed = 0;
  const messageListeners = new Set<(bytes: Uint8Array) => void>();
  const closeListeners = new Set<(info: Readonly<{ code: number; reason: string }>) => void>();
  const closeInfos: Array<{ code: number; reason: string }> = [];
  const sent: Uint8Array[] = [];
  const transport: DuplexTransport = {
    send(bytes) {
      sent.push(bytes.slice());
    },
    close(code = 1000, reason = '') {
      if (closed) return;
      closed = true;
      closeInfos.push({ code, reason });
      for (const listener of [...closeListeners]) listener({ code, reason });
    },
    get closed() {
      return closed;
    },
    onMessage(listener) {
      messageListeners.add(listener);
      for (const bytes of backlog) {
        replayed += 1;
        listener(bytes);
      }
      return () => {
        messageListeners.delete(listener);
      };
    },
    onClose(listener) {
      closeListeners.add(listener);
      return () => {
        closeListeners.delete(listener);
      };
    },
  };
  return {
    transport,
    replayedCount: () => replayed,
    closeInfos: () => closeInfos,
    sent: () => sent,
  };
}

/** hub observer 收集器（零 mock：真实 ReplicationObserver 回调面）。 */
class HubEventCollector {
  readonly events: ReplicationObserverEvent[] = [];
  readonly observer: ReplicationObserver = (event) => {
    this.events.push(event);
  };
  rejectedReasons(): string[] {
    return this.events
      .filter(
        (e): e is Extract<ReplicationObserverEvent, { type: 'auth-upgrade-rejected' }> =>
          e.type === 'auth-upgrade-rejected',
      )
      .map((e) => e.reason);
  }
}

interface HubFixture {
  readonly hub: HubReplication;
  readonly events: HubEventCollector;
  readonly verifyCalls: string[];
}

/** 组装 hub（可注入验证器 spy；trusted/token 两路径共用）。 */
function makeHub(verifyToken?: PeerTokenVerifier): HubFixture {
  const node = makeNode('hub');
  const events = new HubEventCollector();
  const verifyCalls: string[] = [];
  const verifier: PeerTokenVerifier =
    verifyToken ??
    ((token) => {
      verifyCalls.push(token);
      return DEFAULT_PEER_VERIFIER(token);
    });
  const hub = createHubReplication({
    instanceId: HUB_INSTANCE,
    registry: node.registry,
    authorize: makeAuthorizer().authorize,
    timer: node.scheduler,
    verifyToken: verifier,
    observer: events.observer,
  });
  return { hub, events, verifyCalls };
}

describe('issue #190 SA7 补充：有界 admission 边界值 + 双入口 parity + AC4 保真', () => {
  it('B1：恰 16 帧（= MAX_EARLY_FRAMES）trusted 同步重放 → 界值内接纳：零帧限拒绝、连接照常分配', async () => {
    const replay = makeReplayTransport(
      Array.from({ length: MAX_EARLY_FRAMES }, (_, i) => new Uint8Array(32).fill(i)),
    );
    const { hub, events } = makeHub();
    const connection = await hub.acceptTrusted!(replay.transport, { peerInstanceId: PEER_INSTANCE });
    await settle();
    // admission 观测面：无 'upgrade-frame-limit' close、无 auth-upgrade-rejected、分配发生
    // （两遍重放 32 = admission 16 + 构造尾 16——帧被保留即被接纳的证据）；下游收口是
    // 既有非 HELLO 构造尾重放语义（1002/'protocol-error' + ERROR 帧上 wire）。
    expect(connection).toBeDefined();
    expect(replay.closeInfos().some((info) => info.reason === 'upgrade-frame-limit')).toBe(false);
    expect(events.rejectedReasons()).toEqual([]);
    expect(replay.replayedCount()).toBe(2 * MAX_EARLY_FRAMES);
    expect(replay.sent().length).toBe(1); // 收口 ERROR 帧（既有语义）
  });

  it('B2：恰 maxFrameBytes 单帧 trusted 同步重放 → 严格不等式界值内接纳：零 1009、连接照常分配', async () => {
    const replay = makeReplayTransport([new Uint8Array(CONTRACT_LIMITS.maxFrameBytes)]);
    const { hub, events } = makeHub();
    const connection = await hub.acceptTrusted!(replay.transport, { peerInstanceId: PEER_INSTANCE });
    await settle();
    expect(connection).toBeDefined();
    expect(replay.closeInfos().some((info) => info.code === 1009)).toBe(false);
    expect(replay.closeInfos().some((info) => info.reason === 'upgrade-frame-limit')).toBe(false);
    expect(events.rejectedReasons()).toEqual([]);
    expect(replay.replayedCount()).toBe(2); // admission 1 + 构造尾 1——等值帧被保留
  });

  it('P1：accept()（token 路径）单帧超界 → 与 trusted 同语义：1009 + observer frame-too-large + undefined + 验证器零调用', async () => {
    const probe = collectUnhandledRejections();
    try {
      const replay = makeReplayTransport([new Uint8Array(CONTRACT_LIMITS.maxFrameBytes + 1)]);
      const { hub, events, verifyCalls } = makeHub();
      const conn = await hub.accept(replay.transport, { token: TEST_TOKEN });
      expect({
        resolved: conn === undefined ? 'undefined' : 'allocated',
        closeInfos: replay.closeInfos(),
        connections: hub.connections.length,
        rejectedReasons: events.rejectedReasons(),
        verifyCalls,
        replayedCount: replay.replayedCount(),
      }).toEqual({
        resolved: 'undefined',
        closeInfos: [{ code: 1009, reason: 'upgrade-frame-limit' }],
        connections: 0,
        rejectedReasons: ['frame-too-large'],
        verifyCalls: [], // admission 拒绝发生在注册期同步段——先于门 4 验证
        replayedCount: 1,
      });
    } finally {
      probe.dispose();
    }
    expect(probe.events).toEqual([]);
  });

  it('P2：accept()（token 路径）17 帧 → 1008 + observer early-frame-limit + undefined + 验证器零调用', async () => {
    const probe = collectUnhandledRejections();
    try {
      const replay = makeReplayTransport(
        Array.from({ length: MAX_EARLY_FRAMES + 1 }, (_, i) => new Uint8Array(32).fill(i)),
      );
      const { hub, events, verifyCalls } = makeHub();
      const conn = await hub.accept(replay.transport, { token: TEST_TOKEN });
      expect({
        resolved: conn === undefined ? 'undefined' : 'allocated',
        closeInfos: replay.closeInfos(),
        connections: hub.connections.length,
        rejectedReasons: events.rejectedReasons(),
        verifyCalls,
        replayedCount: replay.replayedCount(),
      }).toEqual({
        resolved: 'undefined',
        closeInfos: [{ code: 1008, reason: 'upgrade-frame-limit' }],
        connections: 0,
        rejectedReasons: ['early-frame-limit'],
        verifyCalls: [],
        replayedCount: MAX_EARLY_FRAMES + 1,
      });
    } finally {
      probe.dispose();
    }
    expect(probe.events).toEqual([]);
  });

  it('F1（AC4 保真，绿灯）：常规 token 验证路径行为不变——合法 bearer + 认证后 HELLO → ready + 恰 1 个 HELLO_ACK', async () => {
    const wire = makeWire();
    const { hub, events, verifyCalls } = makeHub();
    const connection = await hub.accept(wire.hubEnd, { token: TEST_TOKEN });
    expect(connection).toBeDefined();
    expect(verifyCalls).toEqual([TEST_TOKEN]); // 认证照常先行
    // 认证完成后（admission 窗口外）合法 HELLO → HELLO_ACK（既有幸福路径不变）
    wire.peerEnd.send(
      encodeMessage(
        {
          kind: 'HELLO',
          peerInstanceId: PEER_INSTANCE,
          expectedHubInstanceId: HUB_INSTANCE,
          protocolVersions: [1],
          requiredCapabilities: 0,
          optionalCapabilities: 0,
          connectionNonce: new Uint8Array(16).fill(7),
        },
        { sequence: 1 },
      ),
    );
    await settle();
    expect(connection?.state).toBe('ready');
    const acks = wire.hubToPeer
      .map((bytes) => {
        try {
          return decodeMessage(bytes).message;
        } catch {
          return undefined;
        }
      })
      .filter((message) => message?.kind === 'HELLO_ACK');
    expect(acks.length).toBe(1);
    expect(events.rejectedReasons()).toEqual([]); // 零拒绝事件
  });
});
