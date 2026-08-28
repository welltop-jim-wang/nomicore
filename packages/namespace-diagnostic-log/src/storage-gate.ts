/**
 * storage 校验共享原语（设计 §6——writer 门与 reader 复用同一实现，防双份漂移）。
 *
 * ADR 0012 分工：VFSL 负责封闭对象/判别联合/literal enum/Pattern/十进制字面/Base64
 * 与 CRC 的**字面形状**；本模块（storage validator）负责**严格 decode、长度一致、
 * CRC 正确、跨域一致、offset/segment/边界**。纯 TS（Uint8Array + 位运算），
 * 零环境绑定；Base64 decode 收口在 carrier.ts（`decodeBase64Strict`）。
 */
import { decodeBase64Strict } from './carrier.js'
import { crc32cHex } from './crc32c.js'
import { FRAME_HEADER_BYTES, frameCrcOf } from './frame.js'
import { P_DECIMAL } from './schema-patterns.js'

const RE_P_DECIMAL = new RegExp(P_DECIMAL)

/**
 * P_DECIMAL 的 JS 正则镜像（单源：schema-patterns.ts 冻结常量）。
 * 实证（2026-08-28 运行时核验，SA4 报告 §2.3 + 本报告裁决 2）：vfsl Pattern 引擎的
 * match 语义为「非锚定搜索 + 前缀匹配」且 alternation codegen 的 jmp 目标有缺陷
 * （`'a|b'` 接受 `'ab'`），`^(0|[1-9][0-9]*)$` 对 `''`/`'01'`/`'0123'` 返回 true——
 * 前导零/空串十进制不会被 VFSL 层拒绝。设计 §7.1 B（P_DECIMAL 拒 '01' 的落点）由
 * 本层以冻结常量复核实现——reader（sequence 与 sidecar frameOffset 两消费面）与
 * writer 注入门共用，零扩码。不依赖 BigInt 解析兜底（Node 20/24 的 `BigInt('')`
 * 行为分歧——先镜像、后解析）。
 */
export function isCanonicalDecimal(value: string): boolean {
  return value !== '' && RE_P_DECIMAL.test(value)
}

/** storage 层 issue code（reader 29 码词表中 storage/frame 交叉面——23 码 v1 基表 + R2 六码；SA6 词表边界逐字）。 */
export type StorageIssueCode =
  | 'base64-invalid'
  | 'base64-length-mismatch'
  | 'crc-mismatch'
  | 'stream-mismatch'
  | 'frame-missing'
  | 'frame-magic-invalid'
  | 'frame-sequence-mismatch'
  | 'frame-length-mismatch'
  | 'frame-crc-mismatch'
  | 'frame-boundary-invalid'
  | 'reference-invalid'
  | 'frame-version-unknown'
  | 'frame-payload-type-unknown'
  | 'frame-flags-nonzero'
  | 'frame-reserved-nonzero'

/**
 * inline carrier 全量校验（§6.2）：strict decode（canonical）→ 长度一致 → CRC 一致。
 * 通过返回 null，否则返回 issue code。streamId 交叉在调用方（record.streamId ≠ 本
 * stream ⇒ 'stream-mismatch'）。
 */
export function validateInlineCarrier(carrier: {
  base64: string
  payloadLength: number
  crc32c: string
}): Extract<StorageIssueCode, 'base64-invalid' | 'base64-length-mismatch' | 'crc-mismatch'> | null {
  const bytes = decodeBase64Strict(carrier.base64)
  if (bytes === null) return 'base64-invalid'
  if (bytes.length !== carrier.payloadLength) return 'base64-length-mismatch'
  if (crc32cHex(bytes) !== carrier.crc32c) return 'crc-mismatch'
  return null
}

/** sidecar 帧校验结果：ok 带下一 expectedOffset；失败带 issue code（不推进）。 */
export type SidecarFrameCheck =
  | { ok: true; nextExpectedOffset: bigint }
  | { ok: false; issue: StorageIssueCode }

/**
 * §7.4 sidecar 帧交叉校验（15 步短路链；writer 注入门与 reader 共用）。
 *
 * `bin` 为 null 表示目标 segment 的 .bin 缺失/非常规文件（目录占位）/不可读——
 * 一律 `frame-missing`（ADR 门槛 11「缺BIN」推广；引用帧不可读 = 帧事实缺失）。
 * `expectedOffset` 为前一合法帧 end（null = 首个被引用帧，不做 boundary 检查、
 * 先验 magic——SA6 §2 边界语义）。校验失败的帧不推进 expectedOffset。
 */
export function validateSidecarFrame(
  bin: Uint8Array | null,
  binSize: number,
  offset: bigint,
  expectedOffset: bigint | null,
  recordSequence: string,
  carrier: { payloadLength: number; crc32c: string },
): SidecarFrameCheck {
  if (bin === null) return { ok: false, issue: 'frame-missing' }
  if (offset + BigInt(FRAME_HEADER_BYTES) > BigInt(binSize)) return { ok: false, issue: 'frame-missing' }
  if (expectedOffset !== null && offset !== expectedOffset) return { ok: false, issue: 'frame-boundary-invalid' }
  const pos = Number(offset) // 已界内（≤ binSize），Number 转换安全
  const header = bin.subarray(pos, pos + FRAME_HEADER_BYTES)
  const magic = String.fromCharCode(header[0]!, header[1]!, header[2]!, header[3]!)
  if (magic !== 'NDCL') return { ok: false, issue: 'frame-magic-invalid' }
  if (header[4] !== 1) return { ok: false, issue: 'frame-version-unknown' }
  if (header[5] !== 1) return { ok: false, issue: 'frame-payload-type-unknown' }
  if (header[6] !== 0) return { ok: false, issue: 'frame-flags-nonzero' }
  if (((header[7]! << 8) | header[8]!) !== 0) return { ok: false, issue: 'frame-reserved-nonzero' }
  const payloadLength = ((header[17]! << 24) | (header[18]! << 16) | (header[19]! << 8) | header[20]!) >>> 0
  if (offset + BigInt(FRAME_HEADER_BYTES) + BigInt(payloadLength) > BigInt(binSize)) {
    return { ok: false, issue: 'frame-length-mismatch' }
  }
  let sequence = 0n
  for (let i = 0; i < 8; i++) sequence = (sequence << 8n) | BigInt(header[9 + i]!)
  if (sequence !== BigInt(recordSequence)) return { ok: false, issue: 'frame-sequence-mismatch' }
  if (payloadLength !== carrier.payloadLength) return { ok: false, issue: 'frame-length-mismatch' }
  const storedCrc = ((header[21]! << 24) | (header[22]! << 16) | (header[23]! << 8) | header[24]!) >>> 0
  if (frameCrcOf(bin, pos) !== storedCrc) return { ok: false, issue: 'frame-crc-mismatch' }
  if (crc32cHex(bin.subarray(pos + FRAME_HEADER_BYTES, pos + FRAME_HEADER_BYTES + payloadLength)) !== carrier.crc32c) {
    return { ok: false, issue: 'crc-mismatch' }
  }
  return { ok: true, nextExpectedOffset: offset + BigInt(FRAME_HEADER_BYTES) + BigInt(payloadLength) }
}
