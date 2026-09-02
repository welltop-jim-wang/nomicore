import { fork, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireRootLock, ROOT_LOCK_FILE_NAME } from '../src/index.js';

const DEAD_PID = 2 ** 31 - 1;
const rootDirs: string[] = [];

function makeRootDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'yjs-server-rootlock-'));
  rootDirs.push(dir);
  return dir;
}

function lockPath(rootDir: string): string {
  return join(rootDir, ROOT_LOCK_FILE_NAME);
}

function readPayload(rootDir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(lockPath(rootDir), 'utf8')) as Record<string, unknown>;
}

interface WorkerMessage {
  type: 'acquired' | 'released' | 'rejected';
  instanceId: string;
  message?: string;
}

function startWorker(rootDir: string, instanceId: string, holdMs = 500): ChildProcess {
  return fork(fileURLToPath(new URL('./fixtures/root-lock-worker.ts', import.meta.url)), [rootDir, instanceId, String(holdMs)], {
    execArgv: ['--import', 'tsx'],
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
}

function nextMessage(worker: ChildProcess): Promise<WorkerMessage> {
  return new Promise((resolve, reject) => {
    const onExit = (code: number | null) => reject(new Error(`worker exited before message (${String(code)})`));
    worker.once('exit', onExit);
    worker.once('message', (message) => {
      worker.off('exit', onExit);
      resolve(message as WorkerMessage);
    });
  });
}

function exited(worker: ChildProcess): Promise<void> {
  if (worker.exitCode !== null || worker.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => worker.once('exit', () => resolve()));
}

afterEach(() => {
  for (const root of rootDirs.splice(0)) rmSync(root, { recursive: true, force: true });
});

const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

describe('root lock atomic ownership', () => {
  it('normal acquire publishes diagnostics and release is idempotent', () => {
    const root = makeRootDir();
    const handle = acquireRootLock(root, 'instance-A');
    const payload = readPayload(root);
    expect(payload.instanceId).toBe('instance-A');
    expect(payload.pid).toBe(process.pid);
    expect(typeof payload.nonce).toBe('string');
    handle.release();
    expect(() => handle.release()).not.toThrow();
    expect(existsSync(join(root, '.nomicore-lock'))).toBe(false);
  });

  it('live owner diagnostics distinguish same instance and shared root', () => {
    const root = makeRootDir();
    const owner = acquireRootLock(root, 'instance-A');
    expect(() => acquireRootLock(root, 'instance-A')).toThrow(/held by the same instance.*pid reuse caveat/);
    expect(() => acquireRootLock(root, 'instance-B')).toThrow(/shared file persistence root is unsupported/);
    owner.release();
  });

  it('recovers a directory lock left by a dead process', async () => {
    const root = makeRootDir();
    const crashed = startWorker(root, 'crashed', 60_000);
    expect((await nextMessage(crashed)).type).toBe('acquired');
    crashed.kill('SIGKILL');
    await exited(crashed);

    const recovered = acquireRootLock(root, 'recovered');
    expect(readPayload(root).instanceId).toBe('recovered');
    recovered.release();
  });

  it('real-process stale reclaim race has exactly one live owner', async () => {
    const root = makeRootDir();
    const crashed = startWorker(root, 'crashed', 60_000);
    expect((await nextMessage(crashed)).type).toBe('acquired');
    crashed.kill('SIGKILL');
    await exited(crashed);

    const workers = Array.from({ length: 12 }, (_, index) => startWorker(root, `contender-${index}`, 5_000));
    const messages = await Promise.all(workers.map(nextMessage));
    const acquired = messages.filter(({ type }) => type === 'acquired');
    expect(acquired).toHaveLength(1);
    const rejected = messages.filter(({ type }) => type === 'rejected');
    expect(rejected).toHaveLength(11);
    expect(rejected.every(({ message }) => /held|unsupported/.test(message ?? ''))).toBe(true);
    // Assert overlap, not eventual sequential ownership: the winner must still
    // own the canonical directory when every contender has reported.
    expect(readPayload(root).instanceId).toBe(acquired[0]?.instanceId);
    for (const worker of workers) worker.kill('SIGTERM');
    await Promise.all(workers.map(exited));
  }, 15_000);

  it('late release cannot remove a successor directory lock', () => {
    const root = makeRootDir();
    const stale = acquireRootLock(root, 'instance-A');
    rmSync(join(root, '.nomicore-lock'), { recursive: true });
    const successor = acquireRootLock(root, 'instance-B');
    stale.release();
    expect(() => acquireRootLock(root, 'instance-C')).toThrow(/unsupported/);
    expect(readPayload(root).instanceId).toBe('instance-B');
    successor.release();
  });

  it.skipIf(isRoot)('unwritable root is loud', () => {
    const root = makeRootDir();
    chmodSync(root, 0o500);
    try {
      expect(() => acquireRootLock(root, 'instance-A')).toThrow(/cannot write .* writable rootDir/);
    } finally {
      chmodSync(root, 0o700);
    }
  });

  it('legacy malformed mirror cannot become the ownership token', () => {
    const root = makeRootDir();
    writeFileSync(lockPath(root), JSON.stringify({ instanceId: 'dead', pid: DEAD_PID }));
    const handle = acquireRootLock(root, 'instance-A');
    expect(readPayload(root).instanceId).toBe('instance-A');
    handle.release();
  });
});
