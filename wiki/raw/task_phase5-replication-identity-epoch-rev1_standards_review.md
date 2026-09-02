# Standards Review（工程标准轴）— Phase 5 replication identity/epoch 修订轮（issue #132，round 2）

- **审查人**：独立代码审查员（标准轴，通用 subagent 终审）
- **审查对象**：`git diff 3841aff..HEAD`（HEAD = `040c3d6`；含实现 commit `ace6f83` 与 7 个 wiki 档案 commit）
- **基准**：ADR 0006/0008/0009/0010、CONTEXT.md、round-1 既有实现与档案（3841aff 封口态）
- **审查性质**：只读审查，未修改任何文件

## 审查范围与方法

**范围**：14 个变更文件——实现 `packages/namespace-runtime/src/replication-write.ts`（共享 gate 提取）、测试两文件（`runtime-replication-write.test.ts` +275 行 / `registry-phase5-replication-red.test.ts` +139 行）、规范文档（ADR 0008 增补节、phase-5 Slice 1/场景 15）、版本 bump（runtime 0.1.8→0.1.9）、wiki/raw rev1 档案 8 件。

**方法**（全部可复核）：
1. 逐行比对 `3841aff..HEAD` 全量 diff，重点对共享 gate 与 diff 中删除的基线双槽 E1/E2 逐字节比对；
2. 对照规范原文核验纪律保持（ADR 0008:14/36/45/95、修订节 127–137；ADR 0010:41–57/115–121；ADR 0006:33–34/188–195；ADR 0009:89–91；CONTEXT.md:117–127）；
3. 独立复跑：`pnpm exec vitest run <两目标文件> --typecheck` 连续两遍（均 30/30 绿、Type Errors 0）；全量 `pnpm test`（126 文件 1485/1485 绿、Type Errors 0，exit 0）；`git diff --check` 分范围复核（`757bcd1..ace6f83` exit 0；`3841aff..HEAD` exit 2）；
4. wiki 档案与 `git log --format='%h %ci %s'`、REPORT.md、设计/SA2/SA4/SA7 档案交叉一致性核对。

---

## 分项核验（基准 → 证据）

### ① ADR 0006/0008/0009/0010 与 CONTEXT.md 纪律保持 —— 通过

- **FIFO 槽序**：共享 gate 保持 E1 fatal → E2 getStatus → non-ready → notifier 的既有短路序（`replication-write.ts:140-184`），双槽在 E3/E4 前调用（:258-267 / :368-373）；E5 单事务（:326-330 / :397-399）、E5.5 同步投影（:341 / :405-409）、E6 同槽 `await notifyDirty()`（:344-355 / :412-422）逐位不变，与 ADR 0008:45 槽序及修订节条款 4（:134）一致；四写方法共享同一 `WriteSequencer` 实例（`runtime.ts:291/301/311/318`）。
- **committed/fatal 通道**：E2 getStatus throw → 同步 `markWriteFatal(env, err, 'replication')`（:155）+ 构造 `RuntimeWriteFatalError('write-slot-internal', false, writeFatalMessage('replication',…), cause 条件同上)`（:158-163）后由 async 槽 throw（:264/:370）——与基线 `return rejectWithWriteFatal(env, false, 'write-slot-internal', err, 'replication')` 的同步置位时序、构造参数、rejection 结算通道逐项等价（`write.ts:211-232`，committed:false 分支零 notifier）；E4 损坏 committed:false（:308/:380）、E5 未知异常保守 committed:true（:335/:401）、E6 notify 失败 committed:true 不回滚（:348-354/:415-421）均未触碰。
- **dirty-not-durable**：无任何 durable 过度承诺；文档（ADR 0008 条款 6 :136；phase-5 :57、:172）与测试（双字段 `waitDurableSnapshot` 后才 dispose/restart，registry 测试 :886-890；committed-not-durable 用例 B :710-797 以 `stub.loadCalls`/`saveEvents` 为空断言排除失败 notifier persistence 充当 durable 前提，:794-795）三处互相一致。
- **稳定码/message 单一来源**：`refusalOf` 仅委托 `write.ts disabled()`（:190-192 → `write.ts:174-182`），零 message 模板复制；fatal 文案经 `writeFatalMessage` 单源（`write.ts:238-244`）；E1 fatal 字面量在本模块由 2 份减为 1 份；errors.ts 本轮零改动（append-only 注册表完整）。
- **两态 status 诚实性**：构造期 V2.5 未改（`runtime.ts:203-208`），`status.replication` 仍恰两态（`replication-write.ts:66-68`），无第三态/网络态混入（CONTEXT.md:127 边界保持）。
- **零输入访问**：gate 只收 `env`（:140），不接收不读取 caller input；公共接纳门零读 input（`runtime.ts:303-319`）；enable 敌意输入在各拒绝路径读取计数 = 0、成功路径恰 = 1（测试锚定，见③）。

### ② 共享 gate 提取的行为等价性与代码质量 —— 通过

- **短路顺序/稳定文案逐字节等价**：E1 fatal 字面量、non-ready 模板、notifyDirty 未绑定双行字面量与 diff 删除行逐字节一致（:145/:169-171/:177-180 对比 `git diff` 删除块）。
- **结算通道等价**：`throw gate.result`（async 槽内）与基线 rejected helper 领养在消费面同为 promise rejection，错误对象构造参数全同（含 `err === undefined ? undefined : { cause: err }` 处理，:162）。
- **单读捕获语义保持**：notifier 的 undefined 检查 + 捕获读法与基线相同（:174-183）；gate-ready 后槽体零再读 `env.notifyDirty`。
- **cast 安全性**：`refusalOf` 的 cast（:191）是从 `MutateRootResult` 向其 `ok:false` 成员所在的拒绝子集的静态窄化；`disabled()` 实现恒返回 ok:false 形状（`write.ts:175-181`），ok:true 结构性不可达，运行时零分支；vitest `--typecheck` 0 errors 佐证 cast 合法。
- **零公共面扩散**：`runReplicationWriteGate`/三个 gate 类型/`refusalOf` 均未导出（:110-123/:140/:190）；`index.ts` 不在 diff；模块头注释声明（:13-14）属实。
- 与设计 §5.2 的 R2 条件一致：helper 入口无关、不把两公共结果联合混成自身返回类型。

### ③ 两个新测试文件的断言质量与确定性 —— 通过

- **断言质量（gate 等价性 5 例，`runtime-replication-write.test.ts:418-617`）**：走公共入口（`enableReplication`/`bumpReplicationEpoch`）而非私有名（满足 SA2 R2 条件 4）；精确计数增量断言（getStatus 恰 1/0 次、notifier 0/1 次）、敌意 Proxy 读取计数（0 或恰 1）、META 零写断言、branded error 的 class+phase+committed 三元组、稳定码子串；成功路径以通知时刻 META 快照证明「E5 提交后才通知」（:570-571 区域）。
- **断言质量（AC-6 补全 2 例，registry 测试 :710-797 / :853-902）**：用例 B 严格落实 SA2 T1 五步因果锚定（rejection 后才从同一 live Y.Doc encode/clone、clone 前后双断言 id0/2、新 Registry 仅从 seed open、失败 notifier persistence 不充当前提）；用例 A 双字段 durable wait 后才 dispose/restart，不以 scheduler advance 或 saveDoc resolve 伪作 durable。
- **确定性**：零 real-sleep；FIXED_MS 时钟 + 计数 CSPRNG + `createTestScheduler` 假时间；File 用例走 issue #108 正式耐久等待 `waitDurableSnapshot`（有界 25ms/5s 轮询磁盘 committed 快照，超时响亮失败，`durable-snapshot-wait.ts:32/40-62`）；本审查员独立连跑两遍目标文件均 30/30 绿、全量 1485/1485 绿，未见 flake 面。
- **增量纪律**：registry 测试 +139/−0，既有断言零改动（设计 §4.1 要求落实）。

### ④ 文档修订准确性与内部一致性 —— 通过

- ADR 0008 修订节（:127-137）：授权链逐字在案（issue #132 / PR #145 feedback 1 / owner `welltop-jim-wang` / 2026-08-27，:129，与任务简报 :11 及 conflict 报告的 gh 核验一致）；条款 2 的两态/损坏枚举与 `readReplicationFacts` 四出口实现（`replication-write.ts:213-240`）及 Registry 收编 `NamespaceRegistryFatalError('open','runtime-construction',false)`（`registry.ts:914-918`）一致；条款 3「原第 14 行保持不变」引用准确（:14 原文核对）；条款 4「v1 公开两个窄方法」引用准确（:36）；条款 5 status 列举「第 95 行」引用准确（:95）；条款 6/7 与 ADR 0006:33、ADR 0010:46-53/120 一致。沿用本仓 append-only 增补节惯例（:113-125 先例）。
- phase-5 文档：Slice 1 合同五条（:52-58）与实现逐条对应（原子安装 epoch 1、MAX 拒升不回绕、两态 status、构造期窄例外、dirty-not-durable、非目标排除）；场景 15 拆 15a/15b（:172-173）与本轮测试范围精确一致，fatal 仅表述 committed-state recovery，无 durable restart 承诺。
- 内部一致性：设计 §2.3 七点与 ADR 增补节条款 1–7 一一对应；SA2 R2 四条实施门禁（sa2_review.md:77-80）均有落地证据。

### ⑤ 版本 bump 惯例 —— 通过

runtime 0.1.8→0.1.9（本包 src 有改动：gate 提取），registry 未 bump（仅 test 变更）——符合 round-1 设计落盘的仓库惯例注记（`task_phase5-replication-identity-epoch_design.md:723-731`：公共面/源码变更随 PR bump patch 位，7425164/6472485/5db6f83 同型先例；round-1 8113083 双包 bump、本轮 test-only 包不 bump，方向一致）。

### ⑥ wiki/raw 档案完整性与 dispatch log 一致性 —— 通过（两项记录准确性发现见下）

- 档案齐套：简报、design、design_conflict_report（SA8 R1+R2 合并）、sa2_review（R1+R2）、sa4_review、sa7_report、ac_checklist、dispatch 共 8 件 rev1 新档；SA5/SA6 省略在简报 :9 与 dispatch :3 明文声明且一致执行（无 sa6_red 档，亦无伪称）；round-1 历史档案零改动（diff 全为新增）。
- dispatch 阶段顺序与 `git log` commit 顺序完全一致（SA1→SA8→SA2 R1→SA1 R2→SA2 R2→SA3→亲验→SA4→SA7→AC→终审 pending）；SA4 审查范围记录（`757bcd1..ace6f83`）与其报告头一致；AC 清单反馈映射 4/4 与 diff 证据相符；终审计数链 1478+7=1485 经本审查员全量复跑证实。

---

## 发现清单

| # | 严重度 | 位置 | 发现 | 依据 |
|---|---|---|---|---|
| S-1 | **non-blocking** | `wiki/raw/task_phase5-replication-identity-epoch-rev1_sa2_review.md:3`、`_sa4_review.md:3-4`、`_sa7_report.md:109`（HEAD 提交态）；记录处 `..._ac_checklist.md:6` | **门禁记录与全范围复核不一致**：AC 清单 :6 记「`git diff --check` exit 0」，但终审范围 `3841aff..HEAD`（dispatch :12 同款范围）实测 **exit 2**——上述 3 个 wiki 证据文件共 4 处行尾双空格（markdown 硬换行符）。子范围可复现：代码范围 `757bcd1..ace6f83` exit 0（SA4 :91 记录属实），空格由 wiki 簿记 commit 引入（`3841aff..757bcd1` 即已 exit 2）。round-1 全范围（`7425164..3841aff`）exit 0，故本仓惯例是全范围净白。影响面：仅 wiki 历史证据文件，零代码/规范文档影响；且工作区当前已存在未提交的精确修复（4 处剥离，`git diff -- wiki/` 仅空白差异）。处置建议：收口 commit 纳入该剥离，并在 AC 清单补一行范围注记（记录当时实际检查范围）。 | 本审查员复跑：`git diff --check 3841aff..HEAD` → 4 hits, exit 2；`git diff --check 757bcd1 ace6f83` → exit 0；`git diff --check 7425164..3841aff` → exit 0 |
| S-2 | **non-blocking** | `wiki/raw/task_phase5-replication-identity-epoch-rev1_dispatch.md:8-18` | **dispatch log 绝对时间列与 commit 时间戳系统性不一致**（顺序完全一致）：如第 7 行 SA3 窗口 23:27–23:55，而 `ace6f83` commit 于 23:23:04（先于派发时刻）；第 9–11 行窗口（00:05→00:31）均晚于对应 commit（23:41:14/23:47:33/23:49:20）24–42 分钟，偏移随时间增大，疑为事后凭记重排。阶段顺序、决策逻辑、verdict 与 git 历史及各档案交叉一致，仅绝对时刻不可作证据。处置建议：补一句「时刻为约记」注记或按 commit 时间校准。 | `git log --format='%h %ci %s' 3841aff..HEAD` 对照 dispatch 表格逐行 |
| S-3 | **non-blocking**（观察项） | 工作区 `REPORT.md`（未提交改动） | 当前工作区 REPORT.md 仍为 round-1 内容（frontmatter `round: 1`，run_id 已为本轮 `issue-132-1787809226-3529662`），round-2 收口更新尚未落笔——与 dispatch :12「终审 (pending)」的中间态一致，属预期；提请 Runner 在完成事务校验时以「round-2 更新后的 REPORT.md frontmatter（status/round/run_id/branch）」为准。 | `git diff REPORT.md`（round-1 内容覆盖 #131 版）；SA7 报告 :114「预存的 REPORT.md 修改未被 SA7 触碰」 |
| S-4 | **non-blocking**（枝节） | `wiki/raw/task_phase5-replication-identity-epoch-rev1_sa4_review.md:55` | SA4 引用新测试块为 `runtime-replication-write.test.ts:345-618`，实际文件 617 行（新增 describe :418-617）；引用 off-by-one，不影响其 verdict 的任何实质内容。 | `wc -l` = 617；`grep -n` 实测边界 |

**blocking 发现：0。**

## 独立复跑证据（本审查员亲跑，非转述）

```text
pnpm exec vitest run packages/namespace-runtime/test/runtime-replication-write.test.ts \
  packages/namespace-registry/test/registry-phase5-replication-red.test.ts --typecheck
  第 1 遍：Test Files 2 passed (2)；Tests 30 passed (30)；Type Errors no errors
  第 2 遍：同上（flake 抽查）

pnpm test（全量）
  Test Files 126 passed (126)；Tests 1485 passed (1485)；Type Errors no errors；exit 0
  —— 与 AC 清单 :6 / SA7 :14-20 记录完全一致

git diff --check：757bcd1..ace6f83 exit 0；3841aff..HEAD exit 2（4 处 wiki 行尾空格，见 S-1）
```

## Conclusion

**clear**

六项章程维度全部核验通过，实现与文档在 FIFO 槽序、committed/fatal 双通道、dirty-not-durable、稳定码/message 单一来源、两态 status 诚实性上零退化；共享 gate 提取与基线逐字节等价且零公共面扩散；两测试文件断言精确、机制确定、durable wait 纪律落实；版本 bump 合规；档案齐套且顺序可交叉印证。四项发现均为 non-blocking 的记录准确性/簿记事项（S-1 已有在途修复），不构成收口阻塞；建议总控在收口 commit 一并落实 S-1/S-2 的注记级处置。
