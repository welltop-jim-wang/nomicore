# 冲突门禁报告

## Verdict

`conflict`

> 阻塞原因仅为反馈 3 所选路径构成对 ADR-0012 的实质演进，尚未以正式 ADR 修订/取代文本落地。反馈 1 和反馈 2 本身均无 hard-violation；在完成 ADR-0012 修订后，仍须由设计保持下述无冲突条件。

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0001 | VFSL 文本是 schema 的唯一真相源 | accepted | 否（仅 schema 边界） | no-conflict |
| ADR-0002 | nomicore 是重写，authority 出范围 | accepted | 否 | no-conflict |
| ADR-0003 | 求值器与派生 schema | accepted | 否 | no-conflict |
| ADR-0004 | vfsl-protocol 类型投影 | accepted | 否 | no-conflict |
| ADR-0005 | 投影生成管线 | accepted | 否 | no-conflict |
| ADR-0006 | Cordis 持久化插件 | accepted | 间接（日志非 Persistence） | no-conflict |
| ADR-0007 | 逻辑验证与 Runtime Bridge | accepted；open/read 部分被 0008 取代 | 否 | no-conflict |
| ADR-0008 | NamespaceRuntime 读写能力与单序列器 | accepted | 是（写槽隔离） | no-conflict，反馈 3 的接线纪律须保持 |
| ADR-0009 | NamespaceRegistry/租约/Host 生命周期 | accepted | 间接（shutdown） | no-conflict |
| ADR-0011 | Best-effort namespace 诊断变更日志 | accepted | 是（emitter、连续/replay） | 反馈 1/2 no-conflict；反馈 3 与其 non-blocking/write-slot 条款存在待 ADR-0012 修订澄清的张力 |
| ADR-0012 | VFSL JSONL 与 framed sidecar 日志格式 | accepted | 是（本票主规范） | 反馈 1/2 no-conflict；反馈 3 为 evolution，当前未完成正式修订则门禁 conflict |

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| 1 | evolution | ADR-0012：「日志 adapter 提供有界、non-blocking emitter，内部每个 stream 同时最多一个逻辑 writer queue。」；「默认周期 batch flush」；ADR-0011：「adapter 慢、失败或队列满都不得延长 write slot。」 | 简报 §3 选择修订 ADR-0012，把「emit 调用栈内有界同步 append（无队列/无 batch/无 fsync/无常驻 fd）」写成 ADR 级决策，且实现保持同步。 | **evolution**（当前导致 Verdict conflict） | 这是对 ADR-0012 writer queue/周期 batch flush 现行决策的实质改写，而非仅实现解释。简报明确意图修订 ADR-0012，符合 evolution；但修订尚未落入 ADR 正文，当前任务对象不能同时宣称遵循既有文本并实施相反 writer 形态。须先在本轮以 ADR-0012 的正式修订节明确取代范围、取舍、同步 append 的有界定义、以及终态 queue/batch 演进路径，才可清除该门禁项。 |

## 三项指定裁决

### a) 反馈 2：sequence 连续性

**裁决：no-conflict。**

- ADR-0012 明示 storage validator 负责「stream 连续性」，strict reader 又必须执行 storage/frame 交叉校验。因此 strict reader 增加跨 record 的连续性校验，是直接落实而不是与 ADR-0011/0012 冲突。
- ADR-0011 的「不承诺无 gap」和 ADR-0012 的「不证明业务尝试无缺」限定的是日志对**业务尝试完整性**、exactly-once 与生产事实的担保；它们不许可把同一既存 stream 中已物理 append 的 record 删除后仍伪称该 stream 连续。reader 检出 `[1,3]` 的中间物理缺失，仍不得把日志升级为可靠恢复日志，故不冲突。
- 现行 ADR-0012 又规定「writer 准备 append 时才分配 stream sequence」。若 round=1 的 gate/genesis 跳过在该时点之后消耗 sequence 而不 append record，则它会制造健康 stream 的合法磁盘 gap，和本轮「健康 stream 不误判、物理删除必发现」不能同时成立。
- 为满足目标，sequence 必须只在 record 已通过 gate/准备实际 append 的提交点分配，或以其他等效机制保证**任何已分配的 storage sequence 都对应一个实际 JSONL record**；不应把被拒 gate 或跳过 genesis 的编号写入 stream 序列。这个把分配时点收紧到实际 append 提交点的解释在 ADR-0012「准备 append 时才分配」的文本空间内，且更直接兑现其「stream 连续性」职责，故为 **no-conflict 的允许解释**，不需要修改 ADR-0011/0012。
- 保留边界：sequence 连续只能证明已保存物理 record 的连续序列，不能证明每个业务 attempt 都曾被日志接收/保存；strict reader/replay 的状态与文案必须保持此 best-effort 限定。

### b) 反馈 3：ADR 修订路径

**裁决：evolution，尚不充分；不必连带修订 ADR-0011 正文。**

- 简报指定「修订 ADR-0012，不动 ADR-0011 正文」是合法的**演进路径**，但不是在修订落地前即可自动放行的 no-conflict。它必须在 ADR-0012 中正式记录取代的 writer/queue/batch 条款与后果，避免两种互相冲突的契约并存。
- 不必修改 ADR-0011 正文：0011 保留的是 emitter seam 与业务隔离的上层契约。只要 ADR-0012 修订明确同步 append 的有界工作量、emit 仍 void/non-throwing/不返回 durability promise、并以明确接线纪律保证 `emit` 不在 namespace write slot 内，0011 的规范性要求可继续有效。
- 但 ADR-0012 修订须显性处理其与 ADR-0011 的适用关系：同步 I/O 的「有界」不得被误读为「慢文件系统绝不阻塞」；它只能是 adapter 内部工作的范围界限。若 emit 仍处于 write slot，慢 I/O 仍会违反 ADR-0011「不得延长 write slot」。因此 ADR-0012 必须将接线前提写为可核查约束，而不能只作为非规范性说明。
- 修订后未声明冲突的残留风险：若 ADR-0012 仍保留「内部每 stream 一个逻辑 writer queue」「默认周期 batch flush」为当前首切片必须行为，或仍未规定写槽外接线，文本仍自相矛盾。本报告不接受以「后续终态」替代明确取代关系。

### c) 反馈 1：manifest format policy 与 reader 码表

**裁决：policy 执行 no-conflict；是否扩 reader 23 码词表不由 ADR 强制。**

- 严格 reader 在 per-record/per-line 层验证 `committedUpdateCapture`、`inputCapturePolicy`、`inlineUpdateMaxBytes`（双向表示规则）与 `jsonlLineLimitBytes`，是 ADR-0012 对 manifest 冻结项、storage validator 与 strict reader 的直接落实，不冲突。
- 这些检查是 storage/format 解释规则，而非新 record schema 词汇；ADR-0012 明定 VFSL 不负责 JSONL 文件/跨记录等存储不变量，故不需要为实现这些检查而修改 VFSL record schema。
- round=1 §11-G9 的「零扩码」是先前设计/总控备案，不是 ADR 或 CONTEXT.md 决议，不能构成 SA8 自动阻塞基准。ADR-0011/0012 也没有穷举 strict-reader issue code 词表；因此**扩 reader 23 码词表与 ADR 无直接冲突**。
- 是否用既有码、扩码或采用状态映射属于本票设计/总控裁决面；若扩的是公开、冻结 schema 词表或 `update-omitted` reason，则须另按 ADR-0012 的 schema-version/new-generation 或 CONTEXT 的受控词表演进纪律审查。仅 reader/file-adapter 域的诊断码，且不改变冻结 record schema 与 emission 公共词表时，本门禁判定 no-conflict。

## 结论

当前应停止后续链路，直到任务中的 ADR-0012 修订文本真正落地并解除冲突点 #1。解除条件：

1. ADR-0012 以明确修订/取代关系取代首切片现行 queue/batch 要求，记录同步 append 的范围与取舍；
2. 修订明确保持 ADR-0011 的 void/non-throwing/no-durability-promise 和「不得延长 write slot」；将 emit 调用点置于 namespace write slot 外作为规范性接线条件；
3. 修订保留或明确未来有界 writer queue + 周期 batch flush 的演进路径，而不让其与首切片当前行为并列为同时强制要求；
4. SA1 设计明确 sequence 只在实际 append 提交点分配（或等效保证已分配序列无合法物理 gap），并保留 best-effort 不证明业务尝试无缺的 reader/replay 表述；
5. policy 违规的 reader 码表/状态映射留待 SA1/SA2/总控裁决，但不得无声明地改变冻结 record schema 或 emission 受控词表。
