/**
 * strict reader（设计 §7——ADR 0012 §Strict reader 与诊断性 replay；R2 修订：
 * 逐行执行 manifest 冻结的 format policy + stream sequence 从 1 的连续性状态机）。
 *
 * 契约（§7.1）：`readStreamStrict` 为纯同步函数、**绝不抛**——任何未归类异常收敛为
 * `corrupt`；损坏/不兼容如实判定（incompatible → records:[]，不近似解释、不声称连续；
 * corrupt → records 保留逐条判定）；全部 fs 分支收敛到 reader 稳定码词表
 * （§11-G9；R2 起 reader 私有域新增六码，见下）。
 *
 * 码表（R2 设计 §2.6）：reader 域新增五 record 码
 * `manifest-update-capture-violation` / `manifest-input-policy-violation` /
 * `manifest-inline-threshold-violation` / `manifest-sidecar-threshold-violation` /
 * `manifest-line-limit-exceeded` 与一个 stream 级码 `sequence-gap`——全部映射
 * `corrupt`，**不加入 INCOMPATIBLE_SET**（它们表示可由当前 v1 规范精确解释、但物理
 * 记录违反冻结 policy/连续性的事实；未知格式仍走 incompatible → records:[]）。
 * storage/frame 交叉面复用 `storage-gate.ts` 共享原语（与 writer 门同源，防双份漂移）；
 * manifest 门对照内建冻结常量（reader 只信任内建冻结 schema，manifest 只作声明被核对）。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { validateLogicalSnapshot } from '@nomicore/vfsl'
import { isSafeNamespaceId, isSafeStreamId, isSegmentName, streamLayoutPaths } from './paths.js'
import { RECORD_SCHEMA_ENVELOPE, RECORD_SCHEMA_ID, getRecordSchemaCompilation } from './schema.js'
import { P_ISO_MS } from './schema-patterns.js'
import { isCanonicalDecimal, validateInlineCarrier, validateSidecarFrame } from './storage-gate.js'
import { FRAME_HEADER_BYTES } from './frame.js'
import type { UpdateCarrier } from './record.js'
import { UINT64_MAX } from './adapters/memory.js'

/** 读取请求（路径三组件；streamId/namespaceId 过安全文法后才会触达磁盘——§7.1 ①）。 */
export interface StrictReadRequest {
  rootDir: string
  namespaceId: string
  streamId: string
}

export type StrictReadStatus = 'ok' | 'corrupt' | 'incompatible'

/** 单条 stream/record issue（reader 稳定码词表共 29 码——23 码 v1 基表 + R2 六码；见文件头注；segment/sequence/offset 归因）。 */
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

/** incompatible 七码集（SA6 词表边界逐字：未知版本 → 不近似解释）。
 *  R2（设计 §2.6）：六个 manifest/sequence 新码**不属于**本集——它们不是未知格式，
 *  而是可精确解释的 policy/连续性违规，走 `corrupt` 并保留逐条 record 判定。 */
const INCOMPATIBLE_SET = new Set([
  'dialect-unknown',
  'schema-fingerprint-mismatch',
  'record-version-unknown',
  'frame-version-unknown',
  'frame-payload-type-unknown',
  'frame-flags-nonzero',
  'frame-reserved-nonzero',
])

/**
 * manifest 冻结的 format policy（R2 设计 §2.1——manifest 严格门通过后提取的只读四值；
 * 不得在未通过 manifest 门的 manifest 上执行策略；#153 追加三 roll target——仅 17 键形状存在）。
 */
interface ManifestFormatPolicy {
  committedUpdateCapture: boolean
  inputCapturePolicy: 'none' | 'digest' | 'redacted' | 'full'
  inlineUpdateMaxBytes: number
  jsonlLineLimitBytes: number
  targetJsonlSegmentBytes?: number
  targetBinSegmentBytes?: number
  targetRecordsPerSegment?: number
}

/** 原始物理行（text 供 JSON.parse；byteLength 供 §2.5 行长检查——不含行终止符 `\n`）。 */
interface RawJsonlLine {
  text: string
  byteLength: number
}

const TEXT_DECODER = new TextDecoder()

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

/** #153 roll targets 三键（§9.1 原子扩展：与 14 键共同构成 17 键 current 形状；三键同进同出）。 */
const ROLL_TARGET_KEYS = ['targetJsonlSegmentBytes', 'targetBinSegmentBytes', 'targetRecordsPerSegment'] as const

/** manifest 键集封闭形状：恰 14（legacy）/ 恰 17（current）/ 其它（→ manifest-invalid）。 */
function manifestKeyShape(manifest: Record<string, unknown>): '14' | '17' | null {
  const joined = Object.keys(manifest).sort().join('\u0000')
  const legacy = [...MANIFEST_KEYS].sort().join('\u0000')
  const current = [...MANIFEST_KEYS, ...ROLL_TARGET_KEYS].sort().join('\u0000')
  if (joined === legacy) return '14'
  if (joined === current) return '17'
  return null
}

/** roll target 值域（§9.1：整数 ∧ ≥1 ∧ ≤ 2^53-1——Number.isSafeInteger）。 */
function isRollTargetValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
}

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
  // §9.1 双封闭形状：恰 14 键（legacy）∪ 恰 17 键（14 + 三 target 原子扩展）；其余 → invalid
  const shape = manifestKeyShape(m)
  if (shape === null) return 'manifest-invalid'
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
  if (shape === '17') {
    for (const key of ROLL_TARGET_KEYS) {
      if (!isRollTargetValue(m[key])) return 'manifest-invalid'
    }
  }

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
 * 原始 JSONL 字节 → 逐物理行（§2.1）：按 UTF-8 字节扫描 0x0A 分隔，行 byteLength
 * 为该行原始 UTF-8 字节数、排除单个行终止符 `\n`；text 按该行字节子串解码（避免
 * 多字节字符下按 whole-buffer 字节索引切串错位）。末尾无 `\n` 的残尾照常一行；
 * 文件整体空 → 零行。
 */
function splitRawLines(buf: Uint8Array): RawJsonlLine[] {
  const out: RawJsonlLine[] = []
  let start = 0
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a) {
      out.push({ text: TEXT_DECODER.decode(buf.subarray(start, i)), byteLength: i - start })
      start = i + 1
    }
  }
  if (start < buf.length) out.push({ text: TEXT_DECODER.decode(buf.subarray(start)), byteLength: buf.length - start })
  return out
}

/**
 * 尝试 input 捕获与 manifest 冻结的 `inputCapturePolicy` 是否冲突（R2 设计 §2.3 + 总控
 * 裁决 R2-G19：`{capture:'none'}`（无 input 的 emission 产物）在所有 policy 下恒合法——
 * 事实优先于策略；not-accessed/unavailable/unsafe-input 在 none policy 下仍属异常信号）。
 * 本函数只在 VFSL 已通过后运行——冻结封闭 union 已保证 input 形状为七分支之一，
 * 非 digest 偷带 degraded / marker 拼写错误正常会先判 vfsl-invalid（防御镜像下仍归本码）。
 */
function inputPolicyViolation(input: unknown, policy: string): boolean {
  if (input === null || typeof input !== 'object') return true
  const capture = (input as { capture: unknown }).capture
  const hasDegraded = Object.prototype.hasOwnProperty.call(input, 'degraded')
  if (capture === 'digest') {
    const markerValid = !hasDegraded || (input as { degraded: unknown }).degraded === 'projected-input-too-large'
    if (!markerValid) return true // 防御镜像：VFSL 已拒绝该字面量（不可达）
    if ((policy === 'none' || policy === 'digest') && hasDegraded) return true // marker 只属于 full/redacted 的降级证明
    if ((policy === 'full' || policy === 'redacted') && !hasDegraded) return true // 强策略无 marker = 无降级证明
    if (policy === 'none') return true // digest 本身在 none policy 下违规
    return false // digest（无 marker）在 digest policy 下合法
  }
  // —— 非 digest capture ——
  if (hasDegraded) return true // 冻结 union 不可达；防御镜像
  if (policy === 'none') return capture !== 'none'
  return !(
    capture === 'none' ||
    capture === 'not-accessed' ||
    capture === 'unavailable' ||
    capture === 'unsafe-input' ||
    capture === policy
  )
}

/** manifest 严格门通过后提取只读 policy（四值 + #153 三 target；防御性复核；异常顺序不可达——门已核对类型）。 */
function extractFormatPolicy(manifest: Record<string, unknown>): ManifestFormatPolicy | null {
  const committedUpdateCapture = manifest.committedUpdateCapture
  const inputCapturePolicy = manifest.inputCapturePolicy
  const inlineUpdateMaxBytes = manifest.inlineUpdateMaxBytes
  const jsonlLineLimitBytes = manifest.jsonlLineLimitBytes
  if (typeof committedUpdateCapture !== 'boolean') return null
  if (
    typeof inputCapturePolicy !== 'string' ||
    !['none', 'digest', 'redacted', 'full'].includes(inputCapturePolicy)
  ) {
    return null
  }
  if (typeof inlineUpdateMaxBytes !== 'number' || !Number.isFinite(inlineUpdateMaxBytes)) return null
  if (typeof jsonlLineLimitBytes !== 'number' || !Number.isFinite(jsonlLineLimitBytes)) return null
  const targetJsonlSegmentBytes = manifest.targetJsonlSegmentBytes
  const targetBinSegmentBytes = manifest.targetBinSegmentBytes
  const targetRecordsPerSegment = manifest.targetRecordsPerSegment
  if (targetJsonlSegmentBytes !== undefined && !isRollTargetValue(targetJsonlSegmentBytes)) return null
  if (targetBinSegmentBytes !== undefined && !isRollTargetValue(targetBinSegmentBytes)) return null
  if (targetRecordsPerSegment !== undefined && !isRollTargetValue(targetRecordsPerSegment)) return null
  return {
    committedUpdateCapture,
    inputCapturePolicy: inputCapturePolicy as ManifestFormatPolicy['inputCapturePolicy'],
    inlineUpdateMaxBytes,
    jsonlLineLimitBytes,
    ...(targetJsonlSegmentBytes !== undefined ? { targetJsonlSegmentBytes } : {}),
    ...(targetBinSegmentBytes !== undefined ? { targetBinSegmentBytes } : {}),
    ...(targetRecordsPerSegment !== undefined ? { targetRecordsPerSegment } : {}),
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
    // —— 只读 policy 提取（§2.1：仅 manifest 门通过后；门已核对四值类型）——
    const policy = extractFormatPolicy(parsedManifest as Record<string, unknown>)
    if (policy === null) {
      return {
        status: 'corrupt',
        streamId: request.streamId,
        namespaceId: request.namespaceId,
        manifest,
        issues: [{ code: 'manifest-invalid' }],
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
    const bins = new Map<string, Uint8Array | null>()
    const expectedOffsets = new Map<string, bigint>()
    // —— 连续性状态机（§3.4）：expected = 下一可信 sequence；null = 身份不可解释段后的未知基线 ——
    let expectedSequence: bigint | null = 1n

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

    // ⑤ 逐 segment、逐行（原始字节行分割——§2.1：行长按原始 UTF-8 字节、排除 '\n'；
    //    无 '\n' 结尾的残尾块按一行处理——#153 §9.2 起记 line-unterminated，不因可 parse 豁免）
    const segmentJsonlBytes = new Map<string, number>()
    const segmentBinBytes = new Map<string, number>()
    const segmentRecordCount = new Map<string, number>()
    const segmentUnterminated = new Set<string>()
    for (const segment of segments) {
      let jbuf: Uint8Array | null
      try {
        jbuf = readFileSync(join(paths.segmentsDir, `${segment}.jsonl`))
      } catch (err) {
        if ((err as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
          jbuf = null // 合法 BIN-first 崩溃窗口：有 bin 无 jsonl 的段按零行处理、无 issue
        } else {
          streamIssues.push({ code: 'invalid-json', segment }) // 该段零 record 条目；其余可读段照常
          continue
        }
      }
      const jsonlBytes = jbuf === null ? 0 : jbuf.byteLength
      const unterminated = jbuf !== null && jbuf.byteLength > 0 && jbuf[jbuf.byteLength - 1] !== 0x0a
      const rawLines = jbuf === null ? [] : splitRawLines(jbuf)
      segmentJsonlBytes.set(segment, jsonlBytes)
      segmentRecordCount.set(segment, unterminated ? rawLines.length - 1 : rawLines.length)
      if (unterminated) segmentUnterminated.add(segment)
      try {
        const st = statSync(join(paths.segmentsDir, `${segment}.bin`), { throwIfNoEntry: false })
        segmentBinBytes.set(segment, st !== undefined && st.isFile() ? st.size : 0)
      } catch {
        segmentBinBytes.set(segment, 0)
      }
      for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i]!
        const recordIssues: StrictReadIssue[] = []
        // —— §9.2 line-unterminated（终止符证明：末物理块缺 '\n' 即不完整行，与内容可 parse 无关）——
        if (unterminated && i === rawLines.length - 1) {
          recordIssues.push({ code: 'line-unterminated', segment, offset: i })
        }
        // —— §2.5 行长检查（先于解析：超限行即使不可解析也保留该 issue——不跳过、不隐藏证据）——
        if (line.byteLength > policy.jsonlLineLimitBytes) {
          recordIssues.push({ code: 'manifest-line-limit-exceeded', segment, offset: i })
        }
        let parsed: unknown
        try {
          parsed = JSON.parse(line.text)
        } catch {
          recordIssues.push({ code: 'invalid-json', segment, offset: i })
          records.push({ ok: false, record: null, sequence: '', issues: recordIssues })
          for (const issue of recordIssues) recordIssuesAll.push(issue)
          expectedSequence = null // 身份不可解释：不锚定、不拼接精确缺口（§3.4）
          continue
        }
        const sequence = sequenceStringOf(parsed)
        const vfsl = validateLogicalSnapshot(compiled.derived, parsed)
        // P_DECIMAL 前导零/空串复核（见 isCanonicalDecimal 注：VFSL 引擎 alternation
        // 语义放行 '01'/''——设计 §7.1 B 把「无前导零十进制纪律」归 VFSL 层，本层以
        // 冻结常量镜像实现同一落点；sequence 面）
        const sequenceShaped = isCanonicalDecimal(sequence)
        if (!vfsl.ok || !sequenceShaped) {
          recordIssues.push({
            code: 'vfsl-invalid',
            segment,
            offset: i,
            ...(sequence !== '' ? { sequence } : {}),
          })
          records.push({ ok: false, record: parsed, sequence, issues: recordIssues })
          for (const issue of recordIssues) recordIssuesAll.push(issue)
          expectedSequence = null // 身份不可解释：不锚定、不拼接精确缺口（§3.4）
          continue
        }
        // —— streamId 交叉（§3.4 锚定前提之一；先于 carrier 交叉——§7.3）——
        const parsedStreamId = (parsed as { streamId: unknown }).streamId
        const streamIdMatches = parsedStreamId === request.streamId
        if (!streamIdMatches) {
          recordIssues.push({ code: 'stream-mismatch', segment, offset: i, sequence })
        } else {
          // —— §2.2–§2.4 manifest policy 检查（可与 storage 检查共存；一条可拥有多个 issue）——
          const kind = (parsed as { recordKind: unknown }).recordKind
          // §2.2 committedUpdateCapture：capture=false 的 attempt 不得携带 update carrier；
          // genesis 与 attempt capture 正交（Host 显式基线，恒合法）。
          const carrier = carrierFromParsed(parsed)
          if (!policy.committedUpdateCapture && carrier !== null && kind !== 'genesis-baseline') {
            recordIssues.push({ code: 'manifest-update-capture-violation', segment, offset: i, sequence })
          }
          // §2.3 inputCapturePolicy：仅 attempt（genesis 无 input 字段、不参与）。
          if (kind === 'attempt') {
            const input = (parsed as { input: unknown }).input
            if (inputPolicyViolation(input, policy.inputCapturePolicy)) {
              recordIssues.push({ code: 'manifest-input-policy-violation', segment, offset: i, sequence })
            }
          }
          // —— 既有 carrier/frame storage 交叉（§2.4：本体校验成功后才运行阈值政策）——
          if (carrier !== null) {
            const storageIssue = carrier.storage === 'inline' ? validateInlineCarrier(carrier) : checkSidecar(carrier, sequence)
            if (storageIssue !== null) {
              recordIssues.push({ code: storageIssue, segment, offset: i, sequence })
            } else if (carrier.storage === 'inline') {
              // §2.4 双向阈值：inline 必须 ≤ 阈值；sidecar 必须 > 阈值（阈值 0 → 仅 0 字节可 inline）。
              if (carrier.payloadLength > policy.inlineUpdateMaxBytes) {
                recordIssues.push({ code: 'manifest-inline-threshold-violation', segment, offset: i, sequence })
              }
            } else if (carrier.payloadLength <= policy.inlineUpdateMaxBytes) {
              recordIssues.push({ code: 'manifest-sidecar-threshold-violation', segment, offset: i, sequence })
            }
          }
        }
        records.push({ ok: recordIssues.length === 0, record: parsed, sequence, issues: recordIssues })
        for (const issue of recordIssues) recordIssuesAll.push(issue)
        // —— §3.4 跨 segment 连续性状态机（anchor = JSON/VFSL/canonical/streamId；起点固定 1n；
        //    policy/storage 检查独立于锚定——ok=false 不取消 sequence 事实）——
        if (!streamIdMatches) {
          expectedSequence = null // undefined over identity break：不拼接精确缺口
          continue
        }
        if (unterminated && i === rawLines.length - 1) {
          expectedSequence = null // §9.2：未终止末块 = 不完整行——sequence 不锚定（身份不可解释行现行语义）
          continue
        }
        const actual = BigInt(sequence)
        if (expectedSequence === null) {
          expectedSequence = actual + 1n // 身份不可解释段后的新基线：不推断数值缺口
        } else if (actual < expectedSequence) {
          streamIssues.push({ code: 'sequence-out-of-order', segment, offset: i, sequence })
        } else if (actual > expectedSequence) {
          // R2-G20：归因 = 发现缺口的物理 record（segment/offset/sequence——与兄弟码一致）
          streamIssues.push({ code: 'sequence-gap', segment, offset: i, sequence })
          expectedSequence = actual + 1n
        } else {
          expectedSequence = actual + 1n
        }
      }
    }

    // —— §9.3 manifest-roll-target-violation（17 键形状）：每个闭段（存在更大编号 segment）
    //    必须至少一维达标（滚动只在达标时发生——"任一 target 达到时关闭当前 group" 的逆否）；
    //    最大段不核查（当前组未关闭）；14 键 legacy 无 targets → 跳过 ——
    if (policy.targetRecordsPerSegment !== undefined && segments.length > 0) {
      const maxSegment = segments[segments.length - 1]!
      for (const segment of segments) {
        if (segment === maxSegment) continue
        const jsonlBytes = segmentJsonlBytes.get(segment) ?? 0
        const binBytes = segmentBinBytes.get(segment) ?? 0
        const records = segmentRecordCount.get(segment) ?? 0
        if (
          jsonlBytes < (policy.targetJsonlSegmentBytes ?? 0) &&
          binBytes < (policy.targetBinSegmentBytes ?? 0) &&
          records < (policy.targetRecordsPerSegment ?? 0)
        ) {
          streamIssues.push({ code: 'manifest-roll-target-violation', segment })
        }
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

// ============================================================================
// #153 §4.1 健康证明：analyzeStreamForResume（内部函数——不从 index.ts 导出；
// 与 readStreamStrict 共享 manifest 门/行分割/逐行校验/连续性状态机/内部原语）。
// ============================================================================

/** 三类可修复尾部（§5.1）。 */
export type ResumeRepairKind = 'jsonl-incomplete-line' | 'bin-incomplete-frame' | 'bin-orphan-frames'

/** 单条修复（§5.5；segment 恒为 SegMax）。 */
export interface ResumeRepair {
  kind: ResumeRepairKind
  segment: string
  /** 截断至该字节偏移（C1 = 最后 0x0A 下一字节；C2/C3 = T）。 */
  truncateToBytes: number
  /** 截断字节数。 */
  truncatedBytes: number
}

/** resume 装配态（§6.3 种子；修复后计数）。 */
export interface ResumeStreamState {
  lastCommittedSequence: string | null
  currentSegment: string
  jsonlBytes: number
  binBytes: number
  records: number
  exhaustedAtOpen: 'sequence' | 'segment' | null
}

/** rotate cause 封闭枚举（§4.4）。 */
export type RotateCause =
  | 'manifest-missing'
  | 'manifest-invalid'
  | 'legacy-manifest'
  | 'frozen-policy-mismatch'
  | 'stream-corrupt'
  | 'stream-incompatible'
  | 'repair-io-failure'

/** 健康证明闭合判定（§4.1）。 */
export type ResumeAnalysis =
  | { verdict: 'resume'; repairs: ResumeRepair[]; resume: ResumeStreamState }
  | { verdict: 'rotate'; cause: RotateCause }

/** 解析后配置（§4.2 冻结策略比对的匹配面）。 */
export interface ResumeResolvedConfig {
  updateCapture: boolean
  inputPolicy: string
  inlineUpdateMaxBytes: number
  lineBudgetBytes: number
  targetJsonlSegmentBytes: number
  targetBinSegmentBytes: number
  targetRecordsPerSegment: number
}

/** 读取三分支（§5.1 R1）：ENOENT（真缺失）≠ 不可读 ≠ 可读。 */
type SegmentReadResult = { bytes: Uint8Array | null } | 'enoent' | 'unreadable'

/**
 * segment .jsonl 读取（文件感知三分支：ENOENT → ∅；目录占位/不可读 → 'unreadable'）。
 */
function readSegmentJsonl(file: string): SegmentReadResult {
  try {
    const st = statSync(file, { throwIfNoEntry: false })
    if (st === undefined) return 'enoent'
    if (!st.isFile()) return 'unreadable'
    return { bytes: readFileSync(file) }
  } catch (err) {
    if ((err as NodeJS.ErrnoException | null)?.code === 'ENOENT') return 'enoent'
    return 'unreadable'
  }
}

/** segment .bin 读取（文件感知；ENOENT → 空集；目录占位/不可读 → 'unreadable'）。 */
function readSegmentBin(file: string): SegmentReadResult {
  try {
    const st = statSync(file, { throwIfNoEntry: false })
    if (st === undefined) return 'enoent'
    if (!st.isFile()) return 'unreadable'
    return { bytes: readFileSync(file) }
  } catch (err) {
    if ((err as NodeJS.ErrnoException | null)?.code === 'ENOENT') return 'enoent'
    return 'unreadable'
  }
}

/**
 * §5.4 bin 尾部行走（T 起）：返回 'complete'（全为完整未引用帧 → C3）/
 * 'incomplete'（尾块不足 header 或 header 合法而 payload 越界 → C2）/
 * 'unknown-magic'（不可证明为撕裂的字节 → corrupt）/ 'unknown-frame'（未知 frame 事实 → incompatible）。
 */
function walkBinTail(bin: Uint8Array, from: number): 'complete' | 'incomplete' | 'unknown-magic' | 'unknown-frame' {
  let p = from
  const len = bin.byteLength
  while (p < len) {
    if (len - p < FRAME_HEADER_BYTES) return 'incomplete'
    const header = bin.subarray(p, p + FRAME_HEADER_BYTES)
    const magic = String.fromCharCode(header[0]!, header[1]!, header[2]!, header[3]!)
    if (magic !== 'NDCL') return 'unknown-magic'
    if (header[4] !== 1) return 'unknown-frame'
    if (header[5] !== 1) return 'unknown-frame'
    if (header[6] !== 0) return 'unknown-frame'
    if (((header[7]! << 8) | header[8]!) !== 0) return 'unknown-frame'
    const payloadLength = ((header[17]! << 24) | (header[18]! << 16) | (header[19]! << 8) | header[20]!) >>> 0
    if (p + FRAME_HEADER_BYTES + payloadLength > len) return 'incomplete'
    p += FRAME_HEADER_BYTES + payloadLength
  }
  return 'complete'
}

/**
 * 从 0 起的完整帧前缀末端（§13.11 契约面：无任何引用时，C2/C3 的截断点取完整帧前缀边界而非
 * 0——SA6 红灯锚定「C1+C2 并存 → 两事件两截断」中未引用完整帧保留为惰性残渣，仅截断不完整
 * 尾块；有引用时该值不参与（T = max ref end 优先）。
 */
function walkCompletePrefixEnd(bin: Uint8Array): number {
  let p = 0
  const len = bin.byteLength
  while (p < len) {
    if (len - p < FRAME_HEADER_BYTES) break
    const header = bin.subarray(p, p + FRAME_HEADER_BYTES)
    const magic = String.fromCharCode(header[0]!, header[1]!, header[2]!, header[3]!)
    if (magic !== 'NDCL') break
    if (header[4] !== 1 || header[5] !== 1 || header[6] !== 0 || ((header[7]! << 8) | header[8]!) !== 0) break
    const payloadLength = ((header[17]! << 24) | (header[18]! << 16) | (header[19]! << 8) | header[20]!) >>> 0
    if (p + FRAME_HEADER_BYTES + payloadLength > len) break
    p += FRAME_HEADER_BYTES + payloadLength
  }
  return p
}

/**
 * §4.1 健康证明（reopen 的严格检查；纯同步、绝不抛——调用方（file.ts 构造路径）
 * 已有构造级 crash 包络，本函数内部异常一律按 manifest-invalid 收敛）。
 *
 * 判定次序（§4.1 R1）：manifest 门（含 incompatible 全部判定）先于 resume 特有的
 * 17 键要求——14 键篡改指纹 → stream-incompatible（与 reader 同向），非 legacy-manifest。
 */
export function analyzeStreamForResume(req: {
  rootDir: string
  namespaceId: string
  streamId: string
  resolved: ResumeResolvedConfig
}): ResumeAnalysis {
  const paths = streamLayoutPaths(req.rootDir, req.namespaceId, req.streamId)
  try {
    // —— 1. manifest 门（与 reader 同源、同序；§4.1 短路次序 a–d）——
    let raw: string
    try {
      raw = readFileSync(paths.manifestPath, 'utf8')
    } catch (err) {
      return {
        verdict: 'rotate',
        cause: (err as NodeJS.ErrnoException | null)?.code === 'ENOENT' ? 'manifest-missing' : 'manifest-invalid',
      }
    }
    let parsedManifest: unknown
    try {
      parsedManifest = JSON.parse(raw)
    } catch {
      return { verdict: 'rotate', cause: 'manifest-invalid' }
    }
    if (parsedManifest === null || typeof parsedManifest !== 'object' || Array.isArray(parsedManifest)) {
      return { verdict: 'rotate', cause: 'manifest-invalid' }
    }
    const compiled = getRecordSchemaCompilation()
    if (!compiled.ok) return { verdict: 'rotate', cause: 'manifest-invalid' }
    const gateIssue = manifestGateIssue(parsedManifest, req.streamId, req.namespaceId, compiled.envelopeFingerprint)
    if (gateIssue !== null) {
      return { verdict: 'rotate', cause: INCOMPATIBLE_SET.has(gateIssue) ? 'stream-incompatible' : 'manifest-invalid' }
    }
    const shape = manifestKeyShape(parsedManifest as Record<string, unknown>)
    if (shape !== '17') return { verdict: 'rotate', cause: 'legacy-manifest' } // 门全过但恰 14 键 → 可读不可续写
    const policy = extractFormatPolicy(parsedManifest as Record<string, unknown>)
    if (policy === null || policy.targetRecordsPerSegment === undefined) {
      return { verdict: 'rotate', cause: 'manifest-invalid' }
    }

    // —— 2. 冻结策略比对（§4.2；仅 17 键形状可达）——
    const r = req.resolved
    if (
      policy.committedUpdateCapture !== r.updateCapture ||
      policy.inputCapturePolicy !== r.inputPolicy ||
      policy.inlineUpdateMaxBytes !== r.inlineUpdateMaxBytes ||
      policy.jsonlLineLimitBytes !== r.lineBudgetBytes ||
      policy.targetJsonlSegmentBytes !== r.targetJsonlSegmentBytes ||
      policy.targetBinSegmentBytes !== r.targetBinSegmentBytes ||
      policy.targetRecordsPerSegment !== r.targetRecordsPerSegment
    ) {
      return { verdict: 'rotate', cause: 'frozen-policy-mismatch' }
    }

    // —— 3. 交叉扫描（segments 升序；逐行行长/parse/VFSL/canonical decimal/streamId/policy/
    //        storage 帧交叉 + 跨 segment expectedSequence 连续性状态机，reader §3.4 语义原样）——
    let entries: string[]
    try {
      entries = readdirSync(paths.segmentsDir)
    } catch {
      return { verdict: 'rotate', cause: 'manifest-invalid' } // 构造协议保证 segments/ 存在
    }
    const segmentSet = new Set<string>()
    for (const entry of entries) {
      let base = entry
      if (base.endsWith('.jsonl')) base = base.slice(0, -'.jsonl'.length)
      else if (base.endsWith('.bin')) base = base.slice(0, -'.bin'.length)
      if (isSegmentName(base)) segmentSet.add(base)
    }
    const segments = [...segmentSet].sort()
    const segMax = segments.length > 0 ? segments[segments.length - 1]! : '00000001'

    let corrupt = false
    let incompatible = false
    let lastCommittedSequence: string | null = null
    let expectedSequence: bigint | null = 1n
    const expectedOffsets = new Map<string, bigint>()
    const bins = new Map<string, Uint8Array | null>() // null = 缺失/不可读（已加载）
    const refsToSegMax: Array<{ off: number; end: number }> = []
    const segmentJsonlBytes = new Map<string, number>()
    const segmentBinBytes = new Map<string, number>()
    const segmentRecordCount = new Map<string, number>()
    const segmentUnterminated = new Set<string>()
    const segMaxJbuf: Uint8Array[] = [] // 恰好 0/1 元素（修复计算用）

    const checkSidecar = (
      carrier: UpdateCarrier & { storage: 'sidecar' },
      sequence: string,
    ): string | null => {
      // R-1 镜像复核（同 reader：frameOffset 先镜像后解析——不依赖 BigInt('') 行为分歧）
      if (!isCanonicalDecimal(carrier.frameOffset)) return 'vfsl-invalid'
      if (!segmentSet.has(carrier.segment)) return 'reference-invalid'
      let bytes = bins.get(carrier.segment)
      if (bytes === undefined) {
        const br = readSegmentBin(join(paths.segmentsDir, `${carrier.segment}.bin`))
        if (br === 'unreadable') {
          corrupt = true // §5.1 R1：引用帧不可读 → 引用帧不可证（与 reader frame-missing 同向）
          bytes = null
        } else {
          bytes = br === 'enoent' ? null : br.bytes
        }
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
      if (carrier.segment === segMax) {
        refsToSegMax.push({
          off: Number(BigInt(carrier.frameOffset)),
          end: Number(check.nextExpectedOffset),
        })
      }
      return null
    }

    for (const segment of segments) {
      const isMax = segment === segMax
      // —— 该 segment jsonl 三分支 ——
      const jr = readSegmentJsonl(join(paths.segmentsDir, `${segment}.jsonl`))
      if (jr === 'unreadable') {
        corrupt = true // 不可读 ≠ 缺失：与 reader invalid-json 同向；绝不按空文件续写
        segmentJsonlBytes.set(segment, 0)
        segmentRecordCount.set(segment, 0)
        continue
      }
      const jbuf = jr === 'enoent' ? null : jr.bytes
      if (isMax) segMaxJbuf[0] = jbuf ?? new Uint8Array(0)
      const jsonlBytes = jbuf === null ? 0 : jbuf.byteLength
      const unterminated = jbuf !== null && jbuf.byteLength > 0 && jbuf[jbuf.byteLength - 1] !== 0x0a
      const rawLines = jbuf === null ? [] : splitRawLines(jbuf)
      segmentJsonlBytes.set(segment, jsonlBytes)
      segmentRecordCount.set(segment, unterminated ? rawLines.length - 1 : rawLines.length)
      if (unterminated && !isMax) corrupt = true // 后缀性质：中间段未终止末块 = 中间损坏
      if (unterminated) segmentUnterminated.add(segment)
      // —— 该 segment bin：SegMax 预读（§5.1 R1：不可读 → corrupt 无论有无引用）；非 SegMax 只统计 ——
      if (isMax) {
        const br = readSegmentBin(join(paths.segmentsDir, `${segment}.bin`))
        if (br === 'unreadable') {
          corrupt = true
          bins.set(segment, null)
          segmentBinBytes.set(segment, 0)
        } else {
          const b = br === 'enoent' ? null : br.bytes
          bins.set(segment, b)
          segmentBinBytes.set(segment, b === null ? 0 : b.byteLength)
        }
      } else {
        try {
          const st = statSync(join(paths.segmentsDir, `${segment}.bin`), { throwIfNoEntry: false })
          if (st === undefined) segmentBinBytes.set(segment, 0)
          else if (st.isFile()) segmentBinBytes.set(segment, st.size)
          else segmentBinBytes.set(segment, 0)
        } catch (err) {
          if ((err as NodeJS.ErrnoException | null)?.code === 'ENOENT') segmentBinBytes.set(segment, 0)
          else {
            corrupt = true // §5.1 R1：闭段 bin stat 失败（不可读）→ 同款 corrupt
            segmentBinBytes.set(segment, 0)
          }
        }
      }
      for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i]!
        // —— SegMax 末行未终止 = C1 可修复候选：跳过逐行校验（终止符证明与内容可 parse 无关）——
        if (unterminated && isMax && i === rawLines.length - 1) continue
        let recordIssue = false
        if (line.byteLength > policy.jsonlLineLimitBytes) recordIssue = true
        let parsed: unknown
        try {
          parsed = JSON.parse(line.text)
        } catch {
          corrupt = true
          expectedSequence = null
          continue
        }
        const sequence = sequenceStringOf(parsed)
        const vfsl = validateLogicalSnapshot(compiled.derived, parsed)
        const sequenceShaped = isCanonicalDecimal(sequence)
        if (!vfsl.ok || !sequenceShaped) {
          corrupt = true
          expectedSequence = null
          continue
        }
        const parsedStreamId = (parsed as { streamId: unknown }).streamId
        if (parsedStreamId !== req.streamId) {
          corrupt = true
          expectedSequence = null
          continue
        }
        const kind = (parsed as { recordKind: unknown }).recordKind
        const carrier = carrierFromParsed(parsed)
        if (!policy.committedUpdateCapture && carrier !== null && kind !== 'genesis-baseline') recordIssue = true
        if (kind === 'attempt') {
          const input = (parsed as { input: unknown }).input
          if (inputPolicyViolation(input, policy.inputCapturePolicy)) recordIssue = true
        }
        if (carrier !== null) {
          const storageIssue =
            carrier.storage === 'inline' ? validateInlineCarrier(carrier) : checkSidecar(carrier, sequence)
          if (storageIssue !== null) {
            if (INCOMPATIBLE_SET.has(storageIssue)) incompatible = true
            else corrupt = true
          } else if (carrier.storage === 'inline') {
            if (carrier.payloadLength > policy.inlineUpdateMaxBytes) recordIssue = true
          } else if (carrier.payloadLength <= policy.inlineUpdateMaxBytes) {
            recordIssue = true
          }
        }
        const actual = BigInt(sequence)
        if (expectedSequence === null) {
          expectedSequence = actual + 1n
        } else if (actual < expectedSequence) {
          corrupt = true
        } else if (actual > expectedSequence) {
          corrupt = true
          expectedSequence = actual + 1n
        } else {
          expectedSequence = actual + 1n
        }
        lastCommittedSequence = sequence
        if (recordIssue) corrupt = true
      }
    }

    // —— §9.3 闭段 roll-target 核查（reader 同款；最大段不核查）——
    if (segments.length > 0) {
      for (const segment of segments) {
        if (segment === segMax) continue
        const jb = segmentJsonlBytes.get(segment) ?? 0
        const bb = segmentBinBytes.get(segment) ?? 0
        const rc = segmentRecordCount.get(segment) ?? 0
        if (jb < r.targetJsonlSegmentBytes && bb < r.targetBinSegmentBytes && rc < r.targetRecordsPerSegment) {
          corrupt = true
        }
      }
    }

    if (incompatible) return { verdict: 'rotate', cause: 'stream-incompatible' }
    if (corrupt) return { verdict: 'rotate', cause: 'stream-corrupt' }

    // —— 5. 修复计算（§5.1 三类；仅最大有文件 segment）+ 修复后计数 ——
    const repairs: ResumeRepair[] = []
    const jbufMax = segMaxJbuf[0] ?? null
    let finalJsonlBytes = jbufMax === null ? 0 : jbufMax.byteLength
    let finalBinBytes = segmentBinBytes.get(segMax) ?? 0
    let finalRecords = 0
    // C1
    if (jbufMax !== null && segmentUnterminated.has(segMax)) {
      let lastNl = -1
      for (let i = jbufMax.byteLength - 1; i >= 0; i--) {
        if (jbufMax[i] === 0x0a) {
          lastNl = i
          break
        }
      }
      const truncateToBytes = lastNl === -1 ? 0 : lastNl + 1
      repairs.push({
        kind: 'jsonl-incomplete-line',
        segment: segMax,
        truncateToBytes,
        truncatedBytes: jbufMax.byteLength - truncateToBytes,
      })
      finalJsonlBytes = truncateToBytes
    }
    // C2/C3
    {
      let t = 0
      for (const ref of refsToSegMax) if (ref.end > t) t = ref.end
      const bin = bins.get(segMax) ?? null
      if (bin !== null && bin.byteLength > t) {
        if (refsToSegMax.length === 0) {
          // §13.11 契约面：无引用 → 截断点取从 0 起的完整帧前缀边界（未引用完整帧保留）
          t = walkCompletePrefixEnd(bin)
        }
        const walk = walkBinTail(bin, t)
        if (walk === 'unknown-magic') return { verdict: 'rotate', cause: 'stream-corrupt' }
        if (walk === 'unknown-frame') return { verdict: 'rotate', cause: 'stream-incompatible' }
        repairs.push(
          walk === 'incomplete'
            ? { kind: 'bin-incomplete-frame', segment: segMax, truncateToBytes: t, truncatedBytes: bin.byteLength - t }
            : { kind: 'bin-orphan-frames', segment: segMax, truncateToBytes: t, truncatedBytes: bin.byteLength - t },
        )
        finalBinBytes = t
      }
    }
    // 修复后 segRecords = 修复后 JSONL 的 0x0A 计数（§6.3）
    const countLimit = finalJsonlBytes
    if (jbufMax !== null) {
      for (let i = 0; i < countLimit; i++) {
        if (jbufMax[i] === 0x0a) finalRecords += 1
      }
    }
    // —— §7 exhaustedAtOpen ——
    let exhaustedAtOpen: 'sequence' | 'segment' | null = null
    if (lastCommittedSequence === UINT64_MAX) {
      exhaustedAtOpen = 'sequence'
    } else if (
      segMax === '99999999' &&
      (finalJsonlBytes >= r.targetJsonlSegmentBytes ||
        finalBinBytes >= r.targetBinSegmentBytes ||
        finalRecords >= r.targetRecordsPerSegment)
    ) {
      exhaustedAtOpen = 'segment'
    }

    return {
      verdict: 'resume',
      repairs,
      resume: {
        lastCommittedSequence,
        currentSegment: segMax,
        jsonlBytes: finalJsonlBytes,
        binBytes: finalBinBytes,
        records: finalRecords,
        exhaustedAtOpen,
      },
    }
  } catch {
    // 分析函数自身不抛（构造级 crash 包络在调用方，此处按 manifest-invalid 收敛）
    return { verdict: 'rotate', cause: 'manifest-invalid' }
  }
}
