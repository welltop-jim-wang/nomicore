/**
 * [SA3 owned] issue #270 `rest-hosting` 行为验收（**非** SA6 冻结契约文件——冻结契约
 * `issue270-*.test.ts` 零字节改动）。覆盖设计 §12 的四例行为测试（SA6 冻结契约不覆盖的
 * D8/F2/O1 面）：
 *
 * - 例 1（D8）：canonical path 提交畸形 JSON body → `500 text/plain` 占位 +
 *   `rest-request-failed` 事件恰一次；进程存活；后续请求不受影响；
 * - 例 2（D4）：已接纳请求不发 body → `stop()` 在 drain 预算 + 余量内有界完成、该连接被
 *   abort（客户端传输层失败）、单一拆卸链 `app-stopped` 恰一次（O7：显式 per-test timeout）；
 * - 例 3（F2）：boot 窗口（不 await `ready`）即 `stop()` → 干净 resolve、无
 *   `app-stop-failed`、事件链收敛 `app-stopped`（`restHost` 未构造 ⇒ drain 步跳过）；
 * - 例 4（O1）：回落路由保持精确等值语义——`GET /healthz?x=1` → 404（`/healthz` 仍 200）。
 *
 * 断言全部为运行时行为观测（HTTP 状态/头、sink 事件、耗时、promise 结算），零源码字符串
 * 断言；harness 复用 `issue270-contract-support.ts` 的真实组合根/真实 TCP 客户端（只读）。
 */
import { describe, expect, it } from 'vitest';
import { createNomicoreApp } from '../src/index.js';
import {
  CREATE_PATH,
  ROOT_VALUE,
  SCHEMA_TEXT,
  createRecordingSink,
  httpRequest,
  openAdmittedRequest,
  startHubApp,
} from './issue270-contract-support.ts';

function createBody(root: unknown): string {
  return JSON.stringify({ schemaText: SCHEMA_TEXT, root });
}

describe('issue #270 rest-hosting 行为（SA3）', () => {
  it(
    '例 1（D8）：canonical path 畸形 JSON body → 500 + rest-request-failed 恰一次，进程与后续请求不受影响',
    async () => {
      const hub = await startHubApp();
      try {
        const malformed = await httpRequest(hub.port, 'POST', CREATE_PATH, {
          body: '{"schemaText": ',
        });
        expect(
          malformed.status,
          `router rejection 应映射为 500 占位，实际 ${malformed.status} ${malformed.body}`,
        ).toBe(500);
        expect(String(malformed.headers['content-type'] ?? '')).toContain('text/plain');
        expect(
          hub.sink.countOf('rest-request-failed'),
          `rest-request-failed 必须恰一次：${JSON.stringify(hub.sink.names())}`,
        ).toBe(1);
        const failed = hub.sink.events.find((e) => e.event === 'rest-request-failed');
        expect(typeof failed?.['message']).toBe('string');
        expect(String(failed?.['message'] ?? '').length).toBeGreaterThan(0);

        // 进程存活且后续请求不受影响：同一 listener 上合法 create 仍 201。
        const ok = await httpRequest(hub.port, 'POST', CREATE_PATH, { body: createBody(ROOT_VALUE) });
        expect(ok.status, `后续 REST create 应 201，实际 ${ok.status} ${ok.body}`).toBe(201);
        expect(
          hub.sink.countOf('rest-request-failed'),
          '合法请求不得追加失败事件',
        ).toBe(1);
      } finally {
        await hub.stop();
      }
    },
    30_000,
  );

  it(
    '例 2（D4）：drain 预算尽时 abort 已接纳请求——有界停机 + 客户端传输层失败 + app-stopped 恰一次',
    async () => {
      const hub = await startHubApp();
      try {
        // 已接纳（100-continue 锚）但永不发送 body：请求在 drain 预算内无法结算。
        const admitted = await openAdmittedRequest(hub.port, CREATE_PATH, createBody(ROOT_VALUE));
        const started = Date.now();
        const stopping = hub.app.stop();
        await stopping;
        const elapsedMs = Date.now() - started;

        expect(elapsedMs, `有界停机必须等待已接纳工作至预算尽，实际 ${elapsedMs}ms`).toBeGreaterThanOrEqual(
          5_000,
        );
        expect(elapsedMs, `stop() 必须在预算 + 余量内完成，实际 ${elapsedMs}ms`).toBeLessThan(15_000);

        // 预算尽 → abort 销毁该请求 socket：客户端以传输层失败结算（诚实失败，不伪造响应）。
        const failure = await admitted.sendBody();
        expect(
          failure.status,
          `abort 后客户端必须得到传输层失败，实际 ${failure.status} ${failure.body}`,
        ).toBe(0);
        expect(failure.transportError).toBeDefined();

        expect(hub.sink.countOf('app-stopped'), '单一拆卸链 app-stopped 恰一次').toBe(1);
        expect(hub.sink.countOf('app-stop-failed'), '有界停机不得产生 app-stop-failed').toBe(0);
        expect(hub.sink.indexOf('replication-drained')).toBeGreaterThanOrEqual(0);
      } finally {
        await hub.app.stop();
      }
    },
    20_000,
  );

  it(
    '例 3（F2）：boot 窗口（未 await ready）stop() 干净结算——drain 步跳过不致 TypeError',
    async () => {
      const sink = createRecordingSink();
      const app = createNomicoreApp(
        {
          role: 'hub',
          instanceId: 'hub-270-boot-window',
          persistence: { kind: 'memory' },
          hub: { listen: { host: '127.0.0.1', port: 0 }, tokens: { 'peer-270': 'token-270' } },
        },
        { emitter: sink.emit },
      );
      // 立即挂载 handler（防 unhandled rejection）；boot 首 await 已让出事件循环 ⇒ 停机请求
      // 真实落于「服务尚未构造」窗口（此时 restHost === undefined）。
      const ready = app.ready.catch((error: unknown) => error);
      await expect(app.stop()).resolves.toBeUndefined();
      const readyOutcome = await ready;
      expect(readyOutcome, `boot 早退必须干净 resolve，实际 ${String(readyOutcome)}`).toBeUndefined();

      expect(sink.countOf('app-stop-failed'), 'boot 窗口停机不得产生 app-stop-failed').toBe(0);
      const chain = ['replication-drained', 'registry-stopped', 'persistence-disposed', 'app-stopped'];
      for (const event of chain) {
        expect(sink.countOf(event), `${event} 必须恰一次（单一拆卸链）`).toBe(1);
      }
      const indices = chain.map((event) => sink.indexOf(event));
      const [iDrained = -1, iRegistry = -1, iPersistence = -1, iApp = -1] = indices;
      expect(
        iDrained >= 0 && iDrained < iRegistry && iRegistry < iPersistence && iPersistence < iApp,
        `拆卸链事件时序违约：${JSON.stringify(sink.names())}`,
      ).toBe(true);
    },
    20_000,
  );

  it('例 4（O1）：回落路由保持精确等值语义——GET /healthz?x=1 → 404（/healthz 仍 200）', async () => {
    const hub = await startHubApp();
    try {
      const health = await httpRequest(hub.port, 'GET', '/healthz');
      expect(health.status).toBe(200);
      const query = await httpRequest(hub.port, 'GET', '/healthz?x=1');
      expect(
        query.status,
        `回落判定必须保持 req.url === '/healthz' 精确等值（含 query），实际 ${query.status} ${query.body}`,
      ).toBe(404);
    } finally {
      await hub.stop();
    }
  });
});
