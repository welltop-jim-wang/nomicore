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
 * 2. **AC11 时序解读（rev1 强化：adapter 级真实保证）**：「先于 Persistence dispose」
 *    = adapter 级保证——persistence 侧共享 wiring（bindPersistenceAdapterLifecycle，
 *    packages/persistence/src/service.ts）把 service 撤销与 adapter dispose 纳入同一
 *    有序 effect：卸载时先撤 nomicorePersistence（delete store → notify → await
 *    全部依赖 fiber 卸载完成），后执行 adapter dispose。因此 Registry shutdown
 *    settle（含 handle.release 全程与 saveDoc 的 entry 断言）严格先于 persistence
 *    adapter dispose 开始（机制 = generator effect re-parent + 逆序串行 + provide
 *    disposer 的依赖 fiber join）；「close 撞已销毁 handle → shutdown 聚合失败」
 *    被消灭。fiber 级保证（Registry fiber 卸载完成先于 persistence fiber 卸载完成）
 *    仍由 inject 依赖图承载，且是 adapter 级保证的上游前提。
 *    ⚠️ 残余窗口（R5′，生产 timer 限定）：persistence fiber 自身 UNLOADING 的 drain
 *    窗口内，经 ctx.timeout 的新 flush/retry timer 武装抛 CordisError('INACTIVE_EFFECT')
 *    （真实 TimerService 语义，副作用绑定调用方 fiber）→ 窗口内到达 saveDoc 的在途写
 *    收到响亮 rejection（交付写调用方；close barrier 在写槽 settle 后照常执行，
 *    shutdown 终态不受影响）。需要写排空完整落盘的宿主：先 settle 依赖方（await
 *    registry shutdown / fiber 卸载）再拆 persistence fiber。fake-timer 测试 seam
 *    不经 ctx.effect，对该窗口结构性失明。round 1 的「fiber 级限定 + adapter 级残余
 *    并发（§8 R1）」声明废止（§8 R1 并发已根治；本窗口为 cordis fiber 状态门的
 *    独立残余，见设计 rev1 §8 R5′）。
 *
 * 3. **fiber reload 语义**：persistence 服务替换/重启触发本 fiber 卸载+重载，每次
 *    apply 构造**全新 Registry 实例**（旧实例 shutdown、service 撤销、`instance`
 *    指向新实例）——v1 接受完整回收（Registry 不跨 persistence 代际存续，lease 随
 *    旧实例失效）。
 */
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/cordis-plugin-timer';
import { randomBytes as nodeRandomBytesSource } from 'node:crypto';
import { requireClock } from '@nomicore/clock';
import { requireNomicorePersistence } from '@nomicore/persistence';
import {
  createNamespaceRegistry,
  resolveIdleTimeoutMs,
} from './registry.js';
import type { NamespaceRegistry, RegistryRandomBytes, RegistryTimeoutScheduler, InstanceRole } from './types.js';
import { NAMESPACE_REGISTRY_PLUGIN_CONFIG_MESSAGE, NAMESPACE_REGISTRY_ROLE_INVALID_MESSAGE } from './types.js';

// R1/M3 单点化：DEFAULT_IDLE_TIMEOUT_MS 唯一运行时定义点在 registry.ts（与
// resolveIdleTimeoutMs 同居）；本文件仅 re-export，index.ts 沿本文件链转出——
// 零第二定义点。
export { DEFAULT_IDLE_TIMEOUT_MS } from './registry.js';

/** Cordis service 名（issue #104 决策冻结名）。 */
export const NOMICORE_REGISTRY_SERVICE = 'nomicoreRegistry' as const;

/**
 * 生产受控随机源（phase-5 切片 1，ADR 0010 身份条款 + ADR 0009 依赖纪律）：Node
 * CSPRNG 桥接。核心（registry.ts 等）零全局 crypto 直调——生产来源只在本
 * Host-facing 适配层接线。Buffer → `new Uint8Array` 拷贝：交付精确契约类型（独立
 * 普通 Uint8Array，防 Buffer 池化/子类语义外泄进核心；file.ts 的 node:fs 先例：
 * Host-facing 适配层使用 Node 内建模块）。
 */
const productionRandomBytes: RegistryRandomBytes = (length: number): Uint8Array =>
  new Uint8Array(nodeRandomBytesSource(length));

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

/** 插件配置（AC2）：`{ idleTimeoutMs?, role? }`——`role` 为 phase-5 切片 9 义务提前
 * 履行（R2-8：缺省 'hub'；非法值 loud 拒绝）。 */
export interface NamespaceRegistryPluginConfig {
  readonly idleTimeoutMs?: number;
  /** 实例静态角色（ADR 0010 静态星型拓扑；缺省 'hub'——基线全权限等价面，零回归）。 */
  readonly role?: InstanceRole;
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
 * 先例；不声明 cordis Config schema，零新依赖）。仅接受 `{ idleTimeoutMs?, role? }`
 * 键集（R2-8：恒 'idleTimeoutMs'/'role' 子集）；多余键 TypeError（拒绝静默忽略拼错
 * 键——默认 5 分钟将掩盖错误）。校验序冻结（§9.1）：① 对象形状（非 object/null/
 * array → PLUGIN_CONFIG TypeError）→ ② 键集 ⊆ {idleTimeoutMs, role} → ③ role 值域
 * （非 `undefined|'hub'|'peer'` → TypeError NAMESPACE_REGISTRY_ROLE_INVALID——
 * 复用 types.ts 既有 const，O-4 既有词汇域，非键集误报）→ ④ idleTimeoutMs 经
 * resolveIdleTimeoutMs 单点（既有 TYPE/RANGE 二分不变）。
 */
function resolvePluginIdleTimeoutMs(config: NamespaceRegistryPluginConfig): number {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new TypeError(NAMESPACE_REGISTRY_PLUGIN_CONFIG_MESSAGE);
  }
  const keys = Object.keys(config);
  if (keys.some((k) => k !== 'idleTimeoutMs' && k !== 'role')) {
    throw new TypeError(NAMESPACE_REGISTRY_PLUGIN_CONFIG_MESSAGE);
  }
  const role = config.role; // 单读捕获（校验序 ③——此后 apply 闭包零再校验；plain config 面）
  if (role !== undefined && role !== 'hub' && role !== 'peer') {
    throw new TypeError(NAMESPACE_REGISTRY_ROLE_INVALID_MESSAGE);
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
  // role 单读捕获（R2-8：校验序已在 resolvePluginIdleTimeoutMs 完成——undefined|'hub'|'peer'；
  // 闭包绑定——apply 期零再校验、零再读 config）
  const role = config.role ?? 'hub';
  let instance: NamespaceRegistry | undefined;
  return {
    inject: ['clock', 'timer', 'nomicorePersistence'], // 依赖图边：AC11 时序保证的机制载体（§5#5/#8）；rev1：adapter 级次序另经 persistence 侧有序 disposer 兑现（设计 rev1 §2.C）
    apply(ctx: Context): void {
      assertNamespaceRegistryHostDependencies(ctx); // 形状级 loud fail（见上）
      const registry = createNamespaceRegistry(requireNomicorePersistence(ctx), {
        clock: requireClock(ctx),
        scheduler: createCordisRegistryScheduler(ctx),
        randomBytes: productionRandomBytes,
        idleTimeoutMs,
        role, // R2-8 贯通：plugin config → 生产工厂 → registry 静态角色（切片 9 义务提前履行）
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
