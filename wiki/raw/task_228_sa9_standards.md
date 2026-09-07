# SA9 Standards 审查报告 — Issue #228（Host namespace 数据删除 ⇄ 诊断日志逻辑删除联动 + PR #142 阶段验收）

> SA9（独立 Standards 审查者）standards-review 轮产物。dispatch
> `sa-36b0c302-da8b-4988-9334-251b52b23204`，phase standards-review，iteration 2。
> **Worktree**: `/home/wangjian/nomicore-fix-issue-228`（branch `mabf/issue-228`，HEAD `6467078`；
> 被审对象 = 当前最终未提交全量 diff：**32 M + 23 ??**——与 SA4 iteration 4 批准时计数逐位一致，
> 本轮 git status 亲证）。
> **Issue 评论输入**: 派遣简报明示 REST 已读 = `[]`（无 Owner 追加要求；评论 ID/updated_at：无）；
> 本轮 `gh issue view 228` 复读亲证：OPEN、5 AC、comments `[]`。
> **输入产物（全部亲读）**: `task_228_dispatch.md`、`task_228_conflict_report.md`（前置 clear + B1–B3）、
> `task_228_design.md`（round 1 + §10 勘误 E-1/E-2）、`task_228_design_conflict_report.md`
> （iteration 1/2 clear）、`task_228_relevant_decisions.md`、`task_228_sa2_review.md`（M1–M4/O1–O5）、
> `task_228_sa3_implementation_notes.md`（iteration 2–9）、`task_228_sa4_review.md`
> （iteration 4 approve + 前四轮档案）、`task_228_sa6_acceptance_contract.md`（含 §7 追认节）、
> `task_228_sa6_f1_ratification.md`（approve）、`task_228_sa7_report.md`（approve）、
> `task_228_sa10_spec.md`（reject + §7 收敛清单）、REPORT.md（21:36 勘误收口版，307 行全文）、
> 当前全量 diff（生产/测试/文档逐 hunk）+ 仓库 AGENTS.md 链（根 / docs / packages/persistence /
> packages/namespace-registry / apps / apps/yjs-server）。
> **审查方式**: 代码/测试/文档逐 diff 亲读 + 定向 grep（措辞红线、skip/only、少报口径、假句残留）
> + 只读门（`git diff HEAD --check` 自跑）+ 证据日志对读（`/tmp/full-test-run-2.log`、
> `/tmp/sa3-228/full-test-{2,3}.log`、`/tmp/fix-check-session-red.log`、`/tmp/typecheck-run.log`、
> `/tmp/generate-check-run.log`、`/tmp/sa4-i4-session-red.log` 逐一开卷）。
> **边界**: 零业务代码/设计/测试改动；**未运行测试、未启动服务**（SA9 纪律）；零 commit/push/PR；
> 唯一写入 = 本文件。**不复用结论声明**: SA4 iteration 4 的 F-11/F-12 闭合 approve 已知悉，
> 但本报告全部结论独立取证。
> **职责面**: 本审查只判断实现是否符合仓库 AGENTS、ADR、模块责任、既有架构惯例、单一事实源、
> 生命周期对称性、文件范围与测试质量标准；Issue 需求完整实现归属 SA10（其 reject 已收敛，
> 收敛结果在本轮作 standards 面复核）。

---

## Verdict

**approve**（`requiresConflictRecheck: false`）

- **0 BLOCKER / 0 MAJOR**。当前最终 diff 在模块边界、ADR 正式化演进、单一事实源、生命周期
  对称性、措辞纪律、测试完整性、证据真实性七个 standards 面全部合规（§1–§7）。
- SA4 iteration 4 批准的 F-11/F-12 收口经本轮独立复核**确认属实**（§6）：REPORT 五文件披露面、
  既往复现事实、fresh 四门证据逐环与日志对上；少报口径与假性负结论零残留（grep 亲证）。
- 6 项 MINOR/OBS（§8）均为已登记备案项或 HEAD 既有形态，无一阻断。

---

## 1. 模块责任与包边界（AGENTS.md 链）

| 模块 | 本轮亲证 | 判定 |
|---|---|---|
| `apps/yjs-server`（组合根；只消费包公共导出、不触 testing seam） | `app.ts` 新增 import 仅 `type DeleteNamespaceResult`（`@nomicore/namespace-registry` 主入口）与 `deleteNamespaceDiagnosticLog`（`@nomicore/namespace-diagnostic-log` 主入口——index.ts L100 公共导出亲证）；`diagnostics.ts` import 面零新增包；grep 亲证全部 `src/` 零 `/testing` subpath、零包内部路径 | ✅ |
| `packages/persistence`（公共导出走 index.ts；hostile/test 控制在显式 testing 面） | 三错误族 + `DocDeleteFatalPhase` 经 `src/index.ts` 导出；`failNextRemoveKey` 故障缝落在 `src/testing.ts`（`@nomicore/persistence/testing` 显式面），生产装配路径零引用（grep 亲证） | ✅ |
| `packages/namespace-registry`（公共 API 只经 index.ts；owner 检查 fail-closed 不泄露存在性） | `DeleteNamespaceIssue/Result` 经 index.ts；`runDeleteSlot` ① live entry owner 不符 → `NAMESPACE_NOT_FOUND`（不区分属他人/不存在）；absent 输入对任意 owner `{ok:true}`——ADR-0009 修订节 §4 明示的不对称逐字落地 | ✅ |
| `apps/yjs-server/AGENTS.md` 管理动词段 | 同变更集补 hub-owned `delete-namespace` 段（角色门/参数门/known-set+tombstone/单飞/复合谓词/诚实失败码族/进程不因控制输入退出）——docs/AGENTS.md L13 法定义务履行 | ✅ |
| `docs/integration/hub-peer-deployment.md` 稳定码注册表 | append-only 追加 `delete-namespace-failed \| log-delete-failed` + 动词表行（docs/AGENTS.md L13 同款义务） | ✅ |

## 2. ADR 与既有架构惯例（B1–B3 兑现核验）

- **B1（冻结 v1 公共面演进正式化）**：ADR-0006「逻辑删除修订（2026-09-07，issue #228）」
  5 条（契约/语义/幂等失败面/状态机复活封堵/capability）与 ADR-0009「issue #228 修订节」
  §1–§5（公共面增量/逐出复用逐字区分/编排原子性/零存在性泄露/失败观测）随代码**同变更集
  落文**（diff 亲证），自声明演进通道（SA8 前置 B1 预授权 + 设计后复审 clear），先例
  #64/#79/#133/#131/#134 同款。ADR-0011 走**澄清性修订节**且自声明「非决策变更」。
  **无静默扩面**：冻结面守卫同变更集演化——registry surface test-d 将 `deleteNamespace`
  移出禁词表**并加正向 required 锚**（语义区分注记在场）、禁词表反增 `evictNamespace/
  forceCloseNamespace`；persistence archive-surface test-d 同款；两 SA7 动态守卫改「恰七面」
  + required 成员锚；import-red 保持性守卫断言翻转附受管 seam 裁决注记。守卫语义是
  「未受协调裸旁路面」对「受管 seam」的精确化，净强度不減。✅
- **B2（同步联动 + 隔离语义显式裁决）**：AD-3 全序在实现中逐字在场（app.ts
  `runDeleteNamespace`：① retire → ② 摘除复制暴露+tombstone → ③ registry.deleteNamespace
  → ④ 槽外同步 `deleteNamespaceDiagnosticLog` → ⑤ 事件+回执）；同步重 fs 调用点在 stdin
  macrotask、registry carrier 槽外（amendment 纪律的同类从严适用）；复合谓词 `ok:true` ⟺
  数据+日志同回执周期删除；失败码族 `invalid-op-args / namespace-unknown /
  delete-namespace-failed / log-delete-failed{step,errno}`（errno 值域逐字透传包内 failed.code，
  不发明第二词表——N3/O4 亲证）。✅
- **B3（措辞红线）**：diff 新增行中 `secure erase/erase/purge` 命中**仅为否定句**
  （「不承诺……secure erase」×3 处）与 ADR-0006 修订节的措辞纪律自指；「绝不阻塞」全文
  残留仅 ADR-0011 澄清节自我覆盖条款（援引 amendment）与 README L30 已限定内存 adapter
  语境的注释（M-1 修复在场）；CONTEXT.md 语义 emission 词条、包 README L311 区、包
  AGENTS.md L16 区三处矛盾文本均向 ADR-0012-LOG 首切片 amendment 收敛（后决优先），
  queue/batch/fsync/fd 一律标注「目标演进形态而非现行特性」。✅
- **AD-9 零漂移面（本轮定向 diff 亲证）**：`packages/ws-replication/src`、`docs/protocols/`、
  `apps/yjs-server/src/config.ts`、`src/main.ts`、`domains/`、`packages/vfsl/src`、
  `packages/namespace-runtime/src`、ADR-0012-LOG 全部 **0 行 diff**；`generate --check`
  exit 0（日志在场）与零 schema 改动互证。✅

## 3. 设计忠实度与 SA2 实施条件（M1–M4）

- **AD-1~AD-9 逐条吻合**（逐 hunk 亲读）：三段式落点（persistence `deleteDoc` + registry
  `deleteNamespace` + Host 编排）、G1–G4 门禁次序（全部先于 fs）、AD-4 retirement 面
  （`retireNamespace` 幂等、drop reason 第四值唯一产生方纪律注释在场、`runtimeEmitterFor`
  retired 检查**先于** ensureAdapter、`initStream` 先 un-retire、`close()` 语义不变）、
  AD-5 settle-for-delete、AD-6 编排 ①–⑥、AD-7 零 ws-replication 改动、AD-8 六行失败矩阵、
  AD-9 不变项。✅
- **M1（'deleting' cell 全消费方）**：lifecycle.ts 全部 cell 消费点亲证——`exclusiveCreate`
  L268、`runArchiveDoc` claim 环 L494、`runDeleteDoc` claim 环 L595、`seedForTest` 拒绝清单
  L786、`loadSlowPath` L865；`assertOwnedHandle`/`maybeEvict`/`settleEntryForArchive` 对
  非 live 态的自然收口逐一核对无 busy-loop/错误分类/覆写面。✅
- **M2（cancel-then-evict 次序）**：`settleEntryForDelete`（L656-676）——handles>0 →
  `DocDeleteActiveHandleError`；`flushing` 在途经 `archiveWaiters` 等待（通知点 1 =
  flush finally 首位无条件 splice 通知 L1100、通知点 2 = dispose L818，两处亲证；检查与
  push 在同同步段、splice→flushing=false 亦同步段 → 无 missed wakeup）；苏醒后**重入重读**
  → `clearTimers`（含 retryTimer）→ identity 守卫驱逐 + `entry.doc.destroy()`——次序
  与 SA2 规定逐字一致。✅
- **M3（op 级 throw 收编）**：`runDeleteNamespace` 全链 try/catch（registry branded fatal
  catch → `delete-namespace-failed`；外层 catch-all 同款）——「进程绝不因控制输入退出」
  落实；G4 单飞 finally 清理 + successor 守卫（`get===run` 才 delete）；`run` 创建与
  `deleteInFlight.set` 之间零 await（无交错窗口）；并发第二请求 await 首请求结算后重走全
  路径（O3 不缓存旧结果）。✅
- **M4（F5×重启×provision 交叉备案）**：REPORT 残余风险节已按 F-3 改述（marker 门 = 同 id
  重建防线；provision 恒新 CSPRNG id 2^-128；唯一现实路径 = importReplica 显式同 id；
  SA7 重点 8 实测引用）——与 SA7 §2 #8 运行时证据一致。✅

## 4. 单一事实源与生命周期对称性

- **稳定 message 单点**：`NAMESPACE_DELETE_FAILED_MESSAGE` 入 `types.ts`（零插值零回显，
  沿既有冻结文本纪律）；registry 侧冻结常量 `DELETE_FAILED_ISSUE`；其余三码复用既有冻结
  文本——无第二处字面量复制（grep 亲证）。✅
- **错误族单一分类面**：`DocDelete{ActiveHandle,Operational,Fatal}Error` 在 contract.ts 单点
  定义、index.ts 导出；phase 词表 `lifecycle-disposed/adapter-violation/remove-aborted` 与
  `committed:false` 恒真语义在 ADR-0006 修订节 §3、contract 注释、lifecycle 实现三方一致。✅
- **生命周期对称**：`'deleting'` claim 镜像 `'archiving'` 范型（settle 后置位、op 段持守、
  成败双路 identity 守卫清理）；dispose 对称面在场（abort → `remove-aborted` fatal；
  inFlight allSettled 覆盖删除全程——`track()` 包装；dispose 同步段通知 waiters 使
  settle 环收口后 `assertDeleteWritable` 重检以 `lifecycle-disposed` 结算，绝无 dispose 后
  置 cell）；`deleteDoc` 双 adapter 同契约（File 主键先提交点/归档位后、逐处
  `fsp.rm force:true`；Memory 双分区 + deleteSnapshot hook loud 配置门与 remove 同款纪律）。✅
- **Registry 编排对称**：`admitDeleteSlot` 复用 carrier per-key FIFO 串行域；`runDeleteSlot`
  镜像 reset ⑥ 破坏性段（forceRelease → cancelIdleArm → close admission I2 记账 → await →
  settle 双路 removeEntryAfterClose）；capability 前置门先于一切破坏性动作（镜像 reset ②）；
  减 fence 论证入 ADR-0009 修订节 §3 与代码注释双备案。✅
- **Host 停机对称**：op 全链有界（carrier tail 覆盖删除槽；日志段有界同步协议）；
  `diagnostics.close()` 语义不变；SA7 重点 9 三轮 SIGTERM 竞态实测 exit 0（≤5.7s 有界
  drain）——与本审查静态推演一致。✅

## 5. 测试质量标准与测试完整性

- **真实性纪律**：11 个本票测试文件全部真实夹具（进程级 E2E spawn main.ts / 真实 fs /
  真实 yjs / 真实 Memory/File adapter；故障注入仅经 sanctioned testing seam 或 chmod 物理
  注入；零 mock、零源码 grep 断言）；头注完备（裁决锚 + 纪律声明）。抽查
  doc-delete-semantics（P1a–P1e/P2a/P2b 确定性交错闸门）、registry-delete-orchestration
  （R1–R4 真实 Registry+Runtime+fault seam）、T-H5（黑盒双侧进程 + 真实 WS）均非空转、
  断言锚定可观察行为/真实文件产物。✅
- **零弱化/零跳过（本轮 grep 亲证）**：全 diff 新增行与 11 个新测试文件
  `.skip/.only/.todo/.fails/skip:true` **零命中**；触发面（`vitest.config.ts`、
  `package.json`、`pnpm-lock.yaml`、`.github/`）对 HEAD **零 diff**；全部新文件落 root
  include 面（`packages/*/test/**`、`apps/*/test/**`）——CI `pnpm test` 同入口收集。✅
- **AC4 五文件测试稳定性改动逐 hunk 复核**：7 处显式 per-test timeout（6×20s + RT-G5 30s）
  + 1 处 RT-G5 wire 静默同步（注入前等 UPDATE_ACK 齐——只收紧注入前置条件）+ 1 处 E4
  `signalAndExpectExit` SIGTERM 前 1.5s 有界 settle（exit-code 断言不变）——**断言区零字符
  改动**；两处表面守卫「expect 行变化」= ADR 修订节法定演化（禁词表翻转 + 正向锚增强），
  非弱化。测试总数 2984 在修复前后各轮逐位不变（日志互证）。✅
- **D4 断言仲裁的程序合规**：SA6 独立追认 approve（`task_228_sa6_f1_ratification.md`）
  + SA1 设计勘误 E-1（§10）+ SA8 iteration 2 clear（C-1 纠错型追认）+ 测试断言区
  （L383-408 仲裁注记 + `.not.toBe` 反锚）四方一致；D1–D3 零断言改动钉死 AC1 主体义务；
  断言强度净增（新身份/新流反锚 + 无 marker 半态）。红灯→转绿契约连续性保持（文件名
  保留、头注更新）。✅
- **计数自洽**：本票套件用例数本轮逐文件 grep 复核（semantics 7 / storage 8 /
  orchestration 9 / sa7-dynamic 7 / retirement 2 / realtime 2 / 红灯契约 4 / T-H5–H8 各 1）
  与 REPORT/SA3 notes §6.2 记录逐位一致（前轮计数勘误 7/15、18/178 已落地）。✅

## 6. 证据真实性与 F-11/F-12 收口独立复核

- **四门证据对读**（开卷亲证，非转述）：
  - `/tmp/full-test-run-2.log`（20:51）：`Test Files 279 passed (279)` /
    `Tests 2984 passed (2984)` / `Type Errors no errors` / `Duration 563.32s` / `exit=0`
    ——与 REPORT 四门表逐字一致；
  - `/tmp/typecheck-run.log`（20:23）：14 包 tsc 链 exit=0；`/tmp/generate-check-run.log`
    （20:51）在场零错误输出；`git diff HEAD --check` 本轮自跑 **clean（exit 0）**；
  - 首轮 RPC 噪声轮（`/tmp/full-test-run.log` exit 1、零测试失败、2 条 `onTaskUpdate`
    超时）披露属实。
- **F-11 收口**：REPORT「收尾轮记录」item 1 = 5 文件逐条清单（含 session-red 与
  diagnostic-replay-host-lifecycle-red 两行 + 各自驱动日志引述）；grep 亲证
  `共 3 个文件`/`涉及 3 个`/`3 个既有边际` **零命中**；SA3 notes §6.1 表两行补录在场。✅
- **F-12 收口**：grep 亲证 `均未见其失败`/`原备案所指形态未再现` **零命中**；更正后事实链
  逐环与日志对上——`/tmp/sa3-228/full-test-3.log`（19:39）L201 `× 补锚 (a) … 5427ms` +
  L506-507 `Test timed out in 5000ms` + `1 failed | 2983 passed (2984)`；
  `/tmp/sa3-228/full-test-2.log`（19:07）L111/L501-502 `expected 143 to be +0`；
  `/tmp/fix-check-session-red.log` 22/22（19:53）；`/tmp/gate-full-test.log`（20:15）绿；
  session-red 注释归属已修正为「SA3 收尾轮全量 run（/tmp/sa3-228/full-test-3.log…）」
  （diff 亲证，零行为）；`/tmp/sa4-i4-session-red.log`（21:43，SA4 复跑）22/22 绿互证。✅
- **REPORT 结构性准确**：14 个引用证据路径本轮逐一 `test -f` 全部在场；阶段汇总 fix 清单
  #248/#250/#251 与 `git log` 亲证一致（OBS-2 顺手闭合在场）；M4 改述、runner 待办披露
  （不假报完成）、措辞只引权威文档（B3/#172 §2）均达标。✅

## 7. 文件范围（scope）核验

- actual 32 M + 23 ??：生产面 12 件（persistence 6 + registry 5 + app 2 − 重复计数后）+
  文档面 8 件 + 测试面（改动 10 + 新增 11）+ wiki 档案 12 件——全部命中 design §3/§6 清单、
  design §10.5 备案的 4 个清单外必要落点（registry `errors.ts`/`observer.ts`、persistence
  `testing.ts`、`hub-peer-deployment.md`——SA10 M-3 逐件裁定「必要落点/法定义务，无实质
  scope creep」，本轮复核同意）或 `wiki/raw/task_228_*` 白名单。无 DENY 面命中。✅
- wiki/raw 档案为非规范证据（ADR-0010 #172 §2），其中已知表述性残留见 §8——不属规范面缺陷。

## 8. MINOR / 观察项（均不阻断 approve）

| # | 级别 | 发现 | 状态 |
|---|---|---|---|
| S9-1 | MINOR | design §3 ALLOW LIST 未列 4 个清单外落点（SA4 F-4 / SA10 M-3）——design §10.5 已备案、路由 SA1/总控；wiki/raw 非规范，代码面本身合规 | 已登记移交，维持 |
| S9-2 | MINOR | design AD-8 F2 行注记交叉引用滑误（「见 R-3」语义指向 R-1）；SA2 review §5.2 D4 行保留已被追认取代的「确定性派生」前提——均为他 SA/旧版非规范档案的表述性残留，design §10.5 已备案 | 已登记移交，维持 |
| S9-3 | OBS | `deletedNamespaces`/`retiredNamespaces` 进程内单调增长无清理面（SA2 O1 / SA4 F-9 / SA10 M-4；条目极小、CSPRNG id 无自然覆盖、重启清零、v1 可接受） | 维持备案 |
| S9-4 | OBS | CI 对本票 5 个契约/行为锚文件无 `--passWithNoTests=false` 具名物化步骤（SA4 F-10 / SA10 M-5）——repo 既有 glob 级通性，非本票引入 | 收尾轮可选加固，维持备案 |
| S9-5 | OBS | HEAD 既有尾随空格残留（`generate-cli-check.test.ts` L15 注释行 + 4 个历史 wiki/raw 档案）——**非本 diff 引入**（`git show HEAD:` 亲证 L15 在基线即在）；本票门 `git diff HEAD --check` clean，diff 新增行零尾随空格 | 超本票 diff 面；备案 |
| S9-6 | OBS | tsx wrapper「ready 后 ~600ms 窗口 SIGTERM → 143」choreography 竞态（SA7-OBS-1 / SA10 M-6）——既有环境行为，测试侧 settle 规约已沿用并注记 | 维持备案 |

## 9. 结论

当前最终 diff（32 M + 23 ??，HEAD `6467078`）在 SA9 职责的全部 standards 面上合规：
模块边界与包公共面纪律、ADR 显式修订节正式化（B1）、复合删除谓词与调用点纪律（B2）、
措辞红线与文档对齐（B3）、单一事实源、生命周期对称性、文件范围、测试真实性与完整性、
证据真实性。AC4 稳定化改动为纯预算/编排收紧（零断言弱化、零跳过、触发面零操纵）；
AC5 REPORT 勘误（F-11/F-12）已如实落树并与日志逐字互证。SA4 iteration 4 的 approve
经本轮独立复核成立。**0 BLOCKER / 0 MAJOR；6 项 MINOR/OBS 全部已登记备案，不阻断。**

**Verdict: approve**（`requiresConflictRecheck: false`）。

## 10. 交付物

- 本文件：`wiki/raw/task_228_sa9_standards.md`。
- 结构化结果：`verdict = approve`，`requiresConflictRecheck = false`，artifactPaths 见 tool call。
