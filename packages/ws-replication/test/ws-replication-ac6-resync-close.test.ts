/**
 * SA6 红灯验收 —— issue #136 AC6：RESYNC_REQUIRED、ACK timeout、正常 close、terminal
 * ERROR、identity 变化、socket 断开与重连均到达指定 namespace 状态；无 durable outbox。
 *
 * 契约：docs/protocols/instance-replication-v1.md §9.4（RESYNC_REQUIRED 后不再发新
 * UPDATE；始终由 Peer 用新 roundId 发起下一轮）、§11（IDENTITY_CHANGED →
 * conflicted，META 不当普通 UPDATE 应用）、§12（CLOSE/CLOSE_OK、正常 close 不等丢失
 * ACK）、§13.2（错误终态）、§16（socket 断开 → disconnected、无 outbox、重连重 OPEN）、
 * §17（未发送队列上限 → needs-resync）、§18（ACK timeout → needs-resync，不重发同一
 * UPDATE）；ADR 0010 非目标（无 durable outbox）。
 *
 * 红灯纪律：真实 yjs / Registry / Runtime；fake-duplex；fake scheduler；零 real sleep。
 */
import { describe, expect, it } from 'vitest';
import { decodeMessage } from '@nomicore/replication-protocol';
import type {
  ResyncRequiredMsg,
  SyncStep1Msg,
  CloseNamespaceMsg,
  CloseOkMsg,
  IdentityChangedMsg,
  UpdateMsg,
} from '@nomicore/replication-protocol';
import { boot, advanceMs } from './driver.js';
import type { Run } from './driver.js';
import { deferred, settle } from './harness.js';

function asMsg<T extends { kind: string }>(frame: { message: { kind: string } } | undefined, kind: T["kind"]): T | undefined {
  if (frame === undefined) return undefined;
  return frame.message.kind === kind ? (frame.message as T) : undefined;
}

function errorCodes(decoded: Array<{ message: { kind: string } }>): string[] {
  return decoded
    .filter((f) => f.message.kind === 'ERROR')
    .map((f) => (f.message as unknown as { code: string }).code);
}

describe('AC6：resync / ACK timeout / close / terminal ERROR / identity / socket loss / reconnect', () => {
  it('RESYNC_REQUIRED：队列溢出 → needs-resync + RESYNC_REQUIRED；随后新 roundId 重收口到 live，丢弃增量由 diff 补齐', async () => {
    const run = await boot({
      limits: { maxInFlightUpdates: 1, maxQueuedUpdateCount: 1 },
    });
    // 门闩：hub 第一笔 apply 的 dirty 挂起 → 窗口保持满
    run.hubNode.persistence.saveGate = deferred();
    await run.writePeer({ n: 1 });
    await run.writePeer({ extra: 2 }); // 队列溢出（cap=1）
    await settle();

    // 未发送增量被丢弃并置 needs-resync；发出 RESYNC_REQUIRED
    expect(run.namespaceState()).toBe('needs-resync');
    const resyncs = run.peerFrames('RESYNC_REQUIRED');
    expect(resyncs).toHaveLength(1);
    expect(asMsg<ResyncRequiredMsg>(resyncs[0], 'RESYNC_REQUIRED')?.namespaceId).toBe(run.nsId);
    // 溢出后不再发送新 UPDATE（只有 1 个 UPDATE 曾发出）
    expect(run.peerFrames('UPDATE')).toHaveLength(1);

    // 放行窗口 → ACK 收口 → Peer 以新 roundId 发起下一轮
    const gate = run.hubNode.persistence.saveGate;
    run.hubNode.persistence.saveGate = undefined;
    if (gate !== undefined) gate.resolve();
    await run.waitNamespace('live');
    // §18.11 #3（R2 对齐：CP-2 溢出为 channel 级事件、同连接恢复）：当前 wire 上
    // SYNC_STEP1 = [r1(bootstrap), r2(恢复)] 两帧；roundId 计数器 per-target 持久
    const step1s = run.peerFrames('SYNC_STEP1');
    expect(step1s).toHaveLength(2);
    expect(asMsg<SyncStep1Msg>(step1s[1], 'SYNC_STEP1')?.syncRoundId).toBe(2);
    // 丢弃的增量经 diff 修复（extra=2 已收敛）
    expect(run.rootValue('hub', 'extra')).toBe(2);
    expect(run.rootValue('hub', 'n')).toBe(1);
  });

  it('ACK timeout：不重发同一 UPDATE；needs-resync → 新 round 响应触发 SEQUENCE_VIOLATION fatal → 重建后收敛（跨连接形态）', async () => {
    const run = await boot({
      timeouts: { ackTimeoutMs: 200 },
    });
    // 丢 hub 的第一个 UPDATE_ACK（CP-1 注入点：连接内 gap 于真实传输不可达，fatal 为正确响应）
    run.dropNextHubFrame('UPDATE_ACK');
    await run.writePeer({ n: 9 });
    await settle();
    expect(run.peerFrames('UPDATE')).toHaveLength(1);
    const sent = asMsg<UpdateMsg>(run.peerFrames('UPDATE')[0], 'UPDATE');
    // ACK 超时 → needs-resync（timer 锚保留）
    await advanceMs(run, 200);
    await run.waitNamespace('needs-resync');
    // §18.11 #4（R2 对齐：CP-1 序列纪律 ADR 字面）：peer 同连接立即以 roundId+1 发起新 round；
    // hub 对该 round 的响应帧携带 gap → 连接内增量连续性作废 → SEQUENCE_VIOLATION fatal
    await run.waitPeerSent('SYNC_STEP1', 2);
    expect(asMsg<SyncStep1Msg>(run.peerFrames('SYNC_STEP1')[1], 'SYNC_STEP1')?.syncRoundId).toBe(2);
    await run.waitNamespace('disconnected');
    expect(run.connectionState()).toBe('blocked');
    // 测试侧 addTarget（config-change 重建，§14.1）→ 重连 re-OPEN/reconcile → 收敛
    run.peer.addTarget(run.target);
    await advanceMs(run, 200);
    await run.waitNamespace('live');
    expect(run.rootValue('hub', 'n')).toBe(9);
    // 「不重发同一 UPDATE」沿全帧聚合基面（peerFramesAll）：全生命周期恰一帧、字节一致
    const updatesAll = run.peerFramesAll('UPDATE');
    expect(updatesAll).toHaveLength(1);
    expect((updatesAll[0] as { message: { update: Uint8Array } }).message.update).toEqual(sent?.update);
  });

  it('正常 close：removeTarget → CLOSE_NAMESPACE → CLOSE_OK(ackedSequence) → closed；不等待在途 ACK（无丢帧形态）', async () => {
    const run = await boot();
    // §18.11 #5（R2 对齐：CP-1 序列纪律 ADR 字面）：「不等待 ACK」以无丢帧形式表达——
    // saveGate 悬挂在途 apply（ACK 未发出）即 removeTarget，close 不等待其收口
    run.hubNode.persistence.saveGate = deferred();
    await run.writePeer({ n: 3 });
    await settle();
    expect(run.peerFrames('UPDATE')).toHaveLength(1);
    const closePromise = run.peer.removeTarget(run.nsId);
    await settle();
    expect(run.peerFrames('CLOSE_NAMESPACE')).toHaveLength(1);
    expect(run.hubFrames('CLOSE_OK')).toHaveLength(0); // 在途 apply 未 settle → CLOSE_OK 未出
    expect(run.namespaceState()).toBe('closing');
    // 释放 → 已接纳 apply 完成 → CLOSE_OK → closed
    const gate = run.hubNode.persistence.saveGate;
    run.hubNode.persistence.saveGate = undefined;
    if (gate !== undefined) gate.resolve();
    await closePromise;
    await run.waitNamespace('closed');

    const closes = run.peerFrames('CLOSE_NAMESPACE');
    expect(closes).toHaveLength(1);
    const close = asMsg<CloseNamespaceMsg>(closes[0], 'CLOSE_NAMESPACE');
    expect(close?.namespaceId).toBe(run.nsId);
    const closeOks = run.hubFrames('CLOSE_OK');
    expect(closeOks).toHaveLength(1);
    const closeOk = asMsg<CloseOkMsg>(closeOks[0], 'CLOSE_OK');
    expect(closeOk?.ackedSequence).toBe(closes[0]?.header.sequence);

    // 已接纳 apply 不丢
    expect(run.rootValue('hub', 'n')).toBe(3);
    // 幂等 removeTarget（合流）
    await run.peer.removeTarget(run.nsId);
    // closed 后 addTarget → 整连接重建（§16「重新 add 必须重建连接」）→ re-OPEN → live
    //（NAMESPACE_REOPEN_REQUIRES_RECONNECT 语义由 AC1/AC2 注入式 reopen 用例覆盖）
    const dials = run.dialCount;
    run.peer.addTarget(run.target);
    await run.waitNamespace('live');
    expect(run.dialCount).toBeGreaterThan(dials);
  });

  it('terminal ERROR → failed：namespace 收口后不再有后续帧', async () => {
    const run = await boot();
    // 注入命名空间级终止 ERROR（模拟远端终止）；peer 静默期
    run.injectHub({
      kind: 'ERROR',
      code: 'NAMESPACE_STATE_VIOLATION',
      safeMessage: 'protocol namespace violation',
      namespaceId: run.nsId,
    });
    await run.waitNamespace('failed');
    expect(run.peerFrames('CLOSE_NAMESPACE')).toHaveLength(0);
    // 后续 peer 不再为 namespace 发 UPDATE（对 local write 静默）
    await run.writePeer({ n: 1 });
    await settle();
    expect(run.peerFrames('UPDATE')).toHaveLength(0);
  });

  it('IDENTITY_CHANGED：Hub epoch bump → conflicted；META 不当普通 live UPDATE 应用；本地副本身份不变', async () => {
    const run = await boot();
    expect(run.metaValue('peer', 'replicationEpoch')).toBe(1);
    await run.bumpHubEpoch();
    await run.waitNamespace('conflicted');

    const identityFrames = run.hubFrames('IDENTITY_CHANGED');
    expect(identityFrames).toHaveLength(1);
    const changed = asMsg<IdentityChangedMsg>(identityFrames[0], 'IDENTITY_CHANGED');
    expect(changed?.replicationEpoch).toBe(2);
    expect(changed?.replicationId).toBe(run.hubFixture?.identity.replicationId);
    // META 变化绝不以 UPDATE 帧应用
    expect(run.hubFrames('UPDATE')).toHaveLength(0);
    // peer 本地副本的 epoch 保持 1（未被覆盖/合并）
    expect(run.metaValue('peer', 'replicationEpoch')).toBe(1);
  });

  it('socket 断开：namespace → disconnected、无 outbox；重连后 state-vector round 修复断线写', async () => {
    const run = await boot({
      backoff: { baseMs: 50, maxMs: 400, resetAfterMs: 500 },
      random: () => 0.5,
    });
    // 断线（网络级，1006）
    run.wire.closePeerSide(1006, 'network lost');
    await run.waitNamespace('disconnected');
    expect(run.connectionState()).toBe('backoff');

    // 断线期间本地写（无 outbox：不存任何待发 UPDATE）
    await run.writePeer({ extra: 55 });
    await settle();
    expect(run.peerFrames('UPDATE')).toHaveLength(0);

    // backoff（full-jitter 0.5 × 50ms = 25ms）→ 重连 → 重 OPEN/reconcile → live
    await advanceMs(run, 25);
    await run.waitConnection('ready');
    expect(run.dialCount).toBe(2);
    await run.waitNamespace('live');
    // 断线写经 diff 收敛（hub 内存已追上）
    expect(run.rootValue('hub', 'extra')).toBe(55);
    // 重连路径：新 OPEN 声明 reconcile；无任何 UPDATE 帧被重放
    const latestOpenFrames = run.wires[1]?.peerToHub.map((b) => decodeMessage(b).message.kind) ?? [];
    expect(latestOpenFrames).toContain('OPEN_NAMESPACE');
    expect(latestOpenFrames.filter((k) => k === 'UPDATE')).toHaveLength(0);
  });

  it('bootstrap 中断线：重连后从快照重新 bootstrap 到 live（竞态由新一次完整 snapshot 补齐）', async () => {
    const run = await boot({
      start: false,
      backoff: { baseMs: 50, maxMs: 400, resetAfterMs: 500 },
      random: () => 0.5,
    });
    run.peer.start();
    await run.waitConnection('ready');
    // 丢第一个 BOOTSTRAP_SNAPSHOT（模拟中途断线前的丢失）
    run.wire.dropNextHubToPeer((bytes) => decodeMessage(bytes).message.kind === 'BOOTSTRAP_SNAPSHOT');
    await run.waitNamespace('bootstrapping');
    run.wire.closePeerSide(1006, 'network lost');
    await run.waitNamespace('disconnected');
    await advanceMs(run, 25);
    await run.waitConnection('ready');
    expect(run.dialCount).toBe(2);
    await run.waitNamespace('live');
    expect(run.rootValue('peer', 'n')).toBe(42);
  });
});
