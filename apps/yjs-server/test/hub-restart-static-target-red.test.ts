/**
 * Issue #229 真实进程回归：Hub 正常 SIGTERM 不发送 GOAWAY；Peer 保持运行、保留静态
 * target 并进入普通 backoff。同 rootDir、同 endpoint、同凭据重启 Hub 后，不重启 Peer、
 * 不 re-add target、不 notify-auth-changed、不改配置，Peer 自动重新 OPEN/reconcile 并
 * 收敛 Hub 在断线期间写入的数据。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const TSX_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
const MAIN_TS = join(REPO_ROOT, 'apps', 'yjs-server', 'src', 'main.ts');

const VFSL_SCHEMA = { lang: 'vfsl', version: 1, id: 'notes-v1', text: 'type ROOT = { count: number; };\n' };

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
  raw: string[];
  events: Array<Record<string, unknown>>;
  stderr: string[];
  exitCode: number | null;
}

const liveProcs: Proc[] = [];

function spawnApp(args: string[]): Proc {
  const child = spawn(TSX_BIN, [MAIN_TS, ...args], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, '--conditions=nomicore-source'].filter(Boolean).join(' '),
    },
  });
  const proc: Proc = { child, raw: [], events: [], stderr: [], exitCode: null };
  child.stdout!.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      proc.raw.push(trimmed);
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
  fromIndex = 0,
): Promise<Record<string, unknown>> {
  const start = Date.now();
  for (;;) {
    const hit = proc.events.slice(fromIndex).find(predicate);
    if (hit) return hit;
    if (proc.exitCode !== null) {
      throw new Error(
        `process exited with code ${proc.exitCode} before ${what}\nstderr:\n${proc.stderr.join('')}`,
      );
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `timeout ${timeoutMs}ms waiting for ${what}\nstderr:\n${proc.stderr.join('')}`,
      );
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

async function signalAndExpectExit(proc: Proc, signal: NodeJS.Signals, timeoutMs: number, expectedCode: number, what: string): Promise<void> {
  proc.child.kill(signal);
  const code = await waitForExit(proc, timeoutMs, what);
  expect(code, `${what} exit code`).toBe(expectedCode);
}

let opCounter = 0;
async function sendOp(proc: Proc, op: Record<string, unknown>, timeoutMs = 60_000): Promise<Record<string, unknown>> {
  const id = `sa6-${++opCounter}`;
  const request = { ...op, id };
  const serialized = JSON.stringify(request);
  await new Promise<void>((resolve, reject) => {
    proc.child.stdin!.write(serialized + '\n', (err) => (err ? reject(err) : resolve()));
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

function writeConfig(dir: string, config: Record<string, unknown>): string {
  const path = join(dir, 'config.json');
  writeFileSync(path, JSON.stringify(config, null, 2));
  return path;
}

const tmpDirs: string[] = [];
function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'yjs-server-t6-'));
  tmpDirs.push(dir);
  return dir;
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

describe('issue #229：Hub 正常重启后 Peer 自动恢复静态 target', () => {
  it(
    'live → Hub SIGTERM → Peer 保持运行并 backoff → 同 endpoint 重启 → 自动 live 且收敛断线期 Hub 写',
    async () => {
      const hubRoot = makeTmpDir();
      const port = await freePort();

      // ── hub v1：file 持久化 + provision（无 authorization）——仅播种持久 ns ──
      const hubV1Config = {
        role: 'hub',
        instanceId: 'hub-1',
        persistence: { kind: 'file', rootDir: hubRoot },
        hub: {
          listen: { host: '127.0.0.1', port },
          tokens: { 'peer-1': 'token-1' },
          provision: [{ id: 'p1', ownerUserId: 'alice', schema: VFSL_SCHEMA, root: { count: 0 } }],
        },
      };
      const hubV1 = spawnApp(['--config', writeConfig(makeTmpDir(), hubV1Config)]);
      const provisioned = await waitForEvent(hubV1, (e) => e.event === 'provisioned', 60_000, 'hub v1 provisioned');
      const namespaceId = provisioned.namespaceId as string;
      expect(namespaceId).toMatch(/^ns-[0-9a-f]{32}$/);
      await waitForEvent(hubV1, (e) => e.event === 'ready', 60_000, 'hub v1 ready');
      await signalAndExpectExit(hubV1, 'SIGTERM', 30_000, 0, 'hub v1');

      // ── hub v2：同 rootDir，直引形式 authorization（生产主路径）+ 同一端口 ──
      const hubV2Config = {
        role: 'hub',
        instanceId: 'hub-1',
        persistence: { kind: 'file', rootDir: hubRoot },
        hub: {
          listen: { host: '127.0.0.1', port },
          tokens: { 'peer-1': 'token-1' },
          authorization: [
            { peerInstanceId: 'peer-1', namespaceId, ownerUserId: 'alice', read: true, submit: true },
          ],
        },
      };
      const configV2Path = writeConfig(makeTmpDir(), hubV2Config);
      const hubV2 = spawnApp(['--config', configV2Path]);
      await waitForEvent(hubV2, (e) => e.event === 'ready', 60_000, 'hub v2 ready');

      // ── peer：配置态静态 targets（不经 add-target）──
      const peerProc = spawnApp([
        '--config',
        writeConfig(makeTmpDir(), {
          role: 'peer',
          instanceId: 'peer-1',
          persistence: { kind: 'memory' },
          peer: {
            hub: { url: `ws://127.0.0.1:${port}/replication`, hubInstanceId: 'hub-1', token: 'token-1' },
            targets: [{ namespaceId, ownerUserId: 'alice' }],
          },
          backoff: { baseMs: 5_000, maxMs: 5_000, resetAfterMs: 60_000 },
        }),
      ]);
      await waitForEvent(peerProc, (e) => e.event === 'ready', 60_000, 'peer ready');

      // ── bootstrap live 基线 ──
      const baselineWrite = await sendOp(peerProc, { op: 'verify-write', namespaceId, set: ['count'], path: ['count'], value: 7, timeoutMs: 30_000 }, 60_000);
      expect(baselineWrite.ok).toBe(true);
      const baselineRead = await sendOp(hubV2, { op: 'read', namespaceId, path: ['count'] }, 20_000);
      expect(baselineRead.ok).toBe(true);
      expect(baselineRead.value).toBe(7);

      // ── Hub 正常 SIGTERM：不发 GOAWAY，Peer 保持运行并进入普通 backoff ──
      const peerEventOffset = peerProc.events.length;
      await signalAndExpectExit(hubV2, 'SIGTERM', 30_000, 0, 'hub v2 (restart source)');
      await waitForEvent(
        peerProc,
        (e) => e.event === 'connection-backoff-scheduled',
        30_000,
        'peer backoff after Hub shutdown',
        peerEventOffset,
      );
      const shutdownEvents = peerProc.events.slice(peerEventOffset);
      expect(
        shutdownEvents.some((e) => e.event === 'connection-backoff-scheduled'),
        JSON.stringify(shutdownEvents),
      ).toBe(true);
      expect(shutdownEvents.some((e) => e.event === 'goaway-received')).toBe(false);
      expect(shutdownEvents.some((e) => e.event === 'connection-state-changed' && e.to === 'blocked')).toBe(false);
      expect(peerProc.exitCode).toBeNull();

      // ── 同 rootDir、同 endpoint 重启 Hub；Peer target/凭据/配置均不变化，也不发恢复命令 ──
      const hubV2b = spawnApp(['--config', configV2Path]);
      await waitForEvent(hubV2b, (e) => e.event === 'ready', 60_000, 'hub v2 ready (restart)');

      // 在 Peer 尚处于 backoff/disconnected 时立即写 Hub；长 backoff 配置保证写入先于重拨。
      const statusBeforeWrite = await sendOp(peerProc, { op: 'status' }, 20_000);
      expect(statusBeforeWrite.connectionState).toBe('backoff');
      const disconnectedWrite = await sendOp(
        hubV2b,
        { op: 'verify-write', namespaceId, set: ['count'], path: ['count'], value: 11, timeoutMs: 30_000 },
        60_000,
      );
      expect(disconnectedWrite.ok).toBe(true);

      // 不重启 Peer、不 re-add target、不 notify-auth-changed、不改配置；等待既有静态 target 自动恢复。
      await waitForEvent(
        peerProc,
        (e) => e.event === 'channel-state-changed' && e.namespaceId === namespaceId && e.to === 'live',
        60_000,
        'peer target live after hub restart',
        peerEventOffset,
      );
      let recoveredRead: Record<string, unknown> | undefined;
      const reconcileDeadline = Date.now() + 30_000;
      while (Date.now() < reconcileDeadline) {
        recoveredRead = await sendOp(peerProc, { op: 'read', namespaceId, path: ['count'] }, 20_000);
        if (recoveredRead.ok === true && recoveredRead.value === 11) break;
        await sleep(100);
      }
      expect(recoveredRead?.ok).toBe(true);
      expect(recoveredRead?.value).toBe(11);

      await signalAndExpectExit(peerProc, 'SIGTERM', 30_000, 0, 'peer');
      await signalAndExpectExit(hubV2b, 'SIGTERM', 30_000, 0, 'hub v2 (restart)');
    },
    240_000,
  );
});
