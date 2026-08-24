# 任务简报（修订轮 R1）— namespace-runtime write sequencer：fatal message 稳定面 + fatal/close 术语边界（issue #90 / PR #100）

- run_id: issue-90-1787537615-442625
- branch: fix/issue-90-on-docs-namespace-runtime（PR #100 head）
- 触发: runner 转达 owner 对 PR #100 的合并前 Review 修订要求（发布后修订轮）
- 前序档案: `task_namespace-runtime-write-sequencer*.md`（初轮 feature 流水线全部 pass）

## 任务类型自判与流程裁剪（总控）

- 类型自判：**bugfix 类修订**（P1 = 公共 rejection message 泄漏原始异常文本的真实缺陷；P2 = 诊断术语缺陷）。
- 裁剪依据（沿 `task_doc-runtime-transaction-fatal_rev1` 先例）：owner 修订要求已给出精确方案（=设计定稿），裁剪 SA5/SA1/SA2/SA8；P1/P2 与 ADR-0008 语义不冲突（仅措辞与公共 message 稳定面收缩，能力语义不变），且 ADR 为冻结决策记录不在本轮修改范围。
- 工作流：SA6 红灯锚定 → SA3 实现 → 总控亲跑验收 → SA4 静态验尸 → SA7 动态验证 → AC 门禁 → SA3 commit + push（修订轮允许 push；严禁提交 `.mabf/**`、`.mabf-bg/**`、`REPORT.md`、`.mabf-done`）。

## owner 反馈全文（PR #100 Review，合并前修订要求）

Review 结论：核心 FIFO/write slot/snapshot/notifier/fatal 分类实现与测试质量良好，但合并前需要修正以下问题。

### P1：`RuntimeWriteFatalError.message` 不得拼接原始异常文本

当前 `packages/namespace-runtime/src/write.ts` 的 `writeFatalMessage(...)` 会把 `detail` 插入公共 rejection message：

```ts
`原始异常证据引用：「${detail}」`
```

`detail` 来自 adapter、observer、notifier 或 mutation pipeline 的任意异常文本，可能包含 ROOT 数据、SCHEMA 文本、用户输入、持久化路径或内部实现信息。该 message 因此不稳定，也可能泄漏敏感运行时内容。

修订要求：

1. `RuntimeWriteFatalError.message` 只包含稳定的 code/phase/committed 与固定处置说明；不得包含原始异常 message、stack、SCHEMA、ROOT 或 mutation 输入内容。
2. 原始异常实例仅通过标准 `cause` 保留，保持零信息损失供包内诊断，不把其文本复制到公共稳定 message。
3. `status.fatal` 继续保持稳定 `{code,message}` 摘要，不暴露 `cause`、stack 或原始文本。
4. 增加回归测试，至少覆盖：
   - rejection 为 `RuntimeWriteFatalError`；
   - `cause` 严格等于原始异常实例；
   - `message` 不包含原始异常 sentinel；
   - notifier failure 与 unknown pipeline throw 两条路径均满足上述纪律；
   - message 不包含构造的 ROOT/SCHEMA/input sentinel。

### P2：fatal 与 close lifecycle 的术语边界

当前诊断/注释使用"永久关闭所有写"等措辞，容易与 ADR 0008 的 `close()` lifecycle 混淆。fatal 并未关闭 Runtime；它是永久禁用写能力并保留读取。

请统一改为类似：

> internal fatal 已永久禁用本 Runtime 的全部写能力，读取仍保留。

避免使用暗示 Runtime 已进入 `closing/closed` 生命周期的表达。

### 验证门禁

修订后应重新通过：

- `pnpm typecheck`
- `pnpm test`
- `tsc -p tsconfig.typecheck.json --noEmit`
- Node 20/24 CI

Review 记录：本轮除上述 P1/P2 外，FIFO 接纳顺序、gate 前零输入访问、槽起点 snapshot、执行时 active schema、单事务写入口、同槽 dirty notifier、degraded 语义和 fatal committed 分类均未发现阻断缺陷。

## 总控摸底（现状定位，供 SA 参考）

P1 现状（`packages/namespace-runtime/src/write.ts`）：

- `writeFatalMessage(phase, committed, detail)`（~L210-214）模板尾段 `原始异常证据引用：「${detail}」` 把 detail 插值进公共 message。
- detail 来源三处：S5 `DocRuntimeFatalError` 透传 `err.message`（~L134）；S5 未知异常 `errDetailOf(err)`（~L136，`unknown-pipeline-throw`）；S6 `notify-dirty-failed` 路径 `errDetailOf(err)`（~L151）。另有 S2/S4 `write-slot-internal` 路径传的是槽内固定文案（非原始异常文本），改模板后自然合规。
- `RuntimeWriteFatalError`（errors.ts ~L102）已支持 `options?: ErrorOptions`（cause 通道已在）；两条 throw 点均已传 `{ cause: err }`——P1 主要是**把 detail 从 message 模板中剔除**并验证 cause 严格相等。
- `status.fatal` 摘要（`markWriteFatal`，write.ts ~L172-178）已用稳定常量 `FATAL_WRITE_INTERNAL_CODE/MESSAGE`，不暴露 cause——P1 第 3 条主要是**回归锚定**（防退化）。

P2 术语面（措辞「永久关闭…写」出现处；统一改为「internal fatal 已永久禁用本 Runtime 的全部写能力，读取仍保留」同义表达，避免 closing/closed 暗示）：

- `src/errors.ts` L20 `FATAL_P0_INTERNAL_MESSAGE`、L27 `FATAL_WRITE_INTERNAL_MESSAGE`（稳定常量文案；测试若引用常量本身则同步绿，若硬编码旧文案需同步更新）
- `src/write.ts` L71 disabled 文案、L82/L171/L228 注释、L212 writeFatalMessage 模板段
- `test/runtime-p0-sequencer.test.ts`、`test/runtime-mutate-root-sequencer.test.ts`、`test/runtime-mutate-root-sa7-dynamic.test.ts` 内多处注释/断言文案
- **不动** `docs/adr/0008-*.md`（ADR 是冻结决策记录；其「永久关闭…写」表述为历史决策原文，本轮仅统一代码诊断/注释/测试措辞）

## Acceptance Criteria（修订轮 R1，源自 owner 要求逐条映射）

- AC-R1-1: `RuntimeWriteFatalError.message` 只含稳定 code/phase/committed 与固定处置说明；不含原始异常 message/stack、SCHEMA/ROOT/mutation 输入内容。
- AC-R1-2: 原始异常实例仅经标准 `cause` 保留（严格相等，零信息损失）；文本不复制进公共稳定 message。
- AC-R1-3: `status.fatal` 仍为稳定 `{code,message}` 摘要，不暴露 cause/stack/原始文本。
- AC-R1-4: 回归测试覆盖：rejection 为 `RuntimeWriteFatalError`；`cause` 严格等于原始异常实例；`message` 不含原始异常 sentinel；**notifier failure 与 unknown pipeline throw 两条路径**均满足；message 不含构造的 ROOT/SCHEMA/input sentinel。
- AC-R2-1: 诊断/注释/测试措辞统一为「永久禁用…写能力，读取仍保留」类表达；不出现暗示 closing/closed 生命周期的「永久关闭」类措辞（src + test；ADR 不动）。
- AC-R2-2: 验证门禁全绿：`pnpm typecheck`、`pnpm test`、`tsc -p tsconfig.typecheck.json --noEmit`（Node 20/24 CI 腿移交 runner/ciwatch）。
- AC-R2-3: 版本 bump（namespace-runtime patch）+ wiki 档案随 commit 入库；commit + push 更新 PR #100；严禁提交 `.mabf/**`、`.mabf-bg/**`、`REPORT.md`、`.mabf-done`。

---

## SA6 红灯锚定记录（R1，AC-R1-4 / AC-R2-1）

### 测试文件（新增，仅测试面）

- `packages/namespace-runtime/test/runtime-write-fatal-message-rev1.test.ts`（3 用例，全部红）

### 用例 → AC 映射

1. **AC-R1-4 notifier-failure 路径**（`notify-dirty-failed`）：seam 注入 `notifyDirty` 抛错（S6 同槽 await，写已提交→登记通道损坏）。断言：rejection 为 `RuntimeWriteFatalError`（instanceof 公共导出类）；`phase='notify-dirty-failed'`、`committed=true`；`cause` **严格等于**原始异常实例（同一引用）；`message` 不含原始异常 sentinel 与构造的 ROOT/SCHEMA/input 三重 sentinel（`RAW_LEAK_MESSAGE`/`ROOT_SENTINEL`/`SCHEMA_SENTINEL`/`INPUT_SENTINEL`）与「原始异常证据引用」模板段；message 只含稳定 `NSRT-WRITE-FATAL`+`phase=`+`committed=`+固定处置说明（`不补偿`）；notifier 恰一次；`status.fatal` = `{code:'NSRT-FATAL-WRITE-INTERNAL', message}` 无 stack/cause 且无泄漏；写禁用+读取保留；**不虚假回滚**（已提交值 n=2 保留）。
2. **AC-R1-4 unknown-pipeline-throw 路径**：`applyValidatedMutation` 在 ⓪ 事务语境 guard（doc-runtime `assertOutermostTransactionContext` 第一访问点读 `doc._transaction`/`doc._transactionCleanups`）逃逸**非 branded** 异常——经 Y.Doc 语义面 Proxy 注入自造实例（与真实 E202 逃逸同一位置；真实 E202 实例由 doc-runtime 内部 `new Error` 创建、测试侧无法持有，故用注入实例满足 cause 严格相等断言；槽体视角等价）。断言同上（phase='unknown-pipeline-throw'、committed=true 保守）；⓪ 在任何 doc 触碰前拒绝 → 零写入事实（read 仍 n=1）。
3. **AC-R2-1 术语纪律可执行面**：P0 internal fault（seam compile 抛错）→ `status.fatal` 摘要（`NSRT-FATAL-P0-INTERNAL` 稳定码，`FATAL_P0_INTERNAL_MESSAGE`）与 fatal 后 S1 gate `RUNTIME_WRITE_DISABLED` issue 措辞均断言：**不含「永久关闭」/closing/closed**、含「禁用/读取/保留」（正向锚沿 owner 示例措辞，属可放宽面；硬禁为「永久关闭」缺席）。

### 红灯证据（当前实现：write.ts `writeFatalMessage` 把 detail 插值进公共 message；P2 措辞未改）

运行（独立 vitest 进程；先 `fuser -k` 释放端口）：

```bash
fuser -k 8000/tcp 8081/tcp 3005/tcp 2>/dev/null; sleep 1
pnpm exec vitest run packages/namespace-runtime/test --no-typecheck
```

结果（仅新文件红；其余 9 文件 47 用例全绿——隔离性确认）：

```
Test Files  1 failed | 9 passed (10)
Tests       3 failed | 47 passed (50)
```

关键失败断言（真实失败证据）：

```
1) notifier-failure：expected 'NSRT-WRITE-FATAL: ROOT write internal…' not to contain
   'NSRT-LEAK-PATH-SENTINEL-9f2c7d | ROOT_CONTENT_SENTINEL-…| SCHEMA_TEXT_SENTINEL-…| MUTATION_INPUT_SENTINEL-…'
   Received: "…phase=notify-dirty-failed, committed=true）；本 Runtime 全部写已永久关闭，读取保留；…原始异常证据引用：「[notify-dirty-failed] 原始异常：NSRT-LEAK-…」"
2) unknown-pipeline-throw：同上（message 含「原始异常证据引用：「[unknown-pipeline-throw] 原始异常：NSRT-LEAK-…」」）
3) P2：expected 'P0 schema preparation internal fault：…' not to contain '永久关闭'
   Received: "P0 schema preparation internal fault：编译通道产生结果联合之外的异常；本 Runtime 全部写已永久关闭，读取保留。"
```

（通过锚点：前两条用例在泄漏断言之前已通过 rejection instanceof / phase / committed / `cause === rawErr` 严格相等 / 稳定 message 形状——说明 cause 通道与 rejection 形状现已合规，红点恰为 detail 泄漏面；P2 用例红点恰为「永久关闭」措辞面。）

类型检查（新文件须类型干净——AC-R2-2 前置）：`tsc -p tsconfig.typecheck.json --noEmit` exit=0。

### 其他说明

- 无端口/新增测试包依赖；本仓库无 `scripts/test-lock.sh`，无需维护。
- 未改任何 `src/**`；ADR 未动。
