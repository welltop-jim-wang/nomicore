/**
 * [SA6 owned] Phase 5 close — black-box one-Hub/two-Peer acceptance anchors
 * (issue #140 切片 10：Memory/File Persistence 共享复制验收套件)。
 *
 * 契约来源（权威）：
 * - `wiki/raw/task_issue-140-phase-5-websocket-replication.md`（八条 AC）与本仓库
 *   `docs/phases/phase-5-websocket-replication.md`「必须通过的场景」1-14/15b；
 * - `docs/adr/0010-hub-peer-websocket-ydoc-replication.md`（#134/#133 round-2
 *   修订节）：epoch fencing（IDENTITY_CHANGED → conflicted，bump 后旧 peer 必须显式
 *   reset/bootstrap）、guarded reset（`resetReplica(expectedLocalIdentity)` 严格前置
 *   核对：身份不匹配 → `NAMESPACE_RESET_IDENTITY_MISMATCH`、零破坏性动作）、
 *   SCHEMA 只允许 hub 本地修改并单向传播；
 * - `docs/integration/hub-peer-deployment.md`（stdin 动词表：本文件按验收契约提出
 *   三个管理动词的**扩展接口**，实现前未知 verb 回执 `unknown-op`——这正是红色锚）。
 *
 * 本文件 = 三实例（一个 hub + 两个 peer）黑盒验收锚，每个测试独立 spawn 真实进程、
 * 真实 WebSocket、真实 Memory/File Persistence（FilePersistence 一律独立 rootDir）。
 *
 * 红/绿分布（HEAD 469ca36 实测基线，2026-08-30）：
 * - 红灯（验收缺口，SA3 实现目标）：
 *   ① `replace-schema`（hub）：hub 合法 SCHEMA 替换单向传播到双 peer → 当前 `unknown-op`；
 *   ② `bump-epoch`（hub）→ 双 peer channel 立即 `identity-conflicted` → 当前 `unknown-op`；
 *   ③ `reset-replica`（peer）：错误 expected identity → `NAMESPACE_RESET_IDENTITY_MISMATCH`
 *      零破坏 → 正确 identity → archive + re-bootstrap + 重新收敛 → 当前 `unknown-op`；
 * - 绿灯（已交付验收证据，Phase 5 三实例收敛/崩溃恢复回归锁）：
 *   ④ AC1（Memory）：hub+p1+p2 并发 ROOT 写 → 三处 Y.Doc 收敛；
 *   ⑤ AC1（File）：同场景 FilePersistence 独立 root 收敛；
 *   ⑥ AC6（File）：peer 进程崩溃（SIGKILL 真实 app pid）→ hub 期间写入 →
 *      同 rootDir 重启 → 收敛（crash recovery）。
 *
 * 锚定纪律：零源码 grep / 零字符串形状断言；全部失败证据 = 真实进程 stdout NDJSON
 * 回执（`unknown-op` / `ok:false` / 事件序）或收敛超时。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const TSX_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
const MAIN_TS = join(REPO_ROOT, 'apps', 'yjs-server', 'src', 'main.ts');

const SCHEMA_V1 = {
  lang: 'vfsl',
  version: 1,
  id: 'notes-v1',
  text: 'type ROOT = { count: number; tags: string; };\n',
};
const SCHEMA_V2 = {
  lang: 'vfsl',
  version: 1,
  id: 'notes-v2',
  // note 为可选字段（?:）：schema 演进场景下 keep-root 替换合法（旧 root 缺 note
  // 仍通过新 schema 校验——必填新增字段会触发引擎 keep-root 校验拒绝 → write-failed，
  // 见 docs/integration/hub-peer-deployment.md「replace-schema 行」）。
  text: 'type ROOT = { count: number; tags: string; note?: string; };\n',
};

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
  signalCode: NodeJS.Signals | undefined;
}

const liveProcs: Proc[] = [];

function spawnApp(args: string[]): Proc {
  const child = spawn(TSX_BIN, [MAIN_TS, ...args], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
    detached: true, // 进程组 leader：afterEach 负 pid SIGKILL 连真实 app 子进程一并清除
  });
  const proc: Proc = { child, events: [], stderr: [], exitCode: null, signalCode: undefined };
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
  child.on('exit', (code, signal) => {
    proc.exitCode = code;
    proc.signalCode = signal ?? undefined; // @types/node: Signals | null → 字段 Signals | undefined
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
    if (proc.exitCode !== null || proc.signalCode !== undefined) {
      throw new Error(
        `process exited ${proc.exitCode ?? proc.signalCode} before ${what}\nstderr:${proc.stderr.join('')}`,
      );
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timeout ${timeoutMs}ms waiting for ${what}\nstderr:${proc.stderr.join('')}`);
    }
    await sleep(50);
  }
}

async function waitForExit(proc: Proc, timeoutMs: number, what: string): Promise<number | null> {
  const start = Date.now();
  while (proc.exitCode === null && proc.signalCode === undefined) {
    if (Date.now() - start > timeoutMs) {
      proc.child.kill('SIGKILL');
      throw new Error(`timeout ${timeoutMs}ms waiting for ${what} to exit`);
    }
    await sleep(50);
  }
  return proc.exitCode;
}

let opCounter = 0;
async function sendOp(
  proc: Proc,
  op: Record<string, unknown>,
  timeoutMs = 60_000,
): Promise<Record<string, unknown>> {
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
    if (proc.exitCode !== null || proc.signalCode !== undefined) {
      throw new Error(
        `process exited awaiting reply to ${serialized}\nstderr:${proc.stderr.join('')}`,
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
  const dir = mkdtempSync(join(tmpdir(), 'sa6-p5-accept-'));
  tmpDirs.push(dir);
  return dir;
}

/** 经 rootDir 内 `.nomicore-lock.json` 取真实 app 进程 pid 并 SIGKILL（硬崩溃、零 GOAWAY）。 */
function hardCrashByLock(rootDir: string): void {
  const info = JSON.parse(readFileSync(join(rootDir, '.nomicore-lock.json'), 'utf8')) as {
    pid: number;
  };
  process.kill(info.pid, 'SIGKILL');
}

interface Topology {
  hub: Proc;
  p1: Proc;
  p2: Proc;
  hubRoot: string;
  peer1Root: string;
  peer2Root: string;
  port: number;
  nsId: string;
  replicationId: string;
}

function hubConfig(
  hubRoot: string,
  port: number,
  opts: {
    kind: 'memory' | 'file';
    schema: unknown;
    root: unknown;
    authorization?: ReadonlyArray<Record<string, unknown>>;
  },
): Record<string, unknown> {
  return {
    role: 'hub',
    instanceId: 'hub-1',
    persistence:
      opts.kind === 'file' ? { kind: 'file', rootDir: hubRoot } : { kind: 'memory' },
    hub: {
      listen: { host: '127.0.0.1', port },
      tokens: { 'peer-1': 'token-1', 'peer-2': 'token-2' },
      provision: [{ id: 'p1', ownerUserId: 'alice', schema: opts.schema, root: opts.root }],
      authorization:
        opts.authorization ??
        [
          { peerInstanceId: 'peer-1', provisionId: 'p1', read: true, submit: true },
          { peerInstanceId: 'peer-2', provisionId: 'p1', read: true, submit: true },
        ],
    },
  };
}

function peerConfig(kind: 'memory' | 'file', rootDir: string, port: number, nsId: string, token: string): Record<string, unknown> {
  return {
    role: 'peer',
    instanceId: token === 'token-2' ? 'peer-2' : 'peer-1',
    persistence:
      kind === 'file' ? { kind: 'file', rootDir } : { kind: 'memory' },
    peer: {
      hub: { url: `ws://127.0.0.1:${port}/replication`, hubInstanceId: 'hub-1', token },
      targets: [{ namespaceId: nsId, ownerUserId: 'alice' }],
    },
  };
}

/** 启动 hub + 双 peer（独立 rootDir / 独立 config 目录），返回拓扑。 */
async function bootTopology(kind: 'memory' | 'file'): Promise<Topology> {
  const hubRoot = makeTmpDir();
  const peer1Root = makeTmpDir();
  const peer2Root = makeTmpDir();
  const port = await freePort();
  const hub = spawnApp([
    '--config',
    writeConfig(makeTmpDir(), hubConfig(hubRoot, port, { kind, schema: SCHEMA_V1, root: { count: 0, tags: '' } })),
  ]);
  const provisioned = await waitForEvent(hub, (e) => e.event === 'provisioned', 60_000, 'hub provisioned');
  const nsId = provisioned.namespaceId as string;
  expect(nsId).toMatch(/^ns-[0-9a-f]{32}$/);
  const replicationId = provisioned.replicationId as string;
  expect(replicationId).toMatch(/^[0-9a-f]{32}$/);
  await waitForEvent(hub, (e) => e.event === 'ready', 60_000, 'hub ready');
  const p1 = spawnApp(['--config', writeConfig(makeTmpDir(), peerConfig(kind, peer1Root, port, nsId, 'token-1'))]);
  await waitForEvent(p1, (e) => e.event === 'ready', 60_000, 'peer-1 ready');
  const p2 = spawnApp(['--config', writeConfig(makeTmpDir(), peerConfig(kind, peer2Root, port, nsId, 'token-2'))]);
  await waitForEvent(p2, (e) => e.event === 'ready', 60_000, 'peer-2 ready');
  return { hub, p1, p2, hubRoot, peer1Root, peer2Root, port, nsId, replicationId };
}

/** 轮询三处同 path 读数直至一致（有界收敛等待）。 */
async function waitConverged(
  t: Topology,
  path: readonly string[],
  timeoutMs: number,
  what: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last: Array<unknown> = [];
  for (;;) {
    const [h, a, b] = await Promise.all([
      sendOp(t.hub, { op: 'read', namespaceId: t.nsId, path }, 20_000),
      sendOp(t.p1, { op: 'read', namespaceId: t.nsId, path }, 20_000),
      sendOp(t.p2, { op: 'read', namespaceId: t.nsId, path }, 20_000),
    ]);
    last = [h.value, a.value, b.value];
    if (
      h.ok === true &&
      a.ok === true &&
      b.ok === true &&
      last[0] === last[1] &&
      last[1] === last[2]
    ) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`convergence timeout (${timeoutMs}ms) waiting ${what}: ${JSON.stringify(last)}`);
    }
    await sleep(200);
  }
}

afterEach(() => {
  for (const proc of liveProcs) {
    // tsx wrapper 与真实 app 进程为父子关系：负 pid 杀整个进程组（真子进程 + wrapper）。
    if (proc.child.pid !== undefined) {
      try {
        process.kill(-proc.child.pid, 'SIGKILL');
      } catch {
        // 已退出或非组首：忽略
      }
    }
    if (proc.exitCode === null && proc.signalCode === undefined) {
      proc.child.kill('SIGKILL');
    }
  }
  liveProcs.length = 0;
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ═══════════════════════════ 绿灯：已交付验收证据（回归锁） ═══════════════════════════

describe('Phase-5 close AC1/AC6 已交付验收（三实例收敛 / crash recovery 回归锁）', () => {
  const adapterCases: ReadonlyArray<readonly ['memory' | 'file', string]> = [
    ['memory', 'MemoryPersistence'],
    ['file', 'FilePersistence'],
  ] as const;

  for (const [kind, label] of adapterCases) {
    it(
      `AC1（${label}）：hub+p1+p2 并发 ROOT 写 → 三处收敛（独立 rootDir）`,
      async () => {
        const t = await bootTopology(kind);
        // 三处并发写：hub→tags、p1→count=7、p2→count=9（互异路径，最终收敛到并集）
        const [a, b, c] = await Promise.all([
          sendOp(t.hub, { op: 'verify-write', namespaceId: t.nsId, set: ['tags'], path: ['tags'], value: 'hub', timeoutMs: 30_000 }, 60_000),
          sendOp(t.p1, { op: 'verify-write', namespaceId: t.nsId, set: ['count'], path: ['count'], value: 7, timeoutMs: 30_000 }, 60_000),
          sendOp(t.p2, { op: 'verify-write', namespaceId: t.nsId, set: ['count'], path: ['count'], value: 9, timeoutMs: 30_000 }, 60_000),
        ]);
        expect(a.ok).toBe(true);
        expect(b.ok).toBe(true);
        expect(c.ok).toBe(true);
        await waitConverged(t, ['count'], 30_000, `AC1 count (${label})`);
        await waitConverged(t, ['tags'], 30_000, `AC1 tags (${label})`);
      },
      240_000,
    );
  }

  it(
    'AC6（FilePersistence）：peer-2 崩溃（SIGKILL 真实 app pid）→ hub 期间写入 → 同 rootDir 重启 → 收敛',
    async () => {
      const t = await bootTopology('file');
      await sendOp(t.hub, { op: 'verify-write', namespaceId: t.nsId, set: ['tags'], path: ['tags'], value: 'hub', timeoutMs: 30_000 }, 60_000);
      await waitConverged(t, ['tags'], 30_000, 'AC6 基线 tags');
      // 硬崩溃 peer-2（锁文件 pid = 真实 app 进程；tsx wrapper 非目标）
      hardCrashByLock(t.peer2Root);
      await waitForExit(t.p2, 15_000, 'peer-2 crash');
      // hub 在 p2 停机期间写入
      await sendOp(t.hub, { op: 'verify-write', namespaceId: t.nsId, set: ['count'], path: ['count'], value: 100, timeoutMs: 30_000 }, 60_000);
      await sleep(2_000);
      // 同 rootDir 重启 peer-2（独立 root 锁可重取）
      const p2b = spawnApp(['--config', writeConfig(makeTmpDir(), peerConfig('file', t.peer2Root, t.port, t.nsId, 'token-2'))]);
      await waitForEvent(p2b, (e) => e.event === 'ready', 60_000, 'peer-2 restart ready');
      await waitConverged(
        { ...t, p2: p2b },
        ['count'],
        60_000,
        'AC6 count after peer-2 crash+restart',
      );
    },
    300_000,
  );
});

// ═══════════════════════════ 红灯：Phase-5 收口验收缺口（管理动词面） ═══════════════════════════

describe('Phase-5 close AC3 红灯锚（hub SCHEMA 传播 / epoch fencing / guarded reset 管理面）', () => {
  it(
    'AC3-①: hub 合法 SCHEMA 替换单向传播到双 peer（replace-schema 动词）',
    async () => {
      const t = await bootTopology('memory');
      await sendOp(t.hub, { op: 'verify-write', namespaceId: t.nsId, set: ['tags'], path: ['tags'], value: 'hub', timeoutMs: 30_000 }, 60_000);
      await waitConverged(t, ['tags'], 30_000, 'schema 基线');
      // 契约：hub 侧 replace-schema（SCHEMA 只允许 hub 本地修改，ADR 0010）
      const replaced = await sendOp(t.hub, { op: 'replace-schema', namespaceId: t.nsId, schema: SCHEMA_V2 }, 30_000);
      expect(replaced.ok).toBe(true);
      // 传播验证：hub 写新字段 note → 双 peer 读到相同 note
      const w = await sendOp(t.hub, { op: 'verify-write', namespaceId: t.nsId, set: ['note'], path: ['note'], value: 'propagated', timeoutMs: 30_000 }, 60_000);
      expect(w.ok).toBe(true);
      await waitConverged(t, ['note'], 30_000, 'AC3 schema 传播 note');
    },
    240_000,
  );

  it(
    'AC3-②: hub bump-epoch → 双 peer channel 立即 identity-conflicted（epoch fencing）',
    async () => {
      const t = await bootTopology('memory');
      await sendOp(t.hub, { op: 'verify-write', namespaceId: t.nsId, set: ['tags'], path: ['tags'], value: 'hub', timeoutMs: 30_000 }, 60_000);
      await waitConverged(t, ['tags'], 30_000, 'fence 基线');
      const bumped = await sendOp(t.hub, { op: 'bump-epoch', namespaceId: t.nsId }, 30_000);
      expect(bumped.ok).toBe(true);
      // 契约：IDENTITY_CHANGED → 双 peer conflicted（observer 事件 identity-conflicted）
      await waitForEvent(
        t.p1,
        (e) => e.event === 'identity-conflicted' || e.type === 'identity-conflicted',
        30_000,
        'peer-1 identity-conflicted',
      );
      await waitForEvent(
        t.p2,
        (e) => e.event === 'identity-conflicted' || e.type === 'identity-conflicted',
        30_000,
        'peer-2 identity-conflicted',
      );
      // fenced 之后：hub 新写不得在未 reset 的 peer 上收敛（有界窗口断言不收敛）
      await sendOp(t.hub, { op: 'verify-write', namespaceId: t.nsId, set: ['count'], path: ['count'], value: 5, timeoutMs: 30_000 }, 60_000);
      await sleep(5_000);
      const a = await sendOp(t.p1, { op: 'read', namespaceId: t.nsId, path: ['count'] }, 20_000);
      expect(a.value).not.toBe(5);
    },
    240_000,
  );

  it(
    'AC3-③: 受控 reset-replica —— 错误 expected identity 稳定拒绝零破坏；正确 identity 归档重引导后收敛',
    async () => {
      const t = await bootTopology('memory');
      await sendOp(t.hub, { op: 'verify-write', namespaceId: t.nsId, set: ['tags'], path: ['tags'], value: 'hub', timeoutMs: 30_000 }, 60_000);
      await waitConverged(t, ['tags'], 30_000, 'reset 基线');
      // 契约（ADR 0010 #133 round-2）：身份不匹配 → NAMESPACE_RESET_IDENTITY_MISMATCH，零破坏
      const wrong = await sendOp(t.p1, { op: 'reset-replica', namespaceId: t.nsId, ownerUserId: 'alice', expectedReplicationId: '0'.repeat(32), expectedReplicationEpoch: 999 }, 30_000);
      expect(wrong.ok).toBe(false);
      expect(wrong.code).toBe('NAMESPACE_RESET_IDENTITY_MISMATCH');
      // 零破坏：本地读仍服务原值
      const still = await sendOp(t.p1, { op: 'read', namespaceId: t.nsId, path: ['tags'] }, 20_000);
      expect(still.ok).toBe(true);
      expect(still.value).toBe('hub');
      // 正确 identity（provision 时复制身份）→ 归档 + 重引导 + 收敛
      const reset = await sendOp(t.p1, {
        op: 'reset-replica',
        namespaceId: t.nsId,
        ownerUserId: 'alice',
        expectedReplicationId: t.replicationId,
        expectedReplicationEpoch: 1,
      }, 30_000);
      expect(reset.ok).toBe(true);
      await waitConverged(t, ['tags'], 60_000, 'reset 后重新收敛');
    },
    300_000,
  );
});
