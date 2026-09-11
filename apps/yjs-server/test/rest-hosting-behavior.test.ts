/**
 * [SA3 owned] issue #270 `rest-hosting` 行为验收（**非** SA6 冻结契约文件——冻结契约
 * `issue270-*.test.ts` 三文件零字节改动）。覆盖设计 §12 的行为测试面（SA6 冻结契约不覆盖的
 * D8/F2/O1 面），并按最终基座（#268「validate REST namespace creation」合入后的父契约）
 * 校准 D8 的驱动面：
 *
 * - 例 1（父契约透传 / #268 后）：canonical path 提交畸形 JSON body → router **已映射**为
 *   `400` `application/json` problem Response（`code === 'MALFORMED_JSON'`，无 `issues`）
 *   ——集成层原样透传该 matched Response，**不**触发 D8 rejection 占位
 *   （`rest-request-failed` 0 次）；进程存活、后续合法 create 仍 201；
 * - 例 1b（D8 rejection 契约，bridge 级）：`createRestHosting` 注入 rejecting router →
 *   客户端得 `500 text/plain` 占位、`onRejection` 恰一次（同一 rejection 对象，观测隔离）、
 *   已接纳请求结算（结算后 `drain` 无残留工作即时返回）。`rest-hosting.ts` 是 D8 的唯一承载
 *   点，其公开 `RestRouter` 依赖即该分支的注入 seam（真实 HTTP server + 真实 TCP socket，
 *   零源码字符串断言）——#268 后仍以 rejection 结算的结局（body 读取 abort、Registry fatal、
 *   503/500 族）无法由「合法输入 + 内存 Persistence」的组合根确定性驱动，故 500 占位响应的
 *   字节面在本 seam 上锚定；端到端可达性由例 2 锚定；
 * - 例 2（D4 + D8 端到端）：已接纳请求不发 body → `stop()` 在 drain 预算 + 余量内有界完成、
 *   该连接被 abort（客户端传输层失败）→ 挂起 body 读取以流错误结算，真实 router rejection
 *   经 sink 观测 `rest-request-failed` 恰一次；单一拆卸链 `app-stopped` 恰一次
 *   （O7：显式 per-test timeout）；
 * - 例 3（F2）：boot 窗口（不 await `ready`）即 `stop()` → 干净 resolve、无
 *   `app-stop-failed`、事件链收敛 `app-stopped`（`restHost` 未构造 ⇒ drain 步跳过）；
 * - 例 4（O1）：回落路由保持精确等值语义——`GET /healthz?x=1` → 404（`/healthz` 仍 200）。
 *
 * 断言全部为运行时行为观测（HTTP 状态/头、problem body、sink 事件、耗时、promise 结算），
 * 零源码字符串断言；例 1/例 2/例 3/例 4 复用 `issue270-contract-support.ts` 的真实组合根/
 * 真实 TCP 客户端（只读导入，零修改）。
 */
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import type { RestHandledResult, RestRouter } from '@nomicore/namespace-api';
import { createNomicoreApp } from '../src/index.js';
import { createRestHosting } from '../src/rest-hosting.js';
import {
  CREATE_PATH,
  ROOT_VALUE,
  SCHEMA_TEXT,
  createRecordingSink,
  httpRequest,
  openAdmittedRequest,
  startHubApp,
  waitUntil,
} from './issue270-contract-support.ts';

function createBody(root: unknown): string {
  return JSON.stringify({ schemaText: SCHEMA_TEXT, root });
}

describe('issue #270 rest-hosting 行为（SA3）', () => {
  it(
    '例 1（父契约 #268 后）：畸形 JSON → matched 400 MALFORMED_JSON problem 原样透传；不触发 D8 占位',
    async () => {
      const hub = await startHubApp();
      try {
        const malformed = await httpRequest(hub.port, 'POST', CREATE_PATH, {
          body: '{"schemaText": ',
        });
        expect(
          malformed.status,
          `#268 后畸形 JSON 由 router 映射为 400 problem Response，实际 ${malformed.status} ${malformed.body}`,
        ).toBe(400);
        expect(String(malformed.headers['content-type'] ?? '')).toContain('application/json');
        const problem = JSON.parse(malformed.body) as Record<string, unknown>;
        expect(
          problem['code'],
          `problem code 必须为 MALFORMED_JSON：${malformed.body}`,
        ).toBe('MALFORMED_JSON');
        expect(typeof problem['message']).toBe('string');
        expect(String(problem['message'] ?? '').length).toBeGreaterThan(0);
        expect(problem['issues'], 'issues 只在 422 problem 上出现').toBeUndefined();
        expect(
          hub.sink.countOf('rest-request-failed'),
          `已映射的 4xx 不得触发 D8 rejection 占位：${JSON.stringify(hub.sink.names())}`,
        ).toBe(0);

        // 进程存活且后续请求不受影响：同一 listener 上合法 create 仍 201，事件面保持 0。
        const ok = await httpRequest(hub.port, 'POST', CREATE_PATH, { body: createBody(ROOT_VALUE) });
        expect(ok.status, `后续 REST create 应 201，实际 ${ok.status} ${ok.body}`).toBe(201);
        expect(hub.sink.countOf('rest-request-failed'), '合法请求不得追加失败事件').toBe(0);
      } finally {
        await hub.stop();
      }
    },
    30_000,
  );

  it(
    '例 1b（D8 rejection 契约）：rejecting router → 500 text/plain 占位 + onRejection 恰一次 + 记账结算',
    async () => {
      const rejection = new Error('unmapped registry issue: NAMESPACE_CREATE_FAILED');
      const observed: unknown[] = [];
      const rejectingRouter: RestRouter = {
        handle: async (): Promise<RestHandledResult> => {
          throw rejection;
        },
      };
      const hosting = createRestHosting({
        restRouter: rejectingRouter,
        isStopping: () => false,
        onRejection: (error) => {
          observed.push(error);
        },
      });
      const server = http.createServer((req, res) => hosting.handle(req, res));
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address() as AddressInfo;
      try {
        const response = await httpRequest(address.port, 'POST', CREATE_PATH, {
          body: createBody(ROOT_VALUE),
        });
        expect(
          response.status,
          `未映射 rejection 必须以 500 占位收口，实际 ${response.status} ${response.body}`,
        ).toBe(500);
        expect(String(response.headers['content-type'] ?? '')).toContain('text/plain');
        expect(response.body.length, '占位响应必须携带非空 body').toBeGreaterThan(0);
        expect(
          observed,
          `onRejection 必须收到同一 rejection 恰一次：${JSON.stringify(observed.map(String))}`,
        ).toEqual([rejection]);

        // 记账纪律：已接纳请求结算后 drain 无残留工作 → 立即返回（in-flight 不泄漏）。
        const started = Date.now();
        await hosting.drain(10_000);
        expect(Date.now() - started, '结算后的 drain 不得等待预算').toBeLessThan(1_000);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
    20_000,
  );

  it(
    '例 2（D4 + D8 端到端）：drain 预算尽 abort 已接纳请求——有界停机 + 传输层失败 + 真实 rejection 事件 + app-stopped 恰一次',
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

        // D8 端到端：abort 使挂起的 body 读取以流错误结算 → 真实 router rejection 经 sink
        // 恰一次可观测（有界轮询吸收 abort 与 stop() 结算之间的异步窗口）。
        await waitUntil(
          'sink 事件 rest-request-failed',
          () => hub.sink.countOf('rest-request-failed') >= 1,
        );
        expect(
          hub.sink.countOf('rest-request-failed'),
          `drain abort 的真实 rejection 必须恰一次：${JSON.stringify(hub.sink.names())}`,
        ).toBe(1);
        const rejectionEvent = hub.sink.events.find((e) => e.event === 'rest-request-failed');
        expect(typeof rejectionEvent?.['message']).toBe('string');
        expect(String(rejectionEvent?.['message'] ?? '').length).toBeGreaterThan(0);

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
