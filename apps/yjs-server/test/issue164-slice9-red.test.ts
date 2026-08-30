/**
 * SA6 红灯契约 —— issue #164 切片 9：apps/yjs-server 组合根（真实 WebSocket adapter +
 * HTTP Upgrade bearer-token 接线 + §21 停机编排）。
 *
 * 权威：issue #164 + ADR-0010 L175 + docs/protocols/instance-replication-v1.md
 * §2（Upgrade 认证）/§6.1（instanceId 文法）/§8/§9（bootstrap+reconcile）/
 * §17（adapter 生产三面）/§18（ping/pong 活性）/§19（namespace 授权）/§21（停机顺序）。
 *
 * 全部断言锚在可观察运行时行为：HTTP 状态 / WS 帧（codec 编解码）/ WS close 码 /
 * Y.Doc 内容 / Registry 生命周期；零源码 grep；被测服务 = 真实 TCP WS 组合根。
 *
 * 红灯现状（本任务前置）：apps/ 无 composition root（ADR-0010 L175 切片 9 未交付）——
 * `../src/index.js` 不存在，本文件全部用例收集期失败 = 红灯（真实、非伪红）。
 */
import * as crypto from 'node:crypto';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { createYjsHubServer } from '../src/index.js'; // 冻结生产入口（缺失 = 红灯锚点）
import type {
  NamespaceAuthorizer,
  ReplicationTimeouts,
} from '@nomicore/ws-replication';
import {
  HUB_INSTANCE,
  HUB_OWNER,
  PEER_INSTANCE,
  TEST_TOKEN,
  PeerWire,
  makeGrammarViolationHelloFrame,
  makeHubNamespace,
  makeTestRegistry,
  makeVerifier,
  readRootValue,
  waitUntil,
  wsUpgrade,
} from './harness.js';

// ═══════════════════════════ 通用组装配件 ═══════════════════════════

function makeAuthorize(deny: readonly string[] = []): NamespaceAuthorizer & { readonly called: Array<Readonly<{ instance: string; ns: string }>> } {
  const called: Array<Readonly<{ instance: string; ns: string }>> = [];
  const fn = (instance: string, ns: string) => {
    called.push({ instance, ns });
    if (deny.includes(ns) || deny.includes('*')) {
      return Promise.resolve({ ok: false } as const);
    }
    return Promise.resolve({
      ok: true as const,
      localOwner: HUB_OWNER,
      permissions: { read: true, submit: true },
    });
  };
  return Object.assign(fn, { called });
}

/**
 * 活性时序参数（FS8/FS9 专用）。
 *
 * 演进（CI 修复轮 1）：原 300ms/150ms 是激进压缩配置——pong 窗口仅 150ms，在
 * CI 全量并行负载（205 文件 × 多 worker）下无安全边际：一旦「hub 发出 ping 的
 * tick → 同一进程处理 pong 数据事件的 tick」之间的墙钟间隔被调度延迟推过
 * 150ms，hub 即按 §18 以 pong-timeout 收口，FS8 的「回 pong 连接保持」断言
 * 必然失败（本地诊断实测：200ms pong 往返延迟 + 150ms 窗口 → 1001/pong-timeout
 * 收口、pings 停在 1——与 CI 失败签名一致；同延迟 + 250ms 窗口 → 连接保持）。
 * 修复：与生产缺省（30s/10s）保持同文法的 3:1 比例改为 2s/1s——窗口放大
 * 6.7x 提供 CI 调度余量，断言语义不变；FS8（2 ping）≈4s、FS9（收口）≈3s，
 * 仍在秒级预算，waitUntil 15s / vitest 20s 覆盖。
 */
const PING_TIMEOUTS: Readonly<Partial<ReplicationTimeouts>> = Object.freeze({
  pingIntervalMs: 2_000,
  pongTimeoutMs: 1_000,
});

/** 装配组合根（注入真实 Registry/stub persistence/受控 verifier/authorize）。 */
async function startHub(opts: {
  readonly deny?: readonly string[];
  readonly timeouts?: Readonly<Partial<ReplicationTimeouts>>;
  readonly transportFactory?: (socket: unknown) => unknown;
  readonly alerts?: string[];
}) {
  const fixture = makeTestRegistry();
  const ns = await makeHubNamespace(fixture.registry);
  const verifierCalls: string[] = [];
  const verifier = makeVerifier({ calls: verifierCalls });
  const authorize = makeAuthorize(opts.deny);
  const alerts = opts.alerts ?? [];
  const server = createYjsHubServer({
    role: 'hub',
    instanceId: HUB_INSTANCE,
    listen: { host: '127.0.0.1', port: 0 },
    verifyToken: verifier,
    authorize,
    registry: fixture.registry,
    limits: undefined,
    timeouts: opts.timeouts ?? PING_TIMEOUTS,
    transportFactory: opts.transportFactory as never,
    alert: (message: string) => alerts.push(message),
  });
  const addr = await server.start();
  return {
    server,
    port: addr.port,
    fixture,
    ns,
    verifierCalls,
    authorize,
    alerts,
  };
}

function helloMsg(peerInstanceId: string, nonce?: Uint8Array): Parameters<PeerWire['send']>[0] {
  return {
    kind: 'HELLO',
    peerInstanceId,
    expectedHubInstanceId: HUB_INSTANCE,
    protocolVersions: [1],
    requiredCapabilities: 0,
    optionalCapabilities: 0,
    connectionNonce: nonce ?? crypto.randomBytes(16),
  };
}

async function established(wire: PeerWire): Promise<{ readonly ackSeq: number }> {
  wire.send(helloMsg(PEER_INSTANCE));
  const ack = await wire.waitKind('HELLO_ACK');
  return { ackSeq: ack.header.sequence };
}

describe('issue #164 切片 9：apps/yjs-server 组合根（真实 WebSocket）', () => {
  it('FS1 幸福路径：合法 bearer → 101 握手 + HELLO/HELLO_ACK 协商（升级前验证 + accept 接线）', async () => {
    const ctx = await startHub({});
    try {
      const upgrade = await wsUpgrade({
        port: ctx.port,
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });
      expect(upgrade.status).toBe(101);
      expect(upgrade.ws).toBeDefined();
      expect(upgrade.headers.get('sec-websocket-accept')).not.toBe('');

      const wire = new PeerWire(upgrade.ws as never);
      wire.send(helloMsg(PEER_INSTANCE));
      const ack = (await wire.waitKind('HELLO_ACK')).message;
      expect(ack).toMatchObject({
        kind: 'HELLO_ACK',
        hubInstanceId: HUB_INSTANCE,
        protocolVersion: 1,
        selectedCapabilities: 0,
      });
      // verifier 至少被消费两次：HTTP Upgrade 前（401/403 判据）+ accept 内再验证（纵深防御）
      expect(ctx.authorize.called.length).toBe(0); // 无 namespace 活动，零授权调用
      await waitUntil('verifier 被预验证与 accept 验证消费', () => ctx.verifierCalls.length >= 2, 5_000);
    } finally {
      await ctx.server.close();
    }
  });

  it('FS2 全链路：101 → HELLO_ACK → OPEN(bootstrap) → BOOTSTRAP_SNAPSHOT → ACK → round 1 diff 应用 → hub 文档收敛', async () => {
    const ctx = await startHub({});
    try {
      const upgrade = await wsUpgrade({
        port: ctx.port,
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });
      expect(upgrade.status).toBe(101);
      const wire = new PeerWire(upgrade.ws as never);
      const { ackSeq: helloAckSeq } = await established(wire);
      expect(helloAckSeq).toBe(1);

      // —— OPEN_NAMESPACE（无本地副本 → bootstrap 模式）——
      wire.send({
        kind: 'OPEN_NAMESPACE',
        namespaceId: ctx.ns.namespaceId,
        hasLocalReplica: false,
      });
      const openOk = (await wire.waitKind('OPEN_OK')).message;
      expect(openOk).toMatchObject({
        kind: 'OPEN_OK',
        namespaceId: ctx.ns.namespaceId,
        mode: 0, // bootstrap
        replicationId: ctx.ns.identity.replicationId,
        replicationEpoch: ctx.ns.identity.replicationEpoch,
      });
      const snapshotFrame = await wire.waitKind('BOOTSTRAP_SNAPSHOT');
      const snapshot = snapshotFrame.message as { kind: 'BOOTSTRAP_SNAPSHOT'; namespaceId: string; replicationId: string; replicationEpoch: number; snapshot: Uint8Array };
      expect(snapshot.namespaceId).toBe(ctx.ns.namespaceId);
      expect(snapshot.replicationId).toBe(ctx.ns.identity.replicationId);
      expect(snapshot.snapshot.byteLength).toBeGreaterThan(0);

      // —— 客户端侧导入 snapshot（测试自有 Y.Doc）——
      const peerDoc = new Y.Doc();
      Y.applyUpdate(peerDoc, new Uint8Array(snapshot.snapshot));
      expect(readRootValue(peerDoc)).toBe(42);

      // —— BOOTSTRAP_ACK → 立即发起 round 1 ——
      wire.send({
        kind: 'BOOTSTRAP_ACK',
        namespaceId: ctx.ns.namespaceId,
        ackedSequence: snapshotFrame.header.sequence,
      });
      wire.send({
        kind: 'SYNC_STEP1',
        namespaceId: ctx.ns.namespaceId,
        syncRoundId: 1,
        stateVector: Y.encodeStateVector(peerDoc),
      });
      const hubStep1Frame = await wire.waitKind('SYNC_STEP1');
      const hubStep1 = hubStep1Frame.message as { kind: 'SYNC_STEP1'; syncRoundId: number; stateVector: Uint8Array };
      expect(hubStep1.syncRoundId).toBe(1);
      const hubStep2Frame = await wire.waitKind('SYNC_STEP2');

      // —— 客户端变更（n: 42 → 43）并作为本端 Step2 diff 发往 hub ——
      (peerDoc.getMap('ROOT') as unknown as Map<string, unknown>).set('n', 43);
      const diff = Y.encodeStateAsUpdate(peerDoc, new Uint8Array(hubStep1.stateVector));
      wire.send({
        kind: 'SYNC_STEP2',
        namespaceId: ctx.ns.namespaceId,
        syncRoundId: 1,
        relatedStep1Sequence: hubStep1Frame.header.sequence,
        update: diff,
      });
      const hubAppliedFrame = await wire.waitKind('SYNC_APPLIED');
      expect((hubAppliedFrame.message as { ackedSequence: number }).ackedSequence).toBeGreaterThan(0);

      // —— 本端 ACK hub 的 Step2（空 diff 也走完整应答）——
      wire.send({
        kind: 'SYNC_APPLIED',
        namespaceId: ctx.ns.namespaceId,
        syncRoundId: 1,
        ackedSequence: hubStep2Frame.header.sequence,
      });

      // —— 后向闭环：远端 diff 已入 hub 持久化（sequencer apply + dirty notification）——
      await waitUntil(
        'hub 文档收敛（ROOT.n === 43）',
        () => {
          const doc = ctx.fixture.persistence.peek(HUB_OWNER, ctx.ns.namespaceId);
          return doc !== undefined && readRootValue(doc) === 43;
        },
        10_000,
      );
      const hubDoc = ctx.fixture.persistence.peek(HUB_OWNER, ctx.ns.namespaceId);
      expect(readRootValue(hubDoc as never)).toBe(43);
    } finally {
      // 注：本用例开了 namespace channel 且不回 pong——finally 的 close() 结算于
      // liveness 自然收口（PING_TIMEOUTS 下 ≈3s）；CI 负载放大后仍在显式预算内。
      await ctx.server.close();
    }
  }, 20_000);

  it('FS3 边界：缺 Authorization 头 → HTTP 401（不建立 WebSocket）', async () => {
    const ctx = await startHub({});
    try {
      const outcome = await wsUpgrade({ port: ctx.port });
      expect(outcome.status).toBe(401);
      expect(outcome.ws).toBeUndefined();
      expect(outcome.headers.get('sec-websocket-accept') ?? '').toBe('');    } finally {
      await ctx.server.close();
    }
  });

  it('FS4 边界：非法 token → HTTP 403（不建立 WebSocket）', async () => {
    const ctx = await startHub({});
    try {
      const outcome = await wsUpgrade({
        port: ctx.port,
        headers: { Authorization: 'Bearer tok-wrong-deadbeef' },
      });
      expect(outcome.status).toBe(403);
      expect(outcome.ws).toBeUndefined();
    } finally {
      await ctx.server.close();
    }
  });

  it('FS5 异常输入：HELLO 自述身份 ≠ 受信身份 → INSTANCE_IDENTITY_MISMATCH + close 1008（wire 自述绝不采信）', async () => {
    const ctx = await startHub({});
    try {
      const upgrade = await wsUpgrade({
        port: ctx.port,
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });
      expect(upgrade.status).toBe(101);
      const wire = new PeerWire(upgrade.ws as never);
      wire.send(helloMsg('peer-beta')); // 受信身份是 peer-alpha，自述 peer-beta
      const errorFrame = await wire.waitKind('ERROR');
      expect(errorFrame.message).toMatchObject({
        kind: 'ERROR',
        code: 'INSTANCE_IDENTITY_MISMATCH',
      });
      expect(wire.frames.some((f) => f.message.kind === 'HELLO_ACK')).toBe(false);
      await waitUntil('连接以 1008 收口', () => wire.closed !== undefined, 5_000);
      expect(wire.closed?.code).toBe(1008);
    } finally {
      await ctx.server.close();
    }
  });

  it('FS5b 异常输入：HELLO instanceId 违反文法（^[a-z][a-z0-9-]{0,62}$）→ 帧级拒绝，零 HELLO_ACK', async () => {
    const ctx = await startHub({});
    try {
      const upgrade = await wsUpgrade({
        port: ctx.port,
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });
      expect(upgrade.status).toBe(101);
      const wire = new PeerWire(upgrade.ws as never);
      // 原始帧直发 wire（绕过编码器 R9 字段先验——包既定行为，DENY LIST 禁改）：
      // 帧结构完全合法，仅 instanceId 值违反 §6.1 文法（'Peer_Alph!'，同长替换）。
      wire.sendRaw(makeGrammarViolationHelloFrame());
      await waitUntil('连接收口', () => wire.closed !== undefined, 5_000);
      expect(wire.frames.some((f) => f.message.kind === 'HELLO_ACK')).toBe(false);
      // 帧级违约（文法违规 payload）→ 关连接，绝不进入协议握手
      expect([1002, 1008]).toContain(wire.closed?.code);
    } finally {
      await ctx.server.close();
    }
  });

  it('FS6 生命周期：close() → 现有连接收口 + 端口拒绝新连接 + Registry 停机（§21 编排）', async () => {
    const ctx = await startHub({});
    const upgrade = await wsUpgrade({
      port: ctx.port,
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(upgrade.status).toBe(101);
    const wire = new PeerWire(upgrade.ws as never);
    await established(wire);

    await ctx.server.close();

    // 现有连接收口
    await waitUntil('既有连接收口', () => wire.closed !== undefined, 5_000);
    // 新连接不再被接纳（listen 已停止）
    let refused = false;
    try {
      const again = await wsUpgrade({ port: ctx.port, handshakeTimeoutMs: 2_000 });
      refused = again.status !== 101;
    } catch {
      refused = true;
    }
    expect(refused).toBe(true);
    // §21 顺序第 4 步：Registry 已停机（close() 解析前已完成）
    expect(ctx.fixture.registry.getStatus().state).toBe('stopped');
  });

  it('FS7 namespace 权限接线：未经授权 namespace → NAMESPACE_UNAUTHORIZED（连接不杀）', async () => {
    const ctx = await startHub({ deny: ['*'] });
    try {
      const upgrade = await wsUpgrade({
        port: ctx.port,
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });
      expect(upgrade.status).toBe(101);
      const wire = new PeerWire(upgrade.ws as never);
      await established(wire);
      wire.send({
        kind: 'OPEN_NAMESPACE',
        namespaceId: ctx.ns.namespaceId,
        hasLocalReplica: false,
      });
      const errorFrame = await wire.waitKind('ERROR');
      expect(errorFrame.message).toMatchObject({
        kind: 'ERROR',
        code: 'NAMESPACE_UNAUTHORIZED',
        namespaceId: ctx.ns.namespaceId,
      });
      // 授权失败只收口 namespace channel，不杀连接（§19 L528）
      await new Promise<void>((resolve) => setTimeout(resolve, 300));
      expect(wire.closed).toBeUndefined();
      expect(ctx.authorize.called.some((c) => c.ns === ctx.ns.namespaceId)).toBe(true);
    } finally {
      await ctx.server.close();
    }
  });

  it('FS8 活性链路：hub 经真实 adapter 发送 WS ping；回 pong 连接保持（G5.1）', async () => {
    const ctx = await startHub({});
    try {
      const upgrade = await wsUpgrade({
        port: ctx.port,
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });
      expect(upgrade.status).toBe(101);
      const wire = new PeerWire(upgrade.ws as never);
      await established(wire);
      // 回 pong：唯一让活性观察成立的客户端行为
      wire.pongOnPing = true;
      // 快速失败诊断（CI 修复轮 1）：等待期间连接被收口 = 活性要么断了要么没
      // 达到——立即以 close 码/原因 + 已收 ping 数失败，替代 5s 哑等后仅报超时。
      const aliveOrThrow = (expecting: string): void => {
        if (wire.closed !== undefined) {
          throw new Error(
            `FS8 等待「${expecting}」期间连接被 hub 收口：closed=${JSON.stringify(wire.closed)}；已收 ping=${wire.pings.length}`,
          );
        }
      };
      await waitUntil(
        '收到 hub WS Ping（adapter ping 面已接线）',
        () => {
          aliveOrThrow('收到 ≥1 次 ping');
          return wire.pings.length >= 1;
        },
        15_000,
      );
      // 活性保持：反复 ping 下连接不被 pong 超时收口
      await waitUntil(
        '收到 ≥2 次 ping',
        () => {
          aliveOrThrow('收到 ≥2 次 ping');
          return wire.pings.length >= 2;
        },
        15_000,
      );
      expect(wire.closed).toBeUndefined();
    } finally {
      await ctx.server.close();
    }
  }, 20_000);

  it('FS9 活性链路反向：不回 pong → hub 以 pong-timeout 收口（onPong 面真实接线）', async () => {
    const ctx = await startHub({});
    try {
      const upgrade = await wsUpgrade({
        port: ctx.port,
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });
      expect(upgrade.status).toBe(101);
      const wire = new PeerWire(upgrade.ws as never);
      await established(wire);
      await waitUntil('连接被 pong-timeout 收口', () => wire.closed !== undefined, 15_000);
      expect(wire.closed?.reason).toBe('pong-timeout');
      expect([1001, 1002]).toContain(wire.closed?.code);
    } finally {
      await ctx.server.close();
    }
  }, 20_000);
});
