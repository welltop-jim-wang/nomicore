/**
 * SA6 验收契约支撑 / 负控绿锚 — issue #269。
 *
 * 本文件**不 import REST router**，因此在能力缺口存在时也恒绿；它证明 #269 契约的
 * 全部故障输入都是真实、可确定性产生的运行时事实，并从反面排除「红灯来自
 * fixture/环境错误」：
 *
 * - 真实 `NamespaceRegistry`（MemoryPersistence）能产出 `REGISTRY_NOT_ACCEPTING`、
 *   typed operational failure（`NAMESPACE_CREATE_FAILED`）与两类
 *   `NamespaceRegistryFatalError`（committed:false / committed:true）；
 * - committed:true fatal 的提交事实可被**另一个 registry 实例** open 读回（诚实提交）；
 * - Node 24 的 `Request` abort 语义（pre-aborted + 完整 body 时 `request.json()`
 *   仍 resolve；mid-read abort 不会使进行中的读自行结算）——因此「body 读取阶段尊重
 *   `Request.signal`」必须由 router 显式观察 signal，而不能依赖平台拒绝；
 * - 观测探针本身有判别力（recorder 捕获实参、零触达探针记录调用、probe wrapper 委派
 *   真实成功路径）。
 */
import { describe, expect, it } from 'vitest';
import { deriveSchemaIdentity } from '@nomicore/vfsl';
import { NamespaceRegistryFatalError } from '@nomicore/namespace-registry';
import type { CreateNamespaceInput, NamespaceRegistry } from '@nomicore/namespace-registry';
import {
  createContractRegistry,
  createMemoryFixture,
  ROOT_VALUE,
  SCHEMA_TEXT,
} from './rest-contract-harness.js';
import {
  CAUSE_SENTINEL,
  createFaultInjectedRegistry,
  createMidReadAbortRequest,
  createObserverRecorder,
  createOperationalFailurePersistence,
  createProbeRegistry,
  createZeroTouchRegistry,
  OWNER_SENTINEL,
} from './rest-failure-contract-harness.js';

function createInput(): CreateNamespaceInput {
  const derived = deriveSchemaIdentity(SCHEMA_TEXT);
  if (!derived.ok) throw new Error('契约前置失败：deriveSchemaIdentity 对契约文本不 ok');
  return {
    owner: { userId: OWNER_SENTINEL },
    schema: { lang: 'vfsl', version: 1, id: derived.schemaId, text: SCHEMA_TEXT },
    root: ROOT_VALUE,
  };
}

async function settleCreate(registry: NamespaceRegistry, input: CreateNamespaceInput) {
  return registry.create(input).then(
    (result) => ({ kind: 'resolved' as const, result }),
    (error: unknown) => ({ kind: 'rejected' as const, error }),
  );
}

describe('issue #269 支撑绿锚：真实 Registry 故障面', () => {
  it('REGISTRY_NOT_ACCEPTING：运行期 create 可用；shutdown 后 create 窄拒绝且状态 stopped', async () => {
    const fixture = createMemoryFixture();
    const registry = createContractRegistry(fixture.persistence);
    const input = createInput();
    try {
      const before = await settleCreate(registry, input);
      expect(before.kind).toBe('resolved');
      if (before.kind !== 'resolved' || !before.result.ok) throw new Error('契约前置失败：首次 create 未成功');

      await registry.shutdown();
      const after = await settleCreate(registry, input);
      expect(after.kind).toBe('resolved');
      if (after.kind !== 'resolved') throw new Error('契约前置失败：shutdown 后 create 未 resolve 窄结果');
      expect(after.result).toMatchObject({ ok: false, code: 'REGISTRY_NOT_ACCEPTING' });
      expect(registry.getStatus()).toEqual({ state: 'stopped' });
    } finally {
      await registry.shutdown();
      await fixture.dispose();
      await fixture.cleanup();
    }
  });

  it('typed operational failure：persistence DocCreateOperationalError → 真实 Registry 返回 NAMESPACE_CREATE_FAILED', async () => {
    const fixture = createMemoryFixture();
    const registry = createContractRegistry(createOperationalFailurePersistence(fixture.persistence));
    try {
      const outcome = await settleCreate(registry, createInput());
      expect(outcome.kind).toBe('resolved');
      if (outcome.kind !== 'resolved') throw new Error('契约前置失败：operational failure 未走窄结果通道');
      expect(outcome.result).toMatchObject({ ok: false, code: 'NAMESPACE_CREATE_FAILED' });
    } finally {
      await registry.shutdown();
      await fixture.dispose();
      await fixture.cleanup();
    }
  });

  it('fatal committed:false：create-document 内部 throw → 真实 Registry 拒绝 NamespaceRegistryFatalError(committed:false)', async () => {
    const fixture = createMemoryFixture();
    const faulted = createFaultInjectedRegistry(fixture.persistence, 'create-document-internal');
    try {
      const outcome = await settleCreate(faulted.registry, createInput());
      expect(outcome.kind).toBe('rejected');
      if (outcome.kind !== 'rejected') throw new Error('契约前置失败：内部故障未走 rejection 通道');
      const fatal = outcome.error;
      expect(fatal).toBeInstanceOf(NamespaceRegistryFatalError);
      const branded = fatal as NamespaceRegistryFatalError;
      expect(branded.operation).toBe('create');
      expect(branded.phase).toBe('create-document-internal');
      expect(branded.committed).toBe(false);
      expect(String((branded.cause as Error | undefined)?.message)).toContain(CAUSE_SENTINEL);
    } finally {
      await faulted.registry.shutdown();
      await fixture.dispose();
      await fixture.cleanup();
    }
  });

  it('fatal committed:true：runtime 构造 throw 且已提交事实可被另一 registry open 读回', async () => {
    const fixture = createMemoryFixture();
    const faulted = createFaultInjectedRegistry(fixture.persistence, 'runtime-construction');
    let verifier: NamespaceRegistry | undefined;
    try {
      const outcome = await settleCreate(faulted.registry, createInput());
      expect(outcome.kind).toBe('rejected');
      if (outcome.kind !== 'rejected') throw new Error('契约前置失败：runtime 构造故障未走 rejection 通道');
      const branded = outcome.error as NamespaceRegistryFatalError;
      expect(branded).toBeInstanceOf(NamespaceRegistryFatalError);
      expect(branded.operation).toBe('create');
      expect(branded.phase).toBe('runtime-construction');
      expect(branded.committed).toBe(true);

      const committedNamespaceId = faulted.committedNamespaceId();
      expect(committedNamespaceId).toMatch(/^ns-[0-9a-f]{32}$/);
      if (committedNamespaceId === undefined) throw new Error('契约前置失败：未捕获已提交 namespaceId');

      await fixture.flush();
      await faulted.registry.shutdown();
      verifier = createContractRegistry(fixture.persistence);
      const opened = await verifier.open({ userId: OWNER_SENTINEL }, committedNamespaceId);
      expect(opened.ok).toBe(true);
      if (!opened.ok) throw new Error(`契约前置失败：已提交 namespace 无法 open（${opened.code}）`);
      expect(opened.lease.readData(['title'])).toEqual({ ok: true, value: 'hello' });
      await opened.lease.release();
    } finally {
      if (verifier !== undefined) await verifier.shutdown();
      await faulted.registry.shutdown();
      await fixture.dispose();
      await fixture.cleanup();
    }
  });
});

describe('issue #269 支撑绿锚：Request abort 运行时事实与探针判别力', () => {
  it('pre-aborted signal + 完整 body：platform 的 request.json() 仍 resolve（router 必须显式观察 signal）', async () => {
    const controller = new AbortController();
    const request = new Request('http://localhost/v1/owners/o/namespaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ schemaText: SCHEMA_TEXT, root: ROOT_VALUE }),
      signal: controller.signal,
    });
    controller.abort();
    expect(request.signal.aborted).toBe(true);
    const raw: unknown = await request.json();
    expect(raw).toMatchObject({ schemaText: SCHEMA_TEXT });
  });

  it('mid-read abort：读已开始（pull>0）后取消 signal，进行中的读不 resolve（有界观察）', async () => {
    const probe = createMidReadAbortRequest();
    const read = probe.request.json().then(
      (value) => ({ kind: 'resolved' as const, value }),
      (error: unknown) => ({ kind: 'rejected' as const, error }),
    );
    try {
      const deadline = Date.now() + 2_000;
      while (probe.pulls() === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      expect(probe.pulls()).toBeGreaterThan(0);
      probe.controller.abort();
      expect(probe.request.signal.aborted).toBe(true);
      const bounded = await Promise.race([
        read,
        new Promise<Readonly<{ kind: 'pending' }>>((resolve) => {
          setTimeout(() => resolve({ kind: 'pending' }), 200);
        }),
      ]);
      expect(bounded.kind).not.toBe('resolved');
    } finally {
      await probe.cancel();
      await read.catch(() => undefined);
    }
  });

  it('recorder 探针捕获首个实参（含零参调用 → undefined），具有判别力', () => {
    const recorder = createObserverRecorder();
    recorder.fn({ outcome: 'succeeded' });
    recorder.fn();
    expect(recorder.events()).toEqual([{ outcome: 'succeeded' }, undefined]);
  });

  it('零触达探针记录成员调用并 throw（探针本身敏感，不会恒空）', () => {
    const probe = createZeroTouchRegistry();
    expect(probe.invocations).toEqual([]);
    expect(() => probe.registry.create(createInput())).toThrow(/零触达/);
    expect(probe.invocations).toEqual(['create']);
  });

  it('probe wrapper 委派真实成功路径（201 语义所需 lease 与 release 计数不变）', async () => {
    const fixture = createMemoryFixture();
    const registry = createContractRegistry(fixture.persistence);
    const probe = createProbeRegistry(registry);
    try {
      const outcome = await settleCreate(probe.registry, createInput());
      expect(outcome.kind).toBe('resolved');
      if (outcome.kind !== 'resolved' || !outcome.result.ok) {
        throw new Error('契约前置失败：probe wrapper 未委派成功路径');
      }
      expect(probe.observation.createCalls).toBe(1);
      expect(probe.observation.releaseCalls).toBe(0);
      await outcome.result.lease.release();
      expect(probe.observation.releaseCalls).toBe(1);
      expect(outcome.result.lease.namespaceId).toMatch(/^ns-[0-9a-f]{32}$/);
    } finally {
      await registry.shutdown();
      await fixture.dispose();
      await fixture.cleanup();
    }
  });
});
