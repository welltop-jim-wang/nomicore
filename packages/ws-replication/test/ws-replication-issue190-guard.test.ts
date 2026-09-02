/**
 * RT-1 守卫锚 —— issue #190 §3.4：admission 拒绝路径 close 守卫（closeAdmission
 * try/catch）是修复方案中唯一超越「原样收敛」的新增代码路径——在全部现存 fixture
 * （close 均不抛）下是死代码。本文件以 throwing-close transport 使其「在/不在」可区分：
 * 有守卫 → 拒绝效果仍生效（close 异常被吞、observer 事件仍发、重放循环零流产、
 * promise 恒 resolve undefined）；无守卫 → listener 内 transport.close throw 经
 * onMessage(...) 调用点展开 → 重放循环首帧即断（replayedCount:1）+ acceptTrusted
 * promise reject → await p 抛出 → 测试红。
 *
 * 规格冻结：wiki/raw/task_ws-replication-bound-early-frame-admission-in-accepttrusted_design.md
 * §10.1（SA2 R1 攻击点 #2 指定验证载体——ALLOW LIST [SA3/SA7 owned]；SA3 实现期按
 * 本规格创建、SA7 动态验证执行）；断言逻辑以 §10.1 为准不得偏离。
 *
 * 红线纪律：零源码 grep 断言；零 mock 被测对象（fixture 级同步重放 transport）；
 * 断言 = 可观察运行时行为（快照式 toEqual + unhandledRejection probe）。
 */
import { describe, expect, it } from 'vitest';
import { createHubReplication } from '@nomicore/ws-replication';
import type {
  DuplexTransport,
  HubReplication,
  PeerTokenVerifier,
  ReplicationObserver,
  ReplicationObserverEvent,
} from '@nomicore/ws-replication';
import { collectUnhandledRejections, makeAuthorizer, DEFAULT_PEER_VERIFIER } from './driver.js';
import { CONTRACT_LIMITS, HUB_INSTANCE, PEER_INSTANCE, makeNode } from './harness.js';

// ─────────────────────────── throwing-close 同步重放型 transport fixture ───────────────────────────

/**
 * 与 issue190-red 的 makeReplayTransport 同构（onMessage 注册即同步重放完整 backlog、
 * 重放先于 return；send 记录；onClose 注册；pump 模拟事后回调），唯一差异：
 * close() 恒 throw new Error('boom')（transport 契约外形态——拒绝路径 close 抛出）。
 * `replayedCount` 记录已重放帧数：close throw 若经 listener 展开会中断 fixture 重放
 * 循环 → 计数偏小（无守卫：1；有守卫：积压条数）。close 在记录前即 throw，本 fixture
 * 不提供 closeInfos 观测面（§10.1 快照如实省略该字段）。
 */
function makeThrowingCloseReplayTransport(backlog: readonly Uint8Array[]): {
  readonly transport: DuplexTransport;
  replayedCount(): number;
  sent(): ReadonlyArray<Uint8Array>;
  pump(bytes: Uint8Array): void;
} {
  let replayed = 0;
  const messageListeners = new Set<(bytes: Uint8Array) => void>();
  const closeListeners = new Set<(info: Readonly<{ code: number; reason: string }>) => void>();
  const sent: Uint8Array[] = [];
  const transport: DuplexTransport = {
    send(bytes) {
      sent.push(bytes.slice());
    },
    close(_code = 1000, _reason = '') {
      throw new Error('boom'); // 契约外形态：拒绝路径 close 抛出
    },
    get closed() {
      return false;
    },
    onMessage(listener) {
      messageListeners.add(listener);
      for (const bytes of backlog) {
        replayed += 1; // 先计数后投递——listener 抛异常会中断循环使计数偏小
        listener(bytes);
      }
      return () => {
        messageListeners.delete(listener);
      };
    },
    onClose(listener) {
      closeListeners.add(listener);
      return () => {
        closeListeners.delete(listener);
      };
    },
  };
  return {
    transport,
    replayedCount: () => replayed,
    sent: () => sent,
    pump: (bytes) => {
      for (const listener of [...messageListeners]) listener(bytes);
    },
  };
}

// ─────────────────────────── observer 事件收集 ───────────────────────────

/** hub observer 收集器（零 mock：真实 ReplicationObserver 回调面）。 */
class HubEventCollector {
  readonly events: ReplicationObserverEvent[] = [];
  readonly observer: ReplicationObserver = (event) => {
    this.events.push(event);
  };
  rejectedReasons(): string[] {
    return this.events
      .filter(
        (e): e is Extract<ReplicationObserverEvent, { type: 'auth-upgrade-rejected' }> =>
          e.type === 'auth-upgrade-rejected',
      )
      .map((e) => e.reason);
  }
}

/** 直接组装 Hub（trusted 路径不需要拨号/对端；observer 可注入）。 */
async function makeTrustedHub(
  opts: { readonly observer?: ReplicationObserver; readonly verifyToken?: PeerTokenVerifier } = {},
): Promise<HubReplication> {
  const node = makeNode('hub');
  return createHubReplication({
    instanceId: HUB_INSTANCE,
    registry: node.registry,
    authorize: makeAuthorizer().authorize,
    timer: node.scheduler,
    verifyToken: opts.verifyToken ?? DEFAULT_PEER_VERIFIER,
    ...(opts.observer !== undefined ? { observer: opts.observer } : {}),
  });
}

// ─────────────────────────── 测试主体 ───────────────────────────

describe('issue #190 RT-1：admission 拒绝路径 close 守卫（throwing-close transport）', () => {
  it('守卫在：close 抛出 → 事件仍发 + 重放循环零流产（3 帧全计）+ 恒 resolve undefined', async () => {
    const probe = collectUnhandledRejections();
    try {
      const replay = makeThrowingCloseReplayTransport([
        new Uint8Array(CONTRACT_LIMITS.maxFrameBytes + 1), // 第 1 帧即超界 → 单帧界拒绝
        new Uint8Array(32).fill(1), // 余帧（常规尺寸）——拒绝后必须幂等早退，不保留不重放
        new Uint8Array(32).fill(2),
      ]);
      const events = new HubEventCollector();
      const hub = await makeTrustedHub({ observer: events.observer });
      const p = (hub.acceptTrusted!(replay.transport, { peerInstanceId: PEER_INSTANCE }) as unknown) as Promise<unknown>;
      const conn = await p;
      // 快照（§10.1 冻结）：吞的是 close 异常，不是拒绝效果——事件仍发；close throw
      // 不得展开到 onMessage 调用点流产重放循环；零分配恒 undefined。
      expect({
        resolved: conn === undefined ? 'undefined' : `allocated:${String((conn as { state?: string }).state)}`,
        rejectedReasons: events.rejectedReasons(),
        connections: hub.connections.length,
        replayedCount: replay.replayedCount(),
      }).toEqual({
        resolved: 'undefined',
        rejectedReasons: ['frame-too-large'],
        connections: 0,
        replayedCount: 3,
      });
    } finally {
      probe.dispose();
    }
    expect(probe.events).toEqual([]); // 恒 resolve 不掉到 unhandledRejection
  });
});
