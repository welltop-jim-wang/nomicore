/**
 * SA6 验收契约（Feature 红灯固化）— issue #267：Hub REST create 成功路径 +
 * Lease 生命周期 + 持久化 seam + replication 默认。
 *
 * 契约来源（逐条对应见 SA6 报告 §12）：
 * - 任务简报 `wiki/raw/task_issue-267.md` AC1/AC3/AC4/AC5；
 * - ADR 0015 §HTTP 契约 L45-90（201 恰含 namespaceId + schema{lang,version,id}、
 *   无 Location）、§执行顺序与 Lease L146-161（step 7-10：Registry.create →
 *   复制 DTO → 恰一次 release → Response）、§内容寻址 schema ID L119-144、
 *   §测试决策 L192-196（最高 seam = Request → Response；同一契约在
 *   MemoryPersistence 与 FilePersistence 上运行；不读 Registry 内部 entry map /
 *   Runtime / Y.Doc 私有对象）、§受信环境与角色 L43（默认 replication-disabled）；
 * - ADR 0010 #134 修订节 O-7（未安装复制身份 → open 后 REPLICATION_NOT_ENABLED）
 *   与 L241（replication 恒两态 disabled|enabled）。
 *
 * 契约假设（PROPOSAL，供 SA1/SA2 仲裁；若设计另有裁决须回写本文件并走修订轮）：
 * - H1：`@nomicore/namespace-api/rest` 导出 `createRestRouter(options)`，
 *   `options = { role, registry, metricsObserver, diagnosticObserver, limits? }`
 *   （ADR 0015 L22-28 五项构造注入；role ∈ {'hub','peer'}）；
 * - H2：`router.handle(request)` → `Promise<{matched:false} |
 *   {matched:true; response}>`（ADR 0015 L32「判别结果表达 route 是否匹配」）；
 * - H3：subpath `./rest` 背后的模块文件为 `packages/namespace-api/src/rest.ts`
 *   （镜像既有包 `src/testing.ts` 承载 `./testing` 的布局惯例）；
 * - H4：response schema identity 取自 step 6 派生的 envelope（201 不等待 Runtime
 *   P0 ready），namespaceId 取自 Registry.create 返回的 lease。
 *
 * 状态（iteration 1）：`packages/namespace-api/src/rest.ts` 尚不存在（ADR 0015 待兑现），
 * 本文件静态 import `../src/rest.js` 失败 → 整文件构造性红灯（同 #266 窄接口契约先例）；
 * SA3 落地模块后应整体转绿。证据链（SA6 报告 §9/§13）：同一契约在临时「未来绿灯
 * 模拟件」下 34/34 绿（可满足性）、10 例定点变异全部被目标断言捕获（敏感性）、模拟件
 * 已清理、红灯基线 3/3 复跑一致。断言全部为运行时行为（HTTP 状态/形状/值、Registry
 * 公共 seam 输入、lease 可观察状态），无任何源码文本/正则替代断言。
 */
import { describe, expect, it } from 'vitest';
import { deriveSchemaIdentity } from '@nomicore/vfsl';
import type { NamespaceRegistry } from '@nomicore/namespace-registry';
import { createRestRouter } from '../src/rest.js';
import {
  CREATE_URL,
  NAMESPACE_ID_PATTERN,
  OWNER_USER_ID,
  RELEASED_NAMESPACE_ID_SENTINEL,
  ROOT_VALUE,
  SC1_ID_PATTERN,
  SCHEMA_TEXT,
  createContractRegistry,
  createFileFixture,
  createMemoryFixture,
  createObservingRegistry,
  jsonRequest,
  matchedResponse,
  type PersistenceFixture,
} from './rest-contract-harness.js';

const NOOP_OBSERVER = (): void => {};

interface SuccessResponseBody {
  readonly namespaceId: string;
  readonly schema: Readonly<{ lang: unknown; version: unknown; id: string }>;
}

/** 201 成功 response 契约（AC1 + ADR L77-90）：形状、键集、无 Location、sc1- id。 */
async function assertSuccessResponse(response: Response): Promise<SuccessResponseBody> {
  expect(response.status).toBe(201);
  expect(response.headers.get('content-type')).toMatch(/^application\/json/);
  expect(response.headers.get('location')).toBeNull();
  const raw: unknown = await response.json();
  expect(raw !== null && typeof raw === 'object' && !Array.isArray(raw)).toBe(true);
  const body = raw as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual(['namespaceId', 'schema']);
  expect(typeof body['namespaceId']).toBe('string');
  expect(body['namespaceId']).toMatch(NAMESPACE_ID_PATTERN);
  const schema = body['schema'];
  expect(schema !== null && typeof schema === 'object').toBe(true);
  expect(Object.keys(schema as Record<string, unknown>).sort()).toEqual(['id', 'lang', 'version']);
  expect((schema as Record<string, unknown>)['lang']).toBe('vfsl');
  expect((schema as Record<string, unknown>)['version']).toBe(1);
  expect((schema as Record<string, unknown>)['id']).toMatch(SC1_ID_PATTERN);
  return {
    namespaceId: body['namespaceId'] as string,
    schema: {
      lang: (schema as Record<string, unknown>)['lang'],
      version: (schema as Record<string, unknown>)['version'],
      id: (schema as Record<string, unknown>)['id'] as string,
    },
  };
}

function hubRouter(registry: NamespaceRegistry) {
  return createRestRouter({
    role: 'hub',
    registry,
    metricsObserver: NOOP_OBSERVER,
    diagnosticObserver: NOOP_OBSERVER,
  });
}

type AdapterFactory = () => Promise<PersistenceFixture>;

function runHubCreateContract(adapterName: string, factory: AdapterFactory): void {
  describe(`issue #267 Hub REST create 契约（${adapterName}）`, () => {
    it('AC1: 201 response 恰含 namespaceId 与 schema identity（sc1-），不返回 Location', async () => {
      const fixture = await factory();
      const registry = createContractRegistry(fixture.persistence);
      try {
        const router = hubRouter(registry);
        const response = matchedResponse(await router.handle(jsonRequest(CREATE_URL)));
        const body = await assertSuccessResponse(response);
        const derived = deriveSchemaIdentity(SCHEMA_TEXT);
        expect(derived.ok).toBe(true);
        if (!derived.ok) throw new Error('契约前置失败：deriveSchemaIdentity 对契约文本不 ok');
        expect(body.schema.id).toBe(derived.schemaId);
      } finally {
        await registry.shutdown();
        await fixture.dispose();
        await fixture.cleanup();
      }
    });

    it('AC1: Registry.create 恰一次收到 {owner, 完整 SCHEMA envelope, root}（step 6-7）', async () => {
      const fixture = await factory();
      const registry = createContractRegistry(fixture.persistence);
      const observing = createObservingRegistry(registry);
      try {
        const router = hubRouter(observing.registry);
        const response = matchedResponse(await router.handle(jsonRequest(CREATE_URL)));
        const body = await assertSuccessResponse(response);
        expect(observing.observation.createInputs).toHaveLength(1);
        expect(observing.observation.createInputs[0]).toEqual({
          owner: { userId: OWNER_USER_ID },
          schema: { lang: 'vfsl', version: 1, id: body.schema.id, text: SCHEMA_TEXT },
          root: ROOT_VALUE,
        });
      } finally {
        await registry.shutdown();
        await fixture.dispose();
        await fixture.cleanup();
      }
    });

    it('AC4: lease.release 恰一次且 lease 真进入 released 通道', async () => {
      const fixture = await factory();
      const registry = createContractRegistry(fixture.persistence);
      const observing = createObservingRegistry(registry);
      try {
        const router = hubRouter(observing.registry);
        const response = matchedResponse(await router.handle(jsonRequest(CREATE_URL)));
        await assertSuccessResponse(response);
        expect(observing.observation.releaseCalls).toBe(1);
        const lease = observing.observation.underlyingLease;
        if (lease === undefined) throw new Error('契约前置失败：Registry.create 未返回 lease');
        expect(lease.getStatus()).toEqual({ lease: 'released', runtime: null });
      } finally {
        await registry.shutdown();
        await fixture.dispose();
        await fixture.cleanup();
      }
    });

    it('AC4/step 9: Response 在 lease.release() settle 之后才返回（等待 release）', async () => {
      const fixture = await factory();
      const registry = createContractRegistry(fixture.persistence);
      let releaseGateResolve!: () => void;
      const releaseGate = new Promise<void>((resolve) => {
        releaseGateResolve = resolve;
      });
      const observing = createObservingRegistry(registry, { releaseGate });
      try {
        const router = hubRouter(observing.registry);
        let settled = false;
        const pending = router.handle(jsonRequest(CREATE_URL)).then((result) => {
          settled = true;
          return result;
        });
        void pending.catch(() => undefined); // 仅防未处理拒绝噪声，不改变断言语义
        const deadline = Date.now() + 5_000;
        while (observing.observation.releaseCalls === 0 && !settled && Date.now() < deadline) {
          await new Promise((resolve) => setImmediate(resolve));
        }
        expect(observing.observation.releaseCalls).toBe(1);
        expect(settled).toBe(false);
        releaseGateResolve();
        const response = matchedResponse(await pending);
        expect((await assertSuccessResponse(response)).schema.id).toMatch(SC1_ID_PATTERN);
      } finally {
        releaseGateResolve();
        await registry.shutdown();
        await fixture.dispose();
        await fixture.cleanup();
      }
    });

    it('AC4: release 失败仍返回 201，且不重复调用 release', async () => {
      const fixture = await factory();
      const registry = createContractRegistry(fixture.persistence);
      const observing = createObservingRegistry(registry, {
        releaseFailure: new Error('injected lease release failure'),
      });
      try {
        const router = hubRouter(observing.registry);
        const response = matchedResponse(await router.handle(jsonRequest(CREATE_URL)));
        const body = await assertSuccessResponse(response);
        expect(observing.observation.releaseCalls).toBe(1);
        const lease = observing.observation.underlyingLease;
        if (lease === undefined) throw new Error('契约前置失败：Registry.create 未返回 lease');
        expect(lease.getStatus()).toEqual({ lease: 'released', runtime: null });
        expect(body.namespaceId).toMatch(NAMESPACE_ID_PATTERN);
      } finally {
        await registry.shutdown();
        await fixture.dispose();
        await fixture.cleanup();
      }
    });

    it('AC4/step 8: success DTO 在 release 前复制（release 后变异不进入 response）', async () => {
      const fixture = await factory();
      const registry = createContractRegistry(fixture.persistence);
      const observing = createObservingRegistry(registry, { mutateNamespaceIdOnRelease: true });
      try {
        const router = hubRouter(observing.registry);
        const response = matchedResponse(await router.handle(jsonRequest(CREATE_URL)));
        const body = await assertSuccessResponse(response);
        const lease = observing.observation.underlyingLease;
        if (lease === undefined) throw new Error('契约前置失败：Registry.create 未返回 lease');
        expect(body.namespaceId).not.toBe(RELEASED_NAMESPACE_ID_SENTINEL);
        expect(body.namespaceId).toBe(lease.namespaceId);
        const opened = await registry.open({ userId: OWNER_USER_ID }, body.namespaceId);
        expect(opened.ok).toBe(true);
        if (!opened.ok) throw new Error('契约前置失败：response namespaceId 无法 open');
        await opened.lease.release();
      } finally {
        await registry.shutdown();
        await fixture.dispose();
        await fixture.cleanup();
      }
    });

    it('AC3: 后续 Registry.open 读回持久化 ROOT 与原文 SCHEMA.text', async () => {
      const fixture = await factory();
      const registry = createContractRegistry(fixture.persistence);
      try {
        const router = hubRouter(registry);
        const response = matchedResponse(await router.handle(jsonRequest(CREATE_URL)));
        const body = await assertSuccessResponse(response);
        const opened = await registry.open({ userId: OWNER_USER_ID }, body.namespaceId);
        expect(opened.ok).toBe(true);
        if (!opened.ok) throw new Error(`契约前置失败：open 失败 ${opened.code}`);
        expect(opened.lease.readData(['title'])).toEqual({ ok: true, value: 'hello' });
        expect(opened.lease.getSchema()).toEqual({
          lang: 'vfsl',
          version: 1,
          id: body.schema.id,
          text: SCHEMA_TEXT,
        });
        await opened.lease.release();
      } finally {
        await registry.shutdown();
        await fixture.dispose();
        await fixture.cleanup();
      }
    });

    it('AC5: 新建 namespace 默认 replication-disabled（open 后稳定拒绝 REPLICATION_NOT_ENABLED）', async () => {
      const fixture = await factory();
      const registry = createContractRegistry(fixture.persistence);
      try {
        const router = hubRouter(registry);
        const response = matchedResponse(await router.handle(jsonRequest(CREATE_URL)));
        const body = await assertSuccessResponse(response);
        const opened = await registry.open({ userId: OWNER_USER_ID }, body.namespaceId);
        expect(opened.ok).toBe(true);
        if (!opened.ok) throw new Error(`契约前置失败：open 失败 ${opened.code}`);
        const status = opened.lease.getStatus();
        expect(status.lease).toBe('active');
        if (status.lease !== 'active') throw new Error('契约前置失败：lease 非 active');
        expect(status.runtime.replication).toEqual({ state: 'disabled' });
        const session = await opened.lease.openReplicationSession({
          localRole: 'hub',
          remoteInstanceId: 'remote-peer-1',
        });
        expect(session).toMatchObject({ ok: false, code: 'REPLICATION_NOT_ENABLED' });
        await opened.lease.release();
      } finally {
        await registry.shutdown();
        await fixture.dispose();
        await fixture.cleanup();
      }
    });

    if (adapterName === 'FilePersistence') {
      it('AC3: FilePersistence 重启后 namespace 与 SCHEMA 事实仍可 open（durability）', async () => {
        const fixture = await factory();
        const registry = createContractRegistry(fixture.persistence);
        let restarted: PersistenceFixture | undefined;
        let reopenedRegistry: NamespaceRegistry | undefined;
        try {
          const router = hubRouter(registry);
          const response = matchedResponse(await router.handle(jsonRequest(CREATE_URL)));
          const body = await assertSuccessResponse(response);
          await fixture.flush();
          await registry.shutdown();
          await fixture.dispose();
          restarted = fixture.restart();
          reopenedRegistry = createContractRegistry(restarted.persistence);
          const reopened = await reopenedRegistry.open({ userId: OWNER_USER_ID }, body.namespaceId);
          expect(reopened.ok).toBe(true);
          if (!reopened.ok) throw new Error(`契约前置失败：重启后 open 失败 ${reopened.code}`);
          expect(reopened.lease.readData(['title'])).toEqual({ ok: true, value: 'hello' });
          expect(reopened.lease.getSchema()).toEqual({
            lang: 'vfsl',
            version: 1,
            id: body.schema.id,
            text: SCHEMA_TEXT,
          });
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

runHubCreateContract('MemoryPersistence', async () => createMemoryFixture());
runHubCreateContract('FilePersistence', createFileFixture);
