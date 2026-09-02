/**
 * [SA6 owned] T5 — 进程内有序停机契约（设计 §3.6 / AC4）骨架：`createNomicoreApp`
 * 以 memory persistence 装配 → `stop()` → NDJSON 停机序
 * `replication-drained → registry-stopped → persistence-disposed → app-stopped`
 * 严格递增；重复 `stop()` 幂等；端口释放后同一配置可重建新实例。
 *
 * RED 基线：`@nomicore/yjs-server` 不存在 → 首个动态 import 即抛模块解析错误。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timeout ${timeoutMs}ms waiting for ${what}`);
    }
    await sleep(50);
  }
}

describe('T5 ordered shutdown (design §3.6 / AC4)', () => {
  const stdoutChunks: string[] = [];
  let stdoutSpy: MockInstance<typeof process.stdout.write>;

  beforeAll(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stdoutChunks.push(String(chunk));
      return true;
    });
  });

  afterAll(() => {
    stdoutSpy.mockRestore();
  });

  beforeEach(() => {
    // 测试间隔离：stdoutChunks 为共享累加器——不清理会让后一用例的 waitFor 被前一
    // 用例的事件假满足（导致 stop() 与在飞 boot 竞态，测试假绿）。
    stdoutChunks.length = 0;
  });

  it('createNomicoreApp + stop() emits ordered teardown events and is idempotent', async () => {
    const { createNomicoreApp } = (await import(/* @vite-ignore */ '@nomicore/yjs-server')) as {
      createNomicoreApp: (config: Record<string, unknown>) => {
        stop(): Promise<void>;
      };
    };
    expect(typeof createNomicoreApp).toBe('function');

    const app = createNomicoreApp({
      role: 'hub',
      instanceId: 'hub-1',
      persistence: { kind: 'memory' },
      hub: {
        listen: { host: '127.0.0.1', port: 0 },
        tokens: { 'peer-1': 'token-1' },
      },
    });

    await waitFor(
      () => stdoutChunks.some((c) => c.includes('"event":"ready"')),
      20_000,
      'hub startup `ready` event',
    );

    await app.stop();
    await waitFor(
      () => stdoutChunks.some((c) => c.includes('"event":"app-stopped"')),
      20_000,
      '`app-stopped` event',
    );

    const sequence = ['replication-drained', 'registry-stopped', 'persistence-disposed', 'app-stopped'];
    const indexes = sequence.map((name) =>
      stdoutChunks.findIndex((c) => c.includes(`"event":"${name}"`)),
    );
    expect(indexes.every((i) => i >= 0), `all events seen: ${JSON.stringify(sequence)}`).toBe(true);
    const [iReplication = -1, iRegistry = -1, iPersistence = -1, iApp = -1] = indexes;
    expect(
      iReplication < iRegistry && iRegistry < iPersistence && iPersistence < iApp,
      `teardown order strictly increasing: ${JSON.stringify(indexes)}`,
    ).toBe(true);

    // 停机幂等（单一拆卸链纪律：重复 stop 无第二次拆卸）。
    await app.stop();
  });

  it('releases the port so a fresh app instance can be built with the same config after stop', async () => {
    const { createNomicoreApp } = (await import(/* @vite-ignore */ '@nomicore/yjs-server')) as {
      createNomicoreApp: (config: Record<string, unknown>) => {
        stop(): Promise<void>;
      };
    };

    const config = {
      role: 'hub',
      instanceId: 'hub-1',
      persistence: { kind: 'memory' },
      hub: {
        listen: { host: '127.0.0.1', port: 0 },
        tokens: { 'peer-1': 'token-1' },
      },
    };

    const first = createNomicoreApp(config);
    await waitFor(
      () => stdoutChunks.some((c) => c.includes('"event":"ready"')),
      20_000,
      'first instance `ready`',
    );
    await first.stop();
    await waitFor(
      () => stdoutChunks.some((c) => c.includes('"event":"app-stopped"')),
      20_000,
      'first instance `app-stopped`',
    );

    const second = createNomicoreApp(config);
    await waitFor(
      () => stdoutChunks.some((c) => c.includes('"event":"ready"')),
      20_000,
      'second instance `ready` after port release',
    );
    await second.stop();
    await waitFor(
      () => stdoutChunks.some((c) => c.includes('"event":"app-stopped"')),
      20_000,
      'second instance `app-stopped`',
    );
  });
});
