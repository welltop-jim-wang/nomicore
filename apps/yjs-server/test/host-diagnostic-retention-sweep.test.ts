/**
 * issue #228 — 收尾验收 T-H7（design §6.2 / §4 AC2 表 retention 行；SA6 §4 注记
 * 「host 级 retention sweep 场景建议最终验收组合补足」）
 * `host-diagnostic-retention-sweep.test.ts`：config retention 透传 → 关闭段被
 * sweep、open group 不删（#154 包级行为的 host 级组合证据）。
 *
 * 钉住的裁决（host 级、黑盒、确定性）：
 * - Host `diagnostics.retention`（键形状见 config.ts validateDiagnostics）原样透传
 *   给 File adapter（diagnostics.ts ensureAdapter → createFileDiagnosticLog
 *   retention 选项）；retention 属可调类（ADR 0012 §Retention）——不冻结进
 *   manifest、跨重启同 stream 续写后继续生效；
 * - adapter 每次进程内构造（registry open/create/import 触发的懒构造）执行
 *   sweepOnOpen：#154 的 P0 卫生 → P1 年龄 → P2 字节遍历，经 host health observer
 *   以 `{ event: 'diagnostic-log', namespaceId, type: 'retention-swept', … }`
 *   NDJSON 健康事件暴露；
 * - **关闭段（closed segment group）被 sweep**：夹具在重启前预置一个「前代
 *   generation」stream 目录（manifest + 单条 JSONL record 拷贝自本 ns 真实日志、
 *   observedAt 改写为远古时间——模拟历史 generation rotate 后遗留的旧流），重启
 *   续写触发构造期 sweep → 旧流闭组按年龄过期被删除（retention-swept
 *   deletedGroups ≥ 1，NDJSON 健康事件字段白名单 = health.ts 冻结面）；
 * - **open group 不删**：当前流的开段（重启后仍在续写的段）受保护——保护无独立
 *   事件字段，其可观察后果被钉死：sweep 后当前流 strict 读保持 ok、sequence
 *   连续、记录继续增长、current.json 不变、业务写/读照常（sweep 零损伤现行日志）。
 *
 * 黑盒纪律：真实 spawn hub（main.ts）+ file persistence + diagnostics enabled +
 * retention 配置；stdin NDJSON；断言只消费 stdout 事件与真实文件产物；零源码
 * grep。旧 generation 目录由测试按磁盘布局直接预置（layout fixture，非进程内
 * seam）——被扫描/删除的对象是真实文件产物。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
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

/** retention 极短年龄窗：P1 年龄遍历活跃执行，且一切「闭组最晚记录 older than 1ms」
 *  的候选都过期（配合夹具的远古 observedAt 达成确定性删除）。 */
const TINY_RETENTION = Object.freeze({ maxAgeMs: 1 });

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
  const id = `sa6-228h7-${++opCounter}`;
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
    diagnostics: {
      enabled: true,
      rootDir: opts.logRootDir,
      updateCapture: true,
      inputPolicy: 'digest',
      retention: TINY_RETENTION,
    },
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

function requireCurrentStream(logRootDir: string, namespaceId: string): string {
  const sid = currentStreamIdOf(logRootDir, namespaceId);
  if (sid === null) {
    throw new Error(`current.json 缺失/不可读：ns=${namespaceId} root=${logRootDir}`);
  }
  return sid;
}

function listStreamDirs(logRootDir: string, namespaceId: string): string[] {
  const dir = join(namespaceLogDir(logRootDir, namespaceId), 'streams');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.startsWith('log-'));
}

function segmentJsonlFiles(logRootDir: string, namespaceId: string, streamId: string): string[] {
  const segments = join(namespaceLogDir(logRootDir, namespaceId), 'streams', streamId, 'segments');
  if (!existsSync(segments)) return [];
  return readdirSync(segments)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => join(segments, name));
}

function allStrictRecords(logRootDir: string, namespaceId: string, streamId: string): DiagnosticChangeRecord[] {
  const read = readStreamStrict({ rootDir: logRootDir, namespaceId, streamId });
  return read.records.map((r) => r.record).filter((r): r is DiagnosticChangeRecord => r !== null);
}

function attemptOps(records: readonly DiagnosticChangeRecord[]): string[] {
  return records.filter((r): r is AttemptRecord => r.recordKind === 'attempt').map((r) => r.operation);
}

describe('issue #228 — T-H7 retention 透传：config retention → 构造期 sweep：关闭段（前代 generation）被删、open group 不删（AC2 retention host 级锚）', () => {
  it(
    'boot1（provision + 写）干净停机 → 预置前代旧流（真记录拷贝、observedAt 远古化）→ boot2（同根、直引恢复 + retention）续写触发 sweepOnOpen：retention-swept{deletedGroups≥1} 事件、旧流组文件消失、当前流 strict 全绿且 sequence 连续（开组零损伤）、业务读写照常',
    async () => {
      const persistRoot = makeTmpDir('sa6-228-h7-persist-');
      const logRoot = makeTmpDir('sa6-228-h7-log-');
      const port = await freePort();

      // ── boot 1：provision + diagnostics（含 retention）+ 本地写 ──
      const v1Config = baseHubConfig({
        persistRoot,
        logRootDir: logRoot,
        port,
        provision: [{ id: 'p1', ownerUserId: 'alice', schema: VFSL_SCHEMA, root: { count: 0 } }],
      });
      const hubV1 = spawnApp(['--config', writeConfig(makeTmpDir('sa6-228-h7-cfg-v1-'), v1Config)]);
      const provisioned = await waitForEvent(hubV1, (e) => e.event === 'provisioned', 60_000, 'hub v1 provisioned');
      const namespaceId = provisioned.namespaceId as string;
      expect(namespaceId).toMatch(/^ns-[0-9a-f]{32}$/);
      await waitForEvent(hubV1, (e) => e.event === 'ready', 60_000, 'hub v1 ready');
      const writeV1 = await sendOp(
        hubV1,
        { op: 'verify-write', namespaceId, set: ['count'], path: ['count'], value: 7, timeoutMs: 30_000 },
        60_000,
      );
      expect(writeV1.ok, `boot1 写（${JSON.stringify(writeV1)}）`).toBe(true);

      // 等待日志真实落盘（至少一个 JSONL 段文件）并捕获当前流
      await expect
        .poll(
          () => {
            const sid = currentStreamIdOf(logRoot, namespaceId);
            return sid !== null && segmentJsonlFiles(logRoot, namespaceId, sid).length > 0;
          },
          { interval: 20, timeout: 10_000 },
        )
        .toBe(true);
      const streamV1 = requireCurrentStream(logRoot, namespaceId);

      // 记录当前流真实日志内容（后续构造前代旧流夹具 + 跨 boot 连续性对照）
      const recordsV1 = allStrictRecords(logRoot, namespaceId, streamV1);
      expect(recordsV1.length).toBeGreaterThan(1);
      expect(attemptOps(recordsV1)).toContain('root-mutation');
      const segFiles = segmentJsonlFiles(logRoot, namespaceId, streamV1);
      expect(segFiles.length).toBeGreaterThan(0);
      const realJsonlPath = segFiles[0] as string;
      const realJsonl = readFileSync(realJsonlPath, 'utf8');
      const firstLine = realJsonl.split('\n').find((l) => l.trim() !== '');
      expect(firstLine, 'boot1 真实 JSONL 行必须可读').toBeDefined();
      // 拷贝 manifest（含 createdAt 等扫描必需字段）
      const streamDirV1 = join(namespaceLogDir(logRoot, namespaceId), 'streams', streamV1);
      const manifestV1 = readFileSync(join(streamDirV1, 'manifest.json'), 'utf8');

      await sleep(1_500); // tsx wrapper ready 窗口 settle
      await signalAndExpectExit(hubV1, 'SIGTERM', 30_000, 0, 'hub v1');

      // ── 夹具：预置「前代 generation」旧流（layout fixture）──
      //    模拟历史 generation rotate 后遗留的旧流目录：manifest 拷贝自当前流
      //    （scanSweepStreams 只消费 createdAt 定序），段 JSONL 行拷贝自真实记录、
      //    observedAt 改写为远古时间——P1 年龄遍历（maxAgeMs=1）下必然过期。
      const staleStreamId = `log-${randomBytes(16).toString('hex')}`;
      expect(staleStreamId).toMatch(/^log-[0-9a-f]{32}$/);
      const staleStreamDir = join(namespaceLogDir(logRoot, namespaceId), 'streams', staleStreamId);
      const staleSegmentsDir = join(staleStreamDir, 'segments');
      mkdirSync(staleSegmentsDir, { recursive: true });
      writeFileSync(join(staleStreamDir, 'manifest.json'), manifestV1);
      const parsedLine = JSON.parse(firstLine as string) as Record<string, unknown>;
      parsedLine.observedAt = '2000-01-01T00:00:00.000Z'; // 远古：必然越过 maxAgeMs 截止
      writeFileSync(join(staleSegmentsDir, '00000001.jsonl'), `${JSON.stringify(parsedLine)}\n`);
      expect(existsSync(join(staleSegmentsDir, '00000001.jsonl')), '夹具预置必须生效').toBe(true);

      // ── boot 2：同 rootDir + 同 logRoot、无 provision（直引恢复）+ retention ──
      const v2Config = baseHubConfig({
        persistRoot,
        logRootDir: logRoot,
        port,
        authorization: [
          { peerInstanceId: 'peer-1', namespaceId, ownerUserId: 'alice', read: true, submit: true },
        ],
      });
      const hubV2 = spawnApp(['--config', writeConfig(makeTmpDir('sa6-228-h7-cfg-v2-'), v2Config)]);
      await waitForEvent(hubV2, (e) => e.event === 'ready', 60_000, 'hub v2 ready');

      // 驱动物化（直引 ns 首次 open 触发 per-process adapter 构造 → sweepOnOpen）
      const writeV2 = await sendOp(
        hubV2,
        { op: 'verify-write', namespaceId, set: ['count'], path: ['count'], value: 11, timeoutMs: 30_000 },
        60_000,
      );
      expect(writeV2.ok, `boot2 写（${JSON.stringify(writeV2)}）`).toBe(true);

      // sweep 健康事件：旧流闭组被删（deletedGroups ≥ 1）——host retention 配置已
      // 透传并生效的证据（事件字段白名单 = health.ts 冻结面：deletedGroups/
      // reclaimedBytes/orphanBinsDeleted/deletingMarkersCompleted/
      // leaseBlockedGroups/failedSteps；open group 保护无独立事件字段——由下文
      // 「当前流零损伤」断言钉住其可观察后果）
      const swept = await waitForEvent(
        hubV2,
        (e) =>
          e.event === 'diagnostic-log' &&
          e.namespaceId === namespaceId &&
          e.type === 'retention-swept',
        30_000,
        'boot2 retention-swept 健康事件',
      );
      expect(typeof swept.deletedGroups).toBe('number');
      expect((swept.deletedGroups as number) >= 1, `旧流闭组必须被 sweep（事件: ${JSON.stringify(swept)}）`).toBe(true);

      // 旧流组文件消失（闭组被删；流目录残留与否非契约，段文件缺席即删除证据）
      expect(
        existsSync(join(staleSegmentsDir, '00000001.jsonl')),
        'sweep 后旧流段 JSONL 必须缺席',
      ).toBe(false);

      // 当前流零损伤：streamId 不变、恰一活流（旧流 dir 若残留也是空壳）、
      // strict 全绿、sequence 跨 boot 连续、业务读写照常
      const streamV2 = currentStreamIdOf(logRoot, namespaceId);
      expect(streamV2, '当前流 streamId 不得被 sweep 改动').toBe(streamV1);
      const currentDirs = listStreamDirs(logRoot, namespaceId);
      expect(currentDirs.some((d) => d === streamV1), '当前流目录必须仍在').toBe(true);
      const readAfter = readStreamStrict({ rootDir: logRoot, namespaceId, streamId: streamV2 as string });
      expect(readAfter.status).toBe('ok');
      expect(readAfter.issues).toEqual([]);
      expect(readAfter.records.map((r) => r.sequence)).toEqual(
        readAfter.records.map((_, i) => String(i + 1)),
      );
      const recordsAfter = allStrictRecords(logRoot, namespaceId, streamV2 as string);
      expect(recordsAfter[0]?.recordKind).toBe('genesis-baseline');
      expect(recordsAfter.length).toBeGreaterThan(recordsV1.length);
      const readV2 = await sendOp(hubV2, { op: 'read', namespaceId, path: ['count'] }, 30_000);
      expect(readV2.ok).toBe(true);
      expect(readV2.value).toBe(11);

      await sleep(1_500); // tsx wrapper ready 窗口 settle
      await signalAndExpectExit(hubV2, 'SIGTERM', 30_000, 0, 'hub v2');
    },
    300_000,
  );
});
