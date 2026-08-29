# Acceptance Criteria Checklist — Issue #169

> Rechecked after R12 control-kind retirement repair (`8da8692`), SA4 R3 pass, and SA7 R2 pass.

| AC# | 描述 | 状态(✅/❌) | 证据 | 处理 |
|---|---|---|---|---|
| AC1 | 同一同步调用栈连续发送、transport 延迟更新 `bufferedAmount` 时，总压力不超过配置预算。 | ✅ | SA6 G1；SA4 R3 静态核验；SA7 R2 focused red-contract 17/17。`handoffQueue`、严格 `projected <= cap` 保留。 | SA3 已实现，SA4/SA7 R2 复验。 |
| AC2 | 覆盖恰等于 cap、首帧越 cap、shed 回落目标、单帧大于 cap、多个 namespace victim。 | ✅ | SA6 G2a/G2b/G2c、G4/G4b、G5；SA4 R3 与 SA7 R2 全量 24 files/174 tests。 | 已实现并复验。 |
| AC3 | control flush 后额度释放；未 flush 时首个越界 control 不上 wire，并恰一次 `CONNECTION_BACKPRESSURE` + close(1011)。 | ✅ | R12 D1 安全回归：data flush 后 `n2=0`、第10帧拒绝、wire=148,293≤163,840、`exhausted=1`；SA7 R2 临时翻转探针和正向 kind-归因对照；G3a/G3b/G9 17/17绿。 | R12 修复已关闭原 control-quota BLOCK；F1 已关闭。 |
| AC4 | 自定义 `ackTimeoutMs` 的 poll 间隔符合协议公式。 | ✅ | SA6 G6a/G6b；SA4 R3；SA7 R2 红灯套件 17/17。 | 已实现并复验。 |
| AC5 | fairness、control priority、no-starvation、bounded-memory 回归保持绿色。 | ✅ | SA7 R2 `pnpm exec vitest run packages/ws-replication --typecheck`：24 files / 174 tests passed，报告 R2.4 确认回归包含并绿。 | 无回归。 |
| AC6 | `pnpm run typecheck`、`pnpm exec vitest run packages/ws-replication --typecheck`、`git diff --check` 均通过。 | ✅ | SA4 R3 与 SA7 R2：typecheck exit 0；24 files/174 tests/Type Errors no errors；diff check exit 0。终验仍将重跑并留存。 | 待最终终验留存。 |

## Verdict

R12 修复后 6/6 Acceptance Criteria 均已重新核验为 ✅。控制额度的 data-flush 过释放已由 D1 安全回归关闭，允许进入新的最终双轴审查。
