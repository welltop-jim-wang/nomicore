/**
 * hub-connection —— `createHubReplication`：accept/HELLO/hub 连接 FSM + 帧分发
 * （§4.2/§6/§15.2）。per-(connection, namespace) 通道见 hub-namespace.ts。
 */
import type { DuplexTransport } from './types.js';
import { encodeMessage, selectProtocolVersion, type ReplicationMessage } from '@nomicore/replication-protocol';
import {
  decodeInbound,
  namespaceFieldViolation,
  OutboundQueue,
  connectionErrorFrame,
  codecFieldLimits,
} from './frame-io.js';
import { HubNamespaceChannel, type HubChannelHost } from './hub-namespace.js';
import type { NamespaceRegistry } from '@nomicore/namespace-registry';
import type {
  HubConnection,
  HubReplication,
  HubReplicationOptions,
  NamespaceAuthorizer,
  ResolvedLimits,
  ResolvedTimeouts,
} from './types.js';
import type { ReplicationTimer } from './types.js';
import { resolveLimits, resolveTimeouts } from './defaults.js';
import {
  validateHubOptions,
  validateLimits,
  validateTimeouts,
} from './validate.js';

export function createHubReplication(options: HubReplicationOptions): HubReplication {
  return new HubReplicationImpl(options);
}

/** Hub 内部共享面（连接实例访问）。 */
interface HubInternals {
  readonly instanceId: string;
  readonly registry: NamespaceRegistry;
  readonly authorize: NamespaceAuthorizer;
  readonly timer: ReplicationTimer;
  readonly limits: ResolvedLimits;
  readonly timeouts: ResolvedTimeouts;
  dropConnection(connection: HubConnectionImpl): void;
}

class HubReplicationImpl implements HubReplication {
  private readonly limits: ResolvedLimits;
  private readonly timeouts: ResolvedTimeouts;
  private readonly connectionList: HubConnectionImpl[] = [];
  private closed = false;
  private connectionCounter = 0;
  private closeTail: Promise<void> = Promise.resolve();
  private readonly internals: HubInternals;

  constructor(private readonly options: HubReplicationOptions) {
    validateHubOptions(options);
    const limits = resolveLimits(options.limits);
    const timeouts = resolveTimeouts(options.timeouts);
    validateLimits(limits);
    validateTimeouts(timeouts);
    this.limits = limits;
    this.timeouts = timeouts;
    this.internals = {
      instanceId: options.instanceId,
      registry: options.registry,
      authorize: options.authorize,
      timer: options.timer,
      limits,
      timeouts,
      dropConnection: (connection) => this.dropConnection(connection),
    };
  }

  accept(transport: DuplexTransport): HubConnection {
    const connection = new HubConnectionImpl(this.internals, transport, this.connectionCounter);
    this.connectionCounter += 1;
    this.connectionList.push(connection);
    if (this.closed) {
      connection.close(1001, 'hub-shutdown');
    }
    return connection;
  }

  get connections(): readonly HubConnection[] {
    return this.connectionList;
  }

  close(): Promise<void> {
    if (this.closed) return this.closeTail;
    this.closed = true;
    for (const connection of [...this.connectionList]) {
      connection.close(1001, 'hub-shutdown');
    }
    this.closeTail = Promise.all(
      this.connectionList.map((connection) => connection.settle()),
    ).then(() => undefined);
    return this.closeTail;
  }

  private dropConnection(connection: HubConnectionImpl): void {
    const index = this.connectionList.indexOf(connection);
    if (index >= 0) this.connectionList.splice(index, 1);
  }
}

class HubConnectionImpl implements HubConnection {
  state: 'handshaking' | 'ready' | 'draining' | 'closed' = 'handshaking';
  peerInstanceId: string | undefined;
  private readonly outbound: OutboundQueue;
  private expectedSeq = 1;
  private readonly channels = new Map<string, HubNamespaceChannel>();
  private readonly helloHandle: unknown;
  private closedFlag = false;
  private settleTail: Promise<void> = Promise.resolve();
  private readonly channelHost: HubChannelHost;

  constructor(
    private readonly hub: HubInternals,
    private readonly transport: DuplexTransport,
    private readonly connId: number,
  ) {
    this.outbound = new OutboundQueue(
      (bytes) => {
        if (!transport.closed) transport.send(bytes);
      },
      hub.limits,
      () => this.onSequenceExhausted(transport),
    );
    this.channelHost = {
      limits: hub.limits,
      timeouts: hub.timeouts,
      timer: hub.timer,
      registry: hub.registry,
      instanceId: hub.instanceId,
      peerInstanceId: () => this.peerInstanceId ?? '',
      authorize: (instanceIdentity, namespaceId) => hub.authorize(instanceIdentity, namespaceId),
      sendControl: (message) => this.sendControlChecked(message),
      connectionFatal: (code, wsCloseCode) => this.connectionFatal(code, wsCloseCode ?? 1002),
    };
    this.helloHandle = hub.timer.setTimeout(() => {
      if (this.state === 'handshaking') {
        this.connectionFatal('HELLO_TIMEOUT', 1002);
      }
    }, hub.timeouts.helloTimeoutMs);
    transport.onMessage((bytes) => this.onMessage(bytes));
    transport.onClose(() => this.onTransportClosed());
  }

  close(code?: number, reason?: string): void {
    if (this.closedFlag) return;
    this.closedFlag = true;
    this.state = 'draining';
    if (!this.transport.closed) {
      this.transport.close(code ?? 1001, reason ?? 'hub-close');
    }
    void this.cleanupAll();
  }

  /** 全部通道 cleanup 结算（HubReplication.close 等待）。 */
  settle(): Promise<void> {
    return this.settleTail;
  }

  private onMessage(bytes: Uint8Array): void {
    if (this.closedFlag) return;
    let decoded: { header: { sequence: number }; message: ReplicationMessage };
    try {
      decoded = decodeInbound(bytes, {
        expectedSequence: this.expectedSeq,
        maxFrameBytes: this.hub.limits.maxFrameBytes,
      });
    } catch (err) {
      const code = (err as { code?: string }).code ?? 'MALFORMED_FRAME';
      this.connectionFatal(code, wsCloseCodeFor(code));
      return;
    }
    this.expectedSeq = decoded.header.sequence + 1;
    const message = decoded.message;
    if (this.state === 'handshaking') {
      if (message.kind === 'HELLO') {
        this.onHello(message);
        return;
      }
      this.connectionFatal('HELLO_REQUIRED', 1002);
      return;
    }
    this.dispatchReady(message, decoded.header.sequence);
  }

  private onHello(message: {
    peerInstanceId: string;
    expectedHubInstanceId: string;
    protocolVersions: number[];
    requiredCapabilities: number;
    connectionNonce: Uint8Array;
  }): void {
    if (this.state !== 'handshaking') {
      this.connectionFatal('CONNECTION_POLICY_VIOLATION', 1008);
      return;
    }
    if (message.expectedHubInstanceId !== this.hub.instanceId) {
      this.connectionFatal('INSTANCE_IDENTITY_MISMATCH', 1008);
      return;
    }
    const version = selectProtocolVersion(message.protocolVersions, [1]);
    if (version === null) {
      this.connectionFatal('UNSUPPORTED_PROTOCOL_VERSION', 1002);
      return;
    }
    if (message.requiredCapabilities !== 0) {
      this.connectionFatal('UNSUPPORTED_CAPABILITY', 1002);
      return;
    }
    this.peerInstanceId = message.peerInstanceId;
    this.state = 'ready';
    const connectionId = `${this.hub.instanceId}-conn-${this.connId}`;
    this.sendControlChecked({
      kind: 'HELLO_ACK',
      hubInstanceId: this.hub.instanceId,
      protocolVersion: version,
      selectedCapabilities: 0,
      connectionNonce: message.connectionNonce,
      connectionId,
    });
  }

  private dispatchReady(message: ReplicationMessage, sequence: number): void {
    switch (message.kind) {
      case 'HELLO':
      case 'HELLO_ACK':
      case 'OPEN_OK':
      case 'BOOTSTRAP_SNAPSHOT':
      case 'IDENTITY_CHANGED':
        // 方向纪律（R2.1 澄清）：hub 收到 hub→peer 方向专用帧 → 连接策略拒绝（§6）
        this.connectionFatal('CONNECTION_POLICY_VIOLATION', 1008);
        return;
      case 'OPEN_NAMESPACE':
        this.onOpenNamespace(message);
        return;
      case 'BOOTSTRAP_ACK':
        this.withChannel(message.namespaceId, (c) => c.onBootstrapAck({ ackedSequence: message.ackedSequence }));
        return;
      case 'SYNC_STEP1':
        this.withChannel(message.namespaceId, (c) => c.onSyncStep1({ ...message, sequence }));
        return;
      case 'SYNC_STEP2':
        this.withChannel(message.namespaceId, (c) => c.onSyncStep2({ ...message, sequence }));
        return;
      case 'SYNC_APPLIED':
        this.withChannel(message.namespaceId, (c) => c.onSyncApplied(message));
        return;
      case 'RESYNC_REQUIRED':
        this.withChannel(message.namespaceId, (c) => c.onResyncReceived());
        return;
      case 'UPDATE': {
        const violation = namespaceFieldViolation(message, codecFieldLimits(this.hub.limits));
        this.withChannel(message.namespaceId, (c) => {
          if (violation !== undefined) {
            c.onFieldViolation(violation);
            return;
          }
          c.onUpdate({ update: message.update, sequence });
        });
        return;
      }
      case 'UPDATE_ACK':
        this.withChannel(message.namespaceId, (c) => c.onUpdateAck(message));
        return;
      case 'CLOSE_NAMESPACE':
        this.withChannel(message.namespaceId, (c) => c.onCloseRequest({ ...message, sequence }));
        return;
      case 'CLOSE_OK':
        // hub 不发 CLOSE（CLOSE 恒由 peer 发起）；收到即方向异常
        this.withChannel(message.namespaceId, (c) => c.onErrorFrame({ code: 'NAMESPACE_STATE_VIOLATION' }));
        return;
      case 'ERROR':
        if (message.namespaceId !== undefined) {
          const channel = this.channels.get(message.namespaceId);
          if (channel !== undefined) channel.onErrorFrame(message);
        }
        return;
      case 'GOAWAY':
        this.connectionFatal('CONNECTION_POLICY_VIOLATION', 1008);
        return;
      default: {
        const never: never = message;
        void never;
        return;
      }
    }
  }

  private onOpenNamespace(message: {
    namespaceId: string;
    hasLocalReplica: boolean;
    replicationId?: string;
    replicationEpoch?: number;
  }): void {
    let channel = this.channels.get(message.namespaceId);
    if (channel === undefined) {
      channel = new HubNamespaceChannel(this.channelHost, message.namespaceId);
      this.channels.set(message.namespaceId, channel);
      channel.startOpen(message);
      return;
    }
    channel.onOpen(message);
  }

  private withChannel(namespaceId: string, fn: (c: HubNamespaceChannel) => void): void {
    const channel = this.channels.get(namespaceId);
    if (channel === undefined) {
      try {
        this.sendControlChecked({
          kind: 'ERROR',
          code: 'NAMESPACE_STATE_VIOLATION',
          safeMessage: 'protocol error: NAMESPACE_STATE_VIOLATION',
          namespaceId,
        });
      } catch {
        // 连接已收口；忽略
      }
      return;
    }
    fn(channel);
  }

  private onTransportClosed(): void {
    if (this.closedFlag) return;
    this.closedFlag = true;
    this.state = 'closed';
    void this.cleanupAll();
  }

  private async cleanupAll(): Promise<void> {
    const cleanups = [...this.channels.values()].map((channel) => channel.onConnectionClosed());
    this.settleTail = Promise.all(cleanups).then(() => undefined);
    await this.settleTail;
    this.hub.dropConnection(this);
  }

  private connectionFatal(code: string, wsCloseCode: number): void {
    if (this.closedFlag) return;
    try {
      this.sendControlChecked(connectionErrorFrame(code));
    } catch {
      // best-effort；framing 已不可信
    }
    this.closedFlag = true;
    this.state = 'closed';
    if (!this.transport.closed) {
      this.transport.close(wsCloseCode, 'protocol-error');
    }
    void this.cleanupAll();
  }

  private sendControlChecked(message: ReplicationMessage): number {
    return this.outbound.sendControl(message);
  }

  /** §4.1 R3/#11：出站 uint32 耗尽（实践不可达）→ best-effort connection ERROR +
   *  close(1008)（绕过出站队列直发——队列已耗尽；ERROR 帧以最后合法序列发送）。 */
  private onSequenceExhausted(transport: DuplexTransport): void {
    if (transport.closed) return;
    try {
      transport.send(
        encodeMessage(connectionErrorFrame('CONNECTION_POLICY_VIOLATION'), {
          sequence: 0xffffffff,
          maxFrameBytes: this.hub.limits.maxFrameBytes,
          limits: codecFieldLimits(this.hub.limits),
        }),
      );
    } catch {
      // best-effort；framing 已不可信
    }
    if (!transport.closed) {
      transport.close(1008, 'sequence-exhausted');
    }
    this.closedFlag = true;
    this.state = 'closed';
    void this.cleanupAll();
  }
}

/** 连接级协议错误 → WS close code（§14 粗分类）。 */
function wsCloseCodeFor(code: string): number {
  if (code === 'FRAME_TOO_LARGE') return 1009;
  if (code === 'INSTANCE_IDENTITY_MISMATCH' || code === 'CONNECTION_POLICY_VIOLATION') return 1008;
  return 1002;
}
