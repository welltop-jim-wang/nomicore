# 设计窄域复审（R1.1）— Issue #227（SA2 第 2 轮）

- 被审对象：`wiki/raw/task_issue-227_design.md`（SA1 **R1.1**——F-1 窄修 + N-1/N-2/N-3 备案；536 行）
- 复审范围：**窄域**（R0 §6.2 授权——只审修订日志所列增量 + SA8 冲突复审移交的 N-A/N-B/N-C 裁决）；R0 已逐项通过的 §3 租约三件套 / §3.5 三腿论证 / §5 词表骨架 / §7 清单 / §8 矩阵骨架不在本轮重攻击范围，仅做零漂移核查
- 参审材料：SA8 冲突复审 `wiki/raw/task_issue-227_design_conflict_report.md`（verdict=clear，移交 N-A/N-B/N-C 三条非阻断登记项）
- 复审方式：**全部独立重验**——不沿用 SA1/SA8 任何声明；本轮亲读比对：schema.ts:150–209（`AttemptResult` 八成员联合全文）、reader.ts:745–848（`StrictRecordUpdate`/`materializeStrictRecordUpdate`/`materializeCarrier`）、reader.ts:355–380（`enumerateSegmentGroups`）、reader.ts:562–587（⑤ ENOENT 分支）、diagnostic-replay.ts 全文 254 行（头注 :4–17 / ④ 循环 :122–213 / complete 门 :227–232 / 顶层 catch :243–252）、read-session.ts:100–231（renew/close/open 三 throw 面/segmentLeased）、pipeline.ts:100–154（`resultShapeValid`/`canonicalResult`）、SA7 重点 4 pin（sa7.test.ts :445–470 逐字）、index.ts:77–95（再导出消费面）
- 边界：零生产代码改动、零测试改动、零 git 操作；唯一写入 = 本文件
- Worktree：`/home/wangjian/nomicore-fix-issue-227`

## Verdict

**approve**（`requiresConflictRecheck: false`）

- **F-1 已消除**：R1.1 修订日志所列七处增量（§0.1-G4 / §4.1 补行 / §4.2 谓词收窄 / INV-227-5 / §5 语义行 / C4·D8 / §1 映射行）逐项独立核验**全部到位且语义正确**；对 schema 八成员联合做穷举求值，R1.1 分类下**不存在任何 `fatal ∧ committed:true` 形状可落入 `none` 推进而使 complete 可达**（见 §2.2 矩阵）。
- **N-A/N-B/N-C 均不阻断**：三条事实链经本轮源码亲验全部属实，但无一条构成「错误 complete 可达」或 ADR 违约；处置为**纳入实现/测试/文档清单**（§4，binding），不需要 SA1 再出 R1.2。
- 冲突门：SA8 已裁 clear；本轮裁定的三项处置**零新增码、零新增 health 事件、零 schema 触碰**（N-A 复用既有 `update-omitted` 通道、N-B 复用既有 `replay-internal-error` 通道、N-C 纯文档），不引入新的语义冲突面 → 无需再触发 conflict recheck。

---

## 1. R0 存档摘要（第 1 轮，verdict=reject——窄修型）

R0 对 R1 全量独立攻击：§0.1 五缺口（G1–G5）全部真实、锚点全部精确；§3.5 三腿论证、§4 其余攻击面、§5/§7/§8 骨架全部通过。驳回依据为单一实质发现 **F-1**：§4.1 分类表对 schema 合法形状空间不穷尽——`fatal ∧ committed:true ∧ effect 字段缺席`（schema.ts:178 第 5 成员）仍落 `none` → 推进 → complete 可达，与本票 fail-closed 总纲矛盾。随修备案要求 N-1（omitted×断链 issue 码翻转）/ N-2（pre-genesis 物化前置）/ N-3（P0 跳过触发 `retention-swept` 频率变化）。§11 四裁决点均表维持默认。

## 2. F-1 消除逐项核验（全部通过）

### 2.1 R1.1 增量清单 → 独立核验

| # | R1.1 修订日志声明 | 本轮独立核验 | 结论 |
|---|---|---|---|
| 1 | §0.1-G4 增补（effect 缺席形状 = schema.ts:178 第 5 成员，现状落 :817 `none`） | schema.ts:173–181 亲读：第 5 成员 `{kind:"fatal"; committed:boolean}`（:178）确无 effect；reader.ts:794–817 现状亲读：`effect` 缺席时 `undefined !== 'update-omitted'`（:801）∧ `!== 'update'`（:808）→ 落 :817 `return {kind:'none'}`——洞的存在与锚点双确认 | ✅ |
| 2 | §4.1 分类表补一行（effect 缺席 → 必要性不可证 → `{kind:'unknown'}` → issue + break → 否） | 设计 :294 行在表；「可达 complete？」列为「否 → partial」，与 §4.3 switch `'unknown' → issue update-unknown + break` 自洽 | ✅ |
| 3 | §4.2 判定收窄：`kind==='fatal' ∧ committed===true ∧ effect ∉ {'update','update-omitted'}` → `{kind:'unknown'}` | 设计 :311/:320–323 谓词亲读。关键语义验证：`effect` 缺席（undefined）∉ 集合 ⇒ 谓词为真 ⇒ 落 `unknown`；与字面 `'unknown'` 同归。谓词插在不变量 carrier 合取（现状 :807–810 原样保留）与 `none` 兜底之间，`none` 文档域收窄为 committed-noop/rejected/fatal-committed:false（含其 effect 放宽残差）——R-4 残差形状 `fatal/committed:false/effect:'update'` 求值为 line 2 不中（committed false）→ line 3 不中（committed≠true）→ line 4 `none`，**G-227-2 维持默认的裁定逐字兑现** | ✅ |
| 4 | INV-227-5 措辞扩 | 设计 :381：「`fatal ∧ committed:true` 的记录除非 `effect` 证明为 `'update'`/`'update-omitted'`，永不落入『无更新推进』分支（effect 字段缺席与字面 `'unknown'` 同归 `unknown` → issue + break）」——与 §4.2 谓词逐字等价，不变量可被 SA4 静态核验 | ✅ |
| 5 | §5/§7 对应行同步 | §5 `update-unknown` 语义行（:366）已扩为「字面 `'unknown'` 或字段缺席——R1.1-F1 收紧」；§7 reader.ts 行（:398）`none` 域收窄说明同步；**§5 仍恰四新码**（INV-227-10 不破） | ✅ |
| 6 | 测试增量 C4 / D8 | C4（:444）：手拼 `fatal/committed:true/（无 effect）` 行 → `{kind:'unknown'}`，对照 `fatal/committed:false/（无 effect）` → `{kind:'none'}`——**可构造性亲证**：`{result:{kind:'fatal',committed:true}}` 精确匹配 schema 第 5 成员 ⇒ strict 逐行 VFSL 校验过 ⇒ `entry.ok===true`；对照组保 R-4 推进面不误伤。D8（:457）：replay 端 `partial` + `update-unknown` + `lastAppliedSequence` 停在该记录前 + 前缀快照——与 §4.1 `lastAppliedSequence` 语义（:301）及 INV-227-6 一致；手拼法与 D6 既有先例同法。写侧不可达性亲证：`resultShapeValid`（pipeline.ts:115–123）对 fatal-committed-true 缺省 `return false`——「emitter 不可达、盘面可达」成立 | ✅ |
| 7 | §1 AC3/AC4 映射行同步 | AC3 行含 C4/D8；AC4 行含 D8–D9——映射闭合 | ✅ |

### 2.2 分类穷举矩阵（对 schema 八成员 × R1.1 谓词求值——本轮独立穷举）

| schema 成员（schema.ts:174–181） | 盘面变体 | R1.1 分类 | complete 可达 | 判定 |
|---|---|---|---|---|
| :174 committed/noop | — | none → 推进 | 可（合法 noop） | ✅ 语义保真（R1/SR1 基础） |
| :175 committed/update | update 合法 / 畸形 | update / invalid → break | 可 / 否 | ✅ |
| :176 committed/update-omitted | reason 在 / 缺 | omitted → break / invalid | 否 | ✅ |
| :177 rejected | — | none → 推进 | 可 | ✅（自证无提交，与 G-227-2 同理） |
| :178 fatal（无 effect） | **committed:true ∧ effect 缺席**（手拼/第三方 writer） | **unknown → issue + break** | **否** | ✅ **F-1 修复点闭合** |
| :178 fatal（无 effect） | committed:false | none → 推进 | 可 | ✅ R-4 域（自证无提交） |
| :179 fatal/update | committed:true / committed:false | update / none（R-4 备案残差） | 可 / 可 | ✅ |
| :180 fatal/update-omitted | committed:true / committed:false | omitted → break / omitted → break（**N-A 翻转，§3.1 裁定备案**） | 否 / 否 | ✅（fail-closed 方向） |
| :181 fatal/unknown | committed:true / committed:false | unknown → break / none → 推进 | 否 / 可 | ✅ AC3 点名形状闭合 / R-4 域 |
| 成员外怪形（如 `{fatal,committed:true,effect:'weird'}`） | 视 VFSL 未声明字段容忍度 | 落 :178 成员 ⇒ unknown；或 VFSL 拒 ⇒ entry.ok=false ⇒ invalid | 否 | ✅ 双臂均 fail-closed，无洞 |

**穷举结论：R1.1 分类下不存在任何 `committed:true` 形状落入 `none`——INV-227-5 字面成立，F-1 消除。**

### 2.3 零附带漂移核查（R0 已通过部分一字不动）

- §3.1 冻结常量（15_000 提名 + 1_000 margin）、§3.2.2 ④′ 包络、§3.2.4 vanished 矩阵、§3.3.1 `deleteGroupIfUnleased`、§3.3.3 open-group 双门、§3.4 replay 生命周期、§3.5 三腿论证——逐节与 R0 评审时内容比对无未申报改动；§3.3.2 新增的 N-3 备案句（:226）即 R0 N-3 要求的备案本体。
- N-1/N-2/N-3 备案三处全部到位：§4.3 两条 bullet（:347/:348）、§3.3.2 事件频率句（:226）、D4 乱序-omitted 变体（:453）、D9 pre-genesis pin（:458）、§8.5 备注（:471）。
- G-227-2 闭环：§4.4（:356）+ §10 R-4（:513）+ §11 注（:522）三处一致。
- 行数 515 → 536（+21），与「窄修、零架构变更」声明相符。

## 3. SA8 移交项 N-A/N-B/N-C 裁决（均不阻断，纳入清单）

### 3.1 N-A【备案 + D4 增 pin】`fatal ∧ committed:false ∧ effect:'update-omitted'` 的 replay 行为翻转——属实，选「维持现状分支 + 备案」方案

- **事实链本轮逐环亲验，全部属实**：schema :180 成员 7 `committed:boolean` 允许 false ⇒ 该形状 schema 合法；emitter 不可达亲证——`resultShapeValid`（pipeline.ts:116）对 fatal-committed-**false** 不看 effect 直接放行，但 `canonicalResult`（:144）对 committed:false 一律归一 `{kind:'fatal', committed:false}`（effect 剥落）⇒ 本 emitter 落盘记录永不携带该组合，盘面可达仅经手拼/第三方 writer。现状 replay：:171 `committed` 合取为 false → :173 omitted 检查不触发 → :183 `hasUpdateCarrier=false` → :208 推进（complete 可达）；R1.1 单源化后走 materialize :801 **无条件** `effect==='update-omitted' → omitted`（设计明示「不变」）→ §4.3 switch → issue + break → partial。翻转真实且 R1.1 备案集确漏此一条。
- **为何不阻断**：方向严格 fail-closed——不制造任何新 complete，只让一个手拼/篡改专有的形状从「推进」变「partial 止步」；**无合法保真回归风险**——emitter 产不出该形状 ⇒ AC5 健康链回归面零影响；不违 INV-227-5（其只约束 committed:true 形状）；materialize 分类与包内单源一致。
- **处置（择一备案，SA8 留两案，本轮裁定取 A）**：
  - **方案 A（裁定采纳）**：materialize omitted 分支维持「不变」（零代码改动面），设计 §4.1 表补一行 + §4.3 备案 bullet + **SA6 在 D4 增手拼变体 pin**（`fatal/committed:false/effect:'update-omitted'` → `partial` + `update-omitted`、不推进）。理由：该形状属 ADR-文本外/盘面篡改面，保守处置与 F-1 对其姊妹形状（committed:true）的处置同级；方案 B（把 omitted 分支收窄为要求 committed 析取）为 G-227-2 对称性引入新条件分支，改动面更大而安全性零增益。
  - 备案措辞须明示**已知不对称**：committed:false 族内 `'unknown'`（:181 成员）推进、`'update-omitted'`（:180 成员）止步——该不对称是「effect 驱动的 omitted 通道 × committed 驱动的 none 域」叠合的自然结果，安全（两臂均不可能假 complete），但必须成文防 SA4 误判回归。
  - 与 G-227-2 不冲突：G-227-2 裁的是「`committed:false + effect:'update'` **无义务**升格为 issue」，非「禁止对邻近形状更保守」。

### 3.2 N-B【SA3 硬守卫 + SA6 增 pin】replay `readSession` 供参路径的不可抛契约缺口——属实，必须实现收敛

- **事实链本轮亲验，全部属实**：diagnostic-replay.ts:15 头契约成文「**纯同步、绝不抛**：一切错误收敛进 issues」（#155 冻结语义）；`openDiagnosticReadSession` 三个 throw 面（read-session.ts:159 id 非法 / :163–164 `ttlMs` 非 safe-integer≥1 / :167–171 `maxLifetimeMs` 同）亲读确认。设计 §3.4.2 伪码把调用方 `readSession.ttlMs/maxLifetimeMs` **直通** open 且 open 位于 try 收敛之外——`ttlMs:0`、`maxLifetimeMs:0` 之类供参将使 replay 向调用方抛出，违约。设计 §3.2.2 的「两个 throw 面被冻结常量与前置门排除」论证只覆盖 reader **自开**路径（id 面另由 ① 前置门 + locator `isSafeStreamId`（:88）排除），未覆盖 replay 供参路径——SA8 指认精确。
- **为何不阻断**：属实现规格缺口而非设计方向错误；修法局部且零词表影响。
- **处置（binding，纳入实现清单）**：SA3 将 open 失败收敛为 `failed` + 既有 `replay-internal-error`（:243–252 通道现成——**零新码，INV-227-10「恰四新码」不破**），或入口预校验后同码拒绝；建议设计 §3.4.2 随实现补一句收敛语义 + INV 清单增补「replay 不新生长 throw 面（含 session open 供参路径）」一条（INV-227-11，措辞归 SA1/SA3 同步）。**SA6 红灯增 pin**：`readSession:{ttlMs:0}` 与 `{maxLifetimeMs:0}` → 不抛、`failed` + `replay-internal-error`（可与 D1 并入）。

### 3.3 N-C【SA3 文档义务】replay 头注释五条件措辞同步——属实，随实现同 change

- 亲验：diagnostic-replay.ts:4–17 头注成文记载「五条件 complete」语义框架；分类收紧落地后该注须同步（含 fatal-committed-unknown/effect 缺席不再推进的语义行），与 §5 已列的 reader.ts 码表计数 29→31、包 README 同属一次 change 内文档义务（docs/AGENTS.md：行为变更 ⇔ 成文契约必须互跟）。非阻断、纯文档；**纳入 §7 清单的文档行**。

## 4. 纳入实现清单的约束项（总控 dispatch 点名——binding）

| # | 归属 | 约束 |
|---|---|---|
| K-1（R-5 沿袭） | SA6 | SA7 重点 4 pin（sa7.test.ts:445–470，本轮再逐字确认：`complete`/`issues:[]`/`seq '4'`）废止改写为 D3 语义，必须与红文件**同 change** |
| K-2（N-A） | SA1 备案 + SA6 | 设计 §4.1/§4.3 补 N-A 备案（或以本文件为 annex）；D4 增手拼变体 pin：`fatal/committed:false/effect:'update-omitted'` → `partial` + `update-omitted`、不推进 |
| K-3（N-B） | SA3 + SA6 | replay session open 的 throw 收敛为 `failed` + `replay-internal-error`（零新码）；红灯增非法 `readSession` 供参 pin（不抛断言） |
| K-4（N-C） | SA3 | diagnostic-replay.ts:4–17 头注五条件措辞随语义收紧同 change 同步 |
| K-5 | SA1（可选） | 设计文档随实现同步 K-2/K-3 对应小节（§4.1 表行 / §3.4.2 收敛句 / INV-227-11）——非阻断，本文件具同等约束力 |

R1.1 本体（F-1 七处增量 + N-1/2/3 备案）**无需再修**——SA1 不需要 R1.2，可直接进 SA6 红灯。

## 5. 边界声明

本轮零生产代码改动、零测试改动、零 git 操作；除本文件外无写入。未运行测试套件（被审对象为设计文档，红灯契约尚未由 SA6 落地，无可跑对象——R0 §7 同例）。源码锚点均为本轮亲读，未沿用 SA1/SA8 声明。
