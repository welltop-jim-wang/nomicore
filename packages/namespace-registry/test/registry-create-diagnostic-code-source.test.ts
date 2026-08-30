/**
 * #150 跨包码串单源守护测试（SA2 R2 遗留 #1 落地；新增独立文件——不改 SA6 冻结的
 * registry-create-diagnostic-red.test.ts）。
 *
 * 背景：create-diagnostic.ts 的 compile 类 issues 码派生是 p0.toIssueSummary
 * （namespace-runtime/src/p0.ts:134-148）的**跨包语义复制**（cross-package import
 * 不可行：namespace-runtime/internal 值导出恰 createNamespaceRuntimeForRegistry 一键，
 * 且 namespace-runtime/** 在 #150 DENY LIST）——无机器强制单源，本守护测试冻结
 * 当前对齐关系：若未来 p0.toIssueSummary 码串演进，本文件将红灯（静默漂移防护）。
 *
 * 反向锚：不存在任何 VFSL-ENV-E / VFSL-E 前缀的发明码（R2-M1 废除 VFSL-ENV-E 后
 * 不得复活）。
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

const OWNER: Readonly<{ userId: string }> = Object.freeze({ userId: 'u-alice' });
const ROOT0 = Object.freeze({ n: 1, a: 'x' });
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

function makeInput(namespaceId: string, schema: unknown): CreateNamespaceInput {
  return { owner: OWNER, namespaceId, schema, root: ROOT0 };
}

function makeRegistry(persistence: DocPersistence, log: BoundedMemoryDiagnosticLog) {
  return createNamespaceRegistryForTesting(persistence, {
    clock: { now: () => NOW_MS },
    scheduler: createRegistryTestScheduler(),
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
    const result = await registry.create(makeInput('k-ns-env4', UNKNOWN_DIALECT));
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
    const result = await registry.create(makeInput('k-ns-text', BAD_SCHEMA));
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
