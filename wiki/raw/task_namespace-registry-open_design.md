# Issue #110 冻结设计：namespace-registry 的 `open`、唯一 Runtime 与 NamespaceLease

> 范围：本设计仅实现 Host 无关 Registry 核心的 `open` 主链、每 key 唯一 Runtime、同键 lifecycle 串行、lease 与受控测试 seam。ADR-0009 为权威基准；不得把本票的临时行为伪装为 #111/#112 已完成的功能。

## §1. 目标、非目标与不变量

### 1.1 本票交付

- 新增 `@nomicore/namespace-registry`；主入口公开窄 Registry/Lease 契约与工厂，`./testing` 仅公开受控依赖替换 seam。
- 对 `(owner.userId, namespaceId)`，一个 Registry 进程内最多一个 live `NamespaceRuntime`；所有成功 `open` 取得不同的 lease，绝不取得裸 Runtime。
- 同 key 的 `open`（以及为后续 `create`/generation close 预留的 lifecycle）按**同步接纳**顺序串行；不同 key 不互相阻塞。
- `open` 只做 load + Runtime construction，构造返回即成功；不等待 P0、不编译 schema、不验证 ROOT。
- 失败精确分流：not found / identity invalid / typed load operational / not accepting 为公开窄结果；其余 load 或内部异常为 `NamespaceRegistryFatalError` rejection。
- lease 第一次 `release()` 在当前调用栈内失效；后续业务能力以其原有通道返回 `NAMESPACE_LEASE_RELEASED`，只有 status 可观察。

### 1.2 明确非目标与本票末 lease 行为

不实现 create 主链（#111）、idle retention/timeout、Cordis plugin、Clock 生产依赖、shutdown 聚合（#112）。本票最后一个 lease 成功首次 release 后的精确行为是：**entry 保留为 `active`，其 `leaseCount` 变为 0，Runtime 不 close、不 release DocHandle、不开始 timer；下一次同 key open 复用同一 Runtime 并签发新 lease。**这是切片临时语义，不叫 idle，且不暴露给公共 status。

预留：entry 有 `phase: 'active' | 'closing'`、`generation`、`leases`、`lifecycleTail`；后续 #111 使用同一 tail 加入 create；#112 以 `closing`、`closePromise` 与 Registry acceptance 状态实现 shutdown；idle 票在 `leaseCount===0` 时将 active 转为 idle、注入 scheduler/timeout 并在重开时取消。当前核心构造不接受也不消费 Clock/scheduler/Cordis 选项。另有只为同 key 串行而存在的 lifecycle carrier：它在最后排队 slot 结算、且 key 没有 entry 后立即按 §5 清理，绝不能成为失败 open 的永久 key-retention。

### 1.3 不变量

1. identity 校验先于 map 查找、slot 创建和 Persistence 调用。
2. 同 key runtime identity 在 entry 存在期唯一；不同 key 生命周期并行。
3. 每个 slot 以 `tail.catch(() => undefined).then(run)` 接入，前项任何 settle 不污染后项。
4. 所有异步清理均以 `entries.get(key) === entry && entry.generation === generation` 守卫，防 ABA。
5. Registry 不承担授权：owner 是 Persistence partition key，非当前调用人。
6. main entry 不导出 Runtime、DocHandle、Y.Doc、entry、queue、lease count、factory override 或 observer。

## §2. 包骨架、依赖与导出纪律

### 2.1 文件与 package 配置

新增 `packages/namespace-registry/`：

```jsonc
// package.json
{
  "name": "@nomicore/namespace-registry",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts", "./testing": "./src/testing.ts" },
  "scripts": { "typecheck": "tsc -p tsconfig.json" },
  "dependencies": {
    "@nomicore/persistence": "workspace:*",
    "@nomicore/namespace-runtime": "workspace:*"
  },
  "devDependencies": { "@types/node": "^20", "typescript": "^5.9.3", "vitest": "^3.2.4" }
}
// tsconfig.json
{ "extends": "../../tsconfig.base.json", "include": ["src/**/*.ts"] }
```

生产实现内部唯一允许：`@nomicore/namespace-runtime/internal` 的 `createNamespaceRuntimeForRegistry`。该 import 只出现于 `packages/namespace-registry/src/` 生产实现；测试与其他生产 package 不得 import。**B3 活链路硬验收：**核查现有 `packages/namespace-runtime/test/runtime-registry-internal-seam-rev1.test.ts` 后发现它 import 的 `test/helpers/registry-seam-audit.ts` 在当前分支不存在，故 REPO_ROOT relPath 修订尚未落地。须在本票修改该 helper 与 rev1 gate：扫描结果的 importer 均以仓库根 `REPO_ROOT` 的 POSIX 相对路径判定，真实 `packages/namespace-registry/src/registry.ts` 的 factory import 必须被收集，且 `violators=[]`；这不是 fixture-only predicate。只需在根 `package.json` 的 `typecheck` 链追加 `tsc -p packages/namespace-registry/tsconfig.json`；`pnpm-workspace.yaml` 已有 `packages/*`，无需修改。`vitest.config.ts` 的 `packages/*/test/**/*.test.ts` 已覆盖新包，无需修改。

建议内部模块：`identity.ts`、`errors.ts`、`types.ts`、`registry.ts`、`lease.ts`、`observer.ts`、`testing.ts`；不得把内部对象从 index re-export。

### 2.2 主 entry 精确导出

`src/index.ts` **仅**导出：

```ts
export { createNamespaceRegistry, NamespaceRegistryFatalError, NamespaceLeaseReleasedError } from './registry.js';
export type {
  CreateNamespaceRegistryOptions,
  NamespaceLease,
  NamespaceLeaseReleasedIssue,
  NamespaceLeaseStatus,
  NamespaceOwner,
  NamespaceRegistry,
  NamespaceRegistryFatalPhase,
  NamespaceRegistryStatus,
  OpenNamespaceIssue,
  OpenNamespaceResult,
  RegistryOperationUnavailableIssue,
} from './types.js';
```

不导出 `NamespaceRuntime`、`DocHandle`、`Y.Doc`、`User`、Runtime 的 result/import 类型、任何 entry/sequencer/observer/testing 类型。Lease 的代理方法结构性表达 Runtime 能力，但这些能力的返回类型须以 `ReturnType<NamespaceRuntime['…']>` 等在包内部计算后命名为公开 alias；`index.ts` 不转导 Runtime 名称。构建验收须生成 registry 的 `.d.ts`（或在 Vitest 中读取 declaration emit）并对主 entry 与其可达声明文本断言不包含 `NamespaceRuntime`、`DocHandle`、`Y.Doc`、`@nomicore/namespace-runtime/internal`；同时运行时 export-key 审计不能出现这些值。

## §3. 冻结公共类型与临时扩展位语义

### 3.1 基础类型、状态与公开 issue

```ts
export interface NamespaceOwner { readonly userId: string }
export type NamespaceRegistryStatus =
  | Readonly<{ state: 'running' }>
  | Readonly<{ state: 'shutting-down' }>
  | Readonly<{ state: 'stopped' }>;

export type NamespaceLeaseStatus = Readonly<{
  lease: 'active'; runtime: NamespaceRuntimeStatusProjection;
}> | Readonly<{
  lease: 'released'; runtime: null;
}>;

export interface NamespaceLeaseReleasedIssue {
  readonly ok: false;
  readonly code: 'NAMESPACE_LEASE_RELEASED';
  readonly message: 'NAMESPACE_LEASE_RELEASED: 此 NamespaceLease 已 release，不能再接纳业务操作';
}

export type OpenNamespaceIssue =
  | Readonly<{ ok: false; code: 'NAMESPACE_NOT_FOUND'; message: 'NAMESPACE_NOT_FOUND: namespace 不存在'; }>
  | Readonly<{ ok: false; code: 'NAMESPACE_INVALID_IDENTITY'; field: 'owner.userId' | 'namespaceId'; message: 'NAMESPACE_INVALID_IDENTITY: owner.userId 或 namespaceId 不符合安全文法'; }>
  | Readonly<{ ok: false; code: 'NAMESPACE_LOAD_FAILED'; message: 'NAMESPACE_LOAD_FAILED: namespace 持久化读取发生运营故障'; }>
  | Readonly<{ ok: false; code: 'REGISTRY_NOT_ACCEPTING'; message: 'REGISTRY_NOT_ACCEPTING: Registry 当前不接纳 namespace 操作'; }>;

export type OpenNamespaceResult =
  | Readonly<{ ok: true; lease: NamespaceLease }>
  | OpenNamespaceIssue;

export interface RegistryOperationUnavailableIssue {
  readonly ok: false;
  readonly code: 'NAMESPACE_OPERATION_UNAVAILABLE';
  readonly operation: 'create' | 'shutdown';
  readonly message: 'NAMESPACE_OPERATION_UNAVAILABLE: 此 Registry 切片尚未实现该操作';
}
```

`NamespaceRuntimeStatusProjection` 是对 runtime `getStatus()` 返回值的**结构性复制型公开 type alias**，不 re-export Runtime 或其命名类型；lease `getStatus()` 每次向 active Runtime 委托，released 时恒 `{lease:'released', runtime:null}`。公开 issue 的 message 是常量，不得插值 identity、schema/root/input、cause/message/stack。

### 3.2 Registry 与 Lease Interface

```ts
export interface NamespaceRegistry {
  /** 校验身份后取得或建立同 key 唯一 Runtime，并签发独立 lease；不等 P0。 */
  open(owner: NamespaceOwner, namespaceId: string): Promise<OpenNamespaceResult>;
  /** #111 扩展位；本票 resolve 非 fatal NAMESPACE_OPERATION_UNAVAILABLE(create)，不访问 input/Persistence。 */
  create(input: unknown): Promise<RegistryOperationUnavailableIssue>;
  /** 同步 Registry 生命周期投影；本票构造后恒 running（shutdown 未实现）。 */
  getStatus(): NamespaceRegistryStatus;
  /** #112 扩展位；本票 resolve 非 fatal NAMESPACE_OPERATION_UNAVAILABLE(shutdown)，不改变 acceptance。 */
  shutdown(): Promise<RegistryOperationUnavailableIssue>;
}

export interface NamespaceLease extends AsyncDisposable {
  readonly owner: Readonly<{ readonly userId: string }>;
  readonly namespaceId: string;
  read(path: readonly (string | number)[]): NamespaceLeaseReadResult;
  getSchemaEnvelope(): NamespaceLeaseSchemaEnvelope;
  getMetadata(): NamespaceLeaseMetadata;
  getActiveSchema(): NamespaceLeaseActiveSchema;
  getStatus(): NamespaceLeaseStatus;
  mutateRoot(mutation: unknown): Promise<NamespaceLeaseMutateRootResult>;
  replaceSchema(input: NamespaceLeaseReplaceSchemaInput): Promise<NamespaceLeaseReplaceSchemaResult>;
  release(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}
```

`NamespaceLeaseReadResult` = runtime read 正常联合 `| NamespaceLeaseReleasedIssue`；两写 result 为 runtime 同名结果联合 `| NamespaceLeaseReleasedIssue`（Promise resolve，不 reject）。三个 projection getter 的原 Runtime 正常返回类型保持同步返回；released 不能伪造业务值，**同步 throw** 主 entry 公开导出的 `NamespaceLeaseReleasedError`，其 `readonly code: 'NAMESPACE_LEASE_RELEASED'`、恒定 message 与 issue 一致。调用方可靠识别方式为 `err instanceof NamespaceLeaseReleasedError` 或 `err instanceof Error && (err as {code?: unknown}).code === 'NAMESPACE_LEASE_RELEASED'`；不要求靠 message 窄化。该选择是「既有同步 getter 没有结果联合」的唯一诚实拒绝通道。`getStatus` 永不拒绝（released status）。lease 不提供 `close`。

### 3.3 Fatal 错误

```ts
export type NamespaceRegistryFatalPhase =
  | 'runtime-construction'
  | 'create-document-internal'
  | 'lifecycle-slot-internal';

export class NamespaceRegistryFatalError extends Error {
  readonly code = 'NAMESPACE_REGISTRY_FATAL' as const;
  readonly operation: 'open' | 'create' | 'shutdown';
  readonly phase: NamespaceRegistryFatalPhase;
  readonly committed: boolean;
  override readonly cause: unknown;
  // stable message: "NAMESPACE_REGISTRY_FATAL: <operation> 在 <phase> 发生内部故障（committed=<bool>）"
}
```

仅跨出公开窄结果的异常以该 branded error reject；它保留 exact cause 供受控调用方/observer 诊断，但 stable message 不包含 cause 文本。`open` 未知 `loadDoc` throw 归 `operation:'open', phase:'lifecycle-slot-internal', committed:false`；factory throw 归 `runtime-construction,false`。本票不会调用 create-document，仍保留其 phase 以稳定未来类型面。

## §4. identity 校验

放在 `identity.ts`，由 open 的同步前置段调用；不共享 Persistence 内部实现以避免反向依赖。当前没有来自 ADR/Persistence 的 canonical grammar，故本票**不得**擅加 ASCII、长度上限或首字符白名单。两段 identity 的最小兼容校验都是：primitive non-empty string，且不含 Unicode C0/C1 控制字符（U+0000–U+001F、U+007F–U+009F）、`/`、`\\`，也不得等于 `.` 或 `..`；不 trim、normalise、coerce。Unicode、长字符串、空格和其它 Persistence 可接受的普通 string 保持可用。

“invalid 零访问”精确定义为：invalid 时**零 Registry entries/carriers map、Persistence、Runtime factory/Runtime**访问；不承诺零 JavaScript Proxy/getter trap 执行，因为判定对象形状在语言层不可避免可能触发 trap。所有 shape/prototype/descriptor 读取均在 try/catch；trap 或 getter 的任何异常都稳定映射 invalid，绝不 reject/fatal。

伪码（不宣称存在不可证的“安全 own-data 读取”）：

```ts
function validateOpenIdentity(owner: unknown, namespaceId: unknown):
  | { ok: true; owner: FrozenOwner; namespaceId: string; key: string }
  | { ok: false; issue: Extract<OpenNamespaceIssue, {code:'NAMESPACE_INVALID_IDENTITY'}> } {
  // 首先短路：String object 与 coercion valueOf/toString 一律不会被访问。
  // primitive string Proxy 不存在；其它 object Proxy 在此也不会被访问。
  if (typeof namespaceId !== 'string' || !isMinimalSafeString(namespaceId)) return invalid('namespaceId');
  try {
    if (typeof owner !== 'object' || owner === null || Array.isArray(owner)) return invalid('owner.userId');
    const proto = Object.getPrototypeOf(owner); // trap 可 throw，统一 catch → invalid
    if (proto !== Object.prototype && proto !== null) return invalid('owner.userId');
    const desc = Object.getOwnPropertyDescriptor(owner, 'userId'); // trap 可 throw
    if (desc === undefined || !('value' in desc) || desc.get !== undefined || desc.set !== undefined) return invalid('owner.userId');
    const userId = desc.value; // 不经 owner.userId getter；descriptor value 不可避免可能来自 Proxy trap
    if (typeof userId !== 'string' || !isMinimalSafeString(userId)) return invalid('owner.userId');
    const frozenOwner = Object.freeze({ userId });
    return { ok:true, owner:frozenOwner, namespaceId,
      key: `${userId.length}:${userId}\u0000${namespaceId.length}:${namespaceId}` };
  } catch { return invalid('owner.userId'); }
}
```

`key` 仅内部 map key，长度前缀避免简单拼接碰撞；绝不写入 public message/event text。

## §5. entry、carrier 状态机、队列与 ABA 防御

```ts
type Entry = {
  readonly key: string;
  readonly generation: bigint;              // registryNextGeneration++，永不复用
  readonly owner: FrozenOwner;
  readonly namespaceId: string;
  readonly runtime: NamespaceRuntime;
  phase: 'active' | 'closing';
  readonly leases: Set<LeaseController>;    // 私有；只为 release 与未来 idle 判断
  lifecycleTail: Promise<void>;             // entry 自身 future close/create 串行预留
  closePromise?: Promise<void>;              // #112/idle 预留
};
type LifecycleCarrier = {
  readonly key: string;
  readonly generation: bigint;              // registryNextCarrierGeneration++，永不复用
  tail: Promise<void>;                      // 恒为已 catch 的绿尾
};
```

`entries: Map<string, Entry>` 只保存 live Runtime；`carriers: Map<string, LifecycleCarrier>` 只保存同 key 尚有 lifecycle queue 的排队器。两 map 分离，因此 not-found/load-failed/fatal 不会制造 Entry，更必须在最后 slot 后回收 carrier。

每 key slot 在 JavaScript 同步 run-to-completion 中接纳：取得现有 carrier 或创建新 carrier（初始 `tail=Promise.resolve()`）；捕获接纳时 carrier identity 及旧绿尾，令 `operation = carrier.tail.then(runSlot)`，随后先更新 `carrier.tail = operation.then(() => undefined, () => undefined)`，并记录 `operationGreenTail = carrier.tail`。`runSlot` 的同步 throw 被 promise 化，后续 tail 仍绿；不同 key 各自 carrier，天然并行。

**carrier 精确清理规则：**对每个 operation，在其 own `operationGreenTail` settle 后排入 cleanup microtask；仅当 `(1) entries.has(key) === false`、`(2) carriers.get(key) === capturedCarrier`、且 `(3) capturedCarrier.tail === operationGreenTail` 时才 `carriers.delete(key)`。第 (2) 是 carrier identity/generation ABA guard，第 (3) 表明没有后来接纳的同 key slot；任一条件不成立不删。若清理后未来才有新 open，则创建新 carrier generation；旧 cleanup 永不删除它。若成功 open 建立 active entry，条件 (1) 失败，carrier 与 entry 共存以服务后续同 key slot；#112 最终删除 entry 时，只有当 carrier 同时处于绿尾才允许回收。此 cleanup 不暴露主入口内部状态。

受控核验：testing subpath 可接受只读 `diagnostics` callback（不返回 map），每次 carrier create/delete 发送 `{type:'carrier-created'|'carrier-deleted', keyDigest:string, generation:bigint}`；keyDigest 是固定不可逆测试 token，不是 identity 原文。生产 observer 不上报 carrier housekeeping。测试断言事件成对、generation 匹配、无 orphan，而非读取 carrier map。

`open` slot 的决策：

```ts
async function runOpenSlot(v): Promise<OpenNamespaceResult> {
  if (registry.acceptance !== 'running') return NOT_ACCEPTING;
  const current = entries.get(v.key);
  if (current?.phase === 'active') return issueLease(current);
  if (current?.phase === 'closing') { await current.closePromise!; /* then re-evaluate/load */ }
  let handle;
  try { handle = await persistence.loadDoc(v.owner, v.namespaceId); }
  catch (e) {
    if (e instanceof DocLoadOperationalError) return LOAD_FAILED;
    throw fatal('open','lifecycle-slot-internal',false,e);
  }
  if (handle === null) return NOT_FOUND;
  let runtime;
  try { runtime = createNamespaceRuntimeForRegistry(handle, () => persistence.saveDoc(handle)); }
  catch (e) { await releaseOwnedHandleBestEffort(handle, v); throw fatal('open','runtime-construction',false,e); }
  const entry = makeNewEntry(v, runtime);
  entries.set(v.key, entry);
  return issueLease(entry);
}
```

当异步创建后的任一清理（factory throw 的 handle release、未来 close、create post-commit failure）完成时，仅可做：

```ts
function removeOnlySelf(entry: Entry): void {
  if (entries.get(entry.key) === entry && entries.get(entry.key)?.generation === entry.generation) {
    entries.delete(entry.key);
  }
}
```

entry object identity 已足以防 ABA，generation 是第二层显式审计锚。旧 entry 的 completion 绝不按 key 无条件 delete；其 close completion 不得碰新 generation。

## §6. `open` 完整时序、清理与 Runtime 能力

1. 调用 `open` 时先执行 §4 的身份算法；`namespaceId` 非 primitive string 立即 invalid，owner shape/trap 异常也 resolve invalid。invalid 的“零访问”是零 Registry entries/carriers map、Persistence、Runtime access（不承诺零 Proxy/descriptor trap）。
2. 仅 valid 后同步取得该 key carrier 并接纳 lifecycle slot；slot 开始再检查 `running`，not accepting 返回窄 issue。
3. slot 中若 active entry 存在，直接签新 lease；不调用 Persistence/factory。
4. 没有 active entry：`await persistence.loadDoc(owner, namespaceId)`。
5. `null → NAMESPACE_NOT_FOUND`；`DocLoadOperationalError → NAMESPACE_LOAD_FAILED`，并向内部 observer 上报 `open-load-failed`（exact cause）；任何其他 throw → `NamespaceRegistryFatalError(open/lifecycle-slot-internal/false)` 并上报 `lifecycle-slot-failed`。
6. load 得到 handle 后，用唯一 internal factory 构造，并固定绑定 `() => persistence.saveDoc(handle)`；构造成功即 Runtime 所有权接管且返回 lease，不等待 P0。
7. factory throw：caller 仍拥有 handle；`handle.release()` 在此路径**恰调用一次**。其 resolve/reject 均不替换 factory cause；release reject 上报 `handle-release-failed`，factory cause 上报 `open-runtime-construction-failed`，observer 自身 throw 被隔离，最终仍 reject `runtime-construction,false`。
8. 成功建 entry、登记 map、签 lease。每个 slot 的 `operationGreenTail` settle 后依 §5 三条件 carrier cleanup；entry 删除采用 §5 entry identity/generation 守卫。

fatal、schema-unavailable、`persistence-degraded` Runtime 都是**已经成功构造的存在事实**；它们不被 Registry 二次判断为 open failure。租约如实代理 runtime read/status/写 gate；其中 read 能力与写可用性由 runtime status 决定。

## §7. lease 细节与逐方法 released 表

Lease 在签发时创建私有 controller `{ released:false, releasePromise:undefined, entry }`；`owner` 为**冻结独立投影**、`namespaceId` 均写入冻结对象。不能返回 entry/runtime 引用。首个 `release()` 的同步段先 `released=true`、从 entry.leases 删除自身；随后一次性创建并缓存 release promise（本票 resolve `undefined`，最后 lease 不 close）。所有后续 release 返回**同一 Promise 实例**。`[Symbol.asyncDispose]()` 直接 `return this.release()`。

release 不追踪、取消或等待先前已被 Runtime 接纳的写；Runtime sequencer 继续处理它们。由于 JS run-to-completion，release 的同步标记与任一业务方法的 active check 无可插入交错。

| Lease 方法 | active 行为 | released 行为 / 通道 |
|---|---|---|
| `read(path)` | 委托 runtime.read | 同步返回 `{ok:false,code:'NAMESPACE_LEASE_RELEASED',message:常量}` |
| `getSchemaEnvelope()` | 委托 | 同步 throw 公开 `NamespaceLeaseReleasedError`，`code` 固定 |
| `getMetadata()` | 委托 | 同步 throw 公开 `NamespaceLeaseReleasedError`，`code` 固定 |
| `getActiveSchema()` | 委托 | 同步 throw 公开 `NamespaceLeaseReleasedError`，`code` 固定 |
| `getStatus()` | 返回 `{lease:'active',runtime:runtime.getStatus()}` | 同步返回 `{lease:'released',runtime:null}` |
| `mutateRoot(m)` | 委托 Promise | `Promise.resolve(releasedIssue)` |
| `replaceSchema(i)` | 委托 Promise | `Promise.resolve(releasedIssue)` |
| `release()` | 同步置 released 后缓存 promise | exact same cached Promise |
| `[Symbol.asyncDispose]()` | 委托 release | exact same Promise |

`Object.freeze(lease)`；status 产物、owner 投影和 released issue 都冻结。读/写 result 的 `ok` 判别保持 runtime 原协议；lease released issue 没有 path/input/identity 泄露。

## §8. observer 与受控 testing subpath

### 8.1 内部 observer

```ts
type RegistryObserverEvent =
 | { type:'open-load-failed'; identity: InternalIdentity; cause: DocLoadOperationalError }
 | { type:'open-runtime-construction-failed'; identity: InternalIdentity; cause: unknown }
 | { type:'handle-release-failed'; identity: InternalIdentity; cause: unknown }
 | { type:'lease-released'; identity: InternalIdentity; generation:bigint; remainingLeases:number }
 | { type:'lifecycle-slot-failed'; identity: InternalIdentity; operation:'open'; cause: unknown };
type RegistryObserver = (event: RegistryObserverEvent) => void;
```

`DocLoadOperationalError` 每次被映射成公开 `NAMESPACE_LOAD_FAILED` 时**必定**发出 `open-load-failed`，携带该 exact error/cause；not-found 不发 observer 失败事件。未知 load/factory/handle-release 则按事件名保留 exact cause。observer 仅由构造 options/testing seam 注入、同步调用必须被 try/catch 隔离；observer 自身 throw 不得改变 Registry public result、主 fatal、handle release 调用次数或 queue tail，并可静默丢弃（诊断 sink 失败不是业务失败）。event 可有 exact cause 与受控 identity，仅供日志/metrics/trace adapter；v1 无 public subscription。所有 public error/issue 文本零回显。负锁测试将用含 owner、namespace、schema/root 字样与 cause message/stack 的 sentinel 断言 JSON/message 不包含它们，同时 observer 收到同一 cause identity。

### 8.2 `@nomicore/namespace-registry/testing`

`testing.ts` 只导出：

```ts
export interface NamespaceRegistryTestingOverrides {
  readonly runtimeFactory?: (handle: DocHandle, notifyDirty: () => Promise<void>) => NamespaceRuntime;
  readonly observer?: RegistryObserver;
  /** 仅测试诊断事件，不返回或读取 carrier/entry map。keyDigest 非 raw identity。 */
  readonly diagnostics?: (event: { type: 'carrier-created' | 'carrier-deleted'; keyDigest: string; generation: bigint }) => void;
  /** 为 #111 预留，#110 不消费。 */
  readonly createDocumentFactory?: never;
  /** 为 idle/#112 预留，#110 不消费。 */
  readonly scheduler?: never;
}
export function createNamespaceRegistryForTesting(
  persistence: DocPersistence,
  overrides?: NamespaceRegistryTestingOverrides,
): NamespaceRegistry;
```

生产工厂不接受 override。testing subpath 仍不导出 entry map、queue carrier、lease count、timer handle、Runtime/DocHandle/Y.Doc 实例；上述类型应在 declaration 中为内部 import 而非主入口 re-export。测试以公开 Registry/Lease 行为和 injected observer/factory 侧效应验证。

## §9. 测试矩阵

测试目录：`packages/namespace-registry/test/`。核心测试用 `createMemoryPersistence` 的可控 persistence stub、deferred load/factory/release gates 与显式 microtask settle；本票不使用 scheduler/timeout seam。**不在 #110 建立 Memory/File 共用 Registry contract suite**，那是 #113 的明确范围。

| 类别 | 确定性断言 |
|---|---|
| surface/package | exports 仅 `.`/`./testing`；主入口运行时与 declaration emit 均无 Runtime/DocHandle/Y.Doc/internal subpath 泄漏；root typecheck 链含新包；REPO_ROOT-relPath internal gate 收集真实 `packages/namespace-registry/src/registry.ts` import 且 `violators=[]` |
| open 分支/identity | `namespaceId` primitive-string 先短路；null/array/继承型 owner、accessor、getPrototypeOf/getOwnPropertyDescriptor throw Proxy、String object namespaceId 都 resolve invalid，零 map/Persistence/factory；Unicode/长字符串/含空格且 Persistence 可 create/load 的 identity 可 open |
| publish 时机 | runtime factory 返回即 lease 成功；P0 deferred 时 read/status 立刻可用，open 不 await P0 |
| singleton/concurrency | 两个同 key deferred load 仅 load/factory 一次、两个独立 lease；不同 key 在彼此 gate 未开时并行到 load |
| sequencing/carrier | 同 key open fail 后 retry 独立 load；slot rejection 不毒化 tail；N 个不同合法 key 的 null、typed failure、unknown fatal 全 settle 后 diagnostics 每个 created/deleted 成对、无 orphan；第一个 slot cleanup microtask 前接纳第二个同 key open，旧 cleanup 不删除新 tail/carrier，第二 slot FIFO 独立执行 |
| ABA | 旧 entry close/release deferred 后，新 generation 已置入 map；旧 completion 不能删新 entry（identity+generation）；旧 carrier cleanup 不能删新 carrier（carrier identity+generation+tail 三守卫） |
| capability | fatal/unavailable/degraded Runtime 均可 open，lease 透传实际 status/read/write 結果 |
| lease | owner 冻结独立投影；每成功 open 独立 lease；首次 release 返回前 status 已 released；重复 release 与 asyncDispose exact same Promise；最后 release 本票不 close；每一行 released 表；三个 getter throw 可由公开 `NamespaceLeaseReleasedError`/code 判别 |
| observer/泄漏 | typed load 必发 `open-load-failed` exact cause；observer 收 exact identity；observer throw 被隔离；factory throw 后 handle.release resolve/reject 均恰调用一次且 observer throw 不替换主 fatal；所有公开 text/JSON 不含 sentinel identity/schema/root/cause/stack |
| temporary API | create、shutdown 都 resolve `NAMESPACE_OPERATION_UNAVAILABLE`，不触 input/Persistence、不改变 running；getStatus 恒 running |
| module-boundary | 若现有 helper 缺失先修复，真实生产树（非 fixture-only）以 REPO_ROOT 相对路径扫描；合法 registry import 无 violator，testing/test/其它包 import 的反演探针为 violator |
| node | Node 20 与 24 对 `await using lease` 做实际 dispose（非仅 type test） |

所有并发测试只用 deferred gate/显式 microtask settle，禁止真实 sleep；运行门禁由后续实现阶段执行 `pnpm typecheck`、`pnpm test`、`tsc -p tsconfig.typecheck.json --noEmit`。

## §10. 12 条 AC 映射

| AC | 设计节 | 测试 |
|---|---|---|
| 1 新包/Interface/open | §2、§3、§6 | surface、open 分支 |
| 2 同 key 唯一/不同 key 并行 | §5 | singleton/concurrency |
| 3 同键串行且 tail 不毒化 | §5 | sequencing |
| 4 open 不等 P0 | §6 | publish 时机 |
| 5 窄结果与 fatal 分类 | §3、§6 | open 分支 |
| 6 fatal/unavailable/degraded 可 open | §6 | capability |
| 7 独立 lease、无裸 runtime | §2、§7 | surface、lease |
| 8 代理/同步 release/asyncDispose/status | §3、§7 | lease |
| 9 released 仅 status 成功 | §7 | lease 逐行表 |
| 10 generation/identity 防 ABA | §5 | ABA |
| 11 零回显 + observer | §8 | observer/泄漏 |
| 12 并发、typecheck/test、Node20/24 | §9 | concurrency、node、CI 门禁 |

## §11. 已执行 SA2 裁决与剩余实施风险

1. **create/shutdown**：已冻结为 resolve `NAMESPACE_OPERATION_UNAVAILABLE` 的非 fatal 窄 issue；不访问 input/Persistence、不改变 running。#111/#112 替换该公开行为须显式兼容性/版本审查。
2. **released getter**：已冻结 coded throw，且公开导出 `NamespaceLeaseReleasedError` 供 `instanceof`/code 识别。
3. **identity**：已撤回 ASCII/128 限制；采用 §4 最小安全规则并在 Persistence create/load 的 Unicode、长字符串、空格边界上兼容测试。未来若权威层发布 shared canonical validator，再通过独立 ADR/迁移替代。
4. **factory 清理**：已冻结 release 恰一次、release/observer failure 不替换 factory fatal。
5. **create input**：`unknown` 保持为 #111 前的纯扩展位，不提前冻结命名输入类型。
6. **实施风险**：当前 runtime rev1 module-boundary test 引用了不存在的 helper，故该 helper + true REPO_ROOT 活链路修复是本票不可跳过的前置实施项，而非测试可选优化。

## §12. SA2 反馈逐条回应

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|---|:--:|---|---|
| B1：carrier 存储、清理、ABA 与受控核验 | ✅ | §1.2、§5、§6、§8.2、§9 | 明确 `carriers` 独立 map、三条件 cleanup（无 entry/identity/tail），bigint generation、diagnostics 事件及 null/load-failed/fatal/race 测试。 |
| B2：hostile identity 可实现算法 | ✅ | §4、§6、§9 | namespaceId `typeof` 首短路；owner proto/descriptor 全 try/catch；trap 异常 invalid；零访问定义收窄为零 Registry/Persistence/Runtime。 |
| B3：REPO_ROOT internal gate 活链路 | ✅ | §2.1、§9、§13 | 已读 rev1 gate，确认 helper 缺失；把 helper/rev1 修复与真实 registry import `violators=[]` 加入硬验收和 ALLOW。 |
| 裁决 1：create/shutdown 不得假 fatal | ✅ | §3、§9、§11 | 冻结 `NAMESPACE_OPERATION_UNAVAILABLE` resolve result，零 input/Persistence/状态副作用。 |
| 裁决 2：released getter 可识别 | ✅ | §2.2、§3.2、§7、§9 | 主入口导出 `NamespaceLeaseReleasedError`，冻结 `instanceof`/code 消费方式。 |
| 裁决 3：撤回 ASCII/128 identity 文法 | ✅ | §4、§9、§11 | 改为最小兼容安全规则，加入 Unicode/长/空格 Persistence round-trip open。 |
| 裁决 4：factory release failure | ✅ | §6、§8、§9、§11 | release 恰一次；reject 仅 observer；observer throw 不改变主 fatal。 |
| 裁决 5：create unknown | ✅ | §3、§11 | `create(input: unknown)` 保留，不引入 #111 命名输入类型。 |
| 建议：删除 scheduler 暗示 | ✅ | §9 | 改为 deferred/microtask，不使用 createTestScheduler。 |
| 建议：generation 定死 | ✅ | §5、§8、§9 | entry/carrier 都为不复用 `bigint` generation。 |
| 建议：typed load observer 精确化 | ✅ | §6、§8、§9 | 每个 typed load 必发 exact-cause event，并测 observer isolation。 |
| 建议：declaration leak gate | ✅ | §2.2、§9 | 加 declaration emit 文本和 runtime export-key 双审计。 |
| 建议：owner 措辞 | ✅ | §7 | 改为“冻结独立投影”。 |

## §13. 文件清单（File Scope）

### ALLOW LIST
- `packages/namespace-registry/package.json` — 新建；§2 包 metadata/exports/依赖（约 25 行）。
- `packages/namespace-registry/tsconfig.json` — 新建；§2 TypeScript 包配置（约 4 行）。
- `packages/namespace-registry/src/index.ts` — 新建；§2 主入口窄导出（约 15 行）。
- `packages/namespace-registry/src/types.ts` — 新建；§3 公共类型与状态（约 180 行）。
- `packages/namespace-registry/src/identity.ts` — 新建；§4 安全 identity 校验（约 80 行）。
- `packages/namespace-registry/src/errors.ts` — 新建；§3 stable fatal/released error（约 70 行）。
- `packages/namespace-registry/src/registry.ts` — 新建；§5/§6 Registry、slot、open（约 260 行）。
- `packages/namespace-registry/src/lease.ts` — 新建；§7 代理与 release（约 220 行）。
- `packages/namespace-registry/src/observer.ts` — 新建；§8 内部 observer 类型/隔离（约 70 行）。
- `packages/namespace-registry/src/testing.ts` — 新建；§8 controlled testing subpath（约 70 行）。
- `packages/namespace-registry/test/registry-open.test.ts` — 新建，[SA6 owned] §9 open/并发/lease/ABA 红灯验收。
- `packages/namespace-registry/test/registry-surface.test.ts` — 新建，[SA6 owned] §9 exports、模块边界与零泄漏验收。
- `packages/namespace-registry/test/registry-node-dispose.test.ts` — 新建，[SA6 owned] §9 Node asyncDispose 实测。
- `package.json` — 修改；§2 根 typecheck 链追加新包（1 行）。

### DENY LIST
- `packages/namespace-runtime/src/**` — Runtime 已由 #109 提供受限 internal factory；本票不得改变 Runtime 行为。
- `packages/persistence/src/**` — #108 已冻结 typed error；本票只消费，不改 Persistence。
- `packages/clock/**` — 本票 Host 无关，不引 Clock 生产依赖。
- `packages/dsh-persistence/**` — 本票不做 Cordis/DSH adapter。
- `docs/adr/**`、`docs/phases/**`、`CONTEXT.md` — 权威资料只读。
- `pnpm-workspace.yaml`、`vitest.config.ts`、`tsconfig.typecheck.json` — 已覆盖 `packages/*`，不改配置。
- `packages/persistence/test/**` — 现有 Persistence 测试不改。

### ALLOW LIST（R1 修订追加：SA2 B3）
- `packages/namespace-runtime/test/helpers/registry-seam-audit.ts` — 新建，§2.1/§9 将 internal-import 审计实现落地为 REPO_ROOT 相对路径、全形态扫描和真实生产树 gate（约 180 行）。
- `packages/namespace-runtime/test/runtime-registry-internal-seam-rev1.test.ts` — 修改，[SA6 owned] §2.1/§9 连接真实 `packages/namespace-registry/src/registry.ts` import 的活链路断言，验证 `violators=[]`（约 45 行）。

## §14. 协议假设依据 (Protocol Assumption Evidence)

无协议级假设：本设计仅涉及同进程 TypeScript 代码、Promise queue 与包导出；不规定 HTTP/WS 路径、端口、跨进程资源、服务启动时序或第三方工具默认行为。

## §15. 契约改动连锁审计 (Contract Change Caller Audit)

无既有函数的契约改动：本票新增 `@nomicore/namespace-registry` 的函数与类型，不将任何既有 `return` 改为 `throw`、不改变既有函数 async/nullable/error 契约。唯一既有跨包调用是新增 Registry 生产实现消费已冻结的 `createNamespaceRuntimeForRegistry(handle, notifyDirty)` 与 `DocPersistence.loadDoc/saveDoc`；它们没有被修改，故不存在需迁移的现有 caller。