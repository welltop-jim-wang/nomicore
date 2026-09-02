/**
 * SA6 红灯契约 — issue #150：namespace-registry create 全生命周期接入
 * namespace 诊断变更日志（task_namespace-diagnostic-change-log.md；SA8 clear，
 * Phase 1 实现前初始契约：anchoring acceptance contract before design）。
 *
 * 契约来源：
 * - 任务简报 AC1–AC5（structured outcomes for acceptance/duplicate/input snapshot/
 *   schema compile/validation/transaction-Persistence/post-commit Runtime
 *   construction；detached genesis bytes；pre-input zero payload access + 既有安全
 *   快照复用；logging disabled / stream init failure / queue pressure / sink failure
 *   四隔离；六类测试场景）；
 * - ADR-0011（stage/结局词表、输入捕获四态、接口 seam 小 emitter、fatal 保留既有
 *   committed 事实、业务模块不依赖日志存储实现）；
 * - ADR-0012（每新 stream 尽力先记 genesis baseline；初始化失败不影响 namespace
 *   create，独立健康 observer 上报 `LOG_STREAM_INIT_FAILED`；后续重试成功以当时
 *   Y.Doc 建立新 stream，genesis 只代表从该时点开始）；
 * - #148 冻结 emission/record/vocabulary（操作 `namespace-create`、8 值 stage 词表、
 *   attemptId att-+32hex、committed 无 code、code↔sourceModule 成对、sourceModule
 *   封闭四值含 'registry'、update 以 owned bytes 表达）。
 *
 * 红灯核心（当前 worktree，2026-08-30 验证）：
 * - 依赖层：@nomicore/namespace-registry 未依赖 @nomicore/namespace-diagnostic-log
 *   ——本文件以相对路径 import 走通（包依赖修复属 SA3）；
 * - seam 层：NamespaceRegistryTestingOverrides / CreateNamespaceRegistryOptions 无
 *   诊断注入字段——本文件以 `diagnosticLog`（形状
 *   `{ emitter: NamespaceDiagnosticChangeEmitter; initStream?(namespaceId,
 *   genesisUpdateBytes): void }`）约定字段经 createNamespaceRegistryForTesting 装配；
 *   字段名即本契约锚点（沿用 #149 `diagnosticEmitter`/`clock` 先例）；
 * - 发射层：create 各结局路径零 emit、stream init 零调用——以下所有「记录必须存在且
 *   分类正确」「initStream 恰一次且 bytes 为提交初始文档」的断言在当前 worktree 全部
 *   红灯（0 记录、0 accepted、0 initStream calls、磁盘零 stream）。
 *
 * 行为锚点（全部为运行时行为断言，无任何源码 grep）：
 * - 每次 create 尝试（success/duplicate/rejected/fatal）恰好产生 1 条
 *   `namespace-create` attempt record（stage/code/result/input 按下方映射表）；
 * - 成功 create：record result committed + effect update（owned initial-doc bytes，
 *   对空 Y.Doc 应用即物化 SCHEMA/META/ROOT——create 事务无 pre-state，全量即精确
 *   effect，无 #149 增量基态问题）；同时 initStream 恰一次、携带同一初始文档的
 *   detached bytes（genesis baseline）；
 * - pre-input 拒绝（停接纳 / entry duplicate）记录 input.capture = not-accessed 且
 *   schema/root 零 trap；快照失败记录 unsafe-input 且 accessor 零执行；快照成功后
 *   记录只消费既有 frozen 快照（排队后变异调用方引用不影响记录输入）；
 * - 日志侧故障（emitter throw、队列满、stream init 失败）不改 create 返回值、
 *   Persistence 状态与 Registry 生命周期；LOG_STREAM_INIT_FAILED 经日志健康
 *   observer 独立上报。
 *
 * 【R2 勘误，2026-08-31】AC5 首版 fixture 错误地以「健康 stream 建立后再构造一次
 * adapter」表达延迟初始化——冻结 File adapter 的续写语义（current.json locator →
 * 健康 stream resume，构造期 genesisUpdateBytes 被忽略）使其变成原地续写而非新
 * stream。已按 preferred correction A 修正：首次 initStream 以非法配置失败
 * （真实 LOG_STREAM_INIT_FAILED/invalid-roll-targets、零落盘）→ ROOT 变更后以合法
 * 配置 + 当时 Y.Doc bytes 重试建立全新 stream，genesis = 变更后状态（n=2）。诚实
 * 当前态要求保留（genesis 只代表重试时点），未被弱化为 resume 语义。详见
 * task_namespace-diagnostic-change-log.md SA6 R2 节。
 *
 * stage/code/result 映射表（本契约冻结；歧义处取 ADR 语义，事实取 Registry 既有
 * 稳定码——不发明新码）：
 * - 停接纳拒绝 → acceptance / REGISTRY_NOT_ACCEPTING / rejected / not-accessed；
 * - entry duplicate → acceptance / NAMESPACE_ALREADY_EXISTS / rejected / not-accessed；
 * - 持久层 duplicate（DOC_DUPLICATE）→ transaction / NAMESPACE_ALREADY_EXISTS /
 *   rejected / 快照已捕获；
 * - payload 快照失败 → input-snapshot / NAMESPACE_CREATE_INVALID_INPUT / rejected /
 *   unsafe-input；
 * - schema 编译失败 → schema-compile / NAMESPACE_SCHEMA_INVALID / rejected / issues；
 * - ROOT 校验失败 → validation / NAMESPACE_ROOT_INVALID / rejected / issues；
 * - 持久层运营失败 → transaction / NAMESPACE_CREATE_FAILED / rejected；
 * - 成功提交 → transaction / committed + update（无 code）；
 * - 提交后 Runtime 构造失败 → transaction / fatal committed:true / code
 *   NAMESPACE_REGISTRY_FATAL / sourcePhase runtime-construction（effect update 携带
 *   初始文档 bytes——committed 事实保留）。
 */
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { DocCreateOperationalError, DocDuplicateError } from '@nomicore/persistence';
import type { DocHandle, DocPersistence, User } from '@nomicore/persistence';
import { createNamespaceRegistryForTesting, createRegistryTestScheduler } from '@nomicore/namespace-registry/testing';
import { createNamespaceRuntimeForRegistry } from '@nomicore/namespace-runtime/internal';
import type { CreateNamespaceInput, NamespaceLease } from '@nomicore/namespace-registry';
import type { RegistryObserverEvent } from '../src/observer.js';
import {
  createBoundedMemoryDiagnosticLog,
  createFileDiagnosticLog,
  readStreamStrict,
  type AttemptRecord,
  type BoundedMemoryDiagnosticLog,
  type DiagnosticLogConfig,
  type DiagnosticLogHealthEvent,
  type NamespaceDiagnosticChangeEmission,
  type NamespaceDiagnosticChangeEmitter,
  type UpdateCarrier,
} from '../../namespace-diagnostic-log/src/index.js';

// ── 固定夹具 ────────────────────────────────────────────────────────────────

const NOW_MS = 1_700_000_000_000; // 固定注入 Clock（Registry 既有 clock 必需字段）
const NOW_ISO = new Date(NOW_MS).toISOString(); // '2023-11-14T22:13:20.000Z'

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

/** 契约锚点：#150 注入 seam（字段名 = 契约锚点；当前 Overrides 无此字段——传参被
 *  忽略 → 红灯）。emitter 为 #148 冻结接口；initStream 为 ADR-0012 stream 建立缝
 *  （genesis bytes 由 producer 供给、adapter 内部构造 genesis-baseline）。 */
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

/** 记录断言用 attempt 记录（内存 adapter 的 records() 回读）。 */
function makeLog(config?: Partial<DiagnosticLogConfig>): BoundedMemoryDiagnosticLog {
  return createBoundedMemoryDiagnosticLog({ inputPolicy: 'digest', updateCapture: true, ...config });
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

/** 固定 ms + 计数 Clock（计数器锚：每通过 gate 的 create slot 恰读一次——诊断接线
 *  不得引入第二次 Clock 读数）。 */
function makeCountingClock(): { now(): number; readonly calls: number } {
  let calls = 0;
  return {
    now() {
      calls += 1;
      return NOW_MS;
    },
    get calls() {
      return calls;
    },
  };
}

// ── 确定性并发原语（禁 real sleep；沿用 registry-create.test.ts 既有原语）──────

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

/** 显式微任务展开（禁 real sleep）；默认 16 层覆盖 create 链各段微任务。 */
async function flushMicrotasks(times = 16): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

// ── 可控 Persistence stub（沿用 registry-create.test.ts CreateStubPersistence 先例）──

interface CreatePlan {
  gate?: Deferred;
  error?: unknown;
  handle?: DocHandle;
}

interface LoadPlan {
  result?: DocHandle | null;
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
  readonly loadCalls: Array<{ owner: User; docId: string }> = [];
  saveCalls = 0;
  private readonly createQueue: CreatePlan[] = [];
  private readonly loadQueue: LoadPlan[] = [];
  private readonly committedDocs = new Map<string, Y.Doc>();

  queueCreate(plan: CreatePlan): void {
    this.createQueue.push(plan);
  }

  queueLoad(plan: LoadPlan): void {
    this.loadQueue.push(plan);
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
    return plan.handle ?? new StubHandle(owner, docId, doc);
  }

  async loadDoc(owner: User, docId: string): Promise<DocHandle | null> {
    this.loadCalls.push({ owner, docId });
    const plan = this.loadQueue.shift();
    if (plan !== undefined) {
      if (plan.error !== undefined) {
        throw plan.error;
      }
      return plan.result ?? null;
    }
    const doc = this.committedDocs.get(docId);
    return doc === undefined ? null : new StubHandle(owner, docId, doc);
  }

  async saveDoc(): Promise<void> {
    this.saveCalls += 1;
  }
}

// ── Registry 装配 helper（diagnosticLog 字段经 as never 透传——当前 seam 无此字段）──

interface RegistryDiagOverrides {
  readonly clock?: { now(): number; readonly calls: number };
  readonly runtimeFactory?: (handle: DocHandle, notifyDirty: () => Promise<void>) => unknown;
  readonly createDocumentFactory?: (namespaceId: string, createdAt: string, schema: unknown, root: unknown) => unknown;
  readonly observer?: (e: RegistryObserverEvent) => void;
  readonly diagnosticLog?: NamespaceRegistryDiagnosticLog;
  readonly randomBytes?: (length: number) => Uint8Array;
}

function makeRegistry(
  persistence: DocPersistence,
  overrides: RegistryDiagOverrides = {},
): ReturnType<typeof createNamespaceRegistryForTesting> {
  const clock = overrides.clock ?? { now: () => NOW_MS, calls: 0 };
  const seam: Record<string, unknown> = {
    clock,
    scheduler: createRegistryTestScheduler(),
    randomBytes: overrides.randomBytes ?? makeDeterministicRandomBytes(),
  };
  if (overrides.runtimeFactory !== undefined) seam.runtimeFactory = overrides.runtimeFactory;
  if (overrides.createDocumentFactory !== undefined) seam.createDocumentFactory = overrides.createDocumentFactory;
  if (overrides.observer !== undefined) seam.observer = overrides.observer;
  if (overrides.diagnosticLog !== undefined) seam.diagnosticLog = overrides.diagnosticLog;
  return createNamespaceRegistryForTesting(persistence, seam as never);
}

// ── 记录读取 / 解码 helpers ────────────────────────────────────────────────

/** 等待 attempt record 数量达到 expected（record 计数 ≥ expected 后返回快照）。 */
async function waitAttempts(log: BoundedMemoryDiagnosticLog, expected: number): Promise<AttemptRecord[]> {
  await expect
    .poll(() => log.records().filter((r) => r.recordKind === 'attempt').length, { interval: 5, timeout: 3_000 })
    .toBe(expected);
  return log.records().filter((r): r is AttemptRecord => r.recordKind === 'attempt');
}

/** 单条记录提取（类型收窄专用——waitAttempts 已 poll 至 1 条，运行时恒非空）。 */
function firstAttempt(recs: AttemptRecord[]): AttemptRecord {
  const r = recs[0];
  if (r === undefined) throw new Error('waitAttempts 返回 0 条记录（poll 已保证非空——不可达防御）');
  return r;
}

/** inline carrier 的 bytes 提取（类型收窄专用；与 expect(carrier.storage==='inline')
 *  同义——防御 throw 与原断言失败同判失败语义）。 */
function carrierBytes(carrier: UpdateCarrier): Uint8Array {
  if (carrier.storage !== 'inline') throw new Error(`预期 inline carrier，实际 ${carrier.storage}`);
  const raw = new Uint8Array(Buffer.from(carrier.base64, 'base64'));
  expect(raw.length).toBe(carrier.payloadLength);
  return raw;
}

/** carrier bytes → 物化 Y.Doc（create 事务无 pre-state：空 doc 应用即全量物化——
 *  'Y.encodeStateAsUpdate' 语义；无 #149 增量基态问题）。 */
function materialize(carrier: UpdateCarrier): Y.Doc {
  expect(carrier.storage).toBe('inline');
  expect(carrier.format).toBe('yjs-update-v1');
  const fresh = new Y.Doc();
  Y.applyUpdate(fresh, carrierBytes(carrier));
  return fresh;
}

/** 提交初始文档内容断言（genesis 与 committed attempt 共用；ADR-0006 三条目布局）。 */
function expectInitialDoc(doc: Y.Doc, namespaceId: string): void {
  const sc = doc.getMap('SCHEMA');
  expect(sc.size).toBe(4);
  expect(sc.get('lang')).toBe('vfsl');
  expect(sc.get('version')).toBe(1);
  expect(sc.get('id')).toBe('ns-1');
  expect(sc.get('text')).toBe(ENVELOPE.text);
  const meta = doc.getMap('META');
  expect(meta.size).toBe(2);
  expect(meta.get('docId')).toBe(namespaceId);
  expect(meta.get('createdAt')).toBe(NOW_ISO);
  const root = doc.getMap('ROOT');
  expect(root.size).toBe(2);
  expect(root.get('n')).toBe(1);
  expect(root.get('a')).toBe('x');
}

/** committed/fatal 结果中取出 inline update carrier（effect 必须为 update）。 */
function updateCarrierOf(result: { kind: 'committed' | 'fatal'; effect?: string; committed?: boolean; update?: UpdateCarrier }): UpdateCarrier {
  if (result.kind === 'committed' && result.effect === 'update' && result.update !== undefined) return result.update;
  if (result.kind === 'fatal' && result.committed === true && result.effect === 'update' && result.update !== undefined) {
    return result.update;
  }
  throw new Error(`预期 effect:update，实际 ${JSON.stringify(result)}`);
}

/** attempt 记录通用形状断言（operation/source/attemptId/observedAt 面）。 */
function expectAttemptShape(rec: AttemptRecord): void {
  expect(rec.operation).toBe('namespace-create');
  expect(rec.source).toEqual({ kind: 'local' });
  expect(rec.attemptId).toMatch(/^att-[0-9a-f]{32}$/);
  expect(rec.observedAt).toBe(NOW_ISO); // 注入 Clock → observedAt（禁 Date.now 墙钟）
}

// ── 测试主体 ────────────────────────────────────────────────────────────────

describe('#150 create 诊断记录（红灯契约）', () => {
  it('AC1/AC2 成功 create：transaction/committed 记录 + initStream genesis bytes + 单时钟读', async () => {
    const log = makeLog({ inputPolicy: 'full' });
    const initCalls: Array<{ namespaceId: string; bytes: Uint8Array | undefined }> = [];
    const binding: NamespaceRegistryDiagnosticLog = {
      emitter: log.emitter,
      initStream: (namespaceId, genesisUpdateBytes) => {
        initCalls.push({ namespaceId, bytes: genesisUpdateBytes?.slice() });
      },
    };
    const persistence = new StubPersistence();
    const clock = makeCountingClock();
    const registry = makeRegistry(persistence, { clock, diagnosticLog: binding });

    const result = await registry.create(makeInput());
    const lease = okLease(result);

    // 业务面闭环（当前 green——隔离守卫）：create 成功、createdAt 精确、Clock 恰读一次
    expect(lease.owner).toEqual({ userId: 'u-alice' });
    expect(lease.namespaceId).toBe(GENERATED_NAMESPACE_IDS.first);
    expect(lease.getMetadata().createdAt).toBe(NOW_ISO);
    expect(clock.calls).toBe(1);

    // ── 红灯锚：attempt 记录（当前 0 条）──
    const rec = firstAttempt(await waitAttempts(log, 1));
    expectAttemptShape(rec);
    expect(rec.stage).toBe('transaction');
    expect(rec.input).toMatchObject({ capture: 'full', value: { schema: ENVELOPE, root: ROOT0 } });
    expect(rec.result.kind).toBe('committed');
    if (rec.result.kind === 'committed') {
      expect(rec.result.effect).toBe('update'); // 无 noop/update-omitted——create 恒产生初始 doc effect
      const fresh = materialize(updateCarrierOf(rec.result));
      expectInitialDoc(fresh, GENERATED_NAMESPACE_IDS.first);
    }
    // committed 无 code（ADR-0011「committed 无 code」；code↔sourceModule 成对仅在拒绝/fatal）
    expect(rec.code).toBeUndefined();
    expect(rec.sourceModule).toBeUndefined();

    // ── 红灯锚：initStream 恰一次且 bytes = 提交初始文档（当前 0 次调用）──
    // 契约不锁定 initStream 相对 create() 结算的先后（ADR-0011「emitter 不被 await」）
    // ——poll 消除合法延后下的伪红。
    await expect.poll(() => initCalls.length, { interval: 5, timeout: 3_000 }).toBe(1);
    expect(initCalls[0]?.namespaceId).toBe(GENERATED_NAMESPACE_IDS.first);
    const genesis = initCalls[0]!.bytes;
    expect(genesis).toBeDefined();
    const genesisDoc = new Y.Doc();
    Y.applyUpdate(genesisDoc, genesis!);
    expectInitialDoc(genesisDoc, GENERATED_NAMESPACE_IDS.first);

    await lease.release();
  });

  it('AC2 genesis 落盘（真实 File adapter E2E）：manifest + genesis-baseline seq 1 + attempt seq 2', async () => {
    const rootDir = freshTempRoot('ndcl-registry-150-');
    const health: DiagnosticLogHealthEvent[] = [];
    let fileLog: ReturnType<typeof createFileDiagnosticLog> | undefined;
    const pending: NamespaceDiagnosticChangeEmission[] = [];
    // Host 侧 binding：emitter 装载前缓冲、initStream 后直通（契约不锁定 emit/init 次序）
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
    const registry = makeRegistry(persistence, { diagnosticLog: binding });

    const result = await registry.create(makeInput());
    const lease = okLease(result);

    // ── 红灯锚：initStream 从未被调用（当前 0 记录/0 文件）──
    await expect.poll(() => fileLog !== undefined, { interval: 5, timeout: 3_000 }).toBe(true);
    const logInstance = fileLog!;
    const streamPath = { rootDir, namespaceId: GENERATED_NAMESPACE_IDS.first, streamId: logInstance.streamId };
    // attempt 记录可合法晚于 initStream（契约不锁定次序）→ 磁盘行数 poll 至 2 再细读
    await expect
      .poll(() => readStreamStrict(streamPath).records.length, { interval: 5, timeout: 3_000 })
      .toBe(2);
    const readable = readStreamStrict(streamPath);
    expect(readable.status).toBe('ok');
    expect(readable.manifest).not.toBeNull();
    expect(readable.records.length).toBe(2); // genesis seq 1 + attempt seq 2

    const genesisRead = readable.records[0]!;
    expect(genesisRead.ok).toBe(true);
    const genesisRec = genesisRead.record as { recordKind?: string; sequence?: string; observedAt?: string; update?: UpdateCarrier };
    expect(genesisRec.recordKind).toBe('genesis-baseline');
    expect(genesisRec.sequence).toBe('1');
    expect(genesisRec.observedAt).toBe(NOW_ISO); // 适配器注入 Clock 同源
    expect(genesisRec.update).toBeDefined();
    expectInitialDoc(materialize(genesisRec.update!), GENERATED_NAMESPACE_IDS.first);

    const attemptRead = readable.records[1]!;
    expect(attemptRead.ok).toBe(true);
    const attemptRec = attemptRead.record as {
      recordKind?: string;
      sequence?: string;
      operation?: string;
      stage?: string;
      result?: { kind?: string; effect?: string; update?: UpdateCarrier };
      input?: { capture?: string; value?: unknown };
    };
    expect(attemptRec.recordKind).toBe('attempt');
    expect(attemptRec.sequence).toBe('2');
    expect(attemptRec.operation).toBe('namespace-create');
    expect(attemptRec.stage).toBe('transaction');
    expect(attemptRec.result?.kind).toBe('committed');
    expect(attemptRec.result?.effect).toBe('update');
    expect(attemptRec.input?.capture).toBe('full');
    expect(attemptRec.input?.value).toEqual({ schema: ENVELOPE, root: ROOT0 });
    expectInitialDoc(materialize(attemptRec.result!.update!), GENERATED_NAMESPACE_IDS.first);

    await lease.release();
  });

  it('AC1 连续 create：生成不同 namespaceId，均保留 transaction/committed 诊断覆盖', async () => {
    const log = makeLog({ inputPolicy: 'full' });
    const binding: NamespaceRegistryDiagnosticLog = { emitter: log.emitter };
    const persistence = new StubPersistence();
    const registry = makeRegistry(persistence, { diagnosticLog: binding });

    const first = okLease(await registry.create(makeInput()));
    const second = okLease(await registry.create(makeInput()));
    expect(first.namespaceId).toBe(GENERATED_NAMESPACE_IDS.first);
    expect(second.namespaceId).toBe(GENERATED_NAMESPACE_IDS.second);

    const recs = await waitAttempts(log, 2);
    expect(recs.map((rec) => rec.stage)).toEqual(['transaction', 'transaction']);
    expect(recs.map((rec) => rec.result.kind)).toEqual(['committed', 'committed']);

    await first.release();
    await second.release();
  });

  it('AC1 持久层 ID 冲突（DOC_DUPLICATE）：重生成后 committed，保留最终 transaction 诊断', async () => {
    const log = makeLog({ inputPolicy: 'full' });
    const binding: NamespaceRegistryDiagnosticLog = { emitter: log.emitter };
    const persistence = new StubPersistence();
    persistence.queueCreate({ error: new DocDuplicateError('injected duplicate') });
    const registry = makeRegistry(persistence, { diagnosticLog: binding });

    const lease = okLease(await registry.create(makeInput()));
    expect(lease.namespaceId).toBe(GENERATED_NAMESPACE_IDS.second);
    expect(persistence.createCalls.map((call) => call.docId)).toEqual([
      GENERATED_NAMESPACE_IDS.first,
      GENERATED_NAMESPACE_IDS.second,
    ]);

    const rec = firstAttempt(await waitAttempts(log, 1));
    expect(rec.stage).toBe('transaction');
    expect(rec.result.kind).toBe('committed');
    expect(rec.code).toBeUndefined();
    expect(rec.input).toMatchObject({ capture: 'full', value: { schema: ENVELOPE, root: ROOT0 } });
    await lease.release();
  });

  it('AC1 停接纳拒绝（shutdown 后 create）：acceptance/REGISTRY_NOT_ACCEPTING/not-accessed + 零 trap', async () => {
    const log = makeLog({ inputPolicy: 'full' });
    const binding: NamespaceRegistryDiagnosticLog = { emitter: log.emitter };
    const persistence = new StubPersistence();
    const registry = makeRegistry(persistence, { diagnosticLog: binding });

    await registry.shutdown();
    const gets = { count: 0 };
    const proxied = new Proxy(makeInput(), {
      get(target, prop, receiver) {
        gets.count += 1; // 任何字段读取都不允许（停接纳先于一切输入访问——AC9）
        return Reflect.get(target, prop, receiver);
      },
    });
    const result = await registry.create(proxied as unknown as CreateNamespaceInput);
    expect(result.ok).toBe(false);
    expect((result as { code?: string }).code).toBe('REGISTRY_NOT_ACCEPTING');
    expect(gets.count).toBe(0);

    const rec = firstAttempt(await waitAttempts(log, 1));
    expect(rec.stage).toBe('acceptance');
    expect(rec.result).toEqual({ kind: 'rejected' });
    expect(rec.code).toBe('REGISTRY_NOT_ACCEPTING');
    expect(rec.sourceModule).toBe('registry');
    expect(rec.input).toEqual({ capture: 'not-accessed' });
    // 停接纳拒绝不得访问 payload → 零 trap（再次确认——记录侧也无额外读取）
    expect(gets.count).toBe(0);
  });

  it('AC1/AC3 敌意 payload 快照失败：input-snapshot/rejected/unsafe-input + accessor 零执行', async () => {
    const log = makeLog({ inputPolicy: 'full' });
    const binding: NamespaceRegistryDiagnosticLog = { emitter: log.emitter };
    const persistence = new StubPersistence();
    const registry = makeRegistry(persistence, { diagnosticLog: binding });

    let fired = 0;
    const hostile = makeInput();
    Object.defineProperty(hostile, 'root', {
      enumerable: true,
      configurable: true,
      get: () => {
        fired += 1;
        return ROOT0;
      },
    });

    const result = await registry.create(hostile as unknown as CreateNamespaceInput);
    expect(result.ok).toBe(false);
    expect((result as { code?: string }).code).toBe('NAMESPACE_CREATE_INVALID_INPUT');
    expect(fired).toBe(0); // descriptor 检查先于值读取——accessor 零执行

    const rec = firstAttempt(await waitAttempts(log, 1));
    expect(rec.stage).toBe('input-snapshot');
    expect(rec.result).toEqual({ kind: 'rejected' });
    expect(rec.code).toBe('NAMESPACE_CREATE_INVALID_INPUT');
    expect(rec.sourceModule).toBe('registry');
    expect(rec.input).toEqual({ capture: 'unsafe-input' }); // 不强捕敌意输入、不重读
    expect(fired).toBe(0); // 日志侧零额外读取
  });

  it('AC1 schema 编译失败：schema-compile/rejected/SCHEMA_INVALID + issues + 快照已捕获', async () => {
    const log = makeLog({ inputPolicy: 'full' });
    const binding: NamespaceRegistryDiagnosticLog = { emitter: log.emitter };
    const persistence = new StubPersistence();
    const registry = makeRegistry(persistence, { diagnosticLog: binding });

    const result = await registry.create(makeInput(BAD_SCHEMA, ROOT0));
    expect(result.ok).toBe(false);
    expect((result as { code?: string }).code).toBe('NAMESPACE_SCHEMA_INVALID');

    const rec = firstAttempt(await waitAttempts(log, 1));
    expect(rec.stage).toBe('schema-compile');
    expect(rec.result).toEqual({ kind: 'rejected' });
    expect(rec.code).toBe('NAMESPACE_SCHEMA_INVALID');
    expect(rec.sourceModule).toBe('registry');
    expect(rec.input).toMatchObject({ capture: 'full', value: { schema: BAD_SCHEMA, root: ROOT0 } });
    expect(rec.issues).toBeDefined();
    expect((rec.issues?.items.length ?? 0)).toBeGreaterThan(0);
  });

  it('AC1 ROOT 校验失败：validation/rejected/ROOT_INVALID + issues + 快照已捕获', async () => {
    const log = makeLog({ inputPolicy: 'full' });
    const binding: NamespaceRegistryDiagnosticLog = { emitter: log.emitter };
    const persistence = new StubPersistence();
    const registry = makeRegistry(persistence, { diagnosticLog: binding });

    const result = await registry.create(makeInput(ENVELOPE, BAD_ROOT));
    expect(result.ok).toBe(false);
    expect((result as { code?: string }).code).toBe('NAMESPACE_ROOT_INVALID');

    const rec = firstAttempt(await waitAttempts(log, 1));
    expect(rec.stage).toBe('validation');
    expect(rec.result).toEqual({ kind: 'rejected' });
    expect(rec.code).toBe('NAMESPACE_ROOT_INVALID');
    expect(rec.sourceModule).toBe('registry');
    expect(rec.input).toMatchObject({ capture: 'full', value: { schema: ENVELOPE, root: BAD_ROOT } });
    expect(rec.issues).toBeDefined();
    expect((rec.issues?.items.length ?? 0)).toBeGreaterThan(0);
  });

  it('AC1 持久层运营失败：transaction/rejected/CREATE_FAILED + 快照已捕获', async () => {
    const log = makeLog({ inputPolicy: 'full' });
    const binding: NamespaceRegistryDiagnosticLog = { emitter: log.emitter };
    const persistence = new StubPersistence();
    persistence.queueCreate({ error: new DocCreateOperationalError(new Error('injected op-failure')) });
    const registry = makeRegistry(persistence, { diagnosticLog: binding });

    const result = await registry.create(makeInput());
    expect(result.ok).toBe(false);
    expect((result as { code?: string }).code).toBe('NAMESPACE_CREATE_FAILED');

    const rec = firstAttempt(await waitAttempts(log, 1));
    expect(rec.stage).toBe('transaction');
    expect(rec.result).toEqual({ kind: 'rejected' });
    expect(rec.code).toBe('NAMESPACE_CREATE_FAILED');
    expect(rec.sourceModule).toBe('registry');
    expect(rec.input).toMatchObject({ capture: 'full', value: { schema: ENVELOPE, root: ROOT0 } });
  });

  it('AC2 提交后 Runtime 构造失败：fatal committed:true + 业务 committed:true reject + 文档保留可 open', async () => {
    const log = makeLog({ inputPolicy: 'full' });
    const binding: NamespaceRegistryDiagnosticLog = { emitter: log.emitter };
    const persistence = new StubPersistence();
    let factoryCalls = 0;
    const registry = makeRegistry(persistence, {
      diagnosticLog: binding,
      runtimeFactory: (handle, notifyDirty) => {
        factoryCalls += 1;
        if (factoryCalls === 1) throw new Error('injected construction failure');
        return createNamespaceRuntimeForRegistry(handle, notifyDirty);
      },
    });

    const createPromise = registry.create(makeInput());
    await expect(createPromise).rejects.toMatchObject({
      operation: 'create',
      phase: 'runtime-construction',
      committed: true, // createDoc 已 resolve——committed 事实为真
    });

    // 记录：fatal committed:true + 既有稳定事实（code/phase/committed 保留；effect 携带初始文档）
    const rec = firstAttempt(await waitAttempts(log, 1));
    expect(rec.stage).toBe('transaction');
    expect(rec.result.kind).toBe('fatal');
    if (rec.result.kind === 'fatal' && rec.result.committed === true) {
      expect(rec.result.effect).toBe('update'); // 提交事实确切可知——owned bytes 诚实携带
      const fresh = materialize(updateCarrierOf(rec.result));
      expectInitialDoc(fresh, GENERATED_NAMESPACE_IDS.first);
    } else {
      throw new Error(`预期 fatal committed:true，实际 ${JSON.stringify(rec.result)}`);
    }
    expect(rec.code).toBe('NAMESPACE_REGISTRY_FATAL');
    expect(rec.sourcePhase).toBe('runtime-construction');
    expect(rec.sourceModule).toBe('registry');
    expect(rec.input).toMatchObject({ capture: 'full', value: { schema: ENVELOPE, root: ROOT0 } });

    // 业务面：文档保留（不补偿删除不 fallback）——open 可恢复已创建 namespace
    const opened = await registry.open(OWNER, GENERATED_NAMESPACE_IDS.first);
    expect(opened.ok).toBe(true);
    const openLease = okLease(opened);
    expect(openLease.getMetadata().createdAt).toBe(NOW_ISO);
    await openLease.release();
  });

  it('AC3 既有安全快照复用 + 零额外读取：logged 与基线 trap 相等、排队后变异输入不影响记录', async () => {
    async function runTracked(log?: BoundedMemoryDiagnosticLog): Promise<{ gets: number; attempts: number }> {
      const persistence = new StubPersistence();
      const registry = makeRegistry(
        persistence,
        log === undefined ? {} : { diagnosticLog: { emitter: log.emitter } as NamespaceRegistryDiagnosticLog },
      );
      const counts = { gets: 0 };
      const payload = new Proxy(makeInput(), {
        get(target, prop, receiver) {
          if (prop === 'schema' || prop === 'root') counts.gets += 1;
          return Reflect.get(target, prop, receiver);
        },
      });
      const result = await registry.create(payload as unknown as CreateNamespaceInput);
      const lease = okLease(result);
      const attempts = log === undefined ? 0 : await waitAttempts(log, 1).then((r) => r.length);
      await lease.release();
      return { gets: counts.gets, attempts };
    }

    const baseline = await runTracked(undefined);
    const loggedLog = makeLog({ inputPolicy: 'full' });
    const logged = await runTracked(loggedLog);
    expect(logged.attempts).toBe(1); // 对照不是空转：日志确实产生记录
    expect(logged.gets).toBe(baseline.gets); // 日志不得对调用方原输入造成额外读取

    // 复用既有 detached frozen 快照：槽内快照后、createDoc 前变异调用方引用 → 记录不变
    const persistence2 = new StubPersistence();
    const gate = deferred();
    persistence2.queueCreate({ gate });
    const log2 = makeLog({ inputPolicy: 'full' });
    const registry2 = makeRegistry(persistence2, { diagnosticLog: { emitter: log2.emitter } });
    const payload2: Record<string, unknown> = { owner: OWNER, schema: ENVELOPE, root: ROOT0 };
    const pendingCreate = registry2.create(payload2 as unknown as CreateNamespaceInput);
    await flushMicrotasks();
    expect(persistence2.createCalls.length).toBe(1); // 快照已完成、createDoc 正在 gate 上等待
    payload2.schema = { lang: 'vfsl', version: 1, id: 'mutated', text: 'type ROOT = { n: number; a: string; };\n' };
    payload2.root = { n: 99, a: 'mutated' };
    gate.resolve();
    const lease2 = okLease(await pendingCreate);
    const rec2 = firstAttempt(await waitAttempts(log2, 1));
    expect(rec2.input).toMatchObject({ capture: 'full', value: { schema: ENVELOPE, root: ROOT0 } }); // 快照事实，非变异后原对象
    await lease2.release();
  });

  it('AC4 emitter 违约 throw：create 成功不受影响（防御隔离）', async () => {
    const log = makeLog();
    let emitCalls = 0;
    const binding: NamespaceRegistryDiagnosticLog = {
      emitter: {
        emit: () => {
          emitCalls += 1;
          throw new Error('adapter violated non-throwing contract (injected)');
        },
      },
    };
    const persistence = new StubPersistence();
    const registry = makeRegistry(persistence, { diagnosticLog: binding });

    const result = await registry.create(makeInput());
    const lease = okLease(result);
    expect(lease.getMetadata().createdAt).toBe(NOW_ISO);
    expect(registry.getStatus()).toEqual({ state: 'running' });
    expect(persistence.createCalls.length).toBe(1);
    expect(lease.getStatus().lease).toBe('active');

    await expect.poll(() => emitCalls, { interval: 5, timeout: 3_000 }).toBe(1); // 恰一次 emit 尝试（当前 0——红灯）
    await lease.release();
  });

  it('AC4 队列压力：capacity 1 → 第二条记录 queue-full drop + 业务双创建均 ok', async () => {
    const log = makeLog({ capacity: 1 });
    const binding: NamespaceRegistryDiagnosticLog = { emitter: log.emitter };
    const persistence = new StubPersistence();
    const registry = makeRegistry(persistence, { diagnosticLog: binding });

    const r1 = await registry.create(makeInput());
    const r2 = await registry.create(makeInput());
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    const l1 = okLease(r1);
    const l2 = okLease(r2);
    expect(l1.getMetadata().createdAt).toBe(NOW_ISO);
    expect(l2.getMetadata().createdAt).toBe(NOW_ISO);

    await waitAttempts(log, 1); // 已接纳 1 条（当前 0——红灯）
    await expect.poll(() => log.stats().droppedTotal, { interval: 5, timeout: 3_000 }).toBe(1);
    const stats = log.stats();
    expect(stats.accepted).toBe(1);
    expect(stats.droppedByReason['queue-full']).toBe(1);

    await l1.release();
    await l2.release();
  });

  it('AC4 日志启用不改变业务结果：baseline 与 logged 双 registry 逐位一致', async () => {
    async function run(log?: BoundedMemoryDiagnosticLog): Promise<{ metadata: unknown; status: unknown }> {
      const persistence = new StubPersistence();
      const registry = makeRegistry(
        persistence,
        log === undefined ? {} : { diagnosticLog: { emitter: log.emitter } as NamespaceRegistryDiagnosticLog },
      );
      const result = await registry.create(makeInput());
      const lease = okLease(result);
      const snapshot = {
        metadata: lease.getMetadata(),
        status: lease.getStatus().lease,
        registryState: registry.getStatus().state,
      };
      await lease.release();
      return snapshot;
    }

    const baseline = await run(undefined);
    const loggedLog = makeLog();
    const logged = await run(loggedLog);
    expect(logged).toEqual(baseline); // 业务面逐位一致
    expect(await waitAttempts(loggedLog, 1).then((r) => r.length)).toBe(1); // 日志侧有记录（当前 0——红灯）
  });

  it('AC4 stream 初始化失败隔离：LOG_STREAM_INIT_FAILED 健康事件 + create 结果/持久化/生命周期不变', async () => {
    const rootDir = freshTempRoot('ndcl-registry-fail-');
    const health: DiagnosticLogHealthEvent[] = [];
    let initCalls = 0;
    const binding: NamespaceRegistryDiagnosticLog = {
      emitter: { emit: () => undefined }, // 本测试聚焦 initStream 失败面
      initStream: (namespaceId, genesisUpdateBytes) => {
        initCalls += 1;
        // Host 侧以真实 File adapter 建立 stream；注入非法 roll target → 真实
        // LOG_STREAM_INIT_FAILED/invalid-roll-targets 事件（绝不手工伪造该事件）。
        createFileDiagnosticLog({
          rootDir,
          namespaceId,
          genesisUpdateBytes,
          updateCapture: true,
          observer: { onEvent: (e) => health.push(e) },
          clock: { now: () => NOW_MS },
          targetRecordsPerSegment: 0,
        });
      },
    };
    const persistence = new StubPersistence();
    const registry = makeRegistry(persistence, { diagnosticLog: binding });

    const result = await registry.create(makeInput());
    const lease = okLease(result);
    expect(lease.getMetadata().createdAt).toBe(NOW_ISO);
    expect(persistence.createCalls.length).toBe(1);
    expect(registry.getStatus()).toEqual({ state: 'running' });

    // ── 红灯锚：initStream 被调用且失败经独立健康通道上报（当前 0 调用、0 事件）──
    await expect.poll(() => initCalls, { interval: 5, timeout: 3_000 }).toBe(1);
    await expect
      .poll(() => health.filter((e) => e.type === 'stream-init-failed').length, { interval: 5, timeout: 3_000 })
      .toBe(1);
    const failed = health.find((e) => e.type === 'stream-init-failed');
    expect(failed).toMatchObject({ code: 'LOG_STREAM_INIT_FAILED', reason: 'invalid-roll-targets' });

    await lease.release();
  });

  it('AC5 延迟 stream 初始化（诚实当前态 genesis）：首次 initStream 失败（LOG_STREAM_INIT_FAILED）后以当时 Y.Doc 重试建新 stream，genesis = 变更后状态', async () => {
    // ⚠ 设计勘误（SA6 R2 裁定，2026-08-31）：首版 fixture 让首次 initStream 以合法配置
    // 成功建立 S1，随后第二次 createFileDiagnosticLog 命中冻结 File adapter 的续写语义
    // （current.json locator → 健康 stream resume，构造期 genesisUpdateBytes 被忽略——
    // 文件头注释「resume 不写 genesis（genesisUpdateBytes 忽略）」）——那不是「延迟
    // stream 初始化/重试」场景，而是健康 stream 的原地续写；断言 n=2 因此错误。
    // 修正（preferred correction A）：首次 initStream 以 AC4 同款非法配置
    // （targetRecordsPerSegment:0）触发真实 LOG_STREAM_INIT_FAILED/invalid-roll-targets
    // 且零落盘（无健康 stream）——真正「延迟」：创建时 stream 未建立；ROOT 变更后
    // 再以合法配置 + 当时 Y.Doc bytes 重试建立全新 stream。诚实当前态契约（genesis
    // 只代表重试时点、不伪称从创建时起连续）保留，未被弱化为 resume 语义。
    const rootDir = freshTempRoot('ndcl-registry-late-');
    const health: DiagnosticLogHealthEvent[] = [];
    let initCalls = 0;
    const binding: NamespaceRegistryDiagnosticLog = {
      emitter: { emit: () => undefined }, // 本测试聚焦 initStream 失败→重试面
      initStream: (namespaceId, genesisUpdateBytes) => {
        initCalls += 1;
        createFileDiagnosticLog({
          rootDir,
          namespaceId,
          genesisUpdateBytes,
          updateCapture: true,
          observer: { onEvent: (e) => health.push(e) },
          clock: { now: () => NOW_MS },
          targetRecordsPerSegment: 0, // 非法 roll target → disabled + LOG_STREAM_INIT_FAILED，零文件
        });
      },
    };

    const persistence = new StubPersistence();
    const registry = makeRegistry(persistence, { diagnosticLog: binding });
    const result = await registry.create(makeInput());
    const lease = okLease(result);
    expect(lease.getMetadata().createdAt).toBe(NOW_ISO);

    // ── 红灯锚：initStream 被调用且首次建立失败（当前 0 调用/0 事件）──
    await expect.poll(() => initCalls, { interval: 5, timeout: 3_000 }).toBe(1);
    await expect
      .poll(() => health.filter((e) => e.type === 'stream-init-failed').length, { interval: 5, timeout: 3_000 })
      .toBe(1);
    expect(health.find((e) => e.type === 'stream-init-failed')).toMatchObject({
      code: 'LOG_STREAM_INIT_FAILED',
      reason: 'invalid-roll-targets',
    });

    // 业务面：变更 ROOT（n:1 → n:2）——重试时点与创建时点之间文档已变化
    const mutation = await lease.mutateData({ op: 'set', path: ['n'], value: 2 });
    expect(mutation.ok).toBe(true);

    // 延迟重试：健康 stream 尚不存在（首次失败零落盘）→ 以当时 Y.Doc 建立全新 stream。
    // 以当前文档状态取得 bytes（Host 侧经 Persistence loadDoc 访问——不带 live doc 引用泄漏）
    const handle = await persistence.loadDoc(OWNER, GENERATED_NAMESPACE_IDS.first);
    expect(handle).not.toBeNull();
    const currentState = Y.encodeStateAsUpdate(handle!.doc);
    const retryLog = createFileDiagnosticLog({
      rootDir,
      namespaceId: GENERATED_NAMESPACE_IDS.first,
      genesisUpdateBytes: currentState,
      updateCapture: true,
      observer: { onEvent: (e) => health.push(e) },
      clock: { now: () => NOW_MS },
    });
    const retryRead = readStreamStrict({ rootDir, namespaceId: GENERATED_NAMESPACE_IDS.first, streamId: retryLog.streamId });
    expect(retryRead.status).toBe('ok');
    expect(retryRead.records.length).toBe(1); // 全新 stream：仅 genesis-baseline（无 attempt、无续写嫁接）
    const retryGenesis = retryRead.records[0]!;
    const retryGenesisRec = retryGenesis.record as { recordKind?: string; sequence?: string; update?: UpdateCarrier };
    expect(retryGenesisRec.recordKind).toBe('genesis-baseline');
    expect(retryGenesisRec.sequence).toBe('1');
    const doc = materialize(retryGenesisRec.update!);
    // 诚实当前态：n=2（变更后）；若伪称「从创建时起连续」则 n=1——反向鉴别锚
    expect(doc.getMap('ROOT').get('n')).toBe(2);
    expect(doc.getMap('ROOT').get('a')).toBe('x');
    expect(doc.getMap('META').get('createdAt')).toBe(NOW_ISO);

    // 首次失败零落盘证明：streams 目录恰 1 个（重试产物，无 S1 残留）
    expect(readdirSync(join(rootDir, 'namespaces', GENERATED_NAMESPACE_IDS.first, 'streams')).length).toBe(1);

    await lease.release();
  });
});
