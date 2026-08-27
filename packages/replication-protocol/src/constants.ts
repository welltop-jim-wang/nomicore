/**
 * 协议级固定常量与字段格式正则（`@nomicore/replication-protocol`）。
 *
 * 权威来源：docs/protocols/instance-replication-v1.md §3（固定 envelope）、§1（身份格式）、§6.1（nonce）。
 * 常量值与 SA6 红灯 fixtures（test/fixtures.ts）逐项对齐。
 */

/** 固定 envelope magic（ASCII 'NMCR'，wire 字节 4e 4d 43 52）。 */
export const ENVELOPE_MAGIC = 'NMCR';

/** v1 envelope 版本（只定义固定头布局）。 */
export const ENVELOPE_VERSION = 1;

/** 固定头部 byteLength：magic(4)+version(1)+type(1)+flags(2)+sequence(4)+payloadLength(4)+reserved(4)。 */
export const ENVELOPE_HEADER_BYTES = 20;

/** 缺省最大帧 byteLength（16 MiB）；decodeFrame 步骤 7 的缺省上限。 */
export const DEFAULT_MAX_FRAME_BYTES = 16 * 1024 * 1024;

/**
 * 协议开销上界：帧头 20 + 最坏「namespaceId varString + 其余变长字段的最长编码」。
 * 逐消息最坏推导（SA1 设计 §10）：BOOTSTRAP_SNAPSHOT 102 / SYNC_STEP2 71 / UPDATE 61，
 * 常量取 128（安全取整 + append-only 预留）。validateCodecLimits 用：
 * 字段级限额 ≤ maxFrameBytes − PROTOCOL_OVERHEAD_BYTES，否则配置即假绿灯。
 */
export const PROTOCOL_OVERHEAD_BYTES = 128;

/** HELLO / HELLO_ACK 的 connectionNonce 固定字节数（规范 §6.1）。 */
export const NONCE_BYTES = 16;

/** namespaceId 严格格式：^ns-[0-9a-f]{32}$（规范 §1）。 */
export const NAMESPACE_ID_RE = /^ns-[0-9a-f]{32}$/;

/** replicationId 严格格式：32 个小写 hex（规范 §1 复制谱系）。 */
export const REPLICATION_ID_RE = /^[0-9a-f]{32}$/;

/** instanceId 安全文法：小写字母开头，后续 [a-z0-9-]，总长 ≤ 63（ADR-0010）。 */
export const INSTANCE_ID_RE = /^[a-z][a-z0-9-]{0,62}$/;
