/**
 * [SA6 owned] T4 — AC6 公共组合 seam（设计 §5-T4）：第三方 Cordis Host 只经
 * `@nomicore/*` 公共入口 + cordis 复刻 hosting 文档最小装配，不 import 任何应用
 * 内部 specifier；应用公共入口 `@nomicore/yjs-server` 亦被该文件引用（非内部
 * subpath——SA4 可静态比对 import 清单），锚定 compose 后的应用暴露面。
 *
 * RED 基线：`@nomicore/yjs-server` 当前不存在 → 「应用公共入口暴露」用例在运行期
 * 动态 import 处抛模块解析错误（红），与组装用例同文件可见。
 */
import { describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import TimerService from '@deepseek-ai/cordis-plugin-timer';
import { createSystemClockPlugin } from '@nomicore/clock';
import { createMemoryPersistencePlugin } from '@nomicore/persistence';
import {
  createNamespaceRegistryPlugin,
  requireNomicoreRegistry,
} from '@nomicore/namespace-registry';

describe('T4 third-party public compose seam (AC6 / design §5-T4)', () => {
  it('composes clock→TimerService→persistence→registry→create→enableReplication→openReplicationSession from public entries only', async () => {
    const ctx = new Context();

    const clockFiber = ctx.plugin(createSystemClockPlugin());
    await clockFiber;

    // TimerService 构造时同步向 Context 提供 timer service（hosting 文档 L57 先例）。
    new TimerService(ctx);

    const persistenceFiber = ctx.plugin(createMemoryPersistencePlugin());
    await persistenceFiber;

    const registryFiber = ctx.plugin(createNamespaceRegistryPlugin({ role: 'hub' }));
    await registryFiber;

    const registry = requireNomicoreRegistry(ctx);

    const created = await registry.create({
      owner: { userId: 'alice' },
      schema: { lang: 'vfsl', version: 1, id: 'notes-v1', text: 'type ROOT = { count: number; };\n' },
      root: { count: 0 },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(`registry.create rejected: ${created.code}`);
    const lease = created.lease;

    const enabled = await lease.enableReplication();
    expect(enabled.ok).toBe(true);

    const opened = await lease.openReplicationSession({ localRole: 'hub', remoteInstanceId: 'peer-1' });
    expect(opened.ok).toBe(true);
    if (!opened.ok) throw new Error(`openReplicationSession rejected: ${opened.code}`);
    expect(opened.session.getStatus()).toBeDefined();

    await lease.release();
    await registry.shutdown();
    await persistenceFiber.dispose();
    await ctx.fiber.dispose();
  });

  it('app public entry exposes the composition surface (RED baseline: module absent until SA3 implements)', async () => {
    const mod = (await import(/* @vite-ignore */ '@nomicore/yjs-server')) as Record<string, unknown>;
    expect(typeof mod.createNomicoreApp).toBe('function');
    expect(typeof mod.parseAppConfig).toBe('function');
  });
});
