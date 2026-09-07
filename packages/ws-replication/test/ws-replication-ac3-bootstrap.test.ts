/**
 * SA6 红灯验收 —— issue #136 AC3：Bootstrap 传输一份有界完整快照、排他导入、
 * ACK 安装完成、随后强制双向 reconciliation。
 *
 * 契约：docs/protocols/instance-replication-v1.md §8（单 frame 完整 snapshot 不分块、
 * 排他导入、BOOTSTRAP_ACK 语义、BOOTSTRAP_TOO_LARGE/BOOTSTRAP_FAILED）、§13.2
 * （终态）、§18（bootstrap timeout 只收口 namespace）；ADR 0010 bootstrap 决策。
 *
 * 红灯纪律：真实 yjs / Registry / Runtime；fake-duplex；零 real sleep。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { decodeMessage, type DecodedMessage } from '@nomicore/replication-protocol';
import type { BootstrapSnapshotMsg, BootstrapAckMsg, SyncStep1Msg, OpenOkMsg } from '@nomicore/replication-protocol';
import type { ReplicationObserverEvent } from '@nomicore/ws-replication';
import { boot, advanceMs, collectUnhandledRejections } from './driver.js';
import type { Run } from './driver.js';
import { deferred, makeSeedDoc } from './harness.js';

function asMsg<T extends { kind: string }>(frame: DecodedMessage | undefined, kind: T['kind']): T | undefined {
  if (frame === undefined) return undefined;
  return frame.message.kind === kind ? (frame.message as unknown as T) : undefined;
}

function errorCodes(decoded: DecodedMessage[]): string[] {
  return decoded.filter((f) => f.message.kind === 'ERROR').map((f) => (f.message as { code: string }).code);
}

type ChanEvent = Extract<ReplicationObserverEvent, { type: 'channel-state-changed' }>;

/** 事件流内该侧的 channel-state-changed 子集（有序）。 */
function chanEdges(events: readonly ReplicationObserverEvent[], side: 'peer' | 'hub'): ChanEvent[] {
  return events.filter(
    (e): e is ChanEvent => e.type === 'channel-state-changed' && e.side === side,
  );
}

function kinds(bytes: readonly Uint8Array[]): string[] {
  return bytes.map((b) => decodeMessage(b).message.kind);
}

describe('AC3：Bootstrap 单帧快照 / 排他导入 / ACK / 强制 reconciliation', () => {
  it('完整链路：OPEN_OK(0) → 恰一帧 BOOTSTRAP_SNAPSHOT（完整 update）→ BOOTSTRAP_ACK → 立即发起 round 1', async () => {
    const run = await boot();
    const frames = run.frames();

    // —— OPEN_OK mode 0 ——
    const openOk = asMsg<OpenOkMsg>(run.hubFrames('OPEN_OK')[0], 'OPEN_OK');
    expect(openOk?.mode).toBe(0);

    // —— 单 frame 完整快照、不分块 ——
    const snapshots = run.hubFrames('BOOTSTRAP_SNAPSHOT');
    expect(snapshots).toHaveLength(1);
    const snapshot = asMsg<BootstrapSnapshotMsg>(snapshots[0], 'BOOTSTRAP_SNAPSHOT');
    expect(snapshot?.namespaceId).toBe(run.nsId);
    expect(snapshot?.replicationId).toBe(run.hubFixture?.identity.replicationId);
    expect(snapshot?.replicationEpoch).toBe(run.hubFixture?.identity.replicationEpoch);

    // snapshot 应用后 = Hub 完整状态（含 META 身份 / SCHEMA / ROOT 值）
    const applied = new Y.Doc();
    Y.applyUpdate(applied, snapshot?.snapshot as Uint8Array);
    expect((applied.getMap('ROOT') as unknown as Map<string, unknown>).get('n')).toBe(42);
    expect((applied.getMap('ROOT') as unknown as Map<string, unknown>).get('extra')).toBe(77);
    expect((applied.getMap('META') as unknown as Map<string, unknown>).get('replicationId')).toBe(
      run.hubFixture?.identity.replicationId,
    );
    expect((applied.getMap('META') as unknown as Map<string, unknown>).get('replicationEpoch')).toBe(1);

    // —— BOOTSTRAP_ACK：ack 对应快照 sequence，且先于一切 sync 帧 ——
    const acks = run.peerFrames('BOOTSTRAP_ACK');
    expect(acks).toHaveLength(1);
    const ack = asMsg<BootstrapAckMsg>(acks[0], 'BOOTSTRAP_ACK');
    expect(ack?.ackedSequence).toBe(snapshots[0]?.header.sequence);

    // —— ACK 后强制 reconciliation：下一条 peer 帧必是 SYNC_STEP1(roundId=1) ——
    const order = frames.peerToHub.map((f) => f.message.kind);
    const ackIndex = order.indexOf('BOOTSTRAP_ACK');
    expect(order.indexOf('SYNC_STEP1')).toBeGreaterThan(ackIndex);
    expect(order.slice(ackIndex + 1, ackIndex + 2)).toEqual(['SYNC_STEP1']);
    const step1 = asMsg<SyncStep1Msg>(run.peerFrames('SYNC_STEP1')[0], 'SYNC_STEP1');
    expect(step1?.syncRoundId).toBe(1);

    // —— 排他导入已落地：peer 持久化持有 Hub 身份副本 ——
    expect(run.rootValue('peer', 'n')).toBe(42);
    expect(run.metaValue('peer', 'replicationId')).toBe(run.hubFixture?.identity.replicationId);
    expect(run.metaValue('peer', 'replicationEpoch')).toBe(1);

    // —— 最终 live ——
    expect(run.namespaceState()).toBe('live');
  });

  it('AC3/§8.1 超限：snapshot 超过 maxBootstrapBytes → BOOTSTRAP_TOO_LARGE（不分块、不 fallback）', async () => {
    const run = await boot({
      limits: { maxBootstrapBytes: 64 },
      waitFor: 'failed',
    });
    expect(run.hubFrames('BOOTSTRAP_SNAPSHOT')).toHaveLength(0);
    expect(errorCodes(run.hubFrames('ERROR'))).toContain('BOOTSTRAP_TOO_LARGE');
    expect(run.namespaceState()).toBe('failed');
    expect(run.rootValue('hub', 'n')).toBe(42);
  });

  it('AC3/§8.1 并发 duplicate：导入竞态被占位 → BOOTSTRAP_FAILED，绝不覆盖既有副本', async () => {
    const run = await boot({ start: false });
    // 在导入路径上装门闩
    run.peerNode.persistence.importHold = deferred();
    run.peer.start();
    await run.waitNamespace('bootstrapping');
    // 竞态占位：同 (owner, nsId) 出现既有 doc（带完整合规身份）
    const fixtureIdentity = run.hubFixture?.identity;
    if (fixtureIdentity === undefined) throw new Error('hub fixture 缺失');
    run.peerNode.persistence.seedDocument(
      { userId: run.target.localOwner.userId },
      run.nsId,
      makeSeedDoc(run.nsId, {
        replicationId: fixtureIdentity.replicationId,
        replicationEpoch: fixtureIdentity.replicationEpoch,
        rootN: 99,
      }),
    );
    // 释放导入 → duplicate → BOOTSTRAP_FAILED
    const hold = run.peerNode.persistence.importHold;
    run.peerNode.persistence.importHold = undefined;
    if (hold !== undefined) hold.resolve();
    await run.waitNamespace('failed');
    expect(errorCodes(run.peerFrames('ERROR'))).toContain('BOOTSTRAP_FAILED');
    // 既有副本不被覆盖（n 保持 99）、hub 数据不动
    expect(run.rootValue('peer', 'n')).toBe(99);
    expect(run.rootValue('hub', 'n')).toBe(42);
    // 快照只发一次（无第二次尝试）
    expect(run.hubFrames('BOOTSTRAP_SNAPSHOT')).toHaveLength(1);
  });

  it('AC3/§18 bootstrap timeout：快照丢失 → 收口 failed（瞬态）→ 本端重建连接 → 新 wire 合法重发快照 → 收敛 live（issue #254 方向 A）', async () => {
    const uh = collectUnhandledRejections();
    const peerEvents: ReplicationObserverEvent[] = [];
    const run = await boot({
      start: false,
      timeouts: { bootstrapTimeoutMs: 150 },
      backoff: { baseMs: 50, maxMs: 5_000, resetAfterMs: 10_000 },
      random: () => 0,
      peerObserver: (e) => peerEvents.push(e),
    });
    try {
      run.peer.start();
      // 丢帧：BOOTSTRAP_SNAPSHOT 到达 peer 前被丢弃（wire1）
      run.wire.dropNextHubToPeer(
        (bytes) => decodeMessage(bytes).message.kind === 'BOOTSTRAP_SNAPSHOT',
      );
      await run.waitNamespace('bootstrapping');
      expect(run.hubFrames('BOOTSTRAP_SNAPSHOT')).toHaveLength(0);
      expect(run.droppedFrames().hubToPeer).toHaveLength(1);
      // 越过 bootstrapTimeoutMs → 收口 failed。issue #254：failed 瞬态（事件轨迹钉住），
      // 随后本端触发连接重建（random=0 → 同一步内已开始重拨）；同一 wire 不重发快照
      // （wire1 恰一次尝试 = 被丢的那次）。
      await advanceMs(run, 150);
      // wire1 零快照成功投递（快照被丢且同 wire 不重发——§18 收口零 wire 帧）
      expect(kinds(run.wires[0]!.hubToPeer).filter((k) => k === 'BOOTSTRAP_SNAPSHOT')).toHaveLength(0);
      expect(kinds(run.wires[0]!.peerToHub)).not.toContain('BOOTSTRAP_ACK');
      const peerChans = chanEdges(peerEvents, 'peer');
      expect(
        peerChans.some((e) => e.from === 'bootstrapping' && e.to === 'failed'),
        'bootstrap timeout 必须收口 failed（§13.2 NAMESPACE_TIMEOUT 映射不变）',
      ).toBe(true);
      // 恢复：重建 → 新 wire 上 hub 合法重发快照 → 导入 → 收敛 live。
      await run.waitConnection('ready');
      await run.waitNamespace('live');
      expect(run.wires.length, '自愈必须经连接重建').toBeGreaterThanOrEqual(2);
      expect(run.dialCount, '自愈必须经重拨').toBeGreaterThanOrEqual(2);
      const lastWire = run.wires[run.wires.length - 1]!;
      expect(kinds(lastWire.hubToPeer).filter((k) => k === 'BOOTSTRAP_SNAPSHOT'), '新 wire 恰一次快照重发').toHaveLength(1);
      expect(kinds(lastWire.peerToHub).filter((k) => k === 'BOOTSTRAP_ACK'), '导入成功 ACK 恰一次').toHaveLength(1);
      // 被丢帧仍只 1 笔（wire2 快照成功投递，无第二次丢弃）
      expect(run.wires.reduce((sum, wire) => sum + wire.droppedHubToPeer.length, 0)).toBe(1);
      expect(run.rootValue('peer', 'n')).toBe(42);
      expect(run.rootValue('peer', 'extra')).toBe(77);
      expect(run.metaValue('peer', 'replicationId')).toBe(run.hubFixture?.identity.replicationId);
      expect(uh.events, '全程零 unhandled rejection').toEqual([]);
    } finally {
      await run.peer.stop().catch(() => undefined);
      uh.dispose();
    }
  });
});
