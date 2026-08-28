/**
 * 红灯契约 — AC4 strict reader：JSON parse、VFSL、Base64、长度、CRC32C、frame 元数据、
 * 引用、偏移、格式、stream sequence 全量交叉校验；未知版本响亮 incompatible、不近似解释。
 *
 * 锚点：ADR 0012 §Strict reader 与诊断性 replay
 * - 「默认strict reader对每条record执行JSON parse、VFSL validation及storage/frame交叉校验」
 * - storage validator 职责：「严格 Base64 decode；decoded length 与 payloadLength 一致；
 *   inline/frame CRC 正确；JSONL 与 frame 的 sequence、format/payloadType、payloadLength
 *   一致；offset、segment、frame 边界与 stream 连续性」
 * - 「未知VFSL dialect、record format、frameVersion或payloadType使该stream为incompatible；
 *   reader可展示manifest和原始文件元数据，但不得近似解释、跳过未知记录后继续声称连续」
 * - 「streamId、segment 名…必须按各自安全文法校验」；「JSONL 无 BOM、每行一个 JSON object、
 *   \n 结束」「Sequence 无前导零十进制字符串；frameOffset 指向 frame magic 首字节」
 *
 * SA6 契约：readStreamStrict({rootDir, namespaceId, streamId}): StrictStreamRead
 * status = 'ok' | 'corrupt' | 'incompatible'；record 级 ok + issues；stream 级 issues。
 * 损坏（corrupt）与不兼容（incompatible）区别对待：未知版本 → incompatible（展示
 * manifest 与原始元数据、不做近似解释）；可证明的物理损坏 → corrupt。
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { crc32cHex } from '../src/crc32c.js'
import { baseEmission, OBSERVED_AT } from './helpers/base.js'
import {
  encodeFrame,
  FRAME_HEADER_BYTES,
  makeFileLog,
  makeTempRoot,
  patternedBytes,
  rmTempRoot,
  streamPaths,
  validAttemptRecord,
  validManifest,
  writeStreamFixture,
} from './helpers/file.js'
import { readStreamStrict } from '../src/index.js'

const tempRoots: string[] = []

function freshRoot(): string {
  const root = makeTempRoot()
  tempRoots.push(root)
  return root
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmTempRoot(root)
})

const NS = 'ns-reader'
const STREAM = 'log-11111111111111111111111111111111'

function issueCodes(issues: readonly { code: string }[]): string[] {
  return issues.map((i) => i.code)
}

describe('AC4 正例：healthy stream 全量校验通过（ok、零 issues）', () => {
  it('inline + sidecar 混合 stream → status ok，每 record ok，帧交叉校验全过', () => {
    const root = freshRoot()
    const { log } = makeFileLog({ rootDir: root, namespaceId: NS, updateCapture: true })
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(100) } }))
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(4097) } }))
    log.emitter.emit(baseEmission({ result: { kind: 'rejected' } }))

    const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: log.streamId })
    expect(read.status).toBe('ok')
    expect(read.streamId).toBe(log.streamId)
    expect(read.namespaceId).toBe(NS)
    expect(read.manifest).not.toBeNull()
    expect(read.issues).toHaveLength(0)
    expect(read.records.map((r) => r.sequence)).toEqual(['1', '2', '3'])
    for (const record of read.records) {
      expect(record.ok).toBe(true)
      expect(record.issues).toHaveLength(0)
      expect(record.record).not.toBeNull()
    }
  })
})

describe('AC4 未知版本 → incompatible（不近似解释、不声称连续）', () => {
  it('未知 VFSL dialect（schema.lang=vfsl2）→ incompatible，records 空', () => {
    const root = freshRoot()
    const stream = STREAM
    writeStreamFixture(root, NS, stream, {
      manifest: validManifest(stream, NS, { schema: { lang: 'vfsl2', version: 1, id: 'x', text: 'y' } }),
      jsonlLines: [validAttemptRecord(stream, '1')],
    })
    const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: stream })
    expect(read.status).toBe('incompatible')
    expect(issueCodes(read.issues)).toContain('dialect-unknown')
    // 不得近似解释：不给 record 级解释、不声称连续
    expect(read.records).toHaveLength(0)
  })

  it('未知 record format（manifest.recordVersion=2）→ incompatible', () => {
    const root = freshRoot()
    const stream = STREAM
    writeStreamFixture(root, NS, stream, {
      manifest: validManifest(stream, NS, { recordVersion: 2 }),
      jsonlLines: [validAttemptRecord(stream, '1')],
    })
    const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: stream })
    expect(read.status).toBe('incompatible')
    expect(issueCodes(read.issues)).toContain('record-version-unknown')
    expect(read.records).toHaveLength(0)
  })

  it('未知 frameVersion（0x02）→ incompatible', () => {
    const root = freshRoot()
    const stream = STREAM
    const payload = patternedBytes(4097)
    const record = validAttemptRecord(stream, '1', {
      result: {
        kind: 'committed',
        effect: 'update',
        update: { storage: 'sidecar', format: 'yjs-update-v1', segment: '00000001', frameOffset: '0', payloadLength: 4097, crc32c: '00000000' },
      },
    })
    writeStreamFixture(root, NS, stream, {
      jsonlLines: [record],
      bin: encodeFrame(1, payload, { frameVersion: 2 }),
    })
    const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: stream })
    expect(read.status).toBe('incompatible')
    expect(issueCodes(read.issues)).toContain('frame-version-unknown')
    expect(read.records).toHaveLength(0)
  })

  it('未知 payloadType（0x02）→ incompatible', () => {
    const root = freshRoot()
    const stream = STREAM
    const payload = patternedBytes(4097)
    const record = validAttemptRecord(stream, '1', {
      result: {
        kind: 'committed',
        effect: 'update',
        update: { storage: 'sidecar', format: 'yjs-update-v1', segment: '00000001', frameOffset: '0', payloadLength: 4097, crc32c: '00000000' },
      },
    })
    writeStreamFixture(root, NS, stream, {
      jsonlLines: [record],
      bin: encodeFrame(1, payload, { payloadType: 2 }),
    })
    const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: stream })
    expect(read.status).toBe('incompatible')
    expect(issueCodes(read.issues)).toContain('frame-payload-type-unknown')
    expect(read.records).toHaveLength(0)
  })

  it('非零 flags / 非零 reserved → incompatible（v1 禁止压缩；非零即响亮拒绝）', () => {
    for (const opts of [{ flags: 1 }, { reserved: 1 }]) {
      const root = freshRoot()
      const stream = STREAM
      const payload = patternedBytes(4097)
      const record = validAttemptRecord(stream, '1', {
        result: {
          kind: 'committed',
          effect: 'update',
          update: { storage: 'sidecar', format: 'yjs-update-v1', segment: '00000001', frameOffset: '0', payloadLength: 4097, crc32c: '00000000' },
        },
      })
      writeStreamFixture(root, NS, stream, {
        jsonlLines: [record],
        bin: encodeFrame(1, payload, opts),
      })
      const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: stream })
      expect(read.status).toBe('incompatible')
      expect(issueCodes(read.issues).some((code) => code === 'frame-flags-nonzero' || code === 'frame-reserved-nonzero')).toBe(true)
      expect(read.records).toHaveLength(0)
    }
  })

  it('schema 指纹不匹配（envelope text 篡改）→ incompatible 且 manifest 仍可展示', () => {
    const root = freshRoot()
    const stream = STREAM
    const tampered = { lang: 'vfsl', version: 1, id: 'nomicore.namespace-diagnostic-change-record@1', text: 'tampered-not-the-frozen-schema' }
    writeStreamFixture(root, NS, stream, {
      manifest: validManifest(stream, NS, { schema: tampered }),
      jsonlLines: [validAttemptRecord(stream, '1')],
    })
    const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: stream })
    expect(read.status).toBe('incompatible')
    expect(issueCodes(read.issues)).toContain('schema-fingerprint-mismatch')
    // 仍可展示 manifest（reader 可展示 manifest 与原始文件元数据）
    expect(read.manifest).not.toBeNull()
    expect((read.manifest as { schema: { text: string } }).schema.text).toBe('tampered-not-the-frozen-schema')
    expect(read.records).toHaveLength(0)
  })
})

describe('AC4 JSON parse + VFSL 校验', () => {
  it('坏 JSON 行（中间损坏）→ corrupt + invalid-json，不自动修复、不断言连续', () => {
    const root = freshRoot()
    const stream = STREAM
    writeStreamFixture(root, NS, stream, {
      jsonlText: JSON.stringify(validAttemptRecord(stream, '1')) + '\n{broken-not-json\n' + JSON.stringify(validAttemptRecord(stream, '3')) + '\n',
    })
    const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: stream })
    expect(read.status).toBe('corrupt')
    expect(read.records[0]!.ok).toBe(true)
    expect(read.records[1]!.ok).toBe(false)
    expect(issueCodes(read.records[1]!.issues)).toContain('invalid-json')
    expect(issueCodes(read.issues)).toContain('invalid-json') // stream 级同样诚实上报
    // R2（设计 §3.4）：身份不可解释的行不得将其前后拼接出精确缺口（诚实 unknown 而非伪 gap）
    expect(issueCodes(read.issues)).not.toContain('sequence-gap')
    expect(read.records[2]!.ok).toBe(true)
  })

  it('VFSL 失败的 record（坏 streamId / 词表外 operation）→ vfsl-invalid', () => {
    for (const bad of [
      { streamId: 'log-zzzz' },
      { operation: 'not-an-operation' },
    ]) {
      const root = freshRoot()
      const stream = STREAM
      writeStreamFixture(root, NS, stream, {
        jsonlLines: [validAttemptRecord(stream, '1', bad)],
      })
      const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: stream })
      expect(read.status).toBe('corrupt')
      expect(read.records[0]!.ok).toBe(false)
      expect(issueCodes(read.records[0]!.issues)).toContain('vfsl-invalid')
    }
  })

  it('record.streamId 与 stream dir 不一致 → stream-mismatch（storage 层交叉校验）', () => {
    const root = freshRoot()
    const stream = STREAM
    writeStreamFixture(root, NS, stream, {
      jsonlLines: [validAttemptRecord('log-22222222222222222222222222222222', '1')],
    })
    const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: stream })
    expect(read.status).toBe('corrupt')
    expect(issueCodes(read.records[0]!.issues)).toContain('stream-mismatch')
  })
})

describe('AC4 inline storage 校验（严格 Base64 decode / length / CRC）', () => {
  it('非规范 padding bits（AB==）→ base64-invalid（VFSL 字面形状过、严格 decode 拒）', () => {
    const root = freshRoot()
    const stream = STREAM
    writeStreamFixture(root, NS, stream, {
      jsonlLines: [
        validAttemptRecord(stream, '1', {
          result: {
            kind: 'committed',
            effect: 'update',
            update: { storage: 'inline', format: 'yjs-update-v1', payloadLength: 1, crc32c: '5f81805a', base64: 'AB==' },
          },
        }),
      ],
    })
    const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: stream })
    expect(read.status).toBe('corrupt')
    expect(issueCodes(read.records[0]!.issues)).toContain('base64-invalid')
  })

  it('decoded length ≠ payloadLength → base64-length-mismatch', () => {
    const root = freshRoot()
    const stream = STREAM
    const payload = new TextEncoder().encode('abc') // 3 bytes → 4 chars
    writeStreamFixture(root, NS, stream, {
      jsonlLines: [
        validAttemptRecord(stream, '1', {
          result: {
            kind: 'committed',
            effect: 'update',
            update: {
              storage: 'inline',
              format: 'yjs-update-v1',
              payloadLength: 5,
              crc32c: crc32cHexOf(payload),
              base64: Buffer.from(payload).toString('base64'),
            },
          },
        }),
      ],
    })
    const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: stream })
    expect(read.status).toBe('corrupt')
    expect(issueCodes(read.records[0]!.issues)).toContain('base64-length-mismatch')
  })

  it('inline CRC 错误 → crc-mismatch', () => {
    const root = freshRoot()
    const stream = STREAM
    const payload = new TextEncoder().encode('abc')
    writeStreamFixture(root, NS, stream, {
      jsonlLines: [
        validAttemptRecord(stream, '1', {
          result: {
            kind: 'committed',
            effect: 'update',
            update: {
              storage: 'inline',
              format: 'yjs-update-v1',
              payloadLength: 3,
              crc32c: '00000000',
              base64: Buffer.from(payload).toString('base64'),
            },
          },
        }),
      ],
    })
    const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: stream })
    expect(read.status).toBe('corrupt')
    expect(issueCodes(read.records[0]!.issues)).toContain('crc-mismatch')
  })

  it('内联 base64 含内部空白 → 拒绝（禁止空白与换行）', () => {
    const root = freshRoot()
    const stream = STREAM
    const payload = new TextEncoder().encode('abc')
    const b64 = Buffer.from(payload).toString('base64').slice(0, 2) + ' ' + Buffer.from(payload).toString('base64').slice(2)
    writeStreamFixture(root, NS, stream, {
      jsonlLines: [
        validAttemptRecord(stream, '1', {
          result: {
            kind: 'committed',
            effect: 'update',
            update: { storage: 'inline', format: 'yjs-update-v1', payloadLength: 3, crc32c: crc32cHexOf(payload), base64: b64 },
          },
        }),
      ],
    })
    const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: stream })
    expect(read.status).toBe('corrupt')
    expect(read.records[0]!.ok).toBe(false)
  })
})

describe('AC4 sidecar frame 交叉校验（引用 / 偏移 / 边界 / 连续性）', () => {
  function sidecarRecord(stream: string, seq: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return validAttemptRecord(stream, seq, {
      result: {
        kind: 'committed',
        effect: 'update',
        update: { storage: 'sidecar', format: 'yjs-update-v1', segment: '00000001', frameOffset: '0', payloadLength: 4097, crc32c: crc32cHexOf(patternedBytes(4097)) },
      },
      ...overrides,
    })
  }

  it('.bin 整体缺失 → frame-missing', () => {
    const root = freshRoot()
    const stream = STREAM
    writeStreamFixture(root, NS, stream, { jsonlLines: [sidecarRecord(stream, '1')] })
    const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: stream })
    expect(read.status).toBe('corrupt')
    expect(issueCodes(read.records[0]!.issues)).toContain('frame-missing')
  })

  it('frameOffset 超出 EOF → frame-missing', () => {
    const root = freshRoot()
    const stream = STREAM
    writeStreamFixture(root, NS, stream, {
      jsonlLines: [sidecarRecord(stream, '1', { result: { kind: 'committed', effect: 'update', update: { storage: 'sidecar', format: 'yjs-update-v1', segment: '00000001', frameOffset: '99999', payloadLength: 4097, crc32c: '00000000' } } })],
      bin: encodeFrame(1, patternedBytes(4097)),
    })
    const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: stream })
    expect(read.status).toBe('corrupt')
    expect(issueCodes(read.records[0]!.issues)).toContain('frame-missing')
  })

  it('frameOffset 未指向 NDCL magic → frame-magic-invalid', () => {
    const root = freshRoot()
    const stream = STREAM
    writeStreamFixture(root, NS, stream, {
      jsonlLines: [sidecarRecord(stream, '1', { result: { kind: 'committed', effect: 'update', update: { storage: 'sidecar', format: 'yjs-update-v1', segment: '00000001', frameOffset: '10', payloadLength: 4097, crc32c: '00000000' } } })],
      bin: encodeFrame(1, patternedBytes(4097)),
    })
    const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: stream })
    expect(read.status).toBe('corrupt')
    expect(issueCodes(read.records[0]!.issues)).toContain('frame-magic-invalid')
  })

  it('frame sequence ≠ JSONL sequence → frame-sequence-mismatch', () => {
    const root = freshRoot()
    const stream = STREAM
    writeStreamFixture(root, NS, stream, {
      jsonlLines: [sidecarRecord(stream, '1')],
      bin: encodeFrame(2, patternedBytes(4097)),
    })
    const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: stream })
    expect(read.status).toBe('corrupt')
    expect(issueCodes(read.records[0]!.issues)).toContain('frame-sequence-mismatch')
  })

  it('frame payloadLength ≠ JSONL payloadLength → frame-length-mismatch', () => {
    const root = freshRoot()
    const stream = STREAM
    writeStreamFixture(root, NS, stream, {
      jsonlLines: [sidecarRecord(stream, '1')],
      bin: encodeFrame(1, patternedBytes(100)),
    })
    const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: stream })
    expect(read.status).toBe('corrupt')
    expect(issueCodes(read.records[0]!.issues)).toContain('frame-length-mismatch')
  })

  it('frame CRC 错误（编码后翻转 payload 字节 → header 内 CRC 失效）→ frame-crc-mismatch', () => {
    const root = freshRoot()
    const stream = STREAM
    const frame = encodeFrame(1, patternedBytes(4097))
    frame[FRAME_HEADER_BYTES + 10] = frame[FRAME_HEADER_BYTES + 10]! ^ 0xff // 编码后破坏 payload
    writeStreamFixture(root, NS, stream, {
      jsonlLines: [sidecarRecord(stream, '1')],
      bin: frame,
    })
    const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: stream })
    expect(read.status).toBe('corrupt')
    expect(issueCodes(read.records[0]!.issues)).toContain('frame-crc-mismatch')
  })

  it('第二个 frame 的 offset 非连续（gap/overlap）→ frame-boundary-invalid', () => {
    const root = freshRoot()
    const stream = STREAM
    // R2 修订（PR #159）：帧载荷改为 4097B——政策一致性（sidecar 必须 > inlineUpdateMaxBytes）
    // 由 viewer 面的 manifest policy 校验后，本用例只锚定 boundary 语义（rec1 独立合法作为隔离基线）
    const frames = concatU8(encodeFrame(1, patternedBytes(4097)), encodeFrame(2, patternedBytes(4097)))
    // rec1 引用合法的 4097B 帧（offset 0）；rec2 引用 4123（≠ 前一帧 end = 25+4097=4122）→ 边界违规
    const rec1 = sidecarRecord(stream, '1')
    const rec2 = sidecarRecord(stream, '2', {
      result: {
        kind: 'committed',
        effect: 'update',
        update: { storage: 'sidecar', format: 'yjs-update-v1', segment: '00000001', frameOffset: '4123', payloadLength: 4097, crc32c: '00000000' },
      },
    })
    writeStreamFixture(root, NS, stream, {
      jsonlLines: [rec1, rec2],
      bin: frames,
    })
    const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: stream })
    expect(read.status).toBe('corrupt')
    expect(read.records[0]!.ok).toBe(true) // rec1 独立合法
    expect(issueCodes(read.records[1]!.issues)).toContain('frame-boundary-invalid')
  })

  it('sidecar 引用不存在的 segment → reference-invalid', () => {
    const root = freshRoot()
    const stream = STREAM
    const rec = sidecarRecord(stream, '1', {
      result: {
        kind: 'committed',
        effect: 'update',
        update: { storage: 'sidecar', format: 'yjs-update-v1', segment: '00000002', frameOffset: '0', payloadLength: 4097, crc32c: '00000000' },
      },
    })
    writeStreamFixture(root, NS, stream, {
      jsonlLines: [rec],
      bin: encodeFrame(1, patternedBytes(4097)),
    })
    const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: stream })
    expect(read.status).toBe('corrupt')
    expect(issueCodes(read.records[0]!.issues)).toContain('reference-invalid')
  })

  it('纯侧车正例交叉验证：帧序列按序、偏移 0 起、边界连续', () => {
    const root = freshRoot()
    const stream = STREAM
    // R2 修订（PR #159）：两帧均为 4097B（> 默认阈值 4096）——manifest policy 一致性
    // （sidecar 必须大于 inlineUpdateMaxBytes）由夹具默认 capture:true 声明共同满足
    const bin = concatU8(
      encodeFrame(1, patternedBytes(4097)),
      encodeFrame(2, patternedBytes(4097)),
    )
    const rec1 = sidecarRecord(stream, '1')
    const rec2 = sidecarRecord(stream, '2', {
      result: {
        kind: 'committed',
        effect: 'update',
        update: { storage: 'sidecar', format: 'yjs-update-v1', segment: '00000001', frameOffset: String(FRAME_HEADER_BYTES + 4097), payloadLength: 4097, crc32c: crc32cHexOf(patternedBytes(4097)) },
      },
    })
    writeStreamFixture(root, NS, stream, { jsonlLines: [rec1, rec2], bin })
    const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: stream })
    expect(read.status).toBe('ok')
    expect(read.records).toHaveLength(2)
    for (const r of read.records) {
      expect(r.ok).toBe(true)
      expect(r.issues).toHaveLength(0)
    }
  })
})

describe('AC4 stream sequence 校验', () => {
  it('sequence 乱序（2 先 1 后）→ sequence-out-of-order（corrupt）', () => {
    const root = freshRoot()
    const stream = STREAM
    writeStreamFixture(root, NS, stream, {
      jsonlLines: [validAttemptRecord(stream, '2'), validAttemptRecord(stream, '1')],
    })
    const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: stream })
    expect(read.status).toBe('corrupt')
    expect(issueCodes(read.issues)).toContain('sequence-out-of-order')
  })

  it('重复 sequence → sequence-out-of-order（corrupt）', () => {
    const root = freshRoot()
    const stream = STREAM
    writeStreamFixture(root, NS, stream, {
      jsonlLines: [validAttemptRecord(stream, '1'), validAttemptRecord(stream, '1')],
    })
    const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: stream })
    expect(read.status).toBe('corrupt')
    expect(issueCodes(read.issues)).toContain('sequence-out-of-order')
  })

  it('带前导零的 sequence（"01"）→ 拒绝（无前导零十进制纪律）', () => {
    const root = freshRoot()
    const stream = STREAM
    writeStreamFixture(root, NS, stream, {
      jsonlLines: [validAttemptRecord(stream, '01')],
    })
    const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: stream })
    expect(read.status).toBe('corrupt')
    expect(read.records[0]!.ok).toBe(false)
  })
})

describe('AC4 manifest 损坏', () => {
  it('manifest.json 不可解析 → corrupt + manifest-invalid（不猜测解释）', () => {
    const root = freshRoot()
    const stream = STREAM
    writeStreamFixture(root, NS, stream, {
      manifest: '{not-json',
      jsonlLines: [validAttemptRecord(stream, '1')],
    })
    const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: stream })
    expect(read.status).toBe('corrupt')
    expect(issueCodes(read.issues)).toContain('manifest-invalid')
    expect(read.manifest).toBeNull()
  })
})

// ============================================================================
// R2 轮红灯契约（设计 §5.3 锚 1–6、9–10 的 reader 面；R2-G1：owner 反馈 1/2 裁定
// strict reader 逐行执行 manifest 冻结策略 + stream sequence 从 1 连续校验）。
// 码表（设计 §2.6）：五个 manifest-* record 码 + 一个 stream 级 sequence-gap，
// 全部映射 corrupt、不加入 INCOMPATIBLE_SET——既有 incompatible/records:[] 行为不变。
// ============================================================================

/** 合法 genesis（sequence 1，inline update 'abc' — 与 validAttemptRecord 同载体形状）。 */
function validGenesisRecord(stream: string, sequence = '1'): Record<string, unknown> {
  const payload = new TextEncoder().encode('abc')
  return {
    recordKind: 'genesis-baseline',
    streamId: stream,
    sequence,
    observedAt: OBSERVED_AT,
    source: { kind: 'local' },
    update: {
      storage: 'inline',
      format: 'yjs-update-v1',
      payloadLength: payload.byteLength,
      crc32c: crc32cHexOf(payload),
      base64: Buffer.from(payload).toString('base64'),
    },
  }
}

/** 追加 00000002.jsonl（跨 segment 连续性 fixture）。 */
function writeSecondSegment(root: string, stream: string, lines: unknown[]): void {
  const p = streamPaths(root, NS, stream)
  writeFileSync(join(p.segmentsDir, '00000002.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''))
}

/** 判定：corrupt + 指定 record 下标携带**恰一个**指定码（隔离锚）；stream 级镜像同码。 */
function assertIsolatedR2Issue(
  root: string,
  opts: { manifest?: Record<string, unknown>; jsonlLines?: unknown[]; jsonlText?: string; bin?: Uint8Array },
  recordIndex: number,
  expectedCode: string,
): void {
  writeStreamFixture(root, NS, STREAM, {
    manifest: validManifest(STREAM, NS, opts.manifest),
    ...(opts.jsonlLines !== undefined ? { jsonlLines: opts.jsonlLines } : {}),
    ...(opts.jsonlText !== undefined ? { jsonlText: opts.jsonlText } : {}),
    ...(opts.bin !== undefined ? { bin: opts.bin } : {}),
  })
  const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: STREAM })
  expect(read.status).toBe('corrupt')
  const record = read.records[recordIndex]!
  expect(record.ok).toBe(false)
  expect(issueCodes(record.issues)).toEqual([expectedCode])
  expect(issueCodes(read.issues)).toContain(expectedCode) // 逐 record issue → stream issue 全量镜像
}

describe('R2 轮：manifest committedUpdateCapture 政策（设计 §2.2 / §5.3 #1）', () => {
  it('capture=false + attempt committed/effect:update 携带 inline carrier → manifest-update-capture-violation + corrupt', () => {
    const root = freshRoot()
    assertIsolatedR2Issue(
      root,
      { manifest: { committedUpdateCapture: false }, jsonlLines: [validAttemptRecord(STREAM, '1')] },
      0,
      'manifest-update-capture-violation',
    )
  })

  it('capture=false + fatal committed:true/effect:update → 同码（已 committed 的 fatal 亦属 updateCarrier 定义）', () => {
    const root = freshRoot()
    const payload = new TextEncoder().encode('abc')
    assertIsolatedR2Issue(
      root,
      {
        manifest: { committedUpdateCapture: false },
        jsonlLines: [
          validAttemptRecord(STREAM, '1', {
            result: {
              kind: 'fatal',
              committed: true,
              effect: 'update',
              update: {
                storage: 'inline',
                format: 'yjs-update-v1',
                payloadLength: 3,
                crc32c: crc32cHexOf(payload),
                base64: Buffer.from(payload).toString('base64'),
              },
            },
          }),
        ],
      },
      0,
      'manifest-update-capture-violation',
    )
  })

  it('capture=false + genesis update carrier → 合法（genesis 与 attempt capture 正交，ADRC 边界兼容）', () => {
    const root = freshRoot()
    writeStreamFixture(root, NS, STREAM, {
      manifest: validManifest(STREAM, NS, { committedUpdateCapture: false }),
      jsonlLines: [validGenesisRecord(STREAM)],
    })
    const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: STREAM })
    expect(read.status).toBe('ok')
    expect(read.records[0]!.ok).toBe(true)
    expect(read.records[0]!.issues).toHaveLength(0)
  })

  it('capture=false + update-omitted → 合法（best-effort 省略不得误判为捕获违规）', () => {
    const root = freshRoot()
    writeStreamFixture(root, NS, STREAM, {
      manifest: validManifest(STREAM, NS, { committedUpdateCapture: false }),
      jsonlLines: [
        validAttemptRecord(STREAM, '1', {
          result: { kind: 'committed', effect: 'update-omitted', reason: 'empty-update' },
        }),
      ],
    })
    const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: STREAM })
    expect(read.status).toBe('ok')
    expect(read.records[0]!.ok).toBe(true)
  })

  it('capture=true（目录默认）+ attempt update → ok（夹具与政策一致的控制组）', () => {
    const root = freshRoot()
    writeStreamFixture(root, NS, STREAM, { jsonlLines: [validAttemptRecord(STREAM, '1')] })
    const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: STREAM })
    expect(read.status).toBe('ok')
    expect(read.records[0]!.ok).toBe(true)
  })
})

describe('R2 轮：manifest inputCapturePolicy 精确形状（设计 §2.3 / §5.3 #2）', () => {
  const D = 'a'.repeat(64)
  const digestInput = { capture: 'digest', digest: D }
  const degradedInput = { capture: 'digest', digest: D, degraded: 'projected-input-too-large' }

  it('正例（唯一合法降级）：full/redacted manifest + digest+唯一 literal marker → ok', () => {
    for (const policy of ['full', 'redacted'] as const) {
      const root = freshRoot()
      writeStreamFixture(root, NS, STREAM, {
        manifest: validManifest(STREAM, NS, { inputCapturePolicy: policy }),
        jsonlLines: [validAttemptRecord(STREAM, '1', { input: degradedInput })],
      })
      const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: STREAM })
      expect(read.status, `policy=${policy}`).toBe('ok')
      expect(read.records[0]!.ok, `policy=${policy}`).toBe(true)
    }
  })

  it('正例：digest manifest + 纯 digest（无 marker）；none manifest + {capture:none} → ok', () => {
    for (const [policy, input] of [
      ['digest', digestInput],
      ['none', { capture: 'none' }],
    ] as const) {
      const root = freshRoot()
      writeStreamFixture(root, NS, STREAM, {
        manifest: validManifest(STREAM, NS, { inputCapturePolicy: policy }),
        jsonlLines: [validAttemptRecord(STREAM, '1', { input })],
      })
      const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: STREAM })
      expect(read.status).toBe('ok')
    }
  })

  it('正例：三种不可得形态（事实优先于策略）在 digest/redacted/full 下均合法', () => {
    for (const policy of ['digest', 'redacted', 'full'] as const) {
      for (const input of [
        { capture: 'not-accessed' },
        { capture: 'unavailable' },
        { capture: 'unsafe-input' },
      ] as const) {
        const root = freshRoot()
        writeStreamFixture(root, NS, STREAM, {
          manifest: validManifest(STREAM, NS, { inputCapturePolicy: policy }),
          jsonlLines: [validAttemptRecord(STREAM, '1', { input })],
        })
        const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: STREAM })
        expect(read.status, `policy=${policy} input=${JSON.stringify(input)}`).toBe('ok')
      }
    }
  })

  it('违规：full/redacted manifest + digest 无 marker → manifest-input-policy-violation（无 marker 即无降级证明）', () => {
    for (const policy of ['full', 'redacted'] as const) {
      const root = freshRoot()
      assertIsolatedR2Issue(
        root,
        { manifest: { inputCapturePolicy: policy }, jsonlLines: [validAttemptRecord(STREAM, '1', { input: digestInput })] },
        0,
        'manifest-input-policy-violation',
      )
    }
  })

  it('违规：digest/none manifest + digest 带 marker → manifest-input-policy-violation（marker 只属于 full/redacted 的降级证明）', () => {
    for (const policy of ['digest', 'none'] as const) {
      const root = freshRoot()
      assertIsolatedR2Issue(
        root,
        { manifest: { inputCapturePolicy: policy }, jsonlLines: [validAttemptRecord(STREAM, '1', { input: degradedInput })] },
        0,
        'manifest-input-policy-violation',
      )
    }
  })

  it('违规阶梯：none+full / none+digest / digest+full / digest+redacted / redacted+full → 同码', () => {
    const cases: Array<[string, unknown]> = [
      ['none', { capture: 'full', value: { k: 1 }, digest: D }],
      ['none', digestInput],
      ['digest', { capture: 'full', value: { k: 1 }, digest: D }],
      ['digest', { capture: 'redacted', value: { k: 1 }, digest: D }],
      ['redacted', { capture: 'full', value: { k: 1 }, digest: D }],
    ]
    for (const [policy, input] of cases) {
      const root = freshRoot()
      assertIsolatedR2Issue(
        root,
        { manifest: { inputCapturePolicy: policy }, jsonlLines: [validAttemptRecord(STREAM, '1', { input })] },
        0,
        'manifest-input-policy-violation',
      )
    }
  })

  it('VFSL 先拒：digest marker 拼写/值变化 → vfsl-invalid（冻结字面量封闭；不归 policy 码）', () => {
    for (const marker of ['projected-input-too-big', '', 'PROJECTED-INPUT-TOO-LARGE']) {
      const root = freshRoot()
      writeStreamFixture(root, NS, STREAM, {
        manifest: validManifest(STREAM, NS, { inputCapturePolicy: 'full' }),
        jsonlLines: [validAttemptRecord(STREAM, '1', { input: { capture: 'digest', digest: D, degraded: marker } })],
      })
      const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: STREAM })
      expect(read.status).toBe('corrupt')
      expect(issueCodes(read.records[0]!.issues)).toContain('vfsl-invalid')
      expect(issueCodes(read.records[0]!.issues)).not.toContain('manifest-input-policy-violation')
    }
  })

  it('VFSL 先拒：非 digest capture 偷带 marker → vfsl-invalid（封闭联合拒绝未知字段；不归 policy 码）', () => {
    for (const capture of ['full', 'redacted'] as const) {
      const root = freshRoot()
      writeStreamFixture(root, NS, STREAM, {
        manifest: validManifest(STREAM, NS, { inputCapturePolicy: 'full' }),
        jsonlLines: [
          validAttemptRecord(STREAM, '1', {
            input: { capture, value: { k: 1 }, digest: D, degraded: 'projected-input-too-large' },
          }),
        ],
      })
      const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: STREAM })
      expect(read.status).toBe('corrupt')
      expect(issueCodes(read.records[0]!.issues)).toContain('vfsl-invalid')
      expect(issueCodes(read.records[0]!.issues)).not.toContain('manifest-input-policy-violation')
    }
  })
})

describe('R2 轮：真实 writer 降级产物为政策正例（设计 §5.3 #3——防设计与 #148 冻结 schema 漂移）', () => {
  it('inputPolicy=full + full 大 input 超 line budget → 落盘 record 为 digest+唯一 marker；strict reader 判 ok', () => {
    const root = freshRoot()
    const { log } = makeFileLog({
      rootDir: root,
      namespaceId: 'ns-r2-wr-degrade-full',
      inputPolicy: 'full',
      lineBudgetBytes: 1100,
      updateCapture: true,
    })
    log.emitter.emit(
      baseEmission({
        result: { kind: 'committed', effect: 'noop' },
        input: { snapshot: 'x'.repeat(4096) },
      }),
    )
    const read = readStreamStrict({ rootDir: root, namespaceId: 'ns-r2-wr-degrade-full', streamId: log.streamId })
    expect(read.status).toBe('ok')
    expect(read.records[0]!.ok).toBe(true)
    const input = (read.records[0]!.record as { input: { capture: string; degraded?: string } }).input
    expect(input.capture).toBe('digest')
    expect(input.degraded).toBe('projected-input-too-large')
  })

  it('inputPolicy=redacted + redacted 大结构 input 超 line budget → 同样降级为正例；strict reader 判 ok', () => {
    const root = freshRoot()
    const { log } = makeFileLog({
      rootDir: root,
      namespaceId: 'ns-r2-wr-degrade-red',
      inputPolicy: 'redacted',
      lineBudgetBytes: 1100,
      updateCapture: true,
    })
    log.emitter.emit(
      baseEmission({
        result: { kind: 'committed', effect: 'noop' },
        input: { snapshot: { items: Array.from({ length: 3000 }, () => ({ k: 'v' })) } },
      }),
    )
    const read = readStreamStrict({ rootDir: root, namespaceId: 'ns-r2-wr-degrade-red', streamId: log.streamId })
    expect(read.status).toBe('ok')
    expect(read.records[0]!.ok).toBe(true)
    const input = (read.records[0]!.record as { input: { capture: string; degraded?: string } }).input
    expect(input.capture).toBe('digest')
    expect(input.degraded).toBe('projected-input-too-large')
  })
})

describe('R2 轮：manifest 阈值双向（设计 §2.4 / §5.3 #4）', () => {
  it('4097B inline（> 4096）→ manifest-inline-threshold-violation', () => {
    const root = freshRoot()
    const bytes = patternedBytes(4097)
    assertIsolatedR2Issue(
      root,
      {
        jsonlLines: [
          validAttemptRecord(STREAM, '1', {
            result: {
              kind: 'committed',
              effect: 'update',
              update: {
                storage: 'inline',
                format: 'yjs-update-v1',
                payloadLength: 4097,
                crc32c: crc32cHexOf(bytes),
                base64: Buffer.from(bytes).toString('base64'),
              },
            },
          }),
        ],
      },
      0,
      'manifest-inline-threshold-violation',
    )
  })

  it('4096B sidecar（≤ 4096）→ manifest-sidecar-threshold-violation（帧本身全量合法——隔离 policy 判定）', () => {
    const root = freshRoot()
    const bytes = patternedBytes(4096)
    assertIsolatedR2Issue(
      root,
      {
        jsonlLines: [
          validAttemptRecord(STREAM, '1', {
            result: {
              kind: 'committed',
              effect: 'update',
              update: {
                storage: 'sidecar',
                format: 'yjs-update-v1',
                segment: '00000001',
                frameOffset: '0',
                payloadLength: 4096,
                crc32c: crc32cHexOf(bytes),
              },
            },
          }),
        ],
        bin: encodeFrame(1, bytes),
      },
      0,
      'manifest-sidecar-threshold-violation',
    )
  })

  it('正例：4096B inline（= 阈值，≤ 内联合法）→ ok', () => {
    const root = freshRoot()
    const bytes = patternedBytes(4096)
    writeStreamFixture(root, NS, STREAM, {
      jsonlLines: [
        validAttemptRecord(STREAM, '1', {
          result: {
            kind: 'committed',
            effect: 'update',
            update: {
              storage: 'inline',
              format: 'yjs-update-v1',
              payloadLength: 4096,
              crc32c: crc32cHexOf(bytes),
              base64: Buffer.from(bytes).toString('base64'),
            },
          },
        }),
      ],
    })
    const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: STREAM })
    expect(read.status).toBe('ok')
    expect(read.records[0]!.ok).toBe(true)
  })

  it('genesis 4097B inline（> 阈值）→ 同码（genesis carrier 同样受阈值政策）', () => {
    const root = freshRoot()
    const bytes = patternedBytes(4097)
    assertIsolatedR2Issue(
      root,
      {
        jsonlLines: [
          {
            recordKind: 'genesis-baseline',
            streamId: STREAM,
            sequence: '1',
            observedAt: OBSERVED_AT,
            source: { kind: 'local' },
            update: {
              storage: 'inline',
              format: 'yjs-update-v1',
              payloadLength: 4097,
              crc32c: crc32cHexOf(bytes),
              base64: Buffer.from(bytes).toString('base64'),
            },
          },
        ],
      },
      0,
      'manifest-inline-threshold-violation',
    )
  })
})

describe('R2 轮：manifest jsonlLineLimitBytes（设计 §2.5 / §5.3 #5）', () => {
  it('多字节内容使原始行 UTF-8 字节数超上限（JS 字符数未超）→ manifest-line-limit-exceeded（按字节计量）', () => {
    const root = freshRoot()
    // 100 个「界」= 100 code unit / 300 UTF-8 字节——用字符数当上限即可区分字节计量与字符计量
    const record = validAttemptRecord(STREAM, '1', {
      issues: { policy: 'full', items: [{ message: '界'.repeat(100), path: [] }] },
    })
    const line = JSON.stringify(record)
    assertIsolatedR2Issue(
      root,
      {
        manifest: { jsonlLineLimitBytes: line.length },
        jsonlText: line + '\n',
      },
      0,
      'manifest-line-limit-exceeded',
    )
  })

  it('等于上限 → 正例 ok（边界为 >，不含等于）', () => {
    const root = freshRoot()
    const line = JSON.stringify(validAttemptRecord(STREAM, '1'))
    writeStreamFixture(root, NS, STREAM, {
      manifest: validManifest(STREAM, NS, { jsonlLineLimitBytes: Buffer.byteLength(line) }),
      jsonlText: line + '\n',
    })
    const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: STREAM })
    expect(read.status).toBe('ok')
    expect(read.records[0]!.ok).toBe(true)
  })

  it('超限且不可解析 → 同时报 manifest-line-limit-exceeded 与 invalid-json（不跳过、不隐藏后续证据）', () => {
    const root = freshRoot()
    const padded = ' '.repeat(200) + '{broken-not-json'
    writeStreamFixture(root, NS, STREAM, {
      manifest: validManifest(STREAM, NS, { jsonlLineLimitBytes: 150 }),
      jsonlText: padded + '\n',
    })
    const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: STREAM })
    expect(read.status).toBe('corrupt')
    const codes = issueCodes(read.records[0]!.issues)
    expect(codes).toContain('manifest-line-limit-exceeded')
    expect(codes).toContain('invalid-json')
  })
})

describe('R2 轮：stream sequence 连续性（设计 §3.4 / §5.3 #6）', () => {
  function gapIssueOf(read: ReturnType<typeof readStreamStrict>, segment?: string, offset?: number): { code: string; segment?: string; offset?: number } | undefined {
    const issues = read.issues.filter((i) => i.code === 'sequence-gap')
    // 归因：发现缺口的那条 record（设计 §3.4 状态机在 actual > expected 时以当前
    // record 的 segment/offset 创建 issue）——与兄弟码 sequence-out-of-order 一致。
    const match = segment === undefined
      ? issues[0]
      : issues.find((i) => i.segment === segment && i.offset === offset)
    return match
  }

  it('[1,3]（物理删除 seq 2）→ corrupt + stream 级 sequence-gap（归因到发现记录）；两条 record 各自仍 ok', () => {
    const root = freshRoot()
    writeStreamFixture(root, NS, STREAM, {
      jsonlLines: [validAttemptRecord(STREAM, '1'), validAttemptRecord(STREAM, '3')],
    })
    const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: STREAM })
    expect(read.status).toBe('corrupt')
    expect(gapIssueOf(read)).toMatchObject({ segment: '00000001', offset: 1 })
    expect(read.records.map((r) => r.sequence)).toEqual(['1', '3'])
    for (const r of read.records) expect(r.ok).toBe(true) // gap 是 stream 级事实；record 级判定不反转
    expect(issueCodes(read.issues)).not.toContain('sequence-out-of-order') // 数值事实是缺口而非倒序
  })

  it('起始 [2] → sequence-gap（起点固定 1，不存在合法「从 2 开始」的 stream）', () => {
    const root = freshRoot()
    writeStreamFixture(root, NS, STREAM, { jsonlLines: [validAttemptRecord(STREAM, '2')] })
    const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: STREAM })
    expect(read.status).toBe('corrupt')
    expect(gapIssueOf(read)).toMatchObject({ segment: '00000001', offset: 0 })
    expect(read.records).toHaveLength(1)
  })

  it('跨 segment：seg1=[1] + seg2=[3] → sequence-gap（expected 跨 segment 不重置）', () => {
    const root = freshRoot()
    writeStreamFixture(root, NS, STREAM, { jsonlLines: [validAttemptRecord(STREAM, '1')] })
    writeSecondSegment(root, STREAM, [validAttemptRecord(STREAM, '3')])
    const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: STREAM })
    expect(read.status).toBe('corrupt')
    expect(gapIssueOf(read, '00000002', 0)).toBeDefined()
  })

  it('跨 segment 正例：seg1=[1] + seg2=[2] → ok（连续前缀跨 segment 合法）', () => {
    const root = freshRoot()
    writeStreamFixture(root, NS, STREAM, { jsonlLines: [validAttemptRecord(STREAM, '1')] })
    writeSecondSegment(root, STREAM, [validAttemptRecord(STREAM, '2')])
    const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: STREAM })
    expect(read.status).toBe('ok')
    for (const r of read.records) expect(r.ok).toBe(true)
  })

  it('R3 解耦：[1 inline, 2 sidecar-bin 被删, 3 inline] → record2 frame-missing + corrupt；不得产生虚假 sequence-gap', () => {
    const root = freshRoot()
    writeStreamFixture(root, NS, STREAM, {
      jsonlLines: [
        validAttemptRecord(STREAM, '1'),
        validAttemptRecord(STREAM, '2', {
          result: {
            kind: 'committed',
            effect: 'update',
            update: { storage: 'sidecar', format: 'yjs-update-v1', segment: '00000001', frameOffset: '0', payloadLength: 4097, crc32c: crc32cHexOf(patternedBytes(4097)) },
          },
        }),
        validAttemptRecord(STREAM, '3'),
      ],
    })
    const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: STREAM })
    expect(read.status).toBe('corrupt')
    expect(issueCodes(read.records[1]!.issues)).toContain('frame-missing')
    expect(read.records[2]!.ok).toBe(true)
    expect(issueCodes(read.issues)).not.toContain('sequence-gap')
  })

  it('R3 解耦：[1 inline, 2 sidecar 帧 CRC 损坏, 3 inline] → record2 frame-crc-mismatch；不得产生虚假 sequence-gap', () => {
    const root = freshRoot()
    const frame = encodeFrame(2, patternedBytes(4097))
    frame[FRAME_HEADER_BYTES + 10] = frame[FRAME_HEADER_BYTES + 10]! ^ 0xff
    writeStreamFixture(root, NS, STREAM, {
      jsonlLines: [
        validAttemptRecord(STREAM, '1'),
        validAttemptRecord(STREAM, '2', {
          result: {
            kind: 'committed',
            effect: 'update',
            update: { storage: 'sidecar', format: 'yjs-update-v1', segment: '00000001', frameOffset: '0', payloadLength: 4097, crc32c: crc32cHexOf(patternedBytes(4097)) },
          },
        }),
        validAttemptRecord(STREAM, '3'),
      ],
      bin: frame,
    })
    const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: STREAM })
    expect(read.status).toBe('corrupt')
    expect(issueCodes(read.records[1]!.issues)).toContain('frame-crc-mismatch')
    expect(read.records[2]!.ok).toBe(true)
    expect(issueCodes(read.issues)).not.toContain('sequence-gap')
  })

  it('身份不可解释行（VFSL 违规）不拼接精确缺口：[1, vfsl 违规(2), 3] → corrupt + vfsl-invalid；无 sequence-gap', () => {
    const root = freshRoot()
    writeStreamFixture(root, NS, STREAM, {
      jsonlLines: [
        validAttemptRecord(STREAM, '1'),
        validAttemptRecord(STREAM, '2', { operation: 'not-an-operation' }),
        validAttemptRecord(STREAM, '3'),
      ],
    })
    const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: STREAM })
    expect(read.status).toBe('corrupt')
    expect(issueCodes(read.records[1]!.issues)).toContain('vfsl-invalid')
    expect(read.records[2]!.ok).toBe(true) // 其后 record 3 自证合法
    expect(issueCodes(read.issues)).not.toContain('sequence-gap')
  })

  it('身份不可解释行（streamId 不一致）不拼接精确缺口：[1, 他流(2), 3] → corrupt + stream-mismatch；无 sequence-gap', () => {
    const root = freshRoot()
    writeStreamFixture(root, NS, STREAM, {
      jsonlLines: [
        validAttemptRecord(STREAM, '1'),
        validAttemptRecord('log-22222222222222222222222222222222', '2'),
        validAttemptRecord(STREAM, '3'),
      ],
    })
    const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: STREAM })
    expect(read.status).toBe('corrupt')
    expect(issueCodes(read.records[1]!.issues)).toContain('stream-mismatch')
    expect(issueCodes(read.issues)).not.toContain('sequence-gap')
  })

  it('物理删除 JSONL 2 且 .bin 保留帧 2 → 仍必须 sequence-gap（连续性只锚 JSONL 身份事实，不取决于 .bin 可解释性）', () => {
    const root = freshRoot()
    writeStreamFixture(root, NS, STREAM, {
      jsonlLines: [validAttemptRecord(STREAM, '1'), validAttemptRecord(STREAM, '3')],
      bin: encodeFrame(2, patternedBytes(4097)),
    })
    const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: STREAM })
    expect(read.status).toBe('corrupt')
    expect(issueCodes(read.issues)).toContain('sequence-gap')
  })
})

describe('R2 轮：policy/anchor 解耦回归（设计 §3.4 / §5.3 #9–#10）', () => {
  it('#9 capture=false + 合法 genesis(1,update) + 合法 attempt(2,noop) → ok、零 issue、无 sequence-gap（genesis 正交 + anchor 解耦）', () => {
    const root = freshRoot()
    writeStreamFixture(root, NS, STREAM, {
      manifest: validManifest(STREAM, NS, { committedUpdateCapture: false }),
      jsonlLines: [
        validGenesisRecord(STREAM),
        validAttemptRecord(STREAM, '2', { result: { kind: 'committed', effect: 'noop' } }),
      ],
    })
    const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: STREAM })
    expect(read.status).toBe('ok')
    expect(read.issues).toHaveLength(0)
    expect(read.records.map((r) => r.sequence)).toEqual(['1', '2'])
    for (const r of read.records) expect(r.ok).toBe(true)
  })

  it('#10 capture=false + [genesis(1,update), attempt(2,update 政策违规), attempt(3,noop)] → record2 政策 corrupt；序列 2 不得使 record3 产生虚假 sequence-gap', () => {
    const root = freshRoot()
    writeStreamFixture(root, NS, STREAM, {
      manifest: validManifest(STREAM, NS, { committedUpdateCapture: false }),
      jsonlLines: [
        validGenesisRecord(STREAM),
        validAttemptRecord(STREAM, '2'),
        validAttemptRecord(STREAM, '3', { result: { kind: 'committed', effect: 'noop' } }),
      ],
    })
    const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: STREAM })
    expect(read.status).toBe('corrupt')
    expect(issueCodes(read.records[0]!.issues)).toEqual([]) // genesis 合法
    expect(issueCodes(read.records[1]!.issues)).toEqual(['manifest-update-capture-violation'])
    expect(read.records[2]!.ok).toBe(true)
    expect(issueCodes(read.issues)).not.toContain('sequence-gap')
  })
})

// —— 局部 helper ——
function crc32cHexOf(bytes: Uint8Array): string {
  return crc32cHex(bytes)
}

function concatU8(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.byteLength + b.byteLength)
  out.set(a, 0)
  out.set(b, a.byteLength)
  return out
}
