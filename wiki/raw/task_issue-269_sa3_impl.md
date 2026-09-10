# SA3 Implementation Report

> 阶段：implementation（iteration 1）。派发：`sa-ea0d25aa-639d-4cba-93da-f1bb19896bef`（mabf-sa3）。
> Worktree：`/home/wangjian/nomicore-fix-issue-269`，branch `mabf/issue-269`。
> **本迭代业务工作：把 #269 实现（`7b40f50`）rebase 到当前 Parent PR base `209b046`
> （`feat(namespace-api): validate REST namespace creation (#297)`，即 issue #268 的落地内容），
> 解决 4 个冲突路径，并在合入语义下保持 #269 已批准验收契约与实现语义。**
> 实现依据：`wiki/raw/task_issue-269_design.md`（SA1）→ `wiki/raw/task_issue-269_sa2_review.md`
> （`approve`，0 BLOCKER / 0 MAJOR）→ `wiki/raw/task_issue-269_sa6_contract.md`（`approve`，29 用例冻结）
> → `wiki/raw/task_issue-269_sa4_review.md`（`approve`，0 BLOCKER / 0 MAJOR，OBS-A/B）。
> Issue-comment REST 快照 `[]`（dispatch 明示）⇒ 无 owner 评论级要求。

## Inputs consumed

| 输入 | 位置 | 使用 |
|---|---|---|
| 本次 dispatch | Host 提示词（iteration 1 / sa-ea0d25aa…） | rebase 冲突解决任务与验收保持要求；comments 快照空 |
| 批准设计 | `wiki/raw/task_issue-269_design.md` | §7.1 映射表 T1–T11、§7.3 取消状态机、§7.4 事件契约、§7.6 #268 共享 seam、§7.7/§7.8 接口与伪代码、§11 ALLOW/DENY |
| SA2 评审 | `wiki/raw/task_issue-269_sa2_review.md` | `approve`；Required revisions 为空；OBS-1~4（OBS-2 文档同步义务） |
| SA6 验收契约 | `wiki/raw/task_issue-269_sa6_contract.md` | 29 个冻结用例（mapping 9 / abort 5 / observer 6 / support 9）+ H-M/H-D/H-A + R1–R4 + §13.4 哈希 + C5「#268 合入后必须保持绿」 |
| SA4 实现后审查 | `wiki/raw/task_issue-269_sa4_review.md` | `approve`；OBS-A（文档概括句过宽）、OBS-B（实现细节入 Deviations）；残余风险行点名「#268 合入后 C5 与 abort 先于 413」 |
| #269 冻结测试（5 文件） | `packages/namespace-api/test/rest-{failure-contract-harness,registry-failure-mapping-contract,abort-boundary-contract,observer-contract,failure-contract-support}*` | 红灯契约（只读；sha256 已复核，见 E1） |
| Parent PR base（#268）设计/契约/实现 | `wiki/raw/task_issue-268{,_design,_sa6_contract,_sa4_review,_sa3_impl}.md`、`src/request-body.ts`、`src/rest-problem.ts`、`test/rest-create-*.test.ts`、`test/rest-validation-harness.ts` | 冲突两侧语义来源；合入后必须保持绿的 61 个 base 用例 |
| #267 冻结套件 | `test/rest-{create-hub,role-gate-routing,contract-support,public-seam-wiring}*` | 35 个 legacy 用例（保持绿） |
| ADR | `docs/adr/0015`（L103–113 limits、L113 signal、L163–182 错误契约、L186–190 观测） | 只读核对（未修改） |
| SA8 门禁（两轮） | 前序 SA3/SA4 报告转述的 `artifacts/sa8-conflict-report-issue-269{,-design-recheck}.md`（`clear`/`clear`） | 本 worktree 内**不存在**该两文件（见 Deviations D6）；无冲突未决结论 |

## Existing worktree reconciliation

- 起始状态即 **interactive rebase in progress**：`pick 7b40f50`（#269 实现，已应用）→ 待应用
  `c466b16 docs(issue-269): add SA8 conflict-gate reports and dispatch evidence`；onto `209b046`。
  4 个路径 `UU`：`packages/namespace-api/{AGENTS.md,README.md,src/create-namespace.ts,src/rest.ts}`；
  `src/index.ts` 自动合并（#269 的两行 type re-export 已 staged）。
- 前序 SA3 实现报告（`wiki/raw/task_issue-269_sa3_impl.md`，iteration 0）描述的是 **#267 骨架**上的实现；
  本迭代**原位重写**为「rebase 到 #268 base 后的合入实现」，并保留仍然成立的证据。
- 冲突两侧性质：#269 侧把 4xx/422 与 limits 留给「后续票」并按 rejection 结算；Parent base 已把
  `step 3`（owner/query/媒体层）与 `step 4–5`（有界读取 + 严格 UTF-8 + 形状/资源检查 + limits）落地为
  problem Response，且 observer 为「显式注入 + 零发射」。合入必须**同时**满足两侧冻结用例（#269 的 29 +
  base/legacy 的 96 = 125），并按设计 §7.6 保持「读取段内 abort 优先于 413」的排序不变量。

## Conflict resolution

| 路径 | 冲突区域 | 解决（保留两侧，取并集） |
|---|---|---|
| `src/create-namespace.ts` | 头注；imports；step 4/5 vs 最小读取；`registry.create` 前后分叉 | 以 #269 的**对象 deps + T1–T11 映射 + 发射 helper + release diagnostic + 私有 abort 错误类**为骨架；step 4 改为复用 base 的 `readBoundedBodyText`（有界 + 严格 UTF-8）并在其外层保留 #269 的三道 abort 闸门；step 5 形状/资源检查、malformed JSON 400、schemaText 413 与 `deriveSchemaIdentity` 422 分支逐字保留 base 行为；T5（`NAMESPACE_INVALID_IDENTITY` 等未映射窄 issue）保持 fail-loud rejection |
| `src/rest.ts` | 头注切片边界；`RestRouterOptions`；`RestRouterConfig`；`handle` 调用；`resolveLimits` | 保留 base 的 step 1–5 分发（route/method → role → owner/query/媒体层 → orchestration）、`ResolvedRestRouterLimits` 配置与 `resolveLimits` 构造门；采用 #269 的 `RestMetricsEvent`/`RestDiagnosticEvent` 类型、事件化 observer 签名与 deps 传递；`resolveLimits` 跨字段判定按 D1 收敛（见下） |
| `src/index.ts` | 无（自动合并） | #269 的两行 type re-export 保留；未手改 |
| `AGENTS.md` / `README.md` | 切片/延后清单两段 | 合并为单一事实陈述：4xx/422 + limits（#268）与 503/500 + 取消边界 + 双 observer（#269）均已实现；仍延后 = metrics `rejected` 发射策略、5xx body `message`、#270 server 生命周期；并落实 SA4 OBS-A 的概括句修正（metrics 事件口径改为「失败映射拥有的终局路径」+ 明确 4xx/422/403/405 零发射） |

**跨票语义裁决（本次 rebase 的唯一新裁决，D1）**：C5 冻结用例以 `limits: { maxBodyBytes: 16 }`
构造 router，而 base 的跨字段门对**合并默认后的有效值**要求 `maxSchemaTextBytes <= maxBodyBytes`
（默认 schema 上限 256 KiB > 16）⇒ 构造期 `TypeError`，C5 无法到达 abort 判定（首跑实测
`TypeError: limits.maxSchemaTextBytes 不得大于 maxBodyBytes`，rest.ts:196）。两侧冻结断言
（base AC2「两键显式矛盾 → TypeError」与 C5「单键可构造 + aborted 非 413」）必须同时保持，故把
跨字段门收敛为：**两键都显式给出且矛盾 ⇒ TypeError（矛盾指令 fail loud）；只给出一键时，另一键的
默认值按不变量向显式值收敛**（显式 body 上限压缩默认 schema 上限；显式 schema 上限抬升默认 body 上限），
使 ADR 0015 L113 的 `maxSchemaTextBytes <= maxBodyBytes` 对**有效配置恒成立**。未改写任何调用方显式值、
未弱化任何冻结断言、未新增 env override / fallback。

## Current implementation semantics (merged)

1. **失败映射（#269 §7.1）**：`REGISTRY_NOT_ACCEPTING` → 503；`NAMESPACE_CREATE_FAILED` → 500；
   fatal `committed:true` → 500 `NAMESPACE_CREATE_OUTCOME_UNKNOWN`；fatal `committed:false` /
   unknown exception / `NAMESPACE_CREATE_INVALID_INPUT` / `NAMESPACE_ALREADY_EXISTS` → 500
   `INTERNAL_ERROR`（后者 + diagnostic）；未映射窄 issue（`NAMESPACE_INVALID_IDENTITY`）保持 rejection。
   5xx/503 body 为 #269 的最小 `{"code"}` 形状。
2. **请求校验（#268）**：step 3 → 有界读取（`Content-Length` 提前拒绝 + stream byte 上限 + 严格 UTF-8）
   → malformed JSON / 形状 / 数字范围 400、body/schemaText/depth/nodes 413、媒体层 415、
   VFSL schema / ROOT 422（`NAMESPACE_SCHEMA_INVALID` / `NAMESPACE_ROOT_INVALID` 由 base 的 422 映射保留），
   全部经 `rest-problem.ts` 固定 problem shape。
3. **取消边界（#269 §7.3，适配共享 seam）**：读取段三道闸门——①入口同步判定 `signal.aborted`（先于任何
   读取期检查，含 413）；②读取段内被观察到的 abort（共享读取模块自身观察 signal：`reader.cancel()`
   使挂起读有界结算）在读取结算处再核对；③读取胜出后同步再核对。abort ⇒ metrics `{outcome:'aborted'}`
   （无 code/status）+ 零 diagnostic + 有界 rejection（固定 message `ABORTED_BODY_READ_MESSAGE` +
   `signal.reason` 作 cause）+ Registry 零触达。`registry.create` 一经调用零 signal 观察。
4. **观测（#269 §7.4）**：映射拥有的终局路径各恰一 metrics 事件（T1–T4/T6–T8/T10/T11 + T9 aborted）；
   4xx/422 problem 族与 403/405 零发射；diagnostic 仅三类 kind + exact cause 引用；全部经隔离 helper，
   observer throw 不改 HTTP 结果。
5. **成功路径**：DTO 复制 → release 恰一次（失败仍 201 + `lease-release-failure` diagnostic）→
   metrics `succeeded` → 201（无 `Location`）。

## SA2 / SA4 finding 落实

| Finding ID | Implementation | Result |
|---|---|---|
| SA2 Required revisions | 为空（0 BLOCKER / 0 MAJOR） | 无遗留 |
| SA2 OBS-1（§7.4.2 概括句对 T5/body 族不成立） | 实现按 T 表精确口径；本轮文档同步进一步把概括句改为「映射拥有的终局路径」并显式写出 4xx/422/403/405 零发射 | 落实（文档与实现一致） |
| SA2 OBS-2（MINOR：包文档失效表述） | `AGENTS.md`/`README.md` 在合入语义下重写 observers 条目、失败映射条目、取消边界条目、Deferred scope | 落实；无失效表述 |
| SA2 OBS-3（ADR 折入义务属治理面） | 无实现动作（`docs/adr/**` 属 DENY）；在 Deferred verification 登记 | 记录，不阻塞 |
| SA2 OBS-4（malformed JSON × abort） | 读取 seam 在结算处先核对 `signal.aborted`；未被观察为 abort 的 malformed JSON 走 #268 的 400 `MALFORMED_JSON`（零事件、Registry 零触达） | 行为与设计 SM-9 及 #268 契约一致 |
| SA4 OBS-A（文档概括句过宽 + `code` 键表述） | 已按建议改写 `AGENTS.md` observers 条目与 `README.md` Public API 条目：metrics 事件口径限定为「失败映射拥有的终局路径」，并声明 4xx/422 与 403/405 过渡期零事件、`code` 仅非 2xx/非 abort 出现、`status` 仅存在 Response 时出现 | 落实（MINOR，本轮处理） |
| SA4 OBS-B（实现细节集中到 Deviations） | 见 Deviations D2/D3（abort rejection 形状承接 base、读取段复用 base 的单机制） | 落实（MINOR，本轮处理） |
| SA4 残余风险「#268 合入后 C5 与排序不变量」 | C5 实跑转绿（pre-aborted + `maxBodyBytes:16` ⇒ aborted 非 413、零触达、metrics `['aborted']`）；读取 seam 在任何读取期结局返回/抛出前核对 `signal.aborted`；入口判定先于任何读取期校验 | 落实 |

## Changed paths

| Path | Design section | Change |
|---|---|---|
| `packages/namespace-api/src/create-namespace.ts` | §7.1/§7.3/§7.4/§7.6/§7.7/§7.8 | 合入：对象 deps（新增 `limits`）+ T1–T11 映射 + 发射 helper + 最小 `{code}` 5xx/503 + release diagnostic + 私有 abort 错误类（承接 base message/cause）+ 读取 seam 三道闸门复用 base `readBoundedBodyText` + #268 step 5/422 分支保留 |
| `packages/namespace-api/src/rest.ts` | §7.4.1/§7.7 + #268 limits 面 | 合入：保留 base step 1–5 分发与 `resolveLimits`；新增/保留 `RestMetricsEvent`/`RestDiagnosticEvent`、事件化 observer 签名、deps 传递；`resolveLimits` 跨字段收敛（D1）；头注切片边界合并 |
| `packages/namespace-api/src/index.ts` | §7.7 | #269 的两行 type re-export（rebase 自动合并，未手改） |
| `packages/namespace-api/AGENTS.md` | §1 目标 4 + SA2 OBS-2 + SA4 OBS-A | 合入两份 deferral 清单；observers/失败映射/取消边界/延后项重写为单一声明 |
| `packages/namespace-api/README.md` | 同上 | Public API + Deferred scope 合并重写（含 limits 跨字段口径与 C5 不变量） |
| `wiki/raw/task_issue-269_sa3_impl.md` | ALLOW 行 6 同类（SA3 实现报告） | 本报告（原位重写） |

未改动（DENY/范围外）：`packages/namespace-api/test/**`（16 文件字节未变，见 E1/E2）、
`src/request-body.ts`、`src/rest-problem.ts`、`package.json`、`packages/namespace-registry/**`、
`packages/vfsl/**`、`packages/persistence/**`、`docs/adr/**`、`CONTEXT.md`、`docs/protocols/**`。
无 4xx/422/limits 语义的重新实现（沿用 base），无 #268 抢跑改写。

## File scope check

| Changed path | ALLOW entry | Purpose |
|---|---|---|
| `packages/namespace-api/src/create-namespace.ts` | ALLOW 行 1（readRequestBody / 失败映射 / 发射 helper / release diagnostic / 私有 abort 错误类 / 签名扩展） | 合入 #268 读取校验 + 保留 #269 映射与观测 |
| `packages/namespace-api/src/rest.ts` | ALLOW 行 2（observer 类型事件化 / 事件类型定义导出 / observers 传递 / 头注 deferral 更新） | 合入；`resolveLimits` 跨字段收敛为冲突解决必要项（D1） |
| `packages/namespace-api/src/index.ts` | ALLOW 行 3（re-export 两个事件类型） | rebase 自动合并 |
| `packages/namespace-api/AGENTS.md` | ALLOW 行 4（deferral 清单更新 + SA2 OBS-2 失效表述同步） | 合入 + SA4 OBS-A |
| `packages/namespace-api/README.md` | ALLOW 行 5（Public API / Deferred scope 更新 + SA2 OBS-2） | 合入 + SA4 OBS-A |
| `wiki/raw/task_issue-269_sa3_impl.md` | ALLOW 行 6 同类（SA3 报告） | 本报告 |

范围结论：6 个 path，**无 ALLOW 外改动、无 ALLOW 扩张**（未新增 `request-body.ts`/`rest-problem.ts` 的导出或修改）。

## Verification

| # | Command | Result | Evidence |
|---|---|---|---|
| F0 | 冲突标记扫描 `grep -rn "^<<<<<<< \|^>>>>>>> \|^=======$" packages/namespace-api/{src,AGENTS.md,README.md}` | 0 命中（exit 1） | 4 个冲突路径内容已解决 |
| F1 | `NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run --typecheck packages/namespace-api/test`（D1 修复后连跑 8 次；其间仅有包文档文本修订，源码未再变更） | 每次 `Test Files 13 passed (13)`、`Tests 125 passed (125)`、`Type Errors no errors`（exit 0） | 125 = #267 冻结 35 + base(#268) 61 + #269 冻结 29；含 C5（aborted 非 413）、base AC2（显式矛盾 TypeError）、base D6（abort message + cause） |
| F1a | 首次运行（D1 修复前） | `1 failed \| 12 passed`，失败点 = C5 构造期 `TypeError: limits.maxSchemaTextBytes 不得大于 maxBodyBytes`（rest.ts:196） | 证明 D1 是 C5 与 base AC2 的真实冲突面，非测试问题 |
| F2 | `node_modules/.bin/tsc -p packages/namespace-api/tsconfig.json` | exit 0（0 error） | 包源码类型门 |
| F3 | `node_modules/.bin/tsc -p tsconfig.typecheck.json --noEmit` | exit 0（0 error） | `packages/*/src` + `packages/*/test` 类型门（含冻结测试） |
| F4 | `pnpm typecheck`（根，15 包链式 tsc） | exit 0 | 全包源码类型门 |
| E1 | `sha256sum` 5 个 #269 冻结测试文件 | 5/5 与 SA6 §13.4 逐字节一致（harness `14062b3d…`、support `9f9688ab…`、mapping `14465a40…`、abort `2f298a8e…`、observer `dbf8778a…`） | 冻结验收契约未被改写（无 skip/only/todo、无断言弱化） |
| E2 | 逐文件对比工作树与来源提交（`git show <commit>:path \| sha256sum`） | base 11 文件（4 测试 + 1 harness + 6 #268 文件）与 `HEAD`(209b046) 完全一致；#269 5 文件与 `7b40f50` 完全一致 | 两侧冻结测试零改动 |
| E3 | 非 ALLOW 源文件对比 | `src/request-body.ts`、`src/rest-problem.ts`、`package.json` 与 `HEAD` 完全一致 | 无 ALLOW 扩张、无 base 私改 |
| E4 | `git status --short` / `git ls-files -u` / `git diff --stat HEAD -- <4 paths>` | 仅 4 个冲突路径为 `UU`（内容已解决、未 stage）；`git diff --stat` = 4 files, 321 insertions(+), 69 deletions(-) | 范围与 DENY 遵守；未执行 `git add`/`commit`（SA3 边界，见 D5） |

设计方案明确指定的静态生成/check 命令：本票不触碰 VFSL schema 与打包面（无 `schema.vfsl`、
无 `package.json` exports 变更）⇒ 无 `generate --check` / `schema:check` / `pack-local` 义务；
包 AGENTS.md 既有验证入口（F1 + F2/F4）已全部执行。设计 §12 的「17 红转绿」基线属 #267 骨架；
rebase 到 #268 base 后不再存在该红灯态（两侧契约均已实现能力），故以「125/125 全绿 + C5 与 base AC2
同时成立」作为等价证据。

## Deferred verification

- 全仓 `pnpm test` 与其它 package 回归：非 SA3 范围；本票改动面只在 `packages/namespace-api`（仓内无
  其它 consumer，`grep` 仅 ADR 文本提及），该包全套三票契约已全绿。
- **Controller 收尾动作**：4 个 `UU` 路径需 `git add` 后 `git rebase --continue`（SA3 不执行 git 写操作，见 D5）；
  随后待应用 commit `c466b16` 仅新增 4 个文档路径（`artifacts/sa8-conflict-report-issue-269{,-design-recheck}.md`、
  `wiki/raw/task_issue-269.md`、`wiki/raw/task_issue-269_dispatch.md`），与 base 已跟踪路径零重叠
  （`git ls-tree -r HEAD` 实测）⇒ 无二次冲突风险，无源码改动。
- #270（server/composition root）：listener、连接级取消、graceful drain、abort rejection 的公共判别子；
  本实现诚实声明 abort 为有界 rejection（不得记 500 或重试）。
- metrics `rejected` outcome 的发射策略（4xx/422/403/405 族）与 5xx body `message` 字段：后续票加法。
- CI 的 Node 20 腿（SA4 残余风险）：#269 冻结 support 文件钉死 Node 24 平台事实；跨版本平台锚复估属 SA6 修订轮。
- 治理义务（SA8 OBS-R1-1 / SA2 OBS-3）：ADR-0015 经父 PR #158 正式接受时，把 R1（fatal `committed:false`
  → `INTERNAL_ERROR`）、H-A（abort 有界 rejection、无 HTTP status）、R3（读取段内 abort 优先于 413）、
  以及 **L-1 limits 跨字段口径**（两键显式矛盾 TypeError；单键时默认值收敛）折入 ADR 正文或修订节；
  `docs/adr/**` 属本票 DENY，未触碰。

## Deviations or blockers

- **无设计偏离、无阻塞。** 设计 §7.1/§7.3/§7.4/§7.6 在合入语义下逐条成立；两侧冻结契约一行未改、125 项断言全绿。
  以下为实现侧集中披露（SA4 OBS-B 建议）与本轮 rebase 的唯一新裁决：
  - **D1（跨票语义裁决，必要）**：`resolveLimits` 跨字段判定从「合并默认后的有效值矛盾即 TypeError」
    收敛为「两键显式矛盾 TypeError；单键时默认值按不变量向显式值收敛」。理由：C5（冻结）要求
    `{maxBodyBytes: 16}` 可构造，base AC2（冻结）要求 `{1024, 2048}` TypeError；两者只能以「错误门守卫显式
    矛盾指令、派生值按 ADR L113 不变量收敛」同时满足。已在 `rest.ts` 头注、`RestRouterLimits`/
    `RestRouterOptions` 文档与 README 同步；有效配置恒满足 `maxSchemaTextBytes <= maxBodyBytes`。
  - **D2**：abort rejection 形状改为承接 base 的事实（`ABORTED_BODY_READ_MESSAGE` + `signal.reason` 作
    `cause`，类名仍为包内私有 `RestBodyReadAbortedError`、不导出）。#269 H-A 明确 rejection 值形状非契约面
    （唯一公共分类面是 metrics `aborted`），而 base 的 `rest-create-body-read.test.ts` D6 逐字断言该 message+cause。
  - **D3**：读取段不再自建 `Promise.race([request.json(), abort])`，改为复用 base 的
    `readBoundedBodyText`（其内部已观察 signal：abort → `reader.cancel()` → 挂起读有界结算 → abort rejection），
    seam 只负责①/③闸门与 abort 分类/发射。理由：合入后 `request-body.ts` 是 step 4 的单一读取机制，
    再叠一层 race 属平行机制（违反单一路径纪律）；§7.6 要求的排序不变量由「入口判定 + 结算处核对 +
    入口先于任何读取期检查」结构性保证（C5 实跑锁定）。
  - **D4**：`create-namespace.ts` 仍额外导出接口 `CreateNamespaceOrchestrationDeps`（包内私有模块，不进
    `package.json` exports、不被 `index.ts` re-export），并新增 `limits` 字段。
  - **D5（边界声明，非阻塞）**：本迭代**未执行** `git add` / `git commit` / `git rebase --continue`
    （SA3 角色边界：不执行 git 写操作、不 finalize）。4 个路径在工作树中内容已解决且验证通过，
    索引仍标记 `UU`；Controller 需 `git add` 这 4 个路径后 `git rebase --continue`。
    `wiki/raw/task_issue-269_sa3_impl.md` 同理为未提交工作树改动。
  - **D6（输入缺失，非阻塞）**：本 worktree 内不存在 `wiki/raw/task_issue-269.md`（任务简报）与
    `artifacts/sa8-conflict-report-issue-269*.md`；其内容/裁决由前序 SA3/SA4 报告转述
    （SA8 两轮 `clear`、comments 快照空）。未发现影响 ALLOW/DENY、实现行为或红灯契约的信息缺口。

## Suggested commit message

```
fix(#269): REST create 的 Registry 失败语义、取消边界与双 observer 契约（rebase 到 #268 base）

- rebase 冲突解决：保留 #268 的 step 3/4/5 入站校验与 4xx/422 problem shape，
  叠加 #269 的 Registry 失败映射（503 / 500 FAILED / OUTCOME_UNKNOWN / INTERNAL_ERROR）、
  body 读取段取消边界（读取段内 abort 优先于 413）与双 observer 事件契约
- 读取 seam：复用 request-body.ts 的有界读取；入口/结算处两道 signal 核对保证
  abort 分类与 Registry 零触达；abort rejection 承接固定 message + signal.reason
- limits 跨字段口径：两键显式矛盾 → TypeError；单键时默认值按
  maxSchemaTextBytes <= maxBodyBytes 收敛（C5 与 #268 AC2 同时成立）
- 包 AGENTS.md/README 合入两份 deferral 清单并修正 metrics 事件概括句（SA4 OBS-A）
```
