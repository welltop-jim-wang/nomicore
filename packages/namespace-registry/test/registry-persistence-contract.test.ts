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

/** 确定性计数源（第 n 次生成 = `ns-` + n 的 32 位 hex；本文件仅 create 一处消耗）。 */
function makeDeterministicRandomBytes(): { randomBytes: (length: number) => Uint8Array } {
  let counter = 0;
  return {
    randomBytes(length: number): Uint8Array {
      if (length !== 16) {
        throw new Error(`受控随机源必须按 128-bit（16 字节）请求，实际请求 ${length} 字节`);
      }
      counter += 1;
      const hex = counter.toString(16).padStart(32, '0');
      const out = new Uint8Array(16);
      for (let i = 0; i < 16; i += 1) {
        out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      }
      return out;
    },
  };
}

function registry(persistence: DocPersistence) {
  return createNamespaceRegistryForTesting(persistence, {
    clock: { now: () => Date.UTC(2026, 0, 2, 3, 4, 5) },
    scheduler: createRegistryTestScheduler(),
    randomBytes: makeDeterministicRandomBytes().randomBytes,
  });
}

function runRegistryContract(name: string, factory: AdapterFactory): void {
  describe(`${name} NamespaceRegistry contract`, () => {
    it('creates, shares one Runtime across leases, closes, and reopens persisted state', async () => {
      const fixture = await factory();
      const firstRegistry = registry(fixture.persistence);
      const created = await firstRegistry.create({
        owner: { userId: 'contract-user' },
        schema: SCHEMA,
        root: { value: 'created' },
      });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error(created.message);
      // phase-5 切片 1（ADR 0010）：namespaceId 由 Registry 注入随机源生成——契约面
      // 更诚实的传递手法：经 lease.namespaceId 回读后传给 open/重开。
      const createdId = created.lease.namespaceId;
      expect(createdId).toMatch(/^ns-[0-9a-f]{32}$/);

      const second = await firstRegistry.open({ userId: 'contract-user' }, createdId);
      expect(second.ok).toBe(true);
      if (!second.ok) throw new Error(second.message);
      expect(second.lease.readData(['value'])).toEqual({ ok: true, value: 'created' });

      const write = created.lease.mutateData({ op: 'set', path: ['value'], value: 'updated' });
      await expect(write).resolves.toMatchObject({ ok: true });
      expect(second.lease.readData(['value'])).toEqual({ ok: true, value: 'updated' });
      await fixture.flush();

      await created.lease.release();
      await second.lease.release();
      await firstRegistry.shutdown();
      await fixture.dispose();

      if (name === 'FilePersistence') {
        const restarted = await fixture.restart();
        const reopenedRegistry = registry(restarted.persistence);
        const reopened = await reopenedRegistry.open({ userId: 'contract-user' }, createdId);
        expect(reopened.ok).toBe(true);
        if (!reopened.ok) throw new Error(reopened.message);
        expect(reopened.lease.readData(['value'])).toEqual({ ok: true, value: 'created' });
        await reopened.lease.release();
        await reopenedRegistry.shutdown();
        await restarted.dispose();
      }
    });
  });
}

runRegistryContract('MemoryPersistence', memoryFactory);
runRegistryContract('FilePersistence', fileFactory);
