/**
 * SA6 红灯验收 —— issue #175（主动 reauthentication 生命周期）。
 *
 * 锚定 `wiki/raw/task_active-reauthentication-lifecycle.md` AC1..AC8（协议
 * `docs/protocols/instance-replication-v1.md` §6.3/§15.1（L435-442）/L450，ADR-0010
 * 条款 2/3/4/6/9；SA5 `20260830-bug-active-reauthentication-lifecycle.md` 根因表
 * 5 个缺陷点）。
 *
 * 冻结契约扩展（SA6 锚；实现后与 `@nomicore/ws-replication` 正式类型逐字段一致，
 * mirror 见 `./driver.ts`）：
 * - `HubReplication.requestReauth(instanceIdentity: string): Promise<void>`（AC1/AC2）：
 *   认证/授权 Adapter 主动 reauth 事件 seam——按认证实例身份定位连接（绝不以
 *   token 值为键，AC7），对每个匹配连接发送 `GOAWAY(REAUTH_REQUIRED,
 *   drainTimeoutMs>0)`，按 drain/deadline 规则以 WS 1001 收口（AC4——区别于
 *   hub.close() 的零 drain 窗口）；未知实例/已收口连接 → 无副作用 resolve；
 *   重复调用幂等（AC6）。
 * - `PeerReplication.notifyAuthChanged(): void`（AC5）：token/config 显式变化
 *   通知缝——blocked 仅在明确变化后恢复拨号（自 blocked 走 rebuild 编排）。
 *
 * 红线纪律：真实 yjs / Registry / Runtime 双实例（driver boot + 测试侧组装）；
 * fake-duplex（微任务投递）；fake scheduler（零 real sleep）；断言 = wire 帧 /
 * 状态投影 / 认证记账 / 连接收口观测（零源码 grep；零 mock 被测对象）。
 *
 * ⚠ 本文件全部 IT 为红灯（实现未修）：预期失败点见各 it 注释（RED@）。
 */
import { describe, expect, it } from 'vitest';
import { createHubReplication, createPeerReplication } from '@nomicore/ws-replication';
import type { HubReplication } from '@nomicore/ws-replication';
import { decodeMessage } from '@nomicore/replication-protocol';
import {
  advanceMs,
  boot,
  collectUnhandledRejections,
  makeAuthorizer,
  TEST_TOKEN,
} from './driver.js';
import type { HubReauthSeam, PeerAuthNotifySeam } from './driver.js';
import {
  HUB_INSTANCE,
  HUB_OWNER,
  PEER_INSTANCE,
  PEER_OWNER,
  makeDeferPump,
  makeHubNamespace,
  makeNode,
  makeWire,
  registerDeferPump,
  settle,
  settleUntil,
  type ReplicaNode,
  type Wire,
} from './harness.js';

// ─────────────────────────── 观测辅助（纯 fixture，零 mock 被测对象） ───────────────────────────

/** 该 wire 上 hub→peer 方向的 GOAWAY 消息（按到达序）。 */
function hubGoaways(wire: Wire): Array<{ reasonCode: string; drainTimeoutMs: number; retryAfterMs?: number }> {
  const out: Array<{ reasonCode: string; drainTimeoutMs: number; retryAfterMs?: number }> = [];
  for (const bytes of wire.hubToPeer) {
    const message = decodeMessage(bytes).message;
    if (message.kind === 'GOAWAY') out.push(message as { reasonCode: string; drainTimeoutMs: number });
  }
  return out;
}

/** 全部 wire 原始字节中搜索 token 的 ASCII 序列（AC7：凭据零上 wire）。 */
function tokenLeaksOnWire(wires: readonly Wire[], token: string): boolean {
  const tokenBytes = [...Buffer.from(token, 'utf8')];
  const contains = (bytes: Uint8Array): boolean => {
    outer: for (let i = 0; i + tokenBytes.length <= bytes.length; i += 1) {
      for (let j = 0; j < tokenBytes.length; j += 1) {
        if (bytes[i + j] !== tokenBytes[j]) continue outer;
      }
      return true;
    }
    return false;
  };
  for (const wire of wires) {
    for (const bytes of [...wire.peerToHub, ...wire.hubToPeer]) {
      if (contains(bytes)) return true;
    }
  }
  return false;
}

/** 调用 reauth seam 并打捞结果（seam 缺失 → TypeError，测试据此红灯）。 */
async function callReauth(hub: HubReplication, instanceIdentity: string): Promise<'resolved' | 'rejected'> {
  try {
    await (hub as unknown as HubReauthSeam).requestReauth(instanceIdentity);
    return 'resolved';
  } catch {
    return 'rejected';
  }
}

/** 调用 auth 变化通知缝并打捞结果（seam 缺失 → TypeError，测试据此红灯）。 */
function callNotifyAuthChanged(peer: { notifyAuthChanged?: () => void }): 'resolved' | 'rejected' {
  try {
    (peer as unknown as PeerAuthNotifySeam).notifyAuthChanged();
    return 'resolved';
  } catch {
    return 'rejected';
  }
}

// ─────────────────────────── 多认证实例组装（AC3 定向性专用） ───────────────────────────

interface AuthPeerSpec {
  readonly instanceId: string;
  /** 拨号时读取的当前凭据（闭包可变——token 轮换场景）。 */
  readonly token: () => string;
}

interface AuthPeerSide {
  readonly peer: ReturnType<typeof createPeerReplication>;
  readonly node: ReplicaNode;
  readonly wires: readonly Wire[];
  dialCount(): number;
  currentWire(): Wire;
}

interface AuthPeersEnv {
  readonly hub: HubReplication;
  readonly hubNode: ReplicaNode;
  readonly nsId: string;
  readonly sides: readonly AuthPeerSide[];
  readonly verifyCalls: string[];
}

/** 一个 Hub + N 个不同认证实例的 Peer（互不共享 Persistence），全部到 live。 */
async function bootAuthPeers(opts: {
  readonly hubVerifier: (token: string) => Promise<Readonly<{ ok: true; instanceId: string }> | Readonly<{ ok: false }>>;
  readonly peers: readonly AuthPeerSpec[];
  readonly timeouts: { readonly closeTimeoutMs: number };
}): Promise<AuthPeersEnv> {
  const hubNode = makeNode('hub');
  const authorizer = makeAuthorizer();
  const hubFixture = await makeHubNamespace(hubNode, { owner: HUB_OWNER });
  const nsId = hubFixture.namespaceId;
  const verifyCalls: string[] = [];
  const hub = createHubReplication({
    instanceId: HUB_INSTANCE,
    registry: hubNode.registry,
    authorize: authorizer.authorize,
    timer: hubNode.scheduler,
    verifyToken: (token) => {
      verifyCalls.push(token);
      return opts.hubVerifier(token);
    },
    timeouts: opts.timeouts,
  });
  const sides: AuthPeerSide[] = [];
  for (const spec of opts.peers) {
    const node = makeNode('peer');
    const wires: Wire[] = [];
    const pump = makeDeferPump();
    registerDeferPump(pump);
    let dialCount = 0;
    const peer = createPeerReplication({
      instanceId: spec.instanceId,
      hubInstanceId: HUB_INSTANCE,
      registry: node.registry,
      dial: () => {
        dialCount += 1;
        const wire = makeWire();
        wires.push(wire);
        void hub.accept(wire.hubEnd, { token: spec.token() });
        return wire.peerEnd;
      },
      timer: node.scheduler,
      targets: [{ namespaceId: nsId, localOwner: PEER_OWNER }],
      deferTask: pump.defer,
    });
    sides.push({
      peer,
      node,
      wires,
      dialCount: () => dialCount,
      currentWire: () => wires[wires.length - 1]!,
    });
  }
  for (const side of sides) side.peer.start();
  await settleUntil(
    () => sides.every((side) => side.peer.getConnectionState() === 'ready'),
    '全部 peer ready',
  );
  await settleUntil(
    () => sides.every((side) => side.peer.getNamespaceState(nsId) === 'live'),
    '全部 peer live',
  );
  return { hub, hubNode, nsId, sides, verifyCalls };
}

// ═══════════════════════════════════════ 红灯契约 ═══════════════════════════════════════

describe('issue #175：主动 reauthentication 生命周期（全部红灯）', () => {
  it('AC1/AC2/AC4/AC5 前置：requestReauth → GOAWAY(REAUTH_REQUIRED, drain>0) → peer blocked → drain 窗开放 → deadline 1001 收口 → 零自动重拨', async () => {
    const probe = collectUnhandledRejections();
    try {
      const run = await boot({ timeouts: { closeTimeoutMs: 60 } });

      // RED@1：当前 HubReplication 公共面无 requestReauth —— 调用即 TypeError（契约未实现本体）
      expect(await callReauth(run.hub, PEER_INSTANCE)).toBe('resolved');
      await settle();

      // AC2：恰好 1 个 GOAWAY，reasonCode=REAUTH_REQUIRED，正 drainTimeoutMs
      const goaways = run.hubFramesAll('GOAWAY');
      expect(goaways.length).toBe(1);
      const goaway = goaways[0]!.message as { reasonCode: string; drainTimeoutMs: number };
      expect(goaway.reasonCode).toBe('REAUTH_REQUIRED');
      expect(goaway.drainTimeoutMs).toBeGreaterThan(0);

      // 接收侧既有分类（§15.1）：连接 blocked、namespace 投影 disconnected
      expect(run.connectionState()).toBe('blocked');
      expect(run.namespaceState()).toBe('disconnected');

      // RED@2：AC4 drain 窗口——GOAWAY 后 wire 不得立即关闭（区别于 hub.close 零窗口）
      expect(run.wire.hubSideClosed).toBe(false);
      expect(run.wire.peerSideClosed).toBe(false);

      // deadline（GOAWAY 携带值）→ 发送方以 WS 1001 收口（§6.3 L149「之后发送方以 WS 1001 关闭」）
      await run.hubNode.scheduler.advanceBy(goaway.drainTimeoutMs);
      await settle();
      expect(run.wire.hubSideClosed).toBe(true);
      expect(run.wire.peerSideCloseInfo?.code).toBe(1001); // peer 观测到的远程 close 码

      // AC5 前置：blocked 后时钟大步推进零重拨（无显式变化通知不得恢复）
      await advanceMs(run, 60_000);
      expect(run.dialCount).toBe(1);
      expect(run.connectionState()).toBe('blocked');
    } finally {
      probe.dispose();
    }
    expect(probe.events).toEqual([]);
  });

  it('AC3 定向性：未知实例 no-op；requestReauth(peer-beta) 只影响 beta（alpha 零 GOAWAY、ready/live、wire 开放）', async () => {
    const probe = collectUnhandledRejections();
    try {
      const TOKEN_ALPHA = 'tok-alpha-1a2b3c4d';
      const TOKEN_BETA = 'tok-beta-9f8e7d6c';
      const PEER_BETA = 'peer-beta';
      const env = await bootAuthPeers({
        timeouts: { closeTimeoutMs: 60 },
        hubVerifier: async (token) =>
          token === TOKEN_ALPHA
            ? { ok: true as const, instanceId: PEER_INSTANCE }
            : token === TOKEN_BETA
              ? { ok: true as const, instanceId: PEER_BETA }
              : { ok: false as const },
        peers: [
          { instanceId: PEER_INSTANCE, token: () => TOKEN_ALPHA },
          { instanceId: PEER_BETA, token: () => TOKEN_BETA },
        ],
      });
      const alpha = env.sides[0]!;
      const beta = env.sides[1]!;
      expect(alpha.peer.getConnectionState()).toBe('ready');
      expect(alpha.peer.getNamespaceState(env.nsId)).toBe('live');
      expect(beta.peer.getConnectionState()).toBe('ready');
      expect(beta.peer.getNamespaceState(env.nsId)).toBe('live');

      // RED@1：未知实例 → requestReauth 缺失即 TypeError；实现后 = 无副作用 resolve
      expect(await callReauth(env.hub, 'peer-unknown')).toBe('resolved');
      await settle();
      expect(hubGoaways(alpha.currentWire())).toEqual([]);
      expect(hubGoaways(beta.currentWire())).toEqual([]);
      expect(alpha.peer.getConnectionState()).toBe('ready');
      expect(beta.peer.getConnectionState()).toBe('ready');

      // 定向 beta：alpha 零 GOAWAY、保持 ready/live、wire 开放；beta 收 GOAWAY(REAUTH_REQUIRED) → blocked
      expect(await callReauth(env.hub, PEER_BETA)).toBe('resolved');
      await settle();
      expect(hubGoaways(beta.currentWire()).length).toBe(1);
      const bg = hubGoaways(beta.currentWire())[0]!;
      expect(bg.reasonCode).toBe('REAUTH_REQUIRED');
      expect(bg.drainTimeoutMs).toBeGreaterThan(0);
      expect(hubGoaways(alpha.currentWire())).toEqual([]);
      expect(alpha.peer.getConnectionState()).toBe('ready');
      expect(alpha.peer.getNamespaceState(env.nsId)).toBe('live');
      expect(alpha.currentWire().hubSideClosed).toBe(false);
      expect(beta.peer.getConnectionState()).toBe('blocked');

      // beta deadline 收口（AC4）；alpha 全程不受影响
      await env.hubNode.scheduler.advanceBy(bg.drainTimeoutMs);
      await settle();
      expect(beta.currentWire().hubSideClosed).toBe(true);
      expect(beta.currentWire().peerSideCloseInfo?.code).toBe(1001);
      expect(alpha.currentWire().hubSideClosed).toBe(false);
      expect(alpha.peer.getConnectionState()).toBe('ready');
      expect(alpha.peer.getNamespaceState(env.nsId)).toBe('live');
    } finally {
      probe.dispose();
    }
    expect(probe.events).toEqual([]);
  });

  it('AC4 接收侧 deadline（SA5 根因 #3 锚）：注入 GOAWAY(REAUTH_REQUIRED, 60ms) → blocked 后 peer 在 deadline 自行 1001 收口，wire 不无限开放', async () => {
    const probe = collectUnhandledRejections();
    try {
      const run = await boot({});
      run.injectHub({ kind: 'GOAWAY', reasonCode: 'REAUTH_REQUIRED', drainTimeoutMs: 60 });
      await settle();
      // 既有接收面（绿——分类已实现）：REAUTH_REQUIRED → blocked
      expect(run.connectionState()).toBe('blocked');
      expect(run.namespaceState()).toBe('disconnected');

      // RED@：接收侧 elapsed deadline（§6.3「接收时开始计算本地 elapsed deadline」）——
      // 当前 enterBlocked 不武装任何 deadline，wire 无限开放（SA5 R3：10×deadline 仍开放）
      await run.peerNode.scheduler.advanceBy(60);
      await settle();
      expect(run.wire.peerSideClosed).toBe(true);
      expect(run.wire.hubSideCloseInfo?.code).toBe(1001);

      // 收口后 blocked 语义保持：10×deadline 零重拨
      await advanceMs(run, 60 * 10);
      expect(run.connectionState()).toBe('blocked');
      expect(run.dialCount).toBe(1);
    } finally {
      probe.dispose();
    }
    expect(probe.events).toEqual([]);
  });

  it('AC5：blocked 零通知零重拨；token 轮换 + notifyAuthChanged → 重建（旧 wire 收口）→ 新 token 认证 → ready → live → 数据收敛', async () => {
    const probe = collectUnhandledRejections();
    try {
      const TOKEN_A = 'tok-old-00000001';
      const TOKEN_B = 'tok-new-00000002';
      let currentToken = TOKEN_A;
      const run = await boot({
        tokenSource: () => currentToken,
        verifyToken: async (token) =>
          token === TOKEN_A || token === TOKEN_B
            ? { ok: true as const, instanceId: PEER_INSTANCE }
            : { ok: false as const },
        timeouts: { closeTimeoutMs: 5_000 },
      });
      expect(run.verifyCalls).toEqual([TOKEN_A]);

      // SA2 修正（Verdict pass 后）：drainTimeoutMs=300_000——保证「60s 无通知零重拨」
      // 窗口严格位于 receiver drain/deadline 之前，不越过 deadline（锚点不掺入收口面）
      run.injectHub({ kind: 'GOAWAY', reasonCode: 'REAUTH_REQUIRED', drainTimeoutMs: 300_000 });
      await settle();
      expect(run.connectionState()).toBe('blocked');

      // AC5 前置（既有正确行为回归锁）：无显式变化通知 → 大步时钟零重拨
      await advanceMs(run, 60_000);
      expect(run.dialCount).toBe(1);
      expect(run.connectionState()).toBe('blocked');

      // token 轮换（无声无息，拨号闭包内可变）→ 显式通知 → 重建
      currentToken = TOKEN_B;
      // RED@1：当前 PeerReplication 公共面无 auth 变化通知缝——TypeError
      expect(callNotifyAuthChanged(run.peer as unknown as { notifyAuthChanged?: () => void })).toBe('resolved');
      await settleUntil(() => run.peer.getConnectionState() === 'ready', '通知后重建 → ready');
      expect(run.dialCount).toBe(2);
      expect(run.verifyCalls).toEqual([TOKEN_A, TOKEN_B]); // 新 Upgrade 携带轮换后 token
      expect(run.wires[0]!.peerSideClosed).toBe(true); // 旧认证 transport 收口
      expect(run.wires[0]!.hubSideCloseInfo?.code).toBe(1000); // rebuild 关闭语义（1000）
      await run.waitNamespace('live');

      // 恢复闭环：重建连接真实同步（前向拨号 + 后向数据收敛）
      await run.writePeer({ n: 99 });
      await settle();
      expect(run.rootValue('hub', 'n')).toBe(99);

      // AC7 佐证：轮换前后两个 token 均零上 wire
      expect(tokenLeaksOnWire(run.wires, TOKEN_A)).toBe(false);
      expect(tokenLeaksOnWire(run.wires, TOKEN_B)).toBe(false);
    } finally {
      probe.dispose();
    }
    expect(probe.events).toEqual([]);
  });

  it('AC6 幂等与竞态：重复 ×3 → 恰 1 GOAWAY；收口后迟到 reauth → 零副作用 resolve；与 hub.close 竞态零 unhandled rejection；连接已消失后迟到 → no-op', async () => {
    const probe = collectUnhandledRejections();
    try {
      // ── 变体一：重复 ×3 → 恰 1 GOAWAY；deadline 收口后再发 → 零副作用 resolve ──
      const run = await boot({ timeouts: { closeTimeoutMs: 60 } });
      expect(await callReauth(run.hub, PEER_INSTANCE)).toBe('resolved'); // RED@：seam 缺失 → TypeError
      expect(await callReauth(run.hub, PEER_INSTANCE)).toBe('resolved');
      expect(await callReauth(run.hub, PEER_INSTANCE)).toBe('resolved');
      await settle();
      expect(run.hubFramesAll('GOAWAY').length).toBe(1); // 幂等：不重复发 GOAWAY
      const goaway = run.hubFramesAll('GOAWAY')[0]!.message as { reasonCode: string; drainTimeoutMs: number };
      await run.hubNode.scheduler.advanceBy(goaway.drainTimeoutMs);
      await settle();
      expect(run.wire.hubSideClosed).toBe(true);
      expect(await callReauth(run.hub, PEER_INSTANCE)).toBe('resolved'); // 迟到：连接已收口 → no-op
      expect(run.hubFramesAll('GOAWAY').length).toBe(1);

      // ── 变体二：requestReauth 与 hub.close 背靠背（同 tick 竞态）→ 双 resolve、零 unhandled rejection ──
      const run2 = await boot({ timeouts: { closeTimeoutMs: 60 } });
      const pReauth = callReauth(run2.hub, PEER_INSTANCE);
      const pClose = run2.hub.close().then(
        () => 'close-ok',
        (cause: unknown) => `close-err:${String(cause)}`,
      );
      await settle();
      expect(await pReauth).toBe('resolved');
      expect(await pClose).toBe('close-ok');
      expect(run2.wire.hubSideClosed).toBe(true);
      // 竞态后 deadline 残响必须零副作用（stale timer 安全）
      await run2.hubNode.scheduler.advanceBy(60 + 60_000);
      await settle();
      expect(run2.wire.hubSideClosed).toBe(true);
      expect(run2.wire.peerSideCloseInfo?.code).toBe(1001);

      // ── 变体三：连接早已消失（peer 断开）后的迟到 reauth → 零副作用 resolve ──
      const run3 = await boot({});
      run3.wire.closePeerSide(1001, 'peer-gone');
      await settleUntil(() => run3.hub.connections.length === 0, 'hub 侧连接已收口');
      expect(await callReauth(run3.hub, PEER_INSTANCE)).toBe('resolved');
      expect(run3.hubFramesAll('GOAWAY').length).toBe(0);
    } finally {
      probe.dispose();
    }
    expect(probe.events).toEqual([]);
  });

  it('AC7：requestReauth 全程（GOAWAY 帧字节 + peer 观测 close reason）零 token 序列', async () => {
    const probe = collectUnhandledRejections();
    try {
      const run = await boot({ timeouts: { closeTimeoutMs: 60 } });
      expect(await callReauth(run.hub, PEER_INSTANCE)).toBe('resolved'); // RED@：seam 缺失 → TypeError
      await settle();
      const goaways = run.hubFramesAll('GOAWAY');
      expect(goaways.length).toBe(1);
      const goaway = goaways[0]!.message as { reasonCode: string; drainTimeoutMs: number };
      expect(goaway.reasonCode).toBe('REAUTH_REQUIRED'); // 稳定安全码，无凭据字段
      await run.hubNode.scheduler.advanceBy(goaway.drainTimeoutMs);
      await settle();
      expect(run.wire.hubSideClosed).toBe(true);
      // wire 全部字节（含 GOAWAY 帧与 close 前任何数据帧）零 token 序列
      expect(tokenLeaksOnWire(run.wires, TEST_TOKEN)).toBe(false);
      // close reason 不得携带 token/凭据（AC7：错误/日志面同样受控）
      expect(run.wire.peerSideCloseInfo?.reason.includes(TEST_TOKEN)).toBe(false);
      // SA2 修正（Verdict pass 后）：本流程由 Hub 主动收口——hub 侧从未收到 peer 的
      // close 事件，hubSideCloseInfo 无观测面（恒 undefined）；删去原
      // `hubSideCloseInfo?.reason.includes(...)` 不可满足断言，改为存在性锚点
      expect(run.wire.hubSideCloseInfo).toBeUndefined();
    } finally {
      probe.dispose();
    }
    expect(probe.events).toEqual([]);
  });
});
