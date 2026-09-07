/**
 * SA6 红灯验收契约 — issue #249：Registry entry-collision / Persistence
 * `DOC_DUPLICATE` 候选结局的诊断缺位（AC4/ADR-0011 L57；SA8 clear、SA5 分析 clear，
 * HEAD ac91a6b = PR #248）。
 * （2026-09-06 R1 修订：T-C 按批准设计 task_249_design.md §6.6 D-2 / §10.4 对齐——
 * 授权记录与轻量复检见 wiki/raw/task_249_sa6_align_verification.md。）
 *
 * 载体：真实 registry testing seam（`@nomicore/namespace-registry/testing`）全链路
 * create 编排 + 生产形状 Host diagnostic binding（#226 冻结 seam：`runtimeEmitterFor`
 * 数据键控 / `initStream` 建流 / emitter 恒丢弃计数），scripted `randomBytes` 定
 * 候选 id，真实 setImmediate 有界沉降（与 #226 红灯契约同款时序策略）。零产品代码、
 * 零既有测试改动。
 *
 * 契约分类（当前 HEAD 判定）：
 * - T-A —— **红灯**：entry collision 候选结局（registry.ts L1311 `entries.has` →
 *   `{kind:'retry'}` 零发射）必须在**既有 namespace 的流**中落一条被拒候选记录
 *   （已建流不重复建流）；胜出候选 ns-B 恰 1 条 committed（绿对照，业务链完好）。
 * - T-B —— **红灯**：Persistence `DOC_DUPLICATE` 候选结局（registry.ts L1410 catch →
 *   `{kind:'retry'}` 零发射）必须在 store 碰撞 namespace 的流中落一条被拒记录；
 *   该 ns 无流时 genesis-less 补建一次（`initStream(ns, undefined)`，ADR-0014 L22）；
 *   胜出候选 ns-B 恰 1 条 committed（绿对照）。
 * - T-C —— **红灯（D-2 对齐版）**：重试预算耗尽终局冻结语义不变（branded
 *   `NamespaceRegistryFatalError`、committed:false、phase='namespace-id-generation'、
 *   ADR-0010 L28——耗尽终局本身不发诊断记录，observer-only，D-2）；链内每个
 *   碰撞候选照常发 rejected 记录（与 T-A 同一发射点）。对齐断言：NS_A 流 =
 *   1 committed（create #1）+ 9 rejected（create #2 的 9 个碰撞候选，全部
 *   operation='namespace-create'、result rejected、零 fatal 记录）+ NS_A
 *   initStream 恰 1 次（零补建）+ unattributedDrops === 0。当前 HEAD 零候选发射
 *   → 红灯；修复后转绿。对齐通道 = 本契约头「耗尽链路……待设计冻结后由 SA6
 *   对齐」预留条款：设计 §6.6 裁决 D-2 即被等待的设计冻结（SA8 设计后复审与
 *   SA2 评审背书，task_249_sa6_align_verification.md 记录）。
 *
 * 被拒记录语义（本契约只锚词汇内既存事实，不发明值）：
 * - 每条碰撞/duplicate 候选 = 一次独立 create 变更尝试（CONTEXT.md L148–150）；
 *   候选结局 result.kind = 'rejected'（预期失败零提交，ADR-0014 L80–87 判别联合）。
 * - stage/code/sourceModule 的精确映射由 SA1 设计定夺（SA5 §4.3 给出 identity/
 *   NAMESPACE_ALREADY_EXISTS/registry 与 transaction/DOC_DUPLICATE/persistence
 *   建议组合）；本契约不锁 stage/code 值，只锚归属、条数、rejected 语义与业务
 *   不变量——避免预先锁定 SA3/SA1 的词表映射选择（词表整体冻结，任何值必须在
 *   既有冻结词表内，否则先走规范演进通道）。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { DocDuplicateError } from '@nomicore/persistence';
import type { DocHandle, DocPersistence, User } from '@nomicore/persistence';
import { createNamespaceRegistryForTesting, createRegistryTestScheduler } from '@nomicore/namespace-registry/testing';
import { NamespaceRegistryFatalError } from '@nomicore/namespace-registry';
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
    // number|undefined——计数器恒存在（空数组不可达）。类型机械修正（SA3，语义零
    // 改动；task_249_sa3_impl.md §1 注记）。
    const value = counters[Math.min(index, counters.length - 1)]!;
    index += 1;
    const bytes = new Uint8Array(16);
    bytes[15] = value;
    return bytes;
  };
}

// ── 生产形状 diagnostic host（泵路径 binding：runtimeEmitterFor 数据键控）─────

interface DiagHost {
  readonly binding: {
    readonly emitter: NamespaceDiagnosticChangeEmitter;
    readonly initStream: (namespaceId: string, genesisUpdateBytes: Uint8Array | undefined) => void;
    readonly runtimeEmitterFor: (namespaceId: string) => NamespaceDiagnosticChangeEmitter | undefined;
  };
  readonly nsRecords: Map<string, NamespaceDiagnosticChangeEmission[]>;
  readonly initStreamCalls: Array<{ ns: string; genesis: boolean }>;
  /** 不可归属投递（生产 unattributed emitter 语义：恒丢弃 + 计数）。 */
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
      // 生产语义（apps/yjs-server diagnostics.ts unattributed emitter）：恒丢 + 计数
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

// ── assembly ─────────────────────────────────────────────────────────────────

interface AssemblyOptions {
  readonly counters: number[];
  readonly duplicateDocIds?: ReadonlySet<string>;
}

function assemble(options: AssemblyOptions) {
  const host = makeDiagHost();
  // exactOptionalPropertyTypes：显式 undefined 不可赋可选成员——按在场性分形构造
  // （类型机械修正，SA3；语义零改动——见 task_249_sa3_impl.md §1 注记）。
  const persistence = new StubPersistence(
    options.duplicateDocIds === undefined ? {} : { duplicateDocIds: options.duplicateDocIds },
  );
  const registry = createNamespaceRegistryForTesting(persistence, {
    clock: { now: () => NOW_MS },
    scheduler: createRegistryTestScheduler(),
    randomBytes: scriptedIds(options.counters),
    runtimeFactory: () => ({}) as never,
    diagnosticLog: host.binding,
  } as never);
  return { host, persistence, registry };
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

// ── AC4 契约用例 ─────────────────────────────────────────────────────────────

describe('issue-249 AC4 — entry collision / DOC_DUPLICATE candidate diagnostics', () => {
  it('T-A (RED): Registry entry-collision candidate outcome produces a rejected record in the colliding namespace stream (no duplicate stream)', async () => {
    // 候选序：[NS_A]（create #1 胜出）、[NS_A 碰撞, NS_B 胜出]（create #2）
    const { host, persistence, registry } = assemble({ counters: [1, 1, 2] });
    const first = await registry.create(makeInput());
    expect(first.ok).toBe(true); // create #1: NS_A 注册
    const second = await registry.create(makeInput());
    expect(second.ok).toBe(true); // create #2: 候选 NS_A 碰撞 → retry → NS_B 胜出
    expect(persistence.createCalls.map((c) => c.docId)).toEqual([NS_A, NS_B]); // 业务重试路径完好
    await settleDiagPump();
    await flushMicrotasks();
    await settleDiagPump();

    const nsARecords = host.nsRecords.get(NS_A) ?? [];
    const nsBRecords = host.nsRecords.get(NS_B) ?? [];
    // AC4: NS_A 的 entry-collision 候选结局必须落到 NS_A 流（恰 1 条被拒记录，
    // 归属既有 namespace；NS_A 已由 create #1 建流——不得重复建流）。
    expect(nsARecords.length).toBe(2);
    expect(nsARecords[1]!.result.kind).toBe('rejected');
    expect(nsARecords[1]!.operation).toBe('namespace-create');
    // 绿对照：胜出候选归因通道本身完好
    expect(nsBRecords.length).toBe(1);
    expect(nsBRecords[0]!.result.kind).toBe('committed');
    // 不可归属丢弃必须为零：记录不是被误路由丢弃，而是此前从未发射（红→绿后归因正确）
    expect(host.unattributedDrops).toBe(0);
  });

  it('T-B (RED): Persistence DOC_DUPLICATE candidate outcome produces a rejected record plus one genesis-less stream for the store-colliding namespace', async () => {
    // 候选序：[NS_A（store duplicate）, NS_B 胜出]
    const { host, persistence, registry } = assemble({ counters: [1, 2], duplicateDocIds: new Set([NS_A]) });
    const result = await registry.create(makeInput());
    expect(result.ok).toBe(true);
    expect(persistence.createCalls.map((c) => c.docId)).toEqual([NS_A, NS_B]); // 恰一次 retry 后胜出
    await settleDiagPump();
    await flushMicrotasks();
    await settleDiagPump();

    const nsARecords = host.nsRecords.get(NS_A) ?? [];
    const nsBRecords = host.nsRecords.get(NS_B) ?? [];
    const nsAInit = host.initStreamCalls.filter((c) => c.ns === NS_A);
    // AC4/ADR-0014 L22: NS_A 无活流 → genesis-less 补建一次 + 落一条被拒记录
    expect(nsARecords.length).toBe(1);
    expect(nsARecords[0]!.result.kind).toBe('rejected');
    expect(nsARecords[0]!.operation).toBe('namespace-create');
    expect(nsAInit.length).toBe(1);
    expect(nsAInit[0]!.genesis).toBe(false);
    // 绿对照：胜出候选归因完好
    expect(nsBRecords.length).toBe(1);
    expect(nsBRecords[0]!.result.kind).toBe('committed');
    expect(host.unattributedDrops).toBe(0);
  });

  it('T-C (RED): retry-budget exhaustion keeps the frozen business outcome while every collision candidate emits a rejected record (D-2 alignment)', async () => {
    // create #1 胜出 NS_A；create #2 候选恒为 NS_A → 9 连碰 → 预算耗尽 fatal
    const { host, registry } = assemble({ counters: [1, 1] }); // 恒重复 1
    const first = await registry.create(makeInput());
    expect(first.ok).toBe(true);
    const second = await registry
      .create(makeInput())
      .then(
        () => undefined,
        (cause: unknown) => cause,
      );
    // 冻结业务终局：branded committed:false Registry fatal（ADR-0010 L28）；D-2 下
    // 耗尽终局本身零诊断记录（observer-only——create-id-generation-failed 事件）。
    expect(second).toBeInstanceOf(NamespaceRegistryFatalError);
    const fatalErr = second as NamespaceRegistryFatalError;
    expect(fatalErr.committed).toBe(false);
    expect(fatalErr.phase).toBe('namespace-id-generation');
    await settleDiagPump();
    await flushMicrotasks();
    await settleDiagPump();

    const nsARecords = host.nsRecords.get(NS_A) ?? [];
    // D-2 对齐（设计 §6.6/§10.4；契约头预留「耗尽链路……待设计冻结后由 SA6
    // 对齐」通道）：链内每个碰撞候选照常发 rejected 记录（与 T-A 同一发射点）→
    // 修复后 NS_A 流 = 1 committed（create #1）+ 9 rejected（create #2 的 9 个
    // 碰撞候选）；当前实现零候选发射 → length 1 ≠ 10（红灯，缺陷 C 断言）。
    expect(nsARecords.length).toBe(10);
    expect(nsARecords[0]!.result.kind).toBe('committed'); // 业务不变量：create #1 恰 1 条 committed
    const candidateRecords = nsARecords.slice(1); // 9 个碰撞候选的 rejected 记录
    expect(candidateRecords.length).toBe(9);
    expect(candidateRecords.every((r) => r.result.kind === 'rejected')).toBe(true);
    expect(candidateRecords.every((r) => r.operation === 'namespace-create')).toBe(true);
    // 零补建流：NS_A 建流恰 1 次（create #1）；9 候选经 streamedNamespaces 登记 no-op
    const nsAInit = host.initStreamCalls.filter((c) => c.ns === NS_A);
    expect(nsAInit.length).toBe(1);
    // 归属正确性：候选记录以候选 id 数据键控入泵——不可归属投递必须为零
    expect(host.unattributedDrops).toBe(0);
  });
});
