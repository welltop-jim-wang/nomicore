// SA6 acceptance contract — CI repair (PR #276 job `test (24, 4)` root-lock
// double-owner race, head 334494d). Invariant: under real-process contention for a
// stale root lock, exactly one contender may become owner; two overlapping owner
// holds must never occur (docs/integration/hub-peer-deployment.md §锁文件与共享 root;
// lifecycle.ts: "mkdir is the acquisition linearization point").
//
// The CI canary that caught the failure (root-lock-atomic-reclaim-red.test.ts
// 'real-process stale reclaim race has exactly one live owner') stays untouched.
// This file repeats that exact scenario over R rounds under CPU contention so the
// double-acquire window (owner.json O_EXCL create→write preemption gap) is hit with
// materially higher probability per execution, and asserts the single-owner invariant
// on the authoritative owner.json AND the diagnostic mirror for every round.
import { fork, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireRootLock, ROOT_LOCK_FILE_NAME } from '../src/index.js';

const ROUNDS = 6;
const CONTENDERS = 12; // CI parity with the original canary scenario
const rootDirs: string[] = [];
const liveWorkers: ChildProcess[] = [];
const burners: ChildProcess[] = [];

function makeRootDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'yjs-server-rootlock-stress-'));
  rootDirs.push(dir);
  return dir;
}

function lockPath(rootDir: string): string {
  return join(rootDir, ROOT_LOCK_FILE_NAME);
}

function readMirror(rootDir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(lockPath(rootDir), 'utf8')) as Record<string, unknown>;
}

function readOwner(rootDir: string): Record<string, unknown> | null {
  const p = join(rootDir, '.nomicore-lock', 'owner.json');
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
}

function killGroup(child: ChildProcess): void {
  try {
    if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
  } catch {
    // 已退出——幂等。
  }
  try {
    child.kill('SIGKILL');
  } catch {
    // 已退出——幂等。
  }
}

/** CPU 燃烧进程（争用放大；自终止兜底；独立进程组便于组杀）。 */
function spawnBurner(lifeMs: number): ChildProcess {
  const child = spawn(
    process.execPath,
    ['-e', `const t0 = Date.now(); for (;;) { if (Date.now() - t0 > ${lifeMs}) process.exit(0); }`],
    { stdio: 'ignore', detached: true },
  );
  burners.push(child);
  return child;
}

function startWorker(rootDir: string, instanceId: string, holdMs: number): ChildProcess {
  const child = fork(
    fileURLToPath(new URL('./fixtures/root-lock-worker.ts', import.meta.url)),
    [rootDir, instanceId, String(holdMs)],
    { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'inherit', 'ipc'] },
  );
  liveWorkers.push(child);
  return child;
}

function nextMessage(worker: ChildProcess): Promise<{ type: string; instanceId?: string; message?: string }> {
  return new Promise((resolve, reject) => {
    const onExit = (code: number | null) => reject(new Error(`worker exited before message (${String(code)})`));
    worker.once('exit', onExit);
    worker.once('message', (message) => {
      worker.off('exit', onExit);
      resolve(message as { type: string; instanceId?: string; message?: string });
    });
  });
}

function exited(worker: ChildProcess): Promise<void> {
  if (worker.exitCode !== null || worker.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => worker.once('exit', () => resolve()));
}

afterEach(() => {
  for (const w of liveWorkers.splice(0)) killGroup(w);
  for (const b of burners.splice(0)) killGroup(b);
  for (const dir of rootDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('root lock stale-reclaim race — single live owner under loaded real-process contention', () => {
  it('sequential handover always yields exactly one owner (negative control)', () => {
    const root = makeRootDir();
    const a = acquireRootLock(root, 'seq-A');
    expect(readOwner(root)?.instanceId).toBe('seq-A');
    a.release();
    expect(existsSync(join(root, '.nomicore-lock'))).toBe(false);
    const b = acquireRootLock(root, 'seq-B');
    expect(readOwner(root)?.instanceId).toBe('seq-B');
    b.release();
    expect(existsSync(join(root, '.nomicore-lock'))).toBe(false);
  });

  it(
    'a live owner repels every contender: zero acquired, all rejected (negative control)',
    async () => {
      const root = makeRootDir();
      const owner = acquireRootLock(root, 'live-owner');
      const workers = Array.from({ length: 8 }, (_, i) => startWorker(root, `loser-${i}`, 2_000));
      const messages = await Promise.all(workers.map(nextMessage));
      const acquired = messages.filter((m) => m.type === 'acquired');
      const rejected = messages.filter((m) => m.type === 'rejected');
      expect(acquired).toHaveLength(0);
      expect(rejected).toHaveLength(8);
      expect(rejected.every((m) => /held|unsupported/.test(m.message ?? ''))).toBe(true);
      for (const w of workers) w.kill('SIGKILL');
      await Promise.all(workers.map(exited));
      owner.release();
    },
    120_000,
  );

  it(
    `real-process stale reclaim over ${ROUNDS} loaded rounds: exactly one live owner per round ` +
      '(the CI red assertion — "expected acquired to have a length of 1 but got 2" — per round)',
    async () => {
      const burn = [spawnBurner(120_000), spawnBurner(120_000)];
      try {
        for (let round = 0; round < ROUNDS; round++) {
          const root = makeRootDir();
          // (1) A crashed worker leaves a genuinely stale lock (SIGKILL, CI-faithful).
          const crashed = startWorker(root, `crashed-r${round}`, 60_000);
          expect((await nextMessage(crashed)).type).toBe('acquired');
          crashed.kill('SIGKILL');
          await exited(crashed);
          // (2) Contenders race to reclaim, arrivals staggered to keep the spin alive.
          const workers: ChildProcess[] = [];
          const waiters: Array<Promise<{ type: string; instanceId?: string; message?: string }>> = [];
          for (let i = 0; i < CONTENDERS; i++) {
            const w = startWorker(root, `contender-r${round}-${i}`, 30_000);
            workers.push(w);
            waiters.push(nextMessage(w));
            if ((i + 1) % 4 === 0 && i + 1 < CONTENDERS) await new Promise((r) => setTimeout(r, 25));
          }
          let messages: Array<{ type: string; instanceId?: string; message?: string }>;
          try {
            messages = await Promise.all(waiters);
          } finally {
            for (const w of workers) { try { w.kill('SIGKILL'); } catch {} }
          }
          const acquired = messages.filter((m) => m.type === 'acquired');
          const rejected = messages.filter((m) => m.type === 'rejected');
          // THE single-owner invariant (the assertion CI saw fail with 2 acquired):
          expect(acquired).toHaveLength(1);
          expect(rejected).toHaveLength(CONTENDERS - 1);
          expect(rejected.every((m) => /held|unsupported/.test(m.message ?? ''))).toBe(true);
          // Both the authoritative owner.json and the diagnostic mirror must name the winner.
          const winner = acquired[0]?.instanceId;
          expect(readOwner(root)?.instanceId).toBe(winner);
          expect(readMirror(root).instanceId).toBe(winner);
          await Promise.all(workers.map((w) => exited(w).catch(() => {})));
        }
      } finally {
        for (const b of burn) killGroup(b);
      }
    },
    240_000,
  );
});
