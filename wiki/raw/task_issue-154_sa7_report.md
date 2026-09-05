# SA7 动态验证报告 — Issue #154：Retain, lease, and delete namespace diagnostic logs

**Date**: 2026-08-31
**Verifier**: SA7（独立动态验证；零生产/测试代码改动——结束时 `git status` 与开始时一致，仅新增本报告）
**Worktree**: `/home/wangjian/nomicore-fix-issue-154`，HEAD `739a24b`（baseline `722bddf`）
**输入**: sa1_analysis / sa2_design / sa6_red + sa6_red_r2 / sa3_impl / sa4_review + sa4_review_r2（Step 0 已读 verdict）
**方法**: 独立探针（tsx + 包公共 API + 真实 writer 链路，脚本在 `/tmp/sa7-probes/`，不进 worktree）+ 既有套件独立复跑 + 反事实变异验证 + 真 SIGKILL 崩溃窗口捕获

---

## Verdict: **PASS**

SA4 R2 已 PASS（Step 0 校验通过）；SA7 独立动态验证全部通过：默认 30d/1GiB 字节预算真机执行、真 SIGKILL W1/W2 崩溃窗口与恢复、租约安全/过期/续租/释放、reader/resume 裁剪一致性（含反向锚）、namespace 删除语义全套、SA4 残余项 R2/R4/R6、无测试掩蔽（反事实证明）。未发现新的功能性缺陷。残余观察项均为 Info 级（见 §7），不构成 REJECT。

---

## 0. Step 0/1 — SA4 verdict 校验 + SA6 套件绿灯复跑

- **Step 0**: `sa4_review_r2.md` 顶部 `Verdict: PASS — R1 §2 唯一 P1 已修复并被真实钉死，R1 关闭` → 进入动态验证。（R1 verdict 为 REJECT 但已被 R2 关闭，以 R2 为准。）
- **Step 1（SA6 红灯 → 绿灯）**：

| 命令 | 结果 |
|---|---|
| `npx vitest run packages/namespace-diagnostic-log/` | **27 files / 427 tests 全绿，Type Errors no errors，exit 0，0 skipped**（uid=1000 非 root，`it.skipIf(isRoot)` 的 T-B9 等 5 处环境守卫全部实际执行） |
| `npx vitest run packages/namespace-diagnostic-log/test/file-adapter-retention.test.ts -t "T-A9"` | `1 passed \| 15 skipped`，Type Errors no errors |
| `pnpm typecheck` | **exit 0**（全仓 10 包） |
| `pnpm test`（= CI Test 步同款 `vitest run --typecheck`） | **147 files / 1862 tests 全绿，exit 0**（SA3 报 1861 + T-A9 = 1862，单调递增无削弱） |

Git 状态核验：

```
$ git rev-parse HEAD            # 739a24b2d79dc40773d3725c197b58893e4db534 ✓
$ git log --oneline 722bddf..HEAD
  739a24b test(namespace-diagnostic-log): pin byte-budget independence from age (T-A9, SA4 R1 #154)   ← T-A9 已提交（SA4 R2 §4-1 出版前置已满足）
  385a376 fix(namespace-diagnostic-log): P2 byte sweep must not gate on age freshness (SA4 R1 #154)
  c0f6cbc feat(namespace-diagnostic-log): retention, read-session leases, and namespace logical deletion (#154)
$ git status --porcelain        # 仅 wiki/raw/task_issue-154_*.md 未跟踪（任务元数据，预期内）；零 tracked 改动
$ git diff --name-only 722bddf 739a24b   # 15 files / +2681 −32，全部在 packages/namespace-diagnostic-log 内（SA2 ALLOW LIST 面）
```

分支 `fix/issue-154-on-docs-namespace-diagnostic-change-log` 领先 `origin/docs/namespace-diagnostic-change-log` 3 commits，**未 push**（→ §6 CI 说明）。

---

## 1. 探针 1 — 默认 30d/1GiB 字节预算真机执行（SA4 R1 §8-1 / R2 §5）

**命令**：`cd /home/wangjian/nomicore-fix-issue-154 && npx tsx /tmp/sa7-probes/probe1_default_byte_budget.ts`（真实 writer，`config.retention` 整体未设 = 纯默认 30d + 1GiB + sweepOnOpen）

**结果（ALL CHECKS PASSED，exit 0）**：

- 380 条 3 MiB sidecar 记录 → 19 个组、**1,195,578,445 bytes（1.113 GiB）新鲜数据**（observedAt=T0，sweep 时龄 1000ms ≪ 30d）。
- `sweepRetention({now: T0+1000})` → **deletedGroups=2、reclaimedBytes=125,849,251**（恰最老两个闭组；第 3 删即不必要——不多删），P1 年龄遍历零动作（`earliestRetained`/报告证明）。
- 扫后磁盘 **1,069,729,194 bytes = 0.996 GiB ≤ 1 GiB**——**默认字节预算在数据新鲜期内被独立强制执行**（SA4 R1 P1 缺陷的反面行为证）。
- `retainedBytes=1,069,718,991` 与独立盘上 jsonl+bin 字节合计**逐字节相等**（INV-10 口径；manifest.json+current.json 共 10,203 bytes 不计入——预算遍历与报告同口径，见 §7-O1）。
- 开组 `00000019` 未动、writer 扫后继续 append 成功；幸存组连续后缀（INV-2）；`readStreamStrict`：`status=ok, historyTrimmed=true, earliestRetainedSequence='41', issues=[]`。
- 负对照：同一 writer 链路下 <1GiB 新鲜数据 + 默认 retention → `deletedGroups=0`（P1 解除武装 + P2 未超预算）。

**判定**：✅ AC-1 字节/年龄双限制独立生效在默认配置下真机成立。

## 2. 探针 2 — 真实 SIGKILL 崩溃窗口 W1/W2 + 恢复（SA4 R1 §8-2）

**命令**：`npx tsx /tmp/sa7-probes/probe2_crash_windows.ts`（子进程经真实 writer 建 701 组 → 就绪标记 → `sweepRetention({maxAgeMs:0})`；父进程在标记后 6–24ms（中环带，实测：首删 ~4ms、删除环 ~25ms）`SIGKILL`；循环直至盘上出现真实 `.deleting` 中断态）

**结果（两次运行，各自 ALL CHECKS PASSED）**：

| 捕获 | 运行输出 |
|---|---|
| **W2**（`00000085.deleting` 无 bin；kill 时 568 组存活） | 恢复：重开构造 resume **同一 stream、零 rotate**（`retention-swept` 卫生完成遗留 marker）→ 幸存组连续后缀、开组 221/702 原样 → reader `ok/trimmed/earliest=86`、无 sequence-gap → 恢复后 emit seq=222/702 可读 → 第二扫（maxAge:0, now>T0）删尽剩余闭组、仅开组幸存（INV-1）→ 第三扫纯 no-op（幂等） |
| **W1**（`00000495.deleting` + bin；kill 时 206 组存活） | 同上全链路通过（earliest=496、恢复后 emit seq=702、第二扫 206 删尽、仅 `00000702` 幸存、第三扫 no-op） |

典型证据行：

```
attempt 5: killedByUs=true done=false midState=W1@00000495 remainingGroups=206
reopen streamId=log-0e01...(same=true) events=["retention-swept"]      ← 无 stream-generation-rotated
read after recovery: status=ok historyTrimmed=true earliest=496 issues=[]
second sweep: deletedGroups=206 ... openProtectedStops=1 liveAfter=00000702
third sweep ... deletedGroups=0 deletingMarkersCompleted=0 failedSteps=0  ← 幂等 no-op
```

**附带回照**：重开构造的自动 sweep 用真实墙钟（本机钟落后于 T0）→ 未来时刻 observedAt 保守不删（时钟回拨安全方向正确，未误删）。**判定**：✅ AC-5「every interrupted deletion step」真实崩溃级验证（非合成）。

## 3. 探针 3 — 开组/租约安全与过期（AC-3；INV-4/INV-9）

**命令**：`npx tsx /tmp/sa7-probes/probe3_lease.ts` → **ALL CHECKS PASSED**

- 活跃租约（`openDiagnosticReadSession`，公开 API、与 writer 无亲缘——INV-9 进程内注册表）：maxAge:0 压力下 `deletedGroups=0, leaseBlockedGroups=1`，**磁盘逐字节不变**。
- 过期（clock 推过 TTL）：`deletedGroups=2`，仅开组幸存——**过期租约永不阻塞**（AC-3 后半句）。
- `renew()`：到期前续租 `leasedUntil +ttl` 生效且 sweep 继续被挡；最终过期仍放行（续租有界）。
- 过期后 `renew()===true`（劝告锁重租、快照不变、数据不复活——T-C4 语义）且重注册的租约条目重新可见。
- `maxLifetimeMs`：`T0+1000 renew=true`、`T0+2000`（续后 3000 > 2500）`renew=false`（越界即拒）；`close()` 幂等、close 后 `renew()===false`、无租约残留。
- INV-9 跨实例 + `maxBytes:0` 双压力：`deletedGroups=0, leaseBlockedGroups=2, retainedBytes=1776`（诚实下限）——**字节预算绝不绕过租约/开组**。
- `openDiagnosticReadSession` 非法入参（`../escape`、`bad/stream`、ttl 0/1.5、maxLifetime 0）5/5 loud throw（零 fs 副作用）。

## 4. 探针 4 — reader/resume 裁剪一致性（AC-5；INV-7）+ 反向锚

**命令**：`npx tsx /tmp/sa7-probes/probe4_trim_resume.ts` → **ALL CHECKS PASSED**

- 完整流：`ok / historyTrimmed=false / earliest=1`（现状逐字节保持）。
- retention 裁剪（age sweep 删组 1,2）：reader `ok / trimmed=true / earliest='3'`、零 issue；**重开 resume 同 stream 零 rotate**，续写 seq `3→4`（§7.5 防风暴）。
- **反向锚**：手工挖中洞（删组 2 两文件）→ `status=corrupt + sequence-gap`、`historyTrimmed=false`（结构规则不误报）；重开 **仍 rotate**（确定性 rotate 未被裁剪容差削弱）。
- 全裁剪收敛（maxAge:0 仅剩开组 3）：重开零 rotate、续写 `3→4`（§7.4 备案行为）。

## 5. 探针 5 — namespace 逻辑删除语义（AC-4；INV-8/12/13）

**命令**：`npx tsx /tmp/sa7-probes/probe5_ns_deletion.ts` → **ALL CHECKS PASSED**

- 全量覆盖：`deleted + streamsRemoved=2`（含复制的第二 stream）；namespaceDir（current.json、`current.json.tmp` 残留、streams/manifest/jsonl/bin）整体消失；**邻 namespace 逐字节不变**。
- 幂等：absent → `{status:'absent'}`，且不创建 `namespaces/` 目录（零 fs 副作用）。
- 非法 id（`../escape`、`a/b`、NUL、`.`、`..`）→ `failed/invalid-namespace-id/marker`，root 逐字节不变；文法注记：`.hidden` 合法（冻结文法仅拒 `.`/`..`/控制符/斜杠）→ absent。
- **N1 marker 门**：手写 `deletion.json` 后构造 → 恰一次 `stream-init-failed{reason:'namespace-log-deleted'}`、零 retention 事件、**构造 + emit 尝试后 root 逐字节不变**（禁复活实证）、`sweepRetention` 诚实空报告；重入删除完成半态 → 目录消失。
- 完成后新构造：**新 streamId 新 lineage**（≠复活）、无 gate 事件。
- 租约分区释放：活跃 session 在删除后被置 `closed`、`renew()===false`（INV-12）。
- 结果词汇运行时扫描：无 `erase|purge|wipe|secure|shred`（INV-12 措辞纪律）。

## 6. 探针 6 — SA4 残余项 R2/R4/R6 + 非法配置动态复核

**命令**：`npx tsx /tmp/sa7-probes/probe6_residuals.ts` → **ALL CHECKS PASSED**

- **R2（无 manifest 流）**：手工 ghost stream（无 manifest.json）→ `sweptStreams=1`（诚实排除）、`failedSteps=0`、ghost 逐字节不变；maxAge:0/maxBytes:0 双压力下仍不触碰；同时正常流照常被清——保守方向确认，无副作用。
- **R4（重叠双实例）**：A 写 3 组 → B 构造 resume 同 stream（B open=3）→ A 续写滚到组 4（组 3 实闭）→ B 以 maxAge:0 扫：**恰删真闭组 1,2**（`deletedGroups=2, openProtectedStops=1, failedSteps=0`），陈旧 open=3 与真 open=4 均幸存；幸存后缀 reader `ok/trimmed/earliest=3` 零 issue；A 继续写 seq `3,4,5` 全程可读、零 rotate——**欠保护方向无数据损毁**（SA2 AT7 备案语义成立）。
- **R6（事件基数）**：活跃租约下 10 次构造 → 恰 10 条 `retention-swept`（每次 actioned sweep 恰一条，有界）；零动作 sweep 零事件。
- **非法配置动态复核（T-A6 同契约）**：`{maxAgeMs:-5}`、`NaN`、`∞`、`1.5`、`{maxBytesPerNamespace:-1}` 各自恰一次 `retention-config-invalid{field}`、stream 照常 ready、巨量 now 下 sweep 零删除零盘变（失活=两限制皆 null，仅剩卫生）。

## 7. 反事实变异 — 无测试掩蔽（no masking）独立证明

**命令**（全部在抛弃型 worktree，项目 worktree 零触碰，已清理）：

```bash
git worktree add --detach /tmp/sa7-cf 739a24b       # + 复用主仓 node_modules（symlink）
# 逆 385a376：在 P2 字节遍历重新注入年龄门
#   if (maxAgeMs !== null && !groupAgeExpired(...)) break
npx vitest run packages/namespace-diagnostic-log/test/file-adapter-retention.test.ts
```

**结果**：`Tests 1 failed | 15 passed (16)` — **恰 T-A9 红**：`AssertionError: expected +0 to be 1`（`file-adapter-retention.test.ts:315`，与 SA4 R2 E3 逐字同形）；T-A1–A8/T-B1–B10 全绿——既证明 **T-A9 是真回归钉（非恒绿陪跑）**，也复现了 R1 盲点（T-A3 `maxAgeMs:null`/T-A5 `0/0` 对该缺陷不敏感）。干净 HEAD 上同文件 16/16 绿（§0）。变异 worktree 已 `git worktree remove --force` 清除。

其它掩蔽面核验：新 5 测试文件仅 `it.skipIf(isRoot)`（EACCES 环境守卫，本机 uid=1000 实跑）；无 `describe.skip/test.skip/only/todo`；`vitest.config.ts` include `packages/*/test/**/*.test.ts` 覆盖全部新文件且 diff 未触碰 config；套件计数 426→427、1861→1862 单调递增。

## 8. Spec/vitest 触发证据（skill Step 3/4）

- 本票新增/改动测试均为 `packages/namespace-diagnostic-log/test/*.test.ts`（vitest 面），无 `*.spec.ts`（E2E 面零新增）。
- CI 触发面：`.github/workflows/ci.yml` — `Typecheck: pnpm typecheck`、`Test: pnpm test`（= `vitest run --typecheck`，全仓无 package 过滤）。静态门禁：新文件全部落入 include glob（SA4 R1 §1.4 已核，本轮复核 config 未变）。
- **CI Run 动态证据：不可得（环境事实，非缺陷）**——分支 3 commits 未 push、无 PR，故无 CI run URL。本地已执行与 CI 逐字同款的 `pnpm typecheck`（exit 0）与 `pnpm test`（147 files / 1862 tests 全绿）。**CI 实跑证据归出版阶段（push/PR 后）**，本报告不宣称 CI 已绿。

| 面 | 触发结果 | 证据 |
|---|---|---|
| vitest: `packages/namespace-diagnostic-log`（含 T-A9） | ✓ 本地同款命令全绿 | `Tests 427 passed (427)` / `Type Errors no errors` |
| 全仓 vitest（CI Test 步同款） | ✓ 全绿 | `Test Files 147 passed (147)` `Tests 1862 passed (1862)` |
| GitHub Actions run | ⚠ 未触发（未 push/无 PR） | `git status -sb`: `[ahead 3]`；`origin/fix/...` 不存在 |

**verdict**: ✅ all-vitest-packages-triggered（本地同款）；CI run 待出版。

---

## 9. AC 覆盖矩阵

| TASK.md AC | 套件锚（本轮 427 绿） | SA7 独立动态证据 |
|---|---|---|
| AC-1 age/bytes 可配置、null/0/缺省 | T-A1–A9 | 探针 1（默认 1GiB 真机 + 负对照）、探针 6（非法值）、反事实 §7 |
| AC-2 closed+unleased、协议跨重启 | T-B1–B10、W0–W3 | 探针 2（**真 SIGKILL W1+W2** + 恢复/幂等）、探针 3（租约门）、探针 6 R4 |
| AC-3 读会话/续租/过期不阻塞 | T-C1–C8 | 探针 3（全语义 + INV-9 + maxBytes:0 不绕过 + 非法入参） |
| AC-4 namespace 逻辑删除 | T-D1–D9 | 探针 5（全量/幂等/N1 门零写/重入/fresh/租约释放/邻隔离/词汇） |
| AC-5 前沿/中断/orphan/保留历史报告 | T-A/T-B/T-E 全表 | 探针 1/2/4（trim 报告、resume 零 rotate、中洞仍腐反向锚、全裁剪收敛） |

SA4 动态审核重点 5 项（R1 §8，R2 §5 沿用）逐条：§8-1 ✅ 探针 1；§8-2 ✅ 探针 2（W1+W2 真实 kill -9）；§8-3 ✅ 探针 6 R4；§8-4 ✅ 探针 6 R2；§8-5 ✅ 探针 6 R6。

## 10. 残余风险 / 观察（均 Info 级，不阻塞）

| # | 观察 | 定性 |
|---|---|---|
| O1 | `retainedBytes`（及预算遍历 total）口径 = jsonl+bin 段文件字节，**不含 manifest.json/current.json**（探针 1 实测差 10,203 bytes）。预算执行与报告同口径（一致、保守方向），但与 §2.2「namespace 全部留存字节」字面有 ~KB 级差 | Info；文档措辞可在 #155 Host 票澄清 |
| O2 | `leaseBlockedGroups` 在 P1 与 P2 各挡一次时双计（探针 3/6：同组计 2）——「组次」而非「组数」的读法 | Info；SA2 未钉死口径，计数诚实不减 |
| O3 | R3（租约 key 为 rootDir 原始串，别名/尾斜杠可分区漂移）维持 SA4 备案——单进程 Host 同值传入即无影响；建议 #155 文档化 | Info（Host 接线票） |
| O4 | W1 真实窗口极窄（rename→unlink(bin) 单 syscall 跨度）；本轮以时序重试捕获（attempt 5），合成 W1（套件 W1 用例）+ 结构同一恢复路径补强 | Info（方法学注记） |
| O5 | 开组保护检查先于租约检查（`file.ts:1213/1268` 先 open 后 lease）——租约覆盖开组时被 INV-1 遮蔽，行为等价（都不删） | Info |
| O6 | CI run 证据待出版（未 push）；T-A9 已在 HEAD 提交集内（SA4 R2 出版前置已满足） | 流程项，非代码 |

## 11. Blocker

**无**。未发现需要 SA3 修复的问题；未发生端口/进程异常；反事实 worktree 与全部探针临时目录已清理（项目 worktree 全程零触碰：结束时 `git status` 与开始时一致 + 本报告）。

## 12. 产物

- 本报告：`wiki/raw/task_issue-154_sa7_report.md`（worktree 内唯一新增）
- 探针脚本与会话日志（worktree 外，未提交，供复核）：`/tmp/sa7-probes/{lib,probe1_default_byte_budget,probe2_child,probe2_crash_windows,probe3_lease,probe4_trim_resume,probe5_ns_deletion,probe6_residuals}.ts`；日志 `/tmp/sa7-p1.log`、`/tmp/sa7-p2.log`（W2 捕获）、`/tmp/sa7-p2-w1.log`（W1 捕获）、`/tmp/sa7-p3.log`…`/tmp/sa7-p6.log`、`/tmp/sa7-pkg-tests.log`、`/tmp/sa7-repo-gates.log`、`/tmp/sa7-cf-run.log`

## 13. 结论

SA4 R1 的唯一 P1（P2 字节遍历年龄门）修复在**真机默认配置**（30d/1GiB、1.113 GiB 新鲜数据）下被独立证实可执行；真实 SIGKILL 捕获 W1 与 W2 两个中断窗口并验证完整恢复链（无 rotate、连续后缀、reader ok、幂等重扫）；租约安全/过期/续租/释放、裁剪后 reader/resume 一致性（含中洞仍腐反向锚）、namespace 删除全套语义、SA4 残余 R2/R4/R6 全部通过；T-A9 经反事实变异证明为真红钉、无测试掩蔽。**Verdict: PASS**（残余 6 项观察均 Info 级，随报告移交）。
