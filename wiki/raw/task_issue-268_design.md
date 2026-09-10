# SA1 设计产物 — issue #268：REST create 请求形状校验、资源 limits 与 4xx/422 错误契约

> 任务类型：**Feature**（在 #267 REST router 骨架上叠加 ADR 0015 step 3–5 的入站校验、
> 资源 limits 执行与 4xx/422 problem 契约；非 Bug 修复）。
> 输入基线：worktree `mabf/issue-268`，HEAD `0b06050`（#267 骨架，PR #296 已合）。
> 上游产物：任务简报 `wiki/raw/task_issue-268.md`（Issue 评论快照**空 `[]`**——无 Owner
> 追加要求、无评论锚定义务）；SA6 验收契约 `wiki/raw/task_issue-268_sa6_contract.md`
> （verdict `approve`，92 用例红/绿/变异三重证据）；SA8 冲突门禁
> `wiki/raw/task_issue-268_conflict_report.md`（verdict `clear`，0 冲突，观察项 O-1..O-5）。
> `wiki/raw/task_issue-268_relevant_decisions.md` 不存在——SA8 报告已含 ADR 0001–0015
> 全量对照表与 seam 实证表，本文以之替代决策摘录，并在 §6 逐项落实。
> 评审修订输入：`wiki/raw/task_issue-268_sa2_review.md`（verdict `reject`——2 项 MAJOR：
> F1 包 README 契约同步缺席文件范围；F2 严格 UTF-8 解码/`INVALID_BODY_ENCODING`
> 零可执行验收；另 5 项 non-blocking 观察 M-1..M-5）。**本版为评审修订版
> （iteration 1）**：F1/F2 与 M-1/M-2/M-3/M-5 已逐条落实、M-4 记录维持理由，映射见
> §14；无设计后冲突复查需求（§13）。

---

## 1. 任务目标与非目标

### 目标（本票交付）

1. **step 3（HTTP/媒体层）**：owner 段安全文法 + percent-encoding 拒绝（400）；query
   拒绝（400）；Content-Type 只接受 `application/json`（含仅带 `charset=utf-8`，415 其余）；
   Content-Encoding 只接受缺失/`identity`（415 其余）。全部先于 body 读取与 Registry 触达。
2. **step 4（JSON 处理）**：有界收集 body bytes（Content-Length 仅提前拒绝 + stream 始终
   执行 byte 上限）→ 严格 UTF-8 解码 → 平台 `JSON.parse`；重复 key 平台 last-key-wins；
   malformed JSON 通用 400（无源码位置）；body 读取阶段尊重 `Request.signal`。
3. **step 5（形状与资源检查）**：顶层恰 `schemaText`+`root` 两 own keys（400）；schemaText
   UTF-8 bytes 上限（413）；解析后 depth/nodes/不安全整数以**迭代**遍历检查（413/400）。
4. **limits 构造门**：七项默认值；Host Partial 覆盖；未知键与越界值构造时普通 `TypeError`；
   `maxSchemaTextBytes ≤ maxBodyBytes`（按合并默认后的有效值判定）。
5. **错误契约**：固定 problem shape `{code, message, issues?, issuesTruncated?}`；14 类失败
   各自互异稳定 UPPER_SNAKE code；422 issues 映射为受控 REST issue（稳定 code、可选
   line/column 或 path、byte 上限安全 message、不泄露 schema/root 片段）；截断显式
   `issuesTruncated: true`；403/405 升级为同一 problem shape（冻结 code 与 `Allow: POST`
   逐字保持）。

### 非目标（明确不做，维持现状语义）

- 503 `REGISTRY_NOT_ACCEPTING`、500 三族（`NAMESPACE_CREATE_FAILED` /
  `NAMESPACE_CREATE_OUTCOME_UNKNOWN` / `INTERNAL_ERROR`）与
  `NAMESPACE_CREATE_INVALID_INPUT`/`NAMESPACE_ALREADY_EXISTS` 的安全 500 映射——后续票
  （SA8 O-2 切片边界；本票这些结局**维持 rejection**，见 D8）。
- observer 事件发射（FR-4）：两个 observer 仍零发射、签名不变。
- 独立 JSON parser、SAX/token parser、重复 key 拒绝、`-0` 额外语义（`-0` 无额外语义
  条款在 ADR 0015 L115；独立 parser/重复 key 拒绝/源码 excerpt 在非目标清单 L220–228）。
- authentication/authorization/CORS/TLS/listener/graceful drain（FR-5 server 票）。
- `packages/namespace-registry` / `packages/vfsl` 的任何代码改动（只消费其公共面）。
- ADR 0015 状态翻「已接受」——随父集成 PR #158 阶段收官处理（SA8 O-1）。

---

## 2. 当前行为与证据锚点

| # | 当前事实 | 锚点 |
|---|---|---|
| 1 | 构造只浅复制冻结 `limits`，不校验、不执行：`{maxBoddyBytes:10}` 可构造成功 | `packages/namespace-api/src/rest.ts` L26–38（预留声明）、L145–153（浅复制冻结） |
| 2 | `handle` 只做 route 匹配（`CREATE_NAMESPACE_ROUTE` L77）→ method gate 405（L96–101，body 仅 `{code}`）→ role gate 403（L104–109，body 仅 `{code}`）→ 直接进入 create 编排 | `src/rest.ts` L155–176 |
| 3 | step 4 为 `await request.json()` 最小读取：无 byte 上限、无严格 UTF-8、无 signal；malformed → 平台 `SyntaxError` rejection（含 `position/line/column`） | `src/create-namespace.ts` L36；SA6 报告 §8 第二故障点探针 |
| 4 | 顶层形状只做机械提取后 rejection（`unmapped request shape（400 映射延后）`）；derive 失败与 Registry 窄 issue 均 rejection（`unmapped VFSL issues…`/`unmapped registry issue: …`） | `src/create-namespace.ts` L37–45、L46–49、L56–63 |
| 5 | 成功路径 step 6–10 完整在树：derive → 四键 envelope → `registry.create` 恰三键 → DTO 复制 → 恰一次 awaited `lease.release()`（失败吞错仍 201）→ 201 无 Location | `src/create-namespace.ts` L46–81；#267 契约 `test/rest-create-hub-contract.test.ts` 35 用例绿 |
| 6 | Registry 窄 issue 面已具：`CreateNamespaceIssue` 含 `NAMESPACE_SCHEMA_INVALID`/`NAMESPACE_ROOT_INVALID`（均内嵌 verbatim `issues: readonly unknown[]`）、`NAMESPACE_CREATE_INVALID_INPUT`、`NAMESPACE_ALREADY_EXISTS`、`NAMESPACE_CREATE_FAILED`、not-accepting | `packages/namespace-registry/src/types.ts` L275–292；`src/create-document.ts` L64–66/L106–110 |
| 7 | VFSL 两族底层 issue 形状：parse 族 `VfslIssue = {message, line, column}`（无 code）；逻辑校验族 `ValidateIssue = {message, path: Array<string\|number>}`（无 code、无行列）；`validateLogicalSnapshot` 全收集上限 100 条、超限时**追加**一条截断标记 issue（`path: []`） | `packages/vfsl/src/ir.ts` L11–15；`src/validate.ts` L43–47、L54、L604–607；`deriveSchemaIdentity` 公共面 `src/index.ts` L239–259 |
| 8 | Registry owner 安全文法 = `isMinimalSafeString`：非空、≠ `.`/`..`、无 C0/C1 控制字符（U+0000–001F、U+007F–009F）、无 `/`、无 `\`；设计 §4 明示不得擅加 ASCII/长度/首字符白名单。**未从 `@nomicore/namespace-registry` 公共 index 导出**（公共面被冻结为恰 9 个运行时 value） | `packages/namespace-registry/src/identity.ts` L88–99、L137–158；`src/index.ts` L18–30；冻结断言 `test/registry-surface.test.ts` L57–72 |
| 9 | 平台事实：`new URL(...)` 会把 `%2E%2E` 等 dot-segment 归一化出 canonical path；`%61lice`/`a%20b` 等保持 raw；Node 24 `JSON.parse` 可解析 50,000 层嵌套（迭代实现），而递归遍历该结构会栈溢出 | SA6 契约 `test/rest-create-validation-support.test.ts`（平台/fixture 锚，8/8 绿） |
| 10 | 红灯基线：`3 failed \| 5 passed (8 files)`、`44 failed \| 48 passed (92)`，3/3 复跑一致；同一测试字节在临时模拟件下 92/92 绿；18 例定点变异全部被目标断言捕获 | SA6 报告 §5、§9 E1/E2、§13 |
| 11 | 包规范性文档把本票范围陈述为 deferred 假契约：README「Deferred scope」明文「请求形状校验（owner 文法/percent-encoding/query/Content-Type/Encoding/body 上限）、limits 执行与 `Request.signal`、Registry 失败映射与 problem shape…均由后续 ticket 叠加」「未映射结局一律以 `handle` rejection 结算（fail loud），不发明任何 HTTP 错误 Response」「body 读取暂未设上限」；Public API 节对 `handle` 只描述 201/405/403；AGENTS.md L15–16 同款（含「assumes a trusted localhost/trusted-network exposure … because body reads are not yet bounded」尾句） | `packages/namespace-api/README.md` L9–10（Public API）、L19–21（Deferred scope）；`packages/namespace-api/AGENTS.md` L15–16 |

---

## 3. 能力缺口（Feature 根因承接）

ADR 0015 的 step 3（owner/query/Content-Type/Encoding 检查）、step 4 的有界读取与
signal、step 5 的形状与解析后资源检查、§资源限制的七项 limits 执行、§错误契约的
problem shape/稳定 code/受控 issues **均未实现**；#267 骨架的 `AGENTS.md` L15–16、包
`README.md` L19–21（Deferred scope）与 `src/rest.ts` L15–20 注释明文把这些划给后续
ticket——本票即该后续票；落地后这些陈述（含「body 读取暂未设上限」「未映射结局一律
rejection、不发明任何 HTTP 错误 Response」）全部变为假契约，必须按 D13 同步修订。缺口不在下游：
Registry/VFSL/Persistence 已具备 422 映射所需的全部结构前提（§2 #6/#7；SA6 support
绿锚亲证）。非成功入站请求当前 201（owner/query/media/encoding 全放行）或 rejection
（body/形状/limits/领域失败），无任何 4xx/422 Response。

---

## 4. Owner 要求落实

Issue 评论 REST 快照为空（`[]`，dispatch log `comments=none`，SA6 §14 与 SA8 双重复核）
——**无 Owner 评论要求、无评论 ID 需映射**。验收口径 = 简报 What to build 五节 +
AC1–AC5 + ADR 0015 对应条款（SA8 已逐条对照 15 项要求 + 5 AC 全 no-conflict）。

| 输入 | 要求 | 设计落实 |
|---|---|---|
| 简报 §HTTP/媒体层 | owner Registry 既有安全文法 + path 禁 percent-encoding（400）；不接受 query；CT 415 语义；CE 只接受缺失/`identity` | §7 D7、D10；§8.2 step 3 |
| 简报 §JSON 处理 | 有界 bytes → 严格 UTF-8 → 平台 JSON；last-key-wins；malformed 通用错误；Content-Length 仅提前拒绝、stream 始终上限 | §7 D12；§8.2 step 4 |
| 简报 §形状与领域校验 | 顶层非数组 object 恰两键；root 显式；schemaText string（空串交 VFSL）；ROOT 合法性归 Registry/VFSL（422） | §7 D11；§8.2 step 5/6 |
| 简报 §资源 limits | 七默认值、Partial 覆盖、未知键/越界 TypeError、跨字段不变量、413、迭代检查、`-0` 无额外语义 | §7 D4/D5；§8.1/§8.2 |
| 简报 §错误契约 | 固定 problem shape；稳定 code 分支；受控 REST issue；不泄露片段；`issuesTruncated` | §7 D1/D2/D3；§8.3 |
| AC1–AC5 | 状态映射 / limits 门 / 迭代实现 / problem 安全 / 平台语义 | §12 验收映射（5/5 覆盖） |

---

## 5. 复现和根因承接

| 上游事实 | 证据位置 | 设计响应 |
|---|---|---|
| 能力缺口红灯：14 类失败场景在 HEAD 上 44 断言红灯（201 或 rejection） | SA6 报告 §5、§8、§13.1 | 本设计逐类给出状态 + code + 形状（§8.3 词表）；实现后 3 个契约文件 44 红转绿、既有 35 恒绿（SA6 §9 E1 已证可满足） |
| 直接故障点 1：`rest.ts` 构造不校验 limits、`handle` 缺 step 3 | SA6 §8（源码符号 + 探针） | §8.1 构造门 + §8.2 step 3（`rest.ts` 内实现） |
| 直接故障点 2：`create-namespace.ts` 最小读取 + rejection | SA6 §8 | §8.2 step 4/5 升级为有界读取 + 形状/资源检查 + problem Response（rejection→Response 为纯加法，顺序不 reorder） |
| 可满足性：模拟件下 92/92 绿（含 `--typecheck`） | SA6 §9 E1、§13.2 | 本设计与 SA6 模拟件口径一致（problem 键集、状态映射、有界读取、迭代检查、预算/截断） |
| 敏感性：18 例变异全被捕获（含 M9 迭代 vs 递归定点） | SA6 §9 E2、§13.3 | §8.2 明确 stream 上限、迭代 DFS、预算三处为不可省略实现点 |
| 平台边界：dot-segment 归一化使部分非 percent 违规不可达 | SA6 §9 E3、support 锚 | owner 检查 = `%` 检测 + 文法镜像（防御性双检，见 D7），不把归一化行为当断言面 |
| Registry 门禁事实：非有限数若漏检将落入 `NAMESPACE_CREATE_INVALID_INPUT`（安全 500 域，不在本票） | SA6 support 锚 4 | step 5 数字检查先于 Registry（§8.2），毒 registry 场景 `number-range` 要求零触达 |
| 未证实假设 H5–H9 待 SA1 仲裁 | SA6 §12.1、§15 | §7 D1–D5 **全部采纳 SA6 提案原样**，无需回写契约测试、无需修订轮 |

---

## 6. SA8 约束落实

| 决议或义务 | 设计位置 | 处理方式 | 是否需要设计后冲突复查 |
|---|---|---|---|
| 门禁 `clear`：15 项要求 + 5 AC 与 ADR 0015 逐条/逐值 no-conflict | §4、§8 | 全部条款按 ADR 原文语义落实现，数值逐项一致 | 否 |
| 固定顺序 step 1→10 不可 reorder；本票是「补全」不是 reorder | §8.2 | role gate 仍先于 owner 解码/body 读取/Registry 触达；step 3 插入 owner 捕获与 body 读取之间；step 4/5 原位升级 | 否 |
| **O-2 signal 归属** | §7 D6 | **裁决：随 #268 一并落**——body 读取阶段尊重 `Request.signal`（中断→取消读取、零 Registry 触达、rejection 结算）；Registry 调用后不传播取消（现状保持）。ADR L113 与骨架 AGENTS.md deferred 清单均把 signal 与 limits 并为一项 | 否（ADR L113 原文行为，无决策修订） |
| **O-3 owner 文法复用路径** | §7 D7 | **裁决：namespace-api 包内私有镜像** `isMinimalSafeString` 语义（带出处锚定），不扩 Registry 公共面——备选方案与理由见 D7 | 否（选择了不改 Registry 冻结面的路线） |
| **O-5 Registry 判别式 issue 面** | §7 D8 | 直接消费 `CreateNamespaceIssue` code 判别：`NAMESPACE_SCHEMA_INVALID`/`NAMESPACE_ROOT_INVALID` → 422 + verbatim issues 映射；其余 code 与 branded fatal 维持 rejection（503/500 域不在本票） | 否 |
| O-1 ADR 0015 仍「提议」 | §1 非目标 | 状态翻转随父 PR #158 收官，本票不改 ADR 文件 | 否 |
| O-4 CONTEXT.md 术语卫生 | §10 ALLOW LIST | 落地行为引入 `problem shape`/`REST issue`/`issuesTruncated` 术语，按 docs/AGENTS.md 增补 CONTEXT.md 条目（加法） | 否 |
| 冻结验收套件不得为迁就实现而改 | §10 DENY LIST | SA6 五文件与 #267 四文件零改动；signal 与严格 UTF-8 解码覆盖以**新增**测试文件表达（不触碰冻结套件） | 否 |
| ADR 0009 DQ-4 verbatim issues 纪律 | §8.3 | Registry/VFSL issues 逐字段 verbatim 透传（不重写、不 sanitize、不深克隆），仅在 message 上施加 byte 截断与形状防御 | 否 |

---

## 7. 设计决策与主要备选方案

### D1 problem shape（仲裁 SA6 H5——采纳原样）

错误 response 恒为 JSON object，键集 ⊆ `{code, message, issues, issuesTruncated}`；
`code`（稳定 UPPER_SNAKE，`/^[A-Z][A-Z0-9_]*$/`）与 `message`（非空 string）必选；
`issues` 仅 422 携带（数组）；`issuesTruncated` **仅在确实截断时出现**（未截断时省略该键，
不输出 `false`）；`issuesTruncated:true` 必伴随 `issues`。content-type 恒
`application/json`；405 额外保留 `Allow: POST`（#267 冻结行为）。403/405 的现有 `{code}`
body 升级为 problem shape 是加法（#267 冻结测试只断言 `code` 键值，SA6 已验证 35 用例
不回归）。

*备选*：RFC 7807/9457 `application/problem+json`（`status/title/detail` 键）——被否决：
ADR 0015 L164 只要求「固定 problem shape + 稳定 code」，SA6 H5 已按四键固化且契约
validator 断言未知键违例；引入第二套媒体类型无决策依据且会触发契约回写。

### D2 code 词表（仲裁 SA6 H6——给出具体词表）

14 类失败各自互异、稳定、UPPER_SNAKE；冻结/在树 code 逐字保持。全部为模块内常量，
同一类别不同输入、重复请求均恒定：

| 状态 | 失败类别 | code |
|---|---|---|
| 400 | owner 段非法（percent-encoding 或文法） | `INVALID_OWNER` |
| 400 | query 参数 | `QUERY_PARAMETERS_NOT_SUPPORTED` |
| 400 | 空 body（null body / 0 bytes） | `EMPTY_BODY` |
| 400 | malformed JSON（通用，无源码位置） | `MALFORMED_JSON` |
| 400 | body 非法 UTF-8（严格解码失败） | `INVALID_BODY_ENCODING` |
| 400 | 顶层形状（非 object/数组/键数/类型） | `INVALID_REQUEST_SHAPE` |
| 400 | 数字范围（非有限 / 非安全整数） | `NUMBER_OUT_OF_RANGE` |
| 403 | Peer role（冻结，逐字保持） | `INSTANCE_ROLE_FORBIDDEN` |
| 405 | 方法不匹配（在树 code 保持） | `METHOD_NOT_ALLOWED` |
| 413 | body 超限 | `BODY_TOO_LARGE` |
| 413 | schemaText 超限 | `SCHEMA_TEXT_TOO_LARGE` |
| 413 | JSON 深度超限 | `JSON_DEPTH_EXCEEDED` |
| 413 | JSON 节点数超限 | `JSON_NODES_EXCEEDED` |
| 415 | Content-Type 不支持 | `UNSUPPORTED_MEDIA_TYPE` |
| 415 | Content-Encoding 不支持 | `UNSUPPORTED_CONTENT_ENCODING` |
| 422 | VFSL schema invalid（derive 失败或 Registry `NAMESPACE_SCHEMA_INVALID`） | `SCHEMA_INVALID` |
| 422 | ROOT invalid（Registry `NAMESPACE_ROOT_INVALID`） | `ROOT_INVALID` |

`INVALID_BODY_ENCODING` 是契约 14 类之外的新增类别（SA6 未覆盖严格 UTF-8 失败输入，
ADR L98 要求实现）——不与 14 类冲突（可分性只约束 14 类彼此互异；冻结单射断言
`codes.size === FAILURE_SCENARIOS.length` 只锁 14 类，已核 harness）。其**存在性与
可分性由新增测试文件直接断言**（§12；SA2 F2 修订依据：契约明示「严格 UTF-8…由实现
路径承担」且 grep 全部 11 个测试文件无任何 invalid-UTF-8/fatal 解码用例——缺此覆盖
时，实现丢掉 `{fatal:true}`（退化为 U+FFFD 替换后多半落入 `MALFORMED_JSON`/解析成功）
或把该类并入 `MALFORMED_JSON`，全套测试仍绿）。message 为固定
人读文案（不含 `position/offset/line N/column N` 字样、不含任何输入片段），例：
`INVALID_OWNER` → `'owner 段不符合安全文法或不允许 percent-encoding'`；`MALFORMED_JSON`
→ `'JSON 解析失败'`。message 不承诺逐字稳定（ADR L165）。

### D3 REST issue 形状（仲裁 SA6 H7——采纳并确认「至少一条保留定位」可满足）

`issues[i]` 键集 ⊆ `{code, message, line, column, path}`：`code` 稳定 UPPER_SNAKE——
按来源族给固定值：derive/Registry `NAMESPACE_SCHEMA_INVALID` 的底层 issue（`VfslIssue`
形状）→ `SCHEMA_ISSUE`；`NAMESPACE_ROOT_INVALID` 的底层 issue（`ValidateIssue` 形状）→
`ROOT_ISSUE`（底层 issue 本身无 code 字段，§2 #7；不得从 message 派生 code）。定位
**verbatim 透传**：line/column（正整数对，成对出现）或 `path: (string|number)[]`，
两者互斥（有定位字段的 issue 原样保留其一，天然满足互斥与「至少一条保留定位」——
derive 失败必带 line/column，ROOT invalid 必带 path）。message 非空、UTF-8 bytes ≤
有效 `maxIssueMessageBytes`。逐条防御式映射（unknown → 形状校验，字段缺失/类型不符时
降级为无定位 issue + 占位 message），不泄露 schema/root 片段（issue 内容本身是 VFSL/
Registry 自产诊断，按 ADR 0009 DQ-4 verbatim 纪律透传，SA6 哨兵断言已证不泄露）。

*备选*：把全部 issue 压平为裸 message——被否决（SA6 H7 收紧提案要求至少一条定位；
且丢弃已产生的定位信息无收益）。

### D4 limits 构造门（仲裁 SA6 H8——采纳「合并默认后的有效值」读法）

构造时（`createRestRouter`）同步执行：

1. `limits === undefined` → 全默认；否则必须是 plain object（非 null/非数组，否则
   `TypeError`）。own keys 为空的类实例（如 `new Date()`）等价于 `{}`——可构造、全
   默认，行为确定且与 `{}` 负控一致，无安全差异，故**不追加 prototype 判定**
   （SA2 M-4 维持现设计）；
2. **未知键**（不在七键白名单，含 typo 与大小写变体）→ 普通 `TypeError`；
3. 每个出现的键值必须是**正的安全整数**（`Number.isSafeInteger(v) && v >= 1`；拒 0、
   负数、1.5、NaN、∞、2^53）→ 否则 `TypeError`；
4. 与默认值合并为**有效 limits**（七键全为必填正安全整数）后判跨字段不变量：
   `maxSchemaTextBytes <= maxBodyBytes`，违反 → `TypeError`（故 `{maxBodyBytes: 64}` 这种
   使默认 schemaText 越界的 Partial 也被拒——契约用例未覆盖该形态，本读法是 H8 的
   自然结论且与已覆盖形态一致）；
5. 有效 limits 冻结为单一对象存入 config（替换现有 `limits === undefined ? undefined :
   Object.freeze({...limits})` 浅复制），`handle` 期间零解引用失败可能。

默认值（ADR L103–111 逐字）：`maxBodyBytes = 4 * 1024 * 1024`；`maxSchemaTextBytes =
256 * 1024`；`maxJsonDepth = 64`；`maxJsonNodes = 100_000`；`maxIssues = 100`；
`maxIssueMessageBytes = 1024`；`maxIssuesTotalBytes = 64 * 1024`。

**边界语义**：全部为**排他上限**（值 ≤ 上限接受、> 上限 413/拒绝）；body 恰 4 MiB、
schemaText 恰 262,144 UTF-8 bytes 均不得 413；schemaText 以 **UTF-8 bytes** 计
（`TextEncoder`，非 UTF-16 length）。`depth` 定义：标量 depth 0，容器 depth =
1 + max(子 depth)（body 顶层 object 为 1）；`nodes` 定义：每个 JSON 值节点计 1
（对象/数组/标量；键名不计）。两定义对契约 margin 用例（嵌套 3 接受/32 拒绝于
maxJsonDepth 8；3 元素接受/40 拒绝于 maxJsonNodes 10；100 层拒绝/10 层接受于默认 64）
均给出正确判定。

### D5 数字策略（仲裁 SA6 H9——采纳原样）

解析后遍历所有 number 值：`!Number.isFinite(n)` → 400；`Number.isInteger(n) &&
!Number.isSafeInteger(n)` → 400（JSON 无 NaN 输入，`1e400` 解析为 Infinity 落前者；
`9007199254740993` 落后者；`|n| ≥ 2^53` 的 double 均为整数值故均被拒）；有限小数
（如 `1.5`）接受；`-0` 与 `0` 同样走通（`Number.isInteger(-0) && Number.isSafeInteger(-0)`
均为 true，无特殊分支）。检查在 step 5 与 depth/nodes 同一次**迭代**遍历中执行。

### D6 `Request.signal` 归属（裁决 SA8 O-2）

**随本票落**，范围严格限定在 body 读取阶段（ADR L113 原文）：

- step 4 开始前检查 `request.signal?.aborted`；读取期间监听 `abort`（`once`），abort
  触发 → `reader.cancel()`（best-effort，`.catch(() => {})`）→ 移除监听 → `handle` 以
  普通 `Error` rejection 结算（message 固定，如 `'REST create aborted during body
  read'`，`cause` 携带 `signal.reason`）。**不产生任何 Response**（ADR 未定义 aborted
  请求的 HTTP 表示，客户端已中断；不发明映射）且**零 Registry 触达**。
- **超限分支的 `reader.cancel()` 同为 best-effort（`.catch(() => {})`）且不参与结算**
  （SA2 M-2）：stream 累计字节 > `maxBodyBytes` 时先 cancel 再结算，无论 cancel
  resolve/reject/throw，413 `BODY_TOO_LARGE` 恒定产生——实现不得 `await` 一个可能
  reject 的 cancel 并让其把 413 退化为 rejection（该退化仅外网传输边界可达，内存流
  测试面不可触发，语义仍显式定死）。
- body 读取完成即移除监听；step 6 之后**不查阅 signal**——Registry 接纳后客户端取消
  不传播，create settle 与恰一次 `lease.release()` 照常等待（现状行为，#267 契约已锚）。
- 防御式：`request.signal === undefined`（非标准 Request 形状）→ 跳过监听，不影响主路径。

契约未覆盖 signal 与严格 UTF-8 解码失败（SA6 §12.2/§15 明示不断言），故本设计在
ALLOW LIST 中**新增**一个 body 读取阶段行为测试文件固化这两类行为（§12），不触碰
冻结套件。

*备选*：整体推迟到后续票——被否决：ADR L113 把 signal 与 byte 上限写在同一条、骨架
AGENTS.md deferred 清单把「limits enforcement and Request.signal」并为一项、SA8 O-2
倾向随 #268 落；本票实现有界读取而不同时落 signal 会交付半条 ADR 条款。

### D7 owner 安全文法复用路径（裁决 SA8 O-3）

**namespace-api 包内私有镜像**，带出处锚定：在 `src/rest.ts`（或其私有辅助模块）实现
`isSafeOwnerUserId(segment: string): boolean`，逐条镜像 Registry
`isMinimalSafeString`（`packages/namespace-registry/src/identity.ts` L88–99）：非空、
≠ `.`、≠ `..`、无 U+0000–001F/U+007F–009F 控制字符、无 `/`（0x2F）、无 `\`（0x5C）；
不 trim、不归一化。step 3 的 owner 检查 = 先查 raw 段含 `%` → 400，再查文法 → 400
（双检；经 `URL.pathname` 后 `/`、`\`、控制字符实际不可达或以 percent 形态出现，文法
镜像属纵深防御）。注释中注明规范来源与「Registry 文法演进须同步本镜像」的锁步义务。

*备选（被否决）*：经 `@nomicore/namespace-registry` 公共 index 导出
`validateOwnerIdentity` 复用。代价：Registry 主入口运行时导出被 #112 冻结为**恰 9 个**
value（`registry-surface.test.ts` L57–72 精确断言），新增导出必须改动另一包的冻结
契约测试并扩大本票文件范围到 registry 包（其全套验证门）；而 REST 侧判定必须发生在
Registry 触达之前（poison registry 契约），无法借道 `registry.create` 的
`validateOwnerIdentity`。文法本身被 #110 设计 §4 冻结为最小集（「不得擅加」），漂移
风险低且有契约锚兜底（合法 owner 词表经真实 Registry 走 201）。若未来 Registry 文法
演进，统一导出可另立票决策（§13 follow-up）。

### D8 Registry issue→422 映射（裁决 SA8 O-5）

`registry.create` 返回 `{ok:false}` 时按 code 判别：

| Registry code | 本票处理 |
|---|---|
| `NAMESPACE_SCHEMA_INVALID` | 422 `SCHEMA_INVALID` + `issues`（D3 映射；实践不可达——step 6 同文本 derive 已通过，Registry 二次编译同文本 envelope 应一致；仍按 ADR L174 落 422，fail-closed 而非 500） |
| `NAMESPACE_ROOT_INVALID` | 422 `ROOT_INVALID` + `issues`（D3 映射，path verbatim） |
| `NAMESPACE_CREATE_INVALID_INPUT` / `NAMESPACE_ALREADY_EXISTS` / not-accepting / `NAMESPACE_CREATE_FAILED` | **维持 rejection**（`unmapped registry issue: <code>`，携带 cause）——503/安全 500 族属后续票（SA8 O-2 切片边界），本票不发明映射 |
| 其余未单列 code（现恰为 `NAMESPACE_INVALID_IDENTITY`，`CreateNamespaceIssue` 首成员） | **同上兜底维持 rejection**——正常不可达：step 3a 镜像已把非法 owner 前置 400、零 Registry 触达；仅 D7 镜像漂移时可到达，fail loud 不发明映射（SA2 M-5/S10 补记） |

`registry.create` 抛 branded `NamespaceRegistryFatalError` 等异常 → 维持 rejection
（现状）。**不选择的方案**：把 INVALID_INPUT 映射为 400——被否决：ADR L180 明文
「REST 自行构造合法 Registry 输入 ⇒ INVALID_INPUT 视为内部契约违例」归安全 500 域，
且 REST 的 step 5 数字检查已把可由输入触发的形态（非有限数）前置为 400（SA6 support
锚 4 的因果依据）。

### D9 模块布局

- `src/rest.ts`：limits 构造门（D4）；step 3 检查（owner/query/CT/CE）；403/405 problem
  化；把有效 limits 传入编排。
- `src/create-namespace.ts`：step 4–10 编排（签名私有扩展：接收有效 limits）；step 6
  derive 失败 → 422 problem；step 7 按 D8 分叉；step 8–10 逐行不变。
- `src/request-body.ts`（**新增，包内私有**，不进 package.json exports、不从 index
  re-export）：有界 byte 读取（Content-Length 提前拒绝 + stream 上限 + signal）、严格
  UTF-8 解码、迭代 DFS 结构/数字检查。
- `src/rest-problem.ts`（**新增，包内私有**）：code 常量、problem Response 构造器
  （含 405 的 `Allow: POST`）、D3 issue 映射（预算/截断/byte 安全 message 截断）。

公共面零变化：`src/index.ts`、`package.json` exports、`RestRouterLimits`/
`RestRouterOptions` 类型形状均不变（limits 从「预留」变「执行」不需要签名变化，SA8
依赖核验表已确认）。

### D10 step 3 内部次序（ADR L152「owner、query、Content-Type/Encoding检查」逐字次序）

owner（`%` → 文法）→ query → Content-Type → Content-Encoding。任一失败立即返回对应
problem Response：零 body 成员调用、零 Registry 触达（契约 trapped/poison 断言锚）。
query 判定：`new URL(request.url).search !== ''` → 400（裸 `?` 无参数视为无 query，
不误伤）。Content-Type 判定：缺失/空 → 415；按 `;` 分割，首段 trim + 小写比较必须
`application/json`；至多 1 个参数且必须 `charset=utf-8`（名/值小写比较，值容许可选
双引号包裹；**参数名、`=` 与值两侧容许可选空白 SP/HTAB**——按 RFC 9110 参数语法的
OWS 容忍，`charset = utf-8` 接受；此为设计定死的确定性规则，防实现间漂移（SA2 M-3），
无冻结用例覆盖该形态，接受/拒绝两向均不与冻结断言冲突）；`charset=utf-16`、
第二参数、`application/json-patch+json`、`text/*` 均 415；`APPLICATION/JSON`、
`charset=UTF-8`、无空格分隔接受。Content-Encoding 判定：缺失通过；值 trim + 小写 ===
`identity` 通过；其余（gzip/br/deflate/compress/…）415。不 drain 被拒请求的 body
stream（router 是 Module，stream 生命周期归外层 server；本票不引入资源回收语义）。

### D11 step 5 内部次序与单遍迭代遍历

1. 顶层形状（400 `INVALID_REQUEST_SHAPE`）：`typeof body === 'object' && body !== null
   && !Array.isArray(body)` 且 `Object.keys` 恰为 `['schemaText','root']`（键数恰 2 且
   两键均在；`root` 显式存在即要求第 2 条，值可为任意 JSON 含 null——领域归
   Registry/VFSL）；`typeof schemaText === 'string'`（空串**不是**形状错误）。
2. schemaText 字节（413 `SCHEMA_TEXT_TOO_LARGE`）：`TextEncoder` bytes >
   `maxSchemaTextBytes` → 413。
3. 单遍迭代 DFS（显式栈，pre-order，确定序）：进入容器时 depth > `maxJsonDepth` →
   413；每访问一个值 nodes 超过 `maxJsonNodes` → 413；遇到 number 按 D5 → 400。
   **首个遇到的违例决定结算**（确定性：同一输入恒定同一 status/code；契约的 AC3 用例
   在高 depth/nodes 上限下唯一违例是深层数字 → 稳定 400，无 RangeError）。

*备选*：先全量收集所有违例再按固定优先级（413 > 400）裁决——被否决：多一次遍历且
仍在组合输入上依赖实现定义的优先级；early-exit 单遍已确定且更快。

### D12 空 body / malformed / 编码的判别

`request.body === null` 或收集 bytes 为 0 → 400 `EMPTY_BODY`（不进入 JSON.parse）；
bytes > 0 且严格 UTF-8 解码（`TextDecoder('utf-8', {fatal:true})`）失败 → 400
`INVALID_BODY_ENCODING`；解码成功但 `JSON.parse` 抛错 → 400 `MALFORMED_JSON`（message
为固定通用文案，**绝不**透传平台 SyntaxError 的 `position/line/column`——契约双断言
扫描全部 string 叶子）。重复 key 由平台 last-key-wins 天然成立（不实现任何 key 语义）。
encoding 失败与 malformed JSON 的可执行验收（含可分性）见 §12 新增测试文件（SA2 F2）。

### D13 规范性文档同步（SA2 F1 修订）

docs/AGENTS.md：「When code behavior changes, update every normative document whose
stated contract changed; documentation-only wording changes must not invent
implementation behavior」。包 AGENTS.md Contract 节把 `README.md` 列为行为变更前必读
契约文档。本票落地后，下列现陈述全部变为假契约（§2 #11），必须同批修订——设计
iteration 0 只安排了 AGENTS.md/CONTEXT.md，遗漏同层级的包 README（SA2 F1）：

| 文档 | 现陈述（落地后失效） | 修订方向 |
|---|---|---|
| `packages/namespace-api/README.md` L19–21（Deferred scope） | 「请求形状校验（owner 文法/percent-encoding/query/Content-Type/Encoding/body 上限）、limits 执行与 `Request.signal`、Registry 失败映射与 problem shape、observer 事件契约均由后续 ticket 叠加」「**未映射结局一律以 `handle` rejection 结算（fail loud），不发明任何 HTTP 错误 Response**」「body 读取暂未设上限」 | 移除已落地项（形状校验/limits 执行/signal/4xx+422 problem shape）；保留仍 deferred：503/500 族、`NAMESPACE_CREATE_INVALID_INPUT`/`NAMESPACE_ALREADY_EXISTS` 安全 500、observer 事件契约；「一律 rejection」收窄为「剩余未映射结局（abort、registry fatal、503/500 族）仍以 rejection 结算」；删除「暂未设上限」——读取受 `maxBodyBytes` 有界（该陈述关联受信环境安全前提，必须移除） |
| `packages/namespace-api/README.md` L9–10（Public API） | `handle` 行为描述只覆盖 201/405/403；构造描述未提 limits 门 | 增补：非法请求以 4xx/422 problem Response 结算（400/413/415/422，固定 `{code,message,issues?,issuesTruncated?}`、稳定 UPPER_SNAKE code）；非法 `limits` Partial（未知键/越界值/跨字段违约）构造抛普通 `TypeError` |
| `packages/namespace-api/AGENTS.md` L15–16 | 「Unmapped outcomes (body/JSON errors, malformed top-level shape, VFSL issues, Registry narrow issues or fatals) **reject** `handle`」整列均为 deferred 的「request shape validation…limits enforcement and `Request.signal`…problem shape」清单；尾句「The first version assumes a trusted localhost/trusted-network exposure (ADR 0015 L36) **because body reads are not yet bounded**」 | deferred 清单移除已落地项；unmapped-outcomes 清单收窄为剩余族（abort、registry fatal、503/500 族）；**显式校正尾句**——body 读取已受 `maxBodyBytes` 有界，受信环境前提改述为 ADR 0015 L36 的 authentication/authorization 边界，不再以「读取无上限」为由 |
| `CONTEXT.md` | 无 `problem shape`/`REST issue`/`issuesTruncated` 术语（已核） | 加法增补 3 条术语（SA8 O-4，iteration 0 已安排，不变） |

`src/rest.ts` L15–20 头注「切片边界」段的同款收窄随该文件代码改动一并完成（文件本就
在 ALLOW LIST）。以上均为**陈述与已实现行为对齐**的修订，不发明任何未实现行为
（docs/AGENTS.md 后半句义务）。

---

## 8. 接口、数据流

### 8.1 构造期（`createRestRouter`，同步）

```
读取 options（现状形状校验保持：role/registry/observers/limits）
→ limits 门（D4：对象形状 → 未知键 → 值域 → 合并默认 → 跨字段 → 冻结）
→ config = Object.freeze({ role, registry, metricsObserver, diagnosticObserver,
                           limits: frozenEffectiveLimits })
```

公共签名零变化；新增唯一可观察差异 = 非法 limits 构造抛 `TypeError`（原为静默接受）。

### 8.2 `handle(request)` 请求期（固定顺序，全部加法、无 reorder）

| Step | 检查 | 失败结算 | 成功去向 |
|---|---|---|---|
| 1 | `new URL(request.url)`；route regex 匹配 pathname | URL 非法 → rejection（现状保持）；不匹配 → `{matched:false}` | ↓ |
| 2a | method ≠ POST | 405 `METHOD_NOT_ALLOWED` problem + `Allow: POST` | ↓ |
| 2b | role ≠ hub | 403 `INSTANCE_ROLE_FORBIDDEN` problem | ↓ |
| 3a | owner raw 段含 `%` / 文法镜像失败（D7） | 400 `INVALID_OWNER` | ↓ |
| 3b | `url.search !== ''` | 400 `QUERY_PARAMETERS_NOT_SUPPORTED` | ↓ |
| 3c | Content-Type（D10 规则） | 415 `UNSUPPORTED_MEDIA_TYPE` | ↓ |
| 3d | Content-Encoding（D10 规则） | 415 `UNSUPPORTED_CONTENT_ENCODING` | ↓ |
| 4 | 有界读取（D6/D12：abort 检查 → body null → Content-Length 提前拒绝 → stream 逐 chunk 累计、超限 cancel（best-effort、不参与结算，M-2）→ 0 bytes → 严格 UTF-8） | abort → rejection；> 上限 → 413 `BODY_TOO_LARGE`（cancel 失败不改变结算）；0 bytes → 400 `EMPTY_BODY`；解码失败 → 400 `INVALID_BODY_ENCODING` | bytes/text ↓ |
| 4e | `JSON.parse(text)` | 抛错 → 400 `MALFORMED_JSON`（通用文案） | parsed ↓ |
| 5a | 顶层形状（D11.1） | 400 `INVALID_REQUEST_SHAPE` | ↓ |
| 5b | schemaText bytes（D11.2） | 413 `SCHEMA_TEXT_TOO_LARGE` | ↓ |
| 5c | 迭代 DFS depth/nodes/number（D5/D11.3） | 413 `JSON_DEPTH_EXCEEDED` / 413 `JSON_NODES_EXCEEDED` / 400 `NUMBER_OUT_OF_RANGE` | ↓ |
| 6 | `deriveSchemaIdentity(schemaText)`（现状调用点不变） | `ok:false` → 422 `SCHEMA_INVALID` + issues（D3 映射） | envelope ↓ |
| 7 | `registry.create({owner, schema, root})`（现状调用点/输入不变） | 按 D8 分叉：SCHEMA/ROOT_INVALID → 422；其余 code → rejection | lease ↓ |
| 8–10 | DTO 复制 → 恰一次 awaited `lease.release()`（失败吞错）→ 201（现状逐行不变） | — | 201 |

413/415/400/422 全部经 `src/rest-problem.ts` 构造 Response；除上表列出者外的一切异常
（URL 解析、abort、registry fatal、未知异常）维持 rejection——与骨架「未映射结局
fail loud」纪律一致，后续 503/500 票再收敛。

### 8.3 issues 预算与截断（`rest-problem.ts`）

```
输入：底层 issues（verbatim unknown[]）、来源族（schema|root）、有效 limits
对每条底层 issue（防御式形状校验后）：
  code    = 'SCHEMA_ISSUE' | 'ROOT_ISSUE'
  message = byteCap(底层 message 或占位文案)
  line/column（正整数对）或 path（(string|number)[]）verbatim 透传
预算：count < maxIssues 且（首条 || 已累计 message bytes + 本条 ≤ maxIssuesTotalBytes）
      首条无条件保留，其 message 额外受 maxIssuesTotalBytes 封顶（同款 byte 安全截断，
      保证极端小预算下仍有非空 message）
任一预算停止 → issuesTruncated: true（否则省略键）
byteCap：按 UTF-8 codepoint 边界截断到 ≤ 上限且非空；边界截断后为空（首字符即超上限）
         时以单字节 ASCII '?' 兜底——保证「非空 + ≤ 上限」恒成立
```

VFSL `validateLogicalSnapshot` 自身的 100 条截断标记 issue（`path: []`，§2 #7）按普通
issue 透传；若 REST 预算将其截掉，`issuesTruncated: true` 已表达截断事实（契约默认
maxIssues=100 + 底层 101 条的用例即此路径）。

### 8.4 数据流路线

| 路线 | 触发者与输入 | 写入或创建点 | 转换与边界 | 存储或传输 | 读取或投影点 | 可观察结果 | 错误与清理 | 验收锚点 |
|---|---|---|---|---|---|---|---|---|
| 错误请求 → problem Response | 外部 HTTP 客户端（经未来 server / 测试直接调 `handle`） | 无持久化写入 | raw bytes（有界）→ 严格 UTF-8 → 平台 JSON → 校验；跨进程边界仅在 server（未来） | 内存内 Response body（JSON.stringify） | 调用方读 status/headers/body | 400/403/405/413/415/422 + 固定 problem shape | step≤5 失败零 Registry 触达（poison 锚）；读取超限 `reader.cancel()`；abort 移除监听后 rejection | SA6 三契约文件 44 红用例 |
| issues 映射 → 受控 REST issues | derive 失败（`VfslIssue[]`）或 Registry 窄 issue（verbatim `unknown[]`） | 无 | 逐字段防御式提取 + byte 截断 + 双预算；**无深拷贝、无改写**（DQ-4） | Response body | 调用方 | `issues[i]` ⊆ {code,message,line,column,path}，`issuesTruncated` 显式 | 底层 issues 为纯数据（Registry 已 snapshot/freeze），无清理责任 | request-validation §422、problem §AC4、limits §issues 预算 |
| 成功路径（不变） | 合法请求 | Persistence create（经 Registry） | derive → envelope（含原文 text，绝不进 201） | 持久化 namespace | DTO 复制 → 201 | `namespaceId` + `schema{lang,version,id}`，无 Location | release 失败吞错仍 201 | #267 hub 契约 35 用例（恒绿约束） |
| 构造期 limits | Host composition root | config 冻结对象 | Partial + 默认合并 + 校验 | 进程内冻结配置 | `handle` 各检查点 | 非法构造 `TypeError`；有效值可观测（413 边界） | 构造失败无资源获取（无 dispose 语义，现状保持） | limits 契约构造门 8+ 用例 |

---

## 9. 错误、恢复、并发与幂等

- **错误面**：见 §8.2/§8.3。异常路径全部显式分类（status+code 或 rejection）；无静默
  fallback：无法归类的结局一律 rejection（维持骨架纪律）。malformed JSON 不泄露平台
  报错位置；422 不泄露 schema/root 片段（哨兵契约）。
- **恢复/重试**：本票零重试。release 失败语义不变（吞错、仍 201、不二次调用——#267
  契约冻结）。读取超限后 cancel reader（best-effort）；abort 后零 Registry 触达、无
  Response（客户端已消失，rejection 由外层 server 处置）。
- **回滚**：无持久化回滚需求——所有 4xx/422 在 Persistence 写入之前结算；422 的
  ROOT_INVALID 由 Registry 在提交前拒绝（自身契约）。
- **并发**：router 除冻结 config 外零状态（不变）；每请求独占 body reader 与解析数据；
  limits 检查为纯函数；多请求并发不改任何共享可变量（ADR L208 并发约束由 Registry
  维持，本票不新增串行点）。
- **幂等**：不引入（无 Idempotency-Key，ADR L182 明示限制）。同一非法输入重复请求
  产生逐字节同型 problem（code/message 为常量、issues 顺序为底层 verbatim 顺序）。

---

## 10. 文件范围

### ALLOW LIST

| 路径 | 预期改动 | 原因 |
|---|---|---|
| `packages/namespace-api/src/rest.ts` | limits 构造门（D4）；step 3 检查（D7/D10）；403/405 problem 化（D1/D2）；有效 limits 下传编排；头注「切片边界」段（L15–20）随代码收窄（D13） | 构造面升级为「校验+执行」、骨架注记的本票改动点 |
| `packages/namespace-api/src/create-namespace.ts` | step 4 有界读取/UTF-8/JSON、step 5 形状+资源检查、step 6 derive 失败→422、step 7 D8 分叉；step 8–10 不变；私有签名扩展 | 骨架注记的本票改动点（rejection→Response 纯加法） |
| `packages/namespace-api/src/request-body.ts` | **新增**私有模块：有界读取（含 signal）、严格 UTF-8、迭代 DFS 检查 | D6/D11/D12 的实现载体；保持另两文件可评审尺寸 |
| `packages/namespace-api/src/rest-problem.ts` | **新增**私有模块：code 常量、problem 构造器、issue 映射/预算/截断 | D1/D2/D3 单一定义点，rest.ts 与 create-namespace.ts 共用 |
| `packages/namespace-api/test/rest-create-body-read.test.ts` | **新增**测试（body 读取阶段行为套件）：① abort 中断→rejection+零 Registry 触达；② Registry 接纳后取消不传播（releaseGate 观测）；③ 流式 invalid-UTF-8 bytes→400 `INVALID_BODY_ENCODING`+problem shape+零 Registry 触达；④ `INVALID_BODY_ENCODING` 与 `MALFORMED_JSON` 可分断言 | D6/D12 的 body 读取阶段行为无既有契约覆盖（SA6 §12.2/§15 明示由实现路径承担、不断言 signal），需可执行验收；不触碰冻结套件（SA2 F2） |
| `packages/namespace-api/README.md` | 更新 Public API 节 `handle` 行为描述（4xx/422 problem shape、limits 构造门）与 Deferred scope 节：移除「body 读取暂未设上限」「未映射结局一律 rejection/不发明任何 HTTP 错误 Response」及已落地 deferred 项；保留仍 deferred 项（503/500 族、安全 500、observer 事件）（D13） | docs/AGENTS.md「行为变化须同步全部陈述契约已变的规范性文档」；README 是包公共契约文档、包 AGENTS.md 必读清单首位（SA2 F1） |
| `packages/namespace-api/AGENTS.md` | 更新 L15–16：deferred 清单移除已落地项、unmapped-outcomes 清单收窄为剩余族，并**显式校正尾句**「trusted…because body reads are not yet bounded」（读取已受 `maxBodyBytes` 有界）（D13） | docs/AGENTS.md 同步义务；模块契约不得陈述已失效的安全前提（SA2 F1 点名该尾句） |
| `CONTEXT.md` | 新增 3 条术语（加法）：`problem shape`、`REST issue`、`issuesTruncated`（含 _Avoid_ 行） | SA8 O-4 + docs/AGENTS.md 术语卫生义务 |
| `wiki/raw/task_issue-268_design.md` | 本设计产物（评审修订版 iteration 1） | SA1 固定产物位置 |

### DENY LIST

| 路径 | 与任务的关系 | 禁止修改原因 |
|---|---|---|
| `packages/namespace-api/test/rest-create-request-validation-contract.test.ts`、`rest-create-limits-contract.test.ts`、`rest-create-problem-contract.test.ts`、`rest-create-validation-support.test.ts`、`rest-validation-harness.ts` | SA6 #268 冻结验收契约（本设计目标即使其红→绿） | 包 AGENTS.md「frozen acceptance contract, do not edit」；设计采纳 H5–H9 原样，无需回写 |
| `packages/namespace-api/test/rest-contract-harness.ts`、`rest-create-hub-contract.test.ts`、`rest-role-gate-routing-contract.test.ts`、`rest-contract-support.test.ts`、`rest-public-seam-wiring.test.ts` | #267 冻结契约（35 用例须恒绿） | 同上；403/405 problem 化已验证与其断言兼容（只断言 `code` 键值与 `Allow`） |
| `packages/namespace-api/src/index.ts`、`packages/namespace-api/package.json` | 公共面/打包面 | 本票零公共 API 变化；新模块保持包内私有（AGENTS.md 边界） |
| `packages/namespace-registry/**`（含 `src/index.ts`、`test/registry-surface.test.ts`） | owner 文法来源、issue 面来源 | D7 裁决为镜像复用；Registry 公共面被 #112 冻结为恰 9 运行时导出，本票不扩面、不动其冻结测试 |
| `packages/vfsl/**` | derive/validate 公共接口消费方 | 只消费 `deriveSchemaIdentity`；两族 issue 形状按现状 verbatim 透传 |
| `docs/adr/0015-vertical-rest-namespace-create.md` | 规格来源 | 状态翻「已接受」属父 PR #158 阶段收官（SA8 O-1），非本票 |
| `docs/adr/`（其余）、`docs/protocols/`、`apps/**`、`domains/**`、其余 `packages/**` | 无依赖关系 | 本票改动收敛于 namespace-api + 文档同步两处 |

---

## 11. 调用方影响矩阵

| 调用方 | 当前处理 | 设计后处理 | 所需改动 | 证据 |
|---|---|---|---|---|
| `createRestRouter` 直接调用方（当前仅测试 harness；composition root/server 属未来 FR-5） | 任意 `limits` 被静默接受；非法请求 201 或 rejection | 非法 limits 构造抛 `TypeError`；非法请求获得 4xx/422 Response；其余结局仍 rejection | 无（构造签名不变；rejection→Response 为返回值域加法） | `grep createRestRouter` 全仓仅 namespace-api 内；SA6 §10 影响面 |
| #267 冻结契约套件（35 用例） | 全绿 | 全绿（403/405 body 增 `message` 键，断言只查 `code`/`Allow`；成功路径输入全部合法且在默认 limits 内） | 无 | `rest-role-gate-routing-contract.test.ts` L60–72；SA6 §9 E1 模拟件下 92/92 含 35 旧例 |
| SA6 #268 契约套件（44 红用例） | 红 | 绿（本设计目标） | 无（测试零改动） | SA6 §13.2 可满足性 |
| `orchestrateCreateNamespace`（唯一调用方 `rest.ts`，包内私有） | 签名 `(registry, ownerUserId, request)` | 私有签名扩展（+有效 limits）；行为按 §8.2 | 仅 `rest.ts` 调用点同步 | `src/create-namespace.ts` L31；AGENTS.md 包私有边界 |
| `NamespaceRegistry.create`（被编排调用） | 收到未校验 body 的机械提取结果 | 收到经形状/资源/数字检查的输入（INVALID_INPUT 触发面前移至 400/413）；调用点/输入形状不变 | 无 | `src/create-namespace.ts` L56–60；SA6 support 锚 4 |
| `deriveSchemaIdentity`（被编排调用） | 失败→rejection | 失败→422 problem（issues 映射）；调用点/成功分支不变 | 无 | `packages/vfsl/src/index.ts` L239–259 |
| metrics/diagnostic observers | 零发射、零调用差异 | 同现状（FR-4 延后；observer throw 隔离语义未触及） | 无 | `src/rest.ts` L44–47 |
| 外层 server/gateway（未来） | 无在树实例 | 获得 4xx/422 Response 可直接回写；rejection（abort/5xx 域）仍需其处置策略 | 未来 FR-5 票 | ADR 0015 L32/L36 |

未覆盖调用方：无（`createRestRouter` 与 `orchestrateCreateNamespace` 的全部调用方已列）。

---

## 12. 验收与验证映射

| 需求或风险 | 现有证据 | 所需行为测试或动态场景 | 预期观察 |
|---|---|---|---|
| AC1 状态映射 14 类（400/415/413/422 + 403/405） | SA6 `rest-create-request-validation-contract.test.ts` 18 用例（15 红）+ problem 契约 scenario 矩阵 | 既有（冻结） | 实现后 15 红转绿；poison registry 零触达、trapped 零 body 读取成立 |
| AC2 limits 构造门 + 七默认值 + Partial 覆盖 + 413 | SA6 `rest-create-limits-contract.test.ts` 23 用例（21 红） | 既有（冻结） | TypeError/默认边界（4MiB±1、262144/262145、depth 64、nodes 100k）/覆盖夹紧/UTF-8 计数全绿 |
| AC3 迭代 depth/nodes/数字（50,000 层不栈溢出） | 同上（M9 变异证明递归实现被单用例捕获） | 既有（冻结） | `1e400`/`9007199254740993` 稳定 400，无 RangeError |
| AC4 problem shape / code 可分稳定 / issues 安全 / 截断 | SA6 `rest-create-problem-contract.test.ts` 8 用例（全红） | 既有（冻结） | 键集/类型/14 类互异/403/405 升级/哨兵零泄露全绿 |
| AC5 平台语义（last-key-wins、`-0`、无源码位置） | request-validation + limits + problem 三处断言 | 既有（冻结） | 全绿 |
| H5–H9 仲裁与设计一致（无需回写测试） | SA6 §12.1 提案 | 设计 D1–D5 全部采纳原样 | 契约文件字节不变即绿 |
| D6 signal：abort 中断零 Registry 触达 | 无（SA6 §15 明示不断言） | **新增** `test/rest-create-body-read.test.ts`：流式 body + AbortController 中途 abort + poison registry | `handle` rejection（固定 message/cause）；registry 零成员调用；无 Response |
| D6 signal：Registry 接纳后取消不传播 | #267 releaseGate 观测设施已在 harness | 同文件：observing registry + releaseGate 挂起时 abort signal | create settle、release 恰一次、仍 201 |
| **D12 严格 UTF-8 解码失败（SA2 F2）** | **无**：SA6 契约 §12.2 明示「严格 UTF-8…由实现路径承担」；grep 全部 11 个 namespace-api 测试文件无任何 invalid-UTF-8/fatal 解码用例；冻结 scenario 矩阵 14 类不含 encoding 类 | 同文件：用冻结 harness 既有 `streamedJsonRequest`（raw `Uint8Array` chunks、默认 `content-type: application/json`）提交非法 UTF-8 序列——孤立非法字节 `[0x22,0xFF,0x22]` 与截断三字节序列 `[0x7B,0x22,0x73,0x22,0x3A,0x20,0xE2,0x82]`——+ poison registry | 400 + problem shape（`observeProblem`）+ `body.code === 'INVALID_BODY_ENCODING'`；poison registry 零成员调用（收到 400 Response 本身即证明零触达）。实现丢 `{fatal:true}`（U+FFFD 替换后落入 `MALFORMED_JSON`/解析路径）或将该类并入 `MALFORMED_JSON` 时用例转红 |
| **`INVALID_BODY_ENCODING` 与 `MALFORMED_JSON` 可分（SA2 F2）** | 冻结 14 类互异断言不含 encoding 类（单射断言只锁 14 类彼此互异） | 同文件：同一 router 分别提交上述 invalid-UTF-8 bytes 与合法 UTF-8 的 malformed JSON（复用冻结 harness `buildFailureScenario('malformed-json')` 输入） | 两场景均 400 但 `code` 互异；任一实现合并两类即转红 |
| D7 owner 文法镜像不漂移（对契约锚定的词表） | request-validation 合法 owner 负控（`alice`/`a.b`/`alice-1`/`owner_2` → 201 经真实 Registry） | 既有（冻结） | 绿；镜像若漂移（误拒 `a.b` 等）即红 |
| 既有行为零回归 | SA6 §13.1/13.2 | 全包 `vitest run --typecheck packages/namespace-api/test` + 根 `pnpm typecheck` | 92/92 绿 + `Type Errors no errors` + 新增 body-read 文件绿（signal + 编码用例） |
| Registry/VFSL 公共面零改动 | `git status`/diff 审查 | 实现票收尾检查 | DENY LIST 路径零 diff |

---

## 13. 风险、回滚与残余问题；ADR 冲突复查评估

### 风险

| # | 风险 | 缓解 | 残余 |
|---|---|---|---|
| R1 | owner 文法镜像与 Registry 判定漂移（D7） | 文法被 #110 设计 §4 冻结为最小集；镜像带出处锚定注释 + 锁步义务；契约合法 owner 词表经真实 Registry 走 201 兜底 | 低：若 Registry 未来演进文法，镜像需同步——建议届时评估统一为 Registry 公共导出（follow-up FU-1） |
| R2 | signal 与严格 UTF-8 解码行为无冻结契约（仅新增测试覆盖） | 新增测试文件（signal 两场景 + invalid-UTF-8 两场景）+ 设计明示结算语义（rejection、无 Response、零触达；400 `INVALID_BODY_ENCODING`） | 低：外层 server 票需定义 abort 的 HTTP 处置（与 503/500 族同批） |
| R3 | step 5 多违例输入的 status 取决于「首遇违例」（D11 确定性规则） | 规则确定（同一输入恒同结果），契约用例均为单违例输入 | 无：组合输入行为已定死为 pre-order 首遇 |
| R4 | 422 语义边界：Registry `NAMESPACE_SCHEMA_INVALID` 实践不可达（step 6 同文本已过） | 映射为 422 fail-closed（ADR L174），不静默、不 500 | 无 |
| R5 | 首条 issue message 受 `maxIssuesTotalBytes` 二次封顶的极端小预算语义（§8.3） | 规则确定：首条无条件保留 + byte 安全截断非空 | 无 |
| R6 | 403/405 body 形状变化的在树消费者 | #267 冻结测试只断言 `code`；无其他在树消费者（§11） | 无 |

### 回滚

单票 revert 即完全回滚：全部改动位于 namespace-api（src 3 改 2 增 + test 1 增）+ 文档
（README/AGENTS/CONTEXT）；无 schema、持久化、wire 或数据迁移；冻结契约（#267/#268）
在回滚后分别保持绿/红（红灯即能力缺口的回归表达）。

### 残余 / follow-up（均非本票必要条件；标签 FU-n，与 SA2 finding 编号无关）

- FU-1（承接 R1）：Registry owner 文法若演进，统一评估经公共面导出复用（需动 #112
  冻结面，独立票决策）。
- FU-2（切片边界，SA8 O-2）：503 `REGISTRY_NOT_ACCEPTING`、500 三族、
  INVALID_INPUT/ALREADY_EXISTS 安全 500、abort 的 server 侧 HTTP 处置。
- FU-3（FR-4）：observer 事件契约（metrics 低基数 outcome + diagnostic 三类事件）。
- FU-4（SA8 O-1）：ADR 0015 状态随父 PR #158 收官翻「已接受」。

### 设计后 ADR 冲突复查评估

**不需要**（`requiresConflictRecheck: false`）。理由：本设计是 ADR 0015（提议）既有
条款的首个实现，无 wire/schema/持久化/状态机语义变化，无 ADR 冻结面触碰，无既有决策
修订（H5–H9 采纳 SA6 提案原样、D6/D7/D8 均在 SA8 门禁 `clear` 的裁决点范围内选择且
选择了不改跨包冻结面的路线），公共构造签名不变；新增 problem code 词表是 ADR L165
「稳定 code」授权范围内的具体化。SA8 已对全部条款做过 0 冲突对照（§冲突门禁报告）。
iteration 1 的评审修订不改变该结论：F1 是文件范围完备性（文档同步义务落 ALLOW）、
F2 是验收覆盖缺口补齐（新增测试文件）、M-1/M-2/M-5 是引文与语义注记校正、M-3 的
OWS 容忍是「仅带 `charset=utf-8` 的形式」（ADR L70）在 RFC 9110 参数语法下的确定性
解析细则（无冻结断言约束该形态、简报与 ADR 均不与其冲突）——均不引入
wire/schema/持久化/状态机语义变化，不触碰任何 ADR 冻结面，不修订任何已接受决策
（SA2 评审§设计后冲突复查评估同结论）。

---

## 14. 评审修订映射（SA2 `task_issue-268_sa2_review.md` → 本版）

| Finding | 严重度 | 修订位置 | 处理结果 |
|---|---|---|---|
| SA2-268-F1：包 README 契约同步缺席文件范围 | MAJOR | §7 D13（新增决策：逐文档列出失效陈述与修订方向）；§2 #11（新增事实锚点）；§3；§10 ALLOW LIST 增补 `packages/namespace-api/README.md` 行、AGENTS.md 行显式点名校正「trusted…body reads are not yet bounded」尾句 | **已落实**：README 进入 ALLOW，预期改动覆盖 Deferred scope 与 Public API `handle` 描述（移除「暂未设上限」「一律 rejection」等失效陈述，保留仍 deferred 项）；DENY LIST 无冲突（README 属本票改动包内文档） |
| SA2-268-F2：严格 UTF-8 解码/`INVALID_BODY_ENCODING` 零可执行验收 | MAJOR | §7 D2（存在性/可分性断言义务）、D6（测试文件覆盖面）、D12（交叉引用）；§10 ALLOW（新测试文件扩围）；§12 新增 2 行验收（invalid-UTF-8 两场景 + 与 `MALFORMED_JSON` 可分） | **已落实**：新测试文件扩为 body 读取阶段行为套件并更名 `rest-create-body-read.test.ts`（iteration 0 名 `rest-create-body-read-signal.test.ts`，文件尚不存在、更名零成本且名实相符）：`streamedJsonRequest` 携带 `[0x22,0xFF,0x22]` 与截断三字节序列 → 断言 400 + problem shape + `INVALID_BODY_ENCODING` + poison registry 零触达；另断言与 `MALFORMED_JSON` 场景 code 互异；冻结文件零改动 |
| M-1：死引用/引文不精确 | MINOR | §1 非目标（`-0` 条款改引 ADR L115、非目标清单 L220–228）；§13 R5（「D8.3」→「§8.3」） | **已校正**（两处引文均已核对 ADR 原文行号） |
| M-2：超限 cancel 的 await/catch 语义未写明 | MINOR | §7 D6 新增第二要点；§8.2 step 4 | **已补明**：超限 `reader.cancel()` best-effort（`.catch(() => {})`）、不参与结算，413 恒定产生 |
| M-3：Content-Type 参数 OWS 微语法未定 | MINOR | §7 D10 | **已定为确定性规则**：参数名/`=`/值两侧容忍可选 SP/HTAB（RFC 9110 OWS，`charset = utf-8` 接受）；无冻结用例覆盖该形态，两向均不冲突 |
| M-4：limits plain-object 判定边缘 | MINOR | §7 D4 步骤 1 注记 | **维持现设计**（SA2 自评非必需）：own keys 为空的类实例等价 `{}`，行为确定、与 `{}` 负控一致、无安全差异，不追加 prototype 判定 |
| M-5：`NAMESPACE_INVALID_IDENTITY` 未入 D8 枚举 | MINOR | §7 D8 表新增一行 | **已补记**：该 code 归「其余 code → rejection」fail-loud 兜底，正常不可达（step 3a 前置 400），仅 D7 镜像漂移时可到达 |

两项 MAJOR 均为设计文档级修订，无需回写冻结契约、无需 SA6 修订轮、无需重跑冲突门禁
（§13）；本版为可直接实施的当前一致设计，iteration 0 中与新范围矛盾的表述已原位改写。

---

## 附：SA6 契约假设仲裁汇总（H5–H9 → 本设计）

| 假设 | 仲裁 | 设计节 | 是否需回写契约测试 |
|---|---|---|---|
| H5 problem 键集 `{code,message,issues?,issuesTruncated?}`、未知键禁止 | 采纳 | D1 | 否 |
| H6 14 类互异稳定 UPPER_SNAKE + 冻结 code 保持 | 采纳，词表见 D2 | D2 | 否 |
| H7 REST issue 形状 + 至少一条保留定位 | 采纳（verbatim 定位透传天然满足） | D3 | 否 |
| H8 排他上限 + UTF-8 bytes + 有效值合并判定跨字段不变量 | 采纳 | D4 | 否 |
| H9 非有限/非安全整数 400、`-0` 放行、有限小数（如 1.5）接受 | 采纳 | D5 | 否 |
