/**
 * SA6 红灯契约（revison round 2）—— issue #137 质量复审 5 项：
 * R2-1 超大 UPDATE 静默丢失 / R2-2 sequence 耗尽发重复序列 ERROR /
 * R2-3 queued limits 错计入 in-flight / R2-4 control reserve 错用 lowWater /
 * R2-5 持续对抗流量 no-starvation + bounded-memory（覆盖缺口；实现本已公平可直接绿）。
 *
 * 契约基准：docs/protocols/instance-replication-v1.md ——
 *   §10.1 L259/261（单帧 UPDATE ≤ maxUpdateBytes；合并产物仍受其约束）
 *   §17 L488（未发送队列任一上限超出 → 丢弃未发送增量 + needs-resync）
 *   §13.2 L371（UPDATE_TOO_LARGE 既有收口码，终态 failed）
 *   §1 不变量 2 L22 + §3 L54（sequence 从 1 严格递增；gap/repeat = 关闭）
 *   §14 L391（framing 不可信 → 直接 close，不发 connection ERROR）
 *   §17 L479–486（queued count/bytes 与 maxInFlightUpdates 分列的不同限制）
 *   §10.2 L279（窗口满只暂停发送，不触发溢出/resync）
 *   §17 L490（Control frame 有独立保留额度，耗尽 = CONNECTION_BACKPRESSURE）
 *   §17 L492（low-water 仅用于恢复 dequeue，与 control 额度无关）
 *
 * 红线纪律（与既有套件一致）：真实 yjs / Registry / Runtime；fake-duplex 内存双端；
 * fake scheduler（零 real sleep）；零源码 grep 断言；全部锚在 wire 帧 / 状态投影 /
 * 持久化值。R2-2 的 sequence 耗尽路径实践不可达（2^32 帧），私态 `lastSeq` 注入是
 * 唯一可达 seam——断言全部落在运行时行为（帧序列严格递增 / 零 ERROR / close code）。
 *
 * 新契约字段（SA6 冻结名，types.ts 冻结面增补随设计修订；本轮测试以合法 Partial
 * 传值——resolveLimits 逐字段整值替换，额外字段随 spread 到达运行时）：
 *   `maxQueuedControlBytes` —— socket 内未冲刷 control 帧的独立保留额度（字节）。
 *
 * 预期：R2-1（队列路径 + 直发路径）/ R2-2（peer+hub）/ R2-3（count+bytes）/
 * R2-4（独立性+生效）全部红灯（当前实现失败）；R2-5 若 RR 调度本已公平可直绿（落盘即
 * 修复缺口）。既有 14 文件 / 94 测试零回归。
 * R2 修订：R2-4（生效）末段守卫按设计 §5.6 钉死形态改为区间守卫（`hub n ≥ allowed+1`
 * ∧ `≤ allowed+1+maxInFlightUpdates` ∧ `peer n === K`——原 `toBe(K)` 被自身前置断言
 * 结构性否决：57B ACK ⇒ allowed=26 ⇒ 第 27 个 ACK 触发 connectionFatal，hub n ∈ [27,35]）。
 */
import { describe, expect, it } from 'vitest';
import { bootMulti } from './issue137-driver.js';
import { collectUnhandledRejections } from './driver.js';
import { deferred, settle, settleUntil, type Deferred, type Wire } from './harness.js';
import { decodeMessage, type DecodedMessage } from '@nomicore/replication-protocol';
import type { ReplicationLimits } from '@nomicore/ws-replication';

// ═══════════════════════════ 本地观测辅助（零 src 触碰） ═══════════════════════════

/** wire 一个方向全部帧（到达序解码）。 */
function framesOfWire(wire: Wire, dir: 'peerToHub' | 'hubToPeer'): DecodedMessage[] {
  return (wire[dir] as Uint8Array[]).map((bytes) => decodeMessage(bytes));
}

/** 指定 namespace 的 UPDATE 帧（按到达序）。 */
function updatesOf(decoded: DecodedMessage[], nsId: string): DecodedMessage[] {
  return decoded.filter(
    (f) => f.message.kind === 'UPDATE' && f.message.namespaceId === nsId,
  );
}

/** 指定 namespace 的 RESYNC_REQUIRED 帧。 */
function resyncsOf(decoded: DecodedMessage[], nsId: string): DecodedMessage[] {
  return decoded.filter(
    (f) => f.message.kind === 'RESYNC_REQUIRED' && f.message.namespaceId === nsId,
  );
}

/** 有界预算轮询（零 real sleep；返回是否在预算内满足，不抛错）。 */
async function tryUntil(predicate: () => boolean, budget = 5_000): Promise<boolean> {
  for (let index = 0; index < budget; index += 1) {
    if (predicate()) return true;
    await Promise.resolve();
  }
  return false;
}

/** 单方向「发送时刻全记录」（含被故障注入丢弃的帧）——sequence 分析用。 */
function sentDecoded(wire: Wire, dir: 'peer-to-hub' | 'hub-to-peer'): DecodedMessage[] {
  return wire.timeline
    .filter((entry) => entry.direction === dir)
    .map((entry) => decodeMessage(entry.bytes));
}

/** UPDATE_ACK 帧实测字节长（同 kind 同 ns 逐字节等长——envelope sequence 定长 4B）。 */
function ackByteLength(wire: Wire): number {
  const rawAcks = wire.hubToPeer.filter((b) => decodeMessage(b).message.kind === 'UPDATE_ACK');
  const last = rawAcks[rawAcks.length - 1];
  if (last === undefined) throw new Error('wire 上无 UPDATE_ACK 可测量');
  return last.byteLength;
}

describe('issue #137 R2：质量复审 5 项红灯契约', () => {
  // ─────────────────────────── R2-1：超大 UPDATE 静默丢失 ───────────────────────────

  it('R2-1 (直发): live + 窗口有空位 + 队列空 + 单笔超限直发——发送失败必须响亮收口（RESYNC_REQUIRED ≥ 1）并经恢复 round 收敛，不得静默丢弃', async () => {
    const probe = collectUnhandledRejections();
    try {
      const run = await bootMulti({
        count: 1,
        limits: {
          maxUpdateBytes: 8_192,
          maxInFlightUpdates: 8, // 窗口有空位 → 走 deliver live 直发路径（非队列路径）
          maxQueuedUpdateCount: 100,
          maxQueuedUpdateBytes: 1_048_576,
        },
        timeouts: { ackTimeoutMs: 60_000 },
      });
      const a = run.nsIds[0] as string;
      const BIG = 'z'.repeat(20_000); // 整树 struct ≈ 20KB > maxUpdateBytes 8KB（单笔超限直发）

      // 直发路径：闸门开 ∧ 窗口空位（0/8）→ sendAndRegister → sendUpdateFrame 返回 0。
      // 当前实现：项已被消费、不置 needsResync、不声明 RESYNC_REQUIRED —— 静默丢失。
      await run.peerWrite(a, { blurb: BIG });
      await settle();

      // ★ 红灯锚（SA2 红线思路 #4 钉死形态，修订版——R2/设计勘误 §5.6 同类先例）：
      // 直发失败必须走 §17 L488 溢出纪律——wire 级 RESYNC_REQUIRED ≥ 1（当前实现 RESYNC=0 → 红）。
      // 状态快照断言（needs-resync）已删除：declareLocalResync 立即触发恢复 round 且在本
      // settle 预算内完成，断言时刻恒为 'live'——瞬时态快照与修复语义结构性矛盾（非软化：
      // 核心红灯信号 RESYNC_REQUIRED 与收敛性保留并加强，见下 ② 分支）。
      expect(resyncsOf(run.frames('peerToHub'), a).length).toBeGreaterThanOrEqual(1);
      // ① 守卫：本地已接受（不回滚）+ 收口在 ns 域（连接健康，不杀连接）
      expect(run.rootValue('peer', a, 'blurb')).toBe(BIG);
      expect(run.connectionState()).toBe('ready');
      // ② 更强收敛分支（与 R2-1 队列路径用例「显式收口 或 hub 收敛」二选一契约对齐）：
      // 恢复 round（state-vector diff）确定性收敛到 hub——静默丢失下恒不收敛 → 红
      await settleUntil(
        () => run.rootValue('hub', a, 'blurb') === BIG,
        '恢复 round 后 hub 收敛 blurb=BIG（当前 ' + String(run.rootValue('hub', a, 'blurb')) + '）',
      );
      await settle();
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });

  it('R2-1: 单笔 UPDATE 编码超 maxUpdateBytes——发送返回 0 后不得静默丢失（显式收口或恢复 round 收敛）', async () => {
    const probe = collectUnhandledRejections();
    try {
      const run = await bootMulti({
        count: 1,
        limits: {
          maxUpdateBytes: 8_192,
          maxInFlightUpdates: 1,
          maxQueuedUpdateCount: 100,
          maxQueuedUpdateBytes: 1_048_576,
        },
        timeouts: { ackTimeoutMs: 60_000 },
      });
      const a = run.nsIds[0] as string;
      const BIG = 'z'.repeat(20_000); // 整树 struct ≈ 20KB > maxUpdateBytes 8KB

      // 窗口 1 满（saveDoc 门闩扣 ACK）→ 超限项进入未发送队列（队列限 1MB 放行——
      // 单笔 > maxUpdateBytes 无入队大小门）——精确复现 review 路径「queued UPDATE
      // 被取出后编码结果超过 maxUpdateBytes」
      const gate = deferred();
      run.hubNode.persistence.saveGate = gate;
      await run.peerWrite(a, { n: 2 }); // 在途（ACK 被扣）
      await run.peerWrite(a, { blurb: BIG }); // 超限项入队
      await settle();

      // 前置守卫：本地已接受、hub 未收、仅 1 帧在途、无任何收口
      expect(run.rootValue('peer', a, 'blurb')).toBe(BIG);
      expect(run.rootValue('hub', a, 'blurb')).toBe('seed');
      expect(updatesOf(run.frames('peerToHub'), a)).toHaveLength(1);
      expect(run.peer.getNamespaceState(a)).toBe('live');

      // 释放 ACK → drain 取出超限项 → 当前实现 sendUpdateFrame 返回 0、项已被消费、
      // 不置 needsResync、不声明 RESYNC_REQUIRED → 静默丢失
      run.hubNode.persistence.saveGate = undefined;
      gate.resolve();
      await settle();

      // ★ 红灯锚：不得静默丢失——显式信号（RESYNC_REQUIRED / UPDATE_TOO_LARGE 收口）
      // 或经恢复 round（state-vector diff）收敛到 hub，必须在预算内出现。
      // 当前实现：hub blurb 恒 'seed'、零 RESYNC_REQUIRED、零 UPDATE_TOO_LARGE → 红。
      const explicitSignal = (): boolean =>
        resyncsOf(run.frames('peerToHub'), a).length > 0 ||
        run.frames('peerToHub').some(
          (f) => f.message.kind === 'ERROR' && f.message.code === 'UPDATE_TOO_LARGE',
        );
      const ok = await tryUntil(
        () => explicitSignal() || run.rootValue('hub', a, 'blurb') === BIG,
        6_000,
      );
      expect(
        ok,
        `超大 UPDATE 不得静默丢失：期望显式收口（RESYNC_REQUIRED/UPDATE_TOO_LARGE）或收敛，当前 hub blurb=${String(
          run.rootValue('hub', a, 'blurb'),
        )} state=${String(run.peer.getNamespaceState(a))} RESYNC=${String(
          resyncsOf(run.frames('peerToHub'), a).length,
        )}`,
      ).toBe(true);
      // 本地已接受状态保留（何种收口路径都不回滚本地写）
      expect(run.rootValue('peer', a, 'blurb')).toBe(BIG);
      await settle();
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });

  // ─────────────────────────── R2-2：sequence 耗尽路径 ───────────────────────────

  it('R2-2 (peer): 出站 sequence 耗尽——不得再发送任何帧（含重复 0xffffffff 序列的 ERROR），直接 close(1008)', async () => {
    const probe = collectUnhandledRejections();
    try {
      const run = await bootMulti({
        count: 1,
        limits: { maxInFlightUpdates: 8, maxQueuedUpdateCount: 100, maxQueuedUpdateBytes: 1_048_576 },
        timeouts: { ackTimeoutMs: 60_000 },
      });
      const a = run.nsIds[0] as string;
      const wire0 = run.wires[0] as Wire;

      // seam：出站计数拨到 0xfffffffe——下一帧号 0xffffffff（最后一合法序列），再下一帧
      // 即耗尽（emitOne 检查 lastSeq >= 0xffffffff）。实践不可达（2^32 帧），私态注入
      // 是唯一可达触发面；断言全部锚在 wire 行为（帧序列/帧种类/close 码），非源码形状。
      (run.peer as unknown as { outbound?: { lastSeq: number } }).outbound!.lastSeq = 0xfffffffe;

      // 0xffffffff 帧的落点序列对 hub 恒为 gap（hub 期望 ≈ 探测段末）；drop 该帧保持
      // hub 侧健康、peer 状态机不被外部链路扰动——本例只观察 peer 自身出站行为。
      wire0.dropNextPeerToHub((bytes) => decodeMessage(bytes).message.kind === 'UPDATE');
      await run.peerWrite(a, { n: 5 }); // 消耗 0xffffffff（被 drop，无 ACK——ackTimeout 60s 不触发）
      await run.peerWrite(a, { n: 6 }); // 帧号分配即耗尽 → onSequenceExhausted（当前：ERROR 0xffffffff + close）
      await settle();

      // guard：收口形态两实现一致（best-effort ERROR 允许与否之外——close(1008) + blocked）
      expect(wire0.peerEnd.closed).toBe(true);
      expect(run.connectionState()).toBe('blocked');

      // ★ 主锚：本方向发送帧序列严格递增（协议不变量 2）——当前实现 ERROR 帧重复
      // 0xffffffff（已消费序列号）→ 序列回退/重复 → 红。
      const sent = sentDecoded(wire0, 'peer-to-hub');
      const seqs = sent.map((f) => f.header.sequence);
      for (let i = 1; i < seqs.length; i += 1) {
        expect(seqs[i], `发送序列必须严格递增（第 ${i} 帧，前值 ${String(seqs[i - 1])}）`).toBeGreaterThan(
          seqs[i - 1] as number,
        );
      }
      // ★ 次锚：耗尽后不得发送 connection ERROR（§14「framing 不可信 → 直接 close」）
      // ——当前实现恰 1 个 ERROR 帧 → 红。
      expect(sent.filter((f) => f.message.kind === 'ERROR')).toHaveLength(0);
      await settle();
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });

  it('R2-2 (hub): 出站 sequence 耗尽——不得再发送任何帧（含重复 0xffffffff 序列的 ERROR），直接 close(1008)', async () => {
    const probe = collectUnhandledRejections();
    try {
      const run = await bootMulti({
        count: 1,
        limits: { maxInFlightUpdates: 8, maxQueuedUpdateCount: 100, maxQueuedUpdateBytes: 1_048_576 },
        timeouts: { ackTimeoutMs: 60_000 },
      });
      const a = run.nsIds[0] as string;
      const conn = run.hub.connections[0] as unknown as { outbound: { lastSeq: number } };
      const wire0 = run.wires[0] as Wire;

      conn.outbound.lastSeq = 0xfffffffe; // 同 seam 说明（hub 侧出站队列）
      wire0.dropNextHubToPeer((bytes) => decodeMessage(bytes).message.kind === 'UPDATE');
      await run.hubWrite(a, { n: 9 }); // 消耗 0xffffffff（被 drop——peer 不受 gap 扰动）
      await run.hubWrite(a, { n: 10 }); // 耗尽 → onSequenceExhausted（当前：ERROR 0xffffffff + close 1008）
      await settle();

      // guard：连接收口（hub 侧 state → closed + transport closed）
      expect((conn as unknown as { state: string }).state).toBe('closed');
      expect(wire0.hubEnd.closed).toBe(true);

      // ★ 主锚：hubToPeer 发送帧序列严格递增（当前：ERROR 重复 0xffffffff → 红）
      const sent = sentDecoded(wire0, 'hub-to-peer');
      const seqs = sent.map((f) => f.header.sequence);
      for (let i = 1; i < seqs.length; i += 1) {
        expect(seqs[i], `发送序列必须严格递增（第 ${i} 帧，前值 ${String(seqs[i - 1])}）`).toBeGreaterThan(
          seqs[i - 1] as number,
        );
      }
      // ★ 次锚：耗尽后零 connection ERROR（§14 直接 close）
      expect(sent.filter((f) => f.message.kind === 'ERROR')).toHaveLength(0);
      await settle();
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });

  // ─────────────────────────── R2-3：queued limits 错计入 in-flight ───────────────────────────

  it('R2-3 (count): 合法满 in-flight 窗口 + 空未发送队列——下一笔 UPDATE 必须入队，不得触发 queued-count 溢出/resync', async () => {
    const probe = collectUnhandledRejections();
    try {
      const run = await bootMulti({
        count: 1,
        limits: {
          maxInFlightUpdates: 8,
          maxQueuedUpdateCount: 8, // R2-3 bug：pending = inFlight(8) + queued(0) ≥ 8 → 误溢出
          maxQueuedUpdateBytes: 1_048_576,
        },
        timeouts: { ackTimeoutMs: 60_000 },
      });
      const a = run.nsIds[0] as string;
      // 依次挂起 hub 侧 saveDoc：8 笔 UPDATE 合法在途（窗口 8），ACK 全被扣
      const gates: Deferred[] = [];
      for (let i = 0; i < 8; i += 1) gates.push(deferred());
      run.hubNode.persistence.saveGates.push(...gates);
      for (let n = 1; n <= 8; n += 1) await run.peerWrite(a, { n });
      await settle();
      expect(updatesOf(run.frames('peerToHub'), a)).toHaveLength(8); // 窗口合法满（8/8）

      // 第 9 写：窗口满 → 暂停发送（§10.2 L279）——未发送队列为 0 项，必须入队；
      // 不得因「queued count」溢出而丢弃 + 声明 resync（§17 分列限制）
      await run.peerWrite(a, { n: 9 });
      await settle();

      // ★ 红灯锚：当前实现 overflows() pending = 8 + 0 = 8 ≥ maxQueuedUpdateCount=8 →
      // 丢弃 + declareLocalResync → state needs-resync + RESYNC_REQUIRED 帧 → 红
      expect(run.peer.getNamespaceState(a)).toBe('live');
      expect(resyncsOf(run.frames('peerToHub'), a)).toHaveLength(0);
      // 本地接受与连接健康（守卫）
      expect(run.rootValue('peer', a, 'n')).toBe(9);
      expect(run.connectionState()).toBe('ready');

      // 释放 → 窗口滑动 → 第 9 笔发出 → 收敛；全程零 RESYNC
      for (const g of gates) g.resolve();
      await settleUntil(() => run.rootValue('hub', a, 'n') === 9, '释放后 hub 收敛 n=9');
      expect(run.peer.getNamespaceState(a)).toBe('live');
      expect(resyncsOf(run.frames('peerToHub'), a)).toHaveLength(0);
      await settle();
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });

  it('R2-3 (bytes): 合法满 in-flight 窗口承载的 payload bytes 不得计入 queued-byte 上界——下一笔 UPDATE 必须入队', async () => {
    const probe = collectUnhandledRejections();
    try {
      const run = await bootMulti({
        count: 1,
        limits: {
          maxInFlightUpdates: 8,
          maxQueuedUpdateBytes: 5_000, // 8 在途 × ~1.3KB ≈ 10.4KB > 5,000——R2-3 bug 把在途字节计入
          maxQueuedUpdateCount: 256,
          maxUpdateBytes: 5_000, // validate：maxQueuedUpdateBytes ≥ maxUpdateBytes；单笔 1.3KB < 5,000
        },
        timeouts: { ackTimeoutMs: 60_000 },
      });
      const a = run.nsIds[0] as string;
      const LAST = 'c'.repeat(1_200);
      const gates: Deferred[] = [];
      for (let i = 0; i < 8; i += 1) gates.push(deferred());
      run.hubNode.persistence.saveGates.push(...gates);
      for (let k = 0; k < 8; k += 1) await run.peerWrite(a, { blurb: 'b'.repeat(1_200) });
      await settle();
      expect(updatesOf(run.frames('peerToHub'), a)).toHaveLength(8); // 窗口满（每笔 ~1.3KB 在途）

      // 第 9 写（等长 ~1.3KB）：未发送队列 0 字节——必须入队（5,000 上界只针对未发送队列）
      await run.peerWrite(a, { blurb: LAST });
      await settle();

      // ★ 红灯锚：当前实现 pendingBytes = 在途 10.4KB + 1.3KB > 5,000 → 误溢出 → 红
      expect(run.peer.getNamespaceState(a)).toBe('live');
      expect(resyncsOf(run.frames('peerToHub'), a)).toHaveLength(0);
      expect(run.connectionState()).toBe('ready');

      for (const g of gates) g.resolve();
      await settleUntil(() => run.rootValue('hub', a, 'blurb') === LAST, '释放后 hub 收敛末笔 blurb');
      expect(run.peer.getNamespaceState(a)).toBe('live');
      expect(resyncsOf(run.frames('peerToHub'), a)).toHaveLength(0);
      await settle();
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });

  // ─────────────────────────── R2-4：control reserve 独立配置 ───────────────────────────

  it('R2-4 (独立性): control reserve 由独立配置驱动——lowWater=512 时暂停段 control 流量远超 512B 仍存活（不耗尽、不 1011）', async () => {
    const probe = collectUnhandledRejections();
    try {
      const run = await bootMulti({
        count: 1,
        withPressure: true,
        limits: {
          lowWater: 512,
          highWater: 2_000,
          maxInFlightUpdates: 8,
          maxQueuedUpdateCount: 100,
          maxQueuedUpdateBytes: 1_048_576,
          // 独立 control 保留额度（协议 §17：未冲刷控制字节口径；缺省 8 MiB）
          maxQueuedControlBytes: 64_000,
          // 启动约束：maxQueuedControlBytes ≥ maxBootstrapBytes + 128（恰值合法，G7d 同构）
          maxBootstrapBytes: 63_872,
        } as Partial<ReplicationLimits>,
        timeouts: { ackTimeoutMs: 60_000 },
      });
      const a = run.nsIds[0] as string;
      const wire0 = run.wires[0] as Wire;
      const K = 40; // 40 × ~75B ≈ 3,000B：≫ lowWater=512（旧 ceiling 必破），≪ 独立额度 64,000

      run.setHubPressure(3_000); // > highWater 2,000 → hub 出站入暂停段（control 不受闸门阻塞，只受保留额度）
      for (let n = 1; n <= K; n += 1) await run.peerWrite(a, { n });
      await settle();

      const ackBytes = ackByteLength(wire0);
      // 牙口元断言：测试的总 control 流量严格位于「旧 lowWater ceiling」与「独立额度」之间
      expect(ackBytes * K).toBeGreaterThan(512);
      expect(ackBytes * K).toBeLessThan(64_000);

      // ★ 红灯锚：连接保持 ready、零 CONNECTION_BACKPRESSURE、全部 K 笔 ACK 在同一
      // 连接上（当前实现以 lowWater=512 为 ceiling → 早于第 8 笔即耗尽 → 1011 → 红）
      expect(run.connectionState()).toBe('ready');
      expect(
        framesOfWire(wire0, 'hubToPeer').filter((f) => f.message.kind === 'ERROR'),
      ).toHaveLength(0);
      expect(
        framesOfWire(wire0, 'hubToPeer').filter((f) => f.message.kind === 'UPDATE_ACK'),
      ).toHaveLength(K);
      expect(run.rootValue('hub', a, 'n')).toBe(K);
      expect(run.wires.length).toBe(1); // 无重拨
      await settle();
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });

  it('R2-4 (生效): 独立 control reserve 配置驱动耗尽——reserve=1,500 时暂停段 ~3,000B control 流量必须耗尽 CONNECTION_BACKPRESSURE(1011)', async () => {
    const probe = collectUnhandledRejections();
    try {
      const run = await bootMulti({
        count: 1,
        withPressure: true,
        limits: {
          lowWater: 64_000, // 旧实现以 lowWater 为 ceiling → 3,000B 不耗尽（本用例在旧实现下红）
          highWater: 100_000,
          maxInFlightUpdates: 8,
          maxQueuedUpdateCount: 100,
          maxQueuedUpdateBytes: 1_048_576,
          maxQueuedControlBytes: 1_500, // 独立额度：穷尽于 ~20 笔 ACK
          // 启动约束：maxQueuedControlBytes ≥ maxBootstrapBytes + 128（恰值合法，G7d 同构）
          maxBootstrapBytes: 1_372,
        } as Partial<ReplicationLimits>,
        timeouts: { ackTimeoutMs: 60_000 },
      });
      const a = run.nsIds[0] as string;
      const wire0 = run.wires[0] as Wire;
      const K = 40; // ≈ 3,000B：> reserve 1,500、< 旧 lowWater 64,000

      run.setHubPressure(150_000); // > highWater 100,000 → 暂停段
      for (let n = 1; n <= K; n += 1) await run.peerWrite(a, { n });
      await settle();

      const ackBytes = ackByteLength(wire0);
      expect(ackBytes * K).toBeGreaterThan(1_500);
      expect(ackBytes * K).toBeLessThan(64_000);

      // ★ 红灯锚：额度耗尽 → 分类连接失败（§13.1 CONNECTION_BACKPRESSURE | 1011）→
      // peer 临时失败 backoff（非 blocked）。当前实现 ceiling=lowWater=64,000 →
      // 不耗尽、state ready → 红。
      expect(wire0.peerSideCloseInfo?.code).toBe(1011);
      expect(run.connectionState()).toBe('backoff');
      const errors = framesOfWire(wire0, 'hubToPeer').filter((f) => f.message.kind === 'ERROR');
      expect(errors).toHaveLength(1);
      expect(
        errors[0] !== undefined && errors[0].message.kind === 'ERROR'
          ? errors[0].message.code
          : undefined,
      ).toBe('CONNECTION_BACKPRESSURE');
      // 数据面守卫（§5.6 钉死区间形态——设计 §8 走查勘误：耗尽语义下「hub n === K」
      // 结构性不可满足：57B ACK ⇒ allowed=26 ⇒ 第 27 个 ACK 触发 connectionFatal，
      // hub 已应用 27 笔 + 在途 8 笔由 drainPendingApplies 补完 ⇒ n ∈ [27,35]，恒 ≠ 40）：
      const ackBytes2 = ackByteLength(wire0); // 实测 57B（>128 序列变 58B，本场景不达）
      const allowed = Math.floor(1_500 / ackBytes2); // = 26
      // ① 下界：触发帧所属写已应用（apply 先于 ACK ⇒ 恒 ≥ allowed+1）
      expect(run.rootValue('hub', a, 'n')).toBeGreaterThanOrEqual(allowed + 1);
      // ② 上界：连接死亡截断界——发送 ≤ ACKed(26) + 首窗(8)（一 ACK 一发的窗口算术），
      //    在途经 drainPendingApplies 补完 ⇒ 恒 ≤ allowed + 1 + maxInFlightUpdates（=35）
      expect(run.rootValue('hub', a, 'n')).toBeLessThanOrEqual(allowed + 1 + 8);
      // ③ 本地完备性：K 笔全本地接受——「不阻塞 sequencer」的可满足守卫
      expect(run.rootValue('peer', a, 'n')).toBe(K); // = 40
      await settle();
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });

  // ─────────────────────────── R2-5：持续对抗流量（覆盖缺口） ───────────────────────────

  it('R2-5: 永久 hot namespace 竞争下普通 ns 最终获得发送机会（no-starvation）；对抗生产期间未发送队列始终有界（bounded-memory）', async () => {
    const probe = collectUnhandledRejections();
    try {
      const run = await bootMulti({
        count: 2,
        limits: {
          maxInFlightUpdates: 2,
          maxQueuedUpdateCount: 16,
          maxQueuedUpdateBytes: 1_048_576,
          maxQueuedBytesPerConnection: 4_194_304,
        },
        timeouts: { ackTimeoutMs: 120_000 },
      });
      const hot = run.nsIds[0] as string;
      const norm = run.nsIds[1] as string;

      // ── 阶段 1：永久 jam hot（saveDoc 门闩扣住在途 ACK → 窗口不滑动 → 队列持续积压）
      // 同时 normal 自由流动——「hot 恒有积压」的持续对抗背景。
      // 门闩数 = 1（实测：命名空间级串行 save 链——扣住 hot 首笔 saveDoc 即阻塞 hot
      // 整个窗口的 ACK；若多放门闩会被 normal 的 saveDoc 依次消费而误扣 normal）。
      const gates: Deferred[] = [deferred()];
      run.hubNode.persistence.saveGates.push(...gates);
      for (let k = 1; k <= 12; k += 1) await run.peerWrite(hot, { n: 100 + k }); // 2 在途 + 10 滞留
      for (let k = 1; k <= 6; k += 1) await run.peerWrite(norm, { n: 200 + k });
      await settle();

      // hot：窗口（2）合法满、其余 10 笔滞留未发送——wire 上 hot UPDATE 恒 ≤ 窗口 2（有界）
      expect(updatesOf(run.frames('peerToHub'), hot)).toHaveLength(2);
      // ★ no-starvation：hot 永久积压竞争下，normal 全部 6 笔写均获发送机会并到达 hub
      expect(updatesOf(run.frames('peerToHub'), norm)).toHaveLength(6);
      expect(run.rootValue('hub', norm, 'n')).toBe(206);
      expect(run.rootValue('hub', hot, 'n')).not.toBe(112); // hot 未收敛（积压未获发送）
      expect(run.peer.getNamespaceState(hot)).toBe('live');
      expect(run.peer.getNamespaceState(norm)).toBe('live');
      expect(run.connectionState()).toBe('ready');
      expect(resyncsOf(run.frames('peerToHub'), hot)).toHaveLength(0); // 未超限、无溢出

      // ── 阶段 2：对抗生产继续（超出 queued 上界）→ 溢出收口：丢弃未发送 + needs-resync
      // + RESYNC_REQUIRED——wire 帧数仍 ≤ 窗口 + 上界（bounded-memory：队列不无界增长，
      // 后续生产被 needsResync 首行丢弃；本地 sequencer 全部接受——「不阻塞 Runtime sequencer」）
      for (let k = 1; k <= 8; k += 1) await run.peerWrite(hot, { n: 200 + k }); // 本地 200..208
      await settle();
      expect(updatesOf(run.frames('peerToHub'), hot)).toHaveLength(2); // 溢出后停发：仍 ≤ 2+16
      expect(run.peer.getNamespaceState(hot)).toBe('needs-resync'); // 溢出收口（bounded-memory 信号）
      expect(resyncsOf(run.frames('peerToHub'), hot).length).toBeGreaterThanOrEqual(1);
      expect(run.rootValue('peer', hot, 'n')).toBe(208); // 本地全部已接受（不相 20 笔）
      expect(run.rootValue('peer', norm, 'n')).toBe(206); // normal 不受影响
      expect(run.connectionState()).toBe('ready');

      // ── 阶段 3：释放门闩 → 窗口收口 → 恢复 round（state-vector diff）补齐 →
      // hot 收敛到 208；wire UPDATE 帧数保持有界（恢复走 SYNC_STEP2，非逐笔 UPDATE）
      for (const g of gates) g.resolve();
      await settleUntil(
        () => run.rootValue('hub', hot, 'n') === 208,
        '恢复 round 后 hub hot 收敛 n=208（当前 ' + String(run.rootValue('hub', hot, 'n')) + '）',
      );
      await settleUntil(() => run.peer.getNamespaceState(hot) === 'live', 'hot 恢复 live');
      expect(updatesOf(run.frames('peerToHub'), hot).length).toBeLessThanOrEqual(2 + 16);
      expect(run.rootValue('hub', norm, 'n')).toBe(206);
      await settle();
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });
});
