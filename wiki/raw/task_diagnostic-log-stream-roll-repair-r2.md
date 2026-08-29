# 任务简报 — Issue #153 修订轮 round=2（无引用时完整 orphan BIN 尾帧未清除）

## 任务身份

- repositoryId: nomicore
- issue: 153（round=1 已发布 PR #166，CI 双腿全绿；质量审查发现 1 项 High 规格/正确性缺陷，round=1 完成事务被 Host 作废）
- round: 2（发布后修订轮：owner 质量审查反馈）
- worktree: /home/wangjian/nomicore-fix-issue-153
- branch: fix/issue-153-on-docs-namespace-diagnostic-change-log
- run_id: issue-153-1787937652-3942974
- 基线 commit：51b79b9（round=1 HEAD，含全部 round=1 档案）
- round=1 档案：wiki/raw/task_diagnostic-log-stream-roll-repair{,_design,...}.md 13 件

## 反馈全文要点（PR #166 质量审查，High）

**无引用时完整 orphan BIN 尾帧未被清除**：实现 `reader.ts:1086-1102` 在 `refsToSegMax.length === 0` 时调用 `walkCompletePrefixEnd()` 将 T 从 0 推进到完整 orphan 前缀末端（保留这些帧、可能发 `truncatedBytes:0` 事件）；设计明文 `Refs 为空 → T = 0`（`task_diagnostic-log-stream-roll-repair_design.md:224` §5.2 与 :231-251 §5.4；AGENTS.md:44-46 同向）。审查方判 AC3 未满足（也可能破坏 AC1）。修复建议：①删除 walkCompletePrefixEnd 例外保持 T=0；②完整 orphan 后缀全部截断；③测试断言修复后 BIN 实际长度 0；④修复后再写一条 sidecar record 断言 frameOffset="0" 且 strict reader 成功；⑤（非必须）共享原语抽取。

## 总控核验裁决（开工取证，round-2 G1）

**claim 成立**。证据：
1. 设计 §5.2：「C2/C3：`T = max{ end | (off,end) ∈ Refs }`（**Refs 为空 → T=0**）」——明文；
2. 设计 §5.4 伪代码首行：「`T = max(end for (off,end) in Refs) if Refs 非空 else 0`」——明文；
3. ADR-0012 §打开与尾部恢复：「截断完整但未被任何完整 JSONL record 引用的尾部 orphan frames」——Refs 空时最大 segment 的全部完整帧均为未引用尾帧，规范要求全截；
4. 实现 `reader.ts:1091-1094` 与设计字面相反；前缀走到底时发出 `truncatedBytes:0` 零字节修复事件（round-1 LOW-1 备案的不诚实观测）；
5. 测试锚 §13.11（`file-adapter-reopen-roll-repair.test.ts:410-451`）断言保留完整帧（bin→4122），固化偏差语义，须重写。

**机制勘误（诚实记录）**：审查方声称的下游后果「下一条 sidecar frame 触发 frame-boundary-invalid 使 stream 再次损坏」在当前 reader 链语义下**不成立**——首个被引用帧 expectedOffset=null 跳过边界检查（`storage-gate.ts:88` + round-1 D-A1 动态锚实证：首引用之前的 orphan 是 reader-ok 惰性残渣）。但规格违反与 AC3 未满足（未截断 + 不诚实事件）独立于该机制成立；修复方向不受影响。此勘误已告知下游 SA，防止修复后补「防 frame-boundary-invalid」类伪需求断言。

**round-1 偏差处置链如实记录**：该偏差系 SA3 备案 + SA4 裁定成立 + spec 轴非阻断①（建议后续票同步设计文字）——owner 质量审查推翻了该裁定，以设计字面为准。SA6 §13.11 红灯锚的期望写错（锚本身编码了偏差），本轮属「锚纠错」。

## 修订范围（本票做什么）

1. `reader.ts`：删除无引用时 `walkCompletePrefixEnd()` 例外，C2/C3 截断点严格 `T = max ref end`（Refs 空 → 0）；`walkCompletePrefixEnd` 函数随之成为死代码须移除；修复事件只在真实截断字节时发出（truncatedBytes>0 结构性成立）。
2. 测试锚纠错（SA6 owned）：§13.11 相关用例重写——修复后 BIN 实际长度 0；修复后续写一条 sidecar record 断言 `frameOffset === "0"` 且 strict reader ok（反馈建议 ③④ 原样落地）。
3. 受影响文档同步核查：README/AGENTS/设计文档中是否有与该偏差同源的表述残留（round-1 代码注释「§13.11 契约面」段须删改）。
4. 版本 bump：`packages/namespace-diagnostic-log` 0.1.3 → 0.1.4（硬门禁 9）。

## 明确排除（不做什么）

- 不改设计文档 §5.2/§5.4 的 T=0 语义（设计本就正确，本轮是实现向设计收敛）；
- 不做反馈建议 ⑤ 的共享原语抽取（审查方明示非必须；留给后续切片）；
- 不改 #148 冻结面；不动 round-1 其余已验收语义；
- 不 push、不开 PR、不写 .mabf-done。

## 流程裁剪（缺陷修复轮，总控自定）

SA8 前置冲突门禁（修订反馈 vs ADR）→ SA6 红灯锚纠错+新回归锚（见红 exit=1）→ SA3 修复转绿 → 总控绿灯亲验 → SA4 静态验尸（diff 51b79b9..HEAD）→ SA7 动态验证（AC3/AC1 重新实证 + 全量回归）→ AC 门禁（聚焦 AC3/AC1，其余零回退）→ 双轴终审 delta → 收尾。跳过 SA5（缺陷已由审查定位+总控核验复现语义）与 SA1/SA2（零设计变更：实现向已定稿设计收敛，锚纠错属 SA6 域）。

## 验证门槛

- `git diff --check` 干净；`pnpm typecheck` 全包 0 错误；`pnpm test` 全仓绿（基线 round-1 HEAD：140 文件 / 1784 测试）零回退。
