/**
 * issue #239 复现测试（SA5 版）——已按设计 §6 T3（failure_analysis §3.3 预告）翻转：
 * 修复前它是「缺陷在场的正向证明」（断言现状只报 bytes、无语义字段）；修复落地后
 * （§23 append-only：sync-step2-sent/sync-diff-applied 追加 syncRoundId /
 * encodedUpdateBytes + 效果字段组 stateVectorChanged/applyEffect/hash）同一观测面必须
 * 能回答「periodic round 是否语义 no-op」——本文件断言翻转后的修复后语义：
 *
 * 场景 1（已收敛副本 periodic no-op）：boot 后 7 轮 periodic round，每轮 namespace 回
 *   live、双方 state vector / ROOT / META 逐字节不变；双方每轮仍发非零 bytes 的
 *   step2-sent / diff-applied，但全部 sync 事件携带 syncRoundId（> 0、集合 === wire
 *   Step1 roundId 集合）与 encodedUpdateBytes === bytes；效果字段组单命运且组内一致；
 *   7 轮 periodic round 全部 sync-diff-applied 报告 stateVectorChanged=false /
 *   applyEffect='noop'（效果组在场时 stateVectorBeforeHash === stateVectorAfterHash，
 *   16 位小写 hex）。注：初始 reconcile round（绝对 round 1）会把 import 期 peer 本地
 *   写收编为 hub 侧 changed（实证 26 B 真实收敛）——冻结契约与本节 noop 断言同款
 *   只约束 periodic 组；窗口语义如实投影（观测投影非因果归因）。
 * 场景 2（静默漂移修复 round）：Hub live Y.Doc 静默漂移（受控测试 seam，
 *   不产生普通 UPDATE 帧），下一轮 periodic round 修复 Peer 并收敛（changed round）——
 *   修复 round 内 peer 侧 diff-applied 报 changed（before ≠ after hash）、hub 侧报
 *   noop（与实测 round 级 SV 增量一一对应）；修复后下一 periodic round 回到全 noop
 *   （信号逐 round 正确、非粘滞）。
 *
 * 运行：pnpm exec vitest run packages/ws-replication/test/ws-replication-issue239-repro.test.ts --reporter=verbose
 */
import { describe, expect, it } from 'vitest';
import type { SyncStep1Msg } from '@nomicore/replication-protocol';
import type { ReplicationObserverEvent } from '@nomicore/ws-replication';
import { advanceMs, boot } from './driver.js';

/** 字节序逐字节相等（state vector 不变性判据）。 */
const bytesEq = (a: Uint8Array, b: Uint8Array): boolean =>
  a.byteLength === b.byteLength && a.every((x, i) => x === b[i]);

/** 16 位小写 hex（documented safe digest 文法，§23.3 注册）。 */
const HASH_RE = /^[0-9a-f]{16}$/;

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

/** 事件切片中指定类型的 bytes 列表（类型收窄单点）。 */
function bytesOf(
  events: readonly ReplicationObserverEvent[],
  type: 'sync-step2-sent' | 'sync-diff-applied',
): number[] {
  return events.flatMap((e) => (e.type === type ? [e.bytes] : []));
}

/** 事件字段键集快照（形状证据：区分度的唯一观测面）。 */
function keySetsOf(
  events: readonly ReplicationObserverEvent[],
): string[] {
  return events.map((e) => Object.keys(e).sort().join(','));
}

type SyncEvent = Extract<
  ReplicationObserverEvent,
  { type: 'sync-step2-sent' | 'sync-diff-applied' }
>;

/** issue #239 修复后必达语义字段（翻转断言面；hash 文法 = §23.3 documented digest）。 */
interface SemanticFields {
  readonly syncRoundId?: number;
  readonly encodedUpdateBytes?: number;
  readonly stateVectorChanged?: boolean;
  readonly applyEffect?: 'changed' | 'noop';
  readonly stateVectorBeforeHash?: string;
  readonly stateVectorAfterHash?: string;
}

const semantic = (e: ReplicationObserverEvent): SemanticFields =>
  e as unknown as SemanticFields;

const isSync = (e: ReplicationObserverEvent): e is SyncEvent =>
  e.type === 'sync-step2-sent' || e.type === 'sync-diff-applied';

/** 断言切片内全部 sync 事件：roundId 关联 + 长度澄清 + noop 效果组（含 hash 文法）。 */
function expectNoopObservability(
  events: readonly ReplicationObserverEvent[],
  label: string,
): void {
  for (const event of events) {
    if (!isSync(event)) continue;
    const s = semantic(event);
    expect(s.syncRoundId, `${label}: ${event.type}(${event.side}) 缺 syncRoundId`).toBeTypeOf('number');
    expect(s.syncRoundId! > 0, `${label}: ${event.type} syncRoundId 必须 > 0`).toBe(true);
    expect(s.encodedUpdateBytes, `${label}: ${event.type}(${event.side}) 缺 encodedUpdateBytes`).toBeTypeOf('number');
    expect(s.encodedUpdateBytes, `${label}: encodedUpdateBytes 必须 === bytes`).toBe(event.bytes);
    if (event.type !== 'sync-diff-applied') continue;
    expect(s.stateVectorChanged, `${label}: ${event.type}(${event.side}) 缺 stateVectorChanged`).toBe(false);
    expect(s.applyEffect, `${label}: ${event.type}(${event.side}) applyEffect 缺场`).toBe('noop');
    // 受控场景：捕获必成功 → 效果组（含 hash）必在场；noop ⇒ before === after
    const beforeHash = s.stateVectorBeforeHash;
    const afterHash = s.stateVectorAfterHash;
    expect(beforeHash, `${label}: ${event.type}(${event.side}) 缺 beforeHash`).toBeTypeOf('string');
    expect(afterHash, `${label}: ${event.type}(${event.side}) 缺 afterHash`).toBeTypeOf('string');
    expect(beforeHash!).toMatch(HASH_RE);
    expect(afterHash!).toMatch(HASH_RE);
    expect(beforeHash).toBe(afterHash);
  }
}

/** 断言切片内指定侧每笔 diff-applied 的效果与实测 round 级 SV 增量一一对应。 */
function expectSideDelta(
  events: readonly ReplicationObserverEvent[],
  side: 'hub' | 'peer',
  expectedChanged: boolean,
  label: string,
): void {
  let applied = 0;
  for (const event of events) {
    if (event.type !== 'sync-diff-applied' || event.side !== side) continue;
    applied += 1;
    const s = semantic(event);
    expect(s.stateVectorChanged, `${label}: ${side} diff-applied 缺 stateVectorChanged`).toBe(expectedChanged);
    expect(s.applyEffect, `${label}: ${side} diff-applied 缺 applyEffect`).toBe(
      expectedChanged ? 'changed' : 'noop',
    );
    const beforeHash = s.stateVectorBeforeHash;
    const afterHash = s.stateVectorAfterHash;
    expect(beforeHash, `${label}: ${side} 缺 beforeHash`).toBeTypeOf('string');
    expect(afterHash, `${label}: ${side} 缺 afterHash`).toBeTypeOf('string');
    expect(beforeHash!).toMatch(HASH_RE);
    expect(afterHash!).toMatch(HASH_RE);
    if (expectedChanged) {
      expect(beforeHash).not.toBe(afterHash);
    } else {
      expect(beforeHash).toBe(afterHash);
    }
  }
  expect(applied, `${label}: ${side} diff-applied 事件缺失`).toBeGreaterThanOrEqual(1);
}

describe('issue #239：periodic reconciliation 语义 no-op 可观测（修复后语义，翻转断言）', () => {
  it('场景 1：已收敛副本 7 轮 periodic round —— bytes 恒非零但观察面明确报全 noop（roundId 关联 + 效果组）', async () => {
    const interval = 100;
    const hub = recorder();
    const peer = recorder();
    const run = await boot({
      peerReplica: 'same',
      timeouts: { reconcileIntervalMs: interval },
      hubObserver: hub.observer,
      peerObserver: peer.observer,
    });

    const initialRounds = roundIds(run).length;
    const hubSv0 = run.stateVectorOf('hub');
    const peerSv0 = run.stateVectorOf('peer');
    // 起步即完全相同的副本（初始 reconcile 已收敛）
    expect(bytesEq(hubSv0, peerSv0)).toBe(true);

    const rootBefore = {
      hub: run.rootValue('hub', 'n'),
      peer: run.rootValue('peer', 'n'),
    } as const;
    const metaBefore = {
      hub: run.metaValue('hub', 'replicationId'),
      peer: run.metaValue('peer', 'replicationId'),
    } as const;

    for (let round = 1; round <= 7; round++) {
      const hubFrom = hub.events.length;
      const peerFrom = peer.events.length;

      await advanceMs(run, interval);
      await run.waitNamespace('live');

      // (1) 周期 round 确实发生且收口：roundId 单调 +1、namespace 回 live
      expect(run.namespaceState()).toBe('live');
      expect(roundIds(run)).toHaveLength(initialRounds + round);

      // (2) 双方 state vector round 前后逐字节不变（语义 no-op），且彼此相等
      expect(bytesEq(run.stateVectorOf('hub'), hubSv0)).toBe(true);
      expect(bytesEq(run.stateVectorOf('peer'), peerSv0)).toBe(true);
      expect(bytesEq(run.stateVectorOf('hub'), run.stateVectorOf('peer'))).toBe(true);

      // (3) ROOT / META 不变
      expect(run.rootValue('hub', 'n')).toBe(rootBefore.hub);
      expect(run.rootValue('peer', 'n')).toBe(rootBefore.peer);
      expect(run.metaValue('hub', 'replicationId')).toBe(metaBefore.hub);
      expect(run.metaValue('peer', 'replicationId')).toBe(metaBefore.peer);

      // (4) no-op round 的 wire/事件事实：双方仍各发非零 bytes 的 step2-sent 与
      //     diff-applied（Yjs 空 diff 编码结构性非零——bytes > 0 不锁具体字节数）
      const hubSent = bytesOf(hub.events.slice(hubFrom), 'sync-step2-sent');
      const hubApplied = bytesOf(hub.events.slice(hubFrom), 'sync-diff-applied');
      const peerSent = bytesOf(peer.events.slice(peerFrom), 'sync-step2-sent');
      const peerApplied = bytesOf(peer.events.slice(peerFrom), 'sync-diff-applied');
      expect(hubSent.length).toBeGreaterThanOrEqual(1);
      expect(hubApplied.length).toBeGreaterThanOrEqual(1);
      expect(peerSent.length).toBeGreaterThanOrEqual(1);
      expect(peerApplied.length).toBeGreaterThanOrEqual(1);
      expect(Math.min(...hubSent, ...peerSent)).toBeGreaterThan(0);
      expect(Math.min(...hubApplied, ...peerApplied)).toBeGreaterThan(0);
      // (4b) 翻转：该轮 no-op 必须是可观测的（逐轮语义断言——非粘滞、逐 round 正确）
      expectNoopObservability(
        [...hub.events.slice(hubFrom), ...peer.events.slice(peerFrom)],
        `[issue239 repro] no-op round ${round}`,
      );
      console.log(
        `[issue239 repro] no-op round ${round}: ` +
        `hub sent/applied = ${JSON.stringify(hubSent)}/${JSON.stringify(hubApplied)} B, ` +
        `peer sent/applied = ${JSON.stringify(peerSent)}/${JSON.stringify(peerApplied)} B`,
      );
    }

    // (5) 翻转（failure_analysis §3.3 预告 / 设计 §6 T3.1）：全部 sync 事件（含初始
    //     reconcile 段）携带 syncRoundId（> 0、∈ wire Step1 roundId 集合）与
    //     encodedUpdateBytes === bytes；效果字段组单命运 + 组内一致性（hash 文法、
    //     stateVectorChanged ⟺ beforeHash ≠ afterHash、applyEffect ⟺
    //     stateVectorChanged）。「bytes > 0 ∧ applyEffect='noop'」即健康 periodic
    //     no-op round 的可观测形态——语义 noop 断言作用于 boot 后的 7 轮 periodic
    //     round（(4b) 逐轮 + 本处 periodic 复核）。初始 reconcile round（绝对 round 1）
    //     可能把 import 期 peer 本地写收编为 hub 侧 changed（实证 26 B：真实收敛，
    //     非 periodic no-op——窗口语义如实投影，SA2 注记 2「观测投影非因果归因」实例；
    //     冻结契约 expectNoopApplied 同款只约束 periodic 组）。
    const all = [...hub.events, ...peer.events];
    expect(all.length).toBeGreaterThan(0);
    const wireRounds = roundIds(run);
    for (const event of all) {
      if (!isSync(event)) continue;
      const s = semantic(event);
      expect(s.syncRoundId, `[issue239 repro] ${event.type}(${event.side}) 缺 syncRoundId`).toBeTypeOf('number');
      expect(s.syncRoundId! > 0, `[issue239 repro] ${event.type} syncRoundId 必须 > 0`).toBe(true);
      expect(
        wireRounds.includes(s.syncRoundId!),
        `[issue239 repro] ${event.type}(${event.side}) roundId ${String(s.syncRoundId)} 不在 wire Step1 集合`,
      ).toBe(true);
      expect(s.encodedUpdateBytes, `[issue239 repro] ${event.type}(${event.side}) 缺 encodedUpdateBytes`).toBeTypeOf('number');
      expect(s.encodedUpdateBytes, `[issue239 repro] encodedUpdateBytes 必须 === bytes`).toBe(event.bytes);
      if (event.type !== 'sync-diff-applied') continue;
      const groupKeys = [
        'stateVectorChanged',
        'applyEffect',
        'stateVectorBeforeHash',
        'stateVectorAfterHash',
      ] as const;
      const present = groupKeys.filter((k) => Object.prototype.hasOwnProperty.call(event, k));
      expect(
        present.length === 0 || present.length === groupKeys.length,
        `[issue239 repro] ${event.type}(${event.side}) 效果字段组单命运违例（出现 ${present.join(',')}）`,
      ).toBe(true);
      if (present.length === groupKeys.length) {
        const g = s as unknown as {
          readonly stateVectorChanged: boolean;
          readonly applyEffect: 'changed' | 'noop';
          readonly stateVectorBeforeHash: string;
          readonly stateVectorAfterHash: string;
        };
        expect(g.stateVectorBeforeHash).toMatch(HASH_RE);
        expect(g.stateVectorAfterHash).toMatch(HASH_RE);
        expect(g.stateVectorChanged).toBe(g.stateVectorBeforeHash !== g.stateVectorAfterHash);
        expect(g.applyEffect).toBe(g.stateVectorChanged ? 'changed' : 'noop');
      }
    }
    // 集合相等：事件 roundId 集合 === wire Step1 roundId 集合（每轮均有事件、无孤儿事件）
    const syncRounds = [
      ...new Set(all.filter(isSync).map((e) => semantic(e).syncRoundId!)),
    ].sort((a, b) => a - b);
    expect(syncRounds, '[issue239 repro] syncRoundId 集合必须等于 wire Step1 集合').toEqual(
      wireRounds,
    );
    // boot 后的 7 轮 periodic round 全 noop（与 (4b) 同口径的末段复核）
    const periodicAll = all.filter(
      (e) => isSync(e) && semantic(e).syncRoundId! > wireRounds[0]!,
    );
    expect(periodicAll.length).toBeGreaterThan(0);
    expectNoopObservability(periodicAll, '[issue239 repro] 场景1 periodic rounds 全事件');
    console.log(
      `[issue239 repro] no-op 事件字段形状（去重）: ${JSON.stringify([...new Set(keySetsOf(all))])}`,
    );
  }, 20_000);

  it('场景 2：静默漂移修复 round —— 观察面必须报 changed（与实测 SV 增量一一对应）；修复后 next round 回 noop（非粘滞）', async () => {
    const interval = 100;
    const hub = recorder();
    const peer = recorder();
    const run = await boot({
      peerReplica: 'same',
      timeouts: { reconcileIntervalMs: interval, ackTimeoutMs: 10_000 },
      hubObserver: hub.observer,
      peerObserver: peer.observer,
    });

    const roundsBefore = roundIds(run).length;
    const hubSvConverged = run.stateVectorOf('hub');

    // 静默漂移：直接改 hub live Y.Doc（受控测试 seam：persistence stub peek），
    // 模拟回声抑制链路外未产生普通 UPDATE 帧的本地副本漂移。
    const hubDoc = run.hubNode.persistence.peek(run.hubFixture!.lease.owner, run.nsId)!;
    hubDoc.getMap('ROOT').set('n', 99);
    expect(run.rootValue('peer', 'n')).not.toBe(99);

    // round 前采样：peer 仍停在收敛态、hub 已含漂移 op
    const peerSvPre = run.stateVectorOf('peer');
    const hubSvPre = run.stateVectorOf('hub');
    expect(bytesEq(hubSvPre, hubSvConverged)).toBe(false);

    const hubFrom = hub.events.length;
    const peerFrom = peer.events.length;
    await advanceMs(run, interval);
    await run.waitNamespace('live');

    // (1) 修复成功且收敛：peer ROOT n=99，roundId +1，回 live
    expect(run.rootValue('peer', 'n')).toBe(99);
    expect(roundIds(run)).toHaveLength(roundsBefore + 1);
    expect(run.namespaceState()).toBe('live');

    // (2) changed round：peer state vector 较 round 前推进，双方收敛一致
    expect(bytesEq(run.stateVectorOf('peer'), peerSvPre)).toBe(false);
    expect(bytesEq(run.stateVectorOf('hub'), run.stateVectorOf('peer'))).toBe(true);

    // (3) 翻转（设计 §6 T3.2）：修复 round 是可观测的 changed round——事件携带
    //     roundId 关联 + 长度澄清；每侧 diff-applied 的效果与实测 round 级 SV 增量
    //     一一对应（hub 侧 noop：apply peer 空 diff 不推进漂移源 SV；peer 侧
    //     changed：apply 携带漂移的 Step2 后 SV 推进）
    const hubRound = hub.events.slice(hubFrom);
    const peerRound = peer.events.slice(peerFrom);
    const hubSent = bytesOf(hubRound, 'sync-step2-sent');
    const hubApplied = bytesOf(hubRound, 'sync-diff-applied');
    const peerSent = bytesOf(peerRound, 'sync-step2-sent');
    const peerApplied = bytesOf(peerRound, 'sync-diff-applied');
    expect(hubSent.length).toBeGreaterThanOrEqual(1);
    expect(hubApplied.length).toBeGreaterThanOrEqual(1);
    expect(peerSent.length).toBeGreaterThanOrEqual(1);
    expect(peerApplied.length).toBeGreaterThanOrEqual(1);
    expect(Math.min(...hubSent, ...peerSent)).toBeGreaterThan(0);
    expect(Math.min(...hubApplied, ...peerApplied)).toBeGreaterThan(0);
    // 每侧效果字段必须与实测 delta 一一对应（受控场景：round 内无其他写）
    expectSideDelta([...hubRound, ...peerRound], 'hub', false, '[issue239 repro] 场景2 修复 round');
    expectSideDelta([...hubRound, ...peerRound], 'peer', true, '[issue239 repro] 场景2 修复 round');
    console.log(
      `[issue239 repro] drift-repair round: ` +
      `hub sent/applied = ${JSON.stringify(hubSent)}/${JSON.stringify(hubApplied)} B, ` +
      `peer sent/applied = ${JSON.stringify(peerSent)}/${JSON.stringify(peerApplied)} B`,
    );

    // (4) 翻转（非粘滞）：修复后下一 periodic round 回到全 noop——效果字段为逐
    //     apply 窗口派生，信号逐 round 正确
    const hubFollowFrom = hub.events.length;
    const peerFollowFrom = peer.events.length;
    await advanceMs(run, interval);
    await run.waitNamespace('live');
    expect(run.namespaceState()).toBe('live');
    expect(roundIds(run)).toHaveLength(roundsBefore + 2);
    expect(bytesEq(run.stateVectorOf('hub'), run.stateVectorOf('peer'))).toBe(true);
    expectNoopObservability(
      [...hub.events.slice(hubFollowFrom), ...peer.events.slice(peerFollowFrom)],
      '[issue239 repro] 场景2 修复后 no-op round',
    );
    console.log(
      `[issue239 repro] 修复后 no-op 事件字段形状（去重）: ${JSON.stringify([...new Set(keySetsOf([...hub.events.slice(hubFollowFrom), ...peer.events.slice(peerFollowFrom)]))])}`,
    );
  }, 20_000);
});
