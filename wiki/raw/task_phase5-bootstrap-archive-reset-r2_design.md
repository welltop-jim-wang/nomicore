# 冻结设计 R2 — issue #133「Phase 5: bootstrap import, archive, and guarded replica reset」

- **任务**：功能开发修订轮（round=2）
- **基线**：round-1 close-out `6784645`；本设计只处理 R2-AC-1..R2-AC-6。
- **权威约束**：ADR-0006、ADR-0008、ADR-0009、ADR-0010；`task_phase5-bootstrap-archive-reset-r2_relevant_decisions.md` 是决议摘录，非规范替代品。
- **冻结结论（R2-R2 修订）**：选择 **严格直读双真相源 preflight + Runtime-sequencer reset fence**；reset 在 fence 槽内验证 live 与 persisted identity，并在同一槽内原子 arm closing；fence 槽先结算，随后才创建 close barrier，严格排除 self-wait。`importReplica` 采用 SA6 临时契约冻结的第四参数 `expectedReplicationIdentity`。

---

## §1 需求与根因推演

### 1.1 round-1 缺口

`runResetSlot` 当前顺序是 owner/capability → forceRelease/close → `loadDoc` 探针 → `archiveDoc(expected)`。因此 archive 的持久层身份守卫虽然能拒绝 mismatch，却发生在 Runtime generation 和全部 lease 已被破坏之后，违反 R2-AC-1。

`runImportSlot` 目前只在 `importDoc` ownership transfer 前校验 `META.docId` 与复制事实格式；它没有任何 Hub 广告 expected identity 输入，因而格式正确但 lineage/epoch 错误的文档可被接管，违反 R2-AC-3/4。

### 1.2 本轮不可破坏的不变量

1. ADR-0008：dirty notification 不是 durable；同 namespace 的 Runtime 写仍由唯一 FIFO sequencer 管理；`close()` 仍排空已经接纳的写。
2. ADR-0009：Registry 同 key carrier FIFO、owner mismatch → `NAMESPACE_NOT_FOUND`、仅旧 generation 可清理自身。
3. round-1：`archiveDoc` 仍负责 close 之后的 archive settle/guard/read/relocate；`saveDoc` 的 dirty-notification 语义、owner 分区、全量 snapshot、File tmp→rename 提交语义不变。
4. 失败前置检查不得静默降级：无法可靠读 live/persisted identity 是实现/持久化错误，必须 loud failure 或既有 `NAMESPACE_LOAD_FAILED`，绝不可把未知当作匹配。

---

## §2 决策总表

| ID | 冻结决策 |
|---|---|
| R2-D1 | reset 使用严格直读：live 与 persisted 都必须在非破坏性 preflight 中等于 expected；任一不等/disabled 返回既有 `NAMESPACE_RESET_IDENTITY_MISMATCH`，零 forceRelease/close/archive。损坏或 probe abort 是 loud fatal，非 mismatch。 |
| R2-D2 | persisted 读取通过 Persistence 内部 `readPersistedReplicationIdentity(owner, namespaceId)` trusted-snapshot probe 实现（不是 cache-hit `loadDoc`）；不签 handle、不调用 `saveDoc`、不得 advance scheduler、不得等待/触发 flush。 |
| R2-D3 | live identity 由 current active Runtime 的受控 reset-fence 槽读取；只接受 `{state:'enabled', replicationId, replicationEpoch}`。disabled 不匹配；异常状态不降级为 persisted-only。 |
| R2-D4（R1/R2 修订） | reset 成功路径冻结为：owner → capability → closing re-evaluation → Runtime **reset-fence 槽内** live/persisted preflight + synchronous closing arm → fence task 结算后 close drain → archive → bootstrap eligibility。fence slot 是线性化点；close barrier 不得包含/等待当前 fence task。 |
| R2-D4a（R1/R2 新增） | Runtime 增加最窄 internal `beginResetFence(expected, readPersisted)` capability：同一 Runtime FIFO 槽内先完成双源核验，再同步转换为 closing；槽后 lazy continuation 才创建 close barrier。已在槽之前接纳的 enable/bump 必先结算并参与核验，之后写被 close lifecycle gate 拒绝。 |
| R2-D5 | `importReplica(owner, namespaceId, doc, expectedReplicationIdentity)` 为公共 API；在 round-1 既有 `docId`、格式/在场性谓词之后、capability/`importDoc` 之前做 exact equality；错误码冻结为 `NAMESPACE_IMPORT_EXPECTED_IDENTITY_MISMATCH`。 |
| R2-D6 | 不将 Hub 广告 equality 下沉为 Persistence 的通用 importDoc 契约：ownership transfer 之前由 Registry 受信 bootstrap 编排验证；Persistence 仍只验证 `META.docId`，保持 ADR-0006 的层次边界。 |
| R2-D7 | ADR-0006/0010 追加明确 scope/取代条款的修订段；未明示条款继续有效。 |

---

## §3 resetReplica：严格直读身份 preflight

### 3.1 口径裁决：严格直读，而非排空后核对

冻结为 SA6 Flag 1 的**严格口径**：

```text
live identity == expected  AND  persisted committed snapshot identity == expected
```

二者均真才可进入 destructive phase。此裁决的原因：

- R2-AC-1 的“live/persisted identity 对 expected 核对；不匹配即拒绝”直接要求双边验证；
- dirty identity 的 live 与 persisted 有意可能不同（ADR-0008），排空后才读取 persisted 会把 preflight 变成 close 的副作用，并使 dirty epoch 2 / persisted epoch 1 / expected epoch 2 情形错误成功；
- 严格直读使两个 dirty race 都在 close 前拒绝，且拒绝路径不改变 store bytes、scheduler、entry、lease 或 Runtime。

因此 SA6 的竞态 B 保持“拒绝 + 零破坏”断言，**不回流改为成功断言**。

### 3.2 identity 判定函数与 reset 输入分类取代关系

新增 Registry 私有纯函数（不导出）：

```ts
type CheckedReplicationIdentity =
  | Readonly<{ ok: true; value: ReplicationIdentityRef }>
  | Readonly<{ ok: false }>;

function identityEquals(
  actual: CheckedReplicationIdentity,
  expected: ReplicationIdentityRef,
): boolean {
  return actual.ok
    && actual.value.replicationId === expected.replicationId
    && actual.value.replicationEpoch === expected.replicationEpoch;
}
```

- **live**：从当前 entry Runtime 的 `getStatus().replication` 映射为上述 checked type。`disabled` → `{ok:false}`；有 enabled 但值不合规是 Runtime 已应在构造期拒绝的 integrity bug，必须 throw Registry fatal，不能被转换成“匹配”。
- **persisted**：从 §3.3 的 trusted committed-snapshot probe 所解码的 detached snapshot，按现有 `readImportedReplicaFacts` 同一判据族读取 META：双键均在且格式合规才 ok；双键缺失、单键、显式 undefined、异型 META、非法 ID/epoch 均为 `{ok:false}`，最终映射 reset mismatch，避免泄露值。
- expected 参数安全快照/格式验证由 §3.6（R4）权威规定。此前“沿既有 `NAMESPACE_INVALID_IDENTITY` 语义处理 reset expected 格式错误”的模糊表述**作废**；它不得解释为扩宽 `InvalidIdentityIssue.field`。

### 3.3 persisted probe seam 与正确性

不能直接用 `loadDoc` 读取 persisted identity：它在 cache hit 时会签发指向**同一 live Y.Doc** 的独立 handle；dirty epoch 2 / store epoch 1 时将读到 epoch 2，不能作为 R2-AC-2 所称的 persisted 真相源。故冻结为新增**只读 committed-snapshot identity probe**，但不新增 `DocPersistence` 公共面。

```ts
// Persistence 内部 / ReplicaPersistence capability；不签发 handle，不进入 live cell
readPersistedReplicationIdentity(
  owner: User,
  docId: string,
): Promise<CheckedReplicationIdentity | 'missing'>
```

它使用既有 owner 分区 key 与 `PersistenceIO.read(key, signal)`，在 detached temporary `Y.Doc` 解码完整快照后验证 `META.docId`，再按 `readImportedReplicaFacts` 同一判据族读取 replication facts。它不建 live cell、不签 handle、不调用 `saveDoc`、不排空 dirty、不创建 claim、不写/flush/archive。

正确性边界：

- 该 probe 的读路径就是 adapter 信任的 committed primary snapshot，故 Memory hook-store 与 File `.snapshot` 都是持久化真相源；dirty live 状态绝不被伪称 durable。
- Memory/File 必实现；Registry 在任何 destructive action 前以 `typeof` capability gate 检查。缺失是 loud `NamespaceRegistryFatalError('reset','lifecycle-slot-internal',false,...)`，不能 fallback 到 live 或 `loadDoc`。
- read reject：若 `DocLoadOperationalError`，映射既有 `NAMESPACE_LOAD_FAILED`；若 dispose/epoch fatal，转 `NamespaceRegistryFatalError` committed:false；两者均在 destructive phase 前发生。
- no snapshot：entry 不存在时返回 `NAMESPACE_NOT_FOUND`；active entry 时是持久化完整性缺陷并 loud fatal；不得将 missing 当作 identity match。

`loadDoc` 仍用于 round-1 的 close 后存在性/restore 流程，但**不参与 R2 persisted preflight**。这样既复用现有 I/O/read abort/error discipline，又避免 cache-hit live alias 破坏严格双源语义。

> 实现说明：为避免公共接口扩张，`ReplicaPersistence` 的 required internal capability 可通过专用 exported type / testing factory wiring 暴露给 Registry，而 `DocPersistence` 本身不增加 required 方法。所有 Memory/File 和 R2 test stub 必须提供它；Registry capability gate 在任何 destructive action 前完成。

### 3.3.1 R1 补充：probe 完整契约与错误分类学

`readPersistedReplicationIdentity` 的公共可见返回/拒绝面冻结如下（内部 ReplicaPersistence capability；Registry 不解析原始 `Error.message`）：

```ts
type PersistedIdentityProbeResult =
  | Readonly<{ kind: 'found'; identity: CheckedReplicationIdentity }>
  | Readonly<{ kind: 'missing' }>;

class DocPersistedIdentityProbeOperationalError extends Error {
  readonly code = 'DOC_PERSISTED_IDENTITY_PROBE_OPERATIONAL';
  readonly committed = false as const;
}
class DocPersistedIdentityProbeCorruptError extends Error {
  readonly code = 'DOC_PERSISTED_IDENTITY_PROBE_CORRUPT';
  readonly committed = false as const;
}
class DocPersistedIdentityProbeFatalError extends Error {
  readonly code = 'DOC_PERSISTED_IDENTITY_PROBE_FATAL';
  readonly committed = false as const;
  readonly phase: 'read-aborted' | 'decode' | 'lifecycle-disposed' | 'adapter-violation';
}
```

| Probe condition | Persistence outcome | Registry reset outcome | Destructive side effects / leakage |
|---|---|---|---|
| Primary snapshot absent | `{kind:'missing'}` | no current entry → `NAMESPACE_NOT_FOUND`; current active entry → `NamespaceRegistryFatalError(reset, lifecycle-slot-internal, committed:false)` | none; stable fatal message, no owner/identity values |
| `io.read` rejects while current lifecycle epoch remains valid | `DocPersistedIdentityProbeOperationalError` | `NAMESPACE_LOAD_FAILED` | none; this is the sole ordinary operational mapping |
| `io.read` rejects due aborted signal / disposed epoch | `DocPersistedIdentityProbeFatalError('read-aborted'/'lifecycle-disposed')` | Registry fatal `committed:false` | none |
| bytes cannot decode as Yjs, META carrier invalid, or `META.docId !== requested docId` | `DocPersistedIdentityProbeCorruptError` | Registry fatal `committed:false` | none; never collapse corruption to mismatch or load-failed |
| replication keys absent/one-sided/undefined/format-invalid on otherwise decodable and docId-correct snapshot | `{kind:'found', identity:{ok:false}}` | `NAMESPACE_RESET_IDENTITY_MISMATCH` | none; this is a valid read proving no matching enabled replication identity |
| synchronous throw/non-Promise adapter behavior or impossible result shape | `DocPersistedIdentityProbeFatalError('adapter-violation')` | Registry fatal `committed:false` | none |

All probe errors carry stable constant messages without owner, namespace, expected, actual identity, bytes, or cause interpolation. Cause is preserved only as non-public `cause` for observer/internal diagnostics. `committed:false` is mandatory because this seam never writes or transfers ownership, satisfying INV-12.

### 3.4（R2-R2 修订）Runtime reset fence、closing re-evaluation 与冻结 reset 槽

```ts
// NamespaceRuntime internal capability; this is NOT a general Registry META reader.
// R2-R2 no-self-wait protocol: fence task samples while active, arms lifecycle synchronously,
// returns, and ONLY its post-settlement continuation starts close drain.
type ResetFenceResult =
  | { kind: 'mismatch' }
  | { kind: 'missing' }
  | { kind: 'armed'; startCloseAfterFence: () => Promise<void> };

function beginResetFence(
  expected: ReplicationIdentityRef,
  readPersisted: () => Promise<PersistedIdentityProbeResult>,
): Promise<ResetFenceResult> {
  const fenceTask = sequencer.enqueue(async () => {
    // All mutation tasks admitted before this task (including enable/bump) have settled first.
    // lifecycle is still ready while readPersisted awaits: mismatch/failure remains zero-destruction.
    const persisted = await readPersisted();
    const live = readLiveReplicationIdentityFromRuntime();
    if (persisted.kind === 'missing') return { kind: 'missing' } as const;
    if (!identityEquals(live, expected) || !identityEquals(persisted.identity, expected)) {
      return { kind: 'mismatch' } as const;
    }
    // Linearization point: synchronously flip to closing before this task returns.
    // DO NOT create or await a close barrier here.
    synchronouslyArmClosingWithoutBarrier();
    return { kind: 'armed' } as const;
  });

  // This continuation is registered by Runtime, but runs only after fenceTask settles and has
  // been removed from the sequencer's active work. It creates a close barrier whose predecessor
  // is the tail captured *after* fenceTask, hence it cannot contain/wait for fenceTask itself.
  return fenceTask.then((result) => {
    if (result.kind !== 'armed') return result;
    let started: Promise<void> | undefined;
    return {
      kind: 'armed',
      startCloseAfterFence: () => (started ??= enqueueCloseBarrierAfterSettledFence()),
    };
  });
}

async function runResetSlot(identity, expected): Promise<ResetReplicaResult> {
  // R1-A: reevaluate from the carrier slot rather than retaining a stale Entry reference.
  let current = entries.get(identity.key);
  if (current !== undefined && current.owner.userId !== identity.owner.userId) return NOT_FOUND_ISSUE;
  assertResetReplicaCapabilities(); // archive + committed probe + runtime reset fence; no side effects

  // R1-B closing generation: it was destructively transitioned by an earlier operation, not this reset.
  // Await its exact existing close promise, then restart this slot's lookup once; never use old runtime as evidence.
  if (current?.phase === 'closing') {
    try { await current.closePromise!; } catch (cause) { throw resetFatalFalse(cause); }
    current = entries.get(identity.key);
    if (current !== undefined && current.owner.userId !== identity.owner.userId) return NOT_FOUND_ISSUE;
    if (current?.phase === 'closing') throw resetFatalFalse(new Error('closing entry failed to settle'));
    try {
      const afterClose = await readPersisted(identity.owner, identity.namespaceId);
      if (afterClose.kind === 'missing') return NOT_FOUND_ISSUE;
      return RESET_FAILED_ISSUE;
    } catch (cause) { return mapProbeOrFenceFailureBeforeDestruction(cause); }
  }
  if (current === undefined) {
    try {
      const absentProbe = await readPersisted(identity.owner, identity.namespaceId);
      return absentProbe.kind === 'missing' ? NOT_FOUND_ISSUE : RESET_FAILED_ISSUE;
    } catch (cause) { return mapProbeOrFenceFailureBeforeDestruction(cause); }
  }

  let fence;
  try {
    fence = await current.runtime.beginResetFence(expected, () =>
      readPersisted(identity.owner, identity.namespaceId));
  } catch (cause) {
    return mapProbeOrFenceFailureBeforeDestruction(cause);
  }
  if (fence.kind === 'missing') throw resetFatalFalse(new Error('active entry missing committed snapshot'));
  if (fence.kind === 'mismatch') return RESET_IDENTITY_MISMATCH_ISSUE;

  forceReleaseOutstandingLeases(current);
  cancelIdleArm(current);
  let closePromise: Promise<void>;
  try { closePromise = fence.startCloseAfterFence(); await closePromise; }
  catch (cause) { throw resetFatalFalse(cause); }
  try {
    await archiveDoc(identity.owner, identity.namespaceId, expected);
  } catch (cause) {
    return mapArmedArchiveFailure(cause); // R2-R2 frozen table in §3.5.2
  }
  return Object.freeze({ ok: true });
}
```

**Closing result matrix (R1 freeze).** A reset that sees `closing` never uses that old Runtime as live evidence and never reports preflight success. It first awaits the exact `closePromise`, re-reads `entries.get(key)` from the carrier slot, then performs one non-destructive committed probe: missing → `NAMESPACE_NOT_FOUND`; primary still present → `NAMESPACE_RESET_FAILED`; read/corrupt/abort → §3.3.1 mapping. It makes **no** archive call. The R2 “lease/runtime remain usable” promise applies only to a reset that itself observes an `active` generation and is rejected by its fence before lifecycle transition; an already-closing generation was transitioned by an earlier operation and is explicitly not relabeled as this request’s zero-destruction rejection.

### 3.5（R2-R2 重写）Fence linearization、无自等待 close 协议与精确零破坏语义

`beginResetFence` is the required linearization mechanism, not merely a carrier-FIFO argument:

1. Runtime enqueues the fence into its existing unique FIFO write sequencer. Every enable/bump admitted before it settles before the fence reads live identity.
2. Inside that **same** FIFO task, the fence obtains the committed probe and the Runtime live projection while lifecycle remains ready. A mismatch or probe rejection leaves lifecycle/entry/lease/scheduler/store unchanged.
3. On match, the fence synchronously sets `closing`/stops public read-write admission **before returning**, but it neither creates nor awaits a close barrier.
4. Only after `fenceTask` has fulfilled and is no longer active in the sequencer does the returned `startCloseAfterFence()` lazily create the idempotent close promise. Its predecessor tail is captured after fence settlement, so the barrier can await prior admitted work but **cannot contain or await its own fence task**. The Registry starts and awaits it outside the fence task.
5. A subsequently attempted enable/bump sees closing and fails the existing lifecycle gate; it cannot insert between preflight and close. A close barrier drains only tasks admitted before the fence—and those tasks are represented in its sample.

**No-self-wait proof**: dependency edges are `fenceTask → readPersisted` while lifecycle is ready; after fulfillment, `startCloseAfterFence → predecessorTail`. There is deliberately no edge `fenceTask → closePromise`, and predecessorTail is acquired only after fenceTask has settled, so it cannot have edge `closePromise → fenceTask`. The graph is acyclic. If `readPersisted` hangs, it is an external I/O liveness failure while lifecycle remains ready—not a reset/close mutual wait—and existing I/O/dispose error mechanics remain responsible. Ordinary `close()` remains idempotent: if it observes a fence-armed closing state it returns the single lazily-created close promise; no public operation can start a second barrier. FIFO, no timeout, and “previously admitted tasks drain unconditionally” remain intact.

**Testable exact semantics**: `R2-AC-1` zero-destruction applies to every fence result `mismatch`, every probe operational/corrupt/fatal result, and every capability/input failure while the target was active: `forceReleaseOutstandingLeases`, `cancelIdleArm`, close admission, archive call, scheduler advance, and primary bytes are all unchanged. A fence `armed` is the single success linearization point; after it, close/archive consequences are a successful reset attempt or a later operational/committed fatal, not a domain identity mismatch.

### 3.5.1 R2-R2：Runtime capability reachable path and loud gate

`beginResetFence` is **not** exported by `@nomicore/namespace-runtime` public barrel and must not appear in Registry’s public declaration graph. It is injected into `createNamespaceRegistryInternal` through the existing Registry-only runtime factory/testing seam as a non-public structural capability (`RuntimeForRegistry`), implemented by `createNamespaceRuntimeForRegistry` in an internal Registry-only module. Production composition passes the real internal factory; test factories either implement the capability or intentionally omit it to test the gate. No Registry source imports a Runtime package internal subpath.

Before owner-side close/lease/archive work, Registry performs:

```ts
const fence = current?.runtime.beginResetFence;
if (current !== undefined && typeof fence !== 'function') {
  throw new NamespaceRegistryFatalError('reset', 'lifecycle-slot-internal', false,
    new Error('Registry Runtime 缺少受控 reset fence capability'));
}
```

This gate is after owner/identity validation but before any persisted probe invocation, force-release, close admission, or archive call. It is the only allowed handling of a missing capability: no property-call `TypeError`, no fallback to status polling/carrier FIFO, and no normal domain result. The fatal message is constant/no identity echo. Add a Registry internal-surface type test proving (a) public Runtime barrel keys and Registry public d.ts remain unchanged, (b) real production factory satisfies `RuntimeForRegistry`, and (c) legacy fake lacking the method follows this stable committed:false fatal path.

### 3.5.2 R2-R2：armed-only archive typed-error matrix

Once `armed`, closing has already occurred; `mapArmedArchiveFailure` is mandatory and replaces round-1’s generic archive mapping for this branch:

| `archiveDoc` rejection | `mapArmedArchiveFailure` result | Rationale |
|---|---|---|
| `DOC_ARCHIVE_IDENTITY_MISMATCH` | `NAMESPACE_RESET_FAILED` | external/cross-instance post-fence divergence or violated invariant; never report preflight mismatch after destructive arm |
| `DOC_ARCHIVE_ACTIVE_HANDLE` | `NAMESPACE_RESET_FAILED` | active external handle after local close; destructive transition already occurred |
| `DOC_ARCHIVE_DUPLICATE` | `NAMESPACE_RESET_FAILED` | primary disappeared after arm; no longer ordinary preflight absence |
| `DOC_ARCHIVE_OPERATIONAL` | `NAMESPACE_RESET_FAILED` | ordinary archive I/O failure remains a domain operational result but is not identity mismatch |
| `DOC_ARCHIVE_FATAL` | `NamespaceRegistryFatalError('reset','lifecycle-slot-internal', committedOf(cause), cause)` | committed truth propagates exactly; especially relocate-remove=true |
| unknown/adapter violation | `NamespaceRegistryFatalError('reset','lifecycle-slot-internal', false, cause)` | no committed evidence may be invented |

The observer records a distinct `reset-archive-after-arm-failed` event with stable operation metadata; it does not include identity contents. Tests inject each typed path after fence arm, particularly external identity mutation and relocate-remove failure, and assert none returns `NAMESPACE_RESET_IDENTITY_MISMATCH`.

- Degraded I/O never falls back to live-only: only `DocPersistedIdentityProbeOperationalError` yields `NAMESPACE_LOAD_FAILED`; normal retry stays its owner.
- `archiveDoc` settles dirty state only after fence arm. Hence SA6 dirty race A/B mismatch still performs no forced flush; matching reset can legitimately close and settle.
- This adds a narrow `packages/namespace-runtime/src/{runtime.ts,close.ts,types.ts}` internal/reset capability implementation but does not expose any general META read/write API or alter ordinary sequencer semantics.

### 3.6（R4 修订）reset expectedLocalIdentity 专属输入分类学（方案 B）

> **R4 取代关系**：本节取代本设计此前针对 `resetReplica` 的 expected 输入格式失败“沿既有 `NAMESPACE_INVALID_IDENTITY` 语义处理”的任何表述。它不改变 owner/namespace identity 的既有语义，也不改变合法 expected 后的严格双源 mismatch 语义。

#### 3.6.1 公开类型与稳定词汇冻结

`InvalidIdentityIssue` 恢复并永久保持 round-1 冻结的二元 shape：

```ts
export interface InvalidIdentityIssue {
  readonly ok: false;
  readonly code: 'NAMESPACE_INVALID_IDENTITY';
  readonly field: 'owner.userId' | 'namespaceId';
  readonly message: typeof NAMESPACE_INVALID_IDENTITY_MESSAGE;
}
```

不得把 `'expectedLocalIdentity'` 加入该共享 `field` 联合。该接口经 `OpenNamespaceIssue`、`CreateNamespaceIssue`、`ImportReplicaIssue`、`ResetReplicaIssue` 到达公共声明图；R4 对它是**回退到既有冻结形状**，不是一次可被“当前无 consumer”豁免的公共契约扩宽。

新增仅属于 `ResetReplicaIssue` 的 append-only 成员，**无 `field`**：

```ts
export const NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID_MESSAGE =
  'NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID: 期望本地复制身份（reset expectedLocalIdentity）不符合安全文法';

type ResetExpectedIdentityInvalidIssue = Readonly<{
  ok: false;
  code: 'NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID';
  message: typeof NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID_MESSAGE;
}>;

export type ResetReplicaIssue =
  | InvalidIdentityIssue
  | RegistryNotAcceptingIssue
  | /* existing reset issue members */
  | ResetExpectedIdentityInvalidIssue;
```

该常量是 `types.ts` 中单一真相源；零插值、零 expected/owner/namespace/actual identity 值回显。它不经 Registry 主入口新增值导出；既有 `ResetReplicaIssue`/`ResetReplicaResult` type alias 已从公开入口可达，故 append-only member 自动随 result alias 可见。包内测试若需锁 message 常量，使用既有先例的相对 `../src/types.js` 导入，不扩大 barrel。

#### 3.6.2 三码边界与入口次序

| 结果 code | 唯一触发条件 | Persistence / carrier / doc 行为 |
|---|---|---|
| `NAMESPACE_INVALID_IDENTITY` | owner 或 namespaceId 未通过既有 `validateOpenIdentity` | 零 expected snapshot、零 carrier、零 entry、零 Persistence/doc；field 仅为 `owner.userId` 或 `namespaceId` |
| `NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID` | owner/namespace 已合法，但 `snapshotReplicationIdentityRef(expectedLocalIdentity)` 失败（null/undefined/array/function/getter 或 Proxy throw/继承属性/非严格对象/非法 ID/非法 epoch） | 零 carrier、零 entry、零 Runtime fence、零 persisted probe、零 archive、零 doc 触达 |
| `NAMESPACE_RESET_IDENTITY_MISMATCH` | expected 合法但 live 或 persisted 任一 `identityEquals` 为 false（含该侧 disabled、身份不合规、值不等） | 经 active Runtime fence 的已核验结果；仍在 forceRelease/close/archive 前拒绝、零破坏 |

公共入口的冻结次序不变：

```ts
function resetReplica(owner: unknown, namespaceId: unknown, expectedLocalIdentity: unknown) {
  if (acceptance !== 'running') return Promise.resolve(NOT_ACCEPTING_ISSUE);
  const outcome = validateOpenIdentity(owner, namespaceId);
  if (!outcome.ok) return Promise.resolve(outcome.issue);

  const snapshot = snapshotReplicationIdentityRef(expectedLocalIdentity);
  if (!snapshot.ok) return Promise.resolve(RESET_EXPECTED_IDENTITY_INVALID_ISSUE);

  return admitResetSlot(outcome.identity, snapshot.value);
}
```

此处 `snapshotReplicationIdentityRef` 继续负责收编 getter/Proxy trap，产生只包含 primitives 的冻结 snapshot；它必须在任何 carrier 创建、entry 查询、Runtime capability/probe、Persistence、archive 或 doc 读取之前完成。正确 expected 的后续重试仍按既有路径第一次调用 probe，不被失败调用污染。

#### 3.6.3 测试锚与标准轴清理授权

R4 测试锚（不得用仅 code 的弱断言替代）：

1. R-FIX-1 的 16 个 hostile expected 形态逐项对返回值做完整 `toEqual`：
   ```ts
   {
     ok: false,
     code: 'NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID',
     message: NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID_MESSAGE,
   }
   ```
   完整深等同时保证没有遗留/新增 `field`。每形态保留 `probeCalls=[]`、`archiveCalls=[]`、原 lease `active`、Runtime `ready`/可读和正确 expected 后重试成功（首次 probe 计数为 1）。
2. 保留 mutable expected 的 TOCTOU 冻结样本：调用后改写原对象，成功 archive/fence 使用调用时 `{replicationId, replicationEpoch}` primitive snapshot。
3. 追加 `*.test-d.ts` 公开 alias 类型锚：
   - `Extract<OpenNamespaceIssue, {code:'NAMESPACE_INVALID_IDENTITY'}>['field']` 与同一模式的 `CreateNamespaceIssue`、`ImportReplicaIssue`、`ResetReplicaIssue` 均严格等于 `'owner.userId' | 'namespaceId'`；
   - `Extract<ResetReplicaIssue, {code:'NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID'}>` 非 `never`，且其 keys 不含 `field`。
4. owner/namespace 各自非法的既有锚保持旧 `NAMESPACE_INVALID_IDENTITY`、旧 message 与正确二元 field，防专属 reset code 劫持上游 identity 分类。
5. F-1 observer 用例的 `it` 标题/说明改为**“cause 零身份值回显”**；只验证 cause 不含 `ID_A`/namespace/owner 等敏感值。事件标准 `identity` 字段及断言体不改，不误称整个 event payload 不含受控 identity。

R4 同轮标准轴（非阻断、不得扩大语义）授权：

- **F-2**：`packages/namespace-registry/src/registry.ts` 中悬空 `beginCloseCurrent` 注释引用改为现行 fence/lazy-close 实现名称；只修注释，不改变 close 行为。
- **F-4**：`packages/namespace-registry/test/registry-phase5-bootstrap-reset-r2-red.test.ts` 头注中“`NAMESPACE_IMPORT_EXPECTED_IDENTITY_MISMATCH` 临时拼写，待 SA1 冻结”更新为“已由 R2/R3 设计冻结”；不改测试断言或行为。

---

## §4 importReplica：Hub advertisement binding

### 4.1 Public contract and error classification

Freeze the SA6 temporary signature and spelling:

```ts
importReplica(
  owner: NamespaceOwner,
  namespaceId: string,
  doc: YjsDoc,
  expectedReplicationIdentity: ReplicationIdentityRef,
): Promise<ImportReplicaResult>
```

Add a stable Registry message constant and union member:

```ts
export const NAMESPACE_IMPORT_EXPECTED_IDENTITY_MISMATCH_MESSAGE =
  'NAMESPACE_IMPORT_EXPECTED_IDENTITY_MISMATCH: 导入文档复制身份与 Hub 广告身份不一致';
```

Existing meanings stay disjoint: `NAMESPACE_IMPORT_IDENTITY_MISMATCH` is docId mismatch; `NAMESPACE_IMPORT_INVALID_IDENTITY` is invalid/disabled document facts; `NAMESPACE_IMPORT_EXPECTED_IDENTITY_MISMATCH` is valid facts different from the expected Hub advertisement.

### 4.2 Frozen import order

```ts
async function runImportSlot(identity, docRef, expected): Promise<ImportReplicaResult> {
  // ① owner-first entry collision: NOT_FOUND / ALREADY_EXISTS unchanged
  // ②a META.docId exact match, else IMPORT_IDENTITY_MISMATCH
  // ②b facts format/enabled check, else IMPORT_INVALID_IDENTITY
  const facts = readImportedReplicaFacts(docRef);
  // ②c NEW: exact external Hub advertisement binding
  if (facts.replicationId !== expected.replicationId ||
      facts.replicationEpoch !== expected.replicationEpoch) {
    return IMPORT_EXPECTED_IDENTITY_MISMATCH_ISSUE;
  }
  // ③ existing importDoc capability gate
  // ④ persistence.importDoc(...): first ownership transfer
  // ⑤ Runtime factory → entry → lease
}
```

### 4.2.1 R1 补充：敌意 expected 输入的公共入口冻结

Expected 必须在**任何** `docRef` 读取、carrier 创建、entry 查询、Persistence 调用之前被安全快照/验证。不得直接解构不可信对象或调用未经保护的 getter。

```ts
function importReplica(owner: unknown, namespaceId: unknown, docRef: unknown, expected: unknown) {
  if (acceptance !== 'running') return Promise.resolve(NOT_ACCEPTING_ISSUE);
  const outcome = validateOpenIdentity(owner, namespaceId);
  if (!outcome.ok) return Promise.resolve(outcome.issue);

  const expectedOutcome = snapshotReplicationIdentityRef(expected);
  if (!expectedOutcome.ok) return Promise.resolve(INVALID_EXPECTED_REPLICATION_IDENTITY_ISSUE);
  return admitImportSlot(outcome.identity, docRef as YjsDoc, expectedOutcome.value);
}
```

Hostile expected tests pass null/undefined/array/function/getter-throw/Proxy-throw/inherited/invalid scalar forms and assert zero doc/carrier/entry/Persistence access. Predicate ordering is acceptance → owner/namespace validation → safe expected snapshot → carrier slot owner collision → docId → factual validity → Hub equality → capability → transfer.

---

## §5 ADR 修订方案（R2-AC-5）

### 5.1 `docs/adr/0006-server-persistence-docstore.md` 追加节

Append a section titled **“复制导入、归档与只读身份探针修订（issue #133 round-2；owner feedback 3 授权）”** with this normative structure:

1. Incremental scope, preserving owner partitioning, dirty notification, full snapshots, temp→rename and `META.docId` clauses unless explicitly revised.
2. `importDoc` is exclusive create, validates `META.docId` only; Hub advertisement equality is a Registry pre-transfer precondition.
3. `archiveDoc` settles dirty state, guard-reads persisted identity, writes archive then removes primary; classifications retain round-1 semantics.
4. Archive write/rename resolve is the commit boundary. Primary-remove failure is `DocArchiveFatalError('relocate-remove')` with `committed:true`; it is not operational/identity mismatch/duplicate. Registry preserves committed truth; retry re-guards primary, latest-wins overwrites archive slot, then retries removal.
5. Internal committed-identity probe reads trusted primary only, has no handle/mutation/dirty/flush/archive/ownership side effect, and failures are loud/typed.

### 5.2 `docs/adr/0010-hub-peer-websocket-ydoc-replication.md` 追加节

Append **“issue #133 round-2 reset/import identity precondition 修订（owner feedback 3 授权）”** with explicit replacement scope:

1. Active reset preflight runs live + persisted comparison inside Runtime FIFO reset-fence; valid mismatch is zero destructive `NAMESPACE_RESET_IDENTITY_MISMATCH`; corruption/abort is fatal and ordinary current-epoch read failure is `NAMESPACE_LOAD_FAILED`; pre-existing closing generation is re-evaluated and never a new preflight success.
2. Matching fence synchronously arms closing, settles, then lazy close continuation creates its barrier; no barrier waits for its own fence task. FIFO pre-fence writes are represented in the check, later writes are lifecycle-gated.
3. Bootstrap import validates docId, replication fact validity and exact Hub advertisement equality before ownership transfer.
4. dirty notification remains non-durable; strict dual source mismatch is intentional.
5. After fence arm archive typed errors use §3.5.2: identity mismatch is `NAMESPACE_RESET_FAILED`, never a zero-destruction preflight result; fatal propagation preserves committed truth.

---

## §6 测试与验收映射

| AC | Implementation/test proof |
|---|---|
| R2-AC-1/2 | SA6 dirty races plus Runtime fence interleaving; mismatch/failure before arm preserves lease/runtime/store. |
| R2-AC-3/4 | Hub expected identity equality before import ownership; hostile expected tests prove zero entry/write. |
| R2-AC-5 | ADR append-only normative revisions above. |
| R2-AC-6 | Existing suite green, type anchors and R4 public-field preservation anchor green. |

Required tests include probe taxonomy, closing re-evaluation, no-self-wait fence, armed archive typed errors, missing Runtime fence capability, hostile import expected, and the R4 hostile reset expected/type-anchor/F-1 cases in §3.6.3.

---

## §7 契约改动连锁审计 (Contract Change Caller Audit)

| Function | File | Before | After |
|---|---|---|---|
| `NamespaceRegistry.importReplica` | `packages/namespace-registry/src/types.ts` | 3 args | 4 args with Hub expected identity |
| `NamespaceRegistry.resetReplica` result union | `packages/namespace-registry/src/types.ts` | no dedicated expected-input issue | R4 append-only `NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID`; shared `InvalidIdentityIssue.field` restored to two fields |

Caller inventory: no production Hub/WS caller exists yet; R2 test callers must pass fourth import argument. `resetReplica` remains three arguments. Future Hub bootstrap must await and use authenticated Hub advertisement; reset caller must handle the new append-only domain issue by code. All actual callers are audited with:

```bash
git grep -n "\bimportReplica\s*(\|\bresetReplica\s*(" -- 'packages/**/*.ts' 'apps/**/*.ts'
```

---

## §8 文件清单（File Scope）

### ALLOW LIST

- `packages/namespace-registry/src/registry.ts` — 修改；reset preflight/fence/import logic；**R4** 专属 expected issue 返回常量替换及 F-2 注释修正（~210 lines total).
- `packages/namespace-registry/src/types.ts` — 修改；R2 result/message types；**R4** restore `InvalidIdentityIssue.field` binary union and append reset-only issue/message (~50 lines total).
- `packages/namespace-registry/src/index.ts` — 修改；仅既有 type export 对齐，R4 不新增值 export (~5 lines).
- `packages/persistence/src/contract.ts` — 修改；probe capability and taxonomy (~55 lines).
- `packages/persistence/src/lifecycle.ts` — 修改；no-write probe implementation (~100 lines).
- `packages/persistence/src/memory.ts` — 修改；probe wiring (~20 lines).
- `packages/persistence/src/file.ts` — 修改；probe wiring (~20 lines).
- `packages/persistence/src/index.ts` — 修改；additive probe type export (~5 lines).
- `packages/persistence/src/testing.ts` — 修改；probe/archive fault plumbing (~40 lines).
- `packages/namespace-runtime/src/runtime.ts` — 修改；R1/R2 fence implementation (~115 lines).
- `packages/namespace-runtime/src/close.ts` — 修改；fenced lazy close barrier (~55 lines).
- `packages/namespace-runtime/src/types.ts` — 修改；Registry-internal capability typing (~30 lines).
- `packages/namespace-registry/test/registry-phase5-bootstrap-reset-r2-red.test.ts` — `[SA6 owned]` 修改；R4 F-4 stale header wording only; no assertion weakening.
- `packages/namespace-registry/test/registry-phase5-bootstrap-reset-r2-surface.test-d.ts` — `[SA6 owned]` 修改；R4 public alias field-union and reset-special-issue type anchors.
- `packages/namespace-registry/test/registry-phase5-bootstrap-reset-r2-internal.test.ts` — 修改；R4 16 hostile expected complete issue assertions, no-side-effects/retry/TOCTOU and F-1 title correction.
- `packages/persistence/test/persistence-phase5-bootstrap-reset-r2.test.ts` — 新建；probe/archive fatal tests.
- `packages/namespace-runtime/test/runtime-phase5-reset-fence-r2.test.ts` — 新建；fence/no-self-wait tests.
- `docs/adr/0006-server-persistence-docstore.md` — 修改；append normative revision.
- `docs/adr/0010-hub-peer-websocket-ydoc-replication.md` — 修改；append normative revision.

### DENY LIST

- `packages/namespace-runtime/src/replication-write.ts` — existing identity mutation semantics unchanged.
- `packages/namespace-runtime/src/**` — except ALLOW runtime.ts/close.ts/types.ts; no public META/API expansion.
- `packages/replication-protocol/**` — no wire protocol work.
- `packages/ws-replication/**` — future integration only.
- `apps/yjs-server/**` — composition/transport outside scope.
- `packages/namespace-registry/src/lease.ts` — lease public API unchanged.
- `docs/phases/phase-5-websocket-replication.md` — roadmap not normative target.

## §9 协议假设依据 (Protocol Assumption Evidence)

无 HTTP/WS/端口/跨进程协议假设。本设计只涉及进程内 Registry/Persistence/Runtime FIFO；其 close-fence ordering 已由 §3.4/§3.5 明确伪码与无环证明冻结。

## SA2 反馈逐条回应

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|---|:--:|---|---|
| R1-1 closing generation | ✅ | §3.4 | await close → slot re-read → no archive matrix |
| R1-2 FIFO fence | ✅ | §2、§3.4/§3.5 | FIFO preflight/closing linearization |
| R1-3 probe taxonomy | ✅ | §3.3.1 | typed taxonomy and committed:false mapping |
| R1-4 hostile import expected | ✅ | §4.2.1 | snapshot before document/carrier/Persistence |
| R1-5 archive committed true | ✅ | §5 | archive remove-failure norm |
| R2-1 no self-wait | ✅ | §3.4/§3.5 | fence settles before lazy barrier creation |
| R2-2 armed archive mapping | ✅ | §3.5.2 | armed-only typed mapping |
| R2-3 Runtime capability gate | ✅ | §3.5.1 | factory-injected internal capability, loud missing gate |
| Delta D-1 | ✅ | §3.2、§3.6.1、§8 | restore shared field binary union; reset-only append-only issue |
| Delta D-2 | ✅ | §3.6.1/§3.6.2 | dedicated truthful code/message, no field |
| Delta D-3 | ✅ | §3.6.3、§8 | 16 complete issue assertions and public alias type anchors |
| Delta D-4 | ✅ | §3.6.3、§8 | F-1 title narrowed to cause-only identity-value non-echo |
| R4-F1 | ✅ | §3.6.2 | exact approved wording: live **or** persisted any `identityEquals` false triggers mismatch |
| R4-F2 | ✅ | §3.6.3 | no inaccurate delta subsection citation retained |
