/**
 * SA6 验收契约（Feature 红灯固化）— issue #269：双 observer（metrics-safe / diagnostic）
 * 与 observer throw 隔离。
 *
 * 契约来源（逐条对应见 SA6 报告 §12）：
 * - 任务简报 `wiki/raw/task_issue-269.md`「Observability」+ AC4/AC5/AC6；
 * - ADR 0015 §Observability L186–190：构造必须显式注入两个同步 void observer（no-op
 *   亦须显式）；observer throw 一律隔离、不改变 HTTP 结果；metrics-safe observer 只有统一
 *   低基数事件（operation / `succeeded | rejected | unavailable | failed | aborted` outcome
 *   / 稳定 code / 可选 HTTP status），不携带 owner、namespaceId、issues、schema/root、cause；
 *   diagnostic observer 只接收三类事件（Registry fatal、unknown exception、Lease release
 *   failure），可携带已验证 owner、已知 namespaceId、Registry operation/phase/committed 与
 *   exact cause，但不得携带 schema/root 或完整 validation issues。
 *
 * **契约形状提案（PROPOSAL，待 SA1/SA2 仲裁；若设计另有裁决须回写本文件并走修订轮）**：
 * - H-M：metrics 事件为**单对象单实参** `metricsObserver(event)`，键集 ⊆
 *   `{operation, outcome, code, status}`；`operation` 为同一 router 恒定的非空字符串；
 *   `outcome` ∈ 五值词表；`code` 为非空字符串；`status` 为 number。成功（2xx）时 `code`
 *   可省略；有 Response 时 `code` 必须与 response body 的稳定 code 一致（成功无 code）。
 * - H-D：diagnostic 事件为**单对象单实参** `diagnosticObserver(event)`，`kind` ∈
 *   `{registry-fatal, unknown-exception, lease-release-failure}`；`cause` 必须为 exact
 *   cause **对象引用**；`committed`/`phase`/`namespaceId`/`owner` 可选（出现时必须诚实）。
 *   ADR L178 把「unknown exception」与「内部契约违例」归入同一 500 类，故内部契约违例
 *   （`NAMESPACE_CREATE_INVALID_INPUT` / `NAMESPACE_ALREADY_EXISTS`）使用
 *   `unknown-exception` kind。
 *
 * 状态（iteration 0）：骨架 observer 为「显式注入 + 零发射」，事件契约属本票 → 本文件在
 * 事件缺失处红灯；显式注入门（D1）与「零发射不改变结果」的既有部分在基线上已绿。
 */
import { describe, expect, it } from 'vitest';
import { createRestRouter } from '../src/rest.js';
import {
  createContractRegistry,
  createMemoryFixture,
  jsonRequest,
  OWNER_USER_ID,
  ROOT_VALUE,
  SCHEMA_TEXT,
} from './rest-contract-harness.js';
import {
  CAUSE_SENTINEL,
  createFaultInjectedRegistry,
  createObserverRecorder,
  createOperationalFailurePersistence,
  createProbeRegistry,
  createZeroTouchRegistry,
  DIAGNOSTIC_KINDS,
  ISSUE_MESSAGE_SENTINEL,
  METRICS_EVENT_KEYS,
  METRICS_OUTCOMES,
  OWNER_SENTINEL,
  RELEASE_CAUSE_SENTINEL,
  responseOf,
  settleHandle,
  type ObserverRecorder,
} from './rest-failure-contract-harness.js';
import type { CreateNamespaceIssue, NamespaceRegistry } from '@nomicore/namespace-registry';

const SENTINEL_URL = `http://localhost/v1/owners/${OWNER_SENTINEL}/namespaces`;

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`契约违例：${label} 不是 object（实际 ${JSON.stringify(value)}）`);
  }
  return value as Record<string, unknown>;
}

function routerFor(
  registry: NamespaceRegistry,
  metrics: ObserverRecorder,
  diagnostic: ObserverRecorder,
  role: 'hub' | 'peer' = 'hub',
) {
  return createRestRouter({
    role,
    registry,
    metricsObserver: metrics.fn,
    diagnosticObserver: diagnostic.fn,
  });
}

function assertMetricsCompliance(event: Record<string, unknown>, label: string): string {
  for (const key of Object.keys(event)) {
    expect(METRICS_EVENT_KEYS, `${label}：metrics 事件出现非白名单键 ${key}`).toContain(key);
  }
  const outcome = event['outcome'];
  expect(typeof outcome, `${label}：outcome 必须是 string`).toBe('string');
  expect(METRICS_OUTCOMES, `${label}：outcome 越出低基数词表`).toContain(outcome);
  const operation = event['operation'];
  expect(typeof operation, `${label}：operation 必须是 string`).toBe('string');
  expect((operation as string).length, `${label}：operation 不得为空`).toBeGreaterThan(0);
  if (event['code'] !== undefined) expect(typeof event['code'], `${label}：code 必须是 string`).toBe('string');
  if (event['status'] !== undefined) expect(typeof event['status'], `${label}：status 必须是 number`).toBe('number');

  const serialized = JSON.stringify(event);
  for (const secret of [OWNER_SENTINEL, SCHEMA_TEXT, JSON.stringify(ROOT_VALUE), ISSUE_MESSAGE_SENTINEL, CAUSE_SENTINEL]) {
    expect(serialized, `${label}：metrics 事件泄漏敏感值`).not.toContain(secret);
  }
  expect(serialized, `${label}：metrics 事件泄漏 namespaceId`).not.toMatch(/ns-[0-9a-f]{32}/);
  return operation as string;
}

function assertDiagnosticCompliance(event: Record<string, unknown>, label: string): void {
  const kind = event['kind'];
  expect(typeof kind, `${label}：kind 必须是 string`).toBe('string');
  expect(DIAGNOSTIC_KINDS, `${label}：diagnostic kind 超出三类事件`).toContain(kind);
  if (event['cause'] === undefined) throw new Error(`${label}：diagnostic 事件缺少 exact cause`);
  if (event['committed'] !== undefined) expect(typeof event['committed']).toBe('boolean');
  if (event['phase'] !== undefined) expect(typeof event['phase']).toBe('string');
  if (event['namespaceId'] !== undefined) expect(event['namespaceId']).toMatch(/^ns-[0-9a-f]{32}$/);
  if (event['owner'] !== undefined) {
    // diagnostic 携带的 owner 必须是本请求已验证 owner（契约只使用哨兵与默认两个 owner）。
    expect([OWNER_SENTINEL, OWNER_USER_ID]).toContain(
      asRecord(event['owner'], `${label} owner`)['userId'],
    );
  }
  const serialized = JSON.stringify(event);
  expect(serialized, `${label}：diagnostic 事件泄漏 schema 原文`).not.toContain(SCHEMA_TEXT);
  expect(serialized, `${label}：diagnostic 事件泄漏 root`).not.toContain(JSON.stringify(ROOT_VALUE));
  expect(event['issues'], `${label}：diagnostic 事件不得携带完整 validation issues`).toBeUndefined();
}

function injectedIssue(code: 'NAMESPACE_CREATE_INVALID_INPUT' | 'NAMESPACE_ALREADY_EXISTS'): CreateNamespaceIssue {
  return { ok: false, code, message: ISSUE_MESSAGE_SENTINEL } as unknown as CreateNamespaceIssue;
}

describe('issue #269 observer 契约：构造门与 metrics 低基数事件', () => {
  it('D1 两个 observer 构造时强制显式注入（缺任一 → TypeError；显式 no-op 可构造）', () => {
    const registry = createContractRegistry(createMemoryFixture().persistence);
    type RouterOptions = Parameters<typeof createRestRouter>[0];
    expect(() =>
      createRestRouter({ role: 'hub', registry, diagnosticObserver: () => {} } as unknown as RouterOptions),
    ).toThrow(TypeError);
    expect(() =>
      createRestRouter({ role: 'hub', registry, metricsObserver: () => {} } as unknown as RouterOptions),
    ).toThrow(TypeError);
    expect(() =>
      createRestRouter({
        role: 'hub',
        registry,
        metricsObserver: () => {},
        diagnosticObserver: () => {},
      }),
    ).not.toThrow();
  });

  it('D2 成功路径：metrics 恰一个 succeeded 低基数事件（键白名单 + operation 恒定 + 无敏感字段），零 diagnostic', async () => {
    const fixture = createMemoryFixture();
    const registry = createContractRegistry(fixture.persistence);
    const metrics = createObserverRecorder();
    const diagnostic = createObserverRecorder();
    try {
      const router = routerFor(registry, metrics, diagnostic);
      const response = responseOf(await settleHandle(router, jsonRequest(SENTINEL_URL)));
      expect(response.status).toBe(201);

      const events = metrics.events();
      expect(events).toHaveLength(1);
      const event = asRecord(events[0], 'metrics 事件');
      const operation = assertMetricsCompliance(event, 'success');
      expect(event['outcome']).toBe('succeeded');
      if (event['status'] !== undefined) expect(event['status']).toBe(201);
      expect(operation.length).toBeGreaterThan(0);
      expect(diagnostic.events()).toHaveLength(0);
    } finally {
      await registry.shutdown();
      await fixture.dispose();
      await fixture.cleanup();
    }
  });

  it('D3 observer throw 一律隔离：metrics/diagnostic 同时 throw 不改变 201 / 503 / 500 / release-failure 结果', async () => {
    const throwing = (): never => {
      throw new Error('sa6-269 observer throw sentinel');
    };
    // (a) 成功 + 双 observer throw → 仍 201
    {
      const fixture = createMemoryFixture();
      const registry = createContractRegistry(fixture.persistence);
      try {
        const router = createRestRouter({
          role: 'hub',
          registry,
          metricsObserver: throwing,
          diagnosticObserver: throwing,
        });
        const response = responseOf(await settleHandle(router, jsonRequest(SENTINEL_URL)));
        expect(response.status).toBe(201);
      } finally {
        await registry.shutdown();
        await fixture.dispose();
        await fixture.cleanup();
      }
    }
    // (b) REGISTRY_NOT_ACCEPTING + 双 observer throw → 仍 503
    {
      const fixture = createMemoryFixture();
      const registry = createContractRegistry(fixture.persistence);
      try {
        await registry.shutdown();
        const router = createRestRouter({
          role: 'hub',
          registry,
          metricsObserver: throwing,
          diagnosticObserver: throwing,
        });
        const response = responseOf(await settleHandle(router, jsonRequest(SENTINEL_URL)));
        expect(response.status).toBe(503);
        expect(asRecord(await response.json(), '503 body')['code']).toBe('REGISTRY_NOT_ACCEPTING');
      } finally {
        await registry.shutdown();
        await fixture.dispose();
        await fixture.cleanup();
      }
    }
    // (c) Registry fatal + 双 observer throw → 仍 500 OUTCOME_UNKNOWN
    {
      const fixture = createMemoryFixture();
      const faulted = createFaultInjectedRegistry(fixture.persistence, 'runtime-construction');
      try {
        const router = createRestRouter({
          role: 'hub',
          registry: faulted.registry,
          metricsObserver: throwing,
          diagnosticObserver: throwing,
        });
        const response = responseOf(await settleHandle(router, jsonRequest(SENTINEL_URL)));
        expect(response.status).toBe(500);
        expect(asRecord(await response.json(), '500 body')['code']).toBe('NAMESPACE_CREATE_OUTCOME_UNKNOWN');
      } finally {
        await faulted.registry.shutdown();
        await fixture.dispose();
        await fixture.cleanup();
      }
    }
    // (d) Lease release 失败 + 双 observer throw → 仍 201、release 恰一次
    {
      const fixture = createMemoryFixture();
      const registry = createContractRegistry(fixture.persistence);
      const probe = createProbeRegistry(registry, { releaseFailure: new Error(RELEASE_CAUSE_SENTINEL) });
      try {
        const router = createRestRouter({
          role: 'hub',
          registry: probe.registry,
          metricsObserver: throwing,
          diagnosticObserver: throwing,
        });
        const response = responseOf(await settleHandle(router, jsonRequest(SENTINEL_URL)));
        expect(response.status).toBe(201);
        expect(probe.observation.releaseCalls).toBe(1);
      } finally {
        await registry.shutdown();
        await fixture.dispose();
        await fixture.cleanup();
      }
    }
  });
});

describe('issue #269 observer 契约：diagnostic 三类事件与 exact cause', () => {
  it('D4 Lease release failure → diagnostic lease-release-failure（exact cause 引用相等）+ metrics succeeded + 201', async () => {
    const fixture = createMemoryFixture();
    const registry = createContractRegistry(fixture.persistence);
    const releaseFailure = new Error(RELEASE_CAUSE_SENTINEL);
    const probe = createProbeRegistry(registry, { releaseFailure });
    const metrics = createObserverRecorder();
    const diagnostic = createObserverRecorder();
    try {
      const router = routerFor(probe.registry, metrics, diagnostic);
      const response = responseOf(await settleHandle(router, jsonRequest(SENTINEL_URL)));
      expect(response.status).toBe(201);
      expect(probe.observation.releaseCalls).toBe(1);

      const events = diagnostic.events();
      expect(events).toHaveLength(1);
      const event = asRecord(events[0], 'diagnostic 事件');
      assertDiagnosticCompliance(event, 'release-failure');
      expect(event['kind']).toBe('lease-release-failure');
      expect(event['cause']).toBe(releaseFailure);

      const metricsEvents = metrics.events();
      expect(metricsEvents).toHaveLength(1);
      expect(asRecord(metricsEvents[0], 'metrics 事件')['outcome']).toBe('succeeded');
    } finally {
      await registry.shutdown();
      await fixture.dispose();
      await fixture.cleanup();
    }
  });

  it('D5 Registry fatal 二分 / unknown exception / 内部契约违例：diagnostic 只出现三类 kind + exact cause + 无 schema/root/完整 issues', async () => {
    // (a) fatal committed:true
    {
      const fixture = createMemoryFixture();
      const faulted = createFaultInjectedRegistry(fixture.persistence, 'runtime-construction');
      const metrics = createObserverRecorder();
      const diagnostic = createObserverRecorder();
      try {
        const router = routerFor(faulted.registry, metrics, diagnostic);
        await settleHandle(router, jsonRequest(SENTINEL_URL));
        const fatal = faulted.observation.createSettlements[0];
        const events = diagnostic.events();
        expect(events).toHaveLength(1);
        const event = asRecord(events[0], 'diagnostic 事件');
        assertDiagnosticCompliance(event, 'fatal committed:true');
        expect(event['kind']).toBe('registry-fatal');
        expect(event['cause']).toBe(fatal);
        if (event['committed'] !== undefined) expect(event['committed']).toBe(true);
      } finally {
        await faulted.registry.shutdown();
        await fixture.dispose();
        await fixture.cleanup();
      }
    }
    // (b) fatal committed:false
    {
      const fixture = createMemoryFixture();
      const faulted = createFaultInjectedRegistry(fixture.persistence, 'create-document-internal');
      const metrics = createObserverRecorder();
      const diagnostic = createObserverRecorder();
      try {
        const router = routerFor(faulted.registry, metrics, diagnostic);
        await settleHandle(router, jsonRequest(SENTINEL_URL));
        const fatal = faulted.observation.createSettlements[0];
        const events = diagnostic.events();
        expect(events).toHaveLength(1);
        const event = asRecord(events[0], 'diagnostic 事件');
        assertDiagnosticCompliance(event, 'fatal committed:false');
        expect(event['kind']).toBe('registry-fatal');
        expect(event['cause']).toBe(fatal);
        if (event['committed'] !== undefined) expect(event['committed']).toBe(false);
      } finally {
        await faulted.registry.shutdown();
        await fixture.dispose();
        await fixture.cleanup();
      }
    }
    // (c) unknown exception
    {
      const fixture = createMemoryFixture();
      const registry = createContractRegistry(fixture.persistence);
      const injected = new Error(CAUSE_SENTINEL);
      const probe = createProbeRegistry(registry, { createThrow: injected });
      const metrics = createObserverRecorder();
      const diagnostic = createObserverRecorder();
      try {
        const router = routerFor(probe.registry, metrics, diagnostic);
        await settleHandle(router, jsonRequest(SENTINEL_URL));
        const events = diagnostic.events();
        expect(events).toHaveLength(1);
        const event = asRecord(events[0], 'diagnostic 事件');
        assertDiagnosticCompliance(event, 'unknown exception');
        expect(event['kind']).toBe('unknown-exception');
        expect(event['cause']).toBe(injected);
      } finally {
        await registry.shutdown();
        await fixture.dispose();
        await fixture.cleanup();
      }
    }
    // (d) 内部契约违例（INVALID_INPUT）
    {
      const fixture = createMemoryFixture();
      const registry = createContractRegistry(fixture.persistence);
      const issue = injectedIssue('NAMESPACE_CREATE_INVALID_INPUT');
      const probe = createProbeRegistry(registry, { createIssue: issue });
      const metrics = createObserverRecorder();
      const diagnostic = createObserverRecorder();
      try {
        const router = routerFor(probe.registry, metrics, diagnostic);
        await settleHandle(router, jsonRequest(SENTINEL_URL));
        const events = diagnostic.events();
        expect(events).toHaveLength(1);
        const event = asRecord(events[0], 'diagnostic 事件');
        assertDiagnosticCompliance(event, 'internal contract violation');
        expect(event['kind']).toBe('unknown-exception');
        expect(event['cause']).toBe(issue);
      } finally {
        await registry.shutdown();
        await fixture.dispose();
        await fixture.cleanup();
      }
    }
  });
});

describe('issue #269 observer 契约：跨分支低基数与敏感字段扫描', () => {
  it('D6 全分支矩阵：metrics 键白名单/outcome 词表/无泄漏；diagnostic 三类 kind/无 schema·root·issues', async () => {
    const metricsEvents: unknown[] = [];
    const diagnosticEvents: unknown[] = [];
    const outcomes: unknown[] = [];

    const run = async (
      label: string,
      registry: NamespaceRegistry,
      makeRequest: () => Request,
      role: 'hub' | 'peer' = 'hub',
      limits?: Readonly<{ maxBodyBytes?: number }>,
      abortBeforeHandle = false,
    ): Promise<void> => {
      const metrics = createObserverRecorder();
      const diagnostic = createObserverRecorder();
      const router = createRestRouter({
        role,
        registry,
        metricsObserver: metrics.fn,
        diagnosticObserver: diagnostic.fn,
        ...(limits === undefined ? {} : { limits }),
      });
      const request = makeRequest();
      if (abortBeforeHandle && request.signal.aborted === false) {
        throw new Error('契约前置失败：abort 请求未在 handle 前中断');
      }
      await settleHandle(router, request);
      metricsEvents.push(...metrics.events());
      diagnosticEvents.push(...diagnostic.events());
      outcomes.push(...metrics.events().map((event) => asRecord(event, `${label} metrics`)['outcome']));
    };

    // ① 成功
    {
      const fixture = createMemoryFixture();
      const registry = createContractRegistry(fixture.persistence);
      try {
        await run('success', registry, () => jsonRequest(SENTINEL_URL));
      } finally {
        await registry.shutdown();
        await fixture.dispose();
        await fixture.cleanup();
      }
    }
    // ② 403 Peer role gate
    {
      const zeroTouch = createZeroTouchRegistry();
      await run('peer-403', zeroTouch.registry, () => jsonRequest(SENTINEL_URL), 'peer');
      expect(zeroTouch.invocations).toEqual([]);
    }
    // ③ 405 方法门
    {
      const zeroTouch = createZeroTouchRegistry();
      await run('method-405', zeroTouch.registry, () => new Request(SENTINEL_URL, { method: 'GET' }));
      expect(zeroTouch.invocations).toEqual([]);
    }
    // ④ 503
    {
      const fixture = createMemoryFixture();
      const registry = createContractRegistry(fixture.persistence);
      try {
        await registry.shutdown();
        await run('not-accepting', registry, () => jsonRequest(SENTINEL_URL));
      } finally {
        await registry.shutdown();
        await fixture.dispose();
        await fixture.cleanup();
      }
    }
    // ⑤ 500 NAMESPACE_CREATE_FAILED
    {
      const fixture = createMemoryFixture();
      const registry = createContractRegistry(createOperationalFailurePersistence(fixture.persistence));
      try {
        await run('operational-failure', registry, () => jsonRequest(SENTINEL_URL));
      } finally {
        await registry.shutdown();
        await fixture.dispose();
        await fixture.cleanup();
      }
    }
    // ⑥ 500 OUTCOME_UNKNOWN（fatal committed:true）
    {
      const fixture = createMemoryFixture();
      const faulted = createFaultInjectedRegistry(fixture.persistence, 'runtime-construction');
      try {
        await run('fatal-committed-true', faulted.registry, () => jsonRequest(SENTINEL_URL));
      } finally {
        await faulted.registry.shutdown();
        await fixture.dispose();
        await fixture.cleanup();
      }
    }
    // ⑦ 500 INTERNAL_ERROR（fatal committed:false）
    {
      const fixture = createMemoryFixture();
      const faulted = createFaultInjectedRegistry(fixture.persistence, 'create-document-internal');
      try {
        await run('fatal-committed-false', faulted.registry, () => jsonRequest(SENTINEL_URL));
      } finally {
        await faulted.registry.shutdown();
        await fixture.dispose();
        await fixture.cleanup();
      }
    }
    // ⑧ 500 INTERNAL_ERROR（unknown exception）
    {
      const fixture = createMemoryFixture();
      const registry = createContractRegistry(fixture.persistence);
      const probe = createProbeRegistry(registry, { createThrow: new Error(CAUSE_SENTINEL) });
      try {
        await run('unknown-exception', probe.registry, () => jsonRequest(SENTINEL_URL));
      } finally {
        await registry.shutdown();
        await fixture.dispose();
        await fixture.cleanup();
      }
    }
    // ⑨ 500 INTERNAL_ERROR（内部契约违例）
    {
      const fixture = createMemoryFixture();
      const registry = createContractRegistry(fixture.persistence);
      const probe = createProbeRegistry(registry, {
        createIssue: injectedIssue('NAMESPACE_ALREADY_EXISTS'),
      });
      try {
        await run('internal-contract-violation', probe.registry, () => jsonRequest(SENTINEL_URL));
      } finally {
        await registry.shutdown();
        await fixture.dispose();
        await fixture.cleanup();
      }
    }
    // ⑩ abort（body 读取阶段）
    {
      const zeroTouch = createZeroTouchRegistry();
      const controller = new AbortController();
      const request = jsonRequest(SENTINEL_URL, undefined, { signal: controller.signal });
      controller.abort();
      await run('body-abort', zeroTouch.registry, () => request, 'hub', undefined, true);
      expect(zeroTouch.invocations).toEqual([]);
    }
    // ⑪ 未匹配 route（router 未接管 → 必须零事件）
    {
      const zeroTouch = createZeroTouchRegistry();
      const metrics = createObserverRecorder();
      const diagnostic = createObserverRecorder();
      const router = createRestRouter({
        role: 'hub',
        registry: zeroTouch.registry,
        metricsObserver: metrics.fn,
        diagnosticObserver: diagnostic.fn,
      });
      const settlement = await settleHandle(router, jsonRequest('http://localhost/v1/other'));
      expect(settlement).toEqual({ kind: 'resolved', result: { matched: false } });
      expect(metrics.events()).toHaveLength(0);
      expect(diagnostic.events()).toHaveLength(0);
      expect(zeroTouch.invocations).toEqual([]);
    }

    const operations = new Set<string>();
    for (const [index, event] of metricsEvents.entries()) {
      operations.add(assertMetricsCompliance(asRecord(event, `metrics[${index}]`), `metrics[${index}]`));
    }
    for (const [index, event] of diagnosticEvents.entries()) {
      assertDiagnosticCompliance(asRecord(event, `diagnostic[${index}]`), `diagnostic[${index}]`);
    }
    expect(operations.size, 'metrics operation 必须同一低基数常量').toBe(1);
    // #269 拥有的分支 outcome 覆盖：1×succeeded、1×unavailable、5×failed、1×aborted；
    // 403/405 的 'rejected'（若实现发射）不在此硬性计数内。
    expect(outcomes.filter((outcome) => outcome === 'succeeded')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === 'unavailable')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === 'failed')).toHaveLength(5);
    expect(outcomes.filter((outcome) => outcome === 'aborted')).toHaveLength(1);
  });
});
