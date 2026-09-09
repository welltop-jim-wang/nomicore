// Deterministic + concurrency contract for the atomic root-lock publication
// repair (CI repair PR #276 `test (24, 4)`; design wiki/raw/task_ci-pr-276_design.md
// §11 ALLOW row 2). The SA6 red contracts (root-lock-atomic-reclaim-red.test.ts
// and root-lock-stale-reclaim-race-stress.test.ts) stay untouched; this file
// pins the new state surface:
//   T1/T2  = upgrade residues L1 (empty `.nomicore-lock/`) and L2 (`{owner.json:""}`)
//            are safely taken over (E5a);
//   T3/T4  = stray regular file / symlink-to-external-dir at the canonical name
//            are taken over and release cleanly, no raw ENOTDIR escape (E8);
//   T5     = legacy transient artifact families do not disturb acquisition and a
//            dead-pid claim is auto-taken-over (E6);
//   T6     = L1/L2-preset roots × 12 real contenders + 2 CPU burners yield
//            exactly one acquired owner per shape, all losers loud (E5b);
//   T7a/T7b/T7c = D6 claim-gate liveness: live holder ⇒ bounded loud abort
//            without seizing the gate (E9a), manual removal restores acquisition
//            (E9b), and occupancy turnover resets the wait accounting so legal
//            contention always succeeds (E9d).
import { fork, spawn, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireRootLock, ROOT_LOCK_FILE_NAME } from '../src/index.js';

const DEAD_PID = 2 ** 31 - 1;
const CANONICAL_NAME = '.nomicore-lock';
const CLAIM_NAME = '.nomicore-lock.reap-claim';
/** D6 budget must be a module-private constant; tests mirror it as an oracle. */
const WAIT_LIMIT_MS = 5_000;

const rootDirs: string[] = [];
const liveWorkers: ChildProcess[] = [];
const burners: ChildProcess[] = [];

function makeRootDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'yjs-server-rootlock-pub-'));
  rootDirs.push(dir);
  return dir;
}

function lockPath(rootDir: string): string {
  return join(rootDir, ROOT_LOCK_FILE_NAME);
}

function readOwnerJson(rootDir: string): Record<string, unknown> | null {
  const p = join(rootDir, CANONICAL_NAME, 'owner.json');
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
}

function readMirrorJson(rootDir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(lockPath(rootDir), 'utf8')) as Record<string, unknown>;
}

function readFileOrEmpty(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function killGroup(child: ChildProcess): void {
  try {
    if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
  } catch {
    // already gone — idempotent
  }
  try {
    child.kill('SIGKILL');
  } catch {
    // already gone — idempotent
  }
}

/** CPU burner for contention amplification (same pattern as the SA6 stress file). */
function spawnBurner(lifeMs: number): ChildProcess {
  const child = spawn(
    process.execPath,
    ['-e', `const t0 = Date.now(); for (;;) { if (Date.now() - t0 > ${lifeMs}) process.exit(0); }`],
    { stdio: 'ignore', detached: true },
  );
  burners.push(child);
  return child;
}

interface WorkerMessage {
  type: 'acquired' | 'released' | 'rejected';
  instanceId: string;
  message?: string;
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

/** Assert the canonical acquire-success contract shared by T1-T5/T7b: owner.json,
 *  mirror and release must all belong to the acquirer and end clean. */
function expectAcquiredCleanly(rootDir: string, instanceId: string, handle: { release(): void }): void {
  expect(readOwnerJson(rootDir)?.instanceId).toBe(instanceId);
  expect(readMirrorJson(rootDir).instanceId).toBe(instanceId);
  handle.release();
  expect(existsSync(join(rootDir, CANONICAL_NAME))).toBe(false);
  expect(existsSync(lockPath(rootDir))).toBe(false);
}

function presetL1(rootDir: string): void {
  mkdirSync(join(rootDir, CANONICAL_NAME)); // legacy pre-fix empty directory
}

function presetL2(rootDir: string): void {
  const dir = join(rootDir, CANONICAL_NAME);
  mkdirSync(dir);
  writeFileSync(join(dir, 'owner.json'), ''); // exact legacy `{owner.json: ""}` shape
}

function presetReapFamily(rootDir: string): void {
  const payload = JSON.stringify({ instanceId: 'dead', pid: DEAD_PID, nonce: randomUUID() });
  const stagingDir = join(rootDir, `.nomicore-lock.acquire-${randomUUID()}`);
  mkdirSync(stagingDir);
  writeFileSync(join(stagingDir, 'owner.json'), payload);
  writeFileSync(join(rootDir, `.nomicore-lock.reap-claim.staging-${randomUUID()}`), payload);
  writeFileSync(join(rootDir, `.nomicore-lock.reap-claim.reaped-${randomUUID()}`), payload);
  const reapDir = join(rootDir, `.nomicore-lock.reap-${randomUUID()}`);
  mkdirSync(reapDir);
  writeFileSync(join(reapDir, 'owner.json'), payload);
  const releaseDir = join(rootDir, `.nomicore-lock.release-${randomUUID()}`);
  mkdirSync(releaseDir);
  writeFileSync(join(releaseDir, 'owner.json'), payload);
  // Dead-pid claim gate: the auto-takeover path (T5 pins E6).
  writeFileSync(join(rootDir, CLAIM_NAME), payload);
}

afterEach(() => {
  for (const w of liveWorkers.splice(0)) killGroup(w);
  for (const b of burners.splice(0)) killGroup(b);
  for (const dir of rootDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('root lock atomic publication', () => {
  it('T1: takes over a legacy empty canonical directory (L1) without touching others', () => {
    const root = makeRootDir();
    presetL1(root);
    expectAcquiredCleanly(root, 'instance-A', acquireRootLock(root, 'instance-A'));
  });

  it('T2: takes over a legacy {owner.json:""} canonical directory (L2)', () => {
    const root = makeRootDir();
    presetL2(root);
    expectAcquiredCleanly(root, 'instance-A', acquireRootLock(root, 'instance-A'));
  });

  it('T3: takes over a stray regular file squatting on the canonical name', () => {
    const root = makeRootDir();
    writeFileSync(join(root, CANONICAL_NAME), 'stray file content');
    expectAcquiredCleanly(root, 'instance-A', acquireRootLock(root, 'instance-A'));
  });

  it('T4: takes over a symlink to an external directory on the canonical name', () => {
    const root = makeRootDir();
    const external = mkdtempSync(join(tmpdir(), 'yjs-server-rootlock-target-'));
    rootDirs.push(external);
    symlinkSync(external, join(root, CANONICAL_NAME));
    expectAcquiredCleanly(root, 'instance-A', acquireRootLock(root, 'instance-A'));
    expect(existsSync(external)).toBe(true);
  });

  it('T5: legacy transient artifact families never disturb acquisition; dead claim is auto-taken-over', () => {
    const root = makeRootDir();
    presetReapFamily(root);
    expectAcquiredCleanly(root, 'instance-A', acquireRootLock(root, 'instance-A'));
  });

  it(
    'T6: L1/L2 preset roots under 12 real contenders + 2 burners yield exactly one live owner per shape',
    async () => {
      const burn = [spawnBurner(120_000), spawnBurner(120_000)];
      try {
        for (const shape of ['L1', 'L2'] as const) {
          const root = makeRootDir();
          if (shape === 'L1') presetL1(root);
          else presetL2(root);
          const workers: ChildProcess[] = [];
          const waiters: Array<Promise<WorkerMessage>> = [];
          for (let i = 0; i < 12; i++) {
            const w = startWorker(root, `contender-${shape}-${i}`, 30_000);
            workers.push(w);
            waiters.push(nextMessage(w));
            if ((i + 1) % 4 === 0 && i + 1 < 12) await new Promise((r) => setTimeout(r, 25));
          }
          let messages: WorkerMessage[];
          try {
            messages = await Promise.all(waiters);
          } finally {
            for (const w of workers) {
              try {
                w.kill('SIGKILL');
              } catch {
                // already gone
              }
            }
          }
          const acquired = messages.filter((m) => m.type === 'acquired');
          const rejected = messages.filter((m) => m.type === 'rejected');
          expect(acquired).toHaveLength(1);
          expect(rejected).toHaveLength(11);
          expect(rejected.every((m) => /held|unsupported/.test(m.message ?? ''))).toBe(true);
          const winner = acquired[0]?.instanceId;
          expect(readOwnerJson(root)?.instanceId).toBe(winner);
          expect(readMirrorJson(root).instanceId).toBe(winner);
          // No reap-family residue after the round (dead-claim takeover and
          // reap tombstones are all consumed within the protocol).
          expect(readdirSync(root).some((name) => name.startsWith('.nomicore-lock.reap'))).toBe(false);
          await Promise.all(workers.map((w) => exited(w).catch(() => {})));
        }
      } finally {
        for (const b of burn) killGroup(b);
      }
    },
    120_000,
  );

  // T7a leaves its blocking claim untouched on purpose (never seizes the gate);
  // T7b consumes that same root for the manual-remedy contract. The shared root
  // is unregistered from afterEach cleanup while parked between the two tests.
  let t7Root: string | undefined;

  it(
    'T7a: a live claim holder fails acquisition loudly after the wait budget without seizing the gate',
    () => {
      const root = makeRootDir();
      t7Root = root;
      // Same process pid + a foreign instanceId ⇒ judged alive deterministically
      // (deterministic stand-in for the reused-pid / frozen-holder shapes).
      const claimRaw = JSON.stringify({
        instanceId: 'foreign-holder',
        pid: process.pid,
        nonce: randomUUID(),
      });
      writeFileSync(join(root, CLAIM_NAME), claimRaw);

      const t0 = performance.now();
      let thrown: unknown;
      try {
        acquireRootLock(root, 'instance-A');
      } catch (error) {
        thrown = error;
      }
      const elapsed = performance.now() - t0;

      expect(thrown).toBeInstanceOf(Error);
      const message = (thrown as Error).message;
      // ① pinned message shape (design §8.1).
      expect(message).toMatch(/reclaim claim .* occupied by a live pid .*\(pid reuse caveat/);
      // ②′ wall-clock lower bound: throwing before the budget is a red defect.
      expect(elapsed).toBeGreaterThanOrEqual(WAIT_LIMIT_MS);
      // ② wall-clock upper bound (4× absorbs CI jitter — proves boundedness).
      expect(elapsed).toBeLessThan(4 * WAIT_LIMIT_MS);
      // ③ the gate is never seized: claim bytes stay untouched.
      expect(readFileSync(join(root, CLAIM_NAME), 'utf8')).toBe(claimRaw);
      // ④ the canonical was never created.
      expect(existsSync(join(root, CANONICAL_NAME))).toBe(false);
      // ⑤ no private staging residue of this call survives the loud exit.
      const residue = readdirSync(root).filter(
        (name) =>
          name.startsWith('.nomicore-lock.acquire-') ||
          name.startsWith('.nomicore-lock.reap-claim.staging-'),
      );
      expect(residue).toHaveLength(0);
      // ⑥ the message does not intersect the frozen-contract loser regex
      //    `/held|unsupported/` (design §8.1 disjointness hard constraint).
      expect(message).not.toMatch(/held|unsupported/);
      // Park the root for T7b; it is re-registered for cleanup there.
      const parked = rootDirs.indexOf(root);
      if (parked >= 0) rootDirs.splice(parked, 1);
    },
    30_000,
  );

  it('T7b: removing the stuck claim (manual remedy) restores acquisition on the same root', () => {
    const root = t7Root;
    if (root === undefined) throw new Error('T7b requires T7a to have run on the shared root first');
    rootDirs.push(root);
    expect(existsSync(join(root, CLAIM_NAME))).toBe(true); // T7a left the gate in place
    unlinkSync(join(root, CLAIM_NAME)); // ops remedy: docs §锁文件与共享 root
    expectAcquiredCleanly(root, 'instance-B', acquireRootLock(root, 'instance-B'));
  }, 30_000);

  it(
    'T7c: claim occupancy turnover resets the wait accounting — legal contention always succeeds',
    async () => {
      const root = makeRootDir();
      const claimPath = join(root, CLAIM_NAME);
      const nonceA = randomUUID();
      const nonceB = randomUUID();
      const segmentMs = 2_800; // each segment < 5000ms; total ≈ 5600ms > 5000ms
      const helper = spawn(
        process.execPath,
        ['-e', HELPER_SCRIPT, root, CLAIM_NAME, nonceA, nonceB, 'turnover-holder', String(segmentMs)],
        { stdio: 'ignore' },
      );
      liveWorkers.push(helper);
      try {
        // Wait for occupancy A to be fully on the gate (byte comparison, not
        // existence — the helper must have finished its atomic swap) before
        // entering the synchronous acquire.
        const deadline = Date.now() + 15_000;
        while (!readFileOrEmpty(claimPath).includes(nonceA)) {
          if (Date.now() > deadline) throw new Error('T7c helper never published nonce A');
          await new Promise((r) => setTimeout(r, 25));
        }
        // Synchronous acquire: two turnovers (A→B at ≈2.8s, B→gone at ≈5.6s)
        // must reset the per-occupancy budget so this succeeds.
        expectAcquiredCleanly(root, 'instance-C', acquireRootLock(root, 'instance-C'));
      } finally {
        killGroup(helper);
      }
    },
    30_000,
  );
});

// T7c helper: publishes a claim with an external instanceId and its own live
// pid, then performs atomic content swaps (write staging + rename — never an
// unlink+write empty window) and finally removes the claim.
const HELPER_SCRIPT = [
  "const fs = require('node:fs');",
  "const path = require('node:path');",
  'const [rootDir, claimName, nonceA, nonceB, instanceId, segMsText] = process.argv.slice(1);',
  'const segMs = Number(segMsText);',
  'const claimPath = path.join(rootDir, claimName);',
  'const make = (nonce) => JSON.stringify({ instanceId, pid: process.pid, nonce });',
  'const swap = (nonce) => {',
  "  const staging = path.join(rootDir, '.nomicore-lock.acquire-' + nonce);",
  "  fs.writeFileSync(staging, make(nonce), 'utf8');",
  '  fs.renameSync(staging, claimPath);',
  '};',
  'swap(nonceA);',
  'setTimeout(() => swap(nonceB), segMs);',
  'setTimeout(() => {',
  '  try { fs.unlinkSync(claimPath); } catch {}',
  '  process.exit(0);',
  '}, 2 * segMs);',
].join('\n');
