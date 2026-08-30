/**
 * SA6 红灯契约 —— issue #171（Phase 5 follow-up：命名空间生命周期跨连接代际竞态）
 * 确定性红灯锚（Scope 1–6 的运行时行为面；零源码 grep、零 skip、零 real sleep）：
 *
 *   H1   hub 迟到 open 续体（连接静默/收口后才恢复）不得泄漏已交付 lease
 *        （Scope 1 / AC1+AC2；SA5 E2：finishOpenSilently 只回收字段、
 *         `opened.lease` 局部值永不 release）——经 registry observer 官方 seam
 *        的 `lease-released.remainingLeases` 计数观测（恰一次释放）。
 *   P3   peer onCloseRequest/收口续体跨代捕获：gen1 在途 apply 悬挂（saveGate）时
 *        hub 发 CLOSE → 断线 → 重连 gen2 建成 session2+listener2 → 放行悬挂 apply →
 *        旧收口续体入口捕获新代资源 → 摘 gen2 listener、teardown gen2 round/channel、
 *        setState('closed')、CLOSE_OK 落新连接 → gen2 双端死亡
 *        （Scope 2 / AC1+AC2；SA5 RC2/E3）。
 *   C4   forged/stale/mismatched `CLOSE_OK` 不得静默忽略：按库内 ACK 关联权威策略
 *        显式收口（connectionFatal ACK_STATE_VIOLATION → blocked + close 1002 +
 *        ERROR 帧 + removeTarget 有限结算）——现状零 ERROR、连接滞留 ready、
 *        关 closeSemaphore 挂满 closeTimeout（Scope 5 / AC4；SA5 RC5/E5）。
 *   G5   GOAWAY `SERVER_RESTARTING` 必须在收帧同步段静默订阅/停新数据接受，
 *        deadline 仅控制 transport close 且不延迟命名空间静默
 *        （Scope 6 / AC5；SA5 RC6/E6——现实现把 quiesceControllers 整体放进
 *        drain timeout 回调 → 收帧后至 deadline 窗口订阅仍在、peer 写仍出 UPDATE）。
 *
 * 纪律：真实 yjs / Registry / Runtime / HubReplication / PeerReplication；fake-duplex
 * 内存双端 + fake scheduler；零 real sleep；零源码 grep；断言全部为 wire 帧 / 状态
 * 投影 / observer 官方事件的运行时行为面。对象图投影（hub channel state /
 * controller.unsubscribe）沿用 review-red / sa7-round2-dynamic 既有只读模式。
 */
import { describe, expect, it } from 'vitest';
import { createHubReplication, createPeerReplication } from '@nomicore/ws-replication';
import type { HubReplication, PeerReplication } from '@nomicore/ws-replication';
import { createNamespaceRegistryForTesting, createRegistryTestScheduler } from '@nomicore/namespace-registry/testing';
import type { ReplicationMessage } from '@nomicore/replication-protocol';
import { advanceMs, boot } from './driver.js';
import type { Run } from './driver.js';
import {
  deferred,
  FIXED_MS,
  HUB_INSTANCE,
  HUB_OWNER,
  makeCounterRandomBytes,
  makeHubNamespace,
  makeNode,
  makeWire,
  PEER_INSTANCE,
  PEER_OWNER,
  settle,
  settleUntil,
  StubPersistence,
} from './harness.js';
import type { HubNamespaceFixture, ReplicaNode, Wire } from './harness.js';

// ═══════════════════════════ 只读对象图投影（沿用既有投影模式；不改生产 API） ═══════════════════════════

function hubChannelStateOf(run: Run, nsId: string): string | undefined {
  const connection = run.hub.connections[0] as unknown as { channels: Map<string, { state: string }> };
  return connection?.channels.get(nsId)?.state;
}

function peerSubscriptionOf(run: Run): (() => void) | undefined {
  const impl = run.peer as unknown as { controllers: Map<string, { unsubscribe: (() => void) | undefined }> };
  const controller = impl.controllers.get(run.nsId);
  if (controller === undefined) throw new Error('无 peer controller');
  return controller.unsubscribe;
}

/** 微任务级谓词等待（零 real sleep）。 */
async function untilMicrotask(predicate: () => boolean, what: string, budget = 3_000): Promise<void> {
  for (let index = 0; index < budget; index += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error(`untilMicrotask 预算耗尽：${what}`);
}

// ═══════════════════════════ H1：hub 迟到 open 续体泄漏 lease ═══════════════════════════

interface ObservedRun {
  readonly hubNode: ReplicaNode;
  readonly peerNode: ReplicaNode;
  readonly hub: HubReplication;
  readonly peer: PeerReplication;
  readonly fixture: HubNamespaceFixture;
  readonly nsId: string;
  readonly wire: Wire;
  /** registry observer 的 `lease-released` 事件按序记录（remainingLeases 值）。 */
  readonly leaseReleasedSeq: number[];
  /** 释放第一次 authorize 的门闩（channel1 的 startOpen 悬在此处）。 */
  releaseAuthorize(): void;
  channelState(): string | undefined;
}

/**
 * 带 observer 的自建运行（driver.boot 不暴露 observer seam——按 boot 组装骨架复刻）：
 * hub 侧 registry 注入 observer（$8.1 官方测试观测面），记录 lease-released 事件；
 * authorize 首调挂门闩（确定性展开「连接静默 → 续体恢复」时序）。
 */
async function bootObserved(): Promise<ObservedRun> {
  const leaseReleasedSeq: number[] = [];
  const observer = (event: unknown): void => {
    const e = event as { type: string; remainingLeases?: number };
    if (e.type === 'lease-released' && typeof e.remainingLeases === 'number') {
      leaseReleasedSeq.push(e.remainingLeases);
    }
  };
  const hubPersistence = new StubPersistence();
  const hubScheduler = createRegistryTestScheduler();
  const hubNode: ReplicaNode = {
    role: 'hub',
    persistence: hubPersistence,
    scheduler: hubScheduler,
    registry: createNamespaceRegistryForTesting(hubPersistence, {
      clock: { now: () => FIXED_MS },
      scheduler: hubScheduler,
      idleTimeoutMs: 1_000_000,
      randomBytes: makeCounterRandomBytes(),
      role: 'hub',
      observer,
    }),
  };
  const peerNode = makeNode('peer');
  const latch = deferred();
  let calls = 0;
  const authorize = async (): Promise<{
    ok: true;
    localOwner: typeof HUB_OWNER;
    permissions: Readonly<{ read: boolean; submit: boolean }>;
  }> => {
    calls += 1;
    if (calls === 1) await latch.promise;
    return { ok: true, localOwner: HUB_OWNER, permissions: { read: true, submit: true } };
  };
  const fixture = await makeHubNamespace(hubNode, { owner: HUB_OWNER });
  const hub = createHubReplication({
    instanceId: HUB_INSTANCE,
    registry: hubNode.registry,
    authorize,
    timer: hubNode.scheduler,
  });
  const wireRef: { current: Wire | undefined } = { current: undefined };
  const peer = createPeerReplication({
    instanceId: PEER_INSTANCE,
    hubInstanceId: HUB_INSTANCE,
    registry: peerNode.registry,
    dial: () => {
      const wire = makeWire();
      wireRef.current = wire;
      hub.accept(wire.hubEnd, { peerInstanceId: PEER_INSTANCE });
      return wire.peerEnd;
    },
    timer: peerNode.scheduler,
    targets: [{ namespaceId: fixture.namespaceId, localOwner: PEER_OWNER }],
    backoff: { baseMs: 50, maxMs: 400, resetAfterMs: 500 },
    random: () => 0.5,
  });
  return {
    hubNode,
    peerNode,
    hub,
    peer,
    fixture,
    nsId: fixture.namespaceId,
    get wire(): Wire {
      const w = wireRef.current;
      if (w === undefined) throw new Error('peer 尚未拨号');
      return w;
    },
    leaseReleasedSeq,
    releaseAuthorize: () => latch.resolve(),
    channelState: () => {
      const connection = hub.connections[0] as unknown as { channels: Map<string, { state: string }> };
      return connection?.channels.get(fixture.namespaceId)?.state;
    },
  };
}

describe('SA6 H1（issue #171，Scope 1/AC1+AC2）：hub 迟到 open 续体——连接静默后恢复不得泄漏已交付 lease', () => {
  it('H1：连接收口后放行 startOpen 续体——registry.open 已交付的 lease 必须释放（observer 恰一次）', async () => {
    const run = await bootObserved();
    run.peer.start();
    await settleUntil(() => run.peer.getConnectionState() === 'ready', '连接 ready');
    // channel1：hub 侧 OPEN 通道建立，startOpen 挂起在 authorize 门闩（确定性时序锚）
    await untilMicrotask(() => run.channelState() === 'opening', 'hub channel1 opening');
    expect(run.channelState(), '前置：ch1 opening').toBe('opening');
    // hub 侧连接静默（socket 断开 → quiesceConnection → onConnectionClosed 链收口）
    run.wire.closeHubSide(1001, 'sa6-h1-loss');
    await settleUntil(() => run.channelState() === 'closed', 'channel1 收口 closed');
    // 放行 authorize → 续体恢复：registry.open 成功交付 lease（entry active → issueLease）
    // → 此时通道已终局 → finishOpenSilently —— `opened.lease` 局部值必须被显式回收
    run.releaseAuthorize();
    await settle();
    // ── 红灯锚 1：已交付 lease 必须立即释放（现实现：finishOpenSilently 只回收字段、
    //    opened.lease 无人 release → 零 `lease-released` 事件 → 红灯）──
    expect(run.leaseReleasedSeq, '迟到的 hub open 续体必须释放其已取得 lease').toHaveLength(1);
    // peer 断线 backoff（0.5×50=25ms）→ 重连 gen2 → 新通道 open（authorize 第 2 调不挂闩）
    await run.peerNode.scheduler.advanceBy(25);
    await settleUntil(() => run.peer.getConnectionState() === 'ready', 'gen2 ready');
    await settleUntil(() => run.peer.getNamespaceState(run.nsId) === 'live', 'gen2 live');
    // 收尾：stop 释放 gen2 channel 的 lease → 若 H1 泄漏成立，最终 remainingLeases = 2
    // （fixture lease + 泄漏 lease）；修复后 = 1（fixture lease 仅存）
    await run.peer.stop();
    await settleUntil(() => run.peer.getConnectionState() === 'stopped', 'stopped');
    const finalRemaining = run.leaseReleasedSeq[run.leaseReleasedSeq.length - 1];
    // ── 红灯锚 2：全场景收口后只剩 fixture lease（现实现：泄漏 lease 永不释放 →
    //    最终 remainingLeases = 2 → 红灯）──
    expect(finalRemaining, '跨代收口后 registry 不得残留泄漏 lease（remainingLeases 恰为 fixture）').toBe(1);
  });
});

// ═══════════════════════════ P3：peer 迟到 CLOSE 续体毁新代 ═══════════════════════════

describe('SA6 P3（issue #171，Scope 2/AC1+AC2）：peer 收口续体跨代捕获——旧代 CLOSE 续体不得摧毁新代资源', () => {
  it('P3：hub CLOSE（gen1）+ 在途 apply 悬挂 → 断线重连 gen2 live → 放行 apply → gen2 必须保持 live（零误摘/零误终局/零迟到 CLOSE_OK）', async () => {
    const run = await boot({
      backoff: { baseMs: 50, maxMs: 400, resetAfterMs: 500 },
      random: () => 0.5,
    });
    expect(run.namespaceState(), '前置：gen1 live').toBe('live');
    expect(typeof peerSubscriptionOf(run), '前置：gen1 订阅注册').toBe('function');
    // gen1 在途 apply 悬挂（peer 侧 saveGate）：hub 写 → peer apply → saveDoc 挂起
    run.peerNode.persistence.saveGate = deferred();
    await run.writeHub({ n: 9 });
    await settle();
    expect(run.rootValue('peer', 'n'), '前置：apply 已接纳但未落盘（saveGate 悬挂）').toBe(9);
    // hub 侧 CLOSE（gen1 连接上）→ peer onCloseRequest：同步段 closing + 停接纳；
    // 收口 IIFE 先 drainPendingApplies —— 挂在 在途 apply 上（saveGate）
    run.injectHub({
      kind: 'CLOSE_NAMESPACE',
      namespaceId: run.nsId,
      reasonCode: 'hub-side-close',
    } as ReplicationMessage);
    await run.waitNamespace('closing');
    // 断线（gen1 socket 1001）→ 临时失败 → backoff → 重拨 gen2 → 重新 OPEN → 新代
    // session2+listener2 建成（reconciling——起步 round 在途；saveGate 仍持有故 round
    // 不完成：sequencer 排空 gen1 悬挂 apply 过程中不接纳新槽，结构与 P2 屏障同源）
    run.wire.closePeerSide(1001, 'sa6-p3-loss');
    await settle(); // 先消费断线事件的微任务波（backoff timer 在关闭事件栈内武装）
    await advanceMs(run, 25);
    await run.waitConnection('ready');
    await run.waitNamespace('reconciling');
    // ── 前置锚：gen2 已建成新代资源（修复后的正确收口点在「gen2 不被旧续体触碰」）──
    expect(run.dialCount, 'gen2 已重拨').toBe(2);
    expect(typeof peerSubscriptionOf(run), 'gen2 订阅注册').toBe('function');
    // 放行悬挂 apply → gen1 的 CLOSE 收口 IIFE 恢复 → 入口捕获当前（= gen2）资源
    const gate = run.peerNode.persistence.saveGate;
    run.peerNode.persistence.saveGate = undefined;
    if (gate !== undefined) gate.resolve();
    await settle();
    // ── 红灯锚 1：gen2 控制器状态必须保持 live（现实现：IIFE 恢复后入口捕获
    //    session2/lease2 → closeSessionAndRelease 全量 teardown → setState('closed')
    //    → 红灯）──
    expect(run.namespaceState(), '旧代收口续体不得终结新代命名空间').toBe('live');
    // ── 红灯锚 2：gen2 的订阅句柄必须仍在（现实现：closeSessionAndRelease 入口
    //    无条件 quiesceSync 摘除当前 listener → undefined → 红灯）──
    expect(typeof peerSubscriptionOf(run), '旧代收口续体不得摘除新代 listener').toBe('function');
    // ── 红灯锚 3：hub gen2 通道不得收到迟到 CLOSE_OK（msg.ackedSequence 属旧代 →
    //    hub 按 CLOSE_OK 方向异常处理 → onErrorFrame NAMESPACE_STATE_VIOLATION →
    //    channel failed；现实现：CLOSE_OK 落新连接 → failed → 红灯）──
    expect(hubChannelStateOf(run, run.nsId), 'hub gen2 通道不得被迟到 CLOSE_OK 打穿').toBe('live');
    // ── 红灯锚 4（功能面前向闭环）：gen2 live 下 peer 业务写必须送达 hub（现实现：
    //    listener 被摘/session 被关 → 零 UPDATE → settleUntil 预算耗尽丢出 → 红灯）──
    await run.writePeer({ n: 101 });
    await settleUntil(() => run.rootValue('hub', 'n') === 101, 'gen2 写收敛到 hub');
    expect(run.rootValue('peer', 'n')).toBe(101);
  });
});

// ═══════════════════════════ C4：forged/mismatched CLOSE_OK 显式收口 ═══════════════════════════

describe('SA6 C4（issue #171，Scope 5/AC4）：错配 CLOSE_OK 必须按权威 ACK 关联策略显式收口', () => {
  it('C4：removeTarget 后 CLOSE_OK 被扣（真实 CLOSE_OK 丢失）→ 注入错配 CLOSE_OK → 连接必须显式 violation 收口（非静默滞留）', async () => {
    const run = await boot({ timeouts: { closeTimeoutMs: 60_000 } });
    await run.waitNamespace('live');
    // 扣住真实 CLOSE_OK → peer 停留 closing（closeTimeout 60s——排除兜底先行）
    run.dropNextHubFrame('CLOSE_OK');
    const closeP = run.peer.removeTarget(run.nsId);
    await run.waitNamespace('closing');
    // 注入错配 CLOSE_OK（ackedSequence 与 closeSequence 不匹配；序列遵循注入记账纪律）
    run.injectHub({
      kind: 'CLOSE_OK',
      namespaceId: run.nsId,
      ackedSequence: 999_999,
    } as ReplicationMessage);
    await settle();
    // ── 红灯锚 1：错配 CLOSE_OK → 显式连接级 ACK_STATE_VIOLATION（connectionFatal →
    //    ERROR 帧 + close + blocked；现实现：静默忽略 → 连接滞留 ready → 红灯）──
    expect(
      run.peerFramesAll('ERROR').some((f) => (f.message as { code: string }).code === 'ACK_STATE_VIOLATION'),
      '错配 CLOSE_OK 必须产生 ACK_STATE_VIOLATION 显式错误帧',
    ).toBe(true);
    // ── 红灯锚 2：协议违例 → 连接 blocked（现实现：零迁移 → ready → 红灯）──
    expect(run.connectionState(), '错配 CLOSE_OK 必须进入 blocked').toBe('blocked');
    // ── 红灯锚 3：transport 关闭（1002 协议错误；现实现：连接不开 → 红灯）──
    expect(run.wire.peerSideClosed, '错配 CLOSE_OK 必须关闭传输').toBe(true);
    // ── 红灯锚 4：removeTarget 承诺不得无界悬挂——violation 收口 = 关闭承诺兑现
    //    （现实现：零结算 → 预算耗尽 → 红灯）──
    let closeSettled = false;
    void closeP.then(() => {
      closeSettled = true;
    });
    await untilMicrotask(() => closeSettled, 'removeTarget 承诺经 violation 收口有限结算');
  });
});

// ═══════════════════════════ G5：GOAWAY SERVER_RESTARTING 同步静默 ═══════════════════════════

describe('SA6 G5（issue #171，Scope 6/AC5）：GOAWAY SERVER_RESTARTING 收帧同步静默，deadline 仅关传输', () => {
  it('G5：GOAWAY(SERVER_RESTARTING) 收帧后（deadline 未到）订阅必须已摘除、新数据零接受；deadline 只关 transport', async () => {
    const run = await boot();
    await run.waitNamespace('live');
    expect(typeof peerSubscriptionOf(run), '前置：live 期订阅注册').toBe('function');
    run.injectHub({
      kind: 'GOAWAY',
      reasonCode: 'SERVER_RESTARTING',
      drainTimeoutMs: 5_000,
    } as ReplicationMessage);
    await settle(); // 帧已处理、deadline timer 已武装（零 advanceBy——此刻 deadline 未到）
    // ── 红灯锚 1：收帧同步段订阅必须已摘除（现实现：quiesceControllers 整体挂在
    //    drain deadline 回调 → 订阅仍在 → 红灯）──
    expect(peerSubscriptionOf(run), 'GOAWAY 收帧同步段必须已静默订阅').toBeUndefined();
    // ── 红灯锚 2：收帧后不得再接受/送出新数据（同步静默先于异步 drain；现实现：
    //    控制器状态不变 → 业务写照常经 session fanout 出 UPDATE（hub 收 n=4242）
    //    → 红灯）──
    await run.writePeer({ n: 4242 });
    await settle();
    expect(run.peerFrames('UPDATE'), 'GOAWAY 后零新数据帧（同步静默）').toHaveLength(0);
    expect(run.rootValue('hub', 'n'), 'GOAWAY 后 hub 不得收到新提交').toBe(42);
    // ── 锚 3（companion）：deadline 到期——transport 关闭（协议 §6.3 时序面；
    //    修复后 deadline 只管 transport close，静默已发生在收帧段）──
    await run.peerNode.scheduler.advanceBy(5_000);
    await settle();
    expect(run.wire.peerEnd.closed, 'deadline 到期必须关闭传输').toBe(true);
    expect(run.peer.getConnectionState(), 'GOAWAY 后连接按协议时序收口').toBe('ready');
    await run.peer.stop();
    await settleUntil(() => run.peer.getConnectionState() === 'stopped', 'stopped');
  });
});
