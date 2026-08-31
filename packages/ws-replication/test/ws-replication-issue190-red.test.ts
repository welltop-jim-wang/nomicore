/**
 * SA6 红灯验收 —— issue #190（`acceptTrusted` 早到帧无界接纳：缺失 `accept()` 的
 * 有界 admission 门）。
 *
 * 锚定 `wiki/raw/task_ws-replication-bound-early-frame-admission-in-accepttrusted.md`
 * Required outcome / Acceptance criteria 1-3 + SA5 分析报告
 * `wiki/raw/20260831-bug-ws-replication-bound-early-frame-admission-in-accepttrusted.md`
 * （根因：hub-connection.ts:259-261 早到帧监听器无条件 `earlyFrames.push(bytes)`）。
 *
 * 契约（与 accept() 门 3 既有语义逐项对齐，见 A2-e 锚
 * `ws-replication-auth-lifecycle-red.test.ts:655-678`）：
 * - 单帧 > maxFrameBytes → 保留前即拒：close(1009, 'upgrade-frame-limit') +
 *   observer `auth-upgrade-rejected`(reason 'frame-too-large') + 零 HubConnectionImpl
 *   分配（acceptTrusted 恒 resolve undefined）；
 * - 早到帧数 > 16（MAX_EARLY_FRAMES 契约值；HELLO 是唯一合法早到帧）→ 首越界帧
 *   即拒：close(1008, 'upgrade-frame-limit') + observer `auth-upgrade-rejected`
 *   (reason 'early-frame-limit') + 零分配；
 * - 拒绝后帧零保留零重放；被拒 transport 不能被后期回调复活（零新 close、零新
 *   observer 事件、零 wire 输出、连接分配保持零）；
 * - 同步重放型 transport（TcpTransport 实存形态：onMessage 注册即同步重放积压、
 *   重放先于 return）下重放循环零流产（replayedCount = 积压条数，无第二次注册重放）；
 * - 保真锚：trusted 合法 HELLO 同步重放在修复后仍被接纳（SA5 命名既有绿灯锚
 *   auth-lifecycle:634-653 的行为面——不得破坏合法 HELLO 重放路径）。
 *
 * 红线纪律：零源码 grep 断言；零 mock 被测对象（fixture 级同步重放 transport，既有
 * A2-e 同款）；断言 = 可观察运行时行为（resolve 值 / close 原因 / observer 事件 /
 * 重放计数 / connections 投影）——每条红 IT 先对全部观测面拍快照，再一次性 toEqual
 * 冻结契约快照（失败 diff 同时暴露全部偏差面，便于 SA3/SA4 比对；单一 expect 点 =
 * 不预锁修复路径）。
 *
 * ⚠ 本文件 IT-1/IT-2/IT-3 为红灯（当前实现 acceptTrusted 无条件缓冲 + 构造尾重放
 * 后才经 decodeInbound 拒绝 → 1002/'protocol-error' + connection-failed 事件 +
 * 分配 HubConnectionImpl）；IT-4 为既有绿灯保真锚（修复不得破坏）。
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
import { encodeMessage } from '@nomicore/replication-protocol';
import { collectUnhandledRejections, makeAuthorizer, DEFAULT_PEER_VERIFIER } from './driver.js';
import { CONTRACT_LIMITS, HUB_INSTANCE, PEER_INSTANCE, makeNode, settle } from './harness.js';

// ─────────────────────────── 契约常量（与既有 A2-e 锚同源） ───────────────────────────

/** MAX_EARLY_FRAMES 契约值（§3.2 R2 A2 立法：HELLO 为唯一合法早到帧，16 = 充裕余量）。 */
const MAX_EARLY_FRAMES = 16;

// ─────────────────────────── 同步重放型 transport fixture ───────────────────────────

/** 同步重放型 transport（TcpTransport 实存形态：onMessage 注册即同步重放预置积压、
 *  重放先于 return——`sa7-r2-transport.test.ts:132-144`；与 A2-e 锚 fixture 同构，
 *  追加 sent()/pump() 观测面）。`replayedCount` 记录已重放帧数（异常流产会中断重放
 *  循环 → 计数偏小；无第二次注册重放时 = 积压条数）。`pump` 模拟 socket 事后回调
 *  （拒绝后到达的新帧——复活免疫锚）。 */
function makeReplayTransport(backlog: readonly Uint8Array[]): {
  readonly transport: DuplexTransport;
  replayedCount(): number;
  closeInfos(): ReadonlyArray<{ code: number; reason: string }>;
  sent(): ReadonlyArray<Uint8Array>;
  pump(bytes: Uint8Array): void;
} {
  let closed = false;
  let replayed = 0;
  const messageListeners = new Set<(bytes: Uint8Array) => void>();
  const closeListeners = new Set<(info: Readonly<{ code: number; reason: string }>) => void>();
  const closeInfos: Array<{ code: number; reason: string }> = [];
  const sent: Uint8Array[] = [];
  const transport: DuplexTransport = {
    send(bytes) {
      sent.push(bytes.slice()); // 对端零回包——本 fixture 只测注册期拒绝路径的 wire 输出
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
    pump: (bytes) => {
      for (const listener of [...messageListeners]) listener(bytes);
    },
  };
}

function makeHello(): Uint8Array {
  return encodeMessage(
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
  );
}

// ─────────────────────────── observer 事件收集 ───────────────────────────

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
  connectionFailed(): number {
    return this.events.filter((e) => e.type === 'connection-failed').length;
  }
  stateChanged(): number {
    return this.events.filter((e) => e.type === 'connection-state-changed').length;
  }
}

/** 直接组装 Hub（trusted 路径不需要拨号/对端；observer 可注入）。 */
async function makeTrustedHub(
  opts: { readonly observer?: ReplicationObserver; readonly verifyToken?: PeerTokenVerifier } = {},
): Promise<HubReplication> {
  const node = makeNode('hub');
  return createHubReplication({
    instanceId: HUB_INSTANCE,
    registry: node.registry,
    authorize: makeAuthorizer().authorize,
    timer: node.scheduler,
    verifyToken: opts.verifyToken ?? DEFAULT_PEER_VERIFIER,
    ...(opts.observer !== undefined ? { observer: opts.observer } : {}),
  });
}

// ─────────────────────────── 测试主体 ───────────────────────────

describe('issue #190：acceptTrusted 早到帧有界 admission（AC1-AC3 红灯 + 保真锚）', () => {
  it('AC1：trusted 同步重放单帧超界 → 保留前拒绝：documented 帧限语义（1009/undefined/零分配）', async () => {
    const probe = collectUnhandledRejections();
    try {
      const replay = makeReplayTransport([new Uint8Array(CONTRACT_LIMITS.maxFrameBytes + 1)]);
      const events = new HubEventCollector();
      const hub = await makeTrustedHub({ observer: events.observer });
      const p = (hub.acceptTrusted!(replay.transport, { peerInstanceId: PEER_INSTANCE }) as unknown) as Promise<unknown>;
      const conn = await p;
      // 观测快照（当前实现全部偏差一次暴露：分配连接 / 1002 / 零 auth-upgrade-rejected /
      // connection-failed + state-changed / replayedCount 2 / ERROR 帧上 wire）
      expect({
        resolved: conn === undefined ? 'undefined' : `allocated:${String((conn as { state?: string }).state)}`,
        closeInfos: replay.closeInfos(),
        connections: hub.connections.length,
        rejectedReasons: events.rejectedReasons(),
        connectionFailedEvents: events.connectionFailed(),
        stateChangedEvents: events.stateChanged(),
        replayedCount: replay.replayedCount(),
        sentCount: replay.sent().length,
      }).toEqual({
        resolved: 'undefined',
        closeInfos: [{ code: 1009, reason: 'upgrade-frame-limit' }],
        connections: 0,
        rejectedReasons: ['frame-too-large'],
        connectionFailedEvents: 0,
        stateChangedEvents: 0,
        replayedCount: 1,
        sentCount: 0,
      });
    } finally {
      probe.dispose();
    }
    expect(probe.events).toEqual([]);
  });

  it('AC2：trusted 同步重放 17 帧 → 首越界帧（第 17 帧）即拒：1008/undefined/零分配/零二次重放', async () => {
    const probe = collectUnhandledRejections();
    try {
      const replay = makeReplayTransport(
        Array.from({ length: MAX_EARLY_FRAMES + 1 }, (_, i) => new Uint8Array(32).fill(i)),
      );
      const events = new HubEventCollector();
      const hub = await makeTrustedHub({ observer: events.observer });
      const p = (hub.acceptTrusted!(replay.transport, { peerInstanceId: PEER_INSTANCE }) as unknown) as Promise<unknown>;
      const conn = await p;
      expect({
        resolved: conn === undefined ? 'undefined' : `allocated:${String((conn as { state?: string }).state)}`,
        closeInfos: replay.closeInfos(),
        connections: hub.connections.length,
        rejectedReasons: events.rejectedReasons(),
        connectionFailedEvents: events.connectionFailed(),
        stateChangedEvents: events.stateChanged(),
        replayedCount: replay.replayedCount(),
        sentCount: replay.sent().length,
      }).toEqual({
        resolved: 'undefined',
        closeInfos: [{ code: 1008, reason: 'upgrade-frame-limit' }],
        connections: 0,
        rejectedReasons: ['early-frame-limit'],
        connectionFailedEvents: 0,
        stateChangedEvents: 0,
        replayedCount: MAX_EARLY_FRAMES + 1,
        sentCount: 0,
      });
    } finally {
      probe.dispose();
    }
    expect(probe.events).toEqual([]);
  });

  it('AC3：拒绝后帧零保留零重放、后期回调不可复活（64 帧积压 + 事后泵帧）', async () => {
    const replay = makeReplayTransport(
      Array.from({ length: 64 }, (_, i) => new Uint8Array(32).fill(i)),
    );
    const events = new HubEventCollector();
    const hub = await makeTrustedHub({ observer: events.observer });
    const p = (hub.acceptTrusted!(replay.transport, { peerInstanceId: PEER_INSTANCE }) as unknown) as Promise<unknown>;
    const conn = await p;
    // 拒绝恰发生于首越界帧（第 17 帧）；重放循环零流产（64 帧全投递，无第二次注册重放
    // ——当前实现 128：64 保留 + 64 构造重放，即「保留后重放」缺陷面）
    expect({
      resolved: conn === undefined ? 'undefined' : `allocated:${String((conn as { state?: string }).state)}`,
      closeInfos: replay.closeInfos(),
      connections: hub.connections.length,
      rejectedReasons: events.rejectedReasons(),
      connectionFailedEvents: events.connectionFailed(),
      stateChangedEvents: events.stateChanged(),
      replayedCount: replay.replayedCount(),
      sentCount: replay.sent().length,
    }).toEqual({
      resolved: 'undefined',
      closeInfos: [{ code: 1008, reason: 'upgrade-frame-limit' }],
      connections: 0,
      rejectedReasons: ['early-frame-limit'],
      connectionFailedEvents: 0,
      stateChangedEvents: 0,
      replayedCount: 64,
      sentCount: 0,
    });

    // 复活免疫（契约锁）：拒绝后泵入更多帧（含合法 HELLO）→ 零新连接、零新 close、
    // 零新 observer 事件、零 wire 输出
    const closeCountBefore = replay.closeInfos().length;
    const eventCountBefore = events.events.length;
    for (let i = 0; i < 8; i += 1) replay.pump(new Uint8Array(32).fill(200 + i));
    replay.pump(makeHello());
    await settle();
    expect(replay.closeInfos().length).toBe(closeCountBefore);
    expect(events.events.length).toBe(eventCountBefore);
    expect(hub.connections.length).toBe(0);
    expect(replay.sent().length).toBe(0);
  });

  it('保真锚（绿灯）：trusted 合法 HELLO 同步重放仍被接纳——修复不得破坏（SA5 命名锚行为面）', async () => {
    const replay = makeReplayTransport([makeHello()]);
    const events = new HubEventCollector();
    const hub = await makeTrustedHub({ observer: events.observer });
    // 合法 HELLO（唯一合法早到帧，恰 1 帧）→ 正常分配：resolve 连接、无拒绝观察事件
    const connection = await hub.acceptTrusted!(replay.transport, { peerInstanceId: PEER_INSTANCE });
    expect(connection).toBeDefined();
    expect(replay.replayedCount()).toBe(2); // 注册重放 + 构造内注册重放（既有锚:651）
    expect(connection?.state).toBe('closed'); // 既有锚:652——fixture 形态下构造尾重放双投递 → policy 收口
    expect(events.rejectedReasons()).toEqual([]);
  });
});
