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
| R2-D4（R1 修订） | reset 成功路径冻结为：owner → capability → closing re-evaluation → Runtime **reset-fence 槽内** live/persisted preflight + close admission → forceRelease/cancel idle/close drain → archive → bootstrap eligibility。fence slot 是线性化点，拒绝在其前发生，ADR-0010 旧 close-first 描述被正式修订取代。 |
| R2-D4a（R1 新增） | Runtime 增加最窄 internal `beginResetFence(expected, readPersisted)` capability：同一 Runtime FIFO 槽内先完成双源核验，再同步转换为 closing/停止新公共 write 接纳；已在该槽之前接纳的 enable/bump 必先结算并参与核验，之后写被 close lifecycle gate 拒绝。 |
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

### 3.2 identity 判定函数

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
- **persisted**：从下节冻结的 trusted committed-snapshot probe 所解码的 detached snapshot，按现有 `readImportedReplicaFacts` 同一判据族读取 META：双键均在且格式合规才 ok；双键缺失、单键、显式 undefined、异型 META、非法 ID/epoch 均为 `{ok:false}`，最终映射 reset mismatch，避免泄露值。
- expected 参数仍按既有 `ReplicationIdentityRef` 形状；实现应在公共入口的 identity validation 后验证 expected 的字段格式。格式错误是调用输入错误（沿既有 `NAMESPACE_INVALID_IDENTITY`/内部 API 前置约定处理），不能误报本地 mismatch，也不能访问 Persistence。

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
    // no current entry after an earlier close: this request may not claim AC zero-destruction.
    // It must not archive merely from persisted facts; return RESET_FAILED if primary exists, NOT_FOUND if absent.
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

  // R1-C: exact active generation fence; live/persisted sampling and close admission share Runtime FIFO.
  let fence;
  try {
    fence = await current.runtime.beginResetFence(expected, () =>
      readPersisted(identity.owner, identity.namespaceId));
  } catch (cause) {
    return mapProbeOrFenceFailureBeforeDestruction(cause);
  }
  if (fence.kind === 'missing') throw resetFatalFalse(new Error('active entry missing committed snapshot'));
  if (fence.kind === 'mismatch') return RESET_IDENTITY_MISMATCH_ISSUE;

  // Only {kind:'armed'} has synchronously crossed the close admission point.
  // The fence task has already settled; now (and never inside it) start the close barrier.
  // Existing leases are invalidated before drain; mutations admitted before fence were checked,
  // and later mutations were rejected by the synchronous closing gate.
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

// ImportReplicaIssue append-only member
{ ok: false; code: 'NAMESPACE_IMPORT_EXPECTED_IDENTITY_MISMATCH';
  message: typeof NAMESPACE_IMPORT_EXPECTED_IDENTITY_MISMATCH_MESSAGE }
```

Message contains no actual identity, owner, namespaceId, or input echo. Existing meanings stay disjoint:

| Code | Meaning |
|---|---|
| `NAMESPACE_IMPORT_IDENTITY_MISMATCH` | `META.docId !== namespaceId` |
| `NAMESPACE_IMPORT_INVALID_IDENTITY` | META replication facts absent/malformed/disabled |
| `NAMESPACE_IMPORT_EXPECTED_IDENTITY_MISMATCH` | facts are valid/enabled but exact `{id, epoch}` differs from Hub advertisement |
| `NAMESPACE_IMPORT_FAILED` | Persistence operational failure after preflight |

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

// Public entry is a separate function: retain existing
// acceptance → validateOpenIdentity ordering; validate `expected`
// structurally before carrier admission, then call:
// admitImportSlot(outcome.identity, doc as YjsDoc, expected as ReplicationIdentityRef);
```

### 4.2.1 R1 补充：敌意 expected 输入的公共入口冻结

Expected 必须在**任何** `docRef` 读取、carrier 创建、entry 查询、Persistence 调用之前被安全快照/验证。不得直接解构不可信对象或调用未经保护的 getter。

```ts
function importReplica(owner: unknown, namespaceId: unknown, docRef: unknown, expected: unknown) {
  if (acceptance !== 'running') return Promise.resolve(NOT_ACCEPTING_ISSUE);
  const outcome = validateOpenIdentity(owner, namespaceId);
  if (!outcome.ok) return Promise.resolve(outcome.issue);

  const expectedOutcome = snapshotReplicationIdentityRef(expected);
  // accepts only a non-null ordinary record with own data properties replicationId/replicationEpoch;
  // rejects arrays, functions, null, Proxy/getter throw, inherited values, extra exotic prototype,
  // undefined, non-string/invalid id, unsafe/non-integer/<1 epoch.
  // Getter/proxy exceptions are caught and normalized; no input value enters message/observer.
  if (!expectedOutcome.ok) return Promise.resolve(INVALID_EXPECTED_REPLICATION_IDENTITY_ISSUE);

  // `expectedOutcome.value` is a frozen primitive snapshot; only now admit carrier.
  return admitImportSlot(outcome.identity, docRef as YjsDoc, expectedOutcome.value);
}
```

`INVALID_EXPECTED_REPLICATION_IDENTITY_ISSUE` is an append-only stable input issue under `NAMESPACE_INVALID_IDENTITY` semantics (constant message, no field value echo). It is deliberately distinct from a correctly shaped Hub advertisement that does not equal document META. Required hostile-input tests pass `null`, `undefined`, array, function, getter-throw record, Proxy-throw record, inherited properties, invalid id, `NaN`, `Infinity`, `0`, and fractional epoch; each asserts zero `docRef.getMap`/META access, zero carrier/entry mutation, zero `importDoc` call/store write, and a subsequent valid request succeeds.

Predicate ordering is now frozen: acceptance → owner/namespace validation → safe expected snapshot → carrier slot owner collision → docId → factual validity → Hub equality → capability → transfer. Thus equality mismatch produces zero `importDoc` call, zero store write, zero entry registration, and a later correct retry is unpoisoned.

No `importDoc` expected-identity parameter is added: persistence is intentionally unaware of Hub advertisements and must not become an authorization/replication policy engine. The Registry pre-transfer equality predicate is the ownership gate required by AC-3; `importDoc` retains round-1 `META.docId` recheck as TOCTOU defence.

---

## §5 ADR 修订方案（R2-AC-5）

### 5.1 `docs/adr/0006-server-persistence-docstore.md` 追加节

Append a section titled **“复制导入、归档与只读身份探针修订（issue #133 round-2；owner feedback 3 授权）”** with this normative structure:

1. Opening scope: “本节为增量演进，修订上方与 Phase 5 import/archive 生命周期有关的接口空白；除下列明示条款外，所有既有条款（尤其 owner 分区、`saveDoc` dirty notification、全量 snapshot、主 snapshot temp→rename、`META.docId`）维持效力。”
2. `importDoc(owner, docId, doc)` is an exclusive-create capability: duplicate never overwrites, success commits full snapshot then issues handle/ownership, it validates `META.docId` only. Hub advertisement equality is explicitly **caller/Registry precondition before ownership transfer**, not general Persistence semantic validation.
3. `archiveDoc(owner, docId, expected)` is permitted only after no active handles; it settles preexisting dirty state, guard-reads persisted identity, then writes a full archive snapshot and removes primary. Identity mismatch/active/duplicate/operational/fatal classification and committed-aware relocation meaning are retained from round-1.
4. File archive layout is `{rootDir}/archive/users/{userId}/{docId}.snapshot`, tmp at the corresponding archive path; archive write resolves only after tmp→rename, then primary removal follows. Archive tmp is never committed; same slot is latest-wins. Memory provides behaviourally equivalent separate archive storage. **Commit boundary is the archive rename/write resolve**: if primary removal then rejects, archive bytes are already committed and `archiveDoc` must reject `DocArchiveFatalError('relocate-remove')` with `committed:true`; it must not report operational, identity mismatch, or duplicate. Registry propagates this as `NamespaceRegistryFatalError(..., committed:true)` rather than `RESET_FAILED`. Retry is convergence-only: it re-reads/guards the still-present primary and overwrites the same latest-wins archive slot, then retries removal; it never claims the primary remained the sole committed state.
5. A Persistence-internal read-only committed-identity probe is allowed for Registry reset preflight. It reads the trusted primary snapshot only, applies existing `META.docId`/replication-format validation, performs no handle issuance, mutation, dirty registration, flush, archive, or ownership transfer. I/O failure remains loud/typed; it is not a live-state fallback.

### 5.2 `docs/adr/0010-hub-peer-websocket-ydoc-replication.md` 追加节

Append **“issue #133 round-2 reset/import identity precondition 修订（owner feedback 3 授权）”**, explicitly saying it replaces the conflicting portions of the old line-57 reset ordering and line-65 generic bootstrap verification, while untouched ADR text remains effective:

1. `resetReplica(expectedLocalIdentity)` strict preflight: for an active generation, before any lease force release, close, archive, or bootstrap eligibility change, Registry executes current live projection + trusted persisted snapshot comparison in the Runtime FIFO reset-fence slot; both must be valid enabled identity and exactly equal expected. Valid mismatch rejects `NAMESPACE_RESET_IDENTITY_MISMATCH` with zero destructive action and keeps old generation/lease/runtime usable; probe corruption/abort is committed:false fatal, and ordinary current-epoch read failure is `NAMESPACE_LOAD_FAILED`. A pre-existing closing generation is awaited/re-evaluated and never treated as a new preflight success.
2. On successful preflight only: the preflight and close admission share one Runtime FIFO reset-fence slot; it verifies both facts then synchronously enters closing before the slot returns. The fence slot never creates/awaits a close barrier. Only after it settles does a lazy close continuation create the single close barrier with a predecessor tail captured after fence settlement; it drains only writes admitted before the fence (already represented in the check) → Persistence archive guarded by expected identity → bootstrap eligibility. This has no fence/close self-wait. Archive’s post-close guard remains defence in depth for external/cross-instance store changes, not an acceptable local late-mismatch path.
3. Bootstrap import accepts Hub-advertised expected identity. Detached document `META.docId`, replication fact validity, and exact equality with the advertisement are checked before `importDoc` resolves/transfers ownership. Valid-but-different lineage/epoch rejects; no automatic overwrite/merge, no persistence write, no Registry entry.
4. The revision must state dirty notification is not durable and strict dual-source mismatch is intentional; it must not state that a live dirty identity is persisted.
5. Archive relocation is normative: archive write/rename resolve is the archive commit point; a later primary-remove failure is propagated by Persistence as `relocate-remove` fatal `committed:true`, and Registry preserves that committed truth in its fatal propagation. The ADR must forbid translating it to reset domain mismatch/ordinary failure or claiming the old primary-only state is unchanged; retry uses latest-wins archive convergence plus primary removal. After reset fence arm, every archive typed rejection is classified by §3.5.2, and in particular identity mismatch is an operational `NAMESPACE_RESET_FAILED`, never a zero-destruction preflight result.

---

## §6 测试与验收映射

| AC | Implementation/test proof |
|---|---|
| R2-AC-1 | SA6 runtime cases for lineage mismatch, epoch mismatch, disabled live state; assert active lease/ready Runtime/readability/no archive call after return. |
| R2-AC-2 | SA6 true Memory races: expected old vs live new, and expected live new vs persisted old. Both reject under R2-D1; bytes remain epoch 1 and no forced flush. |
| R2-AC-3/4 | SA6 lineage/epoch mismatch plus real Memory retry case; equality check precedes capability/importDoc and proves zero write/entry. |
| R2-AC-5 | ADR-0006 and ADR-0010 append-only normative revisions in §5 form. |
| R2-AC-6 | Existing suite stays green; type anchor verifies 4-argument import and 3-argument reset. No test assertion weakening. |

Required test additions/updates beyond SA6 anchors:

- Probe seam tests: cache/live dirty epoch differs from store epoch; prove probe returns store epoch without `writeSnapshot`, scheduler advancement, `saveDoc`, or archive.
- Probe I/O failure and malformed stored identity tests: inject read reject, missing primary, Yjs decode failure, malformed META/docId, replication facts invalid, dispose abort and adapter violation; verify the exact §3.3.1 mapping, stable no-echo error, `committed:false`, and destructive counters remain zero.
- Closing test: hold a pre-existing closePromise, enqueue reset after it, then release; assert carrier re-evaluation, no use of old Runtime, no archive call, and only `NOT_FOUND` (missing primary) or `RESET_FAILED`/fatal per §3.4 matrix.
- Fence interleaving + no-self-wait test: hold reset inside the Runtime FIFO just before fence execution; enqueue `bumpReplicationEpoch()` before it and prove mismatch before force-release; then arm fence and attempt bump after it, proving the lifecycle gate rejects it. For matching reset, instrument fence task and lazy close continuation: assert fence task resolves before close barrier is created, predecessor tail excludes that task, and both `resetReplica` and concurrent `shutdown()` settle within bounded fake-scheduler/microtask turns. This covers the formerly unsafe post-preflight FIFO write and self-wait deadlock.
- Existing reset success test remains: matching live+persisted expected completes fence/close/archive then allows import.
- Hostile expected test matrix: null/undefined/array/function/getter-throw/Proxy-throw/inherited/invalid scalar forms must produce input rejection before `doc.getMap`, carrier, entry, or Persistence access; a correct retry succeeds.
- Armed archive typed-error matrix test: after matching fence arm inject each `DOC_ARCHIVE_*` rejection. Assert identity/active-handle/duplicate/operational → `NAMESPACE_RESET_FAILED`; fatal preserves `committedOf`; unknown → fatal false; no path returns `NAMESPACE_RESET_IDENTITY_MISMATCH`.
- Archive remove-failure test: make archive write resolve then primary remove reject; assert Persistence and Registry fatal both `committed:true`, not a reset domain issue; retry follows latest-wins convergence.
- Missing Runtime capability test: use legacy fake with no `beginResetFence`; assert pre-destructive stable Registry fatal false, no TypeError/no probe/no force-release/no close/no archive; internal-surface test proves public Runtime barrel and Registry declaration graph unchanged.
- API type test asserts expected fourth parameter and all import callers pass the authenticated Hub-advertisement-derived value.

---

## §7 契约改动连锁审计 (Contract Change Caller Audit)

### 改动函数

| Function | File | Before | After |
|---|---|---|---|
| `NamespaceRegistry.importReplica` | `packages/namespace-registry/src/types.ts` | 3 args, no external binding | 4 args; required Hub expected identity; new domain rejection union member |

### Caller inventory

Current repository production caller search finds no application/WS caller: the method is a Phase 5 public integration point. Direct current callers are round-1/R2 test fixtures and future slice integration only. R1 audit requires the implementation-time grep below to be attached to SA3/SA4 evidence; every discovered caller must pass a validated, authenticated Hub-advertisement snapshot rather than any document-derived value.

| Caller | File | await | direct try/catch | top-level catch-all | Disposition |
|---|---|---:|---:|---:|---|
| Registry method implementation | `packages/namespace-registry/src/registry.ts:~1670-1685` | N/A | internally maps errors | carrier green tail | signature and new pre-transfer branch updated |
| R2 runtime anchors | `packages/namespace-registry/test/registry-phase5-bootstrap-reset-r2-red.test.ts:547,571,603,619,647` | yes | test assertion | vitest | add fourth expected argument already anchored |
| R2 type anchor | `packages/namespace-registry/test/registry-phase5-bootstrap-reset-r2-surface.test-d.ts:37-45` | N/A | N/A | vitest typecheck | 4-tuple locks declaration |
| Future Hub/WS bootstrap (slices 3–7) | not yet implemented | must await | must map returned domain union | host channel boundary | integration note: derive expected only from authenticated Hub advertisement; never omit/substitute document values |

No existing function changes return-to-throw behavior. `resetReplica` remains three arguments and existing result union semantics; only its internal ordering changes. The internal persistence probe is additive and used by `runResetSlot` only.

Caller audit method for SA3/SA4:

```bash
git grep -n "\bimportReplica\s*(" -- 'packages/**/*.ts' 'apps/**/*.ts'
```

Any caller added by implementation must be appended to this table and supply the fourth argument.

---

## §8 文件清单（File Scope）

### ALLOW LIST

- `packages/namespace-registry/src/registry.ts` — 修改；R2-D1..D5 reset preflight, pre-destructive Runtime capability gate, no-self-wait fence/close orchestration, closing re-evaluation, armed archive matrix, and import fourth-argument equality (~200 lines).
- `packages/namespace-registry/src/types.ts` — 修改；append-only import expected-mismatch/input issue/result and four-parameter interface (~35 lines).
- `packages/namespace-registry/src/index.ts` — 修改；type-only export of any added public issue/message type if barrel requires it (~5 lines).
- `packages/persistence/src/contract.ts` — 修改；additive `ReplicaPersistence` read-only committed identity probe capability and typed operational/corrupt/fatal taxonomy (~55 lines).
- `packages/persistence/src/lifecycle.ts` — 修改；trusted-store no-write identity probe implementation and §3.3.1 typed failure mapping (~100 lines).
- `packages/persistence/src/memory.ts` — 修改；expose Memory adapter’s lifecycle-backed read-only probe (~20 lines).
- `packages/persistence/src/file.ts` — 修改；expose File adapter’s lifecycle-backed read-only probe (~20 lines).
- `packages/persistence/src/index.ts` — 修改；export necessary additive type without changing existing contracts (~5 lines).
- `packages/persistence/src/testing.ts` — 修改；extend test adapter/wrapper capability plumbing for the probe and archive-remove fault injection without adding writes (~40 lines).
- `packages/namespace-runtime/src/runtime.ts` — 修改，**SA2 R1 #2 / R2 #1 解除原 DENY**；新增仅供 Registry 受控调用的 Runtime FIFO `beginResetFence`，槽内核验/同步 arm，槽后懒启动 close continuation，禁止 self-wait (~115 lines).
- `packages/namespace-runtime/src/close.ts` — 修改，**SA2 R1 #2 / R2 #1 解除原 DENY**；复用 close barrier，支持 fenced closing 的槽后 barrier 创建，明确 predecessor 排除已结算 fence，不改排空/无 timeout 语义 (~55 lines).
- `packages/namespace-runtime/src/types.ts` — 修改，**SA2 R1 #2 / R2 #3 解除原 DENY**；仅 Registry-internal capability typing，禁止经公共 barrel 暴露 (~30 lines).
- `packages/namespace-registry/test/registry-phase5-bootstrap-reset-r2-red.test.ts` — `[SA6 owned]` 修改；retain strict race assertions and add/adjust probe seam coverage, never weaken behavior assertions.
- `packages/namespace-registry/test/registry-phase5-bootstrap-reset-r2-surface.test-d.ts` — `[SA6 owned]` 修改 only if public type export path demands it; preserve 4-argument/3-argument anchors.
- `packages/persistence/test/persistence-phase5-bootstrap-reset-r2.test.ts` — 新建；committed-snapshot probe purity/error taxonomy and archive remove-fatal tests.
- `packages/namespace-runtime/test/runtime-phase5-reset-fence-r2.test.ts` — 新建；SA2 R1 #2 / R2 #1 Runtime FIFO interleaving, no-self-wait, close-admission and public-surface tests.
- `packages/namespace-registry/test/registry-phase5-bootstrap-reset-r2-internal.test.ts` — 新建；SA2 R2 #2/#3 armed archive error matrix and missing internal Runtime capability loud-gate tests.
- `docs/adr/0006-server-persistence-docstore.md` — 修改；append normative revision specified in §5.1.
- `docs/adr/0010-hub-peer-websocket-ydoc-replication.md` — 修改；append normative revision specified in §5.2.

### DENY LIST

- `packages/namespace-runtime/src/replication-write.ts` — 复制身份 mutation 既有实现，本修订不动；其 enable/bump 仅通过新增 Runtime internal fence 与 close lifecycle gate 受控。
- `packages/namespace-runtime/src/**` — 除 ALLOW LIST 中 SA2 R1 #2 明示的 `runtime.ts`、`close.ts`、`types.ts` 外均不动；不新增公共 META/API 面。
- `packages/replication-protocol/**` — no wire protocol change in this slice.
- `packages/ws-replication/**` — future integration caller only; not implemented by this revision.
- `apps/yjs-server/**` — composition root/transport outside scope.
- `packages/namespace-registry/src/lease.ts` — no lease API or lifecycle mechanic change; reset only changes admission ordering.
- `docs/phases/phase-5-websocket-replication.md` — phase roadmap is not the normative target of feedback 3.

## §9 协议假设依据 (Protocol Assumption Evidence)

无协议级假设：本设计涉及进程内 TypeScript API、Registry/Persistence lifecycle 和 ADR 文本；不假设 HTTP/WS status、端口、服务启动时序或跨进程协议行为。

## SA2 反馈逐条回应

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|---|:--:|---|---|
| R1-1 CRITICAL：closing generation 必须等待 close 后重新求值，不能用旧 current/仅 persisted 成功或归档 | ✅ | §3.4、§3.5、§6 | 伪码改为 await exact closePromise → carrier slot re-read → missing=NOT_FOUND、primary 仍在=RESET_FAILED、错误按 probe matrix；明确零 archive、永不把 closing Runtime 当 live evidence。 |
| R1-2 HIGH：preflight 与 Runtime FIFO identity write 的线性化 fence | ✅ | §2 R2-D4/D4a、§3.4、§3.5、§6、§8 | 删除旧“late mismatch 可接受”方案；新增 Runtime FIFO `beginResetFence`，在同槽内先核验再同步 arm closing。SA2 要求的 runtime 文件已显式解除 DENY、加入 ALLOW 与竞态测试。 |
| R1-3 HIGH：probe typed taxonomy、corruption/abort/dispose mapping、INV-12/零泄露 | ✅ | §3.3.1、§3.4、§6、§8 | 冻结 operational/corrupt/fatal 三类与结果表：仅正常 read reject→LOAD_FAILED；损坏/abort/adapter violation→committed:false fatal；格式不合规但可读→mismatch；全路径零破坏、稳定无回显。 |
| R1-4 MEDIUM：敌意 expected 的安全验证及零副作用 | ✅ | §4.2.1、§6、§7、§8 | 公共入口伪码在 doc/carrier/entry/Persistence 前 snapshot 验证 expected；收编 getter/Proxy throw，明确输入 issue、测试矩阵和 future authenticated-advertisement caller discipline。 |
| R1-5 MEDIUM：archive rename/remove failure 的 ADR committed:true 闭环 | ✅ | §5.1、§5.2、§6 | ADR 文案要求明确 archive write 是提交点、remove failure=relocate-remove committed:true fatal、Registry 原样传播、latest-wins convergence retry，禁止伪装为领域 reset failure。 |
| R2-1 BLOCKER：fence task 不得与 close barrier 自等待 | ✅ | §3.4、§3.5、§6、§8 | 伪码改为 fence 槽只核验+同步 arm，绝不创建/await barrier；fence task settled 后才由 lazy continuation 捕获后继 tail 创建 close barrier。给出有向依赖无环证明与 bounded-settlement 红线测试。 |
| R2-2 HIGH：armed 后 archive typed errors 必须冻结映射 | ✅ | §3.4、§3.5.2、§5.2、§6 | `mapArmedArchiveFailure` 表冻结所有 `DOC_ARCHIVE_*`：identity/active/duplicate/operational→RESET_FAILED，fatal 保留 committed，unknown→fatal false；任何 armed 后路径禁止返回 reset identity mismatch。 |
| R2-3 MEDIUM：internal Runtime capability 可达路径及缺失 gate | ✅ | §3.5.1、§6、§8 | 使用 Registry-only factory injection / `RuntimeForRegistry` structural capability，禁止 Runtime public barrel 或 internal-subpath import；缺失在 probe/forceRelease/close/archive 前 branded fatal false，配套 internal-surface 与旧 fake 测试。 |

