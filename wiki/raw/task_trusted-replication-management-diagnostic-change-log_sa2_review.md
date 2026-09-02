# SA2 攻击评审报告 — Issue #151 trusted replication / 复制管理写接入诊断变更日志

**Date**: 2026-08-31
**Reviewer**: SA2（Wallfacer，全新视角独立攻击）
**被审对象**: `wiki/raw/task_trusted-replication-management-diagnostic-change-log_design.md`（基线 `722bddf`）
**输入链**: 任务简报、`_relevant_decisions.md`（ADR 约束基准）、`_conflict_report.md`（verdict `clear` + 七条钉死）、`_design_conflict_report.md`（设计后复审 `clear`）、`_sa6_red.md`（15/15 红灯契约）、主线 `b66615c` 源码、本 worktree 代码与测试。
**任务类型**: feature。

**Verdict（R1，2026-08-31）: reject（窄域——一处必须修订的设计内部矛盾 + 两处表完备性/流程闭合条件；架构、ADR 合规、三项仲裁、红灯可满足性全部通过独立复核）**

> **【R2 终局裁决：pass】**——见文末「SA2 R2 复审」：三项必须闭合条件全部独立核验落实，SA6 勘误已交付且红灯形态保全，未发现 R1 修订引入的新矛盾。R1 正文保留作历史记录。

---

## 0. 评审方法与独立证据基线（非转述 SA1 自证）

以下事实均由 SA2 在本 worktree 独立重跑/核对，不采信设计文档自证：

| # | 验证项 | SA2 独立证据 | 结论 |
|---|---|---|---|
| E-1 | 基线分叉事实 | `git merge-base HEAD b66615c` = `b264aae`；worktree `src/` 无 replication 文件 | 设计 §0.1 属实 |
| E-2 | 红灯基线 | 本机重跑 `vitest run runtime-replication-diagnostic-red.test.ts` → **15/15 FAIL**（2.94s） | 红灯诚实 |
| E-3 | R-3.2 事实基础 | `git show b66615c:errors.ts:184`：常量名 `FATAL_REPLICATION_APPLY_WRITE_INTERNAL_CODE`，**值** `'NSRT-FATAL-REPLICATION-APPLY-INTERNAL'`；红灯 :729/:782 两处断言 `'…APPLY-WRITE-INTERNAL'` | 红灯字面量确系从常量名转录的笔误；R-3.2 裁决**正确** |
| E-4 | 主线槽序锚 | `b66615c:replication-write.ts`（440 行，E1–E7 + INV-R3「零写入路径零通知」）；`replication-session.ts`（889 行，R1–R7 + beforeTransaction 二分探针 + O-1 五条件 bypass + `protectedContentEvaluated`）；lease 角色门/`INSTANCE_ID_PATTERN`/wrapCore；runtime 十二键注释/V2.5/V3f；`openReplicationSessionCoreForRegistry(runtime, options)` 经 WeakMap 查 host | 全部形状锚属实 |
| E-5 | R-3.1 分叉定性 | 主线 R6 `await notifyDirty()` **无条件**（apply 槽对空 update 亦通知）；主线 INV-R3 + ADR-0006「mutation 后」支持本票跳过裁决 | R-3.1 分叉被诚实定性且契约（红灯用例 7 `saveCalls` 不变）要求之 |
| E-6 | 诊断基础设施 | `diagnostic.ts:123-144` emitAttempt 全吞没；`vocabulary.ts:17-19/23-46` 词表冻结；`pipeline.ts` cleanContext/att-+32hex/code↔sourceModule 成对；`projection/input.ts:58` `projectInput(undefined)→{capture:'none'}` | §7 复用面属实；**同时暴露攻击点 #1（见下）** |
| E-7 | yjs 协议假设（P1–P4 独立复测） | 本机 node 直跑 yjs（worktree `^13.6.30`）：enable 单事务**单事件 92 bytes**；bump 27 bytes；空 diff 2 bytes 应用后 **update 事件 fired=0**（R-3.1 判据成立）；基态+enable+apply 链式重放 n=42/META id 精确；**以红灯同款 fixture（同 doc 时钟已前移）enable 增量对空 doc ROOT/SCHEMA/META = 0/0/0**（§16 E1b 复现成功） | §16 实测**可复现**，P2/P3 关键行为成立 |
| E-8 | 存量测试改面完备性 | 全测试目录 grep `Object.keys`：runtime 键集断言恰 :159 与 seam:270 两处（十→十二键）；internal 值导出键集 :122；registry-surface exports `['.','./testing']` 不受影响；exports-audit 一键锁不受影响（DENY index.ts 保护） | §15.2 清单**无遗漏** |
| E-9 | Caller 审计 | `createLeaseController` 生产调用恰 `registry.ts:569` 一处；`./internal` exports 已存在且指向 src（WeakMap 模块同一性在 vitest 解析下成立）；registry→runtime workspace 依赖已登记（pnpm-lock 零 diff 可信） | §17 属实 |
| E-10 | 15 用例逐条走查 | 对 §9.1/9.2/9.3 映射表逐用例比对（详见 §3 结论）：**两处字面量修订落地后 15/15 可满足**，无一用例被映射表背叛 | §11 主张成立 |

---

## 1. 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 可执行修订要求 |
|---|--------|--------|---------|------|
| 1 | **MAJOR**（内部矛盾，阻塞 SA3 无歧义落地） | §7 扩展面声明 vs D-8/§9.3「省略 input」 | §7 声明 `diagnostic.ts` 仅做「三点向后兼容扩展」（source/context/sourceModule），`SlotEmissionArgs.input: EmissionInput` **必填**、`SlotDiag.input` 必填且缺省 `{status:'not-accessed'}` 均不变（§17/§18 同口径）。但 D-8 与 §9.3 表 A-e…A-m 行（含 **A-j/A-k committed 行**）要求 apply 一切槽内路径「**省略 input**」——emission 面 `input?` 可选、record 面投影 `{capture:'none'}`（E-6 实核）。当前声明的扩展面**结构性表达不了「省略」**：SA3 按 §7 实现必得 `not-accessed`，则 committed apply 记录谎称「拒绝先于任何输入访问」（与 ADR-0011 §E 的 not-accessed 语义直接冲突）；按 §9.3 实现则必须私扩第四点（input 可选 + emitSlot 条件展开），违反 §7/§17/§18 的扩展面与行数声明 | SA1 增补**第四点向后兼容扩展**并在 §7/§17/§18 同步：`SlotEmissionArgs.input` 与 `SlotDiag.input` 变为可选（或 apply 槽以 `undefined` 初始化），`emitAttempt`/`emitSlot` 条件展开（缺省行为 = ROOT/SCHEMA 既有字节面零变化）；并在 §9.3 表头明示 apply 槽内行 record 面期望 `input.capture === 'none'`（与 A-a/A-c/A-d 的 `not-accessed`、A-d 的 `unavailable` 三态区分），供 SA4 锚定 |
| 2 | MINOR（冻结映射表不完备） | §9.2 bump 表 E4 出口 | bump 的 E4 corrupt throw → fatal(capability-gate / NSRT-FATAL-REPLICATION-WRITE-INTERNAL / committed:false) 仅由 §4 共享槽序图隐含覆盖，§9.2 表（自称「冻结契约——与红灯锚点逐一对应」、SA4 验证基面）无对应行；bump 在 META 载体缺席时的出口（→ disabled → REPLICATION_NOT_ENABLED，归 B-e）亦未显式声明与 enable E-h（META_ABSENT）的分野 | §9.2 增补 B-f′ 行（E4 corrupt → fatal NSRT-FATAL-REPLICATION-WRITE-INTERNAL + write-slot-internal + committed:false）与一行注记（bump 无 META_ABSENT 分支：载体缺席归 disabled 出口 B-e），保持表完备自洽 |
| 3 | MINOR（流程闭合条件，非设计缺陷） | R-3.2 的 SA6 前置依赖 | 转绿声明「测试文件零改动即应 15/15 转绿」**条件于** SA6 先落地两处 fatal 码字面量修订（红灯 :729/:782）。该修订事实正确（E-3）且 SA6 注记 2 协议可容纳（「按合并后既有形状修订（红线不变，形状字段按设计仲裁）」「本报告已尽量选用主线既有字面名」——两处恰是对该自我承诺的违背），但若 SA6 修订未先行落地，用例 11/12 将以字面量不等失败并被误读为实现缺陷 | 在 §11「SA6 侧前置动作」补一句硬门槛：SA6 修订（引用注记 2 + R-3.2）**必须先于** SA4 转绿验证落地，且修订后字面量为 `'NSRT-FATAL-REPLICATION-APPLY-INTERNAL'`（与 errors.ts 注册表值一致）；总控排程据此排序 |
| 4 | INFO（登记性风险，已有缓解） | 跨谱系物化的分叉债 | 本票在诊断谱系物化 ≈1,100 行复制业务面，与主线 Phase 5 谱系形成双实现窗口期；合并前任何一侧演进都可能扩大 R-3/L1–L6 之外的未登记漂移。设计已具备缓解（形状锚定 b66615c + 三仲裁显式 + 六局限登记 + 合并策略声明「映射表是接线知识的单一真相源」） | 非阻塞。要求：合并/Phase 5 交付票必须消费 §12 的 L1–L6 登记表与 R-3.1「建议主线采约」仲裁建议；SA7 活链路验证时抽 diff 物化文件与 `b66615c` 锚的差异面，确认全部落在 R-3/L 登记内（防静默漂移的最后一道闸） |
| 5 | INFO（AC3 update-omitted 覆盖路径） | 零 producer 侧 update-omitted | AC3「update-omitted 显式表示」在本票由**存储面**承载（payload 超限/捕获禁用时 adapter/pipeline 投影），producer 恒产 update/noop。红灯注记 5 同判（未构造该分支），语义成立但活链路无本票测试面 | 非阻塞。要求 SA7 动态验证清单加一项：以 `updateCapture:false` 配置跑一次 replication apply，断言 committed 记录落 `update-omitted` + 冻结 reason（`update-capture-disabled`），兑现 AC3 在 replication operation 上的显式分置 |
| 6 | INFO（证据可重跑性） | §16 探测脚本未随档 | §16 贴出完整输出但脚本本体仅文字描述（「复刻红灯测试 makeDoc/buildRemoteDiff/emptyDiff 语义」）。SA2 已独立复现 P1–P4 全部关键值（E-7），证据真实；但 SA4 静态门禁重跑时无脚本可执行 | 非阻塞。建议 SA1 把探测脚本落盘（如 `wiki/raw/…_sa2_review.md` 附录或独立 scratch 文件路径引用），或在 §16 注明可按红灯 helper（makeDoc/buildRemoteDiff/emptyDiff）+ §16 步骤描述机械重建（SA2 已验证可重建） |

**攻击未遂记录**（SA2 主动攻击但设计守住的面，供 SA4/SA7 免重复侦察）：

- **窗口互斥/冒充**：五捕获窗口全在槽体同步段 + 唯一 FIFO sequencer → 结构性互斥（§13.1 成立）；「空 doc 不物化」反全文档编码鉴别在红灯 fixture 条件下复现成立（E-7；注意该鉴别依赖被鉴增量引用缺失基态结构——红灯 fixture 恒满足）。
- **R-3.1 判据攻击**：构造「有事件 ⟺ 有集成」反例失败——纯删除集 update 会带 bytes 触发事件；已存在 struct 的重复 apply 零事件 → 判为 noop 跳过 dirty（语义正确）；空 diff 零事件（E-7 实测 fired=0）。
- **双 session 并发（红灯用例 15）**：lease 无会话计数（L3）允许同 lease 双 session 并存——与红灯装配兼容；bump 主动 fence 对两者收敛同终态（finalize 幂等 + 终态不降级）。
- **模块同一性攻击**：registry 经 `@nomicore/namespace-runtime/internal` 静态导入 vs 测试相对路径导入 `../src/runtime.js`——exports 直指 src，vitest 实路径解析下 WeakMap（`replicationHosts`）为同一模块实例；且 `openReplicationSessionCoreForRegistry(runtime, options)` 以 `entry.runtime`（= runtimeFactory 产物）查表，host 查找成立。
- **测试 12 Proxy handle 攻击面**：wrapHandle Proxy 仅在 armed 后对 getStatus 抛错；enable/open 均先于 arming，apply R3 命中——映射 A-f 与红灯断言（result 恰 `{kind:'fatal',committed:false}`、sourcePhase write-slot-internal、rejects.toMatchObject phase/committed）逐字段吻合。
- **键集爆炸半径**：`Object.keys(runtime)` 十二键（WeakMap 零污染）；公共 status 七键不动（seam:261 锁面保护，L4 不扩）；index 一键锁不动（DENY LIST 保护）。

---

## 2. 协议假设依据审查（2026-06-13 立法）

**结论：通过（附 INFO-6 一条改善项）。**

- **章节存在**：§16「协议假设依据 (Protocol Assumption Evidence)」存在，P1–P7 七项逐条给出假设/依据类型/依据内容/风险。
- **无「应该/通常/预计」类无据推断**：依据类型全部为「设计期实测」「现有源码引用」「现有测试引用」，无猜测性措辞。
- **实测依据贴输出**：附 2026-08-31 实测输出块（E1–E5 十三行，含精确 byte 数与重放值）。
- **SA2 独立复现**（E-7）：P1（92B 单事件）、P2（0/0/0 反向鉴别）、P3（空 diff fired=0——R-3.1 的机制命门）、链式重放值、P4（corrupt bytes scratch 预演拒绝，另有主线源码位点佐证）全部复现成功。P5/P6/P7 为源码/测试引用，SA2 已逐条定位核实（pipeline.ts cleanContext/成对性/attemptId；sequencer enqueue 机械；主线 V3f 注释）。
- **SA4 可验证性**：命令可重跑（node + worktree yjs）、引用可定位（文件:行号）；唯一弱点是脚本本体未随档（攻击点 #6，非阻塞）。

## 3. 错误处理链路审查（2026-05-07 立法）

**结论：通过。**

- **静默失败**：emitAttempt 全吞没（`diagnostic.ts:123-144`，含敌意 emitter/违约 clock）是 ADR-0011 §A 授权的隔离语义，非静默失败——故障侧由 adapter drop/health 计数显影（红灯用例 13/14 恰断言 `calls()===2` 与 `accepted/dropped`）；「outcome 缺失 + 业务拒绝 → 不 emit」的 INV-DIAG 亮式不变量沿 #149 立法，宁可缺记录绝不伪造 committed。
- **状态闭环**：§9 三表对 enable 11 结局点 / bump 7+ / apply 13 逐点写入 outcome，成功路径由 INV-DIAG 缺省组装兜底；15 红灯用例走查无一结局点悬空（唯一表完备性缺口见攻击点 #2，属文档级）。
- **降级路径**：emitter 未装配 ⇒ 全 no-op 行为等价（§13.5，#149 D-C 同款）——真降级，非伪降级；transport 面整体缺席（L1）使 AC4/AC5 的 transport 隔离结构性成立。
- **虚假降级识别**：host 缺席 → `REPLICATION_SESSION_UNSUPPORTED` 显式能力缺席拒绝（非静默猜缺省）；V2.5 facts corrupt → 构造 throw 零副作用（loud）；R-3.1 零字节跳过 dirty 有精确判据与 INV-R3/ADR-0006 依据，非掩盖 bug 的伪降级。未发现任何把前提缺失伪装成降级的路径。
- **用户可感知性**（此处为调用方可感知）：一切拒绝经既有稳定码结果联合（`{ok:false,code,message}` / issues / RuntimeWriteFatalError{phase,committed}），红灯用例 3/8/9/10/11/12 逐一锁定。

## 4. 红线测试思路（针对各攻击点；SA6/SA4 可直接取用）

1. **攻击点 #1（input 省略）**：apply committed（红灯用例 5 基础上追加断言）——`expect(rec.input).toEqual({ capture: 'none' })`（A-j 槽内 committed 行不得携带 not-accessed/unavailable）；对照组：用例 9 既有 `expect(rec.input).toEqual({ capture: 'not-accessed' })` 保持绿。若 SA3 误用 not-accessed，第一条断言红——红灯即「committed 记录谎称输入未访问」。
2. **攻击点 #2（bump E4 corrupt）**：以 seedForTest 等价手段构造 META 复制保留字段损坏 doc → `bumpReplicationEpoch()` → 断言 `rejects.toMatchObject({ phase:'write-slot-internal', committed:false })` + 记录 `stage:'capability-gate'` / `code:'NSRT-FATAL-REPLICATION-WRITE-INTERNAL'` + `result` 恰 `{kind:'fatal',committed:false}` + 后续写全拒（fatal 闭环）。
3. **攻击点 #3（SA6 字面量修订）**：修订后重跑 15/15 全量（无需新增用例）；建议 SA6 修订 commit 信息引用 R-3.2 + 注记 2，使审计链闭合。
4. **攻击点 #4（分叉债）**：SA7 阶段 `git diff b66615c -- packages/namespace-runtime/src/replication-write.ts packages/namespace-runtime/src/replication-session.ts` 语义 diff，逐差异点对账 R-3.1/2/3 + L1–L6，出现登记外差异即红。
5. **攻击点 #5（update-omitted 活链路）**：`makeLog({ updateCapture: false })` 跑一次 hub-to-peer committed apply → 断言 attempt record `result` 为 `committed + update-omitted` 且 reason ∈ 冻结三词表（预期 `update-capture-disabled`），业务 `ok:true` 不变。
6. **既有红灯已覆盖**（无需重复构造）：FIFO 槽序（用例 13/14 的 epoch=2 断言）、fence 终态（用例 8）、noop 零 dirty（用例 7）、transport 零混入（用例 15 `emissions.length===2`）。

## 5. 复核结论与放行条件

**通过项**（独立复核成立，不再要求 SA1 动作）：范围裁决 R-1/R-2（最小闭包进/不进清单逐项与红灯消费面对账无冗余无缺失）、三项仲裁 R-3.1/2/3（事实基础全部实核成立、显式登记、红灯契约一致）、SA8 七条钉死约束逐条落实（§10 对照与 SA8 设计后复审 clear 互证）、ADR-0006/0007/0008/0009/0011/0012 实质条款保全、§15.2 存量测试改面完备（E-8）、§17 caller 审计属实（E-9）、15 红灯用例映射可满足（E-10，条件于攻击点 #3 先行）。

**Reject 的闭合条件**（全部满足即可复审放行，预计一轮内闭合）：

1. 【必须】按攻击点 #1 修订 §7/§17/§18：声明第四点向后兼容扩展（input 可选化 + emitSlot/emitAttempt 条件展开，ROOT/SCHEMA 字节面零变化），§9.3 表明示 apply 槽内行 record 面 `input.capture==='none'`；
2. 【必须】按攻击点 #2 补全 §9.2 bump 表 E4 出口两行（corrupt→fatal；载体缺席→B-e 归并注记）；
3. 【必须】按攻击点 #3 在 §11 写明硬排程序：SA6 两处字面量修订先于 SA4 转绿验证落地；
4. 【建议】攻击点 #4/#5/#6 的三项登记性要求并入 SA7 验证清单（或设计附注），不阻塞复审。

**pass 的边界声明**：本 verdict 仅针对设计文档；`pass`（复审后）不替代 SA4 对实现与 SA7 对活链路的验证——尤其 §0.2「逐字端口」声明须由 SA4 以 b66615c 逐字对账。

---

# SA2 R2 复审（2026-08-31）—— R1 闭合条件逐条核验

**被审对象**：R1 修订后的 `_design.md`（§7/§9.2/§9.3/§11/§15.7/§16 P8/§17/§18 + 附「SA2 反馈逐条回应」）与已交付勘误的红灯契约/报告。
**方法**：不采信修订自检——逐条独立定位修订文本、对账源码/主线/红灯文件、重跑红灯。

## R2 Verdict: **pass**

## 闭合条件核验（三项必须 + 三项建议）

| R1 条件 | 核验证据（SA2 独立取得） | 结论 |
|---|---|---|
| **#1【必须·MAJOR】input 可选化 → `{capture:'none'}`** | ① §7 改题「四点向后兼容扩展」，第 4 点完整：`SlotEmissionArgs.input`/`SlotDiag.input` 可选化、apply/bump 槽 diag 以 `input: undefined` 构造、`emitAttempt`/`emitSlot` 条件展开（不携带 `input: undefined` 值键）、**record 面投影冻结 `{capture:'none'}`** 并引管线单点 `projection/input.ts:58`（R1 E-6 已独立核对该位点 `if (input === undefined) return { capture: 'none' }`）；新增 P8 行。② §9.3 表头注冻结三态词表（not-accessed=接纳层拒绝先于输入访问 / unavailable=已访问不可快照 / 省略=槽内路径→`{capture:'none'}`），明文禁则「**committed 记录携带 not-accessed 即契约违规**」；A-e…A-m 全行「省略」、A-a/A-c not-accessed、A-d unavailable、A-b 按 A1/R2 分置——三态无混用。③ 同步核验：§2 D-5 改「四点」、§14.1/§15.1/§17（改动函数表 + caller 表 emitAttempt 行「apply/bump 槽调用省略 input → record `{capture:'none'}`」）/§18（diagnostic.ts +55 行，SlotDiag input 放宽 + emitSlot 三条件展开）；`三点` 规范性残留 **0**（全文唯一命中为自检段元描述）；ROOT/SCHEMA 恒传值 ⇒ 条件展开下字节面零变化（机械等价成立）。语义复核：`none` ≠ `not-accessed` 与 ADR-0011 §E 语义严格对齐，bump 全行「—」（无调用方输入）诚实 | ✅ 落实，无新矛盾 |
| **#2【必须】bump B-e′ 映射** | §9.2 新增 **B-e′**（E4 corrupt throw → capability-gate / NSRT-FATAL-REPLICATION-WRITE-INTERNAL + write-slot-internal / **fatal committed:false**「此时尚零 doc 写」——E4 纯读，committed 事实正确）+ 红灯锚（seedForTest 构造建议）；corrupt 分类（恰一键存在/键存在值 undefined/格式违约/载体异型）对账主线 `readReplicationFacts`（b66615c:replication-write.ts:227-233 throw 家族 + :203/:229 disabled 出口）吻合。「bump 与 enable 的 E4 出口分野」注记：载体缺席归并 B-e——**主线原文逐字命中**（`git show b66615c:...:389`「两键真缺席与载体缺席在此同拒——REPLICATION_NOT_ENABLED」）；enable E-h 专属守卫对账主线 :324-327（META_ABSENT 独立 gate）吻合。bump 表 9 结局点与 enable 11 / apply 13 对齐，冻结契约完备 | ✅ 落实，主线锚逐字属实 |
| **#3【必须】SA6 排程序硬门槛** | ① §11 扩为三段：修订内容（`:729`/`:782` 位点 + commit 审计链建议）、**硬排程序 SA3 实现 → SA6 字面量修订 → SA4 转绿验证**（并点名「修订未先行时用例 11/12 字面量失败是排程序违约信号、不是 SA3 返工信号」）、转绿边界 + 两个可选断言锚（不阻塞）。② **勘误已交付**：红灯测试 `:732`/`:785` 断言与头部注释 `:65`/`:67` 均为 `'NSRT-FATAL-REPLICATION-APPLY-INTERNAL'`，与主线 `errors.ts:184` 值逐字一致；SA6 报告新增「修订记录」节，裁决依据与 SA2 R1 E-3 独立核验同源。③ **SA2 独立重跑勘误后红灯**：15/15 FAIL、Type Errors 0、同一 TypeError 失败形态（2.87s）——勘误未扰动红形态，码断言在基线本就不可达（记录断言位于操作面之后）；排程序门就此闭合 | ✅ 落实并交付 |
| #4/#5/#6【建议】 | §15.7(a) 物化面 `git diff b66615c` 逐差异点对账三仲裁+六局限（登记外即红）；(b) `updateCapture:false` 活链路断言 `committed + update-omitted` + reason `update-capture-disabled`；(c) 全量回归基线；§16 新增「脚本可重建性注记」（机械重建路径 = 红灯 helpers `:107-132` + §16 步骤；SA2 E-7 已第二方重建复现） | ✅ 登记（SA7 消费） |

## R2 新问题扫描（针对 R1 增量，全新视角）

- **旧字面量残留**：`APPLY-WRITE-INTERNAL` 全文 3 处命中均为「修订对象」引述上下文（R-3.2 表 / §11 修订内容 / §18 SA6 注）——合规。
- **一致性抽查**：`capture:'none'` 在 §7/§9.2 注/§9.3 表头注/§16 P8/§17 五处口径一致；B-e′ 标签在 §9.2 行、红灯锚注、§11 可选锚三处引用一致。
- **语义攻面**：bump B-a（lifecycle 拒绝）input「—」→ `{capture:'none'}`——bump 无调用方输入，not-accessed（「拒绝先于输入访问」）反而失义，none 诚实且与 emission.ts「省略 ⇔ 无可捕获输入，按 none 处理」注释一致；enable E-a 保留 not-accessed（有调用方输入、拒绝先于访问）正确——两公共入口的差异化处理经查无矛盾。
- **未发现 R1 修订引入的新漏洞**；R1 的全部「攻击未遂记录」（窗口互斥/R-3.1 判据/模块同一性/键集爆炸半径）不受本轮增量影响。

## R2 结论

三项必须闭合条件全部落实且经独立核验（源码位点/主线逐字/红灯重跑），三项建议项已登记至 §15.7 与 §16。**R2 Verdict: pass——同意放行进入 SA3 实施**。附随义务（非阻塞）：排程序门已在本次闭合（SA6 勘误先行落地）；SA4 须以 `b66615c` 逐字对账 §0.2「逐字端口」声明并以 §9 三表为冻结验证基面（含三态 input 词表）；SA7 须消费 §15.7(a)/(b)/(c) 三项。`pass` 不替代 SA4/SA7 验证。
