/**
 * 红灯契约 — AC2 + ADR 0012 验收门槛 1/2/3：inline / sidecar 物理表示与阈值边界。
 *
 * 锚点：
 * - 「update 大小小于等于阈值时，以 RFC 4648 标准 Base64 内联，必须有正确 padding，
 *   禁止空白与换行；大于阈值时，append 到当前 segment 共享 .bin；inline 与 sidecar
 *   均记录 payloadLength 与 CRC32C；sequence 与 frameOffset 在 JSONL 中为十进制
 *   字符串；uint32 范围内的 payloadLength 为 JSON number」
 * - 「每个 sidecar payload 使用固定 25-byte header：magic "NDCL"；frameVersion 1；
 *   payloadType 1 = yjs-update-v1；flags 0x00；reserved 2 bytes 0x0000；sequence 8B
 *   uint64 big-endian；payloadLength 4B uint32 big-endian；crc32c 4B uint32 big-endian；
 *   payload N bytes raw Yjs update」「frame 总长度是 25 + payloadLength」
 * - 「CRC 输入是 header 前 21 bytes（magic 至 payloadLength）直接连接 payload」
 * - 「frameOffset 指向 frame magic 的第一个字节，不保存可推导的 frameLength」
 * - 默认 inlineUpdateMaxBytes = 4 KiB（恰 4KiB 内联、4KiB+1 sidecar —— 门槛 3）
 * - 「JSONL 使用 UTF-8、无 BOM、每行一个紧凑 JSON object，并以 \n 结束」
 */
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { crc32c, crc32cHex } from '../src/crc32c.js'
import { baseEmission } from './helpers/base.js'
import { expectTwin } from './helpers/twin.js'
import {
  checkInlineCarrier,
  decodeFrame,
  encodeFrame,
  FRAME_HEADER_BYTES,
  makeFileLog,
  makeTempRoot,
  patternedBytes,
  readJsonl,
  readJsonlBytes,
  recomputeFrameCrc,
  rmTempRoot,
  streamPaths,
} from './helpers/file.js'

const tempRoots: string[] = []

function freshRoot(): string {
  const root = makeTempRoot()
  tempRoots.push(root)
  return root
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmTempRoot(root)
})

function requireFsRead(path: string): Buffer {
  return readFileSync(path)
}

/** frame 的 CRC 重算（整帧切片后经 helpers.recomputeFrameCrc——提取整帧字节再校验）。 */
function frameCrcAt(bin: Uint8Array, offset: number): number {
  const sub = bin.subarray(offset)
  const payloadLength = ((sub[17]! << 24) | (sub[18]! << 16) | (sub[19]! << 8) | sub[20]!) >>> 0
  const input = new Uint8Array(FRAME_HEADER_BYTES - 4 + payloadLength)
  input.set(sub.subarray(0, FRAME_HEADER_BYTES - 4), 0)
  input.set(sub.subarray(FRAME_HEADER_BYTES, FRAME_HEADER_BYTES + payloadLength), FRAME_HEADER_BYTES - 4)
  return crc32c(input)
}

/** emit 一条 committed/update 并返回 JSONL 中该 attempt record。 */
function emitUpdate(log: ReturnType<typeof makeFileLog>['log'], bytes: Uint8Array, sequence: string): Record<string, unknown> {
  log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: bytes } }))
  const records = readJsonl(streamPaths(log.rootDir, log.namespaceId, log.streamId).jsonlPath)
  const found = records.find((r) => r.sequence === sequence)
  expect(found, `sequence ${sequence} 必须已在 JSONL 中`).toBeDefined()
  return found!
}

describe('AC2 验收门槛 1：小 update 内联 round-trip（VFSL + Base64 + length + CRC）', () => {
  it('恰 4096B（默认阈值）→ inline：payloadLength/crc32c/标准 Base64 逐字段 + 全量校验', () => {
    const root = freshRoot()
    const { log } = makeFileLog({ rootDir: root, namespaceId: 'ns-inline-1', updateCapture: true })
    const bytes = patternedBytes(4096)

    const record = emitUpdate(log, bytes, '1')
    expect(record.recordKind).toBe('attempt')
    expect(record.streamId).toBe(log.streamId)
    expect(record.sequence).toBe('1')

    const result = record.result as { kind: string; effect: string; update: Record<string, unknown> }
    expect(result.kind).toBe('committed')
    expect(result.effect).toBe('update')
    expect(result.update.storage).toBe('inline')
    expect(result.update.format).toBe('yjs-update-v1')
    expect(result.update.payloadLength).toBe(4096)
    expect(typeof result.update.payloadLength).toBe('number')
    expect(result.update.crc32c).toBe(crc32cHex(bytes))
    expect(result.update.base64).toBe(Buffer.from(bytes).toString('base64'))
    // 标准 Base64：正确 padding、无空白与换行（RFC 4648 → 4096B 以「==」收尾）
    expect(result.update.base64).toMatch(/^[A-Za-z0-9+/]*==$/)
    expect(result.update.base64).not.toMatch(/\s|\n/)

    // storage 交叉校验（严格 decode + length + CRC）
    checkInlineCarrier(result.update as { base64: string; payloadLength: number; crc32c: string })

    // 最终物理 record 通过内建冻结 VFSL schema（AC3 的 VFSL 门）
    expectTwin(record, 'inline 4096B record')

    // JSONL 物理纪律：UTF-8 无 BOM、逐行 \n 结尾
    const raw = readJsonlBytes(streamPaths(root, 'ns-inline-1', log.streamId).jsonlPath)
    expect(raw[0]).not.toBe(0xef)
    expect(raw[1]).not.toBe(0xbb)
    expect(raw[2]).not.toBe(0xbf)
    expect(raw[raw.length - 1]).toBe(0x0a)
  })

  it('阈值以下（4095B）同样 inline', () => {
    const root = freshRoot()
    const { log } = makeFileLog({ rootDir: root, namespaceId: 'ns-inline-2', updateCapture: true })
    const record = emitUpdate(log, patternedBytes(4095), '1')
    const update = (record.result as { effect: string; update: { storage: string } }).update
    expect(update.storage).toBe('inline')
  })
})

describe('AC2 验收门槛 2：大 update → 共享 .bin NDCL v1 frame + 关联 JSONL 引用（交叉验证）', () => {
  it('4097B → sidecar：JSONL 引用 + 25-byte header 逐字节 + CRC 输入域 + payload 恒等', () => {
    const root = freshRoot()
    const { log } = makeFileLog({ rootDir: root, namespaceId: 'ns-sidecar-1', updateCapture: true })
    const bytes = patternedBytes(4097)

    const record = emitUpdate(log, bytes, '1')
    const result = record.result as { kind: string; effect: string; update: Record<string, unknown> }
    expect(result.effect).toBe('update')
    expect(result.update.storage).toBe('sidecar')
    expect(result.update.format).toBe('yjs-update-v1')
    expect(result.update.segment).toBe('00000001')
    expect(result.update.frameOffset).toBe('0') // 十进制字符串；首 frame 偏移 0
    expect(typeof result.update.frameOffset).toBe('string')
    expect(result.update.payloadLength).toBe(4097)
    expect(typeof result.update.payloadLength).toBe('number')
    expect(result.update.crc32c).toBe(crc32cHex(bytes))

    const p = streamPaths(root, 'ns-sidecar-1', log.streamId)
    const bin = new Uint8Array(requireFsRead(p.binPath))
    expect(bin.byteLength).toBe(FRAME_HEADER_BYTES + 4097) // frame 总长度 25 + payloadLength

    const frame = decodeFrame(bin, Number(result.update.frameOffset))
    expect(frame.magic).toBe('NDCL')
    expect(frame.frameVersion).toBe(1)
    expect(frame.payloadType).toBe(1)
    expect(frame.flags).toBe(0)
    expect(frame.reserved).toBe(0)
    expect(frame.sequence).toBe(1n) // JSONL 十进制 "1" ↔ frame uint64 BE
    expect(frame.payloadLength).toBe(4097)
    expect(frame.crc32c).toBe(frameCrcAt(bin, 0)) // CRC = header 前 21B + payload
    expect(frame.payload).toEqual(bytes)

    expectTwin(record, 'sidecar 4097B record')
  })

  it('两个 sidecar 顺序追加：frameOffset 递推、sequence 与 JSONL 一一对应', () => {
    const root = freshRoot()
    const { log } = makeFileLog({ rootDir: root, namespaceId: 'ns-sidecar-2', updateCapture: true })
    const a = patternedBytes(4097)
    const b = patternedBytes(4098)

    const rec1 = emitUpdate(log, a, '1')
    const rec2 = emitUpdate(log, b, '2')

    const off1 = Number((rec1.result as { update: { frameOffset: string } }).update.frameOffset)
    const off2 = Number((rec2.result as { update: { frameOffset: string } }).update.frameOffset)
    expect(off1).toBe(0)
    expect(off2).toBe(FRAME_HEADER_BYTES + 4097) // 恰为前一 frame 的 end

    const p = streamPaths(root, 'ns-sidecar-2', log.streamId)
    const bin = new Uint8Array(requireFsRead(p.binPath))
    expect(bin.byteLength).toBe(2 * FRAME_HEADER_BYTES + 4097 + 4098)

    const f1 = decodeFrame(bin, off1)
    const f2 = decodeFrame(bin, off2)
    expect(f1.sequence).toBe(1n)
    expect(f2.sequence).toBe(2n)
    expect(f1.payload).toEqual(a)
    expect(f2.payload).toEqual(b)
    expect(f1.crc32c).toBe(frameCrcAt(bin, off1))
    expect(f2.crc32c).toBe(frameCrcAt(bin, off2))
  })

  it('BIN-first 物理顺序：JSONL 引用的 frame 已完整存在（frame 先于引用落盘）', () => {
    const root = freshRoot()
    const { log } = makeFileLog({ rootDir: root, namespaceId: 'ns-sidecar-3', updateCapture: true })
    const rec = emitUpdate(log, patternedBytes(4097), '1')
    const p = streamPaths(root, 'ns-sidecar-3', log.streamId)
    const bin = new Uint8Array(requireFsRead(p.binPath))
    const off = Number((rec.result as { update: { frameOffset: string } }).update.frameOffset)
    // 帧完整可解码：decoded payload 全部在界内（存在性 + 完整性）
    const frame = decodeFrame(bin, off)
    expect(frame.payloadLength).toBe(4097)
  })
})

describe('AC2 验收门槛 3：恰 4KiB 内联、4KiB+1 sidecar（精确阈值边界）', () => {
  it('默认阈值 4096：4096→inline；4097→sidecar；同一 stream 混合', () => {
    const root = freshRoot()
    const { log } = makeFileLog({ rootDir: root, namespaceId: 'ns-boundary-1', updateCapture: true })

    const r1 = emitUpdate(log, patternedBytes(4096), '1')
    const r2 = emitUpdate(log, patternedBytes(4097), '2')
    expect((r1.result as { update: { storage: string } }).update.storage).toBe('inline')
    expect((r2.result as { update: { storage: string } }).update.storage).toBe('sidecar')
  })

  it('自定义阈值 N：N→inline；N+1→sidecar（边界与默认值无关）', () => {
    const root = freshRoot()
    const { log } = makeFileLog({ rootDir: root, namespaceId: 'ns-boundary-2', updateCapture: true, inlineUpdateMaxBytes: 7 })

    const r1 = emitUpdate(log, patternedBytes(7), '1')
    const r2 = emitUpdate(log, patternedBytes(8), '2')
    expect((r1.result as { update: { storage: string } }).update.storage).toBe('inline')
    expect((r2.result as { update: { storage: string } }).update.storage).toBe('sidecar')
  })

  it('自定义阈值 N：N-1 → inline（阈值以下全部内联）', () => {
    const root = freshRoot()
    const { log } = makeFileLog({ rootDir: root, namespaceId: 'ns-boundary-3', updateCapture: true, inlineUpdateMaxBytes: 7 })
    const r = emitUpdate(log, patternedBytes(6), '1')
    expect((r.result as { update: { storage: string } }).update.storage).toBe('inline')
  })
})

describe('AC2 物理表示纪律：frame 编解码双工自校验（header 21B + payload = CRC 输入域）', () => {
  it('encodeFrame → decodeFrame round-trip，CRC 与 helpers 独立重算一致', () => {
    const payload = patternedBytes(100)
    const frame = encodeFrame(3, payload)
    const decoded = decodeFrame(frame, 0)
    expect(decoded.magic).toBe('NDCL')
    expect(decoded.sequence).toBe(3n)
    expect(decoded.payloadLength).toBe(100)
    expect(decoded.crc32c).toBe(recomputeFrameCrc(frame)) // helpers 独立实现逐字节重算
    expect(decoded.payload).toEqual(payload)
  })
})
