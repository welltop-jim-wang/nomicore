/**
 * SA6 验收契约（Feature 红灯固化）— issue #267：Peer role gate 顺序 + route/method
 * 匹配行为 + 构造配置门。
 *
 * 契约来源（逐条对应见 SA6 报告 §12）：
 * - 任务简报 AC2（Peer 在匹配 method/raw path 后、解析 owner 或读取 body 前返回
 *   403 + `INSTANCE_ROLE_FORBIDDEN`）、AC6（route 大小写敏感、只接受无尾随斜杠
 *   canonical path、已知 path 非 POST → 405 + `Allow: POST`）；
 * - ADR 0015 §执行顺序与 Lease L148-152（step 1 raw route/method 匹配 → step 2
 *   role gate → step 3 owner/query/Content-Type/Encoding 检查 → step 4 body 读取）；
 *   §受信环境与角色 L38-41；§模块与装配 L22-32（标准 Web Request → Response +
 *   判别结果表达 route 是否匹配；构造配置错误普通 TypeError）。
 *
 * 契约假设（PROPOSAL，供 SA1/SA2 仲裁）：H1 createRestRouter(options) 形状、
 * H2 handle 判别结果形状、H3 subpath 布局 —— 同 rest-create-hub-contract.test.ts 头注。
 *
 * 状态（iteration 1）：`packages/namespace-api/src/rest.ts` 尚不存在 → 本文件静态 import
 * `../src/rest.js` 失败，整文件构造性红灯（能力缺口）；SA3 落地后应整体转绿。可满足性 /
 * 断言敏感性与临时诊断件清理证据见 SA6 报告 §9/§13（同 rest-create-hub-contract.test.ts 头注）。
 */
import { describe, expect, it } from 'vitest';
import type { NamespaceRegistry } from '@nomicore/namespace-registry';
import { createRestRouter } from '../src/rest.js';
import {
  CREATE_PATH,
  CREATE_URL,
  createPoisonRegistry,
  jsonRequest,
  matchedResponse,
  methodRequest,
  trappedBodyRequest,
} from './rest-contract-harness.js';

const NOOP_OBSERVER = (): void => {};

interface RouterOptionsShape {
  role: 'hub' | 'peer';
  registry: NamespaceRegistry;
  metricsObserver: () => void;
  diagnosticObserver: () => void;
}

function peerRouter(registry: unknown = createPoisonRegistry()) {
  return createRestRouter({
    role: 'peer',
    registry: registry as never,
    metricsObserver: NOOP_OBSERVER,
    diagnosticObserver: NOOP_OBSERVER,
  });
}

function hubRouter(registry: unknown = createPoisonRegistry()) {
  return createRestRouter({
    role: 'hub',
    registry: registry as never,
    metricsObserver: NOOP_OBSERVER,
    diagnosticObserver: NOOP_OBSERVER,
  });
}

async function assertForbidden(response: Response): Promise<void> {
  expect(response.status).toBe(403);
  const raw: unknown = await response.json();
  expect(raw !== null && typeof raw === 'object' && !Array.isArray(raw)).toBe(true);
  expect((raw as Record<string, unknown>)['code']).toBe('INSTANCE_ROLE_FORBIDDEN');
}

async function assertMethodNotAllowed(response: Response): Promise<void> {
  expect(response.status).toBe(405);
  expect(response.headers.get('allow')).toBe('POST');
}

describe('issue #267 Peer role gate 顺序契约（ADR 0015 step 1 → 2 → 3/4）', () => {
  it('AC2: Peer 对 canonical POST 返回 403 + INSTANCE_ROLE_FORBIDDEN，且零 Registry 触达', async () => {
    const router = peerRouter();
    const response = matchedResponse(await router.handle(jsonRequest(CREATE_URL)));
    await assertForbidden(response);
  });

  it('AC2: Peer 对无 body 的 canonical POST 仍 403（role gate 不依赖 body）', async () => {
    const router = peerRouter();
    const response = matchedResponse(
      await router.handle(new Request(CREATE_URL, { method: 'POST' })),
    );
    await assertForbidden(response);
  });

  it('AC2/step 3 顺序: Peer 对不支持 media type 的 POST 仍 403（Content-Type 检查在 role gate 之后）', async () => {
    const router = peerRouter();
    const request = new Request(CREATE_URL, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'schemaText=whatever',
    });
    const response = matchedResponse(await router.handle(request));
    await assertForbidden(response);
  });

  it('AC2/step 3 顺序: Peer 对 percent-encoded owner 仍 403（owner 解析在 role gate 之后）', async () => {
    const router = peerRouter();
    const encodedOwnerUrl = `http://localhost/v1/owners/%61lice/namespaces`;
    const response = matchedResponse(await router.handle(jsonRequest(encodedOwnerUrl)));
    await assertForbidden(response);
  });

  it('AC2/step 4 顺序: Peer 在读取 body 前返回 403（body 消费成员零调用）', async () => {
    const router = peerRouter();
    const observation = { bodyConsumptionAttempts: [] as string[] };
    const request = trappedBodyRequest(jsonRequest(CREATE_URL, '{ malformed json'), observation);
    const response = matchedResponse(await router.handle(request));
    await assertForbidden(response);
    expect(observation.bodyConsumptionAttempts).toEqual([]);
  });

  it('AC2/step 1 顺序: Peer 对已知 path 的非 POST 返回 405 + Allow: POST（method gate 先于 role gate）', async () => {
    const router = peerRouter();
    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      const response = matchedResponse(
        await router.handle(methodRequest(method, `http://localhost${CREATE_PATH}`)),
      );
      await assertMethodNotAllowed(response);
    }
  });

  it('AC2: Peer 对未匹配 route 不返回 403（判别结果表达不匹配）', async () => {
    const router = peerRouter();
    const result = await router.handle(methodRequest('POST', 'http://localhost/v1/owners/alice/catalog'));
    expect(result.matched).toBe(false);
  });
});

describe('issue #267 route/method 匹配契约（AC6）', () => {
  it('AC6: Hub 对已知 path 的非 POST 返回 405 + Allow: POST，且零 Registry 触达', async () => {
    const router = hubRouter();
    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      const response = matchedResponse(
        await router.handle(methodRequest(method, `http://localhost${CREATE_PATH}`)),
      );
      await assertMethodNotAllowed(response);
    }
  });

  it('AC6: 大小写变体、尾随斜杠与非 canonical 路径均不匹配（matched:false，零 Registry 触达）', async () => {
    const router = hubRouter();
    const unmatchedUrls = [
      'http://localhost/V1/owners/rest-contract-owner/namespaces',
      'http://localhost/v1/owners/rest-contract-owner/Namespaces',
      'http://localhost/v1/owners/rest-contract-owner/namespaces/',
      'http://localhost/v1/owners/rest-contract-owner/catalog',
      'http://localhost/v1/owners/rest-contract-owner',
      'http://localhost/v1/owners/rest-contract-owner/namespaces/extra',
    ];
    for (const url of unmatchedUrls) {
      const result = await router.handle(methodRequest('POST', url));
      expect(result.matched).toBe(false);
    }
  });

  it('AC6: 大小写变体 + 非 POST 方法同样不匹配（path 匹配先于 method 判定）', async () => {
    const router = hubRouter();
    const result = await router.handle(
      methodRequest('GET', 'http://localhost/V1/owners/rest-contract-owner/namespaces'),
    );
    expect(result.matched).toBe(false);
  });
});

describe('issue #267 构造配置门契约（ADR 0015 §模块与装配 L30 / §Observability L186）', () => {
  it('构造配置错误抛普通 TypeError（非法 role / 缺 options / 缺 observer）', () => {
    const registry = createPoisonRegistry();
    const valid = {
      role: 'hub' as const,
      registry,
      metricsObserver: NOOP_OBSERVER,
      diagnosticObserver: NOOP_OBSERVER,
    };
    const invalidRole = { ...valid, role: 'server' } as unknown as RouterOptionsShape;
    expect(() => createRestRouter(invalidRole)).toThrow(TypeError);
    expect(() => createRestRouter(undefined as never)).toThrow(TypeError);
    expect(() =>
      createRestRouter({
        role: 'hub',
        registry,
        diagnosticObserver: NOOP_OBSERVER,
      } as unknown as RouterOptionsShape),
    ).toThrow(TypeError);
    expect(() =>
      createRestRouter({
        role: 'hub',
        registry,
        metricsObserver: NOOP_OBSERVER,
      } as unknown as RouterOptionsShape),
    ).toThrow(TypeError);
  });

  it('构造时复制并冻结配置：构造后改写调用方 options.role 不改变行为', async () => {
    const registry = createPoisonRegistry();
    const options = {
      role: 'peer' as 'hub' | 'peer',
      registry,
      metricsObserver: NOOP_OBSERVER,
      diagnosticObserver: NOOP_OBSERVER,
    };
    const router = createRestRouter(options as never);
    (options as { role: string }).role = 'hub';
    const response = matchedResponse(await router.handle(jsonRequest(CREATE_URL)));
    await assertForbidden(response);
  });
});
