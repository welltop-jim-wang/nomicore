/**
 * SA6 验收契约（Feature 红灯固化）— issue #269：Registry 失败映射
 * （503 / 500 FAILED / 500 OUTCOME_UNKNOWN / 500 INTERNAL_ERROR）。
 *
 * 契约来源（逐条对应见 SA6 报告 §12）：
 * - 任务简报 `wiki/raw/task_issue-269.md`「失败映射」+ AC1/AC2；
 * - ADR 0015 §错误契约 L163–182（L175 503 `REGISTRY_NOT_ACCEPTING`；L176 500
 *   `NAMESPACE_CREATE_FAILED`＝typed operational failure；L177 500
 *   `NAMESPACE_CREATE_OUTCOME_UNKNOWN`＝Registry fatal 且 committed:true；L178 500
 *   `INTERNAL_ERROR`＝unknown exception 或内部契约违例；L180 `NAMESPACE_CREATE_INVALID_INPUT`
 *   与 `NAMESPACE_ALREADY_EXISTS` 视为内部契约违例→安全 500 + diagnostic）；
 * - ADR 0009 §Create L70（createDoc 已提交而 Runtime 构造失败 → committed:true fatal，
 *   不得自动重试、后续可 open）、§Persistence 错误演进 L81（typed operational error 才映射
 *   公开 issue；fatal 保留 committed 事实）；
 * - ADR 0010 L28（普通 create 的 namespaceId 由 Registry 内部生成/处理碰撞，普通 REST
 *   create 不应返回 `NAMESPACE_ALREADY_EXISTS`）。
 *
 * **契约裁决（SA8 OBS-2 缺口，本契约钉死）**：Registry fatal 且 `committed:false`
 * （phase `create-document-internal` / `namespace-id-generation` / `lifecycle-slot-internal`
 * 等**提交前**内部故障）→ **500 `INTERNAL_ERROR`**。理由：`NAMESPACE_CREATE_FAILED`
 * 按 ADR L176/ADR 0009 L81 专属 typed operational failure（fatal 不是公开窄 issue）；
 * `NAMESPACE_CREATE_OUTCOME_UNKNOWN` 专属 committed:true；提交前 branded fatal 是
 * 内部服务故障，落入 L178 的残留类。该分支与 committed:true 分支共用同一注入形状、
 * 只以 committed 事实为唯一变量（§9 因果对照）。
 *
 * 未覆盖（边界声明，见报告 §12.4）：`NAMESPACE_SCHEMA_INVALID` / `NAMESPACE_ROOT_INVALID`
 * 的 422 映射属 #268（4xx/422 形状票）；本文件不断言该分支行为。
 *
 * 状态（iteration 0）：`packages/namespace-api` 骨架对上述非成功结局一律 rejection
 * （rest.ts L15–20 / AGENTS.md deferral 清单），因此本文件在目标断言处红灯；红灯只来自
 * 「失败映射能力缺失」这一能力缺口，故障输入全部由真实 Registry 产生（见
 * `rest-failure-contract-support.test.ts` 的恒绿锚）。
 */
import { describe, expect, it } from 'vitest';
import { NamespaceRegistryFatalError } from '@nomicore/namespace-registry';
import type { CreateNamespaceIssue } from '@nomicore/namespace-registry';
import { createRestRouter } from '../src/rest.js';
import {
  CREATE_URL,
  createContractRegistry,
  createMemoryFixture,
  jsonRequest,
  ROOT_VALUE,
  SCHEMA_TEXT,
} from './rest-contract-harness.js';
import {
  createFaultInjectedRegistry,
  createObserverRecorder,
  createOperationalFailurePersistence,
  createProbeRegistry,
  createZeroTouchRegistry,
  ISSUE_MESSAGE_SENTINEL,
  OWNER_SENTINEL,
  responseOf,
  settleHandle,
  type ObserverRecorder,
} from './rest-failure-contract-harness.js';

function hubRouter(registry: Parameters<typeof createRestRouter>[0]['registry'], metrics: ObserverRecorder, diagnostic: ObserverRecorder) {
  return createRestRouter({
    role: 'hub',
    registry,
    metricsObserver: metrics.fn,
    diagnosticObserver: diagnostic.fn,
  });
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`契约违例：${label} 不是 object（实际 ${JSON.stringify(value)}）`);
  }
  return value as Record<string, unknown>;
}

/** 读取错误 response：status 由调用方断言；返回 JSON body（恰读一次）。 */
async function errorBody(response: Response): Promise<Record<string, unknown>> {
  expect(response.headers.get('content-type')).toMatch(/^application\/json/);
  return asRecord(await response.json(), '错误 response body');
}

function expectNoSecretLeak(serialized: string, label: string): void {
  for (const secret of [OWNER_SENTINEL, SCHEMA_TEXT, JSON.stringify(ROOT_VALUE), ISSUE_MESSAGE_SENTINEL]) {
    expect(serialized, `${label} 泄漏敏感值`).not.toContain(secret);
  }
}

function fatalOf(observation: { readonly createSettlements: unknown[] }): NamespaceRegistryFatalError {
  const fatal = observation.createSettlements[0];
  expect(fatal).toBeInstanceOf(NamespaceRegistryFatalError);
  if (!(fatal instanceof NamespaceRegistryFatalError)) {
    throw new Error('契约前置失败：故障注入未产生 NamespaceRegistryFatalError');
  }
  return fatal;
}

function assertSingleMetricsEvent(
  metrics: ObserverRecorder,
  expectedOutcome: string,
  expectedCode: string | undefined,
): Record<string, unknown> {
  const events = metrics.events();
  expect(events).toHaveLength(1);
  const event = asRecord(events[0], 'metrics 事件');
  expect(event['outcome']).toBe(expectedOutcome);
  if (expectedCode !== undefined) expect(event['code']).toBe(expectedCode);
  return event;
}

function assertSingleDiagnosticCause(diagnostic: ObserverRecorder, expectedKind: string, cause: unknown): void {
  const events = diagnostic.events();
  expect(events).toHaveLength(1);
  const event = asRecord(events[0], 'diagnostic 事件');
  expect(event['kind']).toBe(expectedKind);
  expect(event['cause']).toBe(cause);
}

function injectedIssue(code: 'NAMESPACE_CREATE_INVALID_INPUT' | 'NAMESPACE_ALREADY_EXISTS'): CreateNamespaceIssue {
  return { ok: false, code, message: ISSUE_MESSAGE_SENTINEL } as unknown as CreateNamespaceIssue;
}

describe('issue #269 失败映射：503 unavailable（真实 Registry shutdown）', () => {
  it('REGISTRY_NOT_ACCEPTING → 503 + 稳定 code，零提交语义；metrics=unavailable；零 diagnostic', async () => {
    const fixture = createMemoryFixture();
    const registry = createContractRegistry(fixture.persistence);
    const metrics = createObserverRecorder();
    const diagnostic = createObserverRecorder();
    try {
      await registry.shutdown();
      const router = hubRouter(registry, metrics, diagnostic);
      const settlement = await settleHandle(router, jsonRequest(CREATE_URL));
      const response = responseOf(settlement);
      expect(response.status).toBe(503);
      const body = await errorBody(response);
      expect(body['code']).toBe('REGISTRY_NOT_ACCEPTING');
      expectNoSecretLeak(JSON.stringify(body), '503 body');

      assertSingleMetricsEvent(metrics, 'unavailable', 'REGISTRY_NOT_ACCEPTING');
      expect(diagnostic.events()).toHaveLength(0);
    } finally {
      await registry.shutdown();
      await fixture.dispose();
      await fixture.cleanup();
    }
  });
});

describe('issue #269 失败映射：500 三类（真实 fatal / 真实 typed operational failure / 注入内部违例与 unknown）', () => {
  it('typed operational failure（真实 DocCreateOperationalError）→ 500 NAMESPACE_CREATE_FAILED；零 diagnostic', async () => {
    const fixture = createMemoryFixture();
    const registry = createContractRegistry(createOperationalFailurePersistence(fixture.persistence));
    const metrics = createObserverRecorder();
    const diagnostic = createObserverRecorder();
    try {
      const router = hubRouter(registry, metrics, diagnostic);
      const settlement = await settleHandle(router, jsonRequest(CREATE_URL));
      const response = responseOf(settlement);
      expect(response.status).toBe(500);
      const body = await errorBody(response);
      expect(body['code']).toBe('NAMESPACE_CREATE_FAILED');
      expectNoSecretLeak(JSON.stringify(body), '500 FAILED body');

      assertSingleMetricsEvent(metrics, 'failed', 'NAMESPACE_CREATE_FAILED');
      expect(diagnostic.events()).toHaveLength(0);
    } finally {
      await registry.shutdown();
      await fixture.dispose();
      await fixture.cleanup();
    }
  });

  it('Registry fatal 且 committed:true（真实 runtime-construction fatal）→ 500 NAMESPACE_CREATE_OUTCOME_UNKNOWN + diagnostic Registry fatal', async () => {
    const fixture = createMemoryFixture();
    const faulted = createFaultInjectedRegistry(fixture.persistence, 'runtime-construction');
    const metrics = createObserverRecorder();
    const diagnostic = createObserverRecorder();
    try {
      const router = hubRouter(faulted.registry, metrics, diagnostic);
      const settlement = await settleHandle(router, jsonRequest(CREATE_URL));
      const fatal = fatalOf(faulted.observation);
      expect(fatal.committed).toBe(true); // 契约前置：真实注入产生 committed:true
      expect(faulted.committedNamespaceId()).toMatch(/^ns-[0-9a-f]{32}$/);

      const response = responseOf(settlement);
      expect(response.status).toBe(500);
      const body = await errorBody(response);
      expect(body['code']).toBe('NAMESPACE_CREATE_OUTCOME_UNKNOWN');
      expectNoSecretLeak(JSON.stringify(body), '500 OUTCOME_UNKNOWN body');

      assertSingleMetricsEvent(metrics, 'failed', 'NAMESPACE_CREATE_OUTCOME_UNKNOWN');
      assertSingleDiagnosticCause(diagnostic, 'registry-fatal', fatal);
      const event = asRecord(diagnostic.events()[0], 'diagnostic 事件');
      if (event['committed'] !== undefined) expect(event['committed']).toBe(true);
      if (event['phase'] !== undefined) expect(event['phase']).toBe('runtime-construction');
    } finally {
      await faulted.registry.shutdown();
      await fixture.dispose();
      await fixture.cleanup();
    }
  });

  it('Registry fatal 且 committed:false（真实 create-document-internal fatal）→ 500 INTERNAL_ERROR（非 FAILED、非 OUTCOME_UNKNOWN）+ diagnostic Registry fatal', async () => {
    const fixture = createMemoryFixture();
    const faulted = createFaultInjectedRegistry(fixture.persistence, 'create-document-internal');
    const metrics = createObserverRecorder();
    const diagnostic = createObserverRecorder();
    try {
      const router = hubRouter(faulted.registry, metrics, diagnostic);
      const settlement = await settleHandle(router, jsonRequest(CREATE_URL));
      const fatal = fatalOf(faulted.observation);
      expect(fatal.committed).toBe(false); // 契约前置：真实注入产生 committed:false

      const response = responseOf(settlement);
      expect(response.status).toBe(500);
      const body = await errorBody(response);
      expect(body['code']).toBe('INTERNAL_ERROR');
      expect(body['code']).not.toBe('NAMESPACE_CREATE_FAILED');
      expect(body['code']).not.toBe('NAMESPACE_CREATE_OUTCOME_UNKNOWN');
      expectNoSecretLeak(JSON.stringify(body), '500 INTERNAL_ERROR（fatal committed:false）body');

      assertSingleMetricsEvent(metrics, 'failed', 'INTERNAL_ERROR');
      assertSingleDiagnosticCause(diagnostic, 'registry-fatal', fatal);
      const event = asRecord(diagnostic.events()[0], 'diagnostic 事件');
      if (event['committed'] !== undefined) expect(event['committed']).toBe(false);
      if (event['phase'] !== undefined) expect(event['phase']).toBe('create-document-internal');
    } finally {
      await faulted.registry.shutdown();
      await fixture.dispose();
      await fixture.cleanup();
    }
  });

  it('NAMESPACE_CREATE_INVALID_INPUT（内部契约违例注入）→ 安全 500 INTERNAL_ERROR + diagnostic（exact cause 引用相等）', async () => {
    const fixture = createMemoryFixture();
    const registry = createContractRegistry(fixture.persistence);
    const issue = injectedIssue('NAMESPACE_CREATE_INVALID_INPUT');
    const probe = createProbeRegistry(registry, { createIssue: issue });
    const metrics = createObserverRecorder();
    const diagnostic = createObserverRecorder();
    try {
      const router = hubRouter(probe.registry, metrics, diagnostic);
      const response = responseOf(await settleHandle(router, jsonRequest(CREATE_URL)));
      expect(response.status).toBe(500);
      const body = await errorBody(response);
      expect(body['code']).toBe('INTERNAL_ERROR');
      expect(JSON.stringify(body)).not.toContain(ISSUE_MESSAGE_SENTINEL);

      assertSingleMetricsEvent(metrics, 'failed', 'INTERNAL_ERROR');
      assertSingleDiagnosticCause(diagnostic, 'unknown-exception', issue);
    } finally {
      await registry.shutdown();
      await fixture.dispose();
      await fixture.cleanup();
    }
  });

  it('NAMESPACE_ALREADY_EXISTS（内部契约违例注入）→ 安全 500 INTERNAL_ERROR + diagnostic（exact cause 引用相等）', async () => {
    const fixture = createMemoryFixture();
    const registry = createContractRegistry(fixture.persistence);
    const issue = injectedIssue('NAMESPACE_ALREADY_EXISTS');
    const probe = createProbeRegistry(registry, { createIssue: issue });
    const metrics = createObserverRecorder();
    const diagnostic = createObserverRecorder();
    try {
      const router = hubRouter(probe.registry, metrics, diagnostic);
      const response = responseOf(await settleHandle(router, jsonRequest(CREATE_URL)));
      expect(response.status).toBe(500);
      const body = await errorBody(response);
      expect(body['code']).toBe('INTERNAL_ERROR');
      expect(JSON.stringify(body)).not.toContain(ISSUE_MESSAGE_SENTINEL);

      assertSingleMetricsEvent(metrics, 'failed', 'INTERNAL_ERROR');
      assertSingleDiagnosticCause(diagnostic, 'unknown-exception', issue);
    } finally {
      await registry.shutdown();
      await fixture.dispose();
      await fixture.cleanup();
    }
  });

  it('unknown exception（非 branded throw）→ 500 INTERNAL_ERROR + diagnostic unknown-exception（exact cause 引用相等）', async () => {
    const fixture = createMemoryFixture();
    const registry = createContractRegistry(fixture.persistence);
    const injected = new Error('sa6-269 unknown exception sentinel');
    const probe = createProbeRegistry(registry, { createThrow: injected });
    const metrics = createObserverRecorder();
    const diagnostic = createObserverRecorder();
    try {
      const router = hubRouter(probe.registry, metrics, diagnostic);
      const response = responseOf(await settleHandle(router, jsonRequest(CREATE_URL)));
      expect(response.status).toBe(500);
      const body = await errorBody(response);
      expect(body['code']).toBe('INTERNAL_ERROR');
      expect(JSON.stringify(body)).not.toContain('sa6-269 unknown exception sentinel');

      assertSingleMetricsEvent(metrics, 'failed', 'INTERNAL_ERROR');
      assertSingleDiagnosticCause(diagnostic, 'unknown-exception', injected);
    } finally {
      await registry.shutdown();
      await fixture.dispose();
      await fixture.cleanup();
    }
  });
});

describe('issue #269 失败映射：相近负控（同构造路径的正常成功）', () => {
  it('真实 Registry 正常 create 仍 201（失败断言非恒真）；零 diagnostic', async () => {
    const fixture = createMemoryFixture();
    const registry = createContractRegistry(fixture.persistence);
    const metrics = createObserverRecorder();
    const diagnostic = createObserverRecorder();
    try {
      const router = createRestRouter({
        role: 'hub',
        registry,
        metricsObserver: metrics.fn,
        diagnosticObserver: diagnostic.fn,
      });
      const response = responseOf(await settleHandle(router, jsonRequest(CREATE_URL)));
      expect(response.status).toBe(201);
      const body = asRecord(await response.json(), '201 body');
      expect(Object.keys(body).sort()).toEqual(['namespaceId', 'schema']);
      expect(body['namespaceId']).toMatch(/^ns-[0-9a-f]{32}$/);
      expect(diagnostic.events()).toHaveLength(0);
    } finally {
      await registry.shutdown();
      await fixture.dispose();
      await fixture.cleanup();
    }
  });

  it('未匹配 route / 405 分支不触发 #269 映射（零 Registry 业务触达、响应仍是骨架既有形状）', async () => {
    const zeroTouch = createZeroTouchRegistry();
    const metrics = createObserverRecorder();
    const diagnostic = createObserverRecorder();
    const router = createRestRouter({
      role: 'hub',
      registry: zeroTouch.registry,
      metricsObserver: metrics.fn,
      diagnosticObserver: diagnostic.fn,
    });
    const unmatched = await settleHandle(router, jsonRequest('http://localhost/v1/other'));
    expect(unmatched).toEqual({ kind: 'resolved', result: { matched: false } });
    const methodNotAllowed = responseOf(await settleHandle(router, new Request(CREATE_URL, { method: 'GET' })));
    expect(methodNotAllowed.status).toBe(405);
    expect(methodNotAllowed.headers.get('allow')).toBe('POST');
    expect(zeroTouch.invocations).toEqual([]);
    expect(diagnostic.events()).toHaveLength(0);
  });
});
