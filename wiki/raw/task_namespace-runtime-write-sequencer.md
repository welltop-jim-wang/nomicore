# 任务简报 — namespace-runtime：单 write sequencer 与 validated ROOT write

- Issue: #90 (welltop-jim-wang/nomicore)
- run_id: issue-90-1787537615-442625
- branch: fix/issue-90-on-docs-namespace-runtime
- base: docs/namespace-runtime
- Task Type: feature（功能开发）

## Parent

PR #85（docs/namespace-runtime）

## What to build

在 NamespaceRuntime 中实现唯一 namespace write sequencer 和 validated ROOT write。所有写按同步接纳顺序严格 FIFO，ROOT write 使用执行时 active schema，并在 live commit 后完成 dirty notification 才释放队列槽。

## Acceptance criteria

- [ ] mutateRoot 调用时同步决定 FIFO 顺序，单项失败不毒死后续队列
- [ ] 任务取得槽后先检查 lifecycle/fatal 与 DocHandle writable gate；不可写时不访问输入且零写入
- [ ] 输入在槽开始时复制为递归冻结的 plain-data snapshot，后续阶段不再读取调用方对象
- [ ] ROOT write 使用执行时 active schema；preparing/schema-unavailable 时按已冻结能力语义结算
- [ ] 调用 applyValidatedMutation 前后无额外 Y.Doc 写旁路，普通失败保持零写入结果联合
- [ ] transaction 成功后在同一槽内 await 窄 dirty notifier，resolve 后下一项才执行
- [ ] persistence-degraded 阻止 ROOT write但不阻止 read/P0；检查后降级的写仍登记最新 dirty 状态
- [ ] read 不进入 sequencer，只观察调用瞬间已提交状态；read-your-write 通过等待写 Promise 实现
- [ ] ROOT mutation 使用独立窄结果联合，fatal 走 Promise rejection
- [ ] 确定性并发测试与真实 Persistence 集成测试通过，并通过全量 typecheck/test、Node 20/24 CI

## Blocked by

- #76（已 CLOSED/COMPLETED 2026-08-23；见下方「关键上下文」3）
- #87（已合入：1543ab3 + 21b0eed）
- #89（已合入：df22660，本 worktree HEAD 的父链）

## Working Directory

/home/wangjian/nomicore-fix-issue-90

## 关键上下文（总控预读，供 SA 参考）

1. **ADR-0008**（docs/adr/0008-namespace-runtime-read-write-capabilities-and-sequencer.md）
   是本任务唯一行为契约源。本任务实现其中「单一 write sequencer」节与「ROOT write」
   子集 + 「Fatal 与失败通道」节的 ROOT mutation 部分。SCHEMA write（replaceSchema）、
   close() barrier、公共事件订阅**不属于本任务**（后续 issue）。
2. **现状基线**（#89 已交付，本分支已含）：
   - `packages/namespace-runtime/src/sequencer.ts`：WriteSequencer promise-chain FIFO
     （enqueue 微任务起步、前项 settle 后项方启、链尾恒绿、返回值=完成信号），
     文件头已注明真实写槽七步槽体扩展位；
   - `runtime.ts`：七键闭包公共面（owner/namespaceId/read/getSchemaEnvelope/
     getMetadata/getActiveSchema/getStatus），seam 构造器
     `createNamespaceRuntimeWithSeam({handle, p0Gate?, compile?})`；生产构造器
     createNamespaceRuntime 包内保留不导出；
   - `p0.ts`：P0 槽体 + RuntimeState（schemaState/activeInfo/activeTools/fatal/
     fatalCause）；`status.ts`：六键结构化瞬时 capability 投影（rootWrite 推导
     已含 schemaState!=='unavailable' 与 writableNow 瞬时观察）；
   - 测试 5 文件 21 用例全绿（packages/namespace-runtime/test/）。
3. **applyValidatedMutation 公共面状态**（本任务的前置演进项）：
   `packages/doc-runtime/src/mutation.ts` 实现 set-only `applyValidatedMutation`
   （ADR-0007 管线：⓪ tx-guard E202 → (A)–(G½) 写前校验/detached 构造 → (H)
   transactGuarded 单事务 → (I) verifyInstall；普通失败 ok:false 结果联合零写入；
   fatal 为 branded DocRuntimeFatalError(phase, committed) throw）。
   **该入口当前未从 doc-runtime index.ts 导出**——commit 21b0eed 以「待 #76 四操作
   契约」下架；#76 现已 CLOSED（COMPLETED，随 #87 PR #96 以 set-only 最小落地收口，
   无独立 PR）。本任务 AC5 要求 namespace-runtime 调用 applyValidatedMutation，
   因此 doc-runtime 公共面恢复导出（set-only 现状）+ 公共面守卫测试同步更新
   属于本任务范围（doc-runtime/test/public-surface-guard.test.ts 与
   public-surface-type-guard.test-d.ts 当前锁定「不导出」）。
4. **Fatal 契约**（ADR-0008「Fatal 与失败通道」节，逐句为验收锚）：
   - ROOT mutation 使用独立窄结果联合（普通失败 ok:false + issues，零写入）；
   - 任何 internal fatal（无论 committed 与否）永久关闭该 Runtime 全部写能力、
     保留读取；committed:false 不调用 dirty notifier；committed:true 或未知异常
     保守视为可能已提交，当前槽内 best-effort notifyDirty()，但始终 reject 原始
     fatal（post-commit fatal 以带 committed:true 的稳定 RuntimeWriteFatalError
     reject，上层不得自动重试非幂等写）；
   - 已排队后续写仍按 FIFO 取得槽，不访问输入、零写入返回 RUNTIME_WRITE_DISABLED；
   - 不补偿、不 fallback、不声称 rollback。
5. **dirty notifier 窄接缝**（ADR-0008）：`notifyDirty` 由构造方绑定
   `persistence.saveDoc(handle)`；Runtime 不依赖整个 DocPersistence。seam 需扩展
   注入点（确定性测试控制 notifier resolve/reject/时序）。成功只表示 live commit
   与 dirty notification 已登记，不表示落盘。
6. **persistence-degraded 语义**：阻止 ROOT write，不阻止 read/P0；gate 是瞬时观察
   （槽开始时检查）；检查后才发生的降级不撤销已提交事务，dirty notification 仍必须
   登记最新 live doc（persistence #79 已交付 degraded 窗口 saveDoc 脏登记）。
7. **snapshotter**（ADR-0008）：输入在槽开始时复制为递归冻结 plain-data snapshot；
   只接受 primitive、finite number、null、plain object/array；拒绝 accessor、
   class instance、特殊对象、symbol key、循环引用及其他非 plain data；后续阶段
   不再读取调用方对象（排队期间输入引用可变化，快照时点=槽开始时）。
8. **读取语义**（AC8）：read 不进 sequencer（现状已满足——read 是纯透传同步投影），
   read-your-write 由调用方 await 写 Promise 实现；本任务需以确定性并发测试锁定
   「read 只观察已提交状态、不等待已接纳未提交写」。
9. **CONTEXT.md 术语**：写序列器 / active schema / 信封 / 载体投影读取 /
   validateLogicalSnapshot / 派生 schema。
10. **仓库纪律**：pnpm workspace（七包）；测试命令 `pnpm test`（vitest run
    --typecheck，CI 同命令）；`pnpm typecheck` 七包 tsc；Node 20/24 CI；
    改动包须 bump patch 版本（硬门禁 9）；namespace-runtime tsconfig include 仅
    src/**（#89 设计 §7.1 决议：测试文件类型注入不纳入 tsc）。

---

## SA6 Phase 1 验收锚定：测试设计与红灯证据（2026-08-24）

### 测试文件

| 文件 | 锚定范围 |
|---|---|
| `packages/namespace-runtime/test/runtime-mutate-root-sequencer.test.ts` | AC1–AC9 确定性 seam 测试（12 用例）：FIFO 顺序/notifier 屏障/read 语义/单项失败不毒死队列/fatal 与 degraded gate/open 零访问/slot 起点快照/非 plain 输入拒绝/执行时 active schema/unavailable 零写入/committed:true 与 committed:false fatal 通道 |
| `packages/namespace-runtime/test/runtime-mutate-root-persistence.test.ts` | AC7/AC10 真实 Persistence 集成（2 用例）：Runtime 写 → saveDoc 登记 → flush → 全新实例跨实例读到写入值；degraded 全链（检查后降级 → 照样提交登记 → 后续写被拦 → retry 覆盖 → 全新实例看到该写） |
| `packages/doc-runtime/test/public-surface-guard.test.ts`（更新） | 任务简报「关键上下文 3」范围：applyValidatedMutation 恢复公共导出（set-only）——由「不导出」守卫翻转为「存在且函数」正锚 |
| `packages/doc-runtime/test/public-surface-type-guard.test-d.ts`（更新） | 同名目类型侧正锚（vitest --typecheck TS2305 机制） |

### 契约锚点（SA1 设计 / SA3 实现的验收行为锚，仅可补充）

1. seam 输入新增 `notifyDirty?: () => Promise<void>`（ADR-0008 原文命名；构造方绑定 `persistence.saveDoc(handle)` 的注入点）；
2. `runtime.mutateRoot(mutation)`：异步完成信号；调用同步接纳定序（不同步 throw / 不同步结算）；形状 `{ op: 'set', path: read-only (string|number)[], value }`（与 applyValidatedMutation 公共入口同形状）；
3. 结果联合：成功 `{ ok: true }`；普通失败（校验/快照拒绝/write-disabled）`{ ok: false, issues }` 且零写入；fatal 走 Promise rejection；
4. 槽序：lifecycle/fatal gate → writable gate → 槽起点快照（排队期间输入引用可变化）→ 执行时 active schema → 单事务 → 同槽 await notifyDirty → 槽释放；成功写恰 1 次 Y.Doc 更新事件 + 1 次 notifier；
5. 失败零写入：0 更新事件、0 notifier、state 字节不变；
6. write-disabled（fatal/persistence-degraded）：`ok:false` + issues 含稳定码 `RUNTIME_WRITE_DISABLED`（ADR-0008「零写入返回 RUNTIME_WRITE_DISABLED」）、输入零访问（Proxy 观测）、零写入；
7. fatal committed:true：reject 稳定 `RuntimeWriteFatalError`（committed:true + 稳定 phase 字符串）、槽内 best-effort notifier 恰一次、不虚假回滚（提交值保留）、已排队后续写仍取得槽并零写入返回 disabled、写能力永久关闭、读取保留；
8. fatal committed:false：reject（committed:false + phase 字符串）、notifier 不调用、零写入、写能力永久关闭、读取保留（触发路径：seam compile 注入畸形 derived——P0 最小形状守卫放行、写槽内暴露 E204 类 internal 不变量破坏）；
9. degraded：不阻止 P0（schema.state 照常 ready）、不阻止 read；写被拒零写入；检查后才降级不撤销已提交事务，dirty notification 仍登记（端到端：retry 覆盖后全新 Persistence 实例读到该写）。

### 红灯验证证据

- 定向运行（vitest run，3 文件 17 用例）：**16 failed | 1 passed**（唯一 passed = doc-runtime 守卫测试中的「五项既有导出仍在位」——保留性绿断言，非验收锚）；全部 12 个 sequencer 用例 + 2 个 Persistence 集成用例 + 2 个 doc-runtime 恢复导出用例均红。
- 失败形态：`TypeError: runtime.mutateRoot is not a function`（100% 用例——功能未实现）与 `expected false to be true`（doc-runtime 恢复导出缺失）。
- `vitest run --typecheck`（public-surface-type-guard.test-d.ts）：`TS2305: Module '"../src/index.js"' has no exported member 'MutationIssue' / 'ApplyValidatedMutationResult'` → 红。
- 另：全量 `pnpm test`（vitest run --typecheck）同时在 typecheck 阶段报 2 处 `notifyDirty does not exist in type 'NamespaceRuntimeSeamInput'`（红锚：seam 未扩展——SA3 扩展后自然消解）。
- 结论：**红灯真实、与实现差距一致**——功能不存在（构造性红灯），无「写了就绿」的假红灯；无无法复现阻塞。实现（SA3）后全部断言转绿即验收通过。

---

## SA6 Phase 2 补充锚定记录：snapshotter 数组分支 R2 拒绝（SA2 R2 备注 N1 回流，2026-08-24）

- **触发**：SA2 R2 复审 pass，备注 N1（LOW）：R2 新增的数组分支拒绝行为（symbol 键 / 非枚举键 / accessor 下标 / 空洞）无冻结测试锚定，建议补非冻结测试文件承载 SA2 红线 #2–#4。
- **产出文件**：`packages/namespace-runtime/test/runtime-mutate-root-snapshotter-array.test.ts`（非冻结补充文件，SA3 不得触碰既有冻结测试；若设计对实现内部再修订可对齐本文件）。
- **用例数**：5 用例——#2a symbol own 键 / #2b 非枚举 own 键 / #2c accessor 下标（getter 调用数 === 0）/ 同族（path 数组携带 symbol 键）/ 正例零误伤（密集嵌套数组 → ok:true + 提交值深等）。稳定码锚 `MUTATION_INPUT_NOT_PLAIN_DATA`（设计 R2 §6.2 #11；ok:false issue 前沿）。
- **断言纪律**：全部为公共接缝可观测输出（结果联合 ok:false + issues 稳定码、0 更新事件、state 字节不变、0 notifier、读取保留、getter 调用计数、提交值深等）；不预设实现内部（不读源码、不锚内部函数/字段名）。
- **红灯证据**：`pnpm vitest run packages/namespace-runtime/test/runtime-mutate-root-snapshotter-array.test.ts` → **5 failed | 0 passed**（构造性红：全用例 `TypeError: runtime.mutateRoot is not a function` / `expected 'undefined' to be 'function'`——mutateRoot 未实现）。
- **typecheck 通道**：`./node_modules/.bin/tsc -p tsconfig.typecheck.json --noEmit` → exit 2，共 5 错 = 2×TS2305（doc-runtime 类型名目恢复导出锚，既有）+ 3×TS2353（`notifyDirty` 不在 `NamespaceRuntimeSeamInput`——本文件为第 3 处；SA3 扩展 seam 后全部消解）。
- **状态**：红灯真实（实现差距 = 功能不存在）；SA3 实现 D3 数组分支①–⑤（descriptor 全表扫描先于任何值读取）后本文件转绿即兑付 SA2 红线 #2a/#2b/#2c + 同族 + 正例不误伤。

---

## SA6 Phase 3 测试修订记录（SA3 实现后 3 处测试侧缺陷修复，2026-08-24）

- **背景**：SA3 实现后总控亲跑全量 1046 用例基线，3 红全部定位为测试文件自身缺陷（实现经实证正确）；本轮仅改测试侧，`src/` 零改动。
- **修订 1**（`runtime-mutate-root-sequencer.test.ts`「AC1+AC6+AC8 严格 FIFO」）：pB 完成 push 未注册——补 `pB.then(() => order.push('B'), ...)`；`expect(order).toEqual(['A','B'])` 现可达。
- **修订 2**（同文件「AC1 单项失败不毒死后续队列」）：`await settleOf(pFail)` 的 async 包装使断言 continuation 比 pOk 槽体多一跳微任务（pOk 事务先于此提交 → updates.count=1 误报）。修复：同步注册 `pFail.then` 结算探针（先于 pOk 入队）捕获「失败写结算瞬间」证据——0 更新事件 / state 字节不变 / 0 notifier（先以独立 Probe 实测确认：探针捕获 updates=0、bytesSame=true、notifier=0，随后 pOk 才提交）；两笔写仍同一同步时刻发送、FIFO 接纳、失败不毒死队列的锚语义完整保留。
- **修订 3**（`runtime-mutate-root-snapshotter-array.test.ts`「正例零误伤」）：fixture 以 plain JSON 数组经 `root.set` 种 `tags`（Y.Map.set 不自动转换），而 `string[]` schema 派生 Y.Array 载体——extract 按 ADR-0007「当前 ROOT 结构损坏立即失败」正确报「期望 Y.Array，实际 plain value」。修复：makeDoc 种子侧物化真 `Y.Array`（`new Y.Array + insert` 后 set）；readValue 深等断言语义不变（实测 ok:true + read `['x','y','z']`）。
- **红灯证据（修订后亲跑，独立进程后台运行）**：
  - `pnpm exec vitest run packages/namespace-runtime --typecheck` → **8 文件 / 43 用例全绿，Type Errors 无**（含 3 个 SA6 测试文件 19 用例）；
  - `pnpm exec vitest run packages/doc-runtime/test/public-surface-guard.test.ts public-surface-type-guard.test-d.ts --typecheck` → **2 文件 / 5 用例全绿，Type Errors 无**；
  - 全量 `pnpm test` → **Test Files 78 passed (78) / Tests 1046 passed (1046) / Type Errors no errors / exit 0**——零回归。
- **结论**：SA6 全部验收锚在 SA3 实现上转绿（含 Phase 2 补充锚 5 用例），无残留红；行为锚语义未变（仅修复测试自身时序/载体 fixture 缺陷）。
