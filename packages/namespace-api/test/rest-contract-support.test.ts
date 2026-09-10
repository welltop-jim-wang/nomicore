/**
 * SA6 契约支撑负控 / fixture 有效性锚（issue #267，恒绿基线段）。
 *
 * 目的：REST router 模块缺失（feature 能力缺口）导致的红灯，必须只能归因于
 * `@nomicore/namespace-api/rest` 本身，而不是契约 fixture、Registry/Persistence
 * 适配器、VFSL 派生接口或 Request 构造。本文件不 import router 模块，只亲证：
 *
 * 1. `deriveSchemaIdentity(SCHEMA_TEXT)` 在 #266 已交付接口上可 ok，且 sc1- 形状
 *    与契约断言一致（REST 契约的 schema identity 锚可满足）；
 * 2. 同一 create 输入直接经 Registry.create（step 7 的下游）在 MemoryPersistence 与
 *    FilePersistence 上成功：lease 可用、replication disabled、REPLICATION_NOT_ENABLED、
 *    release → released 通道、后续 open 读回 ROOT 与原文 SCHEMA.text；
 * 3. FilePersistence 重启后事实仍可 open（契约 AC3 durability 分支的底层能力）；
 * 4. 契约使用的 `Request` 构造是标准 Web Request（url/method/headers/body 可读）。
 *
 * 本文件在当前 HEAD 即绿；SA3 落地 router 后仍须恒绿（不得因实现引入回归）。
 * 红基线锚：清空 `packages/namespace-api/src/` 后本文件仍 5/5 绿（红灯只落在行为契约
 * 与 seam 接线两处），证明红灯不来自 fixture / Persistence / VFSL 接口 / Request 构造。
 */
import { describe, expect, it } from 'vitest';
import { deriveSchemaIdentity } from '@nomicore/vfsl';
import {
  NAMESPACE_ID_PATTERN,
  OWNER_USER_ID,
  ROOT_VALUE,
  SC1_ID_PATTERN,
  SCHEMA_TEXT,
  createContractRegistry,
  createFileFixture,
  createMemoryFixture,
  jsonRequest,
  type PersistenceFixture,
} from './rest-contract-harness.js';

type AdapterFactory = () => Promise<PersistenceFixture>;

function schemaEnvelope(): { lang: string; version: number; id: string; text: string } {
  const derived = deriveSchemaIdentity(SCHEMA_TEXT);
  expect(derived.ok).toBe(true);
  if (!derived.ok) throw new Error('契约前置失败：deriveSchemaIdentity 不 ok');
  return { lang: 'vfsl', version: 1, id: derived.schemaId, text: SCHEMA_TEXT };
}

function runSupportContract(adapterName: string, factory: AdapterFactory): void {
  describe(`issue #267 契约支撑（${adapterName}）`, () => {
    it('Registry.create 直接消费同一 SCHEMA envelope/root：lease、release、open、replication 默认', async () => {
      const fixture = await factory();
      const registry = createContractRegistry(fixture.persistence);
      try {
        const envelope = schemaEnvelope();
        expect(envelope.id).toMatch(SC1_ID_PATTERN);
        const created = await registry.create({
          owner: { userId: OWNER_USER_ID },
          schema: envelope,
          root: ROOT_VALUE,
        });
        expect(created.ok).toBe(true);
        if (!created.ok) throw new Error(`契约前置失败：create 失败 ${created.code}`);
        expect(created.lease.namespaceId).toMatch(NAMESPACE_ID_PATTERN);

        const status = created.lease.getStatus();
        expect(status.lease).toBe('active');
        if (status.lease !== 'active') throw new Error('契约前置失败：lease 非 active');
        expect(status.runtime.replication).toEqual({ state: 'disabled' });
        const session = await created.lease.openReplicationSession({
          localRole: 'hub',
          remoteInstanceId: 'remote-peer-1',
        });
        expect(session).toMatchObject({ ok: false, code: 'REPLICATION_NOT_ENABLED' });

        await fixture.flush();
        await created.lease.release();
        expect(created.lease.getStatus()).toEqual({ lease: 'released', runtime: null });

        const opened = await registry.open({ userId: OWNER_USER_ID }, created.lease.namespaceId);
        expect(opened.ok).toBe(true);
        if (!opened.ok) throw new Error(`契约前置失败：open 失败 ${opened.code}`);
        expect(opened.lease.readData(['title'])).toEqual({ ok: true, value: 'hello' });
        expect(opened.lease.getSchema()).toEqual(envelope);
        await opened.lease.release();
      } finally {
        await registry.shutdown();
        await fixture.dispose();
        await fixture.cleanup();
      }
    });

    if (adapterName === 'FilePersistence') {
      it('FilePersistence 重启后同一 namespace 仍可 open（契约 durability 下限能力）', async () => {
        const fixture = await factory();
        const registry = createContractRegistry(fixture.persistence);
        let restarted: PersistenceFixture | undefined;
        let reopenedRegistry: ReturnType<typeof createContractRegistry> | undefined;
        try {
          const envelope = schemaEnvelope();
          const created = await registry.create({
            owner: { userId: OWNER_USER_ID },
            schema: envelope,
            root: ROOT_VALUE,
          });
          expect(created.ok).toBe(true);
          if (!created.ok) throw new Error(`契约前置失败：create 失败 ${created.code}`);
          const namespaceId = created.lease.namespaceId;
          await created.lease.release();
          await fixture.flush();
          await registry.shutdown();
          await fixture.dispose();
          restarted = fixture.restart();
          reopenedRegistry = createContractRegistry(restarted.persistence);
          const reopened = await reopenedRegistry.open({ userId: OWNER_USER_ID }, namespaceId);
          expect(reopened.ok).toBe(true);
          if (!reopened.ok) throw new Error(`契约前置失败：重启后 open 失败 ${reopened.code}`);
          expect(reopened.lease.readData(['title'])).toEqual({ ok: true, value: 'hello' });
          expect(reopened.lease.getSchema()).toEqual(envelope);
          await reopened.lease.release();
        } finally {
          if (reopenedRegistry !== undefined) await reopenedRegistry.shutdown();
          if (restarted !== undefined) await restarted.dispose();
          await fixture.dispose();
          await fixture.cleanup();
        }
      });
    }
  });
}

runSupportContract('MemoryPersistence', async () => createMemoryFixture());
runSupportContract('FilePersistence', createFileFixture);

describe('issue #267 契约输入锚', () => {
  it('契约 Request 是标准 Web Request，body 为契约 JSON（fixture 自证）', async () => {
    const request = jsonRequest();
    expect(request.method).toBe('POST');
    expect(new URL(request.url).pathname).toBe('/v1/owners/rest-contract-owner/namespaces');
    expect(request.headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(await request.text())).toEqual({ schemaText: SCHEMA_TEXT, root: ROOT_VALUE });
  });

  it('percent-encoded owner 片段在 Request URL 中保持 raw 形态（role gate 顺序用例输入可满足）', () => {
    const request = jsonRequest('http://localhost/v1/owners/%61lice/namespaces');
    expect(new URL(request.url).pathname).toBe('/v1/owners/%61lice/namespaces');
  });
});
