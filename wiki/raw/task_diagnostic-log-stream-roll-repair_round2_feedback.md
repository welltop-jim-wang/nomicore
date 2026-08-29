# Round 2 修订任务简报 — PR #166 review 反馈（High 阻断）

> 来源：issue #153 评论（PR #166 修订轮 review 反馈），round=2。本文是 round 2 流水线的
> 权威任务输入，效力等同任务简报附录。round-1 权威契约（设计定稿 §0–§18、§13 锚点全表、
> ADR 约束）继续有效；本反馈**推翻** round-1 SA3 备案偏差 + SA4 裁定（sa4_review.md §偏差
> 裁定：无引用 SegMax bin 截断点=完整帧前缀边界）——owner 裁决以设计 §5.4 字面为准。

## 反馈原文（逐字）

PR #166 当前 CI/typecheck/tests 通过，但存在 High 阻断问题：无引用时完整 orphan BIN 尾帧未被清除。
位置：`packages/namespace-diagnostic-log/src/reader.ts:785-803` 与
`packages/namespace-diagnostic-log/src/reader.ts:1086-1102`。设计要求 `Refs` 为空时 `T = 0`，
C2/C3 应将最大 segment 的完整未引用尾帧全部截断；当前实现调用 `walkCompletePrefixEnd()` 把 `T`
推进到完整 orphan frame 前缀末端，保留这些帧，甚至可能发出 `truncatedBytes: 0` 事件。后果：后续
sidecar frame 会追加到 orphan 数据之后，而引用链期望从上一被引用 frame 末端（此场景 offset 0）
开始，可能触发 `frame-boundary-invalid`，导致恢复的 stream 再次损坏；issue #153 AC3 未满足，
也可能破坏 AC1 安全续写。现有测试
`packages/namespace-diagnostic-log/test/file-adapter-reopen-roll-repair.test.ts:410-451`
断言保留完整 orphan frame，固化了错误语义。

建议修复：
1. 删除无引用时调用 `walkCompletePrefixEnd()` 的例外，保持 `T = 0`；
2. 将完整 orphan 后缀全部截断；
3. 测试断言修复后 BIN 实际长度为 0；
4. 修复后再写一条 sidecar record，断言 `frameOffset = "0"` 且 strict reader 成功；
5. 后续可考虑抽取 `readStreamStrict()` 与 `analyzeStreamForResume()` 共享的 stream-analysis
   原语，但本轮以修复 High 阻断问题与回归测试为主。

## 总控勘察结论（2026-08-29，round 2 开轮）

- **反馈属实**（总控只读勘察，不改码）：
  - `reader.ts:790-804` `walkCompletePrefixEnd()` 定义；`reader.ts:1086-1104`
    `analyzeStreamForResume` C2/C3 段内 `if (refsToSegMax.length === 0) t = walkCompletePrefixEnd(bin)`
    例外分支——无引用时 T 被推进到完整 orphan 前缀末端，保留完整 orphan 帧；全完整帧场景发
    `truncatedBytes: 0` 的 `bin-orphan-frames` 事件（round-1 REPORT 遗留风险 #2 同源）。
  - 测试 §13.11（file-adapter-reopen-roll-repair.test.ts:431-452，反馈所指 410-451 区段内）：
    fixture 为 inline-only JSONL（`validAttemptRecord`，无 sidecar 引用）+ bin=[完整帧1][7B 撕裂]，
    line 450 断言修复后 `binPath.byteLength === FRAME_BYTES`（4122）——即保留完整 orphan 帧，
    固化错误语义。
  - 设计定稿 §5.4（L224）明文：「C2/C3：`T = max{ end | (off,end) ∈ Refs }`（Refs 为空 → T=0）」；
    §5.4 链安全论证（L251）：尾部必须清零才能续写，否则新帧 offset ≠ 链末端 →
    `frame-boundary-invalid` 自伤。**修复方向 = 向已批准设计字面回归**，非新设计决策。
- **依赖面摸排**（修复后预期保持绿的断言）：
  - §13.9/§13.10/窗口4 均有 sidecar 引用（refs 非空，`t = max ref end` 路径），不受影响；
  - §13.29 窗口1/窗口3（jsonl ENOENT/撕裂 → refs 空 + 完整 orphan 帧）：只断言
    `bin-orphan-frames` 事件恰一次 + 健康续写 + reader ok，**不断言保留字节**——修复后事件照发
    （`truncatedBytes` 变为真实截断字节数），断言保持绿；
  - §13.32b（bin chmod 000 无引用）：bin 0 字节不进修复分支，不受影响；
  - `walkCompletePrefixEnd` 全仓仅 reader.ts 定义 + 单一调用点，删除例外后函数成死码，
    须一并删除（round-1 终审 H3 死代码判例同标准）；
  - SA7 repair-io 测试文件（file-adapter-sa7-repair-io.test.ts）grep 无对该语义的断言依赖。

## Round 2 工作流（总控裁剪裁决）

类型自判：**Bug 修复**（修订轮；review 反馈 = 已精确定位根因的缺陷报告 + owner 侧设计裁决）。

- **跳过 SA8 冲突门禁**：round-1 已过前置 + 设计后双门禁（clear）；本轮无新 ADR 接触面——
  删除实现侧例外分支、向 round-1 已批准设计 §5.4 字面回归，不引入任何新架构决策。
- **跳过 SA5**：根因/位置/后果已由 review 反馈精确给出（上文逐字）；复现由 SA6 红灯承担
  （硬门禁 2：新断言在当前实现下必须红）。
- **跳过 SA1/SA2**：修复方案由反馈建议 1-4 直接规定，且与设计定稿 §5.4/§13.9-12 锚族一致；
  推翻 round-1 备案偏差的裁决由 owner 反馈作出（权威高于 SA4 备案裁定），无需重新设计。
  反馈建议 5（抽取共享 stream-analysis 原语）为后续可选重构，**本轮不做**（范围纪律）。
- **流水线**：SA6（红灯重锚 §13.11 + 反馈建议 4 新断言）→ 总控红灯亲验 → SA3（删例外 +
  删死码 + bump patch）→ 总控绿灯亲验 → SA4（静态复审）→ SA7（动态复验）→ AC 门禁 round-2
  更新（AC3 重判 + AC1 复核）→ 双轴终审（修复-重复规则）→ 收尾。

## Round 2 验收契约（SA6 锚定输入）

1. §13.11 重写：C1+C2 并存（无引用完整 orphan 帧 + 撕裂尾块）→ 两事件两截断；
   **bin 修复后实际长度 = 0**（反馈建议 3）；bin 事件 `truncatedBytes = FRAME_BYTES + 7`；
   jsonl 截到最后 `0x0A` 后（断言保持）。
2. 反馈建议 4 新锚：§13.11 修复后的 stream 上再 emit 一条 sidecar record（updateBytes >
   inline 阈值）→ 新 record 的 `update.frameOffset === "0"` 且
   `readStreamStrict(...).status === 'ok'`（链从 offset 0 重新衔接——AC3 + AC1 安全续写实证）。
3. 回归：§13.9（有引用 C3，截断点=max ref end）、§13.29 窗口1/3（事件恰一次 +
   续写 + reader ok）保持绿；全包测试绿。
4. 全 orphan（refs 空、bin 全完整帧）场景不再出现 `truncatedBytes: 0` 事件
   （窗口1 同形覆盖；事件照常上报但截断字节数 = 真实移除量）。
