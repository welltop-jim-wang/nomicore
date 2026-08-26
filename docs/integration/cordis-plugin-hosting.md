# 第三方 Cordis 宿主接入指南

本文是第三方宿主挂载 Nomicore 插件的操作入口。架构与生命周期依据分别见 [ADR-0006](../adr/0006-server-persistence-docstore.md)、[ADR-0008](../adr/0008-namespace-runtime-read-write-capabilities-and-sequencer.md) 和 [ADR-0009](../adr/0009-namespace-registry-leases-and-host-lifecycle.md)。

## 范围与依赖图

本文覆盖第三方生产宿主需要挂载的四类插件：Clock、Cordis Timer、Memory/File Persistence 和 Namespace Registry。`@nomicore/dsh-persistence` 的 `createDshPersistenceProfile()` 是 DSH 开发/探针装配，不是第三方生产插件；其配置以该包公开类型为准。

生产宿主按以下顺序挂载：

1. `createSystemClockPlugin()`：提供 `ctx.clock`。
2. `TimerService`：提供 `ctx.timer` 与 `ctx.timeout()`。
3. 一个 Persistence 插件：提供 `ctx.nomicorePersistence`。
4. `createNamespaceRegistryPlugin()`：提供 `ctx.nomicoreRegistry`。

依赖关系为：

```text
clock ───────┐
             ├─> memory/file persistence ──> namespace registry
Cordis timer ┘                         └────> namespace registry
```

Persistence 和 Registry 启动时会检查依赖；缺少 clock、timer 或 persistence 会直接抛错，不会使用系统能力兜底。第三方业务通常只消费 `nomicoreRegistry`，不要直接持有 live `Y.Doc` 或 Persistence `DocHandle`。

## 推荐加载方式

第三方宿主统一使用 **Cordis 插件工厂组合加载**：在同一个 `Context` 中调用 Nomicore 公开的 `create*Plugin()` 工厂，并通过 `ctx.plugin()` 交给 Cordis 管理依赖和生命周期。当前公开集成契约不提供稳定的 Nomicore 动态 `pluginId`，也不要求宿主编写 `cordis_define` Host 代码；除非宿主平台自行把下列工厂封装成它自己的动态插件，否则不要依赖包路径扫描、内部模块或 DSH 专用 profile 作为生产加载协议。

这种方式与项目的插件验收测试一致，并确保：

- Clock、Timer、Persistence、Registry 按依赖顺序启动；
- Persistence 与 Registry 服务通过公开 `require*` helper 获取；
- Fiber 卸载时按 Cordis 依赖图排空 Registry、释放 Persistence；
- 配置由各 `create*Plugin()` 工厂的公开 options 类型校验。

## 最小生产装配

下面示例使用文件持久化。`ctx.plugin()` 返回 Fiber 生命周期句柄；`await fiber` 等待插件进入 active 或启动失败，随后才能消费该插件提供的服务。

```ts
import { Context } from '@deepseek-ai/cordis'
import TimerService from '@deepseek-ai/cordis-plugin-timer'
import { createSystemClockPlugin } from '@nomicore/clock'
import { createFilePersistencePlugin } from '@nomicore/persistence'
import {
  createNamespaceRegistryPlugin,
  requireNomicoreRegistry,
} from '@nomicore/namespace-registry'

const ctx = new Context()

const clockFiber = ctx.plugin(createSystemClockPlugin())
await clockFiber

// TimerService 构造时同步向 Context 提供 timer service。
new TimerService(ctx)

const persistenceFiber = ctx.plugin(createFilePersistencePlugin({
  rootDir: '/var/lib/my-service/nomicore',
  schedule: {
    debounceMs: 500,
    maxDirtyMs: 5_000,
  },
}))
await persistenceFiber

const registryFiber = ctx.plugin(createNamespaceRegistryPlugin({
  idleTimeoutMs: 300_000,
}))
await registryFiber

const registry = requireNomicoreRegistry(ctx)
```

Memory adapter 只需替换 Persistence 工厂：

```ts
import { createMemoryPersistencePlugin } from '@nomicore/persistence'

const persistenceFiber = ctx.plugin(createMemoryPersistencePlugin({
  schedule: { debounceMs: 500, maxDirtyMs: 5_000 },
}))
await persistenceFiber
```

Memory adapter 的快照仅属于当前 adapter 实例；实例销毁后不可用于重启恢复。需要跨进程或跨实例恢复时使用 File adapter 或实现 `DocPersistence` 的第三方 adapter。

## 配置

### Clock

生产插件 `createSystemClockPlugin()` 没有配置项，使用 `Date.now()` 提供 wall clock；它不承诺单调递增。延迟调度由 Cordis Timer 提供，而不是 Clock。

测试中使用 `@nomicore/clock/testing` 的 `createManualClockPlugin()`；测试 provider 不应进入生产装配。

### Cordis Timer

Nomicore 不复制 Timer 配置。安装 `@deepseek-ai/cordis-plugin-timer` 的 `TimerService` 后，Persistence 和 Registry 会把 `ctx.timeout()` 适配为各自的调度能力。

Timer 生命周期必须覆盖 Persistence 和 Registry：先挂 Timer，最后再释放 Timer 所属 Context/Fiber。

### Memory Persistence

`createMemoryPersistencePlugin(options)` 的公开选项、默认调度值和内存快照生命周期以 [`@nomicore/persistence` README](../../packages/persistence/README.md) 与 `MemoryPersistenceOptions` 类型为准。生产插件会从 Cordis Timer 注入 scheduler；第三方宿主不传 `scheduler` 或内部 `wrapIo` seam。

### File Persistence

`createFilePersistencePlugin(options)` 的 `rootDir`、调度选项、文件布局和 identity 约束以 [`@nomicore/persistence` README](../../packages/persistence/README.md)、`FilePersistenceOptions` 类型及 [ADR-0006](../adr/0006-server-persistence-docstore.md) 为准。HMR 或重载时，先等待旧 adapter/Fiber 完成释放，再以原存储配置创建新实例。

### Namespace Registry

`createNamespaceRegistryPlugin(options)` 的唯一配置域是空闲 Runtime 保留时间；精确类型、默认值和拒绝规则以 [`@nomicore/namespace-registry` README](../../packages/namespace-registry/README.md) 与 `NamespaceRegistryPluginConfig` 类型为准。

## 创建、读取、修改和重新打开

```ts
const created = await registry.create({
  owner: { userId: 'acme-user' },
  namespaceId: 'notes',
  schema: {
    lang: 'vfsl',
    version: 1,
    id: 'notes-v1',
    text: 'type ROOT = { title: string; count: number; };\n',
  },
  root: { title: 'first', count: 0 },
})

if (!created.ok) {
  throw new Error(`${created.code}: ${created.message}`)
}

const lease = created.lease

console.log(lease.read(['title']))
// { ok: true, value: 'first' }

const changed = await lease.mutateRoot({
  op: 'set',
  path: ['count'],
  value: 1,
})
if (!changed.ok) {
  throw new Error(`${changed.code}: ${changed.message}`)
}

await lease.release()

const reopened = await registry.open({ userId: 'acme-user' }, 'notes')
if (!reopened.ok) {
  throw new Error(`${reopened.code}: ${reopened.message}`)
}
console.log(reopened.lease.read(['count']))
await reopened.lease.release()
```

`create()` 是排他创建，已存在时返回 `NAMESPACE_ALREADY_EXISTS`；读取已有 namespace 使用 `open()`。每次成功调用返回独立 `NamespaceLease`。业务完成后必须 `release()`；支持显式资源管理的运行时也可使用 `await using`。

写入由 schema 校验，失败返回结构化结果并保持零写入。调用方按 `result.ok` 与稳定的 `code` 分支，不要匹配 message 文本。

## 停止与重载

正常停止使用一种所有权策略，不并发触发多条拆卸链：

1. 停止接纳业务请求，并等待业务持有的 lease 释放。
2. 若宿主显式拥有 Registry 生命周期，调用并等待 `registry.shutdown()`。
3. 释放 Persistence Fiber。它撤销 persistence service 后会等待依赖它的 Registry Fiber 完成卸载，再 dispose adapter。
4. 最后释放承载 Clock/Timer 的根 Context/Fiber。

```ts
await registry.shutdown()
await persistenceFiber.dispose()
await ctx.fiber.dispose()
```

若宿主完全由 Cordis 管理生命周期，可省略显式 `registry.shutdown()`，只释放 Persistence 或根 Context，让依赖图级联卸载 Registry。不要同时手工 dispose Registry Fiber 又依赖 Persistence 撤服务触发同一卸载链。

Timer 的生命周期必须覆盖整个排空过程。Registry 关闭期间已接纳的写会被排空；提前拆 Timer 会使新 timer 武装响亮失败。

## 服务发现与健康状态

使用公开 require helper 获取服务，缺失时会立即抛错：

```ts
import { requireClock } from '@nomicore/clock'
import { requireNomicorePersistence } from '@nomicore/persistence'
import { requireNomicoreRegistry } from '@nomicore/namespace-registry'

const clock = requireClock(ctx)
const persistence = requireNomicorePersistence(ctx)
const registry = requireNomicoreRegistry(ctx)
```

Registry 的 `getStatus()` 返回 `running`、`shutting-down` 或 `stopped`。Lease 的 `getStatus()` 展示 lease 与 runtime 能力状态。File/Memory adapter 实例的 `getStatus()` 可用于宿主健康检查；业务数据访问仍应通过 Registry lease。

## 第三方自定义 Persistence

第三方存储只需实现 `DocPersistence` 并通过 `provideNomicorePersistence(ctx, adapter)` 发布，但必须完整遵守 [ADR-0006](../adr/0006-server-persistence-docstore.md) 的所有权、提交点、dirty 调度、降级、release 和 dispose 契约。自定义 adapter 是存储语义实现，不是简单的序列化回调；在通过 Memory/File 两套契约同等的生命周期和并发测试前，不应作为生产替代品。
