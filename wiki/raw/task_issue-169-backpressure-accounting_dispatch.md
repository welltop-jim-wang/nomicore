# Dispatch Log — Issue #169 connection backpressure accounting

| # | 派发时间 | SA | 阶段 | 完成时间 | 决策逻辑 |
|---|---------|-----|------|---------|---------|
| 1 | 现在 | SA8 | Phase 0 conflict gate | 已完成 | verdict: clear；ADR/协议无冲突，放行 bug 流水线。 |
| 2 | 现在 | SA5 | Phase 0 bug analysis | 已完成 | 已复现 high severity 账本/控制额度/轮询公式六项偏差，转 SA6 固化红灯。 |
| 3 | 现在 | SA6 | Phase 1 red contract | 已完成 | 17 用例红灯契约：13 failed / 4 anchors passed，复现六项偏差。 |
| 4 | 现在 | SA1 | Phase 2 design | 已完成 | 统一账本、控制未冲刷账本、字段迁移与 poll 公式方案已归档，待攻击评审。 |
| 5 | 现在 | SA8 | Phase 2 design conflict review | 已完成 | verdict: clear；13 项设计决策与 ADR/协议一致，放行 SA2。 |
| 6 | 现在 | SA2 | Phase 2 design attack review | 已完成 | verdict: reject；R1-R4 阻断（caller 漏项、帧头算术、control 双计、非暂停控制盲区）需 SA1 修订。 |
| 7 | 现在 | SA1 | Phase 2 design revision R1 | 已完成 | R1-R8 一次性修订完成：caller、93B 配方、双 control 台账、FIFO/dormant 风险均已处理。 |
| 8 | 现在 | SA2 | Phase 2 design attack review R2 | 已完成 | verdict: reject；R1-R8 已通过，R9= maxBootstrapBytes:1 使 bootstrap 编码期失败，需修订配方；R10 非阻断措辞。 |
| 9 | 现在 | SA1 | Phase 2 design revision R2 | 已完成 | R9 改为 mb=512/quota=640、boot 前置与 allowed+1 驱动；R10 扩展为 Δ≡0 恒读数风险。 |
| 10 | 现在 | SA2 | Phase 2 design attack review R3 | 已完成 | verdict: pass；R9/R10 通过，SA2 设计攻击评审放行。 |
| 11 | 现在 | SA3 | Phase 3 implementation | 已完成 | commit 541c3b7；17 红灯全绿/包172绿/typecheck绿，但发现实现与设计 R4 非暂停控制 P2 不一致，回 SA1 裁定。 |
| 12 | 现在 | SA1 | Phase 3 design clarification | 已完成 | R11 裁定：非暂停 control 不入压力桥，接受协议观察滞后盲区，批准 SA3 541c3b7 实现形状。 |
| 13 | 现在 | SA2 | Phase 3 design clarification review | 已完成 | verdict: pass；R11 裁定接受，v4 设计与 541c3b7 一致。 |
| 14 | 现在 | SA4 | Phase 3 static review | 已完成 | verdict: pass；15 文件 ALLOW 精确匹配，23 files/172 tests/typecheck/diff-check 证据通过。 |
| 15 | 现在 | SA7 | Phase 4 dynamic verification | 已完成 | verdict: pass；新增 D1/D2，24 files/174 tests/typecheck/diff-check 通过；F1-F4 非阻断后续项已登记。 |
| 16 | 现在 | Final dual-axis review | Phase 4.5 | 已完成 | verdict: BLOCK（Standards + Spec 一致）：D1 证明 data flush 错放 control quota，超 maxQueuedControlBytes。 |
| 17 | 现在 | SA1 | Phase 4.5 control-reserve redesign | 已完成 | R12 v5：kind-aware 保守退休，data-first 下降归因确保 data flush 不释放 control quota。 |
| 18 | 现在 | SA2 | Phase 4.5 control-reserve design review | 已完成 | verdict: pass；R12 kind-aware退休和D1反转算术通过，NC-5..8非阻断。 |
| 19 | 现在 | SA3 | Phase 4.5 control-reserve implementation | 已完成 | commit 8da8692；D1反转为安全回归，24 files/174 tests/typecheck/diff-check通过；NC-8落地。 |
| 20 | 现在 | SA1 | Phase 4.5 design archive follow-up | 已完成 | v5.1补齐NC-5跨窗口候选界与NC-6 D1实际数字，对齐8da8692。 |
| 21 | 现在 | SA4 | Phase 3 static review R2 | 已完成 | verdict: reject；实现四焦点通过，但三项设计文档阻断（D1数字、ALLOW缺档、NC-7/8登记）一次性回SA1。 |
| 22 | 现在 | SA1 | Phase 3 review documentation repair | 已完成 | v5.2一次性更正SA4 R2三项文档阻断：D1真值、ALLOW/D1-D2理由、owner/teardown。 |
| 23 | 现在 | SA4 | Phase 3 static review R3 | 已完成 | verdict: pass；R2三项阻断全闭合，scope guard零越界，静态门禁收口。 |
| 24 | 现在 | SA7 | Phase 4 dynamic verification R2 | 已完成 | verdict: pass；D1独立反转/正向归因均通过，19 focused与24 files/174 tests/typecheck/diff-check全绿；F1关闭。 |
| 25 | 现在 | Final dual-axis review R2 | Phase 4.5 | 已完成 | verdict: pass；fresh Standards + Spec 独立终审均通过，R12 quota blocker关闭。 |
| 26 | 现在 | Final verification | Phase 5 | 已完成 | 后台包装层 wait 伪码127，但日志逐项真实结果为 typecheck=0、vitest=0（24/174）、diff_check=0；以逐项退出码采信。 |
