/**
 * 消息注册表（append-only、冻结）+ ReplicationMessage 判别联合。
 *
 * 权威来源：docs/protocols/instance-replication-v1.md §5（18 条消息的 code/scope/direction/ack；
 * issue #242 追加第 18 条 UPDATE_CHUNK(0x42)，ADR 0013 冻结值）。
 * codec 不强制 direction/ack——只在注册表暴露元数据供 ws-replication 状态机使用。
 * 所有注册表对象与条目对象 Object.freeze。
 */

/** 消息名联合（17 个 v1 消息 + UPDATE_CHUNK）。 */
export type MessageName =
  | 'HELLO'
  | 'HELLO_ACK'
  | 'GOAWAY'
  | 'ERROR'
  | 'OPEN_NAMESPACE'
  | 'OPEN_OK'
  | 'CLOSE_NAMESPACE'
  | 'CLOSE_OK'
  | 'BOOTSTRAP_SNAPSHOT'
  | 'BOOTSTRAP_ACK'
  | 'IDENTITY_CHANGED'
  | 'SYNC_STEP1'
  | 'SYNC_STEP2'
  | 'SYNC_APPLIED'
  | 'RESYNC_REQUIRED'
  | 'UPDATE'
  | 'UPDATE_ACK'
  | 'UPDATE_CHUNK';

/** 消息作用域：connection / namespace / either。 */
export type MessageScope = 'connection' | 'namespace' | 'either';

/** 消息方向：peer-to-hub / hub-to-peer / either。 */
export type MessageDirection = 'peer-to-hub' | 'hub-to-peer' | 'either';

/** 消息注册表条目元数据（code/scope/direction/ack 四元组）。 */
export interface MessageInfo {
  readonly code: number;
  readonly scope: MessageScope;
  readonly direction: MessageDirection;
  readonly ack: string;
}

const _messageTypes: Record<MessageName, number> = {
  HELLO: 0x01,
  HELLO_ACK: 0x02,
  GOAWAY: 0x03,
  ERROR: 0x04,
  OPEN_NAMESPACE: 0x10,
  OPEN_OK: 0x11,
  CLOSE_NAMESPACE: 0x12,
  CLOSE_OK: 0x13,
  BOOTSTRAP_SNAPSHOT: 0x20,
  BOOTSTRAP_ACK: 0x21,
  IDENTITY_CHANGED: 0x22,
  SYNC_STEP1: 0x30,
  SYNC_STEP2: 0x31,
  SYNC_APPLIED: 0x32,
  RESYNC_REQUIRED: 0x33,
  UPDATE: 0x40,
  UPDATE_ACK: 0x41,
  UPDATE_CHUNK: 0x42,
};

/** name → code（18 键，冻结）。 */
export const MESSAGE_TYPES: Readonly<Record<MessageName, number>> = Object.freeze(_messageTypes);

/** code（数字字符串键）→ name 精确逆映射（18 键，冻结）。 */
export const MESSAGE_NAMES: Readonly<Record<string, MessageName>> = Object.freeze(
  Object.fromEntries(
    Object.entries(_messageTypes).map(([name, code]): [string, MessageName] => [String(code), name as MessageName]),
  ) as Record<string, MessageName>,
);

function messageInfo(code: number, scope: MessageScope, direction: MessageDirection, ack: string): MessageInfo {
  return Object.freeze({ code, scope, direction, ack });
}

const _messageRegistry: Record<MessageName, MessageInfo> = {
  HELLO: messageInfo(0x01, 'connection', 'peer-to-hub', 'ERROR-or-HELLO_ACK'),
  HELLO_ACK: messageInfo(0x02, 'connection', 'hub-to-peer', 'none'),
  GOAWAY: messageInfo(0x03, 'connection', 'either', 'none'),
  ERROR: messageInfo(0x04, 'either', 'either', 'never-acked'),
  OPEN_NAMESPACE: messageInfo(0x10, 'namespace', 'peer-to-hub', 'ERROR-or-OPEN_OK'),
  OPEN_OK: messageInfo(0x11, 'namespace', 'hub-to-peer', 'none'),
  CLOSE_NAMESPACE: messageInfo(0x12, 'namespace', 'either', 'CLOSE_OK'),
  CLOSE_OK: messageInfo(0x13, 'namespace', 'either', 'none'),
  BOOTSTRAP_SNAPSHOT: messageInfo(0x20, 'namespace', 'hub-to-peer', 'ERROR-or-BOOTSTRAP_ACK'),
  BOOTSTRAP_ACK: messageInfo(0x21, 'namespace', 'peer-to-hub', 'none'),
  IDENTITY_CHANGED: messageInfo(0x22, 'namespace', 'hub-to-peer', 'terminal-conflict'),
  SYNC_STEP1: messageInfo(0x30, 'namespace', 'either', 'SYNC_STEP2'),
  SYNC_STEP2: messageInfo(0x31, 'namespace', 'either', 'SYNC_APPLIED'),
  SYNC_APPLIED: messageInfo(0x32, 'namespace', 'either', 'none'),
  RESYNC_REQUIRED: messageInfo(0x33, 'namespace', 'either', 'peer-starts-new-round'),
  UPDATE: messageInfo(0x40, 'namespace', 'either', 'UPDATE_ACK'),
  UPDATE_ACK: messageInfo(0x41, 'namespace', 'either', 'none'),
  UPDATE_CHUNK: messageInfo(0x42, 'namespace', 'either', 'UPDATE_ACK'),
};

/** name → MessageInfo（18 键，冻结）。 */
export const MESSAGE_REGISTRY: Readonly<Record<MessageName, MessageInfo>> = Object.freeze(_messageRegistry);

// ---------------------------------------------------------------- 消息类型（= fixtures 17 个 interface 形状）

export interface HelloMsg {
  kind: 'HELLO';
  peerInstanceId: string;
  expectedHubInstanceId: string;
  protocolVersions: number[];
  requiredCapabilities: number;
  optionalCapabilities: number;
  connectionNonce: Uint8Array;
}

export interface HelloAckMsg {
  kind: 'HELLO_ACK';
  hubInstanceId: string;
  protocolVersion: number;
  selectedCapabilities: number;
  connectionNonce: Uint8Array;
  connectionId: string;
}

export interface GoawayMsg {
  kind: 'GOAWAY';
  reasonCode: string;
  drainTimeoutMs: number;
  retryAfterMs?: number;
}

export interface ErrorMsg {
  kind: 'ERROR';
  code: string;
  safeMessage: string;
  relatedSequence?: number;
  namespaceId?: string;
}

export interface OpenNamespaceMsg {
  kind: 'OPEN_NAMESPACE';
  namespaceId: string;
  hasLocalReplica: boolean;
  replicationId?: string;
  replicationEpoch?: number;
}

export interface OpenOkMsg {
  kind: 'OPEN_OK';
  namespaceId: string;
  mode: 0 | 1;
  replicationId: string;
  replicationEpoch: number;
}

export interface CloseNamespaceMsg {
  kind: 'CLOSE_NAMESPACE';
  namespaceId: string;
  reasonCode: string;
}

export interface CloseOkMsg {
  kind: 'CLOSE_OK';
  namespaceId: string;
  ackedSequence: number;
}

export interface BootstrapSnapshotMsg {
  kind: 'BOOTSTRAP_SNAPSHOT';
  namespaceId: string;
  replicationId: string;
  replicationEpoch: number;
  snapshot: Uint8Array;
}

export interface BootstrapAckMsg {
  kind: 'BOOTSTRAP_ACK';
  namespaceId: string;
  ackedSequence: number;
}

export interface IdentityChangedMsg {
  kind: 'IDENTITY_CHANGED';
  namespaceId: string;
  replicationId: string;
  replicationEpoch: number;
}

export interface SyncStep1Msg {
  kind: 'SYNC_STEP1';
  namespaceId: string;
  syncRoundId: number;
  stateVector: Uint8Array;
}

export interface SyncStep2Msg {
  kind: 'SYNC_STEP2';
  namespaceId: string;
  syncRoundId: number;
  relatedStep1Sequence: number;
  update: Uint8Array;
}

export interface SyncAppliedMsg {
  kind: 'SYNC_APPLIED';
  namespaceId: string;
  syncRoundId: number;
  ackedSequence: number;
}

export interface ResyncRequiredMsg {
  kind: 'RESYNC_REQUIRED';
  namespaceId: string;
  reasonCode: string;
}

export interface UpdateMsg {
  kind: 'UPDATE';
  namespaceId: string;
  update: Uint8Array;
}

export interface UpdateAckMsg {
  kind: 'UPDATE_ACK';
  namespaceId: string;
  ackedSequence: number;
}

/**
 * 0x42 UPDATE_CHUNK wire kind 首字段（ADR 0022 / 协议 §10.3）：
 * 0=live-update / 1=snapshot / 2=sync-diff。单形态恒在（编码/解码双向校验 ∈ {0,1,2}）。
 */
export type UpdateChunkTransferKind = 0 | 1 | 2;

/**
 * 分块 UPDATE 的自描述单帧（ADR 0022 / 协议 §10.3 单形态字段序 = wire 序）。
 * 单帧语义自洽规则（kind ∈ {0,1,2}、绑定块当且仅当 kind≠0 ∧ chunkIndex=0、transferId ≥ 1、
 * chunkIndex < chunkCount、非空 bytes、bytes ≤ totalBytes）由 codec 校验（MALFORMED_FRAME）；
 * 跨帧一致性/顺序/总量校验与绑定块内容核对属接收端 assembly / 后续切片，codec 无状态、不承载。
 */
export interface UpdateChunkMsg {
  kind: 'UPDATE_CHUNK';
  /** wire kind 首字段（单形态恒在；与判别键 `kind` 异名）。 */
  transferKind: UpdateChunkTransferKind;
  namespaceId: string;
  /** uint32，(连接, 方向, namespace) 域内从 1 严格递增，三种 kind 共用同一计数器（ADR 0022）。 */
  transferId: number;
  /** uint32，0-based。 */
  chunkIndex: number;
  /** uint32，≥ 1。 */
  chunkCount: number;
  /** uint32，完整 update 字节数，≥ bytes.byteLength。 */
  totalBytes: number;
  /** kind=1 首 chunk 绑定块成员（当且仅当 transferKind=1 ∧ chunkIndex=0 出现）。 */
  replicationId?: string;
  /** kind=1 首 chunk 绑定块成员（当且仅当 transferKind=1 ∧ chunkIndex=0 出现）。 */
  replicationEpoch?: number;
  /** kind=2 首 chunk 绑定块成员（当且仅当 transferKind=2 ∧ chunkIndex=0 出现）。 */
  syncRoundId?: number;
  /** 本分片（非空），≤ maxUpdateBytes（复用 UPDATE 字段限额）。 */
  bytes: Uint8Array;
}

/** 18 成员判别联合，kind 为判别键（成员形状 = test/fixtures.ts 的 18 个 interface）。 */
export type ReplicationMessage =
  | HelloMsg
  | HelloAckMsg
  | GoawayMsg
  | ErrorMsg
  | OpenNamespaceMsg
  | OpenOkMsg
  | CloseNamespaceMsg
  | CloseOkMsg
  | BootstrapSnapshotMsg
  | BootstrapAckMsg
  | IdentityChangedMsg
  | SyncStep1Msg
  | SyncStep2Msg
  | SyncAppliedMsg
  | ResyncRequiredMsg
  | UpdateMsg
  | UpdateAckMsg
  | UpdateChunkMsg;
