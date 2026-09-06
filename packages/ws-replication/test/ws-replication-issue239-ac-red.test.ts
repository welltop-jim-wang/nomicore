/**
 * issue #239 红灯验收契约（acceptance-contract，生产修复前必须失败）。
 *
 * 契约对象：periodic reconciliation 的「语义 no-op round」与「有效同步（changed）
 * round」必须在 §23 observer 观察面上可区分——这是 SA5 复现（ws-replication-
 * issue239-repro.test.ts）证明缺失的能力：
 *
 *   - 已收敛副本的 periodic round：Step2 编码结构性非零（bytes > 0 恒真），但
 *     apply 不推进任何副本 state vector——观察面必须明确报告 no-op；
 *   - 静默漂移修复 round：至少一侧 apply 推进 state vector——观察面必须明确报告
 *     changed，且 round 完成后双侧 state vector 收敛一致；
 *   - sent/applied 必须以 round 内一致的关联字段（syncRoundId，wire §9.1–9.3
 *     既有事实的观测投影）可靠关联；
 *   - `bytes` 语义冻结（GA 后字段不可 rename/删除/重解释）——长度澄清以
 *     append-only 新字段 `encodedUpdateBytes`（=== bytes）满足（SA8 注记 2）。
 *
 * 生产修复前（现行 §23 事件只含 bytes）本文件断言的红灯：
 *   - `sync-step2-sent` / `sync-diff-applied` 缺 `syncRoundId`、`encodedUpdateBytes`；
 *   - `sync-diff-applied` 缺 `stateVectorChanged`（boolean）、`applyEffect`
 *     （'changed' | 'noop'，由 before/after state vector 派生，非 byteLength）。
 *
 * 约束合规（SA8 conflict_report / relevant_decisions）：
 *   - wire bytes 零变化：本文件只断言 wire 既有 roundId（SYNC_STEP1 帧）与事件
 *     字段的投影一致性，不新增任何帧/字段断言到 wire 面；
 *   - §9.4/§16 状态机零变化：每轮断言 namespace 回 live、roundId 单调 +1
 *     （守护断言——修复不得改动状态机）；
 *   - state vector 摘要（stateVectorBeforeHash/stateVectorAfterHash）为可选
 *     落地（safe-digest append-only 注册与否留设计裁决）——本文件**不**断言
 *     hash 字段存在，验收走 issue 授权退路：`stateVectorChanged` + round 关联；
 *   - safe-field：全事件树深扫无 `Uint8Array`/`ArrayBuffer`/`DataView`
 *     （raw state vector = Yjs bytes，禁止泄漏；修复后仍必须保持）;
 *   - 不锁死字节数（no-op 9–10 B / 漂移 34–36 B 仅随 Yjs client ID 编码宽度波动）：
 *     只断言 bytes > 0（现状语义）与 encodedUpdateBytes === bytes；
 *   - observer gating / throw 隔离 / 键集冻结白名单属 §23.7 conformance 面
 *     （ws-replication-observer-red.test.ts），实现阶段随 §23 append-only 同步扩展，
 *     不在本文件重复。
 *
 * 漂移注入（测试面受控 seam，与 SA5 复现同构）：persistence stub peek 直接改 hub
 * live Y.Doc（不经 lease/sequencer，不产生业务 UPDATE 路径的写）。直接改 doc 会经
 * SessionFanout（null origin → 全部活跃 channel）排入出向 UPDATE——因此漂移后的
 * **推进时序**是决定性环节：`advanceMs` 内 fake scheduler 的 `advanceBy` 同步触发
 * periodic timer（round 的 Step1/Step2 编码在同一同步段完成，36 B 漂移 diff 实证），
 * hub 的出向 UPDATE 排在其后微任务——peer 先经 round 的 Step2 apply 收到漂移
 * （sync-diff-applied = changed），随后到达的 UPDATE 是重复 no-op。**漂移注入后
 * 不得 await**（await 会让 UPDATE 先于 round 送达、round 变成 no-op），也不得丢
 * UPDATE 帧（信封序列按方向连续——丢帧后下一帧即 SEQUENCE_VIOLATION）。本文件
 * 不要求生产代码暴露 live Y.Doc（ADR-0012 被否决方案）。
 *
 * 红灯运行：pnpm exec vitest run packages/ws-replication/test/ws-replication-issue239-ac-red.test.ts --reporter=verbose
 * 转绿条件（修复落地后本文件不改即绿）：
 *   1. 两 sync 事件类型均携带 syncRoundId（=== wire roundId）与 encodedUpdateBytes；
 *   2. sync-diff-applied 携带 stateVectorChanged/applyEffect，其值与实测
 *      before/after state vector 增量一一对应（no-op round 全 noop；漂移修复
 *      round 至少一侧 changed）。
 */
import { describe, expect, it } from 'vitest';
import type { SyncStep1Msg } from '@nomicore/replication-protocol';
import type { ReplicationObserverEvent } from '@nomicore/ws-replication';
import { advanceMs, boot } from './driver.js';

/** 字节序逐字节相等（state vector 不变性判据）。 */
const bytesEq = (a: Uint8Array, b: Uint8Array): boolean =>
  a.byteLength === b.byteLength && a.every((x, i) => x === b[i]);

/** issue #239 Expected behavior 要求、修复后必达的语义字段（hash 字段可选，不在内）。 */
interface SemanticFields {
  readonly syncRoundId?: number;
  readonly encodedUpdateBytes?: number;
  readonly stateVectorChanged?: boolean;
  readonly applyEffect?: 'changed' | 'noop';
}

const semantic = (e: ReplicationObserverEvent): SemanticFields =>
  e as unknown as SemanticFields;

type SyncEvent = Extract<ReplicationObserverEvent, { type: 'sync-step2-sent' | 'sync-diff-applied' }>;

const SENT = 'sync-step2-sent';
const APPLIED = 'sync-diff-applied';

function roundIds(run: Awaited<ReturnType<typeof boot>>): number[] {
  return run.peerFrames('SYNC_STEP1').map(
    (frame) => (frame.message as SyncStep1Msg).syncRoundId,
  );
}

/** observer 事件记录器（hub/peer 各一；回调内只收集，永不 throw）。 */
function recorder(): Readonly<{
  events: ReplicationObserverEvent[];
  observer: (event: ReplicationObserverEvent) => void;
}> {
  const events: ReplicationObserverEvent[] = [];
  return { events, observer: (event) => { events.push(event); } };
}

/** 事件树 safe-field 深扫：raw state vector / Yjs bytes 禁止形态（§23.3）。 */
function assertEventTreeSafe(events: readonly ReplicationObserverEvent[], label: string): void {
  const visited = new Set<unknown>();
  const walk = (value: unknown, path: string): void => {
    if (value === null || value === undefined || typeof value !== 'object' || visited.has(value)) {
      return;
    }
    if (
      value instanceof Uint8Array ||
      value instanceof ArrayBuffer ||
      value instanceof DataView
    ) {
      throw new Error(`${label}: ${path} 携带二进制原始字节（§23.3 safe-field 违例）`);
    }
    visited.add(value);
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`));
    } else {
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        walk(item, `${path}.${key}`);
      }
    }
  };
  events.forEach((event, index) => walk(event, `${label}[${index}]`));
}

/** 事件字段的数值断言单点：先证在场（红灯锚），再证值。 */
function numberField(e: ReplicationObserverEvent, key: keyof SemanticFields, label: string): number {
  const value = semantic(e)[key];
  expect(
    value,
    `${label} ${e.type}(${e.side}) 缺语义字段 ${key}——红灯：生产修复前不得在场`,
  ).toBeTypeOf('number');
  return value as number;
}

function booleanField(e: ReplicationObserverEvent, key: keyof SemanticFields, label: string): boolean {
  const value = semantic(e)[key];
  expect(
    value,
    `${label} ${e.type}(${e.side}) 缺语义字段 ${key}——红灯：生产修复前不得在场`,
  ).toBeTypeOf('boolean');
  return value as boolean;
}

/** 按 syncRoundId 分组（roundId 缺失的事件先在场断言拦截——不会进入分组）。 */
function groupsOf(events: readonly ReplicationObserverEvent[], label: string): Map<number, SyncEvent[]> {
  const groups = new Map<number, SyncEvent[]>();
  for (const event of events) {
    if (event.type !== SENT && event.type !== APPLIED) continue;
    const roundId = numberField(event, 'syncRoundId', label);
    const list = groups.get(roundId) ?? [];
    list.push(event);
    groups.set(roundId, list);
  }
  return groups;
}

/** 断言：该 round 的事件全量覆盖「每侧出向 ≥1 + 每侧 apply ≥1」且关联/长度字段齐备。 */
function expectRoundShape(group: readonly SyncEvent[], label: string): void {
  const bySide = (type: typeof SENT | typeof APPLIED, side: 'hub' | 'peer'): SyncEvent[] =>
    group.filter((e) => e.type === type && e.side === side);
  expect(bySide(SENT, 'hub').length, `${label}: hub sync-step2-sent 缺事件`).toBeGreaterThanOrEqual(1);
  expect(bySide(SENT, 'peer').length, `${label}: peer sync-step2-sent 缺事件`).toBeGreaterThanOrEqual(1);
  expect(bySide(APPLIED, 'hub').length, `${label}: hub sync-diff-applied 缺事件`).toBeGreaterThanOrEqual(1);
  expect(bySide(APPLIED, 'peer').length, `${label}: peer sync-diff-applied 缺事件`).toBeGreaterThanOrEqual(1);
  for (const event of group) {
    // bytes 语义冻结（GA 后不可重解释）；长度澄清 = append-only encodedUpdateBytes === bytes
    expect(event.bytes).toBeTypeOf('number');
    expect(event.bytes).toBeGreaterThanOrEqual(0);
    expect(numberField(event, 'encodedUpdateBytes', label)).toBe(event.bytes);
  }
}

/** no-op 语义断言：该 round 每一笔 apply 都报告 stateVectorChanged=false / applyEffect='noop'。 */
function expectNoopApplied(group: readonly SyncEvent[], label: string): void {
  for (const event of group) {
    if (event.type !== APPLIED) continue;
    expect(booleanField(event, 'stateVectorChanged', label)).toBe(false);
    expect(semantic(event).applyEffect, `${label} ${event.type}(${event.side}) applyEffect 缺场`).toBe('noop');
  }
}

describe('issue #239 验收契约（红灯）：periodic no-op 与有效同步的可观测性差异', () => {
  it('场景 1：已收敛副本连续 periodic round —— 观察面必须报 roundId 关联 + 全 noop（SV/ROOT/META 不变，bytes 仍非零）', async () => {
    const interval = 100;
    const rounds = 3;
    const hub = recorder();
    const peer = recorder();
    const run = await boot({
      peerReplica: 'same',
      timeouts: { reconcileIntervalMs: interval, ackTimeoutMs: 10_000 },
      hubObserver: hub.observer,
      peerObserver: peer.observer,
    });

    const initialRoundCount = roundIds(run).length;
    expect(initialRoundCount).toBeGreaterThanOrEqual(1);
    const svHub0 = run.stateVectorOf('hub');
    const svPeer0 = run.stateVectorOf('peer');
    expect(bytesEq(svHub0, svPeer0), '起步必须已收敛（SV 相等）').toBe(true);
    const root0 = { hub: run.rootValue('hub', 'n'), peer: run.rootValue('peer', 'n') } as const;
    const meta0 = {
      hub: run.metaValue('hub', 'replicationId'),
      peer: run.metaValue('peer', 'replicationId'),
    } as const;

    for (let round = 1; round <= rounds; round++) {
      await advanceMs(run, interval);
      await run.waitNamespace('live');
      // —— §9.4/§16 状态机守护（修复不得改变）：round 收口回 live、roundId 单调 +1 ——
      expect(run.namespaceState()).toBe('live');
      expect(roundIds(run)).toHaveLength(initialRoundCount + round);
      // —— no-op 事实：round 前后双方 SV 逐字节不变且互等、ROOT/META 不变 ——
      expect(bytesEq(run.stateVectorOf('hub'), svHub0)).toBe(true);
      expect(bytesEq(run.stateVectorOf('peer'), svPeer0)).toBe(true);
      expect(bytesEq(run.stateVectorOf('hub'), run.stateVectorOf('peer'))).toBe(true);
      expect(run.rootValue('hub', 'n')).toBe(root0.hub);
      expect(run.rootValue('peer', 'n')).toBe(root0.peer);
      expect(run.metaValue('hub', 'replicationId')).toBe(meta0.hub);
      expect(run.metaValue('peer', 'replicationId')).toBe(meta0.peer);
    }

    const all = [...hub.events, ...peer.events];
    const label = '[issue239 ac-red] 场景1 no-op';
    // —— safe-field：全事件树（含修复后新增字段）不得泄漏 raw state vector / Yjs bytes ——
    assertEventTreeSafe(all, label);
    // —— 观察面契约（红灯本体）：sent/applied 事件必须带 roundId 关联 + 长度澄清 ——
    const groups = groupsOf(all, label);
    // 事件 round 集合必须与 wire round 集合一一对应（每轮均有事件、无孤儿事件）
    const wireRounds = roundIds(run);
    expect(
      [...groups.keys()].sort((a, b) => a - b),
      `${label}: 事件 roundId 集合必须等于 wire Step1 roundId 集合`,
    ).toEqual(wireRounds);
    for (let i = 1; i < wireRounds.length; i++) {
      expect(wireRounds[i]!).toBeGreaterThan(wireRounds[i - 1]!);
    }
    // —— 周期性 round（初始 reconcile 之后的 rounds 轮）必须是可观测的 no-op ——
    const periodicGroups = [...groups.values()].slice(-rounds);
    for (const group of periodicGroups) {
      expectRoundShape(group, label);
      const minBytes = Math.min(...group.map((e) => e.bytes));
      expect(minBytes, `${label}: no-op round bytes 结构性非零（Yjs 空 diff 非规范零长）`).toBeGreaterThan(0);
      expectNoopApplied(group, label);
    }
    console.log(`[issue239 ac-red] no-op rounds=${rounds} groups=${groups.size} periodicGroups=${periodicGroups.length} 全部断言完成`);
  }, 20_000);

  it('场景 2：hub 静默漂移 → 下一 periodic round 至少一侧 diff-applied 报 changed（与实测 SV 增量一致）并收敛', async () => {
    const interval = 100;
    const hub = recorder();
    const peer = recorder();
    const run = await boot({
      peerReplica: 'same',
      timeouts: { reconcileIntervalMs: interval, ackTimeoutMs: 10_000 },
      hubObserver: hub.observer,
      peerObserver: peer.observer,
    });
    const wireRoundsBefore = roundIds(run);

    // 静默漂移：直接改 hub live Y.Doc（受控 seam）。漂移后不得 await、不得丢帧——
    // 见文件头注记：periodic timer 的 advanceBy 同步先于 hub 出向 UPDATE 微任务，
    // 下一 round 的 Step2 携带漂移（sync 路径修复）；await 则 UPDATE 先送达、round
    // 变 no-op，丢帧则信封序列断裂 → SEQUENCE_VIOLATION。
    const hubDoc = run.hubNode.persistence.peek(run.hubFixture!.lease.owner, run.nsId)!;
    hubDoc.getMap('ROOT').set('n', 99);
    expect(run.rootValue('peer', 'n'), '漂移后 peer 不得立即看到 99（静默）').not.toBe(99);
    const svHubPre = run.stateVectorOf('hub');
    const svPeerPre = run.stateVectorOf('peer');
    expect(bytesEq(svHubPre, svPeerPre), '漂移后双侧 SV 必须分歧').toBe(false);

    await advanceMs(run, interval);
    await run.waitNamespace('live');
    // —— 状态机守护 + 收敛事实 ——
    expect(run.namespaceState()).toBe('live');
    expect(roundIds(run)).toHaveLength(wireRoundsBefore.length + 1);
    expect(run.rootValue('peer', 'n')).toBe(99);
    expect(bytesEq(run.stateVectorOf('hub'), run.stateVectorOf('peer')), '修复后双侧 SV 必须收敛').toBe(true);

    // 每侧 round 级 SV 增量（受控场景：round 内无其他写 ⇒ apply 效果 == round 增量）
    const svHubPost = run.stateVectorOf('hub');
    const svPeerPost = run.stateVectorOf('peer');
    const delta = {
      hub: !bytesEq(svHubPre, svHubPost),
      peer: !bytesEq(svPeerPre, svPeerPost),
    } as const;
    expect(delta.hub, 'hub 侧（漂移源）apply peer 空 diff 后 SV 不得推进').toBe(false);
    expect(delta.peer, 'peer 侧（漂移接收方）apply 后 SV 必须推进').toBe(true);

    const all = [...hub.events, ...peer.events];
    const label = '[issue239 ac-red] 场景2 hub-drift';
    assertEventTreeSafe(all, label);
    const groups = groupsOf(all, label);
    const repairGroup = groups.get(roundIds(run).at(-1)!);
    expect(repairGroup, `${label}: 修复 round 缺事件组`).toBeDefined();
    expectRoundShape(repairGroup!, label);
    // —— 观察面契约（红灯本体）：每侧 diff-applied 的效果必须与实测 SV 增量一一对应 ——
    let changedCount = 0;
    for (const event of repairGroup!) {
      if (event.type !== APPLIED) continue;
      const side = event.side;
      const reported = booleanField(event, 'stateVectorChanged', label);
      expect(reported, `${label}: ${side} diff-applied 的 stateVectorChanged 必须等于实测增量 ${delta[side]}`).toBe(delta[side]);
      const effect = semantic(event).applyEffect;
      expect(effect, `${label}: ${side} diff-applied 缺 applyEffect`).toBe(delta[side] ? 'changed' : 'noop');
      if (reported) changedCount += 1;
    }
    expect(changedCount, `${label}: 修复 round 至少一侧必须报告 changed（与 no-op round 可区分）`).toBeGreaterThanOrEqual(1);
    console.log(`[issue239 ac-red] hub-drift 修复 round：delta=${JSON.stringify(delta)} changedEvents=${changedCount}`);

    // —— 修复后的下一 periodic round 必须重新报告 noop（信号逐 round 正确、非粘滞）——
    await advanceMs(run, interval);
    await run.waitNamespace('live');
    expect(run.namespaceState()).toBe('live');
    expect(roundIds(run)).toHaveLength(wireRoundsBefore.length + 2);
    expect(bytesEq(run.stateVectorOf('hub'), run.stateVectorOf('peer')), '修复后后续 round 必须保持收敛').toBe(true);
    const followGroups = groupsOf([...hub.events, ...peer.events], label);
    const followGroup = followGroups.get(roundIds(run).at(-1)!);
    expect(followGroup, `${label}: 修复后 no-op round 缺事件组`).toBeDefined();
    expectRoundShape(followGroup!, label);
    let followChanged = 0;
    for (const event of followGroup!) {
      if (event.type !== APPLIED) continue;
      expect(booleanField(event, 'stateVectorChanged', label), `${label}: 收敛后 round 必须全 noop`).toBe(false);
      if (semantic(event).applyEffect === 'changed') followChanged += 1;
    }
    expect(followChanged, `${label}: 收敛后 round 不得出现 changed`).toBe(0);
    console.log(`[issue239 ac-red] hub-drift 修复后 no-op round：changedEvents=${followChanged}`);
  }, 20_000);
});
