# 第三方 Cordis 宿主接入指南

本文是第三方宿主挂载 Nomicore 插件的操作入口。架构与生命周期依据分别见 [ADR-0006](../adr/0006-server-persistence-docstore.md)、[ADR-0008](../adr/0008-namespace-runtime-read-write-capabilities-and-sequencer.md) 和 [ADR-0009](../adr/0009-namespace-registry-leases-and-host-lifecycle.md)。

## 可挂载插件与依赖图

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

## 最小生产装配

下面示例使用文件持久化。`ctx.plugin()` 返回 Fiber，必须等待其启动完成后再消费对应服务。

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

`createMemoryPersistencePlugin(options)` 接受：

| 配置 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `schedule.debounceMs` | 非负有限 `number` | `500` | dirty 后的 debounce flush 延迟。 |
| `schedule.maxDirtyMs` | 非负有限 `number` | `5000` | dirty 状态允许持续的最大时间。 |
| `writeSnapshot` | 函数 | 无 | 可选的内存 adapter 写入 seam；主要用于组合或故障注入。 |
| `readSnapshot` | 函数 | 无 | 可选的内存 adapter 读取 authority。 |

插件路径自动从 Cordis Timer 注入 scheduler；第三方宿主不配置 `scheduler` 或 `wrapIo`。

### File Persistence

`createFilePersistencePlugin(options)` 接受：

| 配置 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `rootDir` | 非空 `string` | 必填 | 快照根目录；同一时刻由一个 active adapter 实例拥有。 |
| `schedule.debounceMs` | 非负有限 `number` | `500` | dirty 后的 debounce flush 延迟。 |
| `schedule.maxDirtyMs` | 非负有限 `number` | `5000` | dirty 状态允许持续的最大时间。 |

文件布局为 `rootDir/users/<userId>/<namespaceId>.snapshot`。File adapter 要求 `owner.userId` 和 `namespaceId` 匹配：

```text
^[a-z][a-z0-9-]{0,62}$
```

HMR 或重载时，先等待旧 adapter/Fiber 完成释放，再用同一个 `rootDir` 创建新实例。

### Namespace Registry

`createNamespaceRegistryPlugin(options)` 只接受：

| 配置 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `idleTimeoutMs` | `0..2147483647` 的有限整数 | `300000` | 最后一个 lease 释放后，空闲 Runtime 的保留时间。`0` 表示进入 idle 后立即安排回收。 |

多余配置键会抛出 `TypeError`，避免拼写错误被默认值掩盖。

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

正常停止遵循依赖的逆序：

1. 停止接纳业务请求，并等待业务持有的 lease 释放。
2. `await registry.shutdown()`，或释放 Registry Fiber 并等待其完成。
3. 释放 Persistence Fiber；它会先撤销服务、等待 Registry 等依赖方退出，再 dispose adapter。
4. 最后释放承载 Clock/Timer 的 Context/Fiber。

直接控制 Fiber 时可采用：

```ts
await registryFiber.dispose()
await persistenceFiber.dispose()
await ctx.fiber.dispose()
```

不要在 Registry 尚未排空时先拆 Timer 或 Persistence。Registry 关闭期间已接纳的写会被排空；先拆依赖会使新 timer 武装或 handle 操作响亮失败。

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
