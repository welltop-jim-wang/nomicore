/**
 * SA6 回流红灯 —— SA4 R4 复审 R4-1（报告 `task_phase5-ws-namespace-sync_sa4_review.md`
 * 「SA4 R4 复审节」R4-1，verdict: reject（窄幅））。
 *
 * R4-1（MAJOR）connectionEpoch 代际守卫接线不完备——导入/session-open 续体未接判别：
 *   onBootstrapSnapshot 导入续体（importReplica + tryOpenReplicationSession await 后仅
 *   isConnectionDead）与 openSessionAndStartRound（入口检查在 await 之前、open 后仅
 *   isConnectionDead）均未捕获/比对 epoch；isConnectionDead = 终态 ∨ 'disconnected'
 *   ——一旦新生命周期离开 disconnected 停留域（'opening'），迟到续体照常推进。
 *   可达性（确定性）：Registry 每-ns carrier FIFO 使新生命周期 registry.open 排队在
 *   停泊导入 #1 之后 → 释放门闩时 state 恒 'opening'（结构性，非时序巧合）。
 *   违反：§13.4「连接已断」半句 + §13.3 重连修复承诺。
 *
 * staging 要点（SA4 报告明文）：释放时 state 为 opening（非 live）。
 *
 * 本 IT 只锚 R4-1；R4-2（unsubscribe 误杀新 listener）红锚 SA7 已落
 * （sa7-dynamic.test.ts D2 IT），不重复锚定。
 *
 * 红线纪律：真实 yjs / Registry / Runtime；fake-duplex；fake scheduler；零 real sleep；
 * 断言均为 wire 帧/错误码/状态投影/收敛数据（零源码 grep）。
 */
import { describe, expect, it } from 'vitest';
import type { DecodedMessage } from '@nomicore/replication-protocol';
import { boot, advanceMs } from './driver.js';
import { deferred, settle } from './harness.js';

function errorCodesOf(frames: DecodedMessage[]): string[] {
  return frames
    .filter((f) => f.message.kind === 'ERROR')
    .map((f) => (f.message as unknown as { code: string }).code);
}

describe('SA4 R4 复审回流红灯：R4-1 代际守卫未接导入/session-open 续体', () => {
  it('R4-1：导入悬挂 × 良性断线 → 重连（state opening）→ 释放 → 旧续体零 wire、新 OPEN 先行、零 NAMESPACE_STATE_VIOLATION、收敛 live', async () => {
    const run = await boot({ start: false });
    // bootstrap 导入悬挂（importHold）——快照已收、BOOTSTRAP_ACK 未发
    run.peerNode.persistence.importHold = deferred();
    run.peer.start();
    await run.waitHubSent('BOOTSTRAP_SNAPSHOT', 1);
    await run.waitNamespace('bootstrapping');
    // 良性断线（import 在途——cleanup 快：无 session/lease 可清）→ disconnected
    run.wire.closePeerSide(1006, 'network lost');
    await run.waitNamespace('disconnected');
    // backoff 首拨（默认 base=100、attempt=1 → cap=100ms）→ 重连 ready → 新生命周期
    // startOpen（registry.open #2 经每-ns carrier FIFO 排队在停泊 import #1 之后 →
    // state 恒 'opening'——isConnectionDead（终态 ∨ disconnected）结构性失效）
    await advanceMs(run, 200);
    await run.waitConnection('ready');
    await run.waitNamespace('opening');
    // 释放导入门闩 → #1 导入续体（importReplica + tryOpenReplicationSession await 后仅
    // isConnectionDead——'opening' 非死 → 照常推进：迟到 BOOTSTRAP_ACK/STEP1 落新连接）
    const hold = run.peerNode.persistence.importHold;
    run.peerNode.persistence.importHold = undefined;
    if (hold !== undefined) hold.resolve();
    await settle();
    // ── R4-1 红灯锚 1：零 NAMESPACE_STATE_VIOLATION（现实现：旧续体 BOOTSTRAP_ACK/STEP1
    //    先于新 OPEN 落新连接 → hub 无通道 → 2× NAMESPACE_STATE_VIOLATION）──
    const allCodes = [
      ...errorCodesOf(run.frames().hubToPeer),
      ...errorCodesOf(run.frames().peerToHub),
    ];
    expect(allCodes.filter((c) => c === 'NAMESPACE_STATE_VIOLATION')).toEqual([]);
    // ── R4-1 红灯锚 2：wire #2 第一个非握手帧必须是 OPEN_NAMESPACE（旧续体零 wire——
    //    无迟到 BOOTSTRAP_ACK/SYNC_STEP1 先于 OPEN；修复后新连接为 reconcile 单 OPEN）──
    const kinds = run.frames().peerToHub.map((f) => f.message.kind);
    const firstAfterHello = kinds.find((k) => k !== 'HELLO' && k !== 'HELLO_ACK');
    expect(firstAfterHello).toBe('OPEN_NAMESPACE');
    // ── R4-1 红灯锚 3：收敛 live（现实现：2× violation → ns 永久 failed）──
    await run.waitNamespace('live');
    expect(run.rootValue('peer', 'n')).toBe(42);
    expect(run.rootValue('hub', 'n')).toBe(42);
  });
});
