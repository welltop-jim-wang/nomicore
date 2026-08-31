/**
 * app-local Peer 复制插件（设计 §3.1）：
 *
 *  - `inject ['nomicoreRegistry', 'clock']`（同 hub 插件——卸载先于 registry）；
 *  - `apply` 内 `createPeerReplication`（静态 targets 由 config 解析为冻结
 *    `ReplicationTarget` 精确两字段 `{namespaceId, localOwner}`——localOwner 的
 *    唯一来源是配置 `ownerUserId`）；第三方缺省由 Cordis disposer 管理，应用组合根
 *    显式选择 `lifecycleOwner: 'manual'`，避免双重 teardown 所有权；
 *  - ReplicationTimer 与 Clock 注入纪律同 hub 插件（§3.6 / issue #164）；
 *  - **本插件不调用 `start()`**——启动序由 `app.ts` 在 registry ready 后显式
 *    调用（幂等；NDJSON `ready` 事件在 start 之后发射）。
 */
import type { Context } from '@deepseek-ai/cordis';
import { requireClock } from '@nomicore/clock';
import { requireNomicoreRegistry } from '@nomicore/namespace-registry';
import {
  createPeerReplication,
  type DuplexTransport,
  type PeerReplication,
  type ReplicationBackoff,
  type ReplicationClock,
  type ReplicationLimits,
  type ReplicationObserver,
  type ReplicationTarget,
  type ReplicationTimer,
  type ReplicationTimeouts,
} from '@nomicore/ws-replication';
import { NODE_TIMER_BRIDGE } from './hub-plugin.js';

export interface PeerReplicationPluginConfig {
  readonly instanceId: string;
  readonly hubInstanceId: string;
  readonly dial: () => DuplexTransport;
  readonly targets?: readonly ReplicationTarget[];
  readonly limits?: Readonly<Partial<ReplicationLimits>>;
  readonly timeouts?: Readonly<Partial<ReplicationTimeouts>>;
  readonly backoff?: Readonly<Partial<ReplicationBackoff>>;
  readonly observer?: ReplicationObserver;
  /** `manual` 由显式宿主停机链拥有；`cordis` 在 fiber 卸载时自动 stop。 */
  readonly lifecycleOwner?: 'manual' | 'cordis';
}

export function createPeerReplicationPlugin(config: PeerReplicationPluginConfig) {
  let replication: PeerReplication | undefined;
  return {
    inject: ['nomicoreRegistry', 'clock'],
    apply(ctx: Context): void {
      const registry = requireNomicoreRegistry(ctx);
      const clock = requireClock(ctx);
      const replicationClock: ReplicationClock = Object.freeze({ now: () => clock.now() });
      replication = createPeerReplication({
        instanceId: config.instanceId,
        hubInstanceId: config.hubInstanceId,
        registry,
        dial: config.dial,
        timer: NODE_TIMER_BRIDGE,
        ...(config.targets !== undefined ? { targets: config.targets } : {}),
        ...(config.limits !== undefined ? { limits: config.limits } : {}),
        ...(config.timeouts !== undefined ? { timeouts: config.timeouts } : {}),
        ...(config.backoff !== undefined ? { backoff: config.backoff } : {}),
        ...(config.observer !== undefined ? { observer: config.observer } : {}),
        clock: replicationClock,
      });
      if ((config.lifecycleOwner ?? 'cordis') === 'cordis') {
        ctx.effect(function* () {
          yield async () => {
            await replication?.stop();
          };
        }, 'yjs-server: peer replication');
      }
    },
    get replication(): PeerReplication | undefined {
      return replication;
    },
  };
}
