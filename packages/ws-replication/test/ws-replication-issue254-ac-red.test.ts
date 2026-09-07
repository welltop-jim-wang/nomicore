/**
 * SA6 红灯验收契约 —— issue #254：周期 reconciliation 超时后必须自愈，
 * 不得以「Peer channel failed + Hub 无新 round + connection ready」的僵尸长期停摆，
 * 且恢复必须遵守「同一连接内终态 namespace 不重开」的协议不变量（protocol §1 不变量 4）。
 *
 * 复现手法（issue 简报「确定性回归场景」逐字落地）：fake duplex transport + 注入 timer；
 * Hub/Peer 完成首次同步进入 live → 触发周期 reconciliation → 丢弃该 round 必需的
 * hub→peer `SYNC_APPLIED`（round 无法在 peer 侧结算，§9.1）→ 推进越过
 * `reconcileTimeoutMs`。
 *
 * - 生产修复前：A1/A2 红灯（failed 僵尸永不重建连接），N1–N3 绿（负控/守护）；
 * - 修复方向 A（超时触发连接重建）落地后：A1/A2 转绿（重建 → 新连接 re-OPEN →
 *   reconcile → 双方 live + 数据收敛）；AC3 违例检查与 N1–N3 保持绿。
 *
 * 已知 harness 事实（本文件各场景均遵守）：wire 级丢帧会在发送方向留下信封序列洞；
 * 洞后发送方再发任何帧 → 接收端 SEQUENCE_VIOLATION（connection-fatal）。因此所有
 * 丢帧场景在超时后一律**零新 hub 出站帧**，恢复只能来自连接重建（重建后序列归零）。
 */
import { describe, expect, it } from 'vitest';
import type {
  ReplicationObserver,
  ReplicationObserverEvent,
  ReplicationTimeouts,
} from '@nomicore/ws-replication';
import { decodeMessage } from '@nomicore/replication-protocol';
import { advanceMs, boot, collectUnhandledRejections } from './driver.js';
import { settle, settleUntil } from './harness.js';

// ═══════════════════════════ 场景配置（全部虚拟时间；零 real sleep） ═══════════════════════════

const TIMEOUTS: Readonly<Partial<ReplicationTimeouts>> = {
  reconcileIntervalMs: 200, // 周期 round 触发间隔
  reconcileTimeoutMs: 500, // §13.2 NAMESPACE_TIMEOUT：round 收口时限
  ackTimeoutMs: 300, // 出向 UPDATE ACK 时限（hub ack-timeout → needs-resync 面的探测）
};
const BACKOFF = { baseMs: 50, maxMs: 5_000, resetAfterMs: 10_000 };
const HORIZON_STEPS = 60; // × 1_000ms 虚拟恢复窗口 = 60s（任何合规修复的恢复均应远小于此）

type Run = Awaited<ReturnType<typeof boot>>;
type ChanEvent = Extract<ReplicationObserverEvent, { type: 'channel-state-changed' }>;
type ConnEvent = Extract<ReplicationObserverEvent, { type: 'connection-state-changed' }>;

const TERMINAL = new Set<string>(['failed', 'closed', 'conflicted']);
const ACTIVE = new Set<string>(['targeted', 'opening', 'bootstrapping', 'reconciling', 'live', 'needs-resync']);

/** 记录该侧全部 observer 事件（单侧单观察者 = 事件天然有序）。 */
function makeRecorder(): {
  readonly events: ReplicationObserverEvent[];
  readonly observer: ReplicationObserver;
} {
  const events: ReplicationObserverEvent[] = [];
  return { events, observer: (event: ReplicationObserverEvent): void => { events.push(event); } };
}

/** 双端虚拟时钟齐步推进（peer 周期/超时 + hub ack/open 计时各自挂在自己 scheduler 上）。 */
async function advanceBoth(run: Run, ms: number): Promise<void> {
  await advanceMs(run, ms);
  await run.hubNode.scheduler.advanceBy(ms);
  await settle();
}

function chanOf(e: ReplicationObserverEvent): ChanEvent | undefined {
  return e.type === 'channel-state-changed' ? e : undefined;
}

function connOf(e: ReplicationObserverEvent): ConnEvent | undefined {
  return e.type === 'connection-state-changed' ? e : undefined;
}

/**
 * AC3 违例检查（protocol §1 不变量 4：「同一连接内同一 namespace 一个生命周期；
 * closed/conflicted/failed 后不得重新 open，重新 add 必须重建连接」）。
 *
 * 规则：以该侧事件流内的连接代际（connection-state-changed 至 'ready' 的次数）为
 * 连接代际尺。若某 namespace 进入终态（failed/closed/conflicted）后，在同代际内直接
 * 迁移回活跃态（targeted/opening/bootstrapping/reconciling/live/needs-resync）→ 违例。
 * 合法的重建路径（终态 → disconnected（连接死投影）→ 新代 ready → targeted/opening）
 * 因中间必然经过一次 ready 代际推进而不被标记（实测 N3 零误报）。
 */
function ac3Violations(events: readonly ReplicationObserverEvent[]): string[] {
  const violations: string[] = [];
  let gen = 0;
  const terminalEntryGen = new Map<string, number>();
  for (const event of events) {
    const conn = connOf(event);
    if (conn !== undefined) {
      if (conn.to === 'ready') gen += 1;
      continue;
    }
    const chan = chanOf(event);
    if (chan === undefined) continue;
    if (TERMINAL.has(chan.to)) {
      terminalEntryGen.set(chan.namespaceId, gen);
      continue;
    }
    if (TERMINAL.has(chan.from) && ACTIVE.has(chan.to)) {
      const entryGen = terminalEntryGen.get(chan.namespaceId);
      if (entryGen !== undefined && entryGen === gen) {
        violations.push(
          `${chan.side} ns=${chan.namespaceId.slice(0, 10)}… ${chan.from}→${chan.to} 同一连接内重开（terminal@gen${entryGen}，connectionId=${String(chan.connectionId)}）`,
        );
      }
    }
  }
  return violations;
}

/** 该侧最后一条 channel 迁移的 to 值（无 → undefined）。 */
function lastChannelTo(events: readonly ReplicationObserverEvent[], side: 'peer' | 'hub'): string | undefined {
  let to: string | undefined;
  for (const event of events) {
    const chan = chanOf(event);
    if (chan !== undefined && chan.side === side) to = chan.to;
  }
  return to;
}

function channelTrail(events: readonly ReplicationObserverEvent[], side: 'peer' | 'hub', limit = 12): string {
  const trail: string[] = [];
  for (const event of events) {
    const chan = chanOf(event);
    if (chan !== undefined && chan.side === side) {
      trail.push(`${chan.from}→${chan.to}@${String(chan.connectionId)}`);
    }
  }
  return trail.slice(-limit).join(' | ');
}

function connTrail(events: readonly ReplicationObserverEvent[], limit = 8): string {
  const trail: string[] = [];
  for (const event of events) {
    const conn = connOf(event);
    if (conn !== undefined && conn.side === 'peer') trail.push(`${conn.from}→${conn.to}`);
  }
  return trail.slice(-limit).join(' | ');
}

/** 红灯失败信息：当前可观测僵尸全貌（供红灯日志直接作为证据）。 */
function zombieSummary(
  run: Run,
  peerEvents: readonly ReplicationObserverEvent[],
  hubEvents: readonly ReplicationObserverEvent[],
  recovered: boolean,
  horizonSec: number,
): string {
  return [
    `recovered=${recovered}（horizon ${horizonSec}s 虚拟时间）`,
    `peer ns=${String(run.namespaceState())} conn=${run.connectionState()} wires=${run.wires.length} dials=${run.dialCount}`,
    `rounds(${run.peerFramesAll('SYNC_STEP1').length}) hubLastChannel=${String(lastChannelTo(hubEvents, 'hub'))}`,
    `peer channel trail: ${channelTrail(peerEvents, 'peer')}`,
    `hub channel trail: ${channelTrail(hubEvents, 'hub')}`,
    `peer conn trail: ${connTrail(peerEvents)}`,
  ].join('\n');
}

/** 红灯 A1/A2 共用的故障注入 + 恢复断言主体。 */
async function runTimeoutRecoveryScenario(opts: {
  readonly describe: string;
  readonly stallRound: 1 | 2; // 第几个周期 round 被卡死（1 = 首个周期 round；2 = 第二个）
}): Promise<void> {
  const uh = collectUnhandledRejections();
  const peerRec = makeRecorder();
  const hubRec = makeRecorder();
  const run = await boot({
    peerReplica: 'same',
    random: () => 0,
    timeouts: TIMEOUTS,
    backoff: BACKOFF,
    peerObserver: peerRec.observer,
    hubObserver: hubRec.observer,
  });
  try {
    expect(run.namespaceState(), `${opts.describe}: 初始同步后 peer 必须 live`).toBe('live');
    expect(run.connectionState(), `${opts.describe}: 初始连接必须 ready`).toBe('ready');
    const roundsBoot = run.peerFramesAll('SYNC_STEP1').length;

    // 若卡死的是第 2 个周期 round：先放行一个健康周期 round（round +1 且回 live）。
    if (opts.stallRound === 2) {
      await advanceBoth(run, TIMEOUTS.reconcileIntervalMs!);
      await run.waitNamespace('live');
      expect(run.peerFramesAll('SYNC_STEP1'), `${opts.describe}: 前置健康 round 必须完成`).toHaveLength(roundsBoot + 1);
      expect(run.wires, `${opts.describe}: 健康 round 不得重建连接`).toHaveLength(1);
    }

    // 丢弃该周期 round 必需的 hub→peer SYNC_APPLIED（§9.1：peer 的本地 diff 已由 hub
    // 接纳但确认帧丢失 → round 在 peer 侧永不结算；hub 侧 round 已结算保持 live）。
    run.wire.dropNextHubToPeer((bytes) => decodeMessage(bytes).message.kind === 'SYNC_APPLIED');

    await advanceBoth(run, TIMEOUTS.reconcileIntervalMs!);
    await settleUntil(() => run.namespaceState() === 'reconciling', `${opts.describe}: 周期 round 应停在 reconciling`);
    expect(run.peerFramesAll('SYNC_STEP1'), `${opts.describe}: 周期 round 恰发起一轮`).toHaveLength(
      opts.stallRound === 1 ? roundsBoot + 1 : roundsBoot + 2,
    );
    expect(run.connectionState(), `${opts.describe}: round 进行中连接保持 ready`).toBe('ready');
    expect(run.wires, `${opts.describe}: round 进行中不得重建连接`).toHaveLength(1);
    expect(run.dialCount, `${opts.describe}: round 进行中不得重拨`).toBe(1);

    // 超时边界内（reconcileTimeoutMs − 1ms）：不得有任何动作（对照负控窗口）。
    await advanceBoth(run, TIMEOUTS.reconcileTimeoutMs! - 1);
    expect(run.namespaceState(), `${opts.describe}: 超时前 round 保持进行中（不得提前放弃/重建）`).toBe('reconciling');
    expect(run.wires, `${opts.describe}: 超时前不得重建连接`).toHaveLength(1);
    expect(run.dialCount, `${opts.describe}: 超时前不得重拨`).toBe(1);

    // 越过 reconcileTimeoutMs：peer reconcile timer → 当前实现 finalize('failed')。
    await advanceBoth(run, 1);

    // 恢复窗口：修复后该时刻起必须自愈（连接重建 → 双方回 live）。
    let recovered = false;
    for (let step = 0; step < HORIZON_STEPS && !recovered; step += 1) {
      await advanceBoth(run, 1_000);
      recovered = run.namespaceState() === 'live';
    }
    expect(
      recovered,
      `${opts.describe}: 越过 reconcileTimeout 后必须在窗口内自愈至 live（AC1/AC2；当前实现=僵尸）：\n${zombieSummary(run, peerRec.events, hubRec.events, recovered, HORIZON_STEPS)}`,
    ).toBe(true);

    // AC6：恢复路径 = 连接重建（新 wire 上 re-OPEN + reconcile）。
    expect(run.wires.length, `${opts.describe}: 自愈必须经连接重建（AC6；新 wire）`).toBeGreaterThanOrEqual(2);
    expect(run.dialCount, `${opts.describe}: 自愈必须经重拨`).toBeGreaterThanOrEqual(2);
    const lastWireKinds = run.wire.peerToHub.map((b) => decodeMessage(b).message.kind);
    expect(lastWireKinds, `${opts.describe}: 新连接上必须 re-OPEN namespace`).toContain('OPEN_NAMESPACE');
    expect(lastWireKinds, `${opts.describe}: 新连接上必须发起新 reconcile round`).toContain('SYNC_STEP1');
    expect(lastChannelTo(hubRec.events, 'hub'), `${opts.describe}: hub 侧必须回到 live`).toBe('live');

    // AC3：恢复全程不得在同一连接内复活终态 namespace。
    const violations = [...ac3Violations(peerRec.events), ...ac3Violations(hubRec.events)];
    expect(violations, `${opts.describe}: AC3 违例（同一连接内终态 namespace 重开）`).toEqual([]);

    // AC4/AC6：恢复后的通道双向可用、数据收敛（已接纳业务写正常流通，无泄漏阻塞）。
    await run.writeHub({ n: 43 });
    await settleUntil(() => run.rootValue('peer', 'n') === 43, `${opts.describe}: hub→peer 数据收敛`);
    expect(run.rootValue('hub', 'n')).toBe(43);
    await run.writePeer({ n: 44 });
    await settleUntil(() => run.rootValue('hub', 'n') === 44, `${opts.describe}: peer→hub 数据收敛`);
    expect(run.rootValue('peer', 'n')).toBe(44);
    expect(uh.events, `${opts.describe}: 全程零 unhandled rejection（AC4 泄漏哨兵）`).toEqual([]);
  } finally {
    await run.peer.stop().catch(() => undefined);
    uh.dispose();
  }
}

// ═══════════════════════════ 契约测试 ═══════════════════════════

describe('issue #254：周期 reconciliation 超时自愈红灯契约', () => {
  it('红灯 A1：周期 reconcile 越过 reconcileTimeout 后必须自愈（首个周期 round 卡死）', async () => {
    await runTimeoutRecoveryScenario({ describe: 'A1', stallRound: 1 });
  }, 60_000);

  it('红灯 A2：同款死局在后续周期 round（先放行一个健康 round）同样必须自愈', async () => {
    await runTimeoutRecoveryScenario({ describe: 'A2', stallRound: 2 });
  }, 60_000);

  it('绿负控 N1：round 在 reconcileTimeout 内保持进行中——不重叠、不重建、不重拨（issue 点名现有测试盲区）', async () => {
    const run = await boot({
      peerReplica: 'same',
      random: () => 0,
      timeouts: TIMEOUTS,
      backoff: BACKOFF,
    });
    try {
      const roundsBoot = run.peerFramesAll('SYNC_STEP1').length;
      run.wire.dropNextHubToPeer((bytes) => decodeMessage(bytes).message.kind === 'SYNC_APPLIED');
      await advanceBoth(run, TIMEOUTS.reconcileIntervalMs!);
      await run.waitNamespace('reconciling');
      // 越过 interval 但停在超时边界前（现有测试只推进 << reconcileTimeoutMs，此处推到
      // timeout − 1ms 仍须绿——超时动作必须恰在边界触发，而非提前）。
      await advanceBoth(run, TIMEOUTS.reconcileTimeoutMs! - 1);
      expect(run.namespaceState()).toBe('reconciling');
      expect(run.peerFramesAll('SYNC_STEP1')).toHaveLength(roundsBoot + 1);
      expect(run.connectionState()).toBe('ready');
      expect(run.wires).toHaveLength(1);
      expect(run.dialCount).toBe(1);
    } finally {
      await run.peer.stop().catch(() => undefined);
    }
  });

  it('绿负控 N2：健康周期 round（零丢帧）正常完成、cadence 再武装——不引入连接重建 churn', async () => {
    const run = await boot({
      peerReplica: 'same',
      random: () => 0,
      timeouts: TIMEOUTS,
      backoff: BACKOFF,
    });
    try {
      const roundsBoot = run.peerFramesAll('SYNC_STEP1').length;
      await advanceBoth(run, TIMEOUTS.reconcileIntervalMs!);
      await run.waitNamespace('live');
      await advanceBoth(run, TIMEOUTS.reconcileIntervalMs!);
      await run.waitNamespace('live');
      expect(run.peerFramesAll('SYNC_STEP1')).toHaveLength(roundsBoot + 2);
      expect(run.namespaceState()).toBe('live');
      expect(run.wires).toHaveLength(1);
      expect(run.dialCount).toBe(1);
    } finally {
      await run.peer.stop().catch(() => undefined);
    }
  });

  it('绿负控 N3（控制变量对照）：同款僵尸形成后，一旦连接被重建（本测试手工触发断线=修复将自动执行的同一动作）当前实现即可自愈——证明唯一缺口是「重建触发」，且 AC3 检查器对合法重建零误报', async () => {
    const uh = collectUnhandledRejections();
    const peerRec = makeRecorder();
    const hubRec = makeRecorder();
    const run = await boot({
      peerReplica: 'same',
      random: () => 0,
      timeouts: TIMEOUTS,
      backoff: BACKOFF,
      peerObserver: peerRec.observer,
      hubObserver: hubRec.observer,
    });
    try {
      run.wire.dropNextHubToPeer((bytes) => decodeMessage(bytes).message.kind === 'SYNC_APPLIED');
      await advanceBoth(run, TIMEOUTS.reconcileIntervalMs!);
      await run.waitNamespace('reconciling');
      await advanceBoth(run, TIMEOUTS.reconcileTimeoutMs!);
      // 越过超时（当前实现：failed 僵尸；修复实现：无论是否先 failed，恢复都须可达）。
      // 恢复触发 = 断线 → peer backoff 自动重拨（§15.1/§16/§21 既有机制）。
      run.wire.closeHubSide(1006, 'test-disconnect');
      await settle();
      await advanceBoth(run, 50); // 消化 backoff 调度
      await run.waitConnection('ready');
      await run.waitNamespace('live');
      expect(run.wires.length).toBeGreaterThanOrEqual(2);
      expect(run.connectionState()).toBe('ready');
      expect(run.namespaceState()).toBe('live');
      // AC3：合法重建路径（终态 → disconnected → 新代 ready → re-OPEN）零违例。
      const violations = [...ac3Violations(peerRec.events), ...ac3Violations(hubRec.events)];
      expect(violations, 'AC3 违例（合法重建不得误报）').toEqual([]);
      // 恢复后双向数据收敛。
      await run.writeHub({ n: 43 });
      await settleUntil(() => run.rootValue('peer', 'n') === 43, 'N3: hub→peer 收敛');
      await run.writePeer({ n: 44 });
      await settleUntil(() => run.rootValue('hub', 'n') === 44, 'N3: peer→hub 收敛');
      expect(uh.events).toEqual([]);
    } finally {
      await run.peer.stop().catch(() => undefined);
      uh.dispose();
    }
  }, 60_000);
});
