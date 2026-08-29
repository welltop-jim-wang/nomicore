---
status: complete
run_id: issue-153-1787937652-3942974
branch: fix/issue-153-on-docs-namespace-diagnostic-change-log
round: 2
---

# Issue #153 round=2：修订轮 — 无引用时完整 orphan BIN 尾帧未被清除（PR #166 质量审查 High）

## 概要

round=1 已发布（PR #166，CI 双腿全绿），质量审查判 1 项 High 规格/正确性缺陷并作废 round=1 完成事务。本轮按修订流程修复并重走验收。

**缺陷**：`reader.ts` C2/C3 修复在 `refsToSegMax` 为空时调用 `walkCompletePrefixEnd()`，将截断点 T 从 0 推进到完整 orphan 帧前缀末端——保留这些帧（违反设计 §5.2/§5.4 明文「Refs 为空 → T=0」与 ADR-0012「截断完整但未被任何完整 JSONL record 引用的尾部 orphan frames」），且前缀走到底时发出 `truncatedBytes: 0` 的不诚实修复事件（round-1 LOW-1）。AC3 未满足。

**修复**（commit `a2cf3a5`，零设计变更——实现向已定稿设计字面收敛）：
1. 删除 refs 空例外分支，C2/C3 截断点严格 `T = max ref end`（Refs 空 → 0），完整未引用尾帧全量截断；`walkCompletePrefixEnd` 成死代码一并移除（reader.ts 净 -27 行）。
2. 修复事件诚实性获结构保证：`bin.byteLength > t` 守卫 ⇒ `truncatedBytes > 0` 恒成立（C1 侧代数同理），零字节事件结构性消除并有负向断言钉死。
3. 测试锚纠错（SA6 owned）：§13.11 重写（修复后 BIN 实长 ===0、truncatedBytes=真实移除量）+ §13.11b/§13.11c 新回归锚（修复后续写 sidecar `frameOffset === "0"` + strict reader 全流 ok）+ 窗口1/3/§13.32c 补断言。
4. 版本 bump：`@nomicore/namespace-diagnostic-log` 0.1.3 → 0.1.4。
5. 反馈建议⑤（共享原语抽取）按审查方「非必须」明示不做。

## 总控核验裁决（开工取证，round-2 G1）

**审查 claim 成立**：设计 §5.2（L224 区）与 §5.4 伪代码双处明文「Refs 为空 → T=0」；ADR-0012 §打开与尾部恢复第三类修复条文要求截断全部未引用尾帧；实现与 §13.11 锚（round-1 SA3 备案偏差 + SA4 裁定 + spec 轴非阻断①）共同偏离设计字面——owner 裁决以设计为准绳推翻备案链。

**机制勘误（诚实记录）**：审查方声称的下游后果「下一条 sidecar 触发 frame-boundary-invalid 使 stream 再次损坏」在当前链语义下不成立——首个被引用帧 `expectedOffset=null` 跳过边界检查（`storage-gate.ts:88` + round-1 D-A1 动态锚实证）。规格违反（未截断 + 不诚实事件）独立于该机制成立；SA8 R2 门禁同裁（O1），SA6 锚纠错零「防 frame-boundary-invalid」伪需求断言（grep 实证）。

## 流水线（缺陷修复轮；r2_dispatch.md 全审计）

SA8 R2 前置门禁 **clear**（T=0 全截 = ADR 第三类条文直接形式化；零设计/ADR/词表变更；无遗留张力）→ SA6 锚纠错+新回归锚（**6 红 / 375 绿，exit=1**，两轮复跑一致，红因唯一指向偏差分支）→ SA3 修复（a2cf3a5）→ 总控绿灯亲验 exit=0（包级 22 文件/381 测试全绿）→ SA4 R2 **pass**（七项复核全过：T=0 忠实性/死码零残留/事件诚实性结构证明/注释逐字/bump/ALLOW-DENY/1.4 触发性）→ SA7 R2 **pass**（AC3/AC1 活链路重证 24/24；SIGKILL 抽样 68 轮 0 失败含 W1 真实命中 `bin-orphan-frames{truncatedBytes:4194329}` 4MiB 全截；双 Node 全量零回退）→ AC 门禁 **5/5 ✅**（AC3/AC1 重证闭合，AC2/4/5 零回退）→ 双轴终审 delta **均 pass**（standards 零 hard violation；spec 零阻断 + 独立探针 P1–P6 六形态边界全中）。硬门禁 12/13/14/15/16 自检全过（13/15 N/A：无 spec.ts、R2 零设计变更零新协议假设）。

**双总控竞态事件如实记录**：round=2 启动时存在一个 recover 催生的并行总控副本（09:31–09:53），其写就 `round2_feedback.md`（权威任务输入）与 SA6 早期草稿（`_sa6_red_r2.md`，自标「已取代」）；09:45 发现本线后如实记录竞态、09:53 自裁让位并终止（零 src/test 残留、零后续写/派发）。其留存档案随本 commit 入库，round-1 dispatch 的 Round-2 附段加本线注记（其「跳过 SA8」叙事系未执行计划，权威流水线以 `-r2_` 档案为准）。

## 变更（基线 51b79b9 round=1 HEAD → 本轮 HEAD）

- `a2cf3a5` fix：T=0 收敛修复（reader.ts -27 / 测试锚纠错+新增 +106 / bump 0.1.4）
- 本收尾 commit：round-2 全部档案（r2 简报/dispatch/SA8 门禁×2/SA6 红灯/SA4/SA7/AC 表/双轴终审 + round2_feedback 权威输入 + SA6 超替草稿）+ round-1 dispatch 竞态注记 + 本 REPORT.md

## 验证（最终状态，全部后台独立进程亲跑/复验）

| 命令 | 结果 |
|---|---|
| SA6 R2 红灯 | exit=1，6 failed / 375 passed（红因唯一指向 reader.ts 偏差分支；存量 375 零回退） |
| 总控绿灯亲验（包级） | exit=0，22 文件 / 381 测试全绿，Type Errors 0（`.mabf-bg/ctl-green-r2.log`） |
| 最终 `pnpm typecheck`（全包链） | exit 0（`.mabf-bg/final-r2-typecheck.log`） |
| 最终 `pnpm test`（全仓 vitest run --typecheck） | exit 0，**140 文件 / 1786 测试全绿，Type Errors 0**（`.mabf-bg/final-r2-test.log`；round-1 基线 140/1784 → +2 恰为 §13.11b/c 新锚） |
| 最终 `git diff --check` | 干净（exit 0） |
| 双 Node（SA7 R2） | v24.13.0 与 v20.18.1 均 140/1786 全绿 |
| SA7 R2 活链路 | AC3/AC1 重证 24/24：修复后 BIN 实长恒 0、truncatedBytes===修复前长度（4129/4122/8244 全 >0）、零字节事件绝迹、frameOffset==="0"、reader ok、序列连续；SIGKILL 68 轮 0 失败 |

## 遗留风险

1. round-1 遗留风险 1（writer 自产链中 orphan 不可修复终态）维持备案不变（本轮 diff 不触该面）；风险 2（零字节修复事件）**已随本轮结构性消除作废**（结构保证 + 负向断言双落地）；风险 3（设计字面与实现截断点分歧）**已闭合**（实现向设计字面收敛）；风险 4–6（VFSL 步数上限记档 / CI runner 非 root 证据 / CI 矩阵）维持原状归对应后续面。
2. spec 轴 R2 非阻断 1 条：测试文件 L444 残留 `walkCompletePrefixEnd` 历史注释引用（「废止」记档性质，非死代码）。
3. standards 轴 R2 非阻断 2 条：NB-R2-1 两 untracked 档案**已随本轮收尾入库闭合**；NB-R2-2 记档更新已并入本报告。
4. CI 证据属发布阶段：本地双 Node 全绿 + `--frozen-lockfile` 前置已于 round-1 验证；R2 最终 CI 状态由 Host 发布流程确认。不 push、不开 PR、不写 .mabf-done（归 Host）。
