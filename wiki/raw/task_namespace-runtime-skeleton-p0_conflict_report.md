# 冲突门禁报告

- 被审对象：`wiki/raw/task_namespace-runtime-skeleton-p0.md`（issue #89，Phase 0 前置门禁；任务类型 feature）
- 冲突基准：`docs/adr/0001`–`0008` 全集（8/8 逐个全读，无抽样）+ `CONTEXT.md`
- run_id: issue-89-1787497173-442625 · branch: fix/issue-89-on-docs-namespace-runtime

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| 0001 | VFSL 文本是 schema 的唯一真相源（含 2026-08-19 修订、2026-08-21 命名修订） | accepted | 相关 | no-conflict：P0 经 `compileSchemaEnvelope` 编译 SCHEMA 信封，与信封/`SCHEMA` 键名/方言 loud-fail 条款一致；任务不含仓内 schema 文本诉求 |
| 0002 | nomicore 是全新重写，authority 完全出范围 | accepted | 弱相关 | no-conflict：任务不引入任何 authority 式不变式机制 |
| 0003 | 求值器与派生 schema（evaluate 接缝、ROOT 别名、联合表示、按名引用） | accepted | 相关 | no-conflict：P0 不读取/验证 ROOT，不触 ROOT 约定；编译链路走既有 parse/evaluate 公共接缝 |
| 0004 | vfsl-protocol 类型投影（D1–D5） | accepted | 不相关 | no-conflict：任务不触碰协议包/类型投影 |
| 0005 | 投影生成管线（SchemaSource/生成器/生成物入仓） | accepted | 不相关 | no-conflict：任务不触碰 codegen/domains |
| 0006 | Cordis 持久化——DocPersistence 与 doc 三条目布局（含 issue #64、#79 修订节） | accepted | 相关 | no-conflict：Runtime 独占 DocHandle、owner/namespaceId 分区身份、`getStatus()` entry 级语义与 SCHEMA/META/ROOT 三条目布局全部按条款消费，未改持久层契约 |
| 0007 | 逻辑验证与 Yjs Runtime Bridge 分层 | accepted（Runtime/open/read 条款由 ADR-0008 部分取代） | 相关 | no-conflict：任务遵循 ADR-0008 模型（发布前 P0 入队、发布后 schema-independent read）；被取代的 open/read 编排与 schema-aware read 签名不构成约束，未与之对照计冲突；继续有效条款（compileSchemaEnvelope、fatal、零写入、observer no-rollback）均被遵守 |
| 0008 | NamespaceRuntime 读写能力与单序列器 | accepted | 直接相关（本任务行为契约来源） | no-conflict：简报是其显式声明的子集实现，逐条对照见下 |

无任何 ADR 处于整体 superseded 状态（0007 仅部分条款被 0008 取代，两文均已显式记录取代范围）。

## 冲突点

无 hard-violation、无 override-declared、无 evolution。以下为逐条对照记录（均判 no-conflict），供复核：

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| 1 | info | ADR-0008「本决策建立独立包 `@nomicore/namespace-runtime`。它组合……不承担 Registry、鉴权、REST/WS、Persistence 实现或原始 Yjs 同步协议」 | 简报「建立独立 @nomicore/namespace-runtime 包」 | no-conflict | 包名与职责边界逐字一致 |
| 2 | info | ADR-0008「Runtime 成功构造后独占一个 `DocHandle`；构造失败时所有权仍归调用方。Runtime 不公开 handle、Y.Doc、ROOT/SCHEMA/META live 引用或生产构造器。生产工厂保留包内……」 | AC1「独占一个 DocHandle，生产构造器不从公共 package entry 导出，失败时所有权不转移」 | no-conflict | AC1 是该条款的忠实转写 |
| 3 | info | ADR-0008「Runtime 公开冻结的 `owner.userId` 与 `namespaceId` 身份投影；它们是分区/文档身份，不代表授权」+ ADR-0007「业务调用方不得取得可写 Yjs 引用或绕过该入口」 | AC2「公开冻结的 owner.userId/namespaceId，不公开 DocHandle、Y.Doc 或 writable Yjs reference」 | no-conflict | 与 ADR-0008 所有权条款及 ADR-0006 owner 分区键语义一致 |
| 4 | info | ADR-0008「读取不等待 P0 或任何写任务，也不进入 sequencer」+「读取只观察调用瞬间已经提交的 live Y.Doc」 | AC3「read/getSchemaEnvelope/getMetadata/getActiveSchema/getStatus 均为同步只读能力，读取不等待 P0」 | no-conflict | 同步读取面语义一致（getStatus 形状边界见结论注记 1） |
| 5 | info | ADR-0008「`getSchemaEnvelope()`……四个 primitive string，忽略额外键，不 coercion 或补默认值」「`getMetadata()` 深拷贝……值只允许 JSON-compatible plain value……v1 不提供 META 写」+ CONTEXT.md「信封」 | AC4「getSchemaEnvelope 只投影四个 primitive string 标准键并忽略额外键；META 返回全部 plain JSON 字段」 | no-conflict | 逐字对应；CONTEXT.md 信封定义同款 |
| 6 | info | ADR-0008「P0 已作为 write sequencer 的真实队首节点入队……P0 只读取 SCHEMA 标准四键、调用 `compileSchemaEnvelope` 并构造 schema-dependent tools，不读取、提取或验证 ROOT」+ CONTEXT.md「P0」 | AC5「P0 是 write sequencer 的真实队首节点，只读取/编译 SCHEMA 并构造 active schema tools，不读取或验证 ROOT」 | no-conflict | 逐字对应 |
| 7 | info | ADR-0008「正常 compile result failure 仅使 ROOT write unavailable……P0 抛出结果联合之外的 internal exception 则永久关闭该 Runtime 的所有写」+ Fatal 节「任何 internal fatal……永久关闭该 Runtime 的全部写能力并保留读取」 | AC6「P0 正常 compile failure 形成 schema-unavailable；internal throw 永久关闭全部写但保留读取」 | no-conflict | 失败通道分级一致（结果联合 vs internal fatal） |
| 8 | info | ADR-0008「P0 结算后出队，只保留：`preparing`；`ready` 与 active schema tools；或 `unavailable` 与稳定 schema issue 摘要」 | AC7「P0 结算后出队，只保留 preparing/ready/unavailable active schema state」 | no-conflict | 三态集合逐字一致 |
| 9 | info | ADR-0008「测试通过包内确定性 seam 注入可控 P0、dirty notifier、handle 与 fault」+「v1 不提供公共事件订阅」 | AC8「包内确定性 testing seam 能控制 P0 resolve/reject」 | no-conflict | seam 须留在包内、不得以公共事件订阅替代（边界已录入相关决议文档） |
| 10 | info | ADR-0008 完整契约（mutateRoot/replaceSchema、close barrier、完整 status 投影） | 简报「本任务实现其中……子集；mutateRoot/replaceSchema 两类真实写、close barrier、完整 status 投影属后续 issue」 | no-conflict | 显式声明的增量交付，非推翻、非修订：简报引 ADR-0008 为契约且未对任何条款提出异议；ADR 未强制单票交付全量 |
| 11 | info | ADR-0008「必要的底层演进」1（schema-independent read）与 2（committed-aware fatal） | 简报 Blocked by「#86 已合入」「#87 已交付 transaction fatal 契约」 | no-conflict | 两项前置已兑付；演进项 3 服务 replaceSchema，随简报延后一致 |
| 12 | info | ADR-0007 被取代条款（open 前全量校验编排、schema-aware `readLogicalValueAtPath(derived, doc, path)`） | 简报读取面为 schema-independent、open 不再前置校验 | no-conflict | 与被取代条款的表面不一致不构成冲突——按技能规则，被 supersede 的条款不再约束 |

## 结论

**Verdict `clear`：放行。** 0 个冲突点：hard-violation 0、override-declared 0、evolution 0、需 Jim 裁决条目 0。简报是 ADR-0008 已冻结契约的忠实子集转写（骨架 + 同步读取面 + 队首 P0），未提出任何推翻或修订既有决策的意图；前置演进项（#86/#87）已兑付。

边界注记（非冲突，移交 SA1/SA2 关注，均已录入相关决议文档）：

1. **AC3 的 `getStatus` 是部分投影**：完整结构化 capability status 按简报属后续 issue。本任务交付的 status 面不得固化「单一扁平枚举」形状（ADR-0008 明文「结构化瞬时 capability status，而不是单一扁平枚举」），且不得暴露队列长度、任务类型或 sequence。
2. **延后项的扩展位**：sequencer 槽结构须为写槽七步顺序（lifecycle/fatal gate → `DocHandle.getStatus()` gate → 输入快照 → 校验/detached 构造 → transaction → `notifyDirty`）与队尾 close barrier 预留挂接点，不得引入绕过 sequencer 的写旁路或公共事件订阅。
3. **测试 fixture 豁免**：如测试需要 schema 文本，仅限 ADR-0001「测试 fixture 除外」豁免；包运行时代码不得内置 schema 文本。

配套产出（全链 SA 复用）：`wiki/raw/task_namespace-runtime-skeleton-p0_relevant_decisions.md`
