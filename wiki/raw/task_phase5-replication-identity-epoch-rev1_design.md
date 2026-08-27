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

1. **读取例外及边界**：第 14 行的“普通 open 不执行 schema、ROOT 载体或 logical validation”维持有效；但 Runtime 允许在构造、对外发布前，同步纯读 `META.replicationId` 和 `META.replicationEpoch`，仅为生成 status 的复制持久事实。明示此例外不读取 ROOT、不编译 schema、不做 logical validation、不引入通用 META validation。
2. **两态与损坏通道**：复制投影只为 `{state:'disabled'}` 或 `{state:'enabled'; replicationId; replicationEpoch}`；真缺席为 disabled。部分存在、undefined、格式不合法、异型载体为损坏，构造拒绝；禁止在损坏文档上伪装 disabled 或自动补写新 lineage。
3. **公共窄写方法**：将 “v1 公开两个窄方法” 替换为“基础 v1 方法为两个；经 ADR 0010 授权的复制管理例外另加 `enableReplication()` 和 `bumpReplicationEpoch()`”。四者均进入同一严格 FIFO sequencer，完整槽序不变。
4. **status 字段**：在第 95 行 status 列举中补 `replication`，明确仅含持久 identity/epoch，不含 session、网络、队列或 sync 状态。
5. **失败与持久化真相**：enable/bump 的成功仍只表示 commit + dirty notification 已登记，非已落盘；notify failure 的 committed facts 不回滚，fatal 之后读取与 status 保留最后已提交事实。
6. **关联权威**：字段格式、不可变性、epoch 上限与 hub-only 管理权以 ADR 0010 为权威；ADR 0008 仅规定 Runtime 槽序、投影、构造例外和失败通道。

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
| `docs/phases/phase-5-websocket-replication.md` | Slice 1 从仅列字段/方法，扩充为 Runtime/Lease 的四个管理能力、两态 status、单 sequencer、损坏 open 拒绝、dirty-not-durable 和恢复要求；“必须通过的场景”第 15 项改成明确包含 File bump recovery 与 fatal committed-facts reopen/recovery | 反馈 2、3；Phase 是实施合同 |

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

**场景**：使用现有可失败 notifier/persistence seam。创建并 enable，记录 id；在 bump 的 notifyDirty 阶段注入一次失败，断言 `RuntimeWriteFatalError` 且 `committed:true`；**不尝试在 fatal runtime 上再写**。随后通过该 persistence 的真实 snapshot/load 路径（或独立 committed seed，取决于既有 fixture 对 failed notifier 是否登记持久 snapshot 的能力）构造全新 Registry 并 `open`。

**断言要点**：

1. failed bump rejection 是 `RuntimeWriteFatalError`、`committed:true`；fatal Runtime 读取到 `replicationId===id0`、`replicationEpoch===2`，status.fatal 非空。
2. reopen/recovery 的新 Runtime（无旧 Runtime 的 fatal 状态）读取同一 committed document：META id 仍为 id0、epoch 为 2；status.replication 是 enabled/id0/2。
3. reopen 后继续 `bumpReplicationEpoch()` 可成功到 epoch 3，证明 “fatal 是 Runtime generation 的写禁用，不回滚或污染已提交复制事实，也不永久毒化下一 generation”。
4. 若当前 failure fixture 的 notifier 失败不产生可 reopen 的 persistence snapshot，测试必须使用已提交 live doc 的独立 `DocPersistence`/seed 载体来明确表达 recovery contract；不得错误宣称失败的 `notifyDirty` 已 durability-confirmed。该分支仍证明 committed META 真相，且与 ADR 0008 “committed ≠ durable” 一致。

### §4.4 更新后的 AC-6 矩阵

| 场景 | Memory | File | committed/fatal |
|---|---:|---:|---:|
| enable + close 排空 + reopen | 已有 | SA7 dynamic 已有 | N/A |
| degraded retry 后 epoch 2 reopen | 已有 | 不要求重复 | N/A |
| enable epoch 1 durable reopen | N/A | 已有 | N/A |
| **bump epoch 2 durable reopen** | N/A | **新增 A** | N/A |
| fatal committed bump 后 facts 保留，并在新 generation recovery/reopen | **新增 B（fixture/seed）** | 可由 future durability-specific test 扩展，不在本 PR 伪造 durability 保证 | **新增 B** |

---

## §5. 反馈 4：提取 replication write 共享 gate

### §5.1 裁决

**本 PR 提取 E1/E2 为 `runReplicationWriteGate(env)`（私有、未导出）**。理由：两处当前逐字复制 fatal、`handle.getStatus()` try/catch、non-ready refusal、notifier missing refusal 及 notifier capture；复制管理未来还可能增加受控 META 操作。此时抽取是低风险、减少策略漂移的净收益，而不是过早泛化到 ROOT/SCHEMA 的不同 issue 类型。

### §5.2 私有接口与伪代码

```ts
type ReplicationWriteGateResult =
  | { readonly ok: true; readonly notifyDirty: () => Promise<void> }
  | { readonly ok: false; readonly result: EnableReplicationResult | BumpReplicationEpochResult };

function runReplicationWriteGate(env: ReplicationWriteEnv): ReplicationWriteGateResult {
  // E1：fatal 已置位 → disabled('fatal…')；零输入读取
  // E2：getStatus throw → rejectWithWriteFatal(..., false, 'write-slot-internal', ..., 'replication')
  //     non-ready → disabled(既有同一 message)
  //     notifier absent → disabled(既有同一 message)
  //     success → 捕获 notifyDirty 并返回
}
```

`runEnableReplicationSlot` 与 `runBumpReplicationEpochSlot` 均在自己的 E3/E4 前调用此函数；返回 `ok:false` 时直接返回 gate 的**原始结果**。不合并 E3 输入校验、E4 facts、E5 transaction、E5.5 status 同步、E6 notifier await；所以：

- FIFO 与 `WriteSequencer` 接纳顺序不变；
- fatal/degraded/notifier/lifecycle 的 stable code/message、零输入访问和 `committed:false` 语义不变；
- enable 的 Proxy 单读捕获仅仍在 gate success 后执行；
- bump 的 no-input 路径不被迫模拟 enable input；
- 函数私有，不扩公共 exports 或类型面。

### §5.3 共享 gate 测试

在 `packages/namespace-runtime/test/runtime-replication-write.test.ts` 追加参数化/成对用例，分别经 enable 与 bump 验证：fatal pre-gate、degraded/non-ready、notifier absent、`getStatus` throw。断言两个入口有相同结果联合或同类 `RuntimeWriteFatalError`、零 META 改动、零 notifier 调用。该测试以行为锁定重构，而非测试私有 helper 名称。

---

## §6. 不变量与失败通道（修订后）

1. **普通 open 范围不回流**：除 META 两个复制保留事实的纯读例外外，不做 schema/ROOT/logical validation。
2. **两态诚实**：status.replication 永不把合法 enabled 或 corrupt facts 伪装成 disabled；网络状态仍只属于后续 ReplicationSession。
3. **构造拒绝零副作用**：corrupt facts 在 P0 入队前拒绝，未写 doc、未登记 dirty、未创建 Runtime public surface。
4. **写槽同构**：enable/bump 均通过共享 E1/E2，再独立完成 E3–E7；成功含 live commit + dirty registration，不等于 durable snapshot。
5. **fatal 真相**：post-commit notifier failure 不回滚 META；旧 generation 禁写但仍可读，新的 Runtime generation 从已恢复的 committed document 投影同一 facts。
6. **File durability 真相**：测试先等待磁盘快照具体 epoch，才销毁 writer/restart；禁止将 `saveDoc` resolve 当作落盘。

---

## SA2 反馈逐条回应

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|---|:--:|---|---|
| 反馈 1：构造期 V2.5 与 ADR 0008:14 冲突二选一 | ✅ | §2、§3.1；ADR 0008 ALLOW 项 | 选择保留 V2.5，明确它是 META 两保留事实的纯读、两态 status 所必需的窄例外；设计 ADR 增补文字、损坏构造拒绝语义和非回流边界。 |
| 反馈 2：两个窄方法/status 缺 replication，枚举全部规范落点 | ✅ | §3 | 列出 ADR 0008 与 Phase 5 必改；逐份核实 ADR 0010/0006/0009、protocol、CONTEXT 不需改；明示 wiki/raw 仅历史证据。 |
| 反馈 3：补 File bump 恢复与 fatal reopen/recovery | ✅ | §4 | 指定同一 SA6 owned AC-6 文件、具体场景、durable wait 和 reopen 断言；fatal 场景明确 committed 不等于 durable，避免虚假保证。 |
| 反馈 4：E1/E2 gate 重复 | ✅ | §5 | 裁决提取私有共享 gate，保留所有原有通道/文本/时序，并增加双入口行为等价性测试。 |

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
