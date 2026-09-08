/**
 * issue #228 — 收尾验收 T-H5（design §6.2；task_228_design.md AD-7/R-2）
 * `host-namespace-delete-under-replication.test.ts`：**活跃 peer channel（trusted
 * 复制中）发起 delete-namespace 的行为锚**——AD-7/R-2 设计裁决的唯一测试锚
 * （SA4 review F-5：「在途 channel 异步失败通知」设计裁决当前零测试覆盖，收尾轮
 * 必须落地）。
 *
 * 钉住的裁决（AD-7，零 ws-replication 改动）：
 * 1. 删除发起时（AD-3 步骤 ②）同步摘除 bindings/knownNamespaces —— 新 channel
 *    建立的 authorize → 拒绝（重连窗口无再引导）；
 * 2. 已建立 channel 的 lease 指向的 Runtime 被 `registry.deleteNamespace` 关闭 →
 *    下一次 apply/encodeDiff 读 `lease.getStatus()` 得 runtime 缺席 → 既有错误路径
 *    （'lease released'）→ closeSessionAndRelease → **channel 失败收口不崩溃**；
 * 3. **无数据复活**：收口/重试窗口内 hub 数据快照与 `{logRoot}/namespaces/{ns}`
 *    诊断日志目录树保持 absent；
 * 4. hub 健康：通道收口后进程继续可用（status 回执、已删 ns 的 read →
 *    namespace-unknown）、后续 SIGTERM exit 0。
 *
 * 黑盒纪律（与红灯契约同款）：真实 spawn hub + peer（main.ts，file persistence +
 * diagnostics enabled + provision + 授权绑定）；stdin NDJSON 控制通道；真实 WS 复制
 * （ws://127.0.0.1）；断言只消费 stdout NDJSON 事件、真实文件产物与进程生命周期；
 * 零源码 grep、零 skip、零软兜底。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const TSX_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
const MAIN_TS = join(REPO_ROOT, 'apps', 'yjs-server', 'src', 'main.ts');

const SPAWN_NODE_OPTIONS = (() => {
  const existing = process.env.NODE_OPTIONS ?? '';
  return existing.includes('conditions=nomicore-source')
    ? existing
    : `${existing} --conditions=nomicore-source`.trim();
})();

const VFSL_SCHEMA = Object.freeze({
  lang: 'vfsl',
  version: 1,
  id: 'notes-v1',
  text: 'type ROOT = { count: number; };\n',
});

const PROVISION = Object.freeze({ id: 'p1', ownerUserId: 'alice', schema: VFSL_SCHEMA, root: { count: 0 } });

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close(() => reject(new Error('no tcp address')));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

interface Proc {
  child: ChildProcess;
  events: Array<Record<string, unknown>>;
  stderr: string[];
  exitCode: number | null;
}

const liveProcs: Proc[] = [];
const tmpDirs: string[] = [];

function makeTmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function writeConfig(dir: string, config: Record<string, unknown>): string {
  const path = join(dir, 'config.json');
  writeFileSync(path, JSON.stringify(config, null, 2));
  return path;
}

function spawnApp(args: string[]): Proc {
  const child = spawn(TSX_BIN, [MAIN_TS, ...args], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, NODE_OPTIONS: SPAWN_NODE_OPTIONS },
  });
  const proc: Proc = { child, events: [], stderr: [], exitCode: null };
  child.stdout!.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        proc.events.push(JSON.parse(trimmed) as Record<string, unknown>);
      } catch {
        proc.events.push({ __raw: trimmed });
      }
    }
  });
  child.stderr!.on('data', (chunk: Buffer) => {
    proc.stderr.push(chunk.toString('utf8'));
  });
  child.on('exit', (code) => {
    proc.exitCode = code;
  });
  liveProcs.push(proc);
  return proc;
}

async function waitForEvent(
  proc: Proc,
  predicate: (e: Record<string, unknown>) => boolean,
  timeoutMs: number,
  what: string,
): Promise<Record<string, unknown>> {
  const start = Date.now();
  for (;;) {
    const hit = proc.events.find(predicate);
    if (hit) return hit;
    if (proc.exitCode !== null) {
      throw new Error(
        `process exited with code ${proc.exitCode} before ${what}\nstderr:\n${proc.stderr.join('')}`,
      );
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timeout ${timeoutMs}ms waiting for ${what}\nstderr:\n${proc.stderr.join('')}`);
    }
    await sleep(50);
  }
}

async function waitForExit(proc: Proc, timeoutMs: number, what: string): Promise<number> {
  const start = Date.now();
  while (proc.exitCode === null) {
    if (Date.now() - start > timeoutMs) {
      proc.child.kill('SIGKILL');
      throw new Error(`timeout ${timeoutMs}ms waiting for ${what} to exit`);
    }
    await sleep(50);
  }
  return proc.exitCode;
}

async function signalAndExpectExit(
  proc: Proc,
  signal: NodeJS.Signals,
  timeoutMs: number,
  expectedCode: number,
  what: string,
): Promise<void> {
  proc.child.kill(signal);
  const code = await waitForExit(proc, timeoutMs, what);
  expect(code, `${what} exit code`).toBe(expectedCode);
}

let opCounter = 0;
async function sendOp(proc: Proc, op: Record<string, unknown>, timeoutMs = 60_000): Promise<Record<string, unknown>> {
  const id = `sa6-228h5-${++opCounter}`;
  const serialized = JSON.stringify({ ...op, id });
  await new Promise<void>((resolve, reject) => {
    proc.child.stdin!.write(`${serialized}\n`, (err) => (err ? reject(err) : resolve()));
  });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = proc.events.find((e) => e.event === 'reply' && e.id === id);
    if (hit) return hit;
    if (proc.exitCode !== null) {
      throw new Error(
        `process exited with code ${proc.exitCode} awaiting reply to ${serialized}\nstderr:\n${proc.stderr.join('')}`,
      );
    }
    await sleep(50);
  }
  throw new Error(`timeout ${timeoutMs}ms awaiting reply to ${serialized}`);
}

afterEach(() => {
  for (const proc of liveProcs) {
    if (proc.exitCode === null) {
      proc.child.kill('SIGKILL');
    }
  }
  liveProcs.length = 0;
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 配置 / 磁盘布局辅助（ADR-0006 数据面 + ADR-0014-LOG 日志布局）
// ─────────────────────────────────────────────────────────────────────────────

function hubConfig(opts: { persistRoot: string; logRootDir: string; port: number }): Record<string, unknown> {
  return {
    role: 'hub',
    instanceId: 'hub-1',
    persistence: { kind: 'file', rootDir: opts.persistRoot },
    hub: {
      listen: { host: '127.0.0.1', port: opts.port },
      tokens: { 'peer-1': 'token-1' },
      provision: [PROVISION],
      // provision 形态授权：peer-1 对 p1 具 read+submit（p1 物化时绑定真实 nsId）
      authorization: [{ peerInstanceId: 'peer-1', provisionId: 'p1', read: true, submit: true }],
    },
    diagnostics: { enabled: true, rootDir: opts.logRootDir, updateCapture: true, inputPolicy: 'digest' },
  };
}

function peerConfig(port: number, namespaceId: string): Record<string, unknown> {
  return {
    role: 'peer',
    instanceId: 'peer-1',
    persistence: { kind: 'memory' },
    peer: {
      hub: { url: `ws://127.0.0.1:${port}/replication`, hubInstanceId: 'hub-1', token: 'token-1' },
      targets: [{ namespaceId, ownerUserId: 'alice' }],
    },
  };
}

function namespaceLogDir(logRootDir: string, namespaceId: string): string {
  return join(logRootDir, 'namespaces', namespaceId);
}

function currentStreamIdOf(logRootDir: string, namespaceId: string): string | null {
  const file = join(namespaceLogDir(logRootDir, namespaceId), 'current.json');
  if (!existsSync(file)) return null;
  const locator = JSON.parse(readFileSync(file, 'utf8')) as { streamId?: unknown };
  return typeof locator.streamId === 'string' ? locator.streamId : null;
}

/** 真实落盘快照路径集合（ADR-0006：{persistRoot}/users/.../*.snapshot）。 */
function snapshotPathsOf(persistRoot: string): string[] {
  const out: string[] = [];
  const usersDir = join(persistRoot, 'users');
  if (!existsSync(usersDir)) return out;
  for (const user of readdirSync(usersDir)) {
    const userDir = join(usersDir, user);
    if (!existsSync(userDir)) continue;
    for (const file of readdirSync(userDir)) {
      if (file.endsWith('.snapshot')) out.push(join(userDir, file));
    }
  }
  return out;
}

/** 就绪等待（hub：provisioned + ready）。返回 provision 产出的 namespaceId。 */
async function bootHub(persistRoot: string, logRoot: string, what: string): Promise<{ proc: Proc; namespaceId: string }> {
  const port = await freePort();
  const config = hubConfig({ persistRoot, logRootDir: logRoot, port });
  const proc = spawnApp(['--config', writeConfig(makeTmpDir(`sa6-228-h5-${what}-cfg-`), config)]);
  const provisioned = await waitForEvent(proc, (e) => e.event === 'provisioned', 60_000, `${what} provisioned`);
  const namespaceId = provisioned.namespaceId as string;
  expect(namespaceId).toMatch(/^ns-[0-9a-f]{32}$/);
  await waitForEvent(proc, (e) => e.event === 'ready', 60_000, `${what} ready`);
  return { proc, namespaceId };
}

describe('issue #228 — T-H5 删除×复制：活跃 peer channel（trusted 复制中）发起 delete-namespace（AD-7/R-2 行为锚）', () => {
  it(
    'hub 与 peer channel 达 live 且双向收敛后 delete → ack ok 且数据/日志全清；channel 失败收口（hub 事件终态、进程不崩）；重试/收口窗口内无快照复活、无日志重建；hub 健康直至干净停机',
    async () => {
      const persistRoot = makeTmpDir('sa6-228-h5-persist-');
      const logRoot = makeTmpDir('sa6-228-h5-log-');
      const port = await freePort();

      // ── Phase A：hub + peer（真实 WS trusted 复制），channel 达 live 且双向收敛 ──
      const hubConfigObj = hubConfig({ persistRoot, logRootDir: logRoot, port });
      const hub = spawnApp(['--config', writeConfig(makeTmpDir('sa6-228-h5-hub-cfg-'), hubConfigObj)]);
      const provisioned = await waitForEvent(hub, (e) => e.event === 'provisioned', 60_000, 'hub provisioned');
      const namespaceId = provisioned.namespaceId as string;
      expect(namespaceId).toMatch(/^ns-[0-9a-f]{32}$/);
      await waitForEvent(hub, (e) => e.event === 'ready', 60_000, 'hub ready');

      const peer = spawnApp(['--config', writeConfig(makeTmpDir('sa6-228-h5-peer-cfg-'), peerConfig(port, namespaceId))]);
      await waitForEvent(peer, (e) => e.event === 'ready', 60_000, 'peer ready');

      // 前置条件：诊断日志建流落盘 + hub 数据快照落盘
      await expect
        .poll(
          () => {
            const sid = currentStreamIdOf(logRoot, namespaceId);
            if (sid === null) return false;
            const segments = join(namespaceLogDir(logRoot, namespaceId), 'streams', sid, 'segments');
            if (!existsSync(segments)) return false;
            return readdirSync(segments).some((name) => name.endsWith('.jsonl'));
          },
          { interval: 20, timeout: 5_000 },
        )
        .toBe(true);
      await expect
        .poll(
          () => snapshotPathsOf(persistRoot).length > 0,
          { interval: 20, timeout: 5_000 },
        )
        .toBe(true);

      // 活跃 channel：hub 侧达 live（真实 WS 通道建立、OPEN/BOOTSTRAP 完成）
      await waitForEvent(
        hub,
        (e) =>
          e.event === 'channel-state-changed' &&
          e.side === 'hub' &&
          e.namespaceId === namespaceId &&
          e.to === 'live',
        60_000,
        'hub 侧 channel live',
      );
      // 双向复制证据：hub 本地写 → peer 收敛；peer 写 → hub 收敛（apply 路径双向活）
      const writeHub = await sendOp(
        hub,
        { op: 'verify-write', namespaceId, set: ['count'], path: ['count'], value: 5, timeoutMs: 30_000 },
        60_000,
      );
      expect(writeHub.ok, `hub 本地写（${JSON.stringify(writeHub)}）`).toBe(true);
      await expect
        .poll(
          async () => (await sendOp(peer, { op: 'read', namespaceId, path: ['count'] }, 20_000)).value,
          { interval: 100, timeout: 30_000 },
        )
        .toBe(5);
      const writePeer = await sendOp(
        peer,
        { op: 'verify-write', namespaceId, set: ['count'], path: ['count'], value: 7, timeoutMs: 30_000 },
        60_000,
      );
      expect(writePeer.ok, `peer 写（${JSON.stringify(writePeer)}）`).toBe(true);
      await expect
        .poll(
          async () => (await sendOp(hub, { op: 'read', namespaceId, path: ['count'] }, 20_000)).value,
          { interval: 100, timeout: 30_000 },
        )
        .toBe(7);

      // ── Phase B：活跃 channel 中 delete（AD-7：在途 channel = 异步失败通知）──
      const reply = await sendOp(hub, { op: 'delete-namespace', namespaceId }, 30_000);
      expect(reply.ok, `delete 回执（${JSON.stringify(reply)}）`).toBe(true);
      expect(
        hub.events.some((e) => e.event === 'namespace-deleted' && e.namespaceId === namespaceId),
        'hub 必须发射 namespace-deleted 生命周期事件',
      ).toBe(true);
      // 同步窗口：ack 之后同一回执周期内快照与日志目录树已逻辑删除
      expect(snapshotPathsOf(persistRoot), 'hub 数据快照必须全 absent').toHaveLength(0);
      expect(existsSync(namespaceLogDir(logRoot, namespaceId)), '诊断日志目录树必须 absent').toBe(false);

      // ── Phase C：channel 失败收口（零崩溃）——删除后继续从 peer 写，驱动 hub 侧
      //    apply/encodeDiff 命中 runtime 缺席错误路径（'lease released' →
      //    closeSessionAndRelease）。写与观测交错（写驱动收口，收口本身异步）。
      const driverReplies: Array<Promise<Record<string, unknown>>> = [];
      for (const value of [8, 9, 10]) {
        driverReplies.push(
          sendOp(peer, { op: 'verify-write', namespaceId, set: ['count'], path: ['count'], value, timeoutMs: 8_000 }, 20_000).catch(() => ({ ok: false })),
        );
        await sleep(600);
      }
      const terminalDeadline = Date.now() + 30_000;
      let terminal = false;
      for (;;) {
        terminal =
          hub.events.some(
            (e) =>
              e.event === 'channel-state-changed' &&
              e.side === 'hub' &&
              e.namespaceId === namespaceId &&
              (e.to === 'closed' || e.to === 'conflicted' || e.to === 'failed'),
          ) ||
          hub.events.some(
            (e) => e.event === 'namespace-error' && e.side === 'hub' && e.namespaceId === namespaceId,
          ) ||
          peer.events.some(
            (e) =>
              e.event === 'channel-state-changed' &&
              e.side === 'peer' &&
              e.namespaceId === namespaceId &&
              (e.to === 'closed' || e.to === 'conflicted' || e.to === 'failed' || e.to === 'disconnected'),
          ) ||
          peer.events.some(
            (e) => e.event === 'namespace-error' && e.side === 'peer' && e.namespaceId === namespaceId,
          );
        if (terminal) break;
        if (Date.now() > terminalDeadline) {
          throw new Error(
            'T-H5 Phase C：delete 后 30s 内未见任一侧 channel 失败收口事件\n' +
              `hub recent events:\n${hub.events.slice(-20).map((e) => JSON.stringify(e)).join('\n')}\n` +
              `peer recent events:\n${peer.events.slice(-20).map((e) => JSON.stringify(e)).join('\n')}\n` +
              `peer stderr:\n${peer.stderr.slice(-10).join('')}\nhub stderr:\n${hub.stderr.slice(-10).join('')}`,
          );
        }
        await sleep(100);
      }
      await Promise.allSettled(driverReplies);
      expect(peer.exitCode, 'peer 进程不得崩溃').toBeNull();
      expect(hub.exitCode, 'hub 进程不得崩溃').toBeNull();

      // ── Phase D：收口/重试窗口内无复活（hub 快照恒 absent、日志树恒 absent）──
      //    窗口内继续从 peer 发驱动写（不 await——回执内容非断言面）：即使引擎仍
      //    存在再引导/重试尝试，hub 侧数据与日志也必须保持 absent。
      const retryDrivers: Array<Promise<Record<string, unknown>>> = [
        sendOp(peer, { op: 'verify-write', namespaceId, set: ['count'], path: ['count'], value: 12, timeoutMs: 6_000 }, 15_000).catch(() => ({ ok: false })),
        sendOp(peer, { op: 'verify-write', namespaceId, set: ['count'], path: ['count'], value: 13, timeoutMs: 6_000 }, 15_000).catch(() => ({ ok: false })),
      ];
      const deadline = Date.now() + 4_000;
      for (;;) {
        expect(snapshotPathsOf(persistRoot), '收口窗口内 hub 快照不得复活').toHaveLength(0);
        expect(existsSync(namespaceLogDir(logRoot, namespaceId)), '收口窗口内日志目录不得重建').toBe(false);
        if (Date.now() > deadline) break;
        await sleep(200);
      }
      await Promise.allSettled(retryDrivers);

      // ── hub 健康：dispatch 存活、已删 ns 走 G3 门 → namespace-unknown ──
      const status = await sendOp(hub, { op: 'status' }, 20_000);
      expect(status.ok).toBe(true);
      const readDeleted = await sendOp(hub, { op: 'read', namespaceId, path: ['count'] }, 20_000);
      expect(readDeleted.ok).toBe(false);
      expect(readDeleted.code).toBe('namespace-unknown');
      const unknownDelete = await sendOp(
        hub,
        { op: 'delete-namespace', namespaceId: 'ns-ffffffffffffffffffffffffffffffff' },
        20_000,
      );
      expect(unknownDelete.code).toBe('namespace-unknown');

      // ── 干净停机（双向 exit 0）──
      await signalAndExpectExit(peer, 'SIGTERM', 30_000, 0, 'peer T-H5');
      await sleep(1_500); // tsx wrapper ready 窗口 settle（红灯套件同款注记）
      await signalAndExpectExit(hub, 'SIGTERM', 30_000, 0, 'hub T-H5');
    },
    300_000,
  );
});
