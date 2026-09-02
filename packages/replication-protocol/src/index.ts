/**
 * `@nomicore/replication-protocol` 公共 API（唯一入口，全部 re-export，无逻辑）。
 *
 * 纯二进制 codec：固定 20-byte NMCR envelope + lib0 canonical payload + 注册表元数据
 * + 协商纯函数。无状态、无 Cordis/WebSocket/Registry/Node 依赖（运行时唯一外部依赖
 * lib0/encoding，解码路径完全自研）。一切失败只抛 ProtocolError（code ∈ 错误注册表）。
 */
export {
  DEFAULT_MAX_FRAME_BYTES,
  ENVELOPE_HEADER_BYTES,
  ENVELOPE_MAGIC,
  ENVELOPE_VERSION,
  PROTOCOL_OVERHEAD_BYTES,
} from './constants.js';
export { CONNECTION_ERRORS, NAMESPACE_ERRORS, lookupError, ProtocolError } from './errors.js';
export type {
  ConnectionErrorCode,
  ErrorInfo,
  NamespaceErrorCode,
  RetryPolicy,
  TerminalState,
} from './errors.js';
export {
  MESSAGE_NAMES,
  MESSAGE_REGISTRY,
  MESSAGE_TYPES,
  type BootstrapAckMsg,
  type BootstrapSnapshotMsg,
  type CloseNamespaceMsg,
  type CloseOkMsg,
  type ErrorMsg,
  type GoawayMsg,
  type HelloAckMsg,
  type HelloMsg,
  type IdentityChangedMsg,
  type MessageDirection,
  type MessageInfo,
  type MessageName,
  type MessageScope,
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
export { decodeFrame, encodeFrame, type DecodedFrame, type EncodeFrameInput, type FrameHeader, type FrameOptions } from './envelope.js';
export { decodeMessage, encodeMessage, type DecodedMessage } from './payloads.js';
export { type DecodeOptions, type EncodeOptions, type FieldLimits, validateCodecLimits } from './limits.js';
export { selectCapabilities, selectProtocolVersion } from './negotiation.js';
