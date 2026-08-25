# SA2 攻击评审报告

**Date**: 2026-08-25
**Verdict**: ~~reject~~ → **pass**（R2 重审，见文末「R2 重审」节；R1 六点全部落实，新发现仅 2 项 LOW 建议）
**R1 Verdict**: reject（攻击点 #1/#2/#3 须 SA1 修订设计后再审；#4–#6 建议随同修订——已全部落实）

**被审对象**: `wiki/raw/task_namespace-runtime-integration-acceptance_design.md`（R1.1，含 SA8 N1 引文修正）
**ADR 约束基准**: `task_namespace-runtime-integration-acceptance_relevant_decisions.md`（ADR 0008 全条款 / ADR 0006 #79 修订 / ADR 0007 取代节 / R1 设计后复审追加 7 条）
**评审方法**: 全新视角独立攻击；设计期声明逐一实证复核（行号、字面量、调用点、git 基线、测试重跑、裁决链引文均亲自验证，证据见文末附录）

---

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议修订 |
|---|--------|--------|---------|---------|
| 1 | **HIGH** | §2「全量」矩阵完备性 + 修订节第 5 条穷尽清单 | **`SCHEMA_TEXT_INVALID` 漏出全量核对矩阵与修订节注册清单，且其法定归属声明失效。** 该码硬编码于 `packages/namespace-runtime/src/p0.ts:145`（P0 compile result failure → 稳定 schema issue 摘要），经 `getActiveSchema()`/`getStatus()` 的 schema 摘要**公共面可观测**——正是 ADR 0008 正文点名行为（「unavailable 与稳定 schema issue 摘要」）的可观测词汇，按设计 §2 自设判据（「ADR 只登记正文条款已点名的行为所对应的公共面可观测词汇」）必须出现在矩阵并获得裁决（入或不入 ADR 均可，但须有行、有理由）。连锁失真：(a) §2 矩阵自称「全量」却无此行；(b) 修订节第 5 条穷尽式括注清单（8 码）漏此码；(c) 第 5 条归属声明「其余 issue-message 级……稳定码以 `packages/namespace-runtime/src/errors.ts` 的 append-only 注册表为准」对它**不成立**——它不在 errors.ts，而在 p0.ts。修订节将以「SA3 原样落盘」写入已接受 ADR，落盘后即制造**新的文档-实现词汇差**——恰是本任务 §0 宣称要消灭的对象（「已点名词汇与实现最终词汇之间存在登记差」）。后续 SA6 式静态核对按第 5 条指引去 errors.ts 找「其余」码，将查无此码。附带：`SCHEMA_ENVELOPE_${code}` 动态透传族（p0.ts:137–141）也应获得一行归属裁决（建议：裁为「vfsl/doc-runtime 透传词汇，归属上游注册表」）。 | §2 矩阵补 `SCHEMA_TEXT_INVALID` 行（裁决建议：摘要实现码粒度低于 ADR、不入正文，但**必须显式登记归属**）；修订节第 5 条括注清单补 `SCHEMA_TEXT_INVALID`，归属声明改为「以包内 `errors.ts` 注册表及 `p0.ts` 等稳定码定义处为准」（或等效精确表述）；可加一行裁决 `SCHEMA_ENVELOPE_*` 动态族归属上游。 |
| 2 | **MEDIUM** | 修订节第 2 条「码域澄清」的域枚举精度 | **writable-gate 域被收窄为单一 persistence-degraded，遗漏 released/disposed 两态。** 实现事实：`write.ts:97–100` / `schema-write.ts:117–120` 的 gate 条件是 `handleStatus !== 'ready'`，disabled message 明文「persistence-degraded 阻止全部 Y.Doc 写；**released/disposed 同拒**」；#90 设计码表 L505 同（「handle 非 ready（degraded、released、disposed）」）。修订节第 2 条把该域描述为「persistence-degraded 写前 gate 拒绝」并宣称「覆盖四类」——按此文本，handle released/disposed 时的 `RUNTIME_WRITE_DISABLED` 结算落不进任何一类。「码域澄清」条款自身的域枚举与实现不对称 = 落盘后新的审计歧义（审计者将发现 ADR 修订节四类 vs 实现 message 三态同拒）。 | 该域措辞改为「写前 writable gate 拒绝（handle 状态非 ready：persistence-degraded / released / disposed）」，与实现 message 及 #90 码表对齐。 |
| 3 | **MEDIUM** | §4.2 CONTEXT「停接纳」词条边界 | **词条未锚定 #92 已裁决的 gate 边界，固化「公共面=全部公共方法」误读。** #92 relevant_decisions「设计后复审追加」第 2 条是解释性裁决：停接纳边界 = capability 三槽（`read`/`mutateRoot`/`replaceSchema`）；`getSchemaEnvelope`/`getMetadata`/`getActiveSchema`/`getStatus` 四个观测/投影 getter **全生命周期可用**（post-close 继续纯内存投影），并明文「若后续判定收紧属新决策，须升级总控」。词条草案总起句「公共面立即停止接纳新调用」在 CONTEXT（术语权威）层面比 #92 裁决宽——虽然冒号后枚举限定了三槽，但正文与 `_Avoid_` 均不防「观测 getter 也在停接纳范围」的误读。CONTEXT 词条是全链 SA 的对照基准（SA8 冲突报告对 CONTEXT 的对照义务），此缝隙可导致后续任务据词条与 #92 裁决互相矛盾地判读。 | 词条正文补一句（如「四个观测/投影 getter（getSchemaEnvelope/getMetadata/getActiveSchema/getStatus）全生命周期可用，不在停接纳范围」），或在 `_Avoid_` 增补「把停接纳误读为观测 getter 不可用」；语义单源仍归 ADR 0008 + #92 裁决。 |
| 4 | LOW | §5 协议断言口径一致性 | 断言 2 组正文零删除断言用 `git diff $BASE..HEAD`（仅覆盖已提交变更），而断言 5 组 scope 比对用 `git diff $BASE`（含工作树，注释明言「覆盖已提交+工作树」）。SA3 落盘后、commit 前，断言 2 的 `grep -c '^-[^-]'` = 0 **空转通过**——不检测工作树中 ADR 0008 的正文删除。防线时点依赖 SA4 恰好在 commit 后执行，未写入协议。 | 断言 2 统一为 `git diff $BASE -- docs/adr/0008-….md | grep -c '^-[^-]'`（工作树口径），与断言 5 一致。 |
| 5 | LOW | §3.5 计数口径 | 「存在性已逐一 `ls` 核实（设计期实测，13/13 OK）」——但 §3.5 复核矩阵实际引用的唯一锚文件为 **19 个**（本评审逐一核实 19/19 存在，含 `runtime-close-lifecycle-type-guard.test-d.ts`）。13 的计数口径未声明，与矩阵不符。 | 声明计数口径或更正为实际数（19/19）；实质无漏锚，纯精度修补。 |
| 6 | LOW | 修订节序言引用持久性 | §4.1 序言把 `wiki/raw/task_namespace-runtime-fatal-status-close_design_conflict_report.md` **文件名 + 行号 L39** 写入将落盘的已接受 ADR。wiki/raw 是任务档案，后续轮次更新会使行号漂移、路径失稳；仓内 ADR 修订节先例（ADR 0006 #64/#79、ADR 0001 命名修订）均只引用 **issue 编号**，不引 wiki 路径。 | 改为「issue #92 的 SA8 设计后复审报告」+ 报告名（去行号），与先例对齐；裁决链细节保留在 wiki/设计文档侧。 |

### 攻击点定级依据说明（防「为挑刺而挑刺」质疑）

- **#1 定 HIGH 而非 MEDIUM 的理由**：本任务唯一交付物就是「词汇收口注册」，其核心质量承诺是 §2 矩阵全量 + 注册清单不制造新差。#1 同时击穿两者（矩阵漏行 + 清单漏码 + 归属声明失效），且直接进入「SA3 原样落盘」的已接受 ADR——落盘后修正需再走一轮 ADR 修订（本设计 §1.2 的正当程序成本），与现在改一行的成本严重不对称。
- **#2/#3 定 MEDIUM 的理由**：同为落盘文本精度，但不推翻交付物结构，仅消除修订节/词条与实现及已裁决条款的不对称。
- **#4/#5/#6 为 LOW**：协议缝隙与引用卫生，不阻塞修订后放行，但建议随同修掉。

### 已攻击未破的防线（SA1 论证经受住攻击的部分）

- **N1 引文修正**：R1.1 §1.2/§4.1 的分层出处（让渡声明 = #92 设计后复审报告 L39；逐条登记 = 各 relevant_decisions「设计后复审追加」节）经原文核实**全部属实**（见附录证据 E4/E5）；码域逐域锚定（fatal=ADR L87、degraded=ADR L47+#90 L505、notifier=#90 追加节第 1 条、lifecycle=#92 追加节第 4 条）与原始档案逐条吻合。
- **D4 exports 审计三层证据**：值导出恰两键（`Object.keys` toEqual 穷尽断言，非 contains）、forbidden 运行时探测、`package.json exports = {".": ...}` 子路径封死（与 vfsl `getCompiledWith` 先例同款）——「不暴露包内 seam」防线经攻击成立。11 项类型导出清单逐一核对无 DocHandle/Yjs 引用出站（`NamespaceRuntimeSeamInput.handle` 为 ADR L91 明文授权的注入通道）。
- **D6 卫生 + §5 断言预演**：`.mabf-done` 当前 `git ls-files` 计数 1（删除未固化，commit 后归零，断言语义正确）；`.gitignore` MABF 段存在（L6–8）；ADR 0008 两码当前计数 0（落盘后 ≥1 断言有判别力）；ADR 0008 全文 111 行，L24/L45/L47/L81/L86/L87/L91/L93/L95 锚点原文逐一命中。
- **errors.ts 全部 12 个静态码的行号引用（16/23/31/38/41/49/52/55/59/87/104/138）与 disabled() 九处调用点（write.ts:79/97/102、schema-write.ts:105/117/122、runtime.ts:203/212）**：精确命中，无一漂移。
- **SA6 记录可复现**：三个验收测试文件重跑 3 files / 8 tests 全绿 + Type Errors: no errors——§8 协议假设依据「可被 SA4 验证（命令可重跑）」成立。

---

## 协议假设依据审查

- **章节存在性**：§8 存在，明示「无协议级假设」并对 §5 协议命令给出依据（设计期实测 + SA6 运行记录）——本任务纯文档/卫生收口，无 HTTP/WS/端口/进程/第三方库假设，判定合理。
- **依据可验证性**：抽查全部通过——行号引用（errors.ts 12 处、调用点 9 处、ADR 0008 9 个锚行、CONTEXT.md L73/L75）、grep 计数（WRITE=1/READ=0 缺口声明）、git 基线（HEAD=73811cd）、测试绿（本评审重跑 8/8）全部与设计声明一致；命令可重跑。
- **无据推断扫描**：未发现「应该/通常/预计」类措辞承载关键论证。
- **唯一例外 → 攻击点 #1**：「全量矩阵」的自我声明存在实质漏项（`SCHEMA_TEXT_INVALID`），属核对完备性缺陷而非无据推断；因直接进入落盘文本，按上述定 HIGH。

## 错误处理链路审查

- **静默失败**：无。交付链路为「SA1 设计 → SA3 落盘 → SA4/SA7 按 §5 协议核对 → Host CI」；§5 六组断言（grep 词汇计数 / diff 正文零删除与 scope / ls-files 删除固化 / check-ignore 防复发 / pnpm test / pnpm typecheck）任一失败即阻断，无「无输出+无反馈」路径。附注：`grep -c` 无匹配时 exit 1，协议以「期望值见行尾注释」人工比对——可接受，但见攻击点 #4 的口径缝隙。
- **状态闭环**：`.mabf-done` 删除固化有 `git ls-files` 计数 = 0 硬门禁兜底（当前计数 1，恰证明断言有判别力）。
- **降级路径**：无降级设计面（纯文档任务）；生产代码冻结（§7 DENY LIST），不存在运行时行为变更。
- **虚假降级**：未发现。不存在把正常路径前提缺失伪装成降级场景的设计；`MetaProjectionError` 的「拒绝静默 null（拒绝虚假降级）」等实现侧纪律与设计无冲突。

## 红线测试思路（静态核对型——本任务为文档收口，测试面为 §5 协议断言扩展）

1. **攻击点 #1 红灯**（注册清单穷尽性）：新增 §5 协议命令——
   `grep -rhoE "code: '(NSRT-[A-Z0-9-]+|RUNTIME_[A-Z_]+|SCHEMA_[A-Z_]+|MUTATION_[A-Z_]+|HANDLE_[A-Z_]+)'" packages/namespace-runtime/src | sort -u` 提取 src 内全部静态码字面量，与「ADR 0008 修订节第 1/2/3/5 条列举 ∪ errors.ts 注册表」做差集——**差集非空即红**（当前红灯实据：差集含 `SCHEMA_TEXT_INVALID`）。修订后差集应为空。
2. **攻击点 #2 红灯**（码域三态对称）：落盘后 `grep -c 'released/disposed' docs/adr/0008-….md` ≥ 1（修订节第 2 条含三态枚举）；对照锚 = write.ts:98 disabled message 原文。
3. **攻击点 #3 红灯**（词条边界）：落盘后停接纳词条正文或 `_Avoid_` 含「getSchemaEnvelope / getMetadata / getActiveSchema / getStatus」全部或「观测 getter」限定——`grep -c 'getStatus' CONTEXT.md` 相对当前值增量 ≥ 1；反向断言：词条不得含「全部公共方法」类无限定总起。
4. **攻击点 #4 红灯**（协议防空转）：SA4 演练——工作树态对 docs/adr/0008 追加一行临时内容后跑断言 2，工作树口径命令应使 `git diff $BASE -- <file> | grep -c '^+[^+]'` ≥ 1 被观测到（证明断言覆盖未提交态）；恢复后归零。
5. **攻击点 #5 红灯**：`ls` 逐一核对 §3.5 矩阵引用的唯一锚文件集合，计数与设计声明一致（当前实测 19/19 存在；声明数须与之相符）。

---

## 附录：本评审验证证据（命令 + 结果摘要）

- **E1 git 基线**：`git log --oneline -3` → HEAD = `73811cd`（#92 合入点，§5 base 声明属实）；`git status --short` → ` D .mabf-done`（已删未暂存）、三个 SA6 验收测试 `A`（staged）、`?? .mabf/`。
- **E2 码与调用点行号**：`grep -n` errors.ts → FATAL_P0=16 / FATAL_WRITE=23 / FATAL_SCHEMA_WRITE=31 / RUNTIME_WRITE_DISABLED=38 / NSRT-CLOSE-RELEASE-FAILED=41 / RUNTIME_READ_DISABLED=49 / MUTATION_INPUT=52 / SCHEMA_UNAVAILABLE=55 / HANDLE_NOT_USABLE=59 / NSRT-SCHEMA-E1=87 / NSRT-META-E1/E2=104 / RuntimeWriteFatalError=138——与设计 §2 矩阵全部一致；`grep -n "disabled("` → write.ts:79/97/102、schema-write.ts:105/117/122、runtime.ts:203/212（九处，与 §2 #2 一致）；runtime.ts:250 `function readDisabled(`、L70 `RuntimeReadDisabledResult` 接口。
- **E3 静态计数**：ADR 0008（111 行）`grep -c RUNTIME_WRITE_DISABLED` = 1（L87）、`RUNTIME_READ_DISABLED` = 0、`NSRT-CLOSE-RELEASE-FAILED` = 0；CONTEXT.md 两码均 0——SA6 缺口声明属实，落盘后断言有判别力。锚行 L24/L45/L47/L81/L86/L87/L91/L93/L95 原文逐一核对命中。
- **E4 裁决链引文**：#92 `task_namespace-runtime-fatal-status-close_design_conflict_report.md` L39 含「SA6 已把三个字面量……明文让渡给 SA1，属任务内授权」✓；#90 设计 L505 码表含「handle 非 ready（degraded、released、disposed）」✓；#90 relevant_decisions「设计后复审追加」第 1 条 = notifier 绑定 gate ✓；#92 relevant_decisions「设计后复审追加」第 3/4/5/6 条 = read 停接纳形状 / write 复用码 / close barrier 三细则 / close rejection 形状 ✓。
- **E5 攻击点 #1 实锤**：`grep -rno "'[A-Z][A-Z0-9_-]{6,}'" packages/namespace-runtime/src/*.ts | sort -u` → 13 个静态码，其中 `SCHEMA_TEXT_INVALID` 仅出现于 `p0.ts:145`（及 schema-write.ts:242 注释），errors.ts 无此码、§2 矩阵无此行、修订节第 5 条清单无此码；p0.ts:137–141 另有 `SCHEMA_ENVELOPE_${…}` 动态透传族。
- **E6 测试重跑**：`pnpm exec vitest run packages/namespace-runtime/test/runtime-acceptance-{fullchain,degraded-two-adapter,exports-audit}.test.ts` → **3 files / 8 tests 全绿，Type Errors: no errors**（SA6 记录可复现）。
- **E7 exports 防线**：`packages/namespace-runtime/package.json` → `"exports": { ".": "./src/index.ts" }`（子路径封死）；exports-audit 测试 `Object.keys(publicEntry).sort()` toEqual 恰两键（穷尽断言）；index.ts 类型导出 11 项逐一核对与 D4 清单一致。
- **E8 锚文件存在性**：§3.5 矩阵引用的唯一锚文件 19/19 存在（含 `runtime-close-lifecycle-type-guard.test-d.ts`、doc-runtime 2 个、persistence 2 个）。
- **E9 杂项**：`.gitignore` L6–8 MABF 段存在（TASK.md / .mabf-bg/，§4.3 diff 吻合）；CONTEXT.md 词条格式（`**词条**:` + 正文 + `_Avoid_:`）与 §4.2 草案格式一致；vfsl `index.ts:223–224` `@internal getCompiledWith` 先例属实。

## 结论

设计方向与裁决链（ADR 修订正当程序、D4 exports 审计、D5 锚定复核、D6 卫生）经受住攻击，但**核心交付物「词汇收口注册」自身存在完备性缺口（#1）与两处落盘文本精度缺陷（#2/#3）**——三者都将随「SA3 原样落盘」进入已接受 ADR / 术语权威 CONTEXT，永久化后修正成本远高于现在修订。**Verdict: reject**：要求 SA1 按上表修订 #1（必须）、#2（必须）、#3（必须），建议随修 #4/#5/#6；修订后交本 SA2 重审。pass 不替代 SA4/SA7 对落盘与活链路的后续验证。

---

# SA2 攻击评审报告 — R2 重审

**Date**: 2026-08-25
**Verdict**: pass（R1 六点全部真实、充分落实；新发现仅 2 项 LOW 建议，不构成重审门槛）

**被审对象**: SA1 设计 R2（276 行；R1.1 基础上落实 SA8 N1 + SA2 R1 #1–#6）
**重审方法**: 六点逐条真实性/充分性核验（含 R2 新增实现声明的实证）+ 新攻击面扫描 + **模拟落盘全断言演练**（将 §4.1/§4.2 草案文本拼接至 ADR/CONTEXT 副本，逐条跑 §5 断言——比静态判读更强的自洽性证明）

## R1 六点修订核验

| R1# | 落实 | 核验证据（命令 + 结果） | 充分性裁决 |
|---|:--:|---|---|
| #1 [HIGH] SCHEMA_TEXT_INVALID / SCHEMA_ENVELOPE 登记 | ✅ | ① 矩阵 #15/#16 新行事实全属实：`p0.ts:133–134`「@internal 导出（issue #91）…toIssueSummary」✓、SCHEMA_TEXT_INVALID 硬编码 p0.ts:145 ✓、errors.ts 无此码 ✓；② 判据段「法定居所 = 包内各定义处（errors.ts ∪ p0.ts）」与 #91 事实一致 ✓；③ 修订节第 5 条清单分两定义地 + SCHEMA_ENVELOPE 上游归属（与 p0.ts:135–138「不透明段透传…运行时不校验码域」注释一致）✓；④ **断言 6 算术独立复核**：`grep -rhoE "'[A-Z][A-Z0-9_-]{6,}'" packages/namespace-runtime/src/*.ts | tr -d "'" | sort -u` → **恰 13 码**，与期望集合（第 1/2/3 条 3 码 ∪ errors.ts 9 码 ∪ p0.ts 1 码 = 3+9+1=13）**逐码相符、差集空**；SCHEMA_ENVELOPE 模板字面量天然不在单引号提取面（实测提取列表无它）✓ | 充分。R1 HIGH 缺口三面（漏登记 / 归属声明失效 / 穷尽清单失真）全部闭合，且穷尽性由可执行断言固化（差集非空即红）——超出 R1 最低修订要求 |
| #2 [MEDIUM] writable-gate 三态域 | ✅ | ① §4.1 第 2 条改「写前 writable gate 拒绝（handle 状态非 ready：persistence-degraded / released / disposed 三态同拒）」+ 条款依据注（ADR L47 直接依据 + released/disposed 租约失效定性）——与实现 message（write.ts:97 / schema-write.ts:117）及 #90 码表 L505 对称 ✓；② §1.2 / §4.2 两处同步三态 ✓；③ 断言 6 第二式模拟落盘实测：ADR 副本 `grep -c 'released/disposed'` = **1**（≥1 通过，命中第 2 条附注句紧凑形） | 充分。四域枚举与实现完全对称。附健壮性观察 R2-O1（见下，不阻塞） |
| #3 [MEDIUM] CONTEXT 词条 gate 边界锚定 | ✅ | ① §3.2 D2 新增锚定 bullet（#92 追加节第 2 条 = gate 边界裁决 D7 解释性裁决——R1 已核该裁决原文属实：四 getter 全生命周期可用、收紧须升级总控）✓；② 词条总起句改「capability 三槽立即停止接纳新调用（read / mutateRoot / replaceSchema）」、正文补「四个观测/投影 getter…全生命周期可用，不在停接纳范围」、_Avoid_ 增第三项 ✓；③ 断言 6 第三式：CONTEXT 当前 `grep -c 'getStatus'` = **0**（「当前基线 0」声明属实，断言有判别力），模拟落盘后 = **1** ✓ | 充分。词条与 #92 裁决单源对齐，三类误读全部设防 |
| #4 [LOW] 断言口径统一 | ✅ | §5 断言 2 三式全部 `$BASE..HEAD` → `git diff $BASE`（工作树口径）+「落盘后、commit 前即有效（防空转通过）」注释；与断言 5 口径一致 | 充分 |
| #5 [LOW] 锚文件计数 | ✅ | §3.5 更正为 19/19 + 口径声明（矩阵 AC1–AC8 行唯一测试文件集合）+ 更正缘由如实注明——与本 SA2 R1 附录 E8 独立复核（19/19）一致 | 充分 |
| #6 [LOW] ADR 序言引用 | ✅ | §4.1 序言改 issue 号引用（「issue #92 的 SA8 设计后复审报告明文…」），无 wiki 路径、无行号；裁决链细节保留 §1.2 wiki 侧 | 充分，与 ADR 0006 #64/#79、ADR 0001 先例对齐 |

## R2 新增实现声明核验（R2 版引入的事实断言）

| 声明 | 出处 | 核验结果 |
|---|---|---|
| `getActiveSchema()` unavailable 期返回 null（五字段身份不可用，摘要不走该 getter） | §2 #15 / 回应表 | `runtime.ts:94` `getActiveSchema: () => ActiveSchemaInfo \| null`、`:197` `state.activeInfo ?? null` ✓ 属实 |
| toIssueSummary 为 #91 引入的 @internal，schema-write S4' 经 toReplacementIssue 消费 | §2 判据段 / #15 | `p0.ts:133` 注释原文即「@internal 导出（issue #91）：SCHEMA 写槽 S4' 同款码派生消费（toReplacementIssue）」；`schema-write.ts:38/145/243–244` 消费链属实 ✓ |
| 修订节引用的五个 ADR 0008 节名（读取能力 / 单一 write sequencer / P0 与 active schema / Fatal 与失败通道 / 生命周期、状态与所有权） | §4.1 各条 | `grep -n '^#' docs/adr/0008` → L12/L34/L49/L77/L89 **全部真实存在** ✓ |
| 断言 6「设计期 R2 实测 13/13 命中、差集空」 | §5 断言 6 注释 | 本评审独立重跑：恰 13 码、逐码相符 ✓ |

## 模拟落盘全断言演练（R2 自洽性实证）

方法：ADR/CONTEXT 副本 + 追加设计 §4.1（L145–156）/ §4.2（L162–164）草案文本，逐条执行 §5 断言：

| 断言 | 期望 | 实测 | 结果 |
|---|---|---|---|
| `grep -c RUNTIME_READ_DISABLED` ADR | ≥1 | 1 | ✅ |
| `grep -c RUNTIME_WRITE_DISABLED` ADR | ≥2 | 2 | ✅ |
| `grep -c NSRT-CLOSE-RELEASE-FAILED` ADR | ≥1 | 1 | ✅ |
| `grep -c RUNTIME_READ_DISABLED` CONTEXT | ≥1 | 1 | ✅ |
| `grep -c 'released/disposed'` ADR（断言 6 二式） | ≥1 | 1 | ✅ |
| `grep -c 'getStatus'` CONTEXT（断言 6 三式） | ≥1 | 1 | ✅ |
| 断言 6 全量提取 | 恰 13 码且集合相符 | 13/13 相符 | ✅ |

按 §4.1/§4.2 落盘后 §5 协议**全部自洽通过**——不存在「落盘后断言必红」的自相矛盾。

## 新攻击面扫描（R2 引入面）

- **R2-O1 [LOW，健壮性观察]**：断言 6 第二式 `grep -c 'released/disposed'`（紧凑形）与三态枚举主处「released / disposed」（带空格形）不匹配，实际命中点是第 2 条附注句的紧凑形「released/disposed 同属租约失效…」。当前断言语义成立（模拟实测 =1，已证明词汇入 ADR），但若后续编辑删附注句仅留枚举主处，断言将意外红。建议（非必须）：grep 模式放宽为 `'released ?/ ?disposed'`，或统一两处为同一字面形态。
- **R2-O2 [LOW，描述完备性]**：矩阵 #15 与修订节第 5 条把 SCHEMA_TEXT_INVALID 的公共可观测路径表述为「经 status 的 schema 摘要键可观测」——遗漏第二条公共可观测路径：**replaceSchema 结果联合的 issues[].code**（schema-write.ts:145 S4 编译失败 `r.issues.map(toReplacementIssue)` → :243–244 调 toIssueSummary 派生同款码；p0.ts:133 注释自证「SCHEMA 写槽 S4' 同款码派生消费」）。原文为非排他表述（「经…可观测」≠「仅经」），码已登记、归属正确，**不制造登记差**——不构成必须修订项；建议 SA3 落盘时在该句补「（亦经 replaceSchema 编译失败 issues 可观测）」或等效表述。
- 未发现其他新攻击面：R2 对 R1 已通过防线（D1 正当程序 / D4 exports 三层证据 / D5 锚定矩阵 / D6 卫生 / §7 ALLOW-DENY 结构）为零回归增补；断言 2 口径统一未引入新缝隙；修订节第 5 条增长文本中的全部事实声明经核验无失实。

## R2 结论

R1 三个必须修订项（#1 HIGH / #2 MEDIUM / #3 MEDIUM）全部真实且充分落实——#1 的穷尽性守卫（断言 6）经本评审独立重跑确认算术自洽（3+9+1=13、差集空），#3 的 #92 gate 边界锚定与实现事实逐点相符；三个 LOW 项一并落实。R2 新引入的实现声明全部属实；模拟落盘演练证明 §5 协议全断言自洽。新发现 R2-O1/R2-O2 均为 LOW 级建议（健壮性/完备性），不制造登记差、不阻塞落盘。

**Verdict: pass**——同意放行 SA3 落盘。建议 SA1/SA3 随同处理 R2-O1（grep 模式或字面形态统一）与 R2-O2（可观测路径补一句），两者均无需回炉重审。本 pass 仅覆盖设计层；落盘文本、scope 与活链路验证仍由 SA4/SA7 按 §5 协议执行。
