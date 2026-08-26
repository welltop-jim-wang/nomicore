/**
 * SA6 red acceptance for issue #108 EC9 (design §5.3): Yjs encode failures
 * inside createDoc are classified as `DocCreateFatalError` with phase
 * 'snapshot-encode' and the authoritative committed:false. The classification
 * lives in the shared lifecycle, so one Memory-backed anchor covers both
 * adapters (design: "一处锚定即覆盖两 Adapter").
 *
 * `encodeStateAsUpdate` is partially mocked per file (vitest 3.2 keeps mocks
 * file-scoped; precedent: packages/vfsl/test/docscope-getcompiled.test.ts
 * `vi.mock(src/evaluate.js, importActual)`). Everything else — Doc, Map,
 * applyUpdate, restore — stays the real implementation.
 *
 * The production implementation now ships the typed error, so the static
 * imports below are the real imports and the assertions run against the
 * exported `DocCreateFatalError` (this file anchors EC9's classification:
 * snapshot-encode phase + authoritative committed:false).
 */
import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import {
  DocCreateFatalError,
  createMemoryPersistence,
  type User,
} from '../src/index.js'
import { createDocStore, createTestScheduler } from '../src/testing.js'

const SENTINEL = 'TOP-SECRET-CAUSE-TOKEN-7f3a'

/** The exact failure the mocked encode throws; identity is asserted on the cause. */
const encodeFault = vi.hoisted(() => new Error(`snapshot encode failed: TOP-SECRET-CAUSE-TOKEN-7f3a`))

vi.mock('yjs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('yjs')>()
  return {
    ...actual,
    encodeStateAsUpdate: () => { throw encodeFault },
  }
})

describe('DocPersistence encode-fatal contract (issue #108 EC9)', () => {
  it('wraps Yjs encode failures as DocCreateFatalError snapshot-encode committed:false', async () => {
    const scheduler = createTestScheduler()
    const store = createDocStore()
    const persistence = createMemoryPersistence({
      scheduler,
      readSnapshot: (key, signal) => store.read(key, signal),
      writeSnapshot: (key, snapshot, signal) => store.write(key, snapshot, signal),
    })
    const owner: User = { userId: 'alice' }
    const docId = 'ec9-doc'
    const doc = new Y.Doc()
    doc.getMap('META').set('docId', docId)
    doc.getMap('ROOT').set('who', 'never-encoded')

    const err = await persistence.createDoc(owner, docId, doc).then(
      () => { throw new Error('expected createDoc to reject') },
      (reason: unknown) => reason,
    )
    expect(err).toBeInstanceOf(DocCreateFatalError)
    expect(err).toMatchObject({ code: 'DOC_CREATE_FATAL' })
    expect((err as { phase: string }).phase).toBe('snapshot-encode')
    expect((err as { committed: boolean }).committed).toBe(false)
    expect((err as { cause: unknown }).cause).toBe(encodeFault)
    expect((err as { message: string }).message).toBe('createDoc fatal: internal create failure')
    expect((err as { name: string }).name).toBe('DocCreateFatalError')
    // N3: the encode-fault text never leaks into any public error face.
    expect((err as { message: string }).message).not.toContain(SENTINEL)
    expect((err as { name: string }).name).not.toContain(SENTINEL)
    expect(String((err as { stack?: string }).stack ?? '')).not.toContain(SENTINEL)
    expect(JSON.stringify(err)).not.toContain(SENTINEL)
    // The store is untouched and the caller still owns the doc.
    expect(await persistence.loadDoc(owner, docId)).toBeNull()
    expect(doc.isDestroyed).toBe(false)
    expect(scheduler.pending()).toBe(0)
    await persistence.dispose()
  })
})
