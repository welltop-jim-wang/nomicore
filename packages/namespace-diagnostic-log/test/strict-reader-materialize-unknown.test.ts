/**
 * 红灯契约 — Issue #227（SA6 编写）：materialize 必要 update 分类收窄（AC3/AC4）。
 *
 * 权威契约：`wiki/raw/task_issue-227_design.md`（R1.1）§4.1/§4.2（必要性由
 * kind/committed/effect 先定；`fatal ∧ committed:true ∧ effect ∉ {'update',
 * 'update-omitted'}`——含 effect 字段缺席（schema.ts:178 第 5 成员）——→ `unknown`；
 * `none` 域收窄为 committed-noop/rejected/fatal-committed:false）/ §8.3（C1–C4 矩阵）。
 *
 * 红灯性（HEAD = 本文件编写时点）：
 * - C1/C4 [红灯]：`materializeStrictRecordUpdate` 对 fatal-committed-true 的
 *   unknown/effect-缺席形状落兜底 `{kind:'none'}`（reader.ts:817）——断言
 *   `{kind:'unknown'}` 必红；SA3 加第五成员后翻转。
 * - C2/C3 [绿灯 pin]：none 收窄的推进面（noop/rejected/fatal-committed:false）与
 *   update/omitted 回归面——HEAD 已绿，SA3 不得回退。
 * - `kind` 判别以原始形状字符串比较（src 类型面尚未加 `unknown` 成员——沿用
 *   helpers 的 eventsOfTypeRaw 同款冻结期判别法）；其余断言全为运行时产物，
 *   零源码文本断言、零测试抑制。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import {
  materializeStrictRecordUpdate,
  readStreamStrict,
  type StrictRecordRead,
  type StrictRecordUpdate,
  type StrictStreamRead,
} from '../src/index.js'
import type { FileDiagnosticLogConfig } from '../src/index.js'
import { baseEmission } from './helpers/base.js'
import { makeFileLog, makeTempRoot, patternedBytes, rmTempRoot } from './helpers/file.js'
import type { AssembledFileLog } from './helpers/file.js'

const tempRoots: string[] = []

function freshRoot(): string {
  const root = makeTempRoot()
  tempRoots.push(root)
  return root
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmTempRoot(root)
})

const T0 = Date.parse('2026-08-28T12:00:00.000Z')

/** 单段无 genesis 流（inline 8B 阈值；emitter 合法路径逐形状落盘）。 */
function buildSingleSegment(root: string, ns: string, emissions: Array<Record<string, unknown>>): AssembledFileLog {
  const log = makeFileLog({
    rootDir: root,
    namespaceId: ns,
    updateCapture: true,
    inlineUpdateMaxBytes: 8,
    clock: { now: () => T0 },
    retention: { maxAgeMs: null, maxBytesPerNamespace: null, sweepOnOpen: false },
  } as unknown as Partial<FileDiagnosticLogConfig>)
  for (const result of emissions) {
    log.log.emitter.emit(baseEmission({ result }))
  }
  return log
}

function entryOf(read: StrictStreamRead, sequence: string): StrictRecordRead {
  const entry = read.records.find((r) => r.sequence === sequence)
  expect(entry, `entry ${sequence} 应在读结果中`).toBeDefined()
  return entry as StrictRecordRead
}

/** kind 判别（原始形状——StrictRecordUpdate 尚未含 'unknown' 成员时的冻结期判别）。 */
function kindOf(m: StrictRecordUpdate): string {
  return (m as { kind: string }).kind
}

/** 以盘面末行作信封模板手拼一行（F-1/C4 同法：emitter 不可达形状的盘面可达构造）。 */
function appendHandLine(jsonlPath: string, templateOf: unknown, overrides: Record<string, unknown>): void {
  const lines = readFileSync(jsonlPath, 'utf8').split('\n').filter((l) => l.length > 0)
  const tpl = (templateOf ?? JSON.parse(lines[lines.length - 1] as string)) as Record<string, unknown>
  writeFileSync(jsonlPath, [...lines, JSON.stringify({ ...tpl, ...overrides })].join('\n') + '\n')
}

function jsonlPathOf(root: string, ns: string, streamId: string): string {
  return `${root}/namespaces/${ns}/streams/${streamId}/segments/00000001.jsonl`
}

const FATAL_UNKNOWN = { kind: 'fatal', committed: true, effect: 'unknown' }
const UPDATE = (payload: Uint8Array) => ({ kind: 'committed', effect: 'update', updateBytes: payload })
const NOOP = { kind: 'committed', effect: 'noop' }
const REJECTED = { kind: 'rejected' }
const FATAL_COMMITTED_FALSE = { kind: 'fatal', committed: false }
const OMITTED = { kind: 'committed', effect: 'update-omitted', reason: 'payload-too-large' }

// ============================================================================
// C1 — unknown 分类（AC3：fatal-committed-unknown 不再与 noop/rejected 同归 none）
// ============================================================================
describe('C1 unknown 分类（AC3：emitter 合法产出的 fatal-committed-unknown 落 unknown）', () => {
  it('C1 [红灯] fatal/committed:true/effect:unknown → materialize {kind:"unknown"}', () => {
    const root = freshRoot()
    const ns = 'ns-227-c1'
    const payload = patternedBytes(8)
    const a = buildSingleSegment(root, ns, [UPDATE(payload), FATAL_UNKNOWN, UPDATE(payload)])
    const read = readStreamStrict({ rootDir: root, namespaceId: ns, streamId: a.log.streamId })
    expect(read.records).toHaveLength(3)
    const m = materializeStrictRecordUpdate({ rootDir: root, namespaceId: ns, streamId: a.log.streamId }, entryOf(read, '2'))
    // 红：HEAD 落 {kind:'none'}（不可证必要性被当作可证无更新）；修后 → unknown
    expect(kindOf(m)).toBe('unknown')
  })
})

// ============================================================================
// C2 — none 收窄（可证无更新三形状仍落 none——推进面保真）
// ============================================================================
describe('C2 none 收窄（AC4：committed-noop / rejected / fatal-committed:false 恒 none）', () => {
  it('C2 [绿灯] noop / rejected / fatal-committed:false 逐形状 pin {kind:"none"}', () => {
    const root = freshRoot()
    const ns = 'ns-227-c2'
    const payload = patternedBytes(8)
    const a = buildSingleSegment(root, ns, [UPDATE(payload), NOOP, REJECTED, FATAL_COMMITTED_FALSE])
    const read = readStreamStrict({ rootDir: root, namespaceId: ns, streamId: a.log.streamId })
    const request = { rootDir: root, namespaceId: ns, streamId: a.log.streamId }
    expect(kindOf(materializeStrictRecordUpdate(request, entryOf(read, '2')))).toBe('none') // committed/noop
    expect(kindOf(materializeStrictRecordUpdate(request, entryOf(read, '3')))).toBe('none') // rejected
    expect(kindOf(materializeStrictRecordUpdate(request, entryOf(read, '4')))).toBe('none') // fatal committed:false
  })
})

// ============================================================================
// C3 — update / omitted 回归（既有通道 pin 保留）
// ============================================================================
describe('C3 回归（AC4：committed-update / update-omitted 分类不变）', () => {
  it('C3 [绿灯] committed-update → {kind:"update"}（bytes 可解码）；update-omitted → {kind:"omitted", reason 原样}', () => {
    const root = freshRoot()
    const ns = 'ns-227-c3'
    const payload = patternedBytes(8)
    const a = buildSingleSegment(root, ns, [UPDATE(payload), OMITTED, UPDATE(payload)])
    const read = readStreamStrict({ rootDir: root, namespaceId: ns, streamId: a.log.streamId })
    const request = { rootDir: root, namespaceId: ns, streamId: a.log.streamId }
    const m1 = materializeStrictRecordUpdate(request, entryOf(read, '1'))
    expect(kindOf(m1)).toBe('update')
    if (m1.kind === 'update') expect(m1.bytes.byteLength).toBe(payload.byteLength)
    const m2 = materializeStrictRecordUpdate(request, entryOf(read, '2'))
    expect(kindOf(m2)).toBe('omitted')
    if (m2.kind === 'omitted') expect(m2.reason).toBe('payload-too-large')
  })
})

// ============================================================================
// C4 — effect 缺席形状（R1.1-F1：schema.ts:178 第 5 成员；对照 committed:false 推进面）
// ============================================================================
describe('C4 effect 缺席分类（AC3/AC4：fatal ∧ committed:true ∧ effect 字段缺席 → unknown）', () => {
  it('C4 [红灯] 手拼 fatal/committed:true（无 effect 字段）→ materialize {kind:"unknown"}；对照 fatal/committed:false → none', () => {
    const root = freshRoot()
    const ns = 'ns-227-c4'
    const payload = patternedBytes(8)
    const a = buildSingleSegment(root, ns, [UPDATE(payload), UPDATE(payload), UPDATE(payload)])
    const jsonl = jsonlPathOf(root, ns, a.log.streamId)
    const lines = readFileSync(jsonl, 'utf8').split('\n').filter((l) => l.length > 0)
    const tpl = JSON.parse(lines[lines.length - 1] as string) as Record<string, unknown>
    // l4：schema 第 5 成员（{kind:'fatal', committed:boolean} 无 effect——VFSL 合法、emitter 不可达、盘面可达）
    appendHandLine(jsonl, tpl, { sequence: '4', attemptId: 'att-' + 'f1'.padEnd(32, '0'), result: { kind: 'fatal', committed: true } })
    // l5：R-4 残差对照（committed:false 无 effect——维持 none 推进面，G-227-2 裁定）
    appendHandLine(jsonl, tpl, { sequence: '5', attemptId: 'att-' + 'r4'.padEnd(32, '0'), result: { kind: 'fatal', committed: false } })

    const read = readStreamStrict({ rootDir: root, namespaceId: ns, streamId: a.log.streamId })
    const request = { rootDir: root, namespaceId: ns, streamId: a.log.streamId }
    // 两形状 VFSL 合法（strict 读 ok）——自证夹具
    expect(entryOf(read, '4').ok).toBe(true)
    expect(entryOf(read, '5').ok).toBe(true)
    const m4 = materializeStrictRecordUpdate(request, entryOf(read, '4'))
    const m5 = materializeStrictRecordUpdate(request, entryOf(read, '5'))
    // 红：HEAD m4 落 none（F-1 洞）；修后 → unknown。对照 m5 恒 none（保真面不可误伤）
    expect(kindOf(m4)).toBe('unknown')
    expect(kindOf(m5)).toBe('none')
  })
})
