# SA2 攻击评审报告

**Date**: 2026-08-23（R1）／ 2026-08-23（R2 复审，见文末「R2 复审」节）
**Verdict（R1，历史记录，已由 R2 修订回应）**: reject（2 个 CRITICAL / 1 个 HIGH / 2 个 MEDIUM 漏洞需 SA1 修订设计后重审；其余为非阻断建议）
**Verdict（R2 复审，最终）**: **pass** —— 4 个阻断攻击点 + 3 个 LOW 建议全部核实落实；附 2 条非阻断表述精度注记（N1/N2，建议 SA1 在 SA3 动工前顺手修正，不构成重审条件）。详见文末「R2 复审」节。

- 被审对象：`wiki/raw/task_namespace-runtime-skeleton-p0_design.md`（SA1 设计，622 行）
- 约束基准：`wiki/raw/task_namespace-runtime-skeleton-p0_relevant_decisions.md`（ADR-0008 全集条款 + ADR-0006/0007 继续有效条款 + SA6 冻结契约）
- 评审方法：全新视角通读设计 → 逐条比对 ADR 原文与 SA6 三测试文件 → **独立重跑设计全部关键实测依据**（yjs 载体行为 6 项探针、TS2322 复现、vfsl compile 失败形状 5 例、thunk 卡死复现）→ 攻击面扫描
- 结论摘要：设计的主体架构（微任务起步队首 P0、promise-chain FIFO、七键闭包、失败三级分级、双指纹同源）经攻击后成立，时间线与 ADR 映射扎实；但存在 **公共读取面可泄漏 live writable Yjs 引用**（ADR-0008 明文条款违背）与 **META 载体异常静默 null**（虚假降级立法命中）两个必须修订的设计洞，以及两处「设计自身不变量 vs 伪代码」的结构性缺口。

---

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议 |
|---|--------|--------|---------|------|
| 1 | **CRITICAL** | D4 `getSchemaEnvelope` 四键原始投影 | 伪代码 `if (v !== undefined) out[k] = v` 把**任意非 primitive 值原样带出**——SCHEMA 四标准键持有嵌套 Yjs shared type（如 `sc.set('version', new Y.Map())`，实测可存可读）时，公共读取面把 live writable Yjs 引用交到调用方手里 | D4 ③ 增加值域守卫：四键值非 primitive（object/function/symbol，含一切 `Y.AbstractType`）→ loud throw（与 D5 `MetaProjectionError` 同级），绝不进入返回值；primitive 值类型错（version 存 string）维持原样带出 |
| 2 | **CRITICAL** | D5 `getMetadata` 载体缺席/异型分支 | 载体缺席（share 无 'META'）/异型（Y.Text）→ **静默返回 null**，任何状态位均不可观测。经 createDoc/loadDoc 可达的 doc 恒有 META Y.Map（`validateCreateDoc`/`restoreAndValidate` 强制 META.docId 匹配），前提在正常流程恒满足 → 按虚假降级立法这是「上游 bug 被降级掩盖」，且与 D5 自身「值域违规 loud」用同一论证链得出相反结论 | 缺席/异型 → loud throw（`MetaProjectionError`，新 code 如 `NSRT-META-E2`）；若坚持 null，必须在设计中显式给出一条可达的合法缺席路径并文档化（目前仅 `seedForTest` 测试设施可造无 META doc，需援引说明） |
| 3 | **MEDIUM** | INV-N4 vs §5 伪代码排序 | `Object.freeze({ userId: handle.owner.userId })` 与 `namespaceId: handle.docId` 在 **P0 enqueue 之后**求值（§5 L396-399），而 V1 形状守卫不校验 owner/docId——残缺 handle 时构造 throw 发生在入队后，P0 微任务照跑（触碰 doc、写 state），INV-N4「构造 throw 零副作用——不入队、不触碰 doc」被结构性违反 | 伪代码重排：owner/docId 与 doc 一并在 enqueue **之前**捕获；或在 V1 补 `owner.userId: string`、`docId: string`、`doc: object` 三项校验（零成本纯移动/纯增补） |
| 4 | **MEDIUM** | INV-N12 vs D6/D7 槽体 catch 覆盖面 | env 字面量 `{ doc, state, p0Gate: input.p0Gate, compile: input.compile ?? ... }` 在 **thunk 内、runP0 的 try/catch 之外**求值，并对 seam 输入做**二次读取**（V1 已各读一次）。flaky getter 首读通过、次读 throw 时（实测复现）：thunk 同步 throw → P0 **永久卡死 preparing、fatal 永不置位**，且 reject 被链尾接线吞掉零噪声——「槽体全 catch」承诺在 thunk 边界失效；未来写面落地后写将永远排在死 P0 后 | env 在构造栈内一次成型（`const p0Gate = input.p0Gate; const compile = input.compile ?? compileSchemaEnvelope;` 先捕获再入队），并把「seam 输入字段只读一次」写入 D1/V1 纪律；或 thunk 包 try/catch 归并到 ⑦ fatal |
| 5 | LOW | D7.4 envelope issue code 拼接 | `'SCHEMA_ENVELOPE_E' + issue.code` 假设 code 是数字串；seam 注入任意字符串 code 时产出 `'SCHEMA_ENVELOPE_EENV_TEST'` 类语义漂移串。冻结测试只断言非空字符串，不红 | 映射改为不假设 code 形态（直接透传，或用明确分隔符），或 D7.4 注记「E+code 拼接仅对 vfsl 闭集码有分类意义」。非阻断 |
| 6 | LOW | R4 fatal 原始异常显式丢弃 | internal fault 后 v1 完全无排障通道（status 不含原始 Error 属 ADR 要求，但设计中连包内诊断锚点都没留），复现是唯一手段 | 建议（非阻断）：预留 module-level 的 last-fatal 原因记录（不进任何公共面），或把「fatal 原因可观测性」登记为后续观测面 issue 的显式验收点 |
| 7 | LOW | §7.1「唯一方案」论证不完整 | include 收窄确实是正解（我独立复现 TS2322，且验证**放宽 seam 参数类型救不了**——TS2322 发生在测试文件自身 `: CompileSchemaEnvelopeResult` 注解上，与 seam 类型无关），但设计未写明这条排除论证，后续审者会重走弯路 | §7.1 补一句排除论证：「TS2322 位于测试文件自身返回类型注解，非 seam 参数类型可消解」。非阻断 |

### 攻击点详述（CRITICAL/HIGH/MEDIUM）

#### #1（CRITICAL）公共读取面泄漏 live writable Yjs 引用——ADR-0008 条款违背

**触发条件**：doc 的 SCHEMA 四标准键任一持有非 primitive 值。**无需上游 bug 即可达**：persistence `createDoc` 只校验 `META.docId`（`lifecycle.ts:385-390`），完全不校验 SCHEMA 内容；调用方 `createDoc(owner, id, docWithPoisonSchema)` 后把 handle 交给 seam 即可。实测（yjs 13.6.32，本机复现）：

```js
sc.set('version', new Y.Map());
sc.get('version') instanceof Y.AbstractType === true   // → D4 伪代码 out.version = <live Y.Map>
```

**影响**：
1. `getSchemaEnvelope()` 返回对象的 `version` 键是一个**可写的 live Yjs shared type**——调用方可对它 `doc.transact()` 直接改写 doc，**完全绕过 write sequencer**。ADR-0008 的单序列器模型（本任务的存在理由）被公共读取面击穿。
2. 直接违反 ADR-0008 L91 明文：「Runtime 不公开 handle、Y.Doc、**ROOT/SCHEMA/META live 引用**或生产构造器」（本 SA2 评审规则：违反条款 = CRITICAL）与 AC2 语义「不公开 writable Yjs reference」。
3. 与设计自身哲学矛盾：D5 对 META 值域违规 loud 的论证是「受控创建路径保证值域 → 违规 = 上游 bug → loud throw（拒绝虚假降级立法）」；SCHEMA 四键的 primitive 性由同一受控路径保证（ADR-0008 SCHEMA write 条款：「写入恰好 lang/version/id/text 四键」），设计却在 D4 选择「原始投影，不校验——值类型错原样带出」，§10 R2 只考虑了 `version` 存 string 这类 primitive 类型错，**没有考虑对象/shared type 值**。
4. 同仓先例一致反对泄漏：doc-runtime `copyPlainStrict` 对 plain subtree「嵌套 Yjs → 响亮失败」（read.ts 头注 D6）；载体投影读取的契约域就是「JSON-compatible plain value，禁止嵌套 Yjs shared type」（ADR-0008 读取条款）。D4 是唯一的例外通道。

**可执行修订要求**：D4 ③ 投影循环加值域守卫——`typeof v === 'object' && v !== null`、`typeof v === 'function'`、`typeof v === 'symbol'`（覆盖一切 `Y.AbstractType`）→ 抛 `SchemaProjectionError`（errors.ts 注册稳定 code，如 `NSRT-SCHEMA-E1`，message 含键名与违规 typeof，不含值内容）；primitive（string/number/boolean/null/undefined-省略）维持现有「原样带出/键省略」语义（compile ENV-3 收编，冻结测试不受影响——fixture 全 primitive）。同步修订：§10 R2 措辞（区分「primitive 类型错→带出」与「非 primitive→loud」）、§6.2 边界表 #7、INV 清单（建议新增 INV：公共读取面任何返回值不含 live Yjs 引用）。

#### #2（CRITICAL→HIGH 量级，按立法口径记 CRITICAL）META 载体异常静默 null——虚假降级

**触发条件**：META 条目缺席或异型（Y.Text 同名条目，`getMap` throw）。**正常流程不可达**：`createDoc`/`loadDoc` 均强制 `META.docId` 匹配（`lifecycle.ts` `validateCreateDoc`/`restoreAndValidate`），即经持久层生产路径可达的 doc **恒有 META Y.Map**；唯一的例外是 `seedForTest`（`lifecycle.ts`，显式标注 test seed，创建无 META 的空 doc——测试设施，非生产路径）。

**影响**：按 2026-05-07 三度立法判断标准——「这个条件在正常使用流程中应该总是满足吗？YES → 它不是降级，是 bug 被降级掩盖了」。`getMetadata() === null` 时调用方拿到一个语义不可区分的 null（是「没有 META」还是「数据撕裂/持久层 bug」？），且 status 面没有任何 META 相关字段可观测——**静默失败通道**。更深一层是设计内部自相矛盾：D5 用「createDoc 套件锁定 META.docId 校验 → 受控路径保证 → 违规即上游 bug → loud」论证**值域**违规要 throw，同一条论证链蕴含**载体必然存在且为 Y.Map**，设计却对载体缺席/异型选了静默 null——一个哲学、两种标准。

**可执行修订要求**（二选一，必须在设计中显式抉择）：
- (a) 缺席/异型 → loud throw（`MetaProjectionError`，code `NSRT-META-E2`，message 含观测到的载体形态）——与值域违规同级，立法正解；
- (b) 保留 null，但设计必须写明合法缺席路径（援引 `seedForTest` 语义）并把「META 缺席=测试设施可达、非生产状态」的判断记录进 D5 与 §6.2 #10 行。

冻结测试不受影响（fixture 恒有健康 META）。

#### #3（MEDIUM）INV-N4 与 §5 伪代码的排序矛盾

D1 声称「V1/V2 的任何 throw 都发生在入队与任何 doc 触碰之前——INV-N4 由『校验全部前置』结构性保证，无需补偿逻辑」。但 §5 伪代码实际顺序是：`const doc = handle.doc`（L380，enqueue 前 ✓）→ enqueue（L393）→ `handle.owner.userId`（L396，**enqueue 后**）→ `handle.docId`（L399，**enqueue 后**）。V1 只守卫「handle 为对象且 getStatus 为 function」，不校验 owner/docId。残缺 handle（`{ getStatus: () => 'ready' }`）→ 构造 throw，但 P0 已入队，微任务照样触碰 doc、迁移 state。INV-N4 被自己的伪代码违反；SA3 照伪代码实现则 SA4 按 INV-N4 验收必失败。修订：纯排序移动（把 owner/docId 投影提到 enqueue 之前）或 V1 增补三项类型校验，二选一写入设计。

#### #4（MEDIUM）槽体 catch 覆盖缺口 → P0 可静默卡死（实测复现）

D7 把 `runP0` 全体包 try/catch 承诺 INV-N12「P0 任务 promise 永不 reject（槽体全 catch）」。但 §5 的调用形态 `sequencer.enqueue(() => runP0({ doc, state, p0Gate: input.p0Gate, compile: input.compile ?? compileSchemaEnvelope }))` 中，**env 字面量在 thunk 内求值**，处于 runP0 的 try 之外，且对 `input.p0Gate`/`input.compile` 做第二次属性读取（V1 已各读一次做形状校验）。本机复现（flaky getter：首读返回 function 过 V1，次读 throw）：thunk 在 `.then` 回调内同步 throw → `settled` reject 被链尾接线 `settled.then(noop, noop)` 吞掉（无 unhandled rejection 噪声）→ **`schema.state` 永久停在 'preparing'，fatal 永不置位**，且 rootWrite.enabled 仍为 true（preparing 期可接纳）。v1 无写方法所以只表现为读得到 preparing；未来写面落地后所有写将永远排在死 P0 之后，零诊断。这是活性洞（liveness hole），不是安全性洞。修订：env 在构造栈一次成型 + D1 写明「seam 输入字段只读一次」纪律；或 thunk 体内 try/catch 归并 ⑦。

---

## 协议假设依据审查

**章节存在性**：✅ §12 存在，12 条假设逐条带依据栏与风险等级，无「应该/通常/预计」类无据推断措辞。

**依据可验证性（SA2 独立重跑，全部命中）**：

| 假设 | SA2 复现命令 | 结果 |
|---|---|---|
| #1-#4 yjs 载体行为（同引用返回/突变污染/嵌套 Y.Map 可存/getMap-on-Y.Text throw/share.has 语义/set undefined 键语义） | 在 `packages/namespace-runtime` 下 `node -e`（yjs 13.6.32）六项探针 | 六项全部与设计声称一致（P1 THROWS / P2 false→true / P3 same-ref+污染 / P4 YMap / P5 get undefined has true） |
| #9 TS2322 | 根仓 `tsc --noEmit --strict --exactOptionalPropertyTypes … probe.ts`（复刻注入字面量） | `error TS2322: Type '"ENV_TEST"' is not assignable to type 'SchemaEnvelopeIssueCode'` 逐字复现，且错误定位在测试文件自身注解（→ §7.1 收窄决策成立、且不可被 seam 类型放宽消解） |
| #6 compileSchemaEnvelope 失败形状 | `tsx -e` 实测 5 例（null/version-string/unknown-dialect/extra-key/TEXT_BAD） | null→ENV-1「实际收到 null」；version string→ENV-3；TEXT_BAD→`{kind:'vfsl', issue:{message:'VFSL-E100: …', line, column}}`——D7.4 映射表的两分支假设与真实形状一致；parse 错误 message 只引局部记号不含 SCHEMA 全文（INV-N7 成立）；envelope 错误 message 经 `sanitizeEnvelopeMessage` 单行化（设计声称的「单行 sanitizer 由 vfsl 构造点保证」核实于 envelope.ts:57-78） |
| #5 PromiseJobs 微任务语义 | 规范级引用（ECMAScript EnqueueJob），无需实测；设计机制分析与规范一致 | ✅ |
| #7/#8/#11/#12 vitest typecheck 范围 / 根脚本逐包枚举 / CI 矩阵 / `../src/index.js` 解析 | 直接读 `vitest.config.ts` / 根 `package.json:13` / `ci.yml` / 既有测试 | 全部属实（typecheck include 仅 `*.test-d.ts`；六包显式串联；Node 20/24 跑 typecheck+test；六包测试同款相对导入） |
| #10 MemoryPersistence 同实例 | `testing.ts:241-244` `expect(handle.doc).toBe(doc)`；`lifecycle.ts` issueHandle/cell 缓存 | ✅ |

**结论**：协议假设依据审查**通过**——依据栏可定位、命令可重跑、无实测声明缺输出。§12 #1-#3/#9 引用的 `/tmp/sa1-verify/` 脚本本体已不在，但 SA2 已用独立等价探针全部复现，依据可信。

## 错误处理链路审查

本任务无 UI/外部 API 调用面；「用户可感知性」映射为「调用方可观测状态」。逐项：

- **静默失败检查**：❌ 命中两处——(1) 攻击点 #2：META 载体缺席/异型 → null，调用方不可区分合法态与 bug，status 面无任何 META 可观测字段；(2) 攻击点 #4：thunk 边界 throw → P0 永久 preparing、无 fatal、无 unavailable，rootWrite 位还在说 true——状态机「卡在中间态」本身不可观测。
- **状态闭环检查**：✅（除 #4 外）P0 全部失败路径（compile ok:false / compile throw / gate reject / 畸形 ok:true / 空 issues）均汇入 unavailable 或 fatal 两个终态，INV-N12 在 runP0 体内成立；#1 的泄漏不改变状态但属于「带毒通过」。
- **降级路径检查**：✅ `persistence-degraded` → 写位 false、读与 P0 照常（ADR-0008 明文，非伪降级——degraded 是真实可达状态）；外部违约 release → 写位 false、读取继续（显式边界 R3）；SCHEMA 缺席/异型 → null → compile ENV-1 → unavailable（可观测，ADR 数据失败正典通道，非伪降级）。
- **虚假降级识别（2026-05-07 三度立法）**：❌ 命中一处——攻击点 #2（META 载体前提在正常流程恒满足，null 分支掩盖上游 bug）；攻击点 #1 属同类病灶的变体（前提违规被「原样带出」而非降级，但同样是「本应 loud 的前提违规被静默吸收」）。两者均要求改为 loud assert。
- **极端异常输入**：✅ 设计边界表 §6.2 覆盖 16 条；本报告补充的缺口为 #3（残缺 handle 的 owner 解引用时点）与 #4（thunk 内求值抛点）。
- **竞态/死锁**：✅ 单线程 JS + state 单点写入（§6.3 论证成立）；P0 同步执行死锁路径被微任务起步排除（设计论证正确）；gate 永不 resolve = 有意挂起（与 close 无条件排空纪律一致）。双 runtime 同 handle 不防御——已按租约契约显式豁免（边界 #15，ADR-0006 lease 模型，可接受）。

## 红线测试思路（SA6 冻结面之外，供 SA4/SA7 与后续测试补位）

1. **live 引用泄漏红灯（#1）**：`sc.set('version', new Y.Map())` 后 `createDoc` 交 seam → 断言 `getSchemaEnvelope()` **throw**（或结果联合失败）且任何返回键值不满足 `v instanceof Y.AbstractType`；再断言 P0 收到的注入 compile 信封同样不含 live 引用（`JSON.stringify` 可序列化）。反向锁定：四键全 primitive 但类型错（version 存 string）→ 不 throw、原样带出（防修订过度收窄）。
2. **META 载体异常红灯（#2）**：用 `seedForTest` 造无 META doc（或直接 new Y.Doc + getMap('META') 异型）交 seam → 按修订后语义断言：loud throw（方案 a）或恒定 null + 文档化（方案 b）；同时断言「该 doc 上其余四个读取面照常」，证明 loud 不产生横向副作用。
3. **构造零副作用红灯（#3）**：注入 `{ handle: { getStatus: () => 'ready' } }`（无 owner/docId）→ 构造 throw 后，用注入 compile 计数器断言 compile **从未被调用**（即 P0 未触碰 doc）——把 INV-N4 变成可观测断言。
4. **P0 不卡死红灯（#4）**：flaky getter 注入（`get compile()` 首读 function、次读 throw）→ 断言有限时间内 `schema.state` 离开 preparing 进入 fatal（或构造时一次性读取使 getter 二变不影响 runtime——两种修订各自的红灯形态）。
5. **回归护栏**：#1/#2 修订后必须重跑三冻结文件全绿（fixture 均 primitive/有 META，理论零影响，需实测确认）。

---

## 验证证据索引（SA2 评审期间执行的命令与结果）

| 命令 | 结果摘要 |
|---|---|
| yjs 六项探针（`packages/namespace-runtime` 下 node，yjs 13.6.32） | getMap-on-Y.Text THROWS ✓；share.has false→lazy true ✓；ContentAny 同引用返回+突变污染存储 ✓；嵌套 Y.Map 可存入 Y.Map ✓；`set(k,undefined)` has=true/get=undefined ✓；**四键持有 live Y.Map 可读出 ✓（攻击点 #1 实证）** |
| `tsc --noEmit --strict --exactOptionalPropertyTypes … probe.ts` | TS2322 逐字复现，定位于测试文件自身注解（§7.1 决策 + 攻击点 #7 排除论证实证） |
| `tsx -e` compileSchemaEnvelope 5 例 | null→ENV-1；version string→ENV-3；unknown dialect→ENV-4；extra key→ENV-5；TEXT_BAD→kind:'vfsl'（D7.4 映射输入形状核实；message 无 SCHEMA 全文） |
| thunk 卡死复现（node 模拟 §5 enqueue 形态 + flaky getter） | state 永久 preparing、fatal 不置位、无 unhandled rejection（攻击点 #4 实证） |
| 源码核对 | 根 package.json:13 六包串联 ✓；vitest typecheck 仅 test-d ✓；ci.yml Node 20/24 ✓；pnpm-lock importer 已登记（L80）✓；persistence `validateCreateDoc` 仅校验 META.docId ✓（攻击点 #1/#2 可达性依据）；`seedForTest` 可造无 META doc ✓；doc-runtime read.ts 透传语义/结果联合 ✓；ADR-0008 L91 条款原文 ✓ |

## 放行条件（SA1 修订后重审范围）

1. **必须**：按 #1 修订 D4（值域守卫 + R2/边界表/INV 同步更新）；按 #2 在 D5 显式抉择 loud 或文档化 null 的合法路径；按 #3 重排 §5 伪代码或扩 V1；按 #4 改 env 一次成型 + 单读纪律。
2. **建议**：#5 映射注记、#6 fatal 诊断锚点、#7 §7.1 排除论证补句。
3. 修订仅涉及设计文档条目，不动冻结测试；修订后 SA2 只需复审差异段（D1/D4/D5/D6/D7/§5/§10），不需要全量重审。

（本报告为 SA2 唯一可写产物；未修改任何生产代码、测试代码或 SA1 设计文档。）

---
---

# R2 复审（2026-08-23）

**复审对象**：`wiki/raw/task_namespace-runtime-skeleton-p0_design.md` R2 修订版（622→719 行，差异段标注「R2 修订」+「SA2 反馈逐条回应」表）。
**复审方法**：按 R1 放行条件第 3 条只复审差异段（D1/D4/D5/D6/D7/§5/§10），但对 R2 **新引入的面**（双模式投影、不对称可达性论证、新增不变量 INV-N13/N14、新源码引用 §12 #13/#14）做了新鲜攻击扫描，并对关键新声明**重新实测**（不采信设计自述）。总控注记确认：relevant_decisions.md「设计引入的新决策点」中 D4/D5 两条为 R1 快照、已被 R2 超越，以设计文档 R2 为权威——本复审按此口径执行。

## 逐项落实核实

| R1 攻击点 | 落实 | 核实方式与结论 |
|---|:--:|---|
| **#1 CRITICAL** D4 泄漏 live Yjs 引用 | ✅ | INV-N13 新增（§2）；D4 重写为双模式投影 + 值域守卫：非 primitive 值（`typeof v === 'object' && v !== null' / function / symbol）→ 公共面抛 `SchemaProjectionError`（`NSRT-SCHEMA-E1`，message 含键名+typeof 不含值）、P0 面违规键**省略**（live 引用绝不进 compile 输入，缺键由 ENV-2 收编 → unavailable 非 fatal）；§5 传 mode、§6.2 #7 收窄/#17 新增、§10 R2/R7、§12 #13 双源依据。**守卫条件覆盖性核实**：`Y.Map`/`Y.Text`/任意 shared type 与 **Uint8Array**（实测 yjs ContentBinary 可存，`typeof` 为 'object'）全被 object 分支捕获；`null` 正确透传（非引用非可执行，进 compile 由 ENV-3 收编）；primitive 类型错（version 存 string）维持原样带出——R1 红灯反向锁定被采纳（§6.2 #7「不 throw」）。**分级正确性核实**：毒化 SCHEMA → P0 unavailable（数据级、SCHEMA write 可修复）与「internal exception → fatal」的边界划分成立（守卫的省略是确定性路径，compile 仍返回结果联合）。冻结测试零影响核实：三 fixture 四键全 primitive，新 throw 分支不可达。 |
| **#2 CRITICAL** D5 META 载体静默 null | ✅（方案 a：loud） | D5 重写：载体缺席/异型 → 抛 `MetaProjectionError`（`NSRT-META-E2`）；返回类型删 nullable。**不对称可达性论证的源码依据逐条核实**：`lifecycle.ts:385-391` validateCreateDoc 仅校验 `META.docId` ✓、`lifecycle.ts:396-403` restoreAndValidate 同款 ✓、`seedForTest`（229-246）为唯一无 META 来源（测试设施）✓、共享套件 `testing.ts:493-500`「Missing META entirely is also a mismatch」→ reject ✓、`testing.ts:502-507`「Permissive: correct docId, no SCHEMA, no ROOT」→ 接受 ✓（本轮 sed 实读原文）。R1 指出的「一个哲学两种标准」矛盾消除：统一为「生产不可达 → loud / 生产合法可达 → 可观测缺席信号」单一判据，且 SCHEMA-null 与 META-throw 的两侧可达性都有测试套件锁定。 |
| **#3 MEDIUM** INV-N4 排序矛盾 | ✅（双保险） | D1 V1 增补 `owner.userId: string / docId: string / doc: object` 三项校验；V3 拆 a-e 子步，身份捕获（V3a）全部前置到入队前；§5 伪代码同步重排，owner/namespaceId 由 V3a 局部量构造。**逐行核实 §5 伪代码入队后残余求值面**：V3d `enqueue` 之后仅剩 `Object.freeze({userId})`、七键字面量（全部已求值局部量/函数表达式）、`Object.freeze(runtime)`——**无 handle 成员解引用、无可抛点**，INV-N4「校验全部前置 + 身份捕获前置」从伪代码层面结构成立。§6.2 #20 把 R1 红灯形态（compile 计数器为零）写入边界表。 |
| **#4 MEDIUM** thunk 卡死（INV-N12 缺口） | ✅（主方案） | INV-N14 新增；V3b seam 单读捕获、V3c env 一次成型（纯数据闭包，不含 `input.*` 引用）、V3d thunk = `() => runP0(env)` 纯调用。**可抛点分析**：env 为构造栈内预构 plain object；`runP0` 为 async 函数（同步调用恒不 throw，只返回 promise）——R1 实测复现的卡死路径（env 字面量在 thunk 内求值 + seam 二次读取）被**结构性消除**，不是靠 catch 补丁。「槽体全 catch」从愿望变为结构事实的声明成立。§6.2 #19 记录 flaky getter 场景的封闭性。 |
| **#5 LOW** D7.4 拼接语义漂移 | ✅ | 改为 `'SCHEMA_ENVELOPE_' + String(issue.code)` 不透明段透传，分隔语义明确（注入 `ENV_TEST` → `SCHEMA_ENVELOPE_ENV_TEST`），注记分类意义仅对 vfsl 闭集码成立。 |
| **#6 LOW** fatal 无排障通道 | ✅ | D7 ⑦ 增 `state.fatalCause = err`（闭包私有）；**公共面泄漏核查**：`buildStatus`（§5 status.ts）不引用 fatalCause、activeInfo/runtime 七键均不触及——INV-N5/N7 不变 ✓；§10 R4 把「fatalCause 消费/上报」登记为后续观测面 issue 显式验收点。 |
| **#7 LOW** §7.1 缺排除论证 | ✅ | 依据链第 3 条补句：TS2322 位于测试文件**自身返回类型注解**（非 seam 参数类型可消解），并援引 SA2 独立复核同结论——与本报告 R1 验证证据一致。 |

## R2 新引入面复扫（不限于回应表）

1. **双模式 `projectSchemaEnvelope(doc, mode)`**：两模式共享键集/缺席/异型语义，仅非 primitive 值的出站纪律不同——「同源单点、不可能分叉」声明成立；mode 是包内参数不进公共面。
2. **不对称处置 vs ADR**：D4 公共面 throw 与 D5 载体 throw 均非「coherence 或补默认值」（throw 不是 coercion）；ADR-0008「预期路径、载体和 lifecycle 失败使用同步结果联合，只有 internal bug 才抛异常」条款作用域在 `readLogicalValueAtPath` 逐条清单（D3 透传未动）；SA8 在 R1 已对 D5 值域 loud 裁 no-conflict，R2 只是把同一纪律补齐到载体/SCHEMA 分支——无新增 ADR 冲突面。
3. **多键违规确定性**：多个标准键非 primitive 时 P0 模式全部省略 → ENV-2 聚合列全缺键（vfsl validateEnvelopeShape 并行全收集）→ 单条确定性 issue 摘要 ✓。
4. **毒化 SCHEMA 的横向隔离**（§6.2 #17「其余四个读取面不受影响」）：read 只碰 ROOT、getMetadata 碰 META、getActiveSchema/getStatus 碰 state/handle——核实成立。
5. **文件范围**：§11 与 R1 同集（仅 errors.ts 描述随两个新错误码更新），ALLOW/DENY 无增删，冻结测试零触碰 ✓。

## 残留注记（非阻断，建议 SA1 在 SA3 动工前顺手修正；不构成重审条件）

- **N1（表述精度）**：INV-N14 字面「seam 输入对象的每个字段在构造栈内**只读取一次**」与 D1 V3b/§5 实际形态（V1 校验读一次 + V3a/V3b 捕获读一次 = 构造栈内二次，均在入队前）不一致。**实质安全性质已核实成立**（入队后零读、thunk 零求值面、无可抛点），双读均在构造栈内且任何 throw 前置于入队——无行为洞。建议措辞精确化为「构造栈内有限次、入队后零次」，或实现时把 V1 校验与捕获合并为一次读取。
- **N2（表述精度，实测反例）**：D7 ③ 注释与 §6.2 #17 声称「信封恒 **JSON.stringify 可序列化**」——对 bigint 不成立：实测 yjs ContentAny **可存 bigint 且 round-trip 保真**（`sc.set('version', 10n)` 存取正常），而 `JSON.stringify({version: 10n})` 抛 `Do not know how to serialize a BigInt`。**非安全洞**：bigint 非 live 引用不泄漏（INV-N13 实质完整），进 compile 由 ENV-3/ENV-4 结构化收编（typeof 'bigint' ≠ 'number' → 错型；≠1 → 方言不符），行为正确。建议把该表述收窄为「信封零 live Yjs 引用/可执行体（bigint 等 JSON 边缘 primitive 可通过，由 compile 严格门收编）」；SA4/SA7 写红灯测试时以 `instanceof Y.AbstractType`/`typeof` 断言为准，**不要用 JSON.stringify 作断言**。

## R2 验证证据（本轮执行的命令与结果）

| 命令 | 结果摘要 |
|---|---|
| `sed -n '485,510p' packages/persistence/src/testing.ts` | L493「Missing META entirely is also a mismatch」→ reject；L502「Permissive: correct docId, no SCHEMA, no ROOT, garbage createdAt」→ 接受——§12 #14 不对称可达性依据**逐字属实** |
| `sed` lifecycle.ts 385-404 / 229-232 | validateCreateDoc@385 仅校验 META.docId ✓；restoreAndValidate@396 同款 ✓；seedForTest@229 ✓——行号引用全部准确 |
| yjs bigint/Uint8Array 探针（node，yjs 13.6.32） | bigint 可存可 round-trip（`10n` 保真）且 `JSON.stringify` 抛异常 → 注记 N2；Uint8Array 可存、`typeof` 'object' → D4 守卫 object 分支覆盖 ✓ |
| 设计 R2 全文通读 + §5 伪代码入队后求值面逐行核查 | V3d 后无可抛点（#3 落实）；thunk 纯调用零求值面（#4 落实）；fatalCause 不进任何公共面（#6 落实） |

## R2 最终结论

**Verdict: pass。**

- R1 的 4 个阻断攻击点全部按建议方向落实且经独立核实（含守卫覆盖性、可达性论证源码逐条对读、伪代码求值面逐行分析）；
- 3 个 LOW 建议全部采纳；
- R2 新引入面（双模式/不对称判据/新不变量）经新鲜扫描未发现新攻击点；
- 残留 2 条表述精度注记（N1/N2）零行为/安全影响，登记给 SA1 顺手修正 + SA3/SA4 实现与测试编写注意事项（红灯断言用 instanceof/typeof，不用 JSON.stringify）。

**边界声明**：pass 仅表示**设计文档**通过 SA2 攻击评审；不替代 SA4 对实现与设计逐条比对的静态门禁、SA7 对活链路与真实时序的验证。本任务的行为正确性最终以 SA6 冻结测试转绿 + SA4/SA7 验收为准。
