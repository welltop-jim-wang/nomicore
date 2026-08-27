# SA2 攻击评审报告 — issue #133 round=2

**Date**: 2026-08-28
**Verdict**: **reject**

- 评审对象：`wiki/raw/task_phase5-bootstrap-archive-reset-r2_design.md`。
- 约束基准：`task_phase5-bootstrap-archive-reset-r2_relevant_decisions.md` 所摘 ADR-0006/0008/0009/0010 条款，以及 R2 任务简报 R2-AC-1..6。
- 审查方式：全新视角阅读任务简报、R2 设计、SA6 红锚、round-1 设计/SA2 审计轨迹，并核对当前基线 `registry.ts` / `contract.ts` / `lifecycle.ts` 的 carrier、Runtime close、Persistence 生命周期和错误类型事实。
- 边界：本报告仅裁决设计；`pass` 不替代后续 SA4/SA7 对实现和活链路的验证。

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 可执行修订要求 |
|---|---|---|---|---|
| 1 | **CRITICAL** | reset 的 closing generation | §3.4 明定 `current.phase === 'closing'` 时“preserve round-1 behavior”，而伪码实际会在该 generation 已被先前操作破坏后继续执行 persisted probe，随后可能 archive。它既没有在 destructive preflight 前可靠取得/验证该 generation 的 live identity，也没有把该场景收敛为明确的非成功结果；更严重的是，当先前 close 已清 entry、同 key reset 随后读到 `current === undefined`，伪码会只核对 persisted 而直接返回 `NAMESPACE_RESET_IDENTITY_MISMATCH`，语义和零破坏承诺都不完整。R2-AC-1 的“当前 generation/lease/runtime 完全保持可用”不能被已经 closing 的代际偷换掉。 | 冻结 closing 分支：本 reset 若观察到同 key closing generation，必须等待其既有 close 结算并**重新从 carrier 槽起点读取 entry/persisted 事实**；不得将旧 `current` 用作 live 证据。明确结果分类：已跨越 close 的 generation 不可宣称 R2 零破坏；若 close 后 primary 仍在，必须重新建立受控 live projection 或以明确 `RESET_FAILED`/fatal 结束，绝不能仅凭 persisted 值视作通过。补充伪码、映射表及 ADR-0010 修订文字。 |
| 2 | **HIGH** | preflight 与 Runtime 写序列器竞态 | §3.5 承认 preflight 后到 `beginCloseCurrent()` 前 Runtime 写可改变 live identity，随后 archive guard 才在 close 后拒绝。这会让一次 reset 请求在 preflight 成功后释放 lease、关闭仍可用 generation，最后才返回 `NAMESPACE_RESET_IDENTITY_MISMATCH`。这虽被设计称为“不可避免”，但与反馈 1“身份不匹配时不得破坏当前 generation，原 lease/runtime 应保持可用”直接冲突：最终被拒绝的 reset 的实际 mismatch 仍发生在破坏前已排队/可线性化的 Runtime 写上。carrier FIFO 不覆盖 Runtime sequencer，故不能证明该窗口不存在。 | 设计必须给出可线性化方案，而非把该窗口降格为“late rejection”：例如为 preflight/close 建立 Runtime 内部受控 snapshot/fence，在同一 Runtime sequencer 中取得 identity 并阻止后续 replication identity mutation，或将 close admission 原子地与身份核验绑定。若 Runtime deny-list 使该方案不可实现，应明确把 AC 与 ADR 修订为可接受的语义并取得 owner 决议；在当前 AC 下不能放行。还须定义 close 前已接纳、但 preflight 后才执行的 enable/bump 的结果。 |
| 3 | **HIGH** | committed probe 的错误分类和契约边界 | §3.3 承诺 probe 对 `DocLoadOperationalError` 映射 `NAMESPACE_LOAD_FAILED`，但新增 seam 的声明只返回 `CheckedReplicationIdentity | 'missing'`，未冻结 throw taxonomy、decode/corruption 的精确类型、owner/docId 校验和 epoch/dispose 处理规则。当前 `DocLoadOperationalError` 的定义专属于 `loadDoc` 的底层 read；设计又要求 probe 不走 loadDoc/cache。若实现用 bare error，Registry 将 fatal；若错误包裹不当，可能错误返回 load failed 或把持久化损坏伪装为 identity mismatch。此处决定 committed 诚实与无泄露边界，不能留给 SA3 自行猜测。 | 在 Persistence contract/ADR-0006 修订中增加 probe 的完整结果与拒绝矩阵：primary read reject → 明确的 typed operational error（可复用 `DocLoadOperationalError` 的条件、或新增专用只读 probe error）；缺 snapshot；快照 decode/META.docId/replication facts 损坏；disposed/epoch abort；未知 adapter 违约分别如何映射。Registry 映射必须列入 reset 矩阵，确保 operational 才是 `NAMESPACE_LOAD_FAILED`、损坏为 loud fatal（不泄露内部 identity）、mismatch 仅用于成功读取且格式合规但与 expected 不同。 |
| 4 | **MEDIUM** | `expectedReplicationIdentity` 输入与零副作用 | §4.2 说 expected 在“公共入口”结构验证后才进入 carrier，但没有给出该公共入口的完整伪码、验证函数/格式口径、`undefined`/getter throw/畸形对象的收编方式，也没有更新 §7 caller audit 的所有调用位置为实际四参数传递。设计还没有说明 expected 校验是否在对 `docRef` 读取前执行，尽管文字声称如此。公共 API 演进若只在类型面锁四元组，JS/不可信调用可把 malformed expected 混入身份检查，导致错误码漂移或读取敌意 doc。 | 增补 `importReplica` 公共入口的冻结伪码：acceptance → owner/namespace identity → expected 的无副作用 runtime validation（对 getter/非对象异常明确收编）→ 才 carrier admission 与 doc META 读取；非法 expected 走既有 `NAMESPACE_INVALID_IDENTITY`/明确调用约定，零 Persistence、零 entry、零 doc dereference。更新 caller inventory，以实际检索输出及 future Hub 调用“认证广告来源”契约为准。 |
| 5 | **MEDIUM** | 归档 ADR 的原子语义与 committed 诚实 | §5.1.3/4 对 archive 写道“archive write resolves only after tmp→rename, then primary removal follows”，却没有在 ADR 修订稿中明确 **primary removal 失败后** archive 已提交、结果必须以 committed:true fatal 传递、重试如何处理 archive slot/primary 双存状态。round-1 设计已有 `relocate-remove` committed:true 分类；R2 的 ADR 摘要仅称“classification retained”，不够形成 ADR-0006 的规范闭环。遗漏会使新 ADR 与实际 `archiveDoc` 合同脱节。 | ADR-0006 追加文本必须列明提交点、remove failure 的 `committed:true`、禁止把该情形映射成普通 operational/领域 mismatch，以及重试的收敛规则（archive latest-wins、primary 尚存时重新 guard/relocate 的语义）。ADR-0010 亦需说明 Registry 原样传播 committed fatal，不能把已归档状态宣称为未改变。 |

## 关键攻击推演

### 1. closing generation 不是可跳过的 R2 preflight

**触发条件**：同 key 的 idle timer / 先前 reset / shutdown 已同步使 entry 进入 `closing`，第二个 reset 排在同一 carrier 后。

**影响**：第二个 reset 看到的 live 状态不是 active Runtime 的可用投影；若沿用 round-1 “await close → load/archive”逻辑，可能归档或报 mismatch，但不能满足 R2-AC-1 的零破坏语义。若 entry 已由 close completion 删除，伪码还把“无 live entry”与“正常不存在”混用。

**修订要求**：见攻击点 #1；要有明确 carrier re-evaluation 和结果分类，不得使用过期 `current` 引用。

### 2. 双真相源的两次异步读无法自然构成原子快照

**触发条件**：preflight 读取 live 与 persisted 后，已被 Runtime FIFO 接纳的 `bumpReplicationEpoch()` 才运行；随后 reset 发起 close，close barrier 必须排空该写。

**影响**：preflight 时双方可能都等于 expected；close barrier 后 live/settled persisted 已不同；archive 拒绝时 lease/runtime 已被 force release/close。最终 mismatch 对调用者而言仍是“身份不匹配但旧 generation 被破坏”，违背本轮反馈的核心目的。

**修订要求**：见攻击点 #2；测试必须证明 fence 或等价线性化点能够阻止此交错，而不是只测试 dirty 但没有 post-preflight mutation 的两个 SA6 场景。

## 协议假设依据审查

- **章节存在性**：通过。设计 §9 声明无 HTTP/WS、端口、进程时序或第三方协议假设，且本轮范围确为进程内 Registry/Persistence API。
- **可验证性**：部分通过。对 carrier FIFO、Runtime close barrier、dirty-not-durable 的依赖均可由 ADR 和源码验证。
- **不足**：reset 安全性实际上额外依赖“preflight 与 close 之间不会产生相关 Runtime 写”或“late rejection 可接受”，但设计没有给出可验证机制，且 ADR-0008 明示 close 要排空此前已接纳写。这正是 HIGH #2，不能视作无协议假设。

## 错误处理链路审查

- **静默失败**：probe capability 缺失被设为 loud fatal、I/O 不回退到 live-only，方向正确；但 probe 的 typed failure taxonomy 未冻结（HIGH #3），实现可能把损坏/abort 错分类。
- **状态闭环**：无 UI `exStatus` 面，适用对象为 Registry 结果 union / branded rejection。reset 的 closing 分支和 post-preflight mutation 分支尚无可接受闭环（CRITICAL #1 / HIGH #2）。
- **降级与伪降级**：拒绝在 degraded I/O 时 fallback 到 live-only 是正确的，非伪降级；但不能把“close 后 archive guard 才发现 mismatch”称作可接受降级，因为这是正常前置条件缺口，应通过 fence 修复或 loud 阻断。
- **零泄露**：新 import mismatch message 不回显 owner、namespaceId、identity，正确；probe 的 corruption/fatal message 同样应采用稳定无身份文本，作为 #3 的具体要求。

## 红线测试思路

1. **closing generation 重置**：制造 idle close 已翻 `closing` 但 close promise 被受控阻塞；随后排队 `resetReplica`。断言设计指定的结果、不得把仍在关闭的 generation 当作 preflight 成功；若最终 mismatch，断言不会额外 archive，且 observer/result 的 committed 语义一致。
2. **post-preflight FIFO 写竞态**：在 persisted/live 都等于 expected 后，钩住 reset 在 probe 完成、forceRelease 前；通过现有 lease 排队 `bumpReplicationEpoch()`，再放行 reset。修复后断言 reset 的线性化 fence 要么阻止 bump，要么 reset 在任何 lease/close/archive 副作用前拒绝；旧设计会在 archive guard 才拒绝且 lease released。
3. **probe 分类矩阵**：分别注入 read reject、snapshot 缺失、损坏 Yjs bytes、META.docId 不匹配、单键/非法 epoch、dispose abort。断言：仅实际 read reject → `NAMESPACE_LOAD_FAILED`；active entry 缺 snapshot/损坏/abort → branded fatal、`committed:false`；所有这些情形 destructive counters 均为零且无 identity/owner 回显。
4. **malformed expected 零访问**：以 `null`、数组、getter throw、非法 id/epoch 调用 `importReplica`。断言稳定输入拒绝，`doc.getMap` 未触发、`importDoc` 未调用、store/entry 无变化；正确 expected 随后可成功重试。
5. **archive remove fatal ADR 落地**：File/Memory fault seam 使 archive write 已 resolve、primary remove reject。断言 Persistence fatal 与 Registry fatal 都是 committed:true；归档提交事实不被 `RESET_FAILED` 或 `NAMESPACE_RESET_IDENTITY_MISMATCH` 伪装，重试遵循 ADR 声明的收敛规则。

## 裁决

**reject。** 严格双真相源的方向和 SA6 对“dirty live / old persisted”两向拒绝的红锚口径均合理；import 的 Hub 广告等值核对也位于 ownership transfer 前，且新错误码保持零泄露。然而设计尚未解决“preflight 成功后、close 前已有 Runtime sequencer 写”的核心线性化漏洞，并对 closing generation 和 probe 错误契约规定不足。上述 CRITICAL/HIGH 项修订并经 SA2 复审前，不应进入实现。

---

# SA2 R2 复审 — R2-R1 修订攻击验证

**Date**: 2026-08-28
**Verdict**: **reject**

本段只复审 SA1 对本报告 R1 reject 的 R2-R1 修订。R1 的五项原始问题中，closing re-evaluation、probe 分类学、敌意 expected 输入和 archive remove-failure ADR 闭环已作出实质性规格化修订；但新增 Runtime reset fence 引入一个仍未封闭的生命周期/死锁风险，不能放行。

## R1 阻断点复核

| R1 项 | 复核结论 | 证据与裁决 |
|---|---|---|
| R1-1 closing generation | **已消解** | §3.4 规定 await exact `closePromise`、carrier slot re-read、无 primary → `NOT_FOUND`、primary 尚在 → `RESET_FAILED`、且零 archive。它不再把旧 Runtime 作为 live 证据，也不把 persisted-only 误作 preflight success。closing matrix 与 ADR-0010 修订一致。 |
| R1-2 preflight/Runtime FIFO 竞态 | **部分消解，见新 BLOCKER** | §3.4/§3.5 正确识别 carrier FIFO 不足，并将 live 读取、persisted probe 与 closing admission 放进同一 Runtime FIFO task。若 fence 能安全完成，该线性化口径能消除“probe 后、close 前”新 identity mutation。可是该 task 内 `await readPersisted()` 与 Runtime close/lifecycle 的现有结构存在死锁/承诺冲突，见下表 #1。 |
| R1-3 probe taxonomy | **已消解** | §3.3.1 明确 `operational/corrupt/fatal`、missing、可读但复制字段不合规的结果分界，承诺无写、`committed:false` 和无输入回显；Registry 只把 current-epoch I/O reject 映射 `NAMESPACE_LOAD_FAILED`。 |
| R1-4 hostile expected | **已消解** | §4.2.1 把 expected 安全快照提前到 doc/carrier/entry/Persistence 之前，并覆盖 getter/Proxy throw、继承属性及数值畸形输入；测试断言包含零 doc access 与可重试性。 |
| R1-5 archive committed ADR | **已消解** | §5.1.4 / §5.2.5 明确 archive write/rename 为提交点，remove reject 是 `relocate-remove`、`committed:true` fatal，Registry 原样传播并以 latest-wins 重试收敛。 |

## 新攻击点清单

| # | 严重度 | 攻击面 | 触发条件与影响 | 必须修订 |
|---|---|---|---|---|
| 1 | **BLOCKER** | FIFO fence 内 await persisted probe × Runtime close barrier | `beginResetFence()` 在 Runtime 唯一 write sequencer 的 task 内 `await readPersisted()`（§3.4:156-159）。设计又要求同一 task 在核验成功后同步进入 closing，并复用 close barrier。必须明确 Runtime 的 close barrier 是否、何时被启动和是否等待当前 sequencer task；现有 ADR-0008 的 close 语义是 close 入队 barrier 后排空此前任务。若 `beginCloseBarrierAlreadyArmed()` 创建/await 的 barrier 包含当前 fence task，则 fence task await close completion、close barrier await fence task，形成自等待死锁；若 close admission 在 probe await 前已切 lifecycle=closing，则 probe operational/mismatch 的“零破坏”承诺被破坏。设计没有给出无环的机械顺序。 | 冻结一个可证明无自等待环的 Runtime 内部协议，并写清 state transition 的精确瞬间：推荐将 fence task 在同一 sequencer task 中完成 probe+live compare，成功时**只同步设 closing 并构造一个不等待当前 task 的 close continuation/barrier**；当前 task 必须先 resolve，之后 close drain 才等待先前任务，且 `closePromise` 的完成不得成为该 task 的 await 前提。若采用专用 internal close primitive，须证明普通 `close()` 幂等、FIFO、已接纳任务无条件排空和公共 read/write gate 不回归。 |
| 2 | **HIGH** | armed 后 archive identity guard 的错误映射 | §3.5:231 规定 armed 后 archive guard 发现 mismatch 应当是 `RESET_FAILED`/fatal，“never domain mismatch”，但 §3.4 伪码 :215 仅 `await archiveDoc(...)`，没有冻结 `DOC_ARCHIVE_IDENTITY_MISMATCH`、`DOC_ARCHIVE_OPERATIONAL`、`DOC_ARCHIVE_FATAL` 的 reset 映射。round-1 当前 Registry 把 identity mismatch 映射为 `NAMESPACE_RESET_IDENTITY_MISMATCH`，而 R2 成功 armed 后该映射已被明确禁止。实现者若沿用矩阵会违反新语义；若把所有错误裸抛又丢失既有 operational domain 结果。 | 在 §3.4/§3.5 加 armed-only archive catch 映射表：identity mismatch → 明确 `RESET_FAILED` 或 branded committed:false fatal（择一并说明外部修改语义）； operational → `RESET_FAILED`； fatal → `NamespaceRegistryFatalError` 且 `committedOf(cause)` 原样传播；unknown → fatal false。将其与 ADR-0010 文字、round-1 分类学和测试一并锁定。 |
| 3 | **MEDIUM** | Runtime internal capability 的封装与测试替身 | §8 把 Runtime `types.ts` 增加 internal capability，却要求 Registry 直接调用 `current.runtime.beginResetFence`。当前 Runtime 是独立包且 Registry 依赖 public facade；设计只说“禁止经公共 barrel 暴露”，但没有给出 Registry 如何在不引入 internal subpath/声明图泄露/测试 runtime factory 断裂的情况下获得该方法。更重要的是，R2 Registry test factories 可能提供现有 Runtime shape，缺方法时不能在 preflight 前稳定 loud failure。 | 明确 capability 的可达路径（受控 type-only/internal factory 或 Registry-only constructor injection），并列出所有 Runtime factory/test fake 的适配策略。Registry 必须在 destructive 前 `typeof beginResetFence === 'function'` gate；缺失 → `NamespaceRegistryFatalError(reset, lifecycle-slot-internal, committed:false)`，不得 property-call TypeError 或 fallback。加入 type-level/internal-surface test，证明 public Runtime barrel 不扩大且 Registry 声明图不泄露禁词。 |

## 新机制攻击推演

### Fence 生命周期顺序

R2 的安全目标成立需要两个同时成立的性质：

1. fence 读取 persisted 时 lifecycle 仍为 active，故 mismatch/probe failure 不改变 lease/runtime；
2. 成功时 closing 在 FIFO task 返回前同步建立，故之后的 mutation 不能插入；
3. close barrier 又不能等待尚未返回的 fence 自己。

当前伪码只表达 1 与 2，未表达 3。由于 `beginCloseBarrierAlreadyArmed()` 的实现、`closePromise` 建立顺序和是否覆盖当前 task 未冻结，SA3 可以写出看似遵守文字却挂起的实现。该问题是 liveness blocker，且会使 Registry carrier/shutdown 等待永不结算。

### armed 后失败闭环

一次 `{kind:'armed'}` 已发生不可逆 close admission，因此之后不能再返回“零破坏 identity mismatch”。这一原则在 §3.5 的文字正确，但必须在 Registry 的 archive catch 实际分类中落位；否则 round-1 `DOC_ARCHIVE_IDENTITY_MISMATCH → RESET_IDENTITY_MISMATCH` 代码路径会悄然回归，造成结果语义自相矛盾。

## 协议假设依据复审

§9 的“无 HTTP/WS 假设”仍成立。但 Runtime FIFO fence 不是普通 TypeScript 细节：它对 close barrier 的排空/自等待顺序作出新的并发协议假设。该假设必须在设计中以可定位的源码机制或明确伪码证明；当前缺失，故不能以“无协议级假设”略过。

## 错误处理链路复审

- probe 的错误分类、无 fallback、无身份回显和 `committed:false` 规则已形成闭环。
- active generation 的 mismatch/probe failure 均在 force-release/close/archive 前结算，方向正确。
- armed 后失败链仍缺 archive typed-error 映射；不能把已关闭 generation 的错误静默降级成普通 mismatch。
- capability 缺失必须在 Runtime fence 调用前 loud fail，防止 `TypeError` 取代稳定 branded fatal。

## R2 红线测试思路

1. **fence 自等待测试**：对 Runtime sequencer/close primitive 做可控 gate；调用 matching reset，并验证 fence task 自身先结算、随后 close barrier 排空，`resetReplica` 与 `shutdown()` 都在有限微任务内结算。专门断言 close barrier 不等待当前未返回 fence task。
2. **probe failure 零破坏**：在 fence task 内使 `readPersisted` operational reject / corruption / abort；断言 lifecycle 仍 ready、原 lease active/readable、无 close/forceRelease/archive，且结果严格遵守 §3.3.1。
3. **armed 后外部修改**：matching fence arm 后，在 archive guard 处注入外部 store identity 改变；断言不返回 `NAMESPACE_RESET_IDENTITY_MISMATCH`，而按新 frozen matrix 返回 `RESET_FAILED` 或 committed-aware fatal；原 lease 已释放这一事实与结果一致。
4. **missing internal capability**：用旧形状 Runtime fake 创建 Registry 后 reset；断言在零破坏时 branded fatal、无 `TypeError`、无 archive/close，并验证正常 Runtime public export 未增加该 internal API。
5. **closing matrix回归**：hold pre-existing close、依次覆盖 primary missing / exists / probe operational / corrupt；断言无 archive、旧 Runtime 从未被用于 `getStatus`/fence，分别命中 `NOT_FOUND`、`RESET_FAILED`、`LOAD_FAILED`/fatal 的冻结通道。

## R2 裁决

**reject。** R1 的 closing、probe taxonomy、hostile expected 与 ADR committed-true 闭环均已实质落地；新增 fence 的线性化意图也正确。不过，fence task 内等待 persisted probe 后再开始 close 的协议尚未证明不与 close barrier 自等待，且 armed 后 archive guard 的分类矩阵没有被伪码冻结。这两个问题修订并通过复审后，方可放行实现。

---

# SA2 R3 复审 — R2-R2 修订攻击验证

**Date**: 2026-08-28
**Verdict**: **pass**

本轮复审对象为 R2-R2 修订后的同一设计。R2 的三项 reject 条件均已在机制级冻结，未发现新的可执行阻断点。

## R2 阻断点复核

| R2 项 | 结论 | 复核依据 |
|---|---|---|
| R2-1：fence/close 自等待 | **已消解** | §3.4:158-183 将 fence task 限定为 `probe → live compare → synchronous arm → return`，明确禁止 task 内创建或 await close barrier；`startCloseAfterFence()` 只能在 `fenceTask.then` 的 post-settlement continuation 中懒创建 barrier。§3.5:249-255 明确 predecessor tail 的捕获时点在 fence 已结算之后，依赖图没有 `fenceTask → closePromise` 或 `closePromise → fenceTask` 边。Registry 在 task 外调用并 await close promise，故不存在先前的互等环。 |
| R2-2：armed 后 archive 映射 | **已消解** | §3.5.2 定义 `mapArmedArchiveFailure` 完整覆盖五类 typed/unknown rejection：identity、active、duplicate、operational 都为 `NAMESPACE_RESET_FAILED`；fatal 保留 `committedOf(cause)`；unknown 以 false fatal 收口。§3.4:234-238 已实际调用该映射，ADR §5.2 同步禁止 armed 后返回 `NAMESPACE_RESET_IDENTITY_MISMATCH`。 |
| R2-3：internal capability 可达/缺失 | **已消解** | §3.5.1 明确 `RuntimeForRegistry` 只经 Registry-only factory/testing seam 注入，禁止 Runtime public barrel 与 Registry internal-subpath import；并在 persisted probe、force-release、close、archive 前以 `typeof` 做 constant-message branded fatal(false) gate。§6/§8 有 public-surface、legacy fake 和 missing-capability 测试锚。 |

## 二段 fence/close 协议攻击复核

### 1. tail 捕获与无自等待

- fence task 排入唯一 write FIFO；其唯一 await 指向 `readPersisted`，此时 lifecycle 仍 ready，故 probe 失败/mismatch 不破坏 generation。
- match 时同步 arm closing 后 task **返回**。只有已结算的 `fenceTask.then` continuation 才可创建 lazy barrier；按冻结定义，predecessor tail 在这一时刻之后取得，不能包含仍活动的 fence task。
- Registry 自身在 `beginResetFence()` resolve 后才 force-release 并调用 `startCloseAfterFence()`；即使 Registry shutdown 并发，shutdown 仅等待 carrier tail，而 carrier tail 等待的 reset 槽不会被 Runtime barrier 反向等待，因而不存在跨层环。
- 普通 `close()` 在 fence-armed 状态返回同一 lazy-created promise，且公共入口不新建第二 barrier。该要求保留 close 幂等和 ADR-0008 对先前已接纳任务无条件排空的条款。

结论：设计给出了足以由 SA3 实现、SA4 静态验证、SA7 动态压测的无环顺序。唯一的 `readPersisted` 外部 I/O 挂起不是 fence/close 循环，且仍在 lifecycle ready、零破坏阶段；这不是本设计引入的死锁。

### 2. shutdown 与 armed 失败

fence armed 后 Runtime 已 closing，后续 enable/bump 被 lifecycle gate 拒绝；先前 FIFO mutation 已在 fence sample 前结算。close barrier 在 task 后创建并由 reset 槽等待，因此 shutdown 等 carrier tail 时仅等待一个单向有限链。close reject、archive typed reject 与 committed fatal 均有确定结果通道，不会把已关闭 generation 伪装成 zero-destruction mismatch。

### 3. RuntimeForRegistry 泄露审查

结构 capability 经 factory 注入，而非 public Runtime export 或 Registry public declaration；设计显式禁止 Registry source import Runtime internal subpath，并要求 public barrel / Registry d.ts 审计。此安排保持 ADR-0008 的 Runtime encapsulation，同时允许 Registry 获得唯一的 reset 编排能力。missing fake 被 loud gate 拒绝而非 fallback，属于真实配置/集成错误的正确阻断，不是伪降级。

## 协议假设依据复审

§9 无 HTTP/WS/端口/跨进程假设的声明仍成立。新增并发机制的假设已经由 §3.4/§3.5 的 FIFO task、post-settlement tail 捕获、idempotent close promise 及可执行测试锚具体化；不再依赖无证据的“不会竞态”推断。

## 错误处理链路复审

- **静默失败**：probe/capability/fatal 均显式结果或 branded rejection；无 live-only fallback。
- **状态闭环**：pre-arm mismatch/probe failure 保持 active；armed 后 archive failure 由 §3.5.2 矩阵完整收口。
- **降级纪律**：degraded I/O 仍只走 typed operational mapping；missing internal capability loud fatal，未被伪装为业务拒绝。
- **零泄露**：新增 observer/fatal/input issue 均规定固定消息及不带 identity 内容。

## R3 交付后红线验证

后续 SA3/SA4/SA7 必须实际验证，而非仅采信设计：

1. 用可控 FIFO 和 fake scheduler 证明 `fenceTask` resolve 发生在 barrier 创建之前，并发 `resetReplica + shutdown()` 在有界 microtask turn 内结算。
2. 断言普通 `close()` 与 `startCloseAfterFence()` 返回同一 promise，且不会第二次提交 close barrier。
3. armed 后逐个注入 `DOC_ARCHIVE_IDENTITY_MISMATCH`、`ACTIVE_HANDLE`、`DUPLICATE`、`OPERATIONAL`、各 fatal phase 和 unknown；逐项验证 §3.5.2 的结果及 committed truth。
4. 断言 production factory 满足 `RuntimeForRegistry`，legacy fake 缺 capability 时在所有 destructive action 前 branded fatal(false)，并审计 Runtime barrel / Registry d.ts 无 capability 泄露。
5. 保持 SA6 两个 dirty race 的严格拒绝、零 force-release/close/archive/store write 断言，以及全量既有用例绿。

## R3 裁决

**pass。** R2-R2 的二段协议已把 fence sampling/arm 与 close-draining 解耦，并以 post-settlement tail 捕获消除了自等待；armed-only archive 映射和 Registry-only internal capability gate 也已冻结且可测试。允许进入 SA3 实现；本 pass 不替代 SA4 对实现结构、SA7 对 FIFO/shutdown 活链路的验证。
