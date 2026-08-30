/**
 * SA6 红灯契约 —— issue #164：真实 WebSocket adapter（DuplexTransport 实现）+
 * 生产三面（bufferedAmount / ping / onPong）+ 组合根装配期响亮断言。
 *
 * 权威：issue #164 强制要求 + protocol §17（生产 Adapter 必须暴露三面；缺面 =
 * 配置错误非运行时降级）+ §18（WS ping/pong 活性）+ 协议不变量 1（一 WS binary
 * message = 一 frame；text frame = 帧级违约）。
 *
 * 全部断言锚在运行时行为（回调调用/关闭码/异常），零源码 grep。
 *
 * 红灯现状：`../src/index.js` 不存在（切片 9 未交付）→ 本文件收集期失败 = 真实红灯。
 */
import { describe, expect, it } from 'vitest';
import {
  createWebSocketAdapter,
  assertProductionTransportFaces,
  createYjsHubServer,
} from '../src/index.js';
import type { DuplexTransport } from '@nomicore/ws-replication';
import { createMemoryDuplexTransport } from '@nomicore/ws-replication/testing';
import {
  HUB_INSTANCE,
  HUB_OWNER,
  PEER_INSTANCE,
  TEST_TOKEN,
  PeerWire,
  makeTestRegistry,
  makeVerifier,
  waitUntil,
  wsUpgrade,
} from './harness.js';

// ═══════════════════════════ ws 形状假 socket（外部库 seam 的 fixture，非被测对象） ═══════════════════════════

interface ListenerBag {
  message: Array<(data: Uint8Array, isBinary: boolean) => void>;
  close: Array<(code: number, reason: string) => void>;
  pong: Array<(data: Uint8Array) => void>;
  error: Array<(err: unknown) => void>;
}

/** 最小 ws.Socket 形状替身：记录 send/ping/close 调用，可手动 emit 事件。 */
class FakeSocket {
  bufferedAmount = 0;
  readyState = 1; // open
  readonly sentBinary: Uint8Array[] = [];
  readonly pingData: Uint8Array[] = [];
  readonly closeCalls: Array<Readonly<{ code?: number; reason?: string }>> = [];
  private readonly bags: ListenerBag = {
    message: [],
    close: [],
    pong: [],
    error: [],
  };

  send(data: Uint8Array): void {
    if (typeof data !== 'object') throw new Error('FakeSocket.send 仅接受 bytes');
    this.sentBinary.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
    this.readyState = 3;
  }

  ping(data?: Uint8Array): void {
    this.pingData.push(data ?? new Uint8Array(0));
  }

  on(
    event: 'message' | 'close' | 'pong' | 'error',
    listener: never,
  ): void {
    (this.bags[event] as Array<(...args: never[]) => void>).push(listener as never);
  }

  off(event: 'message' | 'close' | 'pong' | 'error', listener: never): void {
    const bag = this.bags[event] as Array<(...args: never[]) => void>;
    const idx = bag.indexOf(listener as never);
    if (idx >= 0) bag.splice(idx, 1);
  }

  emit(event: 'message', data: Uint8Array | string, isBinary: boolean): void;
  emit(event: 'close', code: number, reason: string): void;
  emit(event: 'pong', data: Uint8Array): void;
  emit(event: 'error', err: unknown): void;
  emit(event: 'message' | 'close' | 'pong' | 'error', ...args: unknown[]): void {
    for (const listener of [...this.bags[event]]) {
      (listener as (...a: unknown[]) => void)(...args);
    }
  }
}

/** 构造带全三面的生产态 transport（TF2 阳性参照）。 */
function fullFaces(socket: FakeSocket): DuplexTransport {
  return createWebSocketAdapter(socket);
}

describe('issue #164：真实 WebSocket adapter（DuplexTransport 三面）', () => {
  it('TF1 三面存在性 + 运行时行为：send/onMessage/onClose/close + bufferedAmount 投影 + ping/onPong 接线 + text 帧拒收', () => {
    const socket = new FakeSocket();
    const adapter = fullFaces(socket);

    // —— 三面存在（G3.4 背压前提 / G5.1 活性前提）——
    expect(typeof adapter.bufferedAmount).toBe('number');
    expect(typeof adapter.ping).toBe('function');
    expect(typeof adapter.onPong).toBe('function');

    // —— bufferedAmount 实时投影 socket 未冲刷字节（背压观察点）——
    socket.bufferedAmount = 1234;
    expect(adapter.bufferedAmount).toBe(1234);
    socket.bufferedAmount = 0;
    expect(adapter.bufferedAmount).toBe(0);

    // —— send：一 binary message = 一 frame（协议不变量 1），字节等同送达 socket ——
    const frame = new Uint8Array([1, 2, 3, 4, 5]);
    adapter.send(frame);
    expect(socket.sentBinary).toHaveLength(1);
    expect(socket.sentBinary[0]).toEqual(frame);

    // —— onMessage/退订 ——
    const received: Uint8Array[] = [];
    const off = adapter.onMessage((bytes) => received.push(bytes));
    socket.emit('message', frame, true);
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(frame);
    off();
    socket.emit('message', frame, true);
    expect(received).toHaveLength(1);

    // —— text 帧 = 帧级违约（协议不变量 1 反之亦然）：close(1002) + 零投递 ——
    const before = received.length;
    socket.emit('message', 'plain text', false);
    expect(received).toHaveLength(before);
    expect(socket.closeCalls.length).toBeGreaterThan(0);
    expect(socket.closeCalls[0].code).toBe(1002);

    // —— ping / onPong：WS 级活性接线（§18）——
    const pingPayload = new Uint8Array([9, 9]);
    adapter.ping(pingPayload);
    expect(socket.pingData[0]).toEqual(pingPayload);
    let pongCount = 0;
    const offPong = adapter.onPong(() => {
      pongCount += 1;
    });
    socket.emit('pong', pingPayload);
    expect(pongCount).toBe(1);
    offPong();

    // —— close(code, reason)：socket 关闭 + closed 投影 + onClose 通知（独立实例）——
    const closeSocket = new FakeSocket();
    const closeAdapter = fullFaces(closeSocket);
    const closedInfo: Array<Readonly<{ code: number; reason: string }>> = [];
    closeAdapter.onClose((info) => closedInfo.push(info));
    expect(closeAdapter.closed).toBe(false);
    closeAdapter.close(1008, 'upgrade-unauthorized');
    expect(closeAdapter.closed).toBe(true);
    expect(closeSocket.closeCalls[closeSocket.closeCalls.length - 1]).toMatchObject({
      code: 1008,
      reason: 'upgrade-unauthorized',
    });
    closeSocket.emit('close', 1008, 'upgrade-unauthorized');
    expect(closedInfo).toHaveLength(1);
    expect(closedInfo[0]).toEqual({ code: 1008, reason: 'upgrade-unauthorized' });
  });
});

describe('issue #164：组合根装配期响亮断言（§17：缺面 = 配置错误，非运行时降级）', () => {
  it('TF2 assertProductionTransportFaces：缺任一要求面 → 同步 TypeError；全三面 → 无异常', () => {
    const bare = createMemoryDuplexTransport().hub; // 内存双端：零可选面（dormant 形态）
    expect(() => assertProductionTransportFaces(bare)).toThrow(TypeError);

    const bufferedOnly: DuplexTransport = {
      ...bare,
      bufferedAmount: 0,
      send: (b) => void b,
      close: () => undefined,
      closed: true,
      onMessage: () => () => undefined,
      onClose: () => () => undefined,
    } as unknown as DuplexTransport;
    expect(() => assertProductionTransportFaces(bufferedOnly)).toThrow(TypeError);

    const online = fullFaces(new FakeSocket());
    expect(() => assertProductionTransportFaces(online)).not.toThrow();
  });

  it('TF3 组合根集成：transportFactory 产出缺面 transport → 连接被响亮拒绝（告警 + 零 HELLO_ACK 收口）', async () => {
    const fixture = makeTestRegistry();
    const verifierCalls: string[] = [];
    const alerts: string[] = [];
    const server = createYjsHubServer({
      role: 'hub',
      instanceId: HUB_INSTANCE,
      listen: { host: '127.0.0.1', port: 0 },
      verifyToken: makeVerifier({ calls: verifierCalls }),
      authorize: () =>
        Promise.resolve({
          ok: true as const,
          localOwner: HUB_OWNER,
          permissions: { read: true, submit: true },
        }),
      registry: fixture.registry,
      transportFactory: () => createMemoryDuplexTransport().hub as unknown as DuplexTransport,
      alert: (message: string) => alerts.push(message),
    });
    const addr = await server.start();
    try {
      const upgrade = await wsUpgrade({
        port: addr.port,
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });
      expect(upgrade.status).toBe(101);
      const wire = new PeerWire(upgrade.ws as never);
      wire.send({
        kind: 'HELLO',
        peerInstanceId: PEER_INSTANCE,
        expectedHubInstanceId: HUB_INSTANCE,
        protocolVersions: [1],
        requiredCapabilities: 0,
        optionalCapabilities: 0,
        connectionNonce: new Uint8Array(16),
      });
      // 响亮拒绝：零协议握手 + 结构化告警 + 连接收口（绝不静默降级为无活性/无背压会话）
      await waitUntil('连接被响亮收口', () => wire.closed !== undefined || alerts.length > 0, 5_000);
      expect(alerts.length).toBeGreaterThan(0);
      expect(alerts[0]).toContain('bufferedAmount');
      expect(wire.frames.some((f) => f.message.kind === 'HELLO_ACK')).toBe(false);
      await waitUntil('连接收口', () => wire.closed !== undefined, 5_000);
    } finally {
      await server.close();
    }
  });
});
