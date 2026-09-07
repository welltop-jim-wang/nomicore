/**
 * Issue #238 分段观测 + 帧级关联的**生产 seam 红灯契约**（设计
 * wiki/raw/task_238_design_2026-09-06.md §11.2——实现前红、实现后绿；与 Owner 基线
 * repro 文件 `ws-replication-issue238-repro.test.ts` 字节不动并行）。
 *
 * 覆盖（§11.2 全项）：
 *   1. 四段分解：saveGate 构型下逐笔 stages = SA5 §5 表值（u1 dirtyNotify=5000；
 *      u2–u5 queueWait=[4000,3000,2000,1000]；protectedCheck/liveApply 恒 0）；
 *   2. 守恒：逐笔 sum(stages) === applyLatencyMs（共享手动单调时钟，逐笔精确相等）；
 *   3. sequence 关联：非合并构型逐帧 update-sent.sequence === update-applied.sequence
 *      === update-acked.sequence === wire 记账 sequence；合并构型（窗口 1 + saveGate
 *      诱发排队合并）断言一 sequence 覆盖合并帧、三事件计数一致 + sendQueueMs 差值；
 *   4. dormant 等价：无 registry stageClock → 事件无四段字段（字段缺席断言）；无
 *      observer/无 clock → wire 与观测在场构型全等（第 6 项同测）；
 *   5. clock-throw 折叠：注入 throw 时源 → 四段缺席、协议路径正常、零 unhandledRejection；
 *   6. wire 不变：observer+clock+stageClock 在场/缺席两构型的双向帧协议语义序列逐帧
 *      全等 + 控制面字节口径零扰动（Yjs 载荷含随机 doc client id——本仓库 conformance
 *      惯例以 kind#seq 语义摘要判定，观测零 wire 扰动）；
 *   7. event-loop 探针正向控制：手动时钟 + 可控 fire → event-loop-delay-sampled.delayMs
 *      === 已知漂移 Δ；无时源读数 → 零采样（dormant）；
 *   8. 槽级记账：门闩 + 一笔慢业务写（mutateData 经 gated persistence）→ 槽样本含长
 *      `S` 槽 runMs、后续 `R` 槽 waitMs 抬升、queueDepthAtStart 正确、namespaceId 已盖戳；
 *   9. 帧序列/终态零回归面由守恒 + 计数断言承载（§23.7 throw 隔离既有用例已覆盖新字段）。
 *
 * 纪律：零 real sleep（微任务泵 + deferred 门闩 + 手动时钟）；共享单调时钟同一实例
 * 注入 ws-replication clock 与 registry stageClock（D3 组装纪律——守恒成立前提）；
 * 观测数据仅差值/计数，无绝对时间戳；断言不把复现当作生产 11 秒阶段证明。
 */
import { describe, expect, it } from 'vitest';
import type {
  ReplicationClock,
  ReplicationObserverEvent,
  ReplicationTimer,
} from '@nomicore/ws-replication';
import type { NamespaceReplicationObservabilityOptions } from '@nomicore/namespace-registry';
import { bootMulti } from './issue137-driver.js';
import { collectUnhandledRejections } from './driver.js';
import { deferred, settle, settleUntil } from './harness.js';
import { decodeMessage } from '@nomicore/replication-protocol';
import { startLiveness } from '../src/liveness.js';

const STEP_MS = 1_000;
const UPDATE_COUNT = 5;

/** 手动单调时钟（注入 seam；advance 只由测试显式调用——确定性时序的唯一来源）。 */
class ManualMonotonicClock implements ReplicationClock {
  private t = 0;
  readonly now = (): number => this.t;
  advance(ms: number): void {
    this.t += ms;
  }
}

/** throw 时源（clock-throw 折叠用例：任何读数抛错——观测面故障不外溢协议路径）。 */
class ThrowingClock implements ReplicationClock {
  readonly now = (): number => {
    throw new Error('issue238-throwing-clock');
  };
}

type AppliedEvent = Extract<ReplicationObserverEvent, { type: 'update-applied' }>;
type SentEvent = Extract<ReplicationObserverEvent, { type: 'update-sent' }>;
type AckedEvent = Extract<ReplicationObserverEvent, { type: 'update-acked' }>;

describe('issue #238 segmented observation & frame correlation (production seams)', () => {
  it('四段分解 + 守恒 + sequence 关联（saveGate 构型，逐笔精确值）', async () => {
    const probe = collectUnhandledRejections();
    try {
      const clock = new ManualMonotonicClock();
      const hubEvents: ReplicationObserverEvent[] = [];
      const peerEvents: ReplicationObserverEvent[] = [];
      const registryObs: NamespaceReplicationObservabilityOptions = { stageClock: clock };
      const run = await bootMulti({
        count: 1,
        hubClock: clock,
        peerClock: clock,
        hubObserver: (event) => hubEvents.push(event),
        peerObserver: (event) => peerEvents.push(event),
        peerReplicationObservability: registryObs,
      });
      const nsId = run.nsIds[0]!;
      await settle();
      hubEvents.length = 0;
      peerEvents.length = 0;

      // saveGate：挂起 Peer 首笔 dirty notification（u1 的 R6 saveDoc 占槽）
      const gate = deferred();
      run.peerNode.persistence.saveGate = gate;
      for (let i = 0; i < UPDATE_COUNT; i += 1) {
        await run.hubWrite(nsId, { n: 20 + i });
        clock.advance(STEP_MS);
      }
      expect(
        peerEvents.filter((e) => e.type === 'update-applied' && e.namespaceId === nsId),
      ).toHaveLength(0); // 门闩释放前零 apply

      gate.resolve();
      await settleUntil(
        () =>
          peerEvents.filter((e) => e.type === 'update-applied' && e.namespaceId === nsId)
            .length === UPDATE_COUNT,
        '五笔 UPDATE 全部 apply',
      );
      await settle();

      const applied = peerEvents.filter(
        (e): e is AppliedEvent => e.type === 'update-applied' && e.namespaceId === nsId,
      );
      const sent = hubEvents.filter(
        (e): e is SentEvent => e.type === 'update-sent' && e.namespaceId === nsId,
      );
      const acked = hubEvents.filter(
        (e): e is AckedEvent => e.type === 'update-acked' && e.namespaceId === nsId,
      );

      // ── 1. 四段分解（SA5 §5 表值逐笔）：u1 = 被占槽的 dirty；u2–u5 = queue wait ──
      expect(applied.map((e) => e.queueWaitMs)).toEqual([0, 4_000, 3_000, 2_000, 1_000]);
      expect(applied.map((e) => e.protectedCheckMs)).toEqual([0, 0, 0, 0, 0]);
      expect(applied.map((e) => e.liveApplyMs)).toEqual([0, 0, 0, 0, 0]);
      expect(applied.map((e) => e.dirtyNotifyMs)).toEqual([5_000, 0, 0, 0, 0]);
      // 既有 applyLatencyMs 阶梯（Owner 基线登记值）保持
      expect(applied.map((e) => e.applyLatencyMs)).toEqual([5_000, 4_000, 3_000, 2_000, 1_000]);

      // ── 2. 守恒：逐笔 sum(stages) === applyLatencyMs（手动时钟精确相等） ──
      for (const e of applied) {
        expect(e.queueWaitMs! + e.protectedCheckMs! + e.liveApplyMs! + e.dirtyNotifyMs!).toBe(
          e.applyLatencyMs,
        );
      }

      // ── 3. sequence 关联（三事件面 + wire 逐位）：非合并构型 5 帧 5 关联 ──
      // sequence 是连接局部 outbound 计数（uint32 严格递增，协议 §3）——boot 期既有
      // UPDATE 帧占前段，本窗口 5 笔为序列尾部；关联断言用「三事件面 + wire 逐位相等」
      // 与「窗口内严格递增 + 计数一致」，不断言绝对起始值。
      const sentSequences = sent.map((e) => e.sequence);
      const appliedSequences = applied.map((e) => e.sequence);
      const ackedSequences = acked.map((e) => e.sequence);
      expect(sentSequences).toHaveLength(UPDATE_COUNT);
      expect(new Set(sentSequences).size).toBe(UPDATE_COUNT); // 严格递增不重号
      expect(appliedSequences).toEqual(sentSequences);
      expect(ackedSequences).toEqual(sentSequences);
      // wire 权威锚：hubToPeer UPDATE 帧（本窗口 = 尾部 5 帧）逐位等于事件面 sequence
      const wireUpdateSeqs = run
        .framesOf('hubToPeer', nsId)
        .filter((f) => f.message.kind === 'UPDATE')
        .map((f) => f.header.sequence)
        .slice(-UPDATE_COUNT);
      expect(wireUpdateSeqs).toEqual(sentSequences);
      const wireAckSeqs = run
        .framesOf('peerToHub', nsId)
        .filter((f) => f.message.kind === 'UPDATE_ACK')
        .map(
          (f) =>
            (
              f.message as Extract<typeof f.message, { kind: 'UPDATE_ACK' }>
            ).ackedSequence,
        )
        .slice(-UPDATE_COUNT);
      expect(wireAckSeqs).toEqual(sentSequences);
      // 直发构型 sendQueueMs = 0（deliver 与出站同栈同钟读数——发送侧无排队）
      expect(sent.map((e) => e.sendQueueMs)).toEqual([0, 0, 0, 0, 0]);

      // 契约面不受伤（Owner 基线）
      expect(run.wires).toHaveLength(1);
      expect(run.peer.getNamespaceState(nsId)).toBe('live');
      expect(
        peerEvents.filter((e) => e.type === 'namespace-error' || e.type === 'resync-required'),
      ).toHaveLength(0);
      expect(run.rootValue('peer', nsId, 'n')).toBe(24);
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });

  it('合并构型：一 sequence 覆盖合并帧；update-sent.sendQueueMs 精确差值；计数一致', async () => {
    const probe = collectUnhandledRejections();
    try {
      const clock = new ManualMonotonicClock();
      const hubEvents: ReplicationObserverEvent[] = [];
      const peerEvents: ReplicationObserverEvent[] = [];
      const registryObs: NamespaceReplicationObservabilityOptions = { stageClock: clock };
      // 窗口 1：首帧在途时后续写入排队 → ACK 后 drain 贪心合并（§5 合并策略）
      const run = await bootMulti({
        count: 1,
        limits: { maxInFlightUpdates: 1 },
        hubClock: clock,
        peerClock: clock,
        hubObserver: (event) => hubEvents.push(event),
        peerObserver: (event) => peerEvents.push(event),
        peerReplicationObservability: registryObs,
      });
      const nsId = run.nsIds[0]!;
      await settle();
      hubEvents.length = 0;
      peerEvents.length = 0;

      const gate = deferred();
      run.peerNode.persistence.saveGate = gate;
      for (let i = 0; i < UPDATE_COUNT; i += 1) {
        await run.hubWrite(nsId, { n: 20 + i });
        clock.advance(STEP_MS);
      }
      gate.resolve();
      await settleUntil(
        () =>
          peerEvents.filter((e) => e.type === 'update-applied' && e.namespaceId === nsId)
            .length === 2,
        '两帧（u1 单帧 + u2–u5 合并帧）全部 apply',
      );
      await settle();

      // wire：5 笔业务写 = 2 个 UPDATE 帧（贪心合并——关联粒度 = wire 帧）
      const wireUpdates = run
        .framesOf('hubToPeer', nsId)
        .filter((f) => f.message.kind === 'UPDATE');
      expect(wireUpdates).toHaveLength(2);
      const wireSeqs = wireUpdates.map((f) => f.header.sequence);

      const sent = hubEvents.filter(
        (e): e is SentEvent => e.type === 'update-sent' && e.namespaceId === nsId,
      );
      const applied = peerEvents.filter(
        (e): e is AppliedEvent => e.type === 'update-applied' && e.namespaceId === nsId,
      );
      const acked = hubEvents.filter(
        (e): e is AckedEvent => e.type === 'update-acked' && e.namespaceId === nsId,
      );
      expect(sent).toHaveLength(2);
      expect(applied).toHaveLength(2);
      expect(acked).toHaveLength(2);
      expect(sent.map((e) => e.sequence)).toEqual(wireSeqs);
      expect(applied.map((e) => e.sequence)).toEqual(wireSeqs);
      expect(acked.map((e) => e.sequence)).toEqual(wireSeqs);
      // 合并帧报合并后长度（既有口径）：事件 bytes === wire 帧载荷长度
      const framePayloadLengths = wireUpdates.map(
        (f) =>
          (
            f.message as Extract<typeof f.message, { kind: 'UPDATE' }>
          ).update.byteLength,
      );
      expect(sent.map((e) => e.bytes)).toEqual(framePayloadLengths);
      expect(applied.map((e) => e.bytes)).toEqual(framePayloadLengths);
      // sendQueueMs：首帧直发 = 0；合并帧 = 出队(5000) − 最旧业务项入队(1000) = 4000
      expect(sent.map((e) => e.sendQueueMs)).toEqual([0, 4_000]);
      // 合并帧 stages：全部在释放后同一时钟点执行 → 四段全 0（queueWait 从 peer
      // 接纳算起——合并帧 5000 接纳 5000 入槽）
      const merged = applied[1]!;
      expect(
        merged.queueWaitMs! +
          merged.protectedCheckMs! +
          merged.liveApplyMs! +
          merged.dirtyNotifyMs!,
      ).toBe(merged.applyLatencyMs!);
      expect(run.rootValue('peer', nsId, 'n')).toBe(24); // 五笔业务写全部收敛
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });

  it('dormant 等价：无 registry stageClock → 事件零四段字段（sequence/applyLatencyMs 在场）', async () => {
    const clock = new ManualMonotonicClock();
    const hubEvents: ReplicationObserverEvent[] = [];
    const peerEvents: ReplicationObserverEvent[] = [];
    const run = await bootMulti({
      count: 1,
      hubClock: clock,
      peerClock: clock,
      hubObserver: (event) => hubEvents.push(event),
      peerObserver: (event) => peerEvents.push(event),
    });
    const nsId = run.nsIds[0]!;
    await settle();
    hubEvents.length = 0;
    peerEvents.length = 0;
    await run.hubWrite(nsId, { n: 30 });
    await settle();

    const applied = peerEvents.filter(
      (e): e is AppliedEvent => e.type === 'update-applied' && e.namespaceId === nsId,
    );
    expect(applied.length).toBeGreaterThanOrEqual(1);
    for (const e of applied) {
      expect(e.sequence).toBeGreaterThan(0);
      expect(typeof e.applyLatencyMs).toBe('number');
      // 无 stageClock → 四段字段全部缺席（字段缺席断言，非 undefined 值）
      expect('queueWaitMs' in e).toBe(false);
      expect('protectedCheckMs' in e).toBe(false);
      expect('liveApplyMs' in e).toBe(false);
      expect('dirtyNotifyMs' in e).toBe(false);
    }
    const sync = peerEvents.filter((e) => e.type === 'sync-diff-applied');
    for (const e of sync) {
      expect('queueWaitMs' in e).toBe(false);
      expect('protectedCheckMs' in e).toBe(false);
      expect('liveApplyMs' in e).toBe(false);
      expect('dirtyNotifyMs' in e).toBe(false);
    }
  });

  it('clock-throw 折叠：throw 时源 → 四段缺席、协议路径正常、零 unhandledRejection', async () => {
    const probe = collectUnhandledRejections();
    try {
      const throwing = new ThrowingClock();
      const hubEvents: ReplicationObserverEvent[] = [];
      const peerEvents: ReplicationObserverEvent[] = [];
      const run = await bootMulti({
        count: 1,
        hubClock: throwing,
        peerClock: throwing,
        hubObserver: (event) => hubEvents.push(event),
        peerObserver: (event) => peerEvents.push(event),
        peerReplicationObservability: { stageClock: throwing },
      });
      const nsId = run.nsIds[0]!;
      await settle();
      hubEvents.length = 0;
      peerEvents.length = 0;
      for (let i = 0; i < UPDATE_COUNT; i += 1) {
        await run.hubWrite(nsId, { n: 40 + i });
      }
      await settle();

      const applied = peerEvents.filter(
        (e): e is AppliedEvent => e.type === 'update-applied' && e.namespaceId === nsId,
      );
      expect(applied).toHaveLength(UPDATE_COUNT);
      for (const e of applied) {
        expect('applyLatencyMs' in e).toBe(false); // ws clock throw → 缺面
        expect('queueWaitMs' in e).toBe(false);
        expect('protectedCheckMs' in e).toBe(false);
        expect('liveApplyMs' in e).toBe(false);
        expect('dirtyNotifyMs' in e).toBe(false);
        expect(e.sequence).toBeGreaterThan(0); // 关联键恒在场
      }
      // 协议路径正常：live + 收敛 + 无错误 + 零 unhandled
      expect(run.peer.getNamespaceState(nsId)).toBe('live');
      expect(run.rootValue('peer', nsId, 'n')).toBe(44);
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });

  it('event-loop 探针正向控制：注入已知漂移 → event-loop-delay-sampled.delayMs === Δ', () => {
    const clock = new ManualMonotonicClock();
    const samples: number[] = [];
    // 可控 fake timer：只记录回调，fire 由测试显式调用（计划 t、实际 t+Δ 的注入面）
    const timers = new Map<number, () => void>();
    let nextId = 0;
    const timer: ReplicationTimer = {
      setTimeout: (callback) => {
        const id = nextId;
        nextId += 1;
        timers.set(id, callback);
        return id;
      },
      clearTimeout: (handle) => {
        timers.delete(handle as number);
      },
    };

    const stop = startLiveness({
      timer,
      pingIntervalMs: 100,
      pongTimeoutMs: 50,
      ping: () => {
        /* 记录凭据即可——无真实 socket */
      },
      onPong: () => () => {
        /* 无 pong——不触发超时收口 */
      },
      onPongTimeout: () => {
        throw new Error('本测试不应触发 pong 超时');
      },
      delayProbe: {
        now: () => clock.now(),
        sample: (delayMs) => samples.push(delayMs),
      },
    });
    // 首 ping 计划 fire = 0 + 100 = 100；实际 fire 于 130 → 漂移 Δ=30
    clock.advance(130);
    firePingTimer(timers);
    expect(samples).toEqual([30]);
    // 第二轮：上一轮 fire 于 130 → 再武装计划 230；实际 fire 于 250 → 漂移 Δ=20
    clock.advance(120);
    firePingTimer(timers);
    expect(samples).toEqual([30, 20]);
    stop();
  });

  it('event-loop 探针 dormant：无时源读数 → 零采样（零状态零调度等价）', () => {
    const clock = new ManualMonotonicClock();
    // 阶段 1：probe.now 缺面（模拟 clock 未注入/observer 缺席——装配层不提供 delayProbe
    // 之外的等价形态：读数恒 undefined → 计划/采样全部折叠）
    const samples1: number[] = [];
    const timers1 = new Map<number, () => void>();
    let nextId1 = 0;
    const timer1: ReplicationTimer = {
      setTimeout: (callback) => {
        const id = nextId1;
        nextId1 += 1;
        timers1.set(id, callback);
        return id;
      },
      clearTimeout: (handle) => {
        timers1.delete(handle as number);
      },
    };
    const stop1 = startLiveness({
      timer: timer1,
      pingIntervalMs: 100,
      pongTimeoutMs: 50,
      ping: () => {
        /* no-op */
      },
      onPong: () => () => {
        /* no-op */
      },
      onPongTimeout: () => {
        throw new Error('本测试不应触发 pong 超时');
      },
      delayProbe: {
        now: () => undefined,
        sample: (delayMs) => samples1.push(delayMs),
      },
    });
    clock.advance(200); // 大漂移注入——缺面时零采样
    firePingTimer(timers1);
    expect(samples1).toEqual([]);
    stop1();

    // 阶段 2（同一手动钟续跑）：时源恢复读数 → 恢复采样
    const samples2: number[] = [];
    const timers2 = new Map<number, () => void>();
    let nextId2 = 0;
    const timer2: ReplicationTimer = {
      setTimeout: (callback) => {
        const id = nextId2;
        nextId2 += 1;
        timers2.set(id, callback);
        return id;
      },
      clearTimeout: (handle) => {
        timers2.delete(handle as number);
      },
    };
    const stop2 = startLiveness({
      timer: timer2,
      pingIntervalMs: 100,
      pongTimeoutMs: 50,
      ping: () => {
        /* no-op */
      },
      onPong: () => () => {
        /* no-op */
      },
      onPongTimeout: () => {
        throw new Error('本测试不应触发 pong 超时');
      },
      delayProbe: {
        now: () => clock.now(),
        sample: (delayMs) => samples2.push(delayMs),
      },
    });
    clock.advance(130); // 阶段 2 武装于 clock=200 → 计划 300；fire 于 330 → Δ=30
    firePingTimer(timers2);
    expect(samples2).toEqual([30]);
    stop2();
  });

  it('槽级记账：慢 S 槽 runMs + 后续 R 槽 waitMs/queueDepthAtStart/namespaceId 盖戳', async () => {
    const probe = collectUnhandledRejections();
    try {
      const clock = new ManualMonotonicClock();
      const hubEvents: ReplicationObserverEvent[] = [];
      const peerEvents: ReplicationObserverEvent[] = [];
      const slotSamples: Array<{
        readonly namespaceId: string;
        readonly slotKind: string;
        readonly waitMs?: number;
        readonly runMs: number;
        readonly queueDepthAtStart: number;
      }> = [];
      const run = await bootMulti({
        count: 1,
        hubClock: clock,
        peerClock: clock,
        hubObserver: (event) => hubEvents.push(event),
        peerObserver: (event) => peerEvents.push(event),
        peerReplicationObservability: {
          stageClock: clock,
          slotMetrics: (sample) => slotSamples.push(sample),
        },
      });
      const nsId = run.nsIds[0]!;
      await settle();
      hubEvents.length = 0;
      peerEvents.length = 0;
      slotSamples.length = 0; // 只观察「慢业务写 + R apply」窗口

      // 一笔慢业务写（peer mutateData S-slot 被 saveGate 门闩悬挂）
      const gate = deferred();
      run.peerNode.persistence.saveGate = gate;
      const slowWrite = run.peerWrite(nsId, { n: 60 }); // 不 await——槽未释放
      await settle();
      clock.advance(STEP_MS); // t=1000：S 槽仍被挂起
      await run.hubWrite(nsId, { n: 61 }); // R1 入队（admission @1000）
      clock.advance(STEP_MS); // t=2000
      await run.hubWrite(nsId, { n: 62 }); // R2 入队（admission @2000）
      gate.resolve(); // 释放：S settle → R1 → R2 依 FIFO 排空（手动钟静止于 2000）
      await slowWrite;
      await settleUntil(
        () =>
          peerEvents.filter((e) => e.type === 'update-applied' && e.namespaceId === nsId)
            .length === 2,
        '两笔 R apply 完成',
      );
      await settle();

      // namespaceId 盖戳 + 形状
      for (const s of slotSamples) {
        expect(s.namespaceId).toBe(nsId);
      }
      const sSample = slotSamples.filter((s) => s.slotKind === 'S');
      expect(sSample).toHaveLength(1);
      expect(sSample[0]).toMatchObject({ waitMs: 0, runMs: 2_000, queueDepthAtStart: 1 });
      const rSamples = slotSamples.filter((s) => s.slotKind === 'R');
      expect(rSamples).toHaveLength(2);
      // R1：admission@1000 → slotStart@2000（waitMs=1000）；开跑时队列 = R1+R2（深度 2）
      expect(rSamples[0]).toMatchObject({ waitMs: 1_000, queueDepthAtStart: 2 });
      // R2：admission@2000 → slotStart@2000（waitMs=0）；开跑时队列仅剩自身（深度 1）
      expect(rSamples[1]).toMatchObject({ waitMs: 0, queueDepthAtStart: 1 });
      // 事件面交叉验证：R1 的 queueWaitMs 与槽样本一致
      const applied = peerEvents.filter(
        (e): e is AppliedEvent => e.type === 'update-applied' && e.namespaceId === nsId,
      );
      expect(applied.map((e) => e.queueWaitMs)).toEqual([1_000, 0]);
      expect(run.rootValue('peer', nsId, 'n')).toBe(62);
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });

  it('wire 不变（observer+clock+stageClock 在场/缺席两构型）：帧协议语义序列逐帧全等 + 字节口径零扰动', async () => {
    // 本仓库 conformance 纪律（observer-red T8 同款注记）：Yjs update 载荷含随机 doc
    // client id——不可跨运行逐字节比；wire 不变性的判定 = 帧 kind#seq 语义序列逐帧
    // 全等 + 帧计数一致 + 每帧字节长度一致（观测注入零增删/零重排/零载荷口径扰动）。
    const summarize = (frames: readonly Uint8Array[]): string[] =>
      frames.map((bytes) => {
        const decoded = decodeMessage(bytes);
        return `${decoded.message.kind}#${decoded.header.sequence}`;
      });
    // 无 Yjs 载荷的帧（纯控制/固定形状）字节长度跨运行确定（Yjs 载荷帧因随机 doc
    // client id 长度可能漂移——语义序列已覆盖其存在性/序；长度口径零扰动用无载荷帧证明）
    const CONTROL_PAYLOAD_KINDS = new Set([
      'UPDATE',
      'SYNC_STEP1',
      'SYNC_STEP2',
      'BOOTSTRAP_SNAPSHOT',
    ]);
    const controlBytesLengths = (frames: readonly Uint8Array[]): number[] =>
      frames
        .filter((bytes) => !CONTROL_PAYLOAD_KINDS.has(decodeMessage(bytes).message.kind))
        .map((bytes) => bytes.byteLength);

    // 构型 A：无 observer、无 clock、无 stageClock（生产缺省）
    const runA = await bootMulti({ count: 1 });
    const nsIdA = runA.nsIds[0]!;
    await runA.hubWrite(nsIdA, { n: 70 });
    await settle();
    await runA.hubWrite(nsIdA, { n: 71 });
    await settle();
    await runA.hubWrite(nsIdA, { n: 72 });
    await settle();
    const aHubToPeer = runA.wire().hubToPeer;
    const aPeerToHub = runA.wire().peerToHub;

    // 构型 B：observer + clock + stageClock 全在场
    const clock = new ManualMonotonicClock();
    const runB = await bootMulti({
      count: 1,
      hubClock: clock,
      peerClock: clock,
      hubObserver: () => {
        /* 收集面非必需——只验证 wire 零扰动 */
      },
      peerObserver: () => {
        /* 同上 */
      },
      peerReplicationObservability: { stageClock: clock },
    });
    const nsIdB = runB.nsIds[0]!;
    await runB.hubWrite(nsIdB, { n: 70 });
    await settle();
    await runB.hubWrite(nsIdB, { n: 71 });
    await settle();
    await runB.hubWrite(nsIdB, { n: 72 });
    await settle();
    const bHubToPeer = runB.wire().hubToPeer;
    const bPeerToHub = runB.wire().peerToHub;

    // 帧语义序列全等（观测注入不增删/重排任何帧——双向逐帧 kind#seq）
    expect(summarize(bHubToPeer)).toEqual(summarize(aHubToPeer));
    expect(summarize(bPeerToHub)).toEqual(summarize(aPeerToHub));
    // 帧计数一致（观测零额外 wire 流量）
    expect(bHubToPeer.length).toBe(aHubToPeer.length);
    expect(bPeerToHub.length).toBe(aPeerToHub.length);
    // 无 Yjs 载荷帧的字节长度一致（控制面字节口径零扰动）
    expect(controlBytesLengths(bHubToPeer)).toEqual(controlBytesLengths(aHubToPeer));
    expect(controlBytesLengths(bPeerToHub)).toEqual(controlBytesLengths(aPeerToHub));
  });
});

/**
 * 从可控 fake timer 显式 fire **最新武装的 ping** 回调（正向控制：fire 时序全由测试
 * 决定——计划 fire 之后、实际 fire 由本调用点时刻表达；pong 超时 timer 永不触发）。
 * loop 内武装顺序 = pong 先、ping 后 → 最新键即 ping。
 */
function firePingTimer(timers: Map<number, () => void>): void {
  const last = [...timers.keys()].at(-1);
  if (last === undefined) throw new Error('timer 未武装');
  const cb = timers.get(last);
  if (cb === undefined) throw new Error('timer 未武装');
  cb();
}
