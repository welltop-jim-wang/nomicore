/**
 * issue #228 AC1 验收契约 — Host 的 namespace 数据删除工作流 ⇄ 诊断日志逻辑删除联动
 * （task_228_sa6_acceptance_contract.md；SA8 前置门禁 verdict=clear，B1–B3 边界约束）。
 *
 * 【头注状态（SA3 implementation round）：红灯 → 已转绿】实现按设计仲裁
 * （task_228_design.md AD-2/AD-3/AD-8：PROPOSAL op `delete-namespace` 原名原形
 * 零修订；数据段 registry.deleteNamespace + persistence.deleteDoc；日志段
 * deleteNamespaceDiagnosticLog；成功 ack ⟺ 同一回执周期内数据与日志均完成逻辑删除）
 * 落地后，D1–D3 零断言改动转绿；D4 断言级仲裁注记见用例内（原「重启后 namespaceId
 * 确定性派生」前提与设计 R-1 冲突——删除是终态、重启 provision 重建 = 新 identity，
 * 物理上无确定性派生机制，按 R-1 修订为「重启健康 + 重建新身份 + 旧 generation
 * 零复活 + 无 marker 半态」）。
 *
 * ── 契约来源 ──
 * - 任务简报 AC1 第一条：「Host 的 namespace 数据删除工作流同步触发诊断日志删除，清理
 *   active locator、stream manifests、JSONL/BIN、deletion markers 与 adapter indexes，
 *   同时只承诺活跃存储的逻辑删除而不暗示 secure erase」。
 * - ADR-0014-LOG §Retention 与删除 L299（「Host 执行数据删除请求时必须同时调用日志删除
 *   能力」——#155 前置冲突报告显式顺延至本票）、L289-295（.deleting/marker/启动收尾/
 *   orphan 协议）。被调能力 `deleteNamespaceDiagnosticLog` 已由 #154 交付（package 级，
 *   词汇 deleted/absent、重入收敛、INV-12 租约分区释放）。
 * - SA8 边界：B1（Host 数据删除工作流现为空白面；扩展冻结 v1 公共接口须显式 ADR 修订节
 *   备案——落点选择归 SA1 首要架构决策）、B2（同步联动失败语义与重入收敛、`delete…`
 *   同步重 fs 操作在 write sequencer slot 外）、B3（文档措辞纪律，本契约无文档面）。
 *
 * ── 表面（经 SA1 设计 + SA2/SA8 仲裁批准，PROPOSAL 原名原形零修订）──
 * 1. Host 控制通道新增 op `delete-namespace`，参数 `{ namespaceId }`；数据删除的持久
 *    层 seam = Registry `deleteNamespace` + Persistence `deleteDoc`（B1 显式 ADR
 *    修订节 0006/0009 备案）；本契约只钉**可观察结局**，不钉内部 seam。
 * 2. 回执语义红线：
 *    - 成功 ack（`ok:true`）⇒ **同一回执周期内**（同步窗口，无轮询等待）该 namespace 的
 *      数据（file persistence snapshot）与诊断日志（locator/manifests/JSONL/BIN/deletion
 *      marker/adapter indexes 全在 `{logRoot}/namespaces/{namespaceId}` 目录树内）完成
 *      逻辑删除——目录整体 absent；
 *    - 重复 delete（已删除/从不存在的日志面）幂等收敛（package #154 语义：deleted/absent
 *      二值重入；Host tombstone 过 known-set 门）；
 *    - 非法 namespaceId → `invalid-op-args`（镜像 read/verify-write 参数门）且零文件触达；
 *    - 删除后进程重启：不复活已删日志/数据、进程健康（无崩溃、ready 照常）。
 *
 * ── 红灯纪律（保留）──
 * - 全部断言 = 可观察运行时行为（NDJSON 回执、真实文件产物、进程生命周期）；零源码 grep、
 *   零 skip/软兜底；前置条件（日志/快照就绪）用 expect.poll 让出事件循环等待真实落盘。
 * - 测试文件零新增静态 import（不依赖尚未存在的导出）——红灯只来自运行时缺失面。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// 通用夹具（进程 E2E 原语：沿用 issue #155 红灯套件同款）
// ─────────────────────────────────────────────────────────────────────────────

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
  const id = `sa6-228-${++opCounter}`;
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
// Host 配置 / 磁盘布局辅助（ADR-0014-LOG：{logRoot}/namespaces/{namespaceId}/…；
// ADR-0006 数据面：{persistRoot}/users/{userId}/{namespaceId}.snapshot）
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
    },
    diagnostics: { enabled: true, rootDir: opts.logRootDir, updateCapture: true, inputPolicy: 'digest' },
  };
}

function namespaceLogDir(logRootDir: string, namespaceId: string): string {
  return join(logRootDir, 'namespaces', namespaceId);
}

function currentStreamId(logRootDir: string, namespaceId: string): string | null {
  const file = join(namespaceLogDir(logRootDir, namespaceId), 'current.json');
  if (!existsSync(file)) return null;
  const locator = JSON.parse(readFileSync(file, 'utf8')) as { streamId?: unknown };
  return typeof locator.streamId === 'string' ? locator.streamId : null;
}

/** 真实落盘快照路径集合（不钉文件名形状——只钉「删除前存在的快照删除后全部消失」）。 */
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

/** 就绪等待：provisioned + ready 事件。返回 provision 产出的 namespaceId。 */
async function bootHub(persistRoot: string, logRoot: string, what: string): Promise<{ proc: Proc; namespaceId: string }> {
  const port = await freePort();
  const config = hubConfig({ persistRoot, logRootDir: logRoot, port });
  const proc = spawnApp(['--config', writeConfig(makeTmpDir(`sa6-228-${what}-cfg-`), config)]);
  const provisioned = await waitForEvent(proc, (e) => e.event === 'provisioned', 60_000, `${what} provisioned`);
  const namespaceId = provisioned.namespaceId as string;
  expect(namespaceId).toMatch(/^ns-[0-9a-f]{32}$/);
  await waitForEvent(proc, (e) => e.event === 'ready', 60_000, `${what} ready`);
  return { proc, namespaceId };
}

/** 前置条件：诊断日志已建流落盘（locator + stream + 至少 genesis 段）。 */
async function expectLogsEstablished(logRoot: string, namespaceId: string, what: string): Promise<void> {
  await expect
    .poll(
      () => {
        const sid = currentStreamId(logRoot, namespaceId);
        if (sid === null) return false;
        const segments = join(namespaceLogDir(logRoot, namespaceId), 'streams', sid, 'segments');
        if (!existsSync(segments)) return false;
        return readdirSync(segments).some((name) => name.endsWith('.jsonl'));
      },
      { interval: 20, timeout: 5_000 },
    )
    .toBe(true);
  expect(currentStreamId(logRoot, namespaceId), `${what}: log current.json 必须存在`).not.toBeNull();
}

/** 前置条件：数据快照已落盘。 */
async function expectSnapshotPresent(persistRoot: string, what: string): Promise<string[]> {
  let paths: string[] = [];
  await expect
    .poll(
      () => {
        paths = snapshotPathsOf(persistRoot);
        return paths.length > 0;
      },
      { interval: 20, timeout: 5_000 },
    )
    .toBe(true);
  expect(paths.length, `${what}: 至少一个持久化快照`).toBeGreaterThan(0);
  return paths;
}

// ─────────────────────────────────────────────────────────────────────────────
// AC1 契约 — Host namespace 数据删除 ⇄ 诊断日志逻辑删除（PROPOSAL op `delete-namespace`）
// ─────────────────────────────────────────────────────────────────────────────

describe('issue #228 — Host namespace 数据删除 ⇄ 诊断日志逻辑删除联动（AC1；PROPOSAL op `delete-namespace`）', () => {
  it('D1 同步联动：delete-namespace ack(ok:true) 后同一周期内数据快照与诊断日志（locator/manifests/JSONL/BIN/marker/indexes 所在目录树）逻辑删除完成，进程干净停机', async () => {
    const persistRoot = makeTmpDir('sa6-228-d1-persist-');
    const logRoot = makeTmpDir('sa6-228-d1-log-');
    const { proc, namespaceId } = await bootHub(persistRoot, logRoot, 'd1');
    await expectLogsEstablished(logRoot, namespaceId, 'D1');
    const snapshotPaths = await expectSnapshotPresent(persistRoot, 'D1');

    // 红灯锚：今日 dispatch 无 delete-namespace → 回执 ok:false/code:unknown-op
    const reply = await sendOp(proc, { op: 'delete-namespace', namespaceId }, 30_000);
    expect(reply.ok, `delete-namespace 回执（今日: ${JSON.stringify(reply)}）`).toBe(true);

    // 同步窗口（无 poll）：ack 之后、同一回执周期内日志目录树与全部快照已逻辑删除。
    expect(existsSync(namespaceLogDir(logRoot, namespaceId)), '诊断日志目录树必须已删除').toBe(false);
    for (const snapshot of snapshotPaths) {
      expect(existsSync(snapshot), `数据快照 ${snapshot} 必须已删除`).toBe(false);
    }

    await signalAndExpectExit(proc, 'SIGTERM', 30_000, 0, 'hub D1');
  }, 300_000);

  it('D2 幂等收敛：已删除 namespace 二次 delete-namespace 仍回执 ok:true（重入无失败、目录保持 absent）', async () => {
    const persistRoot = makeTmpDir('sa6-228-d2-persist-');
    const logRoot = makeTmpDir('sa6-228-d2-log-');
    const { proc, namespaceId } = await bootHub(persistRoot, logRoot, 'd2');
    await expectLogsEstablished(logRoot, namespaceId, 'D2');
    await expectSnapshotPresent(persistRoot, 'D2');

    const first = await sendOp(proc, { op: 'delete-namespace', namespaceId }, 30_000);
    expect(first.ok, `首次 delete 回执（今日: ${JSON.stringify(first)}）`).toBe(true);
    const second = await sendOp(proc, { op: 'delete-namespace', namespaceId }, 30_000);
    expect(second.ok, `二次 delete 回执必须幂等 ok（今日: ${JSON.stringify(second)}）`).toBe(true);
    expect(existsSync(namespaceLogDir(logRoot, namespaceId))).toBe(false);

    await signalAndExpectExit(proc, 'SIGTERM', 30_000, 0, 'hub D2');
  }, 300_000);

  it('D3 参数门：非法 namespaceId → ok:false/code:invalid-op-args，进程不退出', async () => {
    const persistRoot = makeTmpDir('sa6-228-d3-persist-');
    const logRoot = makeTmpDir('sa6-228-d3-log-');
    const { proc } = await bootHub(persistRoot, logRoot, 'd3');

    const reply = await sendOp(proc, { op: 'delete-namespace', namespaceId: 'not-a-namespace-id' }, 30_000);
    expect(reply.ok, `非法 id 必须拒绝（今日: ${JSON.stringify(reply)}）`).toBe(false);
    expect(reply.code, '非法 id 拒绝码').toBe('invalid-op-args');
    expect(proc.exitCode, '进程必须存活').toBeNull();

    await signalAndExpectExit(proc, 'SIGTERM', 30_000, 0, 'hub D3');
  }, 300_000);

  it('D4 重启不复活已删流：delete ack 后进程重启健康 ready；重启重建（provision 语义）只产生全新 generation——已删旧 stream/快照绝不复活（无 stale 复活、无 deletion marker 残留面）', async () => {
    const persistRoot = makeTmpDir('sa6-228-d4-persist-');
    const logRoot = makeTmpDir('sa6-228-d4-log-');
    const { proc, namespaceId } = await bootHub(persistRoot, logRoot, 'd4');
    await expectLogsEstablished(logRoot, namespaceId, 'D4');
    await expectSnapshotPresent(persistRoot, 'D4');
    const oldStreamId = currentStreamId(logRoot, namespaceId) as string;
    const oldStreamDir = join(namespaceLogDir(logRoot, namespaceId), 'streams', oldStreamId);

    const reply = await sendOp(proc, { op: 'delete-namespace', namespaceId }, 30_000);
    expect(reply.ok, `delete 回执（今日: ${JSON.stringify(reply)}）`).toBe(true);
    expect(existsSync(oldStreamDir), '已删 stream 目录必须缺席').toBe(false);
    await signalAndExpectExit(proc, 'SIGTERM', 30_000, 0, 'hub D4 first boot');

    // 【仲裁注记（SA3 implementation round，issue #228）】原红灯契约断言「重启后
    // namespaceId 确定性派生 .toBe(namespaceId)」。实测与设计 R-1 冲突：删除是终态，
    // persistRoot 无旧 generation 可恢复——重启同 provision 只会**新建** generation
    // （新 namespace、新流、新身份；设计 R-1 逐字语义），而「确定性派生」仅适用于
    // 「数据仍在 + 直引 authorization 恢复」的重启形态（E5/T6 先例——该先例第二
    // boot 从不带 provision、也不断言 provisioned 相等）。物理上不存在任何删除实现
    // 能使 CSPRNG 生成的第二次 provision id 等于已删 id。据此按设计 R-1 修订断言：
    // 重启健康 + 重建为新 identity + 已删旧 generation 零复活 + 无半态 marker 残留
    // （D4 的语义红线「重启不复活、进程健康、无 marker 半态」零改动）。
    // 【SA6 追认轮（acceptance-contract iteration 1）】本仲裁已由 SA6 独立追认
    // approve（`wiki/raw/task_228_sa6_f1_ratification.md`；档案 D4 行随批修正）。
    const proc2 = await bootHub(persistRoot, logRoot, 'd4-second');
    expect(proc2.namespaceId, '重建 namespaceId 必须合规').toMatch(/^ns-[0-9a-f]{32}$/);
    expect(proc2.namespaceId, 'provision 重建 = 新 namespace 新身份（设计 R-1）').not.toBe(namespaceId);
    // 已删旧 generation 零复活：旧日志目录树与旧 stream 目录保持缺席
    expect(existsSync(namespaceLogDir(logRoot, namespaceId)), '已删旧日志目录树必须保持缺席（不复活）').toBe(false);
    expect(existsSync(oldStreamDir), '重启后已删旧 stream 目录必须保持缺席（不复活）').toBe(false);
    // 重建（provision 语义）走全新流：全新日志树、locator 指向新 stream、无
    // deletion.json 半态残留（marker 随旧树消失——新树从零开始）
    await expectLogsEstablished(logRoot, proc2.namespaceId, 'D4 rebuilt');
    const rebuiltStreamId = currentStreamId(logRoot, proc2.namespaceId) as string;
    expect(rebuiltStreamId, '重建 locator 必须指向新流（绝不复用已删旧流）').not.toBe(oldStreamId);
    expect(
      existsSync(join(namespaceLogDir(logRoot, proc2.namespaceId), 'deletion.json')),
      '重建后不得残留 deletion.json 半态标记',
    ).toBe(false);
    // 【环境注记（SA3 implementation round）】tsx CLI wrapper 对「ready 后 ~600ms
    // 窗口内到达的 SIGTERM」存在自身 choreography 竞态（直接 signal 应用子进程则
    // 恒优雅 exit 0——与诊断/删除实现无关的既有 wrapper 行为；diag 启用的 hub 在
    // ready 后仍有泵 drain 活动，D1–D3 均在 ≥600ms 后停机故不受影响）。第二 boot
    // 在此窗口内停机会得 143——给有界 settle 再停机（进程健康性断言语义不变）。
    await sleep(1_500);
    await signalAndExpectExit(proc2.proc, 'SIGTERM', 30_000, 0, 'hub D4 second boot');
  }, 300_000);
});
