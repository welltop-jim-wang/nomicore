/**
 * SA6 红灯验收测试 — Issue #59「DSH 持久化开发 profile 与 inspector 探针」（P4，功能开发）
 *
 * 契约来源：
 * - 任务简报 wiki/raw/task_dsh-persistence-inspector.md 验收条款 AC1–AC6；
 * - ADR-0006（含 2026-08-21 createDoc/owner 修订节）：宿主与插件边界、DocHandle lease、
 *   saveDoc=脏通知+内部调度（debounce 500ms / max-dirty 5s 可覆写）、persistence-degraded
 *   拒绝后续写、retry 内部退避恢复、release 后由持久层决定 evict、dispose 释放全部资源；
 * - 冲突门禁报告结论提示 1–4：新建 doc 必须走 createDoc 排他创建（首个 saveDoc 建 doc 的旧条款
 *   已被修订节取代）；标识用 user-a/user-b 安全文法；inspector 不得引入外部 flush 协调器，
 *   只观察内部调度（受控时钟）；degraded 观测面经 saveDoc/lease 拒绝路径观察。
 *
 * 断言纪律：全部断言锚定运行时行为（Cordis service 身份、handle/doc 实例身份、受控时钟下
 * 的 flush 事件、状态迁移、磁盘布局、fd/timer/残留），不做任何源码文本形状断言。
 *
 * 红灯现状（Phase 1 验收锚定）：packages/dsh-persistence/src/ 尚不存在 →
 * `../src/index.js` 值导入在收集期解析失败，本文件整体红灯（真红：功能未实现）。
 * 修绿（SA3）必须交付本文件导入的契约面：createDshPersistenceProfile / runPersistenceProbe /
 * DshPersistenceProfile / ProbeRunOptions / ProbeRunResult / ProbeEvent（详见 wiki 测试记录）。
 *
 * R1 修订（2026-08-22，SA1 设计 §9 阻塞项，总控协调）：AC4 file service 级用例两处
 * getStatus 断言前插入 settleRealIo()（真实文件 I/O 在 libuv 结算，FakeTimer 只排空微任务）；
 * AC6 用例 dispose 前插入 advanceBy(debounceMs)+settleRealIo()（内核 dispose 不 flush 未决
 * 脏数据）。仅修测试时序基础设施，断言目标值一字未改；修订后本文件仍整体红灯。
 *
 * R2 修订（2026-08-22，SA1 设计 §9 缺陷 3，总控协调）：AC1-memory 用例按修法 B 修订——
 * loadDoc 前移到 release 之前（cache-hit 路径），断言目标值 `loaded!.doc === doc` 原样；
 * 新增独立 lease 断言与反黑帽守卫（双 release 后 doc.isDestroyed===true、timer.pending()===0）。
 * 原因：clean entry 在最后一个 release 时被内核 maybeEvict 同步驱逐并销毁 doc（ADR-0006
 * 驱逐条款），release 后的 loadDoc 必还原新实例，原断言序不可满足（SA2 攻击点 1，实证 P13）。
 */
import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as Y from 'yjs'
import {
  DEFAULT_PERSISTENCE_SCHEDULE,
  DOC_PERSISTENCE_SERVICE,
  FilePersistence,
  MemoryPersistence,
  type PersistenceTimer,
} from '@nomicore/persistence'
import {
  createDshPersistenceProfile,
  runPersistenceProbe,
  type ProbeEvent,
} from '../src/index.js'

/** 受控时钟：测试与探针共用，flush/retry 全部落在虚拟时钟刻度上。 */
interface FakeTimer extends PersistenceTimer {
  advanceBy(milliseconds: number): Promise<void>
  pending(): number
  cleared(): readonly number[]
}

function createFakeTimer(): FakeTimer {
  let now = 0
  let nextId = 0
  const cleared: number[] = []
  const timers = new Map<number, { at: number, callback: () => void }>()
  return {
    now: () => now,
    setTimeout(callback, delayMs) {
      const id = nextId++
      timers.set(id, { at: now + delayMs, callback })
      return id
    },
    clearTimeout(timer) {
      const id = timer as number
      cleared.push(id)
      timers.delete(id)
    },
    async advanceBy(milliseconds) {
      const deadline = now + milliseconds
      while (true) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= deadline)
          .sort(([, left], [, right]) => left.at - right.at)[0]
        if (!due) break
        const [id, timer] = due
        timers.delete(id)
        now = timer.at
        timer.callback()
        await Promise.resolve()
        await Promise.resolve()
      }
      now = deadline
      await Promise.resolve()
      await Promise.resolve()
    },
    pending: () => timers.size,
    cleared: () => cleared,
  }
}

/** ADR-0006 三条目内容布局：SCHEMA 信封 + META.docId + ROOT 数据根。 */
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

/**
 * 真实文件 I/O 结算等待（R1 修订，SA1 设计 §9 缺陷 1/2 修复配方）。
 *
 * FakeTimer 的 advanceBy 只排空微任务；FilePersistence 的 fsp.mkdir/writeFile/rename 在
 * libuv 线程池结算，需真实事件循环轮转（实测约 5 轮 setImmediate）才能观察到 flush 结果。
 * 本助手在断言 getStatus() 之前轮转事件循环，让真实 I/O 落地——只修时序基础设施，
 * 断言目标值一字不改。
 */
const settleRealIo = async (rounds = 12): Promise<void> => {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

describe('DSH persistence profile（AC1：薄宿主，双 Adapter 同一 contracts）', () => {
  it('memory adapter：profile 提供真实 MemoryPersistence 服务，createDoc→loadDoc→saveDoc 往返可用', async () => {
    const timer = createFakeTimer()
    const profile = createDshPersistenceProfile({ adapter: 'memory', timer })
    try {
      expect(profile.ctx.get(DOC_PERSISTENCE_SERVICE)).toBe(profile.persistence)
      expect(profile.persistence).toBeInstanceOf(MemoryPersistence)
      const owner = { userId: 'user-a' }
      const doc = threeEntryDoc('doc-alpha')
      const handle = await profile.persistence.createDoc(owner, 'doc-alpha', doc)
      expect(handle.doc).toBe(doc)
      expect(handle.owner).toBe(owner)
      expect(handle.docId).toBe('doc-alpha')
      // R2（SA1 §9 缺陷 3 修法 B）：loadDoc 前移到 release 之前——本用例无 saveDoc，
      // entry 处于 clean 态，内核 maybeEvict 在最后一个 release 时同步驱逐并销毁 doc
      // （ADR-0006 驱逐条款），release 后的 loadDoc 必走 store 还原出**新实例**；
      // 只有 cache-hit 路径保证「共享 doc、独立 handle」的同一 live Y.Doc 断言成立。
      const loaded = await profile.persistence.loadDoc(owner, 'doc-alpha')
      expect(loaded).not.toBeNull()
      expect(loaded!.doc).toBe(doc)
      // 独立 lease：与 createDoc 返回的 handle 不同（ADR「每次 load 返回独立 DocHandle/lease」）
      expect(loaded).not.toBe(handle)
      await loaded!.release()
      await handle.release()
      // 反黑帽守卫：双 release 后无 phantom handle 抑制驱逐——doc 已被内核销毁、
      // 无残留计时器（若 profile 偷持 handle 或绕过驱逐，此处立即爆红）
      expect(doc.isDestroyed).toBe(true)
      expect(timer.pending()).toBe(0)
    } finally {
      await profile.dispose()
    }
  })

  it('file adapter：profile 提供真实 FilePersistence 服务，flush 后快照落盘 users/<user>/<doc>.snapshot', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-file-ac1-'))
    const timer = createFakeTimer()
    const profile = createDshPersistenceProfile({ adapter: 'file', rootDir, timer })
    try {
      expect(profile.persistence).toBeInstanceOf(FilePersistence)
      const owner = { userId: 'user-a' }
      const doc = threeEntryDoc('doc-1')
      doc.getMap('ROOT').set('title', 'alpha')
      const handle = await profile.persistence.createDoc(owner, 'doc-1', doc)
      await profile.persistence.saveDoc(handle)
      await timer.advanceBy(DEFAULT_PERSISTENCE_SCHEDULE.debounceMs)
      await handle.release()
      expect(fs.existsSync(path.join(rootDir, 'users', 'user-a', 'doc-1.snapshot'))).toBe(true)
    } finally {
      await profile.dispose()
      fs.rmSync(rootDir, { recursive: true, force: true })
    }
  })

  it('异常输入：未知 adapter 类型在 profile 创建时响亮拒绝', () => {
    expect(() => createDshPersistenceProfile({ adapter: 'bogus' as never })).toThrow()
  })
})

describe('inspector 探针（AC2/AC3/AC5：受控时钟下的可观察记录）', () => {
  it('AC2：记录完整链路 load → saveDoc 标脏 → 受控调度 flush → release；重复 load 同 doc、不同 handle；引用归零后才 evict', async () => {
    const timer = createFakeTimer()
    const result = await runPersistenceProbe({ adapter: 'memory', timer })
    expect(result.ok).toBe(true)
    const events = result.events
    const docAlpha = events.filter((event) => event.docId === 'doc-alpha')
    const flushes = docAlpha.filter((event): event is Extract<ProbeEvent, { type: 'flush' }> => event.type === 'flush')
    const dirty = docAlpha.filter((event): event is Extract<ProbeEvent, { type: 'dirty' }> => event.type === 'dirty')

    // saveDoc 只标脏：debounce 截止前不得出现 flush，首次 flush 必落在 [debounce, maxDirty) 区间
    expect(flushes.length).toBeGreaterThanOrEqual(2)
    expect(flushes.every((event) => event.t >= DEFAULT_PERSISTENCE_SCHEDULE.debounceMs)).toBe(true)
    // 每次 flush 前必有同 generation 的 dirty（可观察调度，非外部协调器）
    for (const flush of flushes) {
      const before = dirty.find((d) => d.t <= flush.t && d.generation === flush.generation)
      expect(before, `flush g${flush.generation} 前应有同代 dirty`).toBeDefined()
    }

    // 重复 load 同 doc：独立 handle、同一 live Y.Doc 实例
    const loads = docAlpha.filter((event): event is Extract<ProbeEvent, { type: 'load' }> => event.type === 'load')
    expect(loads.length).toBeGreaterThanOrEqual(3)
    const handles = new Set(loads.map((event) => event.handle))
    expect(handles.size).toBe(loads.length)
    const instanceCounts = new Map<string, number>()
    for (const event of loads) {
      instanceCounts.set(event.docInstance, (instanceCounts.get(event.docInstance) ?? 0) + 1)
    }
    expect([...instanceCounts.values()].some((count) => count >= 2)).toBe(true)

    // release 引用归零 → 持久层内部决定 evict → 重新 load 得到新 Y.Doc 实例
    expect(instanceCounts.size).toBeGreaterThanOrEqual(2)
    const releases = docAlpha.filter((event): event is Extract<ProbeEvent, { type: 'release' }> => event.type === 'release')
    const evicts = docAlpha.filter((event): event is Extract<ProbeEvent, { type: 'evict' }> => event.type === 'evict')
    expect(releases.length).toBeGreaterThanOrEqual(3)
    expect(releases[0]!.refs).toBeGreaterThan(0)
    expect(releases[releases.length - 1]!.refs).toBe(0)
    expect(evicts.length).toBeGreaterThanOrEqual(2)
    // 首次 release 后（refs>0）不得立即 evict；evict 只出现在 refs 归零之后
    expect(evicts.every((event) => event.t > releases[0]!.t)).toBe(true)

    // 文本记录与事件同源：关键链路标记完整
    expect(result.record).toContain('create user-a/doc-alpha')
    expect(result.record).toContain(`flush doc-alpha generation=1 ok`)
    expect(result.record).toContain('release doc-alpha refs=0')
    expect(result.record).toContain('evict doc-alpha')
  })

  it('AC3：SCHEMA/META/ROOT 三条目与 META.docId 可观察；userA/doc1 与 userB/doc1 隔离；duplicate/meta-mismatch 记录完整', async () => {
    const timer = createFakeTimer()
    const result = await runPersistenceProbe({ adapter: 'memory', timer })
    expect(result.ok).toBe(true)
    const events = result.events

    const observedAlpha = events.find(
      (event): event is Extract<ProbeEvent, { type: 'observed' }> =>
        event.type === 'observed' && event.owner === 'user-a' && event.docId === 'doc-alpha',
    )
    expect(observedAlpha).toBeDefined()
    expect(observedAlpha!.metaDocId).toBe('doc-alpha')
    expect(observedAlpha!.entries).toEqual(expect.arrayContaining(['SCHEMA', 'META', 'ROOT']))

    // user-b/doc-alpha 独立分区：独立 create 成功、独立实例
    const createdB = events.find(
      (event): event is Extract<ProbeEvent, { type: 'create' }> =>
        event.type === 'create' && event.owner === 'user-b' && event.docId === 'doc-alpha',
    )
    expect(createdB).toBeDefined()
    const observedB = events.find(
      (event): event is Extract<ProbeEvent, { type: 'observed' }> =>
        event.type === 'observed' && event.owner === 'user-b' && event.docId === 'doc-alpha',
    )
    expect(observedB).toBeDefined()
    expect(observedB!.metaDocId).toBe('doc-alpha')

    // 异常输入：META.docId 不一致 → 响亮失败记录；重复 create → DOC_DUPLICATE 稳定错误码记录
    const mismatch = events.find(
      (event): event is Extract<ProbeEvent, { type: 'meta-mismatch' }> => event.type === 'meta-mismatch',
    )
    expect(mismatch).toBeDefined()
    expect(mismatch!.expected).toBe('doc-alpha')
    expect(mismatch!.actual).toBe('doc-other')
    const duplicate = events.find(
      (event): event is Extract<ProbeEvent, { type: 'duplicate' }> => event.type === 'duplicate',
    )
    expect(duplicate).toBeDefined()
    expect(duplicate!.code).toBe('DOC_DUPLICATE')

    expect(result.record).toContain('observed user-a/doc-alpha entries=SCHEMA,META,ROOT metaDocId=doc-alpha')
    expect(result.record).toContain('duplicate user-a/doc-alpha code=DOC_DUPLICATE')
    expect(result.record).toContain('meta-mismatch user-a/doc-alpha expected=doc-alpha actual=doc-other')
  })

  it('AC3（service 级）：file profile 下 user-a/doc-1 与 user-b/doc-1 快照分用户目录隔离，内容互不串扰；META.docId 校验响亮失败', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-file-ac3-'))
    const timer = createFakeTimer()
    const profile = createDshPersistenceProfile({ adapter: 'file', rootDir, timer })
    try {
      const alice = { userId: 'user-a' }
      const bob = { userId: 'user-b' }
      const docA = threeEntryDoc('doc-1')
      docA.getMap('ROOT').set('title', 'alpha')
      const docB = threeEntryDoc('doc-1')
      docB.getMap('ROOT').set('title', 'beta')
      const handleA = await profile.persistence.createDoc(alice, 'doc-1', docA)
      const handleB = await profile.persistence.createDoc(bob, 'doc-1', docB)
      await profile.persistence.saveDoc(handleA)
      await profile.persistence.saveDoc(handleB)
      await timer.advanceBy(DEFAULT_PERSISTENCE_SCHEDULE.debounceMs)
      await handleA.release()
      await handleB.release()

      expect(fs.existsSync(path.join(rootDir, 'users', 'user-a', 'doc-1.snapshot'))).toBe(true)
      expect(fs.existsSync(path.join(rootDir, 'users', 'user-b', 'doc-1.snapshot'))).toBe(true)

      const loadedA = await profile.persistence.loadDoc(alice, 'doc-1')
      const loadedB = await profile.persistence.loadDoc(bob, 'doc-1')
      expect(loadedA).not.toBeNull()
      expect(loadedB).not.toBeNull()
      expect(loadedA!.doc).not.toBe(loadedB!.doc)
      expect(loadedA!.doc.getMap('ROOT').get('title')).toBe('alpha')
      expect(loadedB!.doc.getMap('ROOT').get('title')).toBe('beta')
      await loadedA!.release()
      await loadedB!.release()

      // META.docId 与请求 docId 不一致 → 响亮失败，不缓存、不销毁调用方 doc
      const mismatched = new Y.Doc()
      mismatched.getMap('META').set('docId', 'doc-other')
      await expect(profile.persistence.createDoc(alice, 'doc-1', mismatched)).rejects.toThrow(/META\.docId/)
      expect(mismatched.isDestroyed).toBe(false)
    } finally {
      await profile.dispose()
      fs.rmSync(rootDir, { recursive: true, force: true })
    }
  })
})

describe('save 失败降级与 dispose 卫生（AC4/AC6）', () => {
  it('AC4：探针记录完整——save 失败 → persistence-degraded → 后续写拒绝 → retry 成功恢复可写', async () => {
    const timer = createFakeTimer()
    const result = await runPersistenceProbe({ adapter: 'memory', timer, failFirstFlushes: 1 })
    expect(result.ok).toBe(true)
    const degraded = result.events.filter((event) => event.docId === 'doc-degraded')
    const failedFlush = degraded.find((event): event is Extract<ProbeEvent, { type: 'flush' }> => event.type === 'flush' && event.ok === false)
    const degradedEvent = degraded.find((event): event is Extract<ProbeEvent, { type: 'degraded' }> => event.type === 'degraded')
    const rejected = degraded.find((event): event is Extract<ProbeEvent, { type: 'write-rejected' }> => event.type === 'write-rejected')
    const okFlush = degraded.find((event): event is Extract<ProbeEvent, { type: 'flush' }> => event.type === 'flush' && event.ok === true)
    const recovered = degraded.find((event): event is Extract<ProbeEvent, { type: 'recovered' }> => event.type === 'recovered')
    expect(failedFlush).toBeDefined()
    expect(degradedEvent).toBeDefined()
    expect(rejected).toBeDefined()
    expect(okFlush).toBeDefined()
    expect(recovered).toBeDefined()
    const sequence = [failedFlush!.t, degradedEvent!.t, rejected!.t, okFlush!.t, recovered!.t]
    expect(sequence).toEqual([...sequence].sort((left, right) => left - right))

    expect(result.record).toContain('flush doc-degraded generation=1 ok=false')
    expect(result.record).toContain('degraded doc-degraded')
    expect(result.record).toContain('write-rejected doc-degraded')
    expect(result.record).toContain('recovered doc-degraded')
  })

  it('AC4（service 级）：memory profile 写失败一次 → persistence-degraded → saveDoc 拒绝 → retry 恢复', async () => {
    const timer = createFakeTimer()
    let writes = 0
    const profile = createDshPersistenceProfile({
      adapter: 'memory',
      timer,
      memoryIo: {
        writeSnapshot: async () => {
          writes += 1
          if (writes === 2) throw new Error('disk unavailable')
        },
      },
    })
    try {
      const owner = { userId: 'user-a' }
      const handle = await profile.persistence.createDoc(owner, 'doc-degraded', threeEntryDoc('doc-degraded'))
      await profile.persistence.saveDoc(handle)
      await timer.advanceBy(DEFAULT_PERSISTENCE_SCHEDULE.debounceMs)
      expect(profile.getStatus()).toBe('persistence-degraded')
      await expect(profile.persistence.saveDoc(handle)).rejects.toThrow(/persistence-degraded/)
      // retry 属持久层内部退避（首次退避 = debounceMs）
      await timer.advanceBy(DEFAULT_PERSISTENCE_SCHEDULE.debounceMs)
      expect(profile.getStatus()).toBe('ready')
      await expect(profile.persistence.saveDoc(handle)).resolves.toBeUndefined()
      await timer.advanceBy(DEFAULT_PERSISTENCE_SCHEDULE.debounceMs)
      await handle.release()
    } finally {
      await profile.dispose()
    }
  })

  it('AC4（service 级）：file profile 写路径被阻塞 → persistence-degraded，解除后 retry 恢复', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-file-ac4-'))
    const timer = createFakeTimer()
    const profile = createDshPersistenceProfile({ adapter: 'file', rootDir, timer })
    try {
      const owner = { userId: 'user-a' }
      const handle = await profile.persistence.createDoc(owner, 'doc-1', threeEntryDoc('doc-1'))
      // 以普通文件占据用户目录路径 → flush 的 mkdir 失败（可移植的写失败注入，无权限依赖）
      fs.rmSync(path.join(rootDir, 'users', 'user-a'), { recursive: true, force: true })
      fs.writeFileSync(path.join(rootDir, 'users', 'user-a'), 'blocker')
      await profile.persistence.saveDoc(handle)
      await timer.advanceBy(DEFAULT_PERSISTENCE_SCHEDULE.debounceMs)
      // R1（SA1 §9 缺陷 1）：真实文件 I/O 在 libuv 结算，FakeTimer 只排空微任务——
      // 必须先轮转事件循环让 flush 的 mkdir 失败落地，getStatus 才能观察到 degraded
      await settleRealIo()
      expect(profile.getStatus()).toBe('persistence-degraded')
      await expect(profile.persistence.saveDoc(handle)).rejects.toThrow(/persistence-degraded/)
      fs.rmSync(path.join(rootDir, 'users', 'user-a'), { force: true })
      await timer.advanceBy(DEFAULT_PERSISTENCE_SCHEDULE.debounceMs)
      // R1：同理，retry flush 的 mkdir/writeFile/rename 需真实结算后才能观察到 recovered
      await settleRealIo()
      expect(profile.getStatus()).toBe('ready')
      await expect(profile.persistence.saveDoc(handle)).resolves.toBeUndefined()
      await timer.advanceBy(DEFAULT_PERSISTENCE_SCHEDULE.debounceMs)
      await handle.release()
    } finally {
      await profile.dispose()
      fs.rmSync(rootDir, { recursive: true, force: true })
    }
  })

  it('AC6：dispose 后无 timer/监听器/文件句柄/Y.Doc cache/.tmp 残留；reload 全新实例可读已提交快照', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-file-ac6-'))
    const timer = createFakeTimer()
    const profile = createDshPersistenceProfile({ adapter: 'file', rootDir, timer })
    const owner = { userId: 'user-a' }
    const handle = await profile.persistence.createDoc(owner, 'doc-1', threeEntryDoc('doc-1'))
    handle.doc.getMap('ROOT').set('rev', 1)
    await profile.persistence.saveDoc(handle)
    expect(timer.pending()).toBeGreaterThan(0)

    // R1（SA1 §9 缺陷 2）：内核 dispose 清计时器但不 flush 未决脏数据——必须先推进
    // debounce 调度让 rev=1 提交落盘并真实结算，reload 才能读到 rev===1
    await timer.advanceBy(DEFAULT_PERSISTENCE_SCHEDULE.debounceMs)
    await settleRealIo()

    await profile.dispose()
    expect(timer.pending()).toBe(0)
    expect(handle.doc.isDestroyed).toBe(true)
    expect(profile.ctx.get(DOC_PERSISTENCE_SERVICE)).toBeUndefined()
    expect(profile.getStatus()).toBe('disposed')

    // 无 .tmp 半写残留
    const tmpFiles: string[] = []
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith('.tmp')) tmpFiles.push(full)
      }
    }
    if (fs.existsSync(rootDir)) walk(rootDir)
    expect(tmpFiles).toEqual([])

    // Linux：/proc/self/fd 无指向 rootDir 的打开句柄（文件句柄残留守卫）
    if (process.platform === 'linux') {
      const targets = fs.readdirSync('/proc/self/fd').map((fd) => {
        try {
          return fs.readlinkSync(path.join('/proc/self/fd', fd))
        } catch {
          return ''
        }
      })
      expect(targets.some((target) => target.includes(rootDir))).toBe(false)
    }

    // reload：同一 rootDir 全新 profile 读到已提交内容，且是新 Y.Doc 实例
    const reloaded = createDshPersistenceProfile({ adapter: 'file', rootDir, timer: createFakeTimer() })
    try {
      const loaded = await reloaded.persistence.loadDoc(owner, 'doc-1')
      expect(loaded).not.toBeNull()
      expect(loaded!.doc).not.toBe(handle.doc)
      expect(loaded!.doc.getMap('ROOT').get('rev')).toBe(1)
      await loaded!.release()
    } finally {
      await reloaded.dispose()
      fs.rmSync(rootDir, { recursive: true, force: true })
    }
  })
})
