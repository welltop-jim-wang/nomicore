# 相关决议 (Relevant Decisions) — 全链 SA 复用（round=2 修订轮）

> SA8 前置门禁产出（修订轮，审任务简报 `wiki/raw/task_diagnostic-log-stream-roll-repair-r2.md`，Issue #153 round=2）。
> 只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
> ADR 全集 = `docs/adr/0001–0009、0011、0012`（共 11 个文件；无 0010 文件）——与 round=1 前置门禁同一基准，round=1 全程零改动（`git diff --stat 8611e68..51b79b9 -- docs/adr CONTEXT.md` 为空，实证）。
> 本文聚焦本轮修复面；round=1 全量摘录见 `task_diagnostic-log-stream-roll-repair_relevant_decisions.md`（含「设计后复审追加」10 条），**全部继续有效**。

## 相关 ADR

### ADR-0012 §打开与尾部恢复（accepted）——本轮主规范

- 与本轮的关联点：无引用（Refs 空）时最大 segment bin 的全部完整帧是否属于第三类可修复尾部——owner 审查、总控核验与本轮修复方向的共同规范依据。
- 核心条款（原文摘录）：
  - 「打开既有 stream 时，writer交叉扫描JSONL与BIN。只自动修复可以证明的最终尾部：」（原文为三条列表项）「截断最终不完整 JSONL 行；」「截断最终不完整 frame；」「截断完整但未被任何完整 JSONL record引用的尾部 orphan frames。」
  - 「自动修复通过observer上报。以下情况不尝试修复中间数据：中间坏JSON行、VFSL失败、CRC错、sequence/type/length不符、JSONL引用不存在frame、offset越界/重叠、未知format/dialect/frame/payload。旧stream标为corrupt或incompatible并保持只读，创建新generation；不得从BIN猜回丢失的JSONL attempt语义。」
  - （被否方案）「**自动修复中间损坏或从BIN重建JSONL**：无法恢复attempt、stage、issues与input等语义，会制造虚假连续性。」
- 尾部性质判读（round=1 冲突点 #7 已钉死，本轮沿用）：「尾部 orphan frames」按**后缀性质**定义——未被引用且其后无被引用内容的连续后缀。Refs 为空时不存在任何被引用内容，`[0, |B|)` 整体即最大未引用后缀，其中全部完整帧均落入第三类授权修复集；设计 §5.2/§5.4 的「Refs 为空 → T=0」是该条文的直接形式化。

### ADR-0012 §Writer、append 与背压（accepted，含 amendment）——链衔接与首引用豁免

- 与本轮的关联点：修复后续写 sidecar 的 frameOffset=0 起点（反馈建议 ④ 的测试锚）与「首被引用帧跳过边界检查」的现行 reader 语义（总控机制勘误的规范背景）。
- 核心条款（原文摘录）：
  - （崩溃窗口语义）「BIN-first 避免完整 JSONL 引用尚不存在的 frame，但崩溃可能留下完整 orphan frame、不完整尾 frame 或不完整 JSONL 尾行；这些均符合 best-effort 语义。」
  - （amendment）「每个 `emit` 在调用栈内执行至多一条 final JSONL record 的有界同步 append；若其携带 sidecar，则额外执行至多一帧 BIN append，顺序为 BIN-first。」
- 注：offset/segment/frame 边界与 stream 连续性归 storage validator（§VFSL record schema：「storage validator 另行负责：……offset、segment、frame 边界与 stream 连续性。」）；「首个被引用帧 expectedOffset=null 跳过边界检查」（`storage-gate.ts:88` 现行实现）是该项下的实现语义——无前序被引用帧时不存在「链末端」可偏离。

### ADR-0012 §Stream 与 generation（accepted）——修复属 stream 内行为，不触发换代

- 核心条款（原文摘录）：
  - 「正常重启继续健康 stream；首次启用、旧 stream 无法安全续写、冻结配置改变、显式 rotate/reset 时建立新 stream。」
- 与本轮的关联点：Refs 空的可证明尾部（如唯一一次 sidecar 尝试 BIN-first 后崩溃、JSONL 未写）是**健康 stream 的尾部残留**，修复后续写同一 streamId（无中间损坏/不兼容/冻结变更/无法安全续写任一触发）——不属于 rotate 情形。本轮修复不改变任何 generation 触发。

### ADR-0012 §Segment rolling 与耗尽 + §VFSL record schema（accepted）——滚动种子与事件纪律背景

- 核心条款（原文摘录）：
  - 「任一target达到时，在写入下一条record前关闭当前group并开启新group；单条合法record可让新group超过target，但不得超过record/payload硬上限。」
  - （observer 数据纪律）「append 前 VFSL validation failure 是日志 writer bug：丢弃 record、增加低基数 metric并向独立结构化 observer 上报，不改变业务结果。observer只包含稳定 code、schema id/fingerprint、operation、source module、VFSL issue codes/paths与 projected record byte size；不包含原 record、input、Base64、update bytes、底层 message、Error/cause或stack。同一 JSONL中不写递归 health record。」
- 与本轮的关联点：T=0 全截后修复事件 `truncatedBytes = |B| > 0`（结构性成立）；round-1 偏差路径发出的 `truncatedBytes:0` 零字节「修复」事件属不诚实观测，与 observer 上报纪律相逆。

### ADR-0011 Best-effort namespace 诊断变更日志（accepted）——观测诚实与业务隔离

- 核心条款（原文摘录）：
  - 「日志 adapter 必须以 non-throwing、有界、非阻塞的 emitter seam 接收记录。……adapter 同步 throw 或异步失败均被隔离，并只进入独立的日志健康 metrics/observer；」
  - 「实现应尽力上报 dropped count、sink failure 和 queue health，但这些健康信号本身也不构成日志完整性证明。」
- 与本轮的关联点：健康事件是观测信号，不得报告未发生的修复；本轮「事件只在真实截断字节时发出」恢复诚实性。

## round=1 门禁钉死项（继续有效，本轮修复的对齐目标）

- **前置门禁冲突点 #7 / 设计后复审 ⑥**（`task_diagnostic-log-stream-roll-repair_conflict_report.md` / `…_design_conflict_report.md`）：三类可修复尾部按后缀性质严格判定；C3 判定式「Refs 取自全部完整 JSONL 行（跨所有 segment）对 SegMax 的引用，`[T,|B|)` 全为完整帧且恰落 EOF 的连续未引用后缀」；设计 §5.2「C2/C3：`T = max{ end | (off,end) ∈ Refs }`（**Refs 为空 → T=0**）」、§5.4 首行「`T = max(end for (off,end) in Refs) if Refs 非空 else 0`」——round=2 修复方向的规范源。
- **安全性不变量 S**（设计 §5.2）：被丢弃字节区间不得与任何完整 JSONL 行引用的帧区间相交、不得移除任何完整 JSONL 行——Refs 空时结构性平凡成立（无引用可交）。
- **D-A1 特例边界**（设计 §4.3 + 设计后复审 ⑥）：**首被引用帧之前**的 orphan（Refs **非空**时的内部残渣）不修复、reader-ok——与 Refs **空**时 `[0,|B|)` 整体为尾部后缀（全截）是两个不相交的案例；round-1 实现将前者容忍度错误泛化到后者，即本轮偏差。
- **健康词表只增不改**（设计 §10）：`stream-tail-repaired{repair, truncatedBytes}` 形状不变——本轮只修触发条件（真实截断才发），零词表变更。

## CONTEXT.md 相关术语

- **诊断日志 stream generation**（_Avoid_: 跨 generation 隐式连续日志）——修复在 stream 内完成，不换代、不拼接。
- **storage projection**：「日志 adapter 独占的物理表示决策——先决定 inline/sidecar 并构造最终 record（segment/frameOffset/payloadLength/CRC32C/Base64），再运行 VFSL 校验」——修复截断与续写 frameOffset=0 均属 adapter 物理表示领地。
- **genesis baseline record**：本轮不涉新 generation，无 genesis 面。
