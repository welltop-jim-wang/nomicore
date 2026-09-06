# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出。只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
>
> **R5 复核（2026-09-05T09:25Z，recovery 重派）**：本轮对全部引用做了独立二次核验（ADR-0011/0012 全文重读；0006/0008/0009/0010 被引条款逐条比对；CONTEXT.md 词条复核；生产接线点 `registry.ts` L1316–1463、`create-diagnostic.ts`、`adapters/file.ts` 抽查）。发现并修正一处归属错误（见 ADR-0006 节第 2 条），其余引用与结论经复核属实，无新增冲突。

## 任务标识

- 任务：Issue #226 — 修复创建诊断覆盖与日志生命周期隔离（Bug 修复）
- 简报：`wiki/raw/task_issue-226.md`
- Worktree：`/home/wangjian/nomicore-fix-issue-226`（branch `mabf/issue-226`，父链 PR #142 `docs/namespace-diagnostic-change-log`）
- 冲突基准：`docs/adr/` 全部 12 个文件（编号 0001–0010 + 两个 0012，已逐个全读）+ 根目录 `CONTEXT.md` 全读
- 编号消歧：`docs/adr/` 存在两个 0012——`0012-vfsl-validated-jsonl-and-framed-sidecar-change-log.md`（本任务核心基准）与 `0012-instance-identity-and-websocket-plugin-ownership.md`（与本任务无关）。本文所有「ADR-0012」均指前者，下游引用建议一律带文件名。

## 相关 ADR

### ADR-0011 Best-effort namespace 诊断变更日志（accepted；本任务产品语义权威）

`docs/adr/0011-best-effort-namespace-diagnostic-change-log.md`

- 与本任务的关联点：任务两条主线（创建结局全覆盖、日志 I/O 与业务关键路径隔离）都是对该 ADR 既有条款的兑现。
- 核心条款（原文摘录）：
  1. L20「日志 emit、排队、持久化、背压、丢弃或关闭失败不得改变业务操作的返回值、rejection、提交事实、sequencer 顺序或 Runtime 状态」；L22「日志实现不得因失败将 namespace 标记为 fatal、persistence-degraded 或只读，也不得触发业务请求重试」。（AC4 隔离要求的直接来源）
  2. L24「日志 adapter 必须以 non-throwing、有界、非阻塞的 emitter seam 接收记录。Runtime/Registry/复制实现仍防御 adapter 违约；adapter 同步 throw 或异步失败均被隔离，并只进入独立的日志健康 metrics/observer」。（emitter seam 形状红线）
  3. L57 覆盖范围：「namespace create，包括输入、schema、ROOT、duplicate、Persistence 与 post-commit Runtime construction 结局」。（AC1 的逐项来源：建流前 duplicate/输入快照/schema 编译/validation/Persistence/post-commit 均被 ADR 明文列为必须记录的创建结局）
  4. L40–49 阶段词表冻结（acceptance / capability-gate / input-snapshot / schema-compile / validation / identity / transaction / dirty-notification）+ L51「每条结局记录保留所属模块已有的稳定 code、phase、issues 顺序与 committed 事实；日志层不得发明 retryable、rollback 或成功语义」。
  5. L69–77 输入零访问与单快照纪律：L72「capability/acceptance gate 在输入访问前拒绝时，记录 `input.capture = not-accessed`，不得随后序列化、hash 或检查原始请求」；L75「对 create 等已有独立快照实现的路径，同样复用该路径的安全快照，不建立第二套序列化规则」。（AC2 来源）
  6. L123「变更尝试的业务排序继续由现有 Registry lifecycle slot 或 namespace write sequencer 决定，日志不得引入第二个业务排序机构」。（AC3 红线：隔离 ≠ 新排序机构）
  7. L127「committed record 的 sequence 分配与 emitter 接收可发生在 transaction committed 事实可知之后，但 emitter 不被 `await`」。（slot 后 emission 的授权来源）
  8. L128「`notifyDirty` 仍按 ADR 0008/0010 的原有槽序执行。日志记录 dirty failure，但不替代或包裹 dirty notification」。
  9. L129「adapter 慢、失败或队列满都不得延长 write slot 或阻塞 close/shutdown；Host shutdown 可 best-effort drain 日志，但 Registry/Persistence 的停止不得无限等待日志 sink」。（AC4 shutdown 上界来源）
  10. L117 emit interface 语义：「立即接收一份由调用方持有权已转移或已复制的 detached record；不得阻塞、throw、返回 durability promise」。
  11. L119「一个日志 adapter 不构成新的 Persistence 真相源；snapshot Persistence 与诊断日志独立演进」。
- 对本任务影响：任务全部 AC 均为兑现条款；实现不得把日志故障升级为业务事实，也不得为日志引入第二个业务排序机构。

### ADR-0012 VFSL 校验的 JSONL 与 framed sidecar 诊断日志格式（accepted；含 2026-08-28 File adapter first slice amendment）

`docs/adr/0012-vfsl-validated-jsonl-and-framed-sidecar-change-log.md`

- 与本任务的关联点：日志存储侧契约；其 first slice amendment 把「同步 File emit 不得进 write slot」定为规范性接线条件并预留接线修复票——issue #226 即该票。
- 核心条款（原文摘录）：
  1. Amendment L250：「任何将 File adapter 的 `emit` 接入 namespace 生命周期的调用点，必须位于 NamespaceRuntime write sequencer slot 之外，或在该 slot 已释放之后；不得在 slot 内执行同步 File adapter `emit`。不满足该条件的接线为不合规，必须由 #149–#151/#155 或后续接线票修复后方可启用。」（AC3 中「同步 append 不在业务关键路径」的规范性来源；本任务 = 该「后续接线票」）
  2. Amendment L248：「每个 `emit` 在调用栈内执行至多一条 final JSONL record 的有界同步 append……此处『有界』仅指 adapter 主动处理的数据量与操作数量受配置 payload/line limits 和单-record/单-frame 范围限制；它不表示底层文件系统延迟有时间上界，亦不表示 `emit` 可在任意调用点不阻塞。」（AC4「慢或挂起的日志存储」所指风险的正名）
  3. Amendment L252 queue/batch 演进路径：「未来切片可在不改变 emitter 公共 seam、record schema、manifest policy 或上述 write-slot 隔离条件的前提下，以每 stream 至多一个逻辑 writer queue 替换同步 append，并采用有界队列、drop/health 语义和周期 batch flush；该切片须另行定义 close/shutdown、flush、队列满与 fsync 配置语义。」（SA1 若选择 queue/batch 形态，必须补齐这四类语义）
  4. L24：「日志启用与配置是本地 Host/Registry 旁路状态，不写入 namespace `SCHEMA`、`META` 或 `ROOT`，也不随 Hub/Peer 复制。初始化失败不影响 namespace create；独立健康 observer 上报 `LOG_STREAM_INIT_FAILED`。后续重试成功时以当时 Y.Doc 建立新 stream，其 genesis 只代表从该时点开始，不能伪称从 namespace 创建时起连续。」（AC1 与建流失败隔离的边界：早结局 attempt 记录可补记，但重放连续性/genesis 声明不得回溯伪造）
  5. L70–89 词表冻结：v1 operation 封闭六值（`namespace-create` / `root-mutation` / `schema-replacement` / `replication-apply` / `replication-enable` / `replication-epoch-bump`）；result 严格判别联合（committed+noop / committed+update / committed+update-omitted / rejected / fatal+committed:false / fatal+committed:true×三 effect）；L89「顶层诊断 `stage` 使用日志 schema 的封闭枚举」；L67「writer 准备 append 时才分配 stream sequence」。
  6. L268「影响记录解释的配置在 stream 创建时冻结；包括 record/schema/frame 版本、committed update capture、input capture policy、inline threshold 与 line 上限。冻结项改变时新建 stream generation。」（缓冲补记早结局不得改变冻结策略语义）
  7. L242「shutdown 可 best-effort drain，但不得无限等待日志 sink 或阻塞 Registry/Persistence 停止」；L240「writer queue 满时 drop newest，保留已排队顺序」（目标形态条款，首切片范围内被 amendment 取代的部分见其原文界限）。
  8. L270–278 打开与尾部恢复：只自动修复可证明的最终尾部（截断尾行/尾 frame/尾部 orphan frames）；中间损坏旧 stream 只读、新建 generation。（AC3 中「reopen/repair」的既有语义）
  9. L280–299 retention：只删除已关闭且没有 reader lease 的 segment group；`.deleting` rename 删除协议；按 namespace 删除能力。（AC3 中「retention sweep」的既有语义）
  10. L214「append 前 VFSL validation failure 是日志 writer bug：丢弃 record、增加低基数 metric 并向独立结构化 observer 上报，不改变业务结果」。
  11. 被否方案 L332「允许同步 File adapter `emit` 在 namespace write slot 内执行：慢文件系统仍可无限延长业务写槽，直接违反 ADR 0011/0008 的业务隔离」。
- 对本任务影响：隔离改造必须保持 emitter 公共 seam、record schema、manifest policy 与 write-slot 隔离条件不变；建流/reopen/repair/retention/append 的搬移只是接线位置变化，不是这些模块语义的改写。

### ADR-0008 NamespaceRuntime 读写能力与单序列器（accepted；含 #93/#132/#134 修订）

`docs/adr/0008-namespace-runtime-read-write-capabilities-and-sequencer.md`

- 与本任务的关联点：write-sequencer 槽结构是「日志 I/O 不得进入的」业务关键路径的定义来源。
- 核心条款（原文摘录）：
  1. L51「每个真正写任务的槽依次执行：lifecycle/fatal gate、`DocHandle.getStatus()` writable gate、输入快照、领域校验和 detached 构造、一次 Yjs transaction、`await notifyDirty()`，然后才释放给下一任务。」（slot 边界的权威定义——slot 内出现同步 File append 即 ADR-0012 amendment 所指不合规接线）
  2. #132 修订 4（L140）：`mutateData`/`replaceSchema`/`enableReplication`/`bumpReplicationEpoch`「四者均进入同一严格 FIFO write sequencer，完整槽序（lifecycle/fatal gate → writable gate → 输入校验 → 领域事实读取 → 单 Yjs transaction → 同步投影 → `await notifyDirty()`）不变」。
  3. L93 fatal 后「已排队的后续写仍按 FIFO 取得槽，且不访问输入、零写入返回 `RUNTIME_WRITE_DISABLED`」。
  4. L99 close barrier：「此前已接纳任务无条件排空，不取消、不设内部 timeout」。
- 对本任务影响：诊断 emission / 建流 / reopen / repair / retention / append 必须全部位于该槽外或槽释放后；不得改变槽内步骤、顺序与 fatal/close 语义。

### ADR-0009 NamespaceRegistry、调用方租约与 Host 生命周期（accepted；含 #131/#134 修订）

`docs/adr/0009-namespace-registry-leases-and-host-lifecycle.md`

- 与本任务的关联点：Registry lifecycle carrier 是任务要点名隔离的另一条业务关键路径；shutdown 上界与 observer seam 同在此 ADR。
- 核心条款（原文摘录）：
  1. L32「同 key 的 open、create 和 Runtime generation close 按同步接纳顺序串行」（lifecycle carrier 串行语义）。
  2. L62「完整 snapshot、compile、validate、detached construction、Persistence create 和 Runtime construction 均在同一个 lifecycle 槽中执行，不产生跨时间 prepared document」。（创建业务步骤的槽内清单——日志建流不在该清单内；隔离改造不得把任何业务步骤移出或移入该槽）
  3. L68–70 duplicate 统一映射 `NAMESPACE_ALREADY_EXISTS`；「如果 createDoc 已提交而 Runtime 构造失败，Registry 释放 handle、保留持久化文档、清理 entry，并以 `committed:true` Registry fatal reject」。（AC1 各结局的 committed 事实来源）
  4. #131 修订 3（L140）：「create 的跨候选重试仍受 lifecycle carrier 串行化与 shutdown 已接纳操作屏障约束」。
  5. L97–101 shutdown：「首次 shutdown 在调用栈内同步进入 `shutting-down` 并停止接纳 open/create……等待此前已接纳的 lifecycle 操作结算，然后主动 close 全部 active/idle Runtime……shutdown 最终以稳定 `NamespaceRegistryShutdownError` 聚合 close failures」。（AC4「不能无限延长 Registry shutdown」的落点：日志 drain 必须有界且不改变 shutdown 公共契约）
  6. L95 observer seam：「Registry 核心通过内部结构化 observer seam 上报生命周期与故障……v1 不提供公共事件订阅」。（日志健康信号走独立 observer，不进公共事件）
- 对本任务影响：把建流等日志活动移出 carrier 不得改变 create/open 串行接纳与结算语义；shutdown 的日志 drain 只能是有界 best-effort。

### ADR-0006 持久化 DocPersistence 与 docstore（accepted；含 #64/#79/#131/#133 修订）

`docs/adr/0006-server-persistence-docstore.md`

- 与本任务的关联点：AC1 中 Persistence 失败结局与 duplicate 判定的既有事实来源。
- 核心条款（原文摘录）：
  1. #64 修订（L118–134）：`createDoc(owner, docId, doc)` 对 `(owner.userId, docId)` 排他创建；duplicate 稳定码 `DOC_DUPLICATE`，三条判定都在进入写路径之前；「失败时不返回 handle、不缓存、不销毁传入 doc」。
  2. Registry 侧 Persistence 错误分类演进：**定义于 ADR-0009 §「Persistence 错误演进」（L72–81）**——typed create operational error 明确 `committed:false`；committed-aware create fatal 携带稳定 phase、committed 与原始 cause；Registry 只做映射传播。（R5 复核修正：本条原文本误将该节挂于 ADR-0006 名下；ADR-0006 经全文核对无此节，其 #133 修订只定义 import/archive/probe seam 的 committed 分类，与本条互证但非同源。条款内容与下游用法不变，仅归属更正。）
  3. L33「saveDoc = 脏状态通知，不是同步落盘」（snapshot Persistence 与诊断日志独立，ADR-0011 L119 互证）。
- 对本任务影响：诊断记录只转发 Persistence 结局的既有 committed/typed 事实，不得重新分类或发明回滚/重试语义。

### ADR-0010 Hub/Peer WebSocket Y.Doc 复制（accepted；含 #131/#133/#134/#161/#172 修订）

`docs/adr/0010-hub-peer-websocket-ydoc-replication.md`

- 与本任务的关联点：create 的 namespaceId 生成时序（AC1「首次可观察尝试」的归属锚）与复制侧诊断词表边界、wiki 权威纪律。
- 核心条款（原文摘录）：
  1. L28「普通 `Registry.create()` 不再接受调用方指定 namespaceId，而由注入的受控 128-bit CSPRNG 生成 `ns-` + 32 位小写 hex；撞到当前 Registry entry 或目标 Persistence duplicate 时最多重试 8 次，耗尽以 `committed:false` Registry fatal 失败」。（namespaceId 在 create 接纳后最早生成——建流前早结局的 namespace 归属以此为准；id 生成耗尽 fatal 的归属是边界 case，属 SA1 设计点）
  2. L159「Token、Yjs update、SCHEMA/ROOT 内容以及未经控制的 owner/namespace 不得出现在默认日志或高基数指标标签中」。
  3. #172 修订 2（L315）「`wiki/raw` 非规范：源码与规范中的公共行为表述必须指向 `CONTEXT.md`、ADR 或 `docs/protocols/`；`wiki/raw/` 仅为流水线历史证据」。（本任务设计不得引用 wiki/raw 为契约来源）
- 对本任务影响：有限——复制 apply/enable/epoch-bump 诊断 operation 词表（ADR-0012 L70–78）已冻结，本任务不得顺带改动。

### 其余 ADR（与本任务无关联，仅盘点登记）

ADR-0001（VFSL 单一真相源）、ADR-0002（重写定位/authority 出范围）、ADR-0003（求值器/ROOT/联合——create 管线中 schema 编译失败的语义上游属 vfsl 包，本任务只消费其结局）、ADR-0004（类型投影）、ADR-0005（投影生成管线）、ADR-0007（逻辑校验与 bridge——残余有效条款为 create 内 `validateLogicalSnapshot`/detached materialization 管线，本任务只消费其结局）、ADR-0012 实例身份版（WebSocket plugin 所有权与 Instance service，与日志生命周期隔离无交集）。

## CONTEXT.md 相关术语与惯例

- **namespace 诊断变更日志**（L144–146）：「从 namespace 创建开始尽力记录所有变更尝试及其结构化结局的可选 observability 流……日志不参与业务提交、不承诺完整性或恢复能力。」_Avoid_: 审计账本、WAL、event sourcing、可靠恢复日志。→ 本任务定位词。
- **变更尝试**（L148–150）：「被拒请求也属于变更尝试，即使它从未读取输入或进入 transaction。」→ AC1 早结局记录的术语依据。
- **语义 emission**（L156–158）：「emit 同步、不 throw、不阻塞；快照与 updateBytes 所有权移交后不得再变异。update-omitted 稳定 reason 受控词表（v1）：`payload-too-large` / `update-capture-disabled` / `empty-update`——新增 reason 属词表演进，须过设计评审。」→ emitter seam 形状不变是隔离改造的前提；词表冻结。
- **storage projection**（L160–162）：「日志 adapter 独占的物理表示决策……emitter 只做语义投影，不构造物理字段。」→ 搬移接线不得让 producer 学到物理字段。
- **genesis baseline record**（L164–166）：「新 stream 的 genesis 基线——当时完整 Y.Doc 的 update，不是变更尝试……v1 冻结的 emission/sink 公共面无构造路径。」→ 补记的早结局记录不得伪装 genesis。
- **诊断日志 stream generation**（L152–154）：「冻结格式或策略改变、旧 stream 损坏或无法安全续写时建立新 generation，各 generation 不自动拼接重放。」
- **写序列器**（L77–79）：「每个 NamespaceRuntime 独有的严格 FIFO：P0 与同一 namespace 的全部受控 Y.Doc 写共享顺序，前项完成 dirty notification 后下一项才执行；读取不进入该序列。」→ AC3「业务关键路径」的定义载体。

## 设计敏感点登记（SA1 设计将触碰、超出简报字面的决策点；只登记，不裁决——前置裁决见 `_conflict_report.md`，设计后复审另行裁决）

1. **隔离执行载体形态**：ADR-0012 amendment 允许两条路——(a) 保持首切片同步 append，仅把调用点移到 slot 外/槽释放后（如 per-namespace 延迟 drain 通道）；(b) 实现 amendment 预留的 queue/batch 切片（须另行定义 close/shutdown、flush、队列满与 fsync 配置语义）。选择直接决定 AC4「慢/挂起存储不阻塞下一槽」与 shutdown 测试的形状。
2. **建流前早结局的缓冲与归属**：早结局 attempt 记录在建流前产生、建流后补记时，须同时满足「writer 准备 append 时才分配 sequence」（ADR-0012 L67）、「影响记录解释的配置在 stream 创建时冻结」（L268）、「不能伪称从 namespace 创建时起连续」（L24）与 namespaceId 生成时序（ADR-0010 L28；id 生成耗尽 fatal 时该结局自身无可用 ns id——归属策略是设计点）。
3. **shutdown drain 预算机制归属**：在 ADR-0009 shutdown 公共契约（同 Promise、聚合错误、停止接纳）不变前提下的有界 drain 由谁持有（Registry plugin disposer / log adapter 自身 / composition root），以及预算上限的表达。
4. **词表演进红线**：operation / stage / result / update-omitted reason 任何新增值 = record schema 版本演进 + 新 stream generation + 设计评审（ADR-0012 L70–89、L268；CONTEXT「语义 emission」词条）。本任务不应需要新增词表值。
5. **慢同步 adapter 测试注入点**：AC5 要求「慢同步 adapter」「后续写入推进」「修复前行为会失败」证据；既有 seam 字段名（Registry `diagnosticLog`、Runtime `diagnosticEmitter` + `clock` 成对注入、testing subpath overrides）是已冻结契约锚点，不得漂移。
