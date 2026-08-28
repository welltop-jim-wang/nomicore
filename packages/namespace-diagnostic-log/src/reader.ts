/**
 * strict reader（设计 §7——ADR 0012 §Strict reader 与诊断性 replay）。
 *
 * 契约（§7.1）：`readStreamStrict` 为纯同步函数、**绝不抛**——任何未归类异常收敛为
 * `corrupt`；损坏/不兼容如实判定（incompatible → records:[]，不近似解释、不声称连续；
 * corrupt → records 保留逐条判定）；全部 fs 分支收敛到 23 码词表（零扩码，§11-G9）。
 *
 * 23 码词表中 storage/frame 交叉面复用 `storage-gate.ts` 共享原语（与 writer 门同源，
 * 防双份漂移）；manifest 门对照内建冻结常量（reader 只信任内建冻结 schema，
 * manifest 只作声明被核对）。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { validateLogicalSnapshot } from '@nomicore/vfsl'
import { isSafeNamespaceId, isSafeStreamId, isSegmentName, streamLayoutPaths } from './paths.js'
import { RECORD_SCHEMA_ENVELOPE, RECORD_SCHEMA_ID, getRecordSchemaCompilation } from './schema.js'
import { P_ISO_MS } from './schema-patterns.js'
import { isCanonicalDecimal, validateInlineCarrier, validateSidecarFrame } from './storage-gate.js'
import type { UpdateCarrier } from './record.js'

/** 读取请求（路径三组件；streamId/namespaceId 过安全文法后才会触达磁盘——§7.1 ①）。 */
export interface StrictReadRequest {
  rootDir: string
  namespaceId: string
  streamId: string
}

export type StrictReadStatus = 'ok' | 'corrupt' | 'incompatible'

/** 单条 stream/record issue（23 码封闭词表；segment/sequence/offset 归因）。 */
export interface StrictReadIssue {
  code: string
  /** 所属 segment（8 位十进制名）。 */
  segment?: string
  /** 关联 record 的 sequence（十进制字符串；未知时缺省）。 */
  sequence?: string
  /** JSONL 行号（0 基）。 */
  offset?: number
}

/** 单条 record 的读取判定（损坏/不兼容下逐条解释的载体）。 */
export interface StrictRecordRead {
  /** 本条 record 是否全量校验通过（record 级判定，不含 stream 级序列检查）。 */
  ok: boolean
  /** 可解析的 record（JSON.parse 产物；解析失败为 null——「可解析即报告」）。 */
  record: unknown | null
  /** record.sequence（十进制字符串；未知时 ''）。 */
  sequence: string
  issues: StrictReadIssue[]
}

export interface StrictStreamRead {
  status: StrictReadStatus
  streamId: string
  namespaceId: string
  /** manifest（解析成功即展示——含被篡改的 schema.text；不可解析/缺失为 null）。 */
  manifest: unknown | null
  issues: StrictReadIssue[]
  records: StrictRecordRead[]
}

/** incompatible 七码集（SA6 词表边界逐字：未知版本 → 不近似解释）。 */
const INCOMPATIBLE_SET = new Set([
  'dialect-unknown',
  'schema-fingerprint-mismatch',
  'record-version-unknown',
  'frame-version-unknown',
  'frame-payload-type-unknown',
  'frame-flags-nonzero',
  'frame-reserved-nonzero',
])

const RE_ISO_MS = new RegExp(P_ISO_MS)

/** manifest 恰 14 键（§2.2 键集精确；多余键/缺失键均拒——G8 严格形）。 */
const MANIFEST_KEYS = [
  'committedUpdateCapture',
  'createdAt',
  'format',
  'frameVersion',
  'inlineUpdateMaxBytes',
  'inputCapturePolicy',
  'jsonlLineLimitBytes',
  'namespaceId',
  'recordVersion',
  'schema',
  'schemaFingerprint',
  'schemaId',
  'streamId',
  'version',
]

/**
 * manifest 门（§7.1 ③）：恰 14 键 + 每键类型核对 → 身份互核（G7）→
 * 格式/版本 → dialect → 信封/指纹（自述不自洽并入）→ recordVersion → frameVersion。
 * 返回 issue code（null = 通过）；incompatible 集由调用方定 status。
 */
function manifestGateIssue(
  manifest: unknown,
  expectedStreamId: string,
  expectedNamespaceId: string,
  frozenFingerprint: string,
): string | null {
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) return 'manifest-invalid'
  const m = manifest as Record<string, unknown>
  const keys = Object.keys(m).sort()
  if (keys.length !== MANIFEST_KEYS.length || keys.join('\u0000') !== [...MANIFEST_KEYS].sort().join('\u0000')) {
    return 'manifest-invalid'
  }
  // —— 每键类型核对（任何类型/结构违规 → manifest-invalid）——
  if (typeof m.format !== 'string') return 'manifest-invalid'
  if (typeof m.version !== 'number') return 'manifest-invalid'
  if (typeof m.streamId !== 'string' || !isSafeStreamId(m.streamId)) return 'manifest-invalid'
  if (typeof m.namespaceId !== 'string' || !isSafeNamespaceId(m.namespaceId)) return 'manifest-invalid'
  if (typeof m.createdAt !== 'string' || !RE_ISO_MS.test(m.createdAt)) return 'manifest-invalid'
  const schema = m.schema
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) return 'manifest-invalid'
  const s = schema as Record<string, unknown>
  const schemaKeys = Object.keys(s).sort()
  if (schemaKeys.length !== 4 || schemaKeys.join('\u0000') !== ['id', 'lang', 'text', 'version'].join('\u0000')) {
    return 'manifest-invalid'
  }
  if (typeof s.lang !== 'string' || typeof s.version !== 'number') return 'manifest-invalid'
  if (typeof s.id !== 'string' || typeof s.text !== 'string') return 'manifest-invalid'
  if (typeof m.recordVersion !== 'number' || typeof m.frameVersion !== 'number') return 'manifest-invalid'
  if (typeof m.schemaId !== 'string' || typeof m.schemaFingerprint !== 'string') return 'manifest-invalid'
  if (typeof m.committedUpdateCapture !== 'boolean') return 'manifest-invalid'
  if (
    typeof m.inputCapturePolicy !== 'string' ||
    !['none', 'digest', 'redacted', 'full'].includes(m.inputCapturePolicy)
  ) {
    return 'manifest-invalid'
  }
  if (typeof m.inlineUpdateMaxBytes !== 'number' || !Number.isFinite(m.inlineUpdateMaxBytes)) return 'manifest-invalid'
  if (typeof m.jsonlLineLimitBytes !== 'number' || !Number.isFinite(m.jsonlLineLimitBytes)) return 'manifest-invalid'

  // —— 身份互核（G7：身份误归因风险下不逐条解释）——
  if (m.streamId !== expectedStreamId || m.namespaceId !== expectedNamespaceId) return 'stream-mismatch'
  // —— 格式/版本（G4：manifest 自身 format/version 异常 → manifest-invalid，不发明新码）——
  if (m.format !== 'ndcl-manifest' || m.version !== 1) return 'manifest-invalid'
  // —— dialect（未知 → incompatible）——
  if (s.lang !== 'vfsl' || s.version !== 1) return 'dialect-unknown'
  // —— 信封/指纹（四键逐字 + 冻结指纹 + schemaId 自述不自洽 → 并入 fingerprint 码，G7）——
  if (
    s.lang !== RECORD_SCHEMA_ENVELOPE.lang ||
    s.version !== RECORD_SCHEMA_ENVELOPE.version ||
    s.id !== RECORD_SCHEMA_ENVELOPE.id ||
    s.text !== RECORD_SCHEMA_ENVELOPE.text ||
    (m.schemaFingerprint !== undefined && m.schemaFingerprint !== frozenFingerprint) ||
    m.schemaId !== s.id
  ) {
    return 'schema-fingerprint-mismatch'
  }
  if (m.recordVersion !== 1) return 'record-version-unknown'
  if (m.frameVersion !== 1) return 'frame-version-unknown'
  return null
}

/** record → update carrier（VFSL 通过后形状保证；防御性返回 null）。 */
function carrierFromParsed(record: unknown): UpdateCarrier | null {
  if (record === null || typeof record !== 'object') return null
  const r = record as Record<string, unknown>
  if (r.recordKind === 'genesis-baseline') {
    const update = r.update
    return update !== null && typeof update === 'object' ? (update as UpdateCarrier) : null
  }
  const result = r.result
  if (result === null || typeof result !== 'object') return null
  const res = result as Record<string, unknown>
  if (res.effect === 'update' && res.update !== null && typeof res.update === 'object') {
    return res.update as UpdateCarrier
  }
  return null
}

/** parsed record → sequence 字符串（非 string 回退 ''；不作值域判定——那是 VFSL 的职责）。 */
function sequenceStringOf(record: unknown): string {
  if (record !== null && typeof record === 'object') {
    const seq = (record as Record<string, unknown>).sequence
    if (typeof seq === 'string') return seq
  }
  return ''
}

/** 目标 segment 的 .bin 内容（文件感知：缺失/非常规文件（目录占位）/不可读 → null → frame-missing）。 */
function readBinOrNull(binFile: string): Uint8Array | null {
  try {
    const st = statSync(binFile, { throwIfNoEntry: false })
    if (st === undefined || !st.isFile()) return null
    return readFileSync(binFile)
  } catch {
    return null
  }
}

/**
 * strict reader（§7.1 算法总流程；纯同步、不抛——fs 错误包络 + 全函数兜底）。
 *
 * 契约补充（§4.3）：面向**静态 stream**（writer 停写后/离线拷贝上使用），不承诺与
 * 活跃 writer 的并发一致性（1 MiB 行可拆多个 write(2)，并发 reader 可能见半行）。
 */
export function readStreamStrict(request: StrictReadRequest): StrictStreamRead {
  let manifest: unknown | null = null
  try {
    // ① 路径安全（防御性路径检查优先于任何磁盘访问；零 fs 触达——G5）
    if (!isSafeNamespaceId(request.namespaceId) || !isSafeStreamId(request.streamId)) {
      return {
        status: 'corrupt',
        streamId: request.streamId,
        namespaceId: request.namespaceId,
        manifest: null,
        issues: [{ code: 'locator-invalid' }],
        records: [],
      }
    }
    const paths = streamLayoutPaths(request.rootDir, request.namespaceId, request.streamId)

    // ② manifest 读取（ENOENT/不可读/JSON ✗/非对象 → corrupt + manifest-invalid，不解释无法自描述的 stream）
    let raw: string
    try {
      raw = readFileSync(paths.manifestPath, 'utf8')
    } catch {
      return {
        status: 'corrupt',
        streamId: request.streamId,
        namespaceId: request.namespaceId,
        manifest: null,
        issues: [{ code: 'manifest-invalid' }],
        records: [],
      }
    }
    let parsedManifest: unknown
    try {
      parsedManifest = JSON.parse(raw)
    } catch {
      return {
        status: 'corrupt',
        streamId: request.streamId,
        namespaceId: request.namespaceId,
        manifest: null,
        issues: [{ code: 'manifest-invalid' }],
        records: [],
      }
    }
    if (parsedManifest === null || typeof parsedManifest !== 'object' || Array.isArray(parsedManifest)) {
      return {
        status: 'corrupt',
        streamId: request.streamId,
        namespaceId: request.namespaceId,
        manifest: null,
        issues: [{ code: 'manifest-invalid' }],
        records: [],
      }
    }
    manifest = parsedManifest

    // ③ manifest 门（21 码/严格形见 manifestGateIssue；incompatible → records:[]）
    const compiled = getRecordSchemaCompilation()
    if (!compiled.ok) {
      return {
        status: 'corrupt',
        streamId: request.streamId,
        namespaceId: request.namespaceId,
        manifest,
        issues: [{ code: 'manifest-invalid' }],
        records: [],
      }
    }
    const gateIssue = manifestGateIssue(parsedManifest, request.streamId, request.namespaceId, compiled.envelopeFingerprint)
    if (gateIssue !== null) {
      const incompatible = INCOMPATIBLE_SET.has(gateIssue)
      return {
        status: incompatible ? 'incompatible' : 'corrupt',
        streamId: request.streamId,
        namespaceId: request.namespaceId,
        manifest,
        issues: [{ code: gateIssue }],
        records: [],
      }
    }

    const streamIssues: StrictReadIssue[] = []

    // ④ segments 枚举（readdir throw → corrupt + manifest-invalid——构造协议保证 segments/ 存在，§11-G9）
    let entries: string[]
    try {
      entries = readdirSync(paths.segmentsDir)
    } catch {
      return {
        status: 'corrupt',
        streamId: request.streamId,
        namespaceId: request.namespaceId,
        manifest,
        issues: [{ code: 'manifest-invalid' }],
        records: [],
      }
    }
    const segmentSet = new Set<string>()
    for (const entry of entries) {
      let base = entry
      if (base.endsWith('.jsonl')) base = base.slice(0, -'.jsonl'.length)
      else if (base.endsWith('.bin')) base = base.slice(0, -'.bin'.length)
      if (isSegmentName(base)) segmentSet.add(base)
    }
    const segments = [...segmentSet].sort() // 8 位定宽十进制 → 字典序 = 数值序

    const records: StrictRecordRead[] = []
    const recordIssuesAll: StrictReadIssue[] = []
    const orderSequences: bigint[] = []
    const bins = new Map<string, Uint8Array | null>()
    const expectedOffsets = new Map<string, bigint>()

    const checkSidecar = (
      carrier: UpdateCarrier & { storage: 'sidecar' },
      sequence: string,
    ): string | null => {
      // R-1（SA4 R1 reject）：frameOffset 是 P_DECIMAL 的第二个消费面——同层镜像复核
      // （前导零/空串/非十进制字面 → record 级 vfsl-invalid，与 sequence 补齐同层同码；
      // 先镜像后解析——不依赖 BigInt('') 的 Node 20/24 行为分歧）。
      if (!isCanonicalDecimal(carrier.frameOffset)) return 'vfsl-invalid'
      if (!segmentSet.has(carrier.segment)) return 'reference-invalid'
      let bytes = bins.get(carrier.segment)
      if (bytes === undefined) {
        bytes = readBinOrNull(join(paths.segmentsDir, `${carrier.segment}.bin`))
        bins.set(carrier.segment, bytes)
      }
      const expected = expectedOffsets.get(carrier.segment) ?? null
      const check = validateSidecarFrame(
        bytes,
        bytes === null ? 0 : bytes.byteLength,
        BigInt(carrier.frameOffset),
        expected,
        sequence,
        carrier,
      )
      if (!check.ok) return check.issue
      expectedOffsets.set(carrier.segment, check.nextExpectedOffset)
      return null
    }

    // ⑤ 逐 segment、逐行（无 '\n' 结尾的残尾块按一行处理——JSON parse 大概率失败 → invalid-json）
    for (const segment of segments) {
      let lines: string[]
      try {
        const text = readFileSync(join(paths.segmentsDir, `${segment}.jsonl`), 'utf8')
        lines = text.split('\n')
        if (lines[lines.length - 1] === '') lines.pop()
      } catch (err) {
        if ((err as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
          lines = [] // 合法 BIN-first 崩溃窗口：有 bin 无 jsonl 的段按零行处理、无 issue
        } else {
          streamIssues.push({ code: 'invalid-json', segment }) // 该段零 record 条目；其余可读段照常
          continue
        }
      }
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!
        let parsed: unknown
        try {
          parsed = JSON.parse(line)
        } catch {
          const issue: StrictReadIssue = { code: 'invalid-json', segment, offset: i }
          records.push({ ok: false, record: null, sequence: '', issues: [issue] })
          recordIssuesAll.push(issue)
          continue
        }
        const sequence = sequenceStringOf(parsed)
        const vfsl = validateLogicalSnapshot(compiled.derived, parsed)
        // P_DECIMAL 前导零/空串复核（见 isCanonicalDecimal 注：VFSL 引擎 alternation
        // 语义放行 '01'/''——设计 §7.1 B 把「无前导零十进制纪律」归 VFSL 层，本层以
        // 冻结常量镜像实现同一落点；sequence 面）
        const sequenceShaped = isCanonicalDecimal(sequence)
        if (!vfsl.ok || !sequenceShaped) {
          const issue: StrictReadIssue = { code: 'vfsl-invalid', segment, offset: i, ...(sequence !== '' ? { sequence } : {}) }
          records.push({ ok: false, record: parsed, sequence, issues: [issue] })
          recordIssuesAll.push(issue)
          continue
        }
        // —— storage 交叉（VFSL 过后才做；streamId 交叉先于 carrier 交叉——§7.3）——
        const recordIssues: StrictReadIssue[] = []
        const parsedStreamId = (parsed as { streamId: unknown }).streamId
        if (parsedStreamId !== request.streamId) {
          recordIssues.push({ code: 'stream-mismatch', segment, offset: i, sequence })
        } else {
          const carrier = carrierFromParsed(parsed)
          if (carrier !== null) {
            if (carrier.storage === 'inline') {
              const issue = validateInlineCarrier(carrier)
              if (issue !== null) recordIssues.push({ code: issue, segment, offset: i, sequence })
            } else {
              const issue = checkSidecar(carrier, sequence)
              if (issue !== null) recordIssues.push({ code: issue, segment, offset: i, sequence })
            }
          }
        }
        records.push({ ok: recordIssues.length === 0, record: parsed, sequence, issues: recordIssues })
        for (const issue of recordIssues) recordIssuesAll.push(issue)
        orderSequences.push(BigInt(sequence))
      }
    }

    // ⑥ 跨 segment 序列检查（严格递增；gap 合法——sequence 不代表业务尝试无缺）
    for (let i = 1; i < orderSequences.length; i++) {
      if (orderSequences[i]! <= orderSequences[i - 1]!) {
        streamIssues.push({ code: 'sequence-out-of-order' })
        break
      }
    }

    // ⑦ 聚合（stream 级 ∪ 全部 record 级镜像；incompatible → records:[]）
    const allIssues = [...streamIssues, ...recordIssuesAll]
    if (allIssues.some((issue) => INCOMPATIBLE_SET.has(issue.code))) {
      return {
        status: 'incompatible',
        streamId: request.streamId,
        namespaceId: request.namespaceId,
        manifest,
        issues: allIssues,
        records: [],
      }
    }
    return {
      status: allIssues.length === 0 ? 'ok' : 'corrupt',
      streamId: request.streamId,
      namespaceId: request.namespaceId,
      manifest,
      issues: allIssues,
      records,
    }
  } catch {
    // ⑧ 兜底（R2 修订 SA2 #3）：损坏诊断工具绝不在损坏状态下自己崩——绝不抛
    return {
      status: 'corrupt',
      streamId: request.streamId,
      namespaceId: request.namespaceId,
      manifest,
      issues: [{ code: 'manifest-invalid' }],
      records: [],
    }
  }
}
