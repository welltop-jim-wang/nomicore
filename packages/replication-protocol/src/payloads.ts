/**
 * 17 种消息的 payload 编解码 + 字段级验证（设计 §7 字段表逐条落地）。
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
 */
import { CanonicalReader, PayloadWriter, assertNonNegativeSafeInteger, assertU32, throwMalformed } from './canonical.js';
import { INSTANCE_ID_RE, NAMESPACE_ID_RE, NONCE_BYTES, REPLICATION_ID_RE } from './constants.js';
import { decodeFrame, encodeFrame, type FrameHeader } from './envelope.js';
import { ProtocolError, lookupError } from './errors.js';
import { resolveFieldLimit, type DecodeOptions, type EncodeOptions, type FieldLimits } from './limits.js';
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

/** uint32 语义字段（R8：syncRoundId/ackedSequence/relatedStep1Sequence/relatedSequence）。 */
function readU32Field(reader: CanonicalReader, name: string): number {
  const v = reader.readVarUint32();
  if (v > 0xffffffff) {
    throwMalformed(`${name} must fit in uint32`);
  }
  return v;
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
    relatedSequence = readU32Field(reader, 'relatedSequence');
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
  return { kind: 'CLOSE_OK', namespaceId, ackedSequence: readU32Field(reader, 'ackedSequence') };
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
  return { kind: 'BOOTSTRAP_ACK', namespaceId, ackedSequence: readU32Field(reader, 'ackedSequence') };
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
  const syncRoundId = readU32Field(reader, 'syncRoundId');
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
  const syncRoundId = readU32Field(reader, 'syncRoundId');
  const relatedStep1Sequence = readU32Field(reader, 'relatedStep1Sequence');
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
  const syncRoundId = readU32Field(reader, 'syncRoundId');
  const ackedSequence = readU32Field(reader, 'ackedSequence');
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
  return { kind: 'UPDATE_ACK', namespaceId, ackedSequence: readU32Field(reader, 'ackedSequence') };
}

function encodeUpdateAck(writer: PayloadWriter, msg: UpdateAckMsg): void {
  checkNamespaceId(msg.namespaceId);
  assertU32(msg.ackedSequence, 'ackedSequence');
  writer.writeVarString(msg.namespaceId, 'namespaceId');
  writer.writeVarUint32(msg.ackedSequence, 'ackedSequence');
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
 * 再按 messageType 解码 payload（字段表校验），最后 expectEnd（R1 完全消费）。
 */
export function decodeMessage(bytes: Uint8Array, options?: DecodeOptions): DecodedMessage {
  const { header, payload } = decodeFrame(bytes, options);
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
