# SA3 实现报告 — task_root-schema-diagnostic-change-log（issue #149）

- 实施者：SA3（TDD Executor），2026-08-29（R2 收尾：SA6 按设计 §13.8 修订红灯消费形态后 14/14 转绿，本报告为最终版）
- 依据：`wiki/raw/task_root-schema-diagnostic-change-log_design.md`（SA1 设计，含 R1/R2/R3 修订——§6.4 增量可重放性契约、§14 P8、§13.8 测试修订规格）+ `task_root-schema-diagnostic-change-log_sa2_review.md`（R1 verdict pass，2 项 INFO 移交 SA3 处理）
- 实施范围：严格按设计 §16 ALLOW LIST；DENY LIST 零触碰；SA6 owned 红灯测试断言零改动（本轮仅消费形态由 SA6 按 §13.8 修订，SA3 未触碰）

## 一、改动文件清单（均在设计 ALLOW LIST 内）

### 生产代码（5 个）

| 文件 | 改动 | 对应设计 |
|---|---|---|
| `packages/namespace-runtime/package.json` | `dependencies` + `"@nomicore/namespace-diagnostic-log": "workspace:*"`（L1 依赖层；type-only + `emitter.emit` 值级依赖恰一处） | §4 |
| `packages/namespace-runtime/src/diagnostic.ts`（新建） | `DiagnosticEnv`（**判别联合**：`{emitter:undefined; clock:undefined} \| {emitter; clock:()=>number}`——SA2 INFO-1 推荐解）、`buildDiagnosticEnv`、`SlotDiag`/`SlotOutcome`/`SlotSettle`、`createSlotDiag`、`observedAtMs`（本地 3 行 ISO helper，零值级诊断包依赖）、`emitAttempt`（全吞；code↔sourceModule 成对单点）、`emitSlot`（三分支 INV-DIAG 契约：显式 outcome → 按 outcome；fulfilled+r.ok===true → 缺省 transaction/committed；ok:false 或 rejection → 不 emit）、9 个槽内结局 helper | §5.2/§7.2/§7.3/§8（§5.2 判别联合与设计 R3 自检「diagnostic.ts:43-57 逐字对应」一致） |
| `packages/namespace-runtime/src/runtime.ts` | seam 接口 +2 可选字段（`diagnosticEmitter?`/`clock?`，ADD 扩展）；`captureSeamInput` +2 捕获分支（emitter 形状校验、**doc 局部量 on/off 校验**——SA2 #1 修正：校验对象是 handle.doc 而非 handle；clock 函数校验；**成对 loud 校验**——SA2 #5：装配 emitter 而缺 clock ⇒ 构造 TypeError，无 Date.now 缺省）；`diagEnv` 构造；`mutateRoot`/`replaceSchema` 的 acceptance 同步 emit（issues 同源透传）+ 槽后 emit 挂点（**非包装附加反应**） | §5.1/§5.2/§7.1/§7.2 |
| `packages/namespace-runtime/src/write.ts` | `runRootWriteSlot(env, input, diag?)` 可选第三参数；§9.1 全部 13 个结局点（R1–R12 + S7 缺省组装）逐点诊断写入：gate/acceptance 类 issues 同源透传（`if (r.ok === false) diagCapGate(...)` 形态，同一数组引用零第二构造——SA2 #3 透传侧裁决）、S5 捕获窗口（`doc.on('update')` → 同步 run → try/finally 退订 + 收口 `diag.updateBytes`；catch 内分类读窗口局部 `capturedUpdate`——JS catch 先于 finally 语义已处理，fatal 路径 bytes 保留）、S6 dirtyFatal | §8.1/§8.2/§9 |
| `packages/namespace-runtime/src/schema-write.ts` | `runSchemaWriteSlot(env, input, diag?)`；§9.2 全部结局点（S1′–S7′）：S4 compile ok:false 诊断 issues 结构化（`toIssueSummary` 码派生单源：SCHEMA_TEXT_INVALID/SCHEMA_ENVELOPE_*，顶层 code=首条）、S4′b fatalCompileThrow（schema-compile-throw committed:false）、S5 同款捕获窗口（NSRT-FATAL-SCHEMA-WRITE-INTERNAL 分码）、S6′dirtyFatal | §8.2/§9.2/§9.3 |

### 锁文件（1 个）

| 文件 | 改动 |
|---|---|
| `pnpm-lock.yaml` | workspace 依赖链接登记（`pnpm install` 产生，§4 实施注意） |

### 测试（1 个，SA6 owned，SA3 零改动）

- `packages/namespace-runtime/test/runtime-root-schema-diagnostic-red.test.ts`：本轮由 **SA6 按设计 §13.8 规格**修订（`applyCarrier(carrier, baseState, prior=[])` 基态链式重放 + `expectNoMaterializeWithoutBase` 反向鉴别断言）；断言值不变，全部转绿 14/14。

## 二、关键实现决策记录

1. **emit 挂点形态（与设计 §7.1 字面伪代码的偏差与理由）**：设计字面为 `enqueue(...).then(onOk, onErr)` 作为返回值表达式。SA3 首版照此实现后 `runtime-mutate-root-sequencer.test.ts` AC1 回归（探针观察到下一槽 update 事件——「派生 promise/多一跳微任务」正是 SA2 #6 登记的时序风险面）。最终实现改为**非包装附加反应**：`const settled = sequencer.enqueue(...); void settled.then((r) => { emitSlot(...); }, (e) => { emitSlot(...); }); return settled;`——返回面仍是 `settled` 本体（基线 promise 身份与结算时点零变化，SA2 #6 的派生 promise/微任务差异**消除为 0**）；`onErr` 不重抛（caller 经 `settled` 观察原 rejection，本反应链恒绿、无 unhandled rejection）。§7.1 全部排序保证保持：emit 反应在 mutateRoot 同步段注册，晚于 sequencer 内部 `tail.then(noop)` 接线、早于 caller 任何反应与下一任务 thunk 排程——【noop, emitSlot】依注册序执行，emit 先于下一槽、slot 已释放后（amendment C 合规）、顺序 ≡ 槽完成顺序 ≡ FIFO。AC4 两锚点（emitCalls===2 同步断言、队列满 stats）实测通过。
2. **S5 捕获窗口的 catch/finally 时序**：JS 语义 catch 先于 finally；分类（`diagFatalTx`）在 catch 内执行时 `diag.updateBytes` 尚未收口——故 `diagFatalTx` 显式接收窗口局部 `capturedUpdate`（事件在 transact 调用栈内、throw 之前已派发，catch 时已就绪）；finally 只负责退订与收口 `diag.updateBytes`（成功路径 S6/S7 消费）。fatal committed:true + bytes → effect update；无 bytes → effect unknown（§7.3 表）。
3. **零事件 ⇔ noop**：yjs `hasContent` 守卫——窗口内零事件 → `diag.updateBytes === undefined` → 缺省组装 `{kind:'committed', effect:'noop'}`（§6.2②，机制依据 P2）。
4. **issues 保真**：gate/acceptance/validation/input-snapshot 记录 issues 与业务返回**同源同序透传**（同一数组引用）；fatal throw 通道无 issues 载荷（RuntimeWriteFatalError 无 issues 字段，§9.3 三分裁决）；S4′a 诊断 issues 为结构化 `{code,message,path:[]}`（业务面 issues 不变）。
5. **输入纪律**：`SlotDiag.input` 初始 `{status:'not-accessed'}`；S3 失败 → `{status:'unsafe-input'}`（不回读敌意输入）；S3 成功 → `{snapshot}`（同一 frozen 快照引用——AC5 零额外读取由机制保证：诊断侧零第二次遍历调用方原对象）。
6. **SA2 R1 INFO 项落实**：INFO-1（DiagnosticEnv.clock 类型形状）→ 判别联合推荐解（见上；全程无 `Date.now` 缺省、无 `??` 默认——技能禁令扫描通过）；INFO-2（设计 §13.6→§13.7 笔误）→ 设计文档属 SA1 产物未越权改动，SA3 源码注释按正确引用 §13.7 编写。

## 三、验证证据（命令 + 真实结果，2026-08-29 最终版）

| 验证 | 命令 | 结果 |
|---|---|---|
| 红灯契约（SA6 修订后） | `npx vitest run packages/namespace-runtime/test/runtime-root-schema-diagnostic-red.test.ts` | **14/14 通过**（426ms；Type Errors no errors） |
| 全仓测试 | `npx vitest run` | **141 files / 1800 tests 全部通过，0 失败**（470s；Type Errors no errors） |
| 全仓类型检查 | `pnpm typecheck` | **通过（exit 0）**——10 个包 tsc 全部干净 |
| 包级类型检查 | `pnpm --filter @nomicore/namespace-runtime typecheck` | 干净（src 严格模式含 exactOptionalPropertyTypes/verbatimModuleSyntax） |
| **CI 等价（SA4/SA7 轮）** | `pnpm test`（= CI `Test` 步：`vitest run --typecheck`） | **142 files / 1816 tests 全部通过、Type Errors no errors**；exit 1 仅因 2 条 `[vitest-worker]: Timeout calling "onTaskUpdate"` 环境工件（SA7-I-2：改动前同签名同条数、单独运行零工件） |
| **CI 等价（测试文件级类型检查）** | `npx tsc -p tsconfig.typecheck.json`（include 含 `packages/*/test/**/*.ts`） | **0 错误（exit 0）**——SA7-F-1 修复闭环：SA3 轮提交的红灯测试文件 63 处类型错误（`rec` possibly undefined / carrier 未收窄）由 SA7 纯类型层修复（`firstAttempt`/`inlineBytes`/`updateCarrierOf` 收窄守卫，零断言零语义变更） |
| CI 等价（类型步） | `pnpm typecheck` | **通过（exit 0）**（复跑确认） |
| **B-1 复验（终审 §4 固定范围）** | `npx vitest run packages/namespace-runtime/test/runtime-root-schema-diagnostic-sa7.test.ts -t "DV-2" --typecheck` ×3 | **×3 全部 2/2 通过**（0 失败；修复前隔离 3/3 失败 22–27ms vs 20ms） |
| **B-1/B-2 后全量** | `pnpm test`（= CI `Test` 步） | **142 files / 1816 tests 全部通过；Type Errors no errors**（全量绿；exit 1 仅余已文档化环境工件 A-3/SA7-I-2） |
| **B-2 复验（终审 §4 固定范围）** | `pnpm install --frozen-lockfile --prefer-offline --ignore-scripts` | **exit 0**——lockfile 无连锁变化；`git diff pnpm-lock.yaml` 空 |

- 转绿前关键发现（R1 版阻塞，已由 SA1 R2 修订 + SA6 §13.8 修订闭环）：yjs 事务 update 事件 payload 为**增量**（`writeStructsFromTransaction` = `writeClientsStructs(encoder, store, transaction.beforeState)`，left origin/delete set 引用 pre-state struct）——应用到**空 Y.Doc 不物化**（实测：38B 增量 → 空 doc `store.clients=[]`、不抛错）。设计 §10.2 R1 版「空 doc 可重放」声称不成立。SA3 以最小实验（yjs@13.6.32）实证后上报；SA1 R2 冻结修正契约（§6.4：同源基态 + 依序增量链 = ADR-0011「连续的 committed Yjs updates 诊断性重放」原生语义；新增 §14 P8 实测证据 + §13.8 SA6 测试修订规格），**producer 侧零改动**（§6.1–6.3/§7/§8/§9 全部不变）——SA3 已实施捕获机制本就产事务增量，与修订后设计一致。

## 四、SA4/SA7 交接注记

- 全部改动位于 ALLOW LIST；DENY LIST（diagnostic-log/doc-runtime/sequencer/index/p0/close/status/projection/plain-data/errors/internal/registry/persistence/vfsl/clock）零触碰；`index.ts` 零改动（公共导出面不变，runtime-acceptance-exports-audit 通过）。
- 「completion 前红灯基线」：SA3 实施期间红灯文件 11/14 绿 → SA6 修订消费形态后（§13.8）14/14 全绿，**断言值与分类面未变**（改动仅为基态链式重放的消费方式 + 反向鉴别断言）。
- 回归重点面（SA2 #6/§13.5）：runtime-close-lifecycle / runtime-close-sa7-dynamic / runtime-p0-sequencer / runtime-mutate-root-sequencer 全部通过（emit 挂点为非包装附加反应后，时序敏感面零回归）。
- **终验补记（2026-08-29 完成轮）**：三连验证全绿——红灯契约 14/14、全仓 vitest 1800/1800（141 文件）、`pnpm typecheck` exit 0。提交 `96cd085`（本地，未 push）含生产代码 + SA6 红灯文件 + 全部任务 wiki 归档。
- **终验补记 R2（SA7 动态验证轮，2026-08-29）**：SA4 静态评审 pass（5 INFO，无阻塞）；SA7 动态验证 pass（16 个新动态测试全部通过：DV-1 慢 emit 槽间延迟 / DV-2 acceptance 同步 emit / DV-3 unhandledRejection 抑制 / DV-4 §13.7 未钉死结局点 9 点补钉 / DV-6 队列满×full 组合；生产面零缺陷发现）。SA7-F-1（红灯测试文件 63 处类型错误——SA3 轮全链路验证均用 `--typecheck.enabled=false` 而 `pnpm typecheck` 只覆盖 src 的**验证缺口**）已在测试层修复并闭环：`tsc -p tsconfig.typecheck.json` 0 错误；SA7 测试/报告与修复由 **SA3 本轮并入本地提交**（commit 见 §五；生产代码零改动——无任何演示性失败触发）。备注观察项（SA7 owned，不阻塞）：DV-2 对照断言 `syncMs < 20` 在本沙箱 scoped/隔离运行下处于边缘（实测 22–27ms——memory adapter 单次 emit 本机约 14ms + 首调 warmup；CI 等价全量运行 142/142 绿灯）；如后续 CI 出现该断言 flaky，建议 SA7 放宽余量或在对照前预热管线。
- **终验补记 R3（standards 终审轮，2026-08-29）**：SA4 standards 轴独立终审 **verdict: reject**（BLOCKER×2，其余 7 轴全部 pass）——**BLOCKER-1**：SA7 DV-2 对照断言 `syncMs < 20` 为贴界墙钟上界（实测 ~1/3 失败率，CI `Test` 步随机红）；**BLOCKER-2**：`@nomicore/namespace-runtime` 漏 version bump（仓库「逐变更 patch bump」惯例）。两项均已修复：
  - **B-1 修复（SA7 owned 测试文件，按终审 §1 (a) 方案）**：`runtime-root-schema-diagnostic-sa7.test.ts` DV-2 对照 it 断言 `< 20` → `< 100`，it 标题与注释同步改为「无自旋量级」语义（`SPIN_MS=30` 慢 emitter 首测的 `>= SPIN_MS-5` 下界不变——对照区分度完整保留；同步发射测试本体零改动）。终审 §4 固定复验范围复跑：DV-2 隔离 ×3 全绿、全量 `pnpm test` 全绿 + Type Errors no errors（见 §三表）、`tsc -p tsconfig.typecheck.json` 0 错误、`pnpm typecheck` exit 0。
  - **B-2 修复（SA3 回流）**：`packages/namespace-runtime/package.json` version `0.1.7 → 0.1.8`；`pnpm install --frozen-lockfile` exit 0——pnpm-lock.yaml 无连锁变化（workspace 包版本不入 lockfile；终审 V10 复核面）。
  - AC checklist Gate summary 已同步修正（原先的「exited 1 only for two documented vitest-worker RPC timeout environment artifacts」归因被终审证伪——存在第三个 exit-1 成因即 B-1；现已改写并记录修正）。
  - 其余 7 轴（映射一致性/触发/ADR/范围/业务回归/卫生）终审 pass 支撑面零改动；本轮生产代码变更 = 仅版本行（package.json），无任何语义改动。

## 五、提交记录

- `96cd085`（R2 完成轮）：生产代码 5 + SA6 红灯文件 + wiki 归档 9 件（SA3 实现报告初版含内）——16 files, +2717/−19
- R3 完成轮（本报告更新）：SA7 纯类型层修复（红灯测试 +38/−21）、SA7 动态测试 16 it（新）、`sa4_review.md`（新）、`sa7_report.md`（新）、派发日志行 15–17——本地提交，未 push
