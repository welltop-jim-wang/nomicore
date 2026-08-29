# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出（Phase 0，审任务简报 `wiki/raw/task_diagnostic-log-stream-roll-repair.md`，Issue #153 round=1，功能开发）。
> 只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
> ADR 全集 = `docs/adr/0001–0009、0011、0012`（共 11 个文件；无 0010 文件——ADR-0011/0012 正文引用的「ADR 0010 trusted replication」不在本仓库 ADR 目录中，不构成本门禁基准）。
> 本文按本票五个范围项（续写 reopen / segment 滚动 / 启动尾部修复 / 耗尽 / 崩溃窗口测试）组织摘录；#148/#152 交付面属代码与 wiki 档案层，仅作背景，不构成 SA8 冲突基准。

## 相关 ADR

### ADR-0012 VFSL 校验的 JSONL 与 framed sidecar 诊断日志格式（accepted，含 2026-08-28 首切片 amendment）——本票主规范

#### A. Stream 与 generation（范围项 1：健康 stream 续写 reopen）

- 与本任务的关联点：reopen 健康 stream、新建 generation 的触发条件、locator 确定性处置、单进程部署约束全部由此节规定。
- 核心条款（原文摘录）：
  - 「正常重启继续健康 stream；首次启用、旧 stream 无法安全续写、冻结配置改变、显式 rotate/reset 时建立新 stream。每个新 stream 尽力先记录当前完整 Y.Doc 的 genesis baseline，使该 stream 可独立诊断性重放；genesis 未成功写入时 stream 仍可记录诊断事实，但不得声称完整重放。工具不自动串联多个 generation。」
  - 「碰撞时有限重试；耗尽只使日志能力不可用并上报健康故障，不改变 namespace 业务结果。」
  - 「日志启用与配置是本地 Host/Registry 旁路状态，不写入 namespace `SCHEMA`、`META` 或 `ROOT`，也不随 Hub/Peer 复制。」
  - （streamId 文法）「`streamId` 使用受控 128-bit CSPRNG 生成：`log- + 32 位小写 hex`」——新 generation 的 streamId 本身是 CSPRNG 值，「确定性」约束适用于恢复/选择过程，不适用于新 streamId 取值。

#### B. File adapter 布局与 locator（范围项 1：locator 解析与歧义处置）

- 核心条款（原文摘录）：
  - 「`current.json` 使用 temp + rename 原子替换，只保存 format/version/streamId，是可重建 locator 而非完整性证明。locator 损坏时不得按 wall clock 静默猜测最新 stream；扫描 manifests 后必须作确定性恢复或要求显式处置。」
  - 「`manifest.json` 创建后不可变，至少保存：manifest format/version；streamId、namespaceId 与 createdAt；完整 record schema VFSL 四键信封；record、frame 与 schema 版本；committed update capture、input capture policy；inline threshold 与 JSONL line 上限。」（「至少保存」为非穷举——追加字段不被禁止，但 manifest 创建后不可变。）
  - 「`.bin` 在该 segment 首次出现 sidecar payload 时惰性创建。namespaceId、streamId 与 segment 名必须按各自安全文法校验后才能进入路径；不符合时日志不启用并上报，不通过编码、hash 或替换字符静默另存。」
  - 「File adapter沿用单进程独占根目录的部署约束，不实现跨进程锁」（「正常进程重启」是顺序复用，非跨进程并发）。

#### C. 打开现有 stream 的匹配检查（范围项 1：strict 检查证明健康）

- 核心条款（原文摘录）：
  - 「打开现有 stream 时，manifest format/version 和 schema fingerprint 必须与内建冻结版本匹配；不匹配则旧 stream 保持只读，建立新 generation，不改写旧 manifest。」
  - 「未知VFSL dialect、record format、frameVersion或payloadType使该stream为incompatible；reader可展示manifest和原始文件元数据，但不得近似解释、跳过未知记录后继续声称连续。不同stream互不连带。」
  - （storage validator 职责，来自 §VFSL record schema）「storage validator 另行负责：严格 Base64 decode；decoded length 与 payloadLength 一致；inline/frame CRC 正确；JSONL 与 frame 的 sequence、format/payloadType、payloadLength 一致；offset、segment、frame 边界与 stream 连续性。」
  - （sequence 分配纪律，来自 §JSONL record）「writer 准备 append 时才分配 stream sequence。……sequence 不回绕，仅代表该 stream 的 append 顺序，不证明业务尝试无缺，也不是跨副本全局顺序。」

#### D. Writer/append 与首切片 amendment（范围项 1：单逻辑 writer；范围项 5：崩溃窗口）

- 与本任务的关联点：本票明确排除 queue/batch/fsync/常驻 fd 的直接依据；reopen/修复的任何同步文件操作接线均受 write-slot 规则约束。
- 核心条款（原文摘录）：
  - 「多 Runtime generation 共享 namespace stream 的同一 writer queue，stream不绑定 Runtime generation。文件句柄可由LRU管理。」——其中「同一 writer queue」句已按下方 amendment 在首切片范围内被取代；「stream 不绑定 Runtime generation」原则仍然有效。
  - （Amendment — File adapter first slice，2026-08-28）「每个 `emit` 在调用栈内执行至多一条 final JSONL record 的有界同步 append；若其携带 sidecar，则额外执行至多一帧 BIN append，顺序为 BIN-first。该首切片不维护 writer queue、不做 batch flush、不提供 fsync 开关，也不保持常驻 file descriptor。同步 append 完成不构成 fsync 或掉电持久性承诺。」
  - （amendment 接线纪律，规范性）「**任何将 File adapter 的 `emit` 接入 namespace 生命周期的调用点，必须位于 NamespaceRuntime write sequencer slot 之外，或在该 slot 已释放之后；不得在 slot 内执行同步 File adapter `emit`。**不满足该条件的接线为不合规。」
  - 「queue/batch 是目标演进形态而非与首切片并列的当前要求：未来切片可在不改变 emitter 公共 seam、record schema、manifest policy 或上述 write-slot 隔离条件的前提下，以每 stream 至多一个逻辑 writer queue 替换同步 append，并采用有界队列、drop/health 语义和周期 batch flush；该切片须另行定义 close/shutdown、flush、队列满与 fsync 配置语义。」
  - （崩溃窗口语义）「BIN-first 避免完整 JSONL 引用尚不存在的 frame，但崩溃可能留下完整 orphan frame、不完整尾 frame 或不完整 JSONL 尾行；这些均符合 best-effort 语义。writer queue 满时 drop newest，保留已排队顺序。」（首切片无 queue，drop 语义以 amendment 为准。）

#### E. Segment rolling 与耗尽（范围项 2 / 4）

- 核心条款（原文摘录）：
  - 「JSONL/BIN作为一个segment group成对滚动，默认targets为：`targetJsonlSegmentBytes = 64 MiB`、`targetBinSegmentBytes = 256 MiB`、`targetRecordsPerSegment = 100,000`。均可配置。任一target达到时，在写入下一条record前关闭当前group并开启新group；单条合法record可让新group超过target，但不得超过record/payload硬上限。」
  - 「segment从`00000001`开始，`00000000`保留，固定8位十进制，不回绕。达到`99999999`后stream进入exhausted，后续日志丢弃并上报，业务不受影响。」
  - （sequence 耗尽，来自 §JSONL record）「达到 uint64 最大值后 stream 进入 exhausted，后续日志 emission 丢弃并上报，业务不受影响。」
  - （配置冻结/动态二分，滚动 target 分类须对照此条）「影响记录解释的配置在stream创建时冻结；包括record/schema/frame版本、committed update capture、input capture policy、inline threshold与line上限。冻结项改变时新建stream generation。retention、queue容量、batch/flush策略、fd cache与metrics sampling可动态调整。」——两个清单均为「包括」式非穷举；roll targets 未被任一清单显式收录，其归属是本票设计裁决点（SA1 须给出归类与 ADR 依据）。

#### F. 打开与尾部恢复（范围项 3：启动尾部修复）

- 核心条款（原文摘录）：
  - 「打开既有 stream 时，writer交叉扫描JSONL与BIN。只自动修复可以证明的最终尾部：截断最终不完整 JSONL 行；截断最终不完整 frame；截断完整但未被任何完整 JSONL record引用的尾部 orphan frames。」
  - 「自动修复通过observer上报。以下情况不尝试修复中间数据：中间坏JSON行、VFSL失败、CRC错、sequence/type/length不符、JSONL引用不存在frame、offset越界/重叠、未知format/dialect/frame/payload。旧stream标为corrupt或incompatible并保持只读，创建新generation；不得从BIN猜回丢失的JSONL attempt语义。」
  - （被否方案）「自动修复中间损坏或从BIN重建JSONL：无法恢复attempt、stage、issues与input等语义，会制造虚假连续性。」
  - （observer 数据纪律，来自 §VFSL record schema，可一般化到修复上报事件）「observer只包含稳定 code、schema id/fingerprint、operation、source module、VFSL issue codes/paths与 projected record byte size；不包含原 record、input、Base64、update bytes、底层 message、Error/cause或stack。同一 JSONL中不写递归 health record。」

#### G. 验收门槛（范围项 5：测试面对照）

- 核心条款（原文摘录）：
  - 「7. BIN-first/JSONL-second各崩溃窗口；」
  - 「8. 最终坏尾自动修复，中间损坏新建stream且旧stream只读；」
  - 「9. segment滚动、sequence/segment耗尽与retention成对删除；」（本票排除 retention 实施——#154；测试面相应裁剪属范围选择。）
  - 「10. manifest envelope不匹配时新建stream，不改旧manifest；」
  - 「12. Runtime reopen/多generation仍经单writer有序append；」

### ADR-0011 Best-effort namespace 诊断变更日志（accepted）——业务隔离与健康上报总纲

- 与本任务的关联点：reopen/滚动/修复/耗尽的任何失败路径都不得改变业务结果；修复上报走独立健康 observer 且受数据保护纪律约束。
- 核心条款（原文摘录）：
  - 「日志 emit、排队、持久化、背压、丢弃或关闭失败不得改变业务操作的返回值、rejection、提交事实、sequencer 顺序或 Runtime 状态；」
  - 「日志不得成为 `createDoc`、Yjs transaction、dirty notification 或 replication ACK 的成功前置条件；」
  - 「日志实现不得因失败将 namespace 标记为 fatal、persistence-degraded 或只读，也不得触发业务请求重试；」
  - 「日志 adapter 必须以 non-throwing、有界、非阻塞的 emitter seam 接收记录。……adapter 同步 throw 或异步失败均被隔离，并只进入独立的日志健康 metrics/observer；」
  - 「adapter 慢、失败或队列满都不得延长 write slot 或阻塞 close/shutdown；」
  - （数据保护）「日志字段不得进入默认低基数 metrics label。」

### ADR-0008 NamespaceRuntime 读写能力与单序列器（accepted，含 2026-08-24 稳定码注册修订）——写槽隔离

- 与本任务的关联点：ADR-0012 amendment 的 write-slot 接线纪律以其单 sequencer 条款为直接依据；本票不做 emit 接线（#149–#151/#155 排除），但 reopen/修复设计不得引入 slot 内同步文件操作。
- 核心条款（原文摘录）：
  - 「同一 namespace 内所有受控 Y.Doc 写共享唯一严格 FIFO write sequencer。」
  - 「每个真正写任务的槽依次执行：lifecycle/fatal gate、`DocHandle.getStatus()` writable gate、输入快照、领域校验和 detached 构造、一次 Yjs transaction、`await notifyDirty()`，然后才释放给下一任务。」

### ADR-0006 Cordis 持久化插件（accepted，含 createDoc/owner 与 entry status 修订）——间接

- 与本任务的关联点：诊断日志独立于 snapshot Persistence；本票不得触碰 `.snapshot` 布局与 flush 语义。temp+rename 原子替换模式为 locator 所沿用（ADR-0012 已明文）。无直接相反条款。

### ADR-0009 NamespaceRegistry/租约/Host 生命周期（accepted）——间接

- 与本任务的关联点：日志启用与配置是「本地 Host/Registry 旁路状态」（ADR-0012）；Runtime generation 更迭/空闲复用不影响 stream 身份（stream 不绑定 Runtime generation）。shutdown 不无限等待日志 sink（ADR-0011/0012）。无直接相反条款。

### ADR-0001 / 0002 / 0003 / 0004 / 0005 / 0007（accepted）——盘点结论

- 与本票五个范围项无直接条款交集；仍受其既有边界约束（record schema 的 VFSL 冻结纪律经 ADR-0012 §VFSL record schema 间接约束本票：不改 record schema 版本/指纹）。
- ADR-0007 的 Runtime/open/read 条款中被 ADR-0008 明示取代的范围不构成约束。

## CONTEXT.md 相关术语与惯例

- **namespace 诊断变更日志**：「从 namespace 创建开始尽力记录所有变更尝试及其结构化结局的可选 observability 流；连续的 committed Yjs updates 可用于诊断性重放，但日志不参与业务提交、不承诺完整性或恢复能力。」_Avoid_: 审计账本、WAL、event sourcing、可靠恢复日志。
- **诊断日志 stream generation**：「一个 namespace 的一代独立诊断日志，包含不可变 manifest、VFSL 校验的分段 JSONL records 与可选 framed binary sidecar；冻结格式或策略改变、旧 stream 损坏或无法安全续写时建立新 generation，各 generation 不自动拼接重放。」_Avoid_: **Runtime generation、replication epoch、跨 generation 隐式连续日志**——AC1 的「across Runtime generations」指 stream 跨越多个 Runtime generation 存续（ADR-0012「stream不绑定 Runtime generation」），不得与 stream generation 概念混同。
- **语义 emission**：「producer → 诊断日志 emitter 提交的 detached 语义结局……不含 streamId/sequence/segment/frameOffset/Base64/CRC 等物理表示（storage projection 归 adapter）。emit 同步、不 throw、不阻塞……」——本票滚动/续写/修复全部落在 adapter 的 storage projection 领地，emission 公共面不动。
- **storage projection**：「日志 adapter 独占的物理表示决策——先决定 inline/sidecar 并构造最终 record（segment/frameOffset/payloadLength/CRC32C/Base64），再运行 VFSL 校验；emitter 只做语义投影，不构造物理字段。」_Avoid_: 业务侧构造物理载体、emission 面物理键、VFSL 双 schema。
- **genesis baseline record**：「新 stream 的 genesis 基线——当时完整 Y.Doc 的 update，不是变更尝试……顶层 `recordKind: 'genesis-baseline'` 判别；v1 冻结的 emission/sink 公共面无构造路径，由 #152 adapter 内部构造（设计 §10-J1 备案）。」——本票新建 generation 时沿用该内部构造路径。
- **update-omitted 稳定 reason 受控词表（v1）**（语义 emission 词条内）：「`payload-too-large` / `update-capture-disabled` / `empty-update`——新增 reason 属词表演进，须过设计评审。」——健康事件/词表演进同纪律：本票新增健康事件成员走 #148 §10-J13 式预授权路径（简报明示），并对照 ADR-0011 数据保护与 ADR-0012 observer 内容限制裁决。

## 设计后复审追加（round 1）— SA1 设计引入的新决策点

> 来源：`task_diagnostic-log-stream-roll-repair_design.md`（SA1 round 1）。以下为设计新引入、全链（SA2/SA3/SA6/SA7）复用的决策点及其 ADR 锚定；裁决见 `task_diagnostic-log-stream-roll-repair_design_conflict_report.md`。

1. **manifest 17 键形状（D5/§4.2/§9.1）**：三个 roll target 追加进 manifest 冻结面（`targetJsonlSegmentBytes`/`targetBinSegmentBytes`/`targetRecordsPerSegment`，原子三键同进同出，`Number.isInteger ∧ ≥1 ∧ ≤2^53-1`）；改变任一 → `frozen-policy-mismatch` rotate。reader 接受双封闭形状（恰 14 键 legacy ∪ 17 键）；15/16 键 → `manifest-invalid`。**读能力（两形状）≠ 续写能力（仅 17 键）**：恰 14 键 legacy manifest → `legacy-manifest` rotate（ADR「旧 stream 无法安全续写…建立新 stream」的直接适用）。
2. **locator 解析三分支（D1/§3）**：显式 `resumeStreamId` > 可用 current.json > manifests 扫描；恢复仅限「不可用 locator + 恰一 manifest-bearing 候选」（定长 streamId 字典序确定，`readdir` 顺序不参与）；歧义（≥2 候选）→ disabled + `stream-init-failed{reason:'locator-ambiguous'}` + 零文件写入；显式目标证明失败不静默回退。禁 mtime/createdAt/目录序/文件大小/行数比较（皆 wall clock 猜测等价物）。
3. **rotate cause 封闭枚举（§4.4）**：`manifest-missing | manifest-invalid | legacy-manifest | frozen-policy-mismatch | stream-corrupt | stream-incompatible | repair-io-failure`——同一磁盘状态 + 同一配置 ⇒ 唯一 cause。
4. **可证明尾部判定式（D8/§5）**：C1 = SegMax JSONL 末字节 ≠ `0x0A` 的末块（终止符证明，与 parse 无关）；C2/C3 共用 `T = max(被引用帧 end)`（Refs 跨全部 segment 收集），尾走 `<25 字节 | 合法头+payload 越界` → C2、`全完整帧恰落 EOF` → C3；C2/C3 合并为单一截断单一事件（终局证据类优先）。仅作用于最大有文件 segment；非最大段同形状异常 = 中间损坏 → corrupt rotate。安全性不变量 S 结构性成立；决策层全有或全无（§5.3）。未被引用的中间字节（首引用帧之前的 orphan，D-A1 终态）不是损坏、不修复、reader-ok。
5. **双耗尽统一（D6/§7）**：segment `99999999` 滚动溢出与 sequence uint64 共用 `exhaustedLatch`，恰一次 `stream-exhausted`（既有形状零改动）+ 后续丢弃；终态 disabled、无自动解除、**不**新建 generation。reopen 经 `exhaustedAtOpen` 从磁盘重导出，构造期恰一次再上报。
6. **健康词表只增不改（D7/§10）**：+`stream-tail-repaired{repair: 3 值封闭枚举, truncatedBytes: 计数}`、+`stream-generation-rotated{cause: RotateCause}`；`stream-init-failed.reason` +`'locator-ambiguous'`/`'invalid-roll-targets'`。streamId/segment/offset 刻意不进事件（基数纪律保守执行）；事件总量有界（单次构造 ≤2 repair + 1 rotate/1 exhausted）。
7. **reader 两新码（§9.2/§9.3）**：`line-unterminated`（corrupt；任何 segment 的未终止末物理块——终止符证明取代 #152 宽容 parse，reader 与修复判定同一事实基础）与 `manifest-roll-target-violation`（corrupt；17 键形状下对每个闭段核查「jsonlBytes/binBytes/完整行数 ≥ 对应 target 至少一维成立」——ADR「任一target达到时…关闭当前group」的逆否；最大段不核查；14 键跳过）。两码均不入 INCOMPATIBLE_SET。
8. **滚动状态机（D4/§6）**：编号/字节/行数 reopen 时从磁盘派生、运行期内存推进、无新持久状态文件；`beforeCommit()` 在 `candidateSequence()` 之前判定（滚动不消耗/不分配 sequence，gate 丢弃不触发滚动）；offset 恒 fresh-stat（正确性关键）与 roll 计数器（软阈值）的非对称有意；注入接缝不滚动。
9. **构造期 write-slot 纪律（§12）**：reopen 全量交叉扫描（O(stream 总字节)）与修复截断均为同步 fs 操作，Host 必须在 NamespaceRuntime write sequencer slot 外构造 adapter（ADR-0012 amendment 规范性条款经前置门禁冲突点 #3 扩展覆盖构造期）；接线票 #149–#151/#155 验收核验。resume 不写 genesis、忽略 `config.genesisUpdateBytes`（文档化；Host 需要新基线走显式 rotate）；rotate 走既有 genesis 路径（§8.3）。
10. **无 ADR 修订（§16 DENY LIST）**：全部扩展落在 ADR-0012 非穷举清单空间内（manifest「至少保存」/冻结清单「包括」/reader 码词表/健康事件词表），无任何 mandated 行为被改写，`docs/adr/**` 零改动。
