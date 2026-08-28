/**
 * SA3-owned 包内测试 — issue #134 round 2（设计 R2.1 §15.2 新增锚集合）：
 *
 *   R2-3 泵与队列：容量 16 边界（16 入 17 弃）/ 弃新保序 / sticky / 标记后继续投递 /
 *         两级副本独立性 / 零订阅者消费 / 投递前退订（交付时刻快照）/ 交付集语义 ×2
 *         （R2.1 / SA2 #1 必修：积压期订阅收到订阅前入队项 / 退订重订重复交付 +
 *         Y.applyUpdate 幂等吸收）/ 泵最外层兜底（isTerminal 抛错替身 → 计数而非
 *         unhandled rejection——R2.1 / SA2 #7 可选锚）；
 *   R2-1 fence：fenceStale 谓词（身份不等 / epoch 落后 / 幸存者）/ 双 channel 直构
 *         谓词正反锚（恰命中者终态化、无跳过无过栅——R2.1 / SA2 #4）/ 幂等二次 / 排队项
 *         取消 / conflicted 不降级；
 *   R2-2 terminateAll：closedBy 映射（apply → RUNTIME_WRITE_DISABLED 文案）/ 重复
 *         close 同实例 / 终态 throw；
 *   R2-4 规范化深比较：键序无关 / 数组有序 / NaN / -0 / 契约外（种子 Y.Text →
 *         PROTECTED_FIELDS_CHANGED——R2.1 / SA2 #2 必修）/ 跨形态分叉（Y.Text vs plain
 *         'abc'——对照）/ 白名单容器嵌套契约外子值投影相等放行（归一化边界）；
 *   R2-6 探针：卸载（doc 后续事务健康）/ 两分支 fatal message 渲染（committed 布尔）。
 *
 * 驱动面（沿 round-1 文件先例）：真实 Y.Doc / 真实 Runtime（包内 seam
 * createNamespaceRuntimeWithSeam）/ 相对通道直取 core；队列级锚经包内通道直构
 * createSessionFanout + SessionChannel（§15.2「直构 fanout + channel」——设计
 * R2.1 / SA2 #4 声明的包内直接构造面；行为级锚经真实 core 链路。
 *
 * ⚠️ 可选锚登记：R2.1 / SA2 #5 的 hostile-catch→unhandledRejection 计数锚属
 * registry 侧 lease.ts 注入域（runtime 包测试依赖方向禁止 import registry——round-1
 * 头注同款），本文件不落位；由 registry 侧（SA6 或后续包内锚）承接。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { DocHandle, DocHandleStatus, User } from '@nomicore/persistence';
import { RuntimeWriteFatalError } from '../src/index.js';
import type { NamespaceRuntime } from '../src/index.js';
import { createNamespaceRuntimeWithSeam } from '../src/runtime.js';
import { createSessionFanout, openReplicationSessionCoreForRegistry } from '../src/replication-session.js';
import type { RuntimeReplicationSessionCore, SessionChannel } from '../src/replication-session.js';

// ─────────────────────────────── fixture（round-1 同款自包含） ───────────────────────────────

const OWNER: User = { userId: 'u-alice' };
const TEXT_VALID =
  'type ROOT = { n: number; a?: string; ext?: number; k1?: number; k2?: number; k3?: number; };\n';
const ENVELOPE = { lang: 'vfsl', version: 1, id: 'ns-r2s3', text: TEXT_VALID } as const;
const REP_ID = 'd'.repeat(32);

/** 种子文档：SCHEMA 信封 + META（docId/createdAt + 复制保留字段——默认已启用）。 */
function seedDoc(opts: { epoch?: number; enabled?: boolean; metaExtra?: (meta: Y.Map<unknown>) => void } = {}): Y.Doc {
  const doc = new Y.Doc();
  const sc = doc.getMap('SCHEMA');
  for (const [k, v] of Object.entries(ENVELOPE)) sc.set(k, v);
  const meta = doc.getMap('META');
  meta.set('docId', 'ns-r2s3');
  meta.set('createdAt', 1_700_000_123_456);
  if (opts.enabled !== false) {
    meta.set('replicationId', REP_ID);
    meta.set('replicationEpoch', opts.epoch ?? 1);
  }
  opts.metaExtra?.(meta);
  doc.getMap('ROOT').set('n', 1);
  return doc;
}

interface RuntimeHarness {
  readonly runtime: NamespaceRuntime;
  notifyCount(): number;
  setStatus(f: () => DocHandleStatus): void;
}

function makeRuntime(
  doc: Y.Doc,
  opts: { bindNotify?: boolean; notifyDirty?: () => Promise<void>; setStatus?: (f: () => DocHandleStatus) => void } = {},
): RuntimeHarness {
  let notifyCount = 0;
  let statusFn: () => DocHandleStatus | undefined = () => undefined;
  const notifyDirty = opts.bindNotify === false ? undefined : async () => {
    notifyCount += 1;
    if (opts.notifyDirty !== undefined) await opts.notifyDirty();
  };
  const handle = {
    owner: OWNER,
    docId: 'ns-r2s3',
    doc,
    getStatus: () => statusFn() ?? 'ready',
    release: async () => {},
  } as unknown as DocHandle;
  const runtime = createNamespaceRuntimeWithSeam({
    handle,
    ...(notifyDirty !== undefined ? { notifyDirty } : {}),
  });
  return {
    runtime,
    notifyCount: () => notifyCount,
    setStatus: (f) => {
      statusFn = f;
    },
  };
}

async function readyOf(runtime: NamespaceRuntime): Promise<void> {
  await expect.poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 }).toBe('ready');
}

function openSession(
  runtime: NamespaceRuntime,
  role: 'hub' | 'peer' = 'hub',
  remoteInstanceId = 'peer-a',
): RuntimeReplicationSessionCore {
  const opened = openReplicationSessionCoreForRegistry(runtime, { localRole: role, remoteInstanceId });
  if (!opened.ok) throw new Error(`open 应成功，实际 ${JSON.stringify(opened)}`);
  return opened.core;
}

async function flushMicrotasks(budget: number): Promise<void> {
  for (let i = 0; i < budget; i += 1) await Promise.resolve();
}

type Settled = { kind: 'resolved'; value: unknown } | { kind: 'rejected'; reason: unknown };

async function settleOf(p: Promise<unknown>): Promise<Settled> {
  try {
    return { kind: 'resolved', value: await p };
  } catch (reason) {
    return { kind: 'rejected', reason };
  }
}

/** 直构 channel（fenceStale/谓词/泵容器级锚用——设计 §2.3 声明的包内直接构造面）。 */
function makeDirectChannel(
  opts: { replicationId?: string; replicationEpoch?: number; finalize?: SessionChannel['finalize']; isTerminal?: SessionChannel['isTerminal'] } = {},
): { channel: SessionChannel; terminal: () => string } {
  let terminal: 'open' | 'closed' | 'conflicted' = 'open';
  const channel: SessionChannel = {
    applyOrigin: Symbol('direct-channel'),
    listeners: new Set(),
    failures: 0,
    replicationId: opts.replicationId ?? REP_ID,
    replicationEpoch: opts.replicationEpoch ?? 1,
    queue: [],
    needsResync: false,
    pumpScheduled: false,
    finalize:
      opts.finalize ??
      ((t: 'closed' | 'conflicted') => {
        if (terminal === 'open') terminal = t;
      }),
    isTerminal: opts.isTerminal ?? (() => terminal !== 'open'),
  };
  return { channel, terminal: () => terminal };
}

/** 生成「远端实例状态更新」：live 全量 bootstrap + 远端变更（零并发冲突——确定性）。 */
function makeRemoteUpdateOf(liveDoc: Y.Doc, mutate: (peer: Y.Doc) => void): { update: Uint8Array } {
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(liveDoc));
  mutate(peer);
  return { update: Y.encodeStateAsUpdate(peer) };
}

/** 有界同步自旋（慢消费者替身——有界，绝不影响测试进程终局）。 */
function busySpinMs(ms: number): void {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    /* 同步自旋 */
  }
}

// ═══════════════════════════════════ R2-3：泵与队列 ═══════════════════════════════════

describe('R2-3 泵与队列（有界异步投递：容量 16 / 弃新保序 / sticky / 继续投递 / 两级副本 / 交付集）', () => {
  it('容量 16 边界 + 弃新保序（直构 fanout/channel：17 条同步写 → 队列恰 16 项 = 最旧 16，弃新项不投）', async () => {
    const doc = new Y.Doc();
    const fanout = createSessionFanout(doc);
    const { channel } = makeDirectChannel();
    const events: Uint8Array[] = [];
    channel.listeners.add((u) => events.push(u));
    fanout.attach(channel);

    for (let i = 1; i <= 17; i += 1) {
      doc.getMap('ROOT').set(`k${i}`, i); // 同步写（无 await——泵未达，队列确定性积压）
    }
    // 队列级：恰 16 项；needsResync 置位（溢出标记——F-1）
    expect(channel.queue.length).toBe(16);
    expect(channel.needsResync).toBe(true);
    // 弃新保序：队列首项 = 第 1 条写（最旧项保留——保序弃新）；第 17 条写未入队
    const replay = new Y.Doc();
    for (const item of channel.queue) Y.applyUpdate(replay, item);
    expect(replay.getMap('ROOT').get('k1')).toBe(1);
    expect(replay.getMap('ROOT').get('k16')).toBe(16);
    expect(replay.getMap('ROOT').get('k17')).toBeUndefined(); // 第 17 条被弃（新项丢弃）

    // 投递面：flush 后恰 16 次投递（全部最旧项按序投出）；第 17 条永不出现
    await flushMicrotasks(600);
    expect(events.length).toBe(16);
    expect(channel.queue.length).toBe(0);
  });

  it('sticky + 标记后继续投递（真实 core：溢出后置位不回落；后续写照常投递）', async () => {
    const doc = seedDoc();
    const { runtime } = makeRuntime(doc);
    await readyOf(runtime);
    const session = openSession(runtime, 'hub', 'peer-a');
    const events: Uint8Array[] = [];
    session.subscribeOwnedUpdates((u) => events.push(u));

    for (let i = 1; i <= 17; i += 1) {
      doc.getMap('ROOT').set(`k${i}`, i); // 同步写 ×17 → 溢出置位
    }
    expect(session.getStatus().needsResync, '溢出必须可观测（status 第 11 字段）').toBe(true);
    await flushMicrotasks(600); // 排空 16 项
    expect(events.length).toBe(16);

    doc.getMap('ROOT').set('after', 1); // 标记后继续投递（标记是观测信号不是行为切换）
    await flushMicrotasks(200);
    expect(events.length).toBe(17);
    expect(session.getStatus().needsResync).toBe(true); // sticky：置位后永不清除
    expect(session.getStatus().state).toBe('open'); // 溢出不终态化
  });

  it('两级副本独立性（队列项 vs 投递副本：底 buffer 不共享、byteOffset=0、全幅）', async () => {
    const doc = new Y.Doc();
    const fanout = createSessionFanout(doc);
    const { channel } = makeDirectChannel();
    const eventsA: Uint8Array[] = [];
    const eventsB: Uint8Array[] = [];
    channel.listeners.add((u) => eventsA.push(u));
    channel.listeners.add((u) => eventsB.push(u));
    fanout.attach(channel);

    doc.getMap('ROOT').set('k1', 1);
    await flushMicrotasks(200);

    expect(eventsA.length).toBe(1);
    // 每 listener 每投递独立副本（INV-S4 字节面——R2-10 加严锚兼容）
    expect(eventsA[0]).not.toBe(eventsB[0]);
    expect(eventsA[0]!.byteOffset).toBe(0);
    expect(eventsA[0]!.length).toBe(eventsA[0]!.buffer.byteLength);
    expect((eventsA[0] as Uint8Array).buffer).not.toBe((eventsB[0] as Uint8Array).buffer);
  });

  it('零订阅者消费（无 listener 的 channel：泵照常消费队列——不引入退订侦测特例）', async () => {
    const doc = new Y.Doc();
    const fanout = createSessionFanout(doc);
    const { channel } = makeDirectChannel();
    fanout.attach(channel); // 零 listener

    doc.getMap('ROOT').set('k1', 1);
    await flushMicrotasks(200);
    expect(channel.queue.length).toBe(0); // 泵对空 listener 快照迭代 = no-op，队列照常清空
  });

  it('投递前退订（交付时刻快照：unsubscribe 后已入队项零投递）', async () => {
    const doc = new Y.Doc();
    const fanout = createSessionFanout(doc);
    const { channel } = makeDirectChannel();
    const events: Uint8Array[] = [];
    const unsubscribe = (): void => {
      channel.listeners.delete(listener);
    };
    const listener = (u: Uint8Array): void => {
      events.push(u);
    };
    channel.listeners.add(listener);
    fanout.attach(channel);

    doc.getMap('ROOT').set('k1', 1); // 入队（泵未达——同步段）
    unsubscribe(); // 交付前退订
    await flushMicrotasks(200);
    expect(events.length, '投递时刻快照不含已退订 listener（at-least-once 语义面）').toBe(0);
  });

  it('交付集 (i) 慢消费者积压期订阅：订阅前入队的 update 仍投给晚订阅者（at-least-once——R2.1 / SA2 #1 必修）', async () => {
    const doc = seedDoc();
    const { runtime } = makeRuntime(doc);
    await readyOf(runtime);
    const session = openSession(runtime, 'hub', 'peer-a');
    const slowEvents: Uint8Array[] = [];
    session.subscribeOwnedUpdates(() => {
      busySpinMs(10); // 慢消费者：投递速率 < 生产速率 → 积压未排空
      slowEvents.push(new Uint8Array(0));
    });
    const baseline = Y.encodeStateAsUpdate(doc); // 写前基线快照（积压项重放用）
    for (let i = 1; i <= 5; i += 1) {
      doc.getMap('ROOT').set(`k${i}`, i); // 5 条同步入队（积压窗口内）
    }
    const lateEvents: Uint8Array[] = [];
    session.subscribeOwnedUpdates((u) => lateEvents.push(u)); // 晚订阅（积压未排空）

    await flushMicrotasks(600);
    expect(lateEvents.length, '晚订阅者必须收到订阅前入队的积压项（交付时刻快照）').toBe(5);
    // 内容真值：积压项按序可重放（k1..k5——以写前基线 bootstrap 后增量重放）
    const replay = new Y.Doc();
    Y.applyUpdate(replay, baseline);
    for (const item of lateEvents) Y.applyUpdate(replay, item);
    expect(replay.getMap('ROOT').get('k1')).toBe(1);
    expect(replay.getMap('ROOT').get('k5')).toBe(5);
    expect(slowEvents.length).toBe(5); // 慢消费者同样收到 5 次投递
  });

  it('交付集 (ii) 退订→立即重订（积压窗口）：重订后收到未投递项 + Y.applyUpdate 幂等吸收（重复重放状态不变）', async () => {
    const doc = seedDoc();
    const { runtime } = makeRuntime(doc);
    await readyOf(runtime);
    const session = openSession(runtime, 'hub', 'peer-a');

    // 窗口 1：订阅 → 同步写（入队）→ 退订（交付前）——窗口 1 零投递
    const events1: Uint8Array[] = [];
    const sub1 = session.subscribeOwnedUpdates((u) => events1.push(u));
    doc.getMap('ROOT').set('k1', 1);
    doc.getMap('ROOT').set('k2', 2);
    sub1();

    // 窗口 2：立即重订（积压窗口内——同一队列项跨订阅窗口）
    const events2: Uint8Array[] = [];
    session.subscribeOwnedUpdates((u) => events2.push(u));
    await flushMicrotasks(400);
    expect(events1.length).toBe(0); // 窗口 1 未投（快照不活）
    expect(events2.length, '重订后必须收到未投递项（跨窗口可重复交付语义——at-least-once）').toBe(2);

    // Y.applyUpdate 幂等吸收：同一交付字节重复施加 → 副本状态不变
    const replica = new Y.Doc();
    Y.applyUpdate(replica, Y.encodeStateAsUpdate(doc));
    Y.applyUpdate(replica, events2[0]!);
    const once = JSON.stringify(replica.getMap('ROOT').toJSON());
    Y.applyUpdate(replica, events2[0]!); // 重复投递（CRDT 重复应用零效果）
    Y.applyUpdate(replica, events2[1]!);
    expect(JSON.stringify(replica.getMap('ROOT').toJSON())).toBe(JSON.stringify({ ...JSON.parse(once), k2: 2 }));
  });

  it('泵最外层兜底（可选锚——R2.1 / SA2 #7）：isTerminal 抛错替身 → observerFailures 递增而非 unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      const doc = new Y.Doc();
      const fanout = createSessionFanout(doc);
      let isTerminalCalls = 0;
      const { channel } = makeDirectChannel({
        isTerminal: () => {
          isTerminalCalls += 1;
          if (isTerminalCalls >= 2) throw new Error('hostile isTerminal (pump 兜底注入)');
          return false;
        },
      });
      fanout.attach(channel);

      doc.getMap('ROOT').set('k1', 1); // observer 调用 isTerminal #1（false）→ 入队 → 调度泵
      // 泵 IIFE 同步段：while 条件调用 isTerminal #2 → 抛 → 最外层 catch 收敛为计数
      expect(channel.failures).toBe(1);
      expect(channel.queue.length).toBe(1); // 抛点位于 shift 之前——队列项保留
      await flushMicrotasks(40);
      expect(channel.failures).toBe(1);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
    expect(unhandled, '泵兜底路径零 unhandled rejection（failures 计数收敛）').toHaveLength(0);
  });
});

// ═══════════════════════════════════ R2-1：bump 槽主动 fence ═══════════════════════════════════

describe('R2-1 fenceStale（bump 槽 E5.5 主动 fence 的谓词/幂等/排队项取消/不降级）', () => {
  it('fenceStale 谓词单元锚：身份不等命中 / epoch 落后命中 / 完全相等幸存', async () => {
    const doc = new Y.Doc();
    const fanout = createSessionFanout(doc);
    const { channel: same, terminal: sameTerminal } = makeDirectChannel({ replicationId: 'a'.repeat(32), replicationEpoch: 2 });
    const { channel: lag, terminal: lagTerminal } = makeDirectChannel({ replicationId: 'a'.repeat(32), replicationEpoch: 1 });
    const { channel: other, terminal: otherTerminal } = makeDirectChannel({ replicationId: 'b'.repeat(32), replicationEpoch: 1 });
    fanout.attach(same);
    fanout.attach(lag);
    fanout.attach(other);

    fanout.fenceStale('a'.repeat(32), 2); // 谓词输入 = 新 epoch 事实
    expect(lagTerminal(), 'epoch 落后 → 命中 fence').toBe('conflicted');
    expect(otherTerminal(), '身份不等 → 命中 fence').toBe('conflicted');
    expect(sameTerminal(), '冻结 (id, epoch) 与传入相等 → 幸存者（无过栅）').toBe('open');

    // 幂等：二次调用（含已在终态的 channel）+ 幸存者终态互扰为 none
    fanout.fenceStale('a'.repeat(32), 3);
    expect(lagTerminal()).toBe('conflicted'); // 幂等保持
    expect(otherTerminal()).toBe('conflicted');
    expect(sameTerminal()).toBe('conflicted'); // epoch 落后（2 ≠ 3）→ 第二次调用命中
  });

  it('双 channel 直构谓词正反锚（R2.1 / SA2 #4）：一命中一不命中 → 恰命中者终态化、无跳过无过栅', async () => {
    const doc = new Y.Doc();
    const fanout = createSessionFanout(doc);
    const { channel: hit, terminal: hitTerminal } = makeDirectChannel({ replicationId: 'z'.repeat(32), replicationEpoch: 1 });
    const { channel: miss, terminal: missTerminal } = makeDirectChannel({ replicationId: 'a'.repeat(32), replicationEpoch: 1 });
    const hitEvents: Uint8Array[] = [];
    const missEvents: Uint8Array[] = [];
    hit.listeners.add((u) => hitEvents.push(u));
    miss.listeners.add((u) => missEvents.push(u));
    fanout.attach(hit); // 迭代序：hit 在前（finalize 自摘除——迭代期删除限于当前被访元素）
    fanout.attach(miss);

    fanout.fenceStale('a'.repeat(32), 1); // hit（id 不等）→ 命中；miss（id+epoch 相等）→ 幸存
    expect(hitTerminal()).toBe('conflicted');
    expect(missTerminal()).toBe('open'); // 命中者摘除后 miss 仍被访问（无跳过）

    // 幸存者不受扰：后续本地写照常投递；命中者零投递（已摘除 + 排队项取消）
    doc.getMap('ROOT').set('k1', 1);
    await flushMicrotasks(200);
    expect(missEvents.length).toBe(1);
    expect(hitEvents.length).toBe(0);
  });

  it('fence 取消排队项（真实 core：bump 前同步积压 5 项 → fence 后零投递）', async () => {
    const doc = seedDoc();
    const { runtime } = makeRuntime(doc);
    await readyOf(runtime);
    const session = openSession(runtime, 'hub', 'peer-a');
    const events: Uint8Array[] = [];
    session.subscribeOwnedUpdates((u) => events.push(u));

    for (let i = 1; i <= 5; i += 1) {
      doc.getMap('ROOT').set(`k${i}`, i); // 同步积压（泵未达——F-3 取消面）
    }
    expect((await runtime.bumpReplicationEpoch()).ok).toBe(true); // E5 写入队 → E5.5 fence（同步段）
    await flushMicrotasks(400);
    expect(events.length, 'fence 取消全部未投递排队项（含 bump 自身 META 写——F-3 零投递）').toBe(0);
    expect(session.getStatus().state).toBe('conflicted');
  });

  it('conflicted 不降级：bump fence 后 Runtime close（terminateAll）保持 conflicted', async () => {
    const doc = seedDoc();
    const { runtime } = makeRuntime(doc);
    await readyOf(runtime);
    const session = openSession(runtime, 'hub', 'peer-a');
    expect((await runtime.bumpReplicationEpoch()).ok).toBe(true);
    expect(session.getStatus().state).toBe('conflicted');

    await runtime.close(); // terminateAll('runtime-close') → finalize('closed') 对 conflicted 幂等 no-op
    expect(session.getStatus().state).toBe('conflicted'); // 终态不降级（§3.1）
  });
});

// ═══════════════════════════════════ R2-2：Runtime close 终止 sessions ═══════════════════════════════════

describe('R2-2 terminateAll（Runtime close 同步段：closedBy 映射 / 重复 close 同实例 / 终态 throw）', () => {
  it('close 后 session 终态 closed；apply → RUNTIME_WRITE_DISABLED（closedBy 映射 + close 域文案）', async () => {
    const doc = seedDoc();
    const { runtime, notifyCount } = makeRuntime(doc);
    await readyOf(runtime);
    const session = openSession(runtime, 'hub', 'peer-a');

    await runtime.close();
    expect(session.getStatus().state).toBe('closed'); // terminateAll 终态

    const { update } = makeRemoteUpdateOf(doc, (peer) => {
      peer.getMap('ROOT').set('ext', 7);
    });
    const applied = await settleOf(session.applyRemoteUpdate(update));
    expect(applied.kind).toBe('resolved');
    if (applied.kind !== 'resolved') throw new Error('unreachable');
    const v = applied.value as { ok?: unknown; code?: unknown; message?: unknown };
    expect(v.ok).toBe(false);
    expect(v.code).toBe('RUNTIME_WRITE_DISABLED'); // §3.3 码域精化（close 域接纳拒绝）
    expect(JSON.stringify(v)).toContain('close 已停止接纳会话 apply');
    expect(doc.getMap('ROOT').get('ext')).toBeUndefined();
    expect(notifyCount()).toBe(0);
  });

  it('终态 throw（encodeStateVector/encodeDiff）与重复 close 同实例（幂等、恒绿）', async () => {
    const doc = seedDoc();
    const { runtime } = makeRuntime(doc);
    await readyOf(runtime);
    const session = openSession(runtime, 'hub', 'peer-a');
    await runtime.close();

    expect(() => session.encodeStateVector()).toThrow(); // 终态纪律统一（§1 作废清单第 5 行——确定 throw）
    expect(() => session.encodeDiff(new Uint8Array([0]))).toThrow();

    const c1 = session.close();
    const c2 = session.close();
    expect(c2).toBe(c1); // 幂等 same-promise 缓存（INV-S11 延续——Runtime close 终止后首调惰性 barrier）
    expect((await settleOf(session.close())).kind).toBe('resolved'); // 恒绿（永不 reject）
  });
});

// ═══════════════════════════════════ R2-4：受保护结构值（规范化深比较） ═══════════════════════════════════

describe('R2-4 受保护字段结构值（protectedValueEqual/deepEqualPlain 行为锚）', () => {
  it('plain object 键序无关：同内容改键序（写序）→ 放行（ROOT-only 同闸）', async () => {
    const doc = seedDoc({
      metaExtra: (meta) => {
        meta.set('extra', { a: 1, b: 2 });
      },
    });
    const { runtime } = makeRuntime(doc);
    await readyOf(runtime);
    const session = openSession(runtime, 'hub', 'peer-a');

    const { update } = makeRemoteUpdateOf(doc, (peer) => {
      peer.getMap('META').set('extra', { b: 2, a: 1 }); // 内容相等、键插入序不同
      peer.getMap('ROOT').set('k1', 1);
    });
    const applied = await settleOf(session.applyRemoteUpdate(update));
    expect(applied.kind).toBe('resolved');
    if (applied.kind !== 'resolved') throw new Error('unreachable');
    const v = applied.value as { ok?: unknown };
    expect(v.ok, '键序无关深比较：内容未变必须放行（非 primitive 误拒已修复）').toBe(true);
    expect(doc.getMap('ROOT').get('k1')).toBe(1);
  });

  it('plain array 有序：同元素改序 → 拒绝零写入', async () => {
    const doc = seedDoc({
      metaExtra: (meta) => {
        meta.set('labels', [1, 2]);
      },
    });
    const { runtime, notifyCount } = makeRuntime(doc);
    await readyOf(runtime);
    const session = openSession(runtime, 'hub', 'peer-a');

    const { update } = makeRemoteUpdateOf(doc, (peer) => {
      peer.getMap('META').set('labels', [2, 1]);
    });
    const applied = await settleOf(session.applyRemoteUpdate(update));
    expect(applied.kind).toBe('resolved');
    if (applied.kind !== 'resolved') throw new Error('unreachable');
    const v = applied.value as { ok?: unknown; code?: unknown };
    expect(v.ok).toBe(false);
    expect(v.code).toBe('REPLICATION_PROTECTED_FIELDS_CHANGED');
    expect(notifyCount()).toBe(0);
    expect((doc.getMap('META').get('labels') as number[]).join(',')).toBe('1,2'); // 零写入
  });

  it('SameValue 规则：NaN 同值放行；-0 vs 0 拒（Object.is 语义）', async () => {
    const doc = seedDoc({
      metaExtra: (meta) => {
        meta.set('nanField', { a: NaN });
        meta.set('negzero', { a: -0 });
      },
    });
    const { runtime } = makeRuntime(doc);
    await readyOf(runtime);
    const session = openSession(runtime, 'hub', 'peer-a');

    // NaN == NaN（SameValue）：同值重写放行
    const nanUpdate = makeRemoteUpdateOf(doc, (peer) => {
      peer.getMap('META').set('nanField', { a: NaN });
    });
    const nanResult = await settleOf(session.applyRemoteUpdate(nanUpdate.update));
    expect(nanResult.kind).toBe('resolved');
    if (nanResult.kind !== 'resolved') throw new Error('unreachable');
    expect((nanResult.value as { ok?: unknown }).ok, 'NaN 与自身相等（SameValue）→ 放行').toBe(true);

    // -0 vs 0：SameValue 判不等 → 拒绝
    const nzUpdate = makeRemoteUpdateOf(doc, (peer) => {
      peer.getMap('META').set('negzero', { a: 0 });
    });
    const nzResult = await settleOf(session.applyRemoteUpdate(nzUpdate.update));
    expect(nzResult.kind).toBe('resolved');
    if (nzResult.kind !== 'resolved') throw new Error('unreachable');
    const v = nzResult.value as { ok?: unknown; code?: unknown };
    expect(v.ok).toBe(false);
    expect(v.code).toBe('REPLICATION_PROTECTED_FIELDS_CHANGED');
    expect(Object.is((doc.getMap('META').get('negzero') as { a: number }).a, -0)).toBe(true); // 零写入
  });

  it('契约外容器保守拒（R2.1 / SA2 #2 必修）：种子 Y.Text + ROOT-only update → PROTECTED_FIELDS_CHANGED 拒', async () => {
    const doc = seedDoc({
      metaExtra: (meta) => {
        meta.set('note', new Y.Text('abc')); // trusted-domain 种子面（合法写路径不可达）
      },
    });
    const { runtime, notifyCount } = makeRuntime(doc);
    await readyOf(runtime);
    const session = openSession(runtime, 'hub', 'peer-a');

    const { update } = makeRemoteUpdateOf(doc, (peer) => {
      peer.getMap('ROOT').set('k1', 1); // 仅 ROOT——受保护字段零触碰
    });
    const applied = await settleOf(session.applyRemoteUpdate(update));
    expect(applied.kind).toBe('resolved');
    if (applied.kind !== 'resolved') throw new Error('unreachable');
    const v = applied.value as { ok?: unknown; code?: unknown };
    expect(v.ok).toBe(false);
    expect(v.code, 'Y.Text 形态保守拒——虽同型等内容未变亦拒（白名单路线 (B)）').toBe('REPLICATION_PROTECTED_FIELDS_CHANGED');
    expect(notifyCount()).toBe(0);
  });

  it('跨形态分叉拒（对照）：live Y.Text vs update 改写 plain "abc" → 拒', async () => {
    const doc = seedDoc({
      metaExtra: (meta) => {
        meta.set('note', new Y.Text('abc'));
      },
    });
    const { runtime } = makeRuntime(doc);
    await readyOf(runtime);
    const session = openSession(runtime, 'hub', 'peer-a');

    const { update } = makeRemoteUpdateOf(doc, (peer) => {
      peer.getMap('META').set('note', 'abc'); // 同内容跨形态（Y.Text → plain string）
    });
    const applied = await settleOf(session.applyRemoteUpdate(update));
    expect(applied.kind).toBe('resolved');
    if (applied.kind !== 'resolved') throw new Error('unreachable');
    const v = applied.value as { ok?: unknown; code?: unknown };
    expect(v.ok).toBe(false);
    expect(v.code).toBe('REPLICATION_PROTECTED_FIELDS_CHANGED'); // 单侧白名单即拒（两路线一致）
  });

  it('白名单容器嵌套契约外子值投影相等放行（归一化边界）：Y.Map 槽 {note: Y.Text} vs 同投影 → 放行', async () => {
    const doc = seedDoc({
      metaExtra: (meta) => {
        const bag = new Y.Map(); // 白名单物化容器（Y.Map/Y.Array——设计 §5.2 行）
        bag.set('note', new Y.Text('abc')); // 嵌套契约外子值（toJSON 摊平 → 'abc'）
        meta.set('bag', bag);
      },
    });
    const { runtime } = makeRuntime(doc);
    await readyOf(runtime);
    const session = openSession(runtime, 'hub', 'peer-a');

    const { update } = makeRemoteUpdateOf(doc, (peer) => {
      peer.getMap('ROOT').set('k1', 1); // 仅 ROOT——META.bag 投影未变
    });
    const applied = await settleOf(session.applyRemoteUpdate(update));
    expect(applied.kind).toBe('resolved');
    if (applied.kind !== 'resolved') throw new Error('unreachable');
    const v = applied.value as { ok?: unknown };
    expect(v.ok, '嵌套契约外子值随 toJSON 投影摊平参与比较——投影相等即放行（归一化边界）').toBe(true);
    expect(doc.getMap('ROOT').get('k1')).toBe(1);
  });

  it('Date 种子（非 plain 实例）+ ROOT-only update → 拒（R2.2.1 / SA4 F-1 必修①——跨形态分叉分支）', async () => {
    const doc = seedDoc({
      metaExtra: (meta) => {
        meta.set('d', new Date(0)); // trusted-domain 种子面直构（合法写路径不可达）
      },
    });
    const { runtime, notifyCount } = makeRuntime(doc);
    await readyOf(runtime);
    const session = openSession(runtime, 'hub', 'peer-a');

    // 触发分支注记（R2.2.1 措辞收窄——实测 yjs 13.6.32 + lib0 writeAny）：
    // live 侧 'd' 保持 Date 实例（proto=Date.prototype ⇒ 非白名单——但**不落 proto 门**）；
    // scratch 侧 round-trip 被 writeAny 摊平为 plain {}（proto=Object.prototype ⇒ 白名单）
    // ⇒ 单侧白名单即拒 = **跨形态分叉**分支（结果同为保守拒，与「契约外容器拒」同构）。
    const { update } = makeRemoteUpdateOf(doc, (peer) => {
      peer.getMap('ROOT').set('k1', 1); // 仅 ROOT——受保护字段零触碰
    });
    const applied = await settleOf(session.applyRemoteUpdate(update));
    expect(applied.kind).toBe('resolved');
    if (applied.kind !== 'resolved') throw new Error('unreachable');
    const v = applied.value as { ok?: unknown; code?: unknown };
    expect(v.ok).toBe(false);
    expect(v.code).toBe('REPLICATION_PROTECTED_FIELDS_CHANGED');
    expect(doc.getMap('ROOT').get('k1')).toBeUndefined(); // 零写入
    expect(doc.getMap('META').get('d')).toBeInstanceOf(Date); // 零写入（live 侧未被触碰）
    expect(notifyCount()).toBe(0); // 零 notify
  });

  it('undefined / bigint 种子（契约外标量）+ ROOT-only update → 拒（R2.2.1 / SA4 F-1 必修②——typeof fallthrough 保守拒）', async () => {
    const doc = seedDoc({
      metaExtra: (meta) => {
        meta.set('u', undefined); // Yjs 忠实存储（has==='true'、get===undefined）
        meta.set('b', 10n); // bigint 同型忠实 round-trip（lib0 writeAny 域内）
      },
    });
    const { runtime, notifyCount } = makeRuntime(doc);
    await readyOf(runtime);
    const session = openSession(runtime, 'hub', 'peer-a');

    // 触发分支注记：两值经 encode/apply round-trip **同型忠实**（scratch 侧仍为 undefined /
    // 10n——非摊平）；protectedValueEqual 的 typeof fallthrough（'undefined'/'bigint' 不匹配
    // string/number/boolean、非 null）⇒ 同型同值亦保守拒（契约外——L31 值域外形态不得
    // 经 raw 判等放行）。
    const { update } = makeRemoteUpdateOf(doc, (peer) => {
      peer.getMap('ROOT').set('k1', 1); // 仅 ROOT——受保护字段零触碰
    });
    const applied = await settleOf(session.applyRemoteUpdate(update));
    expect(applied.kind).toBe('resolved');
    if (applied.kind !== 'resolved') throw new Error('unreachable');
    const v = applied.value as { ok?: unknown; code?: unknown };
    expect(v.ok).toBe(false);
    expect(v.code).toBe('REPLICATION_PROTECTED_FIELDS_CHANGED');
    expect(doc.getMap('ROOT').get('k1')).toBeUndefined(); // 零写入
    expect(doc.getMap('META').has('u')).toBe(true); // 零写入（live 键未被触碰/删除）
    expect(doc.getMap('META').get('b')).toBe(10n);
    expect(notifyCount()).toBe(0); // 零 notify
  });

  it('Map/Set/symbol/function 种子面 loud throw 豁免（R2.2.1 / SA4 F-1 可选①——Yjs 自身域门先于比较层）', () => {
    // 豁免登记：这四类值在 Y.Map.set 即同步 throw「Unexpected content type」（lib0
    // writeAny 域外——先于本判据的 Yjs 自身域门）⇒ 种子面 loud 拒、比较层结构性
    // 不可达——**无比较层锚义务**；本断言只锚 Yjs 事实（R2.2.1 表末尾行）。
    const doc = new Y.Doc();
    const meta = doc.getMap('META');
    for (const value of [new Map(), new Set(), Symbol('s'), () => {}]) {
      expect(() => meta.set('x', value)).toThrow(/Unexpected content type/);
    }
  });
});

// ═══════════════════════════════════ R2-6：committed 探针 ═══════════════════════════════════

describe('R2-6 beforeTransaction 探针（槽级一次性：finally 卸载 / 两分支 message 渲染）', () => {
  /** Yjs 事件处理器表（lib0 ObservableV2：doc.on 注册 → doc._observers Map<string, Set<f>>——
   *  探针卸载泄漏的直接观测面；off 在集合空时删除键——缺席即零残留）。 */
  function beforeTransactionHandlerCount(doc: Y.Doc): number {
    const observers = (doc as unknown as { _observers?: Map<string, Set<unknown>> })._observers;
    return observers?.get('beforeTransaction')?.size ?? 0;
  }

  it('探针卸载（finally off）：成功 apply 后探针零残留；敌意 apply 拒后仅敌意 listener 残留', async () => {
    const doc = seedDoc();
    const { runtime } = makeRuntime(doc);
    await readyOf(runtime);
    const session = openSession(runtime, 'hub', 'peer-a');

    // ① 成功路径：正常 apply（槽内注册探针 → finally off）→ beforeTransaction 列表零残留
    const okUpdate = makeRemoteUpdateOf(doc, (peer) => {
      peer.getMap('ROOT').set('k0', 1);
    });
    expect((await settleOf(session.applyRemoteUpdate(okUpdate.update))).kind).toBe('resolved');
    expect(beforeTransactionHandlerCount(doc), '探针必须于槽 finally 卸载（零泄漏到后续事务）').toBe(0);

    // ② 拒绝路径：敌意 beforeTransaction（测试注册——先于探针）→ 探针不运行 → committed:false；
    //    finally 仍 off 探针——事件表仅剩敌意 listener（探针零残留）
    const hostile = (): never => {
      throw new Error('hostile beforeTransaction (deterministic)');
    };
    doc.on('beforeTransaction', hostile);
    const { update } = makeRemoteUpdateOf(doc, (peer) => {
      peer.getMap('ROOT').set('k1', 1);
    });
    const applied = await settleOf(session.applyRemoteUpdate(update));
    expect(applied.kind).toBe('rejected');
    if (applied.kind !== 'rejected') throw new Error('unreachable');
    expect((applied.reason as RuntimeWriteFatalError).committed).toBe(false);
    expect(doc.getMap('ROOT').get('k1')).toBeUndefined(); // 零 mutation
    expect(beforeTransactionHandlerCount(doc), '拒绝路径 finally 同样卸载探针（仅敌意 listener 残留）').toBe(1);
  });

  it('两分支 fatal message 渲染：committed=false（零 mutation）与 committed=true（mutation 已发生）', async () => {
    const doc = seedDoc();
    const { runtime } = makeRuntime(doc);
    await readyOf(runtime);
    const session = openSession(runtime, 'hub', 'peer-a');

    // 分支 1：beforeTransaction 抛错 → committed:false
    doc.on('beforeTransaction', () => {
      throw new Error('hostile before (deterministic)');
    });
    const u1 = makeRemoteUpdateOf(doc, (peer) => {
      peer.getMap('ROOT').set('k1', 1);
    });
    const r1 = await settleOf(session.applyRemoteUpdate(u1.update));
    expect(r1.kind).toBe('rejected');
    if (r1.kind !== 'rejected') throw new Error('unreachable');
    const fatal1 = r1.reason as RuntimeWriteFatalError;
    expect(fatal1.phase).toBe('unknown-pipeline-throw');
    expect(fatal1.committed).toBe(false);
    expect(fatal1.message).toContain('committed=false');
    expect(fatal1.message).toContain('REPLICATION apply');
  });
});
