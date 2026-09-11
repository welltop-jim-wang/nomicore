# SA8 冲突门禁报告 — Issue #269 设计后复审

- **Dispatch**: sa-f3f36fb4-3a74-498a-a8e5-29ecfad64870（mabf-sa8 / conflict-gate / iteration 1）
- **审查对象**: SA1 实施设计 `wiki/raw/task_issue-269_design.md`（iteration 0，派发 sa-0b806535…）
- **审查类型**: 设计后复审（SA1 设计 vs 既有决策集 + 已批准 SA6 验收契约）——SA1 §14 以
  `requiresConflictRecheck: true` 显式上报四条触发理由，本次逐条裁决
- **冲突基准**: `docs/adr/0001`–`0015` 全集 + 根 `CONTEXT.md`（唯一阻塞依据）。对照参考：
  已 `approve` 的 SA6 契约 `wiki/raw/task_issue-269_sa6_contract.md`（29 用例冻结）。
  代码、wiki/raw 其余文件仅作锚点核实旁证，不构成阻塞依据。
- **Owner 要求输入**: Issue #269 评论快照为空——本次复审经 `gh api .../issues/269/comments`
  实测 **0 条**（与派发声明、任务简报、SA6/SA1 记录一致）；无评论级 owner 要求或 override，
  验收口径 = issue body What to build + AC1–AC6。

---

## 1. 裁决

**verdict: clear（放行）**——冲突点数 **0**（阻塞 0 / 中等 0），观察项 **6**（提示级，不阻塞）。

SA1 设计与既有决策集及已批准 SA6 契约**全部一致**；其上报的四条复查触发理由
（公共 API 类型变化 / handle 失败语义变化 / 触碰提议中 ADR 欠规格面 / 新增敏感运维事件契约）
均经逐条对照确认为**计划内纯加法或对 ADR 欠规格分支的诚实填补**，无一构成冲突。
设计可进入后续阶段（SA2 攻击评审 / SA3 实施）；无需回写冻结契约测试。

---

## 2. 专项复核一：`committed:false` 映射（dispatch 点名；OBS-2 → R1）

**事实链（全部实测核对）**：

1. ADR 0015 §错误映射 L175–L178 逐文列出四支：503 `REGISTRY_NOT_ACCEPTING` / 500
   `NAMESPACE_CREATE_FAILED`（typed operational，code 语义保证 `committed:false`）/ 500
   `NAMESPACE_CREATE_OUTCOME_UNKNOWN`（fatal 且 `committed:true`）/ 500 `INTERNAL_ERROR`
   （unknown exception 或内部契约违例）。**fatal 且 `committed:false` 的落位确实未被显式列出**
   （前置门禁 OBS-2 已登记为 ADR 自身欠规格）。
2. Registry 公共面的 committed 事实矩阵（`packages/namespace-registry/src/registry.ts` 实测，
   与设计 §2 锚点 8 逐一对上）：`namespace-id-generation` 恒 `false`（L897）；`create-document-internal`
   为 `DocRuntimeFatalError.committed` 或 `false`；`lifecycle-slot-internal` 原样传播
   `cause.committed`（**可为 true 或 false**）；`runtime-construction` 恒 `true`；typed
   operational → 窄 issue `NAMESPACE_CREATE_FAILED`（不携带 committed 字段）。⇒ 该分支
   真实可达，必须落位。
3. 设计裁决（§7.1 T7 + §7.2）：**fatal `committed:false` → 500 `INTERNAL_ERROR`**，
   以 `committed`（而非 phase）为 fatal 二分唯一判别子。

**冲突判定：一致（无冲突）**——三个候选落位中唯一不与决策集矛盾者：

| 候选 | 对照基准 | 判定 |
|---|---|---|
| → 500 `NAMESPACE_CREATE_FAILED`（设计 A1，被拒） | ADR 0009 §Persistence 错误演进 L81「Registry 只把 typed operational error 映射为公开 load/create issue」+ ADR 0015 L176——FAILED 的 code 承诺专属窄 issue 通道；fatal 走 branded rejection 通道（`CreateNamespaceResult` 注释「绝不 resolve 伪装」，types.ts 实测）。映射进 FAILED 将合并两条语义不同的通道，并错误授予 L182「可修正后重新发起」暗示 | 若选择将构成**中等冲突**；设计正确拒绝 |
| → 500 `OUTCOME_UNKNOWN`（设计 A2，被拒） | ADR 0015 L177 + ADR 0009 §Create L70——OUTCOME_UNKNOWN 全部含义是「可能已提交、不得自动重试」，专属 `committed:true`；`committed:false` 时结局确定（零提交），报 UNKNOWN 不诚实 | 若选择将构成**中等冲突**；设计正确拒绝 |
| **→ 500 `INTERNAL_ERROR`（R1，采纳）** | ADR 0015 L178 残留类「unknown exception 或内部契约违例」——提交前 branded fatal（ID 生成预算耗尽 ADR 0010 L28、`create-document-internal` ADR 0009 L66、pre-commit `lifecycle-slot-internal`）是服务自身机器的内部故障，正落该类语义 | **一致**；对欠规格分支的填补，不与任何条款矛盾 |

**契约锁定核实**：SA6 冻结测试 B4 正向锁定（fatal `committed:false` → 500 INTERNAL_ERROR）+
B2/B3 同断言点反向排除（≠FAILED、≠OUTCOME_UNKNOWN）；变异 M1/M2 双向捕获（§9 E2 实测
1/2 例红）。设计 §7.2 与该裁决完全同构，无需回写测试。

**残余（治理面，观察项 OBS-R1-1）**：该落位属对「提议」状态 ADR 欠规格面的设计级填补。
ADR 0015 经父 PR #158 正式接受时，应把 fatal `committed:false` → `INTERNAL_ERROR`（以及
§7.6 的 abort/413 排序与 H-A abort 结算形状）折入 ADR 文本或其修订节，避免设计/契约与
ADR 正文长期两源。设计已锚定 ADR blob `64daa16a`/sha256 `3a75f99b…` 并声明「0015 修订 →
重过门禁」——锚定有效（本次实测 blob/sha256 与 HEAD `0b06050` 一致，ADR 文本未被移动）。

---

## 3. 专项复核二：共享 body 读取段排序边界（dispatch 点名；OBS-3 → R3）

**设计裁决（§7.3 + §7.6）**：读取段收敛为共享 `readRequestBody(request)`——①入口同步判定
`signal.aborted`；②`Promise.race([request.json(), abortPromise])`；③读胜出后同步再核对；
finally 必移除监听器。排序不变量：**读取段（step 4）内 abort 观察先于任何读取期检查（413
计数/判定）**；#268 合入时其 byte 上限判定必须嵌在 raced read 内部或其后，且任何读取期结局
发射前必须再核对 `signal.aborted`；由 C5 可执行锁定（pre-aborted + 超限 → aborted 非 413，
Registry 零触达），两票合入后均须保持绿。

**冲突判定：一致（无冲突）**，边界划分与 ADR 逐条对得上：

| 设计条款 | 决策基准 | 判定 |
|---|---|---|
| abort 观察位于 step 4 入口，读取段内 abort 优先 | ADR 0015 L113「body**读取阶段**尊重 `Request.signal`，中断后 Registry 零触达」——signal 尊重义务的范围就是读取阶段；两个条件同现时的优先序 ADR 未规定，R3 是对该欠规格交互的裁决，不否定 413 映射本身（L172）也不否定 signal 义务（L113） | 一致（填补） |
| #268 的 step-3 4xx（如 415）可以先于 abort 被结算 | ADR 0015 §执行顺序 L150–153：step 3（owner/query/Content-Type/Encoding 检查）冻结在 step 4（body 读取）**之前**——设计不触及 step 3、不 reorder 冻结顺序（与 #267 骨架 B-3 及包 AGENTS.md 固定顺序逐字一致） | 一致 |
| 读取段返回至 `registry.create` 之间仅同步代码 ⇒ 三道闸门后被观察到的 abort 必在 Registry 触达前 | 实测 `create-namespace.ts` L36–L60：形状检查/`deriveSchemaIdentity`（同步纯）/envelope 组装均无 await ⇒「中断后 Registry 零触达」有结构保证 | 一致 |
| 接纳后零 signal 观察；等待 create settle + 恰一次等待 release | ADR 0015 L113 后半句逐字 + §执行顺序 step 9「恰一次调用并等待 `lease.release()`」 | 一致 |
| abort 以有界 `handle` rejection 结算，不伪造 HTTP Response（B3 被拒） | ADR 0015 全文无 abort HTTP status 定义；L32 router 不拥有 listener；L188 metrics 词表含 `aborted`（无 status）——「唯一分类面是 metrics `aborted`」是诚实读法，发明 499/408 违反骨架「不发明未评审 problem shape」纪律 | 一致（H-A 确认） |
| `readRequestBody` 为两票共享 seam；#269 不消费 `limits` | 与 #268 范围划分（issue body「#268 拥有 4xx/422/limits」）及 #267 骨架 limits 预留位（rest.ts 实测「不校验、不执行」）一致；纯加法，不改公共构造签名 | 一致 |

**残余（跨票治理，观察项 OBS-R3-1）**：R3 设立了跨票（#268）排序先例——一条**不在任何已接受
ADR 文本中**的实现不变量。建议总控在 #268 派发简报中显式引用设计 §7.6 / SA6 §12.4，并在
#268 合入时以 C5 绿灯为验收条件（设计 §10 调用方影响矩阵已同样声明）。非阻塞。

---

## 4. 其余维度逐条对照（设计 vs 决策集 + SA6 契约）

### 4.1 失败映射总表 T1–T11（§7.1）vs ADR 0015 / ADR 0009 / ADR 0010

| # | 设计裁决 | 基准核对 | 判定 |
|---|---|---|---|
| T1 | `REGISTRY_NOT_ACCEPTING` → 503 + 逐字 code；metrics `unavailable`；零 diagnostic | ADR 0015 L175 逐字；ADR 0009 §Shutdown L99（统一返回且**不访问输入** ⇒ 零提交语义成立）；`unavailable` ∈ L188 词表；NOT_ACCEPTING 不属 L190 三类事件 ⇒ 零 diagnostic 正确 | 一致 |
| T2 | 窄 issue `NAMESPACE_CREATE_FAILED` → 500 + 逐字 code；零 diagnostic | ADR 0015 L176 逐字；ADR 0009 L81（typed operational → 公开 create issue 的唯一通道）；typed operational 不属三类事件 ⇒ 零 diagnostic 正确 | 一致 |
| T3/T4 | `NAMESPACE_CREATE_INVALID_INPUT` / `NAMESPACE_ALREADY_EXISTS` → 500 `INTERNAL_ERROR` + diagnostic `unknown-exception`（R4） | ADR 0015 L180 逐字（安全 500 + 上报 diagnostic observer）；ADR 0010 L28（CSPRNG 内部生成 + 碰撞内部重试 ≤8 次 ⇒ ALREADY_EXISTS 不应到达 REST）；L178 把「内部契约违例」与「unknown exception」归同一 500 类，L190 三类 kind 无第四类 ⇒ `unknown-exception` kind 是唯一诚实归属 | 一致 |
| T5 | `NAMESPACE_INVALID_IDENTITY` / `SCHEMA_INVALID` / `ROOT_INVALID` 保持 unmapped rejection | 422/400 族归 #268（issue 家族切片 + 前置门禁 OBS-3 边界）；映射会抢跑 #268 契约并违反纯加法纪律；与 #267 冻结现状一致 | 一致（过渡态，声明清晰） |
| T6 | fatal `committed:true` → 500 `OUTCOME_UNKNOWN`；不得自动重试 | ADR 0015 L177 + ADR 0009 L70（已提交不补偿删除、不得自动重试、后续可 open）——设计 §9「无补偿动作」逐字遵循 | 一致 |
| T7 | fatal `committed:false` → 500 `INTERNAL_ERROR` | 见 §2 专项复核 | 一致 |
| T8 | 其余 throw → 500 `INTERNAL_ERROR` + diagnostic `unknown-exception` | ADR 0015 L178；ADR 0009 L81「unknown exception 不能伪装为运营失败」——设计不把 unknown 映射为 FAILED（M5 变异锁定） | 一致 |
| T9 | abort → 有界 rejection + metrics `aborted`（无 code/status）；零 diagnostic | 见 §3；`aborted` ∈ L188 词表；abort 不属三类事件 | 一致 |
| T10 | 成功 → 201 + metrics `{operation, succeeded, status:201}`（省略 code） | 201 形状不变（#267 冻结；ADR L90 恰含字段）；H-M「2xx 的 code 可省略」；SA6 §15 明示成功码取值留设计 | 一致 |
| T11 | create 成功 + release 失败 → 仍 201；diagnostic `lease-release-failure`（owner + DTO 副本 namespaceId + exact cause）；不重试不二次调用 | ADR 0015 L161 逐字（「仍返回 201，通过 diagnostic observer 报告已验证 owner、namespaceId 与 exact cause，不重复调用 release」）；namespaceId 取自 Registry CSPRNG 生成的 DTO（`^ns-[0-9a-f]{32}$`，ADR 0010 L28） | 一致 |

- 判别面：`code` / `instanceof NamespaceRegistryFatalError` + `.committed` / catch-all——
  全部为 Registry 公开面（types.ts/errors.ts 实测：fatal 判别面恰为 operation/phase/committed/
  cause）；`committed` 为唯一二分判别子、phase 仅诊断信息——与事实矩阵（`lifecycle-slot-internal`
  的 committed 可 true 可 false）匹配，四个 phase 全覆盖无死角。**一致**。
- 5xx body 最小 `{"code":"…"}`（message 省略，A3 推迟）——不违反 L165 已钉死的任何约束
  （客户端只按稳定 code 分支；不返回 schema/root 片段）；完整 problem shape 归 #268（家族切片
  既定边界）。**一致（观察项 OBS-B 备案）**。
- 不加 `Retry-After`：AC 与 ADR 均未要求，不发明。**一致**。

### 4.2 取消边界（§7.3）vs ADR 0015 L113 / Node 24 平台事实

入口同步判定 + race + 胜出再核对三道闸门是对 L113 的实现展开；Node 24「pre-aborted + 完整
body 时 `json()` 仍 resolve、mid-read abort 不自行结算」的放大因素由 SA6 支撑文件实测背书
（C1/C2/C5 红灯即骨架现状），设计「不得依赖平台、必须显式观察」的结论成立。监听器 finally
清理、race 双方挂接（无 unhandled rejection）、不 cancel 已锁流（body/stream 清理归 server
生命周期，ADR L32/L227 不拥有 drain）——均与 ADR 边界一致。**一致**。

### 4.3 双 observer 事件契约（§7.4）vs ADR 0015 L186–L190 + SA6 H-M/H-D

| 设计条款 | 基准核对 | 判定 |
|---|---|---|
| 类型事件化 `() => void` → `(event) => void`；零参调用方仍可赋值 | L186「同步 void observer」不排斥带参；L188/L190 要求 observer **接收**事件 ⇒ 事件化是 ADR 的必然要求而非偏离；TS 少参函数可赋给多参签名（#267 冻结 `NOOP_OBSERVER` 兼容，D1 门保持） | 一致 |
| metrics 键集 ⊆ `{operation, outcome, code?, status?}`；operation 恒 `'namespace-create'` | L188 逐字四键；单一 endpoint 单一常量满足「统一低基数」 | 一致 |
| 非 2xx 的 metrics `code` = body 稳定 code；abort 无 status；成功无 code | H-M 逐字（SA6 §12.1 提案，设计确认采纳——按 SA6 §15 纪律，设计确认即生效，无需回写） | 一致 |
| metrics 绝不携带 owner/namespaceId/issues/schema/root/cause | L188 逐字排除清单 | 一致 |
| diagnostic 三类 kind；exact cause 对象引用；仅 `lease-release-failure` 携带 namespaceId（DTO 副本）；fatal/unknown 不携带（Registry fatal 判别面无 namespaceId，无从诚实获知） | L190「只接收三类事件…错误本身已知的 namespaceId」——「本身已知」限定正是设计字段裁决的依据；不编造即诚实 | 一致 |
| diagnostic 绝不携带 schema/root/完整 issues；cause 引用不序列化不展开 | L190 逐字 | 一致 |
| 三类事件统一携带 `owner: { userId }`（route 捕获段） | L190「可携带已验证 owner」（许可条款）；设计措辞限定为「本请求提交给 Registry.create 的 owner」并在真实 Registry 路径上成立（identity 文法校验先于一切内部 throw，唯一更早的 stop-acceptance 检查返回窄 issue）——诚实；#268 step-3 owner 文法校验合入后「已验证」完全无歧义 | 一致（OBS-D 提示措辞保持） |
| observer throw 全分支经 helper 同步 try/catch 隔离，不改 HTTP 结果 | L186 逐字；D3 四分支 × 双 observer 锁定 | 一致 |
| 403/405/未匹配 route 保持零事件（`rejected` 发射策略归 #268） | L188 词表含 `rejected` 但未强制每分支发射；#267 冻结行为零事件，保持即纯加法；SA6 D6 只做出现即合规扫描 | 一致（OBS-C 备案） |

### 4.4 与已批准 SA6 契约的一致性（dispatch 点名「approved SA6 contract」）

- 设计头注与 §5/§7 声明「对 §12.1 形状提案（H-M/H-D/H-A）与 §12.2 裁决（R1–R4）**全部确认
  采纳**，无需回写契约测试」——逐条核对：H-M（键集/词表/code=body/abort 无 status/2xx 可省）→
  §7.4.1/§7.4.2；H-D（三类 kind/cause 引用/可选字段诚实来源）→ §7.4.1；H-A（rejection 结算/
  有界/唯一分类面 metrics）→ §7.3 B3 拒绝 + T9；R1 → §7.2；R2 → §7.3；R3 → §7.6；R4 → §7.5。
  **全部同构，无一处设计另判** ⇒ 按 SA6 §15 修订纪律，无修订轮触发。**一致**。
- 冻结证据核实：SA6 五个测试文件在工作树存在且 sha256 与 SA6 §13.4 记录**逐字节一致**
  （harness `14062b3d…`、support `9f9688ab…`、mapping `14465a40…`、abort `2f298a8e…`、
  observer `dbf8778a…`）；#267 冻结 4 文件未动（`git status` 仅 untracked 新增）。**一致**。
- 红灯基线复跑（本 SA8 实测，命令 = SA6 §13.1 同款）：`Test Files 3 failed | 5 passed (8)`、
  `Tests 17 failed | 47 passed (64)`、`Type Errors: no errors`——与 SA6 §13.1 及设计 §2 锚点 11
  逐位一致。设计引用的上游事实无失真。**一致**。
- 设计 §6 对 SA8 固定位置产物缺失的替代处理（引用 `artifacts/sa8-conflict-report-issue-269.md`
  为唯一上游门禁证据 + 自行完成 ADR 锚定）与实际相符。**一致**（OBS-E 备案布局差异）。

### 4.5 公共面 / 包边界 / 治理面

- 新导出仅两个**类型**（`RestMetricsEvent`/`RestDiagnosticEvent`，rest.ts 定义 + index.ts
  re-export）——属 `RestRouterOptions` 构造契约的必要组成（observer 实现方需要类型），
  不违反 ADR 0015 L18「首版只公开 REST router；create 编排保持包内私有」：`create-namespace.ts`
  仍包私有、`package.json` exports 白名单不动（设计 DENY LIST 显式冻结）。**一致**。
- ALLOW/DENY LIST 与包 AGENTS.md 边界吻合：测试目录冻结（「frozen acceptance contract；
  不得为迎合实现而修改」）、Registry/vfsl/persistence 零改动、`docs/adr/**` 不触碰
  （OBS-1 治理边界保持）；AGENTS.md/README.md 的 deferral 清单更新在 ALLOW LIST 内
  （文档与实现同步义务）。**一致**。
- ADR 0012（role 单真相）：设计不触碰 role 面，`RestRouterOptions.role` 注入语义与 #267
  冻结一致，无第二 role 源引入。**一致**。
- ADR 0011/0014（诊断变更日志）：本设计的 diagnostic observer 是 REST Adapter 的
  Host-facing 观测面，与 namespace 级诊断日志（emit never throws、sequencer slot 之外）
  相互独立，无交叉污染；observer throw 隔离语义与其「best-effort 观测不改变业务结局」
  纪律同向。**一致**。

### 4.6 词汇 vs CONTEXT.md

设计用词（namespaceId/owner/Lease/Registry/fatal/committed/phase/observer）与 CONTEXT.md
域词汇零冲突：owner 为 Persistence 分区键不上 wire（metrics 永不携带 owner；diagnostic 的
owner 是进程内事件字段而非 wire 面，L190 许可）；namespaceId 形状 `^ns-[0-9a-f]{32}$`
（ADR 0010/CONTEXT 同源）；三类 kind 词为 ADR 0015 L190 三类事件的序列化渲染，非新域术语，
无需更新 CONTEXT.md。**一致**。

---

## 5. 观察项（提示级，不构成阻塞）

### OBS-R1-1｜R1/H-A/R3 是对「提议中」ADR-0015 欠规格面的设计级填补（承接 OBS-1/2/3）
ADR-0015 仍为**提议**状态（L4；docs/AGENTS.md 声明 `docs/adr/` 记录 accepted 决策），而
R1（fatal `committed:false` → INTERNAL_ERROR）、H-A（abort 以 rejection 结算、无 HTTP status）、
R3（读取段内 abort 优先于 413）均已由冻结契约可执行锁定但**未进入任何 ADR 文本**。父 PR #158
正式接受 0015 时应把三者折入 ADR（正文或修订节），否则设计/契约与 ADR 正文形成两源。锚定链
（HEAD `0b06050` / blob `64daa16a` / sha256 `3a75f99b…`）本次实测有效；若 0015 在接受前被修订，
设计 + 契约须重过门禁（设计 §13 已自带该触发器）。

### OBS-R3-1｜跨票排序不变量需在 #268 派发面显式传递
「读取段内 abort 优先于 413 + 读取期结局发射前再核对 `signal.aborted`」约束 #268 的实现形状
（byte 计数须嵌 raced read 内部或其后）。该不变量目前只存在于设计 §7.6 / SA6 §12.4 / C5。
建议总控在 #268 简报中显式引用，并以「#269 与 #268 均合入后 C5 保持绿」为合入验收条件。

### OBS-B｜5xx body 为最小 `{code}` 面（message 省略）
L165 的完整 problem shape（message/issue 投影/`issuesTruncated`）按家族切片归 #268。本票
最小面不违反任何已钉死约束（稳定 code 分支、无 schema/root 片段），后补 message 属加法；
#268 实施时须保持 5xx 已冻结的 code 语义不变（其问题形状扩张不得改写 T1–T8 的 code/status）。

### OBS-C｜metrics `rejected` outcome 本票零发射
词表值保留（L188），403/405 维持 #267 冻结的零事件；发射策略归 4xx 族 owner（#268）。
避免两票对同一分支族重复实现事件发射。

### OBS-D｜diagnostic `owner` 字段措辞的诚实性须在实现中原样保持
T8（unknown exception）路径的 owner 是「提交给 Registry.create 的 owner」——在真实 Registry
上因 identity 文法校验先于内部 throw 而等价于「已验证」，但对退化 Registry（校验前即 throw）
严格说未经验证。设计 §7.4.2 的限定措辞（「事件只声称本请求提交给 Registry.create 的 owner」）
是正确处理；实现与后续文档不得将其改写为无条件的「已验证 owner」。#268 step-3 校验合入后
该歧义自然消除。

### OBS-E｜SA8 产物布局（承接迭代 0 登记）
固定位置 `wiki/raw/task_issue-269_conflict_report.md` / `task_issue-269_relevant_decisions.md`
仍不存在；实际产物在 `artifacts/`（迭代 0）+ 本报告。已登记给总控；不阻塞。

---

## 6. 证据基线（本次复审全部实测）

| 证据 | 取样 |
|---|---|
| 工作树 | HEAD `0b06050d9518c66ef166751064c95ed9557c9532`（branch `mabf/issue-269`）；`git status` 仅 untracked：SA8 报告 ×2、SA6 测试 ×5、wiki/raw 任务件 ×4——生产源码/ADR/CONTEXT.md 零改动 |
| ADR-0015 锚定 | `git hash-object` = `64daa16a43ef2718f7f8d692f77a82ac7517e341`；sha256 = `3a75f99b…148`——与 SA6 §3.1 / SA1 文档头锚逐字一致（未被修订） |
| ADR 状态全集 | 0001–0014 均「已接受」（0009 含 #131/#134/#228 修订节，0006 含 #64 归档修订）；0015「提议」；无 superseded 标记；0015 声明不取代 0008/0009/0010 |
| Issue #269 | `gh issue view 269`（OPEN，`in-progress`，body 与 `wiki/raw/task_issue-269.md` 一致）；`gh api .../issues/269/comments` → **0 条** |
| 契约冻结 | SA6 五文件 sha256 逐字节复核一致；#267 冻结 4 文件 + harness 未动 |
| 红灯基线复跑 | `vitest run --typecheck packages/namespace-api/test` → `3 failed \| 5 passed (8)`、`17 failed \| 47 passed (64)`、`Type Errors: no errors`（4.66s）——与 SA6 §13.1 逐位一致 |
| 源码锚点 | `rest.ts`（179 行：deferral 头注/observer 参数位/固定顺序）、`create-namespace.ts`（81 行：裸 `json()`、unmapped throw、release 吞错）、`registry.ts`（committed 矩阵 L897/L1469–1471/L1517–1523/L1539–1547/L1583）、`types.ts` L275–310（七 code 窄联合）、`errors.ts` L21–45（fatal 判别面）——与设计 §2 全部对上 |
| 上游产物 | SA6 契约 verdict `approve`（§17）；`task_issue-269_sa2_review.md` 不存在（设计 §15 留空属实）；迭代 0 门禁报告 `artifacts/sa8-conflict-report-issue-269.md`（clear / 0 冲突 / OBS-1/2/3） |

---

## 7. 结论

**设计后复审通过（clear）。冲突点数 0（阻塞 0 / 中等 0），观察项 6（OBS-R1-1 / OBS-R3-1 /
OBS-B / OBS-C / OBS-D 为治理与措辞级提示，OBS-E 为布局登记）。**

- dispatch 点名的两项专项：**`committed:false` 映射（R1 → 500 INTERNAL_ERROR）与共享 body
  读取段排序边界（R3：读取段内 abort 优先于 413，step 3 不受触及）均裁决为一致**——前者是
  三个候选中唯一不与 ADR 0009 L70/L81、ADR 0015 L176–177 矛盾的落位，后者与 ADR 0015
  L113/L150–153 的阶段范围和冻结顺序吻合。
- SA1 对 SA6 §12.1/§12.2 的全盘确认使冻结契约无需修订轮；DENY LIST 对测试、Registry、
  ADR、packaging 的冻结与包 AGENTS.md 纪律一致。
- 设计可放行进入后续阶段。唯一前瞻义务：ADR-0015 接受时折入 R1/H-A/R3（OBS-R1-1），
  #268 派发面传递 §7.6 排序不变量（OBS-R3-1）。

*本报告为 SA8 唯一产出；未修改任何仓库文件（本报告自身除外）。*
