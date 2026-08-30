/**
 * SA6 红灯验收 —— issue #136 AC5：live UPDATE/UPDATE_ACK 语义；每个远端 update 都经
 * ReplicationSession 排序并完成 dirty notification；Hub 单 observer 多 session fan-out；
 * 滑动窗口与回声抑制。
 *
 * 契约：docs/protocols/instance-replication-v1.md §10（UPDATE/UPDATE_ACK、Hub 接收四步、
 * 窗口默认 32、重复 update 正常 ACK、ACK_STATE_VIOLATION）、§13.2（UPDATE_TOO_LARGE）、
 * §17（滑动窗口只暂停该 namespace）；ADR 0010（ACK = sequenced apply + dirty）。
 *
 * 红灯纪律：真实 yjs / Registry / Runtime；fake-duplex；saveDoc 门闩做时序锚；零 real sleep。
 */
import { describe, expect, it } from 'vitest';
import { decodeMessage } from '@nomicore/replication-protocol';
import type { UpdateMsg, UpdateAckMsg } from '@nomicore/replication-protocol';
import { boot, bootFanout } from './driver.js';
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

describe('AC5：Live UPDATE/UPDATE_ACK 与排序、dirty、fan-out、窗口', () => {
  it('UPDATE → Hub 单槽 apply+dirty → UPDATE_ACK（ackedSequence=UPDATE 的 sequence），Hub 数据收敛', async () => {
    const run = await boot();
    const before = run.saveEvents('hub');
    await run.writePeer({ n: 7 });
    await settle();

    // —— 单向帧：恰一个 UPDATE ——
    const updates = run.peerFrames('UPDATE');
    expect(updates).toHaveLength(1);
    const update = asMsg<UpdateMsg>(updates[0], 'UPDATE');
    expect(update?.namespaceId).toBe(run.nsId);
    expect(update?.update.length).toBeGreaterThan(0);

    // —— ACK 对应 sequence ——
    const acks = run.hubFrames('UPDATE_ACK');
    expect(acks).toHaveLength(1);
    const ack = asMsg<UpdateAckMsg>(acks[0], 'UPDATE_ACK');
    expect(ack?.ackedSequence).toBe(updates[0]?.header.sequence);

    // —— 远端 update 已进 sequencer 并登记 dirty ——
    expect(run.saveEvents('hub')).toBe(before + 1);
    expect(run.rootValue('hub', 'n')).toBe(7);
  });

  it('ACK 语义：只在 sequenced live apply + dirty notification 完成后发出（saveDoc 门闩时序）', async () => {
    const run = await boot();
    // 在 hub dirty notification 路径上放门闩
    run.hubNode.persistence.saveGate = deferred();
    await run.writePeer({ n: 7 });
    await settle();
    // 帧已到达 hub、apply 已进 sequencer（saveDoc 挂起）→ ACK 不得先出
    expect(run.peerFrames('UPDATE')).toHaveLength(1);
    expect(run.hubFrames('UPDATE_ACK')).toHaveLength(0);
    // 释放 dirty → ACK 才出现
    const gate = run.hubNode.persistence.saveGate;
    run.hubNode.persistence.saveGate = undefined;
    if (gate !== undefined) gate.resolve();
    await settle();
    expect(run.hubFrames('UPDATE_ACK')).toHaveLength(1);
    expect(run.rootValue('hub', 'n')).toBe(7);
  });

  it('Hub 单 observer 多 session fan-out：A 的 update 不回送 A，B 收到 UPDATE 并 ACK，B 数据收敛', async () => {
    const fan = await bootFanout();
    await fan.peerA.getNamespaceState(fan.nsId); // 已 live（bootFanout 内等待）
    // A 写 → hub 单 observer fan-out
    const aBusy = await openBusinessLease(fan.peerANode, fan.nsId);
    const result = await aBusy.mutateRoot({ op: 'set', path: ['n'], value: 11 });
    if (!result.ok) throw new Error(`A 写失败：${JSON.stringify(result)}`);
    await settle();

    // —— 回声抑制：A 的 hub→peer 方向没有任何 UPDATE ——
    const aHubFrames = decodeAll(fan.wireA.hubToPeer);
    expect(aHubFrames.filter((f) => f.message.kind === 'UPDATE')).toHaveLength(0);

    // —— B 收到 fan-out UPDATE 并 ACK ——
    const bHubFrames = decodeAll(fan.wireB.hubToPeer);
    const updatesToB = bHubFrames.filter((f) => f.message.kind === 'UPDATE');
    expect(updatesToB).toHaveLength(1);
    const bPeerFrames = decodeAll(fan.wireB.peerToHub);
    const bAcks = bPeerFrames.filter((f) => f.message.kind === 'UPDATE_ACK');
    expect(bAcks.length).toBeGreaterThanOrEqual(1);
    expect(bAcks[bAcks.length - 1]?.message.kind).toBe('UPDATE_ACK');

    // —— B 数据收敛（内存已追上）——
    expect(rootValueOf(fan.peerBNode, fan.nsId, 'n')).toBe(11);
  });

  it('滑动窗口：maxInFlightUpdates=2 时第三笔 UPDATE 被抑制；窗口收口后放行', async () => {
    const run = await boot({
      limits: { maxInFlightUpdates: 2, maxQueuedUpdateCount: 100 },
    });
    // 门闩：hub 第一笔 apply 的 dirty 挂起 → 前两个 ACK 停滞 → 窗口保持满
    run.hubNode.persistence.saveGate = deferred();
    await run.writePeer({ n: 1 });
    await run.writePeer({ n: 2 });
    await run.writePeer({ n: 3 });
    await settle();
    // 窗口 2：最多 2 个 in-flight UPDATE
    expect(run.peerFrames('UPDATE')).toHaveLength(2);
    expect(run.hubFrames('UPDATE_ACK')).toHaveLength(0);
    // 放行 → ACK 回来 → 第三笔发出
    const gate = run.hubNode.persistence.saveGate;
    run.hubNode.persistence.saveGate = undefined;
    if (gate !== undefined) gate.resolve();
    await settle();
    expect(run.peerFrames('UPDATE')).toHaveLength(3);
    expect(run.hubFrames('UPDATE_ACK')).toHaveLength(3);
    expect(run.rootValue('hub', 'n')).toBe(3);
  });

  it('重复/已包含 update 仍正常 ACK（Yjs 幂等；不因重复而违反窗口/ACK 语义）', async () => {
    const run = await boot();
    await run.writePeer({ n: 7 });
    await settle();
    const first = asMsg<UpdateMsg>(run.peerFrames('UPDATE')[0], 'UPDATE');
    // 注入重复 update（同 bytes）——真实 peer 此时静默
    run.injectPeer({ kind: 'UPDATE', namespaceId: run.nsId, update: first?.update as Uint8Array });
    await settle();
    expect(run.hubFrames('UPDATE_ACK')).toHaveLength(2);
    expect(run.rootValue('hub', 'n')).toBe(7);
  });

  it('ACK_STATE_VIOLATION：未知 ackedSequence → connection fatal（ERROR + 关闭）', async () => {
    const run = await boot();
    run.injectHub({
      kind: 'UPDATE_ACK',
      namespaceId: run.nsId,
      ackedSequence: 99_999,
    });
    await settle();
    const errors = errorCodes(run.peerFrames('ERROR'));
    expect(errors).toContain('ACK_STATE_VIOLATION');
    // 连接级 fatal → 连接关闭（hub 端观察到关闭）
    expect(run.wire.hubSideClosed || run.wire.peerSideClosed).toBe(true);
    expect(run.connectionState()).toBe('blocked');
  });

  it('UPDATE_TOO_LARGE：live apply 前大小限制拒绝（零写入）', async () => {
    const run = await boot({ limits: { maxUpdateBytes: 32 } });
    const big = run.buildUpdateFrom('hub', (doc) => {
      (doc.getMap('ROOT') as unknown as Map<string, unknown>).set('blob', 'x'.repeat(200));
    });
    run.injectPeer({ kind: 'UPDATE', namespaceId: run.nsId, update: big });
    await settle();
    expect(errorCodes(run.hubFrames('ERROR'))).toContain('UPDATE_TOO_LARGE');
    expect(run.hubFrames('UPDATE_ACK')).toHaveLength(0);
    expect(run.rootValue('hub', 'blob')).toBeUndefined();
    expect(run.rootValue('hub', 'n')).toBe(42);
  });
});

// ═══════════ 工具（本文件局部：node 级观测） ═══════════

import * as Y from 'yjs';
import type { User } from '@nomicore/persistence';
import type { NamespaceLease } from '@nomicore/namespace-registry';
import type { ReplicaNode } from './harness.js';
import { PEER_OWNER } from './harness.js';

function decodeAll(bytes: Uint8Array[]): Array<{ message: { kind: string } }> {
  return bytes.map((b) => decodeMessage(b) as unknown as { message: { kind: string } });
}

async function openBusinessLease(node: ReplicaNode, nsId: string): Promise<NamespaceLease> {
  const result = await node.registry.open(PEER_OWNER, nsId);
  const r = result as { ok?: boolean; lease?: NamespaceLease };
  if (!r.ok || r.lease === undefined) throw new Error(`open 失败：${JSON.stringify(result)}`);
  return r.lease;
}

function rootValueOf(node: ReplicaNode, nsId: string, key: string): unknown {
  const p = node.persistence as unknown as { peek(owner: User, docId: string): Y.Doc | undefined };
  const doc = p.peek(PEER_OWNER as unknown as User, nsId);
  if (doc === undefined) throw new Error('副本缺失');
  return (doc.getMap('ROOT') as unknown as Map<string, unknown>).get(key);
}
