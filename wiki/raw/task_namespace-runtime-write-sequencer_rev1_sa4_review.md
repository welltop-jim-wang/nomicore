# SA4 静态验尸报告（修订轮 R1）— namespace-runtime fatal message 稳定面 + fatal/close 术语边界

**Date**: 2026-08-24
**Worktree**: /home/wangjian/nomicore-fix-issue-90（branch `fix/issue-90-on-docs-namespace-runtime`，对照 HEAD `bfcb999`）
**Verdict**: **pass**（附 5 项 Low 级观察项，无 C/H/M 阻断项）

## 审查范围

- 任务简报：`wiki/raw/task_namespace-runtime-write-sequencer_rev1.md`（AC-R1-1..R1-4 / AC-R2-1..R2-3）
- 本轮 diff（`git diff HEAD --name-only`，11 文件）：
  - `packages/namespace-runtime/package.json`（0.1.1→0.1.2 patch bump）
  - `packages/namespace-runtime/src/errors.ts`、`src/write.ts`
  - `packages/namespace-runtime/test/`：rev1 新增 1 + 同步 3
  - `wiki/raw/` 档案 2 件（whitelist 豁免）；`.mabf-done`/`REPORT.md`/`.mabf/` 为 MABF runtime 工作区残留（见 §5/问题 L-5）
- 独立复跑验证：`pnpm exec vitest run packages/namespace-runtime/test --no-typecheck`（独立进程）→ **exit 0，10 文件 50/50 全绿**（含 rev1 3 用例），与总控亲跑证据一致。

## 逐重点结论与证据

### 重点 1：P1 剔除彻底性 —— ✅ 合规

**1a. `writeFatalMessage` 全部调用点无原始异常文本残留。**

模板本体（`src/write.ts:206-211`）只插值两个事实值：

- `phase`：`RuntimeWriteFatalPhase` 冻结闭集（doc-runtime 三相位字面量 + Runtime 侧三相位，`src/errors.ts:85-89`）。全部构造点核验为字面量（doc-runtime `fatal.ts:68`、`mutation.ts:173`、`materialize.ts:149`、`replace.ts:145`、`install-verify.ts:48/61/73/83`）——无运行时外来文本进入。
- `committed`：boolean 经 `String()`。

模板尾段 `原始异常证据引用：「${detail}」` 已删除；repo 全量 grep 该串仅剩 rev1 测试的负向断言与注释引述（`test/runtime-write-fatal-message-rev1.test.ts:17/129`）。

**1b. 五个 fatal 构造点逐一核验（`src/write.ts`）：**

| 路径 | 行号 | message 来源 | cause |
|---|---|---|---|
| S2 getStatus 抛错 | 83-85 | `writeFatalMessage(phase, committed)` | `err` |
| S4 不变量破坏 | 119-121 | 同上 | `undefined`（无异常存在，合理） |
| S5 branded 透传 | 132 | 同上（**`err.message` 不再复制**——旧代码 detail=`err.message`，本轮剔除） | `err`（DocRuntimeFatalError 实例本体） |
| S5 未知异常 | 134 | 同上 | `err`（保守 committed:true） |
| S6 notifier 失败 | 146-151 | `writeFatalMessage('notify-dirty-failed', true)` | `err` |

`rejectWithWriteFatal`（184-204）签名已去 detail；S6 直 throw 点同样只传稳定 message + cause。

**1c. `RuntimeWriteFatalError` 类自身不拼接 cause 文本**（`src/errors.ts:102-111`）：constructor 仅 `super(message, options)`，`committed`/`phase` 为独立只读事实字段。✅

**1d. `markWriteFatal` 的 status.fatal 零插值**（`src/write.ts:170-176`）：恒 `Object.freeze({code: FATAL_WRITE_INTERNAL_CODE, message: FATAL_WRITE_INTERNAL_MESSAGE})`，两个常量均为恒定文案（`src/errors.ts:23-27`）。`fatalCause` 存入闭包私有 `RuntimeState`（`src/p0.ts:46`），公共面核验零暴露：`buildStatus`（`src/status.ts:38-54`）只读 `state.fatal`；八键公共面对象（`src/runtime.ts:121-134`）不含该字段。既有测试亦锚定 `status.fatal` 无 `cause`/`stack` 键（`runtime-mutate-root-sequencer.test.ts:731`、`runtime-p0-sequencer.test.ts:227-228`）。

**1e. `disabled()` reason 与类 B issue：**
- disabled 三处 reason（write.ts:71/88-90/93-96）均为固定文案；唯一插值 `handleStatus`（write.ts:89）来自 adapter 契约词表（DocHandleStatus），非原始异常文本。
- `errDetailOf`（write.ts:214-216）唯一存活调用点是 `snapshotMutation` 类 B issue（write.ts:234：`MUTATION_INPUT_NOT_PLAIN_DATA_CODE: ${errDetailOf(err)}`）。**判定：合规**——该通道是 ok:false 领域失败（初轮定稿的 E205 哲学：输入缺陷描述回给同一调用方，非跨边界泄漏），不在 P1「RuntimeWriteFatalError.message」射程内；owner Review 明示本轮除 P1/P2 外无阻断缺陷。注记为 L-1。

### 重点 2：cause 通道正确性 —— ✅ 合规

- **类型面**：`ErrorOptions` 经 `RuntimeWriteFatalError` constructor `options?` 参数（errors.ts:106）；仓根 `tsconfig.base.json` `target/lib = ES2022` → `super(message, options)` 类型可用；`pnpm typecheck` 七包 + `tsc -p tsconfig.typecheck.json` 双绿（总控证据）。
- **branded 透传**（S5）：`cause = err`（DocRuntimeFatalError 实例严格相等）；其内部 cause 链（`{cause: 原值}`）自然保留——零信息损失经两层链达成，文本不复制。
- **unknown-pipeline-throw**：保守 committed:true + cause 严格等于注入实例，rev1 测试断言 `wr.cause === rawErr`（rev1 test:232）绿。
- **S4 cause=undefined**：结构不可达报警，无异常实例存在——语义正确（区别于「有异常但丢失」）。
- **`cause === undefined ? undefined : { cause }`**（write.ts:150/202）：语义为「无 cause 时不设 options」。边界注记见 L-2（`throw undefined` 退化情形）。
- **`markWriteFatal(env, cause)`**：fatalCause 现存真实异常实例——旧代码 `cause ?? detail` 会把字符串 detail 存进 fatalCause（类型混淆），本轮顺带修正，属改进。

### 重点 3：P2 术语残留 —— ✅ 合规（附 L-3 措辞残点）

**可观测 message 面（硬禁项）全净**：

- `FATAL_P0_INTERNAL_MESSAGE`（errors.ts:19-20）、`FATAL_WRITE_INTERNAL_MESSAGE`（errors.ts:26-27）、`writeFatalMessage` 模板（write.ts:208-210）、S1 gate disabled 文案（write.ts:71）——全部为「internal fatal 已永久禁用…写能力，读取仍保留」同义表达，grep 无「永久关闭」/closing/closed。
- rev1 测试 L134-136 对可观测 message 断言 `not.toContain('永久关闭'/'closing'/'closed')` 全绿。

**src + test 全量 grep 残点**（均为注释/测试标题，非可观测 message，无 lifecycle 混淆，硬禁项不触发）：

- `src/errors.ts:93`「不关写能力」（类 docblock，指本类不执行 Runtime 层动作）
- `test/runtime-mutate-root-sa7-dynamic.test.ts:190`「未被静默关闭」（注释）、`:308`「写能力不关闭」（it 标题）
- `test/runtime-p0-sequencer.test.ts:241`「关闭是永久态：后续采样仍关闭」（注释，描述写位持续为 false）
- `test/runtime-p0-sequencer.test.ts:13`：引 ADR 原文「永久关闭」并显式注明「本轮统一为永久禁用…读取保留语义」——简报明示的合法说明性引述。✅

### 重点 4：回归风险 —— ✅ 无回归

- `rejectWithWriteFatal`/`writeFatalMessage` 均为模块私有函数（未导出）；repo 全量 grep 无包外引用——签名变更影响面封闭于 write.ts 单文件，5 个调用点全部同步。
- `RuntimeWriteFatalError` 公共 constructor 签名未变（仅 message 文本变化）；repo-wide grep 无 apps/packages 外部消费面（doc-runtime 侧唯一引用是断言该名**不**被导出的分层红线测试 `transaction-fatal-materialize-contract.test.ts:266-269`，不受影响）。
- sa7-dynamic 旧断言 L270-276 已同步为新稳定形状（`toContain('NSRT-WRITE-FATAL'/'phase=write-slot-internal'/'committed=false')` + `not.toContain('adapter-boom')` + `not.toContain('getStatus() 抛错')`）——覆盖「槽内固定上下文文案也已剔除」这一补漏点（dispatch #22）。
- 既有行为锚完好：FIFO（sequencer 12 用例）、零输入访问（Proxy 计数）、notifier 恰一次计数（DV-1a/1b 挂住双窗口）、快照器四查、degraded 语义——独立复跑 50/50 绿。
- S2 与 S4 现共享 phase='write-slot-internal' 且 message 同文——区分度移至 cause 有无（S2 有异常实例、S4 无）。owner 规约（message 只含 code/phase/committed + 固定处置说明）本就要求如此，诊断信息经 cause 通道零损失。注记 L-4。

### 重点 5：工程合规 —— ✅ 合规（附 L-5 commit 纪律提醒）

- `package.json` diff 仅 version 一行（0.1.1→0.1.2）。✅
- `docs/` 零改动（ADR 冻结确认）。✅
- 无 lockfile / `.bak` / `TASK.md` / `.DS_Store`（技能 BLACKLIST 全过）。✅
- 文件面 = 简报声明改动面精确重合，无 scope creep（修订轮 SA1 裁剪、owner Review = 设计定稿；wiki/raw 属 whitelist）。
- **L-5（回流 SA3/总控，commit 时纪律）**：当前工作区存在 MABF runtime 残留——`.mabf-done` 删除（未 staged）、`REPORT.md` 修改（未 staged）、`.mabf/` 未跟踪。当前 staged 集干净（rev1 测试 + 2 件 wiki 档案），但收尾 commit **严禁 `git add -A` / `git commit -a`** 一并扫入；简报 AC-R2-3 明令禁止提交 `.mabf/**`、`.mabf-bg/**`、`REPORT.md`、`.mabf-done`。

### 技能门禁自检（sa4-exploit-vulnerability）

| 门禁 | 结果 |
|---|---|
| §1.1 Scope Creep Guard | ✅ 实际 diff ⊆ 声明面；BLACKLIST 零命中 |
| §1.3 E2E spec 触发性 | N/A（无 `.spec.ts`） |
| §1.4 vitest 触发性 | ✅ 根 `pnpm test` = `vitest run --typecheck`，include `packages/*/test/**/*.test.ts` → rev1 新文件被 CI `test` job（Node 20/24 matrix）覆盖（`.github/workflows/ci.yml:38-39` + `vitest.config.ts` include） |
| §1.5 协议假设 | N/A |
| §1.6 契约改动 ripple | ✅ 私有函数签名变更封闭于单文件；公共类形状未变；无外部 caller |
| §1.7 源码 grep 断言禁令 | ✅ rev1 测试纯行为断言（公共 seam 驱动 + settleOf + status 投影 + 计数），无 readFileSync/toMatch-on-source |
| §2 读写路径一致性 | N/A（本轮零数据通路变更） |
| §3 静默失败 | ✅ 控制流未变，S6 fatal 路径仍 loud rejection |
| §4 降级方案 | ✅ 无新增降级 |
| §5 极端条件 | 见 L-2（throw undefined）；无 C/H 级漏洞 |
| §6 错误处理链路 | ✅ 五 fatal 点全覆盖，无缺口 |
| §7 架构死胡同 | ✅ 无信号 |
| §8 过度设计 | ✅ 最小 diff（净 -19/+35 src 行） |

## 发现的问题分级

| # | 级别 | 位置 | 问题 | 处置 |
|---|---|---|---|---|
| L-1 | Low | write.ts:214-216/234 | `errDetailOf` 存活于类 B issue（MUTATION_INPUT_NOT_PLAIN_DATA 文案含 snapshotter 内部错误文本/键名/ctor 名）。属 ok:false 领域通道，超出 P1（fatal message）射程，初轮定稿 + owner Review 未列缺陷。仅注记，不改 | 接受现状；如后续 owner 扩大稳定面射程再议 |
| L-2 | Low | write.ts:150/202 | `cause === undefined ? undefined : {cause}`：管线 `throw undefined` 退化情形下 cause 被省略（fatalCause 亦 undefined），「零信息损失」对该退化值不成立。模式为两 throw 点既有写法，非本轮引入；rejection 形状（phase=unknown-pipeline-throw/committed:true）仍完整 | 交 SA7 动态面观察；如需硬化可改恒传 `{cause}` |
| L-3 | Low | errors.ts:93；sa7-dynamic:190/308；p0-sequencer:241 | 4 处注释/测试标题仍用「关闭/不关写」指称写位状态（非「永久关闭」硬禁词、无可观测面、无 lifecycle 混淆） | 建议后续轮顺手统一为「禁用」措辞；不阻断 |
| L-4 | Low | write.ts:83-85 vs 119-121 | S2/S4 共享 phase='write-slot-internal' 且 message 同文，区分仅靠 cause 有无——公共 message 可诊断度下降（owner 规约的必然代价，cause 通道补全） | 接受；SA7 动态验证时确认 cause 区分可观测 |
| L-5 | Low（commit 纪律） | 工作区 `.mabf-done`(D)/`REPORT.md`(M)/`.mabf/`(??) | MABF runtime 残留当前未 staged，但收尾 commit 若用 `-a`/`-A` 会违反 AC-R2-3 | **回流 SA3/总控**：commit 仅显式 add packages/** + wiki/raw/**，禁止扫入 runtime 元数据 |

## AC 对照

| AC | 结论 | 证据 |
|---|---|---|
| AC-R1-1 message 稳定面 | ✅ | write.ts:206-211 + 五调用点（§重点 1） |
| AC-R1-2 cause 唯一保留 | ✅ | write.ts:150/202；rev1 test:182/232 严格相等绿 |
| AC-R1-3 status.fatal 稳定摘要 | ✅ | write.ts:170-176 + errors.ts:23-27；fatalCause 零公共暴露 |
| AC-R1-4 双路径回归锚 | ✅ | rev1 test 用例 1（notify-dirty-failed）/2（unknown-pipeline-throw），独立复跑绿 |
| AC-R2-1 术语统一 | ✅（附 L-3） | 可观测面全净；残点均为注释/标题 |
| AC-R2-2 验证门禁 | ✅ | 总控 `pnpm test` 1053/1053 + 双通道 typecheck exit 0；SA4 独立复跑包级 50/50 exit 0 |
| AC-R2-3 版本 bump + commit 纪律 | ✅ bump 已落；commit 纪律见 L-5 提醒 | package.json 0.1.2 |

## 动态审核重点（交 SA7）

1. **Node 20/24 双腿 CI**：`ErrorOptions.cause` 行为一致性（rev1 严格相等断言在两 matrix 腿均应绿）；CI `test` job 日志摘录 vitest 触发证据（§1.4 联动）。
2. **rev1 用例 2 的注入点稳定性**：Proxy 拦截 `doc._transaction`/`doc._transactionCleanups` 依赖 yjs 内部字段名——yjs 升级可能使注入点漂移（届时测试会响亮变红，属安全方向失败），确认当前 lockfile 版本下两腿稳定。
3. **L-2 边界**：可选动态 characterize `throw undefined` 的 cause 通道表现（预期 rejection 形状完整、cause undefined）。
4. **L-4**：S2 vs S4 的 cause 有无在真实诊断流中可区分。
5. **commit 收尾**：确认 PR #100 最终 diff 不含 `.mabf/**`、`REPORT.md`、`.mabf-done`（L-5）。
