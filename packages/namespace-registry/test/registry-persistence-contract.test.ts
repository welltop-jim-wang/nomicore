import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FilePersistence,
  createMemoryPersistence,
  type DocPersistence,
} from '@nomicore/persistence';
import { createTestScheduler } from '@nomicore/persistence/testing';
import { createNamespaceRegistryForTesting, createRegistryTestScheduler } from '@nomicore/namespace-registry/testing';

const SCHEMA = {
  lang: 'vfsl',
  version: 1,
  id: 'registry-contract',
  text: 'type ROOT = { value: string; };\n',
} as const;

interface AdapterFixture {
  readonly persistence: DocPersistence;
  flush(): Promise<void>;
  dispose(): Promise<void>;
  restart(): Promise<AdapterFixture>;
}

type AdapterFactory = () => Promise<AdapterFixture>;

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const memoryFactory: AdapterFactory = async () => {
  const scheduler = createTestScheduler();
  const persistence = createMemoryPersistence({ scheduler, schedule: { debounceMs: 1, maxDirtyMs: 1 } });
  return {
    persistence,
    flush: () => scheduler.advanceBy(1_000),
    dispose: () => persistence.dispose(),
    restart: async () => {
      throw new Error('MemoryPersistence has no durable restart contract');
    },
  };
};

const fileFactory: AdapterFactory = async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'nomicore-registry-contract-'));
  roots.push(rootDir);
  const make = (): AdapterFixture => {
    const scheduler = createTestScheduler();
    const persistence = new FilePersistence({ rootDir, scheduler, schedule: { debounceMs: 1, maxDirtyMs: 1 } });
    return {
      persistence,
      flush: () => scheduler.advanceBy(1_000),
      dispose: () => persistence.dispose(),
      restart: async () => make(),
    };
  };
  return make();
};

function registry(persistence: DocPersistence) {
  return createNamespaceRegistryForTesting(persistence, {
    clock: { now: () => Date.UTC(2026, 0, 2, 3, 4, 5) },
    scheduler: createRegistryTestScheduler(),
  });
}

function runRegistryContract(name: string, factory: AdapterFactory): void {
  describe(`${name} NamespaceRegistry contract`, () => {
    it('creates, shares one Runtime across leases, closes, and reopens persisted state', async () => {
      const fixture = await factory();
      const firstRegistry = registry(fixture.persistence);
      const created = await firstRegistry.create({
        owner: { userId: 'contract-user' },
        namespaceId: 'contract-doc',
        schema: SCHEMA,
        root: { value: 'created' },
      });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error(created.message);

      const second = await firstRegistry.open({ userId: 'contract-user' }, 'contract-doc');
      expect(second.ok).toBe(true);
      if (!second.ok) throw new Error(second.message);
      expect(second.lease.read(['value'])).toEqual({ ok: true, value: 'created' });

      const write = created.lease.mutateRoot({ op: 'set', path: ['value'], value: 'updated' });
      await expect(write).resolves.toMatchObject({ ok: true });
      expect(second.lease.read(['value'])).toEqual({ ok: true, value: 'updated' });
      await fixture.flush();

      await created.lease.release();
      await second.lease.release();
      await firstRegistry.shutdown();
      await fixture.dispose();

      if (name === 'FilePersistence') {
        const restarted = await fixture.restart();
        const reopenedRegistry = registry(restarted.persistence);
        const reopened = await reopenedRegistry.open({ userId: 'contract-user' }, 'contract-doc');
        expect(reopened.ok).toBe(true);
        if (!reopened.ok) throw new Error(reopened.message);
        expect(reopened.lease.read(['value'])).toEqual({ ok: true, value: 'created' });
        await reopened.lease.release();
        await reopenedRegistry.shutdown();
        await restarted.dispose();
      }
    });
  });
}

runRegistryContract('MemoryPersistence', memoryFactory);
runRegistryContract('FilePersistence', fileFactory);
