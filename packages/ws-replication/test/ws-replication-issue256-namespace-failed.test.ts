/**
 * issue #256 回归 —— namespace `failed` 终态的可诊断稳定原因（append-only 第 22 型
 * observer 事件 `namespace-failed`）。
 *
 * 覆盖 issue #256 建议回归测试清单：
 *   1. 每一种 timer timeout 产生唯一、稳定、安全的原因事件（场景 1–3：open /
 *      bootstrap / reconcile 超时三类 cause 互不相同 + timeoutMs = 配置上限 +
 *      恰一事件 + 本地零 wire ⇒ 零 namespace-error）；
 *   2. apply refusal / internal rejection / 协议错误可区分（场景 4 protocol-violation、
 *      场景 5 apply-refused、场景 6 apply-rejected——三者 cause 互不相同）；
 *   3. remote ERROR 不与本地失败重复计数（场景 7：remote-error 恰一 + namespace-error
 *      {received} 恰一 + 零本地 cause）；
 *   4. observer 每次抛错不改变 wire、状态与 cleanup（场景 8：全程 throw 的 observer
 *      下 reconcile 超时仍收口 failed 且自愈 live、零 unhandled rejection）；
 *   5. 事件对象深扫（各场景 assertFailedSafe：键集白名单/cause 闭联合/零 sentinel/
 *      零二进制零 Error/timeoutMs 有限非负）；
 *   6. stop/remove/close 竞态不在静默域产生迟到失败事件（场景 9a：live 中
 *      removeTarget + CLOSE_OK 被丢 → closeTimeout 本地收口 closed、零失败事件；
 *      场景 9b：live 中连接断开 → disconnected 而非 failed；场景 1/3 另断言
 *      failed 后断线 + stop 全程恰一事件）；
 *   7. 无 observer 零回归（场景 10：零 observer 下 reconcile 超时自愈 live、零
 *      unhandled rejection——行为逐字节等价纪律的绿灯锚）。
 *
 * 红灯纪律：真实 yjs / Registry / Runtime；fake-duplex；注入 timer；零 real sleep。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type {
  ReplicationNamespaceFailedCause,
  ReplicationObserver,
  ReplicationObserverEvent,
} from '@nomicore/ws-replication';
import { decodeMessage } from '@nomicore/replication-protocol';
import {
  advanceMs,
  boot,
  collectUnhandledRejections,
  type Run,
} from './driver.js';
import { settle, settleUntil } from './harness.js';

type FailedEvent = Extract<ReplicationObserverEvent, { type: 'namespace-failed' }>;
type NsErrorEvent = Extract<ReplicationObserverEvent, { type: 'namespace-error' }>;

const CAUSES: ReadonlySet<string> = new Set<ReplicationNamespaceFailedCause>([
  'open-timeout',
  'bootstrap-timeout',
  'reconcile-timeout',
  'open-failed',
  'session-open-failed',
  'replication-disabled',
  'session-missing',
  'protocol-violation',
  'apply-refused',
  'apply-rejected',
  'remote-error',
  'send-failed',
  'internal-error',
]);

const FAILED_KEYS = new Set(['type', 'side', 'connectionId', 'namespaceId', 'cause', 'timeoutMs']);

function makeRecorder(): {
  readonly events: ReplicationObserverEvent[];
  readonly observer: ReplicationObserver;
} {
  const events: ReplicationObserverEvent[] = [];
  return { events, observer: (e) => events.push(e) };
}

function failedOf(
  events: readonly ReplicationObserverEvent[],
  side: 'peer' | 'hub',
): FailedEvent[] {
  return events.filter(
    (e): e is FailedEvent => e.type === 'namespace-failed' && e.side === side,
  );
}

function nsErrorsOf(
  events: readonly ReplicationObserverEvent[],
  side: 'peer' | 'hub',
): NsErrorEvent[] {
  return events.filter(
    (e): e is NsErrorEvent => e.type === 'namespace-error' && e.side === side,
  );
}

/** safe-field 深扫（T9 同款纪律的本地化）：键集白名单 + cause 闭联合 + 零敏感串 +
 *  零二进制/Error + timeoutMs 有限非负。 */
function assertFailedSafe(events: readonly FailedEvent[], label: string): void {
  for (const event of events) {
    for (const key of Object.keys(event)) {
      expect(FAILED_KEYS.has(key), `${label}: namespace-failed 意外键 ${key}`).toBe(true);
    }
    expect(CAUSES.has(event.cause), `${label}: cause 出闭联合 ${event.cause}`).toBe(true);
    if (event.timeoutMs !== undefined) {
      expect(
        Number.isFinite(event.timeoutMs) && event.timeoutMs >= 0,
        `${label}: timeoutMs 有限非负`,
      ).toBe(true);
    }
    const text = JSON.stringify(event);
    for (const sentinel of ['sk-SENTINEL', 'hub-owner-9f38', 'peer-owner-7e21', 'SENTINEL']) {
      expect(text.includes(sentinel), `${label}: 泄漏 ${sentinel}`).toBe(false);
    }
    const visit = (value: unknown): void => {
      if (value === null || typeof value !== 'object') return;
      if (value instanceof Uint8Array || value instanceof ArrayBuffer || value instanceof DataView) {
        throw new Error(`${label}: 含二进制对象`);
      }
      if (value instanceof Error) throw new Error(`${label}: 含 Error`);
      for (const v of Object.values(value)) visit(v);
    };
    visit(event);
  }
}

function isSyncApplied(bytes: Uint8Array): boolean {
  return decodeMessage(bytes).message.kind === 'SYNC_APPLIED';
}

function isBootstrapSnapshot(bytes: Uint8Array): boolean {
  return decodeMessage(bytes).message.kind === 'BOOTSTRAP_SNAPSHOT';
}

describe('issue #256：namespace-failed 终态原因可诊断性', () => {
  // ═══════════ 场景 1：open 超时 → cause 'open-timeout'（事故盲区路径） ═══════════
  it('场景 1：authorize 悬挂 → openTimeout → namespace-failed{open-timeout, timeoutMs} 恰一，零 namespace-error，release 后自愈', async () => {
    const uh = collectUnhandledRejections();
    const peerRec = makeRecorder();
    let release!: () => void;
    const hang = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = await boot({
      start: false,
      timeouts: { openTimeoutMs: 200 },
      backoff: { baseMs: 50, maxMs: 400, resetAfterMs: 500 },
      random: () => 0.5,
      peerObserver: peerRec.observer,
      authorize: async () => {
        await hang; // 授权后端故障：OPEN 永不授权
        return {
          ok: true as const,
          localOwner: { userId: 'hub-owner-9f38' },
          permissions: { read: true, submit: true },
        };
      },
    });
    try {
      run.peer.start();
      await run.waitConnection('ready');
      await advanceMs(run, 250); // 越过 openTimeoutMs=200
      await settle();
      const failed1 = failedOf(peerRec.events, 'peer');
      expect(failed1, 'open 超时恰一终态原因事件').toHaveLength(1);
      expect(failed1[0]!.cause).toBe('open-timeout');
      expect(failed1[0]!.timeoutMs, 'timeoutMs = 配置上限读数').toBe(200);
      expect(
        nsErrorsOf(peerRec.events, 'peer'),
        '本地 timer 超时零 wire ⇒ 零 namespace-error',
      ).toHaveLength(0);
      assertFailedSafe(failed1, '场景 1');
      // 故障源消失 → 恢复环自愈 live；全程（含 stop 前断线）恰一 namespace-failed
      release();
      await settleUntil(() => run.namespaceState() === 'live', '场景 1: release 后自愈 live');
      expect(failedOf(peerRec.events, 'peer'), '自愈后仍恰一（无迟到/重复事件）').toHaveLength(1);
      expect(uh.events).toEqual([]);
    } finally {
      release();
      await run.peer.stop().catch(() => undefined);
      uh.dispose();
    }
    expect(failedOf(peerRec.events, 'peer'), 'stop 后仍恰一').toHaveLength(1);
  }, 60_000);

  // ═══════════ 场景 2：bootstrap 超时 → cause 'bootstrap-timeout' ═══════════
  it('场景 2：BOOTSTRAP_SNAPSHOT 丢失 → bootstrapTimeout → namespace-failed{bootstrap-timeout, timeoutMs} 恰一，重建后收敛 live', async () => {
    const uh = collectUnhandledRejections();
    const peerRec = makeRecorder();
    const run = await boot({
      start: false,
      timeouts: { bootstrapTimeoutMs: 150 },
      backoff: { baseMs: 50, maxMs: 500, resetAfterMs: 4_000 },
      random: () => 0.5,
      peerObserver: peerRec.observer,
    });
    try {
      run.peer.start();
      await run.waitConnection('ready');
      run.wire.dropNextHubToPeer(isBootstrapSnapshot); // wire1 快照被丢 → bootstrap 悬挂
      await run.waitNamespace('bootstrapping');
      await advanceMs(run, 200); // 越过 bootstrapTimeoutMs=150（含 backoff 重拨窗口）
      const failed1 = failedOf(peerRec.events, 'peer');
      expect(failed1, 'bootstrap 超时恰一终态原因事件').toHaveLength(1);
      expect(failed1[0]!.cause).toBe('bootstrap-timeout');
      expect(failed1[0]!.timeoutMs).toBe(150);
      expect(nsErrorsOf(peerRec.events, 'peer'), '本地 timer 超时零 wire').toHaveLength(0);
      assertFailedSafe(failed1, '场景 2');
      // wire2 快照合法到达 → 收敛 live；恰一事件保持
      await settleUntil(() => run.namespaceState() === 'live', '场景 2: 重建后收敛 live');
      expect(failedOf(peerRec.events, 'peer')).toHaveLength(1);
      expect(run.rootValue('peer', 'n')).toBe(42);
      expect(uh.events).toEqual([]);
    } finally {
      await run.peer.stop().catch(() => undefined);
      uh.dispose();
    }
    expect(failedOf(peerRec.events, 'peer'), 'stop 后仍恰一').toHaveLength(1);
  }, 60_000);

  // ═══════════ 场景 3：reconcile 超时 → cause 'reconcile-timeout'（事故场景） ═══════════
  it('场景 3：周期 round 的 SYNC_APPLIED 被丢 → reconcileTimeout → namespace-failed{reconcile-timeout, timeoutMs} 恰一；单侧日志即可识别', async () => {
    const uh = collectUnhandledRejections();
    const peerRec = makeRecorder();
    const run = await boot({
      peerReplica: 'same',
      timeouts: { reconcileIntervalMs: 200, reconcileTimeoutMs: 500 },
      backoff: { baseMs: 50, maxMs: 400, resetAfterMs: 4_000 },
      random: () => 0.5,
      peerObserver: peerRec.observer,
    });
    try {
      expect(run.namespaceState()).toBe('live');
      run.wire.dropNextHubToPeer(isSyncApplied);
      await advanceMs(run, 200); // 周期 round 开始
      await settle();
      await advanceMs(run, 600); // 烧满 reconcileTimeoutMs=500（#254 自愈随后重建）
      await settle();
      const failed1 = failedOf(peerRec.events, 'peer');
      expect(failed1, 'reconcile 超时恰一终态原因事件').toHaveLength(1);
      expect(failed1[0]!.cause).toBe('reconcile-timeout');
      expect(failed1[0]!.timeoutMs).toBe(500);
      expect(nsErrorsOf(peerRec.events, 'peer'), '本地 reconcile 超时零 wire').toHaveLength(0);
      assertFailedSafe(failed1, '场景 3');
      // 新 wire 不再丢帧 → 自愈 live；断线/重连全程恰一事件
      await settleUntil(() => run.namespaceState() === 'live', '场景 3: 自愈 live');
      expect(failedOf(peerRec.events, 'peer')).toHaveLength(1);
      expect(uh.events).toEqual([]);
    } finally {
      await run.peer.stop().catch(() => undefined);
      uh.dispose();
    }
    expect(failedOf(peerRec.events, 'peer'), 'stop 后仍恰一').toHaveLength(1);
  }, 60_000);

  // ═══════════ 场景 4：协议违例 → cause 'protocol-violation'（与 apply 类可区分） ═══════════
  it('场景 4：opening 期注入 UPDATE（真违例）→ namespace-failed{protocol-violation} 恰一 + namespace-error{sent:NAMESPACE_STATE_VIOLATION}', async () => {
    const uh = collectUnhandledRejections();
    const peerRec = makeRecorder();
    let release!: () => void;
    const hang = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = await boot({
      start: false,
      backoff: { baseMs: 50, maxMs: 400, resetAfterMs: 500 },
      random: () => 0.5,
      peerObserver: peerRec.observer,
      authorize: async () => {
        await hang; // peer 停留 opening；hub 静默（注入窗口无真实帧）
        return {
          ok: true as const,
          localOwner: { userId: 'hub-owner-9f38' },
          permissions: { read: true, submit: true },
        };
      },
    });
    try {
      run.peer.start();
      await run.waitConnection('ready');
      await run.waitNamespace('opening');
      // opening 期收到 UPDATE = §7.2 真违例（注入序列 = 接收端期望序列——hub 静默）
      run.injectHub({
        kind: 'UPDATE',
        namespaceId: run.nsId,
        update: new Uint8Array([0x00]),
      });
      await settle();
      expect(run.namespaceState()).toBe('failed');
      const failed1 = failedOf(peerRec.events, 'peer');
      expect(failed1, '协议违例恰一终态原因事件').toHaveLength(1);
      expect(failed1[0]!.cause).toBe('protocol-violation');
      expect(failed1[0]!.timeoutMs, '非 timer 族零 timeoutMs 字段').toBeUndefined();
      const errs = nsErrorsOf(peerRec.events, 'peer');
      expect(errs.filter((e) => e.direction === 'sent' && e.code === 'NAMESPACE_STATE_VIOLATION'))
        .toHaveLength(1);
      assertFailedSafe(failed1, '场景 4');
      // 界外（非 timer 族）：failed 稳定等待，零重建
      const dials = run.dialCount;
      await advanceMs(run, 2_000);
      expect(run.dialCount, '协议违例 failed 不触发恢复性重建').toBe(dials);
      expect(run.namespaceState()).toBe('failed');
      expect(uh.events).toEqual([]);
    } finally {
      release();
      await run.peer.stop().catch(() => undefined);
      uh.dispose();
    }
    expect(failedOf(peerRec.events, 'peer'), 'stop 后仍恰一').toHaveLength(1);
  }, 60_000);

  // ═══════════ 场景 5：apply 结构化拒绝 → cause 'apply-refused'（hub 侧） ═══════════
  it('场景 5：peer→hub SCHEMA 篡改 UPDATE → hub namespace-failed{apply-refused} 恰一 + namespace-error{sent:PROTECTED_FIELD_MUTATION}', async () => {
    const uh = collectUnhandledRejections();
    const hubRec = makeRecorder();
    const run = await boot({ hubObserver: hubRec.observer, random: () => 0.5 });
    try {
      expect(run.namespaceState()).toBe('live');
      // 构造真实 diff：克隆 hub 状态后篡改 SCHEMA（hub 侧受保护全容器）
      const clone = run.snapshotDoc('hub');
      (clone.getMap('SCHEMA') as unknown as Map<string, unknown>).set('lang', 'evil');
      const evil = Y.encodeStateAsUpdate(clone, run.stateVectorOf('hub'));
      run.injectPeer({ kind: 'UPDATE', namespaceId: run.nsId, update: evil });
      await settle();
      const failed1 = failedOf(hubRec.events, 'hub');
      expect(failed1, 'apply 拒绝恰一终态原因事件').toHaveLength(1);
      expect(failed1[0]!.cause).toBe('apply-refused');
      expect(failed1[0]!.timeoutMs).toBeUndefined();
      const errs = nsErrorsOf(hubRec.events, 'hub');
      expect(errs.filter((e) => e.direction === 'sent' && e.code === 'PROTECTED_FIELD_MUTATION'))
        .toHaveLength(1);
      assertFailedSafe(failed1, '场景 5');
      expect(run.rootValue('hub', 'n'), 'live 零写入').toBe(42);
      expect(uh.events).toEqual([]);
    } finally {
      await run.peer.stop().catch(() => undefined);
      uh.dispose();
    }
    expect(failedOf(hubRec.events, 'hub'), 'stop 后仍恰一').toHaveLength(1);
  }, 60_000);

  // ═══════════ 场景 6：apply 内部异常 → cause 'apply-rejected'（peer bootstrap 导入面） ═══════════
  it('场景 6：畸形 BOOTSTRAP_SNAPSHOT（applyUpdate throw）→ peer namespace-failed{apply-rejected} 恰一 + namespace-error{sent:BOOTSTRAP_FAILED}', async () => {
    const uh = collectUnhandledRejections();
    const peerRec = makeRecorder();
    const run = await boot({
      start: false,
      backoff: { baseMs: 50, maxMs: 500, resetAfterMs: 4_000 },
      random: () => 0.5,
      peerObserver: peerRec.observer,
    });
    try {
      run.peer.start();
      await run.waitConnection('ready');
      run.wire.dropNextHubToPeer(isBootstrapSnapshot); // 真快照丢弃（peer 停留 bootstrapping）
      await run.waitNamespace('bootstrapping');
      // 补位注入畸形快照（序列 = 被丢帧的序列——无信封洞；身份须匹配 OPEN_OK 声明）
      run.injectHub({
        kind: 'BOOTSTRAP_SNAPSHOT',
        namespaceId: run.nsId,
        replicationId: run.hubFixture!.identity.replicationId,
        replicationEpoch: run.hubFixture!.identity.replicationEpoch,
        snapshot: new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x00, 0x01]),
      });
      await settle();
      expect(run.namespaceState()).toBe('failed');
      const failed1 = failedOf(peerRec.events, 'peer');
      expect(failed1, 'apply 内部异常恰一终态原因事件').toHaveLength(1);
      expect(failed1[0]!.cause).toBe('apply-rejected');
      expect(failed1[0]!.timeoutMs).toBeUndefined();
      const errs = nsErrorsOf(peerRec.events, 'peer');
      expect(errs.filter((e) => e.direction === 'sent' && e.code === 'BOOTSTRAP_FAILED'))
        .toHaveLength(1);
      assertFailedSafe(failed1, '场景 6');
      expect(uh.events).toEqual([]);
    } finally {
      await run.peer.stop().catch(() => undefined);
      uh.dispose();
    }
    expect(failedOf(peerRec.events, 'peer'), 'stop 后仍恰一').toHaveLength(1);
  }, 60_000);

  // ═══════════ 场景 7：对端 ERROR 驱动 → cause 'remote-error'（与本地失败零重复计数） ═══════════
  it('场景 7：live 期注入对端 terminal ERROR → namespace-failed{remote-error} 恰一 + namespace-error{received} 恰一；零本地 cause', async () => {
    const uh = collectUnhandledRejections();
    const peerRec = makeRecorder();
    const run = await boot({ peerObserver: peerRec.observer, random: () => 0.5 });
    try {
      expect(run.namespaceState()).toBe('live');
      // hub 静默期注入终态 ERROR（序列 = 接收端期望序列）
      run.injectHub({
        kind: 'ERROR',
        code: 'BOOTSTRAP_FAILED',
        safeMessage: 'protocol error: BOOTSTRAP_FAILED',
        namespaceId: run.nsId,
      });
      await settle();
      expect(run.namespaceState()).toBe('failed');
      const failed1 = failedOf(peerRec.events, 'peer');
      expect(failed1, '对端驱动终局恰一原因事件（不与本地失败重复计数）').toHaveLength(1);
      expect(failed1[0]!.cause).toBe('remote-error');
      const errs = nsErrorsOf(peerRec.events, 'peer');
      expect(
        errs.filter((e) => e.direction === 'received' && e.code === 'BOOTSTRAP_FAILED' && e.terminalState === 'failed'),
        'wire ERROR 帧计数恰一（与终态边沿计数互补）',
      ).toHaveLength(1);
      expect(
        errs.filter((e) => e.direction === 'sent'),
        'remote-error 路径本端零 wire ERROR 回发',
      ).toHaveLength(0);
      assertFailedSafe(failed1, '场景 7');
      // 界外（非 timer 族）：failed 稳定等待
      const dials = run.dialCount;
      await advanceMs(run, 2_000);
      expect(run.dialCount).toBe(dials);
      expect(run.namespaceState()).toBe('failed');
      expect(uh.events).toEqual([]);
    } finally {
      await run.peer.stop().catch(() => undefined);
      uh.dispose();
    }
    expect(failedOf(peerRec.events, 'peer'), 'stop 后仍恰一').toHaveLength(1);
  }, 60_000);

  // ═══════════ 场景 8：observer throw 隔离（wire/状态/cleanup 零改变） ═══════════
  it('场景 8：observer 对一切事件 throw → reconcile 超时仍收口 failed 且自愈 live，零 unhandled rejection', async () => {
    const uh = collectUnhandledRejections();
    let delivered = 0;
    const throwing: ReplicationObserver = () => {
      delivered += 1;
      throw new Error('observer boom');
    };
    const run = await boot({
      peerReplica: 'same',
      timeouts: { reconcileIntervalMs: 200, reconcileTimeoutMs: 500 },
      backoff: { baseMs: 50, maxMs: 400, resetAfterMs: 4_000 },
      random: () => 0.5,
      peerObserver: throwing,
    });
    try {
      expect(run.namespaceState()).toBe('live');
      run.wire.dropNextHubToPeer(isSyncApplied);
      await advanceMs(run, 200);
      await settle();
      await advanceMs(run, 600);
      await settle();
      // 事件仍被投递（throw 被隔离，非熔断）——含 namespace-failed
      expect(delivered, 'observer 持续被调用（隔离非熔断）').toBeGreaterThan(0);
      // 状态机结果不变：超时 → failed →（#254）重建 → 自愈 live
      await settleUntil(() => run.namespaceState() === 'live', '场景 8: throw 下自愈 live');
      expect(run.connectionState()).toBe('ready');
      // 数据面收敛（cleanup/lease 无泄漏的功能性证据）
      await run.writeHub({ n: 51 });
      await settleUntil(() => run.rootValue('peer', 'n') === 51, '场景 8: hub→peer 收敛');
      await run.writePeer({ n: 52 });
      await settleUntil(() => run.rootValue('hub', 'n') === 52, '场景 8: peer→hub 收敛');
      expect(uh.events, 'observer throw 零外溢').toEqual([]);
    } finally {
      await run.peer.stop().catch(() => undefined);
      uh.dispose();
    }
  }, 60_000);

  // ═══════════ 场景 9：remove/close 竞态——静默域零迟到失败事件 ═══════════
  it('场景 9a：live 中 removeTarget + CLOSE_OK 被丢 → closeTimeout 本地收口 closed，全程零 namespace-failed', async () => {
    const uh = collectUnhandledRejections();
    const peerRec = makeRecorder();
    const run = await boot({
      timeouts: { closeTimeoutMs: 150 },
      backoff: { baseMs: 50, maxMs: 400, resetAfterMs: 4_000 },
      random: () => 0.5,
      peerObserver: peerRec.observer,
    });
    try {
      expect(run.namespaceState()).toBe('live');
      run.dropNextHubFrame('CLOSE_OK'); // CLOSE_OK 永不到达（洞后零新帧——无 SEQUENCE_VIOLATION）
      const closePromise = run.peer.removeTarget(run.nsId);
      await settle();
      expect(run.namespaceState()).toBe('closing');
      await advanceMs(run, 200); // 越过 closeTimeoutMs=150 → 本地收口 closed
      await closePromise;
      expect(run.namespaceState()).toBe('closed');
      expect(
        failedOf(peerRec.events, 'peer'),
        'remove/close 竞态零迟到失败事件',
      ).toHaveLength(0);
      expect(nsErrorsOf(peerRec.events, 'peer'), '正常收口零 wire ERROR').toHaveLength(0);
      expect(uh.events).toEqual([]);
    } finally {
      await run.peer.stop().catch(() => undefined);
      uh.dispose();
    }
  }, 60_000);

  it('场景 9b：live 中连接断开 → disconnected（非 failed）→ 重连回 live，全程零 namespace-failed', async () => {
    const uh = collectUnhandledRejections();
    const peerRec = makeRecorder();
    const run = await boot({
      backoff: { baseMs: 50, maxMs: 400, resetAfterMs: 4_000 },
      random: () => 0.5,
      peerObserver: peerRec.observer,
    });
    try {
      expect(run.namespaceState()).toBe('live');
      run.wire.closePeerSide(1006, 'peer-side-close-SENTINEL');
      await settleUntil(() => run.namespaceState() === 'disconnected', '场景 9b: 断线投影 disconnected');
      expect(
        failedOf(peerRec.events, 'peer'),
        '连接断开 ≠ namespace 失败——零 namespace-failed',
      ).toHaveLength(0);
      // 重连 → 重 OPEN → 回 live（backoff timer 需推进虚拟时钟）；全程仍零失败事件
      let live = false;
      for (let step = 0; step < 60 && !live; step += 1) {
        await advanceMs(run, 1_000);
        live = run.namespaceState() === 'live';
      }
      expect(live, '断线重连后必须回 live').toBe(true);
      expect(failedOf(peerRec.events, 'peer')).toHaveLength(0);
      expect(uh.events).toEqual([]);
    } finally {
      await run.peer.stop().catch(() => undefined);
      uh.dispose();
    }
    expect(failedOf(peerRec.events, 'peer'), 'stop 后仍零').toHaveLength(0);
  }, 60_000);

  // ═══════════ 场景 10：无 observer 零回归（零事件构造/零读取纪律的行为锚） ═══════════
  it('场景 10：零 observer 注入 → reconcile 超时收口 failed 并自愈 live（行为与观测面完全解耦）', async () => {
    const uh = collectUnhandledRejections();
    const run = await boot({
      peerReplica: 'same',
      timeouts: { reconcileIntervalMs: 200, reconcileTimeoutMs: 500 },
      backoff: { baseMs: 50, maxMs: 400, resetAfterMs: 4_000 },
      random: () => 0.5,
      // 零 observer —— 无事件构造/无投影读取/零时钟调用（类型层 + finalize observerOn 门）
    });
    try {
      expect(run.namespaceState()).toBe('live');
      run.wire.dropNextHubToPeer(isSyncApplied);
      await advanceMs(run, 200);
      await settle();
      await advanceMs(run, 600);
      await settle();
      await settleUntil(() => run.namespaceState() === 'live', '场景 10: 无 observer 自愈 live');
      await run.writeHub({ n: 61 });
      await settleUntil(() => run.rootValue('peer', 'n') === 61, '场景 10: hub→peer 收敛');
      expect(uh.events).toEqual([]);
    } finally {
      await run.peer.stop().catch(() => undefined);
      uh.dispose();
    }
  }, 60_000);
});
