/**
 * ProtocolError 分类错误 + 连接/namespace 错误注册表（append-only、深冻结）。
 *
 * 权威来源：docs/protocols/instance-replication-v1.md §13.1（17 条连接错误）、
 * §13.2（20 条 namespace 错误，含双 registry INTERNAL_ERROR，元数据不同）。
 * 注册表是 codec 一切失败路径的元数据来源：scope/fatal/retryable/wsCloseCode/terminalState
 * 由注册表导出，调用方不可注入（AC4）。注册表条目对象与注册表对象全部 Object.freeze。
 */

/** 连接错误码（§13.1 全 17 个字面量）。 */
export type ConnectionErrorCode =
  | 'BAD_MAGIC'
  | 'UNSUPPORTED_ENVELOPE_VERSION'
  | 'MALFORMED_FRAME'
  | 'FRAME_LENGTH_MISMATCH'
  | 'FRAME_TOO_LARGE'
  | 'UNSUPPORTED_FLAGS'
  | 'UNSUPPORTED_MESSAGE_TYPE'
  | 'SEQUENCE_VIOLATION'
  | 'HELLO_REQUIRED'
  | 'HELLO_TIMEOUT'
  | 'UNSUPPORTED_PROTOCOL_VERSION'
  | 'UNSUPPORTED_CAPABILITY'
  | 'INSTANCE_IDENTITY_MISMATCH'
  | 'CONNECTION_POLICY_VIOLATION'
  | 'ACK_STATE_VIOLATION'
  | 'CONNECTION_BACKPRESSURE'
  | 'INTERNAL_ERROR';

/** namespace 错误码（§13.2 全 20 个字面量）。 */
export type NamespaceErrorCode =
  | 'TARGET_NOT_REQUESTED'
  | 'NAMESPACE_REOPEN_REQUIRES_RECONNECT'
  | 'NAMESPACE_UNAUTHORIZED'
  | 'NAMESPACE_NOT_FOUND'
  | 'REPLICATION_NOT_ENABLED'
  | 'REPLICATION_ID_MISMATCH'
  | 'REPLICATION_EPOCH_MISMATCH'
  | 'NAMESPACE_STATE_VIOLATION'
  | 'SYNC_STATE_VIOLATION'
  | 'BOOTSTRAP_TOO_LARGE'
  | 'BOOTSTRAP_FAILED'
  | 'SYNC_DIFF_TOO_LARGE'
  | 'UPDATE_TOO_LARGE'
  | 'PROTECTED_FIELD_MUTATION'
  | 'ROLE_VIOLATION'
  | 'PERSISTENCE_DEGRADED'
  | 'APPLY_FAILED'
  | 'ACK_TIMEOUT'
  | 'NAMESPACE_TIMEOUT'
  | 'INTERNAL_ERROR';

/** retryable 策略字面量联合（两表并集）。 */
export type RetryPolicy = 'no' | 'yes' | 'config' | 'reconnect' | 'reset' | 'recovery' | 'resync';

/** namespace 终止状态字面量联合。 */
export type TerminalState = 'failed' | 'closed' | 'conflicted' | 'needs-resync';

/**
 * 错误注册表条目元数据。
 * - connection 条目带 wsCloseCode（§14 粗分类 close code）；
 * - namespace 条目带 terminalState；
 * - 条目对象深冻结，scope 字段即所在注册表。
 */
export interface ErrorInfo {
  readonly code: string;
  readonly scope: 'connection' | 'namespace';
  readonly fatal: boolean;
  readonly retryable: RetryPolicy;
  readonly wsCloseCode?: number;
  readonly terminalState?: TerminalState;
}

function connectionError(
  code: ConnectionErrorCode,
  fatal: boolean,
  retryable: 'no' | 'yes' | 'config',
  wsCloseCode: number,
): ErrorInfo {
  return Object.freeze({ code, scope: 'connection', fatal, retryable, wsCloseCode });
}

function namespaceError(
  code: NamespaceErrorCode,
  fatal: boolean,
  retryable: 'no' | 'config' | 'reconnect' | 'reset' | 'recovery' | 'resync',
  terminalState: TerminalState,
): ErrorInfo {
  return Object.freeze({ code, scope: 'namespace', fatal, retryable, terminalState });
}

const _connectionErrors: Record<ConnectionErrorCode, ErrorInfo> = {
  BAD_MAGIC: connectionError('BAD_MAGIC', true, 'no', 1002),
  UNSUPPORTED_ENVELOPE_VERSION: connectionError('UNSUPPORTED_ENVELOPE_VERSION', true, 'no', 1002),
  MALFORMED_FRAME: connectionError('MALFORMED_FRAME', true, 'no', 1002),
  FRAME_LENGTH_MISMATCH: connectionError('FRAME_LENGTH_MISMATCH', true, 'no', 1002),
  FRAME_TOO_LARGE: connectionError('FRAME_TOO_LARGE', true, 'config', 1009),
  UNSUPPORTED_FLAGS: connectionError('UNSUPPORTED_FLAGS', true, 'no', 1002),
  UNSUPPORTED_MESSAGE_TYPE: connectionError('UNSUPPORTED_MESSAGE_TYPE', true, 'no', 1002),
  SEQUENCE_VIOLATION: connectionError('SEQUENCE_VIOLATION', true, 'no', 1002),
  HELLO_REQUIRED: connectionError('HELLO_REQUIRED', true, 'no', 1002),
  HELLO_TIMEOUT: connectionError('HELLO_TIMEOUT', true, 'yes', 1002),
  UNSUPPORTED_PROTOCOL_VERSION: connectionError('UNSUPPORTED_PROTOCOL_VERSION', true, 'config', 1002),
  UNSUPPORTED_CAPABILITY: connectionError('UNSUPPORTED_CAPABILITY', true, 'config', 1002),
  INSTANCE_IDENTITY_MISMATCH: connectionError('INSTANCE_IDENTITY_MISMATCH', true, 'config', 1008),
  CONNECTION_POLICY_VIOLATION: connectionError('CONNECTION_POLICY_VIOLATION', true, 'config', 1008),
  ACK_STATE_VIOLATION: connectionError('ACK_STATE_VIOLATION', true, 'no', 1002),
  CONNECTION_BACKPRESSURE: connectionError('CONNECTION_BACKPRESSURE', true, 'yes', 1011),
  INTERNAL_ERROR: connectionError('INTERNAL_ERROR', true, 'yes', 1011),
};

const _namespaceErrors: Record<NamespaceErrorCode, ErrorInfo> = {
  TARGET_NOT_REQUESTED: namespaceError('TARGET_NOT_REQUESTED', true, 'config', 'failed'),
  NAMESPACE_REOPEN_REQUIRES_RECONNECT: namespaceError('NAMESPACE_REOPEN_REQUIRES_RECONNECT', true, 'reconnect', 'closed'),
  NAMESPACE_UNAUTHORIZED: namespaceError('NAMESPACE_UNAUTHORIZED', true, 'config', 'failed'),
  NAMESPACE_NOT_FOUND: namespaceError('NAMESPACE_NOT_FOUND', true, 'config', 'failed'),
  REPLICATION_NOT_ENABLED: namespaceError('REPLICATION_NOT_ENABLED', true, 'config', 'failed'),
  REPLICATION_ID_MISMATCH: namespaceError('REPLICATION_ID_MISMATCH', true, 'reset', 'conflicted'),
  REPLICATION_EPOCH_MISMATCH: namespaceError('REPLICATION_EPOCH_MISMATCH', true, 'reset', 'conflicted'),
  NAMESPACE_STATE_VIOLATION: namespaceError('NAMESPACE_STATE_VIOLATION', true, 'no', 'failed'),
  SYNC_STATE_VIOLATION: namespaceError('SYNC_STATE_VIOLATION', true, 'no', 'failed'),
  BOOTSTRAP_TOO_LARGE: namespaceError('BOOTSTRAP_TOO_LARGE', true, 'config', 'failed'),
  BOOTSTRAP_FAILED: namespaceError('BOOTSTRAP_FAILED', true, 'reconnect', 'failed'),
  SYNC_DIFF_TOO_LARGE: namespaceError('SYNC_DIFF_TOO_LARGE', true, 'config', 'failed'),
  UPDATE_TOO_LARGE: namespaceError('UPDATE_TOO_LARGE', true, 'config', 'failed'),
  PROTECTED_FIELD_MUTATION: namespaceError('PROTECTED_FIELD_MUTATION', true, 'no', 'failed'),
  ROLE_VIOLATION: namespaceError('ROLE_VIOLATION', true, 'no', 'failed'),
  PERSISTENCE_DEGRADED: namespaceError('PERSISTENCE_DEGRADED', true, 'recovery', 'failed'),
  APPLY_FAILED: namespaceError('APPLY_FAILED', true, 'reconnect', 'failed'),
  ACK_TIMEOUT: namespaceError('ACK_TIMEOUT', false, 'resync', 'needs-resync'),
  NAMESPACE_TIMEOUT: namespaceError('NAMESPACE_TIMEOUT', true, 'reconnect', 'failed'),
  INTERNAL_ERROR: namespaceError('INTERNAL_ERROR', true, 'reconnect', 'failed'),
};

/** 连接错误注册表（17 条，深冻结，append-only）。 */
export const CONNECTION_ERRORS: Readonly<Record<ConnectionErrorCode, ErrorInfo>> = Object.freeze(_connectionErrors);

/** namespace 错误注册表（20 条，深冻结，append-only）。 */
export const NAMESPACE_ERRORS: Readonly<Record<NamespaceErrorCode, ErrorInfo>> = Object.freeze(_namespaceErrors);

/**
 * 按 (scope, code) 查找注册表条目；未知 code 或跨 scope 不可见 → undefined。
 *
 * 成员判定用 own-key（Object.hasOwn）：注册表是普通对象字面量，裸属性索引会命中
 * Object.prototype 继承键（'toString'/'constructor'/'__proto__' 等 ~12 个）——
 * 那会使「未知 code → undefined」检查被绕过：encodeError 静默产出注册表外 ERROR 帧
 * （且被自家 decoder 拒绝，encode/decode 不对称），ProtocolError 也会拿到 undefined 元数据。
 * own-key 判定后继承键一律 undefined。
 */
export function lookupError(scope: 'connection' | 'namespace', code: string): ErrorInfo | undefined {
  if (scope === 'connection') {
    return Object.hasOwn(CONNECTION_ERRORS, code) ? CONNECTION_ERRORS[code as ConnectionErrorCode] : undefined;
  }
  return Object.hasOwn(NAMESPACE_ERRORS, code) ? NAMESPACE_ERRORS[code as NamespaceErrorCode] : undefined;
}

/**
 * codec 全链路唯一的异常类型：一切解码/校验失败只抛 ProtocolError，
 * 绝不抛 RangeError/TypeError 等未分类异常。
 *
 * 元数据查表导出（AC4）：优先 scope 指定的注册表；未显式给 scope 时优先 CONNECTION_ERRORS，
 * 次 NAMESPACE_ERRORS（INTERNAL_ERROR 双表歧义由显式 scope 参数消解，缺省 connection）。
 * 两表皆无时走 connection 域兜底：this.code 保留调用方原字符串（message 已含原码，可测试
 * 「错误码 ∈ 注册表」不变式）。该分支只应被编程错误触达——codec 自身只会抛已注册码，
 * 运行期触达兜底即为 SA3 缺陷信号（loud，非降级）。
 *
 * message/stack 是本地诊断，永不参与 wire ERROR 的 safeMessage（规范 §13.2）。
 */
export class ProtocolError extends Error {
  readonly code: string;
  readonly scope: 'connection' | 'namespace';
  readonly fatal: boolean;
  readonly retryable: RetryPolicy;
  readonly wsCloseCode?: number;
  readonly terminalState?: TerminalState;

  constructor(code: string, detail?: string, scope?: 'connection' | 'namespace') {
    super(`${code}${detail ? ': ' + detail : ''}`);
    this.name = 'ProtocolError';
    this.code = code;
    const entry =
      scope === 'namespace'
        ? lookupError('namespace', code)
        : (lookupError('connection', code) ?? lookupError('namespace', code));
    if (entry !== undefined) {
      this.scope = entry.scope;
      this.fatal = entry.fatal;
      this.retryable = entry.retryable;
      if (entry.wsCloseCode !== undefined) this.wsCloseCode = entry.wsCloseCode;
      if (entry.terminalState !== undefined) this.terminalState = entry.terminalState;
    } else {
      // 未注册码兜底（connection 域）：只有编程错误能触达。
      this.scope = 'connection';
      this.fatal = true;
      this.retryable = 'no';
    }
  }
}
