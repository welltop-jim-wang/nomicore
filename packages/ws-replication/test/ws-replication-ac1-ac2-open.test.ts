/**
 * SA6 红灯验收 —— issue #136 AC1 / AC2：Peer target 精确 { namespaceId, localOwner }；
 * Hub 授权结果提供独立的 Hub-local owner 与 read/submit 权限；OPEN 正确选择
 * bootstrap/reconcile 并拒绝未授权、缺失、禁用、谱系不符、epoch 不符（不泄露 owner 数据）。
 *
 * 契约：docs/protocols/instance-replication-v1.md §7（OPEN/OPEN_OK/身份）、§19（授权、
 * owner not on wire、TARGET_NOT_REQUESTED）、§13.2（错误注册表终态）、§16（closed/
 * conflicted 后不得重开）；docs/phases/phase-5-websocket-replication.md §6/§测试 seam。
 *
 * 红灯纪律：真实 yjs / 真实 Registry+Runtime / fake-duplex 内存双端（微任务投递）；
 * 零源码 grep 断言；零 real sleep。
 */
import { describe, expect, it } from 'vitest';
import { encodeMessage, type DecodedMessage } from '@nomicore/replication-protocol';
import type { OpenNamespaceMsg, HelloMsg, HelloAckMsg, OpenOkMsg, ErrorMsg } from '@nomicore/replication-protocol';
import { boot, makeAuthorizer } from './driver.js';
import type { Run } from './driver.js';
import {
  deferred,
  HUB_INSTANCE,
  HUB_OWNER,
  PEER_INSTANCE,
  PEER_OWNER,
  REP_ID_B,
  settle,
} from './harness.js';

// ═══════════════════════════ 断言辅助 ═══════════════════════════

function errorFrames(frames: DecodedMessage[]): ErrorMsg[] {
  return frames.filter((f): f is { header: DecodedMessage['header']; message: ErrorMsg } => f.message.kind === 'ERROR').map((f) => f.message);
}

function allMessages(run: Run): DecodedMessage[] {
  return [...run.frames().peerToHub, ...run.frames().hubToPeer];
}

/** 下一帧注入序列 = 该方向当前最大 + 1。 */
function nextSeq(run: Run, direction: 'peer' | 'hub'): number {
  const frames = direction === 'peer' ? run.frames().peerToHub : run.frames().hubToPeer;
  let max = 0;
  for (const f of frames) max = Math.max(max, f.header.sequence);
  return max + 1;
}

function injectPeerFrame(run: Run, message: OpenNamespaceMsg): void {
  run.wire.peerEnd.send(encodeMessage(message, { sequence: nextSeq(run, 'peer') }));
}

// ═══════════════════════════ AC1/AC2 ═══════════════════════════

describe('AC1/AC2：Peer target、Hub 授权与 OPEN 选择/拒绝', () => {
  it('幸福路径：HELLO→OPEN(bootstrap)→OPEN_OK(mode 0)；wire 永不携带 owner；授权结果驱动 Hub 打开（HUB_OWNER 独立于 Peer localOwner）', async () => {
    const run = await boot({ start: false });
    // 导入门闩：让流程冻结在 bootstrapping（OPEN_OK 之后、导入完成之前）
    run.peerNode.persistence.importHold = deferred();
    run.peer.start();

    // —— HELLO/HELLO_ACK ——
    await run.waitHubSent('HELLO_ACK');
    await run.waitNamespace('bootstrapping');
    const hello = run.peerFrames('HELLO')[0];
    expect(hello, 'HELLO 必须在任何 namespace frame 之前').toBeDefined();
    const helloMsg = (hello as unknown as { message: HelloMsg }).message;
    expect(helloMsg.peerInstanceId).toBe(PEER_INSTANCE);
    expect(helloMsg.expectedHubInstanceId).toBe(HUB_INSTANCE);
    expect(helloMsg.protocolVersions).toEqual([1]);
    expect(helloMsg.requiredCapabilities).toBe(0);
    expect(helloMsg.optionalCapabilities).toBe(0);
    expect(helloMsg.connectionNonce.byteLength).toBe(16);

    const helloAck = run.hubFrames('HELLO_ACK')[0];
    expect(helloAck).toBeDefined();
    const helloAckMsg = (helloAck as unknown as { message: HelloAckMsg }).message;
    expect(helloAckMsg.hubInstanceId).toBe(HUB_INSTANCE);
    expect(helloAckMsg.protocolVersion).toBe(1);
    expect(helloAckMsg.connectionNonce).toEqual(helloMsg.connectionNonce);
    expect(typeof helloAckMsg.connectionId).toBe('string');

    // —— OPEN：精确 { namespaceId, hasLocalReplica }，无 owner ——
    const opens = run.peerFrames('OPEN_NAMESPACE');
    expect(opens).toHaveLength(1);
    const openMsg = (opens[0] as unknown as { message: OpenNamespaceMsg }).message;
    expect(openMsg.namespaceId).toBe(run.nsId);
    expect(openMsg.hasLocalReplica).toBe(false);
    expect(JSON.stringify(openMsg)).not.toContain('owner');
    expect(Object.keys(openMsg).sort()).toEqual(['hasLocalReplica', 'kind', 'namespaceId']);

    // —— 全部 wire 帧不含 owner 标识 ——
    const wireDump = JSON.stringify(allMessages(run).map((f) => f.message));
    expect(wireDump).not.toContain(HUB_OWNER.userId);
    expect(wireDump).not.toContain(PEER_OWNER.userId);

    // —— OPEN_OK：mode 0 + Hub 身份（授权结果 → 独立 Hub owner → Registry open 成功）——
    const openOkFrames = run.hubFrames('OPEN_OK');
    expect(openOkFrames).toHaveLength(1);
    const openOk = (openOkFrames[0] as unknown as { message: OpenOkMsg }).message;
    expect(openOk.mode).toBe(0);
    expect(openOk.namespaceId).toBe(run.nsId);
    expect(openOk.replicationId).toBe(run.hubFixture?.identity.replicationId);
    expect(openOk.replicationEpoch).toBe(run.hubFixture?.identity.replicationEpoch);

    // —— 授权确认：恰一次，带 peer instanceId 与 namespaceId ——
    expect(run.authorizer.calls).toEqual([{ instanceIdentity: PEER_INSTANCE, namespaceId: run.nsId }]);

    // —— 状态机投影（冻结于 import 门闩 → 确定性）——
    expect(run.connectionState()).toBe('ready');
    expect(run.namespaceState()).toBe('bootstrapping');

    // —— direction-local sequence 严格递增（不变量 2）——
    const peerSeqsAll = run
      .frames()
      .peerToHub.map((f) => f.header.sequence)
      .sort((a, b) => a - b);
    expect(peerSeqsAll).toEqual(peerSeqsAll.map((_, i) => i + 1));
    expect(run.peerFrames('HELLO')[0]?.header.sequence).toBe(1);

    // 释放导入 → 完整链路可继续推进（其余 AC3 用例验证）
    const hold = run.peerNode.persistence.importHold;
    run.peerNode.persistence.importHold = undefined;
    if (hold !== undefined) hold.resolve();
    await run.waitNamespace('live');
  });

  it('AC2 未授权：denied → NAMESPACE_UNAUTHORIZED（含缺失 namespace 也不泄露存在性）', async () => {
    // 缺失 namespace + 拒绝 → 仍是 UNAUTHORIZED，绝不 NOT_FOUND（§7.1 不泄露）
    const run = await boot({
      hubNamespace: false,
      authorize: makeAuthorizer({ deny: ['*'] }).authorize,
      waitFor: 'failed',
    });
    const errors = errorFrames(run.hubFrames('ERROR'));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe('NAMESPACE_UNAUTHORIZED');
    expect(errors[0]?.namespaceId).toBe(run.nsId);
    expect(errors[0]?.safeMessage).not.toContain(HUB_OWNER.userId);
    expect(errors[0]?.safeMessage).not.toContain(PEER_OWNER.userId);
    expect(run.hubFrames('OPEN_OK')).toHaveLength(0);
    expect(run.namespaceState()).toBe('failed');
  });

  it('AC2 缺失：授权允许但 Hub 无该 namespace → NAMESPACE_NOT_FOUND', async () => {
    const run = await boot({ hubNamespace: false, waitFor: 'failed' });
    const errors = errorFrames(run.hubFrames('ERROR'));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe('NAMESPACE_NOT_FOUND');
    expect(run.namespaceState()).toBe('failed');
  });

  it('AC2 禁用：namespace 存在但复制未启用 → REPLICATION_NOT_ENABLED', async () => {
    const run = await boot({ hubEnabled: false, waitFor: 'failed' });
    const errors = errorFrames(run.hubFrames('ERROR'));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe('REPLICATION_NOT_ENABLED');
    expect(run.namespaceState()).toBe('failed');
  });

  it('AC2 谱系不符：replicationId 不一致 → REPLICATION_ID_MISMATCH → conflicted；本地副本不被覆盖', async () => {
    const run = await boot({
      peerReplica: { replicationId: REP_ID_B, replicationEpoch: 1, rootN: 5 },
      waitFor: 'conflicted',
    });
    const errors = errorFrames(run.hubFrames('ERROR'));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe('REPLICATION_ID_MISMATCH');
    expect(run.namespaceState()).toBe('conflicted');
    // Peer 本地副本身份不作废、不覆盖（peek = 复制的 B）
    expect(run.metaValue('peer', 'replicationId')).toBe(REP_ID_B);
    expect(run.rootValue('peer', 'n')).toBe(5);
    // Hub 侧数据不动
    expect(run.rootValue('hub', 'n')).toBe(42);
  });

  it('AC2 epoch 不符：replicationEpoch 不一致 → REPLICATION_EPOCH_MISMATCH → conflicted', async () => {
    const run = await boot({
      peerReplica: { replicationEpoch: 2, rootN: 5 }, // 谱系取 hub 身份、epoch 抬升 1
      waitFor: 'conflicted',
    });
    const errors = errorFrames(run.hubFrames('ERROR'));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe('REPLICATION_EPOCH_MISMATCH');
    expect(run.namespaceState()).toBe('conflicted');
    expect(run.metaValue('peer', 'replicationEpoch')).toBe(2);
  });

  it('AC2 读权限缺失：read:false → 与 denied 等价拒绝（授权结果即 OPEN 门禁）', async () => {
    const run = await boot({
      authorize: makeAuthorizer({ readDeny: ['*'] }).authorize,
      waitFor: 'failed',
    });
    expect(run.hubFrames('OPEN_OK')).toHaveLength(0);
    expect(errorFrames(run.hubFrames('ERROR'))[0]?.code).toBe('NAMESPACE_UNAUTHORIZED');
    expect(run.namespaceState()).toBe('failed');
  });

  it('AC1 提交权限：submit:false → Hub 拒绝 peer UPDATE（零写入、无 UPDATE_ACK、namespace 收口）,不触发 Hub 侧 owner 泄漏', async () => {
    const run = await boot({
      authorize: makeAuthorizer({ submitDeny: ['*'] }).authorize,
    });
    expect(run.namespaceState()).toBe('live');
    const before = run.saveEvents('hub');
    await run.writePeer({ n: 7 });
    await settle();
    // 提交被拒：无 UPDATE_ACK、hub 持久化无写、ERROR 收口
    expect(run.hubFrames('UPDATE_ACK')).toHaveLength(0);
    expect(errorFrames(run.hubFrames('ERROR'))[0]?.code).toBe('NAMESPACE_UNAUTHORIZED');
    expect(run.saveEvents('hub')).toBe(before);
    expect(run.rootValue('hub', 'n')).toBe(42);
    expect(run.namespaceState()).toBe('failed');
  });

  it('AC2/§7.1 重复 OPEN 合流：opening 中重复 OPEN 两个请求都收到 OPEN_OK', async () => {
    // 授权门闩：第一个 OPEN 停在 authorize；注入第二个 OPEN；两个请求都必须有应答。
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let calls = 0;
    const run = await boot({
      start: false,
      authorize: async (instanceIdentity: string, namespaceId: string) => {
        calls += 1;
        if (calls === 1) await gate;
        return { ok: true, localOwner: HUB_OWNER, permissions: { read: true, submit: true } };
      },
    });
    run.peer.start();
    await settle();
    expect(run.authorizer.calls).toHaveLength(1);
    // 第二个 OPEN（同 namespace，重复请求）
    injectPeerFrame(run, { kind: 'OPEN_NAMESPACE', namespaceId: run.nsId, hasLocalReplica: false });
    await settle();
    release();
    await settle();
    // 两个请求都收到应答（合流底层操作）
    expect(run.hubFrames('OPEN_OK')).toHaveLength(2);
    expect(run.authorizer.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('AC2/§16 closed/conflicted 后不得重开：conflicted 后同连接再 OPEN → NAMESPACE_REOPEN_REQUIRES_RECONNECT', async () => {
    const run = await boot({
      peerReplica: { replicationId: REP_ID_B, replicationEpoch: 1, rootN: 5 },
      waitFor: 'conflicted',
    });
    injectPeerFrame(run, { kind: 'OPEN_NAMESPACE', namespaceId: run.nsId, hasLocalReplica: true, replicationId: REP_ID_B, replicationEpoch: 1 });
    await settle();
    const errors = errorFrames(run.hubFrames('ERROR'));
    expect(errors[errors.length - 1]?.code).toBe('NAMESPACE_REOPEN_REQUIRES_RECONNECT');
    expect(run.hubFrames('OPEN_OK')).toHaveLength(0);
  });

  it('AC2/§19 未知 target：hub→peer 从未请求的 namespace OPEN → TARGET_NOT_REQUESTED 且不自动创建', async () => {
    const run = await boot();
    const unknownId = 'ns-' + 'e'.repeat(32);
    run.wire.hubEnd.send(
      encodeMessage(
        { kind: 'OPEN_NAMESPACE', namespaceId: unknownId, hasLocalReplica: false },
        { sequence: nextSeq(run, 'hub') },
      ),
    );
    await settle();
    const errors = errorFrames(run.peerFrames('ERROR'));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe('TARGET_NOT_REQUESTED');
    expect(errors[0]?.namespaceId).toBe(unknownId);
  });

  it('AC1 幂等 addTarget/removeTarget：重复 add 只发一个 OPEN；未知 remove 幂等；closed 后 add 重建连接', async () => {
    const run = await boot({ waitFor: 'live' });
    // 打开中的重复 add → 合流（不产生新 OPEN 帧）
    run.peer.addTarget(run.target);
    await settle();
    expect(run.peerFrames('OPEN_NAMESPACE')).toHaveLength(1);

    // 未知 namespaceId remove → 幂等 resolve
    await expect(run.peer.removeTarget('ns-' + 'd'.repeat(32))).resolves.toBeUndefined();

    // 正常 remove → closed
    await run.peer.removeTarget(run.nsId);
    await run.waitNamespace('closed');
    expect(run.peerFrames('CLOSE_NAMESPACE')).toHaveLength(1);

    // closed 后重新 add 同 target → 整连接重建（新 HELLO/新 OPEN）
    const dialsBefore = run.dialCount;
    run.peer.addTarget(run.target);
    await run.waitNamespace('live');
    expect(run.dialCount).toBeGreaterThan(dialsBefore);
    expect(run.wires.length).toBeGreaterThan(1);
    // §18.11 #1（R2 对齐）：HELLO 计数沿全连接聚合（重建=新拨号+新 HELLO，1/wire——
    // frames() 只取最后一条 wire，不能作为重建证明）
    expect(run.peerFramesAll('HELLO')).toHaveLength(2);
  });
});
