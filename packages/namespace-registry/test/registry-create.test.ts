/**
 * SA6 红灯锚定 — issue #111：namespace-registry 排他 `create` 主矩阵
 * （设计 §3/§4/§5/§6/§7/§9 全量落地）。
 *
 * 规范权威：ADR-0009（+ADR-0010 namespaceId CSPRNG 面）；设计记录（历史证据，非规范）：
 * wiki/raw/task_namespace-registry-create_design.md（冻结，R3 PASS）
 * - §3 类型/message 恒定表；§4 identity 最小接纳 + 槽内 payload 冻结；
 * - §5 create slot 伪码（冻结次序：acceptance → entry/closing → payload → Clock →
 *   create-document → Persistence → Runtime）；
 * - §6 Clock 必需（构造门禁 + 读一次 + 非法读数 fatal）；
 * - §7 失败映射表（operational/duplicate/fatal false/true/unknown false/observer）；
 * - §8 testing seam 增加 clock（必需）与 createDocumentFactory；
 * - §9 测试矩阵（success/snapshot/hostile/domain/duplicate/persistence/clock/
 *   post-commit/ordering/closing/initial-doc seam injection）。
 *
 * 红灯纪律：本文件全部用例在基线（§11 裁决 1 的 create 占位 + testing 工厂无
 * Clock/createDocumentFactory）必须红——失败证据为断言失败（resolve 占位 vs 期望
 * union、不 reject vs 期望 fatal、无 throw vs 期望构造 TypeError、计数 0 vs 期望
 * 计数）。基线 create 占位恒 resolve，绝不产生悬空 await；deferred gate 一律显式
 * resolve，零 real sleep。
 *
 * 测试 seam 迁移（设计 §14）：所有 createNamespaceRegistryForTesting 调用显式注入
 * manual clock helper（fixed ms + counter）。基线 testing 工厂忽略多余键 → 本文件在
 * 基线的红全部来自 create 占位行为/构造门禁缺失，而非 seam 迁移。
 * #112 工厂 seam 迁移（冻结设计 §8 R2）：全部工厂调用与 createRegistryInternal
 * fixture 补 `scheduler: createRegistryTestScheduler()`（必需字段）；duplicate 组
 * 增 idle 第五态显式行（ADR-0009:68）；既有断言零改动（§2.K：active-零lease 语义
 * 变 idle 语义，同码保持绿）。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { DocCreateFatalError, DocCreateOperationalError, DocDuplicateError } from '@nomicore/persistence';
import type { DocHandle, DocPersistence, User } from '@nomicore/persistence';
import { compileSchemaEnvelope, validateLogicalSnapshot } from '@nomicore/vfsl';
import type { DerivedSchema, SchemaEnvelope } from '@nomicore/vfsl';
import { NamespaceRegistryFatalError } from '@nomicore/namespace-registry';
import type { CreateNamespaceInput, NamespaceLease, NamespaceOwner } from '@nomicore/namespace-registry';
import { createNamespaceRegistryForTesting, createRegistryTestScheduler } from '@nomicore/namespace-registry/testing';
import { createNamespaceRuntimeForRegistry } from '@nomicore/namespace-runtime/internal';
import { NAMESPACE_ALREADY_EXISTS_MESSAGE } from '../src/types.js';
import { createInitialDocument } from '@nomicore/doc-runtime';
import type { RegistryObserverEvent } from '../src/observer.js';

// ── 确定性并发原语（禁 real sleep；沿用 registry-open.test.ts 既有原语）──────────

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

/** 显式微任务展开（禁 real sleep）；默认 16 层覆盖 create 链（accept→slot→payload→
 * clock→createDocument→createDoc→factory→entry→lease→cleanup 逐层微任务）。 */
async function flushMicrotasks(times = 16): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

// ── manual Clock helper（设计 §14：单一 helper，fixed ms + counter）──────────────

interface ManualClock {
  now(): number;
  readonly calls: number;
}

// ── phase-5 切片 1（ADR 0010）：受控随机源确定性 helpers（测试内定义；禁止从 src 导出）──
// 计数源：第 n 次生成 = `ns-` + n 的 32 位小写 hex（id(n) 即期望 ID）；剧本源：按 16
// 字节 hex 序列精确建模碰撞/重试（entry 碰撞与 DOC_DUPLICATE 重试的确定性布置）。

const H1 = '00000000000000000000000000000001';
const H2 = '00000000000000000000000000000002';
const H3 = '00000000000000000000000000000003';
const H4 = '00000000000000000000000000000004';
const H5 = '00000000000000000000000000000005';

function hexToBytes16(hex: string): Uint8Array {
  if (hex.length !== 32 || !/^[0-9a-f]+$/.test(hex)) {
    throw new Error(`fixture 脚本 hex 必须为 32 位小写 hex：${hex}`);
  }
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function makeCountingRandomBytes(): {
  randomBytes: (length: number) => Uint8Array;
  readonly consumed: number;
  readonly id: (n: number) => string;
} {
  let consumed = 0;
  return {
    randomBytes(length: number): Uint8Array {
      if (length !== 16) {
        throw new Error(`受控随机源必须按 128-bit（16 字节）请求，实际请求 ${length} 字节`);
      }
      consumed += 1;
      const hex = consumed.toString(16).padStart(32, '0');
      const out = new Uint8Array(16);
      for (let i = 0; i < 16; i += 1) {
        out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      }
      return out;
    },
    get consumed() {
      return consumed;
    },
    id: (n: number) => `ns-${n.toString(16).padStart(32, '0')}`,
  };
}

function makeScriptedRandomBytes(hexChunks: readonly string[]): (
  length: number
) => Uint8Array {
  let consumed = 0;
  const chunks = hexChunks.map(hexToBytes16);
  return (length: number): Uint8Array => {
    if (length !== 16) {
      throw new Error(`受控随机源必须按 128-bit（16 字节）请求，实际请求 ${length} 字节`);
    }
    const chunk = chunks[consumed];
    if (chunk === undefined) {
      throw new Error('受控随机源超出剧本：实现的重试次数超过契约预算');
    }
    consumed += 1;
    return chunk;
  };
}

const TEST_RANDOM_BYTES: (length: number) => Uint8Array = makeCountingRandomBytes().randomBytes;

/** 固定 ms 手动 Clock（counter 锚：每通过 gate 的 slot 恰读一次）。 */
function makeManualClock(initialMs = 0): ManualClock {
  let value = initialMs;
  let calls = 0;
  return {
    now() {
      calls += 1;
      return value;
    },
    get calls() {
      return calls;
    },
  };
}

// ── 可控 Persistence stub（deferred createDoc gate / typed / unknown 注入）────────

interface CreatePlan {
  gate?: Deferred;
  error?: unknown;
  handle?: DocHandle;
}

class CreateStubHandle implements DocHandle {
  releaseCalls = 0;
  constructor(
    readonly owner: User,
    readonly docId: string,
    readonly doc: Y.Doc,
    private readonly rejectReleaseWith: unknown = undefined,
  ) {}
  getStatus(): 'ready' {
    return 'ready';
  }
  release(): Promise<void> {
    this.releaseCalls += 1;
    if (this.rejectReleaseWith !== undefined) {
      return Promise.reject(this.rejectReleaseWith);
    }
    return Promise.resolve();
  }
}

/** release() 永不 settle（post-commit factory failure 的清理不阻塞 fatal 交付锚）。 */
class NeverSettleCreateHandle extends CreateStubHandle {
  override release(): Promise<void> {
    this.releaseCalls += 1;
    return new Promise<void>(() => {});
  }
}

/**
 * 可控 Persistence：createDoc 记录 (owner, docId, doc) 并把 doc 入「已提交 cell」
 * （loadDoc 在无显式 plan 时从该 cell 重签 handle——模拟 committed snapshot 恢复
 * 路径，§7 DQ-7）；loadDoc 支持显式 plan 覆盖（NOT_FOUND/错误注入）。
 */
class CreateStubPersistence implements DocPersistence {
  readonly createCalls: Array<{ owner: User; docId: string; doc: Y.Doc }> = [];
  readonly loadCalls: Array<{ owner: User; docId: string }> = [];
  saveCalls = 0;
  private readonly createQueue: CreatePlan[] = [];
  private readonly loadQueue: Array<{ result: DocHandle | null; error?: unknown }> = [];
  private readonly committedDocs = new Map<string, Y.Doc>();

  queueCreate(plan: CreatePlan): void {
    this.createQueue.push(plan);
  }

  queueLoad(plan: { result: DocHandle | null; error?: unknown }): void {
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
    return plan.handle ?? new CreateStubHandle(owner, docId, doc);
  }

  async loadDoc(owner: User, docId: string): Promise<DocHandle | null> {
    this.loadCalls.push({ owner, docId });
    const plan = this.loadQueue.shift();
    if (plan !== undefined) {
      if (plan.error !== undefined) {
        throw plan.error;
      }
      return plan.result;
    }
    const doc = this.committedDocs.get(docId);
    return doc === undefined ? null : new CreateStubHandle(owner, docId, doc);
  }

  async saveDoc(): Promise<void> {
    this.saveCalls += 1;
  }
}

// ── fixture：schema/ROOT（§6 compileSchemaEnvelope / validateLogicalSnapshot 前置）──

const GOOD_ENVELOPE: SchemaEnvelope = Object.freeze({
  lang: 'vfsl',
  version: 1,
  id: 'ns-1',
  text: 'type ROOT = { n: number; };\n',
});

const BAD_ENVELOPE: SchemaEnvelope = Object.freeze({
  lang: 'vfsl',
  version: 1,
  id: 'ns-bad',
  text: 'type ROOT = { n: ;\n',
});

const GOOD_ROOT = Object.freeze({ n: 42 });
const BAD_ROOT = Object.freeze({ n: 'not-a-number' });

const FIXED_MS = 1_700_000_123_456;
const FIXED_ISO = '2023-11-14T22:15:23.456Z';

function derivedOf(envelope: SchemaEnvelope): DerivedSchema {
  const compiled = compileSchemaEnvelope(envelope);
  if (!compiled.ok) {
    throw new Error(`fixture 前置 compileSchemaEnvelope 失败：${JSON.stringify(compiled.issues)}`);
  }
  return compiled.derived;
}

/** 合法 create 输入（顶层恰四键；schema/root 传 plain object 或 frozen object）。
 * 返回面以 CreateNamespaceInput 单点断言（§3 冻结签名）：正常调用点零改动；敌意/
 * 缺键直构输入在调用点 `as never`（open 测试同款先例）。 */
/** 合法 create 输入（顶层恰三键 {owner,schema,root}；namespaceId 由注入受控
 * 随机源生成——调用方不再提供）；schema/root 传 plain object 或 frozen object。
 * 返回面以 CreateNamespaceInput 单点断言（§3 冻结签名）：正常调用点零改动；敌意/
 * 缺键直构输入在调用点 `as never`（open 测试同款先例）。 */
function makeCreateInput(overrides: {
  owner?: NamespaceOwner | unknown;
  schema?: unknown;
  root?: unknown;
} = {}): CreateNamespaceInput {
  return {
    owner: overrides.owner ?? { userId: 'u-alice' },
    schema: overrides.schema ?? GOOD_ENVELOPE,
    root: overrides.root ?? GOOD_ROOT,
  } as CreateNamespaceInput;
}

function okLease(result: unknown): NamespaceLease {
  const r = result as { ok?: boolean; lease?: NamespaceLease };
  expect(r.ok, `create 应成功，实际：${JSON.stringify(result)}`).toBe(true);
  if (!r.ok || r.lease === undefined) throw new Error('unreachable');
  return r.lease;
}

// ── Yjs 观测 instrument（设计 §9：seam 前注册 afterTransaction；fresh-map 空置）──
//
// createInitialDocument 自持 new Y.Doc()，测试无法在事务前拿到 doc 引用；按设计
// §6「三者以 getMap 惰性取得」的冻结实现机制，以 Y.Doc.prototype.getMap 包装器在
// 首次探针时注册 afterTransaction 与空置快照——「先安装 observer 后调用 seam」的
// 确定性手法（零 real sleep；每次安装后 restore）。
//
// per-doc 锚定（总控 R-fix 裁决 7）：afterTransaction 计数按 doc 单个登记
// （WeakMap），`probe.txCount` 只锚定**目标 doc**（首个经 SCHEMA/META/ROOT 探针的
// doc——即安装事务发生的 fresh doc）。seam 写后校验若经共享 verifySnapshotIntact
// 在 scratch doc 上做对称重物化，其事务计入 scratch 自身条目、不影响目标锚——
// 目标安装事务恰 1 的锚在「镜像无 scratch」与「复用共享 verify（有 scratch）」两种
// 实现下都成立。tamper one-shot 只对目标 doc 的首次 afterTransaction 触发。
interface DocProbe {
  /** 目标 doc（首个探针）的 afterTransaction 计数——安装事务恰 1 锚。 */
  txCount: number;
  schemaSizeAtProbe: number;
  metaSizeAtProbe: number;
  rootSizeAtProbe: number;
  tamper: null | ((doc: Y.Doc) => void);
}

function installDocProbe(): { probe: DocProbe; restore: () => void } {
  const probe: DocProbe = {
    txCount: 0,
    schemaSizeAtProbe: -1,
    metaSizeAtProbe: -1,
    rootSizeAtProbe: -1,
    tamper: null,
  };
  const counts = new WeakMap<Y.Doc, number>();
  let targetDoc: Y.Doc | undefined;
  const seen = new WeakSet<Y.Doc>();
  const originalGetMap = Y.Doc.prototype.getMap;
  Y.Doc.prototype.getMap = (function getMapProbe(this: Y.Doc, name: string) {
    const map = originalGetMap.call(this, name);
    if (name === 'SCHEMA' || name === 'META' || name === 'ROOT') {
      const slot =
        name === 'SCHEMA'
          ? ('schemaSizeAtProbe' as const)
          : name === 'META'
            ? ('metaSizeAtProbe' as const)
            : ('rootSizeAtProbe' as const);
      if (probe[slot] === -1 && map.size === 0) {
        probe[slot] = map.size; // fresh-map 空置快照（首个探针时点）
      }
      if (!seen.has(this)) {
        seen.add(this);
        if (targetDoc === undefined) {
          targetDoc = this; // 目标 doc = 首个被探针的 fresh doc（安装事务宿主）
        }
        this.on('afterTransaction', () => {
          const next = (counts.get(this) ?? 0) + 1;
          counts.set(this, next);
          if (this === targetDoc) {
            probe.txCount = next; // 只锚定目标 doc 的计数（scratch 事务不入目标条目）
            if (probe.tamper !== null) {
              probe.tamper(this);
              probe.tamper = null; // one-shot：防嵌套事务无限递归
            }
          }
        });
      }
    }
    return map;
  }) as unknown as typeof Y.Doc.prototype.getMap;
  return {
    probe,
    restore() {
      Y.Doc.prototype.getMap = originalGetMap;
    },
  };
}

// ── Fake Runtime（marker identity 与状态轨迹透传锚）──────────────────────────────

function makeMarkerRuntime(marker: string, namespaceId: string): any {
  let statusCalls = 0;
  return {
    owner: { userId: 'u-alice' },
    namespaceId,
    readData: () => ({ ok: true, value: marker }),
    getSchema: () => null,
    getMetadata: () => ({ marker }),
    getActiveSchema: () => null,
    getStatus: () => {
      statusCalls += 1;
      return {
        lifecycle: 'ready',
        read: { enabled: true },
        rootWrite: { enabled: true },
        schemaWrite: { enabled: true },
        schema: { state: statusCalls === 1 ? 'preparing' : 'ready' },
        fatal: null,
        close: null,
      };
    },
    mutateData: async () => ({ ok: true }),
    replaceSchema: async () => ({ ok: true }),
    close: async () => {},
  };
}

// ═══════════════════════════════════════════════════════════════════════════════

describe('create 成功全链（§3/§5/§6/§9）：manual Clock 精确 createdAt + Persistence 收文档 + 单事务 + P0 seam', () => {
  it('默认工厂全链：create 成功、createdAt 精确锚、SCHEMA 四键/META 二键/ROOT 完整、afterTransaction 恰 1、Clock 恰读 1', async () => {
    const persistence = new CreateStubPersistence();
    const clock = makeManualClock(FIXED_MS);
    const { probe, restore } = installDocProbe();
    try {
      const src = makeCountingRandomBytes();
      const registry = createNamespaceRegistryForTesting(persistence, { clock, scheduler: createRegistryTestScheduler(), randomBytes: src.randomBytes });
      const result = await registry.create(makeCreateInput());
      const lease = okLease(result);

      // identity 投影片面（phase-5 切片 1：namespaceId 由注入受控随机源生成——第 1 次生成）
      expect(lease.owner).toEqual({ userId: 'u-alice' });
      expect(lease.namespaceId).toBe(src.id(1));
      expect(lease.namespaceId).toMatch(/^ns-[0-9a-f]{32}$/);

      // createdAt：manual Clock 固定 ms → ISO 精确字符串锚（§6 冻结 `toISOString()` 产物）
      expect(lease.getMetadata().createdAt).toBe(FIXED_ISO);
      expect(clock.calls).toBe(1); // 每通过 payload+duplicate gate 的 create slot 恰读一次

      // Persistence 收到严格安装文档（§9 成功链）
      expect(persistence.createCalls.length).toBe(1);
      const captured = persistence.createCalls[0]!;
      expect(captured.owner).toEqual({ userId: 'u-alice' });
      expect(captured.docId).toBe(src.id(1));
      const schemaMap = captured.doc.getMap('SCHEMA');
      expect(schemaMap.size).toBe(4);
      expect([...schemaMap.keys()].sort()).toEqual(['id', 'lang', 'text', 'version']);
      expect(schemaMap.get('lang')).toBe('vfsl');
      expect(schemaMap.get('version')).toBe(1);
      expect(schemaMap.get('id')).toBe('ns-1');
      expect(schemaMap.get('text')).toBe(GOOD_ENVELOPE.text);
      const metaMap = captured.doc.getMap('META');
      expect(metaMap.size).toBe(2);
      expect([...metaMap.keys()].sort()).toEqual(['createdAt', 'docId']);
      expect(metaMap.get('docId')).toBe(src.id(1)); // docId = namespaceId（§6 生成 ID）
      expect(metaMap.get('createdAt')).toBe(FIXED_ISO);
      const rootMap = captured.doc.getMap('ROOT');
      expect(rootMap.get('n')).toBe(42);

      // fresh-map 空置观测（§9 seam 行：三 map 首次安装前 size===0）
      expect(probe.schemaSizeAtProbe).toBe(0);
      expect(probe.metaSizeAtProbe).toBe(0);
      expect(probe.rootSizeAtProbe).toBe(0);
      // 单 transaction（§9：在调用 seam 前注册 afterTransaction，计数恰 1）
      expect(probe.txCount).toBe(1);

      // 普通 P0 seam：真实 Runtime 经默认内部 factory 构造（read/getMetadata 真实透传）
      expect(lease.getStatus().lease).toBe('active');
      const st = lease.getStatus();
      if (st.lease === 'active') {
        // P0 经 sequencer 微任务在 create resolve 前已结算（同 open 先例），state=ready
        expect(st.runtime.schema.state).toBe('ready');
      }
      expect(lease.readData(['n'])).toEqual({ ok: true, value: 42 });
      expect(lease.getMetadata().createdAt).toBe(FIXED_ISO); // 真实 runtime 投影同锚
      // 零 load/零 save（create 不 load、不 upsert）
      expect(persistence.loadCalls.length).toBe(0);
      expect(persistence.saveCalls).toBe(0);
      await lease.release();
    } finally {
      restore();
    }
  });

  it('lease.getStatus() 暴露 schema preparing→ready 轨迹（状态投影透传）', async () => {
    const persistence = new CreateStubPersistence();
    const clock = makeManualClock(FIXED_MS);
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock,
      scheduler: createRegistryTestScheduler(),
      randomBytes: TEST_RANDOM_BYTES,
      runtimeFactory: () => makeMarkerRuntime('MARKER_PREPARING_TRACK', 'k-ns'),
    });
    const lease = okLease(await registry.create(makeCreateInput()));
    const st0 = lease.getStatus();
    expect(st0.lease).toBe('active');
    if (st0.lease === 'active') {
      expect(st0.runtime.schema.state).toBe('preparing'); // 首次观察 = preparing（P0 未结算）
    }
    const st1 = lease.getStatus();
    if (st1.lease === 'active') {
      expect(st1.runtime.schema.state).toBe('ready'); // 二次观察 = ready
    }
    await lease.release();
  });

  it('runtimeFactory seam 形状：create 成功路径经普通 factory(handle, notifyDirty) 构造 Runtime', async () => {
    const persistence = new CreateStubPersistence();
    const clock = makeManualClock(FIXED_MS);
    let factoryCalls = 0;
    let handleDocSeen: unknown;
    let notifyDirtySeen: unknown;
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock,
      scheduler: createRegistryTestScheduler(),
      randomBytes: TEST_RANDOM_BYTES,
      runtimeFactory: (handle, notifyDirty) => {
        factoryCalls += 1;
        handleDocSeen = (handle as { doc?: unknown }).doc;
        notifyDirtySeen = notifyDirty;
        return makeMarkerRuntime('MARKER_FACTORY', 'k-ns');
      },
    });
    const lease = okLease(await registry.create(makeCreateInput()));
    expect(factoryCalls).toBe(1);
    expect(handleDocSeen).toBeInstanceOf(Y.Doc);
    expect(typeof notifyDirtySeen).toBe('function');
    expect(lease.readData(['a'])).toEqual({ ok: true, value: 'MARKER_FACTORY' });
    await lease.release();
  });
});

describe('snapshot 时机（§4/§9）：排队期间突变生效、slot snapshot 后无效、owner 冻结', () => {
  it('排队期间（slot 启动前）突变的 schema/root 生效', async () => {
    const persistence = new CreateStubPersistence();
    const clock = makeManualClock(FIXED_MS);
    const gate1 = deferred();
    // slot1：停在 createDoc gate 后以 operational 失败收场（零 entry）——slot2 才能在
    // 同一 key 上继续；若 slot1 成功，slot2 将 ALREADY_EXISTS 而无法观察突变生效。
    persistence.queueCreate({ gate: gate1, error: new DocCreateOperationalError(new Error('slot1-fails')) });
    // 剧本源 [H1, H1]：两个 create 共享同一候选 ID（slot1 operational 失败零 entry →
    // slot2 同 key 继续，FIFO 窗口保持）。
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock,
      scheduler: createRegistryTestScheduler(),
      randomBytes: makeScriptedRandomBytes([H1, H1]),
    });

    const input1 = makeCreateInput({ schema: { ...GOOD_ENVELOPE, text: 'type ROOT = { a: number; };\n' }, root: { a: 1 } });
    const input2 = makeCreateInput({ schema: { ...GOOD_ENVELOPE, text: 'type ROOT = { b: number; };\n' }, root: { b: 2 } });
    const p1 = registry.create(input1); // slot1 → 停在 createDoc gate
    await flushMicrotasks();
    const p2 = registry.create(input2); // slot2 排队（同 key FIFO）

    // 排队期间突变 slot2 的输入（slot2 的 payload snapshot 尚未执行；readonly 属性经 any 桥接）
    (input2 as unknown as { schema: unknown }).schema = { ...GOOD_ENVELOPE, text: 'type ROOT = { c: number; };\n' };
    (input2 as { root: Record<string, unknown> }).root = { c: 3 };

    gate1.resolve();
    const r1 = await p1; // slot1 → NAMESPACE_CREATE_FAILED（零 entry）
    expect(r1).toMatchObject({ ok: false, code: 'NAMESPACE_CREATE_FAILED' });
    const r2 = await p2;
    expect(r2.ok).toBe(true);
    expect(persistence.createCalls.length).toBe(2);
    // slot2 收到的是突变后的值（快照在 slot 启动时读取）
    const doc2 = persistence.createCalls[1]!.doc;
    expect(doc2.getMap('SCHEMA').get('text')).toBe('type ROOT = { c: number; };\n');
    expect(doc2.getMap('ROOT').get('c')).toBe(3);
    // slot1 收到的是它自己的原始值（未被污染）
    const doc1 = persistence.createCalls[0]!.doc;
    expect(doc1.getMap('SCHEMA').get('text')).toBe('type ROOT = { a: number; };\n');
    await okLease(await registry.open({ userId: 'u-alice' }, `ns-${H1}`)).release();
  });

  it('slot snapshot 后突变的 schema/root 无效（槽内冻结）', async () => {
    const persistence = new CreateStubPersistence();
    const clock = makeManualClock(FIXED_MS);
    const gate = deferred();
    persistence.queueCreate({ gate });
    const registry = createNamespaceRegistryForTesting(persistence, { clock, scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES });
    const input = makeCreateInput({ schema: { ...GOOD_ENVELOPE, text: 'type ROOT = { n: number; };\n' }, root: { n: 1 } });
    const p = registry.create(input);
    await flushMicrotasks(); // slot 已通过 payload snapshot，停在 createDoc gate
    (input.schema as SchemaEnvelope).text = 'type ROOT = { z: number; };\n';
    (input.root as Record<string, unknown>).z = 99;
    gate.resolve();
    const lease = okLease(await p);
    expect(persistence.createCalls.length).toBe(1);
    const captured = persistence.createCalls[0]!;
    expect(captured.doc.getMap('SCHEMA').get('text')).toBe('type ROOT = { n: number; };\n');
    expect(captured.doc.getMap('ROOT').get('n')).toBe(1);
    expect(captured.doc.getMap('ROOT').has('z')).toBe(false);
    await lease.release();
  });

  it('排队期间突变 owner：既不改 queue key 也不改 createDoc 收到的 owner/docId', async () => {
    const persistence = new CreateStubPersistence();
    const clock = makeManualClock(FIXED_MS);
    const gate1 = deferred();
    persistence.queueCreate({ gate: gate1 });
    // 剧本源 [H1, H1]：两 create 共享同一候选（同 key FIFO——接纳段冻结 owner 投影）。
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock,
      scheduler: createRegistryTestScheduler(),
      randomBytes: makeScriptedRandomBytes([H1, H1, H2]),
    });
    const ownerObj: { userId: string } = { userId: 'u-frozen' };
    const input1 = makeCreateInput({ owner: ownerObj });
    const p1 = registry.create(input1);
    await flushMicrotasks();
    const p2 = registry.create({
      owner: ownerObj, // 同 identity 接纳（冻结投影）
      schema: GOOD_ENVELOPE,
      root: GOOD_ROOT,
    });
    // 排队期间原地改写 owner 与替换整个 owner 引用
    ownerObj.userId = 'u-EVIL';
    (input1 as { owner: unknown }).owner = { userId: 'u-EVIL-2' };
    await flushMicrotasks();
    // 若 identity 被改写，slot2 将并行到达 createDoc；冻结 identity 下 slot2 仍在排队
    expect(persistence.createCalls.length).toBe(1);
    gate1.resolve();
    await p1;
    // slot2（候选 H1）在 slot1 登记 entry 后命中碰撞 → 重生成 H2 成功（不再 ALREADY_EXISTS）
    const r2 = await p2;
    expect(r2.ok).toBe(true);
    expect(persistence.createCalls.map((c) => c.docId)).toEqual([`ns-${H1}`, `ns-${H2}`]);
    expect(persistence.createCalls[0]!.owner).toEqual({ userId: 'u-frozen' });
    expect(persistence.createCalls[1]!.owner).toEqual({ userId: 'u-frozen' });
    // 后续（原 identity）open 命中 entry：frozen identity 建 key
    const lease = okLease(await registry.open({ userId: 'u-frozen' }, `ns-${H1}`));
    expect(persistence.loadCalls.length).toBe(0); // entry H1 命中（frozen identity 建 key）
    await lease.release();
    const lease2 = okLease(r2); // 重生成的 H2 lease 独立结算
    await lease2.release();
  });
});

describe('hostile input（§1/§4/§9）：Proxy trap 窄 issue + slot isolation（不承诺零 trap）', () => {
  it('顶层 input Proxy 的 ownKeys trap throw：本 slot 吸收为 NAMESPACE_CREATE_INVALID_INPUT，tail 继续', async () => {
    const persistence = new CreateStubPersistence();
    const clock = makeManualClock(FIXED_MS);
    let ownKeysTrapCount = 0;
    const hostileInput = new Proxy(makeCreateInput(), {
      ownKeys(target) {
        ownKeysTrapCount += 1;
        throw new Error('ownKeys trap boom');
      },
    });
    const registry = createNamespaceRegistryForTesting(persistence, { clock, scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES });
    const r1 = await registry.create(hostileInput as never);
    expect(r1).toMatchObject({ ok: false, code: 'NAMESPACE_CREATE_INVALID_INPUT' });
    expect((r1 as unknown as { message: string }).message).toBe(
      'NAMESPACE_CREATE_INVALID_INPUT: create 输入必须恰含 owner、schema 与 root',
    );
    expect(ownKeysTrapCount).toBeGreaterThanOrEqual(1); // trap 确实执行（诚实措辞：不宣称零执行）
    // 本 slot 零副作用：Clock 未读、createDocument/Persistence 零调用
    expect(clock.calls).toBe(0);
    expect(persistence.createCalls.length).toBe(0);
    expect(persistence.loadCalls.length).toBe(0);
    // slot isolation：后续同 key create 正常成功（green tail）
    const r2 = await registry.create(makeCreateInput());
    expect(r2.ok).toBe(true);
    expect(persistence.createCalls.length).toBe(1);
    await okLease(r2).release();
  });

  it('top-level getOwnPropertyDescriptor trap throw（owner/namespaceId 读取时）：身份阶段吸收', async () => {
    const persistence = new CreateStubPersistence();
    const clock = makeManualClock(FIXED_MS);
    let descTrap = 0;
    const hostileInput = new Proxy(makeCreateInput(), {
      getOwnPropertyDescriptor(target, prop) {
        descTrap += 1;
        if (prop === 'owner' || prop === 'namespaceId') {
          throw new Error('desc trap boom');
        }
        return Reflect.getOwnPropertyDescriptor(target, prop);
      },
    });
    const registry = createNamespaceRegistryForTesting(persistence, { clock, scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES });
    const r1 = await registry.create(hostileInput as never);
    // phase-5 切片 1：接纳段以 descriptor-only 检查 namespaceId（键出现即拒）——Proxy 的
    // getOwnPropertyDescriptor(nsId) trap throw 被 catch 为窄的 NAMESPACE_CREATE_INVALID_INPUT
    // （零 getter 执行；owner/namespaceId 值永不被读取）。
    expect(r1).toMatchObject({ ok: false, code: 'NAMESPACE_CREATE_INVALID_INPUT' });
    expect(descTrap).toBeGreaterThanOrEqual(1);
    expect(clock.calls).toBe(0);
    expect(persistence.createCalls.length).toBe(0);
    expect(persistence.loadCalls.length).toBe(0);
  });

  it('owner Proxy 的 getOwnPropertyDescriptor/原型 trap throw → NAMESPACE_INVALID_IDENTITY 零副作用', async () => {
    const proxies: unknown[] = [
      new Proxy(
        { userId: 'u-alice' },
        {
          getPrototypeOf() {
            throw new Error('owner proto trap');
          },
        },
      ),
      new Proxy(
        { userId: 'u-alice' },
        {
          getOwnPropertyDescriptor() {
            throw new Error('owner desc trap');
          },
        },
      ),
    ];
    const persistence = new CreateStubPersistence();
    const clock = makeManualClock(FIXED_MS);
    const registry = createNamespaceRegistryForTesting(persistence, { clock, scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES });
    for (const proxy of proxies) {
      const r = await registry.create(makeCreateInput({ owner: proxy }));
      expect(r).toMatchObject({ ok: false, code: 'NAMESPACE_INVALID_IDENTITY', field: 'owner.userId' });
      expect((r as unknown as { message: string }).message).toBe(
        'NAMESPACE_INVALID_IDENTITY: owner.userId 或 namespaceId 不符合安全文法',
      );
    }
    expect(clock.calls).toBe(0);
    expect(persistence.createCalls.length).toBe(0);
    expect(persistence.loadCalls.length).toBe(0);
  });

  it('槽内 payload 变体（循环引用/bigint/Date/class/function/NaN/Infinity/symbol/共享引用/accessor/Yjs）全部 NAMESPACE_CREATE_INVALID_INPUT 且 zero createDoc', async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const shared: Record<string, unknown> = { v: 1 };
    const cases: Array<{ name: string; input: ReturnType<typeof makeCreateInput> }> = [
      { name: 'cyclic root', input: makeCreateInput({ root: circular }) },
      { name: 'cyclic schema', input: makeCreateInput({ schema: circular }) },
      { name: 'bigint root', input: makeCreateInput({ root: { n: 10n } }) },
      { name: 'Date root', input: makeCreateInput({ root: { d: new Date(0) } }) },
      { name: 'class instance root', input: makeCreateInput({ root: new (class Fake { x = 1; })() }) },
      { name: 'function root', input: makeCreateInput({ root: { f: () => 1 } }) },
      { name: 'NaN root', input: makeCreateInput({ root: { n: Number.NaN } }) },
      { name: 'Infinity root', input: makeCreateInput({ root: { n: Number.POSITIVE_INFINITY } }) },
      { name: 'symbol-key schema', input: makeCreateInput({ schema: { ...GOOD_ENVELOPE, [Symbol('s')]: 1 } }) },
      { name: 'shared reference root', input: makeCreateInput({ root: { a: shared, b: shared } }) },
      { name: 'accessor schema', input: makeCreateInput({ schema: { ...GOOD_ENVELOPE, get text() { return 'x'; } } }) },
      { name: 'Yjs type root', input: makeCreateInput({ root: new Y.Map() }) },
    ];
    const persistence = new CreateStubPersistence();
    const clock = makeManualClock(FIXED_MS);
    const registry = createNamespaceRegistryForTesting(persistence, { clock, scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES });
    for (const c of cases) {
      const r = await registry.create(c.input);
      expect(r, `${c.name} → NAMESPACE_CREATE_INVALID_INPUT`).toMatchObject({
        ok: false,
        code: 'NAMESPACE_CREATE_INVALID_INPUT',
      });
      expect(clock.calls, `${c.name} 不得读 Clock`).toBe(0);
    }
    expect(persistence.createCalls.length).toBe(0);
    expect(persistence.loadCalls.length).toBe(0);
    // 全部失败后 green tail：正常 create 成功
    const ok = await registry.create(makeCreateInput());
    expect(ok.ok).toBe(true);
    expect(persistence.createCalls.length).toBe(1);
    await okLease(ok).release();
  });

  it('数组四查（SA4 MEDIUM-2）：symbol 键/非枚举 own 键/数组子类/替换原型 → NAMESPACE_CREATE_INVALID_INPUT、零 Clock、零 createDocument/Persistence', async () => {
    // 对照基准：namespace-runtime/src/write.ts copyFrozen 的数组四查纪律（原型/
    // symbol/非枚举/descriptor 先于值读取）。漏检 → 克隆丢失调用方 own 状态 → 当前
    // 实现静默放行（create 成功）——本测试锚定窄拒绝。
    const ARRAY_SCHEMA: SchemaEnvelope = Object.freeze({
      lang: 'vfsl',
      version: 1,
      id: 'ns-arr',
      text: 'type ROOT = { n: number; list: number[]; };\n',
    });
    const withSymbol: number[] = [1];
    (withSymbol as unknown as Record<symbol, number>)[Symbol('sa6-x')] = 1;
    const withNonEnum: number[] = [1];
    Object.defineProperty(withNonEnum, 'x', { value: 1, enumerable: false });
    class MyArr extends Array {}
    const subclass = new MyArr(1);
    const nullProto: number[] = [1];
    Object.setPrototypeOf(nullProto, null);
    const customProto: number[] = [1];
    Object.setPrototypeOf(customProto, { marker: 1 });
    const cases: Array<{ name: string; list: number[] }> = [
      { name: 'array symbol key', list: withSymbol },
      { name: 'array non-enumerable own key', list: withNonEnum },
      { name: 'array subclass instance', list: subclass },
      { name: 'array null prototype', list: nullProto },
      { name: 'array custom prototype', list: customProto },
    ];
    // fixture 前置：schema 可编译、宿主 root 经克隆后语义合法（当前实现漏检时 create 会成功）
    const compiled = compileSchemaEnvelope(ARRAY_SCHEMA);
    if (compiled.ok) {
      const valid = validateLogicalSnapshot(compiled.derived, { n: 42, list: [1] });
      expect(valid.ok, 'fixture 前置：克隆产物语义必须合法（漏检才可能成功）').toBe(true);
    }
    const persistence = new CreateStubPersistence();
    const clock = makeManualClock(FIXED_MS);
    let documentFactoryCalls = 0;
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock,
      scheduler: createRegistryTestScheduler(),
      randomBytes: TEST_RANDOM_BYTES,
      // 计数 factory（若漏检则 create 会经此成功——注入不可 throw，保证失败形态
      // 是「期望 INVALID_INPUT vs 实际成功」的断言差异而非 rejection）
      createDocumentFactory: () => {
        documentFactoryCalls += 1;
        return { ok: true as const, doc: new Y.Doc() };
      },
    });
    for (const c of cases) {
      const r = await registry.create(
        makeCreateInput({ schema: ARRAY_SCHEMA, root: { n: 42, list: c.list } }),
      );
      expect(r, `${c.name} → NAMESPACE_CREATE_INVALID_INPUT`).toMatchObject({
        ok: false,
        code: 'NAMESPACE_CREATE_INVALID_INPUT',
      });
      expect(clock.calls, `${c.name} 不得读 Clock`).toBe(0);
    }
    expect(persistence.createCalls.length).toBe(0);
    expect(persistence.loadCalls.length).toBe(0);
    expect(documentFactoryCalls).toBe(0);
  });

  it('构建器 D1 终审：owner/namespaceId 以 accessor getter 提供 → 接纳段零 getter 执行 + NAMESPACE_CREATE_INVALID_INPUT + 零 carrier/零 Persistence', async () => {
    // 终审 ADVISORY（D1）：接纳段必须只经 descriptor 读取 owner/namespaceId——
    // accessor getter 一概不执行（属性 GET 会在 identity.ts 读取时触发 getter）。
    const persistence = new CreateStubPersistence();
    const clock = makeManualClock(FIXED_MS);
    const diagnostics: Array<{ type: string }> = [];
    let getterCalls = 0;
    const input = {
      get owner() {
        getterCalls += 1;
        return { userId: 'u-alice' };
      },
      get namespaceId() {
        getterCalls += 1;
        return 'k-ns';
      },
      schema: GOOD_ENVELOPE,
      root: GOOD_ROOT,
    };
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock,
      scheduler: createRegistryTestScheduler(),
      randomBytes: TEST_RANDOM_BYTES,
      diagnostics: (e) => diagnostics.push({ type: e.type }),
    });
    const r = await registry.create(input as never);
    expect(getterCalls, '接纳段必须零执行 accessor getter（descriptor 读取而非属性 GET）').toBe(0);
    expect(r).toMatchObject({ ok: false, code: 'NAMESPACE_CREATE_INVALID_INPUT' });
    expect(diagnostics.some((d) => d.type === 'carrier-created')).toBe(false); // 零 carrier
    expect(clock.calls).toBe(0);
    expect(persistence.createCalls.length).toBe(0);
    expect(persistence.loadCalls.length).toBe(0);
    // keeper 形态对照（own data descriptor）：同一 Registry 正常成功——未毒化
    const keeper = await registry.create(makeCreateInput());
    expect(keeper.ok).toBe(true);
    await okLease(keeper).release();
  });
});

describe('输入形状（§4/§9 终审 D2）：五键/错名键/缺键专属锚 → NAMESPACE_CREATE_INVALID_INPUT', () => {
  it('五键（多 meta）/五键（多 createdAt）/错名键（rooot 代替 root）/缺 root（恰两键）→ 同码 + 零 Clock + 零 Persistence', async () => {
    const persistence = new CreateStubPersistence();
    const clock = makeManualClock(FIXED_MS);
    const registry = createNamespaceRegistryForTesting(persistence, { clock, scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES });
    const base = { owner: { userId: 'u-alice' }, schema: GOOD_ENVELOPE, root: GOOD_ROOT };
    const cases: Array<{ name: string; input: unknown }> = [
      { name: '五键（多 meta）', input: { ...base, meta: {} } },
      { name: '五键（多 createdAt）', input: { ...base, createdAt: '2023-11-14T22:15:23.456Z' } },
      { name: '错名键（rooot 代替 root）', input: { owner: base.owner, schema: base.schema, rooot: base.root } },
      { name: '缺 root（恰两键）', input: { owner: base.owner, schema: base.schema } },
    ];
    for (const c of cases) {
      const r = await registry.create(c.input as never);
      expect(r, `${c.name} → NAMESPACE_CREATE_INVALID_INPUT`).toMatchObject({
        ok: false,
        code: 'NAMESPACE_CREATE_INVALID_INPUT',
      });
    }
    // 全部发生在 payload 快照：零 Clock 读数、零 Persistence（含 carrier 可留产物但不触发值读取）
    expect(clock.calls).toBe(0);
    expect(persistence.createCalls.length).toBe(0);
    expect(persistence.loadCalls.length).toBe(0);
  });

  it('携带 namespaceId 键（原 create 文法用例：空串/点/斜杠/String 对象/number）→ 接纳段 CREATE_INVALID_INPUT，零随机源消耗、零 Clock、零 Persistence', async () => {
    // phase-5 切片 1（ADR 0010）：namespaceId 键出现即拒（data 或 accessor 描述符一律
    // 拒）——原「create 的 namespaceId 文法」用例全部改锚 CREATE_INVALID_INPUT；
    // 文法的合法性面保留在 open（validateOpenIdentity 零改动，旧格式 ID 继续可 open）。
    const persistence = new CreateStubPersistence();
    const clock = makeManualClock(FIXED_MS);
    let consumed = 0;
    const counting = makeCountingRandomBytes();
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock,
      scheduler: createRegistryTestScheduler(),
      randomBytes: (length: number) => {
        consumed += 1;
        return counting.randomBytes(length);
      },
    });
    const legacyShape = (namespaceId: unknown) => ({
      owner: { userId: 'u-alice' },
      namespaceId,
      schema: GOOD_ENVELOPE,
      root: GOOD_ROOT,
    });
    const cases: Array<{ name: string; namespaceId: unknown }> = [
      { name: "空串 ''", namespaceId: '' },
      { name: "'.'", namespaceId: '.' },
      { name: "'..'", namespaceId: '..' },
      { name: "'x/y'", namespaceId: 'x/y' },
      { name: "'x\\y'", namespaceId: 'x\\y' },
      { name: 'String 对象', namespaceId: new String('y') as unknown as string },
      { name: 'number 7', namespaceId: 7 },
    ];
    for (const c of cases) {
      const r = await registry.create(legacyShape(c.namespaceId) as never);
      expect(r, `${c.name} → NAMESPACE_CREATE_INVALID_INPUT`).toMatchObject({
        ok: false,
        code: 'NAMESPACE_CREATE_INVALID_INPUT',
      });
    }
    expect(consumed).toBe(0); // 零随机源消耗（接纳段拒绝先于生成）
    expect(clock.calls).toBe(0);
    expect(persistence.createCalls.length).toBe(0);
    expect(persistence.loadCalls.length).toBe(0);
  });
});

describe('identity invalid（§4/§9）：非法 owner → NAMESPACE_INVALID_IDENTITY 零副作用；携带 namespaceId 键 → CREATE_INVALID_INPUT（ADR 0010 拒收面）', () => {
  it('identity 表：全部 resolve 窄 issue，diagnostics 无 carrier-created、零 createDoc/loadDoc/factory', async () => {
    // phase-5 切片 1（ADR 0010）：create 不再接受调用方 namespaceId——原 namespaceId
    // 文法用例（''/'.'/'..'/'x/y'/'String 对象'/number）迁至「输入形状」段的
    // CREATE_INVALID_INPUT 拒收面（见下）；本表的 owner 文法面在新三键契约下保持
    // INVALID_IDENTITY（field='owner.userId'）。
    const badCases: Array<{ input: unknown; field: 'owner.userId' | 'namespaceId' }> = [
      // 直构（`makeCreateInput` 的 `??` 会把显式 null 吞掉——攻击面必须真实到达）
      { input: { owner: null, schema: GOOD_ENVELOPE, root: GOOD_ROOT }, field: 'owner.userId' },
      { input: makeCreateInput({ owner: 'str' }), field: 'owner.userId' },
      { input: makeCreateInput({ owner: 42 }), field: 'owner.userId' },
      { input: makeCreateInput({ owner: [] }), field: 'owner.userId' },
      { input: makeCreateInput({ owner: { userId: '' } }), field: 'owner.userId' },
      { input: makeCreateInput({ owner: { userId: '.' } }), field: 'owner.userId' },
      { input: makeCreateInput({ owner: { userId: '..' } }), field: 'owner.userId' },
      { input: makeCreateInput({ owner: { userId: 'a/b' } }), field: 'owner.userId' },
      { input: makeCreateInput({ owner: { userId: 'a\\b' } }), field: 'owner.userId' },
      { input: makeCreateInput({ owner: { userId: 'a\u0000b' } }), field: 'owner.userId' },
      { input: makeCreateInput({ owner: { userId: 'a\u001fb' } }), field: 'owner.userId' },
      { input: makeCreateInput({ owner: { userId: 'a\u007fb' } }), field: 'owner.userId' },
      { input: makeCreateInput({ owner: { userId: 'a\u009fb' } }), field: 'owner.userId' },
      { input: makeCreateInput({ owner: { userId: new String('x') as unknown as string } }), field: 'owner.userId' },
    ];
    const persistence = new CreateStubPersistence();
    const clock = makeManualClock(FIXED_MS);
    const diagnostics: Array<{ type: string }> = [];
    let factoryCalls = 0;
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock,
      scheduler: createRegistryTestScheduler(),
      randomBytes: TEST_RANDOM_BYTES,
      runtimeFactory: () => {
        factoryCalls += 1;
        return makeMarkerRuntime('x', 'y');
      },
      diagnostics: (e) => {
        diagnostics.push({ type: e.type });
      },
    });
    for (const c of badCases) {
      const r = await registry.create(c.input as never);
      expect(r).toMatchObject({ ok: false, code: 'NAMESPACE_INVALID_IDENTITY', field: c.field });
      expect((r as unknown as { message: string }).message).toBe(
        'NAMESPACE_INVALID_IDENTITY: owner.userId 或 namespaceId 不符合安全文法',
      );
    }
    // 零副作用：无 carrier（diagnostics 空）、零 Persistence、零 factory、零 Clock
    expect(diagnostics.length).toBe(0);
    expect(clock.calls).toBe(0);
    expect(persistence.createCalls.length).toBe(0);
    expect(persistence.loadCalls.length).toBe(0);
    expect(factoryCalls).toBe(0);
  });

  it('携带 namespaceId 键（String 对象）先拒：owner Proxy trap 零执行、零任何副作用', async () => {
    // phase-5 切片 1：namespaceId 键出现即拒（descriptor 检查先于 owner 形状读取）——
    // owner 的 getPrototypeOf trap 零执行（键拒收短路）。
    const persistence = new CreateStubPersistence();
    const clock = makeManualClock(FIXED_MS);
    let ownerTrap = 0;
    const hostileOwner = new Proxy(
      {},
      {
        getPrototypeOf() {
          ownerTrap += 1;
          throw new Error('trap');
        },
      },
    );
    const registry = createNamespaceRegistryForTesting(persistence, { clock, scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES });
    const r = await registry.create({
      owner: hostileOwner,
      namespaceId: new String('n1') as unknown as string,
      schema: GOOD_ENVELOPE,
      root: GOOD_ROOT,
    } as never);
    expect(r).toMatchObject({ ok: false, code: 'NAMESPACE_CREATE_INVALID_INPUT' });
    expect(ownerTrap).toBe(0); // 键拒收短路在 owner 形状读取之前
    expect(clock.calls).toBe(0);
    expect(persistence.createCalls.length).toBe(0);
    expect(persistence.loadCalls.length).toBe(0);
  });
});

describe('domain（§3/§5/§6/§9）：schema/root 失败 verbatim issues + 零 Persistence + 恒定 message', () => {
  it('schema compile 失败 → NAMESPACE_SCHEMA_INVALID，issues 与直接 compileSchemaEnvelope 输出深等，零副作用', async () => {
    const direct = compileSchemaEnvelope(BAD_ENVELOPE);
    if (direct.ok) throw new Error('fixture 前置 compileSchemaEnvelope 应失败（BAD_ENVELOPE）');
    const persistence = new CreateStubPersistence();
    const clock = makeManualClock(FIXED_MS);
    let factoryCalls = 0;
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock,
      scheduler: createRegistryTestScheduler(),
      randomBytes: TEST_RANDOM_BYTES,
      runtimeFactory: () => {
        factoryCalls += 1;
        return makeMarkerRuntime('x', 'y');
      },
    });
    const r = await registry.create(makeCreateInput({ schema: BAD_ENVELOPE }));
    expect(r).toMatchObject({ ok: false, code: 'NAMESPACE_SCHEMA_INVALID' });
    expect((r as unknown as { message: string }).message).toBe('NAMESPACE_SCHEMA_INVALID: namespace schema 编译失败');
    const result = r as unknown as { ok: false; issues: unknown[] };
    expect(result.issues).toEqual(direct.issues); // verbatim：完整原对象深等（§3 DQ-4）
    expect(result.issues.length).toBeGreaterThan(0);
    expect(clock.calls).toBe(1); // schema 失败发生在 Clock 之后（§6 固定时序）
    expect(persistence.createCalls.length).toBe(0);
    expect(persistence.loadCalls.length).toBe(0);
    expect(factoryCalls).toBe(0);
  });

  it('ROOT validate 失败 → NAMESPACE_ROOT_INVALID，issues 与直接 validateLogicalSnapshot 深等，零副作用', async () => {
    const derived = derivedOf(GOOD_ENVELOPE);
    const direct = validateLogicalSnapshot(derived, BAD_ROOT);
    if (direct.ok) throw new Error('fixture 前置 validateLogicalSnapshot 应失败（BAD_ROOT）');
    const persistence = new CreateStubPersistence();
    const clock = makeManualClock(FIXED_MS);
    let factoryCalls = 0;
    let documentFactoryCalls = 0;
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock,
      scheduler: createRegistryTestScheduler(),
      randomBytes: TEST_RANDOM_BYTES,
      runtimeFactory: () => {
        factoryCalls += 1;
        return makeMarkerRuntime('x', 'y');
      },
      createDocumentFactory: () => {
        documentFactoryCalls += 1;
        throw new Error('私有 createDocument 不应在 root-invalid 前调用注入的 factory');
      },
    });
    const r = await registry.create(makeCreateInput({ root: BAD_ROOT }));
    expect(r).toMatchObject({ ok: false, code: 'NAMESPACE_ROOT_INVALID' });
    expect((r as unknown as { message: string }).message).toBe(
      'NAMESPACE_ROOT_INVALID: namespace ROOT 不符合 schema 或无法构造',
    );
    const result = r as unknown as { ok: false; issues: unknown[] };
    expect(result.issues).toEqual(direct.issues); // verbatim 深等
    expect(result.issues.length).toBeGreaterThan(0);
    expect(clock.calls).toBe(1);
    expect(documentFactoryCalls).toBe(0); // 注入 factory 未被调用（真实私有 createDocument 内部映射）
    expect(persistence.createCalls.length).toBe(0);
    expect(persistence.loadCalls.length).toBe(0);
    expect(factoryCalls).toBe(0);
  });

  it('domain failures 后 green tail：同 key 后续 create 正常成功', async () => {
    const persistence = new CreateStubPersistence();
    const clock = makeManualClock(FIXED_MS);
    const registry = createNamespaceRegistryForTesting(persistence, { clock, scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES });
    const r1 = await registry.create(makeCreateInput({ schema: BAD_ENVELOPE }));
    expect(r1).toMatchObject({ ok: false, code: 'NAMESPACE_SCHEMA_INVALID' });
    const r2 = await registry.create(makeCreateInput({ root: BAD_ROOT }));
    expect(r2).toMatchObject({ ok: false, code: 'NAMESPACE_ROOT_INVALID' });
    const r3 = await registry.create(makeCreateInput());
    expect(r3.ok).toBe(true);
    expect(persistence.createCalls.length).toBe(1);
    await okLease(r3).release();
  });

  it('Registry 自创 issue 顶层 message 恒定表（§3；逐字无插值）', async () => {
    const persistence = new CreateStubPersistence();
    const clock = makeManualClock(FIXED_MS);
    persistence.queueCreate({ error: new DocDuplicateError() });
    const registry = createNamespaceRegistryForTesting(persistence, { clock, scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES });
    const invalid = await registry.create(makeCreateInput({ owner: { userId: 'bad/owner' } }));
    const inputShape = await registry.create({ owner: { userId: 'u' }, schema: GOOD_ENVELOPE } as never); // 缺 root（恰两键）
    const schemaBad = await registry.create(makeCreateInput({ schema: BAD_ENVELOPE }));
    const rootBad = await registry.create(makeCreateInput({ root: BAD_ROOT }));
    // phase-5 切片 1（ADR 0010）：普通 create 不再产出 ALREADY_EXISTS（DOC_DUPLICATE →
    // 重试环）——注册表常量保留于 types.ts（切片 2 受信任导入路径复用），此处锚定常量
    // 文本而非运行时产出。
    expect((invalid as unknown as { message: string }).message).toBe(
      'NAMESPACE_INVALID_IDENTITY: owner.userId 或 namespaceId 不符合安全文法',
    );
    expect((inputShape as unknown as { message: string }).message).toBe(
      'NAMESPACE_CREATE_INVALID_INPUT: create 输入必须恰含 owner、schema 与 root',
    );
    expect((schemaBad as unknown as { message: string }).message).toBe(
      'NAMESPACE_SCHEMA_INVALID: namespace schema 编译失败',
    );
    expect((rootBad as unknown as { message: string }).message).toBe(
      'NAMESPACE_ROOT_INVALID: namespace ROOT 不符合 schema 或无法构造',
    );
    expect(NAMESPACE_ALREADY_EXISTS_MESSAGE).toBe('NAMESPACE_ALREADY_EXISTS: namespace 已存在，不能重复创建');
  });
});

describe('Registry 自创面负锁（§3/§9：sentinel 不出现在顶层 message/name/stack；内嵌 issues 豁免）', () => {
  it('identity/input/fatal/operational 顶层面零回显 sentinel identity 与 cause', async () => {
    const persistence = new CreateStubPersistence();
    const clock = makeManualClock(FIXED_MS);
    const SENTINEL_OWNER = 'SENTINEL_OWNER_e9f1';
    const SENTINEL_NS = 'SENTINEL_NS_e9f1';
    const SENTINEL_CAUSE = 'SENTINEL_CAUSE_e9f1';
    const events: RegistryObserverEvent[] = [];
    const src = makeCountingRandomBytes();
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock,
      scheduler: createRegistryTestScheduler(),
      randomBytes: src.randomBytes,
      observer: (e) => events.push(e),
    });
    // create operational（typed）→ NAMESPACE_CREATE_FAILED（顶层 message 恒定）；
    // phase-5 切片 1：create 恒三键——namespaceId 由随机源生成（零调用方选值空间）。
    persistence.queueCreate({ error: new DocCreateOperationalError(new Error(SENTINEL_CAUSE)) });
    const failed = await registry.create(makeCreateInput({ owner: { userId: SENTINEL_OWNER } }));
    // fatal（unknown createDoc → lifecycle-slot-internal false）
    persistence.queueCreate({ error: new Error(SENTINEL_CAUSE) });
    const fatal = await registry
      .create(makeCreateInput({ owner: { userId: SENTINEL_OWNER } }))
      .then(
        () => null,
        (e: unknown) => e,
      );
    // invalid identity
    const invalid = await registry.create(
      makeCreateInput({ owner: { userId: `${SENTINEL_OWNER}/x` } }),
    );

    const publicTexts: string[] = [];
    publicTexts.push(JSON.stringify({ code: (failed as { code?: unknown }).code, message: (failed as { message?: unknown }).message }));
    publicTexts.push((invalid as { message: string }).message);
    if (fatal instanceof NamespaceRegistryFatalError) {
      publicTexts.push(fatal.message);
      publicTexts.push(fatal.name);
      publicTexts.push(fatal.stack ?? '');
    }
    for (const text of publicTexts) {
      expect(text).not.toContain(SENTINEL_OWNER);
      expect(text).not.toContain(SENTINEL_NS);
      expect(text).not.toContain(SENTINEL_CAUSE);
    }
    // observer 侧可取得 exact cause/identity（内部诊断面不受零回显约束）
    const persistEv = events.find((e) => e.type === 'create-persist-failed');
    expect(persistEv).toBeDefined();
    if (persistEv?.type === 'create-persist-failed') {
      // exact DocCreateOperationalError 实例；其 inner cause（.cause.cause）保留 sentinel 原文
      // （open 侧 `.cause.cause` 先例）
      expect(((persistEv.cause as { cause?: unknown }).cause as Error).message).toContain(SENTINEL_CAUSE);
    }
    const fatalEv = events.find((e) => e.type === 'lifecycle-slot-failed' && e.operation === 'create');
    expect(fatalEv).toBeDefined();
    if (fatalEv?.type === 'lifecycle-slot-failed') {
      expect((fatalEv.cause as Error).message).toContain(SENTINEL_CAUSE);
      expect(fatalEv.identity.namespaceId).toBe(src.id(2)); // 第 2 次生成（operational 失败第 1 次后）
    }
  });
});

describe('duplicate 四源（§5/§9；phase-5 迁移）：active / zero-lease / idle / 并发 FIFO / persisted 碰撞 → 重生成新 ID（排他性由重生成+耗尽 fatal 承载）', () => {
  it('active entry：第二次 create 首选候选撞 active entry → 重生成新 ID 成功（colliding 候选零 Persistence、零 Clock 读）', async () => {
    // phase-5 切片 1（ADR 0010）：entry 碰撞恒为编排循环的重试条件（排他性由「重生成 +
    // 耗尽 fatal」承载）；active/idle/closing 一律碰撞，绝不等待 closePromise。
    const persistence = new CreateStubPersistence();
    const clock = makeManualClock(FIXED_MS);
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock,
      scheduler: createRegistryTestScheduler(),
      randomBytes: makeScriptedRandomBytes([H1, H1, H2]),
    });
    const r1 = await registry.create(makeCreateInput());
    expect(r1.ok).toBe(true);
    const lease1 = okLease(r1);
    expect(lease1.namespaceId).toBe(`ns-${H1}`);
    const r2 = await registry.create(makeCreateInput());
    expect(r2.ok).toBe(true);
    const lease2 = okLease(r2);
    expect(lease2.namespaceId).toBe(`ns-${H2}`); // H1 撞 active entry → 重生成 H2
    expect(lease2.namespaceId).not.toBe(lease1.namespaceId);
    expect(persistence.createCalls.map((c) => c.docId)).toEqual([`ns-${H1}`, `ns-${H2}`]);
    expect(persistence.loadCalls.length).toBe(0);
    expect(persistence.saveCalls).toBe(0);
    expect(clock.calls).toBe(2); // 每次 create 单读；colliding 候选在 payload/Clock 前短路
    await lease1.release();
    await lease2.release();
  });

  it('lease 全释放后的临时保留态：entry 保留（零 lease）→ 候选碰撞重生成新 ID 成功（零 loadDoc）', async () => {
    // phase-5 切片 1：zero-lease 保留态（release 后、idle 武装前的同步窗口）与 idle 同占
    // 命名空间——create 候选碰撞即重生成；零 loadDoc（entry 打击面零 Persistence）。
    const persistence = new CreateStubPersistence();
    const clock = makeManualClock(FIXED_MS);
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock,
      scheduler: createRegistryTestScheduler(),
      randomBytes: makeScriptedRandomBytes([H1, H1, H2]),
    });
    const lease = okLease(await registry.create(makeCreateInput()));
    await lease.release();
    expect(lease.getStatus()).toMatchObject({ lease: 'released', runtime: null });
    const r2 = await registry.create(makeCreateInput());
    expect(r2.ok).toBe(true);
    expect(okLease(r2).namespaceId).toBe(`ns-${H2}`);
    expect(persistence.createCalls.map((c) => c.docId)).toEqual([`ns-${H1}`, `ns-${H2}`]);
    expect(persistence.loadCalls.length).toBe(0);
    expect(clock.calls).toBe(2);
    await okLease(r2).release();
  });

  it('idle 态（#112 第五态，ADR-0009:68）：release 后 entry 已 idle 武装 → 候选碰撞重生成新 ID 成功；完整窗口后 entry 清理、再 create 新 ID 成功', async () => {
    // #112 DQ-5 扩 idle 行：active（含零 lease）与 idle 同占命名空间；phase-5 切片 1
    // 把「同码 ALREADY_EXISTS」迁移为「碰撞 → 重生成」，idle 依旧占位（不静默放行同 ID）。
    const persistence = new CreateStubPersistence();
    const clock = makeManualClock(FIXED_MS);
    const scheduler = createRegistryTestScheduler();
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock,
      scheduler,
      randomBytes: makeScriptedRandomBytes([H1, H1, H2, H3]),
      idleTimeoutMs: 300_000,
    });
    const lease = okLease(await registry.create(makeCreateInput()));
    expect(lease.namespaceId).toBe(`ns-${H1}`);
    await lease.release();
    expect(scheduler.pending()).toBe(1); // 最后 lease 释放 → idle 武装（显式 idle 行前提）
    const r2 = await registry.create(makeCreateInput());
    expect(r2.ok).toBe(true);
    const lease2 = okLease(r2);
    expect(lease2.namespaceId).toBe(`ns-${H2}`); // idle entry H1 碰撞 → 重生成 H2
    expect(persistence.createCalls.map((c) => c.docId)).toEqual([`ns-${H1}`, `ns-${H2}`]);
    expect(persistence.loadCalls.length).toBe(0);
    expect(clock.calls).toBe(2); // 每次 create 单读；colliding 候选在 payload/Clock 前短路
    await lease2.release();
    // 完整窗口（advanceBy）触发 idle close → entry 清理 → 再 create 新 ID 成功（零残留）
    await scheduler.advanceBy(300_000);
    await flushMicrotasks();
    const r3 = await registry.create(makeCreateInput());
    expect(r3.ok).toBe(true);
    expect(okLease(r3).namespaceId).toBe(`ns-${H3}`);
    expect(persistence.createCalls.length).toBe(3);
    await okLease(r3).release();
  });

  it('并发 FIFO：createDoc gate 固定先后手；后手候选 H1 撞登记 entry → 碰撞零 prepare、重生成 H2 成功', async () => {
    const persistence = new CreateStubPersistence();
    const clock = makeManualClock(FIXED_MS);
    const gate = deferred();
    persistence.queueCreate({ gate });
    let documentFactoryCalls = 0;
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock,
      scheduler: createRegistryTestScheduler(),
      randomBytes: makeScriptedRandomBytes([H1, H1, H2]),
      // 计数 factory：返回合法初始 doc（{ok:true}），使过门 attempt 正常构造；
      // 后手 H1-attempt 在 entry 碰撞处短路（永不进入 createDocument 阶段）。
      createDocumentFactory: () => {
        documentFactoryCalls += 1;
        const doc = new Y.Doc();
        return { ok: true as const, doc };
      },
    });
    const p1 = registry.create(makeCreateInput()); // 先手：停在 createDoc gate
    await flushMicrotasks();
    const p2 = registry.create(makeCreateInput()); // 后手：同候选 H1 → 同 key FIFO 排队
    await flushMicrotasks();
    expect(persistence.createCalls.length).toBe(1); // 后手未并行到达 Persistence
    gate.resolve();
    await p1;
    const r2 = await p2;
    expect(r2.ok).toBe(true); // H1 碰撞 → 重生成 H2 成功
    expect(okLease(r2).namespaceId).toBe(`ns-${H2}`);
    expect(persistence.createCalls.map((c) => c.docId)).toEqual([`ns-${H1}`, `ns-${H2}`]);
    expect(clock.calls).toBe(2); // 每次 create 单读；后手 colliding 候选未读 Clock
    expect(documentFactoryCalls).toBe(2); // 后手仅重试候选进入构造步（H1 碰撞零调用）
    await okLease(r2).release();
  });

  it('persisted DocDuplicateError：createDoc 抛 typed duplicate → 换 ID 重试成功（排他性由「重生成 + 耗尽 fatal」承载）', async () => {
    const persistence = new CreateStubPersistence();
    const clock = makeManualClock(FIXED_MS);
    persistence.queueCreate({ error: new DocDuplicateError() }); // 仅首个 createDoc 命中
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock,
      scheduler: createRegistryTestScheduler(),
      randomBytes: makeScriptedRandomBytes([H1, H2]),
    });
    const r = await registry.create(makeCreateInput());
    expect(r.ok).toBe(true);
    const lease = okLease(r);
    expect(lease.namespaceId).toBe(`ns-${H2}`); // H1 duplicate → 重生成 H2
    expect(persistence.createCalls.map((c) => c.docId)).toEqual([`ns-${H1}`, `ns-${H2}`]);
    expect(persistence.loadCalls.length).toBe(0);
    expect(persistence.saveCalls).toBe(0);
    expect(clock.calls).toBe(1); // Clock 单读（一次/create，不随重试递增）
    await lease.release();
  });
});

describe('persistence 映射（§7/§9 表）：operational/duplicate/fatal false/true/unknown false + observer', () => {
  it('DocCreateOperationalError → NAMESPACE_CREATE_FAILED + observer create-persist-failed 带 exact cause', async () => {
    const persistence = new CreateStubPersistence();
    const clock = makeManualClock(FIXED_MS);
    const typed = new DocCreateOperationalError(new Error('store-write-rejected'));
    persistence.queueCreate({ error: typed });
    const events: RegistryObserverEvent[] = [];
    const src = makeCountingRandomBytes();
    const registry = createNamespaceRegistryForTesting(persistence, { clock, scheduler: createRegistryTestScheduler(), randomBytes: src.randomBytes, observer: (e) => events.push(e) });
    const r = await registry.create(makeCreateInput());
    expect(r).toMatchObject({ ok: false, code: 'NAMESPACE_CREATE_FAILED' });
    expect((r as unknown as { message: string }).message).toBe(
      'NAMESPACE_CREATE_FAILED: namespace 持久化创建发生运营故障',
    );
    expect(persistence.loadCalls.length).toBe(0);
    expect(persistence.saveCalls).toBe(0);
    const ev = events.find((e) => e.type === 'create-persist-failed');
    expect(ev).toBeDefined();
    if (ev?.type === 'create-persist-failed') {
      expect(ev.cause).toBe(typed); // exact error（instance 级）
      expect(ev.identity.owner).toEqual({ userId: 'u-alice' });
      expect(ev.identity.namespaceId).toBe(src.id(1)); // 第 1 次生成（生成 ID——phase-5）
      expect(typeof ev.identity.key).toBe('string');
    }
    // 无其它失败事件（狭窄 issue 不发 lifecycle-slot-failed）
    expect(events.filter((e) => e.type === 'lifecycle-slot-failed').length).toBe(0);
  });

  it('DocCreateFatalError(probe-read → committed:false)：fatal create/lifecycle-slot-internal/false + observer exact', async () => {
    const persistence = new CreateStubPersistence();
    const clock = makeManualClock(FIXED_MS);
    const typed = new DocCreateFatalError('probe-read', new Error('pre-commit-store'));
    persistence.queueCreate({ error: typed });
    const events: RegistryObserverEvent[] = [];
    const registry = createNamespaceRegistryForTesting(persistence, { clock, scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES, observer: (e) => events.push(e) });
    const p = registry.create(makeCreateInput());
    await expect(p).rejects.toMatchObject({
      code: 'NAMESPACE_REGISTRY_FATAL',
      operation: 'create',
      phase: 'lifecycle-slot-internal',
      committed: false,
    });
    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(NamespaceRegistryFatalError);
    if (err instanceof NamespaceRegistryFatalError) {
      expect(err.cause).toBe(typed);
      expect(err.message).toBe(
        'NAMESPACE_REGISTRY_FATAL: create 在 lifecycle-slot-internal 发生内部故障（committed=false）',
      );
    }
    const ev = events.find((e) => e.type === 'lifecycle-slot-failed');
    expect(ev).toBeDefined();
    if (ev?.type === 'lifecycle-slot-failed') {
      expect(ev.cause).toBe(typed);
      expect(ev.operation).toBe('create');
    }
    expect(persistence.loadCalls.length).toBe(0);
  });

  it('DocCreateFatalError(post-commit → committed:true)：phase 改写为 Registry 词表、committed 原样 true', async () => {
    const persistence = new CreateStubPersistence();
    const clock = makeManualClock(FIXED_MS);
    const typed = new DocCreateFatalError('post-commit', new Error('post-commit-store'));
    persistence.queueCreate({ error: typed });
    const registry = createNamespaceRegistryForTesting(persistence, { clock, scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES });
    const p = registry.create(makeCreateInput());
    await expect(p).rejects.toMatchObject({
      code: 'NAMESPACE_REGISTRY_FATAL',
      operation: 'create',
      phase: 'lifecycle-slot-internal',
      committed: true,
    });
    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    if (err instanceof NamespaceRegistryFatalError) {
      expect(err.cause).toBe(typed);
    }
  });

  it('unknown createDoc throw：fatal create/lifecycle-slot-internal/committed:false（DQ-6 定死），exact cause', async () => {
    const persistence = new CreateStubPersistence();
    const clock = makeManualClock(FIXED_MS);
    const boom = new Error('unknown-adapter-breach');
    persistence.queueCreate({ error: boom });
    const events: RegistryObserverEvent[] = [];
    const registry = createNamespaceRegistryForTesting(persistence, { clock, scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES, observer: (e) => events.push(e) });
    const p = registry.create(makeCreateInput());
    await expect(p).rejects.toMatchObject({
      code: 'NAMESPACE_REGISTRY_FATAL',
      operation: 'create',
      phase: 'lifecycle-slot-internal',
      committed: false,
    });
    const ev = events.find((e) => e.type === 'lifecycle-slot-failed');
    expect(ev).toBeDefined();
    if (ev?.type === 'lifecycle-slot-failed') {
      expect(ev.cause).toBe(boom);
      expect(ev.operation).toBe('create');
    }
  });

  it('observer throw 隔离：operational 路径 observer 抛错仍 resolve 窄 issue；fatal 路径仍 reject 原始 fatal', async () => {
    const persistence = new CreateStubPersistence();
    const clock = makeManualClock(FIXED_MS);
    persistence.queueCreate({ error: new DocCreateOperationalError(new Error('store-boom')) });
    persistence.queueCreate({ error: new Error('unknown-boom') });
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock,
      scheduler: createRegistryTestScheduler(),
      randomBytes: TEST_RANDOM_BYTES,
      observer: () => {
        throw new Error('observer-isolated');
      },
    });
    const r1 = await registry.create(makeCreateInput());
    expect(r1).toMatchObject({ ok: false, code: 'NAMESPACE_CREATE_FAILED' });
    const p2 = registry.create(makeCreateInput());
    await expect(p2).rejects.toMatchObject({
      operation: 'create',
      phase: 'lifecycle-slot-internal',
      committed: false,
    });
  });

  it('operational 失败后 tail 继续：同 key 再 create 可正常成功', async () => {
    const persistence = new CreateStubPersistence();
    const clock = makeManualClock(FIXED_MS);
    persistence.queueCreate({ error: new DocCreateOperationalError(new Error('transient')) });
    const registry = createNamespaceRegistryForTesting(persistence, { clock, scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES });
    const r1 = await registry.create(makeCreateInput());
    expect(r1).toMatchObject({ ok: false, code: 'NAMESPACE_CREATE_FAILED' });
    const r2 = await registry.create(makeCreateInput());
    expect(r2.ok).toBe(true);
    expect(persistence.createCalls.length).toBe(2);
    await okLease(r2).release();
  });
});

describe('Clock（§6/§8/§9）：构造门禁 + 非法读数 fatal false + 每 slot 恰读一次', () => {
  const CLOCK_GATE_MESSAGE = 'NAMESPACE_REGISTRY_CLOCK_REQUIRED: Registry 必须提供可调用的 Clock.now';
  const persistenceFor = (): CreateStubPersistence => new CreateStubPersistence();

  it('生产工厂构造门禁：omitted/null/non-object/now 非函数 → 同步固定 TypeError（零回显传入值）', () => {
    const cases: Array<{ name: string; options: unknown }> = [
      { name: 'omitted', options: undefined },
      { name: 'null', options: null },
      { name: 'non-object', options: 42 },
      { name: 'now non-function', options: { clock: {} } },
    ];
    for (const c of cases) {
      let thrown: unknown;
      try {
        void createNamespaceRegistryForTesting(persistenceFor(), c.options as never);
      } catch (e) {
        thrown = e;
      }
      expect(thrown, `${c.name} → 同步 TypeError`).toBeInstanceOf(TypeError);
      if (thrown instanceof TypeError) {
        expect(thrown.message).toBe(CLOCK_GATE_MESSAGE);
      }
    }
  });

  it('testing 工厂构造门禁：omitted/null/now 非函数 → 同步固定 TypeError', () => {
    const cases: Array<{ name: string; options: unknown }> = [
      { name: 'omitted', options: undefined },
      { name: 'null', options: null },
      { name: 'now non-function', options: { clock: {} } },
    ];
    for (const c of cases) {
      let thrown: unknown;
      try {
        void createNamespaceRegistryForTesting(persistenceFor(), c.options as never);
      } catch (e) {
        thrown = e;
      }
      expect(thrown, `${c.name} → 同步 TypeError`).toBeInstanceOf(TypeError);
      if (thrown instanceof TypeError) {
        expect(thrown.message).toBe(CLOCK_GATE_MESSAGE);
      }
    }
  });

  it('now() throw → fatal create/create-document-internal/false + observer lifecycle-slot-failed(create) + 零 Persistence', async () => {
    const persistence = new CreateStubPersistence();
    const clockCause = new Error('clock-probe-boom');
    const clock = {
      now() {
        throw clockCause;
      },
    };
    const events: RegistryObserverEvent[] = [];
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock,
      scheduler: createRegistryTestScheduler(),
      randomBytes: TEST_RANDOM_BYTES,
      observer: (e) => events.push(e),
    });
    const p = registry.create(makeCreateInput());
    await expect(p).rejects.toMatchObject({
      code: 'NAMESPACE_REGISTRY_FATAL',
      operation: 'create',
      phase: 'create-document-internal',
      committed: false,
    });
    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    if (err instanceof NamespaceRegistryFatalError) {
      expect(err.cause).toBe(clockCause);
    }
    const ev = events.find((e) => e.type === 'lifecycle-slot-failed');
    expect(ev).toBeDefined();
    if (ev?.type === 'lifecycle-slot-failed') {
      expect(ev.cause).toBe(clockCause);
      expect(ev.operation).toBe('create');
    }
    expect(persistence.createCalls.length).toBe(0);
    expect(persistence.loadCalls.length).toBe(0);
  });

  it('now() NaN/Infinity/超 ±8.64e15 → 同一 fatal false + 零 Persistence（不读 createDocument）', async () => {
    const badValues = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 8.64e15 + 1, -(8.64e15 + 1)];
    for (const bad of badValues) {
      const persistence = new CreateStubPersistence();
      const clock = { now: () => bad };
      const registry = createNamespaceRegistryForTesting(persistence, { clock, scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES });
      const p = registry.create(makeCreateInput());
      await expect(p, `clock.now() === ${bad}`).rejects.toMatchObject({
        operation: 'create',
        phase: 'create-document-internal',
        committed: false,
      });
      expect(persistence.createCalls.length).toBe(0);
      expect(persistence.loadCalls.length).toBe(0);
    }
  });

  it('合法边界值 ±8.64e15 被接受；createdAt 与 toISOString 精确一致', async () => {
    const persistence = new CreateStubPersistence();
    const clock = makeManualClock(8.64e15);
    const registry = createNamespaceRegistryForTesting(persistence, { clock, scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES });
    const lease = okLease(await registry.create(makeCreateInput()));
    expect(lease.getMetadata().createdAt).toBe(new Date(8.64e15).toISOString());
    await lease.release();
  });

  it('Clock 恰读一次：payload 失败不读、entry 碰撞候选不读、DOC_DUPLICATE 重试不重复读（counter 锚）', async () => {
    const persistence = new CreateStubPersistence();
    const clock = makeManualClock(FIXED_MS);
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock,
      scheduler: createRegistryTestScheduler(),
      randomBytes: makeScriptedRandomBytes([H1, H1, H2, H3, H4]),
    });
    // payload 失败：function root → 0 读（生成后、快照前短路）
    await registry.create(makeCreateInput({ root: { f: () => 1 } }));
    expect(clock.calls).toBe(0);
    // 成功 create：1 读
    const lease = okLease(await registry.create(makeCreateInput()));
    expect(clock.calls).toBe(1);
    // entry 碰撞（active）：colliding 候选 0 阅读、重生成候选读 1 次 → 每次 create 单读
    const leaseB = okLease(await registry.create(makeCreateInput()));
    expect(clock.calls).toBe(2);
    await lease.release();
    await leaseB.release();
    // persisted duplicate（新候选，无 entry）：该 create 单读（Clock 在 createDoc 之前
    // 恰 1 次——重试候选复用 preparedBox，不重复读）。
    persistence.queueCreate({ error: new DocDuplicateError() });
    const leaseC = okLease(await registry.create(makeCreateInput()));
    expect(clock.calls).toBe(3);
    expect(persistence.createCalls.map((c) => c.docId)).toEqual([`ns-${H1}`, `ns-${H2}`, `ns-${H3}`, `ns-${H4}`]);
    await leaseC.release();
  });
});

describe('post-commit factory failure（§7/§9 DQ-7）：release 恰一次、文档保留、零 entry 残留、后续 open 可恢复', () => {
  it('createDoc resolved → runtimeFactory throw → fatal create/runtime-construction/true + 文档保留 + 后续 open 完整', async () => {
    const persistence = new CreateStubPersistence();
    const clock = makeManualClock(FIXED_MS);
    const factoryCause = new Error('factory-boom-post-commit');
    const events: RegistryObserverEvent[] = [];
    let factoryCalls = 0;
    const src = makeCountingRandomBytes();
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock,
      scheduler: createRegistryTestScheduler(),
      randomBytes: src.randomBytes,
      runtimeFactory: (handle, notifyDirty) => {
        factoryCalls += 1;
        // 仅首次（create 路径）工厂故障；后续 open/再 create 委托真实 P0 工厂——
        // 文档保留/复用恢复走真实 Runtime（§7 DQ-7 恢复路径锚定）。
        if (factoryCalls === 1) {
          throw factoryCause;
        }
        return createNamespaceRuntimeForRegistry(handle, notifyDirty);
      },
      observer: (e) => events.push(e),
    });
    const p = registry.create(makeCreateInput());
    await expect(p).rejects.toMatchObject({
      code: 'NAMESPACE_REGISTRY_FATAL',
      operation: 'create',
      phase: 'runtime-construction',
      committed: true,
    });
    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(NamespaceRegistryFatalError);
    if (err instanceof NamespaceRegistryFatalError) {
      expect(err.cause).toBe(factoryCause); // 主 fatal 保留 factory cause
      expect(err.message).not.toContain('factory-boom-post-commit'); // 零回显
    }
    // 默认 handle.resolve 变体：无 handle-release-failed 事件（release 冲销成功）
    const factoryEv = events.find((e) => e.type === 'create-runtime-construction-failed');
    expect(factoryEv).toBeDefined();
    if (factoryEv?.type === 'create-runtime-construction-failed') {
      expect(factoryEv.cause).toBe(factoryCause);
    }
    expect(events.some((e) => e.type === 'handle-release-failed')).toBe(false);
    // 文档保留：后续 open 得 lease 且内容完整（createDoc 已 committed；生成 ID 经
    // 观察者事件回读——contract 面经 lease/source id 传递）
    const committedId = src.id(1); // 第 1 次生成即失败 create 的候选 ID（committed 文档）
    const openLease = okLease(await registry.open({ userId: 'u-alice' }, committedId));
    expect(openLease.getMetadata().createdAt).toBe(FIXED_ISO);
    expect(openLease.readData(['n'])).toEqual({ ok: true, value: 42 });
    await openLease.release();
    // 零 entry 残留：失败的 create 未建 entry——上面的 open 走了 loadDoc 恢复路径
    // （而非 entry 命中）；此后 entry 由 open 建立，再 open 复用同一 Runtime 且不再
    // loadDoc（若 create 失败留下了 entry，首次 open 会 entry 命中、loadCalls 为 0）。
    const r3 = await registry.open({ userId: 'u-alice' }, committedId);
    expect(r3.ok).toBe(true);
    expect(persistence.loadCalls.length).toBe(1);
    await okLease(r3).release();
  });

  it('注入 handle fixture：release reject → handle-release-failed exact cause；主 fatal 仍为 factory cause', async () => {
    const persistence = new CreateStubPersistence();
    const clock = makeManualClock(FIXED_MS);
    const releaseError = new Error('release-reject-boom');
    const doc = new Y.Doc();
    const injectedHandle = new CreateStubHandle({ userId: 'u-alice' }, 'k-ns', doc, releaseError);
    persistence.queueCreate({ handle: injectedHandle });
    const factoryCause = new Error('factory-boom-2');
    const events: RegistryObserverEvent[] = [];
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock,
      scheduler: createRegistryTestScheduler(),
      randomBytes: TEST_RANDOM_BYTES,
      runtimeFactory: () => {
        throw factoryCause;
      },
      observer: (e) => events.push(e),
    });
    const p = registry.create(makeCreateInput());
    await p.catch(() => {});
    expect(injectedHandle.releaseCalls).toBe(1); // release 恰一次
    const releaseEv = events.find((e) => e.type === 'handle-release-failed');
    expect(releaseEv).toBeDefined();
    if (releaseEv?.type === 'handle-release-failed') {
      expect(releaseEv.cause).toBe(releaseError);
    }
    const factoryEv = events.find((e) => e.type === 'create-runtime-construction-failed');
    expect(factoryEv).toBeDefined();
    if (factoryEv?.type === 'create-runtime-construction-failed') {
      expect(factoryEv.cause).toBe(factoryCause);
    }
    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(NamespaceRegistryFatalError);
    if (err instanceof NamespaceRegistryFatalError) {
      expect(err.cause).toBe(factoryCause);
      expect(err.committed).toBe(true);
    }
  });

  it('release 永不 settle：create() 仍 settle（reject runtime-construction fatal），不阻塞 fatal 交付', async () => {
    const persistence = new CreateStubPersistence();
    const clock = makeManualClock(FIXED_MS);
    const doc = new Y.Doc();
    const handle = new NeverSettleCreateHandle({ userId: 'u-alice' }, 'k-ns', doc);
    persistence.queueCreate({ handle });
    const factoryCause = new Error('factory-boom-never-settle');
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock,
      scheduler: createRegistryTestScheduler(),
      randomBytes: TEST_RANDOM_BYTES,
      runtimeFactory: () => {
        throw factoryCause;
      },
    });
    const p = registry.create(makeCreateInput());
    let settled: 'pending' | 'resolved' | 'rejected' = 'pending';
    let outcome: unknown;
    void p.then(
      (v) => {
        settled = 'resolved';
        outcome = v;
      },
      (e) => {
        settled = 'rejected';
        outcome = e;
      },
    );
    // 排空微任务 + setImmediate 宏任务后判定：不依赖框架超时（§9 手法）
    await flushMicrotasks(24);
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(
      settled,
      'release 永不 settle 时 create() 必须仍 settle 并 reject runtime-construction fatal',
    ).not.toBe('pending');
    expect(settled).toBe('rejected');
    expect(outcome).toBeInstanceOf(NamespaceRegistryFatalError);
    if (outcome instanceof NamespaceRegistryFatalError) {
      expect(outcome.operation).toBe('create');
      expect(outcome.phase).toBe('runtime-construction');
      expect(outcome.committed).toBe(true);
      expect(outcome.cause).toBe(factoryCause);
    }
    expect(handle.releaseCalls).toBe(1);
  });
});

describe('ordering/concurrency（§5/§9）：create→open、open→create、gate 排队、失败 tail', () => {
  it('create→open：open 不观察 transient missing；复用同一 Runtime identity（marker 断言，loadDoc 零）', async () => {
    const persistence = new CreateStubPersistence();
    const clock = makeManualClock(FIXED_MS);
    const src = makeCountingRandomBytes();
    let factoryCalls = 0;
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock,
      scheduler: createRegistryTestScheduler(),
      randomBytes: src.randomBytes,
      runtimeFactory: () => {
        factoryCalls += 1;
        return makeMarkerRuntime('RUNTIME_MARKER_9f', 'k-ns');
      },
    });
    const lease1 = okLease(await registry.create(makeCreateInput()));
    const lease2 = okLease(await registry.open({ userId: 'u-alice' }, src.id(1)));
    expect(factoryCalls).toBe(1); // open 复用 entry 的 Runtime（同一 identity）
    expect(lease1.readData(['x'])).toEqual({ ok: true, value: 'RUNTIME_MARKER_9f' });
    expect(lease2.readData(['x'])).toEqual({ ok: true, value: 'RUNTIME_MARKER_9f' });
    expect(lease1).not.toBe(lease2);
    expect(persistence.loadCalls.length).toBe(0);
    expect(persistence.createCalls.length).toBe(1);
    await lease1.release();
    await lease2.release();
  });

  it('open→create：独立结算（open NOT_FOUND 不毒化后续 create），再 open 复用 entry', async () => {
    const persistence = new CreateStubPersistence();
    const clock = makeManualClock(FIXED_MS);
    const src = makeCountingRandomBytes();
    const registry = createNamespaceRegistryForTesting(persistence, { clock, scheduler: createRegistryTestScheduler(), randomBytes: src.randomBytes });
    const open1 = await registry.open({ userId: 'u-alice' }, src.id(1));
    expect(open1).toMatchObject({ ok: false, code: 'NAMESPACE_NOT_FOUND' });
    expect(persistence.loadCalls.length).toBe(1);
    const created = await registry.create(makeCreateInput());
    expect(created.ok).toBe(true);
    const lease = okLease(created);
    expect(lease.namespaceId).toBe(src.id(1));
    const open2 = await registry.open({ userId: 'u-alice' }, src.id(1));
    expect(open2.ok).toBe(true);
    expect(persistence.loadCalls.length).toBe(1); // 复用 entry，不再 load
    await lease.release();
    await okLease(open2).release();
  });

  it('createDoc gate 挂起期：同 key open 排队（loadDoc 不达）、异 key create 并行到达 Persistence', async () => {
    const persistence = new CreateStubPersistence();
    const clock = makeManualClock(FIXED_MS);
    const gate = deferred();
    persistence.queueCreate({ gate });
    const src = makeCountingRandomBytes();
    const registry = createNamespaceRegistryForTesting(persistence, { clock, scheduler: createRegistryTestScheduler(), randomBytes: src.randomBytes });
    const p1 = registry.create(makeCreateInput());
    await flushMicrotasks();
    expect(persistence.createCalls.map((c) => c.docId)).toEqual([src.id(1)]);
    // 同 ID open：同 carrier FIFO → loadDoc 不达
    const sameOpen = registry.open({ userId: 'u-alice' }, src.id(1));
    await flushMicrotasks();
    expect(persistence.loadCalls.length).toBe(0);
    // 异候选 create：不同 carrier → 并行到达 Persistence
    const p2 = registry.create(makeCreateInput());
    await flushMicrotasks();
    expect(persistence.createCalls.map((c) => c.docId).sort()).toEqual([src.id(1), src.id(2)].sort());
    gate.resolve();
    expect((await p1).ok).toBe(true);
    expect((await sameOpen).ok).toBe(true); // create 成功后 open 合法
    expect((await p2).ok).toBe(true);
    expect(persistence.loadCalls.length).toBe(0);
  });

  it('unknown 失败后 tail 继续：同 key 再 create 正常成功（独立 carrier 代际）', async () => {
    const persistence = new CreateStubPersistence();
    const clock = makeManualClock(FIXED_MS);
    persistence.queueCreate({ error: new Error('create-slot-boom') });
    const registry = createNamespaceRegistryForTesting(persistence, { clock, scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES });
    const p1 = registry.create(makeCreateInput());
    await expect(p1).rejects.toBeInstanceOf(NamespaceRegistryFatalError);
    const r2 = await registry.create(makeCreateInput());
    expect(r2.ok).toBe(true);
    expect(persistence.createCalls.length).toBe(2);
    await okLease(r2).release();
  });

  it('hostile slot 失败后同 key open 正常：拒绝 slot 不毒化 carrier/open 路径', async () => {
    const persistence = new CreateStubPersistence();
    const clock = makeManualClock(FIXED_MS);
    const registry = createNamespaceRegistryForTesting(persistence, { clock, scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES });
    const r1 = await registry.create(makeCreateInput({ root: { f: () => 1 } })); // payload 拒绝
    expect(r1).toMatchObject({ ok: false, code: 'NAMESPACE_CREATE_INVALID_INPUT' });
    const r2 = await registry.open({ userId: 'u-alice' }, 'k-ns');
    expect(r2).toMatchObject({ ok: false, code: 'NAMESPACE_NOT_FOUND' });
    const r3 = await registry.create(makeCreateInput());
    expect(r3.ok).toBe(true);
    await okLease(r3).release();
  });
});

describe('seam 注入（§5/§7/§9 R2-H1）：Registry 收到 input-invalid 不可达 → create-document-internal false fatal', () => {
  it('注入 createDocumentFactory 返回 input-invalid：observer + fatal false + 零 Persistence（绝不映射 domain issue）', async () => {
    const persistence = new CreateStubPersistence();
    const clock = makeManualClock(FIXED_MS);
    const events: RegistryObserverEvent[] = [];
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock,
      scheduler: createRegistryTestScheduler(),
      randomBytes: TEST_RANDOM_BYTES,
      observer: (e) => events.push(e),
      createDocumentFactory: () => ({
        ok: false as const,
        kind: 'input-invalid' as const,
        issues: [{ message: 'injected input-invalid', path: [] }],
      }),
    });
    const p = registry.create(makeCreateInput());
    await expect(p).rejects.toMatchObject({
      operation: 'create',
      phase: 'create-document-internal',
      committed: false,
    });
    const ev = events.find((e) => e.type === 'lifecycle-slot-failed');
    expect(ev).toBeDefined();
    if (ev?.type === 'lifecycle-slot-failed') {
      expect(ev.operation).toBe('create');
      expect(ev.cause).toBeInstanceOf(Error);
    }
    expect(persistence.createCalls.length).toBe(0);
    expect(persistence.loadCalls.length).toBe(0);
  });
});
