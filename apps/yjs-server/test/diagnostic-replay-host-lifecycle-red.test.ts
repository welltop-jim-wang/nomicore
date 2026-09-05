/**
 * SA6 红灯契约 — issue #155：Expose diagnostic replay and Host lifecycle configuration
 * （task_expose-diagnostic-replay-host-lifecycle.md；SA8 preflight verdict clear；
 *  Phase 1 实现前初始契约：anchoring acceptance contract before design）。
 *
 * ── 契约来源 ──
 * - 任务简报 AC1–AC6（本地旁路启用 / 冻结-可调二分 / 多 Runtime generation 单 writer +
 *   有界 drain / strict replay + owned bytes + 三态报告 / 七类缺陷 → partial|failed /
 *   E2E 组合场景）；
 * - ADR-0011（best-effort、重放五条件、接口 seam 纪律、数据保护）；
 * - ADR-0012-LOG（§Stream 冻结/可调二分；§Writer 多 generation 共享 writer + 有界 drain；
 *   §Strict reader 与诊断性 replay——replay 报告形状
 *   `{ status: 'complete'|'partial'|'failed', lastAppliedSequence, issues, snapshot? }`、
 *   「replay 强制 strict」「工具不自动串联多个 generation」「即便 complete 也只证明重放了
 *   该 best-effort stream 所持有的记录」）；
 * - #150/#151 SA6 红灯契约先例（seam 形状由契约锚定、设计仲裁修订；全部断言 = 运行时行为）。
 *
 * ── 表面提案（PROPOSAL，供 SA1/SA2 仲裁；语义红线不变）──
 * 1. `AppConfig.diagnostics`（hub/peer 通用、本地旁路；AC1/AC2）：
 *      { enabled: boolean; rootDir: string;
 *        retention?: { maxAgeMs?: number|null; maxBytesPerNamespace?: number|null };
 *        updateCapture?: boolean; inputPolicy?: 'none'|'digest'|'redacted'|'full' }
 *    —— 当前基线：config 校验器拒绝任意顶层 `diagnostics` 键（unknown top-level key）→
 *      全部携带该键的用例在首个 parse 断言处红灯（诚实：操作员启用意图被拒）。
 * 2. Host 工具面（AC4/AC5）：`@nomicore/yjs-server` 入口新增导出
 *      replayNamespaceDiagnosticLog(request: { rootDir; namespaceId }): DiagnosticReplayResult
 *    报告形状逐字段取 ADR-0012-LOG 冻结形状；replay 归 Host 工具面（ADR-0011「完整查询、
 *    导出、重放…属于日志存储/工具模块的 interface」——yjs-server 为本仓唯一 Host 组合根，
 *    可依赖 yjs 构造 detached 快照；命名/归属若仲裁不同 → 仅本文件 import/gate 行修订）。
 *    当前基线：该导出不存在 → 每个 replay 用例在调用门处红灯（诚实：能力缺失）。
 *
 * ── 红灯纪律 ──
 * - 只断言可观察运行时行为（config 校验结果、进程 NDJSON 事件、控制通道回执、真实文件
 *   产物、strict 读取记录、快照 bytes 对 detached Y.Doc 的重放状态）；零源码 grep。
 * - 无 skip / 无 env 兜底 / 无软断言；用例独立、确定性夹具（真实 Y.Doc 增量 bytes）。
 * - replay issue code 词表为契约提案（语义类缺陷码取自 ADR-0011 五条件 / ADR-0012-LOG
 *   缺陷清单原文，物理类缺陷沿 strict reader 既有码族：sequence-gap / invalid-json）；
 *   裁定不同按设计仲裁修订（#151 先例）。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type {
  AttemptRecord,
  DiagnosticChangeRecord,
  NamespaceDiagnosticChangeEmission,
} from '../../../packages/namespace-diagnostic-log/src/index.js';
import {
  createFileDiagnosticLog,
  readStreamStrict,
  type FileDiagnosticLog,
} from '../../../packages/namespace-diagnostic-log/src/index.js';
import {
  parseAppConfig,
  type AppConfig,
  type ConfigValidationError,
} from '../src/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// 表面提案类型（PROPOSAL —— 供设计仲裁；见文件头）
// ─────────────────────────────────────────────────────────────────────────────

/** AppConfig.diagnostics 键形状提案（AC1/AC2）。 */
export interface DiagnosticsConfigProposal {
  enabled: boolean;
  rootDir: string;
  retention?: { maxAgeMs?: number | null; maxBytesPerNamespace?: number | null };
  updateCapture?: boolean;
  inputPolicy?: 'none' | 'digest' | 'redacted' | 'full';
}

/** replay 报告形状（ADR-0012-LOG §Strict reader 逐字段冻结）。 */
export interface DiagnosticReplayResult {
  status: 'complete' | 'partial' | 'failed';
  lastAppliedSequence: string | null;
  issues: readonly { code: string }[];
  snapshot?: Uint8Array;
}

export type ReplayTool = (request: { rootDir: string; namespaceId: string }) => DiagnosticReplayResult;

// ─────────────────────────────────────────────────────────────────────────────
// 通用夹具（进程 E2E 原语：沿用 T6 hub-restart 套件同款）
// ─────────────────────────────────────────────────────────────────────────────

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const TSX_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
const MAIN_TS = join(REPO_ROOT, 'apps', 'yjs-server', 'src', 'main.ts');

const VFSL_SCHEMA = { lang: 'vfsl', version: 1, id: 'notes-v1', text: 'type ROOT = { count: number; };\n' };
const VFSL_SCHEMA_V2 = {
  lang: 'vfsl',
  version: 1,
  id: 'notes-v2',
  text: 'type ROOT = { count: number; note?: string; };\n',
};

const NS_ID = 'ns-00000000000000000000000000000001';
const OBSERVED_AT = '2026-08-28T12:00:00.000Z';
const POLICY_MARKERS = ['updateCapture', 'inputPolicy', 'diagnostics', 'logRoot'];

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
    env: { ...process.env },
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
  const id = `sa6-155-${++opCounter}`;
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
// Host 配置 / 日志布局辅助（行为断言只消费真实文件产物）
// ─────────────────────────────────────────────────────────────────────────────

/** hub 配置合成器（diagnostics 为契约提案键；provision/authorization 可选）。 */
function hubConfig(
  opts: {
    rootDir: string;
    logRootDir: string;
    port: number;
    provision?: Array<Record<string, unknown>>;
    authorization?: Array<Record<string, unknown>>;
    diagnostics?: DiagnosticsConfigProposal;
  },
): Record<string, unknown> {
  const config: Record<string, unknown> = {
    role: 'hub',
    instanceId: 'hub-1',
    persistence: { kind: 'file', rootDir: opts.rootDir },
    hub: {
      listen: { host: '127.0.0.1', port: opts.port },
      tokens: { 'peer-1': 'token-1' },
    },
    diagnostics: {
      enabled: true,
      rootDir: opts.logRootDir,
      updateCapture: true,
      inputPolicy: 'digest',
      ...opts.diagnostics,
    },
  };
  if (opts.provision !== undefined) {
    (config.hub as Record<string, unknown>).provision = opts.provision;
  }
  if (opts.authorization !== undefined) {
    (config.hub as Record<string, unknown>).authorization = opts.authorization;
  }
  return config;
}

function peerConfig(port: number, namespaceId: string): Record<string, unknown> {
  return {
    role: 'peer',
    instanceId: 'peer-1',
    persistence: { kind: 'memory' },
    peer: {
      hub: { url: `ws://127.0.0.1:${port}/replication`, hubInstanceId: 'hub-1', token: 'token-1' },
      targets: [{ namespaceId, ownerUserId: 'alice' }],
    },
  };
}

/** 日志布局读取（ADR-0012-LOG：{rootDir}/namespaces/{namespaceId}/…）。 */
function namespaceLogDir(logRootDir: string, namespaceId: string): string {
  return join(logRootDir, 'namespaces', namespaceId);
}

function currentStreamId(logRootDir: string, namespaceId: string): string | null {
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

/** 语义 emission（attemptId 递增、stage/source 取冻结词表；result 由用例给定）。 */
let attemptSeqCounter = 0;
function emissionFor(
  operation: 'namespace-create' | 'root-mutation' | 'schema-replacement',
  result: NamespaceDiagnosticChangeEmission['result'],
): NamespaceDiagnosticChangeEmission {
  attemptSeqCounter += 1;
  const hex = attemptSeqCounter.toString(16).padStart(32, '0').slice(0, 32);
  return {
    operation,
    stage: 'transaction',
    observedAt: OBSERVED_AT,
    attemptId: `att-${hex}`,
    source: { kind: 'local' },
    result,
  };
}

/** 造一个真实 namespace 演化生产 doc（META 受控身份 + ROOT.count 业务值）。 */
function makeProductionDoc(count: number): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('META').set('docId', NS_ID);
  doc.getMap('META').set('replicationId', '0123456789abcdef0123456789abcdef');
  doc.getMap('META').set('replicationEpoch', 1);
  doc.getMap('ROOT').set('count', count);
  return doc;
}

function applySnapshotToFreshDoc(snapshot: Uint8Array): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, snapshot);
  return doc;
}

function logicalState(doc: Y.Doc): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of doc.getMap('ROOT')) {
    out[`ROOT.${key}`] = value;
  }
  for (const [key, value] of doc.getMap('META')) {
    out[`META.${key}`] = value;
  }
  return out;
}

function expectSameLogicalState(expected: Y.Doc, actual: Y.Doc): void {
  expect(logicalState(actual)).toEqual(logicalState(expected));
}

function allStrictRecords(logRootDir: string, namespaceId: string, streamId: string): DiagnosticChangeRecord[] {
  const read = readStreamStrict({ rootDir: logRootDir, namespaceId, streamId });
  return read.records.map((r) => r.record).filter((r): r is DiagnosticChangeRecord => r !== null);
}

function attemptOps(records: readonly DiagnosticChangeRecord[]): string[] {
  return records.filter((r): r is AttemptRecord => r.recordKind === 'attempt').map((r) => r.operation);
}

// ─────────────────────────────────────────────────────────────────────────────
// Part 1 — AC1/AC2 配置面（红灯：diagnostics 顶层键今日被拒）
// ─────────────────────────────────────────────────────────────────────────────

describe('issue #155 — Host diagnostics 配置面（AC1/AC2；PROPOSAL 键 `diagnostics`）', () => {
  it('hub 配置接受完整 diagnostics 块并原样保留（enabled/rootDir/updateCapture/inputPolicy/retention）', () => {
    const raw = hubConfig({
      rootDir: '/tmp/irrelevant-persist-root',
      logRootDir: '/tmp/irrelevant-log-root',
      port: 0,
      diagnostics: {
        enabled: true,
        rootDir: '/tmp/irrelevant-log-root',
        updateCapture: true,
        inputPolicy: 'full',
        retention: { maxAgeMs: 3_600_000, maxBytesPerNamespace: 10_000_000 },
      },
    });
    const parsed = parseAppConfig(raw);
    expect(parsed.role).toBe('hub');
    const diagnostics = (parsed as unknown as { diagnostics?: unknown }).diagnostics;
    expect(diagnostics).toMatchObject({
      enabled: true,
      rootDir: '/tmp/irrelevant-log-root',
      updateCapture: true,
      inputPolicy: 'full',
      retention: { maxAgeMs: 3_600_000, maxBytesPerNamespace: 10_000_000 },
    });
  });

  it('peer 配置同样接受 diagnostics 块（Hub/Peer 各自独立本地启用）', () => {
    const raw = {
      role: 'peer',
      instanceId: 'peer-1',
      persistence: { kind: 'memory' },
      peer: {
        hub: { url: 'ws://127.0.0.1:9/replication', hubInstanceId: 'hub-1', token: 'token-1' },
        targets: [],
      },
      diagnostics: { enabled: true, rootDir: '/tmp/peer-log-root' },
    };
    const parsed = parseAppConfig(raw);
    expect(parsed.role).toBe('peer');
    expect((parsed as unknown as { diagnostics?: unknown }).diagnostics).toMatchObject({
      enabled: true,
      rootDir: '/tmp/peer-log-root',
    });
  });

  it('enabled:false 是合法显式关闭（操作员可选不启用）', () => {
    const raw = hubConfig({
      rootDir: '/tmp/x',
      logRootDir: '/tmp/y',
      port: 0,
      diagnostics: { enabled: false, rootDir: '/tmp/y' },
    });
    const parsed = parseAppConfig(raw);
    expect((parsed as unknown as { diagnostics?: unknown }).diagnostics).toMatchObject({
      enabled: false,
    });
  });

  it('retention 显式 null 关闭某限制是合法值（ADR-0012-LOG：`null` 关闭，`0` 非无限）', () => {
    const raw = hubConfig({
      rootDir: '/tmp/x',
      logRootDir: '/tmp/y',
      port: 0,
      diagnostics: {
        enabled: true,
        rootDir: '/tmp/y',
        retention: { maxAgeMs: null, maxBytesPerNamespace: 0 },
      },
    });
    const parsed = parseAppConfig(raw);
    expect((parsed as unknown as { diagnostics?: unknown }).diagnostics).toMatchObject({
      retention: { maxAgeMs: null, maxBytesPerNamespace: 0 },
    });
  });

  it('diagnostics 未知子键被拒绝且 violation path 指向 diagnostics.<key>', () => {
    const raw = hubConfig({ rootDir: '/tmp/x', logRootDir: '/tmp/y', port: 0 });
    (raw as Record<string, unknown>).diagnostics = { enabled: true, rootDir: '/tmp/y', wat: 1 };
    let thrown: unknown;
    try {
      parseAppConfig(raw);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeDefined();
    const err = thrown as ConfigValidationError;
    expect(err.violations.map((v) => v.path)).toContain('diagnostics.wat');
  });

  it('diagnostics 非法形状值被拒绝且 violation path 指向具体字段（retention 负值 / updateCapture 非布尔 / inputPolicy 越界 / rootDir 非串）', () => {
    const cases: Array<{ path: string; diagnostics: Record<string, unknown> }> = [
      { path: 'diagnostics.retention.maxAgeMs', diagnostics: { enabled: true, rootDir: '/tmp/y', retention: { maxAgeMs: -5 } } },
      { path: 'diagnostics.updateCapture', diagnostics: { enabled: true, rootDir: '/tmp/y', updateCapture: 'yes' } },
      { path: 'diagnostics.inputPolicy', diagnostics: { enabled: true, rootDir: '/tmp/y', inputPolicy: 'everything' } },
      { path: 'diagnostics.rootDir', diagnostics: { enabled: true, rootDir: 42 } },
    ];
    for (const c of cases) {
      const raw = hubConfig({ rootDir: '/tmp/x', logRootDir: '/tmp/y', port: 0 });
      (raw as Record<string, unknown>).diagnostics = c.diagnostics;
      let thrown: unknown;
      try {
        parseAppConfig(raw);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, `${c.path} 应被拒绝`).toBeDefined();
      const err = thrown as ConfigValidationError;
      expect(err.violations.map((v) => v.path), `${c.path} 违规路径`).toContain(c.path);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Part 2 — AC4/AC5 replay 工具契约（红灯：入口尚无 replayNamespaceDiagnosticLog 导出）
// ─────────────────────────────────────────────────────────────────────────────

/** replay 工具门（PROPOSAL 面：@nomicore/yjs-server 入口导出；当前基线缺失 → 红灯）。 */
async function requireReplayTool(): Promise<ReplayTool> {
  const entry = (await import('../src/index.js')) as unknown as {
    replayNamespaceDiagnosticLog?: unknown;
  };
  const fn = entry.replayNamespaceDiagnosticLog;
  if (typeof fn !== 'function') {
    throw new Error(
      '[issue-155 contract] `@nomicore/yjs-server` 入口必须导出 ' +
        'replayNamespaceDiagnosticLog(request): DiagnosticReplayResult（PROPOSAL 面，' +
        'ADR-0012-LOG §Strict reader 报告形状）；当前基线该导出缺失',
    );
  }
  return fn as ReplayTool;
}

describe('issue #155 — strict diagnostic replay 工具契约（AC4/AC5）', () => {
  it('R1 健康链完整重放：genesis + create + 3 committed 增量 + noop → complete + owned snapshot 复现终态', async () => {
    const tool = await requireReplayTool();
    const rootDir = makeTmpDir('sa6-155-r1-');
    const prod = makeProductionDoc(1);
    const genesisBytes = Y.encodeStateAsUpdate(prod);
    const log = createFileDiagnosticLog({
      rootDir,
      namespaceId: NS_ID,
      updateCapture: true,
      genesisUpdateBytes: genesisBytes,
    });
    log.emitter.emit(
      emissionFor('namespace-create', { kind: 'committed', effect: 'update', updateBytes: genesisBytes }),
    );
    for (let i = 0; i < 3; i += 1) {
      const sv = Y.encodeStateVector(prod);
      prod.getMap('ROOT').set('count', 2 + i);
      const delta = Y.encodeStateAsUpdate(prod, sv);
      log.emitter.emit(
        emissionFor('root-mutation', { kind: 'committed', effect: 'update', updateBytes: delta }),
      );
    }
    // noop（零写入尝试）——replay 按连续记录计数、不改变状态
    log.emitter.emit(emissionFor('root-mutation', { kind: 'committed', effect: 'noop' }));

    const result = tool({ rootDir, namespaceId: NS_ID });
    expect(result.status).toBe('complete');
    expect(result.issues).toEqual([]);
    expect(result.lastAppliedSequence).toBe('6'); // genesis=1, create=2, m1=3, m2=4, m3=5, noop=6
    expect(result.snapshot).toBeInstanceOf(Uint8Array);
    expectSameLogicalState(prod, applySnapshotToFreshDoc(result.snapshot as Uint8Array));
  });

  it('R2 快照 bytes 为 detached owned 副本：重复调用稳定、篡改返回值不影响后续、日志流不被改动、不暴露 live Y.Doc', async () => {
    const tool = await requireReplayTool();
    const rootDir = makeTmpDir('sa6-155-r2-');
    const prod = makeProductionDoc(1);
    const log = createFileDiagnosticLog({
      rootDir,
      namespaceId: NS_ID,
      updateCapture: true,
      genesisUpdateBytes: Y.encodeStateAsUpdate(prod),
    });
    const sv = Y.encodeStateVector(prod);
    prod.getMap('ROOT').set('count', 5);
    log.emitter.emit(
      emissionFor('root-mutation', { kind: 'committed', effect: 'update', updateBytes: Y.encodeStateAsUpdate(prod, sv) }),
    );

    const first = tool({ rootDir, namespaceId: NS_ID });
    const second = tool({ rootDir, namespaceId: NS_ID });
    expect(first.status).toBe('complete');
    expect(second.status).toBe('complete');
    expect(Buffer.from(first.snapshot as Uint8Array).equals(Buffer.from(second.snapshot as Uint8Array))).toBe(true);
    // 篡改返回的 bytes（owned 副本）不影响后续调用与磁盘流
    (first.snapshot as Uint8Array).fill(0);
    const third = tool({ rootDir, namespaceId: NS_ID });
    expect(third.status).toBe('complete');
    expectSameLogicalState(prod, applySnapshotToFreshDoc(third.snapshot as Uint8Array));

    const streamId = currentStreamId(rootDir, NS_ID);
    expect(streamId).not.toBeNull();
    const read = readStreamStrict({ rootDir, namespaceId: NS_ID, streamId: streamId as string });
    expect(read.status).toBe('ok');
    expect(read.records.map((r) => r.sequence)).toEqual(['1', '2']);
    expect((read.records[0]?.record as { recordKind?: string } | null | undefined)?.recordKind).toBe(
      'genesis-baseline',
    );
  });

  it('R3 缺 genesis（stream 只有 committed attempt 记录）→ 不得 complete，issues 含 genesis 类码', async () => {
    const tool = await requireReplayTool();
    const rootDir = makeTmpDir('sa6-155-r3-');
    const prod = makeProductionDoc(1);
    const log = createFileDiagnosticLog({ rootDir, namespaceId: NS_ID, updateCapture: true });
    const sv = Y.encodeStateVector(prod);
    prod.getMap('ROOT').set('count', 2);
    log.emitter.emit(
      emissionFor('root-mutation', { kind: 'committed', effect: 'update', updateBytes: Y.encodeStateAsUpdate(prod, sv) }),
    );

    const result = tool({ rootDir, namespaceId: NS_ID });
    expect(result.status).not.toBe('complete');
    expect(result.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining([expect.stringContaining('genesis')]) as unknown as string[],
    );
  });

  it('R4 retention 裁剪（前缀整组被删、history trimmed）→ 不得 complete，issues 非空', async () => {
    const tool = await requireReplayTool();
    const rootDir = makeTmpDir('sa6-155-r4-');
    const prod = makeProductionDoc(1);
    const log = createFileDiagnosticLog({
      rootDir,
      namespaceId: NS_ID,
      updateCapture: true,
      genesisUpdateBytes: Y.encodeStateAsUpdate(prod),
      targetRecordsPerSegment: 1, // 每条记录独占一段 → 产生可删闭组
      retention: { maxAgeMs: 60_000, maxBytesPerNamespace: null, sweepOnOpen: false },
      clock: { now: () => Date.parse(OBSERVED_AT) }, // manifest createdAt 与 genesis observedAt 同源
    });
    for (let i = 0; i < 4; i += 1) {
      const sv = Y.encodeStateVector(prod);
      prod.getMap('ROOT').set('count', 2 + i);
      log.emitter.emit(
        emissionFor('root-mutation', { kind: 'committed', effect: 'update', updateBytes: Y.encodeStateAsUpdate(prod, sv) }),
      );
    }
    const sweep = log.sweepRetention({ now: new Date('2026-08-28T13:00:00.000Z').getTime() });
    expect(sweep.deletedGroups).toBeGreaterThan(0);

    const result = tool({ rootDir, namespaceId: NS_ID });
    expect(result.status).not.toBe('complete');
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('R5 中段真缺口（删一条完整记录 → sequence-gap）→ 不得 complete，issues 含 gap 码', async () => {
    const tool = await requireReplayTool();
    const rootDir = makeTmpDir('sa6-155-r5-');
    const prod = makeProductionDoc(1);
    const log = createFileDiagnosticLog({
      rootDir,
      namespaceId: NS_ID,
      updateCapture: true,
      genesisUpdateBytes: Y.encodeStateAsUpdate(prod),
    });
    for (let i = 0; i < 4; i += 1) {
      const sv = Y.encodeStateVector(prod);
      prod.getMap('ROOT').set('count', 2 + i);
      log.emitter.emit(
        emissionFor('root-mutation', { kind: 'committed', effect: 'update', updateBytes: Y.encodeStateAsUpdate(prod, sv) }),
      );
    }
    // 同段内行丢失 = 真损坏（README §裁剪历史：组内行丢失不产生 historyTrimmed，报 gap）
    const streamId = currentStreamId(rootDir, NS_ID) as string;
    const jsonlPath = join(namespaceLogDir(rootDir, NS_ID), 'streams', streamId, 'segments', '00000001.jsonl');
    const lines = readFileSync(jsonlPath, 'utf8').split('\n').filter((l) => l.length > 0);
    expect(lines.length).toBe(5); // genesis + 4 attempts
    writeFileSync(jsonlPath, `${[...lines.slice(0, 2), ...lines.slice(3)].join('\n')}\n`);

    const result = tool({ rootDir, namespaceId: NS_ID });
    expect(result.status).not.toBe('complete');
    expect(result.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining([expect.stringContaining('gap')]) as unknown as string[],
    );
  });

  it('R6 中段损坏（行替换为垃圾 → invalid-json）→ 不得 complete', async () => {
    const tool = await requireReplayTool();
    const rootDir = makeTmpDir('sa6-155-r6-');
    const prod = makeProductionDoc(1);
    const log = createFileDiagnosticLog({
      rootDir,
      namespaceId: NS_ID,
      updateCapture: true,
      genesisUpdateBytes: Y.encodeStateAsUpdate(prod),
    });
    for (let i = 0; i < 3; i += 1) {
      const sv = Y.encodeStateVector(prod);
      prod.getMap('ROOT').set('count', 2 + i);
      log.emitter.emit(
        emissionFor('root-mutation', { kind: 'committed', effect: 'update', updateBytes: Y.encodeStateAsUpdate(prod, sv) }),
      );
    }
    const streamId = currentStreamId(rootDir, NS_ID) as string;
    const jsonlPath = join(namespaceLogDir(rootDir, NS_ID), 'streams', streamId, 'segments', '00000001.jsonl');
    const lines = readFileSync(jsonlPath, 'utf8').split('\n');
    lines[2] = 'this-is-not-json-garbage';
    writeFileSync(jsonlPath, lines.join('\n'));

    const result = tool({ rootDir, namespaceId: NS_ID });
    expect(result.status).not.toBe('complete');
    expect(result.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining([expect.stringContaining('invalid-json')]) as unknown as string[],
    );
  });

  it('R7 committed update omitted（update capture 关闭 → update-omitted/update-capture-disabled）→ 不得 complete', async () => {
    const tool = await requireReplayTool();
    const rootDir = makeTmpDir('sa6-155-r7-');
    const prod = makeProductionDoc(1);
    const log = createFileDiagnosticLog({ rootDir, namespaceId: NS_ID, updateCapture: false });
    const sv = Y.encodeStateVector(prod);
    prod.getMap('ROOT').set('count', 2);
    log.emitter.emit(
      emissionFor('root-mutation', { kind: 'committed', effect: 'update', updateBytes: Y.encodeStateAsUpdate(prod, sv) }),
    );
    // 落盘记录必须为 update-omitted 形状（storage projection 按 capture=false 收口——无 carrier）
    const streamId = currentStreamId(rootDir, NS_ID) as string;
    const jsonlPath = join(namespaceLogDir(rootDir, NS_ID), 'streams', streamId, 'segments', '00000001.jsonl');
    const stored = JSON.parse(readFileSync(jsonlPath, 'utf8').split('\n')[0] as string) as {
      result?: { effect?: string; reason?: string };
    };
    expect(stored.result?.effect).toBe('update-omitted');
    expect(stored.result?.reason).toBe('update-capture-disabled');

    const result = tool({ rootDir, namespaceId: NS_ID });
    expect(result.status).not.toBe('complete');
    expect(result.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining([expect.stringContaining('omitted')]) as unknown as string[],
    );
  });

  it('R8 受控 identity 与请求目标不一致（doc META.docId ≠ namespaceId）→ 不得 complete，issues 含 identity 码', async () => {
    const tool = await requireReplayTool();
    const rootDir = makeTmpDir('sa6-155-r8-');
    const prod = new Y.Doc();
    prod.getMap('META').set('docId', 'ns-ffffffffffffffffffffffffffffffff'); // 与日志目录 namespaceId 不同
    prod.getMap('META').set('replicationId', '0123456789abcdef0123456789abcdef');
    prod.getMap('META').set('replicationEpoch', 1);
    prod.getMap('ROOT').set('count', 1);
    const log = createFileDiagnosticLog({
      rootDir,
      namespaceId: NS_ID,
      updateCapture: true,
      genesisUpdateBytes: Y.encodeStateAsUpdate(prod),
    });
    const sv = Y.encodeStateVector(prod);
    prod.getMap('ROOT').set('count', 3);
    log.emitter.emit(
      emissionFor('root-mutation', { kind: 'committed', effect: 'update', updateBytes: Y.encodeStateAsUpdate(prod, sv) }),
    );

    const result = tool({ rootDir, namespaceId: NS_ID });
    expect(result.status).not.toBe('complete');
    expect(result.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining([expect.stringContaining('identity')]) as unknown as string[],
    );
  });

  it('R9 不兼容格式（manifest frameVersion 未知）→ 不得 complete（replay 强制 strict，不近似解释）', async () => {
    const tool = await requireReplayTool();
    const rootDir = makeTmpDir('sa6-155-r9-');
    const prod = makeProductionDoc(1);
    const log = createFileDiagnosticLog({
      rootDir,
      namespaceId: NS_ID,
      updateCapture: true,
      genesisUpdateBytes: Y.encodeStateAsUpdate(prod),
    });
    void log;
    const streamId = currentStreamId(rootDir, NS_ID) as string;
    const manifestPath = join(namespaceLogDir(rootDir, NS_ID), 'streams', streamId, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    manifest.frameVersion = 99;
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const result = tool({ rootDir, namespaceId: NS_ID });
    expect(result.status).not.toBe('complete');
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('R10 不自动跨 generation 拼接：冻结格式策略改变 → 新 generation 承接，replay 基于当前 generation 自身链报告', async () => {
    const tool = await requireReplayTool();
    const rootDir = makeTmpDir('sa6-155-r10-');
    const prod = makeProductionDoc(1);
    const log1 = createFileDiagnosticLog({
      rootDir,
      namespaceId: NS_ID,
      updateCapture: true,
      genesisUpdateBytes: Y.encodeStateAsUpdate(prod),
    });
    const stream1 = log1.streamId;
    let sv = Y.encodeStateVector(prod);
    prod.getMap('ROOT').set('count', 2);
    log1.emitter.emit(
      emissionFor('root-mutation', { kind: 'committed', effect: 'update', updateBytes: Y.encodeStateAsUpdate(prod, sv) }),
    );
    // 冻结格式策略改变（inline threshold 4096→8192）→ 旧 stream 不可安全续写 → 新 generation
    const log2 = createFileDiagnosticLog({
      rootDir,
      namespaceId: NS_ID,
      updateCapture: true,
      inlineUpdateMaxBytes: 8192,
      genesisUpdateBytes: Y.encodeStateAsUpdate(prod),
    });
    const stream2 = log2.streamId;
    expect(stream2).not.toBe(stream1);
    expect(currentStreamId(rootDir, NS_ID)).toBe(stream2);
    sv = Y.encodeStateVector(prod);
    prod.getMap('ROOT').set('count', 9);
    log2.emitter.emit(
      emissionFor('root-mutation', { kind: 'committed', effect: 'update', updateBytes: Y.encodeStateAsUpdate(prod, sv) }),
    );

    const result = tool({ rootDir, namespaceId: NS_ID });
    expect(result.status).toBe('complete'); // 当前 generation 自身链健康
    expectSameLogicalState(prod, applySnapshotToFreshDoc(result.snapshot as Uint8Array));
    const read = readStreamStrict({ rootDir, namespaceId: NS_ID, streamId: stream2 });
    const last = read.records[read.records.length - 1];
    expect(result.lastAppliedSequence).toBe(last?.sequence ?? null);
  });

  it('R11 无日志（namespace 无 stream）→ failed + snapshot 缺席 + issues 非空（诚实报告，非 complete）', async () => {
    const tool = await requireReplayTool();
    const rootDir = makeTmpDir('sa6-155-r11-');
    const result = tool({ rootDir, namespaceId: NS_ID });
    expect(result.status).toBe('failed');
    expect(result.snapshot).toBeUndefined();
    expect(result.lastAppliedSequence).toBeNull();
    expect(result.issues.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Part 3 — AC1/AC3/AC6 Host 生命周期 E2E（红灯：config 携带 diagnostics → 首断言拒绝）
// ─────────────────────────────────────────────────────────────────────────────

function expectDiagnosticsAccepted(config: Record<string, unknown>): void {
  // 红灯锚（AC1 配置面）：当前基线 parse 抛 ConfigValidationError（unknown top-level
  // key: diagnostics）→ 用例在此失败；实现后同一调用继续进入完整场景断言。
  const parsed = parseAppConfig(config);
  expect((parsed as unknown as { diagnostics?: unknown }).diagnostics).toMatchObject({
    enabled: true,
  });
}

describe('issue #155 — Host 生命周期 E2E（AC1/AC3/AC6）', () => {
  it('E1 启用从 namespace 创建起：provision create → genesis-baseline + create/replication-enable 记录落地，策略不进数据面与 snapshot', async () => {
    const persistRoot = makeTmpDir('sa6-155-e1-persist-');
    const logRoot = makeTmpDir('sa6-155-e1-log-');
    const port = await freePort();
    const config = hubConfig({
      rootDir: persistRoot,
      logRootDir: logRoot,
      port,
      provision: [{ id: 'p1', ownerUserId: 'alice', schema: VFSL_SCHEMA, root: { count: 0 } }],
    });
    expectDiagnosticsAccepted(config);

    const hub = spawnApp(['--config', writeConfig(makeTmpDir('sa6-155-e1-cfg-'), config)]);
    const provisioned = await waitForEvent(hub, (e) => e.event === 'provisioned', 60_000, 'hub provisioned');
    const namespaceId = provisioned.namespaceId as string;
    expect(namespaceId).toMatch(/^ns-[0-9a-f]{32}$/);
    await waitForEvent(hub, (e) => e.event === 'ready', 60_000, 'hub ready');

    // 日志从创建起：locator + 单一 stream；首条 genesis-baseline；namespace-create 与
    // replication-enable（provision 内部 enableReplication）attempt 记录
    const streamId = currentStreamId(logRoot, namespaceId);
    expect(streamId, 'log current.json 必须存在（创建即建流）').not.toBeNull();
    expect(listStreamDirs(logRoot, namespaceId)).toHaveLength(1);
    const records = allStrictRecords(logRoot, namespaceId, streamId as string);
    expect(records[0]?.recordKind).toBe('genesis-baseline');
    const ops = attemptOps(records);
    expect(ops).toContain('namespace-create');
    expect(ops).toContain('replication-enable');

    // 数据面隔离：ROOT 业务值照常；persistence snapshot bytes 不含任何日志策略标记
    const readCount = await sendOp(hub, { op: 'read', namespaceId, path: ['count'] }, 30_000);
    expect(readCount.ok).toBe(true);
    expect(readCount.value).toBe(0);
    const snapshotFiles: string[] = [];
    const usersDir = join(persistRoot, 'users');
    if (existsSync(usersDir)) {
      for (const user of readdirSync(usersDir)) {
        const userDir = join(usersDir, user);
        if (!existsSync(userDir)) continue;
        for (const file of readdirSync(userDir)) {
          if (file.endsWith('.snapshot')) snapshotFiles.push(join(userDir, file));
        }
      }
    }
    expect(snapshotFiles.length).toBeGreaterThan(0);
    for (const file of snapshotFiles) {
      const bytes = readFileSync(file);
      for (const marker of POLICY_MARKERS) {
        expect(bytes.includes(Buffer.from(marker)), `snapshot ${file} 不得含策略标记 ${marker}`).toBe(false);
      }
    }

    await signalAndExpectExit(hub, 'SIGTERM', 30_000, 0, 'hub E1');
  }, 300_000);

  it('E2 ROOT/SCHEMA 变更链记录：verify-write 与 replace-schema 产生 committed 记录且 sequence 连续', async () => {
    const persistRoot = makeTmpDir('sa6-155-e2-persist-');
    const logRoot = makeTmpDir('sa6-155-e2-log-');
    const port = await freePort();
    const config = hubConfig({
      rootDir: persistRoot,
      logRootDir: logRoot,
      port,
      provision: [{ id: 'p1', ownerUserId: 'alice', schema: VFSL_SCHEMA, root: { count: 0 } }],
    });
    expectDiagnosticsAccepted(config);

    const hub = spawnApp(['--config', writeConfig(makeTmpDir('sa6-155-e2-cfg-'), config)]);
    const provisioned = await waitForEvent(hub, (e) => e.event === 'provisioned', 60_000, 'hub provisioned');
    const namespaceId = provisioned.namespaceId as string;
    await waitForEvent(hub, (e) => e.event === 'ready', 60_000, 'hub ready');

    const writeReply = await sendOp(
      hub,
      { op: 'verify-write', namespaceId, set: ['count'], path: ['count'], value: 7, timeoutMs: 30_000 },
      60_000,
    );
    expect(writeReply.ok).toBe(true);
    const schemaReply = await sendOp(
      hub,
      { op: 'replace-schema', namespaceId, schema: VFSL_SCHEMA_V2, root: { count: 7 } },
      60_000,
    );
    expect(schemaReply.ok).toBe(true);
    const readCount = await sendOp(hub, { op: 'read', namespaceId, path: ['count'] }, 30_000);
    expect(readCount.ok).toBe(true);
    expect(readCount.value).toBe(7);

    const streamId = currentStreamId(logRoot, namespaceId);
    expect(streamId).not.toBeNull();
    const records = allStrictRecords(logRoot, namespaceId, streamId as string);
    expect(records.length).toBeGreaterThan(2);
    const ops = attemptOps(records);
    expect(ops).toContain('root-mutation');
    expect(ops).toContain('schema-replacement');
    await signalAndExpectExit(hub, 'SIGTERM', 30_000, 0, 'hub E2');
  }, 300_000);

  it('E3 Host 停机有界且日志完好：SIGTERM 干净退出（30s 界），停机后日志 strict 一致', async () => {
    const persistRoot = makeTmpDir('sa6-155-e3-persist-');
    const logRoot = makeTmpDir('sa6-155-e3-log-');
    const port = await freePort();
    const config = hubConfig({
      rootDir: persistRoot,
      logRootDir: logRoot,
      port,
      provision: [{ id: 'p1', ownerUserId: 'alice', schema: VFSL_SCHEMA, root: { count: 0 } }],
    });
    expectDiagnosticsAccepted(config);

    const hub = spawnApp(['--config', writeConfig(makeTmpDir('sa6-155-e3-cfg-'), config)]);
    const provisioned = await waitForEvent(hub, (e) => e.event === 'provisioned', 60_000, 'hub provisioned');
    const namespaceId = provisioned.namespaceId as string;
    await waitForEvent(hub, (e) => e.event === 'ready', 60_000, 'hub ready');
    await signalAndExpectExit(hub, 'SIGTERM', 30_000, 0, 'hub E3（有界停机：Registry/Persistence 不被日志无限延迟）');

    const streamId = currentStreamId(logRoot, namespaceId);
    expect(streamId).not.toBeNull();
    const read = readStreamStrict({ rootDir: logRoot, namespaceId, streamId: streamId as string });
    expect(read.status).toBe('ok');
  }, 300_000);

  it('E4 日志故障隔离：diagnostics.rootDir 指向普通文件（stream init 失败）→ 业务不受影响（provision/read 照常）', async () => {
    const persistRoot = makeTmpDir('sa6-155-e4-persist-');
    const logRoot = makeTmpDir('sa6-155-e4-log-');
    const blockerFile = join(logRoot, 'blocker');
    writeFileSync(blockerFile, 'not-a-directory');
    const port = await freePort();
    const config = hubConfig({
      rootDir: persistRoot,
      logRootDir: blockerFile,
      port,
      provision: [{ id: 'p1', ownerUserId: 'alice', schema: VFSL_SCHEMA, root: { count: 0 } }],
    });
    expectDiagnosticsAccepted(config);

    const hub = spawnApp(['--config', writeConfig(makeTmpDir('sa6-155-e4-cfg-'), config)]);
    const provisioned = await waitForEvent(
      hub,
      (e) => e.event === 'provisioned',
      60_000,
      'hub provisioned（日志初始化失败不影响 create）',
    );
    const namespaceId = provisioned.namespaceId as string;
    await waitForEvent(hub, (e) => e.event === 'ready', 60_000, 'hub ready');
    const readCount = await sendOp(hub, { op: 'read', namespaceId, path: ['count'] }, 30_000);
    expect(readCount.ok).toBe(true);
    expect(readCount.value).toBe(0);
    await signalAndExpectExit(hub, 'SIGTERM', 30_000, 0, 'hub E4');
  }, 300_000);

  it(
    'E5 hub 重启（多 Runtime generation）延续同一 stream；peer 不启用（Hub/Peer 独立本地旁路）且复制数据面无策略',
    async () => {
      const persistRoot = makeTmpDir('sa6-155-e5-persist-');
      const logRoot = makeTmpDir('sa6-155-e5-log-');
      const port = await freePort();

      // ── hub v1：file 持久化 + diagnostics + provision；本地写一次 ROOT ──
      const v1Config = hubConfig({
        rootDir: persistRoot,
        logRootDir: logRoot,
        port,
        provision: [{ id: 'p1', ownerUserId: 'alice', schema: VFSL_SCHEMA, root: { count: 0 } }],
      });
      expectDiagnosticsAccepted(v1Config);
      const hubV1 = spawnApp(['--config', writeConfig(makeTmpDir('sa6-155-e5-cfg-v1-'), v1Config)]);
      const provisioned = await waitForEvent(hubV1, (e) => e.event === 'provisioned', 60_000, 'hub v1 provisioned');
      const namespaceId = provisioned.namespaceId as string;
      expect(namespaceId).toMatch(/^ns-[0-9a-f]{32}$/);
      await waitForEvent(hubV1, (e) => e.event === 'ready', 60_000, 'hub v1 ready');
      const writeV1 = await sendOp(
        hubV1,
        { op: 'verify-write', namespaceId, set: ['count'], path: ['count'], value: 7, timeoutMs: 30_000 },
        60_000,
      );
      expect(writeV1.ok).toBe(true);
      const streamV1 = currentStreamId(logRoot, namespaceId);
      expect(streamV1).not.toBeNull();
      await signalAndExpectExit(hubV1, 'SIGTERM', 30_000, 0, 'hub v1');

      // ── hub v2：同 rootDir + 同 logRoot，无 provision（直引 authorization）→ 新 Registry/Runtime generation ──
      const v2Config = hubConfig({
        rootDir: persistRoot,
        logRootDir: logRoot,
        port,
        authorization: [
          { peerInstanceId: 'peer-1', namespaceId, ownerUserId: 'alice', read: true, submit: true },
        ],
      });
      expectDiagnosticsAccepted(v2Config);
      const hubV2 = spawnApp(['--config', writeConfig(makeTmpDir('sa6-155-e5-cfg-v2-'), v2Config)]);
      await waitForEvent(hubV2, (e) => e.event === 'ready', 60_000, 'hub v2 ready');

      // ── peer：配置态静态 targets；**不携带 diagnostics**（Hub/Peer 独立本地启用）──
      const peerProc = spawnApp([
        '--config',
        writeConfig(makeTmpDir('sa6-155-e5-cfg-peer-'), peerConfig(port, namespaceId)),
      ]);
      await waitForEvent(peerProc, (e) => e.event === 'ready', 60_000, 'peer ready');

      // ── v1 时代后（v2 新 generation）：peer 本地写 → hub v2 应用并续写同一 stream ──
      const writeV2 = await sendOp(
        peerProc,
        { op: 'verify-write', namespaceId, set: ['count'], path: ['count'], value: 11, timeoutMs: 30_000 },
        60_000,
      );
      expect(writeV2.ok).toBe(true);
      const readV2 = await sendOp(hubV2, { op: 'read', namespaceId, path: ['count'] }, 30_000);
      expect(readV2.ok).toBe(true);
      expect(readV2.value).toBe(11);

      // ── 同一 stream 跨 Runtime generation：streamId 不变、仅 1 个 stream、sequence 连续、genesis 仍在 ──
      const streamV2 = currentStreamId(logRoot, namespaceId);
      expect(streamV2).toBe(streamV1);
      expect(listStreamDirs(logRoot, namespaceId)).toHaveLength(1);
      const records = allStrictRecords(logRoot, namespaceId, streamV2 as string);
      expect(records[0]?.recordKind).toBe('genesis-baseline');
      const ops = attemptOps(records);
      expect(ops).toContain('root-mutation');
      const read = readStreamStrict({ rootDir: logRoot, namespaceId, streamId: streamV2 as string });
      expect(read.status).toBe('ok');
      expect(read.issues).toEqual([]);
      expect(read.records.map((r) => r.sequence)).toEqual(read.records.map((_, i) => String(i + 1)));

      // ── peer 数据面无策略（复制 wire/数据面不含日志配置）──
      const peerRead = await sendOp(peerProc, { op: 'read', namespaceId, path: ['count'] }, 30_000);
      expect(peerRead.ok).toBe(true);
      expect(peerRead.value).toBe(11);

      await signalAndExpectExit(peerProc, 'SIGTERM', 30_000, 0, 'peer E5');
      await signalAndExpectExit(hubV2, 'SIGTERM', 30_000, 0, 'hub v2 E5');
    },
    300_000,
  );
});
