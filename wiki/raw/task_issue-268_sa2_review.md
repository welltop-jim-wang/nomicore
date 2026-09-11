# SA2 设计攻击评审 — issue #268：REST create 请求形状校验、资源 limits 与 4xx/422 错误契约

> 评审对象：`wiki/raw/task_issue-268_design.md`（SA1 **iteration 1**，评审修订版，602 行）。
> 评审者：SA2（独立攻击视角；不修改设计、不运行测试、不启动服务）。
> Verdict：**`approve`**。iteration 0 的两项 MAJOR（F1 包 README 契约同步缺席文件范围；
> F2 严格 UTF-8 解码/`INVALID_BODY_ENCODING` 零可执行验收）已逐条核验**完全落实**；
> 5 项 non-blocking 观察 M-1/M-2/M-3/M-5 已落实、M-4 记录维持理由；未发现对任务简报、
> 冻结 SA6 契约或 SA8 决议的回归。残留 2 项新的 non-blocking 观察（N-1/N-2，见 §14）。
> 无 BLOCKER/MAJOR；无需重跑冲突门禁（§设计后冲突复查）。

## 1. Reviewed inputs

| 输入 | 状态 |
|---|---|
| `wiki/raw/task_issue-268.md`（任务简报，Issue #268，comments 快照空） | 已读 |
| `wiki/raw/task_issue-268_design.md`（被审设计，iteration 1，602 行） | 已读（全文） |
| `wiki/raw/task_issue-268_sa6_contract.md`（SA6 契约报告，verdict `approve`） | 已读（UTF-8/signal 断言边界、冻结面、H5–H9 关键节复核） |
| `wiki/raw/task_issue-268_conflict_report.md`（SA8 冲突门禁，verdict `clear`，O-1..O-5） | 已读 |
| `wiki/raw/task_268_dispatch.md`（派发记录：sa8/sa6/sa1×2/sa2×2 全部 `comments=none`，含本 iteration） | 已读 |
| iteration 0 SA2 评审（本文件前身，F1/F2 + M-1..M-5） | 已读（作为修订核验基线） |
| 源码锚点：`packages/namespace-api/src/{rest,create-namespace,index}.ts`、`packages/namespace-api/{README.md,AGENTS.md,package.json}`、`packages/namespace-registry/src/identity.ts`、`packages/namespace-registry/test/registry-surface.test.ts`、`docs/adr/0015-vertical-rest-namespace-create.md`、`docs/AGENTS.md`、根 `CONTEXT.md`、`vitest.config.ts` | 已读/已核 |
| 测试锚点：namespace-api `test/` 全部 11 文件 + 两个 harness（#267 冻结 4+1、#268 冻结 4+1） | 已读/已核（含 `streamedJsonRequest`/`observeProblem`/`buildFailureScenario`/`createPoisonRegistry`/`releaseGate` 全部被引设施） |
| 仓库基线：`git status`/`git diff HEAD`——跟踪文件零 diff（src 与 HEAD `0b06050` 一致；仅冻结测试与 wiki 产物未跟踪） | 已核 |

仓库基线事实（独立复核，与 iteration 0 一致且未被修订破坏）：`createRestRouter`/
`orchestrateCreateNamespace` 全仓调用方均在 namespace-api 包内；Registry 主入口运行时导出被
`registry-surface.test.ts` 冻结为恰 9 个 value；`isMinimalSafeString` 文法（identity.ts
L88–99）与 D7 镜像逐条一致；README L9–10/L19–21、AGENTS.md L15–16 的「Deferred/未映射」
陈述与设计 §2 #11 引文**逐字一致**（本次重点核验——F1 证据锚成立）；ADR 0015 L96–99
（严格 UTF-8 步骤）、L103–113（七默认值/Partial 门/跨字段/413/Content-Length/signal）、
L115（迭代检查/`-0`）、L163–165（problem 契约）、L174/L180（422/安全 500）、L220–228
（非目标）逐行核对无误；docs/AGENTS.md L13「update every normative document whose
stated contract changed」原文在树；根 `CONTEXT.md` 无 `problem shape`/`REST issue`/
`issuesTruncated`（O-4 加法仍成立）；vitest include `packages/*/test/**/*.test.ts` 覆盖
新测试文件发现。

## 2. Verdict

**`approve`** —— 设计（iteration 1）可安全交付实施。

- **F1（MAJOR→已解决）**：§7 D13 新增「规范性文档同步」决策，逐文档列出失效陈述与修订
  方向；§2 #11 新增事实锚点（README/AGENTS 引文经本次独立核对逐字准确）；§10 ALLOW LIST
  增补 `packages/namespace-api/README.md` 行（覆盖 Deferred scope 与 Public API `handle`
  两处），AGENTS.md 行显式点名校正「trusted…because body reads are not yet bounded」
  尾句；DENY LIST 无冲突（README 属本票改动包内文档）。iteration 0 F1 的验收条件
  （「ALLOW 含该行且 DENY 不与之冲突」）逐项满足。
- **F2（MAJOR→已解决）**：§10 ALLOW 新增测试文件 `test/rest-create-body-read.test.ts`
  （由 iteration 0 的 signal-only 文件更名扩围，文件尚不存在、更名零成本）含 4 场景：
  ① abort 中断→rejection+零触达；② 接纳后取消不传播；③ 流式 invalid-UTF-8 →
  400 `INVALID_BODY_ENCODING` + problem shape + 零 Registry 触达；④ 与
  `MALFORMED_JSON` code 可分。§12 给出可执行验收：具体字节序列（孤立非法字节
  `[0x22,0xFF,0x22]` 与截断三字节序列 `[0x7B,0x22,0x73,0x22,0x3A,0x20,0xE2,0x82]`）、
  复用冻结 harness 设施（已核全部存在且语义如设计所引）。变异检测逻辑独立推演成立：
  丢 `{fatal:true}` 时场景③分别落入 `INVALID_REQUEST_SHAPE`（U+FFFD 替换后 `"\uFFFD"`
  是合法 JSON string → 顶层形状失败）与 `MALFORMED_JSON`，均 ≠ 断言的
  `INVALID_BODY_ENCODING` → 用例转红；把该类并入 `MALFORMED_JSON` 由场景④（复用冻结
  `buildFailureScenario('malformed-json')` 输入，断言两 code 互异）捕获。冻结 14 类单射
  断言（`codes.size === FAILURE_SCENARIOS.length`，problem 契约 L88）只锁 scenario 矩阵
  内 14 类，encoding 类不在矩阵中，第 15 个 code 不冲突。iteration 0 F2 的验收条件
  （「测试设计落点为新增文件、冻结文件零改动」）满足。
- **Minor 修订安全**：M-1（引文行号已按 ADR 原文校正）、M-2（超限 cancel best-effort、
  不参与结算、413 恒定产生——纯确定性收紧）、M-3（Content-Type OWS 规则定死；已核冻结
  415/接受用例清单中无任何 `=` 两侧空白形态，两向均不冲突）、M-5（D8 表补
  `NAMESPACE_INVALID_IDENTITY` fail-loud 行）均安全；M-4 维持现设计并记录理由（与 SA2
  自评「非必需」一致）。
- **无回归**：简报五节 + AC1–AC5 映射不变且 AC1 的 UTF-8 验收缺口已闭合；SA6 五文件与
  #267 五文件仍零改动（DENY + git 基线双证）；H5–H9 仍采纳原样；O-1..O-5 路由不变；
  无范围扩张（iteration 1 仅增 F1/F2 修订所必需的两行 ALLOW）。

## 3. 需求覆盖

| Requirement | Design section | Assessment |
|---|---|---|
| HTTP/媒体层：owner Registry 既有安全文法 + path 禁 percent-encoding（400） | §7 D7（镜像 `isMinimalSafeString` + `%` 双检）；§8.2 step 3a | 覆盖。文法镜像与 `identity.ts` L88–99 逐条一致（非空、≠`.`/`..`、C0/C1 控制字符、`/`、`\`，无 trim/白名单加码）；percent 检测在 raw 捕获段执行，与 SA6 E3 平台边界兼容 |
| 首版不接受 query 参数 | §7 D10（`url.search !== ''`，裸 `?` 放行）；§8.2 step 3b | 覆盖（平台语义正确） |
| Content-Type 415 语义（接受 `application/json` 与仅带 `charset=utf-8`） | §7 D10；§8.2 step 3c | 覆盖。判定规则与冻结用例（拒：`''`/`text/plain`/`text/json`/`application/json-patch+json`/`charset=utf-16`/第二参数；受：5 形态含大小写/无空格变体）逐一对齐——已逐项核对冻结测试源码；新增 OWS 容忍（`charset = utf-8` 接受）不在冻结面内，两向不冲突（见 N-2） |
| Content-Encoding 只接受缺失/`identity` | §7 D10；§8.2 step 3d | 覆盖 |
| CORS/OPTIONS 由外层截获，否则按方法不匹配 | §1 目标 5；D2 | 覆盖（OPTIONS → 405，#267 冻结测试已锚） |
| 有界收集 bytes → 严格 UTF-8 → 平台 JSON 解析 | §7 D12/D9；§8.2 step 4/4e | 覆盖，且**严格 UTF-8 现已有可执行验收**（F2 已解决：§10 新测试文件 + §12 两行验收，字节序列/断言/零触达齐备） |
| 重复 key last-key-wins；malformed 只返回通用 400（无源码位置） | §7 D12；§8.2 step 4e | 覆盖（固定文案；平台 `JSON.parse` 天然 last-key-wins，契约正反两向用例支撑） |
| Content-Length 仅提前拒绝；stream 始终 byte 上限 | §7 D12/D6；§8.2 step 4 | 覆盖（M5 变异已证流式路径是判别点；M-2 修订后超限 cancel 不参与结算） |
| 顶层非数组 object、恰 `schemaText`+`root` 两 own keys、root 显式、schemaText string（空串交 VFSL） | §7 D11.1；§8.2 step 5a | 覆盖（键数恰 2 且两键均在、空串非形状错误、root 值含 null 原样透传归领域） |
| ROOT 合法性归 Registry/VFSL（invalid → 422） | §7 D8；§8.2 step 7 | 覆盖（`NAMESPACE_ROOT_INVALID` → 422 + issues；M-5 修订后 D8 表含全部 code 处置） |
| limits 七默认值（4 MiB/256 KiB/64/100k/100/1024/64 KiB） | §7 D4 | 覆盖（与 ADR L103–111 逐值一致） |
| Host Partial 覆盖；未知键/越界 TypeError；`maxSchemaTextBytes ≤ maxBodyBytes` | §7 D4；§8.1 | 覆盖（合并默认后有效值判定；冻结用例全部形态兼容，含 `{maxBodyBytes:64}` 使默认 schemaText 越界亦拒的 H8 自然结论） |
| 超限 413；排他上限边界（恰上限不拒） | §7 D4；§8.2 step 4/5b/5c | 覆盖（4 MiB±1、262144/262145、margin 用例全部吻合） |
| depth/nodes/不安全整数迭代检查、不栈溢出 | §7 D5/D11.3；§8.2 step 5c | 覆盖（显式栈单遍 pre-order；定义与全部 margin 用例数值自洽：顶 object=1、值节点计 1、键名不计） |
| REST 不为 `-0` 建立额外语义 | §7 D5 | 覆盖（`-0` 与 0 同走通） |
| 错误契约：固定 problem shape、稳定 code、受控 REST issue、不泄露片段、`issuesTruncated` | §7 D1/D2/D3；§8.3 | 覆盖（键集 ⊆ 四键、14 类互异 + `INVALID_BODY_ENCODING` 增量不冲突、issue 键集/定位互斥/byte 上限、双预算 + 截断显式、哨兵零泄露） |
| AC1–AC5 | §12 验收映射（5/5） | 覆盖；iteration 0 的 AC1 范围 UTF-8 验收缺口已闭合 |
| 非目标维持（503/500 族 rejection、observer 零发射、无独立 parser、无 auth/CORS、registry/vfsl 零改动、ADR 状态不翻） | §1 非目标；§10 DENY | 覆盖，无静默扩大；D6 落 signal 属 ADR L113 同条款行为 |

无需求遗漏；无范围蔓延。

## 4. Owner评论覆盖

| Comment ID | Updated at | Design section | Assessment |
|---|---|---|---|
| —（Issue comments REST snapshot 为空 `[]`） | — | 设计 §4 | 多重独立复核一致：dispatch log 六行全部 `comments=none`（含 sa1 iteration=1 与本次 sa2 iteration=1）、SA6 §14、SA8 门禁。无 Owner 追加要求、无评论锚定义务。验收口径 = 简报五节 + AC1–AC5 + ADR 0015 条款，已按 §3 核对 |

## 5. 上游事实与SA8约束

| Fact or constraint | Design response | Assessment |
|---|---|---|
| SA8 门禁 `clear`：15 项要求 + 5 AC 与 ADR 0015 逐条/逐值 no-conflict | §4/§6 落实表 | 已核（对照 ADR 原文 L63–115/L163–190/L220–228 与简报逐条）；iteration 1 未改变任何路由 |
| 固定顺序 step 1→10 不可 reorder；本票是补全 | §8.2（role gate 先于 owner/媒体检查/body 读取；step 3 插入 owner 捕获与 body 读取之间；step 4/5 原位升级） | 与 ADR L148–159 及 #267 冻结顺序测试一致；iteration 1 未触碰顺序 |
| O-2 `Request.signal` 归属未决 | §7 D6：随 #268 落，仅限 body 读取阶段；abort → cancel reader（best-effort）→ rejection + 零触达；接纳后不传播 | 采纳（iteration 0 已核）；M-2 修订补明超限 cancel 同为 best-effort、不参与结算——语义更完备，无回归 |
| O-3 owner 文法复用路径未决 | §7 D7：包内私有镜像（出处锚定 + 锁步注释），不扩 Registry 公共面 | 采纳；`registry-surface.test.ts` 恰 9 value 冻结实证仍在（本次重核）；备选方案与理由完整 |
| O-5 Registry 判别式 issue 面 | §7 D8：SCHEMA/ROOT_INVALID → 422；其余 code 与 branded fatal 维持 rejection（fail loud） | 采纳；M-5 修订后 D8 表显式单列 `NAMESPACE_INVALID_IDENTITY` 兜底行，完备性提升 |
| O-1 ADR 0015 仍「提议」 | §1 非目标（状态翻转随父 PR #158） | 保持 |
| O-4 CONTEXT.md 术语卫生 | §10 ALLOW（3 条加法） | 已核 CONTEXT.md 现无这些术语（本次重核 grep 为空），加法合理 |
| 冻结验收套件不得为迁就实现而改 | §10 DENY（SA6 五文件 + #267 五文件零改动）；signal 与严格 UTF-8 以**新增**测试文件表达 | 已核 11 个测试文件清单与 DENY 行一致；git 基线零跟踪文件 diff；403/405 problem 化兼容性实证不变（`assertForbidden`/`assertMethodNotAllowed` 只查 `code`/`Allow`） |
| ADR 0009 DQ-4 verbatim issues 纪律 | §6/§8.3 | 与 Registry「不深克隆、不 sanitize」契约同向 |
| SA6 H5–H9 假设仲裁 | 附表：全部采纳原样（D1–D5） | 与冻结断言零冲突（iteration 0 已逐条核，iteration 1 未改动 D1–D5） |
| SA6 §12.2/§15：signal 与严格 UTF-8 由实现路径承担（契约不断言） | 设计以新增测试文件补可执行验收（F2 修订） | 已核 SA6 契约原文（L313 等）确实明示不断言——新增文件是唯一不触碰冻结套件的路线，正确 |
| 平台边界：`new URL` 归一化 dot-segment | §5（`%` 检测 + 文法镜像双检） | 与 SA6 E3 修正记录一致 |

## 6. 设计内部一致性

| 检查项 | 结论 |
|---|---|
| 正文 ↔ 词表 ↔ 状态表 | D2 16 行词表（14 契约类 + 403/405）与 §8.2 step 表逐行对得上；`INSTANCE_ROLE_FORBIDDEN`/`METHOD_NOT_ALLOWED` 与在树常量逐字一致；`INVALID_BODY_ENCODING` 的存在性/可分性断言义务在 D2/D6/D12/§10/§12 五处交叉引用一致（本次逐处核对） |
| 测试文件命名一致性 | iteration 1 更名 `rest-create-body-read.test.ts` 后全文（§6/§10/§12/§14）引用一致；旧名仅存于 §14 的历史说明（有意保留，非死引用）；文件不存在、无覆盖冲突；vitest include 覆盖 |
| 排他上限语义 | D4「≤ 接受、> 拒绝」与 4 MiB±1 / 262144 vs 262145 / `atLimit` 400 用例一致；schemaText 按 UTF-8 bytes 与 6×CJK=18>16 用例一致 |
| depth/nodes 定义 ↔ margin 用例 | 逐例手算自洽（嵌套 3/32、100/10、3 元素/40 元素、120k）——iteration 0 已逐例核，iteration 1 未改 D4/D5/D11 |
| 数字策略 ↔ 平台语义 | `1e400`→Infinity；`9007199254740993`→2^53 非 safe；`-0`/0 放行；有限小数放行——吻合 |
| 首遇违例确定性 | D11.3 pre-order 首遇决定 400 vs 413；AC3 用例稳定 400 ✓ |
| issue 预算 ↔ 冻结断言 | `maxIssues:2` 恰 2 条 + truncated；默认 101 条底层（含 VFSL `path:[]` 截断标记）→ ≤100 + truncated；首条无条件保留 + 双重封顶 + `'?'` 兜底——与 §8.3 伪码一致 |
| M-2 修订落点 | D6 第二要点与 §8.2 step 4「cancel 失败不改变结算」表述一致，无前后矛盾 |
| M-3 修订落点 | D10 OWS 规则单点定死；§8.2 step 3c 引 D10；§13 风险表无残留冲突 |
| M-1 修订落点 | §1 非目标引 ADR L115/L220–228（已按 ADR 原文核行号准确）；§13 R5 引 §8.3（准确）；残留一处 nano 引文偏移见 N-1 |
| 接口/模块布局 ↔ 公共面 | D9 两新私有模块不进 package.json exports（已核 exports 仅 `.`/`./rest`）、不从 index re-export；`RestRouterLimits`/`RestRouterOptions` 形状不变 |
| D13 ↔ §2 #11 ↔ §10 | 三处对 README/AGENTS 的失效陈述清单、修订方向、ALLOW 行逐项互恰；修订内容为「陈述与已实现行为对齐」，符合 docs/AGENTS.md 后半句「不得发明实现行为」 |
| 调用方矩阵 / 死引用 | 已 grep 独立复核调用方封闭性；iteration 0 的 M-1 死引用已消除；未发现新死引用或伪修订（D1–D13 均有 §8/§10/§12 落点） |

## 7. 状态机与并发攻击

| ID | Initial state | Trigger | Expected behavior | Design gap | Required revision |
|---|---|---|---|---|---|
| S1 | router 构造完成（冻结 config） | 并发多请求各自 `handle` | router 除冻结 config 外零状态；每请求独占 reader/解析数据；limits 检查纯函数 | 无 | — |
| S2 | step 4 读取中 | 同一请求 `signal` abort | cancel reader（best-effort catch）→ 移除监听 → rejection（固定 message + cause）、无 Response、零触达 | 无（D6 完整定义；新增测试场景①覆盖） | — |
| S3 | step 4 读取中 | stream 累计字节 > `maxBodyBytes` | 先 cancel（best-effort、不参与结算）→ **恒定** 413 `BODY_TOO_LARGE` | 无（M-2 修订后语义显式定死：cancel resolve/reject/throw 均不改变结算） | — |
| S4 | step 4 之前 | `request.signal` 已 aborted | 读前检查 → 直接 rejection | 无 | — |
| S5 | step 6/7 之后 | 客户端 abort（Registry 已接纳） | 不传播取消：create settle + 恰一次 awaited release + 201 | 无（新增测试场景②覆盖） | — |
| S6 | 非标准 Request（`signal === undefined`） | handle 调用 | 跳过监听 | 无 | — |
| S7 | 构造期 | limits null/数组/未知键/越界/跨字段违约 | 同步 `TypeError`，零资源获取 | 无（D4 五步门） | — |
| S8 | step 5c 遍历中 | 同一输入多类违例 | pre-order 首遇决定结算，恒定结果 | 无 | — |
| S9 | 422 映射中 | 底层 issue 形状意外 | 降级为无定位 issue + 占位 message，仍受控 | 无 | — |
| S10 | step 7 | Registry 返回未列 code（`NAMESPACE_INVALID_IDENTITY`） | fail loud rejection（`unmapped registry issue: <code>`） | 无（M-5 修订后 D8 表显式单列该行，兜底语义成文） | — |

无状态机级缺口。

## 8. 错误与恢复攻击

| ID | Failure | Current design behavior | Risk | Required revision |
|---|---|---|---|---|
| E1 | 4xx/422 之外的一切异常 | 维持 rejection（fail loud），不发明映射 | 无（切片边界与 SA8 O-2 一致） | — |
| E2 | malformed JSON 平台报错携带位置 | 固定通用文案 | 无（契约双断言 + 设计 D12） | — |
| E3 | 422 泄露 schema/root 片段 | issues 为自产诊断 verbatim + message byte 截断 | 无（冻结哨兵用例） | — |
| E4 | release 失败 | 吞错仍 201、不二次调用（#267 冻结） | 无 | — |
| E5 | 严格 UTF-8 解码失败 | 400 `INVALID_BODY_ENCODING` | **已闭合**：§10/§12 新增可执行验收（两字节序列 + 可分断言 + 零触达）；fatal 丢失或类合并均使新用例转红（变异路径独立推演成立） | — |
| E6 | 读取超限后 cancel 失败 | best-effort、不参与结算、413 恒定产生 | 无（M-2 修订后显式定死） | — |
| E7 | 部分成功伪成功 | 所有 4xx/422 在 Persistence 写入前结算 | 无 | — |
| E8 | observer throw / 事件发射 | 零发射、签名不变 | 无 | — |
| E9 | 构造后改写调用方 options | 有效 limits 为合并默认后的冻结对象 | 无 | — |

## 9. 契约影响审查

| API or contract | Missing or weak caller handling | Evidence | Required revision |
|---|---|---|---|
| `createRestRouter(options)` 公共签名 | 无：签名/类型面零变化；新增可观察差异 = 非法 limits 构造抛 `TypeError`；调用方仅测试 harness（grep 全仓实证） | §8.1/§11；rest.ts L119–153 | — |
| `handle` 返回域（rejection → 4xx/422 Response） | 无：纯加法；#267 冻结 35 用例成功路径输入全部合法且在默认 limits 内 | §11；冻结测试源码；SA6 §9 E1 | — |
| 403/405 body `{code}` → problem shape | 无：冻结断言只查 `code` 键值与 `Allow` 头 | rest-role-gate-routing-contract.test.ts L60–72 | — |
| `orchestrateCreateNamespace`（包内私有） | 无：唯一调用方 rest.ts 同步扩展签名（+有效 limits） | grep 实证；package.json exports | — |
| `NamespaceRegistry.create` 输入 | 无：调用点/输入形状不变；INVALID_INPUT 触发面前移 | create-namespace.ts L56–60 | — |
| `deriveSchemaIdentity` | 无：调用点不变；失败面 `VfslIssue[]` 与 D3 映射吻合 | vfsl src/index.ts L239–259 | — |
| 外层 server/gateway（未来 FR-5） | 设计已声明处置边界（Response 回写 / rejection 处置） | §11 末行；ADR 0015 L32/L36 | — |
| 新增第 15 个 problem code `INVALID_BODY_ENCODING` | 无客户端可见冲突：冻结单射断言只锁 14 类 scenario 矩阵（`codes.size === FAILURE_SCENARIOS.length` 已核 harness L88），encoding 类不在矩阵 | problem 契约 L77–89；设计 D2 | — |

## 10. 架构一致性与惯例审查

### 责任归属

| Behavior | Expected owner | Design location | Assessment |
|---|---|---|---|
| HTTP/媒体/形状/limits 入站校验 | host-agnostic REST Module（ADR 0015 指派） | rest.ts/create-namespace.ts/两新私有模块 | 正确；router 零状态 |
| owner 文法语义项 | Registry（identity.ts 单一定义点） | Registry 保持权威；REST 仅前置镜像 | 归属未转移；漂移最坏 fail loud（S10）+ 契约绊线 |
| 422 issue 投影/预算/截断 | REST 表现层 | rest-problem.ts 单一定义点 | 正确（DQ-4 verbatim） |
| 信号/流生命周期 | 请求作用域 | step 4 内聚，读毕/abort 双向清理 | 对称 |
| 规范性文档同步 | 行为变更所属包 + 根术语表 | D13（README/AGENTS/CONTEXT）+ rest.ts 头注 | 正确（F1 修订后覆盖完备） |

### 相似能力对照

| Similar capability | Existing implementation | Proposed design | Consistent or divergent | Reason |
|---|---|---|---|---|
| 包内私有编排/辅助模块 | `src/create-namespace.ts`（私有、相对导入、不进 exports） | `request-body.ts`/`rest-problem.ts` 同款 | Consistent | #267 既有惯例 |
| owner 文法 | `identity.ts isMinimalSafeString`（非公共导出） | 包内镜像 + 锁步注释 | Divergent（有据） | 无可用扩展点（公共面恰 9 value 冻结、判定须先于 Registry 触达）；备选与迁移预案（FU-1）完整 |
| 冻结 code 常量 | rest.ts L80–83 单点 | 收敛迁移进 `rest-problem.ts` 单点 | Consistent | 词表单一定义点 |
| 测试 fixture/harness | 两 harness（poison/observing/trapped/streamed） | 新测试文件复用既有设施 | Consistent | 无平行 fixture（已核被引设施全部存在） |

### 单一事实源

| Fact | Authoritative source | Derived state | Drift risk |
|---|---|---|---|
| 有效 limits | 构造期合并默认后的冻结 config | 无 | 无 |
| owner 安全文法 | Registry `identity.ts` | REST 镜像 | 低-中（已识别并缓解：锁步注释 + 合法 owner 词表契约绊线 + FU-1） |
| problem code 词表 | `rest-problem.ts` 常量 | 无 | 无 |
| Registry create 结果语义 | Registry 判别式 code | REST D8 映射表 | 无（fail loud 兜底） |
| 规范性文档陈述 | 已实现行为 | README/AGENTS/CONTEXT 同步修订 | 低（D13 逐文档定死修订方向，SA4/SA7 可按行验收） |

### 生命周期对称性

signal listener once/读毕或 abort 双向移除；reader getReader/done/cancel（best-effort）；构造无资源获取、无 dispose（现状）；零后台任务。全部对称（M-2 修订后 cancel 语义完备）。

### 平行机制检查

第二 JSON parser（未新增，合规）；第二 owner 文法门（有据裁决）；第二套错误 Response 构造（收敛单点，非并存）；第二套 limits 状态（无）；新测试 harness（复用）。无阻断项。

## 11. 文件范围审查

| Path or scope issue | Evidence | Required revision |
|---|---|---|
| ~~F1：README 缺席 ALLOW~~ | **已解决**：§10 ALLOW 含 `packages/namespace-api/README.md` 行（Public API + Deferred scope 两处修订方向明确）；D13 表逐文档列失效陈述（引文与 README L9–10/L19–21、AGENTS L15–16 原文逐字一致——本次独立核验）；DENY 无冲突 | 无 |
| ALLOW 全部 9 行 | rest.ts/create-namespace.ts/两新私有模块/新测试文件/README/AGENTS.md/CONTEXT.md/设计产物——逐行核过：均为行为落点或文档义务（README/AGENTS/CONTEXT 为 F1/O-4 修订所必需），理由具体，无扩张 | 无 |
| DENY 全部 9 行 | SA6 五文件 + #267 五文件 + index.ts/package.json + registry/vfsl 全树 + ADR 0015 + 其余 docs/apps/domains/packages——与正文「公共面零变化」「只消费公共面」一致；git 基线零跟踪文件 diff 双证 | 无 |
| 新测试文件发现性/命名 | vitest include 覆盖；文件不存在（无覆盖冲突）；更名后全文引用一致 | 无 |
| follow-up（FU-1..FU-4） | 均为真实后续项，不掩盖本票必要项 | 无 |

## 12. 验收设计审查

| Requirement or risk | Proposed evidence | Gap | Required revision |
|---|---|---|---|
| AC1–AC5（14 类映射/limits 门/迭代检查/problem 安全/平台语义） | SA6 三契约文件 44 红用例（冻结）+ 支持锚 | 无 | — |
| D6 signal：abort → rejection + 零触达 | 新文件场景①（流式 body + AbortController + poison registry） | 无 | — |
| D6 signal：接纳后取消不传播 | 新文件场景②（observing registry + releaseGate——设施已在 harness，已核） | 无 | — |
| ~~F2：严格 UTF-8 / `INVALID_BODY_ENCODING` 无可执行验收~~ | **已解决**：新文件场景③④——`streamedJsonRequest` 携带 `[0x22,0xFF,0x22]` 与截断三字节序列 `[0x7B,...,0xE2,0x82]` → 断言 400 + `observeProblem` problem shape + code `INVALID_BODY_ENCODING` + poison registry 零触达；与 `MALFORMED_JSON`（复用冻结 `buildFailureScenario('malformed-json')` 输入）code 互异。两序列均确为非法 UTF-8（独立判读）；fatal 丢失/类合并两变异均致转红（独立推演）；被引 harness 设施全部存在且语义如引 | 无 | — |
| D7 镜像不漂移 | 冻结合法 owner 负控（经真实 Registry 201） | 无 | — |
| 既有零回归 / 公共面零改动 | 全包 vitest `--typecheck` + 根 typecheck + DENY diff 检查 | 无 | — |

## 13. Required revisions

无。iteration 0 的两项 MAJOR（SA2-268-F1、SA2-268-F2）已按其验收条件完全落实（核验见
§2/§11/§12）；无新增 BLOCKER/MAJOR。稳定 Finding ID 修订映射：

| Finding ID | iteration 0 严重度 | 修订核验结果 |
|---|---|---|
| SA2-268-F1 | MAJOR | **已解决**（D13 + §2 #11 + §10 ALLOW README 行 + AGENTS 行点名尾句；验收条件「ALLOW 含该行且 DENY 不冲突」满足） |
| SA2-268-F2 | MAJOR | **已解决**（§10/§12 新测试文件 4 场景，字节级断言 + 可分性 + 零触达；验收条件「落点为新增文件、冻结零改动」满足） |
| M-1..M-3, M-5 | MINOR | 已落实（引文校正 / cancel 语义定死 / OWS 规则定死并与冻结面核不冲突 / D8 补行） |
| M-4 | MINOR | 维持现设计，理由已记录（与 SA2 自评一致） |

## 14. Non-blocking observations

1. **N-1（残留引文 nano 偏移）**：D2 称「ADR L98 要求实现」严格 UTF-8——ADR 0015 的
   「以严格 UTF-8 解码」实际在 **L97**（L96–99 四步清单的第 2 步；L98 是「平台标准 JSON
   解析」）。同一清单块内、不影响任何判定；SA1 顺手校正即可。另注：包 AGENTS.md L12 的
   固定顺序清单在 step 3 插入后仍为真（所列相对次序保持，新检查为 owner capture 与 body
   read 之间的插值）——按 docs/AGENTS.md「stated contract changed」标准**不构成**必改项，
   D13 不修订该行是正确判断，此处仅记录判断依据。
2. **N-2（M-3 的 RFC 引据措辞）**：D10 把「参数名/`=`/值两侧容忍可选 SP/HTAB」归据为
   「RFC 9110 参数语法的 OWS 容忍」——严格说 RFC 9110 的 parameter 产生式（`token "="
   (token/quoted-string)`）并不允许 `=` 两侧的空白（OWS 只在参数间分隔处），该规则实为
   常见的宽松解析惯例。操作性规则本身（确定性、接受 `charset = utf-8`、值仍必须恰为
   `utf-8`、与冻结用例两向无冲突、无安全面 widening——charset 参数只门控 UTF-8 解码）
   安全且足够；建议 SA1 把措辞从「RFC 9110 OWS」改为「设计定死的宽松容忍规则」以免未来
   读者按 RFC 严格文法反推。可选加固：在新测试文件加一条 `application/json;
   charset = utf-8` 接受用例把该新规则钉死（非必需——该形态无冻结断言、单实现内无漂移面）。

## 设计后 ADR 冲突复查评估

**不需要**（`requiresConflictRecheck: false`）。iteration 1 的全部修订为：文件范围完备性
（README 进 ALLOW + D13 文档同步义务）、验收覆盖补齐（新增测试文件）、引文/语义注记校正
（M-1/M-2/M-5）、Content-Type 参数微语法的确定性规则（M-3，ADR L70 授权范围内的解析
细则，无冻结断言约束该形态）。均不引入 wire/schema/持久化/状态机语义变化，不触碰任何
ADR 冻结面，不修订任何已接受决策；D6/D7/D8 裁决与 iteration 0 相同且均在 SA8 `clear`
门禁移交的裁决点范围内。设计 §13 的自查结论与本独立评估一致。

—— SA2 design-review · iteration 1 · 2026-09-11
