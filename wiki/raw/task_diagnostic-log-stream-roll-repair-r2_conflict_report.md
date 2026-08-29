# 冲突门禁报告 — round=2 修订轮前置门禁

> SA8 前置门禁（修订轮）。被审对象：任务简报 `wiki/raw/task_diagnostic-log-stream-roll-repair-r2.md`（Issue #153 round=2，发布后修订：owner 质量审查 1 项 High）。
> 冲突基准：`docs/adr/` 全集（11 文件）+ `CONTEXT.md`——与 round=1 同一基准；round=1 发布全程零改动（`git diff --stat 8611e68..51b79b9 -- docs/adr CONTEXT.md` 为空，本轮实证）。
> 总控指定三项裁决：①修复方向 vs ADR-0012 一致性；②「设计零改动、实现向设计收敛」是否无需 override；③round-1 SA4 偏差裁定被推翻是否有 ADR 面遗留张力。

## Verdict

`clear`

> 修复方向（删除 `walkCompletePrefixEnd` 例外、Refs 空 → T=0 全截、事件仅真实截断时发出）是 ADR-0012 §打开与尾部恢复第三类授权修复集的直接实施，与 round=1 已裁决 clear 的设计 §5.2/§5.4 字面一致；修订性质为实现向设计收敛，零设计决策变更、零 ADR 条款触碰，无需 override；round-1 偏差链（SA3 备案 → SA4 裁定 → owner 推翻）不留 ADR 面张力。无 hard-violation / override-declared / evolution。

## 证据独立复核（总控核验之外，本门禁自查）

| # | 简报证据 | 复核结果 |
|---|---|---|
| 1 | 设计 §5.2「Refs 为空 → T=0」、§5.4 首行同义 | ✅ 设计文档 205/215 行原文（round=1 设计后复审 ⑥ 已逐字核验） |
| 2 | 实现 `reader.ts:1086-1102` 与设计字面相反 | ✅ 实证：`if (refsToSegMax.length === 0) { t = walkCompletePrefixEnd(bin) }` + 注释「§13.11 契约面：无引用 → 截断点取从 0 起的完整帧前缀边界（未引用完整帧保留）」 |
| 3 | 前缀走到底时 `truncatedBytes:0` 零字节修复事件 | ✅ 结构实证：refs 空、全完整帧时 `t` 推至 `\|B\|`，外层 `bin.byteLength > t` 已判真后仍 push `bin-orphan-frames{truncatedBytes:0}`（对全文件 truncate 到自身长度的无操作） |
| 4 | 测试锚 §13.11 固化偏差 | ✅ 实证（`file-adapter-reopen-roll-repair.test.ts` §13.11 用例）：fixture 为 inline 完整行 + orphan frame1 + 撕裂尾（refs 空），断言修复后 bin 保留 `FRAME_BYTES`（完整 orphan 帧未截）——锚编码了偏差语义，须重写 |
| 5 | 机制勘误：首被引用帧跳过边界检查 | ✅ `storage-gate.ts:88` `if (expectedOffset !== null && offset !== expectedOffset) return frame-boundary-invalid`——expectedOffset=null 豁免实证；refs 空时修复后续写的首条 sidecar 帧即首被引用帧，**不**触发 frame-boundary-invalid |
| 6 | AGENTS.md 同向 | ✅ `AGENTS.md`：「尾部修复仅作用于最大有文件 segment 的三类可证明残留（不完整尾行 / 不完整尾 frame / 未引用尾 orphan frames）」——与 T=0 全截同向，实现注释与之相悖 |

## 指定裁决 ①：修复方向 vs ADR-0012

**裁决：no-conflict（修复方向是 ADR 授权修复集的直接实施）。**

- **§打开与尾部恢复**：「截断完整但未被任何完整 JSONL record引用的尾部 orphan frames」——尾部性质按后缀定义（round=1 冲突点 #7 钉死）：Refs 为空时不存在任何被引用内容，`[0, |B|)` 整体即最大未引用后缀，其中全部完整帧落入第三类授权集。T=0 全截恰是该条文的直接形式化；round-1 实现保留完整 orphan 前缀＝对可证明尾部残留不修复（AC3 未满足），且其零字节「修复」事件报告了未发生的修复，与「自动修复通过observer上报」的诚实观测相逆。修复方向两处（全截 + 真实截断才发事件）均向 ADR 收敛。
- **上限纪律不越界**：「只自动修复可以证明的最终尾部」的封闭上界不被突破——T=0 全截只删未引用字节（不变量 S 在 Refs 空时结构性平凡成立：无引用可交、无完整行被移除，C1 另案处理）；无从 BIN 重建 JSONL 语义的机制（被否方案维持）；中间损坏零修复纪律不受影响（全有或全无不变）。
- **§Segment rolling / 链衔接**：T=0 后修复态种子 `segBinBytes=0`（设计 §6.3 修复后字节），续写首条 sidecar 帧 fresh-stat 落 offset 0；「首个被引用帧 expectedOffset=null 跳过边界检查」下 strict reader 判 ok——反馈建议 ④ 的 `frameOffset==="0"` 锚与 per-segment 链模型自洽。滚动判定（任一 target 达到即滚）不受修复量影响。
- **§Stream 与 generation**：Refs 空的可证明尾部（典型：唯一 sidecar 尝试 BIN-first 后崩溃）属健康 stream 残留，修复后**同一 streamId 续写**——无 corrupt/incompatible/冻结变更/无法安全续写任一换代触发；修复方向不改变任何 generation 生命周期。

## 指定裁决 ②：修订性质无需 override

**裁决：no-conflict（无需 override / 无 evolution / 无 ADR 修订）。**

- 被推翻的是**实现相对设计的偏差**，不是任何 ADR 条款或设计决策：设计 §5.2/§5.4 的 T=0 语义正是 round=1 设计后复审裁决 `clear` 的对象（⑥ 逐字核验过该判定式）；本轮把实现拉回已裁决语义，属「实现向设计收敛」，不构成对任何决策的推翻、修订或演进——四类裁决中无需 override-declared，亦无 evolution（对象无意修订任何决策）。
- `docs/adr/**` 与 `CONTEXT.md` 零触碰（round=1 范围实证 + 本轮简报 DENY 面未列任何 ADR 改动）；设计文档零改动（简报明确排除）；#148 冻结面零触碰（事件形状不变，只修触发条件）。
- 版本 bump 0.1.3 → 0.1.4（硬门禁 9）与测试基线（140 文件 / 1784 测试零回退）为流程门槛，无 ADR 面。

## 指定裁决 ③：SA4 偏差裁定被推翻的 ADR 面遗留张力

**裁决：无 ADR 面遗留张力（残留面全部为 wiki/代码/测试工件，且均已入本轮范围）。**

- **ADR/CONTEXT 文本**：round=1 发布全程零改动（实证），owner 推翻的是流程内裁定，不改任何规范文本——无规范层张力可遗。
- **SA8 既往裁决**：round-1 前置门禁与设计后复审均以**设计文本**为基准（T=0 语义被 ⑥ 核验为 ADR 对应），从未背书 `walkCompletePrefixEnd`——owner 推翻 SA4 与 SA8 两轮裁决零冲突，反而确认其有效性。
- **偏差同源工件盘点**（全部在简报修订范围 1–3 内，无 ADR 面）：`reader.ts` 偏差分支与死代码（范围 1）；测试锚 §13.11 期望写错（范围 2，SA6 锚纠错——锚本身编码偏差，红灯重写为 T=0 语义 + 反馈建议 ③④：修复后 BIN 实际长度 0、续写 sidecar 断言 `frameOffset==="0"` 且 strict ok）；代码注释「§13.11 契约面」段及 README/AGENTS 同源表述核查（范围 3；AGENTS.md 现文已同向 T=0，实证无需改，仅需核查无残留反句）。
- **勘误的规范定位**（登记防伪需求）：总控机制勘误成立——refs 空时后续首条 sidecar 帧为首被引用帧、豁免边界检查，**不**产生 frame-boundary-invalid 自伤。设计 §5.4 的链安全论证（「若 [T,|B|) 残留任意字节…未来读取判 frame-boundary-invalid」）在 Refs **非空**分支成立、在 Refs **空**分支过覆盖（该分支无「链末端」可偏离）。此勘误**不削弱** T=0 规则的 ADR 依据（第三类条文对应 + AC3，与链安全机制无关），故「设计文档零改动」正确；但 SA6 锚纠错时**不得**补「防 frame-boundary-invalid」类断言（简报已明示，本门禁确认）。

## 冲突点

**无阻塞冲突**（hard-violation ×0 / override-declared ×0 / evolution ×0）。登记观察 2 条：

| # | 观察 | 定性 |
|---|---|---|
| O1 | 设计 §5.4 链安全论证在 Refs 空分支过覆盖（首引用豁免下无自伤），T=0 的规范依据独立于该机制（ADR 第三类条文 + AC3）——本轮不改设计文档正确；后续票若同步设计文字，仅修论证句不修判定式 | 非冲突；备案供后续切片 |
| O2 | round-1 LOW-1 曾将零字节修复事件备案为观测噪音——owner 审查将其升格为 High 的组成部分（不诚实观测）。round-2 修复后 `truncatedBytes > 0` 结构性成立（外层 `bin.byteLength > t` 已保证），该备案随之作废 | 非冲突；流程档案层面，无需动作 |

## 结论

**Verdict `clear`，放行 SA6 红灯锚纠错 → SA3 修复转绿。**

1. 修复方向三要素（删例外 / T=0 全截 / 事件仅真实截断时发出）逐项与 ADR-0012 §打开与尾部恢复、§Segment rolling、§Stream 与 generation 一致，且是 round=1 已裁决 clear 设计的字面执行；
2. 修订性质＝实现向设计收敛：零设计变更、零 ADR 触碰、零词表演进，无需 override；
3. SA4 裁定被推翻不遗留 ADR 面张力；全部偏差同源工件（代码/注释/测试锚/文档表述）均在简报修订范围 1–3 内闭合；
4. SA6 锚纠错红线：按反馈建议 ③④ 落地（修复后 BIN 长度 0、续写 `frameOffset==="0"` + strict ok），不得引入「防 frame-boundary-invalid」伪需求断言（机制勘误备案）。
