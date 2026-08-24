# Dispatch Log — namespace-runtime replaceSchema：provided-root 静默投影偏差修复（issue #91，round 2 修订轮）

类型自判：Bug 修复（规格偏差 → 静默数据丢失）。工作流 = SA8 前置门禁 → SA6 红灯锚定 → SA1 修订设计 → SA8 设计复审 → SA2 攻击评审 → SA3 实现 → 总控亲跑验收 → SA4 静态验尸 → SA7 动态验证 → AC 门禁（review 7 条）→ 收尾。依据：有代码变更（SA3+SA4+SA7 强制）、测试先行（SA6）、有设计（SA1+SA2）、ADR 裁决面（SA8 前置+设计后）；SA5 故障分析省略——根因已由人工 review 精确定位（schema-replace.ts:170 投影调用），无复现分析缺口。

| # | 派发时间 | SA | 阶段 | 完成时间 | 决策逻辑 |
|---|---------|-----|------|---------|---------|
| 1 | 22:23 | SA8 | Phase 0 前置冲突门禁 | 失败×3（会话崩溃无产出） | 修订轮首发：裁决「废止 D7 投影」与 ADR 0008/0007/CONTEXT.md 的一致性，产出相关决议供全链复用 |
| 1b | 22:34 | SA8 | Phase 0 前置冲突门禁（重派新会话） | (pending) | 首发会话 6205c4a1 三次续传均失败（无产出落盘），重派新会话 88338a2e |
| 2 | 22:37 | SA6 | Phase 1 红灯锚定 | 22:45 红灯真实（全量唯一失败=R2-1） | SA8 clear 后锚定新契约红灯：顶层未声明键 → ok:false 响亮失败（含 0 update/0 notifier/三不变），同步修订快照时点用例 |
| 3 | 22:46 | SA1 | Phase 2 修订设计 | 22:51 落盘 213 行 | 红灯已锚定；派 SA1 出紧凑修订设计（删投影规格 + E204 可达性 + 零回归清单 + ALLOW/DENY） |
| 4 | 22:53 | SA8 | Phase 2 设计复审 | 22:58 verdict: clear | 设计落盘即复审 ADR 一致性（续传 88338a2e 保持上下文） |
| 5 | 22:59 | SA2 | Phase 2 攻击评审 | 23:03 verdict: pass | SA8 设计复审 clear；派 SA2 破壁（D2 更名 / D3 ⑥恒等性 / E204 γ 可达性 / 零回归 14 项） |
| 6 | 23:05 | SA3 | Phase 3 编码实现 | 23:12 交付（5 文件） | SA2 pass（0 C/M，6 项 M/NIT 登记）；按设计 D1–D8 + ALLOW LIST 实现使 R2-1 红灯转绿 |
| 7 | 23:17 | 总控 | Phase 3 亲跑验收 | 23:17 | pnpm test 全量 84/1078 全绿 + Type Errors 无 + exit 0（.mabf-bg/verify-p3-r2.log）——红灯确已转绿 |
| 8 | 23:17 | SA4 | Phase 3 静态验尸 | 23:24 verdict: pass | 验收全绿后红队：零残留 grep / 三处同引用 / 文档逐字相容 / bump / DENY 零触碰 / HG#14 自检 |
| 9 | 23:26 | SA7 | Phase 3 动态验证 | 23:35 verdict: pass | SA4 pass（红线 6/6）；派 SA7 独立复跑三门禁 + 保持项回归 + 可选 T1/T2 对抗锚 + HG#14 触发证据 |
| 10 | 23:39 | 总控 | Phase 3.5 AC 门禁 | 23:39 | review 7 条逐条核验 7/7 ✅（ac_checklist rev1）——证据全部实读源码/测试/文档 + 亲跑/SA7 实跑 |
| 11 | 23:39 | 总控 | Phase 4 终验 + HG 自检 | 23:39 | 亲跑三门禁全绿：pnpm test 84/1078 exit 0（verify-p3-r2.log）、pnpm typecheck exit 0、tsc 聚合 exit 0（final-*-r2）；HG #12 双清 verdict 真实一致 / #13 N/A / #14 SA4§触发性+SA7§证据在位 / #15 未触发且设计§8在位 / #16 零 push/PR、base=docs/namespace-runtime |
| 12 | 23:50 | 总控 | Phase 4 收尾固化 | 23:50 | 本地 commit（代码+测试+CONTEXT+wiki 10 件；REPORT.md/.mabf-done/.mabf-bg 未扫入）；REPORT.md round:2 status: complete 落盘；push/PR/.mabf-done/label 留 Host 唯一执行 |
