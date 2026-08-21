import * as fs from 'node:fs'
import * as path from 'node:path'
import * as Y from 'yjs'
import {
  DocDuplicateError,
  requireDocPersistence,
  resolvePersistenceSchedule,
  type DocHandle,
  type DocPersistence,
  type PersistenceTimer,
  type User,
} from '@nomicore/persistence'
import { ProbeTimeoutError, createDeterministicClock, settle, waitFor, type ProbeClock } from './clock.js'
import type { ProbeEvent, ProbeRunOptions, ProbeRunResult } from './events.js'
import { createDshPersistenceProfile, type DshPersistenceProfile } from './profile.js'
import { renderProbeRecord } from './record.js'

/** 结构化场景失败：reason 取自封闭词表（§6.2），永不携带 err.message / 绝对路径。 */
class ProbeFailure extends Error {
  constructor(readonly reason: string) {
    super(`probe failed: ${reason}`)
    this.name = 'ProbeFailure'
  }
}

/** file 通道真实等待上限（§11 风险表：超时 → file-settle-timeout，loud）。 */
const FILE_WAIT_MS = 5_000

const USER_A: User = Object.freeze({ userId: 'user-a' })
const USER_B: User = Object.freeze({ userId: 'user-b' })
const INJECTION_KEY = 'user-a\u0000doc-degraded'

/** ADR-0006 三条目内容布局：SCHEMA 信封 + META{docId} + ROOT 数据根。 */
function threeEntryDoc(docId: string): Y.Doc {
  const doc = new Y.Doc()
  doc.getMap('SCHEMA').set('lang', 'vfsl')
  doc.getMap('SCHEMA').set('version', 1)
  doc.getMap('SCHEMA').set('id', `${docId}@v1`)
  doc.getMap('SCHEMA').set('text', 'fixture schema')
  doc.getMap('META').set('docId', docId)
  doc.getMap('ROOT').set('title', 'untitled')
  return doc
}

function toProbeKey(owner: string, docId: string): string {
  return `${owner}\u0000${docId}`
}

function splitKey(key: string): { owner: string, docId: string } {
  const separator = key.indexOf('\u0000')
  if (separator < 0) throw new ProbeFailure('scenario-error:key-format')
  return { owner: key.slice(0, separator), docId: key.slice(separator + 1) }
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code
}

/**
 * yjs 运行时在 `Doc.destroy()` 时发出 'destroyed' 事件（dist yjs.mjs `emit('destroyed', …)`），
 * 但该版本的 DocEvents 类型未收录 → 通过交叉类型显式声明，行为不变。
 */
type DocWithEvictEvent = Y.Doc & {
  on(eventName: 'destroyed', listener: () => void): void
  off(eventName: 'destroyed', listener: () => void): void
}

/**
 * 探针入口（决策 A/B/C/D/H + §5 固定场景）：
 * 装配同一 profile → 经 Cordis 消费 `docPersistence`（identity 自检）→ 受控时钟下
 * 跑 S1 主链路 / S2 隔离 / S3 异常输入 / S4 降级 → 渲染确定性 record。
 */
export async function runPersistenceProbe(options: ProbeRunOptions): Promise<ProbeRunResult> {
  const schedule = resolvePersistenceSchedule(options.schedule)
  const failFirstFlushes = options.failFirstFlushes ?? 0
  const adapter = options.adapter
  const clock = resolveProbeClock(options.timer)
  const pendingCount = (clock as ProbeClock & { pending?: () => number }).pending
  if (adapter === 'file' && pendingCount === undefined) {
    throw new TypeError('runPersistenceProbe with adapter "file" requires the probe deterministic clock (do not pass a custom timer for the file channel)')
  }
  const rootDir = options.rootDir
  if (adapter === 'file' && rootDir === undefined) {
    throw new TypeError('adapter "file" requires a non-empty rootDir')
  }
  // file 通道专用：上方 guard 保证 adapter==='file' 时必非空（决策 B 外部观察需要计时器内省）。
  const filePendingCount = pendingCount ?? (() => {
    throw new ProbeFailure('clock-not-drivable')
  })

  const events: ProbeEvent[] = []
  const emit = (event: ProbeEvent): void => { events.push(event) }
  const now = (): number => clock.now()

  // 自持模型（决策 C）：generation 仅在 saveDoc resolve 后递增；refs 由探针记账；
  // 实例/句柄身份由固定发号序决定。
  const savedByKey = new Map<string, number>()
  const heldByKey = new Map<string, number>()
  const docInstances = new WeakMap<Y.Doc, string>()
  const destroyedListeners = new Map<Y.Doc, () => void>()
  let handleCounter = 0
  let instanceCounter = 0
  let flushFailuresLeft = failFirstFlushes
  let injectionDegraded = false

  const nextHandle = (): string => `h${(handleCounter += 1)}`
  const instanceId = (doc: Y.Doc): string => {
    let id = docInstances.get(doc)
    if (id === undefined) {
      id = `d${(instanceCounter += 1)}`
      docInstances.set(doc, id)
    }
    return id
  }

  // 观察通道（决策 B）：memory = 顶层 writeSnapshot 注入缝（同步纯观察，零存储）；
  // file = 提交态快照外部观察 + 真实等待（§6.2）。
  const writesPerKey = new Map<string, number>()
  const memoryIo = {
    writeSnapshot(key: string, _snapshot: Uint8Array): void {
      const writes = (writesPerKey.get(key) ?? 0) + 1
      writesPerKey.set(key, writes)
      if (writes === 1) return // create-commit：不是 flush，静默（决策 H）
      const { owner, docId } = splitKey(key)
      const generation = savedByKey.get(key) ?? 0 // 被拒的 saveDoc 从未进入计数（决策 C）
      if (key === INJECTION_KEY && flushFailuresLeft > 0) {
        flushFailuresLeft -= 1
        injectionDegraded = true
        emit({ type: 'flush', owner, docId, generation, ok: false, t: now() })
        emit({ type: 'degraded', owner, docId, t: now() })
        throw new Error('probe-injected flush failure')
      }
      emit({ type: 'flush', owner, docId, generation, ok: true, t: now() })
      if (key === INJECTION_KEY && injectionDegraded) {
        emit({ type: 'recovered', owner, docId, t: now() })
        injectionDegraded = false
      }
    },
  }

  const fileRoot = rootDir as string
  const blockedTmpPath = (owner: string, docId: string): string =>
    path.join(fileRoot, 'users', owner, `${docId}.snapshot.tmp`)
  const ensureBlocked = (owner: string, docId: string): void => {
    const tmp = blockedTmpPath(owner, docId)
    fs.rmSync(tmp, { recursive: true, force: true })
    fs.mkdirSync(tmp, { recursive: true })
  }
  const unblock = (owner: string, docId: string): void => {
    fs.rmSync(blockedTmpPath(owner, docId), { recursive: true, force: true })
  }
  const readSnapshot = (owner: string, docId: string): Uint8Array | undefined => {
    try {
      return fs.readFileSync(path.join(fileRoot, 'users', owner, `${docId}.snapshot`))
    } catch (error) {
      if (isErrno(error, 'ENOENT')) return undefined
      console.error(`[dsh-persistence-probe] snapshot read failed for ${owner}/${docId}:`, error)
      throw new ProbeFailure(`io-read-error:${docId}`)
    }
  }
  const readSnapshotRev = (owner: string, docId: string): unknown => {
    const bytes = readSnapshot(owner, docId)
    if (bytes === undefined) return undefined
    try {
      const scratch = new Y.Doc()
      Y.applyUpdate(scratch, bytes)
      return scratch.getMap('ROOT').get('rev')
    } catch (error) {
      console.error(`[dsh-persistence-probe] snapshot decode failed for ${owner}/${docId}:`, error)
      throw new ProbeFailure(`io-read-error:${docId}`)
    }
  }

  let profile: DshPersistenceProfile | undefined
  let currentStep = 'setup'
  let ok = false
  let failureReason: string | undefined

  try {
    profile = createDshPersistenceProfile({
      adapter,
      ...(rootDir !== undefined ? { rootDir } : {}),
      ...(options.schedule !== undefined ? { schedule: options.schedule } : {}),
      timer: clock,
      ...(adapter === 'memory' ? { memoryIo } : {}),
    })
    const svc = requireDocPersistence(profile.ctx)
    // 决策 A 自检：探针全部调用经 Cordis 消费的同一 service 实例。
    if (svc !== profile.persistence) throw new ProbeFailure('service-identity')

    const step = async (name: string, fn: () => Promise<void>): Promise<void> => {
      currentStep = name
      try {
        await fn()
      } catch (error) {
        if (error instanceof ProbeFailure || error instanceof ProbeTimeoutError) throw error
        console.error(`[dsh-persistence-probe] step ${name} failed:`, error)
        throw new ProbeFailure(`scenario-error:${name}`)
      }
    }

    const watchEvict = (doc: Y.Doc, owner: string, docId: string): void => {
      // F1（SA4 reject）：同一 doc 实例只注册一个 'destroyed' 监听——S1 中 d1 经
      // create h1 + load h2/h3 共享同一 live Y.Doc，若每 handle 各注册一次，内核一次
      // destroy() 会回调全部监听 → 一次驱逐发 N 条 evict（实测 t=1002 处 3×，events=34
      // 而非设计 §5 钉死的 32）。去重后「驱逐即销毁，销毁即事件」= 一条；同时 destroyedListeners
      // 的 teardown off 语义随之正确（Map 中始终是唯一已注册监听，失败路径 dispose 不再混入
      // spurious evict）。
      if (destroyedListeners.has(doc)) return
      const listener = (): void => { emit({ type: 'evict', owner, docId, t: now() }) }
      ;(doc as DocWithEvictEvent).on('destroyed', listener)
      destroyedListeners.set(doc, listener)
    }

    const createAndEmit = async (owner: User, docId: string, doc: Y.Doc): Promise<DocHandle> => {
      const handle = await svc.createDoc(owner, docId, doc)
      const key = toProbeKey(owner.userId, docId)
      heldByKey.set(key, (heldByKey.get(key) ?? 0) + 1)
      watchEvict(doc, owner.userId, docId)
      emit({ type: 'create', owner: owner.userId, docId, handle: nextHandle(), docInstance: instanceId(doc), t: now() })
      return handle
    }

    const loadAndEmit = async (owner: User, docId: string): Promise<DocHandle> => {
      const handle = await svc.loadDoc(owner, docId)
      if (handle === null) throw new Error(`loadDoc returned null for ${owner.userId}/${docId}`)
      const key = toProbeKey(owner.userId, docId)
      heldByKey.set(key, (heldByKey.get(key) ?? 0) + 1)
      watchEvict(handle.doc, owner.userId, docId)
      emit({ type: 'load', owner: owner.userId, docId, handle: nextHandle(), docInstance: instanceId(handle.doc), t: now() })
      return handle
    }

    const saveAndEmit = async (handle: DocHandle, docId: string): Promise<void> => {
      const owner = handle.owner.userId
      const key = toProbeKey(owner, docId)
      await svc.saveDoc(handle) // 拒绝（write-rejected 之外的意外失败）→ 场景 loud 失败
      savedByKey.set(key, (savedByKey.get(key) ?? 0) + 1) // ★ resolve 后才计数（决策 C）
      emit({ type: 'dirty', owner, docId, generation: savedByKey.get(key)!, t: now() })
    }

    const releaseAndEmit = async (handle: DocHandle, docId: string): Promise<void> => {
      const owner = handle.owner.userId
      const key = toProbeKey(owner, docId)
      const refs = (heldByKey.get(key) ?? 1) - 1
      heldByKey.set(key, refs)
      // release 先于 await 发出：内核 maybeEvict 同步销毁 doc → destroyed 监听随后发 evict，
      // 记录序 = release → evict（决策 G：相邻 release 之间由调用方推进 1-tick）。
      emit({ type: 'release', owner, docId, refs, t: now() })
      await handle.release()
    }

    const emitObserved = (owner: User, docId: string, doc: Y.Doc): void => {
      const metaDocId = doc.getMap('META').get('docId')
      if (typeof metaDocId !== 'string') throw new Error(`META.docId missing on observed ${owner.userId}/${docId}`)
      const shareKeys = [...doc.share.keys()]
      const ordered: string[] = []
      for (const name of ['SCHEMA', 'META', 'ROOT']) {
        if (shareKeys.includes(name)) ordered.push(name)
      }
      const extras = shareKeys.filter((name) => !ordered.includes(name)).sort()
      const rootKeys = [...doc.getMap('ROOT').keys()].sort()
      emit({ type: 'observed', owner: owner.userId, docId, metaDocId, entries: [...ordered, ...extras], rootKeys, t: now() })
    }

    /** flush 观察（决策 B/H）：memory 钩子已同步发事件，此处自检；file 真实等待提交态。 */
    const observeFlush = async (
      owner: string,
      docId: string,
      generation: number,
      expect: { snapshotRev?: number },
    ): Promise<void> => {
      if (adapter === 'memory') {
        const flushed = events.some(
          (event) => event.type === 'flush' && event.docId === docId && event.generation === generation && event.ok === true,
        )
        if (!flushed || profile!.getStatus() !== 'ready') throw new ProbeFailure(`status-divergence:${docId}`)
        return
      }
      await waitFor(
        () => profile!.getStatus() === 'ready' && readSnapshotRev(owner, docId) === expect.snapshotRev,
        FILE_WAIT_MS,
        `file-settle-timeout:${docId}:g${generation}`,
      )
      emit({ type: 'flush', owner, docId, generation, ok: true, t: now() })
    }

    // ================= S1 主链路：user-a/doc-alpha =================
    await step('S1-create', async () => {
      const alpha = threeEntryDoc('doc-alpha')
      const h1 = await createAndEmit(USER_A, 'doc-alpha', alpha)
      alpha.getMap('ROOT').set('rev', 1)
      await saveAndEmit(h1, 'doc-alpha') // dirty g1
      await clock.advanceBy(schedule.debounceMs)
      await settle()
      await observeFlush('user-a', 'doc-alpha', 1, { snapshotRev: 1 })

      const h2 = await loadAndEmit(USER_A, 'doc-alpha') // 独立 handle、同一 live Y.Doc
      const h3 = await loadAndEmit(USER_A, 'doc-alpha')
      alpha.getMap('ROOT').set('rev', 2)
      await saveAndEmit(h1, 'doc-alpha') // dirty g2
      await clock.advanceBy(schedule.debounceMs)
      await settle()
      await observeFlush('user-a', 'doc-alpha', 2, { snapshotRev: 2 })

      await releaseAndEmit(h1, 'doc-alpha') // refs 3→2
      await clock.advanceBy(1)
      await settle()
      await releaseAndEmit(h2, 'doc-alpha') // refs 2→1
      await clock.advanceBy(1)
      await settle()
      await releaseAndEmit(h3, 'doc-alpha') // refs 1→0 → 内核 maybeEvict → d1 destroyed

      // 重新 load：cache miss → store 还原 → 新 Y.Doc 实例（AC5/决策 C）
      const h4 = await loadAndEmit(USER_A, 'doc-alpha')
      emitObserved(USER_A, 'doc-alpha', h4.doc)
      await clock.advanceBy(1)
      await settle()
      await releaseAndEmit(h4, 'doc-alpha') // evict d2
    })

    // ================= S2 隔离：user-b/doc-alpha =================
    await step('S2-isolation', async () => {
      await clock.advanceBy(1)
      await settle()
      const bob = threeEntryDoc('doc-alpha')
      const h5 = await createAndEmit(USER_B, 'doc-alpha', bob)
      emitObserved(USER_B, 'doc-alpha', bob)
      await clock.advanceBy(1)
      await settle()
      await releaseAndEmit(h5, 'doc-alpha') // evict d3
    })

    // ================= S3 异常输入 =================
    await step('S3-invalid-input', async () => {
      await clock.advanceBy(1)
      await settle()
      const dupDoc = threeEntryDoc('doc-alpha')
      try {
        await svc.createDoc(USER_A, 'doc-alpha', dupDoc)
        throw new Error('createDoc unexpectedly succeeded for an existing (owner, docId)')
      } catch (error) {
        if (error instanceof ProbeFailure || error instanceof ProbeTimeoutError) throw error
        if (error instanceof DocDuplicateError) {
          emit({ type: 'duplicate', owner: 'user-a', docId: 'doc-alpha', code: error.code, t: now() })
        } else {
          throw error
        }
      }

      await clock.advanceBy(1)
      await settle()
      const badMeta = new Y.Doc()
      badMeta.getMap('META').set('docId', 'doc-other')
      try {
        await svc.createDoc(USER_A, 'doc-alpha', badMeta)
        throw new Error('createDoc unexpectedly succeeded for a mismatched META.docId')
      } catch (error) {
        if (error instanceof ProbeFailure || error instanceof ProbeTimeoutError) throw error
        if (isMetaMismatch(error)) {
          emit({ type: 'meta-mismatch', owner: 'user-a', docId: 'doc-alpha', expected: 'doc-alpha', actual: 'doc-other', t: now() })
        } else {
          throw error
        }
      }
    })

    // ================= S4 降级：user-a/doc-degraded =================
    await step('S4-degradation', async () => {
      await clock.advanceBy(1)
      await settle()
      const degradedDoc = threeEntryDoc('doc-degraded')
      const h6 = await createAndEmit(USER_A, 'doc-degraded', degradedDoc)
      degradedDoc.getMap('ROOT').set('rev', 1)
      await saveAndEmit(h6, 'doc-degraded') // dirty g1

      if (failFirstFlushes > 0) {
        // 尝试 #1：注入失败（memory 钩子 throw / file .tmp 目录阻塞 → EISDIR）
        if (adapter === 'file') ensureBlocked('user-a', 'doc-degraded')
        await clock.advanceBy(schedule.debounceMs || 1)
        await settle()
        if (adapter === 'file') {
          await waitFor(
            () => profile!.getStatus() === 'persistence-degraded',
            FILE_WAIT_MS,
            'file-settle-timeout:doc-degraded:g1',
          )
          emit({ type: 'flush', owner: 'user-a', docId: 'doc-degraded', generation: 1, ok: false, t: now() })
          emit({ type: 'degraded', owner: 'user-a', docId: 'doc-degraded', t: now() })
        } else if (profile!.getStatus() !== 'persistence-degraded') {
          throw new ProbeFailure('status-divergence:doc-degraded')
        }

        // degraded 拒绝后续写（提示 4：经 saveDoc 拒绝路径观察）。
        // F2（SA4 LOW）：哨兵不得被同一 catch 吞掉——若内核回归为 degraded 仍接受写，
        // 此处必须 loud 失败（scenario-error）而非记一条假 write-rejected（与 S3 处理一致）。
        const rejected = await svc.saveDoc(h6).then(
          () => false,
          () => true,
        )
        if (!rejected) {
          throw new Error('saveDoc unexpectedly accepted while persistence-degraded')
        }
        emit({ type: 'write-rejected', owner: 'user-a', docId: 'doc-degraded', t: now() })

        // 内部退避 retry 通用循环（§5：镜像内核 retryDelayMs 初值 debounceMs，失败后 ×2 cap maxDirtyMs）
        let delay = schedule.debounceMs || 1
        let left = failFirstFlushes - 1
        while (left > 0) {
          if (adapter === 'file') ensureBlocked('user-a', 'doc-degraded')
          await clock.advanceBy(delay)
          await settle()
          if (adapter === 'file') {
            // 失败已结算 ⟺ 内核已排下一个 retry 计时器（pending>0）
            await waitFor(() => filePendingCount() > 0, FILE_WAIT_MS, 'file-settle-timeout:doc-degraded:g1')
            emit({ type: 'flush', owner: 'user-a', docId: 'doc-degraded', generation: 1, ok: false, t: now() })
            emit({ type: 'degraded', owner: 'user-a', docId: 'doc-degraded', t: now() })
          } else {
            if (profile!.getStatus() !== 'persistence-degraded') throw new ProbeFailure('status-divergence:doc-degraded')
          }
          left -= 1
          delay = Math.min(delay * 2, schedule.maxDirtyMs)
        }

        // 注入耗尽后的成功 retry → recovered
        if (adapter === 'file') unblock('user-a', 'doc-degraded')
        await clock.advanceBy(delay)
        await settle()
        if (adapter === 'file') {
          await waitFor(() => profile!.getStatus() === 'ready', FILE_WAIT_MS, 'file-settle-timeout:doc-degraded:g1')
          await waitFor(() => readSnapshotRev('user-a', 'doc-degraded') === 1, FILE_WAIT_MS, 'file-settle-timeout:doc-degraded:g1')
          emit({ type: 'flush', owner: 'user-a', docId: 'doc-degraded', generation: 1, ok: true, t: now() })
          emit({ type: 'recovered', owner: 'user-a', docId: 'doc-degraded', t: now() })
        } else {
          if (profile!.getStatus() !== 'ready') throw new ProbeFailure('status-divergence:doc-degraded')
          if (!events.some((event) => event.type === 'recovered' && event.docId === 'doc-degraded')) {
            throw new ProbeFailure('status-divergence:doc-degraded')
          }
        }
      } else {
        await clock.advanceBy(schedule.debounceMs)
        await settle()
        await observeFlush('user-a', 'doc-degraded', 1, { snapshotRev: 1 })
      }

      // 恢复可写证明（saveDoc resolve → dirty g2 必在 recovered 之后）
      degradedDoc.getMap('ROOT').set('rev', 2)
      await saveAndEmit(h6, 'doc-degraded')
      await clock.advanceBy(schedule.debounceMs)
      await settle()
      await observeFlush('user-a', 'doc-degraded', 2, { snapshotRev: 2 })

      await clock.advanceBy(1)
      await settle()
      await releaseAndEmit(h6, 'doc-degraded') // evict d4
    })

    ok = true
  } catch (error) {
    if (error instanceof ProbeFailure || error instanceof ProbeTimeoutError) {
      failureReason = error.reason
    } else {
      console.error(`[dsh-persistence-probe] unexpected failure at step ${currentStep}:`, error)
      failureReason = `scenario-error:${currentStep}`
    }
  } finally {
    // teardown 纪律（§7）：先拆 destroyed 监听（dispose 销毁 live doc 不再误发 evict），再 dispose。
    for (const [doc, listener] of destroyedListeners) {
      ;(doc as DocWithEvictEvent).off('destroyed', listener)
    }
    destroyedListeners.clear()
    if (profile !== undefined) {
      try {
        await profile.dispose()
      } catch (error) {
        console.error('[dsh-persistence-probe] profile dispose failed:', error)
        if (failureReason === undefined) failureReason = `scenario-error:${currentStep}`
      }
    }
  }

  const record = renderProbeRecord(events, {
    adapter,
    schedule,
    failFirstFlushes,
    ok,
    ...(failureReason !== undefined ? { failureReason } : {}),
  })
  return {
    ok,
    events,
    record,
    ...(failureReason !== undefined ? { failureReason } : {}),
  }
}

function isMetaMismatch(error: unknown): boolean {
  return error instanceof Error && /META\.docId/.test(error.message)
}

/** 决策 D：不可推进的 timer 一律 loud reject（clock-not-drivable，不产生 record）。 */
function resolveProbeClock(timer: PersistenceTimer | undefined): ProbeClock {
  if (timer === undefined) return createDeterministicClock()
  const candidate = timer as ProbeClock
  if (typeof candidate.advanceBy !== 'function') {
    throw new TypeError('runPersistenceProbe requires a drivable clock (advanceBy); a bare PersistenceTimer cannot keep the record deterministic')
  }
  return candidate
}
