/**
 * SA1 复现红灯契约 — issue #226：创建诊断覆盖缺口与日志生命周期隔离
 * （wiki/raw/task_issue-226.md；SA8 clear + R5 复核维持）。
 *
 * 本文件是**复现证据**（可执行复现），不是修复实现：
 * - 缺口 A（覆盖，AC1）：建流前 create 早结局（input-snapshot / schema-compile /
 *   validation / Persistence 运营与 fatal / create-document-internal fatal）经
 *   `createCreateDiag` 构造期捕获的**共享 emitter** 发射；生产供应方
 *   （apps/yjs-server/src/diagnostics.ts `unattributedEmitter`）对该通道恒丢弃 +
 *   计数（`reason: 'unattributed'`）——这些结局被无归属通道**确定性丢弃**，且
 *   Registry 在发射时点已持有候选 namespaceId 却无数据键控通道可用。
 * - 缺口 B（隔离，AC3/AC4）：`initStream`（建流：mkdir/manifest/genesis/current.json
 *   /reopen 分析/retention sweep 全同步 fs）、`runtimeEmitterFor` 的 adapter 构造
 *   （reopen 健康证明/尾部修复/retention sweep）与 ns-bound `emit`（appendFileSync）
 *   全部位于 Registry lifecycle carrier 槽内（registry.ts `runCreateAttempt`/
 *   `runOpenSlot`）——慢或挂起的日志存储直接延长 create/open 结算与 shutdown 等待。
 *
 * Host binding 形状 = 生产供应方（diagnostics.ts）语义的测试内复刻：共享通道恒
 * 丢弃 + `runtimeEmitterFor(ns)` 数据键控解析 + `initStream(ns, bytes)` 建流。
 * seam 字段名（`diagnosticLog.emitter` / `initStream` / `runtimeEmitterFor`）为
 * #150/#155 冻结契约锚点，本文件不发明新字段。
 *
 * 红灯核心（当前 worktree，2026-09-05 验证）：
 * - T1–T6：早结局 emission 落无归属通道（ns 通道 0 条、丢弃计数 ≥1）→ 全红；
 * - T7：成功 create 与 post-commit runtime-construction fatal 已正确归属（GREEN
 *   对照——钉住缺口边界 = 「initStream 之前」的结局，证明数据键控通道本身可用）；
 * - T8–T10：create/open 结算与 shutdown 等待包含日志存储阻塞（顺序断言）→ 全红；
 * - T11：真实 File adapter E2E——被拒 create 零落盘（无 stream）→ 红；成功 create
 *   落盘（genesis + committed attempt）→ GREEN 对照。
 *
 * 2026-09-06 契约重新固话（SA8 design-conflict 裁决：R1/R2 阻断项随 SA6 落地）：
 * - R1（T8/T9/T10 顺序锚）：改「到达 poll + 顺序」——修复后日志 I/O 位于 macrotask
 *   级延迟投递中，结算标记 push 与断言之间是纯同步段、存储完成标记届时可能尚未
 *   到达（任意实现不可满足，SA1 §10.1 / SA8 C1）；先 poll 等存储完成标记出现
 *   （poll 让出事件循环 → drain 执行），再断言 indexOf(结算标记) <
 *   indexOf(存储完成标记)。修复前（槽内同步存储）标记先于结算标记 → 修订后仍红
 *   （§10.4 证明保持——顺序锚回到语义本体：结算不等待日志完成）。
 * - R2（T12/T13）：原 runtime 红契约两用例（慢同步 emitter 直注 Runtime 冻结 seam）
 *   在「Runtime 零生产改动 + #149 AC4 同步锚 emitCalls===2」设计下对任意实现不可
 *   满足（SA1 §10.2 / SA8 C2——同一 Runtime 代码不可同时满足）——迁入本文件，改经
 *   Registry 生产装配全链路注入（默认 runtimeFactory = createNamespaceRuntimeForRegistry
 *   + resolver 产出的 emitter，即 #226 修复的实际改动面；生产 wiring 同构），判据
 *   同 R1 形状（到达 poll + 顺序 + 墙钟旁证）。runtime-issue-226-red.test.ts 随之
 *   删除（Runtime 包零改动前提下其直注用例永不可翻绿）。
 * - Host 通道 emit 事件迹加通道内序号（emit:<ns>:<n>:start/end）：成功 create 的
 *   #17 committed = 通道第 1 条 emission，其后 runtime 写依序编号（T12/T13 顺序锚
 *   的静态判别基础——emit 序号与投递批次无关，poll 容忍合法延后）。
 */
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  DocCreateFatalError,
  DocCreateOperationalError,
} from '@nomicore/persistence';
import type { DocHandle, DocPersistence, User } from '@nomicore/persistence';
import { createNamespaceRegistryForTesting, createRegistryTestScheduler } from '@nomicore/namespace-registry/testing';
import type { CreateNamespaceInput, NamespaceLease } from '@nomicore/namespace-registry';
import {
  createFileDiagnosticLog,
  readStreamStrict,
  type NamespaceDiagnosticChangeEmission,
  type NamespaceDiagnosticChangeEmitter,
} from '../../namespace-diagnostic-log/src/index.js';

// ── 固定夹具（沿用 registry-create-diagnostic-red.test.ts 既有夹具）──────────

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
const NS_FIRST = 'ns-00000000000000000000000000000001';
const NS_SECOND = 'ns-00000000000000000000000000000002';

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

async function flushMicrotasks(times = 16): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

/** 确定性同步阻塞（模拟首切片 File adapter 同步 fs 延迟：appendFileSync /
 *  mkdir / manifest 'wx' / rename——ADR-0012 amendment 明示「有界」不含磁盘延迟
 *  上界，此处以受控毫秒数模拟慢存储；禁 real sleep 的测试纪律针对业务时序，
 *  存储延迟模拟是本复现的被测对象本身）。 */
function blockSync(ms: number): void {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// ── 可控 Persistence stub（沿用 registry-create-diagnostic-red.test.ts 先例，
//    增加进入信号以编排「create 已接纳、槽停在 createDoc」的窗口）────────────

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
  readonly committedDocs = new Map<string, Y.Doc>();
  private readonly createQueue: CreatePlan[] = [];
  /** 每次 createDoc 进入时 resolve（编排门控用）。 */
  readonly enteredCreate: Deferred[] = [];

  queueCreate(plan: CreatePlan): void {
    this.createQueue.push(plan);
  }

  async createDoc(owner: User, docId: string, doc: Y.Doc): Promise<DocHandle> {
    this.createCalls.push({ owner, docId, doc });
    this.committedDocs.set(docId, doc);
    this.enteredCreate.shift()?.resolve();
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
    /* 计数面非本复现关注点 */
  }
}

// ── 生产供应方形状的 Host binding（apps/yjs-server/src/diagnostics.ts 语义复刻）──

interface HostBindingOptions {
  /** initStream 建流同步 fs 延迟（模拟 mkdir/manifest/genesis/current.json/reopen/retention sweep）。 */
  readonly initStreamBlockMs?: number;
  /** ns-bound emit 同步 append 延迟（模拟 appendFileSync）。 */
  readonly emitBlockMs?: number;
  /** runtimeEmitterFor 首次解析（adapter 构造：reopen 健康证明/尾部修复/retention sweep）延迟。 */
  readonly ensureBlockMs?: number;
}

interface ProdShapedHost {
  readonly binding: {
    readonly emitter: NamespaceDiagnosticChangeEmitter;
    readonly initStream: (namespaceId: string, genesisUpdateBytes: Uint8Array | undefined) => void;
    readonly runtimeEmitterFor: (namespaceId: string) => NamespaceDiagnosticChangeEmitter | undefined;
  };
  /** 数据键控通道按 namespaceId 捕获的语义 emission（修复后早结局应到达此处）。 */
  readonly nsRecords: Map<string, NamespaceDiagnosticChangeEmission[]>;
  /** 无归属通道丢弃计数（生产：NDJSON `diagnostic-log-emission-dropped` reason=unattributed）。 */
  readonly unattributedDrops: number[];
  /** 有序事件迹（顺序断言载体：`initStream:<ns>:start/end`、`emit:<ns>:<n>:start/end`
   * （n = 通道内 emission 序号）、`ensure:<ns>:start/end`）。 */
  readonly events: string[];
}

function makeProductionShapedHost(options: HostBindingOptions = {}): ProdShapedHost {
  const nsRecords = new Map<string, NamespaceDiagnosticChangeEmission[]>();
  const unattributedDrops: number[] = [];
  const events: string[] = [];
  const emitters = new Map<string, NamespaceDiagnosticChangeEmitter>();

  const ensureChannel = (namespaceId: string): NamespaceDiagnosticChangeEmitter => {
    const cached = emitters.get(namespaceId);
    if (cached !== undefined) return cached;
    events.push(`ensure:${namespaceId}:start`);
    blockSync(options.ensureBlockMs ?? 0);
    let emitCount = 0;
    const emitter: NamespaceDiagnosticChangeEmitter = {
      emit: (emission) => {
        emitCount += 1;
        events.push(`emit:${namespaceId}:${emitCount}:start`);
        blockSync(options.emitBlockMs ?? 0);
        events.push(`emit:${namespaceId}:${emitCount}:end`);
        const list = nsRecords.get(namespaceId) ?? [];
        list.push(emission);
        nsRecords.set(namespaceId, list);
      },
    };
    emitters.set(namespaceId, emitter);
    events.push(`ensure:${namespaceId}:end`);
    return emitter;
  };

  return {
    binding: {
      // 生产语义（diagnostics.ts unattributedEmitter）：恒丢弃 + 计数，零路由。
      emitter: {
        emit: () => {
          unattributedDrops.push(1);
          events.push('emit:unattributed');
        },
      },
      initStream: (namespaceId, _genesisUpdateBytes) => {
        events.push(`initStream:${namespaceId}:start`);
        blockSync(options.initStreamBlockMs ?? 0);
        ensureChannel(namespaceId);
        events.push(`initStream:${namespaceId}:end`);
      },
      runtimeEmitterFor: (namespaceId) => ensureChannel(namespaceId),
    },
    nsRecords,
    unattributedDrops,
    events,
  };
}

// ── Registry 装配 helper ────────────────────────────────────────────────────

interface RegistryOverrides {
  readonly runtimeFactory?: (handle: DocHandle, notifyDirty: () => Promise<void>) => unknown;
  readonly createDocumentFactory?: (namespaceId: string, createdAt: string, schema: unknown, root: unknown) => unknown;
  readonly diagnosticLog?: ProdShapedHost['binding'];
}

function makeRegistry(
  persistence: DocPersistence,
  overrides: RegistryOverrides = {},
): ReturnType<typeof createNamespaceRegistryForTesting> {
  const seam: Record<string, unknown> = {
    clock: { now: () => NOW_MS },
    scheduler: createRegistryTestScheduler(),
    randomBytes: makeDeterministicRandomBytes(),
  };
  if (overrides.runtimeFactory !== undefined) seam.runtimeFactory = overrides.runtimeFactory;
  if (overrides.createDocumentFactory !== undefined) seam.createDocumentFactory = overrides.createDocumentFactory;
  if (overrides.diagnosticLog !== undefined) seam.diagnosticLog = overrides.diagnosticLog;
  return createNamespaceRegistryForTesting(persistence, seam as never);
}

function makeInput(schema: unknown = ENVELOPE, root: unknown = ROOT0): CreateNamespaceInput {
  return { owner: OWNER, schema, root };
}

function okLease(result: unknown): NamespaceLease {
  const r = result as { ok?: boolean; lease?: NamespaceLease };
  expect(r.ok, `create 应成功，实际：${JSON.stringify(result)}`).toBe(true);
  if (!r.ok || r.lease === undefined) throw new Error('unreachable');
  return r.lease;
}

/** 等待 namespace 归属通道出现至少 expected 条 attempt emission（修复后发射可合法延后——
 *  ADR-0011「emitter 不被 await」；poll 消除合法延后下的伪红）。 */
async function waitNsRecords(host: ProdShapedHost, namespaceId: string, expected: number): Promise<NamespaceDiagnosticChangeEmission[]> {
  await expect
    .poll(() => host.nsRecords.get(namespaceId)?.length ?? 0, { interval: 5, timeout: 1_000 })
    .toBe(expected);
  return host.nsRecords.get(namespaceId)!;
}

function emissionAt(list: NamespaceDiagnosticChangeEmission[], index = 0): NamespaceDiagnosticChangeEmission {
  const e = list[index];
  if (e === undefined) throw new Error(`emission #${index} 缺席（poll 已保证非空——不可达防御）`);
  return e;
}

// ── 测试主体 ────────────────────────────────────────────────────────────────

describe('#226 创建诊断覆盖缺口（SA1 复现红灯）', () => {
  it('T1 schema-compile 拒绝：结局应以候选 namespace 归属进入数据键控通道（当前被无归属通道丢弃）', async () => {
    const host = makeProductionShapedHost();
    const registry = makeRegistry(new StubPersistence(), { diagnosticLog: host.binding });

    const result = await registry.create(makeInput(BAD_SCHEMA, ROOT0));
    // 业务面闭环（GREEN 锚——隔离不受影响）：稳定窄 issue
    expect(result).toMatchObject({ ok: false, code: 'NAMESPACE_SCHEMA_INVALID' });
    await flushMicrotasks();

    // ── 红灯锚：早结局必须以候选 namespaceId（ns-…01）归属到达数据键控通道 ──
    const records = await waitNsRecords(host, NS_FIRST, 1);
    const e = emissionAt(records);
    expect(e.operation).toBe('namespace-create');
    expect(e.stage).toBe('schema-compile');
    expect(e.code).toBe('NAMESPACE_SCHEMA_INVALID');
    expect(e.result).toMatchObject({ kind: 'rejected' });
    expect(e.input).toMatchObject({ snapshot: { schema: BAD_SCHEMA, root: ROOT0 } });
    expect(e.observedAt).toBe(NOW_ISO); // 注入 Clock 同源（AC2：observedAt 不伪造）
    // 无归属通道不再接收该结局（生产供应方语义下 = 不再被丢弃计数）
    expect(host.unattributedDrops.length).toBe(0);
  });

  it('T2 validation 拒绝：结局应以候选 namespace 归属进入数据键控通道（当前被无归属通道丢弃）', async () => {
    const host = makeProductionShapedHost();
    const registry = makeRegistry(new StubPersistence(), { diagnosticLog: host.binding });

    const result = await registry.create(makeInput(ENVELOPE, BAD_ROOT));
    expect(result).toMatchObject({ ok: false, code: 'NAMESPACE_ROOT_INVALID' });
    await flushMicrotasks();

    const records = await waitNsRecords(host, NS_FIRST, 1);
    const e = emissionAt(records);
    expect(e.operation).toBe('namespace-create');
    expect(e.stage).toBe('validation');
    expect(e.code).toBe('NAMESPACE_ROOT_INVALID');
    expect(e.result).toMatchObject({ kind: 'rejected' });
  });

  it('T3 input-snapshot 失败：结局应以候选 namespace 归属进入数据键控通道（当前被无归属通道丢弃）', async () => {
    const host = makeProductionShapedHost();
    const registry = makeRegistry(new StubPersistence(), { diagnosticLog: host.binding });
    const cyclic: Record<string, unknown> = { lang: 'vfsl', version: 1, id: 'ns-c', text: 'x' };
    cyclic.self = cyclic; // cycle-safe 快照拒绝 → unsafe-input

    const result = await registry.create(makeInput(cyclic, ROOT0));
    expect(result).toMatchObject({ ok: false, code: 'NAMESPACE_CREATE_INVALID_INPUT' });
    await flushMicrotasks();

    const records = await waitNsRecords(host, NS_FIRST, 1);
    const e = emissionAt(records);
    expect(e.operation).toBe('namespace-create');
    expect(e.stage).toBe('input-snapshot');
    expect(e.code).toBe('NAMESPACE_CREATE_INVALID_INPUT');
    expect(e.result).toMatchObject({ kind: 'rejected' });
    expect(e.input).toMatchObject({ status: 'unsafe-input' }); // AC2：零回读敌意输入
  });

  it('T4 Persistence 运营失败：结局应以候选 namespace 归属进入数据键控通道（当前被无归属通道丢弃）', async () => {
    const persistence = new StubPersistence();
    persistence.queueCreate({ error: new DocCreateOperationalError(new Error('io write failed')) });
    const host = makeProductionShapedHost();
    const registry = makeRegistry(persistence, { diagnosticLog: host.binding });

    const result = await registry.create(makeInput());
    expect(result).toMatchObject({ ok: false, code: 'NAMESPACE_CREATE_FAILED' });
    await flushMicrotasks();

    const records = await waitNsRecords(host, NS_FIRST, 1);
    const e = emissionAt(records);
    expect(e.operation).toBe('namespace-create');
    expect(e.stage).toBe('transaction');
    expect(e.code).toBe('NAMESPACE_CREATE_FAILED');
    expect(e.result).toMatchObject({ kind: 'rejected' });
    expect(e.input).toMatchObject({ snapshot: { schema: ENVELOPE, root: ROOT0 } });
  });

  it('T5 Persistence fatal（post-commit，committed:true）：结局应以候选 namespace 归属进入数据键控通道并保留 committed 事实（当前被无归属通道丢弃）', async () => {
    const persistence = new StubPersistence();
    persistence.queueCreate({ error: new DocCreateFatalError('post-commit', new Error('post-commit-store')) });
    const host = makeProductionShapedHost();
    const registry = makeRegistry(persistence, { diagnosticLog: host.binding });

    await expect(registry.create(makeInput())).rejects.toMatchObject({
      code: 'NAMESPACE_REGISTRY_FATAL',
      operation: 'create',
      committed: true, // 业务 committed 事实不被日志缺口吞没（GREEN 锚）
    });
    await flushMicrotasks();

    const records = await waitNsRecords(host, NS_FIRST, 1);
    const e = emissionAt(records);
    expect(e.operation).toBe('namespace-create');
    expect(e.stage).toBe('transaction');
    expect(e.code).toBe('NAMESPACE_REGISTRY_FATAL');
    expect(e.sourcePhase).toBe('lifecycle-slot-internal');
    expect(e.result).toMatchObject({ kind: 'fatal', committed: true, effect: 'update' }); // committed 事实原样保留
  });

  it('T6 create-document-internal fatal：结局应以候选 namespace 归属进入数据键控通道（当前被无归属通道丢弃）', async () => {
    const host = makeProductionShapedHost();
    const registry = makeRegistry(new StubPersistence(), {
      diagnosticLog: host.binding,
      createDocumentFactory: () => {
        throw new Error('create-document-internal boom');
      },
    });

    await expect(registry.create(makeInput())).rejects.toMatchObject({
      code: 'NAMESPACE_REGISTRY_FATAL',
      phase: 'create-document-internal',
      committed: false,
    });
    await flushMicrotasks();

    const records = await waitNsRecords(host, NS_FIRST, 1);
    const e = emissionAt(records);
    expect(e.operation).toBe('namespace-create');
    expect(e.stage).toBe('schema-compile'); // Registry 既有阶段词（registry.ts:1365——seam internal fatal 归入该 stage）
    expect(e.code).toBe('NAMESPACE_REGISTRY_FATAL');
    expect(e.sourcePhase).toBe('create-document-internal');
    expect(e.result).toMatchObject({ kind: 'fatal', committed: false });
  });

  it('T7 GREEN 对照：initStream 之后的结局（#17 committed / #18 runtime-construction fatal）已正确归属——钉住缺口边界 = 建流前', async () => {
    // (a) 成功 create：#17 committed 经 runtimeEmitterFor(ns) 落 ns 通道（既有 #155 行为）
    const hostA = makeProductionShapedHost();
    const registryA = makeRegistry(new StubPersistence(), { diagnosticLog: hostA.binding });
    const lease = okLease(await registryA.create(makeInput()));
    const committed = emissionAt(await waitNsRecords(hostA, NS_FIRST, 1));
    expect(committed.operation).toBe('namespace-create');
    expect(committed.stage).toBe('transaction');
    expect(committed.result).toMatchObject({ kind: 'committed', effect: 'update' });
    expect(committed.code).toBeUndefined(); // committed 无 code（词表冻结）
    expect(hostA.unattributedDrops.length).toBe(0);
    expect(hostA.events).toContain(`initStream:${NS_FIRST}:start`); // 建流缝被调用
    await lease.release();
    await registryA.shutdown();

    // (b) post-commit runtime-construction fatal：#18 经 runtimeEmitterFor(ns) 落 ns 通道
    const hostB = makeProductionShapedHost();
    const registryB = makeRegistry(new StubPersistence(), {
      diagnosticLog: hostB.binding,
      runtimeFactory: () => {
        throw new Error('runtime construction boom');
      },
    });
    await expect(registryB.create(makeInput())).rejects.toMatchObject({
      code: 'NAMESPACE_REGISTRY_FATAL',
      phase: 'runtime-construction',
      committed: true,
    });
    const fatal = emissionAt(await waitNsRecords(hostB, NS_FIRST, 1));
    expect(fatal.operation).toBe('namespace-create');
    expect(fatal.stage).toBe('transaction');
    expect(fatal.code).toBe('NAMESPACE_REGISTRY_FATAL');
    expect(fatal.sourcePhase).toBe('runtime-construction');
    expect(fatal.result).toMatchObject({ kind: 'fatal', committed: true, effect: 'update' });
    expect(hostB.unattributedDrops.length).toBe(0);
    await expect(registryB.shutdown()).resolves.toBeUndefined();
  });
});

describe('#226 日志 I/O 与业务关键路径隔离（SA1 复现红灯）', () => {
  it('T8 慢建流 + 慢同步 append 不得延长 create 结算（修复后 initStream/emit 位于 carrier 槽外）', async () => {
    const host = makeProductionShapedHost({ initStreamBlockMs: 120, emitBlockMs: 120 });
    const registry = makeRegistry(new StubPersistence(), { diagnosticLog: host.binding });

    const t0 = Date.now();
    const result = await registry.create(makeInput());
    const createMs = Date.now() - t0;
    host.events.push('create:settled');

    // 业务面闭环（GREEN 锚）：create 结果不受日志存储影响
    const lease = okLease(result);
    expect(lease.namespaceId).toBe(NS_FIRST);

    // ── 红灯锚（顺序，主判据）：create 结算先于日志存储完成标记 ──
    // R1 修订：修复后 initStream/#17 emit 由 macrotask 级延迟投递产生——结算标记
    // push（create:settled）与断言之间为纯同步段，存储完成标记届时可能尚未到达；
    // 先 poll 等两枚存储完成标记到达（poll 让出事件循环 → drain 执行），再断言顺序。
    // 修复前（registry.ts:1436/1450 槽内同步执行）标记先于 create:settled → 顺序仍红。
    // 通道 emit 序号：本次成功 create 恰 1 条 emission（#17 committed）→ emit:<ns>:1:*。
    await expect
      .poll(
        () =>
          host.events.includes(`initStream:${NS_FIRST}:end`) &&
          host.events.includes(`emit:${NS_FIRST}:1:end`),
        { interval: 5, timeout: 1_000 },
      )
      .toBe(true);
    expect(host.events.indexOf('create:settled')).toBeLessThan(host.events.indexOf(`initStream:${NS_FIRST}:end`));
    expect(host.events.indexOf('create:settled')).toBeLessThan(host.events.indexOf(`emit:${NS_FIRST}:1:end`));
    // 墙钟旁证（非判据）：修复前 create() 结算 ≥ 240ms
    expect(createMs, `create() 结算被日志存储延长至 ${createMs}ms`).toBeLessThan(120);

    await lease.release();
    await registry.shutdown();
  });

  it('T9 慢建流不得无限延长 Registry shutdown（shutdown 等待已接纳 create，而建流当前在槽内）', async () => {
    const persistence = new StubPersistence();
    const gate = deferred();
    const entered = deferred();
    persistence.queueCreate({ gate });
    persistence.enteredCreate.push(entered);
    const host = makeProductionShapedHost({ initStreamBlockMs: 200 });
    const registry = makeRegistry(persistence, { diagnosticLog: host.binding });

    const createPromise = registry.create(makeInput());
    await entered.promise; // 槽已接纳并停在 createDoc（initStream 尚未到达）
    const shutdownPromise = registry.shutdown(); // 停接纳；等待已接纳 create 终局
    gate.resolve(); // 槽继续 → initStream（200ms 同步存储）→ create 终局 → shutdown 继续

    const t0 = Date.now();
    await shutdownPromise;
    const shutdownMs = Date.now() - t0;
    host.events.push('shutdown:settled');

    // 业务面闭环（GREEN 锚）：create 成功且 shutdown 正常聚合结算
    const lease = okLease(await createPromise);
    expect(lease.namespaceId).toBe(NS_FIRST);

    // ── 红灯锚（顺序，主判据）：shutdown 结算先于日志存储完成标记 ──
    // R1 修订：修复后已接纳 create 的 initStream 由延迟投递产生、与 shutdown 零耦合
    // （ADR-0011 L129：Registry 停止不得等待日志 sink）——先 poll initStream:end 到达
    // （drain 在 shutdown 之外执行），再断言顺序。修复前 initStream:end 在已接纳
    // create 槽内先于 shutdown:settled → 顺序仍红。
    await expect
      .poll(() => host.events.includes(`initStream:${NS_FIRST}:end`), { interval: 5, timeout: 1_000 })
      .toBe(true);
    expect(host.events.indexOf('shutdown:settled')).toBeLessThan(host.events.indexOf(`initStream:${NS_FIRST}:end`));
    expect(shutdownMs, `shutdown 等待被日志存储延长至 ${shutdownMs}ms`).toBeLessThan(100);
  });

  it('T10 open 槽内 adapter 构造（reopen/repair/retention sweep 语义）不得延长 open 结算', async () => {
    const persistence = new StubPersistence();
    // 先以快 Host 建立 namespace 并干净关停（模拟已存在 namespace 的后续进程 open）
    const bootstrapHost = makeProductionShapedHost();
    const bootstrap = makeRegistry(persistence, { diagnosticLog: bootstrapHost.binding });
    const bootstrapLease = okLease(await bootstrap.create(makeInput()));
    await bootstrapLease.release();
    await bootstrap.shutdown();

    const host = makeProductionShapedHost({ ensureBlockMs: 150 });
    const registry = makeRegistry(persistence, { diagnosticLog: host.binding });

    const t0 = Date.now();
    const opened = await registry.open(OWNER, NS_FIRST);
    const openMs = Date.now() - t0;
    host.events.push('open:settled');

    // 业务面闭环（GREEN 锚）
    expect(opened.ok).toBe(true);
    if (!opened.ok) throw new Error('unreachable');
    const lease = opened.lease;

    // ── 红灯锚（顺序，主判据）：open 结算先于日志 adapter 构造完成标记 ──
    // R1 修订：修复后 open 槽对日志只做 O(1) 捕获——ensure（reopen 健康证明/尾部
    // 修复/retention sweep）推迟到首个 emission 的投递 drain（registry.ts:1229
    // factory 第三参 = wrapper）；故先经一次 lease 写驱动该 emission，再 poll
    // ensure:NS:end 到达，最后断言顺序。修复前 ensure 在 open 槽内（resolver 现场
    // runtimeEmitterFor 解析）→ 先于 open:settled → 顺序仍红。
    const write = await lease.mutateData({ op: 'set', path: ['n'], value: 2 });
    expect(write.ok).toBe(true);
    await expect
      .poll(() => host.events.includes(`ensure:${NS_FIRST}:end`), { interval: 5, timeout: 1_000 })
      .toBe(true);
    expect(host.events.indexOf('open:settled')).toBeLessThan(host.events.indexOf(`ensure:${NS_FIRST}:end`));
    expect(openMs, `open() 结算被日志 adapter 构造延长至 ${openMs}ms`).toBeLessThan(75);

    await lease.release();
    await registry.shutdown();
  });

  it('T12 慢同步 append 不得阻塞 create 之后的下一个业务写槽（B3：write-sequencer 窗口隔离——经 Registry 生产装配全链路）', async () => {
    // R2 迁移：原 runtime 红契约直注 Runtime 冻结 seam（慢 emitter）——在「Runtime
    // 零生产改动 + #149 AC4 同步锚 emitCalls===2」下对任意实现不可满足（SA1 §10.2 /
    // SA8 C2）；改经 Registry 生产装配全链路注入（默认 runtimeFactory =
    // createNamespaceRuntimeForRegistry + resolver 产出的 emitter = #226 修复的实际
    // 改动面——生产 wiring 同构）。判据同 R1 形状：到达 poll + 顺序 + 墙钟旁证。
    const host = makeProductionShapedHost({ emitBlockMs: 100 });
    const registry = makeRegistry(new StubPersistence(), { diagnosticLog: host.binding });

    const lease = okLease(await registry.create(makeInput()));
    expect(lease.namespaceId).toBe(NS_FIRST);

    const w1 = await lease.mutateData({ op: 'set', path: ['n'], value: 2 });
    const w1Settled = Date.now();
    const w2 = await lease.mutateData({ op: 'set', path: ['n'], value: 3 });
    const w2Settled = Date.now();
    host.events.push('writes:settled');

    // 业务面闭环（GREEN 锚）：两次写都成功、FIFO 语义不变、终值正确
    expect(w1).toEqual({ ok: true });
    expect(w2).toEqual({ ok: true });
    const read = lease.readData(['n']);
    expect(read.ok).toBe(true);
    expect((read as { value?: unknown }).value).toBe(3);
    // 墙钟旁证（非判据）：修复前 w1→w2 结算间隔被慢 emit 拉长 ≥100ms
    const gap = w2Settled - w1Settled;
    expect(gap, `下一业务写槽被慢日志 emission 推迟 ${gap}ms`).toBeLessThan(50);

    // ── 红灯锚（顺序，主判据）：下一业务写槽结算先于上一槽的日志 emission 执行 ──
    // R1/R2 修订：修复后 w1 的 emission 由延迟投递（drain）产生、晚于 w2 结算——
    // 先 poll w1 的 emission（通道第 2 条：成功 create 的 #17 = 第 1 条）start 到达，
    // 再断言顺序。修复前 emit 在 w1 槽结算链内同步执行（先于 w2 槽）→ 顺序仍红。
    await expect
      .poll(() => host.events.includes(`emit:${NS_FIRST}:2:start`), { interval: 5, timeout: 1_000 })
      .toBe(true);
    expect(host.events.indexOf('writes:settled')).toBeLessThan(host.events.indexOf(`emit:${NS_FIRST}:2:start`));

    await lease.release();
    await registry.shutdown();
  });

  it('T13 慢同步 append 不得延长 Registry shutdown（在途写 + 立即 shutdown：close barrier 不得等待日志 emission 完成）', async () => {
    // R2 迁移：同 T12（生产装配全链路注入）；对应原 runtime 红契约 T13（close
    // barrier 面）的 Registry shutdown 等价面。
    const host = makeProductionShapedHost({ emitBlockMs: 100 });
    const registry = makeRegistry(new StubPersistence(), { diagnosticLog: host.binding });

    const lease = okLease(await registry.create(makeInput()));
    const writePromise = lease.mutateData({ op: 'set', path: ['n'], value: 7 });
    const t0 = Date.now();
    const shutdownPromise = registry.shutdown(); // 关停排空 runtime 已接纳写槽
    await shutdownPromise;
    const shutdownMs = Date.now() - t0;
    host.events.push('shutdown:settled');

    // 业务面闭环（GREEN 锚）：写成功（shutdown 排空内结算）且 shutdown 正常聚合
    await expect(writePromise).resolves.toEqual({ ok: true });
    // 墙钟旁证（非判据）：修复前 shutdown 结算被慢 emit 拉长 ≥100ms
    expect(shutdownMs, `shutdown 结算被慢日志 emission 延长至 ${shutdownMs}ms`).toBeLessThan(50);

    // ── 红灯锚（顺序，主判据）：shutdown 结算先于在途写的日志 emission 完成 ──
    // R1/R2 修订：在途写 = 成功 create 后通道第 2 条 emission（emit:<ns>:2）——先
    // poll 其 end 到达（修复后 drain 与 shutdown 零耦合、迟到执行——ADR-0011 L129），
    // 再断言顺序。修复前 emit:NS:2:end 在写槽结算链内先于 shutdown:settled → 仍红。
    await expect
      .poll(() => host.events.includes(`emit:${NS_FIRST}:2:end`), { interval: 5, timeout: 1_000 })
      .toBe(true);
    expect(host.events.indexOf('shutdown:settled')).toBeLessThan(host.events.indexOf(`emit:${NS_FIRST}:2:end`));
  });
});

// ── 真实 File adapter E2E（生产供应方形状；#150 先例的真实落盘面）────────────

const tempRoots: string[] = [];

function freshTempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('#226 生产 File adapter E2E（SA1 复现红灯）', () => {
  it('T11 被拒 create 的结局零落盘（无归属通道丢弃 → 零 stream）vs 成功 create 落盘（GREEN 对照）', async () => {
    const rootDir = freshTempRoot('issue226-e2e-');
    const adapters = new Map<string, ReturnType<typeof createFileDiagnosticLog>>();
    const unattributedDrops: number[] = [];
    const fileConfig = (namespaceId: string, genesisUpdateBytes?: Uint8Array) => ({
      rootDir,
      namespaceId,
      ...(genesisUpdateBytes !== undefined ? { genesisUpdateBytes } : {}),
      updateCapture: true,
      inputPolicy: 'full' as const,
      clock: { now: () => NOW_MS },
    });
    // 生产供应方形状（diagnostics.ts）：emitter 恒丢弃 + initStream/runtimeEmitterFor 建流。
    const binding = {
      emitter: {
        emit: () => {
          unattributedDrops.push(1);
        },
      },
      initStream: (namespaceId: string, genesisUpdateBytes: Uint8Array | undefined) => {
        adapters.set(namespaceId, createFileDiagnosticLog(fileConfig(namespaceId, genesisUpdateBytes)));
      },
      runtimeEmitterFor: (namespaceId: string) => {
        let log = adapters.get(namespaceId);
        if (log === undefined) {
          log = createFileDiagnosticLog(fileConfig(namespaceId));
          adapters.set(namespaceId, log);
        }
        return log.emitter;
      },
    };
    const registry = makeRegistry(new StubPersistence(), { diagnosticLog: binding });

    // ── GREEN 对照（先行，当前可执行）：成功 create（首个候选 NS_FIRST）→ 建流 +
    //    genesis + committed attempt 落盘（生产 wiring 在 stream 建立后正常工作）。
    const lease = okLease(await registry.create(makeInput()));
    expect(lease.namespaceId).toBe(NS_FIRST);
    await expect.poll(() => adapters.has(NS_FIRST), { interval: 5, timeout: 1_000 }).toBe(true);
    const logInstance = adapters.get(NS_FIRST)!;
    await expect
      .poll(
        () => readStreamStrict({ rootDir, namespaceId: NS_FIRST, streamId: logInstance.streamId }).records.length,
        { interval: 5, timeout: 3_000 },
      )
      .toBeGreaterThanOrEqual(2);
    const readable = readStreamStrict({ rootDir, namespaceId: NS_FIRST, streamId: logInstance.streamId });
    expect(readable.status).toBe('ok');
    const kinds = readable.records.map((r) =>
      r.ok && r.record !== null ? (r.record as { recordKind?: string }).recordKind ?? 'unknown' : 'unreadable',
    );
    expect(kinds).toContain('genesis-baseline'); // genesis 先行（不冒充变更尝试）
    expect(kinds).toContain('attempt');

    // ── 缺口 A 落盘证据（RED 锚）：schema-compile 拒绝（第二候选 NS_SECOND）→ 候选
    //    ns 的诊断 stream 从未建立，结局只落无归属通道（生产供应方 = 丢弃 + 计数），
    //    磁盘零文件。AC1 要求该结局以正确 namespace 归属进入诊断流（被拒 create 无
    //    后续 stream 可补记 → stream 必须为该结局建立）。
    const rejected = await registry.create(makeInput(BAD_SCHEMA, ROOT0));
    expect(rejected).toMatchObject({ ok: false, code: 'NAMESPACE_SCHEMA_INVALID' });
    await expect
      .poll(() => existsSync(join(rootDir, 'namespaces', NS_SECOND)), { interval: 10, timeout: 600 })
      .toBe(true);
    const ns2Entries = readdirSync(join(rootDir, 'namespaces', NS_SECOND), { recursive: true });
    expect(ns2Entries.length, '候选 ns 的 stream 目录应含诊断文件').toBeGreaterThan(0);

    await lease.release();
    await registry.shutdown();
  });
});
