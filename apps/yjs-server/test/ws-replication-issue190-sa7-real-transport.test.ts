/**
 * SA7 动态补充（真实链路 smoke）—— issue #190：生产 `wrapWs` transport + 真实
 * WebSocket upgrade/handshake 链路上的 trusted upgrade 行为。
 *
 * 组合面 = 生产形态镜像：`startHubWsServer`（HTTP Upgrade + Bearer 认证 + 可信身份）
 * → `accept` 回调 fire-and-forget 调 `hub.acceptTrusted`（apps/yjs-server/src/app.ts:274
 * 同款）→ `wrapWs`（ws 事件 1:1 适配，一 WS binary message = 一 frame）。观测面在
 * 客户端角（RawWsClient 解析 WS close code/reason）+ hub connections 投影——零 mock
 * 被测对象、零源码 grep 断言。
 *
 * ⚠ 动态发现（SA7 实测，2026-08-31）：生产 wrapWs 链路上 ws `message` 事件恒晚于
 * `wss.handleUpgrade` 回调同步段（accept → acceptTrusted → admission detach →
 * HubConnectionImpl 构造全部在同一 tick 完成），故「早到帧 admission 窗口」在 wrapWs
 * 链路对任何帧都已关闭——越界帧落在连接层 decodeInbound（SA5 Investigation #4 记录的
 * 既有语义：非协议字节先判 MALFORMED → close(1002,'protocol-error') + ERROR 帧上
 * wire + 异步回收连接），而非 admission 层（1009/1008 'upgrade-frame-limit'）。
 * issue #190 的触发面是「同步重放型 transport」（TcpTransport 实存形态——onMessage
 * 注册即同步重放积压），生产 wrapWs 不属于该形态；修复对生产链路的可观测效果 =
 * 合法路径零变化（AC4），有界 admission 保护的是包级 API 契约（任意 transport 形态）。
 *
 * 测试面：
 * - R1（保真，绿灯 = SA4 动态重点 4）：合法 HELLO 经生产链路 → HELLO_ACK 到达客户
 *   端 + hub 恰 1 连接 ready——修复后生产合法 trusted upgrade 分配行为不变。
 * - R2/R3（链路特征锁）：单帧超界 / 17 帧（> MAX_EARLY_FRAMES）经 wrapWs → 连接层
 *   收口 {1002,'protocol-error'} + 1 个 ERROR 帧上 wire + 连接异步回收归零——锚定
 *   「生产链路帧不进入 admission 保留」的时序事实（与 R1 共同构成对生产链路的完整
 *   行为面快照；admission 拒绝语义的验证在包级 fixture transport 文件
 *   ws-replication-issue190-red.test.ts / ws-replication-issue190-guard.test.ts）。
 */
import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { startHubWsServer } from '../src/transport/ws-server.js';
import { createHubReplication, DEFAULT_REPLICATION_LIMITS } from '@nomicore/ws-replication';
import type { HubReplication } from '@nomicore/ws-replication';
import { HUB_INSTANCE, PEER_INSTANCE, TEST_TOKEN, PeerWire, makeTestRegistry, waitUntil, wsUpgrade } from './harness.js';

const MAX_EARLY_FRAMES = 16; // 契约值（§3.2 R2 A2）
const MAX_FRAME_BYTES = DEFAULT_REPLICATION_LIMITS.maxFrameBytes; // 生产缺省 8 MiB

interface Fixture {
  readonly hub: HubReplication;
  readonly port: number;
  close(): Promise<void>;
}

/** 生产形态组装：真实 ws server + Bearer 认证 → fire-and-forget acceptTrusted。 */
async function bootTrustedServer(): Promise<Fixture> {
  const { registry, scheduler } = makeTestRegistry();
  const hub = createHubReplication({
    instanceId: HUB_INSTANCE,
    registry,
    // HELLO-only smoke：授权面不在本测试路径（OPEN_NAMESPACE 才触达）
    authorize: async () => ({ ok: false }),
    timer: scheduler,
    verifyToken: async () => ({ ok: true, instanceId: PEER_INSTANCE }),
  });
  const server = await startHubWsServer({
    host: '127.0.0.1',
    port: 0, // ephemeral——零端口冲突面
    path: '/replication',
    authenticate: async (token) =>
      token === TEST_TOKEN ? { peerInstanceId: PEER_INSTANCE } : undefined,
    accept: (transport, identity) => {
      // 镜像 app.ts:274：fire-and-forget（拒绝路径恒 resolve，零 unhandledRejection）
      void hub.acceptTrusted!(transport, identity);
    },
  });
  return {
    hub,
    port: server.port,
    close: async () => {
      await server.close();
      await hub.close();
    },
  };
}

const fixtures: Fixture[] = [];

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close();
});

describe('issue #190 SA7：生产 wrapWs + 真实 upgrade 链路的 trusted upgrade 行为', () => {
  it(
    'R1（保真，绿灯）：真实链路合法 HELLO → HELLO_ACK 到达客户端 + hub 恰 1 连接 ready',
    { timeout: 30_000 },
    async () => {
      const fixture = await bootTrustedServer();
      fixtures.push(fixture);
      const outcome = await wsUpgrade({
        port: fixture.port,
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });
      expect(outcome.status).toBe(101);
      const wire = new PeerWire(outcome.ws!);
      wire.send({
        kind: 'HELLO',
        peerInstanceId: PEER_INSTANCE,
        expectedHubInstanceId: HUB_INSTANCE,
        protocolVersions: [1],
        requiredCapabilities: 0,
        optionalCapabilities: 0,
        connectionNonce: new Uint8Array(randomBytes(16)),
      });
      const ack = await wire.waitKind('HELLO_ACK', 15_000);
      expect(ack.message.kind).toBe('HELLO_ACK');
      expect(fixture.hub.connections.length).toBe(1);
      expect(fixture.hub.connections[0]?.state).toBe('ready');
      expect(wire.closed).toBeUndefined(); // 连接存活
    },
  );

  it(
    'R2（链路特征锁）：wrapWs 单帧超界 → admission 窗口已关（帧不进保留）→ 连接层收口 {1002,"protocol-error"} + 1 ERROR 帧 + 连接回收归零',
    { timeout: 30_000 },
    async () => {
      const fixture = await bootTrustedServer();
      fixtures.push(fixture);
      const outcome = await wsUpgrade({
        port: fixture.port,
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });
      expect(outcome.status).toBe(101);
      const wire = new PeerWire(outcome.ws!);
      outcome.ws!.sendBinary(new Uint8Array(MAX_FRAME_BYTES + 1)); // 8 MiB + 1 字节单帧
      await waitUntil('WS close 到达客户端', () => wire.closed !== undefined, 15_000);
      // 既有连接层语义（SA5 Investigation #4）：非协议字节先判 MALFORMED（1002）——
      // 生产 wrapWs 链路上该帧不经 admission（时序见文件头「动态发现」）
      expect(wire.closed).toEqual({ code: 1002, reason: 'protocol-error' });
      expect(wire.frames.map((frame) => frame.message.kind)).toEqual(['ERROR']); // 收口 ERROR 帧
      await waitUntil('hub 连接异步回收归零', () => fixture.hub.connections.length === 0, 5_000);
    },
  );

  it(
    'R3（链路特征锁）：wrapWs 17 帧（> MAX_EARLY_FRAMES）→ 同落连接层收口 {1002,"protocol-error"} + 连接回收归零（admission 层零参与）',
    { timeout: 30_000 },
    async () => {
      const fixture = await bootTrustedServer();
      fixtures.push(fixture);
      const outcome = await wsUpgrade({
        port: fixture.port,
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });
      expect(outcome.status).toBe(101);
      const wire = new PeerWire(outcome.ws!);
      for (let i = 0; i <= MAX_EARLY_FRAMES; i += 1) {
        outcome.ws!.sendBinary(new Uint8Array(32).fill(i)); // 17 帧（包级契约第 17 帧即拒）
      }
      await waitUntil('WS close 到达客户端', () => wire.closed !== undefined, 15_000);
      expect(wire.closed).toEqual({ code: 1002, reason: 'protocol-error' });
      expect(wire.frames.map((frame) => frame.message.kind)).toEqual(['ERROR']);
      await waitUntil('hub 连接异步回收归零', () => fixture.hub.connections.length === 0, 5_000);
    },
  );
});
