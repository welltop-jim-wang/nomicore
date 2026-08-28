/**
 * fence-watchdog —— 每通道 epoch-fence / session-溢出 watchdog（双节奏，双侧对称，
 * §12；R3/#3/#10，R4/N-2 作用域更正）。
 *
 * - 微任务节奏：每次通道事件触发有界自延伸微任务链（预算 4096 让步，每 8 让步探测
 *   一次）；探测谓词 = state!=='open' ∨ currentEpoch!==replicationEpoch ∨
 *   status.needsResync（peer 通道仅 needsResync 边沿生效——peer Runtime 永不 bump）；
 * - timer 节奏：每 ackTimeoutMs 经注入 timer 探测一次并重新武装微任务突发；
 * - 边沿触发（硬约束）：只在 false→true 跃迁时动作（sticky 标志永不消除——电平触发
 *   会死循环）；每通道维护 lastPredicateValue（初值 false）。
 */
import type { ReplicationSession } from '@nomicore/namespace-registry';
import type { ReplicationTimer } from './types.js';

export type WatchdogPredicate = 'fence' | 'needsResync';

export interface WatchdogHost {
  readonly role: 'hub' | 'peer';
  readonly session: () => ReplicationSession | undefined;
  readonly onPredicateEdge: (predicate: WatchdogPredicate) => void;
  readonly armTimer: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
  readonly idleProbeMs: number;
}

/** 预算量纲耦合不变量（§12/R-10）：watchdog 预算 4096 > harness settle 预算之和 3300。 */
const WATCHDOG_BUDGET = 4096;
const PROBE_EVERY = 8;

export class FenceWatchdog {
  private lastPredicateValue = false;
  private chainRunning = false;
  private remaining = 0;
  private idleHandle: unknown | undefined;
  private idleArmed = false;

  constructor(private readonly host: WatchdogHost) {}

  /** 通道事件：启动（或续期）有界微任务链。 */
  onEvent(): void {
    if (!this.chainRunning) {
      this.chainRunning = true;
      this.remaining = WATCHDOG_BUDGET;
      void this.runChain();
    } else {
      this.remaining = WATCHDOG_BUDGET; // 事件续期（有界——无事件即静默退出）
    }
  }

  /** 启动空闲探测节奏（每 ackTimeoutMs；双侧对称）。
   *  D1 修复（SA7）：到期回调内先清 `idleArmed` 再探测——否则递归 `startIdle()` 被
   *  `if (this.idleArmed) return` 守卫挡死，idle 探测一次性、节奏死亡（§16「每
   *  ackTimeoutMs 探测 + 重武装」违约；生产空闲期 fence/needsResync 检出延迟无上界）。
   *  重武装先于 probe：probe 触发的终局（one-shot 终结器 → cleanup → watchdog.teardown）
   *  恰好清除本回调新武装的下一周期 timer——零泄漏。 */
  startIdle(): void {
    if (this.idleArmed) return;
    this.idleArmed = true;
    this.idleHandle = this.host.armTimer(() => {
      this.idleHandle = undefined;
      this.idleArmed = false; // D1：清守卫——允许下一周期重武装
      this.startIdle(); // 重武装（新 timer；probe 触发的 teardown 会清除它）
      this.probe();
      this.onEvent();
    }, this.host.idleProbeMs);
  }

  /** 通道收口：停止一切探测。 */
  teardown(): void {
    if (this.idleArmed) {
      this.idleArmed = false;
      if (this.idleHandle !== undefined) {
        this.host.clearTimer(this.idleHandle);
        this.idleHandle = undefined;
      }
    }
    this.chainRunning = false;
    this.remaining = 0;
  }

  /** 供测试/静态守卫读取（预算常量暴露）。 */
  static readonly budget = WATCHDOG_BUDGET;

  private async runChain(): Promise<void> {
    try {
      for (let index = 0; index < this.remaining; index += 1) {
        if (this.remaining <= index) break;
        await Promise.resolve();
        if (index % PROBE_EVERY === PROBE_EVERY - 1) {
          this.probe();
        }
      }
    } finally {
      this.chainRunning = false;
    }
  }

  private probe(): void {
    const session = this.host.session();
    if (session === undefined) return;
    let fencePredicate = false;
    let resyncPredicate = false;
    try {
      const status = session.getStatus();
      // 围栏判据以「conflicted 终态或 epoch 漂移」为准（§11.1 同口径；显式 close 属
      // §13.4 迟到收口域——已由 cleanup 收编，不产生 wire 假码）
      fencePredicate = status.state === 'conflicted' || status.currentEpoch !== status.replicationEpoch;
      resyncPredicate = status.needsResync;
    } catch {
      return; // 读失败（防御）——静默跳过本次探测
    }
    const predicate =
      this.host.role === 'hub' ? fencePredicate || resyncPredicate : resyncPredicate;
    if (predicate && !this.lastPredicateValue) {
      this.lastPredicateValue = true;
      const kind: WatchdogPredicate =
        this.host.role === 'hub' && fencePredicate ? 'fence' : 'needsResync';
      this.host.onPredicateEdge(kind);
    } else if (!predicate) {
      this.lastPredicateValue = false;
    }
  }
}

/** 供调用方统一 import 的哨兵（类型）。 */
export type WatchdogTimer = ReplicationTimer;
