/**
 * [SA6 owned] T6 — hub 正常重启 ⇒ peer 显式恢复语义红测（设计 §5-T6，R2 NB-1 冻结的
 * b+c 恢复路线；AC1/AC3）。
 *
 * 断言链（与冻结包源码逐行核实，见设计 §6-A13/A15 与 SA2 R3 报告）：
 *   hub v1（file 持久化 + provision）boot → 捕获 `provisioned` nsId →
 *   hub v2（同 rootDir，**直引形式** authorization{捕获 nsId, ownerUserId}）→
 *   peer **配置态静态 targets** → bootstrap live 基线（verify-write→hub read 收敛）→
 *   hub SIGTERM → peer NDJSON 依次 `goaway-received`(reasonCode=SERVER_SHUTTING_DOWN)
 *   与 `connection-state-changed`(to=blocked) → 同 rootDir 重启 hub → **负例静默窗口**
 *   （有界期 peer 零 dial/backoff/状态迁移事件——blocked 不自动重拨）→ 对 peer stdin
 *   注 `{"op":"notify-auth-changed"}` → 回执 ok:true 且 `connectionState` 离开
 *   blocked → 有界轮询（verify-write 自带 30s deadline）达 live 且 read 收敛。
 *
 * RED 基线：`apps/yjs-server/src/main.ts` 尚不存在 → spawn 即刻失败（进程提前退出）。
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

describe('T6 hub restart ⇒ peer blocked-recovery (design §5-T6 / AC1+AC3)', () => {
  it(
    'hub restart drives peer to blocked; negative silence window; notify-auth-changed recovers to live and converges',
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
        }),
      ]);
      await waitForEvent(peerProc, (e) => e.event === 'ready', 60_000, 'peer ready');

      // ── bootstrap live 基线 ──
      const baselineWrite = await sendOp(peerProc, { op: 'verify-write', namespaceId, set: ['count'], path: ['count'], value: 7, timeoutMs: 30_000 }, 60_000);
      expect(baselineWrite.ok).toBe(true);
      const baselineRead = await sendOp(hubV2, { op: 'read', namespaceId, path: ['count'] }, 20_000);
      expect(baselineRead.ok).toBe(true);
      expect(baselineRead.value).toBe(7);

      // ── hub 正常 SIGTERM ⇒ peer 收到 GOAWAY 并进入 blocked（不自动重拨）──
      await signalAndExpectExit(hubV2, 'SIGTERM', 30_000, 0, 'hub v2 (restart source)');

      const goaway = await waitForEvent(
        peerProc,
        (e) => e.event === 'goaway-received',
        30_000,
        'peer goaway-received',
      );
      expect(goaway.reasonCode).toBe('SERVER_SHUTTING_DOWN');

      const blocked = await waitForEvent(
        peerProc,
        (e) => e.event === 'connection-state-changed' && e.to === 'blocked',
        30_000,
        'peer connection-state-changed to blocked',
      );
      const goawayIndex = peerProc.events.indexOf(goaway);
      const blockedIndex = peerProc.events.indexOf(blocked);
      expect(goawayIndex).toBeGreaterThanOrEqual(0);
      expect(blockedIndex).toBeGreaterThan(goawayIndex);

      // ── 同 rootDir 重启 hub（直引授权绑定先于 listen）──
      const hubV2b = spawnApp(['--config', configV2Path]);
      await waitForEvent(hubV2b, (e) => e.event === 'ready', 60_000, 'hub v2 ready (restart)');

      // ── 负例静默窗口：blocked 不自动重拨（零 dial/backoff/状态迁移事件）──
      const snapshotLength = peerProc.events.length;
      await sleep(4_000);
      const newEvents = peerProc.events.slice(snapshotLength);
      const silentViolation = newEvents.filter((e) =>
        ['connection-state-changed', 'connection-backoff-scheduled', 'goaway-received'].includes(e.event as string),
      );
      expect(silentViolation, `expected zero redial events while blocked, got ${JSON.stringify(silentViolation)}`).toEqual([]);

      // ── 显式恢复：stdin notify-auth-changed（设计 §3.4 恢复动词）──
      const notifyReply = await sendOp(peerProc, { op: 'notify-auth-changed' }, 20_000);
      expect(notifyReply.ok).toBe(true);
      expect(notifyReply.connectionState, 'notify reply connectionState leaves blocked').not.toBe('blocked');

      // ── 有界收敛：verify-write 自带 30s live 等待，随后 hub read 回读 ──
      const recoveredWrite = await sendOp(peerProc, { op: 'verify-write', namespaceId, set: ['count'], path: ['count'], value: 11, timeoutMs: 30_000 }, 60_000);
      expect(recoveredWrite.ok).toBe(true);
      const recoveredRead = await sendOp(hubV2b, { op: 'read', namespaceId, path: ['count'] }, 20_000);
      expect(recoveredRead.ok).toBe(true);
      expect(recoveredRead.value).toBe(11);

      await signalAndExpectExit(peerProc, 'SIGTERM', 30_000, 0, 'peer');
      await signalAndExpectExit(hubV2b, 'SIGTERM', 30_000, 0, 'hub v2 (restart)');
    },
    240_000,
  );
});
