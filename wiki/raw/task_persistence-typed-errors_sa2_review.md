# SA2 攻击评审报告 — issue #108 persistence：typed load/create 错误与 committed-aware create fatal

- **Date**: 2026-05-29（评审会话）
- **被审对象**: `wiki/raw/task_persistence-typed-errors_design.md`（567 行，首版）
- **评审人**: SA2（Reviewer / Wallfacer，全新视角，不背书 SA1/SA8 既有结论）
- **输入锚**: 任务简报 AC1–AC8；SA8 Phase 0 + 设计后复审（clear，注记 O-1/O-2 转本题重点）；ADR-0009 L56–L95、ADR-0006 修订节（#64/#79）
- **亲证材料**: lifecycle.ts / memory.ts / file.ts / contract.ts / testing.ts / index.ts / service.ts 全文；memory-persistence.test.ts / file-persistence.test.ts / file-persistence-sa7-dynamic.test.ts / sa7-supplementary.test.ts / issue-79-entry-status.test.ts / persistence-contract.test.ts / module-graph-regression.test.ts / core-dsh-boundary.test.ts；dsh probe.ts（memoryIo/S3/顶层 catch/isMetaMismatch）+ profile.ts；namespace-runtime 5 个 hook 测试的 failWrite 激活时序；tsconfig.base.json、vitest.config.ts、package.json；ADR-0006 L114–L200、ADR-0009 L50–L130

## Verdict

# **REJECT** — 1 HIGH + 4 MEDIUM 必须逐条闭合后重审

骨架判定（先说结论，避免误伤）：**核心架构是成立的**——四类型谱系与 AC1–AC8 映射、commit-fact 候选 (a)（seam 收紧）优于被否决的 (b)/(c)/(a′)、§3.3 四路径零回归论证（本人逐行复核 flush 双分支、既有 L437/L461 双覆盖、File rename 后无 throw 点）、EC1–EC9 的构造时序（含 EC5 无死锁、EC9 的 vitest 隔离与仓库先例）、§4.2.6 unhandledRejection 修复的必要性与正确性、caller 审计与 DENY 清单——这些本人全部亲证通过，见「逐维度过堂记录」。reject 的唯一硬伤是一个**可穿透公共生产 API 证伪 §3.1 自身公理的 committed 说谎窗口**（A-1），外加四条中等级收敛性修订。**不需要推翻设计骨架，修订是收敛性的。**

---

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 修复要求 |
|---|--------|--------|---------|---------|
| A-1 | **HIGH** | §3.1/§3.3/W2/W3 + memory.ts L56–L61：delegation 模型 Memory 的 `committed:false` 说谎窗口 | Memory `write = hook → abort 门 → mirror set`，而 `read = readSnapshot?.(…) ?? mirror`——**接线了 read hook 的实例里 hook store 是唯一读权威**（memory.ts L52–L55 注释自证），adapter 却把 mirror set 定义为唯一提交段。两权威错位 ⇒ 存在真实交错使「write reject + store 已可读」 | SA1 必须显式二选一（见详述），现状「保留门在 hook 后 + 散文辩护」不闭合 |
| A-2 | MEDIUM | §2.1/§2.2 分类表完备性 | 三处漏格：loadSlowPath L277 `assertReadable()` 出口无行；适配器层 validateIdentity/构造 TypeError 无行；`io.read` 同步 throw 逃逸 claim try/catch 无前置条件 | 补 3 行（零代码变更）+ §3.1 补「seam 方法不得同步 throw」 |
| A-3 | MEDIUM | §3.4 wrapIo / SA8 O-2 | wrapIo 经 `Omit<…,'scheduler'>` 自动进入两生产插件工厂签名（memory.ts L116 / file.ts L148）；ADR-0009「测试 seam 只位于受控 testing subpath」虽经亲读确系 Registry v1 公共接口条款（不构成条款违反），但本仓自有风格是把测试缝挡在生产路径外（`seedForTest` 不进包根、`createMemoryHandleForTest` 走非包路径） | 插件工厂 options 改 `Omit<…,'scheduler' \| 'wrapIo'>`（一行级）或书面论证保留必要性 |
| A-4 | MEDIUM | §7 R-5 vs ADR-0006 #64 | ADR-0006 #64 修订节明文「原始 I/O 错误**原样上抛**」；本设计改为包装（cause exact-identity）。调和依据存在（ADR-0009 §Persistence 错误演进更晚且明文授权）但 R-5 未点名该句被取代——后继读者按 0006 字面会判本实现违约 | R-5/PR 描述点名该条款的取代关系与「cause exact-identity 即新『原样』」载体 |
| A-5 | MEDIUM | §1.2 / O-1（W2 边界） | epoch current 下 seam 拒绝 ⇒ operational，含「Adapter/hook 违约部分提交后 reject」的 bug 情形。该边界**确属不可判定**（候选 (c) 已被合理否决），但该残余风险只写在 §3.4 的 wrapIo doc 里，`DocCreateOperationalError` 类型 doc 未声明 | §1.2 doc 补边界声明并与 §3.1 互指；AC6 的守恒方式（契约而非机制）显式化 |
| A-6 | MINOR | §5.3 fault-seam 伪代码 | `PersistenceHold.entered: Promise<void>`，但 `wrap.write` 草图调用 `holdBefore.entered()`（把 Promise 当函数调，不能照抄编译） | 草图改 `enteredResolve()` 或统一接口形态 |
| A-7 | MINOR | §1.3/§1.4 | 冻结映射不导出 ⇒ 外部锁定 phase↔committed 需构造实例；无共享基类 ⇒ 未来 Registry `isPersistenceError` 需枚举 4 类型 | 导出冻结映射（零风险 additive）或维持 YAGNI 但书面登记代价 |
| A-8 | MINOR | §4.6/§8 规模估算 | testing.ts +≈190 偏乐观：9 个 EC × N1–N6 全套（每例 25–40 行）+ seam ~60 + fixture 接口 ~30，现实 250–300 | 放宽为 +≈250–300，防 SA3/SA6 被行数锚绑架 |

严重度计数：**CRITICAL 0 / HIGH 1 / MEDIUM 4 / MINOR 3**。

---

## A-1 详述（唯一 HIGH，reject 依据）

### 攻击构造（全部经公共生产 options，不用 wrapIo）

MemoryPersistence 同时接线 `readSnapshot` + `writeSnapshot` 且二者委托同一个共享 store——**这正是仓库现存的「委托模型」装配**：memory-persistence.test.ts L89–L108（共享 create 套件 fixture 与 makeFresh）、issue-79-entry-status.test.ts L160–L175、namespace-runtime 5 个 hook 测试（如 runtime-mutate-root-persistence L69–77）全部如此。`MemoryPersistenceOptions.readSnapshot/writeSnapshot` 是生产 options，非测试专用。

时序（create 写段）：

1. `io.write` 进入 → `await options.writeSnapshot(key, snapshot, signal)` 执行完成 ⇒ **共享 store 已写入字节**；
2. 恰在此后，`dispose()` 被调用：同步 `closed = true; epoch += 1; abort()`（lifecycle.ts L257–L259）；
3. memory.ts 的 abort 门（`signal.throwIfAborted()`，§3.3 保留在 hook 之后）抛出 ⇒ write **reject**；
4. lifecycle 写段 catch：`isCurrent(epoch) === false` ⇒ **W3 `DocCreateFatalError('store-write', committed:false)`**，且 I-2 声明 committed「authoritative…callers can trust it and must never re-derive」；
5. **证伪**：`makeFresh()`（新实例、同 hooks、空 mirror）`loadDoc` → `read = hook ?? mirror` → 从共享 store **读回完整内容**。

结论：`committed:false` 与 store 可观察状态直接矛盾，且矛盾点恰是本 issue 存在的理由（诚实 commit 事实）。同时它违反设计 §3.1 自己立下的公理：「A `write` that rejects ⟹ the commit segment did not complete ⇒ **the store is unchanged**」——对委托模型实例，hook 的 store 从读方视角**就是** the store。

### 设计现有辩护为何不成立

§3.3 末段承认「hook 完成后 abort 才发现 ⇒ reject ⇒『hook 的副作用可能已发生但 mirror 未提交』」，但以「对 flat hook 消费方（probe 观察通道、dsh/namespace-runtime 测试 store）**无影响**」带过。逐类核验：该断言只对 **probe 模型**成立（probe.ts L114–L136 memoryIo 是「同步纯观察，零存储」，存储确在 mirror，committed:false 对 mirror 诚实）；对**委托模型**（上面五处现存装配）不成立——它们没踩中只是因为「先 settle 再 dispose」的用例纪律，这不是契约保证，是把一致性责任外包给每个未来调用方。更具讽刺性的是：**新共享套件的 Memory fixture 本身就按委托模型接线**（§5.3「flat hooks（读写委托 store）」），即新测试基础设施建在矛盾窗口所在的配置上，而套件中没有任何用例锚定该窗口。

### 修复要求（SA1 必须显式二选一，不得维持现状表述）

- **方案 (a)（推荐，彻底消除）**：把 Memory `write` 的 abort 门移到 hook **之前**（`throwIfAborted()` 提首，再 `await writeSnapshot`，再 mirror set）。此后「write resolve ⟺ hook 副作用 + mirror 均完成」在两模型下同时成立：abort-during-hook ⇒ hook 完成后**无门**⇒ mirror 照常执行 ⇒ resolve ⇒ committed:true（诚实，两处 store 都有字节）；唯一的残余不诚实是「hook 自身部分提交后 throw」，属 seam 违约，与任何 Adapter bug 同类。连带修订必须同步写明：① §5.4.2 的 revised hook（abort 时 reject）将永不触发——write 会在 hook 前以 `signal.reason`（AbortError）reject，cause 断言相应改为 AbortError 变体（恰与 EC7 的 cause 形态统一，§5.4.2 与 EC7 变为同构锚，需说明取舍）；② memory.ts dispose 注释中「the aborted-signal guard already prevents any mirror write after dispose」的不变量陈述需改写（abort-during-hook 的晚到 mirror set 发生在 `core.dispose()` 排空 inFlight 之后、`snapshots.clear()` 之前，仍被清，不可复活——需重新论证）；③ probe 观察通道语义变化（已 abort 的写尝试不再被 hook 观察到）——亲证 probe 从不在写中途 dispose，不可观察，但需在设计里写明而非沉默。
- **方案 (b)（保守，必须三件套齐全才接受）**：保留门在 hook 后，但 ①在 §3.1 契约、§1.2/§1.3 类型 doc 里把 `committed` 的事实域显式限定为「adapter 自有提交段（Memory=mirror set / File=rename）」，明文声明委托模型下 hook 的部分副作用不在保证内；②`writeSnapshot` 的契约义务从「abort 时不得 resolve」扩为「不得部分提交后 reject」；③新增红灯用例钉死该窗口的现状分类（慢 hook：hook 内 await deferred → 完成 store.set → 测试再 dispose → 断言 `committed === false` 且 `makeFresh().loadDoc()` **非 null** 这对矛盾被显式接受/或按 (a) 后为 committed:true），防止未来无声漂移。

方案 (a) 与 (b) 的取舍（cause 形态、观察通道、dispose 不变量重述）是设计决策，SA1 必须写出对照表并选择；「不裁决、只重复现状散文」= 修订不闭合。

### 红灯测试思路（对应 A-1）

`memory-persistence.test.ts`（或共享套件内）：delegation fixture（同 L89–L108 形状）+ `writeSnapshot = async (k,s) => { await gate1; store.set(k, s) }`。`createDoc`（不 await）→ `await gate1 释放后的微任务` → `fixture.dispose()`（不 await）→ `await createDoc` 收 rejection → 断言 `err.committed === false` 时 `makeFresh().loadDoc(owner, docId)` 必须 `toBeNull()`。现状该断言失败（读到内容）——即红灯；方案 (a) 下变 `committed:true` + 读到内容，绿灯自洽。

---

## 逐项攻击维度过堂记录（含本人亲证通过项）

### 1. 分类表完备性/正确性（§2 vs lifecycle.ts 原文）

**通过项（亲证）**：
- load 侧：L0（L154 入口）/ L1（routeOwnedRead L364 ReadError 分支）/ L2（L360–L363 stale 首分支）/ L3（restoreAndValidate L395–L404）/ L4（L148 + L280–281）与代码逐点对应；**所有 load 拒绝都流经 `completion` 单点**（resolveLoad L295–L307 三分支：live 直返 / creating 等 claim.promise——该 promise 是 `op.then(()=>undefined,()=>undefined)` **永不 reject** / reading 等 completion）⇒ L1 的单点包装成立，EC1「同一实例 Reject 全体」构造时序亲证成立（两个 loadDoc 同 tick 调用，第一个同步跑完 `startReadTicket` 的 `cells.set('reading')` 后才返回 pending，第二个必走 reading 分支）。
- create 侧：R1/R2 覆盖 L175 与 L182 两个 `await rawPromise` 位点（含 load-started ticket 被 create 消费的场景）；R3 覆盖 L176/L183 `assertCurrentEpoch`；W1/W2/W3/W4/W5 覆盖 op 内 L195–L200 三段；C1 三判定（L169/L170/L177/L184）全在写路径之前；C2 守卫（L202–L205）逐字。W5「实际不可达」核实（createEntry 纯对象字面量 + Map.set + Set.add + WeakMap.set，无非 OOM 异常源）。
- **epoch current/stale 判别可行性：成立**。`abortController.abort()` 全文件仅 dispose 一处（L259），且 dispose 同步先 `closed = true; epoch += 1` 再 abort ⇒ 任何 abort 致使的拒绝必然 `isCurrent === false`；反之 store 真实失败（epoch 未变）必 current。R1 vs R2、W2 vs W3 的判别无时序漏洞。同因「先 bump 后 abort」，§3.3 的关键事实链成立。
- create-started ticket 拒绝时的**双通道各自单次包装**（driver→completion 变 `DocLoadOperationalError`，claim→rawPromise 变 create operational/fatal）互不重复包装，且正是 §4.2.6 需要修的场景。

**不通过项**：A-2 的三处漏格（L277 `assertReadable` 出口、适配器层 identity/TypeError 出口、`io.read` 同步 throw 理论逃逸）。均为「保持裸传/补契约」级修订，零代码行为变更，但表格自claim「格点完备、无漏网裸传」，SA4/SA6 会以该表为回归基线——必须补齐。

### 2. commit-fact 裁决（§3）四路径攻击

- **(a) flush 可观察差异**：亲证等价。旧（aborted write resolve）走 try 段 `if (!isCurrent) return`，新（reject）走 catch 段同守卫——两分支均：savedGeneration 不推进、degraded 不置位、scheduleRetry 不触发（其自身还有 `this.closed` 守卫）、finally 段 `!isCurrent` 早退使 `entry.flushing` 残留 true（两分支相同，且 cell 已被 dispose 拆除、`startFlush` 有 closed 守卫，残留不可观察）。注意一个亲证细节：catch 段 `return` 使 flush promise **resolve**（吞掉 rejection）——这是现状既有行为且 `startFlush` 已挂 `.catch(()=>{})`，I-4「flush 不变」覆盖。设计引用的既有双分支覆盖属实：memory 测试 L437（hook reject 路径）与 L461（hook resolve-on-abort 路径，正是唯一受 seam 收紧影响的形态）断言均为 timers 0 / status disposed，两分支同结局。
- **(b) hooked write 部分提交**：⇒ A-1（唯一实质反例，probe 模型豁免、委托模型击穿）。补充亲证：新共享套件 Memory fixture（§5.3 接线说明）即委托模型。
- **(c) File rename 在途 abort**：亲证 `writeCommittedSnapshot`（file.ts L108–L116）`throwIfAborted`×3 全在 `fsp.rename` 之前、rename 是函数最后一条语句且不接收 signal ⇒ **不存在 post-rename reject 窗口**；「reject ⇒ 未提交；resolve ⇒ 已提交」对 File 结构性成立（部分写残留在 `.tmp` 不属 committed 内容，read 路径会清扫——sa7-dynamic L83–131 既有锚）。abort-during-rename ⇒ rename 完成 ⇒ resolve ⇒ W4 committed:true，分类诚实；不可确定性构造的声明（R-1）与 EC5 在 wrapIo 层锚定同一分类逻辑的替代策略成立。`mkdir` 在门 2 之前无 signal 也无碍（失败 ⇒ reject ⇒ 未写 tmp ⇒ 未提交）。
- **(d) wrapIo 生产误用**：⇒ A-3。ADR-0009 L114 等价条款经亲读确系「Registry v1 公开」节的公共接口条款（SA8 O-2 定性正确，非条款违反）；但 `Omit<…,'scheduler'>` 使 wrapIo 自动落入两生产插件工厂签名，与本仓 `seedForTest`/`createMemoryHandleForTest` 的挡板风格相悖。候选 (b)/(c)/(a′) 的否决论证本人复核均成立（(a′) 否决正确保护了 probe 观察通道——probe memoryIo 零存储、存储在 mirror）。
- **§3.3 第二行「Memory create 写段」行为演进点**：亲证无既有测试断言旧字面——`grep 'createDoc rejected'` 全仓仅 lifecycle.ts L538 一处（src），无任何测试断言；共享套件 dispose-race 用例（testing.ts L580–612）断言的 settlement 非 TestTimeoutError / instanceof Error / pending 0 / 后续 /disposed/ 在新分类（DocCreateFatalError extends Error）下全部保持。

### 3. W2 边界（O-1）

- 「write 在 abort 后 reject 但 lifecycle 尚未察觉」：**证伪不可能**——signal 唯一 abort 源是 dispose，而 dispose 同步先 bump epoch，故不存在「aborted-致-拒绝 + epoch current」交错；自定义 hook/adapter 出于自身理由抛 AbortError 形态的错误归 operational，属合理的 store 级信号。
- 「hook 部分提交后 reject 归 operational committed:false 是否违反 AC6」：AC6 针对的是 **unknown** exception 不降级；seam 拒绝在 Persistence 边界上就是 store 失败信号，生命周期确实无法区分「运营失败」与「Adapter bug」（重读验证已被候选 (c) 以 TOCTOU 合理否决）。**定性：可接受的边界选择，非伪降级**（corruption/integrity/disposed 均保持 loud 裸传，无 bug 被降级掩盖）。但残余风险目前只活在 §3.4 的 wrapIo doc 里 ⇒ A-5 要求写进 §1.2 类型 doc。

### 4. 类型谱系

**通过项（亲证）**：
- own-enumerable 论证成立：tsconfig.base.json `target: ES2022`（未显式设 `useDefineForClassFields`，默认 true）；既有 `DocDuplicateError.code` 同模式已被 testing.ts L272 `toMatchObject({ code: 'DOC_DUPLICATE' })` 绿测锚定。`cause` 声明 + 构造器赋值路径同样产生 own-enumerable 属性，N1/N2 可断言。
- `JSON.stringify(err)` 泄漏面核实：序列化结果为 `{name, code, (phase, committed,) cause:{}}`——Error 型 cause 的 own-enumerable 为空 ⇒ 不泄漏文本；`stack` 不含 cause 文本。R-2（非 Error cause 的裸字符串会泄漏）设计已自登记并界定为内部观察面 + Registry 脱敏职责（ADR-0009 L95 属 Registry 公共面条款，亲读属实），可接受。
- 四 code 字面量互斥、I-1（`committed:false` 字面类型 + 唯二构造点）与 I-2（committed 由冻结表唯一派生）的机制成立。
- Repository 先例：`RuntimeWriteFatalError` 已有 `toMatchObject({ committed: true })` 断言（runtime-acceptance-fullchain L369/L596）——Persistence 层加入同字段约定与仓库现状一致，且两词表（Persistence 四值 vs Registry 三值）零词面重叠亲证成立。

**不通过项**：A-7（冻结映射不导出 / 无共享基类的小代价，MINOR，可维持 YAGNI 但需登记）。

### 5. 测试规格（§5）可实施性 — EC1–EC9 逐条

**通过项（亲证）**：
- **EC1**：两个并发 load 共享 ticket 的构造时序成立（见维度 1）；`failNextRead` 单发槽 + reading cell 自愈（routeOwnedRead ReadError 分支 `cells.delete`）⇒ heal 重试成立。
- **EC2**：`writeCommitted` 直写错 META 字节 → restoreAndValidate 裸 `/META\.docId/`（memory L395 / file L301 既有同款断言锚）；两 fixture 读权威均覆盖（Memory=hook store、File=真实文件）。
- **EC3/EC4**：单发槽时序无歧义；EC4 同时回归 §4.2.6（vitest 默认对 unhandled rejection 判败——亲证该 latent bug 今天真实存在：create-started ticket 拒绝且无 load 等 completion 时 `completion` 裸拒）。
- **EC5 无死锁**：亲证时序链——`fixture.dispose()` 的同步段（closed/epoch++/abort/cells.clear）在返回 pending promise 前完成 ⇒ `hold.release()` 后 write resolve → op 的 `assertCurrentEpoch` 抛 → op reject → `Promise.allSettled([...inFlight])` 放行 → `await d` 完成；`release()` 在 `await d` **之前**同步调用 ⇒ 无「dispose 等 inFlight、gate 等 release」的循环等待。`doc.isDestroyed === false` 成立（create 失败路径从不销毁调用方 doc；dispose 只销毁 live cell 的 doc，EC5 的 creating cell 被 cells.clear 无销毁）。
- **EC6**：`holdNextReadThen(undefined)` 后 `assertCurrentEpoch` 抛 → R3 `'probe-read'`；同场景 completion 被 driver 以裸 disposed 拒（routeOwnedRead stale 首分支）⇒ 恰好二次锤炼 §4.2.6。
- **EC7**：wrap 的 `signal.throwIfAborted()` 自查在真实 io 之前 ⇒ Memory 委托 store 无字节 / File 无 `.snapshot` 成立（该自查正是设计 §5.3 注释里点名的必要性——防 flat hook 先写共享 store 制造矛盾；这与 A-1 是同一矛盾的两个面：seam 替测试挡住了，生产 Memory 自己的门却挡不住 hook ⇒ 进一步佐证 A-1 应修）。
- **EC8/EC9**：EC9 的隔离性亲证成立——vitest 3.2.4、vitest.config.ts 未覆写 pool/isolate（默认 forks + per-file module registry，module-graph-regression.test.ts L14–15 注释自证「Vitest keeps a per-file module registry」）；且 `vi.mock(…, importOriginal)` 部分 mock 在本仓有绿测先例（vfsl compile-schema-envelope L60 / docscope-getcompiled L90，同样 mock 单导出保留其余）。R-3 回退方案合理。
- **§5.4 三处修订均加严不减弱**：亲证 5.4.1（toContain→instanceof+committed+cause toBe+not.toContain，且保留 store.write 注入与「无 stale claim 重试」断言）；5.4.2 四条原断言全保持（DocCreateFatalError instanceof Error 成立）；5.4.3 保留 tmp 留存与 chmod 痊愈断言、升格为真实 errno→operational 包装锚。另亲证「无第 4 处遗漏」：全仓 grep 'io down'/'disk unavailable'/'EACCES'/rejects.toThrow 后逐处核对——issue-79 双套件、namespace-runtime 各 'io down (deterministic)' 注入**全部是 flush 路径**（saveDoc/degraded）或 createDoc 前未激活（runtime-mutate-root-persistence L139–141 `failFlush=false` 时 create，之后才置 true；degraded-two-adapter 同构）；sa7-supplementary 只有 duplicate 通道；persistence-contract.test.ts 无失败通道断言。⇒ DENY 面零改动声明成立。

**不通过项**：A-6（seam 草图 `entered()` 调用与接口定义矛盾，SA3「照抄级」规格不能自洽）；A-8（规模估算）。

### 6. §4.2.6 unhandledRejection 修复

**亲证通过**：`completion.catch(()=>{})` 挂在 deferred 本体上——原 promise 获得 rejection handler ⇒ 不再触发进程级 unhandledRejection；已有/后来的 await 方观察不变（handler 派生的新 promise 被丢弃，不影响他人）。resolve 路径无事件。**其他 deferred 同类问题排查（无）**：`claim.promise = op.then(()=>undefined,()=>undefined)` 永不 reject；`startFlush` 有 `.catch(()=>{})`；`track` 的 `.then(双分支)` 只做 Set.delete 不 throw；`driver.then(settleOnce, rejectOnce)` 派生 promise 的 handler 仅调 deferred 函数不 throw；create/load 的 op 由调用方 await 或 dispose 的 allSettled 消化。修复必要（EC4/EC6 必踩）且充分。

### 7. 行为不变量（§6）与 caller 审计（§10）

**亲证通过**：
- `grep -rn "loadDoc|createDoc" --include=*.ts`（排除 persistence 包与测试）：生产消费点**仅 dsh-persistence/src/probe.ts**（L219 create、L228 load、L372 duplicate、L388 meta-mismatch）＋ profile 装配；namespace-runtime 命中全为注释。§10 行号逐一对上（L175/L182/L196/L351/L364/L461）。
- probe 零改动亲证：memoryIo 仅 writeSnapshot 纯观察（零存储）；唯一失败注入 'probe-injected flush failure' 走 **flush-degraded** 路径（设计不改）；duplicate 走 `instanceof DocDuplicateError`（不变）；meta-mismatch 走 `isMetaMismatch` message 正则（C0 裸传不变）；顶层 catch（L508）不做 message 匹配，仅 ProbeFailure/ProbeTimeoutError 分型；load 通道 probe 从不注入读失败。⇒ DENY `packages/dsh-persistence/**` 成立。
- §6.2 裸字面与现有测试吻合抽查：'persistence is disposed'（memory L416/L434/L547、file L386、共享套件 L610–611）、'foreign or released DocHandle'（memory L143/L154、issue-79 L302–311）、META 双字面（memory L395、file L301、共享套件 L547/L553）、`/restore aborted|disposed/`（memory L415，L2 行引用属实）、'persistence integrity:*' 仅 src 无测试断言（保持裸传无回归面）。
- index.ts 追加 `PersistenceIO` 再导出不破坏两静态守卫（亲读：module-graph 只禁「非 index 的 src 反 import barrel」与 host-global timer API——testing.ts 豁免、新增代码无 timer；core-dsh-boundary 锚依赖方向与 manifest，不涉导出面）。

**不通过项**：A-4（ADR-0006 #64「原样上抛」条款张力未在 R-5 点名）。

### 8. ALLOW/DENY 与规模

- ALLOW 清单文件集合与理由核对无误；`file-persistence.test.ts`（fixture 接线）、`file-persistence-sa7-dynamic.test.ts`（L115 断言亲证为该用例）必要且充分；sa7-supplementary / persistence-contract / issue-79 双套件确无需进入 ALLOW（维度 5 已证）。
- **没有该改而被 DENY 的文件**：`packages/dsh-persistence/**` 保持 DENY 正确（probe/profile 零改动亲证）；`docs/adr/**` DENY 与 A-4 的处置兼容（A-4 要求的是 PR 描述/设计内登记，不是改 ADR 正文）。
- 规模：lifecycle +≈45/−≈12 现实（契约注释 + import + claim 双位点 try/catch + 三段式 catch + L1 一行 + completion 守卫）；testing.ts 偏乐观 ⇒ A-8。

---

## 协议假设依据审查

§9 章节存在，三条依据逐条可验证、无「应该/通常」类无据推断：①`throwIfAborted` 可用——file.ts L110/L112/L114 现有调用（亲证在案）；②chmod EACCES 行为——file-persistence-sa7-dynamic L109/L115/L169 现绿用例（亲证在案）；③useDefineForClassFields/own-enumerable——tsconfig.base.json `target: ES2022` 亲证 + `DocDuplicateError.code` 绿测先例（testing.ts L272 亲证）。**通过**（SA4 可按引用重跑复核）。

## 错误处理链路审查

- **静默失败**：无新静默面；反而修复一个现存静默雷（create-probe-read 拒绝的 completion 裸拒 ⇒ 进程级 unhandledRejection，§4.2.6）。
- **状态闭环**：C2 claim 清理守卫逐字保留，对所有新分类/裸传/duplicate 一致；EC 断言 `doc.isDestroyed === false` / `scheduler.pending()===0` / store 空态闭环。
- **降级路径**：saveDoc/flush/degraded→retry 全不动（I-4），§3.3 flush 双分支迁移亲证可观察等价。
- **虚假降级识别**：corruption（L3）/integrity（L4）/disposed（L0/L2/C0）全部保持 loud 裸传，无 bug 被降级掩盖；唯一「降级味」的 A-5（Adapter bug ⇒ operational）经分析属边界不可判定 + 契约化守恒，非伪降级，但要求类型 doc 显式声明边界（A-5）。
- **A-1 即最大的「错误事实不诚实」问题**：committed:false 在可构造交错下说谎——这正是本 issue 要消灭的那类不诚实，只是从 message 猜测换成了字段级。

## 红线测试思路汇总

| 攻击点 | 红灯测试方向 |
|---|---|
| A-1 | delegation fixture + 慢 writeSnapshot（hook 内 await deferred）→ hook 完成 store.set 后 dispose → 断言 `err.committed === false` ⇒ `makeFresh().loadDoc()` 必须 null（现状红灯：读到内容）；方案 (a) 下改锚 `committed:true` + 读到内容 |
| A-2 | 不需新红灯（补表 + 契约句）；可选：loadSlowPath L277 出口的裸 `/disposed/` 锚（load 读已 resolve 但 dispose 先于续体） |
| A-3 | 可选静态锚：`createMemoryPersistencePlugin` 的 options 类型不接受 wrapIo（typecheck 级 test-d） |
| A-5 | 共享套件补一条「违约 io（写后 reject）」的 out-of-contract 说明性用例或显式 skip-with-reason，防止后人当 bug 报 |
| A-6 | EC 全套即红灯；草图修正后 SA3 照抄编译通过本身即锚 |

## SA1 修订必须逐条闭合的清单（reject → 复审入口条件）

1. **A-1（HIGH）**：按方案 (a) 或 (b) 显式裁决，产出对应的三件套（(a)：门位置 + §5.4.2 cause 形态调整 + dispose 不变量重述 + probe 观察通道说明；(b)：事实域限定 doc + hook 义务扩写 + 窗口钉死红灯用例）。修订须更新 §2.2 W3 行、§3.1、§3.3、§5.3 fixture 注释与 §8 规模。
2. **A-2**：§2 表补 3 行（L277 出口 / 适配器 identity 出口 / seam 同步 throw 前置条件进 §3.1）。
3. **A-3**：插件工厂 `Omit<…,'scheduler'|'wrapIo'>` 或书面论证；同步更新 §3.4 与 §10。
4. **A-4**：R-5 点名 ADR-0006 #64「原始 I/O 错误原样上抛」的取代关系与 cause 载体表述。
5. **A-5**：§1.2 类型 doc 补 seam 边界声明并与 §3.1 互指。
6. **A-6/A-7/A-8**：草图自洽修正；冻结映射导出或 YAGNI 登记；规模估算放宽。

（A-2～A-8 均为收敛性修订；A-1 允许两种方案任选，但「维持现状表述」视为不闭合。）
