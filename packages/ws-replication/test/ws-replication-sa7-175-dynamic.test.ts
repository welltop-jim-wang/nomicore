/**
 * SA7 动态验证补充测试 —— issue #175（主动 reauthentication 生命周期）。
 *
 * 逐条锚定 SA4 静态审核报告「动态审核重点」六项（`task_active-reauthentication-lifecycle_sa4_review.md`
 * L172-179），全部为 SA6 红灯套件（6 IT）之外的补充动态面：
 *
 *   D1 —— 真实 TCP loopback 链路上的 Hub 主动 reauth 事件序（SA2 红线思路 2）：
 *         requestReauth → peer【原始 socket】先收 frame:GOAWAY(REAUTH_REQUIRED, drain>0)
 *         → drain 窗内 socket 保持开放 → 之后 socket-close（TCP 半关闭次序，r1-transport-auth
 *         D4 同款基建）；hub 侧 close = (1001, 'hub-reauth') 静态 reason 零 token；
 *         全 wire 原始字节（双向）零 token 序列；收口后 blocked 保持、零自动重拨。
 *   D2 —— requestReauth ↔ hub.accept 同 tick 竞态（SA2 攻击点 3）：背靠背调用时第一次
 *         reauth 的拷贝迭代错过尚未注册的新连接（契约无害）→ 第二次 requestReauth 覆盖
 *         新连接（恰再 1 GOAWAY）；全程零 unhandled rejection。
 *   D3 —— SHUTTING_DEADLINE 武装后半段（SA2 红线思路 4；G2 只覆盖 fire 前）：注入
 *         GOAWAY(SERVER_SHUTTING_DOWN, drain=60) + advanceBy(60) → wire 以
 *         close(1001, 'blocked-deadline') 收口且 state 仍 blocked（不 backoff、不重拨）。
 *   D4 —— drain=0 × REAUTH_REQUIRED（SA2 红线思路 5；D5-B1 冻结语义扩展锚）：注入
 *         drainTimeoutMs:0 → scheduler.pending() 计面不增（零新 timer）、wire 冻结、
 *         blocked 保持。
 *   D5 —— receiver deadline ↔ rebuild 先后序镜像锚（SA2 红线思路 1）：drain=60 注入后
 *         advanceMs(60 + 60_000) 无通知 → 旧 wire 以 1001('blocked-deadline') 自行收口
 *         且仍 blocked——deadline 先于（且独立于）任何 rebuild 编排。
 *   D6 —— blocked 期 liveness backstop（SA2 3b）：巨值 drain（300s）+ 无通知 + pong
 *         失联 → ping/pong 活性路径 close(1001, 'pong-timeout') 收传输（协议 §15.1
 *         L524），wire 生命周期有界；onTemporaryFailure 的 blocked 守卫 → 零重拨。
 *
 * 纪律：D2-D6 = fake-duplex + fake scheduler（零 real sleep）；D1 = 真实 TCP loopback
 * 集成抽样（真实 timer + 有界 real wait，与 sa7-r1-transport-auth 同款测试类）。
 * 真实 yjs/Registry/Runtime 双实例；零源码 grep 断言；零 mock 被测对象（liveness 面
 * ping/onPong 为 transport 生产可选缝，D6 由测试侧 transport 适配器提供——与生产
 * WS transport 同形）。
 */
import * as net from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import { createHubReplication, createPeerReplication } from '@nomicore/ws-replication';
import type { DuplexTransport, HubReplication, PeerReplication, ReplicationTimer } from '@nomicore/ws-replication';
import { decodeMessage, encodeMessage, type DecodedMessage, type ReplicationMessage } from '@nomicore/replication-protocol';
import { boot, collectUnhandledRejections, DEFAULT_PEER_VERIFIER, makeAuthorizer, TEST_TOKEN } from './driver.js';
import {
  HUB_INSTANCE,
  HUB_OWNER,
  PEER_INSTANCE,
  PEER_OWNER,
  makeDeferPump,
  makeHubNamespace,
  makeNode,
  makeWire,
  okLease,
  registerDeferPump,
  schemaReady,
  settle,
  settleUntil,
  type ReplicaNode,
  type Wire,
} from './harness.js';

// ─────────────────────────── 观测辅助（D2-D6，fake wire 面） ───────────────────────────

/** 该 wire 上 hub→peer 方向的 GOAWAY 消息（按到达序）。 */
function hubGoaways(wire: Wire): Array<{ reasonCode: string; drainTimeoutMs: number; retryAfterMs?: number }> {
  const out: Array<{ reasonCode: string; drainTimeoutMs: number; retryAfterMs?: number }> = [];
  for (const bytes of wire.hubToPeer) {
    const message = decodeMessage(bytes).message;
    if (message.kind === 'GOAWAY') out.push(message as { reasonCode: string; drainTimeoutMs: number });
  }
  return out;
}

/** 字节序列包含性（token 泄漏扫描——AC7）。 */
function bytesContain(haystack: readonly Uint8Array[], needle: string): boolean {
  const needleBytes = [...Buffer.from(needle, 'utf8')];
  const contains = (bytes: Uint8Array): boolean => {
    outer: for (let i = 0; i + needleBytes.length <= bytes.length; i += 1) {
      for (let j = 0; j < needleBytes.length; j += 1) {
        if (bytes[i + j] !== needleBytes[j]) continue outer;
      }
      return true;
    }
    return false;
  };
  return haystack.some(contains);
}

/** 手工注入一帧到 peer（沿 hub→peer 方向；序列 = 接收端当前期望——driver.nextHubSeq 同款纪律）。 */
function injectHubFrame(wire: Wire, message: ReplicationMessage): void {
  let max = 0;
  for (const bytes of wire.hubToPeer) max = Math.max(max, decodeMessage(bytes).header.sequence);
  wire.hubEnd.send(encodeMessage(message, { sequence: max + 1 }));
}

// ─────────────────────────── D6：liveness 面 transport 适配器（生产 WS ping/pong 同形） ───────────────────────────

interface PongControl {
  /** true = 对端正常回 pong；false = pong 失联（模拟 hub 侧死亡/pong 丢失）。 */
  autoPong: boolean;
  pingCount: number;
}

/** 在 fake wire 的 peer 端外包裹 WS 级 ping/onPong 可选面（liveness 武装条件——生产 0 seam）。 */
function wrapLiveness(inner: DuplexTransport, ctl: PongControl): DuplexTransport {
  const pongListeners: Array<(payload?: Uint8Array) => void> = [];
  return {
    send: (bytes) => inner.send(bytes),
    close: (code?: number, reason?: string) => inner.close(code, reason),
    get closed() {
      return inner.closed;
    },
    onMessage: (listener) => inner.onMessage(listener),
    onClose: (listener) => inner.onClose(listener),
    ping: (payload?: Uint8Array) => {
      ctl.pingCount += 1;
      if (ctl.autoPong) {
        for (const listener of [...pongListeners]) listener(payload?.slice());
      }
    },
    onPong: (listener) => {
      pongListeners.push(listener);
      return () => {
        const index = pongListeners.indexOf(listener);
        if (index >= 0) pongListeners.splice(index, 1);
      };
    },
  };
}

// ─────────────────────────── D1：真实 TCP loopback 基建（r1-transport-auth 同款） ───────────────────────────

/** 有界 real wait 轮询（真实链路集成抽样专用）。 */
async function waitUntil(what: string, predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) return;
    if (Date.now() > deadline) throw new Error(`waitUntil 超时（${timeoutMs}ms）：${what}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

/** 真实 timer（D1 为真实链路抽样；协议时间面走真实时钟）。 */
const realTimer: ReplicationTimer = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs) as unknown,
  clearTimeout: (handle) => clearTimeout(handle as unknown as number),
};

interface RealCloseMeta {
  hub: { code: number; reason: string } | undefined;
  peer: { code: number; reason: string } | undefined;
}

/**
 * 真实 TCP transport 适配器（4B 长度前缀成帧）：close 记入 meta（按侧）；onFrame 在
 * 成帧解析点触发（原始字节 token 扫描锚）。
 */
class RealProbeTransport implements DuplexTransport {
  private readonly messageListeners: Array<(bytes: Uint8Array) => void> = [];
  private readonly closeListeners: Array<(info: Readonly<{ code: number; reason: string }>) => void> = [];
  private buffer: Buffer = Buffer.alloc(0);
  private closedFlag = false;

  constructor(
    readonly socket: net.Socket,
    private readonly side: 'hub' | 'peer',
    private readonly meta: RealCloseMeta,
    private readonly onFrame?: (bytes: Uint8Array) => void,
  ) {
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

  send(bytes: Uint8Array): void {
    if (this.closedFlag) return;
    const header = Buffer.alloc(4);
    header.writeUInt32BE(bytes.byteLength, 0);
    this.socket.write(Buffer.concat([header, Buffer.from(bytes)]));
  }

  close(code = 1000, reason = ''): void {
    if (this.closedFlag) return;
    this.closedFlag = true;
    const info = { code, reason };
    if (this.side === 'hub') this.meta.hub = info;
    else this.meta.peer = info;
    this.socket.end();
  }

  get closed(): boolean {
    return this.closedFlag;
  }

  onMessage(listener: (bytes: Uint8Array) => void): () => void {
    this.messageListeners.push(listener);
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
      this.onFrame?.(copy);
      for (const listener of this.messageListeners) listener(copy);
    }
  }
}

const D1_SCHEMA = Object.freeze({
  lang: 'vfsl',
  version: 1,
  id: 'sa7-175-reauth-real',
  text: 'type ROOT = { n: number; };\n',
});

async function makeRealNamespace(hubNode: ReplicaNode): Promise<string> {
  const lease = okLease(
    await hubNode.registry.create({
      owner: HUB_OWNER,
      schema: { ...D1_SCHEMA, id: 'sa7-175-real' },
      root: { n: 1 },
    }),
  );
  await schemaReady(lease);
  const enabled = await lease.enableReplication();
  if (!enabled.ok) throw new Error(`enableReplication 失败：${JSON.stringify(enabled)}`);
  return lease.namespaceId;
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

// ═══════════════════════════════════════ 动态验证 ═══════════════════════════════════════

describe('issue #175 SA7：主动 reauth 生命周期动态验证（SA4 六项动态重点）', () => {
  it(
    'D1（SA4 重点 1）：真实 TCP——requestReauth 后 peer 原始 socket 先收 GOAWAY(REAUTH_REQUIRED, drain>0) 再 socket-close；hub close=(1001,"hub-reauth")；全 wire 字节零 token；收口后 blocked 保持零重拨',
    { timeout: 90_000 },
    async () => {
      const probe = collectUnhandledRejections();
      try {
        const hubNode = makeNode('hub');
        const peerNode = makeNode('peer');
        const nsId = await makeRealNamespace(hubNode);
        const meta: RealCloseMeta = { hub: undefined, peer: undefined };
        const hubRawChunks: Buffer[] = [];
        let peerTransport: RealProbeTransport | undefined;
        let dialCount = 0;
        /** drain 预算（GOAWAY 载体 = closeTimeoutMs，设计 §4.3）。 */
        const DRAIN_MS = 800;

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
          timeouts: { closeTimeoutMs: DRAIN_MS },
        });
        liveHubs.push(hub);

        const server = net.createServer((socket) => {
          const transport = new RealProbeTransport(socket, 'hub', meta, (bytes) => hubRawChunks.push(Buffer.from(bytes)));
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
            dialCount += 1;
            peerTransport = new RealProbeTransport(net.connect(port, '127.0.0.1'), 'peer', meta);
            return peerTransport;
          },
          timer: realTimer,
          targets: [{ namespaceId: nsId, localOwner: PEER_OWNER }],
        });
        livePeers.push(peer);
        peer.start();
        await waitUntil('连接 ready', () => peer.getConnectionState() === 'ready', 15_000);
        await waitUntil('namespace live', () => peer.getNamespaceState(nsId) === 'live', 15_000);
        expect(peerTransport).toBeDefined();
        expect(dialCount).toBe(1);

        // peer 侧【原始 socket】事件序记录器（独立于适配器——纯 wire 观测）+ 原始字节留档。
        const wireEvents: string[] = [];
        const wireFrames: DecodedMessage[] = [];
        const peerRawChunks: Buffer[] = [];
        let recorderBuf = Buffer.alloc(0);
        peerTransport!.socket.on('data', (chunk: Buffer) => {
          peerRawChunks.push(chunk);
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

        // ★ 公共 seam 直调（AC1）：认证 Adapter 主动 reauth。
        await hub.requestReauth(PEER_INSTANCE);
        await waitUntil('peer blocked', () => peer.getConnectionState() === 'blocked', 15_000);

        // ★ drain 窗开放（D1 主断言前半）：GOAWAY 已达、socket 尚未关闭（区别于 hub.close 零窗口）。
        expect(wireEvents.filter((e) => e === 'frame:GOAWAY').length).toBe(1);
        expect(wireEvents.includes('socket-close')).toBe(false);

        // ★ TCP 半关闭次序（D1 主断言后半）：deadline 后 socket-close 到达，严格晚于 GOAWAY。
        await waitUntil('peer 原始 socket 关闭', () => wireEvents.includes('socket-close'), 15_000);
        const goawayIndex = wireEvents.findIndex((e) => e === 'frame:GOAWAY');
        const closeIndex = wireEvents.indexOf('socket-close');
        expect(goawayIndex).toBeGreaterThanOrEqual(0);
        expect(closeIndex).toBeGreaterThan(goawayIndex);

        const goaway = wireFrames.find((f) => f.message.kind === 'GOAWAY');
        expect(goaway?.message.kind === 'GOAWAY' ? goaway.message.reasonCode : undefined).toBe('REAUTH_REQUIRED');
        expect(goaway?.message.kind === 'GOAWAY' ? goaway.message.drainTimeoutMs : undefined).toBe(DRAIN_MS);

        // ★ 双侧 close reason = 静态安全码（零 token）：hub 主动收口 (1001,'hub-reauth')；
        // peer 观测到的远程 close 即该 info（socket-close 事件携带）。
        expect(meta.hub).toEqual({ code: 1001, reason: 'hub-reauth' });
        expect(meta.hub?.reason.includes(TEST_TOKEN)).toBe(false);

        // ★ 全 wire 原始字节（双向 socket data，含帧头）零 token 序列（AC7）。
        expect(bytesContain(peerRawChunks, TEST_TOKEN)).toBe(false);
        expect(bytesContain(hubRawChunks, TEST_TOKEN)).toBe(false);
        // 优雅收口：无协议 ERROR 帧。
        expect(wireFrames.some((f) => f.message.kind === 'ERROR')).toBe(false);

        // ★ 收口后 blocked 保持 + 零自动重拨（blocked 态 onClose 早退——AC5 前置）。
        await new Promise<void>((resolve) => setTimeout(resolve, 1_200));
        expect(peer.getConnectionState()).toBe('blocked');
        expect(dialCount).toBe(1);
      } finally {
        probe.dispose();
      }
      expect(probe.events).toEqual([]);
    },
  );

  it('D2（SA4 重点 2）：requestReauth ↔ hub.accept 同 tick 背靠背——第一次迭代错过新连接（无害），第二次 requestReauth 覆盖新连接（恰再 1 GOAWAY）；零 unhandled rejection', async () => {
    const probe = collectUnhandledRejections();
    try {
      const run = await boot({ timeouts: { closeTimeoutMs: 60 } });
      expect(run.connectionState()).toBe('ready');

      // 真实 peer 的 HELLO 原始字节（同身份新连接的握手素材——protocol 级重放）。
      const helloBytes = run.wire.peerToHub.find(
        (bytes) => decodeMessage(bytes).message.kind === 'HELLO',
      );
      expect(helloBytes).toBeDefined();

      // ★ 同 tick 背靠背：requestReauth 先发起（同步拷贝迭代），accept 紧随（注册在
      // verifyToken 微任务之后——迭代注定错过新连接 = SA2 攻击点 3 的竞态形态）。
      const firstReauth = run.hub.requestReauth(PEER_INSTANCE);
      const wire2 = makeWire();
      // wire2 的 peer 端为原始 socket 形态（无 FSM）——注册测试侧 close 观察者记录收口 info。
      const peer2ObservedClose: Array<Readonly<{ code: number; reason: string }>> = [];
      wire2.peerEnd.onClose((info) => peer2ObservedClose.push(info));
      const acceptTail = run.hub.accept(wire2.hubEnd, { token: TEST_TOKEN });
      await firstReauth;
      await acceptTail;
      await settle();

      // 第一次 reauth 只覆盖既有连接 C1（恰 1 GOAWAY）；C2 尚未握手——错过为契约无害面。
      expect(hubGoaways(run.wire).length).toBe(1);
      expect(hubGoaways(wire2).length).toBe(0);
      expect(run.connectionState()).toBe('blocked');

      // 新连接完成握手（HELLO 重放 → HELLO_ACK → hub 侧 ready）。
      wire2.peerEnd.send(helloBytes!);
      await settleUntil(() => run.hub.connections.length === 2, 'hub 侧两条连接并存');

      // ★ 第二次 requestReauth 覆盖新连接：恰再 1 GOAWAY（落在 wire2）；wire1 幂等不重发。
      await run.hub.requestReauth(PEER_INSTANCE);
      await settle();
      expect(hubGoaways(wire2).length).toBe(1);
      expect(hubGoaways(run.wire).length).toBe(1);
      const goaway2 = hubGoaways(wire2)[0]!;
      expect(goaway2.reasonCode).toBe('REAUTH_REQUIRED');
      expect(goaway2.drainTimeoutMs).toBeGreaterThan(0);

      // ★ 覆盖完整性：新连接同样按 deadline 1001 收口（'hub-reauth' 静态 reason）。
      await run.hubNode.scheduler.advanceBy(goaway2.drainTimeoutMs);
      await settle();
      expect(wire2.hubSideClosed).toBe(true);
      expect(peer2ObservedClose).toEqual([{ code: 1001, reason: 'hub-reauth' }]);
      await settleUntil(() => run.hub.connections.length === 0, '两条连接均已收口');

      // peer 侧全程 blocked（无通知不得恢复）；零重拨。
      expect(run.connectionState()).toBe('blocked');
      expect(run.dialCount).toBe(1);
    } finally {
      probe.dispose();
    }
    expect(probe.events).toEqual([]);
  });

  it('D3（SA4 重点 3）：SHUTTING_DEADLINE 武装后半段——GOAWAY(SERVER_SHUTTING_DOWN, 60) + advanceBy(60) → wire 1001("blocked-deadline") 收口且 state 仍 blocked（不 backoff、不重拨）', async () => {
    const probe = collectUnhandledRejections();
    try {
      const run = await boot({});
      injectHubFrame(run.wire, { kind: 'GOAWAY', reasonCode: 'SERVER_SHUTTING_DOWN', drainTimeoutMs: 60 });
      await settle();
      expect(run.connectionState()).toBe('blocked');
      // 前半段（G2 已覆盖面的即时复核）：deadline fire 前 wire 开放。
      expect(run.wire.peerSideClosed).toBe(false);
      expect(run.wire.hubSideClosed).toBe(false);

      // ★ 后半段：deadline fire → peer 侧主动 close(1001, 'blocked-deadline')。
      await run.peerNode.scheduler.advanceBy(60);
      await settle();
      expect(run.wire.peerSideClosed).toBe(true);
      expect(run.wire.hubSideCloseInfo).toEqual({ code: 1001, reason: 'blocked-deadline' });

      // ★ state 仍 blocked（非 backoff）；时钟大步推进零重拨。
      expect(run.connectionState()).toBe('blocked');
      await run.peerNode.scheduler.advanceBy(60_000);
      await settle();
      expect(run.connectionState()).toBe('blocked');
      expect(run.dialCount).toBe(1);
      expect(run.wires.length).toBe(1);
    } finally {
      probe.dispose();
    }
    expect(probe.events).toEqual([]);
  });

  it('D4（SA4 重点 4）：drain=0 × REAUTH_REQUIRED——pending() 计面不增（零新 timer，D5-B1 扩展锚）、wire 冻结、blocked 保持', async () => {
    const probe = collectUnhandledRejections();
    try {
      const run = await boot({});
      const pendingBefore = run.peerNode.scheduler.pending();

      // ★ drain=0 =「无 drain 预算信息」→ 不武装任何 deadline（D5-B1 冻结语义自 SHUTTING_DOWN 扩展至 REAUTH）。
      injectHubFrame(run.wire, { kind: 'GOAWAY', reasonCode: 'REAUTH_REQUIRED', drainTimeoutMs: 0 });
      await settle();
      expect(run.connectionState()).toBe('blocked');
      expect(run.peerNode.scheduler.pending()).toBeLessThanOrEqual(pendingBefore); // 零新 timer

      // ★ wire 冻结：双侧开放（无 deadline 自行收口）。
      expect(run.wire.peerSideClosed).toBe(false);
      expect(run.wire.hubSideClosed).toBe(false);

      // 时钟大步推进：无 deadline fire、零重拨、blocked 保持。
      await run.peerNode.scheduler.advanceBy(60_000);
      await settle();
      expect(run.wire.peerSideClosed).toBe(false);
      expect(run.wire.hubSideClosed).toBe(false);
      expect(run.connectionState()).toBe('blocked');
      expect(run.dialCount).toBe(1);
    } finally {
      probe.dispose();
    }
    expect(probe.events).toEqual([]);
  });

  it('D5（SA4 重点 5）：receiver deadline ↔ rebuild 先后序镜像锚——advanceMs(drain+60_000) 无通知 → 旧 wire 1001("blocked-deadline") 自行收口且仍 blocked', async () => {
    const probe = collectUnhandledRejections();
    try {
      const run = await boot({});
      const DRAIN = 60;
      injectHubFrame(run.wire, { kind: 'GOAWAY', reasonCode: 'REAUTH_REQUIRED', drainTimeoutMs: DRAIN });
      await settle();
      expect(run.connectionState()).toBe('blocked');

      // ★ 一次大步推进跨过 deadline 再远超 60s：deadline 必须已自行 fire（独立于 rebuild——
      //   防未来实现把 deadline 挪到 rebuild 之后：无通知则永无 rebuild，wire 将无限开放）。
      await run.peerNode.scheduler.advanceBy(DRAIN + 60_000);
      await settle();
      expect(run.wire.peerSideClosed).toBe(true);
      expect(run.wire.hubSideCloseInfo).toEqual({ code: 1001, reason: 'blocked-deadline' });
      expect(run.connectionState()).toBe('blocked');
      expect(run.dialCount).toBe(1);
      expect(run.wires.length).toBe(1); // 无 rebuild 新 wire
    } finally {
      probe.dispose();
    }
    expect(probe.events).toEqual([]);
  });

  it('D6（SA4 重点 6）：blocked 期 liveness backstop——巨值 drain(300s) + 无通知 + pong 失联 → close(1001,"pong-timeout") 收传输；blocked 守卫零重拨', async () => {
    const probe = collectUnhandledRejections();
    try {
      // 手工组装（boot 的 dial 闭包不可注入 liveness 面——transport 适配器为生产可选缝）。
      const hubNode = makeNode('hub');
      const peerNode = makeNode('peer');
      const authorizer = makeAuthorizer();
      const hubFixture = await makeHubNamespace(hubNode, { owner: HUB_OWNER });
      const nsId = hubFixture.namespaceId;
      const hub = createHubReplication({
        instanceId: HUB_INSTANCE,
        registry: hubNode.registry,
        authorize: authorizer.authorize,
        timer: hubNode.scheduler,
        verifyToken: DEFAULT_PEER_VERIFIER,
      });
      const wires: Wire[] = [];
      let dialCount = 0;
      const ctl: PongControl = { autoPong: true, pingCount: 0 };
      const pump = makeDeferPump();
      registerDeferPump(pump);
      const peer = createPeerReplication({
        instanceId: PEER_INSTANCE,
        hubInstanceId: HUB_INSTANCE,
        registry: peerNode.registry,
        dial: () => {
          dialCount += 1;
          const wire = makeWire();
          wires.push(wire);
          void hub.accept(wire.hubEnd, { token: TEST_TOKEN });
          return wrapLiveness(wire.peerEnd, ctl);
        },
        timer: peerNode.scheduler,
        targets: [{ namespaceId: nsId, localOwner: PEER_OWNER }],
        deferTask: pump.defer,
        timeouts: { pingIntervalMs: 30_000, pongTimeoutMs: 10_000 },
      });
      peer.start();
      await settleUntil(() => peer.getConnectionState() === 'ready', '连接 ready');
      await settleUntil(() => peer.getNamespaceState(nsId) === 'live', 'namespace live');

      // 前置：liveness 已武装且健康（ready 期 ping 往返正常——证明活性面真实生效）。
      await peerNode.scheduler.advanceBy(30_000);
      await settle();
      expect(ctl.pingCount).toBe(1);
      expect(peer.getConnectionState()).toBe('ready');

      // pong 失联（hub 侧死亡模拟）+ 巨值 drain 注入 → blocked。
      ctl.autoPong = false;
      injectHubFrame(wires[0]!, { kind: 'GOAWAY', reasonCode: 'REAUTH_REQUIRED', drainTimeoutMs: 300_000 });
      await settle();
      expect(peer.getConnectionState()).toBe('blocked');

      // ★ blocked 期 liveness 值守：下一 ping（t=60s）无 pong → pong 超时（t=70s）→
      //   transport.close(1001, 'pong-timeout')（§15.1 L524 活性失联收口）。
      await peerNode.scheduler.advanceBy(30_000);
      expect(ctl.pingCount).toBe(2);
      await peerNode.scheduler.advanceBy(10_000);
      await settle();
      expect(wires[0]!.peerSideClosed).toBe(true);
      expect(wires[0]!.hubSideCloseInfo).toEqual({ code: 1001, reason: 'pong-timeout' });

      // ★ onTemporaryFailure 的 blocked 守卫：活性收口不触发重拨；巨值 drain 的 blocked
      //   deadline 至多 stale fire 一次且 transport 已关 → 零副作用。
      expect(peer.getConnectionState()).toBe('blocked');
      await peerNode.scheduler.advanceBy(300_000);
      await settle();
      expect(peer.getConnectionState()).toBe('blocked');
      expect(dialCount).toBe(1);
      expect(wires.length).toBe(1);
    } finally {
      probe.dispose();
    }
    expect(probe.events).toEqual([]);
  });
});
