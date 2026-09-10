/**
 * issue #282 / ADR-0017 — @nomicore/namespace-registry schema 生命周期元数据端到端锚：
 * 生产装配（Instance Clock 恒注入 Runtime SCHEMA 写槽）下的 genesis/替换/拒绝语义。
 *
 * 锚定契约：
 * - genesis：create 的 META.schema.updatedAt === META.createdAt（同一捕获时钟瞬间——
 *   Registry 槽内 Clock 单次读数产物复用，零额外读数）；
 * - 生产装配时钟权威：lease.replaceSchema 的 updatedAt 来自 Registry 注入 Clock
 *   （手动钟推进 → updatedAt 精确推进——证明非 Date.now 兜底路径）；
 * - 拒绝（compile 失败/角色权限）零写入、时间戳不变；
 * - getActiveSchema 第六键 updatedAt 经 lease 投影同源（NamespaceLeaseActiveSchema =
 *   ActiveSchemaInfo | null 类型同构的运行时证据）。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createMemoryPersistence } from '@nomicore/persistence';
import { createTestScheduler } from '@nomicore/persistence/testing';
import type { NamespaceLease } from '@nomicore/namespace-registry';
import { createNamespaceRegistryForTesting, createRegistryTestScheduler } from '@nomicore/namespace-registry/testing';

const T0_MS = 1_700_000_000_000;
const T0_ISO = new Date(T0_MS).toISOString();
const T1_MS = 1_700_000_222_333;
const T1_ISO = new Date(T1_MS).toISOString();

const SCHEMA_V1 = Object.freeze({
  lang: 'vfsl',
  version: 1,
  id: 'ns-lifecycle',
  text: 'type ROOT = { n: number; };\n',
});
const SCHEMA_V2 = Object.freeze({
  lang: 'vfsl',
  version: 1,
  id: 'ns-lifecycle-v2',
  text: 'type ROOT = { n: number; m?: string; };\n',
});

/** 确定性计数随机源（沿 registry-persistence-contract 先例）。 */
function makeDeterministicRandomBytes(): (length: number) => Uint8Array {
  let counter = 0;
  return (length: number): Uint8Array => {
    if (length !== 16) throw new Error(`受控随机源必须按 16 字节请求，实际 ${length}`);
    counter += 1;
    const hex = counter.toString(16).padStart(32, '0');
    const out = new Uint8Array(16);
    for (let i = 0; i < 16; i += 1) {
      out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  };
}

function okLease(result: unknown): NamespaceLease {
  const r = result as { ok: boolean; lease?: NamespaceLease };
  if (!r.ok || r.lease === undefined) throw new Error(`应成功取得 lease，实际 ${JSON.stringify(result)}`);
  return r.lease;
}

describe('issue #282：Registry 生产装配 × schema 生命周期元数据', () => {
  it('genesis：updatedAt === createdAt（同一捕获时钟瞬间）；replaceSchema 经注入 Clock 精确推进；拒绝零写入', async () => {
    const scheduler = createTestScheduler();
    const persistence = createMemoryPersistence({
      scheduler,
      schedule: { debounceMs: 1, maxDirtyMs: 1 },
    });
    let currentMs = T0_MS;
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: { now: () => currentMs },
      scheduler: createRegistryTestScheduler(),
      randomBytes: makeDeterministicRandomBytes(),
    });

    // ── genesis ──
    const lease = okLease(
      await registry.create({ owner: { userId: 'u-alice' }, schema: SCHEMA_V1, root: { n: 1 } }),
    );
    const active0 = lease.getActiveSchema();
    expect(active0).not.toBeNull();
    expect(active0!.updatedAt).toBe(T0_ISO); // genesis = createdAt（同一时钟瞬间）
    expect(lease.getMetadata().createdAt).toBe(T0_ISO);
    expect(lease.getMetadata().schema).toEqual({ updatedAt: T0_ISO }); // plain object 投影

    // ── 推进手动钟 → replaceSchema 精确推进（生产装配时钟权威——非 Date.now 兜底）──
    currentMs = T1_MS;
    const replaced = await lease.replaceSchema({ schema: SCHEMA_V2, root: { n: 1 } });
    expect(replaced).toEqual({ ok: true });
    const active1 = lease.getActiveSchema();
    expect(active1?.id).toBe('ns-lifecycle-v2');
    expect(active1?.updatedAt).toBe(T1_ISO);
    expect(lease.getMetadata().schema).toEqual({ updatedAt: T1_ISO });

    // ── 拒绝（compile 失败）零写入：时间戳与 active 身份不变 ──
    currentMs = T1_MS + 999;
    const rejected = await lease.replaceSchema({
      schema: { lang: 'vfsl', version: 1, id: 'ns-bad', text: 'type ROOT = {' },
    });
    expect(rejected.ok).toBe(false);
    expect(lease.getActiveSchema()?.updatedAt).toBe(T1_ISO);
    expect(lease.getActiveSchema()?.id).toBe('ns-lifecycle-v2');

    await lease.release();
    await registry.shutdown();
    await persistence.dispose();
  });

  it('文档载体形状：genesis META 恰三键 + 嵌套 schema Y.Map 恰一键 {updatedAt}', async () => {
    const scheduler = createTestScheduler();
    const persistence = createMemoryPersistence({
      scheduler,
      schedule: { debounceMs: 1, maxDirtyMs: 1 },
    });
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: { now: () => T0_MS },
      scheduler: createRegistryTestScheduler(),
      randomBytes: makeDeterministicRandomBytes(),
    });
    const lease = okLease(
      await registry.create({ owner: { userId: 'u-alice' }, schema: SCHEMA_V1, root: { n: 1 } }),
    );
    // 经真实持久层副本观测（peek 不在公共面——改经 getMetadata 深拷贝投影 + doc 载体
    // 由 doc-runtime/registry-create 既有测试锚定；此处锁公共投影形状）
    const metadata = lease.getMetadata();
    expect(Object.keys(metadata).sort()).toEqual(['createdAt', 'docId', 'schema']);
    expect(metadata.schema).toEqual({ updatedAt: T0_ISO });
    expect(metadata.schema instanceof Y.Map).toBe(false); // detached plain object
    await lease.release();
    await registry.shutdown();
    await persistence.dispose();
  });
});
