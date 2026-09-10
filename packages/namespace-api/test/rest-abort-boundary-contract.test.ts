/**
 * SA6 验收契约（Feature 红灯固化）— issue #269：取消边界（body 读取 abort / 接纳后不取消）。
 *
 * 契约来源（逐条对应见 SA6 报告 §12）：
 * - 任务简报 `wiki/raw/task_issue-269.md`「取消边界」+ AC3；
 * - ADR 0015 §JSON 处理与资源限制 L113（「body读取阶段尊重`Request.signal`，中断后
 *   Registry 零触达；调用Registry后不传播客户端取消，必须等待create settle并release
 *   Lease」）与 §执行顺序与Lease L156–159（step 7 调用 create → step 9 恰一次等待
 *   `lease.release()` → step 10 返回）；
 * - ADR 0015 §Observability L188：metrics outcome 词表含 `aborted`（取消是与 4xx/5xx
 *   不同的终态分类）。
 *
 * **契约裁决（本文件钉死）**：
 * 1. body 读取阶段的 abort 以 **`handle` rejection** 结算（不是伪造的 HTTP Response）：
 *    router 无 listener，客户端已离开；ADR 未定义 abort 的 HTTP status，而骨架纪律为
 *    「不发明未评审的 4xx/5xx problem shape」。唯一可观察的分类面是 metrics
 *    `outcome:'aborted'`。
 * 2. **有界结算**：mid-read abort 后 `handle` 必须在有限时间内结算（不得悬挂）。
 *    Node 24 运行时事实（`rest-failure-contract-support.test.ts` 恒绿锚）：pre-aborted
 *    signal + 完整 body 时 `request.json()` 仍 resolve；mid-read abort 不会使进行中的读
 *    自行结算——因此实现必须**显式观察 `Request.signal`**。
 * 3. **与 #268 共享 body 读取段的交互裁决**：同一请求既可「超限」（#268 的 413）又可
 *   「已中断」时，**abort 优先**——读取阶段入口观察到 signal 已中断即以 `aborted` 终结，
 *   Registry 零触达；超限检查不得抢在 abort 之前产出 413。该用例（C5）在 #269 单独合入时
 *   即绿，在 #268 合入后仍必须保持绿（防两票合入时相互改写）。
 *
 * 状态（iteration 0）：骨架未观察 `Request.signal`、未发射 metrics 事件 → 本文件在
 * 「aborted 有界结算 / 零触达 / metrics=aborted」处红灯；post-admission 两例的 201 与
 * release 恰一次在基线上已绿（不伪称红）。
 */
import { describe, expect, it } from 'vitest';
import { createRestRouter } from '../src/rest.js';
import {
  SC1_ID_PATTERN,
  createContractRegistry,
  createMemoryFixture,
} from './rest-contract-harness.js';
import {
  createAbortableJsonRequest,
  createMidReadAbortRequest,
  createObserverRecorder,
  createProbeRegistry,
  createZeroTouchRegistry,
  describeSettlement,
  raceSettlement,
  responseOf,
  settleHandle,
  type ObserverRecorder,
} from './rest-failure-contract-harness.js';

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  if (!predicate()) throw new Error('契约前置失败：等待条件在期限内未成立');
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`契约违例：${label} 不是 object（实际 ${JSON.stringify(value)}）`);
  }
  return value as Record<string, unknown>;
}

function metricsOutcomes(metrics: ObserverRecorder): unknown[] {
  return metrics.events().map((event) => asRecord(event, 'metrics 事件')['outcome']);
}

async function assertSuccess201(response: Response): Promise<void> {
  expect(response.status).toBe(201);
  const body = asRecord(await response.json(), '201 body');
  expect(Object.keys(body).sort()).toEqual(['namespaceId', 'schema']);
  expect(body['namespaceId']).toMatch(/^ns-[0-9a-f]{32}$/);
  const schema = asRecord(body['schema'], '201 schema');
  expect(schema['id']).toMatch(SC1_ID_PATTERN);
}

describe('issue #269 取消边界：body 读取阶段 abort → Registry 零触达 + metrics aborted', () => {
  it('C1 pre-aborted signal：handle 有界 rejection（不伪造 Response）、Registry 零触达、metrics=aborted、零 diagnostic', async () => {
    const zeroTouch = createZeroTouchRegistry();
    const metrics = createObserverRecorder();
    const diagnostic = createObserverRecorder();
    const router = createRestRouter({
      role: 'hub',
      registry: zeroTouch.registry,
      metricsObserver: metrics.fn,
      diagnosticObserver: diagnostic.fn,
    });
    const { request, controller } = createAbortableJsonRequest();
    controller.abort();

    const settlement = await raceSettlement(router, request, 2_000);
    expect(settlement.kind, describeSettlement(settlement)).toBe('rejected');
    expect(zeroTouch.invocations).toEqual([]);
    expect(metricsOutcomes(metrics)).toEqual(['aborted']);
    expect(diagnostic.events()).toHaveLength(0);
  });

  it('C2 mid-read abort（读已开始）：handle 仍有界 rejection、Registry 零触达、metrics=aborted', async () => {
    const zeroTouch = createZeroTouchRegistry();
    const metrics = createObserverRecorder();
    const diagnostic = createObserverRecorder();
    const router = createRestRouter({
      role: 'hub',
      registry: zeroTouch.registry,
      metricsObserver: metrics.fn,
      diagnosticObserver: diagnostic.fn,
    });
    const probe = createMidReadAbortRequest();
    try {
      const pending = raceSettlement(router, probe.request, 2_000);
      await waitUntil(() => probe.pulls() > 0, 2_000);
      probe.controller.abort();
      const settlement = await pending;
      expect(settlement.kind, describeSettlement(settlement)).toBe('rejected');
      expect(zeroTouch.invocations).toEqual([]);
      expect(metricsOutcomes(metrics)).toEqual(['aborted']);
      expect(diagnostic.events()).toHaveLength(0);
    } finally {
      await probe.cancel();
      await new Promise((resolve) => setImmediate(resolve));
    }
  });

  it('C5 与 #268 共享 seam 的交互裁决：pre-aborted + 超限配置 → aborted（不是 413），Registry 零触达', async () => {
    const zeroTouch = createZeroTouchRegistry();
    const metrics = createObserverRecorder();
    const diagnostic = createObserverRecorder();
    const router = createRestRouter({
      role: 'hub',
      registry: zeroTouch.registry,
      metricsObserver: metrics.fn,
      diagnosticObserver: diagnostic.fn,
      limits: { maxBodyBytes: 16 }, // body 远大于 16 bytes：413 条件与 abort 同时成立
    });
    const { request, controller } = createAbortableJsonRequest();
    controller.abort();

    const settlement = await raceSettlement(router, request, 2_000);
    expect(settlement.kind, describeSettlement(settlement)).toBe('rejected');
    // 显式反断言：不得以 413（#268 的 limits 结局）抢在 abort 之前结算。
    if (settlement.kind === 'resolved' && settlement.result.matched) {
      expect(settlement.result.response.status).not.toBe(413);
    }
    expect(zeroTouch.invocations).toEqual([]);
    expect(metricsOutcomes(metrics)).toEqual(['aborted']);
    expect(diagnostic.events()).toHaveLength(0);
  });
});

describe('issue #269 取消边界：Registry 接纳后不传播客户端取消', () => {
  it('C3 create 在途 abort：仍等待 create settle、201、release 恰一次、metrics=succeeded（非 aborted）', async () => {
    const fixture = createMemoryFixture();
    const registry = createContractRegistry(fixture.persistence);
    let openGate!: () => void;
    const createGate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    const probe = createProbeRegistry(registry, { createGate });
    const metrics = createObserverRecorder();
    const diagnostic = createObserverRecorder();
    try {
      const router = createRestRouter({
        role: 'hub',
        registry: probe.registry,
        metricsObserver: metrics.fn,
        diagnosticObserver: diagnostic.fn,
      });
      const { request, controller } = createAbortableJsonRequest();
      const pending = settleHandle(router, request);
      await waitUntil(() => probe.observation.createCalls === 1, 2_000);
      controller.abort();
      expect(request.signal.aborted).toBe(true);
      openGate();

      const response = responseOf(await pending);
      expect(response.status).toBe(201);
      const body = asRecord(await response.json(), '201 body');
      expect(body['namespaceId']).toMatch(/^ns-[0-9a-f]{32}$/);
      expect(Object.keys(body).sort()).toEqual(['namespaceId', 'schema']);
      expect(probe.observation.releaseCalls).toBe(1);
      expect(probe.observation.createSettlements).toHaveLength(1);
      expect((probe.observation.createSettlements[0] as { ok?: unknown }).ok).toBe(true);
      expect(metricsOutcomes(metrics)).toEqual(['succeeded']);
      expect(diagnostic.events()).toHaveLength(0);
    } finally {
      openGate();
      await registry.shutdown();
      await fixture.dispose();
      await fixture.cleanup();
    }
  });

  it('C4 release 在途 abort：仍等待 release settle、201、release 恰一次、metrics=succeeded', async () => {
    const fixture = createMemoryFixture();
    const registry = createContractRegistry(fixture.persistence);
    let openGate!: () => void;
    const releaseGate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    const probe = createProbeRegistry(registry, { releaseGate });
    const metrics = createObserverRecorder();
    const diagnostic = createObserverRecorder();
    try {
      const router = createRestRouter({
        role: 'hub',
        registry: probe.registry,
        metricsObserver: metrics.fn,
        diagnosticObserver: diagnostic.fn,
      });
      const { request, controller } = createAbortableJsonRequest();
      const pending = settleHandle(router, request);
      await waitUntil(() => probe.observation.releaseCalls === 1, 2_000);
      controller.abort();
      openGate();

      const response = responseOf(await pending);
      await assertSuccess201(response);
      expect(probe.observation.releaseCalls).toBe(1);
      const lease = probe.observation.underlyingLease;
      if (lease === undefined) throw new Error('契约前置失败：未捕获 lease');
      expect(lease.getStatus()).toEqual({ lease: 'released', runtime: null });
      expect(metricsOutcomes(metrics)).toEqual(['succeeded']);
      expect(diagnostic.events()).toHaveLength(0);
    } finally {
      openGate();
      await registry.shutdown();
      await fixture.dispose();
      await fixture.cleanup();
    }
  });
});
