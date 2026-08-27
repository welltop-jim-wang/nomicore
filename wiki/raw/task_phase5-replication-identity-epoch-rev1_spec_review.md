# 规格轴独立审查报告 — Phase 5 replication identity/epoch 修订轮（issue #132，round=2）

- **审查轴**：issue/反馈规格轴（独立代码审查员，只读）
- **审查范围**：`git diff 3841aff..HEAD`（HEAD = `0d0c941`；实现 commit `ace6f83` + wiki 档案）
- **审查时间**：2026-08-27
- **方法**：先读规格原文，再逐条在 diff/工作树中取证；所有发现附 文件:行号 / 测试名，可复核

## 规格来源

1. **issue #132 body — Acceptance Criteria（6 条）**（`gh issue view 132 --json body`）：
   - AC-1：META reserves/projects replicationId/replicationEpoch，格式以 ADR 0010 冻结为准；
   - AC-2：enableReplication 经 sequencer + dirty notification 原子安装随机 128-bit lineage ID + epoch 1；
   - AC-3：重复 enable 幂等或返回稳定文档化结果、identity 不变；
   - AC-4：bumpReplicationEpoch Hub-only、sequenced、monotonic、拒 overflow、保留 committed/fatal facts；
   - AC-5：Open 与 Runtime status 可区分 disabled / enabled identity / identity change，不暴露可变 META 引用；
   - AC-6：测试覆盖并发 enable/bump、persistence-degraded、close/fatal 竞态、retry、Memory/File persistence 恢复。
2. **review 评论（welltop-jim-wang，OWNER，2026-08-27T14:33:17Z，`gh issue view 132 --json comments`）— 4 项反馈**：
   - 反馈 1（高）：构造期 `readReplicationFacts` 与 ADR 0008:14 冲突，二选一（增补 ADR 0008 登记例外+损坏拒绝语义 / 或将校验移至 session 接缝）；
   - 反馈 2（中）：ADR 0008 第 36–41 行「两个窄方法」与第 95 行 status 清单未含 enableReplication/bumpReplicationEpoch/status.replication，须同步规范文档（含 Phase 5）；wiki/raw 不能替代规范合同修订；
   - 反馈 3（中）：补 AC-6 恢复矩阵两项——File bump 后 epoch 落盘+重启恢复；fatal 后 reopen/recovery 保留 committed facts；
   - 反馈 4（低，判断项）：replication-write.ts 双槽 E1/E2 gate 重复，建议提取共享 gate 或给出不处理理由。

## 逐条核对表

| 项 | 状态 | 证据 |
|---|---|---|
| 反馈 1：二选一落实 | ✅ | 选择落在反馈给出的**第一条路径**（保留构造期校验 + 增补 ADR 0008）。`docs/adr/0008-namespace-runtime-read-write-capabilities-and-sequencer.md:127-137` 新增「issue #132 修订：复制保留事实投影与管理写（2026-08-27）」节；代码侧 `packages/namespace-runtime/src/runtime.ts:208` 构造期 `readReplicationFacts(doc)` 保留，与所选路径一致 |
| 反馈 1a：普通 open 规则例外说明 | ✅ | ADR 0008:131（条款 1，仅构造期/对外发布前同步读两个保留字段、不读其他 META 键）+ :133（条款 3，逐字「**除此之外，原第 14 行保持不变**」，不读/不验证 SCHEMA/ROOT/logical value、不引入通用 META validation）。原第 14 行原文仍在（:14），例外边界闭合 |
| 反馈 1b：损坏拒绝构造语义 | ✅ | ADR 0008:132（条款 2）：恰一键存在/显式 undefined/格式不合法/META 载体异型 = 持久化损坏 → 构造同步拒绝，经 Registry 收编 `NamespaceRegistryFatalError('open','runtime-construction',committed:false)`；明文「禁止伪装 disabled、禁止自动补写新 lineage」。运行时行为锚：`registry-sa7-phase5-replication-dynamic.test.ts`（SA7 报告 :85-89 复验通过） |
| 反馈 1 授权链 | ✅ | ADR 0008:129 逐字登记「issue #132 / PR #145 review feedback 1 / owner welltop-jim-wang / 2026-08-27」并声明选择构造期窄例外路径；`wiki/raw/task_phase5-replication-identity-epoch-rev1_design_conflict_report.md` Verdict clear（override-declared，授权链经 `gh issue view 132` 核验） |
| 反馈 2：第 36–41 行「两个窄方法」同步 | ✅ | ADR 0008:134（条款 4）逐字引用原表述并限定：「基础 v1 方法为两个（mutateRoot/replaceSchema）；经 ADR 0010 授权的复制管理例外另加 enableReplication() 和 bumpReplicationEpoch()」，四者同一严格 FIFO sequencer、完整槽序不变（正文 :36 维持原文，以增补节限定——ADR append-only 惯例） |
| 反馈 2：第 95 行 status 清单同步 | ✅ | ADR 0008:135（条款 5）：正文 status 列举补 `replication`，限界为持久 identity/epoch 两态联合，排除 session/网络/队列/sync |
| 反馈 2：Phase 5 文档同步 | ✅ | `docs/phases/phase-5-websocket-replication.md:52-59` 新增 Slice 1 Runtime/Lease 基础合同五条（FIFO/原子安装/overflow 拒升/两态 status/构造期窄例外/dirty-not-durable）；:172-173 场景 15 拆 15a（本阶段含 File bump durable restart）/15b（后续切片 conflict/resetReplica） |
| 反馈 3a：File bump 落盘+重启恢复用例 | ✅ | `packages/namespace-registry/test/registry-phase5-replication-red.test.ts:853`「FilePersistence bump 恢复（AC-6 矩阵补全）」：enable→bump 至 2→**双字段** `waitDurableSnapshot`（epoch===2 且 id===id0 的磁盘事实，:887-888）→shutdown/dispose→同 rootDir 全新 FilePersistence/Registry open 恢复 id0/2 + `status.replication` 精确等于 enabled 联合（:896-900）。断言有效：SA7 变异验证（durable 目标 2→999 确定性 5s 超时转红，逐字节还原复绿——`..._sa7_report.md:45-53`），非假锚 |
| 反馈 3b：fatal 后 reopen/recovery 保留 committed facts 用例 | ✅ | 同文件 :710「fatal committed-not-durable（committed-state recovery…）」：bump notifier reject → `RuntimeWriteFatalError` committed:**true**（:737-739）→ 原 live doc META/status 保留 id0/2 且 fatal 非空（:741-745）→ rejection 后才从同一 live Y.Doc `encodeStateAsUpdate`/`applyUpdate` 克隆 seed（前后双断言 id0/2，:750-755）→ 新 Registry 仅从 seed open，fatal 为空、bump 成功至 3（:762-769）→ failed notifier 的 persistence 断言 `loadCalls`/`saveEvents` 为空，不充当 durable/reopen 前提（:775-776）。命名与注释明确 committed-state recovery ≠ File durability recovery，符合 ADR 0006/0008 修订节边界 |
| 反馈 3 用例真实性（本审查员独立复跑） | ✅ | 仓库根 `pnpm vitest run packages/namespace-registry/test/registry-phase5-replication-red.test.ts packages/namespace-runtime/test/runtime-replication-write.test.ts` → Test Files 2 passed (2)，Tests 30 passed (30)，Type Errors 0，exit 0（两用例在 16 个 registry 用例内实际执行，无 skip/todo） |
| 反馈 4：重复 gate 收敛 | ✅（选择提取，非仅给理由） | `packages/namespace-runtime/src/replication-write.ts` 新增**私有** `runReplicationWriteGate`（:140-184；无 export，零公共面扩散），`runEnableReplicationSlot`（:257-267）与 `runBumpReplicationEpochSlot`（:367-373）双槽共用。等价性：短路顺序 fatal→getStatus→notifier 不变；三处 stable message 逐字节保留；getStatus throw 路径经 `write.ts:187` `markWriteFatal` 同步置位 + `RuntimeWriteFatalError('write-slot-internal',committed:false)`（message 由 `write.ts:238` `writeFatalMessage` 同参数生成）以 async rejection 送达——与基线 `rejectWithWriteFatal`（`write.ts:211`，committed:false 时无 best-effort notify）同一错误形状、同一结算通道。锚定测试：`runtime-replication-write.test.ts:419/462/494/557/585` 五例双入口等价性（访问计数、hostile input 零读取、branded fatal、通知时刻 META 已提交快照）；SA7 变异验证计数断言 0→1 确定性转红（`..._sa7_report.md:71-79`） |
| AC-1 | ✅ 未削弱 | 本轮未触及读取器/格式判据；ADR 0008:131-132 将既有行为登记为规范；既有锚在 SA7 全量 126 文件/1485 测试绿内 |
| AC-2 | ✅ 未削弱 | 生产代码唯一变更为 gate 提取（行为等价，证据见反馈 4 行）；槽序 E1–E7 不变由五例等价测试 + 变异验证锚定 |
| AC-3 | ✅ 未削弱 | E4 幂等分支未触碰（diff 中该段为零改动上下文）；既有用例 `runtime-replication-write.test.ts:313`（幂等再 enable/identity 不变）在本轮 30 测试绿内 |
| AC-4 | ✅ 未削弱，文档补强 | ADR 0008:134/136 登记 FIFO 槽序、committed≠durable、fatal 后 committed facts 不回滚；overflow 拒升既有锚（`runtime-replication-write.test.ts:313`）绿 |
| AC-5 | ✅ 未削弱，文档补强 | ADR 0008:135 + Phase 5 :52-59 登记两态投影边界；既有锚 `registry-phase5-replication-red.test.ts:554`（status 新鲜对象、无 mutable META 引用逃逸）绿 |
| AC-6 | ✅ 本轮增强 | 既有矩阵之上新增反馈 3 两用例（:710、:853）；并发/degraded/close/fatal/retry/Memory/File 子项均有活锚（:637、:662、:805 等）；SA7 全量 126 文件/1485 测试绿 + 目标文件两次重跑无 flake |

## 发现清单

| # | 严重度 | 发现 | 证据 |
|---|---|---|---|
| F-1 | non-blocking | `git diff --check 3841aff..HEAD` 失败：wiki/raw 三个档案文件存在 trailing whitespace（sa2_review.md:3、sa4_review.md:3-4、sa7_report.md:109，均为 markdown 行尾双空格，可能是有意换行）。round-2 任务简报（`task_...-rev1.md:53`）将 `git diff --check` 通过列为验收门槛；ac_checklist 的 exit 0 声明对应 ace6f83 时点，三处空白由其后的 wiki 报告 commit 引入。仅触及 wiki/raw 历史证据，不影响规范文档与代码。建议发布前清理或在门槛口径中豁免 wiki/raw | 本审查员实跑 `git diff --check 3841aff..HEAD` exit 2 |
| F-2 | non-blocking（知情项） | ADR 0008 正文第 36/95 行未就地改写，以增补节条款 4/5（:134/:135）逐字引用并限定/补充。符合 ADR append-only 修订惯例，反馈 2 未强制就地改写；但读者需连读第 127 行增补节方能获得完整现行契约 | ADR 0008:36、:95、:127-137 |
| F-3 | non-blocking（流程登记） | 发布后 CI job-log 证据未落：SA7 报告（:109-110）明确登记「CI Run 未提供，不伪称 CI 已绿」，ac_checklist:32 同样声明属发布后补证义务。非本地规格缺口 | `..._sa7_report.md:91-110`、`..._ac_checklist.md:32` |

## Conclusion

**clear**。

4 项反馈全部按规格落实且证据可复核：反馈 1 选择反馈自身给出的第一条路径（ADR 0008 增补节含例外说明 + 损坏拒绝构造语义 + 授权链）；反馈 2 的两处 ADR 表述与 Phase 5 文档均已同步；反馈 3 两个恢复用例真实存在、断言有效（含 durable 磁盘事实门与 committed≠durable 反向控制），本审查员独立复跑 30 测试全绿；反馈 4 已提取私有共享 gate 且行为等价性经双入口测试与变异验证锚定。AC-1..AC-6 无任何一条被本轮改动削弱，AC-6 获增强。三项发现均为 non-blocking（wiki 空白 hygiene、ADR 增补式同步知情项、发布后 CI 补证登记）。
