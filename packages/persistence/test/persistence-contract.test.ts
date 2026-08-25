import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  DEFAULT_PERSISTENCE_SCHEDULE,
  createMemoryPersistence,
  provideNomicorePersistence,
  requireNomicorePersistence,
  resolvePersistenceSchedule,
  type DocHandle,
  type DocPersistence,
  type User,
} from '../src/index.js'
import { createTestScheduler } from '../src/testing.js'

const owner: User = { userId: 'alice' }

function stubPersistence(): DocPersistence {
  return {
    async loadDoc(): Promise<DocHandle | null> {
      return null
    },
    async createDoc(): Promise<DocHandle> {
      throw new Error('stub persistence does not implement createDoc')
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

  it('provides a fake scheduler seam that tests can register, cancel, and advance without sleep', async () => {
    const scheduler = createTestScheduler()
    const calls: string[] = []

    const debounce = scheduler.setTimeout(() => calls.push('debounce'), DEFAULT_PERSISTENCE_SCHEDULE.debounceMs)
    scheduler.setTimeout(() => calls.push('max-dirty'), DEFAULT_PERSISTENCE_SCHEDULE.maxDirtyMs)
    scheduler.clearTimeout(debounce)

    expect(scheduler.pending()).toBe(1)
    await scheduler.advanceBy(DEFAULT_PERSISTENCE_SCHEDULE.debounceMs)
    expect(calls).toEqual([])
    await scheduler.advanceBy(DEFAULT_PERSISTENCE_SCHEDULE.maxDirtyMs - DEFAULT_PERSISTENCE_SCHEDULE.debounceMs)
    expect(calls).toEqual(['max-dirty'])
    expect(scheduler.pending()).toBe(0)
  })

  it('registers and resolves the typed Cordis service from a bare Context', () => {
    const ctx = new Context()
    const persistence = stubPersistence()

    const dispose = provideNomicorePersistence(ctx, persistence)

    expect(requireNomicorePersistence(ctx)).toBe(persistence)
    expect(ctx.get('nomicorePersistence')).toBe(persistence)
    expect(() => dispose()).not.toThrow()
  })

  it('loudly fails when a required persistence service is absent', () => {
    const ctx = new Context()

    expect(() => requireNomicorePersistence(ctx)).toThrow(/required Cordis service "nomicorePersistence" is unavailable/)
  })

  it('keeps the public handle contract tied to Y.Doc without exposing cache controls', async () => {
    const doc = new Y.Doc()
    const handle: DocHandle = {
      owner,
      docId: 'draft',
      doc,
      getStatus() { return 'ready' },
      async release() {},
    }

    expect(handle.doc).toBe(doc)
    expect(handle.getStatus()).toBe('ready')
    await expect(handle.release()).resolves.toBeUndefined()
    expect('evict' in handle).toBe(false)
    expect('list' in handle).toBe(false)
  })

  it('exposes createDoc on adapter instances (issue-64 createDoc contract)', () => {
    const persistence = createMemoryPersistence({ scheduler: createTestScheduler() })
    const seam = persistence as unknown as { createDoc?: unknown }
    expect(typeof seam.createDoc).toBe('function')
  })
})
