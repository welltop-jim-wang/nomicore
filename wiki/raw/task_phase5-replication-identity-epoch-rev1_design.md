# 修订设计 — Phase 5 replication identity / epoch（issue #132，round 2）

- **任务性质**：发布后修订轮；PR #145 的 round-1 实现为事实基线，本文只裁决人工 review 的四项反馈。
- **基线设计**：`wiki/raw/task_phase5-replication-identity-epoch_design.md`（818 行 R2，SA2 已 pass）。未被本文明确替换的设计、测试锚和范围结论继续有效。
- **约束基准**：`wiki/raw/task_phase5-replication-identity-epoch_relevant_decisions.md`；ADR 0006/0008/0009/0010；`docs/phases/phase-5-websocket-replication.md`。
- **本轮原则**：不把 `wiki/raw/` 历史证据当作规范合同；规范变动必须进入 `docs/adr/` 与 `docs/phases/`。不改变 SA6 验收锚的两态 status 合同，也不将网络/session 状态塞入 Runtime status。

---

## §1. 评审反馈裁决总表

| 反馈 | 裁决 | 实质落点 |
|---|---|---|
| 1（高）构造期 V2.5 与 ADR 0008:14 冲突 | **保留构造期读取与损坏拒绝；修订 ADR 0008，登记复制保留事实为窄例外** | `docs/adr/0008-…md` 新增 issue #132 修订节；测试只补现有行为缺口 |
| 2（中）Runtime 公共契约文档不同步 | **同步 ADR 0008 和 Phase 5 规范**；ADR 0010 / protocol 已正确，无实质变动 | `docs/adr/0008-…md`、`docs/phases/phase-5-websocket-replication.md` |
| 3（中）AC-6 恢复矩阵缺两项 | **补两个直接绿的回归用例**：File bump 后落盘重启、fatal 后 reopen/recovery 保留 committed facts | `registry-phase5-replication-red.test.ts` |
| 4（低）E1/E2 gate 重复 | **本 PR 提取共享 gate**，不改变拒绝通道、槽序或 stable message | `replication-write.ts`；补槽级等价性测试 |

---

## §2. 反馈 1：构造期复制事实读取的 ADR 裁决

### §2.1 选择：保留 V2.5，并以 ADR 0008 明示窄例外

选择第一项：**不移动校验到未来的复制管理 / session 接缝；保留 `runtime.ts:203-216` 的 V2.5 `readReplicationFacts(doc)`，并增补 ADR 0008。**

这里的动作不是普通 logical validation 的回流：`readReplicationFacts` 只读取顶层 `META` 的两个 ADR 0010 保留字段，既不编译 schema、也不读取/提取/验证 ROOT。它的唯一产物是 Runtime 从构造时刻起必须公开的、冻结两态 `status.replication` 事实投影。

### §2.2 取舍与理由

| 方案 | status 两态诚实性 | 既有测试锚 | 结论 |
|---|---|---|---|
| V2.5 同步纯读（选择） | 预启用文档 open 后立即得到 enabled/id/epoch；损坏的保留事实不会被谎报为 disabled。两态联合没有 `unknown` 可暂存 | `registry-phase5-replication-red.test.ts` 的预启用 overflow、status 判别面；`registry-sa7-phase5-replication-dynamic.test.ts:230-285` 的磁盘损坏 loud 与真缺席 disabled | 保留 |
| 移至复制管理/session 接缝 | ordinary open 可成功，但在第一次 session/管理操作前 status 必须谎报 disabled、增加不允许的第三态、或让 status 不反映已提交 META；且 session 属后续切片 | 破坏 AC-1/AC-5 的立即投影锚，或需要扩大 status 类型与重写测试合同 | 拒绝 |

**关键边界**：该例外只涵盖 `META.replicationId` / `META.replicationEpoch` 的存在性、载体与格式一致性，以及损坏时拒绝 Runtime 构造；不扩展为通用 META 校验，更不恢复 ADR 0008 已取代的 schema、ROOT 载体或 logical validation。

**损坏语义**：双键真缺席是合法 `disabled`；双键存在且格式合法是合法 `enabled`；恰一键存在、键存在但值为 `undefined`、格式违约或 META 载体异型是不可在受控写面产生的持久化损坏，构造同步 throw。Registry 将其收编为 `NamespaceRegistryFatalError('open', 'runtime-construction', committed:false)`；这不是静默降级。运行时已经实现此行为，本文只使 ADR 契约与实现一致。

### §2.3 ADR 0008 增补节设计要点

在 ADR 0008 的「稳定码注册修订」之后追加 `### issue #132 修订：复制保留事实投影与管理写（2026-08-27）`，包含下列规范性条款：

1. **授权链、读取例外及闭合边界**：本增补依据 **issue #132 / PR #145 feedback 1 / owner `welltop-jim-wang` / 2026-08-27** 的明确授权。仅允许 Runtime 在构造、**对外发布前**同步读取 `META.replicationId` 和 `META.replicationEpoch`，仅为生成 status 的复制持久事实。
2. **两态与损坏通道**：唯一允许的判定是双键均真缺席 → `{state:'disabled'}`，或双键均存在且均合规 → `{state:'enabled'; replicationId; replicationEpoch}`；部分存在、键存在而 `undefined`、格式不合法、META 异型载体均为损坏并构造拒绝，禁止伪装 disabled 或自动补写新 lineage。
3. **原规则保持**：**除此之外，原第 14 行保持不变**：普通 open 不读取或验证 `SCHEMA`、`ROOT` 或任何 logical value，不编译 schema，不引入通用 META validation；外部持久化文件的其他错误修改仍不在本契约范围。
4. **公共窄写方法**：将 “v1 公开两个窄方法” 替换为“基础 v1 方法为两个；经 ADR 0010 授权的复制管理例外另加 `enableReplication()` 和 `bumpReplicationEpoch()`”。四者均进入同一严格 FIFO sequencer，完整槽序不变。
5. **status 字段**：在第 95 行 status 列举中补 `replication`，明确仅含持久 identity/epoch，不含 session、网络、队列或 sync 状态。
6. **失败与持久化真相**：enable/bump 的成功仍只表示 commit + dirty notification 已登记，非已落盘；notify failure 的 committed facts 不回滚，fatal 之后读取与 status 保留最后已提交事实。
7. **关联权威**：字段格式、不可变性、epoch 上限与 hub-only 管理权以 ADR 0010 为权威；ADR 0008 仅规定 Runtime 槽序、投影、构造例外和失败通道。

### §2.4 设计期证据

- `runtime.ts:203-216`：V2.5 在 V2 handle gate 后、P0 入队前执行；throw 路径未建 sequencer、未入队、未写 doc，满足零副作用构造拒绝。
- `replication-write.ts:130-142`：读取器将双键 true absence / 正常 enabled / 损坏分支区分。
- `registry-sa7-phase5-replication-dynamic.test.ts:230-285`：File snapshot 上 `undefined` 保留键可持久化，open loud；双键真缺席重启后是 disabled，证明两态判定必要且可观测。
- ADR 0010 已定义字段、显式管理操作与不可变谱系；ADR 0008 的原始表述缺失该后续授权，因此以增补而非暗中改变其语义。

---

## §3. 反馈 2：受影响规范文档枚举与编辑规则

### §3.1 必须修改的规范文档

| 文件 | 修改内容 | 依据 |
|---|---|---|
| `docs/adr/0008-namespace-runtime-read-write-capabilities-and-sequencer.md` | 按 §2.3 增补复制投影/构造损坏例外、两个管理写方法及 status.replication；修正“两个窄方法”和 status 枚举的过时表述 | 反馈 1、2；ADR 0010 的既有授权 |
| `docs/phases/phase-5-websocket-replication.md` | Slice 1 单列 Runtime/Lease 基础合同（两个管理操作、两态 status、单 sequencer、损坏 open 拒绝、dirty-not-durable），并明示本 slice **不实现** session/WS/reset；场景 15 拆为 15a（FIFO、dirty-not-durable、File bump durable restart）与 15b（identity conflict/reset archive，后续切片）；fatal 只表述为 committed-state recovery，不作 durable restart 承诺 | 反馈 2、3；Phase 是实施合同 |

### §3.2 已核实而不修改的规范文档

| 文件 | 结论 |
|---|---|
| `docs/adr/0010-hub-peer-websocket-ydoc-replication.md` | 已定义 replication 字段、format、enable/bump、不可变谱系及 Hub authority；不重复 Runtime 槽序或 status 实现细节。无需改动。 |
| `docs/adr/0006-server-persistence-docstore.md` | `saveDoc` dirty notification、degraded 与快照语义足以支持本轮；不新增 Persistence 契约。无需改动。 |
| `docs/adr/0009-namespace-registry-leases-and-host-lifecycle.md` | open 构造完成才能成功，fatal/degraded capability 语义仍成立；Runtime 的新构造期损坏拒绝将通过现有 runtime-construction 通道表达，无需重写。 |
| `docs/protocols/instance-replication-v1.md` | 已含 wire identity/epoch 与重启恢复纪律；本轮没有修改 wire 格式、状态机或消息码。无需改动。 |
| `CONTEXT.md` | 术语已准确描述 lineage、epoch 与 Runtime/Session 边界。无需改动。 |
| `wiki/raw/task_phase5-replication-identity-epoch_*` | 历史设计、评审、测试证据；**禁止作为规范补丁的替代品**，本轮不改。 |

---

## §4. 反馈 3：AC-6 恢复矩阵补全

### §4.1 既有覆盖与缺口

- 既有 `registry-phase5-replication-red.test.ts:662-708` 覆盖 Memory degraded → retry → bump epoch 2 → Memory reopen。
- 既有 `registry-phase5-replication-red.test.ts:717-763` 覆盖 File enable → epoch 1 durable snapshot → restart。
- 既有 fatal 测试（约 479-523）只验证同一 live Runtime 内 committed epoch 2、fatal 状态及后续写禁用；未验证重新 open/recovery。

因此只需在同一 SA6 owned 验收文件追加下列两条用例；保留全部既有断言、不重写现有场景。

### §4.2 新增用例 A：File bump 后落盘与重启恢复

**文件**：`packages/namespace-registry/test/registry-phase5-replication-red.test.ts`（`[SA6 owned]`；在 AC-6 File persistence describe 内追加；本轮经 review 明示授权扩展该验收锚）。

**场景**：create → schemaReady → enable（记录 id）→ bump（期望 epoch 2）→ scheduler advance → `waitDurableSnapshot(... META.replicationEpoch, 2)` 与 id durable 等待 → shutdown/dispose writer → 同 rootDir 新 FilePersistence / 新 Registry open。

**断言要点**：

1. `enableReplication()`、`bumpReplicationEpoch()` 都为 `{ok:true}`；live META 在落盘等待前为 id + epoch 2。
2. `waitDurableSnapshot` 同时确认磁盘 `replicationId===id0`、`replicationEpoch===2`，不能用仅推进 fake scheduler 代替 durable 证据。
3. reopen 后 `getMetadata()` 仍为 id0 / 2，`getStatus().runtime.replication` 精确等于 `{state:'enabled', replicationId:id0, replicationEpoch:2}`。
4. 这条测试锁定 “dirty registered ≠ durable” 的正确异步边界：只有 durable wait 完成后才 dispose/restart。

### §4.3 新增用例 B：fatal 后 reopen/recovery 保留 committed replication facts

**文件**：`packages/namespace-registry/test/registry-phase5-replication-red.test.ts`（`[SA6 owned]`；建议紧跟既有 fatal 事实用例；本轮经 review 明示授权扩展该验收锚）。

**用例名与注释**：名称必须含 `committed-not-durable`（或 `committed-state recovery`）；注释必须声明这是 **committed-state recovery，不是 File durability recovery**。

**固定五步结构（SA2 T1，禁止用预制 epoch=2 seed 替代）**：

1. 用可失败 notifier 构造 Runtime 的**同一 live Y.Doc**；enable 成功后记录 `id0`，并在该 live doc 断言 META 为 `id0/1`。
2. 让 bump 的 notifier reject；等待 rejection 后断言它是 `RuntimeWriteFatalError` 且 `committed===true`。仅在原 live doc 上断言 META 与 `status.replication` 均为 enabled / `id0` / epoch 2，且 `status.fatal` 非空；不在 fatal Runtime 上再写。
3. **rejection 之后才**从这个失败 bump 已提交后的同一 live Y.Doc 制作独立 recovery seed：先断言源 META=`id0/2`，`Y.encodeStateAsUpdate(sourceDoc)`，再 `Y.applyUpdate(seedDoc, update)` clone；再次断言 seed META=`id0/2`。不得从预制 seed、失败 notifier 的 persistence，或任意其他 doc 取恢复来源。
4. 新建仅承载该 `seedDoc` 的独立 `DocPersistence` 与新 Registry；新 Registry **只能**从该 seed `open`。断言新 generation 的 META/status 为 enabled / `id0` / 2、fatal 为空；其 bump 可成功到 epoch 3。
5. failed notifier 所绑定 persistence **不得**被当作 durable 来源或 reopen 成功前提；若 fixture 暴露其读面，可额外观测并断言测试没有要求它含 epoch 2，且绝不以它 reopen 作为成功路径。它的状态不能升级为 durability 证据。

该结构证明的因果链是“failed bump transaction 已提交的 live META → rejection 后 snapshot → recovery seed → 新 generation”，而非“某个恰好 epoch=2 的预制文档可 open”。它同时保留 ADR 0008 的事实：notifier failure 后 committed 不等于 durable。

### §4.4 更新后的 AC-6 矩阵

| 场景 | Memory | File | committed/fatal |
|---|---:|---:|---:|
| enable + close 排空 + reopen | 已有 | SA7 dynamic 已有 | N/A |
| degraded retry 后 epoch 2 reopen | 已有 | 不要求重复 | N/A |
| enable epoch 1 durable reopen | N/A | 已有 | N/A |
| **bump epoch 2 durable reopen** | N/A | **新增 A** | N/A |
| fatal committed bump 后同一 live doc snapshot 的 facts 保留，并在新 generation committed-state recovery/open | **新增 B（同一 live doc clone seed）** | **不作 File durability 断言**；future durability-specific test 另行覆盖 | **新增 B** |

---

## §5. 反馈 4：提取 replication write 共享 gate

### §5.1 裁决

**本 PR 提取 E1/E2 为 `runReplicationWriteGate(env)`（私有、未导出）**。理由：两处当前逐字复制 fatal、`handle.getStatus()` try/catch、non-ready refusal、notifier missing refusal 及 notifier capture；复制管理未来还可能增加受控 META 操作。此时抽取是低风险、减少策略漂移的净收益，而不是过早泛化到 ROOT/SCHEMA 的不同 issue 类型。

### §5.2 私有接口与伪代码

```ts
type ReplicationWriteGateFailure = Readonly<{
  readonly kind: 'gate-failure';
  readonly result: ReplicationWriteGateRefusal;
}>;
type ReplicationWriteGateResult =
  | Readonly<{ readonly kind: 'gate-ready'; readonly notifyDirty: () => Promise<void> }>
  | ReplicationWriteGateFailure;

function runReplicationWriteGate(env: ReplicationWriteEnv): ReplicationWriteGateResult {
  // E1：fatal 已置位 → {kind:'gate-failure', result: disabled('fatal…')}；零输入读取
  // E2：getStatus throw → {kind:'gate-failure', result: rejectWithWriteFatal(...,
  //     false, 'write-slot-internal', ..., 'replication')}
  //     non-ready → 同一入口无关的 ReplicationWriteGateRefusal（既有 message）
  //     notifier absent → 同一入口无关的 ReplicationWriteGateRefusal（既有 message）
  //     success → 单读捕获 notifyDirty，返回 gate-ready
}

// ReplicationWriteGateRefusal 是两个现有结果联合共享的 gate 拒绝子集；helper 不把
// EnableReplicationResult | BumpReplicationEpochResult 混成自身返回类型。每个 caller
// 在 `gate.kind === 'gate-failure'` 时把 result 作为自己已有结果联合的共享成员直接返回。
```

`runEnableReplicationSlot` 与 `runBumpReplicationEpochSlot` 均在自己的 E3/E4 前调用此函数；`gate-failure` 时直接返回该入口既有结果联合中的共享 refusal，`gate-ready` 时才继续。helper 不读取 caller input，也不接收 input 参数。不合并 E3 输入校验、E4 facts、E5 transaction、E5.5 status 同步、E6 notifier await；所以：

- FIFO 与 `WriteSequencer` 接纳顺序不变；
- fatal/degraded/notifier/lifecycle 的 stable code/message、零输入访问和 `committed:false` 语义不变；
- enable 的 Proxy 单读捕获仅仍在 gate success 后执行；
- bump 的 no-input 路径不被迫模拟 enable input；
- 函数私有，不扩公共 exports 或类型面。

### §5.3 共享 gate 测试

在 `packages/namespace-runtime/test/runtime-replication-write.test.ts` 追加参数化/成对用例，测试公共 slot 行为而非私有 helper 名称。除断言两个入口的共享拒绝/同类 `RuntimeWriteFatalError`、META 零改动外，必须使用计数或 throw seam 锁定下列**短路和访问纪律**：

1. **fatal**：enable 与 bump 均不访问 `handle.getStatus()`，也不访问/调用 notifier；enable 的 hostile getter/Proxy input 同样零读取。
2. **non-ready/degraded**：`getStatus()` 恰一次，notifier 零访问/零调用；enable hostile input 零读取，bump 无任何 input 读取面。
3. **`getStatus` throw**：notifier 零访问/零调用；返回 branded `RuntimeWriteFatalError`，`committed:false`，而不是结果联合或裸异常；enable hostile input 仍零读取。
4. **notifier absent**：`getStatus()` 恰一次，之后拒绝；enable input 不进入 E3，bump 保持零 input 访问。
5. **成功路径**：`getStatus()` 恰一次；enable 仅在 gate-ready 后读取 hostile input 并进入 E3；bump 永不读取任何 input；两入口的 notifier 都仅在 E5 transaction 后恰一次调用。

这些断言既防止 helper 提前触发 E3-only hostile input，也防止复制/移动 gate 时破坏 `fatal → getStatus → notifier` 的短路顺序。

---

## §6. 不变量与失败通道（修订后）

1. **普通 open 范围不回流**：除 META 两个复制保留事实的纯读例外外，不做 schema/ROOT/logical validation。
2. **两态诚实**：status.replication 永不把合法 enabled 或 corrupt facts 伪装成 disabled；网络状态仍只属于后续 ReplicationSession。
3. **构造拒绝零副作用**：corrupt facts 在 P0 入队前拒绝，未写 doc、未登记 dirty、未创建 Runtime public surface。
4. **写槽同构**：enable/bump 均通过共享 E1/E2，再独立完成 E3–E7；成功含 live commit + dirty registration，不等于 durable snapshot。
5. **fatal 真相**：post-commit notifier failure 不回滚 META；旧 generation 禁写但仍可读。fatal recovery 测试只可从 rejection 后对**同一 live Y.Doc**编码得到的 clone seed 构造新 generation，证明 committed-state recovery；不得将失败 notifier 的 persistence 或 reopen 当作 durability 证据。
6. **File durability 真相**：只有 File 测试在等待磁盘快照具体 epoch 后才销毁 writer/restart；禁止将 `saveDoc` resolve 或 fatal notifier failure 当作落盘。

---

## SA2 反馈逐条回应

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|---|:--:|---|---|
| Round 1 反馈 1：构造期 V2.5 与 ADR 0008:14 冲突二选一 | ✅ | §2、§3.1；ADR 0008 ALLOW 项 | 选择保留 V2.5，明确它是 META 两保留事实的纯读、两态 status 所必需的窄例外；设计 ADR 增补文字、损坏构造拒绝语义和非回流边界。 |
| Round 1 反馈 2：两个窄方法/status 缺 replication，枚举全部规范落点 | ✅ | §3 | 列出 ADR 0008 与 Phase 5 必改；逐份核实 ADR 0010/0006/0009、protocol、CONTEXT 不需改；明示 wiki/raw 仅历史证据。 |
| Round 1 反馈 3：补 File bump 恢复与 fatal reopen/recovery | ✅ | §4 | 指定同一 SA6 owned AC-6 文件、具体场景、durable wait 和 reopen 断言；fatal 场景明确 committed 不等于 durable，避免虚假保证。 |
| Round 1 反馈 4：E1/E2 gate 重复 | ✅ | §5 | 裁决提取私有共享 gate，保留所有原有通道/文本/时序，并增加双入口行为等价性测试。 |
| **SA2 R1 #1 HIGH**：fatal committed recovery seed 的因果锚定 | ✅ | §4.3、§4.4、§6-5 | 用例固定 SA2 T1 五步：rejection 后仅从 failed bump 的同一 live Y.Doc encode/clone seed，seed 前后断言 id0/2，新 Registry 仅从该 seed open；failed notifier persistence 不得作为 durable/reopen 前提；名称明确 committed-not-durable。 |
| **SA2 R1 #2 LOW**：ADR 0008 窄例外闭合措辞与授权链 | ✅ | §2.3 | 增补明确 issue #132 / PR #145 feedback 1 / owner / 日期；仅允许双字段发布前读取与两态判别；“除此之外原第 14 行保持不变”，禁止 SCHEMA/ROOT/logical validation 与通用 META validation。 |
| **SA2 R1 #3 LOW**：Phase 5 Slice/场景 15 分层 | ✅ | §3.1 | 明确 Slice 1 Runtime/Lease 基础合同和 session/WS/reset 非目标；第 15 项拆 15a 本 slice 的 FIFO/durability restart 与 15b 后续 conflict/reset archive；fatal 只说 committed-state recovery。 |
| **SA2 R1 #4 LOW**：共享 gate 类型与访问纪律 | ✅ | §5.2、§5.3 | helper 改为入口无关 `ReplicationWriteGateRefusal` 形状；测试增加 fatal/non-ready/getStatus-throw/success 的访问计数、短路顺序、hostile enable input 与 bump 零输入访问边界。 |

---

## §7. 文件清单（File Scope）

### ALLOW LIST

- `docs/adr/0008-namespace-runtime-read-write-capabilities-and-sequencer.md` — 修改；追加 issue #132 修订，明示 V2.5 META 复制事实例外、两新增管理方法与 status.replication（§2.3，约 25–40 行）。
- `docs/phases/phase-5-websocket-replication.md` — 修改；扩展 Slice 1 和场景 15 的 Runtime 合同、恢复验收（§3.1，约 15–25 行）。
- `packages/namespace-runtime/src/replication-write.ts` — 修改；抽取私有 E1/E2 `runReplicationWriteGate`，两个槽调用；不改公共 API/稳定 message/槽语义（§5，净改动约 40–65 行）。
- `packages/namespace-runtime/test/runtime-replication-write.test.ts` — 修改；已有 SA3-owned 槽级回归文件，追加 enable/bump 共享 gate 行为等价性测试，保留既有断言（§5.3，约 60–100 行）。
- `packages/namespace-registry/test/registry-phase5-replication-red.test.ts` — `[SA6 owned]` 修改；因本轮 review 反馈 3 明示扩展验收矩阵，新增 File bump durable restart 和 fatal committed-facts reopen/recovery 两个 AC-6 用例，不修改既有断言（§4.2–§4.3，约 100–160 行）。

### DENY LIST

- `packages/namespace-runtime/src/runtime.ts` — V2.5 行为已正确；本轮以 ADR 对齐，不改运行时构造逻辑。
- `packages/namespace-runtime/src/status.ts`、`p0.ts`、`errors.ts`、`write.ts`、`index.ts` — status/错误/公共面已落地，本轮不扩范围。
- `packages/namespace-registry/src/**` — Registry/Lease API 已实现，本轮不改变随机、open 或 recovery 编排。
- `packages/persistence/**` — 不改变 dirty/durable 契约；测试使用既有 waitDurableSnapshot 与 FilePersistence 行为。
- `packages/doc-runtime/**`、`packages/vfsl/**`、`apps/**` — 与四项评审修订无关。
- `docs/adr/0006-server-persistence-docstore.md`、`docs/adr/0009-namespace-registry-leases-and-host-lifecycle.md`、`docs/adr/0010-hub-peer-websocket-ydoc-replication.md`、`docs/protocols/instance-replication-v1.md`、`CONTEXT.md` — 已核实合同正确，不做重复或无关修订。
- `wiki/raw/task_phase5-replication-identity-epoch_*`（除本设计文件） — 历史证据/其他 SA 产出，不修改。

## §8. 协议假设依据 (Protocol Assumption Evidence)

无新增 HTTP/WS、端口、跨进程或第三方工具协议假设。本轮唯一涉及 File 恢复的结论由既有源码与测试机制而非猜测支撑：

| 假设 | 依据类型 | 依据内容（具体引用） | 风险等级 |
|---|---|---|---|
| File committed snapshot 可保存 META id/epoch 并由新 Registry open 投影 | 现有测试/源码 | `registry-phase5-replication-red.test.ts:717-763` 已验证 enable epoch 1；`waitDurableSnapshot` 读取解码磁盘 snapshot；`registry-sa7-phase5-replication-dynamic.test.ts:209-223` 已验证真实 timer 下 File restart 恢复 | 低 |
| `undefined` META 值是可持久损坏而非短暂缺值 | 现有动态测试 | `registry-sa7-phase5-replication-dynamic.test.ts:230-268` 直接将 snapshot 写盘、解码并断言 `has=true/get=undefined`，然后 open loud rejection | 低 |
| shared gate 不影响 sequencer / commit / notifier 顺序 | 源码引用 | `replication-write.ts:156-275` 与 `281-360` 当前 E1/E2 已各自在 E3/E4 前运行；提取仅局部私有复用，E3–E7 保持原位置 | 低 |

## §9. 契约改动连锁审计 (Contract Change Caller Audit)

**无已有函数契约改动。** 本轮对生产代码仅作 `replication-write.ts` 私有重构：两个现有 slot 的 E1/E2 代码移动到同模块私有 helper，公共方法、参数、结果联合、throw 路径、稳定 message 与调用时序均保持。文档修订只将现有实现与 ADR/Phase 合同对齐。

| 函数 | 文件 | 改动前契约 | 改动后契约 |
|---|---|---|---|
| `runEnableReplicationSlot` | `packages/namespace-runtime/src/replication-write.ts` | 现有 Promise 结果/RuntimeWriteFatalError 路径 | 完全不变；内部调用共享私有 gate |
| `runBumpReplicationEpochSlot` | 同上 | 现有 Promise 结果/RuntimeWriteFatalError 路径 | 完全不变；内部调用共享私有 gate |

| Caller | 文件:行号 | 是否 await | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---|:--:|:--:|:--:|---|
| Runtime enable enqueue thunk | `packages/namespace-runtime/src/runtime.ts`（enable public method） | sequencer 接管 | slot 自身完整处理 | WriteSequencer 链尾处理 | 不改 caller；行为等价测试覆盖 |
| Runtime bump enqueue thunk | `packages/namespace-runtime/src/runtime.ts`（bump public method） | sequencer 接管 | slot 自身完整处理 | WriteSequencer 链尾处理 | 不改 caller；行为等价测试覆盖 |

抓全方法：`grep -n "runEnableReplicationSlot\|runBumpReplicationEpochSlot" packages/namespace-runtime/src/*.ts`；除定义外应仅为 runtime 接线。
