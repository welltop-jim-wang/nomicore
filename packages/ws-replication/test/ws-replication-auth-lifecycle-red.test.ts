/**
 * SA6 红灯验收 —— issue #138（Phase 5 切片 7：authenticate instances and run
 * connection lifecycle —— 实例认证与连接生命周期）。
 *
 * 锚定 `wiki/raw/task_phase5-ws-auth-lifecycle.md` AC-1..AC-7（协议
 * `docs/protocols/instance-replication-v1.md` §2/§6.1/§6.2/§6.3/§13/§14/§15/§19/§21，
 * ADR 0010 L147/L155/L157/L158/L159/L167/L179）。
 *
 * 冻结契约扩展（SA6 锚；实现后与 `@nomicore/ws-replication` 正式类型逐字段一致）：
 * - `HubReplicationOptions.verifyToken: PeerTokenVerifier`（必填）：
 *   `(token) => Promise<{ok:true; instanceId} | {ok:false}>`——token → 可信 Peer
 *   instanceId（安全文法 `^[a-z][a-z0-9-]{0,62}$`）；
 * - `HubReplication.accept(transport, request: HubUpgradeRequest): Promise<HubConnection | undefined>`
 *   ——Upgrade 请求上下文 `{ token?: string }`；认证先于任何协议连接分配；
 *   失败（缺凭据/验证拒绝/验证器异常/instanceId 文法违规）→ 返回 undefined、
 *   零协议连接分配、transport 以静态原因关闭（AC-7：任何拒绝路径零 token/身份回显）；
 * - HELLO `peerInstanceId` 必须等于认证身份 → 否则 `INSTANCE_IDENTITY_MISMATCH`（1008）；
 * - `HubReplication.revoke(instanceIdentity, namespaceId): Promise<void>`——授权撤销
 *   只终止对应 namespace（terminating namespace ERROR `NAMESPACE_UNAUTHORIZED`），
 *   连接与其他 namespace 不受影响；
 * - Peer 收 GOAWAY → 连接状态 `ready → draining`；drain 期停新 OPEN/round；
 *   按 reasonCode 分类并尊重 `retryAfterMs` 提示重新调度重连；
 * - issue #229：`HubReplication.close()` 不发送停机 GOAWAY，直接以 WS 1001 关闭；
 *   close 后不再接纳新连接（accept → undefined、零分配）。
 *
 * 红线纪律：真实 yjs / Registry / Runtime 双实例；fake-duplex（微任务投递）；
 * fake scheduler（零 real sleep）；断言 = wire 帧 / 状态投影 / 认证记账 /
 * 连接分配观测（零源码 grep；零 mock 被测对象）。
 *
 * ⚠ 本文件全部 IT 为红灯（实现未修）：预期失败点见各 it 注释（「RED@」）。
 *
 * R2 追加（SA2 R3 放行后，设计 §6.5 A2 锚）：A2-a（无条件 no-hint draining）、A2-b
 * （drain 停新 sync round，两变体）、A2-c（draining 期 1002/1008 close-code 分类——
 * 实现后防线，红灯点在 draining 预设）、A2-d（认证期早到帧预算：条数界/单帧界/
 * 边界内恰一次投递/认证超时封顶）、A2-e（同步重放型 transport 注册期拒绝——防伪绿）。
 * 既有 legacy 锚 G1（sa7-dynamic）的 draining 期望同步改锚（§6.5 A1）。
 */
import { describe, expect, it } from 'vitest';
import { createHubReplication } from '@nomicore/ws-replication';
import { createHubReplicationForTesting } from '@nomicore/ws-replication/testing';
import type { DuplexTransport } from '@nomicore/ws-replication';
import { decodeMessage, encodeMessage } from '@nomicore/replication-protocol';
import {
  advanceMs,
  boot,
  collectUnhandledRejections,
  DEFAULT_PEER_VERIFIER,
  makeAuthorizer,
  TEST_TOKEN,
} from './driver.js';
import {
  CONTRACT_LIMITS,
  CONTRACT_TIMEOUTS,
  deferred,
  HUB_INSTANCE,
  HUB_OWNER,
  makeHubNamespace,
  makeNode,
  makeWire,
  PEER_INSTANCE,
  settle,
  settleUntil,
  type ReplicaNode,
  type Wire,
} from './harness.js';

// ─────────────────────────── 冻结契约镜像（见文件头） ───────────────────────────

interface HubUpgradeRequestMirror {
  readonly token?: string;
}

type PeerTokenVerifierMirror = (
  token: string,
) => Promise<Readonly<{ ok: true; instanceId: string }> | Readonly<{ ok: false }>>;

/** 直接组装带认证的 Hub（不拨号；认证拒绝面专用）。 */
async function makeAuthHub(
  opts: { readonly verifyToken?: PeerTokenVerifierMirror } = {},
): Promise<{ readonly hub: ReturnType<typeof createHubReplication>; readonly node: ReplicaNode }> {
  const node = makeNode('hub');
  const hub = createHubReplication({
    instanceId: HUB_INSTANCE,
    registry: node.registry,
    authorize: makeAuthorizer().authorize,
    timer: node.scheduler,
    verifyToken: opts.verifyToken ?? DEFAULT_PEER_VERIFIER,
  });
  return { hub, node };
}

/** 该 wire 上的解码消息（按到达序）。 */
function framesOfWire(wire: Wire): { peerToHub: unknown[]; hubToPeer: unknown[] } {
  return {
    peerToHub: wire.peerToHub.map((bytes) => decodeMessage(bytes).message),
    hubToPeer: wire.hubToPeer.map((bytes) => decodeMessage(bytes).message),
  };
}

function isError(message: unknown, code: string): boolean {
  const m = message as { kind?: string; code?: string };
  return m.kind === 'ERROR' && m.code === code;
}

function kindOf(message: unknown): string {
  return (message as { kind?: string }).kind ?? '?';
}

/** 同步重放型 transport fixture（TcpTransport 实存形态：onMessage 注册即同步重放
 *  预置积压、重放先于 return——`sa7-r2-transport.test.ts:132-144`；fixture 级，零 mock
 *  被测对象）。`replayedCount` 记录已重放帧数（异常流产会中断重放循环 → 计数偏小）。 */
function makeReplayTransport(backlog: readonly Uint8Array[]): {
  readonly transport: DuplexTransport;
  replayedCount(): number;
  closeInfos(): ReadonlyArray<{ code: number; reason: string }>;
} {
  let closed = false;
  let replayed = 0;
  const messageListeners = new Set<(bytes: Uint8Array) => void>();
  const closeListeners = new Set<(info: Readonly<{ code: number; reason: string }>) => void>();
  const closeInfos: Array<{ code: number; reason: string }> = [];
  const transport: DuplexTransport = {
    send() {
      // 无对端——本 fixture 只测注册期拒绝路径
    },
    close(code = 1000, reason = '') {
      if (closed) return;
      closed = true;
      closeInfos.push({ code, reason });
      for (const listener of [...closeListeners]) listener({ code, reason });
    },
    get closed() {
      return closed;
    },
    onMessage(listener) {
      messageListeners.add(listener);
      for (const bytes of backlog) {
        replayed += 1;
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
    closeInfos: () => closeInfos,
  };
}

/** 全部 wire 原始字节中搜索 token 的 ASCII 序列（AC-7：凭据零上 wire）。 */
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

describe('issue #138 切片 7：实例认证与连接生命周期（全部红灯）', () => {
  it('AC-1/AC-2/AC-7 幸福路径：有效 bearer → 认证记账 → HELLO_ACK（nonce 原样）→ OPEN → live → 双向收敛，token 零上 wire', async () => {
    const run = await boot({});
    expect(run.connectionState()).toBe('ready');
    expect(run.namespaceState()).toBe('live');

    // AC-1：认证先于一切——accept 时已调用 verifyToken（RED@：实现无认证 → 零记账）
    expect(run.verifyCalls).toEqual([TEST_TOKEN]);

    // AC-2：HELLO_ACK 回显 hubInstanceId 与 connectionNonce（原样 16 bytes）
    const acks = run.hubFramesAll('HELLO_ACK');
    expect(acks.length).toBe(1);
    const ack = acks[0]!.message as { hubInstanceId: string; connectionNonce: Uint8Array };
    expect(ack.hubInstanceId).toBe(HUB_INSTANCE);
    expect(ack.connectionNonce.byteLength).toBe(16);

    // 双向数据收敛（AC-4 授权通过面：read/submit 全开）
    await run.writePeer({ n: 99 });
    await settle();
    expect(run.rootValue('hub', 'n')).toBe(99);

    // AC-7：任何 wire 字节序列不得泄漏 token
    expect(tokenLeaksOnWire(run.wires, TEST_TOKEN)).toBe(false);
  });

  it('AC-1：无效 bearer token → upgrade 拒绝：零协议连接分配、transport 关闭、不接受 HELLO', async () => {
    const { hub } = await makeAuthHub();
    const wire = makeWire();
    const conn = await (hub.accept(wire.hubEnd, { token: 'tok-bad' }) as unknown);
    // RED@：当前实现无认证——accept 返回连接对象且分配
    expect(conn).toBeUndefined();
    expect(hub.connections.length).toBe(0);
    expect(wire.hubSideClosed).toBe(true);
    // 早期 HELLO 不被处理（无 HELLO_ACK；认证失败后无协议 FSM）
    wire.peerEnd.send(
      encodeMessage(
        {
          kind: 'HELLO',
          peerInstanceId: PEER_INSTANCE,
          expectedHubInstanceId: HUB_INSTANCE,
          protocolVersions: [1],
          requiredCapabilities: 0,
          optionalCapabilities: 0,
          connectionNonce: new Uint8Array(16).fill(7),
        },
        { sequence: 1 },
      ),
    );
    await settle();
    expect(wire.hubToPeer.length).toBe(0);
  });

  it('AC-1 边界：缺失凭据（无 token 字段 / 未传请求）→ upgrade 拒绝，零分配', async () => {
    const { hub } = await makeAuthHub();
    const wireA = makeWire();
    const connA = await (hub.accept(wireA.hubEnd, {}) as unknown);
    expect(connA).toBeUndefined();
    expect(hub.connections.length).toBe(0);
    const wireB = makeWire();
    const connB = await (hub.accept(wireB.hubEnd) as unknown);
    expect(connB).toBeUndefined();
    expect(hub.connections.length).toBe(0);
  });

  it('AC-1 边界：验证器返回文法违例 instanceId → 视为无效凭据，零分配（instanceId 必须 ^[a-z][a-z0-9-]{0,62}$）', async () => {
    const { hub } = await makeAuthHub({
      verifyToken: async () => ({ ok: true as const, instanceId: 'Bad-Id!' }),
    });
    const wire = makeWire();
    const conn = await (hub.accept(wire.hubEnd, { token: TEST_TOKEN }) as unknown);
    expect(conn).toBeUndefined();
    expect(hub.connections.length).toBe(0);
    expect(wire.hubSideClosed).toBe(true);
  });

  it('AC-1：验证器抛错 → 升级拒绝（零分配、零 unhandled rejection、transport 关闭）', async () => {
    const probe = collectUnhandledRejections();
    try {
      const { hub } = await makeAuthHub({
        verifyToken: async () => {
          throw new Error('auth-backend-unreachable');
        },
      });
      const wire = makeWire();
      const conn = await (hub.accept(wire.hubEnd, { token: TEST_TOKEN }) as unknown);
      expect(conn).toBeUndefined();
      expect(hub.connections.length).toBe(0);
      expect(wire.hubSideClosed).toBe(true);
    } finally {
      probe.dispose();
    }
    expect(probe.events).toEqual([]);
  });

  it('AC-2：HELLO.peerInstanceId ≠ 认证身份 → INSTANCE_IDENTITY_MISMATCH（ERROR 1008，safeMessage 无身份文本），连接绝不 ready', async () => {
    // token 认证为 'peer-other'，而 peer 配置身份是 PEER_INSTANCE（HELLO 如实声明）
    const run = await boot({
      verifyToken: async () => ({ ok: true as const, instanceId: 'peer-other' }),
      start: false,
    });
    run.peer.start();
    // RED@：当前实现不绑定认证身份——HELLO 直接通过 → 状态 ready（等待 blocked 预算耗尽）
    await run.waitConnection('blocked');
    const frames = framesOfWire(run.wire);
    const errors = frames.hubToPeer.filter((message) => isError(message, 'INSTANCE_IDENTITY_MISMATCH'));
    expect(errors.length).toBe(1);
    const safeMessage = (errors[0] as { safeMessage: string }).safeMessage;
    expect(safeMessage.includes(PEER_INSTANCE)).toBe(false);
    expect(safeMessage.includes(TEST_TOKEN)).toBe(false);
    expect(run.wire.peerSideCloseInfo?.code).toBe(1008);
    expect(run.namespaceState()).not.toBe('live');
  });

  it('AC-4：授权撤销只关闭对应 scope——ns2 收到终止 ERROR 且 failed，ns1 与连接不受影响', async () => {
    const run = await boot({});
    const ns2Fixture = await makeHubNamespace(run.hubNode, { owner: HUB_OWNER });
    const ns2 = ns2Fixture.namespaceId;
    run.peer.addTarget({ namespaceId: ns2, localOwner: run.target.localOwner });
    await settleUntil(
      () => run.peer.getNamespaceState(ns2) === 'live',
      `ns2 live（当前 ${String(run.peer.getNamespaceState(ns2))}）`,
    );

    // RED@：当前实现无 revoke 面——调用即 TypeError（契约未实现本体）；
    // 实现后：恰 1 个 NAMESPACE_UNAUTHORIZED（ns2 scope）+ ns2 failed + ns1/连接存活
    let revokeOutcome = 'unavailable';
    try {
      await (run.hub as unknown as {
        revoke: (instanceIdentity: string, namespaceId: string) => Promise<void>;
      }).revoke(PEER_INSTANCE, ns2);
      revokeOutcome = 'resolved';
    } catch {
      revokeOutcome = 'rejected';
    }
    await settle();
    // RED@：当前实现无 revoke 面——调用即 TypeError（revokeOutcome ≠ resolved）
    expect(revokeOutcome).toBe('resolved');
    const frames = framesOfWire(run.wire);
    const unauthorized = frames.hubToPeer.filter((message) => isError(message, 'NAMESPACE_UNAUTHORIZED'));
    expect(unauthorized.length).toBe(1);
    expect((unauthorized[0] as { namespaceId?: string }).namespaceId).toBe(ns2);
    expect(run.peer.getNamespaceState(ns2)).toBe('failed');
    expect(run.peer.getNamespaceState(run.nsId)).toBe('live');
    expect(run.connectionState()).toBe('ready');
    expect(run.wire.peerSideCloseInfo).toBeUndefined();
  });

  it('AC-4 边界：撤销未知 namespace/实例 → 无副作用 no-op（零 ERROR、零关闭）', async () => {
    const run = await boot({});
    let revokeOutcome = 'unavailable';
    try {
      await (run.hub as unknown as {
        revoke: (instanceIdentity: string, namespaceId: string) => Promise<void>;
      }).revoke(PEER_INSTANCE, `ns-${'e'.repeat(32)}`);
      await (run.hub as unknown as {
        revoke: (instanceIdentity: string, namespaceId: string) => Promise<void>;
      }).revoke('peer-unknown', run.nsId);
      revokeOutcome = 'resolved';
    } catch {
      revokeOutcome = 'rejected';
    }
    await settle();
    // RED@：当前实现无 revoke 面——调用即 TypeError（redOutcome ≠ resolved）；
    // 实现后：未知 scope 的 revoke 必须 resolve 且零副作用
    expect(revokeOutcome).toBe('resolved');
    const frames = framesOfWire(run.wire);
    expect(frames.hubToPeer.filter((message) => isError(message, 'NAMESPACE_UNAUTHORIZED'))).toEqual([]);
    expect(run.peer.getNamespaceState(run.nsId)).toBe('live');
    expect(run.connectionState()).toBe('ready');
  });

  it('AC-5：GOAWAY → 连接直达 draining；drain 期停新 OPEN；按 retryAfterMs 提示重连调度（full-jitter 注入 random=0）', async () => {
    const run = await boot({ random: () => 0 });
    const ns2Fixture = await makeHubNamespace(run.hubNode, { owner: HUB_OWNER });
    const ns2 = ns2Fixture.namespaceId;

    run.injectHub({
      kind: 'GOAWAY',
      reasonCode: 'SERVER_RESTARTING',
      drainTimeoutMs: 1_000,
      retryAfterMs: 6_000,
    });
    await settle();
    // RED@1：当前实现 GOAWAY 后连接保持 ready
    expect(run.connectionState()).toBe('draining');
    // drain 期新 target 不得发 OPEN（停新 OPEN/round，§6.3 L147）
    run.peer.addTarget({ namespaceId: ns2, localOwner: run.target.localOwner });
    await settle();
    const opensOnFirstWire = framesOfWire(run.wires[0]!).peerToHub.filter(
      (message) => (message as { kind?: string }).kind === 'OPEN_NAMESPACE',
    );
    // RED@2：当前实现 GOAWAY 后仍 ready → addTarget 即发 OPEN（2 帧）
    expect(opensOnFirstWire.length).toBe(1);

    // drain deadline（1000ms）→ 1001；随后按 retryAfterMs + jitter（random=0 → 恰好 6000ms）
    await advanceMs(run, 1_000);
    run.wire.closePeerSide(1001, 'goaway-drain'); // 本地 close 事件同模交付（harness 保真度注记）
    await settle(); // 交付微任务在 t=1000 同刻结算——重连 timer 从实际 close 时刻（t=1000）起算
    await advanceMs(run, 4_000); // t=5000 < 7000
    // RED@3：当前实现忽略 retryAfterMs——close 后随机 jitter（0）立即重拨
    expect(run.dialCount).toBe(1);
    await advanceMs(run, 2_500); // t=7500 ≥ 1000+6000：应已重拨
    expect(run.dialCount).toBe(2);
  });

  it('AC-6/#229：hub.close() 不发 GOAWAY、直接关闭 transport；close 后零接纳', async () => {
    const run = await boot({});
    await run.hub.close();
    await settle();
    expect(run.hubFramesAll('GOAWAY')).toHaveLength(0);
    expect(run.wire.peerSideCloseInfo?.code).toBe(1001);

    // close 后不再接纳：accept → undefined、零分配。
    const wire = makeWire();
    const conn = await (run.hub.accept(wire.hubEnd, { token: TEST_TOKEN }) as unknown);
    expect(conn).toBeUndefined();
    expect(run.hub.connections.length).toBe(0);
  });

  it.each([
    ['resolve', false],
    ['reject', true],
  ] as const)('#229 shutdown barrier：transport 先关闭，close 仍等待已接纳 apply；迟到 %s 零 wire', async (_label, reject) => {
    const run = await boot();
    const gate = deferred();
    const rejections = collectUnhandledRejections();
    try {
      run.hubNode.persistence.saveGate = gate;
      await run.writePeer({ n: 229 });
      await settle();
      const framesBeforeClose = run.frames().hubToPeer.length;

      let closed = false;
      const closing = run.hub.close().then(() => { closed = true; });
      await settle();
      expect(run.wire.hubSideClosed).toBe(true);
      expect(closed).toBe(false);

      run.hubNode.persistence.saveGate = undefined;
      if (reject) gate.reject(new Error('injected-late-save-reject'));
      else gate.resolve();
      await closing;
      await settle();
      expect(run.rootValue('hub', 'n')).toBe(229);
      expect(run.frames().hubToPeer).toHaveLength(framesBeforeClose);
      expect(rejections.events).toEqual([]);
    } finally {
      rejections.dispose();
    }
  });


  it('#229 shutdown cleanup：重复 close 只释放一次 lease 且只关闭一次 session', async () => {
    let sessionCounts: ReadonlyMap<object, number> = new Map();
    const released: number[] = [];
    const run = await boot({
      createHub: (options) => {
        const tested = createHubReplicationForTesting(options);
        sessionCounts = tested.probe.sessionCloseCalls;
        return tested.replication;
      },
      hubRegistryObserver: (event) => {
        if (event.type === 'lease-released') released.push(event.remainingLeases);
      },
    });
    const closing = run.hub.close();
    expect(run.hub.close()).toBe(closing);
    await closing;
    expect(released).toEqual([1]);
    expect([...sessionCounts.values()]).toEqual([1]);
  });

  it('#229 shutdown cleanup：session.close reject 后仍 release lease', async () => {
    let sessionCounts: ReadonlyMap<object, number> = new Map();
    const released: number[] = [];
    const run = await boot({
      createHub: (options) => {
        const tested = createHubReplicationForTesting(options, {
          sessionCloseError: new Error('injected-session-close-reject'),
        });
        sessionCounts = tested.probe.sessionCloseCalls;
        return tested.replication;
      },
      hubRegistryObserver: (event) => {
        if (event.type === 'lease-released') released.push(event.remainingLeases);
      },
    });
    await expect(run.hub.close()).resolves.toBeUndefined();
    expect([...sessionCounts.values()]).toEqual([1]);
    expect(released).toEqual([1]);
  });

  // ─────────────────────── §6.5 A2：SA2 R3 放行后新增锚（a/b/c/d/e） ───────────────────────

  it('A2-a：无 hint GOAWAY → 无条件 draining（CP-1 字面）；drain 期停新 OPEN；普通 backoff 出口重连 ns1/ns2 live', async () => {
    const run = await boot({ random: () => 0, backoff: { baseMs: 50, maxMs: 400, resetAfterMs: 500 } });
    const ns2Fixture = await makeHubNamespace(run.hubNode, { owner: HUB_OWNER });
    const ns2 = ns2Fixture.namespaceId;

    run.injectHub({ kind: 'GOAWAY', reasonCode: 'SERVER_RESTARTING', drainTimeoutMs: 60 }); // 无 retryAfterMs
    await settle();
    // RED@1：当前实现 GOAWAY 后连接保持 ready（无 hint 面不转移）
    expect(run.connectionState()).toBe('draining');
    // drain 期新 target 不得发 OPEN（停新 OPEN 无差别面）
    run.peer.addTarget({ namespaceId: ns2, localOwner: run.target.localOwner });
    await settle();
    const opensOnFirstWire = framesOfWire(run.wires[0]!).peerToHub.filter(
      (message) => kindOf(message) === 'OPEN_NAMESPACE',
    );
    // RED@2：当前实现仍 ready → addTarget 即发 OPEN（2 帧）
    expect(opensOnFirstWire.length).toBe(1);

    // deadline（60ms）→ close(1001) → 无 hint → 普通 full-jitter backoff（random=0 → 0ms）→ 重连
    await advanceMs(run, 60);
    expect(run.wire.peerSideClosed).toBe(true);
    run.wire.closePeerSide(1001, 'goaway-drain');
    await run.waitConnection('backoff');
    await advanceMs(run, 25);
    await run.waitConnection('ready');
    await settleUntil(
      () => run.peer.getNamespaceState(run.nsId) === 'live' && run.peer.getNamespaceState(ns2) === 'live',
      `重连后 ns1/ns2 live（当前 ns1=${String(run.peer.getNamespaceState(run.nsId))} ns2=${String(run.peer.getNamespaceState(ns2))}）`,
    );
    expect(run.dialCount).toBe(2);
    expect(run.peer.getNamespaceState(ns2)).toBe('live');
  });

  it('A2-b：drain 期停新 sync round（CP-2 字面）——变体一本地 ACK_TIMEOUT 触发；变体二入站 RESYNC_REQUIRED', async () => {
    // ── 变体一：本地触发（真正穿过 round 发起点——ACK 丢弃 → 本地 ack-timeout 是窗口内唯一 round 触发源） ──
    const run = await boot({ random: () => 0, timeouts: { ackTimeoutMs: 40 } });
    run.dropNextHubFrame('UPDATE_ACK'); // 先武装：捕获 writePeer 的 ACK（boot 期无 UPDATE_ACK）
    await run.writePeer({ n: 1 });
    await settle();
    const step1Baseline = framesOfWire(run.wires[0]!).peerToHub.filter(
      (message) => kindOf(message) === 'SYNC_STEP1',
    ).length;
    run.injectHub({ kind: 'GOAWAY', reasonCode: 'SERVER_RESTARTING', drainTimeoutMs: 200 });
    await settle();
    // RED@1：当前实现 GOAWAY 后仍 ready
    expect(run.connectionState()).toBe('draining');
    const before = framesOfWire(run.wires[0]!);
    const step1Count = before.peerToHub.filter((message) => kindOf(message) === 'SYNC_STEP1').length;
    const updateCount = before.peerToHub.filter((message) => kindOf(message) === 'UPDATE').length;
    const openCount = before.peerToHub.filter((message) => kindOf(message) === 'OPEN_NAMESPACE').length;
    expect(step1Count).toBe(step1Baseline);
    // 本地 ack-timeout（40ms，< deadline 200ms）→ 恢复链推进至 startRound → 出站 ready 门拦截
    await advanceMs(run, 40);
    await settle();
    const after = framesOfWire(run.wires[0]!);
    // RED@2：当前实现（ready 态）恢复链照发新 Step1 → 计数 +1
    expect(after.peerToHub.filter((message) => kindOf(message) === 'SYNC_STEP1').length).toBe(step1Count);
    expect(after.peerToHub.filter((message) => kindOf(message) === 'UPDATE').length).toBe(updateCount);
    expect(after.peerToHub.filter((message) => kindOf(message) === 'OPEN_NAMESPACE').length).toBe(openCount);

    // 收尾：deadline 后重连 → 新连接新 round 恢复增长 + 数据收敛
    await advanceMs(run, 160);
    run.wire.closePeerSide(1001, 'goaway-drain');
    await run.waitConnection('backoff');
    await advanceMs(run, 25);
    await run.waitConnection('ready');
    await run.waitNamespace('live');
    const totalStep1 = run.wires.reduce(
      (sum, w) => sum + framesOfWire(w).peerToHub.filter((message) => kindOf(message) === 'SYNC_STEP1').length,
      0,
    );
    expect(totalStep1).toBeGreaterThan(step1Count);
    expect(run.rootValue('hub', 'n')).toBe(1); // writePeer 的 n:1 经 reconcile 收敛到 hub

    // ── 变体二：入站触发（入站状态门：draining 态解码前丢帧——控制器零扰动） ──
    const run2 = await boot({ random: () => 0 });
    run2.injectHub({ kind: 'GOAWAY', reasonCode: 'SERVER_RESTARTING', drainTimeoutMs: 200 });
    await settle();
    const step1Before2 = framesOfWire(run2.wires[0]!).peerToHub.filter(
      (message) => kindOf(message) === 'SYNC_STEP1',
    ).length;
    run2.injectHub({ kind: 'RESYNC_REQUIRED', namespaceId: run2.nsId, reasonCode: 'send-queue-overflow' });
    await settle();
    // GOAWAY 轻量静默已把 namespace 投影为 disconnected；draining 态丢弃 RESYNC。
    expect(run2.peer.getNamespaceState(run2.nsId)).toBe('disconnected');
    expect(
      framesOfWire(run2.wires[0]!).peerToHub.filter((message) => kindOf(message) === 'SYNC_STEP1').length,
    ).toBe(step1Before2);

    // 收尾（变体二）：deadline → 重连 → live
    await advanceMs(run2, 200);
    run2.wire.closePeerSide(1001, 'goaway-drain');
    await run2.waitConnection('backoff');
    await advanceMs(run2, 25);
    await run2.waitConnection('ready');
    await run2.waitNamespace('live');
  });

  it('A2-c：draining 期 close-code 分类（SA2 A1 修复锚）——1002/1008 → blocked 零重拨；反向对照 1001 → backoff', async () => {
    // 主：drain 窗口内 1002 关闭 → 永久失败 blocking（不得降格 backoff 无限重连）
    const run = await boot({ random: () => 0 });
    run.injectHub({ kind: 'GOAWAY', reasonCode: 'SERVER_RESTARTING', drainTimeoutMs: 5_000 });
    await settle();
    // RED@1：当前实现 GOAWAY 后仍 ready（draining 前因不存在——本锚的预设状态）
    expect(run.connectionState()).toBe('draining');
    run.wire.closePeerSide(1002, 'protocol-error');
    await settle();
    // RED@2（实现后防线）：draining 期 close-code 分类——1002 不得走 onGoawayClosed→backoff
    expect(run.connectionState()).toBe('blocked');
    const frozenA = run.wires[0]!.peerToHub.length + run.wires[0]!.hubToPeer.length;
    // 推进越过原 drain deadline + 大步：blocked 零重拨、零 stale drain-close 副作用
    await advanceMs(run, 5_000 + 60_000);
    expect(run.dialCount).toBe(1);
    expect(run.wires[0]!.peerToHub.length + run.wires[0]!.hubToPeer.length).toBe(frozenA);
    expect(run.peer.getConnectionState()).toBe('blocked');

    // 变体：1008 同断言
    const run1008 = await boot({ random: () => 0 });
    run1008.injectHub({ kind: 'GOAWAY', reasonCode: 'SERVER_RESTARTING', drainTimeoutMs: 5_000 });
    await settle();
    expect(run1008.connectionState()).toBe('draining');
    run1008.wire.closePeerSide(1008, 'policy-violation');
    await settle();
    expect(run1008.connectionState()).toBe('blocked');
    await advanceMs(run1008, 5_000 + 60_000);
    expect(run1008.dialCount).toBe(1);

    // 反向对照：drain 窗口内 1001 关闭 → 普通 backoff（钉死 1001/1011 路由不被修复波及）
    const run1001 = await boot({ random: () => 0 });
    run1001.injectHub({ kind: 'GOAWAY', reasonCode: 'SERVER_RESTARTING', drainTimeoutMs: 5_000 });
    await settle();
    expect(run1001.connectionState()).toBe('draining');
    run1001.wire.closePeerSide(1001, 'goaway-drain');
    await settle();
    expect(run1001.connectionState()).toBe('backoff');
    await advanceMs(run1001, 25);
    await run1001.waitConnection('ready');
    expect(run1001.dialCount).toBe(2);
  });

  it('A2-d：认证期早到帧预算（SA2 A2 修复锚）——17 帧条数界 / 单帧超界 / 边界内恰 1 HELLO / 认证超时封顶（hub scheduler）', async () => {
    // 主：deferred verifier（挂起认证窗口）；1 HELLO + 16 垃圾 → 第 17 帧触发条数界（1008）
    const gate = deferred();
    const { hub } = await makeAuthHub({
      verifyToken: async () => {
        await gate.promise;
        return { ok: true as const, instanceId: PEER_INSTANCE };
      },
    });
    const wire = makeWire();
    const p = (hub.accept(wire.hubEnd, { token: TEST_TOKEN }) as unknown) as Promise<unknown>;
    wire.peerEnd.send(
      encodeMessage(
        {
          kind: 'HELLO',
          peerInstanceId: PEER_INSTANCE,
          expectedHubInstanceId: HUB_INSTANCE,
          protocolVersions: [1],
          requiredCapabilities: 0,
          optionalCapabilities: 0,
          connectionNonce: new Uint8Array(16).fill(3),
        },
        { sequence: 1 },
      ),
    );
    for (let i = 0; i < 16; i += 1) wire.peerEnd.send(new Uint8Array(64).fill(i));
    await settle();
    // RED@1：当前实现无早到预算——accept 同步分配、连接存在
    expect(wire.hubSideClosed).toBe(true);
    expect(hub.connections.length).toBe(0);
    gate.resolve();
    await settle();
    expect(await p).toBeUndefined(); // 迟归不复活（预算已拒 → 验证器归也 undefined）
    expect(hub.connections.length).toBe(0);

    // 单帧超界变体（> maxFrameBytes → 1009 路径）
    const { hub: hubOver } = await makeAuthHub();
    const wireOver = makeWire();
    const pOver = (hubOver.accept(wireOver.hubEnd, { token: TEST_TOKEN }) as unknown) as Promise<unknown>;
    wireOver.peerEnd.send(new Uint8Array(CONTRACT_LIMITS.maxFrameBytes + 1));
    await settle();
    expect(wireOver.hubSideClosed).toBe(true);
    expect(hubOver.connections.length).toBe(0);
    expect(await pOver).toBeUndefined();

    // 边界内防回归：恰 1 帧 HELLO → 正常分配 + HELLO_ACK 恰 1 + 零 SEQUENCE_VIOLATION（恰一次投递不变量）
    const { hub: hubIn } = await makeAuthHub();
    const wireIn = makeWire();
    const pIn = (hubIn.accept(wireIn.hubEnd, { token: TEST_TOKEN }) as unknown) as Promise<unknown>;
    wireIn.peerEnd.send(
      encodeMessage(
        {
          kind: 'HELLO',
          peerInstanceId: PEER_INSTANCE,
          expectedHubInstanceId: HUB_INSTANCE,
          protocolVersions: [1],
          requiredCapabilities: 0,
          optionalCapabilities: 0,
          connectionNonce: new Uint8Array(16).fill(4),
        },
        { sequence: 1 },
      ),
    );
    const connIn = await pIn;
    expect(connIn).toBeDefined();
    expect(hubIn.connections.length).toBe(1);
    await settle();
    const framesIn = framesOfWire(wireIn);
    expect(framesIn.hubToPeer.filter((message) => kindOf(message) === 'HELLO_ACK').length).toBe(1);
    expect(framesIn.hubToPeer.filter((message) => isError(message, 'SEQUENCE_VIOLATION'))).toEqual([]);

    // 认证超时封顶：verifier 永不 settle → 推进 hub scheduler（auth timer 挂在 hub 侧——
    // N3 修正：advanceMs 推进的是 peer scheduler，本场景必须 node.scheduler.advanceBy）
    const { hub: hubT, node: nodeT } = await makeAuthHub({
      verifyToken: () => new Promise<never>(() => undefined),
    });
    const wireT = makeWire();
    const pT = (hubT.accept(wireT.hubEnd, { token: TEST_TOKEN }) as unknown) as Promise<unknown>;
    await nodeT.scheduler.advanceBy(CONTRACT_TIMEOUTS.helloTimeoutMs);
    await settle();
    expect(wireT.hubSideClosed).toBe(true);
    expect(hubT.connections.length).toBe(0);
    void pT; // 超时路径在验证器未归时 accept 仍 pending——只断言副作用（设计 §6.5 A2-d 超时变体）
  });

  it('trusted Upgrade identity preserves synchronously replayed HELLO during admission', async () => {
    const hello = encodeMessage(
      {
        kind: 'HELLO',
        peerInstanceId: PEER_INSTANCE,
        expectedHubInstanceId: HUB_INSTANCE,
        protocolVersions: [1],
        requiredCapabilities: 0,
        optionalCapabilities: 0,
        connectionNonce: new Uint8Array(16).fill(7),
      },
      { sequence: 1 },
    );
    const replay = makeReplayTransport([hello]);
    const { hub } = await makeAuthHub();

    expect(hub.acceptTrusted).toBeTypeOf('function');
    const connection = await hub.acceptTrusted!(replay.transport, { peerInstanceId: PEER_INSTANCE });
    expect(connection).toBeDefined();
    expect(replay.replayedCount()).toBe(2);
    expect(connection?.state).toBe('closed');
  });

  it('A2-e：同步重放型 transport 注册期拒绝（SA2 R2 N1 必修锚）——accept 恒 resolve、重放零流产', async () => {
    const probe = collectUnhandledRejections();
    try {
      // 主：预置 1 帧 > maxFrameBytes → 单帧界拒绝（1009）
      const replay = makeReplayTransport([new Uint8Array(CONTRACT_LIMITS.maxFrameBytes + 1)]);
      const { hub } = await makeAuthHub();
      const p = (hub.accept(replay.transport, { token: TEST_TOKEN }) as unknown) as Promise<unknown>;
      // RED@1：当前实现 accept 同步分配返回连接对象（非 undefined）——断言失败即红
      await expect(p).resolves.toBeUndefined();
      expect(hub.connections.length).toBe(0);
      expect(replay.closeInfos()).toEqual([{ code: 1009, reason: 'upgrade-frame-limit' }]);
      expect(replay.replayedCount()).toBe(1); // 重放循环零流产

      // 变体：17 帧正常尺寸积压 → 条数界（1008）
      const replay2 = makeReplayTransport(
        Array.from({ length: 17 }, (_, i) => new Uint8Array(32).fill(i)),
      );
      const { hub: hub2 } = await makeAuthHub();
      const p2 = (hub2.accept(replay2.transport, { token: TEST_TOKEN }) as unknown) as Promise<unknown>;
      await expect(p2).resolves.toBeUndefined();
      expect(hub2.connections.length).toBe(0);
      expect(replay2.closeInfos()).toEqual([{ code: 1008, reason: 'upgrade-frame-limit' }]);
      expect(replay2.replayedCount()).toBe(17);
    } finally {
      probe.dispose();
    }
    expect(probe.events).toEqual([]);
  });
});
