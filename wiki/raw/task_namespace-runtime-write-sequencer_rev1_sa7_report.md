# SA7 动态验证报告（修订轮 R1）— namespace-runtime fatal message 稳定面 + fatal/close 术语边界

**Date**: 2026-08-24
**Worktree**: /home/wangjian/nomicore-fix-issue-90（branch `fix/issue-90-on-docs-namespace-runtime`，issue #90 / PR #100）
**SA4 verdict（Step 0 校对）**: pass（`task_namespace-runtime-write-sequencer_rev1_sa4_review.md` 顶部）→ SA7 进入动态验证
**SA7 verdict**: **pass**（全部动态断言绿；附 2 条非阻断观察移交记录，无新增缺陷）

## 验证范围

1. 独立进程复跑定向 vitest（rev1 三用例真实触发证据）
2. P1 运行时实测：notifier-failure 与 unknown-pipeline-throw 双路径（cause 同一引用 / message 无 sentinel / status.fatal 纯净）
3. P1 逐字节稳定性（同进程不同输入/异常类型 + 跨进程双 sentinel 种子）
4. P2 运行时实测：P0 fatal 摘要与 S1 gate issue 措辞
5. SA4 动态审核重点逐项（yjs 注入点稳定性 / throw undefined 边界 characterize / S2-S4 cause 区分可观测性）
6. 元数据纯净性核对（staged 集与业务 diff 面）

方法：一次性探针 `/tmp/sa7-r1/probe.mts`（`pnpm exec tsx` 直跑公共 seam `createNamespaceRuntimeWithSeam`，运行时抓取真实 rejection；**不入库、跑完即弃**；工作区经 git status 前后对照确认零污染）。探针自实现 140 项断言（非 vitest 断言库），两次哨兵种子（A/B）各跑一遍。

> 探针工程注记：探针必须与 src 使用**同一 yjs ESM 实例**（`import .../yjs/dist/yjs.mjs`）；首跑用 `createRequire` 拉起第二个 CJS yjs 实例时，doc-runtime 构造/instanceof 检查失效（yjs 官方 "Yjs was already imported" 警告 + read 面 PATH_NOT_ALLOWED），修正后全部通过——该现象本身佐证 doc-runtime 对 genuine Y.Doc 的实例校验在真实链路上生效。

## 1. 独立复跑触发证据

命令（独立进程）：

```bash
pnpm exec vitest run packages/namespace-runtime/test --no-typecheck
```

结果：**exit 0**，汇总行：

```
Test Files  10 passed (10)
     Tests  50 passed (50)
```

含 `✓ packages/namespace-runtime/test/runtime-write-fatal-message-rev1.test.ts (3 tests)`。

rev1 单文件 verbose（逐用例触发证据，**exit 0**）：

```
✓ ... > AC-R1-4 notifier-failure 路径：notifyDirty 抛错 → rejection 为 RuntimeWriteFatalError（phase=notify-dirty-failed, committed=true）、cause 严格等于原始异常实例、message 不含原始异常/ROOT/SCHEMA/input sentinel
✓ ... > AC-R1-4 unknown-pipeline-throw 路径：…（phase=unknown-pipeline-throw, committed=true 保守）…
✓ ... > AC-R2-1 P0 internal fault 摘要（FATAL_P0_INTERNAL_MESSAGE）与 fatal 后 S1 gate disabled 措辞…
Test Files  1 passed (1)
     Tests  3 passed (3)
```

结论：rev1 三用例真实触发且全绿（SA6 红灯锚已在实现后转绿，与总控亲跑 50/50 一致）。

## 2. P1 动态实测（探针，seed=A/B 双跑，各 140 断言全绿，exit 0）

### 2a. notifier-failure 路径（S6 `notify-dirty-failed`）

驱动：seam 注入 `notifyDirty` 抛出携带四重 sentinel（`NSRT-LEAK-PATH-SENTINEL… | ROOT_CONTENT_SENTINEL… | SCHEMA_TEXT_SENTINEL… | MUTATION_INPUT_SENTINEL…`）的原始 `Error` 实例。运行时抓取真实 rejection，断言结果：

- rejection `instanceof RuntimeWriteFatalError` ✅；`phase='notify-dirty-failed'`、`committed=true` ✅
- `wr.cause === rawErr`（**同一引用**，`'cause' in wr === true`）✅ —— AC-R1-2
- `wr.message` 不含任何 sentinel、不含「原始异常证据引用」模板段、单行无 stack 痕迹 ✅；含 `NSRT-WRITE-FATAL` / `phase=notify-dirty-failed` / `committed=true` / `不补偿` ✅ —— AC-R1-1
- `status.fatal` 键集恰为 `{code,message}`（`Object.keys` 实测），`code='NSRT-FATAL-WRITE-INTERNAL'`，`stack`/`cause` 键缺席且值 undefined，`JSON.stringify(status.fatal)` 无 sentinel ✅ —— AC-R1-3
- notifier 恰一次；**不虚假回滚**（S5 先提交的 n=2 保留）；`rootWrite.enabled=false` + `read.enabled=true` ✅

### 2b. unknown-pipeline-throw 路径（S5 ⓪ guard 逃逸）

驱动：Y.Doc 语义面 Proxy 在 `_transaction`/`_transactionCleanups` 第一访问点抛非 branded `TypeError`。运行时断言：

- rejection 形状同上全绿（`phase='unknown-pipeline-throw'`、`committed=true` 保守、`cause === rawErr` 同一引用、message 稳定无泄漏、status.fatal 纯净）✅
- committed:true → best-effort notifier 恰一次；⓪ 在任何 doc 触碰前拒绝 → **零写入**（read n=1）✅

### 2c. message 逐字节稳定性

- 同进程、不同输入值（n=2/777、不同 mutation 目标）、不同异常类型（`Error`/`RangeError`/`TypeError`/thrown string）、不同 sentinel 载体：notifier 路径 message **逐字节相同**；unknown-pipeline 路径 message **逐字节相同**；两路径 message 仅 `phase=` 段不同（其余字节一致）✅
- **跨进程**：`PROBE_SEED=A|B` 两套完全不同 sentinel 各起独立进程，`MSG_SHA` 完全一致（notifier=`533c425034cd849e`、unknown=`ade36b07fdb1a102`、write-slot-internal(undefined 变体)=`468a78a3708587f0`），全文 diff 逐字节相同（`CROSS_PROCESS_MSG_BYTE_IDENTICAL=yes`）✅

稳定 message 原文（两路径，运行时抓取）：

```
NSRT-WRITE-FATAL: ROOT write internal fatal（phase=<phase>, committed=<bool>）；internal fatal 已永久禁用本 Runtime 的全部写能力，读取仍保留；不补偿、不 fallback、不声称回滚；上层不得自动重试非幂等写。
```

## 3. P2 动态实测

P0 internal fault（seam compile 抛携带 sentinel 的异常）后运行时取值：

- `status.fatal`：`code='NSRT-FATAL-P0-INTERNAL'`、键集恰 `{code,message}`、message 无 sentinel、无「永久关闭」/closing/closed、含 禁用/读取/保留 ✅
  - 原文：`P0 schema preparation internal fault：编译通道产生结果联合之外的异常；internal fatal 已永久禁用本 Runtime 的全部写能力，读取仍保留。`
- fatal 后 S1 gate `RUNTIME_WRITE_DISABLED` issue.message（运行时取值）：
  - `RUNTIME_WRITE_DISABLED: fatal 已置位（internal fatal 已永久禁用本 Runtime 的全部写能力，读取仍保留）——本调用零写入、输入零访问`
  - 无「永久关闭」/closing/closed、含 禁用/读取/保留、无 sentinel ✅；读取保留（n=1、read.enabled=true）✅ —— AC-R2-1

## 4. SA4 动态审核重点逐项结论

### 4.1 Node 20/24 双腿 CI（SA4 重点 1）

- 本地有效腿：PATH node = **v24.13.0**（探针与 vitest 均此腿全绿）。`/usr/bin/node` 为 v18.19.1，低于仓 `engines: >=20`，非有效腿——**本地无 Node 20 腿可跑**。
- `ErrorOptions.cause` 为 ES2022 标准语义（Node ≥16.9 起行为一致），严格相等断言在语义面无版本敏感性；本地 Node 24 实测绿。
- vitest 触发证据（Skill Step 4 联动）：rev1 文件本地 3/3 触发通过；**CI run 侧触发证据不在本轮射程**（修订轮 push 发生在 SA7 之后，当前无 post-rev1 CI run 可观察）——按 AC-R2-2 移交 runner/ciwatch，SA7 不宣称 CI 已绿。

### 4.2 rev1 用例 2 Proxy 注入点对 yjs 版本的稳定性（SA4 重点 2）

- lockfile 钉死 `yjs@13.6.32`（pnpm-lock.yaml L764/L1237；Node 20/24 双腿共用同一 lockfile → 注入行为一致）。
- 运行时实测：`_transaction` / `_transactionCleanups` 是 Y.Doc **实例自有字段**（`hasOwnProperty` 均 true；原型链上不存在；`transact` 结束后分别为 `null` / `[]`），且两字段在 yjs 发布类型面公开声明（`dist/src/utils/Doc.d.ts:49/53`，tx-guard.ts:48-50 引证）——非纯私有实现细节，^13.6.x 内漂移概率低。
- **漂移方向判定（安全方向失败）**：若 yjs 改名/移除字段，doc-runtime `assertOutermostTransactionContext` 走窗口 C fail-closed（E202 变体 C 原文即「疑似 yjs 版本漂移」），rev1 用例 2 与既有 sequencer 全家（正常写路径依赖 guard 放行）将**响亮变红**，不会静默通过。
- 结论：当前锁定版本下注入点稳定，漂移风险受控（loud-first）。✅

### 4.3 L-2 边界 characterize：`throw undefined`（只观测记录，不改代码）

- **S5 管线 `throw undefined`**（Proxy get trap throw undefined）：rejection 形状**完整**——instanceof / `phase='unknown-pipeline-throw'` / `committed=true` 保守 / message 与正常实例 cause 场景逐字节同文（sha `ade36b07fdb1a102`）/ 处置面（notifier 恰一次、零写入 n=1）全绿；`wr.cause === undefined` 且 `'cause' in wr === false`（options 被省略）。
- **S2 `getStatus()` throw undefined**：`phase='write-slot-internal'`、`committed=false`、0 次 notifier、零写入；cause 同上缺席；`runtime.getStatus()` 读面原样 throw undefined（#89 loud 契约——该场景下 fatal 摘要经 status 面暂不可观测，与既有 DV-2 行为一致）。
- 结论：SA4 L-2 预判属实——退化值 `undefined` 下 cause 通道被省略，「零信息损失」对该退化值不成立；但公共 rejection 形状、稳定 message、诚实 committed、处置面均完整。非本轮引入（两 throw 点既有写法），如实记录，不建议本轮修改。

### 4.4 L-4：S2 与 S4 的 cause 区分运行时可观测性

- **S2 带真实异常实例**：`wr.cause === rawErr`（同一引用）且 cause 携带原始 stack（诊断信息经 cause 通道零损失）；message 不含 `adapter-boom` 原文 ✅。
- **同 phase 下 cause 有/无是可判别器**（运行时对照实测）：S2-err（cause 在）vs S2-throw-undefined（cause 缺席）两者公共 message **完全同文**——判别仅剩 cause 通道，且该判别真实可观测。
- **S4（不变量破坏）经公共 seam 结构不可达**（动态枚举+实测）：`installActive` 恒原子同置 `schemaState='ready'`+`activeTools`；仅有的两条非 ready 路由均先于 S4 分流——`unavailable` 实测走 ok:false（`SCHEMA_UNAVAILABLE` 稳定码、零写入、无 fatal、读取保留），fatal 实测走 S1 gate disabled。S4 无外部触发面（state 为闭包私有）。
- **边界注记（移交记录，非缺陷）**：S2 以 `throw undefined` 退化违约时与 S4 公共面**不可区分**（同 phase、同 message、均无 cause）——SA4 L-4「S2 有异常实例、S4 无」的判别在该退化点失效（与 L-2 同根）。正常 adapter 异常（实例）下判别成立；两种情形均指示包内/adapter 缺陷，处置（永久禁用写、loud rejection）一致，无行为分叉需求。

### 4.5 元数据纯净性核对（SA4 重点 5 / L-5）

`git status --porcelain` + `git diff --cached --name-only` + `git diff HEAD --stat`（只核对，未清理）：

- **staged 集恰 3 文件，全业务面**：`packages/namespace-runtime/test/runtime-write-fatal-message-rev1.test.ts`（A）+ `wiki/raw/task_namespace-runtime-write-sequencer_rev1.md`（A）+ `wiki/raw/..._dispatch.md`（A，wiki 白名单）。**无** `.mabf/**`、`.mabf-bg/**`（目录不存在）、`REPORT.md`、`.mabf-done`。✅
- 工作区残留（未 staged，不进 commit）：`.mabf-done`(D)、`REPORT.md`(M)、`.mabf/`(??)、SA4/SA7 报告(?? wiki/raw)。`git diff HEAD --stat` 11 文件 = 9 业务文件 + 上述 2 项 MABF 残留——与 SA4 L-5 描述一致。
- **commit 纪律提醒仍然有效**（回流 SA3/总控）：收尾仅显式 add `packages/**` + `wiki/raw/**`，严禁 `git add -A` / `git commit -a`。

## 逐 AC 对照（动态面）

| AC | 结论 | 动态证据 |
|---|---|---|
| AC-R1-1 message 稳定面 | ✅ | §2a/2b/2c：双路径 message 无 sentinel、单行、只含 code/phase/committed+固定处置 |
| AC-R1-2 cause 唯一保留 | ✅ | §2a/2b：`wr.cause === rawErr` 同一引用（Error/TypeError/thrown string 三载体） |
| AC-R1-3 status.fatal 稳定摘要 | ✅ | §2a/2b/3：键集恰 `{code,message}`，无 stack/cause，无泄漏 |
| AC-R1-4 双路径回归锚 | ✅ | §1：rev1 3 用例真实触发全绿（独立进程复跑） |
| AC-R2-1 术语统一 | ✅ | §2/§3：全部可观测 message 无「永久关闭」/closing/closed，含 禁用/读取/保留 |
| AC-R2-2 验证门禁 | ✅（本地腿） | §1 定向 50/50 exit 0；全量/双通道 typecheck 以总控亲跑为准；Node 20/24 CI 腿移交 runner/ciwatch |
| AC-R2-3 元数据纯净 | ✅ | §4.5：staged 集纯业务面；commit 纪律提醒回流 |

## 最终 verdict

**pass** —— P1/P2 在真实运行链路上全部成立；SA4 五项动态审核重点逐项闭环（2 条非阻断边界观察：L-2 退化值 cause 省略的如实刻画、S2-throw-undefined 与 S4 公共面不可区分——均为既有写法的退化边界，处置面一致，无行为分叉需求，不建议本轮改动）。

产物：本报告（wiki/raw/）。探针：`/tmp/sa7-r1/probe.mts` + runA/runB 日志（一次性，不入库；工作区零污染经 git status 前后对照确认）。
