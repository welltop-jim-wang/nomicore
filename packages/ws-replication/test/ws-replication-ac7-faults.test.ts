/**
 * SA6 红灯验收 —— issue #136 AC7：fake-duplex 确定性故障注入覆盖 namespace 与 sync
 * 状态机——错序帧、重复控制帧、apply 失败、degraded 行为、cleanup 竞态。
 *
 * 契约：docs/protocols/instance-replication-v1.md §7.2（OPEN_OK 前不得收发 sync/update）、
 * §9.3（重复/错序/错误 round → SYNC_STATE_VIOLATION）、§12（已接纳 apply 无条件完成、
 * 清理只在 apply settle 后执行）、§13.2（终态）、§16（单一生命周期队列、合流 Promise）、
 * §17（构造期响亮校验）、§20（保护检查与 degraded、scratch malformed → APPLY_FAILED）；
 * phase-5 §测试 seam（故障注入覆盖丢帧、重复帧、乱序、flush failure、shutdown race）。
 *
 * 红灯纪律：真实 yjs / Registry / Runtime；fake-duplex；saveDoc 门闩做竞态锚；零 real sleep。
 */
import { describe, expect, it } from 'vitest';
import type { ErrorMsg } from '@nomicore/replication-protocol';
import { boot, advanceMs } from './driver.js';
import { createPeerReplication } from '@nomicore/ws-replication';
import type { DuplexTransport } from '@nomicore/ws-replication';
import { deferred, HUB_INSTANCE, PEER_INSTANCE, settle } from './harness.js';
import * as Y from 'yjs';

function errorFrames(decoded: Array<{ message: { kind: string } }>): ErrorMsg[] {
  return decoded
    .filter((f) => f.message.kind === 'ERROR')
    .map((f) => f.message as unknown as ErrorMsg);
}

function errorCodes(decoded: Array<{ message: { kind: string } }>): string[] {
  return errorFrames(decoded).map((e) => e.code);
}

describe('AC7：fake-duplex 确定性故障注入', () => {
  it('错序：OPEN_OK 之前的 UPDATE → NAMESPACE_STATE_VIOLATION（§7.2 OPEN 前不得收发 namespace 帧）', async () => {
    // 授权门闩：让第一个 OPEN 悬停在 opening——注入 UPDATE 先于 OPEN_OK 到达
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let calls = 0;
    const run = await boot({
      start: false,
      authorize: async () => {
        calls += 1;
        if (calls === 1) await gate;
        return { ok: true, localOwner: { userId: 'hub-owner-9f38' }, permissions: { read: true, submit: true } };
      },
    });
    run.peer.start();
    await settle();
    expect(run.authorizer.calls).toHaveLength(1);
    // OPEN 已发出并悬停于授权；注入 UPDATE（无 OPEN_OK）
    run.injectPeer({ kind: 'UPDATE', namespaceId: run.nsId, update: new Uint8Array([1, 2, 3]) });
    await settle();
    expect(errorCodes(run.hubFrames('ERROR'))).toContain('NAMESPACE_STATE_VIOLATION');
    release();
    await settle();
  });

  it('重复控制帧：同 round 重复 SYNC_APPLIED → SYNC_STATE_VIOLATION（控制帧不靠幂等静默吞掉）', async () => {
    const run = await boot({
      start: false,
      peerReplica: { rootN: 5, ext: 7 },
    });
    run.peer.start();
    await run.waitConnection('ready');
    // 冻结：hub→peer 第一个 SYNC_APPLIED 被丢 → 真实 peer 停在 reconciling（静默）
    run.dropNextHubFrame('SYNC_APPLIED');
    await run.waitNamespace('reconciling');
    await run.waitPeerSent('SYNC_APPLIED', 1);
    await settle();
    // 注入重复 Applied（同 round、同 ackedSequence）——peer 已无后续帧
    const firstApplied = run.peerFrames('SYNC_APPLIED')[0] as { message: { ackedSequence: number } };
    run.injectPeer({
      kind: 'SYNC_APPLIED',
      namespaceId: run.nsId,
      syncRoundId: 1,
      ackedSequence: firstApplied.message.ackedSequence,
    });
    await settle();
    // §18.11 #6（R2 对齐：CP-1 序列纪律 ADR 字面）：hub 判定不变（ERROR 帧仍在 wire 上），
    // 但 ERROR 帧携带 gap（SYNC_APPLIED 已被注入丢帧）→ peer 先判 SEQUENCE_VIOLATION
    // connection fatal → ns 投影 disconnected、连接 blocked
    expect(errorCodes(run.hubFrames('ERROR'))).toContain('SYNC_STATE_VIOLATION');
    await run.waitNamespace('disconnected');
    expect(run.connectionState()).toBe('blocked');
  });

  it('apply 失败：无法解码的 update → APPLY_FAILED 且 live 零写入（无 ACK）', async () => {
    const run = await boot();
    const before = run.saveEvents('hub');
    run.injectPeer({
      kind: 'UPDATE',
      namespaceId: run.nsId,
      update: new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x00, 0x01]),
    });
    await settle();
    expect(errorCodes(run.hubFrames('ERROR'))).toContain('APPLY_FAILED');
    expect(run.hubFrames('UPDATE_ACK')).toHaveLength(0);
    expect(run.saveEvents('hub')).toBe(before);
    expect(run.rootValue('hub', 'n')).toBe(42);
    await run.waitNamespace('failed');
  });

  it('degraded（hub 侧）：PERSISTENCE_DEGRADED 拒绝 peer update；恢复后 reconciliation 补齐', async () => {
    const run = await boot();
    run.setDegraded('hub', true);
    const before = run.saveEvents('hub');
    await run.writePeer({ n: 1 });
    await settle();
    expect(errorCodes(run.hubFrames('ERROR'))).toContain('PERSISTENCE_DEGRADED');
    expect(run.hubFrames('UPDATE_ACK')).toHaveLength(0);
    expect(run.rootValue('hub', 'n')).toBe(42);
    expect(run.saveEvents('hub')).toBe(before);
    await run.waitNamespace('failed');
    // 恢复 → 重连 → reconciliation 补齐
    run.setDegraded('hub', false);
    run.wire.closePeerSide(1006, 'reconnect');
    await run.waitNamespace('disconnected');
    await advanceMs(run, 25_000); // 覆盖默认 backoff 首拨上界（<100ms）
    await run.waitConnection('ready');
    await run.waitNamespace('live');
    expect(run.rootValue('hub', 'n')).toBe(1);
  });

  it('degraded（peer 侧）：hub→peer 仍内存 apply + saveDoc 登记；UPDATE_ACK 照发', async () => {
    const run = await boot();
    run.setDegraded('peer', true);
    const before = run.saveEvents('peer');
    await run.writeHub({ extra: 88 });
    await settle();
    // 内存已追上（degraded bypass 只属 hub→peer 可信会话）
    expect(run.rootValue('peer', 'extra')).toBe(88);
    // dirty 登记仍在（ADR 0010：不得绕过 saveDoc）
    expect(run.saveEvents('peer')).toBe(before + 1);
    // ACK 照发
    expect(run.hubFrames('UPDATE_ACK')).toHaveLength(1);
  });

  it('cleanup 竞态：removeTarget 与在途 apply 并发——已接纳 apply 无条件完成，CLOSE_OK 只在 apply settle 后', async () => {
    const run = await boot();
    // 门闩：hub 首笔 apply 的 dirty 挂起（apply 已被 sequencer 接纳）
    run.hubNode.persistence.saveGate = deferred();
    await run.writePeer({ n: 1 });
    await settle();
    expect(run.peerFrames('UPDATE')).toHaveLength(1);
    // removeTarget → CLOSE 帧发出；hub 的生命周期队列必须等待在途 apply
    const closePromise = run.peer.removeTarget(run.nsId);
    await settle();
    expect(run.peerFrames('CLOSE_NAMESPACE')).toHaveLength(1);
    expect(run.hubFrames('CLOSE_OK')).toHaveLength(0);
    expect(run.namespaceState()).toBe('closing');
    // 释放 dirty → apply 完成 → CLOSE_OK → closed
    const gate = run.hubNode.persistence.saveGate;
    run.hubNode.persistence.saveGate = undefined;
    if (gate !== undefined) gate.resolve();
    await closePromise;
    await run.waitNamespace('closed');
    expect(run.hubFrames('CLOSE_OK')).toHaveLength(1);
    expect(run.rootValue('hub', 'n')).toBe(1); // apply 不丢
  });

  it('cleanup 竞态：socket 断开与在途 apply 并发——已接纳 apply 无条件完成（drain）', async () => {
    const run = await boot();
    run.hubNode.persistence.saveGate = deferred();
    await run.writePeer({ n: 1 });
    await settle();
    // socket 断开（hub 端保持已接纳 apply）
    run.wire.closePeerSide(1006, 'lost');
    const gate = run.hubNode.persistence.saveGate;
    run.hubNode.persistence.saveGate = undefined;
    if (gate !== undefined) gate.resolve();
    await settle();
    // 已接纳 apply 完成：hub 内存已提交
    expect(run.rootValue('hub', 'n')).toBe(1);
  });

  it('cleanup 合流：并发 removeTarget ×2 → 合并到同一清理（恰一个 CLOSE 帧、两承诺同 settle）', async () => {
    const run = await boot();
    const p1 = run.peer.removeTarget(run.nsId);
    const p2 = run.peer.removeTarget(run.nsId);
    await Promise.all([p1, p2]);
    await run.waitNamespace('closed');
    expect(run.peerFrames('CLOSE_NAMESPACE')).toHaveLength(1);
  });

  it('构造期响亮校验（§17）：maxInFlightUpdates<1 / lowWater>=highWater / maxUpdateBytes 超 frame 上限 → 同步 TypeError，绝不运行时 clamp', async () => {
    const run = await boot({ start: false });
    const base = {
      instanceId: PEER_INSTANCE,
      hubInstanceId: HUB_INSTANCE,
      registry: run.peerNode.registry,
      dial: () => makeClosedTransport(),
      timer: run.peerNode.scheduler,
      targets: [{ namespaceId: run.nsId, localOwner: { userId: 'peer-owner-7e21' } }],
    };
    expect(() => createPeerReplication({ ...base, limits: { maxInFlightUpdates: 0 } })).toThrow(TypeError);
    expect(() =>
      createPeerReplication({ ...base, limits: { lowWater: 1024, highWater: 512 } }),
    ).toThrow(TypeError);
    expect(() =>
      createPeerReplication({
        ...base,
        limits: { maxUpdateBytes: 16 * 1024 * 1024, maxFrameBytes: 8 * 1024 * 1024 },
      }),
    ).toThrow(TypeError);
    // 合法边界配置可构造（低水位 < 高水位、窗口 >= 1）
    expect(() =>
      createPeerReplication({
        ...base,
        limits: { lowWater: 256, highWater: 512, maxInFlightUpdates: 1 },
      }),
    ).not.toThrow();
  });

  it('保护检查（§20）：peer→hub SCHEMA 篡改 → PROTECTED_FIELD_MUTATION 且 live 零写入', async () => {
    const run = await boot();
    // 构造真实 diff：克隆 hub 状态后改 SCHEMA（受保护：hub 侧 SCHEMA 全容器 + META 全键）
    const clone = run.snapshotDoc('hub');
    (clone.getMap('SCHEMA') as unknown as Map<string, unknown>).set('lang', 'evil');
    const evil = Y.encodeStateAsUpdate(clone, run.stateVectorOf('hub'));
    const before = run.saveEvents('hub');
    run.injectPeer({ kind: 'UPDATE', namespaceId: run.nsId, update: evil });
    await settle();
    expect(errorCodes(run.hubFrames('ERROR'))).toContain('PROTECTED_FIELD_MUTATION');
    expect(run.hubFrames('UPDATE_ACK')).toHaveLength(0);
    expect(run.rootValue('hub', 'n')).toBe(42);
    expect(run.saveEvents('hub')).toBe(before);
  });

  it('保护检查（§20）：peer→hub 复制身份 META 篡改 → PROTECTED_FIELD_MUTATION（身份不漂移）', async () => {
    const run = await boot();
    const clone = run.snapshotDoc('hub');
    (clone.getMap('META') as unknown as Map<string, unknown>).set('replicationId', 'f'.repeat(32));
    const evil = Y.encodeStateAsUpdate(clone, run.stateVectorOf('hub'));
    run.injectPeer({ kind: 'UPDATE', namespaceId: run.nsId, update: evil });
    await settle();
    expect(errorCodes(run.hubFrames('ERROR'))).toContain('PROTECTED_FIELD_MUTATION');
    expect(run.metaValue('hub', 'replicationId')).toBe(run.hubFixture?.identity.replicationId);
    expect(run.rootValue('hub', 'n')).toBe(42);
  });

  it('错误 round（§9.3）：不依赖 Yjs 幂等静默吞掉——SYNC_STATE_VIOLATION', async () => {
    const run = await boot({
      start: false,
      peerReplica: { rootN: 5, ext: 7 },
    });
    run.peer.start();
    await run.waitConnection('ready');
    // 冻结在 round 收尾（丢 hub 的 SYNC_APPLIED）→ 真实 peer 静默
    run.dropNextHubFrame('SYNC_APPLIED');
    await run.waitNamespace('reconciling');
    await run.waitPeerSent('SYNC_APPLIED', 1);
    await settle();
    // 注入「错误 round」的 Step2（roundId=500，不存在）
    run.injectPeer({
      kind: 'SYNC_STEP2',
      namespaceId: run.nsId,
      syncRoundId: 500,
      relatedStep1Sequence: 1,
      update: new Uint8Array([0]),
    });
    await settle();
    // §18.11 #7（R2 对齐：CP-1 序列纪律 ADR 字面）：同 #6——hub 判定不变，ERROR 帧携带 gap；
    // peer 先判 SEQUENCE_VIOLATION connection fatal → disconnected + blocked
    expect(errorCodes(run.hubFrames('ERROR'))).toContain('SYNC_STATE_VIOLATION');
    await run.waitNamespace('disconnected');
    expect(run.connectionState()).toBe('blocked');
  });
});

function makeClosedTransport(): DuplexTransport {
  let closed = false;
  return {
    send: () => {},
    close: () => {
      closed = true;
    },
    get closed() {
      return closed;
    },
    onMessage: () => () => {},
    onClose: () => () => {},
  };
}
