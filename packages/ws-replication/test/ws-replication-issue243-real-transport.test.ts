/**
 * issue #243（slice 2）实现轮 —— AC7 第二 seam：真实 TCP 传输 + MemoryPersistence
 * 1 Hub + 2 Peers 镜像（设计 §11/§12 AC7 行；fake-duplex 面由红灯契约 + 实现轮
 * knob-on 套件承载）。
 *
 * 场景（DD-3/DD-4/DD-6 端到端）：
 *  - 双 peer 均 knob-on（真实 HELLO.optional/HELLO_ACK.selected 协商位建立）；
 *  - peer A 写 >maxUpdateBytes 的 blurb → A 通道分块（UPDATE_CHUNK ×N）上行 →
 *    hub 收齐恰一次 apply + dirty + 单 UPDATE_ACK；
 *  - hub 经 session owned-update fan-out 广播给 peer B（applyOrigin 回声抑制——
 *    不回送 A）；A→B 的下行载荷同样超限 → hub 对 B 的通道分块下行（DD-6 协商 peer
 *    自然路径）→ B 收齐 apply + 单 UPDATE_ACK；
 *  - 帧级断言（AC2/AC8）：每 chunk 载荷 ≤ maxUpdateBytes、帧全长 ≤ maxFrameBytes、
 *    transferId/chunkCount/totalBytes 跨帧一致、chunkIndex 严格递增。
 *
 * 纪律（与 sa7 real-transport 套件同属「真实链路集成抽样」）：node:net 真实 TCP +
 * 有界 real wait（真实 timer）；Registry/复制 timer 仍走 testing seam（fake
 * scheduler——happy path 零 timer 触发面）；传输适配器 4B 长度前缀成帧。
 */
import * as net from 'node:net';
import { describe, expect, it } from 'vitest';
import {
  createHubReplication,
  createPeerReplication,
  type DuplexTransport,
  type PeerReplication,
  type ReplicationLimits,
} from '@nomicore/ws-replication';
import { CAP_CHUNKED_UPDATE, decodeMessage, type DecodedMessage } from '@nomicore/replication-protocol';
import {
  HUB_INSTANCE,
  HUB_OWNER,
  PEER_INSTANCE,
  PEER_OWNER,
  makeNode,
  okLease,
  schemaReady,
} from './harness.js';

const RT_SCHEMA = Object.freeze({
  lang: 'vfsl',
  version: 1,
  id: 'issue243-real-transport',
  text: 'type ROOT = { n: number; blurb: string; };\n',
});

const RT_LIMITS: Readonly<Partial<ReplicationLimits>> = {
  maxUpdateBytes: 8 * 1024,
  maxQueuedUpdateCount: 100,
  maxQueuedUpdateBytes: 1 * 1024 * 1024,
  maxInFlightUpdates: 8,
};

const BIG = 'z'.repeat(20_000); // ≈20,029B > maxUpdateBytes 8KiB → 3 chunks

const INSTANCE_B = 'peer-beta';

type ChunkMsg = Extract<DecodedMessage['message'], { kind: 'UPDATE_CHUNK' }>;
type AckMsg = Extract<DecodedMessage['message'], { kind: 'UPDATE_ACK' }>;

/** 有界 real wait 轮询（真实链路集成抽样专用）。 */
async function waitUntil(what: string, predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) return;
    if (Date.now() > deadline) throw new Error(`waitUntil 超时（${timeoutMs}ms）：${what}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

/** 真实 TCP transport（4B 长度前缀成帧；零 liveness 面——本场景无活性断言）。 */
class FrameTransport implements DuplexTransport {
  private readonly listeners = new Set<(bytes: Uint8Array) => void>();
  private readonly closeListeners = new Set<(info: Readonly<{ code: number; reason: string }>) => void>();
  private buffer = Buffer.alloc(0);
  private closedFlag = false;
  constructor(
    readonly socket: net.Socket,
    private readonly onRaw?: (bytes: Uint8Array) => void,
  ) {
    socket.on('data', (chunk: Buffer) => this.receive(chunk));
    socket.on('close', () => {
      this.closedFlag = true;
      for (const listener of [...this.closeListeners]) listener({ code: 1006, reason: 'closed' });
    });
    socket.on('error', () => { /* close 事件随后到达；防 unhandled error */ });
  }

  send(bytes: Uint8Array): void {
    if (this.closedFlag) return;
    const header = Buffer.alloc(4);
    header.writeUInt32BE(bytes.byteLength, 0);
    this.onRaw?.(bytes.slice());
    this.socket.write(Buffer.concat([header, Buffer.from(bytes)]));
  }

  close(): void {
    if (this.closedFlag) return;
    this.closedFlag = true;
    this.socket.end();
  }

  get closed(): boolean {
    return this.closedFlag;
  }

  onMessage(listener: (bytes: Uint8Array) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onClose(listener: (info: Readonly<{ code: number; reason: string }>) => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  private receive(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32BE(0);
      if (this.buffer.length < 4 + length) return;
      const payload = this.buffer.subarray(4, 4 + length);
      this.buffer = this.buffer.subarray(4 + length);
      const copy = new Uint8Array(payload);
      for (const listener of [...this.listeners]) listener(copy);
    }
  }
}

describe('issue #243 AC7：真实 TCP + MemoryPersistence 1 Hub + 2 Peers（协商分块 + fan-out 分块镜像）', () => {
  it('A 超限写 → hub 分块收齐 apply + 单 ACK；hub fan-out 分块到 B；回声抑制不回送 A', async () => {
    const hubNode = makeNode('hub');
    const peerANode = makeNode('peer');
    const peerBNode = makeNode('peer');

    const lease = okLease(
      await hubNode.registry.create({
        owner: HUB_OWNER,
        schema: RT_SCHEMA,
        root: { n: 1, blurb: 'seed' },
      }),
    );
    await schemaReady(lease);
    const enabled = await lease.enableReplication();
    if (!enabled.ok) throw new Error('enableReplication failed');
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
      verifyToken: async () => ({ ok: false as const }), // acceptTrusted 路径不使用
      limits: RT_LIMITS,
    });

    // 方向帧记录器：hub 出站（服务器侧 transport）/ peer 出站（拨号侧 transport）
    const hubToA: Uint8Array[] = [];
    const hubToB: Uint8Array[] = [];
    const aToHub: Uint8Array[] = [];
    const bToHub: Uint8Array[] = [];

    let nextDir = 0;
    const port = await new Promise<number>((resolve) => {
      const server = net.createServer((socket) => {
        // 顺序拨号 → 连接序 = [A, B]（hub 侧按连接序分派可信身份）
        const dir = nextDir++ === 0 ? 'A' : 'B';
        const rec = dir === 'A' ? hubToA : hubToB;
        const transport = new FrameTransport(socket, (bytes) => rec.push(bytes.slice()));
        void hub.acceptTrusted!(transport, {
          peerInstanceId: dir === 'A' ? PEER_INSTANCE : INSTANCE_B,
        });
      });
      server.unref();
      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as net.AddressInfo;
        resolve(address.port);
      });
    });

    const dialPeer = (
      instanceId: string,
      recorder: Uint8Array[],
      node: typeof peerANode,
    ): PeerReplication => {
      let transport: FrameTransport | undefined;
      const peer = createPeerReplication({
        instanceId,
        hubInstanceId: HUB_INSTANCE,
        registry: node.registry,
        dial: () => {
          const socket = net.connect(port!, '127.0.0.1');
          transport = new FrameTransport(socket, (bytes) => recorder.push(bytes.slice()));
          return transport;
        },
        timer: node.scheduler,
        targets: [{ namespaceId: nsId, localOwner: PEER_OWNER }],
        limits: RT_LIMITS,
        chunkedUpdate: true,
      });
      void transport;
      return peer;
    };

    const peerA = dialPeer(PEER_INSTANCE, aToHub, peerANode);
    const peerB = dialPeer(INSTANCE_B, bToHub, peerBNode);
    // 顺序拨号：A 先行并等到 live 再拨 B——hub 侧按连接序分派身份是确定性的
    peerA.start();
    await waitUntil('A live', () => peerA.getNamespaceState(nsId) === 'live', 10_000);
    peerB.start();
    await waitUntil('B live', () => peerB.getNamespaceState(nsId) === 'live', 10_000);

    try {
      // A 业务写 BIG
      const bizA = okLease(await peerANode.registry.open(PEER_OWNER, nsId));
      await schemaReady(bizA);
      const r = await bizA.mutateData({ op: 'set', path: ['blurb'], value: BIG });
      if (!r.ok) throw new Error('A write failed');
      await bizA.release();

      const hubBlurb = (): unknown => {
        const doc = hubNode.persistence.peek(HUB_OWNER, nsId)!;
        return (doc.getMap('ROOT') as unknown as Map<string, unknown>).get('blurb');
      };
      const bBlurb = (): unknown => {
        const doc = peerBNode.persistence.peek(PEER_OWNER, nsId)!;
        return (doc.getMap('ROOT') as unknown as Map<string, unknown>).get('blurb');
      };
      await waitUntil('hub 收敛 BIG', () => hubBlurb() === BIG, 10_000);
      await waitUntil('B 收敛 BIG（fan-out）', () => bBlurb() === BIG, 10_000);
      await new Promise<void>((resolve) => setTimeout(resolve, 100)); // ACK 回流

      // —— A→hub：分块上行 + 帧形状 + 单 ACK 关联末 chunk 序 ——
      const upChunks: ChunkMsg[] = [];
      for (const bytes of aToHub) {
        const decoded = decodeMessage(bytes, { selectedCapabilities: CAP_CHUNKED_UPDATE });
        if (decoded.message.kind === 'UPDATE_CHUNK') upChunks.push(decoded.message as ChunkMsg);
      }
      expect(upChunks.length, 'A→hub 必须 ≥2 个 UPDATE_CHUNK（真实协商连接）').toBeGreaterThanOrEqual(2);
      const maxUpdateBytes = RT_LIMITS.maxUpdateBytes!;
      const maxFrameBytes = 8 * 1024 * 1024;
      for (const [index, entry] of aToHub
        .map((bb) => ({ bb, d: decodeMessage(bb, { selectedCapabilities: CAP_CHUNKED_UPDATE }) }))
        .filter((f) => f.d.message.kind === 'UPDATE_CHUNK')
        .entries()) {
        const c = entry.d.message as ChunkMsg;
        expect(c.bytes.byteLength, `A chunk[${index}] 载荷 ≤ maxUpdateBytes`).toBeLessThanOrEqual(maxUpdateBytes);
        expect(entry.bb.byteLength, `A chunk[${index}] 帧全长 ≤ maxFrameBytes`).toBeLessThanOrEqual(maxFrameBytes);
      }
      expect(new Set(upChunks.map((c) => c.transferId)).size).toBe(1);
      expect(new Set(upChunks.map((c) => c.chunkCount)).size).toBe(1);
      expect(new Set(upChunks.map((c) => c.totalBytes)).size).toBe(1);
      for (const [index, c] of upChunks.entries()) expect(c.chunkIndex).toBe(index);
      const totalUp = upChunks[0]!.totalBytes;
      expect(upChunks.reduce((sum, c) => sum + c.bytes.byteLength, 0)).toBe(totalUp);
      const upAcks: AckMsg[] = [];
      const hubToAKinds: string[] = [];
      for (const bytes of hubToA) {
        const decoded = decodeMessage(bytes, { selectedCapabilities: CAP_CHUNKED_UPDATE });
        hubToAKinds.push(decoded.message.kind);
        if (decoded.message.kind === 'UPDATE_ACK') upAcks.push(decoded.message as AckMsg);
      }
      expect(upAcks.length, 'A→hub 单 UPDATE_ACK').toBe(1);
      const lastUpSeq = aToHub
        .map((b) => decodeMessage(b, { selectedCapabilities: CAP_CHUNKED_UPDATE }))
        .filter((f) => f.message.kind === 'UPDATE_CHUNK')
        .at(-1)!.header.sequence;
      expect(upAcks[0]!.ackedSequence, 'ACK 锚 = 末 chunk 帧序').toBe(lastUpSeq);

      // —— hub→B：fan-out 分块下行（B 协商）——
      const downChunks: ChunkMsg[] = [];
      for (const bytes of hubToB) {
        const decoded = decodeMessage(bytes, { selectedCapabilities: CAP_CHUNKED_UPDATE });
        if (decoded.message.kind === 'UPDATE_CHUNK') downChunks.push(decoded.message as ChunkMsg);
      }
      expect(downChunks.length, 'hub→B fan-out 载荷超限 → 分块下行（≥2）').toBeGreaterThanOrEqual(2);
      expect(new Set(downChunks.map((c) => c.transferId)).size, 'fan-out transferId 跨帧一致').toBe(1);
      for (const [index, c] of downChunks.entries()) expect(c.chunkIndex, 'chunkIndex 严格递增').toBe(index);
      const bAcks: AckMsg[] = [];
      for (const bytes of bToHub) {
        const decoded = decodeMessage(bytes, { selectedCapabilities: CAP_CHUNKED_UPDATE });
        if (decoded.message.kind === 'UPDATE_ACK') bAcks.push(decoded.message as AckMsg);
      }
      expect(bAcks.length, 'B 收齐后 UPDATE_ACK 回程').toBeGreaterThanOrEqual(1);

      // —— 回声抑制：A 的写不回送 A ——
      expect(
        hubToAKinds.filter((k) => k === 'UPDATE' || k === 'UPDATE_CHUNK'),
        'hub→A 零数据帧（applyOrigin 回声抑制）',
      ).toHaveLength(0);

      // —— 终态健康 ——
      expect(peerA.getNamespaceState(nsId)).toBe('live');
      expect(peerB.getNamespaceState(nsId)).toBe('live');
      expect(hub.connections.length, 'hub 双连接存活').toBe(2);
    } finally {
      await peerA.stop().catch(() => undefined);
      await peerB.stop().catch(() => undefined);
      await hub.close().catch(() => undefined);
    }
  }, 30_000);
});
