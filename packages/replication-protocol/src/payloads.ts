/**
 * 18 种消息的 payload 编解码 + 字段级验证（设计 §7 字段表逐条落地）。
 *
 * 权威来源：docs/protocols/instance-replication-v1.md §6–§13（字段顺序 = wire 顺序 =
 * 规范表格顺序）+ §4（lib0 canonical + 完全消费 + 非法 UTF-8/optional/list 拒绝）。
 *
 * 关键约定：
 * - 解码：CanonicalReader 有界读 + 字段规则校验（R2–R8）+ decodeMessage 末尾 expectEnd（R1）；
 * - 编码：与解码执行同一套字段验证（R9，先验证后写，writer 再兜底防非法值进入 lib0），
 *   ERROR 的 scope/fatal/retryable 由注册表推导（决策 D-3：namespaceId 提供 → namespace scope）；
 * - 失败一律 ProtocolError：payload 级格式违规 → MALFORMED_FRAME；
 *   字段级 limit 超限 → UPDATE_TOO_LARGE / BOOTSTRAP_TOO_LARGE / SYNC_DIFF_TOO_LARGE；
 * - 解码产出 optional 字段缺席时省略键（R10）。
 * - issue #242（D-3）：decodeMessage 对 DecodeOptions.selectedCapabilities 做急切解析/校验
 *   （所有消息类型一致生效，对称 resolveExpectedSequence 先例）；UPDATE_CHUNK(0x42) 未协商
 *   （selected & CAP_CHUNKED_UPDATE === 0）时在 payload 解析前抛 UNSUPPORTED_MESSAGE_TYPE。
 */
import { CanonicalReader, PayloadWriter, assertNonNegativeSafeInteger, assertU32, throwMalformed } from './canonical.js';
import { CAP_CHUNKED_UPDATE, INSTANCE_ID_RE, NAMESPACE_ID_RE, NONCE_BYTES, REPLICATION_ID_RE } from './constants.js';
import { decodeFrame, encodeFrame, type FrameHeader } from './envelope.js';
import { ProtocolError, lookupError } from './errors.js';
import {
  resolveFieldLimit,
  resolveSelectedCapabilities,
  type DecodeOptions,
  type EncodeOptions,
  type FieldLimits,
} from './limits.js';
import {
  type BootstrapAckMsg,
  type BootstrapSnapshotMsg,
  type CloseNamespaceMsg,
  type CloseOkMsg,
  type ErrorMsg,
  type GoawayMsg,
  type HelloAckMsg,
  type HelloMsg,
  type IdentityChangedMsg,
  MESSAGE_TYPES,
  type OpenNamespaceMsg,
  type OpenOkMsg,
  type ReplicationMessage,
  type ResyncRequiredMsg,
  type SyncAppliedMsg,
  type SyncStep1Msg,
  type SyncStep2Msg,
  type UpdateAckMsg,
  type UpdateChunkMsg,
  type UpdateMsg,
} from './messages.js';

/** decodeMessage 结果：header + 解析出的消息。 */
export interface DecodedMessage {
  readonly header: FrameHeader;
  readonly message: ReplicationMessage;
}

// ---------------------------------------------------------------- 共享字段验证（decode 与 encode 同一套）

function checkNamespaceId(s: string): void {
  if (typeof s !== 'string' || !NAMESPACE_ID_RE.test(s)) {
    throwMalformed('invalid namespaceId');
  }
}

function checkReplicationId(s: string): void {
  if (typeof s !== 'string' || !REPLICATION_ID_RE.test(s)) {
    throwMalformed('invalid replicationId');
  }
}

function checkInstanceId(s: string, name: string): void {
  if (typeof s !== 'string' || !INSTANCE_ID_RE.test(s)) {
    throwMalformed(`invalid ${name}`);
  }
}

function checkReplicationEpoch(n: number): void {
  if (!Number.isSafeInteger(n) || n < 1) {
    throwMalformed('replicationEpoch must be a safe integer >= 1');
  }
}

function checkNonEmpty(s: string, name: string): void {
  if (typeof s !== 'string' || s.length === 0) {
    throwMalformed(`${name} must not be empty`);
  }
}

function checkMode(m: number): void {
  if (m !== 0 && m !== 1) {
    throwMalformed('mode must be 0|1');
  }
}

/** 版本表：≥1 项、每项 ≥1 安全整数、严格降序（蕴含无重复）。 */
function checkProtocolVersions(versions: number[]): void {
  if (!Array.isArray(versions) || versions.length < 1) {
    throwMalformed('protocolVersions must contain at least one version');
  }
  let prev = Number.POSITIVE_INFINITY;
  for (const v of versions) {
    if (!Number.isSafeInteger(v) || v < 1) {
      throwMalformed('protocolVersions entries must be safe integers >= 1');
    }
    if (v >= prev) {
      throwMalformed('protocolVersions must be strictly descending');
    }
    prev = v;
  }
}

function checkConnectionNonce(nonce: Uint8Array): void {
  if (!(nonce instanceof Uint8Array) || nonce.byteLength !== NONCE_BYTES) {
    throwMalformed(`connectionNonce must be exactly ${NONCE_BYTES} bytes`);
  }
}

/**
 * uint32 语义字段（R8：syncRoundId/ackedSequence/relatedStep1Sequence/relatedSequence）。
 * 直接透传 reader.readVarUint32()——其内部已检查 ≤ 0xffffffff（canonical.ts），
 * 无需（也不应）在此重复相同检查（SA4 F3：原重复分支为不可达死代码）。
 */
function readU32Field(reader: CanonicalReader): number {
  return reader.readVarUint32();
}

// ---------------------------------------------------------------- HELLO 0x01

function decodeHello(reader: CanonicalReader): HelloMsg {
  const peerInstanceId = reader.readVarString();
  checkInstanceId(peerInstanceId, 'peerInstanceId');
  const expectedHubInstanceId = reader.readVarString();
  checkInstanceId(expectedHubInstanceId, 'expectedHubInstanceId');
  const count = reader.readVarUint();
  if (count < 1) {
    throwMalformed('protocolVersions must contain at least one version');
  }
  const protocolVersions: number[] = [];
  for (let i = 0; i < count; i++) {
    const v = reader.readVarUint();
    if (v < 1) {
      throwMalformed('protocolVersions entries must be >= 1');
    }
    if (protocolVersions.length > 0 && v >= protocolVersions[protocolVersions.length - 1]!) {
      throwMalformed('protocolVersions must be strictly descending');
    }
    protocolVersions.push(v);
  }
  const requiredCapabilities = reader.readUint32BE();
  const optionalCapabilities = reader.readUint32BE();
  const connectionNonce = reader.readVarUint8ArrayCopy();
  checkConnectionNonce(connectionNonce);
  return {
    kind: 'HELLO',
    peerInstanceId,
    expectedHubInstanceId,
    protocolVersions,
    requiredCapabilities,
    optionalCapabilities,
    connectionNonce,
  };
}

function encodeHello(writer: PayloadWriter, msg: HelloMsg): void {
  checkInstanceId(msg.peerInstanceId, 'peerInstanceId');
  checkInstanceId(msg.expectedHubInstanceId, 'expectedHubInstanceId');
  checkProtocolVersions(msg.protocolVersions);
  assertU32(msg.requiredCapabilities, 'requiredCapabilities');
  assertU32(msg.optionalCapabilities, 'optionalCapabilities');
  if (msg.connectionNonce === undefined) {
    throwMalformed('connectionNonce is required');
  }
  checkConnectionNonce(msg.connectionNonce);
  writer.writeVarString(msg.peerInstanceId, 'peerInstanceId');
  writer.writeVarString(msg.expectedHubInstanceId, 'expectedHubInstanceId');
  writer.writeVarUint(msg.protocolVersions.length, 'protocolVersions count');
  for (const v of msg.protocolVersions) {
    writer.writeVarUint(v, 'protocolVersion');
  }
  writer.writeUint32BE(msg.requiredCapabilities);
  writer.writeUint32BE(msg.optionalCapabilities);
  writer.writeVarUint8Array(msg.connectionNonce);
}

// ---------------------------------------------------------------- HELLO_ACK 0x02

function decodeHelloAck(reader: CanonicalReader): HelloAckMsg {
  const hubInstanceId = reader.readVarString();
  checkInstanceId(hubInstanceId, 'hubInstanceId');
  const protocolVersion = reader.readVarUint();
  if (protocolVersion < 1) {
    throwMalformed('protocolVersion must be >= 1');
  }
  const selectedCapabilities = reader.readUint32BE();
  const connectionNonce = reader.readVarUint8ArrayCopy();
  checkConnectionNonce(connectionNonce);
  const connectionId = reader.readVarString();
  checkNonEmpty(connectionId, 'connectionId');
  return {
    kind: 'HELLO_ACK',
    hubInstanceId,
    protocolVersion,
    selectedCapabilities,
    connectionNonce,
    connectionId,
  };
}

function encodeHelloAck(writer: PayloadWriter, msg: HelloAckMsg): void {
  checkInstanceId(msg.hubInstanceId, 'hubInstanceId');
  if (!Number.isSafeInteger(msg.protocolVersion) || msg.protocolVersion < 1) {
    throwMalformed('protocolVersion must be a safe integer >= 1');
  }
  assertU32(msg.selectedCapabilities, 'selectedCapabilities');
  checkConnectionNonce(msg.connectionNonce);
  checkNonEmpty(msg.connectionId, 'connectionId');
  writer.writeVarString(msg.hubInstanceId, 'hubInstanceId');
  writer.writeVarUint(msg.protocolVersion, 'protocolVersion');
  writer.writeUint32BE(msg.selectedCapabilities);
  writer.writeVarUint8Array(msg.connectionNonce);
  writer.writeVarString(msg.connectionId, 'connectionId');
}

// ---------------------------------------------------------------- GOAWAY 0x03

function decodeGoaway(reader: CanonicalReader): GoawayMsg {
  const reasonCode = reader.readVarString();
  checkNonEmpty(reasonCode, 'reasonCode');
  const drainTimeoutMs = reader.readVarUint();
  const marker = reader.readU8();
  if (marker !== 0 && marker !== 1) {
    throwMalformed('optional retryAfterMs marker must be 0|1');
  }
  const msg: GoawayMsg = { kind: 'GOAWAY', reasonCode, drainTimeoutMs };
  if (marker === 1) {
    msg.retryAfterMs = reader.readVarUint();
  }
  return msg;
}

function encodeGoaway(writer: PayloadWriter, msg: GoawayMsg): void {
  checkNonEmpty(msg.reasonCode, 'reasonCode');
  assertNonNegativeSafeInteger(msg.drainTimeoutMs, 'drainTimeoutMs');
  if (msg.retryAfterMs !== undefined) {
    assertNonNegativeSafeInteger(msg.retryAfterMs, 'retryAfterMs');
  }
  writer.writeVarString(msg.reasonCode, 'reasonCode');
  writer.writeVarUint(msg.drainTimeoutMs, 'drainTimeoutMs');
  if (msg.retryAfterMs !== undefined) {
    writer.writeU8(1);
    writer.writeVarUint(msg.retryAfterMs, 'retryAfterMs');
  } else {
    writer.writeU8(0);
  }
}

// ---------------------------------------------------------------- ERROR 0x04
//
// wire 固定七段（§13）：scope(u8) → code(varString) → fatal(bool) → retryable(bool)
// → relatedSequence(optional varUint) → namespaceId(optional varString) → safeMessage(varString)。
// scope/fatal/retryable 由 code 注册表推导：wire fatal == registry.fatal、
// wire retryable == (registry.retryable !== 'no')，任何不一致 → MALFORMED_FRAME。
// 决策 D-3（encode 侧 scope 解析）：namespaceId 提供且非 undefined → namespace scope
// （code 必须在 NAMESPACE_ERRORS）；否则 connection scope（code 必须在 CONNECTION_ERRORS）。

function decodeError(reader: CanonicalReader): ErrorMsg {
  const scopeByte = reader.readU8();
  if (scopeByte !== 0 && scopeByte !== 1) {
    throwMalformed('ERROR scope must be 0|1');
  }
  const scope = scopeByte === 1 ? 'namespace' : 'connection';
  const code = reader.readVarString();
  const entry = lookupError(scope, code);
  if (entry === undefined) {
    throwMalformed(`unknown error code for ${scope} scope: ${code}`);
  }
  const fatal = reader.readBool();
  if (fatal !== entry.fatal) {
    throwMalformed('ERROR fatal bit inconsistent with registry');
  }
  const retryable = reader.readBool();
  if (retryable !== (entry.retryable !== 'no')) {
    throwMalformed('ERROR retryable bit inconsistent with registry');
  }
  const relatedMarker = reader.readU8();
  if (relatedMarker !== 0 && relatedMarker !== 1) {
    throwMalformed('optional relatedSequence marker must be 0|1');
  }
  let relatedSequence: number | undefined;
  if (relatedMarker === 1) {
    relatedSequence = readU32Field(reader);
  }
  const nsMarker = reader.readU8();
  if (nsMarker !== 0 && nsMarker !== 1) {
    throwMalformed('optional namespaceId marker must be 0|1');
  }
  let namespaceId: string | undefined;
  if (nsMarker === 1) {
    namespaceId = reader.readVarString();
    checkNamespaceId(namespaceId);
  }
  if (scope === 'namespace' && namespaceId === undefined) {
    throwMalformed('namespace ERROR requires namespaceId');
  }
  if (scope === 'connection' && namespaceId !== undefined) {
    throwMalformed('connection ERROR must not carry namespaceId');
  }
  const safeMessage = reader.readVarString();
  const msg: ErrorMsg = { kind: 'ERROR', code, safeMessage };
  if (relatedSequence !== undefined) {
    msg.relatedSequence = relatedSequence;
  }
  if (namespaceId !== undefined) {
    msg.namespaceId = namespaceId;
  }
  return msg;
}

function encodeError(writer: PayloadWriter, msg: ErrorMsg): void {
  const scope = msg.namespaceId !== undefined ? 'namespace' : 'connection';
  const entry = lookupError(scope, msg.code);
  if (entry === undefined) {
    throwMalformed(`unknown error code for ${scope} scope: ${msg.code}`);
  }
  if (msg.namespaceId !== undefined) {
    checkNamespaceId(msg.namespaceId);
  }
  if (msg.relatedSequence !== undefined) {
    assertU32(msg.relatedSequence, 'relatedSequence');
  }
  writer.writeU8(scope === 'namespace' ? 1 : 0);
  writer.writeVarString(msg.code, 'ERROR code');
  writer.writeBool(entry.fatal);
  writer.writeBool(entry.retryable !== 'no');
  if (msg.relatedSequence !== undefined) {
    writer.writeU8(1);
    writer.writeVarUint32(msg.relatedSequence, 'relatedSequence');
  } else {
    writer.writeU8(0);
  }
  if (msg.namespaceId !== undefined) {
    writer.writeU8(1);
    writer.writeVarString(msg.namespaceId, 'namespaceId');
  } else {
    writer.writeU8(0);
  }
  writer.writeVarString(msg.safeMessage, 'safeMessage');
}

// ---------------------------------------------------------------- OPEN_NAMESPACE 0x10
//
// identity 成对律（§7.1 + 红灯四象限）：hasLocalReplica=true ⇒ 两个 marker 均为 1 且
// replicationId 过 R3、replicationEpoch 过 R4；false ⇒ 两个 marker 均为 0。

function decodeOpenNamespace(reader: CanonicalReader): OpenNamespaceMsg {
  const namespaceId = reader.readVarString();
  checkNamespaceId(namespaceId);
  const hasLocalReplica = reader.readBool();
  const ridMarker = reader.readU8();
  if (ridMarker !== 0 && ridMarker !== 1) {
    throwMalformed('optional replicationId marker must be 0|1');
  }
  let replicationId: string | undefined;
  if (ridMarker === 1) {
    replicationId = reader.readVarString();
    checkReplicationId(replicationId);
  }
  const epochMarker = reader.readU8();
  if (epochMarker !== 0 && epochMarker !== 1) {
    throwMalformed('optional replicationEpoch marker must be 0|1');
  }
  let replicationEpoch: number | undefined;
  if (epochMarker === 1) {
    replicationEpoch = reader.readVarUint();
    checkReplicationEpoch(replicationEpoch);
  }
  if (hasLocalReplica) {
    if (replicationId === undefined || replicationEpoch === undefined) {
      throwMalformed('hasLocalReplica=true requires replicationId and replicationEpoch');
    }
    return { kind: 'OPEN_NAMESPACE', namespaceId, hasLocalReplica, replicationId, replicationEpoch };
  }
  if (replicationId !== undefined || replicationEpoch !== undefined) {
    throwMalformed('hasLocalReplica=false must omit identity fields');
  }
  return { kind: 'OPEN_NAMESPACE', namespaceId, hasLocalReplica };
}

function encodeOpenNamespace(writer: PayloadWriter, msg: OpenNamespaceMsg): void {
  checkNamespaceId(msg.namespaceId);
  if (msg.hasLocalReplica) {
    if (msg.replicationId === undefined || msg.replicationEpoch === undefined) {
      throwMalformed('hasLocalReplica=true requires replicationId and replicationEpoch');
    }
    checkReplicationId(msg.replicationId);
    checkReplicationEpoch(msg.replicationEpoch);
  } else {
    if (msg.replicationId !== undefined || msg.replicationEpoch !== undefined) {
      throwMalformed('hasLocalReplica=false must omit identity fields');
    }
  }
  writer.writeVarString(msg.namespaceId, 'namespaceId');
  writer.writeBool(msg.hasLocalReplica);
  if (msg.hasLocalReplica) {
    writer.writeU8(1);
    writer.writeVarString(msg.replicationId!, 'replicationId');
    writer.writeU8(1);
    writer.writeVarUint(msg.replicationEpoch!, 'replicationEpoch');
  } else {
    writer.writeU8(0);
    writer.writeU8(0);
  }
}

// ---------------------------------------------------------------- OPEN_OK 0x11

function decodeOpenOk(reader: CanonicalReader): OpenOkMsg {
  const namespaceId = reader.readVarString();
  checkNamespaceId(namespaceId);
  const mode = reader.readU8();
  checkMode(mode);
  const replicationId = reader.readVarString();
  checkReplicationId(replicationId);
  const replicationEpoch = reader.readVarUint();
  checkReplicationEpoch(replicationEpoch);
  return { kind: 'OPEN_OK', namespaceId, mode: mode as 0 | 1, replicationId, replicationEpoch };
}

function encodeOpenOk(writer: PayloadWriter, msg: OpenOkMsg): void {
  checkNamespaceId(msg.namespaceId);
  checkMode(msg.mode);
  checkReplicationId(msg.replicationId);
  checkReplicationEpoch(msg.replicationEpoch);
  writer.writeVarString(msg.namespaceId, 'namespaceId');
  writer.writeU8(msg.mode);
  writer.writeVarString(msg.replicationId, 'replicationId');
  writer.writeVarUint(msg.replicationEpoch, 'replicationEpoch');
}

// ---------------------------------------------------------------- CLOSE_NAMESPACE 0x12 / CLOSE_OK 0x13

function decodeCloseNamespace(reader: CanonicalReader): CloseNamespaceMsg {
  const namespaceId = reader.readVarString();
  checkNamespaceId(namespaceId);
  const reasonCode = reader.readVarString();
  checkNonEmpty(reasonCode, 'reasonCode');
  return { kind: 'CLOSE_NAMESPACE', namespaceId, reasonCode };
}

function encodeCloseNamespace(writer: PayloadWriter, msg: CloseNamespaceMsg): void {
  checkNamespaceId(msg.namespaceId);
  checkNonEmpty(msg.reasonCode, 'reasonCode');
  writer.writeVarString(msg.namespaceId, 'namespaceId');
  writer.writeVarString(msg.reasonCode, 'reasonCode');
}

function decodeCloseOk(reader: CanonicalReader): CloseOkMsg {
  const namespaceId = reader.readVarString();
  checkNamespaceId(namespaceId);
  return { kind: 'CLOSE_OK', namespaceId, ackedSequence: readU32Field(reader) };
}

function encodeCloseOk(writer: PayloadWriter, msg: CloseOkMsg): void {
  checkNamespaceId(msg.namespaceId);
  assertU32(msg.ackedSequence, 'ackedSequence');
  writer.writeVarString(msg.namespaceId, 'namespaceId');
  writer.writeVarUint32(msg.ackedSequence, 'ackedSequence');
}

// ---------------------------------------------------------------- BOOTSTRAP_SNAPSHOT 0x20

function decodeBootstrapSnapshot(reader: CanonicalReader, limits: FieldLimits | undefined): BootstrapSnapshotMsg {
  const namespaceId = reader.readVarString();
  checkNamespaceId(namespaceId);
  const replicationId = reader.readVarString();
  checkReplicationId(replicationId);
  const replicationEpoch = reader.readVarUint();
  checkReplicationEpoch(replicationEpoch);
  const snapshot = reader.readVarUint8ArrayCopy();
  const maxBootstrap = resolveFieldLimit(limits?.maxBootstrapBytes, 'maxBootstrapBytes');
  if (maxBootstrap !== undefined && snapshot.byteLength > maxBootstrap) {
    throw new ProtocolError('BOOTSTRAP_TOO_LARGE', `snapshot ${snapshot.byteLength} exceeds maxBootstrapBytes ${maxBootstrap}`);
  }
  return { kind: 'BOOTSTRAP_SNAPSHOT', namespaceId, replicationId, replicationEpoch, snapshot };
}

function encodeBootstrapSnapshot(writer: PayloadWriter, msg: BootstrapSnapshotMsg, limits: FieldLimits | undefined): void {
  checkNamespaceId(msg.namespaceId);
  checkReplicationId(msg.replicationId);
  checkReplicationEpoch(msg.replicationEpoch);
  const maxBootstrap = resolveFieldLimit(limits?.maxBootstrapBytes, 'maxBootstrapBytes');
  if (maxBootstrap !== undefined && msg.snapshot.byteLength > maxBootstrap) {
    throw new ProtocolError('BOOTSTRAP_TOO_LARGE', `snapshot ${msg.snapshot.byteLength} exceeds maxBootstrapBytes ${maxBootstrap}`);
  }
  writer.writeVarString(msg.namespaceId, 'namespaceId');
  writer.writeVarString(msg.replicationId, 'replicationId');
  writer.writeVarUint(msg.replicationEpoch, 'replicationEpoch');
  writer.writeVarUint8Array(msg.snapshot);
}

// ---------------------------------------------------------------- BOOTSTRAP_ACK 0x21 / IDENTITY_CHANGED 0x22

function decodeBootstrapAck(reader: CanonicalReader): BootstrapAckMsg {
  const namespaceId = reader.readVarString();
  checkNamespaceId(namespaceId);
  return { kind: 'BOOTSTRAP_ACK', namespaceId, ackedSequence: readU32Field(reader) };
}

function encodeBootstrapAck(writer: PayloadWriter, msg: BootstrapAckMsg): void {
  checkNamespaceId(msg.namespaceId);
  assertU32(msg.ackedSequence, 'ackedSequence');
  writer.writeVarString(msg.namespaceId, 'namespaceId');
  writer.writeVarUint32(msg.ackedSequence, 'ackedSequence');
}

function decodeIdentityChanged(reader: CanonicalReader): IdentityChangedMsg {
  const namespaceId = reader.readVarString();
  checkNamespaceId(namespaceId);
  const replicationId = reader.readVarString();
  checkReplicationId(replicationId);
  const replicationEpoch = reader.readVarUint();
  checkReplicationEpoch(replicationEpoch);
  return { kind: 'IDENTITY_CHANGED', namespaceId, replicationId, replicationEpoch };
}

function encodeIdentityChanged(writer: PayloadWriter, msg: IdentityChangedMsg): void {
  checkNamespaceId(msg.namespaceId);
  checkReplicationId(msg.replicationId);
  checkReplicationEpoch(msg.replicationEpoch);
  writer.writeVarString(msg.namespaceId, 'namespaceId');
  writer.writeVarString(msg.replicationId, 'replicationId');
  writer.writeVarUint(msg.replicationEpoch, 'replicationEpoch');
}

// ---------------------------------------------------------------- SYNC_STEP1 0x30 / SYNC_STEP2 0x31

function decodeSyncStep1(reader: CanonicalReader): SyncStep1Msg {
  const namespaceId = reader.readVarString();
  checkNamespaceId(namespaceId);
  const syncRoundId = readU32Field(reader);
  const stateVector = reader.readVarUint8ArrayCopy();
  return { kind: 'SYNC_STEP1', namespaceId, syncRoundId, stateVector };
}

function encodeSyncStep1(writer: PayloadWriter, msg: SyncStep1Msg): void {
  checkNamespaceId(msg.namespaceId);
  assertU32(msg.syncRoundId, 'syncRoundId');
  writer.writeVarString(msg.namespaceId, 'namespaceId');
  writer.writeVarUint32(msg.syncRoundId, 'syncRoundId');
  writer.writeVarUint8Array(msg.stateVector);
}

function decodeSyncStep2(reader: CanonicalReader, limits: FieldLimits | undefined): SyncStep2Msg {
  const namespaceId = reader.readVarString();
  checkNamespaceId(namespaceId);
  const syncRoundId = readU32Field(reader);
  const relatedStep1Sequence = readU32Field(reader);
  const update = reader.readVarUint8ArrayCopy();
  const maxSyncDiff = resolveFieldLimit(limits?.maxSyncDiffBytes, 'maxSyncDiffBytes');
  if (maxSyncDiff !== undefined && update.byteLength > maxSyncDiff) {
    throw new ProtocolError('SYNC_DIFF_TOO_LARGE', `update ${update.byteLength} exceeds maxSyncDiffBytes ${maxSyncDiff}`);
  }
  return { kind: 'SYNC_STEP2', namespaceId, syncRoundId, relatedStep1Sequence, update };
}

function encodeSyncStep2(writer: PayloadWriter, msg: SyncStep2Msg, limits: FieldLimits | undefined): void {
  checkNamespaceId(msg.namespaceId);
  assertU32(msg.syncRoundId, 'syncRoundId');
  assertU32(msg.relatedStep1Sequence, 'relatedStep1Sequence');
  const maxSyncDiff = resolveFieldLimit(limits?.maxSyncDiffBytes, 'maxSyncDiffBytes');
  if (maxSyncDiff !== undefined && msg.update.byteLength > maxSyncDiff) {
    throw new ProtocolError('SYNC_DIFF_TOO_LARGE', `update ${msg.update.byteLength} exceeds maxSyncDiffBytes ${maxSyncDiff}`);
  }
  writer.writeVarString(msg.namespaceId, 'namespaceId');
  writer.writeVarUint32(msg.syncRoundId, 'syncRoundId');
  writer.writeVarUint32(msg.relatedStep1Sequence, 'relatedStep1Sequence');
  writer.writeVarUint8Array(msg.update);
}

// ---------------------------------------------------------------- SYNC_APPLIED 0x32 / RESYNC_REQUIRED 0x33

function decodeSyncApplied(reader: CanonicalReader): SyncAppliedMsg {
  const namespaceId = reader.readVarString();
  checkNamespaceId(namespaceId);
  const syncRoundId = readU32Field(reader);
  const ackedSequence = readU32Field(reader);
  return { kind: 'SYNC_APPLIED', namespaceId, syncRoundId, ackedSequence };
}

function encodeSyncApplied(writer: PayloadWriter, msg: SyncAppliedMsg): void {
  checkNamespaceId(msg.namespaceId);
  assertU32(msg.syncRoundId, 'syncRoundId');
  assertU32(msg.ackedSequence, 'ackedSequence');
  writer.writeVarString(msg.namespaceId, 'namespaceId');
  writer.writeVarUint32(msg.syncRoundId, 'syncRoundId');
  writer.writeVarUint32(msg.ackedSequence, 'ackedSequence');
}

function decodeResyncRequired(reader: CanonicalReader): ResyncRequiredMsg {
  const namespaceId = reader.readVarString();
  checkNamespaceId(namespaceId);
  const reasonCode = reader.readVarString();
  checkNonEmpty(reasonCode, 'reasonCode');
  return { kind: 'RESYNC_REQUIRED', namespaceId, reasonCode };
}

function encodeResyncRequired(writer: PayloadWriter, msg: ResyncRequiredMsg): void {
  checkNamespaceId(msg.namespaceId);
  checkNonEmpty(msg.reasonCode, 'reasonCode');
  writer.writeVarString(msg.namespaceId, 'namespaceId');
  writer.writeVarString(msg.reasonCode, 'reasonCode');
}

// ---------------------------------------------------------------- UPDATE 0x40 / UPDATE_ACK 0x41

function decodeUpdate(reader: CanonicalReader, limits: FieldLimits | undefined): UpdateMsg {
  const namespaceId = reader.readVarString();
  checkNamespaceId(namespaceId);
  const update = reader.readVarUint8ArrayCopy();
  const maxUpdate = resolveFieldLimit(limits?.maxUpdateBytes, 'maxUpdateBytes');
  if (maxUpdate !== undefined && update.byteLength > maxUpdate) {
    throw new ProtocolError('UPDATE_TOO_LARGE', `update ${update.byteLength} exceeds maxUpdateBytes ${maxUpdate}`);
  }
  return { kind: 'UPDATE', namespaceId, update };
}

function encodeUpdate(writer: PayloadWriter, msg: UpdateMsg, limits: FieldLimits | undefined): void {
  checkNamespaceId(msg.namespaceId);
  const maxUpdate = resolveFieldLimit(limits?.maxUpdateBytes, 'maxUpdateBytes');
  if (maxUpdate !== undefined && msg.update.byteLength > maxUpdate) {
    throw new ProtocolError('UPDATE_TOO_LARGE', `update ${msg.update.byteLength} exceeds maxUpdateBytes ${maxUpdate}`);
  }
  writer.writeVarString(msg.namespaceId, 'namespaceId');
  writer.writeVarUint8Array(msg.update);
}

function decodeUpdateAck(reader: CanonicalReader): UpdateAckMsg {
  const namespaceId = reader.readVarString();
  checkNamespaceId(namespaceId);
  return { kind: 'UPDATE_ACK', namespaceId, ackedSequence: readU32Field(reader) };
}

function encodeUpdateAck(writer: PayloadWriter, msg: UpdateAckMsg): void {
  checkNamespaceId(msg.namespaceId);
  assertU32(msg.ackedSequence, 'ackedSequence');
  writer.writeVarString(msg.namespaceId, 'namespaceId');
  writer.writeVarUint32(msg.ackedSequence, 'ackedSequence');
}

// ---------------------------------------------------------------- UPDATE_CHUNK 0x42
//
// issue #295 切片 1（ADR 0022 / 协议 §10.3）：kind 首字段单形态。字段序（唯一权威 = 协议
// §10.3 字段表 + §10.3「单形态」段）：kind(varUint, 0=live-update/1=snapshot/2=sync-diff)
// → namespaceId(varString) → transferId(varUint, uint32) → chunkIndex(varUint, uint32)
// → chunkCount(varUint, uint32) → totalBytes(varUint, uint32) → [绑定块] → bytes(varUint8Array)。
// 绑定块当且仅当 kind≠0 ∧ chunkIndex=0 存在，位置 = totalBytes 之后、bytes 之前：
// kind=1 → replicationId(varString) + replicationEpoch(varUint)；kind=2 → syncRoundId(varUint)。
// 单帧语义自洽规则（decode/encode 同一套，R9 对称；违规 → MALFORMED_FRAME）：
// kind ∈ {0,1,2}；绑定块当且仅当 kind≠0 ∧ chunkIndex=0（encode 侧严格拒绝，不做归一化）；
// transferId ≥ 1；chunkIndex < chunkCount；chunkCount ≥ 1；bytes 非空；
// totalBytes ≥ bytes.byteLength。字段限额复用 maxUpdateBytes（超限 → UPDATE_TOO_LARGE，
// kind 无关）。绑定块**内容**核对（REPLICATION_ID_MISMATCH 等）与跨帧规则（transferId
// 一致性/单调、chunkIndex === 已收数量、实收 == totalBytes）属接收端 assembly 状态机与
// §8.1/§9.2 后续切片，codec 无状态、不承载（ADR 0022 同版本部署假设，无旧形态兼容面）。

function decodeUpdateChunk(reader: CanonicalReader, limits: FieldLimits | undefined): UpdateChunkMsg {
  // kind 首字段先行：非法值在首个字节流入处即拒绝（ADR 0022「恶意声明在第一个字节流入前
  // 即可拒绝」）；ADR 0013 六字段旧形态首字节 0x23=35 与 {0,1,2} 不相交 → 自动作废。
  const transferKind = reader.readVarUint();
  if (transferKind !== 0 && transferKind !== 1 && transferKind !== 2) {
    throwMalformed('transferKind must be 0|1|2');
  }
  const namespaceId = reader.readVarString();
  checkNamespaceId(namespaceId);
  const transferId = reader.readVarUint32();
  if (transferId < 1) {
    throwMalformed('transferId must be >= 1');
  }
  const chunkIndex = reader.readVarUint32();
  const chunkCount = reader.readVarUint32();
  if (chunkCount < 1) {
    throwMalformed('chunkCount must be >= 1');
  }
  if (chunkIndex >= chunkCount) {
    throwMalformed('chunkIndex must be < chunkCount');
  }
  const totalBytes = reader.readVarUint32();
  // 绑定块（当且仅当 kind≠0 ∧ chunkIndex=0；仅按 wire 位置读取——缺块/越位/尾随经
  // canonical reader 的缓冲欠载与全消费检查收敛为 MALFORMED_FRAME，无需额外分支）。
  let replicationId: string | undefined;
  let replicationEpoch: number | undefined;
  let syncRoundId: number | undefined;
  if (transferKind !== 0 && chunkIndex === 0) {
    if (transferKind === 1) {
      replicationId = reader.readVarString();
      replicationEpoch = reader.readVarUint();
    } else {
      syncRoundId = reader.readVarUint();
    }
  }
  const bytes = reader.readVarUint8ArrayCopy();
  if (bytes.byteLength < 1) {
    throwMalformed('bytes must not be empty');
  }
  if (bytes.byteLength > totalBytes) {
    throwMalformed('bytes must not exceed totalBytes');
  }
  const maxUpdate = resolveFieldLimit(limits?.maxUpdateBytes, 'maxUpdateBytes');
  if (maxUpdate !== undefined && bytes.byteLength > maxUpdate) {
    throw new ProtocolError('UPDATE_TOO_LARGE', `bytes ${bytes.byteLength} exceeds maxUpdateBytes ${maxUpdate}`);
  }
  return {
    kind: 'UPDATE_CHUNK',
    transferKind,
    namespaceId,
    transferId,
    chunkIndex,
    chunkCount,
    totalBytes,
    ...(replicationId === undefined ? {} : { replicationId }),
    ...(replicationEpoch === undefined ? {} : { replicationEpoch }),
    ...(syncRoundId === undefined ? {} : { syncRoundId }),
    bytes,
  };
}

function encodeUpdateChunk(writer: PayloadWriter, msg: UpdateChunkMsg, limits: FieldLimits | undefined): void {
  // kind 值域（D1 类型面已收窄；JS 调用方/cast 防御）。
  if (!Number.isSafeInteger(msg.transferKind) || msg.transferKind < 0 || msg.transferKind > 2) {
    throwMalformed('transferKind must be 0|1|2');
  }
  const transferKind = msg.transferKind as 0 | 1 | 2;
  checkNamespaceId(msg.namespaceId);
  if (!Number.isSafeInteger(msg.transferId) || msg.transferId < 1 || msg.transferId > 0xffffffff) {
    throwMalformed('transferId must be a uint32 >= 1');
  }
  if (!Number.isSafeInteger(msg.chunkIndex) || msg.chunkIndex < 0 || msg.chunkIndex > 0xffffffff) {
    throwMalformed('chunkIndex must fit in uint32');
  }
  if (!Number.isSafeInteger(msg.chunkCount) || msg.chunkCount < 1 || msg.chunkCount > 0xffffffff) {
    throwMalformed('chunkCount must be a uint32 >= 1');
  }
  if (msg.chunkIndex >= msg.chunkCount) {
    throwMalformed('chunkIndex must be < chunkCount');
  }
  if (!Number.isSafeInteger(msg.totalBytes) || msg.totalBytes < 0 || msg.totalBytes > 0xffffffff) {
    throwMalformed('totalBytes must fit in uint32');
  }
  // 绑定块 iff 严格拒绝（R9 对称：encode/decode 同一套单帧规则；不做 writer 归一化，
  // 丢弃或补默认会静默改写调用方输入并破坏 decode→encode→decode 等价）。
  const hasReplicationId = msg.replicationId !== undefined;
  const hasReplicationEpoch = msg.replicationEpoch !== undefined;
  const hasSyncRoundId = msg.syncRoundId !== undefined;
  const bindingAtFirstChunk = transferKind !== 0 && msg.chunkIndex === 0;
  if (transferKind === 0) {
    if (hasReplicationId || hasReplicationEpoch || hasSyncRoundId) {
      throwMalformed('binding block members must be absent when transferKind=0');
    }
  } else if (!bindingAtFirstChunk) {
    if (hasReplicationId || hasReplicationEpoch || hasSyncRoundId) {
      throwMalformed('binding block members must be absent when chunkIndex > 0');
    }
  } else if (transferKind === 1) {
    if (!hasReplicationId || typeof msg.replicationId !== 'string') {
      throwMalformed('replicationId is required for transferKind=1 first chunk');
    }
    if (
      !hasReplicationEpoch ||
      !Number.isSafeInteger(msg.replicationEpoch) ||
      (msg.replicationEpoch as number) < 0
    ) {
      throwMalformed('replicationEpoch must be a non-negative safe integer for transferKind=1 first chunk');
    }
    if (hasSyncRoundId) {
      throwMalformed('syncRoundId must be absent for transferKind=1');
    }
  } else {
    if (hasReplicationId || hasReplicationEpoch) {
      throwMalformed('replicationId/replicationEpoch must be absent for transferKind=2');
    }
    if (!hasSyncRoundId || !Number.isSafeInteger(msg.syncRoundId) || (msg.syncRoundId as number) < 0) {
      throwMalformed('syncRoundId must be a non-negative safe integer for transferKind=2 first chunk');
    }
  }
  if (!(msg.bytes instanceof Uint8Array) || msg.bytes.byteLength < 1) {
    throwMalformed('bytes must be a non-empty Uint8Array');
  }
  if (msg.bytes.byteLength > msg.totalBytes) {
    throwMalformed('bytes must not exceed totalBytes');
  }
  const maxUpdate = resolveFieldLimit(limits?.maxUpdateBytes, 'maxUpdateBytes');
  if (maxUpdate !== undefined && msg.bytes.byteLength > maxUpdate) {
    throw new ProtocolError('UPDATE_TOO_LARGE', `bytes ${msg.bytes.byteLength} exceeds maxUpdateBytes ${maxUpdate}`);
  }
  // 写序 = 读序镜像（D3/D4）。
  writer.writeVarUint(transferKind, 'transferKind');
  writer.writeVarString(msg.namespaceId, 'namespaceId');
  writer.writeVarUint32(msg.transferId, 'transferId');
  writer.writeVarUint32(msg.chunkIndex, 'chunkIndex');
  writer.writeVarUint32(msg.chunkCount, 'chunkCount');
  writer.writeVarUint32(msg.totalBytes, 'totalBytes');
  if (bindingAtFirstChunk) {
    if (transferKind === 1) {
      writer.writeVarString(msg.replicationId as string, 'replicationId');
      writer.writeVarUint(msg.replicationEpoch as number, 'replicationEpoch');
    } else {
      writer.writeVarUint(msg.syncRoundId as number, 'syncRoundId');
    }
  }
  writer.writeVarUint8Array(msg.bytes);
}

// ---------------------------------------------------------------- 分发

function decodePayload(messageType: number, reader: CanonicalReader, limits: FieldLimits | undefined): ReplicationMessage {
  switch (messageType) {
    case MESSAGE_TYPES.HELLO:
      return decodeHello(reader);
    case MESSAGE_TYPES.HELLO_ACK:
      return decodeHelloAck(reader);
    case MESSAGE_TYPES.GOAWAY:
      return decodeGoaway(reader);
    case MESSAGE_TYPES.ERROR:
      return decodeError(reader);
    case MESSAGE_TYPES.OPEN_NAMESPACE:
      return decodeOpenNamespace(reader);
    case MESSAGE_TYPES.OPEN_OK:
      return decodeOpenOk(reader);
    case MESSAGE_TYPES.CLOSE_NAMESPACE:
      return decodeCloseNamespace(reader);
    case MESSAGE_TYPES.CLOSE_OK:
      return decodeCloseOk(reader);
    case MESSAGE_TYPES.BOOTSTRAP_SNAPSHOT:
      return decodeBootstrapSnapshot(reader, limits);
    case MESSAGE_TYPES.BOOTSTRAP_ACK:
      return decodeBootstrapAck(reader);
    case MESSAGE_TYPES.IDENTITY_CHANGED:
      return decodeIdentityChanged(reader);
    case MESSAGE_TYPES.SYNC_STEP1:
      return decodeSyncStep1(reader);
    case MESSAGE_TYPES.SYNC_STEP2:
      return decodeSyncStep2(reader, limits);
    case MESSAGE_TYPES.SYNC_APPLIED:
      return decodeSyncApplied(reader);
    case MESSAGE_TYPES.RESYNC_REQUIRED:
      return decodeResyncRequired(reader);
    case MESSAGE_TYPES.UPDATE:
      return decodeUpdate(reader, limits);
    case MESSAGE_TYPES.UPDATE_ACK:
      return decodeUpdateAck(reader);
    case MESSAGE_TYPES.UPDATE_CHUNK:
      return decodeUpdateChunk(reader, limits);
    default:
      throw new ProtocolError('UNSUPPORTED_MESSAGE_TYPE', `unknown message type 0x${messageType.toString(16)}`);
  }
}

function encodePayload(writer: PayloadWriter, message: ReplicationMessage, limits: FieldLimits | undefined): void {
  switch (message.kind) {
    case 'HELLO':
      return encodeHello(writer, message);
    case 'HELLO_ACK':
      return encodeHelloAck(writer, message);
    case 'GOAWAY':
      return encodeGoaway(writer, message);
    case 'ERROR':
      return encodeError(writer, message);
    case 'OPEN_NAMESPACE':
      return encodeOpenNamespace(writer, message);
    case 'OPEN_OK':
      return encodeOpenOk(writer, message);
    case 'CLOSE_NAMESPACE':
      return encodeCloseNamespace(writer, message);
    case 'CLOSE_OK':
      return encodeCloseOk(writer, message);
    case 'BOOTSTRAP_SNAPSHOT':
      return encodeBootstrapSnapshot(writer, message, limits);
    case 'BOOTSTRAP_ACK':
      return encodeBootstrapAck(writer, message);
    case 'IDENTITY_CHANGED':
      return encodeIdentityChanged(writer, message);
    case 'SYNC_STEP1':
      return encodeSyncStep1(writer, message);
    case 'SYNC_STEP2':
      return encodeSyncStep2(writer, message, limits);
    case 'SYNC_APPLIED':
      return encodeSyncApplied(writer, message);
    case 'RESYNC_REQUIRED':
      return encodeResyncRequired(writer, message);
    case 'UPDATE':
      return encodeUpdate(writer, message, limits);
    case 'UPDATE_ACK':
      return encodeUpdateAck(writer, message);
    case 'UPDATE_CHUNK':
      return encodeUpdateChunk(writer, message, limits);
    default: {
      // 运行时防御（JS 调用方传入未知 kind）；typed caller 不可达。
      const never: never = message;
      void never;
      throw new ProtocolError('UNSUPPORTED_MESSAGE_TYPE', 'unknown message kind');
    }
  }
}

/**
 * 解码完整消息：先 decodeFrame（9 步固定检查，含 expectedSequence/maxFrameBytes），
 * 再对 DecodeOptions.selectedCapabilities 做急切解析/校验（issue #242 D-3：对所有消息类型
 * 一致生效，与 header.messageType 无关；非法值 → CONNECTION_POLICY_VIOLATION），
 * 然后按 messageType 解码 payload：UPDATE_CHUNK 未协商（selected & CAP_CHUNKED_UPDATE === 0）
 * 在 payload 解析前抛 UNSUPPORTED_MESSAGE_TYPE（connection fatal），最后 expectEnd（R1 完全消费）。
 * 拒绝顺序（§9）：帧级 9 步 → 选项急切校验 → 门控 → 载荷级字段规则。
 */
export function decodeMessage(bytes: Uint8Array, options?: DecodeOptions): DecodedMessage {
  const { header, payload } = decodeFrame(bytes, options);
  const selectedCapabilities = resolveSelectedCapabilities(options?.selectedCapabilities);
  if (header.messageType === MESSAGE_TYPES.UPDATE_CHUNK && ((selectedCapabilities ?? 0) & CAP_CHUNKED_UPDATE) === 0) {
    throw new ProtocolError(
      'UNSUPPORTED_MESSAGE_TYPE',
      'UPDATE_CHUNK requires negotiated CAP_CHUNKED_UPDATE (0x42 rejected by non-negotiating endpoint)',
    );
  }
  const reader = new CanonicalReader(payload);
  const message = decodePayload(header.messageType, reader, options?.limits);
  reader.expectEnd();
  return { header, message };
}

/**
 * 编码完整消息：先做与解码同一套字段验证（R9），再按字段表写入 payload，
 * 最后 encodeFrame 组装 20-byte 头（sequence 缺省 1）。
 */
export function encodeMessage(message: ReplicationMessage, options?: EncodeOptions): Uint8Array {
  const payloadWriter = new PayloadWriter();
  encodePayload(payloadWriter, message, options?.limits);
  const payload = payloadWriter.finish();
  const sequence = options?.sequence ?? 1;
  return encodeFrame(
    { messageType: MESSAGE_TYPES[message.kind], sequence, payload },
    options?.maxFrameBytes === undefined ? undefined : { maxFrameBytes: options.maxFrameBytes },
  );
}
