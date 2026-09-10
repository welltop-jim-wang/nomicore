/**
 * issue #287 / ADR 0018 §1/§3/§4 — `@nomicore/ws-replication` 通道行为端到端：把 #286 的
 * re-arm 机制接到 ws-replication 上，从使用方视角交付三件事（协议 §23.1 第 23/24 型
 * observer 事件 + fatal 主动关 channel + 断连追赶）。
 *
 * 锚定契约：
 * - **可观测收敛**：hub `replaceSchema()` → peer 收 UPDATE → 同一 apply 槽内 re-arm 成功
 *   → 恰一 `schema-rearm-applied`（携带新 semanticFingerprint + 复制来的 updatedAt）；
 *   多 Peer 滚动升级的「全部 Peer 已 applied」收敛判据读取点；
 * - **fatal 快速失败**：re-arm 失败 → 恰一 `schema-rearm-failed`（稳定双码之一）→ 该
 *   namespace channel **主动发 CLOSE_NAMESPACE** → `closed` 终态 → 双侧资源立即释放 →
 *   重连**不自动重开**（等显式 re-add），不产生重试循环；连接不被株连；
 * - **断连追赶**：离线期间的 schema 变更由重连 reconcile 的 SYNC_STEP2 sequenced apply
 *   经同一 re-arm 路径激活，**无需任何显式通知帧**；
 * - **角色不对称**：hub 侧 apply 槽永不发射 re-arm 事件（conformance 反向断言）；
 * - **observer 缺省纪律**：零事件构造、零 live 状态读取、零时钟调用（§23.1/§23.4）——
 *   re-arm 的 **channel 行为**（fatal 主动关闭）不依赖观测面，只有事件构造依赖；
 * - **事件安全**：字段符合 §23.3（fingerprint/updatedAt/code；无 schema 文本/ROOT/堆栈）。
 *
 * 驱动面：真实 yjs / 真实 Registry+Runtime / fake-duplex（微任务投递）/ 注入 timer；
 * 零 real sleep；observer 经生产 `observer` 配置面注入（driver `peerObserver`/`hubObserver`）。
 *
 * 与 #286 的分工：#286 在 namespace-runtime 包内钉死槽内 re-arm 语义（成功/fatal 双码/
 * 自愈/bypass/角色不对称）；本文件只钉「通道行为」——事件、主动关闭、追赶、零开销。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type {
  ReplicationClock,
  ReplicationObserver,
  ReplicationObserverEvent,
} from '@nomicore/ws-replication';
import { decodeMessage } from '@nomicore/replication-protocol';
import { advanceMs, boot, collectUnhandledRejections, type Run } from './driver.js';
import { okLease, PEER_OWNER, schemaReady, settle, settleUntil } from './harness.js';

// ═══════════════════════════ fixture 常量 ═══════════════════════════

/** 与 hub fixture genesis SCHEMA（harness SCHEMA_ENVELOPE）语义不同的新 generation：
 *  新必填 `note` + 新可选 `ext`——「后续业务写按新 tools 校验」的可判据面。 */
const TEXT_V2 = 'type ROOT = { n: number; extra?: number; note: string; ext?: number; };\n';
/** 与 TEXT_V2 语义等价、字节不同（纯格式/注释差异——semanticFingerprint 相同，
 *  updatedAt 照常推进：ADR 0017「每次提交都推进」）。 */
const TEXT_V2_FMT =
  'type ROOT = {\n  // 纯格式差异\n  n: number;\n  extra?: number;\n  note: string;\n  ext?: number;\n};\n';
/** fingerprint 文法（§23.3 documented safe digest：`sha256:v1:<64 hex>`）。 */
const FINGERPRINT_RE = /^sha256:v1:[0-9a-f]{64}$/;
/** 编译结果失败文本（语法非法——vfsl 结果联合内 ok:false，非 throw）。 */
const TEXT_BAD = 'type ROOT = { broken';
/** ADR 0018 §3 双码之一（`injectRearmFatalSchema` 场景的稳定码）。 */
const REARM_INVALID = 'NSRT-FATAL-SCHEMA-REARM-INVALID' as const;

type RearmAppliedEvent = Extract<ReplicationObserverEvent, { type: 'schema-rearm-applied' }>;
type RearmFailedEvent = Extract<ReplicationObserverEvent, { type: 'schema-rearm-failed' }>;

// ═══════════════════════════ 事件收集器与读面辅助 ═══════════════════════════

class Collector {
  readonly events: ReplicationObserverEvent[] = [];
  readonly observer: ReplicationObserver = (event) => {
    this.events.push(event);
  };
  rearm(): ReplicationObserverEvent[] {
    return this.events.filter((e) => e.type.startsWith('schema-rearm-'));
  }
  of<T extends ReplicationObserverEvent['type']>(
    type: T,
  ): Array<Extract<ReplicationObserverEvent, { type: T }>> {
    return this.events.filter(
      (e): e is Extract<ReplicationObserverEvent, { type: T }> => e.type === type,
    );
  }
}

/** 等 peer 侧出现第 n 个 re-arm 事件（确定性排空，零 real sleep）。 */
async function waitRearmCount(peer: Collector, count: number): Promise<void> {
  await settleUntil(
    () => peer.rearm().length >= count,
    `peer re-arm 事件数 ≥ ${count}，当前 ${peer.rearm().length}`,
  );
}

/** 该侧 namespace 文档的克隆（真实 Y.Doc 拷贝——测试侧构造/读取用）。 */
function snapshot(run: Run, side: 'hub' | 'peer'): Y.Doc {
  return run.snapshotDoc(side);
}

/** 用 peer 侧现有文档构造一笔内联 UPDATE（模拟对端复制来的增量）并注入 hub→peer 方向
 *  ——「对端复制来的 SCHEMA 变化」在通道层的复现面（§23.1 updatedAt 诚实缺席用例）。
 *
 *  注入纪律（driver `injectHub` 明文）：必须发生在「hub 侧不再产生真实帧」的窗口——
 *  否则真实帧与注入帧同序列撞号 → 接收端 SEQUENCE_VIOLATION（非确定性）。调用方
 *  负责先 `await settle()` 排空微任务投递至静默（本文件全部注入点均如此）。 */
function injectPeerUpdate(run: Run, mutate: (doc: Y.Doc) => void): number {
  const bytes = run.buildUpdateFrom('peer', mutate);
  run.injectHub({ kind: 'UPDATE', namespaceId: run.nsId, update: bytes });
  return bytes.byteLength;
}

/** closeTimeoutMs 的缺省（`CONTRACT_TIMEOUTS`/生产缺省 5_000）——收口结算推进量。 */
const CLOSE_TIMEOUT_ADVANCE_MS = 6_000;

/**
 * **fatal 路径的确定性注入器**（ADR 0018 §3「版本偏移/字节损坏」）。
 *
 * 场景本体：对端复制来的 SCHEMA 文本在 peer 侧编译失败（Hub 提交前已编译成功的同一文本
 * 在 Peer 失败 = 版本偏移/字节损坏；真实 hub 结构性无法提交非法 SCHEMA——`replaceSchema`
 * 编译失败是事务前零写入普通拒绝，ADR 0018 §5，故本文件经内联 UPDATE 复现该对端事实）。
 *
 * 三处刻意的测试面处置（均为**不伪造被测事实**的最小手段）：
 * 1. `settle()` 静默窗口：`injectHub` 的序列记账纪律要求 hub 侧无在途帧（见 `injectPeerUpdate`）；
 * 2. 丢 peer 的 UPDATE_ACK：注入帧对 Hub 是凭空出现的业务写，peer 照常 ACK 会被 Hub 判
 *    `SEQUENCE_VIOLATION` 并 blocked 整条连接，污染「fatal 只关本 namespace」判据面
 *    （真实网络丢帧形态，`dropNextPeerToHub` 既有 fault-injection seam）；
 * 3. 丢 Hub 的 CLOSE_OK：让收口走 **peer 侧 closeTimeout 本地结算**而非 ACK 关联结算——
 *    同样到达 `closed` 终态，且完全绕开 `injectHub` 注入帧与 Hub 自发出帧的序列撞号
 *    （注入用的是 Hub 保留序列；Hub 若也发一帧，peer 端必判重复序列）。
 *    两者都是 §13.1 既有的合法收口路径，断言面（CLOSE_NAMESPACE 恰一帧 + `closed` 终态
 *    + 重连不重开）与真实运行逐字一致。
 */
async function injectRearmFatalSchema(run: Run): Promise<void> {
  await settle(); // ① 注入前静默（序列记账）
  run.wire.dropNextPeerToHub((bytes) => decodeMessage(bytes).message.kind === 'UPDATE_ACK'); // ②
  run.wire.dropNextHubToPeer((bytes) => decodeMessage(bytes).message.kind === 'CLOSE_OK'); // ③
  injectPeerUpdate(run, (doc) => {
    doc.getMap('SCHEMA').set('text', TEXT_BAD);
  });
  await settleUntil(
    () => run.namespaceState() === 'closing',
    `fatal 注入后进入 closing，当前 ${String(run.namespaceState())}`,
  );
  await settle(); // 事件发射与 CLOSE_NAMESPACE 出站在同一结算续体
  await advanceMs(run, CLOSE_TIMEOUT_ADVANCE_MS); // closeTimeout 本地结算 → closed
  await settle();
}

// ═══════════════════════════ AC1：可观测收敛 ═══════════════════════════

describe('issue #287 AC1：注入 transport 全链路——hub replaceSchema → peer schema-rearm-applied 恰一事件', () => {
  it('hub replaceSchema → 恰一 schema-rearm-applied（新 fingerprint + 复制来的 updatedAt，字段符合 §23.3），hub 侧零事件', async () => {
    const hub = new Collector();
    const peer = new Collector();
    const run = await boot({ hubObserver: hub.observer, peerObserver: peer.observer });
    const hubLease = run.hubFixture?.lease;
    if (hubLease === undefined) throw new Error('无 hub fixture lease');

    expect(peer.rearm(), '初始应零 re-arm 事件').toEqual([]);

    const replaced = await hubLease.replaceSchema({
      schema: { lang: 'vfsl', version: 1, id: run.nsId, text: TEXT_V2 },
      root: { n: 42, extra: 77, note: 'v2' },
    });
    if (!replaced.ok) throw new Error(`hub replaceSchema 失败：${JSON.stringify(replaced)}`);
    await waitRearmCount(peer, 1);
    await settle();

    // 恰一事件 + side 恒 peer（ADR 0018 §4：peer 专属）
    const events = peer.rearm();
    expect(events.length, `re-arm 事件应恰一，实际 ${JSON.stringify(events)}`).toBe(1);
    const applied = events[0] as RearmAppliedEvent;
    expect(applied.type).toBe('schema-rearm-applied');
    expect(applied.side).toBe('peer');
    expect(applied.namespaceId).toBe(run.nsId);

    // 字段与 Hub 侧 active schema 逐值一致（ADR 0018 §2「Peer 的 ActiveSchemaInfo 与 Hub
    // 逐字节一致」）：fingerprint = 新 generation 语义指纹、updatedAt = Hub 起源时间戳
    const hubActive = hubLease.getActiveSchema();
    if (hubActive === null) throw new Error('hub active schema 缺席');
    expect(applied.semanticFingerprint).toBe(hubActive.semanticFingerprint);
    expect(applied.semanticFingerprint).toMatch(FINGERPRINT_RE);
    expect(applied.updatedAt).toBe(hubActive.updatedAt);

    // §23.3 安全清单：键集 ⊆ 冻结白名单（connectionId 握手后在场）、无 schema 文本/ROOT
    const allowed = new Set([
      'type',
      'side',
      'connectionId',
      'namespaceId',
      'semanticFingerprint',
      'updatedAt',
    ]);
    for (const key of Object.keys(applied)) {
      expect(allowed.has(key), `意外键 ${key}`).toBe(true);
    }
    const serialized = JSON.stringify(applied);
    expect(serialized.includes(TEXT_V2)).toBe(false);
    expect(serialized.includes('type ROOT')).toBe(false);

    // peer 业务面同源：getActiveSchema() 已切换（ACK 语义「active schema 已同步切换」）
    const lease = okLease(await run.peerNode.registry.open(PEER_OWNER, run.nsId));
    await schemaReady(lease);
    expect(lease.getActiveSchema()?.semanticFingerprint).toBe(hubActive.semanticFingerprint);
    await lease.release();

    // AC6：hub 侧结构性不可能观测 SCHEMA 投影变化 ⟹ 零 re-arm 事件
    expect(hub.rearm()).toEqual([]);

    await run.peer.stop();
    await settle();
  });

  it('滚动升级判据：连续两次 replaceSchema（第二次纯格式差异）⇒ 恰两事件、fingerprint 不变而 updatedAt 与 hub 逐值一致', async () => {
    const peer = new Collector();
    const run = await boot({ peerObserver: peer.observer });
    const hubLease = run.hubFixture?.lease;
    if (hubLease === undefined) throw new Error('无 hub fixture lease');

    const first = await hubLease.replaceSchema({
      schema: { lang: 'vfsl', version: 1, id: run.nsId, text: TEXT_V2 },
      root: { n: 42, extra: 77, note: 'v2' },
    });
    if (!first.ok) throw new Error(`第一次 replaceSchema 失败：${JSON.stringify(first)}`);
    await waitRearmCount(peer, 1);

    const second = await hubLease.replaceSchema({
      schema: { lang: 'vfsl', version: 1, id: run.nsId, text: TEXT_V2_FMT },
      root: { n: 42, extra: 77, note: 'v2' },
    });
    if (!second.ok) throw new Error(`第二次 replaceSchema 失败：${JSON.stringify(second)}`);
    await waitRearmCount(peer, 2);
    await settle();

    const events = peer.rearm() as RearmAppliedEvent[];
    expect(events.length, '两次提交 ⇒ 两次安装 ⇒ 恰两事件（不据 fingerprint 跳过）').toBe(2);
    const hubActive = hubLease.getActiveSchema();
    if (hubActive === null) throw new Error('hub active schema 缺席');
    // 纯格式差异：两次 fingerprint 相同（语义等价）；第二次与 hub 当前值逐值一致
    expect(events[0]!.semanticFingerprint).toBe(events[1]!.semanticFingerprint);
    expect(events[1]!.semanticFingerprint).toBe(hubActive.semanticFingerprint);
    expect(events[1]!.updatedAt).toBe(hubActive.updatedAt);
    // 检测成本纪律的反面锚：`text` 字节变化才 re-arm——两次提交两次事件，无第三次
    expect(peer.rearm().length).toBe(2);

    await run.peer.stop();
    await settle();
  });

  it('updatedAt 诚实缺席：复制来的 META.schema 载体被抹除 → 事件 updatedAt = null（peer 永不读本地时钟兜底）', async () => {
    const peer = new Collector();
    const run = await boot({ peerObserver: peer.observer });
    await settle(); // 注入前静默（见 injectPeerUpdate 的序列记账前提）

    const bytes = injectPeerUpdate(run, (doc) => {
      doc.getMap('SCHEMA').set('text', TEXT_V2);
      doc.getMap('META').delete('schema');
    });
    expect(bytes, '注入帧非空（真实 UPDATE 载荷）').toBeGreaterThan(0);
    await waitRearmCount(peer, 1);
    await settle();

    const applied = peer.rearm()[0] as RearmAppliedEvent;
    expect(applied.type).toBe('schema-rearm-applied');
    expect(applied.updatedAt, 'META.schema 缺席 ⇒ null（绝不伪造，零本地时钟兜底）').toBeNull();
    expect(applied.semanticFingerprint).toMatch(FINGERPRINT_RE);

    await run.peer.stop();
    await settle();
  });
});

// ═══════════════════════════ AC2：fatal 快速失败 ═══════════════════════════

describe('issue #287 AC2/AC5：fatal —— schema-rearm-failed 恰一 + 主动 CLOSE_NAMESPACE + closed 终态 + 重连不重开', () => {
  it('re-arm fatal → 恰一 schema-rearm-failed(INVALID) + 主动 CLOSE_NAMESPACE + closed 终态；零 namespace-failed、连接不被株连', async () => {
    const peer = new Collector();
    const run = await boot({ peerObserver: peer.observer });
    const rejections = collectUnhandledRejections();
    const closeFramesBefore = run.peerFramesAll('CLOSE_NAMESPACE').length;

    await injectRearmFatalSchema(run);
    expect(run.namespaceState(), 'closeTimeout 本地结算 → closed 终态').toBe('closed');

    // 恰一事件 + 稳定码（双码之一）+ safe-field 键集（§23.3：无 schema 文本/ROOT/堆栈）
    const failures = peer.of('schema-rearm-failed') as RearmFailedEvent[];
    expect(failures.length, `应恰一 schema-rearm-failed，实际 ${JSON.stringify(failures)}`).toBe(1);
    expect(failures[0]!.side).toBe('peer');
    expect(failures[0]!.code).toBe(REARM_INVALID);
    const allowed = new Set(['type', 'side', 'connectionId', 'namespaceId', 'code']);
    for (const key of Object.keys(failures[0]!)) {
      expect(allowed.has(key), `意外键 ${key}`).toBe(true);
    }
    const serialized = JSON.stringify(failures[0]);
    // 腐坏 SCHEMA 文本零外溢：断言面必须是**本用例真正注入的**文本（TEXT_BAD）——
    // 初版断言 TEXT_V2（本用例从未出现的字符串）恒真，对泄漏无可判伪力（复审修正）。
    // `type ROOT` 面保留为补充判据（两段 fixture 文本的公共前缀）。
    expect(serialized.includes(TEXT_BAD), '不含被注入的腐坏 schema 文本').toBe(false);
    expect(serialized.includes('type ROOT'), '不含 SCHEMA 内容').toBe(false);
    // Runtime fatal 摘要同样不进事件（稳定 issue 摘要留在 getStatus()）——事件树深扫
    const fatalSummaryLeak = JSON.stringify(peer.events);
    expect(fatalSummaryLeak.includes(TEXT_BAD), '全事件面零 schema 文本').toBe(false);
    expect(fatalSummaryLeak.includes('re-arm invalid'), '零 Runtime fatal message 文本').toBe(false);
    expect(peer.rearm().length, 'fatal ⇒ 恰一 re-arm 事件（无 applied）').toBe(1);
    expect(peer.of('schema-rearm-applied')).toEqual([]);

    // 主动 CLOSE_NAMESPACE（ADR 0018 §3：诚实快速失败——不是 failed 终态 + 无限重连）
    expect(run.peerFramesAll('CLOSE_NAMESPACE').length).toBe(closeFramesBefore + 1);
    // 终态 closed（双侧资源立即释放——CLOSE_OK 往返已结算）
    expect(run.namespaceState()).toBe('closed');
    // 零 namespace-failed：本事实不是「本笔 apply 失败」（apply 已成功提交）——
    // 告警路由以 schema-rearm-failed 为 schema 类根因判据（§23.1）
    expect(peer.of('namespace-failed')).toEqual([]);
    // 连接侧健康：fatal 是 namespace 粒度动作，不株连连接（收口全程连接保持 ready，
    // 零 connection-failed——见注入器的两处丢帧说明）
    expect(run.peer.getConnectionState(), 'fatal 不株连连接').toBe('ready');
    expect(peer.of('connection-failed'), '零 connection-failed').toEqual([]);

    rejections.dispose();
    await run.peer.stop();
    await settle();
  });

  it('fatal 收口后 closed 通道上的迟到 UPDATE 静默忽略：零新事件、零新 CLOSE_NAMESPACE 帧、零新收口', async () => {
    const peer = new Collector();
    const run = await boot({ peerObserver: peer.observer });
    const rejections = collectUnhandledRejections();

    await injectRearmFatalSchema(run);
    const closeFramesAfterFatal = run.peerFramesAll('CLOSE_NAMESPACE').length;
    expect(closeFramesAfterFatal, 'fatal 收口恰一 CLOSE_NAMESPACE 帧').toBe(1);

    // —— 迟到的第二笔 re-arm 失败 UPDATE：通道已 closed + intent='removed'。
    //    §11.3 + §D7 `isInboundQuiet()` 在**帧分发入口**静默忽略（终态/失联域），故本笔
    //    连 apply 槽都不会进——「恰一事件/恰一帧」在此由入站静默门保证，不是收口闩锁在
    //    兜底（闩锁的语义见 peer-namespace `rearmFatalClosed` 注释：为**同槽竞态**等
    //    非入站路径的重复 failed outcome 提供同向防御）。
    //    本用例钉的本文件此前未覆盖的契约面：迟到帧零 wire 反噬（既无第二 CLOSE_NAMESPACE
    //    帧，也无 NAMESPACE_STATE_VIOLATION 引发的 namespace-failed / failed 终态降级）。
    //    此处不复用 `injectRearmFatalSchema`——它等待 'closing' 边沿，而本场景是**已经**
    //    closed 的通道（无新闭包 edge），只需注入 + 排空。
    await settle(); // 注入前静默（序列记账）
    const rearmBefore = peer.rearm().length;
    injectPeerUpdate(run, (doc) => {
      doc.getMap('SCHEMA').set('text', TEXT_BAD);
    });
    await settle();

    // §23.1 计数不变量「每次 re-arm fatal 置位恰一事件」的入站面锚：迟到帧既不改状态、
    // 也不重发事件/帧（闩锁与入站静默门同向；本条钉可观测面，不声称闩锁是唯一保证）。
    expect(
      peer.of('schema-rearm-failed').length,
      '迟到失败 outcome 零新事件（恰一闩锁）',
    ).toBe(1);
    expect(peer.rearm().length, 're-arm 事件总数恒一').toBe(rearmBefore);
    expect(
      run.peerFramesAll('CLOSE_NAMESPACE').length,
      '零新 CLOSE_NAMESPACE 帧（零新收口）',
    ).toBe(closeFramesAfterFatal);
    expect(run.namespaceState(), '仍 closed 终态').toBe('closed');
    expect(peer.of('namespace-failed'), '迟到路径亦零 namespace-failed').toEqual([]);
    expect(rejections.events, '零 unhandled rejection').toEqual([]);
    rejections.dispose();

    await run.peer.stop();
    await settle();
  });

  it('fatal 后重连不自动重开：socket 重连走完仍 closed、零新 OPEN_NAMESPACE、零新事件、无热循环', async () => {
    const peer = new Collector();
    const run = await boot({ peerObserver: peer.observer });
    const rejections = collectUnhandledRejections();

    await injectRearmFatalSchema(run);
    expect(peer.of('schema-rearm-failed').length).toBe(1);
    const opensAfterFatal = run.peerFramesAll('OPEN_NAMESPACE').length;

    // —— 断线 → backoff → 重连 → ready：closed 通道不自动重开（ADR 0018 §3）——
    run.wire.closePeerSide(1006, 'socket-lost');
    await settleUntil(
      () => run.peer.getConnectionState() !== 'ready',
      `断连可观测，当前 ${run.peer.getConnectionState()}`,
    );
    await advanceMs(run, 200); // 只推进 backoff 首拨段（默认 base=100 ⇒ delay < 100ms）
    await run.waitConnection('ready');
    await settle();

    expect(run.peer.getConnectionState()).toBe('ready');
    expect(run.namespaceState(), '重连后 closed 不重开（显式 re-add 才恢复）').toBe('closed');
    expect(run.peerFramesAll('OPEN_NAMESPACE').length, '重连后零新 OPEN_NAMESPACE').toBe(
      opensAfterFatal,
    );
    // 零新事件（既无 re-arm 事件，也无 namespace-failed{cause:session-open-failed}）
    expect(peer.rearm().length, '零重试循环：重连不产生新 re-arm 事件').toBe(1);
    expect(peer.of('namespace-failed')).toEqual([]);
    expect(rejections.events, '零 unhandled rejection').toEqual([]);
    rejections.dispose();

    await run.peer.stop();
    await settle();
  });

  it('显式 re-add 是唯一恢复入口：fatal closed 后 addTarget 触发重建 + 新 OPEN_NAMESPACE', async () => {
    const peer = new Collector();
    const run = await boot({ peerObserver: peer.observer });

    await injectRearmFatalSchema(run);
    const opensAfterFatal = run.peerFramesAll('OPEN_NAMESPACE').length;

    // ADR 0018 §3 恢复入口之一：显式 re-add（closed/conflicted/failed 后的重 add → 整连接重建）
    run.peer.addTarget({ namespaceId: run.nsId, localOwner: PEER_OWNER });
    await settleUntil(
      () => run.peerFramesAll('OPEN_NAMESPACE').length > opensAfterFatal,
      `显式 re-add 后新 OPEN_NAMESPACE，当前 ${run.peerFramesAll('OPEN_NAMESPACE').length}`,
    );
    await settle();
    // 恢复入口确实重新打开了通道（新 OPEN_NAMESPACE 帧在场；后续收敛由 bootstrap/reconcile
    // 接管——本用例只钉「显式 re-add 可达」，不重复 #286 的 P0 不对称语义断言）
    expect(run.peerFramesAll('OPEN_NAMESPACE').length).toBe(opensAfterFatal + 1);

    await run.peer.stop();
    await settle();
  });
});

// ═══════════════════════════ AC3：断连追赶 ═══════════════════════════

describe('issue #287 AC3：断连 Peer 重连后经 reconcile apply 完成 re-arm（无显式通知帧）', () => {
  it('hub replaceSchema 在 peer 离线窗口丢失 → 重连 reconcile 的 SYNC_STEP2 apply 激活 re-arm', async () => {
    const peer = new Collector();
    const run = await boot({ peerObserver: peer.observer });
    const hubLease = run.hubFixture?.lease;
    if (hubLease === undefined) throw new Error('无 hub fixture lease');

    // —— 离线窗口：本笔 UPDATE 在途丢失（真实网络丢帧形态），peer 未收到 ——
    run.wire.dropNextHubToPeer((bytes) => {
      const decoded = decodeMessage(bytes);
      return decoded.message.kind === 'UPDATE' && decoded.message.namespaceId === run.nsId;
    });
    const replaced = await hubLease.replaceSchema({
      schema: { lang: 'vfsl', version: 1, id: run.nsId, text: TEXT_V2 },
      root: { n: 42, extra: 77, note: 'v2' },
    });
    if (!replaced.ok) throw new Error(`hub replaceSchema 失败：${JSON.stringify(replaced)}`);
    await settle();
    expect(run.wire.droppedHubToPeer.length, 'UPDATE 被丢帧（peer 未收到）').toBeGreaterThan(0);
    expect(snapshot(run, 'peer').getMap('SCHEMA').get('text'), 'peer 停留 genesis').not.toBe(TEXT_V2);
    expect(peer.rearm(), '离线期间零 re-arm 事件').toEqual([]);

    // —— 断 socket → backoff → 重连 → reconcile（SYNC_STEP1/STEP2）——
    run.wire.closePeerSide(1006, 'socket-lost');
    await settleUntil(
      () => run.peer.getConnectionState() !== 'ready',
      `断连可观测，当前 ${run.peer.getConnectionState()}`,
    );
    await advanceMs(run, 200); // 只推进 backoff 首拨段（默认 base=100 ⇒ delay < 100ms）
    await run.waitConnection('ready');
    await waitRearmCount(peer, 1);
    await settle();

    // 追赶完成：SCHEMA 收敛 + 恰一 re-arm 事件（无需任何显式通知帧）
    expect(snapshot(run, 'peer').getMap('SCHEMA').get('text')).toBe(TEXT_V2);
    const applied = peer.rearm()[0] as RearmAppliedEvent;
    expect(applied.type).toBe('schema-rearm-applied');
    const hubActive = hubLease.getActiveSchema();
    if (hubActive === null) throw new Error('hub active schema 缺席');
    expect(applied.semanticFingerprint).toBe(hubActive.semanticFingerprint);
    expect(applied.updatedAt).toBe(hubActive.updatedAt);
    // 追赶路径确为 reconcile：双向 Step 帧在场
    const stepped =
      run.hubFramesAll('SYNC_STEP1').length +
      run.peerFramesAll('SYNC_STEP2').length +
      run.hubFramesAll('SYNC_STEP2').length;
    expect(stepped, 'reconcile Step 帧在场（追赶路径确为 reconcile）').toBeGreaterThan(0);
    expect(run.peer.getConnectionState()).toBe('ready');

    await run.peer.stop();
    await settle();
  });
});

// ═══════════════════════════ AC4：hub 反向 conformance ═══════════════════════════

describe('issue #287 AC6：角色不对称——hub 侧永不发射 re-arm 事件（conformance 反向断言）', () => {
  it('hub 全生命周期（自身 replaceSchema/peer 写/重连）零 re-arm 事件；peer 侧对照恰一', async () => {
    const hub = new Collector();
    const peer = new Collector();
    const run = await boot({ hubObserver: hub.observer, peerObserver: peer.observer });
    const hubLease = run.hubFixture?.lease;
    if (hubLease === undefined) throw new Error('无 hub fixture lease');

    // ① hub 本地 replaceSchema（经 hub SCHEMA 写槽安装——那不是 re-arm）
    const replaced = await hubLease.replaceSchema({
      schema: { lang: 'vfsl', version: 1, id: run.nsId, text: TEXT_V2 },
      root: { n: 42, extra: 77, note: 'v2' },
    });
    if (!replaced.ok) throw new Error(`hub replaceSchema 失败：${JSON.stringify(replaced)}`);
    await waitRearmCount(peer, 1);
    await settle();

    // ② peer 业务写（peer→hub 增量复制，hub apply 槽照常）
    await run.writePeer({ n: 43 });
    await settle();
    // ③ 断线重连（hub 侧 connection/channel 全轮回）
    run.wire.closePeerSide(1006, 'socket-lost');
    await settleUntil(
      () => run.peer.getConnectionState() !== 'ready',
      `断连可观测，当前 ${run.peer.getConnectionState()}`,
    );
    await advanceMs(run, 200);
    await run.waitConnection('ready');
    await settle();

    expect(hub.rearm(), 'hub 侧结构性零 re-arm 事件').toEqual([]);
    expect(peer.rearm().length, 'peer 侧对照：恰一（观测面在场、事件可发射）').toBe(1);
    // hub apply 槽的 SCHEMA 投影结构性不变：peer→hub 方向 protected-field 检查拒绝一切
    // SCHEMA 变化（ADR 0018 §6「Hub 行为不变」）
    expect(snapshot(run, 'hub').getMap('SCHEMA').get('text')).toBe(TEXT_V2);

    await run.peer.stop();
    await settle();
  });

  it('AC4 因果面：peer→hub 的 SCHEMA 变化被 protected-field 检查拒绝 → hub 观测面零 re-arm 事件、hub SCHEMA 投影不变', async () => {
    // 上一条只断「hub 的事件集为空」——空集在没有 peer→hub SCHEMA 变更尝试时也会绿。
    // 本条把 ADR 0018 §6 / 协议 AC4 的**因果**打实：peer 侧对 SCHEMA 容器的任何改动在
    // hub 的 apply 槽被 `PROTECTED_FIELD_MUTATION` 整体拒绝（零写入），故 hub 的
    // `schemaBefore.text !== schemaAfter.text` 永不成立、re-arm 结算点结构性不可达。
    const hub = new Collector();
    const peer = new Collector();
    const run = await boot({ hubObserver: hub.observer, peerObserver: peer.observer });
    const hubLease = run.hubFixture?.lease;
    if (hubLease === undefined) throw new Error('无 hub fixture lease');

    const genesis = String(snapshot(run, 'hub').getMap('SCHEMA').get('text'));

    // peer 侧改动 SCHEMA（原始 doc 篡改——模拟对端复制来的非法变更；真实增量报文 =
    // 相对 hub 状态向量的 diff，沿既有 issue #256 场景 5 同款构造）
    const clone = snapshot(run, 'peer');
    (clone.getMap('SCHEMA') as unknown as Map<string, unknown>).set('text', TEXT_BAD);
    const evil = Y.encodeStateAsUpdate(clone, run.stateVectorOf('peer'));
    run.injectPeer({ kind: 'UPDATE', namespaceId: run.nsId, update: evil });
    await settle();

    // hub 侧保护检查拒绝：PROTECTED_FIELD_MUTATION（零 live 写入）
    const hubErrors = hub.of('namespace-error').filter((e) => e.direction === 'sent');
    expect(
      hubErrors.map((e) => e.code),
      `hub 应回 PROTECTED_FIELD_MUTATION，实际 ${JSON.stringify(hubErrors)}`,
    ).toContain('PROTECTED_FIELD_MUTATION');
    // hub SCHEMA 投影不变（拒绝 = 零写入）
    expect(snapshot(run, 'hub').getMap('SCHEMA').get('text'), 'hub SCHEMA 未被污染').toBe(genesis);
    // 因果结论：hub 侧零 re-arm 事件（apply 槽结构性不可能观测 SCHEMA 投影变化）
    expect(hub.rearm(), 'hub 侧零 re-arm 事件（含被拒绝的 peer SCHEMA 变更）').toEqual([]);
    // hub 侧 active schema 身份亦不动
    expect(hubLease.getActiveSchema()?.semanticFingerprint).toBeDefined();

    await run.peer.stop();
    await settle();
  });
});

describe('issue #287 AC7：observer 缺省——零事件构造、零时钟调用；re-arm 行为不依赖观测面', () => {
  it('无 observer：成功路径照常安装（peer getActiveSchema 已切换）且全程零时钟调用', async () => {
    let clockCalls = 0;
    const spyClock: ReplicationClock = {
      now: () => {
        clockCalls += 1;
        return 1_000;
      },
    };
    const run = await boot({ peerClock: spyClock });
    const hubLease = run.hubFixture?.lease;
    if (hubLease === undefined) throw new Error('无 hub fixture lease');

    const replaced = await hubLease.replaceSchema({
      schema: { lang: 'vfsl', version: 1, id: run.nsId, text: TEXT_V2 },
      root: { n: 42, extra: 77, note: 'v2' },
    });
    if (!replaced.ok) throw new Error(`hub replaceSchema 失败：${JSON.stringify(replaced)}`);
    await settle();
    expect(
      snapshot(run, 'peer').getMap('SCHEMA').get('text'),
      're-arm 安装不依赖 observer',
    ).toBe(TEXT_V2);
    const hubActive = hubLease.getActiveSchema();
    const lease = okLease(await run.peerNode.registry.open(PEER_OWNER, run.nsId));
    await schemaReady(lease);
    expect(lease.getActiveSchema()?.semanticFingerprint).toBe(hubActive?.semanticFingerprint);
    await lease.release();
    expect(clockCalls, '无 observer ⇒ 热路径零时钟调用').toBe(0);

    await run.peer.stop();
    await settle();
    expect(clockCalls, '收口路径亦零时钟调用').toBe(0);
  });

  it('无 observer：fatal 路径的通道行为（主动 CLOSE_NAMESPACE + closed 终态）照常，零时钟调用', async () => {
    let clockCalls = 0;
    const spyClock: ReplicationClock = {
      now: () => {
        clockCalls += 1;
        return 1_000;
      },
    };
    const run = await boot({ peerClock: spyClock }); // 不注入 observer

    await injectRearmFatalSchema(run);
    expect(run.namespaceState()).toBe('closed');
    expect(run.peerFramesAll('CLOSE_NAMESPACE').length, '主动关闭不依赖 observer').toBe(1);
    expect(clockCalls, 'fatal 收口路径零时钟调用').toBe(0);

    await run.peer.stop();
    await settle();
  });
});
