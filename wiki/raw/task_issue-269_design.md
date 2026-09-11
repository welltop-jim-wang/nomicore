# SA1 实施设计 — Issue #269：REST create 的 Registry 失败语义、取消边界与双 observer 契约

> 阶段：design（iteration 0）。派发：`sa-0b806535-9806-46db-9ed5-0826874f54e9`（mabf-sa1）。
> 上游：SA6 验收契约已 `approve`（`wiki/raw/task_issue-269_sa6_contract.md`，29 用例红灯固化 + 绿灯可满足性 + 14 组变异）；SA8 前置门禁 `clear`（0 冲突 / OBS-1/2/3 三条提示，报告实际位于 `artifacts/sa8-conflict-report-issue-269.md`）。
> ADR 修订锚：worktree HEAD `0b06050`（`fix(#267): REST router 骨架…(#296)`，branch `mabf/issue-269`）；`docs/adr/0015-vertical-rest-namespace-create.md` git blob `64daa16a`、sha256 `3a75f99b…`、状态**提议**（L4），父 PR #158 OPEN（SA8 OBS-1；本设计不修改 ADR 文本）。
> 本设计对 SA6 §12.1 形状提案（H-M/H-D/H-A）与 §12.2 裁决（R1–R4）**全部确认采纳**（§7），无需回写契约测试。

---

## 1. 任务类型、目标与非目标

**任务类型：Feature**（在 #267 已交付的 REST router 骨架上，按 ADR 0015 叠加「Registry 失败映射 + 取消边界 + 双 observer 事件契约」三个显式延后项；不是 Bug 修复）。

### 目标（本票交付）

1. **失败映射**：`handle` 对 #269 拥有的结局族以 HTTP Response 结算（替换骨架的 fail-loud rejection，纯加法）：
   - 窄 issue `REGISTRY_NOT_ACCEPTING` → 503 + 逐字 code；
   - 窄 issue `NAMESPACE_CREATE_FAILED`（typed operational failure）→ 500 + 逐字 code；
   - Registry fatal 且 `committed:true` → 500 `NAMESPACE_CREATE_OUTCOME_UNKNOWN`；
   - Registry fatal 且 `committed:false` → 500 `INTERNAL_ERROR`（**R1 裁决，见 §7.2**）；
   - unknown exception 与内部契约违例（`NAMESPACE_CREATE_INVALID_INPUT` / `NAMESPACE_ALREADY_EXISTS`）→ 500 `INTERNAL_ERROR` + diagnostic 上报。
2. **取消边界**：body 读取阶段显式观察 `Request.signal`（入口同步判定 + 读取×abort race），中断 → 有界 `handle` rejection + Registry 零触达 + metrics `aborted`；Registry 接纳后不再观察 signal，等待 create settle 并恰一次 release。
3. **Observability**：两个 observer 参数类型事件化（`() => void` → `(event) => void`，零参调用方仍兼容）；每请求恰一个 metrics 低基数事件；diagnostic 仅三类 kind、exact cause 对象引用、无 schema/root/完整 issues；observer throw 全分支隔离。
4. 文档同步：包 `AGENTS.md` deferral 清单与 `README.md` Public API / Deferred scope 更新。

### 非目标（明确不做）

- **#268 拥有的 4xx/422 族**：owner 文法/percent-encoding/query/Content-Type/Encoding 拒绝（400/415）、limits 执行与 413、顶层形状校验的 400、`NAMESPACE_SCHEMA_INVALID` / `NAMESPACE_ROOT_INVALID` 的 422、完整 problem shape（message/issue 投影/`issuesTruncated`）。这些结局在 #269 合入后**仍保持骨架现状：unmapped rejection**（`create-namespace.ts` L37–49 现状不变）。
- metrics `rejected` outcome 的事件发射（403/405/未来 4xx）：词表值保留，发射策略归 4xx 族 owner（§7.4 D-4）。
- HTTP listener、server 装配、graceful drain、abort 后的 body/stream 清理（归未来 server 票 #270 / FR-5）。
- ADR-0015 状态变更（接受流程属父 PR #158 治理，不在本票）。
- Registry、Persistence、VFSL 任何行为变更。

---

## 2. 当前行为与证据锚点（HEAD `0b06050`）

| # | 当前行为 | 证据锚点 |
|---|---|---|
| 1 | 骨架显式声明「Registry 失败映射、signal、observer 事件」延后；非成功结局一律 `handle` rejection，零 HTTP 错误 Response | `packages/namespace-api/src/rest.ts` L15–20 头注；包 `AGENTS.md` deferral 清单；`README.md` Deferred scope |
| 2 | observer 构造期强制显式注入（`typeof === 'function'` 校验），但类型为**零参** `() => void`，且全路径零事件发射 | `rest.ts` L44–47/L53–55/L137–144；`src/create-namespace.ts` 全文无 observer 引用 |
| 3 | body 读取是裸 `await request.json()`：不观察 `Request.signal`（Node 24 平台事实：pre-aborted + 完整 body 时 `json()` 仍 resolve；mid-read abort 时读悬挂不自行结算） | `create-namespace.ts` L36；`packages/namespace-api/test/rest-failure-contract-support.test.ts` §Request abort 运行时事实（恒绿锚） |
| 4 | `!created.ok` 一律抛内部 `Error`（`unmapped registry issue: <code>`，cause=issue），不区分窄 issue 族 | `create-namespace.ts` L61–63 |
| 5 | `registry.create` rejection（含 `NamespaceRegistryFatalError`、unknown exception）无 catch，原样传播 | `create-namespace.ts` L56–63（无 try/catch） |
| 6 | release 失败被静默吞掉（仍 201、不重试、不二次调用），**无 diagnostic 上报** | `create-namespace.ts` L71–75 |
| 7 | Registry 窄结果联合七种 code；fatal 为 branded class（`operation`/`phase`/`committed`/`cause` 稳定判别面，经 rejection 通道、绝不 resolve 伪装） | `packages/namespace-registry/src/types.ts` L275–310；`src/errors.ts` L21–45 |
| 8 | Registry create 的 committed 事实矩阵：`namespace-id-generation` 恒 false（`registry.ts` L897）；`create-document-internal` 为 `DocRuntimeFatalError.committed` 或 false（L1469/1471）；**`lifecycle-slot-internal` 原样传播 `DocCreateFatalError.committed`（可为 true 或 false，L1539/1547）**；`runtime-construction` 恒 true（L1583）；typed operational（`DocCreateOperationalError`）→ 窄 issue `NAMESPACE_CREATE_FAILED`（L1517–1523 区段） | `packages/namespace-registry/src/registry.ts` |
| 9 | `NAMESPACE_ALREADY_EXISTS` 不应到达 REST：普通 create 的 namespaceId 由 Registry 内部 CSPRNG 生成、碰撞内部重试 ≤8 次、耗尽以 committed:false fatal 失败 | ADR 0010 L28；ADR 0015 L180；`registry.ts` §ID 生成 |
| 10 | #267 冻结契约 4 文件 35 用例全绿（route/method/role gate、成功路径、Lease 语义、405/403 形状、公共 seam 接线）；判定顺序 route → method → role → owner → body → derive → create → DTO → release → 201 冻结不可 reorder | `packages/namespace-api/test/rest-{create-hub,role-gate-routing,contract-support,public-seam-wiring}*.test.ts`；`rest.ts` L112–117 |
| 11 | SA6 已固化 29 个 #269 契约用例：HEAD 基线 `17 failed | 47 passed (64)`、`Type Errors: no errors`，3/3 复跑一致；临时绿灯模拟件下 64/64 绿；14 组变异全部被目标断言捕获 | `wiki/raw/task_issue-269_sa6_contract.md` §5/§9/§13；5 个新测试文件（含 `rest-failure-contract-harness.ts` fixture） |

---

## 3. 能力缺口（承接 SA6 §8，Feature 语义）

- **失败映射缺口**：四类目标结局（503 / 500 FAILED / 500 OUTCOME_UNKNOWN / 500 INTERNAL_ERROR）在骨架上一律 rejection（红灯 B1–B7）；`handle` 的判别结果是唯一 HTTP seam，无映射即无 503/500 语义。
- **取消缺口**：不观察 signal ⇒ pre-aborted 请求仍真的调用 Registry（红灯 C1/C5：`invocations === ['create']`）；mid-read abort 悬挂不结算（红灯 C2）。
- **观测缺口**：observer 只有参数位没有事件契约 ⇒ 全分支零发射（红灯 D2/D4/D5/D6）；release 失败无上报（红灯 D4）。
- **放大因素**（SA6 支撑文件实测）：Node 24 的 `Request.signal` 不使进行中的 body 读自行失败——abort 语义必须由 router 显式观察，不能依赖平台。
- 三个缺口都是 #267 显式延后项（证据锚点 1），本设计为纯加法叠加，不 reorder 任何冻结顺序。

---

## 4. Owner 要求落实

Issue #269 comments REST snapshot 为**空（`[]`）**（任务简报 `wiki/raw/task_issue-269.md` Comments 节；SA8/SA6 一致确认）——无评论级 Owner 要求或 override，issue body 即全部要求。

| 输入来源 | 要求 | 设计落实 |
|---|---|---|
| Issue body「失败映射」段 | 503 / 500 FAILED / 500 OUTCOME_UNKNOWN / 500 INTERNAL_ERROR 精确映射；INVALID_INPUT 与 ALREADY_EXISTS 视为内部契约违例→安全 500 + diagnostic；REST 不返回 NAMESPACE_ALREADY_EXISTS | §7.1 映射表（T1–T7）、§7.2 R1 确认、§7.5 R4 确认 |
| Issue body「取消边界」段 | body 读取尊重 `Request.signal`、中断后 Registry 零触达；调用 Registry 后不传播取消、等待 settle 并 release | §7.3 abort 状态机（H-A/R2/R3 确认） |
| Issue body「Observability」段 | 两 observer 显式注入；throw 隔离；metrics 低基数无敏感字段；diagnostic 三类事件、不带 schema/root/完整 issues；Host 视为敏感运维接口 | §7.4 事件形状与发射矩阵（H-M/H-D 确认）、§9 隔离机制 |
| AC1–AC6 | 六条验收 | §12 验收映射（6/6 对应 SA6 断言） |
| Blocked by #267 | 依赖已解除（#267 CLOSED，PR #296 = HEAD `0b06050`） | §2 证据锚点 10 |

---

## 5. 复现和根因承接

| 上游事实（SA6） | 证据位置 | 设计响应 |
|---|---|---|
| 能力缺口红灯基线：17 failed / 47 passed (64)，3/3 逐位一致，`Type Errors: no errors`；红灯全部落在目标断言（四类映射 8、metrics 缺失 3+2、Registry 被触达 3、abort 悬挂 1） | SA6 §5/§13.1 | §7 实现语义后目标断言转绿；#267 legacy 35 + 支撑 9 + 负控 2 + D1 共 47 绿保持不变 |
| 绿灯可满足性：临时模拟件（abort-aware 读 + 四类映射 + 双 observer 事件 + throw 隔离）下同测试字节 64/64 绿 | SA6 §9 E1/§13.2 | 本设计与该语义同构（唯一变量 = 目标语义存在），风险主要在边界细节而非可满足性 |
| 变异矩阵 M0+M13 全部被捕获（含 M1 fatal committed:false→FAILED、M2 fatal committed:true→INTERNAL_ERROR、M6 去掉入口同步判定、M7 去掉 race、M8 接纳后传播取消） | SA6 §9 E2 | §7.1/§7.3 的设计决策逐条对应被钉死的语义（映射表 + 入口同步判定 + race + 接纳后零观察） |
| Node 24 运行时事实：pre-aborted + 完整 body ⇒ `request.json()` 仍 resolve；mid-read abort ⇒ 读不自行结算 | `rest-failure-contract-support.test.ts`（恒绿） | §7.3 必须显式观察 signal（入口同步判定 + abort race），不得依赖平台 |
| 四类故障输入均为真实 Registry 产物（shutdown → NOT_ACCEPTING；`DocCreateOperationalError` → FAILED；testing 注入 → fatal committed:false/true，且 committed:true 的 namespace 可被另一 registry open 读回） | SA6 §6/§8；support 文件 | 映射以 Registry 公共联合/branded class 为唯一判别输入（§7.1），不依赖注入 seam 的存在 |
| OBS-2 缺口（fatal committed:false 未落位）由契约钉死为 → 500 INTERNAL_ERROR | SA6 §12.2 R1；B3/B4 对照 + M1/M2 | §7.2 设计确认 R1（含 committed 而非 phase 作为判别子的额外论证） |
| OBS-3 #268 共享 body 读取段；abort 优先于 413（C5） | SA6 §12.4/R3；abort C5 | §7.6 共享 seam 设计与排序不变量 |

上游事实与源码无矛盾（SA6 引用的行号与本设计 §2 锚点在 HEAD `0b06050` 逐一对得上）。

---

## 6. SA8 约束落实

SA8 固定位置产物 `wiki/raw/task_issue-269_conflict_report.md` 与 `task_issue-269_relevant_decisions.md` **不存在**；替代证据 = `artifacts/sa8-conflict-report-issue-269.md`（verdict `clear`，15/15 一致，0 冲突）。决策锚定由本设计直接引用 ADR 文本完成（§2/§7 引用行号均为 HEAD `0b06050` 实测）。

| SA8 决议/义务 | 设计位置 | 处理方式 | 是否需要设计后冲突复查 |
|---|---|---|---|
| F1 `REGISTRY_NOT_ACCEPTING` → 503（零提交、可稍后重新请求） | §7.1 T1 | 503 + 逐字 code；metrics `unavailable`；零 diagnostic | 否（ADR 0015 L175 逐字） |
| F2 typed operational → 500 FAILED（code 语义保证 committed:false） | §7.1 T2 | 窄 issue 通道专属映射；零 diagnostic | 否（L176 + ADR 0009「Registry 只把 typed operational error 映射为公开 create issue」） |
| F3 fatal committed:true → 500 OUTCOME_UNKNOWN（不得自动重试） | §7.1 T6 | `instanceof` + `committed===true` 判别 | 否（L177 + ADR 0009 §Create） |
| F4 unknown/内部违例 → 500 INTERNAL_ERROR + diagnostic | §7.1 T3/T4/T7 | 见 §7.5 R4 | 否（L178/L180 + ADR 0010 L28） |
| C1/C2 取消边界（L113 逐字） | §7.3 | abort 状态机 | 否 |
| O-1/O-2/O-3 Observability（L186–190 逐字） | §7.4/§9 | 事件形状 + 隔离 | 否 |
| OBS-1 ADR-0015 仍为「提议」：设计须锚定修订版本 | 文档头 + §13 | 锚定 HEAD/blob/sha256；若 0015 接受前被修订，本设计与契约须重过门禁 | **是**（合并进 §14 总裁决） |
| OBS-2 fatal committed:false 落位属 SA1 职责 | §7.2 | 确认 R1：→ 500 INTERNAL_ERROR | **是**（填补 ADR 欠规格分支，合并进 §14） |
| OBS-3 与 #268 共享 body 读取段，声明 seam 裁决 | §7.6 | abort 优先（R3/C5）+ 纯加法边界 | **是**（跨票排序先例，合并进 §14） |

---

## 7. 设计决策与主要备选方案

### 7.1 失败映射总表（`orchestrateCreateNamespace` 的终局状态机）

判别输入**只有** Registry 公开面：窄结果联合的 `code`、rejection 通道的 `NamespaceRegistryFatalError`（instanceof）、其余 throw。HTTP body 统一最小 problem 面 `{"code":"…"}` + `content-type: application/json`（与骨架既有 403/405 body 先例同构；完整 problem shape 归 #268；message 字段本票省略，后补为加法）。

| # | Registry 结局 | 判别 | HTTP | metrics 事件 | diagnostic 事件 |
|---|---|---|---|---|---|
| T1 | 窄 issue `REGISTRY_NOT_ACCEPTING` | `!ok && code` | 503 `{code:'REGISTRY_NOT_ACCEPTING'}` | `{outcome:'unavailable', code:'REGISTRY_NOT_ACCEPTING', status:503}` | 无 |
| T2 | 窄 issue `NAMESPACE_CREATE_FAILED` | 同上 | 500 `{code:'NAMESPACE_CREATE_FAILED'}` | `{outcome:'failed', code:…, status:500}` | 无（typed operational 非三类事件） |
| T3 | 窄 issue `NAMESPACE_CREATE_INVALID_INPUT` | 同上 | 500 `{code:'INTERNAL_ERROR'}` | `{outcome:'failed', code:'INTERNAL_ERROR', status:500}` | `{kind:'unknown-exception', cause:<issue 对象引用>}` |
| T4 | 窄 issue `NAMESPACE_ALREADY_EXISTS` | 同上 | 同 T3 | 同 T3 | 同 T3（R4） |
| T5 | 窄 issue `NAMESPACE_INVALID_IDENTITY` / `NAMESPACE_SCHEMA_INVALID` / `NAMESPACE_ROOT_INVALID` | default 分支 | **不变：unmapped rejection**（400/422 归 #268） | 无 | 无 |
| T6 | throw `NamespaceRegistryFatalError` 且 `committed === true` | `instanceof` + `.committed` | 500 `{code:'NAMESPACE_CREATE_OUTCOME_UNKNOWN'}` | `{outcome:'failed', code:…, status:500}` | `{kind:'registry-fatal', cause:<fatal 引用>, operation, phase, committed:true, owner}` |
| T7 | throw `NamespaceRegistryFatalError` 且 `committed === false` | 同上 | 500 `{code:'INTERNAL_ERROR'}`（**R1**） | `{outcome:'failed', code:'INTERNAL_ERROR', status:500}` | `{kind:'registry-fatal', cause:<fatal 引用>, operation, phase, committed:false, owner}` |
| T8 | 其余任意 throw（unknown exception） | catch-all | 500 `{code:'INTERNAL_ERROR'}` | `{outcome:'failed', code:'INTERNAL_ERROR', status:500}` | `{kind:'unknown-exception', cause:<error 引用>, owner}` |
| T9 | abort（body 读取阶段，§7.3） | signal 观察 | **无 Response：`handle` rejection**（H-A/R2） | `{outcome:'aborted'}`（无 code、无 status） | 无 |
| T10 | create 成功 + release 成功 | `ok` | 201（不变） | `{outcome:'succeeded', status:201}`（无 code） | 无 |
| T11 | create 成功 + release 失败 | release catch | **仍 201**（不变：已知创建事实不被改变；不重试、不二次调用） | `{outcome:'succeeded', status:201}` | `{kind:'lease-release-failure', cause:<release error 引用>, owner, namespaceId:<DTO 副本 id>}` |

要点：

- **committed 是 fatal 二分的唯一判别子，phase 只作诊断信息**。源码事实（§2 锚点 8）：`lifecycle-slot-internal` 的 committed 原样传播自 `DocCreateFatalError`，**可为 true 也可为 false**；因此「按 phase 推断提交事实」是错误设计，必须读 `fatal.committed`。T6/T7 以 committed 为准后，全部四个 phase（`runtime-construction` / `create-document-internal` / `lifecycle-slot-internal` / `namespace-id-generation`）都被正确覆盖：`namespace-id-generation` 恒 false → T7；`runtime-construction` 恒 true → T6；另两个 phase 按 committed 分流。
- **诊断事件的 cause 是「跨过边界的那颗错误对象」的引用**：fatal 分支 = `NamespaceRegistryFatalError` 实例本身（不是 `fatal.cause`）；内部违例 = 窄 issue 对象；unknown = 抛出的异常；release 失败 = release 抛出的异常。这是 SA6 D5 断言的引用相等面。
- **503 的重试语义**是响应语义（可稍后重新请求、明确零提交），本票不加 `Retry-After` 头（AC 与 ADR 均未要求，不发明）。
- T5 保持 rejection 是刻意的：4xx/422 族归 #268，此处映射会抢跑其契约并违反纯加法纪律。

**备选方案（未选择）**：

- *A1：把 fatal committed:false 映射为 500 NAMESPACE_CREATE_FAILED*——被拒：FAILED 的 code 语义专属 typed operational failure 的窄 issue 通道（ADR 0015 L176、ADR 0009「Registry 只把 typed operational error 映射为公开 create issue」），fatal 不经该通道；且 L182 允许调用方对 FAILED「修正或重新发起」，内部故障不应获得该语义。变异 M1 证明契约会捕获该偏差。
- *A2：把 fatal committed:false 映射为 500 OUTCOME_UNKNOWN*——被拒：OUTCOME_UNKNOWN 专属 committed:true（L177），committed:false 时结局确定（零提交），报「未知结局」是不诚实。变异 M2 证明契约会捕获。
- *A3：为 5xx body 增加 message 字段*——推迟：完整 problem shape 归 #268；最小 `{code}` 与骨架 403/405 先例同构，且契约 `expectNoSecretLeak` 只要求不泄漏敏感值。后补 message 是加法。
- *A4：以 `error.code === 'NAMESPACE_REGISTRY_FATAL'` 代替 instanceof 判别*——未选为主判别（instanceof 是 Registry 文档化稳定判别面且为测试/support 采用）；但 instanceof 失配的 fatal 形态会落入 T8 unknown-exception → 500 INTERNAL_ERROR + diagnostic，仍是诚实终局（不静默、不伪装），可接受的安全降级。

### 7.2 R1 确认：fatal `committed:false` → 500 `INTERNAL_ERROR`

采纳 SA6 裁决，设计确认，理由链（SA8 OBS-2 把该落位显式交给设计）：

1. `NAMESPACE_CREATE_FAILED` 的 code 语义「保证 committed:false」是**窄 issue 通道**的承诺（ADR 0015 L176 + ADR 0009 §Persistence 错误演进：Registry 只把 typed operational error 映射为公开 create issue；fatal 走 branded rejection 通道，绝不 resolve 伪装）。把 fatal 映射进 FAILED 会合并两条语义不同的通道，并错误授予「可重新发起」暗示。
2. `NAMESPACE_CREATE_OUTCOME_UNKNOWN` 的全部含义是「可能已提交、不得自动重试」——专属 `committed:true`（ADR 0015 L177、ADR 0009 §Create L70）。committed:false 时结局确定，报 UNKNOWN 不诚实。
3. 提交前 branded fatal（`namespace-id-generation` 碰撞预算耗尽、`create-document-internal`、`lifecycle-slot-internal` pre-commit、非法 Clock 等）是**内部服务故障**，正落 L178 残留类「unknown exception 或内部契约违例」的语义（内部契约 = 服务自身机器的契约）。
4. 契约以 B4 正向锁定 + B2/B3 反向排除（同一断言点反断言 ≠FAILED、≠OUTCOME_UNKNOWN）+ M1/M2 双向变异捕获。

### 7.3 取消边界（H-A/R2/R3）：body 读取的 abort 状态机

`orchestrateCreateNamespace` 的读取段收敛为单一私有 helper `readRequestBody(request)`，内部固定次序：

```
readRequestBody(request):
  signal = request.signal                      # 标准 Web Request 恒有 signal（ADR 0015 L32 seam）；
                                              # 缺失/非对象 ⇒ 自然 TypeError，fail loud，不静默当作「永不中断」
  1. 入口同步判定：if (signal.aborted) → abortSettle()
  2. raced read：
       abortPromise = signal 'abort' 事件（once；resolve 值不用，事后再核对 signal.aborted）
       body = await Promise.race([ request.json(), abortPromise ])
       3. 读胜出后同步再核对：if (signal.aborted) → abortSettle()   # abort 在整个读取阶段优先
       return body                              # json() rejection 原样传播（malformed JSON 仍 unmapped，归 #268）
     finally: removeEventListener（无论读/abort 谁胜，监听器必被清理）
```

- `abortSettle()`：发射 metrics `{operation, outcome:'aborted'}`（隔离，无 code/status）→ throw 私有 `RestBodyReadAbortedError`（包内错误类，**不导出**；rejection 值形状本票非契约面，未来 server 票若需公共判别子再以加法提升）。**零 diagnostic**。
- **Registry 零触达的结构保证**：`readRequestBody` 返回后的派生/封装/`registry.create` 调用之间只有同步代码（形状检查、`deriveSchemaIdentity` 同步纯函数、envelope 组装），不存在异步窗口 ⇒「入口判定 + race + 胜出再核对」三道闸门之后，任何被观察到的 abort 都必然发生在 Registry 触达之前。
- **接纳后零观察**：`registry.create()` 一经调用（含 create/release 在途），全程不再读取 `signal`——客户端中断不传播、等待 create settle、DTO 复制、恰一次等待 `lease.release()`、仍 201（C3/C4）。
- **有界性**：入口判定同步结算（C1/C5）；mid-read abort 由 race 的 abort 事件结算（C2），不依赖平台读自行失败（SA6 支撑文件的 Node 24 事实）。
- **未处理拒绝卫生**：race 对两个 promise 都已挂接反应，败方（如 server 拆连接后 `json()` 才 reject）不会产生 unhandled rejection；router 不尝试 `request.body.cancel()`（读持有 stream 锁，cancel 会 throw；body/stream 清理归 server 生命周期）。

**备选方案（未选择）**：

- *B1：仅入口同步判定（无 race）*——被拒：mid-read abort 悬挂（变异 M7/C2 红灯即此形态）。
- *B2：仅 race（无入口判定）*——被拒：pre-aborted + 完整 body 时平台 `json()` 直接 resolve，Registry 会被触达（变异 M6/C1/C5 红灯）。
- *B3：abort 伪造一个 HTTP Response（如 499/408）*——被拒（H-A 裁决）：router 无 listener、客户端已离开；ADR 未定义 abort 的 HTTP status；发明未评审 status 违反骨架「不发明 problem shape」纪律。唯一分类面是 metrics `aborted`。
- *B4：用 `signal.throwIfAborted()` 一次性调用*——被拒：只是一次性检查，观察不到「读进行中」的 abort 事件，无法给出界结算。
- *B5：接纳后仍观察 signal 并中断 release*——被拒：违反 C2/ADR L113「调用 Registry 后不传播客户端取消，必须等待 create settle 并 release Lease」（变异 M8）。

### 7.4 双 observer 事件契约（H-M/H-D 确认）

#### 7.4.1 类型面（`src/rest.ts` 公共定义，`index.ts` re-export）

```ts
/** metrics-safe 事件：低基数、无敏感字段（ADR 0015 L188）。 */
export interface RestMetricsEvent {
  readonly operation: string;   // 本 router 恒为常量 'namespace-create'（单 endpoint 唯一低基数 operation）
  readonly outcome: 'succeeded' | 'rejected' | 'unavailable' | 'failed' | 'aborted';
  readonly code?: string;       // 非 2xx 且非 abort 时出现；出现时必须等于 response body 的稳定 code
  readonly status?: number;     // 存在 HTTP Response 时出现；abort 无 status
}

/** 敏感 diagnostic 事件（ADR 0015 L190）：仅三类 kind；cause 恒为 exact cause 对象引用。 */
export interface RestDiagnosticEvent {
  readonly kind: 'registry-fatal' | 'unknown-exception' | 'lease-release-failure';
  readonly cause: unknown;
  readonly owner?: Readonly<{ userId: string }>;
  readonly operation?: string;      // 仅 registry-fatal：取自 fatal.operation（诚实透传）
  readonly phase?: string;          // 仅 registry-fatal：取自 fatal.phase
  readonly committed?: boolean;     // 仅 registry-fatal：取自 fatal.committed
  readonly namespaceId?: string;    // 仅 lease-release-failure：release 前 DTO 副本中的 id
}

export interface RestRouterOptions {
  // …role/registry/limits 不变…
  readonly metricsObserver: (event: RestMetricsEvent) => void;      // 由 () => void 收窄
  readonly diagnosticObserver: (event: RestDiagnosticEvent) => void;
}
```

- **兼容性**：参数收窄是类型层加法——零参 `() => void`（#267 冻结测试的 `NOOP_OBSERVER`）与 `(...args) => void` 记录器仍可赋值（TS 少参函数可赋给多参签名）；构造期校验逻辑不变（仍 `typeof === 'function'`，D1 门保持）。
- 事件类型定义放 `rest.ts`（公共面）；`create-namespace.ts` 以 `import type` 引用（类型环引用在 TS/ESM 中安全擦除，运行时依赖保持 rest → create-namespace 单向）。

#### 7.4.2 发射矩阵与字段裁决

- **恰一个 metrics 事件/orchestration**：每个终局路径（T1–T4、T6–T8、T10、T11 各一；T9 aborted 一）在返回/抛出前发射一次；结构上每路径单出口单发射，无双发。403/405/未匹配 route **不发射**（这些分支在 orchestration 之外，`rejected` outcome 的发射策略连同 4xx 族归 #268/后续票——D6 对 403/405 只做「出现即合规」扫描，不锁存在性；#267 冻结行为是该两分支零事件，保持零事件是纯加法）。
- **`operation` 常量**：`'namespace-create'`（单一冻结匹配器、单一编排；未来第二个 endpoint 属另一 operation，届时再议多 operation 面）。
- **成功事件**：`{operation, outcome:'succeeded', status:201}`，**省略 code**（2xx 无 body code 可对齐；保持基数最小；SA6 §15 明示成功码取值留设计——本设计裁决为省略）。
- **aborted 事件**：`{operation, outcome:'aborted'}`，**无 code 无 status**（无 Response 存在，「code 必须等于 body code」的不变量无法诚实满足）。
- **diagnostic owner 字段**：三类事件统一携带 `owner: { userId: <route 捕获段> }`——ADR L190 允许携带「已验证 owner」；在真实 Registry 路径上，事件发射时该 owner 已过 Registry 接纳段的共享安全文法校验（ADR 0009）；REST 自身的 owner 文法校验属 #268 step 3，届时语义不变。事件只声称「本请求提交给 Registry.create 的 owner」，不声称更多。
- **diagnostic namespaceId 字段**：仅 `lease-release-failure` 携带（取 release 前 DTO 副本——创建事实已知，ADR L161 明示 release 失败须上报 owner、namespaceId 与 exact cause）；`registry-fatal` / `unknown-exception` **不携带**——`NamespaceRegistryFatalError` 不含 namespaceId（其判别面只有 operation/phase/committed/cause），REST 无从诚实获知，不得编造（「错误本身已知的 namespaceId」）。
- **绝不出现**：schema 原文、root、完整 validation issues（diagnostic 事件无 `issues` 键；cause 为对象引用，router 不序列化、不改写、不展开）。
- **时序**：metrics 事件在终局决定点（构造 Response 之后、返回之前）同步发射；diagnostic 在捕获点同步发射；两者都在 `handle` settle 之前完成（契约断言的是 settle 后可观察全集，同步发射满足）。

#### 7.4.3 observer throw 隔离（O-1/AC5）

私有发射 helper 一对：

```ts
function emitMetrics(observer, event: RestMetricsEvent): void {
  try { observer(event); } catch { /* 隔离：observer throw 一律不改变 HTTP 结果（ADR 0015 L186） */ }
}
// emitDiagnostic 同构
```

全部调用点一律经 helper，无裸调用。隔离是同步 try/catch（observer 契约为同步 void）；四类分支（201/503/500/release-failure）+ 双 observer 同 throw 均不改结果（D3）。**备选（未选择）**：仅在个别分支包 try/catch——被拒，遗漏面不可枚举；helper 化使「全分支隔离」成为结构性保证。

### 7.5 R4 确认：内部契约违例的 diagnostic 归类

`NAMESPACE_CREATE_INVALID_INPUT` / `NAMESPACE_ALREADY_EXISTS` 的 diagnostic 事件用 `kind:'unknown-exception'`：ADR L178 把「unknown exception」与「内部契约违例」归入同一 500 类，三类 kind 词表（L190：Registry fatal / unknown exception / Lease release failure）无第四类可容纳；cause = 注入/实际窄 issue 对象引用（exact cause），不携带完整 issues（这两类 issue 形状本就只有 code+message，但设计以「cause 引用、不展开字段」统一纪律表达）。

### 7.6 与 #268 的共享 seam（OBS-3/R3）

- **读取段 ownership**：`readRequestBody` 是两票共享的 step 4 seam。#269 拥有 signal 中断语义与排序不变量；#268 拥有形状/owner/query/Content-Type/Encoding/limits/413/415/400/422 与完整 problem shape。#269 本票**不消费 `limits`**（配置面继续预留冻结）。
- **排序不变量（R3 的实现形态）**：读取段入口的 abort 观察（§7.3 步骤 1）先于任何读取期检查（413 计数/判定）；#268 合入时，其 byte 计数与超限判定必须嵌在 raced read 内部或其后，且任何读取期结局发射前必须再核对 `signal.aborted`。该不变量由 C5 可执行锁定（pre-aborted + `maxBodyBytes:16` 超限 → aborted 非 413，Registry 零触达）：#269 单独合入时即绿（本票无 413 逻辑，入口判定必然先触发），#268 合入后必须保持绿。
- **ADR 冻结顺序的边界**：ADR L150–153 把 step 3（owner/query/Content-Type 检查）排在 step 4（body 读取）之前——abort 观察位于 step 4 入口，因此 #268 的 step-3 4xx（如 415）**可以**先于 abort 被结算，这是 ADR 顺序的正确结果，R3 只裁决「读取段内 abort 优先于 413」，不触及 step 3。两票结局族不相交（#268=4xx/422，#269=503/500+abort），互不改写。
- **纯加法**：#269 的 Response 替换仅覆盖 T1–T4/T6–T8 家族；T5 与 body/形状/派生失败保持 rejection，#268 以 Response 替换它们时同样纯加法。

### 7.7 接口与结构变更汇总

- `src/rest.ts`：两个 observer 选项类型事件化（§7.4.1）；新增并导出 `RestMetricsEvent` / `RestDiagnosticEvent`；`handle` 把 observers（连同 registry/owner）传入 orchestration；头注 deferral 清单更新（Registry 失败映射/signal/observer 事件从「延后」移入「已实现（4xx/422 除外）」）。公共 API 变化是**类型层加法 + 既有 rejections→Responses 的计划内替换**，无新子路径、构造签名不变。
- `src/create-namespace.ts`（保持包私有）：签名扩为接收 `{ registry, ownerUserId, request, metricsObserver, diagnosticObserver }`（私有面，自由变更）；新增 `readRequestBody`（§7.3）、发射 helper（§7.4.3）、`errorResponse(code, status)` 最小 problem 构造、映射终局（§7.1）；成功路径/DTO 复制/release 恰一次语义逐字保留。
- `src/index.ts`：re-export 两个事件类型。
- 私有错误类 `RestBodyReadAbortedError`（不导出）。

### 7.8 编排终局伪代码（实现角色可直接落地）

```ts
export async function orchestrateCreateNamespace(deps): Promise<Response> {
  const body: unknown = await readRequestBody(deps.request);        // §7.3：abort 边界；JSON/形状异常原样传播（#268）
  // —— 以下至 registry.create 调用全部同步（零异步窗口）——
  if (body === null || typeof body !== 'object' || Array.isArray(body))
    throw new Error('unmapped request shape（400 映射归 #268）');     // 保持 #267 现状
  const schemaText = …; if (typeof schemaText !== 'string' || !('root' in record))
    throw new Error('unmapped request shape（400 映射归 #268）');     // 保持现状
  const derived = deriveSchemaIdentity(schemaText);
  if (!derived.ok) throw new Error('unmapped VFSL issues（422 映射归 #268）', { cause: derived.issues });
  const envelope = { lang, version, id: derived.schemaId, text: schemaText };

  let created: CreateNamespaceResult;
  try {
    created = await deps.registry.create({ owner: { userId }, schema: envelope, root });  // 接纳点：此后零 signal 观察
  } catch (error) {
    if (error instanceof NamespaceRegistryFatalError) {
      emitDiagnostic(diagObserver, { kind: 'registry-fatal', cause: error, owner,
        operation: error.operation, phase: error.phase, committed: error.committed });
      return error.committed
        ? errorResponse('NAMESPACE_CREATE_OUTCOME_UNKNOWN', 500, 'failed')   // T6
        : errorResponse('INTERNAL_ERROR', 500, 'failed');                     // T7（R1）
    }
    emitDiagnostic(diagObserver, { kind: 'unknown-exception', cause: error, owner });
    return errorResponse('INTERNAL_ERROR', 500, 'failed');                    // T8
  }
  if (!created.ok) switch (created.code) {
    case 'REGISTRY_NOT_ACCEPTING':      return errorResponse('REGISTRY_NOT_ACCEPTING', 503, 'unavailable');  // T1
    case 'NAMESPACE_CREATE_FAILED':     return errorResponse('NAMESPACE_CREATE_FAILED', 500, 'failed');       // T2
    case 'NAMESPACE_CREATE_INVALID_INPUT':
    case 'NAMESPACE_ALREADY_EXISTS':
      emitDiagnostic(diagObserver, { kind: 'unknown-exception', cause: created, owner });                      // T3/T4（R4）
      return errorResponse('INTERNAL_ERROR', 500, 'failed');
    default:
      throw new Error(`unmapped registry issue: ${created.code}`, { cause: created });                          // T5：归 #268
  }
  const lease = created.lease;
  const dto = Object.freeze({ namespaceId: lease.namespaceId, schema: … });   // release 前复制（#267 冻结语义不变）
  try { await lease.release(); }                                              // 恰一次、等待 settle
  catch (error) {
    emitDiagnostic(diagObserver, { kind: 'lease-release-failure', cause: error, owner,
      namespaceId: dto.namespaceId });                                        // T11：仍 201，不重试不二次调用
  }
  emitMetrics(metricsObserver, { operation: METRICS_OPERATION, outcome: 'succeeded', status: 201 });  // T10/T11
  return new Response(JSON.stringify(dto), { status: 201, headers: { 'content-type': JSON } });
}
```

`errorResponse(code, status, outcome)` 内部：构造 `Response(JSON.stringify({ code }), { status, headers })` → `emitMetrics({ operation, outcome, code, status })` → 返回（发射与返回原子，恰一事件）。

---

## 8. 数据流路线

运行时数据形态变化：新增「错误/结局事实 → HTTP problem body」与「终局事实 → observer 事件」两条投影；创建主链路（Request→Registry→Persistence→DTO→Response）形态不变。

| 路线 | 触发者与输入 | 写入或创建点 | 转换与边界 | 存储或传输 | 读取或投影点 | 可观察结果 | 错误与清理 | 验收锚点 |
|---|---|---|---|---|---|---|---|---|
| 主链路（不变，本票仅加旁路） | server 调 `handle(Request)` | Registry 内 Persistence createDoc（事实源） | JSON parse→derive→envelope→`Registry.create` | Memory/FilePersistence | DTO 副本 → 201 body | 201 恰 `{namespaceId, schema}` | release 恰一次；失败仍 201 | #267 冻结 35 用例 |
| 失败投影 | Registry 窄 issue / fatal / unknown throw | `orchestrateCreateNamespace` catch/switch | 判别（code / instanceof+committed / catch-all）→ `{code}` JSON | HTTP Response body（进程内构造，server 负责上行） | 客户端按稳定 code 分支 | 503/500 四类，无敏感值泄漏 | unmapped 族仍 rejection（#268） | mapping B1–B7、D6 |
| metrics 事件 | 每个终局决定点（单出口单发射） | `emitMetrics`（同步、try/catch 隔离） | 终局事实 → 低基数四键事件（`operation` 常量） | 进程内同步回调；不落盘、不上 wire | Host metrics Adapter（本票外） | 恰一事件/orchestration；词表内 | observer throw 被吞，不改 HTTP 结果 | observer D2/D3/D6、abort C1–C3 |
| diagnostic 事件 | fatal 捕获 / 内部违例 / unknown / release 失败捕获点 | `emitDiagnostic`（同步、隔离） | 错误对象**引用**直传（不序列化/不展开/不截断） | 进程内同步回调；cause 永不上 wire | Host 敏感运维 Adapter（访问控制/采样/脱敏归 Host，ADR L190） | 三类 kind、exact cause 引用相等、无 schema/root/issues | 同上 | observer D4/D5、mapping B3/B4 |
| abort 结算 | `Request.signal` abort 事件（读取段内） | `abortSettle`（metrics `aborted` + throw） | signal 事件 → 有界 rejection | 无 HTTP 传输（客户端已离开） | 未来 server（连接取消面） | `handle` rejection、Registry 零触达、零 diagnostic | finally 移除监听器；败方 promise 经 race 已挂接，无 unhandled rejection | abort C1/C2/C5、D6⑩ |

无缓存、无最终一致性窗口、无跨进程边界新增；router 保持构造后零状态（除每请求内局部变量与一次性 abort 监听器——随请求结算即清理）。

---

## 9. 错误、恢复、并发与幂等

- **错误分类面**：Registry 公开联合（窄 code）/ branded fatal（instanceof + committed）/ 其余 throw / abort（私有错误类）/ body-JSON 与形状（原样传播，unmapped）。异常路径全部显式映射（T1–T9）或显式 fail-loud rejection（T5、body 族）；**无静默 fallback**：`request.signal` 缺失（非标准 Request）自然 TypeError，不当作「永不中断」。
- **恢复/重试语义（对调用方可观察承诺，ADR L182 对齐）**：503 = 明确零提交、可稍后重新请求；500 FAILED = typed operational、code 语义保证零提交、调用方可修正后重新发起；500 OUTCOME_UNKNOWN = 可能已提交、**不得自动重试**（后续可 open）；500 INTERNAL_ERROR = 不得自动重试。router 自身零重试：release 失败不重试、不二次调用（T11 仍 201）。
- **回滚**：本票无补偿动作设计——fatal committed:true 的已提交 namespace 由 Registry 保留（不补偿删除，ADR 0009 §Create）；REST 不承担任何 Registry 内部状态恢复。
- **并发**：router 无共享可变状态（构造后冻结 config；每请求独立闭包）；并发请求语义完全由 Registry 不变量维持（ADR 0015 测试决策「并发请求不在 router 全局串行」）。observer 必须是同步 void ⇒ 发射不引入并发原语；Host Adapter 自行承担线程/采样语义。
- **幂等**：REST create 本身非幂等（无 Idempotency-Key，ADR L182 明示限制）；「恰一次 release」「恰一个 metrics 事件」是本票新增的幂等性约束，均由单出口结构保证。

---

## 10. 调用方影响矩阵

| 调用方 | 当前处理 | 设计后处理 | 所需改动 | 证据 |
|---|---|---|---|---|
| composition root / 未来 server（#270，`createRestRouter` 唯一构造方） | 注入零参 no-op observer；对 `handle` rejection 统一当未映射故障 | 注入点不变（零参函数仍合法）；可选用新事件类型实现 observer；`handle` 新增 503/500 Response 结算与 abort rejection 两种新结局 | 无强制改动；#270 需把 503/500 Response 作为终局 HTTP 回复、把 abort rejection 视为连接级取消（**不得**记 500 或重试） | §7.4.1 兼容性；SA6 D1 门保持 |
| #267 冻结契约测试（4 文件 35 用例） | NOOP_OBSERVER `(): void`；断言 201/405/403/构造 TypeError | 行为零变化；类型收窄不破坏编译（少参函数可赋值） | 无 | `rest-create-hub-contract.test.ts` L92–94、`rest-role-gate-routing-contract.test.ts` L39–57 |
| #269 冻结契约测试（SA6 5 文件 29 用例 + harness） | 红灯（能力缺口） | 全绿目标 | 无（测试冻结） | SA6 §13 |
| `Registry`（被调方） | 窄 issue/fatal/unknown 通道现状 | 调用方式与输入零变化；仅消费其公开结果联合 | 无 | §7.1 判别输入全部为公共面 |
| #268（在途，4xx/422/limits 票） | 与 #269 共享 step 4 读取段（骨架裸 `json()`） | 共享 `readRequestBody` seam；必须遵守 §7.6 排序不变量（abort 先于 413；读取期结局发射前再核对 signal） | #268 设计时遵守 seam 契约；C5 在两票合入后都必须保持绿 | SA6 §12.4/R3；abort C5 |
| `@nomicore/vfsl` `deriveSchemaIdentity` / Persistence | 现状 | 零变化（本票不触碰） | 无 | §1 非目标 |

---

## 11. 文件范围

### ALLOW LIST

| 路径 | 预期改动 | 原因（对应正文） |
|---|---|---|
| `packages/namespace-api/src/create-namespace.ts` | `readRequestBody`（abort 边界）、四类失败映射终局、发射 helper、release 失败 diagnostic、私有 abort 错误类、签名扩展 | §7.1/§7.3/§7.4/§7.7/§7.8 |
| `packages/namespace-api/src/rest.ts` | observer 选项类型事件化、`RestMetricsEvent`/`RestDiagnosticEvent` 定义与导出、observers 传递、头注 deferral 更新 | §7.4.1/§7.7 |
| `packages/namespace-api/src/index.ts` | re-export 两个事件类型（类型层加法） | §7.7 |
| `packages/namespace-api/AGENTS.md` | deferral 清单更新：移除「Registry 失败映射与 problem shape（503/500 族）、`Request.signal`、observer 事件发射」；保留 #268 项（形状/owner/query/媒体类型/limits 执行、4xx/422、完整 problem shape）；补记 metrics `rejected` 发射策略延后 | §1 非目标/§7.6（包契约文档与实现同步） |
| `packages/namespace-api/README.md` | Public API（事件类型、新结局族）与 Deferred scope 段更新 | 同上 |
| `wiki/raw/task_issue-269_design.md` | 本设计 | SA1 产物 |

### DENY LIST

| 路径 | 与任务的关系 | 禁止修改原因 |
|---|---|---|
| `packages/namespace-api/test/**`（9 文件：#267 冻结 4 + SA6 冻结 5，含 harness） | 冻结验收契约 | 包 AGENTS.md「frozen acceptance contract；不得为迎合实现而修改」；SA6 §15 修订须走修订轮 |
| `packages/namespace-registry/**` | Registry 行为零变化 | 本票是 REST Adapter 叠加；Registry 语义由其 own 契约管辖 |
| `packages/namespace-api/package.json` | 公共打包面 | 无新子路径；exports 白名单不动（create-namespace 私有性依赖它） |
| `docs/adr/**`（含 0015） | 治理面 | ADR-0015 状态流转属父 PR #158 治理流程；设计只锚定修订，不改文本（OBS-1） |
| `packages/vfsl/**`、`packages/persistence/**`、`packages/instance/**` | 下游依赖零变化 | §1 非目标 |
| 4xx/422/limits 的任何实现（owner 文法、query、Content-Type/Encoding、byte 上限、problem shape message/issue 投影） | #268 拥有 | §7.6 边界；抢跑会造成两票相互改写 |
| 根 `CONTEXT.md`、`docs/protocols/**` | 无新域术语/wire 契约 | 事件与错误 code 均为 ADR 0015 既有词汇 |

---

## 12. 验收与验证映射

SA6 已交付可执行契约（29 用例 + 支撑 9 + #267 冻结 35）；实现使 17 红转绿且 47 绿保持。SA1 不运行测试；验证命令取包 AGENTS.md 既有入口。

| 需求或风险 | 现有证据 | 所需行为测试或动态场景（SA6 已固化） | 预期观察 |
|---|---|---|---|
| AC1 四分支精确映射 + committed 语义 | mapping 文件 7 红（B1–B4/B7） | 真实 shutdown / `DocCreateOperationalError` / fatal 二分（testing 注入）/ unknown throw | 503/500×3 逐字 code；每例恰一 metrics 事件且 code=body code；无敏感值泄漏 |
| AC2 内部契约违例安全 500 + diagnostic | mapping 2 红（B5/B6） | probe 注入两窄 issue | 500 INTERNAL_ERROR；diagnostic 恰一 `unknown-exception`、cause 引用相等；issue message 不入任何 client 面 |
| AC3 取消边界 | abort 3 红（C1/C2/C5）+ 2 半绿（C3/C4 缺事件） | pre-abort、mid-read abort（流式 body + pull 计数锚）、create/release 在途 abort（gate promise） | 零触达 `invocations===[]`；有界 rejection；metrics `['aborted']`/`['succeeded']`；release 恰一次；lease released；C5 aborted 非 413 |
| AC4 observer 注入门/低基数/三类 diagnostic | observer 4 红（D2/D4/D5/D6） | 缺 observer TypeError、全分支矩阵键白名单/词表/哨兵扫描、fatal 二分/unknown/违例的 diagnostic 断言 | 恰一事件；operation 单常量；无 owner/namespaceId/schema/root/issues/cause 于 metrics；diagnostic 无 schema/root/issues |
| AC5 observer throw 隔离 | D3 红（503 分支） | 四分支 × 双 observer 同 throw | 201/503/500/201 全部不变 |
| AC6 覆盖面 | 三文件 29 用例 + M0 对照 | — | 转绿后 `pnpm`（vitest --typecheck）全绿；`pnpm typecheck` 0 error |
| 回归：#267 冻结行为 | legacy 35 绿（红/绿两基线均绿） | 不改其字节 | 35/35 保持绿 |
| 回归：类型面 | SA6 `Type Errors: no errors` + 两 tsc 入口 0 error | — | 实现后同款命令 0 error |

---

## 13. 风险、回滚与残余问题

| 风险 | 评估 | 缓解 |
|---|---|---|
| ADR-0015 仍为「提议」（OBS-1）：接受前被修订将移动本设计的断言基础（L113/L156–161/L163–190） | 中 | 修订锚（HEAD/blob/sha256）已记录于文档头；若 0015 修订 → 设计+契约重过 SA8 门禁 + 修订轮 |
| R1/R3 是对 ADR 欠规格分支与跨票排序的设计裁决（OBS-2/3） | 中 | 已给出完整理由链 + 契约可执行锁定（B4/C5 + M1/M2 变异）；提交 `requiresConflictRecheck: true` 由 SA8 复查 |
| #268 并行在途，共享 seam 被其改写顺序 | 中 | §7.6 排序不变量 + C5 在两票合入后均须绿；#268 设计评审应引用本节 |
| mid-read abort 后 `json()` 败方 promise 长期 pending（真实 server） | 低 | race 已挂接反应（无 unhandled rejection）；body/stream 清理归 server 连接生命周期（router 无权 cancel 已锁流） |
| 非标准 `Request`（缺 `signal`/代理包装） | 低 | 标准 seam 契约（ADR L32）下自然 TypeError fail-loud；wrapped fatal 失 instanceof 时安全降级为 T8（500 + diagnostic，非静默） |
| 回滚 | — | 单 commit 纯加法叠加于 #267 骨架；回滚 = 还原本票 ALLOW LIST 五文件（测试冻结不动，legacy 35 用例即回滚后基线） |

**残余问题 / follow-up（非本票必要条件）**：

1. abort rejection 的公共判别子（导出错误类或稳定 code）——留给 server 票 #270 以加法决定（§7.3）。
2. metrics `rejected` outcome 的发射策略（403/405/4xx 族）与 5xx body 的 message 字段、完整 problem shape——归 #268/后续错误契约票。
3. ADR-0015 正式接受的治理流程（父 PR #158）。

---

## 14. 是否需要设计后 ADR 冲突复查

**需要（`requiresConflictRecheck: true`）**，理由（对应技能判据，非机械触发）：

1. **公共 API 类型变化**：`RestRouterOptions` 两个 observer 参数收窄 + 两个新导出事件类型（§7.4.1）。
2. **`handle` 失败语义变化**：503/500 四类结局由 rejection 替换为 Response（计划内纯加法，SA8 B-3 预告过），并新增 abort 的有界 rejection 语义——属「新的失败语义」。
3. **触碰提议中 ADR 的欠规格面**：R1 填补 ADR-0015 L175–178 未显式落位的 fatal `committed:false` 分支；R3 设立跨票（#268）读取段排序先例；H-A 裁决 abort 不伪造 HTTP status。三者均不动 ADR 文本但延伸其语义——SA8 OBS-1/2/3 均提示需要门禁回看。
4. **新增敏感运维事件契约**：diagnostic 事件形状（三类 kind + exact cause 引用 + owner/namespaceId 字段裁决）是新的可观测生命周期面。

---

## 15. 评审修订映射

`wiki/raw/task_issue-269_sa2_review.md` 不存在（iteration 0，无评审输入）——本节留空；评审轮到来时按 finding → 修订位置逐条落实。

---

## 16. 结论

设计确认 SA6 全部形状提案与裁决（H-M/H-D/H-A、R1–R4），给出可直落的实现面：`create-namespace.ts` 的映射终局状态机（§7.1/§7.8）+ `readRequestBody` abort seam（§7.3）+ 事件类型与发射矩阵（§7.4）+ #268 共享边界（§7.6）。范围收敛在 `packages/namespace-api` 的 3 个源文件 + 2 个包内文档；测试与 Registry 冻结不动。无阻塞缺口；唯一上报项为 §14 的设计后 ADR 冲突复查。
