# Issue #111 冻结设计：namespace-registry 排他 `create` 与完整初始 generation

> 基线：`cdcf28b`，建立在 #110 的 carrier/entry/open 冻结实现上。此票只替换 `create` 占位行为并新增初始文档组合 seam；不改变 open、lease、carrier 或关闭预留语义。

## §1. 目标、非目标与不变量

### 1.1 目标

1. `create` 只接受 `{ owner, namespaceId, schema, root }`；ROOT 是完整 logical snapshot，调用方不得给 META/createdAt，且不得省略 root。
2. 同一 `(owner.userId, namespaceId)` 与 open 共用 #110 carrier FIFO；不同 key 并行。每个 slot 独立结算，失败永不毒化 green tail。
3. identity 在 entry/carrier/Persistence 前校验，公开结果零回显输入或 cause；有效 identity 投影在接纳时冻结，既是 queue key 也是最终 Persistence/create-document 身份。
4. Registry 在 slot 内用必需 Clock 生成一次 `META.createdAt`；私有 create-document 编译、原样封闭校验、detached 构造和单事务安装 `SCHEMA/META/ROOT`。
5. create 成功仍经普通 P0 Runtime factory；已持久化后 factory 失败必须诚实地 reject `committed:true`，不删除文档、不 create-as-open。

### 1.2 非目标

不实现 idle timeout、shutdown、Cordis plugin、authorization、默认 ROOT、upsert、rollback/delete、META 后续写、Persistence/doc-runtime 既有契约重写。#110 中 `phase:'closing'`、`closePromise`、entry `lifecycleTail` 继续仅为预留；本票不消费其生命周期实现。

### 1.3 不变量

- 同 key 最多一个 active Runtime；active（包括当前切片 lease 为零但 entry 保留的临时态）create 是零 Persistence 的 duplicate。
- 同步接纳不读取 schema/root 值、不执行 accessor getter、零 entries/carriers/Persistence/Runtime/create-document 副作用；JavaScript 的 `getPrototypeOf`/`getOwnPropertyDescriptor`/`ownKeys` 等元操作对 Proxy trap 不可避免，trap 抛错一律映射窄 issue。
- 槽内对 payload 做一次防御性快照；快照成功后所有 compile/validate/build 都只消费该快照。调用方排队时变更 payload 生效，槽内冻结后变更无效。
- 所有公开 issue/message 常量化；内部 observer 可取得受控 identity 与 exact cause。
- `DocCreateOperationalError` 是唯一 create operational 降级；unknown 永不伪装为 operational。

## §2. 包骨架、依赖与导出纪律

### 2.1 Registry 变更

`@nomicore/namespace-registry` 增加内部 `create-document.ts`；`registry.ts` 消费它并在内部 options 接收 Clock 与 create-document factory。`package.json` 新增 `@nomicore/clock` 和 `@nomicore/doc-runtime` workspace dependencies。生产 `createNamespaceRegistry(persistence, options)` 的 options 必须提供 `clock`；缺失、`null` 或无可调用 `now` 的值构造期 loud throw，禁止 `Date.now()` fallback。

为最大程度兼容已冻结 #110 签名，Clock 置于既有第二参数 `CreateNamespaceRegistryOptions`，但由 optional 改为 required：`createNamespaceRegistry(persistence, { clock, observer? })`。这是一项刻意的 source-breaking capability requirement，原因是 create 已成为 Interface 的真实能力，ADR-0009 禁止静默系统时钟。仅 open 使用方也必须显式提供 Clock；测试工厂可注入 manual Clock。

### 2.2 doc-runtime 新公共组合 seam

`@nomicore/doc-runtime` 主入口增加值导出 `createInitialDocument` 与其输入/结果类型。它自持 `new Y.Doc()`，使 Registry 永不获得失败时的 partial doc。`detached-build.ts` 仍不导出；安装机械仅留在 doc-runtime。

### 2.3 主入口精确增量

Registry `index.ts` 新增 type-only：`CreateNamespaceInput`、`CreateNamespaceIssue`、`CreateNamespaceResult`；删除已被替换的 `RegistryOperationUnavailableIssue`（`shutdown` 在本票仍可保留其现状，但其 `create` 分支不再是 public result）。运行时值导出仍严格只有 `createNamespaceRegistry`、`NamespaceRegistryFatalError`、`NamespaceLeaseReleasedError`。

主入口及其可达声明不得出现 `NamespaceRuntime`、`DocHandle`、`Y.Doc`、`@nomicore/namespace-runtime/internal`。`Y.Doc` 仅允许在 registry `./testing` declaration 的 internal type import 以及 doc-runtime 自己的声明中出现。

## §3. 冻结公共类型与稳定 message 常量表

```ts
export interface CreateNamespaceInput {
  readonly owner: NamespaceOwner
  readonly namespaceId: string
  readonly schema: unknown
  readonly root: unknown
}

export type CreateNamespaceIssue =
  | InvalidIdentityIssue
  | Readonly<{ ok:false; code:'NAMESPACE_CREATE_INVALID_INPUT'; message: typeof NAMESPACE_CREATE_INVALID_INPUT_MESSAGE }>
  | Readonly<{ ok:false; code:'NAMESPACE_SCHEMA_INVALID'; issues: readonly unknown[]; message: typeof NAMESPACE_SCHEMA_INVALID_MESSAGE }>
  | Readonly<{ ok:false; code:'NAMESPACE_ROOT_INVALID'; issues: readonly unknown[]; message: typeof NAMESPACE_ROOT_INVALID_MESSAGE }>
  | Readonly<{ ok:false; code:'NAMESPACE_ALREADY_EXISTS'; message: typeof NAMESPACE_ALREADY_EXISTS_MESSAGE }>
  | Readonly<{ ok:false; code:'NAMESPACE_CREATE_FAILED'; message: typeof NAMESPACE_CREATE_FAILED_MESSAGE }>
  | RegistryNotAcceptingIssue

export type CreateNamespaceResult =
  | Readonly<{ ok:true; lease: NamespaceLease }>
  | CreateNamespaceIssue
```

类型面沿既有 NamespaceRuntime 写路径使用 `readonly unknown[]`：vfsl 编译、逻辑校验与 detached builder 的既有 issue 名义类型不同，Registry 不应重发明统一名义类型。`NAMESPACE_SCHEMA_INVALID` 携带 `compileSchemaEnvelope` 的完整 issues；`NAMESPACE_ROOT_INVALID` 携带 validate 或 detached-build 的完整 issues。允许冻结外层数组，但不得深克隆、重写、sanitize 或改变原 issue 的 message/path/数量/顺序。

**DQ-4 裁决（总控）：verbatim 透传。** ADR-0009 L87 明定“内嵌对应完整底层 issues”，既有 lease 写路径亦原样出货；故完整原对象的 message/path/数量/顺序都是契约。零回显只约束 Registry 自创面：顶层恒定 message、identity 原值、cause 文本/stack；**内嵌底层 issues 整体不做 sentinel 负锁**。它们可按既有诊断契约包含键、路径、正则及 XML 输入值摘录；verbatim 性质仅以与底层直接输出深等锚定。被否方案为半 sanitize：既破坏完整诊断，也无法安全宣称底层诊断零回显。

### 稳定 message 单点表

| code | 恒定中文 message |
|---|---|
| `NAMESPACE_INVALID_IDENTITY` | `NAMESPACE_INVALID_IDENTITY: owner.userId 或 namespaceId 不符合安全文法` |
| `NAMESPACE_CREATE_INVALID_INPUT` | `NAMESPACE_CREATE_INVALID_INPUT: create 输入必须恰含 owner、namespaceId、schema 与 root` |
| `NAMESPACE_SCHEMA_INVALID` | `NAMESPACE_SCHEMA_INVALID: namespace schema 编译失败` |
| `NAMESPACE_ROOT_INVALID` | `NAMESPACE_ROOT_INVALID: namespace ROOT 不符合 schema 或无法构造` |
| `NAMESPACE_ALREADY_EXISTS` | `NAMESPACE_ALREADY_EXISTS: namespace 已存在，不能重复创建` |
| `NAMESPACE_CREATE_FAILED` | `NAMESPACE_CREATE_FAILED: namespace 持久化创建发生运营故障` |
| `REGISTRY_NOT_ACCEPTING` | `REGISTRY_NOT_ACCEPTING: Registry 当前不接纳 namespace 操作` |

Registry 自创顶层 message 不插值 owner、namespaceId、schema/ROOT 全文、异常 message 或 stack。按本节 DQ-4 裁决，内嵌底层 issues 是显式诊断例外，逐字保留，不能对其主张零回显。

## §4. identity 与 DQ-1 读取时序裁决

### DQ-1：采纳「最小 identity 接纳 + 槽内 payload 冻结」

**结论：**采用总控预研，但把最终身份一致性写成硬条件：接纳阶段以 #110 `validateOpenIdentity` 的 descriptor-only 算法读取 `input.owner`/`input.namespaceId`，立即冻结 owner projection、namespaceId、key；之后绝不再次读取这两个 input 字段。故排队期间 owner 被改写不会改变最终 Persistence/create-document identity，也不会让 queue key 与执行身份分裂。

接纳失败（顶层 input 非 object、identity descriptor trap、identity 无效）只 resolve 对应 `NAMESPACE_CREATE_INVALID_INPUT` 或 `NAMESPACE_INVALID_IDENTITY`，零 entries/carriers/Persistence/runtime/create-document 访问。接纳仅从顶层 descriptor 获取 owner/namespaceId，拒绝 accessor；不触 schema/root 值。这里不声称“零敌意 JS 执行”：`getPrototypeOf`、`getOwnPropertyDescriptor` 与必要的 `ownKeys` 对 Proxy 的 trap 不可避免；任一 trap throw 均 catch 后成为窄 issue，且不能伤害 Registry。

**被否方案：**(a) 接纳时完整读取/冻结 input，违反 ADR/#104 的 slot-start snapshot；(b) 用 mutable input 重新读取 identity，造成 key/Persistence 分裂；(c) 无 identity 先建全局 queue，会丧失每 key 并行。

槽开始后的 `snapshotCreatePayload` 固定次序：
1. 检查 acceptance；
2. 检查 entry/closing/duplicate（见 §5）；
3. 用 descriptor 读取顶层 own keys，要求 plain/null-prototype object、own enumerable key set 恰四个、各为 own data descriptor，拒 accessor；`ownKeys`/descriptor/prototype 等元操作可触发 Proxy trap，trap throw catch 为本调用 input issue，Proxy 可伪装 descriptor 事实，不宣称可识别或拒绝全部 Proxy；
4. 仅对 schema/root 执行 cycle-safe plain-data deep clone（数组、plain/null prototype object、JSON scalar；拒 function/symbol/bigint/nonfinite/Date/Yjs/循环/共享引用/descriptor trap）；clone 后深冻结；同样只保证 trap 失败的 slot isolation，不承诺零 trap 执行；
5. 调 Clock；6. 调 create-document；7. Persistence；8. Runtime。

payload 被拒仅影响此 slot，carrier green tail 继续。读 owner/namespaceId 的冻结投影不以 payload shape 结果为条件。

## §5. create slot 精确伪码（冻结次序）

```ts
async function runCreateSlot(id: InternalIdentity, inputRef: unknown): Promise<CreateNamespaceResult> {
  if (acceptance !== 'running') return NOT_ACCEPTING

  const current = entries.get(id.key)
  if (current?.phase === 'active') return ALREADY_EXISTS // zero Persistence
  if (current?.phase === 'closing') {
    // 本切片不可达；fail-closed，不能与 #112 半成品 close 并行。
    if (current.closePromise === undefined) {
      const cause = new Error('closing entry 缺少 closePromise')
      observe('lifecycle-slot-failed', id, 'create', cause)
      throw fatal('create', 'lifecycle-slot-internal', false, cause)
    }
    try { await current.closePromise }
    catch (cause) {
      observe('lifecycle-slot-failed', id, 'create', cause)
      throw fatal('create', 'lifecycle-slot-internal', false, cause)
    }
    const after = entries.get(id.key)
    if (after === undefined) { /* 仅此分支继续至 payload */ }
    else if (after.phase === 'active') return ALREADY_EXISTS
    else {
      // await 后再度 closing：本票不建 loop，fail-closed；#112 统一 closing 策略。
      const cause = new Error('closing entry 在 close 后仍为 closing')
      observe('lifecycle-slot-failed', id, 'create', cause)
      throw fatal('create', 'lifecycle-slot-internal', false, cause)
    }
  }

  const payload = snapshotCreatePayload(inputRef, id)
  if (!payload.ok) return CREATE_INVALID_INPUT

  const createdAt = readCreatedAtOrFatal(clock) // see §6; one read per admitted prepared create
  let initial
  try { initial = createDocumentFactory(id.namespaceId, createdAt, payload.schema, payload.root) }
  catch (cause) {
    observe('lifecycle-slot-failed', id, 'create', cause)
    throw fatal('create','create-document-internal',false,cause)
  }
  if (!initial.ok) {
    if (initial.kind === 'root-invalid') return ROOT_INVALID_VERBATIM(initial.issues)
    // input-invalid is structurally unreachable for Registry-produced envelope/meta.
    const cause = new Error('createInitialDocument 返回不可达 input-invalid')
    observe('lifecycle-slot-failed', id, 'create', cause)
    throw fatal('create','create-document-internal',false,cause)
  }

  let handle
  try { handle = await persistence.createDoc(id.owner, id.namespaceId, initial.doc) }
  catch (cause) {
    if (cause instanceof DocDuplicateError) return ALREADY_EXISTS
    if (cause instanceof DocCreateOperationalError) { observe('create-persist-failed', id, cause); return CREATE_FAILED }
    if (cause instanceof DocCreateFatalError) {
      observe('lifecycle-slot-failed', id, 'create', cause)
      throw fatal('create','lifecycle-slot-internal',cause.committed,cause)
    }
    // typed contract covers legal outcomes; unknown is adapter/registry defect and is pre-commit by contract.
    observe('lifecycle-slot-failed', id, 'create', cause)
    throw fatal('create','lifecycle-slot-internal',false,cause)
  }

  try {
    const runtime = runtimeFactory(handle, () => persistence.saveDoc(handle))
    const entry = makeEntry(id, runtime); entries.set(id.key, entry)
    return issueLease(entry)
  } catch (cause) {
    void releaseHandleBestEffort(handle, id) // exactly once; never await
    observe('create-runtime-construction-failed', id, cause)
    throw fatal('create','runtime-construction',true,cause)
  }
}
```

接纳调用为 `admitCreateSlot(frozenIdentity, inputRef)`，沿用 #110 carrier 的 `tail.then(run)` 与 green-tail cleanup；create/open 都走同一 carrier。`inputRef` 不被接纳段检查 schema/root，槽启动才触碰。

### DQ-5：duplicate 统一映射

active（含 lease 为零临时态）立即 `ALREADY_EXISTS`；closing 等待 `closePromise` 后重评估；concurrent 由同 key FIFO 让后项在前项真相后判断；Persistence `DocDuplicateError` 亦同一 issue。绝不 `loadDoc`、绝不签现存 entry lease、绝不 upsert/open fallback。被否方案是 create duplicate 返回 open lease：它会破坏排他 create 的调用者语义并掩盖 race。

## §6. create-document 能力、Clock 与 DQ-2/DQ-3

### DQ-2：采用 doc-runtime 自持 doc 的 `createInitialDocument`

```ts
// @nomicore/doc-runtime public
createInitialDocument({ envelope, derived, meta: { docId, createdAt }, root }):
 | { ok:true; doc:Y.Doc }
 | { ok:false; kind:'input-invalid'; issues: readonly unknown[] }
 | { ok:false; kind:'root-invalid'; issues: readonly unknown[] }
// throws DocRuntimeFatalError only on internal/unexpected paths
```

Registry 私有：

```ts
createDocument(namespaceId, createdAt, schema, root):
 | {ok:true; doc:Y.Doc}
 | {ok:false; kind:'schema-invalid'|'root-invalid'; issues: readonly ...[]}
```

它先 `compileSchemaEnvelope(schema)`；compile result failure 是 `schema-invalid`。成功后把编译 envelope/derived 与 `{docId:namespaceId,createdAt}`、原样 frozen ROOT 传给 `createInitialDocument`。Registry 不直调 `buildTopEntries`。

`createInitialDocument` 的三类精确结局：**input-invalid** 是 doc-runtime 直接调用方的领域失败面，envelope 不是 own 键恰 `{lang,version,id,text}` 且四值型正确，或 META 的 `docId` 非非空 string / `createdAt` 非 string 时，返回单 issue `path:[]`，零 doc 出站；**root-invalid** 原样透传 `validateLogicalSnapshot`/`buildTopEntries` issues；手造 `derived.structure.kind !== 'root'` 则抛 `DerivedInvariantError`，归 `DocRuntimeFatalError('pre-commit-internal',false)`，沿 replaceSchemaAndRoot 的 E204 两级信任边界，绝不伪装为 input issue。

Registry 侧 `input-invalid` 结构性不可达：compileSchemaEnvelope 产物恒为四键正确型，META 由 Registry 自构（`docId` 是已过文法的 namespaceId，`createdAt` 是 `toISOString()` 产物）。若仍收到它，Registry 必须 observer `lifecycle-slot-failed(create)` 并 reject `NamespaceRegistryFatalError(create,'create-document-internal',false,cause)`，禁止映射为普通 create input issue；schema compile failure 始终在 Registry 私有层映射 `NAMESPACE_SCHEMA_INVALID`，不经过 seam。

prepare 成功后才 `const doc=new Y.Doc()`；fresh doc 的 SCHEMA/META/ROOT 结构性缺席，三者以 `getMap` 惰性取得。异型 probe 分支对 fresh doc 结构性不可达，故不复制 replace seam 的多载体 probe；仍显式断言三 map 在首次安装前 `size===0`，若偏离属 `pre-commit-internal` fatal，防止未来 hook/重构走私既有内容。

随后以 `transactGuarded` 执行**恰一个** transaction：SCHEMA clear+set `lang/version/id/text`（严格四键）、META clear+set `docId/createdAt`（严格二键）、ROOT clear+安装 detached entries。事务后必须 `verifySchemaFourKeys`、`verifyMetaTwoKeys`（均为 size+逐键同一）、`verifyInstall` 与 `verifySnapshotIntact`。doc-runtime fatal phase 严格以现行 `fatal.ts` 三相为准：prepare/空置异常为 `pre-commit-internal,false`；`transactGuarded` observer cleanup escape 为 `observer-cleanup-throw,true`；写后四类 verify 偏离为 `post-commit-verification,true`。正常 fresh doc 无 observer 不构成删防线理由；afterTransaction 或未来 hook 仍可同步破坏安装，故 transaction guard 和全部 verify 保留。Registry 将任何该 seam fatal 包为 `create-document-internal`，committed 原样保留。

**职责边界：**doc-runtime 负责 Yjs、验证、构造、事务与写后核验；Registry 负责 schema compile、createdAt 生成、结果映射、Persistence 和 Runtime。被否方案：Registry 自建 `Y.Doc`/import `detached-build`，会绕过公共边界且失败时容易泄漏 partial doc；在 replace seam 上硬塞 META，会混淆“替换已有文档”和“首次构造”。

### DQ-3：Clock 必需，且生成位置固定

`Clock` 为生产工厂构造期必须 capability；testing 也必须显式传入。`readCreatedAtOrFatal` 在 payload 成功快照后、任何 compile/validate 前执行一次：

```ts
const ms = clock.now() // throw -> fatal
if (typeof ms !== 'number' || !Number.isFinite(ms) || Math.abs(ms) > 8.64e15)
  throw fatal(create, 'create-document-internal', false, cause)
const createdAt = new Date(ms).toISOString() // catch RangeError -> same fatal
```

Clock failure是 pre-commit，零 Persistence。选择“payload snapshot 后、compile 前”冻结多缺陷优先级：恶意/缺字段输入先得到 public input issue；合格输入而 Clock 非法必先 fatal，即使 schema/root 随后也会失败。被否方案：Date.now fallback（违 ADR）；compile 后生成（clock defect 被 schema issue 隐藏且 createdAt 读点不稳定）；允许 NaN/Infinity/Date-invalid 值。

## §7. 失败映射表（DQ-4/DQ-6/DQ-7）

| 来源/时点 | 公开结局 | fatal(operation/phase/committed) | observer |
|---|---|---|---|
| 接纳 identity 无效 | `NAMESPACE_INVALID_IDENTITY` | — | 无 |
| 槽内 payload shape/snapshot 缺陷 | `NAMESPACE_CREATE_INVALID_INPUT` | — | 无 |
| Clock throw/非法 | reject | `create/create-document-internal/false` | `lifecycle-slot-failed(create)` |
| schema compile result | `NAMESPACE_SCHEMA_INVALID` + verbatim 完整 issues | — | 无 |
| ROOT validate/build result | `NAMESPACE_ROOT_INVALID` + verbatim 完整 issues | — | 无 |
| createInitialDocument `root-invalid` | `NAMESPACE_ROOT_INVALID` + verbatim 完整 issues | — | 无 |
| createInitialDocument `input-invalid`（Registry 路径不可达） | reject | `create/create-document-internal/false` | `lifecycle-slot-failed(create)` |
| createInitialDocument internal fatal | reject | `create/create-document-internal/<原 committed>` | `lifecycle-slot-failed(create)` |
| closing entry 缺少 `closePromise`、await reject、或 await 后仍 closing（不可达 fail-closed） | reject | `create/lifecycle-slot-internal/false` | `lifecycle-slot-failed(create)` |
| closing await 后 active | `NAMESPACE_ALREADY_EXISTS` | — | 无 |
| active/concurrent/persisted duplicate | `NAMESPACE_ALREADY_EXISTS` | — | 无 |
| `DocCreateOperationalError` | `NAMESPACE_CREATE_FAILED` | — | `create-persist-failed` exact error |
| `DocCreateFatalError` | reject | `create/lifecycle-slot-internal/<原 committed>` | `lifecycle-slot-failed(create)` |
| createDoc unknown throw | reject | `create/lifecycle-slot-internal/false` | `lifecycle-slot-failed(create)` |
| Runtime factory after resolved createDoc | reject | `create/runtime-construction/true` | `create-runtime-construction-failed`; release failure另发 |
| acceptance stopped | `REGISTRY_NOT_ACCEPTING` | — | 无 |

### DQ-6：unknown createDoc 固定 `committed:false`

`DocCreateFatalError` 的 committed 原样传播，phase 改写为 Registry 的 `lifecycle-slot-internal`，因为公开 Registry phase 词表不泄漏 Persistence pipeline phrase。unknown 不降级 operational，但固定为 `false`：#108 typed 契约覆盖全部合法 create 结局，unknown 即 adapter/registry 缺陷；报 false 后 retry 会由原子 duplicate 守卫自愈为 `ALREADY_EXISTS`（或 open 成功），而报 true 会使调用方放弃、随后 open 得 NOT_FOUND，可能永久丢失 create 意图。此选择也与 open unknown-load 的 false 一致；ADR-0009 只禁止降级，不要求把 ADR-0008 非幂等 mutation 的保守哲学移植到具 duplicate 守卫的 create。现实 `assertWritable` disposed 裸 Error 与 META 校验裸 Error 均是已知 pre-commit 路径。残留风险：不合规 adapter 若 post-commit 后抛 unknown，会被报 false；恢复路径是 retry 后 `ALREADY_EXISTS`，不可把该 breach 静默包装 operational。

### DQ-7：post-commit factory failure

createDoc resolve 即是 Persistence committed 事实，因此随后 factory throw 必为 `committed:true`（不同于 open 的 load 后 false）。handle 所有权尚未转给 Runtime，`releaseHandleBestEffort` 同步发起且恰一次，内部 catch observer，fire-and-forget，永不阻塞 fatal。Persistence `release()` 会同步从 handle 集合摘挂；即使其 Promise 永不 settle，后续 `loadDoc` 仍可从 live cell 重签 handle 或从 committed snapshot 新读。失败 Runtime 从未发布，entry 只在 factory 成功后 `entries.set`，故失败路径结构性零 entry。文档不删除、不补偿；随后 open 可构造新 Runtime。测试必须锁定：createDoc resolved→factory throw→release never-settle→open 仍得 lease、entries 零残留、release 恰一次。

## §8. observer、testing 与导出面（DQ-8）

`RegistryObserverEvent` 扩展为：

```ts
| {type:'create-persist-failed'; identity:InternalIdentity; cause:DocCreateOperationalError}
| {type:'create-runtime-construction-failed'; identity:InternalIdentity; cause:unknown}
| {type:'lifecycle-slot-failed'; identity:InternalIdentity; operation:'open'|'create'; cause:unknown}
```

保留 `handle-release-failed`，用于 open/create；duplicate、not-accepting、input/schema/root domain issue 不发事件，符合 open 的 not-found 无失败 observer 先例。observer throw 隔离。

`./testing` 增加：

```ts
clock: Clock
createDocumentFactory?: (namespaceId:string, createdAt:string, schema:unknown, root:unknown) => CreateDocumentResult
```

testing factory 的 Clock 也为必需，便于 manual clock 精确锚定。Clock shape gate 在生产/testing 构造期同步执行：options 缺失、`clock` 为 null/non-object、或 `now` 非函数，一律 `throw new TypeError('NAMESPACE_REGISTRY_CLOCK_REQUIRED: Registry 必须提供可调用的 Clock.now')`；message 固定、零回显被传入值。`createDocumentFactory` 只返回成功 doc 或领域失败，若 throw 即模拟 internal；其 `Y.Doc` type import 仅在 testing subpath 内。主入口不导出 observer/testing/factory/Yjs 类型。diagnostics 不变。

**closing 红灯专用内部 seam：**`createRegistryInternal` 的包内 options 可接收 `testEntries?: ReadonlyMap<string, { phase:'closing'; closePromise?: Promise<void> }>`。它是 test-only any-bridge fixture，既不经 `index.ts` 也不经 `testing.ts` 导出，只允许 registry 包内测试以相对模块通道消费；仅用于将 entry 注入 closing 分支，验证 missing/reject/再度-closing 三变体 fail-closed。不得将它用于读取真实 entries、构造 active Runtime、生产注入或扩展为公开生命周期 API。

observer consumer 审计：实现前以 `git grep -n -E 'RegistryObserverEvent|lifecycle-slot-failed' -- packages apps domains tests` 列出所有消费者；现有 open event 的 type/name/cause 断言不变，仅 `operation` 联合新增 `create`，所有 exhaustive switch/测试必须显式迁移。observer throw 始终隔离。

surface 测试使用 TypeScript compiler API 实际 emit `.d.ts`，而非源码 grep：从 registry 主入口生成的可达 declaration 文本递归断言不含 `Y.Doc`、`DocHandle`、`NamespaceRuntime`、internal subpath；反向 fixture 验证新增 `CreateNamespaceResult → NamespaceLease` 链也不引入这些文本。doc-runtime 自身主入口可合法出现 `Y.Doc`（`createInitialDocument` 返回值），但 Registry 不得 re-export 或以 type alias 间接可达该 seam。registry seam audit 允许 Registry 唯一消费 runtime internal，但 create-document 只以 registry 相对内部模块调用 doc-runtime public entry。

## §9. 测试矩阵（DQ-9）

全部并发场景使用 deferred gate + `flushMicrotasks`，禁止 real sleep。

| 类别 | 确定性断言 |
|---|---|
| 成功全链 | manual Clock 精确 `createdAt`；Persistence 收到严格 META；SCHEMA 四键、META 二键、ROOT 完整内容；在调用 seam 前注册 `afterTransaction`，计数恰 1；factory 仍走 P0 seam |
| snapshot 时机 | queue 前 schema/root 改动生效；slot 已通过 snapshot gate 后改动不生效；owner 改动既不改 key 也不改 Persistence owner/docId |
| hostile input | top-level/owner Proxy 的 descriptor/proto trap 计数或 throw 被窄 issue 吸收、identity 无效时零 carrier/Persistence；槽内 ownKeys/payload trap 仅失败该 slot且 tail 继续；不声称 zero trap |
| Registry 自创面负锁 | invalid identity 零 carrier/entry/Persistence/factory/create-document；仅顶层 issue/fatal 恒定 message、identity 原值、cause 文本/stack 的 sentinel JSON 负锁；不检查内嵌 issues |
| domain | schema compile、ROOT validate/build 分别零 Persistence；issues 与底层直接输出深等（message/path/数量/顺序 verbatim）；内嵌 issues 可含键、路径、正则或 XML 值摘录，整体不做 sentinel 负锁 |
| duplicate | active、lease-zero 临时态、concurrent FIFO、persisted `DocDuplicateError` 全为 ALREADY_EXISTS；双 create 以 deferred gate 固定先后，第二个 zero createDocument 调用；从不 load/open/upsert |
| persistence | operational、duplicate、fatal false/true、unknown throw 映射表；observer exact cause；unknown locked committed false |
| runtime post-commit | createDoc resolved→factory throw→release 恰一次且 never-settle 不阻塞；文档保留、entries 零残留、后续 open 仍得 lease、fatal committed true |
| ordering | createDoc gate 挂起期同 key open 必排队、异 key 可同时到达 Persistence；create→open、open→create 按接纳顺序；create 成功后 open 复用同一 Runtime identity；每 promise 独立结算、失败后 tail 继续 |
| Clock | omitted/null/non-object/now-nonfunction 构造期同步固定 TypeError；now throw/NaN/Infinity/out-of-range fatal false、零 Persistence；每通过 payload+duplicate gate 的 create slot 恰读一次，payload failure/duplicate 不读 |
| acceptance | 本切片 acceptance 恒 running，`shutting-down` 的“零输入访问”不可达且不作伪测试；#112 接管该可达注入/验收 |
| closing fail-closed | 用包内 `testEntries` 注入：missing `closePromise`、await reject、await 后仍 closing 三变体均 observer 收 lifecycle-slot-failed(create) 且 lifecycle-slot-internal false fatal、零 payload/Clock/Persistence；await 后 active→ALREADY_EXISTS，undefined→继续 |
| initial-doc seam | seam 直调三分支：畸形 envelope、畸形 META → `input-invalid` 单 issue path=[]；手造 derived → `pre-commit-internal,false` fatal；ROOT validate/build → `root-invalid` verbatim。另测 fresh-map 初始空置、afterTransaction=1、SCHEMA/META/ROOT observer 篡改 committed:true fatal；Registry 收到 injected `input-invalid` 必 create-document-internal false fatal |
| seam/surface | observer isolation及 open 旧事件不变、create operation 精确；testing Clock/create factory、compiler API d.ts emitted-text leak audit（含反向 fixture）、doc-runtime public seam surface、模块边界、Node20/24 asyncDispose 既有锚 |

最终实施门禁：全量 typecheck/test 与 Node 20/24 CI。

## §10. 12 条 AC 映射表

| AC | 设计 | 验证 |
|---|---|---|
| 1 输入与 ROOT | §3-§5 | payload/input tests |
| 2 slot-start snapshot | §4-§5 | mutation timing |
| 3 identity zero access | §4 | hostile identity |
| 4 Clock/META | §6 | manual/invalid Clock |
| 5 私有 create-document | §6 | transaction/document tests |
| 6 no partial/no Persistence | §6-§7 | domain failures |
| 7 duplicate | §5/§7 | four duplicates |
| 8 Persistence mapping | §7 | typed/unknown table |
| 9 normal P0 Runtime | §5 | factory/P0 assertion |
| 10 post-commit failure | §7 | release/recovery |
| 11 ordering/concurrency | §5/§9 | deferred matrix |
| 12 CI | §9 | typecheck/test Node20/24 |

## §11. 已执行裁决与剩余风险

- **DQ-1** 最小 identity 接纳、冻结 identity 与槽内 payload snapshot；明确 Proxy trap 可能执行且仅保证 catch/isolation，不宣称可拒绝 Proxy。
- **DQ-2** `createInitialDocument` 自持 `new Y.Doc`，新增 `input-invalid`（envelope/META 直接调用方领域面）/`root-invalid`/DerivedInvariant fatal 的两级边界；Registry 的 input-invalid 结构性不可达并 fail-loud；fresh-map 空置、单 transaction 与三组写后核验齐全。
- **DQ-3** Clock 必需、payload snapshot 后 compile 前读一次，形状 gate 为固定 TypeError，非法读数 fatal false；拒绝 fallback。
- **DQ-4** `readonly unknown[]` verbatim 完整 issues；内嵌诊断是零回显边界的明确例外。
- **DQ-5** 四来源 duplicate 同码，拒绝 create-as-open。
- **DQ-6** typed operational 狭窄，unknown fatal 为 committed false；不合规 post-commit unknown 的残留恢复路径是 retry→ALREADY_EXISTS。
- **DQ-7** post-create factory fatal true，release fire-and-forget、entry 结构性不存在且 never-settle 后 open 可恢复。
- **DQ-8** create observer/testing seam/type-only export 增量冻结，并审计 observer consumers/d.ts emitted text。
- **DQ-9** deferred/microtask 全覆盖，无真实时间；shutdown acceptance 留 #112。

**剩余风险：**生产/testing Clock 必需化是显式 source-breaking 迁移，所有 caller 必须注入 manual/production Clock；不合规 adapter 若 post-commit unknown throw 会被诚实按契约 breach 记为 false，retry duplicate 是唯一恢复方式。open 的既有 `phase==='closing'` 分支在 `closePromise===undefined` 时仍会静默坠落；本票按约束不改 open，#112 必须以同一 fail-loud 规则统一收敛。

**CI 存在性门禁：**`ci.yml` 的 Node 20/24 矩阵 `pnpm test` 已全量覆盖本票新测试文件。按仓库惯例，仅 persistence/vfsl/materialize-root 三个历史关键契约文件有显式 `--passWithNoTests=false` 存在性门禁；本票不为 registry-create 新增此类配置门禁，§12 的配置 DENY 不变。建议后续硬化票统一评估，而非在本票局部扩大 CI 配置范围。

## §12. 文件清单（File Scope）

### ALLOW LIST

- `packages/namespace-registry/src/registry.ts` — 修改；§4-§8 create slot、Clock、失败映射及仅包内 closing 红灯 `testEntries` any-bridge 注入（约 225 行）。
- `packages/namespace-registry/src/types.ts` — 修改；§3 公共 create union/message/options（约 110 行）。
- `packages/namespace-registry/src/identity.ts` — 修改；§4 create 最小接纳 identity helper（约 70 行）。
- `packages/namespace-registry/src/create-document.ts` — 新建；§6 私有 compile→doc-runtime 编排（约 120 行）。
- `packages/namespace-registry/src/observer.ts` — 修改；§8 create events（约 25 行）。
- `packages/namespace-registry/src/testing.ts` — 修改；§8 Clock/createDocumentFactory seam（约 55 行）。
- `packages/namespace-registry/src/index.ts` — 修改；§2/§3 type-only create exports（约 15 行）。
- `packages/namespace-registry/src/errors.ts` — 修改；§7 create fatal type operation continuity（约 10 行）。
- `packages/namespace-registry/package.json` — 修改；§2 Clock/doc-runtime dependencies（约 4 行）。
- `packages/namespace-registry/test/registry-create.test.ts` — 新建，[SA6 owned] §9 create red/acceptance matrix。
- `packages/namespace-registry/test/registry-open.test.ts` — 修改，[SA6 owned] §9 open/create ordering and recovery regression。
- `packages/namespace-registry/test/registry-surface.test.ts` — 修改，[SA6 owned] §8/§9 exports/declaration audit。
- `packages/namespace-registry/test/helpers/registry-seam-audit.ts` — 修改，[SA6 owned] §8 boundary allow/deny assertions。
- `packages/doc-runtime/src/create-initial-document.ts` — 新建；§6 detached build/one transaction/verification seam（约 230 行）。
- `packages/doc-runtime/src/index.ts` — 修改；§2 public seam export（约 10 行）。
- `packages/doc-runtime/test/create-initial-document.test.ts` — 新建，[SA6 owned] §6/§9 initial document seam tests。
- `packages/doc-runtime/test/doc-runtime-surface.test.ts` — 修改，[SA6 owned] §8/§9 public `createInitialDocument` export 与其合法 Y.Doc declaration surface 审计。
- `packages/doc-runtime/package.json` — 修改；如 package export/typecheck declaration needs seam registration（约 2 行）。
- `wiki/raw/task_namespace-registry-create_design.md` — 新建；本冻结设计。

### DENY LIST

- `packages/persistence/**` — typed create errors/contract 已冻结，只消费。
- `packages/namespace-runtime/src/**`、`packages/namespace-runtime/test/**` — P0 internal factory 与既有 seam audit 不改变。
- `packages/clock/**` — Clock contract 已提供，仅作为 dependency 消费。
- `packages/dsh-persistence/**` — 无 adapter/Cordis 改动。
- `docs/**`、`CONTEXT.md` — 权威资料只读。
- 根 `package.json` — 当前 typecheck 链已涵盖 package；若实际发现遗漏，须总控显式扩域。
- 各类配置文件（`vitest.config.ts`、tsconfig、workspace）— 不需调整。

## §13. 协议假设依据 (Protocol Assumption Evidence)

无协议级假设：本设计仅涉及同进程 TypeScript、Yjs 文档、Promise FIFO 与 package exports；不约定 HTTP/WS 路径、端口、进程启动、跨 job 资源或第三方服务响应。

## §14. 契约改动连锁审计 (Contract Change Caller Audit)

### 改动函数

| 函数 | 文件 | 改动前契约 | 改动后契约 |
|---|---|---|---|
| `NamespaceRegistry.create` | `packages/namespace-registry/src/types.ts` | `Promise<RegistryOperationUnavailableIssue>` | `Promise<CreateNamespaceResult>`，新增 branded fatal reject 路径 |
| `createNamespaceRegistry` | `packages/namespace-registry/src/registry.ts` | options 可省、无 Clock | `options.clock` 必需，构造期可能 throw |

### Caller 清单

设计期实测命令：`git grep -n -E 'createNamespaceRegistry|createNamespaceRegistryForTesting' -- packages apps domains tests`（exit 0）。无生产 `createNamespaceRegistry(...)` 调用；测试调用全为 testing factory。`create` 的唯一实现调用点是 `registry.ts:324` 占位，改为 §5 后可能 branded reject；新的 create tests 必须 `await`/`rejects`，不得 fire-and-forget。

| Caller 分组（全量行号） | 是否 await | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---:|---:|---:|---|
| 实现：`packages/namespace-registry/src/registry.ts:324` | 是 | slot 内分流 | Promise caller | 替换为 §5 实现，typed fatal 仅 reject 给直接 create caller。 |
| dispose：`registry-node-dispose.test.ts:82` | N/A（构造） | N/A | Vitest | `{}` 改为显式 manual Clock。 |
| open test：`registry-open.test.ts:180,254,277,310,327,351,370,388,406,444,470,496,520,536,558,591,630,665,719,764,794,813,852,862,908,924,988,1002,1026,1049,1126,1182` | N/A（构造） | N/A | Vitest | 每一处 override 合并 `clock: manualClock`；所有 `{}` 变 `{ clock: manualClock }`，有 observer/runtimeFactory 的 object 同样加 clock。 |
| surface：`registry-surface.test.ts:54,67,76,78` | N/A（仅 export 文本） | N/A | Vitest | 不构造 Registry；更新 testing override declaration/surface expectations。 |
| factory definitions/reexports：`src/registry.ts:341`、`src/testing.ts:28`、`src/index.ts:9` | N/A | N/A | N/A | 非 caller；更新签名和 type-only exports。 |

迁移规则：测试新增单一 `manualClock` helper（固定 ms/counter），每一个 testing factory 调用显式注入；生产未来调用必须注入 Host Clock。构造期 Clock gate 的固定 TypeError 见 §8。此表替代任何“超过 10 caller 暂停”规则。

### create 签名替换的 rejection 风险

旧 `create(input:unknown)` 恒 resolve unavailable；新 `create(input:CreateNamespaceInput)` 可 resolve domain union 或 reject `NamespaceRegistryFatalError`。当前基线无外部 create caller；新增/未来 caller 必须 await，并对 fatal 采用明确上层 error policy，不能把 rejection 当作 `CreateNamespaceIssue`。测试分别断言 resolve union 与 `rejects` branded fatal，防止未处理 rejection。

## SA2 反馈逐条回应

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|---|:--:|---|---|
| R1 HIGH-1 / DQ-4 verbatim issues | ✅ | §3、§7、§9、§11 | 改为 `readonly unknown[]`，完整 issue 原对象逐字透传；删除 sanitize 和错误零回显主张。 |
| R1 HIGH-2 / DQ-6 unknown false | ✅ | §5、§7、§9、§11 | unknown createDoc throw 改 branded fatal `committed:false`；写明 duplicate 自愈、disposed/META pre-commit 证据及不合规 post-commit 残留。 |
| R1 HIGH-3 / Proxy 诚实措辞 | ✅ | §1、§4、§9、§11 | 明确 JS 元操作会触 Proxy trap，只保证 catch→窄 issue 与副作用隔离；删除“拒 Proxy trap”暗示。 |
| R1 MEDIUM-4 closing | ✅ | §5 | 伪码镜像 open 的 `closing && closePromise!==undefined` 双条件守卫、await 后 recheck；标注本票不可达，#112 接管后续态。 |
| R1 MEDIUM-5 initial seam | ✅ | §6、§9 | fresh map 空置断言；`transactGuarded` 单 transaction；SCHEMA/META/ROOT verifier；fatal 三相按 `fatal.ts`；afterTransaction/observer tests。 |
| R1 MEDIUM-6 recovery | ✅ | §7、§9 | 写明 release 同步摘挂与 live-cell/snapshot 恢复，新增 never-settle release 后 open lease 红灯。 |
| R1 MEDIUM-7 Clock migration | ✅ | §8、§9、§14 | 实测 grep 全量 caller 分组与行号；所有 testing 调用 explicit manual Clock；固定构造期 TypeError。 |
| R1 MEDIUM-8 matrix gaps | ✅ | §9 | 加 acceptance #112 边界、gated same/different key、reuse identity、double-create zero factory、Clock count、afterTransaction 方法。 |
| R1 MINOR-9 observer consumers | ✅ | §8、§9 | 增 grep 审计与 open event compatibility/migration 规则。 |
| R1 MINOR-10 d.ts | ✅ | §8、§9、§12 | Compiler API 实 emit 递归文本断言、反向 fixture；doc-runtime 自身合法 Y.Doc surface 另测。 |
| R1 新攻击面 1 create rejection | ✅ | §14 | 新增签名替换与 fatal rejection 风险及 caller 处置。 |
| R1 新攻击面 2 doc-runtime surface | ✅ | §8、§9、§12 | 增 doc-runtime surface test 至 ALLOW。 |
| R1 新攻击面 3 Proxy | ✅ | §1、§4、§9 | 同 HIGH-3，以攻击用例锁定 trap 事实与 slot isolation。 |
| R2-H1 initial-doc 两级边界 | ✅ | §5、§6、§7、§9、§11 | seam 新增 `input-invalid`/`root-invalid`/DerivedInvariant fatal 三分支；Registry input-invalid 不可达即 create-document-internal false fatal。 |
| R2-M1 closing 缺 promise fail-loud | ✅ | §5、§7、§9、§11 | create closing 无 `closePromise` 改 observer+ lifecycle fatal false、零后续访问；登记 open 既有残留由 #112 收敛。 |

## SA4 发现落点

| SA4 发现 | 落点 | 处理 |
|---|---|---|
| MINOR-4：closing 红灯注入治理 | §8、§12 | 冻结包内 `testEntries` test-only shape；不经任何 public export，仅服务 closing 分支红灯。 |
| HIGH-1：close 后三态闭环 | §5、§7、§9 | await reject、after active/undefined/仍 closing 均有精确分流；仍 closing fail-closed，不建 loop。 |
| CI 存在性门禁 | §11 | 记录 Node20/24 全量 pnpm test 覆盖、历史显式门禁范围与本票不改配置的理由。 |
