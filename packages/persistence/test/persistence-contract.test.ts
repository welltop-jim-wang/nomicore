import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  DEFAULT_PERSISTENCE_SCHEDULE,
  createMemoryPersistence,
  systemPersistenceTimer,
  provideDocPersistence,
  requireDocPersistence,
  resolvePersistenceSchedule,
  type DocHandle,
  type DocPersistence,
  type PersistenceTimer,
  type User,
} from '../src/index.js'

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

function createFakeTimer(): PersistenceTimer & {
  advanceBy(milliseconds: number): void
  pendingDelays(): readonly number[]
} {
  let now = 0
  let nextId = 0
  const timers = new Map<number, { at: number, callback: () => void }>()

  return {
    now: () => now,
    setTimeout(callback, delayMs) {
      const id = nextId++
      timers.set(id, { at: now + delayMs, callback })
      return id
    },
    clearTimeout(timer) {
      timers.delete(timer as number)
    },
    advanceBy(milliseconds) {
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
      }
      now = deadline
    },
    pendingDelays() {
      return [...timers.values()].map((timer) => timer.at - now).sort((left, right) => left - right)
    },
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

  it('provides a fake timer seam that tests can register, cancel, and advance without sleep', () => {
    const timer = createFakeTimer()
    const calls: string[] = []

    const debounce = timer.setTimeout(() => calls.push('debounce'), DEFAULT_PERSISTENCE_SCHEDULE.debounceMs)
    timer.setTimeout(() => calls.push('max-dirty'), DEFAULT_PERSISTENCE_SCHEDULE.maxDirtyMs)
    timer.clearTimeout(debounce)

    expect(timer.now()).toBe(0)
    expect(timer.pendingDelays()).toEqual([DEFAULT_PERSISTENCE_SCHEDULE.maxDirtyMs])
    timer.advanceBy(DEFAULT_PERSISTENCE_SCHEDULE.debounceMs)
    expect(calls).toEqual([])
    timer.advanceBy(DEFAULT_PERSISTENCE_SCHEDULE.maxDirtyMs - DEFAULT_PERSISTENCE_SCHEDULE.debounceMs)
    expect(calls).toEqual(['max-dirty'])
    expect(timer.pendingDelays()).toEqual([])
  })

  it('exposes a real system timer only as the production default', () => {
    expect(typeof systemPersistenceTimer.now).toBe('function')
    expect(typeof systemPersistenceTimer.setTimeout).toBe('function')
    expect(typeof systemPersistenceTimer.clearTimeout).toBe('function')
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
      owner,
      docId: 'draft',
      doc,
      async release() {},
    }

    expect(handle.doc).toBe(doc)
    await expect(handle.release()).resolves.toBeUndefined()
    expect('evict' in handle).toBe(false)
    expect('list' in handle).toBe(false)
  })

  it('exposes createDoc on adapter instances (issue-64 createDoc contract)', () => {
    const persistence = createMemoryPersistence()
    const seam = persistence as unknown as { createDoc?: unknown }
    expect(typeof seam.createDoc).toBe('function')
  })
})
