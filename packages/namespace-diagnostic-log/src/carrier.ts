/**
 * update 物理载体（设计 §2.5 / §7.4；ADR 0012 §Inline 与 sidecar / §Binary frame v1）。
 *
 * 环境绑定面：`Buffer` 仅在本模块与 digest.ts 出现（AGENTS.md 声明该唯一环境绑定面）。
 * 本模块只产出 inline 形状（内存无 .bin）；sidecar 形状由 schema 冻结保证可表达
 * （#152 复用，见 §7.4 验收方式），不在本模块构造。
 */
import { crc32cHex } from './crc32c.js'
import type { UpdateCarrier } from './record.js'

/**
 * owned update bytes → inline carrier（RFC 4648 标准 Base64 恒 padding）。
 * bytes.length === 0 不达此处——physicalize 前置守卫（§7.4）已转
 * update-omitted/empty-update（0 字节 Base64 为空串、不匹配 P_BASE64）。
 */
export function buildInlineCarrier(bytes: Uint8Array): UpdateCarrier {
  return {
    storage: 'inline',
    format: 'yjs-update-v1',
    payloadLength: bytes.byteLength,
    crc32c: crc32cHex(bytes),
    base64: Buffer.from(bytes).toString('base64'),
  }
}
