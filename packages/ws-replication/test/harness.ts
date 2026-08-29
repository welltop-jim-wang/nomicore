/**
 * SA6 共享确定性测试基建 —— issue #136（Phase 5 切片 6：`@nomicore/ws-replication`
 * namespace 状态机）红色验收测试。
 *
 * 纪律（phase-5 §测试 seam + 本仓库测试惯例）：
 * - fake-duplex 内存双端 transport：一 WS binary message = 一 frame（协议不变量 1）；
 *   微任务投递（零真实时间等待），测试经 `settle()` 确定性排空；
 * - 真实 yjs / 真实 Registry+Runtime（createNamespaceRegistryForTesting + 受控
 *   clock/scheduler/randomBytes）；Persistence 仅 stub 承担「可编程载体」——saveDoc
 *   门闩（dirty-notification 时序锚）、importDoc 门闩（bootstrap 竞态锚）、
 *   handle 状态可编程（degraded 锚）——行为锚全在 ws-replication/Registry/Runtime/
 *   真实 Y.Doc 上，不 mock 被测对象；
 * - 零源码 grep 断言；零 real sleep（全部 microtask/门闩/fake-scheduler 驱动）。
 *
 * 契约面（SA6 冻结，见任务简报）：`@nomicore/ws-replication` 主入口导出
 * createHubReplication/createPeerReplication + 类型 + 默认值常量；`/testing` 导出
 * createMemoryDuplexTransport()。本文件顶部的类型镜像与包的正式类型逐字段一致
 * （tsc-stub 校验对照使用），测试文件一律 import 包类型。
 */
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
import { createNamespaceRegistryForTesting, createRegistryTestScheduler } from '@nomicore/namespace-registry/testing';
import type {
  NamespaceLease,
  NamespaceLeaseReplicationStatus,
  NamespaceOwner,
  NamespaceRegistry,
  RegistryRandomBytes,
} from '@nomicore/namespace-registry';
import { decodeMessage, type DecodedMessage } from '@nomicore/replication-protocol';

// ═══════════════════════════ 契约面本地镜像（与 @nomicore/ws-replication 冻结契约一致） ═══════════════════════════

export interface WsReplicationLimits {
  readonly maxFrameBytes: number;
  readonly maxBootstrapBytes: number;
  readonly maxSyncDiffBytes: number;
  readonly maxUpdateBytes: number;
  readonly maxQueuedUpdateBytes: number;
  readonly maxQueuedUpdateCount: number;
  readonly maxInFlightUpdates: number;
  readonly maxQueuedBytesPerConnection: number;
  readonly lowWater: number;
  readonly highWater: number;
  readonly controlReserveBytes: number; // R2-4：control 帧独立保留额度（§17 L490）
}

export interface WsReplicationTimeouts {
  readonly helloTimeoutMs: number;
  readonly openTimeoutMs: number;
  readonly bootstrapTimeoutMs: number;
  readonly reconcileTimeoutMs: number;
  readonly closeTimeoutMs: number;
  readonly ackTimeoutMs: number;
}

export interface WsReplicationBackoff {
  readonly baseMs: number;
  readonly maxMs: number;
  readonly resetAfterMs: number;
}

export interface DuplexTransport {
  send(bytes: Uint8Array): void;
  close(code?: number, reason?: string): void;
  readonly closed: boolean;
  onMessage(listener: (bytes: Uint8Array) => void): () => void;
  onClose(listener: (info: Readonly<{ code: number; reason: string }>) => void): () => void;
}

export interface ReplicationTimer {
  readonly setTimeout: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
}

export type NamespaceAuthorization =
  | Readonly<{
      ok: true;
      localOwner: NamespaceOwner;
      permissions: Readonly<{ read: boolean; submit: boolean }>;
    }>
  | Readonly<{ ok: false }>;

export type NamespaceAuthorizer = (
  instanceIdentity: string,
  namespaceId: string,
) => Promise<NamespaceAuthorization>;

export interface ReplicationTarget {
  readonly namespaceId: string;
  readonly localOwner: NamespaceOwner;
}

export type PeerConnectionState =
  | 'stopped'
  | 'disconnected'
  | 'connecting'
  | 'handshaking'
  | 'ready'
  | 'draining'
  | 'backoff'
  | 'blocked';

export type PeerNamespaceState =
  | 'targeted'
  | 'opening'
  | 'bootstrapping'
  | 'reconciling'
  | 'live'
  | 'needs-resync'
  | 'closing'
  | 'closed'
  | 'conflicted'
  | 'failed'
  | 'disconnected';

/** 契约常量（与包 DEFAULT_* 一致；tests 显示传入常校验）。
 *  原则：首版 v1 只协商 protocolVersions [1]、capabilities 0/0。 */
export const CONTRACT_LIMITS: Readonly<WsReplicationLimits> = Object.freeze({
  maxFrameBytes: 8 * 1024 * 1024,
  maxBootstrapBytes: 4 * 1024 * 1024,
  maxSyncDiffBytes: 2 * 1024 * 1024,
  maxUpdateBytes: 512 * 1024,
  maxQueuedUpdateBytes: 4 * 1024 * 1024,
  maxQueuedUpdateCount: 256,
  maxInFlightUpdates: 32,
  maxQueuedBytesPerConnection: 8 * 1024 * 1024,
  lowWater: 64 * 1024,
  highWater: 512 * 1024,
  controlReserveBytes: 64 * 1024,
});

export const CONTRACT_TIMEOUTS: Readonly<WsReplicationTimeouts> = Object.freeze({
  helloTimeoutMs: 10_000,
  openTimeoutMs: 5_000,
  bootstrapTimeoutMs: 10_000,
  reconcileTimeoutMs: 10_000,
  closeTimeoutMs: 5_000,
  ackTimeoutMs: 10_000,
});

export const CONTRACT_BACKOFF: Readonly<WsReplicationBackoff> = Object.freeze({
  baseMs: 100,
  maxMs: 30_000,
  resetAfterMs: 10_000,
});

// ═══════════════════════════ 固定常量 ═══════════════════════════

export const SCHEMA_ENVELOPE = Object.freeze({
  lang: 'vfsl',
  version: 1,
  id: 'phase5-ws-namespace-sync',
  text: 'type ROOT = { n: number; ext?: number; extra?: number; };\n',
});
export const GOOD_ROOT = Object.freeze({ n: 42 });
export const FIXED_MS = 1_700_000_987_654;

export const NS_MAIN = `ns-${'a1'.repeat(16)}`; // 32 位小写 hex
export const NS_MISSING = `ns-${'0'.repeat(32)}`;
export const NS_DISABLED = `ns-${'2'.repeat(32)}`;
export const NS_UNKNOWN = `ns-${'3'.repeat(32)}`;

export const REP_ID_A = 'a'.repeat(32);
export const REP_ID_B = 'b'.repeat(32);

export const HUB_INSTANCE = 'hub-omega';
export const PEER_INSTANCE = 'peer-alpha';
export const HUB_OWNER: NamespaceOwner = Object.freeze({ userId: 'hub-owner-9f38' });
export const PEER_OWNER: NamespaceOwner = Object.freeze({ userId: 'peer-owner-7e21' });

// ═══════════════════════════ 通用工具 ═══════════════════════════

export interface Deferred {
  readonly promise: Promise<void>;
  resolve: () => void;
  reject: (cause: unknown) => void;
  /** 门闩是否已结算（单次门闩：消费方只在未结算时挂起——第二次 saveDoc/importDoc 不再被同一门闩卡死）。 */
  readonly settled: boolean;
}

export function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (cause: unknown) => void;
  let settled = false;
  const promise = new Promise<void>((r, j) => {
    resolve = () => {
      if (settled) return;
      settled = true;
      r();
    };
    reject = (cause: unknown) => {
      if (settled) return;
      settled = true;
      j(cause);
    };
  });
  return {
    promise,
    resolve,
    reject,
    get settled() {
      return settled;
    },
  };
}

export interface DeferPump {
  readonly defer: (task: () => void) => void;
  flush(): void;
  readonly pending: number;
}

const deferPumps = new Set<DeferPump>();

export function makeDeferPump(): DeferPump {
  const tasks: Array<() => void> = [];
  return {
    defer: (task) => tasks.push(task),
    flush: () => {
      const batch = tasks.splice(0);
      for (const task of batch) task();
    },
    get pending() {
      return tasks.length;
    },
  };
}

export function registerDeferPump(pump: DeferPump): void {
  deferPumps.add(pump);
}

function flushDeferPumps(): void {
  for (const pump of deferPumps) pump.flush();
}

/** 排空 microtask 直至稳定（显式 defer 泵只由 settleUntil 冲刷）。 */
export async function settle(): Promise<void> {
  for (let index = 0; index < 300; index += 1) {
    await Promise.resolve();
  }
}

/** 轮询直至谓词为真；未决轮显式冲刷测试 defer 泵，再排空 microtask。 */
export async function settleUntil(
  predicate: () => boolean,
  what: string,
  budget = 3_000,
): Promise<void> {
  for (let index = 0; index < budget; index += 1) {
    if (predicate()) return;
    flushDeferPumps();
    await Promise.resolve();
  }
  throw new Error(`settleUntil 预算耗尽：${what}`);
}

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

function keyOf(owner: Pick<User, 'userId'>, docId: string): string {
  return `${owner.userId}\u0000${docId}`;
}

/** 从 Y.Doc 的 META 读取复制身份（与 runtime 构造读取同源）。 */
export function readDocIdentity(doc: Y.Doc): { replicationId: string; replicationEpoch: number } {
  const meta = doc.getMap('META');
  const replicationId = meta.get('replicationId');
  const replicationEpoch = meta.get('replicationEpoch');
  if (typeof replicationId !== 'string' || typeof replicationEpoch !== 'number') {
    throw new Error(`seed doc 必须携带合规复制身份，实际 ${String(replicationId)}/${String(replicationEpoch)}`);
  }
  return { replicationId, replicationEpoch };
}

/** 构造带完整 META 的 seed replica（导入/本地副本 fixture）。 */
export function makeSeedDoc(
  docId: string,
  opts: { replicationId?: string; replicationEpoch?: number; rootN?: number } = {},
): Y.Doc {
  const doc = new Y.Doc();
  const sc = doc.getMap('SCHEMA');
  const schemaPack = { ...SCHEMA_ENVELOPE, id: docId };
  for (const [k, v] of Object.entries(schemaPack)) sc.set(k, v);
  const meta = doc.getMap('META');
  meta.set('docId', docId);
  meta.set('createdAt', new Date(FIXED_MS).toISOString()); // 与 registry create 的 META.createdAt 逐值一致
  if (opts.replicationId !== undefined) meta.set('replicationId', opts.replicationId);
  if (opts.replicationEpoch !== undefined) meta.set('replicationEpoch', opts.replicationEpoch);
  doc.getMap('ROOT').set('n', opts.rootN ?? 42);
  return doc;
}

export function leaseReplication(lease: NamespaceLease): NamespaceLeaseReplicationStatus {
  const status = lease.getStatus() as unknown as {
    readonly runtime: Readonly<{ readonly replication: NamespaceLeaseReplicationStatus }> | null;
  };
  if (status.runtime === null) throw new Error('lease 已释放，无法读取 runtime 复制域');
  return status.runtime.replication;
}

export function leaseRuntimeStatus(lease: NamespaceLease): Readonly<{ readonly schema: { readonly state: string } }> {
  return (lease.getStatus() as unknown as { readonly runtime: Record<string, unknown> }).runtime as Readonly<{
    readonly schema: { readonly state: string };
  }>;
}

export async function schemaReady(lease: NamespaceLease): Promise<void> {
  for (let i = 0; i < 400; i += 1) {
    if (leaseRuntimeStatus(lease).schema.state === 'ready') return;
    await Promise.resolve();
  }
  throw new Error(`schema 未在微观任务预算内就绪：${JSON.stringify(lease.getStatus())}`);
}

export function okLease(result: unknown): NamespaceLease {
  const r = result as { ok?: boolean; lease?: NamespaceLease };
  if (!r.ok || r.lease === undefined) {
    throw new Error(`期望成功，实际：${JSON.stringify(result)}`);
  }
  return r.lease;
}

// ═══════════════════════════ Stub Persistence（可编程载体；行为锚不在它身上） ═══════════════════════════

interface StoredDoc {
  readonly owner: User;
  readonly docId: string;
  readonly doc: Y.Doc;
  status: DocHandleStatus;
  archived: boolean;
}

/**
 * 可编程 DocPersistence + ReplicaPersistence：
 * - saveDoc：记录 dirty-notification 事件（`saveEvents`），可选单次门闩（`saveGate`
 *   ——挂起 =「dirty 尚未登记完成」的确定性时序锚）；
 * - importDoc：可选单次门闩（`importHold`——挂起 =「复制导入尚未完成」的竞态锚），
 *   duplicate 抛 DocDuplicateError（与真实 adapter 同分类）；
 * - `setStatus`：把 handle 状态切到 persistence-degraded（hub/peer degraded 锚）。
 */
export class StubPersistence implements DocPersistence {
  private readonly docs = new Map<string, StoredDoc>();
  readonly saveEvents: Array<Readonly<{ docId: string; userId: string; seq: number }>> = [];
  saveGate: Deferred | undefined;
  importHold: Deferred | undefined;
  /** 单次门闩：下一次 loadDoc 挂起（B-2c startOpen 迟到续体竞态锚——registry.open 在途）。 */
  loadGate: Deferred | undefined;
  /** 顺序门闩队列（issue #137 多 namespace 锚）：每个 saveDoc 依次消费队首门闩并挂起
   *  ——「分别悬挂多个 namespace 的 dirty notification」的确定性时序锚（单次 saveGate
   *  只能挂一个命名空间；两个 namespace 的窗口各自满需各自 ACK 被悬挂）。 */
  saveGates: Deferred[] = [];
  /** 单次门闩消费登记：同一门闩只挂起一次（第二次 saveDoc/importDoc/loadDoc 不被重复卡死）。 */
  private saveGateSeen: Deferred | undefined;
  private importHoldSeen: Deferred | undefined;
  private loadGateSeen: Deferred | undefined;
  readonly archived: Array<Readonly<{ docId: string; userId: string }>> = [];
  private saveSeq = 0;

  seedDocument(owner: User, docId: string, doc: Y.Doc): void {
    const key = keyOf(owner, docId);
    this.docs.set(key, { owner, docId, doc, status: 'ready', archived: false });
  }

  peek(owner: User, docId: string): Y.Doc | undefined {
    return this.docs.get(keyOf(owner, docId))?.doc;
  }

  setStatus(owner: User, docId: string, status: DocHandleStatus): void {
    const stored = this.docs.get(keyOf(owner, docId));
    if (stored === undefined) throw new Error(`setStatus 未知文档 ${docId}`);
    stored.status = status;
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
    if (this.loadGate !== undefined && this.loadGateSeen !== this.loadGate) {
      // 单次门闩：保持可读（测试侧经同一引用释放）；同一门闩只挂起一次。
      this.loadGateSeen = this.loadGate;
      await this.loadGate.promise;
    }
    const stored = this.docs.get(keyOf(owner, docId));
    return stored === undefined || stored.archived ? null : this.makeHandle(stored);
  }

  async saveDoc(handle: DocHandle): Promise<void> {
    this.saveSeq += 1;
    this.saveEvents.push({ docId: handle.docId, userId: handle.owner.userId, seq: this.saveSeq });
    if (this.saveGate !== undefined && this.saveGateSeen !== this.saveGate) {
      // 单次门闩：保持可读（测试侧经同一引用释放）；同一门闩只挂起一次。
      this.saveGateSeen = this.saveGate;
      await this.saveGate.promise;
    }
    if (this.saveGates.length > 0) {
      // 顺序门闩队列（issue #137）：按 saveDoc 到达顺序逐个消费并挂起；空队列零影响
      //（既有 saveGate 单次门闩行为不变）。
      const gate = this.saveGates.shift();
      if (gate !== undefined) await gate.promise;
    }
  }

  async importDoc(owner: User, docId: string, doc: Y.Doc): Promise<DocHandle> {
    const key = keyOf(owner, docId);
    const existing = this.docs.get(key);
    if (existing !== undefined && !existing.archived) throw new DocDuplicateError();
    if (this.importHold !== undefined && this.importHoldSeen !== this.importHold) {
      // 单次门闩：保持可读（测试侧经同一引用释放）；同一门闩只挂起一次。
      this.importHoldSeen = this.importHold;
      await this.importHold.promise;
      const raced = this.docs.get(key);
      if (raced !== undefined && !raced.archived) throw new DocDuplicateError();
    }
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
    this.archived.push({ docId, userId: owner.userId });
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
      identity: { ok: true, value: { replicationId: identity.replicationId, replicationEpoch: identity.replicationEpoch } },
    };
  }
}

export interface ReplicaNode {
  readonly role: 'hub' | 'peer';
  readonly persistence: StubPersistence;
  readonly scheduler: ReturnType<typeof createRegistryTestScheduler>;
  readonly registry: NamespaceRegistry;
}

/** 构造真实 Registry（testing seam；受控 clock/scheduler/randomBytes；idle 远大于测试预算）。 */
export function makeNode(role: 'hub' | 'peer'): ReplicaNode {
  const persistence = new StubPersistence();
  const scheduler = createRegistryTestScheduler();
  const registry = createNamespaceRegistryForTesting(persistence, {
    clock: { now: () => FIXED_MS },
    scheduler,
    idleTimeoutMs: 1_000_000,
    randomBytes: makeCounterRandomBytes(),
    role,
  });
  return { role, persistence, scheduler, registry };
}

export interface HubNamespaceFixture {
  readonly namespaceId: string;
  readonly lease: NamespaceLease;
  readonly identity: Readonly<{ replicationId: string; replicationEpoch: number }>;
}

/** Hub 侧：真实 create + enableReplication（identity 安装），并等待 schema ready。 */
export async function makeHubNamespace(
  node: ReplicaNode,
  opts: { owner: NamespaceOwner; enabled?: boolean; root?: Readonly<{ n: number; extra?: number }> } = {
    owner: HUB_OWNER,
  },
): Promise<HubNamespaceFixture> {
  const owner = opts.owner;
  const lease = okLease(
    await node.registry.create({
      owner,
      schema: SCHEMA_ENVELOPE,
      root: { ...GOOD_ROOT, ...(opts.root ?? {}) },
    }),
  );
  await schemaReady(lease);
  if (opts.enabled !== false) {
    const enabled = await lease.enableReplication();
    if (!enabled.ok) throw new Error(`enableReplication 失败：${JSON.stringify(enabled)}`);
  }
  const repl = leaseReplication(lease);
  if (opts.enabled !== false && repl.state !== 'enabled') {
    throw new Error(`fixture 期望启用复制，实际 ${JSON.stringify(repl)}`);
  }
  if (repl.state === 'disabled') {
    // hubEnabled:false：复制未启用 fixture（AC2 禁用锚）；identity 占位（无复制事实）。
    return {
      namespaceId: lease.namespaceId,
      lease,
      identity: { replicationId: '', replicationEpoch: 0 },
    };
  }
  return {
    namespaceId: lease.namespaceId,
    lease,
    identity: { replicationId: repl.replicationId, replicationEpoch: repl.replicationEpoch },
  };
}

/** Peer 侧：本地已存在副本（reconcile 前置）——真实 importReplica。 */
export async function makePeerReplica(
  node: ReplicaNode,
  owner: NamespaceOwner,
  namespaceId: string,
  doc: Y.Doc,
  expected: ReplicationIdentityRef,
): Promise<NamespaceLease> {
  const result = await node.registry.importReplica(owner, namespaceId, doc, expected);
  return okLease(result);
}

// ═══════════════════════════ Fake-duplex 内存双端 transport ═══════════════════════════

interface EndState {
  listeners: Set<(bytes: Uint8Array) => void>;
  closeListeners: Set<(info: Readonly<{ code: number; reason: string }>) => void>;
  closed: boolean;
}

function makeEnd(self: EndState, peer: EndState): DuplexTransport {
  return {
    send(bytes) {
      if (self.closed) return;
      const copy = bytes.slice();
      queueMicrotask(() => {
        for (const listener of [...peer.listeners]) listener(copy);
      });
    },
    close(code = 1000, reason = '') {
      if (self.closed) return;
      self.closed = true;
      queueMicrotask(() => {
        for (const listener of [...peer.closeListeners]) listener({ code, reason });
      });
    },
    get closed() {
      return self.closed;
    },
    onMessage(listener) {
      self.listeners.add(listener);
      return () => self.listeners.delete(listener);
    },
    onClose(listener) {
      self.closeListeners.add(listener);
      return () => self.closeListeners.delete(listener);
    },
  };
}

/** 内存双端：一端 send → 对端 onMessage（微任务投递）；一端 close → 对端 onClose。 */
export function makeDuplex(): Readonly<{ left: DuplexTransport; right: DuplexTransport }> {
  const left: EndState = { listeners: new Set(), closeListeners: new Set(), closed: false };
  const right: EndState = { listeners: new Set(), closeListeners: new Set(), closed: false };
  return { left: makeEnd(left, right), right: makeEnd(right, left) };
}

/** 一组连接线（peer 端 / hub 端），带旁路记录 + 选择性丢帧（故障注入 seam）。 */
export interface Wire {
  /** 交给 peer 实现的端。 */
  readonly peerEnd: DuplexTransport;
  /** 交给 hub 实现的端。 */
  readonly hubEnd: DuplexTransport;
  /** 到达对端（未被丢弃）的帧，按到达序。 */
  readonly peerToHub: Uint8Array[];
  readonly hubToPeer: Uint8Array[];
  /** 跨方向统一发送时间序（每帧发送时刻，含被丢帧——drop 判定前记录；
   *  用于「谁先发出」的跨方向时序断言——两方向数组索引不可比）。 */
  readonly timeline: ReadonlyArray<Readonly<{ direction: 'peer-to-hub' | 'hub-to-peer'; bytes: Uint8Array }>>;
  /** 被故障注入丢弃的帧（发送方已发出、未到达对端）。 */
  readonly droppedPeerToHub: Uint8Array[];
  readonly droppedHubToPeer: Uint8Array[];
  /** 下一帧命中断言即丢弃（仅一次）。 */
  dropNextPeerToHub(pred: (bytes: Uint8Array) => boolean): void;
  dropNextHubToPeer(pred: (bytes: Uint8Array) => boolean): void;
  closePeerSide(code?: number, reason?: string): void;
  closeHubSide(code?: number, reason?: string): void;
  readonly peerSideClosed: boolean;
  readonly hubSideClosed: boolean;
  readonly peerSideCloseInfo: Readonly<{ code: number; reason: string }> | undefined;
  readonly hubSideCloseInfo: Readonly<{ code: number; reason: string }> | undefined;
}

export function makeWire(): Wire {
  const leftEnd: EndState = { listeners: new Set(), closeListeners: new Set(), closed: false };
  const rightEnd: EndState = { listeners: new Set(), closeListeners: new Set(), closed: false };
  const pair = { left: makeEnd(leftEnd, rightEnd), right: makeEnd(rightEnd, leftEnd) };
  const peerToHub: Uint8Array[] = [];
  const hubToPeer: Uint8Array[] = [];
  const timeline: Array<Readonly<{ direction: 'peer-to-hub' | 'hub-to-peer'; bytes: Uint8Array }>> = [];
  const droppedPeerToHub: Uint8Array[] = [];
  const droppedHubToPeer: Uint8Array[] = [];
  let dropPeer: ((bytes: Uint8Array) => boolean) | undefined;
  let dropHub: ((bytes: Uint8Array) => boolean) | undefined;
  let peerSideCloseInfo: Readonly<{ code: number; reason: string }> | undefined;
  let hubSideCloseInfo: Readonly<{ code: number; reason: string }> | undefined;

  const peerEnd: DuplexTransport = {
    send(bytes) {
      timeline.push({ direction: 'peer-to-hub', bytes: bytes.slice() });
      if (dropPeer !== undefined && dropPeer(bytes)) {
        dropPeer = undefined;
        droppedPeerToHub.push(bytes.slice());
        return;
      }
      peerToHub.push(bytes.slice());
      pair.left.send(bytes);
    },
    close(code = 1000, reason = '') {
      pair.left.close(code, reason);
    },
    get closed() {
      return pair.left.closed;
    },
    onMessage(listener) {
      return pair.left.onMessage(listener);
    },
    onClose(listener) {
      return pair.left.onClose((info) => {
        peerSideCloseInfo = info;
        listener(info);
      });
    },
  };
  const hubEnd: DuplexTransport = {
    send(bytes) {
      timeline.push({ direction: 'hub-to-peer', bytes: bytes.slice() });
      if (dropHub !== undefined && dropHub(bytes)) {
        dropHub = undefined;
        droppedHubToPeer.push(bytes.slice());
        return;
      }
      hubToPeer.push(bytes.slice());
      pair.right.send(bytes);
    },
    close(code = 1000, reason = '') {
      pair.right.close(code, reason);
    },
    get closed() {
      return pair.right.closed;
    },
    onMessage(listener) {
      return pair.right.onMessage(listener);
    },
    onClose(listener) {
      return pair.right.onClose((info) => {
        hubSideCloseInfo = info;
        listener(info);
      });
    },
  };
  return {
    peerEnd,
    hubEnd,
    peerToHub,
    hubToPeer,
    timeline,
    droppedPeerToHub,
    droppedHubToPeer,
    dropNextPeerToHub(pred) {
      dropPeer = pred;
    },
    dropNextHubToPeer(pred) {
      dropHub = pred;
    },
    closePeerSide(code = 1000, reason = '') {
      pair.left.close(code, reason);
      // 网络级断线：本地端（peer 应用侧）同样收到本方 socket 关闭事件（真实 WS 语义；
      // 保留对端通知不变）
      queueMicrotask(() => {
        for (const listener of [...leftEnd.closeListeners]) listener({ code, reason });
      });
    },
    closeHubSide(code = 1000, reason = '') {
      pair.right.close(code, reason);
      queueMicrotask(() => {
        for (const listener of [...rightEnd.closeListeners]) listener({ code, reason });
      });
    },
    get peerSideClosed() {
      return pair.left.closed;
    },
    get hubSideClosed() {
      return pair.right.closed;
    },
    get peerSideCloseInfo() {
      return peerSideCloseInfo;
    },
    get hubSideCloseInfo() {
      return hubSideCloseInfo;
    },
  };
}

// ═══════════════════════════ Frame 观测辅助 ═══════════════════════════

export function decodeAll(bytesList: readonly Uint8Array[]): DecodedMessage[] {
  return bytesList.map((bytes) => {
    try {
      return decodeMessage(bytes);
    } catch (cause) {
      throw new Error(
        `wire 帧无法解码（utf8 hex: ${bytesToHex(bytes)}）`,
        { cause },
      );
    }
  });
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** 便利：按 kind 过滤解码帧。 */
export function framesOfKind<T extends DecodedMessage['message']>(
  decoded: DecodedMessage[],
  kind: T['kind'],
): Array<{ header: DecodedMessage['header']; message: T }> {
  return decoded.filter(
    (d): d is { header: DecodedMessage['header']; message: T } => d.message.kind === kind,
  );
}

/** 便利：最后一帧指定 kind 或 undefined。 */
export function lastOfKind<T extends DecodedMessage['message']>(
  decoded: DecodedMessage[],
  kind: T['kind'],
): { header: DecodedMessage['header']; message: T } | undefined {
  const all = framesOfKind<T>(decoded, kind);
  return all[all.length - 1];
}

/** 对 wire 全量帧最常用的一步式观测（含顺序记录）。 */
export function snapshotWire(
  wire: Wire,
): Readonly<{ readonly peerToHub: DecodedMessage[]; readonly hubToPeer: DecodedMessage[] }> {
  return {
    peerToHub: decodeAll(wire.peerToHub),
    hubToPeer: decodeAll(wire.hubToPeer),
  };
}
