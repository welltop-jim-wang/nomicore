# SA10 Spec 审查报告 — Issue #269：REST create 的 Registry 失败语义、取消边界与双 observer 契约

> 阶段：spec-review（iteration 0）。派发：`sa-d43fb52a-f7e9-4e1b-a150-82bc4c15c575`（mabf-sa10）。
> 审查对象：worktree `/home/wangjian/nomicore-fix-issue-269` 当前未提交 diff（branch `mabf/issue-269`，
> HEAD `0b06050d9518c66ef166751064c95ed9557c9532` = 父 PR #158 base `docs/rest-namespace-create`，
> 实测一致）。改动面 = 5 个 tracked 文件 modified（289+/49−）+ SA6 冻结测试 5 文件（untracked 新增）。
> 方法：纯静态独立复核（读 issue 正文/ADR/设计/SA2/SA3/SA4/SA6/SA8 产物 + 实现全文 + 冻结测试全文 +
> `git diff`/sha256 实测）；未修改任何代码/设计/测试，未运行测试，未启动服务。
> Owner 要求口径：Issue-comment REST snapshot 为空（dispatch/SA8 两轮/SA6/SA3/SA4 六源一致）——
> 无评论级 owner 要求；验收口径 = issue body What to build 三段 + AC1–AC6。

## 1. 裁决

**verdict: `approve`** —— AC1–AC6 全部 met；issue body 三段要求逐条落实；无遗漏、无部分实现、
无错误实现、无 scope creep。2 条 MINOR 级观察（§6）不阻断 approve；PR 必须披露的未达成/延后项
见 §7（全部为显式家族切片边界内的后续票义务，非本票 AC 缺口）。

## 2. 审查输入与证据链

| 输入 | 位置 | 核验 |
|---|---|---|
| Issue 正文 + AC1–AC6 | `wiki/raw/task_issue-269.md` | 已读；Comments 节空 |
| 派发记录 | `wiki/raw/task_issue-269_dispatch.md` | SA8 conflict-gate iter 0，comments `[]` |
| SA8 前置门禁 | `artifacts/sa8-conflict-report-issue-269.md` | `clear`（0 冲突 / OBS-1/2/3）；固定 wiki 路径缺失已登记，替代证据完整 |
| SA8 设计后复审 | `artifacts/sa8-conflict-report-issue-269-design-recheck.md` | `clear`（0 冲突 / 6 观察）；R1/H-A/R3 逐条裁决为计划内加法或诚实填补 |
| SA6 验收契约 | `wiki/raw/task_issue-269_sa6_contract.md` | `approve`；29 用例冻结；H-M/H-D/H-A + R1–R4 |
| SA1 设计 | `wiki/raw/task_issue-269_design.md` | §7.1 T1–T11 / §7.3 / §7.4 / §7.6 / §7.8；`requiresConflictRecheck` 已被 SA8 复审消化 |
| SA2 设计评审 | `wiki/raw/task_issue-269_sa2_review.md` | `approve`（0 BLOCKER/MAJOR；OBS-1~4 非阻断） |
| SA3 实现报告 | `wiki/raw/task_issue-269_sa3_impl.md` | B0 红灯基线 / V1 64/64 绿×3 / V2–V4 tsc 0 error / E1 哈希 / E2 范围 |
| SA4 实现后审查 | `wiki/raw/task_issue-269_sa4_review.md` | `approve`（0 BLOCKER/MAJOR；OBS-A/B 非阻断） |
| ADR 0015（规范基） | `docs/adr/0015-vertical-rest-namespace-create.md` | blob `64daa16a…` / sha256 `3a75f99b…148` 实测与 SA6 §3.1 逐字一致；状态「提议」（L4）；L113/L161/L175–L190 本次逐行复核 |
| Registry 公共面 | `packages/namespace-registry/src/{types,errors,registry}.ts` | 窄 issue 联合 7 码（types.ts L275–310）；`NamespaceRegistryFatalError` branded class（errors.ts L21–45）；committed 事实矩阵逐锚点实测（§4.1） |
| 实现 | `src/{create-namespace,rest,index}.ts` + 包 `AGENTS.md`/`README.md` | 全文读 + `git diff` 逐行 |
| 冻结测试 | `test/rest-{registry-failure-mapping,abort-boundary,observer,failure-contract-support}*.test.ts` + harness | 全文读；sha256 实测 5/5 与 SA6 §13.4 逐字节一致；#267 tracked 4 测试文件 `git diff` 为零 |

## 3. AC 逐条判定

| AC | 判定 | 实现证据（实测行号） | 冻结契约锚 |
|---|---|---|---|
| AC1 503/500 三分支按 Registry 结果类型精确映射，committed 语义正确 | **met** | `create-namespace.ts`：L221–222 `REGISTRY_NOT_ACCEPTING`→503 逐字 code；L223–224 `NAMESPACE_CREATE_FAILED`→500 逐字 code；L202–214 fatal 以 `instanceof NamespaceRegistryFatalError` + `error.committed` 为**唯一**二分判别子：`true`→500 `NAMESPACE_CREATE_OUTCOME_UNKNOWN`、`false`→500 `INTERNAL_ERROR`（R1）；L216–217 unknown throw→500 `INTERNAL_ERROR`。committed 语义经 registry.ts 实测矩阵背书（§4.1），未按 phase 推断 | B1（真实 shutdown→503）/B2（真实 `DocCreateOperationalError`→500 FAILED）/B3/B4（真实 fatal 二分，B4 同点反断言 ≠FAILED/≠OUTCOME_UNKNOWN）/B7（unknown） |
| AC2 `NAMESPACE_CREATE_INVALID_INPUT`/`NAMESPACE_ALREADY_EXISTS` 从 REST 返回安全 500 并触发 diagnostic | **met** | L225–230：两码合并分支 → diagnostic `{kind:'unknown-exception', cause:created（issue 对象引用）, owner}` + 500 `{code:'INTERNAL_ERROR'}`；`NAMESPACE_ALREADY_EXISTS` 不透传。安全 500 = body 仅稳定 code，issue message 哨兵不入任何 client 面 | B5/B6（状态/code/哨兵不泄漏/diagnostic 恰一 + cause 引用相等）+ D5(d) |
| AC3 body 读取中断 Registry 零触达；接纳后中断不取消 create，等待 settle 并 release | **met** | `readRequestBody`（L128–148）三道闸门：入口同步 `signal.aborted` 判定（L133）→ `Promise.race([request.json(), aborted])`（L142）→ 读胜出后同步再核对（L143），finally 无条件摘除 once 监听器（L145–147）；`abortSettle`（L151–154）= metrics `aborted` + 有界 rejection + 零 diagnostic。零触达的结构保证成立：读返回 → `registry.create`（L196）之间仅同步代码（形状检查/同步 `deriveSchemaIdentity`/envelope 组装）。接纳后零 signal 读取（grep 实测：signal 仅出现于 `readRequestBody` 与注释）；`await lease.release()` 恰一次（L244） | C1（pre-abort 零触达 `[]` + `['aborted']`）/C2（mid-read 有界）/C5（abort 优先于 413，R3）/C3（create 在途 abort → 201 + release 恰一次 + `['succeeded']`）/C4（release 在途 abort → 201 + lease released） |
| AC4 两 observer 构造强制显式注入；metrics 低基数无敏感字段；diagnostic 仅三类且不带 schema/root/完整 issues | **met** | 构造门 `rest.ts` L188–195（`typeof === 'function'`，缺任一 → `TypeError`；显式 no-op 合法）。`RestMetricsEvent`（L53–60）键集恰 `{operation, outcome, code?, status?}`，`operation` 恒 `'namespace-create'`（create-namespace.ts L50），outcome 五值词表；无 owner/namespaceId/issues/schema/root/cause。`RestDiagnosticEvent`（L77–85）三类 kind + `cause: unknown`（exact 引用）+ 诚实可选字段（operation/phase/committed 仅 registry-fatal；namespaceId 仅 lease-release-failure 且取 release 前 DTO 副本 L251）；无 `issues` 键 | D1（TypeError 门）/D2（成功事件白名单+词表+无泄漏）/D4（release-failure）/D5(a–d)（三类 kind + cause 引用相等 + 无 schema/root/issues）/D6（跨分支矩阵 + `ns-` 泄漏扫描 + operation 单常量） |
| AC5 observer throw 不改变 HTTP 结果 | **met** | `emitMetrics`/`emitDiagnostic`（L77–97）同步 try/catch helper；全部 11 处发射点（成功 L254 / aborted L152 / errorResponse 内 L113 / fatal L204 / unknown L216 / 违例 L229 / release 失败 L247）一律经 helper，无裸调用——隔离为结构性保证 | D3：双 observer 同 throw 下 201/503/500 OUTCOME_UNKNOWN/release-failure 201 四分支全部不变 |
| AC6 测试覆盖：not accepting、operational failure、fatal committed 二分、中断语义、observer 隔离 | **met** | 五族全覆盖：B1（not accepting，真实 shutdown）、B2（operational，真实 persistence 注入）、B3/B4（fatal committed 二分，testing 注入真实 Registry 产物，committed:true 提交事实可被另一 registry open 读回）、C1–C5（中断语义）、D3（observer 隔离）；+ 支撑 9 恒绿锚 + 负控 2 + #267 legacy 35 保持。SA3 V1 实跑 64/64 绿 ×3（SA10 纪律下未复跑，见 §7-P4） | SA6 §12.3 映射 6/6 |

## 4. Issue body 非 AC 要求与关键裁决的独立复核

### 4.1 committed 二分判别子（SA8 OBS-2 → SA6 R1 → 设计 §7.2 → 实现 L202–214）

ADR 0015 L175–178 未显式落位 fatal `committed:false`；契约裁决 R1（→ 500 `INTERNAL_ERROR`）
经三层独立审查（SA2 §7 / SA4 §2 专项一）与本次复核确认：

- registry.ts 实测矩阵：`namespace-id-generation` 恒 false（L897）；`create-document-internal` =
  `DocRuntimeFatalError.committed` 或 false（L1469/1471 区段）；`lifecycle-slot-internal` 原样传播
  `DocCreateFatalError.committed`（**可真可假**，L1539/1547）；`runtime-construction` 恒 true（L1583）。
  ⇒ 「按 phase 推断提交事实」必然错分，实现以 `committed` 为唯一判别子正确且充分。
- `NAMESPACE_CREATE_FAILED` 专属 typed operational 窄 issue 通道（ADR 0015 L176 + ADR 0009 错误演进），
  fatal 走 branded rejection 通道，不合并；`OUTCOME_UNKNOWN` 专属 committed:true。落位 INTERNAL_ERROR
  是 L178 残留类的诚实填补。变异 M1/M2 证明契约对该二分会双向捕获。

### 4.2 取消边界（ADR L113 逐字）

「body读取阶段尊重`Request.signal`，中断后Registry零触达」— 三道闸门 + 零异步窗口，不依赖
Node 24 平台行为（support 恒绿锚钉死平台事实：pre-aborted 完整 body 仍 resolve、mid-read 悬挂）。
「调用Registry后不传播客户端取消，必须等待create settle并release Lease」— 接纳后零 signal 读取
（grep 实测）+ release 恰一次 awaited。abort 以有界 `handle` rejection 结算（H-A/R2），未伪造
HTTP status（不发明未评审 problem shape 纪律保持）。

### 4.3 Observability（ADR L186–190 逐字）

- 显式注入门不变（B-2 保持）；observer throw 一律隔离（§3 AC5）。
- metrics 词表/键集/无敏感字段：实现与 H-M 逐键一致；`code` 出现时等于 body 稳定 code（同一
  `errorResponse` 调用点构造，无第二来源）；成功省略 code、abort 无 code/status 均为诚实省略。
- diagnostic 三类 kind；`cause` 恒为跨边界错误对象 exact 引用（fatal 分支传 fatal 实例本身而非
  `fatal.cause`——与 D5 引用相等断言面吻合）；owner 为 frozen 路由捕获对象；namespaceId 仅
  lease-release-failure 携带（ADR L161 逐字：已验证 owner、namespaceId 与 exact cause）。
- 「Host 须把该 Adapter 视为敏感运维接口并负责访问控制、采样和脱敏」— `RestDiagnosticEvent`
  文档注释（rest.ts L75）与 README Public API 段均已明示；义务未挪进 router。

### 4.4 排序与家族边界（#267 冻结 B-3 / #268 seam R3）

- 判定顺序 route → method → role → owner → body → derive → create → DTO → release → 201 未 reorder
  （rest.ts gates diff 仅头注与 orchestration 调用形态；create-namespace.ts 成功链路逐字保持）。
- #268 拥有的 4xx/422 族保持 unmapped rejection：T5 default 分支（L231–233）文案
  `unmapped registry issue: <code>` 与 HEAD 逐字一致；body 形状/JSON/derive 失败原样传播；
  `limits` 参数位保留零消费。无抢跑。
- abort 优先于 413 的 seam 不变量已写入包 AGENTS.md 与 README（供 #268 派发面引用）；C5 可执行锁定。

## 5. 范围与契约完整性

- **ALLOW 遵守**：5 个改动文件（create-namespace.ts / rest.ts / index.ts / AGENTS.md / README.md）
  全部落在设计 §11 ALLOW 行内；diff-stat 289+/49− 与 SA3 E2 / SA4 §6 实测一致。
- **DENY 遵守（实测）**：`test/**` 既有 4 文件零 diff；SA6 冻结 5 文件 sha256 5/5 逐字节一致
  （无 skip/only/todo、无断言弱化）；`namespace-registry/**`、`vfsl/**`、`persistence/**`、
  `package.json`（exports 恰 `.`/`./rest` 实测）、`docs/adr/**`、`CONTEXT.md`、`docs/protocols/**`
  零改动；无 4xx/422/limits/owner 文法/problem shape 实现。
- **无 scope creep**：未发明 `Retry-After`、abort HTTP status、message 字段、第二读取路径、
  新公共子路径；`CreateNamespaceOrchestrationDeps` export 已在 SA3 报告披露且模块包私有性
  由 exports 白名单结构性保证（index.ts 未 re-export，实测）。
- **兼容性**：observer 签名收窄 `() => void` → `(event) => void` 为类型层加法（TS 少参可赋多参）；
  #267 冻结 `NOOP_OBSERVER` 构造点全部零参（编译不受破坏）；`handle` 新结局族（503/500 Response
  + abort rejection）是 SA8 两轮 clear 确认的计划内纯加法。

## 6. MINOR 观察（非阻断）

| ID | 观察 | 处置建议 |
|---|---|---|
| M-1（承 SA4 OBS-A / SA2 OBS-1） | 重写后的包 AGENTS.md「exactly one low-cardinality metrics event per orchestration」与 README L9 同义句，对过渡期 unmapped 族（malformed JSON / 顶层形状 / VFSL derive 失败 / T5 三码）不成立——这些编排零事件；AGENTS.md 同句把 `code` 列为恒在键而成功/abort 实际省略。实现与设计 T 表精确口径一致，仅文档概括句过宽；冻结契约不要求该族发射（D6 仅「出现即合规」） | 后续文档修订轮改写为「#269 拥有的终局路径恰一事件；unmapped 族与 403/405 过渡期零事件（`rejected` 发射策略归 #268）」；不阻断本票 |
| M-2（承 SA4 OBS-B） | SA3 报告两处实现细节（`errorResponse` 携带 metricsObserver 首参、`CreateNamespaceOrchestrationDeps` 自私有模块 export）只在表格/正文披露而未集中在 Deviations 节 | 无需动作；均已披露且经 SA4 确认非偏离 |

## 7. PR 必须披露的未达成/延后项（均为显式切片边界，非本票 AC 缺口）

| # | 事项 | 去向 | 依据 |
|---|---|---|---|
| P1 | **4xx/422 族全部未实现**（owner 文法/percent-encoding/query/Content-Type/Encoding 拒绝 400/415、limits 执行与 413、顶层形状 400、`NAMESPACE_SCHEMA_INVALID`/`NAMESPACE_ROOT_INVALID` 422、完整 problem shape 含 message/issue 投影/`issuesTruncated`、metrics `rejected` 发射策略）——这些结局当前仍以 `handle` rejection 结算 | #268 / 后续错误契约票 | 设计 §1 非目标；issue 家族切片；SA6 §12.4 |
| P2 | **#268 合入后的 seam 不变量义务**：读取段内 abort 优先于 413（含 malformed-JSON 分支），任何读取期结局发射前必须再核对 `signal.aborted`；C5 冻结用例在两票合入后必须保持绿 | #268 派发面 | R3/C5；SA2 OBS-4；SA8 OBS-R3-1 |
| P3 | **ADR-0015 接受时的折入义务**：R1（fatal committed:false → INTERNAL_ERROR）、H-A（abort 以有界 rejection 结算、无 HTTP status）、R3（abort 优先于 413）须在 0015 经父 PR #158 正式接受时折入 ADR 正文或修订节；0015 仍为「提议」，若接受前被修订，设计+契约须重过 SA8 门禁 + 修订轮 | 父 PR #158 治理 | SA8 OBS-1/OBS-R1-1；SA2 OBS-3；设计 §13 |
| P4 | **合并前动态验证**：SA3 的 V1（64/64 绿 ×3）与 V2–V4（tsc 0 error）为其实跑声明，SA10 纪律下未复跑；合并前须复跑 `NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run --typecheck packages/namespace-api/test` 与 `pnpm typecheck`；CI Node 20 腿首跑需关注 support 文件钉死的 Node 24 平台 abort 事实（router 语义不受影响，但平台锚表述或需修订轮） | 合并前 gate / CI 首跑 | SA4 §11 |
| P5 | **server 装配面未实现**：HTTP listener、graceful drain、连接级取消、abort 后 body/stream 清理；`handle` 的 abort rejection 须被 server 视为连接级取消（不得记 500 或重试）；abort rejection 的公共判别子当前为包内私有 `RestBodyReadAbortedError`（不导出），留 server 票以加法决定 | #270（FR-5） | 设计 §1 非目标 / §13 残余 1；SA3 Deferred verification |

## 8. 结论

实现对 Issue #269 正文（失败映射 / 取消边界 / Observability 三段）与 AC1–AC6 的覆盖**完整且忠实**：
四分支映射与 committed 语义精确（含 ADR 欠规格分支的 R1 诚实填补）、内部契约违例安全 500 +
diagnostic、三道闸门 abort 边界与接纳后零观察、双 observer 显式注入/低基数/三类 diagnostic/
全分支 throw 隔离，全部由 SA6 冻结契约（29 用例，字节未动）可执行锁定，并经 SA2/SA4 双「approve」
与 SA8 两轮「clear」。无遗漏、无部分实现、无错误实现、无 scope creep。§6 两条 MINOR 不阻断；
§7 五项为 PR 披露义务而非本票缺口。

**verdict: approve**
