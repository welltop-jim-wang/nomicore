# 第三方 Cordis 宿主接入指南

本文是第三方宿主挂载 Nomicore 插件的操作入口。架构与生命周期依据分别见 [ADR-0006](../adr/0006-server-persistence-docstore.md)、[ADR-0008](../adr/0008-namespace-runtime-read-write-capabilities-and-sequencer.md)、[ADR-0009](../adr/0009-namespace-registry-leases-and-host-lifecycle.md)、[ADR-0010](../adr/0010-hub-peer-websocket-ydoc-replication.md) 和 [ADR-0012](../adr/0012-instance-identity-and-websocket-plugin-ownership.md)。

## 范围与依赖图

本文覆盖第三方生产宿主需要挂载的 Instance、Clock、Cordis Timer、Memory/File Persistence、Namespace Registry，以及可选的角色专用 WebSocket replication plugin。`@nomicore/dsh-persistence` 的 `createDshPersistenceProfile()` 是 DSH 开发/探针装配，不是第三方生产插件；其配置以该包公开类型为准。

生产宿主必须区分三个连续阶段，按依赖顺序完成：

**阶段 A：基础设施 plugins**

1. `createInstancePlugin()`：提供不可变的 `ctx.nomicoreInstance`，配置一次 `instanceId + role`。
2. `createSystemClockPlugin()`：提供 `ctx.clock`。
3. `TimerService`：提供 `ctx.timer` 与 `ctx.timeout()`。
4. 一个 Persistence 插件：提供 `ctx.nomicorePersistence`。
5. `createNamespaceRegistryPlugin()`：提供 `ctx.nomicoreRegistry`，角色来自 Instance service。
6. 与 Instance role 相符的 `createHubReplicationPlugin()` 或 `createPeerReplicationPlugin()`；等待其 Fiber ready。

**阶段 B：namespace 复制资格**

7. 通过 Registry `create()` 或 `open()` 取得目标 `NamespaceLease`。Hub 对需要被复制的 namespace 调用并等待 `lease.enableReplication()` 成功；Peer 不调用该 Hub-only 操作，而是把 namespace 作为 replication target 配置或交给 `addTarget()`。授权表和 target 使用同一个持久化的 `lease.namespaceId`。

**阶段 C：宿主业务**

8. 只有在阶段 A、B 成功后，才启动依赖该 namespace 的 scanner、worker、HTTP handler 或其他业务消费者。业务消费者在其整个运行期持有 lease，停止时先停止接纳并排空业务，再 `release()`。

因此，一个 Hub Center 的典型启动链是：

```text
Instance(role=hub, instanceId=<stable-id>)
→ Clock
→ Timer
→ File Persistence
→ Namespace Registry
→ Hub replication plugin ready
→ create/open Center namespace lease
→ enableReplication() succeeds
→ start Center scanner
```

该顺序不是说 Hub listener 必须等某个 namespace 才能监听：replication plugin 可先 ready；但在 `enableReplication()` 成功且授权绑定指向正确 `namespaceId` 之前，该 namespace 尚未具备可用的 Hub 复制入口，依赖它的 scanner 也不应启动。

依赖关系为：

```text
instance ───────────────────────────┬─> namespace registry ─┐
clock ───────┐                      │                       ├─> hub/peer replication
             ├─> memory/file persistence ─> namespace registry ┘
Cordis timer ┘───────────────────────────────────────────────┘
```

Persistence、Registry 和 replication plugin 启动时会检查依赖；缺少所需 service 会直接抛错，不会使用系统能力兜底。角色不匹配会在 listener/dial side effect 前失败。第三方业务通常只消费 `nomicoreRegistry` 和角色专用 replication service，不要直接持有 live `Y.Doc`、Persistence `DocHandle` 或 raw `ReplicationSession`。

## 推荐加载方式

第三方宿主统一使用 **Cordis 插件工厂组合加载**：在同一个 `Context` 中调用 Nomicore 公开的 `create*Plugin()` 工厂，并通过 `ctx.plugin()` 交给 Cordis 管理依赖和生命周期。当前公开集成契约不提供稳定的 Nomicore 动态 `pluginId`，也不要求宿主编写 `cordis_define` Host 代码；除非宿主平台自行把下列工厂封装成它自己的动态插件，否则不要依赖包路径扫描、内部模块或 DSH 专用 profile 作为生产加载协议。

这种方式与项目的插件验收测试一致，并确保：

- 基础设施按 Instance → Clock → Timer → Persistence → Registry → role-specific replication plugin 的依赖顺序启动；
- namespace lease 的 create/open 与 Hub `enableReplication()` 在依赖该 namespace 的业务消费者启动前完成；
- 服务通过公开 `require*` helper 获取；
- 停机时先停止并排空业务消费者、释放 lease，再排空 replication，最后关闭 Registry、释放 Persistence；
- 配置由各 `create*Plugin()` 工厂的公开 options 类型校验。

## 最小生产装配

下面示例使用文件持久化。`ctx.plugin()` 返回 Fiber 生命周期句柄。当前 Cordis Fiber wrapper 是 thenable，`await fiber` 会委托到 `fiber.await()`；本文统一显式调用 `await fiber.await()`，以清楚表达“等待当前生命周期迁移完成并重抛配置/启动错误”，随后才能消费该插件提供的服务。

```ts
import { Context } from '@deepseek-ai/cordis'
import TimerService from '@deepseek-ai/cordis-plugin-timer'
import { createSystemClockPlugin } from '@nomicore/clock'
import { createInstancePlugin } from '@nomicore/instance'
import { createFilePersistencePlugin } from '@nomicore/persistence'
import {
  createNamespaceRegistryPlugin,
  requireNomicoreRegistry,
} from '@nomicore/namespace-registry'

const ctx = new Context()

const instanceConfig = {
  instanceId: 'hub-primary',
  role: 'hub' as const,
}
const instanceFiber = ctx.plugin(
  createInstancePlugin(instanceConfig),
  instanceConfig,
)
await instanceFiber.await()

const clockFiber = ctx.plugin(createSystemClockPlugin())
await clockFiber.await()

// 独立 composition root 只构造一次；嵌入已有 Host 时复用 Host 的 timer，跳过此行。
new TimerService(ctx)

const persistenceFiber = ctx.plugin(createFilePersistencePlugin({
  rootDir: '/var/lib/my-service/nomicore',
  schedule: {
    debounceMs: 500,
    maxDirtyMs: 5_000,
  },
}))
await persistenceFiber.await()

const registryFiber = ctx.plugin(createNamespaceRegistryPlugin({
  idleTimeoutMs: 300_000,
}))
await registryFiber.await()

const registry = requireNomicoreRegistry(ctx)
```

Instance plugin 的 `apply(ctx, hostConfig)` 必须收到宿主配置；factory overrides 只覆盖已定义字段，不能替代 Fiber config。因此生产推荐使用上面的 Fiber-managed 形式，并将同一个 `instanceConfig` 同时传给 `createInstancePlugin(instanceConfig)` 与 `ctx.plugin(plugin, instanceConfig)`。直接调用 `createInstancePlugin().apply(ctx, config)` 适合由上层 plugin 自己管理 effect 的内部组合，但不返回可独立 dispose/await 的子 Fiber。两种形式都不得在 Registry 或 replication 配置中重复 `instanceId`/`role`。Memory adapter 只需替换 Persistence 工厂：

```ts
import { createMemoryPersistencePlugin } from '@nomicore/persistence'

const persistenceFiber = ctx.plugin(createMemoryPersistencePlugin({
  schedule: { debounceMs: 500, maxDirtyMs: 5_000 },
}))
await persistenceFiber.await()
```

Memory adapter 的快照仅属于当前 adapter 实例；实例销毁后不可用于重启恢复。需要跨进程或跨实例恢复时使用 File adapter 或实现 `DocPersistence` 的第三方 adapter。

## 配置

### Instance

`createInstancePlugin(overrides?)` 在 apply 时读取宿主配置 `{ instanceId, role }`，以已定义的 override 字段覆盖后严格校验并发布不可变 service。`instanceId` 必须匹配 `^[a-z][a-z0-9-]{0,62}$`，`role` 必须为 `hub` 或 `peer`；两者均为 restart-only。精确 API 见 [`@nomicore/instance` README](../../packages/instance/README.md)。

### Clock

生产插件 `createSystemClockPlugin()` 没有配置项，使用 `Date.now()` 提供 wall clock；它不承诺单调递增。延迟调度由 Cordis Timer 提供，而不是 Clock。

测试中使用 `@nomicore/clock/testing` 的 `createManualClockPlugin()`；测试 provider 不应进入生产装配。

### Cordis Timer

Nomicore 不复制 Timer 配置。Persistence、Registry 和 replication plugins 消费当前 Host 已提供的 `ctx.timer`/`ctx.timeout()`。

| Host 形态 | Timer 规则 |
| --- | --- |
| 独立 Nomicore composition root | 构造一次 `new TimerService(ctx)` |
| 嵌入已有 Cordis/DSH Host | 复用 Host 的 Timer；不得再次构造 `TimerService` |

同一 service scope 注册第二个 Timer 会产生 provider collision。Timer 生命周期必须覆盖 Persistence、Registry、replication 及其 shutdown drain：先提供，最后再释放 Timer 所属 Context/Fiber。

### Memory Persistence

`createMemoryPersistencePlugin(options)` 的公开选项、默认调度值和内存快照生命周期以 [`@nomicore/persistence` README](../../packages/persistence/README.md) 与 `MemoryPersistenceOptions` 类型为准。生产插件会从 Cordis Timer 注入 scheduler；第三方宿主不传 `scheduler` 或内部 `wrapIo` seam。

### File Persistence

`createFilePersistencePlugin(options)` 的 `rootDir`、调度选项、文件布局和 identity 约束以 [`@nomicore/persistence` README](../../packages/persistence/README.md)、`FilePersistenceOptions` 类型及 [ADR-0006](../adr/0006-server-persistence-docstore.md) 为准。HMR 或重载时，先等待旧 adapter/Fiber 完成释放，再以原存储配置创建新实例。

恢复一个既有 namespace 需要三项同时一致：同一个持久 `rootDir`、同一个 owner 分区、同一个 `namespaceId`。全新的空 root 即使 owner/id 正确也会返回 `NAMESPACE_NOT_FOUND`。首次部署应 `create()`、持久化 `lease.namespaceId`，再让授权表和业务配置引用它；使用临时空 root 的 smoke test 应创建 disposable namespace 或复制已知 snapshot。一个 active File Persistence adapter/process 独占一个 `rootDir`，测试使用生产 root 时也必须先取得排他所有权。

### Namespace Registry

`createNamespaceRegistryPlugin(options)` 的唯一配置域是空闲 Runtime 保留时间；精确类型、默认值和拒绝规则以 [`@nomicore/namespace-registry` README](../../packages/namespace-registry/README.md) 与 `NamespaceRegistryPluginConfig` 类型为准。生产 plugin 从 `ctx.nomicoreInstance.role` 读取角色；旧 `role` 配置键属于未知键并被拒绝。

### WebSocket replication

Hub 与 Peer 的配置面、adapter overrides、service readiness 与 lifecycle 见 [`@nomicore/ws-replication` README](../../packages/ws-replication/README.md)。Hub plugin 只有在 listener 建立后才发布 ready service；Peer ready 只表示 controller/dial loop 已启动，不表示已连接 Hub 或 namespace 已 live。

Peer 宿主必须显式选择 boot policy：

| Peer 工作负载 | domain service 发布策略 |
| --- | --- |
| 长期重连 daemon，业务可延迟 | 可先发布；每个需要数据的操作自行等待 live |
| 对外数据面，所有公开操作依赖复制 namespace | 先 `await waitForLive(namespaceId)`，再发布 domain service |
| 一次性 CLI/job | 先等待 live，再执行工作或退出 |

不要把该等待藏进后台 effect。若 Loader 只有在 namespace 可用时才算启动成功，应在 plugin 的 `async apply()` 主路径等待并让失败向 Loader 抛出。

Hub 最小组合（Node.js 宿主直接使用 `@nomicore/yjs-server` 提供的公开 listener adapter；其他运行时可实现相同 `HubListenAdapter` contract）：

```ts
import {
  createHubReplicationPlugin,
  requireHubReplication,
} from '@nomicore/ws-replication'
import { createNodeHubListenAdapter } from '@nomicore/yjs-server'

const hubFiber = ctx.plugin(createHubReplicationPlugin({
  listen: { host: '127.0.0.1', port: 8787, path: '/replication' },
  tokens: [{ token: process.env.PEER_TOKEN!, instanceId: 'peer-west-1' }],
  authorization: [{
    instanceId: 'peer-west-1',
    namespaceId: 'ns-0123456789abcdef0123456789abcdef',
    localOwner: { userId: 'hub-owner' },
    read: true,
    submit: true,
  }],
}, {
  listen: createNodeHubListenAdapter(),
}))
await hubFiber.await()
const hubReplication = requireHubReplication(ctx)
```

Peer 最小组合：

```ts
import {
  createPeerReplicationPlugin,
  requirePeerReplication,
} from '@nomicore/ws-replication'
import { createNodePeerDial } from '@nomicore/yjs-server'

const peerFiber = ctx.plugin(createPeerReplicationPlugin({
  expectedHubInstanceId: 'hub-primary',
  hubUrl: 'wss://hub.example.test/replication',
  token: process.env.HUB_TOKEN!,
  targets: [{
    namespaceId: 'ns-0123456789abcdef0123456789abcdef',
    localOwner: { userId: 'peer-owner' },
  }],
}, {
  dial: createNodePeerDial(
    'wss://hub.example.test/replication',
    process.env.HUB_TOKEN!,
  ),
}))
await peerFiber.await()
const peerReplication = requirePeerReplication(ctx)
await peerReplication.waitForLive('ns-0123456789abcdef0123456789abcdef')
```

## 为什么不提供一键 infrastructure runtime helper

Nomicore 不提供 `startNomicoreHubRuntime()` / `startNomicorePeerRuntime()` 这类创建整条基础设施链的 helper。它会重新隐藏 Instance、Timer、Persistence 与 Registry 的宿主所有权，并需要决定“复用还是创建 Timer”“Memory 还是 File”“谁 dispose 上游资源”等宿主策略，等价于 ADR 0012 已否决的自包含 yjs-server plugin。

稳定的深模块 seam 是各公开 plugin factory + Cordis Fiber 依赖图：宿主显式选择 provider 所有权，Cordis 负责 activation/disposal 排序。重复但容易出错的 Node transport 细节由 `createNodeHubListenAdapter()` 封装；domain-specific namespace open、schema 门禁和 readiness 仍由 owning Host 的 `async apply()` 编排。这样删除任何一个宿主装配层时，复杂度不会被隐藏进一个拥有错误资源的 helper。

## Readiness-critical domain plugin

Transport、namespace 与 domain readiness 是三个不同状态：

| 状态 | 含义 | 可供业务消费者使用 |
| --- | --- | --- |
| Transport listener ready | HTTP/WebSocket listener 与认证/授权 wiring 已启动 | 否 |
| Namespace replication enabled/live | Hub 已 open 并 `enableReplication()` 成功，或 Peer target 已 live | 仅该 namespace 的受控消费者 |
| Domain service ready | schema/namespace 门禁及 scanner/worker 启动完成 | 是 |

Node listener 的 `/healthz` 只报告 transport liveness，不是 domain readiness。宿主应另行发布 readiness 状态或事件，覆盖 namespace open、schema 准备、Hub enablement/Peer live policy 与业务启动。

Node Hub 可向 `createNodeHubListenAdapter(observer)` 传入脱敏 adapter observer。事件依次覆盖 `upgrade-authenticated`、`transport-accepted` 与 `transport-closed(code)`，不含 token、owner、instanceId、headers 或 frame bytes。把它与 `ReplicationObserver` 组合诊断：无 upgrade 事件属于 HTTP/认证层；有 `transport-accepted` 但无 Hub `handshaking/ready` 属于 trusted handoff/controller 层；Hub handshaking 配合 Peer `hello-timeout` 通常表示 Peer 未发送 HELLO；Hub ready 但 target 不 live 则继续检查 OPEN、授权、bootstrap/reconcile。Node Peer 必须使用 `createNodePeerDial()`，因为通用 `createWebSocketAdapter()` 不为 CONNECTING socket 缓存立即发送的 HELLO。

需要 Loader activation 与业务 readiness 同步时，插件必须在 `async apply()` 主路径完成启动；`ctx.effect()` 用于登记 cleanup，而不是隐藏 startup failure：

```ts
export async function apply(ctx: Context, config: Config): Promise<void> {
  // mountNomicoreInfrastructure 是宿主自有函数：按本文顺序挂载公开 factories，
  // 并返回宿主明确拥有的 Fibers；它不是 @nomicore/* 公共导出。
  const runtime = await mountNomicoreInfrastructure(ctx, config)
  try {
    const opened = await runtime.registry.open(config.owner, config.namespaceId)
    if (!opened.ok) throw new Error(opened.code)
    const lease = opened.lease

    const enabled = await lease.enableReplication()
    if (!enabled.ok) {
      await lease.release()
      throw new Error(enabled.code)
    }

    const domain = await startScannerAndCreateService(lease)
    const revoke = ctx.provide('domainService', domain.service)
    ctx.effect(async () => async () => {
      revoke()
      await domain.stop()
      await lease.release()
      await runtime.dispose()
    }, 'domain.shutdown()')
  } catch (error) {
    await runtime.dispose()
    throw error
  }
}
```

`apply()` resolve 后才表示 domain ready；namespace open、schema、enablement 或必要的 Peer live wait 失败都会使 Fiber/Loader activation loud fail。

## 创建、启用复制并启动业务消费者

Hub 宿主在首次创建或重启打开 namespace 后，应保留 lease，显式启用复制，再启动依赖该 namespace 的业务消费者：

```ts
const opened = await registry.open({ userId: centerOwnerUserId }, centerNamespaceId)
if (!opened.ok) throw new Error(`${opened.code}: ${opened.message}`)

const centerLease = opened.lease
const enabled = await centerLease.enableReplication()
if (!enabled.ok) {
  await centerLease.release()
  throw new Error(`${enabled.code}: ${enabled.message}`)
}

// scanner 通过 centerLease 读写；其生命周期不得超过 lease。
const scanner = startCenterScanner({ lease: centerLease })
```

首次部署可将上面的 `open()` 换成 `create()`，并把返回的 `lease.namespaceId` 持久化为 Center 配置和 Hub 授权表引用。`enableReplication()` 是 Hub-only、幂等的受控操作；Peer 通过 target 配置接入，不调用它。若 scanner 启动失败，应先清理 scanner 的部分资源，再释放 lease；无需为了本地业务失败关闭整个 replication plugin。

## 创建、读取、修改和重新打开

```ts
// create 恒三键：namespaceId 由 Registry 注入的受控 128-bit CSPRNG 生成
// （`ns-` + 32 位小写 hex），调用方不得提供；生成 ID 经 lease.namespaceId 获知。
const created = await registry.create({
  owner: { userId: 'acme-user' },
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
const notesId = lease.namespaceId // 重新打开与后续引用的凭据

console.log(lease.readData(['title']))
// { ok: true, value: 'first' }

const changed = await lease.mutateData({
  op: 'set',
  path: ['count'],
  value: 1,
})
if (!changed.ok) {
  throw new Error(`${changed.code}: ${changed.message}`)
}

await lease.release()

// 重开凭据 = 生成 ID（lease.namespaceId）或调用方持久化记录；同 ID 复用时
// Registry 先核对 owner，mismatch 返回 NAMESPACE_NOT_FOUND（零泄露）。
const reopened = await registry.open({ userId: 'acme-user' }, notesId)
if (!reopened.ok) {
  throw new Error(`${reopened.code}: ${reopened.message}`)
}
console.log(reopened.lease.readData(['count']))
await reopened.lease.release()
```

`create()` 是排他创建：与 active/idle/closing Registry entry 或 target-owner 持久化重复碰撞时由 Registry **内部重生成换 ID 重试**（至多 8 次），重试预算耗尽则 reject `NamespaceRegistryFatalError`（`committed:false`、`phase: 'namespace-id-generation'`）——普通 create 不再返回 `NAMESPACE_ALREADY_EXISTS`（该码保留在公共类型联合中供后续受信任导入切片使用）；读取已有 namespace 使用 `open()`。每次成功调用返回独立 `NamespaceLease`。业务完成后必须 `release()`；支持显式资源管理的运行时也可使用 `await using`。

写入由 schema 校验，失败返回结构化结果并保持零写入。调用方按 `result.ok` 与稳定的 `code` 分支，不要匹配 message 文本。

## 停止与重载

正常停止严格反转启动所有权，并只使用一条拆卸链：

1. 停止 scanner、worker、HTTP handler 等业务消费者接纳新工作，并等待已接纳工作排空。
2. 释放业务持有的全部 namespace lease；不得让 scanner 在 lease release 后继续读写。
3. dispose 角色专用 replication Fiber；它停止 listener/dial、drain/close controller 与 channel，并撤销自身 service，但不会 shutdown Registry。
4. 若宿主显式拥有 Registry 生命周期，调用并等待 `registry.shutdown()`。
5. 释放 Persistence Fiber。它撤销 persistence service 后会等待依赖它的 Registry Fiber 完成卸载，再 dispose adapter。
6. 最后释放承载 Instance、Clock/Timer 的根 Context/Fiber。

```ts
await replicationFiber.dispose()
await registry.shutdown()
await persistenceFiber.dispose()
await ctx.fiber.dispose()
```

若宿主完全由 Cordis 管理生命周期，可省略显式 `registry.shutdown()`，释放根 Context，让依赖图先卸载 replication，再级联卸载 Registry 与 Persistence。不要同时手工 dispose replication/Registry Fiber 又依赖上游撤服务触发同一卸载链。

Timer 的生命周期必须覆盖整个排空过程。Registry 关闭期间已接纳的写会被排空；提前拆 Timer 会使新 timer 武装响亮失败。

## 服务发现与健康状态

使用公开 require helper 获取服务，缺失时会立即抛错：

```ts
import { requireClock } from '@nomicore/clock'
import { requireNomicoreInstance } from '@nomicore/instance'
import { requireNomicorePersistence } from '@nomicore/persistence'
import { requireNomicoreRegistry } from '@nomicore/namespace-registry'
import { requireHubReplication } from '@nomicore/ws-replication'

const instance = requireNomicoreInstance(ctx)
const clock = requireClock(ctx)
const persistence = requireNomicorePersistence(ctx)
const registry = requireNomicoreRegistry(ctx)
const replication = requireHubReplication(ctx) // Hub composition only
```

Registry 的 `getStatus()` 返回 `running`、`shutting-down` 或 `stopped`。Lease 的 `getStatus()` 展示 lease 与 runtime 能力状态。Hub service 的 ready 表示 listener 已启动；Peer service 的 ready 不等于 Hub 已连接或 target 已 live。File/Memory adapter 实例的 `getStatus()` 可用于宿主健康检查；业务数据访问仍应通过 Registry lease。

## 第三方自定义 Persistence

第三方存储只需实现 `DocPersistence` 并通过 `provideNomicorePersistence(ctx, adapter)` 发布，但必须完整遵守 [ADR-0006](../adr/0006-server-persistence-docstore.md) 的所有权、提交点、dirty 调度、降级、release 和 dispose 契约。自定义 adapter 是存储语义实现，不是简单的序列化回调；在通过 Memory/File 两套契约同等的生命周期和并发测试前，不应作为生产替代品。
