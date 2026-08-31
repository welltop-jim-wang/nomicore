/**
 * SA7 动态验证 — issue #131（Phase 5 切片 1）：SA4 §10 交办 5 项动态审核重点的
 * 实机测试落盘（本地证据 = 本文件；CI 证据由总控 push 后的 run log 承载）。
 *
 * - D1（SA4 §10.2 plugin 生产随机链路）：真实 cordis host（system clock + 真实
 *   cordis-plugin-timer TimerService + 真实 persistence + registry plugin）→ create
 *   → 产物 namespaceId 显式锚 `/^ns-[0-9a-f]{32}$/`（plugin.apply 内
 *   `randomBytes: productionRandomBytes` 是唯一随机接线——无注入 seam，故经真实
 *   host 组合即实机走 node:crypto 桥接链）；
 * - D2（SA4 §10.3 真实 File Persistence round-trip）：plugin 组合下 create 的生成
 *   ID 经 `@nomicore/persistence` FilePersistence 真实落盘（owner 分区目录 + 35 字符
 *   snapshot 文件名安全性）→ 全拆 → 全新 host 同 rootDir open 恢复 + 跨 owner
 *   NOT_FOUND（单元面为 stub 分区建模，此处为真实 fs 链路）；
 * - D3（SA4 §10.4 CSPRNG 抽样观证）：(a) 真实 plugin host 连续 100 次 create 全唯一；
 *   (b) 生产桥接形状 `(len) => new Uint8Array(node:crypto.randomBytes(len))` 60,000
 *   次抽样——16 字节/普通 Uint8Array 拷贝（非 Buffer 子类外泄）/零重复/字节分布
 *   ±6σ 界（设计 §13 显式拒绝核心统计检测，本抽样仅观证注入方 CSPRNG 契约）；
 * - D4（SA4 §10.5 锚 A 真实时序）：非确定性调度（真实 native scheduler + 真实
 *   FilePersistence fs I/O + 真实 node:crypto 熵）复跑 shutdown×在途重试 interleaving
 *   ——事件驱动 6 次（shutdown 于重试候选 write 在途窗口内同步发起，构造性保证
 *   落点）+ real-sleep 抖动 6 次（0..5ms，采样各异 interleaving 落点）。单测锚 A
 *   用确定性 gate（red.test.ts:597），此处为真实异步序下的屏障行为抽样。
 *
 * 真实性纪律：全部用例零确定性 fake scheduler、零剧本化 persistence；close 路径含
 * 真实 macrotask（setImmediate）。real sleep 仅 D4 抖动 6×≤5ms 与 D3(b) 无 sleep
 * （SA7-P4 烟囱先例，逐处注明）。
 */
import { afterAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomBytes as nodeRandomBytes } from 'node:crypto';
import { Context } from '@deepseek-ai/cordis';
import { provideInstance } from '@nomicore/instance';
import TimerService from '@deepseek-ai/cordis-plugin-timer';
import { systemClock, createSystemClockPlugin } from '@nomicore/clock';
import {
  FilePersistence,
  createFilePersistencePlugin,
  createMemoryPersistencePlugin,
  type PersistenceIO,
  type PersistenceScheduler,
} from '@nomicore/persistence';
import type { DocHandle } from '@nomicore/persistence';
import {
  createNamespaceRegistryPlugin,
  requireNomicoreRegistry,
} from '@nomicore/namespace-registry';
import type {
  CreateNamespaceInput,
  NamespaceLease,
  NamespaceRegistry,
  RegistryTimeoutScheduler,
} from '@nomicore/namespace-registry';
import { createNamespaceRegistryForTesting } from '@nomicore/namespace-registry/testing';

// ═══════════════════════════════ 基础设施 ═══════════════════════════════

const NS_ID_RE = /^ns-[0-9a-f]{32}$/;
const X_HEX = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const X_ID = `ns-${X_HEX}`;

/** 16 字节（128-bit）hex → Uint8Array（与 SA6 red fixture 同款剧本单元）。 */
function hexToBytes16(hex: string): Uint8Array {
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function collectUnhandledRejections(): { readonly events: unknown[]; dispose(): void } {
  const events: unknown[] = [];
  const onRejection = (reason: unknown): void => {
    events.push(reason);
  };
  process.on('unhandledRejection', onRejection);
  return {
    events,
    dispose() {
      process.off('unhandledRejection', onRejection);
    },
  };
}

function okLease(result: unknown): NamespaceLease {
  const r = result as { ok?: boolean; lease?: NamespaceLease };
  expect(r.ok, `期望成功，实际：${JSON.stringify(result)}`).toBe(true);
  if (!r.ok || r.lease === undefined) throw new Error('unreachable');
  return r.lease;
}

/** 新契约三键 create 输入（phase-5 切片 1：namespaceId 由受控随机源生成）。 */
function createInput(userId: string): CreateNamespaceInput {
  return {
    owner: { userId },
    schema: { lang: 'vfsl', version: 1, id: 'ns-sa7-131', text: 'type ROOT = { n: number; };\n' },
    root: { n: 42 },
  };
}

async function flushAndSettle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

const tempRootDirs = new Set<string>();
function makeRootDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomicore-sa7-131-'));
  tempRootDirs.add(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempRootDirs) fs.rmSync(dir, { recursive: true, force: true });
});

/** 真实生产 host 组合（system clock + 真实 TimerService + 指定 persistence 接线）。 */
async function composeRealHost(installPersistence: (ctx: Context) => void): Promise<{ ctx: Context; registry: NamespaceRegistry }> {
  const ctx = new Context();
  provideInstance(ctx, Object.freeze({ instanceId: 'test-host', role: 'hub' }));
  createSystemClockPlugin().apply(ctx);
  new TimerService(ctx); // 真实 timer 服务（native setTimeout/clearTimeout）
  installPersistence(ctx); // persistence 服务接线（直接 apply——plugin 测试 22 先例）
  const registryPlugin = createNamespaceRegistryPlugin();
  const registryFiber = ctx.plugin(registryPlugin);
  await registryFiber;
  return { ctx, registry: requireNomicoreRegistry(ctx) };
}

// ═══════════════════════════════ D1：plugin 生产随机链路 ═══════════════════════════════

describe('SA7 动态验证 #131 — plugin 生产随机链路 / File 持久化 / CSPRNG 抽样 / 真实调度锚 A', () => {
  it('D1 真实 cordis host 下 plugin 桥接的生产随机链路：create 产物 namespaceId 锚 ^ns-[0-9a-f]{32}$、两次互异、lease 可读', async () => {
    const probe = collectUnhandledRejections();
    try {
      const { ctx, registry } = await composeRealHost((c) => createMemoryPersistencePlugin().apply(c));
      const lease1 = okLease(await registry.create(createInput('u-sa7-d1')));
      const lease2 = okLease(await registry.create(createInput('u-sa7-d1')));

      const id1 = lease1.namespaceId;
      const id2 = lease2.namespaceId;
      expect(id1).toMatch(NS_ID_RE); // ★ SA4 §10.2：plugin 链实机格式锚
      expect(id2).toMatch(NS_ID_RE);
      expect(id1).toHaveLength(35); // 'ns-' + 32 hex
      expect(id1).not.toBe(id2); // 两次生成互异（CSPRNG，非常数/单值源）
      expect(lease1.owner).toEqual({ userId: 'u-sa7-d1' }); // owner 投影保持
      expect(lease1.readData(['n'])).toEqual({ ok: true, value: 42 }); // 真实 Runtime 读链路
      expect(registry.getStatus()).toEqual({ state: 'running' });

      console.log(`[SA7-DYN] D1 plugin 链生成 ID: ${id1} / ${id2}`);
      await ctx.fiber.dispose();
      expect(registry.getStatus()).toEqual({ state: 'stopped' });
      await flushAndSettle();
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });

  // ═════════════════════════ D2：真实 File Persistence round-trip ═════════════════════════

  it('D2 真实 File Persistence round-trip：生成 ID 按 owner 分区落盘（35 字符文件名）→ 全拆 → 新 host 同 rootDir 恢复；跨 owner NOT_FOUND', async () => {
    const probe = collectUnhandledRejections();
    try {
      const rootDir = makeRootDir();
      const ownerId = 'u-sa7-file';

      // 第一代 host：create ×2（生成 ID 各异）
      const host1 = await composeRealHost((c) => createFilePersistencePlugin({ rootDir }).apply(c));
      const lease1 = okLease(await host1.registry.create(createInput(ownerId)));
      const lease2 = okLease(await host1.registry.create(createInput(ownerId)));
      const nsIds = [lease1.namespaceId, lease2.namespaceId].sort();
      for (const id of nsIds) expect(id).toMatch(NS_ID_RE);
      expect(nsIds[0]).not.toBe(nsIds[1]);
      await host1.ctx.fiber.dispose();
      expect(host1.registry.getStatus()).toEqual({ state: 'stopped' });

      // 磁盘布局：owner 分区目录 + 恰两个 snapshot、35 字符段安全文件名、非空、零 .tmp 残留
      const userDir = path.join(rootDir, 'users', ownerId);
      const files = fs.readdirSync(userDir).sort();
      expect(files).toEqual(nsIds.map((id) => `${id}.snapshot`));
      for (const file of files) {
        expect(file).toMatch(/^ns-[0-9a-f]{32}\.snapshot$/); // SAFE_PATH_SEGMENT 接纳生成 ID
        expect(path.basename(file, '.snapshot')).toHaveLength(35);
        expect(fs.statSync(path.join(userDir, file)).size).toBeGreaterThan(0);
      }
      expect(files.filter((f) => f.endsWith('.tmp'))).toEqual([]);
      console.log(`[SA7-DYN] D2 落盘文件: ${files.join(', ')}（rootDir=${rootDir}）`);

      // 第二代 host（全新 Context/插件实例，同一 rootDir）：open 恢复 + 跨 owner 不可见
      const host2 = await composeRealHost((c) => createFilePersistencePlugin({ rootDir }).apply(c));
      const first = nsIds[0]!;
      const reopened = okLease(await host2.registry.open({ userId: ownerId }, first));
      expect(reopened.namespaceId).toBe(first);
      expect(reopened.owner).toEqual({ userId: ownerId });
      expect(reopened.readData(['n'])).toEqual({ ok: true, value: 42 }); // 真实 fs round-trip 数据面
      const crossOwner = await host2.registry.open({ userId: 'u-sa7-other' }, first);
      expect(crossOwner).toMatchObject({ ok: false, code: 'NAMESPACE_NOT_FOUND' }); // AC-4 实机
      await host2.ctx.fiber.dispose();
      await flushAndSettle();
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });

  // ═════════════════════════ D3：生产 CSPRNG 抽样观证 ═════════════════════════

  it('D3 生产 CSPRNG 抽样：plugin host 100 次 create 全唯一 + 桥接形状 60,000 抽样零重复/16 字节/分布 ±6σ', { timeout: 120_000 }, async () => {
    const probe = collectUnhandledRejections();
    try {
      // (a) 真实 plugin host（生产随机链路）连续 100 次 create：全唯一 + 全格式合法
      const { ctx, registry } = await composeRealHost((c) => createMemoryPersistencePlugin().apply(c));
      const ids = new Set<string>();
      for (let i = 0; i < 100; i += 1) {
        const lease = okLease(await registry.create(createInput('u-sa7-csprng')));
        expect(lease.namespaceId).toMatch(NS_ID_RE);
        ids.add(lease.namespaceId);
      }
      expect(ids.size).toBe(100); // 抽样零重复（128-bit CSPRNG 期望；常数/低熵源必红）
      await ctx.fiber.dispose();
      expect(registry.getStatus()).toEqual({ state: 'stopped' });

      // (b) 桥接形状抽样：plugin.ts 的 productionRandomBytes 为模块私有（无注入 seam，
      // 这正是 D1 经真实 host 观证的原因）；此处以同款桥接语义直接观证熵源——
      // `(length) => new Uint8Array(node:crypto.randomBytes(length))`。
      const draws = 60_000;
      const seen = new Set<string>();
      const freq = new Uint32Array(256);
      for (let i = 0; i < draws; i += 1) {
        const bytes = new Uint8Array(nodeRandomBytes(16)); // 桥接拷贝语义
        if (i % 1_000 === 0) {
          expect(bytes).toHaveLength(16); // 恰 128-bit
          expect(bytes.constructor).toBe(Uint8Array); // 普通 Uint8Array（非 Buffer 子类外泄）
        }
        let hex = '';
        for (let b = 0; b < 16; b += 1) {
          const v = bytes[b]!;
          freq[v] = (freq[v] ?? 0) + 1;
          hex += v.toString(16).padStart(2, '0');
        }
        expect(`ns-${hex}`).toMatch(NS_ID_RE);
        seen.add(hex);
      }
      expect(seen.size).toBe(draws); // 60,000 抽样零重复

      // 字节分布健全性：期望 3750/字节值，σ≈61.2，±6σ 界（flake 概率 ~5e-7；
      // Math.random/种子化/常数源会越界或已在重复检查红）
      const expected = (draws * 16) / 256;
      const sigma = Math.sqrt(expected * (255 / 256));
      const lo = Math.floor(expected - 6 * sigma);
      const hi = Math.ceil(expected + 6 * sigma);
      for (let v = 0; v < 256; v += 1) {
        const f = freq[v]!;
        expect(f, `byte 0x${v.toString(16)} 频率越界 [${lo}, ${hi}]`).toBeGreaterThanOrEqual(lo);
        expect(f).toBeLessThanOrEqual(hi);
      }
      console.log(`[SA7-DYN] D3 (a) plugin host 100 create → ${ids.size} 唯一；(b) ${draws} 抽样 → 0 重复，字节频率界 [${lo}, ${hi}]（期望 ${expected}）`);
      await flushAndSettle();
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });

  // ═══════════════════ D4：锚 A 真实调度复跑（shutdown × 在途重试）═══════════════════

  interface RetryWindow {
    firstStartNs?: bigint;
    writeStartNs?: bigint;
    writeEndNs?: bigint;
    lastEndNs?: bigint;
  }

  interface IterEvidence {
    readonly mode: 'event' | 'jitter';
    readonly jitterMs: number;
    readonly zone: 'in-write' | 'pre-write' | 'post-write';
    readonly order: readonly string[];
    readonly yId: string;
  }

  function classifyZone(shutdownCallNs: bigint, win: RetryWindow): 'in-write' | 'pre-write' | 'post-write' {
    if (win.writeStartNs !== undefined && win.writeEndNs !== undefined) {
      if (shutdownCallNs >= win.writeStartNs && shutdownCallNs <= win.writeEndNs) return 'in-write';
      if (shutdownCallNs < win.writeStartNs) return 'pre-write';
    }
    return 'post-write';
  }

  /**
   * 单次真实调度迭代：剧本首两笔 X（create#1 建立 entry X + create#2 首候选撞 entry）
   * → 第三笔起真实 node:crypto；重试候选 Y 的 createDoc 走真实 fs I/O（probe read →
   * mkdir → writeFile → rename 多重 macrotask 在途窗口）。
   * - event 模式：在 Y 的 io.write 开始处同步发起 shutdown()（构造性保证落在在途窗口内，
   *   且为「从 persistence 回调栈内重入 shutdown」的对抗性 interleaving）；
   * - jitter 模式：create#2 发起后 real-sleep jitterMs 再 shutdown（采样各异落点）。
   */
  async function runAnchorARealScheduling(mode: 'event' | 'jitter', jitterMs: number): Promise<IterEvidence> {
    const rootDir = makeRootDir();
    const ownerId = 'u-sa7-anchor';
    const constructed: Array<{ namespaceId: string }> = [];
    const closed: Array<{ namespaceId: string }> = [];
    const order: string[] = [];
    const holder: { sp?: Promise<void>; shutdownCallNs?: bigint } = {};
    const win: RetryWindow = {};

    const isRetryCandidateKey = (key: string): boolean => key.slice(key.indexOf('\u0000') + 1) !== X_ID;

    let registryRef: NamespaceRegistry; // wrapIo 回调晚于赋值执行（闭包延迟求值）

    const wrapIo = (io: PersistenceIO): PersistenceIO => ({
      read: async (key, signal) => {
        const track = isRetryCandidateKey(key);
        if (track && win.firstStartNs === undefined) win.firstStartNs = process.hrtime.bigint();
        try {
          return await io.read(key, signal);
        } finally {
          if (track) win.lastEndNs = process.hrtime.bigint();
        }
      },
      write: async (key, snapshot, signal) => {
        const track = isRetryCandidateKey(key);
        if (track) {
          if (win.firstStartNs === undefined) win.firstStartNs = process.hrtime.bigint();
          win.writeStartNs = process.hrtime.bigint();
          if (mode === 'event' && holder.sp === undefined) {
            // ★ 在途重试窗口内（write 尚未结算）发起 shutdown——真实异步序下的屏障观证
            holder.shutdownCallNs = process.hrtime.bigint();
            const sp = registryRef.shutdown();
            void sp.then(
              () => {
                order.push('shutdown');
              },
              () => {
                order.push('shutdown');
              },
            );
            holder.sp = sp;
          }
        }
        try {
          await io.write(key, snapshot, signal);
        } finally {
          if (track) {
            win.writeEndNs = process.hrtime.bigint();
            win.lastEndNs = process.hrtime.bigint();
          }
        }
      },
    });

    const realScheduler: RegistryTimeoutScheduler = {
      setTimeout: (callback, delayMs) => setTimeout(callback, delayMs), // 真实 native timer
      clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
    };
    const fp = new FilePersistence({
      rootDir,
      scheduler: {
        setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
        clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
      } satisfies PersistenceScheduler,
      wrapIo,
    });

    // 受控随机源：首两笔剧本 X（制造 create#2 首候选 entry 碰撞），其后真实 node:crypto
    const xBytes = hexToBytes16(X_HEX);
    let scriptedLeft = 2;
    let draws = 0;
    const registry = createNamespaceRegistryForTesting(
      fp,
      {
        clock: systemClock, // 真实 wall clock（Date.now）
        scheduler: realScheduler,
        randomBytes: (length: number): Uint8Array => {
          draws += 1;
          if (scriptedLeft > 0) {
            scriptedLeft -= 1;
            return xBytes;
          }
          return new Uint8Array(nodeRandomBytes(length)); // 真实 CSPRNG + 桥接拷贝语义
        },
        idleTimeoutMs: 25,
        runtimeFactory: (handle: DocHandle): unknown => {
          const record = { namespaceId: handle.docId };
          constructed.push(record);
          return {
            getStatus: () => ({
              lifecycle: 'ready',
              read: { enabled: true },
              rootWrite: { enabled: true },
              schemaWrite: { enabled: true },
              schema: { state: 'ready' },
              fatal: null,
              close: null,
            }),
            close: () => {
              closed.push({ ...record });
              // 真实异步 close：macrotask 边界后经真实 handle.release()（对齐真实 Runtime
              // 所有权语义——close 归还 DocHandle）；release 结果不改变 close 终局。
              return new Promise<void>((resolve) => {
                setImmediate(() => {
                  void handle.release().then(
                    () => {
                      resolve();
                    },
                    () => {
                      resolve();
                    },
                  );
                });
              });
            },
          };
        },
      } as never, // runtimeFactory 计数包装（SA6 red 同款 cast 先例——内部 seam 类型收窄）
    );
    registryRef = registry;

    // create#1 → entry X（X 文件真实落盘）
    const lease1 = okLease(await registry.create(createInput(ownerId)));
    expect(lease1.namespaceId).toBe(X_ID);

    // create#2：首候选 X 撞 active entry → 重试候选 Y（真实随机）经真实 fs I/O 在途
    const p2 = registry.create(createInput(ownerId));
    void p2.then(
      () => {
        order.push('create2');
      },
      () => {
        order.push('create2');
      },
    );
    if (mode === 'jitter') {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, jitterMs); // real sleep ≤5ms（SA7-P4 烟囱先例，本文件唯一 sleep 族）
      });
      holder.shutdownCallNs = process.hrtime.bigint();
      const sp = registry.shutdown();
      void sp.then(
        () => {
          order.push('shutdown');
        },
        () => {
          order.push('shutdown');
        },
      );
      holder.sp = sp;
    }

    const lease2 = okLease(await p2);
    const yId = lease2.namespaceId;
    expect(yId).toMatch(NS_ID_RE);
    expect(yId).not.toBe(X_ID);
    expect(draws).toBe(3); // X + X(撞) + Y(真实) —— 恰三次生成
    await expect(holder.sp).resolves.toBeUndefined(); // 屏障放行后 shutdown 正常结算

    // 锚 A 不变量（真实调度下逐项复跑）
    expect(order).toEqual(['create2', 'shutdown']); // shutdown settle 晚于 create#2 终局
    expect(constructed.map((r) => r.namespaceId)).toEqual([X_ID, yId]); // 绝无第二个 X Runtime
    expect(closed.filter((r) => r.namespaceId === X_ID)).toHaveLength(1); // X 恰关闭一次
    expect(closed.filter((r) => r.namespaceId === yId)).toHaveLength(1); // Y 恰关闭一次
    expect(registry.getStatus()).toEqual({ state: 'stopped' });
    expect(fs.existsSync(path.join(rootDir, 'users', ownerId, `${X_ID}.snapshot`))).toBe(true);
    expect(fs.existsSync(path.join(rootDir, 'users', ownerId, `${yId}.snapshot`))).toBe(true);

    await fp.dispose(); // 真实 adapter 排空（registry 已 stopped）
    return { mode, jitterMs, zone: classifyZone(holder.shutdownCallNs!, win), order, yId };
  }

  it('D4 锚 A 真实调度复跑：事件驱动 6 次（shutdown 构造性落在重试 write 在途窗口）+ real-sleep 抖动 6 次；不变量逐次成立、零 unhandled', { timeout: 120_000 }, async () => {
    const probe = collectUnhandledRejections();
    try {
      const zones: Record<string, number> = { 'in-write': 0, 'pre-write': 0, 'post-write': 0 };
      for (let i = 0; i < 6; i += 1) {
        const evidence = await runAnchorARealScheduling('event', 0);
        expect(evidence.zone).toBe('in-write'); // 构造保证：在途窗口内发起
        zones[evidence.zone]! += 1;
      }
      for (let i = 0; i < 6; i += 1) {
        const evidence = await runAnchorARealScheduling('jitter', i); // 0..5ms 采样
        zones[evidence.zone]! += 1;
      }
      console.log(`[SA7-DYN] D4 12 次真实调度迭代，shutdown 落点分布: ${JSON.stringify(zones)}`);
      await flushAndSettle();
      expect(probe.events).toEqual([]); // 零 unhandled rejection（全部 promise 出生即 handled）
    } finally {
      probe.dispose();
    }
  });
});
