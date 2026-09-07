# SA4 实现审查报告 — Issue #228（Host namespace 数据删除 ⇄ 诊断日志逻辑删除联动）

> 本文件含五轮报告：**iteration 4**（F-11/F-12 勘误落树收口核验，verdict=**approve**——
> 五文件测试稳定性面/既往复现事实/fresh 证据三面全部如实落文，零生产/零验收弱化）
> + **iteration 3**（F-11/F-12 勘误回落核验，verdict=**reject**——
> 勘误未落树，REPORT.md 自 iteration 2 驳回后零改动；AC4/四门证据本轮再次独立复算全部成立）
> + **iteration 2**（SA10 reject 后收尾轮 post-remediation 复审，verdict=**reject**——
> 仅 REPORT 勘误级修订，实现/测试/四门证据全部独立证实；`requiresConflictRecheck: false`）
> + **iteration 1**（条件闭合复审，verdict=**approve**）
> + **iteration 0**（R0 静态验尸 + A/B 实验，F-1~F-7 出处，完整保留于文末
> 「── R0 档案 ──」分隔线之后）。

## iteration 4 — F-11/F-12 勘误落树收口核验（iteration 9 勘误后复审）

**Date**: 2026-09-07（UTC+8 21:40–21:55）
**Reviewer**: SA4（mabf-sa4，dispatch `sa-aaff52d1-ed5d-4471-acbd-8cd891bc62b7`，phase implementation-review，iteration 4）
**Worktree**: `/home/wangjian/nomicore-fix-issue-228`（branch `mabf/issue-228`，HEAD `6467078` 亲证未动；当前 diff = 32 M + 23 ??，与 iteration 3 同计数）
**审查对象**: SA3 iteration 9 勘误（REPORT「勘误收口」节自述 dispatch `sa-a61fe7c4-…`）对 iteration 2/3 F-11/F-12 Required revisions 的闭合状态 + 「无生产/验收测试弱化」独立复核。
**输入产物（全部亲读/亲跑）**: REPORT.md（21:36:54 版，全文 307 行）、`task_228_sa3_implementation_notes.md`（21:37:34 版 §6.1/§7）、session-red 测试文件全量 diff、全树 mtime 取证、门禁/失败日志（`/tmp/full-test-run-2.log`、`/tmp/full-test-run.log`、`/tmp/gate-full-test.log`、`/tmp/fix-check-session-red.log`、`/tmp/sa3-228/full-test-2.log`、`/tmp/sa3-228/full-test-3.log`）+ 本轮独立复跑（`/tmp/sa4-i4-session-red.log`）。
**Issue 评论输入**: 派遣简报明示 REST 已读 = `[]`，无 Owner 追加要求（评论 ID/updated_at：无）。
**边界**: 零业务代码/测试改动、零 commit/push/PR；唯一写入 = 本文件（iteration 4 节 + 卷首目录行）。

### Verdict（iteration 4）

**approve**（`requiresConflictRecheck: false`）——**F-11/F-12 勘误闭合确认，收口**。

### IV.1 落树事实（mtime 取证——本轮首要事实）

iteration 3 落笔（本文件 21:30:23）之后全树**恰有 3 个文件**被写入：

| 文件 | mtime | 内容定性（亲证） |
|---|---|---|
| `packages/namespace-registry/test/registry-phase5-replication-session-red.test.ts` | 21:36:30 | 可选建议采纳：注释块归属修正（见 IV.4） |
| `REPORT.md` | 21:36:54 | F-11/F-12 勘误 + OBS-2（见 IV.2/IV.3） |
| `wiki/raw/task_228_sa3_implementation_notes.md` | 21:37:34 | §6.1 表补两行 + §7 记录（F-11 同步项） |

其余 52 个 diff 文件 mtime 与 iteration 2/3 取证**逐一致**（生产面 09:43–10:53；README/registry.ts 纯注释 18:16；4 个边际测试文件 18:13×2/18:19/19:14）——**生产代码与 5 文件测试稳定性改动自 iteration 3 验绿后零触碰**；HEAD/diff 计数（32 M + 23 ??）零漂移。

### IV.2 F-11 闭合核验（五文件测试稳定性面如实落文）

- REPORT「收尾轮记录」item 1（L186-209）现为 **5 文件逐条清单**（SA10 §7.1 的 3 个 + 收尾轮自跑全量 run 驱动的另 2 个），每条含改动内容 + 驱动失败日志引述：
  1. `registry-phase5-replication-red`（AC-6 20s；SA4 F-7 基线 4744/5000ms、负载 6272ms）；
  2. `generate-cli-check`（3 spawn 用例 20s；SA7 5288–5557ms）；
  3. `ws-replication-sa7-issue171-real-transport`（RT-G5 wire 静默同步 + 30s）；
  4. `registry-phase5-replication-session-red`（AC-5 两 degraded 用例 20s；驱动 = 19:39 run `/tmp/sa3-228/full-test-3.log` 补锚 (a) 5427ms 超时——**本轮日志亲证**：L201 `× 补锚 (a) … 5427ms`、L507 `Test timed out in 5000ms`、`1 failed | 2983 passed (2984)`）；
  5. `diagnostic-replay-host-lifecycle-red`（E4 `signalAndExpectExit` 1.5s settle；驱动 = 19:07 run `/tmp/sa3-228/full-test-2.log` E4 `expected 143 to be +0`——本轮日志亲证 L111/L502）。
- 少报口径消除：grep 亲证 `共 3 个文件`=0、`涉及 3 个`=0、`3 个既有边际`=0；「收尾补录」节移交句同步改「共 5 个」（L174-175）。残留的「SA10 §4.1 所列 3 个边际文件」（L236）为**对 SA10 清单的准确转述**（其所列失败形态经 18:13–18:19 修复后确未再现），且紧随其后如实披露另两形态——非少报残留。
- SA3 notes §6.1 表同步补两行（含驱动日志 + `/tmp/fix-check-session-red.log` 22/22 验证引述）——亲证在场。

### IV.3 F-12 闭合核验（假性负结论更正 + fresh 证据准确）

- 原假句消除：grep 亲证 `均未见其失败`=0、`原备案所指形态未再现`=0。残留 `未再出现`（L239）属 SA10 §4.1 范畴句（见 IV.2），非原句。
- 更正后事实链（REPORT L126-134）逐环与日志对上：19:39 全量 run **实测再现**（补锚 (a) 5000ms 预算超时，5427ms）→ 19:53 两用例显式 20s（零断言改动）→ 单文件复核 22/22（`/tmp/fix-check-session-red.log` 19:53:34，22 passed 亲证）→ 20:15 全量 279/2984（`/tmp/gate-full-test.log` 亲证）→ iteration 8 终验两轮零测试失败。对齐 SA3 notes §6.3「不隐匿失败轮」自立标准。
- **fresh 验证证据抽验**（REPORT 四门表 L221-249 vs 日志）：`/tmp/full-test-run-2.log` = 279 files / 2984 tests / Type Errors no errors / 563.32s / exit=0——逐字一致；5 文件逐文件绿数据（replication-red 16/16@856ms、generate-cli 8/8@4874ms、ws-171 4/4@3618ms、session-red 22/22@1695ms、lifecycle-red 22/22@47067ms）逐字一致；首轮 RPC 噪声轮披露维持属实；OBS-2 顺手闭合（#248/#250/#251，git log 亲证）。

### IV.4 无生产/验收弱化独立复核

1. **session-red 21:36 改动 = 纯注释**：全量 diff vs HEAD 仅 3 hunk——6 行注释块（含归属修正：「SA3 收尾轮全量 run 实测……日志 /tmp/sa3-228/full-test-3.log」替换原「SA7 全量运行」误标）+ 2 处 `}, 20_000)`（19:53 已在树的时限，非本轮新增）；断言区逐字节未动。**本轮独立进程复跑**：`vitest run …session-red --typecheck` = **exit 0、22/22 passed、Type Errors no errors**（`/tmp/sa4-i4-session-red.log`）——注释改动零行为佐证。
2. **全 diff 不变量复验**：全部改动+新增测试文件 grep `.skip/.only/.todo/.fails/skip:true` = **零命中**；`vitest.config.ts`/`package.json`/`pnpm-lock.yaml`/`.github/` 对 HEAD **零 diff**（触发面无操纵）；`git diff HEAD --check` **clean（exit 0，本轮自跑）**。
3. **四门有效性延续**：iteration 3 已在含全部 5 处测试稳定性改动的当前树亲跑四门全绿（`pnpm test` 566.56s exit 0、279/2984）；其后唯一 delta = REPORT 文本 + notes 文本 + session-red 注释（本轮已单独复跑绿）——四门证据对当前树持续有效，无需重跑（与 iteration 3 收口承诺一致）。

### IV.5 结论（iteration 4）

iteration 2/3 的两项 MAJOR（F-11 五文件披露面、F-12 假性负结论）**均已以可复核证据闭合**：勘误后的 REPORT 准确记录五文件测试稳定性面（含各自驱动失败轮）、既往复现事实（19:07 E4 143 / 19:39 补锚 (a) 5427ms）与 fresh 四门证据（逐字与日志一致）；生产代码与验收测试零弱化（唯一测试文件触碰为注释归属修正，独立复跑 22/22 绿）。SA4 对 issue #228 当前 diff 的最终立场：**approve**。剩余事项均为已登记的发布侧 runner 待办（PR #142/#141 同步、push 后 CI 核验）与 F-9/F-10 观察项备案，不属本 worktree 执行面。

---

## iteration 3 — F-11/F-12 勘误回落核验（post-remediation 复审）

**Date**: 2026-09-07（UTC）
**Reviewer**: SA4（mabf-sa4，dispatch `sa-6abee59f-6875-4e87-ac5a-6fb344d7b972`，phase implementation-review，iteration 3）
**Worktree**: `/home/wangjian/nomicore-fix-issue-228`（branch `mabf/issue-228`，HEAD `6467078`，全部改动未提交；当前 diff = 32 M + 23 ??）
**审查对象**: iteration 2 reject（F-11/F-12）后的当前 post-remediation diff：(a) AC4 测试稳定性改动是否弱化/跳过测试 + fresh 全量证据核验；(b) AC5 REPORT.md 对 issue 正文与上游证据的准确性/完整性。
**输入产物（全部亲读）**: issue #228 正文（`gh issue view 228`：OPEN、5 AC、0 评论）、本文件 iteration 2 节、`task_228_sa10_spec.md`、`task_228_sa7_report.md`（§5/§5.2）、REPORT.md、`task_228_sa3_implementation_notes.md`、当前全量 diff（逐 hunk）、全部门禁与失败日志（`/tmp/sa3-228/full-test{,-2,-3}.log`、`/tmp/{gate-full-test,full-test-run,full-test-run-2,typecheck-run,generate-check-run,fix-check-session-red}.log`、`/tmp/sa7-228/*`、`/tmp/sa4-r2-gates.log`）、GitHub 上游证据（PR #142/#141、PR #156/#159/#166/#167/#194/#196/#200/#223/#248/#251 逐一 `gh` 亲证）。
**Issue 评论输入**: 派遣简报明示 REST 已读 = `[]`，无 Owner 追加要求（评论 ID/updated_at：无）。
**边界**: 零业务代码/测试改动、零 commit/push/PR；唯一写入 = 本文件（iteration 3 节）。本轮四门独立复跑：`pnpm test`（21:16:39 起，566.56s）+ typecheck/generate-check/diff-check。

### Verdict（iteration 3）

**reject**（`requiresConflictRecheck: false`）——**窄域维持驳回：F-11/F-12 勘误未落树**。

- **落树核验（本轮首要事实）**：`REPORT.md` mtime = **20:54:09**，早于本文件 iteration 2
  驳回落笔（21:14:19）——**SA4 iteration 2 之后 REPORT.md 零写入**；grep 全文：无
  「5 个/5 文件」清单、无 `diagnostic-replay-host-lifecycle-red` 收尾轮披露、无 19:07/19:39
  失败轮引述；L127-129 的 session-red 断言（「SA7 全量 run（22/22 绿）与本收尾轮全量 run
  均未见其失败，原备案所指形态未再现」）**原文在场、未修订**。即：本轮被审的
  post-remediation diff 中**不存在对上次驳回的任何修复**。
- **F-12 证伪证据本轮再次第一手复核**（非转述 iteration 2）：`/tmp/sa3-228/full-test-3.log`
  （SA3 收尾轮 run，Start at 19:39）= `补锚 (a)` **`Test timed out in 5000ms`（5427ms）**、
  `1 failed | 2983 passed (2984)`、`FULL_TEST_EXIT=1`——「本收尾轮全量 run 均未见其失败」
  为**假性负结论**；同目录 `full-test-2.log`（19:07）= E4 `expected 143 to be +0`、
  exit 1——两处未披露测试稳定性改动的真实驱动轮。测试内注释「SA7 全量运行 2026-09-07
  19:39」归属仍误标（该 run 是 SA3 收尾轮自身 run，日志在 `/tmp/sa3-228/` 而非
  `/tmp/sa7-228/`）。
- **AC4 方向本轮独立复算再次全部成立**（不弱化/不跳过 + 四门绿）：
  - 5 个测试稳定性文件逐 hunk复审：7 处显式 per-test timeout（6×20s + RT-G5 30s）、
    1 处 RT-G5 wire 静默同步（UPDATE_ACK ≥ 已发 UPDATE 才注入——消除注入帧与在途 ACK
    同序列竞速，**反更确定**）、1 处 `signalAndExpectExit` SIGTERM 前 1.5s 有界 settle
    （`waitForExit` 有界窗与 exit-code 断言不变）；全 diff grep **零 `.skip/.only/.todo/
    .fails`**、零断言删改（仅有的 2 处「删除 expect 行」= surface 守卫演化：registry 实例
    六面→七面（deleteNamespace 入 required 锚 + 禁词表**加** evictNamespace/
    forceCloseNamespace）、deleteDoc 由禁词表翻转为 required 受管 seam——ADR-0006/0009
    修订节法定演化，非弱化）；测试总数 2984 在修复前后各轮**逐位不变**（零删除）；
    `vitest.config.ts`/`package.json`/`pnpm-lock.yaml`/`.github/` 对 HEAD **零 diff**
    （触发面无操纵）。
  - **四门本轮亲跑全绿**：`pnpm test` **exit 0：279 files / 2984 tests passed、Type Errors
    no errors、566.56s**（21:16 起）——与 REPORT 四门表（279/2984/563.32s）及
    `/tmp/full-test-run-2.log`、`/tmp/sa4-r2-gates.log` 三方一致；`pnpm typecheck` exit 0、
    `pnpm generate --check` exit 0、`git diff HEAD --check` clean（本轮自跑）。
    时限放宽均有实测驱动（AC-6：12:57 run 6272ms + 11:22 run 5394ms 超时 + 基线空载
    4744/5000ms；codegen spawn：5288–5557ms；session-red：19:39 run 5427ms；E4：19:07
    run 143）——非掩盖性放宽。
- **AC5 结构性项目维持达标**（本轮复核）：PR #142 阶段汇总表 15 行证据路径全部在场；
  #148/#151/#152/#153/#154 verdict、#226 260/2869、#227 2917/2917 与上游档案吻合；
  PR #142（OPEN、`docs: specify namespace diagnostic change log`）、issue #141（OPEN）、
  #156/#159/#166/#167/#194/#196/#200/#223 全 MERGED（gh 亲证）；M4 已按 F-3 改述；
  M-1/M-2 纯注释收尾已落树（diff 亲证）；发布侧 runner 待办如实披露。

### Required revisions（iteration 3——与 iteration 2 F-11/F-12 同单，零代码/零测试代价）

1. **REPORT「收尾轮记录」item 1 改述为 5 文件清单**：补 `registry-phase5-replication-session-red`
   （AC-5 两用例 20s，引 19:39 run `/tmp/sa3-228/full-test-3.log` 5427ms 超时）与
   `diagnostic-replay-host-lifecycle-red`（`signalAndExpectExit` SIGTERM settle 1.5s，引
   19:07 run `/tmp/sa3-228/full-test-2.log` E4 得 143；D4/M-6 同族先例）；消除「3 个既有
   边际测试文件」少报表述。
2. **REPORT L127-129 session-red 注记更正**：两条 AC-5 degraded 用例在收尾轮 19:39 全量
   run 实测超时失败（非「均未见其失败/未再现」），20s 预算落地后 19:53/20:23/20:42 各轮
   22/22 绿——按 SA3 notes §6.3 自立标准「不隐匿失败轮」如实披露。
3. **可选（注释归属）**：session-red 文件内「SA7 全量运行 2026-09-07 19:39」改为「SA3
   收尾轮全量 run（/tmp/sa3-228/full-test-3.log）」；零行为。
4. **回流目标**：SA3（REPORT 勘误；worktree 可执行）。无 SA1/SA6/SA7 路由需求（无设计/
   契约/行为变更）。

### III.1 结论（iteration 3）

AC4 的两个审问（不弱化/不跳过、fresh 全量证据）经本轮**第三次独立复算**仍然全部成立
（逐 hunk + 四门亲跑 exit 0）；驳回点唯一且未变：**F-11/F-12 的 REPORT 勘误没有落树**
——worktree 中 REPORT.md 仍是 iteration 2 驳回时的 20:54 版本，被证伪的「未再现」断言
原文在场。修复代价 = REPORT 一段勘误 + 可选一处测试注释归属修正，零代码/零测试改动；
落树后 SA4 仅需 grep 复核（两文件名在场 + 断言更正）即可收口，无需重跑四门（本轮已在
含全部 5 处测试稳定性改动的当前树上验绿）。

---

## iteration 2 — SA10 reject 收敛复审（AC4 测试稳定性改动 × 四门终验独立复算 × AC5 REPORT 准确性）

**Date**: 2026-09-07（UTC）
**Reviewer**: SA4（mabf-sa4，dispatch `sa-4aefbab3-f92e-4b1b-b30b-a62bd6d898f4`，phase implementation-review，iteration 2）
**Worktree**: `/home/wangjian/nomicore-fix-issue-228`（branch `mabf/issue-228`，HEAD `6467078`，全部改动未提交；当前 diff = 32 M + 23 ??）
**审查对象**: SA3 iteration 5+8 收敛交付（SA10 reject 后）：(a) AC4 测试稳定性改动是否弱化/跳过测试；(b) iteration 8 四门终验 fresh 证据的独立复算；(c) AC5 REPORT.md 对 issue 正文与上游证据的准确性/完整性；(d) 实现/文档面回归复核。
**输入产物（全部亲读）**: `task_228_sa10_spec.md`（reject + §7 收敛清单）、`task_228_sa7_report.md`（§5/§5.2）、`task_228_sa3_implementation_notes.md`（§6 iteration 8 终验记录）、REPORT.md（20:54 定稿版）、issue #228 正文（`gh issue view 228` 亲读：OPEN、5 AC）、issue #141（OPEN 亲证）、PR #142（OPEN、title `docs: specify namespace diagnostic change log` 亲证）、当前全量 diff（逐文件）、全部门禁日志（`/tmp/typecheck-run.log`、`/tmp/generate-check-run.log`、`/tmp/full-test-run.log`、`/tmp/full-test-run-2.log`、`/tmp/gate-full-test.log`、`/tmp/sa3-228/full-test{,-2,-3}.log`、`/tmp/fix-check-session-red.log`、`/tmp/sa7-228/*`）。
**Issue 评论输入**: 派遣简报明示 REST 已读 = `[]`，无 Owner 追加要求（评论 ID/updated_at：无）。
**边界**: 零业务代码/测试改动、零 commit/push/PR；唯一写入 = 本文件。独立复算使用一次性前台/后台命令（`/tmp/sa4-r2-gates.log`）。

### Verdict（iteration 2）

**reject**（`requiresConflictRecheck: false`）——**窄域驳回：仅 AC5 REPORT 勘误级修订，零代码/零测试/零断言改动要求**。

- **AC4 实质全部证实**：收尾轮全部测试稳定性改动（实为 **5** 个文件，见 F-11）逐 hunk 亲证——只放预算（7 处显式 per-test timeout：6×20s + 1×30s）、1 处 wire 静默同步（RT-G5）、1 处 SIGTERM 有界 settle（E4）；**零 skip/only/todo/fails、零断言改动、零生产行为改动**（README/registry.ts 收尾轮写入均纯注释：M-1/M-2 亲证）。
- **四门终验独立复算全绿（本轮亲跑，非转述）**：`pnpm typecheck` exit 0；`pnpm generate --check` exit 0；`git diff HEAD --check` clean；`pnpm test` **exit 0：279 files / 2984 tests passed、Type Errors no errors、563.67s**——与 SA3 iteration 8 记录（279/2984/563.32s）逐位一致；首轮 RPC 噪声轮（exit 1、零测试失败、2 条 `Timeout calling "onTaskUpdate"`）与其日志逐字吻合、披露诚实。
- **AC5 主体达标**：PR #142/#141 阶段汇总表在场且 14 个证据路径全部存在（#226 260/2869、#227 2917/2917 抽查与上游档案吻合；#141 OPEN、PR #142 title、合入 commit #156/#159/#166/#167/#194/#196/#200/#223/#248/#251 与 `git log` 亲证一致）；M4 已按 F-3 改述且与 SA7 重点 8 实测一致；四门证据已吸收；runner 侧待办如实披露（发布侧移交节）；计数勘误（7/15、18/178）与实测一致。
- **但 REPORT.md 存在 2 项可复核的准确性缺陷（F-11/F-12，均 MAJOR）**：收尾轮测试稳定性改动面被少报（「3 个文件」，实际 5 个——`registry-phase5-replication-session-red` 与 `diagnostic-replay-host-lifecycle-red` 的改动在全报告/SA3 notes §6.1 均未披露），且验证节含一条**被收尾轮自身日志直接证伪的断言**（session-red「均未见其失败，原备案所指形态未再现」vs 19:39 全量 run 实测补锚 (a) `Test timed out in 5000ms`）。REPORT 是 AC5 交付物与本票 PR #142 发布侧素材的唯一事实载体（SA3 notes §6.4 自称「最终证据载体」；发布侧移交第 1 项「内容以本报告为素材」），假性负结论将随 PR 材料外溢。与本票 reject 史同源同类（SA10 §4.2：「REPORT 不完整/失准/陈旧」；SA3 notes §6.3 自立标准「AC5『验证证据』须属实，不隐匿失败轮」——对 20:41 RPC 噪声轮执行了该标准，对 19:07/19:39 两轮失败未执行），按评审链一致性必须回流勘误后重验。
- **本 reject 不针对实现质量**：AC1–AC3 交付面（SA10 已独立核验 + 本轮 mtime/零漂移复核：生产文件 09:43–10:53 写入后未再触碰，收尾轮仅 README/registry.ts 纯注释两处）与四门证据均无争议；修订代价 = REPORT 一段勘误 + 可选一处测试注释归属修正。

### II.1 AC4 测试稳定性改动逐 hunk 核验（不弱化/不跳过）

| 文件（收尾轮写入时刻） | 改动 | 弱化/跳过判定 |
|---|---|---|
| `packages/namespace-registry/test/registry-phase5-replication-red.test.ts`（18:13） | AC-6 `persistence-degraded` 显式 `}, 20_000)`；注释引 SA4 F-7 A/B 基线（4744/5000ms）与全量负载 6272ms | **无弱化**：仅时限参数；断言区零字符改动 |
| `packages/vfsl-codegen/test/generate-cli-check.test.ts`（18:13） | 3 个多 spawn 用例显式 `}, 20_000)`（两 describe 各注记；SA7 复跑 5288–5557ms 超时、`--test-timeout 20000` 8/8 绿） | **无弱化**：`expect(status).toBe(0/1)`、ENOENT 断言原样 |
| `packages/ws-replication/test/ws-replication-sa7-issue171-real-transport.test.ts`（18:19） | RT-G5 注入前新增 wire 静默 `waitUntil`（UPDATE_ACK ≥ 已发 UPDATE，3s 预算）+ 显式 `}, 30_000)` | **无弱化，反更确定**：消除注入帧与在途 ACK 同序列竞速（ACK_STATE_VIOLATION→'blocked' 假形态）；注入后全部断言（disconnected 先于 deadline、'draining'、订阅摘除、drain 窗口零 UPDATE、close 1001/goaway-drain、lease 终态 remaining=0、无二次释放）逐条原样在场 |
| `packages/namespace-registry/test/registry-phase5-replication-session-red.test.ts`（19:53）**——REPORT 未披露（F-11）** | AC-5 `peer persistence-degraded` 与 `补锚 (a)` 两用例显式 `}, 20_000)`；注释自引「SA7 全量运行 2026-09-07 19:39 实测补锚 (a) 超时」（归属误标，实为 SA3 收尾轮 run，见 F-12） | **无弱化**：仅时限；断言区零改动 |
| `apps/yjs-server/test/diagnostic-replay-host-lifecycle-red.test.ts`（19:14）**——REPORT 未披露（F-11）** | `signalAndExpectExit` 对 SIGTERM 先 `await sleep(1_500)`（越过 tsx wrapper ready 窗口；D4 同款先例；19:07 全量 run E4 实测 exit 143→修后绿） | **无弱化**：settle 在 kill 之前，`waitForExit(30_000)` 有界窗与 `exit code === 0` 断言不变；E1–E5/v1/v2 全部 SIGTERM 用例同受益，E3 有界停机语义不受影响 |

- 全部本票测试文件（11 个 `.test.ts` + 改动的 5 个边际文件）grep 亲证：**零 `.skip`/`.only`/`.todo`/`.fails`/`skip:true`**。
- **改动面时序取证**（mtime × 日志交叉）：18:13–18:19 三文件（SA10 §7.1 清单内）→ 18:38 全量 run 绿 → 19:07 全量 run E4 143 失败 → **19:14 E4 settle 落树** → 19:39 全量 run session-red 补锚 (a) 5000ms 超时失败 → **19:53 session-red 20s 落树 + `fix-check-session-red` 22/22 验证** → 20:15 全量 run 绿 → 20:23–20:51 iteration 8 四门 → 20:54 REPORT 定稿。终验两轮（20:41/20:51）与我的复算（下）均在含全部 5 处改动的树上执行——**证据链对当前树有效**。

### II.2 四门终验独立复算（本轮亲跑，2026-09-07 21:01–21:12，宿主空载 load 0.00）

| 门 | 本轮命令 | 本轮实测 |
|---|---|---|
| root typecheck（14 包 tsc 链） | `pnpm typecheck` | **exit 0** |
| 生成物零漂移 | `pnpm generate --check` | **exit 0** |
| whitespace 门 | `git diff HEAD --check` | **clean（exit 0）** |
| 全量测试（CI `Test` 步同入口：`vitest run --typecheck`、config `maxWorkers:1` 亲证） | `pnpm test` | **exit 0：Test Files 279 passed (279)、Tests 2984 passed (2984)、Type Errors no errors、Duration 563.67s** |

- 5 个边际文件在本轮全量 run 中全绿（replication-red 16/16@870ms、generate-cli-check 8/8@4863ms、ws-171-real-transport 4/4@3622ms、session-red 22/22@1695ms、diagnostic-replay-host-lifecycle-red 22/22@47097ms）；11 个本票测试文件全绿（与 SA7 §6 清单一致）。
- **SA3 证据日志取证**：`/tmp/full-test-run-2.log`（20:51）＝ 279/2984/exit 0/563.32s——REPORT 四门表引用属实；`/tmp/full-test-run.log`（20:41）＝ 279/2984 全过 + 2 条 worker RPC `onTaskUpdate` 超时 → exit 1——REPORT「首轮 RPC 噪声、零测试失败」披露属实；`/tmp/typecheck-run.log`（20:23，exit=0）、`/tmp/generate-check-run.log`（20:51）在场。`pnpm test`/CI 入口同参性亲证（package.json scripts + `.github/workflows/ci.yml` `Test`/`Typecheck` 步 + vitest.config.ts `maxWorkers:1`/typecheck include）。
- **SA7 §5.2 四个 CI 具名物化步骤**（`--passWithNoTests=false`）命令与 ci.yml 逐条同款、exit 0——REPORT 引用属实。

### II.3 AC5 REPORT.md 准确性/完整性核验（对 issue 正文 + 上游证据）

达标面（亲证）：

| AC5 要求（issue 正文） | REPORT 现状 | 判定 |
|---|---|---|
| 汇总 #141 / PR #142 阶段结果 | 「PR #142 阶段汇总」节：PR 定位、交付票闭环路径（8 个合入 commit + fix #248/#251 与 git log 逐一对上）、#228 = 阶段端到端验收定位、#141 行（OPEN 亲证） | ✅ |
| #148–#155、#226–#227 各票阶段结果 + 验证证据 | 8+2 行表齐全；**14 个引用证据路径全部存在**；#226 行（260/2869、RPC 噪声零失败）与 `20260906-issue-226-final-full-run.md` 吻合；#227 行（2917/2917 + typecheck 0、approve）与 `task_issue-227_rev2_sa7_report.md` 吻合 | ✅ |
| 残余风险 | M4 已按 F-3 改述（marker 门 = 同 id 重建防线；provision 恒新 CSPRNG id 2^-128；唯一现实路径 importReplica 显式同 id；SA7 重点 8 实测引用）——与 SA7 §2 #8 逐点一致；R-1/R-2/R-3/非 secure-erase 措辞红线（否定句）在场 | ✅ |
| 验证证据 | 四门表（iteration 8 实测）+ 首轮 RPC 噪声轮如实披露 + 计数勘误（semantics 7 / 两套件 15 / persistence 18 files 178 tests——与 R0 实测 176@17files + SA7 增量 doc-delete-sa7-realtime(2) 自洽） | ✅（除 F-12 一条） |
| PR title/body 与 #141 同步 | 「发布侧移交（runner 待办——如实披露，不假报完成）」节逐项列明（PR #142 增补段、#141 同步、push 后 CI 核验、git 配置残留核对——与 conflict_report L77 备案一致）；PR #142 现仍 OPEN 原状（亲证）——未假报完成 | ✅（披露式） |

缺陷面 → Required revisions（F-11/F-12）。

### II.4 实现/文档面回归复核（本轮）

- **生产面零漂移**：全部生产文件（persistence 五件、registry 五件、app.ts、diagnostics.ts、CONTEXT.md、ADR 0006/0009/0011、hub-peer-deployment.md、两 AGENTS.md）mtime 09:43–10:53——SA4 iteration 1 / SA10 双重审后未再触碰；收尾轮仅 README（18:16，M-1 纯注释：快速示例「不阻塞」限定内存 adapter 语境）与 registry.ts（18:16，M-2 纯注释：⑤ catch 注释改「design §10 勘误 E-2 已闭环…不再指向任何待勘误文本」）两处写入，diff hunk 逐行亲证零行为；F-8 就此闭合。
- **AD-9/零漂移面维持**：`packages/ws-replication/src`、`docs/protocols/`、ADR-0012、config.ts、main.ts、`domains/`、生成物 0 行 diff（`generate --check` exit 0 互证）。
- **AC3 红线维持**：「绝不阻塞」全文仅余 ADR-0011 澄清节自我覆盖条款（amendment 逐字援引）；erase/purge/secure 仅否定句。
- **SA10 §7 收敛清单对账**：1（AC4 三文件 + 超出清单的两文件，见 F-11）执行 ✅/部分披露 ❌；2（AC5-a）✅；3（AC5-b/F-3）✅；4（AC5-c）✅（除 F-12 一句）；5（runner 侧披露）✅；6（M-1 ✅、M-2 ✅、M-3 维持 SA1 路由 ✅、M-4/M-5/M-6 维持备案 ✅）。
- **本轮无新增攻击面命中**：E4 settle 与 D4 先例同款（wrapper 层编排竞态，非产品缺陷——19:07 失败形态 `expected 143 to be +0` 为 wrapper 未转发信号所致，日志亲证）；session-red/replication-red/codegen 预算放宽不改变断言敏感度（断言未动）；RT-G5 静默同步只收紧注入前置条件。

### Required revisions（iteration 2）

| Finding ID | Severity | Evidence | Problem | Required change | Acceptance | Suggested routing |
|---|---|---|---|---|---|---|
| F-11 | **MAJOR**（披露缺口/审计面） | mtime 取证：`diagnostic-replay-host-lifecycle-red.test.ts` 19:14:49、`registry-phase5-replication-session-red.test.ts` 19:53:22（SA10 reject 后、iteration 8 四门前写入）；驱动证据 `/tmp/sa3-228/full-test-2.log`（19:07 E4 `expected 143 to be +0` 失败）、`/tmp/sa3-228/full-test-3.log`（19:39 补锚 (a) `Test timed out in 5000ms`）、`/tmp/fix-check-session-red.log`（19:53 验证 22/22）；grep 亲证：REPORT.md 全文与 SA3 notes §6.1「逐项在场」表均零提及这两文件 | 收尾轮「AC4 门禁修复」实际改动 **5** 个测试文件，REPORT item 1 与 SA3 notes §6.1 只披露 3 个；另两处（含一处对 #155 期 E2E 文件的 SIGTERM 编排改动）完全未披露。审计者按 REPORT 清单核对 diff 即漏检——本Round 正是靠全树 diff × mtime × 日志交叉才捕获。改动本身经逐 hunk 核验**无弱化**（II.1），缺陷纯在披露 | REPORT「收尾轮记录」item 1 改述为 5 文件清单：补 `registry-phase5-replication-session-red`（2 用例 20s，引 19:39 run）与 `diagnostic-replay-host-lifecycle-red`（signalAndExpectExit SIGTERM settle 1.5s，引 19:07 run E4 得 143，D4/M-6 同族先例）；SA3 notes §6.1 表同步补两行 | grep：REPORT 含上述两文件名；「3 个既有边际测试文件」表述消除；两驱动失败日志被如实引述（对齐其 §6.3 自立标准「不隐匿失败轮」） | implementation（REPORT/notes 勘误；零代码/零测试改动） |
| F-12 | **MAJOR**（验收载体含假性负结论） | REPORT.md L127-129「SA7 全量 run（22/22 绿）与本收尾轮全量 run 均未见其失败，原备案所指形态未再现」vs `/tmp/sa3-228/full-test-3.log` L506-513（19:39 收尾轮全量 run：session-red 补锚 (a) `Test timed out in 5000ms` 恰为「原备案形态」）；该 run 正是树内 20s 预算的存在理由——session-red 测试注释自引「SA7 全量运行 2026-09-07 19:39 实测补锚 (a) 超时」（且归属误标：SA7 报告 13:28 定稿早于该 run，日志在 `/tmp/sa3-228/`） | REPORT 对收尾轮全量证据作出与自身日志矛盾的断言；「未再现」与树内未披露的补救性预算互相矛盾（读者无法解释 session-red 为何带 20s）。该句将随「发布侧移交」进入 PR #142 素材 | 删除/改写该注为事实版：形态于 19:39 收尾轮全量 run 再现（补锚 (a) 5000ms 超时）→ 19:53 显式 20s 预算收敛 → 19:53/20:15/20:41/20:51 四轮全绿；session-red 注释「SA7 全量运行」归属一并修正（或删归属） | grep：REPORT 不再含「均未见其失败」「未再现」该句；替换句含 19:39 再现事实与收敛路径；（可选）session-red 注释归属修正 | implementation（REPORT 勘误；注释修正可选） |

**明确不要求**：任何代码/测试/断言/预算回改（II.1 已证无弱化，四门已独立复算全绿）；D1–D4/T-H5–H8/三单元套件复跑（本轮全量已覆盖）；REPORT 阶段汇总表/M4/发布侧移交重写（已达标）。

### 后续动态验证项（iteration 2）

| Risk | Driver | Expected observation | Failure condition |
|---|---|---|---|
| F-11/F-12 勘误后 REPORT 再核 | SA4（下一轮，纯文档 diff 复核，预计 <5 分钟） | 两文件名在场、假句消除、无其他文本回归 | 任何代码/测试文件被动到（越权）或四门证据表述被改写 |
| 5 处预算/编排改动在 CI runner（push 后）负载形态下的稳定性 | runner（CI run） | 全量 `pnpm test` 在 GitHub runner 双 node 矩阵（20/24）exit 0 | 新环境形态超时（则按 F-7 同族再评估，非本票回归） |

### Non-blocking observations（iteration 2）

1. **OBS-1（沿 F-9/M-4、M-5）**：`deletedNamespaces`/`retiredNamespaces` 单调增长、CI 具名物化缺口——维持既有备案，无变化。
2. **OBS-2（微）**：REPORT 阶段汇总段列 fix 合入为「#248/#251」，基线实际另含 #250（`serialize diagnostic pump scheduling`，git log 亲证）——非失准（未声称穷尽），信息完备性可随 F-11/F-12 勘误顺手补一词。
3. **OBS-3（微）**：session-red 注释「SA7 全量运行 2026-09-07 19:39」归属误标（见 F-12 required change 可选项）。
4. F-8（registry.ts 陈旧注释）已由 M-2 闭合，自本清单移除；F-9/F-10 维持 OBS。

### II.5 结论（iteration 2）

AC4 方向的全部实质主张（不弱化、不跳过、四门绿、证据真实）经本轮独立复算**全部成立**；AC5 的结构性要求（阶段汇总、M4、发布侧披露、计数勘误）**已达成**。驳回点收敛为一处：REPORT 作为本票唯一验收事实载体，对收尾轮测试稳定性改动面少报 2/5（F-11）并含一条被自身日志证伪的「未再现」断言（F-12）——与本票 reject 史（SA10 §4.2）同源同类，且按 SA3 自立的「不隐匿失败轮」标准应披露而未披露。修复为纯 REPORT 勘误（+可选注释归属），零代码/零测试代价；勘误落树后 SA4 复核即收口。

---

## iteration 1 — 条件闭合复审（F-1/F-2/F-5 × SA6 追认 × SA1 勘误 × SA8 iteration 2 clear）

**Date**: 2026-09-07（UTC）
**Reviewer**: SA4（mabf-sa4，dispatch `sa-c2a9e8b5-0e11-4fe9-87de-7688d850334c`，phase implementation-review，iteration 1）
**Worktree**: `/home/wangjian/nomicore-fix-issue-228`（branch `mabf/issue-228`，HEAD `6467078`，全部改动未提交；当前 diff = 26 M + 18 ??，较 R0 净增 4 个新 host 测试文件 = T-H5–H8）
**审查对象**: R0 approve 附带条件 F-1/F-2/F-5 的闭合状态 + 当前最终 diff 的独立复核（不复用 R0 结论，全部重新取证）
**输入产物（全部亲读）**: `task_228_sa6_f1_ratification.md`（F-1 追认 approve）、`task_228_design.md`（round 2 §10 勘误 E-1/E-2）、`task_228_design_conflict_report.md`（iteration 2 收尾 clear）、`task_228_sa3_implementation_notes.md`（iteration 3）、`task_228_sa6_acceptance_contract.md`（§2 D4 行修正 + §7 追认节）、当前全量 diff（逐文件）。
**Issue 评论输入**: 派遣简报明示 REST 已读 = `[]`，无 Owner 追加要求（评论 ID/updated_at：无）。
**边界**: 零业务代码改动、零 commit/push/PR；唯一写入 = 本文件。

### Verdict（iteration 1）

**approve**（`requiresConflictRecheck: false`）

- **F-1/F-2/F-5 全部闭合**，闭合证据为本轮独立重取（§I.1–I.3），非转述。
- D4 契约 ↔ SA6 追认 ↔ design 勘误 E-1 ↔ 测试断言四方逐字一致（§I.1）；ActiveHandle 映射 design/ADR-0009 §5/代码三方一致（§I.2）；T-H5–H8 真实有效且全绿（§I.3）。
- 本轮新攻击面（并发窗口、tombstone 增长、绑定重加路径、协议假设、CI 触发）未击穿；新登记 3 项非阻断发现（F-8 注释陈旧交叉引用 / F-9 tombstone 单调增长观察项 / F-10 CI 锚文件物化缺口观察项），均路由收尾轮，无一要求回滚代码。

### I.1 F-1 闭合核验（D4 断言仲裁链四方一致）

| 环节 | 本轮亲证 | 结果 |
|---|---|---|
| SA6 追认 | `task_228_sa6_f1_ratification.md` §0 verdict=approve；§2 T1–T8 事实（registry.ts `randomBytes(16)` CSPRNG、provision 无条件 create、等 id 概率 2^-128、原断言物理不可满足）；§4 本轮复跑 4/4 绿 | ✅ 在场且自洽 |
| SA6 契约档案同步 | `task_228_sa6_acceptance_contract.md` §2 D4 行已改述（「重建 = 新 identity（≠ 已删 id；原『确定性派生』前提 ✗——物理不可满足，已按 R-1 追认修订」）+ §7 追认节（approve + 移交清单） | ✅ |
| SA1 design 勘误 E-1 | design round 2 §10：AD-2 转绿基线改述（「D1–D3 零断言改动；D4 = 断言级仲裁后的 R-1 行为约束集」）、§3.3 表行、§6.2 T-H1–H4 行、§7 R-1×D4 交叉注记、§10.2 事实表五条 | ✅ 全部落文 |
| 测试断言 | 红灯文件 L383-413：仲裁注记 + `.not.toBe(旧id)` + `/^ns-[0-9a-f]{32}$/` 形状 + 旧日志树/旧 stream 双 absent + 新流 `.not.toBe(旧流)` + 重建树无 deletion.json + 重启健康（provisioned/ready/SIGTERM exit 0）——与追认 §3.2 义务对照表逐项对应 | ✅ 逐字匹配 |
| SA8 iteration 2 | 冲突报告收尾节 C-1：no-conflict（纠错型追认——原断言才是与 CONTEXT.md/ADR-0010 L28 的潜在冲突源，仲裁消除之）；AC1 未削弱（D1–D3 零断言改动钉死主体义务） | ✅ |
| 独立复跑 | 本轮：D1 12.7s / D2 10.8s / D3 9.7s / D4 21.9s，**4/4 绿，Type Errors no errors，exit 0** | ✅ |

**结论**：F-1 闭合。原「断言零改动」三方声明的错误前提已由 SA1 勘误消除、SA6 追认正式化、SA8 复核确认；测试不回滚的处置正确（回滚 = 恢复物理不可满足断言）。

### I.2 F-2 闭合核验（ActiveHandle 映射三方一致 + 残留注释）

- **代码**：registry.ts `runDeleteSlot` ⑤（L1962-1986）——仅 `DocDeleteOperationalError`（或 code `DOC_DELETE_OPERATIONAL`）→ `NAMESPACE_DELETE_FAILED`；其余一切 throw（含 `DocDeleteActiveHandleError`）→ branded `NamespaceRegistryFatalError('delete','lifecycle-slot-internal',false)` + observer。✅
- **ADR-0009 修订节 §5**（L165）：「`DocDeleteFatalError` / 其它 throw → branded fatal（committed:false 恒真）」——与代码一致。✅
- **design AD-6 步骤 5**（勘误 E-2 后）：「`DocDeleteFatalError` / 其它 throw（含 `DocDeleteActiveHandleError`）→ branded fatal」+ 理论不可达论证 + 外部语义零变化注记——三方一致达成。✅
- **Host 可观察结局**：app.ts L883-891 窄 issue `!ok` 与 L884-885 branded fatal catch 均 → `delete-namespace-failed`（F3/F4 行不动）。✅
- **残留（新 F-8）**：registry.ts L1980-1983 注释仍写「design AD-6 步骤 5 把 ActiveHandle 写成『折叠 NAMESPACE_DELETE_FAILED』……design 文本待 SA1 勘误」——E-2 勘误已落地后该交叉引用**陈旧**（当前 design 已不含分歧文本）。SA8 iteration 2 已将其定性为「历史记录」；零行为影响。处置见发现清单 F-8。

### I.3 F-5 闭合核验（T-H5–H8 真实有效性）

四个文件全部在场（`apps/yjs-server/test/`，命名与 design §6.2 一致），本轮**独立复跑 4 files / 4 tests 全绿**（T-H5 35s / T-H6 22.8s / T-H7 23.5s / T-H8 17s；Type Errors no errors；exit 0）。质量核验（逐文件亲读）：

| ID | 覆盖真实性核验 | 裁决 |
|---|---|---|
| T-H5 | **真实黑盒 E2E**：spawn hub+peer（main.ts、真实 WS trusted 复制）；Phase A 双向收敛前置（hub 写→peer 读 5；peer 写→hub 读 7——channel 确实活跃）；Phase B 活跃 channel 中 delete → ack ok + 快照全 absent + 日志树 absent；Phase C peer 驱动写触发 hub 侧 apply 命中 runtime 缺席错误路径 → 任一侧 channel 终态事件（closed/conflicted/failed/disconnected 或 namespace-error；「任一侧」联合的放宽已在 SA3 notes §2.2 披露并论证）+ 双进程零崩溃；Phase D 4s 观察窗 + 重试驱动写下快照/日志树恒 absent；hub 健康（status ok、已删 ns read → namespace-unknown、未知 id delete → namespace-unknown）+ 双向 SIGTERM exit 0。零源码 grep、零 skip | ✅ AD-7/R-2 行为锚成立 |
| T-H6 | boot1（provision+写）干净停机 → boot2（同根、**直引恢复**、无 provision）再写：current.json 同 stream、streams 恰 1、genesis 首位、sequence 1..N 跨 boot 连续、数据恢复一致、strict 全绿——#153 语义 host 级锚 + D4 仲裁的互补面（确定性同 id 恢复仅存于此形态） | ✅ |
| T-H7 | config retention 透传；**layout fixture**（重启前预置前代 stream 目录：真实 JSONL 行拷贝 + observedAt 远古化）→ 重启续写触发构造期 sweep → `retention-swept{deletedGroups≥1}` NDJSON 事件 + 旧流组文件消失；当前流开组零损伤（strict ok、sequence 连续、记录增长、current.json 不变、业务读写照常） | ✅ |
| T-H8 | hub/peer 双侧 diagnostics；hub 写 → peer 收敛 + peer 流 committed `replication-apply`（import 物化、诚实缺席 genesis——#155 语义）；peer 写 → hub 流同样落 committed `replication-apply`；双侧 strict complete + 数据一致（同值 9） | ✅ |

**触发性**：四文件均落 root `vitest.config.ts` include 面 `apps/*/test/**/*.test.ts`；CI `pnpm test` 同入口收集；无 `it.skip`/`todo`；断言只消费 stdout NDJSON、真实文件产物与进程生命周期（readFileSync 仅读运行时产物 current.json）。✅

### I.4 其余复核面（本轮重取）

- **ADR ↔ 实现一致**：ADR-0006 逻辑删除修订节 ↔ contract.ts（可选/必具放置未倒置 + 三错误族 + phase 词表）/lifecycle.ts（`'deleting'` claim 环 + `settleEntryForDelete` cancel-then-evict + `assertDeleteIo`/`assertDeleteWritable`）/file.ts（主键先归档后、逐处 `fsp.rm force:true`）/memory.ts（loud 配置门 + 双分区）逐条吻合；ADR-0009 修订节 §1–§5 ↔ registry.ts 编排 ①–⑥（acceptance→身份→carrier FIFO→owner 核对→capability 前置门→closing 等待→forceRelease/cancelIdleArm/close admission→deleteDoc→幂等 ok）逐字吻合；ADR-0011 澄清节自声明非决策变更且与 ADR-0012-LOG amendment 一致。✅
- **AD-9 零漂移**：`packages/ws-replication/`、`docs/protocols/`、`apps/yjs-server/src/config.ts`、`src/main.ts`、ADR-0012 全部 0 行 diff（git status 亲证）。✅
- **协议假设（AD-7）源码级验证**：hub-namespace.ts L298/L474 `status.runtime === null → throw 'lease released'` → `closeSessionAndRelease`（L1028）既有错误路径在场，零 ws-replication 改动下 channel 失败收口假设成立；`bindings.set`/`knownNamespaces.set` 仅存在于 bootHub 直引循环（L248/L253）与 provision()（L337/L342）——**运行期无任何重加路径**，删除后授权暴露摘除稳定（peer 重连 authorize → `{ok:false}`）。✅
- **冻结面守卫同变更集**：registry surface test-d（`deleteNamespace` 移出禁词表 + 正向 required 锚 + 注明修订节语义区分）、persistence surface test-d（`deleteDoc` 同款）、两个 SA7 动态守卫（恰七面/required 锚）、import-red 断言翻转（注明受管 seam 裁决）——B1「不得静默扩面」守卫面闭环。✅
- **验证复跑汇总（本轮）**：红灯契约 4/4；三单元套件 24/24（--typecheck 零错）；**persistence 包全量 176/176（17 files）**；根 `pnpm typecheck` exit 0（14 包链）；`git diff HEAD --check` clean。✅ 与 SA3 iteration 3 声明逐位一致。
- **R0 遗留处置状态核对**：F-3（REPORT M4 改述）/F-4（design ALLOW LIST 补录）/F-6（SA7 动态）/F-7（既有超时预算）维持移交态且在 REPORT「未决移交」与 design §10.5 显式登记——未遗失；全量 root `pnpm test` + `generate --check`（AC2/AC4）仍归总控动态验证轮（SA2 O5 编排归属，四方一致）。✅

### I.5 本轮新攻击面与发现

静态攻击（全部未击穿）：

1. **G4 单飞注册微任务间隙**：`run` 创建先于 `deleteInFlight.set`，同步前缀（retire+摘除+tombstone）在 set 前执行；窗口内并发第二请求绕过单飞但落入 tombstone 路径 → 全路径幂等重走 + carrier FIFO 串行 → 双请求均诚实终态。与 O3「勿缓存旧结果」精神一致，非缺陷。
2. **删除后授权复活向量**：绑定/known-set 仅 boot 期填充（亲证），运行期零重加路径（见 §I.4）。封死。
3. **diag-pump 迟到重建**：retire 先于 registry close drain（runDeleteNamespace ① 先于 ③）；`runtimeEmitterFor` retired 检查先于 ensureAdapter。封死（与 R0 一致，代码未变）。
4. **`deleteNamespaceDiagnosticLog` 意外 throw**：外层 try/catch 收编为 `delete-namespace-failed`（此时数据已删、日志可能半态——重试经 tombstone 幂等路径收敛；包函数契约面为返回 failed 形状而非 throw，理论分支）。可接受。

| # | 级别 | 发现 | 证据 | 处置（回流目标） |
|---|---|---|---|---|
| F-8 | MINOR（注释陈旧） | registry.ts L1980-1983 注释称「design AD-6 …待 SA1 勘误」——E-2 勘误已落地，design 现文本已与代码/ADR 一致，该交叉引用描述的分歧不复存在；注释现**误述当前 design**。零行为影响（SA8 iteration 2 已备案为「历史记录」） | registry.ts L1980-1983 vs design §10.1 E-2 行 | **SA3 收尾轮**顺手改注释（删除或改注「已由 design §10 勘误闭环」）；不阻断 |
| F-9 | OBS（资源单调增长） | `deletedNamespaces` Map（app.ts L137）与 `retiredNamespaces` Set（diagnostics.ts）随删除单调增长且无清理面：CSPRNG id 永不复用 → 条目无自然覆盖；长寿命 hub 高频删除下累积。条目极小、频率受运维动作约束，无正确性影响；design 无驱逐条款 | app.ts L137/L878；diagnostics.ts retiredNamespaces | **SA1/收尾轮备案**（design §7 补一句注记或接受现状；v1 可接受） |
| F-10 | OBS（CI 锚物化缺口，可选加固） | CI 对具名锚文件用 `--passWithNoTests=false` 物化（persistence-contract、registry-sa7 R5P 等）防「文件被删→静默假绿」；#228 五个契约/行为锚文件仅经 include glob 收集——单个文件被删 CI 仍绿。属 repo 既有的 glob 级通性，非本票引入 | `.github/workflows/ci.yml` L44-60；vitest.config.ts include | **收尾轮可选加固**（物化红灯契约文件同款步骤）；不阻断 |

### I.6 结论（iteration 1）

R0 的三项强制条件（F-1 追认链 / F-2 三方对齐 / F-5 测试落地）**全部以可复核证据闭合**；D4 契约与追认一致、ADR 与实现一致、T-H5–H8 覆盖真实且全绿、测试触发面完整、协议假设经源码级验证。本轮独立攻击未发现任何 BLOCKER/MAJOR。新登记 F-8/F-9/F-10 均为收尾轮卫生项。

**Verdict: approve**（`requiresConflictRecheck: false`）——SA3 修复确认，条件闭合确认；剩余事项（全量 `pnpm test` + `generate --check` 编排、F-3/F-4/F-7/F-8/F-9/F-10、F-6 动态抽查）全部为已登记的收尾轮/SA7 路由项，不构成本轮驳回。

### I.7 交付物（iteration 1）

- 本文件（iteration 1 报告 + R0 档案保留）。
- 结构化结果：`verdict = approve`，`requiresConflictRecheck = false`，artifactPaths 见 tool call。

---

**── R0 档案（iteration 0，2026-09-07，dispatch `sa-ab42066e-7e4a-4def-b3f1-fd2331564b80`；F-1~F-7 出处，结论已被上文 iteration 1 复核更新）──**

**Date**: 2026-09-07（UTC）
**Reviewer**: SA4（mabf-sa4，dispatch `sa-ab42066e-7e4a-4def-b3f1-fd2331564b80`，phase implementation-review，iteration 0）
**Worktree**: `/home/wangjian/nomicore-fix-issue-228`（branch `mabf/issue-228`，HEAD `6467078`；SA3 改动 = 未提交工作树 diff，39 文件：26 M + 13 ??，含 wiki 档案）
**被审对象**: SA3 implementation（`wiki/raw/task_228_sa3_implementation_notes.md` 所述全部交付）
**输入产物（全部亲读）**: `task_228_design.md`（465 行）、`task_228_sa2_review.md`（M1–M4/O1–O5）、`task_228_design_conflict_report.md`（设计后 SA8 clear + B1–B3 + N1–N7）、`task_228_sa6_acceptance_contract.md`（D1–D4 + AC2 覆盖图）、`task_228_sa3_implementation_notes.md`、当前全量 diff（逐文件）。
**Issue 评论输入**: 派遣简报明示 REST 已读 = `[]`，无 Owner 追加要求（评论 ID/updated_at：无）——本轮无新增约束面。
**审查方式**: 代码逐文件静态验尸 + 关键声明独立复跑（独立进程规范）+ 基线 worktree A/B 对照实验。零业务代码改动、零 commit/push；唯一写入 = 本文件（+ `/tmp` 审计产物）。

---

## Verdict

**approve**（`requiresConflictRecheck: false`）

- **0 BLOCKER / 0 MAJOR**。设计 AD-1~AD-9 全部忠实落地；SA2 M1–M4 全部落实；B1（双 ADR 显式修订节 + ADR-0011 澄清节随代码同变更集落文）、B2（AD-8 失败矩阵 + 调用点纪律）、B3（文档对齐 + 措辞红线）兑现；N2（放置不倒置 + 冻结面守卫同变更集更新）、N3（errno 值域逐字透传）核验通过。
- SA3 所称验证结论**经本轮独立复跑全部证实**（见 §1）。
- 发现 **7 项发现（F-1~F-7）**：1 项契约修订需追认（D4 断言仲裁，方向正确但违反「断言零改动」三方声明）、1 项防御分支映射偏离（ActiveHandle→fatal，设计文本 vs 代码 vs 注释三方不一致，外部不可见）、1 项备案事实失准（M4 场景物理不可达）、1 项文件清单外必要落点（4 文件）、1 项测试缺口顺延（T-H5–H8 未编写，已披露）、1 项并发观察项、1 项既有边际预算用例。**均不构成本轮 reject**——处置意见逐条给出（多数归收尾轮/SA1 文档追认，无一项要求回滚代码）。

---

## 0. 结论速览

| 审核面 | 结论 |
|---|---|
| 设计一致性（AD-1~AD-9） | ✅ 逐条吻合（§2）；偏离 2 处：F-1（D4 断言仲裁）、F-2（ActiveHandle 映射） |
| SA2 M1–M4 | ✅ 全部落实（§2.2） |
| B1/B2/B3 + N1–N7 | ✅ 落文与语义核验通过（§2.3）；N2 放置不倒置亲证 |
| 读写路径一致性 | ✅ 无分叉（§3） |
| 静默失败 | ✅ 无（§4） |
| 降级方案 | ✅ 无未设计降级（§5） |
| 极端攻击 | ✅ 未击穿（§6）；F-6 并发观察项交 SA7 |
| 错误处理链 | ✅ M3 收编完整（§7） |
| 架构评估 | ✅ 可行，无死胡同信号（§8） |
| 过度设计 | ✅ 精简（镜像既有范型 + 文档化减法）（§9） |
| 测试触发性（vitest/E2E） | ✅ 全部新测试落 root `pnpm test` include 面（§2.6） |
| 源码 grep 断言禁令 | ✅ 无反模式（§2.7） |
| 验证声明复核 | ✅ 独立复跑全绿（§1）；registry 1 例超时经基线 A/B 判定为**既有边际预算**（§1.4） |

---

## 1. 验证声明独立复核（本轮全部重新执行）

| SA3 声明 | SA4 复跑命令 | 实测 | 裁决 |
|---|---|---|---|
| D1–D4 红灯契约 4/4 绿（零断言改动） | `vitest run apps/yjs-server/test/host-namespace-delete-diagnostic-link-red.test.ts` | **4 passed (4)**，Type Errors no errors，exit 0 | ✅ 绿属实；「零断言改动」对 D1–D3 成立、对 **D4 不成立**（见 F-1） |
| 新增三套件 24/24 绿 | `vitest run doc-delete-semantics.test.ts doc-delete-storage.test.ts registry-delete-orchestration.test.ts --typecheck` | **24 passed (24)**，Type Errors no errors，exit 0 | ✅ |
| persistence 包全量 176/176 | `vitest run packages/persistence/test` | **176 passed (176)**（17 files），Type Errors no errors，exit 0 | ✅ 与 SA3 数字逐位一致 |
| 根 `pnpm typecheck` exit 0 | `pnpm typecheck` | **EXIT=0**（全部 14 包 tsc 链） | ✅ |
| `git diff --check` clean | `git diff HEAD --check` | clean | ✅ |
| AD-9 零漂移（ADR-0012/protocols/config/main/ws-replication） | `git diff --stat` 定向 | 0 行 | ✅ |
| registry 全量 409/410（1 例 5s 预算超时，既有时序敏感 flake） | `vitest run packages/namespace-registry/test` | **409 passed + 1 failed**（`registry-phase5-replication-red.test.ts` AC-6 `persistence-degraded`，"Test timed out in 5000ms"，非断言失败） | ⚠️ 见 §1.4 基线 A/B——**flake 定性成立，但「单文件运行恒绿」在本环境不成立** |

### 1.4 registry 超时用例的基线 A/B 对照（本轮关键实验）

被审 diff **未触及**该测试文件（最后变更 = commit b155c73/#202）。为区分「既有 flake」与「本 diff 引入回归」，本轮在 `/home/wangjian/nomicore/.worktrees/sa4-228-baseline` 建基线 worktree（HEAD `6467078`，零 SA3 改动，审后已删除）做同环境对照：

| 运行形态 | 基线（无 diff） | issue worktree（含 diff） |
|---|---|---|
| 全文件单跑（空载） | 2266ms ✅ / 2663ms ✅ / **4744ms ✅（距 5000ms 预算仅 5%）** | 5337ms ❌ 超时 / 3409ms ✅ |
| 隔离单测（`-t "persistence-degraded"`） | ~2266ms | 2198 / 2337 / 2300ms |
| 包全量（maxWorkers=1 负载） | — | 11421ms ❌ 超时 |

**结论**：(a) 该用例在**基线即处于预算边缘**（空载全文件可到 4744ms），波动 2.2–4.7s 属既有特性，SA3「既有时序敏感 flake、与本次改动零耦合」的定性**成立**；(b) 隔离 A/B 双端均 ~2.3s——**无本征每测回归**；(c) SA3「单跑恒绿 2.8s」系其环境测量，在本（较慢）环境全文件形态可红。处置：F-7（收尾轮给该用例显式 per-test timeout 或拆分，非本票义务）。

---

## 2. 设计一致性审查

### 2.1 Scope Creep Guard（§1.1 程序）

- design §3 无独立标题的「文件清单（File Scope）」章节（清单以 §3.1–§3.4 表格 + §6 测试 ID 形式在场，实质 ALLOW LIST 可抽取）——按 skill 程序以全文反引号路径抽取比对。
- **actual（39 文件）− allow − 白名单（`wiki/raw/task_228_*`）后余 4 个清单外文件**：
  1. `packages/namespace-registry/src/errors.ts`——`NamespaceRegistryFatalError.operation` 联合 + `'delete'`：AD-6 步骤 3 明文规定的 branded fatal 形状所需（设计假定常量在 types.ts，实际冻结 operation 联合在 errors.ts）；
  2. `packages/namespace-registry/src/observer.ts`——`lifecycle-slot-failed` 事件 `operation` 联合 + `'delete'`：AD-6 步骤 3 明文「observer `lifecycle-slot-failed`（镜像 L1696-1712）」所需；
  3. `packages/persistence/src/testing.ts`——fault seam 增量 `failNextRemoveKey` + wrap 层条件转发 removeKey（内层缺席不暴露能力，capability 语义原样透传）：T-P4/T-R4 确定性故障注入所需；
  4. `docs/integration/hub-peer-deployment.md`——管理动词表新增 `delete-namespace` 行 + append-only 稳定码注册表增补 `delete-namespace-failed | log-delete-failed`：docs/AGENTS.md L13「update every normative document whose stated contract changed」的repo 级法定义务（新增稳定码即触发）。
- **判定**：四者均为**设计行为的必要落点或 repo 法定义务**，无一引入未设计行为、无 DENY LIST 命中、无 BLACKLIST（package-lock/yarn.lock/.DS_Store/TASK.md/.bak）命中。不构成实质 scope creep；但按 §1.1 立法处置 = **要求 SA1 于收尾轮在 design §3 显式补录这 4 个文件及理由**（F-4），不接受「已实现即追认」的静默状态。
- **设计清单内但 diff 缺席**：`docs/adr/0012-…md`（设计预期零改动、仅全文校对——合规）；**§3.3/§6.2 列明的 4 个新 host 测试文件（T-H5–H8）未编写**（F-5，见 §2.5）。

### 2.2 逐决策核验（AD-1~AD-9 × SA2 M1–M4）

| 决策 | 核验结果 |
|---|---|
| AD-1 三段式落点 | ✅ persistence `deleteDoc`（contract 可选/必具放置亲证）+ registry `deleteNamespace` + Host 编排；Host 零直调数据面（app 仅 import 包公共导出 `deleteNamespaceDiagnosticLog`、`type DeleteNamespaceResult`——app AGENTS 包边界合规） |
| AD-2 op 表面与门禁 | ✅ G1（`role!=='hub'\|\|registry===undefined`→unknown-op，镜像 opReplaceSchema）→ G2（typeof+`NAMESPACE_ID_PATTERN`→invalid-op-args，先于一切 IO）→ G3（knownNamespaces 优先于 deletedNamespaces tombstone——N5 次序亲证；皆未命中→namespace-unknown 零 fs）→ G4（`deleteInFlight` 单飞，第二请求 await 首请求结算后**重走全路径**，finally 清理——O3「勿缓存旧结果」亲证）。成功回执 `{ok:true}`；事件 `namespace-deleted` 回执前发射；诊断禁用分支（`enabled!==true` 跳过日志步、回执 ok:true）按 AD-2 注记 |
| AD-3 全序 | ✅ ①`retireNamespace` → ②bindings 以 `\0+ns` 结尾全删 + knownNamespaces.delete + tombstone 置位 → ③`registry.deleteNamespace` → ④enabled 时同步 `deleteNamespaceDiagnosticLog`（槽外同步 fs）→ ⑤事件+回执。次序与设计逐字一致；②→③ 让渡间隙的 diag-pump drain 由 ① retirement 封堵（retired 检查先于 ensureAdapter——亲证） |
| AD-4 retirement 面 | ✅ `retiredNamespaces` Set + `adapters.delete`；`DiagnosticEmissionDropReason` 第四值 `'namespace-deleted'`（注释明言唯一产生方纪律）；`runtimeEmitterFor`：closed→manager-closed、retired→namespace-deleted dropStub（**先于** ensureAdapter）、否则 ensureAdapter；`initStream` 先 un-retire 再 ensureAdapter（O2）；`close()` 清 retired（幂等不变） |
| AD-5 deleteDoc | ✅ 契约注释/错误族（ActiveHandle/Operational/Fatal + phase 三词表）逐字对齐设计；`runDeleteDoc`：settle 环 → 重检 disposed → claim 环（reading/creating/archiving/deleting 全等待）→ `'deleting'` claim（成败双路 identity 守卫清理，镜像 runArchiveDoc）→ `io.removeKey`（同步 throw→adapter-violation fatal；异步 reject→epoch 当前 operational / 否则 remove-aborted fatal）。`settleEntryForDelete`：handles>0→ActiveHandle 诚实拒绝；flushing→archiveWaiters 等待→**重入重读**；零 handle→**cancel-then-evict**（`clearTimers` 亲证覆盖 debounce+maxDirty+retryTimer → identity 守卫 cells.delete → `entry.doc.destroy()` 镜像 settle 先例）。`assertDeleteIo` bare loud Error 镜像 assertArchiveIo。File `removeKeyCopies`：主键 snapshot/tmp 先（提交点）→ 归档 snapshot/tmp 后，逐处 `fsp.rm force:true`（ENOENT 容忍）；Memory：deleteSnapshot hook 纪律同 remove（readSnapshot 接线而无 delete hook→loud 配置门）+ archiveSnapshots 分区 delete。**未复用 `remove`**（归档语义保持） |
| AD-6 deleteNamespace | ✅ 公共入口同步段 acceptance→`validateOpenIdentity`（零 entries/carriers/persistence 访问）→ `admitDeleteSlot`（carrier per-key FIFO，与 open/create/import/reset 同串行域）。`runDeleteSlot`：①owner 核对（仅 live entry，零存在性泄露）→ ②capability 前置门（typeof 窄化 + loud branded fatal + observer，**先于一切破坏性动作**）→ ③closing generation 等待结算后重读（close 失败→诚实 DELETE_FAILED；防御性新 generation→不破坏、诚实失败）→ ④forceRelease→cancelIdleArm→close admission（I2：先赋 closePromise 后翻 closing；同步 throw 收编）→ await close → ⑤deleteDoc typed 映射（`.call` 绑定防第三方 receiver）→ ⑥absent 幂等 `{ok:true}`。`NAMESPACE_DELETE_FAILED_MESSAGE` 进 types.ts 单一真相源（零插值零回显）。⚠️ ⑤的 ActiveHandle 分支偏离（F-2，见下）。`getStatus` 三态/observer 公共事件零新增亲证 |
| AD-7 复制暴露收口 | ✅ bindings 后缀摘除 + knownNamespaces.delete 同步先行；已建 channel 走既有 released-lease 错误路径（零 ws-replication 改动亲证）——**行为锚 T-H5 未编写**（F-5） |
| AD-8 失败/幂等 | ✅ F1–F6 回执码族逐行对齐（invalid-op-args/namespace-unknown/delete-namespace-failed〔窄 issue+branded fatal 折叠〕/log-delete-failed{step,errno}）；`errno: logResult.code` 值域逐字透传（N3/O4 亲证）；tombstone 先置→失败重试收敛链路（G3→registry absent→deleteDoc ENOENT 容忍→日志 N1–N5）成立 |
| AD-9 零漂移 | ✅ §1 表（定向 diff 0 行） |
| **M1** 'deleting' 全消费方 | ✅ 亲证五处：`exclusiveCreate` claim 环（createDoc+importDoc 共享，lifecycle.ts L268）、`resolveLoad`/loadDoc 环（L865）、`runArchiveDoc` claim 环（L494）、`seedForTest` 拒绝清单（L786）、`runDeleteDoc` 自身；`cells.set` 全部 6 处逐一核对无覆写路径（routeOwnedRead L959/exclusiveCreate L342 的无条件置 live 由消费环等待+I6 重验证收口——F-6 观察项）。绿锚 P1d（delete×load 交错）/P1e（delete×create 交错）在场且绿 |
| **M2** cancel-then-evict | ✅ 次序亲证：苏醒重读 → `clearTimers`（含失败 flush 新武装 retryTimer——`clearTimers` L1144-1149 覆盖三定时器亲证）→ identity 守卫驱逐 → `entry.doc.destroy()`；flush 结算通知面亲证（`flush().finally` 首位无条件 splice 通知，L1094-1101）。绿锚 P2a（`scheduler.pending()===0` + 越 maxDirtyMs×3 无重建）/P2b（恰两次提交、无第三次写）在场且绿 |
| **M3** throw 收编 | ✅ `runDeleteNamespace` 全体 try/catch：registry branded fatal→`delete-namespace-failed`；外层 catch 收编一切意外 throw；「进程绝不因控制输入退出」经 handleControlLine→dispatch→op 链路亲证（无 fire-and-forget、无 process.exit 路径） |
| **M4** 备案 | ✅ REPORT.md 残余风险节在场（⚠️ 场景描述事实失准，F-3） |

### 2.3 B1–B3 / N1–N7 核验

- **B1（硬门禁）**：`docs/adr/0006` L219「逻辑删除修订（2026-09-07，issue #228…）」、`docs/adr/0009` L153「修订节：issue #228（单 namespace 终态删除编排 deleteNamespace…）」、`docs/adr/0011` L154「澄清性修订节（非决策变更）」**全部随代码同变更集落文**——修订内容含设计要求的全部义务（0006：delete≠archive 区分/放置/幂等/ENOENT/active-handle/措辞纪律；0009：终态删除 vs 逐出复用**逐字区分**/owner 零存在性泄露/carrier 序列化/减 fence 论证）。✅ 无 B1 违约。
- **B2**：AD-8 显式裁决落地（§2.2）；同步日志删除在 registry 槽外（stdin macrotask）亲证。✅
- **B3/AC3**：CONTEXT.md 语义 emission 词条、包 README「绝不阻塞」、包 AGENTS 措辞按 §3.4 目标文本对齐（「不返回 durability promise」「可被文件系统延迟阻塞」「queue/batch/fsync/fd cache 为目标演进形态而非现行特性」逐字在场）；全文抽检无 erase/purge/secure 字样。✅
- **N2**：`DocPersistence.deleteDoc?` 可选 / `ReplicaPersistence.deleteDoc` 必具**未倒置**（contract.ts 亲证）；`persistence-phase5-archive-surface.test-d.ts`（deleteDoc 移出禁词表入 required 锚）、registry surface test-d（`deleteNamespace` 移出禁词表 + 正向 required 锚）、两个 SA7 动态守卫（可枚举键恰七面/required 成员含 deleteDoc）、import-red 保持性守卫（`deleteDoc` 断言翻转并注明理由）同变更集更新。✅
- **N3**：errno 值域透传不重映射。✅（O4）
- **N4/N5**：停机竞态注记在 AD-8/REPORT；G3 known-set 优先于 tombstone 亲证。✅

### 2.4 契约改动连锁（§1.6 程序）

机械 grep：diff 无任何「既有导出函数 return→throw 契约改动」（全部 throw 新增于新函数）。新增 throw 函数的 caller 三层防御矩阵：

| 新 throw 函数 | caller | A 直接 try/catch | B await 完整 | C 顶层无一刀切 exit | 裁决 |
|---|---|---|---|---|---|
| `registry.deleteNamespace`（branded fatal） | `runDeleteNamespace` ③ | ✅ 内层 try/catch→`delete-namespace-failed` | ✅ await | ✅ 控制输入不致退出（app AGENTS + M3 亲证） | pass |
| `persistence.deleteDoc`（typed 三族） | `runDeleteSlot` ⑤ | ✅ try/catch typed 映射 | ✅ await | 同上 | pass |
| `retireNamespace` / `deleteNamespaceDiagnosticLog` | `runDeleteNamespace` ①④ | ✅ 外层 try/catch 兜底 | ✅ | 同上 | pass |

类型联合加宽（observer operation / drop reason / fatal operation）为加法演算，全量 typecheck exit 0 证明无穷尽 switch 破坏。✅

### 2.5 测试缺口（F-5，本轮最重要跟进项）

设计 §3.3/§6.2 列明 4 个新 host 测试文件，**diff 中均未出现**：

| ID | 文件（设计命名） | 钉住的裁决 | 现状 |
|---|---|---|---|
| T-H5 | `host-namespace-delete-under-replication.test.ts` | **AD-7/R-2 行为裁决的唯一测试锚**（活跃 peer channel 中 delete→channel 失败收口不崩溃、无快照复活、hub 健康） | 未编写 |
| T-H6 | `host-diagnostic-restart-resume.test.ts` | AC2 restart 正向（#153 续写 host 级） | 未编写 |
| T-H7 | `host-diagnostic-retention-sweep.test.ts` | AC2 retention host 级组合 | 未编写 |
| T-H8 | `host-trusted-replication-diagnostics.test.ts` | AC2 trusted+diag 组合 | 未编写 |

SA3 notes §2 与 REPORT 明示顺延至总控收尾轮，依据 SA2 O5（「执行归属 = 实现轮后最终验收组合……勿在 SA3 单轮埋没」）+ SA6 契约 §4 注记——**非静默丢弃**。但须指出：O5 措辞是「执行归属」，设计 §3.3 将**文件编写**列入变更清单；两者存在解释张力。处置：approve 附强制条件——收尾轮必须落地 T-H5–H8（尤其 T-H5：AD-7 的「在途 channel 异步失败通知」设计裁决当前**零测试覆盖**）+ 全量 `pnpm test` + `generate --check` AC2/AC4 组合门。

### 2.6 测试触发性（§1.3/§1.4 门禁）

- 本票新增/改动测试文件 5 个（4 新 + 1 红灯转绿）+ 5 个守卫更新，全部为 vitest（无 playwright 面）。
- CI（`.github/workflows/ci.yml`）：`pnpm test` → root `vitest run --typecheck`，`vitest.config.ts` include = `packages/*/test/**/*.test.ts` + `apps/*/test/**/*.test.ts`（typecheck 含 `*.test-d.ts`）——**全部新测试文件均落入 CI 触发范围**，无孤儿 spec、无 `--filter` 排除面。✅
- 红灯契约测试为进程级 E2E（spawn main.ts），经同一 vitest 入口触发。✅

### 2.7 源码 grep 断言禁令（§1.7 门禁）

5 个测试文件扫描：红灯契约的 `readFileSync` 仅读**运行时产物**（current.json locator、目录枚举）——合法行为断言；三个新单元套件无 `readFileSync(<源码>)` + `toMatch/toContain` 反模式，全部为真运行时行为断言（typed 错误实例断言、store/目录缺席断言、observer 事件捕获、gated 交错窗口）。测试-d 文件为类型面正向/负向锚（编译期契约，属合法类型测试）。✅

---

## 3. 读写路径一致性

删除写路径：Host op（stdin）→ registry carrier 槽（close drain 释放 handle）→ persistence `deleteDoc` → `io.removeKey`（File：主键+归档位；Memory：双分区）。读取端：
- 数据：`loadDoc` 同一 `io.read`/主 mirror——删除后 key 缺席→null（P1b 双 adapter 亲证）；
- 授权：Host `knownNamespaces`/`deletedNamespaces`（新内存事实源）——G3 读、②写，先摘除后置 tombstone，读写同源同序；
- 诊断：`{logRoot}/namespaces/{ns}` 目录树删除后，adapter 缓存已由 retirement 驱逐、迟到 emit 走 dropStub——无第二事实源可读到已删数据。
无分叉。✅

## 4. 静默失败扫描

`opDeleteNamespace`/`runDeleteNamespace` 全分支均产生回执（ok:true / invalid-op-args / namespace-unknown / delete-namespace-failed / log-delete-failed{step,errno}）；retirement 丢弃走计数事件（`diagnostic-log-emission-dropped` reason='namespace-deleted'）；registry 窄 issue/fatal 均有 observer 记账。逐路径核对（G1–G4、③成功/窄 issue/fatal、④deleted/absent/failed、诊断禁用分支）无「三无」路径。✅

## 5. 降级方案审查

- 诊断禁用分支跳过日志删除：设计 AD-2 明文裁决（「存在日志面」为 AC1 前件），非兜底。✅
- Memory removeKey 的 loud 配置门（readSnapshot 无 deleteSnapshot→拒绝）：与 remove 同款纪律，防「对外部 read 权威谎报删除」——正向防御，非降级。✅
- 无「失败→写别处」类数据错乱路径；无掩盖性 fallback。✅

## 6. 极端条件攻击（静态）

- 并发 delete 同 nsId：G4 单飞 + 重走全路径（O3）——两请求均得诚实终态。✅
- delete×open/create/import/load/archive/seed 交错：carrier FIFO（R3 ×10 恰两形态）+ cell 全消费方（P1d/P1e）。✅
- 在途 flush 窗口：P2b（恰两次提交）。✅
- tombstone owner 陈旧性：provision 重建为**新 CSPRNG id**，与旧 tombstone 无碰撞面。✅
- 非法入参（非 string id / 不合 pattern / owner 文法）：G2 + registry 身份门双层。✅
- **F-6（观察项）**：`runDeleteDoc` claim 环的 `break // cell === undefined` 对微任务间隙出现的 `'live'` cell 同样 fall-through（routeOwnedRead L959 / exclusiveCreate L342 无条件置 live）——与既有 `runArchiveDoc` **逐字同款范型**，安全性由 loadSlowPath 的 I6 cell 重验证（签 handle 前重查 live+同 entry）与 createDoc handle 同步签发保证（settle 会见 handles>0→诚实拒绝）。静态推演无复活、无伪数据；交 SA7 动态抽查（§动态审核重点 #6）。

## 7. 错误处理链

M3 收编完整（§2.4 矩阵）；`runtime.close()` 同步 throw 收编点（`closePromise = Promise.reject` + `void catch`）镜像 shutdown P1；deleteDoc 同步/异步 reject 分类（adapter-violation / operational / remove-aborted）齐备。缺口：无（F-2 的映射偏离属分类选择不一致，非缺口）。

## 8. 架构评估

无死胡同信号：实现零硬编码绕过、零 FIXME、降级非唯一路径、模块半径 = 设计指定的三段式。镜像 archive/reset 先例 + 文档化减法（减 fence/减身份前置/减 bootstrap）质量高。无需退回 SA1。

## 9. 过度设计审查

变更半径精确：+973 行（27 文件）+ 4 新测试文件（1396 行）对「新公共删除面 + 状态机扩展 + 双 ADR 修订 + 文档对齐」的任务体量——无投机抽象、无不可能边界防御（Memory loud 门为既有纪律同款）、testing.ts 增量为测试确定性最小面。✅

---

## 发现清单（F-1~F-7）与处置

| # | 级别 | 发现 | 证据 | 处置（回流目标） |
|---|---|---|---|---|
| F-1 | **MINOR（契约修订需追认）** | 红灯契约 D4 断言被 SA3（前轮）修订：原「重启后 namespaceId 确定性派生 `.toBe(已删 id)`」→「新 id `.not.toBe` + 旧目录零复活 + 无 marker 半态 + 新流≠旧流」。与设计 AD-2/SA2 §5.2/SA8 门禁三方「D1–D4 断言零改动转绿」声明矛盾；SA3 notes §1.1 标题「零断言改动」与同文件 D4 注记自相矛盾。**根因在评审链事实错误**：provision 经 `registry.create` 派生 id = `randomBytes(16)` CSPRNG（registry.ts L854-882），原断言物理不可满足；修订方向与设计 R-1「新 namespace、新流、新身份」逐字一致，且走 SA6 契约自载的 #155「裁定不同按设计仲裁修订」通道，文件头注/用例内注记/REPORT 三处披露。修订后安全语义**保持且增强**（新增 `.not.toBe(oldId)` 锚） | registry.ts L854-882；测试文件 L383-413 仲裁注记；REPORT.md「D4 断言级仲裁」 | **SA6/SA8 收尾轮追认**该仲裁 + SA1 修订 design AD-2「零断言改动」表述 + SA3 notes 勘误。不要求回滚（回滚 = 恢复物理不可满足断言） |
| F-2 | MINOR（映射偏离） | 设计 AD-6 步骤 5 规定 `DocDeleteActiveHandleError`→防御性映射 `NAMESPACE_DELETE_FAILED`；代码将其折入 branded fatal 分支（registry.ts `runDeleteSlot` ⑤），且代码注释自相矛盾（括注称「折叠为 DELETE_FAILED」、操作行称「一律 branded fatal」）。ADR-0009 修订节 §5（新规范文本）与**代码**一致（ActiveHandle 落「其它 throw→fatal」）。Host 可观察结局两端相同（均→`delete-namespace-failed` + observer）；分支理论不可达（close 先释放 Runtime handle；T-R1 live-entry 删除绿） | registry.ts runDeleteSlot ⑤ catch 块 + 注释；design AD-6 步骤 5 | **SA3 收尾轮对齐**：改注释（或按设计改映射），design AD-6 文本同步。外部不可见，不阻断 |
| F-3 | MINOR（备案失准） | SA2 M4 与 REPORT.md 残余风险描述的「重启后 provision **重建同 namespaceId** 命中 deletion.json marker 门→disabled」场景在 CSPRNG 派生下**物理不可达**（provision 恒新 id）。marker 门对删除后**同 id 重建**仍有意义（唯一现实路径 = importReplica 显式同 id），备案应改述 | registry.ts L854-882 + config.ts provision 面（provisionId≠namespaceId） | **REPORT.md 收尾轮改述** M4 条目（保留 marker 门为同 id 重建防线的结论） |
| F-4 | MINOR（清单外落点） | 4 个 design §3 字面清单外文件被修改（errors.ts / observer.ts / testing.ts / hub-peer-deployment.md）——均为设计行为必要落点或 docs/AGENTS.md L13 法定义务，无未设计行为 | §2.1 逐文件 diff | **SA1 收尾轮补录** design §3 ALLOW LIST + 理由 |
| F-5 | **跟进（强制条件）** | T-H5–H8 四个设计列明 host 测试未编写（顺延披露于 SA3 notes §2/REPORT）；其中 **T-H5 是 AD-7/R-2 设计裁决的唯一行为锚**，当前零覆盖 | §2.5 表 | **总控收尾轮必须落地** T-H5–H8 + 全量 `pnpm test` + `generate --check`（AC2/AC4 门）——勿使顺延变遗失 |
| F-6 | OBS（并发） | `runDeleteDoc` break fall-through 微任务间隙（§6）——与既有 archive 范型同款，静态安全 | lifecycle.ts L591-600 vs L485-502 | **SA7 动态抽查**（#6） |
| F-7 | 跟进（既有） | `registry-phase5-replication-red` AC-6 `persistence-degraded` 用例 5s 预算在**基线即边际**（本环境基线空载全文件 4744ms；含 diff 隔离跑与基线同 ~2.3s——无本征回归）；SA3「单跑恒绿」在本环境不成立 | §1.4 A/B 表 | **收尾轮**给该用例显式 timeout 或拆分（独立于本票；避免全量门被既有边际用例阻塞） |

---

## 数据流路线审计（交 SA7）

> 注：design 无独立标题的「数据流路线」章节——AD-3 全序 + AD-5/6/7 即完整路线规格（本审计以其为基线逐跳核对，全部吻合）。建议 SA1 后续设计补正式章节标题（流程注记，非本轮退回理由）。

| 路线 | SA1 设计路线 | SA4 实际追踪/补充 | SA7 必验跳点 | 预期可观察结果 | 失败判定 |
|---|---|---|---|---|---|
| 删除主链 | op(G1–G4) → retire → 摘除暴露/tombstone → registry（close drain→deleteDoc）→ 同步日志删除 → 事件+回执 | app.ts `opDeleteNamespace`→`runDeleteNamespace`（AD-3 ①–⑤逐字落地）；registry `admitDeleteSlot`/`runDeleteSlot`；lifecycle `runDeleteDoc`→`io.removeKey` | 真实 hub 进程全链（D1–D4 已绿，SA7 复跑） | ack 时快照全 absent + `{logRoot}/namespaces/{ns}` 树 absent + exit 0 | ack 后任一残留 = 复活/半态 |
| debounce 复活封堵 | settle 取消定时器或等待在途 flush 后 removeKey | `settleEntryForDelete` cancel-then-evict + `clearTimers`（三定时器）+ archiveWaiters 等待重入 | 虚拟钟越 maxDirtyMs（P2a/P2b 已绿） | 定时器计数 0、无第三次写 | 快照重建 |
| diag-pump 迟到重建封堵 | retirement 先于 close drain | `retireNamespace` ①先于③；`runtimeEmitterFor` retired 检查先于 ensureAdapter | 删除中/后注入迟到 emit | `diagnostic-log-emission-dropped{reason:'namespace-deleted'}`、无 adapter 重建 | 已删目录重现 stream |
| 复制 channel 收口 | 摘除 bindings/known；已建 channel 异步失败 | ②后缀摘除 + knownNamespaces.delete + tombstone；channel 走 released-lease 错误路径 | **T-H5（未编写——F-5）**：活跃 channel 中 delete | channel 失败收口、进程不崩、无快照复活 | channel 崩溃进程 / 数据复活 |
| 失败/重入收敛 | F1–F6 矩阵 | tombstone 先置 + registry absent ok + deleteDoc ENOENT 容忍 + 日志 N1–N5 | F5 注入（logRoot 只读）→ `log-delete-failed{step,errno}` → 重试 ok | 失败码透传、二删收敛 | errno 重映射 / 重试不收敛 |
| 停机竞态 | carrier tail 覆盖删除槽 | `runDeleteSlot` 在 carrier tail 内（admitDeleteSlot 同款 FIFO） | SIGTERM 落在删除中 | 有界停机 exit 0、重试收敛 | 挂起/复活 |

## 动态审核重点（交 SA7）

1. **D1–D4 复跑**（CI 负载形态）+ `pnpm test` 全量 + `generate --check`（AC2/AC4 组合门；F-5 落地后含 T-H5–H8）。
2. **T-H5**：活跃 peer channel（trusted 复制中）发起 delete → channel 失败收口不崩溃、无快照复活、hub 健康、peer 重连被 authorize 拒绝。
3. **G4 并发**：同 nsId 并发 delete ×N → 全部诚实终态、单飞无重入破坏。
4. **F5 注入**：logRoot 只读 → 回执 `{ok:false,code:'log-delete-failed',step,errno}` 值域透传；同进程重试收敛（N1–N5 续走）。
5. **F3 注入**：removeKey EACCES → `delete-namespace-failed`；tombstone 二删收敛（registry absent→deleteDoc 重试→ok）。
6. **F-6 并发抽查**：delete 与 loadDoc 同 key 微任务交错（P1d 已有确定性绿锚；运行时以真实时钟再抽查）——load 得 null、无 handle 签发于孤儿 entry。
7. **diag 迟到流量**：删除后注入 runtimeEmitterFor → dropStub 计数事件、无目录重建。
8. **M4 改述后验证**（F-3）：F5 失败 + 重启 + provision → 新 id 新流、**新 namespace 不得**出现 `stream-init-failed{reason:'namespace-log-deleted'}`（marker 不适用于新 id）。
9. **SIGTERM 竞态**：删除中 SIGTERM → 有界停机、exit 0、二删收敛。
10. **peer 面**：peer 角色发 `delete-namespace` → `unknown-op`；D3 后进程继续可用（后续 op 正常回执）。

---

## 审核结论（技能输出格式）

1. 设计一致性：⚠️ 偏离 2 处（F-1 D4 断言仲裁——根因在评审链事实错误、修订方向合规；F-2 ActiveHandle 映射——设计文本/代码/注释三方不一致，外部不可见）
2. 读写路径一致性：✅ 一致
3. 静默失败：✅ 无
4. 降级方案：✅ 安全（无未设计降级）
5. 极端攻击：✅ 未击穿（F-6 观察项交 SA7）
6. 错误处理：✅ 完整（M3 收编亲证）
7. 架构评估：✅ 可行
8. 过度设计：✅ 精简

**Verdict: pass（approve）**——SA3 修复确认；F-1/F-4 的文档追认、F-2 注释对齐、F-5 收尾测试落地、F-3/F-7 备案修正为**批准附带条件**，由总控路由（SA1/SA6-SA8/收尾轮），不构成本轮驳回。

## 交付物

- 本文件：`wiki/raw/task_228_sa4_review.md`（静态验尸报告 + A/B 实验证据 + SA7 动态清单）。
- 结构化结果：`verdict = approve`，`requiresConflictRecheck = false`，`artifactPaths` 见 tool call。
