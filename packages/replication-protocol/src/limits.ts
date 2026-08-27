/**
 * 配置 limits：FieldLimits 类型、options/limits 值校验、启动响亮验证 validateCodecLimits。
 *
 * 权威来源：docs/protocols/instance-replication-v1.md §17（配置启动时响亮验证，不得运行时 clamp）。
 * - maxFrameBytes 缺省 DEFAULT_MAX_FRAME_BYTES（16 MiB）；字段级限额缺省 = 不设限（仍受帧级约束）；
 * - codec 对显式传入的 options/limits 值做同类校验：负数/非整数/非有限 → CONNECTION_POLICY_VIOLATION；
 *   未传字段不参与跨字段校验（保持 Partial 语义）；
 * - validateCodecLimits 面向组装期：三个字段级限额 ≤ maxFrameBytes − PROTOCOL_OVERHEAD_BYTES(128)，
 *   违规则响亮 throw CONNECTION_POLICY_VIOLATION，绝不 clamp。
 */
import { DEFAULT_MAX_FRAME_BYTES, PROTOCOL_OVERHEAD_BYTES } from './constants.js';
import { ProtocolError } from './errors.js';

/** 字段级限额（全部可选；缺省不设限）。 */
export interface FieldLimits {
  maxUpdateBytes?: number;
  maxBootstrapBytes?: number;
  maxSyncDiffBytes?: number;
}

/** decodeFrame/decodeMessage 选项。 */
export interface DecodeOptions {
  maxFrameBytes?: number;
  expectedSequence?: number;
  limits?: FieldLimits;
}

/** encodeMessage 选项（sequence 缺省 1）。 */
export interface EncodeOptions {
  sequence?: number;
  maxFrameBytes?: number;
  limits?: FieldLimits;
}

function throwPolicy(detail: string): never {
  throw new ProtocolError('CONNECTION_POLICY_VIOLATION', detail);
}

/** 正有限安全整数校验（maxFrameBytes 与字段级限额的公共判据）。 */
export function validatePositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throwPolicy(`${name} must be a positive safe integer`);
  }
}

/** 解析 maxFrameBytes：缺省 DEFAULT_MAX_FRAME_BYTES；显式值非法 → CONNECTION_POLICY_VIOLATION。 */
export function resolveMaxFrameBytes(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_FRAME_BYTES;
  validatePositiveSafeInteger(value, 'maxFrameBytes');
  return value;
}

/** 解析 expectedSequence：缺省 undefined（不检查）；显式值必须为 uint32 安全整数。 */
export function resolveExpectedSequence(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throwPolicy('expectedSequence must be a uint32');
  }
  return value;
}

/** 解析单个字段限额：缺省 undefined（不设限）；显式值非法 → CONNECTION_POLICY_VIOLATION。 */
export function resolveFieldLimit(value: number | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  validatePositiveSafeInteger(value, name);
  return value;
}

/**
 * 启动响亮验证（规范 §17）：四值均须正有限安全整数；
 * maxUpdateBytes/maxBootstrapBytes/maxSyncDiffBytes ≤ maxFrameBytes − PROTOCOL_OVERHEAD_BYTES(128)。
 * 违规 → ProtocolError('CONNECTION_POLICY_VIOLATION')（配置错误，响亮 assert，绝不 clamp 后继续）。
 */
export function validateCodecLimits(limits: {
  maxFrameBytes: number;
  maxUpdateBytes: number;
  maxBootstrapBytes: number;
  maxSyncDiffBytes: number;
}): void {
  validatePositiveSafeInteger(limits.maxFrameBytes, 'maxFrameBytes');
  validatePositiveSafeInteger(limits.maxUpdateBytes, 'maxUpdateBytes');
  validatePositiveSafeInteger(limits.maxBootstrapBytes, 'maxBootstrapBytes');
  validatePositiveSafeInteger(limits.maxSyncDiffBytes, 'maxSyncDiffBytes');
  const budget = limits.maxFrameBytes - PROTOCOL_OVERHEAD_BYTES;
  if (limits.maxUpdateBytes > budget) {
    throwPolicy(`maxUpdateBytes ${limits.maxUpdateBytes} exceeds maxFrameBytes - PROTOCOL_OVERHEAD_BYTES (${budget})`);
  }
  if (limits.maxBootstrapBytes > budget) {
    throwPolicy(`maxBootstrapBytes ${limits.maxBootstrapBytes} exceeds maxFrameBytes - PROTOCOL_OVERHEAD_BYTES (${budget})`);
  }
  if (limits.maxSyncDiffBytes > budget) {
    throwPolicy(`maxSyncDiffBytes ${limits.maxSyncDiffBytes} exceeds maxFrameBytes - PROTOCOL_OVERHEAD_BYTES (${budget})`);
  }
}
