/**
 * SA6 红灯验收 —— issue #174「实现真实 GOAWAY drain 与关闭时序」（修复 PR #173 的
 * `HubConnectionImpl.shutdownWithGoaway()`：GOAWAY 与 close(1001) 同栈收口，宣告的
 * drainTimeoutMs 没有形成真实 drain 窗口）。
 *
 * 锚点：
 * - `wiki/raw/task_issue-174-goaway-drain.md` AC1..AC8（GOAWAY 先行且 peer 可观测、
 *   deadline 前允许已接纳 apply 排空与自然收口、不等待未完成网络 ACK 超 deadline、
 *   drain 完成或 deadline 到达后以 WS 1001 关闭、session close/lease release 与
 *   transport close 顺序符合 `docs/protocols/instance-replication-v1.md` §21、
 *   动态覆盖 pending apply / GOAWAY 可见性 / deadline / 提前完成 / 迟到回调）；
 * - `wiki/raw/20260830-bug-issue-174-goaway-drain.md`（根因：GOAWAY 后同栈
 *   `this.close(1001)`，drainMs 仅编码进 wire 帧、本地零消费；窗口长度 = 0；
 *   drain 期入站帧全部被静默丢弃；「显式拒绝」缺失）。
 * - `docs/protocols/instance-replication-v1.md` §6.3（L141-149）/§15.2（hub FSM
 *   ready → draining → closed）/§21（停机顺序 L565-574）/
 *   ADR-0010 L179（停止顺序 + 「Drain 不无限等待网络 ACK」）。
 *
 * 红线纪律：真实 yjs / Registry / Runtime 双实例 + fake-duplex（微任务投递）+
 * fake scheduler（零 real sleep）；断言 = wire 帧 / 连接状态 / transport 关闭观测 /
 * 持久化生效（零源码 grep；零 mock 被测对象）。
 *
 * ⚠ 本文件全部 IT 为红灯（当前实现未修）：预期失败点见各 it 注释（「RED@」）。
 */
import * as Y from 'yjs';
import { describe, expect, it, vi } from 'vitest';
import { boot, collectUnhandledRejections } from './driver.js';
import {
  CONTRACT_TIMEOUTS,
  deferred,
  HUB_OWNER,
  makeHubNamespace,
  settle,
  settleUntil,
} from './harness.js';

// ─────────────────────────── 帧消息形状辅助（窄投影，不依赖实现内部） ───────────────────────────

interface GoawayProbe {
  readonly reasonCode: string;
  readonly drainTimeoutMs: number;
}

interface CloseOkProbe {
  readonly namespaceId: string;
  readonly ackedSequence: number;
}

interface ErrorProbe {
  readonly code?: string;
  readonly namespaceId?: string;
}

interface OpenOkProbe {
  readonly namespaceId: string;
}

interface SyncStep2Probe {
  readonly namespaceId: string;
  readonly syncRoundId: number;
}

describe('SA6 issue #174：GOAWAY drain 真实窗口与关闭时序（红灯契约）', () => {
  it('R1：hub.close() 后 GOAWAY 先行且 peer 可观测；deadline 前窗口开放（transport 未关、close 未结算）；deadline 到达以 WS 1001 收口且不等待任何完成事件；deadline 后迟到回调零副作用', async () => {
    const run = await boot({ timeouts: { closeTimeoutMs: 5_000 } });
    const rejections = collectUnhandledRejections();
    try {
      const peerStateBefore = run.connectionState();
      expect(peerStateBefore).toBe('ready');

      const closePromise = run.hub.close();
      await settle();

      // —— GOAWAY 可见性：先于 transport close 发出、reasonCode 稳定、drainTimeoutMs=closeTimeoutMs ——
      const goaways = run.hubFramesAll('GOAWAY');
      expect(goaways).toHaveLength(1);
      const goaway = goaways[0]!.message as unknown as GoawayProbe;
      expect(goaway.reasonCode).toBe('SERVER_SHUTTING_DOWN');
      expect(goaway.drainTimeoutMs).toBe(CONTRACT_TIMEOUTS.closeTimeoutMs);

      // —— peer 可观测：GOAWAY(SERVER_SHUTTING_DOWN) → §15.1 blocked 分类 ——
      expect(run.connectionState()).toBe('blocked');

      // RED@1：真实窗口必须开启——deadline（t0+5000）未到，hub transport 不得关闭。
      // 当前实现：GOAWAY 后同栈 transport.close(1001) → t0 即 closed（窗口长度 = 0）。
      expect(run.wire.hubSideClosed).toBe(false);

      // RED@2：窗口开启 = close Promise 未在 deadline 前结算。
      // 当前实现：close() 随 cleanupAll 立即结算（SA5 复现 R1 同款证据）。
      let settled = false;
      void closePromise.then(() => {
        settled = true;
      });
      await settle();
      expect(settled).toBe(false);

      // —— deadline 到达（虚拟时间推进，零 real sleep）→ drain 完成/截止 → WS 1001 收口 ——
      await run.hubNode.scheduler.advanceBy(CONTRACT_TIMEOUTS.closeTimeoutMs);
      await settle();
      expect(run.wire.hubSideClosed).toBe(true);
      expect(run.wire.peerSideCloseInfo?.code).toBe(1001);
      await closePromise; // 结算不无限等待（无任何收口事件发生，纯 deadline 收口）

      // —— 迟到回调：deadline 关闭后 peer 的迟到收口帧（在途 UPDATE_ACK/CLOSE_NAMESPACE）
      //    必须零副作用：零响应帧、零异常、零 unhandled rejection ——
      const hubFramesBeforeLate = run.frames().hubToPeer.length;
      run.injectPeer({ kind: 'UPDATE_ACK', namespaceId: run.nsId, ackedSequence: 1 });
      run.injectPeer({ kind: 'CLOSE_NAMESPACE', namespaceId: run.nsId, reasonCode: 'target-removed' });
      await settle();
      expect(run.frames().hubToPeer.length).toBe(hubFramesBeforeLate);
      expect(run.hubFramesAll('CLOSE_OK')).toHaveLength(0);
      expect(rejections.events).toEqual([]);
    } finally {
      rejections.dispose();
    }
  });

  it('R2：drain 窗口内现有 namespace 自然收口——peer CLOSE_NAMESPACE 必须被处理（CLOSE_OK 回执，§13 握手），收口后 drain 提前完成并以 1001 关闭（零时间推进）', async () => {
    const run = await boot({ timeouts: { closeTimeoutMs: 5_000 } });
    const rejections = collectUnhandledRejections();
    try {
      const closePromise = run.hub.close();
      await settle();

      // RED@1：窗口开启（deadline 前 transport 未关）——自然收口窗口存在的前提。
      expect(run.wire.hubSideClosed).toBe(false);

      // —— peer 在窗口内自然收口（CLOSE 恒由 peer 发起，§13）：帧在 deadline 前到达 hub ——
      const closeSeq = run.nextPeerSeq();
      run.injectPeer(
        { kind: 'CLOSE_NAMESPACE', namespaceId: run.nsId, reasonCode: 'target-removed' },
        { sequence: closeSeq },
      );
      await settle();

      // RED@2：CLOSE 帧必须被窗口处理而非静默吞——hub 回 CLOSE_OK（ackedSequence =
      // CLOSE 帧 sequence，§13/§6.3 自然收口握手）。当前实现：transport 监听器已在
      // cleanupAll 摘除 + onMessage closedFlag 早退 → 零响应。
      const closeOks = run.hubFramesAll('CLOSE_OK');
      expect(closeOks).toHaveLength(1);
      const closeOk = closeOks[0]!.message as unknown as CloseOkProbe;
      expect(closeOk.namespaceId).toBe(run.nsId);
      expect(closeOk.ackedSequence).toBe(closeSeq);

      // —— 唯一 channel 自然收口 → drain 完成 → 提前关闭（零时间推进，早于 deadline）——
      // §21 顺序：namespace 排空/收口（CLOSE_OK 的 closeQueue 内 = 先 drainPendingApplies
      // 再 closeSessionAndRelease，见 hub-namespace.ts）先于 transport close。
      await settleUntil(() => run.wire.hubSideClosed, '自然收口后 drain 完成，hub 应提前关闭 transport');
      expect(run.wire.peerSideCloseInfo?.code).toBe(1001);
      await closePromise;
      expect(rejections.events).toEqual([]);
    } finally {
      rejections.dispose();
    }
  });

  it('R3：drain 窗口内新 namespace OPEN / 新 sync round 显式拒绝——不接纳（零 OPEN_OK/零 round 响应）且拒绝不杀连接（窗口保持到 deadline）', async () => {
    const run = await boot({ timeouts: { closeTimeoutMs: 5_000 } });
    const ns2Fixture = await makeHubNamespace(run.hubNode, { owner: HUB_OWNER });
    const ns2 = ns2Fixture.namespaceId;
    const closePromise = run.hub.close();
    await settle();

    // RED@0：窗口开启（当前实现 t0 即关传输——拒绝面无从谈起）。
    expect(run.wire.hubSideClosed).toBe(false);

    // —— 窗口内到达的新 OPEN（peer 在 GOAWAY 送达前已发出的在途帧，非 peer 违例）——
    run.injectPeer({ kind: 'OPEN_NAMESPACE', namespaceId: ns2, hasLocalReplica: false });
    await settle();

    // 不接纳：零 OPEN_OK、零 bootstrap 流
    const openOks = run.hubFramesAll('OPEN_OK').map(
      (f) => (f.message as unknown as OpenOkProbe).namespaceId,
    );
    expect(openOks).not.toContain(ns2);

    // RED@1：拒绝必须显式（ERROR 帧），不得静默吞 —— 当前实现 onMessage closedFlag
    // 早退 + 监听器已摘 → 零响应（SA5 缺陷报告「次要缺陷面」）。
    const errors = run.hubFramesAll('ERROR') as Array<{ message: ErrorProbe }>;
    expect(errors.length).toBeGreaterThan(0);

    // —— 窗口内新 sync round 不得开始（§6.3：不开始新 sync round；AC1）——
    const seenRounds = run
      .allFrames()
      .peerToHub.filter((f) => f.message.kind === 'SYNC_STEP1')
      .map((f) => (f.message as { syncRoundId: number }).syncRoundId);
    const freshRoundId = Math.max(1, ...seenRounds) + 1;
    run.injectPeer({
      kind: 'SYNC_STEP1',
      namespaceId: run.nsId,
      syncRoundId: freshRoundId,
      stateVector: new Uint8Array(0),
    });
    await settle();
    const round2s = run.hubFramesAll('SYNC_STEP2').map(
      (f) => (f.message as unknown as SyncStep2Probe).syncRoundId,
    );
    expect(round2s).not.toContain(freshRoundId);

    // —— drain 期的后续 UPDATE 同样不得进入 apply：既有 namespace 值与 dirty 计数不变，
    // 且不产生 UPDATE_ACK。这里使用合法但未由 peer 控制器发送的 Yjs update，模拟
    // GOAWAY 前已在途、GOAWAY 后才抵达 hub 的 namespace frame。
    const lateDoc = new Y.Doc();
    lateDoc.getMap('ROOT').set('n', 999);
    const lateUpdate = Y.encodeStateAsUpdate(lateDoc);
    const savesBeforeLateUpdate = run.saveEvents('hub');
    const updateAcksBeforeLateUpdate = run.hubFramesAll('UPDATE_ACK').length;
    run.injectPeer({ kind: 'UPDATE', namespaceId: run.nsId, update: lateUpdate });
    await settle();
    expect(run.rootValue('hub', 'n')).toBe(42);
    expect(run.saveEvents('hub')).toBe(savesBeforeLateUpdate);
    expect(run.hubFramesAll('UPDATE_ACK')).toHaveLength(updateAcksBeforeLateUpdate);

    // —— 拒绝不杀连接：窗口保持开放直至 deadline ——
    expect(run.wire.hubSideClosed).toBe(false);
    expect(run.wire.peerSideCloseInfo).toBeUndefined();
    await run.hubNode.scheduler.advanceBy(CONTRACT_TIMEOUTS.closeTimeoutMs);
    await settle();
    expect(run.wire.hubSideClosed).toBe(true);
    expect(run.wire.peerSideCloseInfo?.code).toBe(1001);
    await closePromise;
  });

  it('R4：session.close 异常仍 teardown channel 并释放 lease，hub.close 正常结算', async () => {
    const run = await boot({ timeouts: { closeTimeoutMs: 5_000 } });
    const connection = run.hub.connections[0] as unknown as {
      channels: Map<string, {
        session: { close(): Promise<void>; getStatus(): { state: string } } | undefined;
        lease: { release(): Promise<void>; readData(path: readonly (string | number)[]): { ok: boolean } } | undefined;
        channel: { teardown(): void };
        round: { teardown(): void };
        watchdog: { teardown(): void };
      }>;
    };
    const channel = connection.channels.get(run.nsId);
    if (channel?.session === undefined || channel.lease === undefined) {
      throw new Error('前置失败：hub live channel/session/lease 不存在');
    }
    const lease = channel.lease;
    const realSession = channel.session;
    channel.session = {
      close: () => Promise.reject(new Error('injected-session-close-reject')),
      getStatus: () => realSession.getStatus(),
    };
    const channelTeardown = vi.spyOn(channel.channel, 'teardown');
    const roundTeardown = vi.spyOn(channel.round, 'teardown');
    const watchdogTeardown = vi.spyOn(channel.watchdog, 'teardown');

    const closePromise = run.hub.close();
    await run.hubNode.scheduler.advanceBy(CONTRACT_TIMEOUTS.closeTimeoutMs);
    await expect(closePromise).resolves.toBeUndefined();

    expect(channelTeardown).toHaveBeenCalled();
    expect(roundTeardown).toHaveBeenCalled();
    expect(watchdogTeardown).toHaveBeenCalled();
    expect(realSession.getStatus().state).toBe('closed');
    expect(lease.readData([]).ok).toBe(false);
  });

  it.each([
    ['resolve', false],
    ['reject', true],
  ] as const)('R5：deadline 后 pending apply %s 的迟到回调零额外 wire、零 unhandled rejection', async (_label, reject) => {
    const run = await boot({ timeouts: { closeTimeoutMs: 5_000 } });
    const rejections = collectUnhandledRejections();
    const gate = deferred();
    try {
      run.hubNode.persistence.saveGate = gate;
      await run.writePeer({ n: 8 });
      await settle();
      const closePromise = run.hub.close();
      await settle();

      await run.hubNode.scheduler.advanceBy(CONTRACT_TIMEOUTS.closeTimeoutMs);
      await settle();
      expect(run.wire.hubSideClosed).toBe(true);
      const framesAtDeadline = run.frames().hubToPeer.length;

      run.hubNode.persistence.saveGate = undefined;
      if (reject) gate.reject(new Error('late-save-reject'));
      else gate.resolve();
      await closePromise;
      await settle();

      expect(run.frames().hubToPeer).toHaveLength(framesAtDeadline);
      expect(rejections.events).toEqual([]);
    } finally {
      rejections.dispose();
    }
  });

  it('R6：hub.close() 时已接纳的 namespace apply 在窗口内排空（dirty 门闩悬挂在途 apply）；排空期间窗口保持开放，deadline 以 1001 收口', async () => {
    const run = await boot({ timeouts: { closeTimeoutMs: 5_000 } });
    // hub 侧 dirty notification（saveDoc）挂起——apply 已被 Runtime sequencer 接纳但在途。
    const gate = deferred();
    run.hubNode.persistence.saveGate = gate;
    const savesBefore = run.saveEvents('hub');
    const acksBefore = run.hubFramesAll('UPDATE_ACK').length;

    await run.writePeer({ n: 7 });
    await settle();
    expect(run.peerFramesAll('UPDATE')).toHaveLength(1);
    // apply 已接纳但在途（saveDoc 门闩挂起 → 尚未完成，ACK 未出——§10 语义）
    expect(run.hubFramesAll('UPDATE_ACK').length).toBe(acksBefore);

    const closePromise = run.hub.close();
    await settle();

    // RED@1：apply 在途时窗口必须开启——close() 不得同步关 transport（§21 步骤 2：
    // 「排空已接纳 apply」发生在 transport close 之前/窗口内）。
    expect(run.wire.hubSideClosed).toBe(false);
    expect(run.hubFramesAll('GOAWAY')).toHaveLength(1);

    // —— 释放门闩：已接纳 apply 无条件排空（值收敛 + dirty 登记，不取消、不设内部超时）——
    run.hubNode.persistence.saveGate = undefined;
    gate.resolve();
    await settle();
    expect(run.rootValue('hub', 'n')).toBe(7);
    expect(run.saveEvents('hub')).toBe(savesBefore + 1);

    // RED@2：apply 已完成排空但 deadline 未到——transport 仍须开放（关闭只发生在
    // drain 完成或 deadline 到达，二者皆未发生——channel 未自然收口）。
    expect(run.wire.hubSideClosed).toBe(false);

    // —— deadline 到达：不等待任何未完成网络 ACK，直接 1001 收口 + close 结算 ——
    await run.hubNode.scheduler.advanceBy(CONTRACT_TIMEOUTS.closeTimeoutMs);
    await settle();
    expect(run.wire.hubSideClosed).toBe(true);
    expect(run.wire.peerSideCloseInfo?.code).toBe(1001);
    await closePromise;
  });
});
