import { describe, expect, it } from 'vitest';
import { decodeMessage, type SyncStep1Msg } from '@nomicore/replication-protocol';
import { advanceMs, boot } from './driver.js';
import { settle } from './harness.js';

function roundIds(run: Awaited<ReturnType<typeof boot>>): number[] {
  return run.peerFrames('SYNC_STEP1').map(
    (frame) => (frame.message as SyncStep1Msg).syncRoundId,
  );
}

describe('issue #192：周期 reconciliation', () => {
  it('仅在 live 的间隔边界触发，并在完成后重新武装', async () => {
    const interval = 100;
    const run = await boot({
      peerReplica: 'same',
      timeouts: { reconcileIntervalMs: interval },
    });
    const initial = roundIds(run);

    await advanceMs(run, interval - 1);
    expect(roundIds(run)).toEqual(initial);

    await advanceMs(run, 1);
    await run.waitNamespace('live');
    expect(roundIds(run)).toEqual([...initial, initial.at(-1)! + 1]);

    await advanceMs(run, interval);
    await run.waitNamespace('live');
    expect(roundIds(run)).toEqual([...initial, initial.at(-1)! + 1, initial.at(-1)! + 2]);
  });

  it('进行中的周期 round 不重叠', async () => {
    const interval = 100;
    const run = await boot({
      peerReplica: 'same',
      timeouts: { reconcileIntervalMs: interval, reconcileTimeoutMs: 10_000 },
    });
    const before = roundIds(run).length;
    run.wire.dropNextHubToPeer(
      (bytes) => decodeMessage(bytes).message.kind === 'SYNC_APPLIED',
    );

    await advanceMs(run, interval);
    await settle();
    expect(run.namespaceState()).toBe('reconciling');
    expect(roundIds(run)).toHaveLength(before + 1);

    await advanceMs(run, interval * 3);
    expect(run.namespaceState()).toBe('reconciling');
    expect(roundIds(run)).toHaveLength(before + 1);
  });

  it('修复未触发显式 resync 的静默 UPDATE 丢失', async () => {
    const interval = 100;
    const run = await boot({
      peerReplica: 'same',
      timeouts: { reconcileIntervalMs: interval, ackTimeoutMs: 10_000 },
    });
    // 模拟回声抑制链路之外的本地副本漂移：直接改 hub live Y.Doc，不产生 UPDATE 帧。
    const hubDoc = run.hubNode.persistence.peek(run.hubFixture!.lease.owner, run.nsId)!;
    hubDoc.getMap('ROOT').set('n', 99);
    expect(run.rootValue('peer', 'n')).not.toBe(99);

    await advanceMs(run, interval);
    await run.waitNamespace('live');
    expect(run.rootValue('peer', 'n')).toBe(99);
  });

  it('重连取消旧代 timer，并从新 live 代际重新计时', async () => {
    const interval = 100;
    const run = await boot({
      peerReplica: 'same',
      random: () => 0,
      timeouts: { reconcileIntervalMs: interval },
    });
    const before = roundIds(run).length;
    run.wire.hubEnd.close(1006, 'test-disconnect');
    await settle();
    await advanceMs(run, 50);
    await run.waitConnection('ready');
    await run.waitNamespace('live');
    expect(run.wires).toHaveLength(2);
    const afterReconnect = roundIds(run).length;
    expect(afterReconnect).toBe(before);

    await advanceMs(run, interval - 1);
    expect(roundIds(run)).toHaveLength(afterReconnect);
    await advanceMs(run, 1);
    await run.waitNamespace('live');
    expect(roundIds(run)).toHaveLength(afterReconnect + 1);
  });

  it('stop 清理周期 timer，不复活 namespace', async () => {
    const interval = 100;
    const run = await boot({
      peerReplica: 'same',
      timeouts: { reconcileIntervalMs: interval },
    });
    const before = roundIds(run).length;

    await run.peer.stop();
    await advanceMs(run, interval * 10);

    expect(run.connectionState()).toBe('stopped');
    expect(run.namespaceState()).toBe('closed');
    expect(roundIds(run)).toHaveLength(before);
  });
});
