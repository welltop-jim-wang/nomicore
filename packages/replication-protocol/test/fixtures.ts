/**
 * SA6 红灯测试共享 fixtures（issue #135 — `@nomicore/replication-protocol` 纯 codec）。
 *
 * ⚠️ 本文件不是测试文件（不匹配 `*.test.ts`），只承载 golden 常量与构造 helper。
 *
 * ============================== 契约锚点 =====================================
 * 规范唯一权威：docs/protocols/instance-replication-v1.md（§3 固定 envelope、
 * §5 消息注册表、§6–§13 payload 字段顺序、§13.1/13.2 错误注册表、§22 conformance）。
 * 本文件中的所有 golden 十六进制 = §3 的 20-byte 大端 header + §4 的 lib0 canonical payload
 * （lib0 编码规则核对自 lockfile 中 lib0@0.2.117 的 encoding/decoding 行为：
 *  varString   = varUint(utf8 字节数) + utf8 字节
 *  varUint8Array = varUint(byteLength) + 字节
 *  varUint     = 无符号 LEB128（规范最短形式）
 *  bool/u8     = 1 字节 0|1；optional = u8 0|1 后跟值；list = varUint count 后逐项
 *  capability  = 固定 uint32 大端）
 *
 * 解码器判定顺序（红灯测试锚定的固定检查顺序，防止分类不确定）：
 *   1. byteLength < 4 或前 4 字节 != 'NMCR'(4e 4d 43 52)        → BAD_MAGIC
 *   2. byteLength < 20                                        → FRAME_LENGTH_MISMATCH
 *   3. envelopeVersion !== 1                                  → UNSUPPORTED_ENVELOPE_VERSION
 *   4. flags !== 0                                            → UNSUPPORTED_FLAGS
 *   5. reserved !== 0                                         → MALFORMED_FRAME
 *   6. messageType 未注册                                     → UNSUPPORTED_MESSAGE_TYPE
 *   7. byteLength > maxFrameBytes(缺省 16 MiB)                → FRAME_TOO_LARGE
 *   8. byteLength !== 20 + payloadLength                      → FRAME_LENGTH_MISMATCH
 *   9. payload 级任何违规（截断/溢出/尾随/非法 UTF-8/非 canonical varUint/
 *      非法 optional marker/非法 list count/非法 namespaceId/格式字段违规/
 *      字段级 limit 超限/与注册表不符的 ERROR fatal·retryable 位）→ 对应分类错误
 * 任何 throw 都是 `ProtocolError`（code ∈ 连接/namespace 错误注册表），
 * 绝不抛出未分类异常；校验发生在按 payloadLength 复制/分配之前。
 * =============================================================================
 */

export const ENVELOPE_MAGIC_HEX = '4e4d4352'; // 'NMCR' 规范字节
export const ENVELOPE_VERSION = 1;
export const ENVELOPE_HEADER_BYTES = 20;

export const NS = 'ns-0123456789abcdef0123456789abcdef'; // 合法 namespaceId
export const RID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'; // 合法 replicationId (32 hex)
export const RID2 = '0123456789abcdef0123456789abcdef'; // 另一合法 replicationId
export const NONCE = Uint8Array.from({ length: 16 }, (_, i) => i); // 固定 16 字节 nonce

// ---------------------------------------------------------------- hex helpers
export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error(`odd hex length: ${hex}`);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/**
 * 按 §3 组装 20-byte 大端 header + payload 的完整 frame 十六进制。
 * 纯算术构造（与实现无关；常量来自规范文本），供 golden 与 malformed 用例使用。
 */
export function buildFrameHex(messageType: number, sequence: number, payloadHex: string): string {
  if (payloadHex.length % 2 !== 0) throw new Error(`odd payload hex`);
  const payloadLen = payloadHex.length / 2;
  if (payloadLen > 0xffffffff) throw new Error('payload too large');
  const seq = ((sequence >>> 0) >>> 0);
  const header =
    ENVELOPE_MAGIC_HEX +
    '01' + // envelopeVersion
    messageType.toString(16).padStart(2, '0') +
    '0000' + // flags
    seq.toString(16).padStart(8, '0') +
    payloadLen.toString(16).padStart(8, '0') +
    '00000000'; // reserved
  return header + payloadHex;
}

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
  relatedSequence?: number;
  namespaceId?: string;
  safeMessage: string;
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

export type FixtureMessage =
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
  | UpdateAckMsg;

export interface GoldenFixture {
  name: string;
  kind: string;
  /** 消息注册表 code */
  messageType: number;
  /** 该 golden frame 的 header.sequence */
  sequence: number;
  message: FixtureMessage;
  /** payload 十六进制（lib0 canonical，字段顺序依 §6–§13） */
  payloadHex: string;
  /** 完整 frame 十六进制（20-byte header + payload） */
  frameHex: string;
}

function fixture(
  name: string,
  messageType: number,
  sequence: number,
  message: FixtureMessage,
  payloadHex: string,
): GoldenFixture {
  return {
    name,
    kind: message.kind,
    messageType,
    sequence,
    message,
    payloadHex,
    frameHex: buildFrameHex(messageType, sequence, payloadHex),
  };
}

export const GOLDEN: GoldenFixture[] = [
  fixture('HELLO', 0x01, 1, {
    kind: 'HELLO',
    peerInstanceId: 'peer-a',
    expectedHubInstanceId: 'hub-a',
    protocolVersions: [3, 2, 1],
    requiredCapabilities: 0,
    optionalCapabilities: 0,
    connectionNonce: NONCE,
  }, '06706565722d61056875622d6103030201000000000000000010000102030405060708090a0b0c0d0e0f'),
  fixture('HELLO_ACK', 0x02, 2, {
    kind: 'HELLO_ACK',
    hubInstanceId: 'hub-a',
    protocolVersion: 2,
    selectedCapabilities: 0,
    connectionNonce: NONCE,
    connectionId: 'conn-1',
  }, '056875622d61020000000010000102030405060708090a0b0c0d0e0f06636f6e6e2d31'),
  fixture('GOAWAY', 0x03, 3, {
    kind: 'GOAWAY',
    reasonCode: 'SERVER_RESTARTING',
    drainTimeoutMs: 5000,
    retryAfterMs: 2000,
  }, '115345525645525f52455354415254494e47882701d00f'),
  fixture('ERROR_CONN', 0x04, 4, {
    kind: 'ERROR',
    code: 'BAD_MAGIC',
    relatedSequence: 7,
    safeMessage: 'bad magic',
  }, '00094241445f4d41474943010001070009626164206d61676963'),
  fixture('ERROR_NS', 0x04, 5, {
    kind: 'ERROR',
    code: 'SYNC_STATE_VIOLATION',
    relatedSequence: 12,
    namespaceId: NS,
    safeMessage: 'sync violation',
  }, '011453594e435f53544154455f56494f4c4154494f4e0100010c01236e732d30313233343536373839616263646566303132333435363738396162636465660e73796e632076696f6c6174696f6e'),
  fixture('OPEN_NAMESPACE', 0x10, 6, {
    kind: 'OPEN_NAMESPACE',
    namespaceId: NS,
    hasLocalReplica: true,
    replicationId: RID,
    replicationEpoch: 1,
  }, '236e732d303132333435363738396162636465663031323334353637383961626364656601012061316232633364346535663630373138323933613462356336643765386639300101'),
  fixture('OPEN_OK', 0x11, 7, {
    kind: 'OPEN_OK',
    namespaceId: NS,
    mode: 1,
    replicationId: RID,
    replicationEpoch: 1,
  }, '236e732d30313233343536373839616263646566303132333435363738396162636465660120613162326333643465356636303731383239336134623563366437653866393001'),
  fixture('CLOSE_NAMESPACE', 0x12, 8, {
    kind: 'CLOSE_NAMESPACE',
    namespaceId: NS,
    reasonCode: 'USER_REMOVED',
  }, '236e732d30313233343536373839616263646566303132333435363738396162636465660c555345525f52454d4f564544'),
  fixture('CLOSE_OK', 0x13, 9, {
    kind: 'CLOSE_OK',
    namespaceId: NS,
    ackedSequence: 9,
  }, '236e732d303132333435363738396162636465663031323334353637383961626364656609'),
  fixture('BOOTSTRAP_SNAPSHOT', 0x20, 10, {
    kind: 'BOOTSTRAP_SNAPSHOT',
    namespaceId: NS,
    replicationId: RID,
    replicationEpoch: 1,
    snapshot: Uint8Array.from([0, 1, 2, 3]),
  }, '236e732d3031323334353637383961626364656630313233343536373839616263646566206131623263336434653566363037313832393361346235633664376538663930010400010203'),
  fixture('BOOTSTRAP_ACK', 0x21, 11, {
    kind: 'BOOTSTRAP_ACK',
    namespaceId: NS,
    ackedSequence: 4,
  }, '236e732d303132333435363738396162636465663031323334353637383961626364656604'),
  fixture('IDENTITY_CHANGED', 0x22, 12, {
    kind: 'IDENTITY_CHANGED',
    namespaceId: NS,
    replicationId: RID2,
    replicationEpoch: 2,
  }, '236e732d303132333435363738396162636465663031323334353637383961626364656620303132333435363738396162636465663031323334353637383961626364656602'),
  fixture('SYNC_STEP1', 0x30, 13, {
    kind: 'SYNC_STEP1',
    namespaceId: NS,
    syncRoundId: 1,
    stateVector: Uint8Array.from([0x00]),
  }, '236e732d3031323334353637383961626364656630313233343536373839616263646566010100'),
  fixture('SYNC_STEP2', 0x31, 14, {
    kind: 'SYNC_STEP2',
    namespaceId: NS,
    syncRoundId: 1,
    relatedStep1Sequence: 2,
    update: Uint8Array.from([1, 2, 3]),
  }, '236e732d3031323334353637383961626364656630313233343536373839616263646566010203010203'),
  fixture('SYNC_APPLIED', 0x32, 15, {
    kind: 'SYNC_APPLIED',
    namespaceId: NS,
    syncRoundId: 1,
    ackedSequence: 3,
  }, '236e732d30313233343536373839616263646566303132333435363738396162636465660103'),
  fixture('RESYNC_REQUIRED', 0x33, 16, {
    kind: 'RESYNC_REQUIRED',
    namespaceId: NS,
    reasonCode: 'ACK_TIMEOUT',
  }, '236e732d30313233343536373839616263646566303132333435363738396162636465660b41434b5f54494d454f5554'),
  fixture('UPDATE', 0x40, 17, {
    kind: 'UPDATE',
    namespaceId: NS,
    update: Uint8Array.from([4, 5, 6]),
  }, '236e732d303132333435363738396162636465663031323334353637383961626364656603040506'),
  fixture('UPDATE_ACK', 0x41, 18, {
    kind: 'UPDATE_ACK',
    namespaceId: NS,
    ackedSequence: 6,
  }, '236e732d303132333435363738396162636465663031323334353637383961626364656606'),
];

export const HELLO = GOLDEN[0]!.message as HelloMsg;
export const HELLO_ACK = GOLDEN[1]!.message as HelloAckMsg;
export const GOAWAY = GOLDEN[2]!.message as GoawayMsg;
export const ERROR_CONN = GOLDEN[3]!.message as ErrorMsg;
export const ERROR_NS = GOLDEN[4]!.message as ErrorMsg;
export const OPEN_NAMESPACE = GOLDEN[5]!.message as OpenNamespaceMsg;
export const OPEN_OK = GOLDEN[6]!.message as OpenOkMsg;
export const CLOSE_NAMESPACE = GOLDEN[7]!.message as CloseNamespaceMsg;
export const CLOSE_OK = GOLDEN[8]!.message as CloseOkMsg;
export const BOOTSTRAP_SNAPSHOT = GOLDEN[9]!.message as BootstrapSnapshotMsg;
export const BOOTSTRAP_ACK = GOLDEN[10]!.message as BootstrapAckMsg;
export const IDENTITY_CHANGED = GOLDEN[11]!.message as IdentityChangedMsg;
export const SYNC_STEP1 = GOLDEN[12]!.message as SyncStep1Msg;
export const SYNC_STEP2 = GOLDEN[13]!.message as SyncStep2Msg;
export const SYNC_APPLIED = GOLDEN[14]!.message as SyncAppliedMsg;
export const RESYNC_REQUIRED = GOLDEN[15]!.message as ResyncRequiredMsg;
export const UPDATE = GOLDEN[16]!.message as UpdateMsg;
export const UPDATE_ACK = GOLDEN[17]!.message as UpdateAckMsg;

/** 消息注册表全表（§5）：name → code */
export const MESSAGE_TABLE: Record<string, number> = {
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
};

/** 消息作用域（§5 scope 列）：connection / namespace / either */
export const MESSAGE_SCOPE: Record<string, 'connection' | 'namespace' | 'either'> = {
  HELLO: 'connection',
  HELLO_ACK: 'connection',
  GOAWAY: 'connection',
  ERROR: 'either',
  OPEN_NAMESPACE: 'namespace',
  OPEN_OK: 'namespace',
  CLOSE_NAMESPACE: 'namespace',
  CLOSE_OK: 'namespace',
  BOOTSTRAP_SNAPSHOT: 'namespace',
  BOOTSTRAP_ACK: 'namespace',
  IDENTITY_CHANGED: 'namespace',
  SYNC_STEP1: 'namespace',
  SYNC_STEP2: 'namespace',
  SYNC_APPLIED: 'namespace',
  RESYNC_REQUIRED: 'namespace',
  UPDATE: 'namespace',
  UPDATE_ACK: 'namespace',
};

/** 消息方向（§5 direction 列） */
export const MESSAGE_DIRECTION: Record<string, 'peer-to-hub' | 'hub-to-peer' | 'either'> = {
  HELLO: 'peer-to-hub',
  HELLO_ACK: 'hub-to-peer',
  GOAWAY: 'either',
  ERROR: 'either',
  OPEN_NAMESPACE: 'peer-to-hub',
  OPEN_OK: 'hub-to-peer',
  CLOSE_NAMESPACE: 'either',
  CLOSE_OK: 'either',
  BOOTSTRAP_SNAPSHOT: 'hub-to-peer',
  BOOTSTRAP_ACK: 'peer-to-hub',
  IDENTITY_CHANGED: 'hub-to-peer',
  SYNC_STEP1: 'either',
  SYNC_STEP2: 'either',
  SYNC_APPLIED: 'either',
  RESYNC_REQUIRED: 'either',
  UPDATE: 'either',
  UPDATE_ACK: 'either',
};

/** 消息结果/ack 语义（§5 Result/ack 列） */
export const MESSAGE_ACK: Record<string, string> = {
  HELLO: 'ERROR-or-HELLO_ACK',
  HELLO_ACK: 'none',
  GOAWAY: 'none',
  ERROR: 'never-acked',
  OPEN_NAMESPACE: 'ERROR-or-OPEN_OK',
  OPEN_OK: 'none',
  CLOSE_NAMESPACE: 'CLOSE_OK',
  CLOSE_OK: 'none',
  BOOTSTRAP_SNAPSHOT: 'ERROR-or-BOOTSTRAP_ACK',
  BOOTSTRAP_ACK: 'none',
  IDENTITY_CHANGED: 'terminal-conflict',
  SYNC_STEP1: 'SYNC_STEP2',
  SYNC_STEP2: 'SYNC_APPLIED',
  SYNC_APPLIED: 'none',
  RESYNC_REQUIRED: 'peer-starts-new-round',
  UPDATE: 'UPDATE_ACK',
  UPDATE_ACK: 'none',
};

/** 连接错误注册表（§13.1）：code → { fatal, retryable, wsCloseCode } */
export const CONNECTION_ERROR_TABLE: Record<
  string,
  { fatal: boolean; retryable: 'no' | 'yes' | 'config'; wsCloseCode: number }
> = {
  BAD_MAGIC: { fatal: true, retryable: 'no', wsCloseCode: 1002 },
  UNSUPPORTED_ENVELOPE_VERSION: { fatal: true, retryable: 'no', wsCloseCode: 1002 },
  MALFORMED_FRAME: { fatal: true, retryable: 'no', wsCloseCode: 1002 },
  FRAME_LENGTH_MISMATCH: { fatal: true, retryable: 'no', wsCloseCode: 1002 },
  FRAME_TOO_LARGE: { fatal: true, retryable: 'config', wsCloseCode: 1009 },
  UNSUPPORTED_FLAGS: { fatal: true, retryable: 'no', wsCloseCode: 1002 },
  UNSUPPORTED_MESSAGE_TYPE: { fatal: true, retryable: 'no', wsCloseCode: 1002 },
  SEQUENCE_VIOLATION: { fatal: true, retryable: 'no', wsCloseCode: 1002 },
  HELLO_REQUIRED: { fatal: true, retryable: 'no', wsCloseCode: 1002 },
  HELLO_TIMEOUT: { fatal: true, retryable: 'yes', wsCloseCode: 1002 },
  UNSUPPORTED_PROTOCOL_VERSION: { fatal: true, retryable: 'config', wsCloseCode: 1002 },
  UNSUPPORTED_CAPABILITY: { fatal: true, retryable: 'config', wsCloseCode: 1002 },
  INSTANCE_IDENTITY_MISMATCH: { fatal: true, retryable: 'config', wsCloseCode: 1008 },
  CONNECTION_POLICY_VIOLATION: { fatal: true, retryable: 'config', wsCloseCode: 1008 },
  ACK_STATE_VIOLATION: { fatal: true, retryable: 'no', wsCloseCode: 1002 },
  CONNECTION_BACKPRESSURE: { fatal: true, retryable: 'yes', wsCloseCode: 1011 },
  INTERNAL_ERROR: { fatal: true, retryable: 'yes', wsCloseCode: 1011 },
};

/** namespace 错误注册表（§13.2）：code → { fatal, retryable, terminalState } */
export const NAMESPACE_ERROR_TABLE: Record<
  string,
  { fatal: boolean; retryable: string; terminalState: string }
> = {
  TARGET_NOT_REQUESTED: { fatal: true, retryable: 'config', terminalState: 'failed' },
  NAMESPACE_REOPEN_REQUIRES_RECONNECT: { fatal: true, retryable: 'reconnect', terminalState: 'closed' },
  NAMESPACE_UNAUTHORIZED: { fatal: true, retryable: 'config', terminalState: 'failed' },
  NAMESPACE_NOT_FOUND: { fatal: true, retryable: 'config', terminalState: 'failed' },
  REPLICATION_NOT_ENABLED: { fatal: true, retryable: 'config', terminalState: 'failed' },
  REPLICATION_ID_MISMATCH: { fatal: true, retryable: 'reset', terminalState: 'conflicted' },
  REPLICATION_EPOCH_MISMATCH: { fatal: true, retryable: 'reset', terminalState: 'conflicted' },
  NAMESPACE_STATE_VIOLATION: { fatal: true, retryable: 'no', terminalState: 'failed' },
  SYNC_STATE_VIOLATION: { fatal: true, retryable: 'no', terminalState: 'failed' },
  BOOTSTRAP_TOO_LARGE: { fatal: true, retryable: 'config', terminalState: 'failed' },
  BOOTSTRAP_FAILED: { fatal: true, retryable: 'reconnect', terminalState: 'failed' },
  SYNC_DIFF_TOO_LARGE: { fatal: true, retryable: 'config', terminalState: 'failed' },
  UPDATE_TOO_LARGE: { fatal: true, retryable: 'config', terminalState: 'failed' },
  PROTECTED_FIELD_MUTATION: { fatal: true, retryable: 'no', terminalState: 'failed' },
  ROLE_VIOLATION: { fatal: true, retryable: 'no', terminalState: 'failed' },
  PERSISTENCE_DEGRADED: { fatal: true, retryable: 'recovery', terminalState: 'failed' },
  APPLY_FAILED: { fatal: true, retryable: 'reconnect', terminalState: 'failed' },
  ACK_TIMEOUT: { fatal: false, retryable: 'resync', terminalState: 'needs-resync' },
  NAMESPACE_TIMEOUT: { fatal: true, retryable: 'reconnect', terminalState: 'failed' },
  INTERNAL_ERROR: { fatal: true, retryable: 'reconnect', terminalState: 'failed' },
};
