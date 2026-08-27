# SA2 攻击评审报告

**Date**: 2026-08-27  
**Verdict**: reject（存在 1 个 HIGH 级设计缺口；SA1 修订后需复审）

## 审查范围与基准

本次按全新视角审查 round-2 设计，覆盖：ADR 0008 增补的窄例外边界、Phase 5 合同扩充、AC-6 两个恢复用例、以及 E1/E2 共享 gate 提取。约束基准为 `task_phase5-replication-identity-epoch_relevant_decisions.md` 和 SA8 `clear` 报告的落地条件；特别是 ADR 0006 的 **dirty registered 不等于 durable**、ADR 0008 的 FIFO/committed/fatal 纪律、ADR 0010 的 lineage/epoch 不可变性均不可被测试叙述或重构削弱。

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议 |
|---|---|---|---|---|
| 1 | **HIGH** | AC-6 用例 B：fatal committed 后 reopen/recovery | §4.3 允许在 notifier 失败后以“独立 committed seed/DocPersistence”重新打开，却没有规定该 seed 必须是**失败 bump 已提交后的同一 live Y.Doc 的快照**，也没有要求显式断言 failed notifier 所绑定的 persistence 仍未确认 durable。实现者可用预制 epoch=2 seed 通过 reopen/epoch3 断言，而没有证明 fatal 前 transaction 的 committed replication facts 被正确交接到 recovery 边界；反之又可能误把失败 notifier 的 store 当作可恢复来源，违反 committed ≠ durable。 | 将 B 拆成或钉死为两层：①同一 live doc 层：失败 bump 后立即从该 live doc `encodeStateAsUpdate`/clone 制作独立 recovery seed，明确 seed 动作发生在 rejection 之后且断言 id/epoch=2；新 Registry 只能从此 seed 打开。②原 notifier persistence 层：若其读面可观察，断言它**不能**被宣称已 durable（不得以该 store 的 reopen 作为成功前提）。用例命名和注释须明确为 *committed-state recovery*，非 File durability recovery。 |
| 2 | LOW（通过条件） | ADR 0008 窄例外措辞与普通 open 边界 | §2.3 的拟议文字总体符合 owner 授权与 SA8 落地条件，但实施时若只把“读取例外”写进新节、没有把原第 14 行“外部修改不在范围”限定为“除本节的两字段损坏外”，读者仍可将两段理解为矛盾；若未保留 issue/PR 授权来源，将失去 SA8 clear 的前提。 | ADR 增补须采用闭合措辞：仅在 Runtime 对外发布前同步读取 `META.replicationId`、`META.replicationEpoch`；唯一允许的判定为“双键均缺席 disabled”或“双键存在且均合规 enabled”；列出部分存在、undefined、格式违约、META 载体异型的构造拒绝；并明确“除此之外，原第 14 行保持不变，尤其不读取/验证 SCHEMA、ROOT 或 logical value，也不引入通用 META validation”。增补内写明 issue #132 / PR #145 feedback 1 / owner / 日期授权链。 |
| 3 | LOW（通过条件） | Phase 5 文档扩充 | §3.1 指定扩充点合理，但 Phase 5 第 15 场景同时含后续的冲突/reset archive 流程。若只把“恢复”笼统追加到该项，容易把 Slice 1 Runtime 恢复验收与尚未实现的 WS/reset 行为混为单一前置门槛。 | 将 Slice 1 内容单列为 Runtime/Lease 基础合同，明确“本 slice 不实现 session/WS/reset”；在第 15 项使用可区分子项：`15a` enable/bump 的 FIFO、dirty-not-durable、File bump durable restart；`15b` identity conflict/reset archive（后续切片）。文档必须写出 fatal committed facts 只能以 committed recovery 表述，不能升格为 durable restart 承诺。 |
| 4 | LOW（通过条件） | E1/E2 私有共享 gate 的行为等价性 | §5.2 的结果类型把 `EnableReplicationResult | BumpReplicationEpochResult` 合并，结构目前相同却可能掩盖未来入口特异的 issue 类型；更关键的是测试清单未包含“gate 成功后，enable 的 hostile input 读取发生且 bump 不读取任何 input”的边界，以及顺序 `fatal → getStatus → notifier` 的短路观测。单纯比较联合结果不足以保证零输入纪律和访问次数不漂移。 | 私有 helper 应返回共享的、入口无关的 gate-failure 形状（或泛型保留调用方结果类型），不向公共面扩散。等价测试除四类拒绝外，增加带计数/throw seam：fatal 时 `getStatus`/notifier 均零访问；non-ready 时 notifier 零访问；`getStatus` throw 时 notifier 零访问并为 `committed:false` fatal；成功时 `getStatus` 恰一次、notifier 仅在 transaction 后恰一次。另以 hostile enable input 和 bump 的计数证明 helper 不提前读取 E3-only 输入。 |

## 协议假设依据审查

- **章节存在性**：通过。设计 §8 存在，且本轮没有新增 HTTP/WS、端口或跨进程协议假设。
- **可验证性**：通过（附条件）。`replication-write.ts` 的两份现有 E1/E2 代码可直接对照，File 既有用例已使用 `waitDurableSnapshot`，故共享 gate 与 durable wait 的依据可重跑。
- **需要收紧的证据**：设计 §4.3 的“或独立 committed seed”没有规定 seed 与 failed bump 的因果衔接；这不是外部协议假设，而是 committed/durable 边界的测试证据缺口，构成上表 #1。

## 错误处理链路审查

- **静默失败**：通过。构造期 replication facts 损坏为同步 loud 构造拒绝；写槽内损坏为 `RuntimeWriteFatalError`；非 ready/notifier 缺失为 `RUNTIME_WRITE_DISABLED` 结果联合，无静默降级。
- **状态闭环**：通过（以实现/设计约束为限）。post-commit notifier failure 必须在 E5.5 后保留 live META 与 `status.replication`，同时置 fatal；新 generation 不得继承旧 Runtime 的 fatal。
- **降级路径与虚假降级**：通过。设计明确损坏 facts 不得伪装为 disabled，且 File 用例要求 durable wait。惟 B 用例必须按 #1 修订，避免把 notifier failure 后的 committed state 伪装为已 durable。
- **用户可感知性**：本轮无 UI/API 异步交互设计；Runtime 可观测结果联合、稳定码与 branded fatal 已构成调用方可处理的失败面。

## 红线测试思路

### T1 — fatal committed recovery 不得伪造 durability（对应 #1，必须新增/修订）

1. 用可失败 notifier 构造 live Runtime；enable 成功，记录 `id0`。
2. 令 bump 的 notifier reject；断言 rejection 是 `RuntimeWriteFatalError`、`committed === true`，并在**原 live doc**断言 META 与 status 均为 `{ enabled, id0, 2 }`。
3. rejection 后才从该 live doc 编码/clone 为独立 recovery seed（seed 创建前后断言其 META 为 `id0/2`）；用仅承载该 seed 的独立 persistence/new Registry `open`。
4. 断言新 generation 为 enabled/id0/2、fatal 为空、bump 成功至 3。
5. 若失败 notifier 对应的 store 可读，额外断言测试没有将其 epoch=2 当作 durable 条件；不得以它的 reopen 成功作为用例前提。用例名含 `committed-not-durable` 或等价字样。

### T2 — ADR 窄例外的边界回归（对应 #2）

经 Registry/File seed 分别构造：双键缺席（open 成功且 disabled）、双键合规（open 成功且 enabled）、恰一键、显式 undefined、错格式、META 同名异型（均在 Runtime 发布前以 `runtime-construction` loud 拒绝）。同时放入错误 SCHEMA/ROOT 值，断言只要复制键合法，普通 open 仍不因 SCHEMA/ROOT/logical validation 被本例外拒绝。

### T3 — File bump durable restart（设计 A 的补强）

create → enable → bump=2；先验证 live status/META=2，再仅以 `waitDurableSnapshot` 同时观测磁盘 id 与 epoch=2 后 shutdown/dispose。新 FilePersistence/Registry open 后断言 id 不变、epoch=2、status 精确等于 enabled 联合。加入一个反向控制说明：不得仅靠 scheduler advance 或 `saveDoc` resolve 判定 durable。

### T4 — shared gate 短路、访问纪律和双入口等价（对应 #4）

参数化 enable/bump：fatal、degraded/non-ready、notifier absent、`getStatus` throw 均断言 META 不变和 notifier 零调用。用计数 seam 锁定 fatal 不读 handle、non-ready/throw 不读 notifier、成功路径仅一次 status 读取；enable 另接 hostile getter/Proxy，确认只有通过 E1/E2 后才读取其 input，bump 无任何对应输入访问。`getStatus` throw 路径断言 branded fatal `committed:false`，而不是结果联合或裸异常。

## 复审结论

除 AC-6 用例 B 对 committed recovery seed 的因果锚定缺口外，设计对 ADR 0008 的窄例外、规范文档范围和 gate 重构方向均可接受。修订 #1 后，可在不改变现有产品行为的前提下再次提交 SA2 复审；`pass` 仍不替代 SA4/SA7 的实现与活链路验证。
