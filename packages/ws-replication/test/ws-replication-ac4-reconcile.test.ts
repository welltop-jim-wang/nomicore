/**
 * SA6 红灯验收 —— issue #136 AC4：Peer 发起的 sync round；双向 Step2 apply +
 * SYNC_APPLIED 双方确认后才进入 live。
 *
 * 契约：docs/protocols/instance-replication-v1.md §9（Step1/Step2/Applied 时序与
 * 状态机、每方向每 round 仅一个 Step1、错误 round/错序/重复 → SYNC_STATE_VIOLATION、
 * 空 diff 完整走 Step2/Applied）、§13.2（终态）、§18（reconcile timeout）。
 *
 * 红灯纪律：真实 yjs / Registry / Runtime；fake-duplex；零 real sleep。
 */
import { describe, expect, it } from 'vitest';
import type {
  OpenNamespaceMsg,
  OpenOkMsg,
  SyncStep1Msg,
  SyncStep2Msg,
  SyncAppliedMsg,
} from '@nomicore/replication-protocol';
import { decodeMessage } from '@nomicore/replication-protocol';
import { boot, advanceMs } from './driver.js';
import { deferred, settle } from './harness.js';

function asMsg<T extends { kind: string }>(frame: { message: { kind: string } } | undefined, kind: T["kind"]): T | undefined {
  if (frame === undefined) return undefined;
  return frame.message.kind === kind ? (frame.message as T) : undefined;
}

function errorCodes(decoded: Array<{ message: { kind: string } }>): string[] {
  return decoded
    .filter((f) => f.message.kind === 'ERROR')
    .map((f) => (f.message as unknown as { code: string }).code);
}

function kindOf(bytes: Uint8Array): string {
  return decodeMessage(bytes).message.kind;
}

describe('AC4：双向 reconciliation 与 SYNC_APPLIED 门禁', () => {
  it('reconcile 幸福路径：OPEN(reconcile)→OPEN_OK(1)→双方 Step1/Step2/Applied→两侧数据互换→live', async () => {
    const run = await boot({
      peerReplica: { rootN: 5, ext: 7 }, // 同 hub 身份；本地 root {n:5, ext:7}
    });

    // —— OPEN 声明 ——
    const open = asMsg<OpenNamespaceMsg>(run.peerFrames('OPEN_NAMESPACE')[0], 'OPEN_NAMESPACE');
    expect(open?.hasLocalReplica).toBe(true);
    expect(open?.replicationId).toBe(run.hubFixture?.identity.replicationId);
    expect(open?.replicationEpoch).toBe(run.hubFixture?.identity.replicationEpoch);

    // —— OPEN_OK mode 1 ——
    const openOk = asMsg<OpenOkMsg>(run.hubFrames('OPEN_OK')[0], 'OPEN_OK');
    expect(openOk?.mode).toBe(1);
    expect(openOk?.replicationId).toBe(run.hubFixture?.identity.replicationId);

    // —— 帧序：Step1(peer) → Step1(hub) → Step2 双向 → Applied 双向 ——
    const p2h = run.frames().peerToHub;
    const h2p = run.frames().hubToPeer;
    const kindsP = p2h.map((f) => f.message.kind);
    const kindsH = h2p.map((f) => f.message.kind);
    expect(kindsP.indexOf('SYNC_STEP1')).toBeLessThan(kindsP.indexOf('SYNC_STEP2'));
    expect(kindsH.indexOf('SYNC_STEP1')).toBeLessThan(kindsH.indexOf('SYNC_STEP2'));
    expect(kindsP.indexOf('SYNC_STEP1')).toBeLessThan(kindsH.indexOf('SYNC_STEP1'));

    const peerStep1 = asMsg<SyncStep1Msg>(run.peerFrames('SYNC_STEP1')[0], 'SYNC_STEP1');
    const hubStep1 = asMsg<SyncStep1Msg>(run.hubFrames('SYNC_STEP1')[0], 'SYNC_STEP1');
    expect(peerStep1?.syncRoundId).toBe(1);
    expect(hubStep1?.syncRoundId).toBe(1); // 同一 round
    expect(peerStep1?.stateVector.length).toBeGreaterThan(0);
    expect(hubStep1?.stateVector.length).toBeGreaterThan(0);

    // Step2.relatedStep1Sequence = 被响应 Step1 的 sequence
    const peerStep2 = asMsg<SyncStep2Msg>(run.peerFrames('SYNC_STEP2')[0], 'SYNC_STEP2');
    const hubStep2 = asMsg<SyncStep2Msg>(run.hubFrames('SYNC_STEP2')[0], 'SYNC_STEP2');
    const peerStep1Frame = run.peerFrames('SYNC_STEP1')[0] as { header: { sequence: number } };
    const hubStep1Frame = run.hubFrames('SYNC_STEP1')[0] as { header: { sequence: number } };
    expect(peerStep2?.relatedStep1Sequence).toBe(hubStep1Frame.header.sequence);
    expect(hubStep2?.relatedStep1Sequence).toBe(peerStep1Frame.header.sequence);
    expect(peerStep2?.syncRoundId).toBe(1);
    expect(hubStep2?.syncRoundId).toBe(1);

    // Applied：ackedSequence = 对端 Step2 的 sequence
    const peerApplied = asMsg<SyncAppliedMsg>(run.peerFrames('SYNC_APPLIED')[0], 'SYNC_APPLIED');
    const hubApplied = asMsg<SyncAppliedMsg>(run.hubFrames('SYNC_APPLIED')[0], 'SYNC_APPLIED');
    expect(peerApplied?.ackedSequence).toBe(run.hubFrames('SYNC_STEP2')[0]?.header.sequence);
    expect(hubApplied?.ackedSequence).toBe(run.peerFrames('SYNC_STEP2')[0]?.header.sequence);
    expect(peerApplied?.syncRoundId).toBe(1);
    expect(hubApplied?.syncRoundId).toBe(1);

    // —— 数据互换（确定性非冲突键）——
    expect(run.rootValue('peer', 'extra')).toBe(77); // hub 独有 → peer 收敛
    expect(run.rootValue('hub', 'ext')).toBe(7); // peer 独有 → hub 收敛

    // —— 双确认后 live ——
    expect(run.namespaceState()).toBe('live');
  });

  it('AC4/§9.3 缺少对端 SYNC_APPLIED：只差一个确认仍不进入 live；reconcile timeout 收口 failed', async () => {
    const run = await boot({
      start: false,
      peerReplica: { rootN: 5, ext: 7 },
      timeouts: { reconcileTimeoutMs: 200 },
    });
    // 在第一个 hub→peer SYNC_APPLIED 处丢帧（= 对端确认不可达）
    run.peer.start();
    await run.waitConnection('ready');
    run.wire.dropNextHubToPeer((bytes) => kindOf(bytes) === 'SYNC_APPLIED');
    await run.waitNamespace('reconciling');
    await run.waitPeerSent('SYNC_APPLIED', 1);
    await settle();
    // 已 apply 对端 Step2 并发出自己的 Applied —— 但没收到对端 Applied → 不得 live
    expect(run.namespaceState()).toBe('reconciling');
    // timeout → 收口
    await advanceMs(run, 200);
    await run.waitNamespace('failed');
  });

  it('AC4/§9.2 错序：round 开始前的 SYNC_STEP2 → SYNC_STATE_VIOLATION（round 永不开始）', async () => {
    const run = await boot({ start: false });
    run.peerNode.persistence.importHold = deferred();
    run.peer.start();
    await run.waitConnection('ready');
    // 冻结在 bootstrap 导入期；注入 STEP2（无对应 Step1）
    run.injectPeer({
      kind: 'SYNC_STEP2',
      namespaceId: run.nsId,
      syncRoundId: 1,
      relatedStep1Sequence: 1,
      update: new Uint8Array(0),
    });
    await settle();
    expect(errorCodes(run.hubFrames('ERROR'))).toContain('SYNC_STATE_VIOLATION');
    expect(run.hubFrames('SYNC_STEP1')).toHaveLength(0);
    // 释放导入 → 后续 round 因 namespace 已终止无法完成
    const hold = run.peerNode.persistence.importHold;
    run.peerNode.persistence.importHold = undefined;
    if (hold !== undefined) hold.resolve();
    await run.waitNamespace('failed');
  });

  it('AC4/§9.1 重复 Step1（同 round）：每方向每 round 只允许一个 Step1 → SYNC_STATE_VIOLATION', async () => {
    const run = await boot({
      start: false,
      peerReplica: { rootN: 5, ext: 7 },
    });
    run.peer.start();
    await run.waitConnection('ready');
    // 冻结：hub→peer 的第一个 SYNC_APPLIED 被丢 → 真实 peer 停在 reconciling（静默）
    run.wire.dropNextHubToPeer((bytes) => kindOf(bytes) === 'SYNC_APPLIED');
    await run.waitNamespace('reconciling');
    await run.waitPeerSent('SYNC_APPLIED', 1);
    await settle();
    // 注入重复 Step1（同 roundId）——此时真实 peer 已无后续帧，序列无碰撞
    run.injectPeer({
      kind: 'SYNC_STEP1',
      namespaceId: run.nsId,
      syncRoundId: 1,
      stateVector: new Uint8Array([0]),
    });
    await settle();
    // §18.11 #2（R2 对齐：CP-1 序列纪律 ADR 字面）：hub 判定不变（ERROR 帧仍在 wire 上）
    expect(errorCodes(run.hubFrames('ERROR'))).toContain('SYNC_STATE_VIOLATION');
    // 但 hub 后续 ERROR 帧携带 gap（SYNC_APPLIED 已被注入丢帧）→ peer 先判
    // SEQUENCE_VIOLATION connection fatal → ns 投影 disconnected、连接 blocked
    await run.waitNamespace('disconnected');
    expect(run.connectionState()).toBe('blocked');
  });

  it('AC4/§9.3 空 diff：无新状态也完整走 Step2/Applied 并进入 live', async () => {
    // 完全同源：hub root {n:42}（无 extra），peer 副本 = hub 完整快照
    const run = await boot({
      hubRoot: { n: 42 },
      peerReplica: { rootN: 42 },
    });
    const peerStep2 = asMsg<SyncStep2Msg>(run.peerFrames('SYNC_STEP2')[0], 'SYNC_STEP2');
    const hubStep2 = asMsg<SyncStep2Msg>(run.hubFrames('SYNC_STEP2')[0], 'SYNC_STEP2');
    // 空 diff = 无新状态（y-protocols 空 diff 只是封装字节）
    expect(peerStep2?.update.length ?? 0).toBeLessThanOrEqual(4);
    expect(hubStep2?.update.length ?? 0).toBeLessThanOrEqual(4);
    // 完整 Step2/Applied 交换
    expect(run.peerFrames('SYNC_STEP2')).toHaveLength(1);
    expect(run.hubFrames('SYNC_STEP2')).toHaveLength(1);
    expect(run.peerFrames('SYNC_APPLIED')).toHaveLength(1);
    expect(run.hubFrames('SYNC_APPLIED')).toHaveLength(1);
    // 两侧状态原样（无新增数据）
    expect(run.rootValue('peer', 'n')).toBe(42);
    expect(run.rootValue('hub', 'n')).toBe(42);
    expect(run.rootValue('peer', 'extra')).toBeUndefined();
    expect(run.rootValue('hub', 'ext')).toBeUndefined();
    expect(run.namespaceState()).toBe('live');
  });
});
