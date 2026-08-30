/**
 * [SA6 owned] T3-skeleton — AC7 真进程冒烟（设计 §5-T3 最小骨架）+ AC2 锁守卫。
 *
 * 覆盖（最小必要）：hub 启动序 `provisioned → listening(实际 port) → ready`（port 0
 * ephemeral 上报）；peer 静态 target 认证连接 + `verify-write` 收敛；hub `read`
 * 回读相等；SIGTERM 双进程 exit 0；同 rootDir 干净停机后重启可再 boot（锁文件随
 * 干净停机删除，R1 #5）且 durable 回读相等；共享活跃 root 的第二实例被 loud 拒绝。
 *
 * RED 基线：`apps/yjs-server/src/main.ts` 尚不存在（SA3 未实现）→ spawn 即刻失败，
 * 每个用例在等待 NDJSON 事件处抛「进程提前退出」错误。
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
    env: { ...process.env },
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

function hubConfigFile(rootDir: string, listenPort: number): Record<string, unknown> {
  return {
    role: 'hub',
    instanceId: 'hub-1',
    persistence: { kind: 'file', rootDir },
    hub: {
      listen: { host: '127.0.0.1', port: listenPort },
      tokens: { 'peer-1': 'token-1' },
      provision: [{ id: 'p1', ownerUserId: 'alice', schema: VFSL_SCHEMA, root: { count: 0 } }],
      authorization: [{ peerInstanceId: 'peer-1', provisionId: 'p1', read: true, submit: true }],
    },
  };
}

function peerConfig(hubUrl: string, namespaceId: string): Record<string, unknown> {
  return {
    role: 'peer',
    instanceId: 'peer-1',
    persistence: { kind: 'memory' },
    peer: {
      hub: { url: hubUrl, hubInstanceId: 'hub-1', token: 'token-1' },
      targets: [{ namespaceId, ownerUserId: 'alice' }],
    },
  };
}

const tmpDirs: string[] = [];
function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'yjs-server-smoke-'));
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

describe('T3-skeleton real-process smoke (design §5-T3 minimized / AC7/AC2)', () => {
  it(
    'hub emits provisioned→listening(actual port)→ready; peer authenticates static target; verify-write converges to hub read; SIGTERM exits 0',
    async () => {
      const hubRoot = makeTmpDir();
      const hubProc = spawnApp(['--config', writeConfig(hubRoot, hubConfigFile(hubRoot, 0))]);

      const provisioned = await waitForEvent(hubProc, (e) => e.event === 'provisioned', 60_000, 'hub provisioned');
      const namespaceId = provisioned.namespaceId as string;
      expect(namespaceId).toMatch(/^ns-[0-9a-f]{32}$/);

      const listening = await waitForEvent(hubProc, (e) => e.event === 'listening', 60_000, 'hub listening');
      const actualPort = listening.port as number;
      expect(typeof actualPort).toBe('number');

      await waitForEvent(hubProc, (e) => e.event === 'ready', 60_000, 'hub ready');

      const order = hubProc.events
        .filter((e) => e.event === 'provisioned' || e.event === 'listening' || e.event === 'ready')
        .map((e) => e.event as string);
      expect(order).toEqual(['provisioned', 'listening', 'ready']);

      const peerProc = spawnApp(['--config', writeConfig(makeTmpDir(), peerConfig(`ws://127.0.0.1:${actualPort}/replication`, namespaceId))]);
      await waitForEvent(peerProc, (e) => e.event === 'ready', 60_000, 'peer ready');

      const writeReply = await sendOp(peerProc, {
        op: 'verify-write',
        namespaceId,
        set: ['count'],
        path: ['count'],
        value: 1,
        timeoutMs: 30_000,
      }, 60_000);
      expect(writeReply.ok).toBe(true);

      const readReply = await sendOp(hubProc, { op: 'read', namespaceId, path: ['count'] }, 20_000);
      expect(readReply.ok).toBe(true);
      expect(readReply.value).toBe(1);

      await signalAndExpectExit(hubProc, 'SIGTERM', 30_000, 0, 'hub');
      await signalAndExpectExit(peerProc, 'SIGTERM', 30_000, 0, 'peer');
    },
    180_000,
  );

  it(
    'clean shutdown releases the rootDir lock: same rootDir restarts and reads back the durable value',
    async () => {
      const hubRoot = makeTmpDir();
      const port = await freePort();
      const configPath = writeConfig(hubRoot, hubConfigFile(hubRoot, port));

      const hubProc = spawnApp(['--config', configPath]);
      const provisioned = await waitForEvent(hubProc, (e) => e.event === 'provisioned', 60_000, 'hub provisioned (restart test)');
      const namespaceId = provisioned.namespaceId as string;
      await waitForEvent(hubProc, (e) => e.event === 'ready', 60_000, 'hub ready (restart test)');

      const peerProc = spawnApp(['--config', writeConfig(makeTmpDir(), peerConfig(`ws://127.0.0.1:${port}/replication`, namespaceId))]);
      await waitForEvent(peerProc, (e) => e.event === 'ready', 60_000, 'peer ready (restart test)');

      const writeReply = await sendOp(peerProc, { op: 'verify-write', namespaceId, set: ['count'], path: ['count'], value: 41, timeoutMs: 30_000 }, 60_000);
      expect(writeReply.ok).toBe(true);

      await signalAndExpectExit(hubProc, 'SIGTERM', 30_000, 0, 'hub (first boot)');
      await signalAndExpectExit(peerProc, 'SIGTERM', 30_000, 0, 'peer (first boot)');

      // 同 rootDir 重启（直引形式 authorization 指向首 boot 捕获的 nsId——生产主路径）：
      // 干净停机已删锁 → 成功 boot（R1 #5 隐证），且 durable 值回读相等。
      const restartConfig = {
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
      const hubProc2 = spawnApp(['--config', writeConfig(makeTmpDir(), restartConfig)]);
      await waitForEvent(hubProc2, (e) => e.event === 'ready', 60_000, 'hub ready (restart)');
      const readReply = await sendOp(hubProc2, { op: 'read', namespaceId, path: ['count'] }, 20_000);
      expect(readReply.ok).toBe(true);
      expect(readReply.value).toBe(41);

      await signalAndExpectExit(hubProc2, 'SIGTERM', 30_000, 0, 'hub (restart)');
    },
    180_000,
  );

  it(
    'a second instance sharing an active file root is rejected loudly (lock guard, AC2)',
    async () => {
      const hubRoot = makeTmpDir();
      const hub1 = spawnApp(['--config', writeConfig(hubRoot, hubConfigFile(hubRoot, 0))]);
      await waitForEvent(hub1, (e) => e.event === 'ready', 60_000, 'hub1 ready (lock test)');

      // 第二实例：不同 instanceId、同一活跃 rootDir（共享 root unsupported）。
      const secondConfig = {
        ...hubConfigFile(hubRoot, 0),
        instanceId: 'hub-2',
      };
      const hub2 = spawnApp(['--config', writeConfig(makeTmpDir(), secondConfig)]);
      const exitCode = await waitForExit(hub2, 30_000, 'second instance');
      expect(exitCode).toBe(1);
      const everything = [...hub2.raw, ...hub2.stderr].join('\n');
      expect(everything).toMatch(/\.nomicore-lock\.json|lock/i);

      await signalAndExpectExit(hub1, 'SIGTERM', 30_000, 0, 'hub1 (lock test)');
    },
    180_000,
  );
});
