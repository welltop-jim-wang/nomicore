import { describe, expect, it } from 'vitest'
import type { DocHandle, DocPersistence, User } from './index.js'

/**
 * The factory shape shared by every persistence adapter's contract test.
 *
 * Adapters may accept configuration in their own test setup; the factory here
 * only exposes the ready-to-exercise `DocPersistence` face. `createHandle()`
 * deliberately belongs to the harness context because v1's public interface
 * has no `createDoc()` method: adapters can expose a test-only creation path
 * without widening the production contract.
 */
export interface DocPersistenceContractFixture {
  readonly persistence: DocPersistence
  createHandle(user: User, docId: string): Promise<DocHandle>
}

export type DocPersistenceContractFactory = () => Promise<DocPersistenceContractFixture> | DocPersistenceContractFixture

/**
 * Reusable P2/P3 contract suite for lease-owning persistence adapters.
 *
 * It locks the persistence seam without prescribing any storage implementation.
 * P2 MemoryPersistence and P3 FilePersistence must invoke this suite against
 * their own factories.
 */
export function describeDocPersistenceContract(
  factory: DocPersistenceContractFactory,
): void {
  const user: User = { userId: 'contract-user' }
  const docId = 'contract-doc'

  describe('DocPersistence lease contract', () => {
    it('returns independent handles sharing one live Y.Doc', async () => {
      const { persistence, createHandle } = await factory()
      const seeded = await createHandle(user, docId)
      await persistence.saveDoc(seeded)
      await seeded.release()

      const first = await persistence.loadDoc(user, docId)
      const second = await persistence.loadDoc(user, docId)

      expect(first).not.toBeNull()
      expect(second).not.toBeNull()
      expect(first).not.toBe(second)
      expect(first!.doc).toBe(second!.doc)

      await first!.release()
      await second!.release()
    })

    it('makes release idempotent and does not invalidate another handle', async () => {
      const { persistence, createHandle } = await factory()
      const seeded = await createHandle(user, docId)
      await persistence.saveDoc(seeded)
      await seeded.release()

      const first = await persistence.loadDoc(user, docId)
      const second = await persistence.loadDoc(user, docId)
      expect(first).not.toBeNull()
      expect(second).not.toBeNull()

      await expect(first!.release()).resolves.toBeUndefined()
      await expect(first!.release()).resolves.toBeUndefined()
      await expect(persistence.saveDoc(second!)).resolves.toBeUndefined()

      await second!.release()
    })

    it('rejects foreign and released handles passed to saveDoc', async () => {
      const first = await factory()
      const second = await factory()
      const handle = await first.createHandle(user, docId)

      await expect(second.persistence.saveDoc(handle)).rejects.toThrow()
      await handle.release()
      await expect(first.persistence.saveDoc(handle)).rejects.toThrow()
    })
  })
}
