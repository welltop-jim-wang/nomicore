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
import { afterEach, describe, expect, it } from 'vitest'
import { crc32cHex } from '../src/crc32c.js'
import { baseEmission } from './helpers/base.js'
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
    const frames = concatU8(encodeFrame(1, patternedBytes(100)), encodeFrame(2, patternedBytes(100)))
    // rec1 引用合法的 100B 帧（offset 0）；rec2 引用 131（≠ 前一帧 end = 125）→ 边界违规
    const rec1 = sidecarRecord(stream, '1', {
      result: {
        kind: 'committed',
        effect: 'update',
        update: { storage: 'sidecar', format: 'yjs-update-v1', segment: '00000001', frameOffset: '0', payloadLength: 100, crc32c: crc32cHexOf(patternedBytes(100)) },
      },
    })
    const rec2 = sidecarRecord(stream, '2', {
      result: {
        kind: 'committed',
        effect: 'update',
        update: { storage: 'sidecar', format: 'yjs-update-v1', segment: '00000001', frameOffset: '131', payloadLength: 100, crc32c: '00000000' },
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
    const bin = concatU8(
      encodeFrame(1, patternedBytes(4097)),
      encodeFrame(2, patternedBytes(100)),
    )
    const rec1 = sidecarRecord(stream, '1')
    const rec2 = sidecarRecord(stream, '2', {
      result: {
        kind: 'committed',
        effect: 'update',
        update: { storage: 'sidecar', format: 'yjs-update-v1', segment: '00000001', frameOffset: String(FRAME_HEADER_BYTES + 4097), payloadLength: 100, crc32c: crc32cHexOf(patternedBytes(100)) },
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
