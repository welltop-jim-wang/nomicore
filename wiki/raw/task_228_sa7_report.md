# SA7 动态验证报告 — Issue #228（Host namespace 数据删除 ⇄ 诊断日志逻辑删除联动）

> SA7（Dynamic Verifier）final-verification 轮产物。dispatch `sa-3d21fa0e-4b73-4574-8d7f-13f862b9b1e7`，
> phase final-verification，iteration 0。
> **Worktree**: `/home/wangjian/nomicore-fix-issue-228`（branch `mabf/issue-228`，HEAD `6467078`；
> 动态验证起点 diff = 27 M + 18 ??（SA3 交付 + wiki 档案），SA7 本轮新增 3 个补充测试文件 +
> 本报告（4 个 ??）→ 终态 27 M + 22 ??，全部未提交；27 M 与 SA4 iteration 1 记录的改动集
> 一致——**SA7 零 tracked 文件改动、零生产代码触碰**）。
> **输入产物（全部亲读）**: `task_228_sa4_review.md`（iteration 1 approve + R0 档案）、
> `task_228_sa6_f1_ratification.md`（F-1 追认 approve）、`task_228_design.md`（round 2 勘误）、
> `task_228_design_conflict_report.md`（iteration 1/2 clear）、`task_228_sa3_implementation_notes.md`
> （iteration 3）+ 实现源码（app.ts / diagnostics.ts / main.ts / registry.ts / lifecycle.ts /
> file.ts 关键段）+ 既有测试文件（红灯契约、T-H5、doc-delete-semantics、#226 轮 SA7 先例）。
> **Issue 评论输入**: 派遣简报明示 REST 已读 = `[]`，无 Owner 追加要求（评论 ID/updated_at：无）。
> **边界**: 零业务代码改动（`src/` 生产代码零触碰）；零 commit/push/PR。本轮写入 =
> 本报告 + 3 个 SA7 补充测试文件（SA7 职责内）+ `/tmp/sa7-228/` 审计日志。
> **测试执行规范**: 全部测试命令经 `setsid nohup` 独立进程后台运行（零 ACP session 同步阻塞）；
> 所有被测服务端口均为 `listen(0)` 临时端口（测试自分配），无固定端口冲突面，未使用 `fuser -k`。

---

## 0. Step 0 — SA4 verdict 校对

SA4 报告顶部（iteration 1）：**`Verdict: approve`（`requiresConflictRecheck: false`）**，R0 档案
verdict 亦为 approve。SA6 F-1 追认 approve、SA8 冲突报告 iteration 2 clear。

→ **操作：进入 Step 1 动态验证**（SA4 已 pass，SA7 只可独立发现 fail，不得下调 SA4）。

---

## 1. Step 1 — 既有验收/行为锚独立复跑（D1–D4 + T-H5–H8 + 三单元套件）

命令（`/tmp/sa7-228/step1-targeted.log`）：

```
NODE_OPTIONS=--conditions=nomicore-source ./node_modules/.bin/vitest run \
  apps/yjs-server/test/host-namespace-delete-diagnostic-link-red.test.ts \
  apps/yjs-server/test/host-namespace-delete-under-replication.test.ts \
  apps/yjs-server/test/host-diagnostic-restart-resume.test.ts \
  apps/yjs-server/test/host-diagnostic-retention-sweep.test.ts \
  apps/yjs-server/test/host-trusted-replication-diagnostics.test.ts \
  packages/namespace-registry/test/registry-delete-orchestration.test.ts \
  packages/persistence/test/doc-delete-semantics.test.ts \
  packages/persistence/test/doc-delete-storage.test.ts
→ Test Files 8 passed (8)；Tests 32 passed (32)；Type Errors no errors；VITEST_EXIT=0
```

| 文件 | 结果 | 实测时长 |
|---|---|---|
| host-namespace-delete-diagnostic-link-red（D1/D2/D3/D4） | ✓ 4/4 | 39.3s（D1 7.4 / D2 8.4 / D3 7.4 / D4 16.2） |
| host-namespace-delete-under-replication（T-H5） | ✓ 1/1 | 27.2s |
| host-diagnostic-restart-resume（T-H6） | ✓ 1/1 | 19.8s |
| host-diagnostic-retention-sweep（T-H7） | ✓ 1/1 | 19.6s |
| host-trusted-replication-diagnostics（T-H8） | ✓ 1/1 | 11.8s |
| registry-delete-orchestration（T-R1–R4） | ✓ 9/9 | 0.25s |
| doc-delete-semantics（T-P1/P2） | ✓ 7/7 | 0.15s |
| doc-delete-storage（T-P3/P4） | ✓ 8/8 | 0.12s |

与 SA3 notes §2 / SA4 §I.3 复跑数字一致（时长在环境正常波动内）。**SA6 红灯契约已转绿且
保持绿**——Step 1 判定 🟢 GREEN。

---

## 2. Step 2 — SA4「动态审核重点」清单逐条动态验证

SA4 清单 10 项 + 本轮补充的 2b（重点 2 的重连后半句），全部以真实运行时证据闭合：

| # | SA4 重点 | 验证方式（真实运行） | 运行时证据 | 结果 |
|---|---|---|---|---|
| 1 | D1–D4 复跑 + 全量 `pnpm test` + `generate --check` | §1 复跑；工程门见 §5 | 4/4 绿；门结果见 §5 | ✅ |
| 2 | T-H5：活跃 channel 中 delete → 收口不崩、无复活、hub 健康、peer 重连被拒 | §1 T-H5 复跑（Phase A 双向收敛→B 删除→C 收口→D 4s 无复活窗）+ **SA7-重点2b**（删除后新 peer 同 target 重连） | T-H5 1/1 绿；2b：6s 观测窗内双侧 channel **零 `live`**、hub 快照/日志树恒 absent、hub status ok、双向 SIGTERM exit 0（`step2c` log） | ✅ |
| 3 | G4 并发：同 nsId 并发 delete ×N → 全部诚实终态、单飞无重入破坏 | **SA7-重点3**：5 行 delete 连续写 stdin（main.ts `rl.on('line')` 为非 awaited async——5 个 dispatch 真实并发进入 `opDeleteNamespace`，命中 `deleteInFlight` 单飞 + 结算后重走全路径） | 5/5 回执 `ok:true`；快照/日志树全 absent；`namespace-deleted` 事件在场；进程存活；后续 status op 正常应答；SIGTERM exit 0 | ✅ |
| 4 | F5 注入：logRoot 只读 → `log-delete-failed{step,errno}` 透传；同进程重试收敛 | **SA7-重点4**：`chmod 0555` namespace 日志目录（运行用户 uid 1000 非 root，EACCES 物理生效） | 回执 `{ok:false,code:'log-delete-failed',step:'marker',errno:'EACCES'}`（值域逐字透传、不重映射）；数据段已完成（快照 absent）；日志树半态在场；进程存活、零 `namespace-deleted` 事件；chmod 恢复后二删 `ok:true` + 全清 + 事件恰 1 次 | ✅ |
| 5 | F3 注入：removeKey EACCES → `delete-namespace-failed`；tombstone 二删收敛 | **SA7-重点5**：`chmod 0555` owner 数据目录（`{persistRoot}/users/alice`） | 回执 `{ok:false,code:'delete-namespace-failed'}`；快照仍在（数据未删）、日志树未动（④ 未到达）；进程存活；恢复后二删（tombstone → registry absent ok → deleteDoc 重试）`ok:true` 且快照/日志全清 | ✅ |
| 6 | F-6 并发抽查：delete × loadDoc 同 key 真实时钟交错 | **SA7 realtime 套件**（`packages/persistence/test/doc-delete-sa7-realtime.test.ts`）：真实 `setTimeout` scheduler（debounce 5ms/maxDirty 25ms），×30 迭代 `Promise.all([deleteDoc, loadDoc])` | 30/30：delete 结算 ∈ `{ok:true}` 或诚实 `DocDeleteActiveHandleError`（load 先赢签发活 handle 时——AD-5/P1c 设计语义，release 后重试必收敛 ok）；load ∈ {null, 可正常 release 的 handle}；终态 load null；越过 4×maxDirtyMs 后 store 零重建。另：删除后同 key 重建 → 再删 → 零复活 | ✅（无复活、无伪数据、无孤儿 handle） |
| 7 | diag 迟到流量：删除后 runtimeEmitterFor → dropStub 计数、无目录重建 | **SA7 retirement 套件**（`apps/yjs-server/test/host-diagnostics-retirement-sa7-228.test.ts`，真实 File adapter + 真实 tmp 目录） | 建流→rm 目录树→`retireNamespace`→迟到 `runtimeEmitterFor` 返回丢弃桩（先于 ensureAdapter）→emit 只产生 `{event:'diagnostic-log-emission-dropped',reason:'namespace-deleted'}` 恰 1 次；100ms macrotask 让出后目录**零重建**；`initStream` un-retire 后同 id 重建走全新流、不再丢弃；close 优先级回归（manager-closed）不变 | ✅ |
| 8 | M4 改述后验证：F5 失败 + 重启 + provision → 新 id 新流、无 `stream-init-failed{reason:'namespace-log-deleted'}` | **SA7-重点8**：`chmod 0555` streams 子树 → 删除失败于 stream 段（marker 已落盘）→ SIGTERM → 同配置重启 | 回执 `{code:'log-delete-failed',step:'stream',errno:'EACCES'}`；`deletion.json` marker 在场（半态）；重启 provision → **新 CSPRNG id ≠ 旧 id**、新流落盘健康（`expectLogsEstablished` 通过 = marker 门未波及新 id）；boot2 全事件面零 `stream-init-failed`/零 `namespace-log-deleted`；旧树无复活（locator 不回归）；双向 exit 0 | ✅ |
| 9 | SIGTERM 竞态：删除中 SIGTERM → 有界停机、exit 0、二删收敛 | **SA7-重点9**：3 轮独立 boot（偏移 +30/+80/+150ms；先越过 tsx wrapper ready-窗口再发起竞态） | 3/3：SIGTERM 后**有界优雅停机 exit 0**（drain 5.6–5.7s ≪ 30s 预算）；3/3 删除回执先于退出到达（delete 在停机 drain 内完成，ack 语义成立：旧树 absent 验证通过）；重启 provision 新 id 新流健康、持久根锁干净释放（boot2 独占获取成功）。二删收敛语义另由重点 5（同进程 tombstone 二删）+ D2 覆盖 | ✅ |
| 10 | peer 面：peer 发 delete-namespace → unknown-op；D3 后进程继续可用 | **SA7-重点10**：真实 hub+peer（WS 连接 live 后操作） | peer 回执 `{ok:false,code:'unknown-op'}`（角色门先于参数门）；peer 进程存活且后续 status `ok:true`；hub 侧非法 id → `invalid-op-args` 后续 status `ok:true`；双向 exit 0 | ✅ |

**清单 10/10 + 2b 全部闭合，无一项失败。**

---

## 3. 数据流路线动态证据（Step 2.5）

SA1 设计无独立标题的「数据流路线」章节（SA4 已注记）——以 SA4「数据流路线审计（交 SA7）」
6 条路线为基线，逐跳运行时取证：

| 路线 | 驱动输入 | 每跳运行时证据 | 最终读取/投影 | 错误与 cleanup 证据 | Verdict |
|---|---|---|---|---|---|
| 删除主链（op G1–G4 → retire → 摘除 → registry → 日志删除 → 事件+回执） | stdin `delete-namespace`（D1/SA7 全部 host 用例） | D1 ack 同周期：快照全 absent + `{logRoot}/namespaces/{ns}` 树 absent（`existsSync` 直证）；`namespace-deleted` 事件先于回执；SIGTERM exit 0 | ack `ok:true` ⟺ 数据+日志双 absent（D1/D2/G4/F3/F5 各形态一致） | F3（数据段失败→快照留、日志不动）、F5（日志段失败→数据已清、日志半态）均诚实回执 + 重试收敛（§2 #4/#5） | pass |
| debounce 复活封堵 | 真实时钟：release 后（debounce/maxDirty 武装中）delete（×30） | delete 恒诚实结算；结算后 load null | 4×maxDirtyMs 真实时间后 store 零重建、load 恒 null | ActiveHandle 诚实拒绝→release→重试 ok（AD-5 契约链） | pass |
| diag-pump 迟到重建封堵 | retire 后注入迟到 `runtimeEmitterFor` + emit | dropStub（先于 ensureAdapter）→ 计数事件恰 1 次 | 100ms 让出后目录零重建 | un-retire（initStream）后重建正常（不外溢）；close 优先级回归 | pass |
| 复制 channel 收口 | 活跃双向 channel 中 delete（T-H5）+ 删除后新 peer 重连（2b） | peer 驱动写触发 hub 侧 apply 命中 runtime 缺席 → 任一侧 channel 终态事件（closed/failed/disconnected）；双进程零崩溃 | hub 快照/日志树恒 absent（4s 收口窗 + 6s 重连窗） | 新 peer authorize 被拒（channel 零 live）；hub 健康（status ok、已删 ns read → namespace-unknown） | pass |
| 失败/重入收敛 | F5 注入（marker/stream 段）→ 恢复 → 重试 | `log-delete-failed{step,errno}` 值域透传；数据段先行完成 | 同进程二删 `ok:true` + 全清（N1–N5 续走）；重启后新 id 新流不受 marker 污染 | F3 注入二删同样收敛（tombstone → absent → deleteDoc 重试） | pass |
| 停机竞态 | 删除发起后 +30/+80/+150ms SIGTERM（3 轮） | carrier tail 覆盖删除槽：回执先于退出（3/3） | ack 语义在 drain 内成立（旧树 absent 验证过） | 有界停机 exit 0（≤5.7s）；boot2 健康、锁干净释放 | pass |

**读写同一事实源核验**：删除写路径（registry carrier 槽 → `io.removeKey`）与读取端
（`loadDoc` 同一 `io.read`/主 mirror——F-6 套件终态 null 直证；Host `knownNamespaces`/
`deletedNamespaces` 内存事实源——G3 门在 F3/F5 二删与 M4 重启场景行为一致；诊断 adapter
缓存经 retirement 驱逐、迟到 emit 走 dropStub——重点 7 零重建直证）。未发现分叉、旧投影、
未刷新缓存或 close 后违规可读写。

---

## 4. SA7 补充测试（本轮新增交付物）

| 文件 | 用例 | 结果 |
|---|---|---|
| `apps/yjs-server/test/host-namespace-delete-sa7-dynamic.test.ts` | 重点 3/4/5/8/9/10 + 2b（7 用例，黑盒进程 E2E，chmod 故障注入零 mock） | ✓ 7/7（exit 0；`step2c` log） |
| `apps/yjs-server/test/host-diagnostics-retirement-sa7-228.test.ts` | 重点 7（retirement 封堵 + un-retire + close 优先级，2 用例） | ✓ 2/2 |
| `packages/persistence/test/doc-delete-sa7-realtime.test.ts` | 重点 6 / F-6（真实时钟 ×30 锤击 + 删除后重建，2 用例） | ✓ 2/2 |

三文件均落 root `vitest.config.ts` include 面（§6），已纳入本轮全量 `pnpm test`（§5）。

### 4.1 过程记录（诚实披露）

首轮运行 2 例失败，均为 **SA7 测试编写错误，非实现缺陷**，已修正后全绿：

1. **peer SIGTERM 得 143**：测试未越过 tsx wrapper「ready 后 ~600ms 内 SIGTERM」既有
   choreography 窗口（D4 用例内环境注记已备案的 wrapper 行为，与删除实现无关）。修正 =
   停机前 settle 1.5s（既有套件同款注记）。为甄别该 143 与「删除中 SIGTERM」是否同一机理，
   重点 9 重写为 3 轮多偏移（先过 wrapper 窗口再竞态）——3/3 exit 0 且回执先于退出，
   证实 143 属 wrapper 窗口而非删除×停机缺陷（时序证据 `[SA7-DV]` 行在 `step2c` log）。
2. **realtime 锤击期望错误**：并发 `Promise.all([deleteDoc, loadDoc])` 中 load 先赢时签发
   活 handle，`deleteDoc` 按设计（AD-5/P1c）诚实拒绝 `DocDeleteActiveHandleError`。原期望
   「delete 恒 ok」错误；修正 = 接受两种诚实结局（ok / ActiveHandle 拒绝→release→重试收敛）。
   该失败本身即为 F-6 交错面的**正向运行时证据**（活 handle 语义真实生效）。

另：typecheck 首轮抓出 SA7 测试文件 5 处可选方法调用类型错误（`binding.initStream?`/
`runtimeEmitterFor?` 可选面）——非空断言修正后 root typecheck exit 0。

**孤儿进程清理（精确归属后按 PID 处置，未用 `fuser -k` 盲清）**：全部作业收尾后 pgrep
发现两个遗留 `main.ts` hub 子进程——(a) 全量 run 中 T-H7 的 fixture-boot2 hub；(b) SA7
重点 10 首轮失败后 afterEach 以 SIGKILL 击杀 tsx wrapper 导致的 node 子进程孤儿（SIGKILL
不经 wrapper 转发——wrapper 孤儿化的既有行为面，与 D4 环境注记同族）。二者均经 config
路径精确识别为测试遗留后 `kill -9 <pid>` 清理，/tmp 临时目录不构成 worktree 污染。

---

## 5. 工程门（AC2/AC4；记录完整实际退出状态）

| 门 | 命令 | 实际退出状态 | 日志 |
|---|---|---|---|
| root typecheck（14 包 tsc 链） | `pnpm typecheck` | **exit 0**（含 SA7 3 个新测试文件） | `/tmp/sa7-228/gate-typecheck2.log` |
| 生成物零漂移（ADR-0005） | `pnpm generate --check` | **exit 0** | `/tmp/sa7-228/gate-generate-check.log` |
| whitespace 门 | `git diff HEAD --check` | **clean（exit 0）** | — |
| 全量测试（CI Test 同入口） | `pnpm test`（= `vitest run --typecheck`，maxWorkers 1） | **exit 1**（276/279 文件、2979/2984 用例绿；5 失败逐例归属为本票零触碰的既有边际预算/负载 flake——§5.1） | `/tmp/sa7-228/gate-full-test.log` |
| CI 具名物化步骤 ×4 | 见 §5.2 | **全部 exit 0** | `/tmp/sa7-228/gate-ci-steps.log` + `ci-step1-4.log` |

### 5.1 全量 `pnpm test`

命令：`pnpm test`（= CI `Test` 步同入口：`NODE_OPTIONS=--conditions=nomicore-source vitest run --typecheck`，
maxWorkers 1）。实际退出状态：**exit 1**——

```
Test Files  3 failed | 276 passed (279)
     Tests  5 failed | 2979 passed (2984)
Type Errors  no errors
FULL_TEST_EXIT=1
```

**5 例失败全部不在 #228 diff 触及面，且逐例归属闭合（非 #228 回归）**：

| 失败文件（最后变更 commit） | 失败形态 | 归属证据（本轮实测） | 结论 |
|---|---|---|---|
| `registry-phase5-replication-red.test.ts`（b155c73/#202，本票零触碰） | AC-6 `persistence-degraded` 超时 5000ms（**SA4 F-7 已备案的既有边际预算用例**） | 隔离复跑 **16/16 绿（3062ms）**；SA4 基线 A/B 已证基线空载即可达 4744ms（预算边际是既有特性） | 既有负载型 flake（F-7 同源），非本票回归 |
| `generate-cli-check.test.ts`（e938213/#203，本票零触碰；`pnpm generate --check` 根门 exit 0） | 3 例 `Test timed out in 5000ms`（默认预算） | 隔离复跑仍 3 例 5288–5557ms 超时（同文件兄弟 spawn 用例 2.9–3.4s 通过）；**放宽预算 `--test-timeout 20000` 复跑 8/8 绿 exit 0**——功能完好，纯「本环境子进程 spawn 延迟 vs 5s 默认预算」边际 | 既有环境边际预算，非本票回归（满载/隔离两轮失败的用例集合不同——非确定性破坏的排除证据） |
| `ws-replication-sa7-issue171-real-transport.test.ts`（b155c73/#202，本票零触碰；ws-replication 包 0 行 diff——AD-9 亲证） | RT-G5 状态观测窗竞态（`'blocked'` vs `'draining'`） | 隔离复跑 **4/4 绿（4009ms）** | 负载型 flake，非本票回归 |

**#228 范围触发证据**：全部 11 个本票测试文件在全量 run 中逐文件 `✓`（grep 直证，见 §6）。
处置意见：3 个边际文件的显式 per-test timeout 加固归**收尾轮**（F-7 路由的同类扩展：
`generate-cli-check` spawn 用例与 `ws-replication` real-transport 观测窗），独立于本票。

### 5.2 CI 具名物化步骤（`--passWithNoTests=false`，与 ci.yml 逐条同款）

| 步骤 | 命令 | 实际退出状态 | 用例数 |
|---|---|---|---|
| Persistence contracts | `pnpm exec vitest run packages/persistence/test/persistence-contract.test.ts --typecheck --passWithNoTests=false` | **exit 0** | 6/6 |
| Persistence unload dirty-notification regression | `pnpm exec vitest run packages/namespace-registry/test/registry-sa7-rev1.test.ts -t "R5P" --typecheck --passWithNoTests=false` | **exit 0** | 1 passed + 5 skipped（`-t` 过滤设计内） |
| Domain scaffolds check | `pnpm exec vitest run packages/vfsl/test/domains-scaffold.test.ts --passWithNoTests=false` | **exit 0** | 2/2 |
| Materialize root tests | `pnpm exec vitest run packages/doc-runtime/test/materialize-root.test.ts --typecheck --passWithNoTests=false` | **exit 0** | 59/59 |

---

## 6. 测试触发范围与 CI 证据边界（Step 3/4 立法面）

- **触发范围静态核验**：本票全部 11 个新增/改动 `.test.ts` 文件逐一匹配 root
  `vitest.config.ts` include（`packages/*/test/**/*.test.ts` / `apps/*/test/**/*.test.ts`）；
  零 `.skip`/`.todo`/`.only` 标记（grep 直证）。改动面中的 `*.test-d.ts`（3 个）落
  typecheck include（`pnpm test --typecheck` 同入口收集，全量跑 Type Errors no errors）。
- **Step 3（playwright/E2E spec）**：不适用——设计 §6 测试清单全部为 vitest `.test.ts`，
  本票零 `*.spec.ts` 面。
- **Step 4（vitest package 触发）**：本地动态触发证据 = 全量 `pnpm test` 逐文件 `✓` grep
  直证——11 个本票 `.test.ts` 文件**全部**出现在 `gate-full-test.log` 的通过清单
  （`host-namespace-delete-diagnostic-link-red` / `-under-replication` / `host-diagnostic-restart-resume` /
  `host-diagnostic-retention-sweep` / `host-trusted-replication-diagnostics` /
  `host-namespace-delete-sa7-dynamic` / `host-diagnostics-retirement-sa7-228` /
  `registry-delete-orchestration` / `doc-delete-semantics` / `doc-delete-storage` /
  `doc-delete-sa7-realtime`，各恰 1 条 `✓` 记录）。**CI runner log 证据在本阶段不可得**：
  本 dispatch 禁止 commit/push/建 PR，无 PR 即无 CI run——此为环境边界而非豁免；本地门与
  CI 完全同入口同参（ci.yml `Test` 步 = `pnpm test`；`Typecheck` 步 = `pnpm typecheck`；
  regen-diff 步 = `pnpm generate --check`；4 个具名物化步骤 §5.2 逐条同款复跑全绿）。
  CI 侧触发证据移交 runner 在 push 后核验。
- **协议假设真实行为（AD-7）**：T-H5 复跑（channel 失败收口零崩溃）+ SA7-重点2b
  （重连 authorize 拒绝、channel 零 live）以真实 WS 链路证实；SA4 的源码级验证
  （`hub-namespace.ts` released-lease 错误路径、运行期零 bindings 重加路径）与运行时行为一致。

---

## 7. 发现清单

| # | 级别 | 发现 | 证据 | 处置 |
|---|---|---|---|---|
| SA7-F-1 | 跟进（既有，非本票） | 全量 `pnpm test` exit 1：5 失败全部位于本票零触碰的 3 个既有文件（registry AC-6 = SA4 F-7 同源负载超时 / codegen 3 例 spawn 型 5s 默认预算边际 / ws-rep RT-G5 观测窗竞态）；隔离复跑 + 放宽预算复跑 + 零耦合核验（git diff 0 行 + 最后变更 commit #202/#203）逐例归属闭合（§5.1） | `gate-full-test.log`、`isolated-rerun-3files.log`、`codegen-20s.log` | **收尾轮**给 `generate-cli-check` spawn 用例与 `ws-replication` real-transport 用例显式 per-test timeout（F-7 路由的同类扩展），独立于本票；不构成本票驳回 |
| SA7-OBS-1 | OBS（既有，非本票） | tsx CLI wrapper 对「ready 后 ~600ms 内 SIGTERM」存在 choreography 竞态（得 143）；直接落 app 子进程恒 exit 0。已在红灯契约 D4 用例内环境注记备案；SA7 首轮 peer 用例复现一次 | `step2` log（143）vs `step2c` log（settle 后 3/3 exit 0） | 维持既有备案；测试侧 settle 规约已沿用；不阻断 |
| SA7-OBS-2 | OBS | diag 启用 hub 在「删除中 SIGTERM」形态的优雅停机 drain 实测 ~5.6–5.7s（有界，≪30s 预算；含泵 drain/删除槽 tail） | `step2c` log `[SA7-DV] 重点9` 行 | 正常有界行为，无需处置 |

---

## 8. Verdict

**approve**（`requiresConflictRecheck: false`）

依据：

1. **Step 0**：SA4 iteration 1 verdict = approve（前提成立，SA7 仅可独立发现 fail）。
2. **Step 1**：SA6 红灯契约 D1–D4 4/4 绿（复跑 + 全量形态双绿）；T-H5–H8、T-P*/T-R*
   全绿——与 SA3/SA4/SA6 三方声明逐位一致。
3. **Step 2**：SA4「动态审核重点」10 项 + 重连半句全部以真实运行时证据闭合（§2），
   **零失败**；并发（G4/F-6 真实时钟）、故障注入（F3/F5 chmod EACCES）、重启
   （M4 marker 半态 × provision 新 id）、停机竞态（SIGTERM 三轮）、peer 面、诊断迟到
   流量封堵、活复制收口/重连拒绝——每项均有可复核命令与日志。
4. **Step 2.5**：SA4 移交的 6 条数据流路线逐跳运行时取证全 pass（§3），读写同一事实源
   无分叉、无复活、无旧投影、cleanup 有界。
5. **工程门**：`pnpm typecheck` exit 0、`pnpm generate --check` exit 0、
   `git diff HEAD --check` clean、CI 4 具名物化步骤全 exit 0；全量 `pnpm test` exit 1 的
   5 失败**逐例归属闭合为本票零触碰的既有边际预算/负载 flake**（隔离复跑绿 ×2 文件、
   放宽预算复跑绿 ×1 文件、git 零耦合 + 最后变更 commit #202/#203——§5.1），#228 范围
   11 文件在全量 run 中全绿。
6. **SA7 独立攻击未发现任何 #228 缺陷**；新登记 SA7-F-1（全量门边际文件 timeout 加固，
   F-7 路由同类扩展）与两项 OBS 均路由收尾轮，不构成本票驳回。

### 8.1 移交清单（收尾轮）

- **SA7-F-1 / F-7 同类**：`generate-cli-check` spawn 用例、`ws-replication` real-transport
  观测窗、registry AC-6 —— 显式 per-test timeout（独立于本票）。
- **既有移交项维持**：F-3（REPORT M4 改述）/ F-4（design §3 ALLOW LIST 补录）/ F-8
  （registry.ts L1980-1983 陈旧注释）/ F-9（tombstone 单调增长备案）/ F-10（CI 锚文件
  物化可选加固）——均 SA4 已登记，本轮动态验证未改变其状态。
- **CI 侧触发证据**：push 后由 runner 核验（本阶段零 push 约束下的环境边界，§6）。

### 8.2 交付物

- 本文件：`wiki/raw/task_228_sa7_report.md`。
- SA7 补充测试 ×3（CI 锚，已入全量门）：
  `apps/yjs-server/test/host-namespace-delete-sa7-dynamic.test.ts`（7 用例）、
  `apps/yjs-server/test/host-diagnostics-retirement-sa7-228.test.ts`（2 用例）、
  `packages/persistence/test/doc-delete-sa7-realtime.test.ts`（2 用例）。
- 审计日志：`/tmp/sa7-228/`（step1-targeted / step2*-supplementary / gate-* /
  isolated-rerun / codegen-20s / ci-step1-4）。
- 结构化结果：`verdict = approve`，`requiresConflictRecheck = false`，
  `artifactPaths` 见 tool call。
