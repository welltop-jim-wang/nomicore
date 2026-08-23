# 冲突门禁报告（设计后复审 · 修订轮 rev2）

- **被审对象**：`wiki/raw/task_read-logical-value-at-path_rev2_design.md`（SA1 rev2 产出：D19 seam 落位 / D20 惰性 generator 管线 / D21 mutation proof 协议 / INV-15 仲裁单点权威 / 0.1.3→0.1.4 bump）
- **冲突基准**：`docs/adr/` 全集（0001–0007，共 7 份，逐份全文读取，无抽样）+ `CONTEXT.md` + 前置产出 `…_rev2_relevant_decisions.md` / `…_rev2_conflict_report.md`（verdict clear，注记 R2-1..R2-5）
- **门禁人**：SA8（Conflict Gatekeeper）
- **日期**：2026-08-22（worktree `/home/wangjian/nomicore-fix-issue-75`，branch `fix/issue-75-on-docs-doc-runtime-validation`，run_id `issue-75-rev-1787397220`，PR #83）
- **复审性质**：设计 vs ADR 决策一致性（轻量复审；全维度攻击评审属 SA2，设计优劣不在本门禁职权内）。代码与 wiki 其他文档不构成自动阻塞依据；本报告中的代码实测仅用于**对账设计事实断言与前置裁决的一致性**。

## Verdict

`clear`

设计与 ADR 全集 + CONTEXT.md + 前置裁决零冲突。注记 R2-1/R2-2/R2-3 义务逐条落进 normative 条款；D19/D20 维持四项既有不变量，「载体迁移、零语义变更」主张成立；ALLOW/DENY 面与前置裁决一致且只收紧；无未成文的新协议级假设或公共契约改动。总控可放行至 SA2 攻击评审。

## ADR 盘点（7 份逐份对照设计）

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0001 | VFSL 文本是 schema 的唯一真相源 | accepted（2026-08-19 修订节） | 间接 | 无冲突。设计不触 schema 文本、方言冻结、脚手架纪律与 SchemaSource 接缝；改动面 = `packages/doc-runtime/src/read.ts` seam 区域 + package.json version + 包内测试 |
| ADR-0002 | nomicore 全新重写，authority 出范围 | accepted | 无关 | 无冲突。纯读取路径内部可测性重构，不触写入管线（「结构 → 值 → 单事务提交」三步零交集） |
| ADR-0003 | 求值器与派生 schema | accepted | **直接** | 无冲突。(a) D17 四规则**逐字迁移**——设计 §3.1.2 seam 函数体与 read.ts:351-360 现行内联循环逐行同构（`sawMissing` 记账 / 声明序 for-of / 首 value 按引用回传 / 耗尽 `sawMissing ? missing : reject` / 空成员 union → reject 同判，实测核对属实），「路径存在性为任一成员出现即存在」的读取维度兑付原样保持；(b) 判别式缓存条款不触（读取零判别式消费）；(c) 派生 schema 形状不动（`packages/vfsl` DENY 延续）；(d) §4「解析动作由**包内共享解析器**完成」为 D19 模块级导出形态提供家族级先例（extract.ts `walk`/`makeRefResolver` 包内导出存量实测属实：extract.ts:89/233 `export function`，index.ts 不转出） |
| ADR-0004 | vfsl-protocol 类型协议包 | accepted | 间接 | 无冲突。D3 协议包零运行时——设计不触；D4 test-d 方法学（`expectTypeOf` / `@ts-expect-error` 自反转）是 test-d 冻结形态锁与可选 H-d 负锁（§4.3）的共同方法出处——设计是该方法学的**延续适用**（H-d 引用出处成文），非修改 |
| ADR-0005 | 投影生成管线 | accepted | 无关 | 无冲突。codegen 管线与运行时读取零交集；`packages/vfsl-codegen/**` 入 DENY |
| ADR-0006 | Cordis 持久化插件与 doc 三条目布局 | accepted（含 createDoc/owner 修订节） | 间接 | 无冲突。读取面止于 ROOT 子树；持久层零交集（`packages/persistence/**` 等入 DENY） |
| ADR-0007 | 逻辑验证与 Yjs Runtime Bridge 分层 | accepted | **直接** | 无冲突。(a) 公共四能力、签名、结果联合零改动——`readLogicalValueAtPath` 契约逐字不变（设计 §6，INV-13）；(b) 「底层能力各自保留领域化结果联合，不合并成巨型 issue 类型」容纳 `NavOutcome` 包内三态，且「成功只返回 `{ok:true}`，不返回…内部类型」的公共接缝不泄漏内部类型精神经 INV-14 包边界判据维持；(c) 「普通读取成本与目标 path 子树规模相关」经 §3.2.2 论证 6 维持——generator 每成员 O(1) 常数因子，渐近界 O(触及节点数 × 路径长 × 成员扇出) 同式；(d) 「依赖 create/open/update 已建立并维持的结构不变量，普通读取不重复验证」——seam 为纯仲裁，零重验证引入；(e) 「性能优化必须在行为等价测试下后续引入」——本重构即以行为等价（INV-13 + AC-R2-5 全量复绿）为前置约束 |

无任何 ADR 处于 superseded 状态（同前置门禁结论：ADR-0003 取代同号未定稿草稿、ADR-0006 修订节取代本 ADR 内部早期条款——均按现行有效文本对照）。

## 重点核对一：注记 R2-1/R2-2/R2-3 义务是否逐条落进 normative 条款 —— 全部落实

| 前置注记 | 义务内容 | 设计落点（normative） | 核验结论 |
|---|---|---|---|
| **R2-1** seam 落位 + deep import 破例成文 | SA1 定夺落位并写入 ALLOW；index.ts 零转出口硬约束；deep import 破例成文防 SA4 误报 | §3.1.1 落位裁决表（A 采纳；B 新文件+转出口否决——循环依赖/纯间接层；C 经 index.ts 否决——直接违反 INV-14）；§3.1.1 deep import 破例专段（**包外零授权**；未来任何测试 deep import 须同等明文授权）；§3.1.2 seam 全量伪代码（SA3 逐字落地基准，签名 `arbitrateUnion(outcomes: Iterable<NavOutcome>): NavOutcome` 逐字冻结）；§8.1 ALLOW / §8.3 DENY 收口 | **落实**。事实对账吻合：11 个测试文件中 10 个 `../src/index.js`、唯 rev2 纯测试 deep import `../src/read.js`（grep 实测）；index.ts 现行导出恰冻结五项；read.ts 现状零 `arbitrateUnion`（红灯态干净） |
| **R2-2** 惰性攻击面 | 物化即破坏短路惰性；SA2 须攻击；动态锁属裁量 | §3.2.1 **normative 禁物化禁令**（memberOutcomes JSDoc ⛔ + 调用点禁 `Array.from`/数组展开/`.map()` 三形）；§3.2.3 三层锁表——seam 自身惰性 = SA6 动态锁（行 2 `pulled==[0]` / 行 3-6 `pulled==[0,1]`，实测在库）；调用点惰性 = normative 伪代码 + **SA4 静态义务**（union 分支区域 grep `Array.from\|\.map(\|\[…` 零命中）；**诚实缺口如实成文**（调用点物化在合法输入上观测等价、纯测试锁不到——定性为观测等价必然非疏漏，三重防御，并显式拒绝为锁它给 resolveLive 加计数 seam 的过度工程） | **落实且超出前置最低要求**（前置明言动态锁属裁量——设计同时具备禁令、动态锁、静态义务与缺口声明） |
| **R2-3** mutation proof 卫生 | (a) 只落 ALLOW 面；(b) 还原后 diff 归零；(c) 不得随 commit/push 泄漏 | §3.3.3 执行协议成文：M-A 施于 seam 内 ≤2 行（**ALLOW 面内**，(a)）；Phase 2 `git checkout -- read.ts` + `git diff --stat` / `git status --porcelain` **空输出硬验收** + 全量复绿（(b)）；「**变异态严禁 commit**——若 Phase 1/2 之间中断，恢复第一步 `git status` 检查并还原」（(c)）；证据义务（Phase 0/1/2 命令与输出、对照绿清单）入 SA7 报告 | **落实**。(a)(b)(c) 三点全部 normative 成文 |
| （附）R2-4 DENY 延续 | vfsl/extract/carrier/index/read.ts Phase A 等延续 | §8.3 全延续且只收紧（详见重点核对三） | 落实 |
| （附）R2-5 SA6 owned 分工 | SA6 执行措辞勘误、SA3 不触已入库断言 | §4.1（AC-R2-3 行「SA6 已完成，SA3/后续 SA 零触碰」）+ §8.1/§8.2 `[SA6 owned]` 标签 + §4.2「不收窄、不重写、不删改任何 SA6 断言」 | 落实（commit `7f77384` 含勘误 + 红灯文件，实测属实） |

## 重点核对二：D19/D20 是否维持四项既有不变量 —— 「载体迁移、零语义变更」成立

| 不变量 | 设计维持手段 | 核验结论 |
|---|---|---|
| **INV-14**（三态不泄漏，包边界判据） | 判据精确化与前置裁决同款表述（约束单位 = 包边界 = index.ts 公共导出面）；index.ts 入 DENY 且收紧为「任何改动禁止 + 公共导出零新增」；`NavOutcome` 仅模块级 export、**形状零改动**；test-d 冻结形态锁保持绿；可选 H-d 负锁补强 | **维持**（是判据的成文精确化，非放松：包外消费者不可见性不变，包外零授权成文） |
| **INV-7**（声明序 + 首 value 短路惰性） | generator 保序 for-of（`for (const m of node.members)` 原样）+ seam 首 value return 短路（§3.2.2 论证 1/2：短路两侧试探集相等，for-of 提前退出触发 generator `.return()` 关闭、后序 body 零执行）；行 2 拉动断言动态锚定 | **维持**（且较 rev1 内联形态首次获得动态可测锚） |
| **D13**（memo 挂点与写序不变） | `resolveLive` 本体入子文件级 DENY（挂点结构不动）；论证链：调用序逐位相同（论证 1）⟹ memo 键集/值/写序完全一致（论证 5）；上界同式（论证 6）；H-a 护栏（26 层链 <2s）锚点不变 | **维持**（健全性论证零新假设——memo 写入全部发生在不动点 `resolveLive` 内部，写序是调用序的确定函数） |
| **INV-13**（观测等价） | §3.2.2 五点论证：试探序列逐位相同 / 短路等价 / 异常传播同点同序同形态（generator 与 for-of 均不捕获，冒泡路径 `resolveLive → generator → arbitrateUnion → navigate → … → 顶层 catch → C3(DOCRT-E100)` 与 rev1 逐点相同）/ 耗尽收尾同构（聚合对象新鲜性、空成员同判）/ memo 写序不变 | **成立**——seam 函数体与现行 read.ts:351-360 逐行同构（实测对照）；「载体迁移」主张属实 |

**「载体迁移、零语义变更」判定：成立。** D17 四规则逐字保持（§3.4 复核表 + 函数体逐行对照）；公共面 `readLogicalValueAtPath` 契约逐字不变；不构成 ADR 演进（同前置门禁特别审查点结论），无 Jim 裁决项。

## 重点核对三：ALLOW/DENY 面与前置裁决一致性 —— 一致（只收紧，无松动）

| 面项 | 前置裁决 | 设计成文 | 结论 |
|---|---|---|---|
| `src/index.ts` | 注记 R2-1/R2-4：零转出口；AC-R2-1「公共导出零新增」 | §8.3：**任何改动禁止**（rev2 收紧表述：公共导出零新增，`arbitrateUnion`/`NavOutcome` 不得经此转出口） | 一致（收紧） |
| `packages/vfsl/src/**` | DENY 延续 + 不得为凑测试虚构可达性/放宽结构系统 | §8.3 首条 + §1.3 边界义务重申（SA5 Fix direction + 注记 R2-4；E309 等禁令是竞争不可达论证的前提事实） | 一致 |
| extract.ts / carrier.ts | 行为变更禁止；存量包内导出不回退 | §8.3：行为变更禁止 + 「extract.ts 首轮已评审的 `walk`/`makeRefResolver` 包内导出属存量，不回退、本轮零新改动」 | 一致 |
| read.ts 子文件级 DENY | 前置清单：Phase A 全部、`notAllowed`、顶层 try/catch 编排 | §8.3 同三项**之外追加**：map/array/leaf/plain/xml-fragment 分支、终点 `walk` 委托、`resolveLive` 本体（memo 挂点结构） | 一致（**追加为收紧**，非松动——被追加项恰是 INV-13/D13 论证的前提不动点） |
| SA6 owned 测试 | 注记 R2-5：不入 DENY、SA3 不改断言 | §8.1：rev2 红灯文件 + rev1 勘误文件带 `[SA6 owned]` 标签入 ALLOW；§8.2 显式「预期零改动 · SA6 owned 冻结锁……**不入 DENY**」 | 一致 |
| M-A 变异点 | R2-3(a)：只落 ALLOW 面 | §3.3.3：施于 seam 内 ≤2 行——seam 为本轮 ALLOW 新增区域（§8.1），基线 `7f77384` | 一致 |
| 其余包/根配置 | 无交集 | §8.3：vfsl-protocol/persistence/dsh-persistence/vfsl-codegen/apps/根配置全列 DENY | 一致 |

**唯一 ALLOW 增项**：可选 H-d 负锁 test-d **新建文件**（§4.3，SA4/SA7 裁量、SA3 不编写、不改既有 test-d 冻结文件、非 AC 义务）——新增文件不触任何 SA6 owned 既有断言，方法学出处 ADR-0004 D4 成文，与前置裁决无矛盾（见非冲突注记 D-2）。

## 重点核对四：新增协议级假设 / 公共契约改动 —— 零未成文项

- **协议级假设**：设计 §5 明示**无新增**（纯包内重构：无 HTTP/WS/端口/进程/三方库行为假设）。四项语言级/工具链事实全部带依据且经本门禁抽验属实：for-of 逐项拉动（行 2 断言在库）；generator 惰性（行 1/2 拉动断言合取）；`.js` 后缀 deep import 解析（`tsconfig.base.json` `moduleResolution: "bundler"` 实测 + read.ts:25 `./extract.js` 先例 + 10 文件 index.js 通道现绿）；vitest include 无按导入路径过滤（根 vitest.config.ts 实测 `include: ['packages/*/test/**/*.test.ts', …]`）。
- **公共契约改动**：设计 §6 成文「公共契约改动 = 无」——五类改动（return→throw / Promise 形态 / 同步→异步 / catch rethrow / nullable 翻转）逐项为零；新增接缝全包内（`arbitrateUnion` 不上 barrel、`memberOutcomes` 不导出、`NavOutcome` 仅可见性包内放宽且形状冻结）；实测 index.ts 五项导出、read.ts 现状零 `arbitrateUnion` / 零 `Array.from`（红灯态基线干净）。**未发现任何未成文覆盖的公共契约改动**。
- **新增不变量 INV-15**（仲裁单点权威）为**包内**不变量，非公共契约变更，验证锚成文（§7：纯测试行 1-6 / SA4 静态验尸 / M-A 单点变异全路径转红）。
- 版本 bump 0.1.3 → 0.1.4：仅 version 字段（实测现状 0.1.3），流水线门禁惯例，无 ADR 约束（同前置裁决）。

## 冲突点

无。

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| — | — | — | — | — | （空表：0 冲突点） |

裁决分布：no-conflict（ADR 盘点 7 + 重点核对四项 + 注记 R2-1..R2-5 义务逐条）；override-declared ×0；evolution ×0；hard-violation ×0。

## 非冲突注记（不阻塞；指定验证责任）

- **注记 D-1（诚实缺口攻击责任转交 SA2）**：§3.2.3 已如实成文「调用点惰性纯测试锁不到」（合法输入上观测等价——与 rev1 H-b 竞争场景 green lock 缺口同款定性，非设计疏漏），防御 = normative 伪代码 + SA4 静态 grep + 代码评审三重。SA2 攻击评审应以 §3.2.3 调用点与 §3.2.2 论证 2/3（短路等价、异常传播同点同序）为首要攻击对象——前置注记 R2-2 的延续，属 SA2 职权，本门禁不判优劣。
- **注记 D-2（H-d 可选锚点不构成 AC 门禁义务）**：H-d 为 SA4/SA7 裁量性补强（非 AC-R2-1 条文），AC 门禁不应以 H-d 未落地判 AC-R2-1 失败；若落地，其为新增 test-d 文件（非 SA6 authored），不触 SA6 owned 既有断言，与注记 R2-5 分工无矛盾。
- **注记 D-3（事实基线对账清单可复用）**：设计全部可验事实断言经本门禁抽验属实——index.ts 恰冻结五项导出、read.ts:268（`NavOutcome`）/351-360（union 内联仲裁）、11 测试文件导入分布（10 index.js + 1 read.js）、SA6 commit `7f77384`（红灯文件 128 行新增 + rev1 勘误 52 行改动）、package.json 0.1.3、vitest/tsconfig 配置、extract.ts:89/233 包内导出先例。SA4 静态验尸与 SA7 动态验证可直接复用该对账清单。

## 结论

**Verdict = clear，放行至 SA2 攻击评审。** SA1 rev2 设计是对前置门禁裁决与 owner 建议的忠实兑付：注记 R2-1/R2-2/R2-3（含 R2-4/R2-5）义务全部落进 normative 条款且可执行锚成文；D19/D20 以「载体迁移」形态维持 INV-14/INV-7/D13/INV-13 四项既有不变量（函数体逐行对照成立，渐近成本界同式）；ALLOW/DENY 面与前置裁决一致且方向只收紧；无任何未成文的新协议级假设或公共契约改动。「载体迁移、零语义变更」不构成 ADR 演进，无 override，无 Jim 裁决项。后续验证责任：SA2 攻击 §3.2.2/§3.2.3（注记 D-1）；SA3 逐字落地 §3.1.2/§3.2.1 伪代码；SA4 执行 §8.1 静态义务（区域边界 + 禁物化 grep + DENY set 比对）；SA7 执行 §3.3.3 mutation proof 全协议（diff 归零 + 禁泄漏硬验收）。
