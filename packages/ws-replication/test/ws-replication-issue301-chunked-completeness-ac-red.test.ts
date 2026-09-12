/**
 * SA6 验收契约 — issue #301（#295 切片 3）：分块同步的完备性、observer 与新旧互通矩阵
 * （互通矩阵不在本票范围——ADR 0022 非目标；本文件覆盖 AC1–AC4 与 AC5 observer seam）。
 *
 * 契约来源（规范效力链）：
 * - ADR `docs/adr/0022-chunked-sync-transfer.md`：observer 8 型追加（L72–83，字段集对齐既有
 *   chunked-update-* 四型；safe-field/throw 隔离/无 observer 逐字节等价沿用 §23.4）；
 *   超时两向收口（L70：snapshot → BOOTSTRAP_FAILED 族终局；sync-diff →
 *   RESYNC_REQUIRED{SYNC_TRANSFER_EXPIRED} 非终态）；assembly 纯易失与 epoch fence 丢弃
 *   （L49）；恶意声明分配前校验 + 一次性有界分配（L49）。
 * - `docs/protocols/instance-replication-v1.md`（wire 唯一权威）：
 *   §8.1（kind=1 首 chunk 校验 / 排他复制导入 / 单 ACK 锚末 chunk 帧序）；
 *   §9.2/§9.4（kind=2 收齐一次 apply、`SYNC_TRANSFER_EXPIRED` 词表登记、非终态收口）；
 *   §10.3（assembly 纯易失、丢弃触发面、二维声明上界 + 几何一致先于分配）；
 *   §13.2（四码注册）；§17（assemblyTimeoutMs kind 无关 + 进度滑动 deadline；chunk 全走
 *   data 路径、control reserve 零 chunk；多 ns round-robin 每轮每 ns 一帧）；
 *   §18（超时两向收口）；§23.1（第 29–36 型事件词汇与语义）、§23.2（稳定码闭联合）、
 *   §23.3（safe-field：长度/计数/受控标识、Yjs bytes 深扫禁止项）、§23.4（throw 隔离、
 *   决策落定后发射、无 observer 逐字节等价、clock 缺省 latency 整键缺失）、§23.7
 *   （conformance：全事件矩阵 key-set 白名单 + token/owner/Yjs bytes/SCHEMA/ROOT/cause
 *   哨兵深扫 + observer 全 throw 行为等价）。
 *
 * 本票能力缺口（红灯条件——当前 HEAD 必须失败，失败原因是能力缺失而非环境/fixture/入口）：
 * - 8 型 observer 事件**零发射点**：`chunked-snapshot-{sent,applied,acked,aborted}` 与
 *   `chunked-sync-{sent,applied,acked,aborted}` 在实现中不存在（types.ts 无该 8 型，
 *   hub/peer-namespace 零发射）；同时 slice 2 已交付普通族改道归零
 *   （bootstrap-snapshot-sent / bootstrap-imported / sync-step2-sent / sync-diff-applied
 *   在分块窗口内零发射）——故分块传输当前在 observer 面**完全不可见**。
 * - kind=1/2 的 aborted 事件被 slice 2 显式推迟到本票（hub/peer `clearInboundAssembly`
 *   的 `busyKind === 0` 门）——channel-teardown / connection-teardown / timeout 行零事件。
 *
 * 负控（当前 HEAD 即绿，实现后必须保持绿——证明红不在环境/入口/断言敏感度）：
 * - 生命周期完备性（AC1/AC2/AC3）与多 ns 公平调度（AC4）已由 slice 2 交付：
 *   kind=1 尾部丢失 → assembly 超时 → BOOTSTRAP_FAILED 终局 + 零 durable 残留；
 *   kind=2 尾部丢失 → RESYNC_REQUIRED{SYNC_TRANSFER_EXPIRED} 非终态；
 *   重复/错序 chunk → `<family>_TRANSFER_VIOLATION` + apply 前零写入；
 *   中途丢帧 → 连接级 SEQUENCE_VIOLATION（可靠有序 transport 下丢帧不可能静默产生部分导入）；
 *   恶意声明（聚合/计数上界）在分配前拒绝 → `<family>_TRANSFER_TOO_LARGE` + 零写入；
 *   未超单帧上限的 snapshot/diff 仍走单帧普通族（触发条件，非兼容回落）；
 *   无 observer / observer 全 throw 与基线逐字节等价。
 *
 * 纪律：无 skip/only/todo、无 env override、无 fallback、无源码字符串/正则断言、零 real
 * sleep（fake duplex + fake scheduler + 虚拟时间）；断言全部落在运行时行为（observer 事件
 * 载荷、wire 帧、namespace 状态、live Y.Doc 值、持久化 dirty 计数）。既有 #300 契约文件
 * `ws-replication-issue300-chunked-sync-ac-red.test.ts` 与刻画文件不改。
 */
import { describe, expect, it } from 'vitest';
import {
  createHubReplication,
  createPeerReplication,
  type DuplexTransport,
  type HubReplication,
  type PeerReplication,
  type ReplicationClock,
  type ReplicationLimits,
  type ReplicationObserver,
  type ReplicationTimeouts,
} from '@nomicore/ws-replication';
import {
  CAP_CHUNKED_UPDATE,
  decodeMessage,
  encodeMessage,
  type DecodedMessage,
} from '@nomicore/replication-protocol';
import { DEFAULT_PEER_VERIFIER, TEST_TOKEN } from './driver.js';
import {
  HUB_INSTANCE,
  HUB_OWNER,
  PEER_INSTANCE,
  PEER_OWNER,
  makeNode,
  makeWire,
  okLease,
  schemaReady,
  settle,
  settleUntil,
  type ReplicaNode,
  type Wire,
} from './harness.js';

// ═══════════════════════════ 契约常量 ═══════════════════════════

const SCHEMA = Object.freeze({
  lang: 'vfsl',
  version: 1,
  id: 'issue301-completeness-ac',
  text: 'type ROOT = { n: number; blurb: string; };\n',
});

/** slice 2 同款构型基线：maxUpdateBytes=8KiB ⇒ chunk 上限 = 8KiB；聚合上限 512KiB。 */
const LIMITS: Readonly<Partial<ReplicationLimits>> = Object.freeze({
  maxUpdateBytes: 8 * 1024,
  maxBootstrapBytes: 8 * 1024,
  maxChunkedBootstrapBytes: 512 * 1024,
  maxSyncDiffBytes: 32 * 1024,
  maxChunkedSyncDiffBytes: 512 * 1024,
  maxChunkedUpdateBytes: 64 * 1024,
  maxInFlightUpdates: 8,
  maxQueuedUpdateCount: 100,
  maxQueuedUpdateBytes: 1 * 1024 * 1024,
});

/** reconcile/bootstrap 上限抬高到 assemblyTimeoutMs 之上：隔离「assembly 停滞超时」单变量。 */
const TIMEOUTS: Readonly<Partial<ReplicationTimeouts>> = Object.freeze({
  ackTimeoutMs: 60_000,
  assemblyTimeoutMs: 30_000,
  bootstrapTimeoutMs: 120_000,
  reconcileTimeoutMs: 120_000,
});

const MAX_UPDATE_BYTES = 8 * 1024;
const BIG_SNAPSHOT = 'z'.repeat(100_000);
const BIG_DIFF = 'q'.repeat(100_000);
const MEDIUM_DIFF = 's'.repeat(16_000);

const HUB_CLOCK: ReplicationClock = Object.freeze({ now: () => 1_700_000_000_000 });

type ChunkMsg = Extract<DecodedMessage['message'], { kind: 'UPDATE_CHUNK' }>;
type ErrorMsg = Extract<DecodedMessage['message'], { kind: 'ERROR' }>;
type ResyncMsg = Extract<DecodedMessage['message'], { kind: 'RESYNC_REQUIRED' }>;
type SyncAppliedMsg = Extract<DecodedMessage['message'], { kind: 'SYNC_APPLIED' }>;

// ═══════════════════════════ observer 记录基建（§23 白名单约束） ═══════════════════════════

interface Rec {
  readonly events: Array<Record<string, unknown>>;
  readonly observer: ReplicationObserver;
}
function recorder(): Rec {
  const events: Array<Record<string, unknown>> = [];
  return {
    events,
    observer: (event) => {
      events.push(event as unknown as Record<string, unknown>);
    },
  };
}
const eventTypes = (rec: Rec): string[] => rec.events.map((e) => String(e.type));
const eventsOf = (rec: Rec, type: string): Array<Record<string, unknown>> =>
  rec.events.filter((e) => e.type === type);

/** §23.1 第 29–36 型键集白名单（ADR 0022 L78–81 + §23.1 行；append-only 冻结面）。 */
const EVENT_KEYS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'chunked-snapshot-sent': ['chunkCount', 'connectionId', 'namespaceId', 'side', 'totalBytes', 'transferId', 'type'],
  'chunked-snapshot-applied': ['applyLatencyMs', 'bytes', 'chunkCount', 'connectionId', 'namespaceId', 'side', 'type'],
  'chunked-snapshot-acked': ['ackLatencyMs', 'bytes', 'connectionId', 'namespaceId', 'side', 'type'],
  'chunked-snapshot-aborted': ['namespaceId', 'reason', 'receivedBytes', 'receivedChunks', 'side', 'transferId', 'type'],
  'chunked-sync-sent': ['chunkCount', 'connectionId', 'namespaceId', 'side', 'syncRoundId', 'totalBytes', 'transferId', 'type'],
  'chunked-sync-applied': ['applyLatencyMs', 'bytes', 'chunkCount', 'connectionId', 'namespaceId', 'side', 'syncRoundId', 'type'],
  'chunked-sync-acked': ['ackLatencyMs', 'bytes', 'connectionId', 'namespaceId', 'side', 'type'],
  'chunked-sync-aborted': ['namespaceId', 'reason', 'receivedBytes', 'receivedChunks', 'side', 'transferId', 'type'],
});

const ABORT_REASONS: readonly string[] = Object.freeze([
  'timeout',
  'shed',
  'resync-declared',
  'channel-teardown',
  'connection-teardown',
  'epoch-fence',
]);

/** 事件键集 ⊆ 白名单 ∧ 必需键在场 ∧ 禁用键不在场（键集冻结；长度/计数 safe-field）。 */
function expectChunkedEventShape(
  event: Record<string, unknown>,
  required: readonly string[],
  forbidden: readonly string[],
  label: string,
): void {
  const type = String(event.type);
  const allowed = EVENT_KEYS[type];
  expect(allowed, `${label}：事件类型 ${type} 必须在 §23.1 冻结词汇内`).toBeDefined();
  for (const key of Object.keys(event)) {
    expect(allowed!, `${label}：${type} 不得携带白名单外键 ${key}（键集冻结）`).toContain(key);
  }
  for (const key of required) {
    expect(key in event, `${label}：${type} 必须携带 ${key}`).toBe(true);
  }
  for (const key of forbidden) {
    expect(key in event, `${label}：${type} 不得携带 ${key}（键集冻结/改道纪律）`).toBe(false);
  }
}

/** §23.3 禁止项深扫：事件树不得出现 Yjs bytes/Error 载体。 */
function deepScanForbidden(value: unknown, path: string, problems: string[]): void {
  if (value === null || typeof value !== 'object') return;
  if (value instanceof Uint8Array) problems.push(`${path}: Uint8Array`);
  else if (value instanceof ArrayBuffer) problems.push(`${path}: ArrayBuffer`);
  else if (value instanceof DataView) problems.push(`${path}: DataView`);
  else if (value instanceof Error) problems.push(`${path}: Error`);
  else if (Array.isArray(value)) {
    value.forEach((item, index) => deepScanForbidden(item, `${path}[${index}]`, problems));
  } else {
    for (const [key, inner] of Object.entries(value)) deepScanForbidden(inner, `${path}.${key}`, problems);
  }
}

// ═══════════════════════════ wire 观测辅助 ═══════════════════════════

function onlyKind<const K extends DecodedMessage['message']['kind']>(
  frames: readonly DecodedMessage[],
  kind: K,
): Array<Extract<DecodedMessage['message'], { kind: K }>> {
  return frames
    .filter((f) => f.message.kind === kind)
    .map((f) => f.message as Extract<DecodedMessage['message'], { kind: K }>);
}
function errorCodes(frames: readonly DecodedMessage[]): string[] {
  return frames.filter((f) => f.message.kind === 'ERROR').map((f) => (f.message as ErrorMsg).code);
}
function resyncReasons(frames: readonly DecodedMessage[]): string[] {
  return frames
    .filter((f) => f.message.kind === 'RESYNC_REQUIRED')
    .map((f) => (f.message as ResyncMsg).reasonCode);
}

/** 单笔 transfer 结构完整性（不假设发送端切片密度）。 */
function expectWellFormedTransfer(
  chunks: ReadonlyArray<{ sequence: number; message: ChunkMsg }>,
  label: string,
): { transferId: number; totalBytes: number; chunkCount: number } {
  expect(chunks.length, `${label}：wire 上必须 ≥2 个 chunk 帧（分块传输）`).toBeGreaterThanOrEqual(2);
  const head = chunks[0]!.message;
  const { transferId, totalBytes, chunkCount } = head;
  let sum = 0;
  chunks.forEach((chunk, index) => {
    expect(chunk.message.transferId, `${label}：transferId 逐帧一致`).toBe(transferId);
    expect(chunk.message.totalBytes, `${label}：totalBytes 逐帧一致`).toBe(totalBytes);
    expect(chunk.message.chunkCount, `${label}：chunkCount 逐帧一致`).toBe(chunkCount);
    expect(chunk.message.chunkIndex, `${label}：chunkIndex 严格递增`).toBe(index);
    sum += chunk.message.bytes.byteLength;
  });
  expect(chunkCount, `${label}：chunkCount === 实际 chunk 数`).toBe(chunks.length);
  expect(sum, `${label}：Σbytes === totalBytes`).toBe(totalBytes);
  return { transferId, totalBytes, chunkCount };
}

// ═══════════════════════════ 组装（单/双 namespace；真协商 chunkedUpdate） ═══════════════════════════

interface Ctx {
  readonly hubNode: ReplicaNode;
  readonly peerNode: ReplicaNode;
  readonly hub: HubReplication;
  readonly peer: PeerReplication;
  readonly nsIds: readonly string[];
  readonly wire: Wire;
  readonly hubRec: Rec;
  readonly peerRec: Rec;
  frames(dir: 'peerToHub' | 'hubToPeer'): DecodedMessage[];
  chunks(dir: 'peerToHub' | 'hubToPeer'): Array<{ sequence: number; message: ChunkMsg }>;
  chunksOf(dir: 'peerToHub' | 'hubToPeer', nsId: string): Array<{ sequence: number; message: ChunkMsg }>;
  nextSeq(dir: 'peerToHub' | 'hubToPeer'): number;
  codes(dir: 'peerToHub' | 'hubToPeer'): string[];
  root(side: 'hub' | 'peer', nsId: string, key: 'blurb' | 'n'): unknown;
  docPresent(side: 'hub' | 'peer', nsId: string): boolean;
  saveCount(side: 'hub' | 'peer', nsId: string): number;
  advance(ms: number): Promise<void>;
  write(side: 'hub' | 'peer', nsId: string, value: Readonly<{ blurb?: string }>): Promise<void>;
  /** hub 第一命名空间的 epoch bump（§11 fence 触发面）。 */
  bumpHubEpoch(): Promise<void>;
  releaseHubData(): void;
  stop(): Promise<void>;
}

interface BootOptions {
  readonly limits?: Readonly<Partial<ReplicationLimits>>;
  readonly initialBlurb?: string;
  /** 命名空间数（缺省 1；=2 用于 AC4 多 ns 复用/公平回归）。 */
  readonly namespaces?: number;
  readonly hubRec?: Rec;
  readonly peerRec?: Rec;
  readonly clock?: boolean;
  /** 完全不注入 observer（逐字节等价基线）。 */
  readonly noObserver?: boolean;
  /** 丢 hub→peer 的 kind=1 末 chunk（分块 snapshot 尾部停滞）。 */
  readonly dropSnapshotLastChunk?: boolean;
  /** 丢 peer→hub 的整笔 kind=1 transfer（peer 悬 bootstrapping，注入面）。 */
  readonly blankPeerBootstrap?: boolean;
  /** 丢 peer→hub 的 kind=2 末 chunk 及其后全部帧（分块 sync diff 尾部停滞 → assembly 超时）。 */
  readonly sealAfterSyncLastChunk?: boolean;
  /** 丢 peer→hub 的 kind=2 中间 chunk（i1；后续帧照常 → 连接级 sequence 违例）。 */
  readonly dropSyncMiddleChunk?: boolean;
  /** peer→hub 出站帧原位改写（同 sequence；违例/恶意声明注入面）。 */
  readonly rewritePeerSend?: (bytes: Uint8Array) => Uint8Array;
  /** hub 侧起始 data 闸门关闭（control reserve 回归）。 */
  readonly pauseHubDataAtStart?: boolean;
}

/** hub 侧 data 闸门代理（transport seam）：起始 bufferedAmount > highWater ⇒ data 暂停。 */
const PAUSE_HIGH = 600 * 1024;
function withHubDataPauseProxy(end: DuplexTransport): { end: DuplexTransport; release(): void } {
  let level = PAUSE_HIGH;
  const wrapped: DuplexTransport = {
    send(bytes) {
      end.send(bytes);
    },
    close(code?: number, reason?: string) {
      end.close(code, reason);
    },
    get closed() {
      return end.closed;
    },
    onMessage(listener) {
      return end.onMessage(listener);
    },
    onClose(listener) {
      return end.onClose(listener);
    },
    get bufferedAmount() {
      return level;
    },
  };
  return {
    end: wrapped,
    release: () => {
      level = 0;
    },
  };
}

/** 出站帧代理（故障注入 seam）：返回 undefined = 丢弃该帧，否则发送返回值。 */
function withPeerSendProxy(
  end: DuplexTransport,
  onSend: (bytes: Uint8Array) => Uint8Array | undefined,
): DuplexTransport {
  return {
    send(bytes) {
      const out = onSend(bytes);
      if (out !== undefined) end.send(out);
    },
    close(code?: number, reason?: string) {
      end.close(code, reason);
    },
    get closed() {
      return end.closed;
    },
    onMessage(listener) {
      return end.onMessage(listener);
    },
    onClose(listener) {
      return end.onClose(listener);
    },
  };
}

async function boot(opts: BootOptions = {}): Promise<Ctx> {
  const hubNode = makeNode('hub');
  const peerNode = makeNode('peer');
  const hubRec = opts.hubRec ?? recorder();
  const peerRec = opts.peerRec ?? recorder();
  const decode = (bytes: Uint8Array): DecodedMessage =>
    decodeMessage(bytes, { selectedCapabilities: CAP_CHUNKED_UPDATE });
  const clock = opts.clock === true ? HUB_CLOCK : undefined;
  const limits = opts.limits ?? LIMITS;
  const timeouts = TIMEOUTS;

  let firstHubLease: { bumpReplicationEpoch(): Promise<unknown> } | undefined;
  const createHubNamespace = async (): Promise<string> => {
    const lease = okLease(
      await hubNode.registry.create({
        owner: HUB_OWNER,
        schema: { ...SCHEMA },
        root: { n: 1, blurb: opts.initialBlurb ?? 'seed' },
      }),
    );
    await schemaReady(lease);
    const enabled = await lease.enableReplication();
    if (!enabled.ok) throw new Error(`enableReplication 失败：${JSON.stringify(enabled)}`);
    if (firstHubLease === undefined) {
      firstHubLease = lease as unknown as { bumpReplicationEpoch(): Promise<unknown> };
    }
    return lease.namespaceId;
  };
  const nsIds: string[] = [];
  const namespaceCount = opts.namespaces ?? 1;
  for (let index = 0; index < namespaceCount; index += 1) nsIds.push(await createHubNamespace());

  let activeWire: Wire | undefined;
  let releaseHubData: (() => void) | undefined;

  const hub = createHubReplication({
    instanceId: HUB_INSTANCE,
    registry: hubNode.registry,
    authorize: async () => ({
      ok: true as const,
      localOwner: HUB_OWNER,
      permissions: { read: true, submit: true },
    }),
    timer: hubNode.scheduler,
    verifyToken: DEFAULT_PEER_VERIFIER,
    limits,
    timeouts,
    ...(opts.noObserver === true ? {} : { observer: hubRec.observer }),
    ...(clock === undefined ? {} : { clock }),
  });

  const peer = createPeerReplication({
    instanceId: PEER_INSTANCE,
    hubInstanceId: HUB_INSTANCE,
    registry: peerNode.registry,
    dial: () => {
      const wire = makeWire();
      activeWire = wire;
      let hubEnd: DuplexTransport = wire.hubEnd;
      if (opts.pauseHubDataAtStart === true) {
        const paused = withHubDataPauseProxy(hubEnd);
        hubEnd = paused.end;
        releaseHubData = paused.release;
      }
      if (opts.blankPeerBootstrap === true) {
        const inner = hubEnd;
        hubEnd = {
          send: (bytes) => {
            const m = decode(bytes).message;
            if (m.kind === 'UPDATE_CHUNK' && m.transferKind === 1) return;
            inner.send(bytes);
          },
          close: (code, reason) => inner.close(code, reason),
          get closed() {
            return inner.closed;
          },
          onMessage: (listener) => inner.onMessage(listener),
          onClose: (listener) => inner.onClose(listener),
        };
      }
      if (opts.dropSnapshotLastChunk === true) {
        wire.dropNextHubToPeer((bytes) => {
          const m = decode(bytes).message;
          return (
            m.kind === 'UPDATE_CHUNK' && m.transferKind === 1 && m.chunkIndex === m.chunkCount - 1
          );
        });
      }
      let sealed = false;
      const needsPeerProxy =
        opts.sealAfterSyncLastChunk === true ||
        opts.dropSyncMiddleChunk === true ||
        opts.rewritePeerSend !== undefined;
      const peerEnd: DuplexTransport = needsPeerProxy
        ? withPeerSendProxy(wire.peerEnd, (bytes) => {
            if (sealed) return undefined;
            const decoded = decode(bytes);
            const m = decoded.message;
            if (m.kind === 'UPDATE_CHUNK' && m.transferKind === 2) {
              if (opts.dropSyncMiddleChunk === true && m.chunkIndex === 1) return undefined;
              if (opts.sealAfterSyncLastChunk === true && m.chunkIndex === m.chunkCount - 1) {
                sealed = true;
                return undefined;
              }
            }
            return opts.rewritePeerSend === undefined ? bytes : opts.rewritePeerSend(bytes);
          })
        : wire.peerEnd;
      void hub.accept(hubEnd, { token: TEST_TOKEN });
      return peerEnd;
    },
    timer: peerNode.scheduler,
    targets: nsIds.map((namespaceId) => ({ namespaceId, localOwner: PEER_OWNER })),
    limits,
    timeouts,
    chunkedUpdate: true,
    ...(opts.noObserver === true ? {} : { observer: peerRec.observer }),
    ...(clock === undefined ? {} : { clock }),
  });
  peer.start();
  await settleUntil(() => peer.getConnectionState() === 'ready', '连接 ready');

  const bytesOf = (dir: 'peerToHub' | 'hubToPeer'): readonly Uint8Array[] => {
    if (activeWire === undefined) throw new Error('peer 尚未拨号');
    return dir === 'peerToHub' ? activeWire.peerToHub : activeWire.hubToPeer;
  };
  const frames = (dir: 'peerToHub' | 'hubToPeer'): DecodedMessage[] => bytesOf(dir).map(decode);
  const chunks = (dir: 'peerToHub' | 'hubToPeer'): Array<{ sequence: number; message: ChunkMsg }> =>
    frames(dir)
      .filter((f) => f.message.kind === 'UPDATE_CHUNK')
      .map((f) => ({ sequence: f.header.sequence, message: f.message as ChunkMsg }));
  const doc = (
    side: 'hub' | 'peer',
    nsId: string,
  ): { getMap(name: string): Map<string, unknown> } | undefined =>
    side === 'hub'
      ? (hubNode.persistence.peek(HUB_OWNER, nsId) as never)
      : (peerNode.persistence.peek(PEER_OWNER, nsId) as never);

  return {
    hubNode,
    peerNode,
    hub,
    peer,
    nsIds,
    get wire() {
      if (activeWire === undefined) throw new Error('peer 尚未拨号');
      return activeWire;
    },
    hubRec,
    peerRec,
    frames,
    chunks,
    chunksOf: (dir, nsId) => chunks(dir).filter((c) => c.message.namespaceId === nsId),
    nextSeq: (dir) => frames(dir).reduce((max, f) => Math.max(max, f.header.sequence), 0) + 1,
    codes: (dir) => errorCodes(frames(dir)),
    root: (side, nsId, key) => doc(side, nsId)?.getMap('ROOT').get(key),
    docPresent: (side, nsId) => doc(side, nsId) !== undefined,
    saveCount: (side, nsId) =>
      (side === 'hub' ? hubNode : peerNode).persistence.saveEvents.filter((e) => e.docId === nsId)
        .length,
    advance: async (ms) => {
      await peerNode.scheduler.advanceBy(ms);
      await hubNode.scheduler.advanceBy(ms);
      await settle();
    },
    write: async (side, nsId, value) => {
      const node = side === 'hub' ? hubNode : peerNode;
      const owner = side === 'hub' ? HUB_OWNER : PEER_OWNER;
      const business = okLease(await node.registry.open(owner, nsId));
      await schemaReady(business);
      for (const [key, v] of Object.entries(value)) {
        const result = await business.mutateData({ op: 'set', path: [key], value: v });
        if (!result.ok) throw new Error(`业务写失败：${JSON.stringify(result)}`);
      }
      await business.release();
    },
    bumpHubEpoch: async () => {
      if (firstHubLease === undefined) throw new Error('无 hub lease');
      const result = await firstHubLease.bumpReplicationEpoch();
      if ((result as { ok?: boolean }).ok !== true) {
        throw new Error(`bumpReplicationEpoch 失败：${JSON.stringify(result)}`);
      }
      await settle();
    },
    releaseHubData: () => {
      if (releaseHubData === undefined) throw new Error('本构型未启用 hub data 闸门代理');
      releaseHubData();
    },
    stop: () => peer.stop().catch(() => undefined),
  };
}

/** 单帧 snapshot 注入前置：把 peer 悬在 bootstrapping（分块注入面）。 */
async function bootstrapOpenOkIdentity(
  ctx: Ctx,
  nsId: string,
): Promise<{ replicationId: string; replicationEpoch: number }> {
  const msg = onlyKind(ctx.frames('hubToPeer'), 'OPEN_OK').find((m) => m.namespaceId === nsId);
  if (msg === undefined) throw new Error('OPEN_OK 缺失');
  return { replicationId: msg.replicationId, replicationEpoch: msg.replicationEpoch };
}

// ═══════════════════════════ 契约测试 ═══════════════════════════

describe('issue #301（#295 切片 3）：分块同步完备性 + observer 8 型验收契约', () => {
  // ────────────────── 红灯 R1：chunked snapshot 三成功型 + 改道归零 ──────────────────

  it('红灯 R1（AC5/AC1）：kind=1 分块 snapshot 恰一次 sent（hub）/applied（peer）/acked（hub），字段 = wire 申报投影，普通族改道归零', async () => {
    const ctx = await boot({ initialBlurb: BIG_SNAPSHOT, clock: true });
    try {
      const nsId = ctx.nsIds[0]!;
      await settleUntil(() => ctx.peer.getNamespaceState(nsId) === 'live', 'peer live');
      await settle();

      const transfer = expectWellFormedTransfer(ctx.chunks('hubToPeer'), 'kind=1 snapshot transfer');

      const sent = eventsOf(ctx.hubRec, 'chunked-snapshot-sent');
      expect(
        sent,
        'hub 必须发射恰一次 chunked-snapshot-sent（transfer 完成出站时恰一，非逐 chunk）',
      ).toHaveLength(1);
      expectChunkedEventShape(
        sent[0]!,
        ['namespaceId', 'transferId', 'chunkCount', 'totalBytes', 'side'],
        ['sequence', 'applyLatencyMs', 'ackLatencyMs'],
        'R1 sent',
      );
      expect(sent[0]!.side, 'R1 sent：side=hub（snapshot 恒 hub→peer）').toBe('hub');
      expect(sent[0]!.namespaceId, 'R1 sent：namespaceId').toBe(nsId);
      expect(sent[0]!.transferId, 'R1 sent：transferId = wire 申报').toBe(transfer.transferId);
      expect(sent[0]!.chunkCount, 'R1 sent：chunkCount = wire 申报').toBe(transfer.chunkCount);
      expect(sent[0]!.totalBytes, 'R1 sent：totalBytes = wire 申报').toBe(transfer.totalBytes);
      expect(
        eventsOf(ctx.hubRec, 'bootstrap-snapshot-sent'),
        'R1：分块窗口内普通族 bootstrap-snapshot-sent 必须归零（R21 改道）',
      ).toHaveLength(0);

      const applied = eventsOf(ctx.peerRec, 'chunked-snapshot-applied');
      expect(
        applied,
        'peer 必须发射恰一次 chunked-snapshot-applied（排他复制导入成功结算）',
      ).toHaveLength(1);
      expectChunkedEventShape(
        applied[0]!,
        ['namespaceId', 'bytes', 'chunkCount', 'side'],
        ['transferId', 'sequence', 'queueWaitMs', 'protectedCheckMs', 'liveApplyMs', 'dirtyNotifyMs'],
        'R1 applied',
      );
      expect(applied[0]!.side, 'R1 applied：side=peer').toBe('peer');
      expect(applied[0]!.bytes, 'R1 applied：bytes = wire totalBytes（Σbytes 精确核对）').toBe(
        transfer.totalBytes,
      );
      expect(applied[0]!.chunkCount, 'R1 applied：chunkCount = wire 申报').toBe(transfer.chunkCount);
      expect(
        typeof applied[0]!.applyLatencyMs === 'number' && (applied[0]!.applyLatencyMs as number) >= 0,
        'R1 applied：clock 注入时 applyLatencyMs 必须在场且 ≥ 0',
      ).toBe(true);
      expect(
        eventsOf(ctx.peerRec, 'bootstrap-imported'),
        'R1：分块窗口内普通族 bootstrap-imported 必须归零（R21 改道）',
      ).toHaveLength(0);

      const acked = eventsOf(ctx.hubRec, 'chunked-snapshot-acked');
      expect(acked, 'hub 必须发射恰一次 chunked-snapshot-acked（单 BOOTSTRAP_ACK 收妥结算）').toHaveLength(1);
      expectChunkedEventShape(
        acked[0]!,
        ['namespaceId', 'bytes', 'side'],
        ['sequence', 'transferId', 'chunkCount', 'syncRoundId'],
        'R1 acked',
      );
      expect(acked[0]!.bytes, 'R1 acked：bytes = wire totalBytes').toBe(transfer.totalBytes);
      expect(
        typeof acked[0]!.ackLatencyMs === 'number' && (acked[0]!.ackLatencyMs as number) >= 0,
        'R1 acked：clock 注入时 ackLatencyMs 必须在场且 ≥ 0',
      ).toBe(true);

      // 收敛（apply 的最终效应）与单 ACK 锚（§8.2）
      expect(ctx.root('peer', nsId, 'blurb'), 'R1：peer 基线值 = hub 快照').toBe(BIG_SNAPSHOT);
      const acks = onlyKind(ctx.frames('peerToHub'), 'BOOTSTRAP_ACK');
      expect(acks).toHaveLength(1);
      expect(acks[0]!.ackedSequence).toBe(ctx.chunks('hubToPeer')[ctx.chunks('hubToPeer').length - 1]!.sequence);
    } finally {
      await ctx.stop();
    }
  });

  // ────────────────── 红灯 R2：chunked sync 三成功型 + syncRoundId + 改道归零 ──────────────────

  it('红灯 R2（AC5/AC2）：kind=2 分块 diff 恰一次 sent/applied/acked，sync 族携 syncRoundId（acked 冻结无 syncRoundId），普通族改道归零', async () => {
    const ctx = await boot({ clock: true });
    try {
      const nsId = ctx.nsIds[0]!;
      await settleUntil(() => ctx.peer.getNamespaceState(nsId) === 'live', 'peer live');
      await settle();
      const peerStep2SentBefore = eventsOf(ctx.peerRec, 'sync-step2-sent').length;
      const hubAppliedBefore = eventsOf(ctx.hubRec, 'sync-diff-applied').length;

      await ctx.write('peer', nsId, { blurb: BIG_DIFF });
      await settleUntil(() => ctx.root('hub', nsId, 'blurb') === BIG_DIFF, 'hub 收敛大文档');
      await settle();

      const kind2 = ctx.chunks('peerToHub').filter((c) => c.message.transferKind === 2);
      const transfer = expectWellFormedTransfer(kind2, 'kind=2 sync-diff transfer');
      const step1Rounds = onlyKind(ctx.frames('peerToHub'), 'SYNC_STEP1')
        .filter((m) => m.namespaceId === nsId)
        .map((m) => m.syncRoundId);
      const roundId = kind2[0]!.message.syncRoundId;
      expect(roundId, 'R2：kind=2 首 chunk 必须携绑定块 syncRoundId').toBeDefined();
      expect(step1Rounds, 'R2：绑定 round 必须来自本连接的 SYNC_STEP1').toContain(roundId);

      const sent = eventsOf(ctx.peerRec, 'chunked-sync-sent');
      expect(sent, '发送侧（peer）必须发射恰一次 chunked-sync-sent').toHaveLength(1);
      expectChunkedEventShape(
        sent[0]!,
        ['namespaceId', 'transferId', 'chunkCount', 'totalBytes', 'syncRoundId', 'side'],
        ['sequence', 'applyLatencyMs', 'ackLatencyMs'],
        'R2 sent',
      );
      expect(sent[0]!.transferId, 'R2 sent：transferId = wire 申报').toBe(transfer.transferId);
      expect(sent[0]!.chunkCount, 'R2 sent：chunkCount = wire 申报').toBe(transfer.chunkCount);
      expect(sent[0]!.totalBytes, 'R2 sent：totalBytes = wire 申报').toBe(transfer.totalBytes);
      expect(sent[0]!.syncRoundId, 'R2 sent：syncRoundId = wire round 投影').toBe(roundId);

      const acked = eventsOf(ctx.peerRec, 'chunked-sync-acked');
      expect(acked, '发送侧（peer）必须发射恰一次 chunked-sync-acked').toHaveLength(1);
      expectChunkedEventShape(
        acked[0]!,
        ['namespaceId', 'bytes', 'side'],
        ['sequence', 'transferId', 'chunkCount', 'syncRoundId'],
        'R2 acked',
      );
      expect(acked[0]!.bytes, 'R2 acked：bytes = wire totalBytes').toBe(transfer.totalBytes);
      expect(
        typeof acked[0]!.ackLatencyMs === 'number' && (acked[0]!.ackLatencyMs as number) >= 0,
        'R2 acked：clock 注入时 ackLatencyMs 必须在场且 ≥ 0',
      ).toBe(true);

      const applied = eventsOf(ctx.hubRec, 'chunked-sync-applied');
      expect(applied, '接收侧（hub）必须发射恰一次 chunked-sync-applied').toHaveLength(1);
      expectChunkedEventShape(
        applied[0]!,
        ['namespaceId', 'bytes', 'chunkCount', 'syncRoundId', 'side'],
        ['transferId', 'sequence', 'queueWaitMs', 'protectedCheckMs', 'liveApplyMs', 'dirtyNotifyMs'],
        'R2 applied',
      );
      expect(applied[0]!.bytes, 'R2 applied：bytes = wire totalBytes').toBe(transfer.totalBytes);
      expect(applied[0]!.chunkCount, 'R2 applied：chunkCount = wire 申报').toBe(transfer.chunkCount);
      expect(applied[0]!.syncRoundId, 'R2 applied：syncRoundId = wire round 投影').toBe(roundId);
      expect(
        typeof applied[0]!.applyLatencyMs === 'number' && (applied[0]!.applyLatencyMs as number) >= 0,
        'R2 applied：clock 注入时 applyLatencyMs 必须在场且 ≥ 0',
      ).toBe(true);

      // R21 改道归零：分块窗口内无新增普通族 sent/applied
      expect(
        eventsOf(ctx.peerRec, 'sync-step2-sent').length - peerStep2SentBefore,
        'R2：分块窗口内普通族 sync-step2-sent 必须归零（R21 改道）',
      ).toBe(0);
      expect(
        eventsOf(ctx.hubRec, 'sync-diff-applied').length - hubAppliedBefore,
        'R2：分块窗口内普通族 sync-diff-applied 必须归零（R21 改道）',
      ).toBe(0);

      // 单 ACK 锚末 chunk 帧序（§9.3）。判别式 = ackedSequence（= kind=2 末 chunk 的 wire 帧序）：
      // bootstrap 完成后的初始 round 会在同一方向产生一笔既有 SYNC_APPLIED（基线 wire 行为，
      // 与本票无关），故不得按 SYNC_APPLIED 总数计数，须以 ackedSequence 精确锚定分块 round。
      const syncApplied = onlyKind(ctx.frames('hubToPeer'), 'SYNC_APPLIED') as SyncAppliedMsg[];
      const anchored = syncApplied.filter((m) => m.ackedSequence === kind2[kind2.length - 1]!.sequence);
      expect(
        anchored,
        'R2：kind=2 分块 round 必须以恰一笔 SYNC_APPLIED 锚定末 chunk 帧序（ackedSequence 判别，排除既有 round 的 SYNC_APPLIED）',
      ).toHaveLength(1);
    } finally {
      await ctx.stop();
    }
  });

  // ────────────────── 红灯 R3：kind=1 aborted{channel-teardown} ──────────────────

  it('红灯 R3（AC1/AC5）：CLOSE_NAMESPACE 收口 partial kind=1 assembly → 恰一 chunked-snapshot-aborted{channel-teardown} + 零 durable 残留', async () => {
    const ctx = await boot({ initialBlurb: BIG_SNAPSHOT, dropSnapshotLastChunk: true });
    try {
      const nsId = ctx.nsIds[0]!;
      await settle();
      expect(ctx.peer.getNamespaceState(nsId), 'R3 前置：peer 悬在 bootstrapping').toBe('bootstrapping');
      const received = ctx.chunksOf('hubToPeer', nsId);
      expect(received.length, 'R3 前置：partial kind=1 assembly 已收 ≥1 chunk').toBeGreaterThanOrEqual(1);
      const head = received[0]!.message;
      expect(received.length, 'R3 前置：末 chunk 已被丢弃（assembler 悬置）').toBe(head.chunkCount - 1);
      const receivedBytes = received.reduce((sum, c) => sum + c.message.bytes.byteLength, 0);
      const savesBefore = ctx.saveCount('peer', nsId);

      const crafted = encodeMessage(
        { kind: 'CLOSE_NAMESPACE', namespaceId: nsId, reasonCode: 'ac-contract-close' },
        { sequence: ctx.nextSeq('hubToPeer') },
      );
      ctx.wire.hubEnd.send(crafted);
      await settle();
      await settle();
      await settle();

      const aborted = eventsOf(ctx.peerRec, 'chunked-snapshot-aborted');
      expect(
        aborted,
        'kind=1 partial assembly 被 channel-teardown 丢弃时必须发射恰一次 chunked-snapshot-aborted',
      ).toHaveLength(1);
      expectChunkedEventShape(
        aborted[0]!,
        ['namespaceId', 'transferId', 'reason', 'receivedChunks', 'receivedBytes', 'side'],
        ['connectionId', 'sequence', 'bytes', 'chunkCount'],
        'R3 aborted',
      );
      expect(ABORT_REASONS, 'R3：reason 必须复用既有 ChunkedUpdateAbortReason 闭联合（零新词）').toContain(
        aborted[0]!.reason,
      );
      expect(aborted[0]!.reason, 'R3：channel-teardown 行').toBe('channel-teardown');
      expect(aborted[0]!.transferId, 'R3：transferId = wire 申报').toBe(head.transferId);
      expect(aborted[0]!.receivedChunks, 'R3：receivedChunks = 实际已收进度').toBe(received.length);
      expect(aborted[0]!.receivedBytes, 'R3：receivedBytes = 实际已收字节').toBe(receivedBytes);

      // 成功型互斥 + 零 durable 残留
      expect(eventsOf(ctx.peerRec, 'chunked-snapshot-applied'), 'R3：aborted transfer 零 applied').toHaveLength(0);
      expect(ctx.docPresent('peer', nsId), 'R3：partial 绝不进入 live 路径——零写入').toBe(false);
      expect(ctx.saveCount('peer', nsId), 'R3：零 durable 残留（零 dirty 登记）').toBe(savesBefore);
    } finally {
      await ctx.stop();
    }
  });

  // ────────────────── 红灯 R4：kind=1 aborted{connection-teardown} ──────────────────

  it('红灯 R4（AC1/AC5）：断线丢弃 partial kind=1 assembly → 恰一 chunked-snapshot-aborted{connection-teardown} + 零 durable 残留', async () => {
    const ctx = await boot({ initialBlurb: BIG_SNAPSHOT, dropSnapshotLastChunk: true });
    try {
      const nsId = ctx.nsIds[0]!;
      await settle();
      expect(ctx.peer.getNamespaceState(nsId), 'R4 前置：bootstrapping').toBe('bootstrapping');
      const received = ctx.chunksOf('hubToPeer', nsId);
      const head = received[0]!.message;
      const receivedBytes = received.reduce((sum, c) => sum + c.message.bytes.byteLength, 0);
      const savesBefore = ctx.saveCount('peer', nsId);

      ctx.wire.closeHubSide(1001, 'ac-contract-disconnect');
      await settle();
      await settle();
      await settle();

      const aborted = eventsOf(ctx.peerRec, 'chunked-snapshot-aborted');
      expect(aborted, '断线必须丢弃 partial kind=1 assembly 并发射恰一次 aborted').toHaveLength(1);
      expect(aborted[0]!.reason, 'R4：connection-teardown 行').toBe('connection-teardown');
      expect(aborted[0]!.transferId).toBe(head.transferId);
      expect(aborted[0]!.receivedChunks).toBe(received.length);
      expect(aborted[0]!.receivedBytes).toBe(receivedBytes);
      expect(ctx.docPresent('peer', nsId), 'R4：零写入').toBe(false);
      expect(ctx.saveCount('peer', nsId), 'R4：零 durable 残留').toBe(savesBefore);
    } finally {
      await ctx.stop();
    }
  });

  // ────────────────── 红灯 R5：kind=2 aborted{timeout} + AC2 非终态收口 ──────────────────

  it('红灯 R5（AC2/AC5）：kind=2 assembly 停滞超 assemblyTimeoutMs → 恰一 chunked-sync-aborted{timeout} + RESYNC_REQUIRED{SYNC_TRANSFER_EXPIRED} 非终态 + 零 durable 残留', async () => {
    const ctx = await boot({ sealAfterSyncLastChunk: true });
    try {
      const nsId = ctx.nsIds[0]!;
      await settleUntil(() => ctx.peer.getNamespaceState(nsId) === 'live', 'peer live');
      const savesBefore = ctx.saveCount('hub', nsId);
      await ctx.write('peer', nsId, { blurb: BIG_DIFF });
      await settle();
      await settle();

      const received = ctx.chunksOf('peerToHub', nsId).filter((c) => c.message.transferKind === 2);
      expect(received.length, 'R5 前置：real kind=2 transfer 已在本连接上出现且尾部停滞').toBeGreaterThanOrEqual(2);
      const head = received[0]!.message;
      expect(received.length, 'R5 前置：末 chunk 已丢弃（assembler 悬置）').toBe(head.chunkCount - 1);
      const receivedBytes = received.reduce((sum, c) => sum + c.message.bytes.byteLength, 0);

      await ctx.advance(30_001);
      await settle();

      // AC2（slice 2 已交付——绿半）：kind=2 超时 = 弃 partial + RESYNC_REQUIRED{SYNC_TRANSFER_EXPIRED}（非终态）
      expect(
        resyncReasons(ctx.frames('hubToPeer')),
        'R5-AC2：sync 段超时必须出向 RESYNC_REQUIRED{SYNC_TRANSFER_EXPIRED}（非终态）',
      ).toContain('SYNC_TRANSFER_EXPIRED');
      expect(ctx.codes('hubToPeer'), 'R5-AC2：非终态——hub 不得发 namespace ERROR').toEqual([]);
      expect(eventsOf(ctx.hubRec, 'namespace-failed'), 'R5-AC2：零 failed 终态边沿').toHaveLength(0);
      expect(ctx.peer.getNamespaceState(nsId), 'R5-AC2：对端非 failed').not.toBe('failed');
      expect(ctx.root('hub', nsId, 'blurb'), 'R5-AC2：hub 值不变（partial 绝不 apply）').not.toBe(BIG_DIFF);
      expect(ctx.saveCount('hub', nsId), 'R5-AC2：零 dirty 登记').toBe(savesBefore);

      // AC5（红半）：超时丢弃 partial 必须发射恰一 chunked-sync-aborted{timeout}
      const aborted = eventsOf(ctx.hubRec, 'chunked-sync-aborted');
      expect(
        aborted,
        'kind=2 assembly 停滞超时（进度滑动 deadline）必须发射恰一次 chunked-sync-aborted{timeout}',
      ).toHaveLength(1);
      expectChunkedEventShape(
        aborted[0]!,
        ['namespaceId', 'transferId', 'reason', 'receivedChunks', 'receivedBytes', 'side'],
        ['connectionId', 'sequence', 'bytes', 'chunkCount'],
        'R5 aborted',
      );
      expect(aborted[0]!.reason, 'R5：timeout 行').toBe('timeout');
      expect(aborted[0]!.transferId, 'R5：transferId = wire 申报').toBe(head.transferId);
      expect(aborted[0]!.receivedChunks, 'R5：已收进度').toBe(received.length);
      expect(aborted[0]!.receivedBytes, 'R5：已收字节').toBe(receivedBytes);
      expect(eventsOf(ctx.hubRec, 'chunked-sync-applied'), 'R5：aborted transfer 零 applied').toHaveLength(0);
    } finally {
      await ctx.stop();
    }
  });

  // ────────────────── 红灯 R6：safe-field / secret-free / 键集冻结（全 8 型） ──────────────────

  it('红灯 R6（AC5/§23.3/§23.7）：8 型事件全量收集 → 键集白名单、无 Yjs bytes/Error、无 token/owner/内容哨兵', async () => {
    const collected: Array<Record<string, unknown>> = [];
    const runs: Array<() => Promise<void>> = [];

    // run 1：chunked snapshot 成功族（sent/applied/acked）
    runs.push(async () => {
      const ctx = await boot({ initialBlurb: BIG_SNAPSHOT, clock: true });
      try {
        await settleUntil(() => ctx.peer.getNamespaceState(ctx.nsIds[0]!) === 'live', 'snapshot live');
        await settle();
        collected.push(...ctx.hubRec.events, ...ctx.peerRec.events);
      } finally {
        await ctx.stop();
      }
    });
    // run 2：chunked sync 成功族（sent/applied/acked）
    runs.push(async () => {
      const ctx = await boot({ clock: true });
      try {
        await settleUntil(() => ctx.peer.getNamespaceState(ctx.nsIds[0]!) === 'live', 'sync live');
        await ctx.write('peer', ctx.nsIds[0]!, { blurb: BIG_DIFF });
        await settleUntil(() => ctx.root('hub', ctx.nsIds[0]!, 'blurb') === BIG_DIFF, 'sync 收敛');
        await settle();
        collected.push(...ctx.hubRec.events, ...ctx.peerRec.events);
      } finally {
        await ctx.stop();
      }
    });
    // run 3：snapshot aborted{connection-teardown}
    runs.push(async () => {
      const ctx = await boot({ initialBlurb: BIG_SNAPSHOT, dropSnapshotLastChunk: true });
      try {
        await settle();
        ctx.wire.closeHubSide(1001, 'ac-contract-safe-field');
        await settle();
        await settle();
        collected.push(...ctx.hubRec.events, ...ctx.peerRec.events);
      } finally {
        await ctx.stop();
      }
    });
    // run 4：sync aborted{timeout}
    runs.push(async () => {
      const ctx = await boot({ sealAfterSyncLastChunk: true });
      try {
        await settleUntil(() => ctx.peer.getNamespaceState(ctx.nsIds[0]!) === 'live', 'timeout live');
        await ctx.write('peer', ctx.nsIds[0]!, { blurb: BIG_DIFF });
        await settle();
        await settle();
        await ctx.advance(30_001);
        await settle();
        collected.push(...ctx.hubRec.events, ...ctx.peerRec.events);
      } finally {
        await ctx.stop();
      }
    });
    for (const run of runs) await run();

    const chunked = collected.filter((e) => String(e.type).startsWith('chunked-snapshot-') || String(e.type).startsWith('chunked-sync-'));
    const seen = new Set(chunked.map((e) => String(e.type)));
    for (const type of Object.keys(EVENT_KEYS)) {
      expect(seen.has(type), `R6：8 型事件必须全部可观测（缺 ${type}）`).toBe(true);
    }
    for (const event of chunked) {
      expectChunkedEventShape(event, ['namespaceId', 'side'], [], `R6 ${String(event.type)}`);
    }

    // 深扫禁止项 + secret/内容哨兵
    const problems: string[] = [];
    chunked.forEach((event, index) => deepScanForbidden(event, `event[${index}]`, problems));
    expect(problems, `R6：事件树禁止 Uint8Array/ArrayBuffer/DataView/Error（§23.3）`).toEqual([]);
    const serialized = JSON.stringify(chunked);
    for (const secret of [TEST_TOKEN, HUB_OWNER.userId, PEER_OWNER.userId, 'zzzzz', 'qqqqq']) {
      expect(serialized.includes(secret), `R6：事件载荷不得包含哨兵 ${secret.slice(0, 12)}…`).toBe(false);
    }
  });

  // ────────────────── 红灯 R7：clock 缺省 → latency 整键缺失 ──────────────────

  it('红灯 R7（AC5/§23.4）：无 clock 注入时 applied/acked 的 latency 键整键缺失（非 undefined 值）', async () => {
    const snapshotCtx = await boot({ initialBlurb: BIG_SNAPSHOT }); // observer 在场、clock 缺省
    try {
      const nsId = snapshotCtx.nsIds[0]!;
      await settleUntil(() => snapshotCtx.peer.getNamespaceState(nsId) === 'live', 'snapshot live');
      await settle();
      const applied = eventsOf(snapshotCtx.peerRec, 'chunked-snapshot-applied');
      const acked = eventsOf(snapshotCtx.hubRec, 'chunked-snapshot-acked');
      expect(applied, 'R7：applied 事件必须在场（前置）').toHaveLength(1);
      expect(acked, 'R7：acked 事件必须在场（前置）').toHaveLength(1);
      expect('applyLatencyMs' in applied[0]!, 'R7：无 clock → applyLatencyMs 整键缺失').toBe(false);
      expect('ackLatencyMs' in acked[0]!, 'R7：无 clock → ackLatencyMs 整键缺失').toBe(false);
    } finally {
      await snapshotCtx.stop();
    }

    const syncCtx = await boot({});
    try {
      const nsId = syncCtx.nsIds[0]!;
      await settleUntil(() => syncCtx.peer.getNamespaceState(nsId) === 'live', 'sync live');
      await syncCtx.write('peer', nsId, { blurb: BIG_DIFF });
      await settleUntil(() => syncCtx.root('hub', nsId, 'blurb') === BIG_DIFF, 'sync 收敛');
      await settle();
      const applied = eventsOf(syncCtx.hubRec, 'chunked-sync-applied');
      const acked = eventsOf(syncCtx.peerRec, 'chunked-sync-acked');
      expect(applied, 'R7：sync applied 事件必须在场（前置）').toHaveLength(1);
      expect(acked, 'R7：sync acked 事件必须在场（前置）').toHaveLength(1);
      expect('applyLatencyMs' in applied[0]!, 'R7：无 clock → sync applyLatencyMs 整键缺失').toBe(false);
      expect('ackLatencyMs' in acked[0]!, 'R7：无 clock → sync ackLatencyMs 整键缺失').toBe(false);
    } finally {
      await syncCtx.stop();
    }
  });

  // ────────────────── 红灯 R8：kind=1 aborted{connection-teardown}（GOAWAY drain 行） ──────────────────

  it('红灯 R8（AC1/AC5）：GOAWAY drain 收口 partial kind=1 assembly → 恰一 chunked-snapshot-aborted{connection-teardown}（§23.1：GOAWAY 无独立 reason）+ 零 durable 残留', async () => {
    const ctx = await boot({ initialBlurb: BIG_SNAPSHOT, dropSnapshotLastChunk: true });
    try {
      const nsId = ctx.nsIds[0]!;
      await settle();
      expect(ctx.peer.getNamespaceState(nsId), 'R8 前置：bootstrapping').toBe('bootstrapping');
      const received = ctx.chunksOf('hubToPeer', nsId);
      const head = received[0]!.message;
      const receivedBytes = received.reduce((sum, c) => sum + c.message.bytes.byteLength, 0);
      const savesBefore = ctx.saveCount('peer', nsId);

      const goaway = encodeMessage(
        { kind: 'GOAWAY', reasonCode: 'SERVER_RESTARTING', drainTimeoutMs: 1_000 },
        { sequence: ctx.nextSeq('hubToPeer') },
      );
      ctx.wire.hubEnd.send(goaway);
      await settle();
      await ctx.advance(1_000);
      await settle();
      await settle();

      expect(
        ctx.peer.getConnectionState(),
        'R8 前置：peer 进入 draining（drain 窗口收口）',
      ).toBe('draining');
      const aborted = eventsOf(ctx.peerRec, 'chunked-snapshot-aborted');
      expect(
        aborted,
        'GOAWAY drain 丢弃 partial kind=1 assembly 必须发射恰一次 chunked-snapshot-aborted（映射 connection-teardown 行）',
      ).toHaveLength(1);
      expect(aborted[0]!.reason, 'R8：GOAWAY 无独立 reason，drain 收口归 connection-teardown 行').toBe(
        'connection-teardown',
      );
      expect(aborted[0]!.transferId).toBe(head.transferId);
      expect(aborted[0]!.receivedChunks).toBe(received.length);
      expect(aborted[0]!.receivedBytes).toBe(receivedBytes);
      expect(ctx.docPresent('peer', nsId), 'R8：零写入').toBe(false);
      expect(ctx.saveCount('peer', nsId), 'R8：零 durable 残留').toBe(savesBefore);
    } finally {
      await ctx.stop();
    }
  });

  // ────────────────── 负控 N1：kind=1 超时 → BOOTSTRAP_FAILED 族终局 ──────────────────

  it('负控 N1（AC1/AC2 已交付）：kind=1 尾部停滞超时 → BOOTSTRAP_FAILED 族终局 + namespace-failed{bootstrap-timeout} + 零 durable 残留', async () => {
    const ctx = await boot({ initialBlurb: BIG_SNAPSHOT, dropSnapshotLastChunk: true });
    try {
      const nsId = ctx.nsIds[0]!;
      await settle();
      expect(ctx.peer.getNamespaceState(nsId), 'N1 前置：bootstrapping').toBe('bootstrapping');
      const savesBefore = ctx.saveCount('peer', nsId);

      await ctx.advance(30_001);
      await settle();
      await ctx.advance(1_000);

      expect(ctx.peer.getNamespaceState(nsId), 'N1：snapshot 段超时 = terminal failed').toBe('failed');
      expect(ctx.codes('peerToHub'), 'N1：BOOTSTRAP_FAILED 语义族终局').toContain('BOOTSTRAP_FAILED');
      const failed = eventsOf(ctx.peerRec, 'namespace-failed');
      expect(failed, 'N1：恰一 failed 终态边沿').toHaveLength(1);
      expect(failed[0]!.cause, 'N1：bootstrap 段 assembly 超时归 bootstrap-timeout').toBe('bootstrap-timeout');
      expect(failed[0]!.timeoutMs, 'N1：携带到期的 assemblyTimeoutMs 上限读数').toBe(30_000);
      expect(ctx.docPresent('peer', nsId), 'N1：零写入').toBe(false);
      expect(ctx.saveCount('peer', nsId), 'N1：零 durable 残留').toBe(savesBefore);
      expect(
        eventsOf(ctx.peerRec, 'chunked-snapshot-applied'),
        'N1：终局失败族零成功型事件（与 aborted 互补不重复）',
      ).toHaveLength(0);
    } finally {
      await ctx.stop();
    }
  });

  // ────────────────── 负控 N2：kind=1 重复/错序 → SNAPSHOT_TRANSFER_VIOLATION ──────────────────

  it('负控 N2（AC1 已交付）：kind=1 重复首 chunk / 错序 chunk → SNAPSHOT_TRANSFER_VIOLATION + apply 前零写入', async () => {
    const cases = [
      { label: '重复（同 transferId 再发 chunkIndex=0）', second: { chunkIndex: 0, chunkCount: 2 } },
      { label: '错序（缺 chunkIndex=1 直达 2）', second: { chunkIndex: 2, chunkCount: 3 } },
    ] as const;
    const observed: Array<{ label: string; codes: string[]; state: string | undefined; doc: boolean }> = [];
    for (const c of cases) {
      const ctx = await boot({ initialBlurb: BIG_SNAPSHOT, blankPeerBootstrap: true });
      try {
        const nsId = ctx.nsIds[0]!;
        await settle();
        expect(ctx.peer.getNamespaceState(nsId), `${c.label}：前置 bootstrapping`).toBe('bootstrapping');
        const identity = await bootstrapOpenOkIdentity(ctx, nsId);
        const send = (chunkIndex: number, chunkCount: number): void => {
          const base = {
            kind: 'UPDATE_CHUNK' as const,
            transferKind: 1 as const,
            namespaceId: nsId,
            transferId: 21,
            chunkIndex,
            chunkCount,
            totalBytes: 16 * 1024,
            bytes: new Uint8Array(1024),
          };
          const crafted = encodeMessage(
            chunkIndex === 0
              ? { ...base, replicationId: identity.replicationId, replicationEpoch: identity.replicationEpoch }
              : base,
            { sequence: ctx.nextSeq('hubToPeer'), limits: { maxUpdateBytes: MAX_UPDATE_BYTES } },
          );
          ctx.wire.hubEnd.send(crafted);
        };
        send(0, c.second.chunkCount);
        await settle();
        send(c.second.chunkIndex, c.second.chunkCount);
        await settle();
        await settle();
        observed.push({
          label: c.label,
          codes: ctx.codes('peerToHub'),
          state: ctx.peer.getNamespaceState(nsId),
          doc: ctx.docPresent('peer', nsId),
        });
      } finally {
        await ctx.stop();
      }
    }
    for (const o of observed) {
      expect(o.codes, `${o.label}：必须映射 SNAPSHOT_TRANSFER_VIOLATION`).toContain(
        'SNAPSHOT_TRANSFER_VIOLATION',
      );
      expect(o.state, `${o.label}：terminal failed`).toBe('failed');
      expect(o.doc, `${o.label}：重组违例先于 apply——零写入`).toBe(false);
    }
  });

  // ────────────────── 负控 N3：kind=2 重复 chunk → SYNC_TRANSFER_VIOLATION ──────────────────

  it('负控 N3（AC1 已交付）：kind=2 重复 chunk（chunk1 原位改写为 chunk0）→ SYNC_TRANSFER_VIOLATION + 零 durable 残留', async () => {
    let first: ChunkMsg | undefined;
    const ctx = await boot({
      rewritePeerSend: (bytes) => {
        const decoded = decodeMessage(bytes, { selectedCapabilities: CAP_CHUNKED_UPDATE });
        const m = decoded.message;
        if (m.kind !== 'UPDATE_CHUNK' || m.transferKind !== 2) return bytes;
        if (m.chunkIndex === 0) {
          first = m;
          return bytes;
        }
        if (m.chunkIndex === 1 && first !== undefined) {
          return encodeMessage(
            { ...first, bytes: m.bytes },
            { sequence: decoded.header.sequence, limits: { maxUpdateBytes: MAX_UPDATE_BYTES } },
          );
        }
        return bytes;
      },
    });
    try {
      const nsId = ctx.nsIds[0]!;
      await settleUntil(() => ctx.peer.getNamespaceState(nsId) === 'live', 'peer live');
      const savesBefore = ctx.saveCount('hub', nsId);
      await ctx.write('peer', nsId, { blurb: BIG_DIFF });
      await settle();
      await settle();
      expect(first, 'N3 前置：真实 kind=2 transfer 已上 wire').toBeDefined();
      expect(ctx.codes('hubToPeer'), 'N3：跨帧重复 → SYNC_TRANSFER_VIOLATION').toContain(
        'SYNC_TRANSFER_VIOLATION',
      );
      expect(ctx.root('hub', nsId, 'blurb'), 'N3：hub 值不变（零部分导入）').not.toBe(BIG_DIFF);
      expect(ctx.saveCount('hub', nsId), 'N3：零 durable 残留').toBe(savesBefore);
    } finally {
      await ctx.stop();
    }
  });

  // ────────────────── 负控 N4：中途丢帧 → 连接级 SEQUENCE_VIOLATION ──────────────────

  it('负控 N4（AC1 已交付）：kind=2 中途 chunk 丢失（序列缺口）→ 连接级 SEQUENCE_VIOLATION + 零部分导入', async () => {
    const ctx = await boot({ dropSyncMiddleChunk: true });
    try {
      const nsId = ctx.nsIds[0]!;
      await settleUntil(() => ctx.peer.getNamespaceState(nsId) === 'live', 'peer live');
      const savesBefore = ctx.saveCount('hub', nsId);
      await ctx.write('peer', nsId, { blurb: BIG_DIFF });
      await settle();
      await settle();
      expect(
        ctx.codes('hubToPeer'),
        'N4：可靠有序 transport 下丢帧 = 序列缺口 → connection fatal SEQUENCE_VIOLATION（绝不静默部分导入）',
      ).toContain('SEQUENCE_VIOLATION');
      expect(ctx.root('hub', nsId, 'blurb'), 'N4：零部分导入').not.toBe(BIG_DIFF);
      expect(ctx.saveCount('hub', nsId), 'N4：零 durable 残留').toBe(savesBefore);
    } finally {
      await ctx.stop();
    }
  });

  // ────────────────── 负控 N5：恶意声明分配前拒绝 ──────────────────

  it('负控 N5（AC3 已交付）：恶意 totalBytes/chunkCount 声明在分配前拒绝（kind=1 count / kind=2 aggregate）→ 零写入', async () => {
    // (a) kind=1：chunkCount 超 maxChunksPerUpdate（65 > 64）→ SNAPSHOT_TRANSFER_TOO_LARGE
    const boot1 = await boot({ initialBlurb: BIG_SNAPSHOT, blankPeerBootstrap: true });
    try {
      const nsId = boot1.nsIds[0]!;
      await settle();
      const identity = await bootstrapOpenOkIdentity(boot1, nsId);
      boot1.wire.hubEnd.send(
        encodeMessage(
          {
            kind: 'UPDATE_CHUNK',
            transferKind: 1,
            namespaceId: nsId,
            transferId: 31,
            chunkIndex: 0,
            chunkCount: 65,
            totalBytes: 1024,
            replicationId: identity.replicationId,
            replicationEpoch: identity.replicationEpoch,
            bytes: new Uint8Array(1024),
          },
          { sequence: boot1.nextSeq('hubToPeer'), limits: { maxUpdateBytes: MAX_UPDATE_BYTES } },
        ),
      );
      await settle();
      await settle();
      expect(boot1.codes('peerToHub'), '(a)：声明超计数上界必须映射 SNAPSHOT_TRANSFER_TOO_LARGE').toContain(
        'SNAPSHOT_TRANSFER_TOO_LARGE',
      );
      expect(boot1.docPresent('peer', nsId), '(a)：分配前拒绝——零写入').toBe(false);
    } finally {
      await boot1.stop();
    }

    // (b) kind=2：chunk0 声明 totalBytes=1MiB > maxChunkedSyncDiffBytes 512KiB → SYNC_TRANSFER_TOO_LARGE
    let round: number | undefined;
    const boot2 = await boot({
      rewritePeerSend: (bytes) => {
        const decoded = decodeMessage(bytes, { selectedCapabilities: CAP_CHUNKED_UPDATE });
        const m = decoded.message;
        if (m.kind !== 'UPDATE_CHUNK' || m.transferKind !== 2 || m.chunkIndex !== 0) return bytes;
        round = m.syncRoundId;
        return encodeMessage(
          { ...m, chunkCount: 64, totalBytes: 1024 * 1024 },
          { sequence: decoded.header.sequence, limits: { maxUpdateBytes: MAX_UPDATE_BYTES } },
        );
      },
    });
    try {
      const nsId = boot2.nsIds[0]!;
      await settleUntil(() => boot2.peer.getNamespaceState(nsId) === 'live', 'peer live');
      const savesBefore = boot2.saveCount('hub', nsId);
      await boot2.write('peer', nsId, { blurb: BIG_DIFF });
      await settle();
      await settle();
      expect(round, '(b) 前置：真实 kind=2 transfer 已上 wire').toBeDefined();
      expect(boot2.codes('hubToPeer'), '(b)：声明超聚合上界必须映射 SYNC_TRANSFER_TOO_LARGE').toContain(
        'SYNC_TRANSFER_TOO_LARGE',
      );
      expect(boot2.root('hub', nsId, 'blurb'), '(b)：分配前拒绝——零写入').not.toBe(BIG_DIFF);
      expect(boot2.saveCount('hub', nsId), '(b)：零 durable 残留').toBe(savesBefore);
    } finally {
      await boot2.stop();
    }
  });

  // ────────────────── 负控 N6：单帧路径普通族锚（触发条件，非兼容回落） ──────────────────

  it('负控 N6（AC5 改道条件）：未超单帧上限的 snapshot/diff 仍走单帧普通族（bootstrap-snapshot-sent / bootstrap-imported / sync-step2-sent / sync-diff-applied），零 chunked 事件', async () => {
    const ctx = await boot({
      initialBlurb: 's'.repeat(2_000),
      limits: { ...LIMITS, maxChunkedUpdateBytes: 4 * 1024 },
      clock: true,
    });
    try {
      const nsId = ctx.nsIds[0]!;
      await settleUntil(() => ctx.peer.getNamespaceState(nsId) === 'live', '单帧 snapshot 收敛');
      await settle();
      expect(onlyKind(ctx.frames('hubToPeer'), 'BOOTSTRAP_SNAPSHOT'), '单帧 snapshot').toHaveLength(1);
      expect(ctx.chunks('hubToPeer'), '单帧路径零 chunk').toHaveLength(0);
      expect(eventsOf(ctx.hubRec, 'bootstrap-snapshot-sent'), '单帧路径普通族 sent 照常').toHaveLength(1);
      expect(eventsOf(ctx.peerRec, 'bootstrap-imported'), '单帧路径普通族 imported 照常').toHaveLength(1);

      const peerSentBefore = eventsOf(ctx.peerRec, 'sync-step2-sent').length;
      const hubAppliedBefore = eventsOf(ctx.hubRec, 'sync-diff-applied').length;
      await ctx.write('peer', nsId, { blurb: MEDIUM_DIFF });
      await settleUntil(() => ctx.root('hub', nsId, 'blurb') === MEDIUM_DIFF, '单帧恢复 diff 收敛');
      await settle();
      expect(eventsOf(ctx.peerRec, 'sync-step2-sent').length - peerSentBefore, '单帧 diff → sync-step2-sent').toBe(1);
      expect(eventsOf(ctx.hubRec, 'sync-diff-applied').length - hubAppliedBefore, '单帧 diff → sync-diff-applied').toBe(1);
      expect(
        ctx.chunks('peerToHub'),
        '未超 maxSyncDiffBytes 的恢复 diff 不得改道分块（零 kind=2 chunk）',
      ).toHaveLength(0);
      const chunkedSnapshotTypes = eventTypes(ctx.hubRec).filter((t) => t.startsWith('chunked-snapshot-'));
      expect(chunkedSnapshotTypes, '单帧路径零 chunked-snapshot-* 事件').toEqual([]);
      expect(
        eventTypes(ctx.peerRec).filter((t) => t.startsWith('chunked-sync-')).length +
          eventTypes(ctx.hubRec).filter((t) => t.startsWith('chunked-sync-')).length,
        '单帧路径零 chunked-sync-* 事件',
      ).toBe(0);
    } finally {
      await ctx.stop();
    }
  });

  // ────────────────── 负控 N7：无 observer / observer 全 throw 行为等价 ──────────────────

  it('负控 N7（AC5/§23.4）：observer 全 throw 与无 observer 基线 wire/值逐字节等价；无 observer 零事件', async () => {
    const throwing: ReplicationObserver = () => {
      throw new Error('observer boom');
    };
    let wireA: string[] = [];
    const withThrow = await boot({
      initialBlurb: BIG_SNAPSHOT,
      hubRec: { events: [], observer: throwing },
      peerRec: { events: [], observer: throwing },
    });
    try {
      const nsId = withThrow.nsIds[0]!;
      await settleUntil(() => withThrow.peer.getNamespaceState(nsId) === 'live', 'throw-observer live');
      await settle();
      wireA = withThrow.frames('hubToPeer').map((f) => `${f.message.kind}#${f.header.sequence}`);
    } finally {
      await withThrow.stop();
    }

    const noObserver = await boot({ initialBlurb: BIG_SNAPSHOT, noObserver: true });
    try {
      const nsId = noObserver.nsIds[0]!;
      await settleUntil(() => noObserver.peer.getNamespaceState(nsId) === 'live', 'no-observer live');
      await settle();
      const wireB = noObserver.frames('hubToPeer').map((f) => `${f.message.kind}#${f.header.sequence}`);
      expect(wireA.length, 'N7 前置：chunked snapshot 帧序列非空').toBeGreaterThan(0);
      expect(wireB, 'N7：observer 缺省/全 throw 不得改变 wire 帧序列（逐字节等价）').toEqual(wireA);
      expect(noObserver.root('hub', nsId, 'blurb')).toBe(BIG_SNAPSHOT);
      expect(noObserver.root('peer', nsId, 'blurb')).toBe(BIG_SNAPSHOT);
      expect(noObserver.hubRec.events.length + noObserver.peerRec.events.length, 'N7：无 observer 零事件').toBe(0);
    } finally {
      await noObserver.stop();
    }
  });

  // ────────────────── 负控 N8：多 namespace 复用/公平 + control reserve ──────────────────

  it('负控 N8（AC4 已交付）：双 namespace 分块 snapshot 同连接复用并全部收敛；data 闸门关闭期 control 帧照常、零 chunk', async () => {
    const ctx = await boot({
      initialBlurb: BIG_SNAPSHOT,
      namespaces: 2,
      pauseHubDataAtStart: true,
    });
    try {
      const [nsA, nsB] = [ctx.nsIds[0]!, ctx.nsIds[1]!];
      expect(nsA, 'N8 前置：两个 namespace').not.toBe(nsB);
      await settleUntil(
        () =>
          ctx.frames('hubToPeer').filter((f) => f.message.kind === 'OPEN_OK').length >= 2,
        '双 ns OPEN_OK 控制帧穿透 data 压力（control reserve 独立）',
      );
      expect(ctx.chunks('hubToPeer'), 'N8：data 闸门关闭期零 chunk 出站').toHaveLength(0);
      expect(ctx.peer.getNamespaceState(nsA), 'N8：闸门关闭期 A 非 failed').not.toBe('failed');
      expect(ctx.peer.getNamespaceState(nsB), 'N8：闸门关闭期 B 非 failed').not.toBe('failed');

      ctx.releaseHubData();
      await ctx.advance(1_000);
      await settleUntil(
        () =>
          ctx.peer.getNamespaceState(nsA) === 'live' &&
          ctx.peer.getNamespaceState(nsB) === 'live' &&
          ctx.root('peer', nsA, 'blurb') === BIG_SNAPSHOT &&
          ctx.root('peer', nsB, 'blurb') === BIG_SNAPSHOT,
        '双 ns 分块 snapshot 全部收敛（公平调度无饿死）',
      );
      const chunksA = ctx.chunksOf('hubToPeer', nsA);
      const chunksB = ctx.chunksOf('hubToPeer', nsB);
      expectWellFormedTransfer(chunksA, 'N8 nsA kind=1 transfer');
      expectWellFormedTransfer(chunksB, 'N8 nsB kind=1 transfer');
      expect(ctx.peer.getConnectionState(), 'N8：单连接复用').toBe('ready');
    } finally {
      await ctx.stop();
    }
  });

  // ────────────────── 负控 N9：epoch fence 丢弃 partial assembly（效果面） ──────────────────

  it('负控 N9（AC1 已交付）：epoch fence 下 partial kind=1 assembly 全部丢弃、零 durable 残留、终态非 live', async () => {
    const ctx = await boot({ initialBlurb: BIG_SNAPSHOT, dropSnapshotLastChunk: true });
    try {
      const nsId = ctx.nsIds[0]!;
      await settle();
      expect(ctx.peer.getNamespaceState(nsId), 'N9 前置：bootstrapping + partial assembly').toBe(
        'bootstrapping',
      );
      expect(ctx.chunksOf('hubToPeer', nsId).length, 'N9 前置：已收 ≥1 chunk').toBeGreaterThanOrEqual(1);
      const savesBefore = ctx.saveCount('peer', nsId);

      await ctx.bumpHubEpoch();
      await settle();
      await settle();

      expect(
        ctx.frames('hubToPeer').some((f) => f.message.kind === 'IDENTITY_CHANGED'),
        'N9 前置：fence 帧已上 wire',
      ).toBe(true);
      expect(
        ['conflicted', 'disconnected'].includes(String(ctx.peer.getNamespaceState(nsId))),
        `N9：fence 后 peer 必须离开 bootstrapping（conflicted/disconnected；当前 ${String(ctx.peer.getNamespaceState(nsId))}）`,
      ).toBe(true);
      expect(ctx.docPresent('peer', nsId), 'N9：partial 全部丢弃——零写入').toBe(false);
      expect(ctx.saveCount('peer', nsId), 'N9：零 durable 残留').toBe(savesBefore);
      expect(
        eventsOf(ctx.peerRec, 'chunked-snapshot-applied'),
        'N9：fence 丢弃的 transfer 零成功型事件',
      ).toHaveLength(0);
    } finally {
      await ctx.stop();
    }
  });
});
