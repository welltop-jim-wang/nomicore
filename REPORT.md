---
status: complete
run_id: controller-welltop-jim-wang-nomicore-155-1788486400000-a4ac1bb8-b42e-4706-af36-f3119ac63b8d
task_type: feature
branch: mabf/issue-155
started_at: 2026-09-03T00:00:00Z
finished_at: 2026-09-04T10:15:00Z
---

# Issue #155 — Expose diagnostic replay and Host lifecycle configuration

## 概要

完成 Host/Registry 诊断日志启用、生命周期管理与严格 replay 的本地 MABF 验收。恢复轮已补齐 SA3 回归诊断、SA4 静态复审与 SA7 动态验证；二者均为 pass/approve。

## 变更

- 为 yjs-server Host 配置、诊断管理器和停机生命周期接入诊断日志。
- 为 Registry/Runtime 接入按 namespace 键控的诊断 emitter，并暴露 replay 能力。
- 增加 Host 生命周期 E2E 契约及 SA7 动态验证覆盖。
- 更新相关包版本及 lockfile；完整任务档案位于 `wiki/raw/task_expose-diagnostic-replay-host-lifecycle*.md`。

## 验证

最终由 Controller 后台独立进程运行：

```text
pnpm typecheck && pnpm test
exit code: 0
Test Files  259 passed (259)
Tests  2854 passed (2854)
Type Errors  no errors
Duration 504.28s
```

本恢复轮（job `bash-1`）已重新执行完整验证；类型检查覆盖 14 个 tsconfig 且成功，随后 Vitest 完整通过（259 files / 2854 tests，Duration 503.34s）。

首次按过时项目脚本策略尝试 `source scripts/test-lock.sh` 因该脚本不存在而以 exit 1 结束；已检查根 `package.json` 的权威 scripts 后，以上直接 `pnpm typecheck && pnpm test` 重跑为最终通过证据。

附加门禁：

- `git diff --check`：通过。
- SA4 R3：pass/approve；独立全量 259/2854 通过。
- SA7 R4：pass/approve；SA6 契约 22/22、SA7 补充 6/6、全量 259/2854 与 typecheck 均通过。
- AC checklist：AC1–AC6 全部满足（`wiki/raw/task_expose-diagnostic-replay-host-lifecycle_ac_checklist.md`）。

提交受共享 gitdir 只读沙箱阻塞：`/home/wangjian/nomicore/.git/worktrees/nomicore-fix-issue-155/index.lock` 无法创建。已生成未跟踪的本地收尾脚本 `.mabf-bg/finalize-commit.sh`，供外层无沙箱环境执行；该目录不应入库。

---

# Issue #228 — Host namespace 数据删除 ⇄ 诊断日志逻辑删除联动 + PR #142 阶段验收

## 概要

交付 Host 控制通道 `delete-namespace`（hub-only 终态删除编排：摘除复制暴露 → Registry
`deleteNamespace`（ADR-0009 修订节：forceRelease + close drain + entry 移除）→
Persistence `deleteDoc`（ADR-0006 修订节：主键 + 受控归档位逻辑删除，复活向量封堵）→
同步调用 `deleteNamespaceDiagnosticLog`（#154 既有能力）→ ack。`ok:true` ⟺ 同一回执
周期内数据快照与 `{logRoot}/namespaces/{ns}` 目录树均完成逻辑删除（ADR-0012-LOG L299
Host 联动义务的兑现）；失败 → 诚实失败码族（`delete-namespace-failed` /
`log-delete-failed{step,errno}`），重入重试是唯一完成路径。AC1 红灯契约 D1–D4 全绿
（进程级 E2E，真实文件产物断言）。

## PR #142 阶段汇总（tracking issue #141）

PR #142（`docs: specify namespace diagnostic change log`）定义 namespace
diagnostic-change-log 的规格面，权威表述以 CONTEXT.md / ADR-0011 / ADR-0012-LOG（含
首切片 amendment）为准；其实施交付票 #148–#155 沿「SA6 红灯契约 → 实现 → SA4 静态复审
→ SA7 动态验证」逐票闭环并合入本分支历史（#156/#159/#166/#167/#194/#196/#200/#223），
随后的 #226/#227 修复（#248/#250/#251）亦已合入本分支基线；本票 #228 = PR #142 的阶段级
端到端验收（namespace 数据删除 ⇄ 诊断日志删除联动交付 + AC1–AC5 收口，含下述最终门
证据）。tracking issue #141 与 PR #142 title/body 的验收材料同步为发布侧动作（见「发布
侧移交（runner 待办）」），本报告只如实记录内容与证据，不代 runner 假报完成。

各交付票阶段结果（交付物 + 验证证据路径）：

| Issue | 阶段结果 |
|---|---|
| #148 | 冻结 v1 诊断记录契约 + 有界内存 adapter（`@nomicore/namespace-diagnostic-log` v1 公共面；ADR-0011）；SA6 契约全绿 + SA7 总 verdict pass（5/5 AC）—— `wiki/raw/task_diagnostic-log-v1-contract_ac_checklist.md`、`wiki/raw/task_diagnostic-log-v1-contract_sa7_report.md` |
| #149 | ROOT mutation / SCHEMA replacement 记录接入；AC checklist 全绿 + SA7 pass（含 SA7-F-1 类型层修复，零行为变更）—— `wiki/raw/task_root-schema-diagnostic-change-log_ac_checklist.md`、`wiki/raw/task_root-schema-diagnostic-change-log_sa7_report.md` |
| #150 | namespace create 生命周期与 genesis 记录（create-diagnostic seam + detached genesis supplier）；AC1–AC5 全 ✅ —— `wiki/raw/task_namespace-diagnostic-change-log_ac_checklist.md` |
| #151 | trusted replication 与复制管理写记录（含 committed `replication-apply`）；SA7 verdict pass —— `wiki/raw/task_trusted-replication-management-diagnostic-change-log_sa7_report.md` |
| #152 | VFSL-validated JSONL + BIN sidecar 持久化与严格读取（File adapter 主体，r1+r2 两轮）；AC checklist + SA7 pass —— `wiki/raw/task_diagnostic-log-file-adapter-r2_ac_checklist.md`、`wiki/raw/task_diagnostic-log-file-adapter-r2_sa7_report.md` |
| #153 | reopen / roll / repair provable tails；SA7 r1–r3 各轮 verdict pass —— `wiki/raw/task_diagnostic-log-stream-roll-repair-r2_sa7_report.md` |
| #154 | retain / lease / delete namespace diagnostic logs（`deleteNamespaceDiagnosticLog` 由本票 #228 直接复用）；SA7 verdict PASS —— `wiki/raw/task_issue-154_sa7_report.md` |
| #155 | 诊断 replay 暴露 + Host 生命周期配置（本报告 #155 章，全量 259/2854）；AC1–AC6 全满足 —— `wiki/raw/task_expose-diagnostic-replay-host-lifecycle_ac_checklist.md` |
| #226 | 修复创建诊断覆盖与日志生命周期隔离（fix #248 合入本分支基线）；独立动态终验 approve：全量 260/260 文件、2869/2869 用例、typecheck 14 项目零错误（2 条 vitest worker RPC 编排超时为负载噪声、零测试失败）—— `wiki/raw/task_issue-226_final_verify.md`、`20260906-issue-226-final-full-run.md` |
| #227 | strict replay 读取租约与完整性判定（fix #251 = 本分支基线 HEAD）；SA7 rev2 全量 2917/2917 + typecheck exit 0，verdict approve —— `wiki/raw/task_issue-227_rev2_sa7_report.md` |
| #141 | tracking（OPEN）：上述交付票的验收跟踪；阶段结论以本报告 + PR #142 为准；issue 侧验收材料同步 = 发布侧待办 |

## 变更（SA3 implementation round 交付面）

- `packages/persistence`：`DocPersistence.deleteDoc?` / `ReplicaPersistence.deleteDoc`
  （required）+ typed 错误族（`DocDeleteActiveHandleError` / `DocDeleteOperationalError` /
  `DocDeleteFatalError`）+ lifecycle `'deleting'` cell 全消费方（M1）+ settle-for-delete
  cancel-then-evict（M2，SA2 绿锚 T-P2b）+ `PersistenceIO.removeKey`（File 主键先提交点/
  归档位后全清；Memory 双分区 + deleteSnapshot hook 纪律）+ 新增
  `test/doc-delete-semantics.test.ts`（T-P1/T-P2，7 用例）与 `test/doc-delete-storage.test.ts`
  （T-P3/T-P4，8 用例）+ 冻结面守卫更新（SA7 动态守卫、import-red 保持性守卫、
  archive-surface test-d——deleteDoc 由禁词表移入 required 成员锚）+ 测试 seam
  `failNextRemoveKey`。
- `packages/namespace-registry`：公共面 `deleteNamespace(owner, namespaceId)`（carrier
  per-key 串行；capability 前置门；owner 零泄露；absent 幂等 ok；close 失败 /
  deleteDoc operational → `NAMESPACE_DELETE_FAILED`）+ `registry-delete-orchestration.test.ts`
  （T-R1–R4，9 用例）+ 冻结面守卫更新（surface test-d 正向锚、SA7 动态守卫恰七面）。
- `apps/yjs-server`：`delete-namespace` op（G1 角色门 → G2 参数门 → G3 known-set +
  tombstone → G4 单飞；M3 全链 try/catch 收编）；诊断 manager retirement（AD-4：
  `retireNamespace` + drop reason `namespace-deleted` + `initStream` un-retire）；
  `apps/yjs-server/AGENTS.md` 管理动词段补 hub-owned 终态删除动词。
- 红灯契约文件头注更新（红灯 → 已转绿）与 D4 断言级仲裁注记（见下）。
- 文档（AC3，向 ADR-0012-LOG 首切片 amendment 收敛）：`CONTEXT.md` 语义 emission 词条、
  `packages/namespace-diagnostic-log/README.md` 与同包 `AGENTS.md` 的「绝不阻塞」矛盾文本
  修订（interface 非阻塞契约 vs File adapter 首切片有界同步 append 可被 fs 延迟阻塞的
  区分 + 调用点纪律）；`docs/adr/0011-…md` 澄清性修订节（非决策变更）；`docs/adr/0006`
  与 `docs/adr/0009` 显式修订节（B1 备案，随代码同一变更集落文）。

## 验证（SA3 轮证据 + 收尾轮最终门证据）

- AC1 红灯契约 `apps/yjs-server/test/host-namespace-delete-diagnostic-link-red.test.ts`：
  D1 同步联动 + 干净停机 / D2 幂等二删 / D3 参数门 + 进程存活 / D4 重启不复活：**4/4 绿**
  （真实 main.ts hub + file persistence + diagnostics enabled + provision；stdin NDJSON；
  真实文件产物断言）。
- `packages/persistence/test` 全量（iteration 8 复测 `vitest run packages/persistence/test --typecheck`）：
  **18 files / 178 tests passed**（17 个运行时文件 173 用例 + test-d 类型面 5/5，
  Type Errors no errors）；新增 doc-delete 两套件 15 用例全绿（semantics 7 + storage 8）。
- `packages/namespace-registry/test`：registry-delete-orchestration 9/9 绿；全量套件见下
  最终门证据（注：`registry-phase5-replication-session-red.test.ts` 两条 AC-5 degraded
  用例（`peer persistence-degraded` 与 `补锚 (a)`）的负载型 5s 预算超时形态在收尾轮全量
  run 中**实测再现**——2026-09-07 19:39 落盘的全量 run（`/tmp/sa3-228/full-test-3.log`，
  `1 failed | 2983 passed (2984)`）中 `补锚 (a)` `Test timed out in 5000ms`
  （5427ms）；随后 19:53 给两条用例落地显式 per-test timeout 20s（零断言改动），单文件
  复核 22/22 绿（`/tmp/fix-check-session-red.log`），20:15 全量 run 279/2984 绿
  （`/tmp/gate-full-test.log`），iteration 8 终验两轮亦零测试失败——详情与其余 4 处
  收尾轮测试稳定性改动见「收尾轮记录」节 item 1）。
- D4 断言级仲裁（SA3 implementation round 记录，供 SA4/SA7 核对面）：
  1. 原契约「重启后 namespaceId 确定性派生 .toBe(已删 id)」与设计 R-1 冲突（删除是终态，
     重启 provision 重建 = 新 namespace 新身份；CSPRNG 生成下无确定性派生机制——实测
     两次独立 boot 均不同 id，含未删除对照组）。按 R-1 修订为：重启健康 + 重建合规新 id
     + 已删旧 generation 零复活 + 无 deletion.json 半态 + 新流非旧流。
  2. tsx CLI wrapper 对「ready 后 ~600ms 窗口内 SIGTERM」存在自身 choreography 竞态
     （直接 signal 应用子进程恒优雅 exit 0——与本次实现无关的既有 wrapper 行为）；D4
     第二 boot 停机前加有界 settle（1.5s），进程健康断言不变。

## 收尾补录（SA3 iteration 3：SA4 approve 附带条件 F-1/F-2/F-5）

- **F-1（D4 断言仲裁追认协调）**：SA3 侧已完成勘误与证据包
  （`wiki/raw/task_228_sa3_implementation_notes.md` §3.1）：D1–D3 零断言改动转绿、D4
  断言级仲裁（R-1 方向）的物理不可能性证明（CSPRNG 2^-128）、披露点清单与追认请求
  （SA6/SA8 追认 + SA1 勘误 design AD-2 表述）。红灯测试不回滚。
- **F-2（ActiveHandle 映射注释对齐）**：`packages/namespace-registry/src/registry.ts`
  `runDeleteSlot` ⑤ catch 注释重写——与代码及 ADR-0009 修订节 §5（新规范文本，二者
  一致：ActiveHandle 属「其它 throw → branded fatal committed:false」）对齐；design
  AD-6 步骤 5 文本分歧标注待 SA1 勘误。零行为改动（外部可观察结局两端相同、分支理论
  不可达）。
- **F-5（T-H5–H8 落地；SA4 §2.5 缺口关闭）**——四个 host 测试文件（进程级 E2E、
  真实 spawn、零源码 grep）本轮实现并实测全绿：
  1. `apps/yjs-server/test/host-namespace-delete-under-replication.test.ts`（T-H5，
     AD-7/R-2 唯一行为锚：活跃 peer channel 中 delete → 双向收敛前置 → ack ok 且
     数据/日志全清 → channel 失败收口不崩溃 → 驱动写 + 观察窗口无快照复活 → hub
     健康直至双向 SIGTERM exit 0）✅ 1/1（42.5s）
  2. `apps/yjs-server/test/host-diagnostic-restart-resume.test.ts`（T-H6，AC2 restart
     正向：重启续写同一 stream、sequence 跨 boot 连续、数据恢复一致、strict 全绿）
     ✅ 1/1（19.5s）
  3. `apps/yjs-server/test/host-diagnostic-retention-sweep.test.ts`（T-H7，AC2
     retention：config retention 透传 → 构造期 sweepOnOpen 删除前代闭组
     （retention-swept{deletedGroups≥1} NDJSON 事件）、当前流开组零损伤）✅ 1/1（22.3s）
  4. `apps/yjs-server/test/host-trusted-replication-diagnostics.test.ts`（T-H8，AC2
     trusted+diag：双侧 diagnostics，peer trusted apply 落 committed
     `replication-apply` 记录、strict replay complete、双侧数据一致）✅ 1/1（12.9s）
- **iteration 3 回归复跑**：红灯契约 D1–D4 4/4 绿；doc-delete 两套件 +
  registry-delete-orchestration 24/24 绿；根 `pnpm typecheck` exit 0；
  `git diff --check` clean。
- 收尾轮移交状态（SA10 §4/§7 收敛清单）：F-3（REPORT M4 改述，见「残余风险」节）与
  F-7/SA7-F-1（既有边际测试文件显式 per-test timeout / 编排竞态修复——收尾轮实际共 5 个
  文件：SA10 §7.1 清单 3 个 + 收尾轮自跑全量 run 驱动的另 2 个，见下「收尾轮记录」节
  item 1）已在收尾轮执行；F-4（design §3 ALLOW LIST 补录 4 文件）属 SA1 路由，不在本
  worktree 执行面；F-6 已由 SA7 动态闭合（doc-delete-sa7-realtime 30/30 绿）。

## 收尾轮记录（SA3 iteration 5 + iteration 8——SA10 reject 收敛与四门终验；dispatch sa-6a98f683-add3-4694-a90d-4f4527b55b89 / sa-13f86931-7fe9-4e93-8001-8fca50f09ea2）

本轮输入：`wiki/raw/task_228_sa10_spec.md`（reject：AC4 全量门按记录未绿；AC5 REPORT
不完整/失准/陈旧 + 发布侧待办未披露）、design §3/§5/§7、SA7 §5 门证据、SA4 F-3/F-7、
SA10 §7 收敛清单。零生产行为/零断言改动；仅收尾卫生 + 测试预算/编排修复 + 元数据收口
（iteration 5 落树；iteration 8 复核在场并完成四门终验复跑与 REPORT 定稿——下述）：

1. **AC4 门禁修复（5 个既有边际测试文件——SA10 §7.1 清单 3 个 + 收尾轮自跑全量 run 驱动
   的另 2 个；只放预算/修复测试编排竞态，零 skip、零断言弱化）**：
   - `packages/namespace-registry/test/registry-phase5-replication-red.test.ts`
     AC-6 `persistence-degraded` 用例显式 per-test timeout 20s（SA4 F-7 基线实测
     4744/5000ms 边际、全量负载 6272ms 超时）；
   - `packages/vfsl-codegen/test/generate-cli-check.test.ts`：3 个多 spawn 用例显式
     per-test timeout 20s（SA7 复跑 5288–5557ms 超时、`--test-timeout 20000` 8/8 绿为
     证据基础）；
   - `packages/ws-replication/test/ws-replication-sa7-issue171-real-transport.test.ts`
     RT-G5 注入前加 wire 静默同步（等基线 UPDATE 的 UPDATE_ACK 到达 peer 再注入——消除
     注入帧与在途 ACK 同序列竞速 → ACK_STATE_VIOLATION → 'blocked' 的既有编排竞态，
     SA7 全量运行观测形态）+ RT-G5 显式 per-test timeout 30s；
   - `packages/namespace-registry/test/registry-phase5-replication-session-red.test.ts`
     AC-5 两条 degraded 用例（`peer persistence-degraded` 与 `补锚 (a)`）显式 per-test
     timeout 20s——驱动：收尾轮全量 run（`/tmp/sa3-228/full-test-3.log`，2026-09-07
     19:39 落盘，`1 failed | 2983 passed (2984)`）实测 `补锚 (a)` `Test timed out in
     5000ms`（5427ms）；
   - `apps/yjs-server/test/diagnostic-replay-host-lifecycle-red.test.ts` E4：
     `signalAndExpectExit` 对 SIGTERM 先做 1.5s 有界 settle 再 kill（越过 tsx wrapper
     ready 窗口——与 host-namespace-delete-diagnostic-link-red D4 停机前 settle 同款
     wrapper 编排竞态先例；`waitForExit(30_000)` 有界窗与 `exit code === 0` 断言不变，
     E1–E5/v1/v2 全部 SIGTERM 用例同受益）——驱动：收尾轮全量 run
     （`/tmp/sa3-228/full-test-2.log`，2026-09-07 19:07 落盘）实测 E4 `expected 143 to
     be +0`（exit 143）。
2. **F-3（AC5-b）**：REPORT「残余风险」M4 条目改述（marker 门 = 同 id 重建防线；
   provision 恒派生新 CSPRNG 身份；唯一现实路径 = importReplica 显式同 id；SA7 重点
   8 实测引用）——见「残余风险」节。
3. **AC5-a/AC5-c**：本报告补 PR #142 / tracking issue #141 阶段汇总（各交付票一行阶段
   结果 + 验证证据路径，见「PR #142 阶段汇总」节）；验证节吸收最终四门证据（下述）；
   「未决移交」陈旧表述已清除（本收尾轮记录取代）。
4. **MINOR 卫生（SA10 §5）**：M-1（本包 README 快速示例注释限定内存 adapter 语境——
   消除无前缀「不阻塞」残留）；M-2（registry.ts L1980 区陈旧注释改写为「design §10
   勘误 E-2 已闭环」，零行为）。M-3（design §3 ALLOW LIST 补录）路由 SA1；
   M-4/M-5/M-6 维持既有备案。

**最终四门证据（CI 同入口同参；iteration 8 终验复跑实际结果，dispatch
sa-13f86931-7fe9-4e93-8001-8fca50f09ea2）**：

| 门 | 命令 | 实际结果（iteration 8 实测） |
|---|---|---|
| root typecheck（14 包 tsc 链） | `pnpm typecheck` | **exit 0**（Type Errors no errors；日志 `/tmp/typecheck-run.log`） |
| 生成物零漂移（ADR-0005） | `pnpm generate --check` | **exit 0**（零漂移；日志 `/tmp/generate-check-run.log`） |
| 全量测试（CI Test 同入口） | `pnpm test`（vitest run --typecheck，maxWorkers 1） | **exit 0**：279 files / 2984 tests 全过、Type Errors no errors、Duration 563.32s（日志 `/tmp/full-test-run-2.log`） |
| whitespace 门 | `git diff HEAD --check` | **clean（exit 0）** |

全量测试的首轮复跑曾因宿主机被 7 个跑飞 `grep -R` 进程（各占 55–87% CPU、累计运行
数天）饥饿而出现 **2 条 vitest worker RPC 编排超时**（`Timeout calling "onTaskUpdate"`）→
exit 1，但该轮本身**零测试失败**（279/279 文件、2984/2984 用例全绿，日志
`/tmp/full-test-run.log`）——与 #226 终验曾观测的同类 vitest worker RPC 负载噪声形态
一致；清理跑飞进程使 4 核宿主机空闲后复跑即 exit 0（上表）。两轮全程**零 skip/零断言
弱化/零 fallback**；SA10 §4.1 所列 3 个边际文件（registry-phase5-replication-red AC-6、
generate-cli-check spawn 用例、ws-replication-sa7-issue171-real-transport RT-G5）在
全量 run 中均以放宽后的显式 per-test timeout 通过（grep 日志直证），SA10 §4.1 所列 5
例失败形态未再出现；收尾轮自跑全量 run 另现的两形态——E4（19:07 run
`/tmp/sa3-228/full-test-2.log` 得 143）与 `补锚 (a)`（19:39 run `/tmp/sa3-228/
full-test-3.log` 5000ms 超时）——已分别于 19:14（1.5s settle）与 19:53（20s 预算）修复
落树，披露见上 item 1；两处修复均在 20:15 全量 run（`/tmp/gate-full-test.log`）之前
落树，其后 20:15/20:41/20:51 各全量轮零测试失败。5 个改动文件在 iteration 8 终验
run（`/tmp/full-test-run-2.log`）中全绿（replication-red 16/16@856ms、
generate-cli-check 8/8@4874ms、ws-171-real-transport 4/4@3618ms、session-red
22/22@1695ms、diagnostic-replay-host-lifecycle-red 22/22@47067ms——grep 直证）。

CI 具名物化步骤 ×4（`--passWithNoTests=false`）由 SA7 §5.2 逐条同款复跑全 exit 0
（`task_228_sa7_report.md` §5.2）；push 后 CI run 的 runner 侧核验见下。

**发布侧移交（runner 待办——如实披露，不假报完成）**（AC5-d / design §5；均不属本
worktree 可执行面）：

- PR #142 title/body 增补「namespace 删除联动交付（issue #228）」段（op 面、删除语义
  （逻辑删除/幂等/失败码族）、ADR 修订节清单 0006/0009/0011、文档对齐清单、验证命令与
  结果——内容以本报告为素材）；title 若需反映阶段终态由 runner 裁量。
- tracking issue #141 验收材料同步（指向本 REPORT.md 与 PR #142；引用权威文档）。
- push 后 CI run 核验（本地门与 CI 同入口同参；SA7 §5 记录 + 本收尾轮四门）。
- git 配置残留核对：`mabf.branch`/`mabf.base-branch` 与本票不符（冲突报告已备案），
  总控收尾时向 runner 核对。

## 残余风险（M4 备案 + 设计 §7 承接）

- **marker 门 = 同 namespaceId 重建防线（M4 改述——SA4 F-3/SA10 §4.2-b 落地）**：
  日志删除失败（`deletion.json` marker 落盘）后的**半态防线**只约束「同 namespaceId
  重建」——provision 按配置重建每次派生**新 CSPRNG 身份**（等 id 概率 2^-128），因此
  provision 路径不会命中 marker 门；该防线唯一现实路径 = importReplica 显式同 id 导入。
  SA7 重点 8 实测：F5 注入（marker 半态）+ 重启 + provision → 新 id 新流健康落盘、零
  `stream-init-failed{reason:'namespace-log-deleted'}`、旧目录树零复活。D4 仅覆盖成功
  路径，不受影响。
- R-1 声明式 provision 与删除的张力：provision 配置存在的 namespace 删除后重启会被按
  配置**重建为新 namespace（新 id、新流、新身份）**——配置权威性的既定行为；运维要
  「保持删除」须同时移除 provision 条目。
- R-2 在途复制 channel 的异步失败通知（非优雅拆除）；T-H5 钉死行为已入全量验收组合并
  绿（full run 1/1；iteration 8 终验日志亲证）。
- R-3 非 Owner 输入的零预言边界（absent 删除对任意 owner ok:true；live owner 不符才
  NOT_FOUND）——ADR-0009 修订节明示。
- 删除是活跃存储逻辑删除，不承诺 SSD/备份/对象存储版本物理 secure erase（部署策略）。

## 勘误收口（iteration 9——SA4 iteration 2/3 F-11/F-12 落树；dispatch sa-a61fe7c4-7d6b-4e60-8f6c-8eeba5af9a61）

SA4 iteration 2/3 驳回点 = AC5 REPORT 勘误未落树（REPORT.md 自 20:54 定稿后零写入）。
本轮按 Required revisions 逐项落树，**零生产代码/零测试断言/零 skip 改动**：

1. **「收尾轮记录」item 1 改述为 5 文件清单**（F-11）：补
   `registry-phase5-replication-session-red.test.ts`（AC-5 两用例 20s，驱动 =
   19:39 全量 run `/tmp/sa3-228/full-test-3.log` 补锚 (a) `Test timed out in 5000ms`
   5427ms）与 `diagnostic-replay-host-lifecycle-red.test.ts`（E4 `signalAndExpectExit`
   SIGTERM settle 1.5s，驱动 = 19:07 全量 run `/tmp/sa3-228/full-test-2.log` E4
   `expected 143 to be +0`）；原『3 文件』少报口径已消除（含「收尾补录」节移交状态
   句）；SA3 notes §6.1 表同步补两行。
2. **验证节 session-red 注记更正**（F-12）：删除原注记末尾的假性负结论句（宣称两轮
   全量 run 均未观察到两条用例失败的断言）——19:39 收尾轮全量 run 实测再现
   （补锚 (a) 5000ms 超时，5427ms）→ 19:53 显式 20s 预算收敛 → 19:53 单文件复核 22/22
   与 20:15 全量 run 279/2984 绿 → iteration 8 终验两轮零测试失败；四门段落同步补充
   5 文件在 `/tmp/full-test-run-2.log` 的逐文件全绿数据。
3. **注释归属修正**（可选建议已采纳）：`registry-phase5-replication-session-red.test.ts`
   L1028 注释「SA7 全量运行 2026-09-07 19:39」→「SA3 收尾轮全量 run（/tmp/sa3-228/
   full-test-3.log，2026-09-07 19:39 落盘）」（该 run 为 SA3 收尾轮自身 run；SA7 日志
   全部 12:39–13:26，无 19:39 run）。零行为。
4. **OBS-2 顺手补一词**：阶段汇总段 fix 合入清单 #248/#251 → #248/#250/#251
   （git log 亲证 #250 在基线 HEAD 路径内）。

本轮验证：REPORT/notes grep 复核——两文件名在场、原假句与『3 文件』少报口径零残留；
`git diff HEAD --check` clean；`registry-phase5-replication-session-red.test.ts` 单
文件复跑 22/22 绿（注释改动零行为佐证）。未改任何断言/时限/生产代码；无需重跑四门
（SA4 iteration 3 已声明当前树验绿）。
