# SA10 Spec 审查报告 — Issue #228（iteration 2：reject 收敛后复审）

> SA10（独立 Spec 审查者）spec-review 轮产物。dispatch `sa-54da628e-374d-42d8-8b0e-4ff6897f5ba7`，
> phase spec-review，**iteration 2**。
> **Worktree**: `/home/wangjian/nomicore-fix-issue-228`（branch `mabf/issue-228`，HEAD `6467078`
> 亲证未动；被审对象 = 当前未提交全量 diff：**32 M + 23 ??**，与 SA4 iteration 4 取证计数一致）。
> **Issue 评论输入**: 派遣简报明示 REST 已读 = `[]`（无 Owner 追加要求；评论 ID/updated_at：无）；
> 本轮 `gh issue view 228` 亲读复核：OPEN、5 条 AC、0 评论。
> **输入产物（全部亲读）**: issue #228 正文、iteration 1 本报告（reject + §7 收敛清单）、
> `task_228_sa3_implementation_notes.md`（iteration 9）、`task_228_sa4_review.md`
> （iteration 2 reject F-11/F-12 → iteration 3 reject → **iteration 4 approve**）、
> `task_228_sa7_report.md`、REPORT.md（21:36 定稿版，全文 307 行）、design（round 2 勘误）、
> SA6 契约 + F-1 追认档案。
> **独立核验方式（本轮全部亲跑/亲读，非转述）**: 5 个边际测试文件改动逐 hunk 亲读；
> 四门日志亲验（`/tmp/full-test-run-2.log` 尾段+exit 标记、`/tmp/full-test-run.log` 与
> `/tmp/gate-full-test.log` 的 Unhandled Errors 区、`/tmp/typecheck-run.log`、
> `/tmp/generate-check-run.log`、`/tmp/fix-check-session-red.log`、
> `/tmp/sa3-228/full-test-{2,3}.log`）；`git diff HEAD --check` **本轮自跑 exit 0**；
> REPORT 14 个引用证据路径逐一存在性核验；上游数字抽查（#226 260/2869、#227 2917/2917
> 与上游档案吻合；#248/#250/#251/#223/#200/#196/#194 在本分支 git log 亲证）；
> PR #142 / issue #141 状态 `gh` 亲证（均 OPEN、未假报完成）；全树 mtime 取证复核。
> **边界**: 零业务代码/设计/测试改动；未运行测试、未启动服务；零 commit/push/PR；
> 唯一写入 = 本文件。
> **不复用结论声明**: SA4 iteration 4 的 approve 已知悉，但本报告全部关键结论独立取证
> （日志亲验、diff 亲读、mtime 亲证、上游抽查），非转述。

---

## Verdict

**approve**（`requiresConflictRecheck: false`——本审查不触碰 ADR 面，无冲突裁决需求）。

**核心理由**：iteration 1 的两条 reject 依据（AC4 全量门按记录未绿、AC5 REPORT 不完整/
失准/陈旧）与 SA4 iteration 2/3 的两项 MAJOR（F-11 五文件披露面、F-12 假性负结论）
**全部以可复核证据闭合**；AC1–AC3 交付面自 iteration 1 深审后零生产改动（mtime 取证 +
diff 亲证），iteration 1 的满足判定持续有效。五条 AC 逐项核验全部满足（§1–§5），
无遗漏、无部分实现、无错误实现、无实质 scope creep。剩余事项 = 发布侧 runner 待办
（已在 REPORT 如实披露为待办，非本 worktree 可执行面）与 MINOR/OBS 备案（§6），
均不阻断 approve。

---

## 1. iteration 1 reject 项闭合核验（本轮首要职责）

### 1.1 AC4 — 全量 `pnpm test` 门禁：已绿（fresh 证据，当前树有效）

| 证据 | 本轮亲验结果 |
|---|---|
| 终验全量 run `/tmp/full-test-run-2.log`（2026-09-07 20:42–20:51） | **亲验尾段：Test Files 279 passed (279)、Tests 2984 passed (2984)、Type Errors no errors、Duration 563.32s、exit=0**；无 Unhandled Errors 区 |
| 同日志 5 个改动文件逐文件绿 | grep 亲证：replication-red 16/16@856ms、generate-cli-check 8/8@4874ms、ws-171-real-transport 4/4@3618ms、session-red 22/22@1695ms、diagnostic-replay-host-lifecycle-red 22/22@47067ms——与 REPORT 四门表逐字一致 |
| 独立复算 ×2（SA4 轮） | iteration 2 亲跑 `pnpm test` exit 0（279/2984、563.67s，21:01–21:12）；iteration 3 亲跑 exit 0（566.56s，21:16 起）——记录在案且与终验日志互证 |
| typecheck / generate --check | `/tmp/typecheck-run.log` exit=0（14 包链在场）；`/tmp/generate-check-run.log` 命令在场零错误输出；SA4 两轮复跑均 exit 0 |
| whitespace 门 | **`git diff HEAD --check` 本轮自跑 exit 0（clean）** |

**改动合法性（不弱化/不跳过，逐 hunk 亲读）**：收尾轮共 5 个既有边际测试文件被改
（= 本审查 iteration 1 §7.1 清单 3 个 + 收尾轮自跑全量 run 驱动的另 2 个）——

1. `registry-phase5-replication-red.test.ts`：AC-6 用例 `}, 20_000)`——仅时限，断言区零改动；
2. `generate-cli-check.test.ts`：3 个 spawn 用例 `}, 20_000)`——仅时限；
3. `ws-replication-sa7-issue171-real-transport.test.ts`：RT-G5 注入前加 wire 静默同步
   （等 UPDATE_ACK ≥ 已发 UPDATE 再注入——消除注入帧与在途 ACK 同序列竞速的**既有编排
   竞态**）+ `}, 30_000)`——断言零改动，注入前置条件反而更严；
4. `registry-phase5-replication-session-red.test.ts`：2 条 AC-5 degraded 用例
   `}, 20_000)`——仅时限；21:36 注释归属修正为纯注释（SA4 iteration 4 已就该版
   独立复跑 22/22 绿，`/tmp/sa4-i4-session-red.log`）；
5. `diagnostic-replay-host-lifecycle-red.test.ts`：`signalAndExpectExit` 对 SIGTERM 先
   1.5s 有界 settle（D4 同款 wrapper 窗口先例）——`waitForExit(30_000)` 有界窗与
   `exit code === 0` 断言不变。

驱动链诚实可查：19:07 run（`/tmp/sa3-228/full-test-2.log`）E4 `expected 143` 亲证在场；
19:39 run（`/tmp/sa3-228/full-test-3.log`）补锚 (a) 超时形态与该文件 `1 failed` 摘要
亲证在场；19:53 单文件复核 `/tmp/fix-check-session-red.log` 22/22 亲证。
**失败驱动 → 最小修复 → 复跑收敛**链条完整，无隐匿、无弱化。

**证据对当前树有效性**：SA4 iteration 3 验绿（21:16）之后全树仅 3 文件写入（REPORT 文本
21:36:54、SA3 notes 文本 21:37:34、session-red 纯注释 21:36:30——mtime 本轮亲证），
生产代码与 5 处测试稳定性改动零触碰；session-red 注释版已由 SA4 iteration 4 复跑绿。
四门证据对当前树持续有效。

### 1.2 AC5 — REPORT.md：已完整、已改准、已去陈旧

| iteration 1 缺口 | 当前状态（本轮亲证） | 结果 |
|---|---|---|
| (a) #141/PR #142 阶段结论 + #148–#154/#226/#227 各票行缺席 | 「PR #142 阶段汇总」节在场：PR 定位 + 合入链（#156/#159/#166/#167/#194/#196/#200/#223 + fix #248/#250/#251——git log 亲证在分支历史）+ **11 行阶段结果表**（#148–#155、#226、#227、#141 每票交付物 + 验证证据路径）；**14 个引用 wiki 证据路径逐一存在性核验全部在场**；#226 260/2869、#227 2917/2917 与上游档案抽查吻合 | ✅ |
| (b) M4 条目物理不可达表述（F-3） | 「残余风险」节首条已改述：marker 门 = 同 id 重建防线；provision 恒派生新 CSPRNG 身份（2^-128）；唯一现实路径 = importReplica 显式同 id；引 SA7 重点 8 实测——与运行时证据一致 | ✅ |
| (c) 「未决移交」陈旧表述 | 已清除，由「收尾轮记录」+「发布侧移交（runner 待办——如实披露，不假报完成）」取代；验证节吸收最终四门证据（含 RPC 噪声轮如实披露：首轮 exit 1 零测试失败、2 条 `onTaskUpdate` 超时——与 `/tmp/full-test-run.log` Unhandled Errors 区逐字吻合） | ✅ |
| (d) runner 侧待办披露 | PR #142 title/body 增补段、#141 同步、push 后 CI 核验、git 配置残留核对逐项列明；本轮 `gh` 亲证 PR #142 仍 OPEN 原 title、issue #141 仍 OPEN——未假报完成 | ✅（披露式） |
| SA4 F-11（五文件少报） | 「收尾轮记录」item 1 现为 5 文件逐条清单（含驱动日志引述）；grep 亲证无「3 个文件」少报残留（L236「SA10 §4.1 所列 3 个边际文件」为对本审查清单的准确转述，紧随其后如实补述另两形态） | ✅ |
| SA4 F-12（假性负结论） | 验证节 session-red 注记已更正为「19:39 实测再现（5427ms）→ 19:53 落地 20s → 22/22 → 20:15 全量 279/2984」；grep 亲证「未再现/均未见」假句零残留 | ✅ |

## 2. AC1–AC3 持续有效判定（基于零漂移取证 + iteration 1 深审）

- **生产面零改动**：全部生产文件 mtime（app.ts 10:04 / diagnostics.ts 10:02 /
  persistence 五件 09:43–09:46 / registry 五件 09:53–09:54 / CONTEXT.md 10:11 /
  ADR 0006 09:53、0009 10:02、0011 10:19）均早于本审查 iteration 1 落笔（16:02）；
  其后仅两处**纯注释**写入（README 18:16 = M-1 快速示例限定内存 adapter 语境，diff
  亲证注释级；registry.ts 18:16 = M-2 ⑤ catch 注释「不再指向任何待勘误文本」，L1983
  亲证）。iteration 1 §1–§3 对 AC1（同步联动全序/失败码族/复活向量封堵/措辞红线）、
  AC2（覆盖矩阵闭合 + T-H5–H8 + SA7 补充套件）、AC3（文档六面对齐 + ADR 修订节落文）
  的深审结论**原样成立**。
- **M-1 闭合**：README 快速示例「不阻塞」已限定内存 adapter 语境（L30 亲证）；残余
  「不阻塞」命中均为租约语义或已限定语境——AC3 收尾级残留清零。
- **M-2 闭合**：registry.ts 陈旧交叉引用注释已改写（L1983 亲证）。
- **D4 仲裁链五方一致**（契约 §7 ↔ 追认档案 ↔ design §10 E-1 ↔ 测试断言区 ↔ SA8
  iteration 2 clear）维持；D1–D3 零断言改动钉死 AC1 主体义务。

## 3. 范围与一致性专项检查（本轮复核）

- **Scope creep**：当前 32 M + 23 ??。相较 iteration 1（27 M + 22 ??）的 delta = 5 个
  边际测试文件（§1.1，本审查自己开出的收敛清单内 + 其同类扩展）+ REPORT 扩写（AC5
  份内）+ wiki 档案；**零新增生产面**。清单外 4 落点（M-3）维持 iteration 1 判定
  （必要落点/法定义务，无实质 creep；design §3 ALLOW LIST 补录仍路由 SA1，MINOR）。
- **AD-9 零漂移面维持**：`packages/ws-replication/src`、`docs/protocols/`、ADR-0012、
  config.ts、main.ts、`domains/`、生成物全部 0 行 diff（SA4 iteration 2 §II.4 复核 +
  `generate --check` exit 0 互证）；`vitest.config.ts`/`package.json`/`pnpm-lock.yaml`/
  `.github/` 零 diff（触发面无操纵，SA4 iteration 4 亲证，本轮文件列表复核一致）。
- **措辞红线**：erase/purge/secure 仅否定句命中（REPORT L278「不承诺……secure erase」）；
  hub-peer-deployment.md 稳定码注册表 **append-only** 追加
  `delete-namespace-failed | log-delete-failed`（diff 亲证未改写既有条目）。
- **测试纪律**：全部改动/新增测试文件零 `.skip/.only/.todo/.fails`（SA4 iteration 4
  grep 亲证；本轮对 5 个边际文件 diff 逐 hunk 复核一致）。

## 4. PR 必须披露的未达成/待办项（approve 附带披露义务）

1. **runner 侧发布动作（已在 REPORT 披露为待办，PR 必须保留该披露）**：PR #142
   title/body 增补「namespace 删除联动交付（issue #228）」段；tracking issue #141
   验收材料同步；push 后 CI run 核验（本地门与 CI 同入口同参）；git 配置残留
   （`mabf.branch`/`mabf.base-branch`）向 runner 核对。
2. **MINOR 备案（不阻断）**：M-3 design §3 ALLOW LIST 补录（路由 SA1）；M-4
   （tombstone/retired 单调增长备案）；M-5（CI 具名物化可选加固）；M-6（tsx wrapper
   就绪窗竞态既有备案）；SA4 F-9/F-10 观察项维持。
3. **OBS（本轮新登记，不阻断）**：REPORT 验证节「20:15 全量 run 279/2984 绿」一句，
   其日志（`/tmp/gate-full-test.log`）实际 FULL_TEST_EXIT=1（2 条同款 RPC 编排噪声、
   2984/2984 用例全绿）——REPORT 未书其退出码，但「零测试失败」表述属实、RPC 噪声
   exit-1 现象已对 20:41 轮如实披露、且 AC4 权威证据 = 20:51 干净 exit-0 轮（本审查
   亲验）+ SA4 两轮独立复算 exit 0。建议收尾轮顺手补半句退出码注记；不改变任何结论。

## 5. 五条 AC 终态对照

| AC | 判定 | 关键证据 |
|---|---|---|
| AC1 同步联动 + 逻辑删除全清单 + 不暗示 secure erase | ✅ 满足 | iteration 1 §1 深审（落点/全序/码族/封堵/措辞逐项亲证）+ 本轮零漂移取证；D1–D4 契约绿（终验日志在案） |
| AC2 阶段级验收组合八行 | ✅ 满足 | 覆盖矩阵闭合（既有锚 + T-H5–H8 + SA7 套件）；终验全量 279/2984 含全部锚文件逐文件绿 |
| AC3 文档一致性 | ✅ 满足 | 六面对齐 + ADR-0006/0009/0011 修订节落文；M-1 残留清零；「绝不阻塞」无矛盾残留 |
| AC4 全量门 + diff-check + 尾随空格 | ✅ 满足 | 四门 fresh 证据（§1.1）；测试稳定性改动逐 hunk 亲证零弱化 |
| AC5 REPORT 汇总 + PR/#141 同步 | ✅ 满足（同步动作为 runner 侧，已如实披露待办） | §1.2 六项缺口全闭合；14 证据路径在场；上游数字抽查吻合 |

## 6. 交付物

- 本文件：`wiki/raw/task_228_sa10_spec.md`（iteration 2，覆盖 iteration 1 报告；
  iteration 1 的 AC1–AC3 深审细节经零漂移取证后继续有效，其 reject 依据已全部闭合）。
- 结构化结果：`verdict = approve`，`requiresConflictRecheck = false`，artifactPaths 见 tool call。
