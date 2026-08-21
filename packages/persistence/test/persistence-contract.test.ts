import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  DEFAULT_PERSISTENCE_SCHEDULE,
  provideDocPersistence,
  requireDocPersistence,
  resolvePersistenceSchedule,
  type DocHandle,
  type DocPersistence,
  type User,
} from '../src/index.js'

const user: User = { userId: 'alice' }

function stubPersistence(): DocPersistence {
  return {
    async loadDoc(): Promise<DocHandle | null> {
      return null
    },
    async saveDoc(): Promise<void> {},
  }
}

describe('persistence contracts', () => {
  it('defines the ADR scheduling defaults and accepts deterministic overrides', () => {
    expect(DEFAULT_PERSISTENCE_SCHEDULE).toEqual({ debounceMs: 500, maxDirtyMs: 5_000 })
    expect(resolvePersistenceSchedule({ debounceMs: 0, maxDirtyMs: 12 })).toEqual({
      debounceMs: 0,
      maxDirtyMs: 12,
    })
    expect(() => resolvePersistenceSchedule({ debounceMs: -1 })).toThrow(RangeError)
    expect(() => resolvePersistenceSchedule({ maxDirtyMs: Number.NaN })).toThrow(RangeError)
  })

  it('registers and resolves the typed Cordis service from a bare Context', () => {
    const ctx = new Context()
    const persistence = stubPersistence()

    const dispose = provideDocPersistence(ctx, persistence)

    expect(requireDocPersistence(ctx)).toBe(persistence)
    expect(ctx.get('docPersistence')).toBe(persistence)
    expect(() => dispose()).not.toThrow()
  })

  it('loudly fails when a required persistence service is absent', () => {
    const ctx = new Context()

    expect(() => requireDocPersistence(ctx)).toThrow(/required Cordis service "docPersistence" is unavailable/)
  })

  it('keeps the public handle contract tied to Y.Doc without exposing cache controls', async () => {
    const doc = new Y.Doc()
    const handle: DocHandle = {
      user,
      docId: 'draft',
      doc,
      async release() {},
    }

    expect(handle.doc).toBe(doc)
    await expect(handle.release()).resolves.toBeUndefined()
    expect('evict' in handle).toBe(false)
    expect('list' in handle).toBe(false)
  })
})
