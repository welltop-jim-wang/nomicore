# SA9 标准审查报告 — Issue #269：REST create 的 Registry 失败语义、取消边界与双 observer 契约

> 阶段：standards-review（SA9，iteration 0）。派发：`sa-ec4b2c8c-8ec6-4ea4-b2b6-df1d068a20b7`（mabf-sa9）。
> **Verdict：approve**（0 BLOCKER / 0 MAJOR；2 条 MINOR 非阻断观察，§10）。
> 审查对象：worktree `/home/wangjian/nomicore-fix-issue-269` 当前未提交 diff（branch `mabf/issue-269`，
> HEAD `0b06050d9518c66ef166751064c95ed9557c9532` = 父 PR #158 base `docs/rest-namespace-create`，
> 实测一致）。改动面 = 5 个 tracked 文件 modified（289+/49−）；SA6 冻结测试 5 文件 untracked 新增。
> Issue-comment REST snapshot 为空（dispatch/SA8/SA6/SA3/SA4 多源一致）——无 owner 评论级要求。
> 方法：纯静态独立复核（读 issue 正文、ADR、设计/SA2/SA3/SA4/SA6/SA8 产物、实现全文、冻结测试、
> `git diff`/sha256/grep 实测）；未修改任何代码/设计/测试，未运行测试，未启动服务。
> 审查口径：本评审只判断**标准与仓库质量**（AGENTS/ADR/模块责任/惯例/单一事实源/生命周期对称性/
> 文件范围/测试质量）；Issue 需求完整实现属 SA10（其 `approve` 产物已存在于
> `wiki/raw/task_issue-269_sa10_spec.md`，结论独立、不构成本评审输入依赖）。

---

## 1. 审查输入与证据链

| 输入 | 位置 | 状态 |
|---|---|---|
| 任务简报（issue body + AC1–AC6，Comments 空） | `wiki/raw/task_issue-269.md`、`task_issue-269_dispatch.md` | 已读 |
| SA1 设计 | `wiki/raw/task_issue-269_design.md` | 已全文读（§7.1 T1–T11/§7.3/§7.4/§7.6/§7.7/§7.8/§11 ALLOW-DENY） |
| SA2 设计评审 | `wiki/raw/task_issue-269_sa2_review.md` | `approve`（0 BLOCKER/MAJOR；OBS-1~4） |
| SA3 实现报告 | `wiki/raw/task_issue-269_sa3_impl.md` | 已读；B0/V1–V4/E1/E2 声明与工作树实测逐项吻合 |
| SA4 实现审查 | `wiki/raw/task_issue-269_sa4_review.md` | `approve`（0 BLOCKER/MAJOR；OBS-A/B） |
| SA6 冻结契约 | `wiki/raw/task_issue-269_sa6_contract.md` + 5 测试文件 | sha256 5/5 实测逐字节一致（§9） |
| SA8 门禁两轮 | `artifacts/sa8-conflict-report-issue-269{,-design-recheck}.md` | clear / clear |
| 实现源码 | `packages/namespace-api/src/{create-namespace,rest,index}.ts` | 全文读 + `git diff` 逐行 |
| 包契约文档 | `packages/namespace-api/{AGENTS.md,README.md}` | diff 逐行 |
| 规范基准 | 根 `AGENTS.md`、`docs/AGENTS.md`、包 `AGENTS.md`、ADR 0015/0009/0010/0012、`CONTEXT.md`、根 `vitest.config.ts`、`.github/workflows/ci.yml` | 已读并核对 |
| ADR-0015 锚定 | blob `64daa16a43ef2718f7f8d692f77a82ac7517e341`、sha256 `3a75f99b…148` | 本次 `git hash-object`/`sha256sum` 实测逐字一致；ADR 文本未被本票触碰 |

---

## 2. 仓库 AGENTS 合规

| 条款 | 核验 | 结论 |
|---|---|---|
| 模块指导（改动 `packages/` 前读最近嵌套 AGENTS.md 并守其边界） | 包 `AGENTS.md` 全部 Boundaries 逐条核验：create-namespace.ts 保持包私有（未进 `package.json` exports——实测 exports 恰 `.`/`./rest`；未被 `index.ts` re-export；grep 实测**测试也不 import 该私有模块**，纯经公共 seam 断言）；构造 TypeError 门与双 observer 显式注入保持（rest.ts L171–195）；role 单真相未触碰；固定顺序未 reorder（gates diff 仅头注与 orchestration 调用形态）；201 形状/无 Location/release 语义逐字保持 | ✅ |
| 冻结验收契约纪律（包 AGENTS.md「do not edit it to accommodate an implementation」） | 5 个 SA6 冻结文件 sha256 与 §13.4 逐字节一致；#267 tracked 4 测试文件 `git diff` 为零 | ✅ |
| Typed Namespace writes 强制条款 | 不适用：本票经 `Registry.create({owner,schema,root})` 公共创建 API（ADR 0015 既定垂直切片），非 `NamespaceLease.mutateData()` 写路径；无 `any`/cast 散布、无 live Y.Doc 访问、无 snapshot 编辑 | ✅（不适用，无违反） |
| Third-party plugin hosting / Cordis | 不适用：router 是普通 Module、非 Cordis plugin（rest.ts 头注明示），无插件装配变更 | ✅ |
| Instance replication（ADR 0010/protocols） | 零触碰：无复制/认证/wire frame/状态机改动；新 namespace 保持 `replication-disabled`、router 不触碰复制身份（README/AGENTS 保持该表述） | ✅ |
| Namespace diagnostic change log（ADR 0011/0014） | 不适用但同向：REST observer 事件是 ADR 0015 §Observability 面，与 namespace 级诊断日志相互独立；grep 实测 `packages/namespace-api/{src,test}` 无 `diagnostic-log` 任何引用，零交叉污染；「emit never throws」纪律一致复用（§5） | ✅ |
| Git worktrees（仓内 `.worktrees/`） | 环境/流程事项，非本 diff 面；不构成本票标准缺口 | ✅（不适用） |
| `docs/AGENTS.md`「行为变更须同步全部规范性文档」 | 包 AGENTS.md/README 已同步重写（SA2 OBS-2 落实）；ADR-0015 文本未变（其实现化而非改约，接受治理归父 PR #158，DENY 遵守）；`CONTEXT.md` 无新域术语需登记（事件 kind、错误 code、outcome 词表全部为 ADR 0015 既有词汇；`namespace-create` operation 常量为实现级标签） | ✅（精度见 §10-MINOR-1/2） |

## 3. ADR 合规

逐条实测（实现行号为本次读取实测）：

| ADR 条款 | 实现锚点 | 结论 |
|---|---|---|
| 0015 L113（body 读取尊重 `Request.signal`、中断后 Registry 零触达；调用后等待 settle 并 release） | `readRequestBody` 三道闸门（L132 入口同步判定 → L142 race → L143 胜出再核对）；接纳点后源码零 `signal` 读取（grep 实测 signal 仅出现于 readRequestBody 与注释）；`await lease.release()` 恰一次（L244） | ✅ |
| 0015 L150–159 固定执行顺序 | route→method→role→owner→body→derive→create→DTO→release→201 未 reorder（rest.ts L206–233 + create-namespace.ts L174–259） | ✅ |
| 0015 L161（release 失败仍 201、diagnostic 上报 owner/namespaceId/exact cause、不重复调用） | L245–253：diagnostic `lease-release-failure`（cause=release 异常引用、namespaceId=release 前 DTO 副本 string）后仍 201；无重试无二次调用 | ✅ |
| 0015 L175–178 失败映射四分支 | T1 503 逐字 code（L221–222）；T2 500 FAILED（L223–224）；T6 committed:true → OUTCOME_UNKNOWN（L212–213）；T7 committed:false → INTERNAL_ERROR（L214，R1 填补 ADR 欠规格分支，SA8 OBS-2 授权链完整）；T8 unknown → INTERNAL_ERROR（L216–217） | ✅ |
| 0015 L180（INVALID_INPUT/ALREADY_EXISTS 为内部契约违例 → 安全 500 + diagnostic） | L225–230：合并分支 → `unknown-exception` diagnostic（cause=issue 对象引用）+ 500 `INTERNAL_ERROR`；`NAMESPACE_ALREADY_EXISTS` 不透传 | ✅ |
| 0015 L182（不发明重试/幂等面） | 未发明 `Retry-After`、Idempotency-Key 或自动重试；T5/4xx 族保持 rejection 不抢跑 #268 | ✅ |
| 0015 L186（双 observer 显式注入、throw 隔离） | 构造门 `typeof === 'function'` 不变（rest.ts L188–195）；全部 7 个发射点（L113/L152/L204/L216/L229/L247/L254）一律经 `emitMetrics`/`emitDiagnostic` 同步 try/catch helper，无裸调用（grep 实测） | ✅ |
| 0015 L188（metrics 低基数、无敏感字段） | `RestMetricsEvent` 键集恰 `{operation, outcome, code?, status?}`；operation 恒 `'namespace-create'`（单 endpoint 诚实常量）；无 owner/namespaceId/issues/schema/root/cause | ✅ |
| 0015 L190（diagnostic 三类 kind、可带已验证 owner/已知 namespaceId/operation/phase/committed/exact cause，不得带 schema/root/完整 issues；Host 负责访问控制/采样/脱敏） | `RestDiagnosticEvent` 三类 kind + `cause: unknown` exact 引用；operation/phase/committed 仅 registry-fatal、namespaceId 仅 lease-release-failure（诚实可得才出现）；无 `issues` 键；Host 义务写入类型注释与 README，未挪进 router | ✅ |
| 0015 L165/完整 problem shape 归后续票 | 5xx body 为最小 `{"code":…}`，与骨架既有 403/405 先例同构；未发明 message/issue 投影 | ✅ |
| ADR 0012 role 单真相 | 零触碰；无第二 role 源 | ✅ |
| ADR 0009/0010 Registry 语义 | 零触碰（diff 范围外）；判别输入全部为其公共面（窄 code 联合 / branded fatal `instanceof` + `.committed`） | ✅ |
| ADR-0015 治理（状态「提议」） | 文件未被修改；锚定（HEAD/blob/sha256）实测一致；R1/H-A/R3 折入义务已登记（SA3 Deferred verification、SA10 P3） | ✅ |

## 4. 模块责任

| 行为 | 应有归属 | 实际位置 | 结论 |
|---|---|---|---|
| HTTP 失败投影（code/status/body/metrics 分类） | REST Adapter | `create-namespace.ts`（包私有） | ✅ Registry 语义零改动，投影不复制底层状态机 |
| committed 事实 | Registry（唯一事实源） | REST 只读 `fatal.committed`，不从 phase 推断、无影子字段 | ✅ |
| abort 观察/结算 | 读取段 seam（#269 拥有） | 单一 `readRequestBody`；不吞 body/stream 清理（归 server 票，router 无权 cancel 已锁流） | ✅ |
| 4xx/422/limits/owner 文法 | #268 | 零实现；`limits` 参数位保留未消费；T5 default 保持 throw 为直接证据 | ✅ |
| listener/装配/连接生命周期 | 未来 server（#270） | abort 以有界 rejection 结算、不伪造 HTTP status；私有 `RestBodyReadAbortedError` 不导出 | ✅ |
| 访问控制/采样/脱敏 | Host | 文档明示，router 不承担 | ✅ |

## 5. 既有架构惯例

- **最小 problem body**：`errorResponse` 与 rest.ts 既有 403/405（`{code}` + `content-type: application/json`）同构——复用先例而非发明新形状。✅
- **observer 隔离先例**：`emitMetrics`/`emitDiagnostic` 与 `registry.ts` `dispatchObserver`（L100 区段实测存在）同向纪律——同步 try/catch、隔离不改变业务结局；helper 化使全分支隔离成为结构保证。✅
- **构造惯例**：读取 → 校验 → 复制 → 冻结保持（rest.ts L170–204）；router 构造后零状态、无 dispose 需求。✅
- **类型面惯例**：事件类型定义于公共 `rest.ts`、`index.ts` type re-export；`create-namespace.ts` 以 `import type` 反向引用——类型环安全擦除，运行时依赖保持 rest → create-namespace 单向（import 实测）。✅
- **公共面扩张克制**：`package.json` exports 白名单未动；新增导出仅两个事件类型经既有入口流出；`CreateNamespaceOrchestrationDeps` 虽 export 但模块包私有性由 exports 结构性保证（SA3 已披露，SA4 确认非偏离）。✅
- **头注纪律**：两源文件头注全面更新为新行为事实（deferral 清单移入已实现项），无过时表述残留于源码层。✅
- **TS 兼容惯例**：observer 签名收窄 `() => void` → `(event) => void` 为类型层加法；#267 冻结零参 `NOOP_OBSERVER` 按少参可赋值规则保持编译。✅

## 6. 单一事实源

| 事实 | 唯一来源 | 派生态/漂移面 | 结论 |
|---|---|---|---|
| committed | `NamespaceRegistryFatalError.committed` | REST 零复制零推断 | ✅ |
| metrics `code` | 与 response body code 同源（同一 `errorResponse` 调用点构造） | 无第二来源 | ✅ |
| owner | route 捕获段 → 单一 `Object.freeze` 对象（L173），Registry 输入与 diagnostic 事件共享同一不可变引用 | 宿主无法经事件改写 Registry 输入 | ✅ |
| namespaceId | Registry lease → release 前 DTO string 副本 | mutation 探针防御面保留 | ✅ |
| 事件形状 | `RestMetricsEvent`/`RestDiagnosticEvent` 单一定义点（rest.ts），create-namespace `import type` 引用 | 无第二份类型定义 | ✅ |
| 无缓存/镜像状态/marker 文件 | — | router 每请求独立闭包 | ✅ |

## 7. 生命周期对称性

| 获取/开始 | 释放/结束 | 核验 | 结论 |
|---|---|---|---|
| abort 监听器 `addEventListener`（once，与入口判定同属一个同步段，无观察间隙） | `finally` 无条件 `removeEventListener`（读/abort 谁胜都清理） | L134–147 实测 | ✅ 对称 |
| race 两个 promise | 均经 `Promise.race` 挂接反应；败方晚到 rejection 无 unhandled rejection；`aborted` promise 只 resolve 不 reject | L135–144 实测 | ✅ 卫生 |
| lease acquire（create 成功） | 恰一次 `await lease.release()`；失败不重试不二次调用 + diagnostic | L243–253 | ✅ 对称（#267 冻结语义保持） |
| 定时器/队列/worker/缓存 | 无新增 | 全文实测 | ✅ 零状态保持 |

## 8. 文件范围

`git status --porcelain` / `git diff --stat` 实测：恰 5 个 tracked 文件 modified（289+/49−），
与设计 §11 ALLOW 逐行对应；untracked = 上游 SA 产物（SA8×2、SA6 测试×5、wiki 任务件×8）。

| 检查 | 实测 | 结论 |
|---|---|---|
| ALLOW 遵守 | create-namespace.ts / rest.ts / index.ts / AGENTS.md / README.md 全部落在设计 ALLOW 行内，无扩张 | ✅ |
| DENY 遵守 | `test/**` tracked 零 diff；SA6 冻结 5 文件 sha256 逐字节一致；`namespace-registry/**`、`vfsl/**`、`persistence/**`、`package.json`、`docs/adr/**`、`CONTEXT.md`、`docs/protocols/**` 零改动；无 4xx/422/limits/owner 文法/problem shape 实现 | ✅ |
| 无 scope creep | 未发明 `Retry-After`、abort HTTP status、message 字段、第二读取路径、新公共子路径 | ✅ |
| `git diff --check` | 零输出（无空白错误） | ✅ |

## 9. 测试质量标准

| 检查 | 实测 | 结论 |
|---|---|---|
| 冻结完整性 | 5 文件 sha256 实测 = SA6 §13.4 逐字节（harness `14062b3d…` / support `9f9688ab…` / mapping `14465a40…` / abort `2f298a8e…` / observer `dbf8778a…`） | ✅ |
| 无弱化 | grep 实测零 `.skip`/`.only`/`.todo` | ✅ |
| 行为级断言 | 断言观察 HTTP status/body code/content-type、observer 实参（键白名单/词表/哨兵泄漏扫描/引用相等）、Registry seam 触达计数、release 计数与 lease 状态；无源码文本断言 | ✅ |
| 公共 seam | 测试仅 import `../src/rest.js` 公共面 + 既有 harness；零私有模块穿透 | ✅ |
| 时序纪律 | abort 用例以 pull/release 计数锚定（非 sleep）；C2 的 2s 为有界性上限断言 | ✅ |
| runner 入口真实性 | 根 `vitest.config.ts` include `packages/*/test/**/*.test.ts` 覆盖 5 新文件；harness 非 `.test.ts` 不被收集（仅被 import）；CI `scripts/ci-test-shard.mjs` 磁盘枚举自动装箱新文件；包 AGENTS.md 验证命令（vitest --typecheck + pnpm typecheck）即 SA3 V1–V4 已执行入口 | ✅ |
| 计数口径 | mapping 9 + abort 5 + observer 6 + support 9 = 29 用例与 SA6 一致（本次 grep `it(` 计数吻合） | ✅ |

（动态复跑纪律：SA9 不运行测试；SA3 V1 64/64×3 与 V2–V4 tsc 0 error 为其实跑声明，SA4 §11/SA10 P4 已登记「合并前复跑」义务。）

## 10. Findings

无 BLOCKER、无 MAJOR。MINOR 两条（均不阻断 approve）：

| ID | 级别 | 观察 | 建议 |
|---|---|---|---|
| MINOR-1（承 SA4 OBS-A / SA10 M-1） | MINOR | 重写后的包 AGENTS.md「exactly one low-cardinality metrics event per orchestration」与 README 同义句对过渡期 unmapped 族（malformed JSON/顶层形状/VFSL derive 失败/T5 三码）不成立——这些编排零事件；同句把 `code` 列为恒在键而成功/abort 实际省略。实现与设计 T 表精确口径一致，仅文档概括句过宽；冻结契约不要求该族发射 | 后续文档修订轮改为「#269 拥有的终局路径恰一事件；unmapped 族与 403/405 过渡期零事件（`rejected` 发射策略归 #268）；`code` 仅在非 2xx 且非 abort 时出现」 |
| MINOR-2（本评审新增） | MINOR | 包 AGENTS.md 失败映射条「fatal `committed:false`, unknown exceptions, and internal contract violations … → `500 INTERNAL_ERROR` (**the latter** with a diagnostic report)」与 README「（**后两者**上报 diagnostic）」对 diagnostic 覆盖面**欠述**：实现中 fatal 两分支（committed:true → OUTCOME_UNKNOWN 与 committed:false → INTERNAL_ERROR）同样先发射 `registry-fatal` diagnostic（L202–211 实测），并非只有 unknown/违例分支上报。方向为保守欠述（实现多于文档所述），非危险方向的夸大；同一文档的 observer 条目（三类 kind）与类型注释未限制发射分支，冻结契约（B3/B4/D5(a)(b)）锁定真实行为 | 后续文档修订轮把映射条补为「四条 5xx 结局均在 Response 前发射对应 diagnostic（503/FAILED 除外）」或等价精确表述；不阻断本票 |

## 11. 结论

实现符合仓库 AGENTS（根/docs/包三级）、ADR 0015（L113/L150–161/L175–182/L186–190 逐条实测）
与 ADR 0009/0010/0012（零触碰）；模块责任归位正确（HTTP 投影归 Adapter、committed 归 Registry、
4xx/422 归 #268、server 面归 #270、脱敏归 Host）；既有惯例（最小 problem body、observer 隔离、
构造冻结、类型面/导出面克制、头注纪律、TS 加法兼容）全部保持；单一事实源与生命周期对称性
无缺口；文件范围严守 ALLOW/DENY；冻结测试字节级完整、测试质量达仓内标准。
两条 MINOR 均为包契约文档的措辞精度问题（保守欠述/概括过宽），不影响代码正确性、冻结契约
或合并安全性。**Verdict：approve。**

---

*证据边界：本评审为纯静态（read/grep/git diff/sha256sum/git hash-object/git diff --check）；未修改任何实现、设计或测试；未运行测试/服务/临时进程；未调度其他 SA。本报告为 SA9 唯一产物（`wiki/raw/task_issue-269_sa9_standards.md`）。*
