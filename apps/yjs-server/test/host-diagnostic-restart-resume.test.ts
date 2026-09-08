/**
 * issue #228 — 收尾验收 T-H6（design §6.2 / §4 AC2 表 restart 行；SA6 §4 注记
 * 「host 级正向『重启续写诊断流』建议最终验收组合补足」）
 * `host-diagnostic-restart-resume.test.ts`：正常重启（无删除）→ current.json 续写
 * **同一 stream**、记录 sequence 连续（#153 语义的 host 级锚）。
 *
 * 钉住的裁决（host 级组合证据；issue #228 变更集的回归锚——restart-resume 语义
 * 不受删除面改动干扰）：
 * - boot 1（provision 建 ns + diagnostics + 本地写）干净停机；boot 2 同
 *   persistRoot/logRoot、无 provision（直引 authorization 恢复同一 nsId，E5/T6
 *   同款重启形态）→ 本地再写；
 * - 同一 stream：boot 2 后 current.json 的 streamId 不变、streams 目录恰 1 个、
 *   genesis-baseline 仍在首位、attempt 记录 sequence 从 1 连续到 N（跨 boot
 *   连续——重启不换流、不重排 sequence）；
 * - 数据面同步恢复：boot 2 首读回 boot 1 写入值（restart 数据耐久），写后回读一致；
 * - strict 读全绿（status ok、issues 空）——重启续写无撕裂、无半态。
 *
 * 黑盒纪律：真实 spawn hub（main.ts）+ file persistence + diagnostics enabled；
 * stdin NDJSON；断言只消费 stdout 事件、真实文件产物与进程生命周期；零源码 grep。
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
  const id = `sa6-228h6-${++opCounter}`;
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

function baseHubConfig(opts: {
  persistRoot: string;
  logRootDir: string;
  port: number;
  provision?: Array<Record<string, unknown>>;
  authorization?: Array<Record<string, unknown>>;
}): Record<string, unknown> {
  const config: Record<string, unknown> = {
    role: 'hub',
    instanceId: 'hub-1',
    persistence: { kind: 'file', rootDir: opts.persistRoot },
    hub: {
      listen: { host: '127.0.0.1', port: opts.port },
      tokens: { 'peer-1': 'token-1' },
    },
    diagnostics: { enabled: true, rootDir: opts.logRootDir, updateCapture: true, inputPolicy: 'digest' },
  };
  if (opts.provision !== undefined) (config.hub as Record<string, unknown>).provision = opts.provision;
  if (opts.authorization !== undefined) (config.hub as Record<string, unknown>).authorization = opts.authorization;
  return config;
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

function listStreamDirs(logRootDir: string, namespaceId: string): string[] {
  const dir = join(namespaceLogDir(logRootDir, namespaceId), 'streams');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.startsWith('log-'));
}

/** strict 读（ADR-0014-LOG 冻结形状）；helper 与 #155 E-series 同款。 */
function strictRead(logRootDir: string, namespaceId: string, streamId: string) {
  return readStreamStrict({ rootDir: logRootDir, namespaceId, streamId });
}

function allStrictRecords(logRootDir: string, namespaceId: string, streamId: string): DiagnosticChangeRecord[] {
  const read = readStreamStrict({ rootDir: logRootDir, namespaceId, streamId });
  return read.records.map((r) => r.record).filter((r): r is DiagnosticChangeRecord => r !== null);
}

function attemptOps(records: readonly DiagnosticChangeRecord[]): string[] {
  return records.filter((r): r is AttemptRecord => r.recordKind === 'attempt').map((r) => r.operation);
}

describe('issue #228 — T-H6 重启续写：正常重启（无删除）→ current.json 续写同一 stream、记录 sequence 连续（AC2 restart 正向 host 级锚）', () => {
  it(
    'boot1（provision + 写）干净停机 → boot2（同根、直引恢复）再写：streamId 不变、恰一流、sequence 1..N 跨 boot 连续、数据恢复一致、strict 全绿',
    async () => {
      const persistRoot = makeTmpDir('sa6-228-h6-persist-');
      const logRoot = makeTmpDir('sa6-228-h6-log-');
      const port = await freePort();

      // ── boot 1：provision + diagnostics + 本地写 ──
      const v1Config = baseHubConfig({
        persistRoot,
        logRootDir: logRoot,
        port,
        provision: [{ id: 'p1', ownerUserId: 'alice', schema: VFSL_SCHEMA, root: { count: 0 } }],
      });
      const hubV1 = spawnApp(['--config', writeConfig(makeTmpDir('sa6-228-h6-cfg-v1-'), v1Config)]);
      const provisioned = await waitForEvent(hubV1, (e) => e.event === 'provisioned', 60_000, 'hub v1 provisioned');
      const namespaceId = provisioned.namespaceId as string;
      expect(namespaceId).toMatch(/^ns-[0-9a-f]{32}$/);
      await waitForEvent(hubV1, (e) => e.event === 'ready', 60_000, 'hub v1 ready');

      // 前置条件：日志建流落盘
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

      // boot 1 写（root-mutation 记录 + 快照落盘）
      const writeV1 = await sendOp(
        hubV1,
        { op: 'verify-write', namespaceId, set: ['count'], path: ['count'], value: 7, timeoutMs: 30_000 },
        60_000,
      );
      expect(writeV1.ok, `boot1 写（${JSON.stringify(writeV1)}）`).toBe(true);
      const readV1 = await sendOp(hubV1, { op: 'read', namespaceId, path: ['count'] }, 30_000);
      expect(readV1.ok).toBe(true);
      expect(readV1.value).toBe(7);
      const streamV1 = currentStreamIdOf(logRoot, namespaceId);
      expect(streamV1).not.toBeNull();

      // boot 1 停机前记录数（sequence 上界；供跨 boot 连续性对照）
      const readBefore = strictRead(logRoot, namespaceId, streamV1 as string);
      expect(readBefore.status).toBe('ok');
      expect(readBefore.issues).toEqual([]);
      const countV1 = readBefore.records.length;
      expect(countV1).toBeGreaterThan(1); // genesis + 至少一次 attempt

      await sleep(1_500); // tsx wrapper ready 窗口 settle
      await signalAndExpectExit(hubV1, 'SIGTERM', 30_000, 0, 'hub v1');

      // ── boot 2：同 rootDir + 同 logRoot，无 provision（直引 authorization 恢复）──
      const v2Config = baseHubConfig({
        persistRoot,
        logRootDir: logRoot,
        port,
        authorization: [
          { peerInstanceId: 'peer-1', namespaceId, ownerUserId: 'alice', read: true, submit: true },
        ],
      });
      const hubV2 = spawnApp(['--config', writeConfig(makeTmpDir('sa6-228-h6-cfg-v2-'), v2Config)]);
      await waitForEvent(hubV2, (e) => e.event === 'ready', 60_000, 'hub v2 ready');

      // 数据面恢复：boot 1 写入值在重启后立即可读（快照耐久 + open 物化）
      await expect
        .poll(
          async () => (await sendOp(hubV2, { op: 'read', namespaceId, path: ['count'] }, 20_000)).value,
          { interval: 50, timeout: 20_000 },
        )
        .toBe(7);

      // boot 2 本地再写（重启后新 Runtime generation 续写同一诊断流）
      const writeV2 = await sendOp(
        hubV2,
        { op: 'verify-write', namespaceId, set: ['count'], path: ['count'], value: 11, timeoutMs: 30_000 },
        60_000,
      );
      expect(writeV2.ok, `boot2 写（${JSON.stringify(writeV2)}）`).toBe(true);
      await expect
        .poll(
          async () => (await sendOp(hubV2, { op: 'read', namespaceId, path: ['count'] }, 20_000)).value,
          { interval: 50, timeout: 20_000 },
        )
        .toBe(11);

      // ── 同一 stream 跨 Runtime generation：streamId 不变、恰 1 个 stream、sequence 连续 ──
      const streamV2 = currentStreamIdOf(logRoot, namespaceId);
      expect(streamV2, '重启后 current.json 必须仍指向同一 stream').toBe(streamV1);
      expect(listStreamDirs(logRoot, namespaceId), '重启不得新建第二个 stream').toHaveLength(1);

      // 新记录已续写：记录数增加、首条仍 genesis-baseline、sequence 1..N 连续
      await expect
        .poll(
          () => allStrictRecords(logRoot, namespaceId, streamV2 as string).length > countV1,
          { interval: 50, timeout: 10_000 },
        )
        .toBe(true);
      const readAfter = strictRead(logRoot, namespaceId, streamV2 as string);
      expect(readAfter.status).toBe('ok');
      expect(readAfter.issues).toEqual([]);
      const recordsAfter = allStrictRecords(logRoot, namespaceId, streamV2 as string);
      expect(recordsAfter[0]?.recordKind).toBe('genesis-baseline');
      expect(readAfter.records.map((r) => r.sequence)).toEqual(
        readAfter.records.map((_, i) => String(i + 1)),
      );
      expect(attemptOps(recordsAfter)).toContain('root-mutation');

      await sleep(1_500); // tsx wrapper ready 窗口 settle
      await signalAndExpectExit(hubV2, 'SIGTERM', 30_000, 0, 'hub v2');
    },
    300_000,
  );
});
