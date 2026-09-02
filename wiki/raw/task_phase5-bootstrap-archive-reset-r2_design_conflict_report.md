# 冲突门禁报告

## Verdict

`clear`

- 被审对象：`wiki/raw/task_phase5-bootstrap-archive-reset-r2_design.md`（SA1 R2 冻结设计）。
- 冲突基准：`docs/adr/` 全集 10 份（已逐份完整读取）及 `CONTEXT.md`。
- 本次性质：设计后复审；ADR-0007 中已由 ADR-0008 取代的 Runtime/open/read 条款不作为约束。其余 ADR 均为 accepted，且只以 ADR 与 CONTEXT.md 作裁决基准。

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0001 | VFSL 单一真相源 | accepted | 否 | no-conflict：设计不涉及 VFSL、SCHEMA 权威源或投影。 |
| ADR-0002 | 重写定位、authority 出范围 | accepted | 否 | no-conflict：不引入 authority 或旧系统兼容约束。 |
| ADR-0003 | 求值器与派生 schema | accepted | 否 | no-conflict：不改变 evaluate、ROOT 或派生 schema 契约。 |
| ADR-0004 | vfsl-protocol 类型投影 | accepted | 否 | no-conflict：不涉及类型投影语义。 |
| ADR-0005 | 投影生成管线 | accepted | 否 | no-conflict：不涉及 SchemaSource 或生成管线。 |
| ADR-0006 | Server Persistence docstore | accepted | 是 | override-declared：设计按本轮 owner 授权提出追加增量修订；全量 snapshot、owner 分区、dirty notification、degraded/retry 和三条目布局均被保留。 |
| ADR-0007 | 逻辑校验与 Yjs runtime bridge | accepted；Runtime/open/read 部分由 ADR-0008 取代 | 间接 | no-conflict：未触及其仍有效的逻辑校验、detached materialization 或普通写零写入规则。 |
| ADR-0008 | NamespaceRuntime 读写能力与 sequencer | accepted | 是 | no-conflict：严格 preflight 读取既有 Runtime status 投影，不改变唯一 FIFO、dirty-not-durable 或 close 对既接纳任务的排空语义。 |
| ADR-0009 | NamespaceRegistry、Lease 与 Host 生命周期 | accepted；identity 旧条款由 ADR-0010 修订 | 是 | no-conflict：保留 owner-first 防泄露、同 key carrier FIFO、generation 安全清理与 Registry/Persistence 边界。 |
| ADR-0010 | Hub/Peer WebSocket Y.Doc 复制 | accepted | 是（核心） | override-declared：设计明示将以 owner 授权的 ADR 修订取代旧 reset close-first 与泛化 import 核对的冲突/不足部分。 |

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| 1 | 无 | ADR-0010 §复制谱系与 epoch：「Registry 先关闭本地 Runtime generation，再通过 Persistence 归档旧副本，最后允许重新 bootstrap。」 | R2-D4 / §3.4：`owner → capability → preflight live/persisted → forceRelease/cancel idle/close → archive → bootstrap eligibility`；§5.2 要求 ADR-0010 追加节明确「replaces the conflicting portions of the old line-57 reset ordering」。 | override-declared | 设计已落实前置门禁条件①：身份 preflight 成功后才进入 close，随后 archive，再改变 bootstrap eligibility；失败路径零 destructive action。它还明确 ADR-0010 修订的受影响旧文句、取代关系和未触及条款继续有效，故为已声明并获 owner feedback 3 授权的演进，不是 hard-violation。 |
| 2 | 无 | ADR-0010 §Bootstrap 与重连：「peer 在 detached Y.Doc 应用基线、严格核对 META 身份，再通过 Persistence 的受控复制导入能力排他创建」；ADR-0010 §复制谱系与 epoch：不同 lineage/epoch 不自动覆盖或合并。 | R2-D5/D6 / §4.2：先校验 `META.docId` 与复制事实格式，再将事实和 Hub 广告 `expectedReplicationIdentity` 精确相等性作为 `importDoc` 前谓词；不匹配时零 `importDoc`、零写、零 entry。 | override-declared | 设计已落实前置门禁条件②：Hub 广告 expected identity equality 明确冻结在 ownership transfer（`importDoc`）之前。该约束由 Registry 受信 bootstrap 编排执行，Persistence 仍只校验 `META.docId`；这与 ADR-0006 的层次边界及 ADR-0010 的无自动覆盖/合并纪律相容。 |
| 3 | 无 | ADR-0006 修订体例：「本节修订…取代关系如下；未提及的条款维持原文效力。」及「本节为增量演进…除下列明示条款外…维持原文效力。」 | R2-D7 / §5.1–§5.2：ADR-0006/0010 均追加节，明确 scope、受影响旧条款/取代关系、owner feedback 3 授权，并写明未明示条款继续有效。 | override-declared | 设计已落实前置门禁条件③。ADR-0006 方案明确为增量演进、保留 owner 分区/dirty notification/全量 snapshot/primary temp→rename/META.docId；ADR-0010 方案明确取代 line-57 reset ordering 和 line-65 generic verification 的冲突部分，并保留其余文字。 |
| 4 | 无 | ADR-0006：Persistence 是 Y.Doc store+cache；`saveDoc` 仅登记 dirty、内部 retry 管理持久化；flush 为完整 `Y.encodeStateAsUpdate(doc)` snapshot、File 仅 `.snapshot` 为提交态；三条目布局为 `SCHEMA`、`META`、`ROOT`，且 `META.docId` 必须匹配。ADR-0010 亦要求不改变 dirty notification、full snapshot、owner 分区语义。 | R2-D2 / §3.3 / §5.1(5)：新增 Persistence-internal 只读 committed-snapshot identity probe；以 owner 分区 key 和 `PersistenceIO.read` 读取 trusted primary `.snapshot`，在 detached temporary Y.Doc 解码完整快照，只验证 `META.docId` 及复制事实；不签 handle、不进入 live cell、不写/flush/archive/ownership transfer；I/O 失败 loud/typed，不 fallback live。 | no-conflict | 新 probe 仅读已提交主快照，未把 dirty live 状态宣称为 durable，且不改变保存格式、三条目布局、flush/retry/degraded 职责或 `DocPersistence` 公共接口。Memory/File 同等实现和 capability gate 是对新内部 seam 的明确边界；其只读行为与「`.snapshot` 是提交态、`.tmp` 非提交态」相容。 |
| 5 | 无 | ADR-0008：同 namespace 写使用唯一严格 FIFO；`close()` 首次调用后停止接纳但此前任务无条件排空；复制管理写成功不等于已落盘。ADR-0009：同 key lifecycle 串行，旧异步操作只清理自身 generation。 | §3.5：preflight 到 close 间仍受 Registry carrier FIFO 保护；Runtime 既有写可在 close 前发生，archive 保留 close 后 settled persisted guard；late race 可能在 close 后拒绝但不伪称为 preflight mismatch。 | no-conflict | 设计没有取消或绕过 Runtime FIFO/close barrier，也没有把 preflight 当作持久性承诺；将其限定为 non-destructive admission decision，并以 archive 守卫处理后续 race，符合既有 Runtime 与 generation 生命周期契约。 |

## 结论

`clear`。设计与全部有效 ADR 及 CONTEXT.md 一致；无 hard-violation。

- 实质冲突点数：0。
- 裁决分布：no-conflict × 2；override-declared × 3；evolution × 0；hard-violation × 0。
- 三项前置门禁条件均已在设计中明确落实：
  1. ADR-0010 的 reset 次序以「身份 preflight 成功 → close → archive → bootstrap eligibility」取代旧 close-first 描述；
  2. import 的 Hub 广告 expected identity 核对冻结在 `importDoc` ownership transfer 之前；
  3. ADR-0006/0010 修订采用明确范围、取代关系、未触及条款继续有效的既有体例。
- 新增 persisted committed-snapshot probe 与 ADR-0006 Persistence 契约相容：它只读 owner 分区的已提交完整主快照，以 detached Y.Doc 解码三条目布局中的 META 身份；不触碰 live cache/handle、dirty notification、scheduler、flush/retry、archive 或 ownership transfer。其规范地位将由设计规定的 ADR-0006 增量修订正式收口。
