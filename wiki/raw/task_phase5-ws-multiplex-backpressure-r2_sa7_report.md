# SA7 动态验证报告（Revision Round 2）— issue #137 Phase 5 R2-1~R2-5

- **Date**: 2026-08-30
- **Verdict**: **pass**（仅依据干净态证据，见「状态事故登记」节）
- **被验对象**: commit `34bbfba` + `c95c088`（基线 `58150ad` → HEAD），worktree `/home/wangjian/nomicore-fix-issue-137`
- **输入**: SA4 静态验尸（verdict **pass**，移交 4 项动态抽查点）/ SA6 红灯报告（8 红 + 1 直绿 → 修复后 103 全绿）/ 设计 822 行最终态 / SA2 评审（R2 pass）
- **SA4 verdict 校对（Step 0）**: `task_phase5-ws-multiplex-backpressure-r2_sa4_review.md` L4 = `Verdict: pass` → 进入动态验证（SA7 不下调、只可独立发现 fail）

---

## 〇、状态事故登记（2026-08-30 · 本报告前置声明）

**事故**：SA4 的红灯复现实验（`git checkout 58150ad -- 原地回退`，无 trap 兜底）在本 SA7
验证期间处于暂态窗口。本 SA7 被中断的回合中，部分早期测试运行可能面对「修复前 src +
SA7 新测试文件」的混合态，**该窗口内的全部早期运行结果按保守口径一律作废**：

| 作废项（中断前） | 作废理由 |
|---|---|
| 早期全量 103 测试绿（中断前首跑） | 无法事后自证与 SA4 实验窗口零交叠 |
| 早期 R2-4 hubN=27 ×8 观测（DIAG） | 同上（观测脚本运行期跨窗口不可排除） |
| 早期 transport 构造迭代期全部运行（多轮红/绿） | 本属构造调试非证据，且跨窗口 |
| 早期受控差分（旧 src B pass / A R2-3 红） | 「新实现侧」对照面跨窗口不可采信 |
| 早期补充测试通过记录 | 同上（含于全量） |

**干净态重验协议（本报告全部证据的唯一来源）**：

1. 重验前总控亲验 + SA7 复验三方一致：HEAD = `c95c088`，`git status --porcelain
   packages/ws-replication/src packages/ws-replication/package.json` 为空、
   `git diff HEAD -- src` 为空；修复标记在位（`controlReserveBytes` 于
   backpressure/types/defaults/validate 四文件；encodeMessage/codecFieldLimits 门禁
   peer 0 / hub 2）。
2. 全部重验命令起独立后台进程（`setsid nohup … & disown`），日志/退出码落
   `.mabf-bg/sa7-r2-*`（本报告逐项引用）。
3. 涉临时改动的实验（R2-4 DIAG 注入、差分回退）在脚本内 `git checkout --` 还原并复验
   `git status` 为空后才采信其结果。
4. transport 测试终版（含并发负载稳健性两轮修订）另做终版 ×3 独立复跑，不以迭代期
   绿灯替代。

---

## 一、Step 1 — SA6 红灯套件（现为修复后终态，期望全绿）

**命令**：`npx vitest run packages/ws-replication`（独立后台进程）

**结果**（`.mabf-bg/sa7-r2-full-vitest.log`，exit 0）：

```
Test Files  17 passed (17)
     Tests  106 passed (106)
Type Errors  no errors
```

- 17 文件 = 既有 15（94 round-1 + 9 r2-red）+ SA7 本轮新增 2（transport 2 用例 +
  supplement 1 用例）；103 既有零回归 + 3 新增全绿。
- `npx tsc -p packages/ws-replication/tsconfig.json` → exit 0
  （`.mabf-bg/sa7-r2-tsc.exit`）；`git diff --check` → exit 0
  （`.mabf-bg/sa7-r2-diffcheck.exit`）。

**[Step 1 结论] SA6 红灯: 🟢 GREEN —— 8 红灯全部保持转绿 + R2-5 绿 + 既有零回归。**

---

## 二、Step 2 — SA4 移交 4 项动态抽查点

### 抽查点 1：R2-4（生效）hub n 实测落点 — ✅ 通过

**方法**：对 r2-red `R2-4 (生效)` 用例临时注入 `[SA7-DIAG]` 观测日志（断言后 console.log，
零断言改动）→ 独立进程复跑 8 次 → `git checkout --` 还原（复验 status 为空）。

**结果**（`.mabf-bg/sa7-r2-r24-hubn.log`，8/8 次全绿 + 8 行观测）：

```
[SA7-DIAG] R2-4(生效) observed: hubN=27 allowed=26 ackBytes=57 bounds=[27,35]   × 8
```

- 实测落点 **hubN=27（= allowed+1，区间下界），8/8 确定性一致**，落在 SA4 预期区间
  **[27,34]** 内（守卫上界 35 未触及）。
- 口径核对：`allowed=26`（= floor(1500/57)，运行时实测帧长推导）、`ackBytes=57` 与
  SA6/设计 N2 实测一致。终值取下界 = queueMicrotask 延迟投递下在途帧未赶及 closedFlag
  前 dispatch（N2「终值非确定、可达上界 34」——实测确定性收敛于下界，区间守卫自适配
  形态如设计钉死）。

### 抽查点 2：真实 transport 缺省零漂移抽样 — ✅ 通过（差分证明）

**新增测试**：`packages/ws-replication/test/ws-replication-sa7-r2-transport.test.ts`
（真实 TCP loopback：node:net 真实 socket + 4B 长度前缀成帧适配器；
`bufferedAmount = socket.writableLength` **真值零注入**——§4.2 duck-typed seam 的生产
读数来源；暂停段由内核流控真实驱动；limits 全缺省零覆写）。

**真实链路结构发现（测试构造层，非协议缺陷）**：ACK 与 data 同流——peer 侧暂停读取
切断 ACK 回流后，单连接暂停段内可达 control 流量上界 = Σ_ns 窗口（32/ns）。故：
- **A（存活侧）**：4 ns × 32 笔在途 = 128 ACK ≈ 7.3KiB ≪ 64KiB；
- **B（耗尽侧）**：40 ns × 32 笔 = 1280 ACK ≈ 73KiB > 64KiB（多 namespace 复用单连接
  是 issue #137 本轮主题——40 ns 复用即真实可达形态）。

**结果**（终版 ×3 独立复跑 `.mabf-bg/sa7-r2-transport.log` exit 0，且全量并发负载下
全绿——见 Step 1）：

| 用例 | 干净态结果 | 断言锚 |
|---|---|---|
| A 存活侧 | ✓ ×3 + 全量 | 真实暂停段（入口验证 visible > 512KiB）+ 128/128 ACK 全上 wire + 0 ERROR + 0 RESYNC + 连接 ready |
| B 耗尽侧 | ✓ ×3 + 全量 | 恰 1 ERROR(CONNECTION_BACKPRESSURE) + hub close(1011) + peer backoff + ACK 发送量 ≥ 帧长自适配许可数−2（57B 定长至 seq=128、其后 58B——r2-red 同源实测） |

**缺省零漂移差分（受控实验，`/tmp` 级回退——checkout `58150ad` src → 复跑同一测试 →
HEAD 精确还原，复验 status 空 + 标记在位；`.mabf-bg/sa7-r2-transport-oldsrc.log`）**：

| 用例 | 旧实现（lowWater=64KiB ceiling） | 新实现（controlReserveBytes=64KiB） | 判定 |
|---|---|---|---|
| B 耗尽侧 | **✓ PASS**（同 1 ERROR CONNECTION_BACKPRESSURE + 1011 + backoff + 同边界带） | ✓ PASS | **缺省边界行为逐帧一致——零漂移得证** |
| A 存活侧 | ✗ FAIL 于 `RESYNC_REQUIRED===0`（得 1）；**其前两断言 `ACK===128`、`ERROR===0` 均通过** | ✓ PASS | control 语义一致（128 ACK 全发 + 零耗尽）；唯一差异面 = 旧 `overflows()` 把在途字节计入 4MB 队列上限 → 误溢出收口 = **R2-3 缺陷原貌在真实链路复现**（本轮已修复并有红灯锚），非 reserve 漂移 |

**结论**：缺省 64KiB 边界两侧行为新旧一致（B 差分同绿）；A 的旧实现红恰为 R2-3 修复
真实性提供真实链路级佐证。零漂移声明（缺省 `controlReserveBytes=64*1024` 与旧
`lowWater=64*1024` 逐帧等价）在活链路上成立。

### 抽查点 3：R2-1 直发路径 in-flight>0 变体 — ✅ 通过（新增补充测试）

**新增测试**：`packages/ws-replication/test/ws-replication-sa7-r2-supplement.test.ts`
（fake-duplex + fake scheduler 纪律，与既有套件一致；真实 yjs/Registry/Runtime）。

**构造**：saveGate 扣住首笔 ACK（窗口 1/8 占用、队列空）→ 单笔 20KB 超限直发 →
断言链：

1. **收口锚**：wire 级 `RESYNC_REQUIRED ≥ 1`（静默丢失下恒 0）；
2. **守卫**：peer 本地 blurb === BIG（不回滚）+ 连接 ready（ns 域收口）；
3. **延迟恢复锚（本变体独有断言面，静态闭环 peer-namespace:481-483 的动态验证）**：
   in-flight>0 时恢复 round 不得启动——ns 状态停留 `needs-resync`（快照确定性成立：
   唯一重触发点 onUpdateAck 被 saveGate 结构性扣住）+ hub 保持 seed；
4. **释放门闩** → ACK 到达 → `maybeStartRecovery`（窗口已空）→ 恢复 round →
   hub 收敛 BIG + 状态回 live。

**结果**：全量套件内绿（`.mabf-bg/sa7-r2-full-vitest.log`，17 文件/106 测试之一）。
「窗口部分占用 + 单笔超限直发 → 收口 → onUpdateAck 延迟恢复」链路经动态验证成立
（SA4 标注的 slice-10 可选加固位补上专测）。

### 抽查点 4：vitest 触发证据摘录 — ⚠ 无法摘录（流程阶段限制，非触发缺陷）

**事实**（`.mabf-bg/sa7-r2-ci-evidence.log`，2026-08-30 采集）：

- PR #162 checks（test(20)/test(24)）SUCCESS——但属 **round-1**（head `58150ad`，
  run 33199330016，2026-08-28）；
- 本地 HEAD 领先 origin 两个 commit（`34bbfba`、`c95c088`）——**R2 变更未 push**
  （任务简报验收第 6 条明令「禁止 push/PR/label 操作」）→ **R2 的 17 文件/106 测试
  无任何 CI run 可摘录**。

**替代证据链**：

1. 接线（静态，SA4 §六复核 + SA7 抽验）：根 `vitest.config.ts` include
   `packages/*/test/**/*.test.ts` 覆盖全部 ws-replication 测试文件；CI `Test` step =
   `pnpm test`（= `vitest run --typecheck`）+ `pnpm typecheck` 显式含
   `tsc -p packages/ws-replication/tsconfig.json`；
2. 本地等价执行：`npx vitest run packages/ws-replication` 全量绿（Step 1 日志，
  exit 0，含 Type Errors: no errors）。

**处置**：非 `vitest-package-not-triggered`（无证据表明 CI 会跳过该包——接线完好）；
按「环境/流程阶段阻塞」登记移交总控：**push 后需补 CI run 的
`Running/Tests/Test Files` 摘录以完成动态触发闭环**。本轮 SA7 无 push 权限（边界铁律）。

---

## 三、Spec / vitest 触发证据（Step 3 / Step 4）

- **E2E spec（Step 3）**：本轮 SA1 设计零 `*.spec.ts` 改动（SA4 §六：「E2E spec：本轮
  零 `*.spec.ts` 改动，§1.3 不触发」）→ **不触发**。
- **vitest（Step 4）**：见抽查点 4——改动 `*.test.ts` 全部位于
  `packages/ws-replication/test`，CI 接线经核覆盖；因 push 被禁无 CI run，本地全量绿
  + 接线证据替代，push 后补摘录（移交项，非阻断）。

---

## 四、验证证据（命令 + 结果，全部干净态）

| # | 命令 | 结果 | 日志 |
|---|---|---|---|
| 0 | 干净态核验：`git log -1` / `git status --porcelain src pkg` / `git diff HEAD -- src` / 四标记 grep / 门禁 grep | HEAD=c95c088、status/diff 空、controlReserveBytes×4 文件、门禁 peer 0/hub 2 | — |
| 1 | `npx vitest run packages/ws-replication`（后台独立进程） | **17 文件 / 106 测试全绿，Type Errors: no errors，exit 0** | `.mabf-bg/sa7-r2-full-vitest.log` / `.exit` |
| 2 | R2-4 hub n 观测（DIAG 注入 → r2-red 单文件 ×8 → 还原 → 复验空） | **8/8 hubN=27（=allowed+1，∈[27,34]），8/8 Tests 9 passed** | `.mabf-bg/sa7-r2-r24-hubn.log` |
| 3 | transport 终版 ×3（独立进程） | **3× `Tests 2 passed (2)`，exit 0** | `.mabf-bg/sa7-r2-transport.log` / `.exit` |
| 4 | 差分：`git checkout 58150ad -- src pkg` → 复跑 transport → `git checkout HEAD --` 还原 + 复验 | 旧 src：B ✓ / A ✗（仅 RESYNC 断言，ACK=128∧ERROR=0 先过 = R2-3 原貌）；还原后 status 空 + 标记在位 | `.mabf-bg/sa7-r2-transport-oldsrc.log` / `.exit` |
| 5 | `npx tsc -p packages/ws-replication/tsconfig.json` | exit 0 | `.mabf-bg/sa7-r2-tsc.exit` |
| 6 | `git diff --check` | exit 0 | `.mabf-bg/sa7-r2-diffcheck.exit` |
| 7 | `gh pr view 162` / `gh run list --branch <branch>` | PR checks 绿属 round-1（head 58150ad）；R2 两 commit 未 push、无 CI run | `.mabf-bg/sa7-r2-ci-evidence.log` |

---

## 五、SA7 产出清单

| 产物 | 位置 | 状态 |
|---|---|---|
| 动态验证报告 | `wiki/raw/task_phase5-ws-multiplex-backpressure-r2_sa7_report.md` | 本文件 |
| 补充测试（抽查点 2：真实 transport 缺省零漂移 A/B） | `packages/ws-replication/test/ws-replication-sa7-r2-transport.test.ts` | 全绿（终版 ×3 + 全量并发） |
| 补充测试（抽查点 3：R2-1 直发 in-flight>0 变体） | `packages/ws-replication/test/ws-replication-sa7-r2-supplement.test.ts` | 全绿（全量内） |
| 临时诊断（抽查点 1） | r2-red `[SA7-DIAG]` 注入 | 已还原（git status 复验空） |
| 受控差分实验（抽查点 2） | src 原地回退/还原 | 已还原（status 空 + 标记复验在位） |

两个新测试文件均为工作区未提交状态（commit 决策移交总控；本轮验收第 6 条 REPORT.md
不 commit，SA7 未做任何 git 提交/push）。

---

## 六、结论

- SA4 verdict = pass（Step 0 校对）→ SA7 在其上独立动态验证；
- SA6 8 红灯保持转绿 + R2-5 绿 + 既有 94/94 零回归（干净态 17 文件/106 测试全绿）；
- SA4 移交 4 项动态抽查点：**3 项通过**（hub n 实测落点 27∈[27,34] 8/8；真实 transport
  缺省零漂移经差分证明；R2-1 直发 in-flight>0 变体补充测试通过），**1 项流程阶段限制**
  （CI 触发摘录因禁 push 无 run 可摘——接线完好 + 本地等价证据在案，push 后补摘录）；
- SA7 未发现任何新的 fail 面；两次受控实验（旧 src 差分）反而为 R2-3 修复真实性提供
  真实链路级佐证。

**verdict: pass**（干净态证据；唯一移交项 = push 后补 CI run 摘录，非阻断）。
