---
status: complete
run_id: issue-153-1787937652-3942974
branch: fix/issue-153-on-docs-namespace-diagnostic-change-log
round: 1
---

# Issue #153：Reopen streams, roll segments, and repair provable tails

## 概要

为 File 诊断日志 adapter 交付**重启存续与长跑能力**（ADR 0012 §Stream 与 generation / §Segment rolling 与耗尽 / §打开与尾部恢复 的完整实施）：

1. **健康 stream 续写 reopen**：构造期 `analyzeStreamForResume`（与 strict reader 共享扫描核心）做严格健康证明（manifest 门 + 冻结策略比对 + 逐行 VFSL/storage 校验 + 跨段 sequence 连续性）；通过则从磁盘派生 `lastCommittedSequence`/segment/三计数器续写，append 顺序无缝续接。locator 三分支确定性解析：显式 `resumeStreamId` > 可用 `current.json` > 恰一候选 manifests 扫描恢复；≥2 候选 → disabled + `stream-init-failed{reason:'locator-ambiguous'}`，禁一切 wall-clock 猜测。
2. **Segment group 滚动**：JSONL/BIN 成对滚动，`beforeCommit` 在 candidate 分配前判定三 target（默认 64 MiB/256 MiB/100,000 records 可配置）任一达到即在写下一条 record 前关闭当前组；segment 固定 8 位十进制从 `00000001` 起不回绕；`99999999` 溢出与 sequence uint64 耗尽共用 latch——恰一次 `stream-exhausted` + disabled，**绝不新建 generation**。三 target 冻结进 manifest（14→17 键原子扩展，双封闭形状：legacy 14 键可读不可续写）。
3. **启动尾部修复**：仅最大 segment 的三类可证明后缀尾损（C1 未终止末行——终止符证明不依赖 parse；C2 不完整尾 frame——从 T=max(被引用帧末) 边界行走；C3 完整未引用尾部 orphan frames——引用交叉），全有或全无（判腐即零修复），`truncateSync` 单次截断，逐次 `stream-tail-repaired{repair,truncatedBytes}` 健康事件上报。
4. **永不改写历史**：中间损坏/缺失被引用帧/CRC 错/未知格式/schema 不兼容/locator 歧义一律零修复——旧 stream 只读、字节恒等，确定性 rotate（`stream-generation-rotated{cause}` 七值封闭枚举）或 disabled。旧流历史保持可诊断。
5. **健康事件只增不改**：`stream-tail-repaired` / `stream-generation-rotated` 两新成员 + `stream-init-failed.reason` 扩值（`locator-ambiguous`/`invalid-roll-targets`；`manifest-mismatch`/`-missing` 两旧值随续写能力迁移至 rotate 事件——总控 G3 裁决）。

## 变更（3 commits，基线 8611e68 → HEAD 215a18e）

- `3536360` feat：SA3 TDD 实现（reader.ts 双封闭形状 manifest 门 + `line-unterminated`/`manifest-roll-target-violation` 两新码 + `analyzeStreamForResume`；adapters/file.ts locator 解析 + reopen 编排 + 滚动状态机 + 双耗尽 + 17 键 manifest + `invalid-roll-targets`/`frozen-policy-mismatch` 配置门；paths.ts `segmentFilePaths` 纯增量；health.ts +2 事件/+2 reason；README/AGENTS；bump 0.1.2→0.1.3；SA6 红灯测试 50 新用例 + 6 既有文件迁移随 commit 落地）
- `001ff80` test：SA7 动态补验 `file-adapter-sa7-repair-io.test.ts`（repair-io-failure 4 用例，root 护栏）
- `215a18e` fix 回流：终审 Standards 轴 3H+N1（注释真实性×2 + 死代码×1 + skipIf(isRoot) 护栏），零行为变更

**流程档案**（wiki/raw/，全部入库）：`task_diagnostic-log-stream-roll-repair{,_design(670行定稿),_relevant_decisions,_conflict_report,_design_conflict_report,_sa2_review(R1 reject→R2 pass),_sa6_red(119锚 exit=1),_sa4_review(pass),_sa7_report(pass),_ac_checklist(5/5✅),_standards_review(pass@R),_spec_review(pass@R),_dispatch}.md`。

## 验收标准逐条对照（详见 ac_checklist.md）

- **AC1（健康续写 reopen）**✅：SA6 §13.1–3 锚 + SA7 S1 真进程重启链 A→B→C（streamId 恒等、seq 续接 [1..7]、零修复零 rotate、reader ok）
- **AC2（成对滚动+固定编号+显式耗尽）**✅：SA6 §13.4–6/26–28 锚 + SA7 S2/S3/S3b（跨重启三段固定编号、组不拆对、恰达边界前滚、超大单条独占新组）；双耗尽 disabled 不新建 generation
- **AC3（三类尾部修复+健康上报）**✅：SA6 §13.7–12 锚 + SA7 S4a/S4b/S4c 真实字节截断修复 + 修复事件逐次上报 + repair-io 4/4
- **AC4（中间损坏等零修复+只读+确定性 rotate）**✅：SA6 §13.13–20/31–33 锚 + SA7 S5 篡改矩阵（六 cause 恰一次+旧流字节恒等）+ S4b0（撕裂被引用帧=corrupt rotate）+ S6b（locator 歧义 disabled 零写入）
- **AC5（崩溃窗口/重启测试矩阵）**✅：SA6 §13.29 四窗 + §13.21–28/31–33 + SA7 **322 轮 SIGKILL 真实崩溃矩阵零不变量失败**（W1×3/W2×22 任意页倍撕裂/orphan-mid/bin-torn-mid/W4）

## 验证（最终状态 215a18e，全部后台独立进程亲跑/复验）

| 命令 | 结果 |
|---|---|
| 基线（8611e68）`pnpm install --frozen-lockfile` + `pnpm test` | exit 0，138 文件 / 1719 测试绿（`.mabf-bg/baseline-test.log`） |
| 最终 `pnpm typecheck`（11 包链） | exit 0（`.mabf-bg/final-typecheck.log`） |
| 最终 `pnpm test`（全仓 vitest run --typecheck） | exit 0，**140 文件 / 1784 测试全绿，Type Errors 0**（`.mabf-bg/final-test.log`；基线 138/1719 → 净增 2 文件 65 测试） |
| 最终 `git diff --check` | 干净（exit 0） |
| 包级 `vitest run --typecheck packages/namespace-diagnostic-log` | exit 0，22 文件 / 379 测试全绿（总控 ctl-green.log + SA4/Standards 轴独立复跑一致） |
| 双 Node 版本（SA7） | v24.13.0 与 v20.18.1 均 140/1784 全绿 |
| SA7 活链路 | 多进程 E2E 74/74；322 轮 kill -9 零不变量失败；O(stream) 构造扫描线性（132MiB 841ms / 196MiB 1166ms） |

**流水线纪律**：SA8 前置门禁 clear（7 no-conflict）→ SA1 设计 670 行 → 总控六项 D 裁决 → SA8 设计复审 clear（七项钉死核验）→ SA2 R1 reject（1M+3m）→ SA1 R2 修订 → SA2 R2 **pass** → SA6 红灯 119 锚 exit=1（红因全为 src 缺失）→ 总控勘误裁决 G1–G4 → SA3 实现 → 总控绿灯亲验 exit=0 → SA4 **pass**（备案偏差裁定成立）→ SA7 **pass** → AC 门禁 5/5 ✅ → 双轴终审（standards pass-with-issues 3H+N1 → SA3 回流 → R 轮双轴均 **pass**）。硬门禁 12/13/14/15/16 自检全过（13 N/A）。流程事故一次如实留痕：SA8 复审任务误发 SA1 会话，interrupt 拦截零污染纠正（dispatch 行 4）。

## 遗留风险

1. **writer 自产「链中 orphan」不可修复终态**（SA2 #1 MEDIUM 备案，设计 §14 风险行①）：同段已有 sidecar 引用后 definitive JSONL 故障 + candidate 复用续写 → ref 链断 → 此后每次重启必然 corrupt rotate（历史永久只读、无数据丢失、业务零影响）。制造瞬间唯一信号是泛化 `storage-write-failed{stage:'jsonl'}`；可执行运维窗口已文档化（该事件后、后续 sidecar append 前尽快重启 → C3 自动修复）。根治须动 #152 R2 冻结的 candidate 复用语义，记为未来切片候选。
2. **零字节修复事件**（SA4/SA7 LOW-1）：Refs 空+全完整帧 orphan 场景发 `truncatedBytes:0` 的 `bin-orphan-frames` 事件——已被 §13.11 锚定为契约现状，语义注明留后续票。
3. **§5.4 设计字面与实现截断点分歧**（spec 轴非阻断①）：Refs 空时 C2/C3 截断点实现取「完整帧前缀边界」而非设计字面 T=0——总控备案 + SA4 裁定成立 + §13.11 钉死；建议后续票同步设计文字。
4. **VFSL pattern 引擎步数上限**（SA7 计划外发现）：inline base64 payload ≥262144B 被 `vfsl-validation-failed` 拒（≤131072B 过）——#148/#152 既有面非本票引入，建议后续票 README 记档。
5. **CI runner 侧动态证据**（SA7 §1.2）：chmod-000 EACCES 注入族依赖非 root 身份（本地 uid=1000 实测 + GitHub-hosted runner uid=1001 文档证据；§13.32b 与本票全部 chmod 注入用例已带 `skipIf(isRoot)` 护栏）；CI run 日志摘录属发布后 Host 观测面。
6. **CI 矩阵证据属发布阶段**：本地双 Node 全绿 + `--frozen-lockfile` 验证已过；最终 CI 状态由 Host 发布流程确认。不 push、不开 PR、不写 .mabf-done（归 Host）。
