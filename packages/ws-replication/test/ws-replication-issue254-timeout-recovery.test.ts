/**
 * issue #254 扩展验收 —— timer 族超时自愈（方向 A 一般化，D2）与触发面边界负控。
 *
 * SA1 设计（`task_issue-254_design.md` §7/§11/§12）把超时后的恢复触发一般化到
 * open/bootstrap/reconcile 三种 timer（§13.2 `NAMESPACE_TIMEOUT` retryable=reconnect
 * 的本地映射全集）；本文件场景 1–4 钉住界内行为，场景 5（SA2 F3）钉住界外负控：
 *
 *   1. open 超时自愈：authorize 悬挂 → openTimeout → failed（瞬态）→ 本端重建 →
 *      有界恢复环（backoff attempts 单调增长）→ release → live；
 *   2. bootstrap 超时自愈（连续两次悬挂）：每 wire 恰一次快照尝试（同 wire 不重发），
 *      重建后新 wire 合法重发 → 收敛 live；
 *   3. multiplex（D5）：双 ns live，ns-A open 超时触发整连接重建环 → 兄弟 ns-B 每轮
 *      churn 后可恢复；release 后双 ns 回 live、双向数据收敛（零丢失——全量副本 +
 *      state-vector round）；
 *   4. reconcile 超时持续悬挂（每 wire 丢该 round 的 SYNC_APPLIED）：重试环有界
 *      （dialCount 受 §15.1 backoff 界约束、attempts 单调增长至 cap、退避延迟按
 *      full-jitter 公式增长）→ 故障源消失后自愈 live；
 *   5. 负控（界外）：错误帧驱动的 failed（NOT_FOUND）在 ≥ 恢复窗口内零重建零重拨
 *      ——触发面仅 timer 族（§13.2 分类轴；§16「等待连接重建或配置变化」语义不变）。
 *
 * 已知 harness 约束（SA6 §15-1 同款）：wire 级丢帧制造信封序列洞，洞后同连接任何
 * 新帧 → SEQUENCE_VIOLATION。因此场景 4 每 wire 只丢一轮 SYNC_APPLIED 后该 wire 即
 * 静默（round 永不结算、hub 无后续出站）；场景 3 的整连接重建环以 authorize 悬挂
 * （open 超时实例）注入——不丢帧、无信封洞，兄弟 ns 数据面干净。
 *
 * 红灯纪律：真实 yjs / Registry / Runtime；fake-duplex；注入 timer；零 real sleep。
 */
import { describe, expect, it } from 'vitest';
import type {
  ReplicationObserver,
  ReplicationObserverEvent,
  ReplicationTimeouts,
} from '@nomicore/ws-replication';
import { decodeMessage } from '@nomicore/replication-protocol';
import type { NamespaceOwner } from '@nomicore/namespace-registry';
import {
  advanceMs,
  boot,
  collectUnhandledRejections,
  type Run,
} from './driver.js';
import { okLease, schemaReady, HUB_OWNER, PEER_OWNER, makeHubNamespace, settle, settleUntil } from './harness.js';

// ═══════════════════════════ 场景配置（全部虚拟时间） ═══════════════════════════

const OPEN_TIMEOUTS: Readonly<Partial<ReplicationTimeouts>> = { openTimeoutMs: 200 };
const STALL_TIMEOUTS: Readonly<Partial<ReplicationTimeouts>> = {
  reconcileIntervalMs: 200,
  reconcileTimeoutMs: 500,
};
const BOOT_TIMEOUTS: Readonly<Partial<ReplicationTimeouts>> = { bootstrapTimeoutMs: 150 };
/** open 环（attempts 单调增长至 cap 后周期 ≈ openTimeoutMs + maxMs×jitter）。 */
const OPEN_BACKOFF = { baseMs: 50, maxMs: 400, resetAfterMs: 500 };
/** reconcile 环（ready 驻留 ≈ reconcileTimeoutMs < resetAfterMs → attempts 不清零）。 */
const RING_BACKOFF = { baseMs: 50, maxMs: 400, resetAfterMs: 4_000 };
/** bootstrap 双停环。 */
const BOOT_BACKOFF = { baseMs: 50, maxMs: 500, resetAfterMs: 4_000 };

type ChanEvent = Extract<ReplicationObserverEvent, { type: 'channel-state-changed' }>;
type BackoffEvent = Extract<ReplicationObserverEvent, { type: 'connection-backoff-scheduled' }>;

const TERMINAL = new Set<string>(['failed', 'closed', 'conflicted']);
const ACTIVE = new Set<string>(['targeted', 'opening', 'bootstrapping', 'reconciling', 'live', 'needs-resync']);

function makeRecorder(): {
  readonly events: ReplicationObserverEvent[];
  readonly observer: ReplicationObserver;
} {
  const events: ReplicationObserverEvent[] = [];
  return {
    events,
    observer: (event: ReplicationObserverEvent): void => {
      events.push(event);
    },
  };
}

function chanEdges(events: readonly ReplicationObserverEvent[], side: 'peer' | 'hub'): ChanEvent[] {
  return events.filter(
    (e): e is ChanEvent => e.type === 'channel-state-changed' && e.side === side,
  );
}

function chanOfNs(events: readonly ReplicationObserverEvent[], side: 'peer' | 'hub', namespaceId: string): ChanEvent[] {
  return chanEdges(events, side).filter((e) => e.namespaceId === namespaceId);
}

function backoffsOf(events: readonly ReplicationObserverEvent[]): BackoffEvent[] {
  return events.filter(
    (e): e is BackoffEvent => e.type === 'connection-backoff-scheduled',
  );
}

function isSyncApplied(bytes: Uint8Array): boolean {
  return decodeMessage(bytes).message.kind === 'SYNC_APPLIED';
}

function isBootstrapSnapshot(bytes: Uint8Array): boolean {
  return decodeMessage(bytes).message.kind === 'BOOTSTRAP_SNAPSHOT';
}

/**
 * AC3 违例检查（protocol §1 不变量 4；SA6 §12.2 同款检查器——A1/A2/N3 全场景执行）。
 * 以该侧事件流内 connection-state-changed 至 'ready' 的次数为连接代际尺：某 namespace
 * 进入终态后若**同一代际内**直接迁回活跃态 → 违例。合法重建路径（终态 → disconnected
 * → 新代 ready → 复活）因中间必有一次 ready 代际推进而不被标记。
 */
function ac3Violations(events: readonly ReplicationObserverEvent[]): string[] {
  const violations: string[] = [];
  let gen = 0;
  const terminalEntryGen = new Map<string, number>();
  for (const event of events) {
    if (event.type === 'connection-state-changed') {
      if (event.side === 'peer' && event.to === 'ready') gen += 1;
      continue;
    }
    if (event.type !== 'channel-state-changed') continue;
    const chan = event;
    if (TERMINAL.has(chan.to)) {
      terminalEntryGen.set(chan.namespaceId, gen);
      continue;
    }
    if (TERMINAL.has(chan.from) && ACTIVE.has(chan.to)) {
      const entryGen = terminalEntryGen.get(chan.namespaceId);
      if (entryGen !== undefined && entryGen === gen) {
        violations.push(
          `${chan.side} ns=${chan.namespaceId.slice(0, 10)}… ${chan.from}→${chan.to} 同一连接内重开（terminal@gen${entryGen}）`,
        );
      }
    }
  }
  return violations;
}

/** 双端虚拟时钟齐步推进（peer 计时 + hub 计时各自挂在各自 scheduler）。 */
async function advanceBoth(run: Run, ms: number): Promise<void> {
  await advanceMs(run, ms);
  await run.hubNode.scheduler.advanceBy(ms);
  await settle();
}

/** 恢复窗口内轮询到 live（把任意阶段的重建/退避推进到底）。 */
async function awaitLive(run: Run, horizonSteps: number, what: string): Promise<void> {
  let live = false;
  for (let step = 0; step < horizonSteps && !live; step += 1) {
    await advanceBoth(run, 1_000);
    live = run.namespaceState() === 'live';
  }
  expect(live, `恢复窗口内必须回 live：${what}（当前 ns=${String(run.namespaceState())} conn=${run.connectionState()} dials=${run.dialCount}）`).toBe(true);
}

/** ns2 的 peer 侧业务写（独立 business lease；driver.writePeer 的泛化）。 */
async function writePeerNs(run: Run, namespaceId: string, key: 'n' | 'extra', value: number): Promise<void> {
  const lease = okLease(await run.peerNode.registry.open(PEER_OWNER, namespaceId));
  await schemaReady(lease);
  const result = await lease.mutateData({ op: 'set', path: [key], value });
  if (!result.ok) throw new Error(`peer 业务写失败：${JSON.stringify(result)}`);
  await lease.release();
  await settle();
}

/** 直接读取某侧某 ns 的 ROOT 值（driver.rootValue 的泛化）。 */
function rootValueNs(
  run: Run,
  side: 'hub' | 'peer',
  owner: NamespaceOwner,
  namespaceId: string,
  key: string,
): unknown {
  const node = side === 'hub' ? run.hubNode : run.peerNode;
  const doc = node.persistence.peek(owner, namespaceId);
  return doc === undefined ? undefined : (doc.getMap('ROOT') as unknown as Map<string, unknown>).get(key);
}

// ═══════════════════════════ 场景 1：open 超时自愈（authorize 悬挂） ═══════════════════════════

describe('issue #254：timer 族超时自愈与触发面边界', () => {
  it('场景 1：初始 OPEN 的 authorize 悬挂 → openTimeout 收口 failed（瞬态）→ 本端重建 → 有界恢复环 → release 后回 live', async () => {
    const uh = collectUnhandledRejections();
    const peerRec = makeRecorder();
    const hubRec = makeRecorder();
    let release!: () => void;
    const hang = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = await boot({
      start: false,
      timeouts: OPEN_TIMEOUTS,
      backoff: OPEN_BACKOFF,
      random: () => 0.5,
      peerObserver: peerRec.observer,
      hubObserver: hubRec.observer,
      authorize: async () => {
        await hang; // 授权后端故障：OPEN 永不授权
        return {
          ok: true as const,
          localOwner: { userId: 'hub-owner-9f38' },
          permissions: { read: true, submit: true },
        };
      },
    });
    try {
      run.peer.start();
      await run.waitConnection('ready');
      await run.waitNamespace('opening');
      // 越过 openTimeoutMs：收口 failed（瞬态——事件轨迹钉住；轮询捕不到）
      await advanceBoth(run, 200);
      const peerChans = chanOfNs(peerRec.events, 'peer', run.nsId);
      expect(
        peerChans.some((e) => e.from === 'opening' && e.to === 'failed'),
        'open timeout 必须收口 failed（§13.2 NAMESPACE_TIMEOUT）',
      ).toBe(true);
      expect(
        peerChans.some((e) => e.from === 'failed' && e.to === 'disconnected'),
        '终态须经 disconnected 投影（AC3 合法复活路径）',
      ).toBe(true);
      // 悬挂持续 → 有界恢复环（预修复 = 静态僵尸；无界实现 = 恒速重连环）
      for (let step = 0; step < 35; step += 1) {
        await advanceBoth(run, 300);
      }
      expect(run.dialCount, '悬挂窗口内必须出现重试环（dialCount 增长）').toBeGreaterThanOrEqual(8);
      expect(run.dialCount, '环率受 §15.1 backoff 界约束（cap=maxMs=400ms）').toBeLessThanOrEqual(32);
      const recovery = backoffsOf(peerRec.events).filter((e) => e.reason === 'namespace-recovery');
      expect(recovery.length, '每次超时重建发射 connection-backoff-scheduled{namespace-recovery}').toBeGreaterThanOrEqual(15);
      const attempts = recovery.map((e) => e.attempt);
      expect(attempts, 'attempts 单调增长（ready 驻留 < resetAfterMs → 不清零）').toEqual(
        [...attempts].sort((a, b) => a - b),
      );
      expect(new Set(attempts).size, 'attempts 严格递增').toBe(attempts.length);
      expect(recovery.slice(0, 4).map((e) => e.delayMs), 'full-jitter：0.5×min(maxMs, base×2^(a-1))').toEqual([
        25, 50, 100, 200,
      ]);
      for (const e of recovery) {
        expect(e.delayMs, '退避延迟 ≤ cap=0.5×maxMs').toBeLessThanOrEqual(200);
      }
      // release → 恢复 → live；AC3 零违例；数据收敛；零 unhandled rejection
      release();
      await awaitLive(run, 60, '场景 1 release 后自愈');
      expect(run.connectionState()).toBe('ready');
      const violations = [...ac3Violations(peerRec.events), ...ac3Violations(hubRec.events)];
      expect(violations, 'AC3 违例（同一连接内终态 namespace 重开）').toEqual([]);
      await run.writeHub({ n: 43 });
      await settleUntil(() => run.rootValue('peer', 'n') === 43, '场景 1: hub→peer 收敛');
      await run.writePeer({ n: 44 });
      await settleUntil(() => run.rootValue('hub', 'n') === 44, '场景 1: peer→hub 收敛');
      expect(uh.events, '全程零 unhandled rejection（AC4 泄漏哨兵）').toEqual([]);
    } finally {
      release();
      await run.peer.stop().catch(() => undefined);
      uh.dispose();
    }
  }, 60_000);

  // ═══════════════════════════ 场景 2：bootstrap 超时自愈（连续两次悬挂） ═══════════════════════════

  it('场景 2：BOOTSTRAP_SNAPSHOT 丢失 → bootstrap timeout → 重建；连续两个 wire 各恰一次快照尝试（同 wire 不重发），第三个 wire 快照到达 → 收敛 live', async () => {
    const uh = collectUnhandledRejections();
    const peerRec = makeRecorder();
    const run = await boot({
      start: false,
      timeouts: BOOT_TIMEOUTS,
      backoff: BOOT_BACKOFF,
      random: () => 0.5,
      peerObserver: peerRec.observer,
    });
    try {
      run.peer.start();
      await run.waitConnection('ready');
      // wire1：快照被丢 → 第一次 bootstrap 悬挂
      run.wire.dropNextHubToPeer(isBootstrapSnapshot);
      await run.waitNamespace('bootstrapping');
      expect(run.wires[0]!.droppedHubToPeer).toHaveLength(1);
      // 越过 bootstrapTimeoutMs：收口 failed → 本端重建（backoff 25ms → 拨号 wire2）
      await advanceMs(run, 150);
      const chans1 = chanOfNs(peerRec.events, 'peer', run.nsId);
      expect(
        chans1.some((e) => e.from === 'bootstrapping' && e.to === 'failed'),
        'bootstrap timeout 收口 failed（事件轨迹）',
      ).toBe(true);
      // 拨号 wire2：在其任何帧流动前武装第二次快照丢弃（advanceBy 与 settle 之间——
      // 消息投递是微任务，拨号后握手链尚未到达 BOOTSTRAP_SNAPSHOT）
      await run.peerNode.scheduler.advanceBy(25);
      expect(run.wires, 'backoff 到期必须完成重拨').toHaveLength(2);
      run.wire.dropNextHubToPeer(isBootstrapSnapshot);
      await settle();
      // wire2 的重新 bootstrap 同样悬挂 → 第二次 bootstrap timeout → 重建 → 拨号 wire3
      await advanceMs(run, 200);
      const chans2 = chanOfNs(peerRec.events, 'peer', run.nsId);
      expect(
        chans2.filter((e) => e.from === 'bootstrapping' && e.to === 'failed').length,
        '每个悬挂 wire 恰一次 bootstrap timeout 收口',
      ).toBeGreaterThanOrEqual(2);
      await run.peerNode.scheduler.advanceBy(100); // 第二次 backoff（50ms）到期 → 拨号 wire3
      expect(run.wires, '第二次重建必须完成重拨').toHaveLength(3);
      await settle();
      // wire3：快照合法重发 → 导入 → 收敛 live
      await run.waitConnection('ready');
      await run.waitNamespace('live');
      const lastWire = run.wires[run.wires.length - 1]!;
      const kinds = lastWire.hubToPeer.map((b) => decodeMessage(b).message.kind);
      expect(kinds.filter((k) => k === 'BOOTSTRAP_SNAPSHOT'), '新 wire 恰一次快照重发').toHaveLength(1);
      expect(
        lastWire.peerToHub.map((b) => decodeMessage(b).message.kind).filter((k) => k === 'BOOTSTRAP_ACK'),
        '导入成功 ACK 恰一次',
      ).toHaveLength(1);
      // 同 wire 不重发纪律：前两个 wire 各恰一次（被丢）快照尝试、零 ACK
      expect(run.wires[0]!.droppedHubToPeer, 'wire1 恰一次快照尝试（被丢）').toHaveLength(1);
      expect(run.wires[1]!.droppedHubToPeer, 'wire2 恰一次快照尝试（被丢）').toHaveLength(1);
      expect(run.wires[0]!.peerToHub.map((b) => decodeMessage(b).message.kind)).not.toContain('BOOTSTRAP_ACK');
      expect(run.wires[1]!.peerToHub.map((b) => decodeMessage(b).message.kind)).not.toContain('BOOTSTRAP_ACK');
      expect(run.dialCount, '自愈经重拨（dials=3）').toBe(3);
      expect(run.namespaceState()).toBe('live');
      expect(run.rootValue('peer', 'n')).toBe(42);
      expect(run.rootValue('peer', 'extra')).toBe(77);
      expect(uh.events, '全程零 unhandled rejection').toEqual([]);
    } finally {
      await run.peer.stop().catch(() => undefined);
      uh.dispose();
    }
  }, 60_000);

  // ═══════════════════════════ 场景 3：multiplex（D5 兄弟 ns churn） ═══════════════════════════

  it('场景 3：双 ns live 于同一连接；ns-A authorize 悬挂触发 open 超时重建环 → 兄弟 ns-B 每轮 churn 后可恢复；release 后双 ns 回 live、双向数据收敛（零丢失）', async () => {
    const uh = collectUnhandledRejections();
    const peerRec = makeRecorder();
    const hubRec = makeRecorder();
    let release!: () => void;
    const hang = new Promise<void>((resolve) => {
      release = resolve;
    });
    // 以「首个被授权 namespace」（= boot 期打开的 ns1）为悬挂对象：其第 2 次起
    // authorize 悬挂（重连后的 OPEN 永不答）；兄弟 ns（ns2）始终放行。
    let firstNs: string | undefined;
    let firstNsCalls = 0;
    const run = await boot({
      timeouts: OPEN_TIMEOUTS,
      backoff: OPEN_BACKOFF,
      random: () => 0.5,
      peerObserver: peerRec.observer,
      hubObserver: hubRec.observer,
      authorize: async (_instanceIdentity, namespaceId) => {
        if (firstNs === undefined) firstNs = namespaceId;
        if (namespaceId === firstNs) {
          firstNsCalls += 1;
          if (firstNsCalls >= 2) await hang;
        }
        return {
          ok: true as const,
          localOwner: { userId: 'hub-owner-9f38' },
          permissions: { read: true, submit: true },
        };
      },
    });
    const ns2Fixture = await makeHubNamespace(run.hubNode, { owner: HUB_OWNER });
    const ns2 = ns2Fixture.namespaceId;
    try {
      run.peer.addTarget({ namespaceId: ns2, localOwner: run.target.localOwner });
      await settleUntil(
        () => run.peer.getNamespaceState(ns2) === 'live',
        `ns2 live（当前 ${String(run.peer.getNamespaceState(ns2))}）`,
      );
      expect(run.namespaceState(), 'ns1 live').toBe('live');
      expect(run.wires, '双 ns 初始同线').toHaveLength(1);
      // 制造整连接重建：手工断线 → 重连时 ns1 的 authorize 悬挂（第 2 次起）→ ns1
      // openTimeout 收口 → 本端重建环（每轮整连接重建；ns2 兄弟 churn 后恢复）
      run.wire.closePeerSide(1006, 'network lost');
      await run.waitNamespace('disconnected');
      await advanceBoth(run, 25);
      await run.waitConnection('ready');
      await run.waitNamespace('opening');
      for (let step = 0; step < 35; step += 1) {
        await advanceBoth(run, 300);
      }
      // ns-A：有界重试环（open 超时实例）；ns-B：每轮 churn 后重新 live
      expect(run.dialCount, '环率受 backoff 界约束').toBeGreaterThanOrEqual(6);
      expect(run.dialCount, '环率受 backoff 界约束（cap）').toBeLessThanOrEqual(32);
      const ns1Chans = chanOfNs(peerRec.events, 'peer', run.nsId);
      expect(
        ns1Chans.filter((e) => e.from === 'opening' && e.to === 'failed').length,
        'ns-A 每环一次 open 超时收口',
      ).toBeGreaterThanOrEqual(3);
      const ns2LiveCount = chanOfNs(peerRec.events, 'peer', ns2).filter((e) => e.to === 'live').length;
      expect(ns2LiveCount, 'ns-B 每次整连接重建后都重新 live（兄弟 churn 可恢复）').toBeGreaterThanOrEqual(3);
      // 环窗口内 hub 侧对 ns2 的业务写：故障期间仍可接纳（hub 本地副本），恢复后经
      // state-vector round 收敛到 peer（零丢失——AC4 功能锚）
      const hubWrite = await ns2Fixture.lease.mutateData({ op: 'set', path: ['extra'], value: 91 });
      if (!hubWrite.ok) throw new Error(`hub ns2 写失败：${JSON.stringify(hubWrite)}`);
      await settle();
      // release → 双 ns 回 live
      release();
      let bothLive = false;
      for (let step = 0; step < 60 && !bothLive; step += 1) {
        await advanceBoth(run, 1_000);
        bothLive = run.namespaceState() === 'live' && run.peer.getNamespaceState(ns2) === 'live';
      }
      expect(bothLive, 'release 后双 ns 必须回 live').toBe(true);
      expect(run.connectionState()).toBe('ready');
      // AC3：peer/hub 双侧全程零违例
      const violations = [...ac3Violations(peerRec.events), ...ac3Violations(hubRec.events)];
      expect(violations, 'AC3 违例（同一连接内终态 namespace 重开）').toEqual([]);
      // ns2 双向收敛：hub 环窗口写 → peer；peer 写 → hub
      await settleUntil(
        () => rootValueNs(run, 'peer', PEER_OWNER, ns2, 'extra') === 91,
        'ns2 hub→peer 收敛（环窗口写不丢失）',
      );
      await writePeerNs(run, ns2, 'n', 88);
      await settleUntil(
        () => rootValueNs(run, 'hub', HUB_OWNER, ns2, 'n') === 88,
        'ns2 peer→hub 收敛',
      );
      // ns1 双向收敛
      await run.writeHub({ n: 43 });
      await settleUntil(() => run.rootValue('peer', 'n') === 43, 'ns1 hub→peer 收敛');
      await run.writePeer({ n: 44 });
      await settleUntil(() => run.rootValue('hub', 'n') === 44, 'ns1 peer→hub 收敛');
      expect(uh.events, '全程零 unhandled rejection（AC4 泄漏哨兵）').toEqual([]);
    } finally {
      release();
      await run.peer.stop().catch(() => undefined);
      uh.dispose();
    }
  }, 60_000);

  // ═══════════════════════════ 场景 4：reconcile 超时持续悬挂（有界环） ═══════════════════════════

  it('场景 4：周期 round 的 SYNC_APPLIED 在每个 wire 上被丢（持续故障）→ 每轮 reconcile timeout → 本端重建；15s 窗口内 dialCount 有界、attempts 单调增长至 cap → 故障源消失后自愈 live', async () => {
    const uh = collectUnhandledRejections();
    const peerRec = makeRecorder();
    const hubRec = makeRecorder();
    const run = await boot({
      peerReplica: 'same',
      timeouts: STALL_TIMEOUTS,
      backoff: RING_BACKOFF,
      random: () => 0.5,
      peerObserver: peerRec.observer,
      hubObserver: hubRec.observer,
    });
    try {
      expect(run.namespaceState()).toBe('live');
      // wire1 的周期 round 悬挂（丢 hub→peer SYNC_APPLIED）
      run.wire.dropNextHubToPeer(isSyncApplied);
      await advanceBoth(run, 200); // 周期 round 开始
      // 持续故障环：每拨出新 wire 即在握手帧流动前武装该 wire 的 SYNC_APPLIED 丢弃
      // （advanceBy 与 settle 之间——拨号后到 hub 发 SYNC_APPLIED 之间隔 ≥ 数十个微
      // 任务跃点，先于任何 settle 落位 → 确定性消费）
      let armedWires = 1;
      let advanced = 0;
      while (advanced < 15_000) {
        await run.peerNode.scheduler.advanceBy(60);
        for (let i = armedWires; i < run.wires.length; i += 1) {
          run.wires[i]!.dropNextHubToPeer(isSyncApplied);
          armedWires += 1;
        }
        await settle();
        advanced += 60;
      }
      // 环率有界：每环必须烧满 reconcileTimeoutMs + backoff；无界实现（恒速重拨）
      // 在 15s 窗内将 ≥ 30 次拨号；静态僵尸（预修复）恒 1 次
      expect(run.dialCount, '持续故障下重试环存在且率受 reconcileTimeout+backoff 界约束').toBeGreaterThanOrEqual(15);
      expect(run.dialCount, '持续故障下重拨率不得无界（backoff cap）').toBeLessThanOrEqual(27);
      const recovery = backoffsOf(peerRec.events).filter((e) => e.reason === 'namespace-recovery');
      expect(recovery.length, '每次超时重建发射 backoff-scheduled{namespace-recovery}').toBeGreaterThanOrEqual(10);
      const attempts = recovery.map((e) => e.attempt);
      expect(attempts, 'attempts 单调增长（ready 驻留 ≈ reconcileTimeoutMs < resetAfterMs）').toEqual(
        [...attempts].sort((a, b) => a - b),
      );
      expect(new Set(attempts).size, 'attempts 严格递增（无清零）').toBe(attempts.length);
      expect(recovery.slice(0, 4).map((e) => e.delayMs), 'full-jitter 公式（random=0.5）').toEqual([
        25, 50, 100, 200,
      ]);
      for (const e of recovery) {
        expect(e.delayMs, '退避延迟 ≤ cap=0.5×maxMs=200ms').toBeLessThanOrEqual(200);
      }
      const dropped = run.wires.reduce((sum, wire) => sum + wire.droppedHubToPeer.length, 0);
      expect(dropped, '每个悬挂 wire 恰一次 SYNC_APPLIED 丢弃').toBe(run.dialCount);
      // 故障源消失（停止丢帧）→ 下一环自愈 live
      let live = false;
      for (let step = 0; step < 60 && !live; step += 1) {
        await advanceBoth(run, 1_000);
        live = run.namespaceState() === 'live';
      }
      expect(live, '故障源消失后必须自愈 live').toBe(true);
      expect(run.connectionState()).toBe('ready');
      const violations = [...ac3Violations(peerRec.events), ...ac3Violations(hubRec.events)];
      expect(violations, 'AC3 违例（同一连接内终态 namespace 重开）').toEqual([]);
      await run.writeHub({ n: 43 });
      await settleUntil(() => run.rootValue('peer', 'n') === 43, '场景 4: hub→peer 收敛');
      await run.writePeer({ n: 44 });
      await settleUntil(() => run.rootValue('hub', 'n') === 44, '场景 4: peer→hub 收敛');
      expect(uh.events, '全程零 unhandled rejection').toEqual([]);
    } finally {
      await run.peer.stop().catch(() => undefined);
      uh.dispose();
    }
  }, 60_000);

  // ═══════════════════════════ 场景 5：触发面界外负控（SA2 F3） ═══════════════════════════

  it('场景 5（负控）：错误帧驱动的 failed（NOT_FOUND）在 ≥ 恢复窗口内零重建零重拨——触发面仅 timer 族', async () => {
    const uh = collectUnhandledRejections();
    const peerRec = makeRecorder();
    const run = await boot({
      hubNamespace: false,
      waitFor: 'failed',
      backoff: OPEN_BACKOFF,
      random: () => 0.5,
      peerObserver: peerRec.observer,
    });
    try {
      expect(run.namespaceState(), 'NOT_FOUND 错误帧 → failed（§16 等待重建或配置变化）').toBe('failed');
      expect(run.connectionState(), '错误帧收口不触碰连接').toBe('ready');
      const dialsAtStart = run.dialCount;
      // 推进 ≥ 恢复窗口量级虚拟时间（60s）：界外 failed 保持稳定等待
      for (let step = 0; step < 60; step += 1) {
        await advanceBoth(run, 1_000);
      }
      expect(run.wires, '错误帧驱动 failed 不得触发连接重建').toHaveLength(1);
      expect(run.dialCount, '不得重拨').toBe(dialsAtStart);
      expect(run.connectionState(), '连接保持 ready（界外稳定等待）').toBe('ready');
      expect(run.namespaceState(), 'ns 保持 failed').toBe('failed');
      expect(
        backoffsOf(peerRec.events).filter((e) => e.reason === 'namespace-recovery'),
        '不得发射 namespace-recovery 恢复事件',
      ).toHaveLength(0);
      expect(uh.events).toEqual([]);
    } finally {
      await run.peer.stop().catch(() => undefined);
      uh.dispose();
    }
  }, 60_000);
});
