/**
 * SA7 动态验证（issue #171）—— fake-duplex 确定性补充锚（零 real sleep）。
 *
 * 覆盖 SA4 R2 §4 动态审核重点 2/3（SA2 R2-N2② + N1）：
 *   D3  hub applyStep2 的 isQuietState 门（R2-N2②·设计 §D5.4 裁决 (a) 的 hub 半边）：
 *       「closing 期零 SYNC_APPLIED 出站」——hub 侧在途 Step2 apply（peer 副本带
 *       增量 diff → reconcile round 的 peer Step2 非 空 diff → hub apply 悬挂在
 *       hub saveGate）期间 peer 发起 CLOSE_NAMESPACE → hub 通道 closing（closeQueue
 *       drain 同样悬挂）→ 放行 apply → 迟到续体恢复时必须**零 SYNC_APPLIED 出站**
 *       （迟到续体零 wire 家族）；同场景孪生对照（无 CLOSE）放行后 SYNC_APPLIED
 *       正常发出 ≥1——证明抑制源自 isQuietState 门而非 diff 为空/apply 失败。
 *   N1  GOAWAY drain 窗口内**在途** startOpen 续体的实测帧面（SA4 §3 N1 / §6.3
 *       执行面裁决依据）：peer registry.open 悬挂（loadGate）期间注入
 *       GOAWAY{RESTARTING} → 轻量层投影 disconnected → 放行 loadGate → 实测
 *       **零补发 OPEN_NAMESPACE**——B-2c 的 isConnectionDead() 含 'disconnected'
 *       态，轻量层提前投影恰好把 drain 窗口纳入中止判据（SA4 N1 静态担忧的
 *       「可能补发一帧」在实测中不发生；hub authorize 门闩悬挂保证注入序列
 *       记账无碰撞）；deadline 全量层处置零残留 + transport close(1001)。
 *
 * 纪律：与 issue171-red 同款——fake-duplex 内存双端 + 受控 scheduler、零 real sleep、
 * 零源码 grep 断言；对象图只读投影沿用既有模式。
 */
import { describe, expect, it } from 'vitest';
import type { ReplicationMessage } from '@nomicore/replication-protocol';
import { boot, advanceMs, type Run } from './driver.js';
import { deferred, settle, settleUntil } from './harness.js';

function hubChannelStateOf(run: Run, nsId: string): string | undefined {
  const connection = run.hub.connections[0] as unknown as { channels: Map<string, { state: string }> };
  return connection?.channels.get(nsId)?.state;
}

function controllerProjectionOf(run: Run): {
  readonly session: unknown;
  readonly lease: unknown;
} {
  const impl = run.peer as unknown as {
    controllers: Map<string, { session: unknown; lease: unknown }>;
  };
  const controller = impl.controllers.get(run.nsId);
  if (controller === undefined) throw new Error('无 peer controller');
  return { session: controller.session, lease: controller.lease };
}

// ═══════════════════════════ D3：hub applyStep2 isQuietState 门 ═══════════════════════════

describe('SA7 D3（issue #171，SA2 R2-N2②）：hub 侧在途 Step2 apply 跨越 closing 窗口——迟到 SYNC_APPLIED 必须被 isQuietState 门拦截', () => {
  it('D3-主：hub apply 悬挂 + peer CLOSE（hub 通道 closing）→ 放行 → 零 SYNC_APPLIED 出站、closeQueue 正常收口 CLOSE_OK/closed', async () => {
    // peerReplica rootN=50 ≠ hub 42 → reconcile round 的 peer Step2 diff 非空（hub apply
    // 落盘必经 saveDoc → saveGate 悬挂点可达）；closeTimeout 拉长排除兜底先行。
    const run = await boot({
      peerReplica: { rootN: 50 },
      timeouts: { closeTimeoutMs: 60_000, ackTimeoutMs: 60_000 },
      start: false,
      waitFor: 'none',
    });
    const gate = deferred();
    run.hubNode.persistence.saveGate = gate;
    run.peer.start();
    await run.waitConnection('ready');
    await run.waitNamespace('reconciling');
    // peer 的 Step2（非空 diff）已上 wire，hub apply 悬挂在 saveDoc
    await run.waitPeerSent('SYNC_STEP2');
    await settle();
    expect(
      run.hubNode.persistence.saveEvents.length,
      '前置：hub apply 已到达 saveDoc（悬挂点）',
    ).toBeGreaterThan(0);
    expect(run.hubFramesAll('SYNC_APPLIED'), '前置：悬挂期零 SYNC_APPLIED').toHaveLength(0);
    expect(hubChannelStateOf(run, run.nsId), '前置：hub 通道 reconciling（round 在途）').toBe('reconciling');

    // peer 发起 CLOSE_NAMESPACE（reconciling → closing）→ hub onCloseRequest：
    // 通道 closing + closeQueue drain 悬挂在同一 apply 上
    const closeP = run.peer.removeTarget(run.nsId);
    await run.waitNamespace('closing');
    await settleUntil(
      () => hubChannelStateOf(run, run.nsId) === 'closing',
      'hub 通道 closing（drain 悬挂在途 apply）',
    );

    // 放行 apply → hub applyStep2 续体在 closing 态恢复
    gate.resolve();
    await settle();
    await settle();

    // ── 锚 1（R2-N2② 核心断言）：closing 期迟到 SYNC_APPLIED 零出站 ──
    expect(
      run.hubFramesAll('SYNC_APPLIED'),
      'hub 通道 closing 期在途 Step2 apply 续体不得补发 SYNC_APPLIED（isQuietState 门）',
    ).toHaveLength(0);
    // ── 锚 2：closeQueue 不被抑制门卡死——drain 完成后正常收口 ──
    await settleUntil(
      () => hubChannelStateOf(run, run.nsId) === 'closed',
      'hub 通道完成收口 closed（CLOSE_OK 已发出）',
    );
    expect(run.hubFramesAll('CLOSE_OK').length, 'hub CLOSE_OK 已上 wire（收口链未悬置）').toBeGreaterThanOrEqual(1);
    await run.waitNamespace('closed');
    await closeP;
  });

  it('D3-对照（vacuous-green 防护）：同场景无 CLOSE → 放行 apply 后 SYNC_APPLIED 正常发出（证明锚 1 的抑制源自 isQuietState 门）', async () => {
    const run = await boot({
      peerReplica: { rootN: 51 },
      timeouts: { closeTimeoutMs: 60_000, ackTimeoutMs: 60_000 },
      start: false,
      waitFor: 'none',
    });
    const gate = deferred();
    run.hubNode.persistence.saveGate = gate;
    run.peer.start();
    await run.waitConnection('ready');
    await run.waitNamespace('reconciling');
    await run.waitPeerSent('SYNC_STEP2');
    await settle();
    expect(run.hubNode.persistence.saveEvents.length, '前置：hub apply 已到达 saveDoc').toBeGreaterThan(0);
    expect(run.hubFramesAll('SYNC_APPLIED')).toHaveLength(0);

    // 不 CLOSE：通道保持活跃 → 放行后 SYNC_APPLIED 必须正常发出
    gate.resolve();
    await run.waitHubSent('SYNC_APPLIED');
    expect(run.hubFramesAll('SYNC_APPLIED').length, '非静默态 SYNC_APPLIED 正常出站（门未误伤）').toBeGreaterThanOrEqual(1);
    await run.waitNamespace('live');
  });
});

// ═══════════════════════════ N1：drain 窗口内在途 OPEN_NAMESPACE 帧面 ═══════════════════════════

describe('SA7 N1（issue #171，SA4 §3 N1 / §6.3 执行面）：GOAWAY drain 窗口内在途 startOpen 续体——OPEN_NAMESPACE 出站帧面实测', () => {
  it('N1：registry.open 在途注入 GOAWAY → 放行 → 零补发 OPEN_NAMESPACE（轻量层 disconnected 投影使 B-2c 拦截 drain 窗口续体）、deadline 全量层处置零残留', async () => {
    // hub authorize 首调门闩（永不放行）：hub 侧零真实帧 → 注入 GOAWAY 的序列记账无碰撞
    const authorizeLatch = deferred();
    let authorizeCalls = 0;
    const run = await boot({
      peerReplica: 'same',
      timeouts: { openTimeoutMs: 60_000, bootstrapTimeoutMs: 60_000, closeTimeoutMs: 60_000 },
      start: false,
      waitFor: 'none',
      authorize: async () => {
        authorizeCalls += 1;
        if (authorizeCalls === 1) await authorizeLatch.promise;
        return { ok: true, localOwner: { userId: 'hub-owner-9f38' }, permissions: { read: true, submit: true } };
      },
    });
    // peer registry.open 悬挂（loadGate——startOpen 续体在途锚）
    const loadGate = deferred();
    run.peerNode.persistence.loadGate = loadGate;
    run.peer.start();
    await run.waitConnection('ready');
    await settleUntil(() => run.namespaceState() === 'opening', 'peer ns opening（registry.open 在途）');
    expect(run.peerFramesAll('OPEN_NAMESPACE').length, '前置：OPEN_NAMESPACE 尚未上 wire（registry.open 悬挂）').toBe(0);

    // GOAWAY RESTARTING（drain 10s——scheduler 虚拟时间推进）→ 轻量层投影 disconnected
    run.injectHub({
      kind: 'GOAWAY',
      reasonCode: 'SERVER_RESTARTING',
      drainTimeoutMs: 10_000,
    } as ReplicationMessage);
    await run.waitNamespace('disconnected');
    expect(run.connectionState(), 'drain 窗口连接 ready').toBe('ready');

    // 放行 registry.open → 续体恢复于 drain 窗口（连接存活、epoch 未变——SA4 N1 的
    // 静态担忧是 B-2c 只判「连接死亡/epoch」而漏 drain 窗口 → 补发一帧 OPEN_NAMESPACE）
    loadGate.resolve();
    await settle();
    await settle();
    // ── 锚 1（§6.3 执行面实测·N1 裁决依据）：零补发 OPEN_NAMESPACE。
    //    实测推翻 SA4 N1 静态担忧：B-2c 的 isConnectionDead() = isTerminal() ∨
    //    state==='disconnected' —— 轻量层 GOAWAY 收帧段的 disconnected 提前投影
    //    恰好把 drain 窗口纳入中止判据 → 续体在窗口内恢复即中止（§11.3 静默回收），
    //    「停止 OPEN」被严格执行（帧面零例外；无需 SA1 重裁决）。──
    expect(
      run.peerFramesAll('OPEN_NAMESPACE').length,
      'drain 窗口内在途续体必须零补发 OPEN_NAMESPACE（disconnected 投影已入 B-2c 判据）',
    ).toBe(0);
    expect(run.namespaceState(), '投影保持 disconnected（不复活）').toBe('disconnected');
    expect(
      controllerProjectionOf(run).lease,
      '中止路径不落 controller.lease（§11.3 静默回收——registry.open 已交付 lease 即时 release）',
    ).toBeUndefined();

    // ── 锚 2：帧面不再增长（零再开、零数据帧）──
    await settle();
    expect(run.peerFramesAll('OPEN_NAMESPACE').length, '无任何 OPEN 帧（停止 OPEN 的执行面）').toBe(0);
    expect(run.peerFramesAll('UPDATE'), 'drain 窗口零数据帧').toHaveLength(0);

    // ── 锚 3：deadline 全量层处置（真实 scheduler 推进）→ transport close(1001) + 零残留 ──
    await advanceMs(run, 10_000);
    await settle();
    expect(run.namespaceState(), 'deadline 全量层处置后投影（disconnected 保持）').toBe('disconnected');
    const projection = controllerProjectionOf(run);
    expect(projection.lease, 'deadline 后零 lease 残留').toBeUndefined();
    expect(projection.session, 'deadline 后零 session 残留（OPEN_OK 未达，session 未建立）').toBeUndefined();
    expect(run.wire.peerSideClosed, 'deadline transport close').toBe(true);
    // fake-duplex seam：本地 close 不自通知本端 onClose——close code 经对端
    // （hub 侧）close 事件观测（真实 WS 语义下的本地 onClose 收口已在 RT-F1 真机覆盖）
    expect(run.wire.hubSideCloseInfo?.code, 'deadline transport close = WS 1001（hub 侧观测）').toBe(1001);
  });
});
