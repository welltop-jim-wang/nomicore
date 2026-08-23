# Dispatch Log — doc-runtime：committed-aware transaction fatal 契约 (issue #87)

- 类型自判：功能开发（冻结新异常契约 = 新能力 + 回归测试，无缺陷症状可复现）→ 路由：SA6 → SA1 → SA8 设计复审 → SA2 → SA3 → SA4 → SA7 → AC 门禁 → 收尾（跳过 SA5）

| # | 派发时间 | SA | 阶段 | 完成时间 | 决策逻辑 |
|---|---------|-----|------|---------|---------|
| 1 | 15:19 | SA8 | Phase 0 前置冲突门禁 | 15:25 (verdict: clear) | 任何任务先过冲突门禁：审任务简报 vs ADR 全集 + CONTEXT.md |
| 2 | 15:26 | SA6 | Phase 1 验收锚定 | 15:37 | 功能开发路由首站：按 AC 冻结红灯验收测试（branded fatal/三相区分/零写入域联合/保守语义）；产出 2 测试文件 20 用例（17 红 + 3 护栏绿），场景触发器验证 7/7，零回归 |
| 3 | 15:40 | SA1 | Phase 2 设计 | 15:56 | 红灯锚定已核实（总控亲跑 17 红/3 护栏绿），进入架构设计：DocRuntimeFatalError 契约面 + 三相区分 + materializeRoot 接装 + U13 演进 |
| 4 | 15:59 | SA6 | Phase 2 修订轮（fixture 时序缺陷） | 16:03 | SA1 §8 设计期新发现：apply 红灯用例 2/3 observer 挂在 seed 前，任何正确实现下恒红；send_message 续传原会话修 ~6 行位移 |
| 5 | 15:59 | SA8 | Phase 2 设计后复审 | 16:05 (verdict: clear) | 设计与 ADR 决策一致性复审（续传 Phase 0 会话，ADR 上下文已在） |
| 6 | 16:06 | SA2 | Phase 2 设计攻击评审 R1 | 16:18 (verdict: reject) | SA8 复审 clear，进入全维度破壁评审 |
| 7 | 16:21 | SA1 | Phase 2 设计 R2 修订 | 16:30 | SA2 R1 reject（2 CRITICAL：伪造 fatal 透传 + placeSet __proto__ 静默丢键谎报；1 MAJOR：clear+rebuild 静默抹未声明键）→ send_message 续传 SA1 原会话修订 |
| 8 | 16:33 | SA2 | Phase 2 设计复审 R2 | 16:38 (verdict: reject) | SA1 R2 修订落实 8/8 攻击点（32 处【R2】标注），续传 SA2 原会话复审 |
| 9 | 16:41 | SA1 | Phase 2 设计 R3 修订 | 16:47 | SA2 R2 reject 收敛为单一 CRITICAL 残留 R2-1（mutation 外层 catch 与 ⑥ 三 catch 的伪造 fatal 透传面，PoC 实证）→ 续传 SA1 定点修订 |
| 10 | 16:50 | SA2 | Phase 2 设计复审 R3（定点） | 16:54 (verdict: pass) | SA1 R3 按方案 A 结构化落实 R2-1（(H)/(I) 移出 try + ⑥ 守卫删除 + catch 分级总表 + 补锚），续传 SA2 定点复核 |
| 11 | 16:57 | SA1 | Phase 2 落文修正（C-R3-1/C-R3-2） | 16:59 | SA2 R3 pass 附条件：§15 ALLOW LIST 两处陈旧交叉引用必修（materialize.ts 条目仍列已废除的 ⑥ 守卫；mutation.ts 条目行数/结构陈旧），续传 SA1 修正 |
| 12 | 17:02 | SA3 | Phase 3 TDD 实现 | 17:13 | 设计定稿（SA2 R3 pass + R3.1 落文闭环），派 SA3 按设计实现 DocRuntimeFatalError/fatal.ts + materialize 改造 + mutation.ts + 版本 bump，目标 17 红灯变绿 |
| 13 | 17:16 | SA4 | Phase 3 静态验尸 R1 | 17:33 | reject：唯一阻塞项 F-1（placeSet 嵌套路径返回终段父对象）回流 SA3；fatal 契约核心面全部通过；总控亲跑全量验证绿（typecheck 0 + 67 文件/947 用例）后派发 |
| 14 | 17:36 | SA3 | Phase 3 R2 修复（F-1） | 17:44 | SA4 唯一阻塞项 F-1：placeSet 嵌套路径返回终段父对象而非 proposed 根（形态 A 恒失败+诊断失真；形态 B ok:true 静默错误写入）；SA4 已留 2 用例复现红锚 → 续传 SA3 原会话外科手术修复 |
| 15 | 17:39 | SA4 | Phase 3 静态验尸 R2（定点） | 17:40 | pass：F-1 真实修复（87ea526）、复现锚 2/2 转绿、237/237 零回归、fatal 通道零触碰；总控亲跑 typecheck 0 + doc-runtime 237/237 绿 |
| 16 | 17:41 | SA7 | Phase 4 动态验证 | 17:55 | pass：红灯 22/22 转绿、doc-runtime 245/245、全仓 957/957 绿、伪造 branded 三投递全收敛、(F)(G) 双读窗口与设计登记一致、CI Node20/24 矩阵腿如实登记 runner 面未伪造 |
| 17 | 17:58 | SA7 | Phase 4 补充轮（verdict 行格式合规） | 18:00 | 硬门禁 #12 行首模式提取要求：文末追加裸 verdict: pass 行，非重审 |
| 18 | 17:58 | SA4 | Phase 4 补充轮（1.4 vitest 触发性自检落文） | 18:05 | 硬门禁 #14 立法明文小节补齐，结论令牌 all-vitest-packages-triggered，非重审 |
| 19 | 18:03 | 总控 | Phase 3.5 AC 逐条确认门禁 | 18:03 | 7/7 AC 本地完成面全部 ✅（AC-7 CI 矩阵腿按职责边界移交 runner），产出 ac_checklist.md，无需派修订轮 |
