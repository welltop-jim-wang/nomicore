/**
 * issue #288 / ADR 0018 §4–§5 —— standalone `@nomicore/yjs-server` 的
 * `onFatalError` 宿主策略钩子（进程内面）。
 *
 * 锚定契约：
 * - **配置面（AC1）**：`onFatalError: 'exit' | 'stay'`，缺省 `'exit'`（config 层不
 *   展开缺省——「操作员意图忠实载体」纪律，缺省展开单点 = `DEFAULT_ON_FATAL_ERROR`）；
 *   非法值在配置校验期响亮拒绝（`ConfigValidationError`，path 精确到 `onFatalError`）；
 * - **fatal 类判据**：`isFatalObserverEvent` 是唯一审计点（fatal-policy.ts 头注
 *   分类表）；当前恰好覆盖 `schema-rearm-failed` 一型（observer 层唯一无歧义断言
 *   「Runtime fatal 已置位」的事件型）；`namespace-failed` 全 cause 不属 fatal 类
 *   （无法区分 Runtime fatal 与正常运维终局——delete-namespace×活跃复制的
 *   `apply-rejected` 收口是既定「进程不崩」契约）、`connection-failed` 自愈、
 *   迁移/计数类无 fatal 语义；
 * - **exit 模式（AC2）**：fatal 事件到达 ⇒ NDJSON 直通记录**先于**一切停机动作
 *   （`schema-rearm-failed` → `fatal-shutdown` 标记 → `replication-drained` → … →
 *   `app-stopped`）⇒ 经注入 seam 非零退出（测试注入 spy，绝不调真 `process.exit`）；
 * - **stay 模式（AC3）**：事件仅落 NDJSON，进程继续，同进程其他 namespace 不受影响；
 * - **直通映射（AC4）**：`schema-rearm-applied` / `schema-rearm-failed` 两型的
 *   type→event 改名与字段直通（键集/取值逐字不变形）。
 *
 * 驱动面：真实 `createNomicoreApp` hub + peer（进程内、真实 WebSocket）；「peer 侧
 * 字节损坏」经 `CorruptOnceProxy`（harness）在 hub→peer 字节流同长替换 v2 SCHEMA
 * 文本（hub 提交前编译成功、peer 侧编译失败 = ADR 0018 §3 的字节损坏形态——真实
 * hub 结构性无法提交非法 SCHEMA，故损坏必须发生在 wire 上）。
 */
import { describe, expect, it } from 'vitest';
import type { ReplicationObserverEvent } from '@nomicore/ws-replication';
import {
  ConfigValidationError,
  DEFAULT_ON_FATAL_ERROR,
  createNomicoreApp,
  isFatalObserverEvent,
  parseAppConfig,
  type NomicoreApp,
} from '../src/index.js';
import { CorruptOnceProxy, waitUntil } from './harness.js';

// ═══════════════════════════ fixture ═══════════════════════════

const V1_TEXT = 'type ROOT = { count: number; };\n';
/** v2：新增必填 `note`——与 v1 语义不同，且携带 corruption marker 的唯一锚点。 */
const V2_TEXT = 'type ROOT = { count: number; note: string; };\n';
/** wire 同长损坏点：`note: string` → `note: strinG`（未知类型名 → peer 编译结果失败）。 */
const MARKER = Buffer.from('note: string', 'utf8');
const REPLACEMENT = Buffer.from('note: strinG', 'utf8');
const REARM_INVALID = 'NSRT-FATAL-SCHEMA-REARM-INVALID';

const SCHEMA_V1 = Object.freeze({ lang: 'vfsl', version: 1, id: 'notes-v1', text: V1_TEXT });
const SCHEMA_V2 = Object.freeze({ lang: 'vfsl', version: 1, id: 'notes-v1', text: V2_TEXT });

type Ndjson = Record<string, unknown>;

function hubConfig(provisionCount: number): Record<string, unknown> {
  const provision = Array.from({ length: provisionCount }, (_, i) => ({
    id: `p${i + 1}`,
    ownerUserId: 'alice',
    schema: SCHEMA_V1,
    root: { count: 0 },
  }));
  return {
    role: 'hub',
    instanceId: 'hub-1',
    persistence: { kind: 'memory' },
    hub: {
      listen: { host: '127.0.0.1', port: 0 },
      tokens: { 'peer-1': 'token-1' },
      provision,
      authorization: provision.map((p) => ({
        peerInstanceId: 'peer-1',
        provisionId: p.id,
        read: true,
        submit: true,
      })),
    },
  };
}

function peerConfig(
  proxyPort: number,
  namespaceIds: readonly string[],
  onFatalError?: 'exit' | 'stay',
): Record<string, unknown> {
  return {
    role: 'peer',
    instanceId: 'peer-1',
    persistence: { kind: 'memory' },
    ...(onFatalError !== undefined ? { onFatalError } : {}),
    peer: {
      hub: {
        url: `ws://127.0.0.1:${proxyPort}/replication`,
        hubInstanceId: 'hub-1',
        token: 'token-1',
      },
      targets: namespaceIds.map((namespaceId) => ({ namespaceId, ownerUserId: 'alice' })),
    },
  };
}

interface Booted {
  readonly app: NomicoreApp;
  readonly events: Ndjson[];
  readonly namespaceIds: readonly string[];
  readonly port: number;
}

function eventsOf(events: Ndjson[], name: string): Ndjson[] {
  return events.filter((e) => e.event === name);
}

function firstIndex(events: Ndjson[], name: string): number {
  return events.findIndex((e) => e.event === name);
}

async function bootHub(provisionCount: number): Promise<Booted> {
  const events: Ndjson[] = [];
  const app = createNomicoreApp(hubConfig(provisionCount), { emitter: (e) => events.push(e) });
  await app.ready;
  const listening = eventsOf(events, 'listening')[0];
  const port = listening?.port;
  if (typeof port !== 'number') throw new Error('hub listening 事件未携带端口');
  const namespaceIds = eventsOf(events, 'provisioned').map((e) => {
    if (typeof e.namespaceId !== 'string') throw new Error('provisioned 缺 namespaceId');
    return e.namespaceId;
  });
  return { app, events, namespaceIds, port };
}

async function bootPeer(
  proxyPort: number,
  namespaceIds: readonly string[],
  options: { onFatalError?: 'exit' | 'stay'; exit?: (code: number) => void } = {},
): Promise<Booted> {
  const events: Ndjson[] = [];
  const app = createNomicoreApp(peerConfig(proxyPort, namespaceIds, options.onFatalError), {
    emitter: (e) => events.push(e),
    ...(options.exit !== undefined ? { exit: options.exit } : {}),
  });
  await app.ready;
  return { app, events, namespaceIds, port: proxyPort };
}

/** 等 peer 对每个 target 都到达 live（channel-state-changed{to:'live'}）。 */
async function waitAllLive(peer: Booted): Promise<void> {
  await waitUntil(
    'peer 全部 target live',
    () =>
      peer.namespaceIds.every((ns) =>
        peer.events.some(
          (e) => e.event === 'channel-state-changed' && e.namespaceId === ns && e.to === 'live',
        ),
      ),
  );
}

async function replaceSchemaToV2(hub: Booted, namespaceId: string): Promise<void> {
  const reply = await hub.app.handleControlLine(
    JSON.stringify({
      op: 'replace-schema',
      namespaceId,
      schema: SCHEMA_V2,
      root: { count: 0, note: 'v2' },
    }),
  );
  if (reply?.ok !== true) throw new Error(`replace-schema 失败：${JSON.stringify(reply)}`);
}

// ═══════════════════════════ AC1：配置面 ═══════════════════════════

describe('issue #288 AC1：onFatalError 配置校验', () => {
  it('缺省键缺席 ⟹ 解析产物不展开缺省；缺省值单点 = DEFAULT_ON_FATAL_ERROR（exit）', () => {
    const parsed = parseAppConfig({
      role: 'peer',
      instanceId: 'peer-1',
      persistence: { kind: 'memory' },
      peer: {
        hub: { url: 'ws://127.0.0.1:3210/replication', hubInstanceId: 'hub-1', token: 'token-1' },
      },
    });
    expect('onFatalError' in parsed, 'config 层不展开缺省（操作员意图忠实载体）').toBe(false);
    expect(DEFAULT_ON_FATAL_ERROR, 'ADR 0018 §4 明文默认').toBe('exit');
  });

  it("'exit' / 'stay' 两值逐字接受并深冻结", () => {
    for (const value of ['exit', 'stay'] as const) {
      const parsed = parseAppConfig({
        role: 'peer',
        instanceId: 'peer-1',
        persistence: { kind: 'memory' },
        onFatalError: value,
        peer: {
          hub: { url: 'ws://127.0.0.1:3210/replication', hubInstanceId: 'hub-1', token: 'token-1' },
        },
      });
      expect(parsed.onFatalError).toBe(value);
      expect(Object.isFrozen(parsed)).toBe(true);
    }
  });

  it("非法值在配置校验期响亮拒绝（path 精确到 onFatalError；TypeError 族）", () => {
    for (const bad of ['panic', '', 'EXIT', 1, null, true, ['exit']]) {
      let thrown: unknown;
      try {
        parseAppConfig({
          role: 'peer',
          instanceId: 'peer-1',
          persistence: { kind: 'memory' },
          onFatalError: bad,
          peer: {
            hub: { url: 'ws://127.0.0.1:3210/replication', hubInstanceId: 'hub-1', token: 'token-1' },
          },
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown, `值 ${JSON.stringify(bad)} 必须响亮拒绝`).toBeInstanceOf(ConfigValidationError);
      const violations = (thrown as ConfigValidationError).violations;
      expect(
        violations.some((v) => v.path === 'onFatalError'),
        `violations 须含 onFatalError 精确路径：${JSON.stringify(violations)}`,
      ).toBe(true);
    }
  });
});

// ═══════════════════════════ fatal 类判据（fatal-policy.ts 分类表钉死） ═══════════════════════════

describe('issue #288：fatal 类 observer 事件判据（唯一审计点的行为钉死）', () => {
  const base = { side: 'peer' as const, namespaceId: 'ns-00000000000000000000000000000001' };

  it('schema-rearm-failed 属 fatal 类；schema-rearm-applied 不属', () => {
    expect(
      isFatalObserverEvent({
        type: 'schema-rearm-failed',
        ...base,
        code: 'NSRT-FATAL-SCHEMA-REARM-INVALID',
      }),
    ).toBe(true);
    expect(
      isFatalObserverEvent({
        type: 'schema-rearm-failed',
        ...base,
        code: 'NSRT-FATAL-SCHEMA-REARM-INTERNAL',
      }),
    ).toBe(true);
    expect(
      isFatalObserverEvent({
        type: 'schema-rearm-applied',
        ...base,
        semanticFingerprint: 'sha256:v1:' + '0'.repeat(64),
        updatedAt: null,
      }),
    ).toBe(false);
  });

  it('namespace-failed 全 13 cause 均不属 fatal 类（observer 层无法区分 Runtime fatal 与正常运维终局——delete-namespace×活跃复制的 apply-rejected 收口是既定「进程不崩」契约）', () => {
    const allCauses = [
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
    ] as const;
    for (const cause of allCauses) {
      expect(isFatalObserverEvent({ type: 'namespace-failed', ...base, cause }), `${cause} 不应为 fatal 类`).toBe(false);
    }
  });

  it('connection-failed 与迁移/计数类事件不属 fatal 类', () => {
    const samples: ReplicationObserverEvent[] = [
      { type: 'connection-failed', side: 'peer', code: 'INTERNAL_ERROR', wsCloseCode: 1011 },
      { type: 'namespace-error', ...base, code: 'APPLY_FAILED', direction: 'received' },
      { type: 'channel-state-changed', ...base, from: 'opening', to: 'live' },
      { type: 'identity-conflicted', ...base, via: 'fence' },
    ];
    for (const event of samples) {
      expect(isFatalObserverEvent(event), `${event.type} 不应为 fatal 类`).toBe(false);
    }
  });
});

// ═══════════════════════════ AC4：两型 NDJSON 直通映射（真实 wire） ═══════════════════════════

describe('issue #288 AC4：schema-rearm 两型的 NDJSON 直通映射字段不变形', () => {
  it('schema-rearm-applied：type→event 改名 + 字段逐字直通（成功路径不触发宿主动作）', async () => {
    const hub = await bootHub(1);
    // 直通路径：无损坏代理（peer 直拨 hub）
    const peer = await bootPeer(hub.port, hub.namespaceIds);
    try {
      await waitAllLive(peer);
      await replaceSchemaToV2(hub, hub.namespaceIds[0]!);
      await waitUntil(
        'peer schema-rearm-applied NDJSON',
        () => eventsOf(peer.events, 'schema-rearm-applied').length === 1,
      );

      const applied = eventsOf(peer.events, 'schema-rearm-applied')[0]!;
      expect(
        Object.keys(applied).sort(),
        '键集 = 包事件字段 + event 改名（零增零减）',
      ).toEqual(['connectionId', 'event', 'namespaceId', 'semanticFingerprint', 'side', 'updatedAt']);
      expect(applied.event).toBe('schema-rearm-applied');
      expect(applied.side).toBe('peer');
      expect(applied.namespaceId).toBe(hub.namespaceIds[0]);
      expect(applied.semanticFingerprint).toMatch(/^sha256:v1:[0-9a-f]{64}$/);
      expect(typeof applied.updatedAt).toBe('string');

      // 成功安装不是 fatal 类：零宿主动作、通道保 live、进程继续
      expect(eventsOf(peer.events, 'fatal-shutdown')).toEqual([]);
      expect(eventsOf(peer.events, 'app-stopped')).toEqual([]);
      const write = await peer.app.handleControlLine(
        JSON.stringify({ op: 'verify-write', namespaceId: hub.namespaceIds[0], set: ['note'], value: 'after-rearm' }),
      );
      expect(write?.ok, 're-arm 成功后按新 schema 写应通过').toBe(true);
    } finally {
      await peer.app.stop();
      await hub.app.stop();
    }
  }, 30_000);
});

// ═══════════════════════════ AC2/AC3：fatal 到达后的宿主动作 ═══════════════════════════

describe('issue #288 AC2：exit 模式——NDJSON 先于停机 + 有序停机 + 注入 seam 非零退出', () => {
  it('schema-rearm-failed → fatal-shutdown → 有序停机四事件 → exit(1)（spy 断言，不调真 process.exit）', async () => {
    const hub = await bootHub(1);
    const proxy = new CorruptOnceProxy(hub.port, MARKER, REPLACEMENT);
    const proxyPort = await proxy.listen();
    const exitCalls: number[] = [];
    const exitAfterAppStopped: boolean[] = [];
    let peerEventsRef: Ndjson[] = [];
    const peer = await bootPeer(proxyPort, hub.namespaceIds, {
      exit: (code) => {
        exitCalls.push(code);
        exitAfterAppStopped.push(peerEventsRef.some((e) => e.event === 'app-stopped'));
      },
    });
    peerEventsRef = peer.events;
    try {
      await waitAllLive(peer);
      await replaceSchemaToV2(hub, hub.namespaceIds[0]!);

      await waitUntil('exit seam 被调用', () => exitCalls.length >= 1, 30_000);

      // 损坏确实发生在 wire 上（场景真实性——否则全部断言失去意义）
      expect(proxy.patched, 'proxy 必须执行了字节损坏').toBe(true);

      // NDJSON 严格序：直通记录 → fatal-shutdown 标记 → 单一拆卸链四事件
      const order = [
        'schema-rearm-failed',
        'fatal-shutdown',
        'replication-drained',
        'registry-stopped',
        'persistence-disposed',
        'app-stopped',
      ].map((name) => firstIndex(peer.events, name));
      expect(order.every((i) => i >= 0), `全部事件在场：${JSON.stringify(order)}`).toBe(true);
      for (let i = 1; i < order.length; i += 1) {
        expect(order[i]!, `NDJSON 严格递增序：${JSON.stringify(order)}`).toBeGreaterThan(order[i - 1]!);
      }

      // 直通事件字段不变形（type→event 改名；code = ADR 0018 稳定双码之一）
      const failed = eventsOf(peer.events, 'schema-rearm-failed')[0]!;
      expect(Object.keys(failed).sort()).toEqual(['code', 'connectionId', 'event', 'namespaceId', 'side']);
      expect(failed.side).toBe('peer');
      expect(failed.namespaceId).toBe(hub.namespaceIds[0]);
      expect(failed.code).toBe(REARM_INVALID);

      // fatal-shutdown 标记携带触发面（safe-field：仅稳定字面量 + 受控标识）
      const marker = eventsOf(peer.events, 'fatal-shutdown')[0]!;
      expect(marker).toEqual({
        event: 'fatal-shutdown',
        trigger: 'schema-rearm-failed',
        namespaceId: hub.namespaceIds[0],
      });

      // 退出 seam：恰一次、非零、且在 app-stopped 之后
      expect(exitCalls, 'exit 恰一次非零退出').toEqual([1]);
      expect(exitAfterAppStopped).toEqual([true]);

      // hub 不被株连：零 fatal-shutdown、控制面仍应答
      expect(eventsOf(hub.events, 'fatal-shutdown')).toEqual([]);
      const hubStatus = await hub.app.handleControlLine(JSON.stringify({ op: 'status' }));
      expect(hubStatus?.ok).toBe(true);
    } finally {
      await peer.app.stop(); // 幂等（fatal 停机已结算——single-flight）
      await hub.app.stop();
      await proxy.close();
    }
  }, 40_000);
});

describe("issue #288 AC3：stay 模式——仅落 NDJSON，进程继续，同进程其他 namespace 不受影响", () => {
  it('ns1 re-arm fatal 仅记录；ns2 复制/写照常；零停机事件', async () => {
    const hub = await bootHub(2);
    const proxy = new CorruptOnceProxy(hub.port, MARKER, REPLACEMENT);
    const proxyPort = await proxy.listen();
    const peer = await bootPeer(proxyPort, hub.namespaceIds, { onFatalError: 'stay' });
    const [ns1, ns2] = hub.namespaceIds as [string, string];
    try {
      await waitAllLive(peer);
      await replaceSchemaToV2(hub, ns1);

      await waitUntil(
        'peer schema-rearm-failed NDJSON（stay）',
        () => eventsOf(peer.events, 'schema-rearm-failed').length === 1,
      );
      // 等 ns1 通道进入 closed 终态（fatal 伴随动作照常——通道行为不依赖宿主帅）
      await waitUntil(
        'ns1 channel-state-changed → closed',
        () =>
          peer.events.some(
            (e) => e.event === 'channel-state-changed' && e.namespaceId === ns1 && e.to === 'closed',
          ),
      );

      expect(proxy.patched).toBe(true);
      // stay：事件仅落 NDJSON——零 fatal-shutdown、零停机链
      expect(eventsOf(peer.events, 'fatal-shutdown')).toEqual([]);
      for (const name of ['replication-drained', 'registry-stopped', 'persistence-disposed', 'app-stopped']) {
        expect(eventsOf(peer.events, name), `stay 模式零 ${name}`).toEqual([]);
      }

      // 进程继续：控制面应答
      const status = await peer.app.handleControlLine(JSON.stringify({ op: 'status' }));
      expect(status?.ok).toBe(true);
      expect(status?.connectionState).toBe('ready');

      // 不株连：ns2 无 closed/conflicted/failed 迁移，写按 v1 schema 照常
      expect(
        peer.events.filter(
          (e) =>
            e.event === 'channel-state-changed' &&
            e.namespaceId === ns2 &&
            (e.to === 'closed' || e.to === 'conflicted' || e.to === 'failed'),
        ),
        'ns2 不得出现终态迁移',
      ).toEqual([]);
      const writeNs2 = await peer.app.handleControlLine(
        JSON.stringify({ op: 'verify-write', namespaceId: ns2, set: ['count'], value: 7 }),
      );
      expect(writeNs2?.ok, 'ns2 写不受影响').toBe(true);

      // ns1 写禁用且通道非 live（有界等待 → verify-write-timeout）
      const writeNs1 = await peer.app.handleControlLine(
        JSON.stringify({ op: 'verify-write', namespaceId: ns1, set: ['count'], value: 1, timeoutMs: 1_000 }),
      );
      expect(writeNs1?.ok).toBe(false);
      expect(writeNs1?.code).toBe('verify-write-timeout');
    } finally {
      await peer.app.stop();
      await hub.app.stop();
      await proxy.close();
    }
  }, 40_000);
});
