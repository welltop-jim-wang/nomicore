/**
 * SA6 红灯测试 — SCHEMA 载体缺席/异型分流（issue #93 round 2 / 评审项 6 / SA8 裁决 D）。
 *
 * 契约来源：
 * - wiki/raw/task_namespace-runtime-integration-acceptance-rev1_design.md §4（D-4）：
 *   「载体损坏 ≠ 缺席」——public 模式 loud throw（SchemaProjectionError / NSRT-SCHEMA-E2，
 *   镜像 META-E2 判据）；p0 模式 null → compile ENV-1 收编 → 数据级 unavailable（禁 fatal——
 *   保 SCHEMA write 修复路径）；缺席 → null 保留（生产合法态）。
 * - ADR-0008「读取能力」节：getSchemaEnvelope 是公共读取面的数据投影 getter。
 *
 * 断言纪律：全部锚定公共接缝可观测输出（同步 throw 形状 / status 摘要 / 结果联合），
 * 不读源码、不 grep 文本形状。
 *
 * fixture 前提（SA2 R1 #2 / 设计 §8 T4.1 场景列）：
 * - doc 预先**不含** SCHEMA 载体（persistence permissive 接受——仅校验 META.docId，
 *   共享套件「Permissive: correct docId, no SCHEMA, no ROOT」显式锁定）；
 * - createDoc 后经 `handle.doc.getText('SCHEMA')` 创建 Y.Text 异型条目；
 * - **勿复用仓内标准 makeDoc（预建 SCHEMA Y.Map 四键）**——已含同名 Y.Map 时
 *   `getText('SCHEMA')` 将 throw（yjs 同名异型机理，即 projection.ts 载体分支所依赖者）
 *   → fixture 自身错误（伪红）；落锚前置断言 `handle.doc.share.has('SCHEMA')===false`（注入前）。
 * - 异型创建先例：doc-runtime extract-yjs-snapshot.test.ts:518（`doc.getArray('SCHEMA').insert(…)`
 *   于全新无 SCHEMA doc 上执行）。
 *
 * 红灯现状（T4.1/T4.2 组合部分）：projection.ts:64-73 现状把「载体异型」与「载体缺席」
 * 同映射为 null——公共读取面把载体损坏静默映射为缺席 null（虚假降级）。断言
 * getSchemaEnvelope() throw NSRT-SCHEMA-E2 → 现行为返回 null → 红灯。T4.3（缺席对照）
 * 与 T4.4（异型 doc 上 replaceSchema 单 issue）为绿（保留/现行行为显式锚）。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createMemoryPersistence } from '@nomicore/persistence';
import type { DocHandle, User } from '@nomicore/persistence';
import { createNamespaceRuntimeWithSeam } from '../src/runtime.js';
import type { NamespaceRuntime } from '../src/index.js';

const OWNER: User = { userId: 'u-sa6' };
const TEXT_VALID = 'type ROOT = { n: number; a: string; };';
const ENV_NEW = { lang: 'vfsl', version: 1, id: 'ns-new', text: TEXT_VALID } as const;
const NEVER_NOTIFY = async (): Promise<void> => {};

/** 生产路径 permissive doc：META(docId/createdAt) + ROOT(n=1)；**不含** SCHEMA 载体。 */
async function makeNoSchemaDoc(docId: string): Promise<{
  persistence: ReturnType<typeof createMemoryPersistence>;
  handle: DocHandle;
  doc: Y.Doc;
}> {
  const persistence = createMemoryPersistence();
  const doc = new Y.Doc();
  doc.getMap('META').set('docId', docId);
  doc.getMap('META').set('createdAt', 1_700_000_000_000);
  doc.getMap('ROOT').set('n', 1);
  const handle = await persistence.createDoc(OWNER, docId, doc);
  return { persistence, handle, doc };
}

/** 注入异型 SCHEMA 载体（Y.Text 同名条目——getMap('SCHEMA') 将 throw）。
 *  fixture 前提断言先行：注入前 doc 不得含 'SCHEMA' 键（yjs 同名异型机理）。 */
function injectHeteroSchema(handle: DocHandle): void {
  expect(handle.doc.share.has('SCHEMA')).toBe(false); // 前置断言：预置不含 SCHEMA 载体（防伪红）
  handle.doc.getText('SCHEMA').insert(0, 'x');
  expect(handle.doc.share.has('SCHEMA')).toBe(true);
}

async function waitSettled(runtime: NamespaceRuntime): Promise<void> {
  await expect.poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 }).not.toBe('preparing');
}

describe('D-4：SCHEMA 载体异型 ≠ 缺席——public getSchemaEnvelope loud（NSRT-SCHEMA-E2），p0 数据级 unavailable', () => {
  it('T4.1：异型载体 doc（Y.Text 同名 SCHEMA）→ getSchemaEnvelope() 同步 throw SchemaProjectionError NSRT-SCHEMA-E2（非 null、非 Promise）', async () => {
    const { handle } = await makeNoSchemaDoc('ns-hetero');
    injectHeteroSchema(handle);
    const runtime = createNamespaceRuntimeWithSeam({ handle });

    // 同步 loud throw（getter 返回类型非结果联合——拒绝通道为 throw；非 Promise）
    let thrown: unknown = '(no throw)';
    try {
      runtime.getSchemaEnvelope();
    } catch (e) {
      thrown = e;
    }
    expect(thrown, '异型载体下 getSchemaEnvelope() 应同步 throw').not.toBe('(no throw)');
    expect(thrown).not.toBeInstanceOf(Promise);
    const err = thrown as { name?: unknown; code?: unknown; message?: unknown };
    expect((err as { name?: unknown }).name).toBe('SchemaProjectionError');
    expect(err.code).toBe('NSRT-SCHEMA-E2');
    expect(String(err.message)).toContain('SCHEMA 载体异型');
    expect(String(err.message)).toContain('NSRT-SCHEMA-E2');
  });

  it('T4.2：同 doc P0 结算 → status.schema.state===\'unavailable\' + issue.code===\'SCHEMA_ENVELOPE_1\' + fatal===null（数据级收编）+ 组合锚：getSchemaEnvelope() throw E2', async () => {
    const { handle } = await makeNoSchemaDoc('ns-hetero2');
    injectHeteroSchema(handle);
    const runtime = createNamespaceRuntimeWithSeam({ handle });
    await waitSettled(runtime);

    // 数据级收编（非 fatal）：p0 模式 projection null → compile(null) ENV-1 结构化收编
    const status = runtime.getStatus();
    expect(status.schema.state).toBe('unavailable');
    expect(status.schema.issue?.code).toBe('SCHEMA_ENVELOPE_1');
    expect(status.fatal).toBeNull();
    expect(status.read.enabled).toBe(true);

    // 组合锚（SA8 D 明示义务）：P0 数据级 unavailable 的同时，public getter 稳定 loud E2
    let thrown: unknown = '(no throw)';
    try {
      runtime.getSchemaEnvelope();
    } catch (e) {
      thrown = e;
    }
    expect(thrown).not.toBe('(no throw)');
    expect((thrown as { code?: unknown }).code).toBe('NSRT-SCHEMA-E2');
  });

  it('T4.3（保留+显式化）：载体缺席对照——无 SCHEMA doc → getSchemaEnvelope()===null + P0 unavailable（ENV-1）——缺席宽容零回归', async () => {
    const { handle } = await makeNoSchemaDoc('ns-absent');
    expect(handle.doc.share.has('SCHEMA')).toBe(false); // 缺席 fixture 前提
    const runtime = createNamespaceRuntimeWithSeam({ handle });

    expect(runtime.getSchemaEnvelope()).toBeNull(); // 合法缺席 → null（不 throw）
    await waitSettled(runtime);
    const status = runtime.getStatus();
    expect(status.schema.state).toBe('unavailable');
    expect(status.schema.issue?.code).toBe('SCHEMA_ENVELOPE_1');
    expect(status.fatal).toBeNull();
  });

  it('T4.4（现行行为显式锚）：异型 doc 上 replaceSchema → ok:false 单 issue（SCHEMA 载体不是 Y.Map）——修复尝试可发生且诚实（写路径不被 fatal 关闭）', async () => {
    const { handle } = await makeNoSchemaDoc('ns-hetero3');
    injectHeteroSchema(handle);
    const runtime = createNamespaceRuntimeWithSeam({ handle, notifyDirty: NEVER_NOTIFY });
    await waitSettled(runtime);

    const settled = await new Promise<{ kind: 'resolved'; value: unknown } | { kind: 'rejected'; reason: unknown }>((resolve) => {
      runtime.replaceSchema({ schema: { ...ENV_NEW } }).then(
        (value) => resolve({ kind: 'resolved', value }),
        (reason) => resolve({ kind: 'rejected', reason }),
      );
    });
    expect(settled.kind).toBe('resolved'); // 领域失败（非 fatal rejection）
    if (settled.kind !== 'resolved') return;
    const value = settled.value as { ok?: unknown; issues?: unknown };
    expect(value).toMatchObject({ ok: false });
    const issues = (value.issues as Array<{ message: string; path: unknown[] }> | undefined) ?? [];
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('SCHEMA 载体不是 Y.Map');
    // 诚实领域失败：零 fatal 污染、读取照常、写位保留（修复路径开放语义）
    const status = runtime.getStatus();
    expect(status.fatal).toBeNull();
    expect(status.schemaWrite.enabled).toBe(true);
    expect(runtime.read(['n']).ok).toBe(true);
  });
});
