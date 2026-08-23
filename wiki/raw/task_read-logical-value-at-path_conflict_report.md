# 冲突门禁报告

- **被审对象**：`wiki/raw/task_read-logical-value-at-path.md`（任务简报，前置门禁 Phase 0）
- **冲突基准**：`docs/adr/` 全集（0001–0007，共 7 份，逐份全文读取，无抽样）+ `CONTEXT.md`
- **门禁人**：SA8（Conflict Gatekeeper）
- **日期**：2026-08-22（worktree: `/home/wangjian/nomicore-fix-issue-75`，branch `fix/issue-75-on-docs-doc-runtime-validation`）

## Verdict

`clear`

任务简报与 ADR 全集 + CONTEXT.md 无冲突。总控可放行，进入 SA1 设计。

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0001 | VFSL 文本是 schema 的唯一真相源，只存在于文档与测试中 | accepted（2026-08-19 修订：目标态/阶段态二分） | 间接 | 无冲突。任务消费 `derived`（派生 schema），不触 schema 文本、脚手架纪律或 SchemaSource 接缝；任务前提「Runtime 已维持结构不变量」与本 ADR 无交集 |
| ADR-0002 | nomicore 是全新 yjs-server 重写，authority 完全出范围 | accepted | 无关 | 无冲突。任务为纯读取能力，不涉 authority 规则，也不触「结构 → 值 → 单事务提交」写入管线 |
| ADR-0003 | 求值器与派生 schema | accepted（取代同号草稿，无对外 supersede） | 相关 | 无冲突。任务依赖的地基条款逐条吻合：ROOT 固定物化 Y.Map（空 path 读取完整 ROOT 的依据）；`xml-fragment` 为结构树终态节点（「leaf/plain/XML 不可下钻」的 XML 部分）；派生 schema 含结构树/值 schema/路径索引（`derived` 参数的形状）；ref 按名引用不内联展开（路径定位经共享解析器） |
| ADR-0004 | vfsl-protocol 类型协议包——编译期路径投影 | accepted | 间接 | 无冲突。D3 明确协议包「零运行时代码」，本 ADR 不构成运行时 API 约束。D5「路径不含 ROOT 前缀、空路径=根自身」与任务「空 path 显式读取完整 ROOT」跨层一致。D1 类型层 patch 路径用字符串下标（`'3'`）与 ADR-0007 运行时 number 下标为两层两接缝并存，非冲突（见注记 C） |
| ADR-0005 | 投影生成管线——SchemaSource 接缝、生成器输入契约、生成物入仓 | accepted | 无关 | 无冲突。codegen 管线与本任务（运行时读取）无交集 |
| ADR-0006 | Cordis 持久化插件与 doc 三条目内容布局 | accepted（含 2026-08-21 createDoc/owner 修订节） | 间接 | 无冲突。任务读取面止于 ROOT 子树，与「META/SCHEMA 作为 ROOT 的兄弟条目……校验只作用 ROOT 子树」一致；读取为同步纯读，不触持久层 saveDoc/dirty 语义 |
| ADR-0007 | 逻辑验证与 Yjs Runtime Bridge 分层 | accepted | **直接** | 无冲突。`readLogicalValueAtPath` 即本 ADR 在 `@nomicore/doc-runtime` 定义的能力；任务简报的 What to build 与全部 6 条验收标准逐条映射到本 ADR 条款（详见下方逐条对照） |

无任何 ADR 处于 superseded 状态（ADR-0003 取代的是同号未定稿草稿；ADR-0006 修订节取代的是本 ADR 内部早期条款，均已按现行有效文本对照）。

## 任务验收标准逐条对照（ADR-0007 为直接依据）

| # | 任务要求 | ADR-0007 条款（原文） | 裁决 |
|---|---|---|---|
| 1 | path 统一为 `readonly (string \| number)[]`；空 path 显式读取完整 ROOT | 「路径统一为 `readonly (string \| number)[]`：map/object/Record 使用 string，Y.Array 使用 number」；「空路径表示显式读取整个 ROOT」 | no-conflict |
| 2 | schema 不允许的路径返回 `PATH_NOT_ALLOWED` | 「Yjs 结构与路径/操作错误 fail-fast」；「底层能力各自保留领域化结果联合，不合并成巨型 issue 类型」 | no-conflict（错误码命名是任务层增补，见注记 B） |
| 3 | 合法 optional/Record 缺键和非负整数数组越界返回 `ok:true, value:undefined` | 「合法 optional/Record/数组缺失返回 `undefined`」 | no-conflict（边界细化，见注记 A） |
| 4 | 负数、非整数或字符串数组下标非法 | 「Y.Array 使用 number」；mutation 侧同类纪律「array insert/delete 使用严格非负整数边界，不 clamp」 | no-conflict |
| 5 | leaf/plain/XML 为不可下钻终态；plain 数组只允许整体读取 | 「leaf、plain、XML 是不可下钻终态」；ADR-0004 D1「`YPlainArray` 只能整体替换（普通 JSON 值，非 Y.Array——标记语义边界）」（读取为写入的自然对偶） | no-conflict |
| 6 | 读取成本与目标子树规模相关，返回值修改不影响 live doc | 「普通读取成本与目标 path 子树规模相关」；「同步按路径读取，只转换目标子树」（转换即产出普通逻辑值，非 Yjs 引用） | no-conflict |
| — | 前提：Runtime 已由加载/更新验证维持结构不变量，普通读取不重复全树验证 | 「依赖 create/open/update 已建立并维持的结构不变量，普通读取不重复验证」；「加载和更新负责验证，读取按 path 快速执行，不重复全树验证」 | no-conflict |
| — | 返回普通值副本，不泄漏 Yjs 类型 | 「只转换目标子树」；XML「JSON 快照中其值为 XML 字符串」；CONTEXT.md「逻辑快照校验……不接收 Y.Doc / Y.Map / Y.Array」的普通 JSON 逻辑值纪律 | no-conflict |

## 冲突点

无。

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| — | — | — | — | — | （空表：0 冲突点） |

裁决分布：no-conflict ×7（ADR 盘点）／override-declared ×0／evolution ×0／hard-violation ×0。

## 结论

**Verdict = clear，放行。** 任务简报实质是 ADR-0007 已冻结决策（`readLogicalValueAtPath` 条款）的实现落地票，未提出任何推翻或修订既有决策的意图。

三条**非冲突注记**（不阻塞，供 SA1 设计时显式落定、SA2 复核时重点攻击）：

- **注记 A（边界细化）**：「非负整数数组越界返回 `ok:true, value:undefined`」是对 ADR-0007「合法 optional/Record/数组缺失返回 `undefined`」的边界细化——ADR 未逐字枚举「越界」情形，任务的读法（格式合法但越界 = 缺失；负数/非整数/字符串 = 非法路径）在条款自然语义范围内，属细化而非修订。建议 SA1 在设计文档中显式写出该区分及理由。
- **注记 B（命名增补）**：`PATH_NOT_ALLOWED` 为任务层引入的稳定错误码命名；ADR-0007 只规定「路径/操作错误 fail-fast」+「底层能力各自保留领域化结果联合」。命名属增补不属违反，但 SA1 应保持其为 `@nomicore/doc-runtime` 领域化结果联合（`{ ok:false, code:… }` 形态），不得并入逻辑校验的 issues 体系（「不合并成巨型 issue 类型」）。
- **注记 C（跨层路径表示差异）**：ADR-0004 D1 编译期投影的 patch 路径用**字符串**下标（`['items','3',…]`），ADR-0007 运行时路径 Y.Array 用 **number**——两者是类型层与运行时两个独立接缝的既有并存状态（0004 D3 零运行时代码），本任务按 ADR-0007 实现运行时侧即正确；提醒 SA1 勿以 0004 的字符串下标形态为运行时依据。

**Blocked by #73**（任务图依赖）不属冲突门禁管辖，由总控按依赖图调度。
