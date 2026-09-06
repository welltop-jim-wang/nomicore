/**
 * issue #233 复现测试 —— 「大型 live UPDATE 被丢弃、依赖全量 reconciliation 收敛」的
 * 现状刻画（characterization）：本文件断言的是**当前 v1 行为**，不是期望终态。
 *
 * 三个场景：
 *  R1（主复现）：单笔合法大写（> maxUpdateBytes）→ 零 UPDATE 上 wire、needs-resync、
 *    RESYNC_REQUIRED、恢复依赖完整 state-vector round；同一载荷最终以 SYNC_STEP2
 *    整体 diff（走控制帧路径，不受 backpressure/window 记账）一次性传输。
 *  R2（持续大写）：连续两笔大写 → 两轮 resync；每次都以「状态切换 + 完整 round」计价。
 *  R3（致命尾部）：diff 超 maxSyncDiffBytes → 编码面 SYNC_DIFF_TOO_LARGE → namespace
 *    终局 failed（§13.2：fatal、config-retryable）——大文档使 namespace 永久不可用。
 *
 * 纪律与既有套件一致：真实 yjs / Registry / Runtime；fake-duplex 内存双端；
 * fake scheduler；零 real sleep；零源码 grep 断言。
 */
import { describe, expect, it } from 'vitest';
import type {
  ReplicationObserver,
  ReplicationObserverEvent,
} from '@nomicore/ws-replication';
import type { DecodedMessage } from '@nomicore/replication-protocol';
import { bootMulti } from './issue137-driver.js';
import { settle, settleUntil } from './harness.js';

class Collector {
  readonly events: ReplicationObserverEvent[] = [];
  observer: ReplicationObserver = (event) => {
    this.events.push(event);
  };
  of(type: ReplicationObserverEvent['type']): ReplicationObserverEvent[] {
    return this.events.filter((e) => e.type === type);
  }
}

/** wire 帧按 kind 聚合：count + 总字节（帧全长）。 */
function wireSummary(decoded: readonly DecodedMessage[]): Record<string, { count: number; bytes: number }> {
  const out: Record<string, { count: number; bytes: number }> = {};
  for (const frame of decoded) {
    const kind = frame.message.kind;
    const entry = (out[kind] ??= { count: 0, bytes: 0 });
    entry.count += 1;
    entry.bytes += frame.header.payloadLength + 20;
  }
  return out;
}

/** 指定 namespace + kind 帧的 payload 字节列表（SYNC_STEP2 取 update 字段长度）。 */
function step2DiffBytes(decoded: readonly DecodedMessage[], nsId: string): number[] {
  return decoded
    .filter((f) => f.message.kind === 'SYNC_STEP2' && f.message.namespaceId === nsId)
    .map((f) => (f.message as Extract<DecodedMessage['message'], { kind: 'SYNC_STEP2' }>).update.byteLength);
}

describe('issue #233 复现：超限 UPDATE 丢弃 + 全量 reconciliation 回退（现状刻画）', () => {
  const LIMITS = {
    maxUpdateBytes: 8_192,
    maxInFlightUpdates: 8,
    maxQueuedUpdateCount: 100,
    maxQueuedUpdateBytes: 1_048_576,
  } as const;

  it('R1：单笔 20KB 合法写 → 零 UPDATE / resync 声明 / 同一载荷改走控制帧全量 diff', async () => {
    const peerEvents = new Collector();
    const hubEvents = new Collector();
    const run = await bootMulti({
      count: 1,
      limits: LIMITS,
      timeouts: { ackTimeoutMs: 60_000 },
      peerObserver: peerEvents.observer,
      hubObserver: hubEvents.observer,
    });
    const a = run.nsIds[0]!;
    const BIG = 'z'.repeat(20_000); // 编码后 ≈20KB > maxUpdateBytes 8KB

    await run.peerWrite(a, { blurb: BIG });
    await settle();

    // ── 代价 1：namespace 状态切换 + 完整 sync round ────────────────────────
    // （内存双端下恢复 round 在 settle 内已完成——状态切换证据锚在事件的
    //  决策落定后投影 channelState='needs-resync'，而非事后瞬态读数。）
    const resync = peerEvents.of('resync-required');
    expect(resync).toHaveLength(1);
    expect(
      (resync[0] as Extract<ReplicationObserverEvent, { type: 'resync-required' }>).channelState,
    ).toBe('needs-resync');
    expect(
      run
        .framesOf('peerToHub', a)
        .filter((f) => f.message.kind === 'RESYNC_REQUIRED'),
    ).toHaveLength(1);
    // 大写从未作为 UPDATE 出现在 wire 上（连接仍然健康——问题在协议能力，不在链路）
    expect(run.framesOf('peerToHub', a).filter((f) => f.message.kind === 'UPDATE')).toHaveLength(0);
    expect(run.connectionState()).toBe('ready');

    // 恢复：state-vector round 收敛 hub
    await settleUntil(
      () => run.rootValue('hub', a, 'blurb') === BIG && run.peer.getNamespaceState(a) === 'live',
      '恢复 round 后 hub 收敛且回到 live',
    );

    // ── 代价 2：reconciliation diff ≈ 完整载荷，且走控制帧路径 ──────────────
    // peer→hub 的 Step2 diff 携带同一 20KB 载荷：一次性、整帧、不经 data 队列
    // backpressure/window 记账（SYNC_STEP2 属控制面，协议 §17 control reserve 记账）。
    const diffs = step2DiffBytes(run.framesOf('peerToHub', a), a);
    const bigDiff = diffs.filter((n) => n > LIMITS.maxUpdateBytes);
    expect(bigDiff.length).toBeGreaterThanOrEqual(1);

    // 复现度量摘要（供 issue 报告引用）
    const summary = {
      scenario: 'R1 single 20KB write, maxUpdateBytes=8192',
      updateFramesCarryingBigWrite: 0,
      resyncRounds: resync.length,
      step2DiffBytesPeerToHub: diffs,
      wire: {
        peerToHub: wireSummary(run.framesOf('peerToHub', a)),
        hubToPeer: wireSummary(run.framesOf('hubToPeer', a)),
      },
    };
    console.log('[issue233 repro R1]', JSON.stringify(summary, null, 2));
  });

  it('R2：连续两笔大写 → 两轮 resync（持续大写重复触发完整 round）', async () => {
    const peerEvents = new Collector();
    const hubEvents = new Collector();
    const run = await bootMulti({
      count: 1,
      limits: LIMITS,
      timeouts: { ackTimeoutMs: 60_000 },
      peerObserver: peerEvents.observer,
      hubObserver: hubEvents.observer,
    });
    const a = run.nsIds[0]!;

    await run.peerWrite(a, { blurb: 'x'.repeat(20_000) });
    await settleUntil(
      () => run.peer.getNamespaceState(a) === 'live' && run.rootValue('hub', a, 'blurb') === 'x'.repeat(20_000),
      '第一轮恢复收敛',
    );
    await run.peerWrite(a, { blurb: 'y'.repeat(20_000) });
    await settleUntil(
      () => run.peer.getNamespaceState(a) === 'live' && run.rootValue('hub', a, 'blurb') === 'y'.repeat(20_000),
      '第二轮恢复收敛',
    );

    // 每笔大写各触发一次状态切换 + 完整 round；零 UPDATE 帧承载业务数据
    const resyncs = peerEvents.of('resync-required');
    expect(resyncs.length).toBeGreaterThanOrEqual(2);
    expect(run.framesOf('peerToHub', a).filter((f) => f.message.kind === 'UPDATE')).toHaveLength(0);

    console.log(
      '[issue233 repro R2]',
      JSON.stringify({
        scenario: 'R2 two consecutive 20KB writes',
        resyncRounds: resyncs.length,
        step2DiffBytesPeerToHub: step2DiffBytes(run.framesOf('peerToHub', a), a),
        wire: {
          peerToHub: wireSummary(run.framesOf('peerToHub', a)),
          hubToPeer: wireSummary(run.framesOf('hubToPeer', a)),
        },
      }),
    );
  });

  it('R3：diff 超 maxSyncDiffBytes → SYNC_DIFF_TOO_LARGE → namespace 终局 failed（大文档致命尾部）', async () => {
    const peerEvents = new Collector();
    const hubEvents = new Collector();
    const run = await bootMulti({
      count: 1,
      limits: { ...LIMITS, maxSyncDiffBytes: 32_768 },
      timeouts: { ackTimeoutMs: 60_000 },
      peerObserver: peerEvents.observer,
      hubObserver: hubEvents.observer,
    });
    const a = run.nsIds[0]!;
    const HUGE = 'h'.repeat(100_000); // ≈100KB：超 maxUpdateBytes 且恢复 diff 超 maxSyncDiffBytes

    await run.peerWrite(a, { blurb: HUGE });
    // 恢复 round 编码 Step2（≈100KB diff）→ 编码面 SYNC_DIFF_TOO_LARGE →
    // namespace ERROR + failed（终态；§13.2 config-retryable——不改配置永不恢复）
    await settleUntil(
      () => run.peer.getNamespaceState(a) === 'failed',
      `namespace 终局 failed（当前 ${String(run.peer.getNamespaceState(a))}）`,
    );
    await settle();

    // wire 证据：SYNC_DIFF_TOO_LARGE namespace ERROR（peer 编码面发出）
    const errors = run
      .framesOf('peerToHub', a)
      .filter((f) => f.message.kind === 'ERROR');
    expect(
      errors.some((f) => (f.message as Extract<DecodedMessage['message'], { kind: 'ERROR' }>).code === 'SYNC_DIFF_TOO_LARGE'),
      'peerToHub 必须出现 SYNC_DIFF_TOO_LARGE namespace ERROR',
    ).toBe(true);

    // 永久发散：hub 恒缺该值；连接健康但 namespace 死亡
    expect(run.rootValue('hub', a, 'blurb')).toBe('seed');
    expect(run.connectionState()).toBe('ready');

    console.log(
      '[issue233 repro R3]',
      JSON.stringify({
        scenario: 'R3 100KB write, maxSyncDiffBytes=32768',
        namespaceTerminalState: run.peer.getNamespaceState(a),
        connectionState: run.connectionState(),
        wire: {
          peerToHub: wireSummary(run.framesOf('peerToHub', a)),
          hubToPeer: wireSummary(run.framesOf('hubToPeer', a)),
        },
      }),
    );
  });
});
