/**
 * SA6 红灯验收 —— issue #137：multiplex namespaces with bounded fair backpressure。
 *
 * 契约：docs/protocols/instance-replication-v1.md §10.1（未发送合并）/§17（per-namespace
 * 有界队列、connection 总压力、control 保留额度、bufferedAmount 高/低水位与 Cordis
 * Timer 检查、不进入 Runtime sequencer）；ADR 0010 L151；#136 设计 §4.4（连接级
 * control 恒先 + data per-ns 队列 round-robin 每轮每 ns 至多一笔 + lowWater/highWater
 * 作用于连接排队字节记账 + CONNECTION_BACKPRESSURE）——该节为 #136 登记 R-11/F6 的
 * 演进位（SA4 判定「切片 7 必须接上 bufferedAmount 水位观察、连接排队字节记账、
 * round-robin data 队列喂入与 CONNECTION_BACKPRESSURE close(1011)」），即本 issue。
 *
 * 红灯纪律：真实 yjs / Registry / Runtime 双实例；fake-duplex 内存双端；零 real sleep
 *（fake scheduler + 微任务 + saveGates/门闩驱动）；零源码 grep 断言。
 *
 * 已有实现测定（探针实测，非本文件锚点——见任务简报「成熟度测定」节）：
 * - AC-1（单连接按 namespaceId 多路复用 + 禁止同连接重开）已在 issue #136 交付（本
 *   批探针：双 namespace 单连接双向 live + 断线重连双双 live + 重开→
 *   REOPEN_REQUIRES_RECONNECT 全部通过）——不以红灯锚定；
 * - AC-3（每-ns 溢出只丢未发送增量 + needs-resync + 本地已接受状态保留）亦已交付
 *   （#136 AC6/F1/§4.4 note）——本批以 AC-5 的连接级溢出隔离作其多-ns 形态守卫；
 * - 故障隔离（A 终态失败不影响 B）、重连修复（双 ns 断线重连）、per-ns 队列/窗口/
 *   ACK-timeout 上限 —— 探针实测全部通过（已绿），以守卫断言组入以下用例。
 *
 * 本文件锚定的 #137 新域红灯（当前实现全部实测红）：
 * - AC-2 未发送增量合并（§10.1 Y.mergeUpdates）——当前每笔未发送增量一帧；
 * - AC-4+AC-6a 连接级公平调度 + 高水位暂停：bufferedAmount 超 high-water 时 dequeue
 *   暂停（零 UPDATE 帧——「调度器结构性存在但测试中零积压」意味着公平轮转只有在
 *   队列积压时才可观察，故与压力联测：积压恢复段须按 ns 严格交替、每轮每 ns 至多
 *   一笔）——当前无视压力立即发送（零积压）；
 * - AC-5 连接总压力收口（maxQueuedBytesPerConnection 执行 + 只收口最大 queued ns +
 *   其他 ns 不受影响 + 恢复 round 补齐）——当前该限额字段运行时从未被读取；
 * - AC-6b hub 出站方向高水位暂停（data 不通、control 保留额度照常 + 不阻塞
 *   Runtime sequencer）。
 *
 * seam 说明（AC-6）：DuplexTransport 以 `bufferedAmount` number 属性暴露发送缓冲水位
 *（与真实 WebSocket 属性同构；#136 设计 §4.4/R-11「切片 7 适配层必须接上
 * bufferedAmount 观察」）。实现经 `transport.bufferedAmount` 读取，缺省为 0（无压力），
 * 因此既有 harness makeWire（无该属性）与 #136 全部用例不受影响。
 */
import { describe, expect, it } from 'vitest';
import { bootMulti } from './issue137-driver.js';
import { deferred, settle, settleUntil } from './harness.js';

const HIGH_WATER = 512 * 1024; // DEFAULT_REPLICATION_LIMITS.highWater
const LOW_WATER = 64 * 1024; // DEFAULT_REPLICATION_LIMITS.lowWater

/** 当前连接 wire 上（peer→hub 方向）UPDATE 帧的 namespaceId 序列（按到达序）。 */
function peerUpdateNsSeq(run: ReturnType<typeof bootMulti> extends Promise<infer T> ? T : never): string[] {
  return run
    .frames('peerToHub')
    .filter((f) => f.message.kind === 'UPDATE')
    .map((f) => (f.message as { namespaceId: string }).namespaceId);
}

describe('issue #137：multiplex + bounded fair backpressure 红灯契约', () => {
  // ─────────────────────────────── AC-2：未发送增量合并 ───────────────────────────────

  it('AC-2: 未发送、未分配序列的 queued updates 允许 Y.mergeUpdates 合并（发送帧数 < 增量数）', async () => {
    const run = await bootMulti({
      count: 1,
      limits: { maxInFlightUpdates: 1, maxQueuedUpdateCount: 100, maxQueuedUpdateBytes: 1_048_576 },
      timeouts: { ackTimeoutMs: 60_000 },
    });
    const a = run.nsIds[0] as string;
    // 悬挂 hub 侧首个 saveDoc：A1 的 ACK 被扣 → A 窗口满 → A2/A3/A4 进入未发送队列
    const gate = deferred();
    run.hubNode.persistence.saveGate = gate;
    await run.peerWrite(a, { n: 11 });
    await run.peerWrite(a, { n: 12 });
    await run.peerWrite(a, { n: 13 });
    await run.peerWrite(a, { n: 14 });
    await settle();

    // 本地已接受状态保留（sequencer 不受发送队列影响）——守卫断言
    expect(run.rootValue('peer', a, 'n')).toBe(14);
    // 窗口满：仅 A1 在途（一帧）；其余 3 笔停留未发送
    expect(run.framesOf('peerToHub', a).filter((f) => f.message.kind === 'UPDATE')).toHaveLength(1);

    // 释放 dirty → ACK A1 → 未发送队列排空
    run.hubNode.persistence.saveGate = undefined;
    gate.resolve();
    await settleUntil(
      () => run.rootValue('hub', a, 'n') === 14,
      'hub 收敛 n=14（当前 ' + String(run.rootValue('hub', a, 'n')) + '）',
    );

    // ★ 红灯锚：3 笔未发送增量必须合并——帧数严格少于增量数（当前实现 4 帧逐笔发送）
    const updates = run.framesOf('peerToHub', a).filter((f) => f.message.kind === 'UPDATE');
    expect(updates.length).toBeLessThan(4);
    // 收敛与已接受状态（守卫）
    expect(run.rootValue('hub', a, 'n')).toBe(14);
    expect(run.rootValue('peer', a, 'n')).toBe(14);
  });

  // ─────────────── AC-4 + AC-6a：高水位暂停 dequeue + 恢复段 round-robin 公平轮转 ───────────────

  it('AC-6a+AC-4: peer 出站 bufferedAmount 超 high-water 暂停 dequeue（零 UPDATE 帧、不阻塞 sequencer）；降至 low-water 恢复且积压按 ns 严格 round-robin', async () => {
    const run = await bootMulti({
      count: 2,
      withPressure: true,
      limits: { maxInFlightUpdates: 32, maxQueuedUpdateCount: 100, maxQueuedUpdateBytes: 1_048_576 },
      timeouts: { ackTimeoutMs: 120_000 },
    });
    const a = run.nsIds[0] as string;
    const b = run.nsIds[1] as string;
    run.setPeerPressure(HIGH_WATER * 2);
    await run.peerWrite(a, { n: 11 });
    await run.peerWrite(a, { n: 12 });
    await run.peerWrite(a, { n: 13 });
    await run.peerWrite(b, { n: 21 });
    await run.peerWrite(b, { n: 22 });
    await run.peerWrite(b, { n: 23 });
    await settle();

    // ★ 红灯锚（核心）：压力高于高水位 → 连接 dequeue 暂停 → 零 UPDATE 帧
    // 当前实现：完全无视 bufferedAmount → 6 帧立即发出 → 本断言红
    expect(run.framesOf('peerToHub', a).filter((f) => f.message.kind === 'UPDATE')).toHaveLength(0);
    expect(run.framesOf('peerToHub', b).filter((f) => f.message.kind === 'UPDATE')).toHaveLength(0);
    // ⇒ 数据不得先行到达（hub 本地未收敛）
    expect(run.rootValue('hub', a, 'n')).toBe(1);
    // 守卫：Runtime sequencer 未被阻塞（本地写已完成、本地已接受状态在位）
    expect(run.rootValue('peer', a, 'n')).toBe(13);
    expect(run.rootValue('peer', b, 'n')).toBe(23);
    expect(run.connectionState()).toBe('ready');

    // 降至低水位以下 → 经注入 Cordis Timer（零 native timer）驱动的检查恢复 dequeue
    run.setPeerPressure(LOW_WATER / 2);
    for (let i = 0; i < 30 && peerUpdateNsSeq(run).length === 0; i += 1) {
      await run.peerNode.scheduler.advanceBy(1_000);
      await settle();
    }
    await settleUntil(
      () => run.rootValue('hub', a, 'n') === 13 && run.rootValue('hub', b, 'n') === 23,
      '恢复后双侧收敛（当前 hubA=' + String(run.rootValue('hub', a, 'n')) + ' hubB=' + String(run.rootValue('hub', b, 'n')) + '）',
    );
    // ★ AC-4 锚：积压恢复必须按 ns 严格交替（每轮每 ns 至多一笔 round-robin）——
    // 当前实现无暂停/无积压（帧已即时发出），走到此处帧序为 A,A,A,B,B,B → 本断言亦红
    expect(peerUpdateNsSeq(run)).toEqual([a, b, a, b, a, b]);
    expect(run.peer.getNamespaceState(a)).toBe('live');
    expect(run.peer.getNamespaceState(b)).toBe('live');
  });

  // ─────────────────────────────── AC-5：连接总压力 ───────────────────────────────

  it('AC-5: 连接总队列超限（maxQueuedBytesPerConnection）只收口最大 queued ns（needs-resync），其他 ns 不受影响，恢复 round 补齐', async () => {
    const BLOB = ['x', 'y', 'z', 'u', 'v'].map((ch) => ch.repeat(30_000));
    const run = await bootMulti({
      count: 2,
      limits: {
        maxInFlightUpdates: 1,
        maxQueuedUpdateCount: 1000,
        maxQueuedUpdateBytes: 200_000,
        maxQueuedBytesPerConnection: 60_000, // 连接总限 60KB：A 队列 2×30KB + B 1×30KB = 90KB 超限
        maxUpdateBytes: 200_000,
      },
      timeouts: { ackTimeoutMs: 60_000 },
    });
    const a = run.nsIds[0] as string;
    const b = run.nsIds[1] as string;
    const gates = run.holdHubSaveDocs();
    const gateA = gates[0] as unknown as import('./harness.js').Deferred;
    const gateB = gates[1] as unknown as import('./harness.js').Deferred;
    await run.peerWrite(a, { blurb: BLOB[0] as string }); // A1 在途（30KB；hub saveDoc 挂起 → 无 ACK）
    await run.peerWrite(a, { blurb: BLOB[1] as string }); // A2 未发送（30KB）
    await run.peerWrite(a, { blurb: BLOB[2] as string }); // A3 未发送（30KB）→ A 队列 60KB
    await run.peerWrite(b, { blurb: BLOB[3] as string }); // B1 在途（30KB；saveDoc 挂起）
    await run.peerWrite(b, { blurb: BLOB[4] as string }); // B2 未发送（30KB）→ 连接总 90KB > 60KB
    await settle();

    // ★ 红灯锚：连接级超限 → 只收口最大 queued namespace（A → needs-resync）
    // 当前实现：maxQueuedBytesPerConnection 从未被运行时读取 → A 恒 live → 本断言红
    await settleUntil(
      () => run.peer.getNamespaceState(a) === 'needs-resync',
      `A 进入 needs-resync（当前 ${String(run.peer.getNamespaceState(a))} / B ${String(run.peer.getNamespaceState(b))}）`,
    );

    // 隔离与本地已接受状态保留（守卫：B 不受影响；A 本地 Y.Doc 状态保留）
    expect(run.peer.getNamespaceState(b)).toBe('live');
    expect(run.rootValue('peer', a, 'blurb')).toBe(BLOB[2] as string);
    expect(run.rootValue('peer', b, 'blurb')).toBe(BLOB[4] as string);
    // 连接仍是同一连接（无整连接重建/关闭）
    expect(run.connectionState()).toBe('ready');

    // 恢复：释放 ACK（A 窗口收口 → 新 round state-vector 补齐被弃增量；B 正常 flush）
    gateA.resolve();
    gateB.resolve();
    await settleUntil(
      () =>
        run.peer.getNamespaceState(a) === 'live' &&
        run.peer.getNamespaceState(b) === 'live',
      `双 ns 恢复 live（当前 A ${String(run.peer.getNamespaceState(a))} / B ${String(run.peer.getNamespaceState(b))}）`,
    );
    await settleUntil(
      () =>
        run.rootValue('hub', a, 'blurb') === BLOB[2] as string &&
        run.rootValue('hub', b, 'blurb') === BLOB[4] as string,
      'hub 双侧收敛（丢弃的未发送增量由恢复 round 补齐）',
    );
  });

  // ─────────────────────── AC-6b：hub 出站 bufferedAmount 高水位暂停（data 不通、control 保留） ───────────────────────

  it('AC-6b: hub 出站 bufferedAmount 超 high-water 暂停 data（零 fan-out UPDATE），control 保留额度不受影响（UPDATE_ACK 照常），不阻塞 Runtime sequencer', async () => {
    const run = await bootMulti({
      count: 1,
      withPressure: true,
      limits: { maxInFlightUpdates: 2, maxQueuedUpdateCount: 100, maxQueuedUpdateBytes: 1_048_576 },
      timeouts: { ackTimeoutMs: 120_000 },
    });
    const a = run.nsIds[0] as string;
    run.setHubPressure(HIGH_WATER * 2);
    // peer → hub 方向不受压：hub 对 peer 写的 UPDATE_ACK 属 control——保留额度照常出
    await run.peerWrite(a, { n: 1 });
    await settle();
    expect(run.frames('hubToPeer').filter((f) => f.message.kind === 'UPDATE_ACK').length).toBeGreaterThanOrEqual(1);
    expect(run.rootValue('hub', a, 'n')).toBe(1);

    // hub → peer 方向（如压）：fan-out UPDATE 属 data——必须暂停
    await run.hubWrite(a, { n: 9 });
    await settle();
    // ★ 红灯锚：高水位下零 fan-out UPDATE 帧（当前实现立即发出 → 本断言红）
    expect(run.frames('hubToPeer').filter((f) => f.message.kind === 'UPDATE')).toHaveLength(0);
    // 守卫：hub 本地写完成（sequencer 未阻塞）
    expect(run.rootValue('hub', a, 'n')).toBe(9);

    // 恢复：降至低水位以下 → 注入 Timer 检查 → fan-out 出、peer 收敛
    run.setHubPressure(LOW_WATER / 2);
    for (let i = 0; i < 30 && run.frames('hubToPeer').filter((f) => f.message.kind === 'UPDATE').length === 0; i += 1) {
      await run.hubNode.scheduler.advanceBy(1_000);
      await settle();
    }
    await settleUntil(
      () => run.rootValue('peer', a, 'n') === 9,
      '恢复后 peer 收敛 n=9（当前 ' + String(run.rootValue('peer', a, 'n')) + '）',
    );
  });
});
