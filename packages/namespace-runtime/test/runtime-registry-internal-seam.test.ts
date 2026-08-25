/**
 * SA6 红灯验收测试 — issue #109 AC1/AC2/AC4/AC5/AC6：
 * NamespaceRuntime 的受限 Registry 生产构造 seam（@nomicore/namespace-runtime/internal）。
 *
 * 契约来源：
 * - ADR-0009 §模块与 Cordis service：「Registry 通过 `@nomicore/namespace-runtime/internal`
 *   唯一导出的 `createNamespaceRuntimeForRegistry` 构造生产 Runtime；主 entry 不公开生产
 *   Runtime 构造器。模块边界测试限制该 internal subpath 只能由 Registry 生产代码消费」；
 * - ADR-0008 D6.3（生产工厂输入面）：「构造方绑定 `persistence.saveDoc(handle)` 的窄接缝」；
 *   构造序（形状守卫/状态门/所有权转移/P0 入队）「逐字节保持」（任务简报 §边界与纪律）；
 * - 任务简报 AC1–AC6（本文件锚 AC1/AC2/AC4/AC5/AC6；AC3 由既有 exports-audit 留守，
 *   AC7 由 SA3 全量门禁验证）。
 *
 * 红灯现状（2026-08-25 HEAD）：
 * - packages/namespace-runtime/package.json exports 仅 `{ ".": "./src/index.ts" }`，
 *   `@nomicore/namespace-runtime/internal` 不可解析 → 本文件全部经该 specifier 的
 *   动态 import 直接解析失败 → **红**；
 * - ① 处 package.json exports 键集断言 ['.', './internal'] → 现 ['.'] → **红**；
 * - ⑤ 处「编译注入面零调用」无实现可断言（entry 不存在即红）。
 *
 * 断言纪律：内部 entry 的导出表以「运行时模块探测」（import 作用域的可观测键集）锚定，
 * 不读源码文本；AC5 以「仓库内生产代码谁 import 了 internal subpath」的 import 图审计
 * 实现（任务简报指定形态：白名单 = 未来 @nomicore/namespace-registry 生产代码）。
 *
 * 已知契约演进点（任务简报）：
 * - 存量 runtime-acceptance-exports-audit.test.ts T1.4 断言 exports 键集恰 ['.']，
 *   属 issue #93 AC6 存量验收；其「testing seam 绝不进 package entry」不变量保持，
 *   精确键集断言由 SA3 实现时同步演进为 ['.', './internal']（本文件不修改该存量文件）。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DocHandle, User } from '@nomicore/persistence';
import { createMemoryPersistence } from '@nomicore/persistence';
import type { NamespaceRuntime } from '@nomicore/namespace-runtime';

const OWNER: User = { userId: 'u-alice' };

const TEXT_V1 = 'type ROOT = { n: number; a: string; tags: string[]; };';
const ENV1 = { lang: 'vfsl', version: 1, id: 'ns-1', text: TEXT_V1 } as const;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function readValue(runtime: NamespaceRuntime, p: readonly (string | number)[]): unknown {
  const read = runtime.read(p);
  if (!read.ok) throw new Error(`读取应成功，实际 code=${read.code}`);
  return read.value;
}

async function makeDoc(envelope: { lang: string; version: number; id: string; text: string }): Promise<Y.Doc> {
  const doc = new Y.Doc();
  const sc = doc.getMap('SCHEMA');
  for (const [k, v] of Object.entries(envelope)) sc.set(k, v);
  const meta = doc.getMap('META');
  meta.set('docId', 'ns-1');
  meta.set('createdAt', 1_700_000_000_000);
  const root = doc.getMap('ROOT');
  root.set('n', 1);
  root.set('a', 'x');
  const tags = new Y.Array<string>();
  tags.push(['t0', 't1']);
  root.set('tags', tags);
  return doc;
}

/**
 * AC1 主锚：经 package 自引用 specifier 动态导入 internal subpath——
 * 解析走 package.json exports 映射，缺失 ./internal 时解析失败 → 当前红。
 */
async function loadInternalEntry(): Promise<Record<string, unknown>> {
  return (await import('@nomicore/namespace-runtime/internal')) as Record<string, unknown>;
}

type AnyFactory = (...args: unknown[]) => NamespaceRuntime;

/**
 * 经 internal factory 构造 Runtime（双探针：两参形 `(handle, notifyDirty)` 与单对象形
 * `{handle, notifyDirty}` 均为 AC2 允许的真实构造输入形态；形态由 SA3 实现选择，
 * 本测试不预锁 arity——类型面锚在 runtime-registry-internal-type-guard.test-d.ts）。
 * sentinels 是「注入面哨兵」：compile spy + 永不 resolve 的 p0Gate + fault 标记——
 * AC2 要求它们对生产 factory 零效果（若被消费 → P0 失败/挂起 → 本文件红）。
 */
function buildViaInternalFactory(
  entry: Record<string, unknown>,
  handle: DocHandle,
  notifyDirty: () => Promise<void>,
  sentinels: Record<string, unknown>,
): NamespaceRuntime {
  const factory = entry.createNamespaceRuntimeForRegistry as AnyFactory;
  try {
    return factory(handle, notifyDirty, sentinels);
  } catch {
    return factory({ handle, notifyDirty, ...sentinels } as Record<string, unknown>);
  }
}

describe('AC1/AC6：internal subpath 导出面（package exports 配置 + 运行时模块探测）', () => {
  it('package.json exports 键集恰 ["." , "./internal"]——无 ./testing 等测试子路径（AC6 不变量）', () => {
    // 配置审计（package.json 是配置元数据，非被测源码文本）。
    // 【红灯】现 exports 键集 ['.']（internal 子路径尚不存在）；修绿 = 恰
    // ['.', './internal']（ADR-0009 唯一生产 seam；AC6：testing seam 绝不进 package entry）。
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      exports?: Record<string, unknown>;
    };
    expect(pkg.exports).toBeTypeOf('object');
    const keys = Object.keys(pkg.exports as Record<string, unknown>).sort();
    expect(keys).toEqual(['.', './internal']);
    for (const forbidden of ['./testing', './test', './seam', './internal/testing']) {
      expect((pkg.exports as Record<string, unknown>)[forbidden], `不应出现子路径 ${forbidden}`).toBeUndefined();
    }
  });

  it('specifier 可解析，且值导出键集恰一键 createNamespaceRuntimeForRegistry（模块级运行时探测）', async () => {
    // 【红灯】import 解析失败（exports 无 ./internal）；修绿 = 值导出恰一键
    // createNamespaceRuntimeForRegistry（ADR-0009 冻结的 factory 名）。
    const entry = await loadInternalEntry();
    expect(Object.keys(entry).sort()).toEqual(['createNamespaceRuntimeForRegistry']);
    expect(typeof entry.createNamespaceRuntimeForRegistry).toBe('function');
  });

  it('internal entry 零测试 seam 泄漏、零生产工厂别名、零运行态导出（模块级探测）', async () => {
    const entry = await loadInternalEntry();
    for (const forbidden of [
      'createNamespaceRuntimeWithSeam', // 测试 seam 构造器——只存在于包内模块通道
      'createNamespaceRuntime', // 生产工厂别名——internal 只允许 Registry 专用形态
      'WriteSequencer', // 运行态不导出
      'runP0',
      'runRootWriteSlot',
      'runCloseBarrier',
      'buildStatus',
      'PersistenceHandle',
      'MemoryPersistence',
      'FilePersistence',
    ]) {
      expect(entry[forbidden], `internal entry 模块级导出 ${forbidden} 应缺席`).toBeUndefined();
    }
  });
});

describe('AC2：factory 只接收 handle + dirty notifier——compile/p0Gate/fault 注入面零效果', () => {
  it('附着 compile spy（调用即抛）、永不 resolve 的 p0Gate 与 fault 哨兵：P0 仍以真实 vfsl 编译结算，spy 零调用，Runtime 功能完整', async () => {
    const store = new Map<string, Uint8Array>();
    const writer = createMemoryPersistence({
      schedule: { debounceMs: 5, maxDirtyMs: 60 },
      writeSnapshot: async (key, snapshot) => {
        store.set(key, snapshot.slice());
      },
    });
    const handle = await writer.createDoc(OWNER, 'ns-1', await makeDoc(ENV1));
    try {
      const entry = await loadInternalEntry(); // 【红灯】解析失败
      const compileCalls = { count: 0 };
      const sentinels = {
        compile: () => {
          compileCalls.count += 1;
          throw new Error('生产 internal factory 不得接受 compile 注入面（AC2）');
        },
        p0Gate: new Promise<void>(() => {}),
        fault: { marker: 'must-never-be-consumed' },
      };
      const notifySeq: number[] = [];
      const runtime = buildViaInternalFactory(entry, handle, async () => {
        notifySeq.push(1);
        await writer.saveDoc(handle);
      }, sentinels);

      // 注入的 p0Gate 永不 resolve——若被消费则 P0 永远 preparing → poll 超时 → 红。
      // 注入的 compile 抛错——若被消费则 P0 internal fault → 红。
      await expect
        .poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 })
        .toBe('ready');
      expect(compileCalls.count, 'compile 注入面必须零调用（真实 vfsl compileSchemaEnvelope 结算）').toBe(0);
      expect(runtime.getStatus().fatal).toBeNull();
      expect(runtime.getActiveSchema()?.id).toBe('ns-1');

      // Runtime 经最小输入仍全功能：读 + 写 + notifyDirty 绑定恰好生效一次
      expect(readValue(runtime, ['n'])).toBe(1);
      const wr = await runtime.mutateRoot({ op: 'set', path: ['n'], value: 11 });
      expect(wr).toEqual({ ok: true });
      expect(readValue(runtime, ['n'])).toBe(11);
      expect(notifySeq).toEqual([1]); // 恰好一次 notifyDirty（无 P0/close 杂音）
    } finally {
      await handle.release().catch(() => {});
      await writer.dispose();
    }
  });
});

describe('AC4：factory 产出的 Runtime 保持 P0 队首/读取/写序列器/fatal/status/close 全部现有语义', () => {
  it('经 internal factory 全链：P0 队首 → 立即同步读取 → FIFO 写（notifyDirty 每写恰一次、严格按序）→ status 七键/十键面 → close 幂等释放', async () => {
    const store = new Map<string, Uint8Array>();
    const writer = createMemoryPersistence({
      schedule: { debounceMs: 5, maxDirtyMs: 60 },
      writeSnapshot: async (key, snapshot) => {
        store.set(key, snapshot.slice());
      },
    });
    const reader = createMemoryPersistence({ readSnapshot: async (key) => store.get(key) });
    const handle = await writer.createDoc(OWNER, 'ns-1', await makeDoc(ENV1));
    try {
      const entry = await loadInternalEntry(); // 【红灯】解析失败
      const factory = entry.createNamespaceRuntimeForRegistry as AnyFactory;
      expect(typeof factory, 'internal subpath 唯一值导出必须是函数（AC1）').toBe('function');

      // notifyDirty = ADR-0008「构造方绑定 persistence.saveDoc(handle)」逐字形；
      // 首笔 notify 延迟 40ms——若写序列器 FIFO 缺失，后续写会越过它（notifySeq 乱序 → 红）。
      const notifySeq: number[] = [];
      let firstNotify = true;
      const notifyDirty = async () => {
        if (firstNotify) {
          firstNotify = false;
          await sleep(40);
        }
        notifySeq.push(notifySeq.length + 1);
        await writer.saveDoc(handle);
      };
      // 注入面哨兵（AC2 交叉锚）：compile 调用即抛、p0Gate 永不 resolve——
      // 被消费则 P0 失败/挂起 → 本链红。
      const compileCalls = { count: 0 };
      const runtime = buildViaInternalFactory(entry, handle, notifyDirty, {
        compile: () => {
          compileCalls.count += 1;
          throw new Error('生产 internal factory 不得接受 compile 注入面');
        },
        p0Gate: new Promise<void>(() => {}),
      });

      // ① 构造返回后同步读取立即可用（读取不等待 P0 或任何写任务——ADR-0008 读取能力节）
      const r0 = runtime.read(['n']);
      expect(r0.ok, '构造返回后读取必须立即可用（不等待 P0）').toBe(true);
      if (r0.ok) expect(r0.value).toBe(1);

      // ② P0 队首 + 真实编译：构造后立即发第一笔写（排在 P0 后）；P0 以真实 vfsl
      //    compileSchemaEnvelope 结算为 ready，且 P0 零 notify（预算恰为每笔成功写一次）
      const w1p = runtime.mutateRoot({ op: 'set', path: ['n'], value: 10 });
      await expect
        .poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 })
        .toBe('ready');
      expect(runtime.getActiveSchema()?.id).toBe('ns-1');
      expect(compileCalls.count, 'compile 注入面必须零调用').toBe(0);
      // 在首笔 notify 的 40ms 延迟窗内发起第二笔写——FIFO 缺失则第二笔越过第一笔
      const w2p = runtime.mutateRoot({ op: 'set', path: ['n'], value: 20 });
      expect(await w1p).toEqual({ ok: true });
      expect(await w2p).toEqual({ ok: true });
      expect(notifySeq, 'notifyDirty 必须严格按写槽序（写序列器 FIFO 屏障）').toEqual([1, 2]);
      expect(readValue(runtime, ['n'])).toBe(20);

      // ③ status 七键面（经 registry factory 构造路径逐键复核——AC4「保持现有语义」）
      const st = runtime.getStatus();
      expect(Object.keys(st).sort()).toEqual(['close', 'fatal', 'lifecycle', 'read', 'rootWrite', 'schema', 'schemaWrite']);
      expect(st.lifecycle).toBe('ready');
      expect(st.fatal).toBeNull();
      expect(st.close).toBeNull();
      expect(st.read.enabled).toBe(true);
      expect(st.rootWrite.enabled).toBe(true);
      expect(st.schemaWrite.enabled).toBe(true);

      // ④ 十键公共面（对象字面量 + freeze，无 class 原型、无脚本注入键）
      expect(Object.keys(runtime).sort()).toEqual([
        'close',
        'getActiveSchema',
        'getMetadata',
        'getSchemaEnvelope',
        'getStatus',
        'mutateRoot',
        'namespaceId',
        'owner',
        'read',
        'replaceSchema',
      ]);
      expect(runtime.owner).toEqual({ userId: 'u-alice' });
      expect(runtime.namespaceId).toBe('ns-1');

      // ⑤ close：首次同步进入 closing、并发/后续返回同一 Promise（幂等）、release 恰一次、
      //    closed 后 read/write 停接纳（RUNTIME_READ_DISABLED / RUNTIME_WRITE_DISABLED）
      const c1 = runtime.close();
      expect(runtime.getStatus().lifecycle).toBe('closing');
      const c2 = runtime.close();
      expect(c2, 'close 幂等：后续调用必须返回同一 Promise 实例').toBe(c1);
      await c1;
      expect(runtime.getStatus().lifecycle).toBe('closed');
      expect(handle.getStatus()).toBe('released');
      const ra = runtime.read(['n']);
      expect(ra.ok).toBe(false);
      if (!ra.ok) expect(ra.code).toBe('RUNTIME_READ_DISABLED');
      const wAfter = await runtime.mutateRoot({ op: 'set', path: ['n'], value: 99 });
      expect(wAfter.ok).toBe(false);
      expect(JSON.stringify(wAfter)).toContain('RUNTIME_WRITE_DISABLED');
      const st2 = runtime.getStatus();
      expect(st2.lifecycle).toBe('closed');
      expect(st2.read.enabled).toBe(false);
      expect(st2.fatal).toBeNull();

      // ⑥ 跨实例持久化证明：registry factory 路径的写真实落盘（全新 reader 空缓存读取；
      //    等待 debounce 定时 flush——同既有持久化链测试的 sleep(100) 惯例）
      await sleep(100);
      const loaded = await reader.loadDoc(OWNER, 'ns-1');
      expect(loaded).not.toBeNull();
      if (loaded !== null) {
        expect(loaded.doc).not.toBe(handle.doc);
        expect(loaded.doc.getMap('ROOT').get('n')).toBe(20);
        await loaded.release();
      }
    } finally {
      await handle.release().catch(() => {});
      await writer.dispose();
      await reader.dispose();
    }
  });
});

describe('AC5：模块边界——internal subpath 仅允许 Registry 生产代码消费（import 图静态审计）', () => {
  const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
  // 白名单 = ADR-0009 未来 @nomicore/namespace-registry 的生产源码（当前仓库尚无该包；
  // 本文件不锁「当前为空集」为断言——切片 5/6 落地后审计谓词自动放行，不破坏本测试）。
  const REGISTRY_SRC_PREFIX = 'packages/namespace-registry/src/';

  function isWhitelistedConsumer(relPath: string): boolean {
    const p = relPath.replace(/\\/g, '/');
    return p.startsWith(REGISTRY_SRC_PREFIX);
  }

  /**
   * 遍历仓库生产源码树（packages 下各包的 src 目录、domains 目录、apps 目录，
   * 排除 test/tests/node_modules/docs/wiki 等），返回含 internal subpath specifier
   * 的生产文件相对路径（import 图审计）。
   */
  function auditInternalSubpathImporters(): { prodFiles: number; importers: string[] } {
    const specifier = '@nomicore/namespace-runtime/internal';
    const importRe = new RegExp(
      `from\\s+['"]${specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]|` +
        `import\\s*\\(\\s*['"]${specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]\\s*\\)`,
    );
    const SKIP_DIRS = new Set([
      'node_modules',
      '.git',
      '.mabf-bg',
      'dist',
      'coverage',
      'test',
      'tests',
      '__tests__',
      'docs',
      'wiki',
    ]);
    const SKIP_FILES = new Set(['package.json', 'README.md']);
    const importers: string[] = [];
    let prodFiles = 0;
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        if (SKIP_DIRS.has(name) || SKIP_FILES.has(name)) continue;
        const full = path.join(dir, name);
        const stat = statSync(full);
        if (stat.isDirectory()) {
          walk(full);
        } else if (/\.(ts|tsx|mts|cts)$/.test(name) && !name.endsWith('.d.ts')) {
          prodFiles += 1;
          const content = readFileSync(full, 'utf8');
          if (importRe.test(content)) importers.push(path.relative(REPO_ROOT, full).replace(/\\/g, '/'));
        }
      }
    };
    for (const root of ['packages', 'domains', 'apps']) {
      const p = path.join(REPO_ROOT, root);
      if (existsSync(p)) walk(p);
    }
    return { prodFiles, importers };
  }

  it('审计自身覆盖仓库生产源码树（防空扫）', () => {
    const { prodFiles } = auditInternalSubpathImporters();
    expect(prodFiles).toBeGreaterThan(0);
  });

  it('白名单谓词：前瞻性只放行 @nomicore/namespace-registry 生产代码', () => {
    expect(isWhitelistedConsumer('packages/namespace-registry/src/registry.ts')).toBe(true);
    expect(isWhitelistedConsumer('packages/namespace-registry/src/index.ts')).toBe(true);
    expect(isWhitelistedConsumer('packages/persistence/src/index.ts')).toBe(false);
    expect(isWhitelistedConsumer('packages/namespace-runtime/src/index.ts')).toBe(false);
    expect(isWhitelistedConsumer('packages/namespace-runtime/src/internal.ts')).toBe(false);
    expect(isWhitelistedConsumer('domains/vfs3-assets/src/schema.ts')).toBe(false);
  });

  it('internal subpath 的生产代码消费方 ⊆ 白名单（仅 Registry 生产代码；边界即防线）', () => {
    const { importers } = auditInternalSubpathImporters();
    const violating = importers.filter((p) => !isWhitelistedConsumer(p));
    expect(
      violating,
      `internal subpath 只允许 Registry 生产代码消费；违规消费方：${violating.join(', ') || '(无)'}`,
    ).toEqual([]);
  });
});
