/**
 * issue #282 / ADR-0017 — ws-replication 端到端：hub replaceSchema 的 SCHEMA 与其生命
 * 周期元数据（META.schema.updatedAt）经 live UPDATE 收敛到 peer。
 *
 * 锚定契约：
 * - hub replaceSchema 同一事务提交 SCHEMA 四键 + META.schema.updatedAt（注入 Registry
 *   Clock 读数 = FIXED_MS 的 ISO 串——与 genesis createdAt 同值，区分依赖替换事件本身）；
 * - peer 侧 META 白名单 {'schema'} 放行该更新（否则 REPLICATION_PROTECTED_FIELDS_CHANGED
 *   拒绝、peer 永不收敛——本测试即该保护规则修订的端到端红绿锚）；
 * - peer 收敛值 = hub 起源时间戳（peer 不以本地接收时刻盖戳；peer 业务面
 *   getMetadata/getActiveSchema 投影同源）；
 * - peer 业务 lease 的 getMetadata() 将 META.schema 投影为 plain object。
 *
 * 红灯纪律沿 ac5：真实 yjs / Registry / Runtime；fake-duplex；零 real sleep。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { boot } from './driver.js';
import { FIXED_MS, PEER_OWNER, okLease, schemaReady, settle } from './harness.js';

const FIXED_ISO = new Date(FIXED_MS).toISOString();
const TEXT_V2 = 'type ROOT = { n: number; ext?: number; extra?: number; note?: string; };\n';

describe('issue #282：schema 生命周期元数据 hub→peer 收敛', () => {
  it('hub replaceSchema → peer 收敛 SCHEMA 新 generation + META.schema.updatedAt（hub 起源）', async () => {
    const run = await boot();
    const hubLease = run.hubFixture?.lease;
    if (hubLease === undefined) throw new Error('无 hub fixture lease');

    // genesis：hub/peer 双侧 META.schema.updatedAt === createdAt（同一捕获时钟瞬间）
    const peerLease0 = okLease(await run.peerNode.registry.open(PEER_OWNER, run.nsId));
    await schemaReady(peerLease0);
    expect(peerLease0.getMetadata().schema).toEqual({ updatedAt: FIXED_ISO });
    await peerLease0.release();

    // hub 替换 schema（新 generation；提供完整 ROOT）
    const replaced = await hubLease.replaceSchema({
      schema: { lang: 'vfsl', version: 1, id: run.nsId, text: TEXT_V2 },
      root: { n: 42, extra: 77 },
    });
    if (!replaced.ok) throw new Error(`hub replaceSchema 失败：${JSON.stringify(replaced)}`);
    // hub 本地：activeInfo.updatedAt 与 META.schema.updatedAt 同源推进
    const hubActive = hubLease.getActiveSchema();
    expect(hubActive?.updatedAt).toBe(FIXED_ISO); // 固定时钟：与 genesis 同值，但经替换事务重写
    expect(hubLease.getMetadata().schema).toEqual({ updatedAt: FIXED_ISO });
    await settle();

    // peer 收敛：SCHEMA 新文本 + META.schema.updatedAt（保护字段白名单放行——
    // 若白名单缺席，本断言永远失败：peer META 停留 genesis 且无 META.schema 键或拒绝）
    const peerDoc = run.snapshotDoc('peer');
    expect(peerDoc.getMap('SCHEMA').get('text')).toBe(TEXT_V2);
    const peerSchemaMeta = peerDoc.getMap('META').get('schema');
    expect(peerSchemaMeta).toBeInstanceOf(Y.Map);
    expect((peerSchemaMeta as Y.Map<unknown>).get('updatedAt')).toBe(FIXED_ISO);

    // peer 业务面：getMetadata 投影同源（plain object），hub/peer 双側逐值一致
    const peerLease = okLease(await run.peerNode.registry.open(PEER_OWNER, run.nsId));
    await schemaReady(peerLease);
    expect(peerLease.getMetadata().schema).toEqual({ updatedAt: FIXED_ISO });
    await peerLease.release();
  });
});
