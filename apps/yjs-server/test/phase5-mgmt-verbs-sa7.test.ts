/**
 * [SA7 owned] Phase 5 管理动词补充性动态验证（issue #140，SA4 R2 动态审核重点 1/2/3/4/6）。
 *
 * 覆盖 SA4 静态审核移交的动态审核清单（锚测试之外的增量面）：
 * - 重点 3：`bump-epoch` 回执 `replicationEpoch` 数值正确性（锚只断言 ok）——
 *   受控 reset 的 expected 身份门交叉验证：回执值 E=2 时，fenced peer 以本地旧身份
 *   {rid,1} reset → ok（本地确为 1）；rejoin 后以 {rid,1} 再 reset → MISMATCH
 *   （本地已采纳 2 = 回执值）——回执值 ⟺ 权威代际 ⟺ rejoin 后本地身份，三方同一；
 * - 重点 6：fence 检出延迟实测（bump 回执 → 双 peer `identity-conflicted` 事件时延，
 *   记录实测值；上界契约 `ackTimeoutMs` 缺省 10s，断言取 30s = SA4 指定 CI 慢机 3 倍余量）；
 * - 重点 2：`replace-schema` 额外键信封（合法四键 + `extra`）→ `write-failed` 响亮拒绝
 *   且 SCHEMA 未变（旧 schema 写行为不变——封闭对象不接受未声明键；读数不变），
 *   随后干净重提同 schema（四键）成功（零破坏佐证）；
 * - 重点 1（增量）：传播链端到端——干净重提后 hub 写新字段 → 双 peer 收敛
 *   （peer 侧写新字段受引擎「活动 schema 仅在（重）物化时切换」语义约束，
 *   见 SA7 报告 O-F2，不在本文件断言）；
 * - 重点 4：FilePersistence 上 `reset-replica` 全周期——归档落盘
 *   （`{rootDir}/archive/users/<owner>/<nsId>.snapshot`）+ 进程内重引导收敛 +
 *   硬崩溃后同 rootDir 重启恢复收敛（重启时本地副本在档 → reconcile 路径；
 *   归档即刻的 bootstrap 资格由进程内重引导证明）。
 *
 * 🔴 红锚（SA7 R1 发现 F1，见 wiki/raw/task_issue-140-phase-5-websocket-replication_sa7_report.md）：
 *   两轮 bump→fence→reset 运维循环中，**第二次成功 reset-replica 后重引导不发生**
 *   （channel closing→closed 后无整连接重建），peer 该 ns 永久 `read-failed`，
 *   且文档化恢复入口 `add-target` 被 G5c 恢复的 peerOwners 幂等集短路为伪 ok 零动作。
 *   违反部署文档冻结编排 ③「addTarget → §14.1 整连接重建 → 重 OPEN → bootstrap」
 *   与「恢复入口 = add-target」承诺。SA3 修复（f310f18：G5b settle-wait + 状态感知
 *   add-target 幂等）后本文件应全绿（SA7 R2 于 2026-08-30 复验）。
 *
 * 黑盒纪律与锚测试一致：真实 spawn / 真实 WebSocket / 真实 Persistence（File 独立
 * rootDir）；断言只消费子进程 stdout NDJSON 与运行期磁盘产物（archive 快照、lock 文件），
 * 零源码 grep。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
const SCHEMA_V2OPT = {
  lang: 'vfsl',
  version: 1,
  id: 'notes-v2',
  // note 为可选字段（?:）：keep-root 合法演进（与锚测试 AC3-① 同款 fixture）
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
    proc.signalCode = signal ?? undefined;
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

/** 带时延返回的事件等待（fence 检出延迟实测用）。 */
async function waitForEventTimed(
  proc: Proc,
  predicate: (e: Record<string, unknown>) => boolean,
  timeoutMs: number,
  what: string,
): Promise<{ event: Record<string, unknown>; elapsedMs: number }> {
  const start = Date.now();
  const event = await waitForEvent(proc, predicate, timeoutMs, what);
  return { event, elapsedMs: Date.now() - start };
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
  const id = `sa7-${++opCounter}`;
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
  const dir = mkdtempSync(join(tmpdir(), 'sa7-p5-mgmt-'));
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
      authorization: [
        { peerInstanceId: 'peer-1', provisionId: 'p1', read: true, submit: true },
        { peerInstanceId: 'peer-2', provisionId: 'p1', read: true, submit: true },
      ],
    },
  };
}

function peerConfig(
  kind: 'memory' | 'file',
  rootDir: string,
  port: number,
  nsId: string,
  token: string,
): Record<string, unknown> {
  return {
    role: 'peer',
    instanceId: token === 'token-2' ? 'peer-2' : 'peer-1',
    persistence: kind === 'file' ? { kind: 'file', rootDir } : { kind: 'memory' },
    peer: {
      hub: { url: `ws://127.0.0.1:${port}/replication`, hubInstanceId: 'hub-1', token },
      targets: [{ namespaceId: nsId, ownerUserId: 'alice' }],
    },
  };
}

async function bootTopology(kind: 'memory' | 'file'): Promise<Topology> {
  const hubRoot = makeTmpDir();
  const peer1Root = makeTmpDir();
  const peer2Root = makeTmpDir();
  const port = await freePort();
  const hub = spawnApp([
    '--config',
    writeConfig(
      makeTmpDir(),
      hubConfig(hubRoot, port, { kind, schema: SCHEMA_V1, root: { count: 0, tags: '' } }),
    ),
  ]);
  const provisioned = await waitForEvent(hub, (e) => e.event === 'provisioned', 60_000, 'hub provisioned');
  const nsId = provisioned.namespaceId as string;
  expect(nsId).toMatch(/^ns-[0-9a-f]{32}$/);
  const replicationId = provisioned.replicationId as string;
  expect(replicationId).toMatch(/^[0-9a-f]{32}$/);
  await waitForEvent(hub, (e) => e.event === 'ready', 60_000, 'hub ready');
  const p1 = spawnApp([
    '--config',
    writeConfig(makeTmpDir(), peerConfig(kind, peer1Root, port, nsId, 'token-1')),
  ]);
  await waitForEvent(p1, (e) => e.event === 'ready', 60_000, 'peer-1 ready');
  const p2 = spawnApp([
    '--config',
    writeConfig(makeTmpDir(), peerConfig(kind, peer2Root, port, nsId, 'token-2')),
  ]);
  await waitForEvent(p2, (e) => e.event === 'ready', 60_000, 'peer-2 ready');
  return { hub, p1, p2, hubRoot, peer1Root, peer2Root, port, nsId, replicationId };
}

async function waitConverged(
  t: { hub: Proc; p1: Proc; p2: Proc; nsId: string },
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
    if (h.ok === true && a.ok === true && b.ok === true && last[0] === last[1] && last[1] === last[2]) {
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

// ═══════════════════════════ 重点 3 + 6：epoch 回执值 + fence 时延 ═══════════════════════════

describe('Phase-5 SA7 补充：bump-epoch 回执值正确性 + fence 检出延迟实测', () => {
  it(
    '回执 replicationEpoch=2 与权威代际交叉验证；fence 事件时延记录（<30s 契约余量）',
    async () => {
      const t = await bootTopology('memory');
      await sendOp(
        t.hub,
        { op: 'verify-write', namespaceId: t.nsId, set: ['tags'], path: ['tags'], value: 'hub', timeoutMs: 30_000 },
        60_000,
      );
      await waitConverged(t, ['tags'], 30_000, 'epoch 基线');

      // 重点 3：回执值形状 + 初值（provision 起始 epoch=1 → 首次 bump 必为 2）
      const bumped = await sendOp(t.hub, { op: 'bump-epoch', namespaceId: t.nsId }, 30_000);
      expect(bumped.ok).toBe(true);
      expect(typeof bumped.replicationEpoch).toBe('number');
      expect(Number.isSafeInteger(bumped.replicationEpoch)).toBe(true);
      expect(bumped.replicationEpoch).toBe(2);

      // 重点 6：fence 检出延迟实测（bump 回执 → identity-conflicted 事件）
      const fenced1 = await waitForEventTimed(
        t.p1,
        (e) => e.event === 'identity-conflicted' || e.type === 'identity-conflicted',
        30_000,
        'peer-1 identity-conflicted',
      );
      const fenced2 = await waitForEventTimed(
        t.p2,
        (e) => e.event === 'identity-conflicted' || e.type === 'identity-conflicted',
        30_000,
        'peer-2 identity-conflicted',
      );
      // 上界 = ackTimeoutMs 缺省 10s；30s = SA4 指定 CI 慢机 3 倍余量（非 flaky 界）
      expect(fenced1.elapsedMs).toBeLessThan(30_000);
      expect(fenced2.elapsedMs).toBeLessThan(30_000);
      console.log(
        `[SA7] fence detection latency: peer-1=${fenced1.elapsedMs}ms peer-2=${fenced2.elapsedMs}ms (contract upper bound ackTimeoutMs=10s, assert <30s)`,
      );

      // 交叉验证 A：fenced peer 的本地身份仍是旧代际 1（expected=本地身份 → ok → 重引导）。
      //   注：expectedReplicationEpoch 语义 = peer 本地身份代际（ADR 0010 expectedLocalIdentity），
      //   非 hub 目标代际。
      const rejoin = await sendOp(
        t.p1,
        {
          op: 'reset-replica',
          namespaceId: t.nsId,
          ownerUserId: 'alice',
          expectedReplicationId: t.replicationId,
          expectedReplicationEpoch: 1,
        },
        30_000,
      );
      expect(rejoin.ok).toBe(true);
      await waitConverged(t, ['tags'], 60_000, 'reset(epoch=1) 后重新收敛');

      // 交叉验证 B：rejoin 后本地身份已采纳权威代际 2（= 回执值）——旧值 1 → MISMATCH
      //   且零破坏（读仍服务）。回执值 ⟺ 权威代际 ⟺ rejoin 后本地身份，三方同一。
      const stale = await sendOp(
        t.p1,
        {
          op: 'reset-replica',
          namespaceId: t.nsId,
          ownerUserId: 'alice',
          expectedReplicationId: t.replicationId,
          expectedReplicationEpoch: 1,
        },
        30_000,
      );
      expect(stale.ok).toBe(false);
      expect(stale.code).toBe('NAMESPACE_RESET_IDENTITY_MISMATCH');
      const stillReadable = await sendOp(
        t.p1,
        { op: 'read', namespaceId: t.nsId, path: ['tags'] },
        20_000,
      );
      expect(stillReadable.ok).toBe(true);
      expect(stillReadable.value).toBe('hub');
    },
    240_000,
  );
});

// ═════════════════════ 重点 2 + 1：extra-key 拒绝 + 零破坏 + 传播端到端 ═════════════════════

describe('Phase-5 SA7 补充：replace-schema 额外键响亮拒绝 + SCHEMA 未变 + 干净重提传播', () => {
  it(
    '5 键信封 → write-failed；旧 schema 写行为/读数不变；四键重提 ok；hub 写新字段收敛',
    async () => {
      const t = await bootTopology('memory');
      await sendOp(
        t.hub,
        { op: 'verify-write', namespaceId: t.nsId, set: ['tags'], path: ['tags'], value: 'hub', timeoutMs: 30_000 },
        60_000,
      );
      await waitConverged(t, ['tags'], 30_000, 'schema 基线');

      // 重点 2：额外键信封（合法四键 + extra）→ write-failed（runtime ENV-5 严格门，
      //   app 层原样透传不静默剥离——SA4 R2 修复的动态确认）
      const extraKey = await sendOp(
        t.hub,
        {
          op: 'replace-schema',
          namespaceId: t.nsId,
          schema: { ...SCHEMA_V2OPT, extra: 'future-field' },
        },
        30_000,
      );
      expect(extraKey.ok).toBe(false);
      expect(extraKey.code).toBe('write-failed');

      // SCHEMA 未变（行为证据，非源码 grep）：
      //   (a) 新 schema 独有字段 note 在旧 schema 下不可写（封闭对象不接受未声明键）
      const noteUnderV1 = await sendOp(
        t.hub,
        { op: 'verify-write', namespaceId: t.nsId, set: ['note'], path: ['note'], value: 'x', timeoutMs: 30_000 },
        60_000,
      );
      expect(noteUnderV1.ok).toBe(false);
      //   (b) 旧 schema 字段读写不变（数据零破坏）
      const tags = await sendOp(t.hub, { op: 'read', namespaceId: t.nsId, path: ['tags'] }, 20_000);
      expect(tags.ok).toBe(true);
      expect(tags.value).toBe('hub');
      const countWrite = await sendOp(
        t.hub,
        { op: 'verify-write', namespaceId: t.nsId, set: ['count'], path: ['count'], value: 3, timeoutMs: 30_000 },
        60_000,
      );
      expect(countWrite.ok).toBe(true);

      // 零破坏佐证：同一 schema 四键干净重提 → ok（前次拒绝确因额外键）
      const clean = await sendOp(
        t.hub,
        { op: 'replace-schema', namespaceId: t.nsId, schema: SCHEMA_V2OPT },
        30_000,
      );
      expect(clean.ok).toBe(true);

      // 重点 1（传播链端到端）：hub 写新字段 → 双 peer 收敛（peer 侧本地写新字段受
      //   引擎「活动 schema 仅在（重）物化时切换」语义约束，见 SA7 报告 O-F2，不断言）
      const hubNote = await sendOp(
        t.hub,
        { op: 'verify-write', namespaceId: t.nsId, set: ['note'], path: ['note'], value: 'propagated', timeoutMs: 30_000 },
        60_000,
      );
      expect(hubNote.ok).toBe(true);
      await waitConverged(t, ['note'], 30_000, 'hub 写 note 传播');
    },
    240_000,
  );
});

// ══════════ 重点 4：FilePersistence reset-replica 全周期（归档落盘 + 恢复收敛） ══════════

describe('Phase-5 SA7 补充：file 适配器 reset-replica 全周期', () => {
  it(
    'reset ok + replica-reset 事件 + archive 落盘 + 进程内重引导收敛 + 崩溃重启恢复收敛',
    async () => {
      const t = await bootTopology('file');
      await sendOp(
        t.hub,
        { op: 'verify-write', namespaceId: t.nsId, set: ['tags'], path: ['tags'], value: 'hub', timeoutMs: 30_000 },
        60_000,
      );
      await waitConverged(t, ['tags'], 30_000, 'file reset 基线');

      // 受控 reset（正确身份 = 本地身份 {rid, 1}）
      const reset = await sendOp(
        t.p1,
        {
          op: 'reset-replica',
          namespaceId: t.nsId,
          ownerUserId: 'alice',
          expectedReplicationId: t.replicationId,
          expectedReplicationEpoch: 1,
        },
        30_000,
      );
      expect(reset.ok).toBe(true);
      expect(
        t.p1.events.some(
          (e) => (e.event === 'replica-reset' || e.type === 'replica-reset') && e.namespaceId === t.nsId,
        ),
      ).toBe(true);

      // 归档落盘（运行期磁盘产物观察：{rootDir}/archive/users/<owner>/<docId>.snapshot）
      const archivePath = join(t.peer1Root, 'archive', 'users', 'alice', `${t.nsId}.snapshot`);
      expect(existsSync(archivePath)).toBe(true);

      // 进程内重引导收敛（归档后 key 缺席 → bootstrap 资格 → 重导入数据等价）
      await waitConverged(t, ['tags'], 60_000, 'file reset 后进程内重引导收敛');

      // 硬崩溃 → hub 停机窗写入 → 同 rootDir 重启 → 恢复收敛（重启时本地副本在档，
      //   引擎按 OPEN 决策走 reconcile/bootstrap 皆合法；断言收敛 + 零丢失）
      hardCrashByLock(t.peer1Root);
      await waitForExit(t.p1, 15_000, 'peer-1 crash');
      await sendOp(
        t.hub,
        { op: 'verify-write', namespaceId: t.nsId, set: ['count'], path: ['count'], value: 100, timeoutMs: 30_000 },
        60_000,
      );
      await sleep(2_000);
      const p1b = spawnApp([
        '--config',
        writeConfig(makeTmpDir(), peerConfig('file', t.peer1Root, t.port, t.nsId, 'token-1')),
      ]);
      await waitForEvent(p1b, (e) => e.event === 'ready', 60_000, 'peer-1 restart ready');
      await waitConverged({ ...t, p1: p1b }, ['count'], 60_000, 'file reset 崩溃重启后 count 收敛');
      await waitConverged({ ...t, p1: p1b }, ['tags'], 60_000, 'file reset 崩溃重启后 tags 零丢失');
      const restartedViaBootstrap = p1b.events.some(
        (e) => e.event === 'bootstrap-imported' || e.type === 'bootstrap-imported',
      );
      console.log(
        `[SA7] file reset 后崩溃重启恢复路径: ${restartedViaBootstrap ? 'bootstrap-imported' : 'reconcile/sync（本地副本在档）'}`,
      );
    },
    300_000,
  );
});

// ════════ 🔴 红锚 F1（SA7 R1）：第二轮 bump→fence→reset 后重引导不发生 ════════

describe('Phase-5 SA7 红锚 F1：两轮 bump→fence→reset 运维循环的第二轮重引导（当前实现缺口）', () => {
  it(
    '🔴 第二次成功 reset-replica 后应重引导收敛（部署文档冻结编排 ③）；文档化恢复入口 add-target 应有效',
    async () => {
      const t = await bootTopology('memory');
      await sendOp(
        t.hub,
        { op: 'verify-write', namespaceId: t.nsId, set: ['tags'], path: ['tags'], value: 'hub', timeoutMs: 30_000 },
        60_000,
      );
      await waitConverged(t, ['tags'], 30_000, 'F1 基线');

      // ── 第 1 轮：bump → fence → reset（本地身份 epoch=1）→ 重引导收敛（当前实现 OK）──
      const bump1 = await sendOp(t.hub, { op: 'bump-epoch', namespaceId: t.nsId }, 30_000);
      expect(bump1.ok).toBe(true);
      expect(bump1.replicationEpoch).toBe(2);
      await waitForEvent(
        t.p1,
        (e) => e.event === 'identity-conflicted' || e.type === 'identity-conflicted',
        30_000,
        '第 1 轮 peer-1 fence',
      );
      const reset1 = await sendOp(
        t.p1,
        {
          op: 'reset-replica',
          namespaceId: t.nsId,
          ownerUserId: 'alice',
          expectedReplicationId: t.replicationId,
          expectedReplicationEpoch: 1,
        },
        30_000,
      );
      expect(reset1.ok).toBe(true);
      await waitConverged(t, ['tags'], 60_000, 'F1 第 1 轮 reset 后重新收敛');

      // ── 第 2 轮：bump → fence → reset（本地身份已采纳 epoch=2）→ 应回执 ok 并重引导收敛 ──
      const bump2 = await sendOp(t.hub, { op: 'bump-epoch', namespaceId: t.nsId }, 30_000);
      expect(bump2.ok).toBe(true);
      expect(bump2.replicationEpoch).toBe(3);
      await waitForEvent(
        t.p1,
        (e) => e.event === 'identity-conflicted' || e.type === 'identity-conflicted',
        30_000,
        '第 2 轮 peer-1 fence',
      );
      const reset2 = await sendOp(
        t.p1,
        {
          op: 'reset-replica',
          namespaceId: t.nsId,
          ownerUserId: 'alice',
          expectedReplicationId: t.replicationId,
          expectedReplicationEpoch: 2,
        },
        30_000,
      );
      // 归档 + 前置核对成功（SA7 实测：回执 ok:true + replica-reset 事件均出现）
      expect(reset2.ok).toBe(true);
      // 🔴 部署文档冻结编排 ③：addTarget → §14.1 整连接重建 → 重 OPEN → bootstrap。
      //    SA7 实测（2026-08-30）：channel closing→closed 后无任何重建/重开事件，
      //    peer 该 ns 永久 read-failed —— 本断言当前为红，SA3 修复后转绿。
      await waitConverged(t, ['tags'], 60_000, 'F1 第 2 轮 reset 后重新收敛（红锚：当前不发生）');

      // 文档化恢复入口（部署文档 reset 行）：重引导链失败 → add-target。
      //    SA7 实测：被 G5c 恢复的 peerOwners 幂等集短路为伪 ok:true 零动作 —— 一并钉红。
      const addTarget = await sendOp(
        t.p1,
        { op: 'add-target', namespaceId: t.nsId, ownerUserId: 'alice' },
        30_000,
      );
      expect(addTarget.ok).toBe(true);
      await waitConverged(t, ['tags'], 60_000, 'F1 add-target 恢复入口后重新收敛（红锚：当前不发生）');
    },
    360_000,
  );
});

// ════════ O-R3-1（SA4 R3 移交，SA7 R2 必验）：终态通道 + peerOwners 在册 → add-target 放行分支 ════════

describe('Phase-5 SA7 O-R3-1：终态通道（conflicted）+ peerOwners 在册 → add-target 放行 → target-added + 重建', () => {
  it(
    'fence 终态下 add-target 不被幂等集短路：target-added 事件 + 通道离开终态 + 重建后 reset 收敛',
    async () => {
      const t = await bootTopology('memory');
      await sendOp(
        t.hub,
        { op: 'verify-write', namespaceId: t.nsId, set: ['tags'], path: ['tags'], value: 'hub', timeoutMs: 30_000 },
        60_000,
      );
      await waitConverged(t, ['tags'], 30_000, 'O-R3-1 基线');

      // 制造终态 + peerOwners 在册：bump → fence → finalize('conflicted')（终态；
      // openActiveTargets 对 closed/conflicted 等待显式 re-add §14.1——正是放行分支的目标态）。
      // fencing 不触碰 peerOwners（app.ts 幂等集仅 add/remove/reset 编排维护）。
      const bumped = await sendOp(t.hub, { op: 'bump-epoch', namespaceId: t.nsId }, 30_000);
      expect(bumped.ok).toBe(true);
      await waitForEvent(
        t.p1,
        (e) => e.event === 'identity-conflicted' || e.type === 'identity-conflicted',
        30_000,
        'O-R3-1 peer-1 fence（通道 → conflicted 终态）',
      );

      // ── 放行分支本体：终态通道 + peerOwners 有条目 → add-target ──
      //    旧实现（f310f18 前）：peerOwners.has 短路 → 伪 ok:true、零事件零动作。
      //    修复后：状态感知短路仅覆盖非终态；conflicted 放行 → engine re-add 分支
      //    （targeted + requestRebuild('re-add')）→ target-added 事件 + 整连接重建。
      const mark = t.p1.events.length;
      const addTarget = await sendOp(
        t.p1,
        { op: 'add-target', namespaceId: t.nsId, ownerUserId: 'alice' },
        30_000,
      );
      expect(addTarget.ok).toBe(true);
      // (a) 放行证据：target-added 恰在本次 add-target 后发射（短路分支零事件）
      expect(
        t.p1.events
          .slice(mark)
          .some((e) => e.event === 'target-added' && e.namespaceId === t.nsId),
      ).toBe(true);
      // (b) 重建证据：通道离开 conflicted 终态（re-add 分支 setState('targeted')）
      expect(
        t.p1.events
          .slice(mark)
          .some(
            (e) =>
              e.event === 'channel-state-changed' &&
              e.namespaceId === t.nsId &&
              e.from === 'conflicted',
          ),
      ).toBe(true);

      // 重 OPEN 因本地身份陈旧（epoch=1 vs 权威 2）会再入 conflicted（契约内行为）；
      // 以受控 reset 走完重入 → 证明 (b) 重建出的通道/机制可收敛（rebuilt → converged）。
      const reset = await sendOp(
        t.p1,
        {
          op: 'reset-replica',
          namespaceId: t.nsId,
          ownerUserId: 'alice',
          expectedReplicationId: t.replicationId,
          expectedReplicationEpoch: 1,
        },
        30_000,
      );
      expect(reset.ok).toBe(true);
      await waitConverged(t, ['tags'], 60_000, 'O-R3-1 add-target 重建后 reset 收敛');
    },
    300_000,
  );
});
