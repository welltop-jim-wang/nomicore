/**
 * 固定 20-byte 大端 NMCR envelope：encodeFrame / decodeFrame。
 *
 * 权威来源：docs/protocols/instance-replication-v1.md §3。
 * 检查顺序（固定的 9 步——顺序即分类确定性，与 test/fixtures.ts 顶部契约注释一致）：
 *   1. byteLength < 4 或 magic ≠ 'NMCR'        → BAD_MAGIC
 *   2. byteLength < 20                          → FRAME_LENGTH_MISMATCH
 *   3. envelopeVersion !== 1                    → UNSUPPORTED_ENVELOPE_VERSION
 *   4. flags !== 0                              → UNSUPPORTED_FLAGS
 *   5. reserved !== 0                           → MALFORMED_FRAME
 *   6. messageType 未注册                       → UNSUPPORTED_MESSAGE_TYPE
 *   7. byteLength > maxFrameBytes（缺省 16MiB） → FRAME_TOO_LARGE
 *   8. byteLength !== 20 + payloadLength        → FRAME_LENGTH_MISMATCH
 *   9. expectedSequence 提供且不等              → SEQUENCE_VIOLATION
 *
 * payload 是输入的 subarray 只读视图（零拷贝，绝不复制/分配/写入）；
 * 校验（步骤 8/9）发生在任何按 payloadLength 复制/分配之前——由构造满足。
 * 注意（决策 D-5）：payload 视图的原型跟随输入 buffer；输入为 Node Buffer 时视图原型
 * 是 Buffer.prototype，调用方不得以原型做 Buffer 嗅探或身份判断。本包自产输出
 * （encodeFrame/encodeMessage 结果、decodeMessage 字段 bytes）原型恒为 Uint8Array.prototype。
 */
import { ENVELOPE_HEADER_BYTES, ENVELOPE_MAGIC, ENVELOPE_VERSION } from './constants.js';
import { ProtocolError } from './errors.js';
import { MESSAGE_NAMES } from './messages.js';
import { type DecodeOptions, resolveExpectedSequence, resolveMaxFrameBytes } from './limits.js';

/** 20-byte 大端头解析结果。 */
export interface FrameHeader {
  readonly envelopeVersion: number;
  readonly messageType: number;
  readonly flags: number;
  readonly sequence: number;
  readonly payloadLength: number;
  readonly reserved: number;
}

/** decodeFrame 结果：header + payload 视图（subarray，与输入共享底层 buffer）。 */
export interface DecodedFrame {
  readonly header: FrameHeader;
  readonly payload: Uint8Array;
}

/** encodeFrame 输入（帧级：messageType/sequence/payload）。 */
export interface EncodeFrameInput {
  messageType: number;
  sequence: number;
  payload: Uint8Array;
}

/** encodeFrame 选项。 */
export interface FrameOptions {
  maxFrameBytes?: number;
}

function readBe16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 8) | bytes[offset + 1]!;
}

function readBe32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
}

function writeBe32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

/**
 * 解码一个完整 frame。
 *
 * 9 步固定检查顺序（见文件头注释）；任何失败只抛 ProtocolError 且 code ∈ 错误注册表。
 * 成功时 header 字段按 head 布局解析、payload 为输入的零拷贝视图（不复制不分配）。
 */
export function decodeFrame(bytes: Uint8Array, options?: DecodeOptions): DecodedFrame {
  if (!(bytes instanceof Uint8Array)) {
    throw new ProtocolError('MALFORMED_FRAME', 'input must be a Uint8Array');
  }
  const maxFrameBytes = resolveMaxFrameBytes(options?.maxFrameBytes);
  const expectedSequence = resolveExpectedSequence(options?.expectedSequence);
  // 1. magic
  if (
    bytes.byteLength < 4 ||
    bytes[0] !== 0x4e ||
    bytes[1] !== 0x4d ||
    bytes[2] !== 0x43 ||
    bytes[3] !== 0x52
  ) {
    throw new ProtocolError('BAD_MAGIC', `expected magic ${ENVELOPE_MAGIC}`);
  }
  // 2. 头长
  if (bytes.byteLength < ENVELOPE_HEADER_BYTES) {
    throw new ProtocolError('FRAME_LENGTH_MISMATCH', 'frame shorter than 20-byte header');
  }
  // 3. 版本
  if (bytes[4] !== ENVELOPE_VERSION) {
    throw new ProtocolError('UNSUPPORTED_ENVELOPE_VERSION', `envelopeVersion must be ${ENVELOPE_VERSION}`);
  }
  // 4. flags
  if (readBe16(bytes, 6) !== 0) {
    throw new ProtocolError('UNSUPPORTED_FLAGS', 'flags must be zero');
  }
  // 5. reserved
  if (readBe32(bytes, 16) !== 0) {
    throw new ProtocolError('MALFORMED_FRAME', 'reserved must be zero');
  }
  // 6. messageType
  const messageType = bytes[5]!;
  if (MESSAGE_NAMES[messageType] === undefined) {
    throw new ProtocolError('UNSUPPORTED_MESSAGE_TYPE', `unknown message type 0x${messageType.toString(16)}`);
  }
  // 7. 帧大小上限（缺省 16 MiB；byteLength === maxFrameBytes 通过）
  if (bytes.byteLength > maxFrameBytes) {
    throw new ProtocolError('FRAME_TOO_LARGE', `frame byteLength ${bytes.byteLength} exceeds maxFrameBytes ${maxFrameBytes}`);
  }
  // 8. 长度一致性（少一/多一/尾随/巨大声明短 body 全部拒绝；发生在任何 payload 复制/分配之前）
  const payloadLength = readBe32(bytes, 12);
  if (bytes.byteLength !== ENVELOPE_HEADER_BYTES + payloadLength) {
    throw new ProtocolError(
      'FRAME_LENGTH_MISMATCH',
      `declared payloadLength ${payloadLength} does not match actual payload ${bytes.byteLength - ENVELOPE_HEADER_BYTES}`,
    );
  }
  // 9. sequence seam（严格相等；起始/递增/回绕纪律归状态层）
  const sequence = readBe32(bytes, 8);
  if (expectedSequence !== undefined && sequence !== expectedSequence) {
    throw new ProtocolError('SEQUENCE_VIOLATION', `expected sequence ${expectedSequence}, got ${sequence}`);
  }
  return {
    header: {
      envelopeVersion: ENVELOPE_VERSION,
      messageType,
      flags: 0,
      sequence,
      payloadLength,
      reserved: 0,
    },
    payload: bytes.subarray(ENVELOPE_HEADER_BYTES),
  };
}

/**
 * 编码一个完整 frame（20-byte 大端头 + payload 拷贝）。
 *
 * 检查顺序：未注册 messageType → 非法 sequence → 非 Uint8Array payload →
 * u32 长度溢出 → 20+payload 超过 maxFrameBytes。输出恒为全新分配的纯 Uint8Array。
 */
export function encodeFrame(frame: EncodeFrameInput, options?: FrameOptions): Uint8Array {
  const { messageType, sequence, payload } = frame;
  // a. messageType
  if (MESSAGE_NAMES[messageType] === undefined) {
    throw new ProtocolError('UNSUPPORTED_MESSAGE_TYPE', `unknown message type 0x${messageType.toString(16)}`);
  }
  // b. sequence 域
  if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > 0xffffffff) {
    throw new ProtocolError('MALFORMED_FRAME', 'sequence must be a uint32');
  }
  // c. payload 类型
  if (!(payload instanceof Uint8Array)) {
    throw new ProtocolError('MALFORMED_FRAME', 'payload must be a Uint8Array');
  }
  // d. u32 长度域溢出
  if (payload.byteLength > 0xffffffff) {
    throw new ProtocolError('MALFORMED_FRAME', 'payload byteLength overflows uint32');
  }
  // e. 帧大小上限
  const maxFrameBytes = resolveMaxFrameBytes(options?.maxFrameBytes);
  if (ENVELOPE_HEADER_BYTES + payload.byteLength > maxFrameBytes) {
    throw new ProtocolError('FRAME_TOO_LARGE', 'frame exceeds maxFrameBytes');
  }
  const out = new Uint8Array(ENVELOPE_HEADER_BYTES + payload.byteLength);
  out[0] = 0x4e;
  out[1] = 0x4d;
  out[2] = 0x43;
  out[3] = 0x52;
  out[4] = ENVELOPE_VERSION;
  out[5] = messageType;
  out[6] = 0;
  out[7] = 0;
  writeBe32(out, 8, sequence);
  writeBe32(out, 12, payload.byteLength);
  writeBe32(out, 16, 0);
  out.set(payload, ENVELOPE_HEADER_BYTES);
  return out;
}
