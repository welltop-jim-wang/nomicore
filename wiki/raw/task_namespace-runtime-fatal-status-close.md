# 任务简报 — namespace-runtime：fatal、capability status 与 close 生命周期（issue #92）

## 元数据

- run_id: issue-92-1787617961-3408414
- round: 1（初始轮）
- branch: fix/issue-92-on-docs-namespace-runtime
- worktree: /home/wangjian/nomicore-fix-issue-92
- 任务类型: **功能开发**（新增 close 生命周期能力 + getStatus 结构化演进 + fatal 语义补齐验收）
- Parent: PR #85（docs/namespace-runtime）；前置 #90（write sequencer + validated ROOT write）、#91（原子 SCHEMA replacement）均已 CLOSED 并合入当前分支（HEAD = 588fa2b）

## 需求原文（issue #92）

完成 Runtime 的 fatal、结构化 capability status 与 close 生命周期，使 post-commit 异常不被误报为普通失败，fatal 后仍可读取，而 close 能停止接纳并安全排空全部已接纳写。

### Acceptance Criteria（逐条验收，编号 AC1–AC9）

- AC1: 所有 internal fatal 永久关闭两类写但保留 read，稳定摘要不暴露原始 Error/stack/SCHEMA 全文/ROOT 数据
- AC2: committed fatal 在当前槽中 best-effort dirty notification，始终 reject 原始 RuntimeWriteFatalError 且明确 committed
- AC3: committed:false 不通知 dirty；未知异常保守按可能 committed 处理
- AC4: fatal 后已排队任务按 FIFO 取得槽，不访问输入并返回零写入 RUNTIME_WRITE_DISABLED
- AC5: getStatus 结构化表达 lifecycle/read/rootWrite/schemaWrite 与 schema/fatal/close 摘要，不暴露队列长度或任务类型
- AC6: close 首次调用同步进入 closing 并立即停止新 read/write，close 前已接纳任务无条件排空
- AC7: close barrier 只 release 一次；release 失败时 close reject 但 Runtime 仍 closed，后续 close 返回同一 Promise
- AC8: v1 不提供公共事件订阅，队列进度只走内部 observability
- AC9: 确定性测试覆盖 fatal、dirty notification、排队结算、幂等 close 和 release failure，并通过全量 typecheck/test、Node 20/24 CI

## 权威依据

- **ADR-0008** `docs/adr/0008-namespace-runtime-read-write-capabilities-and-sequencer.md`：
  - §Fatal 与失败通道：「任何 internal fatal——无论 committed 与否——都永久关闭该 Runtime 的全部写能力并保留读取」「committed:false 不调用 dirty notifier」「committed:true 或未知异常保守视为可能已提交，在当前槽内 best-effort notifyDirty()，但始终 reject 原始 fatal」「不补偿、不 fallback、不声称 rollback」「post-commit fatal 以带 committed:true 的稳定 RuntimeWriteFatalError reject」「已排队的后续写仍按 FIFO 取得槽，且不访问输入、零写入返回 RUNTIME_WRITE_DISABLED」
  - §生命周期、状态与所有权：「close() 幂等。首次调用同步进入 closing，立即停止接纳公共 read 和 write，并在队尾加入 close barrier；此前已接纳任务无条件排空，不取消、不设内部 timeout。barrier 只调用一次 handle.release()；无论 release 成败，Runtime 都进入 closed，失败时 close Promise reject，后续 close 返回同一个已结算 Promise」「Runtime 提供结构化瞬时 capability status……lifecycle、read、ROOT write、SCHEMA write，以及稳定且不含原始 Error/stack/SCHEMA 全文/ROOT 数据的 schema、fatal、close issue 摘要。status 不暴露队列长度、任务类型或 sequence。v1 不提供公共事件订阅；队列进度和内部事件属于日志、metrics 与 trace」
- CONTEXT.md 相关条目（以 SA8 relevant_decisions 为准）

## 现状侦察（总控已核实，HEAD 588fa2b）

**#90/#91 已交付（本任务只补齐/演进，不推倒）：**
- fatal 通道主体已在 `write.ts`/`schema-write.ts`：`RuntimeWriteFatalError{committed,phase,cause}`、`markWriteFatal`（永久禁用两类写 + 稳定 {code,message} 摘要）、`rejectWithWriteFatal`（committed:true → 槽内 best-effort notifyDirty 恰一次；committed:false → 0 次；未知异常保守 committed:true + phase='unknown-pipeline-throw'）、S1 fatal gate（fatal 后写槽零输入访问返回 RUNTIME_WRITE_DISABLED）
- `status.ts`：六键 `{lifecycle,read,rootWrite,schemaWrite,schema,fatal}`，但 `lifecycle` 恒 `'ready'`、`read.enabled` 恒 `true`、**无 close 摘要键**（文件头注释自标「close 属后续 issue」）
- `sequencer.ts`：promise-chain FIFO，扩展位注释已预留「close barrier = enqueue(release 槽)」
- `runtime.ts`：九键公共面（owner/namespaceId/read/getSchemaEnvelope/getMetadata/getActiveSchema/getStatus/mutateRoot/replaceSchema）；**无 close 键**；`RuntimeState`（p0.ts）无 lifecycle 字段
- 既有 fatal 测试锚：`runtime-mutate-root-sequencer.test.ts`（AC9 committed:true fatal + best-effort notifier + FIFO 继续）、`runtime-write-fatal-message-rev1.test.ts`（message 无泄漏 + 措辞纪律）等

**本任务增量（缺口）：**
1. **close 生命周期**：`close()` 公共方法（第 10 键）；lifecycle 状态机 ready→closing→closed；closing 起立即停止接纳新 read/write（read 同步拒、写入队拒——结算形状由 SA1 设计）；close barrier 入队尾、此前已接纳任务无条件排空、无 timeout；barrier 只调一次 `handle.release()`；release 失败 → close Promise reject 但 Runtime 仍 closed；后续 close 返回**同一个已结算 Promise**
2. **getStatus 演进**：lifecycle 取 `'ready'|'closing'|'closed'`（closing/closed 期 read.enabled=false、两类写 enabled=false）；新增 `close` 摘要键（稳定 {code,message} 或 null，不含原始 Error/stack）；保持不暴露队列长度/任务类型/sequence
3. **fatal×close 交叉**：fatal 后 close 照常工作（read 在 fatal 后保留、close 后才停）；close 排空期内 fatal 写槽照常 fatal 语义
4. **AC8 负向锚**：公共面无事件订阅键（on/off/subscribe 等），测试锁定
5. **确定性测试**：fatal 全分类、dirty notification 计数、排队结算（fatal 后 FIFO 零输入访问）、幂等 close（并发/重复调用同 Promise）、release failure（reject + 仍 closed + 同 Promise）

## 既有锚的演进注意（不得盲改）

- `runtime-public-surface-ownership.test.ts` 当前锁定九键面 + status 六键 + `lifecycle:'ready'`——#92 合法演进为十键 + 七键 status + lifecycle 三态，该测试需随之更新（这是本任务的预期变更，非回归）
- `runtime-write-fatal-message-rev1.test.ts` 的 `expectNoClosingWording` 约束 **fatal 文案**不得含 closing/closed 措辞（#90 R2 立法：fatal=「永久禁用写能力，读取仍保留」与 close 生命周期术语分域）——#92 引入 closing/closed 后该约束**仍然有效**（fatal message 措辞不变；lifecycle 状态值/'closed' 出现在 status.lifecycle 等新面，与 fatal message 分域不冲突），设计须显式维持此术语边界
- `DocHandle.release()` 契约见 `packages/persistence/src/contract.ts:29`（幂等；`getStatus()` 在 released 后返回 'released'）

## 红灯锚定要求（SA6）

新能力红灯（当前代码下必须真实红）：
- `runtime.close` 存在且为 function（当前九键面无此键 → 红）
- close 幂等：并发/顺序重复调用返回**同一 Promise 实例**
- close 同步进入 closing：`close()` 调用返回前 `getStatus().lifecycle === 'closing'`；此后 `read()` 立即拒（非 ok 结果或明确结算形状——由 SA1 定契约后 SA6 锚）、`mutateRoot`/`replaceSchema` 新调用立即拒且**不入队**（排空后零副作用）
- 排空：close 前已接纳的挂起写（p0Gate/notifyDirty 门控制造在槽任务）无条件执行完毕，barrier 最后执行；`handle.release()` 恰一次且发生在全部已接纳任务 settle 之后
- release failure：注入 `release()` reject → close Promise reject（reason 稳定）、`getStatus().lifecycle === 'closed'`、后续 close 返回同一（已 reject 的）Promise
- getStatus 七键形状：`close` 摘要键存在（null 正常路径；release failure 后稳定 {code,message} 不含原始 stack）；closing/closed 期 read/rootWrite/schemaWrite 全 false
- fatal×close：fatal 置位后 close 照常排空+release；fatal 摘要不受 close 影响
- AC8 负向：公共面键集恰十键（无 on/off/subscribe/emit 等事件键）
- fatal 回归（#90 既有锚不得退化）：committed:false 零 notifier、committed:true 恰一次、未知异常保守 committed:true、排队任务零输入访问 RUNTIME_WRITE_DISABLED

## 门禁基线

- 全量 `pnpm test`（vitest run --typecheck）与 `pnpm typecheck`（七包 tsc）+ `tsc -p tsconfig.typecheck.json --noEmit` 必须全绿；上一任务基线 84 files / 1078 tests（#91 rev1 合入后），本任务收尾前重测记录真实基线
- 版本 bump（HG #9）：`@nomicore/namespace-runtime` 0.1.4 → 0.1.5（若 SA3 触碰 doc-runtime/persistence 源码则同步 bump 对应包）

---

## SA6 红灯测试设计与验证记录（Phase 1，2026-08-25）

### 产出文件

- `packages/namespace-runtime/test/runtime-close-lifecycle.test.ts`（运行时行为锚，8 用例）
- `packages/namespace-runtime/test/runtime-close-lifecycle-type-guard.test-d.ts`（类型面锚，3 用例）

### 覆盖矩阵（AC 映射）

| # | 用例 | AC | 断言要点 |
|---|------|----|----------|
| 1 | 公共面第十键 close 为 function；键集恰十键；无事件订阅键 | AC6/AC8 | `typeof close==='function'`；`Object.keys(runtime)` 恰十键；on/off/subscribe/unsubscribe/emit/addEventListener/removeEventListener/once 全缺席 |
| 2 | close 同步进入 closing；并发重复调用同实例；read 立即同步拒 | AC6/AC7 | close() 返回前 `lifecycle==='closing'`；返回 Promise；`close()===close()`（并发）；read 返回同步结果联合 `ok:false`（非 Promise、不抛）；closing 期能力位全 false |
| 3 | 排空：已接纳写无条件执行；barrier 最后；release 恰一次；新写不入队立即 ok:false 零写入 | AC6/AC7 | notifyDirty 门挂在 S6 的写：close 后 release 仍 0 次；新 mutateRoot/replaceSchema 在 A 结算前即 settle `ok:false`（不入队）；stateBytes 零变化；A 放行后 ok:true、n=42；release==1；closed；close 摘要 null；已结算后 close 仍同一 Promise |
| 4 | close 时 P0 尚在准备 | AC6 | P0 属已接纳任务：闭前 preparing、close 后 read 立拒（不等待 P0）、release 0 次；放行 P0 → ready → release 1 → closed |
| 5 | release 失败 | AC7 | close reject；仍 closed；release==1；read/写停；status.close `{code,message}` 稳定、不泄漏原始 Error（哨兵文本/stack 缺席）；后续 close 同一 Promise、同一 rejection 原因；摘要跨调用稳定 |
| 6 | fatal×close | AC1/AC6 | P0 fatal 后 read 保留（ok:true、read.enabled true）、两写 false；close 照常：release 1、closed、read 转 false；fatal 摘要 code/message 原样（不受 close 影响）；close 摘要 null |
| 7 | 排空期内写槽 fatal | AC2/AC6/AC7 | observer 逃逸 committed:true：reject 稳定 RuntimeWriteFatalError（committed:true、phase string）、notifier 恰一次、提交值保留（不虚假回滚）；close 仍完成：release 1、closed |
| 8 | getStatus 七键形状 | AC5 | 键集恰七键（含 close）；ready 期 read/rootWrite/schemaWrite true、close null；closed 期三能力位 false；无 queue/sequence/taskType、无数组值字段 |
| 9 | 类型面（-d） | AC5/AC6 | `NamespaceRuntime.close` 成员（TS2339）；`getStatus().close` 键（TS2339）；lifecycle 三态联合（expectTypeOf） |

### 契约冻结边界（SA1 设计面显式让渡，避免预锁实现）

以下字面量 ADR/简报未冻结，本锚**不**锁定其取值（SA1 设计定稿后由 SA2/SA8 复审，若设计偏离本锚的 ADR 级断言则属冲突）：

- closing/closed 期 **read 拒绝的具体 code 字面量**（本锚只锁「同步结果联合、ok:false、非抛、非 Promise」——ADR-0008 读取能力节）；
- closing/closed 期 **write 拒绝的具体码**（本锚只锁「领域化结果联合 settle ok:false、零写入、不入队」——ADR-0008 失败通道节；`RUNTIME_WRITE_DISABLED` 归 SA1 决策）；
- **close 摘要的 code 字面量**（本锚只锁 `{code,message}` 形状、空串排除、跨调用稳定、无原始 Error/stack——ADR-0008 摘要纪律）；
- close rejection 的 reason 类名（本锚锁「reject 发生 + 后续 close 同 Promise 同 reason 身份」——AC7 原文）；
- `close()` resolve 值形状本锚锁 `Promise<void>`（完成信号；类型面）。

### 红灯验证证据（实际运行，2026-08-25 08:51–08:52）

- `pnpm exec vitest run packages/namespace-runtime/test/runtime-close-lifecycle.test.ts` → **exit 1：8 failed / 8，Type Errors: no errors**。全部失败均集中在两处契约缺口：`expected 'undefined' to be 'function'`（`runtime.close` 不存在——九键公共面无第十键）与 status 键集 diff（无 `close` 键，actual 六键 vs expected 七键）。无任何 timeout/挂死/意外通过；失败的 8 用例各自在 close 存在性断言或七键形状断言处红，行为断言（排空/幂等/release 计数）因前置红未继续执行（SA3 修绿后接管）。
- `pnpm exec vitest run --typecheck packages/namespace-runtime/test/runtime-close-lifecycle-type-guard.test-d.ts` → **exit 1：3 failed / 3**：TS2339 `Property 'close' does not exist on type 'NamespaceRuntime'` ×2（别名行 + expectTypeOf 行）、TS2339 `Property 'close' does not exist on type 'NamespaceRuntimeStatus'`、TS2344 lifecycle `'ready'` 不满足 `'ready'|'closing'|'closed'` 三态联合。
- `pnpm exec tsc -p tsconfig.typecheck.json --noEmit` → **exit 2**，且全仓仅 4 条错误、全部位于 `runtime-close-lifecycle-type-guard.test-d.ts`（以上 4 条预期红）；`runtime-close-lifecycle.test.ts` 类型洁净（零错误）——行为锚文件不因类型缺失污染 tsc 门禁，红/绿翻转只承载在既有锚上与类型面锚文件上。

**SA2 R-1（MEDIUM）修订轮补锚（2026-08-25 09:31）**：设计 D7 裁决「getSchemaEnvelope/getMetadata/getActiveSchema/getStatus 四 getter post-close 继续可用」——在 case 2（close 主路径：同步 closing → closed）增补断言：闭前捕获三 getter 基线，close 完成后断言三 getter 均 `not.toThrow()`、`getSchemaEnvelope()` 非 null 且四键原值（lang/version/id/text）、`getMetadata()` 与闭前 `toEqual`、`getActiveSchema()` 非 null 且与闭前 `toEqual`（getStatus 由 case 8 七键形状锁定，未重复锚）。重跑 `pnpm exec vitest run packages/namespace-runtime/test/runtime-close-lifecycle.test.ts` → **exit 1：8 failed / 8，Type Errors: no errors**（实现未落地，仍为构造性红灯；新增断言行位于 close 存在性守卫之后，SA3 修绿后执行并验收 D7）。`runtime-public-surface-ownership.test.ts`（R-5 冻结锚）**未改动**。
