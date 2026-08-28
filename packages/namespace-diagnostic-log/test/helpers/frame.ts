/**
 * SA6 共享夹具 — NDCL v1 binary frame 与 Base64 校验原语（issue #152）。
 *
 * 本模块零依赖缺失接缝：只 import 已存在的 `../src/crc32c.js`——允许在未实现
 * File adapter 期间被独立执行验证（tsx 直跑自检），避免 frame 夹具自身错误造成
 * 假红灯。确定性字节序列与严格 Base64 判定也在此。
 *
 * 契约锚点：ADR 0012 §Binary frame v1（25-byte header 逐字节布局；CRC 输入 =
 * header 前 21 bytes 直接连接 payload）与 §Inline 与 sidecar（RFC 4648 标准
 * Base64、正确 padding、禁止空白换行）。
 */
import { crc32c } from '../../src/crc32c.js'

/** NDCL v1 固定 header 长度（magic/frameVersion/payloadType/flags/reserved/sequence/payloadLength/crc32c）。 */
export const FRAME_HEADER_BYTES = 25
/** payloadType 1 = yjs-update-v1（ADR 0012 逐字）。 */
export const PAYLOAD_TYPE_YJS_UPDATE_V1 = 1

/** 确定性 payload 字节（i % 251——非零、可复现、跨测试独立）。 */
export function patternedBytes(size: number): Uint8Array {
  const out = new Uint8Array(size)
  for (let i = 0; i < size; i++) out[i] = i % 251
  return out
}

/**
 * NDCL v1 frame 构造（25-byte header + payload；纯字节拼装）。
 * CRC 输入 = header 前 21 bytes（magic 至 payloadLength）直接连接 payload（ADR 0012 逐字）。
 */
export function encodeFrame(
  sequence: number | string,
  payload: Uint8Array,
  opts: {
    frameVersion?: number
    payloadType?: number
    flags?: number
    reserved?: number
  } = {},
): Uint8Array {
  const header = new Uint8Array(FRAME_HEADER_BYTES)
  header.set([0x4e, 0x44, 0x43, 0x4c]) // 'NDCL'
  header[4] = opts.frameVersion ?? 1
  header[5] = opts.payloadType ?? PAYLOAD_TYPE_YJS_UPDATE_V1
  header[6] = opts.flags ?? 0
  header[7] = (opts.reserved ?? 0) >> 8
  header[8] = (opts.reserved ?? 0) & 0xff
  const seq = BigInt(sequence)
  for (let i = 0; i < 8; i++) header[9 + i] = Number((seq >> BigInt(56 - 8 * i)) & 0xffn)
  const len = payload.byteLength
  header[17] = (len >>> 24) & 0xff
  header[18] = (len >>> 16) & 0xff
  header[19] = (len >>> 8) & 0xff
  header[20] = len & 0xff
  const crcInput = new Uint8Array(FRAME_HEADER_BYTES - 4 + payload.byteLength)
  crcInput.set(header.subarray(0, FRAME_HEADER_BYTES - 4), 0)
  crcInput.set(payload, FRAME_HEADER_BYTES - 4)
  const crc = crc32c(crcInput)
  header[21] = (crc >>> 24) & 0xff
  header[22] = (crc >>> 16) & 0xff
  header[23] = (crc >>> 8) & 0xff
  header[24] = crc & 0xff
  const frame = new Uint8Array(FRAME_HEADER_BYTES + payload.byteLength)
  frame.set(header, 0)
  frame.set(payload, FRAME_HEADER_BYTES)
  return frame
}

/** NDCL v1 frame 解码（reader 断言与测试基架共用）。 */
export interface DecodedFrame {
  magic: string
  frameVersion: number
  payloadType: number
  flags: number
  reserved: number
  sequence: bigint
  payloadLength: number
  crc32c: number
  payload: Uint8Array
}

export function decodeFrame(bin: Uint8Array, offset: number): DecodedFrame {
  if (offset + FRAME_HEADER_BYTES > bin.byteLength) {
    throw new Error(`decodeFrame: offset ${offset} 越界（bin 长度 ${bin.byteLength}）`)
  }
  const header = bin.subarray(offset, offset + FRAME_HEADER_BYTES)
  const magic = String.fromCharCode(header[0]!, header[1]!, header[2]!, header[3]!)
  let sequence = 0n
  for (let i = 0; i < 8; i++) sequence = (sequence << 8n) | BigInt(header[9 + i]!)
  const payloadLength = ((header[17]! << 24) | (header[18]! << 16) | (header[19]! << 8) | header[20]!) >>> 0
  const crc32c =
    ((header[21]! << 24) | (header[22]! << 16) | (header[23]! << 8) | header[24]!) >>> 0
  const payload = bin.subarray(offset + FRAME_HEADER_BYTES, offset + FRAME_HEADER_BYTES + payloadLength)
  return {
    magic,
    frameVersion: header[4]!,
    payloadType: header[5]!,
    flags: header[6]!,
    reserved: (header[7]! << 8) | header[8]!,
    sequence,
    payloadLength,
    crc32c,
    payload,
  }
}

/** frame 的 CRC 输入重算（header 前 21 bytes + payload；ADR 0012 逐字）。 */
export function recomputeFrameCrc(frame: Uint8Array): number {
  const payloadLength = ((frame[17]! << 24) | (frame[18]! << 16) | (frame[19]! << 8) | frame[20]!) >>> 0
  const input = new Uint8Array(FRAME_HEADER_BYTES - 4 + payloadLength)
  input.set(frame.subarray(0, FRAME_HEADER_BYTES - 4), 0)
  input.set(frame.subarray(FRAME_HEADER_BYTES, FRAME_HEADER_BYTES + payloadLength), FRAME_HEADER_BYTES - 4)
  return crc32c(input)
}

/** 严格标准 Base64 判定（RFC 4648：正确 padding、无空白换行、canonical pad bits）。
 *  实现 = 长度 %4 + 无空白 + 解码后重编码文本恒等（canonical 检查，拒 AB== 类非规范尾位）。 */
export function isCanonicalBase64(s: string): boolean {
  if (s.length === 0 || s.length % 4 !== 0) return false
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s)) return false
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})$/.test(s)) return false
  const decoded = Buffer.from(s, 'base64')
  return decoded.toString('base64') === s
}
