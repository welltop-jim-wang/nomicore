# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出（issue #228，round 1，dispatch `sa-47405c2e-83f2-4a33-a59e-31fdf29b6904`）。
> 只摘录，不裁决；引用编号与原文（行号以本 worktree 当前 HEAD 为准），需要时按编号回查 ADR 全文。
> 裁决结论见同目录 `task_228_conflict_report.md`。

## 被审对象（任务简报来源）

`wiki/raw/task_228.md` **不存在**（已按指示在 `wiki/raw/` 全目录定位：issue 228 唯一相关文件是派遣日志
`task_228_dispatch.md`）。任务简报的权威来源是 **GitHub issue #228「完成诊断日志删除联动与 PR #142
阶段验收」**（body 已核读；评论为空，无 Owner 追加要求）。要点：

- Parent：PR #142（`docs/namespace-diagnostic-change-log`，OPEN，base `main`，documentation，阶段基线 PR）。
- 交付：① Host 的 namespace 数据删除工作流**同步触发**诊断日志删除（清理 active locator、stream
  manifests、JSONL/BIN、deletion markers 与 adapter indexes；只承诺活跃存储逻辑删除，不暗示 secure
  erase）；② 阶段级 Host 验收组合覆盖 create、ROOT/SCHEMA、trusted replication、restart、retention、
  logging failure、bounded shutdown、complete/partial/failed replay；③ ADR 0011/0012、CONTEXT.md 与
  package README 对同步 File adapter 的阻塞特性、调用位置和首切片 queue/batch/fsync/fd 范围一致，
  消除「绝不阻塞」等矛盾表述；④ PR 全量 typecheck、test、生成物/发布检查、`git diff --check`；⑤ 根
  REPORT.md 汇总 #141/PR #142 及 #148–#155、#226–#227 阶段结果；PR #142 title/body 与 tracking
  issue #141 验收材料同步。
- Blocked by #226、#227 —— 均已 CLOSED（blocker 解除）。

## 相关 ADR

### ADR-0011 best-effort namespace 诊断变更日志（accepted，2026-08-28）

与本任务的关联点：AC1/AC2/AC3 的产品语义基线（best-effort 隔离、结局词表、覆盖范围、重放条件、emitter
seam、时序与 shutdown drain）。

核心条款（原文摘录）：

- 「日志 emit、排队、持久化、背压、丢弃或关闭失败不得改变业务操作的返回值、rejection、提交事实、sequencer
  顺序或 Runtime 状态」；「日志不得成为 `createDoc`、Yjs transaction、dirty notification 或 replication
  ACK 的成功前置条件」（§决策·产品契约）。
- 覆盖范围：「namespace create，包括输入、schema、ROOT、duplicate、Persistence 与 post-commit Runtime
  construction 结局；ROOT mutation；SCHEMA replacement；trusted replication raw update apply；写入
  复制身份或提升 epoch 等 replication management 操作」（§覆盖范围）。
- 诊断性重放成功五条件：可用 genesis / committed records 按 emitter sequence 连续 / 非-noop committed
  record 携带可解码 update / 无已知 gap、截断、损坏或不兼容 record version / 重放后受控 identity 一致
  （§Committed update 与诊断性重放）。
- emitter seam：`emit` 「不得阻塞、throw、返回 durability promise，亦不得保留调用方可变引用」
  （§Interface 与 seam）；——注意与 ADR-0012-LOG 首切片 amendment 的张力（见下）。
- 时序：「committed record 的 sequence 分配与 emitter 接收可发生在 transaction committed 事实可知之后，
  但 emitter 不被 `await`」；「adapter 慢、失败或队列满都不得延长 write slot 或阻塞 close/shutdown；Host
  shutdown 可 best-effort drain 日志，但 Registry/Persistence 的停止不得无限等待日志 sink」（§时序与
  sequencer）。

### ADR-0012-LOG VFSL 校验的 JSONL 与 framed sidecar 诊断日志格式（accepted，2026-08-28；含 issue #152 round-2 首切片 amendment）

与本任务的关联点：**AC1 的直接义务来源**、AC2 的 retention/replay/segment 契约、AC3 的对齐目标。仓库内
存在两个编号 0012 的 ADR（另一个是 instance-identity）；引用本 ADR 时沿用先例消歧写法 **ADR-0012-LOG**。

核心条款（原文摘录）：

- **Retention 与删除（§Retention 与删除）**：
  - 删除协议：「1. 将关闭 group 的 `.jsonl` 原子 rename 为 `.deleting`；2. 删除对应 `.bin`；3. 删除
    `.deleting`；4. 启动时继续完成遗留 `.deleting`；5. 无对应 JSONL 的孤立 BIN 按 orphan 清理。」
  - 「提供按 namespace 彻底删除日志的管理能力，覆盖 current locator、manifests、JSONL、BIN 与 adapter
    索引。该能力只承诺活跃存储中的逻辑删除，不承诺 SSD、备份、对象存储版本中的物理 secure erase；备份、
    磁盘加密与密钥销毁归部署策略。**Host 执行数据删除请求时必须同时调用日志删除能力。**」
  - 「日志生命周期不与 namespace snapshot Persistence 自动绑定。」
  - 「retention 只删除已关闭且没有 reader lease 的 segment group，绝不删除当前 open group」；「reader
    通过 `openReadSession()` 获得短期 segment lease」。
- **首切片同步 append amendment（§Writer、append 与背压，Amendment — File adapter first slice）**：
  - 「每个 `emit` 在调用栈内执行至多一条 final JSONL record 的有界同步 append；若其携带 sidecar，则额外
    执行至多一帧 BIN append，顺序为 BIN-first。该首切片不维护 writer queue、不做 batch flush、不提供
    fsync 开关，也不保持常驻 file descriptor。同步 append 完成不构成 fsync 或掉电持久性承诺。」
  - 「此处『有界』仅指 adapter 主动处理的数据量与操作数量受配置 payload/line limits 和单-record/单-frame
    范围限制；它**不**表示底层文件系统延迟有时间上界，亦不表示 `emit` 可在任意调用点不阻塞。**任何将
    File adapter 的 `emit` 接入 namespace 生命周期的调用点，必须位于 NamespaceRuntime write sequencer
    slot 之外，或在该 slot 已释放之后；不得在 slot 内执行同步 File adapter `emit`。**」
  - 「queue/batch 是目标演进形态而非与首切片并列的当前要求」；「retention、queue 容量、batch/flush
    策略、fd cache 与 metrics sampling 可动态调整」。
- Stream 与 generation：「正常重启继续健康 stream；首次启用、旧 stream 无法安全续写、冻结配置改变、
  显式 rotate/reset 时建立新 stream」；`current.json` 是「可重建 locator 而非完整性证明」。
- Segment rolling 默认 targets：`targetJsonlSegmentBytes = 64 MiB` / `targetBinSegmentBytes = 256 MiB` /
  `targetRecordsPerSegment = 100,000`；segment `00000001` 起步、`99999999` 保留、不回绕、耗尽 = disabled。
- 打开与尾部恢复：只自动修复「截断最终不完整 JSONL 行 / 截断最终不完整 frame / 截断完整但未被引用的尾部
  orphan frames」；中间损坏旧 stream 只读 + 新 generation。
- Strict reader 与 replay：「replay 强制 strict」；replay 返回 `{status: 'complete'|'partial'|'failed',
  lastAppliedSequence, issues, snapshot?}`，不暴露 live Y.Doc；「retention 裁剪、update omitted、缺
  genesis 或 generation 断裂只能返回 partial/failed」。
- 验收门槛 #15：「按 namespace 日志删除覆盖 locator、manifest、JSONL、BIN 与索引。」

### ADR-0006 Cordis 持久化插件 DocPersistence（accepted；+#64 createDoc / #79 entry status / #131 对齐 / #133 import-archive-probe 修订节）

与本任务的关联点：AC1「namespace 数据删除工作流」的持久层边界——**现行接口无删除 seam**。

核心条款（原文摘录）：

- 接口闭集（#64 修订后）：`createDoc(owner, docId, doc)` / `loadDoc(owner, docId)` / `saveDoc(handle)`
  （+#79 `getStatus()`）；无 `deleteDoc`。
- 磁盘布局：「`{rootDir}/users/{userId}/{namespaceId}.snapshot`」；temp→rename 原子覆盖；「rename 成功
  即完成一次 flush：v1 不对每次 flush 做 file/directory fsync」。
- #133 归档（**归档 ≠ 删除**）：`archiveDoc(owner, docId, expected)` 身份守卫 + 「写全量归档快照并移除主
  键」，归档布局 `{rootDir}/archive/users/{userId}/{docId}.snapshot`；「提交边界 = 归档写（rename/write
  resolve）」。
- 「user 仅作分区键：本层不鉴权」；单进程独占 rootDir（v1 限制）。

### ADR-0009 NamespaceRegistry、调用方租约与 Cordis Host 生命周期（accepted；+#131 identity / #134 ReplicationSession 修订节）

与本任务的关联点：AC1 Host 编排面与 AC2 bounded shutdown 的生命周期语义；v1 公共面闭集。

核心条款（原文摘录）：

- 公共 Interface：「Registry v1 公开：`open`；`create`；同步 `getStatus`，只表达 `running |
  shutting-down | stopped`；`shutdown`。v1 不公开 list、entry status、lease count、queue、timer
  handle、explicit eviction、按 key close 或公共 events。」
- Shutdown：「shutdown 取消全部 idle timer，等待此前已接纳的 lifecycle 操作结算，然后主动 close 全部
  active/idle Runtime，不等待外部 lease release」「不因第一项失败跳过其余 Runtime」。
- 空闲保留：idle 默认 300,000 ms；「fatal 和 persistence-degraded 只改变 Runtime capability，不改变
  open 或 idle retention 语义」。

### ADR-0008 NamespaceRuntime 读写能力与单序列器（accepted；+#93 稳定码注册 / #132 复制保留事实修订节）

与本任务的关联点：AC3「调用位置」条款的锚——write sequencer slot。

核心条款（原文摘录）：

- 「同一 namespace 内所有受控 Y.Doc 写共享唯一严格 FIFO write sequencer」；每槽序「lifecycle/fatal gate、
  `DocHandle.getStatus()` writable gate、输入快照、领域校验和 detached 构造、一次 Yjs transaction、
  `await notifyDirty()`，然后才释放给下一任务」。
- #132 修订：基础 v1 两方法（`mutateData`/`replaceSchema`）+ ADR 0010 授权的 `enableReplication()` /
  `bumpReplicationEpoch()`，四者同入 sequencer。

### ADR-0010 Hub/Peer WebSocket Y.Doc 复制（accepted；+#134 / #133 round-2 / #161 round-2 / #172 修订节）

与本任务的关联点：AC2 的 trusted replication 覆盖面；AC5 的文档权威性条款。

核心条款（原文摘录）：

- 覆盖面锚（与 ADR-0011 覆盖范围互证）：trusted raw update apply 六步（gate → 受保护字段检查 →
  `Y.applyUpdate` → observer 产出 owned bytes → `await saveDoc` → 释放槽）。
- #172 修订 §2：「`wiki/raw` 非规范：源码与规范中的公共行为表述必须指向 `CONTEXT.md`、ADR 或
  `docs/protocols/`；`wiki/raw/` 仅为流水线历史证据」。
- 停止顺序：「网络关闭后 Runtime barrier 仍排空停机前已接纳 apply……随后 Registry shutdown、Persistence
  dispose，最后停止 Timer/Clock。」

### ADR-0012-ID 实例身份单一真相与 WebSocket plugin 所有权（accepted，issue #204 已实现）

与本任务的关联点：AC2 bounded shutdown 的 composition root 编排边界（与 ADR-0010 停止顺序互证）。

核心条款（原文摘录）：

- 「Composition root 拥有 Instance、Clock、Timer、Persistence 与 Namespace Registry 的创建、配置和最终
  teardown」；「上游资源随后由 composition root 按 Registry → Persistence → Timer/Clock 的顺序释放」。

### ADR-0005 投影生成管线（accepted）

与本任务的关联点：AC4「生成物/发布检查」的纪律来源。

核心条款（原文摘录）：「生成文件入仓……CI `generate --check`：全量重新生成 → diff 为空；**源漂移与生成
器逻辑漂移双抓**；schema 改动与重新生成同一原子提交。」

### 其余 ADR（盘点完整性，与本任务无直接约束面）

- ADR-0001（VFSL 单一真相源，accepted + 2026-08-19 目标态/阶段态修订）：本任务不改 schema 文本/投影。
- ADR-0002（重写权威、authority 出范围，accepted）：不适用。
- ADR-0003（求值器与派生 schema，accepted）：不适用。
- ADR-0004（vfsl-protocol 类型投影，accepted）：不适用。
- ADR-0007（逻辑验证与 Yjs bridge，accepted，Runtime/open/read 条款由 0008 部分取代）：不适用。

无 superseded ADR（两个 0012 均为 accepted、领域不同，非取代关系）。

## CONTEXT.md 相关术语与惯例

- **namespace 诊断变更日志**：「从 namespace 创建开始尽力记录所有变更尝试及其结构化结局的可选择
  observability 流；连续的 committed Yjs updates 可用于诊断性重放，但日志不参与业务提交、不承诺完整性
  或恢复能力。」_Avoid_: 审计账本、WAL、event sourcing、可靠恢复日志。
- **变更尝试**：「一次可能修改 namespace 的请求及其结局；结局区分 committed、rejected 与 fatal……被拒
  请求也属于变更尝试」。
- **诊断日志 stream generation**：「一个 namespace 的一代独立诊断日志，包含不可变 manifest、VFSL 校验的
  分段 JSONL records 与可选 framed binary sidecar；冻结格式或策略改变、旧 stream 损坏或无法安全续写时
  建立新 generation，各 generation 不自动拼接重放。」
- **语义 emission**（现行文本，**AC3 整改对象之一**）：「emit 同步、不 throw、不阻塞；快照与 updateBytes
  所有权移交后不得再变异。update-omitted 稳定 reason 受控词表（v1）：`payload-too-large` /
  `update-capture-disabled` / `empty-update`——新增 reason 属词表演进，须过设计评审。」
- **storage projection**：「日志 adapter 独占的物理表示决策——先决定 inline/sidecar 并构造最终 record……
  emitter 只做语义投影，不构造物理字段。」
- **genesis baseline record**：「新 stream 的 genesis 基线——当时完整 Y.Doc 的 update，不是变更尝试……
  由 #152 adapter 内部构造。」
- **停接纳 / 空闲 Runtime / namespaceId**：Runtime/Registry 生命周期词汇（AC1 设计需遵循）。

## 现状事实（非规范，供 SA1/SA2/SA3 定位；不构成冲突依据）

- 诊断日志包已交付被调能力：`packages/namespace-diagnostic-log` 公共导出
  `deleteNamespaceDiagnosticLog`（`src/adapters/file.ts:1592`；含 `.deleting` 收尾、orphan 清理与租约分区
  释放 `releaseNamespaceLeasePartition` = INV-12），测试
  `test/file-adapter-namespace-deletion.test.ts`（#154 交付；词汇 `deleted/absent`，无 erase/purge 暗示面）。
- **Host app 现无 namespace 数据删除面**：`apps/yjs-server/src/app.ts` NDJSON 控制通道现有 op 闭集 =
  `status / shutdown / read / verify-write / add-target / remove-target / notify-auth-changed /
  request-reauth / replace-schema / bump-epoch / reset-replica`（无 delete 类 op）。Registry/Persistence
  公共面亦无删除 seam（见 ADR-0009/0006 摘录）。#155 前置冲突报告已备案：「ADR-0012-LOG『Host 执行数据
  删除请求时必须同时调用日志删除能力』是条件条款，app 现无数据删除面 → 前件不成立；设计显式备案待相应
  票」——**issue #228 即该顺延票**。
- AC3 矛盾表述现存位置（本轮亲证）：`packages/namespace-diagnostic-log/README.md:312`（「`emit` /
  `append` 同步、**绝不 throw**、绝不阻塞」）；`CONTEXT.md:157`（「emit 同步、不 throw、不阻塞」）；
  `packages/namespace-diagnostic-log/AGENTS.md:16`（同款；同文件 §Boundaries L20 起已正确陈述首切片
  阻塞纪律——文件内部自相矛盾）。ADR 侧权威文本：ADR-0011 L24「non-throwing、有界、非阻塞的 emitter
  seam」+ ADR-0012-LOG L244-252 首切片 amendment（同步 append 可被文件系统延迟阻塞 → 调用点必须在
  write sequencer slot 外）。
- app 侧纪律（`apps/yjs-server/AGENTS.md`）：只消费包公共导出；stdout = NDJSON lifecycle 事件通道；
  单一 disposal 链（replication drain → registry shutdown → persistence dispose → timer/clock）。

## 设计后/收尾复审追加（SA8，issue #228 收尾轮；引用行号以本 worktree 当前未提交 diff 为准）

> 上文「相关 ADR」各节摘录的是**任务起点**的决策状态（如「现行接口无删除 seam」「Host app 现无
> namespace 数据删除面」）。本节追加本任务链**已正式落地**的决策增量，供收尾/发布链复用；只摘录，
> 不裁决。裁决见 `task_228_conflict_report.md`（前置 clear）与 `task_228_design_conflict_report.md`
> （设计后 clear + 收尾轮 clear）。

### ADR-0006 新增修订节「逻辑删除修订（2026-09-07，issue #228）」——已随代码同变更集落文

- 「新增 `DocPersistence` 可选成员 / `ReplicaPersistence` **必具**成员 `deleteDoc(owner, docId)` 与
  共享 lifecycle 的新 I/O seam `PersistenceIO.removeKey`」。
- 「**delete ≠ archive**：无身份前置、无归档写、删除时清理归档位（归档语义『不触碰归档区』由
  removeKey 的独立 seam 切分保持，`remove` 零改动）」「只承诺活跃存储逻辑删除，不承诺 SSD、备份、
  对象存储版本中的物理 secure erase」。
- 「absent 与 deleted 不可区分（两处均已缺席仍 resolve `{ok:true}`）」；拒绝分类
  `DocDeleteActiveHandleError` / `DocDeleteOperationalError` / `DocDeleteFatalError`（phase 词表
  `lifecycle-disposed` / `adapter-violation` / `remove-aborted`，恒 `committed:false`）。
- 「lifecycle per-key cell 状态联合新增 `'deleting'`（claim 排他，镜像 `'archiving'` 放置）；既有
  全部 cell 消费方（createDoc/importDoc claim 环、loadDoc resolve 环、archiveDoc claim 环、
  `seedForTest` 拒绝清单）同变更集消费新态」；settle-for-delete「被删除的 doc 不需要 flush 持久化」。

### ADR-0009 新增修订节「issue #228（单 namespace 终态删除编排 deleteNamespace）」——已落文

- 「Registry v1 公开面增加 `deleteNamespace(owner, namespaceId)`——**终态删除编排**」。
- 「『v1 不公开 explicit eviction、按 key close』的排除针对**逐出/复用**语义；`deleteNamespace`
  是**终态删除**（Runtime 关闭 + 持久删除 + 不可复活），语义正交，不构成对排除条款的违反。」
- 「carrier per-key FIFO 接纳（与 open/create/import/reset 同款串行域——并发 open 与 delete 在同
  key 上严格序列化）」「capability 前置门（loud branded fatal，先于一切破坏性动作）」。
- 「live entry 的 owner 不符才返回 `NAMESPACE_NOT_FOUND`；absent 对**任意 owner** 返回 `{ok:true}`
  ——删除幂等优先于存在性回显」。
- §5 失败与观测：「close 失败 / deleteDoc operational（`DocDeleteOperationalError`）→
  `NAMESPACE_DELETE_FAILED`；`DocDeleteFatalError` / 其它 throw → branded fatal（committed:false
  恒真）」——**ActiveHandle 落「其它 throw」**（registry 编排下理论不可达；分层与 ADR-0006 §3 的
  persistence 层 typed 拒绝分类并存不矛盾）。

### ADR-0011 新增澄清性修订节（2026-09-07，issue #228）——已落文

- 「**澄清性修订，非决策变更**」：「非阻塞」是 interface 级契约；File adapter 首切片实现属性由
  ADR-0012-LOG amendment 定义并为准。
- 「隔离条款的边界：失效面枚举与保护对象枚举均不含『日志删除能力失败』与『数据删除工作流』——
  ADR-0012-LOG L299 把日志删除定义为 Host 数据删除请求的伴随义务，其 `ok:true` 复合谓词不构成
  对其它业务操作的隔离破坏」。

### CSPRNG 身份事实（D4 断言仲裁/勘误 E-1 的约束基准）

- CONTEXT.md `namespaceId` 词条：「普通 create 由受控 128-bit CSPRNG 生成 `ns-` + 32 位小写
  hex」；ADR-0010 L28：「普通 `Registry.create()` 不再接受调用方指定 namespaceId，而由注入的受控
  128-bit CSPRNG 生成……复制 bootstrap 使用内部受信任导入保留 Hub namespaceId，不是普通 create」。
- 实现锚点：`packages/namespace-registry/src/registry.ts` L203-204（`NAMESPACE_ID_RANDOM_BYTES
  = 16 // 128-bit CSPRNG`）与 `generateNamespaceId`（`randomBytes(16)` → `ns-`+32 hex）；Host
  provision 每启动对每条目无条件 `registry.create({owner, schema, root})`（三键输入，无
  namespaceId；`apps/yjs-server/src/app.ts` provision()）。
- 推论（SA6 追认已裁定）：「重启后确定性派生同 namespaceId」仅在**数据仍存续 + 直引
  authorization 显式 id** 的重启形态成立（T-H6 boot2 / #155 E5/T6 先例）；删除后重启 + provision
  恒为新 CSPRNG 身份（等概率 2^-128）。
