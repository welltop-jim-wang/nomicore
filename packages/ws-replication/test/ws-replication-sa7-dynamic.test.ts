/**
 * SA7 动态验证补充测试 —— issue #136 切片 6（Phase 3 动态验证轮）。
 *
 * 锚定 SA4 静态验尸 R2 报告「动态审核重点」清单（`task_phase5-ws-namespace-sync_sa4_review.md`）：
 *
 *   #3 hub watchdog 空闲节奏（§12 timer 面 / §16 timer 清单末行）——冻结测试从不推进
 *      hub scheduler（P-2：`advanceMs` 只推进 peer 侧），hub 侧 fence/session 溢出
 *      空闲探测的**生产定时器路径**（startIdle 武装 / 每 ackTimeoutMs 探测 / 重武装 /
 *      teardown 解除）此前零覆盖。本文件以手动推进 hub scheduler 的专测覆盖：
 *      - 「武装」：live 空闲期 hub scheduler 恒有武装的 idle 探测 timer；
 *      - 「节奏」：探测恰在 ackTimeoutMs 整数倍边界 fire（边界 −1 不 fire）；
 *      - 「重武装」：第一次探测（健康、无动作）后 timer 重新武装——第二次边界仍 fire；
 *      - 「边沿 + teardown」：fence 命中恰 1 帧 IDENTITY_CHANGED（sticky 谓词电平
 *        恒真下不重复动作），通道收口后探测 timer 解除（后续推进零新帧）；
 *      - 「微任务节奏隔离」：deep-drain 耗尽有界微任务链后，bump（无通道事件）
 *        不经 busy 节奏检出（对照断言零帧）——检测**只能**由 timer 节奏完成。
 *
 *      ⚠ W1 现为 **SA7 D1 红灯锚**（2026-08-30 动态验证发现，实现未修、预期红）：
 *      `src/fence-watchdog.ts` `startIdle()` 的到期回调只清 `idleHandle` 未清
 *      `idleArmed`，回调内递归 `startIdle()` 被 `if (this.idleArmed) return` 守卫
 *      挡死——idle 探测**一次性**（首探测后节奏死亡）。执行证据：首探测后 hub
 *      scheduler pending 2→0；空闲期 bump 后推进至 2×/5× ackTimeoutMs，
 *      IDENTITY_CHANGED 恒 0、peer 投影恒 live（在作废谱系上无限运行）。违反设计
 *      §16「每 ackTimeoutMs 探测 + 重武装」/§12「生产空闲期由该节奏覆盖」；同文件
 *      双侧对称（peer 侧同缺陷）。SA3 修复（回调内先置 `idleArmed = false` 再
 *      `startIdle()`，或改周期性重武装）后本 it 转绿。
 *
 *   #1（降级建议项的 hub 侧补面）SA4 F1 修复的 hub 侧溢出第二检测面——
 *      `onWatchdogEdge('needsResync')`（§12 session 层 fanout 溢出 sticky 边沿，
 *      R3 ③ 只覆盖 peer 侧）：hub 本地 20 笔连发 → hub session fanout 容量 16 溢出
 *      → watchdog 边沿 → `declareHubResync`（R4.2「hub 命中 = 声明 + 等待」）→
 *      peer §10.6 收 RESYNC_REQUIRED → 同连接 roundId+1 恢复 → 双向收敛。
 *
 *   #5 GOAWAY 接收（R-12 本切片已实现面）——设计 §4.3：SERVER_RESTARTING →
 *      drainTimeoutMs deadline 后 close(1001) → 临时失败 → backoff → 重连 → live；
 *      SERVER_SHUTTING_DOWN/REAUTH_REQUIRED → blocked。「drain 期停新 OPEN/round」
 *      未实现（登记 R-12 → 切片 9），本测试只锚定已实现面（deadline 关闭 + 分类 +
 *      backoff 重连全链路），不对其未实现部分做断言。
 *
 * 红线纪律：真实 yjs / Registry / Runtime；fake-duplex（微任务投递）；fake scheduler
 *（hub/peer 两侧独立，本文件手动推进 hub 侧）；零 real sleep；断言均为 wire 帧 /
 * 状态投影 / 收敛数据 / 注入 scheduler 的 pending 计面（零源码 grep）。
 *
 * harness 保真度注记（GOAWAY 用例）：makeEnd 的 close() 只通知对端 closeListeners，
 * 不自通知——真实 WS 在本地主动 close() 后同样会收到本地 close 事件；harness 的
 * `closePeerSide` 即该语义的既有载体（AC6 断线锚同款）。GOAWAY deadline 关闭由
 * 生产代码调用自身 transport.close(1001)，本地事件以 closePeerSide(1001) 同模交付。
 */
import { describe, expect, it } from 'vitest';
import { boot, advanceMs, collectUnhandledRejections, type Run } from './driver.js';
import { deferred, HUB_OWNER, settle } from './harness.js';

/** 手动推进 hub 侧虚拟时钟（P-2 缺口补面：advanceMs 只推进 peer scheduler）。 */
async function advanceHubMs(run: Run, ms: number): Promise<void> {
  await run.hubNode.scheduler.advanceBy(ms);
  await settle();
}

/** 深排空：耗尽 watchdog 有界微任务链（预算 4096 让步，§12）——隔离 busy 节奏。 */
async function deepDrain(budget = 5_000): Promise<void> {
  for (let index = 0; index < budget; index += 1) {
    await Promise.resolve();
  }
}

describe('SA7 动态验证：hub watchdog 空闲节奏（SA4 #3）/ hub needsResync 边沿（#1 补面）/ GOAWAY 接收（#5）', () => {
  it('W1：hub watchdog 空闲节奏——armed @ackTimeoutMs、重武装、bump 后经 timer 节奏检出 fence（busy 节奏已隔离）', async () => {
    const probe = collectUnhandledRejections();
    try {
      const run = await boot({ timeouts: { ackTimeoutMs: 10_000 } });
      expect(run.namespaceState()).toBe('live');

      // 「武装」：live 空闲期 hub scheduler 至少有 1 个武装 timer（idle 探测；registry
      // 可能另有空闲回收类 timer，故只做下界 + 后续相对递减断言，不锁内部清单）。
      const pendingArmed0 = run.hubNode.scheduler.pending();
      expect(pendingArmed0).toBeGreaterThanOrEqual(1);

      // 隔离 busy 节奏：耗尽有界微任务链（链预算 4096 < 5_000）。
      await deepDrain();

      // 第一次探测：恰在 ackTimeoutMs 边界 fire——健康 session（谓词 false）零动作。
      // 缺陷签名（SA7 D1，2026-08-30 实测）：本探测后 scheduler.pending() 由 2 跌至 0
      // ——idle timer 未重武装（§16「每 ackTimeoutMs 探测 + 重武装」被违反），后续
      // 边界探测不再存在；修复合入后此处 pending 应回到武装下界。
      await advanceHubMs(run, 10_000);
      expect(run.hubFramesAll('IDENTITY_CHANGED')).toHaveLength(0);
      expect(run.hubFramesAll('RESYNC_REQUIRED')).toHaveLength(0);
      expect(run.hubFramesAll('ERROR')).toHaveLength(0);

      // 再次隔离（第一次探测的 onEvent 会重启微任务链）。
      await deepDrain();

      // 空闲期 bump（无通道事件：bump 字节不经 subscribeOwnedUpdates，§12 问题一）。
      await run.bumpHubEpoch();

      // 对照：busy 节奏已死——若微任务链仍在探测，8 让步节奏内即会检出 fence。
      await settle();
      expect(run.hubFramesAll('IDENTITY_CHANGED')).toHaveLength(0);

      // 「节奏」：第二次探测边界（2×ackTimeoutMs）前 1ms 不 fire。
      await advanceHubMs(run, 9_999);
      expect(run.hubFramesAll('IDENTITY_CHANGED')).toHaveLength(0);

      // ── SA7 D1 红灯锚（现实现：idle timer 未重武装 → 第二次边界探测不存在）──
      // 边界到达：timer 节奏检出 fence 边沿 → §12.2 one-shot 终结器（恰 1 帧）。
      await advanceHubMs(run, 1);
      const identityFrames = run.hubFramesAll('IDENTITY_CHANGED');
      expect(
        identityFrames,
        'idle 探测必须重武装：第二个 ackTimeoutMs 边界仍须探测（§16「每 ackTimeoutMs 探测 + 重武装」）',
      ).toHaveLength(1);
      expect((identityFrames[0]?.message as { replicationEpoch: number }).replicationEpoch).toBe(2);
      await run.waitNamespace('conflicted');

      // 「边沿记忆 + teardown」：sticky 谓词电平恒真下不重复动作；通道收口解除探测
      // timer（武装计面严格递减），后续大量推进零新帧。
      const pendingAfterFence = run.hubNode.scheduler.pending();
      expect(pendingAfterFence).toBeLessThan(pendingArmed0);
      await advanceHubMs(run, 30_000);
      expect(run.hubFramesAll('IDENTITY_CHANGED')).toHaveLength(1);
      expect(run.hubFramesAll('ERROR')).toHaveLength(0);
      expect(run.namespaceState()).toBe('conflicted');
      await settle();
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });

  it('W2：hub 侧 session fanout 溢出 → watchdog needsResync 边沿 → hub 声明 RESYNC_REQUIRED → peer 同连接 round+1 → 双向收敛', async () => {
    const probe = collectUnhandledRejections();
    try {
      const run = await boot();
      // hub 20 笔连发（单业务 lease、并发提交——sequencer 槽串行、fanout 泵每投递
      // 让步 20 → 容量 16 溢出：≥17 笔投递被弃 + session.status.needsResync（sticky）
      // → hub watchdog 边沿（§12 R4.2：hub 命中 = 声明 + 等待）
      const result = await run.hubNode.registry.open(HUB_OWNER, run.nsId);
      const opened = result as { ok?: boolean; lease?: unknown };
      if (!opened.ok || opened.lease === undefined) throw new Error('hub 业务 lease 开失败');
      const lease = opened.lease as {
        mutateData(input: unknown): Promise<{ ok: boolean }>;
        release(): Promise<void>;
      };
      const writes = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          lease.mutateData({ op: 'set', path: ['n'], value: i + 1 }),
        ),
      );
      for (const w of writes) {
        if (!w.ok) throw new Error('hub 业务写失败');
      }
      await lease.release();
      await settle();

      // hub 声明恰 1 帧（declareHubResync 记忆化：一次/恢复周期）——这是 peer 得以
      // 发起恢复 round 的唯一通路（协议 §9.4「任一端可声明」；round 恒由 peer 发起）。
      await run.waitHubSent('RESYNC_REQUIRED', 1);
      const resyncs = run.hubFrames('RESYNC_REQUIRED');
      expect(resyncs).toHaveLength(1);
      expect((resyncs[0]?.message as { reasonCode: string }).reasonCode).toBe('send-queue-overflow');

      // peer 收 RESYNC（§10.6）→ needs-resync → 窗口收口 → 同连接 roundId+1 → 收敛
      await run.waitPeerSent('SYNC_STEP1', 2);
      await run.waitNamespace('live');
      expect(run.peerFrames('SYNC_STEP1')).toHaveLength(2);
      expect(
        (run.peerFrames('SYNC_STEP1')[1]?.message as { syncRoundId: number }).syncRoundId,
      ).toBe(2);
      // 溢出丢弃的投递未走 UPDATE 通道（数量 < 20），全部增量由恢复 round diff 修复
      expect(run.hubFrames('UPDATE').length).toBeLessThan(20);
      expect(run.rootValue('hub', 'n')).toBe(20);
      expect(run.rootValue('peer', 'n')).toBe(20);
      await settle();
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });

  it('G1：GOAWAY(SERVER_RESTARTING) → drainTimeoutMs deadline close(1001) → backoff → 重连 → re-OPEN → live（数据不丢）', async () => {
    const run = await boot({
      backoff: { baseMs: 50, maxMs: 400, resetAfterMs: 500 },
      random: () => 0.5,
    });
    // hub 静默期注入连接级 GOAWAY（序列 = 接收端期望，driver seam 默认记账）
    run.injectHub({ kind: 'GOAWAY', reasonCode: 'SERVER_RESTARTING', drainTimeoutMs: 60 });
    await settle();
    // deadline 未到：连接 draining（协议 §15.1 L411 字面「ready ├─ GOAWAY → draining」；
    // 既有 namespace 不强关——自然收口到 deadline；§6.5-A1 改锚：无 hint 面同样无条件 draining）
    expect(run.connectionState()).toBe('draining');
    expect(run.wire.peerSideClosed).toBe(false);

    // deadline 到：本地计时 fire → transport.close(1001, 'goaway-drain')
    await advanceMs(run, 60);
    expect(run.wire.peerSideClosed).toBe(true);

    // 真实 WS 语义：本地主动 close() 后本地同样收到 close 事件（harness 以
    // closePeerSide 同模交付——makeEnd 不自通知，见文件头保真度注记）
    run.wire.closePeerSide(1001, 'goaway-drain');
    await run.waitConnection('backoff');
    await run.waitNamespace('disconnected');
    expect(run.wire.peerSideCloseInfo?.code).toBe(1001);

    // 1001 = 临时失败 → full jitter backoff（0.5×50=25ms）→ 重拨
    expect(run.dialCount).toBe(1);
    await advanceMs(run, 25);
    await run.waitConnection('ready');
    // 重连后对活跃 target 重新 OPEN（此时 peer 已有副本 → mode1 reconcile）→ live
    await run.waitNamespace('live');
    expect(run.dialCount).toBe(2);
    expect(run.frames().peerToHub.filter((f) => f.message.kind === 'OPEN_NAMESPACE')).toHaveLength(1);
    expect(run.rootValue('hub', 'extra')).toBe(77);
    expect(run.rootValue('peer', 'extra')).toBe(77);
    expect(run.rootValue('hub', 'n')).toBe(42);
    expect(run.rootValue('peer', 'n')).toBe(42);
  });

  it('G2：GOAWAY(SERVER_SHUTTING_DOWN) → 连接 blocked（§4.3 reasonCode 分类——永久失败面）', async () => {
    const run = await boot();
    run.injectHub({ kind: 'GOAWAY', reasonCode: 'SERVER_SHUTTING_DOWN', drainTimeoutMs: 60 });
    await settle();
    expect(run.connectionState()).toBe('blocked');
    // 未走 deadline 关闭路径（非 SERVER_RESTARTING 分支）
    expect(run.wire.peerSideClosed).toBe(false);
  });
});

// ═════════════════════════ R3 复验轮补充（2026-08-30）═════════════════════════

/**
 * B-2a 闭项探针（SA7 R3）：B-2a（导入迟到终态不回收 lease——Spec §5 B-2a，无红灯：
 * Registry 无 lease 列表公共观测面）由 SA3 R4（0324d8f）顺手修复。本 IT 以**终态变体**
 * （B-2b 红灯锚的是 disconnected 变体）动态闭项：迟到导入续体在 ns 已终态（closed）时
 * ——零 wire、零状态机迁移（§13.4）；被回收 lease 的后继流程全功能（回收未损伤文档/
 * 持久化面：re-add → 重建 → reconcile live → 业务写双向收敛）。
 */
describe('SA7 R3 补充：B-2a 终态变体闭项（迟到导入回收 × 后继 lease 全功能）', () => {
  it('B2a：导入在途 → removeTarget 收口 closed（终态）→ 迟到导入零 wire 零迁移 → re-add live + 写收敛', async () => {
    const probe = collectUnhandledRejections();
    try {
      const run = await boot({ start: false });
      run.peerNode.persistence.importHold = deferred();
      run.peer.start();
      await run.waitNamespace('bootstrapping');
      // removeTarget（导入悬挂中）→ closing → CLOSE → hub CLOSE_OK → closed（终态）
      const closePromise = run.peer.removeTarget(run.nsId);
      await run.waitNamespace('closed');
      await closePromise;
      await settle();
      // 冻结 wire 快照（迟到续体不得产生任何新帧）
      const frozenPeerToHub = run.frames().peerToHub.length;
      const frozenHubToPeer = run.frames().hubToPeer.length;
      // 释放导入 → 迟到续体：§13.4 已终局 → lease 静默回收（B-2a）、零 wire、零迁移
      const hold = run.peerNode.persistence.importHold;
      run.peerNode.persistence.importHold = undefined;
      if (hold !== undefined) hold.resolve();
      await settle();
      expect(run.namespaceState()).toBe('closed');
      expect(run.peerFramesAll('BOOTSTRAP_ACK')).toHaveLength(0);
      expect(run.hubFramesAll('ERROR')).toHaveLength(0);
      expect(run.frames().peerToHub.length).toBe(frozenPeerToHub);
      expect(run.frames().hubToPeer.length).toBe(frozenHubToPeer);
      // 后继 lease 全功能：re-add → §14.1 整连接重建（B-2e 通知面同路径）→ 副本已导入
      // → mode1 reconcile → live；业务写经新 lease 双向收敛（回收未损伤持久化面）
      const dials = run.dialCount;
      run.peer.addTarget(run.target);
      await run.waitNamespace('live');
      expect(run.dialCount).toBeGreaterThan(dials);
      await run.writePeer({ ext: 3 });
      await settle();
      expect(run.rootValue('hub', 'ext')).toBe(3);
      expect(run.rootValue('peer', 'ext')).toBe(3);
      await settle();
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });
});

// ═════════════════════════ R3 复验轮红锚（D2，2026-08-30 实测，预期红）═════════════════════════

/**
 * D2（MAJOR，SA7 R3 发现）：迟到 cleanup 的 `unsubscribe` 步骤在 B-2d「当前
 * session/lease 判别」守卫之外——跨重连在途 apply 场景下误退订**新** session 的
 * owned-updates listener → peer→hub live 更新静默停摆（零 UPDATE、零 ERROR、零
 * RESYNC——peer 投影恒 live，hub 永久缺失后续本地写；F1 同族静默失败红线）。
 *
 * 机制（peer-namespace.ts `closeSessionAndRelease`）：旧 cleanup 在
 * `await session.close()`（S1 屏障 = 在途 apply 排空）期间，重连已把 `this.unsubscribe`
 * 换成新 session S2 的 U2；屏障解除后无条件执行 `this.unsubscribe()`——击中 U2。
 * 守卫（`this.session === session && this.lease === lease`）只保护 session/lease/
 * watchdog/round/channel 的 teardown 面，漏了位于守卫之前的 unsubscribe 步骤。
 *
 * 构造（与 SA6 B-2d 红灯同构 + post-live 写探针，3/3 确定性）：
 * peer saveGate 悬挂 hub→peer UPDATE 的 apply → 断线（投影先行 disconnected，旧
 * cleanup 停在 S1.close() 屏障）→ backoff 重连 → re-OPEN/reconcile（round Step2
 * apply 排队于 pendingApplies 集合中的悬挂旧 apply 之后；U2 已在 round 启动时订阅）
 * → 释放 gate（同一微任务级联：旧 apply 迟结算 → round 收口 live + S1.close() 解除
 * → 旧 cleanup 苏醒 → unsubscribe 击杀 U2）→ live 后 peer 本地写。
 *
 * 转绿条件（SA3）：`closeSessionAndRelease` 在入口捕获 unsubscribe 句柄（与
 * session/lease 同款），仅当仍为当前句柄才调用/清除（或把 unsubscribe 移入
 * 「当前 session/lease」守卫块内）。
 */
describe('SA7 R3 红锚：D2 迟到 cleanup 误退订新 session listener（B-2d 守卫遗漏 unsubscribe 面）', () => {
  it('D2：在途 apply 跨重连收口 live 后，peer 本地写必须送达 hub（UPDATE ≥1 + 双向收敛）', async () => {
    const probe = collectUnhandledRejections();
    try {
      const run = await boot({
        backoff: { baseMs: 50, maxMs: 400, resetAfterMs: 500 },
        random: () => 0.5,
      });
      run.peerNode.persistence.saveGate = deferred();
      await run.writeHub({ n: 1 });
      await settle();
      await run.waitHubSent('UPDATE', 1);
      run.wire.closePeerSide(1006, 'network lost');
      await settle();
      await advanceMs(run, 25);
      await run.waitConnection('ready');
      expect(run.peerFramesAll('OPEN_NAMESPACE')).toHaveLength(2); // B-2d 修复面（已知绿）
      const gate = run.peerNode.persistence.saveGate;
      run.peerNode.persistence.saveGate = undefined;
      if (gate !== undefined) gate.resolve();
      await settle();
      await run.waitNamespace('live'); // B-2d 主断言（已知绿——round 收口不依赖 listener 存活）
      await settle();
      // ── D2 红灯锚：live UPDATE 通道必须承载 post-round 本地写 ──
      await run.writePeer({ ext: 5 });
      await settle();
      await settle();
      expect(run.frames().peerToHub.filter((f) => f.message.kind === 'UPDATE').length).toBeGreaterThanOrEqual(1);
      expect(run.rootValue('hub', 'ext'), '迟到 cleanup 不得误退订新 session listener（§13.4 只回收旧资源）').toBe(5);
      expect(run.rootValue('peer', 'ext')).toBe(5);
      await settle();
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });
});
