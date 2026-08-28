/**
 * 路径安全文法 + 布局路径派生（设计 §2.6；writer/reader 共享；纯 TS、零环境绑定）。
 *
 * 权限：namespaceId 违规 → 日志不启用（`stream-init-failed/invalid-namespace-id`）、
 * 零 fs 触达——**不编码、不 hash、不替换字符静默另存**（ADR 0012 明文）。
 * namespaceId 判定逻辑与 `packages/namespace-registry/src/identity.ts:70
 * isMinimalSafeString` 同纪律（本包不依赖 registry——ADR/AGENTS 边界）。
 *
 * streamId/segment 文法复用 `schema-patterns.ts` 冻结常量（J12 单源纪律）——TS
 * 校验与 VFSL Pattern 永不漂移。
 */
import { join } from 'node:path'
import { P_SEGMENT, P_STREAM_ID } from './schema-patterns.js'

const RE_STREAM_ID = new RegExp(P_STREAM_ID)
const RE_SEGMENT = new RegExp(P_SEGMENT)

/**
 * namespaceId 安全文法：非空串 ∧ ≠ `.`/`..` ∧ 无 C0/C1 控制字符（U+0000–001F、
 * U+007F–009F）∧ 无 `/` `\`。
 */
export function isSafeNamespaceId(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value.length === 0) return false
  if (value === '.' || value === '..') return false
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return false
    if (value[i] === '/' || value[i] === '\\') return false
  }
  return true
}

/** streamId：`log-` + 32 位小写 hex（ADR 0012 §Stream 与 generation；P_STREAM_ID 单源）。 */
export function isSafeStreamId(value: unknown): value is string {
  return typeof value === 'string' && RE_STREAM_ID.test(value)
}

/** segment 名：固定 8 位十进制（P_SEGMENT 单源；`00000000` 保留不用）。 */
export function isSegmentName(value: string): boolean {
  return RE_SEGMENT.test(value)
}

/** ADR 0012 §File adapter 布局的路径派生（与 `test/helpers/file.ts:streamPaths` 同构）。 */
export function streamLayoutPaths(rootDir: string, namespaceId: string, streamId: string) {
  const namespaceDir = join(rootDir, 'namespaces', namespaceId)
  const streamsDir = join(namespaceDir, 'streams')
  const streamDir = join(streamsDir, streamId)
  const segmentsDir = join(streamDir, 'segments')
  return {
    namespaceDir,
    currentPath: join(namespaceDir, 'current.json'),
    streamsDir,
    streamDir,
    manifestPath: join(streamDir, 'manifest.json'),
    segmentsDir,
    jsonlPath: join(segmentsDir, '00000001.jsonl'),
    binPath: join(segmentsDir, '00000001.bin'),
  }
}
