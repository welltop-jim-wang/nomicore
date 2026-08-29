# SA2 攻击评审报告 — Issue #149 ROOT/SCHEMA 诊断变更日志接线

**Date**: 2026-08-29（R0 首审）/ 2026-08-29（R1 复审）/ 2026-08-29（R3 复审，见文末「R3 复审」节）
**Reviewer**: SA2（独立全新视角；未参与 SA1/SA5/SA6/SA8 任一环节）
**被审对象**: `wiki/raw/task_root-schema-diagnostic-change-log_design.md`（SA1；R2 修订版——事务增量重放契约修正）
**约束基准**: `task_root-schema-diagnostic-change-log_relevant_decisions.md`（ADR-0011/0012/0008/0007/0006/0009 摘录 + 设计后复审追加）
**Verdict（现行，R3 复审）**: **pass（附 1 项须修正的规格笔误 R3-1）**——R2 的事务增量重放契约修正经 SA2 独立实验逐项复证成立（含 38 bytes 细节精确复现），producer 侧 ADR 事务增量语义保真，§13.8 SA6 测试修订规格机制有效；唯 §13.8c 调用点普查数字错误（「4 处 it、5 个调用」实为 **3 处 it、4 个调用**），属授权条款精度缺陷，须随 SA6 执行前修正。历轮记录：R0 reject → R1 pass → R2 交 R3（本节）。

---

## 0. 审查方法与独立验证范围

不采信设计文档任何自述，逐条对 worktree 源码复核：

| 设计声称 | 复核命令 | 结果 |
|---|---|---|
| L1 缺口（runtime 无诊断包依赖） | `cat packages/namespace-runtime/package.json` | ✅ 属实（仅 doc-runtime/persistence/vfsl/yjs） |
| P1/P2/P4：yjs 事务 update 事件同步派发、payload=事务增量、hasContent 守卫、cleanup 在 transact 调用栈内 | `sed -n '250,470p' node_modules/.pnpm/yjs@13.6.32/.../Transaction.js` | ✅ 属实（`cleanupTransactions` 在 `transact` 的 `finally` 内同步执行；update emit 位于 observer try/finally 的 finally 续段——observer 抛错不跳过 update emit） |
| P3：Doc.js:172-181 事务捆绑注释 | 同上目录 `Doc.js` | ✅ 属实 |
| P5：sequencer 注册序 | `cat packages/namespace-runtime/src/sequencer.ts` | ✅ 属实；§7.1 FIFO/emit 顺序证明经本人独立微任务队列推演确认成立（见 §2.1） |
| 单事务断言（两槽恰一次 transact） | `cat packages/doc-runtime/src/mutation.ts`、`schema-replace.ts` | ✅ 属实；**且事务体为 clear+全量重写**（`rootMap.clear()` + 全 entries set；SCHEMA clear+恰四次 set）——这是红灯「fresh Y.Doc 可重放出未变更键（ROOT.a='x'、SCHEMA.id）」断言成立的机制前提，设计未明说但成立 |
| P6：memory adapter queue-full / drop / stats / updateCapture | `sed -n '150,379p' .../adapters/memory.ts` + `pipeline.ts` | ✅ 属实 |
| 25 结局点穷尽性 | 本人对照 `write.ts`/`schema-write.ts` 逐 return/throw 枚举 | ✅ 穷尽（ROOT 13 + SCHEMA 12，含公共接纳层） |
| §15 caller 审计（无直接槽调用） | `grep -rn "runRootWriteSlot\|runSchemaWriteSlot" --include="*.ts" packages/ \| grep -v src/` | ✅ 仅两处负向导出断言 |
| 稳定码/phase 全部匹配 `RE_STABLE_CODE = ^[A-Za-z0-9_.:-]{1,128}$` | 对照 `schema-patterns.ts` 与 §9 全部 code/sourcePhase 取值 | ✅ 全部通过 intake Pattern |
| `toIssueSummary` 码派生（SCHEMA_TEXT_INVALID / SCHEMA_ENVELOPE_*） | `p0.ts:134-148` | ✅ 属实 |
| `projectInput` 事实优先于策略（not-accessed 在 full 策略下保持） | `projection/input.ts:53-96` | ✅ 属实 |
| code↔sourceModule 成对性由管线保证 | `pipeline.ts:239-251` | ✅ 属实 |

---

## 1. 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议（可执行修订要求） |
|---|--------|--------|---------|------|
| 1 | **CRITICAL** | §5.2 构造期 loud-assert 检查了**错误的对象** | 伪代码 `if (typeof h.on !== 'function' \|\| typeof h.off !== 'function') throw` 中 `h` 是 `captureSeamInput` 里的 **handle 记录**（runtime.ts:331），而注释与报错文案均说「**handle.doc** 必须具备 on/off」。`DocHandle` 契约（`packages/persistence/src/contract.ts:16-30`）只有 `owner/docId/doc/getStatus/release`——**没有 on/off**。SA3 照抄伪代码 ⇒ 任何装配 `diagnosticEmitter` 的构造（包括红灯套件全部 14 例的 `makeRuntime`，含 Proxy handle 例——`h.on` 经 Reflect.get 透传得 undefined）都在构造栈 loud throw ⇒ **14/14 永远红**，整轮实施报废。 | 把校验对象改为 `doc.on`/`doc.off`（`doc` 局部量在 runtime.ts:353 已捕获，分支落位处可用）；§8.1 伪代码 `diag.updateBytes = captured` 同族精度问题（`diag?: SlotDiag` 下不可选链赋值，strict TS 直接编译错）一并修正为 `if (diag !== undefined) diag.updateBytes = captured` 形态。修订后须在 §5.2 显式写明「校验对象是 handle.doc（Y.Doc 事件面）」并消除 h/doc 混用。 |
| 2 | **HIGH** | §7.3/§8.1 `emitSlot` 缺省组装规则**无机制防御、且可伪造 committed 事实** | 规则：「`outcome === undefined` 且业务 fulfilled ⇒ 缺省组装 transaction + committed」。两个洞：(a) `MutateRootResult`/`ReplaceSchemaResult` 的 **ok:false 领域拒绝是 resolve 不是 reject**——「fulfilled」包含全部业务拒绝；25 结局点中只要 SA3 漏写一行 `diag?.…`（红灯只覆盖 14/25，R3/R8/S2′b/S3′b/S5′a/S6′ 等未被测试钉死），缺省组装就会把一次**业务拒绝伪装成 committed 记录**——这正是本任务 Objective「Operators must be able to distinguish committed updates … expected rejections」要消灭的错误类别，且违反 ADR-0011 §B「日志层不得发明……成功语义」的语义诚实红线。设计的理由「拒绝原因不在返回值里，无法反推」混淆了 reason（message 文案）与 outcome（`r.ok` 判别）——**`r.ok` 就在 emit 点的返回值里**（onOk 回调参数）。(b) `outcome === undefined` 且业务 **rejected**（fatal rejection）：§7.3 裁决表对「业务 rejection + 无 outcome」**未定义任何行为**，SA3 只能自由发挥（跳过 emit？committed？崩溃？）。 | 修订 emitSlot 契约：① 签名带入结算事实——onOk 传 `(r)`、onErr 传 `(e)`；② 缺省组装**仅当 `r.ok === true`** 生效；③ `outcome === undefined && r.ok === false` 或 business rejection ⇒ 亮式内部不变量处理（不 emit 该记录 + 源码注释锚点；本票无 producer 健康通道，SA8 已裁观察项），**绝不**缺省 committed。该修订把「25 点映射表完备」从纪律约束升级为结构保证，成本约 5 行。 |
| 3 | **MEDIUM** | §9 映射表：gate/acceptance 拒绝记录省略 `issues`，与 ADR-0011 §B 保真条款不一致且无裁决记录 | ADR-0011 §B：「每条结局记录保留所属模块已有的稳定 code、phase、**issues 顺序**与 committed 事实」。业务面 `disabled()` 返回结构化 `issues:[{message:'RUNTIME_WRITE_DISABLED: …', path:[]}]`；设计对 R1–R4/S1′–S2′b（及 R5/R10/R12 等 fatal 面）只保留顶层 code、丢掉 issues 列表，而对 R6/R7/R9/S4′a 又透传 issues——同类结局两种保真度，且设计未记录省略理由。红灯契约两可（未断言 gate 记录的 issues），SA3/SA4 无据可依，实现必然漂移。 | 二选一并写入 §9：a) gate/acceptance/fatal 记录同样透传业务返回的 issue 数组（`{message,path}`，与公共联合同源）；或 b) 明文裁决「code+sourceModule 已承载分类，issues 通道仅领域校验面使用」并给出 ADR-0011 §B 措辞的相容性论证。禁止留白。 |
| 4 | LOW | §4 与 §13.1 依赖叙述自相矛盾 | §4：「本包对它只做 type-only import……无模块副作用引入」；§13.1：「`observedAtFrom` 也可……直接值引入」。值引入经诊断包 `index.ts` 会在运行期拉入 reader.ts/file.ts 等大模块运行图（纯函数、无副作用，但「无模块副作用引入」表述失真）。 | 二选一：本地实现 3 行 `new Date(now()).toISOString()`（维持接口级依赖叙述）；或修正 §4 措辞为「值级依赖 = `observedAtFrom` + `emitter.emit`，均纯函数」。 |
| 5 | LOW | `clock` 缺省 `() => Date.now()` 留下静默墙钟形态 | 「装配 emitter 而不注入 clock」的组装静默走系统时钟。SA8 冲突点 #4 已裁「不辖本票（生产面不可达）」并移交 Registry 票——非冲突，但设计可用与 §5.2 同族的一行 loud 校验（提供 `diagnosticEmitter` 而缺 `clock` ⇒ 构造期拒绝）彻底消除该形态；红灯套件全部诊断用例同时注入 clock，不受影响。 | 建议随 #1 修订一并考虑（非阻塞；若不做，须在 §5.1 显式登记该形态的边界注记，与 SA8 移交项呼应）。 |
| 6 | LOW | 「无日志基线行为逐字节不变」表述过强 | `.then(emitOk, emitErr)` 挂点使**所有**写调用（含未装配 emitter 的生产基线）返回的 promise 身份改变（settled → 派生 promise）且结算多一跳微任务。对 await 消费者行为等价，但不是「逐字节不变」；时序敏感的既有测试（runtime-close-* / runtime-close-sa7-dynamic 等）是回归风险点。 | 修正 §2 D-C/§11 措辞为「行为等价（await 消费者可观测面不变）」；SA4 验收必须含全量 namespace-runtime 套件零回归（§13.5 已列，SA4 复核执行）。 |

### 不成立的攻击（已尝试并排除，供 SA4/SA7 复用）

- **emit 顺序 vs FIFO**：独立推演微任务队列——`settled` resolve 时依注册序入队 `[noop, emit]`；下一任务 `run` 挂 `tail`（`settled.then(noop)` 产物）之后，其 job 在 noop 执行时才入队 ⇒ 队列序恒为 `[emit, run₂]`。emit 顺序 ≡ 槽完成顺序 ≡ FIFO 成立；close barrier 同理（barrier thunk 恒晚于前一写的 emit）。设计 §7.1 证明正确。
- **fresh-doc 可重放断言**（红灯最硬的断言）：`applyValidatedMutation`/`replaceSchemaAndRoot` 事务体为 clear+全量重写，update 增量含全部键的 insert 内容 ⇒ 空 doc 上 `Y.applyUpdate` 可重放出未变更键（ROOT.a='x'、SCHEMA.id='ns-1'）——机制成立，D-B 可满足红灯。
- **S5 fatal 路径 bytes 保留**：update emit 在 transact 调用栈内、throw 之前完成；finally 退订不影响已捕获值。✅
- **敌意 accessor 零执行**：`copyFrozen` 对象分支 per-key descriptor 扫描（`ownDataFact` accessor 拒绝）先于任何值读取；unsafe-input emission 不回读原输入。✅
- **AC5 Proxy 零额外读取**：S3 后诊断只消费 frozen 副本（`snap.value`），jcs/digest 均作用于副本。✅
- **`exactOptionalPropertyTypes`/`verbatimModuleSyntax` 与 seam 加法字段**：测试经 `Record<string,unknown> as never` 装配，无类型面破坏；index.ts 不 re-export seam，公共导出面零变化。✅

---

## 2. 协议假设依据审查（技能立法项）

- **章节存在**：§14 存在，含 7 条假设（P1–P7），无网络端口/进程生命周期类假设需要另立章节。✅
- **依据可验证性**：P1/P2/P4 给出 yjs@13.6.32 `Transaction.js:362-367` 源码引用——本人已重读该文件确认逐字属实（含 `if (hasContent)` 守卫与 `encoder.toUint8Array()` 新分配）；P3 引 Doc.js:172-174 公开注释——属实；P5 引 sequencer.ts:38-42 + ECMAScript PromiseJobs——属实且本人独立推演复核；P6 引 memory.ts/pipeline.ts 行号 + #156 测试——属实；P7 类比既有 workspace 依赖——成立（同仓四条 `workspace:*` 同机制）。
- **「应该/通常/预计」类无据推断**：无。全部为源码引用/规范引用/既有测试引用。
- **结论**：协议假设依据审查 **通过**。SA4 可按引用行号重跑复核（本报告 §0 表已给出命令）。

## 3. 错误处理链路审查（技能立法项）

- **静默失败**：producer 侧吞没 emitter throw / 违约 clock / 队列满是 ADR-0011 §A 授权的隔离（非静默失败）；**真正的静默失败向量是攻击点 #2**——漏写 outcome 点时缺省组装静默产出伪造 committed 记录，且无测试可捕获（红灯未覆盖全部 25 点）。#1 的故障形态相反（loud 爆炸、全套件立红）——不是静默失败但属实施级死路。
- **状态闭环**：每条结局路径 → 恰一条 attempt record；记录存在性由红灯 `waitAttempts` poll 闭环；业务面四不变（返回值/FIFO/dirty/capability）由 AC4 两例闭环。✅（前提是 #1/#2 修复）
- **降级路径**：adapter 队列满 → drop newest + stats（AC4 锚点）；VFSL validation failure → 丢 record + 健康事件（adapter 侧既有测试承担，ADR-0012 验收门槛 6）；File adapter 未装配（本票 memory 面）。✅
- **虚假降级识别**：设计整体贯彻 loud-assert 哲学（doc 事件面缺失 loud、notifyDirty 未绑 loud、畸形 ok:true loud）——方向正确；**#1 恰是 loud-assert 写错对象**（意图 loud、实现全杀）；「fatal committed:true 零 bytes → effect unknown」是诚实上报而非虚假降级；#5（clock 缺省墙钟）是唯一接近静默降级的形态，SA8 已裁非冲突、移交 Registry 票。

## 4. 红线测试思路（每漏洞对应）

1. **#1（CRITICAL）**：
   - 存量守卫：现有 14 例红灯套件本身就是「emitter + 正常 handle 不得构造期 throw」的集成守卫——修复后 14/14 绿即隐含断言（SA4 须确认不是绕过校验得绿）。
   - 新增 IT：`createNamespaceRuntimeWithSeam({ handle: {…极简 fake, doc: 无 on/off 的对象}, diagnosticEmitter, clock })` → `expect(() => …).toThrow(TypeError)`（loud 语义仍在）；对照 `handle.doc` 为真 Y.Doc → 不 throw。两例钉死「校验对象 = handle.doc」。
2. **#2（HIGH）**：补 25 点中红灯未覆盖结局点的行为断言（每例同时断言业务结果与记录分类）：
   - R3：`handle.release()` 后写 → capability-gate / RUNTIME_WRITE_DISABLED / rejected / not-accessed；
   - R8：注入使 `schemaState` 异常不可达（或以 'unavailable'+activeTools 脏态 seam 组合）→ capability-gate / fatal committed:false；
   - S2′b：SCHEMA 槽 notifyDirty 未绑 → capability-gate / not-accessed；
   - S3′b：`replaceSchema({ schema, 未知键 })` → validation / rejected / input digest；
   - S5′a：keep-root 与新 schema 不兼容（当前 ROOT 校验失败）→ validation / rejected / 零写入；
   - S6′：SCHEMA 槽 notifyDirty 失败 → dirty-notification / fatal committed:true / effect update（fresh-doc 重放）；
   - S2′c：SCHEMA 槽 getStatus 抛错（Proxy handle armed）→ capability-gate / NSRT-FATAL-SCHEMA-WRITE-INTERNAL / fatal committed:false / not-accessed。
   - 机制守卫（结构性）：任一 ok:false 业务结果对应的记录 `result.kind !== 'committed'`——若 SA1 采纳「缺省组装仅 r.ok===true」修订，上述断言对漏写 outcome 点自动变红。
3. **#3**：对 acceptance/capability-gate 记录断言 `rec.issues` 存在且与业务返回 issue 同源（或按最终裁决冻结省略）。
4. **#6**：SA4 验收清单固定「全量 namespace-runtime 套件 + typecheck 零回归」，重点 runtime-close-lifecycle / runtime-close-sa7-dynamic / runtime-p0-sequencer。

## 5. 结论

设计的主干（D-A 发射点、D-B owned bytes 捕获、D-C 可选 diag 通道、25 点冻结映射、四道隔离防线）经独立攻击后**全部站得住**：FIFO/emit 顺序证明、yjs 协议假设、事务增量可重放性、输入零额外读取、词表保真均复核属实——SA8 `clear` 裁决与本审查结论一致。

但 **#1（loud-assert 校验对象写错，照抄即全套件永久红）** 与 **#2（缺省组装可静默伪造 committed 记录且对 rejection 无定义）** 是必须修订的设计缺陷：前者直接阻断转绿，后者破坏本任务的存在目的（区分 committed 与 expected rejection）。SA1 修订 §5.2/§7.3/§8.1（及 #3 的 issues 裁决）后提交重审；#4–#6 可随修订顺手处理或登记。

**Verdict: reject（待 SA1 修订后重审；修订面收敛于 §5.2 校验对象、§7.3 emitSlot 组装契约、§9 issues 裁决三处，其余设计无需改动）**

---

# R1 复审（2026-08-29，对 SA1 R1 修订版的重审）

**被审对象**: 设计文档 R1 修订版（596 行，含「附：SA2 反馈逐条回应」表与一致性自检）。
**复审方法**: 不采信回应表自述——对修订版全文重新通读 + 逐处修订点源码级核验 + 残留矛盾全文 grep + 修订与红灯套件/生产装配的兼容性推演 + 对修订新增内容（INV-DIAG 契约、§9.3 三分裁决、clock 成对校验、本地 observedAtMs）做新视角攻击扫描。

## R1.1 逐条复核结论

| R0 # | 修订声称 | 独立核验证据 | 结论 |
|---|---|---|---|
| #1 CRITICAL（§5.2 校验对象写错） | 改查 `doc` 局部量（handle.doc） | 修订版 §5.2 L118-121：`const d = doc as …; if (typeof d.on !== 'function' \|\| typeof d.off !== 'function') throw`——`doc` 即 runtime.ts:353 既有捕获（`h.doc`），分支落位注明「在既有 doc 捕获之后」（可选字段区，doc 已在作用域，成立）；Proxy handle 例（get trap 仅劫持 getStatus）下 `h.doc` 经 Reflect.get 透传真 Y.Doc——校验通过，不炸任何合法装配（本人对红灯 fatal-before-commit 用例的 Proxy 形态逐 trap 推演确认）；报错文案与检查对象一致（「handle.doc（Y.Doc）」）。§8.1/§8.2 的 `if (diag !== undefined) diag.updateBytes = captured` 同步修正（可选参数下可赋值）。全文 grep `h.on/h.off` 仅存于回应表对旧缺陷的引述 | **已修复** |
| #2 HIGH（emitSlot 缺省组装可伪造 committed） | 签名带入结算事实 + INV-DIAG 契约 | 修订版 §7.1 L230-231：onOk 传 `{kind:'fulfilled', value:r}`、onErr 传 `{kind:'rejected'}`；§7.3 L311-333 组装契约三分支——① outcome 显式 → 按 outcome；② outcome 缺失 + fulfilled + **`r.ok === true`** → 缺省 transaction/committed（bytes→update / 零事件→noop）；③ outcome 缺失 + ok:false resolve 或 rejection → **INV-DIAG 违约分支：不 emit + 源码锚点注释**。本人复核：ok:false 是 resolve 的关键混淆点已被 `settle.value.ok === true` 精确消解；「rejection + 无 outcome」从无定义变为显式契约；「宁可缺记录、绝不伪装 committed」的取舍与 ADR-0011 best-effort 定位及 §B「不得发明成功语义」相容（缺记录是 best-effort 允许的最终表现，伪造 committed 不是）；precedence 检查（outcome 先于 settle 事实）在正常路径全部正确，危险方向（fabricated committed）已被结构性封死；§8.1/§8.2 S7 行、§13.7「ok:false ⇒ result.kind ≠ committed」机制守卫与契约一致 | **已修复** |
| #3 MEDIUM（gate 记录省略 issues 无裁决） | §9.3 三分裁决，取透传侧 | 修订版 §9.3 按业务结算通道三分：领域联合 ok:false（R1–R4/S1′–S2′b 标 †，及既有 issues 面）**同源同序透传**（§8 形态「先构造 r 再 diag?.…(r.issues)」——同一数组引用，零第二构造，本人核对 §8.1 各 S 点该形态与现状业务返回值逐字节同一，仅增加诊断旁路读取）；fatal throw 通道不携带 issues——`RuntimeWriteFatalError` 确无 issues 载荷（errors.ts:164-174 复核：phase/committed/message/cause 四成员），「保留已有」无物可保留的相容性论证成立；committed 无 issues。红灯相容：红灯对 gate 记录未断言 issues（加 issues 两可不破）；fatal 记录（R5/R12/S4′b）红灯亦未断言 issues。§7.1 acceptance 伪代码补 `issues: result.issues`（DiagnosticIssue 的 `path` 必填项在 disabled() issues 中恒在） | **已修复** |
| #4 LOW（依赖叙述自相矛盾） | 本地 observedAtMs，值级依赖恰一处 | 修订版 §4 L77「值级依赖恰一处 = emitter.emit；不引入任何值级模块导出（含 observedAtFrom）」+ §7.2 L248-250 本地 3 行 `observedAtMs`（`new Date(now()).toISOString()`——与 emission.ts:105-107 同一表达式，产物恒匹配 intake 的 RE_ISO_MS；NaN/超域 clock throw 被 emitAttempt try/catch 吞没，注记保留）+ §13.1 同步。全文 grep observedAtFrom 仅存于「不引入」语境 | **已修复** |
| #5 LOW（clock 缺省墙钟形态） | 删除缺省 + 成对 loud 校验 | 修订版 §5.2 L132-134：`diagnosticEmitter !== undefined && clock === undefined ⇒ TypeError`；§5.1 注释重写（无 Date.now 缺省残留——全文 grep 证实 Date.now 仅存于回应表引述与 `new Date(now())` 表达式）。**兼容性核验**：红灯套件全部 14 处 emitter 装配逐点核对（本人逐行 grep：装配点 L149/184/211/255/278/321/361/397/427/455/506/535/579/607 均在 3 行内成对注入 clock；AC5 runTracked 以展开运算符成对传或都不传）——成对校验在套件内零触发；未装配路径（全部既有测试+生产）两字段俱缺、校验半径不触及 | **已修复** |
| #6 LOW（「逐字节不变」过强） | 改「行为等价」并登记差异 | 修订版 §2 D-C / §11 / §13.5：措辞改「行为等价（await 消费者可观测面不变）」+ 显式登记派生 promise/多一跳微任务 + §13.5 回归重点补 runtime-close-lifecycle / runtime-close-sa7-dynamic / runtime-p0-sequencer。全文 grep「逐字节」残留均为否定式（「非逐字节不变/同一」）或自检行——无活体过强断言 | **已修复** |

## R1.2 对修订新增内容的攻击扫描（新视角）

- **INV-DIAG「不 emit」分支**：尝试攻击「合法流程误入 INV-DIAG 丢记录」——对照 25 点映射表与本人 R0 的源码枚举，每个 ok:false/rejection 点均有显式 outcome 写入，INV-DIAG 在完备实现中结构性不可达；即便 SA3 漏写一点，表现是「缺一条记录」而非「错一条 committed」——失败方向正确（与 R0 #2 的要求一致），且 §13.7 机制守卫（ok:false ⇒ result.kind ≠ committed）可捕获。无新攻击面。
- **§9.3 透传形态的次序风险**：`diag?.…(r.issues)` 传同一数组引用——pipeline `projectIssues` 只读投影（issues.ts 既有），不回写业务数组；「先构造 r 再写 diag」不改变业务返回值语义。无攻击面。
- **成对校验的误伤面**：唯一可触达形态是「调用方装配 emitter 而忘注入 clock」——这正是要 loud 拒绝的形态（对齐 ADR-0012「注入 Clock」）；红灯与生产装配均不可达。无误伤。
- **本地 observedAtMs 与诊断包 helper 的漂移风险**：同一 ISO 表达式，但确属两份代码——若未来诊断包改 helper 语义（如时区/精度），runtime 侧不跟随。风险接受度：表达式是 `Date.prototype.toISOString` 的 ECMA-262 规范行为（YYYY-MM-DDTHH:MM:SS.sssZ），冻结度极高；intake RE_ISO_MS 是最终守卫。INFO 级，不阻塞。

## R1.3 残留（INFO，零行为影响，移交 SA3/SA4——不构成 pass 障碍）

1. **`DiagnosticEnv.clock` 类型形状**（§5.2 L143-148）：接口仍声明非可选 `readonly clock: () => number`，而 Date.now 缺省已删——「两者俱缺」的装配（全部既有测试+生产路径）构造 env 时该字段无值可填。行为零影响（emitAttempt 首行 emitter===undefined 即返回，clock 永不被读；成对校验保证 emitter 在则 clock 在），但 SA3 需选一个类型解：推荐 `readonly clock: (() => number) | undefined` + emitAttempt 仅在 emitter 分支读取（结构性保证非 undefined）。最坏解（`clock ?? (() => Date.now())` 填充）也因永不被读而无行为后果。
2. **§7.3 注释交叉引用笔误**：L331「SA6 补测清单（§13.6）」应为 **§13.7**（§13.6 是「红灯测试 SA6 owned」条目；补测清单在 §13.7）。纯文档 nit。

## R1.4 R0 验证基线的持续有效性

R0 §0 表的全部独立验证（yjs P1–P7 协议假设、两槽单事务+clear 全量重写、emit≡FIFO 微任务序、25 点穷尽性、caller 审计、稳定码 Pattern 匹配、input 投影决策表）针对的事实未被 R1 修订触碰（修订集中在 §2/§4/§5/§7/§8/§9/§13 的设计内容，§6/§14/§15 事实层仅措辞同步）——基线结论继续有效。ALLOW/DENY 文件清单零变化。

## R1.5 修订版裁决

**Verdict: pass（放行进入 SA3 实施）。** R0 三项阻塞发现（#1 CRITICAL / #2 HIGH / #3 MEDIUM）与三项低危（#4–#6）全部经源码级复核确认落实，修订未引入新的阻塞面；2 项 INFO 残留（DiagnosticEnv.clock 类型形状、§13.6→§13.7 笔误）零行为影响，SA3 实施时随手处理即可。SA4 验收锚点：14/14 红灯转绿 + 全量既有套件零回归（§13.5 重点面）+ typecheck；`pass` 不替代 SA4 对实现与活链路的验证。

---

# R3 复审（2026-08-29，对 SA1 R2 修订版——事务增量重放契约修正——的重审）

**背景**：SA3 实施期实验推翻 R1 版「增量 bytes 应用到全新空 Y.Doc 可观察事务效果」的消费契约声称（该声称沿 SA6 红灯原注释）。SA1 R2 新增 §6.4（修正后的消费契约）、§13.8（SA6 测试修订精确规格）、§14 P8（实测证据），并声称 producer 侧零改动。
**复审方法**：SA2 亲自重跑最小实验（镜像红灯夹具与两槽事务形态，9 项断言）+ 运行当前套件实证缺口边界 + 逐项核查 ADR 事务增量语义保真与 §13.8 规格的机制有效性。**特别声明：R0 报告「不成立的攻击」清单中「fresh-doc 可重放断言……机制成立，D-B 可满足红灯」一条是 SA2 自己的验证错误**——当时确认了「clear+全量重写」事务形态却错误推断了空文档物化，漏掉了 left origin 对 pre-state struct 的依赖。R2 的修正同时纠正了 SA2 该条记录，正式撤回（见 R3.5-R3-3）。

## R3.1 P8 独立实验复证（SA2 亲自跑，非采信设计自述）

实验脚本：镜像红灯夹具（makeDoc 同款 ENVELOPE/ROOT0/ENV_KEEP/ENV_REPLACE/ROOT_REPLACE）与两槽事务形态（`rootMap.clear()`+全 entries set / SCHEMA clear+四 set[+ROOT clear+三 set]），worktree yjs@13.6.32：

| # | 场景 | 实测结果 | 对照 P8 声称 |
|---|---|---|---|
| A0 | tx₁ 增量字节数 | **38 bytes** | ✅ 与 P8「38 bytes」精确一致（实验真实性侧证） |
| A1 | 空 doc + tx₁ | `ROOT.size=0`、`store.clients=0`、`n=undefined`、不抛错 | ✅ 事实 2：不物化、静默 |
| A2 | base→tx₁ | `n=42, a='x'` | ✅ = 红灯断言值 |
| A3 | base→tx₁→tx₂ | `n=7` | ✅ 链式终态 |
| A4 | base→tx₂ 跳过 tx₁ | `n=1`（静默停在基态陈旧值） | ⚠ 链缺口=陈旧重放非错误（R3-2 告警） |
| A5 | 空 doc + 整文档编码 | `ROOT.size=2, n=7`（物化） | ✅ §13.8d 反向鉴别断言有效（冒充必红） |
| B1 | 空 doc + SCHEMA keep-root 增量 | `SCHEMA.size=0` | ✅ 同事实 2 |
| B2 | base→s₁ | `text===ENV_KEEP.text`、`id='ns-1'`、`ROOT.n=1`（未动） | ✅ keep-root 断言值复现 |
| B3 | base→s₁→s₂ | `text===ENV_REPLACE.text`、`ROOT n/a/b=2/'y'/true` | ✅ replace-root 断言值复现 |
| B4 | base→s₂ 跳过 s₁ | `SCHEMA.size=4`（停在基态值）+ `ROOT.n=undefined`（空） | ✅ recs[1] 必须带 prior=[recs[0]] 的机制依据；且缺口可被断言捕获（text 错值 + ROOT 空） |

**结论：P8 四项机制声称全部复证成立。**

## R3.2 套件实证（当前 worktree，SA3 已实施 + 红灯测试未修订）

`npx vitest run packages/namespace-runtime/test/runtime-root-schema-diagnostic-red.test.ts` → **11 passed / 3 failed**：

- 11 绿 = producer 侧接线全对（记录存在、25 点分类正确、AC4 隔离、AC5 零额外读取、acceptance/fatal/validation 等全部断言通过）——原「0 记录」红根因已消除；
- 3 红 = 恰好是含 `applyCarrier` 的三个 it（ROOT committed L381、fatal-after-commit L381、SCHEMA×2 L478），失败点全在物化断言（`expected undefined to be 42/'type ROOT…'`），且各 it 的记录形状断言（`result.effect==='update'`、inline/format/payloadLength）先行通过——**实证缺口边界：producer 无缺陷，唯一剩余缺口就是测试消费形态**，与 §6.4/§13.8 的诊断完全一致。

## R3.3 ADR 事务增量语义保真审查（R2 的核心合规问题）

| 检查项 | 核验证据 | 结论 |
|---|---|---|
| producer 零改动声称 | §6.1–6.3/§7/§9 与 R1 逐字比对（R13/S7′ 行、§7.1/7.2 伪代码均未动）；§9.1 仅锚点注记（L473）标注应用形态变更 | ✅ 捕获机制仍产事务增量，映射表/发射契约不变 |
| ADR-0011 §D 冒充红线 | §6.4「为什么不改为携带整文档编码」明文拒绝切整文档；A5 实验证明整文档编码在空 doc 物化——若 producer 冒充会被 §13.8d 立即抓出 | ✅ 红线维持且有了机制化检测面 |
| CONTEXT.md「**连续的** committed Yjs updates 可用于诊断性重放」 | base + 依序增量链正是「连续 updates」的原生消费形态（R1 版空 doc 单条应用反而偏离该语义） | ✅ R2 与 ADR 术语定义拟合更佳 |
| ADR-0012 genesis baseline 对齐 | §6.4 指出重放工具 = 基线 + 增量链，与 #152 genesis baseline record 的设计目的对齐（本票 emission 面仍零 genesis 构造路径） | ✅ 一致 |
| 验收力不降反升 | 链式重放可断言**每笔事务的中间态**（base→tx₁ 停在 tx₁ 边界——整文档₁ 直接跳终态无法停留）；payloadLength 双重鉴别（38 bytes vs 整文档数百字节） | ✅ A2/A5 实证 |

## R3.4 §13.8 SA6 测试修订规格有效性核验

- **a. 基态捕获时点**：makeWriter 后、任何写前——P0 只读不写、pre-state 完整；`handle.doc` 即 runtime 写入的同一实例；「禁模块级常量（makeDoc 每次新 clientID）」理由成立。✅
- **b. applyCarrier 修订形态**：基态先立→prior 链→本条增量；inline/format/payloadLength 三断言原样保留。A2/A3/B2/B3 实验证明该形态**逐值复现原断言值**（42/'x'、7、ENV_KEEP、ENV_REPLACE+ROOT_REPLACE 三键）——「断言值不变」承诺成立。✅
- **c. 调用点清单**：枚举子项正确（ROOT committed / fatal-after-commit / SCHEMA recs[0]+recs[1] 带 prior）；**B4 实验证明 recs[1] 的 prior 是机制必需**（缺 prior → SCHEMA 停基态值 + ROOT 空 → 断言必红）。唯普查数字错误，见 R3-1。⚠
- **d. 反向鉴别断言（可选）**：A1/B1 证明真增量对空 doc 两 map size 均为 0；A5 证明整文档冒充会物化——断言方向正确、可捕获冒充回归。✅
- **转绿判据**：修订后仍 14/14（应用形态修正不增删 it）。✅
- **授权边界**：§13.8 声明为对 SA6 owned 冻结文件断言面的「唯一授权变更，其余断言一律不动」——与 §13.6「SA3 不得改断言」的执行归属一致（SA6 执行修订，SA3 已实施的生产代码无需变更）。✅

## R3.5 发现清单

| # | 严重度 | 发现 | 处置要求 |
|---|---|---|---|
| R3-1 | **LOW（须修正）** | §13.8c 调用点普查数字错误：「恰好 4 处 it、5 个调用」——实测红灯文件为 **3 处 it、4 个调用**（L167/L380/L477/L483；`updateCarrierOf` 同为 4 处）。枚举子项本身正确，但该条是对 SA6 owned 冻结文件的**授权条款**，错误普查可能引导 SA6 找第五个幻影调用点或误触其他 it | SA6 执行前由 SA1 一行修正为「3 处 it、4 个调用」（或删去普查句仅留枚举）；不涉设计语义，不需重审 |
| R3-2 | INFO | 链缺口静默降级语义：跳过链中一环不报错——A4 停在基态陈旧值（n=1）、B4 停在基态 SCHEMA 值且 ROOT 空。yjs 内生语义（struct 按 client clock 连续积分，缺口使后续整包挂起 pending），非设计缺陷；本票测试均用完整链不受影响 | 建议 §6.4 补一行面向未来重放工具消费者的告警：记录缺口=陈旧/部分重放而非错误，重放工具须依赖 genesis 基线 + 完整 record 序列。不阻塞 |
| R3-3 | INFO（SA2 自我更正） | R0「不成立的攻击」中「fresh-doc 可重放断言……机制成立」为 SA2 验证错误：确认了 clear+全量重写事务形态，但未追踪新 item 的 left origin 依赖 pre-state struct，错误推断了空文档物化。SA3 的实验与 SA1 R2 的修正正确 | 正式撤回 R0 该条；R0 §0 表中相关行的「✅」结论以本节实验为准重写为「事务形态成立；空文档物化不成立（R2/R3 修正）」 |
| R3-4 | INFO | 设计 §5.2 的 `DiagnosticEnv` interface 文本（非可选 `clock: () => number`）与 SA3 已实现形态存在表述漂移——SA3 用判别联合 `{emitter:undefined,clock:undefined} | {emitter,clock}`（diagnostic.ts:43-45），恰为 R1 INFO-1 推荐的解法且更优；R1 INFO-2（§13.6→§13.7 笔误）已在 R2 修复（设计 L352） | 设计文本可在下轮例行同步为实现形态；零行为影响 |

## R3.6 R3 裁决

**Verdict: pass（附 R3-1 一项须修正的规格笔误）。**

- R2 修正的**事实层**（P8）经 SA2 独立实验 100% 复证（含 38 bytes 细节、链必要性、冒充可鉴别性），且当前套件 11/14 绿 + 3 失败精确落在物化断言——缺口边界与 §6.4 诊断完全吻合；
- **ADR 事务增量语义保真**：producer 零改动、冒充红线维持且新增机制化检测面、「连续 updates」原生语义拟合更佳、genesis 对齐；
- **§13.8 测试修订规格机制有效**：基态捕获时点、链式应用形态、断言值不变、prior 必要性、反向鉴别全部经实验验证；
- 后续路径：SA1 修正 §13.8c 普查数字（R3-1，一行）→ SA6 按 §13.8 执行测试修订 → 转绿判据 14/14；SA4 终验锚点 = 修订后套件 14/14 + 全量既有套件零回归 + typecheck。`pass` 不替代 SA4 对实现与活链路的验证。
