/**
 * SA7 R1 动态验证补充测试（issue #138 切片 7）—— SA4 交 SA7 动态审核重点 D3/D4/D5。
 *
 * 全部在【真实 TCP loopback】链路上验证（对照 fake-duplex 红灯契约的红线纪律，本文件
 * 属真实链路集成抽样类：真实 timer + 有界 real wait——与 sa7-r2-transport 同款测试类，
 * header 显式声明）：
 *   D5 —— 真实 TcpTransport × 认证窗口叠加（SA4 §9-D5 / 设计 A3）：server 回调路径在
 *         verifyToken 异步窗口内的积压重放（pendingFrames）与 accept 早到帧缓冲叠加
 *         【无双重投递】——恰 1 个 HELLO_ACK、零 SEQUENCE_VIOLATION/ERROR、live 收敛。
 *         两种到达形态各验一次：'after-first-frame'（数据先于注册 → pendingFrames 积压
 *         重放路径，适配器确定性触发）与 'immediate'（注册先于数据 → 直达路径）。
 *   D4 —— GOAWAY → close(1001) 真实 TCP 次序（SA4 §9-D4 / 设计 §7.2）：hub.close() 后
 *         peer 侧【原始 socket】先收到 GOAWAY 帧（SERVER_SHUTTING_DOWN + drain>0）
 *         再收到 close 事件（TCP 半关闭次序），随后 blocked（永久类分类）。
 *   D3 —— 认证期早到帧洪泛资源界（SA4 §9-D3 / ADR 0010 L165）：未认证 socket 灌帧——
 *         ① 条数界：第 17 帧即 close(1008)；② 认证等待封顶：helloTimeoutMs 到点
 *         close(1008) + 驻留峰值有界 + 迟归验证器不复活 + GC 后回收；③ 单帧界：
 *         > maxFrameBytes 即 close(1009)、零协议连接分配、零协议帧。
 *
 * 纪律：真实 Registry 双实例（makeNode）；token 走 hub 侧 accept 注入（切片 9 前无生产
 * 注入点——D2 静态证据）；RSS 观测 = process.memoryUsage()（hub 与测试同进程）；GC 诱导
 * 优先 --expose-gc（不可得则分配压力兜底），断言边界留足容差防环境噪声。
 */
import * as net from 'node:net';
import v8 from 'node:v8';
import vm from 'node:vm';
import { afterAll, describe, expect, it } from 'vitest';
import {
  CONTRACT_LIMITS,
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
import type {
  DuplexTransport,
  HubReplication,
  PeerReplication,
  ReplicationTimer,
} from '@nomicore/ws-replication';
import { decodeMessage, type DecodedMessage } from '@nomicore/replication-protocol';
import type { NamespaceOwner } from '@nomicore/namespace-registry';

const AUTH_SCHEMA = Object.freeze({
  lang: 'vfsl',
  version: 1,
  id: 'sa7-r1-auth-real',
  text: 'type ROOT = { n: number; };\n',
});

/** 有界 real wait 轮询（真实链路集成抽样专用）。 */
async function waitUntil(what: string, predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) return;
    if (Date.now() > deadline) throw new Error(`waitUntil 超时（${timeoutMs}ms）：${what}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

/** 真实 timer（本文件为真实链路抽样；协议时间面走真实时钟）。 */
const realTimer: ReplicationTimer = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs) as unknown,
  clearTimeout: (handle) => clearTimeout(handle as unknown as number),
};

interface CloseMeta {
  hub: { code: number; reason: string } | undefined;
  peer: { code: number; reason: string } | undefined;
}

/**
 * 真实 TCP transport 适配器（形态同 sa7-r2-transport 的 TcpTransport：4B 长度前缀成帧、
 * bufferedAmount = socket.writableLength、onMessage 注册即同步重放 pendingFrames 积压），
 * 增认证窗口观测钩子：onFrame 在【成帧解析点】触发（早于 listener 派发/积压入队——
 * D5 证明「HELLO 字节在验证器放行前已到达 hub」）；replayedFromBacklog 计积压重放帧数。
 */
class ProbeTransport implements DuplexTransport {
  readonly socket: net.Socket;
  private readonly messageListeners: Array<(bytes: Uint8Array) => void> = [];
  private readonly closeListeners: Array<(info: Readonly<{ code: number; reason: string }>) => void> = [];
  private readonly meta: CloseMeta;
  private readonly side: 'hub' | 'peer';
  private readonly onFrame: ((bytes: Uint8Array) => void) | undefined;
  private readonly onSend: ((bytes: Uint8Array) => void) | undefined;
  /** 积压就绪钩子（D5 'after-first-frame' 模式）：首帧入 pendingFrames 后同步触发。 */
  onBacklogReady: (() => void) | undefined;
  private buffer: Buffer = Buffer.alloc(0);
  private readonly pendingFrames: Uint8Array[] = [];
  private closedFlag = false;
  private backlogReplays = 0;
  private receivedCount = 0;

  constructor(
    socket: net.Socket,
    side: 'hub' | 'peer',
    meta: CloseMeta,
    hooks: { onFrame?: (bytes: Uint8Array) => void; onSend?: (bytes: Uint8Array) => void } = {},
  ) {
    this.socket = socket;
    this.side = side;
    this.meta = meta;
    this.onFrame = hooks.onFrame;
    this.onSend = hooks.onSend;
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

  /** 已成帧解析的入站帧数（含被积压/被拒绝的帧——洪泛观测面）。 */
  get framesReceived(): number {
    return this.receivedCount;
  }

  /** 经 onMessage 注册期同步重放派发的积压帧数（D5 积压路径证据）。 */
  get replayedFromBacklog(): number {
    return this.backlogReplays;
  }

  send(bytes: Uint8Array): void {
    if (this.closedFlag) return;
    const header = Buffer.alloc(4);
    header.writeUInt32BE(bytes.byteLength, 0);
    this.socket.write(Buffer.concat([header, Buffer.from(bytes)]));
    this.onSend?.(bytes);
  }

  close(code?: number, reason?: string): void {
    if (this.closedFlag) return;
    this.meta[this.side] = { code: code ?? 1005, reason: reason ?? '' };
    this.closedFlag = true;
    this.socket.end();
    setTimeout(() => this.socket.destroy(), 2_000).unref?.();
  }

  onMessage(listener: (bytes: Uint8Array) => void): () => void {
    this.messageListeners.push(listener);
    // 真实 TCP 上数据可能先于协议侧注册 listener 到达——注册后重放积压帧，
    // 保 DuplexTransport「一 send 一 message」语义（sa7-r2-transport:132-144 同款）。
    if (this.pendingFrames.length > 0) {
      const replay = this.pendingFrames.splice(0);
      for (const bytes of replay) {
        this.backlogReplays += 1;
        listener(bytes);
      }
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
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    for (;;) {
      if (this.buffer.byteLength < 4) return;
      const length = this.buffer.readUInt32BE(0);
      if (this.buffer.byteLength < 4 + length) return;
      const payload = this.buffer.subarray(4, 4 + length);
      this.buffer = this.buffer.subarray(4 + length);
      const copy = new Uint8Array(payload.byteLength);
      copy.set(payload);
      this.receivedCount += 1;
      this.onFrame?.(copy);
      if (this.messageListeners.length === 0) {
        this.pendingFrames.push(copy);
        if (this.pendingFrames.length === 1) this.onBacklogReady?.(); // 首帧积压即触发（D5）
        continue;
      }
      for (const listener of this.messageListeners) listener(copy);
    }
  }
}

/** GC 诱导：--expose-gc 可得则用之（含运行时 flag 回退）；否则分配压力兜底。 */
async function induceGc(): Promise<'expose-gc' | 'pressure'> {
  const direct = (globalThis as { gc?: () => void }).gc;
  if (typeof direct === 'function') {
    for (let i = 0; i < 3; i += 1) {
      direct();
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
    }
    return 'expose-gc';
  }
  try {
    v8.setFlagsFromString('--expose_gc');
    const gc = vm.runInNewContext('gc') as () => void;
    for (let i = 0; i < 3; i += 1) {
      gc();
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
    }
    v8.setFlagsFromString('--no-expose_gc');
    return 'expose-gc';
  } catch {
    // 分配压力兜底：大块 Buffer 分配/释放迫使 V8 major GC + 外部内存回收。
    const churn: Buffer[] = [];
    for (let round = 0; round < 3; round += 1) {
      for (let i = 0; i < 32; i += 1) churn.push(Buffer.alloc(4 * 1024 * 1024, 0x62));
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
      churn.length = 0;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    return 'pressure';
  }
}

function rssMiB(): number {
  return process.memoryUsage().rss / (1024 * 1024);
}

/** 原始 socket 长度前缀写帧（未认证客户端洪泛——不经任何协议对象）。 */
async function rawWriteFrames(
  socket: net.Socket,
  count: number,
  size: number,
  isDead: () => boolean,
): Promise<void> {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(size, 0);
  const frame = Buffer.concat([header, Buffer.alloc(size, 0x61)]);
  for (let index = 0; index < count && !isDead() && !socket.destroyed; index += 1) {
    if (socket.write(frame)) continue;
    await new Promise<void>((resolve) => {
      const finish = (): void => {
        socket.off('drain', onDrain);
        socket.off('close', onClose);
        clearTimeout(timer);
        resolve();
      };
      const onDrain = (): void => finish();
      const onClose = (): void => finish();
      const timer = setTimeout(finish, 1_000);
      socket.once('drain', onDrain);
      socket.once('close', onClose);
    });
  }
}

function countKind(frames: readonly DecodedMessage[], kind: string): number {
  return frames.filter((f) => f.message.kind === kind).length;
}

/** 建一个 namespace（真实 registry，replication 已启用）。 */
async function makeNamespace(hubNode: ReplicaNode, salt: string): Promise<string> {
  const lease = okLease(
    await hubNode.registry.create({
      owner: HUB_OWNER,
      schema: { ...AUTH_SCHEMA, id: `sa7-r1-${salt}` },
      root: { n: 1 },
    }),
  );
  await schemaReady(lease);
  const enabled = await lease.enableReplication();
  if (!enabled.ok) throw new Error(`enableReplication 失败：${JSON.stringify(enabled)}`);
  return lease.namespaceId;
}

/** 业务写（r2-transport write 同款）。 */
async function writeValue(node: ReplicaNode, owner: NamespaceOwner, nsId: string, n: number): Promise<void> {
  const lease = okLease(await node.registry.open(owner, nsId));
  await schemaReady(lease);
  const result = await lease.mutateData({ op: 'set', path: ['n'], value: n });
  if (!result.ok) throw new Error(`业务写失败：${JSON.stringify(result)}`);
  await lease.release();
}

/** ROOT 投影读（driver rootValue 同款：persistence.peek → Y.Doc ROOT map）。 */
function rootValue(node: ReplicaNode, owner: NamespaceOwner, nsId: string): unknown {
  const doc = node.persistence.peek(owner, nsId);
  if (doc === undefined) return undefined;
  return (doc.getMap('ROOT') as unknown as Map<string, unknown>).get('n');
}

const liveServers: net.Server[] = [];
const livePeers: PeerReplication[] = [];
const liveHubs: HubReplication[] = [];

afterAll(async () => {
  for (const peer of livePeers.splice(0)) {
    await Promise.race([peer.stop(), new Promise<void>((r) => setTimeout(r, 3_000))]);
  }
  for (const hub of liveHubs.splice(0)) {
    await Promise.race([hub.close(), new Promise<void>((r) => setTimeout(r, 3_000))]);
  }
  for (const server of liveServers.splice(0)) server.close();
});

describe('issue #138 SA7 R1：真实 TCP 认证窗口动态验证（SA4 D3/D4/D5）', () => {
  it(
    'D5：verifyToken 异步窗口内 HELLO 早到——积压重放（after-first-frame）与直达（immediate）两形态均恰 1 个 HELLO_ACK、零 SEQUENCE_VIOLATION/ERROR、live 双向收敛',
    { timeout: 120_000 },
    async () => {
      const hubNode = makeNode('hub');
      const peerNode = makeNode('peer');
      const nsId = await makeNamespace(hubNode, 'd5');
      const meta: CloseMeta = { hub: undefined, peer: undefined };
      const hubSent: DecodedMessage[] = [];
      const verifyCalls: string[] = [];
      let acceptMode: 'immediate' | 'after-first-frame' = 'after-first-frame';
      let hubTransport: ProbeTransport | undefined;

      // 门控验证器：认证窗口由测试显式放行（挂起期 = 真实异步认证窗口）。
      let releaseVerifier!: () => void;
      const verifierGate = new Promise<void>((resolve) => {
        releaseVerifier = resolve;
      });
      const gatedVerifier = (token: string): Promise<
        Readonly<{ ok: true; instanceId: string }> | Readonly<{ ok: false }>
      > => {
        verifyCalls.push(token);
        return verifierGate.then(() =>
          token === TEST_TOKEN ? { ok: true, instanceId: PEER_INSTANCE } : { ok: false },
        );
      };

      const hub = createHubReplication({
        instanceId: HUB_INSTANCE,
        registry: hubNode.registry,
        authorize: async () => ({
          ok: true as const,
          localOwner: HUB_OWNER,
          permissions: { read: true, submit: true },
        }),
        timer: realTimer,
        verifyToken: gatedVerifier,
      });
      liveHubs.push(hub);

      const server = net.createServer((socket) => {
        const transport = new ProbeTransport(socket, 'hub', meta, {
          onSend: (bytes) => hubSent.push(decodeMessage(bytes)),
        });
        hubTransport = transport;
        const startAccept = (): void => {
          void hub.accept(transport, { token: TEST_TOKEN });
        };
        if (acceptMode === 'after-first-frame') {
          // 数据先于注册到达：首帧入积压即同步发起 accept → 注册期同步重放积压。
          transport.onBacklogReady = startAccept;
        } else {
          startAccept();
        }
      });
      liveServers.push(server);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = (server.address() as net.AddressInfo).port;

      const bootPeer = (): PeerReplication => {
        const peer = createPeerReplication({
          instanceId: PEER_INSTANCE,
          hubInstanceId: HUB_INSTANCE,
          registry: peerNode.registry,
          dial: () => new ProbeTransport(net.connect(port, '127.0.0.1'), 'peer', meta),
          timer: realTimer,
          targets: [{ namespaceId: nsId, localOwner: PEER_OWNER }],
          // 防重拨噪声干扰观测窗（本用例不测重连）。
          backoff: { baseMs: 60_000, maxMs: 60_000, resetAfterMs: 60_000 },
        });
        peer.start();
        return peer;
      };

      // ── 形态一：after-first-frame（pendingFrames 积压重放路径，确定性触发）──
      const peer1 = bootPeer();
      livePeers.push(peer1);
      await waitUntil('hub 侧 transport 建立', () => hubTransport !== undefined, 15_000);
      const transport1 = hubTransport!;
      // HELLO 字节已到达 hub（成帧解析点）且验证器尚未放行 → 真实异步认证窗口内早到。
      await waitUntil(
        'HELLO 在认证窗口内到达 hub',
        () => (hubTransport?.framesReceived ?? 0) >= 1,
        15_000,
      );
      expect(verifyCalls).toEqual([TEST_TOKEN]);
      expect(transport1.replayedFromBacklog).toBeGreaterThanOrEqual(1); // 积压路径确实走了
      expect(hub.connections.length).toBe(0); // 认证未过 → 零协议连接分配
      releaseVerifier(); // 放行认证 → 早到 HELLO 经积压重放进入 FSM
      await waitUntil('peer1 ready', () => peer1.getConnectionState() === 'ready', 15_000);
      await waitUntil('peer1 ns live', () => peer1.getNamespaceState(nsId) === 'live', 15_000);
      // ★ 无双重投递（D5 主断言）：恰 1 个 HELLO_ACK；双重投递会触发第二个 HELLO_ACK
      //   或 SEQUENCE_VIOLATION/CONNECTION_POLICY_VIOLATION（落在 ERROR/帧计数上）。
      expect(countKind(hubSent, 'HELLO_ACK')).toBe(1);
      expect(countKind(hubSent, 'ERROR')).toBe(0);
      expect(countKind(hubSent, 'RESYNC_REQUIRED')).toBe(0);
      // 双向收敛
      await writeValue(peerNode, PEER_OWNER, nsId, 41);
      await waitUntil('peer 写收敛到 hub', () => rootValue(hubNode, HUB_OWNER, nsId) === 41, 15_000);
      await writeValue(hubNode, HUB_OWNER, nsId, 42);
      await waitUntil('hub 写收敛到 peer', () => rootValue(peerNode, PEER_OWNER, nsId) === 42, 15_000);
      await Promise.race([peer1.stop(), new Promise<void>((r) => setTimeout(r, 3_000))]);

      // ── 形态二：immediate（注册先于数据 → 直达路径；gate 已开 → 验证器即时归）──
      acceptMode = 'immediate';
      const verifyCallsBefore = verifyCalls.length;
      const sentBefore = hubSent.length;
      const peer2 = bootPeer();
      livePeers.push(peer2);
      await waitUntil('peer2 ready', () => peer2.getConnectionState() === 'ready', 15_000);
      await waitUntil('peer2 ns live', () => peer2.getNamespaceState(nsId) === 'live', 15_000);
      expect(countKind(hubSent.slice(sentBefore), 'HELLO_ACK')).toBe(1);
      expect(countKind(hubSent.slice(sentBefore), 'ERROR')).toBe(0);
      expect(verifyCalls.length).toBe(verifyCallsBefore + 1); // 每连接恰一次认证记账
      await writeValue(peerNode, PEER_OWNER, nsId, 43);
      await waitUntil('peer2 写收敛到 hub', () => rootValue(hubNode, HUB_OWNER, nsId) === 43, 15_000);
    },
  );

  it(
    'D4/#229：hub.close() 不发送 GOAWAY；真实 TCP 以 1001 收口，Peer 进入 backoff',
    { timeout: 90_000 },
    async () => {
      const hubNode = makeNode('hub');
      const peerNode = makeNode('peer');
      const nsId = await makeNamespace(hubNode, 'd4');
      const meta: CloseMeta = { hub: undefined, peer: undefined };
      let peerTransport: ProbeTransport | undefined;

      const hub = createHubReplication({
        instanceId: HUB_INSTANCE,
        registry: hubNode.registry,
        authorize: async () => ({
          ok: true as const,
          localOwner: HUB_OWNER,
          permissions: { read: true, submit: true },
        }),
        timer: realTimer,
        verifyToken: DEFAULT_PEER_VERIFIER,
      });

      const server = net.createServer((socket) => {
        const transport = new ProbeTransport(socket, 'hub', meta);
        void hub.accept(transport, { token: TEST_TOKEN });
      });
      liveServers.push(server);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = (server.address() as net.AddressInfo).port;

      const peer = createPeerReplication({
        instanceId: PEER_INSTANCE,
        hubInstanceId: HUB_INSTANCE,
        registry: peerNode.registry,
        dial: () => {
          peerTransport = new ProbeTransport(net.connect(port, '127.0.0.1'), 'peer', meta);
          return peerTransport;
        },
        timer: realTimer,
        targets: [{ namespaceId: nsId, localOwner: PEER_OWNER }],
        backoff: { baseMs: 60_000, maxMs: 60_000, resetAfterMs: 60_000 },
      });
      peer.start();
      await waitUntil('连接 ready', () => peer.getConnectionState() === 'ready', 15_000);
      await waitUntil('namespace live', () => peer.getNamespaceState(nsId) === 'live', 15_000);
      expect(peerTransport).toBeDefined();

      // peer 侧【原始 socket】事件序记录器（独立于适配器——纯 wire 观测）。
      const wireEvents: string[] = [];
      const wireFrames: DecodedMessage[] = [];
      let recorderBuf = Buffer.alloc(0);
      peerTransport!.socket.on('data', (chunk: Buffer) => {
        recorderBuf = Buffer.concat([recorderBuf, chunk]);
        for (;;) {
          if (recorderBuf.byteLength < 4) break;
          const length = recorderBuf.readUInt32BE(0);
          if (recorderBuf.byteLength < 4 + length) break;
          const payload = recorderBuf.subarray(4, 4 + length);
          recorderBuf = recorderBuf.subarray(4 + length);
          const decoded = decodeMessage(payload);
          wireFrames.push(decoded);
          wireEvents.push(`frame:${decoded.message.kind}`);
        }
      });
      peerTransport!.socket.on('close', () => wireEvents.push('socket-close'));

      await hub.close();

      await waitUntil('peer 原始 socket 关闭', () => wireEvents.includes('socket-close'), 15_000);
      expect(wireFrames.some((f) => f.message.kind === 'GOAWAY')).toBe(false);
      expect(meta.hub).toEqual({ code: 1001, reason: 'hub-shutdown' });
      expect(wireFrames.some((f) => f.message.kind === 'ERROR')).toBe(false);
      await waitUntil('peer backoff', () => peer.getConnectionState() === 'backoff', 15_000);
    },
  );

  it(
    'D3-①条数界：未认证 socket 灌 40×1MiB → 第 17 帧即 close(1008)、零分配、后续帧零驻留（40MiB 上 wire 活外部内存增量 ≤24MiB）',
    { timeout: 120_000 },
    async () => {
      const hubNode = makeNode('hub');
      const meta: CloseMeta = { hub: undefined, peer: undefined };
      let hubTransport: ProbeTransport | undefined;
      let releaseVerifier!: () => void;
      const gate = new Promise<void>((resolve) => {
        releaseVerifier = resolve;
      });

      const hub = createHubReplication({
        instanceId: HUB_INSTANCE,
        registry: hubNode.registry,
        authorize: async () => ({
          ok: true as const,
          localOwner: HUB_OWNER,
          permissions: { read: true, submit: true },
        }),
        timer: realTimer,
        verifyToken: () => gate.then(() => ({ ok: true, instanceId: PEER_INSTANCE })),
      });
      liveHubs.push(hub);

      const server = net.createServer((socket) => {
        hubTransport = new ProbeTransport(socket, 'hub', meta);
        void hub.accept(hubTransport, { token: TEST_TOKEN });
      });
      liveServers.push(server);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = (server.address() as net.AddressInfo).port;

      const client = net.connect(port, '127.0.0.1');
      let clientClosed = false;
      client.on('close', () => {
        clientClosed = true;
      });
      await new Promise<void>((resolve) => client.once('connect', resolve));
      const rssBefore = rssMiB();
      await induceGc();
      const extBaseline = process.memoryUsage().external;

      // 洪泛：40 帧 × 1MiB（40MiB 字节上 wire；结构界 = 16 帧，第 17 帧即拒）。
      await rawWriteFrames(client, 40, 1024 * 1024, () => clientClosed);
      await waitUntil('hub 侧关闭（条数界）', () => meta.hub !== undefined, 15_000);
      // ★ 行为界（D3 主断言一）：第 17 帧触发条数界 close(1008)；零协议连接分配；
      //   第 18 帧起零驻留（authRejected 幂等早退——framesParsed 停在 17 附近）。
      expect(meta.hub).toEqual({ code: 1008, reason: 'upgrade-frame-limit' });
      expect(hub.connections.length).toBe(0);
      const framesParsed = hubTransport?.framesReceived ?? 0;
      expect(framesParsed).toBeGreaterThanOrEqual(17);
      expect(framesParsed).toBeLessThanOrEqual(20); // 拒绝后到达的帧不再进入任何缓冲

      // 客户端销毁：丢弃其未写完的 socket 发送队列（客户端侧噪声排除）。
      client.destroy();
      await new Promise<void>((resolve) => setTimeout(resolve, 300));
      await induceGc();
      await induceGc();
      const extAfterClose = process.memoryUsage().external;

      // 迟归验证器放行 → accept 收口 undefined（迟归不复活）。
      releaseVerifier();
      await new Promise<void>((resolve) => setTimeout(resolve, 200));

      // [SA7-DIAG] D3-① 洪泛驻留观测（记录入报告）
      const extDelta = (extAfterClose - extBaseline) / 1048576;
      console.log(
        `[SA7-DIAG] D3-① flood40MiB framesParsed=${String(framesParsed)} extDeltaAfterClose=${extDelta.toFixed(1)}MiB rssDelta=${(rssMiB() - rssBefore).toFixed(1)}MiB`,
      );
      // ★ 洪泛驻留界（D3 主断言）：40MiB 上 wire，活外部内存增量 ≤ 24MiB（结构界
      //   16 帧 × 1MiB = 16MiB + 余量；第 18 帧起零驻留——若被缓冲将 ≥ 40MiB）。
      //   注：ext 为 GC 后活对象计数（免 RSS 的 glibc arena 滞留噪声）；测试持有的
      //   transport 引用使被拒连接的早到缓冲驻留至 transport 丢弃（见报告观察项）。
      expect(extDelta).toBeLessThanOrEqual(24);
      expect(hub.connections.length).toBe(0); // 迟归不复活
    },
  );

  it(
    'D3-②封顶+回收：认证等待 helloTimeoutMs(2s) 到点 close(1008/upgrade-timeout)；16×1MiB 早到帧活外部内存驻留有界（8–40MiB ≪ 128MiB 结构界）、迟归验证器不复活、放行后驻留释放过半',
    { timeout: 120_000 },
    async () => {
      const hubNode = makeNode('hub');
      const meta: CloseMeta = { hub: undefined, peer: undefined };
      let hubTransport: ProbeTransport | undefined;
      let releaseVerifier!: () => void;
      const gate = new Promise<void>((resolve) => {
        releaseVerifier = resolve;
      });

      const hub = createHubReplication({
        instanceId: HUB_INSTANCE,
        registry: hubNode.registry,
        authorize: async () => ({
          ok: true as const,
          localOwner: HUB_OWNER,
          permissions: { read: true, submit: true },
        }),
        timer: realTimer,
        // 时间面 seam：认证等待封顶取 2s（limits 零覆写——字节界不受影响）。
        timeouts: { helloTimeoutMs: 2_000 },
        verifyToken: () => gate.then(() => ({ ok: true, instanceId: PEER_INSTANCE })),
      });
      liveHubs.push(hub);

      const server = net.createServer((socket) => {
        hubTransport = new ProbeTransport(socket, 'hub', meta);
        void hub.accept(hubTransport, { token: TEST_TOKEN });
      });
      liveServers.push(server);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = (server.address() as net.AddressInfo).port;

      const client = net.connect(port, '127.0.0.1');
      let clientClosed = false;
      client.on('close', () => {
        clientClosed = true;
      });
      await new Promise<void>((resolve) => client.once('connect', resolve));

      // 界内灌帧：16 帧 × 1MiB（条数/单帧均不触界 → 驻留 = 早到缓冲持有）。
      const rssBefore = rssMiB();
      await induceGc();
      const extBaseline = process.memoryUsage().external;
      await rawWriteFrames(client, 16, 1024 * 1024, () => clientClosed);
      await waitUntil('16 帧全部到达 hub', () => (hubTransport?.framesReceived ?? 0) >= 16, 15_000);
      // 等内核排空 + 让早到缓冲持有进入稳态（帧已在 earlyFrames）。
      await new Promise<void>((resolve) => setTimeout(resolve, 300));
      const rawPeakGrowth = rssMiB() - rssBefore; // 原始峰值（含接收路径瞬态——仅记录）
      // GC 后稳态驻留：瞬态收集、earlyFrames 仍被强引用（挂起的 accept 闭包持有）——
      // 此读数 = 结构界（16 帧 × 1MiB 载荷）的真实驻留证明（external 计活对象外部
      // 内存，免 RSS 的 glibc arena 滞留噪声；V8 external 记账需两轮 GC 落账）。
      await induceGc();
      await induceGc();
      const extHeldDelta = (process.memoryUsage().external - extBaseline) / 1048576;
      const steadyGrowth = rssMiB() - rssBefore;
      // ★ 驻留有界且真实（D3 主断言一）：活外部内存增量 ∈ [8, 40]MiB（16MiB 载荷被
      //   有界缓冲持有而非静默丢弃；上限远低于 16×maxFrameBytes 结构界 128MiB）。
      expect(extHeldDelta).toBeGreaterThanOrEqual(8);
      expect(extHeldDelta).toBeLessThanOrEqual(40);

      // 认证等待封顶：helloTimeoutMs 到点 → close(1008, upgrade-timeout)，零分配。
      await waitUntil('认证超时关闭', () => meta.hub !== undefined, 15_000);
      expect(meta.hub).toEqual({ code: 1008, reason: 'upgrade-timeout' });
      expect(hub.connections.length).toBe(0);

      // 迟归验证器不复活：放行后 accept 仍收口 undefined（超时在先）。
      releaseVerifier();
      await new Promise<void>((resolve) => setTimeout(resolve, 300));
      expect(hub.connections.length).toBe(0);

      const gcMode = await induceGc();
      await induceGc();
      const extReleasedDelta = (process.memoryUsage().external - extBaseline) / 1048576;
      const rssFinal = rssMiB();
      // [SA7-DIAG] D3-② 封顶回收观测（记录入报告）
      console.log(
        `[SA7-DIAG] D3-② cap16MiB extHeldDelta=${extHeldDelta.toFixed(1)}MiB extReleasedDelta=${extReleasedDelta.toFixed(1)}MiB rssRawPeak=${rawPeakGrowth.toFixed(1)}MiB rssSteady=${steadyGrowth.toFixed(1)}MiB rssFinal=${(rssFinal - rssBefore).toFixed(1)}MiB gc=${gcMode}`,
      );
      // ★ 回收（D3 主断言二）：迟归放行 + GC 后，被持有的早到缓冲真实释放——活外部
      //   内存回落至持有态的 50% 以下（无泄漏则≈基线；泄漏则不回落）。
      expect(extReleasedDelta).toBeLessThanOrEqual(extHeldDelta * 0.5);
      client.destroy();
    },
  );

  it(
    'D3-③单帧界：首帧 > maxFrameBytes(8MiB) → close(1009)，零协议连接分配、零协议帧',
    { timeout: 60_000 },
    async () => {
      const hubNode = makeNode('hub');
      const meta: CloseMeta = { hub: undefined, peer: undefined };
      const hubSent: DecodedMessage[] = [];
      let releaseVerifier!: () => void;
      const gate = new Promise<void>((resolve) => {
        releaseVerifier = resolve;
      });

      const hub = createHubReplication({
        instanceId: HUB_INSTANCE,
        registry: hubNode.registry,
        authorize: async () => ({
          ok: true as const,
          localOwner: HUB_OWNER,
          permissions: { read: true, submit: true },
        }),
        timer: realTimer,
        verifyToken: () => gate.then(() => ({ ok: true, instanceId: PEER_INSTANCE })),
      });
      liveHubs.push(hub);

      let hubTransport: ProbeTransport | undefined;
      const server = net.createServer((socket) => {
        hubTransport = new ProbeTransport(socket, 'hub', meta, {
          onSend: (bytes) => hubSent.push(decodeMessage(bytes)),
        });
        void hub.accept(hubTransport, { token: TEST_TOKEN });
      });
      liveServers.push(server);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = (server.address() as net.AddressInfo).port;

      const client = net.connect(port, '127.0.0.1');
      let clientClosed = false;
      client.on('close', () => {
        clientClosed = true;
      });
      await new Promise<void>((resolve) => client.once('connect', resolve));

      // 单帧超界：maxFrameBytes + 1 字节（真实 TCP 分段重组后的完整帧）。
      await rawWriteFrames(client, 1, CONTRACT_LIMITS.maxFrameBytes + 1, () => clientClosed);
      await waitUntil('hub 侧关闭（单帧界）', () => meta.hub !== undefined, 15_000);
      expect(meta.hub).toEqual({ code: 1009, reason: 'upgrade-frame-limit' });
      expect(hub.connections.length).toBe(0);
      expect(hubSent).toHaveLength(0); // 零协议帧（拒绝先于任何 FSM 分配）
      releaseVerifier();
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      expect(hub.connections.length).toBe(0);
      client.destroy();
    },
  );
});
