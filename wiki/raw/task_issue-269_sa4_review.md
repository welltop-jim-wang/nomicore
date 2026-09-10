# SA4 实现后红队审查 — Issue #269：REST create 的 Registry 失败语义、取消边界与双 observer 契约

> 阶段：implementation-review（iteration 0）。派发：`sa-0f3df875-5978-4d9c-9cc5-1ee0f5c4f062`（mabf-sa4）。
> 审查对象：SA3 实际实现（worktree `/home/wangjian/nomicore-fix-issue-269`，branch `mabf/issue-269`，
> HEAD `0b06050`，未提交工作树改动 = 5 个 ALLOW 文件 modified + 上游 SA untracked 产物）。
> 审查基准：SA1 设计 `wiki/raw/task_issue-269_design.md` → SA2 评审 `approve`（0 BLOCKER/MAJOR）
> → SA6 契约 `approve`（29 用例冻结）→ SA3 报告 `wiki/raw/task_issue-269_sa3_impl.md`。
> 方法：纯静态审查（读源码/测试/diff/ADR/哈希）；未修改实现、未运行测试、未启动服务。

## 1. Reviewed inputs

| 输入 | 位置 | 状态 |
|---|---|---|
| 任务简报（issue #269 body + AC1–AC6） | `wiki/raw/task_issue-269.md` | 已读；comments 快照空（与 dispatch/SA6/SA8 一致），无 owner override |
| SA1 批准设计 | `wiki/raw/task_issue-269_design.md` | 已全文读（§7.1 T1–T11、§7.3、§7.4、§7.6、§7.7/§7.8） |
| SA2 设计评审 | `wiki/raw/task_issue-269_sa2_review.md` | 已全文读；Required revisions 空；OBS-1~4 |
| SA6 验收契约 | `wiki/raw/task_issue-269_sa6_contract.md` | 已全文读；§12.1 H-M/H-D/H-A、§12.2 R1–R4、§13.4 哈希 |
| SA3 实现报告 | `wiki/raw/task_issue-269_sa3_impl.md` | 已全文读；Changed paths / Verification B0·V1–V4·E1·E2 |
| SA8 门禁（两轮） | `artifacts/sa8-conflict-report-issue-269{,-design-recheck}.md` | 已读头注与裁决节（clear / clear） |
| 实现源码 | `packages/namespace-api/src/{create-namespace,rest,index}.ts`（工作树版本 + HEAD 版本对照） | 已全文读 + `git diff` 逐行 |
| 包契约文档 | `packages/namespace-api/AGENTS.md`、`README.md`（diff） | 已读 |
| 冻结测试（#269，5 文件） | `test/rest-{failure-contract-harness,registry-failure-mapping-contract,abort-boundary-contract,observer-contract,failure-contract-support}*` | 已全文读；sha256 实测 |
| 冻结测试（#267，4 文件） | `test/rest-{create-hub,role-gate-routing,contract-support,public-seam-wiring}*.test.ts` + `rest-contract-harness.ts` | 已读关键面（observer 兼容/构造门/接线） |
| Registry 公共面 | `packages/namespace-registry/src/{errors,types,registry}.ts`、`@nomicore/vfsl` `deriveSchemaIdentity` | 已读；committed 矩阵锚点逐行核对 |
| ADR | `docs/adr/0015`（L110–191）、ADR 0009/0010（经设计/SA6 引用） | 已读；blob/sha256 实测 |
| CI/runner 入口 | `.github/workflows/ci.yml`、`scripts/ci-test-shard.mjs`、根 `vitest.config.ts`、根 `package.json` scripts、`tsconfig.typecheck.json` | 已读 |

固定位置缺失项（与 SA2/SA3 记录一致，非本票缺口）：`wiki/raw/task_issue-269_conflict_report.md`、
`task_issue-269_relevant_decisions.md` 不存在（SA8 产物实际在 `artifacts/`，两份均在）；替代证据链完整。
`wiki/raw/task_issue-269_sa4_review.md` 此前不存在，本文件为首版。

## 2. Verdict

**`approve`** —— 0 BLOCKER、0 MAJOR；Required revisions 为空；2 条非阻断观察（§12）。

dispatch 点名四项专项独立复核结论（细节见 §3/§4/§8/§9）：

1. **`committed:false` 映射（R1）**：`create-namespace.ts` L202–214 以 `instanceof
   NamespaceRegistryFatalError` + `error.committed` 为唯一二分判别子；`false` → 500
   `INTERNAL_ERROR`、`true` → 500 `NAMESPACE_CREATE_OUTCOME_UNKNOWN`；`phase` 只进 diagnostic
   不参与判别。`registry.ts` 四 phase 的 committed 事实矩阵（id-generation 恒 false L897；
   create-document-internal = `DocRuntimeFatalError.committed` 或 false；lifecycle-slot-internal
   原样传播 `DocCreateFatalError.committed`；runtime-construction 恒 true）逐行实测核对成立——
   「按 phase 推断提交事实」的歧路被正确避开。**通过**。
2. **abort-before-413（R3/C5）**：`readRequestBody`（L128–148）第一动作即入口同步
   `signal.aborted` 判定，其后 raced read + 胜出后同步再核对；`limits` 本票零消费（C5 以
   pre-abort + `maxBodyBytes:16` 锁定 aborted ≠ 413，本票实现下必然绿）；「abort 优先于任何
   读取期检查」的不变量已写入 AGENTS.md/README 供 #268 引用。入口判定 → addEventListener
   → race 之间零 await（监听器注册与入口判定同属一个同步段），不存在「abort 落在两次观察
   之间」的窗口；读返回 → `registry.create` 之间全同步（形状检查 + `deriveSchemaIdentity`
   实测为同步导出函数 + envelope 组装），接纳后源码零 `signal` 读取（grep 实测）。**通过**。
3. **observer 事件隔离（O-1）**：`emitMetrics`/`emitDiagnostic` 同步 try/catch helper
   （L77–97）；全部发射点（成功/abort/errorResponse 内部/release 失败/fatal/unknown/内部违例
   共 11 处）一律经 helper，无裸 observer 调用（grep 实测）；事件类型面 `RestMetricsEvent`
   （键集恰 `{operation,outcome,code?,status?}`）/`RestDiagnosticEvent`（三类 kind + exact
   cause 引用 + 诚实可选字段）与 H-M/H-D 及冻结断言逐键一致。**通过**。
4. **ADR/文档变更与证据完整性**：ADR-0015 未触碰（blob `64daa16a…` / sha256 `3a75f99b…148`
   实测与 SA6 §3.1 逐字一致）；AGENTS.md/README 已按 SA2 OBS-2 重写三处失效表述，并补记
   seam 不变量与 `rejected` 策略延后；5 个冻结测试 sha256 与 SA6 §13.4 逐字节一致；SA3 报告
   的 diff-stat（289+/49−）、B0 红灯基线数字、git 状态声明全部与工作树实测吻合。**通过**。

## 3. 上游要求落实

| Requirement or finding | Implementation evidence | Assessment |
|---|---|---|
| Issue body 失败映射 F1：`REGISTRY_NOT_ACCEPTING` → 503（零提交、可重试） | `create-namespace.ts` L221–222：503 + 逐字 code + metrics `unavailable`；零 diagnostic | 落实（T1） |
| F2：typed operational → 500 `NAMESPACE_CREATE_FAILED` | L223–224：窄 issue 通道专属映射；零 diagnostic（非三类事件） | 落实（T2） |
| F3：fatal `committed:true` → 500 `NAMESPACE_CREATE_OUTCOME_UNKNOWN` | L212–213：`instanceof` + `.committed === true` 判别 | 落实（T6） |
| F4：fatal `committed:false` → 500 `INTERNAL_ERROR`（SA8 OBS-2 交设计、R1 裁决） | L214：`committed` 为唯一判别子（见 §2 专项一） | 落实（T7） |
| unknown exception / 内部契约违例 → 500 `INTERNAL_ERROR` + diagnostic | L216–217（throw catch-all）、L225–230（INVALID_INPUT/ALREADY_EXISTS → `unknown-exception` kind + cause=issue 引用，R4） | 落实（T3/T4/T8） |
| REST 不返回 `NAMESPACE_ALREADY_EXISTS` | L226–230：映射为 INTERNAL_ERROR，不透传 | 落实 |
| Issue body 取消边界：body 读取尊重 `Request.signal`、中断后 Registry 零触达 | `readRequestBody` 三道闸门；`abortSettle` 有界 rejection + metrics `aborted` + 零 diagnostic | 落实（T9） |
| 调用 Registry 后不传播取消、等待 settle 并 release | 接纳点后零 signal 读取；`await lease.release()` 恰一次；release 失败仍 201 + diagnostic（L243–253） | 落实（T10/T11） |
| Observability：显式注入、throw 隔离、metrics 低基数、diagnostic 三类 | `rest.ts` L188–195 构造门保持 `typeof === 'function'`；helper 化隔离；事件形状见 §2 专项三 | 落实 |
| Host 访问控制/采样/脱敏义务 | `RestDiagnosticEvent` doc + README 明示「Host 须视为敏感运维接口」；义务未挪进 router | 落实 |
| SA2 Required revisions | 为空（`approve`） | 无遗留 |
| SA2 OBS-1（设计概括句过宽） | 实现按 T 表精确口径：#269 拥有终局恰一事件；unmapped 族/403/405 零事件 | 落实（行为层）；文档层见 §12-OBS-A |
| SA2 OBS-2（包文档三处失效表述须同步修订） | AGENTS.md「emits no events」删除、结局条目拆分；README Public API/Deferred scope 重写（diff 实测） | 落实 |
| SA2 OBS-3（ADR 折入义务补记） | SA3 在 Deferred verification 登记去向（治理义务，非实现动作）；`docs/adr/**` 属 DENY 未触碰 | 落实（登记层面） |
| SA2 OBS-4（malformed JSON × abort） | `request.json()` rejection 原样传播（读取 try 内同步调用，rejection 穿透 race）；零事件、零 Registry 触达 | 落实（与 SM-9 一致） |
| AC1–AC6 | 冻结 29 用例（mapping 9 / abort 5 / observer 6 / support 9）+ SA3 V1 绿证据 | 覆盖 6/6（SA6 §12.3 映射 + SA4 §9 测试质量审查） |

## 4. 设计落实审查

| Design decision | Implementation location | Assessment | Finding |
|---|---|---|---|
| T1 503 `REGISTRY_NOT_ACCEPTING` + metrics `{outcome:'unavailable', code, status:503}` | `errorResponse(…, 'REGISTRY_NOT_ACCEPTING', 503, 'unavailable')` L221–222 | 一致 | — |
| T2 500 `NAMESPACE_CREATE_FAILED` + `failed`，零 diagnostic | L223–224 | 一致 | — |
| T3/T4 内部违例 → 500 `INTERNAL_ERROR` + diagnostic `unknown-exception`（cause=窄 issue 对象引用，R4） | L225–230；cause 为 `created`（issue 对象本身） | 一致（B5/B6/D5(d) cause 引用相等面） | — |
| T5 `NAMESPACE_INVALID_IDENTITY`/`SCHEMA_INVALID`/`ROOT_INVALID` 保持 unmapped rejection（#268 边界） | default 分支 L231–233，文案 `unmapped registry issue: <code>` 与 HEAD 逐字一致（`git show` 对照） | 一致（纯加法纪律） | — |
| T6 fatal `committed:true` → 500 `NAMESPACE_CREATE_OUTCOME_UNKNOWN` + diagnostic `registry-fatal`（cause=fatal 实例本身、operation/phase/committed 透传） | L202–213 | 一致（cause 非 `fatal.cause`，与 D5(a) 引用相等面吻合） | — |
| T7 fatal `committed:false` → 500 `INTERNAL_ERROR`（R1）+ diagnostic `registry-fatal`（committed:false） | L214 | 一致（B4 正向 + B2/B3 反向排除被满足） | — |
| T8 unknown throw → 500 `INTERNAL_ERROR` + diagnostic `unknown-exception`（cause=抛出对象）；同步 throw 同样入 catch | L201–217（try 包裹 `await registry.create(...)` 调用表达式） | 一致（SM-7） | — |
| T9 abort → 有界 `handle` rejection + metrics `{operation, outcome:'aborted'}`（无 code/status）+ 零 diagnostic；私有 `RestBodyReadAbortedError` 不导出 | `abortSettle` L150–154、类定义 L57–62（无 export） | 一致（H-A/R2） | — |
| T10 成功 → metrics `{operation,'succeeded',status:201}`（省略 code） | L254 | 一致 | — |
| T11 release 失败 → 仍 201、不重试、不二次调用、diagnostic `lease-release-failure`（namespaceId 取 release 前 DTO 副本、cause=release 异常引用）+ metrics `succeeded` | L236–254（DTO freeze 先于 release；`dto.namespaceId` 为已拷贝 string） | 一致（harness `mutateNamespaceIdOnRelease` 探针防御面保留） | — |
| §7.3 三道闸门（入口同步判定 → race → 胜出再核对）+ finally 无条件移除监听器 + 不 `body.cancel()` | `readRequestBody` L128–148 | 一致；race 对两个 promise 均挂接反应（`Promise.race` 语义），败方 rejection 不产生 unhandled rejection | — |
| §7.3 signal 缺失 → 自然 TypeError（fail loud，不静默当「永不中断」） | L132 裸读 `request.signal` | 一致（ER-4） | — |
| §7.4.1 类型面定义于 rest.ts、index.ts re-export、`import type` 反向引用（运行时单向） | `rest.ts` L53–85、`index.ts` L8–15、`create-namespace.ts` L38（`import type`） | 一致 | — |
| §7.4.1 兼容性：零参 observer 仍可赋值（#267 `NOOP_OBSERVER`） | #267 冻结测试构造点全部零参（grep 实测）；TS 少参可赋多参 | 一致（静态可证；运行动态项见 §11） | — |
| §7.4.2 发射矩阵：恰一事件/orchestration（#269 拥有终局）；403/405/未匹配/T5/body 族零事件 | gates（rest.ts L206–217）不经 orchestration，零发射；单出口单发射结构 | 一致 | — |
| §7.4.2 `operation` 常量 `'namespace-create'` | `METRICS_OPERATION` L50 | 一致（D6 `operations.size===1`） | — |
| §7.4.2 diagnostic owner 字段（「提交给 Registry.create 的 owner」）+ namespaceId 仅 lease-release-failure | L173（frozen owner）、L247–252 | 一致 | — |
| §7.4.3 隔离 helper 化（全调用点） | L77–97 + 全部发射点 grep 核对 | 一致（结构性保证） | — |
| §7.5 R4 归类 + §7.6 与 #268 共享 seam/排序不变量（#269 不消费 limits） | `RestRouterLimits` 保留未消费（rest.ts L35–43/L203）；不变量写入 AGENTS/README | 一致 | — |
| §7.7 接口变更汇总（rest.ts/create-namespace.ts/index.ts 三文件 + 私有错误类） | 与 diff 一致；额外导出 `CreateNamespaceOrchestrationDeps` 接口描述私有 deps 形状（SA3 已披露；模块仍包私有、不进 exports、不被 index re-export——package.json exports 实测仅 `.`/`./rest`） | 一致（披露过的私有面细节，非偏离） | — |
| §7.8 伪代码逐分支 | 上述各行同构；`errorResponse` 增加 metricsObserver 首参（私有函数签名细节） | 一致 | — |
| §1 目标 4 文档同步 | AGENTS.md/README diff（见 §3） | 落实（精度备注见 §12-OBS-A） | — |
| #267 冻结顺序不 reorder（route → method → role → owner → body → … → 201） | rest.ts gates 顺序未动（diff 仅 orchestration 调用与头注）；成功链路 L174–259 顺序保持 | 一致 | — |

## 5. 架构一致性与惯例

### 责任归属

| Behavior | Expected owner | Actual location | Assessment |
|---|---|---|---|
| HTTP 失败投影（code/status/body/metrics） | REST Adapter | `create-namespace.ts`（包私有） | 正确——Registry 语义零改动；投影不复制底层状态机 |
| committed 事实判别 | Registry（唯一事实源） | REST 只读 `fatal.committed` | 正确——无第二份提交状态、无 phase 影子推断 |
| abort 观察/结算 | 读取段 seam（#269 拥有） | `readRequestBody` | 正确——不依赖平台、不吞 body/stream 清理（归 server 票） |
| role/owner/limits/4xx/422 | composition root / #268 | 未触碰；limits 参数位保留冻结 | 正确 |
| 访问控制/采样/脱敏 | Host | 文档明示义务；router 不承担 | 正确（ADR 0015 L190） |

### 相似能力对照

| Similar capability | Existing implementation | Actual implementation | Consistent or divergent | Reason |
|---|---|---|---|---|
| 最小 problem body `{code}` + JSON content-type | rest.ts 403/405 既有先例（L145–158） | `errorResponse` 同构 | 一致 | 完整 problem shape 归 #268（家族切片纪律） |
| 同步 void observer 隔离（emit never throws） | ADR 0011/0014 诊断日志纪律；registry.ts `dispatchObserver` try/catch 先例 | `emitMetrics`/`emitDiagnostic` | 一致 | 同向纪律；与 namespace 级诊断日志无交叉 |
| 读取段 seam | #267 骨架裸 `request.json()`（唯一读取点） | 收敛为单一私有 `readRequestBody`，#268 复用 | 一致 | 无平行读取路径 |
| abort 结算面 | 无先例（本票首创） | 有界 rejection + metrics `aborted` | 一致（诚实读法） | 不发明 499/408；词表既有 `aborted` |

### 单一事实源

| Fact | Authoritative source | Derived state | Drift risk |
|---|---|---|---|
| committed | `NamespaceRegistryFatalError.committed` | 无（REST 零复制） | 无 |
| namespaceId | Registry lease / DTO 副本 | diagnostic 仅取 release 前冻结副本 | 无（mutation 探针防御保留） |
| owner | route 捕获段 → frozen 对象 | metrics 不携带；diagnostic 引用同一 frozen 对象 | 无 |
| metrics code | 与 response body code 同源（同一 `errorResponse` 调用点构造） | 无第二来源 | 无（B1–B8 「code=body code」断言面） |

### 生命周期对称性

| Start or acquire | Stop or release | Failure recovery | Assessment |
|---|---|---|---|
| abort listener addEventListener（once） | finally 无条件 removeEventListener | abortSettle 有界 throw；败方 promise 经 race 已挂接 | 对称（每请求零残留） |
| lease acquire（create 成功） | 恰一次 awaited release | release 失败不重试不二次调用 + diagnostic | 对称（#267 冻结语义保持） |
| 构造期校验 | TypeError（fail loud） | — | 对称（D1 门不变） |
| 无定时器/队列/worker/缓存 | — | — | router 构造后零状态（除每请求局部变量） |

### 平行机制检查

| Candidate duplicate | Existing path | Actual path | Disposition |
|---|---|---|---|
| 第二套 cleanup/retry/日志框架 | 无 | 无（helper 为包内私有函数） | 无重复 |
| 第二读取路径 | `request.json()` | 单一 `readRequestBody` | 无重复 |
| 新公共子路径/导出面扩张 | package.json exports `.`/`./rest` | 未动（实测）；事件类型经既有入口流出 | 无扩张 |

## 6. 文件范围审查

`git status --porcelain`（实测）：5 文件 modified + untracked = 上游 SA 产物（SA8 ×2、SA6 测试 ×5、
wiki/raw 任务件 ×6）。`git diff --stat`：`5 files changed, 289 insertions(+), 49 deletions(-)`——与
SA3 E2 声明逐字一致。

| Changed path | ALLOW entry | Purpose | Assessment |
|---|---|---|---|
| `packages/namespace-api/src/create-namespace.ts` | ALLOW 行 1 | readRequestBody/映射终局/发射 helper/私有 abort 类/签名扩展 | 全部落在行内列举项 |
| `packages/namespace-api/src/rest.ts` | ALLOW 行 2 | 事件类型定义与导出/observer 收窄/observers 传递/头注更新 | 同上 |
| `packages/namespace-api/src/index.ts` | ALLOW 行 3 | re-export 两事件类型（+2 行） | 同上 |
| `packages/namespace-api/AGENTS.md` | ALLOW 行 4 | deferral 清单更新 + OBS-2 失效表述同步 | 同上 |
| `packages/namespace-api/README.md` | ALLOW 行 5 | Public API/Deferred scope 更新 + OBS-2 | 同上 |
| `wiki/raw/task_issue-269_sa3_impl.md`、`wiki/raw/task_issue-269_sa4_review.md`（本文件） | SA 产物惯例位 | SA3/SA4 报告 | 非实现改动 |

DENY 遵守（实测）：`packages/namespace-api/test/**` 既有 4 文件零改动、#269 5 文件为 SA6 untracked
冻结件（sha256 逐字节一致，见 §9）；`packages/namespace-registry/**`、`packages/vfsl/**`、
`packages/persistence/**`、`package.json`、`docs/adr/**`、`CONTEXT.md`、`docs/protocols/**` 零改动；
无 4xx/422/limits/owner 文法/problem shape 实现代码（T5 default 保持 throw 为直接证据）。
**范围结论：无越界、无 ALLOW 扩张。**

## 7. 契约连锁审查

| Contract | Caller | Actual handling | Risk | Finding |
|---|---|---|---|---|
| `RestRouterOptions` observer 类型收窄 `() => void` → `(event) => void` | #267 冻结测试（`NOOP_OBSERVER = (): void => {}`，全部构造点 grep 实测）；仓内无其它 `@nomicore/namespace-api` importer（grep 实测为空） | 零参函数按 TS 少参规则可赋值；`RouterOptionsShape` 本地形状仅经 `as unknown as` 用于 TypeError 用例，无赋值方向问题 | 低（静态可证；编译动态复核见 §11） | — |
| `handle` 新结局族（503/500 Response + abort rejection） | composition root / 未来 server（#270；仓内暂无装配方） | README/AGENTS 已写明 abort 为有界 rejection（不得记 500/重试）；判别子私有性已在两文档声明 | 低（#270 设计时消费） | — |
| `orchestrateCreateNamespace` 签名改对象 deps | 唯一调用方 `rest.ts`（grep 实测仅 1 处调用 + 1 处 import） | 同票更新 | 无 | — |
| `RestMetricsEvent`/`RestDiagnosticEvent` 新导出 | `index.ts` re-export；package.json exports 未动 | 类型经既有 `.`/`./rest` 入口流出；`rest-public-seam-wiring` 只断言子路径存在，非导出集合快照 | 无 | — |
| Registry（被调方） | 窄 issue 联合 / branded fatal / catch-all | 调用方式与输入零变化（恰三键 `{owner,schema,root}` 与 HEAD 一致） | 无 | — |
| #268 共享读取段 seam | #268（在途） | 排序不变量（abort 先于 413；读取期结局发射前再核对）已写入 AGENTS.md/README；C5 锁定 | 低（跨票治理已登记给总控与 #268 派发面） | — |
| `@nomicore/vfsl` `deriveSchemaIdentity` / Persistence | 被调方 | 零变化（同步纯函数实测；不触碰） | 无 | — |

## 8. 错误、恢复与并发

静态逐项攻击（含 SM/ER 系列复核）：

- **判别面稳定性**：窄 code（switch）/ `instanceof` + `.committed` / catch-all / 私有 abort 类 /
  body 族原样传播——五类分类互斥完备；instanceof 失配的 wrapped fatal 落 T8（500 + diagnostic，
  诚实非静默，设计 A4 已论证）。
- **无静默失败**：release 失败是唯一被吞的创建后错误，且以 diagnostic 上报 + 仍 201（诚实已知事实）；
  `emitMetrics`/`emitDiagnostic` 的 catch 仅包 observer 调用（try 块内唯一语句），不会吞业务错误。
- **恰一次/恰一个**：metrics 单出口单发射（errorResponse 内部 / abortSettle / 成功点各一）；release
  恰一次 awaited；无重试。
- **abort race 卫生**：入口判定 → 监听器注册 → race 全同步段（无 await 间隔，abort 事件不可能落入
  观察间隙）；`Promise.race` 对两 promise 挂接反应，json() 败方晚到 rejection 无 unhandled rejection；
  finally 无条件摘除监听器；不 `request.body.cancel()`（读持锁，归 server 票）。
- **接纳后取消隔离**：`registry.create` 调用后源码零 `signal` 读取（grep 实测 L200 后无 signal）；
  C3/C4 的 gate-promise 时序锚与 release 计数锁定该语义。
- **TOCTOU/并发**：router 构造后冻结零状态；每请求独立闭包 + 一次性监听器；owner 对象 frozen（Registry
  输入与 diagnostic 事件共享同一不可变引用，宿主无法经事件改写 Registry 输入）。
- **进程边界**：无新持久化/wire 面；事件仅进程内同步回调（不上 wire、不落盘）。
- **fail loud 保持**：signal 缺失自然 TypeError；unreachable owner 捕获断言保持；T5/body/derive 族
  rejection 文案与 HEAD 逐字一致。

## 9. 测试质量审查

SA4 不运行测试；以下为测试源码与入口的静态审查（红灯基线、绿灯结果为 SA6/SA3 实跑证据，另见 §11）。

| Test | Behavior asserted | Runner entry | Weakening or gap | Finding |
|---|---|---|---|---|
| mapping 9 用例（B1–B7 + 负控 2） | 503/500×3 逐字 code + content-type + 敏感值零泄漏（owner/schema/root/issue message 哨兵）；恰一 metrics 事件且 code=body code；diagnostic 恰一 + cause 引用相等 + kind；B4 同断言点反断言 ≠FAILED/≠OUTCOME_UNKNOWN；负控：正常 201、未匹配/405 零触达零事件 | 根 `pnpm test`（vitest include `packages/*/test/**/*.test.ts`）+ 包 AGENTS.md 验证命令 + CI 分片（磁盘枚举，新文件自动装箱兜底权重，`test -n` 防空片 + `--passWithNoTests=false`） | 无 skip/only/todo（grep 实测）；断言全部为行为级（HTTP 状态/形状/值、observer 实参、Registry seam 输入/结算），无源码字符串断言 | — |
| abort 5 用例（C1/C2/C5/C3/C4） | pre-abort/mid-read（pull 计数锚）有界 rejection + 零触达 `invocations===[]` + `['aborted']`；C5 反断言非 413；C3/C4 gate-promise 时序锚 + release 恰一次 + lease released + `['succeeded']` | 同上 | 时序锚为 pull/release 计数而非 sleep；C2 的 2s 是有界性断言上限（M7 证明判别力） | — |
| observer 6 用例（D1–D6） | 构造 TypeError 门；恰一 succeeded 事件 + 键白名单/词表/operation 常量；双 observer 同 throw 下 201/503/500/201 不变；release-failure diagnostic exact cause；fatal 二分/unknown/违例四路 kind+cause+无 schema/root/issues；全分支矩阵计数 1×succeeded/1×unavailable/5×failed/1×aborted + `ns-` id 泄漏扫描 | 同上 | D6 对 403/405 只做「出现即合规」扫描（不锁存在性）——与设计 §7.4.2 裁决一致，非弱化 | — |
| support 9 用例（恒绿锚） | 真实 Registry 四类故障产物；committed:true 可被另一 registry open 读回；Node abort 平台事实；探针判别力 | 同上 | 不 import router，红灯基线下恒绿（SA6 §6 实跑证明） | — |
| 冻结完整性 | 5 文件 sha256 实测 = SA6 §13.4 逐字节（`14062b3d…`/`9f9688ab…`/`14465a40…`/`2f298a8e…`/`dbf8778a…`） | — | 无改写、无断言弱化；#267 既有 4 文件零 diff | — |
| 类型门 | `tsconfig.typecheck.json` include `packages/*/test/**/*.ts`；root `pnpm typecheck` 15 包链含 namespace-api | CI typecheck 作业（Node 20）+ SA3 V2–V4 | 静态可证兼容（§7）；动态复核见 §11 | — |

CI 触发性：test 作业 Node 20/24 × 6 分片由 `scripts/ci-test-shard.mjs` 磁盘枚举分配（注释明示「新增
测试文件即使不在权重表里……绝无静默漏跑」），新 5 文件必然落入某分片；mapping/abort/observer/support
均匹配 `*.test.ts` include；harness 不被收集（非 `.test.ts`）。

## 10. Required revisions

无 BLOCKER / MAJOR finding。阻断修订清单为空。

## 11. 后续动态验证项

| Risk | Driver | Expected observation | Failure condition |
|---|---|---|---|
| SA3 V1（64/64 绿 ×3）、V2–V4（tsc 0 error）为 SA3 实跑声明，SA4 纪律下未复跑 | 任意评审/合并前复跑 `NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run --typecheck packages/namespace-api/test` 与 `pnpm typecheck` | `Tests 64 passed (64)`、`Type Errors: no errors`、tsc exit 0 | 任一失败或与 SA6 §13.1 红灯基线的 47 绿用例出现回归 |
| 冻结 support 文件钉死 Node 24 平台事实（pre-aborted + 完整 body → `json()` 仍 resolve；mid-read abort 不自结算），CI test 矩阵含 **Node 20** 腿 | CI 首跑（push/PR）Node 20 分片 | support §5 两用例在 Node 20 同样绿（undici 行为跨版本一致） | Node 20 下平台事实不同导致 support 平台锚红——router 语义本身不受影响（显式观察 signal），但需 SA6 修订轮重估平台锚表述 |
| 真实 server 下 mid-read abort 的败方 `json()` promise 长期 pending 与 body/stream 清理 | #270 server 票（listener/连接生命周期） | abort rejection 后连接关闭时无 unhandled rejection、无流泄漏 | 连接半开或进程级 rejection 噪声 |
| `#268` 合入后 C5 与排序不变量（abort 先于 413；读取期结局发射前再核对 `signal.aborted`，含 malformed-JSON 分支） | #268 实现 + 本票冻结测试复跑 | C5 保持绿；413/400 发射不抢在 abort 前 | abort 与超限同现时得到 413/400 而非 aborted |

## 12. Non-blocking observations

| ID | 观察 | 建议 |
|---|---|---|
| OBS-A | 重写后的包契约文档引入了与 SA2 OBS-1 同源的过宽概括句：AGENTS.md「exactly one low-cardinality metrics event per orchestration」与 README L9「每次编排恰一个低基数 metrics 事件」对过渡期 unmapped 族（malformed JSON、顶层形状、VFSL derive 失败、T5 三码）不成立——这些编排零事件（设计精确口径如此，冻结契约亦不要求该族发射）；AGENTS.md 同句把 `code` 列为恒在键而成功/abort 实际省略。SA3 报告「包契约文档与实现零矛盾」对该三处重写本身成立，但对新增概括句略有夸大 | 后续文档修订轮把概括句改写为「#269 拥有的终局路径恰一事件；unmapped 族与 403/405 过渡期零事件（`rejected` 发射策略归 #268）」；SA7 标准审查可将「包契约文档与实现零矛盾」作为检查点复核 |
| OBS-B | SA3 静态声明「无设计偏离」总体成立，但两处实现细节未在「Deviations」节而只在表格/报告正文出现：`errorResponse` 携带 metricsObserver 首参、`CreateNamespaceOrchestrationDeps` 从私有模块 export（均已披露且不破坏包私有性，本审查确认非偏离） | 无需动作；若 SA3 报告有修订轮，可在 Deviations 节集中列出以降低后续审查核对成本 |

---

## 附：证据与边界

- 本审查为纯静态：读取源码/测试/设计/ADR/diff/git 状态/哈希（`sha256sum`、`git hash-object`、
  `git diff --stat`、`git show`）；未修改任何实现、设计或测试；未运行测试/服务/临时进程。
- 实测锚点：HEAD `0b06050`；ADR-0015 blob `64daa16a43ef2718f7f8d692f77a82ac7517e341`、
  sha256 `3a75f99b85c6bbba54086359bc71df52d94aaecb3f44d5212d0f98421082d148`；5 冻结测试哈希
  见 §9；`registry.ts` committed 矩阵锚（L897/L1469–1471/L1539/L1547/L1583 及 operational
  分支）逐行核对与设计 §2 锚点 8 一致。
- Issue-comment REST snapshot 为空（dispatch/SA6/SA8/SA3 四源一致）——无 owner 评论级要求可核对。

*本报告为 SA4 唯一新增产物（`wiki/raw/task_issue-269_sa4_review.md`）。*
