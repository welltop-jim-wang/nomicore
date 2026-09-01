# SA6 红灯契约 R2 增补 — Issue #154：T-A9 字节预算独立达标（SA4 P1 盲点补钉）

- **Worktree**: `/home/wangjian/nomicore-fix-issue-154`（branch `fix/issue-154-on-docs-namespace-diagnostic-change-log`）
- **触发**：SA4 静态验尸发现测试盲点（P1）——SA2 §9 的字节前沿用例（T-A3）在 `maxBytes` 场景下**没有**覆盖「age 新鲜 + 字节超预算」的组合：非零 `maxAge`（组未过期）时，P2 字节遍历是否仍会独立删除最老合格闭组以满足预算。该组合是「age/bytes 两限制各自独立生效、不互相门控」契约的核心（SA2 §4.5 P2 无年龄门 + §5 INV-10/§12-AT12 的保守面）。
- **本增补范围**：仅新增 1 条聚焦契约测试 T-A9；零生产代码改动、零既有测试削弱（既有 426 测试逐字未动，见 §3 断言基数）。

---

## 1. 新增内容（精确位置）

**文件**：`packages/namespace-diagnostic-log/test/file-adapter-retention.test.ts`
**插入点**：T-A describe 块末尾（T-A8 之后，第 294–335 行）
**测试**：`T-A9 [红灯] 字节预算独立达标：非零 maxAge + 新鲜组 + maxBytes < total ⇒ 删最老合格闭组至 ≤；开组原样；保留历史如实`

契约拆解（逐条可观测断言，全部锚定运行时产物）：
1. **新鲜度证明（P1 零动作）**：`maxAgeMs: 2_592_000_000`（非 null、非 0）+ 全部 record `observedAt = T0`，`sweepRetention({ now: T0 + 1000 })` ⇒ `deletedGroups === 0`（组龄 1000 ≪ 30d）——同时证明默认 1 GiB 字节上限不触发 P2。
2. **字节预算独立达标（P2 以 closed ∧ unleased 为门，无年龄门）**：`maxBytesPerNamespace = total − 1`，同一批量数据重扫 ⇒ `deletedGroups === 1` 且 `reclaimedBytes === g1`（恰最老合格闭组 = 段 1；`total − g1 ≤ total − 1` ⇒ 恰 1 组，不多删）。
3. **开组保护**：磁盘段集恰为 `[00000002.bin, 00000002.jsonl, 00000003.bin, 00000003.jsonl]`——段 2（闭组、预算已达标）与段 3（开组）均原样；`orphanBinsDeleted === 0`。
4. **保留历史报告**：`earliestRetained === [{ streamId, sequence: '2' }]`（扫描重建：幸存最早 = 段 2 首条）；`historyTrimmedStreams` 含该 streamId；`retainedBytes === g2 + g3 ≤ total − 1`（诚实下限）。

---

## 2. 时序事实（SA4 R2 勘误修正版）

| 事件 | 提交/时刻 | 说明 |
|---|---|---|
| 初始红灯基线（SA6 第一轮） | HEAD `722bddf`（PR #166/#153 之后） | 45 测试全红：运行时 TypeError（`sweepRetention`/`openDiagnosticReadSession`/`deleteNamespaceDiagnosticLog` 缺失）+ tsc 49 errors |
| **SA3 第一轮实现落盘** | HEAD `c0f6cbc` `feat(namespace-diagnostic-log): retention, read-session leases, and namespace logical deletion (#154)` | 实现 + 既有 45 条红灯测试一并合入（commit stat：src/adapters/file.ts +563、src/read-session.ts +232、src/retention.ts +109、src/reader.ts +117、src/health.ts +24、src/index.ts +13；test 五文件 + helpers +97）——首轮套件随即全绿（27 files / 426 tests，**T-A9 尚不存在**） |
| **SA4 盲点发现** | 针对 `c0f6cbc` 审查 | P1 盲点：T-A4/T-A5 之后缺「age 新鲜 + 字节超预算」组合用例。**事实核对：`c0f6cbc` 的 P2 字节遍历仍以年龄新鲜度为门**——`c0f6cbc:src/adapters/file.ts:1274` 原文：`if (maxAgeMs !== null && !groupAgeExpired(stream.segmentsDir, segment, now - maxAgeMs, report)) break`（字节预算与年龄上限互相门控——SA4 判定的耦合缺陷） |
| **SA4 R1 修复落盘** | HEAD `385a376` `fix(namespace-diagnostic-log): P2 byte sweep must not gate on age freshness (SA4 R1 #154)` | 删除上述 P2 年龄门并新增 SA4 R1 裁决注释（385a376 起 `src/adapters/file.ts:1235-1238` / `:1276-1277`）——**T-A9 在此之后为绿** |
| **T-A9 测试钉死落盘** | HEAD `739a24b` `test(namespace-diagnostic-log): pin byte-budget independence from age (T-A9, SA4 R1 #154)`（当前 HEAD） | T-A9 契约测试随 SA3/SA4 R2 轮提交钉死 |

**时序结论（勘误）**：本报告初版把「T-A9 首次运行即绿」**误归因于 `c0f6cbc`**——SA4 R2 勘误正确：**T-A9 在 `c0f6cbc` 上为红、在 `385a376`（SA4 R1 修复）之后为绿**。勘误原因：SA6 R2 会话观察/实测时，worktree 已推进到含 `385a376` 的状态（会话起始 `git log` 快照仍显示 `c0f6cbc`，但实际执行的代码与所读 `file.ts` 已含 SA4 R1 裁决注释——worktree 在会话期间被推进），故「首次运行即绿」的执行前提是**修复后代码**；绿跑输出本身真实，但归因提交错误。

**红→绿机制（精确）**：T-A9 场景 = 非零非 null `maxAgeMs` + 全新鲜组（observedAt=T0、age=1000ms）+ `maxBytesPerNamespace=total−1`。
- `c0f6cbc`：P2 遍历对首个**未过期**闭组（段1）执行 `!groupAgeExpired(...) → break` → `progressed=false` → while 退出 → `deletedGroups=0` → T-A9 的 `expect(report.deletedGroups).toBe(1)` 失败 → **红**。
- `385a376`：移除 P2 年龄门（候选序不变，仍 closed ∧ unleased 为门 + 前缀纪律）→ 删除段1 使 `total ≤ maxBytes` → `deletedGroups=1`、`reclaimedBytes=g1`、开组原样、`earliestRetained=[{streamId,sequence:'2'}]` → **绿**。
- 反事实链：`722bddf`（实现前）红（`sweepRetention` 缺失 TypeError）；`c0f6cbc` 红（年龄门耦合缺陷，本盲点）；`385a376` 起绿。

---

## 3. 绿验证证据（命令 + 输出摘要）

### 3.1 聚焦运行（T-A9 单测）

```bash
$ npx vitest run packages/namespace-diagnostic-log/test/file-adapter-retention.test.ts -t "T-A9"
# ✓ packages/namespace-diagnostic-log/test/file-adapter-retention.test.ts (16 tests | 15 skipped) 43ms
# Test Files  1 passed (1)
#      Tests  1 passed | 15 skipped (16)
# Type Errors  no errors
```

### 3.2 全包套件（零回归确认）

```bash
$ npx vitest run packages/namespace-diagnostic-log/
# Test Files  27 passed (27)
#      Tests  427 passed (427)     # 381 既有 + 45 首轮 + 1（T-A9）— 无一削弱
# Type Errors  no errors
```

### 3.3 类型面（提议 API 全收敛）

```bash
$ npx tsc -p packages/namespace-diagnostic-log/tsconfig.json; echo $?
# 0（零错误——与首轮 49 errors 对比：全部 TS2305/TS2339/TS7006 已随 SA3 实现消除）
```

### 3.4 结论

- **T-A9 契约 = SA4 R1 裁决的行为面；红绿边界：`c0f6cbc` → 红（P2 年龄门：`c0f6cbc:src/adapters/file.ts:1274` 令新鲜闭组止步 ⇒ `deletedGroups=0`），`385a376`（SA4 R1 修复：移除 P2 年龄门）→ 绿**。§3.1–§3.3 的输出为本轮实测（当时 worktree 已含 `385a376`；当前 HEAD `739a24b` 复核亦 1 passed | 15 skipped）——绿跑真实，但初版报告将其归因于 `c0f6cbc` 属事实错误（见 §2 勘误）。
- T-A9 将「字节预算不得被年龄新鲜度门控」永久钉死：若后续把 P2 恢复为「年龄未过期不删」（双重执法），`deletedGroups === 1`（期望）将变 0 → 立即红（这正是 `c0f6cbc → 385a376` 的缺陷回归面）。
- 无生产代码改动：`385a376`（SA4 R1 修复）与 `739a24b`（T-A9 测试钉死）均非本 SA6 提交；本 SA6 仅新增 T-A9 测试与报告文件。

---

## 4. 面向 SA3/SA4 的说明

- 若后续任何人把 P2 恢复为「年龄未过期不删」（双重执法），T-A9 的 `deletedGroups === 1`（期望）将变成 0 → 立即红——这正是本盲点契约的守护值。
- T-A9 与 T-A3 的关系：T-A3 用 `maxAgeMs: null`（关年龄门）测字节边界；T-A9 用**非零非 null 的 maxAge + 新鲜组**测同一 P2 路径——两者互补，覆盖「年龄门关闭」与「年龄门开启但未命中」两种形态。
