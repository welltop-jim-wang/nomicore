/**
 * SA6 红灯契约 —— issue #169：连接级背压记账 / 控制保留额度 / poll 公式与协议 §17
 * 权威文本对齐（`docs/protocols/instance-replication-v1.md` §17 L479–510）。
 *
 * 缺陷面（SA5 分析，2026-08-29）：
 *  S1 预算击穿：同步栈连发 + transport bufferedAmount 异步滞后时，pending-handoff
 *     （已交接未吸收）字节对 admission 账本不可见 → 总压远超 maxQueuedBytesPerConnection；
 *  S2 poll 间隔固定 1000ms，权威公式 = max(1, floor(ackTimeoutMs/100))；
 *  S3 控制额度 = 「暂停段累计已发字节」，socket 冲刷不释放；缺省 64 KiB 自伤
 *     （< maxBootstrapBytes 缺省 4 MiB：暂停窗口内合法 BOOTSTRAP_SNAPSHOT 直接误杀 1011）；
 *  S4 shed 恢复目标停在 cap，协议要求 queued 侧 ≤ lowWater；
 *  S5 字段 controlReserveBytes(64 KiB) ≠ 协议 maxQueuedControlBytes(缺省 8 MiB，
 *     且 ≥ maxBootstrapBytes + 协议开销)；启动期响亮校验缺失；
 *  S6 严格接纳缺失：shed 后（或空队列时）接纳 incoming 仍越限 → 应拒纳该帧 + 同批丢弃
 *     该 ns 幸存排队帧（needs-resync 声明显影）；现实现先入队再触发 shed，若自身 ns
 *     非最大 victim 则被静默接纳。
 *
 * 测试纪律：直构真实 `ConnectionSender` + 真实 `OutboundQueue` + 真实 codec
 * （encodeMessage）——仅传输边界（emitRaw / bufferedAmount）与注入调度器为 seam
 * （协议既定的可注入边界，见 ADT 0009 / DuplexTransport）；唯一 E2E（G9）用真实
 * HubReplication/PeerReplication + 可控 bufferedAmount 的内存 duplex 验证
 * close(1011) 接线。零 real sleep、零 skip、零源码 grep 断言；模块导出断言仅用于
 * 契约字段存在性（G7a/G7b——真·模块级断言，禁止降级为源码文本 grep）。
 *
 * 注（双相位兼容）：S5 的字段迁移契约（controlReserveBytes → maxQueuedControlBytes）
 * 使本文件在「当前实现（携带旧字段）→ 修复后（仅新字段）」两个相位都必须可编译。
 * 旧字段引用一律经 `as Partial<ReplicationLimits>` / `Record<string, unknown>` 断言；
 * 测试侧 limits 上的 `controlReserveBytes` 仅供当前相位的宿 Hook（修复后可整体忽略，
 * 由 G7b 断言其从生产缺省物移除）。
 */
import { describe, expect, it } from 'vitest';
import { createHubReplication, createPeerReplication } from '@nomicore/ws-replication';
import type {
  DuplexTransport,
  HubReplication,
  PeerReplication,
  ReplicationLimits,
} from '@nomicore/ws-replication';
import { createRegistryTestScheduler } from '@nomicore/namespace-registry/testing';
import { decodeMessage, encodeMessage, type ReplicationMessage } from '@nomicore/replication-protocol';
import { ConnectionSender, type ConnectionSenderHost } from '../src/backpressure.js';
import { DEFAULT_REPLICATION_LIMITS, resolveLimits } from '../src/defaults.js';
import { codecFieldLimits, OutboundQueue } from '../src/frame-io.js';
import { validateLimits } from '../src/validate.js';
import {
  HUB_INSTANCE,
  HUB_OWNER,
  PEER_INSTANCE,
  PEER_OWNER,
  makeNode,
  okLease,
  schemaReady,
  settle,
  settleUntil,
} from './harness.js';
import { DEFAULT_PEER_VERIFIER, makeAuthorizer, TEST_TOKEN } from './driver.js';
import type { ReplicaNode } from './harness.js';

// ═══════════════════════════ 公共常量 / 探针 ═══════════════════════════

/** 协议 §17：maxQueuedControlBytes ≥ maxBootstrapBytes + 协议开销（validate.ts 同值 128）。 */
const PROTOCOL_OVERHEAD_BYTES = 128;

const NS_A = 'ns-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const NS_B = 'ns-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

const PAYLOAD_16K = 16 * 1024;

function updateFrame(namespaceId: string, payloadBytes: number): ReplicationMessage {
  return { kind: 'UPDATE', namespaceId, update: new Uint8Array(payloadBytes) };
}

function bootstrapFrame(namespaceId: string, payloadBytes: number): ReplicationMessage {
  return {
    kind: 'BOOTSTRAP_SNAPSHOT',
    namespaceId,
    replicationId: '1'.repeat(32),
    replicationEpoch: 1,
    snapshot: new Uint8Array(payloadBytes),
  };
}

/** 真实 codec 探针：一帧 UPDATE（sequence=1）的编码后字节数（判定基准与 measureFrame 同源）。 */
function encodedUpdateBytes(payloadBytes: number, limits: Readonly<ReplicationLimits>): number {
  return encodeMessage(updateFrame(NS_A, payloadBytes), {
    sequence: 1,
    maxFrameBytes: limits.maxFrameBytes,
    limits: codecFieldLimits(limits),
  }).byteLength;
}

// ═══════════════════════════ 直构 harness（D4 同款：fake scheduler + 手控 bufferedAmount） ═══════════════════════════

interface HarnessLimits extends ReplicationLimits {
  /** 权威契约字段（协议 §17 L492）。当前实现尚无——经 HarnessLimits 接口在测试侧先固化。 */
  readonly maxQueuedControlBytes: number;
}

/** 拼接 limits：DEFAULT 基底 + 覆盖 + 权威字段（旧字段名经 as 断言，双相位可编译）。 */
function makeLimits(
  over: Readonly<Partial<ReplicationLimits>> & { readonly controlReserveBytes?: number },
  maxQueuedControlBytes: number,
): HarnessLimits {
  return {
    ...resolveLimits(over as Partial<ReplicationLimits>),
    maxQueuedControlBytes,
  };
}

interface Facet {
  readonly nsId: string;
  readonly items: ReplicationMessage[];
  queuedBytes(): number;
  queuedCount(): number;
  pullAndSendOne(): boolean;
  discardForConnectionPressure(): void;
}

function makeFacetImpl(
  nsId: string,
  items: ReplicationMessage[],
  discardLog: string[],
  senderRef: () => ConnectionSender,
): Facet {
  return {
    nsId,
    items,
    queuedBytes: () =>
      items.reduce(
        (sum, message) =>
          sum +
          (message.kind === 'UPDATE'
            ? message.update.byteLength
            : message.kind === 'BOOTSTRAP_SNAPSHOT'
              ? message.snapshot.byteLength
              : 0),
        0,
      ),
    queuedCount: () => items.length,
    pullAndSendOne: () => {
      const item = items.shift();
      if (item === undefined) return false;
      senderRef().tryEmitData(item);
      return true;
    },
    discardForConnectionPressure: () => {
      discardLog.push(nsId);
      items.length = 0;
    },
  };
}

interface Harness {
  readonly limits: HarnessLimits;
  readonly sender: ConnectionSender;
  readonly facets: Map<string, Facet>;
  readonly discardLog: string[];
  readonly exhaustedCount: number;
  readonly emittedControl: ReplicationMessage[];
  readonly emittedData: ReplicationMessage[];
  readonly wireControlBytes: number;
  readonly wireDataBytes: number;
  readonly scheduler: { advanceBy(milliseconds: number): Promise<void> };
  buffered(): number;
  setBuffered(level: number): void;
  makeFacet(nsId: string, items: ReplicationMessage[]): Facet;
}

function makeHarness(limits: HarnessLimits, ackTimeoutMs = 10_000): Harness {
  const scheduler = createRegistryTestScheduler();
  let buffered = 0;
  let exhaustedCount = 0;
  let wireControlBytes = 0;
  let wireDataBytes = 0;
  const emittedControl: ReplicationMessage[] = [];
  const emittedData: ReplicationMessage[] = [];
  const facets = new Map<string, Facet>();
  const discardLog: string[] = [];
  let sender!: ConnectionSender;
  const queue = new OutboundQueue(
    () => undefined,
    limits,
    () => undefined,
    (info) => {
      if (info.kind === 'control') wireControlBytes += info.byteLength;
      else wireDataBytes += info.byteLength;
      sender.onEmitted(info);
    },
  );
  sender = new ConnectionSender({
    limits,
    timer: scheduler,
    readBufferedAmount: () => buffered,
    emitControl: (message: ReplicationMessage) => {
      const seq = queue.sendControl(message);
      emittedControl.push(message);
      return seq;
    },
    emitData: (message: ReplicationMessage) => {
      const seq = queue.emit(message);
      emittedData.push(message);
      return seq;
    },
    facetOf: (namespaceId: string) => facets.get(namespaceId),
    isEmitAllowed: () => true,
    onBackpressureExhausted: () => {
      exhaustedCount += 1;
    },
    ackTimeoutMs, // 权威 poll 公式输入（协议 §17 L492）；当前实现未消费——双相位兼容
  } as unknown as ConnectionSenderHost);
  return {
    limits,
    sender,
    facets,
    discardLog,
    get exhaustedCount() {
      return exhaustedCount;
    },
    get emittedControl() {
      return emittedControl;
    },
    get emittedData() {
      return emittedData;
    },
    get wireControlBytes() {
      return wireControlBytes;
    },
    get wireDataBytes() {
      return wireDataBytes;
    },
    scheduler,
    buffered: () => buffered,
    setBuffered: (level: number) => {
      buffered = level;
    },
    makeFacet: (nsId: string, items: ReplicationMessage[]) => {
      const facet = makeFacetImpl(nsId, items, discardLog, () => sender);
      facets.set(nsId, facet);
      return facet;
    },
  };
}

// ═══════════════════════════ G1：预算击穿（S1） ═══════════════════════════

describe('issue #169 G1：同步栈连发 + bufferedAmount 滞后——总压 ≤ 预算（严格接纳）', () => {
  it('G1：10×16KiB 直发、bufferedAmount 恒 0（滞后）——放行帧数 = floor(cap/帧长)，上线字节 ≤ cap，零 1011', () => {
    const cap = 64 * 1024;
    const limits = makeLimits(
      { maxQueuedBytesPerConnection: cap, lowWater: 1024, highWater: 8 * 1024 },
      cap,
    );
    const frameBytes = encodedUpdateBytes(PAYLOAD_16K, limits);
    expect(frameBytes, '探针：16 KiB UPDATE 帧长').toBeGreaterThan(0);
    const expectedAdmitted = Math.floor(cap / frameBytes);
    expect(expectedAdmitted, '前置：budget 装不下全部 10 帧（构造有效）').toBeLessThan(10);

    const h = makeHarness(limits);
    // 模拟 UpdateChannel.deliver live 直发路径：同一同步栈内 10 次 sendData →
    // sender.tryEmitData；transport bufferedAmount 异步滞后（恒 0）。
    for (let i = 0; i < 10; i += 1) {
      h.sender.tryEmitData(updateFrame(NS_A, PAYLOAD_16K));
    }
    expect(h.emittedData.length, '严格接纳：放行帧数受预算约束').toBe(expectedAdmitted);
    expect(h.wireDataBytes, '总压（上线字节）恒 ≤ cap').toBeLessThanOrEqual(cap);
    expect(h.exhaustedCount, '拒纳不是 1011 收口').toBe(0);
  });

  it('G1b：非暂停 control handoff + bufferedAmount 滞后——紧随 data 不得越过 connection cap', () => {
    const control = bootstrapFrame(NS_A, 1024);
    const data = updateFrame(NS_A, PAYLOAD_16K);
    const probeLimits = makeLimits(
      { maxQueuedBytesPerConnection: 64 * 1024, lowWater: 1024, highWater: 32 * 1024 },
      8 * 1024 * 1024,
    );
    const controlBytes = encodeMessage(control, {
      sequence: 1,
      maxFrameBytes: probeLimits.maxFrameBytes,
      limits: codecFieldLimits(probeLimits),
    }).byteLength;
    const dataBytes = encodedUpdateBytes(PAYLOAD_16K, probeLimits);
    const cap = controlBytes + dataBytes - 1;
    const limits = makeLimits(
      { maxQueuedBytesPerConnection: cap, lowWater: 1024, highWater: cap },
      8 * 1024 * 1024,
    );
    const h = makeHarness(limits);

    h.sender.sendControl(control); // 未暂停；transport bufferedAmount 仍为 0（异步滞后）
    h.sender.tryEmitData(data);

    expect(h.emittedControl, 'control 已交接上线').toHaveLength(1);
    expect(h.emittedData, 'control P2 必须阻止紧随 data 越过 cap').toHaveLength(0);
    expect(h.wireControlBytes + h.wireDataBytes, '上线总字节不越 cap').toBeLessThanOrEqual(cap);
  });
});

// ═══════════════════════════ G2：边界覆盖 ═══════════════════════════

describe('issue #169 G2：边界——恰好 cap / 首帧越界 / 单帧超 cap', () => {
  it('G2a：cap = 3×帧长（恰好）——3 帧放行，第 4 帧（首帧越界）拒纳', () => {
    const frameBytes = 16_443; // 16 KiB UPDATE 编码后（探针值；下方以真实 codec 校对）
    const limits = makeLimits(
      { maxQueuedBytesPerConnection: frameBytes * 3, lowWater: 1024, highWater: 8 * 1024 },
      8 * 1024 * 1024,
    );
    expect(encodedUpdateBytes(PAYLOAD_16K, limits), '帧长探针与用例一致').toBe(frameBytes);
    const h = makeHarness(limits);
    for (let i = 0; i < 4; i += 1) h.sender.tryEmitData(updateFrame(NS_A, PAYLOAD_16K));
    expect(h.emittedData.length, '恰好 cap：3 帧放行').toBe(3);
    expect(h.wireDataBytes, '上线字节 = cap（恰好）').toBe(frameBytes * 3);
  });

  it('G2b：cap = 3×帧长 − 1（首帧即会越界）——2 帧放行', () => {
    const frameBytes = 16_443;
    const limits = makeLimits(
      { maxQueuedBytesPerConnection: frameBytes * 3 - 1, lowWater: 1024, highWater: 8 * 1024 },
      8 * 1024 * 1024,
    );
    const h = makeHarness(limits);
    for (let i = 0; i < 3; i += 1) h.sender.tryEmitData(updateFrame(NS_A, PAYLOAD_16K));
    expect(h.emittedData.length, '第 3 帧即越界 → 拒纳').toBe(2);
  });

  it('G2c：单帧 > cap——0 帧放行（回归锚：既有单帧守卫保持）', () => {
    const frameBytes = 16_443;
    const limits = makeLimits(
      { maxQueuedBytesPerConnection: frameBytes - 1, lowWater: 1024, highWater: 8 * 1024 },
      8 * 1024 * 1024,
    );
    const h = makeHarness(limits);
    h.sender.tryEmitData(updateFrame(NS_A, PAYLOAD_16K));
    expect(h.emittedData.length, '单帧超 cap 拒纳').toBe(0);
  });
});

// ═══════════════════════════ G3：控制额度（S3） ═══════════════════════════

describe('issue #169 G3：控制保留额度——冲刷释放 / 首过限帧不上线 + 恰一次 CONNECTION_BACKPRESSURE', () => {
  const RESERVE = 32 * 1024; // 32,768；约束校验值 = maxBootstrapBytes(16 KiB) + 128 ✓

  function makeControlLimits(): HarnessLimits {
    return makeLimits(
      {
        maxQueuedBytesPerConnection: 64 * 1024,
        lowWater: 1024,
        highWater: 8 * 1024,
        maxBootstrapBytes: 16 * 1024,
        controlReserveBytes: RESERVE, // 当前相位宿 Hook（修复后由 maxQueuedControlBytes 替代）
      },
      RESERVE,
    );
  }

  it('G3a（锚）：冲刷前首个过限控制帧不上线——恰一次 onBackpressureExhausted（1011 接线锚）', () => {
    const h = makeHarness(makeControlLimits());
    h.setBuffered(8 * 1024 + 1); // > highWater → sendControl 观察即暂停
    h.sender.sendControl(bootstrapFrame(NS_A, 16 * 1024)); // 16,477 ≤ 32,768 → 放行
    expect(h.emittedControl, '前置：首帧放行').toHaveLength(1);
    h.sender.sendControl(bootstrapFrame(NS_A, 16 * 1024));
    expect(h.emittedControl, '首过限帧不上线').toHaveLength(1);
    expect(h.exhaustedCount, '恰一次 CONNECTION_BACKPRESSURE').toBe(1);
  });

  it('G3-boundary：重复 enterPause 不得清除暂停态已累积的未冲刷 control 责任', () => {
    const h = makeHarness(makeControlLimits());
    const frame = bootstrapFrame(NS_A, 16 * 1024);

    h.setBuffered(8 * 1024 + 1);
    h.sender.sendControl(frame); // 进入暂停并放行首帧，额度责任已累积
    h.sender.dataGateOpen(); // 再次观察 > highWater；enterPause 幂等且不得清账
    h.sender.sendControl(frame);

    expect(h.emittedControl, '首个会越过 control cap 的帧不上线').toHaveLength(1);
    expect(h.exhaustedCount, '暂停边界保留责任并恰一次耗尽').toBe(1);
  });

  it('G3b（红灯）：socket 全冲刷后额度释放——仍暂停窗口内再次控制帧放行、零 1011', () => {
    const h = makeHarness(makeControlLimits());
    const frameBytes = 16_477; // BOOTSTRAP 16 KiB 编码后（探针值；下方以真实 codec 校对）
    const probe = encodeMessage(bootstrapFrame(NS_A, 16 * 1024), {
      sequence: 1,
      maxFrameBytes: h.limits.maxFrameBytes,
      limits: codecFieldLimits(h.limits),
    }).byteLength;
    expect(probe, '帧长探针与用例一致').toBe(frameBytes);
    // 暂停：buffered = lowWater+1 + 帧长（> highWater）；丢帧长后仍 > lowWater（保持暂停）
    h.setBuffered(1024 + 1 + frameBytes);
    h.sender.sendControl(bootstrapFrame(NS_A, 16 * 1024));
    expect(h.emittedControl, '前置：首帧放行').toHaveLength(1);
    // socket 全冲刷（恰好冲走首帧字节；观察点仍 > lowWater——保持暂停窗口）
    h.setBuffered(1024 + 1);
    h.sender.sendControl(bootstrapFrame(NS_A, 16 * 1024));
    expect(h.emittedControl, '冲刷释放额度：第二帧放行').toHaveLength(2);
    expect(h.exhaustedCount, '零误杀').toBe(0);
  });
});

// ═══════════════════════════ G4：shed 恢复目标（S4） ═══════════════════════════

describe('issue #169 G4：shed 恢复目标 = queued ≤ lowWater，多 victim 最大优先', () => {
  const CAP = 64 * 1024;
  const LOW_WATER = 1024;

  function makeShedLimits(): HarnessLimits {
    return makeLimits(
      { maxQueuedBytesPerConnection: CAP, lowWater: LOW_WATER, highWater: 8 * 1024 },
      8 * 1024 * 1024,
    );
  }

  it('G4（红灯）：ns-a 40KiB + ns-b 25KiB 入队（总 65KiB > cap）——两 ns 均整队丢弃，幸存 queued ≤ lowWater', () => {
    const h = makeHarness(makeShedLimits());
    const a = h.makeFacet(NS_A, [updateFrame(NS_A, 40 * 1024)]);
    const b = h.makeFacet(NS_B, [updateFrame(NS_B, 25 * 1024)]);
    h.sender.onDataQueued(NS_A);
    h.sender.onDataQueued(NS_B);
    expect(a.items, '最大 victim（ns-a）先被整队丢弃').toHaveLength(0);
    expect(b.items, '恢复目标 = queued ≤ lowWater：ns-b 幸存帧亦被丢弃').toHaveLength(0);
    expect(b.queuedBytes(), '幸存 queued 侧 ≤ lowWater').toBeLessThanOrEqual(LOW_WATER);
    expect(h.discardLog, 'victim 选择 = 最大 queued 优先').toEqual([NS_A, NS_B]);
  });

  it('G4b（锚）：单 ns 超 cap 且另一 ns 未超——仅超限 victim 被丢弃，幸存 ns 保留', () => {
    const h = makeHarness(makeShedLimits());
    const a = h.makeFacet(NS_A, [updateFrame(NS_A, 70 * 1024)]);
    const b = h.makeFacet(NS_B, [updateFrame(NS_B, 800)]);
    h.sender.onDataQueued(NS_A);
    h.sender.onDataQueued(NS_B);
    expect(a.items).toHaveLength(0);
    expect(b.items, '未超限 ns 幸存').toHaveLength(1);
    expect(b.queuedBytes(), '幸存 ≤ lowWater').toBeLessThanOrEqual(LOW_WATER);
    expect(h.discardLog).toEqual([NS_A]);
  });
});

// ═══════════════════════════ G5：严格接纳（S6） ═══════════════════════════

describe('issue #169 G5：严格接纳——拒纳越限 incoming + 同批丢弃该 ns 幸存排队帧（不静默纳、不静默吞）', () => {
  it('G5（红灯）：ns-b 入队 12KiB 使总压越限——该帧拒纳、ns-b 幸存帧同批丢弃，零 1011', () => {
    const CAP = 64 * 1024;
    const LOW_WATER = 1024;
    const limits = makeLimits(
      { maxQueuedBytesPerConnection: CAP, lowWater: LOW_WATER, highWater: 8 * 1024 },
      8 * 1024 * 1024,
    );
    const h = makeHarness(limits);
    // 前置：ns-a 37KiB + ns-b 24KiB = 61KiB ≤ cap（无 shed；a 为最大 victim——确保
    // 旧实现 shed 命中 a 而非触发 ns-b，从而暴露「incoming 被静默接纳」的缺陷面）
    const a = h.makeFacet(NS_A, [updateFrame(NS_A, 37 * 1024)]);
    const b = h.makeFacet(NS_B, [updateFrame(NS_B, 24 * 1024)]);
    h.sender.onDataQueued(NS_A);
    h.sender.onDataQueued(NS_B);
    expect(a.items, '前置：入队后尚未触发 shed').toHaveLength(1);
    expect(b.items).toHaveLength(1);
    // incoming 12KiB（ns-b）入队 → 总压 73KiB > cap —— 通道先入队再通知（现实现顺序）
    b.items.push(updateFrame(NS_B, 12 * 1024));
    h.sender.onDataQueued(NS_B);
    expect(b.items, '严格接纳：越限 incoming 拒纳 + ns-b 幸存排队帧同批丢弃（不静默纳）').toHaveLength(0);
    expect(a.items, 'shed 恢复目标 = queued ≤ lowWater（ns-a 整队丢弃）').toHaveLength(0);
    expect(h.exhaustedCount, '拒纳不是 1011 收口').toBe(0);
  });
});

// ═══════════════════════════ G6：poll 间隔公式（S2） ═══════════════════════════

describe('issue #169 G6：poll 间隔 = max(1, floor(ackTimeoutMs/100))', () => {
  function pollHarness(ackTimeoutMs: number): Harness {
    const limits = makeLimits(
      {
        maxQueuedBytesPerConnection: 64 * 1024,
        lowWater: 1024,
        highWater: 8 * 1024,
        controlReserveBytes: 32 * 1024,
      },
      32 * 1024,
    );
    return makeHarness(limits, ackTimeoutMs);
  }

  it('G6a（红灯）：ackTimeoutMs=5000 → 公式 50ms 恢复（1000ms 迟到即失败）', async () => {
    const h = pollHarness(5_000);
    const f = h.makeFacet(NS_A, [updateFrame(NS_A, 16 * 1024)]);
    h.sender.onDataQueued(NS_A);
    h.setBuffered(8 * 1024 + 1); // > highWater → 暂停
    expect(h.sender.dataGateOpen(), '前置：暂停').toBe(false);
    h.sender.requestDrain();
    expect(f.items, '暂停段零派发').toHaveLength(1);
    // socket 回落至 lowWater（保持暂停边界值）→ 权威公式 max(1, floor(5000/100)) = 50ms
    h.setBuffered(1024);
    await h.scheduler.advanceBy(49);
    expect(f.items, '49ms：尚未到公式间隔（50ms）').toHaveLength(1);
    await h.scheduler.advanceBy(1);
    expect(f.items, '50ms：公式间隔恢复 drain').toHaveLength(0);
    expect(h.emittedData, '恢复后数据帧上线').toHaveLength(1);
  });

  it('G6b（红灯）：ackTimeoutMs=1 → max(1, floor(1/100)) = 1ms 恢复', async () => {
    const h = pollHarness(1);
    const f = h.makeFacet(NS_A, [updateFrame(NS_A, 16 * 1024)]);
    h.sender.onDataQueued(NS_A);
    h.setBuffered(8 * 1024 + 1);
    expect(h.sender.dataGateOpen(), '前置：暂停').toBe(false);
    h.setBuffered(1024);
    await h.scheduler.advanceBy(1);
    expect(f.items, '1ms：公式间隔恢复 drain').toHaveLength(0);
  });
});

// ═══════════════════════════ G7：字段 / 缺省 / 约束（S5） ═══════════════════════════

describe('issue #169 G7：maxQueuedControlBytes 权威字段——缺省 8 MiB、旧字段迁移、启动约束', () => {
  it('G7a（红灯）：缺省物携带 maxQueuedControlBytes = 8 MiB', () => {
    const merged = resolveLimits(undefined) as unknown as Record<string, unknown>;
    expect(merged.maxQueuedControlBytes, '协议 §17 缺省 8 MiB').toBe(8 * 1024 * 1024);
  });

  it('G7b（红灯）：旧字段 controlReserveBytes 从缺省物移除（迁移完成）', () => {
    const merged = resolveLimits(undefined) as unknown as Record<string, unknown>;
    expect(merged.controlReserveBytes, '旧契约字段已迁移').toBeUndefined();
    const defaults = DEFAULT_REPLICATION_LIMITS as unknown as Record<string, unknown>;
    expect(defaults.controlReserveBytes).toBeUndefined();
  });

  it('G7c（红灯）：maxQueuedControlBytes < maxBootstrapBytes + 协议开销 → 构造期响亮 TypeError', () => {
    const limits = {
      ...resolveLimits({ maxBootstrapBytes: 64 * 1024 } as Partial<ReplicationLimits>),
      maxQueuedControlBytes: 64 * 1024, // 64 KiB < 64 KiB + 128
    } as unknown as ReplicationLimits;
    expect(() => validateLimits(limits), '启动期响亮验证：不得运行时 clamp').toThrow(TypeError);
  });

  it('G7d（锚）：maxQueuedControlBytes = maxBootstrapBytes + 开销（恰值）与缺省组合均合法', () => {
    const exact = {
      ...resolveLimits({ maxBootstrapBytes: 64 * 1024 } as Partial<ReplicationLimits>),
      maxQueuedControlBytes: 64 * 1024 + PROTOCOL_OVERHEAD_BYTES,
    } as unknown as ReplicationLimits;
    expect(() => validateLimits(exact)).not.toThrow();
    const defaults = resolveLimits(undefined) as unknown as ReplicationLimits;
    expect(() => validateLimits(defaults)).not.toThrow();
  });
});

// ═══════════════════════════ G8：缺省配置自伤（症状 3） ═══════════════════════════

describe('issue #169 G8：缺省配置下暂停窗口内合法 BOOTSTRAP_SNAPSHOT 不被误杀', () => {
  it('G8（红灯）：缺省 limits（旧判据 64KiB）下 100KiB BOOTSTRAP 放行、零 1011', () => {
    const limits = makeLimits({}, 8 * 1024 * 1024); // maxQueuedControlBytes 缺省 8 MiB
    expect(limits.maxQueuedBytesPerConnection, '缺省 cap 前置').toBe(8 * 1024 * 1024);
    expect(limits.highWater, '缺省 highWater 前置').toBe(512 * 1024);
    const h = makeHarness(limits);
    h.setBuffered(512 * 1024 + 1); // > highWater → 暂停窗口
    h.sender.sendControl(bootstrapFrame(NS_A, 100 * 1024));
    expect(h.emittedControl, '100KiB BOOTSTRAP ≤ 8MiB 保留额度：放行').toHaveLength(1);
    expect(h.exhaustedCount, '零误杀').toBe(0);
  });
});

// ═══════════════════════════ G9：E2E——真实 Hub 连接 close(1011) 接线 ═══════════════════════════

/** 可控 bufferedAmount 的 in-memory duplex（hub 侧持久塞住：始终 > highWater）。 */
interface Issue169Wire {
  readonly peerEnd: DuplexTransport;
  readonly hubEnd: DuplexTransport;
  readonly hubToPeer: Uint8Array[];
  readonly peerToHub: Uint8Array[];
  hubClose: Readonly<{ code: number; reason: string }> | undefined;
  peerClose: Readonly<{ code: number; reason: string }> | undefined;
}

function makeIssue169Wire(hubBufferedAmount: number): Issue169Wire {
  const peerListeners = new Set<(bytes: Uint8Array) => void>();
  const peerCloseListeners = new Set<(info: Readonly<{ code: number; reason: string }>) => void>();
  const hubListeners = new Set<(bytes: Uint8Array) => void>();
  const hubCloseListeners = new Set<(info: Readonly<{ code: number; reason: string }>) => void>();
  const hubToPeer: Uint8Array[] = [];
  const peerToHub: Uint8Array[] = [];
  let hubClose: Readonly<{ code: number; reason: string }> | undefined;
  let peerClose: Readonly<{ code: number; reason: string }> | undefined;
  const peerEnd: DuplexTransport = {
    send(bytes: Uint8Array) {
      if (peerClose !== undefined) return;
      const copy = bytes.slice();
      peerToHub.push(copy);
      queueMicrotask(() => {
        for (const listener of [...hubListeners]) listener(copy);
      });
    },
    close(code = 1000, reason = '') {
      if (peerClose !== undefined) return;
      peerClose = { code, reason };
      queueMicrotask(() => {
        for (const listener of [...peerCloseListeners]) listener({ code, reason });
      });
    },
    get closed() {
      return peerClose !== undefined;
    },
    onMessage(listener: (bytes: Uint8Array) => void) {
      peerListeners.add(listener);
      return () => peerListeners.delete(listener);
    },
    onClose(listener: (info: Readonly<{ code: number; reason: string }>) => void) {
      peerCloseListeners.add(listener);
      return () => peerCloseListeners.delete(listener);
    },
  };
  const hubEnd: DuplexTransport = {
    send(bytes: Uint8Array) {
      if (hubClose !== undefined) return;
      const copy = bytes.slice();
      hubToPeer.push(copy);
      queueMicrotask(() => {
        for (const listener of [...peerListeners]) listener(copy);
      });
    },
    close(code = 1000, reason = '') {
      if (hubClose !== undefined) return;
      hubClose = { code, reason };
      queueMicrotask(() => {
        for (const listener of [...hubCloseListeners]) listener({ code, reason });
      });
    },
    get closed() {
      return hubClose !== undefined;
    },
    get bufferedAmount() {
      return hubBufferedAmount; // 模拟 socket 缓冲塞住（异步滞后：发送后仍不回读）
    },
    onMessage(listener: (bytes: Uint8Array) => void) {
      hubListeners.add(listener);
      return () => hubListeners.delete(listener);
    },
    onClose(listener: (info: Readonly<{ code: number; reason: string }>) => void) {
      hubCloseListeners.add(listener);
      return () => hubCloseListeners.delete(listener);
    },
  };
  return { peerEnd, hubEnd, hubToPeer, peerToHub, get hubClose() { return hubClose; }, get peerClose() { return peerClose; } };
}

const ISSUE169_SCHEMA = Object.freeze({
  lang: 'vfsl',
  version: 1,
  id: 'phase5-ws-issue169-backpressure',
  text: 'type ROOT = { n: number; blob: string; };\n',
});

async function makeBigBlobNamespace(node: ReplicaNode, blobBytes: number): Promise<string> {
  const lease = okLease(
    await node.registry.create({
      owner: HUB_OWNER,
      schema: ISSUE169_SCHEMA,
      root: { n: 0, blob: 'x'.repeat(blobBytes) },
    }),
  );
  await schemaReady(lease);
  const enabled = await lease.enableReplication();
  if (!enabled.ok) throw new Error(`enableReplication 失败：${JSON.stringify(enabled)}`);
  return lease.namespaceId;
}

describe('issue #169 G9（E2E）：真实 Hub/Peer 连接——缺省配置下 100KiB 文档 bootstrap 不被 CONNECTION_BACKPRESSURE 误杀（close 1011 接线锚）', () => {
  it('G9（红灯）：hub 侧 socket 塞住（bufferedAmount > highWater）时 100KiB BOOTSTRAP_SNAPSHOT 照常上线；零 ERROR / 零 close', async () => {
    const hubNode = makeNode('hub');
    const peerNode = makeNode('peer');
    const authorizer = makeAuthorizer({});
    const nsId = await makeBigBlobNamespace(hubNode, 100 * 1024);
    const hub: HubReplication = createHubReplication({
      instanceId: HUB_INSTANCE,
      registry: hubNode.registry,
      authorize: authorizer.authorize,
      verifyToken: DEFAULT_PEER_VERIFIER,
      timer: hubNode.scheduler,
    });
    const wires: Issue169Wire[] = [];
    const peer: PeerReplication = createPeerReplication({
      instanceId: PEER_INSTANCE,
      hubInstanceId: HUB_INSTANCE,
      registry: peerNode.registry,
      dial: () => {
        const wire = makeIssue169Wire(512 * 1024 + 1); // 缺省 highWater=512KiB；恒塞住
        wires.push(wire);
        void hub.accept(wire.hubEnd, { token: TEST_TOKEN });
        return wire.peerEnd;
      },
      timer: peerNode.scheduler,
      targets: [{ namespaceId: nsId, localOwner: PEER_OWNER }],
      backoff: { baseMs: 20, maxMs: 100, resetAfterMs: 200 },
      random: () => 0.5,
    });
    peer.start();
    await settleUntil(
      () =>
        (wires[0] !== undefined &&
          (wires[0].hubClose !== undefined || peer.getNamespaceState(nsId) === 'live')) ||
        peer.getConnectionState() === 'backoff',
      'hub 收口或 peer live',
    );
    const wire = wires[0];
    if (wire === undefined) throw new Error('peer 未拨号');
    const bpErrors = wire.hubToPeer.filter((bytes) => {
      const message = decodeMessage(bytes).message;
      return message.kind === 'ERROR' && message.code === 'CONNECTION_BACKPRESSURE';
    });
    expect(wire.hubClose, '缺省 8MiB 控制额度：合法 BOOTSTRAP 不清零连接').toBeUndefined();
    expect(bpErrors, '零 CONNECTION_BACKPRESSURE').toHaveLength(0);
    expect(
      wire.hubToPeer.some((bytes) => decodeMessage(bytes).message.kind === 'BOOTSTRAP_SNAPSHOT'),
      'BOOTSTRAP_SNAPSHOT 实际上线',
    ).toBe(true);
    await peer.stop();
    await settle();
  });
});
