# SA4 静态验尸报告 — task_root-schema-diagnostic-change-log（issue #149）

**Date**: 2026-08-29
**Reviewer**: SA4（Red Team；独立静态审查，未参与 SA1/SA2/SA5/SA6/SA3 任一环节）
**被审对象**: 本地 commit `96cd085`（`feat(namespace-runtime): connect ROOT/SCHEMA writes to diagnostic change log (#149)`，基线 `eaf0484`）
**约束基准**: `task_root-schema-diagnostic-change-log_design.md`（R3 版）/ `task_root-schema-diagnostic-change-log_sa2_review.md`（R3 pass）/ `task_root-schema-diagnostic-change-log_relevant_decisions.md`（ADR-0011/0012/0008/0007 摘录）
**Verdict**: **pass**（附 5 项 INFO：1 项已落实设计偏差记录在案、3 项移交 SA7 动态验证、1 项测试覆盖缺口登记；无阻塞项）

---

## 0. 审查方法与独立验证证据

不采信 SA3 报告自述，逐项对 worktree 源码与真实运行复核。全部命令在独立进程执行（技能立法）。

| 验证项 | 命令 | 结果 |
|---|---|---|
| 红灯契约转绿 | `npx vitest run packages/namespace-runtime/test/runtime-root-schema-diagnostic-red.test.ts --typecheck.enabled=false` | **14/14 通过**（452ms，exit 0） |
| 受影响三包套件 | `npx vitest run packages/namespace-runtime/test packages/namespace-diagnostic-log/test packages/doc-runtime/test --typecheck.enabled=false` | **18 文件 / 252 测试全绿，Type Errors no errors，exit 0** |
| 全仓套件 | `npx vitest run --typecheck.enabled=false` | **129 文件 / 1721 测试全部通过**；2 条 unhandled error 为 `vitest-worker RPC Timeout "onTaskUpdate"`（纯 vitest 内部栈、无应用帧——沙箱满载工件；受影响包单独运行零错误佐证非本改动引入；SA7 需以 CI 运行为最终证据） |
| 包级 typecheck | `pnpm --filter @nomicore/namespace-runtime typecheck` | exit 0 |
| 全仓 typecheck | `pnpm typecheck`（10 包） | exit 0 |
| P1/P2 协议复验 | `sed -n '355,372p' node_modules/.pnpm/yjs@13.6.32/.../Transaction.js` | 属实：`writeUpdateMessageFromTransaction(encoder, transaction)` + `if (hasContent)` 守卫 + `encoder.toUint8Array()` 新分配——payload 为**该事务增量**、零内容不派发 |
| P5 协议复验 | `cat packages/namespace-runtime/src/sequencer.ts`（L38-42） | 属实：`settled = tail.then(run,run)`；`tail = settled.then(noop,noop)` 先注册——emit 反应后注册、下一任务 thunk 挂新 tail 之后，微任务序 `[noop, emitSlot, run₂]` 成立 |
| P6 协议复验 | memory.ts queue-full 分支（`queue.length >= capacity → countDrop('queue-full')`）+ pipeline.ts emit 全 catch + intake 封闭词表校验 | 属实 |
| P7 依赖复验 | `git diff 96cd085^ 96cd085 -- pnpm-lock.yaml` | 仅 `@nomicore/namespace-diagnostic-log workspace:* → link:../namespace-diagnostic-log` 一条登记 |
| 增量真实性（结构面） | `grep -rn "encodeStateAsUpdate\|encodeUpdate" packages/namespace-runtime/src/` | **零命中**——producer 侧不存在任何整文档编码路径（ADR-0011 §D 冒充红线结构性不可触） |

---

## 1. 审核结论

### 1.1 文件清单 Scope Creep Guard — ✅ 通过

- ALLOW LIST（设计 §16）与 actual diff（`git diff --name-only eaf0484 96cd085`）逐集比对：`package.json`、`src/diagnostic.ts`（新建）、`src/runtime.ts`、`src/write.ts`、`src/schema-write.ts`、`test/runtime-root-schema-diagnostic-red.test.ts`、`pnpm-lock.yaml`（白名单）——**零越界**；wiki/raw/* 均在白名单模式内。
- BLACKLIST 扫描：无 `package-lock.json` / `yarn.lock` / `TASK.md` / `*.bak` / `.DS_Store`。
- DENY LIST 零触碰：`namespace-diagnostic-log/**`、`doc-runtime/**`、`sequencer.ts`、`index.ts`、`p0.ts`、`close.ts`、`status.ts`、`projection.ts`、`plain-data.ts`、`errors.ts`、`internal.ts`、registry/persistence/vfsl/clock 均不在 diff；`index.ts`/`internal.ts` 无 diagnostic 泄漏（grep 零命中，runtime-acceptance-exports-audit 通过）。

### 1.2 设计偏离审查 — ✅ 一致（1 项已记录的良性偏差）

- **唯一偏差：emit 挂点形态**。设计 §7.1 字面伪代码为 `return sequencer.enqueue(...).then(onOk, onErr)`（包装形态——返回派生 promise）。SA3 实施为**非包装附加反应**：`const settled = enqueue(...); void settled.then(emitOk, emitErr); return settled;`。判定：**良性且优于设计**——返回面仍为 `settled` 本体，基线 promise 身份与结算时点零变化，把 SA2 #6 登记的「派生 promise/多一跳微任务」差异消除为 0（SA3 首版照抄字面实现曾使 runtime-mutate-root-sequencer 回归，改附加反应后零回归——本次全量套件含该文件全绿）。§7.1 的三项排序保证经本人依 sequencer.ts L38-42 + PromiseJobs 注册序独立重推全部保持：emit 在 slot 释放后、先于下一任务 thunk、emit 顺序 ≡ 槽完成顺序 ≡ FIFO（amendment C 合规）。偏差已在 SA3 报告「关键实现决策 1」记录在案。
- §5.2 seam 校验对象 = `doc` 局部量（runtime.ts:421 捕获，先于 452-465 诊断校验分支）——SA2 #1 CRITICAL 修正落实，Proxy handle（仅劫持 getStatus）下 `h.doc` 透传真 Y.Doc，合法装配不炸（红灯套件含 Proxy 用例全绿佐证）。
- §9.1/§9.2 全部 25 结局点的 stage/code/sourcePhase/sourceModule/result/input 映射逐点比对实现（write.ts S1-S7 / schema-write.ts S1′-S7′ / runtime.ts acceptance 两处）——**逐字一致，无遗漏、无错位**（每个 return/throw 前恰一行 diag 写入；R10 `err.phase` 透传三值 `observer-cleanup-throw`/`post-commit-verification`/`pre-commit-internal` 均匹配 RE_STABLE_CODE）。

### 1.3 E2E/vitest 触发性自检 — ✅ 通过

- 本任务无 E2E spec。新增 vitest 文件 `packages/namespace-runtime/test/runtime-root-schema-diagnostic-red.test.ts` 落于根 `vitest.config.ts` include `packages/*/test/**/*.test.ts` 内；CI（`.github/workflows/ci.yml` `Test` 步 `pnpm test` = `vitest run --typecheck`）必然收集本文件。本地真实运行 14/14 绿。无「测试存在但 CI 永不触发」黑洞。

### 1.4 协议假设审查 — ✅ 通过（§1.5 门禁）

设计 §14 P1–P8 章节完备、依据全部为源码/规范/实测引用（无「应该/通常」）。本人复跑 P1/P2/P5/P6/P7（见 §0 表）+ P8 结构面与行为面双重复核（结构面：producer 零整文档编码；行为面：红灯套件 `applyCarrier` 同源基态链式重放 + `expectNoMaterializeWithoutBase` 反向鉴别断言运行通过——真增量对空 doc 不物化、整文档冒充必红）。无 mismatch。

### 1.5 契约改动连锁审查 — ✅ 通过（§1.6 门禁）

- `runRootWriteSlot`/`runSchemaWriteSlot` 仅追加可选第三参（additive）；全仓 grep 证实直接 caller 仅 runtime.ts 两处（测试仅负向导出断言，无直接调用）。
- `mutateRoot`/`replaceSchema` 返回值仍为 enqueue 返回的同一 promise（身份保持，非包装）；新增 `.then` 附加反应的 onErr 不重抛——本反应链恒绿、无 unhandled rejection；caller 经 `settled` 观察原 rejection。
- `captureSeamInput` 新增 throw 路径仅在新可选字段被提供时可达——既有全部调用方（生产工厂 + 全部既有测试）构造行为零变化。
- 无 return→throw / Promise 形状反转 / 同步→async / catch 吞没→rethrow；本仓无 `process.on('unhandledRejection') → exit` 生产 catch-all（grep 仅测试探针，且断言方向为「不发生 unhandled rejection」——与附加反应相容）。

### 1.6 测试质量（源码 grep 断言禁令） — ✅ 通过

红灯套件全部为运行时行为断言（真实 memory adapter 装配、record 形状断言、carrier 重放、trap 计数、stats 断言）；零 `readFileSync`+`toMatch/toContain` 源码字符串断言、零 `.only`/`.skip`。`JSON.stringify(res)).toContain(...)` 断言对象是业务返回值 JSON（运行时行为），非源码文本。

### 1.7 读写路径一致性 — ✅ 一致

单一数据流：槽内结局点 → SlotDiag（input = S3 冻结快照引用 / outcome / updateBytes）→ 槽外 emitSlot → emitter 管线 → adapter。无第二真相源：诊断读的每一样本（issues 数组、快照、bytes）与业务结算值同源同引用；updateBytes 来自业务事务同一调用栈的 yjs update 事件。operator 读面 `records()` 消费同一 emission。

### 1.8 静默失败扫描 — ✅ 无未授权静默路径

- `emitAttempt` try/catch 全吞是 ADR-0011 §A 授权的业务隔离（业务面四不变由机制保证：emit 路径零接触 state/handle/sequencer——diagnostic.ts 通读确认）。
- INV-DIAG 违约分支（outcome 缺失 + 业务拒绝/rejection → 不 emit）是设计冻结的 fail-safe（宁可缺记录绝不伪造 committed）。本人穷举两槽全部 return/throw 验证：**25 结局点每点均显式写 outcome，该分支在完备实现中结构性不可达**；残余风险（未来漏写点静默缺记录、无健康事件）见 §3 动态项 DV-4。
- 零事件 → `effect:'noop'`、fatal 零 bytes → `effect:'unknown'` 均为诚实上报非静默降级；`update-omitted` reason 词表归 adapter，producer 不发明。

### 1.9 降级方案审查 — ✅ 安全

- 无「降级兜他人缺陷」形态：装配 emitter 而缺 clock ⇒ 构造期 loud TypeError（无静默墙钟）；doc 缺 on/off ⇒ 构造期 loud TypeError（不把「应有 update 的记录」降级 noop/omitted）；`buildDiagnosticEnv` 的防御性归一分支不可达（前置校验拦截）。
- 队列满 drop / VFSL validation 失败丢 record + 健康事件 = adapter 侧既有授权行为，业务无感知（AC4 队列满锚点实测通过）。

### 1.10 极端条件攻击 — ✅ 未发现可利用漏洞

| 攻击 | 结果 |
|---|---|
| 敌意 emitter（emit 内 throw） | 吞没；emitCalls 计数在 throw 前自增——AC4 `===2` 成立（实测通过） |
| 违约 clock（NaN/超域 epoch） | `observedAtMs` 在 emitAttempt try 内 throw → 吞没 → 该条记录缺失（不伪造时间戳）——授权隔离 |
| 敌意 accessor 输入（ROOT/SCHEMA） | S3 descriptor 全表扫描前置拒绝，accessor 零执行×2（记录前+记录后，实测 `fired===0`） |
| 合法 Proxy 输入 | 诊断只消费 frozen 快照，get-trap 计数与无日志基线相等（AC5 实测） |
| 同一 doc 并发多写 | 每次尝试独立 SlotDiag + 独立捕获窗口；槽间 FIFO 串行，窗口永不交叠；emit 顺序 ≡ FIFO |
| emit 回调内同步重入 mutateRoot | emit 在槽外微任务执行，重入写正常入队下一槽——无死锁/无递归窗口交叠（静态推演成立） |
| 超大 update bytes | adapter payload 上限守卫 → update-omitted + 受控 reason（producer 不发明） |
| compile ok:false 且零 issues | 槽内既有守卫 throw → S4′b fatal 路径（diagFatalCompileThrow）——`diagCompileFail` 的「首条 code 可能缺」分支结构性不可达 |
| fatal committed:true 但零 bytes | `effect:'unknown'`（诚实）——EmissionResult 判别联合吻合 |

### 1.11 SA2 info 项落实复核（总控点名） — ✅ 全部落实

- **INFO-1（DiagnosticEnv.clock 类型形状）**：落实为判别联合 `{emitter:undefined;clock:undefined} | {emitter;clock}`（diagnostic.ts:43-45）+ `buildDiagnosticEnv` 总函数（L50-57）；全程无 `Date.now` 缺省、无 `??` 墙钟填充（grep 证实 diagnostic.ts 仅 `new Date(now())` 表达式）。
- **INFO-2（§13.6→§13.7 笔误）**：源码注释按正确引用编写（diagnostic.ts:20-21「设计 §13.7『ok:false ⇒ result.kind !== committed』机制守卫」）；设计文档属 SA1 产物未越权改动（SA3 报告决策 6 记录）。

### 1.12 事务增量真实性（总控点名） — ✅ 三重钉死

1. **结构面**：producer 唯一 bytes 来源 = `doc.on('update')` 捕获（write.ts:178-181 / schema-write.ts:215-218，仅 diag 装配时订阅，try/finally 对称退订）；namespace-runtime/src 全包 `encodeStateAsUpdate` 零命中——ADR-0011 §D 三种冒充面（整文档编码/mutation input/逻辑 diff）结构性不可触。
2. **机制面**：payload 编码器 = yjs `writeUpdateMessageFromTransaction`（该事务增量，本机 yjs@13.6.32 源码复验）；捕获窗口（on → 同步 run → off）覆盖派发点（transact 调用栈内同步派发）；首-赋值守卫处理结构性不可达的多事件分支。
3. **行为面**：红灯套件 `applyCarrier` 同源基态链式重放（base→tx₁ 中间态断言——整文档冒充无法停在单事务边界）+ `expectNoMaterializeWithoutBase` 反向鉴别（整文档编码对空 doc 必物化 → 立即红）+ payloadLength 双重鉴别——14/14 实测通过。

### 1.13 sequencer / 业务隔离（总控点名） — ✅ 四道防线成立

- **返回值不变**：emit 在附加反应内执行、`settled` 本体直返；emitAttempt 全吞（含敌意 emitter/违约 clock）。
- **slot 不延长**：emit 时点 = settled 的微任务回调，slot（thunk→settled）已终止。
- **FIFO 不变**：注册序 `[内部 noop, emitSlot]`、下一任务 thunk 挂 noop 产物之后——emit 顺序 ≡ 槽完成顺序 ≡ FIFO（队列满 drop 顺序亦然，AC4 实测）；`await` 消费者恢复时 emit 必已执行（caller 续体注册晚于 emitSlot）——`emitCalls===2` 同步断言无 flaky 窗口。
- **capability 不变**：emit 链零写 `state.fatal`/`state.lifecycle`/handle（diagnostic.ts 通读 + AC4 两例实测）。
- 微妙点核查：`void settled.then(...)` 无条件附加（未装配 emitter 亦然）——使 fire-and-forget fatal 写的 `settled` 被标记为 handled，进程级 `unhandledRejection` 不再触发（基线面细微行为差异，见 DV-3；仓内无生产方依赖该信号，registry 测试断言方向为「不发生」，相容）。

### 1.14 架构评估 / 过度设计 — ✅ 可行 / ✅ 精简

diagnostic.ts 291 行承载 25 结局点映射 + per-attempt 收集器 + 发射隔离 + INV-DIAG 结构保证——复杂度与冻结契约要求相当，无超前抽象。唯一冗余：`if (r.ok === false)` 恒真守卫（disabled() 必返 ok:false）——零行为、可读性无害。变更半径严格限于两写槽 + 公共方法 + 新模块。

---

## 2. 发现清单（全部 INFO 级，无 REJECT 项）

| # | 级别 | 发现 | 处置 |
|---|---|---|---|
| I-1 | INFO | **emit 挂点设计偏差**（非包装附加反应 vs 设计 §7.1 字面包装形态）——良性且优于设计（promise 身份/结算时点零变化，SA2 #6 差异消除）；排序保证保持 | 记录在案（SA1 下轮例行同步设计文本即可，不需重审）；已通过全量回归 + AC4 双锚点验证 |
| I-2 | INFO | **慢 emit 的槽间延迟耦合**：emit 在槽间微任务执行，未来 File adapter 的慢同步 emit 会推迟下一槽 thunk 启动（amendment C 合规、FIFO 不变，但写吞吐与日志 I/O 耦合） | 交 SA7（DV-1）；File adapter 装配票设计时须评估 |
| I-3 | INFO | **acceptance 同步 emit 延迟**：lifecycle≠ready 拒绝路径在公共方法调用栈内同步 emit——慢 emitter 增加该纯同步拒绝路径延迟 | 交 SA7（DV-2） |
| I-4 | INFO | **unhandledRejection 抑制**：附加反应使 fire-and-forget fatal 写的 rejection 被标记 handled——进程级 unhandledRejection 信号消失（仓内无生产依赖方，方向与既有测试相容） | 交 SA7（DV-3）；Registry 接线票知悉 |
| I-5 | INFO | **25 结局点中 12 点无行为测试**（R3/R8/R10/R11/S2′a/S2′b/S2′c/S3′a/S3′b/S5′a/S5′b/S6′）——实现正确性由本轮静态逐点验证背书，但缺红灯钉死；设计 §13.7 已登记为 SA6 补测清单（非本票验收门槛——AC5 要求的五类覆盖已满足） | 建议 SA6 后续补测（DV-4 附清单）；非阻塞 |

另记（审查工件说明，非发现）：全仓套件在本沙箱两次运行均出现 2 条 `vitest-worker RPC Timeout "onTaskUpdate"`（vitest 内部栈、无应用帧、全部 129 文件/1721 测试通过）；受影响三包单独运行 exit 0 零错误——判定为满载环境工件，与本改动无关。SA3 报告的「141 文件/1800 测试」含 typecheck test-d 面，与本轮（--typecheck.enabled=false，129/1721）口径差异合理。

---

## 3. 动态审核重点（交 SA7）

以下风险点静态推演成立但需真实运行环境最终确认（SA7 在 `wiki/raw/task_root-schema-diagnostic-change-log_sa7_report.md` 逐条回复）：

- **DV-1 慢 emit 槽间延迟**：以人为延迟的 emitter（emit 内同步 sleep/自旋）装配，实测连续写场景下一槽启动延迟与 emit 耗时的耦合关系；确认 FIFO 顺序与 slot 持续窗口均不受影响（amendment C 的动态面证据）。
- **DV-2 acceptance 同步 emit 延迟**：慢 emitter 下 `close()` 后 `mutateRoot()` 拒绝路径的同步耗时（确认无隐藏 await/异步化，业务返回仍为已 settle 的 `Promise.resolve`）。
- **DV-3 unhandledRejection 抑制面**：未 await 的 fatal 写（如 `void runtime.mutateRoot(...)` 触发 R5）在装配与未装配 emitter 两种形态下，进程级 `unhandledRejection` 是否均不再触发；确认无任何生产调用方依赖该信号。
- **DV-4 未钉死结局点的运行时行为**（§13.7 清单）：R3（handle.release 后写）、R8（S4 结构不可达——若可注入）、S2′a/S2′b（SCHEMA 槽 fatal 门/notifyDirty 未绑）、S2′c（SCHEMA 槽 getStatus 抛错）、S3′b（replaceSchema 未知键）、S5′a（keep-root 不兼容）、S6′（SCHEMA 槽 notifyDirty 失败——fatal committed:true + 精确 bytes + live doc 已提交三联）——每例断言业务结果 + 记录分类与 §9 表一致；并验证 seam 校验守卫（doc 无 on/off + emitter ⇒ 构造 TypeError；真 Y.Doc ⇒ 不 throw）。
- **DV-5 CI 触发证据**：`gh run view --log` 摘录 `Test` 步收集到 `runtime-root-schema-diagnostic-red.test.ts` 的运行行（14 tests），确认 PR CI 全绿无 `vitest-worker` RPC 工件。
- **DV-6 队列满 + inputPolicy=full 组合**：capacity=1 + full 策略下第二条记录 drop 的 stats 断言（现有 AC4 用例为 digest 策略）——确认 drop 路径对 input 投影无副作用。

---

## 4. 结论

**Verdict: pass。** 实现与设计（R3 版）逐点一致；唯一偏差（emit 挂点形态）为良性改进且已记录；四层缺口（依赖/注入/发射/owned-bytes）全部按设计闭合；25 结局点映射静态穷举验证完备；事务增量真实性三重钉死（结构零整文档编码 + yjs 增量编码器 + 测试反向鉴别）；AC4 业务隔离四道防线成立并有实测；测试触发性（CI `pnpm test`）确认；SA2 两项 info 项落实确认。红线契约 14/14、受影响三包 252/252、全仓 1721/1721、双级 typecheck 全绿。SA7 按 §3 六项动态重点复验后即可闭环。
