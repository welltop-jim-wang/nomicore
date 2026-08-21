import type { DocHandle, User } from '../src/index.js'
import { createMemoryHandleForTest as create } from '../src/memory.js'
import type { MemoryPersistence } from '../src/memory.js'

/** Test-only wrapper keeps the production adapter's internal factory synchronous. */
export async function createMemoryHandleForTest(
  persistence: MemoryPersistence,
  owner: User,
  docId: string,
): Promise<DocHandle> {
  return create(persistence, owner, docId)
}
