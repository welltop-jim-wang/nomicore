# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出（第 0 阶段，审任务简报 `wiki/raw/task_diagnostic-log-file-adapter.md`，Issue #152 File diagnostic-log adapter）。
> 只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
> ADR 全集 = `docs/adr/0001–0009、0011、0012`（共 11 个文件；**无 0010 文件**，正文对 "ADR 0010 / trusted replication" 的引用是背景引用，其正文不在本仓库 ADR 全集内，不构成本门禁基准）。

## 相关 ADR

### ADR-0012 VFSL 校验的 JSONL 与 framed sidecar 诊断日志格式（accepted）——本票主规范

- 与本任务的关联点：本票（#152）就是本 ADR「File adapter」的实现切片：manifest / current-stream locator / segmented JSONL / inline carrier / NDCL v1 sidecar frame / strict reader。下列条款是本票的直接规格。
- 核心条款（原文摘录）：

**Stream 与 generation**
- 「`streamId` 使用受控 128-bit CSPRNG 生成：`log- + 32 位小写 hex`。碰撞时有限重试；耗尽只使日志能力不可用并上报健康故障，不改变 namespace 业务结果。」
- 「正常重启继续健康 stream；首次启用、旧 stream 无法安全续写、冻结配置改变、显式 rotate/reset 时建立新 stream。每个新 stream 尽力先记录当前完整 Y.Doc 的 genesis baseline，使该 stream 可独立诊断性重放；genesis 未成功写入时 stream 仍可记录诊断事实，但不得声称完整重放。工具不自动串联多个 generation。」
- 「日志启用与配置是本地 Host/Registry 旁路状态，不写入 namespace `SCHEMA`、`META` 或 `ROOT`，也不随 Hub/Peer 复制。初始化失败不影响 namespace create；独立健康 observer 上报 `LOG_STREAM_INIT_FAILED`。」
- 「后续重试成功时以当时 Y.Doc 建立新 stream，其 genesis 只代表从该时点开始，不能伪称从 namespace 创建时起连续。」

**File adapter 布局**
- 「首版 File adapter 使用：`namespaces/{namespaceId}/current.json` + `streams/{streamId}/manifest.json` + `segments/00000001.jsonl`（与 `.bin`）。`.bin` 在该 segment 首次出现 sidecar payload 时惰性创建。」
- 「namespaceId、streamId 与 segment 名必须按各自安全文法校验后才能进入路径；不符合时日志不启用并上报，不通过编码、hash 或替换字符静默另存。」
- 「`current.json` 使用 temp + rename 原子替换，只保存 format/version/streamId，是可重建 locator 而非完整性证明。locator 损坏时不得按 wall clock 静默猜测最新 stream；扫描 manifests 后必须作确定性恢复或要求显式处置。」
- 「`manifest.json` 创建后不可变，至少保存：manifest format/version；streamId、namespaceId 与 createdAt；完整 record schema VFSL 四键信封；record、frame 与 schema 版本；committed update capture、input capture policy；inline threshold 与 JSONL line 上限。」
- 「owner、instanceId、replicationId 与 replication epoch 不冻结在 manifest；适用时由每条记录的受控 context 表达。」

**JSONL record**
- 「JSONL 使用 UTF-8、无 BOM、每行一个紧凑 JSON object，并以 `\n` 结束。writer 使用固定构造顺序方便人工查看，但格式不承诺 canonical JSON bytes，reader 不得依赖键顺序。」
- 「首版默认每次变更尝试只写一条最终 `attempt` record，不写 `attempt-started`。…记录身份是 `(streamId, sequence)`，不另设 recordId。`attemptId` 由最外层 producer 复用已有受控关联 ID，缺失时使用 128-bit CSPRNG 生成：`att- + 32 位小写 hex`。」
- 「writer 准备 append 时才分配 stream sequence。JSONL 以无前导零的十进制字符串表示 sequence，frame 以 uint64 big-endian 表示；sequence 不回绕，仅代表该 stream 的 append 顺序，不证明业务尝试无缺，也不是跨副本全局顺序。达到 uint64 最大值后 stream 进入 exhausted，后续日志 emission 丢弃并上报，业务不受影响。」
- 「v1 operation 是封闭词表：`namespace-create / root-mutation / schema-replacement / replication-apply / replication-enable / replication-epoch-bump`。新增 operation 需要新的 record schema 版本与 stream generation。」
- 「result 使用严格判别联合：committed + `noop`；committed + `update`；committed + `update-omitted`；rejected；fatal + `committed:false`；fatal + `committed:true`，effect 为 `update | update-omitted | unknown`。rejected 与 fatal committed:false 禁止携带 update。payload 超限时保留 attempt metadata，记录 `update-omitted` 与稳定 reason，而不是丢掉整条记录。」
- 「顶层诊断 `stage` 使用日志 schema 的封闭枚举；`code` 与 `sourcePhase` 使用安全 Pattern 字符串并标注 source module，不复制 Registry、Runtime、Persistence 与 replication 的全部错误枚举，也不发明 retryable、rollback 或提交事实。」
- v1 source/context 形状：`source: { kind: 'local' } | { kind: 'replication', direction: 'hub-to-peer' | 'peer-to-hub', remoteInstanceId: string }`；`context: { correlationId?, runtimeGeneration?, replicationId?, replicationEpoch? }`。「首版不定义 actor，等待授权主体模型稳定。」
- 「`observedAt` 由完成操作的 producer 使用注入 Clock 生成 UTC ISO 8601；`durationMs` 只在存在可靠 monotonic duration 来源时可选记录。首版不记录 appendedAt，排序以 sequence 为准，不按 wall clock 排序。」

**输入、issues 与资源投影**
- 「gate 前拒绝记录 `input.capture = not-accessed`；快照成功后只消费所属操作已经生成的 detached frozen snapshot；快照失败记录 `unavailable/unsafe-input`，不得重读 Proxy、accessor 或循环对象；默认 input capture 为 digest；digest 对安全 snapshot 的 RFC 8785 JCS bytes 计算 SHA-256；full/redacted 只消费安全 snapshot，超出 line 预算时降级为 digest，并记录 `projected-input-too-large`。」
- issues 统一投影 `{ code?: string; message: string; path: (string|number)[] }`；「每条 message 最大 4 KiB UTF-8，path 最多 256 个 segment，string segment 最大 1 KiB UTF-8，issues 最多 1000 条；超限时确定性截断并记录 `truncated` 与 `originalCount`。资源限制统一按 UTF-8 bytes 计算，截断不得拆分 Unicode code point。」
- 「最终 JSONL line 默认硬上限 1 MiB，可配置。输入导致超限时先降级为 digest；去掉输入后 record 仍超限则丢弃整条 record并通过健康面上报，不影响业务。」

**Inline 与 sidecar（本票 inline carrier + sidecar frame 直接规格）**
- 「默认 `inlineUpdateMaxBytes` 为 4 KiB，可配置；该阈值只影响物理表示：update 大小小于等于阈值时，以 RFC 4648 标准 Base64 内联，必须有正确 padding，禁止空白与换行；大于阈值时，append 到当前 segment 共享 `.bin`；inline 与 sidecar 均记录 payloadLength 与 CRC32C；sequence 与 frameOffset 在 JSONL 中为十进制字符串；uint32 范围内的 payloadLength 为 JSON number。」
- 「单个 sidecar payload 默认硬上限 64 MiB，可配置但不得超过 uint32。…即便结构化批量操作、genesis 或 replication diff 产生大 update，超限也只记录 `update-omitted/payload-too-large`，不改变原业务提交。」
- sidecar 引用形状：`{ "storage": "sidecar", "format": "yjs-update-v1", "segment": "00000001", "frameOffset": "12345", "payloadLength": 8160 }`。「frameOffset 指向 frame magic 的第一个字节，不保存可推导的 frameLength。」

**Binary frame v1（NDCL v1）**
- 「每个 sidecar payload 使用固定 25-byte header：magic 4 bytes ASCII "NDCL"；frameVersion 1 byte 0x01；payloadType 1 byte 0x01 = yjs-update-v1；flags 1 byte 0x00；reserved 2 bytes 0x0000；sequence 8 bytes uint64 big-endian；payloadLength 4 bytes uint32 big-endian；crc32c 4 bytes uint32 big-endian；payload N bytes raw Yjs update。」
- 「frame 总长度是 `25 + payloadLength`。v1 禁止压缩；payload 是原始 Yjs update bytes，非零 flags/reserved、未知 frameVersion 或 payloadType 均响亮判为 incompatible，不猜测解释。」
- CRC 参数：「poly 0x1EDC6F41 / init 0xFFFFFFFF / refin true / refout true / xorout 0xFFFFFFFF / check("123456789") = 0xE3069283」。「CRC 输入是 header 前 21 bytes（magic 至 payloadLength）直接连接 payload，不包含 crc32c 字段。inline update 同样保存 8 位小写 hex CRC32C，reader 严格解码 Base64 后核对 payloadLength 与 CRC。」

**VFSL record schema（append 前校验的直接依据）**
- 「VFSL 只定义一条最终 JSONL storage record，不定义 JSONL 文件、binary frame、segment 连续性或 retention。schema 使用固定已发布的 VFSL v1 方言，不引用 "latest"，id 为：`nomicore.namespace-diagnostic-change-record@1`。」
- 「writer 启动时编译一次内建 schema 并缓存。manifest 内嵌同一完整四键信封以便离线解释，但 manifest 不得改变运行中 writer 的规则。打开现有 stream 时，manifest format/version 和 schema fingerprint 必须与内建冻结版本匹配；不匹配则旧 stream 保持只读，建立新 generation，不改写旧 manifest。」
- 「VFSL 负责校验封闭对象、判别联合、literal enum、Pattern、decimal 字面形式、Base64 与 CRC 字面形状。storage validator 另行负责：严格 Base64 decode；decoded length 与 payloadLength 一致；inline/frame CRC 正确；JSONL 与 frame 的 sequence、format/payloadType、payloadLength 一致；offset、segment、frame 边界与 stream 连续性。」
- 「业务 producer 只提交 semantic emission，不构造 segment/offset/Base64 等物理表示。日志 adapter 独占 storage projection：先决定 inline/sidecar并构造最终 record，再运行 VFSL。首版不为 semantic emission 建立第二份 VFSL，避免双 schema 漂移。」
- 「append 前 VFSL validation failure 是日志 writer bug：丢弃 record、增加低基数 metric并向独立结构化 observer 上报，不改变业务结果。observer只包含稳定 code、schema id/fingerprint、operation、source module、VFSL issue codes/paths与 projected record byte size；不包含原 record、input、Base64、update bytes、底层 message、Error/cause或stack。同一 JSONL中不写递归 health record。」

**Writer、append 与背压（BIN-first 顺序的直接依据）**
- 「日志 adapter 提供有界、non-blocking emitter，内部每个 stream 同时最多一个逻辑 writer queue。File adapter沿用单进程独占根目录的部署约束，不实现跨进程锁；多 Runtime generation 共享 namespace stream 的同一 writer queue，stream不绑定 Runtime generation。文件句柄可由LRU管理。」
- Inline append 顺序：「构造最终 record → VFSL validation → storage validation → append JSONL」。Sidecar append 顺序：「取得当前 segment 与预计 frameOffset → 构造最终 record → VFSL validation → storage validation → append 完整 BIN frame → append JSONL」。
- 「BIN-first 避免完整 JSONL 引用尚不存在的 frame，但崩溃可能留下完整 orphan frame、不完整尾 frame 或不完整 JSONL 尾行；这些均符合 best-effort 语义。writer queue 满时 drop newest，保留已排队顺序；不得为了记录 drop 再挤占同一队列。按 operation/reason 增加低基数 dropped metrics，并走独立 observer。」
- 「默认周期 batch flush，不逐条 fsync；真正 fsync 可配置且默认关闭。write/flush完成不构成掉电持久性承诺。flush失败只改变日志健康，不影响业务。shutdown可best-effort drain，但不得无限等待日志 sink或阻塞Registry/Persistence停止。」

**冻结项纪律（manifest "format policy" 的内容边界）**
- 「影响记录解释的配置在stream创建时冻结；包括record/schema/frame版本、committed update capture、input capture policy、inline threshold与line上限。冻结项改变时新建stream generation。retention、queue容量、batch/flush策略、fd cache与metrics sampling可动态调整。」

**Strict reader（本票 strict reader 直接规格；replay 工具本体归 #155）**
- 「默认strict reader对每条record执行JSON parse、VFSL validation及storage/frame交叉校验。显式metadata-only或unsafe-fast模式可用于检查/导出，但不得声称可重放；replay强制strict。」
- 「未知VFSL dialect、record format、frameVersion或payloadType使该stream为incompatible；reader可展示manifest和原始文件元数据，但不得近似解释、跳过未知记录后继续声称连续。不同stream互不连带。」

**范围外但同属 ADR-0012 的模块（本票不做，归 #153/#154/#155）**
- Segment rolling 与耗尽（默认 targets 64 MiB / 256 MiB / 100,000 records；segment 从 `00000001` 起，`00000000` 保留，8 位十进制不回绕；到 `99999999` 后 exhausted）→ #153。
- 打开与尾部恢复（交叉扫描 JSONL 与 BIN；只自动修复可证明最终尾部：截断最终不完整 JSONL 行/截断最终不完整 frame/截断完整但未被引用的尾部 orphan frames；中间损坏标 corrupt 或 incompatible 只读、新建 generation）→ #153。
- Retention 与删除（maxAge 30 days / maxBytesPerNamespace 1 GiB；`.deleting` 删除协议；`openReadSession()` reader lease；按 namespace 日志删除能力）→ #154。
- 诊断性 replay（`{ status, lastAppliedSequence, issues, snapshot? }`；complete 的五条件；不暴露 live Y.Doc）→ #155。

**被否方案（设计红线，SA1 不得复活）**
- 「每个update一个`.bin`文件」「全部Base64内联JSONL」「裸payload sidecar」「默认started/completed双记录」「让producer构造offset/segment」「只用TypeScript类型、不做VFSL验证」「让manifest schema决定writer规则」「跨记录hash chain或签名」「每条fsync或业务await日志append」「自动修复中间损坏或从BIN重建JSONL」。

**验收门槛（本票 AC 对应其中 1、2、3、4、10 的 File adapter 子集）**
- 「1. 小update内联并通过VFSL、Base64、length、CRC round-trip；2. 大update写frame并通过offset/type/sequence/length/CRC交叉验证；3. 恰4KiB内联、4KiB+1 sidecar；4. rejected、fatal、committed/noop/update/update-omitted各判别分支；10. manifest envelope不匹配时新建stream，不改旧manifest。」

### ADR-0011 Best-effort namespace 诊断变更日志（accepted）——产品语义基础

- 与本任务的关联点：本票 File adapter 是 ADR-0011 产品语义 + ADR-0012 物理格式的落地；隔离纪律与 emitter seam 约束 adapter 的公共面。
- 核心条款（原文摘录）：
  - 「日志 emit、排队、持久化、背压、丢弃或关闭失败不得改变业务操作的返回值、rejection、提交事实、sequencer 顺序或 Runtime 状态」；「日志不得成为 `createDoc`、Yjs transaction、dirty notification 或 replication ACK 的成功前置条件」；「日志实现不得因失败将 namespace 标记为 fatal、persistence-degraded 或只读，也不得触发业务请求重试」。
  - 「日志 adapter 必须以 non-throwing、有界、非阻塞的 emitter seam 接收记录。…adapter 同步 throw 或异步失败均被隔离，并只进入独立的日志健康 metrics/observer。」
  - 「`emit` 的 interface 语义是立即接收一份由调用方持有权已转移或已复制的 detached record；不得阻塞、throw、返回 durability promise，亦不得保留调用方可变引用。」
  - 「变更尝试的业务排序继续由现有 Registry lifecycle slot 或 namespace write sequencer 决定，日志不得引入第二个业务排序机构」；「committed record 的 sequence 分配与 emitter 接收可发生在 transaction committed 事实可知之后，但 emitter 不被 `await`」；「`notifyDirty` 仍按 ADR 0008/0010 的原有槽序执行。日志记录 dirty failure，但不替代或包裹 dirty notification」；「adapter 慢、失败或队列满都不得延长 write slot 或阻塞 close/shutdown」。
  - 「完整查询、导出、重放、保留与健康检查属于日志存储/工具模块的 interface，不扩张 `NamespaceRuntime`、`NamespaceLease`、`DocPersistence` 或 replication wire interface。一个日志 adapter 不构成新的 Persistence 真相源；snapshot Persistence 与诊断日志独立演进。」
  - 结局词表与阶段词表（committed/rejected/fatal/unknown；acceptance/capability-gate/input-snapshot/schema-compile/validation/identity/transaction/dirty-notification）；「`rejected` 不得折叠成统一 `failed`」。
  - 数据保护条款：「默认不记录 token、凭证、原始 Authorization、完整 Error stack、任意 cause 文本或未经控制的 transport payload」；「`full` 输入与 committed Yjs update 必须由 Host 明确启用」。

### ADR-0008 NamespaceRuntime 读写能力与单序列器（accepted）

- 与本任务的关联点：日志（含本票 File adapter）挂在 ADR-0008 的写路径/生命周期旁路上，不得破坏单 sequencer、写槽与 fatal/close 契约。
- 核心条款（原文摘录）：
  - 「同一 namespace 内所有受控 Y.Doc 写共享唯一严格 FIFO write sequencer；不同 namespace 可并行。」
  - 每个写任务槽序：「lifecycle/fatal gate、`DocHandle.getStatus()` writable gate、输入快照、领域校验和 detached 构造、一次 Yjs transaction、`await notifyDirty()`，然后才释放给下一任务。」
  - 「adapter 慢、失败或队列满都不得延长 write slot 或阻塞 close/shutdown」（引自 ADR-0011 对 0008 槽序的引用）；ADR-0012 落实为「多 Runtime generation 共享 namespace stream 的同一 writer queue，stream不绑定 Runtime generation」（对应验收门槛 12「Runtime reopen/多generation仍经单writer有序append」）。

### ADR-0009 NamespaceRegistry、调用方租约与 Host 生命周期（accepted）

- 与本任务的关联点：日志初始化/启用不得影响 namespace create 与 Registry lifecycle；shutdown 不得被日志无限拖延。
- 核心条款（原文摘录，均经 ADR-0011/0012 引用落实）：
  - ADR-0012：「初始化失败不影响 namespace create；独立健康 observer 上报 `LOG_STREAM_INIT_FAILED`」。
  - ADR-0011：「Host shutdown 可 best-effort drain 日志，但 Registry/Persistence 的停止不得无限等待日志 sink」；ADR-0012 同款：「shutdown可best-effort drain，但不得无限等待日志 sink或阻塞Registry/Persistence停止」。

### ADR-0006 Cordis 持久化插件——DocPersistence 接口与 doc 三条目内容布局（accepted，含多次修订）

- 与本任务的关联点：划定 snapshot Persistence 与诊断日志存储的边界；本票 File adapter 不构成 Persistence 真相源、不改 DocPersistence 契约；temp+rename 原子写模式被 current.json 原子替换沿用。
- 核心条款（原文摘录）：
  - ADR-0012 关联节：「它不修改 ADR 0006 的 snapshot Persistence…也不把日志配置带入 namespace 复制数据面」；ADR-0011：「一个日志 adapter 不构成新的 Persistence 真相源」。
  - 0006 原文（模式借鉴）：「写入 `{namespaceId}.snapshot.tmp` 后以原子 rename 覆盖 `{namespaceId}.snapshot`」——ADR-0012 的 `current.json` 使用同款 temp + rename 原子替换。
  - 0006 的磁盘布局（`users/{userId}/{namespaceId}.snapshot`）只约束 snapshot Persistence；ADR-0012 日志布局（`namespaces/{namespaceId}/…`）是独立目录空间，两者互不修改。

### ADR-0001 VFSL 文本是 schema 的唯一真相源（accepted，含 2026-08-19 修订）

- 与本任务的关联点：内建冻结 VFSL record schema（`nomicore.namespace-diagnostic-change-record@1`）的合规性依据——本票「不改 schema」，仅消费 #148 已交付的内建冻结 schema。
- 核心条款（原文摘录）：
  - 「本仓库是纯引擎仓库：代码库不含 schema 文本（测试 fixture 除外）。VFSL 文本只作为运行时数据存在于文档的 `SCHEMA` 中。」
  - 修订节：「阶段态放行：体系未完全建立之前，允许仓内放置 schema 文件作为开发脚手架完成阶段性开发」。
  - 「方言只增不改，未知方言 loud-fail 只读」（正文首段）——ADR-0012 的 strict reader「未知版本 incompatible、不近似解释」是同一纪律在日志面的落点。
  - 注：内建 schema 的存在与「writer 启动时编译一次内建 schema」由 ADR-0012 明文决策；本票不新增 schema 文本、不建第二份 VFSL（0012：「首版不为 semantic emission 建立第二份 VFSL」）。

### ADR-0007 逻辑验证与 Yjs Runtime Bridge 分层（accepted；open/read 条款已被 0008 取代）

- 与本任务的关联点：间接——指纹格式条款被 #148 的 envelope 指纹沿用；被取代条款不构成约束。
- 核心条款（原文摘录）：
  - 「指纹使用 SHA-256、UTF-8、canonical JSON 和带版本的 domain separation（`sha256:v1:<hex>`）。envelope fingerprint 覆盖四键」——上游 #148 交付的 envelope 指纹 `sha256:v1:dedad2ab…` 即此格式；本票 strict reader/manifest 匹配检查消费该指纹（ADR-0012：「manifest format/version 和 schema fingerprint 必须与内建冻结版本匹配」）。
  - 「本文关于 logical validation、detached materialization、validated mutation、零写入与 observer no-rollback 的底层决策继续有效」（取代范围节）——与日志无直接交集。

### 弱相关 ADR（无本票直接条款，列出备查）

- **ADR-0002**（rewrite、authority 出范围，accepted）：本票不触及 authority 规则；无交集条款。
- **ADR-0003**（求值器与派生 schema，accepted）：`evaluate`/派生 schema 是 VFSL 编译链地基；本票消费 #148 已编译冻结 schema，不直接调用 evaluate 接缝。
- **ADR-0004**（vfsl-protocol 类型投影，accepted）：编译期类型投影域，与日志 record schema 无交集；0012 被否方案「只用TypeScript类型、不做VFSL验证」正说明 record 形状不走投影包。
- **ADR-0005**（投影生成管线，accepted）：SchemaSource 接缝纪律针对「仓内脚手架 schema 消费方」；本票消费的是 ADR-0012 决策的内建冻结 schema，不是 DocSchemaSource/脚手架场景。

## CONTEXT.md 相关术语与惯例

- **namespace 诊断变更日志**：「从 namespace 创建开始尽力记录所有变更尝试及其结构化结局的可选 observability 流；连续的 committed Yjs updates 可用于诊断性重放，但日志不参与业务提交、不承诺完整性或恢复能力。」_Avoid_: 审计账本、WAL、event sourcing、可靠恢复日志。
- **变更尝试**：「一次可能修改 namespace 的请求及其结局；结局区分 committed、rejected 与 fatal，并标明 acceptance、capability gate、input snapshot、validation 等阶段。被拒请求也属于变更尝试，即使它从未读取输入或进入 transaction。」_Avoid_: 仅成功事务、统一 failed 事件。
- **诊断日志 stream generation**：「一个 namespace 的一代独立诊断日志，包含不可变 manifest、VFSL 校验的分段 JSONL records 与可选 framed binary sidecar；冻结格式或策略改变、旧 stream 损坏或无法安全续写时建立新 generation，各 generation 不自动拼接重放。」_Avoid_: Runtime generation、replication epoch、跨 generation 隐式连续日志。
- **语义 emission**：「producer → 诊断日志 emitter 提交的 detached 语义结局——operation/stage/observedAt/source/context/result（update 以 owned bytes 表达），不含 streamId/sequence/segment/frameOffset/Base64/CRC 等物理表示（storage projection 归 adapter）。emit 同步、不 throw、不阻塞；快照与 updateBytes 所有权移交后不得再变异。update-omitted 稳定 reason 受控词表（v1）：`payload-too-large` / `update-capture-disabled` / `empty-update`——新增 reason 属词表演进，须过设计评审。」_Avoid_: 物理载体细节、append 后引用、durability promise。
- **storage projection**：「日志 adapter 独占的物理表示决策——先决定 inline/sidecar 并构造最终 record（segment/frameOffset/payloadLength/CRC32C/Base64），再运行 VFSL 校验；emitter 只做语义投影，不构造物理字段。」_Avoid_: 业务侧构造物理载体、emission 面物理键、VFSL 双 schema。
- **genesis baseline record**：「新 stream 的 genesis 基线——当时完整 Y.Doc 的 update，不是变更尝试（无 attemptId/operation/stage/result/input；顶层 `recordKind: 'genesis-baseline'` 判别）；v1 冻结的 emission/sink 公共面无构造路径，由 #152 adapter 内部构造（设计 §10-J1 备案）。」_Avoid_: attempt-started、result `'unknown'`、跨 stream genesis。
- **信封（envelope）**：「顶层具名 `SCHEMA` Y.Map 中 `lang/version/id/text` 四个字符串键投影出的严格普通对象…信封可哈希、可 diff。」——ADR-0012 manifest 内嵌的「完整 record schema VFSL 四键信封」即此四键结构。
- **信封指纹（envelope fingerprint）**：「封闭四键 schema 信封 `{ lang, version, id, text }` 的身份；任一键变化都会改变，用于观察 namespace 当前信封是否变化。」
- **方言（dialect）**：「`lang + version` 决定的 VFSL 语法子集与语义规格；一经发布冻结，引擎只增不改，未知方言 loud-fail 只读。」
- **标记类型（marker types）**：`YMap` / `YArray` / `YPlainArray` / `YLeaf` / `YXmlFragment` / `Pattern`——大小写是契约；record schema 中的 Pattern/Base64 等字段形状以此为准。
- **零写入（zero-write）**：「校验失败 → 400 且文档不变；所有写入口走同一条管线。」——业务写纪律；日志故障隔离（0011/0012）与之正交，日志任何失败不得造成业务零写入面变化以外的行为改变。

## 设计后复审追加（R1，2026-08-28）

> SA8 设计后复审登记：SA1 R1 设计（`wiki/raw/task_diagnostic-log-file-adapter_design.md`，729 行，含总控 §11 六项裁决）引入的新决策点与解释性裁决。只登记增量，不重复前置门禁全量盘点；逐条裁决见 `task_diagnostic-log-file-adapter_design_conflict_report.md`。

### 设计引入的解释性裁决（no-conflict 备案，SA2 可攻击但非门禁阻塞）

- **J1 同步写契约（§4.3）**：每 record 同步 write、无队列、无 batch、emit 返回即落盘（不 fsync）。依据链：#148 基线已将「非阻塞」解释为「有界同步工作」（`src/adapters/memory.ts` 头注：「永不阻塞（全同步、纯内存…以 line 预算为上界）」）；ADR 0011「日志模块**可**在其实现内部使用有界队列、batch、sampling、文件或远端 sink」为许可式列举；ADR 0012「batch/flush策略…可动态调整」为策略项；被否方案仅否「每条 fsync 或业务 await 日志 append」（设计两者皆无）。emit 有界性 = line 预算 + payload 上限。**接线期注意（转 #149–#151）**：ADR 0011「adapter 慢…不得延长 write slot」要求 emit 调用点置于 write sequencer 槽外或槽后。
- **§3.4 resume 恒新建（J5/总控 G1）**：`resumeStreamId` 只做指纹匹配检查，四分支全部落「新建 generation，旧 stream 只读、字节恒等」。依据：安全续写依赖「打开与尾部恢复」全机制（#153 范围）；无修复的续写会把最终尾部损坏固化成中间损坏；ADR「旧 stream 无法安全续写…时建立新 stream」在 #152 验证能力边界内诚实适用。匹配分支无事件（不扩 reason 词表）已由总控 G1 批准，可诊断性损失记 REPORT 遗留风险。
- **§4.2 genesis 超 payload 上限跳过（不写 update-omitted）**：事实依据（本次复审核实）：冻结 schema `GenesisBaselineRecord.update: UpdateCarrier` 为强制键、无 omitted 变体（`src/schema.ts:210-218`；`update-omitted` 仅存在于 `AttemptResult`）——「genesis 记录 update-omitted/payload-too-large」在 v1 schema 内不可表达，跳过 genesis 是唯一 schema 保形选项；后果由 ADR「genesis 未成功写入时 stream 仍可记录诊断事实，但不得声称完整重放」覆盖。genesis 守卫跳过消耗 sequence（attempt 从 '2' 起，J3/总控 G2）。
- **延后项（前置门禁已备案的范围切分重申）**：segment rolling 与耗尽处理、打开与尾部恢复、retention、replay → #153/#154/#155；fsync 开关暴露 → 后续部署票（#152 恒关 = ADR 默认值）。设计不实现这些条款但不与其字面冲突。
- **J2 无常驻 fd / J7 'wx' EEXIST 碰撞检测 ≤8 次重试 / J8 payload 守卫 `min(配置, uint32)` / J11 reader 扫描全部 segment / J12 文法常量复用 / J13 JSON.stringify 固定序不承诺 canonical**：均落在 ADR 许可式条款（「文件句柄可由 LRU 管理」之「可」、「碰撞时有限重试」、「不得超过 uint32」的 clamp 满足、reader 面向布局而非 writer 版本史）内，no-conflict。
- **总控 §11 六项裁决（G1–G6）对照**：六项均不与 ADR 冲突——G1（见上）、G2（无 ADR 条款触及 genesis sequence 编号）、G3（`storage-validation-failed.code` 扩值 `'frame-missing'`——ADR 无健康码穷举表，observer 内容纪律保持）、G4（manifest format/version 异常 → corrupt，ADR 未定义该分类）、G5（敌意入参 corrupt + locator-invalid，防御性零 fs 触达）、G6（见 J1）。

### 门禁裁决关联（唯一冲突点）

- **J9 sequence exhausted 静默丢弃（§4.1/§10-J9）→ evolution**：ADR 0012 §JSONL record「达到 uint64 最大值后 stream 进入 exhausted，后续日志 emission 丢弃**并上报**，业务不受影响」——设计的 exhausted 丢弃无任何上报通道（`record-dropped.reason` 冻结两值无 exhausted 位，`src/health.ts:43` 核实；File adapter 无 stats 面，设计 §1.4 明示）。#148 基线实为「丢弃 + stats 计数」（`src/adapters/memory.ts:12,323-324`）——设计转述「丢弃静默」并进一步弱化。物理不可达（uint64 max ≈1.8×10¹⁹）+ 总控六项裁决未覆盖 J9 → 按 SA8 四级裁决记 evolution（不自动停，上报 Jim 裁决），详见冲突报告 #1。

## 门禁注记（非裁决，供 SA1/SA2/SA3 参考）

1. **范围切分张力点（非冲突）**：本票范围不含 #153（segment rolling / 打开与尾部恢复）；但 ADR-0012 的「打开现有 stream 时 manifest fingerprint 匹配检查（不匹配 → 旧 stream 只读、新建 generation、不改旧 manifest）」与验收门槛 10 属于本票 manifest/strict reader 语义的一部分。SA1 需明确本票对「打开既有 stream」支持到什么程度（如仅指纹匹配判定 + 新建 stream，尾部恢复整体归 #153），切分不得违反 ADR-0012 任一条款。
2. **Genesis 构造备案**：adapter 内部构造 genesis baseline record 且「不改 schema」是 CONTEXT.md 已备案裁决（设计 §10-J1）；schema 已含 `recordKind: 'genesis-baseline'` 判别分支，本票无需也不得扩词表。
3. **上游依赖事实**：#148（PR #156，commit 7ceede1 已在基线）交付 `@nomicore/namespace-diagnostic-log` 包：冻结 v1 词表/record 类型、内建冻结 VFSL schema、envelope 指纹 `sha256:v1:dedad2ab93d9df9224960ca094924168f8bcc1c0512dfdd0a03dc6e66613e070`、emitter 管线、内存 adapter、crc32c、carrier（Buffer Base64 inline）、health 事件联合、testing 工具。本票 File adapter 建于其上。
