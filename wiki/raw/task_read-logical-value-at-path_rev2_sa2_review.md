# SA2 攻击评审报告（rev2 · Phase 2 设计攻击）

- **Date**: 2026-08-22
- **Reviewer**: SA2（Wallfacer，全新视角独立攻击；未参与 rev1/rev2 前序评审）
- **被审对象**: `wiki/raw/task_read-logical-value-at-path_rev2_design.md`（D19 seam 落位 / D20 惰性 generator 管线 / D21 mutation proof 协议 / INV-15 仲裁单点权威 / 0.1.3→0.1.4）
- **攻击基准**: ADR 全集摘录（`…_rev2_relevant_decisions.md`）+ rev2 简报（owner 第二轮 Review 全文 + AC-R2-1..R2-5）+ SA8 设计后复审（clear，注记 D-1 指定攻击 §3.2.2/§3.2.3）+ worktree 代码实测（基线 commit `7f77384` = HEAD）
- **Verdict（最终，R2 复审 2026-08-22）**: **pass** —— R1 五项发现（3 MAJOR + 1 MEDIUM + 1 LOW）已由 SA1 修订版（451 行）逐条落实并经 SA2 mock 实跑 + 三组阴性对照验证（见文末「R2 复审」段）。R1 历史 verdict：reject（窄域，仅验证协议层；架构本体 D19/D20/D21/INV-15 在 R1 即已全部存活）。

---

## Verdict 说明（先读）

**架构本体经独立攻击后存活**——SA2 逐项复核了 SA8 转交的 D-1 攻击面（§3.2.2 惰性等价论证 / §3.2.3 诚实缺口）以及总控指定的全部攻击面，核心结论：

| 攻击面 | 攻击方法 | 结果 |
|---|---|---|
| seam 伪代码 vs D17 四规则逐字等价 | `arbitrateUnion` 函数体与 read.ts:351-360 现行内联循环逐行对照（value 按引用回传 / sawMissing 记账位 / 收尾三元 / 空成员 union → reject 同判）+ `memberOutcomes` yield 实参与现行 `resolveLive(m, live, segs, i, resolveS, fullPath, memo)` 七参逐位比对 | **等价成立，未攻破**（论证 1/4 属实） |
| generator 异常传播 / E100 域形态 | 按 ES 规范推演：generator body throw → 直接冒泡至 `.next()` 调用者（arbitrateUnion for-of）→ navigate → resolveLive 外层 → 顶层 catch → C3(DOCRT-E100)；无新增 catch/转换点；for-of 提前 return 触发 IteratorClose → generator `.return()`，无 finally ⟹ 零可观测差异；E100 message 只含 `err.message`，栈帧差异非契约 | **论证 3 成立，未攻破** |
| memo 写序 / H-a 性能护栏 | 写点全部在 `resolveLive` 内部（union 节点自身的 memo 写入仍在 navigate 返回后的 resolveLive 外层，位置不变）；调用序逐位相同 ⟹ 写序一致；每成员 O(1) generator 帧开销，H-a（26 层 <2s，实测 `CHAIN_DEPTH=26 / toBeLessThan(2000)` 在库）常数余量充足 | **论证 5/6 成立，未攻破** |
| 惰性等价论证（§3.2.2 论证 2） | `memberOutcomes` 只在 yield 点暂停；arbitrateUnion 首 value return 后后序 body 零执行；`node.members` 读取时机（首 next() vs 进入 case）在同一同步执行上下文，无插入突变窗口 | **成立，未攻破** |
| 诚实缺口（§3.2.3）独立性复核 | SA2 独立推导：调用点物化在合法输入上确实观测等价（物化多算的试探全被 memo 摊销；E100 throw 只在手造派生物上出现，合法输入不触发）；动态锁唯一途径（resolveLive 计数 seam / generator finally 探针）均须改生产代码，设计拒绝理由成立 | **缺口定性诚实，非设计疏漏**；但其唯一可行防线（静态验尸）本身有洞 → **发现 #1** |

**驳回的只是验证协议层**：发现 #1/#2/#3 是三条 normative 条款在执行阶段的自冲突/事实错误/假 PASS 路径——它们不否定 D19/D20/D21/INV-15 的任何架构决策，但若不修订，SA4 静态验尸与 SA7 mutation proof 将在设计自身规定的验收步骤上必然失火。SA1 按「攻击点清单」修订设计文本即可，无需动 §3.1.2/§3.2.1 伪代码主体。

---

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议（可执行修订要求） |
|---|--------|--------|---------|------|
| 1 | **MAJOR** | D20 禁物化静态验尸（§3.2.1/§3.2.3/§8.1）——SA8 注记 D-1 首要攻击面 | **三连缺陷**：(a) **grep 自冲突**——§3.2.1 normative JSDoc 字面含 `Array.from`、`.map()`、`[...]` 三形（「⛔ 禁物化……不得出现 Array.from / 数组展开 `[...]` / `.map()`」）。§3.1.2 声明伪代码为「SA3 逐字落地基准」⟹ SA3 逐字落地后，§8.1 静态义务「union 分支区域 grep `Array.from\|\.map(\|\[…` 零命中」**必然非零命中（注释自命中）**——normative 条款保证了自己的验收失败。(b) **形态学缺口**——grep 三形锁不到最现实的漂移形态：把 `memberOutcomes` 实现为**普通函数返回数组**（`function memberOutcomes(…): NavOutcome[]` 内部 `out.push(resolveLive(…))`）：union 分支区域零命中三形、调用点零物化 token、合法输入观测等价（SA2 已独立证实）、纯测试锁不到（seam 自身仍惰性）——D20 惰性契约在该形态下**全链失守**，三重防御只剩「人工评审」。memberOutcomes 不导出 ⟹ test-d 类型层锁（`ReturnType extends Generator`）也不可行——**静态锁是唯一途径，而现规格不封口**。(c) **区域边界未定义**——`memberOutcomes` 放置位置设计未成文，grep「union 分支区域」的行界（是否含 generator 定义体？是否含 §3.1.2 seam 的 JSDoc？）SA4 无法复现执行。 | 设计文本三处修订：(1) §8.1/§3.2.3 grep 义务改定为**注释剥离后**执行（或规范 JSDoc 改用不含三形字面量的表述，如「禁物化三形（见 §3.2.1 表述）」）；(2) 追加两条可静态复验的**形态锁**：`grep -cE 'function\*\s+memberOutcomes' packages/doc-runtime/src/read.ts` == 1（generator 形态；若采 §3.2.1 IIFE 变体则改锚 union case 块内 `function*`），且 `grep -n 'memberOutcomes' …read.ts` **恰 2 处**（定义 + 唯一调用点，调用表达式必须是 `arbitrateUnion(memberOutcomes(…))` 直接实参形）；(3) 成文 `memberOutcomes` 放置位置（建议紧随 `arbitrateUnion` 之后）并把该位置纳入 grep 区域行界；顺带把 INV-15「无第二仲裁实现」操作化为 `grep -c 'sawMissing' …read.ts` == 1（现存于 arbitrateUnion 体内）。 |
| 2 | **MAJOR** | D21 杀伤矩阵（§3.3.2）事实错误 | **M-B「首 reject 即返回」的行 3/行 6 预测错误**。按冻结测试实际断言推演（`…rev2-union-arbitration-pure.test.ts` 行 3-6 均含 `expect(pulled).toEqual([0, 1])`）：行 3 `[missing, reject]`——M-B 在第 2 项返回 `{kind:'reject'}` ≠ 期望 `missing` → **结果红**（设计标 🟢）；行 6 `[reject, reject]`——M-B 在第 1 项即返回，pulled=`[0]` ≠ 期望 `[0,1]` → **拉动红**（设计标 🟢）。正确预测：M-B 红 = 行 3（结果）+ 行 4（结果+拉动双红）+ 行 6（拉动）。SA7 若执行可选 M-B，实测红集合 {3,4,6} 与设计矩阵 {4} 冲突——要么误记证据，要么误判「实现被破坏」。SA2 已逐行复核 M-A（红=1/3/5，行 1 双红）、M-C（红=2，仅拉动）、M-D（红=3/4/5）与冻结断言**全部吻合**，唯 M-B 两格错。 | 修订 §3.3.2 矩阵 M-B 行：行 3 → 🔴 结果红；行 6 → 🔴 拉动红（`[0]`≠`[0,1]`）；行 4 维持双红。并在 §3.3.1 注明「矩阵为 SA7 证据记录基线，实测红集合若与矩阵冲突须先复查变异形态再定性」。M-A/M-C/M-D 预测经 SA2 独立推演确认无误，勿动。 |
| 3 | **MAJOR** | D21 还原协议（§3.3.3 Phase 2）假 PASS / 数据丢失路径 | **`git checkout -- packages/doc-runtime/src/read.ts` 隐含「read.ts 已提交」前置条件，设计未成文**。工作流时序：SA3 实现 → SA4 → SA7 → AC 门禁 → **收尾才 commit**（rev2 简报明文）⟹ SA7 执行 mutation proof 时，SA3 的 seam 实现**大概率未提交**。此时：(i) `git checkout -- read.ts` 把变异**连同未提交的整个实现一起抹掉**（checkout 对未提交工作树不可恢复——无 reflog/stash）；(ii) 更阴险的是 `git status --porcelain packages/doc-runtime/src/` 在抹掉后反而**空输出**（工作树 == HEAD=7f77384）——「diff 归零硬验收」在实现已毁的场景下给出 **假 PASS**，只剩末尾 `pnpm test` 复绿能兜底（rev2 文件 6 failed）；(iii) 设计自设的「中断恢复第一步 `git status`」在该场景下**不可辨识**——变异前/后 read.ts 都显示 modified（实现未提交 + 可选变异叠加），无从判断变异是否在场。 | §3.3.3 增补 Phase 1 前置条件（normative）：施加变异前必须 `git status --porcelain packages/doc-runtime/src/read.ts` **为空**（即 seam 实现已单独 commit——实现提交≠变异提交，不违「变异态严禁 commit」；变异只在工作树上存在）；若工作流不允许中途 commit，则改用非破坏性还原（变异前 `cp read.ts /tmp/read.pre-ma.ts`，Phase 2 `cp` 回写 + 前后 `git diff …read.ts \| sha256sum` 比对不变），并把「porcelain 空输出」验收改为「还原后 diff 与施变异前 diff 逐字节一致」。「中断恢复」条款同步改写为该前置条件下的可辨识版本。 |
| 4 | MEDIUM | D21 变异体完备性（总控指定攻击面） | M-A 对 owner P1 判别力缺口**足够**（SA2 推演确认：M-A 下红=行 1/3/5，公共面全绿 = 观测等价定理 Case 2 的实证——恰是 AC-R2-4 要求的对照事实）。但 D20 自身引入的新攻击面（物化/惰性破坏）的**唯一动态杀伤证据是 M-C**（行 2 拉动断言 `[0,1]`≠`[0]`）——设计列为可选。若 SA7 裁量跳过 M-C，则「行 2 拉动断言真能杀死物化实现」从未被证明，D20 惰性契约防线只剩发现 #1 修复后的静态锁。M-C 成本极低（1 行变异 + 单文件运行 + 同款还原纪律）。 | 把 M-C 从「可选」升格为「强烈建议必做」（或：SA7 裁量跳过时必须在报告记录理由）；M-B/M-D 维持可选。注意 M-B 执行前须先落发现 #2 的矩阵勘误。 |
| 5 | LOW | INV-14 落地判据（§3.1.1）——总控指定攻击面 | 「包外零消费授权」目前只由 caller 清单审计 + 可选 H-d 类型负锁背书，**漏引仓库既有的最强结构性后盾**：`packages/doc-runtime/package.json` 实测 `"exports": { ".": "./src/index.ts" }` + `"private": true`——exports 映射在 Node（`ERR_PACKAGE_PATH_NOT_EXPORTED`）与 TS bundler 解析两侧均阻断 `@nomicore/doc-runtime/src/read.js` 一切包外 deep import。INV-14 包边界判据不是纯纪律约束，而是**被包管理器强制的事实**——设计未引用，SA4/SA7 就少一条最硬的验收锚。 | §3.1.1/§7 INV-14 行补引 exports map 事实（一行引用即可）；顺带注明：H-d 负锁只锁 barrel 面，包外 deep import 的类型层拒绝由 exports map 自动生效、无需额外测试；再注一笔「若未来包解除 private/发布，exports 面即成公共契约边界，须重审 INV-14」。 |

**未成立的攻击（诚实记录，防后续 SA 重复消耗）**：seam 伪代码与 D17 逐字等价（成立）；generator 异常传播/E100 同点同序同形态（成立）；memo 写序与 H-a 护栏（成立）；M-A 矩阵预测（正确）；M-C/M-D 矩阵预测（正确）；「首 value vs 末 value 胜出」类未列变异体——行 2 拉动断言已可杀死（末 value 胜出形态必拉动 `[0,1]` ≠ `[0]`），无需追加；`git checkout` 之外的 ALLOW/DENY 可执行性——read.ts 子文件级 DENY 区域与 §2 (a)-(e) 改动面可 diff 验证、基线 `7f77384`=HEAD 实测吻合、`package.json` 0.1.3 实测吻合、SA6 owned 纪律成文（AC-R2-3 措辞已在库实测：rev1 文件行 23/35/97/115-116）。

---

## 协议假设依据审查

**章节存在**：§5 存在，明示「无新增协议级假设」（纯包内重构，无 HTTP/WS/端口/进程/三方库假设）——定性正确。

**四项语言级/工具链事实逐条复核（SA2 实测）**：

| 假设 | 设计依据 | SA2 复核结果 |
|---|---|---|
| for-of 逐项拉动/短路 | 行 2 断言在库 + rev1 66 绿锁 | ✅ 冻结测试行 87 `expect(pulled).toEqual([0])` 实测在库 |
| generator 惰性 + `.return()` 关闭 | 行 1/2 拉动断言合取 + ES2015 语义 | ✅ 断言在库；规范推演无反例（无 finally ⟹ 零可观测） |
| `.js` 后缀 deep import 解析 | tsconfig `moduleResolution:"bundler"` + read.ts:25 先例 + 双通道现绿 | ✅ 实测：`tsc -p packages/doc-runtime/tsconfig.json` 对红灯文件报 `TS2305 (arbitrateUnion)` + `TS2459 (NavOutcome)`——**红因恰为导出缺失而非路径解析失败**，通道成立且红签名与设计 §4.1 断言一致 |
| vitest include 覆盖 | 根 vitest.config.ts include | ✅ 实测 `include: ['packages/*/test/**/*.test.ts', …]`，typecheck include 仅 `*.test-d.ts`（与设计 §5 引文一致；`.test.ts` 的类型红通道在包级 `tsc -p`，设计 §5 已正确引用） |

**无「应该/通常/预计」类无据推断**；依据全部可被 SA4/SA7 重跑。**通过**（本节无缺陷；发现 #5 仅是漏引更强证据，非依据错误）。

## 错误处理链路审查

本任务为库内纯函数抽取 + 测试硬化，无 UI/异步任务/API 调用面——按四项检查框架逐项套用：

- **静默失败**：无新增静默路径。异常上浮链路同点同序（§3.2.2 论证 3，SA2 规范推演复核成立）；顶层 try/catch（D11）收编面零变更。
- **状态闭环**：`{ok:false}` 单通道（D5/D6）构造点唯一（`notAllowed`），rev2 不触；崩溃边界 C3 形态（`DOCRT-E100: …`）不变。
- **降级路径**：无降级场景引入。**伪降级辨析**：`missing` 三源（Record 缺键/optional 缺席/越界）是 D8 立法的**合法缺席语义**，不是把 bug 当降级吸收——判据（正常流程应否总满足？）下 missing 是合法输入空间的正常成员；被测的 M-A「首 missing 即返回」才是旧错误逻辑，且恰好由新增测试杀死（判别力补缺的正题）。**非虚假降级**。
- **可感知性**：`message?` 非契约诊断字段形态不变；无用户交互面新增。

**结论：错误处理链路无回归、无伪降级。**

## 红线测试思路（按发现逐条）

- **发现 #1（静态验尸三连缺陷）**：不写运行时测试——调用点物化在合法输入上观测等价（§3.2.3 诚实缺口，SA2 独立证实），动态锁不可行；memberOutcomes 不导出 ⟹ test-d 类型锁亦不可行。**红线全部转为静态门禁命令**（修订后入 SA4 检查单，均可在 CI/本地复跑）：
  1. 注释剥离后 union 分支区域（含 memberOutcomes 定义体，行界按修订 (3)）`grep -nE 'Array\.from|\.map\(|\[\.\.\.'` → **零命中**；
  2. `grep -cE 'function\*\s+memberOutcomes' read.ts` → **恰 1**；
  3. `grep -n 'memberOutcomes' read.ts` → **恰 2 行**（定义 + `arbitrateUnion(memberOutcomes(…))` 直接实参调用）；
  4. `grep -c 'sawMissing' read.ts` → **恰 1**（INV-15 无第二仲裁实现）。
- **发现 #2（M-B 矩阵）**：无需新测试——冻结六行表已含全部断言（行 3-6 拉动 `[0,1]`）；修订的是**预测文档**。SA7 执行 M-B 的验收口径改为「红集合 = {3,4,6}」。
- **发现 #3（还原协议）**：协议前置检查命令（非测试）：Phase 1 前 `git status --porcelain packages/doc-runtime/src/read.ts` 必须为空；不允许中途 commit 时改用 sha256 前后比对。「中断可辨识」场景：基线已提交 ⟹ `git status` 干净 ⟺ 无变异（可辨识）；未提交基线下不可辨识 ⟹ 必须以前置条件排除该状态。
- **发现 #4（M-C 升格）**：无需新测试——执行 M-C 本身即动态证据（预期红：行 2 拉动断言，结果断言仍绿——「物化只毁惰性不毁结果」的双断言语义正好由该行验证）。
- **发现 #5（exports map）**：无需新测试——补引事实；H-d 可选负锁维持原设计（锁 barrel 面即可，deep import 由 exports map 兜底）。

## SA8 注记 D-1 回执（转交的攻击责任）

§3.2.2 论证 2（短路等价）/论证 3（异常传播）：**攻击未破**（见 Verdict 说明表）。§3.2.3 诚实缺口：定性诚实成立、拒绝 resolveLive 计数 seam 的理由成立；但设计为该缺口配置的唯一自动化防线（静态 grep）存在发现 #1 的三连缺陷——**缺口本身不可锁是必然，防线可锁而未锁好是缺陷**。已按要求给出修订与测试构想。

## 结论（R1）

**Verdict: reject（窄域）**。D19/D20/D21/INV-15 的架构裁决、§3.1.2/§3.2.1 伪代码主体、五点等价论证、D17 逐字保持、INV-14 包边界判据——经 SA2 独立攻击全部存活，**不需要任何重新设计**。但发现 #1（静态验尸自冲突+形态学缺口+区域未定义）、#2（M-B 矩阵行 3/6 预测错误）、#3（还原协议假 PASS/数据丢失路径）是三条 normative 条款在 SA4/SA7 执行阶段的必然失火点，#4/#5 为补强项。SA1 按「攻击点清单·建议」列修订设计文本（预计纯文档修订 <1 小时），SA2 复审仅核对此 5 项，通过即转 pass。pass 后本报告 §「未成立的攻击」清单供 SA4/SA7 直接复用，防止重复消耗。

---

# R2 复审（修订轮复审，2026-08-22）

- **复审范围（R1 承诺）**：仅核对 R1 五项发现是否按「攻击点清单·建议」落实——SA1 修订版 451 行（395 → 451），文末「SA2 反馈逐条回应」表 5/5 声称落实。伪代码语句主体与五点等价论证零改动（SA1 自检声明 + SA2 diff 核对属实：§3.1.2 函数体、§3.2.1 generator 体、§3.2.2 论证 1-6 逐字未动）。
- **复审方法**：文本逐条核对 + **静态门禁四命令 mock 实跑**（按冻结伪代码构造合规落地形态于 /tmp，不触 worktree）+ **三组阴性对照**（违规形态杀伤力验证）。

## 五项逐条核验

| # | R1 要求 | 落实位置 | SA2 核验结果 |
|---|---|---|---|
| #1（MAJOR）静态验尸三连缺陷 | (1) grep 改注释剥离后/规范 JSDoc 零字面量；(2) `function*` 形态锁 + 唯一调用点锁；(3) 放置位置与区域行界成文；INV-15 操作化 | §3.1.2（JSDoc 零禁形字面量 + 放置序固定：`NavOutcome → arbitrateUnion → memberOutcomes → resolveLive → navigate`）/ §3.2.1（JSDoc 零字面量 + **IIFE 变体撤销**——超出 R1 要求的正确收紧：内联形态会使形态锁失锚）/ §3.2.3（静态门禁四命令 + 口径说明 (i)-(iv)）/ §8.1 / §7 | **✅ 通过（mock 实跑验证）**。按冻结伪代码逐字构造 mock read.ts（416 行）实跑四命令：命令 1 exit=1（禁形零命中，span3 恰 14 行 = Phase A/B 双 union 块，与口径说明 (i) 吻合）；命令 2 = 1；命令 3 恰 2 行（312 定义 + 407 `arbitrateUnion(memberOutcomes(…))` 直接实参调用）；命令 4 = 1。**三组阴性对照**：(a) M-C 变异（seam 内 `Array.from`）→ 命令 1 命中；(b) eager-helper 漂移（`memberOutcomes` 普通函数返回数组、union 区域零禁形 token——R1 缺陷 #1(b) 的精确复现）→ 命令 1 **确实零命中**（证实 R1 判据）但**命令 2 = 0 捕获**（证实形态锁恰补此洞）；(c) 调用点物化（`Array.from(memberOutcomes(…))` 包裹）→ 命令 1 经 span3 命中。门禁杀伤力与 R1 要求逐点对齐。 |
| #2（MAJOR）M-B 矩阵行 3/6 预测错误 | 更正 M-B 红 = 行 3（结果）+ 行 4（双红）+ 行 6（拉动）；矩阵为证据记录基线注 | §3.3.2 M-B 行 / §3.3.1 矩阵基线注 | **✅ 通过**。修订后行 3 🔴 结果、行 4 🔴 双红、行 6 🔴 拉动——与 SA2 R1 推演（红集合 {3,4,6}）逐格一致；M-A/M-C/M-D 预测未动（R1 已复核无误）；「实测与矩阵冲突时先复查变异形态再定性、不得以实测覆盖矩阵记档」成文（超出要求的加固）。 |
| #3（MAJOR）还原协议假 PASS/数据丢失 | 前置「已提交」条件或非破坏性还原；废除未提交基线下 porcelain 空输出口径；中断恢复可辨识改写 | §3.3.3 全节改写（Phase 0.5 双路径） | **✅ 通过**。路径 P（提交基线：实现提交先于变异、时序强制分离、porcelain 空 ⟺ 可安全 `git checkout`，还原验收 = porcelain 复空）；路径 Q（cp+sha256 快照，还原验收 = sha256 相等 **且** `git diff` 与施变异前逐字节一致）——**未提交基线下「porcelain 空输出」验收口径明文废除**；中断可辨识按两路径改写（P：porcelain 非空 ⟺ 变异在场；Q：cmp 判定）+ 路径 Q 应急（快照丢失时全绿 + 四命令反证）——超出要求的兜底。R1 假 PASS 路径与数据丢失路径双封死。 |
| #4（MEDIUM）M-C 升格 | 强烈建议必做或记录跳过理由 | §3.3.1/§3.3.2/§3.3.3/§4.1/§4.3/摘要/决策总表 | **✅ 通过（七处口径同步实核）**：必做 = M-A + M-C，升格理由（D20 惰性契约唯一动态杀伤证据 + 「物化只毁惰性不毁结果」双断言语义）成文；Phase 1 协议改「每变异体独立走完施加→红→对照→还原→复绿」；M-B/M-D 维持可选。 |
| #5（LOW）INV-14 补引 exports map | 补引结构性后盾 | §3.1.1「INV-14 结构性后盾」段 / §7 INV-14 锚点 | **✅ 通过**。`"exports": { ".": "./src/index.ts" }` + `"private": true`（SA2 R1 实测同款事实）补引，Node `ERR_PACKAGE_PATH_NOT_EXPORTED` / TS bundler 双侧阻断成文；H-d 只需锁 barrel 面、包外 deep import 类型层拒绝自动生效；前瞻注记（解除 private/发布时须重审）——超出要求的完整性。 |

## 对 SA1 一处合理偏离的认定（记录在案）

R1 建议的 INV-15 操作化原案 `grep -c 'sawMissing' == 1` **本身有缺陷**——sawMissing 在合规 arbitrateUnion 体内合法出现 3 次（声明/记账/收尾），原案对合规实现必然误报。SA1 改采声明式锚点 `grep -c 'let sawMissing' == 1`，偏离理由成文于 §3.2.3 口径说明 (iii)，且经 mock 实跑验证恰 = 1。SA2 认定：**该偏离正确且优于原案**（对合规实现零误报；对「第二仲裁实现」的启发式强度与原案等同——两者对改名旗标的第二实现均需 SA4 区域 diff 纪律兜底，后者才是 INV-15 的主锚）。R1 报告相应建议以此为准修正。

## 非阻塞注记（供 SA4/SA7 执行参考，不构成返工）

1. 命令 1 的 perl 剥离对含 `//`/`/*` 的字符串字面量会误蚀——设计口径说明 (ii) 已声明「span 内字符串字面量无 `//`/`/*`」，SA4 复跑时如遇命中先人工看一眼是否字符串而非直接判违例（现冻结形态不触发）。
2. 路径 P 依赖「总控裁量执行实现提交」——SA7 启动 mutation proof 前应与总控确认提交已发生（Phase 0.5 命令输出为凭），避免路径选择悬空。
3. 本报告 R1 §「未成立的攻击」清单（seam 等价/异常传播/memo 写序/H-a/M-A/M-C/M-D 矩阵预测）经 R2 复核继续有效，SA4/SA7 可直接复用。

## R2 最终结论

**Verdict: pass。** R1 五项发现全部按建议落实且经实测验证（静态门禁四命令对合规形态零误报、对三种违规形态全捕获；M-B 矩阵勘误与 SA2 独立推演逐格一致；还原双路径封死假 PASS 与数据丢失；M-C 七处口径同步；exports map 补引属实）。SA1 的两处收紧（IIFE 变体撤销、矩阵基线注）与一处合理偏离（命令 4 声明式锚点）均经核验成立。设计可放行 SA3 实现。SA2 义务就此闭口——后续 SA4 按修订版 §3.2.3/§8.1 执行静态验尸（四命令可直接入检查单），SA7 按 §3.3.3 双路径协议执行 mutation proof（M-A + M-C 必做）。
