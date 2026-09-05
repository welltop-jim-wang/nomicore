/**
 * SA7 动态验证补充测试 —— issue #164 切片 9（SA4 R2 pass 后的运行时盲区覆盖）。
 *
 * 逐条对应 SA4 review §5「动态审核重点」（7 项中的 1–6 项；第 7 项 CI 复跑为
 * PR 建立后的环境证据，由 SA7 report 记录）：
 * - DV1 = §5-1（A5）：同步 throw 的 verifier → 403，零进程级异常；
 * - DV2 = §5-2（A1）：无 alert + 缺面 transport → uncaughtException(TypeError 含
 *   bufferedAmount) / 零 unhandledRejection / 零协议分配 / 1011 收口（子进程探针）；
 * - DV3 = §5-3（A2）：永不 resolve 的 verifier → helloTimeoutMs 封顶 503 Auth Timeout；
 * - DV4 = §5-4（D7）：limits.maxFrameBytes 覆写传播至 ws maxPayload 双层同界（1009/1002 边界对）；
 * - DV5 = §5-5（A4a）：EADDRINUSE 失败复位——重试报真实根因，端口释放后同实例可复用；
 * - DV6/#229：活跃 channel 下 close() 不发送停机 GOAWAY，直接以 1001 收口，随后
 *   Registry stopped + 端口拒绝。
 *
 * 纪律：与 SA6 冻结测试同源——零源码 grep，全部锚在 HTTP 状态行 / WS 帧 / 关闭码 /
 * Registry 状态 / 进程级异常计数；真实 TCP（port 0）；有界轮询等待。
 */
import * as crypto from 'node:crypto';
import * as net from 'node:net';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createYjsHubServer } from '../src/index.js';
import type {
  NamespaceAuthorizer,
  PeerTokenVerifier,
  ReplicationLimits,
  ReplicationTimeouts,
} from '@nomicore/ws-replication';
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

// ═══════════════════════════ 组装配件 ═══════════════════════════

function allowAll(): NamespaceAuthorizer {
  return (_instance, _ns) =>
    Promise.resolve({
      ok: true as const,
      localOwner: HUB_OWNER,
      permissions: { read: true, submit: true },
    });
}

/** 长活性间隔（避免 ping/pong 噪声混入被测时序）。 */
const QUIET_PING: Readonly<Partial<ReplicationTimeouts>> = Object.freeze({
  pingIntervalMs: 60_000,
  pongTimeoutMs: 30_000,
});

interface Sa7HubOpts {
  readonly verifyToken?: PeerTokenVerifier;
  readonly timeouts?: Readonly<Partial<ReplicationTimeouts>>;
  readonly limits?: Readonly<Partial<ReplicationLimits>>;
  readonly transportFactory?: (socket: unknown) => unknown;
}

async function startSa7Hub(opts: Sa7HubOpts = {}) {
  const fixture = makeTestRegistry();
  const ns = await makeHubNamespace(fixture.registry);
  const server = createYjsHubServer({
    role: 'hub',
    instanceId: HUB_INSTANCE,
    listen: { host: '127.0.0.1', port: 0 },
    verifyToken: opts.verifyToken ?? makeVerifier(),
    authorize: allowAll(),
    registry: fixture.registry,
    ...(opts.limits !== undefined ? { limits: opts.limits } : {}),
    ...(opts.timeouts !== undefined ? { timeouts: opts.timeouts } : {}),
    ...(opts.transportFactory !== undefined
      ? { transportFactory: opts.transportFactory as never }
      : {}),
  });
  const addr = await server.start();
  return { server, port: addr.port, fixture, ns };
}

function helloMsg(): Parameters<PeerWire['send']>[0] {
  return {
    kind: 'HELLO',
    peerInstanceId: PEER_INSTANCE,
    expectedHubInstanceId: HUB_INSTANCE,
    protocolVersions: [1],
    requiredCapabilities: 0,
    optionalCapabilities: 0,
    connectionNonce: crypto.randomBytes(16),
  };
}

/** HELLO → HELLO_ACK（升级已过预验证，101 后协议握手成立）。 */
async function established(wire: PeerWire): Promise<void> {
  wire.send(helloMsg());
  await wire.waitKind('HELLO_ACK');
}

/** 打开活跃 namespace channel（bootstrap 全流程，channel 进入非终态活跃）。 */
async function openActiveChannel(wire: PeerWire, namespaceId: string): Promise<void> {
  wire.send({ kind: 'OPEN_NAMESPACE', namespaceId, hasLocalReplica: false });
  await wire.waitKind('OPEN_OK');
  const snapshot = await wire.waitKind('BOOTSTRAP_SNAPSHOT');
  wire.send({ kind: 'BOOTSTRAP_ACK', namespaceId, ackedSequence: snapshot.header.sequence });
}

/** 断言端口已拒绝新连接（listen 已停）。 */
async function expectRefused(port: number): Promise<void> {
  let refused = false;
  try {
    const again = await wsUpgrade({ port, handshakeTimeoutMs: 2_000 });
    refused = again.status !== 101;
  } catch {
    refused = true;
  }
  expect(refused).toBe(true);
}

// ═══════════════════════════ DV1（SA4 §5-1 / A5） ═══════════════════════════

describe('issue #164 SA7 动态验证：SA4 §5 动态审核重点', () => {
  it('DV1（A5）：同步 throw 的 verifier + 合法 Bearer → HTTP 403（非 101、非进程崩溃），进程级异常计数 0', async () => {
    let uncaught = 0;
    let unhandled = 0;
    const onUncaught = (): void => {
      uncaught += 1;
    };
    const onUnhandled = (): void => {
      unhandled += 1;
    };
    process.on('uncaughtException', onUncaught);
    process.on('unhandledRejection', onUnhandled);
    const ctx = await startSa7Hub({
      // 同步 throw 的非 async 宿主 verifier（SA2 §R1.4-1 原文形态）
      verifyToken: () => {
        throw new Error('sync-throw-from-verifier');
      },
    });
    try {
      const outcome = await wsUpgrade({
        port: ctx.port,
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });
      expect(outcome.status).toBe(403);
      expect(outcome.ws).toBeUndefined();
      expect(outcome.headers.get('sec-websocket-accept') ?? '').toBe('');
      // 同一连接预算内二次请求：失败不污染后续裁决（仍 403，非 101/非崩溃）
      const second = await wsUpgrade({
        port: ctx.port,
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });
      expect(second.status).toBe(403);
      // 结算窗：同步 throw 若逃逸 promise 折叠，必然以进程级异常浮出
      await new Promise<void>((resolve) => setTimeout(resolve, 150));
      expect(uncaught).toBe(0);
      expect(unhandled).toBe(0);
    } finally {
      process.off('uncaughtException', onUncaught);
      process.off('unhandledRejection', onUnhandled);
      await ctx.server.close();
    }
  });

  // ═══════════════════════════ DV2（SA4 §5-2 / A1，子进程探针） ═══════════════════════════

  it('DV2（A1）：无 alert + 缺面 transportFactory → uncaughtException 捕获 TypeError(含 bufferedAmount)，unhandledRejection 零触达，零 HELLO_ACK + 1011 收口', { timeout: 60_000 }, async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const probePath = path.join(here, 'sa7-a1-probe.mts');
    // test/ → yjs-server/ → apps/ → worktree 根（tsx 是根 devDependency）
    const tsxBin = path.resolve(here, '..', '..', '..', 'node_modules', '.bin', 'tsx');
    const run = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
      const child = spawn(tsxBin, [probePath], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      child.on('error', (err: Error) => {
        resolve({ code: -1, stdout, stderr: stderr + String(err) });
      });
      child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
    });
    expect(
      run.stderr,
      `探针 stderr 非空：${run.stderr}`,
    ).toBe('');
    expect(run.code, `探针退出码异常：${run.stdout}`).toBe(0);
    const line = run.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('SA7_A1_PROBE_RESULT '));
    expect(line, `探针未输出结果行：${run.stdout}`).toHaveLength(1);
    const result = JSON.parse(line[0]!.slice('SA7_A1_PROBE_RESULT '.length)) as {
      upgradeStatus: number;
      closeCode: number | undefined;
      closeReason: string | undefined;
      frames: string[];
      uncaughtCount: number;
      uncaughtFirst: { name: string; message: string } | undefined;
      unhandledCount: number;
    };
    // 升级成功 + 缺面在装配期被拒（不是 HTTP 层）
    expect(result.upgradeStatus).toBe(101);
    // 零协议分配：无任何协议帧（更无 HELLO_ACK）
    expect(result.frames).toEqual([]);
    // 连接以 1011 'transport-faces-missing' 收口（响亮拒绝含连接收口）
    expect(result.closeCode).toBe(1011);
    expect(result.closeReason).toBe('transport-faces-missing');
    // P14 通道选择：缺省 alert 的 TypeError 到达 uncaughtException（同步异常域）
    expect(result.uncaughtCount).toBeGreaterThanOrEqual(1);
    expect(result.uncaughtFirst?.name).toBe('TypeError');
    expect(result.uncaughtFirst?.message).toContain('bufferedAmount');
    // unhandledRejection 处理器零触达（钉死通道不是 promise 域）
    expect(result.unhandledCount).toBe(0);
  });

  // ═══════════════════════════ DV3（SA4 §5-3 / A2） ═══════════════════════════

  it('DV3（A2）：永不 resolve 的 verifier → helloTimeoutMs + slack 内 503 Auth Timeout（pre-auth 封顶），服务存活', async () => {
    const helloTimeoutMs = 300;
    const ctx = await startSa7Hub({
      // 永不 settle 的 verifier（悬挂升级请求）
      verifyToken: () => new Promise(() => {}),
      timeouts: { helloTimeoutMs, ...QUIET_PING },
    });
    try {
      const t0 = Date.now();
      const outcome = await wsUpgrade({
        port: ctx.port,
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
        handshakeTimeoutMs: 10_000,
      });
      const elapsed = Date.now() - t0;
      expect(outcome.status).toBe(503);
      expect(outcome.statusLine).toContain('Auth Timeout');
      expect(outcome.ws).toBeUndefined();
      // 非即刻拒绝：真实等到 helloTimeoutMs 封顶（允许 100ms 调度松弛）
      expect(elapsed).toBeGreaterThanOrEqual(helloTimeoutMs - 100);
      // 封顶生效：远小于握手超时 10s（悬挂被打破）
      expect(elapsed).toBeLessThan(helloTimeoutMs + 2_000);
      // 进程存活：服务继续接受并裁决新连接（401 门即时路径仍工作）
      const follow = await wsUpgrade({ port: ctx.port });
      expect(follow.status).toBe(401);
    } finally {
      await ctx.server.close();
    }
  });

  // ═══════════════════════════ DV4（SA4 §5-4 / D7 maxPayload） ═══════════════════════════

  it('DV4（D7）：limits.maxFrameBytes 覆写传播至 ws maxPayload——认证前超限帧 1009、界内帧透传协议层 1002（双层同界）', async () => {
    // 覆写必须整组满足 validateLimits 链式不变量（bootstrap/syncDiff/update ≤ frame−128）
    const ctx = await startSa7Hub({
      limits: {
        maxFrameBytes: 4096,
        maxBootstrapBytes: 2048,
        maxSyncDiffBytes: 2048,
        maxUpdateBytes: 1024,
        maxQueuedUpdateBytes: 4096,
      },
    });
    try {
      // (a) 界内合法 HELLO（远小于 4096）→ 协议握手成立：界值正确传播而非 Degenerate
      const ok = await wsUpgrade({
        port: ctx.port,
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });
      expect(ok.status).toBe(101);
      const wireOk = new PeerWire(ok.ws as never);
      await established(wireOk);

      // (b) 认证前超限帧（payload 4097 > maxFrameBytes=4096）→ ws 层截断 1009，
      //     绝不透传协议层（若未传播，缺省 8 MiB 会放行 → 协议层 1002 而非 1009）
      const big = await wsUpgrade({
        port: ctx.port,
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });
      expect(big.status).toBe(101);
      const wireBig = new PeerWire(big.ws as never);
      wireBig.sendRaw(new Uint8Array(4097).fill(0xab));
      await waitUntil('超限连接被 1009 截断', () => wireBig.closed !== undefined, 5_000);
      expect(wireBig.closed?.code).toBe(1009);
      expect(wireBig.frames).toEqual([]);

      // (c) 界内垃圾帧（payload 4000 < 4096）→ 通过 ws 层 → 协议层解码失败：
      //     ERROR(BAD_MAGIC) 帧上 wire 后 close 1002（与 相同负载形态在 (b) 得 ws 层
      //     1009 对照，钉死边界恰为 limits.maxFrameBytes 覆写值）
      const small = await wsUpgrade({
        port: ctx.port,
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });
      expect(small.status).toBe(101);
      const wireSmall = new PeerWire(small.ws as never);
      wireSmall.sendRaw(new Uint8Array(4000).fill(0xcd));
      await waitUntil('界内垃圾帧被协议层拒绝', () => wireSmall.closed !== undefined, 5_000);
      expect(wireSmall.closed?.code).toBe(1002);
      // 协议层拒绝形态：ERROR(BAD_MAGIC) 帧先于 close，但零握手分配（无 HELLO_ACK）
      expect(wireSmall.frames.some((f) => f.message.kind === 'HELLO_ACK')).toBe(false);
      expect(wireSmall.frames.some((f) => f.message.kind === 'ERROR')).toBe(true);
    } finally {
      await ctx.server.close();
    }
  });

  // ═══════════════════════════ DV5（SA4 §5-5 / A4a EADDRINUSE） ═══════════════════════════

  it('DV5（A4a）：EADDRINUSE → start() reject；失败复位后重试报真实根因（非「重复 start」）；端口释放后同实例可复用', async () => {
    const occupier = net.createServer(() => undefined);
    await new Promise<void>((resolve) => {
      occupier.listen(0, '127.0.0.1', () => resolve());
    });
    const port = (occupier.address() as net.AddressInfo).port;
    const fixture = makeTestRegistry();
    const server = createYjsHubServer({
      role: 'hub',
      instanceId: HUB_INSTANCE,
      listen: { host: '127.0.0.1', port },
      verifyToken: makeVerifier(),
      authorize: allowAll(),
      registry: fixture.registry,
    });
    // 第一次 start()：真实系统错误 EADDRINUSE（同步 reject，非悬挂）
    const first = await server.start().then(
      () => 'resolved',
      (err: NodeJS.ErrnoException) => err.code ?? err.message,
    );
    expect(first).toBe('EADDRINUSE');
    // 失败复位后重试：必须仍是真实根因 EADDRINUSE，而非 YJS_HUB_SERVER_STARTED
    const second = await server.start().then(
      () => 'resolved',
      (err: NodeJS.ErrnoException) => err.code ?? err.message,
    );
    expect(second).toBe('EADDRINUSE');
    expect(String(second)).not.toContain('STARTED');
    // 端口释放后同一实例复用成功（started 复位语义）
    await new Promise<void>((resolve) => {
      occupier.close(() => resolve());
    });
    const third = await server.start();
    expect(third.port).toBe(port);
    // 复用后功能完整：401 门在占用过的端口上正常裁决
    const probe = await wsUpgrade({ port });
    expect(probe.status).toBe(401);
    await server.close();
  });

  // ═══════════════════════════ DV6（SA4 §5-6 / FS6 深水变体） ═══════════════════════════

  it('DV6a/#229：活跃 channel 下 close() 不发 GOAWAY，直接以 1001 收口并停止 Registry/端口', async () => {
    const closeTimeoutMs = 400;
    const ctx = await startSa7Hub({ timeouts: { closeTimeoutMs, ...QUIET_PING } });
    const upgrade = await wsUpgrade({
      port: ctx.port,
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(upgrade.status).toBe(101);
    const wire = new PeerWire(upgrade.ws as never);
    await established(wire);
    await openActiveChannel(wire, ctx.ns.namespaceId);

    const t0 = Date.now();
    await ctx.server.close();
    const closeElapsed = Date.now() - t0;

    expect(wire.frames.some((f) => f.message.kind === 'GOAWAY')).toBe(false);
    expect(closeElapsed).toBeLessThan(closeTimeoutMs + 3_000);
    // 连接以 1001 'hub-shutdown' 收口
    await waitUntil('连接以 1001 收口', () => wire.closed !== undefined, 5_000);
    expect(wire.closed?.code).toBe(1001);
    expect(wire.closed?.reason).toBe('hub-shutdown');
    // §21 编排：close() resolve 前 Registry 已停机
    expect(ctx.fixture.registry.getStatus().state).toBe('stopped');
    await expectRefused(ctx.port);
  });

});
