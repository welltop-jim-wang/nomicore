/**
 * [SA6 owned] issue #270 验收契约（红灯）——Server 集成验收：REST 与 WebSocket 共享
 * Registry + 有序停止。任务类型：Feature（能力缺口实证 + 目标行为验收），不虚构 Bug 根因。
 *
 * AC 映射：
 * - AC1 REST 与 WebSocket Module 持有同一个 `NamespaceRegistry` 引用（不经 Cordis Context
 *   查找、不运行时替换）→ T1-A / T1-B（经组合根 `NomicoreApp.registry` 观测面 + 行为反证）；
 * - AC2 server 先按 raw path 分流 REST 与 WebSocket route family → T2；
 * - AC3 停止顺序：停止 intake → 等待已接纳 REST/WS 工作 settle → 释放 Lease/Session →
 *   shutdown Registry 与 Persistence → T3；
 * - AC4 WebSocket Module 不依赖 REST create（直接使用 Registry/Lease/ReplicationSession）
 *   → 回归锚 `issue270-regression-anchors.test.ts` N1（当前即绿，契约不得破坏）。
 *
 * SA8 advisory 落实：A2（REST Module 构造期两个 observer 必须显式注入——本文件所有
 * `startHubApp` 若构造期缺 observer 即 `ready` reject，201/403 断言不可达）；A1（先 close
 * session 后 release Lease——T3 以 WS 1001 clean close + `replication-drained` <
 * `registry-stopped` 观测，包内精确次序由 ws-replication/ADR 0010 L90 既有契约锁死）；
 * A3（不无限等待日志 sink、单一拆卸链）→ 回归锚 N2。
 *
 * RED 基线（HEAD `0b06050`）：hub 组合根 listener 未承载 REST route family
 * （`POST /v1/owners/{owner}/namespaces` → 404）；组合根未暴露共享 Registry 观测面
 * （`app.registry` → undefined）。红灯只来自本票能力缺口，不得是 fixture/入口/超时错误。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { NamespaceRegistry } from '@nomicore/namespace-registry';
import {
  CREATE_PATH,
  HUB_TOKEN,
  NAMESPACE_ID_PATTERN,
  REGISTRY_SEAM_GAP,
  ROOT_VALUE,
  SCHEMA_TEXT,
  UPGRADE_PATH,
  appRegistry,
  helloMessage,
  httpRequest,
  makeIndependentRegistry,
  openAdmittedRequest,
  openAndReadValue,
  openNamespaceMessage,
  startHubApp,
  waitUntil,
} from './issue270-contract-support.ts';
import { PeerWire, wsUpgrade, type RawWsClient } from './harness.ts';

function createBody(root: unknown): string {
  return JSON.stringify({ schemaText: SCHEMA_TEXT, root });
}

function parseCreated(body: string): { namespaceId: string; schema: { lang: string; version: number; id: string } } {
  return JSON.parse(body) as { namespaceId: string; schema: { lang: string; version: number; id: string } };
}

describe('issue #270 AC1 — REST 与 WebSocket Module 共享同一个 Registry 引用', () => {
  it(
    'T1-A：REST create 的 namespace 可在组合根同一 Registry 上 reopen（第二 Registry 反证）',
    async () => {
      const hub = await startHubApp();
      try {
        const registry = appRegistry(hub.app) as NamespaceRegistry | undefined;
        expect(registry, REGISTRY_SEAM_GAP).toBeDefined();
        const reg = registry as NamespaceRegistry;
        expect(reg.getStatus().state).toBe('running');

        const first = await httpRequest(hub.port, 'POST', CREATE_PATH, {
          body: createBody(ROOT_VALUE),
        });
        expect(first.status, `REST create 应 201，实际 ${first.status} ${first.body}`).toBe(201);
        const firstBody = parseCreated(first.body);
        expect(firstBody.namespaceId).toMatch(NAMESPACE_ID_PATTERN);

        // 同一 Registry 引用：REST 创建的事实必须落在组合根 Registry 上。
        await expect(
          openAndReadValue(reg, 'rest-owner-270', firstBody.namespaceId, ['title']),
        ).resolves.toBe(ROOT_VALUE.title);

        // 敏感度反证：独立第二 Registry 上同一 namespaceId 必须 NAMESPACE_NOT_FOUND。
        const independent = makeIndependentRegistry();
        try {
          const missing = await independent.registry.open(
            { userId: 'rest-owner-270' },
            firstBody.namespaceId,
          );
          expect(missing.ok).toBe(false);
          if (!missing.ok) expect(missing.code).toBe('NAMESPACE_NOT_FOUND');
        } finally {
          await independent.shutdown();
        }

        // 不运行时替换：后续 REST create 与观测面仍指向同一 Registry 实例。
        const second = await httpRequest(hub.port, 'POST', CREATE_PATH, {
          body: createBody({ title: 'hello-270-second' }),
        });
        expect(second.status, `第二次 REST create 应 201，实际 ${second.status}`).toBe(201);
        const secondBody = parseCreated(second.body);
        expect(secondBody.namespaceId).not.toBe(firstBody.namespaceId);
        expect(appRegistry(hub.app)).toBe(reg);
        await expect(
          openAndReadValue(reg, 'rest-owner-270', secondBody.namespaceId, ['title']),
        ).resolves.toBe('hello-270-second');
      } finally {
        await hub.stop();
      }
    },
    30_000,
  );

  it(
    'T1-B：WS 复制会话所在 Runtime 可由组合根 Registry 的 lease 写入并 bootstrap 观测',
    async () => {
      const hub = await startHubApp({ provision: true, authorization: true });
      let wire: PeerWire | undefined;
      let raw: RawWsClient | undefined;
      try {
        const registry = appRegistry(hub.app) as NamespaceRegistry | undefined;
        expect(registry, REGISTRY_SEAM_GAP).toBeDefined();
        const reg = registry as NamespaceRegistry;
        const namespaceId = hub.provisionedNamespaceId;
        expect(namespaceId, 'provision 条目必须创建 namespace').toBeDefined();
        const nsId = namespaceId as string;

        // 经组合根 Registry 的 lease 写入（同一 Runtime / 同一 write sequencer）。
        const opened = await reg.open({ userId: 'hub-owner-270' }, nsId);
        expect(opened.ok).toBe(true);
        if (!opened.ok) throw new Error(`契约违例：Registry.open 失败 ${JSON.stringify(opened)}`);
        const lease = opened.lease;
        try {
          const status = lease.getStatus();
          expect(status.lease).toBe('active');
          const mutated = await lease.mutateData({ op: 'set', path: ['n'], value: 99 });
          expect(mutated.ok, `lease.mutateData 应成功，实际 ${JSON.stringify(mutated)}`).toBe(true);
        } finally {
          await lease.release();
        }

        // WS route family：同一 namespace 的 bootstrap 必须观测到该写入。
        const upgrade = await wsUpgrade({
          port: hub.port,
          headers: { Authorization: `Bearer ${HUB_TOKEN}` },
        });
        expect(upgrade.status).toBe(101);
        raw = upgrade.ws;
        wire = new PeerWire(raw as never);
        wire.send(helloMessage());
        await wire.waitKind('HELLO_ACK');
        wire.send(openNamespaceMessage(nsId));
        const openOk = await wire.waitKind('OPEN_OK');
        expect(openOk.message).toMatchObject({ kind: 'OPEN_OK', namespaceId: nsId });
        const snapshotFrame = await wire.waitKind('BOOTSTRAP_SNAPSHOT');
        const snapshot = snapshotFrame.message as { snapshot: Uint8Array };
        const peerDoc = new Y.Doc();
        Y.applyUpdate(peerDoc, new Uint8Array(snapshot.snapshot));
        const root = (peerDoc.getMap('ROOT') as unknown as Map<string, unknown>).get('n');
        expect(root, 'WS bootstrap 必须来自 app.registry lease 写入过的同一 Runtime').toBe(99);
      } finally {
        raw?.destroy();
        await hub.stop();
      }
    },
    30_000,
  );
});

describe('issue #270 AC2 — raw path 分流 REST 与 WebSocket route family', () => {
  it(
    'T2：同一 listener 上 REST 路径走 REST route family、/replication 走 WebSocket route family',
    async () => {
      const hub = await startHubApp();
      const opened: Array<{ destroy(): void }> = [];
      try {
        // REST route family：canonical path + POST → 201。
        const created = await httpRequest(hub.port, 'POST', CREATE_PATH, {
          body: createBody(ROOT_VALUE),
        });
        expect(created.status, `REST create 应 201，实际 ${created.status} ${created.body}`).toBe(201);
        expect(String(created.headers['content-type'] ?? '')).toContain('application/json');
        expect(parseCreated(created.body).namespaceId).toMatch(NAMESPACE_ID_PATTERN);

        // REST route family：已知 path + 非 POST → 405 + Allow: POST（method gate）。
        const method = await httpRequest(hub.port, 'GET', CREATE_PATH);
        expect(method.status, `GET canonical 应 405，实际 ${method.status}`).toBe(405);
        expect(String(method.headers.allow ?? '')).toBe('POST');

        // 非 canonical path 不属于任何 route family → 404（不得被 REST 误吞）。
        const nonCanonical = await httpRequest(hub.port, 'POST', '/v1/owners/a/b/namespaces', {
          body: createBody(ROOT_VALUE),
        });
        expect(nonCanonical.status).toBe(404);

        // WebSocket route family：普通 HTTP 请求到 /replication → 404（非 REST 响应）。
        const plainUpgradePath = await httpRequest(hub.port, 'GET', UPGRADE_PATH);
        expect(plainUpgradePath.status).toBe(404);

        // 既有锚（不得破坏）：/healthz 200。
        const health = await httpRequest(hub.port, 'GET', '/healthz');
        expect(health.status).toBe(200);

        // WebSocket route family：/replication + 凭据 → 101 升级。
        const upgrade = await wsUpgrade({
          port: hub.port,
          headers: { Authorization: `Bearer ${HUB_TOKEN}` },
        });
        expect(upgrade.status).toBe(101);
        if (upgrade.ws !== undefined) opened.push(upgrade.ws);

        // REST 路径不是升级路由 → 404；未知路径同样 404。
        const restUpgrade = await wsUpgrade({
          port: hub.port,
          path: CREATE_PATH,
          headers: { Authorization: `Bearer ${HUB_TOKEN}` },
        });
        expect(restUpgrade.status).toBe(404);
        const unknownUpgrade = await wsUpgrade({
          port: hub.port,
          path: '/not-a-route',
          headers: { Authorization: `Bearer ${HUB_TOKEN}` },
        });
        expect(unknownUpgrade.status).toBe(404);
      } finally {
        for (const ws of opened) ws.destroy();
        await hub.stop();
      }
    },
    30_000,
  );
});

describe('issue #270 AC3 — 有序停止（intake → settle → Lease/Session → Registry/Persistence）', () => {
  it(
    'T3：停止 intake 后已接纳 REST create 完成、新请求不再被接纳、WS Session 1001 关闭、Registry/Persistence 有序停止',
    async () => {
      const rootDir = mkdtempSync(join(tmpdir(), 'sa6-270-t3-'));
      const hub = await startHubApp({ fileRootDir: rootDir, provision: true, authorization: true });
      let wire: PeerWire | undefined;
      let raw: RawWsClient | undefined;
      try {
        const namespaceId = hub.provisionedNamespaceId;
        expect(namespaceId, 'provision 条目必须创建 namespace').toBeDefined();
        const nsId = namespaceId as string;

        // ① 在线 WS 复制会话（已接纳的 WS 工作）。
        const upgrade = await wsUpgrade({
          port: hub.port,
          headers: { Authorization: `Bearer ${HUB_TOKEN}` },
        });
        expect(upgrade.status).toBe(101);
        raw = upgrade.ws;
        wire = new PeerWire(raw as never);
        wire.send(helloMessage());
        await wire.waitKind('HELLO_ACK');
        wire.send(openNamespaceMessage(nsId));
        await wire.waitKind('OPEN_OK');

        // ② 已接纳 REST 请求：100-continue = server 已解析并接纳请求头（admission 锚）。
        const admitted = await openAdmittedRequest(hub.port, CREATE_PATH, createBody(ROOT_VALUE));

        // ③ 发起停止（不 await），随后完成已接纳请求的 body。
        const stopping = hub.stop();
        const response = await admitted.sendBody();
        expect(
          response.status,
          `已接纳 REST create 应在 drain 期间完成 201，实际 ${response.status} ${response.body} ${response.transportError ?? ''}`,
        ).toBe(201);
        const createdNamespaceId = parseCreated(response.body).namespaceId;
        expect(createdNamespaceId).toMatch(NAMESPACE_ID_PATTERN);

        // ④ intake 已停止：停止发起之后的新 REST create（独立 TCP 连接）不再被接纳。
        const duringDrain = await httpRequest(hub.port, 'POST', CREATE_PATH, {
          body: createBody({ title: 'must-not-be-created' }),
        });
        expect(
          duringDrain.status,
          `intake 停止后不得再接纳新 REST create（实际 ${duringDrain.status} ${duringDrain.body} ${duringDrain.transportError ?? ''}）`,
        ).not.toBe(201);
        expect(
          duringDrain.status === 0 || duringDrain.status >= 400,
          `intake 停止后新工作必须以传输层拒绝或 >=400 拒绝，实际 ${duringDrain.status} ${duringDrain.body}`,
        ).toBe(true);

        // ⑤ WS Session 在 Registry 停止前以 1001 clean close 释放（SA8 A1 观测面）。
        await waitUntil('hub 停止期间 WS 会话关闭', () => wire?.closed !== undefined, 10_000);
        expect(wire?.closed?.code, `WS 会话应以 1001 关闭，实际 ${JSON.stringify(wire?.closed)}`).toBe(1001);

        // ⑥ 停止完成 + 单一拆卸链事件时序。
        await stopping;
        const iDrained = hub.sink.indexOf('replication-drained');
        const iRegistry = hub.sink.indexOf('registry-stopped');
        const iPersistence = hub.sink.indexOf('persistence-disposed');
        const iApp = hub.sink.indexOf('app-stopped');
        expect(
          iDrained >= 0 && iDrained < iRegistry && iRegistry < iPersistence && iPersistence < iApp,
          `拆卸链事件时序违约：${JSON.stringify(hub.sink.names())}`,
        ).toBe(true);

        const registry = appRegistry(hub.app) as NamespaceRegistry | undefined;
        expect(registry, REGISTRY_SEAM_GAP).toBeDefined();
        expect((registry as NamespaceRegistry).getStatus().state).toBe('stopped');

        // ⑦ 已接纳 REST create 在 Persistence dispose 前已提交：同 rootDir 重启后仍可读回。
        const restarted = await startHubApp({ fileRootDir: rootDir });
        try {
          const restartedRegistry = appRegistry(restarted.app) as NamespaceRegistry | undefined;
          expect(restartedRegistry, REGISTRY_SEAM_GAP).toBeDefined();
          await expect(
            openAndReadValue(
              restartedRegistry as NamespaceRegistry,
              'rest-owner-270',
              createdNamespaceId,
              ['title'],
            ),
          ).resolves.toBe(ROOT_VALUE.title);
        } finally {
          await restarted.stop();
        }
      } finally {
        raw?.destroy();
        await hub.stop();
        rmSync(rootDir, { recursive: true, force: true });
      }
    },
    40_000,
  );
});
