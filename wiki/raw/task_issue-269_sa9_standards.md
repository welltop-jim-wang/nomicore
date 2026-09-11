# SA9 标准审查报告 — Issue #269：REST create 的 Registry 失败语义、取消边界与双 observer 契约（rebase 后复审）

> 阶段：standards-review（SA9，**iteration 1 — 对 rebase 后交付的复审**）。派发：`sa-1fb557bf-316c-4389-b585-78f7bd382b95`（mabf-sa9）。
> **Verdict：approve**（0 BLOCKER / 0 MAJOR；3 条 MINOR 非阻断观察，§10）。
> 审查对象：worktree `/home/wangjian/nomicore-fix-issue-269`，branch `mabf/issue-269`，HEAD
> `c739770ff90a8d06ce8bba35dfd25d514cd7994c`（docs-only）；实现 commit `25b41dc`
> （`feat(namespace-api): map REST create failures`）rebase 在 Parent PR 当前 base `209b046`
> （`feat(namespace-api): validate REST namespace creation (#297)`，即 #268 落地内容）之上——
> **本次审查重点含对 base 的语义冲突解决（SA3 D1–D4）**。
> 本报告**原位重写** iteration 0 的 SA9 报告（其对象为 #267 骨架上的未提交 diff，HEAD `0b06050`）；
> 全部行号/哈希锚点按合入后源码重测。
> Issue-comment REST snapshot 为空（dispatch 明示；SA8 两轮/SA6/SA3/SA4 多源一致）——无 owner 评论级要求。
> 方法：纯静态独立复核（读 issue 正文、ADR、设计/SA2/SA3(iter1)/SA4/SA6/SA8 产物、合入实现全文、
> 两侧冻结测试、`git diff`/sha256/grep 实测）；未修改任何代码/设计/测试，未运行测试，未启动服务。
> 审查口径：只判断**标准与仓库质量**（AGENTS/ADR/模块责任/惯例/单一事实源/生命周期对称性/文件范围/
> 测试质量/冲突解决的忠实性）；Issue 需求完整实现属 SA10（其 iteration-1 `approve` 产物已存在于
> `wiki/raw/task_issue-269_sa10_spec.md`，结论独立、不构成本评审输入依赖）。

---

## 1. 审查输入与证据链

| 输入 | 位置 | 状态 |
|---|---|---|
| 任务简报（issue body + AC1–AC6，Comments 空） | `wiki/raw/task_issue-269.md`、`task_issue-269_dispatch.md` | 已读 |
| SA1 设计 | `wiki/raw/task_issue-269_design.md` | 已全文读（§7.1 T1–T11/§7.3/§7.4/§7.6/§11 ALLOW-DENY） |
| SA2 设计评审 | `wiki/raw/task_issue-269_sa2_review.md` | `approve`（0 BLOCKER/MAJOR；OBS-1~4） |
| SA3 实现报告（iteration 1，rebase 版） | `wiki/raw/task_issue-269_sa3_impl.md` | 已全文读；冲突解决表、D1–D4、F0–F4/E1–E4 声明与实测逐项吻合（§8/§9） |
| SA4 实现审查（iteration 0） | `wiki/raw/task_issue-269_sa4_review.md` | `approve`（OBS-A/B） |
| SA6 冻结契约 | `wiki/raw/task_issue-269_sa6_contract.md` + 5 测试文件 | sha256 5/5 实测逐字节一致（§9） |
| SA8 门禁两轮 | `artifacts/sa8-conflict-report-issue-269{,-design-recheck}.md` | clear / clear（均针对 rebase 前设计；rebase 后无新门禁，见 §10-MINOR-1） |
| Parent base（#268）产物 | `wiki/raw/task_issue-268{,_design,_sa6_contract,_sa4_review,_sa9_standards}.md` | 已读 D4/H8/§15 裁决点（§5 专项） |
| 合入实现源码 | `packages/namespace-api/src/{create-namespace,rest,index,request-body,rest-problem}.ts` | 全文读 + `git diff 209b046..25b41dc` 与 `git diff 7b40f50..25b41dc` 逐行 |
| 包契约文档 | `packages/namespace-api/{AGENTS.md,README.md}` | diff 逐行 |
| 规范基准 | 根 `AGENTS.md`、包 `AGENTS.md`、ADR 0015/0009/0010/0012、`CONTEXT.md`、根 `vitest.config.ts` | 已读并核对 |
| ADR-0015 锚定 | rebase 未触碰 `docs/adr/**`（`git diff 209b046..HEAD` 零命中） | ✅ |

---

## 2. 仓库 AGENTS 合规

| 条款 | 核验（合入后实测） | 结论 |
|---|---|---|
| 模块指导（改动前读最近嵌套 AGENTS.md 并守其边界） | 包 `AGENTS.md` Boundaries 逐条核验：create-namespace.ts 保持包私有（`package.json` exports 实测恰 `.`/`./rest`，未动；`index.ts` 只 re-export 六个公共类型/`createRestRouter`，未 re-export 编排或 `ResolvedRestRouterLimits`/`CreateNamespaceOrchestrationDeps`；grep 实测测试零私有模块 import）；构造 TypeError 门与双 observer 显式注入保持（rest.ts L301–325）；role 单真相零触碰（L307–309 不变）；固定顺序未 reorder（route→method→role→step3→step4/5→derive→create→DTO→release→201，L336–391 + create-namespace.ts L227–331）；201 恰两键/无 Location/release 失败仍 201 逐字保持 | ✅ |
| 冻结验收契约纪律（「do not edit it to accommodate an implementation」） | #269 五文件 sha256 = SA6 §13.4 逐字节（§9）；base(#268) 6 文件 + #267 legacy 5 文件与 `209b046` 逐字节一致（11/11 SAME，§9）；两侧契约零改写 | ✅ |
| Typed Namespace writes 强制条款 | 不适用：经 `Registry.create({owner,schema,root})` 公共创建 API（恰三键，L262–265），非 `mutateData()` 写路径；无 `any`/cast 散布、无 live Y.Doc、无 snapshot 编辑 | ✅（不适用，无违反） |
| Third-party plugin hosting / Cordis | 不适用：普通 Module、非 plugin（rest.ts L4–7 保持该表述） | ✅ |
| Instance replication（ADR 0010/protocols） | 零触碰；README/AGENTS 保持「新 namespace 保持 replication-disabled」表述 | ✅ |
| Namespace diagnostic change log（ADR 0011/0014） | 不适用但同向：grep 实测 `packages/namespace-api/{src,test}` 无 `diagnostic-log` 引用；「emit never throws」纪律经 `emitMetrics`/`emitDiagnostic` helper 复用（create-namespace.ts L136–156） | ✅ |
| `docs/AGENTS.md`「行为变更须同步全部规范性文档」 | 合入后包 AGENTS.md/README 已重写为两票合一的单一事实陈述（deferral 清单合并、observers/失败映射/取消边界条目与实现一致；`docs/adr/**` 未触碰——ADR-0015 状态治理归父 PR #158，DENY 遵守）；`CONTEXT.md` 无新域术语（事件 kind/code/outcome 均为 ADR 0015 既有词汇） | ✅（措辞精度见 §10-MINOR-2/3） |

## 3. ADR 合规（合入后行号实测）

| ADR 条款 | 实现锚点 | 结论 |
|---|---|---|
| 0015 L113（body 读取尊重 `Request.signal`、中断后 Registry 零触达；调用后等待 settle 并 release） | 共享 seam 三道闸门（create-namespace.ts L193 入口同步判定 → L195 委托 `readBoundedBodyText`［其内部 L51/L67–72/L81/L84 观察 signal］→ L196/L200 结算处再核对）；接纳点（L262–266）后源码零 `signal` 读取（grep 实测 signal 仅出现于 L192–208 与注释/私有类）；`await lease.release()` 恰一次（L316） | ✅ |
| 0015 L113 排序不变量（读取段内 abort 优先于 413，R3/C5） | 入口判定先于 `readBoundedBodyText` 内任何读取期检查（含 Content-Length 413 早拒，request-body.ts L54–60）；读取循环内 aborted 判定（L84）先于 byte 超限判定（L89）；seam catch（L198–202）把「读取失败且 signal 已 aborted」统一归 abort——三层结构性保证 abort 优先 | ✅ |
| 0015 L150–159 固定执行顺序 | 未 reorder；step 3（owner/query/媒体层，rest.ts L353–379）在 step 4 之前保持 base 冻结顺序 | ✅ |
| 0015 L161（release 失败仍 201、diagnostic 上报 owner/namespaceId/exact cause、不重复调用） | L315–325：catch 仅发射 `lease-release-failure`（cause=release 异常引用、namespaceId=release 前 DTO 副本 string）后仍 201；无重试无二次调用 | ✅ |
| 0015 L175–178 失败映射四分支 | T1 503 逐字 code（L293–294）；T2 500 FAILED（L295–296）；T6 committed:true → OUTCOME_UNKNOWN（L278–279）；T7 committed:false → INTERNAL_ERROR（L280，R1）；T8 unknown → INTERNAL_ERROR（L282–283） | ✅ |
| 0015 L180（INVALID_INPUT/ALREADY_EXISTS → 安全 500 + diagnostic） | L297–302：合并分支 → `unknown-exception` diagnostic（cause=issue 对象引用）+ 500 `INTERNAL_ERROR`；`NAMESPACE_ALREADY_EXISTS` 不透传 | ✅ |
| 0015 L182（不发明重试/幂等面） | 未发明 `Retry-After`/Idempotency-Key/自动重试；`NAMESPACE_INVALID_IDENTITY` 保持 fail-loud rejection（L303–305），不抢跑 | ✅ |
| 0015 L186（双 observer 显式注入、throw 隔离） | 构造门 `typeof === 'function'` 不变（rest.ts L318–325）；全部发射点（L172/L207/L270–277/L282/L301/L319–324/L326）一律经同步 try/catch helper，无裸调用（grep 实测） | ✅ |
| 0015 L188（metrics 低基数、无敏感字段） | `RestMetricsEvent` 键集恰 `{operation, outcome, code?, status?}`（rest.ts L61–68）；operation 恒 `'namespace-create'`（L104）；无 owner/namespaceId/issues/schema/root/cause | ✅ |
| 0015 L190（diagnostic 三类 kind、exact cause、不带 schema/root/完整 issues；Host 负责访问控制/采样/脱敏） | `RestDiagnosticEvent` 三类 kind + `cause: unknown` exact 引用（rest.ts L85–93）；operation/phase/committed 仅 registry-fatal、namespaceId 仅 lease-release-failure；无 `issues` 键；Host 义务写入类型注释（L83）与 README，未挪进 router | ✅ |
| 0015 L103–113 limits（七默认值、Partial 覆盖、未知键/越界 TypeError、跨字段不变量） | 默认值逐字（rest.ts L137–145）；白名单/正安全整数门不变（L182–203）；跨字段不变量 `maxSchemaTextBytes <= maxBodyBytes` 对**有效配置恒成立**——判定口径经 D1 收敛（§5 专项）；冻结有效值（L217） | ✅（判定口径变化见 §5/§10-MINOR-1） |
| 0015 L165/完整 problem shape 归属 | 5xx body 保持最小 `{code}`（errorResponse L162–174）；4xx/422 固定 problem shape 沿用 base `rest-problem.ts`，零重新实现 | ✅ |
| ADR 0012 role 单真相 | 零触碰；无第二 role 源 | ✅ |
| ADR 0009/0010 Registry 语义 | 零触碰（diff 范围外）；判别输入全部公共面（窄 code switch / `instanceof NamespaceRegistryFatalError` + `.committed` / catch-all） | ✅ |

## 4. 模块责任

| 行为 | 应有归属 | 实际位置（合入后） | 结论 |
|---|---|---|---|
| HTTP 失败投影（503/500 code/status/body/metrics 分类） | REST Adapter | `create-namespace.ts`（包私有） | ✅ Registry 语义零改动 |
| committed 事实 | Registry（唯一事实源） | REST 只读 `fatal.committed`（L278），不从 phase 推断、无影子字段 | ✅ |
| abort 观察/读取机制 | 共享读取 seam：signal 语义 #269、有界读取机制 #268 | seam（create-namespace.ts L187–203）只做三道闸门与 abort 分类/发射；读取机制单一复用 base `readBoundedBodyText`（D3）——**无第二读取路径、无平行 race** | ✅ |
| 4xx/422/limits 执行 | #268（base 已落地） | 原样复用 base 的 `request-body.ts`/`rest-problem.ts`/step 3–5 分发；两文件零 diff（§8） | ✅ |
| listener/装配/连接生命周期 | 未来 server（#270） | abort 以有界 rejection 结算、不伪造 HTTP status；`RestBodyReadAbortedError` 私有不导出（L115 无 export）；rejection message/cause 承接 base 既约事实（D2） | ✅ |
| 访问控制/采样/脱敏 | Host | 类型注释 + README 明示，router 不承担 | ✅ |

## 5. 语义冲突解决专项（dispatch 点名：rebase 对 Parent PR base 的冲突解决）

冲突两侧与解决（SA3 冲突解决表 + D1–D4）逐条独立复核：

| # | 裁决 | 复核 | 结论 |
|---|---|---|---|
| D1 | `resolveLimits` 跨字段门从「合并默认后的有效值矛盾即 TypeError」收敛为「两键显式矛盾 TypeError；单键时默认值按不变量向显式值收敛」 | **冲突真实性**：base 实现（`git show 209b046:rest.ts` 实测）对合并后有效值判定，`{maxBodyBytes:16}` 会因默认 schema 上限 256 KiB > 16 而构造 TypeError；#269 冻结 C5（sha256 实测逐字节一致）以 `limits:{maxBodyBytes:16}` 构造并要求 aborted 非 413。SA3 F1a 首跑失败（C5 构造期 TypeError）与此推导一致——冲突真实。**解决正确性**：收敛后两键显式矛盾仍 TypeError（base AC2 `{1024,2048}` 拒 / `{1024,1024}` 允，rest.ts L206–209 实测满足）；单键收敛使 ADR L113 不变量对有效配置恒成立（bodyExplicit → `min` 压缩 schema 上限 L210–212；schemaTextExplicit → `max` 抬升 body 上限 L213–215）；C5 构造路径静态推导可达 gate①（harness `jsonRequest` 带 `content-type: application/json`，过 step 3；pre-aborted → abortSettle，零触达、非 413）。**未弱化任何冻结断言、未新增 env override/fallback、确定性、文档同步**（rest.ts L37–41/L113/L165–175、README L9、AGENTS.md 对应条目一致）。**偏离披露**：#268 设计 D4 曾采纳「合并默认后的有效值」读法（其 SA6 §15 裁决点 4 预留「若设计采用只校验显式给出的键，须补充/回写边界用例」）；D1 实为该预留情形的触发，但未走 #268 修订轮、未补边界用例——见 §10-MINOR-1 | 必要且忠实（治理残余见 MINOR-1） |
| D2 | abort rejection 形状承接 base 既约事实（`ABORTED_BODY_READ_MESSAGE` + `signal.reason` 作 cause），类名私有不导出 | `rest-create-body-read.test.ts` D6 逐字断言该 message（L98/L113 实测）；harness/契约对 rejection 值形状不作私有类判别（H-A 明示非契约面）；message 常量单一来源（request-body.ts L20 定义、create-namespace.ts L53 import——无第二份字符串） | ✅ |
| D3 | 读取段不自建 `Promise.race`，复用 base `readBoundedBodyText`（其内部已观察 signal：`reader.cancel()` 使挂起读有界结算） | base 读取器 aborted 判定先于超限判定（request-body.ts L84 vs L89），监听器 add↔finally remove 对称（L72/L98）；seam 保留入口/结算两道闸门与 abort 分类——排序不变量结构性成立（§3 L113 行）；「读返回→`registry.create` 之间仅同步代码」实测成立（JSON.parse/`assertTopLevelShape`/`utf8ByteLength`/`assertPostParseResourceLimits`/`deriveSchemaIdentity`/envelope 组装全同步，L228–259）；单一读取机制，无平行路径 | ✅ |
| D4 | `CreateNamespaceOrchestrationDeps` 从私有模块 export 并新增 `limits` 字段 | 模块包私有性由 `package.json` exports 结构性保证（实测恰 `.`/`./rest`）；不被 `index.ts` re-export（实测）；唯一调用方 rest.ts 同票更新 | ✅ |

**base 行为保持**：step 3/4/5 的 4xx/413/415/422 与 limits 执行、`RestProblemFailure` 通道、
malformed JSON 通用 400（不透传平台 SyntaxError 位置）逐字沿用 base；`NAMESPACE_SCHEMA_INVALID` /
`NAMESPACE_ROOT_INVALID` 的 422 映射（L287–292）为 base 语义保留。#269 叠加面（T1–T4/T6–T8 映射、
abort 结算、双 observer 事件、release diagnostic）与 rebase 前经 SA4/SA9(iter0) 批准的实现逐分支同构
（`git diff 7b40f50..25b41dc` 实测：映射/发射/释放段零语义变化，仅读取 seam 与 4xx 族结算方式随 base 替换）。

## 6. 既有架构惯例

- **最小 problem body**：`errorResponse` 与 base 403/405（经 `rest-problem.ts` 的固定形状）同族；5xx 保持 `{code}` 最小面，未发明 message/issue 投影。✅
- **observer 隔离先例**：`emitMetrics`/`emitDiagnostic` 与 registry.ts `dispatchObserver` 同向纪律（同步 try/catch、隔离不改业务结局）；helper 化使全分支隔离成为结构保证。✅
- **构造惯例**：读取 → 校验 → 复制 → 冻结（rest.ts L300–334）；`resolveLimits` 保持 plain `TypeError`（无 branded 错误发明）、白名单 + 正安全整数门 + 冻结；router 构造后零状态。✅
- **类型面惯例**：事件类型定义于公共 `rest.ts`、`index.ts` type re-export；`create-namespace.ts` 以 `import type` 反向引用（L58）——类型环安全擦除，运行时依赖保持单向。✅
- **公共面扩张克制**：exports 白名单未动；新增导出仅两个事件类型经既有入口流出。✅
- **头注纪律**：两源文件头注重写为三票合一事实（切片边界、取消边界、观测口径），无残留「延后至 #269」失效表述；base 私有模块头注（request-body.ts/rest-problem.ts）未动且仍准确。✅
- **TS 兼容惯例**：observer 签名事件化为类型层加法；#267 冻结零参 `NOOP_OBSERVER` 按少参可赋值规则保持编译（SA3 F1/F3 的 `--typecheck` 0 error 证据）。✅

## 7. 单一事实源与生命周期对称性

| 事实 | 唯一来源 | 结论 |
|---|---|---|
| committed | `NamespaceRegistryFatalError.committed`（REST 零复制零推断） | ✅ |
| metrics `code` | 与 response body code 同源（同一 `errorResponse` 调用点构造，发射与返回原子） | ✅ |
| owner | route 捕获段 → 单一 `Object.freeze` 对象（L224），Registry 输入与 diagnostic 事件共享同一不可变引用 | ✅ |
| namespaceId | Registry lease → release 前 DTO string 副本 | ✅ |
| abort message/cause | `ABORTED_BODY_READ_MESSAGE`（request-body.ts 单点定义）+ `signal.reason`；seam 与读取器双通道同形 | ✅ |
| limits 有效值 | `DEFAULT_LIMITS` 单点 + `resolveLimits` 单点收敛；config 冻结后 handle 零解引用失败可能 | ✅ |
| 事件形状 | `RestMetricsEvent`/`RestDiagnosticEvent` 单一定义点（rest.ts） | ✅ |

| 获取/开始 | 释放/结束 | 结论 |
|---|---|---|
| abort 监听器（request-body.ts L72，once） | `finally` 无条件 removeEventListener（L98） | ✅ 对称（seam 自身零监听器——D3 后读取器全权拥有） |
| lease acquire（create 成功） | 恰一次 `await lease.release()`；失败不重试不二次调用 + diagnostic | ✅ |
| 构造校验 | plain `TypeError` fail loud；无部分构造资源 | ✅ |
| 定时器/队列/worker/缓存 | 无新增；router 构造后零状态 | ✅ |

## 8. 文件范围

`git diff 209b046..HEAD --stat` 实测：两 commit 共 21 文件——5 个包源/文档文件
（create-namespace.ts/rest.ts/index.ts/AGENTS.md/README.md，323+/69−）+ 5 个 SA6 冻结测试新增 +
11 个 wiki/artifacts 文档件。工作树 clean（`git status --porcelain` 空，exit 0）；无冲突标记
（`<<<<<<<`/`=======`/`>>>>>>>` 扫描 0 命中）；`git diff --check 209b046 HEAD` 零输出。

| 检查 | 实测 | 结论 |
|---|---|---|
| ALLOW 遵守 | 5 个实现文件与设计 §11 ALLOW 逐行对应；rebase 必要的合并语义（读取 seam 复用、limits 接线、D1 收敛）已作为 D1–D4 在 SA3 Deviations 集中披露——D1 的 `resolveLimits` 语义收敛超出原 ALLOW 行 2 的枚举目的，属 rebase 冲突解决的必要扩张，透明披露而非静默 | ✅（披露充分；治理残余 §10-MINOR-1） |
| DENY 遵守 | `test/**` 既有 11 文件与 base 逐字节一致；`namespace-registry/**`、`vfsl/**`、`persistence/**`、`package.json`、`docs/adr/**`、`CONTEXT.md`、`docs/protocols/**` 零改动；`request-body.ts`/`rest-problem.ts` 与 base 零 diff（未改 base 私有实现、未新增其导出消费面） | ✅ |
| 无 scope creep | 未发明 `Retry-After`、abort HTTP status、5xx message、第二读取路径、新公共子路径；未重新实现任何 4xx/422/limits 语义 | ✅ |

## 9. 测试质量标准

| 检查 | 实测 | 结论 |
|---|---|---|
| #269 冻结完整性 | 5 文件 sha256 = SA6 §13.4 逐字节（harness `14062b3d…` / support `9f9688ab…` / mapping `14465a40…` / abort `2f298a8e…` / observer `dbf8778a…`） | ✅ |
| base/legacy 冻结完整性 | 11 文件（#268 六件 + #267 五件）与 `209b046` 逐一 sha256 SAME | ✅ |
| 无弱化 | 全测试目录 grep 零 `.skip`/`.only`/`.todo` | ✅ |
| 行为级断言 | 断言 HTTP status/body code/content-type、observer 实参（键白名单/词表/哨兵/引用相等）、Registry seam 触达计数、release 计数与 lease 状态；无源码文本断言（SA4 §9 结论在合入后仍成立：测试字节未变） | ✅ |
| 计数口径 | `it(` 计数 mapping 9 + abort 5 + observer 6 + support 9 = 29，与 SA6 一致 | ✅ |
| runner 入口真实性 | 根 `vitest.config.ts` include `packages/*/test/**/*.test.ts` 覆盖新文件；harness 非 `.test.ts` 不被收集；SA3 F1 报告 `vitest run --typecheck` 125/125 绿 ×8（35 legacy + 61 base + 29 #269）、F2–F4 tsc 0 error——SA9 纪律不复跑，动态证据以 SA3 声明 + 本评审静态语义核验（§5 C5 推导、发射矩阵逐分支核对）为准 | ✅（静态可证部分全部成立） |
| 合入后断言相容性 | D6 跨分支矩阵计数（1 succeeded/1 unavailable/5 failed/1 aborted）与合入实现逐路径对上（T1–T4/T6–T8 经 `errorResponse`、T9 经 `abortSettle`、T10/T11 成功点；4xx/422/403/405 零发射）；base D6 的 abort message/cause 断言与 D2 承接一致；C5 构造路径与 D1 收敛一致（§5） | ✅ |

## 10. Findings

无 BLOCKER、无 MAJOR。MINOR 三条（均不阻断 approve）：

| ID | 级别 | 观察 | 建议 |
|---|---|---|---|
| MINOR-1（本轮新增，治理面） | MINOR | D1 收敛是对 #268 已批准设计 D4「合并默认后的有效值判定」读法的语义替换。#268 SA6 契约 §15 裁决点 4 为该情形预留的救济是「补充/回写边界用例」；本轮未走 #268 修订轮、未新增钉死收敛后有效值的边界用例（C5 仅钉 `{maxBodyBytes:16}` 可构造 + abort 行为，base AC2 仅钉两键显式矛盾；收敛后的有效值如 schema 上限被压缩至 16 无直接断言）。两侧冻结断言零弱化、ADR L113 不变量对有效配置恒成立、活文档（包 AGENTS.md/README/rest.ts 头注）三处一致；陈旧表述仅存于 #268 的历史设计/评审件（`task_issue-268_design.md` D4、`task_issue-268_sa4_review.md` L73/L89 的「`{maxBodyBytes:64}` 亦拒」），设计文档按迭代存档属历史记录，不构成活契约矛盾 | 经 #268 修订轮或 ADR-0015 接受时的折入（SA3 Deferred verification 已登记 L-1 口径）正式化 D1；后续契约修订轮补「单键收敛后有效值」边界断言；SA8 对 rebase 后语义可做一轮确认门禁 |
| MINOR-2（承 iter-0 SA9 MINOR-2，仍未落实） | MINOR | README L12「（**后两者**上报 diagnostic）」与 AGENTS.md「(**the latter** with a diagnostic report)」对 diagnostic 覆盖面欠述：实现中 fatal 两分支（committed:true → OUTCOME_UNKNOWN 与 committed:false → INTERNAL_ERROR）同样先发射 `registry-fatal` diagnostic（L270–277 实测），并非只有 unknown/违例分支上报。方向为保守欠述（实现多于文档所述），非危险夸大；同一文档 observer 条目（至多一个、三类 kind）与冻结契约（B3/B4/D5(a)(b)）锁定真实行为 | 后续文档修订轮把映射条补为「四类 5xx 结局均在 Response 前发射对应 diagnostic（503/FAILED 除外）」或等价精确表述 |
| MINOR-3（本轮新增，措辞级） | MINOR | `create-namespace.ts` 头注观测段仍写「**每请求**恰一个低基数 metrics 事件」，对 403/405/未匹配/4xx/422/unmapped 路径不成立（同段下一句已限定「4xx/422 零发射」，AGENTS.md/README 已用精确口径「失败映射拥有的每条终局路径」——源码头注未同步该修正） | 后续文档修订轮把头注改为「失败映射拥有的终局路径与成功/abort 结算恰一事件；4xx/422 与 403/405 过渡期零事件」 |

## 11. 结论

Rebase 后的 #269 交付符合仓库 AGENTS（根/包两级）、ADR 0015（L103–113/L150–161/L175–182/L186–190
逐条实测）与 ADR 0009/0010/0012（零触碰）；模块责任归位正确（HTTP 投影归 Adapter、committed 归
Registry、读取机制单一共用、4xx/422 归 base、server 面归 #270、脱敏归 Host）；对 Parent PR base 的
语义冲突解决（D1–D4）真实、必要、透明披露且双侧冻结契约逐字节保持；既有惯例（最小 problem body、
observer 隔离、构造冻结、类型面/导出面克制、头注纪律、TS 加法兼容）全部保持；单一事实源与生命周期
对称性无缺口；文件范围零越界（D1 属披露的冲突解决必要扩张）；测试质量达仓内标准。
三条 MINOR 均为治理/措辞级残余（D1 的修订轮正式化、diagnostic 覆盖面欠述、源码头注概括句），不影响
代码正确性、冻结契约或合并安全性。**Verdict：approve。**

---

*证据边界：本评审为纯静态（read/grep/git diff/git show/sha256sum/git diff --check）；未修改任何实现、设计或测试；未运行测试/服务/临时进程；未调度其他 SA。本报告为 SA9 唯一产物（`wiki/raw/task_issue-269_sa9_standards.md`，iteration 1 原位重写）。*
