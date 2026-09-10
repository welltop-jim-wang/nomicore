# SA8 冲突门禁报告 — issue #268 REST create：请求形状校验、资源 limits 与 4xx/422 错误契约

- 被审对象：`wiki/raw/task_issue-268.md`（issue #268 任务简报，含 What to build 五节 + AC 五条）
- 冲突基准：`docs/adr/` 全集 0001–0012、0014、0015（共 14 份，全量盘点）+ 根 `CONTEXT.md`
- 门禁类型：Phase 前置门禁（SA 派发前，迭代 0）
- 审查日期：2026-09-11 基线（worktree branch `mabf/issue-268`，HEAD = `0b06050` fix(#267) REST router 骨架 (#296)；父集成 PR #158 分支 `docs/rest-namespace-create`）
- Issue 评论快照：REST 读取返回 `[]`（dispatch log 已记录 `comments=none`）；本次以 `gh issue view 268 --comments` 复核确认无评论——**无 owner 追加要求、无评论锚定义务适用**

## Verdict

**`clear`** —— 无冲突，任务可派发（proceed）。

一句话理由：简报五节与五条 AC 是 ADR 0015 §HTTP 契约（L63–75）、§JSON 处理与资源限制（L94–115）、§错误契约（L163–165）的逐条落实，defaults 数值与 4xx/422 映射逐字对齐；唯一前置依赖 #267 已 CLOSED 且其骨架已实证在基线，简报范围恰为骨架 AGENTS.md 明文划给「后续错误契约票」的加法工作。

## ADR 盘点（全量 14 份 + CONTEXT.md）

| 编号 | 标题 | 状态 | 相关度 | 对照结论 |
|---|---|---|---|---|
| 0001 | VFSL 单一真相源 | 已接受 | 低 | schema 语义归 VFSL；简报明文把 schema/ROOT 领域校验下放 Registry/VFSL，REST 不预设形状——同向 |
| 0002 | 重写定位、authority 出范围 | 已接受 | 无 | 范围界定，无涉 |
| 0003 | 求值器与派生 schema | 已接受（吸收被撤销草稿） | 低 | `deriveSchemaIdentity` 复用现有编译 pipeline；本任务不触求值器 |
| 0004 | vfsl-protocol 类型投影 | 已接受 | 无 | 编译期投影域，无涉 |
| 0005 | 投影生成管线 | 已接受 | 无 | 无涉 |
| 0006 | Cordis 持久化插件 | 已接受（#64/#79 修订） | 低 | Persistence create 由 Registry 经手；REST 不直接触 Persistence，无涉 |
| 0007 | 逻辑验证与 Runtime Bridge | 已接受（Runtime/open/read 条款被 0008 部分取代） | 低 | 被取代部分不构成约束；ROOT 校验入口（validateLogicalSnapshot）经 Registry 消费，与简报「ROOT 领域合法性归 Registry/VFSL」一致 |
| 0008 | NamespaceRuntime 读写能力与单序列器 | 已接受 | 低 | REST 经 Lease/release 生命周期（#267 已落）；本任务只加请求侧校验，不触 Runtime |
| 0009 | NamespaceRegistry、租约与 Host 生命周期 | 已接受 | **中** | §Create 输入恰 owner/schema/root、排队冻结输入、`NAMESPACE_ROOT_INVALID`/`NAMESPACE_SCHEMA_INVALID` 带 issues 的窄 issue 面 = 422 映射的结构依据；`NAMESPACE_CREATE_INVALID_INPUT`/`NAMESPACE_ALREADY_EXISTS` 归 ADR 0015 L180 的 500 内部契约违例路径（不在 #268 范围） |
| 0010 | Hub/Peer WebSocket Y.Doc 复制 | 已接受 | 低 | 本任务不触复制；新 namespace 维持 replication-disabled（#267 已落，不回退） |
| 0011 | Best-effort 诊断变更日志 | 已接受 | 低 | REST observer 事件发射属后续 FR-4 票；本任务零事件发射，与「emit 不改变业务结局」纪律无交叉 |
| 0012 | 实例身份单一真相与 WS plugin 所有权 | 已接受 | 低 | role 已由 #267 从 Instance service 注入；本任务不加第二 role 源、不触 role gate |
| 0014 | VFSL 校验的 JSONL/framed sidecar 日志 | 已接受 | 低 | 诊断日志格式域；本任务不触 |
| 0015 | 纵向 REST namespace create 与内容寻址 schema ID | **提议** | **核心** | 简报全部条款的直接规格来源；逐条对照见下表。状态仍为「提议」见观察项 O-1（非阻塞） |
| CONTEXT.md | 术语与惯例 | — | 低 | 无 REST/problem-shape 术语被冻结；「内容寻址 schema ID」（sc1-）、「逻辑快照校验」（创建前校验）、「namespaceId」（Registry 受控生成）与简报语义一致，见观察项 O-4 |

无被 supersede 的 ADR 构成约束（0007 被取代条款已排除；0013 编号空缺，非取代痕迹）。

## 任务要求对照表（简报 → 决策集）

| # | 任务要求（简报） | ADR 冻结条款（出处） | 裁决 |
|---|---|---|---|
| 1 | owner 用 Registry 既有安全文法；path 不允许 percent-encoding，非法 400 | ADR 0015 L66「owner 使用 Registry 既有安全文法，path 中不允许 percent-encoding」+ L169「400：非法 owner」 | no-conflict（逐字） |
| 2 | 首版不接受 query 参数 | ADR 0015 L67 | no-conflict（逐字） |
| 3 | 缺失/不兼容 Content-Type → 415；接受 `application/json` 与仅带 `charset=utf-8` 形式 | ADR 0015 L70 | no-conflict（逐字） |
| 4 | Content-Encoding 只接受缺失或 `identity` | ADR 0015 L71 + L173 | no-conflict（逐字） |
| 5 | CORS/OPTIONS 由外层截获，否则按方法不匹配处理 | ADR 0015 L69（405 + `Allow: POST` 已由 #267 骨架实现，L201 测试项） | no-conflict |
| 6 | 不实现独立 JSON parser：有界收集 bytes → 严格 UTF-8 解码 → 平台标准解析 → 顶层形状与资源检查 | ADR 0015 L94–99（§JSON 处理首句即「不实现独立 JSON parser，也不引入 SAX/token parser」） | no-conflict（逐字） |
| 7 | 重复 key last-key-wins；malformed JSON 只返回通用 400 错误、不返回源码位置 | ADR 0015 L101 | no-conflict（逐字） |
| 8 | Content-Length 仅作提前拒绝优化；stream 始终执行 byte 上限 | ADR 0015 L113 | no-conflict（逐字） |
| 9 | 顶层非数组 object、恰 `schemaText`+`root` 两个 own keys；`root` 必须显式提交；`schemaText` 必须 string（空串交 VFSL） | ADR 0015 L72–75 | no-conflict（逐字） |
| 10 | ROOT 领域合法性归 Registry/VFSL（invalid → 422）；REST 不预设形状 | ADR 0015 L75 + L174「422：VFSL schema invalid或ROOT invalid」；CONTEXT.md「逻辑快照校验」（创建前校验共用入口） | no-conflict |
| 11 | 默认 limits 七项：body 4 MiB / schemaText 256 KiB UTF-8 bytes / depth 64 / nodes 100,000 / issues 100 / 单条 message 1,024 bytes / issues 总预算 64 KiB | ADR 0015 L103–111 逐项同值 | no-conflict（数值逐一相符） |
| 12 | Host Partial 覆盖；未知键与越界值构造时 TypeError；`maxSchemaTextBytes ≤ maxBodyBytes`；超限 413 | ADR 0015 L113 + L30（构造配置错误普通 TypeError）+ L172 | no-conflict（逐字） |
| 13 | depth/nodes/不安全整数以迭代方式检查，避免递归栈溢出 | ADR 0015 L115 | no-conflict（逐字） |
| 14 | REST 不为 `-0` 建立额外语义 | ADR 0015 L115 | no-conflict（逐字） |
| 15 | 错误 response 固定 problem shape；客户端只按稳定 code 分支；issues 映射为受控可序列化 REST issue（稳定 code、可选 line/column 或 path、byte 上限安全 message）；不返回 schema/root 片段；截断显式 `issuesTruncated: true` | ADR 0015 L164–165 | no-conflict（逐字） |
| AC1 | 400（owner/query/空 body/malformed JSON/形状/数字范围）/415/413/422 状态映射 | ADR 0015 L169–174 主要映射表；「数字范围→400」与「结构超限→413」的二分同表在案 | no-conflict |
| AC2 | defaults 生效 + Partial 覆盖 + 未知键/越界 TypeError + `maxSchemaTextBytes > maxBodyBytes` 拒绝 | 同上 #12 | no-conflict |
| AC3 | depth/nodes 迭代实现，深嵌套不栈溢出 | 同上 #13 | no-conflict |
| AC4 | problem shape、issues 受控安全、`issuesTruncated` | 同上 #15；「不泄露 schema/root 片段」与 ADR 0009 L95 公开 message 脱敏纪律同向 | no-conflict |
| AC5 | 重复 key、`-0` 无额外语义；malformed JSON 无源码位置 | 同上 #7/#14 | no-conflict |

执行顺序兼容性核验：#268 在 #267 骨架的「owner 捕获 → body 读取」之间插入 ADR 0015 L148–153 的 step 3（owner/query/Content-Type/Encoding 检查）并把 step 4–5 从「最小读取」升级为「有界读取 + 形状/资源检查」——这是 ADR 固定顺序的补全而非 reorder；role gate 仍先于 owner 解码/body 读取/Registry 触达（ADR 0015 L38–41），Peer 语义不受影响。

## 冲突点

无 hard-violation、无 override-declared、无未授权演进项。零阻塞冲突。

| # | 严重度 | 类型 | 描述 | 裁决 |
|---|---|---|---|---|
| — | — | — | （空） | — |

## 观察项（非阻塞，移交 SA1/总控）

| # | 观察项 | 说明与建议 |
|---|---|---|
| O-1 | ADR 0015 状态仍为「提议」 | 其前两张实施票（#266 sc1- 已合、#267 骨架已合）均已在父 PR #158 分支落地。属 ADR 语料卫生：建议阶段收官时随集成 PR 把状态翻为「已接受」，不构成本门禁阻塞依据（简报与 ADR 同向，无冲突可言） |
| O-2 | 切片边界：简报只覆盖入站 4xx/422 | ADR 0015 L175–180 的 503 `REGISTRY_NOT_ACCEPTING`、500 三族、`NAMESPACE_ALREADY_EXISTS`/`NAMESPACE_CREATE_INVALID_INPUT` → 安全 500，及 L184–190 observer 事件发射（FR-4）不在简报 AC 内——骨架对这些结局维持 rejection 是既定加法路线，非冲突。**注意**：ADR L113 把「body 读取尊重 `Request.signal`、中断后 Registry 零触达」与 byte 上限写在同一条，而简报 AC 未列 signal——建议总控/SA1 明确 signal 归属 #268 还是后续票（骨架 AGENTS.md deferred 清单把「limits enforcement and `Request.signal`」并为一项，倾向随 #268 有界读取一并落） |
| O-3 | owner 安全文法的复用路径 | `validateOwnerIdentity` / `isMinimalSafeString` 在 `packages/namespace-registry/src/identity.ts` 但**不在** `@nomicore/namespace-registry` 公共导出（index.ts 只出工厂/错误类/plugin 面/类型）。简报要求「Registry 既有安全文法」——SA1 须裁决：经 registry 公共面导出复用（遵循其 AGENTS.md「Add public APIs only through src/index.ts」）或在 namespace-api 内复刻（有与 Registry 判定漂移的风险）。设计裁决点，非冲突 |
| O-4 | CONTEXT.md 术语卫生 | 「problem shape」「issuesTruncated」「REST issue」目前仅存在于 ADR 0015；按 docs/AGENTS.md「引入领域术语须更新 CONTEXT.md」，实施票落地时应评估是否补条目。文档卫生，非冲突 |
| O-5 | 422 与 500 的结构前提已具备 | ADR 0015 L180「REST 自行构造合法 Registry 输入 ⇒ INVALID_INPUT/ALREADY_EXISTS 视为内部契约违例」之所以能与「ROOT invalid → 422」并存，依赖 Registry 窄 issue 面把 ROOT/schema 非法表达为独立 code——已实证 `CreateNamespaceIssue` 含 `NAMESPACE_SCHEMA_INVALID`/`NAMESPACE_ROOT_INVALID`（均带 `issues`）与 `NAMESPACE_CREATE_INVALID_INPUT` 分立（`packages/namespace-registry/src/types.ts` L275–292）。SA1 设计时直接消费该判别即可 |

## 依赖与前置条件核验（实证）

| 前置 | 要求来源 | 证据 | 结论 |
|---|---|---|---|
| #267 已完成 | 简报「Blocked by: #267」 | `gh issue view 267` → state **CLOSED**（label `ci-passed`）；实现经 PR #296 于 2026-09-10T21:51:35Z merge | ✓ |
| GitHub 原生依赖全解 | issue-tracker.md 依赖门 | `gh api .../issues/268` → `issue_dependencies_summary.blocked_by = 0`（`total_blocked_by: 1` 已全部关闭） | ✓ 依赖门通过 |
| #267 骨架在当前基线 | 简报「在 REST router 骨架上叠加」 | worktree HEAD `0b06050` 即 #296 merge commit；`packages/namespace-api/src/rest.ts` + `create-namespace.ts` 在树 | ✓ |
| 父集成 PR 活跃、基线分支正确 | 简报「Parent: PR #158」+ issue-tracker Parent 约定 | PR #158 state **OPEN**（base `main`，head `docs/rest-namespace-create`）；本 worktree 分支 `mabf/issue-268` 基于 #296 之后 | ✓ |
| #266 sc1- 窄接口在基线 | ADR 0015 §内容寻址 schema ID（step 6 输入） | `packages/vfsl/src/index.ts` L225+：`deriveSchemaIdentity(text)` 公共导出，ok 分支恰 `semanticFingerprint` + `schemaId`（`sc1-<52 位 Base32>`）；commit `8fa85d2` (#276) 已合 | ✓ |
| limits 构造面已预留 | ADR 0015 L22–28 注入项 | `rest.ts` L30–38 `RestRouterLimits` 七键与 ADR 七 defaults 一一对应；构造已浅复制冻结（未消费）——#268 补校验/执行不必改公共构造签名 | ✓ |
| 冻结验收套件无冲突断言 | namespace-api AGENTS.md「frozen acceptance contract, do not edit」 | `grep reject/unmapped/400/413/415/422 packages/namespace-api/test/*.test.ts` → 零命中：#267 套件只锚定成功路径、405/403、matched:false 与公共面——rejection→Response 替换为纯加法 | ✓ |
| Issue 评论义务 | dispatch 指令 | REST 快照 `[]`；`gh issue view 268 --comments` 复核无评论；label `in-progress`、无 assignee | ✓ 无评论锚定义务 |

## 可行性核验（seam 实证）

| 能力 | 需求 | 现状证据 |
|---|---|---|
| 有界读取 + 严格 UTF-8 + 平台 JSON | 简报 JSON 节 | Node 20/24 平台 API（`TextDecoder('utf-8',{fatal:true})`、`JSON.parse`）即可，无需新依赖；#267 骨架 step 4 现为 `request.json()` 最小读取，替换点单一（`create-namespace.ts` L36） |
| 迭代 depth/nodes/不安全整数检查 | 简报 limits 节 | 解析后 JSON 为 plain data，迭代遍历为纯代码工作，无既有递归约束 |
| 422 issues 映射 | 简报错误契约 | `deriveSchemaIdentity` 失败面 = 原生 `VfslIssue[]`（骨架 L47–48 已携带于 cause）；Registry `NAMESPACE_ROOT_INVALID` 亦带 `issues`（registry.ts L583、create-document.ts L66/L110） |
| problem shape / issuesTruncated | 简报错误契约 | 骨架 L79 注记「错误 body 临时值…完整 problem shape 属 FR-3 票」——即本票，无既有冻结 shape 需要打破；403/405 已有临时 `{code}` body，升级为 problem shape 属加法 |
| owner 文法 / percent-encoding 拒绝 | 简报 HTTP 层 | 路由已 raw 捕获 owner 段（`([^/]+)`，rest.ts L77/L167）；percent-encoding 检测为 raw 串含 `%` 判定；文法本体见 O-3 |

## 结论

**`clear`，可派发。**

- 冲突面：简报与 ADR 全集 + CONTEXT.md 逐条对照 **0 冲突**（15 项要求 + 5 条 AC 全部 no-conflict，其中 14 项与 ADR 0015 逐字或逐值对齐）；无 override、无未授权演进。
- 依赖面：唯一前置 #267 CLOSED（ci-passed），GitHub 原生依赖 `blocked_by=0`；父 PR #158 活跃且本基线已含 #267 骨架与 #266 sc1- 接口。
- 可行性：全部所需 seam（`RestRouterLimits` 预留面、`deriveSchemaIdentity`、Registry 判别式 issue 面、raw owner 捕获、无冲突断言的冻结测试套件）已实证在基线；#268 是骨架明文预告的加法票（FR-1 limits + FR-3 错误契约的入站部分）。
- 移交 SA1 的裁决点（均非冲突）：O-2 signal 归属、O-3 owner 文法复用路径、O-5 直接消费 Registry 判别式 issue code。

—— SA8 conflict-gate · iteration 0 · 2026-09-11
