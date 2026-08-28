/**
 * update 物理载体（设计 §2.5 / §7.4；ADR 0012 §Inline 与 sidecar / §Binary frame v1）。
 *
 * 环境绑定面：`Buffer` 在本模块与 digest.ts 出现（AGENTS.md 声明）；#152 起本模块
 * 同时收口 Base64 编解码两侧（buildInlineCarrier 编码 / decodeBase64Strict 严格解码——
 * Reader/storage-gate 不得自起炉灶）。本模块只产出 inline 形状（内存无 .bin）；
 * sidecar 形状由 schema 冻结保证可表达（#152 复用，见 §7.4 验收方式），不在本模块构造。
 */
import { crc32cHex } from './crc32c.js'
import type { UpdateCarrier } from './record.js'
import { P_BASE64 } from './schema-patterns.js'

/** P_BASE64 的 JS 正则镜像（单源：schema-patterns.ts 冻结常量——R 修复轮 R-3）。 */
const RE_P_BASE64 = new RegExp(P_BASE64)

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

/**
 * 严格 RFC 4648 Base64 decode（§6.1；SA6 契约 `isCanonicalBase64` 的同构实现）。
 *
 * Node `Buffer.from(s, 'base64')` 是宽松解码器（跳过非法字符/空白）；
 * canonical 判定 = P_BASE64 单源镜像（含 padding 位置） + decode→re-encode 恒等
 * （拒 'AB==' 类非规范 pad bits、内部空白）。违规输入返回 null——绝不宽松 fallback。
 */
export function decodeBase64Strict(s: string): Uint8Array | null {
  if (s.length === 0 || s.length % 4 !== 0) return null
  if (!RE_P_BASE64.test(s)) return null
  const decoded = Buffer.from(s, 'base64')
  if (Buffer.from(decoded).toString('base64') !== s) return null
  return new Uint8Array(decoded)
}
