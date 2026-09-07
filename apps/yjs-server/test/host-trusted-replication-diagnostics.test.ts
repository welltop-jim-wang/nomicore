/**
 * issue #228 — 收尾验收 T-H8（design §6.2 / §4 AC2 表 trusted replication 行；SA6 §4
 * 注记「host 级 trusted+diag 组合断言建议在最终验收组合中补足」）
 * `host-trusted-replication-diagnostics.test.ts`：peer trusted apply（可信复制）
 * → committed 记录落盘 + strict replay 与数据一致（complete 态）。
 *
 * 钉住的裁决（host 级组合证据；黑盒）：
 * - hub 与 peer 均启用 diagnostics（Hub/Peer 独立本地旁路，#155 语义：本地日志
 *   面与复制 wire 数据面结构性隔离——E5「复制数据面无策略」的互补正向面）；
 * - peer 作为可信复制方从 hub 接收 bootstrap 与后续 diff（hub 写 → peer 收敛，
 *   peer 侧日志记录 `replication-apply` committed attempts——peer 经 import 物化，
 *   import 槽无 genesis 供给（#155「诚实缺席 genesis」语义），故 peer 流首条
 *   恒为 attempt 而非 genesis-baseline）；hub 侧对 peer 远端写同样落 committed
 *   `replication-apply`（本实现实测：hub ops = [namespace-create,
 *   replication-enable, replication-apply, root-mutation, replication-apply]；
 *   peer ops = [replication-apply, replication-apply, root-mutation]）；
 * - strict replay = complete：两侧流 status ok、issues 空、sequence 从 1 连续到 N
 *   （无可解析性/连续性缺陷），重放内容与数据面一致（双侧读同一终值）。
 *
 * 黑盒纪律：真实 spawn hub + peer（main.ts；hub file persistence、peer memory）；
 * stdin NDJSON；真实 WS 复制；断言只消费 stdout 事件与真实文件产物；零源码 grep。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { readStreamStrict } from '@nomicore/namespace-diagnostic-log';
import type { AttemptRecord, DiagnosticChangeRecord } from '@nomicore/namespace-diagnostic-log';

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
  const id = `sa6-228h8-${++opCounter}`;
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
// 配置 / 磁盘布局辅助
// ─────────────────────────────────────────────────────────────────────────────

function hubConfig(opts: { persistRoot: string; logRootDir: string; port: number }): Record<string, unknown> {
  return {
    role: 'hub',
    instanceId: 'hub-1',
    persistence: { kind: 'file', rootDir: opts.persistRoot },
    hub: {
      listen: { host: '127.0.0.1', port: opts.port },
      tokens: { 'peer-1': 'token-1' },
      provision: [{ id: 'p1', ownerUserId: 'alice', schema: VFSL_SCHEMA, root: { count: 0 } }],
      authorization: [{ peerInstanceId: 'peer-1', provisionId: 'p1', read: true, submit: true }],
    },
    diagnostics: { enabled: true, rootDir: opts.logRootDir, updateCapture: true, inputPolicy: 'digest' },
  };
}

function peerConfig(port: number, namespaceId: string, logRootDir: string): Record<string, unknown> {
  return {
    role: 'peer',
    instanceId: 'peer-1',
    persistence: { kind: 'memory' },
    peer: {
      hub: { url: `ws://127.0.0.1:${port}/replication`, hubInstanceId: 'hub-1', token: 'token-1' },
      targets: [{ namespaceId, ownerUserId: 'alice' }],
    },
    diagnostics: { enabled: true, rootDir: logRootDir, updateCapture: true, inputPolicy: 'digest' },
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

function allStrictRecords(logRootDir: string, namespaceId: string, streamId: string): DiagnosticChangeRecord[] {
  const read = readStreamStrict({ rootDir: logRootDir, namespaceId, streamId });
  return read.records.map((r) => r.record).filter((r): r is DiagnosticChangeRecord => r !== null);
}

function attemptOps(records: readonly DiagnosticChangeRecord[]): string[] {
  return records.filter((r): r is AttemptRecord => r.recordKind === 'attempt').map((r) => r.operation);
}

/** 等待某侧日志树建流并返回 current streamId。 */
async function waitLogStream(logRoot: string, namespaceId: string, what: string): Promise<string> {
  await expect
    .poll(
      () => {
        const sid = currentStreamIdOf(logRoot, namespaceId);
        if (sid === null) return false;
        const segments = join(namespaceLogDir(logRoot, namespaceId), 'streams', sid, 'segments');
        if (!existsSync(segments)) return false;
        return readdirSync(segments).some((name) => name.endsWith('.jsonl'));
      },
      { interval: 50, timeout: 30_000 },
    )
    .toBe(true);
  const sid = currentStreamIdOf(logRoot, namespaceId);
  if (sid === null) throw new Error(`${what}：current.json stream 未建立`);
  return sid;
}

describe('issue #228 — T-H8 trusted+diag：hub 与 peer 双侧 diagnostics，peer 可信 apply 落 committed 记录，strict replay complete 且与数据一致（AC2 trusted replication host 级锚）', () => {
  it(
    'hub 写 → peer trusted 复制收敛：peer 本地诊断流含 committed attempt 记录、strict 读全绿（sequence 连续）；hub 流对 peer 远端写同样落 committed 记录；双侧日志与数据一致',
    async () => {
      const persistRoot = makeTmpDir('sa6-228-h8-persist-');
      const hubLogRoot = makeTmpDir('sa6-228-h8-hub-log-');
      const peerLogRoot = makeTmpDir('sa6-228-h8-peer-log-');
      const port = await freePort();

      const hub = spawnApp([
        '--config',
        writeConfig(makeTmpDir('sa6-228-h8-hub-cfg-'), hubConfig({ persistRoot, logRootDir: hubLogRoot, port })),
      ]);
      const provisioned = await waitForEvent(hub, (e) => e.event === 'provisioned', 60_000, 'hub provisioned');
      const namespaceId = provisioned.namespaceId as string;
      expect(namespaceId).toMatch(/^ns-[0-9a-f]{32}$/);
      await waitForEvent(hub, (e) => e.event === 'ready', 60_000, 'hub ready');

      const peer = spawnApp([
        '--config',
        writeConfig(
          makeTmpDir('sa6-228-h8-peer-cfg-'),
          peerConfig(port, namespaceId, peerLogRoot),
        ),
      ]);
      await waitForEvent(peer, (e) => e.event === 'ready', 60_000, 'peer ready');
      await waitForEvent(
        hub,
        (e) => e.event === 'channel-state-changed' && e.side === 'hub' && e.namespaceId === namespaceId && e.to === 'live',
        60_000,
        'hub 侧 channel live',
      );

      // 数据收敛：hub 写 5 → peer 读到 5（bootstrap + trusted 流内推送）
      const writeHub = await sendOp(
        hub,
        { op: 'verify-write', namespaceId, set: ['count'], path: ['count'], value: 5, timeoutMs: 30_000 },
        60_000,
      );
      expect(writeHub.ok).toBe(true);
      await expect
        .poll(
          async () => (await sendOp(peer, { op: 'read', namespaceId, path: ['count'] }, 20_000)).value,
          { interval: 100, timeout: 30_000 },
        )
        .toBe(5);
      // peer 写 9 → hub 读到 9（远端写流回 hub——hub 侧 trusted apply committed 证据源）
      const writePeer = await sendOp(
        peer,
        { op: 'verify-write', namespaceId, set: ['count'], path: ['count'], value: 9, timeoutMs: 30_000 },
        60_000,
      );
      expect(writePeer.ok).toBe(true);
      await expect
        .poll(
          async () => (await sendOp(hub, { op: 'read', namespaceId, path: ['count'] }, 20_000)).value,
          { interval: 100, timeout: 30_000 },
        )
        .toBe(9);

      // ── hub 侧日志：genesis 开头；本地 root-mutation 与远端 replication-apply
      //    （peer 写经 trusted 通道落 hub）均以 committed attempt 落盘 ──
      const hubStream = await waitLogStream(hubLogRoot, namespaceId, 'hub 流');
      await expect
        .poll(
          () => attemptOps(allStrictRecords(hubLogRoot, namespaceId, hubStream)).length >= 4,
          { interval: 50, timeout: 10_000 },
        )
        .toBe(true);
      const hubRead = readStreamStrict({ rootDir: hubLogRoot, namespaceId, streamId: hubStream });
      expect(hubRead.status).toBe('ok');
      expect(hubRead.issues).toEqual([]);
      const hubRecords = allStrictRecords(hubLogRoot, namespaceId, hubStream);
      expect(hubRecords[0]?.recordKind).toBe('genesis-baseline'); // 本地建流（provision）
      const hubOps = attemptOps(hubRecords);
      expect(hubOps).toContain('root-mutation'); // hub 本地写 5
      expect(hubOps).toContain('replication-apply'); // peer 远端写 9 经 trusted apply
      expect(hubRead.records.map((r) => r.sequence)).toEqual(
        hubRead.records.map((_, i) => String(i + 1)),
      );

      // ── peer 侧日志：trusted 复制（hub-to-peer apply）committed 记录落盘 ──
      //    peer 经 import 物化（import 槽无 genesis 供给——#155 语义「诚实缺席
      //    genesis」），故不做 genesis 断言；钉「replication-apply committed」
      //    + strict replay complete（连续序列、零 issue）
      const peerStream = await waitLogStream(peerLogRoot, namespaceId, 'peer 流');
      await expect
        .poll(
          () => {
            const ops = attemptOps(allStrictRecords(peerLogRoot, namespaceId, peerStream));
            return ops.includes('replication-apply');
          },
          { interval: 50, timeout: 10_000 },
        )
        .toBe(true);
      const peerRead = readStreamStrict({ rootDir: peerLogRoot, namespaceId, streamId: peerStream });
      expect(peerRead.status).toBe('ok');
      expect(peerRead.issues).toEqual([]);
      expect(peerRead.records.map((r) => r.sequence)).toEqual(
        peerRead.records.map((_, i) => String(i + 1)),
      );
      const peerAttempts = allStrictRecords(peerLogRoot, namespaceId, peerStream).filter(
        (r): r is AttemptRecord => r.recordKind === 'attempt' && r.operation === 'replication-apply',
      );
      expect(peerAttempts.length).toBeGreaterThan(0);
      expect(
        peerAttempts.every((a) => a.result.kind === 'committed'),
        'peer trusted apply 记录必须全部 committed（无 rejected/fatal 混入）',
      ).toBe(true);

      // ── replay 与数据一致（complete 态）：双侧 strict ok + 序列连续 + 数据收敛
      //    （双侧读同一终值 = 日志覆盖的复制流终态）──
      const hubValue = await sendOp(hub, { op: 'read', namespaceId, path: ['count'] }, 20_000);
      const peerValue = await sendOp(peer, { op: 'read', namespaceId, path: ['count'] }, 20_000);
      expect(hubValue.ok).toBe(true);
      expect(peerValue.ok).toBe(true);
      expect(hubValue.value).toBe(9);
      expect(peerValue.value).toBe(9);

      await signalAndExpectExit(peer, 'SIGTERM', 30_000, 0, 'peer T-H8');
      await sleep(1_500);
      await signalAndExpectExit(hub, 'SIGTERM', 30_000, 0, 'hub T-H8');
    },
    300_000,
  );
});
