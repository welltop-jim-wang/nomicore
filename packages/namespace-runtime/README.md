# `@nomicore/namespace-runtime`

`NamespaceRuntime` owns one persistence `DocHandle` for one namespace and exposes synchronous reads plus serialized ROOT/SCHEMA writes.

## Public API

The package entry exports the `NamespaceRuntime` interface and related result/status types. It intentionally does **not** export a production constructor, the owned `DocHandle`, the live `Y.Doc`, writable ROOT/SCHEMA/META references, the sequencer, queue state, or testing seams.

Production assembly is performed by the owning registry layer through the restricted `@nomicore/namespace-runtime/internal` subpath (`createNamespaceRuntimeForRegistry`, consumed only by `@nomicore/namespace-registry` production code). Tests inside this package may import the internal seam constructor directly from `src/runtime.ts`; it is not a business API.

### Reads

- `read(path)` projects a schema-independent logical value from the live ROOT carrier.
- `getSchema()`, `getMetadata()`, and `getActiveSchema()` return detached projections and never expose live writable Yjs references.
- Reads do not enter the write sequencer. New reads and projection getters stop being accepted once `close()` enters `closing`; `getStatus()` remains available.

### Writes

- `mutateData(mutation)` performs a validated ROOT mutation.
- `replaceSchema(input)` compiles a proposed schema and atomically replaces SCHEMA plus, when supplied, the complete ROOT generation. A supplied ROOT is validated as-is; unknown top-level or nested keys fail loudly with zero writes.
- P0, ROOT writes, SCHEMA writes, and the close barrier share one FIFO sequencer. Inputs are snapshotted at slot start, and dirty notification remains part of the slot.
- Persistence degradation rejects new writes without disabling reads. Internal fatal errors permanently disable writes while preserving reads.

### Lifecycle

`close()` is idempotent and returns the same Promise. It synchronously enters `closing`, stops new read/write acceptance, drains accepted slots, calls `handle.release()` exactly once, and then enters `closed`. A release failure rejects the Promise but does not revert the lifecycle.

`close()` also synchronously terminates every live replication session (terminal `closed`; a later `applyRemoteUpdate` is refused with `RUNTIME_WRITE_DISABLED`). Accepted apply slots still drain in FIFO order before the close barrier.

`getStatus()` reports lifecycle and capability truth without exposing queue internals. `owner` and `namespaceId` are identity projections only; they are not authorization proof.

## ReplicationSession（内部宿主）

- **宿主与能力面**：Runtime 构造期创建 fanout + replication host（模块级 WeakMap 登记，公共对象面零污染）；session 经 `@nomicore/namespace-registry` 的 `lease.openReplicationSession` 取得（本包不直接暴露）；六能力（encodeStateVector / encodeDiff / subscribeOwnedUpdates / applyRemoteUpdate / getStatus / close）+ open/apply 拒绝码闭集（ADR 0010 修订节注册表指针）。
- **trusted raw 例外（L79/L94 明示义务）**：raw replication 绕过 VFSL 业务校验——Host 搭建方只把 Lease 交给可信代码；raw apply 无 zero-write 保证（拒绝路径除外）。
- **degraded hub→peer apply**：peer `persistence-degraded` 期已冻结 hub-to-peer session 的 bypass 五条件合取（内存生效 + saveDoc 照常 + durability 区分内存/磁盘，永不声称 durable）；hub degraded 拒 peer→hub。
- **受保护字段**：hub 侧 SCHEMA+META 全键 / peer 侧 META 全键（冻结常量）；判据 = 内容投影相等（结构值规范化深比较——键序无关/数组有序/SameValue/白名单容器 toJSON 投影/契约外容器保守拒）；畸形字节 scratch 预演拒绝。
- **fanout 投递模型**：observer 内只复制 owned bytes；有界异步队列（每 session 16 项）投递；溢出 → `status.needsResync`（sticky、继续投递）；listener 慢/重入/不返回零阻塞 sequencer；`observerFailures` 自捕获计数不熔断；交付集 = 交付时刻 listener 快照（**at-least-once**——晚订阅者可收订阅前入队项、跨退订重订可重复交付；重复由 Yjs apply 幂等吸收）。
- **epoch fence**：bump 槽同步投影步主动 fence（conflicted 终态 + 摘除 + 排队项取消——旧 session 对 bump 写零投递）；apply 槽身份/epoch gate 被动 fence（同一 finalize）；终态后同 Lease 可再 open（新 epoch）。
- **生命周期边界**：Runtime `close()` 同步段终止全部现存 sessions（终态 `closed`；其后 apply → `RUNTIME_WRITE_DISABLED`）；已接纳 apply 槽无条件排空（barrier 队尾）；Lease release 同步 close session。每 Lease 至多一个活跃 session。
- **committed 诚实**：apply 异常按事务边界二分（before-transaction 零 mutation → `committed:false`；否则保守 `committed:true`）；成功接纳即置位（no-op 同样置 `replication-unvalidated`/`memoryCaughtUp`）。

## Contract sources

The normative behavior is defined by root `CONTEXT.md` and `docs/adr/0008-namespace-runtime-read-write-capabilities-and-sequencer.md`. Historical `wiki/raw/` artifacts are non-normative; superseded designs are marked at the top and link to their replacement.