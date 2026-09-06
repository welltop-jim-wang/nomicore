# Dispatch Log — Issue #227: strict replay read leases and completeness

| # | 派发时间 | SA | 阶段 | 完成时间 | 决策逻辑 |
|---|---------|-----|------|---------|---------|
| 1 | 17:55 | SA1 | Phase 2 设计 R1 | 18:19 | 读 ADR 0012 §Retention/§Strict reader、包 AGENTS.md、read-session/retention/reader/file.ts、diagnostic-replay.ts 与既有 pin（T-C1..C8、SA7 重点 4）；定位五缺口（生产读路径零租约接线 / S1 无提交点复查 + 卫生遍历无租约门 / fatal-committed-unknown 推进至 complete / materialize none 语义过宽 / 必要性判定次序颠倒）；产出 `wiki/raw/task_issue-227_design.md`（AC 映射、ALLOW-DENY、租约生命周期、TOCTOU 三腿论证、分类表、INV-227-1..10、测试矩阵与验证命令、G-227-1..4 开放裁决）。关键事实：SA7 重点 4（diagnostic-replay-host-lifecycle-sa7.test.ts:445）钉死旧行为，须随本票废止改写。下一步：总控过裁决点 → SA2 攻击评审 |
