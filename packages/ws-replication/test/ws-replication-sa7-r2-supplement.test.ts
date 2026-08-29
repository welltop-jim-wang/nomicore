/**
 * SA7 动态验证补充测试（revision round 2）—— SA4 交 SA7 抽查点 3：
 * R2-1 直发路径 in-flight>0 变体（「窗口部分占用 + 单笔超限直发 → 收口 →
 * onUpdateAck 延迟恢复」链路）。
 *
 * 背景：SA6 r2-red 的 R2-1（直发）用例为空窗口形态（in-flight 0/8）；本变体钉死
 * 窗口部分占用形态——静态闭环（SA4 已核 peer-namespace.ts onUpdateAck →
 * (state==='needs-resync') → maybeStartRecovery，inFlight>0 早退与之配对）此前无专测。
 *
 * 契约（docs/protocols/instance-replication-v1.md）：
 *   §17 L488（溢出纪律：丢弃未发送增量 + needs-resync + RESYNC_REQUIRED）
 *   §10.2（窗口占用只暂停发送——不影响收口声明）
 *   恢复 = 延迟重触发：ACK 到达置空窗口后才允许恢复 round（needs-resync 下
 *   onUpdateAck → maybeStartRecovery）。
 *
 * 纪律（与既有套件一致）：真实 yjs / Registry / Runtime；fake-duplex 内存双端；
 * fake scheduler（零 real sleep）；零源码 grep 断言；全部锚在 wire 帧 / 状态投影 /
 * 持久化值。
 */
import { describe, expect, it } from 'vitest';
import { bootMulti } from './issue137-driver.js';
import { collectUnhandledRejections } from './driver.js';
import { deferred, settle, settleUntil, type Wire } from './harness.js';
import { decodeMessage, type DecodedMessage } from '@nomicore/replication-protocol';

function framesOfWire(wire: Wire, dir: 'peerToHub' | 'hubToPeer'): DecodedMessage[] {
  return (wire[dir] as Uint8Array[]).map((bytes) => decodeMessage(bytes));
}

function resyncsOf(decoded: DecodedMessage[], nsId: string): DecodedMessage[] {
  return decoded.filter(
    (f) => f.message.kind === 'RESYNC_REQUIRED' && f.message.namespaceId === nsId,
  );
}

describe('issue #137 R2 SA7 补充：R2-1 直发路径 in-flight>0 变体', () => {
  it('R2-1 (直发, in-flight>0): 窗口部分占用 + 队列空 + 单笔超限直发——收口响亮（RESYNC_REQUIRED ≥ 1），恢复 round 延迟到 ACK 释放后才启动并收敛 hub', async () => {
    const probe = collectUnhandledRejections();
    try {
      const run = await bootMulti({
        count: 1,
        limits: {
          maxUpdateBytes: 8_192,
          maxInFlightUpdates: 8, // 窗口部分占用后仍有空位 → 走 deliver live 直发路径
          maxQueuedUpdateCount: 100,
          maxQueuedUpdateBytes: 1_048_576,
        },
        timeouts: { ackTimeoutMs: 60_000 },
      });
      const a = run.nsIds[0] as string;

      // 窗口部分占用：saveGate 扣住首笔 hub 侧 saveDoc → ACK 悬挂 → in-flight = 1。
      const gate = deferred();
      run.hubNode.persistence.saveGate = gate;
      await run.peerWrite(a, { n: 2 }); // 在途（ACK 被扣；窗口 1/8）
      await settle();

      // 前置守卫：首笔已上 wire、未 ACK；hub 尚无 BIG。
      expect(run.framesOf('peerToHub', a).filter((f) => f.message.kind === 'UPDATE').length).toBe(1);
      expect(run.rootValue('hub', a, 'blurb')).toBe('seed');

      // 直发变体：窗口 1/8（有空位）+ 队列空 + 单笔超限 → sendAndRegister 前置判别
      // → needsResync + declareLocalResync（RESYNC_REQUIRED 上 wire）。
      const BIG = 'z'.repeat(20_000); // 整树 struct ≈ 20KB > maxUpdateBytes 8KB
      await run.peerWrite(a, { blurb: BIG });
      await settle();

      // ★ 收口锚（wire 级）：RESYNC_REQUIRED ≥ 1——静默丢失下恒 0。
      expect(resyncsOf(run.frames('peerToHub'), a).length).toBeGreaterThanOrEqual(1);
      // 守卫：本地已接受（不回滚）+ 收口在 ns 域（连接健康）。
      expect(run.rootValue('peer', a, 'blurb')).toBe(BIG);
      expect(run.connectionState()).toBe('ready');

      // ★ 延迟恢复锚（本变体的独有断言面）：窗口占用（in-flight=1 > 0）时
      // maybeStartRecovery 早退——恢复 round 不得启动：
      //   - ns 状态停留在 needs-resync（非 reconciling/live）；
      //   - hub 在门闩释放前不得收敛 BIG。
      await settle();
      expect(run.peer.getNamespaceState(a)).toBe('needs-resync');
      expect(run.rootValue('hub', a, 'blurb')).toBe('seed');

      // 释放门闩 → ACK 到达 → onUpdateAck → maybeStartRecovery（窗口已空）→ 恢复
      // round（state-vector diff）→ hub 收敛 BIG → 状态回 live。
      gate.resolve();
      await settleUntil(
        () => run.rootValue('hub', a, 'blurb') === BIG,
        'ACK 释放后恢复 round 使 hub 收敛 blurb=BIG（当前 ' + String(run.rootValue('hub', a, 'blurb')) + '）',
      );
      await settleUntil(
        () => run.peer.getNamespaceState(a) === 'live',
        '恢复 round 完成后状态回 live（当前 ' + String(run.peer.getNamespaceState(a)) + '）',
      );
      await settle();
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });
});
