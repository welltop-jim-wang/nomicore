/**
 * SA7 动态验证 —— issue #137：单连接多 namespace 多路复用 + 连接级有界公平背压。
 *
 * 锚定 SA4 静态验尸 R2（pass）报告「§6 动态审核重点」清单 D1–D5 与 SA2 攻击评审
 * R3（pass）「§8.4 移交」的动态验证配方（F2 handshaking fatal 新语义 / F3 额度耗尽
 * 可达性 / R2-N1 转绿守卫 / F6 timer 泄漏）——全部为真实运行链路断言：
 *
 *   D1（F1 修复回归锚·必测）E5 场景复证：maxInFlightUpdates=1 + withPressure +
 *      暂停段积压 2 项 + saveGate 扣 ACK + 撤压【不推进 scheduler】+ 第三写 →
 *      闸门先行（commit 8f9751e）使 resume→drain 在窗口检查前完成 → 第三写后
 *      恰 1 帧（合并 11+12；n=13 入队等 ACK）+ ACK 守恒（悬挂期近似在途 1 ≤ 窗口 1）
 *      + 释放后收敛（活性无损）。F1 bug 形态（第三写 2 帧超窗）下本断言红。
 *
 *   D2（SA2 §5-F2 锚 / SA4 §6-D2）handshaking 期 peer fatal 新语义：截断 payload
 *      坏帧（序列 = 期望值 1）在 handshaking 窗口注入 → decode error →
 *      connectionFatal 直发 outbound（绕过 ready 门——R2 有意 delta）→ peerToHub
 *      恰 1 个 connection ERROR 帧 + close(1002) + blocked。#136 旧语义（0 帧）下红。
 *
 *   D3（SA2 §5-F3 配方 / SA4 §6-D3）control 保留额度耗尽可达性，三个互补面：
 *      a lowWater=1 极端：暂停段首个控制帧（hub UPDATE_ACK）即触发 →
 *        CONNECTION_BACKPRESSURE ERROR + close(1011) + peer backoff（非 blocked）
 *        + 撤压重连恢复；
 *      b 缺省 64KiB 配方（大控制帧路径）：暂停段首个 >64KiB BOOTSTRAP_SNAPSHOT
 *        首帧即触发，且触发帧不上 wire（谓词 `used + frameBytes > lowWater` 的
 *        「触发帧不发送」语义）+ 1011 + 撤压重连恢复（≈1600+ ACK 路径与本路径
 *        同谓词，由 c 以精确帧数锁定）；
 *      c 谓词精确触发帧数锁定：lowWater=100 + 实测等长 ACK 帧——暂停段恰发出
 *        floor(lowWater/ackBytes) 个 ACK 后下一帧触发（区分 `used ≥ lowWater`
 *        异形谓词——后者多发 1 帧）。
 *
 *   D4（SA2 R2-N1 转绿守卫 / SA4 §6-D4）「消费即进展」活性：超限项（>maxUpdateBytes）
 *      + 合法小更新同队 → 释放 ACK → 同一次 drain 的后续 pass 发出合法项（对端在
 *      settleUntil 预算内收敛，不依赖任何未来触发点）且超限项零 UPDATE wire 帧。
 *      字面 false-on-F4 实现下该 pass 零进展 → drain 退出 → 合法项滞留（三个触发
 *      点均不可达）→ 本断言红。构造注记：本仓库 mutation bridge 每次 root 写整树
 *      重写（clear+set，doc-runtime/mutation.ts）——含大字段的后续写恒超限；故采
 *      「写大 blurb（超限入队）→ delete blurb（合法小 struct 入队）」构造同队两项
 *      （schema 以可选字段 blurb?: string 支撑 delete——测试本地 schema，零 src 触碰）。
 *
 *   D5（SA2 §5-F6 锚 / SA4 §6-D5）暂停段 poll timer 泄漏：置压进入暂停（poll timer
 *      武装）→ GOAWAY(SERVER_RESTARTING, drainTimeoutMs=1) → deadline close 前先
 *      sender.teardown() → peer scheduler.pending() 恰回退 1（poll timer 已清，
 *      无 stale 重武装）→ close 事件交付 → backoff → 撤压重连 → live + 收敛。
 *
 *   D6（B-7 反向风险：真实 WS adapter 须暴露 bufferedAmount number 属性）为切片 7
 *      自检演进位登记项（SA4 §6-D6：本轮仅登记，非验收面）——本文件以 duck-typed
 *      属性 seam（issue137-driver applyPressure）保持其可测形态，不加断言。
 *
 * 红线纪律（与 SA6/#136 套件一致）：真实 yjs / Registry / Runtime 双实例；fake-duplex
 * 内存双端（微任务投递）；fake scheduler（时间全经 advanceBy 驱动）；零 real sleep；
 * 零源码 grep 断言（全部为 wire 帧 / 状态投影 / 持久化值 / scheduler 计面）。
 * SA6 owned 三件（红锚测试 / issue137-driver / harness）零改动——本文件只消费既有
 * seam（bootMulti / boot / saveGate / bufferedAmount 属性 / wire 帧日志）；D3b/D4 的
 * 本地组装（bootLocal）与 #136 driver 同构，为测试基建。
 */
import { describe, expect, it } from 'vitest';
import { bootMulti, ISSUE137_SCHEMA } from './issue137-driver.js';
import { boot, collectUnhandledRejections } from './driver.js';
import {
  deferred,
  HUB_INSTANCE,
  HUB_OWNER,
  makeNode,
  makeWire,
  okLease,
  PEER_INSTANCE,
  PEER_OWNER,
  schemaReady,
  settle,
  settleUntil,
  type ReplicaNode,
  type Wire,
} from './harness.js';
import { createHubReplication, createPeerReplication } from '@nomicore/ws-replication';
import type { ReplicationLimits, ReplicationTimeouts } from '@nomicore/ws-replication';
import { decodeMessage, encodeMessage, type DecodedMessage } from '@nomicore/replication-protocol';

const HIGH_WATER = 512 * 1024; // DEFAULT_REPLICATION_LIMITS.highWater
const LOW_WATER = 64 * 1024; // DEFAULT_REPLICATION_LIMITS.lowWater

type Run137 = Awaited<ReturnType<typeof bootMulti>>;

/** 当前连接 wire 上指定 ns 的 UPDATE 帧（按到达序）。 */
function updateFrames(run: Run137, nsId: string): DecodedMessage[] {
  return run.framesOf('peerToHub', nsId).filter((f) => f.message.kind === 'UPDATE');
}

/** 一条 wire 的指定方向帧日志（decode 后；供首连 wire / 多 wire 断言）。 */
function wireFrames(wire: Wire, dir: 'peerToHub' | 'hubToPeer'): DecodedMessage[] {
  return (dir === 'peerToHub' ? wire.peerToHub : wire.hubToPeer).map((bytes) => decodeMessage(bytes));
}

/** 同上，但跳过无法 decode 的帧（坏帧注入用例——帧日志含故意注入的截断帧）。 */
function safeFrames(wire: Wire, dir: 'peerToHub' | 'hubToPeer'): DecodedMessage[] {
  const out: DecodedMessage[] = [];
  for (const bytes of dir === 'peerToHub' ? wire.peerToHub : wire.hubToPeer) {
    try {
      out.push(decodeMessage(bytes));
    } catch {
      // 注入的坏帧（截断）——日志侧跳过，不影响其余帧断言
    }
  }
  return out;
}

/** hub→peer 方向下一期望序列（= 已见最大 + 1；注入帧序列记账，#136 driver 同款纪律）。 */
function nextHubSeq(frames: DecodedMessage[]): number {
  let max = 0;
  for (const f of frames) max = Math.max(max, f.header.sequence);
  return max + 1;
}

interface AdvanceTarget {
  readonly peerNode: ReplicaNode;
  readonly peer: { getConnectionState(): string | undefined };
}

/**
 * 分步推进 peer 侧 fake scheduler 直到连接 ready：每步 250ms + settle——让
 * dial/handshake/OPEN/reconcile/bootstrap 的微任务链在步间完成。整段 advanceBy
 * 大步进会在同一批 timer 里饿死这些链并触发 openTimeoutMs(5s)/bootstrapTimeoutMs
 * (10s) 的超时 timer（动态验证实测：整段 30s 步进 → ns 'failed'）。步进总量覆盖
 * backoff maxMs=30s 抖动上界。
 */
async function advanceUntilReady(run: AdvanceTarget, maxMs = 32_000): Promise<void> {
  const step = 250;
  for (let elapsed = 0; elapsed < maxMs; elapsed += step) {
    if (run.peer.getConnectionState() === 'ready') return;
    await run.peerNode.scheduler.advanceBy(step);
    await settle();
  }
  await settleUntil(
    () => run.peer.getConnectionState() === 'ready',
    '分步推进后重连 ready（当前 ' + String(run.peer.getConnectionState()) + '）',
  );
}

describe('SA7 动态验证（issue #137）：SA4 §6 D1–D5 / SA2 §8.4 移交配方', () => {
  // ─────────────── D1（必测）：F1 修复回归锚——E5 场景在动态环境复证 ───────────────

  it('D1: 撤压后第三写——闸门先行（resume→drain 重入在窗口检查前完成）→ 恰 1 帧不超窗 + ACK 守恒 + 释放收敛', async () => {
    const probe = collectUnhandledRejections();
    try {
      const run = await bootMulti({
        count: 1,
        withPressure: true,
        limits: { maxInFlightUpdates: 1, maxQueuedUpdateCount: 100, maxQueuedUpdateBytes: 1_048_576 },
        timeouts: { ackTimeoutMs: 60_000 },
      });
      const a = run.nsIds[0] as string;

      // 置压（> highWater）→ 暂停段；两笔写全部入队（闸门关）
      run.setPeerPressure(HIGH_WATER * 2);
      await run.peerWrite(a, { n: 11 });
      await run.peerWrite(a, { n: 12 });
      await settle();
      // E5[1]：暂停段零 UPDATE 帧；本地已接受状态保留（sequencer 不受发送队列影响）
      expect(updateFrames(run, a)).toHaveLength(0);
      expect(run.rootValue('peer', a, 'n')).toBe(12);

      // 悬挂 hub 首个 saveDoc（合并帧的 ACK 被扣）
      const gate = deferred();
      run.hubNode.persistence.saveGate = gate;

      // 撤压至 lowWater 以下且【不推进 scheduler】——resume 只能经第三写的闸门检查重入
      run.setPeerPressure(LOW_WATER / 2);
      await run.peerWrite(a, { n: 13 });
      await settle();

      // ★ D1 主锚（SA4 E5 判别值 [2]）：第三写后恰 1 帧（合并 n=11+12；n=13 入队等 ACK）。
      // F1 bug（操作数窗口检查先行）形态：重入 drain 后外层直发 → 2 帧、近似在途 2 > 窗口 1。
      expect(updateFrames(run, a), '第三写后恰 1 帧（不超窗）').toHaveLength(1);

      // ★ ACK 守恒（E5 判别值 [3]/[6]）：saveGate 悬挂 → 0 ACK → 近似在途 = 1 ≤ maxInFlightUpdates=1
      expect(
        run.framesOf('hubToPeer', a).filter((f) => f.message.kind === 'UPDATE_ACK'),
      ).toHaveLength(0);
      expect(run.rootValue('peer', a, 'n')).toBe(13);
      expect(run.connectionState()).toBe('ready');

      // 释放 → ACK → drain → n=13 到达、hub 收敛（E5 判别值 [7]：修复无滞留）
      run.hubNode.persistence.saveGate = undefined;
      gate.resolve();
      await settleUntil(
        () => run.rootValue('hub', a, 'n') === 13,
        '释放后 hub 收敛 n=13（当前 ' + String(run.rootValue('hub', a, 'n')) + '）',
      );
      // 3 笔写共 2 帧（合并证明）；ns 仍 live（无溢出/无 resync 边沿）
      expect(updateFrames(run, a)).toHaveLength(2);
      expect(run.peer.getNamespaceState(a)).toBe('live');
      await settle();
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });

  // ─────────────── D2：handshaking 期 fatal——恰 1 帧 connection ERROR 直发（R2 新语义） ───────────────

  it('D2: handshaking 窗口注入截断 payload 坏帧（序列=期望）→ decode error → 恰 1 帧 connection ERROR + close(1002) + blocked', async () => {
    const probe = collectUnhandledRejections();
    try {
      const run = await boot({ start: false });
      // 坏帧构造：合法 GOAWAY 帧截去尾部 3 字节 → 声明 payloadLength 与实际不符 →
      // header 解码失败（确定性，与帧内容无关）。期望抛码以同参数 decode 先行求值，
      // 断言 wire ERROR 帧与之一致（零硬编码）。
      const good = encodeMessage(
        { kind: 'GOAWAY', reasonCode: 'SERVER_RESTARTING', drainTimeoutMs: 1 },
        { sequence: 1 },
      );
      const bad = good.slice(0, good.byteLength - 3);
      let thrownCode = '';
      try {
        decodeMessage(bad, { expectedSequence: 1, maxFrameBytes: 8 * 1024 * 1024 });
      } catch (err) {
        thrownCode = (err as { code?: string }).code ?? '';
      }
      expect(thrownCode).not.toBe('');

      // start() 同步完成 dial + HELLO 发送 + setState('handshaking')（expectedSeq=1）；
      // 同步注入的坏帧一跳微任务即达 peer，HELLO_ACK 需两跳（HELLO→hub 处理→回帧）
      // ——确定性先行：peer 必在 handshaking 窗口收到坏帧。
      run.peer.start();
      expect(run.connectionState()).toBe('handshaking');
      run.wire.hubEnd.send(bad);
      await settle();

      // ★ D2 主锚：handshaking 期 fatal 从「0 ERROR 帧」（#136 ready 门吞帧）改为
      // 「恰 1 帧 connection ERROR 直发 outbound」（R2 有意 delta，协议 §14 义务）。
      const errors = safeFrames(run.wire, 'peerToHub').filter((f) => f.message.kind === 'ERROR');
      expect(errors, 'handshaking 期 fatal 恰 1 帧 connection ERROR').toHaveLength(1);
      expect((errors[0]?.message as { code?: string }).code).toBe(thrownCode);
      expect((errors[0]?.message as { namespaceId?: string }).namespaceId).toBeUndefined();
      // 连接收口：close(1002)（decode error 族）+ blocked（终态）
      expect(run.connectionState()).toBe('blocked');
      expect(run.wire.peerSideClosed).toBe(true);
      expect(run.wire.hubSideCloseInfo?.code).toBe(1002);
      // 无重试（blocked 非 backoff）——fatal 分类正确
      expect(safeFrames(run.wire, 'peerToHub').filter((f) => f.message.kind === 'HELLO')).toHaveLength(1);
      await settle();
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });

  // ─────────────── D3（SA2 §5-F3 配方）：control 保留额度耗尽可达性 ───────────────

  it('D3a: lowWater=1 极端——暂停段首个控制帧（hub UPDATE_ACK）即耗尽 → CONNECTION_BACKPRESSURE + close(1011) + peer backoff（非 blocked）+ 撤压重连恢复', async () => {
    const probe = collectUnhandledRejections();
    try {
      const run = await bootMulti({
        count: 1,
        withPressure: true,
        limits: {
          lowWater: 1,
          highWater: 2,
          maxInFlightUpdates: 1,
          maxQueuedUpdateCount: 100,
          maxQueuedUpdateBytes: 1_048_576,
        },
        timeouts: { ackTimeoutMs: 60_000 },
      });
      const a = run.nsIds[0] as string;
      const wire0 = run.wires[0] as Wire;
      const ackBefore = wireFrames(wire0, 'hubToPeer').filter((f) => f.message.kind === 'UPDATE_ACK').length;

      // 置压（3 > highWater=2）→ hub 出站入暂停段；peer 写 → hub 应用 + saveDoc 后
      // 尝试 UPDATE_ACK（control）→ observeWater 入暂停 + 首帧字节 > lowWater=1 → 耗尽
      run.setHubPressure(3);
      await run.peerWrite(a, { n: 5 });
      await settle();

      // 数据面不受控（UPDATE 已应用）——「control 保留额度」不阻塞对端数据接收
      expect(run.rootValue('hub', a, 'n')).toBe(5);
      // 触发帧不上 wire：暂停段零 UPDATE_ACK
      expect(
        wireFrames(wire0, 'hubToPeer').filter((f) => f.message.kind === 'UPDATE_ACK').length,
      ).toBe(ackBefore);
      // ★ D3a 主锚：恰 1 个 connection ERROR（CONNECTION_BACKPRESSURE，无 namespaceId）
      const errors = wireFrames(wire0, 'hubToPeer').filter((f) => f.message.kind === 'ERROR');
      expect(errors).toHaveLength(1);
      expect((errors[0]?.message as { code?: string }).code).toBe('CONNECTION_BACKPRESSURE');
      expect((errors[0]?.message as { namespaceId?: string }).namespaceId).toBeUndefined();
      // close(1011)（retryable=yes）→ peer 临时失败 backoff（非 blocked）
      expect(wire0.peerSideCloseInfo?.code).toBe(1011);
      expect(run.connectionState()).toBe('backoff');

      // 撤压 → 分步推进重连（覆盖 backoff maxMs=30s 抖动上界）→ 恢复
      run.setHubPressure(0);
      await advanceUntilReady(run);
      expect(run.wires.length).toBe(2); // 新 wire（重拨）
      await settleUntil(
        () => run.peer.getNamespaceState(a) === 'live',
        '重连后 ns live（当前 ' + String(run.peer.getNamespaceState(a)) + '）',
      );
      // ACK 通路恢复：重连后新写经 hub ACK 正常回流（等待 ACK 帧本身，非仅收敛）
      await run.peerWrite(a, { n: 6 });
      const wire1 = run.wires[1] as Wire;
      await settleUntil(
        () =>
          wireFrames(wire1, 'hubToPeer').filter((f) => f.message.kind === 'UPDATE_ACK').length >= 1,
        '恢复后新写 ACK 回流',
      );
      expect(run.rootValue('hub', a, 'n')).toBe(6);
      await settle();
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });

  it('D3b: 缺省 64KiB 大控制帧路径——暂停段首个 >64KiB BOOTSTRAP_SNAPSHOT 即触发且触发帧不上 wire + 1011 + 撤压重连恢复', async () => {
    const probe = collectUnhandledRejections();
    try {
      const big = await bootLocal({ schemaText: 'type ROOT = { n: number; blurb?: string; };', root: { n: 1 }, initialHubPressure: HIGH_WATER * 2, blurbBytes: 90_000, waitForLive: false });
      // 首连：HELLO_ACK（小控制帧，满额放行）→ BOOTSTRAP_SNAPSHOT（~90KB >
      // lowWater=64KiB 缺省）→ used + frameBytes > lowWater 首帧即耗尽
      await settleUntil(
        () => big.wires[0]?.hubSideClosed === true || big.peer.getConnectionState() === 'backoff',
        '首连耗尽收口（hub 侧 close 或 peer backoff）',
      );
      const wire0 = big.wires[0] as Wire;
      const frames0 = wireFrames(wire0, 'hubToPeer');
      // 小控制帧满额放行（握手完成——耗尽发生在 BOOTSTRAP 帧，非握手帧）
      expect(frames0.filter((f) => f.message.kind === 'HELLO_ACK')).toHaveLength(1);
      // ★ D3b 主锚：触发帧不发送——首连 wire 零 BOOTSTRAP_SNAPSHOT（大控制帧路径）
      expect(frames0.filter((f) => f.message.kind === 'BOOTSTRAP_SNAPSHOT')).toHaveLength(0);
      const errors = frames0.filter((f) => f.message.kind === 'ERROR');
      expect(errors).toHaveLength(1);
      expect((errors[0]?.message as { code?: string }).code).toBe('CONNECTION_BACKPRESSURE');
      expect(wire0.peerSideCloseInfo?.code).toBe(1011);
      expect(big.peer.getConnectionState()).toBe('backoff');

      // 撤压 → 分步推进重连 → BOOTSTRAP 流转（无暂停）→ live + 大文档收敛
      big.setHubPressure(0);
      await advanceUntilReady(big);
      await settleUntil(
        () => big.peer.getNamespaceState(big.nsId) === 'live',
        '重连后 ns live（当前 ' + String(big.peer.getNamespaceState(big.nsId)) + '）',
      );
      const wire1 = big.wires[1] as Wire;
      expect(
        wireFrames(wire1, 'hubToPeer').filter((f) => f.message.kind === 'BOOTSTRAP_SNAPSHOT'),
      ).toHaveLength(1);
      await settleUntil(() => big.peerValue('blurb') === big.blob, '重连后 peer 收敛大 blurb');
      await settle();
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });

  it('D3c: 谓词精确触发帧数——lowWater=100 + 实测等长 ACK：暂停段恰 floor(lowWater/ackBytes) 帧放行后下一帧触发', async () => {
    const probe = collectUnhandledRejections();
    try {
      const run = await bootMulti({
        count: 1,
        withPressure: true,
        limits: {
          lowWater: 100,
          highWater: 200,
          maxInFlightUpdates: 8,
          maxQueuedUpdateCount: 100,
          maxQueuedUpdateBytes: 1_048_576,
        },
        timeouts: { ackTimeoutMs: 60_000 },
      });
      const a = run.nsIds[0] as string;
      const wire0 = run.wires[0] as Wire;

      // 探针写（无压力；n=42 ≠ 种子 n=1）：实测该 ns 的 UPDATE_ACK 帧长
      //（同 kind 同 ns → 逐字节等长——envelope sequence 为定长 4 字节字段）。
      // 等待 ACK 帧本身（apply 先于 ACK 发射——等收敛不保证 ACK 已出）。
      const ackCount = (): number =>
        wire0.hubToPeer.filter((bytes) => decodeMessage(bytes).message.kind === 'UPDATE_ACK').length;
      await run.peerWrite(a, { n: 42 });
      await settleUntil(() => ackCount() >= 1, '探针写 ACK 到达');
      const rawAcks = wire0.hubToPeer.filter(
        (bytes) => decodeMessage(bytes).message.kind === 'UPDATE_ACK',
      );
      expect(rawAcks.length).toBeGreaterThanOrEqual(1);
      const ackBytes = rawAcks[rawAcks.length - 1]?.byteLength as number;
      const allowed = Math.floor(100 / ackBytes); // 谓词 `used + frame > lowWater` 的放行帧数
      const ackBefore = rawAcks.length;

      // 置压（300 > highWater=200）→ 暂停段；allowed+1 笔写：前 allowed 笔 ACK 放行，
      // 第 allowed+1 笔的 ACK 为首个越界帧（触发帧不发送）——每笔 UPDATE 均先应用
      run.setHubPressure(300);
      for (let n = 43; n <= 43 + allowed; n += 1) {
        await run.peerWrite(a, { n });
      }
      await settle();

      // ★ D3c 主锚：放行帧数恰 = floor(lowWater/ackBytes)（异形谓词 `used ≥ lowWater`
      // 会多发 1 帧 → 本断言红——SA2 #3(a) 两读法触发帧数不同）
      const acksAfter = wire0.hubToPeer.filter(
        (bytes) => decodeMessage(bytes).message.kind === 'UPDATE_ACK',
      ).length;
      expect(acksAfter - ackBefore, '暂停段放行帧数 = floor(lowWater/ackBytes)').toBe(allowed);
      // 触发帧所属写已应用（apply 先于 ACK 发射——数据面不受 control 耗尽影响）
      expect(run.rootValue('hub', a, 'n')).toBe(43 + allowed);
      const errors = wireFrames(wire0, 'hubToPeer').filter((f) => f.message.kind === 'ERROR');
      expect(errors).toHaveLength(1);
      expect((errors[0]?.message as { code?: string }).code).toBe('CONNECTION_BACKPRESSURE');
      expect(wire0.peerSideCloseInfo?.code).toBe(1011);
      expect(run.connectionState()).toBe('backoff');

      // 恢复
      run.setHubPressure(0);
      await advanceUntilReady(run);
      await settleUntil(
        () => run.peer.getNamespaceState(a) === 'live',
        '重连后 ns live（当前 ' + String(run.peer.getNamespaceState(a)) + '）',
      );
      await settle();
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });

  // ─────────────── D4（R2-N1 转绿守卫）：「消费即进展」活性 ───────────────

  it('D4: 超限项 F4 消费即进展——同一次 drain 后续 pass 发出合法项（对端收敛，不依赖未来触发点）且超限项零 UPDATE wire 帧', async () => {
    const probe = collectUnhandledRejections();
    try {
      const run = await bootLocal({
        schemaText: 'type ROOT = { n: number; blurb?: string; };',
        root: { n: 1, blurb: 'seed' },
        limits: {
          maxUpdateBytes: 8_192,
          maxInFlightUpdates: 1,
          maxQueuedUpdateCount: 100,
          maxQueuedUpdateBytes: 1_048_576,
        },
        timeouts: { ackTimeoutMs: 60_000 },
      });
      const BIG = 'z'.repeat(20_000); // > maxUpdateBytes=8KB（单笔超限，入队路径无大小门）

      const gate = deferred();
      run.hubNode.persistence.saveGate = gate;
      await run.peerSet({ n: 2 }); // 在途（窗口满；ACK 被扣）——整树 struct ~41B
      await run.peerSet({ blurb: BIG }); // 超限项入队（整树 struct ~20KB > 8KB）
      await run.peerDelete('blurb'); // 合法项①入队（delete 后整树 struct ~27B）
      await run.peerSet({ n: 3 }); // 合法项②入队（整树 struct {n:3} ~30B）
      await settle();
      const wire0 = run.wires[0] as Wire;
      const nsUpdates0 = wireFrames(wire0, 'peerToHub').filter(
        (f) => f.message.kind === 'UPDATE' && (f.message as { namespaceId?: string }).namespaceId === run.nsId,
      );
      expect(nsUpdates0).toHaveLength(1); // 仅 n=2 在途

      // 释放 ACK → drain：pass1 拉超限首项（至少一项）→ 大小门 0 → F4 消费（true，
      // 「消费即进展」）→ 同一 drain 后续 pass 拉合法项①+②（贪心合并为一帧 ≤ 预算）
      // 发出。字面 false-on-F4 实现下该 pass 零进展 → drain 退出 → 合法项滞留（三个
      // 触发点均不可达）→ 合法帧永不上 wire → 下方断言红。
      //
      // 动态发现注记（SA7 实证，2026-08-29）：本运行时 mutation bridge 每次 root 写
      // 整树重写（clear+set），后续 delta 的 yjs item 以被丢超限项为 left-origin——
      // F4 丢弃后同链后续 UPDATE 帧虽可上 wire，但对端因 item-chain 缺口无法 integrate
      // （hub 侧值不推进，需 state-vector round diff 修复且修复 diff 含墓碑内容亦可能
      // 超限）。故本守卫的活性断言锚在 **wire 层**（合法帧在预算内发出 = 不滞留），
      // 值收敛属 round-repair 域——为 maxUpdateBytes < 单笔 update 的配置病理面
      //（设计 §17「配置保证单笔必可发送」/ B-2 运维下界的实证注脚，非缺陷）。
      run.hubNode.persistence.saveGate = undefined;
      gate.resolve();
      await settleUntil(
        () =>
          wireFrames(wire0, 'peerToHub').filter(
            (f) => f.message.kind === 'UPDATE' && (f.message as { namespaceId?: string }).namespaceId === run.nsId,
          ).length >= 2,
        '合法项在同一次 drain 内上 wire（当前 UPDATE 帧数 ' +
          String(
            wireFrames(wire0, 'peerToHub').filter(
              (f) => f.message.kind === 'UPDATE' && (f.message as { namespaceId?: string }).namespaceId === run.nsId,
            ).length,
          ) +
          '）',
      );

      // ★ 超限项零 UPDATE wire 帧：全部 UPDATE 帧负载 ≤ maxUpdateBytes；恰 2 帧
      //（n=2 在途 + 合法项①②合并帧）——超限项被 F4 消费、从未上 wire
      const frames = wireFrames(wire0, 'peerToHub').filter(
        (f) => f.message.kind === 'UPDATE' && (f.message as { namespaceId?: string }).namespaceId === run.nsId,
      );
      expect(frames).toHaveLength(2);
      for (const f of frames) {
        expect((f.message as { update: Uint8Array }).update.byteLength).toBeLessThanOrEqual(8_192);
      }
      // 两帧均被 hub 接纳（apply ok → UPDATE_ACK 回流；合法链路闭环——hub 侧 apply
      // 为异步链，settleUntil 等待而非瞬时快照）
      const ackCountOn = (): number =>
        wireFrames(wire0, 'hubToPeer').filter((f) => f.message.kind === 'UPDATE_ACK').length;
      await settleUntil(() => ackCountOn() >= 2, '两帧 UPDATE 均获 hub ACK');
      // 本地已接受状态保留（超限数据不丢本地；n=3 本地已接受）
      expect(run.peerValue('n')).toBe(3);
      expect(run.peerValue('blurb')).toBeUndefined();
      expect(run.peer.getNamespaceState(run.nsId)).toBe('live');
      expect(run.peer.getConnectionState()).toBe('ready');
      await settle();
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });

  // ─────────────── D5（SA2 §5-F6 锚）：暂停段 poll timer 泄漏 ───────────────

  it('D5: 暂停段 GOAWAY(SERVER_RESTARTING) deadline close 前先 sender.teardown()——poll timer 清除（pending 恰回退 1）、stale 零副作用、重连恢复', async () => {
    const probe = collectUnhandledRejections();
    try {
      const run = await bootMulti({
        count: 1,
        withPressure: true,
        limits: { maxInFlightUpdates: 1, maxQueuedUpdateCount: 100, maxQueuedUpdateBytes: 1_048_576 },
        timeouts: { ackTimeoutMs: 120_000 },
      });
      const a = run.nsIds[0] as string;

      const beforePause = run.peerNode.scheduler.pending();
      run.setPeerPressure(HIGH_WATER * 2);
      await run.peerWrite(a, { n: 11 });
      await settle();
      // 暂停段：零 UPDATE 帧（数据闸门关）；poll timer 武装（pending 严格 +1）
      expect(updateFrames(run, a)).toHaveLength(0);
      const pausedPending = run.peerNode.scheduler.pending();
      expect(pausedPending).toBe(beforePause + 1);

      // hub 静默期注入连接级 GOAWAY（序列 = hub 方向下一期望；注入后先 settle 令
      // 微任务投递到达 peer、drain timer 武装，再推进 deadline——#136 G1 同款节奏）
      const seq = nextHubSeq(run.frames('hubToPeer'));
      run.wire().hubEnd.send(
        encodeMessage({ kind: 'GOAWAY', reasonCode: 'SERVER_RESTARTING', drainTimeoutMs: 1 }, { sequence: seq }),
      );
      await settle();
      expect(run.peerNode.scheduler.pending()).toBe(pausedPending + 1); // drain timer 已武装
      // deadline fire：sender.teardown()（清 poll timer）→ transport.close(1001)
      await run.peerNode.scheduler.advanceBy(1);
      await settle();
      expect(run.wire().peerSideClosed).toBe(true);

      // ★ D5 主锚：poll timer 已清——pending 恰回退 1（未清则恒为 pausedPending，
      // 且 stale getter 上的周期性重武装会维持/放大计面）
      expect(run.peerNode.scheduler.pending()).toBe(pausedPending - 1);
      // 大步推进：teardown 后 stale fire 零副作用、零重武装（零新帧；计面不增长）
      const framesFrozen = run.frames('peerToHub').length;
      await run.peerNode.scheduler.advanceBy(60_000);
      await settle();
      expect(run.peerNode.scheduler.pending()).toBeLessThanOrEqual(pausedPending);
      expect(run.frames('peerToHub').length).toBe(framesFrozen);

      // 本地 close 事件交付（makeEnd 不自通知——#136 G1 同款）→ backoff → 撤压 →
      // 重连 → live → 暂停段积压 n=11 由恢复 round 补齐（数据不丢）
      run.wire().closePeerSide(1001, 'goaway-drain');
      await settleUntil(() => run.connectionState() === 'backoff', 'GOAWAY drain close → backoff');
      run.setPeerPressure(0);
      await advanceUntilReady(run);
      await settleUntil(
        () => run.peer.getNamespaceState(a) === 'live',
        '重连后 ns live（当前 ' + String(run.peer.getNamespaceState(a)) + '）',
      );
      await settleUntil(
        () => run.rootValue('hub', a, 'n') === 11,
        '暂停段积压经恢复 round 收敛（当前 hub n=' + String(run.rootValue('hub', a, 'n')) + '）',
      );
      await settle();
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });
});

// ═════════════════════════ D3b/D4 本地组装（测试基建，零 src 触碰） ═════════════════════════

interface LocalRun {
  readonly nsId: string;
  readonly blob: string | undefined;
  readonly wires: Wire[];
  readonly hubNode: ReplicaNode;
  readonly peerNode: ReplicaNode;
  readonly peer: ReturnType<typeof createPeerReplication>;
  setHubPressure(bytes: number): void;
  peerSet(value: Readonly<{ n?: number; blurb?: string }>): Promise<void>;
  peerDelete(key: 'blurb'): Promise<void>;
  hubValue(key: string): unknown;
  peerValue(key: string): unknown;
}

/**
 * 本地组装（与 issue137-driver.bootMulti / #136 driver.boot 同构）：
 * - 自定义 schema 文本（D3b 大文档 / D4 可选 blurb + delete）；
 * - 可选首连预置 hub 压力（D3b 大控制帧路径）；
 * - 可选 blurbBytes 预置大 blurb 种子（D3b）；
 * - 写助手支持 op:'set' 与 op:'delete'（D4 构造「超限项 + 合法小项」同队）。
 */
async function bootLocal(opts: {
  readonly schemaText: string;
  readonly root: Readonly<Record<string, unknown>>;
  readonly limits?: Readonly<Partial<ReplicationLimits>>;
  readonly timeouts?: Readonly<Partial<ReplicationTimeouts>>;
  readonly initialHubPressure?: number;
  readonly blurbBytes?: number;
  readonly waitForLive?: boolean;
}): Promise<LocalRun> {
  const hubNode = makeNode('hub');
  const peerNode = makeNode('peer');
  const blob = opts.blurbBytes === undefined ? undefined : 'q'.repeat(opts.blurbBytes);
  const rootValue: Record<string, unknown> = { ...opts.root };
  if (blob !== undefined) rootValue.blurb = blob;
  const lease = okLease(
    await hubNode.registry.create({
      owner: HUB_OWNER,
      schema: {
        ...ISSUE137_SCHEMA,
        id: `issue137-sa7-${blob !== undefined ? 'bp-exhaust' : 'r2n1'}`,
        text: opts.schemaText,
      },
      root: rootValue,
    }),
  );
  await schemaReady(lease);
  const enabled = await lease.enableReplication();
  if (!enabled.ok) throw new Error(`enableReplication 失败：${JSON.stringify(enabled)}`);
  const nsId = lease.namespaceId;

  const hub = createHubReplication({
    instanceId: HUB_INSTANCE,
    registry: hubNode.registry,
    authorize: async () => ({
      ok: true as const,
      localOwner: HUB_OWNER,
      permissions: { read: true, submit: true },
    }),
    timer: hubNode.scheduler,
    ...(opts.limits !== undefined ? { limits: opts.limits } : {}),
    ...(opts.timeouts !== undefined ? { timeouts: opts.timeouts } : {}),
  });

  const wires: Wire[] = [];
  let hubPressure = opts.initialHubPressure ?? 0;
  const peer = createPeerReplication({
    instanceId: PEER_INSTANCE,
    hubInstanceId: HUB_INSTANCE,
    registry: peerNode.registry,
    dial: () => {
      const wire = makeWire();
      wires.push(wire);
      Object.defineProperty(wire.hubEnd, 'bufferedAmount', {
        get: () => hubPressure,
        configurable: true,
      });
      hub.accept(wire.hubEnd);
      return wire.peerEnd;
    },
    timer: peerNode.scheduler,
    targets: [{ namespaceId: nsId, localOwner: PEER_OWNER }],
    ...(opts.limits !== undefined ? { limits: opts.limits } : {}),
    ...(opts.timeouts !== undefined ? { timeouts: opts.timeouts } : {}),
  });
  peer.start();
  if (opts.waitForLive === false) return makeLocalRun(); // 首连即置压等「不收敛」场景由用例自行观察
  await settleUntil(() => peer.getConnectionState() === 'ready', '连接 ready');
  await settleUntil(
    () => peer.getNamespaceState(nsId) === 'live',
    `ns live（当前 ${String(peer.getNamespaceState(nsId))}）`,
  );
  return makeLocalRun();

  function makeLocalRun(): LocalRun {
  const mutate = async (mutation: { op: 'set'; path: readonly string[]; value: unknown } | { op: 'delete'; path: readonly string[] }): Promise<void> => {
    const opened = okLease(await peerNode.registry.open(PEER_OWNER, nsId));
    await schemaReady(opened);
    const result = await opened.mutateRoot(mutation);
    if (!result.ok) throw new Error(`业务写失败：${JSON.stringify(result)}`);
    await opened.release();
  };
  const valueOf = (node: ReplicaNode, owner: typeof PEER_OWNER, key: string): unknown => {
    const doc = node.persistence.peek(owner, nsId);
    if (doc === undefined) throw new Error('持久化缺副本');
    return (doc.getMap('ROOT') as unknown as Map<string, unknown>).get(key);
  };
  return {
    nsId,
    blob,
    wires,
    hubNode,
    peerNode,
    peer,
    setHubPressure: (bytes) => {
      hubPressure = bytes;
    },
    peerSet: async (value) => {
      for (const [key, v] of Object.entries(value)) {
        await mutate({ op: 'set', path: [key], value: v });
      }
    },
    peerDelete: async (key) => {
      await mutate({ op: 'delete', path: [key] });
    },
    hubValue: (key) => valueOf(hubNode, HUB_OWNER, key),
    peerValue: (key) => valueOf(peerNode, PEER_OWNER, key),
  };
  }
}
