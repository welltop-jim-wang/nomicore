/**
 * SA6 回流红灯 —— 双轴终审 Spec review 阻塞项 B-1 / B-2 簇（报告
 * `task_phase5-ws-namespace-sync_spec_review.md` §5，verdict: has-blocking-findings）。
 *
 *    B-1  removeTarget × reconcile 竞态：onRoundSettled 无状态守卫，closing 被复活为
 *         live、CLOSE_OK 被吞、target 永久假活（peer-namespace.ts:570-583）。
 *         —— 设计 §5.1（closing 唯一出口 CLOSE_OK/closeTimeout→closed）+ §13.4（终态
 *         不复活、零状态机迁移）。
 *    B-2b 导入迟到遇 disconnected 照常推进（setState('reconciling') → 假迁 reconcile，
 *         重连不重 OPEN → 一次普通断线把 bootstrap 中 namespace 卡入 failed）。
 *    B-2c startOpen 迟到续体：'disconnected' 时照常发 OPEN（旧 lease 覆盖泄漏；迟到
 *         OPEN 与重连 OPEN 形成双 OPEN → hub 合流 2×OPEN_OK → onOpenOk 自伤违例）。
 *    B-2d（本簇最重）在途 apply 跨重连：cleanup 卡 session.close 屏障 → 投影滞留 live →
 *         新连接不重 OPEN → 旧 ACK 落新连接 → hub NAMESPACE_STATE_VIOLATION → failed
 *         —— AC6「socket loss → disconnected → 重连按 §13.3 修复」承诺在该竞态下不成立。
 *    B-2e rebuild 不投影 namespace disconnected：兄弟活跃 ns（live）不被重 OPEN →
 *         首笔本地写发到无通道新连接 → 误 failed（设计 §4.3 L228 字面）。
 *
 * 均为「断开/收口 × 在途异步操作」竞态窗口的状态机守卫缺口（Spec §5 共同性质）；
 * 数据面零损坏（收敛由 state-vector diff 保证）。本文件新 IT 全部为红灯（实现未修）。
 * B-2a（导入终态不回收 lease）无公共观测面（Registry 无 lease 列表 API），未单独锚定
 * ——其修复由实现侧顺手完成、SA7 动态/静态闭项（简报记录理由）。
 *
 * 红线纪律：真实 yjs / Registry / Runtime；fake-duplex；fake scheduler；零 real sleep；
 * 断言均为 wire 帧/状态投影/收敛数据（零源码 grep）。
 */
import { describe, expect, it } from 'vitest';
import { createHubReplication, createPeerReplication } from '@nomicore/ws-replication';
import type { DuplexTransport } from '@nomicore/ws-replication';
import { boot, advanceMs, makeAuthorizer } from './driver.js';
import {
  deferred,
  HUB_INSTANCE,
  HUB_OWNER,
  PEER_INSTANCE,
  PEER_OWNER,
  makeHubNamespace,
  makeNode,
  makeWire,
  okLease,
  schemaReady,
  settle,
  settleUntil,
  type Wire,
} from './harness.js';

function frameKinds(wire: Wire, direction: 'peer' | 'hub'): string[] {
  const bytes = direction === 'peer' ? wire.peerToHub : wire.hubToPeer;
  return bytes.map((b) => requireDecode(b).message.kind);
}

import { decodeMessage } from '@nomicore/replication-protocol';
function requireDecode(bytes: Uint8Array): { message: { kind: string } } {
  return decodeMessage(bytes) as unknown as { message: { kind: string } };
}

describe('Spec 回流红灯：B-1 removeTarget×reconcile / B-2 迟到续体竞态簇', () => {
  it('B-1：reconciling 在途 Step2 apply + 对端 SYNC_APPLIED 已收 + removeTarget → 不复活 live、CLOSE_OK 收口、re-add 非 no-op', async () => {
    const run = await boot({
      start: false,
      peerReplica: { rootN: 5, ext: 7 },
      timeouts: { closeTimeoutMs: 200 },
    });
    // 本端（peer）Step2 apply 在途：peer saveDoc 悬挂
    run.peerNode.persistence.saveGate = deferred();
    run.peer.start();
    // 对端点：hub 的 SYNC_APPLIED（对本端 Step2）已收——peer 的 apply 仍在途
    await run.waitPeerSent('SYNC_STEP2', 1);
    await run.waitHubSent('SYNC_APPLIED', 1);
    await run.waitNamespace('reconciling');
    // removeTarget → closing + CLOSE 已发；CLOSE_OK 被扣（收口只走 closeTimeout 路径，
    // 消除「CLOSE_OK 先到 → 合法 closed」的随机序——drop 后 hub 无后续帧，无 gap）
    const closePromise = run.peer.removeTarget(run.nsId);
    await run.waitNamespace('closing');
    run.dropNextHubFrame('CLOSE_OK');
    // 释放 gate → 本端 apply 迟结算 → checkSettled 双位齐 → onRoundSettled
    const gate = run.peerNode.persistence.saveGate;
    run.peerNode.persistence.saveGate = undefined;
    if (gate !== undefined) gate.resolve();
    await settle();
    // ── B-1 红灯锚（现实现：onRoundSettled 无守卫 → closing 复活 live；close timer
    //     fire 仅认 closing → 恒 live 且 closePromise 结算后仍 live）──
    await advanceMs(run, 200); // closeTimeout
    await run.waitNamespace('closed');
    await closePromise;
    await run.waitNamespace('closed');
    // ── re-add 非 no-op（现实现：复活 live → addTarget 仅置 intent 合流 → 零重建）──
    const dials = run.dialCount;
    run.peer.addTarget(run.target);
    await settle();
    expect(run.dialCount).toBeGreaterThan(dials);
    await run.waitNamespace('live');
  });

  it('B-2b：导入迟到遇 disconnected → 不假迁 reconciling；重连 re-OPEN（副本已导入 → reconcile）→ live', async () => {
    const run = await boot({ start: false });
    run.peerNode.persistence.importHold = deferred();
    run.peer.start();
    // 快照已收、导入在途 → 断线（无 session/lease——cleanup 快 → 投影 disconnected）
    await run.waitNamespace('bootstrapping');
    run.wire.closePeerSide(1006, 'network lost');
    await run.waitNamespace('disconnected');
    // 释放导入 → 迟到的 import 续体——期望（§13.4「连接已断」半句）零状态机迁移
    const hold = run.peerNode.persistence.importHold;
    run.peerNode.persistence.importHold = undefined;
    if (hold !== undefined) hold.resolve();
    await settle();
    // backoff 首拨（cap=100）→ 重连 ready
    await advanceMs(run, 200);
    await run.waitConnection('ready');
    // ── B-2b 红灯锚（现实现：续体 setState('reconciling') → openActiveTargets 跳过
    //    reconciling → 重连零 OPEN）──
    expect(run.peerFramesAll('OPEN_NAMESPACE')).toHaveLength(2);
    await run.waitNamespace('live');
  });

  it('B-2c：startOpen 迟到续体（registry.open 在途遇 disconnected）→ 零自伤；重连单 OPEN 收敛 live', async () => {
    const run = await boot({ start: false });
    // registry.open 的 loadDoc 在途悬挂（第一次 OPEN 决策卡住——OPEN 尚未发出）
    run.peerNode.persistence.loadGate = deferred();
    run.peer.start();
    await run.waitConnection('ready');
    // 断线（startOpen 在途、ns 投影 disconnected）→ 先清 onClose 处理链（backoff timer
    // 武装）→ backoff 首拨 → 重连 ready（重连自身 startOpen 发起 registry.open #2——
    // 与 #1 同走 carrier FIFO，#1 的 loadDoc 门闩挂起期间 #2 排队）
    run.wire.closePeerSide(1006, 'network lost');
    await settle();
    await advanceMs(run, 200);
    await run.waitConnection('ready');
    // 释放 loadGate → #1/#2 陆续 resolve——期望（§13.4）：迟到的 #1 续体零 wire（旧
    // lease 回收），仅 #2 发 OPEN；现实现：双 OPEN（迟到 + 重连）→ 自伤违例
    const gate = run.peerNode.persistence.loadGate;
    run.peerNode.persistence.loadGate = undefined;
    if (gate !== undefined) gate.resolve();
    await settle();
    // ── B-2c 红灯锚（实测现实现形态：重连后 OPEN 帧恒为 0——重连自身 startOpen 与
    //    #1 同走 registry carrier 排队且 #1 续体迟滞，OPEN 决策链卡在 opening；
    //    均违反 §13.4「零 wire + 收敛」——修复后：迟到续体零 wire、单 OPEN → live）──
    expect(run.peerFramesAll('OPEN_NAMESPACE')).toHaveLength(1);
    await run.waitNamespace('live');
  });

  it('B-2d（最重）：在途 apply 跨重连 → AC6 修复承诺成立——重连 re-OPEN → 收敛 live（hub n=1）；非滞留/非误 failed', async () => {
    const run = await boot({ backoff: { baseMs: 50, maxMs: 400, resetAfterMs: 500 }, random: () => 0.5 });
    // hub→peer UPDATE 的 apply 在途（peer saveDoc 悬挂）
    run.peerNode.persistence.saveGate = deferred();
    await run.writeHub({ n: 1 });
    await settle();
    await run.waitHubSent('UPDATE', 1);
    // socket 断开（cleanup 卡 session.close 屏障 → 现实现投影滞留 live）→ backoff 重连
    run.wire.closePeerSide(1006, 'network lost');
    await settle(); // onClose 处理链（backoff 武装）先收口
    await advanceMs(run, 25); // 0.5×50
    await run.waitConnection('ready');
    // ── B-2d 红灯锚 1（现实现：openActiveTargets 跳过滞留 'live' → 新连接零 OPEN）──
    expect(run.peerFramesAll('OPEN_NAMESPACE')).toHaveLength(2);
    // 释放 gate → 旧 ACK 续体 →（现实现 isQuietState 不含滞留态 → 旧 ACK 落新连接 →
    // hub 无通道 → NAMESPACE_STATE_VIOLATION → failed）
    const gate = run.peerNode.persistence.saveGate;
    run.peerNode.persistence.saveGate = undefined;
    if (gate !== undefined) gate.resolve();
    await settle();
    // ── B-2d 红灯锚 2（AC6 重连修复承诺：收敛 live；现实现 failed）──
    await run.waitNamespace('live');
    await settle();
    expect(run.rootValue('hub', 'n')).toBe(1);
    expect(run.rootValue('peer', 'n')).toBe(1);
  });

  it('B-2e：rebuild 期间所有 namespace 投影 disconnected（兄弟 live ns 重 OPEN，非误 failed）', async () => {
    // 双 namespace 自建装配（Run 面向单 target——peer 目标集 [A, B]）
    const hubNode = makeNode('hub');
    const peerNode = makeNode('peer');
    const authorizer = makeAuthorizer();
    const fxA = await makeHubNamespace(hubNode, { owner: HUB_OWNER });
    const fxB = await makeHubNamespace(hubNode, { owner: HUB_OWNER });
    const nsA = fxA.namespaceId;
    const nsB = fxB.namespaceId;
    const hub = createHubReplication({
      instanceId: HUB_INSTANCE,
      registry: hubNode.registry,
      authorize: authorizer.authorize,
      timer: hubNode.scheduler,
    });
    const wires: Wire[] = [];
    const peer = createPeerReplication({
      instanceId: PEER_INSTANCE,
      hubInstanceId: HUB_INSTANCE,
      registry: peerNode.registry,
      dial: (): DuplexTransport => {
        const wire = makeWire();
        wires.push(wire);
        hub.accept(wire.hubEnd, { peerInstanceId: PEER_INSTANCE });
        return wire.peerEnd;
      },
      timer: peerNode.scheduler,
      targets: [
        { namespaceId: nsA, localOwner: PEER_OWNER },
        { namespaceId: nsB, localOwner: PEER_OWNER },
      ],
    });
    peer.start();
    await settleUntil(
      () => peer.getNamespaceState(nsA) === 'live' && peer.getNamespaceState(nsB) === 'live',
      'A、B 双 target 首连均 live',
    );
    // A removeTarget → A closed → re-add A → §14.1 整连接重建（rebuild）
    await peer.removeTarget(nsA);
    await settleUntil(() => peer.getNamespaceState(nsA) === 'closed', 'A closed');
    peer.addTarget({ namespaceId: nsA, localOwner: PEER_OWNER });
    await settleUntil(
      () => peer.getNamespaceState(nsA) === 'live' && peer.getNamespaceState(nsB) === 'live',
      '重建后 A、B 均恢复',
    );
    // ── B-2e 红灯锚（现实现：requestRebuild 不通知 namespace → B 恒 'live' 残留投影、
    //    新连接不重 OPEN → 新连接 OPEN 总数 3（A×2 + B×1）而非 4）──
    const opens = wires.flatMap((w) => frameKinds(w, 'peer').filter((k) => k === 'OPEN_NAMESPACE'));
    expect(opens).toHaveLength(4);
    // 兄弟 ns 的后续本地写不得落无通道新连接 → 违例 failed（B 仍 live）
    const busLease = okLease(await peerNode.registry.open(PEER_OWNER, nsB));
    await schemaReady(busLease);
    const write = await busLease.mutateRoot({ op: 'set', path: ['extra'], value: 9 });
    if (!write.ok) throw new Error(`B 写失败：${JSON.stringify(write)}`);
    await settle();
    expect(peer.getNamespaceState(nsB)).toBe('live');
    await busLease.release();
  });
});
