/**
 * SA6 红灯锚定 — issue #131（Phase 5 切片 1）：namespaceId 成为唯一 Registry
 * entry 身份；普通 create 由注入的受控 128-bit CSPRNG 生成 `ns-`+32 小写 hex，
 * 不再接受调用方 namespaceId。
 *
 * 契约来源（决议文件 #131 的 ADR 0010 + phase-5 文档 §实施切片 1）：
 * - AC-1：普通 create 生成 `ns-`+32 小写 hex（注入受控 CSPRNG）；调用方选定的
 *   namespaceId 不再被接受；
 * - AC-2：与 active/idle/closing Registry entry 或 target-owner Persistence
 *   duplicate 碰撞 → 重新生成并重试（至多 8 次重试）；耗尽 → committed:false
 *   Registry fatal（新 phase——非 ADR 0009 初始三 phase 之一）；
 * - AC-3：Registry 生命周期串行与 Runtime 复用仅按 namespaceId 索引（同一
 *   namespaceId 每进程至多一个 Runtime）；
 * - AC-4：open/create 仍校验并投影 owner；owner mismatch → 既有 not-found
 *   结果（NAMESPACE_NOT_FOUND），绝不暴露/复用另一 owner 的 Runtime 与文档；
 * - AC-5：Persistence 继续按 owner 分区存储（createDoc(owner, 生成ID, doc)），
 *   不新增跨 owner catalog；
 * - AC-6：覆盖生成、重试耗尽、owner mismatch、并发、shutdown 与公共面兼容
 *   （类型面契约见 registry-phase5-identity-surface.test-d.ts）。
 * - 回补锚（设计 wiki §12.3，R3）：锚 A（D-9 shutdown×在途重试结算屏障）、
 *   锚 B（D-3 随机源运行期形状违约 → 立即 fatal、零重试预算消耗，B1 throw /
 *   B2 15 字节 / B3 非 Uint8Array 并案）、锚 C（C-1 推论 1 同候选并发排他）。
 *
 * 红灯机制（基线 = (owner.userId, namespaceId) 复合 key + create 接受调用方
 * namespaceId 的当前实现）：
 * - 合法新输入（{owner, schema, root} 三键）被当前实现以
 *   NAMESPACE_INVALID_IDENTITY（缺 namespaceId）拒绝 → 期望 ok 处红；
 * - 携带 namespaceId 的四键输入被当前实现接受（创建成功）→ 期望
 *   NAMESPACE_CREATE_INVALID_INPUT 处红；
 * - 无受控随机源的构造被当前实现接受 → 期望构造期 TypeError 处红；
 * - owner mismatch 当前实现走复合 key 分支（loadDoc(B, nsId) / 复用 B 分区
 *   文档）→ 期望零 loadDoc / NOT_FOUND 处红。
 *
 * 本文件只锚定运行时行为；全部 test 在基线上必须失败（红）。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { DocDuplicateError } from '@nomicore/persistence';
import type { DocHandle, DocPersistence, User } from '@nomicore/persistence';
import { NamespaceRegistryFatalError, createNamespaceRegistry } from '@nomicore/namespace-registry';
import type { CreateNamespaceInput, NamespaceLease, NamespaceRegistry } from '@nomicore/namespace-registry';
import {
  createNamespaceRegistryForTesting,
  createRegistryTestScheduler,
  type NamespaceRegistryTestingOverrides,
} from '@nomicore/namespace-registry/testing';
import type { SchemaEnvelope } from '@nomicore/vfsl';

// ═══════════════════════════════ 基础设施 ═══════════════════════════════

/** 16 字节（128-bit）十六进制段落 → Uint8Array（受控随机源的剧本单元）。 */
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

const X_HEX = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; // ns-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
const Y_HEX = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'; // ns-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
const X_ID = `ns-${X_HEX}`;
const Y_ID = `ns-${Y_HEX}`;

/** 显式 deferred（禁 real sleep；确定性 gate 原语，沿用 registry-create.test.ts 先例）。 */
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

/** unhandledRejection 探针（显式探针手法，沿用 registry-idle.test.ts 先例；
 * 绝不用 vitest 全局忽略兜底）。 */
function collectUnhandledRejections(): { readonly events: unknown[]; dispose(): void } {
  const events: unknown[] = [];
  const onRejection = (reason: unknown): void => {
    events.push(reason);
  };
  process.on('unhandledRejection', onRejection);
  return {
    events,
    dispose() {
      process.off('unhandledRejection', onRejection);
    },
  };
}

/**
 * 受控随机源剧本（SA6 契约面：`randomBytes(length: number): Uint8Array`）：
 * - 每次调用必须恰好请求 16 字节（128-bit CSPRNG 语义）；
 * - 超出剧本再取 → throw（把「重试预算超发」变成可观测失败）；
 * - `consumed` 为 getter：调用方必须先取 `src` 引用、**严禁解构取值**（解构只在
 *   瞬间读取一次，恒为 0——R4 结构性缺陷），断言点以 `src.consumed` 惰性读取。
 */
function makeScriptedRandomBytes(hexChunks: readonly string[]): {
  randomBytes: (length: number) => Uint8Array;
  readonly consumed: number;
} {
  let consumed = 0;
  const chunks = hexChunks.map(hexToBytes16);
  return {
    randomBytes(length: number): Uint8Array {
      if (length !== 16) {
        throw new Error(`受控随机源必须按 128-bit（16 字节）请求，实际请求 ${length} 字节`);
      }
      const chunk = chunks[consumed];
      if (chunk === undefined) {
        throw new Error('受控随机源超出剧本：实现的重试次数超过 SA6 契约预算');
      }
      consumed += 1;
      return chunk;
    },
    get consumed() {
      return consumed;
    },
  };
}

const GOOD_ENVELOPE: SchemaEnvelope = Object.freeze({
  lang: 'vfsl',
  version: 1,
  id: 'phase5-red',
  text: 'type ROOT = { n: number; };\n',
});
const GOOD_ROOT = Object.freeze({ n: 42 });
const FIXED_MS = 1_700_000_123_456;

function makeManualClock(initialMs = FIXED_MS): { now(): number } {
  return { now: () => initialMs };
}

/** 新契约 create 输入（恒三键 {owner, schema, root}——当前类型面仍四键，
 * 以类型断言表达「实现签名未知」的接纳段运行时契约）。 */
function newContractInput(overrides: { owner?: unknown; schema?: unknown; root?: unknown } = {}): CreateNamespaceInput {
  return {
    owner: overrides.owner ?? { userId: 'u-alice' },
    schema: overrides.schema ?? GOOD_ENVELOPE,
    root: overrides.root ?? GOOD_ROOT,
  } as CreateNamespaceInput;
}

/** 旧形状四键输入（调用方选定 namespaceId）——AC-1 的拒绝面。 */
function legacyShapeInput(namespaceId: string): CreateNamespaceInput {
  return {
    owner: { userId: 'u-alice' },
    namespaceId,
    schema: GOOD_ENVELOPE,
    root: GOOD_ROOT,
  } as CreateNamespaceInput;
}

// ── 受控 Persistence stub：按 (owner.userId, docId) 分区建模 + 可脚本化 duplicate ──

class Phase5StubPersistence implements DocPersistence {
  readonly createCalls: Array<{ owner: User; docId: string }> = [];
  readonly loadCalls: Array<{ owner: User; docId: string }> = [];
  saveCalls = 0;
  readonly duplicateDocIds = new Set<string>();
  /** 已提交文档：分区键 = `${owner.userId}\u0000${docId}`（模拟 owner 目录分区）。 */
  private readonly committed = new Map<string, { owner: User; docId: string; doc: Y.Doc }>();
  /** createDoc 确定性 gate（锚 A：按 docId 制造「重试 attempt 在途」窗口）。 */
  private readonly createGates = new Map<string, Deferred>();

  private static partition(owner: User, docId: string): string {
    return `${owner.userId}\u0000${docId}`;
  }

  /** 使下一次 `createDoc(owner, docId, doc)` 在 duplicate 检查后停在 gate.promise 上。 */
  gateCreate(docId: string): Deferred {
    const gate = deferred();
    this.createGates.set(docId, gate);
    return gate;
  }

  seedDocument(owner: User, docId: string, doc: Y.Doc = new Y.Doc()): void {
    this.committed.set(Phase5StubPersistence.partition(owner, docId), { owner, docId, doc });
  }

  async createDoc(owner: User, docId: string, doc: Y.Doc): Promise<DocHandle> {
    this.createCalls.push({ owner, docId });
    if (this.duplicateDocIds.has(docId) || this.committed.has(Phase5StubPersistence.partition(owner, docId))) {
      throw new DocDuplicateError(); // 排他创建：同分区已有 → DOC_DUPLICATE（ADR-0006 #64）
    }
    const gate = this.createGates.get(docId);
    if (gate !== undefined) {
      await gate.promise; // 确定性在途窗口（锚 A）
    }
    this.seedDocument(owner, docId, doc);
    return this.makeHandle(owner, docId, doc);
  }

  async loadDoc(owner: User, docId: string): Promise<DocHandle | null> {
    this.loadCalls.push({ owner, docId });
    const entry = this.committed.get(Phase5StubPersistence.partition(owner, docId));
    return entry === undefined ? null : this.makeHandle(entry.owner, entry.docId, entry.doc);
  }

  async saveDoc(): Promise<void> {
    this.saveCalls += 1;
  }

  private makeHandle(owner: User, docId: string, doc: Y.Doc): DocHandle {
    return {
      owner,
      docId,
      doc,
      getStatus: () => 'ready' as const,
      release: async () => {},
    };
  }
}

// ── Fake Runtime 工厂（计数：constructed / closed；可注入 close gate）────────────

interface RuntimeRecord {
  ownerId: string;
  namespaceId: string;
}

function makeFakeRuntimeFactory(closeGate?: { promise: Promise<void>; resolve: () => void }): {
  factory: (handle: DocHandle, notifyDirty: () => Promise<void>) => unknown;
  readonly constructed: RuntimeRecord[];
  readonly closed: RuntimeRecord[];
} {
  const constructed: RuntimeRecord[] = [];
  const closed: RuntimeRecord[] = [];
  const factory = (handle: DocHandle): unknown => {
    const record = { ownerId: handle.owner.userId, namespaceId: handle.docId };
    constructed.push(record);
    return {
      getStatus: () => ({
        lifecycle: 'ready',
        read: { enabled: true },
        rootWrite: { enabled: true },
        schemaWrite: { enabled: true },
        schema: { state: 'ready' },
        fatal: null,
        close: null,
      }),
      close: () => {
        closed.push({ ...record });
        return closeGate === undefined ? Promise.resolve() : closeGate.promise;
      },
    };
  };
  return { factory, constructed, closed };
}

function okLease(result: unknown): NamespaceLease {
  const r = result as { ok?: boolean; lease?: NamespaceLease };
  expect(r.ok, `期望成功（生成 ID），实际：${JSON.stringify(result)}`).toBe(true);
  if (!r.ok || r.lease === undefined) throw new Error('unreachable');
  return r.lease;
}

function okIssue(result: unknown): { code: string; field?: string | undefined } {
  const r = result as { ok?: boolean; code?: string; field?: string };
  expect(r.ok, `期望窄 issue，实际：${JSON.stringify(result)}`).toBe(false);
  if (r.ok || r.code === undefined) throw new Error('unreachable');
  return { code: r.code, field: r.field };
}

function makeRegistry(
  persistence: DocPersistence,
  opts: {
    randomBytes?: (length: number) => Uint8Array;
    factory?: (handle: DocHandle, notifyDirty: () => Promise<void>) => unknown;
    scheduler?: ReturnType<typeof createRegistryTestScheduler>;
    observer?: (event: unknown) => void;
  } = {},
): NamespaceRegistry {
  const overrides = {
    clock: makeManualClock(),
    scheduler: opts.scheduler ?? createRegistryTestScheduler(),
    idleTimeoutMs: 25,
    ...(opts.randomBytes !== undefined ? { randomBytes: opts.randomBytes } : {}),
    ...(opts.factory !== undefined ? { runtimeFactory: opts.factory } : {}),
    ...(opts.observer !== undefined ? { observer: opts.observer } : {}),
  } as NamespaceRegistryTestingOverrides;
  return createNamespaceRegistryForTesting(persistence, overrides);
}

const LEGACY_PHASES = ['runtime-construction', 'create-document-internal', 'lifecycle-slot-internal'] as const;

// ═══════════════════════════════ AC-1：生成与拒收 ═══════════════════════════════

describe('AC-1 普通 create 生成 ns-+32hex（注入 CSPRNG），拒收调用方 namespaceId', () => {
  it('三键输入（owner/schema/root）成功：lease 投影生成 ID 与 owner，Persistence 按生成 ID 落盘，随机源恰取 128-bit 一次', async () => {
    const persistence = new Phase5StubPersistence();
    const src = makeScriptedRandomBytes([X_HEX]); // src 先取引用：consumed 为 getter（R4）
    const { randomBytes } = src;
    const { factory, constructed } = makeFakeRuntimeFactory();
    const registry = makeRegistry(persistence, { randomBytes, factory });

    const result = await registry.create(newContractInput());
    const lease = okLease(result);

    expect(lease.namespaceId).toBe(X_ID);
    expect(lease.namespaceId).toMatch(/^ns-[0-9a-f]{32}$/);
    expect(lease.owner).toEqual({ userId: 'u-alice' });
    expect(src.consumed).toBe(1); // 幸福路径恰一次生成（§4.3.2 严格读法）
    expect(persistence.createCalls.map((c) => c.docId)).toEqual([X_ID]);
    expect(persistence.createCalls[0]?.owner).toEqual({ userId: 'u-alice' }); // AC-5 分区键
    expect(constructed.map((r) => r.namespaceId)).toEqual([X_ID]); // Runtime 以生成 ID 构造
  });

  it('调用方选定 namespaceId 的四键输入被拒绝（NAMESPACE_CREATE_INVALID_INPUT），零随机源消耗、零 Persistence', async () => {
    const persistence = new Phase5StubPersistence();
    const src = makeScriptedRandomBytes([X_HEX]); // src 先取引用（R4）
    const { randomBytes } = src;
    const { factory, constructed } = makeFakeRuntimeFactory();
    const registry = makeRegistry(persistence, { randomBytes, factory });

    const result = await registry.create(legacyShapeInput('ns-caller-selected'));
    const issue = okIssue(result);

    expect(issue.code).toBe('NAMESPACE_CREATE_INVALID_INPUT');
    expect(src.consumed).toBe(0);
    expect(persistence.createCalls).toEqual([]);
    expect(constructed).toEqual([]);
  });

  it('缺失受控随机源 → 构造期同步 TypeError（生产工厂与 testing seam 皆然，绝不 fallback 全局 crypto）', () => {
    const persistence = new Phase5StubPersistence();
    const clock = makeManualClock();
    const scheduler = createRegistryTestScheduler();

    // as never（registry-create.test.ts:1294 既有先例）：类型锚要求 randomBytes 为
    // 必需键，无 cast 字面量在 SA3 落地后会产生 TS2345（本文件在 typecheck 程序内）；
    // cast 仅为类型面消除——运行时仍按原样传入缺随机源的 options，构造必须同步 throw。
    expect(() => createNamespaceRegistry(persistence, { clock, scheduler } as never)).toThrow(TypeError);
    expect(() => createNamespaceRegistryForTesting(persistence, { clock, scheduler } as never)).toThrow(TypeError);
  });
});

// ═══════════════════════════════ AC-2：碰撞重试与耗尽 fatal ═══════════════════════

describe('AC-2 碰撞重生成（至多 8 次重试）与耗尽 committed:false Registry fatal', () => {
  it('与 active entry 碰撞 → 重生成新 ID 成功，Persistence 依次落两个 ID', async () => {
    const persistence = new Phase5StubPersistence();
    const src = makeScriptedRandomBytes([X_HEX, X_HEX, Y_HEX]); // src 先取引用（R4）
    const { randomBytes } = src;
    const registry = makeRegistry(persistence, { randomBytes });

    const lease1 = okLease(await registry.create(newContractInput()));
    const lease2 = okLease(await registry.create(newContractInput()));

    expect(lease1.namespaceId).toBe(X_ID);
    expect(lease2.namespaceId).toBe(Y_ID); // 首次生成 X 撞 active entry → 重生成 Y
    expect(lease2.namespaceId).not.toBe(lease1.namespaceId);
    expect(src.consumed).toBe(3); // 首建 X 一次 + 二次 create 首生成 X + 重生成 Y 一次（§4.3.2 严格读法）
    expect(persistence.createCalls.map((c) => c.docId)).toEqual([X_ID, Y_ID]);
  });

  it('与 idle entry 碰撞 → 重生成新 ID 成功（release 后 idle 保留态仍占用命名空间）', async () => {
    const persistence = new Phase5StubPersistence();
    const { randomBytes } = makeScriptedRandomBytes([X_HEX, X_HEX, Y_HEX]);
    const { factory, constructed } = makeFakeRuntimeFactory();
    const registry = makeRegistry(persistence, { randomBytes, factory });

    const lease1 = okLease(await registry.create(newContractInput()));
    expect(lease1.namespaceId).toBe(X_ID);
    await lease1.release(); // entry → idle（timer 已武装，25ms）

    const lease2 = okLease(await registry.create(newContractInput()));
    expect(lease2.namespaceId).toBe(Y_ID); // idle entry 亦为碰撞 → 重生成
    expect(persistence.createCalls.map((c) => c.docId)).toEqual([X_ID, Y_ID]);
    expect(constructed.map((r) => r.namespaceId)).toEqual([X_ID, Y_ID]);
  });

  it('与 closing entry 碰撞 → 重生成新 ID 成功（close 在途不阻塞也不放行同 ID）', async () => {
    const persistence = new Phase5StubPersistence();
    const gate: { promise: Promise<void>; resolve: () => void } = (() => {
      let resolve!: () => void;
      const promise = new Promise<void>((r) => {
        resolve = r;
      });
      return { promise, resolve };
    })();
    const { randomBytes } = makeScriptedRandomBytes([X_HEX, X_HEX, Y_HEX]);
    const { factory, constructed, closed } = makeFakeRuntimeFactory(gate);
    const scheduler = createRegistryTestScheduler();
    const registry = makeRegistry(persistence, { randomBytes, factory, scheduler });

    const lease1 = okLease(await registry.create(newContractInput()));
    expect(lease1.namespaceId).toBe(X_ID);
    await lease1.release(); // idle
    await scheduler.advanceBy(25); // idle timer 到期 → beginIdleClose → close 在途（gated）
    expect(closed.map((r) => r.namespaceId)).toEqual([X_ID]); // close 已发起、entry closing

    const lease2 = okLease(await registry.create(newContractInput()));
    expect(lease2.namespaceId).toBe(Y_ID); // closing entry 亦为碰撞 → 重生成，不等待 closePromise

    // close 结算后 entry 移除：后续 open 经 Persistence 重建新 generation
    gate.resolve();
    for (let i = 0; i < 24; i += 1) await Promise.resolve();
    const open = await registry.open({ userId: 'u-alice' }, X_ID);
    expect(okLease(open).namespaceId).toBe(X_ID);
    expect(constructed.map((r) => r.namespaceId)).toEqual([X_ID, Y_ID, X_ID]); // 重建 generation
  });

  it('与 target-owner Persistence duplicate 碰撞 → 重生成新 ID 成功（createDoc 抛 DOC_DUPLICATE 后换 ID）', async () => {
    const persistence = new Phase5StubPersistence();
    persistence.duplicateDocIds.add(X_ID); // 目标 owner 分区已有 X
    const { randomBytes } = makeScriptedRandomBytes([X_HEX, Y_HEX]);
    const registry = makeRegistry(persistence, { randomBytes });

    const lease = okLease(await registry.create(newContractInput()));
    expect(lease.namespaceId).toBe(Y_ID); // X 持久化重复 → 重生成
    expect(persistence.createCalls.map((c) => c.docId)).toEqual([X_ID, Y_ID]);
  });

  it('entry 碰撞重试至预算耗尽 → committed:false Registry fatal（新 phase、零重复落盘、无伪成功）', async () => {
    const persistence = new Phase5StubPersistence();
    // R4：严格读法 fixture——entry X 经 open（零随机消耗）建立，耗尽 create 独占
    // 剧本 [X×9]：恰 9 次生成（首生成 + 8 重试，§4.3.2）→ src.consumed 恰为 9。
    persistence.seedDocument({ userId: 'u-alice' }, X_ID); // (owner, X) 分区已有文档
    const src = makeScriptedRandomBytes([
      X_HEX, X_HEX, X_HEX, X_HEX, X_HEX, X_HEX, X_HEX, X_HEX, X_HEX,
    ]);
    const { randomBytes } = src;
    const { factory, constructed } = makeFakeRuntimeFactory();
    const registry = makeRegistry(persistence, { randomBytes, factory });

    const openLease = okLease(await registry.open({ userId: 'u-alice' }, X_ID)); // entry X active，零随机消耗
    expect(openLease.namespaceId).toBe(X_ID);

    const failure = await registry.create(newContractInput()).then(
      () => null,
      (e: unknown) => e,
    );
    expect(failure, '耗尽必须 reject，绝不 resolve 伪成功').toBeInstanceOf(NamespaceRegistryFatalError);
    const fatal = failure as NamespaceRegistryFatalError;
    expect(fatal.code).toBe('NAMESPACE_REGISTRY_FATAL');
    expect(fatal.operation).toBe('create');
    expect(fatal.committed).toBe(false);
    expect(LEGACY_PHASES).not.toContain(fatal.phase); // 新注册的耗尽 phase（命名属 SA1 职权）
    expect(src.consumed).toBe(9); // 严格读法：恰 9 次生成（首生成 + 8 次重试）
    // 纯 entry 碰撞：create 全程零 Persistence、零新 Runtime
    expect(persistence.createCalls).toEqual([]);
    expect(constructed.map((r) => r.namespaceId)).toEqual([X_ID]); // 仅 open 建立的 entry Runtime
  });

  it('Persistence duplicate 重试至预算耗尽 → 多次 createDoc 均 duplicate 后 committed:false fatal', async () => {
    const persistence = new Phase5StubPersistence();
    persistence.duplicateDocIds.add(X_ID);
    const { randomBytes } = makeScriptedRandomBytes([
      X_HEX, X_HEX, X_HEX, X_HEX, X_HEX, X_HEX, X_HEX, X_HEX, X_HEX, X_HEX,
    ]);
    const registry = makeRegistry(persistence, { randomBytes });

    const failure = await registry.create(newContractInput()).then(
      () => null,
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(NamespaceRegistryFatalError);
    const fatal = failure as NamespaceRegistryFatalError;
    expect(fatal.operation).toBe('create');
    expect(fatal.committed).toBe(false);
    expect(LEGACY_PHASES).not.toContain(fatal.phase);
    const dupAttempts = persistence.createCalls.filter((c) => c.docId === X_ID).length;
    expect(dupAttempts).toBeGreaterThanOrEqual(9); // 每次生成都尝试了目标分区（8 重试读法 ≥8+1 次）
    expect(dupAttempts).toBeLessThanOrEqual(10);
  });
});

// ═══════════════════════════════ AC-3/AC-4：entry 仅按 namespaceId、owner 校验 ════════════════════

describe('AC-3/AC-4 entry 仅按 namespaceId 索引；open 仍校验 owner，mismatch 一律 NOT_FOUND 零暴露', () => {
  it('同 namespaceId 第二 owner open → NAMESPACE_NOT_FOUND，且零 loadDoc、零新 Runtime（复用前核对 owner）', async () => {
    const persistence = new Phase5StubPersistence();
    const { randomBytes } = makeScriptedRandomBytes([X_HEX]);
    const { factory, constructed } = makeFakeRuntimeFactory();
    const registry = makeRegistry(persistence, { randomBytes, factory });

    const lease1 = okLease(await registry.create(newContractInput()));
    expect(lease1.namespaceId).toBe(X_ID);

    const openB = await registry.open({ userId: 'u-bob' }, X_ID);
    expect(okIssue(openB).code).toBe('NAMESPACE_NOT_FOUND');
    // entry 命中（key=namespaceId）后 owner 核对失败：绝不触碰 Persistence、绝不构造第二个 Runtime
    expect(persistence.loadCalls).toEqual([]);
    expect(constructed).toHaveLength(1);
  });

  it('owner mismatch 不暴露另一 owner 的持久化文档：即便 (ownerB, nsId) 分区已有文档，open 仍 NOT_FOUND', async () => {
    const persistence = new Phase5StubPersistence();
    persistence.seedDocument({ userId: 'u-bob' }, X_ID); // B 分区下同 namespaceId 的文档
    const { randomBytes } = makeScriptedRandomBytes([X_HEX]);
    const { factory, constructed } = makeFakeRuntimeFactory();
    const registry = makeRegistry(persistence, { randomBytes, factory });

    const lease1 = okLease(await registry.create(newContractInput()));
    expect(lease1.namespaceId).toBe(X_ID);

    const openB = await registry.open({ userId: 'u-bob' }, X_ID);
    expect(okIssue(openB).code).toBe('NAMESPACE_NOT_FOUND'); // 当前实现复合 key 下会成功暴露
    expect(constructed).toHaveLength(1); // B 绝不能得到第二个 Runtime
  });

  it('create 仍校验 owner：非法 owner.userId → NAMESPACE_INVALID_IDENTITY（field=owner.userId，零生成、零 Persistence）', async () => {
    const persistence = new Phase5StubPersistence();
    const src = makeScriptedRandomBytes([X_HEX]); // src 先取引用（R4）
    const { randomBytes } = src;
    const registry = makeRegistry(persistence, { randomBytes });

    const result = await registry.create(newContractInput({ owner: { userId: 'bad/user' } }));
    const issue = okIssue(result);
    expect(issue.code).toBe('NAMESPACE_INVALID_IDENTITY');
    expect(issue.field).toBe('owner.userId');
    expect(src.consumed).toBe(0);
    expect(persistence.createCalls).toEqual([]);
  });
});

// ═══════════════════════════════ AC-5：owner 分区 ═══════════════════════════════

describe('AC-5 Persistence 继续按 owner 分区；同分区恢复可见、跨分区不可见', () => {
  it('create 将生成 ID 写入 (owner, nsId) 分区；全新 Registry 可同分区 open 恢复，跨 owner 得 NOT_FOUND', async () => {
    const persistence = new Phase5StubPersistence();
    const { randomBytes } = makeScriptedRandomBytes([X_HEX]);
    const { factory } = makeFakeRuntimeFactory();
    const registryA = makeRegistry(persistence, { randomBytes, factory });

    const lease = okLease(await registryA.create(newContractInput()));
    expect(lease.namespaceId).toBe(X_ID);
    expect(persistence.createCalls).toHaveLength(1);
    expect(persistence.createCalls[0]?.owner).toEqual({ userId: 'u-alice' });
    expect(persistence.createCalls[0]?.docId).toBe(X_ID);

    // 全新实例（同 Persistence，零内存 entry）：同分区恢复。
    // 构造门禁契约（AC-1：缺 randomBytes → 构造期 TypeError）对任何实例均适用，
    // 故 registryB 亦注入受控随机源（仅 open、永不消耗——空剧本即验证零消耗）。
    const registryB = makeRegistry(persistence, { factory, randomBytes: makeScriptedRandomBytes([]).randomBytes });
    const openA = await registryB.open({ userId: 'u-alice' }, X_ID);
    expect(okLease(openA).namespaceId).toBe(X_ID);
    // 跨 owner（B 分区无此文档）→ 不可见
    const openB = await registryB.open({ userId: 'u-bob' }, X_ID);
    expect(okIssue(openB).code).toBe('NAMESPACE_NOT_FOUND');
    // 全链 createDoc 全部落在 A 分区
    expect(persistence.createCalls.every((c) => c.owner.userId === 'u-alice')).toBe(true);
  });
});

// ═══════════════════════════════ AC-6：并发与 shutdown ═══════════════════════════

describe('AC-6 并发 create 与 shutdown 全链行为', () => {
  it('两个并发普通 create：各自生成唯一 ID、并行落盘、双 lease 独立', async () => {
    const persistence = new Phase5StubPersistence();
    const { randomBytes } = makeScriptedRandomBytes([X_HEX, Y_HEX]);
    const { factory, constructed } = makeFakeRuntimeFactory();
    const registry = makeRegistry(persistence, { randomBytes, factory });

    const [r1, r2] = await Promise.all([registry.create(newContractInput()), registry.create(newContractInput())]);
    const lease1 = okLease(r1);
    const lease2 = okLease(r2);

    const ids = [lease1.namespaceId, lease2.namespaceId].sort();
    expect(ids).toEqual([X_ID, Y_ID].sort());
    expect(lease1).not.toBe(lease2); // 独立 lease
    expect(new Set(persistence.createCalls.map((c) => c.docId)).size).toBe(2);
    expect(constructed).toHaveLength(2);
  });

  it('shutdown 关闭全部已创建 Runtime 恰一次并到达 stopped', async () => {
    const persistence = new Phase5StubPersistence();
    const { randomBytes } = makeScriptedRandomBytes([X_HEX]);
    const { factory, closed } = makeFakeRuntimeFactory();
    const registry = makeRegistry(persistence, { randomBytes, factory });

    const lease = okLease(await registry.create(newContractInput()));
    expect(lease.namespaceId).toBe(X_ID);

    await expect(registry.shutdown()).resolves.toBeUndefined();
    expect(closed.map((r) => r.namespaceId)).toEqual([X_ID]); // 恰一次
    expect(registry.getStatus()).toEqual({ state: 'stopped' });
  });
});

// ═══════════════════════════ 设计 §12.3 回补锚 A/B/C（R3）═══════════════════════════
//
// 规范权威：ADR-0010（Registry identity 修订）；设计记录（历史证据，非规范）：
// wiki/raw/task_phase5-namespaceid-registry-identity_design.md §12.3
// （D-13 零红灯锚机制回补；SA2 攻击 #3「设计声称、测试不见证」）。
// 基线下三条全部为红：均以三键 create（或含重试的 create 链）驱动，
// 当前实现以 NAMESPACE_INVALID_IDENTITY / 无 fatal 拒绝 —— 与 AC 套件同款红灯机制。

describe('锚 A（§12.3，D-9）shutdown × 在途重试 interleaving：结算屏障', () => {
  it('create#2 重试在途时 shutdown：屏障等待重试终局后才结算；X/Y 各恰关闭一次；stopped；零 unhandled rejection', async () => {
    // 布置：剧本 [X, X, Y]；create#1 settle（entry X active）；create#2 首选候选 X 撞
    // entry → 重试候选 Y 的 createDoc 以 deferred gate 停在在途（确定性「重试在途」窗口）；
    // 此后 shutdown()；释放 gate。
    const persistence = new Phase5StubPersistence();
    const { randomBytes } = makeScriptedRandomBytes([X_HEX, X_HEX, Y_HEX]);
    const { factory, constructed, closed } = makeFakeRuntimeFactory();
    const registry = makeRegistry(persistence, { randomBytes, factory });
    const probe = collectUnhandledRejections();

    const lease1 = okLease(await registry.create(newContractInput()));
    expect(lease1.namespaceId).toBe(X_ID);

    const gate = persistence.gateCreate(Y_ID); // 重试 attempt（Y）的确定性在途窗口
    const p2 = registry.create(newContractInput()); // 不 await：重试在途（接纳段同步完成）
    const sp = registry.shutdown(); // 重试在途期间 shutdown（结算屏障：等待已接纳 create 终局）

    gate.resolve(); // 释放重试

    const order: string[] = [];
    void p2.then(() => {
      order.push('create2');
    });
    void sp.then(() => {
      order.push('shutdown');
    });

    // 屏障语义：create#2 不被 shutdown 击穿——重试终局成功（Y），shutdown 其后结算
    const lease2 = okLease(await p2);
    expect(lease2.namespaceId).toBe(Y_ID);
    await expect(sp).resolves.toBeUndefined();

    expect(order).toEqual(['create2', 'shutdown']); // shutdown settle 晚于 create#2 终局（§4.6 屏障）
    expect(constructed.map((r) => r.namespaceId)).toEqual([X_ID, Y_ID]);
    expect(closed.filter((r) => r.namespaceId === X_ID)).toHaveLength(1); // X 恰关闭一次
    expect(closed.filter((r) => r.namespaceId === Y_ID)).toHaveLength(1); // Y 恰关闭一次
    expect(registry.getStatus()).toEqual({ state: 'stopped' });
    expect(probe.events).toEqual([]); // 零 unhandled rejection（全部 promise 出生即 handled）
    probe.dispose();
  });
});

describe('锚 B（§12.3，D-3）随机源运行期形状违约 → 立即 fatal、零重试预算消耗', () => {
  /** 公共断言面（§12.3 锚 B 全断言）：源经 wrapped 计数后注入。 */
  async function expectGenerationFatal(
    randomBytes: (length: number) => Uint8Array,
    opts: { expectCalls?: (calls: number) => void; expectedCause?: unknown } = {},
  ): Promise<void> {
    let calls = 0;
    const wrapped = (length: number): Uint8Array => {
      calls += 1;
      return randomBytes(length);
    };
    const persistence = new Phase5StubPersistence();
    const events: unknown[] = [];
    const registry = makeRegistry(persistence, {
      randomBytes: wrapped,
      observer: (event: unknown) => {
        events.push(event);
      },
    });

    const failure = await registry.create(newContractInput()).then(
      () => null,
      (e: unknown) => e,
    );
    expect(failure, '随机源违约必须 reject fatal，绝不 resolve 伪成功').toBeInstanceOf(
      NamespaceRegistryFatalError,
    );
    const fatal = failure as NamespaceRegistryFatalError;
    expect(fatal.code).toBe('NAMESPACE_REGISTRY_FATAL');
    expect(fatal.operation).toBe('create');
    expect(fatal.phase).toBe('namespace-id-generation'); // §12.3 命名（∉ 旧三）
    expect(fatal.committed).toBe(false);
    if (opts.expectedCause !== undefined) {
      expect(fatal.cause).toBe(opts.expectedCause); // cause 为原异常（exact identity）
    }
    expect(persistence.createCalls).toEqual([]); // 零 Persistence
    const genEvents = events.filter(
      (e) => (e as { type?: string }).type === 'create-id-generation-failed',
    );
    expect(genEvents, 'observer 必须恰一次 create-id-generation-failed').toHaveLength(1);
    opts.expectCalls?.(calls);
  }

  it('B1 源直接 throw：fatal（operation=create/phase=namespace-id-generation/committed:false/cause 原异常）、零 Persistence、observer 恰一次', async () => {
    const thrown = new Error('entropy source unavailable');
    await expectGenerationFatal(
      () => {
        throw thrown;
      },
      { expectedCause: thrown },
    );
  });

  it('B2 源返回 15 字节 Uint8Array：同 B1 全断言 + 恰一次生成（零重试预算消耗）', async () => {
    const fifteen = new Uint8Array(15);
    await expectGenerationFatal(
      () => fifteen,
      { expectCalls: (calls) => expect(calls).toBe(1) },
    );
  });

  it('B3 源返回非 Uint8Array（普通对象）：同 B1 全部断言（并案）', async () => {
    await expectGenerationFatal(
      () => ({ not: 'bytes' }) as unknown as Uint8Array,
      { expectCalls: (calls) => expect(calls).toBe(1) },
    );
  });
});

describe('锚 C（§12.3，C-1 推论 1）同候选并发排他：carrier FIFO 结构性保证', () => {
  it('并发双 create 共享剧本 [X, X, Y]：两 lease 恰 {X, Y}；同候选 X 绝不出现第二个 Runtime；createDoc 恰两笔；零 fatal', async () => {
    // 布置：同一 registry、Promise.all 并发两 create，共享剧本 [X, X, Y]——
    // 两调用同步接纳段先后消耗 X、X（同候选）；create#1 先入 carrier X 并登记 entry，
    // create#2 的 X-attempt 经同 carrier FIFO 排队后命中碰撞 → 重生成 Y 成功。
    const persistence = new Phase5StubPersistence();
    const { randomBytes } = makeScriptedRandomBytes([X_HEX, X_HEX, Y_HEX]);
    const { factory, constructed } = makeFakeRuntimeFactory();
    const registry = makeRegistry(persistence, { randomBytes, factory });

    const [r1, r2] = await Promise.all([registry.create(newContractInput()), registry.create(newContractInput())]);
    const lease1 = okLease(r1);
    const lease2 = okLease(r2);

    expect([lease1.namespaceId, lease2.namespaceId].sort()).toEqual([X_ID, Y_ID].sort());
    expect(constructed.filter((r) => r.namespaceId === X_ID)).toHaveLength(1); // 绝无第二个 X Runtime
    expect(constructed.filter((r) => r.namespaceId === Y_ID)).toHaveLength(1);
    expect(persistence.createCalls.map((c) => c.docId)).toEqual([X_ID, Y_ID]); // 恰两笔、次序 FIFO
  });
});
