/**
 * [SA3 owned] T7 + F1 回归 — stdin 错误链 + `verify-write` 有界物化等待（设计 §5-T7；
 * SA7 §2.5 修复方向 + §2.5 重验门槛）。
 *
 * 覆盖：
 *   1. T7 错误链（每行恰一回执，进程不因控制输入退出）：① 非 JSON 行 →
 *      `malformed-line`；② 未知 verb → `unknown-op`；③ 读「未知 ns」→ 即时
 *      `namespace-unknown`；④ `add-target` 一个永不可 live 的 ns → ⑤ `verify-write`
 *      （timeoutMs:500）→ **有界等待到 deadline 后** `verify-write-timeout`
 *      （绝不 ~50ms 快速 `write-failed`——F1 确定性锚点；复用 SA7 E1-4b 规格）。
 *   2. F1 收敛竞态（正常复制收敛路径，非 settled）：peer `ready` 后**零 settle**
 *      立即并发 `verify-write`（有界 timeout）必须 ok:true 收敛——旧实现
 *      （open 失败即 `write-failed`）在此路径快速失败；每轮全新 peer 进程 × 并发
 *      burst（directed repeated）。
 *   2b. F1 竞态（**确定性窗口**）：peer 先于 hub 启动——ready 后立即发的
 *      `verify-write` 在 hub 未上线期间**保证**未物化（零快速回执，有界等待
 *      内挂起），hub 重启后收敛 ok:true——旧实现在该窗口确定性 ~50ms
 *      `write-failed`。
 *   3. F1 竞态 × 高负载（SA7 §2.2 满载 flake-repro 形状，有界化）：ready 后立即发
 *      `verify-write`，同时 2× CPU 燃烧进程争用（2.5s 自终止）——收敛期内若
 *      `write-failed` 即回归。
 *
 * RED 基线（修复前）：① - ⑤ 中 ⑤ 返回 `write-failed`（opMs≈50ms）而非
 * `verify-write-timeout`；竞态测试在 ready 后立即发 op 命中未物化窗口时返回
 * `write-failed`。
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

/** 永不可 live 的已知 ns（文法合法；hub 从未创建、无授权 → channel 永不 apply）。 */
const NEVER_LIVE_NS = `ns-${'deadbeef'.repeat(4)}`;
/** 未知 ns（文法合法；不在本进程已知集）。 */
const UNKNOWN_NS = `ns-${'00000000000000000000000000000000'}`;

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
const burners: ChildProcess[] = [];

/** 以独立进程组启动（`detached`）：清理时组杀，避免 tsx 包装层孤儿（SA7 §7-O2 教训）。 */
function spawnApp(args: string[]): Proc {
  const child = spawn(TSX_BIN, [MAIN_TS, ...args], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
    detached: true,
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
/** 写一行带 id 的 op 请求（每行恰一回执；id 由调用方/本函数生成）。 */
async function writeOpLine(proc: Proc, op: Record<string, unknown>, idOverride?: string): Promise<string> {
  const id = idOverride ?? `sa3-f1-${++opCounter}`;
  const request = { ...op, id };
  const serialized = JSON.stringify(request);
  await new Promise<void>((resolve, reject) => {
    proc.child.stdin!.write(serialized + '\n', (err) => (err ? reject(err) : resolve()));
  });
  return id;
}

async function waitForReplyById(
  proc: Proc,
  id: string,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = proc.events.find((e) => e.event === 'reply' && e.id === id);
    if (hit) return hit;
    if (proc.exitCode !== null) {
      throw new Error(
        `process exited with code ${proc.exitCode} awaiting reply id=${id}\nstderr:\n${proc.stderr.join('')}`,
      );
    }
    await sleep(50);
  }
  throw new Error(`timeout ${timeoutMs}ms awaiting reply id=${id}`);
}

async function sendOp(
  proc: Proc,
  op: Record<string, unknown>,
  timeoutMs = 60_000,
): Promise<{ id: string; reply: Record<string, unknown> }> {
  const id = await writeOpLine(proc, op);
  const reply = await waitForReplyById(proc, id, timeoutMs);
  return { id, reply };
}

/** 写一行无 id 的原始 stdin（畸形行回执不含 id/op——按 code 匹配）。 */
async function sendRawLine(proc: Proc, line: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    proc.child.stdin!.write(line + '\n', (err) => (err ? reject(err) : resolve()));
  });
}

/** 等待并断言「恰一回执」：按 predicate 取第一条，随后验证 events 中恰一条。 */
async function expectExactlyOneReply(
  proc: Proc,
  predicate: (e: Record<string, unknown>) => boolean,
  timeoutMs: number,
  what: string,
): Promise<Record<string, unknown>> {
  const reply = await waitForEvent(proc, (e) => e.event === 'reply' && predicate(e), timeoutMs, what);
  await sleep(150); // 给「多余回执」一个露头窗口
  const count = proc.events.filter((e) => e.event === 'reply' && predicate(e)).length;
  expect(count, `exactly one reply for ${what}, got ${count}`).toBe(1);
  return reply as Record<string, unknown>;
}

function writeConfig(dir: string, config: Record<string, unknown>): string {
  const path = join(dir, 'config.json');
  writeFileSync(path, JSON.stringify(config, null, 2));
  return path;
}

function hubConfig(rootDir: string, listenPort: number): Record<string, unknown> {
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

function peerConfig(hubUrl: string, targets: readonly { namespaceId: string; ownerUserId: string }[]): Record<string, unknown> {
  return {
    role: 'peer',
    instanceId: 'peer-1',
    persistence: { kind: 'memory' },
    peer: {
      hub: { url: hubUrl, hubInstanceId: 'hub-1', token: 'token-1' },
      ...(targets.length > 0 ? { targets: [...targets] } : {}),
    },
  };
}

/** CPU 燃烧进程（高负载争用；2.5s 自终止兜底；独立进程组便于组杀）。 */
function spawnBurner(): ChildProcess {
  const child = spawn(
    process.execPath,
    ['-e', 'const t0 = Date.now(); for (;;) { if (Date.now() - t0 > 2500) process.exit(0); }'],
    { stdio: 'ignore', detached: true },
  );
  burners.push(child);
  return child;
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

const tmpDirs: string[] = [];
function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'yjs-server-t7-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const proc of liveProcs) {
    if (proc.exitCode === null) {
      killGroup(proc.child);
    }
  }
  liveProcs.length = 0;
  for (const burner of burners.splice(0)) {
    killGroup(burner);
  }
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('T7 stdin error chain + F1 verify-write bounded materialization wait (design §5-T7 / SA7 §2.5)', () => {
  it(
    'error chain: malformed-line / unknown-op / namespace-unknown; verify-write on a never-live known ns waits to the bounded deadline then verify-write-timeout (never a ~50ms write-failed)',
    async () => {
      const hubProc = spawnApp(['--config', writeConfig(makeTmpDir(), hubConfig(makeTmpDir(), 0))]);
      const listening = await waitForEvent(hubProc, (e) => e.event === 'listening', 60_000, 'hub listening');
      const actualPort = listening.port as number;
      await waitForEvent(hubProc, (e) => e.event === 'ready', 60_000, 'hub ready');

      const peerProc = spawnApp([
        '--config',
        writeConfig(makeTmpDir(), peerConfig(`ws://127.0.0.1:${actualPort}/replication`, [])),
      ]);
      await waitForEvent(peerProc, (e) => e.event === 'ready', 60_000, 'peer ready');

      // ── ① 非 JSON 行 → malformed-line（恰一回执）──
      await sendRawLine(peerProc, 'not-json{');
      const malformed = await expectExactlyOneReply(peerProc, (e) => e.code === 'malformed-line', 10_000, 'malformed-line');
      expect(malformed.ok).toBe(false);
      expect(malformed.code).toBe('malformed-line');

      // ── ② 未知 verb → unknown-op（恰一回执，id 回显）──
      const bogus = await sendOp(peerProc, { op: 'bogus' }, 20_000);
      await sleep(150);
      expect(bogus.reply.op).toBe('bogus');
      expect(bogus.reply.id).toBe(bogus.id);
      expect(bogus.reply.ok).toBe(false);
      expect(bogus.reply.code).toBe('unknown-op');
      expect(peerProc.events.filter((e) => e.event === 'reply' && e.id === bogus.id).length).toBe(1);

      // ── ③ 读未知 ns → 即时 namespace-unknown（不做 live 等待）──
      const readUnknown = await sendOp(peerProc, { op: 'read', namespaceId: UNKNOWN_NS, path: ['count'] }, 20_000);
      expect(readUnknown.reply.ok).toBe(false);
      expect(readUnknown.reply.code).toBe('namespace-unknown');

      // ── ④ add-target 永不可 live ns（新目标名/非法格式均应是 ok:true + target-added）──
      const addReply = await sendOp(peerProc, { op: 'add-target', namespaceId: NEVER_LIVE_NS, ownerUserId: 'alice' }, 20_000);
      expect(addReply.reply.ok).toBe(true);
      const targetAdded = await waitForEvent(
        peerProc,
        (e) => e.event === 'target-added' && e.namespaceId === NEVER_LIVE_NS,
        10_000,
        'target-added for never-live ns',
      );
      expect((targetAdded as Record<string, unknown>).namespaceId).toBe(NEVER_LIVE_NS);

      // ── ⑤ F1 锚点：已知集但永不可 live 的 ns → 有界等待到 deadline 后
      //    verify-write-timeout；绝不是 ~50ms 的 write-failed（SA7 E1-4b / §2.5）──
      const t0 = Date.now();
      const vw = await sendOp(
        peerProc,
        { op: 'verify-write', namespaceId: NEVER_LIVE_NS, set: ['count'], path: ['count'], value: 1, timeoutMs: 500 },
        30_000,
      );
      const elapsedMs = Date.now() - t0;
      expect(vw.reply.ok, `must hit the bounded deadline instead of a fast write-failed: ${JSON.stringify(vw.reply)}`).toBe(false);
      expect(vw.reply.code).toBe('verify-write-timeout');
      expect(elapsedMs, `bounded wait must run to the configured deadline, got ${elapsedMs}ms`).toBeGreaterThanOrEqual(450);
      expect(elapsedMs, 'no hang beyond the deadline').toBeLessThan(8_000);

      // ── 进程不因控制输入退出：后续 status 仍 ok ──
      const status = await sendOp(peerProc, { op: 'status' }, 20_000);
      expect(status.reply.ok).toBe(true);
      expect(status.reply.role).toBe('peer');

      await signalAndExpectExit(peerProc, 'SIGTERM', 30_000, 0, 'peer');
      await signalAndExpectExit(hubProc, 'SIGTERM', 30_000, 0, 'hub');
    },
    120_000,
  );

  it(
    'F1 race: verify-write fired immediately after peer ready (zero settle) converges for a live namespace — fresh peer per round, concurrent burst',
    async () => {
      const hubProc = spawnApp(['--config', writeConfig(makeTmpDir(), hubConfig(makeTmpDir(), 0))]);
      const provisioned = await waitForEvent(hubProc, (e) => e.event === 'provisioned', 60_000, 'hub provisioned');
      const namespaceId = provisioned.namespaceId as string;
      expect(namespaceId).toMatch(/^ns-[0-9a-f]{32}$/);
      const listening = await waitForEvent(hubProc, (e) => e.event === 'listening', 60_000, 'hub listening');
      const actualPort = listening.port as number;
      await waitForEvent(hubProc, (e) => e.event === 'ready', 60_000, 'hub ready');

      const rounds = 3;
      for (let round = 1; round <= rounds; round += 1) {
        // 每轮全新 peer 进程：本地记录重新物化（memory persistence），竞态窗口重新打开。
        const peerProc = spawnApp([
          '--config',
          writeConfig(
            makeTmpDir(),
            peerConfig(`ws://127.0.0.1:${actualPort}/replication`, [{ namespaceId, ownerUserId: 'alice' }]),
          ),
        ]);
        await waitForEvent(peerProc, (e) => e.event === 'ready', 60_000, `peer ready (round ${round})`);

        // 零 settle：ready 事件后立即并发 burst——复制收敛尚未完成的窗口内发 op。
        const burst = await Promise.all(
          Array.from({ length: 4 }, () =>
            sendOp(
              peerProc,
              { op: 'verify-write', namespaceId, set: ['count'], path: ['count'], value: round, timeoutMs: 15_000 },
              60_000,
            ),
          ),
        );
        for (const b of burst) {
          expect(
            b.reply.ok,
            `round ${round}: immediate verify-write must converge (bounded wait), got ${JSON.stringify(b.reply)}`,
          ).toBe(true);
        }
        await signalAndExpectExit(peerProc, 'SIGTERM', 30_000, 0, `peer (round ${round})`);
      }

      // 端到端收敛回读（三支 burst 最后一支的写入已复制到 hub）。
      const readReply = await sendOp(hubProc, { op: 'read', namespaceId, path: ['count'] }, 20_000);
      expect(readReply.reply.ok).toBe(true);
      expect(readReply.reply.value).toBe(rounds);

      await signalAndExpectExit(hubProc, 'SIGTERM', 30_000, 0, 'hub');
    },
    180_000,
  );

  it(
    'F1 race (deterministic window): verify-write issued while the hub is down stays in bounded wait (zero fast replies), then converges once the hub restarts',
    async () => {
      // ── hub v1：file + provision → 捕获 nsId → 干净停机（锁释放）──
      const hubRoot = makeTmpDir();
      const port = await freePort();
      const hubV1 = spawnApp(['--config', writeConfig(makeTmpDir(), hubConfig(hubRoot, port))]);
      const provisioned = await waitForEvent(hubV1, (e) => e.event === 'provisioned', 60_000, 'hub v1 provisioned');
      const namespaceId = provisioned.namespaceId as string;
      expect(namespaceId).toMatch(/^ns-[0-9a-f]{32}$/);
      await waitForEvent(hubV1, (e) => e.event === 'ready', 60_000, 'hub v1 ready');
      await signalAndExpectExit(hubV1, 'SIGTERM', 30_000, 0, 'hub v1');

      // ── hub v2：同 rootDir，直引形式 authorization（生产主路径）；此刻**尚未启动**──
      const hubV2Config: Record<string, unknown> = {
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

      // ── peer 先行（hub 未监听）：ready 后**立即**发 verify-write——本地记录
      //    **保证**未物化（hub 尚未启动），即 F1 竞态窗口的确定性构造 ──
      const peerProc = spawnApp([
        '--config',
        writeConfig(
          makeTmpDir(),
          peerConfig(`ws://127.0.0.1:${port}/replication`, [{ namespaceId, ownerUserId: 'alice' }]),
        ),
      ]);
      await waitForEvent(peerProc, (e) => e.event === 'ready', 60_000, 'peer ready (hub down)');

      const opIds = ['f1-down-1', 'f1-down-2', 'f1-down-3'];
      await Promise.all(
        opIds.map(async (id) =>
          writeOpLine(peerProc, { op: 'verify-write', namespaceId, set: ['count'], path: ['count'], value: 21, timeoutMs: 20_000 }, id),
        ),
      );

      // 有界等待窗口内：hub 未启动 ⇒ 零回执（确定性的「正在等待」证明；旧实现
      // 此处已在 ~50ms 内回 write-failed）。
      await sleep(800);
      const earlyReplies = peerProc.events.filter((e) => e.event === 'reply' && opIds.includes(e.id as string));
      expect(
        earlyReplies.length,
        `ops must stay within the bounded wait while the record cannot materialize, got ${JSON.stringify(earlyReplies)}`,
      ).toBe(0);

      // ── hub v2 启动 → peer backoff 重拨 → 通道 apply → 本地记录物化 → 有界等待达成 ──
      const hubV2 = spawnApp(['--config', configV2Path]);
      await waitForEvent(hubV2, (e) => e.event === 'ready', 60_000, 'hub v2 ready');
      const replies = await Promise.all(opIds.map((id) => waitForReplyById(peerProc, id, 30_000)));
      for (const reply of replies) {
        expect(
          reply.ok,
          `verify-write must converge after hub restart (bounded wait), got ${JSON.stringify(reply)}`,
        ).toBe(true);
      }

      const readReply = await sendOp(hubV2, { op: 'read', namespaceId, path: ['count'] }, 20_000);
      expect(readReply.reply.ok).toBe(true);
      expect(readReply.reply.value).toBe(21);

      await signalAndExpectExit(peerProc, 'SIGTERM', 30_000, 0, 'peer (hub-down round)');
      await signalAndExpectExit(hubV2, 'SIGTERM', 30_000, 0, 'hub v2');
    },
    180_000,
  );

  it(
    'F1 race under load: verify-write fired immediately after peer ready while CPU burners contend — must converge, not fast write-failed (SA7 loaded repro shape)',
    async () => {
      const hubProc = spawnApp(['--config', writeConfig(makeTmpDir(), hubConfig(makeTmpDir(), 0))]);
      const provisioned = await waitForEvent(hubProc, (e) => e.event === 'provisioned', 60_000, 'hub provisioned');
      const namespaceId = provisioned.namespaceId as string;
      const listening = await waitForEvent(hubProc, (e) => e.event === 'listening', 60_000, 'hub listening');
      const actualPort = listening.port as number;
      await waitForEvent(hubProc, (e) => e.event === 'ready', 60_000, 'hub ready');

      const peerProc = spawnApp([
        '--config',
        writeConfig(
          makeTmpDir(),
          peerConfig(`ws://127.0.0.1:${actualPort}/replication`, [{ namespaceId, ownerUserId: 'alice' }]),
        ),
      ]);
      await waitForEvent(peerProc, (e) => e.event === 'ready', 60_000, 'peer ready (load)');

      // 2× CPU 燃烧（自终止 2.5s）：争用把收敛窗口拉宽（SA7 §2.2 满载 7/10 命中）。
      const burn = Array.from({ length: 2 }, () => spawnBurner());
      try {
        const burst = await Promise.all(
          Array.from({ length: 3 }, () =>
            sendOp(
              peerProc,
              { op: 'verify-write', namespaceId, set: ['count'], path: ['count'], value: 91, timeoutMs: 20_000 },
              60_000,
            ),
          ),
        );
        for (const b of burst) {
          expect(
            b.reply.ok,
            `loaded immediate verify-write must converge (bounded wait), got ${JSON.stringify(b.reply)}`,
          ).toBe(true);
        }
      } finally {
        for (const b of burn) killGroup(b);
      }

      const readReply = await sendOp(hubProc, { op: 'read', namespaceId, path: ['count'] }, 20_000);
      expect(readReply.reply.ok).toBe(true);
      expect(readReply.reply.value).toBe(91);

      await signalAndExpectExit(peerProc, 'SIGTERM', 30_000, 0, 'peer (load)');
      await signalAndExpectExit(hubProc, 'SIGTERM', 30_000, 0, 'hub (load)');
    },
    120_000,
  );
});
