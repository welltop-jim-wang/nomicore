/**
 * SA6 加固红灯 —— issue #161（PR #160 post-review 协议加固）G1/G2 组确定性红灯：
 *
 *   AC1（G1.2）：伪造 HELLO 身份必须在命名空间授权之前被拒绝（§6.1 L120「peerInstanceId
 *      必须等于 Upgrade 身份」）；已修复（回归锁）：`accept()` 受信身份缺失 → 同步
 *      TypeError、`onHello` 采信受信身份而非 wire 自述（冒充者无法借任意 instanceId
 *      获得授权）。
 *   AC2（G1.3）：旧 socket 迟到 message/close 回调不得影响替代连接（§13.4 代际纪律）；
 *      已修复（回归锁）：peer 侧 `transport.onMessage/onClose` 闭包绑定当次连接代际且
 *      退订句柄保留——重连后旧 socket 迟到帧/迟到 close 零副作用。
 *   AC3（G2.1/G2.2）：伪造/过期 BOOTSTRAP_ACK 与 CLOSE_OK 不得推进状态机（§8.2 L197、
 *      §12 L311 ackedSequence 关联）；已修复（回归锁）：`hub-namespace.ts`/`peer-namespace.ts`
 *      关联校验 ackedSequence，不匹配分支不推进状态机。
 *
 * 红线纪律：真实 yjs / Registry / Runtime；fake-duplex；fake scheduler；零 real sleep；
 * 断言均为 wire 帧 / 状态投影 / 授权调用记录（零源码 grep）。
 *
 * ⚠ 现状说明：本文件锚定的 G1/G2 加固面已交付（issue #161 / PR #165 round 2：
 * `accept(transport, identity)` 受信 Upgrade 身份 + 缺失同步 TypeError、旧 socket
 * 代际退订句柄、CLOSE_OK/BOOTSTRAP_ACK 关联校验）——本文件现为回归锁（文件名中
 * red 为历史红灯批次标记）。
 */
import { describe, expect, it } from 'vitest';
import { createHubReplication } from '@nomicore/ws-replication';
import type { DuplexTransport, HubConnection } from '@nomicore/ws-replication';
import { encodeMessage } from '@nomicore/replication-protocol';
import { advanceMs, boot, makeAuthorizer } from './driver.js';
import type { Run } from './driver.js';
import { DEFAULT_PEER_VERIFIER, TEST_TOKEN } from './driver.js';
import {
  decodeAll,
  deferred,
  HUB_INSTANCE,
  HUB_OWNER,
  makeHubNamespace,
  makeNode,
  makeWire,
  PEER_INSTANCE,
  settle,
  settleUntil,
} from './harness.js';

/** Upgrade 认证入口的测试侧窄签名。 */
type AcceptWithIdentity = (
  transport: DuplexTransport,
  request: { readonly token?: string },
) => Promise<HubConnection | undefined>;

function errorCodes(decoded: Array<{ message: { kind: string } }>): string[] {
  return decoded
    .filter((f) => f.message.kind === 'ERROR')
    .map((f) => (f.message as unknown as { code: string }).code);
}

describe('SA6 加固红灯 G1：HELLO 身份冒充 / 旧 socket 代际污染', () => {
  it('AC1：伪造 HELLO 身份（≠ Upgrade 受信身份）→ 1008 拒绝 + INSTANCE_IDENTITY_MISMATCH + authorize 零调用', async () => {
    const node = makeNode('hub');
    const fixture = await makeHubNamespace(node, { owner: HUB_OWNER });
    const spy = makeAuthorizer({});
    const hub = createHubReplication({
      instanceId: HUB_INSTANCE,
      registry: node.registry,
      authorize: spy.authorize,
      timer: node.scheduler,
      verifyToken: DEFAULT_PEER_VERIFIER,
    });
    const wire = makeWire();
    const accept = hub.accept as unknown as AcceptWithIdentity;
    // Upgrade 身份已由 HTTP bearer-token 验证（受信）：peer-alpha
    accept.call(hub, wire.hubEnd, { token: TEST_TOKEN });

    // 未认证连接：HELLO 自述身份 ≠ 受信身份（冒充）
    wire.peerEnd.send(
      encodeMessage(
        {
          kind: 'HELLO',
          peerInstanceId: 'peer-loki',
          expectedHubInstanceId: HUB_INSTANCE,
          protocolVersions: [1],
          requiredCapabilities: 0,
          optionalCapabilities: 0,
          connectionNonce: new Uint8Array(16),
        },
        { sequence: 1 },
      ),
    );
    await settle();
    // 随后对受信身份专属命名空间发起 OPEN（冒充者意图借名授权）
    wire.peerEnd.send(
      encodeMessage(
        { kind: 'OPEN_NAMESPACE', namespaceId: fixture.namespaceId, hasLocalReplica: false },
        { sequence: 2 },
      ),
    );
    await settle();

    // ── 红灯锚 1：冒充在命名空间授权之前被拒绝 → authorize 零调用 ──
    //    现实现：OPEN 授权以 wire 自述身份 'peer-loki' 通过（authorize 1 次）→ 红灯
    expect(spy.calls, '伪造身份不得进入命名空间授权（§6.1）').toHaveLength(0);
    // ── 红灯锚 2（§3.8 裁决 2 替换断言组）：传输关闭 + 连接摘除 = 正确收口证据 ──
    //    原断言 `hub.connections[0]?.state === 'closed'` 在 fatal→cleanupAll→dropConnection
    //    生命周期下恒红（连接从 connections 摘除）——A3 定案：锚形态改为
    //    `hubSideClosed === true` + `connections.length === 0`（保留 prompt-drop 生产语义）。
    //    现实现：onHello 采信自述身份 → 不接受、不关闭、不摘除 → 红灯
    expect(wire.hubSideClosed).toBe(true);
    expect(hub.connections).toHaveLength(0);
    const toPeer = decodeAll(wire.hubToPeer);
    expect(errorCodes(toPeer)).toContain('INSTANCE_IDENTITY_MISMATCH');
    // 收口细节（1008）不在此强锚——连接级 ERROR + close 的表述随修复形状，锚点为拒绝语义
  });

  it('AC2a：旧 socket 迟到 message 回调不得污染替代连接（新连接保持 ready/live）', async () => {
    const run = await boot();
    const oldWire = run.wires[0]!;
    // closed 后 addTarget → 整连接重建（§14.1）→ 新连接 re-OPEN → live
    await run.peer.removeTarget(run.nsId);
    await run.waitNamespace('closed');
    run.peer.addTarget(run.target);
    await run.waitConnection('ready');
    await run.waitNamespace('live');
    expect(run.dialCount).toBeGreaterThanOrEqual(2);
    // 造证基准清零：assert「旧 socket 的帧确实到达了对端」以注入帧计数为准——首连接
    // 握手/close 帧（HELLO_ACK…CLOSE_OK）与注入帧同记录于 hubToPeer；注入前清零，
    // 使该锚（toHaveLength(1)）只观测注入帧（构造调整，断言面不变）。
    (oldWire as unknown as { hubToPeer: Uint8Array[] }).hubToPeer.length = 0;

    // 旧 socket 迟到帧：sequence=1 = 新连接已消费过的序列（重复/回退 → 序列违例）
    // 当前实现：旧 transport 回调未退订、闭包未绑代际 → 帧进入新连接 FSM → fatal → blocked
    oldWire.hubEnd.send(
      encodeMessage(
        { kind: 'RESYNC_REQUIRED', namespaceId: run.nsId, reasonCode: 'stale-old-socket' },
        { sequence: 1 },
      ),
    );
    await settle();

    // ── 红灯锚：旧 socket 帧不得影响替代连接（§13.4 代际纪律）──
    //    现实现：新连接被旧帧打进 blocked（namespace disconnected）→ 红灯
    expect(run.connectionState()).toBe('ready');
    expect(run.namespaceState()).toBe('live');
    // 造证：旧 socket 的帧确实到达了对端（否则测试前提不成立）
    expect(oldWire.hubToPeer).toHaveLength(1);
  });

  it('AC2b：旧 socket 迟到 close 回调不得触发新连接 backoff', async () => {
    const run = await boot();
    await run.peer.removeTarget(run.nsId);
    await run.waitNamespace('closed');
    run.peer.addTarget(run.target);
    await run.waitConnection('ready');
    await run.waitNamespace('live');
    const oldWire = run.wires[0]!;
    expect(run.dialCount).toBeGreaterThanOrEqual(2);

    // 旧 socket 关闭事件（1000 正常关闭——旧连接早于新连接建立前已收口）
    oldWire.closeHubSide(1000, 'stale-socket-close');
    await settle();

    // ── 红灯锚：旧 socket 的 close 不得让新连接进入 backoff ──
    //    现实现：onClose 闭包共享 FSM → onTemporaryFailure → backoff + attempts+1 → 红灯
    expect(run.connectionState()).toBe('ready');
  });
});

describe('SA6 加固红灯 G2：BOOTSTRAP_ACK / CLOSE_OK 帧关联校验', () => {
  it('AC3a：伪造 BOOTSTRAP_ACK（ackedSequence ≠ 发出的 BOOTSTRAP_SNAPSHOT）→ 按 ACK 关联违例策略拒绝', async () => {
    const run = await boot({ peerReplica: 'none', start: false });
    // 悬挂 peer 导入（真实 BOOTSTRAP_ACK 未发）——确定性构造「只有伪造 ACK」的窗口
    run.peerNode.persistence.importHold = deferred();
    run.peer.start();
    await run.waitConnection('ready');
    await run.waitHubSent('BOOTSTRAP_SNAPSHOT', 1);
    const snapSeq = run.hubFrames('BOOTSTRAP_SNAPSHOT')[0]?.header.sequence;
    if (snapSeq === undefined) throw new Error('未观察到 BOOTSTRAP_SNAPSHOT');

    // 伪造 ACK：ackedSequence 与已发送快照序不一致（+7 偏移）
    run.injectPeer({
      kind: 'BOOTSTRAP_ACK',
      namespaceId: run.nsId,
      ackedSequence: snapSeq + 7,
    });
    await settle();

    // ── 红灯锚：错配 ACK 必须按协议违例/错误策略拒绝（§8.2 关联）──
    //    现实现：`onBootstrapAck` 首行 `void message` → 任意 ackedSequence 推进
    //    bootstrapping → reconciling，零 ERROR 帧、零 fatal → 红灯
    expect(errorCodes(run.hubFrames('ERROR'))).toContain('ACK_STATE_VIOLATION');
    await run.waitConnection('blocked');
    // 收尾：放行真实导入（连接已按策略收口 → 迟到续体静默回收）
    const hold = run.peerNode.persistence.importHold;
    run.peerNode.persistence.importHold = undefined;
    if (hold !== undefined) hold.resolve();
    await settle();
  });

  it('AC3b：伪造 CLOSE_OK（ackedSequence 过期/错配）→ 显式 violation 收口（不静默完成、不静默滞留）', async () => {
    const run = await boot();
    // 丢弃 hub 真实 CLOSE_OK → peer 停留 closing（等待关联帧）
    run.dropNextHubFrame('CLOSE_OK');
    let closeSettled = false;
    const closeP = run.peer.removeTarget(run.nsId);
    void closeP.then(() => {
      closeSettled = true;
    });
    await run.waitNamespace('closing');
    // 构造（时序修正）：等 hub 通道完成收口——真实 CLOSE_OK 已被 drop 谓词拦截（不入
    // hubFrames），以 hub 通道投影 'closed' 为「CLOSE_OK 已发出」的可观测同步点；此后
    // 注入伪造帧不再抢占 drop（断言面不变）。
    await settleUntil(
      () => {
        const connection = run.hub.connections[0] as unknown as
          | { channels: Map<string, { state: string }> }
          | undefined;
        return connection?.channels.get(run.nsId)?.state === 'closed';
      },
      'hub 通道 closed（CLOSE_OK 已发出并被 drop）',
    );
    const closeSeq = run.peerFrames('CLOSE_NAMESPACE')[0]?.header.sequence;
    if (closeSeq === undefined) throw new Error('未观察到 CLOSE_NAMESPACE');

    // 伪造/过期 CLOSE_OK：ackedSequence 与 CLOSE_NAMESPACE 实际序不符（取 1 = 过期值）
    run.injectHub({
      kind: 'CLOSE_OK',
      namespaceId: run.nsId,
      ackedSequence: closeSeq - 1 >= 1 ? 1 : closeSeq + 1, // 恒 ≠ 实际序列
    });
    await settle();

    // ── 锚（§13.1 翻转登记）：无效 ACK 关联不得**静默完成** close——按库内 ACK 关联
    //    权威策略（对照 hub onBootstrapAck 错配 → connectionFatal ACK_STATE_VIOLATION）
    //    显式收口：violation 投影 disconnected（非 closed）+ 关闭承诺经 violation 结算
    //    （#165 G4 旧决策「错配不完成 close——closeTimeout 兜底」被 issue #171 C4
    //    红灯契约推翻；AC3b 原始意图「无效 ACK 不得成功收口为 closed」仍成立）
    expect(run.namespaceState()).not.toBe('closed');
    expect(closeSettled, '伪造 CLOSE_OK 按权威策略 violation 收口并结算关闭承诺').toBe(true);
    // ── 追加锚：violation 显影（ERROR 帧 + blocked + transport 关闭）
    expect(errorCodes(run.peerFramesAll('ERROR'))).toContain('ACK_STATE_VIOLATION');
    expect(run.connectionState()).toBe('blocked');
    expect(run.wire.peerSideClosed).toBe(true);
    // 收尾（确定性）：violation 后连接已收口；closeTimeout 兜底不再需要（closeSettled 已真）
    await advanceMs(run, 5_000);
    await settle();
    await closeP.catch(() => undefined);
  });
});
