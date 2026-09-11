/**
 * [SA6 owned] issue #270 验收契约（回归锚，必须保持绿）——本文件锁定「后续 REST 集成
 * 不得破坏」的既有行为与 SA8 advisory 边界；红灯契约见
 * `issue270-server-integration-red.test.ts`。
 *
 * - N1（AC4）：WebSocket Module 不依赖 REST create——零 REST 请求下，peer 直接经
 *   Registry/Lease/ReplicationSession 复制 hub provision 的 namespace 并双向收敛；
 * - N2（SA8 A3）：诊断启用 + file persistence 下 `stop()` 有界完成、单一拆卸链
 *   （每个拆卸事件恰一次），不得无限等待日志 sink；
 * - N3（AC2 既有面）：WebSocket route family 与 listener 基础行为不得被 REST 集成破坏
 *   （`/healthz` 200、未知路径 404、`/replication` 普通请求 404、升级凭据门 401/403）。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CREATE_PATH,
  HUB_OWNER,
  HUB_TOKEN,
  UPGRADE_PATH,
  httpRequest,
  startHubApp,
  startPeerApp,
  waitUntil,
} from './issue270-contract-support.ts';
import { wsUpgrade } from './harness.ts';

/** 有界异步轮询（读取语义为异步控制通道回执；谓词为纯比较）。 */
async function pollAsync<T>(
  what: string,
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  timeoutMs = 20_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (accept(value)) return value;
    if (Date.now() > deadline) throw new Error(`timeout ${timeoutMs}ms waiting for ${what}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
}

describe('issue #270 回归锚（contract must not break）', () => {
  it(
    'N1（AC4）：零 REST 请求下 WebSocket Module 直接复制 provision namespace 并双向收敛',
    async () => {
      const hub = await startHubApp({ provision: true, authorization: true });
      const namespaceId = hub.provisionedNamespaceId;
      expect(namespaceId, 'provision 条目必须创建 namespace').toBeDefined();
      const nsId = namespaceId as string;
      const peer = await startPeerApp({ port: hub.port, targetNamespaceId: nsId, ownerUserId: HUB_OWNER });
      try {
        // WS 会话 bootstrap 完成（直接经 Registry/Lease/ReplicationSession，未经 REST create）。
        await waitUntil(
          'peer bootstrap-imported',
          () => peer.sink.events.some((e) => e.event === 'bootstrap-imported' && e.namespaceId === nsId),
          20_000,
        );

        // peer 本地写 → hub 读收敛。
        const written = await peer.app.handleControlLine(
          JSON.stringify({ op: 'verify-write', namespaceId: nsId, set: ['n'], value: 7 }),
        );
        expect(written).toMatchObject({ ok: true });
        const hubRead = await pollAsync(
          'hub read 收敛到 7',
          () =>
            hub.app.handleControlLine(
              JSON.stringify({ op: 'read', namespaceId: nsId, path: ['n'] }),
            ),
          (reply) => (reply as { value?: unknown }).value === 7,
        );
        expect(hubRead).toMatchObject({ ok: true, value: 7 });

        // 反向：hub 写 → peer 读收敛（同一 Runtime/sequencer，双向复制）。
        const hubWrite = await hub.app.handleControlLine(
          JSON.stringify({ op: 'verify-write', namespaceId: nsId, set: ['n'], value: 8 }),
        );
        expect(hubWrite).toMatchObject({ ok: true });
        const peerRead = await pollAsync(
          'peer read 收敛到 8',
          () =>
            peer.app.handleControlLine(
              JSON.stringify({ op: 'read', namespaceId: nsId, path: ['n'] }),
            ),
          (reply) => (reply as { value?: unknown }).value === 8,
        );
        expect(peerRead).toMatchObject({ ok: true, value: 8 });
      } finally {
        await peer.stop();
        await hub.stop();
      }
    },
    40_000,
  );

  it(
    'N2（SA8 A3）：诊断启用 + file persistence 下 stop() 有界且单一拆卸链',
    async () => {
      const rootDir = mkdtempSync(join(tmpdir(), 'sa6-270-n2-'));
      const hub = await startHubApp({
        fileRootDir: rootDir,
        diagnosticsRootDir: join(rootDir, 'diag'),
        schedule: { debounceMs: 10, maxDirtyMs: 20 },
      });
      try {
        const started = Date.now();
        await hub.app.stop();
        await hub.app.stop(); // 幂等：不得触发第二条拆卸链
        const elapsedMs = Date.now() - started;

        expect(
          elapsedMs,
          `stop() 必须有界完成（诊断 sink 不得被无限等待），实际 ${elapsedMs}ms`,
        ).toBeLessThan(15_000);

        for (const event of [
          'replication-drained',
          'registry-stopped',
          'diagnostics-closed',
          'persistence-disposed',
          'app-stopped',
        ]) {
          expect(hub.sink.countOf(event), `${event} 必须恰一次（单一拆卸链）`).toBe(1);
        }
        const indices = ['replication-drained', 'registry-stopped', 'persistence-disposed', 'app-stopped'].map(
          (event) => hub.sink.indexOf(event),
        );
        const [iDrained = -1, iRegistry = -1, iPersistence = -1, iApp = -1] = indices;
        expect(
          iDrained >= 0 && iDrained < iRegistry && iRegistry < iPersistence && iPersistence < iApp,
          `拆卸链事件时序违约：${JSON.stringify(hub.sink.names())}`,
        ).toBe(true);
      } finally {
        await hub.app.stop();
        rmSync(rootDir, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it('N3（AC2 既有面）：listener 基础路由与 WebSocket 凭据门不得被 REST 集成破坏', async () => {
    const hub = await startHubApp();
    try {
      const health = await httpRequest(hub.port, 'GET', '/healthz');
      expect(health.status).toBe(200);

      const unknown = await httpRequest(hub.port, 'GET', '/not-a-route');
      expect(unknown.status).toBe(404);

      const plainUpgradePath = await httpRequest(hub.port, 'GET', UPGRADE_PATH);
      expect(plainUpgradePath.status).toBe(404);

      // 非 REST 路径不得被 REST route family 接管（否则会得到 405 等 REST 语义）。
      const nonRestPost = await httpRequest(hub.port, 'POST', '/not-a-route', { body: '{}' });
      expect(nonRestPost.status).toBe(404);

      const noCredentials = await wsUpgrade({ port: hub.port });
      expect(noCredentials.status).toBe(401);

      const badCredentials = await wsUpgrade({
        port: hub.port,
        headers: { Authorization: 'Bearer not-the-token' },
      });
      expect(badCredentials.status).toBe(403);

      const restPathUpgrade = await wsUpgrade({
        port: hub.port,
        path: CREATE_PATH,
        headers: { Authorization: `Bearer ${HUB_TOKEN}` },
      });
      expect(restPathUpgrade.status).toBe(404);
    } finally {
      await hub.stop();
    }
  });
});
