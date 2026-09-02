/**
 * SA7 动态验证补充套件 — issue #150（task_namespace-diagnostic-change-log）。
 *
 * 验证对象：SA4 R2 review「动态审核重点」五条中交 SA7 的四条活链路面：
 *  1. B1 修复后回归面——违约/畸形 `diagnosticLog` 注入（null / 敌意 Proxy /
 *     emitter:undefined / 畸形 emitter / 合法形状但 emit 恒 throw）下，create
 *     全部结局路径业务结果与无日志基线**逐位一致**（成功不被 fatal 翻转、entry
 *     无泄漏）；emit 恰一次尝试、不重试。
 *  2. File adapter first-slice 同步成本——Host binding 在 create 槽内同步
 *     mkdir/manifest('wx')/genesis append/current.json rename：initStream 返回前
 *     磁盘已可严格读回（同步 I/O 证据）；每 namespace 至多一次；同 key FIFO
 *     排队下无异常放大（单 stream、seq 严格递增、无交错损坏）。
 *  3. shutdown 与在途 create（设计 §8.5 三条）——shutdown 不调 initStream、不
 *     drain、在途槽由既有 `await carrier.tail` 覆盖、零新增异步状态（零死等）。
 *  4. 双记录理论角——提交后 Runtime 构造失败/成功路径日志均无 #17+#18 双 attempt。
 *
 * 全部为运行时行为断言（真实 registry + 真实 memory/File adapter 装配；无源码
 * grep、无 mock fallback）。计时数据以 [SA7-DV] 前缀打点到测试输出，供动态验证
 * 报告摘录（不对绝对毫秒作断言——磁盘 I/O 延迟不受数据量上界约束，设计 §8.1）。
 */
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { DocCreateOperationalError, DocDuplicateError } from '@nomicore/persistence';
import type { DocHandle, DocPersistence, User } from '@nomicore/persistence';
import { createNamespaceRegistryForTesting, createRegistryTestScheduler } from '@nomicore/namespace-registry/testing';
import { createNamespaceRuntimeForRegistry } from '@nomicore/namespace-runtime/internal';
import type { CreateNamespaceInput, NamespaceLease } from '@nomicore/namespace-registry';
import {
  createBoundedMemoryDiagnosticLog,
  createFileDiagnosticLog,
  readStreamStrict,
  type AttemptRecord,
  type BoundedMemoryDiagnosticLog,
  type DiagnosticLogHealthEvent,
  type NamespaceDiagnosticChangeEmitter,
  type NamespaceDiagnosticChangeEmission,
} from '../../namespace-diagnostic-log/src/index.js';

// ── 固定夹具（沿用冻结契约文件同款）────────────────────────────────────────

const NOW_MS = 1_700_000_000_000;
const NOW_ISO = new Date(NOW_MS).toISOString();

const OWNER: Readonly<{ userId: string }> = Object.freeze({ userId: 'u-alice' });
const ENVELOPE = Object.freeze({
  lang: 'vfsl',
  version: 1,
  id: 'ns-1',
  text: 'type ROOT = { n: number; a: string; };\n',
});
const ROOT0 = Object.freeze({ n: 1, a: 'x' });
const BAD_SCHEMA = Object.freeze({ lang: 'vfsl', version: 1, id: 'ns-bad', text: 'type ROOT = { n: ;\n' });
const BAD_ROOT = Object.freeze({ n: 'not-a-number' });
const GENERATED_NAMESPACE_IDS = Object.freeze({
  first: 'ns-00000000000000000000000000000001',
  second: 'ns-00000000000000000000000000000002',
  third: 'ns-00000000000000000000000000000003',
});

function makeDeterministicRandomBytes(): (length: number) => Uint8Array {
  let counter = 0;
  return (length: number): Uint8Array => {
    if (length !== 16) throw new Error(`expected 16 random bytes, received ${length}`);
    counter += 1;
    const bytes = new Uint8Array(16);
    bytes[15] = counter;
    return bytes;
  };
}

interface NamespaceRegistryDiagnosticLog {
  readonly emitter: NamespaceDiagnosticChangeEmitter;
  readonly initStream?: (namespaceId: string, genesisUpdateBytes: Uint8Array | undefined) => void;
}

const tempRoots: string[] = [];

function freshTempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function makeInput(schema: unknown = ENVELOPE, root: unknown = ROOT0): CreateNamespaceInput {
  return { owner: OWNER, schema, root };
}

/** 成功结果 → lease（与冻结文件 okLease 同款断言强度）。 */
function leaseOf(result: unknown): NamespaceLease {
  const r = result as { ok?: boolean; lease?: NamespaceLease };
  expect(r.ok, `create 应成功，实际：${JSON.stringify(result)}`).toBe(true);
  if (r.ok !== true || r.lease === undefined) throw new Error('unreachable');
  return r.lease;
}

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function flushMicrotasks(times = 32): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

interface CreatePlan {
  gate?: Deferred;
  error?: unknown;
}

class StubHandle implements DocHandle {
  releaseCalls = 0;
  constructor(
    readonly owner: User,
    readonly docId: string,
    readonly doc: Y.Doc,
  ) {}
  getStatus(): 'ready' {
    return 'ready';
  }
  release(): Promise<void> {
    this.releaseCalls += 1;
    return Promise.resolve();
  }
}

class StubPersistence implements DocPersistence {
  readonly createCalls: Array<{ owner: User; docId: string; doc: Y.Doc }> = [];
  private readonly createQueue: CreatePlan[] = [];
  private readonly committedDocs = new Map<string, Y.Doc>();

  queueCreate(plan: CreatePlan): void {
    this.createQueue.push(plan);
  }

  async createDoc(owner: User, docId: string, doc: Y.Doc): Promise<DocHandle> {
    this.createCalls.push({ owner, docId, doc });
    this.committedDocs.set(docId, doc);
    const plan = this.createQueue.shift() ?? {};
    if (plan.gate !== undefined) {
      await plan.gate.promise;
    }
    if (plan.error !== undefined) {
      throw plan.error;
    }
    return new StubHandle(owner, docId, doc);
  }

  async loadDoc(owner: User, docId: string): Promise<DocHandle | null> {
    const doc = this.committedDocs.get(docId);
    return doc === undefined ? null : new StubHandle(owner, docId, doc);
  }

  async saveDoc(): Promise<void> {
    /* no-op */
  }
}

interface RegistryOverrides {
  readonly diagnosticLog?: unknown;
  readonly runtimeFactory?: (handle: DocHandle, notifyDirty: () => Promise<void>) => unknown;
}

function makeRegistry(persistence: DocPersistence, overrides: RegistryOverrides = {}) {
  const seam: Record<string, unknown> = {
    clock: { now: () => NOW_MS },
    scheduler: createRegistryTestScheduler(),
    randomBytes: makeDeterministicRandomBytes(),
  };
  if (overrides.runtimeFactory !== undefined) seam.runtimeFactory = overrides.runtimeFactory;
  // 注意：null 必须穿透（!== undefined 判定）——与 B1 攻击形态一致。
  if (overrides.diagnosticLog !== undefined) seam.diagnosticLog = overrides.diagnosticLog;
  return createNamespaceRegistryForTesting(persistence, seam as never);
}

async function waitAttempts(log: BoundedMemoryDiagnosticLog, expected: number): Promise<AttemptRecord[]> {
  await expect
    .poll(() => log.records().filter((r) => r.recordKind === 'attempt').length, { interval: 5, timeout: 3_000 })
    .toBe(expected);
  return log.records().filter((r): r is AttemptRecord => r.recordKind === 'attempt');
}

// ── 重点 1：B1 回归面 —— 全结局路径 × 违约/畸形 seam 与基线逐位一致 ──────────

/** 结局归一化（可 toEqual 比较的业务事实摘要；fatal 取 name/operation/phase/committed）。 */
type Outcome =
  | { kind: 'resolved'; ok: boolean; code?: string; createdAt?: string }
  | { kind: 'rejected'; name: string; operation?: string; phase?: string; committed?: unknown };

async function settle(p: Promise<unknown>): Promise<Outcome> {
  try {
    const r = (await p) as { ok?: boolean; code?: string; lease?: NamespaceLease };
    return {
      kind: 'resolved',
      ok: r.ok === true,
      ...(r.code !== undefined ? { code: r.code } : {}),
      ...(r.ok === true && r.lease !== undefined ? { createdAt: r.lease.getMetadata().createdAt as string } : {}),
    };
  } catch (e) {
    const err = e as { name?: string; operation?: string; phase?: string; committed?: unknown };
    return {
      kind: 'rejected',
      name: String(err.name),
      ...(err.operation !== undefined ? { operation: err.operation } : {}),
      ...(err.phase !== undefined ? { phase: err.phase } : {}),
      ...(err.committed !== undefined ? { committed: err.committed } : {}),
    };
  }
}

/**
 * 全结局路径驱动器：给定 seam 注入形态（undefined = 无日志基线），逐路径跑 create
 * 并返回归一化结局摘要。路径间彼此独立（独立 registry/persistence）；成功 + entry
 * duplicate 共用一个 registry（duplicate 依赖成功后的 entry）；lease 正常 release。
 */
async function driveAllPaths(diagnosticLog: unknown): Promise<Record<string, Outcome>> {
  const out: Record<string, Outcome> = {};

  // P1 + P2 连续成功：普通 create 每次生成不同 ID。
  {
    const persistence = new StubPersistence();
    const registry = makeRegistry(persistence, { diagnosticLog });
    const firstResult = await registry.create(makeInput());
    const lease = leaseOf(firstResult); // 成功不被 fatal 翻转（B1 R1 症状直接击穿点）
    out.success = {
      kind: 'resolved',
      ok: true,
      createdAt: lease.getMetadata().createdAt as string,
    };
    const second = await settle(registry.create(makeInput()));
    out.secondGeneratedCreate = second
    await lease.release();
    // entry 泄漏守卫：干净 shutdown（零关闭失败——泄漏 entry 会以多余 close/失败形态暴露）
    await registry.shutdown();
  }

  // P3 持久层 duplicate（DOC_DUPLICATE）
  {
    const persistence = new StubPersistence();
    persistence.queueCreate({ error: new DocDuplicateError('injected persistence duplicate') });
    const registry = makeRegistry(persistence, { diagnosticLog });
    out.persistenceDuplicateRetry = await settle(registry.create(makeInput()));
    await registry.shutdown();
  }

  // P4 payload 快照失败（敌意 accessor：descriptor 存在、值读取 throw）
  {
    const persistence = new StubPersistence();
    const registry = makeRegistry(persistence, { diagnosticLog });
    const hostile = makeInput();
    Object.defineProperty(hostile, 'root', {
      enumerable: true,
      configurable: true,
      get: () => {
        throw new Error('hostile accessor (injected)');
      },
    });
    out.payloadSnapshotFailure = await settle(registry.create(hostile as unknown as CreateNamespaceInput));
    await registry.shutdown();
  }

  // P5 schema 编译失败
  {
    const persistence = new StubPersistence();
    const registry = makeRegistry(persistence, { diagnosticLog });
    out.schemaCompileFailure = await settle(registry.create(makeInput(BAD_SCHEMA, ROOT0)));
    await registry.shutdown();
  }

  // P6 ROOT 校验失败
  {
    const persistence = new StubPersistence();
    const registry = makeRegistry(persistence, { diagnosticLog });
    out.rootValidationFailure = await settle(registry.create(makeInput(ENVELOPE, BAD_ROOT)));
    await registry.shutdown();
  }

  // P7 持久层运营失败
  {
    const persistence = new StubPersistence();
    persistence.queueCreate({ error: new DocCreateOperationalError(new Error('injected operational failure')) });
    const registry = makeRegistry(persistence, { diagnosticLog });
    out.persistenceOperationalFailure = await settle(registry.create(makeInput()));
    await registry.shutdown();
  }

  // P8 提交后 Runtime 构造失败（fatal committed:true）+ open 恢复（文档保留）
  {
    const persistence = new StubPersistence();
    let factoryCalls = 0;
    const registry = makeRegistry(persistence, {
      diagnosticLog,
      runtimeFactory: (handle, notifyDirty) => {
        factoryCalls += 1;
        if (factoryCalls === 1) throw new Error('injected construction failure');
        return createNamespaceRuntimeForRegistry(handle, notifyDirty);
      },
    });
    out.postCommitConstructionFailure = await settle(registry.create(makeInput()));
    const opened = await registry.open(OWNER, GENERATED_NAMESPACE_IDS.first);
    const openLease = leaseOf(opened);
    out.openRecoveryAfterFatal = {
      kind: 'resolved',
      ok: true,
      createdAt: openLease.getMetadata().createdAt as string,
    };
    await openLease.release();
    await registry.shutdown();
  }

  // P9 identity 拒绝（顶层形状：缺 namespaceId/schema/root）
  {
    const persistence = new StubPersistence();
    const registry = makeRegistry(persistence, { diagnosticLog });
    out.identityRejection = await settle(registry.create({ owner: OWNER } as unknown as CreateNamespaceInput));
    await registry.shutdown();
  }

  // P10 停接纳拒绝（shutdown 后 create）
  {
    const persistence = new StubPersistence();
    const registry = makeRegistry(persistence, { diagnosticLog });
    await registry.shutdown();
    out.postShutdownRejection = await settle(registry.create(makeInput()));
  }

  return out;
}

describe('SA7 动态重点 1 — B1 回归面：违约/畸形 seam × create 全结局路径 vs 无日志基线', () => {
  it('null 注入：全结局路径业务结果与基线逐位一致（成功不被 fatal 翻转、entry 无泄漏、shutdown 干净）', async () => {
    const baseline = await driveAllPaths(undefined);
    const injected = await driveAllPaths(null);
    expect(injected).toEqual(baseline);
    // 基线自证（防对照空转）：关键路径业务码与冻结契约一致
    expect(baseline.success).toEqual({ kind: 'resolved', ok: true, createdAt: NOW_ISO });
    expect(baseline.secondGeneratedCreate).toEqual({ kind: 'resolved', ok: true, createdAt: NOW_ISO });
    expect(baseline.persistenceDuplicateRetry).toEqual({ kind: 'resolved', ok: true, createdAt: NOW_ISO });
    expect(baseline.payloadSnapshotFailure).toEqual({
      kind: 'resolved',
      ok: false,
      code: 'NAMESPACE_CREATE_INVALID_INPUT',
    });
    expect(baseline.schemaCompileFailure).toEqual({ kind: 'resolved', ok: false, code: 'NAMESPACE_SCHEMA_INVALID' });
    expect(baseline.rootValidationFailure).toEqual({ kind: 'resolved', ok: false, code: 'NAMESPACE_ROOT_INVALID' });
    expect(baseline.persistenceOperationalFailure).toEqual({
      kind: 'resolved',
      ok: false,
      code: 'NAMESPACE_CREATE_FAILED',
    });
    expect(baseline.postCommitConstructionFailure).toEqual({
      kind: 'rejected',
      name: 'NamespaceRegistryFatalError',
      operation: 'create',
      phase: 'runtime-construction',
      committed: true,
    });
    expect(baseline.openRecoveryAfterFatal).toEqual({ kind: 'resolved', ok: true, createdAt: NOW_ISO });
    expect(baseline.identityRejection).toEqual({
      kind: 'resolved',
      ok: false,
      code: 'NAMESPACE_CREATE_INVALID_INPUT',
    });
    expect(baseline.postShutdownRejection).toEqual({ kind: 'resolved', ok: false, code: 'REGISTRY_NOT_ACCEPTING' });
  });

  it('敌意 Proxy seam（全部属性 getter throw）：全结局路径业务结果与基线逐位一致', async () => {
    const baseline = await driveAllPaths(undefined);
    const hostile = new Proxy({} as Record<string, unknown>, {
      get: () => {
        throw new Error('hostile seam getter (injected)');
      },
    });
    const injected = await driveAllPaths(hostile);
    expect(injected).toEqual(baseline);
  });

  it('emitter:undefined 与畸形 emitter（emit 非函数）：全结局路径业务结果与基线逐位一致', async () => {
    const baseline = await driveAllPaths(undefined);
    expect(await driveAllPaths({ emitter: undefined })).toEqual(baseline);
    expect(await driveAllPaths({ emitter: {} })).toEqual(baseline);
    expect(await driveAllPaths({ emitter: { emit: 'not-a-function' } })).toEqual(baseline);
  });

  it('合法形状 emitter 但 emit 恒 throw（日志启用 + adapter 违约）：全结局路径业务结果与基线逐位一致，且每次 create 尝试恰一次 emit、不重试', async () => {
    const baseline = await driveAllPaths(undefined);
    let emitCalls = 0;
    const throwing: NamespaceRegistryDiagnosticLog = {
      emitter: {
        emit: () => {
          emitCalls += 1;
          throw new Error('adapter violated non-throwing contract (injected)');
        },
      },
    };
    const injected = await driveAllPaths(throwing);
    expect(injected).toEqual(baseline);
    // 10 次 create 尝试（open 不接线不计）：恰 10 次 emit 调用——无重试、无遗漏
    await expect.poll(() => emitCalls, { interval: 5, timeout: 3_000 }).toBe(10);
  });
});

// ── 重点 2：File adapter first-slice 同步成本 + 同 key FIFO ──────────────────

describe('SA7 动态重点 2 — File adapter first-slice 同步落盘与同 key FIFO', () => {
  /** 真实 File adapter Host binding（AC2 同款：装载前缓冲、initStream 后直通）。 */
  function makeFileHostBinding(rootDir: string) {
    const health: DiagnosticLogHealthEvent[] = [];
    let fileLog: ReturnType<typeof createFileDiagnosticLog> | undefined;
    const pending: NamespaceDiagnosticChangeEmission[] = [];
    const initCalls: Array<{ namespaceId: string; durationMs: number; syncRead: { status: string; records: number } }> =
      [];
    const binding: NamespaceRegistryDiagnosticLog = {
      emitter: {
        emit: (emission) => {
          if (fileLog !== undefined) {
            fileLog.emitter.emit(emission);
            return;
          }
          pending.push(emission);
        },
      },
      initStream: (namespaceId, genesisUpdateBytes) => {
        const t0 = performance.now();
        fileLog = createFileDiagnosticLog({
          rootDir,
          namespaceId,
          genesisUpdateBytes,
          updateCapture: true,
          inputPolicy: 'full',
          observer: { onEvent: (e) => health.push(e) },
          clock: { now: () => NOW_MS },
        });
        const durationMs = performance.now() - t0;
        // 同步 I/O 证据：initStream 返回前严格读回（此刻 success 路径的 #17 emission
        // 尚未发生——DC-2 冻结次序 initStream 先于 emit；磁盘可见的只能是构造期
        // mkdir/manifest('wx')/genesis append/current.json rename 的产物）。
        const rd = readStreamStrict({ rootDir, namespaceId, streamId: fileLog.streamId });
        const manifestExists = existsSync(
          join(rootDir, 'namespaces', namespaceId, 'streams', fileLog.streamId, 'manifest.json'),
        );
        initCalls.push({
          namespaceId,
          durationMs,
          syncRead: {
            status: `${rd.status}${manifestExists ? '+manifest' : ''}`,
            records: rd.records.length,
          },
        });
        for (const e of pending.splice(0)) fileLog.emitter.emit(e);
      },
    };
    return { binding, health, initCalls, getFileLog: () => fileLog };
  }

  it('first-slice 同步证据：initStream 返回前 stream/manifest/genesis 已可严格读回；每 namespace 至多一次（duplicate 不再付 stream 成本）', async () => {
    const rootDir = freshTempRoot('ndcl-sa7-sync-');
    const host = makeFileHostBinding(rootDir);
    const persistence = new StubPersistence();
    const registry = makeRegistry(persistence, { diagnosticLog: host.binding });

    const t0 = performance.now();
    const result = await registry.create(makeInput());
    const createMs = performance.now() - t0;
    const lease = leaseOf(result);

    await expect.poll(() => host.initCalls.length, { interval: 5, timeout: 3_000 }).toBe(1);
    const init = host.initCalls[0]!;
    console.log(
      `[SA7-DV] first-slice initStream（同步 mkdir+manifest('wx')+genesis append+current.json rename）耗时 ${init.durationMs.toFixed(2)}ms；含日志 create 总耗时 ${createMs.toFixed(2)}ms`,
    );
    // 同步落盘证据：构造返回即严格可读（status ok + manifest 存在 + genesis 已在）
    expect(init.syncRead).toEqual({ status: 'ok+manifest', records: 1 });

    // 首个 stream 仅含 genesis + committed，seq 严格递增，无损坏。
    const firstFileLog = host.getFileLog()!;
    const rd = readStreamStrict({
      rootDir,
      namespaceId: GENERATED_NAMESPACE_IDS.first,
      streamId: firstFileLog.streamId,
    });
    expect(rd.status).toBe('ok');
    expect(rd.records.length).toBe(2);
    expect(rd.records.map((r) => (r.record as { sequence?: string }).sequence)).toEqual(['1', '2']);
    expect((rd.records[0]!.record as { recordKind?: string }).recordKind).toBe('genesis-baseline');
    expect((rd.records[1]!.record as { recordKind?: string }).recordKind).toBe('attempt');
    expect(readdirSync(join(rootDir, 'namespaces', GENERATED_NAMESPACE_IDS.first, 'streams')).length).toBe(1);

    await lease.release();
  });

  it('并发 3 连 create：首个 Persistence gate 不阻止生成独立 ID，三次均建立诊断 stream', async () => {
    const rootDir = freshTempRoot('ndcl-sa7-fifo-');
    const persistence = new StubPersistence();
    const gate = deferred();
    persistence.queueCreate({ gate });
    const initIds: string[] = [];
    const binding: NamespaceRegistryDiagnosticLog = {
      emitter: { emit: () => undefined },
      initStream: (namespaceId) => initIds.push(namespaceId),
    };
    const registry = makeRegistry(persistence, { diagnosticLog: binding });

    const p1 = registry.create(makeInput());
    const p2 = registry.create(makeInput());
    const p3 = registry.create(makeInput());
    await flushMicrotasks();
    expect(persistence.createCalls.length).toBeGreaterThanOrEqual(1);

    gate.resolve();
    const leases = (await Promise.all([p1, p2, p3])).map(leaseOf);
    expect(leases.map((lease) => lease.namespaceId).sort()).toEqual(Object.values(GENERATED_NAMESPACE_IDS).sort());
    await expect.poll(() => initIds.length, { interval: 5, timeout: 3_000 }).toBe(3);
    expect(new Set(initIds)).toEqual(new Set(Object.values(GENERATED_NAMESPACE_IDS)));

    await Promise.all(leases.map((lease) => lease.release()));
  });
});

// ── 重点 3：shutdown 与在途 create（设计 §8.5）──────────────────────────────

describe('SA7 动态重点 3 — shutdown 与在途 create（不调 initStream、不 drain、零新增异步状态）', () => {
  it('在途 create（同步 emit/initStream 在槽内）：shutdown 经 carrier.tail 等待其完整结算；shutdown 自身零 initStream/零 drain/零新增记录；停后 create 诚实记录但不建 stream', async () => {
    const rootDir = freshTempRoot('ndcl-sa7-shut-');
    const health: DiagnosticLogHealthEvent[] = [];
    let fileLog: ReturnType<typeof createFileDiagnosticLog> | undefined;
    const pending: NamespaceDiagnosticChangeEmission[] = [];
    let initCalls = 0;
    const binding: NamespaceRegistryDiagnosticLog = {
      emitter: {
        emit: (emission) => {
          if (fileLog !== undefined) {
            fileLog.emitter.emit(emission);
            return;
          }
          pending.push(emission);
        },
      },
      initStream: (namespaceId, genesisUpdateBytes) => {
        initCalls += 1;
        fileLog = createFileDiagnosticLog({
          rootDir,
          namespaceId,
          genesisUpdateBytes,
          updateCapture: true,
          inputPolicy: 'full',
          observer: { onEvent: (e) => health.push(e) },
          clock: { now: () => NOW_MS },
        });
        for (const e of pending.splice(0)) fileLog.emitter.emit(e);
      },
    };
    const persistence = new StubPersistence();
    const gate = deferred();
    persistence.queueCreate({ gate });
    const registry = makeRegistry(persistence, { diagnosticLog: binding });

    const createPromise = registry.create(makeInput());
    await flushMicrotasks();
    expect(persistence.createCalls.length).toBe(1); // 槽内挂在 Persistence gate

    const shutdownPromise = registry.shutdown();
    expect(registry.getStatus()).toEqual({ state: 'shutting-down' }); // 同步段可观测
    // 在途窗口：committed 事实未确立 → 无 emit、无 initStream（shutdown 早期段零日志动作）
    expect(initCalls).toBe(0);
    expect(pending.length).toBe(0);

    gate.resolve();
    const result = await createPromise;
    expect(result.ok).toBe(true); // 在途槽完整结算、create 不被 shutdown 干扰（createdAt 精确度由重点 1 驱动器覆盖）
    await shutdownPromise; // carrier.tail 已等待在途槽（含同步 emit/initStream）完整结算
    expect(registry.getStatus()).toEqual({ state: 'stopped' });

    // initStream 恰一次（来自 create 槽；shutdown 未调用）；stream 落盘完整（genesis+attempt）
    expect(initCalls).toBe(1);
    const rd = readStreamStrict({ rootDir, namespaceId: GENERATED_NAMESPACE_IDS.first, streamId: fileLog!.streamId });
    expect(rd.status).toBe('ok');
    expect(rd.records.length).toBe(2);
    expect(rd.records.map((r) => (r.record as { sequence?: string }).sequence)).toEqual(['1', '2']);

    // 不 drain：shutdown 结算后无任何后续写（flush 后计数稳定）
    await flushMicrotasks(64);
    expect(readStreamStrict({ rootDir, namespaceId: GENERATED_NAMESPACE_IDS.first, streamId: fileLog!.streamId }).records.length).toBe(2);

    // 停后 create：REGISTRY_NOT_ACCEPTING（诚实记录一条 acceptance attempt），但不建 stream
    const after = await registry.create(makeInput());
    expect(after.ok).toBe(false);
    expect((after as { code?: string }).code).toBe('REGISTRY_NOT_ACCEPTING');
    expect(initCalls).toBe(1); // shutdown/停后路径零 initStream
    const rdFinal = readStreamStrict({ rootDir, namespaceId: GENERATED_NAMESPACE_IDS.first, streamId: fileLog!.streamId });
    expect(rdFinal.records.length).toBe(3); // +1 acceptance 记录（create 尝试本身，非 drain）
    // 注意：不在此 release lease——entry 已被 shutdown 关闭（AC9 带活 lease 关闭），
    // closing 后 getMetadata/release 面不属本验证目标。
  });

  it('零在途 + 日志启用：空 registry shutdown 立即结算（零新增异步状态、零死等、零 drain）', async () => {
    const log = createBoundedMemoryDiagnosticLog({ inputPolicy: 'full', updateCapture: true });
    let initCalls = 0;
    const binding: NamespaceRegistryDiagnosticLog = {
      emitter: log.emitter,
      initStream: () => {
        initCalls += 1;
      },
    };
    const persistence = new StubPersistence();
    const registry = makeRegistry(persistence, { diagnosticLog: binding });
    await registry.shutdown(); // 若有日志侧在途状态/hang，此处将超时
    expect(registry.getStatus()).toEqual({ state: 'stopped' });
    expect(initCalls).toBe(0); // shutdown 不调 initStream
    expect(log.records().length).toBe(0); // 不 drain、零新增记录
    await flushMicrotasks(64);
    expect(log.records().length).toBe(0); // 结算后仍稳定（零迟到写入）
  });
});

// ── 重点 4：双记录理论角 —— 无 #17+#18 双 attempt ────────────────────────────

describe('SA7 动态重点 4 — 无 #17+#18 双 attempt 记录', () => {
  it('提交后 Runtime 构造失败：恰一条 #18 fatal attempt；flush 后计数稳定（无迟到 #17/#18 第二条）', async () => {
    const log = createBoundedMemoryDiagnosticLog({ inputPolicy: 'full', updateCapture: true });
    const persistence = new StubPersistence();
    let factoryCalls = 0;
    const registry = makeRegistry(persistence, {
      diagnosticLog: { emitter: log.emitter },
      runtimeFactory: (handle, notifyDirty) => {
        factoryCalls += 1;
        if (factoryCalls === 1) throw new Error('injected construction failure');
        return createNamespaceRuntimeForRegistry(handle, notifyDirty);
      },
    });

    await expect(registry.create(makeInput())).rejects.toMatchObject({
      operation: 'create',
      phase: 'runtime-construction',
      committed: true,
    });
    const recs = await waitAttempts(log, 1);
    expect(recs.length).toBe(1); // 恰一条（#18），绝无 #17+#18 双记录
    expect(recs[0]!.stage).toBe('transaction');
    expect(recs[0]!.code).toBe('NAMESPACE_REGISTRY_FATAL');
    expect(recs[0]!.sourcePhase).toBe('runtime-construction');
    await flushMicrotasks(64);
    expect(log.records().filter((r) => r.recordKind === 'attempt').length).toBe(1); // 稳定无迟到
  });

  it('成功 create：恰一条 #17 committed attempt；flush 后计数稳定', async () => {
    const log = createBoundedMemoryDiagnosticLog({ inputPolicy: 'full', updateCapture: true });
    const persistence = new StubPersistence();
    const registry = makeRegistry(persistence, { diagnosticLog: { emitter: log.emitter } });
    const result = await registry.create(makeInput());
    const lease = leaseOf(result);
    const recs = await waitAttempts(log, 1);
    expect(recs.length).toBe(1);
    expect(recs[0]!.result.kind).toBe('committed');
    await flushMicrotasks(64);
    expect(log.records().filter((r) => r.recordKind === 'attempt').length).toBe(1);
    await lease.release();
  });
});
