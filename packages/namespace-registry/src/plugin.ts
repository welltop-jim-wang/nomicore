/**
 * @nomicore/namespace-registry —— Cordis 插件适配层（issue #112 设计 §2.F；ADR-0009
 * 的模块与 Cordis service 节；issue #104 决策：service 名 `nomicoreRegistry`）。
 *
 * 本文件是本包唯一允许 import `@deepseek-ai/cordis*` 的模块（§2.M 静态守卫白名单 =
 * {plugin.ts}）——`import type { Context } from '@deepseek-ai/cordis'` 与
 * `import type {} from '@deepseek-ai/cordis-plugin-timer'`（timer Context mixin 类型，
 * persistence service.ts 同款）均为类型级；Registry 核心（registry.ts 等）零 cordis。
 * 模块通道：经相对 `./registry.js` 导入核心（绝不走包内 subpath specifier 或 barrel，
 * persistence service.ts 先例）。
 *
 * ⚠️ 宿主接线契约（冻结要点，随实现落纸——设计 §2.F）：
 *
 * 1. **timer fiber 生命周期必须 ⊇ Registry plugin 生命周期**：宿主必须先装
 *    clock/timer/persistence、后停 registry（persistence R1/#15 同款契约）。timer
 *    plugin 先卸的后果：其 fiber 卸载会**静默清除**本 Registry 经 `ctx.timeout`
 *    武装的全部 pending idle timer（回调永不触发，§5#2）——受影响 entry 滞留 idle
 *    （无 timer、无自发 close），直至后续 open 激活复用或 Registry shutdown 关闭
 *    （R1/O2 后果声明：滞留不崩溃、不泄漏 entry 之外资源，但 idle 回收停摆）；其后
 *    任何 `ctx.timeout` 调用（新武装）抛 `INACTIVE_EFFECT`，属宿主接线违约，不在
 *    plugin 内防御（Registry shutdown 显式 clearTimeout 兜底自持 timer）。
 *
 * 2. **AC11 时序解读（R1/O1）**：「先于 Persistence dispose」= **fiber 级**保证——
 *    Registry fiber 卸载完成（含 `registry.shutdown()` settle 与 `nomicoreRegistry`
 *    service 撤销完成）先于 persistence fiber 卸载完成与 `nomicorePersistence`
 *    service 撤销完成（机制 = inject 依赖图 join，§5#5）；**adapter 级**排空次序
 *    （persistence adapter 自身 dispose 与 Registry shutdown 的并发）不在此保证内，
 *    为设计 §8 R1 残余并发声明——close 写排空撞上已销毁 handle 时进入 shutdown
 *    聚合错误（诚实、响亮、不静默），根治超出本票 DENY 边界（persistence src 不改）。
 *
 * 3. **fiber reload 语义**：persistence 服务替换/重启触发本 fiber 卸载+重载，每次
 *    apply 构造**全新 Registry 实例**（旧实例 shutdown、service 撤销、`instance`
 *    指向新实例）——v1 接受完整回收（Registry 不跨 persistence 代际存续，lease 随
 *    旧实例失效）。
 */
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/cordis-plugin-timer';
import { requireClock } from '@nomicore/clock';
import { requireNomicorePersistence } from '@nomicore/persistence';
import {
  createNamespaceRegistry,
  resolveIdleTimeoutMs,
} from './registry.js';
import type { NamespaceRegistry, RegistryTimeoutScheduler } from './types.js';
import { NAMESPACE_REGISTRY_PLUGIN_CONFIG_MESSAGE } from './types.js';

// R1/M3 单点化：DEFAULT_IDLE_TIMEOUT_MS 唯一运行时定义点在 registry.ts（与
// resolveIdleTimeoutMs 同居）；本文件仅 re-export，index.ts 沿本文件链转出——
// 零第二定义点。
export { DEFAULT_IDLE_TIMEOUT_MS } from './registry.js';

/** Cordis service 名（issue #104 决策冻结名）。 */
export const NOMICORE_REGISTRY_SERVICE = 'nomicoreRegistry' as const;

declare module '@deepseek-ai/cordis' {
  interface Context {
    nomicoreRegistry: NamespaceRegistry;
  }
}

/** 在当前 Context 发布 nomicoreRegistry service；返回注销函数（对齐 provide 型 helper 模式）。 */
export function provideNomicoreRegistry(ctx: Context, registry: NamespaceRegistry): () => void {
  return ctx.provide(NOMICORE_REGISTRY_SERVICE, registry);
}

/** 取 nomicoreRegistry service；缺失即 loud throw（无 fallback——AC3）。 */
export function requireNomicoreRegistry(ctx: Context): NamespaceRegistry {
  const registry = ctx.get(NOMICORE_REGISTRY_SERVICE);
  if (registry === undefined) {
    throw new Error('required Cordis service "nomicoreRegistry" is unavailable');
  }
  return registry;
}

/** 插件配置（AC2）：唯一配置键 `idleTimeoutMs`（多余键 loud 拒绝）。 */
export interface NamespaceRegistryPluginConfig {
  readonly idleTimeoutMs?: number;
}

/**
 * 插件启动强依赖断言（AC3）：在 provide service **之前**同步执行；缺失任一依赖即
 * loud throw（不 fallback、不 console.error 后继续）。检验经 `ctx.get(name)` 安全
 * 探针（cordis 已核实：缺失返回 `undefined`、从不 throw）；检查顺序固定
 * clock → timer → nomicorePersistence，首个失败即 throw；文案稳定、单句、含
 * service 名与安装指引（clock/persistence 沿用各包现有文案，timer 为本插件专属）。
 */
export function assertNamespaceRegistryHostDependencies(ctx: Context): void {
  requireClock(ctx); // 缺失 → throw 'required Cordis service "clock" is unavailable'（@nomicore/clock 现有文案）
  const timer = ctx.get('timer') as { timeout?: unknown } | undefined;
  if (timer === undefined || typeof timer.timeout !== 'function') {
    throw new Error(
      'required Cordis service "timer" is unavailable: '
      + 'install @deepseek-ai/cordis-plugin-timer before the namespace-registry plugin',
    );
  }
  requireNomicorePersistence(ctx); // 缺失 → throw 'required Cordis service "nomicorePersistence" is unavailable'
}

/**
 * 派生 plugin 路径的唯一 RegistryTimeoutScheduler 来源（§2.A/§2.F）：内部先执行
 * `assertNamespaceRegistryHostDependencies`（订单保证：断言失败时任何 service 都未
 * 提供），再桥接 `ctx.timeout`。
 *
 * `ctx.timeout(cb, ms)` 返回幂等 disposer（cordis-plugin-timer 源码已核实：effect
 * wrapper 单次守卫；timer 触发时先 `dispose()` 再 `callback()`），故 disposer 即
 * handle——`clearTimeout(handle) === handle()`：触发前调用取消底层 native timer，
 * 触发后调用是无害清理，与 `clearTimeout(handle)` 语义精确对齐。
 */
export function createCordisRegistryScheduler(ctx: Context): RegistryTimeoutScheduler {
  assertNamespaceRegistryHostDependencies(ctx);
  return {
    setTimeout: (callback, delayMs) => ctx.timeout(callback, delayMs),
    clearTimeout: (handle) => {
      (handle as () => void)();
    },
  };
}

/**
 * 插件 config 校验（AC2）：工厂调用期同步 loud（对齐 `resolvePersistenceSchedule`
 * 先例；不声明 cordis Config schema，零新依赖）。仅接受 `{ idleTimeoutMs? }` 单键
 * ——恒 'idleTimeoutMs' 子集；多余键 TypeError（拒绝静默忽略拼错键——默认 5 分钟将
 * 掩盖错误）；数值域校验复用核心单点 resolveIdleTimeoutMs（§2.A：类型/域二分 +
 * 默认值）。
 */
function resolvePluginIdleTimeoutMs(config: NamespaceRegistryPluginConfig): number {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new TypeError(NAMESPACE_REGISTRY_PLUGIN_CONFIG_MESSAGE);
  }
  const keys = Object.keys(config);
  if (keys.some((k) => k !== 'idleTimeoutMs')) {
    throw new TypeError(NAMESPACE_REGISTRY_PLUGIN_CONFIG_MESSAGE);
  }
  return resolveIdleTimeoutMs(config);
}

/**
 * Cordis plugin 工厂；每次调用构造全新 Registry 实例（fiber reload 语义见文件头
 * 契约第 3 条）。AC3 双通道：`inject` 声明（通道 B：`ctx.plugin` 装载在依赖图上
 * 保持原生 PENDING 门——不半启动、零 service、零 fallback）+ apply 内
 * `assertNamespaceRegistryHostDependencies`（通道 A：直接 `apply` 的在场+形状 loud
 * 门；inject 只保证服务在场、不保证形状——如无 `timeout` 成员的假 timer 服务仍由
 * 断言 throw）。
 */
export function createNamespaceRegistryPlugin(config: NamespaceRegistryPluginConfig = {}) {
  const idleTimeoutMs = resolvePluginIdleTimeoutMs(config); // 工厂调用期同步校验（无 ctx）
  let instance: NamespaceRegistry | undefined;
  return {
    inject: ['clock', 'timer', 'nomicorePersistence'], // 依赖图边：AC11 时序保证的机制载体（§5#5/#8）
    apply(ctx: Context): void {
      assertNamespaceRegistryHostDependencies(ctx); // 形状级 loud fail（见上）
      const registry = createNamespaceRegistry(requireNomicorePersistence(ctx), {
        clock: requireClock(ctx),
        scheduler: createCordisRegistryScheduler(ctx),
        idleTimeoutMs,
      });
      instance = registry;
      let revokeService: (() => void) | undefined;
      ctx.effect(function* () {
        // 有序 disposer（AC11）：yield 顺序 = 收集顺序 [revoke, shutdownDisposer]；
        // fiber/effect dispose 按收集序逆序**串行**执行 → shutdown 完成后才撤
        // service。yield revoke 同时把嵌套 provide wrapper 从 fiber 级清单 re-parent
        // 进本 effect 的有序表（否则它与外层 disposer 在 fiber _unload 的
        // Promise.all 中并发——次序不确定，§5#3/#4）。
        const revoke = provideNomicoreRegistry(ctx, registry);
        revokeService = revoke;
        yield revoke;
        yield async () => {
          try {
            await registry.shutdown();
          } finally {
            revokeService?.(); // shutdown reject（聚合错误）也不阻断撤 service；rejection 交 cordis fiber 日志
            // fiber 卸载完成即撤回已回收实例的暴露面（测试 25-27 锚：dispose 后
            // plugin.instance === undefined）；fiber reload 时 apply 重执行并指向新实例。
            instance = undefined;
          }
        };
      }, 'namespace-registry: service');
    },
    get instance(): NamespaceRegistry | undefined {
      return instance;
    },
  };
}
