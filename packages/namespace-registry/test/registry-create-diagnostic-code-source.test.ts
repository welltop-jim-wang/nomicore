/**
 * #150 跨包码串单源守护 + diagnosticLog seam 防御边界测试（SA2 R2 遗留 #1 + SA4 R1
 * B1 回归；SA3 owned 补充套件——独立于 SA6 冻结的 registry-create-diagnostic-red.test.ts）。
 *
 * Part 1 码派生单源：create-diagnostic.ts 的 compile 类 issues 码派生是
 * p0.toIssueSummary（namespace-runtime/src/p0.ts:134-148）的**跨包语义复制**
 * （cross-package import 不可行：namespace-runtime/internal 值导出恰
 * createNamespaceRuntimeForRegistry 一键，且 namespace-runtime/** 在 #150 DENY
 * LIST）——无机器强制单源，本守护测试冻结当前对齐关系：若未来 p0.toIssueSummary
 * 码串演进，本文件将红灯（静默漂移防护）。反向锚：不存在任何 VFSL-ENV-E / VFSL-E
 * 前缀的发明码（R2-M1 废除 VFSL-ENV-E 后不得复活）。
 *
 * Part 2 seam 边界（SA4 R1 B1）：diagnosticLog 对象本体属性读取全部纳入真非抛边界——
 * null / 敌意 Proxy（getter throw）/ 畸形 emitter（缺失或非函数 emit）必须收敛为
 * 日志禁用（零 emit、零业务影响）；initStream 同步 throw 必须被吞没。目标：任何
 * 违约装配不得把 create ok / duplicate resolve 漂移为 rejection。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { DocHandle, DocPersistence, User } from '@nomicore/persistence';
import { createNamespaceRegistryForTesting, createRegistryTestScheduler } from '@nomicore/namespace-registry/testing';
import type { CreateNamespaceInput, NamespaceLease } from '@nomicore/namespace-registry';
import {
  createBoundedMemoryDiagnosticLog,
  type AttemptRecord,
  type BoundedMemoryDiagnosticLog,
  type NamespaceDiagnosticChangeEmitter,
} from '../../namespace-diagnostic-log/src/index.js';

const NOW_MS = 1_700_000_000_000;
const NOW_ISO = new Date(NOW_MS).toISOString();

const OWNER: Readonly<{ userId: string }> = Object.freeze({ userId: 'u-alice' });
const ROOT0 = Object.freeze({ n: 1, a: 'x' });
const GENERATED_NAMESPACE_ID = 'ns-00000000000000000000000000000001';

function deterministicRandomBytes(length: number): Uint8Array {
  if (length !== 16) throw new Error(`expected 16 random bytes, received ${length}`);
  const bytes = new Uint8Array(16);
  bytes[15] = 1;
  return bytes;
}
/** 合法 schema（B1 回归的成功路径需要；SA6 契约文件已有同款）。 */
const ENVELOPE = Object.freeze({
  lang: 'vfsl',
  version: 1,
  id: 'ns-1',
  text: 'type ROOT = { n: number; a: string; };\n',
});
/** SA2 R2-M1 守护锚 #1：未知方言信封 → vfsl 闭集码 ENV_4 → SCHEMA_ENVELOPE_4（与 p0 同串）。 */
const UNKNOWN_DIALECT = Object.freeze({
  lang: 'nope',
  version: 1,
  id: 'ns-env4',
  text: 'type ROOT = { n: number; };\n',
});
/** SA2 R2-M1 守护锚 #2：VFSL 文本语法错误 → SCHEMA_TEXT_INVALID（与 p0 同串）。 */
const BAD_SCHEMA = Object.freeze({ lang: 'vfsl', version: 1, id: 'ns-bad', text: 'type ROOT = { n: ;\n' });

interface NamespaceRegistryDiagnosticLog {
  readonly emitter: NamespaceDiagnosticChangeEmitter;
}

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

class StubPersistence implements DocPersistence {
  readonly committedDocs = new Map<string, Y.Doc>();
  async createDoc(owner: User, docId: string, doc: Y.Doc): Promise<DocHandle> {
    this.committedDocs.set(docId, doc);
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

function makeLog(): BoundedMemoryDiagnosticLog {
  return createBoundedMemoryDiagnosticLog({ inputPolicy: 'full', updateCapture: true });
}

function makeInput(schema: unknown): CreateNamespaceInput {
  return { owner: OWNER, schema, root: ROOT0 };
}

function makeRegistry(persistence: DocPersistence, log: BoundedMemoryDiagnosticLog) {
  return createNamespaceRegistryForTesting(persistence, {
    clock: { now: () => NOW_MS },
    scheduler: createRegistryTestScheduler(),
    randomBytes: deterministicRandomBytes,
    diagnosticLog: { emitter: log.emitter } as NamespaceRegistryDiagnosticLog,
  } as never);
}

async function waitAttempts(log: BoundedMemoryDiagnosticLog, expected: number): Promise<AttemptRecord[]> {
  await expect
    .poll(() => log.records().filter((r) => r.recordKind === 'attempt').length, { interval: 5, timeout: 3_000 })
    .toBe(expected);
  return log.records().filter((r): r is AttemptRecord => r.recordKind === 'attempt');
}

function okLease(result: unknown): NamespaceLease {
  const r = result as { ok?: boolean; lease?: NamespaceLease };
  expect(r.ok).toBe(true);
  const lease = r.lease;
  if (lease === undefined) throw new Error('unreachable');
  return lease;
}

describe('#150 code 派生单源守护（与 p0.toIssueSummary 同串；SA2 R2-M1）', () => {
  it('未知方言（lang:nope）→ issue 码 SCHEMA_ENVELOPE_4（非任何 VFSL-ENV-E/VFSL-E 前缀）', async () => {
    const log = makeLog();
    const persistence = new StubPersistence();
    const registry = makeRegistry(persistence, log);
    const result = await registry.create(makeInput(UNKNOWN_DIALECT));
    expect(result.ok).toBe(false);
    expect((result as { code?: string }).code).toBe('NAMESPACE_SCHEMA_INVALID');

    const rec = (await waitAttempts(log, 1))[0]!;
    expect(rec.stage).toBe('schema-compile');
    expect(rec.issues).toBeDefined();
    const items = rec.issues!.items;
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]!.code).toBe('SCHEMA_ENVELOPE_4'); // ≡ p0.toIssueSummary：SCHEMA_ENVELOPE_${code}
    expect(items[0]!.message.length).toBeGreaterThan(0);
    expect(items[0]!.path).toEqual([]);
    // 反向锚：R2-M1 已废除的发明前缀不得复活
    for (const item of items) {
      expect(item.code?.startsWith('VFSL-ENV-E')).toBe(false);
      expect(item.code?.startsWith('VFSL-E')).toBe(false);
    }
  });

  it('VFSL 文本语法错误（BAD_SCHEMA）→ issue 码 SCHEMA_TEXT_INVALID', async () => {
    const log = makeLog();
    const persistence = new StubPersistence();
    const registry = makeRegistry(persistence, log);
    const result = await registry.create(makeInput(BAD_SCHEMA));
    expect(result.ok).toBe(false);
    expect((result as { code?: string }).code).toBe('NAMESPACE_SCHEMA_INVALID');

    const rec = (await waitAttempts(log, 1))[0]!;
    expect(rec.stage).toBe('schema-compile');
    expect(rec.issues).toBeDefined();
    const items = rec.issues!.items;
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]!.code).toBe('SCHEMA_TEXT_INVALID'); // ≡ p0.toIssueSummary vfsl 分支
    expect(items[0]!.message.length).toBeGreaterThan(0);
    expect(items[0]!.path).toEqual([]);
  });
});

describe('#150 diagnosticLog seam 防御边界（SA4 R1 B1 回归）', () => {
  /** 违约装配的 CreateDiag 面：构造期 seam 读取被吞没 → 日志禁用（零 emit/零 initStream）；
   *  业务面（ok 创建 + duplicate resolve + 生命周期 running）逐项断言零漂移。 */
  async function assertSeamViolationIsolated(seam: unknown): Promise<void> {
    const persistence = new StubPersistence();
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: { now: () => NOW_MS },
      scheduler: createRegistryTestScheduler(),
      randomBytes: deterministicRandomBytes,
      diagnosticLog: seam as never,
    } as never);
    const first = await registry.create(makeInput(ENVELOPE));
    const lease = okLease(first);
    expect(lease.getMetadata().createdAt).toBe(NOW_ISO);
    expect(lease.namespaceId).toBe(GENERATED_NAMESPACE_ID);
    expect(registry.getStatus()).toEqual({ state: 'running' });
    await lease.release();
  }

  it('diagnosticLog 为 null（违约装配）→ create ok + duplicate resolve + running', async () => {
    await assertSeamViolationIsolated(null);
  });

  it('diagnosticLog 为敌意 Proxy（emitter getter throw）→ create ok + duplicate resolve + running', async () => {
    const hostile = new Proxy({} as Record<string, unknown>, {
      get: () => {
        throw new Error('hostile seam getter (injected)');
      },
    });
    await assertSeamViolationIsolated(hostile);
  });

  it('畸形 diagnosticLog（emitter 缺失 emit 函数）→ create ok + duplicate resolve + running', async () => {
    await assertSeamViolationIsolated({ emitter: {} });
  });

  it('initStream 违约（同步 throw）→ create ok + createdAt 精确 + status running（吞没隔离）', async () => {
    const persistence = new StubPersistence();
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: { now: () => NOW_MS },
      scheduler: createRegistryTestScheduler(),
      randomBytes: deterministicRandomBytes,
      diagnosticLog: {
        emitter: { emit: () => undefined },
        initStream: () => {
          throw new Error('hostile initStream (injected)');
        },
      } as never,
    } as never);
    const result = await registry.create(makeInput(ENVELOPE));
    const lease = okLease(result);
    expect(lease.getMetadata().createdAt).toBe(NOW_ISO);
    expect(registry.getStatus()).toEqual({ state: 'running' });
    await lease.release();
  });
});
