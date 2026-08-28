# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出（第 0 阶段，审任务简报 `wiki/raw/task_diagnostic-log-file-adapter-r2.md`，Issue #152 round=2）。
> 只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
> ADR 全集 = `docs/adr/0001–0009、0011、0012`（共 11 个文件；无 0010 文件）。
> 本文增量引用 round=1 的 `task_diagnostic-log-file-adapter_relevant_decisions.md`；以下必须覆盖 R2 反馈 1/2/3 的新增裁决面。

## 相关 ADR

### ADR-0012 VFSL 校验的 JSONL 与 framed sidecar 诊断日志格式（accepted）——本轮主规范

- 与本任务的关联点：R2 的 manifest policy 严格解释、stream sequence 连续性，以及 File adapter 同步 append 的 ADR 修订，均直接涉及本 ADR。
- 核心条款（原文摘录）：
  - 「`manifest.json` 创建后不可变，至少保存：……committed update capture、input capture policy；inline threshold 与 JSONL line 上限。」
  - 「writer 准备 append 时才分配 stream sequence。……sequence 不回绕，仅代表该 stream 的 append 顺序，不证明业务尝试无缺，也不是跨副本全局顺序。」
  - 「VFSL 只定义一条最终 JSONL storage record，不定义 JSONL 文件、binary frame、segment 连续性或 retention。」
  - 「storage validator 另行负责：……offset、segment、frame 边界与 stream 连续性。」
  - 「默认 `inlineUpdateMaxBytes` 为 4 KiB，可配置；该阈值只影响物理表示：update 大小小于等于阈值时，……内联；大于阈值时，append 到当前 segment 共享 `.bin`。」
  - 「最终 JSONL line 默认硬上限 1 MiB，可配置。输入导致超限时先降级为 digest；去掉输入后 record 仍超限则丢弃整条 record并通过健康面上报，不影响业务。」
  - 「影响记录解释的配置在stream创建时冻结；包括record/schema/frame版本、committed update capture、input capture policy、inline threshold与line上限。冻结项改变时新建stream generation。」
  - 「默认strict reader对每条record执行JSON parse、VFSL validation及storage/frame交叉校验。显式metadata-only或unsafe-fast模式可用于检查/导出，但不得声称可重放；replay强制strict。」
  - 「日志 adapter 提供有界、non-blocking emitter，内部每个 stream 同时最多一个逻辑 writer queue。」
  - 「默认周期 batch flush，不逐条 fsync；真正 fsync 可配置且默认关闭。write/flush完成不构成掉电持久性承诺。」
  - 「每条fsync或业务await日志append」为被否方案。

### ADR-0011 Best-effort namespace 诊断变更日志（accepted）——emitter / replay 产品契约

- 与本任务的关联点：R2 对 sequence 连续、reader/replay 诚实状态以及同步 emit 的限制，须同时服从此 ADR。
- 核心条款（原文摘录）：
  - 「日志允许缺失、乱失尾部或因进程崩溃只留下尝试开始而没有结局；系统不承诺 exactly-once、at-least-once、无 gap、跨副本全局顺序或物理持久性。」
  - 「日志 adapter 必须以 non-throwing、有界、非阻塞的 emitter seam 接收记录。」
  - 「每个 emitter 可分配本地单调 `emitterSequence`，仅表示该 emitter 的记录顺序，不表示集群全局事务顺序。」
  - 「只有同时满足以下条件时，工具才可声明一次诊断性重放成功：……所选 stream 的 committed records 按 emitter sequence 连续；……未观察到已知 gap、截断、损坏或不兼容 record version。」
  - 「`emit` 的 interface 语义是立即接收一份由调用方持有权已转移或已复制的 detached record；不得阻塞、throw、返回 durability promise，亦不得保留调用方可变引用。日志模块可在其实现内部使用有界队列、batch、sampling、文件或远端 sink。」
  - 「adapter 慢、失败或队列满都不得延长 write slot 或阻塞 close/shutdown。」

### ADR-0008 NamespaceRuntime 读写能力与单序列器（accepted）——业务写槽隔离

- 与本任务的关联点：File adapter 的工作不得破坏 namespace write sequencer 槽序。
- 核心条款（原文摘录）：
  - 「同一 namespace 内所有受控 Y.Doc 写共享唯一严格 FIFO write sequencer。」
  - 「每个真正写任务的槽依次执行：……一次 Yjs transaction、`await notifyDirty()`，然后才释放给下一任务。」

### ADR-0001 / 0003 / 0004 / 0005 / 0006 / 0007 / 0009（accepted）——盘点结论

- 与本轮三个反馈无直接相反或附加条款；仍受其既有边界约束。
- ADR-0007 的 Runtime/open/read 条款中被 ADR-0008 明示取代的范围不构成约束。

## CONTEXT.md 相关术语与惯例

- **namespace 诊断变更日志**：「从 namespace 创建开始尽力记录所有变更尝试及其结构化结局的可选 observability 流；连续的 committed Yjs updates 可用于诊断性重放，但日志不参与业务提交、不承诺完整性或恢复能力。」
- **诊断日志 stream generation**：「一个 namespace 的一代独立诊断日志，包含不可变 manifest、VFSL 校验的分段 JSONL records 与可选 framed binary sidecar；冻结格式或策略改变、旧 stream 损坏或无法安全续写时建立新 generation，各 generation 不自动拼接重放。」
- **语义 emission**：「emit 同步、不 throw、不阻塞；快照与 updateBytes 所有权移交后不得再变异。update-omitted 稳定 reason 受控词表（v1）：`payload-too-large` / `update-capture-disabled` / `empty-update`——新增 reason 属词表演进，须过设计评审。」
- **storage projection**：「日志 adapter 独占的物理表示决策——先决定 inline/sidecar 并构造最终 record（segment/frameOffset/payloadLength/CRC32C/Base64），再运行 VFSL 校验；emitter 只做语义投影，不构造物理字段。」
- **genesis baseline record**：「新 stream 的 genesis 基线——当时完整 Y.Doc 的 update，不是变更尝试……由 #152 adapter 内部构造。」
