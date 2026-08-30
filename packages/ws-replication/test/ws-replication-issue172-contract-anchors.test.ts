/**
 * SA6 契约锚定 — Issue #172（Phase 5 权威契约收敛）可执行红灯/回归锚。
 *
 * 冻结值的权威来源（SA8 conflict-report「门禁提示 1」：向权威文档+冻结值对齐，
 * 不得以代码现状改写冻结值）：
 *   - docs/protocols/instance-replication-v1.md §17（背压/保留额度/checkpoint）、
 *     §18（ping/pong 缺省与 close 语义）、§6.3/§21（GOAWAY 相对 drain timeout）、
 *     §10.2/§13.1（错误 ACK 关联 → connection fatal ACK_STATE_VIOLATION）；
 *   - docs/adr/0010 issue #161 修订节（maxQueuedControlBytes 缺省 8MiB、
 *     checkpoint=max(1,floor(ackTimeoutMs/100))、peer pong 超时 close(1001)、
 *     gap/repeat/错误 ACK 关联关闭连接、GOAWAY 静默订阅先于异步 drain）。
 *
 * 分组与当前偏差（运行证据见本文件断言；任务简报 §「测试设计与红灯运行结果」）：
 *   G1 control reserve 公共字段名/缺省/下界 —— 已于 #172 收敛（A1-1..A1-3 现绿）：
 *     maxQueuedControlBytes=8MiB、>=maxBootstrapBytes+协议开销，记账判据换读冻结字段。
 *   G2 backpressure 恢复检查点 —— #169 已实现
 *     max(1,floor(ackTimeoutMs/100))（缺省 100ms）；A2-1/A2-2 为现绿回归锁。
 *   G3 pong timeout 语义 —— peer 侧 close(1001)+backoff 已实现（R4 锚绿）；
 *     hub 侧 close(1002) 且错误码 PONG_TIMEOUT 不在 §13.1 注册表（冻结 close(1001)）。
 *     （行为修复属 #170：A3-1 保持红灯为 #170 验收锚；A3-2/A3-3 为现绿回归锁。）
 *   G4 CLOSE_OK 关联违规 —— 代码在 closing/live 期对不匹配/多余 CLOSE_OK 静默忽略；
 *     冻结「错误 ACK 关联关闭连接」（ACK_STATE_VIOLATION 1002）。
 *     （行为修复属 #171：A4-1/A4-2 保持红灯为 #171 验收锚。）
 *   G5 GOAWAY quiesce/deadline —— peer 收侧 deadline、SHUTTING_DOWN→blocked 及 drain
 *     窗口内停止 OPEN / 不开始新 sync round 已实现（A5-1..A5-4 绿）；hub 停机先发
 *     GOAWAY（§21）仍未实现（A5-5 为 #171 延后锚）。
 *
 * 纪律：真实 yjs / Registry / Runtime / HubReplication / PeerReplication；fake-duplex +
 * fake scheduler；零 real sleep；零源码 grep 断言；公共 API 尚缺的冻结字段经
 * `as unknown as Partial<...>` 注入（编译期不锁死实现面）。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_REPLICATION_LIMITS,
  DEFAULT_REPLICATION_TIMEOUTS,
  createHubReplication,
} from '@nomicore/ws-replication';
import type { ReplicationLimits } from '@nomicore/ws-replication';
import type { CloseOkMsg, GoawayMsg } from '@nomicore/replication-protocol';
import { encodeMessage } from '@nomicore/replication-protocol';
import { boot, DEFAULT_PEER_VERIFIER, makeAuthorizer } from './driver.js';
import type { Run } from './driver.js';
import { bootMulti } from './issue137-driver.js';
import type { Run137 } from './issue137-driver.js';
import {
  HUB_INSTANCE,
  HUB_OWNER,
  PEER_INSTANCE,
  deferred,
  makeNode,
  settle,
  settleUntil,
} from './harness.js';
import type { DuplexTransport } from './harness.js';

// ═══════════════════════════════════════════════════════════════════════
// G1 — control reserve 公共字段名 / 缺省值 / 下界校验 / 记账（protocol §17：
//     maxQueuedControlBytes 缺省 8 MiB；必须 ≥ maxBootstrapBytes + 协议开销；
//     额度按 socket 缓冲内未冲刷控制字节计；耗尽 = CONNECTION_BACKPRESSURE 1011）
// ═══════════════════════════════════════════════════════════════════════

describe('G1（#172）：control reserve 公共契约 = maxQueuedControlBytes / 8MiB / 下界 / 记账', () => {
  it('A1-1：DEFAULT_REPLICATION_LIMITS 必须导出 maxQueuedControlBytes 且缺省恰为 8 MiB', () => {
    const limits = DEFAULT_REPLICATION_LIMITS as unknown as Record<string, unknown>;
    expect(limits.maxQueuedControlBytes).toBe(8 * 1024 * 1024);
    // 链式下界：8MiB ≥ maxBootstrapBytes(4MiB) + 协议开销 —— 冻结文档 §17 校验行
    expect(limits.maxQueuedControlBytes as number).toBeGreaterThanOrEqual(
      (limits.maxBootstrapBytes as number) + 128,
    );
  });

  it('A1-2：构造期下界校验 —— maxQueuedControlBytes(1024) < maxBootstrapBytes+开销 必须同步 TypeError', () => {
    const node = makeNode('hub');
    expect(() =>
      createHubReplication({
        instanceId: HUB_INSTANCE,
        registry: node.registry,
        authorize: makeAuthorizer({}).authorize,
        timer: node.scheduler,
        verifyToken: DEFAULT_PEER_VERIFIER,
        limits: { maxQueuedControlBytes: 1_024 } as unknown as Partial<ReplicationLimits>,
      }),
    ).toThrow(TypeError);
  });

  it('A1-2b 回归锁：满足下界的 maxQueuedControlBytes(5_000_000) 不得被构造期拒绝', () => {
    const node = makeNode('hub');
    expect(() =>
      createHubReplication({
        instanceId: HUB_INSTANCE,
        registry: node.registry,
        authorize: makeAuthorizer({}).authorize,
        timer: node.scheduler,
        verifyToken: DEFAULT_PEER_VERIFIER,
        limits: { maxQueuedControlBytes: 5_000_000 } as unknown as Partial<ReplicationLimits>,
      }),
    ).not.toThrow();
  });

  it('A1-3：冻结字段驱动记账 —— 暂停段 control 流量超 maxQueuedControlBytes(1_500) 必须 CONNECTION_BACKPRESSURE(1011)', async () => {
    const run = await bootMulti({
      count: 1,
      withPressure: true,
      limits: {
        lowWater: 64_000,
        highWater: 100_000,
        maxInFlightUpdates: 8,
        maxQueuedUpdateCount: 100,
        maxQueuedUpdateBytes: 1_048_576,
        // 冻结字段名（protocol §17）；SA6 经 unknown 注入——编译期不锁死实现面
        maxQueuedControlBytes: 1_500,
        // #172：新链式下界（§17）要求 maxQueuedControlBytes(1_500) ≥ maxBootstrapBytes+128 ⇒
        // 同 limits 降 maxBootstrapBytes（实测 fixture 快照 345B，1_024 ≈ 3× 裕量）
        maxBootstrapBytes: 1_024,
      } as unknown as Partial<ReplicationLimits>,
      timeouts: { ackTimeoutMs: 60_000 },
    });
    const nsId = run.nsIds[0] as string;
    const K = 40; // ≈ 3,000B control > 1,500 额度（R2-4 同构：57B/ACK × 40）
    run.setHubPressure(150_000); // > highWater 100_000 → hub 出站暂停段（control 只受保留额度）
    for (let n = 1; n <= K; n += 1) await run.peerWrite(nsId, { n });
    await settle();

    // 冻结语义：额度耗尽 → 分类连接失败 CONNECTION_BACKPRESSURE(1011)。
    // #172 收敛后：字段驱动记账生效（缺省 8 MiB；此处显式 1_500 额度 → 暂停段 K×57B 越界耗尽）。
    expect(run.wire().peerSideCloseInfo?.code).toBe(1011);
    expect(run.connectionState()).toBe('backoff');
    const errors = run
      .frames('hubToPeer')
      .filter((f) => f.message.kind === 'ERROR')
      .map((f) => (f.message as { code: string }).code);
    expect(errors).toContain('CONNECTION_BACKPRESSURE');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// G2 — backpressure 恢复检查点 = max(1, floor(ackTimeoutMs/100))（protocol §17；
//     缺省 ackTimeoutMs=10_000 → 100ms）。#169 已交付，本组为现绿回归锁。
// ═══════════════════════════════════════════════════════════════════════

/**
 * G2 观察面：暂停后 hub 出站只由 checkpoint-间隔的 poll 恢复 —— 通过「压力从高位
 * 降到低位后，下一笔 hub→peer 数据派发的到达时刻」锚定 cadence（零录制 timer）。
 */
async function assertResumeWithinCheckpoint(opts: {
  run: Run137;
  advanceMs: number;
  pollNote: string;
}): Promise<void> {
  const { run, advanceMs, pollNote } = opts;
  const nsId = run.nsIds[0] as string;
  const updateCount = (): number =>
    run.frames('hubToPeer').filter((f) => f.message.kind === 'UPDATE').length;

  // ① 基线：无压力下 hub 本地写 → fanout UPDATE 直达 peer（1 笔）
  await run.hubWrite(nsId, { n: 11 });
  await settleUntil(() => updateCount() >= 1, '基线 fanout UPDATE');
  const baseline = updateCount();

  // ② 高位（> highWater 512KiB）：下一笔 hub 本地写的 fanout 在 data 闸门
  //    （观察 → 进入暂停段）入有界队列——零 UPDATE 派发
  run.setHubPressure(600_000);
  await run.hubWrite(nsId, { n: 12 });
  await settle();
  expect(updateCount(), '暂停段零 UPDATE 派发').toBe(baseline);

  // ③ 压力清除（≤ lowWater）→ 只有 poll 会观察并恢复；advance 到 checkpoint 之后须已派发
  run.setHubPressure(0);
  await run.hubNode.scheduler.advanceBy(advanceMs);
  await settle();
  expect(updateCount(), pollNote).toBe(baseline + 1);
}

describe('G2（#172/#169）：backpressure 恢复检查点 = max(1, floor(ackTimeoutMs/100))', () => {
  it('A2-1：缺省 ackTimeoutMs=10_000 → 恢复检查点 = 100ms', async () => {
    const run = await bootMulti({ count: 1, withPressure: true });
    await assertResumeWithinCheckpoint({
      run,
      advanceMs: 150, // 冻结 100ms < 150 < 当前 1_000ms
      pollNote: '缺省 checkpoint=floor(10000/100)=100ms：advance 150ms 内 poll 必须已恢复并派出积压',
    });
  });

  it('A2-2：ackTimeoutMs=600 → 检查点 = 6ms', async () => {
    const run = await bootMulti({
      count: 1,
      withPressure: true,
      timeouts: { ackTimeoutMs: 600 },
    });
    await assertResumeWithinCheckpoint({
      run,
      advanceMs: 20, // 冻结 6ms < 20 < 当前 1_000ms
      pollNote: 'checkpoint=floor(600/100)=6ms：advance 20ms 内 poll 必须已恢复并派出积压',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// G3 — ping/pong timeout error/close semantics（protocol §18：pong 超时按临时
//     失败处理——关闭传输 close(1001) 并经 backoff 重连；HELLO/pong timeout 关闭连接）。
//     行为修复属 #170：A3-1 为 #170 验收锚；A3-2/A3-3 为现绿回归锁。
// ═══════════════════════════════════════════════════════════════════════

interface HubPingWire {
  readonly peerEnd: DuplexTransport;
  readonly hubEnd: DuplexTransport;
  pingCount(): number;
  readonly hubSideClosed: boolean;
  readonly hubSideCloseCode: number | undefined;
}

/** hub 侧 transport 暴露 ping/onPong（注入活性面）；peer 侧为哑端（仅 HELLO 驱动）。 */
function makeHubPingWire(): HubPingWire {
  const peerListeners = new Set<(bytes: Uint8Array) => void>();
  const peerCloseListeners = new Set<(info: Readonly<{ code: number; reason: string }>) => void>();
  const hubListeners = new Set<(bytes: Uint8Array) => void>();
  const hubCloseListeners = new Set<(info: Readonly<{ code: number; reason: string }>) => void>();
  let pings = 0;
  let peerClosed = false;
  let hubClosed = false;
  let hubSideCloseCode: number | undefined;

  const peerEnd: DuplexTransport = {
    send(bytes) {
      if (peerClosed) return;
      const copy = bytes.slice();
      queueMicrotask(() => {
        for (const listener of [...hubListeners]) listener(copy);
      });
    },
    close(code = 1000, reason = '') {
      if (peerClosed) return;
      peerClosed = true;
      queueMicrotask(() => {
        for (const listener of [...peerCloseListeners]) listener({ code, reason });
      });
    },
    get closed() {
      return peerClosed;
    },
    onMessage(listener) {
      peerListeners.add(listener);
      return () => peerListeners.delete(listener);
    },
    onClose(listener) {
      peerCloseListeners.add(listener);
      return () => peerCloseListeners.delete(listener);
    },
  };

  const hubEnd = {
    send(bytes: Uint8Array) {
      if (hubClosed) return;
      const copy = bytes.slice();
      queueMicrotask(() => {
        for (const listener of [...peerListeners]) listener(copy);
      });
    },
    close(code = 1001, reason = 'hub-close') {
      if (hubClosed) return;
      hubClosed = true;
      hubSideCloseCode = code;
      queueMicrotask(() => {
        for (const listener of [...hubCloseListeners]) listener({ code, reason });
      });
    },
    get closed() {
      return hubClosed;
    },
    onMessage(listener) {
      hubListeners.add(listener);
      return () => hubListeners.delete(listener);
    },
    onClose(listener) {
      hubCloseListeners.add(listener);
      return () => hubCloseListeners.delete(listener);
    },
    ping() {
      pings += 1;
    },
    onPong(listener: () => void) {
      // 活性面：pong 回调挂载（无人触发 → 超时路径可测）；必须返回退订函数（N1 纪律）
      void listener;
      return () => {};
    },
  } as DuplexTransport;

  return {
    peerEnd,
    hubEnd,
    pingCount: () => pings,
    get hubSideClosed() {
      return hubClosed;
    },
    get hubSideCloseCode() {
      return hubSideCloseCode;
    },
  };
}

describe('G3（#172/#170）：ping/pong timeout error/close semantics', () => {
  // → #170 验收锚：本票以 it.fails 注册，行为修复落地后本用例转绿会使套件反红——届时摘除 .fails 标记
  it.fails('A3-1 RED：hub 侧 pong 超时 → 关闭传输 close code = 1001（临时失败语义；现 close(1002) 且错误码 PONG_TIMEOUT 不在 §13.1 注册表）', async () => {
    const node = makeNode('hub');
    const hub = createHubReplication({
      instanceId: HUB_INSTANCE,
      registry: node.registry,
      authorize: makeAuthorizer({}).authorize,
      timer: node.scheduler,
      verifyToken: DEFAULT_PEER_VERIFIER,
      timeouts: { pingIntervalMs: 100, pongTimeoutMs: 40 },
    });
    const wire = makeHubPingWire();
    hub.accept(wire.hubEnd, { token: 'peer-token' });
    // 哑 peer 完成握手（真实 HELLO 帧）
    wire.peerEnd.send(
      encodeMessage({
        kind: 'HELLO',
        peerInstanceId: PEER_INSTANCE,
        expectedHubInstanceId: HUB_INSTANCE,
        protocolVersions: [1],
        requiredCapabilities: 0,
        optionalCapabilities: 0,
        connectionNonce: new Uint8Array(16).fill(7),
      }),
    );
    await settleUntil(() => hub.connections[0]?.state === 'ready', 'hub 连接 ready（HELLO_ACK 已回）');
    await node.scheduler.advanceBy(100); // ping 周期到 → 活性循环已 ping
    expect(wire.pingCount(), '前置：ping 已发出').toBe(1);
    // pong 未复 → onPongTimeout（pongTimeoutMs=40 后）
    await node.scheduler.advanceBy(40);
    await settle();
    expect(wire.hubSideClosed, 'pong 超时必须关闭传输').toBe(true);
    // 冻结语义（protocol §18）：临时失败 = close(1001)；当前实现 close(1002)（协议错误域）→ 红灯
    expect(wire.hubSideCloseCode, 'pong 超时 close code 必须为 1001').toBe(1001);
  });

  it('A3-2 回归锁：构造期校验 pongTimeoutMs < pingIntervalMs（违反 → 同步 TypeError，绝不运行时 clamp）', () => {
    const node = makeNode('hub');
    expect(() =>
      createHubReplication({
        instanceId: HUB_INSTANCE,
        registry: node.registry,
        authorize: makeAuthorizer({}).authorize,
        timer: node.scheduler,
        verifyToken: DEFAULT_PEER_VERIFIER,
        timeouts: { pingIntervalMs: 1_000, pongTimeoutMs: 2_000 },
      }),
    ).toThrow(TypeError);
  });

  it('A3-3 回归锁：工程缺省 pingIntervalMs=30_000 / pongTimeoutMs=10_000（§18 冻结值）', () => {
    expect(DEFAULT_REPLICATION_TIMEOUTS.pingIntervalMs).toBe(30_000);
    expect(DEFAULT_REPLICATION_TIMEOUTS.pongTimeoutMs).toBe(10_000);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// G4 — CLOSE_OK 关联违规（protocol §10.2/§13.1：错误 ACK 关联 → connection fatal
//     ACK_STATE_VIOLATION 1002；ADR-0010 #161：gap/repeat/错误 ACK 关联关闭连接）。
//     行为修复属 #171：A4-1/A4-2 为 #171 验收锚。
// ═══════════════════════════════════════════════════════════════════════

function closeNamespaceSeqOf(run: Run): number {
  const frames = run.peerFrames('CLOSE_NAMESPACE');
  const last = frames[frames.length - 1];
  if (last === undefined) throw new Error('CLOSE_NAMESPACE 未发出');
  return last.header.sequence;
}

describe('G4（#172/#171）：CLOSE_OK 关联违规 → ACK_STATE_VIOLATION(1002)', () => {
  // → #171 验收锚：本票以 it.fails 注册，行为修复落地后本用例转绿会使套件反红——届时摘除 .fails 标记
  it.fails('A4-1 RED：closing 期 CLOSE_OK.ackedSequence ≠ CLOSE_NAMESPACE 序列 → connection fatal（现静默忽略、等 closeTimeout）', async () => {
    const run = await boot();
    await run.waitNamespace('live');
    // 真实 hub 的 CLOSE_OK 将被丢弃（一帧故障注入），注入帧独占下一序列——确定性
    run.dropNextHubFrame('CLOSE_OK');
    // fire-and-forget：真实 CLOSE_OK 被丢弃 → closeMemo 待 closeTimeout 结算
    //（不 await——fake scheduler 不自动推进，await 恒挂）
    void run.peer.removeTarget(run.nsId);
    await settleUntil(() => run.peerFrames('CLOSE_NAMESPACE').length >= 1, 'CLOSE_NAMESPACE 已发出');
    const closeSeq = closeNamespaceSeqOf(run);
    // 等真实 CLOSE_OK 已被丢弃（dropHub 谓词消费完毕）——注入帧不得再命中 drop
    await settleUntil(() => run.wire.droppedHubToPeer.length >= 1, '真实 CLOSE_OK 已被丢弃');
    // 注入错误关联 CLOSE_OK（ackedSequence = 真实序列 + 1）
    run.injectHub({ kind: 'CLOSE_OK', namespaceId: run.nsId, ackedSequence: closeSeq + 1 } satisfies CloseOkMsg);
    let fatalSeen = false;
    try {
      await settleUntil(
        () => run.wire.peerSideCloseInfo !== undefined,
        'connection fatal（错误 CLOSE_OK 关联）',
        2_000,
      );
      fatalSeen = true;
    } catch {
      // 当前实现：静默忽略 → 零关闭 → 走下方断言（干净失败）
    }
    expect(fatalSeen, '错误关联 CLOSE_OK 必须触发 connection fatal').toBe(true);
    // 冻结语义：ACK_STATE_VIOLATION（§13.1 wsCloseCode 1002）+ 连接错误帧
    expect(run.wire.peerSideCloseInfo?.code).toBe(1002);
    const errorCodes = run.peerFrames('ERROR').map((f) => (f.message as { code: string }).code);
    expect(errorCodes).toContain('ACK_STATE_VIOLATION');
  });

  // → #171 验收锚：本票以 it.fails 注册，行为修复落地后本用例转绿会使套件反红——届时摘除 .fails 标记
  it.fails('A4-2 RED：无对应未决 CLOSE_NAMESPACE 的 CLOSE_OK（live 期）→ connection fatal（现静默忽略）', async () => {
    const run = await boot();
    await run.waitNamespace('live');
    run.injectHub({ kind: 'CLOSE_OK', namespaceId: run.nsId, ackedSequence: 1 } satisfies CloseOkMsg);
    let fatalSeen = false;
    try {
      await settleUntil(
        () => run.wire.peerSideCloseInfo !== undefined,
        'connection fatal（多余的 CLOSE_OK）',
        2_000,
      );
      fatalSeen = true;
    } catch {
      // 当前实现：静默忽略 → 零关闭 → 走下方断言（干净失败）
    }
    expect(fatalSeen, '多余 CLOSE_OK 必须触发 connection fatal').toBe(true);
    expect(run.wire.peerSideCloseInfo?.code).toBe(1002);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// G5 — GOAWAY quiesce/deadline（protocol §6.3：停 OPEN、不开始新 sync round、
//     现有 namespace 到 deadline 前自然收口、之后发送方 WS 1001 关闭；§21 停机
//     顺序第 1 步「停止接纳并发送 GOAWAY」）。A5-1..A5-4 为现绿回归锁；A5-5
//     仍为 #171 延后锚。
// ═══════════════════════════════════════════════════════════════════════

describe('G5（#172/#171）：GOAWAY quiesce/deadline', () => {
  it('A5-1：GOAWAY drain 窗口内 addTarget 必须停止 OPEN', async () => {
    const run = await boot();
    await run.waitNamespace('live');
    run.injectHub({ kind: 'GOAWAY', reasonCode: 'SERVER_RESTARTING', drainTimeoutMs: 60_000 });
    await settle();
    const openedBefore = run.peerFramesAll('OPEN_NAMESPACE').length;
    run.peer.addTarget({ namespaceId: `ns-${'f'.repeat(32)}`, localOwner: HUB_OWNER });
    await settle();
    expect(
      run.peerFramesAll('OPEN_NAMESPACE').length,
      'GOAWAY 后停止 OPEN（§6.3）',
    ).toBe(openedBefore);
  });

  it('A5-2：GOAWAY drain 窗口内 needs-resync 不得启动新 sync round', async () => {
    const run = await boot({
      limits: { maxInFlightUpdates: 1, maxQueuedUpdateCount: 1 },
    });
    await run.waitNamespace('live');
    // 队列溢出 → needs-resync + RESYNC_REQUIRED（ac6 同构：门闩悬挂首个 apply）
    run.hubNode.persistence.saveGate = deferred();
    await run.writePeer({ n: 1 });
    await run.writePeer({ extra: 2 }); // 入队（cap=1）
    await run.writePeer({ ext: 3 }); // 溢出 → needs-resync
    await settle();
    expect(run.namespaceState()).toBe('needs-resync');
    const sentUpdates = run.peerFrames('UPDATE');
    expect(sentUpdates.length, '前置：唯一在途 UPDATE（n=1）已发出').toBe(1);
    const updateSeq = sentUpdates[0]?.header.sequence;
    if (updateSeq === undefined) throw new Error('UPDATE 序列缺失');
    // 置后 drop：放行门闩后的真实 UPDATE_ACK 被丢弃——手工注入帧独占序列空间，
    // 避免「真实 hub 出站帧与注入帧同序列」撞号（序列纪律之下的伪 fatal）。
    run.dropNextHubFrame('UPDATE_ACK');
    const g = run.hubNode.persistence.saveGate;
    run.hubNode.persistence.saveGate = undefined;
    if (g !== undefined) g.resolve();
    await settleUntil(() => run.wire.droppedHubToPeer.length >= 1, '真实 UPDATE_ACK 已被丢弃');
    // GOAWAY（drain 窗口 60s）→ 窗口内不得开始新 sync round
    run.injectHub({ kind: 'GOAWAY', reasonCode: 'SERVER_RESTARTING', drainTimeoutMs: 60_000 });
    await settle();
    const step1Before = run.peerFramesAll('SYNC_STEP1').length; // 仅 bootstrap round
    // 手工注入正确关联的 UPDATE_ACK —— 触发收口/恢复决策点（in-flight=0 → maybeStartRecovery）
    run.injectHub({ kind: 'UPDATE_ACK', namespaceId: run.nsId, ackedSequence: updateSeq });
    // 等待恢复决策过去：当前实现会开出新 round（SYNC_STEP1）；冻结语义（GOAWAY 窗口内
    // 不开始新 round）下该等待预算耗尽——两种结局都收敛到下方断言。
    let newRoundSeen = false;
    try {
      await settleUntil(
        () => run.peerFramesAll('SYNC_STEP1').length >= step1Before + 1,
        '恢复 round 尝试（当前实现）',
        2_000,
      );
      newRoundSeen = true;
    } catch {
      // 冻结语义：GOAWAY drain 窗口内未开始新 round
    }
    expect(
      run.peerFramesAll('SYNC_STEP1').length,
      'GOAWAY drain 窗口内不开始新 sync round（§6.3）',
    ).toBe(step1Before);
    void newRoundSeen;
  });

  it('A5-3 回归锁：GOAWAY(SERVER_RESTARTING) deadline → quiesce + 传输 close(1001)', async () => {
    const run = await boot();
    await run.waitNamespace('live');
    run.injectHub({ kind: 'GOAWAY', reasonCode: 'SERVER_RESTARTING', drainTimeoutMs: 500 });
    await settle();
    await run.peerNode.scheduler.advanceBy(500);
    await settle();
    expect(run.wire.peerEnd.closed, 'deadline 后传输必须关闭').toBe(true);
    // peer 自行 close(1001) → 对端（hub）收到 close 事件 → wire.hubSideCloseInfo 记录
    expect(run.wire.hubSideCloseInfo?.code, '关闭码必须为 1001（§6.3「以 WS 1001 关闭」）').toBe(1001);
    await run.peer.stop();
  });

  it('A5-4 回归锁：GOAWAY(SERVER_SHUTTING_DOWN) → blocked（§15.1 原因分类）', async () => {
    const run = await boot();
    await run.waitNamespace('live');
    run.injectHub({ kind: 'GOAWAY', reasonCode: 'SERVER_SHUTTING_DOWN', drainTimeoutMs: 5_000 });
    await settleUntil(() => run.connectionState() === 'blocked', 'GOAWAY SHUTTING_DOWN → blocked');
    await run.peer.stop();
  });

  // → #171 验收锚：本票以 it.fails 注册，行为修复落地后本用例转绿会使套件反红——届时摘除 .fails 标记
  it.fails('A5-5 RED：HubReplication.close() 停机必须先发送 GOAWAY（§21 停机顺序第 1 步；现零 GOAWAY 帧、直接 close(1001)）', async () => {
    const run = await boot();
    await run.waitNamespace('live');
    await run.hub.close();
    await settle();
    const goaways = run.hubFramesAll('GOAWAY');
    expect(goaways.length, '§21：replication 停止接纳连接/target 并发送 GOAWAY').toBe(1);
    const msg = goaways[0]?.message as GoawayMsg;
    expect(typeof msg.drainTimeoutMs).toBe('number');
    expect(typeof msg.reasonCode).toBe('string');
    expect(run.wire.peerSideCloseInfo?.code).toBe(1001);
    await run.peer.stop();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// #172 锚集完整性常驻 meta 守卫（D2-bis）：剩余 4 条延后锚以 it.fails 注册为期望红，
// 本守卫保证锚集不腐烂——删锚 / 把 it.fails 改回 it / 标题抹锚号都会使套件反红。
// 对象是本测试文件自身的登记面自检（非实现源码——不违「零源码 grep 断言」纪律）。
// ═══════════════════════════════════════════════════════════════════════

/** 延后锚冻结清单（→ #170/#171 验收锚；修复票落地摘标时同步缩清单，否则守卫反红）。 */
const DEFERRED_ANCHORS = [
  'A3-1',
  'A4-1',
  'A4-2',
  'A5-5',
] as const;

it('#172 meta：延后锚集完整性守卫（4 条 it.fails 在场 + 冻结标题锚定）', () => {
  const source = readFileSync(new URL(import.meta.url), 'utf8');
  const failsCount = (source.match(/it\.fails\(/g) ?? []).length;
  expect(
    failsCount,
    'it.fails 用例数 = DEFERRED_ANCHORS 清单长度（删锚/漏改标记都会反红）',
  ).toBe(DEFERRED_ANCHORS.length);
  for (const id of DEFERRED_ANCHORS) {
    expect(
      new RegExp(`it\\.fails\\('${id} `).test(source),
      `延后锚 ${id} 必须以 it.fails 注册且标题保留冻结锚号`,
    ).toBe(true);
  }
});
