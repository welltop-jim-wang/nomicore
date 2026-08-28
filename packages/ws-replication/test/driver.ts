/**
 * SA6 测试驱动器 —— issue #136 切片 6（`@nomicore/ws-replication` namespace 状态机）。
 *
 * 组装真实双实例（各自 Registry/Runtime/Persistence-stub + 真实 Y.Doc），经 fake-duplex
 * 内存双端连接，驱动 wire 层协议状态机。驱动只做编排与观测，不实现任何协议行为；
 * 契约面以 `@nomicore/ws-replication`（SA6 冻结，见任务简报）为准。
 */
import { createHubReplication, createPeerReplication } from '@nomicore/ws-replication';
import type {
  DuplexTransport,
  HubReplication,
  NamespaceAuthorizer,
  PeerConnectionState,
  PeerNamespaceState,
  PeerReplication,
  ReplicationLimits,
  ReplicationTarget,
  ReplicationTimeouts,
  ReplicationBackoff,
} from '@nomicore/ws-replication';
import type { NamespaceOwner } from '@nomicore/namespace-registry';
import {
  decodeMessage,
  encodeMessage,
  type DecodedMessage,
  type ReplicationMessage,
} from '@nomicore/replication-protocol';
import {
  type HubNamespaceFixture,
  HUB_INSTANCE,
  HUB_OWNER,
  PEER_INSTANCE,
  PEER_OWNER,
  makeHubNamespace,
  makeNode,
  makePeerReplica,
  makeSeedDoc,
  makeWire,
  okLease,
  type ReplicaNode,
  schemaReady,
  settle,
  settleUntil,
  type StubPersistence,
  type Wire,
} from './harness.js';

// ═══════════════════════════ 授权 spy ═══════════════════════════

export interface AuthorizerSpy {
  readonly authorize: NamespaceAuthorizer;
  readonly calls: Array<Readonly<{ instanceIdentity: string; namespaceId: string }>>;
  readonly results: Array<Readonly<{ granted: boolean }>>;
}

export interface AuthorizerSpec {
  /** 这些 namespaceId 拒绝（denied）。 */
  readonly deny?: readonly string[];
  /** 这些 namespaceId 读权限 false。 */
  readonly readDeny?: readonly string[];
  /** 这些 namespaceId 提交权限 false。 */
  readonly submitDeny?: readonly string[];
  /** 授权允许时返回的本地 owner（缺省 HUB_OWNER——须与 hub entry owner 一致）。 */
  readonly localOwner?: NamespaceOwner;
}

export function makeAuthorizer(spec: AuthorizerSpec = {}): AuthorizerSpy {
  const calls: Array<Readonly<{ instanceIdentity: string; namespaceId: string }>> = [];
  const results: Array<Readonly<{ granted: boolean }>> = [];
  const matches = (list: readonly string[] | undefined, namespaceId: string): boolean =>
    list !== undefined && list.some((x) => x === '*' || x === namespaceId);
  const authorize: NamespaceAuthorizer = async (instanceIdentity, namespaceId) => {
    calls.push({ instanceIdentity, namespaceId });
    const denied = matches(spec.deny, namespaceId);
    const readDenied = matches(spec.readDeny, namespaceId);
    const submitDenied = matches(spec.submitDeny, namespaceId);
    results.push({ granted: !denied });
    if (denied || readDenied) return { ok: false };
    return {
      ok: true,
      localOwner: spec.localOwner ?? HUB_OWNER,
      permissions: { read: true, submit: !submitDenied },
    };
  };
  return { authorize, calls, results };
}

function spyOfAuthorizer(fn: NamespaceAuthorizer): AuthorizerSpy {
  const calls: Array<Readonly<{ instanceIdentity: string; namespaceId: string }>> = [];
  const results: Array<Readonly<{ granted: boolean }>> = [];
  return {
    authorize: async (instanceIdentity, namespaceId) => {
      calls.push({ instanceIdentity, namespaceId });
      const result = await fn(instanceIdentity, namespaceId);
      results.push({ granted: 'ok' in result ? result.ok : false });
      return result;
    },
    calls,
    results,
  };
}

// ═══════════════════════════ 驱动成员 ═══════════════════════════

export interface BootOptions {
  readonly authorize?: AuthorizerSpec | NamespaceAuthorizer;
  /** Hub namespace root（默认 { n: 42, extra: 77 }；extra 键为确定性合并锚点）。 */
  readonly hubRoot?: Readonly<{ n: number; extra?: number }>;
  readonly hubEnabled?: boolean;
  /** 是否创建 hub namespace（缺省 true；missing 场景 false + 显式 nsId）。 */
  readonly hubNamespace?: boolean;
  readonly namespaceId?: string;
  /** peer 本地预置副本（reconcile 前置）：'none' | 'same'(hub 身份) | 显式身份（缺省字段取 hub 身份）。 */
  readonly peerReplica?:
    | 'none'
    | 'same'
    | Readonly<{
        replicationId?: string;
        replicationEpoch?: number;
        rootN?: number;
        ext?: number;
      }>;
  readonly limits?: Readonly<Partial<ReplicationLimits>>;
  readonly timeouts?: Readonly<Partial<ReplicationTimeouts>>;
  readonly backoff?: Readonly<Partial<ReplicationBackoff>>;
  readonly random?: () => number;
  /** 缺省 true：peer.start + 等待 connection ready。 */
  readonly start?: boolean;
  /** ready 后等待的 namespace 状态（缺省 'live'；'handshake' 只等 connection；'none' 不等）。 */
  readonly waitFor?: PeerNamespaceState | 'handshake' | 'none';
}

export class Run {
  readonly hubNode: ReplicaNode;
  readonly peerNode: ReplicaNode;
  readonly hub: HubReplication;
  readonly peer: PeerReplication;
  readonly authorizer: AuthorizerSpy;
  readonly wires: Wire[] = [];
  readonly hubFixture: HubNamespaceFixture | undefined;
  readonly nsId: string;
  readonly target: ReplicationTarget;
  readonly hubRoot: Readonly<{ n: number; extra?: number }>;
  dialCount = 0;

  constructor(
    hubNode: ReplicaNode,
    peerNode: ReplicaNode,
    hub: HubReplication,
    peer: PeerReplication,
    authorizer: AuthorizerSpy,
    hubFixture: HubNamespaceFixture | undefined,
    nsId: string,
    hubRoot: Readonly<{ n: number; extra?: number }>,
  ) {
    this.hubNode = hubNode;
    this.peerNode = peerNode;
    this.hub = hub;
    this.peer = peer;
    this.authorizer = authorizer;
    this.hubFixture = hubFixture;
    this.nsId = nsId;
    this.hubRoot = hubRoot;
    this.target = { namespaceId: nsId, localOwner: PEER_OWNER };
  }

  get wire(): Wire {
    const w = this.wires[this.wires.length - 1];
    if (w === undefined) throw new Error('尚无 wire（peer 尚未拨号）');
    return w;
  }

  peerPersistence(): StubPersistence {
    return this.peerNode.persistence;
  }

  hubPersistence(): StubPersistence {
    return this.hubNode.persistence;
  }

  connectionState(): PeerConnectionState {
    return this.peer.getConnectionState();
  }

  namespaceState(): PeerNamespaceState | undefined {
    return this.peer.getNamespaceState(this.nsId);
  }

  frames(): Readonly<{ peerToHub: DecodedMessage[]; hubToPeer: DecodedMessage[] }> {
    return {
      peerToHub: this.wire.peerToHub.map((b) => decodeMessage(b)),
      hubToPeer: this.wire.hubToPeer.map((b) => decodeMessage(b)),
    };
  }

  /** 全部连接线（含重连后的）每一方向的帧，按连接序。 */
  allFrames(): Readonly<{ peerToHub: DecodedMessage[]; hubToPeer: DecodedMessage[] }> {
    const peerToHub: DecodedMessage[] = [];
    const hubToPeer: DecodedMessage[] = [];
    for (const wire of this.wires) {
      peerToHub.push(...wire.peerToHub.map((b) => decodeMessage(b)));
      hubToPeer.push(...wire.hubToPeer.map((b) => decodeMessage(b)));
    }
    return { peerToHub, hubToPeer };
  }

  /** 被故障注入丢弃的帧（发送方已发出、未到达对端）。 */
  droppedFrames(): Readonly<{ peerToHub: DecodedMessage[]; hubToPeer: DecodedMessage[] }> {
    return {
      peerToHub: this.wire.droppedPeerToHub.map((b) => decodeMessage(b)),
      hubToPeer: this.wire.droppedHubToPeer.map((b) => decodeMessage(b)),
    };
  }

  /** 跨方向统一发送时序（全部连接按连接序拼接；含被丢帧）。 */
  timeline(): ReadonlyArray<Readonly<{ direction: 'peer-to-hub' | 'hub-to-peer'; bytes: Uint8Array }>> {
    const out: Array<Readonly<{ direction: 'peer-to-hub' | 'hub-to-peer'; bytes: Uint8Array }>> = [];
    for (const wire of this.wires) out.push(...wire.timeline);
    return out;
  }

  peerFrames(kind: DecodedMessage['message']['kind']): DecodedMessage[] {
    return this.frames().peerToHub.filter((f) => f.message.kind === kind);
  }

  hubFrames(kind: DecodedMessage['message']['kind']): DecodedMessage[] {
    return this.frames().hubToPeer.filter((f) => f.message.kind === kind);
  }

  peerFramesAll(kind: DecodedMessage['message']['kind']): DecodedMessage[] {
    return this.allFrames().peerToHub.filter((f) => f.message.kind === kind);
  }

  hubFramesAll(kind: DecodedMessage['message']['kind']): DecodedMessage[] {
    return this.allFrames().hubToPeer.filter((f) => f.message.kind === kind);
  }

  async waitNamespace(states: readonly PeerNamespaceState[] | PeerNamespaceState): Promise<void> {
    const wanted = Array.isArray(states) ? states : [states];
    await settleUntil(
      () => {
        const s = this.namespaceState();
        return s !== undefined && wanted.includes(s);
      },
      `namespace 状态 ∈ [${wanted.join('|')}]，当前 ${String(this.namespaceState())}`,
    );
  }

  async waitConnection(state: PeerConnectionState): Promise<void> {
    await settleUntil(
      () => this.connectionState() === state,
      `connection 状态 = ${state}，当前 ${this.connectionState()}`,
    );
  }

  /** 等待某方向指定 kind 的帧数达到 count（故障注入的确定性同步点）。 */
  async waitPeerSent(kind: DecodedMessage['message']['kind'], count = 1): Promise<void> {
    await settleUntil(
      () => this.peerFramesAll(kind).length >= count,
      `等待 peer 发送 ${kind}×${count}，当前 ${this.peerFramesAll(kind).length}`,
    );
  }

  async waitHubSent(kind: DecodedMessage['message']['kind'], count = 1): Promise<void> {
    await settleUntil(
      () => this.hubFramesAll(kind).length >= count,
      `等待 hub 发送 ${kind}×${count}，当前 ${this.hubFramesAll(kind).length}`,
    );
  }

  /** 当前连接上该方向的下一个期望序列（= 已见最大 + 1；用于手工注入帧）。 */
  nextPeerSeq(): number {
    return nextSeqOf(this.allFrames().peerToHub);
  }

  nextHubSeq(): number {
    return nextSeqOf(this.allFrames().hubToPeer);
  }

  /** 手工注入一帧到 hub（沿 peer→hub 方向；调用方负责在 peer 静默期注入）。 */
  injectPeer(message: ReplicationMessage): void {
    this.wire.peerEnd.send(encodeMessage(message, { sequence: this.nextPeerSeq() }));
  }

  /** 手工注入一帧到 peer（沿 hub→peer 方向；调用方负责在 hub 静默期注入）。 */
  injectHub(message: ReplicationMessage): void {
    this.wire.hubEnd.send(encodeMessage(message, { sequence: this.nextHubSeq() }));
  }

  /** 丢弃下一个指定 kind 的 hub→peer 帧（故障注入）。 */
  dropNextHubFrame(kind: DecodedMessage['message']['kind']): void {
    this.wire.dropNextHubToPeer((bytes) => decodeMessage(bytes).message.kind === kind);
  }

  /** 丢弃下一个指定 kind 的 peer→hub 帧（故障注入）。 */
  dropNextPeerFrame(kind: DecodedMessage['message']['kind']): void {
    this.wire.dropNextPeerToHub((bytes) => decodeMessage(bytes).message.kind === kind);
  }

  /** peer 侧业务写（独立 business lease；非复制 lease）。 */
  async writePeer(update: Readonly<{ n?: number; ext?: number; extra?: number }>): Promise<void> {
    const lease = okLease(await this.peerNode.registry.open(PEER_OWNER, this.nsId));
    await schemaReady(lease);
    for (const [key, value] of Object.entries(update)) {
      const result = await lease.mutateRoot({ op: 'set', path: [key], value });
      if (!result.ok) throw new Error(`peer 业务写失败：${JSON.stringify(result)}`);
    }
    await lease.release();
  }

  /** hub 侧业务写（fixture create lease；非复制 lease）。 */
  async writeHub(update: Readonly<{ n?: number; extra?: number }>): Promise<void> {
    const lease = this.hubFixture?.lease;
    if (lease === undefined) throw new Error('无 hub fixture lease');
    for (const [key, value] of Object.entries(update)) {
      const result = await lease.mutateRoot({ op: 'set', path: [key], value });
      if (!result.ok) throw new Error(`hub 业务写失败：${JSON.stringify(result)}`);
    }
    await settle();
  }

  private doc(side: 'hub' | 'peer'): import('yjs').Doc {
    const node = side === 'hub' ? this.hubNode : this.peerNode;
    const owner = side === 'hub' ? (this.hubFixture?.lease.owner as NamespaceOwner) : PEER_OWNER;
    const doc = node.persistence.peek(owner, this.nsId);
    if (doc === undefined) throw new Error(`${side} 持久化缺副本`);
    return doc;
  }

  rootValue(side: 'hub' | 'peer', key: string): unknown {
    return (this.doc(side).getMap('ROOT') as unknown as Map<string, unknown>).get(key);
  }

  metaValue(side: 'hub' | 'peer', key: string): unknown {
    return (this.doc(side).getMap('META') as unknown as Map<string, unknown>).get(key);
  }

  saveEvents(side: 'hub' | 'peer'): number {
    return (side === 'hub' ? this.hubNode.persistence : this.peerNode.persistence).saveEvents.length;
  }

  /** 该侧已持久化 live doc 的克隆（真实 Y.Doc 拷贝；供测试构造 diff/断言）。 */
  snapshotDoc(side: 'hub' | 'peer'): import('yjs').Doc {
    const doc = this.doc(side);
    const clone = new (requireYjs().Doc)();
    requireYjs().applyUpdate(clone, requireYjs().encodeStateAsUpdate(doc));
    return clone;
  }

  /** 以该侧当前状态为基准构造 diff update（模拟一侧的新提交）。 */
  buildUpdateFrom(
    side: 'hub' | 'peer',
    mutate: (doc: import('yjs').Doc) => void,
  ): Uint8Array {
    const y = requireYjs();
    const base = this.snapshotDoc(side);
    const sv = y.encodeStateVector(base);
    mutate(base);
    return y.encodeStateAsUpdate(base, sv);
  }

  stateVectorOf(side: 'hub' | 'peer'): Uint8Array {
    return requireYjs().encodeStateVector(this.doc(side));
  }

  /** hub 侧 epoch bump（经 fixture lease——同一 runtime 的复制管理写）。 */
  async bumpHubEpoch(): Promise<void> {
    const lease = this.hubFixture?.lease;
    if (lease === undefined) throw new Error('无 hub fixture lease');
    const result = await lease.bumpReplicationEpoch();
    if (!result.ok) throw new Error(`bumpReplicationEpoch 失败：${JSON.stringify(result)}`);
    await settle();
  }

  /** 把该侧 handle 状态切到 persistence-degraded（hub/peer degraded 锚）。 */
  setDegraded(side: 'hub' | 'peer', degraded: boolean): void {
    const node = side === 'hub' ? this.hubNode : this.peerNode;
    const owner = side === 'hub' ? (this.hubFixture?.lease.owner as NamespaceOwner) : PEER_OWNER;
    node.persistence.setStatus(owner, this.nsId, degraded ? 'persistence-degraded' : 'ready');
  }
}

// ═══════════════════════════ 组装与启动 ═══════════════════════════

export async function boot(opts: BootOptions = {}): Promise<Run> {
  const hubNode = makeNode('hub');
  const peerNode = makeNode('peer');
  const authorizer =
    opts.authorize !== undefined && typeof opts.authorize === 'function'
      ? spyOfAuthorizer(opts.authorize)
      : makeAuthorizer(opts.authorize as AuthorizerSpec | undefined);
  const hubRoot = opts.hubRoot ?? { n: 42, extra: 77 };

  const hubFixture =
    opts.hubNamespace === false
      ? undefined
      : await makeHubNamespace(hubNode, {
          owner: authorizerSpecOwner(opts),
          enabled: opts.hubEnabled ?? true,
          root: hubRoot,
        });
  const nsId =
    opts.namespaceId ?? (hubFixture !== undefined ? hubFixture.namespaceId : 'ns-' + '0'.repeat(32));

  // —— hub 面（先建：dial 回调需要它 accept 新连接） ——
  const hub = createHubReplication({
    instanceId: HUB_INSTANCE,
    registry: hubNode.registry,
    authorize: authorizer.authorize,
    timer: hubNode.scheduler,
    ...(opts.limits !== undefined ? { limits: opts.limits } : {}),
    ...(opts.timeouts !== undefined ? { timeouts: opts.timeouts } : {}),
  });

  const wires: Wire[] = [];
  let dialCount = 0;
  const dial = (): DuplexTransport => {
    dialCount += 1;
    const wire = makeWire();
    wires.push(wire);
    hub.accept(wire.hubEnd);
    return wire.peerEnd;
  };

  const peer = createPeerReplication({
    instanceId: PEER_INSTANCE,
    hubInstanceId: HUB_INSTANCE,
    registry: peerNode.registry,
    dial,
    timer: peerNode.scheduler,
    targets: [{ namespaceId: nsId, localOwner: PEER_OWNER }],
    ...(opts.limits !== undefined ? { limits: opts.limits } : {}),
    ...(opts.timeouts !== undefined ? { timeouts: opts.timeouts } : {}),
    ...(opts.backoff !== undefined ? { backoff: opts.backoff } : {}),
    ...(opts.random !== undefined ? { random: opts.random } : {}),
  });

  const run = new Run(hubNode, peerNode, hub, peer, authorizer, hubFixture, nsId, hubRoot);
  // dial 闭包内 push 的 wires 与拨号计数与 Run 同步
  Object.defineProperty(run, 'wires', { value: wires });
  Object.defineProperty(run, 'dialCount', { get: () => dialCount });

  // —— peer 预置副本（reconcile 前置） ——
  const peerReplica = opts.peerReplica ?? 'none';
  if (peerReplica !== 'none' && hubFixture !== undefined) {
    const rid: string =
      peerReplica === 'same'
        ? hubFixture.identity.replicationId
        : peerReplica.replicationId ?? hubFixture.identity.replicationId;
    const rep: number =
      peerReplica === 'same'
        ? hubFixture.identity.replicationEpoch
        : peerReplica.replicationEpoch ?? hubFixture.identity.replicationEpoch;
    const identity = { replicationId: rid, replicationEpoch: rep };
    // 以 Hub 实况快照为基底构造 peer 副本（struct 同源——reconcile diff 只含增量；
    // 「空 diff」用例断言 ≤4 字节要求 struct 一致，纯 makeSeedDoc 会产生全量 diff），
    // 再按 peerReplica 施用身份/root 增量（rootN 与 hub 相等时零变更 → 空 diff）。
    const hubDocRef = hubNode.persistence.peek(authorizerSpecOwner(opts), nsId);
    if (hubDocRef === undefined) throw new Error('hub 文档缺失，无法构造 peer 副本基底');
    const y = requireYjs();
    const seed = new y.Doc();
    y.applyUpdate(seed, y.encodeStateAsUpdate(hubDocRef));
    const seedMeta = seed.getMap('META') as unknown as Map<string, unknown>;
    if (seedMeta.get('replicationId') !== rid) seedMeta.set('replicationId', rid);
    if (seedMeta.get('replicationEpoch') !== rep) seedMeta.set('replicationEpoch', rep);
    const seedRoot = seed.getMap('ROOT') as unknown as Map<string, unknown>;
    const desiredN = peerReplica === 'same' ? 5 : peerReplica.rootN;
    if (desiredN !== undefined && (peerReplica === 'same' || desiredN !== hubRoot.n)) {
      seedRoot.set('n', desiredN);
    }
    if (peerReplica !== 'same' && peerReplica.ext !== undefined) {
      seedRoot.set('ext', peerReplica.ext);
    }
    const lease = await makePeerReplica(peerNode, PEER_OWNER, nsId, seed, identity);
    await schemaReady(lease);
  }

  if (opts.start === false) return run;
  peer.start();
  await run.waitConnection('ready');
  const waitFor = opts.waitFor ?? 'live';
  if (waitFor === 'handshake') return run;
  if (waitFor !== 'none') await run.waitNamespace(waitFor);
  return run;
}

function authorizerSpecOwner(opts: BootOptions): NamespaceOwner {
  const spec = opts.authorize;
  if (spec !== undefined && typeof spec !== 'function' && spec.localOwner !== undefined) {
    return spec.localOwner;
  }
  return HUB_OWNER;
}

/** 推进共享 fake scheduler——时间全虚拟，零 real sleep。 */
export async function advanceMs(run: Run, ms: number): Promise<void> {
  await run.peerNode.scheduler.advanceBy(ms);
  await settle();
}

/** 未处理 rejection 探针（设计 R4/N-1「零 unhandled rejection」断言面）。
 *  注册 process 级监听；测试结束 dispose 后断言 events 为空。 */
export function collectUnhandledRejections(): Readonly<{
  readonly events: unknown[];
  dispose(): void;
}> {
  const events: unknown[] = [];
  const listener = (reason: unknown): void => {
    events.push(reason);
  };
  process.on('unhandledRejection', listener);
  return {
    events,
    dispose: () => {
      process.off('unhandledRejection', listener);
    },
  };
}

function nextSeqOf(frames: DecodedMessage[]): number {
  let max = 0;
  for (const f of frames) max = Math.max(max, f.header.sequence);
  return max + 1;
}

// yjs 延迟引用（避免与 harness 顶层 import 的循环歧义）
import * as yjsModule from 'yjs';
function requireYjs(): typeof import('yjs') {
  return yjsModule;
}

// ═══════════════════════════ 双 peer fan-out 运行 ═══════════════════════════

export interface FanoutRun {
  readonly hubNode: ReplicaNode;
  readonly hub: HubReplication;
  readonly hubFixture: HubNamespaceFixture;
  readonly nsId: string;
  readonly peerA: PeerReplication;
  readonly peerB: PeerReplication;
  readonly peerANode: ReplicaNode;
  readonly peerBNode: ReplicaNode;
  readonly wireA: Wire;
  readonly wireB: Wire;
  readonly authorizer: AuthorizerSpy;
}

/** Hub + 两个 peer（互不共享 Persistence），全部 bootstrap 到 live。 */
export async function bootFanout(opts: BootOptions = {}): Promise<FanoutRun> {
  const hubNode = makeNode('hub');
  const peerANode = makeNode('peer');
  const peerBNode = makeNode('peer');
  const authorizer = makeAuthorizer(opts.authorize as AuthorizerSpec | undefined);
  const hubRoot = opts.hubRoot ?? { n: 42, extra: 77 };
  const hubFixture = await makeHubNamespace(hubNode, {
    owner: authorizerSpecOwner(opts),
    enabled: opts.hubEnabled ?? true,
    root: hubRoot,
  });
  const nsId = hubFixture.namespaceId;

  const hub = createHubReplication({
    instanceId: HUB_INSTANCE,
    registry: hubNode.registry,
    authorize: authorizer.authorize,
    timer: hubNode.scheduler,
  });

  const makePeer = (peerNode: ReplicaNode): { peer: PeerReplication; wire: Wire } => {
    const wireRef = { current: undefined as Wire | undefined };
    const peer = createPeerReplication({
      instanceId: PEER_INSTANCE,
      hubInstanceId: HUB_INSTANCE,
      registry: peerNode.registry,
      dial: () => {
        const wire = makeWire();
        wireRef.current = wire;
        hub.accept(wire.hubEnd);
        return wire.peerEnd;
      },
      timer: peerNode.scheduler,
      targets: [{ namespaceId: nsId, localOwner: PEER_OWNER }],
    });
    return {
      peer,
      get wire(): Wire {
        if (wireRef.current === undefined) throw new Error('peer 尚未拨号');
        return wireRef.current;
      },
    };
  };

  const a = makePeer(peerANode);
  const b = makePeer(peerBNode);
  a.peer.start();
  b.peer.start();
  await settleUntil(
    () => a.peer.getNamespaceState(nsId) === 'live' && b.peer.getNamespaceState(nsId) === 'live',
    '两个 peer 都进入 live',
  );
  return {
    hubNode,
    hub,
    hubFixture,
    nsId,
    peerA: a.peer,
    peerB: b.peer,
    peerANode,
    peerBNode,
    wireA: a.wire,
    wireB: b.wire,
    authorizer,
  };
}

/** 排空一轮微任务（wire/registry/pump 全收口）。 */
export async function drain(run: Run): Promise<void> {
  await settle();
  void run;
}
