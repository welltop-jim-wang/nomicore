/**
 * SA4 复审红灯锚 —— issue #171（SA3 实现 202558b + SA6 R2 fc09cbb 之后的红队复验）
 * 确定性红灯锚（零源码 grep、零 skip、零 real sleep；对象图投影沿用 review-red /
 * sa7-round2-dynamic 既有只读模式）：
 *
 *   F1   GOAWAY(SERVER_RESTARTING) drain 窗口内 removeTarget 的资源处置缺口
 *        （Scope 2/3/6 交叉 / AC2 明文违例；对 #165 基线为行为回归）：
 *        §D6 轻量层（onConnectionQuiesce）在收帧同步段投影 `disconnected` 且
 *        **零处置排队**（设计如此——处置留给 deadline 全量层）；此时宿主调用
 *        `removeTarget()` 命中的是 `case 'disconnected'`（本地收口 closed +
 *        settle，**不排队任何处置**）。deadline 到期后全量层
 *        `onConnectionFatal()` 首行 `if (this.isTerminal()) return;` —— state 已
 *        `closed`（终态）→ 直接返回，处置排队被跳过；transport close(1001) 后的
 *        `onConnectionLost()` 同样以终态早退。结果：已取得的 session 永不 close、
 *        lease 永不 release（registry 计数永不回落 → namespace 永不 idle）、
 *        watchdog idle timer 自我重武装链（fence-watchdog startIdle 递归重武装，
 *        仅 teardown() 可停）永久运转——直到连接级 `stop()` 才被兜底处置。
 *
 *        回归依据（ef19bae 基线）：旧实现 GOAWAY 收帧不动控制器（state 保持
 *        `live`）→ 同窗口 removeTarget 走 `case 'live'` 收口链（CLOSE_NAMESPACE +
 *        ensureCloseMemo → drain + closeSessionAndRelease）→ 资源照常处置。新实现
 *        因轻量层提前投影 `disconnected` 使该窗口落入无处置分支——SA1 R1/SA2 R2
 *        均未覆盖「drain 窗口内 removeTarget」交叉（SA2 R2 新攻击扫描只核对了
 *        stop() 在 deadline 前调用的路径）。
 *
 * 修复方向（SA3 执行，最小变更）：`removeTarget` 的 `case 'targeted'/'disconnected'`
 * 在 settle 后补 `void this.cleanupResources().catch(() => undefined)`（与同函数
 * seq≤0 分支同款；claim 于同步段捕获，'targeted' 态 claim 为空 → 幂等 no-op）。
 * 本锚在修复后应转绿（session/lease 字段清空 + watchdog teardown）。
 */
import { describe, expect, it } from 'vitest';
import type { ReplicationMessage } from '@nomicore/replication-protocol';
import { boot } from './driver.js';
import type { Run } from './driver.js';
import { settle, settleUntil } from './harness.js';

/** 只读对象图投影（peer 控制器的资源账目字段 + watchdog 武装位；不改生产 API）。 */
interface ControllerProjection {
  readonly session: unknown;
  readonly lease: unknown;
  readonly watchdogIdleArmed: boolean;
}

function controllerProjectionOf(run: Run): ControllerProjection {
  const impl = run.peer as unknown as {
    controllers: Map<
      string,
      { session: unknown; lease: unknown; watchdog: { idleArmed: boolean } }
    >;
  };
  const controller = impl.controllers.get(run.nsId);
  if (controller === undefined) throw new Error('无 peer controller');
  return {
    session: controller.session,
    lease: controller.lease,
    watchdogIdleArmed: controller.watchdog.idleArmed,
  };
}

describe('SA4 F1（issue #171 复审，AC2）：GOAWAY drain 窗口内 removeTarget 不得泄漏已取得资源', () => {
  it('F1：live → GOAWAY(RESTARTING) → 窗口内 removeTarget → deadline 到期后 session/lease 必须已处置、watchdog 不得残留', async () => {
    const run = await boot({
      backoff: { baseMs: 50, maxMs: 400, resetAfterMs: 500 },
      random: () => 0.5,
    });
    await run.waitNamespace('live');
    // ── 前置：gen1 资源在位（session/lease 已取得；watchdog idle 自订阅起武装）──
    const before = controllerProjectionOf(run);
    expect(before.session, '前置：live 期 session 已取得').toBeDefined();
    expect(before.lease, '前置：live 期 lease 已取得').toBeDefined();
    expect(before.watchdogIdleArmed, '前置：watchdog idle 已武装').toBe(true);
    // ── GOAWAY RESTARTING：收帧同步段轻量静默（§D6）——投影 disconnected、零处置排队 ──
    run.injectHub({
      kind: 'GOAWAY',
      reasonCode: 'SERVER_RESTARTING',
      drainTimeoutMs: 5_000,
    } as ReplicationMessage);
    await settle();
    expect(run.namespaceState(), '前置：轻量层已投影 disconnected（drain 窗口开启）').toBe('disconnected');
    // ── 攻击点：drain 窗口内（deadline 未到、连接仍 ready）宿主移除 target ──
    //    （生产可达：removeTarget 是宿主任意时刻可调用的公共 API）
    await run.peer.removeTarget(run.nsId);
    await settle();
    expect(run.namespaceState(), 'removeTarget 本地收口 closed（disconnected 分支）').toBe('closed');
    // ── deadline 到期 → 全量层（quiesceControllers → onConnectionFatal）+ transport close ──
    await run.peerNode.scheduler.advanceBy(5_000);
    await settle();
    await settle();
    // ── 红灯锚 1：已取得的 session/lease 必须完成处置
    //    （现实现：onConnectionFatal 以 isTerminal() 早退 → 零处置 → 字段保留 → 泄漏）──
    const after = controllerProjectionOf(run);
    expect(after.session, 'deadline 后 session 必须已收口（AC2 零泄漏）').toBeUndefined();
    expect(after.lease, 'deadline 后 lease 必须已释放（AC2 零泄漏）').toBeUndefined();
    // ── 红灯锚 2：watchdog idle timer 不得残留（自我重武装链仅 teardown 可停；
    //    现实现：终态早退 → 永久重武装 → timer 泄漏 + 每 ackTimeoutMs 空转探测）──
    expect(after.watchdogIdleArmed, 'deadline 后 watchdog 必须已 teardown').toBe(false);
    // ── 收尾：连接级 stop（现实现下此步才兜底处置——佐证泄漏横跨整个 drain 生命周期）──
    await run.peer.stop();
    await settleUntil(() => run.peer.getConnectionState() === 'stopped', 'stopped');
  });
});
