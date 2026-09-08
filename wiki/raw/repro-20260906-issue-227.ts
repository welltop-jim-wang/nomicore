/**
 * 故障复现脚本 — Issue #227（SA1 故障分析轮，2026-09-06）。
 *
 * 目的：在工作树 HEAD（ac91a6b，mabf/issue-227）上以**纯运行时行为**复现
 * #227 设计（wiki/raw/task_issue-227_design.md R1.1 §0.1）所定位的缺口：
 *
 *   - Leg A（G3/G4，AC3 违约）：emitter 合法产出的 `fatal / committed:true /
 *     effect:'unknown'` 记录被 replay 按「无更新连续记录」推进 → 整链 complete，
 *     且快照静默丢失该次已提交变更（生产 doc 的 flag 变更在 replay 终态中缺席）。
 *   - Leg B（F-1/G4，AC3/AC4 违约）：手工 JSONL 行 `fatal / committed:true`（effect
 *     字段缺席——schema.ts:178 第 5 成员，VFSL 合法、emitter 不可达）→ strict 读
 *     entry.ok===true → materialize 落 'none' → replay 推进 → complete 可达。
 *     对照组 1：`fatal / committed:false`（R-4 残差，设计裁定维持 none 推进）。
 *     对照组 2（K-2/N-A 红基线）：`fatal / committed:false / effect:'update-omitted'`
 *     手拼形状今日同样被推进至 complete（修复后应翻转为 partial + update-omitted）。
 *   - Leg C（G5 防御面现状）：`committed / effect:'update'` + 畸形 update 字段
 *     → 今日经 entry.ok=false（vfsl-invalid）fail-closed——设计 G5 属加固次序，
 *     非现行洞（记录事实供 SA6 对照）。
 *   - Leg D（G1/G2，AC2 违约）：活跃 read-session 租约覆盖的 closed segment，
 *     sweep P0 卫生遍历的 orphan-BIN 清理**不看租约**直接删除其 .bin
 *     （file.ts:1134–1151 无 segmentLeased 调用）；随后 strict 读把「租约窗内
 *     数据消失」报告为普通 history-trimmed（ok），零归因信号。
 *
 * 运行方式（工作树根目录）：
 *   NODE_OPTIONS=--conditions=nomicore-source ./node_modules/.bin/tsx \
 *     wiki/raw/repro-20260906-issue-227.ts
 *
 * 退出码：0 = 全部「预期故障行为」逐项复现（故障存在性证明成立）；
 *         2 = 任一检查与预期不符（故障不可复现或已被修复——须人工复核）。
 * 本脚本零生产代码改动：只调用公共 API + 直接读写临时目录中的日志文件。
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as Y from '../../apps/yjs-server/node_modules/yjs/dist/yjs.mjs'
import {
  createFileDiagnosticLog,
  materializeStrictRecordUpdate,
  openDiagnosticReadSession,
  readStreamStrict,
  type NamespaceDiagnosticChangeEmission,
  type StrictRecordRead,
} from '../../packages/namespace-diagnostic-log/src/index.js'
import { replayNamespaceDiagnosticLog } from '../../apps/yjs-server/src/diagnostic-replay.js'

const NOW = 1_700_000_000_000

// ── 小工具 ───────────────────────────────────────────────────────────────────

const tempRoots: string[] = []
function freshRoot(tag: string): string {
  const root = mkdtempSync(join(tmpdir(), `issue227-${tag}-`))
  tempRoots.push(root)
  return root
}

let attemptCounter = 0
function emissionFor(
  result: NamespaceDiagnosticChangeEmission['result'],
  operation: NamespaceDiagnosticChangeEmission['operation'] = 'root-mutation',
): NamespaceDiagnosticChangeEmission {
  attemptCounter += 1
  const hex = attemptCounter.toString(16).padStart(32, '0').slice(0, 32)
  return {
    operation,
    stage: 'transaction',
    observedAt: new Date(NOW).toISOString(),
    attemptId: `att-${hex}`,
    source: { kind: 'local' },
    result,
  }
}

function makeProdDoc(namespaceId: string, count: number): Y.Doc {
  const doc = new Y.Doc()
  doc.getMap('META').set('docId', namespaceId)
  doc.getMap('ROOT').set('count', count)
  return doc
}

function rootValueOf(doc: Y.Doc, key: string): unknown {
  return doc.getMap('ROOT').get(key)
}

/** 检查登记：PASS = 预期故障行为被复现；FAIL = 与预期不符（复现失败）。 */
const results: Array<{ name: string; pass: boolean; detail: string }> = []
function check(name: string, pass: boolean, detail: string): void {
  results.push({ name, pass, detail })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} — ${detail}`)
}
function info(name: string, detail: string): void {
  console.log(`  [INFO] ${name} — ${detail}`)
}
function section(title: string): void {
  console.log(`\n=== ${title} ===`)
}

function entryOf(read: { records: StrictRecordRead[] }, sequence: string): StrictRecordRead | undefined {
  return read.records.find((r) => r.sequence === sequence)
}

function resultShapeOf(entry: StrictRecordRead | undefined): string {
  if (entry === undefined || entry.record === null) return '<none>'
  const result = (entry.record as { result?: unknown }).result
  return JSON.stringify(result)
}

function jsonlPathOf(rootDir: string, namespaceId: string, streamId: string): string {
  return join(rootDir, 'namespaces', namespaceId, 'streams', streamId, 'segments', '00000001.jsonl')
}

// ── 夹具：genesis + update(seq2) + [缺捕获变更] + update(seq4) 的 4 记录健康链 ──
/** seq3 的「已提交但效应不明」变更（flag=true）只进生产 doc，其 update 字节任何地方都不存在。
 *  seq4 的 delta 额外携带独立标记键 tail='end'（用于字节级判定该 delta 是否进入 replay 快照）。 */
function buildHealthyChainWithFatalUnknown(rootDir: string, ns: string) {
  const prod = makeProdDoc(ns, 1)
  const log = createFileDiagnosticLog({
    rootDir,
    namespaceId: ns,
    updateCapture: true,
    genesisUpdateBytes: Y.encodeStateAsUpdate(prod),
    clock: { now: () => NOW },
    retention: { maxAgeMs: null, maxBytesPerNamespace: null, sweepOnOpen: false },
  })
  let sv = Y.encodeStateVector(prod)
  prod.getMap('ROOT').set('count', 5)
  log.emitter.emit(
    emissionFor({ kind: 'committed', effect: 'update', updateBytes: Y.encodeStateAsUpdate(prod, sv) }),
  )
  sv = Y.encodeStateVector(prod)
  prod.getMap('ROOT').set('flag', true) // ← 该已提交变更的 bytes 永不落入日志（capture 丢失）
  log.emitter.emit(emissionFor({ kind: 'fatal', committed: true, effect: 'unknown' }))
  sv = Y.encodeStateVector(prod)
  prod.getMap('ROOT').set('count', 9)
  prod.getMap('ROOT').set('tail', 'end')
  log.emitter.emit(
    emissionFor({ kind: 'committed', effect: 'update', updateBytes: Y.encodeStateAsUpdate(prod, sv) }),
  )
  return { log, prod }
}

/** 逐条 materialize 盘面记录，收集 update bytes 与分类序列（字节级证据收集——不做跨模块实例的 Y.Doc 解码）。 */
function scanUpdateBytes(rootDir: string, ns: string, streamId: string): { bytesList: Uint8Array[]; kinds: string[] } {
  const read = readStreamStrict({ rootDir, namespaceId: ns, streamId })
  const bytesList: Uint8Array[] = []
  const kinds: string[] = []
  for (const entry of read.records) {
    const m = materializeStrictRecordUpdate({ rootDir, namespaceId: ns, streamId }, entry)
    kinds.push(`${entry.sequence}:${m.kind}`)
    if (m.kind === 'update') bytesList.push(m.bytes)
  }
  return { bytesList, kinds }
}

// ── Leg A：G3/G4 — fatal-committed-unknown 推进至 complete + 静默丢变更 ────────

function legA(): void {
  section('Leg A (G3/G4, AC3): emitter 产出 fatal/committed:true/effect:unknown → replay complete + 快照静默丢失已提交变更')
  const rootDir = freshRoot('a')
  const ns = 'ns227-leg-a'
  const { prod } = buildHealthyChainWithFatalUnknown(rootDir, ns)

  const read = readStreamStrict({ rootDir, namespaceId: ns, streamId: streamIdOf(rootDir, ns) })
  check('A1 strict 读 4 条记录全 ok', read.status === 'ok' && read.records.length === 4 && read.records.every((r) => r.ok),
    `status=${read.status}, records=${read.records.length}, okCount=${read.records.filter((r) => r.ok).length}`)
  const entry3 = entryOf(read, '3')
  info('A2 seq3 落盘形状（emitter 合法路径产出）', resultShapeOf(entry3))
  const m3 = materializeStrictRecordUpdate({ rootDir, namespaceId: ns, streamId: streamIdOf(rootDir, ns) }, entry3!)
  check('A3 materialize(seq3 fatal-unknown) 落 none（G4：不可证必要性被当作可证无更新）', m3.kind === 'none',
    `materialize=${JSON.stringify(m3)}`)

  const replay = replayNamespaceDiagnosticLog({ rootDir, namespaceId: ns })
  check('A4 replay 报 complete（G3：不可证记录被推进，五条件门被穿透）',
    replay.status === 'complete' && replay.issues.length === 0,
    `status=${replay.status}, issues=${JSON.stringify(replay.issues)}`)
  check('A5 lastAppliedSequence 计入 fatal-unknown 记录（推进至 4）', replay.lastAppliedSequence === '4',
    `lastAppliedSequence=${replay.lastAppliedSequence}`)

  // A6 分歧证明（实例无关；tsx 下 yjs 双模块实例会静默破坏跨实例 Y.Doc 解码，
  //  故一切验证落在字节标记与 replay 自身的结构化报告上——vitest 单实例下 SA6 可用
  //  SA7 同款 Y.Doc 解码断言，与本证据等价）：
  //  - 基准 1（生产真相）：prod.flag=true（本脚本实例内存态）
  //  - 基准 2（日志链诚实内容）：全部 materialize update bytes 中 flag 标记缺席、tail 标记在场
  //  - replay 在 complete 声明下给出的 snapshot：含 tail、不含 flag
  const streamId = streamIdOf(rootDir, ns)
  const { bytesList, kinds } = scanUpdateBytes(rootDir, ns, streamId)
  const logText = bytesList.map((b) => Buffer.from(b).toString('latin1')).join('\n')
  check('A6a 日志链不存在 flag 变更的字节（已提交变更无处可重建）而 tail 变更在场',
    rootValueOf(prod, 'flag') === true && !logText.includes('flag') && logText.includes('tail'),
    `prod.flag=${JSON.stringify(rootValueOf(prod, 'flag'))}, materialize=[${kinds.join(', ')}], logHasFlag=${logText.includes('flag')}, logHasTail=${logText.includes('tail')}`)
  const snapText = Buffer.from(replay.snapshot as Uint8Array).toString('latin1')
  check('A6b replay 快照含 tail 标记（seq4 delta 已进入）且不含 flag 标记（已提交变更静默丢失，complete 的保真声明为假）',
    snapText.includes('tail') && !snapText.includes('flag'),
    `snapshotBytes=${(replay.snapshot as Uint8Array).byteLength}, hasTail=${snapText.includes('tail')}, hasFlag=${snapText.includes('flag')}`)
}

// ── Leg B：F-1 — 手拼 fatal/committed:true（effect 字段缺席）行 → complete 可达 ──

function legB(): void {
  section('Leg B (F-1/G4, AC3/AC4): 手拼 JSONL 行 fatal/committed:true（无 effect 字段，schema.ts:178 第 5 成员）→ strict ok → none → complete')
  const rootDir = freshRoot('b')
  const ns = 'ns227-leg-b'
  buildHealthyChainWithFatalUnknown(rootDir, ns)
  const streamId = streamIdOf(rootDir, ns)
  const jsonl = jsonlPathOf(rootDir, ns, streamId)

  const control = replayNamespaceDiagnosticLog({ rootDir, namespaceId: ns })
  info('B0 对照（手拼前）', `status=${control.status}, lastSeq=${control.lastAppliedSequence}, issues=${control.issues.length}`)

  // 以既有合法 attempt 行为信封模板，构造 schema 第 5 成员（effect 缺席）与 R-4 残差两行
  const lines = readFileSync(jsonl, 'utf8').split('\n').filter((l) => l.length > 0)
  const template = JSON.parse(lines[lines.length - 1]!) as Record<string, unknown>
  const l5: Record<string, unknown> = {
    ...template,
    sequence: '5',
    attemptId: 'att-' + 'f1'.padEnd(32, '0'),
    result: { kind: 'fatal', committed: true }, // ← 无 effect 字段
  }
  const l6: Record<string, unknown> = {
    ...template,
    sequence: '6',
    attemptId: 'att-' + 'r4'.padEnd(32, '0'),
    result: { kind: 'fatal', committed: false }, // R-4 残差对照（设计裁定维持 none）
  }
  const l7: Record<string, unknown> = {
    ...template,
    sequence: '7',
    attemptId: 'att-' + 'na'.padEnd(32, '0'),
    result: { kind: 'fatal', committed: false, effect: 'update-omitted', reason: 'payload-too-large' }, // N-A 翻转形状（K-2）
  }
  writeFileSync(jsonl, [...lines, JSON.stringify(l5), JSON.stringify(l6), JSON.stringify(l7)].join('\n') + '\n')

  const read = readStreamStrict({ rootDir, namespaceId: ns, streamId })
  const entry5 = entryOf(read, '5')
  const entry6 = entryOf(read, '6')
  check('B1 strict 读接受 effect 缺席形状（entry.ok=true——VFSL 第 5 成员合法）',
    entry5 !== undefined && entry5.ok, `seq5.ok=${entry5?.ok}, shape=${resultShapeOf(entry5)}`)
  info('B2 对照（committed:false 无 effect，R-4 残差）', `seq6.ok=${entry6?.ok}, shape=${resultShapeOf(entry6)}`)

  const m5 = materializeStrictRecordUpdate({ rootDir, namespaceId: ns, streamId }, entry5!)
  const m6 = materializeStrictRecordUpdate({ rootDir, namespaceId: ns, streamId }, entry6!)
  check('B3 materialize(seq5 fatal-committed-true-无effect) 落 none（F-1 洞）', m5.kind === 'none', `materialize=${JSON.stringify(m5)}`)
  info('B4 对照 materialize(seq6 committed:false) 落 none（R-4 维持）', `materialize=${JSON.stringify(m6)}`)

  const replay = replayNamespaceDiagnosticLog({ rootDir, namespaceId: ns })
  check('B5 replay 对含「不可证必要性」记录的链报 complete 且零 issue（AC3/AC4 违约，盘面可达）',
    replay.status === 'complete' && replay.issues.length === 0,
    `status=${replay.status}, issues=${JSON.stringify(replay.issues)}`)
  check('B6 lastAppliedSequence 推进过 effect 缺席记录（至 7）', replay.lastAppliedSequence === '7',
    `lastAppliedSequence=${replay.lastAppliedSequence}`)
  check('B7 N-A 翻转形状（fatal/committed:false/effect:update-omitted，手拼）今日同样被推进（complete 可达）——K-2 红基线',
    replay.status === 'complete' && replay.issues.length === 0,
    `含 l7 形状的整链 status=${replay.status}, issues=${JSON.stringify(replay.issues)}, lastAppliedSequence=${replay.lastAppliedSequence}`)
}

// ── Leg C：G5 防御面现状 — 畸形必要 update 今日经 entry.ok=false fail-closed ──

function legC(): void {
  section('Leg C (G5 现状核对): committed/effect:update + 畸形 update 字段 → 今日已 fail-closed（entry.ok=false）')
  const rootDir = freshRoot('c')
  const ns = 'ns227-leg-c'
  buildHealthyChainWithFatalUnknown(rootDir, ns)
  const streamId = streamIdOf(rootDir, ns)
  const jsonl = jsonlPathOf(rootDir, ns, streamId)
  const lines = readFileSync(jsonl, 'utf8').split('\n').filter((l) => l.length > 0)
  const template = JSON.parse(lines[lines.length - 1]!) as Record<string, unknown>
  const l7: Record<string, unknown> = {
    ...template,
    sequence: '5',
    attemptId: 'att-' + 'g5'.padEnd(32, '0'),
    result: { kind: 'committed', effect: 'update', update: 42 }, // 畸形 carrier
  }
  writeFileSync(jsonl, [...lines, JSON.stringify(l7)].join('\n') + '\n')

  const read = readStreamStrict({ rootDir, namespaceId: ns, streamId })
  const entry5 = entryOf(read, '5')
  check('C1 畸形必要 update 今日经 VFSL 拒绝（entry.ok=false，record 级 vfsl-invalid）——G5 属次序加固而非现行洞',
    entry5 !== undefined && !entry5.ok && entry5.issues.some((i) => i.code === 'vfsl-invalid'),
    `ok=${entry5?.ok}, issues=${JSON.stringify(entry5?.issues.map((i) => i.code))}`)
  const replay = replayNamespaceDiagnosticLog({ rootDir, namespaceId: ns })
  check('C2 replay 停止于该记录（非 complete）', replay.status !== 'complete',
    `status=${replay.status}, issues=${JSON.stringify(replay.issues.map((i) => i.code))}`)
}

// ── Leg D：G1/G2 — 活跃租约下 P0 卫生遍历删除 orphan BIN + 读面零归因 ─────────

function buildSidecarStream(rootDir: string, ns: string) {
  const log = createFileDiagnosticLog({
    rootDir,
    namespaceId: ns,
    updateCapture: true,
    targetRecordsPerSegment: 1,
    inlineUpdateMaxBytes: 8, // 强制 sidecar：每段 jsonl + bin 成对
    clock: { now: () => NOW },
    retention: { maxAgeMs: null, maxBytesPerNamespace: null, sweepOnOpen: false },
  })
  const payload = new Uint8Array(64).fill(0xab)
  for (let i = 0; i < 3; i++) {
    log.emitter.emit(emissionFor({ kind: 'committed', effect: 'update', updateBytes: payload }))
  }
  return log
}

function legD(): void {
  section('Leg D (G1/G2, AC2): 活跃 read-session 租约下，sweep P0 卫生遍历删除 leased closed 组的 .bin（file.ts:1134–1151 无租约门）')
  const rootDir = freshRoot('d1')
  const ns = 'ns227-leg-d'
  const log = buildSidecarStream(rootDir, ns)
  const streamId = log.streamId
  const segDir = join(rootDir, 'namespaces', ns, 'streams', streamId, 'segments')
  info('D0 盘面', `segments=${JSON.stringify([...new Set(readdirSync(segDir).map((f) => f.slice(0, 8)))])}`)

  const session = openDiagnosticReadSession({
    rootDir,
    namespaceId: ns,
    streamId,
    ttlMs: 60_000,
    clock: { now: () => NOW },
  })
  check('D1 会话快照覆盖 00000001..00000003 且未过期', JSON.stringify(session.segments) === JSON.stringify(['00000001', '00000002', '00000003']) && !session.closed && session.leasedUntil > NOW,
    `segments=${JSON.stringify(session.segments)}, closed=${session.closed}, leasedUntil>${NOW}=${session.leasedUntil > NOW}`)

  // 前置盘面状态：closed 组 00000001 残留 bin-无-jsonl-无-marker（writer 滚动边界崩溃 / 此前半途删除可达）
  unlinkSync(join(segDir, '00000001.jsonl'))
  const binPath = join(segDir, '00000001.bin')

  const report = log.sweepRetention({ now: NOW + 1000 })
  check('D2 sweep 在活跃租约下仍删除该组 .bin（orphanBinsDeleted≥1——P0 卫生遍历不看租约，AC2 违约）',
    report.orphanBinsDeleted >= 1 && !existsSync(binPath),
    `orphanBinsDeleted=${report.orphanBinsDeleted}, binExists=${existsSync(binPath)}, leaseBlockedGroups=${report.leaseBlockedGroups}, deletedGroups=${report.deletedGroups}, failedSteps=${report.failedSteps}`)

  const read = readStreamStrict({ rootDir, namespaceId: ns, streamId })
  info('D3 租约窗内数据消失后的 strict 读返回（读面归因现状）',
    `status=${read.status}, issues=${JSON.stringify(read.issues.map((i) => i.code))}, records=${read.records.length}, historyTrimmed=${read.historyTrimmed}, earliestRetained=${JSON.stringify(read.earliestRetainedSequence)}`)

  session.close()

  // 对照组：不制造 orphan-BIN 残留时，同一 sweep 零删除（证明 D2 的删除确来自 P0 卫生路径）
  const root2 = freshRoot('d2')
  const log2 = buildSidecarStream(root2, ns)
  const session2 = openDiagnosticReadSession({
    rootDir: root2,
    namespaceId: ns,
    streamId: log2.streamId,
    ttlMs: 60_000,
    clock: { now: () => NOW },
  })
  const report2 = log2.sweepRetention({ now: NOW + 1000 })
  check('D4 对照：无 orphan-BIN 残留时同一 sweep 零删除（D2 删除确由 P0 卫生路径造成）',
    report2.orphanBinsDeleted === 0 && report2.deletedGroups === 0,
    `orphanBinsDeleted=${report2.orphanBinsDeleted}, deletedGroups=${report2.deletedGroups}, leaseBlockedGroups=${report2.leaseBlockedGroups}`)
  session2.close()

  // D5（INFO，SA6 A3 设计输入）：闭组只删 jsonl 留 bin（17 键 manifest、小 targets）时的读面现状——
  // BIN-first 豁免分支（reader.ts:569–571）给零行零 per-segment issue，唯一信号是归因错位的
  // manifest-roll-target-violation（§9.3 把「组内容消失」记成 writer 滚动违约）。
  const segDir2 = join(root2, 'namespaces', ns, 'streams', log2.streamId, 'segments')
  unlinkSync(join(segDir2, '00000001.jsonl'))
  const read5 = readStreamStrict({ rootDir: root2, namespaceId: ns, streamId: log2.streamId })
  info('D5 闭组 jsonl 消失（bin 留存）的 strict 读返回',
    `status=${read5.status}, issues=${JSON.stringify(read5.issues.map((i) => i.code))}, records=${read5.records.length}, historyTrimmed=${read5.historyTrimmed}`)
}

// ── locator 读取（与生产 replay 同源布局） ───────────────────────────────────

function streamIdOf(rootDir: string, ns: string): string {
  const locator = JSON.parse(
    readFileSync(join(rootDir, 'namespaces', ns, 'current.json'), 'utf8'),
  ) as { streamId: string }
  return locator.streamId
}

// ── 主流程 ───────────────────────────────────────────────────────────────────

let exitCode = 0
try {
  legA()
  legB()
  legC()
  legD()
} finally {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
}

const failed = results.filter((r) => !r.pass)
console.log(`\n=== 汇总 ===`)
console.log(`检查总数=${results.length}, 复现成功(PASS)=${results.length - failed.length}, 复现失败(FAIL)=${failed.length}`)
for (const f of failed) console.log(`  FAIL: ${f.name} — ${f.detail}`)
if (failed.length > 0) exitCode = 2
console.log(exitCode === 0 ? 'VERDICT: 全部预期故障行为已复现（issue #227 缺口在 HEAD ac91a6b 上运行时成立）' : 'VERDICT: 存在与预期不符的检查——故障复现不完整，须人工复核')
process.exit(exitCode)
