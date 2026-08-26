# Dispatch Log — namespace-registry idle/plugin/shutdown Round 2（issue #112 修订轮）

任务类型自判：Bug 修复（spec 审查裁定的 3 项高风险缺陷；分析与位置已由 spec 审查给定，SA5 复现职责并入 SA6 红灯锚定）。工作流：SA8 前置门禁 → SA6 红灯 → SA1 设计 → SA8 设计复审 → SA2 评审 → SA3 实现 → SA4 静态 → SA7 动态 → AC 门禁 → 双轴代码终审 → 收尾。

| # | 派发时间 | SA | 阶段 | 完成时间 | 决策逻辑 |
|---|---------|-----|------|---------|---------|
| 1 | 22:11 | SA8 | Phase 0 前置门禁 | 22:19 | 修订轮首个业务 SA 前先过冲突门禁：3 项修复（尤其问题 3 的次序保证强化与 persistence 边界）对照 ADR-0009/CONTEXT 裁决 |
| 2 | 22:19 | SA6 | Phase 1 红灯锚定 | 22:34 | 3 项缺陷的红灯回归测试（同步 throw shutdown / 同步 throw idle-close / dispose 次序探针），先红后绿 |
| 3 | 22:34 | SA1 | Phase 2 设计 | 22:59 | SA6 红灯已锚定（4 用例红）；设计 3 项修复方案（persistence 边界已经 SA8 放行，路径由 SA1 定夺） |
| 4 | 22:59 | SA8 | Phase 2 设计复审 | 23:04 | 设计对照 ADR 复审（P3 触及 persistence src，核 ADR-0006 四约束守住情况） |
| 5 | 22:59 | SA2 | Phase 2 攻击评审 | 23:19 | 与 SA8 复审并行（均为只读评审）；verdict 双过才派 SA3 |
| 6 | 23:19 | SA1 | Phase 2 设计 R2 | 23:33 | SA2 reject（窄面：攻击点#1 生产 timer UNLOADING 窗口 INACTIVE_EFFECT 的契约文本失真）；续传同一 SA1 会话修订设计文本 |
| 7 | 23:33 | SA2 | Phase 2 攻击评审 R2 | 23:39 | SA1 R2 修订已落纸；SA2 声明只复核攻击点#1 落实 |
| 8 | 23:39 | SA3 | Phase 3 实现 | 23:51 | SA2 R2 pass，设计定稿（782 行）；SA3 按设计实现使 4 红灯转绿 + 双包 bump patch |
| 9 | 23:51 | SA4 | Phase 3 静态验尸 | 00:02 | 总控亲验红灯转绿（tc exit 0 / 1397 passed）；verdict: pass |
| 10 | 00:02 | SA7 | Phase 4 动态验证 | 00:30 | SA4 pass；SA7 活链路验证（含 SA4 交验的 4 条动态重点，首位 R5′ 生产 timer 残余窗口证实）；verdict: pass |
| 11 | 00:30 | 总控 | Phase 3.5 门禁自检 | - | 硬门禁 #12/#14/#15/#16 自检 + AC 逐条核对 |
