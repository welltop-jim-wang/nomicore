# SA10 Spec 审查报告 — issue #268：REST create 请求形状校验、资源 limits 与 4xx/422 错误契约

> Phase：spec-review（iteration 0）。Dispatch：`sa-ac751413-4366-4dff-8f7e-b64a64a695ef`（mabf-sa10）。
> **被审对象**：最终已提交 diff = commit `a80eb7f0994aa0de5a0e93c37d7428ae9f118fa1`
> （`feat(namespace-api): validate REST namespace creation`，21 文件，+4580/−57），branch
> `mabf/issue-268`，工作树 clean。
> **基座同一性（本轮亲证）**：`git log` 亲证 a80eb7f 的父恰为权威基线
> `0b06050d9518c66ef166751064c95ed9557c9532`（docs/rest-namespace-create@0b06050，#296）；
> `git merge-base` = 0b06050。
> **Issue 评论输入**：REST 快照空 `[]`（派遣简报明示；dispatch log 全行 `comments=none`；
> SA6 §14 / SA8 门禁双重 `gh` 复核记录）——**无 Owner 追加要求、无评论 ID 锚定义务**。
> 验收口径 = 简报 What to build 五节 + AC1–AC5 + 批准设计（iteration 1）+ SA6 冻结契约。
> **审查方式（SA10 纪律）**：静态规范一致性判断——简报/契约/设计/实现全文亲读并逐条映射；
> `git diff 0b06050..HEAD` 对 DENY 面与公共面程序化核证；冻结契约 5 文件 sha256 独立复核；
> 父基线 `create-namespace.ts` 成功路径对拍。**未运行测试、未启动服务、未改动任何
> 代码/设计/测试**；SA3 的运行证据（96/96 绿 + 根 typecheck exit 0）与 SA6 红/绿/变异基线
> 作为输入采信，并与本轮静态逐用例推导互证。通用架构风格与仓库规范归 SA9（其 verdict
> `approve`，本轮仅采信不重复审查）。
> **结论：approve**——简报五节与 AC1–AC5 全部满足；无遗漏/部分实现/错误实现/scope creep；
> 6 条披露项登记（均为设计内延期或 nano 级，均不阻断）。

## 1. 审查输入（全部亲读）

| 输入 | 状态 |
|---|---|
| `wiki/raw/task_issue-268.md`（简报：What to build 五节 + AC1–AC5；Blocked by #267 已 CLOSED） | 已读 |
| `wiki/raw/task_268_dispatch.md`（dispatch log，全行 `comments=none`） | 已读 |
| `wiki/raw/task_issue-268_conflict_report.md`（SA8 `clear`，15 要求 + 5 AC 全 no-conflict，O-1..O-5） | 已读 |
| `wiki/raw/task_issue-268_sa6_contract.md`（SA6 `approve`；冻结 5 文件 + §13.4 哈希 + H5–H9 + §15 边界） | 已读 |
| `wiki/raw/task_issue-268_design.md`（SA1 iteration 1，D1–D13，SA2 `approve`） | 已读（全文 602 行） |
| `wiki/raw/task_issue-268_sa2_review.md`（F1/F2 已解决 + M-1..M-5 + N-1/N-2） | 已读 |
| `wiki/raw/task_issue-268_sa3_impl.md` / `task_issue-268_sa4_review.md`（SA4 `approve`，O-1..O-6） | 已读 |
| 实现终态：`src/{rest,create-namespace,request-body,rest-problem}.ts`（全文） | 已读 |
| 测试：`test/rest-create-body-read.test.ts`（新增 179 行全文）+ 冻结 5 文件（harness 全文 + 三契约文件全文 + support 头段） | 已读 |
| 文档 diff：`README.md`/`AGENTS.md`（包）/根 `CONTEXT.md` | 已读（diff 全文） |
| 父基线 `0b06050:src/create-namespace.ts`（成功路径对拍） | 已核 |
| Git 证据：`git log`/`git diff --stat/--name-only`/sha256 | 已核 |

## 2. AC1–AC5 验收判定（逐条）

| AC | 要求 | 实现落点（本轮亲读） | 判定 |
|---|---|---|---|
| **AC1** | 非法 owner → 400 | `rest.ts` step 3a（L286）：raw 段含 `%` **或**文法镜像 `isSafeOwnerUserId`（L161–170，逐条镜像 Registry `isMinimalSafeString`：非空、≠`.`/`..`、C0/C1 控制符、`/`、`\`）→ 400 `INVALID_OWNER`；先于 body 读取与 Registry 触达 | **满足** |
| | query → 400 | step 3b（L293）：`url.search !== ''` → 400 `QUERY_PARAMETERS_NOT_SUPPORTED`（裸 `?` 不误伤，SA3 探针实证） | **满足** |
| | 空 body → 400 | `request-body.ts` L62（body null）与 L100（累计 0 bytes）→ 400 `EMPTY_BODY` | **满足** |
| | malformed JSON → 400 | `create-namespace.ts` L94–99：`JSON.parse` 抛错 → 固定文案 `MALFORMED_JSON`，**绝不透传**平台 SyntaxError 的 position/line/column | **满足** |
| | 请求形状 → 400 | `request-body.ts` `assertTopLevelShape`（L122–140）：非数组 object + 键数恰 2 + `hasOwnProperty` 两键 + `schemaText` string → 否则 400 `INVALID_REQUEST_SHAPE` | **满足** |
| | 数字范围 → 400 | `request-body.ts` L166–170：非有限数、整数且非安全整数 → 400 `NUMBER_OUT_OF_RANGE`（`1e400`→Infinity 落前者；`9007199254740993`→落后者） | **满足** |
| | 媒体类型 → 415 | step 3c/3d（L300/L306）：CT 缺失/不兼容 → 415 `UNSUPPORTED_MEDIA_TYPE`；CE 非缺失/`identity` → 415 `UNSUPPORTED_CONTENT_ENCODING` | **满足** |
| | 规模超限 → 413 | `BODY_TOO_LARGE`（CL 提前拒绝 L54–59 + stream 恒上限 L89–93）/`SCHEMA_TEXT_TOO_LARGE`（L103–106）/`JSON_DEPTH_EXCEEDED`/`JSON_NODES_EXCEEDED`（L162–176） | **满足** |
| | schema/ROOT invalid → 422 | derive 失败 → 422 `SCHEMA_INVALID` + issues（L114–117）；Registry `NAMESPACE_SCHEMA_INVALID`/`NAMESPACE_ROOT_INVALID` → 422（L133–138，D8 分叉）；其余 code 维持 rejection（后续票，设计内） | **满足** |
| **AC2** | 七项默认 limits 生效 | `DEFAULT_LIMITS`（rest.ts L88–96）= 4 MiB/256 KiB/64/100,000/100/1,024/64 KiB，与简报/ADR L103–111 **逐值一致**；七项全部在执行路径消费（body CL+stream、schemaText UTF-8 bytes、depth、nodes、issues 数量、单条 message bytes、总预算） | **满足** |
| | Host Partial 覆盖 | `resolveLimits`（L120–152）：Partial 与默认合并为有效值并冻结；冻结契约含七键各自覆盖夹紧用例（SA3 96/96 绿采信 + 本轮静态推导互证） | **满足** |
| | 未知键/越界值构造时 TypeError | 未知键（含 typo/大小写变体）→ 普通 `TypeError`（L126–130）；值须正安全整数（`Number.isSafeInteger(v) && v >= 1`，拒 0/负数/1.5/NaN/∞/2^53）→ `TypeError`（L140–147） | **满足** |
| | `maxSchemaTextBytes > maxBodyBytes` 拒绝 | L148–150：按**合并默认后的有效值**判定（H8 采纳读法），违反 → `TypeError`；相等允许 | **满足** |
| **AC3** | depth/nodes 迭代实现、深嵌套不栈溢出 | `assertPostParseResourceLimits`（L149–191）：**显式栈**迭代 DFS（pre-order 确定序、首遇违例定结算），零递归；冻结 AC3 用例为 50,000 层 + 高上限下数字检查仍终结（SA6 M9 变异证明递归实现会被该用例捕获） | **满足** |
| **AC4** | 固定 problem shape | `rest-problem.ts` `problemResponse`（L135–147）：键集 ⊆ `{code, message, issues, issuesTruncated}`、恒 `application/json`；`code` 稳定 UPPER_SNAKE（17 词表，14 类两两互异 + 403/405 冻结值逐字保持 + 设计裁决的第 15 类 `INVALID_BODY_ENCODING`）；`issues` 仅 422 携带；`issuesTruncated` 仅在确实截断时出现（不输出 `false`） | **满足** |
| | issues 受控安全、不泄露 schema/root 片段 | `mapRestIssues`（L237–276）：来源族固定 code（`SCHEMA_ISSUE`/`ROOT_ISSUE`，不从 message 派生）；定位 verbatim（line/column 正整数对或 `(string\|number)[]` path，互斥）；message 非空 + UTF-8 codepoint 边界 byte 截断 + `?` 兜底；problem message 为固定人读文案不回显输入；冻结哨兵用例锚定零泄露 | **满足** |
| | 截断显式 `issuesTruncated: true` | 数量预算（`< maxIssues`）与总 byte 预算（首条无条件保留 + `min(单条,总)` 封顶）任一停止 → `issuesTruncated: true` 且必伴随 `issues` | **满足** |
| **AC5** | 重复 key 无额外语义 | 平台 `JSON.parse` 天然 last-key-wins，实现零 key 语义（冻结正反两向用例锚定） | **满足** |
| | `-0` 无额外语义 | 数字检查无 `-0` 分支（`Number.isInteger(-0) && Number.isSafeInteger(-0)` 均 true → 与 0 同走通） | **满足** |
| | malformed JSON 不返回源码位置 | 固定文案 `'JSON 解析失败'`；冻结契约 string 叶子扫描双断言锚定 | **满足** |

**AC 判定：5/5 全部满足；无 partial、无 unmet、无 unachievable。**

## 3. 简报 What to build 五节核对

| 简报条款 | 实现核对 | 判定 |
|---|---|---|
| HTTP/媒体层：owner Registry 既有文法 + path 禁 percent-encoding（400） | step 3a 双检（`%` → 文法镜像）；镜像与 Registry `identity.ts` 逐条一致（SA4 §2 亲核，本轮复核代码逐条相符）；合法 owner（`alice`/`a.b`/`alice-1`/`owner_2`）经真实 Registry 201 负控在树 | ✓ |
| 首版不接受 query | step 3b ✓ | ✓ |
| CT 415；接受 `application/json` 与仅带 `charset=utf-8` | `isSupportedContentType`（L178–193）：首段 trim+小写恰 `application/json`；至多 1 参数且必须 `charset=utf-8`（名/值小写、可选双引号、OWS 容忍——设计 D10/M-3 定死的确定性规则）；冻结拒 6 形态/受 5 形态逐一对齐 | ✓ |
| CE 只接受缺失/`identity` | `isSupportedContentEncoding`（L196–199）：null 通过；trim+小写恰 `identity`；gzip/br/deflate/compress → 415 | ✓ |
| CORS/OPTIONS 由外层截获，否则按方法不匹配 | method gate 先行：OPTIONS/GET/PUT/DELETE → 405 + `Allow: POST`（冻结 problem 契约锚定） | ✓ |
| JSON 处理：不实现独立 parser；有界 bytes → 严格 UTF-8 → 平台 JSON | 无独立/SAX parser；`readBoundedBodyText`（CL 提前拒绝 + stream 恒上限）→ `TextDecoder('utf-8',{fatal:true})` → `JSON.parse` | ✓ |
| last-key-wins；malformed 通用 400 无源码位置 | 见 AC5/AC1 行 | ✓ |
| CL 仅提前拒绝优化；stream 始终 byte 上限 | L54–59（CL 优化，非有限声明直接跳过）+ L88–93（stream 逐 chunk 累计恒判，超限 best-effort cancel 后恒定 413）；冻结「无 CL 流式 413」用例锚定 | ✓ |
| 顶层非数组 object 恰两键；root 显式；schemaText string（空串交 VFSL） | `assertTopLevelShape`：`hasOwnProperty` 两键（root 显式含 null）；空串非形状错误（冻结用例：空串 → 422 非 400） | ✓ |
| ROOT 领域合法性归 Registry/VFSL（invalid → 422） | REST 不预设 root 形状（null 原样透传）；derive/Registry 窄 issue → 422（D8） | ✓ |
| 资源 limits 七默认/Partial/TypeError/跨字段/413/迭代/`-0` | 见 AC2/AC3/AC5 行 | ✓ |
| 错误契约：固定 problem shape/稳定 code/受控 issue/不泄露片段/`issuesTruncated` | 见 AC4 行 | ✓ |

**五节 15 项全部落实，无遗漏。**

## 4. Owner 评论映射

| Owner 输入 | 内容 | 落实 |
|---|---|---|
| Issue comments REST snapshot | **空 `[]`**（派遣简报明示；dispatch log 全行 `comments=none`；SA6 §14/SA8 双重 `gh` 复核记录在案） | 无 Owner 追加要求、无评论 ID 可映射；验收口径 = 简报五节 + AC1–AC5 + ADR 0015 对应条款（SA8 已逐条对照 0 冲突） |

## 5. 批准设计（SA1 iteration 1，SA2 `approve`）落实核对

| 决策 | 实现核对 | 判定 |
|---|---|---|
| D1 problem shape（键集/`issuesTruncated` 仅截断时出现/405 `Allow: POST`） | `problemResponse` 逐点相符；`issuesTruncated:true` 必伴随 issues（冻结 validator 锚定） | ✓ |
| D2 code 词表（14 类互异 + `INVALID_BODY_ENCODING` 增量 + 403/405 逐字） | `REST_PROBLEM_CODES` 17 键逐字相符；冻结单射断言只锁 14 类，第 15 类由新增测试断言存在性与可分性（SA2 已核不冲突） | ✓ |
| D3 REST issue（来源族 code/verbatim 定位互斥/byte 上限/防御降级） | `readIssueLocation` + `mapRestIssues` 相符；占位 message 不泄露输入 | ✓ |
| D4 limits 构造门（形状→未知键→值域→合并→跨字段→冻结；排他上限；UTF-8 bytes 计） | `resolveLimits` 逐步相符；`TextEncoder` 计 bytes | ✓ |
| D5 数字策略（非有限/非安全整数 400；`-0`/有限小数放行） | L166–170 逐字相符 | ✓ |
| D6 `Request.signal` 随本票落、限 body 读取阶段 | 读前检查 + 读期间 `{once:true}` 监听 + abort→best-effort cancel→固定 message+cause 的 rejection（零 Response、零 Registry 触达）+ finally 移除监听；接纳后不传播；超限 cancel `.catch(()=>{})` 不参与结算（M-2 逐字）；新增测试 4 场景覆盖 | ✓ |
| D7 owner 文法包内私有镜像（出处锚定 + 锁步义务，不扩 Registry 公共面） | `isSafeOwnerUserId` 注释锚定 + 逐条一致；`packages/namespace-registry/**` 零 diff（本轮 git 核证） | ✓ |
| D8 Registry issue→422 分叉（SCHEMA/ROOT→422；其余含 `NAMESPACE_INVALID_IDENTITY` 兜底维持 rejection） | `create-namespace.ts` L129–140 逐条相符（M-5 兜底在案） | ✓ |
| D9 模块布局（两新私有模块；公共面零变化） | `request-body.ts`/`rest-problem.ts` 包内私有（不进 exports/index）；`src/index.ts`、`package.json` 零 diff（本轮 git 核证） | ✓ |
| D10 step 3 内部次序（owner→query→CT→CE；零 body 读取/零 Registry 触达） | `handle` L285–311 次序相符；trapped/poison 冻结用例锚定 | ✓ |
| D11 step 5 次序与单遍迭代 DFS（首遇定结算） | shape → schemaText bytes → DFS；depth=容器层级、nodes=值节点、键名不计；与全部 margin 用例数值自洽 | ✓ |
| D12 空 body/malformed/编码判别 | null/0 bytes→`EMPTY_BODY`；fatal 解码失败→`INVALID_BODY_ENCODING`；parse 抛→`MALFORMED_JSON`（固定文案） | ✓（见 §7 披露项 P-5 的 nano 次序注记） |
| D13 规范性文档同步（README/AGENTS/CONTEXT/rest.ts 头注） | diff 亲读：README Public API/Deferred scope 按方向修订（失效陈述「一律 rejection」「暂未设上限」已移除、仍 deferred 项保留）；AGENTS.md 尾句显式校正为 auth 边界 + bounded 读；CONTEXT.md 加法 3 术语（含 _Avoid_ 行）；rest.ts 头注收窄为剩余未映射族 | ✓ |
| SA6 H5–H9 仲裁采纳原样（无需回写契约） | D1–D5 与实现逐条吻合；**冻结 5 文件 sha256 与 SA6 §13.4 逐字节一致**（本轮独立复核：`3e3d3057…`/`52fc9ad9…`/`a82b0733…`/`fb23dcd9…`/`fa031c3f…`） | ✓ |

## 6. 必需 REST 行为核对（含 #267 冻结面回归面）

| 行为 | 核对 | 判定 |
|---|---|---|
| 固定顺序不 reorder：route → 405 → 403 → step 3a–3d → step 4–10 | `handle` 终态逐行相符；role gate 仍先于 owner 解码/body 读取/Registry 触达（Peer 对 percent-owner 仍 403） | ✓ |
| 405 `Allow: POST` 与 403 `INSTANCE_ROLE_FORBIDDEN` 冻结值逐字保持 | `methodNotAllowedResponse`/`roleForbiddenResponse` 相符；403/405 升级为 problem shape 属纯加法（#267 冻结断言只查 `code`/`Allow`） | ✓ |
| 成功路径 step 6–10 不变 | 与父基线 `0b06050:create-namespace.ts` 对拍：envelope 四键、恰三键 Registry 输入、DTO 复制、恰一次 awaited `lease.release()`（失败吞错仍 201）、201 无 Location、body 恰 `namespaceId`+`schema{lang,version,id}`——逐行一致；改动纯为 rejection→Response 加法 | ✓ |
| #267 冻结套件（4 测试文件 + harness）零改动 | `git diff 0b06050..HEAD --name-only` 对五路径零命中（本轮核证） | ✓ |
| DENY LIST 零触碰（registry/vfsl/docs/adr/apps/domains/`src/index.ts`/`package.json`） | 同上零命中；ADR 0015 状态未翻（属父 PR #158 收官） | ✓ |
| 未映射结局 fail loud：503/500 族、abort、Registry fatal 维持 rejection | `create-namespace.ts` L112/L139；rest.ts 头注与 README/AGENTS 均显式声明为后续票 | ✓（设计内延期，见 §7 P-1） |
| observer 零发射（FR-4 延后） | 构造面签名不变、零事件发射 | ✓ |

## 7. PR 必须披露的未达成/延期项（均不阻断本票 AC）

| # | 披露项 | 性质 | 依据 |
|---|---|---|---|
| P-1 | 503 `REGISTRY_NOT_ACCEPTING`、500 三族（`NAMESPACE_CREATE_FAILED`/`NAMESPACE_CREATE_OUTCOME_UNKNOWN`/`INTERNAL_ERROR`）与 `NAMESPACE_CREATE_INVALID_INPUT`/`NAMESPACE_ALREADY_EXISTS` 安全 500 **未实现，维持 rejection** | 设计内延期（SA8 O-2 切片边界；简报五节与 AC1–AC5 均不含） | 设计 §1 非目标；README/AGENTS/rest.ts 头注已声明 |
| P-2 | observer 事件契约（FR-4）未实现，两个 observer 零发射 | 设计内延期 | 同上 |
| P-3 | ADR 0015 状态仍「提议」，未随本票翻「已接受」 | 流程性延期（随父 PR #158 阶段收官） | SA8 O-1；设计 §1 非目标 |
| P-4 | `Request.signal` 仅 body 读取阶段生效；Registry 接纳后客户端取消不传播；abort 以 rejection 结算、**无 HTTP Response**（其 server 侧处置属 FR-5） | 设计裁决语义（D6；ADR L113 范围） | 设计 §7 D6；新增测试固化 |
| P-5 | nano 次序偏差：Content-Length 提前拒绝先于 body-null 检查（设计 §8.2 step 4 括号内次序为 body null 在前）——仅「null body + 手工声明超限 CL」组合可得 413 而非 400 `EMPTY_BODY`；标准 Request 构造下不可达、无冻结用例覆盖、两结局均为零触达 4xx | nano 级（SA4 O-1；非 AC 面） | SA4 §12 O-1 |
| P-6 | `resolveLimits` 取值经 `record[key]`（原型 getter/被污染 `Object.prototype` 上的已知键值可被采用，仍须过正安全整数门与跨字段不变量）；带引号 charset 值内部空白亦接受（`charset=" utf-8 "`） | nano 级边缘（SA4 O-2/O-3；奇异输入方可达、无安全影响） | SA4 §12 O-2/O-3 |

**无 AC 面未达成项；无「实现但部分达成」项；上述全部为已批准设计的显式延期或已登记 nano 观察。**

## 8. Scope creep 核对

| 候选 | 判定 |
|---|---|
| 第 15 个 problem code `INVALID_BODY_ENCODING`（冻结 14 类之外） | **非 scope creep**：ADR L98 严格 UTF-8 解码失败的必然类别；设计 D2 显式裁决、SA2 核验与冻结单射断言不冲突；由新增测试断言 |
| 新增测试 `rest-create-body-read.test.ts`（signal 2 场景 + 非法 UTF-8 2 场景） | **非 scope creep**：SA2-268-F2 修订后的批准设计 ALLOW LIST 行；冻结套件零改动（哈希亲证） |
| `Request.signal` 随本票落 | **非 scope creep**：SA8 O-2 裁决点、ADR L113 同条款行为、骨架 AGENTS.md deferred 清单并项；设计 D6 批准 |
| README/AGENTS/CONTEXT 文档改动 | **非 scope creep**：D13 同步义务（docs/AGENTS.md「行为变化须同步全部陈述契约已变的规范性文档」+ SA8 O-4 术语卫生）；本轮 diff 亲读确认无发明未实现行为 |
| wiki/raw 管线产物（简报/设计/SA2/SA3/SA4/SA6/dispatch/本报告） | 管线固定产物位，非业务改动 |
| 生产代码改动面 | 恰为 ALLOW LIST 的 4 个 src 文件（2 改 2 增）；registry/vfsl/docs/adr/apps/domains/公共面零 diff（本轮 git 核证） |

**无 scope creep。**

## 9. 验证证据与采信边界

- **本轮独立核证**：冻结 5 文件 sha256 与 SA6 §13.4 逐字节一致；DENY/公共面零 diff；HEAD 父 = 权威基线 0b06050；成功路径与父基线逐行对拍一致；14 类失败 scenario 与实现逐类静态推导相符（状态/code/形状/零触达/预算边界/哨兵语义）。
- **采信上游运行证据**（SA10 纪律不运行测试）：SA3 报告 `vitest run --typecheck packages/namespace-api/test` **96/96 绿**（44 红转绿 + 48 恒绿 + 新增 4 绿）、根 `pnpm typecheck` exit 0；SA6 红灯基线 3/3 复跑、模拟件 92/92 可满足性、18 例变异全捕获；SA3 补充变异 M-A..M-D（fatal 丢失/类合并/abort 监听/读前检查）均被新增测试捕获。
- **后续动态验证项**（登记给 Controller/SA7，非本票阻断）：全包套件与 CI 分片触发复核；真实传输边界的超限 cancel reject 路径（FR-5 server 票）；P-5 组合语义的定死。

## 10. Verdict

**`approve`**

- 简报 What to build 五节 15 项与 AC1–AC5 **全部满足**——无遗漏、无部分实现、无错误实现；
  关键 AC 无一 partial/unmet/unachievable。
- 批准设计 D1–D13 与 SA6 冻结契约 44 红灯目标忠实落地；冻结面（#268 五文件 + #267 五文件 +
  公共面 + registry/vfsl/docs）零改动（哈希 + git 双证）。
- 必需 REST 行为保持：固定顺序无 reorder、403/405 冻结语义逐字保持、成功路径 step 6–10 逐行不变。
- 无 scope creep；6 条披露项（P-1..P-6）均为设计内延期或 nano 级观察，不阻断 approve，
  但须在 PR 描述中显式披露（尤其 P-1 的 503/500 族维持 rejection 与 P-4 的 signal 范围）。

—— SA10 spec-review · iteration 0 · 2026-09-11
