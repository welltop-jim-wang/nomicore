/**
 * SA7 动态验证 —— issue #174「实现真实 GOAWAY drain 与关闭时序」SA3 修复（commit 739e1bb）。
 *
 * 覆盖 SA4 静态审核报告「动态审核重点」交 SA7 的三条无锚/弱锚风险：
 * - 重点 #2：drain 窗口内连接级 fatal——`drainDeadline` 计面回落
 *   （fake scheduler `pending()` 观测）+ close Promise 不依赖 deadline fire 正常结算
 *   （SA4 指出该守卫无现成测试锚，SA6 契约 4 it 未覆盖此变体）。
 * - 重点 #3：R4 变体——已接纳 apply 越过 drain deadline：网络域 deadline 1001 硬顶
 *   收口 transport，Runtime 域 barrier（cleanupAll → drainPendingApplies）等 apply
 *   排空后才结算 hub.close() Promise——两域独立结算时点（设计 §5 推论）。
 * - 重点 #4：drain 窗口期 `shutdownWithGoaway` 重入（二次 hub.close()）——双门防御
 *   （closedFlag || drainActive）：零二次 GOAWAY、drainTail 零覆盖、窗口不被打扰。
 *
 * 锚点（零源码 grep）：wire 帧 / transport 关闭观测（hubSideClosed / peerSideCloseInfo）/
 * 注入 scheduler 的 pending() 计面 / 持久化生效（saveEvents / rootValue）。
 * 纪律：真实 yjs / Registry / Runtime 双实例 + fake-duplex（微任务投递）+
 * fake scheduler（零 real sleep、零端口、零新依赖）。
 */
import { describe, expect, it } from 'vitest';
import { boot, collectUnhandledRejections } from './driver.js';
import { CONTRACT_TIMEOUTS, deferred, settle, settleUntil } from './harness.js';

interface ErrorProbe {
  readonly code?: string;
}

describe('SA7 issue #174：GOAWAY drain 动态验证（SA4 动态审核重点）', () => {
  it('S1：drain 窗口内连接级 fatal——drainDeadline 计面回落 + close Promise 零时间推进即结算 + 越过 deadline 残留零副作用', async () => {
    const run = await boot({ timeouts: { closeTimeoutMs: 5_000 } });
    const rejections = collectUnhandledRejections();
    try {
      expect(run.connectionState()).toBe('ready');

      // ready 态基线：fake scheduler 已武装未触发 timer 计面（含 registry 既有 timer）。
      const base = run.hubNode.scheduler.pending();
      const closePromise = run.hub.close();
      await settle();

      // 窗口开启 + deadline 武装：GOAWAY 先行、transport 未关。
      expect(run.hubFramesAll('GOAWAY')).toHaveLength(1);
      expect(run.wire.hubSideClosed).toBe(false);
      const pendingWindow = run.hubNode.scheduler.pending();
      expect(pendingWindow).toBe(base + 1); // drainDeadline 是窗口期唯一新增计面

      // 窗口内注入错序帧 → SEQUENCE_VIOLATION 连接级 fatal（hub-connection 四路径之 3）。
      run.injectPeer(
        { kind: 'UPDATE_ACK', namespaceId: run.nsId, ackedSequence: 1 },
        { sequence: run.nextPeerSeq() + 5 },
      );
      await settle();

      // fatal 收口面：显式 ERROR(SEQUENCE_VIOLATION) + transport 以 fatal close code 关闭。
      const seqErrors = run
        .hubFramesAll('ERROR')
        .filter((f) => (f.message as unknown as ErrorProbe).code === 'SEQUENCE_VIOLATION');
      expect(seqErrors.length).toBeGreaterThanOrEqual(1);
      await settleUntil(() => run.wire.hubSideClosed, 'fatal 后 hub transport 应立即关闭');
      expect(run.wire.peerSideCloseInfo?.code).toBe(1002);
      expect(run.wire.peerSideCloseInfo?.reason).toBe('protocol-error');

      // ★ 主锚 1（SA4 重点 #2）：drainDeadline 已清——计面回落（clearDrainHandles 路径 3；
      //    不清则残留计面直至 deadline fire）。
      expect(run.hubNode.scheduler.pending()).toBeLessThan(pendingWindow);

      // ★ 主锚 2：close Promise 不依赖 deadline fire——零 advanceBy 即结算
      //    （fatal → cleanupAll 尾部 finally 释放 drainDone，绝不悬挂）。
      await closePromise;

      // ★ 主锚 3：越过 deadline 大步推进——残留 timer 零副作用（帧冻结、close info 不变）。
      const framesBefore = run.frames().hubToPeer.length;
      await run.hubNode.scheduler.advanceBy(CONTRACT_TIMEOUTS.closeTimeoutMs + 1_000);
      await settle();
      expect(run.frames().hubToPeer.length).toBe(framesBefore);
      expect(run.wire.peerSideCloseInfo?.code).toBe(1002);
      expect(rejections.events).toEqual([]);
    } finally {
      rejections.dispose();
    }
  });

  it('S2：已接纳 apply 越过 drain deadline——网络域 deadline 1001 硬顶收口 transport，Runtime 域 barrier 等 apply 排空后才结算 close Promise', async () => {
    const run = await boot({ timeouts: { closeTimeoutMs: 5_000 } });
    const rejections = collectUnhandledRejections();
    try {
      const gate = deferred();
      run.hubNode.persistence.saveGate = gate;
      const savesBefore = run.saveEvents('hub');
      const acksBefore = run.hubFramesAll('UPDATE_ACK').length;

      await run.writePeer({ n: 7 });
      await settle();
      expect(run.peerFramesAll('UPDATE')).toHaveLength(1);
      // apply 已被 Runtime 接纳但在途：saveDoc 已发起（saveEvents +1，StubPersistence
      // 在 await 门闩前记账）但悬挂在 saveGate 上 → ACK 未出（§10 语义）。
      expect(run.hubFramesAll('UPDATE_ACK').length).toBe(acksBefore);
      expect(run.saveEvents('hub')).toBe(savesBefore + 1);

      const closePromise = run.hub.close();
      let closeSettled = false;
      void closePromise.then(() => {
        closeSettled = true;
      });
      await settle();

      // 窗口开启：GOAWAY 先行、transport 未关、close 未结算（R1 同款窗口锚）。
      expect(run.hubFramesAll('GOAWAY')).toHaveLength(1);
      expect(run.wire.hubSideClosed).toBe(false);
      expect(closeSettled).toBe(false);

      // deadline 到达（虚拟时间）：网络域硬顶——transport 以 1001 关闭，不等待 apply。
      await run.hubNode.scheduler.advanceBy(CONTRACT_TIMEOUTS.closeTimeoutMs);
      await settle();
      expect(run.wire.hubSideClosed).toBe(true);
      expect(run.wire.peerSideCloseInfo?.code).toBe(1001);

      // ★ Runtime 域 barrier：悬挂的 saveDoc 不因传输死亡而取消或完成（AC4 网络域
      //    硬顶不等 ACK；§21 Runtime 域排空——close Promise 等 cleanupAll 链尾的
      //    drainPendingApplies/settleClose 完成）→ 两域独立结算时点。
      expect(closeSettled).toBe(false);
      expect(run.saveEvents('hub')).toBe(savesBefore + 1); // 无第二笔 save 被发起

      // 释放门闩：悬挂的 saveDoc 穿越传输死亡后完成 → close Promise 此后才结算。
      run.hubNode.persistence.saveGate = undefined;
      gate.resolve();
      await settle();
      expect(run.rootValue('hub', 'n')).toBe(7);
      expect(run.saveEvents('hub')).toBe(savesBefore + 1); // 全程恰一笔 save（R4 同口径）
      await closePromise;
      expect(rejections.events).toEqual([]);
    } finally {
      rejections.dispose();
    }
  });

  it('S3：drain 窗口期 shutdownWithGoaway 重入（二次 hub.close）——零二次 GOAWAY、drainTail 零覆盖、两个 close Promise 同点结算', async () => {
    const run = await boot({ timeouts: { closeTimeoutMs: 5_000 } });
    const rejections = collectUnhandledRejections();
    try {
      const base = run.hubNode.scheduler.pending();
      const closePromise1 = run.hub.close();
      let settled1 = false;
      void closePromise1.then(() => {
        settled1 = true;
      });
      await settle();

      expect(run.hubFramesAll('GOAWAY')).toHaveLength(1);
      expect(run.wire.hubSideClosed).toBe(false);
      expect(run.hubNode.scheduler.pending()).toBe(base + 1);

      // 窗口期重入：HubReplicationImpl.close 幂等门 + 连接级双门（closedFlag || drainActive）。
      const closePromise2 = run.hub.close();
      await settle();

      // 重入零副作用：无二次 GOAWAY、deadline 不重复武装、drainTail 未被覆盖
      // （旧 close Promise 不悬挂：settled1 仍 false = 未被提前/异常结算）。
      expect(run.hubFramesAll('GOAWAY')).toHaveLength(1);
      expect(run.wire.hubSideClosed).toBe(false);
      expect(run.hubNode.scheduler.pending()).toBe(base + 1);
      expect(settled1).toBe(false);

      // deadline 收口：两个 close Promise 均在 drain 完成点结算。
      await run.hubNode.scheduler.advanceBy(CONTRACT_TIMEOUTS.closeTimeoutMs);
      await settle();
      expect(run.wire.hubSideClosed).toBe(true);
      expect(run.wire.peerSideCloseInfo?.code).toBe(1001);
      await closePromise1;
      await closePromise2;
      expect(rejections.events).toEqual([]);
    } finally {
      rejections.dispose();
    }
  });
});
