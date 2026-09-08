/**
 * SA6 回流红灯 —— SA4 静态验尸 F1/F2/F3（报告 `task_phase5-ws-namespace-sync_sa4_review.md`，
 * verdict: reject；该 3 条为 REJECT 依据——实现侧偏离设计定稿，须由 SA3 修复后转绿）：
 *
 *   F1（MAJOR）hub 侧溢出零 RESYNC_REQUIRED —— 恢复 round 无触发面、持续性单向发散。
 *     设计依据：§10.2 溢出动作表「发 RESYNC_REQUIRED（本端声明）」+ §18.4「hub 溢出
 *     同机制（协议 §9.4 任一端可声明）」+ 协议 §9.4——hub 侧让 peer 得知（round 恒由
 *     peer 发起）的唯一通路。SA4 执行证据：cap=1 下 hub 连写两笔 → RESYNC 0 帧、
 *     hub/peer 永久发散。
 *   F2（MAJOR）everBeenLive 豁免 open/reconcile 超时 —— 重连/恢复 round 可永久悬挂。
 *     设计依据：§5.1（opening → armed openTimeoutMs）/§16 timer 清单/§9.3 均无条件
 *     武装——无「到达过 live」豁免条款。SA4 执行证据：重连后 authorize 悬挂 →
 *     advanceMs(100×openTimeoutMs) → 仍 'opening'。
 *   F3（CRITICAL）closing 窗口 SEQUENCE_VIOLATION 宽赦 —— 序列纪律被实现侧旁路
 *     （违反 CP-1 总控裁决 ADR 0010 L147 字面；注释自认「为迁就测试 seam」）。
 *     设计依据：§4.1/§18.8「入站帧 sequence ≠ 期望值——无论 gap、repeat 或回退——
 *     一律 SEQUENCE_VIOLATION connection fatal」；§18.11 前言「不得为迁就现行断言
 *     偏离 ADR」。本 IT 配套 seam（driver inject 显式 sequence + 静默期不变量）。
 *
 * 红线纪律：真实 yjs / Registry / Runtime；fake-duplex；fake scheduler；零 real sleep；
 * 断言均为 wire 帧/状态投影/收敛数据（零源码 grep）。
 */
import { describe, expect, it } from 'vitest';
import type { ReplicationObserverEvent } from '@nomicore/ws-replication';
import { boot, advanceMs, collectUnhandledRejections } from './driver.js';
import { deferred, settle } from './harness.js';

type ChanEvent = Extract<ReplicationObserverEvent, { type: 'channel-state-changed' }>;
type BackoffEvent = Extract<ReplicationObserverEvent, { type: 'connection-backoff-scheduled' }>;

describe('SA4 回流红灯：F1 hub 溢出声明 / F2 重连超时兜底 / F3 closing 序列纪律', () => {
  it('F1：hub 侧溢出 → 发出 RESYNC_REQUIRED（send-queue-overflow）→ 同连接恢复 round → 双向收敛', async () => {
    const run = await boot({
      limits: { maxInFlightUpdates: 1, maxQueuedUpdateCount: 1 },
    });
    // 悬挂 peer 的 saveDoc：hub→peer 首笔 UPDATE 的 apply 在途、ACK 不回 → hub in-flight
    // 窗口（cap=1）不收口 —— 制造 hub 侧连通性溢出
    run.peerNode.persistence.saveGate = deferred();
    await run.writeHub({ extra: 5 }); // 首笔：发出（in-flight 1/1）
    await settle();
    expect(run.hubFrames('UPDATE')).toHaveLength(1);
    // R2-3 适配（queued limits 不得计入 in-flight——§17 分列限制）：hub 连写第二笔
    // → 入队（在途窗口满不占队列额度）；第三笔（溢出点后移一笔）触发溢出（§10.2
    // 判据）→ 设计 §10.2/§18.4：hub 发 RESYNC_REQUIRED（本端声明）。
    // 注：writeHub 的 TS 形参仅声明 n/extra，但 schema 声明 ext 字段（SCHEMA_ENVELOPE），
    // 故以类型断言传 ext——保持「第三笔为独立字段」的设计形态（hub n/extra 不受影响，
    // 下方收敛断言 n=6/extra=5 原样成立）。
    await run.writeHub({ n: 6 }); // 入队（queued 0→1；cap=1）
    await run.writeHub({ ext: 7 } as unknown as { n?: number; extra?: number }); // 队列溢出（cap=1）
    await settle();
    // ── F1 红灯锚（现实现：0 帧——hub 侧仅置状态、零 wire 信号）──
    const resyncs = run.hubFrames('RESYNC_REQUIRED');
    expect(resyncs, 'hub 侧溢出必须声明 RESYNC_REQUIRED（§10.2/§18.4）').toHaveLength(1);
    expect((resyncs[0]?.message as { reasonCode: string }).reasonCode).toBe('send-queue-overflow');
    // 释放 peer gate → 首笔 apply 的 ACK 回 → 恢复路径：peer 收 RESYNC（§10.6）→ needs-resync
    // → 自身窗口收口 → 同连接 round+1 → 双向收敛（hub 侧数据 n=6/extra=5 全量经 diff）
    const gate = run.peerNode.persistence.saveGate;
    run.peerNode.persistence.saveGate = undefined;
    if (gate !== undefined) gate.resolve();
    await run.waitPeerSent('SYNC_STEP1', 2);
    await run.waitNamespace('live');
    await settle();
    expect(
      (run.peerFrames('SYNC_STEP1')[1]?.message as { syncRoundId: number }).syncRoundId,
    ).toBe(2);
    expect(run.rootValue('hub', 'n')).toBe(6);
    expect(run.rootValue('hub', 'extra')).toBe(5);
    expect(run.rootValue('peer', 'n')).toBe(6);
    expect(run.rootValue('peer', 'extra')).toBe(5);
  });

  it('F2：live → 断线 → 重连（authorize 悬挂、OPEN_OK 不回）→ openTimeout 收口 failed（瞬态）→ 有界恢复环 → release 后恢复 live（issue #254 方向 A）', async () => {
    // 第二次及以后的 authorize 悬挂（模拟 hub 授权后端故障——重连 OPEN 永不答）
    let calls = 0;
    let release!: () => void;
    const hang = new Promise<void>((r) => {
      release = r;
    });
    const uh = collectUnhandledRejections();
    const events: ReplicationObserverEvent[] = [];
    const run = await boot({
      backoff: { baseMs: 50, maxMs: 400, resetAfterMs: 500 },
      random: () => 0.5,
      timeouts: { openTimeoutMs: 200 },
      peerObserver: (e) => events.push(e),
      authorize: async (instanceIdentity: string, namespaceId: string) => {
        calls += 1;
        if (calls >= 2) await hang;
        return {
          ok: true,
          localOwner: { userId: 'hub-owner-9f38' },
          permissions: { read: true, submit: true },
        };
      },
    });
    try {
      // 首连到 live 后断线 → backoff（0.5×50=25ms）→ 重连 → HELLO/HELLO_ACK → OPEN → 悬挂
      run.wire.closePeerSide(1006, 'network lost');
      await run.waitNamespace('disconnected');
      await advanceMs(run, 25);
      await run.waitConnection('ready');
      await run.waitNamespace('opening');
      // 越过 openTimeoutMs（§5.1/§16 无条件武装 open timer——无 everBeenLive 豁免）：
      // 收口 failed。issue #254：failed 瞬态（事件轨迹钉住），随后本端触发连接重建。
      await advanceMs(run, 200);
      const peerChans = events.filter(
        (e): e is ChanEvent => e.type === 'channel-state-changed' && e.side === 'peer',
      );
      expect(
        peerChans.some((e) => e.from === 'opening' && e.to === 'failed'),
        'open timeout 必须收口 failed（everBeenLive 无豁免；预修复实现此处恒 opening）',
      ).toBe(true);
      // 恢复环：authorize 持续悬挂 → 每 openTimeout+backoff 一轮重建；dialCount 增长
      // 但受 §15.1 backoff 界约束（预修复 = 静态僵尸零重拨；无界实现 = 恒速重连环）。
      for (let step = 0; step < 35; step += 1) {
        await advanceMs(run, 300);
      }
      expect(run.dialCount, '悬挂窗口内必须出现有界重试环（dialCount 增长）').toBeGreaterThanOrEqual(6);
      expect(run.dialCount, '重试环率受 backoff 界约束（≤ maxMs=400ms/cap 后的环率）').toBeLessThanOrEqual(30);
      const backoffs = events.filter(
        (e): e is BackoffEvent => e.type === 'connection-backoff-scheduled',
      );
      const recovery = backoffs.filter((e) => e.reason === 'namespace-recovery');
      expect(recovery.length, '每次超时重建必须发射 connection-backoff-scheduled{namespace-recovery}').toBeGreaterThanOrEqual(3);
      const attempts = recovery.map((e) => e.attempt);
      expect(attempts, '悬挂期间 attempts 单调增长（ready 驻留 < resetAfterMs → 不清零）').toEqual(
        [...attempts].sort((a, b) => a - b),
      );
      expect(new Set(attempts).size, 'attempts 严格递增（无清零）').toBe(attempts.length);
      expect(recovery[0]!.delayMs, '首个恢复退避 = 0.5×min(maxMs, base×2^1) = 50ms（random=0.5）').toBe(50);
      for (const e of recovery) {
        expect(e.delayMs, '退避延迟受 cap=0.5×maxMs=200ms 约束').toBeLessThanOrEqual(200);
      }
      expect(run.connectionState(), '悬挂期间连接不得 blocked/stopped（恢复环在 ready/backoff 间轮转）').not.toBe('blocked');
      // release → 恢复（悬挂中的 authorize 结算/下一轮 OPEN 成功）→ 回 live
      release();
      let recovered = false;
      for (let step = 0; step < 60 && !recovered; step += 1) {
        await advanceMs(run, 1_000);
        recovered = run.namespaceState() === 'live';
      }
      expect(recovered, 'release 后必须恢复 live（故障源消失 → 通道自动恢复，AC1 语义）').toBe(true);
      expect(run.connectionState()).toBe('ready');
      expect(uh.events, '全程零 unhandled rejection（AC4 泄漏哨兵）').toEqual([]);
    } finally {
      release();
      await run.peer.stop().catch(() => undefined);
      uh.dispose();
    }
  });

  it('F3：closing 窗口注入重复序列帧 → SEQUENCE_VIOLATION connection fatal → blocked（序列纪律无 closing 豁免）', async () => {
    const run = await boot({ timeouts: { closeTimeoutMs: 200 } });
    // 悬挂 hub 在途 apply → CLOSE_OK 未回 → peer 停留 closing（hub 方向静默）
    run.hubNode.persistence.saveGate = deferred();
    await run.writePeer({ n: 1 });
    await settle();
    const closePromise = run.peer.removeTarget(run.nsId);
    await run.waitNamespace('closing');
    // 注入重复序列帧（sequence=1 为 HELLO_ACK 已占用的回退序列——repeat/回退一律违例，
    // §4.1/§18.8 ADR 0010 L147 字面；显式 sequence 绕过静默期自动记账——本 IT 即 F3 旁路验证）
    run.injectHub(
      {
        kind: 'ERROR',
        code: 'NAMESPACE_STATE_VIOLATION',
        safeMessage: 'protocol namespace violation',
        namespaceId: run.nsId,
      },
      { sequence: 1 },
    );
    await settle();
    // ── F3 红灯锚（现实现：anyNamespaceClosing 宽赦 → 帧被分发、expectedSeq 被改写 → 恒 ready）──
    await run.waitConnection('blocked');
    await run.waitNamespace('disconnected');
    // 序列纪律收口后 cleanup 收尾（不因后置断言被宽赦影响）
    const gate = run.hubNode.persistence.saveGate;
    run.hubNode.persistence.saveGate = undefined;
    if (gate !== undefined) gate.resolve();
    await closePromise.catch(() => undefined);
    await settle();
  });
});
