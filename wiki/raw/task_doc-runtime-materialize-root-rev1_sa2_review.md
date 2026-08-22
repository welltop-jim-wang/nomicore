# SA2 攻击评审报告

**Date**: 2026-08-22
**Verdict**: reject（窄幅驳回：仅 #1 必修 + #2~#5 顺带修订；RD1 出口 A / verifyInstall 双断言 / throw 形态与 RD2~RD6 矩阵架构全部经受住攻击，**无需返工，不得借此推翻 RD1 或回退出口 B**）

- 被审对象：`wiki/raw/task_doc-runtime-materialize-root-rev1_design.md`（SA1 修订轮 rev1 设计：RD1~RD6）
- ADR 约束基准：`wiki/raw/task_doc-runtime-materialize-root-rev1_relevant_decisions.md`（ADR 0001–0007 全 accepted）；设计红线 W1–W3 取自 `wiki/raw/task_doc-runtime-materialize-root-rev1_conflict_report.md`（verdict=clear）
- 评审方法：全新视角独立攻击 + 关键声明逐项实测复验（本报告 §实测复验记录，全部命令与输出内联，SA4/SA7 可重跑；探针脚本 /tmp/sa2-*.mjs|mts，yjs 经 dist 入口单实例加载）
- 任务简报：`wiki/raw/task_doc-runtime-materialize-root-rev1.md`（owner Review 7 项 + RAC-1~RAC-6）

## 结论一览

SA1 的核心裁决（RD1 出口 A：⑤ verifyInstall 顶层双断言 + throw DOCRT-E201）与六项 RD 的**主体架构经独立攻击后成立**：出口 B 否决论证（反虚假降级立法）成立；双断言必要性（W5）独立复现；W1 三禁（不 ok:false / 不补偿 / 不声称回滚）全文档一致；「attr-`"` 有意约束」有仓内成文注释佐证（xml-parse.ts:178-180 D7 规则 3）；RAC-2/3/4 的「现实现已达标」结论 10/10 + 抽样 6/6 独立复现；生产 caller=0 属实；E201 在 DOCRT 命名空间空闲属实。

**但 RD1 的契约面有一个实测证实的设计漏洞（#1）**：⑤ 的时点假设缺「本函数事务 = 最外层事务」前置条件。调用方在未闭合事务内调用 materializeRoot 时，observer 于外层 cleanup 才执行——⑤ 空转通过、`ok:true` 返回、随后 ROOT 被删改且无 E201。这恰是 owner P1 要消灭的「返回成功但文档已腐蚀」形态从侧门复活，而设计的 JSDoc 对检测面做了**无条件**宣称（「任何同步重入的 observer …… 都会被 ⑤ 检测」）。修复是登记 + 文档化（约 10 行设计改动），不需要改机制。

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议（可执行修订要求） |
|---|--------|--------|---------|------|
| 1 | **HIGH（必修）** | RD1/⑤ 时点假设 / INV-10 / JSDoc 契约 | **调用方持有未闭合事务时 ⑤ 检测被完全绕过，且设计未登记该边界。** yjs 事务合并：materializeRoot 的 `doc.transact` 若嵌套在调用方外层事务内，observer 与 update 事件在外层 cleanup 才触发。实测（§复验 P-1）：⑤ 位置 observerFired=0、verify 空转通过、updates=0（INV-10(a)「已在单次 Y.transact 提交」在返回时为假）；外层 cleanup 后 observer 删除计划键 + 插入 extra 键，函数早已返回 `ok:true`，无 E201——检测失效、INV-10(b) 事后被破坏。未来 create 流程（ADR-0006 三条目：SCHEMA+META+ROOT 单 update 单元）是高概率触发形态。设计缺陷三处：(a) §2.3 残余面登记 R-1~R-6 缺此情形；(b) §2.4 JSDoc「任何同步重入的 observer 对 ROOT 顶层的 delete/覆写/插入额外键都会被 ⑤ 检测」是无条件宣称，此场景下为假；(c) §12 P-R1「observer 同步重入的 ROOT 修改在 doc.transact 返回前全部落定」缺「最外层事务」限定词——§9.1 V7 的「嵌套事务场景」实测的是 materializeRoot 自身回调内嵌套/observer 侧嵌套，不是调用方包裹场景，证据与宣称错位 | ① §2.3 追加 R-7：「调用方在未闭合 Y.Doc 事务内调用 → observer 于外层 cleanup 才执行，⑤ 空转，INV-10 检测面失效——契约前提：materializeRoot 的事务必须是 doc 的最外层事务（调用方不得包裹）」；② §2.4 JSDoc 增加前置条件段（同上措辞），把「都会被 ⑤ 检测」改为「在本函数事务为最外层事务的前提下 ……」；③ §12 P-R1 补限定词并注明 P-1 复现编号；④ §10 R1 组加 1 条 characterization 用例锁定该边界（见红线测试思路 T-1），使「明文登记的边界」测试化，防未来静默漂移。**不建议**采用读 `doc._transaction` 的运行时 guard（私有 API 耦合，风险大于收益）；文档化前提 + 边界测试即 W1 相容的诚实形态 |
| 2 | MEDIUM | RD3/§4.3 X-F 断言模板 vs 简报 RAC-3 | X-F1~X-F8 模板只断言 `result.issues toEqual direct.issues`（相对锚），未断言「恰 1 issue」——简报 RAC-3 原文「失败场景**单 issue** + 零 update + state 不变」未获字面锚定；若未来 validate 对单违规输入产出多条 issue，该回归在 RAC-3 验收面内静默通过。实测（§复验 P-6）8 个输入在现 validate 全部恰 1 条 issue，加长度断言安全，且不与「不锁 fail-fast」的顾虑冲突（这些输入本就是单违规输入，锁的是这 8 行的行为而非 validate 的全收集语义） | §4.3 逻辑失败模板追加两行：`expect(direct.issues).toHaveLength(1); expect(result.issues).toHaveLength(1);`（保留 toEqual 透传断言不动）。构造失败行 X-F9/C-8 已有「恰 1」锚，无需改 |
| 3 | LOW | RD2/§3.2、RD4/§5.1 fixture 文本 | 表内 fixture 缺 VFSL 终止分号（`type ROOT = { u: unknown }`），实测 parseVfsl 即 E100「别名缺少终止分号」（§复验 P-2）；现有测试全部带分号（`type ROOT = { title: string };`）。该表自称「SA6 冻结契约」，照抄即前置红灯（fixture 缺陷 throw——响亮但浪费一轮） | §3.2 C-1~C-8 与 §5.1 用例 B 的 fixture 文本统一补终止分号（8 处 + 1 处） |
| 4 | LOW | RD1/§2.2「无假阳性」论证完备性 | ⑤ 用身份同一性（`===`）：observer「delete 计划键 + 重插**同值异实例** plain 对象」→ size 相等、identity 破坏 → E201，而文档语义与计划完全等价。这是**有意的保守检测**（检测身份级偏离），但 §2.2 论证 4「无假阳性」只论证了「诚实 observer 不触顶层」与「同值重插（W4，同实例）」，未覆盖「语义等价但实例替换」类；§2.3 亦无登记。读者会误以为 E201 ⟺ 语义偏离 | §2.3 追加一行登记：⑤ 检测的是**身份级**偏离——语义等价的实例替换（delete + 重插 deep-equal 异实例）也会 E201，属有意保守（身份不变量可精确构造，语义比较会引入 extract 怪癖假阳性）；一句话即可 |
| 5 | LOW | §9 实测证据完备性 / P-R11 | P-R11 宣称「RAC-3 成功矩阵**全部**行为在现实现达标」，但 §9.3/§9.4 实测清单缺 X-6（元素内注释 `<p>x<!-- note -->y</p>`）一行。本人补测：同串往返 + revalidate ok（§复验 P-5），结论实质成立，但证据表与「全部」宣称不匹配——SA4 静态验尸按 §9 逐条重跑时该行无锚 | §9.4 补 X-6 实测行（本人输出可直接引用：`"<p>x<!-- note -->y</p>" → out 同串 revalidate=true`），或 P-R11 措辞改为「17 行中 16 行实测 + X-6 由 SA6 表驱动测试落地时首证」 |
| 6 | NIT | RD6/§7 插入位置表述 | 「置于『Domain scaffolds check』之后」未言明相对「Generated projection freshness (regen-diff)」（ci.yml L51-56）的位置；建议明示「紧随 L49、在 regen-diff 注释块之前」以保持存在性门禁聚簇连续 | §7 补一句位置说明（不阻塞） |

（#6 为 nit 不计入驳回理由；#1 必修，#2~#5 随 #1 一并修订后即可放行。）

## 协议假设依据审查

- **章节存在性**：§12 存在，13 条假设（P-R1~P-R13），依据类型统一标注「设计期实测」并内联 §9 输出；无 HTTP/端口/进程级假设（声明与内容相符）。✅
- **依据可验证性**：本人独立重跑了承载结论的 9/13 条（§复验 P-1/P-3/P-4/P-5/P-6/P-7），全部复现；§9.1 的脚本骨架与「双实例陷阱」注记（必须 import dist 入口）真实有效——本人探针采用同法一次通过。✅
- **无据推断**：未发现「应该/通常/预计」类空依据条目。⚠️ 唯一缺陷即攻击点 #1：**P-R1 的表述（「observer 同步重入的 ROOT 修改在 doc.transact 返回前全部落定且可见」）在嵌套事务下不成立**——该断言只在 materializeRoot 的事务是最外层事务时为真，缺限定词，且被 §2.2 论证 1 与 §2.4 JSDoc 无条件引用。这是依据栏「以偏概全」形态（实测本身没错，外推范围错了）。
- **实测声称有命令有输出**：§9 各节命令与输出内联；本人复验输出见本报告 §实测复验记录，SA4 可对表重跑。

## 错误处理链路审查

（对象为库函数，无 UI/异步任务面；按立法项逐条）

- **静默失败检查**：⑤ 是 loud throw（DOCRT-E201，message 携带期望/实际键集与「写入已提交、不回滚、不补偿」明示）——最响亮路径无静默。**但攻击点 #1 正是静默失败形态的洞**：嵌套事务下「ok:true + 文档已腐蚀 + 无任何信号」——这不是设计有意为之（设计意图是全覆盖顶层向量），而是未登记的边界缺口，故按「虚假安全感」定 HIGH 而非按伪降级定 CRITICAL（出口 B 才是把该状态制度化的伪降级，已被 RD1 正确否决）。
- **状态闭环**：不适用（无 exStatus 类状态机）；F10/F11 与 ok:false 三出口在 §2.5 分界表收口完整、互不侵蚀，U13 收紧后的 `toThrow('observer-boom')` 兼任「⑤ 未吞并/未改写 observer 错误」守卫——闭环成立。
- **降级路径**：无运行时降级路径；对外部依赖（yjs）的行为假设全部实测锚定。W8（无 guard 重入 → RangeError）定义为引擎自毁式 loud 失败并配测试纪律（one-shot），处理正确。
- **虚假降级识别**：R-1（嵌套就地修改不可见 → ok:true）**不是**伪降级：设计明文登记为检测边界残余面、不做不可靠检测的理由成立（全树比较在退化 schema 上假阳性——基线 §6 L705 锚实存，本人核对该行存在）、治理归属上交 ADR-0007 observer 纪律，且检测承诺面从未夸大到嵌套层。R-2/R-3/R-4/R-5/R-6 同为诚实登记。**唯一未登记的边界就是 #1（R-7 缺位）**。
- **极端输入**：⑤ 本身只读 + throw，无新 panic 面；copyJsonDomain 六词拒绝与 E200 崩溃边界不变。

## 红线测试思路（SA6 落地参考；每攻击点至少一条）

- **T-1（攻击点 #1，R1 组新增 1 用例——嵌套事务边界 characterization）**：
  场景：`derivedOf('type ROOT = { title: string; count: number; };')`；注册 one-shot 偏离 observer（首次回调 `delete('title'); set('extra','E')`，并计数 observeCalls）；然后**在调用方外层事务内**调用：
  ```ts
  let result: MaterializeResult | undefined;
  doc.transact(() => { result = materializeRoot(derived, { title: 't', count: 7 }, doc); });
  ```
  断言：(a) `result.ok === true`（登记边界：外层事务内 ⑤ 空转——这是 R-7 的测试化）；(b) 事务返回后 `root.get('title') === undefined && root.get('extra') === 'E'`（偏离确已发生且未产生 E201）；(c) 注释标明「契约前提：materializeRoot 必须在最外层事务调用（设计 §2.3 R-7 / JSDoc）」。若未来实现改为 loud-guard 或检测到该场景，此用例需随设计同步更新——这正是 characterization 测试的目的（边界变化必须走设计评审，不得静默漂移）。
- **T-2（攻击点 #2，R3 组 X-F 模板追加）**：每行在 toEqual 透传断言前追加 `expect(direct.issues).toHaveLength(1)` 与 `expect(result.issues).toHaveLength(1)`（实测 8/8 为 1，§复验 P-6）；若未来 validate 变更导致某行多 issue，红灯即指认 RAC-3「单 issue」回归。
- **T-3（攻击点 #1 的正向对照已由设计覆盖，确认保留）**：R1 组既有「正向对照（observer 不触 ROOT → ok:true + ROOT===snapshot）」与「同值重插不误报（G4/W4）」两用例不可裁剪——它们是 ⑤ 无假阳性面的永久回归锚。
- **T-4（攻击点 #4，可选 1 用例）**：one-shot observer `rootMap.delete('u'); rootMap.set('u', { ...sameDeepValue })`（同值异实例）→ 断言 `toThrow('DOCRT-E201')`，把「身份级偏离含语义等价实例替换」的保守性一并测试化（与 #4 的登记行配套）。
- **T-5（既有矩阵照设计 §10 落地）**：R2 十行（含 ±Infinity、Y.Array 独立行）、R3 26 行、R4 三用例、U13 收紧——断言模板经本人复验与现行为一致（§复验 P-3/P-4/P-5），预期全绿落定。

## 实测复验记录（SA2 独立探针；环境 node v24.13.0 / yjs@13.6.32 / worktree 根）

- **P-1（攻击点 #1 证据）** `node /tmp/sa2-yjs-probe.mjs`：
  ```
  A plain-identity: true                          ← ContentAny 按引用，⑤ 同一性对 plain 载体成立（P-R8 复现）
  B detached-identity: true true                  ← detached Y.Map/Y.Array 集成后同实例（P-R8 复现）
  C nested: observerFiredAtVerify= 0 verifyPassed= true updatesAtVerify= 0
     | after-outer: fired= 3 updates= 3 size= 1 keys= [ 'extra' ]
                                                   ← 调用方外层事务内：⑤ 位置 observer 未触发、updates=0
                                                     （INV-10(a) 返回时为假）；外层 cleanup 后 title 已删、
                                                     extra 已插——ok:true 已返回且无 E201
  D outermost: sizeAfterTransact= 0               ← 最外层场景 P-R1 成立（observer 改动返回前可见）
  ```
- **P-2（攻击点 #3 证据）**：`parseVfsl('type ROOT = { u: unknown }')` 等 7 个无分号 fixture → 全部 `VFSL-E100: 别名缺少终止分号 ';'`。
- **P-3（RD2 复现）** `pnpm exec tsx /tmp/sa2-impl-probe.mts`：C-1~C-8 扩展 10 行（Date/bigint/NaN/±Infinity/Y.Map/Y.Array/数组内 undefined/n=NaN/attr-`"`）全部 `preValidate=true ok=false nIssues=1 updates=0 stateEq=true`。
- **P-4（RD4 复现）**：fixture B `matOk=true exOk=true deepU={"nested":{"deep":[1,"two",null]}} blob=["p1","p2"]`；突变输入（blob.push / deep.push / inner 改写）后 extract 不变、revalidate=true。`YPlainArray<YLeaf<string>>` 语法合法。
- **P-5（RD3 抽样复现）**：`<p>x<!-- note -->y</p>`（X-6，设计实测清单缺席行）→ 同串往返 revalidate=true；`<p title="a<b&c">x</p>` 同串；`<e b="2" a="1"/>` → `<e a="1" b="2"></e>`；`<e k='v' k='w'/>` → `<e k="w"></e>`；`""` → `""`；多根同串——与 §9.3/§9.4 一致。
- **P-6（攻击点 #2 证据）**：X-F1~X-F8 直调 validateLogicalSnapshot → 8/8 `nIssues=1`（标签未闭合/不匹配/注释/CDATA/PI 未闭合/DOCTYPE/裸 </属性未加引号）。
- **P-7（RD6/RAC-6 复现）**：`pnpm exec vitest run packages/doc-runtime/test/materialize-root.test.ts --typecheck --passWithNoTests=false` → `Tests 13 passed (13) / Type Errors no errors / 514ms`（exit 0）。
- **静态核对**：生产 caller=0（`git grep materializeRoot` 仅 index.ts 导出、测试、validate.ts:640 doc comment）；DOCRT 命名空间现占 E100（extract.ts:75）/E200（materialize.ts:96），E201 空闲；vfsl 裸 `E201: '201'`（errors.ts:19）异命名空间不冲突；U13 现为泛化 `toThrow()`（test L399）；测试文件 405 行 13 用例；ci.yml 先例步骤 L43-44/L48-49；基线 §6「已知边界」锚在 L705；xml-parse.ts:177-181 attr-`"` 拒绝注释成文（D7 规则 3——「有意约束」定谳的仓内佐证）。

## 对 SA1 的修订范围界定（防过度反应）

**保留不动**：RD1 出口 A 裁决与六维对照、⑤ 双断言算法与伪代码、DOCRT-E201 命名、F11 分类、JSDoc 主体、零 ADR 修订立场、RD2 十行矩阵、RD3 定谳与语义比较器、RD4 用例 A/B/C、RD5 收紧表、RD6 CI 步骤——以上全部经受住本次攻击并有独立复验支撑。
**必须修订**：攻击点 #1（R-7 登记 + JSDoc 前置条件 + P-R1 限定词 + T-1 用例）。
**顺带修订**：#2（X-F 模板两行断言）、#3（fixture 分号）、#4（一句话登记）、#5（§9.4 补一行实测）。
修订后无需重新走全量评审，SA2 复核 #1 落位即可放行。

---

# R2 复审记录（SA2）

**Date**: 2026-08-22（R2 修订后同日复审）
**R2 Verdict**: **pass**（放行进入 SA6 锚定 → SA3 TDD 实现）
**复审范围**：按 R1 报告界定的窄幅复核——#1 五点落位逐项核验 + #2~#6 抽验 + 约束遵守确认（RD1 出口 A 未推翻、行为规格零变更）。未做全量重审（R1 已完成全量攻击面扫描，R2 声明并经抽查证实无行为规格变更）。

## #1（HIGH）五点落位核验

| 落位点 | R2 设计位置 | 核验结论 |
|---|---|---|
| R-7 残余面登记 | §2.3 R-7 行（L232） | ✅ 成文完整：yjs 事务归并机理 + ⑤ 空转双断言 + INV-10(a) 返回时为假 + 「契约前提（非运行时 guard）」处置 + 未来 create 流程（ADR-0006 三条目单 update 单元）触发预警 + 不采用 `doc._transaction` guard（引 SA2 定谳） |
| JSDoc 前置条件段 | §2.4（L243-246） | ✅ ⚠️ 前置条件段成文（措辞准确：外层包裹 → observer/update 延迟至外层 cleanup → ⑤ 空转 + 返回时未提交）；成功语义第 2 条改为「**在上述前置条件成立的前提下**，任何同步重入的 observer …… 都会被 ⑤ 检测」——R1 指出的无条件宣称已消除；检测面边界段同步补入「前置条件被破坏时的全部 observer 反应」 |
| P-R1 限定 + 双源引证 | §12（L711） | ✅ 「仅当本函数事务为 doc 最外层事务时成立」限定词成文；依据拆**成立域**（G1/G7/N2）与**边界域**（N1 + SA2 P-1 独立复现）双源，可验证性达标 |
| T-1 characterization 用例 | §10（L670） | ✅ 断言 (a) `result.ok === true`（⑤ 空转）+ (b) 外层事务返回后 `title === undefined && extra === 'E'`（偏离确已发生无 E201）+ (c) 前提注释；fixture 带分号；「未来实现改为 loud-guard/检测须随设计同步更新」漂移条款在文——与 SA2 T-1 原文逐点对齐 |
| 一致性延伸 | §2.2 论证 1 前提化（L197-202）/ §2.5 表 R-7 行（L282）/ 摘要边界段（L33-37）/ §9.1 V7 标注自纠（L591-592） | ✅ 五处同口径（§15 自检 L816-817 抽查属实）；V7 实测标注改为「仅证可见性，无 observer」——R1 指出的「证据与宣称错位」被诚实自纠 |

**N1/N2 实测证据核验**：SA1 补测脚本 `/tmp/sa1-rev1-r2-verify.mjs` 真实存在且本人复跑 **PASS**：

```
PASS N1-nested-bypass → atVerify: fired=0 updates=0 sizeOk=true identityOk=true（⑤ 空转通过）
     | afterOuter: fired=3 updates=3 keys=["count","extra"] title=undefined extra=E
PASS N2-outermost-control → sizeOk=true identityOk=false keys=["count","extra"]（偏离被检测 → E201）
```

与 SA2 独立探针 P-1（不同 fixture、独立编写）逐字段同结论——双源互证成立；N2 最外层对照与 G5 同型互证（identity 断言抓出 delete+insert 组合）补齐了边界证据的对照面。

## #2~#6 抽验

| # | 核验结论 |
|---|---|
| #2 | ✅ §4.3 模板双断言在文（L429 `direct.issues toHaveLength(1)` / L433 `result.issues toHaveLength(1)`，引 P-6 8/8）；前置说明改为「锁这 8 个单违规输入的行为而非 validate 全收集语义」——RAC-3「单 issue」字面锚定达成 |
| #3 | ✅ C-1 fixture `type ROOT = { u: unknown };`（L316）与用例 B fixture `… u: unknown };`（L495-497）分号已补；T-1 行 fixture 亦带分号 |
| #4 | ✅ §2.3 R-8 登记行（L233，含保守理由与「message 措辞偏保守但不错误」的诚实分析）+ §2.2 论证 4 尾句 + §10 T-4 可选用例（L671）+ JSDoc「检测基准是身份同一性（===）而非语义等价」——超出 R1 要求的一句话登记，四处同口径 |
| #5 | ✅ §9.4 X-6 补录行（L645，标注 SA2 P-5 来源）+ P-R11 改「17/17 证据（SA1 16 行 + SA2 补测 1 行）」口径（L721）——「全部宣称 vs 证据」缺口消除 |
| #6 | ✅ §7 明示「紧随 L49（Domain scaffolds check 的 run 行）之后、在 L51-56 regen-diff 注释块之前」（L537-539） |

## 约束遵守确认

- **RD1 出口 A 未推翻**：⑤ 算法/伪代码、DOCRT-E201、F11 分类、throw 形态、W1 三禁表述零变更（R1 攻击中经受住的部分确实未动）。
- **行为规格零变更**：R2 全部修订为登记/文档/断言模板/测试计划层面；§11 ALLOW/DENY 文件清单不变；§8 F11 行不变。
- **RD2~RD6 零改动**（#2/#3/#5/#6 为断言强度与文档精度修订，不触矩阵结构与定谳）。

## R2 结论

R1 全部攻击点（1×HIGH + 1×MEDIUM + 3×LOW + 1×NIT）已逐条落实，且 #4/#5 的处理质量超出 R1 最低要求。#1 五点落位完整、口径一致、证据双源可重跑。**设计通过攻击评审，放行。**

- 后续 SA4 静态验尸可重跑锚：`node /tmp/sa1-rev1-r2-verify.mjs`（N1/N2）+ 本报告 R1 §实测复验记录 P-1~P-7。
- 后续 SA7 动态验证应覆盖：T-1（嵌套边界 characterization）与 R1 红灯测试思路 T-2/T-3/T-4 的落位形态。
- `pass` 仅表示设计通过 SA2 审查；实现与活链路验证仍由 SA4/SA7 承担。
