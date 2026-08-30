/**
 * app-local Hub 复制插件（设计 §3.1）：
 *
 *  - `inject ['nomicoreRegistry', 'clock']` —— 依赖图下游：本 fiber 卸载**先于**
 *    registry fiber（有序停机的机制载体——registry/clock 在其依赖方 settle 后才
 *    开始自身拆卸）；
 *  - `apply` 内 `createHubReplication` + `ctx.effect` 有序 disposer（`hub.close()`
 *    GOAWAY→drain→deadline 后 WS 1001 硬收口；幂等）；
 *  - **ReplicationTimer 用 node timer 桥而非 `ctx.timeout`**（设计 §3.6：本 fiber
 *    卸载期 UNLOADING 内新武装 `ctx.timeout` 会抛 `INACTIVE_EFFECT`——drain
 *    deadline 恰在卸载期需要武装；node timer 桥有 sa7 真实链路先例，句柄由包自持
 *    `clearTimeout`）；
 *  - Clock 注入 `ReplicationClock`（issue #164「生产组合根注入并在装配期对缺省做
 *    响亮断言」纪律——`requireClock` 缺失即 loud throw，零 fallback）。
 */
import type { Context } from '@deepseek-ai/cordis';
import { requireClock } from '@nomicore/clock';
import { requireNomicoreRegistry } from '@nomicore/namespace-registry';
import {
  createHubReplication,
  type HubReplication,
  type NamespaceAuthorizer,
  type PeerTokenVerifier,
  type ReplicationClock,
  type ReplicationLimits,
  type ReplicationObserver,
  type ReplicationTimer,
  type ReplicationTimeouts,
} from '@nomicore/ws-replication';

/** 设计 §3.6 节点 timer 桥（句柄由包自持 clearTimeout；卸载期 arm 安全）。 */
export const NODE_TIMER_BRIDGE: ReplicationTimer = Object.freeze({
  setTimeout: (callback: () => void, delayMs: number): unknown => setTimeout(callback, delayMs),
  clearTimeout: (handle: unknown): void => clearTimeout(handle as NodeJS.Timeout),
});

export interface HubReplicationPluginConfig {
  readonly instanceId: string;
  readonly verifyToken: PeerTokenVerifier;
  readonly authorize: NamespaceAuthorizer;
  readonly limits?: Readonly<Partial<ReplicationLimits>>;
  readonly timeouts?: Readonly<Partial<ReplicationTimeouts>>;
  readonly observer?: ReplicationObserver;
}

export function createHubReplicationPlugin(config: HubReplicationPluginConfig) {
  let replication: HubReplication | undefined;
  return {
    inject: ['nomicoreRegistry', 'clock'],
    apply(ctx: Context): void {
      const registry = requireNomicoreRegistry(ctx);
      const clock = requireClock(ctx);
      const replicationClock: ReplicationClock = Object.freeze({ now: () => clock.now() });
      replication = createHubReplication({
        instanceId: config.instanceId,
        registry,
        authorize: config.authorize,
        timer: NODE_TIMER_BRIDGE,
        verifyToken: config.verifyToken,
        ...(config.limits !== undefined ? { limits: config.limits } : {}),
        ...(config.timeouts !== undefined ? { timeouts: config.timeouts } : {}),
        ...(config.observer !== undefined ? { observer: config.observer } : {}),
        clock: replicationClock,
      });
      ctx.effect(function* () {
        yield async () => {
          await replication?.close(); // 幂等（closeTail 单飞）
        };
      }, 'yjs-server: hub replication');
    },
    get replication(): HubReplication | undefined {
      return replication;
    },
  };
}
