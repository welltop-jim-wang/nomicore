# SA2 攻击评审报告 — Issue #150 namespace create 生命周期与 genesis 接入诊断变更日志

**Date**: 2026-08-30（R1 评审）；同日 R2 复审（见文末「R2 复审」节）
**Verdict**: R1 **reject** → **R2 pass**（R1 三强制项 R2-M1/M2/M3 已全部关闭并经源码逐项复验；零新阻塞项；残留 3 条 INFO 级备注与 1 条非阻塞守护测试建议，见 R2 复审节）

- 被审对象：`wiki/raw/task_namespace-diagnostic-change-log_design.md`（SA1 R1 初版）
- 审查基准：`task_namespace-diagnostic-change-log.md`（SA6 红灯契约 16/16）+ `task_namespace-diagnostic-change-log_relevant_decisions.md`（ADR-0006/0007/0008/0009/0011/0012 摘录，SA8 clear 裁决含 J1–J3 移交）+ worktree 源码逐文件核对
- 审查方法：全新视角；对设计全部 18 结局点逐条与 `registry.ts` 实际代码对位；对 §11 四项内部接缝假设逐条到 `pipeline.ts` / `adapters/file.ts` / `adapters/memory.ts` / `vocabulary.ts` / `schema-patterns.ts` 源码验证；红灯基线独立复跑。

---

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议（可执行修订要求） |
|---|--------|--------|---------|------|
| 1 | **HIGH** | DC-4 issues 码派生：**发明新码前缀，割裂既有单源码词表** | 设计 §6.3.4 对 schema-invalid 的 issues 投影为 `{code: 'VFSL-ENV-E${issue.code}', message, path: []}`（envelope）与 `{message, path: []}` **无 code**（vfsl 文本）。但仓库已有该 vfsl `SchemaParseIssue` 的**码派生单源**：`namespace-runtime/src/p0.ts:134-146` `toIssueSummary` → `SCHEMA_ENVELOPE_{code}` / `SCHEMA_TEXT_INVALID`，且已被 P0 unavailable 摘要（p0.ts:117）与 **#149 schema-replacement 诊断记录**（`schema-write.ts:186-192`，逐条 `{code: s.code, message, path: []}`）消费。后果：同一个 vfsl 失败（如未知方言 ENV_4）在 `schema-replacement` 记录里 code=`SCHEMA_ENVELOPE_4`，在 `namespace-create` 记录里却成 `VFSL-ENV-E4`——同一诊断日志体系内跨 operation 码词表碎片化，Host 按码检索/统计将系统性漏掉 create 侧。设计 §2.2 自我声明「stage/code/…issue 事实全部摘自 Registry 既有稳定面，**零发明**」，DC-4 恰恰发明了仓库里不存在的码前缀；其论据「VfslIssue 无独立 code」与既有派生（赋 `SCHEMA_TEXT_INVALID`）事实不符。SA8 J2 已把命名纪律终审核验移交本席。 | 二选一：(a) **对齐**——`projectCompileIssues` 本地复刻 `toIssueSummary` 同款码（`SCHEMA_ENVELOPE_${String(code)}` / `SCHEMA_TEXT_INVALID`；registry 已 workspace 依赖 namespace-runtime，但按 DC-5 纯类型消费纪律宜本地复刻字符串而非值级 import），保持与 P0/#149 单源同串；(b) **显式登记分歧**——在设计文中论证为何 create 侧必须不同码并登记为新词表决策。红灯锚只断言 `items.length > 0`（测试 :614-615/:634-635），对齐修订**零契约破坏**。 |
| 2 | **HIGH** | 防御边界完整性：**emission 实参组装逸出吞没边界**（违反 §9.1/AC4 零漂移的核心承诺） | §7 插点 #10/#11 的伪码把 `issues: projectCompileIssues(initial.issues)` / `projectValidateIssues(initial.issues)` 写在 **registry.ts 调用点实参位置**——在进入 `create-diagnostic.ts` 的 emitAttempt try/catch **之前**求值。§6.4 防御表只覆盖「emitter.emit 同步 throw」与「issues 投影遇意外形状**条目** → 跳过」，未覆盖**数组级**失败：若 `initial.issues` 非 массив（gateway 契约违约，运行期无机器守卫），投影函数 for-of 直接 TypeError，且 #10/#11 位于 `try { createDocument } catch` 块**之外**（该块已闭合）、`return schemaInvalidIssue(...)` **之前**——异常将以未处理 rejection 冒出 `runCreateSlot`，业务结果从「resolve NAMESPACE_SCHEMA_INVALID issue」漂移为「create() reject」。这直接证伪 §8.4 的「全部插点在业务结算之后旁路（return 值已确定）」：return 语句尚未执行，日志侧异常抢占了业务结算。设计对「敌意/违约输入」自己的威胁模型（§6.4 行 5）恰好没有防住这一层。 | 修订设计为：**投影移入模块吞没边界内**——`CreateEmissionArgs.issues` 改收裸 vfsl issues（`readonly unknown[]` + kind 判别），`emitOutcome` 内部 try 中完成投影；并补一条数组级防御语义（非数组 → 按「无 issues」发射，或整条 emission 丢弃，二选一写死）。同时把 #17 的 `emitOutcome` 调用移出 factory try 块或在设计文中显式声明「emitOutcome 含其实参组装保证零 throw」的精确边界（当前 §6.3.1 的 try 只包住 emit 调用与已组装 args 的字面量，不包调用点实参求值）。 |
| 3 | **MEDIUM** | #18（factory throw）结果形状硬编码与 #16a 不自洽：**encode 失败角case 下 committed:true fatal 零记录** | §6.2 #18 与 §7 伪码硬编码 `result:{kind:'fatal', committed:true, effect:'update', updateBytes: state}`。`state = encodeDetachedState(initial.doc)` 失败时返回 `undefined`（设计自认的「不可达防御」分支，且 §6.3.5 已为**成功路径**规定了 encode 失败的处置），此时该 emission 形状非法（`pipeline.ts` resultShapeValid 要求 `effect:'update'` ⟹ `updateBytes instanceof Uint8Array`）→ intake 整条丢弃——一次 **committed:true 的 Registry fatal 在诊断日志里完全消失**。而 EmissionResult 判别联合本就提供诚实选项 `fatal+committed:true+effect:'unknown'`，#16a 也已正确使用 `fatalFromBytes`（bytes 缺 → 'unknown'）。同一防御前提在 #18 被漏配。 | #18 的 result 改为 `fatalFromBytes(true, state)`（与 #16a 同款、与设计自己引述的 #149 先例同款）。SA6 冻结锚（factory throw 测试的 encode 恒成功）不受影响；修订纯设计文本一致性。 |
| 4 | LOW | §8.1 合规论证精度（SA8 J1 移交）+ initStream 引入的新同步 I/O 面 | (a) §8.1 末条「slot 不因日志延长（emit 是有界同步操作）」把「数据量有界」偷换为「延迟有界」——ADR-0012 amendment 自己声明有界不含文件系统延迟上界。**合规性实际立于调用点位置规则**（全部 emit/initStream 在 Runtime write sequencer slot 之外：create 期 Runtime 不存在、post-commit 段在 Registry create slot 调用栈）——本席已对位 registry.ts 全部插点核实成立，建议设计删去该偷换句、以位置规则为唯一论据。(b) AC2/AC4/AC5 的 Host binding 在 `initStream` 内**构造整个 File adapter**（mkdir + manifest('wx') + genesis append + current.json ≈ 4+ 次同步文件操作），运行在 Registry create carrier slot 内，同 key 后续 create/open 在 FIFO 上等待。一次性、每 namespace 至多一次、与 create 本身的写盘同数量级——可接受，但设计应如实记载该成本与「shutdown 经 `await carrier.tail` 会等待在途 create 槽」的事实，不写「slot 不延长」。 | 文字修订：§8.1 以位置规则为唯一合规论据；§9.4 补记 initStream 绑定 File adapter 构造的同步文件操作成本与 shutdown 等待语义（有界、不可无限阻塞）。 |
| 5 | LOW | initStream seam 类型面允许 async 实现逃逸吞没 | seam 类型 `(namespaceId, bytes) => void` 在 TS 下可合法接受 `async` 函数（void 返回位不拒绝 Promise）。Host 违约时 `diag.initStream(...)` 的 try/catch 捕不到异步 rejection → unhandled rejection 有进程级风险。与 #149 emit seam 同款系统性暴露，非本设计独有。 | 在 §3.1/§5.1 seam 契约注释中写明「initStream 必须同步完成；async 返回属 Host 违约」（一行文档义务，不做运行时防御）。 |
| 6 | INFO | encode 失败成功路径的**全静默角case**（best-effort 许可内的诚实性备案） | encode 失败时成功路径 attempt emission 整条丢弃（设计明选，正确——三值 update-omitted reason 无一诚实匹配）且 genesis 亦缺席（adapter runGenesis 对 undefined 静默跳过，§11-G10 豁免）→ 该 create 在日志侧**零痕迹、零健康信号**。business 侧 Registry observer `lifecycle-slot-failed` 不触发（业务成功）。ADR-0011 best-effort「允许缺失」覆盖之，不构成虚假降级（前提缺失属真实防御分支而非被掩盖的 bug；loud assert 会违反 ADR-0011 业务隔离铁律）。 | 设计 §6.3.5 补一句明示「此角case 日志侧全静默（无健康事件通道可用），属 best-effort 许可」——供 SA4/SA7 活链路验收时不误判为接线缺陷。 |
| 7 | INFO | §11 引用行号微漂 | `schema-patterns.ts:36-38` 实为 P_ISO_MS/P_STABLE_CODE **常量定义在 :22-25、RE_ 副本在 :42-44**；`file.ts` genesis 调用点在 :873-874（initializeGeneration 本体 :836-878）。内容全部属实，仅行号偏移。 | SA3 落地时顺手校正引用。 |

**未成立/已排除的攻击线**（审查过、证据不支持，列出以防复审重走）：

- 「Registry create slot 内同步 emit 违反 amendment C」——不成立。条款主语逐字限定「NamespaceRuntime write sequencer slot」；create 期 Runtime 不存在、post-commit 段 emit 在 Registry slot 调用栈且 P0 只读 SCHEMA（ADR-0008）；本席对位全部插点核实。见攻击点 #4 的论证精度残留。
- 「全量 `encodeStateAsUpdate` 冒充 transaction update」——不成立。ADR-0011:93 原文「**后续** committed ROOT、SCHEMA…」限定范围；create 事务无 pre-state，全量编码数学上即该事务精确 effect；ADR-0006 #64「创建成功前初始完整 snapshot 已提交（Y.encodeStateAsUpdate(doc) 直写）」+「handle.doc === doc」（:124-125）双重背书。
- 「#2 入口 identity 拒绝映射 `identity` stage 违词表」——不成立。ADR-0011:47「namespace identity 不满足」原文覆盖 descriptor-only 身份/形状拒绝；`identity` 是 8 值词表合法值（vocabulary.ts:64）。
- 「诊断侧早期读 clock 违反单读冻结」——不成立。SA6 锚 `clock.calls === 1` 只在成功路径（业务 1 + 诊断 0）与计数 clock 下断言；早期路径测试用恒定 clock 无计数断言；DC-3 与锚点逐位一致。
- 「types.ts 声明纪律禁令封杀 emitter 类型入主入口图」——不成立。types.ts 已有行为性注入 seam 先例（`Clock`/`RegistryTimeoutScheduler`/`observer`）；禁令枚举的是 Runtime/租约/文档命名类型；§5.1 论证成立。
- 「emitOutcome 移入 factory try 内 `entries.set` 之后有状态撕裂风险」——实际不可达（模块吞没一切），已并入攻击点 #2 的边界修订一并处理。

---

## 协议假设依据审查

**结论：合规（章节存在、四项依据全部可验证、零「应该/通常/预计」类无据推断）**；仅攻击点 #7 的行号微漂。

- §11 章节存在，且正确识别本设计「无外部协议假设、有四项内部接缝行为假设」的定性。
- 依据 1（emitter 管线接受设计组装形状）：`pipeline.ts:62-99` intakeValid（operation/stage/RE_ISO_MS/RE_STABLE_CODE/isSourceModule/isLogSource+封闭键/input 对象性/resultShapeValid）逐条核对通过；`:221` attemptId 缺省 CSPRNG 生成 `att-`+32hex 属实。设计所用全部 code（`REGISTRY_NOT_ACCEPTING`、`NAMESPACE_*` 族、`NAMESPACE_REGISTRY_FATAL`）与 sourcePhase（`runtime-construction`/`create-document-internal`/`lifecycle-slot-internal`）均匹配 `^[A-Za-z0-9_.:-]{1,128}$`（schema-patterns.ts:25）；stage 8 值全含 `identity`；sourceModule 4 值含 `registry`；`source:{kind:'local'}` 过封闭键校验（pipeline.ts:85）。
- 依据 2（initStream/runGenesis 语义）：`file.ts:810-832`（undefined/空/超限 → 跳过 genesis；否则 genesis record）、`:873-874`（initializeGeneration 内建 generation 时 runGenesis → seq 1）、`:987`（resume 忽略 genesis bytes）、`:950-952`（invalid-roll-targets → `LOG_STREAM_INIT_FAILED` + disabled）全部属实。
- 依据 3（memory adapter capacity/stats）：`memory.ts` gateAndEnqueue 满员分支 `notifyRecordDropped('queue-full',…)` + `countDrop`、stats 面（accepted/droppedTotal/droppedByReason）属实。
- 依据 4（encodeStateAsUpdate 可行且=提交内容）：ADR-0006 #64 原文逐字核对（docs/adr/0006:124-125，含 `handle.doc === doc`）；§8.2 四前提中「同 key FIFO」经 registry.ts:557/785 共用 `carriers` map 核实、「lease 未签发」「P0 只读」与代码结构一致。
- 附带核验：canonicalResult 对 updateBytes 的 intake `slice()`（pipeline.ts:139/147）——设计 §6.3.5「双保险」声明属实；code↔sourceModule 成对规则（pipeline.ts:239-251）——设计「committed 无 code 无 sourceModule」的成对省略合法。

---

## 错误处理链路审查

（按 2026-05-07 立法四查；本任务无前端交互面，按「日志侧故障 × 业务面闭环」映射）

- **静默失败检查**：业务面零静默失败——全部 18 结局点的业务结算（issue resolve / fatal reject）既有路径零改动，诊断插点吞没后不影响结算值。日志侧的「应记未记」缺口已枚举：#9 clock fatal（有 Registry observer `lifecycle-slot-failed` 兜底，系统级非静默）、encode 失败成功路径（**全静默**，见攻击点 #6——best-effort 许可但需备案）、#18 encode 失败（**非法形状致管线静默丢弃**，见攻击点 #3——必修）。
- **状态闭环检查**：每次 create 尝试 → 恰一条记录或落入明示丢弃条件（§6.3.2 clock 故障、§6.3.5 encode 失败、adapter 队列满）——映射闭环，唯攻击点 #3 的丢弃路径未在设计明示（伪闭环，必修）。
- **降级路径检查**：缺 emitter → no-op 短路；缺 initStream → 延迟初始化（AC5 语义）；adapter 队列满 → drop+stats；stream init 失败 → 独立健康 observer `LOG_STREAM_INIT_FAILED`（真实 file adapter 产生，Registry 不代发——设计 §6.3.5 与 file.ts:952 对位一致）。四隔离均有承载。
- **虚假降级识别**：逐个检验设计中的「防御性缺席」——(a) encode 失败→undefined：正常流程该条件恒满足（Persistence 同款 encode 已成功），违约即真实 bug，但 loud assert（抛错改业务结果）被 ADR-0011 业务隔离铁律显式禁止，且 committed 事实已定无法回头——**非虚假降级**，属 ADR 强制的隔离；残留问题是零健康信号（攻击点 #6 备案即可）。(b) clock fatal 丢 emission：record schema 必填 observedAt + clock 坏 → 无合法记录可造，丢弃是唯一不伪造选项（SA8 J3 同结论），业务侧 observer 事件照发——非虚假降级。(c) issues 条目形状意外跳过：producer 侧跳过无健康通道（adapter 看不见），属攻击点 #6 同类备案项。**未发现把正常路径前提缺失当降级、掩盖上流 bug 的设计**。

---

## 红线测试思路

> SA6 套件（16 it，已冻结）之外，针对本报告漏洞的追加红灯/守护测试方向（SA3 转绿后、SA4 阶段编写；不改动已冻结文件）。

1. **（对攻击点 #1）码词表一致性守护**：以 `lang:'nope'` 信封（未知方言 → ENV_4）与 `BAD_SCHEMA` 文本错误分别 create → 断言 attempt 记录 `issues.items[0].code` 分别为 `SCHEMA_ENVELOPE_4` / `SCHEMA_TEXT_INVALID`（与 `p0.toIssueSummary`/#149 同串）；或若 SA1 选择登记分歧，则断言登记的码值并注明与 #149 的对照关系。反向锚：不存在 `VFSL-ENV-E` 前缀码。
2. **（对攻击点 #2）零漂移守护——诊断侧契约违约不改业务**：经 `createDocumentFactory` 注入返回 `{ok:false, kind:'schema-invalid', issues: 42 as never}`（非数组违约）→ 断言 create 仍 resolve `NAMESPACE_SCHEMA_INVALID`（而非 reject）；root-invalid 同款注入。再注入含 getter 抛异常的 issues 数组条目 → 同断言。这是「日志侧任何故障不得改变业务结果」在投影层的直接红灯。
3. **（对攻击点 #3）#18 encode 失败角case**：以 testing seam 使 `encodeDetachedState` 路径失败（如注入 createDocumentFactory 返回 doc 为 `{}`——encode 返回 undefined 的受控等价，或 SA3 落地时为 encode 提供包内可测缝）+ runtimeFactory throw → 断言记录为 `fatal committed:true effect:'unknown'`（**而非零记录**），且业务仍 `NamespaceRegistryFatalError{phase:'runtime-construction',committed:true}`。
4. **（对攻击点 #5，SA4 验证项）**：Host 违约 initStream 返回 rejected promise → 断言 create ok 且进程无 unhandled rejection（若仅做文档义务则转为 SA4 静态核验 seam 注释存在）。
5. **（沿用 SA6 已有锚，确认无需新增）**：AC4 emitter throw / queue-full / init 失败隔离、AC3 trap 计数与快照复用已覆盖主隔离面；本报告不重复。

---

## 独立验证记录（SA4/SA7 可直接复用的对位证据）

| 验证项 | 命令/位置 | 结果 |
|---|---|---|
| 红灯基线 16/16（「0 记录/0 emit/0 initStream」驱动） | `./node_modules/.bin/vitest run packages/namespace-registry/test/registry-create-diagnostic-red.test.ts --typecheck.enabled=false`（本次复跑） | `Tests 16 failed (16)`，Duration ≈51s，末例失败形态 `fileLog !== undefined` poll 超时——与 SA6 简报证据逐字一致 |
| 18 结局点真实存在且无遗漏 | `registry.ts` :1041/:781/:806/:814/:829/:839/:843/:858/:863/:874/:893/:896/:901/:915/:918/:922/:939/:948-960 逐行对位 | 全部存在；exhaustive 走查 `create()→admitCreateSlot→runCreateSlot` 无第 19 条结局路径（issueLease/makeEntry/createCarrier 无抛出面） |
| §3.2 冻结映射 ↔ 测试断言逐行一致 | 测试 :509-514/:531-535/:558-562/:590-594/:609-615/:629-635/:650-654/:377-387/:680-692 | 9 行全对齐；测试文件确无需改动即可按设计转绿 |
| clock 单读锚 | 测试 :372（成功路径 `clock.calls===1`）；早期路径测试用恒定 clock 无计数断言 | DC-3 与锚点无冲突 |
| 码/词表/正则合法性 | vocabulary.ts:58-69、schema-patterns.ts:25、pipeline.ts:62-99 | 设计所用全部枚举值与模式通过 |
| runGenesis/initStream、invalid-roll-targets 健康事件 | file.ts:810-832/:873-874/:950-952/:987 | 与 §6.3.5/§11 声明一致 |
| memory capacity 队列语义 | memory.ts gateAndEnqueue 满员分支 + stats | AC4 队列压力锚承载成立 |
| 共享 carrier FIFO（§8.2 前提） | registry.ts:557（open）/:785（create）共用 `carriers` | 同 key 串行化成立 |
| ADR-0006 #64 引文 | docs/adr/0006:124-125（含 `handle.doc === doc`） | 逐字属实 |
| #149 先例（emitAttempt 吞没/成对纪律/emitter↔clock 成对） | namespace-runtime/src/diagnostic.ts、runtime.ts:452-479、p0.ts:134-146、schema-write.ts:186-192 | 先例存在且为本报告攻击点 #1 的词表证据源；registry clock 必需（assertClockShape）故 #150 无成对缺口 |
| 依赖现状 | packages/namespace-registry/package.json | yjs 现居 devDependencies（上移判断正确）；诊断包未入依赖（§2.1 根因 4 成立） |

---

## 裁决与放行条件

**reject**。SA1 需修订设计后重审；修订范围仅限：

1. 攻击点 #1：DC-4 码派生对齐 `SCHEMA_ENVELOPE_*/SCHEMA_TEXT_INVALID` 单源（或显式登记分歧决策）；
2. 攻击点 #2：issues 投影（及一切实参组装）移入 create-diagnostic.ts 吞没边界 + 数组级防御语义写死；
3. 攻击点 #3：#18 result 改 `fatalFromBytes(true, state)`。

攻击点 #4–#7 为文字/备案级修订，随上述三项一并落即可。架构主体（seam 形状与字段名、18 插点拓扑、DC-1 槽内 encode、DC-2 initStream 次序、DC-3 Clock 不变量、DC-5 纯类型消费、DC-6 显式映射、amendment C 位置合规、§9 业务零改动模式）经独立源码验证成立，重审时无需重证。

`pass` 后仍不替代 SA4（实现与静态门禁）与 SA7（活链路）验证。

---

# R2 复审（2026-08-30）— Verdict: **pass**

**复审对象**：`task_namespace-diagnostic-change-log_design.md` R2（771 行；R1 684 行 → R2 净增 87 行，含新 §8.5 与回应表）
**复审范围**：R1 三强制项（R2-M1/M2/M3）是否真关闭 + LOW 项落实核对 + **全新视角扫 R2 新增/改写文本是否引入新阻塞项**。
**复审方法**：设计文本全文重读；每个关闭声明独立到 worktree 源码复验（不接受设计自述）；R2 一致性自检声明用 grep 独立复跑。

## 三强制项关闭核验（逐项源码复验）

| 强制项 | 关闭判定 | 独立复验证据 |
|---|---|---|
| **R2-M1**（R1 攻击点 #1：compile issue 码对齐 P0/#149 单源，废除发明的 `VFSL-ENV-E` 前缀） | **✅ 真关闭** | ① 码串逐字对齐：R2 §6.3.4 `SCHEMA_ENVELOPE_${String(issue.code)}` / `SCHEMA_TEXT_INVALID` ≡ `p0.ts:140` `SCHEMA_ENVELOPE_${String(issue.issue.code)}` / `p0.ts:145` `SCHEMA_TEXT_INVALID`（本席 grep 复核，含 :136-138「不透明段透传，不假设数字串」注释语义同引）；② 前缀已死：grep `VFSL-ENV-E` 全文仅 4 处，全部为「R1 曾发明/已废除」历史注记（DC-4 行、§6.3.4 注、回应表、自检记录），零活引用；③ 顶层 code 保持 `NAMESPACE_SCHEMA_INVALID`（SA6 冻结，测试 :611），并与 #149 Runtime 写路径的「顶层=首条 issue 码」裁量显式区分（§6.3.4 备注）——区分正确；④ 跨包不可 import 的载荷声明属实：`namespace-runtime/src/internal.ts` 头注明文「值导出恰本函数一键」（`createNamespaceRuntimeForRegistry`），package.json exports 仅 `.`/`./internal` 两键，且 `namespace-runtime/**` 在本设计 DENY LIST——语义复制并标注同源基准是范围内唯一选项；⑤ SA6 锚不受影响：测试只断言 `items.length > 0`，码值变化零契约破坏。 |
| **R2-M2**（R1 攻击点 #2：raw issues 投影整体移入吞没边界 + 数组级防御） | **✅ 真关闭** | ① `CreateEmissionArgs` 改收 `rawIssues?: readonly unknown[]` + `issuesKind: 'compile'|'validate'`（§6.1）——registry 侧零投影；② §7 插点 #10/#11 实证改传 raw（`rawIssues: initial.issues, issuesKind: 'compile'/'validate'`），投影调用唯一发生在 `emitAttempt` 的 try 内（§6.3.1 :311-314）；③ 三层防御齐备且每层都在模块内（§6.3.4）：数组级（非数组/检查 throw → 整组省略 issues 字段、emission 照常）、条目级（逐条 try/catch，敌意 getter 只废该条）、整体级（投影器任何 throw → 外层 catch → emission 丢弃）——§6.4 防御表同步补两行；④ R1 漏洞的触发面复核为零：重扫 §7 全部 18 插点的调用点实参表达式，剩余求值全部为不可抛形态（冻结字面量属性读、`fatalFromBytes`/`fatalFromCommitted` 纯判别、`encodeDetachedState` 内部 try、`state?.slice()`）——「任何日志侧异常不改业务结局」的承诺在实参组装层同样成立；⑤ `issues.length > 0` 门（§6.3.1 :322）与正常路径非空保证一致（§11 第 2 行依据链复验：BAD_SCHEMA → `vfsl/src/index.ts:316-318` parse 阶段 `kind:'vfsl'` 包装 → 投影非空；adapter 侧 `issues.ts:82-92` isValidItem 逐条通过；memory adapter 默认 `issuesPolicy:'full'`（memory.ts:164）→ SA6 `items.length > 0` 锚可达绿）。 |
| **R2-M3**（R1 攻击点 #3：factory-throw fatal 必须 bytes-aware） | **✅ 真关闭** | ① §6.2 表 #18 result 改为 `fatalFromBytes(true, state)` 双分支显式语义（state 可得 → update+bytes（SA6 锚在此分支）；undefined → 诚实 `effect:'unknown'`）；② §6.3.5 伪码 ⑤ 与 §7 插点 #18 两处均落地 `result: fatalFromBytes(true, state)`；③ helper 定义与 #149 先例**逐行同形**：`diagnostic.ts:94-99` `fatalFromBytes`（本席 sed 复核：`!committed → {fatal,committed:false}`；bytes → `update`；无 bytes → `unknown`）——R2 §6.3.5 副本一致；④ #17 成功路径同步补 `if (state !== undefined)` 前置守卫（§6.3.5 :422 与 §7 :578 **两处伪码都有**，本席 sed 复核）——committed 无 bytes 不构造 emission、不伪装 update-omitted；⑤ SA6 锚可达性说明（§6.3.5 末段：fatal 用例 encode 必然成功 → 走 update 分支）推理正确；⑥ §6.4 encode 失败行补 factory-fatal → `effect:'unknown'` 语义。R1 的「committed:true fatal 零记录」路径消灭。 |

## LOW 项落实核对

- **LOW-a**（§8.1 论证精度/SA8-J1）：✅ R1「emit 是有界同步操作」暗示句已删除，改为显式否认「数据有界 ⟹ 延迟有界」，成本归属移 §8.5；合规论据回归**调用点位置规则**唯一支柱——与 R1 复验的位置规则事实（18 插点全部在 Runtime sequencer slot 外）一致。
- **LOW-b**（§8.5 新增节）：✅ sync-only 契约（两者恒同步 void、Registry 永不 await、floating promise 处置责任在 Host、throw 吞没、不代发健康事件）；同步成本量级逐项列明（manifest 'wx' + genesis append + current.json rename）并声明归属 create 调用方；shutdown 三条（不调 initStream/不 drain/在途同步调用由既有 `await carrier.tail`（registry.ts:982，本席复核行号属实）覆盖、零新增异步状态）；**encode 失败静默备案超出 R1 要求**——补了检测手段（stream 有 manifest 而无 genesis-baseline，Host 侧 readStreamStrict 可见）与 ADR-0011 允许性依据。
- **LOW-c**（引用修正）：✅ 字母节引用清零（grep 复核：`ADR-0011 §[A-Z]` 类零活引用）；§11 新增两行依据全部复验属实（`projection/issues.ts:82-92`、`p0.ts:134-148`、`schema-write.ts:315-317`、`vfsl index.ts:316-318`）。**残留**：§11 第 1 行 `schema-patterns.ts:36-38` 行号仍不准（`P_ISO_MS`/`P_STABLE_CODE` 实在 :22/:25、RE_ 副本在 :42-44；常量名与内容正确）——INFO 级，SA3 落地时顺手校正即可。

## 新阻塞项扫描（全新视角，R2 新增/改写文本）

逐段攻击 R2 新内容，**未发现新阻塞项**：

- §6.3.4「schema-write.ts:315-317 是跨模块**语义复制**先例」——措辞不准：`toReplacementIssue` 是**同包直接 import** `toIssueSummary` 后重组（schema-write.ts:317-319），非复制先例；真正的立论是「internal.ts 值导出冻结 + namespace-runtime/** DENY LIST ⟹ 跨包只能语义复制」——该立论本身成立（见 M1-④）。INFO 级措辞 nit。
- §11 引言「五项内部接缝行为假设」与表实有 **6 行**（R2 增两行未更新计数）。INFO 级。
- §6.3.1 模块内私有 `projectIssues(raw, kind)` 与诊断包 `projection/issues.ts` 同名不同签名——包内私有、零 import 交叠，无歧义风险。不构成发现。
- §8.5「Host 返回 Promise 被 Registry 忽略」——与 #149 emit seam 同款系统性暴露，已按 R1 要求文档化为 seam 契约边界（处置责任在 Host）；可接受。
- #16b「同 #16a 形，committed:false」——`fatalFromBytes(false, …)` → `{fatal,committed:false}` 恒合法形状（无 effect 字段），无 M3 类问题。
- 条目级「`issue.code` 可 String 化」——`String()` 先于模板插值，敌意 toString 由逐条 try/catch 兜住。安全。
- §3 冻结锚（seam 形状、9 行映射、AC2–AC5）与 R1 逐字一致（diff 阅读）——R2 修订未触碰任何 SA6 契约。
- envelope issue 的 `readOnly` 字段被投影静默丢弃——DiagnosticIssue 无该槽位，与 `toIssueSummary` 同款行为。一致。

## R2 遗留（非阻塞，移交 SA3/SA4）

1. **跨包码串守护测试（建议新增，非阻塞）**：语义复制无机器强制单源——若未来 `p0.toIssueSummary` 码串演进，registry 副本将静默漂移。建议 SA3/SA4 阶段新增独立测试文件（不改 SA6 冻结文件）：`lang:'nope'`（ENV_4）create → 断言记录 `issues.items[0].code === 'SCHEMA_ENVELOPE_4'`；BAD_SCHEMA → `=== 'SCHEMA_TEXT_INVALID'`（即 R1 红灯思路 1 的落地）。
2. §11 行号微修（:36-38 → :22/:25 或 :42-44）与「五项→六项」计数校正——SA3 顺手项。
3. §6.3.4/§11「语义复制先例」措辞按本报告事实修正——SA3 顺手项。

## R2 裁决

**Verdict: pass** —— R1 三强制项全部真关闭（每项均有本席独立源码复验证据，非采信设计自述）；LOW 三项落实（一项超额完成）；R2 新增文本零新阻塞项；SA6 冻结契约零触碰。放行 SA3 实施。

残留 3 条 INFO（引用行号/计数/措辞）与 1 条守护测试建议均不构成放行条件，移交 SA3/SA4 处理。`pass` 不替代 SA4（实现与静态门禁）与 SA7（活链路）验证。
