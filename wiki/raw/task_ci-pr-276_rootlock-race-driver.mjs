// Root-lock race driver v3 — CI-faithful: identical to the vitest scenario
// (stale lock dir, `contenders` simultaneous workers, holdMs 5000 like CI, collect
// only the FIRST message of each worker). With holdMs >> collection horizon, two
// 'acquired' messages => two overlapping owners => double-acquire (the CI bug shape).
// Additionally a ring buffer records canonical owner.json content transitions to
// capture fs-level evidence (owner A's dir reaped while A's hold is still open).
import { fork, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repoRoot = process.env.REPO_ROOT ?? '/home/wangjian/nomicore-fix-issue-266';
const fixture = join(repoRoot, 'apps', 'yjs-server', 'test', 'fixtures', 'root-lock-worker.ts');
const DEAD_PID = 2 ** 31 - 1;
const streamId = process.argv[2] ?? 's';
const rounds = Number(process.argv[3] ?? 100);
const contenders = Number(process.argv[4] ?? 12);
const holdMs = Number(process.argv[5] ?? 5000);
const mode = process.argv[6] ?? 'plain'; // 'plain' | 'history' | 'burn' | 'burn+history'
const resultsDir = '/tmp/rootlock-repro/results';
const wantHistory = mode.includes('history');
const wantBurn = mode.includes('burn');

function makeStaleRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'rl-race-'));
  mkdirSync(join(dir, '.nomicore-lock'));
  writeFileSync(join(dir, '.nomicore-lock', 'owner.json'), JSON.stringify({ instanceId: 'crashed', pid: DEAD_PID, nonce: 'dead' }));
  return dir;
}

function startWorker(rootDir, instanceId, hold) {
  try {
    return fork(fixture, [rootDir, instanceId, String(hold)], {
      execArgv: ['--import', 'tsx'],
      cwd: repoRoot,
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
  } catch {
    return null;
  }
}

function nextMessage(worker) {
  return new Promise((resolve) => {
    if (worker === null) return resolve({ type: 'spawn-failed' });
    worker.once('message', (message) => resolve(message));
    worker.once('exit', (code) => resolve({ type: 'exited', code }));
    worker.on('error', () => resolve({ type: 'spawn-failed' }));
  });
}

function exited(worker) {
  return new Promise((resolve) => {
    if (worker.exitCode !== null || worker.signalCode !== null) return resolve();
    worker.once('exit', () => resolve());
  });
}

// Ring buffer sampling canonical owner.json (path present/absent/content).
function startHistory(rootDir) {
  const ownerPath = join(rootDir, '.nomicore-lock', 'owner.json');
  const ring = [];
  const rec = (t, v) => { ring.push({ t, v }); if (ring.length > 4000) ring.splice(0, 1000); };
  let stopped = false;
  (function sample() {
    if (stopped) return;
    let v = null;
    try { v = readFileSync(ownerPath, 'utf8'); } catch { v = null; }
    const last = ring[ring.length - 1];
    if (!last || last.v !== v) rec(Date.now(), v);
    setImmediate(sample);
  })();
  return {
    finish() { stopped = true; return ring; },
  };
}

function dump(rootDir, acquired, history) {
  const lines = [];
  lines.push(`--- DOUBLE-ACQUIRE dump stream=${streamId} acquired=${JSON.stringify(acquired.map((m) => m.instanceId))} ---`);
  lines.push(`rootDir: ${rootDir}`);
  for (const name of readdirSync(rootDir)) {
    const p = join(rootDir, name);
    if (name === '.nomicore-lock') {
      lines.push(`canonical/ owner.json: ${existsSync(join(p, 'owner.json')) ? readFileSync(join(p, 'owner.json'), 'utf8') : '<missing>'}`);
    } else if (name.endsWith('.json')) {
      lines.push(`${name}: ${readFileSync(p, 'utf8')}`);
    } else {
      const inner = join(p, 'owner.json');
      lines.push(`${name}/: ${existsSync(inner) ? readFileSync(inner, 'utf8') : '<no owner.json>'}`);
    }
  }
  lines.push('owner.json history transitions (ms since round start):');
  const t0 = Date.now();
  for (const { t, v } of history) {
    let short = v;
    if (v) { try { short = JSON.parse(v).instanceId; } catch {} }
    lines.push(`  +${t - t0}ms: ${short ?? '<absent>'}`);
  }
  return lines.join('\n');
}

async function run() {
  let doubleRounds = 0;
  let burners = [];
  if (wantBurn) {
    for (let b = 0; b < 2; b++) {
      const bp = spawn(process.execPath, ['-e', 'const t=Date.now();while(Date.now()-t<1e12){}'], { stdio: 'ignore' });
      burners.push(bp);
    }
  }
  for (let round = 1; round <= rounds; round++) {
    const root = makeStaleRoot();
    const history = wantHistory ? startHistory(root) : { finish: () => [] };
    const t0 = Date.now();
    const workers = [];
    const waiters = [];
    for (let i = 0; i < contenders; i++) {
      const id = `c${streamId}-${round}-${i}`;
      const w = startWorker(root, id, holdMs);
      workers.push(w);
      waiters.push(nextMessage(w).then((m) => ({ ...m, id })));
      if ((i + 1) % 4 === 0 && i + 1 < contenders) await new Promise((r) => setTimeout(r, 15));
    }
    const messages = await Promise.all(waiters);
    const acquired = messages.filter((m) => m.type === 'acquired');
    const rejected = messages.filter((m) => m.type === 'rejected');
    const collectionMs = Date.now() - t0;
    // holdMs >> collectionMs => every acquired worker still holds at collection time
    if (acquired.length > 1) {
      doubleRounds++;
      const dumpText = dump(root, acquired, history.finish());
      dumpText.split('\n').forEach((l) => console.log(l));
      try { writeFileSync(join(resultsDir, `double-${streamId}-${Date.now()}.log`), `${dumpText}\ncollectionMs=${collectionMs}\n`); } catch {}
    } else if (acquired.length === 1 && rejected.length !== contenders - 1) {
      console.log(`stream ${streamId} round ${round}: odd shape acquired=${acquired.length} rejected=${rejected.length} others=${messages.length - acquired.length - rejected.length}`);
    }
    history.finish();
    for (const w of workers) { try { w.kill('SIGKILL'); } catch {} }
    await Promise.all(workers.map((w) => exited(w).catch(() => {})));
    rmSync(root, { recursive: true, force: true });
  }
  for (const b of burners) { try { b.kill('SIGKILL'); } catch {} }
  console.log(`stream ${streamId}: DONE rounds=${rounds} DOUBLE-rounds=${doubleRounds}`);
  process.exit(doubleRounds > 0 ? 42 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
