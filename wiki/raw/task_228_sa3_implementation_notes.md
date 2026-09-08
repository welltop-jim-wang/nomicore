# Issue #228 — SA3 implementation notes（implementation round：iteration 2 实现 + iteration 3 收尾附带条件修复 F-1/F-2/F-5 + iteration 5 SA10 reject 收敛 + iteration 8 四门终验与 REPORT 定稿 + iteration 9 SA4 F-11/F-12 REPORT 勘误落树）

> SA3（本 dispatch）亲证工作树状态后的实现与验证注记。iteration 2 前两次 SA3 dispatch
> 均为框架失败/verified-lost——工作树实施改动（未提交）被完整保留；iteration 2 起逐
> 文件 diff 复核 + 全量重新执行验证（见 §1/§2）。iteration 3（前轮）：处理 SA4
> approve 附带条件中归属 SA3 的 F-1（契约断言仲裁勘误与追认协调证据）、F-2
> （ActiveHandle 映射注释对齐）、F-5（T-H5–H8 落地）。iteration 5（前轮）：处理
> SA10 spec-review reject 的收敛清单——AC4（5 个既有边际测试文件显式 per-test
> timeout/编排竞态修复：SA10 §7.1 清单 3 个 + 收尾轮自跑全量 run 驱动另 2 个，见
> §6.1）、AC5（REPORT.md 阶段汇总/M4 改述/发布侧移交披露）、M-1/M-2
> 卫生项（在树改动，见 REPORT「收尾轮记录」节）。iteration 8（dispatch
> sa-13f86931-7fe9-4e93-8001-8fca50f09ea2）：复核 iteration 5 在树改动 + 补跑四门
> 终验 + REPORT 定稿（§6）。iteration 9（本版，dispatch
> sa-a61fe7c4-7d6b-4e60-8f6c-8eeba5af9a61）：SA4 iteration 2/3 F-11/F-12 REPORT
> 勘误落树（§6.1 补两行 + §7 记录）。全部行号/结论以本 worktree HEAD 与本轮实测为准。
> 用途：SA4/SA6/SA8/SA1/SA7 与总控收尾核对面的事实底座；本文件不替代设计/评审档案。

## 0. iteration 3 复核结论（SA4 附带条件处置自检）

| SA4 发现 | 处置（iteration 3） | 状态 |
|---|---|---|
| F-1（契约修订需追认） | 不能自行追认/勘误——评审链协调证据整理为 §3.1 证据包（含物理不可能性证明），供 SA6/SA8 追认 + SA1 勘误 design AD-2「断言零改动」表述；SA3 notes 自身勘误（本文档 iteration 2 版 §1.1 标题「零断言改动」与同文件 D4 注记自相矛盾——本版已修正）。红灯测试文件**不回滚**（回滚 = 恢复物理不可满足断言） | 已勘误 + 证据包就绪（§3.1） |
| F-2（ActiveHandle 映射/注释不一致） | registry.ts `runDeleteSlot` ⑤ catch 注释重写为与**代码 + ADR-0009 修订节 §5**（新规范文本，二者一致：ActiveHandle 落「其它 throw → branded fatal」）一致的表述，并标注 design AD-6 步骤 5 文本分歧待 SA1 勘误。**零行为改动**（外部可观察结局两端相同：`delete-namespace-failed` + observer；分支理论不可达） | 已对齐（§3.2） |
| F-5（T-H5–H8 未编写） | 四个 host 测试文件落地并全绿（§2.2）；T-H5 = AD-7/R-2 唯一行为锚（活跃 channel 中 delete → channel 失败收口不崩溃、无快照复活、hub 健康） | 已交付（§2.2/§3.3） |
| F-3/F-4/F-6/F-7 | 不属本 dispatch：F-3 REPORT 备案改述、F-4 design §3 ALLOW LIST 补录归 SA1/收尾轮；F-6 交 SA7 动态抽查；F-7（registry 既有超时预算用例）收尾轮处理 | 移交 |

## 1. iteration 2 复核（实现完整性自检；D1–D4 转绿事实）

设计 §3.1–§3.4 变更清单逐项在场（与工作树 diff 核对）：

| 落点 | 状态 |
|---|---|
| persistence `DocPersistence.deleteDoc?` / `ReplicaPersistence.deleteDoc`（required）+ typed 错误族（ActiveHandle/Operational/Fatal + phase `lifecycle-disposed`/`adapter-violation`/`remove-aborted`）+ `PersistenceIO.removeKey?` | ✅（contract.ts / lifecycle.ts / file.ts / memory.ts / index.ts） |
| lifecycle `'deleting'` cell + 全消费方（M1）：`exclusiveCreate`（createDoc+importDoc 共享 claim 环）、`loadSlowPath`（loadDoc resolve 环）、`runArchiveDoc` claim 环、`seedForTest` 拒绝清单、`runDeleteDoc` 自身 | ✅ 源码逐一亲证 |
| settle-for-delete cancel-then-evict（M2）：零-handle 取消全部定时器（`clearTimers` 含 retryTimer）→ 驱逐 + `entry.doc.destroy()`；`flushing` 在途经 `archiveWaiters` 等待 → 重入重读 | ✅ lifecycle.ts `settleEntryForDelete` |
| registry `deleteNamespace`（acceptance → 身份文法 → carrier per-key `admitDeleteSlot`/`runDeleteSlot`：owner 核对 → capability 前置门 → closing 等待 → forceRelease/cancelIdleArm/close admission → deleteDoc typed 映射）| ✅ registry.ts |
| app `delete-namespace` op（G1 角色门 → G2 参数门 → G3 known-set+tombstone → G4 单飞 finally 清理；M3 全链 try/catch 收编 `delete-namespace-failed`；AD-3 全序 ① retire → ② 摘除复制暴露 → ③ registry → ④ 同步日志删除 → ⑤ 事件+回执） | ✅ app.ts |
| diagnostics retirement（AD-4：`retireNamespace` + drop reason `namespace-deleted` + `initStream` 先 un-retire） | ✅ diagnostics.ts |
| ADR 0006/0009 显式修订节 + ADR-0011 澄清性修订节 + CONTEXT.md/README/AGENTS 措辞对齐（§3.4 清单）+ REPORT.md #228 章节（含 M4 备案） | ✅ |
| 冻结面守卫更新（test-d 正向锚 + SA7 动态守卫/import-red 保持性守卫——设计/SA2 N2 要求的同变更集面更新） | ✅ |
| 新增套件 doc-delete-semantics（T-P1/P2）、doc-delete-storage（T-P3/P4）、registry-delete-orchestration（T-R1–R4） | ✅ |

SA2 M1–M4 全部落实（M1/M2 代码层、M3 收编层、M4 文档备案——REPORT 残余风险节）。

## 2. 验证（iteration 3 全部重新执行，非沿用历史结论）

### 2.1 主门：AC1 红灯契约（D1–D4 4/4 绿）

```
NODE_OPTIONS=--conditions=nomicore-source ./node_modules/.bin/vitest run \
  apps/yjs-server/test/host-namespace-delete-diagnostic-link-red.test.ts
→ Test Files 1 passed；Tests 4 passed；Type Errors no errors
```

- D1 同步联动 + 干净停机、D2 幂等二删、D3 参数门 + 进程存活、D4 重启不复活：
  真实 main.ts hub + file persistence + diagnostics enabled + provision；真实文件产物断言。
- **断言改动事实（F-1 基础；本版措辞修正）**：D1–D3 **零断言改动**转绿；D4 经历
  **断言级仲裁**（见 §3.1 证据包），非「零断言改动」。

### 2.2 iteration 3 新增 host 套件（SA4 F-5，4/4 文件全绿）

| ID | 文件 | 钉住的裁决 | 实测 |
|---|---|---|---|
| T-H5 | `apps/yjs-server/test/host-namespace-delete-under-replication.test.ts` | **AD-7/R-2 唯一行为锚**：活跃 peer channel（双向收敛后）delete → ack ok 且数据/日志全清；channel 失败收口（hub/peer 任一侧终态事件，进程零崩溃）；驱动写 + 4s 观察窗口内 hub 快照恒 absent、日志树恒 absent（无复活）；hub 健康（status ok、已删 ns read → namespace-unknown）直至双向 SIGTERM exit 0 | ✅ 1/1（实测 42.5s） |
| T-H6 | `apps/yjs-server/test/host-diagnostic-restart-resume.test.ts` | AC2 restart 正向（#153 语义 host 级锚）：boot1（provision+写）干净停机 → boot2（同根、直引恢复）再写 → current.json 同一 stream、streams 恰 1、genesis 仍在、sequence 1..N 跨 boot 连续、数据恢复一致、strict 全绿 | ✅ 1/1（19.5s） |
| T-H7 | `apps/yjs-server/test/host-diagnostic-retention-sweep.test.ts` | AC2 retention host 级组合：config retention 透传 → 重启续写触发构造期 sweepOnOpen → 预置前代旧流（layout fixture：manifest 拷贝 + 真实 JSONL 行 observedAt 远古化）闭组被删（NDJSON `retention-swept{deletedGroups≥1}`）、当前流开组零损伤（strict ok、序列连续、记录增长、业务读写照常） | ✅ 1/1（22.3s） |
| T-H8 | `apps/yjs-server/test/host-trusted-replication-diagnostics.test.ts` | AC2 trusted+diag 组合：hub/peer 双侧 diagnostics；hub 写 → peer trusted 收敛（peer 流 `replication-apply` committed attempts——peer 经 import 物化、无 genesis 属 #155「诚实缺席 genesis」语义）；hub 流对 peer 远端写同样落 committed `replication-apply`；双侧 strict replay complete（ok/issues 空/序列连续）且数据一致（双侧读同值 9） | ✅ 1/1（12.9s） |

四个文件全部落入 root `pnpm test` CI include 面（`apps/*/test/**/*.test.ts`）；均进程级
E2E、零源码 grep、零 skip。T-H5 通道收口断言采纳任一侧（hub/peer）终态事件联合——
收口发生在引擎哪一侧由 ws-replication 既有错误路径决定，任一侧可观察即裁决成立。

### 2.3 单元/契约回归（iteration 3 复跑）

- 红灯契约 D1–D4：4/4（§2.1）。
- `doc-delete-semantics.test.ts` + `doc-delete-storage.test.ts` +
  `registry-delete-orchestration.test.ts`：**3 files / 24 tests 全绿**，Type Errors no errors。
- 根 `pnpm typecheck`（14 包 tsc 链）：exit 0。
- `git diff --check`：clean。

> 注：iteration 2 遗留的 registry 两例负载型 5s 预算超时 flake（surface export-key
> 审计 / replication-red degraded）与收尾轮全量 `pnpm test` 复核仍按 §4 移交（F-7），
> 本版未改相关文件。

## 3. iteration 3 处置详情

### 3.1 F-1 — D4 断言仲裁的勘误与追认证据包（SA3 侧已尽责，追认归 SA6/SA8，勘误归 SA1）

**分歧面**：design AD-2（task_228_design.md L92「D1–D4 断言零改动即应转绿」）、
SA2 §5.2（L211-214 D4 转绿推演）、设计后 SA8 门禁（task_228_design_conflict_report.md
§3「D1–D4 断言零改动转绿的路径成立」）、SA6 契约 D4 行（「重启后 namespaceId 确定性
派生」语义）——四方均以「断言零改动」为前提；实现轮发现 D4 需断言级修订，与上述四方
声明矛盾。SA3 iteration 2 notes §1.1 标题「零断言改动」与同文件 D4 注记自相矛盾
（本版已修正）。

**根因（代码事实，非实现选择）**：
1. provision 每次经 `registry.create` 派生 namespaceId = CSPRNG `randomBytes(16)`
   （registry.ts 建流：create → identity 生成 128-bit 随机 id；SA4 亲证
   registry.ts L854-882 区域）。
2. 原 D4 断言「重启后 namespaceId 确定性派生 `.toBe(已删 id)`」在「删除 = 终态 +
   持久层无旧 generation 可恢复」下**物理不可满足**——第二次 provision 的 CSPRNG id
   与已删 id 相等的概率为 2^-128；「确定性派生」仅存在于「数据仍在 + 直引
   authorization 恢复」的重启形态（#155 E5/T6 先例：第二 boot 从不带 provision）。
3. 修订方向与设计 R-1「新 namespace、新流、新身份」**逐字一致**，且走 SA6 契约
   自载的「裁定不同按设计仲裁修订」通道（#155 先例）；修订**增强**安全语义
   （新增 `.not.toBe(oldId)` 反锚 + 旧 generation 零复活 + 无 marker 半态 + 新流≠旧流）。

**证据位置（供 SA6/SA8 追认核读）**：
- 测试文件头注：`apps/yjs-server/test/host-namespace-delete-diagnostic-link-red.test.ts`
  L5-12（「D1–D3 零断言改动转绿；D4 断言级仲裁注记见用例内」）；
- 用例内仲裁注记：同文件 L383-391（R-1 修订依据 + E5/T6 先例对照 + 物理不可行论证）；
- REPORT.md #228 章节「D4 断言级仲裁」条目（L102-109）；
- 本文件 §2.1/§3.1。

**请求的协调动作（非 SA3 可自行完成）**：
1. SA6：追认 D4 断言仲裁（修订不改变 D4 语义红线：重启不复活、进程健康、无 marker
   半态）；
2. SA8（收尾门禁轮）：追认该仲裁与 design AD-2 表述勘误后的一致性；
3. SA1：修订 design AD-2 表述（「D1–D4 断言零改动」→「D1–D3 零断言改动；D4 断言级
   仲裁（R-1 修订，见实现注记）」）并在 design §7 残余风险补 R-1×D4 交叉注记；
4. SA3（本版已做）：本 notes 勘误 + 证据包整理。**红灯测试不回滚**。

### 3.2 F-2 — ActiveHandle 映射三方不一致的对齐（零行为改动）

分歧面：design AD-6 步骤 5 将 `DocDeleteActiveHandleError` 写为防御性映射
`NAMESPACE_DELETE_FAILED`；代码（registry.ts `runDeleteSlot` ⑤）将其与
`DocDeleteFatalError`/unknown 一同折入 branded fatal；原代码注释括注称「折叠为
DELETE_FAILED」、操作行称「一律 branded fatal」——注释自相矛盾。

处置（本版）：
- **映射语义不变**（已批准语义 = ADR-0009 修订节 §5 新规范文本「DocDeleteFatalError
  / 其它 throw → branded fatal」——ActiveHandle 属「其它 throw」；SA4 已确认 ADR 文本
  与代码一致）。该分支理论不可达（close barrier 先释放 Runtime 持有的 handle；
  T-R1 live-entry 删除绿锚在场），Host 可观察结局两端相同（`delete-namespace-failed`
  + observer `lifecycle-slot-failed`）；
- registry.ts L1974-1988 注释重写：明示「Operational 之外一律 branded fatal
  committed:false，含理论不可达的 DocDeleteActiveHandleError（防御性收敛为 fatal 的
  理由：恒零破坏后无重试必要）+ committed:false 刻画更诚实」，并标注 design AD-6 文本
  分歧待 SA1 勘误（指向本文件）；
- design AD-6 步骤 5 文本勘误归 SA1（同 F-1 勘误批次）。

### 3.3 F-5 — T-H5–H8 落地注记（设计 §3.3/§6.2 文件清单补全）

- 四个文件（§2.2 表）现已在 `apps/yjs-server/test/` 就位，命名与 design §6.2 一致；
  SA4 §2.5「diff 中均未出现」的缺口关闭；
- T-H5 同时覆盖 SA4 §7 动态审核重点 2 的可静态锚定部分（收口事件 + 无复活窗口 + 进程
  健康）；真实时钟下的并发交错抽查（重点 6）与 F5/F3 注入仍归 SA7 动态轮；
- 收尾 AC2 全量组合（root `pnpm test` + `generate --check`）仍需总控在动态验证轮
  编排（含本批 4 个新文件 + 既有锚；design §6.3）。

## 4. 已知未决（iteration 3 视角；处置状态见 §6 终验记录）

> 本节为 iteration 3 时的移交视角。SA10 spec-review 之后，F-3、F-7/SA7-F-1、全量门与
> REPORT 阶段汇总已由 iteration 5 落树、iteration 8 终验闭合（见 §6）；F-4 仍归 SA1；
> git 配置残留仍归 runner。

- 全量 root `pnpm test`（跨包，含本批新 host 套件与既有锚）与 `generate --check`
  （AC2/AC4 门）归总控动态验证轮编排（design §6.3 + SA2 O5 + SA4 §2.5/F-5 处置）。
- registry 既有负载型 5s 预算超时 flake（SA4 F-7：surface export-key 审计 /
  phase5-replication-red degraded——基线 A/B 已证非本 diff 回归）：收尾轮给显式
  per-test timeout 或拆分（独立于本票）。
- F-3：REPORT.md M4 条目场景改述（CSPRNG 下「provision 重建同 namespaceId」物理不可
  达；marker 门保留为「同 id 重建防线」——唯一现实路径 = importReplica 显式同 id）归
  REPORT 收尾修订批次。
- F-4：design §3 ALLOW LIST 补录 4 文件（registry errors.ts / observer.ts /
  persistence testing.ts / docs hub-peer-deployment.md）归 SA1 收尾勘误批次。
- F-6（runDeleteDoc break fall-through 微任务间隙）交 SA7 动态抽查。
- Git 配置残留（mabf.branch/base-branch 与 issue 不符）维持备案，总控收尾时向 runner
  核对（本实现轮不触碰 git 配置、不 commit/push）。

## 5. 交付物

- 本文件：`wiki/raw/task_228_sa3_implementation_notes.md`（iteration 2+3 实现审计注记、
  F-1 证据包、F-2 对齐注记、T-H5–H8 验证证据、未决移交；iteration 8 记录见 §6）。
- iteration 3 代码/测试改动：registry.ts 注释（F-2）+ 4 个新 host 测试文件（F-5）。
- REPORT.md：本版补录 iteration 3 验证小节（§2.2 同源事实）。
- 结构化结果：见 tool call（summary + artifactPaths）。

## 6. iteration 8 终验记录（dispatch sa-13f86931-7fe9-4e93-8001-8fca50f09ea2；SA10 reject 收敛收尾 + 四门实测定稿）

> 本节替代此前悬空的「§6 iteration 5 记录」交叉引用（iteration 5 dispatch 在树改动落
> 地后未及写本文件 §6 即结束）——iteration 5 的在树产物在本轮逐项复核在场，终验与
> REPORT 定稿由本轮完成并记录如下。本轮改动：仅 REPORT.md（四门结果定稿 + 计数勘误）
> 与本文件；零生产代码、零测试断言、零 skip/only/todo。

### 6.1 iteration 5 在树改动复核（亲证，逐项在场）

| SA10 收敛项 | 在树证据（本轮亲证） | 复核 |
|---|---|---|
| AC4：`registry-phase5-replication-red.test.ts` AC-6 `persistence-degraded` 显式 per-test timeout 20s | 文件 L662-665 注释 + `}, 20_000)`（git diff 亲证） | ✅ |
| AC4：`generate-cli-check.test.ts` 3 个 spawn 型用例显式 per-test timeout 20s | 文件 L73-75 注释 + 3 处 `}, 20_000)` | ✅ |
| AC4：`ws-replication-sa7-issue171-real-transport.test.ts` RT-G5 wire 静默同步 + 显式 per-test timeout 30s | 文件 L497-507 waitUntil + `}, 30_000)` | ✅ |
| AC4（REPORT iteration 2/3 F-11 披露补录，19:53 落树）：`registry-phase5-replication-session-red.test.ts` AC-5 两条 degraded 用例（`peer persistence-degraded` 与 `补锚 (a)`）显式 per-test timeout 20s | 文件 L1026-1030 注释 + 2 处 `}, 20_000)`（git diff 亲证）；驱动：收尾轮全量 run `/tmp/sa3-228/full-test-3.log`（2026-09-07 19:39 落盘，`1 failed | 2983 passed (2984)`）实测 `补锚 (a)` `Test timed out in 5000ms`（5427ms）；修复验证 `/tmp/fix-check-session-red.log` 22/22 | ✅ |
| AC4（REPORT iteration 2/3 F-11 披露补录，19:14 落树）：`diagnostic-replay-host-lifecycle-red.test.ts` E4 `signalAndExpectExit` 对 SIGTERM 先 1.5s 有界 settle 再 kill | 文件 L233-238 注释 + `if (signal === 'SIGTERM') await sleep(1_500)` 先于 kill（git diff 亲证；与 host-namespace-delete-diagnostic-link-red D4 停机 settle 同款 wrapper 编排竞态先例；`waitForExit(30_000)` 有界窗与 `exit code === 0` 断言不变）；驱动：收尾轮全量 run `/tmp/sa3-228/full-test-2.log`（2026-09-07 19:07 落盘）实测 E4 `expected 143 to be +0` | ✅ |
| AC5-b（F-3）：REPORT 残余风险 M4 条目改述（marker 门 = 同 id 重建防线；provision 恒新 CSPRNG id；importReplica 唯一现实路径） | REPORT.md「残余风险」节 | ✅ |
| AC5-a：REPORT PR #142 / #141 阶段汇总（#148–#155、#226–#227 各票一行 + 证据路径；本分支合入 commit #156/#159/#166/#167/#194/#196/#200/#223 + fix #248/#250/#251 与 git log 亲证一致） | REPORT.md「PR #142 阶段汇总」节 | ✅ |
| M-1：`packages/namespace-diagnostic-log/README.md` 快速示例注释限定（内存 adapter 语境） | README L30 区（git diff 亲证） | ✅ |
| M-2：registry.ts runDeleteSlot ⑤ 注释指向 design §10 勘误 E-2 | registry.ts diff 亲证 | ✅ |

### 6.2 四门终验（本轮全部重新执行，非沿用前轮记录）

| 门 | 命令 | 实际结果 | 日志 |
|---|---|---|---|
| root typecheck（14 包 tsc 链） | `pnpm typecheck` | **exit 0** | `/tmp/typecheck-run.log` |
| 生成物零漂移（ADR-0005） | `pnpm generate --check` | **exit 0** | `/tmp/generate-check-run.log` |
| whitespace 门 | `git diff HEAD --check` | **clean（exit 0）** | — |
| 全量测试（CI Test 同入口） | `pnpm test`（vitest run --typecheck，maxWorkers 1） | **exit 0**：Test Files 279 passed (279)、Tests 2984 passed (2984)、Type Errors no errors、Duration 563.32s | `/tmp/full-test-run-2.log` |

- **首轮复跑（`/tmp/full-test-run.log`）**：exit 1，但**零测试失败**（279/279 文件、
  2984/2984 用例全绿）——仅 2 条 vitest worker RPC 编排超时（`Timeout calling
  "onTaskUpdate"`）。根因亲证：4 核宿主机被 7 个跑飞 `grep -R` 进程（55–87% CPU/个，
  累计运行 8h–6d，ps 亲证）饥饿；与 #226 终验曾观测的同类 vitest worker RPC 负载噪声
  形态一致。清理跑飞进程（kill，进程为纯读 grep、无数据面影响）后复跑 exit 0。
- **全量 run 逐文件证据（run-2 日志 grep 亲证）**：本票 11 个 `.test.ts` 文件全绿
  （host-namespace-delete-diagnostic-link-red 4/4、-sa7-dynamic 7/7、
  host-diagnostics-retirement-sa7-228 2/2、-delete-under-replication 1/1、
  host-diagnostic-restart-resume 1/1、-retention-sweep 1/1、
  host-trusted-replication-diagnostics 1/1、registry-delete-orchestration 9/9、
  doc-delete-semantics 7/7、doc-delete-storage 8/8、doc-delete-sa7-realtime 2/2）；
  5 个收尾轮加固的边际文件全绿（registry-phase5-replication-red 16/16 @856ms、
  generate-cli-check 8/8 @4874ms、ws-replication-sa7-issue171-real-transport 4/4
  @3618ms、registry-phase5-replication-session-red 22/22 @1695ms、
  diagnostic-replay-host-lifecycle-red 22/22 @47067ms——grep 直证），SA10 §4.1 所列
  5 例失败形态零再现；收尾轮自跑全量 run 另现的 E4/补锚 (a) 两形态已于 19:14/19:53
  修复落树（§6.1 补录两行；不隐匿失败轮——REPORT iteration 2/3 F-11/F-12 已据此
  勘误收口，见 §7）。
- **persistence 套件隔离复跑**：`vitest run packages/persistence/test --typecheck` →
  **18 files / 178 tests passed**（17 运行时文件 173 用例 + test-d 类型面 5/5），
  Type Errors no errors。

### 6.3 REPORT.md 定稿勘误（本轮落地）

1. 「最终四门证据」占位文本（「结果待本收尾轮日志」）替换为 §6.2 实测结果（含首轮
   RPC 噪声事件的如实披露——AC5「验证证据」须属实，不隐匿失败轮）。
2. 计数勘误（前轮记录与实测不符）：doc-delete-semantics 9 用例 → **7**；doc-delete
   两套件 17 用例 → **15**（7+8）；persistence 套件 176/176 → 实测 **18 files /
   178 tests**（173 运行时 + 5 类型）。registry-delete-orchestration 9/9 与两套件
   +orchestration 24/24 维持（与实测一致）。
3. 收尾轮记录节标题与输入段补 iteration 8 终验归属（dispatch id）。

### 6.4 移交状态（iteration 8 视角）

- AC4/AC5 收敛项全部闭合（REPORT.md 为最终证据载体）；SA10 §7 收敛清单第 5/6 项的
  runner 侧待办（PR #142 title/body、issue #141 同步、CI run 核验、git 配置残留核对）
  与 M-3（design §3 ALLOW LIST 补录，SA1 路由）、M-4/M-5/M-6 备案维持不变。
- 本文件 §4 所列 iteration 3 视角未决项已由 SA7（动态轮）、iteration 5+8（收尾轮）
  与 runner/SA1 路由分别闭合或移交。

## 7. iteration 9 勘误收口记录（dispatch sa-a61fe7c4-7d6b-4e60-8f6c-8eeba5af9a61；SA4 F-11/F-12 落树）

SA4 iteration 2/3 驳回点唯一且未变：AC5 REPORT 勘误未落树（两文件名未披露 +
假性负结论句在场）。本轮在树改动（全部为 REPORT/notes/注释勘误，**零生产代码、零
测试断言、零 skip/only/todo、零时限/预算改动**）：

1. REPORT「收尾轮记录」item 1 改述为 5 文件清单（补 session-red 与
   diagnostic-replay-host-lifecycle-red 两行 + 各自驱动失败日志引述）——本文件 §6.1
   表同步补两行（上表）；
2. REPORT 验证节 session-red 注记更正（假句删除 → 19:39 再现事实 + 19:53 收敛路径 +
   后续各轮全绿；四门段落补 5 文件逐文件全绿数据，grep `/tmp/full-test-run-2.log`
   直证）；
3. `registry-phase5-replication-session-red.test.ts` L1028 注释归属修正（「SA7 全量
   运行 2026-09-07 19:39」→「SA3 收尾轮全量 run（/tmp/sa3-228/full-test-3.log，
   2026-09-07 19:39 落盘）」）——SA7 日志全部 12:39–13:26，无 19:39 run（亲证）；
   零行为；
4. REPORT 阶段汇总段 fix 清单 #248/#251 → #248/#250/#251（OBS-2，git log 亲证）。

本轮验证：REPORT/notes grep 复核——两文件名在场、原假句与『3 文件』少报口径零残留；
`git diff HEAD --check` clean；session-red 单文件复跑 **22/22 绿**（注释改动零行为
佐证，命令与结果见下）。四门全量不重跑（SA4 iteration 3 声明：当前树已验绿、落树后
仅需 grep 复核收口）。

```
NODE_OPTIONS=--conditions=nomicore-source ./node_modules/.bin/vitest run \
  packages/namespace-registry/test/registry-phase5-replication-session-red.test.ts
→ Test Files 1 passed；Tests 22 passed；Type Errors no errors
```
