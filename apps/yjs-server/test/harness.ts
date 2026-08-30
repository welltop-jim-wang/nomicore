/**
 * SA6 测试驱动器 —— issue #164 切片 9（apps/yjs-server 组合根 + 真实 WebSocket adapter）。
 *
 * 纪律（与 packages/ws-replication/test 同源）：
 * - 真实 Registry/Runtime/Persistence-stub + 真实 Y.Doc；零 mock 被测对象；
 * - 真实 TCP：本文件实现最小 RFC 6455 客户端（HTTP Upgrade + 帧编解码）——
 *   测试从「客户端」角观测组合根的可观察 wire 行为；
 * - 零源码 grep 断言：全部锚在 HTTP 状态 / WS 帧 / 关闭码 / Y.Doc 内容 / Registry 状态；
 * - 零 real sleep：全部等待用有界轮询（10ms 步进）。
 *
 * 冻结契约面（SA6，来自 issue #164 + ADR-0010 L175 + protocol §2/§6.1/§17/§18/§21）：
 * `apps/yjs-server/src/index.ts` 必须导出 createYjsHubServer / createWebSocketAdapter /
 * assertProductionTransportFaces（形状见 task 简报 §SA6 红灯契约）。
 */
import * as net from 'node:net';
import * as crypto from 'node:crypto';
import * as Y from 'yjs';
import {
  DocDuplicateError,
  type DocHandle,
  type DocHandleStatus,
  type DocPersistence,
  type PersistedIdentityProbeResult,
  type ReplicationIdentityRef,
  type User,
} from '@nomicore/persistence';
import {
  createNamespaceRegistryForTesting,
  createRegistryTestScheduler,
} from '@nomicore/namespace-registry/testing';
import type {
  NamespaceLease,
  NamespaceOwner,
  NamespaceRegistry,
  RegistryRandomBytes,
} from '@nomicore/namespace-registry';
import {
  decodeMessage,
  encodeMessage,
  type DecodedMessage,
  type ReplicationMessage,
} from '@nomicore/replication-protocol';

// ═══════════════════════════ 固定常量 ═══════════════════════════

export const HUB_INSTANCE = 'hub-omega';
export const PEER_INSTANCE = 'peer-alpha';
export const HUB_OWNER: NamespaceOwner = Object.freeze({ userId: 'hub-owner-9f38' });
export const TEST_TOKEN = 'tok-test-4f2b8a1c9d3e';
export const FIXED_MS = 1_700_000_987_654;
export const SCHEMA_ENVELOPE = Object.freeze({
  lang: 'vfsl',
  version: 1,
  id: 'issue164-slice9-hub',
  text: 'type ROOT = { n: number; ext?: number; };\n',
});
export const GOOD_ROOT = Object.freeze({ n: 42 });

/** 冻结 Upgrade 路径（apps/yjs-server 组合根：GET /replication）。 */
export const UPGRADE_PATH = '/replication';

/** 默认验证器：TEST_TOKEN → PEER_INSTANCE；其余拒绝。 */
export function makeVerifier(
  spy?: { calls: string[] },
): (token: string) => Promise<Readonly<{ ok: true; instanceId: string }> | Readonly<{ ok: false }>> {
  return (token: string) => {
    if (spy !== undefined) spy.calls.push(token);
    return Promise.resolve(
      token === TEST_TOKEN ? { ok: true, instanceId: PEER_INSTANCE } : { ok: false },
    );
  };
}

// ═══════════════════════════ Stub Persistence（可编程载体；行为锚不在它身上） ═══════════════════════════

interface StoredDoc {
  readonly owner: User;
  readonly docId: string;
  readonly doc: Y.Doc;
  status: DocHandleStatus;
  archived: boolean;
}

function keyOf(owner: Pick<User, 'userId'>, docId: string): string {
  return `${owner.userId}\u0000${docId}`;
}

function readDocIdentity(doc: Y.Doc): { replicationId: string; replicationEpoch: number } {
  const meta = doc.getMap('META');
  const replicationId = meta.get('replicationId');
  const replicationEpoch = meta.get('replicationEpoch');
  if (typeof replicationId !== 'string' || typeof replicationEpoch !== 'number') {
    throw new Error(
      `doc 必须携带合规复制身份，实际 ${String(replicationId)}/${String(replicationEpoch)}`,
    );
  }
  return { replicationId, replicationEpoch };
}

/** 最小 DocPersistence（与 packages/ws-replication/test/harness StubPersistence 同形）。 */
export class StubPersistence implements DocPersistence {
  private readonly docs = new Map<string, StoredDoc>();
  readonly saveEvents: Array<Readonly<{ docId: string; userId: string; seq: number }>> = [];
  private saveSeq = 0;

  seedDocument(owner: User, docId: string, doc: Y.Doc): void {
    this.docs.set(keyOf(owner, docId), { owner, docId, doc, status: 'ready', archived: false });
  }

  peek(owner: User, docId: string): Y.Doc | undefined {
    return this.docs.get(keyOf(owner, docId))?.doc;
  }

  private makeHandle(stored: StoredDoc): DocHandle {
    return {
      owner: stored.owner,
      docId: stored.docId,
      doc: stored.doc,
      getStatus: () => stored.status,
      release: async () => {
        if (stored.status === 'ready') stored.status = 'released';
      },
    };
  }

  async createDoc(owner: User, docId: string, doc: Y.Doc): Promise<DocHandle> {
    const key = keyOf(owner, docId);
    const existing = this.docs.get(key);
    if (existing !== undefined && !existing.archived) throw new DocDuplicateError();
    const stored: StoredDoc = { owner, docId, doc, status: 'ready', archived: false };
    this.docs.set(key, stored);
    return this.makeHandle(stored);
  }

  async loadDoc(owner: User, docId: string): Promise<DocHandle | null> {
    const stored = this.docs.get(keyOf(owner, docId));
    return stored === undefined || stored.archived ? null : this.makeHandle(stored);
  }

  async saveDoc(handle: DocHandle): Promise<void> {
    this.saveSeq += 1;
    this.saveEvents.push({ docId: handle.docId, userId: handle.owner.userId, seq: this.saveSeq });
  }

  async importDoc(owner: User, docId: string, doc: Y.Doc): Promise<DocHandle> {
    const key = keyOf(owner, docId);
    const existing = this.docs.get(key);
    if (existing !== undefined && !existing.archived) throw new DocDuplicateError();
    const stored: StoredDoc = { owner, docId, doc, status: 'ready', archived: false };
    this.docs.set(key, stored);
    return this.makeHandle(stored);
  }

  async archiveDoc(
    owner: User,
    docId: string,
    _expected: ReplicationIdentityRef,
  ): Promise<Readonly<{ ok: true }>> {
    const stored = this.docs.get(keyOf(owner, docId));
    if (stored !== undefined) stored.archived = true;
    return { ok: true };
  }

  async readPersistedReplicationIdentity(
    owner: User,
    docId: string,
  ): Promise<PersistedIdentityProbeResult> {
    const stored = this.docs.get(keyOf(owner, docId));
    if (stored === undefined || stored.archived) return { kind: 'missing' };
    const identity = readDocIdentity(stored.doc);
    return {
      kind: 'found',
      identity: {
        ok: true,
        value: {
          replicationId: identity.replicationId,
          replicationEpoch: identity.replicationEpoch,
        },
      },
    };
  }
}

/** 受控随机源（与 packages/ws-replication/test/harness makeCounterRandomBytes 同形）。 */
export function makeCounterRandomBytes(): RegistryRandomBytes {
  let counter = 0;
  return (length: number): Uint8Array => {
    if (length !== 16) {
      throw new Error(`受控随机源必须按 128-bit（16 字节）请求，实际请求 ${length} 字节`);
    }
    counter += 1;
    const hex = counter.toString(16).padStart(32, '0');
    const out = new Uint8Array(16);
    for (let i = 0; i < 16; i += 1) {
      out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  };
}

// ═══════════════════════════ Registry / namespace fixture ═══════════════════════════

export interface TestRegistryFixture {
  readonly persistence: StubPersistence;
  readonly scheduler: ReturnType<typeof createRegistryTestScheduler>;
  readonly registry: NamespaceRegistry;
}

/** 构造真实 Registry（testing seam；受控 clock/scheduler/randomBytes；role 显式 'hub'）。 */
export function makeTestRegistry(): TestRegistryFixture {
  const persistence = new StubPersistence();
  const scheduler = createRegistryTestScheduler();
  const registry = createNamespaceRegistryForTesting(persistence, {
    clock: { now: () => FIXED_MS },
    scheduler,
    idleTimeoutMs: 1_000_000,
    randomBytes: makeCounterRandomBytes(),
    role: 'hub',
  });
  return { persistence, scheduler, registry };
}

export interface HubNsFixture {
  readonly namespaceId: string;
  readonly lease: NamespaceLease;
  readonly identity: Readonly<{ replicationId: string; replicationEpoch: number }>;
}

function okLease(result: unknown): NamespaceLease {
  const r = result as { ok?: boolean; lease?: NamespaceLease };
  if (!r.ok || r.lease === undefined) {
    throw new Error(`fixture 期望 lease，实际 ${JSON.stringify(result)}`);
  }
  return r.lease;
}

/** Hub 侧：真实 create + enableReplication（identity 安装），并等待 schema ready。 */
export async function makeHubNamespace(registry: NamespaceRegistry): Promise<HubNsFixture> {
  const lease = okLease(
    await registry.create({ owner: HUB_OWNER, schema: SCHEMA_ENVELOPE, root: GOOD_ROOT }),
  );
  await waitUntil('schema ready', () => {
    const status = (lease.getStatus() as unknown as {
      readonly runtime: Readonly<{ schema: Readonly<{ state: string }> }> | null;
    }).runtime;
    return status?.schema.state === 'ready';
  });
  const enabled = await lease.enableReplication();
  if (!enabled.ok) throw new Error(`enableReplication 失败：${JSON.stringify(enabled)}`);
  const repl = (lease.getStatus() as unknown as {
    readonly runtime: Readonly<{
      replication: Readonly<{ state: string; replicationId?: string; replicationEpoch?: number }>;
    }>;
  }).runtime.replication;
  if (repl.state !== 'enabled') {
    throw new Error(`fixture 期望启用复制，实际 ${JSON.stringify(repl)}`);
  }
  return {
    namespaceId: lease.namespaceId,
    lease,
    identity: { replicationId: repl.replicationId ?? '', replicationEpoch: repl.replicationEpoch ?? 0 },
  };
}

// ═══════════════════════════ 原始 RFC 6455 客户端（最小，测试自有） ═══════════════════════════

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export interface RawWsOptions {
  readonly host?: string;
  readonly port: number;
  readonly path?: string;
  /** 附加请求头（如 Authorization: Bearer …）。 */
  readonly headers?: Readonly<Record<string, string>>;
  readonly handshakeTimeoutMs?: number;
}

export interface UpgradeOutcome {
  readonly status: number;
  readonly statusLine: string;
  readonly headers: Map<string, string>;
  /** status === 101 时存在。 */
  readonly ws: RawWsClient | undefined;
}

export class RawWsClient {
  private incoming = new Uint8Array(0);
  private messageListeners: Array<(bytes: Uint8Array) => void> = [];
  private pingListeners: Array<(data: Uint8Array) => void> = [];
  private pongListeners: Array<(data: Uint8Array) => void> = [];
  private closeListeners: Array<(info: Readonly<{ code: number; reason: string }>) => void> = [];
  private errorListeners: Array<(err: unknown) => void> = [];
  closed = false;

  constructor(private readonly socket: net.Socket) {
    socket.on('close', () => {
      if (this.closed) return;
      this.closed = true;
      for (const l of [...this.closeListeners]) l({ code: 1006, reason: '' });
    });
    socket.on('error', (err) => {
      for (const l of [...this.errorListeners]) l(err);
    });
    socket.on('data', (chunk) => this.feed(new Uint8Array(chunk)));
  }

  /** 握手后残余字节注入（Upgrade 响应与首帧可能同包）。 */
  feed(chunk: Uint8Array): void {
    this.incoming = concat(this.incoming, chunk);
    for (;;) {
      const frame = takeServerFrame(this.incoming);
      if (frame === undefined) return;
      this.incoming = frame.rest;
      switch (frame.opcode) {
        case 0x2:
          for (const l of [...this.messageListeners]) l(frame.payload);
          break;
        case 0x9:
          for (const l of [...this.pingListeners]) l(frame.payload);
          break;
        case 0xa:
          for (const l of [...this.pongListeners]) l(frame.payload);
          break;
        case 0x8: {
          const code =
            frame.payload.byteLength >= 2
              ? (frame.payload[0] << 8) | frame.payload[1]
              : 1005;
          const reason = Buffer.from(frame.payload.slice(2)).toString('utf8');
          this.closed = true;
          for (const l of [...this.closeListeners]) l({ code, reason });
          this.socket.end();
          return;
        }
        default:
          // 未知 opcode → 协议违约，直接断开（测试不应产生）。
          this.socket.destroy();
          this.closed = true;
          return;
      }
    }
  }

  sendBinary(bytes: Uint8Array): void {
    this.socket.write(Buffer.from(encodeClientFrame(0x2, bytes)));
  }

  sendPing(data: Uint8Array = new Uint8Array(0)): void {
    this.socket.write(Buffer.from(encodeClientFrame(0x9, data)));
  }

  sendPong(data: Uint8Array = new Uint8Array(0)): void {
    this.socket.write(Buffer.from(encodeClientFrame(0xa, data)));
  }

  sendClose(code: number, reason: string): void {
    const reasonBytes = new TextEncoder().encode(reason);
    const payload = new Uint8Array(2 + reasonBytes.byteLength);
    payload[0] = (code >> 8) & 0xff;
    payload[1] = code & 0xff;
    payload.set(reasonBytes, 2);
    this.socket.write(Buffer.from(encodeClientFrame(0x8, payload)));
  }

  onMessage(listener: (bytes: Uint8Array) => void): void {
    this.messageListeners.push(listener);
  }
  onPing(listener: (data: Uint8Array) => void): void {
    this.pingListeners.push(listener);
  }
  onPong(listener: (data: Uint8Array) => void): void {
    this.pongListeners.push(listener);
  }
  onClose(listener: (info: Readonly<{ code: number; reason: string }>) => void): void {
    this.closeListeners.push(listener);
  }
  onError(listener: (err: unknown) => void): void {
    this.errorListeners.push(listener);
  }

  destroy(): void {
    this.socket.destroy();
  }
}

/** HTTP Upgrade 握手：返回响应行/头（101 成功时附带 RawWsClient）。 */
export async function wsUpgrade(opts: RawWsOptions): Promise<UpgradeOutcome> {
  return new Promise<UpgradeOutcome>((resolve, reject) => {
    const socket = net.connect({ host: opts.host ?? '127.0.0.1', port: opts.port });
    const key = crypto.randomBytes(16).toString('base64');
    const headerLines = [
      `GET ${opts.path ?? UPGRADE_PATH} HTTP/1.1`,
      `Host: 127.0.0.1:${opts.port}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Key: ${key}`,
      'Sec-WebSocket-Version: 13',
    ];
    for (const [name, value] of Object.entries(opts.headers ?? {})) {
      headerLines.push(`${name}: ${value}`);
    }
    socket.write(headerLines.join('\r\n') + '\r\n\r\n');

    let buf = Buffer.alloc(0);
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        socket.destroy();
        reject(new Error(`wsUpgrade 握手超时（${opts.handshakeTimeoutMs ?? 5_000}ms）`));
      }
    }, opts.handshakeTimeoutMs ?? 5_000);
    const cleanup = (): void => clearTimeout(timer);

    socket.on('data', (chunk: Buffer) => {
      if (settled) return;
      buf = Buffer.concat([buf, chunk]);
      const idx = buf.indexOf('\r\n\r\n');
      if (idx < 0) {
        if (buf.byteLength > 64 * 1024) {
          settled = true;
          cleanup();
          socket.destroy();
          reject(new Error('wsUpgrade 响应头超长'));
        }
        return;
      }
      settled = true;
      cleanup();
      const head = buf.slice(0, idx).toString('latin1');
      const lines = head.split('\r\n');
      const statusLine = lines[0] ?? '';
      const status = Number.parseInt(statusLine.split(' ')[1] ?? '', 10);
      const headers = new Map<string, string>();
      for (const line of lines.slice(1)) {
        const i = line.indexOf(':');
        if (i > 0) headers.set(line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim());
      }
      if (status === 101) {
        const expected = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
        if ((headers.get('sec-websocket-accept') ?? '') !== expected) {
          socket.destroy();
          reject(new Error(`Sec-WebSocket-Accept 不符：${headers.get('sec-websocket-accept')}`));
          return;
        }
        const ws = new RawWsClient(socket);
        ws.feed(new Uint8Array(buf.slice(idx + 4)));
        resolve({ status, statusLine, headers, ws });
      } else {
        socket.end();
        resolve({ status, statusLine, headers, ws: undefined });
      }
    });
    socket.on('error', (err: Error) => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(err);
      }
    });
  });
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(a);
  out.set(b, a.byteLength);
  return out;
}

/** 编码客户端帧（必须 masked；FIN=1）。 */
function encodeClientFrame(opcode: number, payload: Uint8Array): Uint8Array {
  const len = payload.byteLength;
  let headerLen = 2;
  if (len >= 126 && len <= 0xffff) headerLen += 2;
  else if (len > 0xffff) headerLen += 8;
  const mask = crypto.randomBytes(4);
  const out = new Uint8Array(headerLen + 4 + len);
  out[0] = 0x80 | opcode;
  if (len < 126) {
    out[1] = 0x80 | len;
  } else if (len <= 0xffff) {
    out[1] = 0x80 | 126;
    const dv = new DataView(out.buffer, out.byteOffset);
    dv.setUint16(2, len);
  } else {
    out[1] = 0x80 | 127;
    const dv = new DataView(out.buffer, out.byteOffset);
    dv.setBigUint64(2, BigInt(len));
  }
  out.set(mask, headerLen);
  for (let i = 0; i < len; i += 1) {
    out[headerLen + 4 + i] = payload[i] ^ (mask[i % 4] as number);
  }
  return out;
}

interface ParsedFrame {
  readonly opcode: number;
  readonly payload: Uint8Array;
  readonly rest: Uint8Array;
}

/** 解码服务端帧（FIN=1；无 mask；不支持分片——服务端不应对测试分片）。 */
function takeServerFrame(buf: Uint8Array): ParsedFrame | undefined {
  if (buf.byteLength < 2) return undefined;
  const b0 = buf[0] as number;
  const b1 = buf[1] as number;
  const fin = (b0 & 0x80) !== 0;
  const opcode = b0 & 0x0f;
  const masked = (b1 & 0x80) !== 0;
  if (!fin || masked) throw new Error('服务端帧形态违约：仅接受 FIN=1 未掩码帧');
  let len = b1 & 0x7f;
  let offset = 2;
  if (len === 126) {
    if (buf.byteLength < 4) return undefined;
    len = new DataView(buf.buffer, buf.byteOffset + 2).getUint16(0);
    offset = 4;
  } else if (len === 127) {
    if (buf.byteLength < 10) return undefined;
    const big = new DataView(buf.buffer, buf.byteOffset + 2).getBigUint64(0);
    if (big > BigInt(0x7fffffff)) throw new Error('服务端帧长度越界');
    len = Number(big);
    offset = 10;
  }
  if (buf.byteLength < offset + len) return undefined;
  const payload = new Uint8Array(len);
  payload.set(buf.slice(offset, offset + len));
  return { opcode, payload, rest: buf.slice(offset + len) };
}

// ═══════════════════════════ 观测工具 ═══════════════════════════

/** 有界 real wait 轮询（10ms 步进；零 real sleep 语义）。 */
export async function waitUntil(
  what: string,
  predicate: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) return;
    if (Date.now() > deadline) throw new Error(`waitUntil 超时（${timeoutMs}ms）：${what}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

/** 协议帧观测器：payload 解码 + 发送序列管理（客户端方向）。 */
export class PeerWire {
  readonly frames: DecodedMessage[] = [];
  readonly pings: Uint8Array[] = [];
  readonly pongs: Uint8Array[] = [];
  closed: Readonly<{ code: number; reason: string }> | undefined;
  decodeError: unknown | undefined;
  /** true = 收到 hub ping 即回 pong（FS8 活性保持锚）；缺省 false（FS9 不回）。 */
  pongOnPing = false;
  private seq = 0;

  constructor(private readonly ws: RawWsClient) {
    ws.onMessage((bytes) => {
      try {
        this.frames.push(decodeMessage(bytes));
      } catch (err) {
        this.decodeError = err;
      }
    });
    ws.onPing((data) => {
      this.pings.push(data);
      if (this.pongOnPing) ws.sendPong(data);
    });
    ws.onPong((data) => this.pongs.push(data));
    ws.onClose((info) => {
      this.closed = info;
    });
  }

  send(message: ReplicationMessage): number {
    this.seq += 1;
    this.ws.sendBinary(encodeMessage(message, { sequence: this.seq }));
    return this.seq;
  }

  /** 等待指定 kind 的帧（按到达序扫描；预算内有界轮询）。 */
  async waitKind(kind: string, timeoutMs = 10_000): Promise<DecodedMessage> {
    await waitUntil(
      `hub 帧 ${kind}`,
      () => this.frames.some((f) => f.message.kind === kind) || this.decodeError !== undefined || this.closed !== undefined,
      timeoutMs,
    );
    if (this.decodeError !== undefined) throw this.decodeError;
    const found = this.frames.find((f) => f.message.kind === kind);
    if (found === undefined) {
      throw new Error(
        `未收到 hub 帧 ${kind}；已收 [${this.frames.map((f) => f.message.kind).join(', ')}]` +
          (this.closed !== undefined ? `；连接已关闭 ${JSON.stringify(this.closed)}` : ''),
      );
    }
    return found;
  }

  /** 已收集的帧 kind 序列（观测投影）。 */
  get kinds(): readonly string[] {
    return this.frames.map((f) => f.message.kind);
  }
}

/** 从 Y.Doc 读 ROOT.n（测试侧断言锚）。 */
export function readRootValue(doc: Y.Doc): unknown {
  return (doc.getMap('ROOT') as unknown as Map<string, unknown>).get('n');
}
