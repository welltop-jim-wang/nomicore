/**
 * issue #287 AC 末条「real-transport 动态族」抽样 —— 真实 TCP + 真实 OS timer 下的
 * schema re-arm 全链路：hub `replaceSchema()` → 真实 wire UPDATE → peer apply 槽
 * 结算续体发射恰一 `schema-rearm-applied`（§23.3 字段面）→ 新 tools 生效后的业务写
 * 经真实链路收敛到 peer 副本。
 *
 * 与 fake-duplex 套件（ws-replication-issue287-schema-rearm.test.ts，注入 timer +
 * 微任务投递、零 real sleep）分属不同测试类：本文件为**真实链路集成抽样**
 * （ws-replication-sa7-r2-transport 同款纪律）——node:net 真实 TCP、4B 长度前缀
 * 成帧（transport 适配器职责）、真实 timer、有界 real wait 轮询（waitUntil）、
 * Registry 走 testing seam。抽样面刻意收窄为 AC1 成功路径 + hub 反向零事件；
 * fatal/断连追赶的确定性注入面（序列记账纪律）留在 fake-duplex 套件。
 */
import * as net from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import {
  HUB_INSTANCE,
  HUB_OWNER,
  PEER_INSTANCE,
  PEER_OWNER,
  makeNode,
  okLease,
  schemaReady,
  type ReplicaNode,
} from './harness.js';
import { DEFAULT_PEER_VERIFIER, TEST_TOKEN } from './driver.js';
import { createHubReplication, createPeerReplication } from '@nomicore/ws-replication';
import type { NamespaceLease } from '@nomicore/namespace-registry';
import type {
  DuplexTransport,
  HubReplication,
  PeerReplication,
  ReplicationObserver,
  ReplicationObserverEvent,
  ReplicationTimer,
} from '@nomicore/ws-replication';

/** genesis SCHEMA：仅 `n` 必填。 */
const TEXT_V1 = 'type ROOT = { n: number; };\n';
/** re-arm 目标：新必填 `note`（「后续业务写按新 tools 校验」的可判据面）。 */
const TEXT_V2 = 'type ROOT = { n: number; note: string; };\n';
/** fingerprint 文法（§23.3 documented safe digest：`sha256:v1:<64 hex>`）。 */
const FINGERPRINT_RE = /^sha256:v1:[0-9a-f]{64}$/;

/** 有界 real wait 轮询（真实链路集成抽样专用，r2-transport 同款）。 */
async function waitUntil(what: string, predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) return;
    if (Date.now() > deadline) throw new Error(`waitUntil 超时（${timeoutMs}ms）：${what}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

/** stop/close 的有界等待（r2-transport 同款——真实链路收口允许晚于调用点完成）。 */
async function settleClose(promise: Promise<void>, ms: number): Promise<void> {
  await Promise.race([
    promise,
    new Promise<void>((resolve) => setTimeout(resolve, ms)),
  ]);
}

interface PairCloseMeta {
  hub: { code: number; reason: string } | undefined;
  peer: { code: number; reason: string } | undefined;
}

/** 真实 TCP transport 适配器：4B 长度前缀成帧（r2-transport 同款逐字复制——
 *  真实链路族每文件自备适配器为先例）。 */
class TcpTransport implements DuplexTransport {
  private readonly socket: net.Socket;
  private readonly messageListeners: Array<(bytes: Uint8Array) => void> = [];
  private readonly closeListeners: Array<(info: Readonly<{ code: number; reason: string }>) => void> = [];
  private readonly meta: PairCloseMeta;
  private readonly side: 'hub' | 'peer';
  private buffer: Buffer = Buffer.alloc(0);
  private readonly pendingFrames: Uint8Array[] = [];
  private closedFlag = false;

  constructor(socket: net.Socket, side: 'hub' | 'peer', meta: PairCloseMeta) {
    this.socket = socket;
    this.side = side;
    this.meta = meta;
    socket.on('data', (chunk: Buffer) => this.receive(chunk));
    socket.on('close', () => {
      this.closedFlag = true;
      const info = this.side === 'hub' ? this.meta.peer : this.meta.hub;
      for (const listener of this.closeListeners) listener(info ?? { code: 1006, reason: 'abnormal' });
    });
    socket.on('error', () => {
      /* close 事件随错误到达；此处仅防 unhandled error 事件 */
    });
  }

  get bufferedAmount(): number {
    return this.socket.writableLength;
  }

  get closed(): boolean {
    return this.closedFlag || this.socket.destroyed;
  }

  send(bytes: Uint8Array): void {
    if (this.closedFlag) return;
    const header = Buffer.alloc(4);
    header.writeUInt32BE(bytes.byteLength, 0);
    this.socket.write(Buffer.concat([header, Buffer.from(bytes)]));
  }

  close(code?: number, reason?: string): void {
    if (this.closedFlag) return;
    this.meta[this.side] = { code: code ?? 1005, reason: reason ?? '' };
    this.socket.end();
    setTimeout(() => this.socket.destroy(), 2_000).unref?.();
  }

  onMessage(listener: (bytes: Uint8Array) => void): () => void {
    this.messageListeners.push(listener);
    if (this.pendingFrames.length > 0) {
      const replay = this.pendingFrames.splice(0);
      for (const bytes of replay) listener(bytes);
    }
    return () => {
      const index = this.messageListeners.indexOf(listener);
      if (index >= 0) this.messageListeners.splice(index, 1);
    };
  }

  onClose(listener: (info: Readonly<{ code: number; reason: string }>) => void): () => void {
    this.closeListeners.push(listener);
    return () => {
      const index = this.closeListeners.indexOf(listener);
      if (index >= 0) this.closeListeners.splice(index, 1);
    };
  }

  private receive(chunk: Buffer): void {
    if (this.closedFlag) return;
    this.buffer = this.buffer.byteLength === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    for (;;) {
      if (this.buffer.byteLength < 4) return;
      const length = this.buffer.readUInt32BE(0);
      if (this.buffer.byteLength < 4 + length) return;
      const payload = this.buffer.subarray(4, 4 + length);
      this.buffer = this.buffer.subarray(4 + length);
      const copy = new Uint8Array(payload.byteLength);
      copy.set(payload);
      if (this.messageListeners.length === 0) {
        this.pendingFrames.push(copy);
        continue;
      }
      for (const listener of this.messageListeners) listener(copy);
    }
  }
}

/** 真实 timer（真实链路抽样；协议时间面走真实时钟）。 */
const realTimer: ReplicationTimer = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs) as unknown,
  clearTimeout: (handle) => clearTimeout(handle as unknown as number),
};

/** observer 事件收集器（生产 `observer` 配置面注入）。 */
class Collector {
  readonly events: ReplicationObserverEvent[] = [];
  readonly observer: ReplicationObserver = (event) => {
    this.events.push(event);
  };
  rearm(): ReplicationObserverEvent[] {
    return this.events.filter((e) => e.type.startsWith('schema-rearm-'));
  }
}

interface RealRun {
  readonly hubNode: ReplicaNode;
  readonly peerNode: ReplicaNode;
  readonly hub: HubReplication;
  readonly peer: PeerReplication;
  readonly hubLease: NamespaceLease;
  readonly nsId: string;
  readonly server: net.Server;
  readonly sockets: net.Socket[];
  destroy(): void;
}

/** 组装真实 TCP 链路：单 namespace + 双侧 observer + 真实 timer。 */
async function bootReal(hub: Collector, peerCollector: Collector): Promise<RealRun> {
  const hubNode = makeNode('hub');
  const peerNode = makeNode('peer');
  const hubLease = okLease(
    await hubNode.registry.create({
      owner: HUB_OWNER,
      schema: { lang: 'vfsl', version: 1, id: 'issue287-real-transport', text: TEXT_V1 },
      root: { n: 1 },
    }),
  );
  await schemaReady(hubLease);
  const enabled = await hubLease.enableReplication();
  if (!enabled.ok) throw new Error(`enableReplication 失败：${JSON.stringify(enabled)}`);
  const nsId = hubLease.namespaceId;

  const meta: PairCloseMeta = { hub: undefined, peer: undefined };
  const sockets: net.Socket[] = [];

  const hubReplication = createHubReplication({
    instanceId: HUB_INSTANCE,
    registry: hubNode.registry,
    authorize: async () => ({
      ok: true as const,
      localOwner: HUB_OWNER,
      permissions: { read: true, submit: true },
    }),
    timer: realTimer,
    verifyToken: DEFAULT_PEER_VERIFIER,
    observer: hub.observer,
  });

  const server = net.createServer((socket) => {
    sockets.push(socket);
    hubReplication.accept(new TcpTransport(socket, 'hub', meta), { token: TEST_TOKEN });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;

  const peer = createPeerReplication({
    instanceId: PEER_INSTANCE,
    hubInstanceId: HUB_INSTANCE,
    registry: peerNode.registry,
    dial: () => {
      const socket = net.connect(port, '127.0.0.1');
      sockets.push(socket);
      return new TcpTransport(socket, 'peer', meta);
    },
    timer: realTimer,
    targets: [{ namespaceId: nsId, localOwner: PEER_OWNER }],
    observer: peerCollector.observer,
  });
  peer.start();
  await waitUntil('连接 ready', () => peer.getConnectionState() === 'ready', 15_000);
  await waitUntil(
    `namespace live（当前 ${String(peer.getNamespaceState(nsId))}）`,
    () => peer.getNamespaceState(nsId) === 'live',
    15_000,
  );

  return {
    hubNode,
    peerNode,
    hub: hubReplication,
    peer,
    hubLease,
    nsId,
    server,
    sockets,
    destroy() {
      for (const socket of sockets) socket.destroy();
      server.close();
    },
  };
}

describe('issue #287 real-transport 抽样：真实 TCP 链路的 schema re-arm 全链路', () => {
  const runs: RealRun[] = [];
  afterAll(() => {
    for (const run of runs) run.destroy();
  });

  it('hub replaceSchema → 真实 wire UPDATE → peer 恰一 schema-rearm-applied（§23.3 字段面）→ 新 tools 业务写收敛；hub 侧零 re-arm 事件', async () => {
    const hub = new Collector();
    const peer = new Collector();
    const run = await bootReal(hub, peer);
    runs.push(run);

    expect(peer.rearm(), '初始零 re-arm 事件').toEqual([]);

    const replaced = await run.hubLease.replaceSchema({
      schema: { lang: 'vfsl', version: 1, id: run.nsId, text: TEXT_V2 },
      root: { n: 2, note: 'v2' },
    });
    if (!replaced.ok) throw new Error(`hub replaceSchema 失败：${JSON.stringify(replaced)}`);

    await waitUntil('peer schema-rearm-applied 恰一', () => peer.rearm().length >= 1, 15_000);
    // 恰一（等一个宽窗口确认无第二事件——真实链路无确定性排空点，有界轮询后即判）
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    const events = peer.rearm();
    expect(events.length, `re-arm 事件应恰一，实际 ${JSON.stringify(events)}`).toBe(1);
    const applied = events[0] as Extract<
      ReplicationObserverEvent,
      { type: 'schema-rearm-applied' }
    >;
    expect(applied.type).toBe('schema-rearm-applied');
    expect(applied.side).toBe('peer');
    expect(applied.namespaceId).toBe(run.nsId);
    // §23.3 字段面：fingerprint 文法 + 与 hub active 逐值一致；updatedAt = 复制来的
    // 投影（非 null——replaceSchema 正常提交 META.schema 载体）
    const hubActive = run.hubLease.getActiveSchema();
    if (hubActive === null) throw new Error('hub active schema 缺席');
    expect(applied.semanticFingerprint).toMatch(FINGERPRINT_RE);
    expect(applied.semanticFingerprint).toBe(hubActive.semanticFingerprint);
    expect(applied.updatedAt).toBe(hubActive.updatedAt);
    // 键集冻结（§23.3：无 schema 文本/ROOT/堆栈）
    const allowed = new Set([
      'type',
      'side',
      'connectionId',
      'namespaceId',
      'semanticFingerprint',
      'updatedAt',
    ]);
    for (const key of Object.keys(applied)) {
      expect(allowed.has(key), `意外键 ${key}`).toBe(true);
    }
    expect(JSON.stringify(applied).includes('type ROOT'), '不含 SCHEMA 文本').toBe(false);
    // hub 侧结构性零 re-arm 事件（conformance 反向断言的真实链路面）
    expect(hub.rearm(), 'hub 侧零 re-arm 事件').toEqual([]);

    // 新 tools 生效：按 V2 必填 note 的业务写经真实链路收敛到 peer 副本
    const written = await run.hubLease.mutateData({ op: 'set', path: ['note'], value: 'after-rearm' });
    if (!written.ok) throw new Error(`re-arm 后业务写失败：${JSON.stringify(written)}`);
    const peerLease = okLease(await run.peerNode.registry.open(PEER_OWNER, run.nsId));
    await schemaReady(peerLease);
    await waitUntil(
      'peer 副本收敛 re-arm 后业务写',
      () => {
        const read = peerLease.readData(['note']);
        return read.ok === true && read.value === 'after-rearm';
      },
      15_000,
    );
    // peer 侧 active schema 亦已切换（同一 re-arm 事实的本地读面）
    expect(peerLease.getActiveSchema()?.semanticFingerprint).toBe(hubActive.semanticFingerprint);
    await peerLease.release();

    expect(run.peer.getConnectionState()).toBe('ready');
    expect(run.peer.getNamespaceState(run.nsId)).toBe('live');

    await settleClose(run.peer.stop(), 3_000);
    await settleClose(run.hub.close(), 3_000);
  }, 60_000);
});
