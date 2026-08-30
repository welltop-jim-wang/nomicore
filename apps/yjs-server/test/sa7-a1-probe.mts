/**
 * SA7 动态验证子进程探针 —— SA4 §5-2（A1 无 alert 的响亮失败路径）。
 *
 * 为什么是独立子进程：被测路径会**故意**制造进程级 uncaughtException
 * （config.alert 缺省 = throw TypeError，经 runLoud→escalate(queueMicrotask-throw)
 * 直投进程级）。在 vitest worker 内触发会让 vitest 自身的 uncaught 错误收集把
 * 整个 test run 打红——进程级通道必须在无测试框架干扰的进程中观测。
 *
 * 运行方式：`node_modules/.bin/tsx apps/yjs-server/test/sa7-a1-probe.mts`（由
 * `issue164-sa7-dynamic.test.ts` DV2 spawn）。结果经 stdout 单行
 * `SA7_A1_PROBE_RESULT <json>` 交付；退出码 0 = 探针自身按预期走完。
 *
 * 观测面（对应 SA4 §5-2 原文）：
 * - uncaughtException 捕获 TypeError 且 message 含 'bufferedAmount'；
 * - unhandledRejection 处理器零触达（钉死 P14 通道选择：同步异常域而非 promise 域）；
 * - 零 HELLO_ACK（零协议分配）+ 连接以 1011 'transport-faces-missing' 收口。
 */
import * as crypto from 'node:crypto';
import { createYjsHubServer } from '../src/index.js';
import type { DuplexTransport } from '@nomicore/ws-replication';
import { createMemoryDuplexTransport } from '@nomicore/ws-replication/testing';
import {
  HUB_INSTANCE,
  HUB_OWNER,
  PEER_INSTANCE,
  TEST_TOKEN,
  PeerWire,
  makeHubNamespace,
  makeTestRegistry,
  makeVerifier,
  waitUntil,
  wsUpgrade,
} from './harness.js';

interface CapturedError {
  readonly name: string;
  readonly message: string;
}

function capture(err: unknown): CapturedError {
  const e = err as { constructor?: { name?: string }; message?: string } | null;
  return {
    name: e?.constructor?.name ?? typeof err,
    message: String(e?.message ?? err),
  };
}

interface ProbeResult {
  readonly upgradeStatus: number;
  readonly closeCode: number | undefined;
  readonly closeReason: string | undefined;
  readonly frames: readonly string[];
  readonly uncaughtCount: number;
  readonly uncaughtFirst: CapturedError | undefined;
  readonly unhandledCount: number;
  readonly unhandledFirst: CapturedError | null;
}

async function main(): Promise<void> {
  const uncaught: CapturedError[] = [];
  const unhandled: CapturedError[] = [];
  process.on('uncaughtException', (err: unknown) => {
    uncaught.push(capture(err));
  });
  process.on('unhandledRejection', (reason: unknown) => {
    unhandled.push(capture(reason));
  });

  const fixture = makeTestRegistry();
  await makeHubNamespace(fixture.registry);
  const server = createYjsHubServer({
    role: 'hub',
    instanceId: HUB_INSTANCE,
    listen: { host: '127.0.0.1', port: 0 },
    verifyToken: makeVerifier(),
    authorize: () =>
      Promise.resolve({
        ok: true as const,
        localOwner: HUB_OWNER,
        permissions: { read: true, submit: true },
      }),
    registry: fixture.registry,
    // 缺面 transport：内存双端零可选生产面（bufferedAmount/ping/onPong 全缺）
    transportFactory: () => createMemoryDuplexTransport().hub as unknown as DuplexTransport,
    // 关键：不传 alert —— 缺省 = throw TypeError（A1 被测路径）
  });
  const addr = await server.start();

  const upgrade = await wsUpgrade({
    port: addr.port,
    headers: { Authorization: `Bearer ${TEST_TOKEN}` },
  });
  if (upgrade.ws === undefined) {
    throw new Error(`探针期望 101，实际 ${upgrade.status}`);
  }
  const wire = new PeerWire(upgrade.ws);
  wire.send({
    kind: 'HELLO',
    peerInstanceId: PEER_INSTANCE,
    expectedHubInstanceId: HUB_INSTANCE,
    protocolVersions: [1],
    requiredCapabilities: 0,
    optionalCapabilities: 0,
    connectionNonce: crypto.randomBytes(16),
  });

  // 连接收口（1011 transport-faces-missing）+ uncaughtException 落地（microtask 转投）
  await waitUntil('连接被响亮收口', () => wire.closed !== undefined, 10_000);
  await waitUntil('uncaughtException 被捕获', () => uncaught.length > 0, 10_000);
  // 结算窗：若有任何 unhandledRejection（错误通道选择），在此窗口内必然浮出
  const settleDeadline = Date.now() + 300;
  while (Date.now() < settleDeadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }

  const result: ProbeResult = {
    upgradeStatus: upgrade.status,
    closeCode: wire.closed?.code,
    closeReason: wire.closed?.reason,
    frames: [...wire.kinds],
    uncaughtCount: uncaught.length,
    uncaughtFirst: uncaught[0],
    unhandledCount: unhandled.length,
    unhandledFirst: unhandled[0] ?? null,
  };
  await server.close();
  await new Promise<void>((resolve) => {
    process.stdout.write(`SA7_A1_PROBE_RESULT ${JSON.stringify(result)}\n`, () => resolve());
  });
  process.exit(0);
}

main().catch((err: unknown) => {
  const payload = JSON.stringify({ error: String(err), stack: String((err as Error)?.stack ?? '') });
  process.stdout.write(`SA7_A1_PROBE_ERROR ${payload}\n`, () => {
    process.exit(1);
  });
});
