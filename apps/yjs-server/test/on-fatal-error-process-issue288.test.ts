/**
 * issue #288 / ADR 0018 §4–§5 —— `onFatalError` 的真实进程黑盒验收（spawn main.ts）。
 *
 * 钉住的裁决（真实进程、真实退出码、真实文件持久化）：
 * - **exit 缺省（AC2 进程面）**：peer 缺省配置（`onFatalError` 键缺席）下 re-arm
 *   fatal ⇒ stdout NDJSON 序 `schema-rearm-failed` → `fatal-shutdown` →
 *   `replication-drained` → `registry-stopped` → `persistence-disposed` →
 *   `app-stopped` ⇒ **真实退出码 1**；hub 进程不被株连（控制面照常应答）；
 * - **重启降级不死循环（AC5）**：同一 file persistence rootDir 重启 peer ⇒ P0 编译
 *   同一（wire 损坏的）SCHEMA 落入**结果失败**（ADR 0018 §5 P0 不对称）——进程停在
 *   「写禁用、读可用、channel live、复制照常」的降级态：零第二发
 *   `schema-rearm-failed`、进程不退出（无 crashloop）、`read` 可用、
 *   `verify-write` 诚实 `write-failed`；SIGTERM 干净 exit 0。
 *
 * 场景本体：hub 提交前编译成功的 v2 SCHEMA 文本在 wire 上被 `CorruptOnceProxy`
 * 同长损坏（ADR 0018 §3「字节损坏」形态；真实 hub 结构性无法提交非法 SCHEMA）。
 *
 * 黑盒纪律：真实 spawn hub + peer（main.ts；peer file persistence 跨重启）；stdin
 * NDJSON 驱动；断言只消费 stdout 事件、真实退出码与回执；零源码 grep。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { CorruptOnceProxy } from './harness.js';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const TSX_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
const MAIN_TS = join(REPO_ROOT, 'apps', 'yjs-server', 'src', 'main.ts');

const SPAWN_NODE_OPTIONS = (() => {
  const existing = process.env.NODE_OPTIONS ?? '';
  return existing.includes('conditions=nomicore-source')
    ? existing
    : `${existing} --conditions=nomicore-source`.trim();
})();

const V1_TEXT = 'type ROOT = { count: number; };\n';
const V2_TEXT = 'type ROOT = { count: number; note: string; };\n';
/** wire 同长损坏点（未知类型名 → peer 编译结果失败 → NSRT-FATAL-SCHEMA-REARM-INVALID）。 */
const MARKER = Buffer.from('note: string', 'utf8');
const REPLACEMENT = Buffer.from('note: strinG', 'utf8');
const REARM_INVALID = 'NSRT-FATAL-SCHEMA-REARM-INVALID';

const SCHEMA_V1 = Object.freeze({ lang: 'vfsl', version: 1, id: 'notes-v1', text: V1_TEXT });
const SCHEMA_V2 = Object.freeze({ lang: 'vfsl', version: 1, id: 'notes-v1', text: V2_TEXT });

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
const liveProxies: CorruptOnceProxy[] = [];
const tmpDirs: string[] = [];

function makeTmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function writeConfig(dir: string, name: string, config: Record<string, unknown>): string {
  const path = join(dir, name);
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
      throw new Error(`timeout ${timeoutMs}ms waiting for ${what} to exit\nstderr:\n${proc.stderr.join('')}`);
    }
    await sleep(50);
  }
  return proc.exitCode;
}

let opCounter = 0;
async function sendOp(proc: Proc, op: Record<string, unknown>, timeoutMs = 60_000): Promise<Record<string, unknown>> {
  const id = `issue288-${++opCounter}`;
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

afterEach(async () => {
  for (const proc of liveProcs) {
    if (proc.exitCode === null) {
      proc.child.kill('SIGKILL');
    }
  }
  liveProcs.length = 0;
  for (const proxy of liveProxies.splice(0)) {
    await proxy.close();
  }
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function hubConfig(port: number): Record<string, unknown> {
  return {
    role: 'hub',
    instanceId: 'hub-1',
    persistence: { kind: 'memory' },
    hub: {
      listen: { host: '127.0.0.1', port },
      tokens: { 'peer-1': 'token-1' },
      provision: [{ id: 'p1', ownerUserId: 'alice', schema: SCHEMA_V1, root: { count: 0 } }],
      authorization: [{ peerInstanceId: 'peer-1', provisionId: 'p1', read: true, submit: true }],
    },
  };
}

/** peer 配置：file persistence（损坏的副本须跨重启存活）；`onFatalError` 键缺席 = 缺省。 */
function peerConfig(rootDir: string, proxyPort: number, namespaceId: string): Record<string, unknown> {
  return {
    role: 'peer',
    instanceId: 'peer-1',
    persistence: { kind: 'file', rootDir },
    peer: {
      hub: {
        url: `ws://127.0.0.1:${proxyPort}/replication`,
        hubInstanceId: 'hub-1',
        token: 'token-1',
      },
      targets: [{ namespaceId, ownerUserId: 'alice' }],
    },
  };
}

function eventIndexes(proc: Proc, names: readonly string[]): number[] {
  return names.map((name) => proc.events.findIndex((e) => e.event === name));
}

describe('issue #288 AC2+AC5 真实进程：fatal 默认 log 后有序终止（exit 1）；重启停降级态不 crashloop', () => {
  it('re-arm fatal → NDJSON 先于停机 → 真实 exit 1；同 rootDir 重启 → 降级 live（写禁用/读可用/复制照常），零二次 fatal、进程存活；SIGTERM exit 0', async () => {
    const dir = makeTmpDir('issue288-');
    const peerRoot = join(dir, 'peer-data');
    const hubPort = await freePort();

    // ── ① hub 上线（provision 一个 namespace）──
    const hub = spawnApp(['--config', writeConfig(dir, 'hub.json', hubConfig(hubPort))]);
    const provisioned = await waitForEvent(hub, (e) => e.event === 'provisioned', 30_000, 'hub provisioned');
    const namespaceId = provisioned.namespaceId;
    if (typeof namespaceId !== 'string') throw new Error('provisioned 缺 namespaceId');

    // ── ② 损坏代理 + peer（缺省 onFatalError = 'exit'；file persistence）──
    const proxy = new CorruptOnceProxy(hubPort, MARKER, REPLACEMENT);
    liveProxies.push(proxy);
    const proxyPort = await proxy.listen();
    const peerConfigPath = writeConfig(dir, 'peer.json', peerConfig(peerRoot, proxyPort, namespaceId));
    const peer1 = spawnApp(['--config', peerConfigPath]);
    await waitForEvent(peer1, (e) => e.event === 'ready', 30_000, 'peer1 ready');
    await waitForEvent(
      peer1,
      (e) => e.event === 'channel-state-changed' && e.namespaceId === namespaceId && e.to === 'live',
      30_000,
      'peer1 channel live',
    );

    // ── ③ hub replace-schema（v2 合法文本）→ wire 损坏 → peer re-arm fatal ──
    const replaced = await sendOp(hub, { op: 'replace-schema', namespaceId, schema: SCHEMA_V2, root: { count: 0, note: 'v2' } });
    expect(replaced.ok, `replace-schema 回执：${JSON.stringify(replaced)}`).toBe(true);

    const failed = await waitForEvent(peer1, (e) => e.event === 'schema-rearm-failed', 30_000, 'peer1 schema-rearm-failed');
    expect(failed.namespaceId).toBe(namespaceId);
    expect(failed.code).toBe(REARM_INVALID);
    expect(failed.side).toBe('peer');

    // ── ④ NDJSON 严格序：直通记录 → fatal-shutdown 标记 → 有序停机四事件 → 真实 exit 1 ──
    const code1 = await waitForExit(peer1, 60_000, 'peer1 fatal exit');
    expect(proxy.patched, 'proxy 必须执行了字节损坏').toBe(true);
    expect(code1, 'fatal 默认策略的真实退出码').toBe(1);
    const order = eventIndexes(peer1, [
      'schema-rearm-failed',
      'fatal-shutdown',
      'replication-drained',
      'registry-stopped',
      'persistence-disposed',
      'app-stopped',
    ]);
    expect(order.every((i) => i >= 0), `全部事件在场：${JSON.stringify(order)}`).toBe(true);
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i]!, `NDJSON 严格递增序：${JSON.stringify(order)}`).toBeGreaterThan(order[i - 1]!);
    }
    const marker = peer1.events.find((e) => e.event === 'fatal-shutdown');
    expect(marker).toEqual({ event: 'fatal-shutdown', trigger: 'schema-rearm-failed', namespaceId });

    // ── ⑤ hub 不被株连 ──
    expect(hub.exitCode, 'hub 进程不被株连').toBe(null);
    expect(hub.events.some((e) => e.event === 'fatal-shutdown')).toBe(false);
    const hubStatus = await sendOp(hub, { op: 'status' });
    expect(hubStatus.ok).toBe(true);

    // ── ⑥ 同 rootDir 重启（编排层视角；stale 锁由原子回收接管）──
    const peer2 = spawnApp(['--config', peerConfigPath]);
    await waitForEvent(peer2, (e) => e.event === 'ready', 30_000, 'peer2 ready');
    await waitForEvent(
      peer2,
      (e) => e.event === 'channel-state-changed' && e.namespaceId === namespaceId && e.to === 'live',
      30_000,
      'peer2 channel live（P0 结果失败不影响 session open/复制）',
    );

    // 降级态证据：写禁用、读可用；零第二发 fatal 事件
    const read = await sendOp(peer2, { op: 'read', namespaceId, path: ['count'] });
    expect(read, '降级态读可用').toMatchObject({ ok: true, value: 0 });
    const write = await sendOp(peer2, { op: 'verify-write', namespaceId, set: ['count'], value: 1, timeoutMs: 5_000 });
    expect(write, '降级态写诚实失败').toMatchObject({ ok: false, code: 'write-failed' });
    expect(
      peer2.events.filter((e) => e.event === 'schema-rearm-failed'),
      '重启后零 re-arm fatal 事件（P0 不对称：结果失败 ≠ fatal）',
    ).toEqual([]);

    // 不 crashloop：live 达成后给静音窗口，进程必须仍然存活
    await sleep(2_000);
    expect(peer2.exitCode, '重启后进程停在降级态、不退出死循环').toBe(null);

    // ── ⑦ 干净停机 ──
    peer2.child.kill('SIGTERM');
    expect(await waitForExit(peer2, 60_000, 'peer2 SIGTERM')).toBe(0);
    hub.child.kill('SIGTERM');
    expect(await waitForExit(hub, 60_000, 'hub SIGTERM')).toBe(0);
  }, 180_000);
});
