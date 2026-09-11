# SA4 实现后红队审查 — issue #268：REST create 请求形状校验、资源 limits 与 4xx/422 problem 契约

> 阶段：implementation-review（iteration 0）。审查对象：branch `mabf/issue-268` 工作树未提交改动
> （基线 HEAD `0b06050`，SA3 报告 `wiki/raw/task_issue-268_sa3_impl.md`）。
> Issue comments REST snapshot：**空 `[]`**（dispatch log 六行全部 `comments=none`；简报/SA6 §14/SA8 三重复核
> 一致）——无 Owner 评论要求、无评论 ID 映射义务。
> 审查方式：静态审查（源码、设计、冻结测试逐用例推导、Git diff/哈希核对）；SA4 按纪律不运行测试、
> 不启动服务、不创建进程——SA3 的运行证据（96/96 绿 + 根 typecheck exit 0）与 SA6 红/绿/变异基线
> 作为输入核验，关键断言另见「后续动态验证项」。

## 1. Reviewed inputs

| 输入 | 状态 |
|---|---|
| `wiki/raw/task_issue-268.md`（任务简报，comments 快照空） | 已读 |
| `wiki/raw/task_issue-268_design.md`（SA1 设计 iteration 1，602 行，SA2 `approve`） | 已读（全文，D1–D13/§8/§10/§12/§14） |
| `wiki/raw/task_issue-268_sa2_review.md`（SA2 设计评审 iteration 1，verdict `approve`，F1/F2 已解决 + N-1/N-2） | 已读 |
| `wiki/raw/task_issue-268_sa6_contract.md`（SA6 验收契约，verdict `approve`，冻结 5 文件 + §13.4 哈希） | 已读 |
| `wiki/raw/task_issue-268_conflict_report.md`（SA8 门禁 `clear`，O-1..O-5） | 已读 |
| `wiki/raw/task_268_dispatch.md`（派发记录，全 `comments=none`） | 已读 |
| `wiki/raw/task_issue-268_sa3_impl.md`（SA3 实现报告） | 已读 |
| 实现源码：`src/{rest,create-namespace,request-body,rest-problem}.ts`（终态全文） | 已读 |
| 冻结测试（#268 五文件 + #267 `rest-role-gate-routing-contract.test.ts` 关键断言 + 两 harness 全文） | 已读/已核 |
| 新增测试 `test/rest-create-body-read.test.ts` | 已读（全文） |
| 文档：`README.md`/`AGENTS.md`（diff+终态）、根 `CONTEXT.md`（diff）、`docs/AGENTS.md`（义务条款）、ADR 0015 相关行（经设计/SA8/SA6 引文交叉核对） | 已读/已核 |
| 参照源码：`packages/namespace-registry/src/identity.ts` L88–99（D7 镜像源）、`src/types.ts` issue 面（经 SA6/SA8 锚） | 已核 |
| Git 证据：`git status --porcelain`、`git diff HEAD --stat/--name-only`、冻结文件 sha256、`git log -1` | 已核 |
| `wiki/raw/task_issue-268_relevant_decisions.md` | 不存在（SA8 报告已含全量 ADR 对照表替代，设计 §1 同款处理；不阻塞） |

## 2. Verdict

**`approve`** —— 无 BLOCKER、无 MAJOR。实现忠实落实批准设计（iteration 1）的 D1–D13 全部决策与
SA6 冻结契约的 44 红灯目标；文件范围严格落在 ALLOW LIST；冻结面（#268 五文件 + #267 五文件 +
`src/index.ts` + `package.json` + registry/vfsl/docs）零改动（哈希与 git 双证）；规范性文档按 D13
同步且无残留假契约；新增测试为真实行为断言、被仓库 runner 入口发现、带变异敏感性证据。
残留 6 项 non-blocking 观察（§12），其中 2 项为与设计文本的 nano 级次序/边缘偏差（O-1/O-2），
均不影响验收、安全与契约连锁。无新的 ADR 冲突风险（`requiresConflictRecheck: false`）。

独立核验要点（红队视角逐项攻击后的结论）：

- **冻结面完整性**：`sha256sum` 五文件与 SA6 §13.4 **逐字节一致**（`3e3d3057…`/`52fc9ad9…`/
  `a82b0733…`/`fb23dcd9…`/`fa031c3f…`）；`git diff HEAD --name-only` 对 `src/index.ts`、
  `package.json`、`docs/**`、`apps/**`、`domains/**`、`packages/{namespace-registry,vfsl}/**` 零命中；
  HEAD 仍为 `0b06050`（SA3 未 commit/push，纪律正确）。
- **D7 镜像零漂移**：`isSafeOwnerUserId`（`rest.ts`）与 Registry `isMinimalSafeString`
  （`identity.ts` L88–99）逐条一致：非空、≠`.`/`..`、C0/C1（U+0000–001F、U+007F–009F）、`/`(0x2F)、
  `\`(0x5C)；无 trim、无归一化、无白名单加码；带锁步义务注释。`%` 检测先于文法（D7 双检次序 ✓）。
- **红→绿静态可满足性**：对冻结契约逐类推导实现行为（owner 六编码形态→400、query 三形态→400、
  415 拒绝 6 形态/接受 5 形态、EMPTY_BODY 三 fixture、malformed 5 形态无源码位置、形状 10 形态、
  4 MiB±1、262144/262145、depth 100/10 与 32/3、nodes 120k/3 与 40/3、50,000 层迭代 400、
  maxIssues 2/100、message 1024/16、总预算 64 KiB/64B、UTF-8 计数 18/16、七键×六非法值 TypeError、
  跨字段 1024/2048 拒与相等允许、403/405 code 逐字与 `Allow: POST`、14 类 code 单射、哨兵零泄露、
  last-key-wins、`-0`/0）——全部与冻结断言吻合（SA3 96/96 绿与之互证）。
- **403/405 problem 化兼容**：#267 冻结断言只查 `code` 键值（role-gate L65）与 `allow` 头（L70），
  `message` 增键为纯加法；Peer 对 percent-owner 仍 403（role gate 先于 step 3a，L99–102 用例保持真）。

## 3. 上游要求落实

Issue comments 快照空——验收口径 = 简报 What to build 五节 + AC1–AC5 + ADR 0015 条款。

| Requirement or finding | Implementation evidence | Assessment |
|---|---|---|
| 简报 §HTTP/媒体层：owner Registry 既有文法 + path 禁 percent-encoding（400） | `rest.ts` step 3a：`ownerUserId.includes('%') \|\| !isSafeOwnerUserId(...)` → 400 `INVALID_OWNER`；镜像带出处与锁步注释 | 落实（文法逐条=Registry；poison 零触达由冻结用例锚定） |
| 首版不接受 query（400） | `rest.ts` step 3b：`url.search !== ''`（裸 `?` 放行=平台语义） | 落实 |
| Content-Type 缺失/不兼容 415；接受 `application/json` 与仅带 `charset=utf-8` | `isSupportedContentType`：首段 trim+小写、至多 1 参数、参数名/`=`/值 OWS 容忍、值可带可选双引号 | 落实（与冻结拒 6/受 5 形态逐一对齐；OWS 为 M-3 定死规则） |
| Content-Encoding 只接受缺失/`identity` | `isSupportedContentEncoding`：null 通过、trim+小写 === `identity` | 落实（gzip/br/deflate/compress → 415） |
| CORS/OPTIONS 按方法不匹配 | method gate 先行（405 + `Allow: POST`）；冻结用例 OPTIONS→405 绿 | 落实（维持 #267） |
| 有界 bytes → 严格 UTF-8 → 平台 JSON | `readBoundedBodyText`：CL 提前拒绝 + stream 逐 chunk 上限 + `TextDecoder('utf-8',{fatal:true})` + `JSON.parse` | 落实 |
| 重复 key last-key-wins；malformed 通用 400 无源码位置 | 平台 `JSON.parse`（无 key 语义）；catch → 固定文案 `MALFORMED_JSON`，不透传 SyntaxError | 落实（契约双断言 + string 叶子扫描锚定） |
| CL 仅提前拒绝；stream 始终上限 | L54–59（CL 优化）+ L88–93（stream `totalBytes > maxBodyBytes` 恒判） | 落实（无 CL 流式 413 用例锚定） |
| 顶层恰两键、root 显式、schemaText string（空串交 VFSL） | `assertTopLevelShape`：非数组 object + `keys.length===2` + hasOwnProperty 两键 + string 检查 | 落实（空串→422、root null→422 冻结用例锚定） |
| ROOT 合法性归 Registry/VFSL（422） | derive 失败→422 `SCHEMA_INVALID`；Registry `NAMESPACE_ROOT_INVALID`→422 `ROOT_INVALID`（D8 分叉） | 落实 |
| 七默认值/Partial 覆盖/未知键与越界 TypeError/跨字段不变量/413/迭代检查/`-0` 无额外语义 | `resolveLimits`（七默认 + 白名单 + 正安全整数 + 合并有效值跨字段 + 冻结）；`assertPostParseResourceLimits` 显式栈；D5 数字策略无 `-0` 分支 | 落实（H8/H9 语义逐值吻合；M9 递归变异被 AC3 用例捕获的敏感性由 SA6 E2 锚定） |
| 简报 §错误契约：固定 problem shape、稳定 code、受控 issue、不泄露片段、`issuesTruncated` | `rest-problem.ts`：键集 ⊆ 四键、17 code 词表、issue 键集 ⊆ 五键、verbatim 定位、双预算 + 显式截断 | 落实 |
| AC1–AC5 | 冻结三契约文件 44 红用例 + 支持锚（哈希未变）+ SA3 96/96 绿 | 落实（§9 测试质量审查） |
| SA2-268-F1（README 契约同步） | README Public API/Deferred scope 按方向修订；grep 无「暂未设上限」「不发明任何 HTTP 错误」「not yet bounded」残留 | 已落实 |
| SA2-268-F2（严格 UTF-8 可执行验收） | 新文件场景③④：两组非法字节序列 → 400 `INVALID_BODY_ENCODING` + problem shape + poison；与 `MALFORMED_JSON` code 互异 + 显式 code 断言；SA3 变异 M-A/M-B 转红证据 | 已落实（断言为收紧非弱化） |
| SA6 H5–H9 仲裁采纳 | D1–D5 实现逐条吻合（键集/词表/issue 形状/排他上限+有效值合并/数字策略），冻结测试零回写 | 落实 |
| SA8 O-2（signal 归属）/O-3（文法复用）/O-5（判别式面） | D6/D7/D8 按裁决落：signal 限 body 读取阶段、镜像不扩 Registry 公共面、SCHEMA/ROOT→422 其余 rejection | 落实 |
| SA8 O-4（术语卫生） | CONTEXT.md 加法 3 条（problem shape/REST issue/issuesTruncated，含 _Avoid_ 行） | 落实 |

## 4. 设计落实审查

| Design decision | Implementation location | Assessment | Finding |
|---|---|---|---|
| D1 problem shape（键集/`issuesTruncated` 仅截断时出现/405 `Allow`） | `rest-problem.ts problemResponse` L135–147；`methodNotAllowedResponse` | 落实（`false` 不输出；`issuesTruncated:true` 必伴随 issues 由冻结 validator 锚定） | — |
| D2 code 词表（14 类 + `INVALID_BODY_ENCODING` 增量 + 403/405 逐字） | `REST_PROBLEM_CODES` 17 键 + 固定文案 | 落实（冻结单射断言只锁 14 类，第 15 code 不冲突——与 SA2 复核一致） | — |
| D3 REST issue 形状（来源族 code/verbatim 定位互斥/byte 上限/防御降级） | `mapRestIssues`/`readIssueLocation` L214–276 | 落实（line/column 成对正整数优先，否则 path verbatim，否则无定位降级；定位字段互斥天然成立） | — |
| D4 limits 构造门（对象形状→未知键→值域→合并→跨字段→冻结） | `resolveLimits` L106–140 | 落实（H8 有效值合并读法：`{maxBodyBytes:64}` 使默认 schemaText 越界亦拒；M-4 无 prototype 判定，与设计维持一致） | O-2（nano，见 §12） |
| D5 数字策略（非有限/整数非 safe → 400；`-0`/有限小数放行） | `assertPostParseResourceLimits` L166–170 | 落实（同一迭代遍历内执行） | — |
| D6 signal 归属（读前/期间 abort→rejection+cause、零触达；超限 cancel best-effort 不参与结算；接纳后不传播；signal undefined 防御） | `request-body.ts` L50–53/66–99；`rest-create-body-read.test.ts` 场景①② | 落实（`{once:true}`+finally 移除监听对称；cancel 均 `.catch(()=>{})` 不 await；M-2 语义逐字落实；M-C/M-D 变异红） | — |
| D7 owner 文法包内私有镜像 | `isSafeOwnerUserId` + 注释（出处/锁步义务） | 落实（与 identity.ts L88–99 逐条一致；Registry 公共面未扩） | — |
| D8 Registry issue→422 分叉 | `create-namespace.ts` L129–140 | 落实（SCHEMA/ROOT_INVALID→422；INVALID_INPUT/ALREADY_EXISTS/not-accepting/`NAMESPACE_INVALID_IDENTITY` 兜底与 fatal 维持 rejection——M-5 落实） | — |
| D9 模块布局（两新私有模块/公共面零变化） | `request-body.ts`/`rest-problem.ts`；`src/index.ts`、`package.json` 零 diff | 落实（grep 全仓：两模块无包外引用；SA3 记录的类型落点/UTF-8 工具落点两判断均包内私有、无公共面影响） | — |
| D10 step 3 内部次序与判定规则 | `handle` L285–311 + `isSupportedContentType`/`isSupportedContentEncoding` | 落实（owner→query→CT→CE；每失败即返回、零 body 成员调用——trapped 冻结用例锚定） | O-3（nano，见 §12） |
| D11 step 5 次序与单遍迭代 DFS | shape→schemaText bytes→显式栈 DFS（pre-order、首遇决定） | 落实（depth=容器层级+1、nodes=值节点、键名不计；margin 用例数值逐例自洽） | — |
| D12 空 body/malformed/编码判别 | `readBoundedBodyText` L61–64/100–114 + JSON catch | 落实（null body/0 bytes→EMPTY_BODY；fatal 解码失败→INVALID_BODY_ENCODING；parse 抛→MALFORMED_JSON） | O-1（nano，见 §12：CL 检查先于 body-null 检查，与 §8.2 step 4 括号内次序互换） |
| D13 规范性文档同步 | README/AGENTS/CONTEXT/rest.ts 头注 | 落实（失效陈述全部移除；仍 deferred 项保留；尾句「because body reads are not yet bounded」显式校正为 auth 边界 + bounded 读） | — |
| §8.2 固定顺序（无 reorder） | `handle`：route→405→403→3a–3d→step4–10 | 落实（role gate 仍先于 owner 解码/body 读取/Registry 触达） | — |
| §8.3 issues 预算/截断伪码 | `mapRestIssues` L244–274 | 落实（首条无条件保留+`min(单条,总)` 封顶；非首条双预算；停止即 `issuesTruncated:true`；VFSL 100 条截断标记按普通 issue 透传——默认 101 底层用例即此路径） | — |

设计明确且实现缺失：无。实现必要偏离设计：无（两处实现期判断已由 SA3 记录且在授权范围内；§12 的 O-1/O-2 为 nano 级偏差，不构成设计违背级 finding）。

## 5. 架构一致性与惯例

### 责任归属

| Behavior | Expected owner | Actual location | Assessment |
|---|---|---|---|
| HTTP/媒体/形状/limits 入站校验 | host-agnostic REST Module（ADR 0015） | `rest.ts`/`request-body.ts` | 正确；router 除冻结 config 零状态 |
| owner 文法语义项 | Registry（identity.ts 单一定义点） | Registry 未动；REST 前置镜像（D7 裁决） | 归属未转移；漂移最坏 fail loud（S10 兜底）+ 合法词表契约绊线 |
| 422 issue 投影/预算/截断 | REST 表现层 | `rest-problem.ts` 单一定义点 | 正确（DQ-4 verbatim + 仅 message 截断） |
| signal/流生命周期 | 请求作用域 | `readBoundedBodyText` 内聚，读毕/abort 双向清理 | 对称（once 监听 + finally remove） |
| 规范性文档同步 | 行为变更所属包 + 根术语表 | README/AGENTS/CONTEXT/rest.ts 头注 | 正确 |

### 相似能力对照

| Similar capability | Existing implementation | Actual implementation | Consistent or divergent | Reason |
|---|---|---|---|---|
| 包内私有编排/辅助模块 | `src/create-namespace.ts`（私有、相对导入、不进 exports） | `request-body.ts`/`rest-problem.ts` 同款 | Consistent | #267 既有惯例；grep 证无包外引用 |
| owner 文法 | `identity.ts isMinimalSafeString`（非公共导出） | 包内镜像 + 锁步注释 | Divergent（有据） | SA8 O-3/设计 D7 裁决（Registry 面恰 9 value 冻结；判定须先于触达）；FU-1 迁移预案在案 |
| 冻结 code 常量 | rest.ts 内联常量（#267） | 收敛进 `rest-problem.ts` 单点，逐字保持 | Consistent | 词表单一定义点，消除双源 |
| 测试 fixture/harness | 两 harness（poison/observing/trapped/streamed） | 新测试全部复用，零平行 fixture | Consistent | 场景②以 thenable releaseGate 替代 sleep/轮询 |

### 单一事实源

| Fact | Authoritative source | Derived state | Drift risk |
|---|---|---|---|
| 有效 limits | 构造期合并默认后的冻结 config | 无 | 无（handle 期间零解引用失败可能） |
| owner 安全文法 | Registry `identity.ts` | REST 镜像 | 低（锁步注释 + 契约绊线 + S10 兜底 + FU-1） |
| problem code 词表 | `rest-problem.ts` 常量 | 无 | 无 |
| Registry create 结果语义 | Registry 判别式 code | D8 映射表 | 无（未列 code fail loud） |
| 规范性文档陈述 | 已实现行为 | README/AGENTS/CONTEXT 同步 | 低（本次已对齐；grep 无残留假契约） |

### 生命周期对称性

| Start or acquire | Stop or release | Failure recovery | Assessment |
|---|---|---|---|
| `body.getReader()` + `signal.addEventListener('abort',…,{once:true})` | 读毕/失败/超限/abort 一律 `finally removeEventListener`；abort/超限 `reader.cancel().catch(()=>{})` best-effort | abort→固定 message+cause rejection、零触达；超限→413 恒定（cancel 不参与结算）；stream read 抛错非 abort→原样 rejection | 对称；无后台任务、无第二清理路径 |
| 构造期 config 冻结 | 无 dispose 语义（现状保持，无资源获取） | 构造失败零资源获取 | 对称（与 #267 一致） |

### 平行机制检查

| Candidate duplicate | Existing path | Actual path | Disposition |
|---|---|---|---|
| 第二 JSON parser | 无（平台 JSON.parse） | 未新增 | 合规（非目标清单） |
| 第二 owner 文法门 | Registry identity | REST 镜像 | 有据裁决（D7），非静默平行 |
| 第二套错误 Response 构造 | #267 内联 403/405 | 收敛 `rest-problem.ts` 单点（403/405 亦经它） | 消除双源，非并存 |
| 第二套 limits 状态 | 无 | 构造期一次解析冻结 | 无平行 |
| 第二 cleanup worker/retry loop | 无 | 未新增（零重试；release 失败吞错仍 201 不二次调用） | 合规 |

## 6. 文件范围审查

| Changed path | ALLOW entry | Purpose | Assessment |
|---|---|---|---|
| `packages/namespace-api/src/rest.ts`（M） | 行 1 | limits 门/step 3/403·405 problem 化/头注收窄 | 合规 |
| `packages/namespace-api/src/create-namespace.ts`（M） | 行 2 | step 4–7 升级 + 私有签名扩展（step 8–10 逐行不变） | 合规 |
| `packages/namespace-api/src/request-body.ts`（A） | 行 3（新增私有模块） | 有界读取/signal/严格 UTF-8/迭代检查 | 合规（不进 exports/index，grep 证包私有） |
| `packages/namespace-api/src/rest-problem.ts`（A） | 行 4（新增私有模块） | code 词表/problem 构造器/issue 映射 | 合规（同上） |
| `packages/namespace-api/test/rest-create-body-read.test.ts`（A） | 行 5（新增测试） | D6/D12 可执行验收（4 场景） | 合规（vitest include `packages/*/test/**/*.test.ts` 覆盖；SA6 §14 `vitest list` 入口同款） |
| `packages/namespace-api/README.md`（M） | 行 6 | D13 文档同步 | 合规 |
| `packages/namespace-api/AGENTS.md`（M） | 行 7 | D13 模块契约同步（含尾句校正） | 合规 |
| `CONTEXT.md`（M） | 行 8 | O-4 术语加法（仅追加 3 条，无既有条目改动） | 合规 |
| `wiki/raw/task_issue-268_sa3_impl.md`（A） | 实现报告（固定产物位） | SA3 报告 | 合规 |
| `wiki/raw/task_{268_dispatch,issue-268,issue-268_conflict_report,issue-268_design,issue-268_sa2_review,issue-268_sa6_contract}.md`（A，未跟踪） | 上游 SA 产物（SA6/SA8/SA1/SA2 固定位） | 管线产物，非实现改动 | 合规 |

DENY LIST 零触碰：冻结 #268 五文件 sha256 与 SA6 §13.4 逐字节一致；#267 五文件（含
`rest-contract-harness.ts`）未出现在 diff/untracked-modified 中；`src/index.ts`/`package.json`
零 diff；`packages/namespace-registry/**`、`packages/vfsl/**`、`docs/adr/**`、`apps/**`、
`domains/**` `git diff HEAD --name-only` 零命中。`.scratch/` 为 gitignore 覆盖的既有目录，
非本轮产物。无越界改动。

## 7. 契约连锁审查

| Contract | Caller | Actual handling | Risk | Finding |
|---|---|---|---|---|
| `createRestRouter(options)` 公共签名/类型面 | 全仓仅 namespace-api 测试 harness（SA6/SA2 grep 锚 + 本次复认 `orchestrate` 调用封闭） | 签名/`RestRouterLimits`/`RestRouterOptions` 形状零变化；新差异=非法 limits 构造抛 TypeError（文档已述） | 无 | — |
| `handle` 返回域（rejection→4xx/422 Response） | 测试 harness（server 属未来 FR-5） | 纯加法；#267 冻结 35 用例断言兼容（403/405 只查 code/Allow；成功路径输入合法且在默认 limits 内） | 无 | — |
| `orchestrateCreateNamespace`（包内私有）签名 +`limits` | 唯一调用方 `rest.ts` L314 已同步 | grep 证无其他调用方 | 无 | — |
| `NamespaceRegistry.create` 输入 | 编排层 | 调用点/三键输入形状不变；非有限数等 INVALID_INPUT 触发面已前移为 400/413（poison registry 契约证零触达） | 无 | — |
| `deriveSchemaIdentity` | 编排层 | 调用点不变；`ok:false` 面 → 422 + issues 映射（VfslIssue line/column verbatim） | 无 | — |
| Registry 窄 issue 面（含 `NAMESPACE_INVALID_IDENTITY`） | 编排层 D8 分叉 | 未列 code → `unmapped registry issue: <code>` rejection（M-5 兜底） | 无 | — |
| 403/405 body `{code}` → problem shape | #267 冻结套件 | 增 `message` 键；断言只查 code 键值与 Allow 头（role-gate L65/L70 亲核） | 无 | — |
| 观察者（metrics/diagnostic） | 无消费者 | 零发射、签名不变（FR-4 延后） | 无 | — |
| 外层 server/gateway（未来） | 无在树实例 | Response 可直接回写；abort/503/500 族 rejection 处置边界已在 README/AGENTS 声明 | 无 | — |

未发现遗漏 caller 或未处理的新错误语义。

## 8. 错误、恢复与并发

| 检查项 | 结论 |
|---|---|
| 错误吞掉/伪装成功 | 无：全部结局显式分类（status+code Response 或 rejection）；唯一吞错=release 失败仍 201（#267 冻结语义，逐行不变） |
| malformed JSON 位置泄露 | 无：固定文案 `MALFORMED_JSON`；冻结双断言 + string 叶子扫描锚定 |
| 422 片段泄露 | 无：issue 为 VFSL/Registry 自产诊断 verbatim（DQ-4），message 受 byte 截断；哨兵用例（schema 注释/root 值）亲核通过 |
| 部分完成伪成功 | 无：所有 4xx/422 在 Persistence 写入前结算；ROOT_INVALID 由 Registry 提交前拒绝 |
| 重试幂等 | 零重试；release 不二次调用；同输入 problem 逐字节同型（常量 code/message、verbatim 顺序） |
| abort 竞态 | 读前检查 + 读期间 once 监听 + 每次读出后复查 `aborted` 标志（含 read reject 分支）；读毕 finally 移除监听，step 6 后零 signal 查阅（D6 逐字）；M-C/M-D 变异红证敏感性 |
| 超限 cancel 语义 | `reader.cancel().catch(()=>{})` 不 await、不参与结算，413 恒定（M-2） |
| TOCTOU/锁/lease 范围 | router 零共享可变量（冻结 config 外零状态）；每请求独占 reader/解析数据；无新串行点（ADR L208 约束维持） |
| 进程重启/事务中断 | 无持久化写入新增；4xx/422 全部先于写入；回滚需求无 |
| stream 异常（非 abort） | read 抛错 → 原样 rejection（fail loud，不发明映射） |
| 内存/资源 | chunks 收集受 `maxBodyBytes` 封顶（+1 chunk 判定余量）；`maxJsonNodes` 封顶 DFS 栈规模；message 截断循环受预算封顶（≤预算+1 codepoint 迭代）；无定时器/后台任务 |
| 深递归风险 | 无：depth/nodes/数字检查显式栈迭代（M9 变异仅 AC3 用例捕获——即本点不可省略）；测试侧深体构造亦无递归 |

静态无法确认的运行项列入 §11（真实传输边界的 cancel reject 路径、CI 触发）。

## 9. 测试质量审查

| Test | Behavior asserted | Runner entry | Weakening or gap | Finding |
|---|---|---|---|---|
| 冻结 `rest-create-request-validation-contract.test.ts`（18 用例） | owner/query/media/encoding/body/形状/422 映射 + 零触达 + trapped 零 body 读取 + 平台语义 | 根 `pnpm test`/`vitest run --typecheck`（SA6 §14 list 锚） | 无弱化（哈希与 SA6 §13.4 逐字节一致，本次亲核） | — |
| 冻结 `rest-create-limits-contract.test.ts`（23 用例） | 构造门/七默认/Partial/413 边界/迭代/预算 | 同上 | 无弱化（同上） | — |
| 冻结 `rest-create-problem-contract.test.ts`（8 用例） | 键集/类型/14 类单射/稳定性/403·405 升级/issues 受控/截断 | 同上 | 无弱化（同上） | — |
| 冻结 `rest-create-validation-support.test.ts`（8 用例，恒绿锚） | 平台/fixture/VFSL/Registry/poison 自证 | 同上 | 不触 router，不受实现影响 | — |
| 冻结 #267 四文件 + harness（35 用例） | 成功路径/405/403/matched:false/公共面 | 同上 | 零改动；problem 化兼容（code-only 断言亲核） | — |
| 新 `rest-create-body-read.test.ts` ① | 读取期间/读前 abort → rejection（固定 message+cause）、无 Response、poison 零触达 | vitest include `packages/*/test/**/*.test.ts` 覆盖（配置亲核）；SA3 `vitest run` 96/96 含本文件 | 无 skip/only/todo/env（grep 亲核）；无 sleep/轮询 | — |
| 新 ② | 接纳后 abort 不传播：thenable releaseGate 确定性挂起窗口、release 恰一次、仍 201、body 恰两键 | 同上 | gate 为一次触发 thenable（无竞态等待）；断言观测真实 Registry seam | — |
| 新 ③ | 两组非法 UTF-8 字节流（孤立 `0xFF`/截断三字节）→ 400 `INVALID_BODY_ENCODING` + problem shape + 零触达 | 同上 | 覆盖 SA2 F2 字节级要求；fatal 丢失变异（M-A）转红 | — |
| 新 ④ | 与 `MALFORMED_JSON`（复用冻结 scenario 输入）code 互异 + 显式 `INVALID_BODY_ENCODING` 断言 | 同上 | SA3 在设计断言之上**收紧**（原「互异」断言对 fatal 丢失不敏感——SA3 报告已诚实记录并加固）；非弱化 | — |

判定：SA6 红灯断言全部保持（冻结字节未变）；新测试为真实行为断言（无源码字符串断言）、fixture
隔离（`withRealRegistry` finally 收尾；毒 registry 无状态）、被仓库真实入口发现；变异证据
（SA6 M1–M18 于冻结面 + SA3 M-A..M-D 于新文件）覆盖关键实现点。SA4 未运行测试（纪律），
96/96 绿采信 SA3 报告并与本次静态逐用例推导互证；全量复跑列入 §11。

## 10. Required revisions

无 BLOCKER/MAJOR。无阻断修订项。

## 11. 后续动态验证项

| Risk | Driver | Expected observation | Failure condition |
|---|---|---|---|
| 全包套件与类型检查在当前工作树复跑 | Controller/SA7（仓库入口 `NODE_OPTIONS=--conditions=nomicore-source vitest run --typecheck packages/namespace-api/test` + 根 `pnpm typecheck`） | 96/96 绿、`Type Errors no errors`、exit 0 | 任何红/类型错误（SA4 未运行，静态推导与 SA3 证据互证但不能替代复跑） |
| CI 入口对新文件的触发（`.github` 分片配置对 namespace-api 的覆盖） | Controller/SA7 | CI 绿且 `rest-create-body-read.test.ts` 出现在运行清单 | CI 分片漏跑该包/该文件 |
| 真实传输边界的超限 cancel reject 路径（内存流测试面不可触发；M-2 已定死语义） | 未来 FR-5 server 票的集成验证 | 超限时 413 恒定产生，cancel 失败不改变结算 | 413 退化为 rejection |
| O-1 组合（null body + 手工声明超限 Content-Length）在标准 Request 实现中的可达性 | 未来票/探针 | 不可达或行为被定死（见 §12 O-1） | 出现 400/413 漂移且被客户端依赖 |
| Registry `NAMESPACE_SCHEMA_INVALID` 分支（实践不可达——step 6 同文本已过） | SA3 已以 worktree 外 stub 探针实证 422；无需固化测试 | 探针记录 422 + `SCHEMA_ISSUE`/line+column | — |

## 12. Non-blocking observations

1. **O-1（step 4 内部次序 nano 偏差）**：设计 §8.2 step 4 括号内次序为「abort 检查 → body null →
   Content-Length 提前拒绝」；实现（`request-body.ts` L54–64）为「abort → Content-Length → body
   null」。可观察差异仅在「body 为 null 且声明 Content-Length > 上限」的组合（设计读法 400
   `EMPTY_BODY`，实现 413 `BODY_TOO_LARGE`）。该组合无冻结用例覆盖，标准 `Request` 构造
   （bodyless fixture 不带 CL）通常不可达，且两种结局均为零触达 4xx problem——无安全/验收影响。
   建议：后续票顺手对调两段次序或于设计 nano-note 定死该组合语义（routing: implementation）。
2. **O-2（limits 值读取含继承属性）**：`resolveLimits` 未知键门用 `Object.keys`（own-only），但取值
   用 `record[key]`——类实例原型 getter（或被污染的 `Object.prototype`）上的已知键值会被采用，
   而 D4/M-4 的裁决语义是「own keys 为空的类实例等价 `{}`（全默认）」。仅奇异输入可达，值仍须过
   正安全整数门与跨字段不变量，无安全影响。建议：后续以 `Object.prototype.hasOwnProperty.call`
   收紧取值（routing: implementation）。
3. **O-3（charset 引号值内部空白）**：`isSupportedContentType` 对带引号值去引号后再 trim，
   `charset=" utf-8 "` 亦接受——比严格引号语义略宽，但仍在 D10「值容许可选双引号包裹 + OWS 容忍」
   意图内，且 charset 参数只门控 UTF-8 解码、无媒体类型放宽。无需动作（SA3 已以探针实证设计定死的
   `charset = utf-8` 形态 201；N-2 可选加固用例仍未加，维持 SA2「非必需」判断）。
4. **O-4（AGENTS.md L12 固定顺序清单未插入 step 3 项）**：与 SA2 N-1 裁决一致（所列相对次序保持、
   新增检查为「owner capture → body read」间的插值，不构成 stated contract 变化）；且同文件新增
   bullet 已完整描述 4xx/422 与 `request-body.ts` 职责。维持判断，仅记录。
5. **O-5（422 空 issues 数组的理论形态）**：`mapRestIssues` 对空底层数组会产出 `issues: []`（D1 键集
   允许数组；真实来源 derive/Registry 失败恒非空）。防御面行为，无需动作。
6. **O-6（场景④断言收紧）**：SA3 在设计「两 code 互异」之上显式断言
   `encodingProblem.body.code === 'INVALID_BODY_ENCODING'`，修复了原断言对 fatal 丢失不敏感的缺口
   并在报告中诚实记录——属加强验收，值得肯定，无需回写设计（行为与 D12 一致）。

## 设计后 ADR 冲突复查评估

**不需要**（`requiresConflictRecheck: false`）。本实现为批准设计（iteration 1）的忠实落地：
无 wire/schema/持久化/状态机语义新增（全部为既有 REST Module 入站检查与错误投影），未触碰任何
ADR 冻结面（registry/vfsl/docs 零 diff 亲证），公共构造签名与打包面零变化；新增 problem code
词表在 ADR L165「稳定 code」授权范围内。未发现与 ADR 0001–0015 及 CONTEXT.md 既有条目的新冲突
（术语为加法增补，含 _Avoid_ 反向锚）。

—— SA4 implementation-review · iteration 0 · 2026-09-11
