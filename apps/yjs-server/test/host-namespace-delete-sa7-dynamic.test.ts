/**
 * issue #228 — SA7 动态验证补充测试（final-verification 轮）。
 *
 * 覆盖 SA4 静态审核报告「动态审核重点」中既有套件（D1–D4、T-H5–H8）之外、
 * 明确路由到 SA7 动态轮的项：
 * - 重点 3（G4 并发单飞）：同 nsId 并发 delete ×N → 全部诚实终态、无重入破坏；
 * - 重点 4（F5 注入）：日志目录只读 → `log-delete-failed{step,errno}` 值域透传；
 *   同进程重试收敛（N1–N5 续走）；
 * - 重点 5（F3 注入）：数据目录只读 → `delete-namespace-failed`；tombstone 二删
 *   收敛（registry absent → deleteDoc 重试 → ok）；
 * - 重点 8（M4 改述后验证）：F5 半态（deletion.json marker 在场）+ 重启 provision →
 *   新 id 新流健康，新 namespace 不出现 `stream-init-failed{reason:'namespace-log-deleted'}`
 *   （marker 门不适用于新 CSPRNG id）；
 * - 重点 9（SIGTERM 竞态）：删除中 SIGTERM → 有界停机 exit 0；重启健康；
 * - 重点 10（peer 面 + 后续 op 可用）：peer 发 `delete-namespace` → `unknown-op`；
 *   非法参数/失败回执后进程继续应答后续 op。
 *
 * 纪律：与红灯契约同款黑盒进程 E2E（spawn main.ts、真实 file persistence +
 * diagnostics enabled + provision；断言只消费 stdout NDJSON 回执、真实文件产物与
 * 进程生命周期）；零源码 grep、零 skip。故障注入 = chmod(0555) 目录只读（运行用户
 * 非 root，EACCES 物理生效），恢复后重试验证收敛——不引入任何 mock。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

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

const PROVISION = Object.freeze({ id: 'p1', ownerUserId: 'alice', schema: VFSL_SCHEMA, root: { count: 0 } });

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
/** chmod 注入路径恢复登记（afterEach 兜底，防只读目录卡死临时目录清理）。 */
const chmodRestore: Array<{ path: string; mode: number }> = [];

function makeTmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function makeReadOnly(path: string): void {
  chmodSync(path, 0o555);
  chmodRestore.push({ path, mode: 0o755 });
}

function restoreReadOnly(): void {
  for (const entry of chmodRestore.splice(0)) {
    try {
      chmodSync(entry.path, entry.mode);
    } catch {
      /* 目录可能已被删除（删除成功路径）——恢复失败无害 */
    }
  }
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
function nextOpId(): string {
  return `sa7-228-dyn-${++opCounter}`;
}

/** 写入一行控制输入（不等待回执——并发驱动用）。 */
async function writeOpLine(proc: Proc, op: Record<string, unknown>): Promise<string> {
  const id = nextOpId();
  const serialized = JSON.stringify({ ...op, id });
  await new Promise<void>((resolve, reject) => {
    proc.child.stdin!.write(`${serialized}\n`, (err) => (err ? reject(err) : resolve()));
  });
  return id;
}

async function awaitReply(proc: Proc, id: string, timeoutMs: number): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = proc.events.find((e) => e.event === 'reply' && e.id === id);
    if (hit) return hit;
    if (proc.exitCode !== null) {
      throw new Error(`process exited ${proc.exitCode} awaiting reply ${id}\nstderr:\n${proc.stderr.join('')}`);
    }
    await sleep(25);
  }
  throw new Error(`timeout ${timeoutMs}ms awaiting reply ${id}; events tail: ${JSON.stringify(proc.events.slice(-5))}`);
}

async function sendOp(proc: Proc, op: Record<string, unknown>, timeoutMs = 60_000): Promise<Record<string, unknown>> {
  const id = await writeOpLine(proc, op);
  return awaitReply(proc, id, timeoutMs);
}

afterEach(() => {
  for (const proc of liveProcs) {
    if (proc.exitCode === null) {
      proc.child.kill('SIGKILL');
    }
  }
  liveProcs.length = 0;
  restoreReadOnly();
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 配置 / 磁盘布局辅助（与红灯契约同款布局约定）
// ─────────────────────────────────────────────────────────────────────────────

function hubConfig(opts: { persistRoot: string; logRootDir: string; port: number }): Record<string, unknown> {
  return {
    role: 'hub',
    instanceId: 'hub-1',
    persistence: { kind: 'file', rootDir: opts.persistRoot },
    hub: {
      listen: { host: '127.0.0.1', port: opts.port },
      tokens: { 'peer-1': 'token-1' },
      provision: [PROVISION],
      authorization: [{ peerInstanceId: 'peer-1', provisionId: 'p1', read: true, submit: true }],
    },
    diagnostics: { enabled: true, rootDir: opts.logRootDir, updateCapture: true, inputPolicy: 'digest' },
  };
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

function namespaceLogDir(logRootDir: string, namespaceId: string): string {
  return join(logRootDir, 'namespaces', namespaceId);
}

function snapshotPathsOf(persistRoot: string): string[] {
  const out: string[] = [];
  const usersDir = join(persistRoot, 'users');
  if (!existsSync(usersDir)) return out;
  for (const user of readdirSync(usersDir)) {
    const userDir = join(usersDir, user);
    if (!existsSync(userDir)) continue;
    for (const file of readdirSync(userDir)) {
      if (file.endsWith('.snapshot')) out.push(join(userDir, file));
    }
  }
  return out;
}

async function bootHub(persistRoot: string, logRoot: string, what: string): Promise<{ proc: Proc; namespaceId: string }> {
  const port = await freePort();
  const config = hubConfig({ persistRoot, logRootDir: logRoot, port });
  const proc = spawnApp(['--config', writeConfig(makeTmpDir(`sa7-228dyn-${what}-cfg-`), config)]);
  const provisioned = await waitForEvent(proc, (e) => e.event === 'provisioned', 60_000, `${what} provisioned`);
  const namespaceId = provisioned.namespaceId as string;
  expect(namespaceId).toMatch(/^ns-[0-9a-f]{32}$/);
  await waitForEvent(proc, (e) => e.event === 'ready', 60_000, `${what} ready`);
  return { proc, namespaceId };
}

async function expectLogsEstablished(logRoot: string, namespaceId: string, what: string): Promise<void> {
  await expect
    .poll(
      () => {
        const locatorFile = join(namespaceLogDir(logRoot, namespaceId), 'current.json');
        if (!existsSync(locatorFile)) return false;
        const locator = JSON.parse(readFileSync(locatorFile, 'utf8')) as { streamId?: unknown };
        if (typeof locator.streamId !== 'string') return false;
        const segments = join(namespaceLogDir(logRoot, namespaceId), 'streams', locator.streamId, 'segments');
        if (!existsSync(segments)) return false;
        return readdirSync(segments).some((name) => name.endsWith('.jsonl'));
      },
      { interval: 20, timeout: 10_000 },
    )
    .toBe(true);
}

async function expectSnapshotPresent(persistRoot: string, what: string): Promise<string[]> {
  let paths: string[] = [];
  await expect
    .poll(
      () => {
        paths = snapshotPathsOf(persistRoot);
        return paths.length > 0;
      },
      { interval: 20, timeout: 10_000 },
    )
    .toBe(true);
  expect(paths.length, `${what}: 至少一个持久化快照`).toBeGreaterThan(0);
  return paths;
}

// ─────────────────────────────────────────────────────────────────────────────
// SA7 动态重点（SA4「动态审核重点」清单路由项）
// ─────────────────────────────────────────────────────────────────────────────

describe('issue #228 — SA7 动态验证：delete-namespace 并发/故障注入/重启/停机/peer 面', () => {
  it('SA7-重点3 G4 并发单飞：同 nsId 并发 delete ×5（stdin 多行不互相等待）→ 全部诚实终态 ok:true、终态清洁、进程存活、后续 op 正常应答', async () => {
    const persistRoot = makeTmpDir('sa7-228dyn-g4-persist-');
    const logRoot = makeTmpDir('sa7-228dyn-g4-log-');
    const { proc, namespaceId } = await bootHub(persistRoot, logRoot, 'g4');
    await expectLogsEstablished(logRoot, namespaceId, 'G4');
    const snapshotPaths = await expectSnapshotPresent(persistRoot, 'G4');

    // 并发驱动：5 行 delete-namespace 连续写入（main.ts readline 'line' handler 为
    // 非 awaited async——5 个 dispatch 真实并发进入 opDeleteNamespace，命中 G4 单飞）。
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(await writeOpLine(proc, { op: 'delete-namespace', namespaceId }));
    }
    const replies = await Promise.all(ids.map((id) => awaitReply(proc, id, 60_000)));

    // 全部诚实终态：单飞语义下第二~五请求 await 首请求结算后重走全路径（幂等收敛）
    for (const [index, reply] of replies.entries()) {
      expect(reply.ok, `并发 delete #${index + 1} 回执必须诚实 ok（今日: ${JSON.stringify(reply)}）`).toBe(true);
    }
    // 终态清洁（无重入破坏）：快照与日志目录树全部 absent
    expect(existsSync(namespaceLogDir(logRoot, namespaceId)), '日志目录树必须 absent').toBe(false);
    for (const snapshot of snapshotPaths) {
      expect(existsSync(snapshot), `快照 ${snapshot} 必须 absent`).toBe(false);
    }
    // namespace-deleted 生命周期事件至少一次（回执前发射）
    const deletedEvents = proc.events.filter((e) => e.event === 'namespace-deleted' && e.namespaceId === namespaceId);
    expect(deletedEvents.length).toBeGreaterThan(0);
    // 进程存活 + 后续 op 正常应答（重点 10 的 hub 侧「失败/成功后进程继续可用」）
    expect(proc.exitCode, '进程必须存活').toBeNull();
    const status = await sendOp(proc, { op: 'status' }, 30_000);
    expect(status.ok, '后续 status op 必须正常应答').toBe(true);

    await signalAndExpectExit(proc, 'SIGTERM', 30_000, 0, 'hub G4');
  }, 300_000);

  it('SA7-重点4 F5 注入（日志目录只读）：回执 {ok:false,code:"log-delete-failed",step:"marker",errno:"EACCES"} 值域透传；数据段已完成（快照 absent）；同进程 chmod 恢复后重试收敛 ok:true', async () => {
    const persistRoot = makeTmpDir('sa7-228dyn-f5-persist-');
    const logRoot = makeTmpDir('sa7-228dyn-f5-log-');
    const { proc, namespaceId } = await bootHub(persistRoot, logRoot, 'f5');
    await expectLogsEstablished(logRoot, namespaceId, 'F5');
    const snapshotPaths = await expectSnapshotPresent(persistRoot, 'F5');

    // 注入：namespace 日志目录只读 → deletion.json marker temp 写失败（step=marker）
    makeReadOnly(namespaceLogDir(logRoot, namespaceId));

    const failed = await sendOp(proc, { op: 'delete-namespace', namespaceId }, 30_000);
    expect(failed.ok, `F5 注入必须诚实失败（今日: ${JSON.stringify(failed)}）`).toBe(false);
    expect(failed.code, '失败码').toBe('log-delete-failed');
    expect(failed.step, 'step 值域透传（marker 段）').toBe('marker');
    expect(failed.errno, 'errno 值域逐字透传（EACCES，不重映射）').toBe('EACCES');
    // 数据段（③ registry.deleteNamespace）在日志段（④）之前已完成 → 快照 absent
    for (const snapshot of snapshotPaths) {
      expect(existsSync(snapshot), 'F5 下数据段已完成：快照必须已删除').toBe(false);
    }
    // 日志树仍在（半态）+ 进程存活 + 无 namespace-deleted 事件（ack 谓词未达成）
    expect(existsSync(namespaceLogDir(logRoot, namespaceId)), '日志树半态仍在').toBe(true);
    expect(proc.exitCode, '进程必须存活（控制输入不致退出）').toBeNull();
    expect(
      proc.events.filter((e) => e.event === 'namespace-deleted' && e.namespaceId === namespaceId).length,
      '失败回执不得发射 namespace-deleted',
    ).toBe(0);

    // 同进程重试收敛（重入是唯一完成路径）：恢复权限 → 二删走 tombstone 幂等路径
    restoreReadOnly();
    const retry = await sendOp(proc, { op: 'delete-namespace', namespaceId }, 30_000);
    expect(retry.ok, `重试必须收敛 ok（今日: ${JSON.stringify(retry)}）`).toBe(true);
    expect(existsSync(namespaceLogDir(logRoot, namespaceId)), '重试后日志目录树必须 absent').toBe(false);
    expect(
      proc.events.filter((e) => e.event === 'namespace-deleted' && e.namespaceId === namespaceId).length,
    ).toBe(1);

    await signalAndExpectExit(proc, 'SIGTERM', 30_000, 0, 'hub F5');
  }, 300_000);

  it('SA7-重点5 F3 注入（数据目录只读）：回执 {ok:false,code:"delete-namespace-failed"}；数据未删（快照仍在）、日志未动；重试（tombstone 二删）收敛 ok:true 且全清', async () => {
    const persistRoot = makeTmpDir('sa7-228dyn-f3-persist-');
    const logRoot = makeTmpDir('sa7-228dyn-f3-log-');
    const { proc, namespaceId } = await bootHub(persistRoot, logRoot, 'f3');
    await expectLogsEstablished(logRoot, namespaceId, 'F3');
    const snapshotPaths = await expectSnapshotPresent(persistRoot, 'F3');
    // 结算等待：确保没有在途 dirty flush 会在 close drain 期写文件（注入只针对 removeKey）
    await sleep(600);

    // 注入：owner 数据目录只读 → io.removeKey 的 fsp.rm 失败（EACCES）→
    // DocDeleteOperationalError → NAMESPACE_DELETE_FAILED → delete-namespace-failed
    const ownerDir = join(persistRoot, 'users', 'alice');
    expect(existsSync(ownerDir), 'owner 数据目录必须在场').toBe(true);
    makeReadOnly(ownerDir);

    const failed = await sendOp(proc, { op: 'delete-namespace', namespaceId }, 30_000);
    expect(failed.ok, `F3 注入必须诚实失败（今日: ${JSON.stringify(failed)}）`).toBe(false);
    expect(failed.code, '失败码（数据段 operational 折叠）').toBe('delete-namespace-failed');
    // 数据未删（removeKey 失败）+ 日志段未触达（④ 未到达）
    for (const snapshot of snapshotPaths) {
      expect(existsSync(snapshot), 'F3 下数据可能仍在：快照必须在场（未删）').toBe(true);
    }
    expect(existsSync(namespaceLogDir(logRoot, namespaceId)), '日志树必须未动').toBe(true);
    expect(proc.exitCode, '进程必须存活').toBeNull();

    // tombstone 二删收敛：恢复权限 → 二删（registry absent → ok → deleteDoc 重试 → 全清）
    restoreReadOnly();
    const retry = await sendOp(proc, { op: 'delete-namespace', namespaceId }, 30_000);
    expect(retry.ok, `二删必须收敛 ok（今日: ${JSON.stringify(retry)}）`).toBe(true);
    for (const snapshot of snapshotPaths) {
      expect(existsSync(snapshot), '二删后快照必须 absent').toBe(false);
    }
    expect(existsSync(namespaceLogDir(logRoot, namespaceId)), '二删后日志目录树必须 absent').toBe(false);

    await signalAndExpectExit(proc, 'SIGTERM', 30_000, 0, 'hub F3');
  }, 300_000);

  it('SA7-重点8 M4（marker 半态 × 重启 provision）：streams 只读 → log-delete-failed{step:"stream"} 且 deletion.json marker 落盘；重启 provision → 新 CSPRNG id 新流健康，无 stream-init-failed{reason:"namespace-log-deleted"}（marker 门不适用于新 id）', async () => {
    const persistRoot = makeTmpDir('sa7-228dyn-m4-persist-');
    const logRoot = makeTmpDir('sa7-228dyn-m4-log-');
    const { proc, namespaceId } = await bootHub(persistRoot, logRoot, 'm4');
    await expectLogsEstablished(logRoot, namespaceId, 'M4');
    await expectSnapshotPresent(persistRoot, 'M4');

    // 注入：streams 子树只读 → marker（deletion.json 写入 ns 目录，可写）成功、
    // locator 段成功、stream 段 rename/rm 失败 → 半态 = marker 在场
    makeReadOnly(join(namespaceLogDir(logRoot, namespaceId), 'streams'));

    const failed = await sendOp(proc, { op: 'delete-namespace', namespaceId }, 30_000);
    expect(failed.ok, `注入必须诚实失败（今日: ${JSON.stringify(failed)}）`).toBe(false);
    expect(failed.code).toBe('log-delete-failed');
    expect(failed.step, 'step = stream（marker/locator 段已过）').toBe('stream');
    expect(failed.errno).toBe('EACCES');
    expect(
      existsSync(join(namespaceLogDir(logRoot, namespaceId), 'deletion.json')),
      'deletion.json marker 必须已落盘（半态）',
    ).toBe(true);

    restoreReadOnly();
    await signalAndExpectExit(proc, 'SIGTERM', 30_000, 0, 'hub M4 first boot');

    // 重启（同 provision 配置——R-1：按配置重建 = 新 namespace、新流、新身份）
    const boot2 = await bootHub(persistRoot, logRoot, 'm4-second');
    expect(boot2.namespaceId, '重建必须是新 CSPRNG 身份').not.toBe(namespaceId);
    // 新 namespace 建流健康（marker 门只作用于同 id 半态，不得波及新 id）
    await expectLogsEstablished(logRoot, boot2.namespaceId, 'M4 rebuilt');
    // 全事件面无 stream-init-failed / namespace-log-deleted（健康构造的直接负锚）
    const serialized = JSON.stringify(boot2.proc.events);
    expect(serialized.includes('stream-init-failed'), '不得出现 stream-init-failed').toBe(false);
    expect(serialized.includes('namespace-log-deleted'), '不得出现 namespace-log-deleted').toBe(false);
    // 旧 ns 半态不被重启「复活」：marker 仍在、无新流写入旧树
    expect(existsSync(join(namespaceLogDir(logRoot, namespaceId), 'deletion.json'))).toBe(true);
    expect(
      existsSync(join(namespaceLogDir(logRoot, namespaceId), 'current.json')),
      '旧树 locator 已在失败前移除、不得复活',
    ).toBe(false);

    await sleep(1_500); // tsx wrapper ready-后即刻 SIGTERM 的既有 choreography 窗口（D4 环境注记同款）
    await signalAndExpectExit(boot2.proc, 'SIGTERM', 30_000, 0, 'hub M4 second boot');
  }, 300_000);

  it('SA7-重点9 SIGTERM 竞态：删除中 SIGTERM → 有界停机 exit 0；重启健康（新 id）；若删除回执先于退出到达则旧树 absent（ack 语义成立）', async () => {
    // 多偏移重复（30/80/150ms）提升「SIGTERM 真落在删除窗口内」的命中率；每轮独立
    // boot。先越过 tsx wrapper「ready 后 ~600ms」既有 choreography 窗口（D4 环境注
    // 记——该窗口内 SIGTERM 得 143 属 wrapper 行为、与删除实现无关），再发起竞态。
    let lastPersistRoot = '';
    let lastLogRoot = '';
    let lastNamespaceId = '';
    for (const [round, offsetMs] of [30, 80, 150].entries()) {
      const persistRoot = makeTmpDir(`sa7-228dyn-term${round}-persist-`);
      const logRoot = makeTmpDir(`sa7-228dyn-term${round}-log-`);
      const { proc, namespaceId } = await bootHub(persistRoot, logRoot, `term${round}`);
      lastPersistRoot = persistRoot;
      lastLogRoot = logRoot;
      lastNamespaceId = namespaceId;
      await expectLogsEstablished(logRoot, namespaceId, `TERM${round}`);
      await expectSnapshotPresent(persistRoot, `TERM${round}`);
      await sleep(1_500); // 越过 wrapper choreography 窗口

      const id = await writeOpLine(proc, { op: 'delete-namespace', namespaceId });
      await sleep(offsetMs);
      const sigtermAt = Date.now();
      proc.child.kill('SIGTERM');
      const code = await waitForExit(proc, 30_000, `hub TERM${round}`);
      expect(
        code,
        `SIGTERM(+)${offsetMs}ms 竞态下必须有界优雅停机 exit 0（stderr 尾部：${proc.stderr.slice(-3).join('')}）`,
      ).toBe(0);

      const sawReply = proc.events.find((e) => e.event === 'reply' && e.id === id);
      console.log(
        `[SA7-DV] 重点9 round ${round}（+${offsetMs}ms）：exit=${code}；回执先于退出=${sawReply !== undefined}（${JSON.stringify(sawReply ?? null)}）；退出耗时=${Date.now() - sigtermAt}ms`,
      );
      if (sawReply !== undefined && sawReply.ok === true) {
        // 删除在停机 drain 内完成并回执 → ack 语义必须成立（旧树 absent）
        expect(existsSync(namespaceLogDir(logRoot, namespaceId)), 'ack 后旧日志树必须 absent').toBe(false);
        expect(snapshotPathsOf(persistRoot), 'ack 后快照必须全 absent').toHaveLength(0);
      } else {
        // 回执未及发射（进程先退出）——不构成 ack；收敛由重启后运维重试承担（AD-8/N4 注记）
        console.log('[SA7-DV] 重点9：SIGTERM 先于回执发射（无 ack），停机有界性仍成立');
      }
    }

    // 重启健康（末轮根）：同配置 provision 重建（新 CSPRNG 身份 ≠ 已删 id）；
    // 持久根锁已被干净停机释放（boot2 能独占获取即为其证据）
    const boot2 = await bootHub(lastPersistRoot, lastLogRoot, 'term-second');
    expect(boot2.namespaceId, '重启 provision 必须是新 CSPRNG 身份').not.toBe(lastNamespaceId);
    await expectLogsEstablished(lastLogRoot, boot2.namespaceId, 'TERM rebuilt');
    await sleep(1_500);
    await signalAndExpectExit(boot2.proc, 'SIGTERM', 30_000, 0, 'hub TERM second boot');
  }, 300_000);

  it('SA7-重点2b 删除后重连拒绝：delete ack 后新 peer 以同 target 重连 → authorize 被拒（channel 永不 live）、hub 数据/日志保持 absent、hub 健康', async () => {
    const persistRoot = makeTmpDir('sa7-228dyn-reconn-persist-');
    const logRoot = makeTmpDir('sa7-228dyn-reconn-log-');
    const port = await freePort();
    const hub = spawnApp([
      '--config',
      writeConfig(makeTmpDir('sa7-228dyn-reconn-hub-cfg-'), hubConfig({ persistRoot, logRootDir: logRoot, port })),
    ]);
    const provisioned = await waitForEvent(hub, (e) => e.event === 'provisioned', 60_000, 'reconn hub provisioned');
    const namespaceId = provisioned.namespaceId as string;
    await waitForEvent(hub, (e) => e.event === 'ready', 60_000, 'reconn hub ready');
    await expectLogsEstablished(logRoot, namespaceId, 'RECONN');
    await expectSnapshotPresent(persistRoot, 'RECONN');

    // 删除（ack 语义成立）
    const reply = await sendOp(hub, { op: 'delete-namespace', namespaceId }, 30_000);
    expect(reply.ok, `delete 回执（${JSON.stringify(reply)}）`).toBe(true);
    expect(existsSync(namespaceLogDir(logRoot, namespaceId))).toBe(false);
    expect(snapshotPathsOf(persistRoot)).toHaveLength(0);

    // 新 peer 以已删 ns 为 target 重连：授权绑定已在删除 ② 摘除 → authorize {ok:false}
    const peer2 = spawnApp([
      '--config',
      writeConfig(makeTmpDir('sa7-228dyn-reconn-peer-cfg-'), peerConfig(port, namespaceId)),
    ]);
    await waitForEvent(peer2, (e) => e.event === 'ready', 60_000, 'reconnect peer ready');

    // 观测窗：channel 永不 live（双侧）；hub 数据/日志保持 absent；hub 健康。
    // hub 侧只统计删除回执**之后**追加的事件（删除前 boot 阶段的 channel 事件不算）。
    const hubEventBase = hub.events.length;
    const deadline = Date.now() + 6_000;
    for (;;) {
      const liveSeen =
        hub.events.slice(hubEventBase).some(
          (e) => e.event === 'channel-state-changed' && e.namespaceId === namespaceId && e.to === 'live',
        ) ||
        peer2.events.some((e) => e.event === 'channel-state-changed' && e.namespaceId === namespaceId && e.to === 'live');
      expect(liveSeen, '已删 ns 的 channel 绝不重新 live').toBe(false);
      expect(snapshotPathsOf(persistRoot), '重连窗口内 hub 快照不得复活').toHaveLength(0);
      expect(existsSync(namespaceLogDir(logRoot, namespaceId)), '重连窗口内日志树不得重建').toBe(false);
      if (Date.now() > deadline) break;
      await sleep(200);
    }
    const status = await sendOp(hub, { op: 'status' }, 20_000);
    expect(status.ok, 'hub 必须保持健康').toBe(true);

    await sleep(1_500);
    await signalAndExpectExit(peer2, 'SIGTERM', 30_000, 0, 'reconnect peer');
    await signalAndExpectExit(hub, 'SIGTERM', 30_000, 0, 'reconn hub');
  }, 300_000);

  it('SA7-重点10 peer 面：peer 发 delete-namespace → {ok:false,code:"unknown-op"}；之后 status 正常应答（进程继续可用）；hub 侧非法参数后后续 op 正常', async () => {
    const persistRoot = makeTmpDir('sa7-228dyn-peer-persist-');
    const logRoot = makeTmpDir('sa7-228dyn-peer-log-');
    const port = await freePort();
    const hub = spawnApp([
      '--config',
      writeConfig(makeTmpDir('sa7-228dyn-peer-hub-cfg-'), hubConfig({ persistRoot, logRootDir: logRoot, port })),
    ]);
    const provisioned = await waitForEvent(hub, (e) => e.event === 'provisioned', 60_000, 'peer-hub provisioned');
    const namespaceId = provisioned.namespaceId as string;
    await waitForEvent(hub, (e) => e.event === 'ready', 60_000, 'peer-hub ready');

    const peer = spawnApp([
      '--config',
      writeConfig(makeTmpDir('sa7-228dyn-peer-cfg-'), peerConfig(port, namespaceId)),
    ]);
    await waitForEvent(peer, (e) => e.event === 'ready', 60_000, 'peer ready');

    // peer 角色门：delete-namespace 是 hub 专属动词（G1）→ unknown-op（非 invalid-op-args）
    const peerReply = await sendOp(peer, { op: 'delete-namespace', namespaceId }, 30_000);
    expect(peerReply.ok, `peer 必须被拒（今日: ${JSON.stringify(peerReply)}）`).toBe(false);
    expect(peerReply.code, 'peer 角色门稳定码').toBe('unknown-op');
    expect(peer.exitCode, 'peer 进程必须存活').toBeNull();
    // 之后控制通道继续可用（后续 op 正常回执——进程不因控制输入崩溃/卡死）
    const peerStatus = await sendOp(peer, { op: 'status' }, 30_000);
    expect(peerStatus.ok, 'peer 后续 status 必须正常应答').toBe(true);

    // hub 侧镜像：非法参数回执后，后续 op 正常应答（D3 的「进程继续可用」补 op 级证据）
    const hubInvalid = await sendOp(hub, { op: 'delete-namespace', namespaceId: 'not-a-namespace-id' }, 30_000);
    expect(hubInvalid.ok).toBe(false);
    expect(hubInvalid.code).toBe('invalid-op-args');
    const hubStatus = await sendOp(hub, { op: 'status' }, 30_000);
    expect(hubStatus.ok, 'hub 后续 status 必须正常应答').toBe(true);

    // tsx wrapper「ready 后 ~600ms 内 SIGTERM」既有 choreography 窗口（D4 环境注记
    // 同款）：peer 刚 ready 不久，给有界 settle 后再停机（进程健康性断言语义不变）
    await sleep(1_500);
    await signalAndExpectExit(peer, 'SIGTERM', 30_000, 0, 'peer');
    await signalAndExpectExit(hub, 'SIGTERM', 30_000, 0, 'hub');
  }, 300_000);
});
