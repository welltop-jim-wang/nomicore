/**
 * NDCL v1 binary frame codec（设计 §5；ADR 0012 §Binary frame v1 逐字节）。
 *
 * 25-byte header + payload；纯 TS（Uint8Array + 位运算），零环境绑定：
 *
 * ```text
 * magic          4B   ASCII "NDCL"
 * frameVersion   1B   0x01
 * payloadType    1B   0x01 = yjs-update-v1
 * flags          1B   0x00
 * reserved       2B   0x0000
 * sequence       8B   uint64 big-endian（record.sequence 十进制字符串的数值）
 * payloadLength  4B   uint32 big-endian
 * crc32c         4B   uint32 big-endian
 * payload        NB   原始 Yjs update bytes
 * ```
 *
 * CRC 输入域 = header 前 21 bytes（magic 至 payloadLength）直接连接 payload，
 * 不含 crc32c 字段（ADR 0012 逐字；与 SA6 测试夹具 `test/helpers/frame.ts`
 * 三方同构——writer/reader/测试各自独立可校验）。
 */
import { crc32c } from './crc32c.js'

/** NDCL v1 固定 header 长度（magic/frameVersion/payloadType/flags/reserved/sequence/payloadLength/crc32c）。 */
export const FRAME_HEADER_BYTES = 25
/** payloadType 1 = yjs-update-v1（ADR 0012 逐字）。 */
export const PAYLOAD_TYPE_YJS_UPDATE_V1 = 1

/** 解码产物（uint64 sequence 以 BigInt 装载——无 number 失真）。 */
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

/**
 * NDCL v1 frame 构造（25-byte header + payload）。
 * sequence 为十进制字符串（或 number）；CRC 输入 = header 前 21 bytes 直接连接 payload。
 * opts 允许注入非默认 frameVersion/payloadType/flags/reserved——仅服务测试夹具的
 * 同构实现；生产路径恒用默认 v1 值。
 */
export function encodeFrame(
  sequence: string | number,
  payload: Uint8Array,
  opts: { frameVersion?: number; payloadType?: number; flags?: number; reserved?: number } = {},
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

/**
 * NDCL v1 frame 解码（offset 越界抛出——调用方先做界内判定；reader 的
 * frame-boundary/越界语义在 storage-gate 校验，不依赖本函数的钳位行为）。
 */
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

/** frame 的 CRC 重算（offset 处 frame：header 前 21 bytes + payload；ADR 0012 逐字）。 */
export function frameCrcOf(bin: Uint8Array, offset: number): number {
  const header = bin.subarray(offset, offset + FRAME_HEADER_BYTES)
  const payloadLength =
    ((header[17]! << 24) | (header[18]! << 16) | (header[19]! << 8) | header[20]!) >>> 0
  const input = new Uint8Array(FRAME_HEADER_BYTES - 4 + payloadLength)
  input.set(header.subarray(0, FRAME_HEADER_BYTES - 4), 0)
  input.set(bin.subarray(offset + FRAME_HEADER_BYTES, offset + FRAME_HEADER_BYTES + payloadLength), FRAME_HEADER_BYTES - 4)
  return crc32c(input)
}
