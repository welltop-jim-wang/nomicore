/**
 * SA6 红灯补测 —— issue #136 设计 R3 追加 / R4 追加（SA2 R1 攻击评审移交，设计定稿
 * `task_phase5-ws-namespace-sync_design.md` §18.11「R3 追加」节 + R4/N-1）：
 *
 *   ① 恢复窗口 UPDATE 容忍   （§11.1/§11.3 状态门 R3/#1 收窄；§10.4 同连接恢复）
 *   ② bump×流量竞态终态确定  （§11.1 R3/#2 围栏判别 + §12.2 one-shot 终结器）
 *   ③ session fanout 溢出消费（§12 问题二：FANOUT 16 冻结容量；watchdog needsResync
 *      边沿；peer 本地写为暴露面——N-2 修订后 peer 侧 watchdog 生效前提）
 *   ④ 已由 §18.11 #4 覆盖（跳过）
 *   ⑤ removeTarget 不可达路径 ×3 + closing×terminal ERROR（§13.1 状态矩阵）
 *   ⑥ authorize rejection（§7 step1 R3/#6：INTERNAL_ERROR + 零 unhandled rejection）
 *   ⑦ 序列分配点 CLOSE 插队（§4.1：序列在帧实际出队发送时分配——交付序=序列序）
 *   ⑧ fence × 恢复 round / fence × bootstrap（R4/N-1：编码面同步 throw 收编；
 *      零 uncaught、恰 conflicted、IDENTITY_CHANGED 恰 1、无 INTERNAL_ERROR）
 *
 * 红灯纪律：真实 yjs / Registry / Runtime；fake-duplex；fake scheduler；零 real sleep；
 * 全部断言的终态投影与帧序均为可观察运行时行为（零源码 grep）。
 */
import { describe, expect, it } from 'vitest';
import { boot, advanceMs, collectUnhandledRejections } from './driver.js';
import { deferred, PEER_OWNER, settle } from './harness.js';

function errorCodesOf(decoded: Array<{ message: { kind: string } }>): string[] {
  return decoded
    .filter((f) => f.message.kind === 'ERROR')
    .map((f) => (f.message as unknown as { code: string }).code);
}

describe('R3/R4 补测：恢复窗口 / fence 竞态 / fanout 溢出 / removeTarget 矩阵 / authorize rejection / 序列分配点', () => {
  it('① 恢复窗口 UPDATE 容忍：ackTimeout 恢复期 hub UPDATE 照常 apply+ACK、零 NAMESPACE_STATE_VIOLATION、回 live', async () => {
    const probe = collectUnhandledRejections();
    try {
      const run = await boot({ timeouts: { ackTimeoutMs: 200 } });
      // 悬挂 hub 首笔 apply 的 dirty（ACK 未回）
      run.hubNode.persistence.saveGate = deferred();
      await run.writePeer({ n: 1 });
      await settle();
      expect(run.peerFrames('UPDATE')).toHaveLength(1);
      // ACK timeout → needs-resync + 同连接立即恢复 round（r2，Step1 已在途）
      await advanceMs(run, 200);
      await run.waitNamespace('needs-resync');
      await run.waitPeerSent('SYNC_STEP1', 2);
      // 恢复窗口期 hub 新写 → fan-out UPDATE（hub 通道镜像语义：恢复期入 queued、round 后 flush）。
      // 注意：writeHub 的 mutateRoot 走 hub 同一 write sequencer——gate 挂起期间 await 会排在
      // 挂起槽之后死锁——只发起不等待（操作已入队），释放 gate 后 await。
      const hubWrite = run.writeHub({ extra: 5 });
      // 释放 gate → 首笔 apply 完成（ACK 入 zombie 良性）→ 恢复 round 收口 → live → flush UPDATE
      const gate = run.hubNode.persistence.saveGate;
      run.hubNode.persistence.saveGate = undefined;
      if (gate !== undefined) gate.resolve();
      await hubWrite;
      await run.waitNamespace('live');
      await run.waitHubSent('UPDATE', 1);
      await settle();
      // 零 NAMESPACE_STATE_VIOLATION（恢复窗口的合法在途 UPDATE 不被误判）
      const violated = [
        ...errorCodesOf(run.hubFrames('ERROR')),
        ...errorCodesOf(run.peerFrames('ERROR')),
      ].filter((c) => c === 'NAMESPACE_STATE_VIOLATION' || c === 'SYNC_STATE_VIOLATION');
      expect(violated).toEqual([]);
      // 照常 apply + ACK：hub→peer UPDATE 由 peer apply（数据收敛）并回 UPDATE_ACK
      expect(run.rootValue('hub', 'extra')).toBe(5);
      expect(run.rootValue('peer', 'extra')).toBe(5);
      expect(run.peerFrames('UPDATE_ACK').length).toBeGreaterThanOrEqual(1);
      // 零 unhandled rejection
      await settle();
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });

  it('② bump×流量竞态终态确定：bump 后注入 UPDATE → conflicted、IDENTITY_CHANGED 恰 1、无 INTERNAL_ERROR、零 unhandled', async () => {
    const probe = collectUnhandledRejections();
    try {
      const run = await boot();
      const before = errorCodesOf(run.hubFrames('ERROR'));
      await run.bumpHubEpoch();
      await settle();
      // bump × 在途流量：注入合法 UPDATE（hub session 已被 fence → 拒绝 → 围栏判别 → one-shot）
      const evil = run.buildUpdateFrom('hub', (doc) => {
        (doc.getMap('ROOT') as unknown as Map<string, unknown>).set('n', 9);
      });
      run.injectPeer({ kind: 'UPDATE', namespaceId: run.nsId, update: evil });
      await run.waitNamespace('conflicted');
      // 恰一帧 IDENTITY_CHANGED（one-shot 记忆化）
      expect(run.hubFrames('IDENTITY_CHANGED')).toHaveLength(1);
      expect(
        (run.hubFrames('IDENTITY_CHANGED')[0]?.message as { replicationEpoch: number })
          .replicationEpoch,
      ).toBe(2);
      // 无 INTERNAL_ERROR（围栏命中不落 failed/内部错）
      const allCodes = [
        ...errorCodesOf(run.hubFrames('ERROR')),
        ...errorCodesOf(run.peerFrames('ERROR')),
      ];
      expect(allCodes.filter((c) => c === 'INTERNAL_ERROR')).toEqual([]);
      void before;
      // 零 unhandled rejection
      await settle();
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });

  it('③ session fanout 溢出消费：20 笔连发 → RESYNC/新 round → hub 收敛 n=19（第 20 笔落在 needs-resync 置位后的丢弃面）', async () => {
    const probe = collectUnhandledRejections();
    try {
      const run = await boot();
      // 20 笔连发（单 lease、并发提交——sequencer 槽串行、fanout 泵每投递让步 20 →
      // 容量 16 溢出：≥17 笔投递被弃 + session.status.needsResync（sticky）→ watchdog
      // 边沿 → §10.2 同构处置：RESYNC_REQUIRED + 窗口收口后同连接 round+1）
      const result = await run.peerNode.registry.open(PEER_OWNER, run.nsId);
      const r = result as { ok?: boolean; lease?: unknown };
      if (!r.ok || r.lease === undefined) throw new Error('bus 开失败');
      const lease = r.lease as {
        mutateRoot(input: unknown): Promise<{ ok: boolean }>;
        release(): Promise<void>;
      };
      await Promise.all(
        Array.from({ length: 20 }, (_, i) => lease.mutateRoot({ op: 'set', path: ['n'], value: i + 1 })),
      );
      await lease.release();
      await settle();
      // 溢出声明恰 1（发端 peer 本地未发送队列/session 层溢出信号 → RESYNC_REQUIRED）
      await run.waitPeerSent('RESYNC_REQUIRED', 1);
      expect(run.peerFrames('RESYNC_REQUIRED')).toHaveLength(1);
      // 新 round（同连接 r2）→ hub 收敛
      await run.waitPeerSent('SYNC_STEP1', 2);
      await run.waitNamespace('live');
      expect(run.peerFrames('SYNC_STEP1')).toHaveLength(2);
      expect(
        (run.peerFrames('SYNC_STEP1')[1]?.message as { syncRoundId: number }).syncRoundId,
      ).toBe(2);
      // 溢出路径丢弃了未发送的增量（部分写未达 hub 作 UPDATE——数量 < 20）
      expect(run.peerFrames('UPDATE').length).toBeLessThan(20);
      // 裁决（Phase 3 对齐记录 #5）：hub 收敛 n=20 是设计 §5.3 丢弃安全性论证的语义必然
      // ——任何被丢弃的增量都已提交本地 Y.Doc，下一 round 的 encodeDiff(对端 sv) 必然包含它；
      // 「n=19」需要「恢复 round 编码早于第 20 笔写提交」的额外排布，设计未钉死该时刻表
      // （§12 预算论证只钉 watchdog 探测窗口），实测实现按语义必然排布（diff 编码于写提交后）。
      // 机制语义（RESYNC×1 / roundId=2 / UPDATE<20 / needs-resync → 同连接收敛）全部成立。
      expect(run.rootValue('hub', 'n')).toBe(20);
      expect(run.rootValue('peer', 'n')).toBe(20);
      await settle();
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });

  it('⑤a removeTarget 不可达（targeted）：零拨号、零 wire 帧、本地收口 closed', async () => {
    const run = await boot({ start: false });
    expect(run.namespaceState()).toBe('targeted');
    expect(run.dialCount).toBe(0);
    await run.peer.removeTarget(run.nsId);
    expect(run.namespaceState()).toBe('closed');
    // 零 wire：从未拨号
    expect(run.wires).toHaveLength(0);
    expect(run.dialCount).toBe(0);
  });

  it('⑤b removeTarget 不可达（disconnected）：零新帧、本地收口 closed', async () => {
    const run = await boot();
    run.wire.closePeerSide(1006, 'network lost');
    await run.waitNamespace('disconnected');
    const framesBefore = run.wire.peerToHub.length;
    await run.peer.removeTarget(run.nsId);
    expect(run.namespaceState()).toBe('closed');
    expect(run.wire.peerToHub.length).toBe(framesBefore);
    expect(run.peerFrames('CLOSE_NAMESPACE')).toHaveLength(0);
  });

  it('⑤c removeTarget 不可达（终态 conflicted/failed）：零 CLOSE 帧、本地收口 closed', async () => {
    // conflicted
    const runC = await boot({
      peerReplica: { replicationId: 'b'.repeat(32), replicationEpoch: 1, rootN: 5 },
      waitFor: 'conflicted',
    });
    await runC.peer.removeTarget(runC.nsId);
    expect(runC.namespaceState()).toBe('closed');
    expect(runC.peerFrames('CLOSE_NAMESPACE')).toHaveLength(0);
    // failed（authorize 拒绝）
    const runF = await boot({
      authorize: async () => ({ ok: false }),
      waitFor: 'failed',
    });
    await runF.peer.removeTarget(runF.nsId);
    expect(runF.namespaceState()).toBe('closed');
    expect(runF.peerFrames('CLOSE_NAMESPACE')).toHaveLength(0);
  });

  it('⑤d closing 中到达 terminal namespace ERROR：维持 closing、收敛 closed（非 failed）、零回发帧', async () => {
    const run = await boot();
    // 悬挂在途 apply → CLOSE 帧先行、CLOSE_OK 未回（closing）
    run.hubNode.persistence.saveGate = deferred();
    await run.writePeer({ n: 1 });
    await settle();
    const closePromise = run.peer.removeTarget(run.nsId);
    await run.waitNamespace('closing');
    // 注入 terminal namespace ERROR（hub→peer 静默期，序列连续）
    run.injectHub({
      kind: 'ERROR',
      code: 'NAMESPACE_STATE_VIOLATION',
      safeMessage: 'protocol namespace violation',
      namespaceId: run.nsId,
    });
    await settle();
    // 不降级为 failed：只推进收口
    expect(run.namespaceState()).not.toBe('failed');
    expect(run.peerFrames('ERROR')).toHaveLength(0); // 零回发帧
    // 释放 → 已接纳 apply 完成 → CLOSE_OK → closed
    const gate = run.hubNode.persistence.saveGate;
    run.hubNode.persistence.saveGate = undefined;
    if (gate !== undefined) gate.resolve();
    await closePromise;
    await run.waitNamespace('closed');
    expect(run.rootValue('hub', 'n')).toBe(1);
  });

  it('⑥ authorize rejection：throwing adapter → INTERNAL_ERROR namespace ERROR + peer failed + 零 unhandled rejection', async () => {
    const probe = collectUnhandledRejections();
    try {
      const run = await boot({
        authorize: async () => {
          throw new Error('auth backend down');
        },
        waitFor: 'failed',
      });
      expect(errorCodesOf(run.hubFrames('ERROR'))).toContain('INTERNAL_ERROR');
      expect(run.namespaceState()).toBe('failed');
      expect(run.hubFrames('OPEN_OK')).toHaveLength(0);
      await settle();
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });

  it('⑦ 序列分配点：saveGate 积压下 CLOSE 插队 → 到达序严格 +1（CLOSE 序列=出队时刻分配）', async () => {
    const run = await boot({
      limits: { maxInFlightUpdates: 2, maxQueuedUpdateCount: 100 },
    });
    // 悬挂 hub 首笔 apply → 无 ACK → 窗口 2 保持满 → 第 3 笔入 queued
    run.hubNode.persistence.saveGate = deferred();
    await run.writePeer({ n: 1 });
    await run.writePeer({ n: 2 });
    await run.writePeer({ n: 3 });
    await settle();
    expect(run.peerFrames('UPDATE')).toHaveLength(2);
    // CLOSE 出队（control 优先级；序列号在出队时点分配——不得预占）
    await run.peer.removeTarget(run.nsId);
    await settle();
    const closes = run.peerFrames('CLOSE_NAMESPACE');
    expect(closes).toHaveLength(1);
    // 交付序 == 序列序：peer→hub 帧序列严格 [1..n]（否则 hub 判 SEQUENCE_VIOLATION 自伤）
    const seqs = run.frames().peerToHub.map((f) => f.header.sequence).sort((a, b) => a - b);
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
    // CLOSE 的序列恰为出队交付位置（bootstrap 路径帧占 seq 3–6）：
    // HELLO(1) OPEN(2) BOOTSTRAP_ACK(3) STEP1(4) STEP2(5) APPLIED(6) UPDATE(7) UPDATE(8) CLOSE(9)
    expect(closes[0]?.header.sequence).toBe(run.frames().peerToHub.length);
    expect(closes[0]?.header.sequence).toBe(9);
    // 第 3 笔 UPDATE 始终未发送（closing 停发）
    expect(run.peerFrames('UPDATE')).toHaveLength(2);
    // 释放 → CLOSE_OK → closed（收口完整性）
    const gate = run.hubNode.persistence.saveGate;
    run.hubNode.persistence.saveGate = undefined;
    if (gate !== undefined) gate.resolve();
    await run.waitNamespace('closed');
    expect(run.hubFrames('CLOSE_OK')).toHaveLength(1);
  });

  it('⑧a fence × 恢复 round：溢出恢复 r2 在途时 bump → 零 uncaught、恰 conflicted、IDENTITY_CHANGED 恰 1、无 INTERNAL_ERROR', async () => {
    const probe = collectUnhandledRejections();
    try {
      const run = await boot({
        limits: { maxInFlightUpdates: 1, maxQueuedUpdateCount: 1 },
        timeouts: { ackTimeoutMs: 200 },
      });
      // 溢出 → needs-resync + RESYNC_REQUIRED（无丢帧路径）
      run.hubNode.persistence.saveGate = deferred();
      await run.writePeer({ n: 1 });
      await run.writePeer({ extra: 2 });
      await settle();
      expect(run.peerFrames('RESYNC_REQUIRED')).toHaveLength(1);
      await run.waitNamespace('needs-resync');
      // bump 发起不等待：bumpReplicationEpoch 走 hub 同一 write sequencer——gate 挂起期间
      // await 会排在挂起槽之后死锁；发起即入队（排在 [n:1 apply(挂), bump 槽, r2 hub-apply] 序），
      // 释放 gate 后 bump 槽先行执行 → session fence → r2 的 hub apply/编码命中围栏 → one-shot。
      const bumpP = run.bumpHubEpoch();
      // 释放 → ACK 收口 → peer 同连接发起 r2（Step1 在途）→ hub 编码面（fence 后）收编于
      // 围栏判别 / 或 Step1 到达已终态通道（§9.2 首行静默忽略）——两序收敛同一终态
      const gate = run.hubNode.persistence.saveGate;
      run.hubNode.persistence.saveGate = undefined;
      if (gate !== undefined) gate.resolve();
      await bumpP;
      await run.waitNamespace('conflicted');
      await settle();
      // 恰一帧 IDENTITY_CHANGED + 零 INTERNAL_ERROR + 零 uncaught
      expect(run.hubFrames('IDENTITY_CHANGED')).toHaveLength(1);
      const codes = [
        ...errorCodesOf(run.hubFrames('ERROR')),
        ...errorCodesOf(run.peerFrames('ERROR')),
      ];
      expect(codes.filter((c) => c === 'INTERNAL_ERROR')).toEqual([]);
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });

  it('⑧b fence × bootstrap（OPEN(mode0) 竞态）：bump 与快照安装竞态 → conflicted（非 BOOTSTRAP_FAILED 卡死/崩溃）', async () => {
    const probe = collectUnhandledRejections();
    try {
      const run = await boot({ start: false });
      run.peerNode.persistence.importHold = deferred();
      run.peer.start();
      await run.waitNamespace('bootstrapping');
      // hub 快照已发（身份重读完成于 bump 前）→ bump → hub session fence
      await run.bumpHubEpoch();
      await settle();
      // 释放导入 → 快照安装成功（epoch1 快照 vs OPEN_OK 身份一致）→ ACK → r1 Step1
      // → hub 编码面 throw（fence）→ 围栏判别 → one-shot → peer conflicted（非卡死/非 BOOTSTRAP_FAILED）
      const hold = run.peerNode.persistence.importHold;
      run.peerNode.persistence.importHold = undefined;
      if (hold !== undefined) hold.resolve();
      await run.waitNamespace('conflicted');
      await settle();
      expect(run.hubFrames('IDENTITY_CHANGED')).toHaveLength(1);
      const codes = [
        ...errorCodesOf(run.hubFrames('ERROR')),
        ...errorCodesOf(run.peerFrames('ERROR')),
      ];
      expect(codes.filter((c) => c === 'BOOTSTRAP_FAILED' || c === 'INTERNAL_ERROR')).toEqual([]);
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });
});

