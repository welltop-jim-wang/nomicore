/**
 * Issue #238 确定性复现（Owner 评论 IC_kwDOT8JVvs8AAAABS2CyWg 基线的本 worktree 移植）
 * —— Hub→Peer 小 UPDATE 在 Peer 同 namespace write sequencer 被慢 dirty notification
 * 占槽时呈阶梯式 applyLatencyMs 累积；连接恒 live、无重连、无 namespace error。
 *
 * 构型（与 Owner 基线一致，逐要素保留）：
 * - 真实 NamespaceRuntime + ReplicationSession（Registry for-testing，非 mock 被测对象）；
 * - 内存 fake-duplex Hub/Peer（一 WS message = 一 frame，微任务投递，零 real sleep）；
 * - Peer persistence `saveGate` 单次门闩挂起首笔 dirty notification（「槽被慢 dirty
 *   占据」的确定性时序锚——ADR-0008 L51 槽序的字面行为）；
 * - 注入共享单调手动时钟（`issue137-driver.ts` 可选 clock 注入，协议 §23.4 纪律：
 *   仅作差、无绝对时间戳出站），每笔发送后推进 1000ms；
 * - Hub 连续五笔小 UPDATE（`n` 单字段业务写 → 37B 级增量）。
 *
 * 预期（Owner 基线登记值）：门闩释放后
 *   Peer applyLatencyMs = [5000, 4000, 3000, 2000, 1000]
 *
 * 本文件在此之上增加**分段观测验证**（Issue #238 Required feedback loop §4–§6）：
 * 用既有 seam（observer 事件差值字段 + wire envelope sequence + persistence
 * saveDoc 入/出时刻）把每笔 latency 分解为
 *   sequencer queue wait ／ protected check + live apply ／ dirty notification
 * 三段并断言守恒——证明阶梯由 queue wait（排在被占槽之后）构成，被占槽由慢 dirty
 * notification 构成；同时验证 sent/applied/acked 可按 wire sequence 可靠关联
 * （UPDATE envelope header.sequence ↔ UPDATE_ACK.ackedSequence），不依赖时间或
 * byte length 猜测。
 *
 * 观测覆盖矩阵（Owner 四段 + 关联 ID）：
 *   - sequencer queue wait —— 直接观测：u2–u5 为 [4000,3000,2000,1000]（非零）；
 *   - dirty notification —— 直接观测：u1 为 5000（saveDoc 入/出戳 + 门闩持有）；
 *   - protected check + live apply —— 独立计段并守恒断言；本构型小 update 恒 0
 *     （该段非零时长须真实执行成本或生产时源，非门闩可注入——见下边界 1）；
 *   - event-loop stall —— 本 harness（fake duplex + 微任务泵 + 手动时钟）结构性
 *     排除同步阻塞；该段只能在生产观测面经 H1 探针（timer 漂移等）判别，设计输入；
 *   - sent/applied/acked 关联 —— wire sequence（帧级）逐位配对；事件面 `sequence`
 *     字段已随本 issue 的 §23 append-only 扩展落地（生产 seam 断言见
 *     `ws-replication-issue238-segmented-observation.test.ts`）。
 * 边界声明（与 SA5 分析 §11 一致）：
 *   1) 门闩悬挂是「慢 dirty notification」的确定性替身，不是真实执行成本测量；
 *      本复现证明排队机制与观测方法，不构成生产 11 秒占槽阶段的证明；
 *   2) 零 real sleep、注入单调时钟（仅作差、无绝对时间戳出站，协议 §23.4）。
 *
 * 纪律：零源码 grep 断言；零 real sleep；观测数据不含 Yjs bytes/内容/token/owner/绝对时间戳。
 */
import { describe, expect, it } from 'vitest';
import type { DocHandle } from '@nomicore/persistence';
import type { ReplicationClock, ReplicationObserverEvent } from '@nomicore/ws-replication';
import { bootMulti } from './issue137-driver.js';
import { collectUnhandledRejections } from './driver.js';
import { deferred, settle, settleUntil } from './harness.js';

const UPDATE_COUNT = 5;
const STEP_MS = 1_000;

/** 手动单调时钟（注入 seam；advance 只由测试显式调用——确定性时序的唯一来源）。 */
class ManualMonotonicClock implements ReplicationClock {
  private t = 0;
  readonly now = (): number => this.t;
  advance(ms: number): void {
    this.t += ms;
  }
  get current(): number {
    return this.t;
  }
}

/** 带时钟戳的事件记录（observer 回调同步——戳即事件发射时刻的时钟读数）。 */
interface Stamped<E> {
  readonly event: E;
  readonly at: number;
}

/** persistence.saveDoc 入/出时刻（dirty notification 段的直接观测；exitedAt=-1 = 仍挂起）。 */
interface SaveStamp {
  readonly seq: number;
  readonly enteredAt: number;
  exitedAt: number;
}

describe('issue #238 repro: Hub→Peer UPDATE apply 阶梯排队（慢 dirty notification 占槽）', () => {
  it('五笔小 UPDATE 排队于被占 sequencer 槽后，applyLatencyMs 呈 [5000,4000,3000,2000,1000] 阶梯', async () => {
    const probe = collectUnhandledRejections();
    try {
      // ── 装配：共享单调时钟 + 双侧 observer + 真实 Registry 双节点 ──────────
      const clock = new ManualMonotonicClock();
      const hubEvents: Stamped<ReplicationObserverEvent>[] = [];
      const peerEvents: Stamped<ReplicationObserverEvent>[] = [];
      const run = await bootMulti({
        count: 1,
        hubClock: clock,
        peerClock: clock,
        hubObserver: (event) => hubEvents.push({ event, at: clock.current }),
        peerObserver: (event) => peerEvents.push({ event, at: clock.current }),
      });
      const nsId = run.nsIds[0]!;
      await settle();
      hubEvents.length = 0;
      peerEvents.length = 0;

      // ── 观测探针：persistence.saveDoc 入/出包覆（仅记录时钟差，零行为改变） ──
      // 入槽即记录 enteredAt（挂起中的 saveDoc 也可观测）；完成时回填 exitedAt。
      const saveStamps: SaveStamp[] = [];
      const persistence = run.peerNode.persistence;
      const originalSaveDoc = persistence.saveDoc.bind(persistence);
      let saveSeq = 0;
      persistence.saveDoc = async (handle: DocHandle): Promise<void> => {
        saveSeq += 1;
        const stamp: SaveStamp = { seq: saveSeq, enteredAt: clock.current, exitedAt: -1 };
        saveStamps.push(stamp);
        try {
          await originalSaveDoc(handle);
        } finally {
          stamp.exitedAt = clock.current;
        }
      };

      // ── 挂起 Peer 首笔 dirty notification（同一 namespace write sequencer 槽） ──
      const gate = deferred();
      persistence.saveGate = gate;

      // ── Hub 连续五笔小 UPDATE；每笔后推进 1000ms（u_i 接纳于 i*1000） ────────
      for (let i = 0; i < UPDATE_COUNT; i += 1) {
        await run.hubWrite(nsId, { n: 20 + i });
        clock.advance(STEP_MS);
      }
      const holdMs = UPDATE_COUNT * STEP_MS; // 5000

      // 门闩释放前排队的五笔均已接纳（apply admission）且未完成：
      const appliedBeforeRelease = peerEvents.filter((s) => s.event.type === 'update-applied');
      expect(appliedBeforeRelease).toHaveLength(0);
      expect(saveStamps).toHaveLength(1); // 仅 u1 的 R6 saveDoc 已入槽并挂起
      expect(saveStamps[0]!.enteredAt).toBe(0);
      expect(saveStamps[0]!.exitedAt).toBe(-1); // 仍挂起（dirty 未登记完成）

      // ── 释放门闩：五笔 apply 依 FIFO 排空，全部完成于时钟 5000 ────────────────
      gate.resolve();
      await settleUntil(
        () => peerEvents.filter((s) => s.event.type === 'update-applied').length === UPDATE_COUNT,
        `五笔 UPDATE 全部 apply（当前 ${peerEvents.filter((s) => s.event.type === 'update-applied').length}）`,
      );
      await settle(); // 排空 ACK 帧 + hub 侧 update-acked

      // ── 核心症状：阶梯 applyLatencyMs（Owner 基线登记值） ─────────────────────
      const applied = peerEvents.filter(
        (s): s is Stamped<Extract<ReplicationObserverEvent, { type: 'update-applied' }>> =>
          s.event.type === 'update-applied' && s.event.namespaceId === nsId,
      );
      expect(applied).toHaveLength(UPDATE_COUNT);
      expect(applied.map((s) => s.event.applyLatencyMs)).toEqual([
        5_000, 4_000, 3_000, 2_000, 1_000,
      ]);

      // ── 契约面不受伤（Issue 正文「无 reconnect / 无 namespace error」） ────────
      expect(run.wires).toHaveLength(1); // 始终一条连接（dial 仅一次）
      expect(run.connectionState()).toBe('ready');
      expect(run.peer.getNamespaceState(nsId)).toBe('live');
      for (const events of [hubEvents, peerEvents]) {
        expect(events.filter((s) => s.event.type === 'namespace-error')).toHaveLength(0);
        expect(events.filter((s) => s.event.type === 'resync-required')).toHaveLength(0);
        // 事件面零连接状态迁移（事件数组在 boot 后已清空——本段断言覆盖整个
        //「五笔写 + 门闩持有 + 排空」窗口；wires.length===1 钉死 dial 仅一次）。
        expect(events.filter((s) => s.event.type === 'connection-state-changed')).toHaveLength(0);
      }
      expect(run.rootValue('peer', nsId, 'n')).toBe(24); // 数据最终一致
      expect(probe.events).toEqual([]); // 零 unhandled rejection

      // ── ACK 侧对称证据：hub update-acked 同阶梯，五笔全部 ACK ─────────────────
      const acked = hubEvents.filter(
        (s): s is Stamped<Extract<ReplicationObserverEvent, { type: 'update-acked' }>> =>
          s.event.type === 'update-acked' && s.event.namespaceId === nsId,
      );
      expect(acked).toHaveLength(UPDATE_COUNT);
      expect(acked.map((s) => s.event.ackLatencyMs)).toEqual([5_000, 4_000, 3_000, 2_000, 1_000]);

      // ── sent/applied/acked 跨阶段关联：wire sequence（非时间/字节猜测） ────────
      const sentFrames = run
        .framesOf('hubToPeer', nsId)
        .filter((f) => f.message.kind === 'UPDATE');
      const ackFrames = run
        .framesOf('peerToHub', nsId)
        .filter((f) => f.message.kind === 'UPDATE_ACK');
      expect(sentFrames).toHaveLength(UPDATE_COUNT);
      expect(ackFrames).toHaveLength(UPDATE_COUNT);
      const sentSequences = sentFrames.map((f) => f.header.sequence);
      const ackedSequences = ackFrames.map(
        (f) => (f.message as Extract<typeof f.message, { kind: 'UPDATE_ACK' }>).ackedSequence,
      );
      expect(new Set(sentSequences).size).toBe(UPDATE_COUNT); // 严格递增不重号
      expect(ackedSequences).toEqual(sentSequences); // 每笔 ACK 恰指其 UPDATE sequence
      // 关联出的跨侧时间线：sent@i*1000 → applied@5000 → acked@5000（共享单调域）
      const sent = hubEvents.filter(
        (s): s is Stamped<Extract<ReplicationObserverEvent, { type: 'update-sent' }>> =>
          s.event.type === 'update-sent' && s.event.namespaceId === nsId,
      );
      expect(sent.map((s) => s.at)).toEqual([0, 1_000, 2_000, 3_000, 4_000]);
      expect(applied.map((s) => s.at)).toEqual([5_000, 5_000, 5_000, 5_000, 5_000]);

      // ── 分段分解：queue wait / protected check+live apply / dirty notification ──
      // admission_i = completion_i − applyLatencyMs_i（既有差值字段反推，零新面）；
      // slotStart_1 = admission_1（空序器即时入槽）；slotStart_k = saveOut_{k−1}
      //（FIFO：前槽 dirty 结束即后槽开始，手动时钟同读数）。
      expect(saveStamps).toHaveLength(UPDATE_COUNT); // 每笔 apply 恰一次 saveDoc
      const timeline = applied.map((s, i) => {
        const latency = s.event.applyLatencyMs!;
        const admission = s.at - latency;
        const save = saveStamps[i]!;
        const slotStart = i === 0 ? admission : saveStamps[i - 1]!.exitedAt;
        const queueWait = slotStart - admission;
        const checkAndApply = save.enteredAt - slotStart;
        const dirty = save.exitedAt - save.enteredAt;
        return { admission, latency, queueWait, checkAndApply, dirty };
      });
      // 守恒：三段之和恰等于 applyLatencyMs（分解无遗漏、无重复计）
      for (const t of timeline) {
        expect(t.queueWait + t.checkAndApply + t.dirty).toBe(t.latency);
      }
      // 跨侧逐笔时间线对齐（共享单调域）：每笔 UPDATE 恰在其发送 tick 被 peer 接纳
      // ——sent_i@i·1000 → admitted_i@i·1000 → applied@5000 → acked@5000，逐笔唯一配对。
      expect(timeline.map((t) => t.admission)).toEqual([0, 1_000, 2_000, 3_000, 4_000]);
      // 归因：u1 的槽由 dirty notification 独占（挂起 5000ms）；u2–u5 的延迟全部
      // 是排在被占槽后的 queue wait；protected check + live apply 段为 0（小 update）。
      expect(timeline.map((t) => t.dirty)).toEqual([5_000, 0, 0, 0, 0]);
      expect(timeline.map((t) => t.queueWait)).toEqual([0, 4_000, 3_000, 2_000, 1_000]);
      expect(timeline.map((t) => t.checkAndApply)).toEqual([0, 0, 0, 0, 0]);
      expect(holdMs).toBe(5_000);
    } finally {
      probe.dispose();
    }
  });
});
