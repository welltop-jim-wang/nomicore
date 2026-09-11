# SA9 Standards 审查报告 — Issue #268（REST create：请求形状校验、资源 limits 与 4xx/422 错误契约）

> SA9（独立 Standards 审查者）standards-review 轮产物。dispatch
> `sa-876680dc-7e72-4dbe-9af8-3f6adaaf0f42`，phase standards-review，iteration 0，
> review-group `issue-268-final-0`。
> **被审对象**：**最终已提交 diff** = commit `a80eb7f0994aa0de5a0e93c37d7428ae9f118fa1`
> （`feat(namespace-api): validate REST namespace creation`，21 文件，+4580/−57），其父经
> 本轮独立核验恰为权威基线 `0b06050d9518c66ef166751064c95ed9557c9532`
> （docs/rest-namespace-create@0b06050，`git log --format='%H %P'` 亲证）；branch
> `mabf/issue-268`，工作树 clean。
> **Issue 评论输入**：REST 快照空 `[]`（派遣简报明示；dispatch log 全行 `comments=none`；
> SA6 §14 / SA8 门禁双重 `gh` 复核记录）——无 Owner 追加要求、无评论 ID 锚定义务。
> **输入产物（全部亲读）**：`task_268_dispatch.md`、`task_issue-268.md`（简报）、
> `task_issue-268_conflict_report.md`（SA8 `clear`，O-1..O-5）、
> `task_issue-268_sa6_contract.md`（SA6 `approve`，冻结 5 文件 + §13.4 哈希 + §15 边界）、
> `task_issue-268_design.md`（SA1 iteration 1，D1–D13）、
> `task_issue-268_sa2_review.md`（SA2 iteration 1 `approve`，F1/F2 已解决 + N-1/N-2）、
> `task_issue-268_sa3_impl.md`（SA3 实现报告）、`task_issue-268_sa4_review.md`
> （SA4 `approve`，O-1..O-6）；仓库规范链：根 `AGENTS.md`、`docs/AGENTS.md`、
> `packages/namespace-api/AGENTS.md`、`packages/namespace-registry/AGENTS.md`（只读参照）、
> `docs/adr/0015-vertical-rest-namespace-create.md`（L103–115/L148–180 亲核）、
> 根 `CONTEXT.md`、`vitest.config.ts`；源码终态与 diff 逐 hunk 亲读。
> **审查方式**：`git show/diff` 逐 hunk 亲读 + 定向 grep（skip/only/env、console/debugger/
> timer、包私有性 containment）+ sha256 哈希独立复核 + `git diff --check` 只读门自跑。
> **边界**：零业务代码/设计/测试改动；**未运行测试、未启动服务**（SA9 纪律——SA3 的运行
> 证据与 SA6 红/绿/变异基线作为输入核验）；零 commit/push/PR；唯一写入 = 本文件。
> **职责面**：只判断实现是否符合仓库 AGENTS、ADR、模块责任、既有架构惯例、单一事实源、
> 生命周期对称性、文件范围与测试质量标准；Issue 需求完整实现归属 SA10。
> `wiki/raw/task_issue-268_relevant_decisions.md` 不存在——SA8 报告已含 ADR 全量对照表，
> 设计与 SA2/SA4 同款处理，不阻塞。

---

## Verdict

**approve**（`requiresConflictRecheck: false`）

- **0 BLOCKER / 0 MAJOR**。已提交最终 diff 在模块边界、ADR 保真、设计忠实度、单一事实源、
  生命周期对称性、文档同步纪律、文件范围、测试质量、证据真实性全部 standards 面合规
  （§1–§8）。
- 冻结面完整性经本轮**独立哈希复核**确认：SA6 五文件 sha256 与 §13.4 逐字节一致；
  #267 五冻结文件、`src/index.ts`（`ad207d00…` = SA6 §16 值）、`package.json`、
  registry/vfsl/docs/apps/domains 零 diff（§7）。
- 6 项 MINOR/OBS（§9）均为已登记备案项或理论边缘形态，无一阻断。

---

## 1. 模块责任与包边界（AGENTS.md 链）

| 规范条款 | 本轮亲证 | 判定 |
|---|---|---|
| 公共面恰 `src/index.ts` + `./rest` subpath；编排与新模块包私有 | `package.json` exports 零 diff（仅 `.`/`./rest`）；`src/index.ts` sha256 与 SA6 §16 一致；grep 全仓：`request-body`/`rest-problem` 引用仅存在于 `packages/namespace-api/{src,test}` 内（相对导入），零包外/exports 引用 | ✅ |
| 构造读取-校验-复制-冻结；非法配置抛普通 `TypeError` | `resolveLimits`（rest.ts）：plain-object 门 → 未知键 → 正安全整数值域 → 合并默认 → 跨字段不变量 → `Object.freeze`；全部为普通 `TypeError`，无 branded 错误发明 | ✅ |
| role 单一真相（ADR 0012）；包内零 role 默认值/配置源 | diff 未触碰 role 注入路径；`config.role !== 'hub'` 判定原样 | ✅ |
| 固定顺序不可 reorder；Peer 零 owner 解码/零 body 读取/零 Registry 触达 | `handle` 终态（rest.ts L268–316）：route → 405 → 403 → owner 捕获 → step 3a owner（`%`+文法双检）→ 3b query → 3c CT → 3d CE → 编排；与 ADR 0015 L148–160 十步逐字对齐；step 3 各失败分支零 body 成员调用、零 Registry 触达（trapped/poison 冻结用例锚定） | ✅ |
| 201 body 恰 `namespaceId`+`schema{lang,version,id}`、无 Location；release 失败吞错仍 201、不二次调用 | `create-namespace.ts` step 8–10（L141–158）逐行不变（diff 亲证该段零 hunk） | ✅ |
| 新模块职责归属 | `request-body.ts` = 有界读取/signal/严格 UTF-8/形状与迭代资源检查；`rest-problem.ts` = code 词表/problem 构造器/issue 映射单一点；与包 AGENTS.md L15 更新后陈述一致（文档与实现同变更集同步） | ✅ |

根 `AGENTS.md`「Typed Namespace writes — mandatory」条款适用范围核验：本票是 REST
**创建**入口，schema/root 为运行时外部输入、经 Registry/VFSL 运行时校验（ADR 0015 既定
seam，SA8 对照 ADR 0001 判「同向」），非宿主静态 schema 的 typed `mutateData()` 写路径——
该强制性条款对本 diff 不产生义务，无违规。

## 2. ADR 与既有架构惯例保真

| ADR 条款（亲核原文） | 实现落点 | 判定 |
|---|---|---|
| 0015 L103–111 七项默认 limits（4 MiB / 256 KiB / 64 / 100,000 / 100 / 1,024 / 64 KiB） | `DEFAULT_LIMITS` 逐值一致（`4*1024*1024`、`256*1024`、`64`、`100_000`、`100`、`1024`、`64*1024`） | ✅ |
| 0015 L113：Partial 覆盖、未知键/越界 TypeError、`maxSchemaTextBytes ≤ maxBodyBytes`、413、CL 仅提前拒绝、stream 始终上限、body 读取尊重 `Request.signal`、中断零 Registry 触达、接纳后不传播取消 | `resolveLimits` + `readBoundedBodyText`（CL 提前拒绝 L54–59 + stream 逐 chunk 累计 L88–93 + signal 读前检查/once 监听/finally 移除）逐字对应；接纳后不传播由新测试场景②钉死 | ✅ |
| 0015 L115：迭代检查 depth/nodes/不安全整数；`-0` 无额外语义 | `assertPostParseResourceLimits` 显式栈 DFS（零递归）；数字分支无 `-0` 特例 | ✅ |
| 0015 L163–165：固定 problem shape、稳定 code、受控 REST issue、byte 上限 message、不泄露片段、显式 `issuesTruncated` | `rest-problem.ts`：键集 ⊆ 四键、`issuesTruncated` 仅 `true` 时出现、`problemResponse` 恒 `application/json`；message 全为固定人读文案（无位置/无输入回显） | ✅ |
| 0015 L169–174 状态映射 + L180 安全 500 族归属 | 400×7 / 403 / 405 / 413×4 / 415×2 / 422×2 词表与映射表一致；`NAMESPACE_CREATE_INVALID_INPUT`/`NAMESPACE_ALREADY_EXISTS`/not-accepting/`NAMESPACE_CREATE_FAILED` 与兜底 `NAMESPACE_INVALID_IDENTITY` **维持 rejection**（切片边界，不发明映射） | ✅ |
| 0009 DQ-4 verbatim issues 纪律 | `mapRestIssues`：line/column（成对正整数）或 path verbatim 透传，仅 message 受 byte 截断；不重写、不 sanitize、不深克隆 | ✅ |
| ADR 0015 状态「提议」不翻（SA8 O-1） | `docs/adr/**` 零 diff | ✅ |
| 措辞/术语纪律（docs/AGENTS.md L9） | CONTEXT.md 三条新术语（`problem shape`/`REST issue`/`issuesTruncated`）纯加法、各带 `_Avoid_` 行，与既有词条格式一致 | ✅ |

## 3. 设计忠实度（D1–D13）与上游 finding 闭合

- **D1–D5（H5–H9 仲裁采纳原样）**：problem 键集/17 code 词表/issue 形状/limits 构造门
  （含「合并默认后有效值」读法）/数字策略——逐条与实现对上；冻结契约零回写（哈希证）。✅
- **D6（SA8 O-2 裁决）**：signal 严格限定 body 读取阶段；abort → best-effort
  `reader.cancel().catch(()=>{})` → 固定 message + `cause: signal.reason` 的 rejection、
  零 Response、零触达；超限 cancel 同样 best-effort 且**不参与结算**（SA2 M-2 语义逐字：
  `request-body.ts` L91 不 await，413 恒定产生）；`signal === undefined` 防御分支在场。✅
- **D7（SA8 O-3 裁决）**：`isSafeOwnerUserId` 与 Registry `isMinimalSafeString`
  （identity.ts L88–99）**本轮逐行比对一致**（非空、≠`.`/`..`、C0/C1、`/`0x2F、`\`0x5C；
  无 trim/归一化/白名单加码）；注释带出处锚定与锁步义务；Registry 恰 9 运行时导出的
  冻结面零触碰。✅
- **D8/D10/D11/D12**：step 7 分叉、step 3 内部次序（owner→query→CT→CE）、step 5 次序与
  单遍 pre-order 首遇结算、空 body/严格 UTF-8/malformed 判别——全部按设计落点；
  malformed 固定文案 `JSON 解析失败`，不透传平台 SyntaxError 位置。✅
- **D9/D13**：模块布局与文档同步见 §1/§6。✅
- **SA2 闭合**：F1（README 进文件范围）/F2（`INVALID_BODY_ENCODING` 可执行验收）在提交中
  完全落地；M-1..M-5 处置与 SA3 报告一致；N-1/N-2 为已记录观察。✅
- **SA3 实现期判断合规性复核**：`ResolvedRestRouterLimits` 类型落包私有
  `create-namespace.ts`（rest.ts 以 `import type` 引用）与 UTF-8 byte 工具落
  `rest-problem.ts`——均在 D9 授权范围内、无公共面影响（grep 亲证）；场景④断言**收紧**
  （显式 `INVALID_BODY_ENCODING` 断言）为验收增强且已诚实记录，非弱化。✅

## 4. 单一事实源与生命周期对称性

- **单一事实源**：problem code/message 词表在 `rest-problem.ts` 单一定义（403/405 冻结 code
  逐字保持并收敛进单点，消除 #267 内联双源）；有效 limits 为构造期一次解析的冻结对象
  （`handle` 期间零解引用失败可能）；owner 文法权威仍在 Registry（REST 镜像为有据裁决的
  派生面，漂移风险由锁步注释 + 合法 owner 词表契约绊线 + 未列 code fail-loud 兜底缓解，
  FU-1 备案）。✅
- **生命周期对称**：`addEventListener('abort',…,{once:true})` 与 `finally
  removeEventListener` 成对（读取完成/失败/超限/abort 全路径覆盖）；`getReader` 后
  abort/超限两路 best-effort cancel；构造期零资源获取、无 dispose 语义（与 #267 一致）；
  **零定时器/零后台任务/零 console/debugger**（本轮 grep 亲证无命中）。✅
- **无平行机制**：未新增第二 JSON parser、第二套错误构造、第二套 limits 状态、第二清理
  路径；owner 文法镜像是 SA8/设计明文裁决的例外（带 FU-1 迁移预案），非静默平行。✅
- **安全面**：严格 UTF-8 `{fatal:true}`；迭代 DFS 无递归栈溢出面；body bytes 有界收集
  （+1 chunk 判定余量）且 chunks 仅在上限内累计；DFS 栈规模受 `maxJsonNodes` 封顶；
  message 截断循环受预算封顶；problem/issue 不回显任何输入片段；未映射结局 fail loud
  （不静默 fallback、不伪装成功）。✅

## 5. 测试质量标准

| 检查项 | 本轮亲证 | 判定 |
|---|---|---|
| 冻结契约零改动 | SA6 五文件 sha256 **独立复算**：`3e3d3057…`/`52fc9ad9…`/`a82b0733…`/`fb23dcd9…`/`fa031c3f…` 与 §13.4 逐字节一致；#267 五文件对基线零 diff | ✅ |
| 新测试真实性 | `rest-create-body-read.test.ts`（4 用例）全部断言运行时行为（HTTP 状态/形状/值、promise 结算与 `cause`、Registry 公共 seam 观测、release 计数）；无源码字符串断言 | ✅ |
| 无弱化/跳过/环境操纵 | 新测试与改动 src 文件 `.(only\|skip\|todo)(`/`process.env` grep 零命中；无 sleep/轮询（场景②用一次触发 thenable releaseGate 确定性挂起窗口）；fixture 有 teardown（`withRealRegistry`/`malformedEnvironment.teardown`） | ✅ |
| 被发现性 | 根 `vitest.config.ts` include `packages/*/test/**/*.test.ts` 覆盖新文件（配置本轮亲核）；SA6 §14 `vitest list` 锚在案 | ✅ |
| 变异敏感性 | SA6 M1–M18（冻结面）+ SA3 M-A..M-D（新文件：fatal 丢失/类合并/移除 abort 监听/移除读前检查）均有转红证据 | ✅ |
| 红灯→转绿连续性 | 冻结 44 红用例文件名/断言零改动，SA3 96/96 绿（92 冻结 + 4 新）与之互证 | ✅ |

## 6. 文档标准（docs/AGENTS.md L13 义务履行）

- **README.md**：Public API 增补 limits 构造门（七默认值/TypeError 三族/跨字段不变量）与
  4xx/422 problem 契约描述；Deferred scope 移除已落地项与失效陈述（「一律 rejection/不发明
  任何 HTTP 错误 Response」「body 读取暂未设上限」），保留仍 deferred 的 503/500 族与
  observer 事件；受信环境前提改述为 authentication/authorization 边界。✅
- **AGENTS.md（包）**：Boundaries 新增 problem shape/错误映射条目与三私有模块归属；
  unmapped-outcomes 收窄为 abort/Registry fatal/503·500 族；尾句校正为
  「because it ships no authentication/authorization — body reads are bounded by
  `maxBodyBytes`」——失效安全前提陈述零残留。✅
- **CONTEXT.md**：仅追加 3 条术语（各带 `_Avoid_`），无既有条目改动。✅
- **rest.ts 头注**：「切片边界」段随代码收窄为剩余未映射族，与 AGENTS/README 三处表述互洽
  （本轮对读一致）。✅
- 全部修订为「陈述与已实现行为对齐」，未发明未实现行为（L13 后半句义务）；`git diff
  --check` 本轮自跑 **clean（exit 0）**。✅

## 7. 文件范围（scope）核验

- **ALLOW 命中**：`src/rest.ts`（M）、`src/create-namespace.ts`（M）、`src/request-body.ts`
  （A）、`src/rest-problem.ts`（A）、`test/rest-create-body-read.test.ts`（A）、
  `README.md`（M）、`AGENTS.md`（M）、`CONTEXT.md`（M）——8/8 命中设计 §10 ALLOW LIST，
  改动内容与各行「预期改动」一致。✅
- **DENY 零触碰（本轮独立复核）**：`src/index.ts`/`package.json` 零 diff（index 哈希 =
  SA6 §16 值）；`packages/namespace-registry/**`、`packages/vfsl/**`、`docs/adr/**`、
  `docs/protocols/**`、`apps/**`、`domains/**` 对基线 **零 diff**；#267 五冻结文件零 diff；
  SA6 五文件字节 = 契约哈希（即「零改动地纳入提交」）。✅
- **提交内其余路径**：SA6 冻结契约 5 文件（契约建立时未跟踪，随最终实现一并提交——契约
  字节不变，哈希双证）与 8 件 `wiki/raw/task_*268*` 管线档案（dispatch/简报/SA8/SA6/设计/
  SA2/SA3/SA4 固定位产物）——均为预期 finalize 面，非 scope creep。✅
- 无触发面操纵：`vitest.config.ts`、根 `package.json`、`pnpm-lock.yaml`、`.github/` 不在
  diff 中。✅

## 8. 验证证据审查（SA9 不运行测试，核验证据链）

| 证据 | 来源 | 本轮核验 |
|---|---|---|
| 红→绿：`vitest run --typecheck packages/namespace-api/test` 96/96 绿、`Type Errors no errors` | SA3 §Verification | 与 SA6 §13.1 红灯基线（44 failed/48 passed）逐位衔接（44 红转绿 + 48 恒绿 + 4 新增 = 96）；SA4 静态逐用例推导互证 |
| 根 `pnpm typecheck` exit 0（15 tsconfig 链） | SA3 | 与包 AGENTS.md Verification 入口一致；`--typecheck` 标志在跑 |
| 冻结哈希 5/5 | SA6 §13.4 | **本轮独立复算一致**（非转述） |
| DENY 面/公共面零 diff | SA3/SA4 | 本轮 `git diff 0b06050..a80eb7f --name-only` 复核一致 |
| 变异 M1–M18 / M-A..M-D 转红 | SA6 §13.3 / SA3 §Verification | 记录完整、目标断言明确；变异件均在 worktree 外（无残留，git status clean 亲证） |
| 探针语义（OWS 三形态 201、`a%2eb`→400、stub registry D8 分叉） | SA3（worktree 外，非交付物） | 与 D6/D8/D10 逐条一致；未固化项已在 SA3「Deferred verification」诚实登记 |
| SA4 approve（6 项 non-blocking 观察） | SA4 §2/§12 | 本轮独立复核同意其 non-blocking 定性（见 §9） |

证据链完整、无自相矛盾；无「未运行而声称通过」的假句。

## 9. MINOR / 观察项（均不阻断 approve）

| # | 级别 | 发现 | 状态 |
|---|---|---|---|
| S9-1 | MINOR | SA4 O-1：step 4 内部次序 nano 偏差——实现 CL 提前拒绝先于 body-null 检查（设计 §8.2 括号内次序相反）；仅「null body + 手工超限 CL」组合可达（标准 Request 构造通常不可达），两种结局均为零触达 4xx problem，无安全/验收影响 | 维持 SA4 备案（后续票顺手定死） |
| S9-2 | MINOR | SA4 O-2：`resolveLimits` 取值经 `record[key]`（奇异输入下原型 getter 可读）；值仍过正安全整数门与跨字段不变量，无安全影响 | 维持 SA4 备案（后续可 `hasOwnProperty` 收紧） |
| S9-3 | OBS | SA2 N-2 / SA4 O-3：Content-Type 参数 OWS 容忍为设计定死的宽松规则（「RFC 9110 OWS」措辞不严格）；行为确定、与冻结用例两向无冲突、charset 只门控 UTF-8 解码无安全面 widening | 维持备案 |
| S9-4 | OBS | SA4 O-5：空底层 issues 数组会产出 `issues: []`（D1 键集允许；真实来源恒非空）——理论防御面形态 | 维持备案 |
| S9-5 | OBS | 提交信息 `feat(namespace-api): validate REST namespace creation` 未带 `(#268)` 引用；仓库无 commitlint/commit-msg 门（本轮亲证 `.github` 仅 `ci.yml`、无该配置），历史提交两种风格并存；类型 `feat` 与任务类型（Feature）一致 | 备案，非标准面缺陷 |
| S9-6 | OBS | ADR 0015 仍「提议」（SA8 O-1 / 设计 FU-4：随父 PR #158 收官翻转）与 observer 事件（FR-4）、503/500 族（FU-2）等后续票项——均为显式登记的切片边界，非本票缺陷 | 维持备案 |

## 10. 结论

已提交最终 diff（commit `a80eb7f`，父 = 权威基线 `0b06050`）在 SA9 职责的全部 standards
面上合规：模块边界与包公共面纪律（公共面零变化、新模块包私有 containment 亲证）、ADR 0015
数值/顺序/错误契约逐字保真、ADR 0009 DQ-4 verbatim 纪律、设计 D1–D13 忠实落地、单一事实源
（词表/有效 limits/文法权威）与生命周期对称（signal 监听成对、cancel best-effort、零后台
任务）、文档同步义务（README/AGENTS/CONTEXT 三处失效陈述清零）、文件范围（ALLOW 8/8 命中、
DENY 零触碰、冻结面哈希独立复核一致）、测试质量（冻结契约字节不变、新测试真实行为断言、
零弱化零跳过、变异敏感性证据齐备）、证据真实性（红/绿/变异/探针四链互洽、无假句）。
SA2 两项 MAJOR（F1/F2）与 SA4 全部观察项的处置在提交中确认闭合或如实备案。
**0 BLOCKER / 0 MAJOR；6 项 MINOR/OBS 均不阻断。**

**Verdict: approve**（`requiresConflictRecheck: false`）。

## 11. 交付物

- 本文件：`wiki/raw/task_issue-268_sa9_standards.md`。
- 结构化结果：`verdict = approve`，`requiresConflictRecheck = false`，artifactPaths 见 tool call。

—— SA9 standards-review · iteration 0 · 2026-09-11
