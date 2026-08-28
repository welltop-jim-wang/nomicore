/**
 * CRC-32C（Castagnoli）纯 TS 表驱动实现（设计 §7.3；ADR 0012 §Binary frame v1）。
 *
 * 参数逐字取 ADR 0012：poly 0x1EDC6F41（反射形 0x82F63B78）/ init 0xFFFFFFFF /
 * refin true / refout true / xorout 0xFFFFFFFF。256 项反射表构造期生成。
 * KAT：check("123456789") === 0xE3069283（ADR 给出的检验值即现成 KAT）。
 *
 * 本模块只算 CRC 值本身（8 位小写 hex 输出）；25-byte frame header 构造属 #152。
 */

/** 表驱动 CRC-32C（反射多项式 0x82F63B78；零 import 叶子模块）。 */
const TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0x82f63b78 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

/** bytes → CRC-32C 值（uint32）。 */
export function crc32c(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    crc = TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** bytes → 8 位小写 hex（匹配 P_CRC32C_HEX）。 */
export function crc32cHex(bytes: Uint8Array): string {
  return crc32c(bytes).toString(16).padStart(8, '0')
}
