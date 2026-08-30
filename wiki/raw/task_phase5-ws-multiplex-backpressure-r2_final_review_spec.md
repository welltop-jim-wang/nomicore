# 双轴终审 — Spec 轴（issue #137 revision round 2）

- 审查 diff 范围：`58150ad..e483825`（3 commits / 17 文件 +1197/−63）
- 审查员：generic subagent（与总控同模型路由；engineering/code-review skill 规则）
- 审查时间：2026-08-29 13:1x

## Verdict: **clear**（无阻断发现；2 项 LOW 注释口径 + 1 项 INFO 流程观察）

审查方法：diff 全文精读 + 简报 R2-1~R2-5 反馈原文、822 行设计（含 R2 修订/N1N2/E1~E3 勘误）、SA2（R1 reject→R2 pass）、SA4、SA6、SA7、AC 清单、SA8 冲突报告、relevant_decisions、协议 §1/§3/§10/§13/§14/§17 逐条对照；关键锚点独立源码复核；后台独立复跑测试/类型检查。

## 一、R2-1~R2-5 逐条对照（反馈原文 → diff → 判定）

- **R2-1（HIGH）✅ 满足（终局静默真正消除）**：sendAndRegister 入口前置判别（update-channel.ts:136-152）——超限 + 队列空（终局）→ needsResync + declareLocalResync → RESYNC_REQUIRED + 恢复 round 收敛。resync 路径选择（三选一授权）与 UPDATE_TOO_LARGE 否决理由成立。红锚双例转绿；恢复闭环（onUpdateAck 重触发 + resyncDeclared 记忆化）独立复核成立。非队尾残余面登记如实（§2.3/§13.2 R2-B1，SA2 R2 已核）。
- **R2-2（MEDIUM）✅ 满足**：双侧删 0xffffffff ERROR 直发、仅 close(1008)；§14 L391「否则直接 close」字面命中；死 import 门禁实测精确命中（peer 0/0、hub 0/2）；红锚（严格递增 + 零 ERROR + 1008 + blocked/closed）成立。
- **R2-3（HIGH）✅ 满足**：overflows() 只计 queued（count `>=` / bytes 严格大于）——§17 分列字面归位；3 个既有测试适配非软化成立（各 +1 笔写推回可达位；溢出后断言逐字保持为 diff 上下文行；ac6 另新增 ext=3 收敛断言 = 加强）；E2 字段名 deviation（ext 为 schema 合法字段）登记在案。
- **R2-4（MEDIUM）✅ 满足**：契约四点全落（types:29/defaults:27/validate:114/backpressure:81）；缺省 64KiB 零漂移；lowWater src 消费点实测仅余水位迟滞两处 + validate（额度语义零残留）；SA7 真实 TCP 受控差分佐证；D3a/D3c 适配属 review 强制锚迁移（数值恒等 1/100，断言逻辑零改）——非软化。
- **R2-5（MEDIUM）✅ 满足**：三要素全覆盖——持续对抗生产（saveGate 门闩使 hot 永久 jam + 阶段 2 续产 8 笔）∧ no-starvation（normal 6/6 获发到达）∧ bounded-memory（溢出收口 + wire ≤ 2+16 + 本地 208 笔全接受 + 恢复收敛）；fake scheduler 零 real sleep；断言为真行为非伪绿。

## 二、SA6 两处守卫修订 = 锚修正而非软化 ✅（含独立锚序分析）

1. §5.6 区间守卫（r2-red:465-476）：与设计钉死形态逐字一致（运行时实测 ackBytes、allowed=floor、三断言）；1011/backoff/ERROR×1/牙口元断言全保留。非软化独立证据（锚序）：旧实现下首个失败断言 = 1011（位于区间守卫之前），守卫修订不可能掩盖红灯；SA4 回退复现恰 8 红交叉实证。
2. 直发收敛锚（r2-red:110-124）：删瞬时态快照（E1 勘误成立）；保 RESYNC≥1 + 本地接受 + ready；增 settleUntil(hub blurb===BIG) 更强收敛分支。被删瞬态可观察面由 SA7 supplement（in-flight>0 确定性构造）重新钉死。

## 三、验收 6 条 + AC1-AC7 保持

全部 ✅：红灯先行（8 failed → 103 绿闭环归档）；R2-5 落盘通过；AC 语义保持（独立复跑 17/106 绿，既有 94 零回归；AC2/AC5 经 R2-3/R2-4 强化）；套件绿 + tsc + diff --check；最小修复 + 协议一致 + patch bump 0.1.1→0.1.2；禁 push/PR/label、REPORT.md 未 commit。

## 四、Scope creep 检查

diff 文件集 = 设计 §12 ALLOW 精确匹配 + SA7 移交抽查点对应 2 测试文件（登记链完整：SA4 移交节/sa7_report §五/ac_checklist L34）；DENY LIST 零改动；namespace-registry fanout 红线未触；ReplicationLimits 包外消费方零（grep 实证）。

## 五、发现清单（全非阻断）

| # | 严重度 | 位置 | 发现 |
|---|---|---|---|
| LOW-1 | LOW | update-channel.ts:141-142（同源设计 §2.2 代码块） | 非队尾分支注释残留「下一次 reconciliation 修复」与 §2.3 R2 修订撤回表述的内部张力；权威登记面（§2.3/R2-B1）如实、行为正确；建议后续 slice 顺带对齐注释 |
| LOW-2 | LOW | r2-red.test.ts:437 | 注释「穷尽于 ~20 笔 ACK」为旧 75B 估算残留（实测 57B ⇒ 26）；断言运行时实测自适配，零行为影响 |
| INFO-1 | INFO | diff 文件集 | SA7 两新测试文件超 §12 枚举集，登记链完整——流水线内正常延伸，非蔓延 |

**疑似不正确行为：未发现。** 独立走查覆盖：sendAndRegister 判别边界全形态、overflows 入队前边界、onSequenceExhausted 双侧收口拓扑与 timer 泄漏面、controlReserveUsed 复位面、D3c 谓词形状钉死、恢复延迟闭环。

## 六、独立验证命令与结果（.mabf-bg/final-spec-*）

| # | 命令 | 结果 |
|---|---|---|
| 1 | npx vitest run packages/ws-replication（setsid 后台） | 17 文件/106 测试全绿，Type Errors: no errors，exit 0 |
| 2 | npx tsc -p packages/ws-replication/tsconfig.json（后台） | exit 0 |
| 3 | pnpm typecheck（全仓 11 包，后台） | exit 0 |
| 4 | git diff --check 58150ad..e483825 | 干净 |
| 5 | diff --name-only ∩ 设计 §12 ALLOW/DENY | ALLOW 精确匹配；DENY diff = 0 |
| 6 | grep 门禁 encodeMessage/codecFieldLimits | 0/0 与 0/2 精确命中 |
| 7 | grep lowWater 全 src 消费点 | 仅水位迟滞两处 + validate，额度语义零残留 |
| 8 | grep ReplicationLimits 包外消费方 | 零命中 |
| 9 | 红灯归档日志核对 | 8 failed/95 passed exit 1 → 103 绿 exit 0，闭环在案 |
| 10 | 工作区终态核查 | HEAD=e483825；git status 仅 M REPORT.md + 未跟踪 wiki R2 档案；零文件修改 |
