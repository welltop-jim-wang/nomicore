/**
 * SA7 动态验证补充套件 — issue #155（task_expose-diagnostic-replay-host-lifecycle）。
 *
 * 验证对象：SA4 R2 review「动态审核重点」六条中交 SA7 的活链路面：
 *  1. C1 并发 create 交错（SA2 R1 绿灯期增补建议）——`Promise.all([create A, create B])`、
 *     B 的 createDoc 注入 DocCreateOperationalError（A 挂 gate 控制 settle 次序）：
 *     数据键控归因下 A 流无 B 记录、A replay complete/issues=[]；附 manager 级迟到
 *     emit 直探（initStream(A) 后 B 的 emission 路由到 B 自己的流，绝不落入 A 的
 *     打开流）。
 *     2026-09-06 R3 修订（issue #226 契约重新固话，SA8 design-conflict C3 裁决）：
 *     C1 原三锚把缺陷 A 的生产行为（B 的建流前结局落 unattributed 丢弃 + B 无日志
 *     目录）断言为期望——与 #226 AC1「不再被无归属通道确定性丢弃、以正确 namespace
 *     归属进入诊断流」正面冲突。修订后：B 的结局以 NS_B 归属落 B 自己的流（attempt
 *     stage=transaction / code=NAMESPACE_CREATE_FAILED / result=rejected、目录存在）、
 *     全程零 unattributed 丢弃；A 流干净面（恰 genesis+#17、segment 无 B marker、
 *     replay complete/issues=[]）保持。修复前本用例红（缺陷 A 行为 ≠ 期望）——属于
 *     #226 全量门必红面，修复后翻绿。
 *  2. M2 篡改流形直探——手工构造 `[attempt(seq1), genesis(seq2)]` 日志文件 →
 *     replay 报 `genesis-misplaced` + `genesis-missing`、failed、无 snapshot。
 *  3. §六(a) note 运行时复核——record 级 issues 经 read.issues 镜像（③ 全量）与
 *     ④ 停止点双份进入报告（保守方向，只多不少，不影响三态判定）。
 *  4. §六(b) note 运行时复核——`fatal-committed effect:'unknown'` 记录按「其他」
 *     分支推进 lastSeq（连续计数、不 break、不产生 issue）。
 *  5. D8 健康事件面 + D1 无泛滥——真实进程（enabled 态）全生命周期 NDJSON 摘录：
 *     停机恰一次 `diagnostics-closed`；健康运行零 `diagnostic-log-emission-dropped`
 *     （生产恒提供 runtimeEmitterFor → 恒走数据键控通道，legacy fallback 分支
 *     生产不可达，其静态面由 #150 冻结契约覆盖）。
 *
 * 全部为运行时行为断言（真实 Host 管理器 + 真实 registry 测试 seam + 真实 File
 * adapter / 真实进程 spawn；无源码 grep）。[SA7-DV] 打点供动态验证报告摘录。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { DocCreateOperationalError } from '@nomicore/persistence';
import type { DocHandle, DocPersistence, User } from '@nomicore/persistence';
import { createNamespaceRegistryForTesting, createRegistryTestScheduler } from '@nomicore/namespace-registry/testing';
import type { CreateNamespaceInput, NamespaceLease } from '@nomicore/namespace-registry';
import { createHostDiagnosticsManager } from '../src/diagnostics.js';
import { replayNamespaceDiagnosticLog } from '../src/index.js';
import {
  createFileDiagnosticLog,
  readStreamStrict,
  type NamespaceDiagnosticChangeEmission,
} from '../../../packages/namespace-diagnostic-log/src/index.js';

// ── 固定夹具（对齐 #150 SA7 套件与 SA6 红灯契约文件同款）────────────────────

const NOW_MS = 1_700_000_000_000;

const OWNER: Readonly<{ userId: string }> = Object.freeze({ userId: 'u-alice' });
const SCHEMA_A = Object.freeze({
  lang: 'vfsl',
  version: 1,
  id: 'ns-a-schema',
  text: 'type ROOT = { count: number; };\n',
});
/** B 专属 schema id——任何跨 namespace 泄漏记录都会以该字面量暴露。 */
const SCHEMA_B = Object.freeze({
  lang: 'vfsl',
  version: 1,
  id: 'ns-b-schema-leak-marker',
  text: 'type ROOT = { count: number; };\n',
});
const ROOT0 = Object.freeze({ count: 0 });

const NS_A = 'ns-00000000000000000000000000000001';
const NS_B = 'ns-00000000000000000000000000000002';
const NS_PROBE_A = 'ns-0000000000000000000000000000000a';
const NS_PROBE_B = 'ns-0000000000000000000000000000000b';

const tempRoots: string[] = [];

function freshTempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

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

// ── Persistence stub：按 docId 键控 gate/error（与调用次序解耦——确定性注入）──

class StubHandle implements DocHandle {
  constructor(
    readonly owner: User,
    readonly docId: string,
    readonly doc: Y.Doc,
  ) {}
  getStatus(): 'ready' {
    return 'ready';
  }
  release(): Promise<void> {
    return Promise.resolve();
  }
}

interface CreatePlan {
  gate?: Deferred;
  error?: unknown;
}

class PlannedPersistence implements DocPersistence {
  readonly createCalls: string[] = [];
  private readonly plans = new Map<string, CreatePlan>();

  planCreate(docId: string, plan: CreatePlan): void {
    this.plans.set(docId, plan);
  }

  async createDoc(owner: User, docId: string, doc: Y.Doc): Promise<DocHandle> {
    this.createCalls.push(docId);
    const plan = this.plans.get(docId);
    if (plan?.gate !== undefined) {
      await plan.gate.promise;
    }
    if (plan?.error !== undefined) {
      throw plan.error;
    }
    return new StubHandle(owner, docId, doc);
  }

  async loadDoc(): Promise<DocHandle | null> {
    return null;
  }

  async saveDoc(): Promise<void> {
    /* no-op */
  }
}

type SinkEvent = Record<string, unknown>;

function makeHost(rootDir: string): {
  host: ReturnType<typeof createHostDiagnosticsManager>;
  events: SinkEvent[];
} {
  const events: SinkEvent[] = [];
  const host = createHostDiagnosticsManager(
    { enabled: true, rootDir, updateCapture: true, inputPolicy: 'digest' },
    { sink: (e) => void events.push(e), now: () => NOW_MS },
  );
  return { host, events };
}

function makeRegistry(persistence: DocPersistence, diagnosticLog: unknown) {
  return createNamespaceRegistryForTesting(persistence, {
    clock: { now: () => NOW_MS },
    scheduler: createRegistryTestScheduler(),
    randomBytes: makeDeterministicRandomBytes(),
    diagnosticLog: diagnosticLog as never,
  } as never);
}

function inputFor(schema: unknown = SCHEMA_A): CreateNamespaceInput {
  return { owner: OWNER, schema, root: ROOT0 };
}

function segmentFile(rootDir: string, namespaceId: string, streamId: string): string {
  return join(rootDir, 'namespaces', namespaceId, 'streams', streamId, 'segments', '00000001.jsonl');
}

function currentStreamIdOf(rootDir: string, namespaceId: string): string {
  const locator = JSON.parse(
    readFileSync(join(rootDir, 'namespaces', namespaceId, 'current.json'), 'utf8'),
  ) as { streamId: string };
  return locator.streamId;
}

let attemptCounter = 0;
function emissionFor(
  operation: 'namespace-create' | 'root-mutation',
  result:
    | { kind: 'committed'; effect: 'update'; updateBytes: Uint8Array }
    | { kind: 'fatal'; committed: true; effect: 'unknown' },
): NamespaceDiagnosticChangeEmission {
  attemptCounter += 1;
  const hex = attemptCounter.toString(16).padStart(32, '0').slice(0, 32);
  return {
    operation,
    stage: 'transaction',
    observedAt: new Date(NOW_MS).toISOString(),
    attemptId: `att-${hex}`,
    source: { kind: 'local' },
    result,
  };
}

function makeProdDoc(namespaceId: string, count: number): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('META').set('docId', namespaceId);
  doc.getMap('ROOT').set('count', count);
  return doc;
}

// ─────────────────────────────────────────────────────────────────────────────
// 重点 1 — C1 并发 create 交错（SA2 R1 建议 / SA4 动态重点 2）
// ─────────────────────────────────────────────────────────────────────────────

describe('SA7 动态重点 1 — C1 并发 create 交错（数据键控归因，跨 namespace 误归因不可达）', () => {
  it(
    'Promise.all([create A(挂 gate), create B(createDoc 注入 OperationalError)])：B 以 NS_B 归属落自己的流（attempt transaction/NAMESPACE_CREATE_FAILED/rejected、目录存在）；全程零 unattributed 丢弃；A 流干净（genesis+#17、无 B marker、replay complete/issues=[]）',
    async () => {
      const rootDir = freshTempRoot('sa7-226-c1-');
      const { host, events } = makeHost(rootDir);
      const persistence = new PlannedPersistence();
      const gate = deferred();
      persistence.planCreate(NS_A, { gate }); // A 挂在 createDoc——B 先结算
      persistence.planCreate(NS_B, { error: new DocCreateOperationalError(new Error('injected B operational failure')) });
      const registry = makeRegistry(persistence, host.binding);

      const pA = registry.create(inputFor());
      const pB = registry.create(inputFor(SCHEMA_B));
      // B 在 A 仍处槽内（createDoc 未返回）时结算失败——R0 C1 攻击窗的构造次序。
      const b = (await pB) as { ok: boolean; code?: string };
      expect(b.ok).toBe(false);
      expect(b.code).toBe('NAMESPACE_CREATE_FAILED');
      // R3 修订锚（2026-09-06，#226 后语义）：B 的建流前结局不再落无归属通道——
      // 修复前此处恰 1 条 unattributed drop（缺陷 A 冻结锚已翻转）。修复后零丢弃；
      // drop 只会多不会少，「恰 0」断言与修复后投递到达时机正交（无异步伪红）。
      const dropsEarly = events.filter((e) => e.event === 'diagnostic-log-emission-dropped');
      expect(dropsEarly).toHaveLength(0);

      gate.resolve();
      const a = (await pA) as { ok: boolean; lease?: NamespaceLease };
      expect(a.ok).toBe(true);
      expect(a.lease?.namespaceId).toBe(NS_A);

      // A 流：genesis + #17 namespace-create committed，恰 2 条、sequence 连续。
      // 修复后 A 的建流/记录由延迟投递产生（#226 隔离载体）→ 先 poll current.json
      // 到达再读（poll 让出事件循环 → drain 执行；到达即该 ns 批次已同步完成）。
      await expect
        .poll(() => existsSync(join(rootDir, 'namespaces', NS_A, 'current.json')), { interval: 10, timeout: 3_000 })
        .toBe(true);
      const streamId = currentStreamIdOf(rootDir, NS_A);
      const read = readStreamStrict({ rootDir, namespaceId: NS_A, streamId });
      expect(read.status).toBe('ok');
      expect(read.issues).toEqual([]);
      const records = read.records.map((r) => r.record).filter((r): r is Record<string, unknown> => r !== null);
      expect(records.map((r) => r.sequence)).toEqual(['1', '2']);
      expect(records[0]!.recordKind).toBe('genesis-baseline');
      expect(records[1]).toMatchObject({ recordKind: 'attempt', operation: 'namespace-create' });
      expect((records[1]!.result as { kind?: string }).kind).toBe('committed');
      // A 流无 B 痕迹：segment 全文不含 B 专属 schema marker
      const aSegmentText = readFileSync(segmentFile(rootDir, NS_A, streamId), 'utf8');
      expect(aSegmentText.includes('ns-b-schema-leak-marker')).toBe(false);

      // R3 修订锚：B 的结局以 NS_B 归属落 B 自己的流（修复前 B 无日志目录 → 红）。
      // genesis-less 流（ADR-0012：genesis 未成功写入时 stream 仍可记录诊断事实）
      // 的读取形态先例 = 本文件 C1b（status 'ok'、单 attempt 记录）——不锚 replay
      // complete（无 genesis 时诚实缺席）。
      await expect
        .poll(() => existsSync(join(rootDir, 'namespaces', NS_B, 'current.json')), { interval: 10, timeout: 3_000 })
        .toBe(true);
      const bStreamId = currentStreamIdOf(rootDir, NS_B);
      const bRead = readStreamStrict({ rootDir, namespaceId: NS_B, streamId: bStreamId });
      expect(bRead.status).toBe('ok');
      const bRecords = bRead.records.map((r) => r.record).filter((r): r is Record<string, unknown> => r !== null);
      expect(bRecords).toHaveLength(1);
      expect(bRecords[0]).toMatchObject({
        recordKind: 'attempt',
        operation: 'namespace-create',
        stage: 'transaction',
        code: 'NAMESPACE_CREATE_FAILED',
      });
      expect((bRecords[0]!.result as { kind?: string }).kind).toBe('rejected');

      // A replay：complete + issues==[]（SA2 R1 建议的原始断言面）
      const replay = replayNamespaceDiagnosticLog({ rootDir, namespaceId: NS_A });
      expect(replay.status).toBe('complete');
      expect(replay.issues).toEqual([]);
      expect(replay.lastAppliedSequence).toBe('2');
      expect(replay.snapshot).toBeInstanceOf(Uint8Array);
      const replayed = new Y.Doc();
      Y.applyUpdate(replayed, replay.snapshot as Uint8Array);
      expect(replayed.getMap('META').get('docId')).toBe(NS_A);
      expect(replayed.getMap('ROOT').get('count')).toBe(0);

      // 全程丢弃计数：0 条 unattributed（R3 修订锚）；零 stream-unavailable / manager-failed
      const drops = events.filter((e) => e.event === 'diagnostic-log-emission-dropped');
      expect(drops).toHaveLength(0);
      expect(events.filter((e) => e.event === 'diagnostic-log-manager-failed')).toHaveLength(0);
      console.log(
        `[SA7-DV] C1 并发交错：A 流 ${records.length} 条记录（genesis+#17）；B 流 ${bRecords.length} 条（NS_B 归属 attempt）；sink 事件 ${JSON.stringify(events)}`,
      );

      await a.lease!.release();
      await registry.shutdown();
      host.close();
    },
    30_000,
  );

  it('manager 级迟到 emit 直探：initStream(A) 后 B 的 emission 经 runtimeEmitterFor(B) 落 B 自己的流，A 的打开流零污染', () => {
    const rootDir = freshTempRoot('sa7-155-c1b-');
    const { host, events } = makeHost(rootDir);

    const docA = makeProdDoc(NS_PROBE_A, 1);
    host.binding.initStream?.(NS_PROBE_A, Y.encodeStateAsUpdate(docA));
    // A 流已建立后，B 的迟到 emission 到达——数据键控解析（无共享可变路由状态）
    const resolver = host.binding.runtimeEmitterFor;
    expect(resolver).toBeDefined(); // 生产管理器恒提供（D1：legacy fallback 分支生产不可达）
    const bEmitter = resolver!(NS_PROBE_B);
    expect(bEmitter).toBeDefined();
    const docB = makeProdDoc(NS_PROBE_B, 1);
    const sv = Y.encodeStateVector(docB);
    docB.getMap('ROOT').set('count', 9);
    bEmitter!.emit({
      operation: 'root-mutation',
      stage: 'transaction',
      observedAt: new Date(NOW_MS).toISOString(),
      attemptId: 'att-' + 'c'.repeat(32),
      source: { kind: 'local' },
      result: { kind: 'committed', effect: 'update', updateBytes: Y.encodeStateAsUpdate(docB, sv) },
    });

    const streamA = currentStreamIdOf(rootDir, NS_PROBE_A);
    const readA = readStreamStrict({ rootDir, namespaceId: NS_PROBE_A, streamId: streamA });
    expect(readA.status).toBe('ok');
    expect(readA.records).toHaveLength(1); // 仅 genesis——B 的记录绝不在 A 流
    expect((readA.records[0]!.record as { recordKind?: string }).recordKind).toBe('genesis-baseline');

    const streamB = currentStreamIdOf(rootDir, NS_PROBE_B);
    const readB = readStreamStrict({ rootDir, namespaceId: NS_PROBE_B, streamId: streamB });
    expect(readB.status).toBe('ok');
    expect(readB.records).toHaveLength(1);
    expect((readB.records[0]!.record as { recordKind?: string }).recordKind).toBe('attempt');
    expect(readFileSync(segmentFile(rootDir, NS_PROBE_A, streamA), 'utf8').includes('att-')).toBe(false);

    expect(events.filter((e) => e.event === 'diagnostic-log-emission-dropped')).toHaveLength(0); // 数据通道命中——零丢弃
    host.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 重点 2 — M2 篡改流形直探（SA4 动态重点 3）
// ─────────────────────────────────────────────────────────────────────────────
describe('SA7 动态重点 2 — M2 篡改流形：[attempt(seq1), genesis(seq2)] 直探', () => {
  it('前置 attempt 的 genesis 拒作基线：genesis-misplaced + genesis-missing、failed、无 snapshot、lastAppliedSequence=null', () => {
    const rootDir = freshTempRoot('sa7-155-m2-');
    const prod = makeProdDoc(NS_A, 1);
    const log = createFileLog(rootDir, Y.encodeStateAsUpdate(prod));
    const sv = Y.encodeStateVector(prod);
    prod.getMap('ROOT').set('count', 5);
    log.emitter.emit(
      emissionFor('root-mutation', { kind: 'committed', effect: 'update', updateBytes: Y.encodeStateAsUpdate(prod, sv) }),
    );

    // 手工篡改：attempt 行提至首位并占 seq1、genesis 行后移至 seq2（reader 连续性 1,2 仍成立——
    // 攻击面专打 replay 的 M2 mid-genesis 判定，而非 reader 缺口检测）
    const streamId = currentStreamIdOf(rootDir, NS_A);
    const segPath = segmentFile(rootDir, NS_A, streamId);
    const lines = readFileSync(segPath, 'utf8').split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(2); // genesis + attempt
    const genesisLine = JSON.parse(lines[0]!) as Record<string, unknown>;
    const attemptLine = JSON.parse(lines[1]!) as Record<string, unknown>;
    expect(genesisLine.recordKind).toBe('genesis-baseline');
    expect(attemptLine.recordKind).toBe('attempt');
    attemptLine.sequence = '1';
    genesisLine.sequence = '2';
    writeFileSync(segPath, `${JSON.stringify(attemptLine)}\n${JSON.stringify(genesisLine)}\n`);

    const replay = replayNamespaceDiagnosticLog({ rootDir, namespaceId: NS_A });
    expect(replay.status).toBe('failed');
    expect(replay.issues).toEqual([{ code: 'genesis-misplaced' }, { code: 'genesis-missing' }]);
    expect(replay.lastAppliedSequence).toBeNull();
    expect(replay.snapshot).toBeUndefined();
  });
});

function createFileLog(rootDir: string, genesisBytes?: Uint8Array) {
  return createFileDiagnosticLog({
    rootDir,
    namespaceId: NS_A,
    updateCapture: true,
    ...(genesisBytes !== undefined ? { genesisUpdateBytes: genesisBytes } : {}),
    clock: { now: () => NOW_MS },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 重点 3 — §六(a) note：record 级 issues 双份进入报告（镜像 ③ 全量 + 停止点 ④）
// ─────────────────────────────────────────────────────────────────────────────

describe('SA7 动态重点 3 — issues 镜像双份运行时复核（保守方向：只多不少，不影响三态）', () => {
  it('中段两行垃圾：invalid-json 恰 3 份（镜像 2 + 停止点 1）、partial、lastAppliedSequence 停在停止点前、snapshot 仍在', () => {
    const rootDir = freshTempRoot('sa7-155-mirror-');
    const prod = makeProdDoc(NS_A, 1);
    const log = createFileLog(rootDir, Y.encodeStateAsUpdate(prod));
    const sv = Y.encodeStateVector(prod);
    prod.getMap('ROOT').set('count', 5);
    log.emitter.emit(
      emissionFor('root-mutation', { kind: 'committed', effect: 'update', updateBytes: Y.encodeStateAsUpdate(prod, sv) }),
    );

    const streamId = currentStreamIdOf(rootDir, NS_A);
    const segPath = segmentFile(rootDir, NS_A, streamId);
    const lines = readFileSync(segPath, 'utf8').split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(2); // genesis + 1 update
    writeFileSync(segPath, `${[...lines, 'garbage-line-a', 'garbage-line-b'].join('\n')}\n`);

    const replay = replayNamespaceDiagnosticLog({ rootDir, namespaceId: NS_A });
    expect(replay.status).toBe('partial'); // 有重放基（genesis+update 已应用）但不完整
    const codes = replay.issues.map((i) => i.code);
    expect(codes.filter((c) => c === 'invalid-json')).toHaveLength(3); // 镜像 2（③ 全量）+ 停止点 1（④）
    expect(codes.every((c) => c === 'invalid-json')).toBe(true);
    expect(replay.lastAppliedSequence).toBe('2'); // 停在停止点前——停止点之后的发现不再进入（m2）
    expect(replay.snapshot).toBeInstanceOf(Uint8Array); // 有重放基 → snapshot 仍诚实给出
    console.log(`[SA7-DV] §六(a) 镜像双份实测：issues=${JSON.stringify(replay.issues)} status=${replay.status}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 重点 4 — §六(b) note：fatal-committed effect:'unknown' 推进语义
// ─────────────────────────────────────────────────────────────────────────────

describe('SA7 动态重点 4 — fatal-committed effect:unknown 按「其他」分支推进（连续计数、不 break）', () => {
  it('健康链中段含 fatal-unknown 记录：complete、issues=[]、lastAppliedSequence 计入该记录、快照复现终态', () => {
    const rootDir = freshTempRoot('sa7-155-fatal-');
    const prod = makeProdDoc(NS_A, 1);
    const log = createFileLog(rootDir, Y.encodeStateAsUpdate(prod));
    let sv = Y.encodeStateVector(prod);
    prod.getMap('ROOT').set('count', 5);
    log.emitter.emit(
      emissionFor('root-mutation', { kind: 'committed', effect: 'update', updateBytes: Y.encodeStateAsUpdate(prod, sv) }),
    );
    // committed:true 且 bytes 缺席 → effect:'unknown'（fatalFromBytes 同形——record.ts:98 形状）
    log.emitter.emit(emissionFor('root-mutation', { kind: 'fatal', committed: true, effect: 'unknown' }));
    sv = Y.encodeStateVector(prod);
    prod.getMap('ROOT').set('count', 9);
    log.emitter.emit(
      emissionFor('root-mutation', { kind: 'committed', effect: 'update', updateBytes: Y.encodeStateAsUpdate(prod, sv) }),
    );

    const replay = replayNamespaceDiagnosticLog({ rootDir, namespaceId: NS_A });
    expect(replay.status).toBe('complete');
    expect(replay.issues).toEqual([]);
    expect(replay.lastAppliedSequence).toBe('4'); // genesis=1, update=2, fatal-unknown=3（推进）, update=4
    expect(replay.snapshot).toBeInstanceOf(Uint8Array);
    const replayed = new Y.Doc();
    Y.applyUpdate(replayed, replay.snapshot as Uint8Array);
    expect(replayed.getMap('ROOT').get('count')).toBe(9);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 重点 5 — D8 健康事件面 + D1 无泛滥（真实进程，enabled 态全生命周期 NDJSON 摘录）
// ─────────────────────────────────────────────────────────────────────────────

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const TSX_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
const MAIN_TS = join(REPO_ROOT, 'apps', 'yjs-server', 'src', 'main.ts');

// 进程级 E2E 的子进程必须以仓库规范的 nomicore-source export condition 解析
// workspace 包源码（等价于根 package.json `test` 脚本的
// NODE_OPTIONS=--conditions=nomicore-source）。dist/ 是 gitignored 的发布产物、
// pnpm install 不会生成；若子进程缺少该 condition，Node ESM 将按 exports
// `import` → `./dist/index.js` 解析并在缺失时报 ERR_MODULE_NOT_FOUND 而无法启动。
// 在 spawn env 中钉住该 condition 使 E2E 不依赖外层 vitest 的调用方式
// （根脚本 env 或裸 `vitest run` 均可，行为与规范 env 完全一致）。
const SPAWN_NODE_OPTIONS = (() => {
  const existing = process.env.NODE_OPTIONS ?? '';
  return existing.includes('conditions=nomicore-source')
    ? existing
    : `${existing} --conditions=nomicore-source`.trim();
})();

const VFSL_SCHEMA = { lang: 'vfsl', version: 1, id: 'notes-v1', text: 'type ROOT = { count: number; };\n' };

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
  child.stderr!.on('data', (chunk: Buffer) => proc.stderr.push(chunk.toString('utf8')));
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
      throw new Error(`process exited ${proc.exitCode} before ${what}\nstderr:${proc.stderr.join('')}`);
    }
    if (Date.now() - start > timeoutMs) throw new Error(`timeout ${timeoutMs}ms waiting for ${what}`);
    await sleep(50);
  }
}

let e2eOpCounter = 0;
async function sendOp(proc: Proc, op: Record<string, unknown>): Promise<Record<string, unknown>> {
  const id = `sa7-155-e2e-${++e2eOpCounter}`;
  proc.child.stdin!.write(`${JSON.stringify({ ...op, id })}\n`);
  for (;;) {
    const hit = proc.events.find((e) => e.event === 'reply' && e.id === id);
    if (hit) return hit;
    if (proc.exitCode !== null) throw new Error(`process exited ${proc.exitCode} awaiting reply`);
    await sleep(50);
  }
}

describe('SA7 动态重点 5 — D8 健康事件面 + D1 无泛滥（enabled 态进程级 NDJSON 摘录）', () => {
  it(
    '启用态全生命周期：provision→write→SIGTERM exit 0；停机恰一次 diagnostics-closed；健康运行零 emission-dropped；数据通道记录落地',
    async () => {
      const persistRoot = freshTempRoot('sa7-155-d8-persist-');
      const logRoot = freshTempRoot('sa7-155-d8-log-');
      const cfgDir = freshTempRoot('sa7-155-d8-cfg-');
      const port = await freePort();
      const config = {
        role: 'hub',
        instanceId: 'hub-1',
        persistence: { kind: 'file', rootDir: persistRoot },
        hub: {
          listen: { host: '127.0.0.1', port },
          tokens: { 'peer-1': 'token-1' },
          provision: [{ id: 'p1', ownerUserId: 'alice', schema: VFSL_SCHEMA, root: { count: 0 } }],
        },
        diagnostics: { enabled: true, rootDir: logRoot, updateCapture: true, inputPolicy: 'digest' },
      };
      const configPath = join(cfgDir, 'config.json');
      writeFileSync(configPath, JSON.stringify(config, null, 2));

      const hub = spawnApp(['--config', configPath]);
      const provisioned = await waitForEvent(hub, (e) => e.event === 'provisioned', 60_000, 'hub provisioned');
      const namespaceId = provisioned.namespaceId as string;
      await waitForEvent(hub, (e) => e.event === 'ready', 60_000, 'hub ready');
      const writeReply = await sendOp(hub, {
        op: 'verify-write',
        namespaceId,
        set: ['count'],
        path: ['count'],
        value: 7,
        timeoutMs: 30_000,
      });
      expect(writeReply.ok).toBe(true);

      // 数据通道记录落地（enabled 态真实写日志——零丢弃断言因此有载荷意义）
      //
      // 【issue #226 到达 poll 化（SA2 obs 5.1 预先登记的执行，2026-09-06）】：SA2
      // §5.1 已登记「verify-write 回复后无 poll 同步读流」为修复后唯一不带 poll 保护的
      // 跨进程读时序点，并预授权「若历史性偶发，按到达 poll 化处理（属 #155 文件非 C1
      // 用例的微调）」。全量门高负载轮偶发命中（写入的 pump drain 晚于回复到达）。
      // 先 poll root-mutation 记录落盘（poll 让出事件循环 → drain 执行；亦保证 SIGTERM
      // 前子进程 drain 已排空——避免 SIGTERM 落在 tsx 信号中继窗内）再读——断言本体零改动。
      await expect
        .poll(
          () => {
            try {
              const sid = currentStreamIdOf(logRoot, namespaceId);
              const read = readStreamStrict({ rootDir: logRoot, namespaceId, streamId: sid });
              if (read.status !== 'ok') return false;
              const ops = read.records
                .map((r) => r.record)
                .filter(
                  (r): r is Record<string, unknown> =>
                    r !== null && (r as { recordKind?: string }).recordKind === 'attempt',
                )
                .map((r) => r.operation);
              return ops.includes('root-mutation');
            } catch {
              return false; // 写入窗口内撕裂读/current.json 未达 → 重试
            }
          },
          { interval: 20, timeout: 5_000 },
        )
        .toBe(true);
      const streamId = currentStreamIdOf(logRoot, namespaceId);
      const read = readStreamStrict({ rootDir: logRoot, namespaceId, streamId });
      expect(read.status).toBe('ok');
      expect((read.records[0]!.record as { recordKind?: string }).recordKind).toBe('genesis-baseline');
      const ops = read.records
        .map((r) => r.record)
        .filter((r): r is Record<string, unknown> => r !== null && (r as { recordKind?: string }).recordKind === 'attempt')
        .map((r) => r.operation);
      expect(ops).toContain('root-mutation');

      // 停机前快照：健康运行期零丢弃、零 manager-failed
      expect(hub.events.filter((e) => e.event === 'diagnostic-log-emission-dropped')).toHaveLength(0);
      expect(hub.events.filter((e) => e.event === 'diagnostic-log-manager-failed')).toHaveLength(0);

      hub.child.kill('SIGTERM');
      const start = Date.now();
      while (hub.exitCode === null) {
        if (Date.now() - start > 30_000) {
          hub.child.kill('SIGKILL');
          throw new Error('timeout waiting for SIGTERM exit');
        }
        await sleep(50);
      }
      expect(hub.exitCode).toBe(0);

      const diagEvents = hub.events.filter((e) => typeof e.event === 'string' && (e.event as string).startsWith('diagnostic'));
      console.log(`[SA7-DV] D8 enabled 态全生命周期 diagnostic* NDJSON 事件流：${JSON.stringify(diagEvents)}`);
      expect(diagEvents.filter((e) => e.event === 'diagnostics-closed')).toHaveLength(1);
      expect(diagEvents.filter((e) => e.event === 'diagnostic-log-emission-dropped')).toHaveLength(0);
    },
    300_000,
  );
});

afterEach(() => {
  for (const proc of liveProcs.splice(0)) {
    if (proc.exitCode === null) proc.child.kill('SIGKILL');
  }
});
