/**
 * SA6 红灯验收契约 — issue #299（#295 切片 1）：snapshot / sync-diff 聚合上限配置链。
 *
 * 契约锚点：
 * - ADR 0019「资源上限与配置链」配置表：`maxChunkedBootstrapBytes` / `maxChunkedSyncDiffBytes`
 *   缺省各 4 MiB，约束各为 `≤ maxChunksPerUpdate × maxUpdateBytes`；安全缺省、启动期响亮验证、
 *   绝不运行时 clamp；`maxChunksPerUpdate` / `maxConcurrentAssembliesPerConnection` /
 *   `assemblyTimeoutMs` 语义推广为 kind 无关、键名不变；`maxQueuedControlBytes ≥
 *   maxBootstrapBytes + 协议开销` 启动校验原样保留（单帧路径仍需要）。
 * - docs/protocols/instance-replication-v1.md §17（启动校验块：两条 #295 链②同形态 +
 *   「不得运行时 clamp」+ 触发键纪律「显式配置 maxChunkedBootstrapBytes/maxChunkedSyncDiffBytes
 *   时对应链式校验响亮生效；未表达新键的存量配置不误判」）。
 * - issue #299 AC3（两键 + 两条链②进入启动响亮验证、control reserve 不变、非追溯性测试）；
 *   SA8 前置门禁 artifacts/sa8-conflict-gate-issue-299.md R35（链②触发键作用域须按 §17 纪律
 *   精确落地：显式下调 `maxChunksPerUpdate` —— #244/#295 两链②共享的操作数键 —— 不得被
 *   「未表达新键」宽读为跳过新链）、R36（append-only 冻结面不动，本文件不触碰错误码注册表）。
 *
 * 红灯条件（实现前必须失败，失败原因是缺实现而非环境/fixture）：
 * - C1：`DEFAULT_REPLICATION_LIMITS` 缺两新键（缺省面未进配置链；键集断言同时锁「键名不变」）；
 * - C2/C3/C4：两条链② 的显式违例（40 MiB > 缺省 product 32 MiB；族内 product+1 越界）当前静默
 *   通过（未知键被忽略）；新键非法值（0 / 非整数 / 负数）当前静默通过；
 * - C7：hub/peer 插件配置严格 allowlist（`LIMIT_KEYS`）当前拒绝两新键（'invalid configuration'）。
 * 边界等号（恰等于 product）必须接纳、off-by-one 必须拒绝——判据 `≤` 与上界算术的敏感度锚点；
 * 边界族把全部链操作数显式化，使该断言对「只校验链②」与「链②+队列链①」两种 §17 读法都成立。
 *
 * 负控（实现前即绿、实现后必须保持绿——证明红不在环境/入口/断言敏感度）：
 * - C5：非追溯性 + 门宽回归（显式 `maxChunksPerUpdate` 仍激活链；仅既有非链键不误判）；
 * - C6：control reserve 校验原样保留（违例 TypeError / 边界恰好合法）。
 *
 * 为什么不锁定 clamp 的「值相等」：`createHubReplication`/`createPeerReplication` 无 resolved
 * limits 公共访问器，本切片的可观察面 = 装配期响亮拒绝（TypeError）而非静默钳制；边界等号
 * 用例（恰好 ≤ 上限必须被接纳）即「合法值不得被 clamp-down 拒绝」的敏感度锚点。
 *
 * 纪律：无 skip/only/todo、无 env override、无 fallback、无源码字符串/正则断言、零 real sleep。
 */
import { Context } from '@deepseek-ai/cordis';
import { describe, expect, it, vi } from 'vitest';
import { provideClock } from '@nomicore/clock';
import { provideInstance } from '@nomicore/instance';
import { provideNomicoreRegistry } from '@nomicore/namespace-registry';
import type { NamespaceRegistry } from '@nomicore/namespace-registry';
import {
  DEFAULT_REPLICATION_LIMITS,
  DEFAULT_REPLICATION_TIMEOUTS,
  createHubReplication,
  createHubReplicationPlugin,
  createPeerReplication,
  createPeerReplicationPlugin,
  requirePeerReplication,
  type DuplexTransport,
  type HubReplicationOptions,
  type ReplicationLimits,
  type PeerReplicationOptions,
} from '@nomicore/ws-replication';

// ---------------------------------------------------------------- 契约常量（规范字面量先行）

const MIB = 1024 * 1024;
/** ADR 0019 配置表：#295 两新键缺省各 4 MiB。 */
const DEFAULT_CHUNKED_BOOTSTRAP_BYTES = 4 * MIB;
const DEFAULT_CHUNKED_SYNC_DIFF_BYTES = 4 * MIB;
/** ADR 0013 配置表：#244 三键（键名与缺省不得因 kind 无关推广而变）。 */
const DEFAULT_MAX_CHUNKED_UPDATE_BYTES = 4 * MIB;
const DEFAULT_MAX_CHUNKS_PER_UPDATE = 64;
const DEFAULT_MAX_CONCURRENT_ASSEMBLIES = 4;
const DEFAULT_ASSEMBLY_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BOOTSTRAP_BYTES = 4 * MIB;
const DEFAULT_MAX_UPDATE_BYTES = 512 * 1024;
/** §17 协议开销常量（与 validate.ts 同值；字面量先行，不 import 实现常量）。 */
const PROTOCOL_OVERHEAD_BYTES = 128;

/** 链②上界算术（缺省构型）：64 × 512 KiB = 32 MiB。 */
const CHAIN2_UPPER_BOUND = DEFAULT_MAX_CHUNKS_PER_UPDATE * DEFAULT_MAX_UPDATE_BYTES;

/**
 * 链②边界族（全部操作数显式，使边界值同时满足任何「聚合上限 ≤ 队列预算」的链①式读法）：
 * product = 4 × 512 KiB = 2 MiB；#244 两链在族内自洽（maxChunkedUpdateBytes 1 MiB ≤ 2 MiB）。
 * 边界用例（bootstrap = 2 MiB 恰好等于 product）因此对「只校验链②」与「链②+队列链①」
 * 两种读法都合法——契约的 `≤` 含等号敏感度不依赖对 §17 校验块的解释。
 */
const CHAIN2_FAMILY = Object.freeze({
  maxChunksPerUpdate: 4,
  maxChunkedUpdateBytes: 1 * MIB,
  maxQueuedUpdateBytes: 2 * MIB,
});
const CHAIN2_FAMILY_BOUND = 4 * DEFAULT_MAX_UPDATE_BYTES; // 2 MiB

// ---------------------------------------------------------------- 配置构造桩（不启动任何连接）

const STUB_REGISTRY = { open: async () => ({ ok: false as const }) } as unknown as NamespaceRegistry;
const STUB_TIMER = {
  setTimeout: () => 1 as unknown,
  clearTimeout: () => undefined as void,
};

/**
 * 新键在实现前不在 `ReplicationLimits` 类型面（契约先行）——运行时合并结果仍必须被响亮校验。
 * cast 仅用于让契约文件在当前 HEAD tsc 干净；断言全部落在运行时行为（构造期 TypeError / 接纳）。
 */
function withLimit(overrides: Readonly<Record<string, number>>): Readonly<Partial<ReplicationLimits>> {
  return overrides as unknown as Readonly<Partial<ReplicationLimits>>;
}

function hubOptionsWith(limits: Readonly<Partial<ReplicationLimits>>): HubReplicationOptions {
  return {
    instanceId: 'hub-ac',
    registry: STUB_REGISTRY,
    authorize: async () => ({ ok: false as const }),
    timer: STUB_TIMER,
    verifyToken: async () => ({ ok: false as const }),
    limits,
  };
}

function peerOptionsWith(limits: Readonly<Partial<ReplicationLimits>>): PeerReplicationOptions {
  return {
    instanceId: 'peer-ac',
    hubInstanceId: 'hub-ac',
    registry: STUB_REGISTRY,
    dial: () => ({ send: () => {}, close: () => {} }) as unknown as DuplexTransport,
    timer: STUB_TIMER,
    limits,
    chunkedUpdate: true,
  };
}

/** 双入口共同断言：违例必须在 hub 与 peer 构造期都响亮 TypeError。 */
function expectBothEntryPointsTypeError(
  limits: Readonly<Partial<ReplicationLimits>>,
  label: string,
): void {
  expect(() => createHubReplication(hubOptionsWith(limits)), `${label}（hub 入口）`).toThrow(TypeError);
  expect(
    () => createPeerReplication(peerOptionsWith(limits)),
    `${label}（peer 入口）`,
  ).toThrow(TypeError);
}

function expectBothEntryPointsAccepted(
  limits: Readonly<Partial<ReplicationLimits>>,
  label: string,
): void {
  expect(
    () => createHubReplication(hubOptionsWith(limits)),
    `${label}（hub 入口必须被接纳）`,
  ).not.toThrow();
  expect(
    () => createPeerReplication(peerOptionsWith(limits)),
    `${label}（peer 入口必须被接纳）`,
  ).not.toThrow();
}

// ---------------------------------------------------------------- 插件装配桩（C6 用）

function transport(): DuplexTransport {
  return {
    send: () => {},
    close: () => {},
    closed: false,
    onMessage: () => () => {},
    onClose: () => () => {},
  };
}

const HUB_LISTEN = {
  listen: async () => ({ close: async () => {} }),
};

function dependencies(ctx: Context, role: 'hub' | 'peer'): void {
  provideInstance(ctx, Object.freeze({ instanceId: `${role}-one`, role }));
  provideClock(ctx, { now: () => 1 });
  const timer = { timeout: () => () => {} };
  if (typeof ctx.root.timeout === 'function') ctx.provide('timer', timer as never);
  else {
    ctx.provide(
      'timer',
      { ...timer, ctx: { root: { ...ctx.root, timeout: timer.timeout } } } as never,
    );
  }
  provideNomicoreRegistry(ctx, { open: vi.fn() } as never);
}

// ---------------------------------------------------------------- 契约测试

describe('issue #299 切片 1：snapshot/sync-diff 聚合上限配置链（红灯契约）', () => {
  it('红灯 C1（AC3 缺省面）：两聚合上限键缺省各 4 MiB 进入冻结 DEFAULT_REPLICATION_LIMITS；既有三键键名/缺省不变', () => {
    const limitsRecord = DEFAULT_REPLICATION_LIMITS as unknown as Record<string, number | undefined>;
    expect(
      limitsRecord.maxChunkedBootstrapBytes,
      `maxChunkedBootstrapBytes 缺省必须为 ${DEFAULT_CHUNKED_BOOTSTRAP_BYTES}（当前键未实现）`,
    ).toBe(DEFAULT_CHUNKED_BOOTSTRAP_BYTES);
    expect(
      limitsRecord.maxChunkedSyncDiffBytes,
      `maxChunkedSyncDiffBytes 缺省必须为 ${DEFAULT_CHUNKED_SYNC_DIFF_BYTES}（当前键未实现）`,
    ).toBe(DEFAULT_CHUNKED_SYNC_DIFF_BYTES);
    expect(Object.isFrozen(DEFAULT_REPLICATION_LIMITS)).toBe(true);

    // 键名不变回归（ADR 0019：语义 kind 无关推广，键名与缺省不动；本切片只许两新键进入 limits）
    const expectedLimitKeys = [
      'maxFrameBytes',
      'maxBootstrapBytes',
      'maxSyncDiffBytes',
      'maxUpdateBytes',
      'maxQueuedUpdateBytes',
      'maxQueuedUpdateCount',
      'maxInFlightUpdates',
      'maxQueuedBytesPerConnection',
      'lowWater',
      'highWater',
      'maxQueuedControlBytes',
      'maxChunkedUpdateBytes',
      'maxChunksPerUpdate',
      'maxConcurrentAssembliesPerConnection',
      'maxChunkedBootstrapBytes',
      'maxChunkedSyncDiffBytes',
    ];
    const actualLimitKeys = Object.keys(DEFAULT_REPLICATION_LIMITS).sort();
    expect(
      actualLimitKeys,
      'limits 键集必须恰为既有 14 键 + 两新键（零改名/零额外机制键）',
    ).toEqual([...expectedLimitKeys].sort());
    expect(limitsRecord.maxChunkedUpdateBytes).toBe(DEFAULT_MAX_CHUNKED_UPDATE_BYTES);
    expect(limitsRecord.maxChunksPerUpdate).toBe(DEFAULT_MAX_CHUNKS_PER_UPDATE);
    expect(limitsRecord.maxConcurrentAssembliesPerConnection).toBe(DEFAULT_MAX_CONCURRENT_ASSEMBLIES);
    const timeoutsRecord = DEFAULT_REPLICATION_TIMEOUTS as unknown as Record<string, number | undefined>;
    expect(
      Object.keys(DEFAULT_REPLICATION_TIMEOUTS).sort(),
      'timeouts 键集不得漂移（assemblyTimeoutMs 容器 = timeouts，键名不变）',
    ).toEqual(
      [
        'helloTimeoutMs',
        'openTimeoutMs',
        'bootstrapTimeoutMs',
        'reconcileTimeoutMs',
        'reconcileIntervalMs',
        'closeTimeoutMs',
        'ackTimeoutMs',
        'pingIntervalMs',
        'pongTimeoutMs',
        'assemblyTimeoutMs',
      ].sort(),
    );
    expect(timeoutsRecord.assemblyTimeoutMs).toBe(DEFAULT_ASSEMBLY_TIMEOUT_MS);
  });

  it('红灯 C2（AC3 链②·bootstrap 隔离违例）：显式 maxChunkedBootstrapBytes ≤ maxChunksPerUpdate × maxUpdateBytes——越界 TypeError、恰好等号合法、off-by-one 拒绝、非法值拒绝', () => {
    // 期望值自检（防缺省漂移伪红/伪绿）
    expect(CHAIN2_UPPER_BOUND).toBe(32 * MIB);
    expect(CHAIN2_FAMILY_BOUND).toBe(2 * MIB);
    expect(CHAIN2_FAMILY.maxChunksPerUpdate * DEFAULT_MAX_UPDATE_BYTES).toBe(CHAIN2_FAMILY_BOUND);

    // 隔离违例：唯一显式键 = maxChunkedBootstrapBytes（40 MiB > 缺省 product 32 MiB；
    // 缺省 #244 两链自洽，故该构型下唯一可能越界的就是本链）
    expectBothEntryPointsTypeError(
      withLimit({ maxChunkedBootstrapBytes: 40 * MIB }),
      'maxChunkedBootstrapBytes=40MiB > 64×512KiB=32MiB',
    );

    // 边界（≤ 含等号）：显式族 product = 2 MiB，bootstrap 恰好等于 product → 必须被接纳
    expectBothEntryPointsAccepted(
      withLimit({ ...CHAIN2_FAMILY, maxChunkedBootstrapBytes: CHAIN2_FAMILY_BOUND }),
      'maxChunkedBootstrapBytes=2MiB（恰好等于 4×512KiB）',
    );
    // off-by-one 敏感度：product + 1 字节即响亮 TypeError（证明判据是 ≤ 且上界 = product）
    expectBothEntryPointsTypeError(
      withLimit({ ...CHAIN2_FAMILY, maxChunkedBootstrapBytes: CHAIN2_FAMILY_BOUND + 1 }),
      'maxChunkedBootstrapBytes=2MiB+1',
    );

    // 非法值（正有限安全整数门）：0 与非整数 → 构造期 TypeError
    expectBothEntryPointsTypeError(
      withLimit({ maxChunkedBootstrapBytes: 0 }),
      'maxChunkedBootstrapBytes=0',
    );
    expectBothEntryPointsTypeError(
      withLimit({ maxChunkedBootstrapBytes: 1.5 }),
      'maxChunkedBootstrapBytes=1.5',
    );
  });

  it('红灯 C3（AC3 链②·sync-diff 隔离违例）：显式 maxChunkedSyncDiffBytes 同上——越界 TypeError、恰好等号合法、off-by-one 拒绝、非法值拒绝', () => {
    expectBothEntryPointsTypeError(
      withLimit({ maxChunkedSyncDiffBytes: 40 * MIB }),
      'maxChunkedSyncDiffBytes=40MiB > 32MiB',
    );
    expectBothEntryPointsAccepted(
      withLimit({ ...CHAIN2_FAMILY, maxChunkedSyncDiffBytes: CHAIN2_FAMILY_BOUND }),
      'maxChunkedSyncDiffBytes=2MiB（恰好等于 4×512KiB）',
    );
    expectBothEntryPointsTypeError(
      withLimit({ ...CHAIN2_FAMILY, maxChunkedSyncDiffBytes: CHAIN2_FAMILY_BOUND + 1 }),
      'maxChunkedSyncDiffBytes=2MiB+1',
    );
    expectBothEntryPointsTypeError(
      withLimit({ maxChunkedSyncDiffBytes: 0 }),
      'maxChunkedSyncDiffBytes=0',
    );
    expectBothEntryPointsTypeError(
      withLimit({ maxChunkedSyncDiffBytes: -1 }),
      'maxChunkedSyncDiffBytes=-1',
    );
  });

  it('红灯 C4（AC3 两键联立）：两新键各自独立生效——同为界内接纳；任一越界即使另一键在界内也 TypeError', () => {
    expectBothEntryPointsAccepted(
      withLimit({
        ...CHAIN2_FAMILY,
        maxChunkedBootstrapBytes: CHAIN2_FAMILY_BOUND,
        maxChunkedSyncDiffBytes: CHAIN2_FAMILY_BOUND,
      }),
      '两键同为 2MiB（各自恰好等于 product）',
    );
    expectBothEntryPointsTypeError(
      withLimit({
        ...CHAIN2_FAMILY,
        maxChunkedBootstrapBytes: CHAIN2_FAMILY_BOUND,
        maxChunkedSyncDiffBytes: CHAIN2_FAMILY_BOUND + 1,
      }),
      'bootstrap=2MiB（界内）∧ sync=2MiB+1（越界）',
    );
  });

  it('负控 C5（AC3 非追溯性 + SA8 R35 门宽）：显式 maxChunksPerUpdate 仍是链激活键；未表达分块族键的存量配置不误判', () => {
    // (a) 显式收紧 maxChunksPerUpdate=1（未表达任何新键）→ 合并结果 4 MiB 缺省聚合上限
    //     > 1 × 512 KiB → 必须在构造期响亮 TypeError（R35：门不得窄化为「仅新键」）
    expectBothEntryPointsTypeError(
      { maxChunksPerUpdate: 1 } as Readonly<Partial<ReplicationLimits>>,
      '显式 maxChunksPerUpdate=1',
    );
    // (b) 边界：maxChunksPerUpdate=8 → 4 MiB ≤ 8 × 512 KiB = 4 MiB（≤ 含等号）→ 接纳
    expectBothEntryPointsAccepted(
      { maxChunksPerUpdate: 8 } as Readonly<Partial<ReplicationLimits>>,
      '显式 maxChunksPerUpdate=8（恰好覆盖 4 MiB 缺省）',
    );
    // (c) 非追溯性：仅表达既有非链操作数键 → 新链不激活（缺省 envelope 不得被误判为用户配置错误）
    expectBothEntryPointsAccepted(
      { maxUpdateBytes: 32 * 1024 } as Readonly<Partial<ReplicationLimits>>,
      '仅 maxUpdateBytes=32KiB（既有非链键）',
    );
    expectBothEntryPointsAccepted(
      {
        maxQueuedUpdateBytes: 1 * MIB,
        maxQueuedUpdateCount: 64,
        maxInFlightUpdates: 8,
      } as Readonly<Partial<ReplicationLimits>>,
      '存量队列/窗口配置（零分块族键）',
    );
  });

  it('负控 C6（AC3 control reserve 原样保留）：maxQueuedControlBytes ≥ maxBootstrapBytes + 128 启动期响亮（违例 / 边界合法）', () => {
    expectBothEntryPointsTypeError(
      {
        maxBootstrapBytes: DEFAULT_MAX_BOOTSTRAP_BYTES,
        maxQueuedControlBytes: DEFAULT_MAX_BOOTSTRAP_BYTES + PROTOCOL_OVERHEAD_BYTES - 64,
      } as Readonly<Partial<ReplicationLimits>>,
      'control reserve 不足（maxBootstrapBytes + 64 < +128）',
    );
    expectBothEntryPointsAccepted(
      {
        maxBootstrapBytes: DEFAULT_MAX_BOOTSTRAP_BYTES,
        maxQueuedControlBytes: DEFAULT_MAX_BOOTSTRAP_BYTES + PROTOCOL_OVERHEAD_BYTES,
      } as Readonly<Partial<ReplicationLimits>>,
      'control reserve 恰好为 maxBootstrapBytes + 128',
    );

    // 插件装配路径回归（C7 用的 dependencies/apply 桩在本负控中先行验证可用）：
    // 既有键 limits 的 peer 插件必须装配成功并发布 ready 服务（新键缺省不参与）
    const plugin = createPeerReplicationPlugin(
      {
        expectedHubInstanceId: 'hub-one',
        limits: { maxUpdateBytes: 256 * 1024 } as Readonly<Partial<ReplicationLimits>>,
      },
      { dial: () => transport() },
    );
    const ctx = new Context();
    dependencies(ctx, 'peer');
    expect(() => plugin.apply(ctx), '既有键 limits 的插件装配不得回归').not.toThrow();
    expect(requirePeerReplication(ctx).status.state).toBe('ready');
  });

  it('红灯 C7（AC3 配置链接入·插件 allowlist）：两新键必须被 hub/peer 插件配置严格 allowlist 接纳，且链②违例经插件装配路径响亮拒绝', () => {
    const bothDefault = withLimit({
      maxChunkedBootstrapBytes: DEFAULT_CHUNKED_BOOTSTRAP_BYTES,
      maxChunkedSyncDiffBytes: DEFAULT_CHUNKED_SYNC_DIFF_BYTES,
    });
    // (1) hub 插件配置：显式两新键不得被严格 allowlist 判为 'invalid configuration'
    expect(
      () =>
        createHubReplicationPlugin(
          {
            listen: { host: '127.0.0.1', port: 0 },
            tokens: [],
            authorization: [],
            limits: bothDefault,
          },
          { listen: HUB_LISTEN },
        ),
      'hub 插件 limits allowlist 必须接纳两新键（当前抛 invalid configuration）',
    ).not.toThrow();
    // (2) peer 插件配置同样接纳
    const accepted = createPeerReplicationPlugin(
      { expectedHubInstanceId: 'hub-one', limits: bothDefault },
      { dial: () => transport() },
    );
    const acceptedCtx = new Context();
    dependencies(acceptedCtx, 'peer');
    expect(() => accepted.apply(acceptedCtx), '两新键缺省值经插件装配必须构造成功').not.toThrow();
    expect(requirePeerReplication(acceptedCtx).status.state).toBe('ready');

    // (3) 链②违例经插件配置装配路径（peer apply → createPeerReplication）响亮 TypeError，
    //     服务注册不得发生（装配失败即无 ready 服务）
    const violating = createPeerReplicationPlugin(
      {
        expectedHubInstanceId: 'hub-one',
        limits: withLimit({ maxChunkedBootstrapBytes: 40 * MIB }),
      },
      { dial: () => transport() },
    );
    const ctx = new Context();
    dependencies(ctx, 'peer');
    expect(
      () => violating.apply(ctx),
      'maxChunkedBootstrapBytes=40MiB 经插件配置必须装配期 TypeError（绝不 clamp 后 ready）',
    ).toThrow(TypeError);
    expect(() => requirePeerReplication(ctx)).toThrow(/unavailable/);
  });
});
