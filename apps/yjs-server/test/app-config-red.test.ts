/**
 * [SA6 owned] T1 — `apps/yjs-server` strict 配置契约（设计 §3.2；AC1）。
 *
 * RED 基线：本 worktree 尚不存在 `@nomicore/yjs-server` 应用包（SA3 未实现）——
 * 每个用例的 `parseAppConfig` 运行时 import 都必然抛出模块解析错误。红灯原因 =
 * 应用实现不存在，不是测试语法/发现配置错误。
 *
 * 被锚定的契约（设计 §3.2）：
 *  - 静态角色必填（'hub'|'peer'），无缺省；
 *  - instanceId 文法 ^[a-z][a-z0-9-]{0,62}$；
 *  - 未知键一律 loud TypeError（拒绝静默忽略拼错）；
 *  - role×字段交叉互斥（hub config 带 peer 块 / peer config 带 hub 块 → 拒）；
 *  - role=hub 出现顶层 `backoff`（peer 专属）→ 拒（R1 #8）；
 *  - listen.port 0..65535；file persistence 缺 rootDir → 拒；
 *  - peer.hub.url 仅 ws:/wss: 且有 host、无 fragment；hubInstanceId 文法；token 非空；
 *  - targets nsId 文法 ^ns-[0-9a-f]{32}$、重复 → 拒；ownerUserId 非空；
 *  - authorization 条目：namespaceId/provisionId 恰一；直引形式 ownerUserId 必填非空
 *    （localOwner 唯一来源）；provision 形式禁止 ownerUserId；provisionId 悬空 → 拒；
 *    (peerInstanceId, 解析后 nsId) 重复对 → 拒；
 *  - 合法配置通过且深冻结。
 */
import { describe, expect, it } from 'vitest';

const NS_A = 'ns-' + 'a'.repeat(32);
const NS_B = 'ns-' + 'b'.repeat(32);

const VFSL_SCHEMA = { lang: 'vfsl', version: 1, id: 'notes-v1', text: 'type ROOT = { count: number; };\n' };

function hubConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    role: 'hub',
    instanceId: 'hub-1',
    persistence: { kind: 'memory' },
    hub: {
      listen: { host: '127.0.0.1', port: 0 },
      tokens: { 'peer-1': 'token-1' },
    },
    ...overrides,
  };
}

function peerConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    role: 'peer',
    instanceId: 'peer-1',
    persistence: { kind: 'memory' },
    peer: {
      hub: { url: 'ws://127.0.0.1:3210/replication', hubInstanceId: 'hub-1', token: 'token-1' },
      targets: [{ namespaceId: NS_A, ownerUserId: 'alice' }],
    },
    ...overrides,
  };
}

/** 运行期动态 import（@vite-ignore：保持原生解析）——应用包缺席时抛模块解析错误（红基线）。 */
async function loadParseAppConfig(): Promise<(raw: unknown) => unknown> {
  const mod = (await import(/* @vite-ignore */ '@nomicore/yjs-server')) as Record<string, unknown>;
  expect(typeof mod.parseAppConfig).toBe('function');
  return mod.parseAppConfig as (raw: unknown) => unknown;
}

const FROZEN_SCHEMA = { lang: 'vfsl', version: 1, id: 'notes-v1', text: 'type ROOT = { count: number; };\n' };

function assertDeepFrozen(value: unknown, path = '$'): void {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value), `${path} should be deeply frozen`).toBe(true);
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    assertDeepFrozen(child, `${path}.${key}`);
  }
}

describe('T1 strict app config contract (design §3.2 / AC1)', () => {
  it('rejects config without a static role (mandatory, no default)', async () => {
    const parse = await loadParseAppConfig();
    const raw = hubConfig();
    delete (raw as Record<string, unknown>).role;
    expect(() => parse(raw)).toThrow();
  });

  it('rejects invalid instanceId grammar (uppercase / leading digit)', async () => {
    const parse = await loadParseAppConfig();
    expect(() => parse(hubConfig({ instanceId: 'Hub-1' }))).toThrow();
    expect(() => parse(hubConfig({ instanceId: '1hub' }))).toThrow();
  });

  it('rejects listen port outside 0..65535', async () => {
    const parse = await loadParseAppConfig();
    const badHub = (port: unknown) => hubConfig({ hub: { listen: { host: '127.0.0.1', port }, tokens: { 'peer-1': 'token-1' } } });
    expect(() => parse(badHub(70000))).toThrow();
    expect(() => parse(badHub(-1))).toThrow();
    expect(() => parse(badHub('nope'))).toThrow();
  });

  it('rejects unknown keys loudly at every nested config boundary', async () => {
    const parse = await loadParseAppConfig();
    expect(() => parse(hubConfig({ bogusTopLevel: true }))).toThrow(TypeError);
    expect(() =>
      parse(hubConfig({
        persistence: {
          kind: 'file',
          rootDir: '/tmp/nomicore-config-test',
          schedule: { debounceMs: 10, maxDirtyMs: 20, debouceMs: 10 },
        },
      })),
    ).toThrow(TypeError);
    expect(() =>
      parse(peerConfig({
        peer: {
          hub: {
            url: 'ws://127.0.0.1:3210/replication',
            hubInstanceId: 'hub-1',
            token: 'token-1',
            tokne: 'misspelled-token',
          },
          targets: [{ namespaceId: NS_A, ownerUserId: 'alice' }],
        },
      })),
    ).toThrow(TypeError);
  });

  it('rejects role×field cross placement (hub config carrying peer block)', async () => {
    const parse = await loadParseAppConfig();
    const cross = hubConfig({ peer: peerConfig().peer });
    expect(() => parse(cross)).toThrow();
  });

  it('rejects role×field cross placement (peer config carrying hub block)', async () => {
    const parse = await loadParseAppConfig();
    const cross = peerConfig({ hub: hubConfig().hub });
    expect(() => parse(cross)).toThrow();
  });

  it('rejects top-level backoff on role=hub (peer-only option, R1 #8)', async () => {
    const parse = await loadParseAppConfig();
    expect(() =>
      parse(hubConfig({ backoff: { baseMs: 500, maxMs: 5_000, resetAfterMs: 10_000 } })),
    ).toThrow();
  });

  it('rejects peer config missing hub.url or hubInstanceId or token', async () => {
    const parse = await loadParseAppConfig();
    expect(() =>
      parse(peerConfig({ peer: { hub: { hubInstanceId: 'hub-1', token: 'token-1' }, targets: [{ namespaceId: NS_A, ownerUserId: 'alice' }] } })),
    ).toThrow();
    expect(() =>
      parse(peerConfig({ peer: { hub: { url: 'ws://127.0.0.1:3210/replication', token: 'token-1' }, targets: [{ namespaceId: NS_A, ownerUserId: 'alice' }] } })),
    ).toThrow();
    expect(() =>
      parse(peerConfig({ peer: { hub: { url: 'ws://127.0.0.1:3210/replication', hubInstanceId: 'hub-1' }, targets: [{ namespaceId: NS_A, ownerUserId: 'alice' }] } })),
    ).toThrow();
  });

  it('rejects peer hub url that is not ws:/wss:', async () => {
    const parse = await loadParseAppConfig();
    expect(() =>
      parse(peerConfig({ peer: { hub: { url: 'http://127.0.0.1:3210/replication', hubInstanceId: 'hub-1', token: 'token-1' }, targets: [{ namespaceId: NS_A, ownerUserId: 'alice' }] } })),
    ).toThrow();
  });

  it('rejects target namespaceId grammar violations and duplicate targets', async () => {
    const parse = await loadParseAppConfig();
    expect(() =>
      parse(peerConfig({ peer: { hub: { url: 'ws://127.0.0.1:3210/replication', hubInstanceId: 'hub-1', token: 'token-1' }, targets: [{ namespaceId: 'ns-zzzz', ownerUserId: 'alice' }] } })),
    ).toThrow();
    expect(() =>
      parse(peerConfig({ peer: { hub: { url: 'ws://127.0.0.1:3210/replication', hubInstanceId: 'hub-1', token: 'token-1' }, targets: [{ namespaceId: NS_A, ownerUserId: 'alice' }, { namespaceId: NS_A, ownerUserId: 'bob' }] } })),
    ).toThrow();
  });

  it('rejects file persistence without rootDir', async () => {
    const parse = await loadParseAppConfig();
    expect(() => parse(hubConfig({ persistence: { kind: 'file' } }))).toThrow();
  });

  it('rejects authorization entry carrying both namespaceId and provisionId', async () => {
    const parse = await loadParseAppConfig();
    const raw = hubConfig({
      hub: {
        listen: { host: '127.0.0.1', port: 0 },
        tokens: { 'peer-1': 'token-1' },
        provision: [{ id: 'p1', ownerUserId: 'alice', schema: FROZEN_SCHEMA, root: { count: 0 } }],
        authorization: [{ peerInstanceId: 'peer-1', namespaceId: NS_A, provisionId: 'p1', ownerUserId: 'alice', read: true, submit: true }],
      },
    });
    expect(() => parse(raw)).toThrow();
  });

  it('rejects authorization entry carrying neither namespaceId nor provisionId', async () => {
    const parse = await loadParseAppConfig();
    const raw = hubConfig({
      hub: {
        listen: { host: '127.0.0.1', port: 0 },
        tokens: { 'peer-1': 'token-1' },
        authorization: [{ peerInstanceId: 'peer-1', read: true, submit: true }],
      },
    });
    expect(() => parse(raw)).toThrow();
  });

  it('rejects direct-form authorization without non-empty ownerUserId (localOwner single source)', async () => {
    const parse = await loadParseAppConfig();
    const raw = hubConfig({
      hub: {
        listen: { host: '127.0.0.1', port: 0 },
        tokens: { 'peer-1': 'token-1' },
        authorization: [{ peerInstanceId: 'peer-1', namespaceId: NS_A, read: true, submit: true }],
      },
    });
    expect(() => parse(raw)).toThrow();
    const emptyOwner = hubConfig({
      hub: {
        listen: { host: '127.0.0.1', port: 0 },
        tokens: { 'peer-1': 'token-1' },
        authorization: [{ peerInstanceId: 'peer-1', namespaceId: NS_A, ownerUserId: '', read: true, submit: true }],
      },
    });
    expect(() => parse(emptyOwner)).toThrow();
  });

  it('rejects provision-form authorization carrying ownerUserId (owner from provision only)', async () => {
    const parse = await loadParseAppConfig();
    const raw = hubConfig({
      hub: {
        listen: { host: '127.0.0.1', port: 0 },
        tokens: { 'peer-1': 'token-1' },
        provision: [{ id: 'p1', ownerUserId: 'alice', schema: FROZEN_SCHEMA, root: { count: 0 } }],
        authorization: [{ peerInstanceId: 'peer-1', provisionId: 'p1', ownerUserId: 'bob', read: true, submit: true }],
      },
    });
    expect(() => parse(raw)).toThrow();
  });

  it('rejects dangling provisionId (must resolve to a provision entry in the same config)', async () => {
    const parse = await loadParseAppConfig();
    const raw = hubConfig({
      hub: {
        listen: { host: '127.0.0.1', port: 0 },
        tokens: { 'peer-1': 'token-1' },
        authorization: [{ peerInstanceId: 'peer-1', provisionId: 'p-ghost', read: true, submit: true }],
      },
    });
    expect(() => parse(raw)).toThrow();
  });

  it('rejects duplicate (peerInstanceId, namespaceId) authorization pairs', async () => {
    const parse = await loadParseAppConfig();
    const raw = hubConfig({
      hub: {
        listen: { host: '127.0.0.1', port: 0 },
        tokens: { 'peer-1': 'token-1' },
        authorization: [
          { peerInstanceId: 'peer-1', namespaceId: NS_A, ownerUserId: 'alice', read: true, submit: true },
          { peerInstanceId: 'peer-1', namespaceId: NS_A, ownerUserId: 'alice', read: false, submit: false },
        ],
      },
    });
    expect(() => parse(raw)).toThrow();
  });

  it('rejects duplicate token values across hub.tokens entries (SA4 B1: last-wins identity aliasing)', async () => {
    const parse = await loadParseAppConfig();
    const raw = hubConfig({
      hub: {
        listen: { host: '127.0.0.1', port: 0 },
        tokens: { 'peer-1': 'shared-token', 'peer-2': 'shared-token' },
      },
    });
    let caught: unknown;
    try {
      parse(raw);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TypeError);
    // 违规锚定在靠后的键（token→peer 反查表 last-wins 的别名接受者）上且 loud。
    expect((caught as Error).message).toContain('hub.tokens.peer-2: duplicate token value');
  });

  it('rejects file persistence maxDirtyMs above the stop-watchdog budget (SA4 B2: drain window must stay inside the total timeout)', async () => {
    const parse = await loadParseAppConfig();
    const basePersistence = { kind: 'file', rootDir: '/tmp/yjs-server-config-b2' };
    let caught: unknown;
    try {
      parse(hubConfig({ persistence: { ...basePersistence, schedule: { debounceMs: 250, maxDirtyMs: 30_001 } } }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TypeError);
    expect((caught as Error).message).toContain('persistence.schedule.maxDirtyMs');
    // 上界本身合法：排空窗 ≤ 30.5s，严格短于 STOP_WATCHDOG_MS (60s)。
    const atBoundary = parse(hubConfig({ persistence: { ...basePersistence, schedule: { debounceMs: 250, maxDirtyMs: 30_000 } } })) as Record<string, unknown>;
    expect((atBoundary.persistence as Record<string, unknown>).kind).toBe('file');
  });

  it('accepts a valid hub config with direct-form authorization and deep-freezes it', async () => {
    const parse = await loadParseAppConfig();
    const raw = hubConfig({
      hub: {
        listen: { host: '127.0.0.1', port: 0 },
        tokens: { 'peer-1': 'token-1' },
        authorization: [{ peerInstanceId: 'peer-1', namespaceId: NS_A, ownerUserId: 'alice', read: true, submit: true }],
      },
    });
    const parsed = parse(raw) as Record<string, unknown>;
    expect(parsed.role).toBe('hub');
    assertDeepFrozen(parsed);
  });

  it('accepts a valid hub config with provision-form authorization (owner from provision) and deep-freezes it', async () => {
    const parse = await loadParseAppConfig();
    const raw = hubConfig({
      hub: {
        listen: { host: '127.0.0.1', port: 0 },
        tokens: { 'peer-1': 'token-1' },
        provision: [{ id: 'p1', ownerUserId: 'alice', schema: FROZEN_SCHEMA, root: { count: 0 } }],
        authorization: [{ peerInstanceId: 'peer-1', provisionId: 'p1', read: true, submit: true }],
      },
    });
    const parsed = parse(raw) as Record<string, unknown>;
    expect(parsed.role).toBe('hub');
    assertDeepFrozen(parsed);
  });

  it('accepts a valid peer config (static targets + backoff allowed) and deep-freezes it', async () => {
    const parse = await loadParseAppConfig();
    const parsed = parse(peerConfig({ backoff: { baseMs: 500, maxMs: 5_000, resetAfterMs: 10_000 } })) as Record<string, unknown>;
    expect(parsed.role).toBe('peer');
    assertDeepFrozen(parsed);
  });
});
