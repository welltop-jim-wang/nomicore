/**
 * SA3 新增覆盖 — issue #249（设计 task_249_design.md §13.3 a–d；批准输入：design
 * clear + SA8 设计后复审 clear + SA2 approve + SA6 R1 对齐完成；HEAD ac91a6b）。
 *
 * 本文件承载设计 §13.3 要求随 SA3 实现落地的新增覆盖（绿灯锁定——修复后行为回归
 * 锁，非红灯契约；红灯契约载体为 SA6 两文件 registry-issue-249-pump-red /
 * -duplicate-red）：
 *
 * - §13.3-a R3-3：满 emit 队列 + 追加 init-stream 任务 → 被丢 → `reportDrop({kind:
 *   'init-stream', reason:'queue-full'})` 恰一次（无 operation 字段——建流无词表位，
 *   诚实缺席）；被丢建流任务从未执行（pump 单元级，SA6 R1 对齐证据 §2.3 预留槽位）。
 * - §13.3-b observer 落点锁：registry 级测试——注入 observer，制造满队丢弃 → 收到
 *   `{type:'diag-pump-drop', taskKind, operation?, reason}`；载荷**不含**
 *   namespaceId/streamId/token（低基数锁——事件键集恰四维封闭）；observer throw 时
 *   业务结果与后续投递零影响（隔离锁——dispatchObserver try/catch + 泵侧 reportDrop
 *   try/catch 双层防御）。
 * - §13.3-c legacy no-op 锁：legacy seam 形状（共享 emitter、无 runtimeEmitterFor）
 *   下 entry collision + DOC_DUPLICATE 内部重试 → attempt 记录仍只含每次成功 create
 *   的恰一条最终结局（把设计 §6.5 裁决 D-1 钉为契约）。
 * - §13.3-d sourceModule 成对锁：DOC_DUPLICATE 候选记录 `code==='DOC_DUPLICATE'` 且
 *   `sourceModule==='persistence'`、stage 'transaction'；entry collision 候选记录
 *   `code==='NAMESPACE_ALREADY_EXISTS'` 且 `sourceModule==='registry'`、stage
 *   'identity'（防单侧缺失被管线静默丢字段——pipeline §10-J3 code↔sourceModule 成对）。
 *
 * 载体：真实 registry testing seam + 真实 src/diag-pump.ts；scripted randomBytes 定
 * 候选 id；真实 setImmediate 有界沉降（与 SA6 契约同款时序策略）。零产品代码改动
 * （本文件只锚已落地实现的行为面）。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { DocDuplicateError } from '@nomicore/persistence';
import type { DocHandle, DocPersistence, User } from '@nomicore/persistence';
import { createNamespaceRegistryForTesting, createRegistryTestScheduler } from '@nomicore/namespace-registry/testing';
import { createDiagPump, type DiagPumpDropReport } from '../src/diag-pump.js';
import type { RegistryObserver, RegistryObserverEvent } from '../src/observer.js';
import type {
  NamespaceDiagnosticChangeEmission,
  NamespaceDiagnosticChangeEmitter,
} from '../../namespace-diagnostic-log/src/index.js';

const NOW_MS = 1_700_000_000_000;
const OWNER: Readonly<{ userId: string }> = Object.freeze({ userId: 'u-alice' });
const ENVELOPE = Object.freeze({
  lang: 'vfsl',
  version: 1,
  id: 'ns-1',
  text: 'type ROOT = { n: number; a: string; };\n',
});
const ROOT0 = Object.freeze({ n: 1, a: 'x' });
const NS_A = 'ns-00000000000000000000000000000001';
const NS_B = 'ns-00000000000000000000000000000002';

/** scripted 确定性 randomBytes：每次调用弹出下一个计数（bytes[15]）；耗尽后重复末值。 */
function scriptedIds(counters: number[]): () => Uint8Array {
  let index = 0;
  return () => {
    // noUncheckedIndexedAccess（tsconfig.typecheck.json 编译面）：数组索引读为
    // number|undefined——计数器恒存在（空数组不可达），非空断言为类型机械修正。
    const value = counters[Math.min(index, counters.length - 1)]!;
    index += 1;
    const bytes = new Uint8Array(16);
    bytes[15] = value;
    return bytes;
  };
}

function emission(seq: number): NamespaceDiagnosticChangeEmission {
  return {
    operation: 'namespace-create',
    stage: 'transaction',
    observedAt: '2026-09-06T00:00:00.000Z',
    attemptId: String(seq).padStart(4, '0'),
    source: { kind: 'local' },
    input: { status: 'not-accessed' },
    result: { kind: 'committed', effect: 'noop' },
  };
}

function makeInput(): { owner: Readonly<{ userId: string }>; schema: unknown; root: unknown } {
  return { owner: OWNER, schema: ENVELOPE, root: ROOT0 };
}

/** 沉降 diag pump：有界真实 setImmediate 轮（drain 在 check 阶段执行）。 */
async function settleDiagPump(rounds = 12): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
  }
}

async function flushMicrotasks(times = 24): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

/** 生产形状 diagnostic host（泵路径 binding：runtimeEmitterFor 数据键控）。 */
interface DiagHost {
  readonly binding: {
    readonly emitter: NamespaceDiagnosticChangeEmitter;
    readonly initStream: (namespaceId: string, genesisUpdateBytes: Uint8Array | undefined) => void;
    readonly runtimeEmitterFor: (namespaceId: string) => NamespaceDiagnosticChangeEmitter | undefined;
  };
  readonly nsRecords: Map<string, NamespaceDiagnosticChangeEmission[]>;
  readonly initStreamCalls: Array<{ ns: string; genesis: boolean }>;
  unattributedDrops: number;
}

function makeDiagHost(): DiagHost {
  const nsRecords = new Map<string, NamespaceDiagnosticChangeEmission[]>();
  const initStreamCalls: Array<{ ns: string; genesis: boolean }> = [];
  const emitters = new Map<string, NamespaceDiagnosticChangeEmitter>();
  const host: DiagHost = {
    nsRecords,
    initStreamCalls,
    unattributedDrops: 0,
    binding: {
      emitter: {
        emit: () => {
          host.unattributedDrops += 1;
        },
      },
      initStream: (ns, genesis) => {
        initStreamCalls.push({ ns, genesis: genesis !== undefined });
      },
      runtimeEmitterFor: (ns) => {
        const cached = emitters.get(ns);
        if (cached !== undefined) return cached;
        const emitter: NamespaceDiagnosticChangeEmitter = {
          emit: (e) => {
            const list = nsRecords.get(ns) ?? [];
            list.push(e);
            nsRecords.set(ns, list);
          },
        };
        emitters.set(ns, emitter);
        return emitter;
      },
    },
  };
  return host;
}

// ── persistence stub（duplicate 编排）────────────────────────────────────────

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

interface PersistencePlan {
  readonly duplicateDocIds?: ReadonlySet<string>;
}

class StubPersistence implements DocPersistence {
  readonly createCalls: Array<{ owner: User; docId: string }> = [];
  private readonly plan: PersistencePlan;

  constructor(plan: PersistencePlan = {}) {
    this.plan = plan;
  }

  async createDoc(owner: User, docId: string, doc: Y.Doc): Promise<DocHandle> {
    this.createCalls.push({ owner, docId });
    if (this.plan.duplicateDocIds?.has(docId)) {
      throw new DocDuplicateError(`DOC_DUPLICATE: ${docId}`);
    }
    return new StubHandle(owner, docId, doc);
  }

  async loadDoc(): Promise<DocHandle | null> {
    return null;
  }

  async saveDoc(): Promise<void> {
    /* not under test */
  }
}

// ── §13.3-a R3-3：init-stream 丢弃上报（pump 单元级）────────────────────────

describe('issue-249 §13.3-a — R3-3 init-stream queue-full drop is reported exactly once (no operation field)', () => {
  it('drops the init-stream task on a full queue, reports {kind:init-stream, reason:queue-full} once, never executes it', async () => {
    const delivered: string[] = [];
    const initStreamCalls: Array<{ ns: string; genesis: boolean }> = [];
    const reports: DiagPumpDropReport[] = [];
    const pump = createDiagPump({
      defer: (callback) => {
        setImmediate(callback);
      },
      initStream: (ns, genesis) => {
        initStreamCalls.push({ ns, genesis: genesis !== undefined });
      },
      resolveEmitter: () => {
        return { emit: (e) => delivered.push(e.attemptId ?? '?') };
      },
      reportDrop: (drop) => reports.push(drop),
    });
    for (let i = 0; i < 256; i += 1) pump.enqueueEmit(NS_A, emission(i)); // 队列排满（per-ns 容量 256）
    pump.enqueueInitStream(NS_A, undefined); // 追加 init-stream 任务 → 被丢（drop-newest）
    // AC3/ADR-0011 L25：恰一次上报；载荷为 init-stream 变体——无 operation（建流无词表位）
    expect(reports.length).toBe(1);
    expect(reports[0]!.kind).toBe('init-stream');
    expect(reports[0]!.reason).toBe('queue-full');
    expect('operation' in reports[0]!).toBe(false);
    await settleDiagPump();
    // 已接纳的 256 条 emit 任务保序投递；被丢的建流任务从未执行
    expect(delivered.length).toBe(256);
    expect(delivered[0]).toBe('0000');
    expect(delivered[255]).toBe('0255');
    expect(initStreamCalls.length).toBe(0);
  });
});

// ── §13.3-b observer 落点锁（registry 级：满队丢弃 → diag-pump-drop 事件）────

describe('issue-249 §13.3-b — observer landing lock: diag-pump-drop event, low-cardinality payload, throw isolation', () => {
  /**
   * 制造满队丢弃的 registry 级编排：runtime factory（槽内、泵 drain 之前）经
   * Runtime 诊断 wrapper（resolveRuntimeDiag 第三参）同步 burst enqueue。队列在
   * factory 入场时已含 create#1 的 init-stream 任务（1/256）→ 256 条 burst 中
   * 255 条被接纳（队列满）、1 条被丢（上报 #1）；factory 返回后成功路径的
   * committed emission（emitStreamOutcome）再入队 → 队列已满 → 被丢（上报 #2）。
   * 全部丢弃上报同步发生（enqueue 槽内），无需沉降即可断言事件；投递面随后经
   * settleDiagPump 沉降核验（init-stream + 255 条接纳记录）。
   */
  function assemblePumpBurst(observer: RegistryObserver | undefined) {
    const host = makeDiagHost();
    const persistence = new StubPersistence();
    const registry = createNamespaceRegistryForTesting(
      persistence,
      {
        clock: { now: () => NOW_MS },
        scheduler: createRegistryTestScheduler(),
        randomBytes: scriptedIds([1]),
        runtimeFactory: (_handle: unknown, _notifyDirty: unknown, diag: unknown) => {
          const wrapper = diag as { emitter?: NamespaceDiagnosticChangeEmitter } | undefined;
          const emitter = wrapper?.emitter;
          if (emitter !== undefined) {
            for (let i = 0; i < 256; i += 1) emitter.emit(emission(i));
          }
          return {} as never;
        },
        ...(observer === undefined ? {} : { observer }),
        diagnosticLog: host.binding,
      } as never,
    );
    return { host, persistence, registry };
  }

  it('receives {type:diag-pump-drop, taskKind:emit, operation, reason} per dropped task with exactly the four low-cardinality keys', async () => {
    // 判别收窄在收集点完成（回调参数上 TS 可收窄）；数组元素类型 = 联合的
    // diag-pump-drop 子形——读取侧零收窄需求（类型机械修正，语义不变）。
    type PumpDropEvent = Extract<RegistryObserverEvent, { type: 'diag-pump-drop' }>;
    const dropEvents: PumpDropEvent[] = [];
    const { host, registry } = assemblePumpBurst((event) => {
      if (event.type === 'diag-pump-drop') dropEvents.push(event);
    });
    const created = await registry.create(makeInput());
    expect(created.ok).toBe(true); // 业务结果不受满队丢弃影响（best-effort observability）
    // 两次满队丢弃（burst 越界 1 条 + 成功路径 committed 1 条）→ 各恰一次上报
    expect(dropEvents.length).toBe(2);
    for (const event of dropEvents) {
      expect(event.type).toBe('diag-pump-drop');
      expect(event.taskKind).toBe('emit');
      expect(event.operation).toBe('namespace-create');
      expect(event.reason).toBe('queue-full');
      // 低基数锁（ADR-0010 L159 / ADR-0011 L87）：载荷恰四封闭维度——namespaceId/
      // streamId/token/SCHEMA/ROOT/owner 一律不进（metrics label 安全由构造保证）。
      expect(Object.keys(event).sort()).toEqual(['operation', 'reason', 'taskKind', 'type']);
    }
    await settleDiagPump();
    await flushMicrotasks();
    await settleDiagPump();
    // 投递面完好：init-stream + 255 条接纳记录（满队丢弃的 1 条 + committed 不上报业务流）
    expect(host.initStreamCalls.filter((c) => c.ns === NS_A).length).toBe(1);
    const nsARecords = host.nsRecords.get(NS_A) ?? [];
    expect(nsARecords.length).toBe(255);
    expect(nsARecords[0]!.attemptId).toBe('0000');
    expect(nsARecords[254]!.attemptId).toBe('0254');
    expect(host.unattributedDrops).toBe(0);
  });

  it('an observer that throws never affects the business result nor subsequent deliveries (isolation lock)', async () => {
    const { host, registry } = assemblePumpBurst(() => {
      throw new Error('observer violation (isolation lock)');
    });
    const created = await registry.create(makeInput());
    expect(created.ok).toBe(true); // dispatchObserver try/catch + 泵侧 reportDrop try/catch
    await settleDiagPump();
    await flushMicrotasks();
    await settleDiagPump();
    const nsARecords = host.nsRecords.get(NS_A) ?? [];
    expect(nsARecords.length).toBe(255); // 后续投递零影响
    expect(host.unattributedDrops).toBe(0);
  });
});

// ── §13.3-c legacy no-op 锁（D-1 裁决钉为契约）──────────────────────────────

describe('issue-249 §13.3-c — legacy (shared-emitter) seam stays no-op for candidate outcomes', () => {
  function assembleLegacy(options: { counters: number[]; duplicateDocIds?: ReadonlySet<string> }) {
    const records: NamespaceDiagnosticChangeEmission[] = [];
    // exactOptionalPropertyTypes：显式 undefined 不可赋可选成员——按在场性分形构造。
    const persistence = new StubPersistence(
      options.duplicateDocIds === undefined ? {} : { duplicateDocIds: options.duplicateDocIds },
    );
    const registry = createNamespaceRegistryForTesting(
      persistence,
      {
        clock: { now: () => NOW_MS },
        scheduler: createRegistryTestScheduler(),
        randomBytes: scriptedIds(options.counters),
        runtimeFactory: () => ({}) as never,
        // 注解 emitter 参数：外层 `as never` 使 contextual type 丢失——显式类型修复
        // （noImplicitAny 编译面，类型机械修正）。
        diagnosticLog: { emitter: { emit: (e: NamespaceDiagnosticChangeEmission) => records.push(e) } }, // legacy：无 runtimeEmitterFor
      } as never,
    );
    return { records, persistence, registry };
  }

  it('entry-collision internal retry under legacy emits only the two successful final outcomes (zero candidate records)', async () => {
    // 候选序：[NS_A]（create #1 胜出）、[NS_A 碰撞, NS_B 胜出]（create #2）
    const { records, persistence, registry } = assembleLegacy({ counters: [1, 1, 2] });
    const first = await registry.create(makeInput());
    expect(first.ok).toBe(true);
    const second = await registry.create(makeInput());
    expect(second.ok).toBe(true);
    expect(persistence.createCalls.map((c) => c.docId)).toEqual([NS_A, NS_B]);
    // D-1：legacy 无 ns-bound 诊断流承载——碰撞候选零记录；仅每次成功 create 恰一条
    // 最终 committed 结局（#150 冻结契约语义保持，registry-create-diagnostic-red L529
    // 同款）。若 SA3 在 legacy 发射候选 → 此处出现第 3 条 rejected → 永久红。
    expect(records.length).toBe(2);
    expect(records.every((r) => r.result.kind === 'committed')).toBe(true);
  });

  it('DOC_DUPLICATE internal retry under legacy emits only the single final outcome (zero candidate records)', async () => {
    const { records, persistence, registry } = assembleLegacy({ counters: [1, 2], duplicateDocIds: new Set([NS_A]) });
    const result = await registry.create(makeInput());
    expect(result.ok).toBe(true);
    expect(persistence.createCalls.map((c) => c.docId)).toEqual([NS_A, NS_B]);
    expect(records.length).toBe(1); // D-1：store duplicate 候选零记录
    expect(records[0]!.result.kind).toBe('committed');
    expect(records[0]!.code).toBeUndefined(); // committed 无 code（既有语义）
  });
});

// ── §13.3-d sourceModule 成对锁（候选记录 code↔sourceModule/stage 精确映射）──

describe('issue-249 §13.3-d — candidate records carry the exact frozen code/sourceModule pair', () => {
  it('DOC_DUPLICATE candidate record: code DOC_DUPLICATE + sourceModule persistence + stage transaction', async () => {
    const host = makeDiagHost();
    const persistence = new StubPersistence({ duplicateDocIds: new Set([NS_A]) });
    const registry = createNamespaceRegistryForTesting(
      persistence,
      {
        clock: { now: () => NOW_MS },
        scheduler: createRegistryTestScheduler(),
        randomBytes: scriptedIds([1, 2]),
        runtimeFactory: () => ({}) as never,
        diagnosticLog: host.binding,
      } as never,
    );
    const result = await registry.create(makeInput());
    expect(result.ok).toBe(true);
    await settleDiagPump();
    await flushMicrotasks();
    await settleDiagPump();
    const nsARecords = host.nsRecords.get(NS_A) ?? [];
    expect(nsARecords.length).toBe(1);
    const candidate = nsARecords[0]!;
    expect(candidate.result.kind).toBe('rejected');
    expect(candidate.stage).toBe('transaction');
    expect(candidate.code).toBe('DOC_DUPLICATE');
    expect(candidate.sourceModule).toBe('persistence'); // 防 code↔sourceModule 单侧缺失被管线丢字段
  });

  it('entry-collision candidate record: code NAMESPACE_ALREADY_EXISTS + sourceModule registry + stage identity', async () => {
    const host = makeDiagHost();
    const persistence = new StubPersistence();
    const registry = createNamespaceRegistryForTesting(
      persistence,
      {
        clock: { now: () => NOW_MS },
        scheduler: createRegistryTestScheduler(),
        randomBytes: scriptedIds([1, 1, 2]),
        runtimeFactory: () => ({}) as never,
        diagnosticLog: host.binding,
      } as never,
    );
    const first = await registry.create(makeInput());
    expect(first.ok).toBe(true);
    const second = await registry.create(makeInput());
    expect(second.ok).toBe(true);
    await settleDiagPump();
    await flushMicrotasks();
    await settleDiagPump();
    const nsARecords = host.nsRecords.get(NS_A) ?? [];
    expect(nsARecords.length).toBe(2); // [create #1 committed, create #2 碰撞候选 rejected]
    const candidate = nsARecords[1]!;
    expect(candidate.result.kind).toBe('rejected');
    expect(candidate.stage).toBe('identity');
    expect(candidate.code).toBe('NAMESPACE_ALREADY_EXISTS');
    expect(candidate.sourceModule).toBe('registry');
  });
});
