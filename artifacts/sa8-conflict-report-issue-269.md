# SA8 冲突门禁报告 — Issue #269 前置门禁

- **Dispatch**: sa-d2d69c95-f821-4655-8d21-84ca6290f4fb（mabf-sa8 / conflict-gate / iteration 0）
- **审查对象**: Issue #269「REST create：Registry 失败语义、取消边界与双 observer 契约」（OPEN，`in-progress`）
- **审查类型**: 前置门禁（任务简报 vs 既有决策集）——验收契约（acceptance-contract / SA1）工作开展前的放行裁决
- **冲突基准**: `docs/adr/0001`–`0015` 全集 + 根 `CONTEXT.md`。代码、wiki/raw 仅作就绪度旁证，不构成阻塞依据。
- **Owner 要求输入**: Issue #269 评论快照为空（REST `gh api .../issues/269/comments` = 0 条）；无评论级 owner 要求，简报以 issue body 为准（`wiki/raw/task_issue-269.md` 逐字一致）。

---

## 1. 裁决

**verdict: clear（放行）**——冲突点数 **0**（阻塞 0 / 中等 0），观察项 **3**（提示级，不阻塞）。

Issue #269 与既有决策集无冲突；任务门禁通过，**具备开展验收契约设计工作的就绪条件**。

---

## 2. 逐条对照（任务要求 vs 决策基准）

### 2.1 失败映射（4 项）

| # | Issue #269 要求 | 决策基准 | 裁决 |
|---|---|---|---|
| F1 | `REGISTRY_NOT_ACCEPTING` → 503（明确零提交，可稍后重新请求） | ADR-0015 L175 逐字同款；ADR-0009 §Shutdown（shutting-down 停接纳，统一返回 `REGISTRY_NOT_ACCEPTING` 且不访问输入——零提交语义成立） | 一致 |
| F2 | typed operational failure → 500 `NAMESPACE_CREATE_FAILED`（code 语义保证 `committed:false`） | ADR-0015 L176；ADR-0009 §Persistence 错误演进（typed create operational error 明确 `committed:false`；Registry 只把 typed operational error 映射为公开 create issue） | 一致 |
| F3 | Registry fatal 且 `committed:true` → 500 `NAMESPACE_CREATE_OUTCOME_UNKNOWN`（不得自动重试） | ADR-0015 L177；ADR-0009 §Create L70（createDoc 已提交而 Runtime 构造失败 → `committed:true` fatal；不得自动重试，后续可 open） | 一致 |
| F4 | unknown exception / 内部契约违例 → 500 `INTERNAL_ERROR`；`NAMESPACE_CREATE_INVALID_INPUT` 与 `NAMESPACE_ALREADY_EXISTS` 视为内部契约违例返回安全 500 并上报 diagnostic observer；namespaceId 碰撞由 Registry 内部处理 | ADR-0015 L178/L180 逐字同款；ADR-0010 §Namespace identity L28（普通 create 由受控 128-bit CSPRNG 生成 `ns-`+32 hex，撞 entry/Persistence duplicate 最多重试 8 次，耗尽以 `committed:false` fatal 失败——`NAMESPACE_ALREADY_EXISTS` 不应到达 REST 面）；ADR-0009 §issue #131 修订节（identity 规则以 ADR-0010 为唯一权威，取代旧复合 key/调用方指定 ID 条款——issue 遵循的是修订后现行规则） | 一致 |

### 2.2 取消边界（2 项）

| # | Issue #269 要求 | 决策基准 | 裁决 |
|---|---|---|---|
| C1 | body 读取阶段尊重 `Request.signal`，中断后 Registry 零触达 | ADR-0015 L113 逐字同款（§JSON 处理与资源限制末段） | 一致 |
| C2 | 调用 Registry 后不传播客户端取消，必须等待 create settle 并 release Lease | ADR-0015 L113 + §执行顺序与Lease L156–159（step 7 调用 create → step 9 恰一次调用并等待 `lease.release()` → step 10 返回） | 一致 |

### 2.3 Observability（3 项）

| # | Issue #269 要求 | 决策基准 | 裁决 |
|---|---|---|---|
| O-1 | 构造时必须显式注入两个同步 void observer（no-op 亦须显式）；observer throw 一律隔离，不改变 HTTP 结果 | ADR-0015 L186 逐字同款；骨架已落地参数位（`packages/namespace-api/src/rest.ts` `RestRouterOptions.metricsObserver/diagnosticObserver` 必填、零参签名、本票零发射） | 一致 |
| O-2 | metrics-safe observer 低基数统一事件：operation、`succeeded \| rejected \| unavailable \| failed \| aborted` outcome、稳定 code、可选 HTTP status；不携带 owner、namespaceId、issues、schema/root、cause | ADR-0015 L188 逐字同款 | 一致 |
| O-3 | diagnostic observer 仅三类事件（Registry fatal、unknown exception、Lease release failure）；可携带已验证 owner、错误本身已知 namespaceId、Registry operation/phase/committed 与 exact cause；不得携带 schema/root 或完整 validation issues；Host 负责访问控制、采样和脱敏 | ADR-0015 L190 逐字同款（含 release-failure 上报面 L161）；与 ADR-0009 §Fatal、错误与 observability L95（内部结构化 observer seam，event 可携带受控 identity 与 exact cause，脱敏/采样归 Adapter）相容 | 一致 |

### 2.4 验收准则（6 项）

逐条比对 ADR-0015 §测试决策 L204–L207：not accepting / operational failure / fatal committed 二分 / 中断语义（body 读取中断零触达 + 接纳后不取消）/ observer 低基数与敏感字段隔离 / observer throw 隔离——全部为 ADR 既有测试决策的忠实提取，无新增或删减语义。**一致**。

### 2.5 词汇与术语

issue 用词（Lease、Registry、observer、namespaceId、owner、schema/root）与 `CONTEXT.md` 域词汇（namespaceId、NamespaceLease 语义、owner 为 Persistence 分区键不上 wire）零冲突；未引入未定义新术语。

**对照小计：15/15 项一致，0 项冲突。**

---

## 3. 观察项（提示级，不构成阻塞）

### OBS-1｜ADR-0015 尚为「提议」状态，实施已在推进
`docs/adr/0015-vertical-rest-namespace-create.md` 状态为 **提议**（proposed），父 PR #158（docs/rest-namespace-create）仍未 merge；而其切片实施已在推进（#267 已关闭、#268/#269 in-progress）。`docs/AGENTS.md` 声明 `docs/adr/` 记录 **accepted** 决策。本 issue 与 0015 现文一致，不构成冲突；但若 0015 在正式接受前被修订，本切片验收契约须重新过门禁。建议验收契约产出时在 SA1 设计中显式锚定 ADR-0015 的修订版本（commit hash）。

### OBS-2｜fatal `committed:false` 的 REST 映射在 ADR-0015 映射表未显式落位
ADR-0015 §错误契约四分支（503 / FAILED / OUTCOME_UNKNOWN / INTERNAL_ERROR）未显式规定 **Registry fatal 且 `committed:false`**（如：`namespace-id-generation` 碰撞预算耗尽——ADR-0010 L28；`create-document-internal` 提交前 fatal——ADR-0009 L66；`lifecycle-slot-internal`——ADR-0009 L89–93）映射到哪个 500 code。该缺陷系 ADR 自身欠规格，由 issue 的验收准则 1（「按 Registry 结果类型精确映射，committed 语义正确」）继承——验收契约设计必须把这一分支钉死（落位选择属 SA1 设计职责，非本门禁裁决范围）。

### OBS-3｜与 #268 的接缝：body 读取段共享、rejection→Response 替换叠加
body 读取段由两票共享（limits/413/形状校验属 #268；signal 中断零触达属 #269）；骨架现行「未映射结局一律 rejection」由两票分别以纯加法替换为 Response（rest.ts 头注 SA8 B-3、包 AGENTS.md deferral 清单）。两票结局族不相交（#268 = 4xx/422；#269 = 503/500），无顺序硬依赖，但验收契约应声明对 body 读取段 signal/limits 交互（先超限 vs 先中断）的裁决，避免两票合入时重复实现或相互改写。

---

## 4. 就绪度评估（acceptance-contract 工作开工条件）

| 门 | 事实 | 结论 |
|---|---|---|
| 依赖门（Blocked by #267） | #267「REST router 骨架」CLOSED（2026-09-10，`ci-passed`），经 PR #296 合入（commit `0b06050`） | ✅ 解除 |
| 骨架基座 | `packages/namespace-api` 存在：rest.ts（route/method/role gate + 成功路径 + Lease 恰一次 release）、create-namespace.ts、5 个冻结契约测试；observer 注入位已强制显式（B-2 落地）；「Registry 失败映射、signal、observer 事件」在 rest.ts 头注 L15–20 与包 AGENTS.md deferral 清单中**点名延后至本票** | ✅ 就绪 |
| 决策集冲突 | 15/15 项一致，0 冲突（见 §2） | ✅ 通过 |
| owner 要求输入 | 评论快照为空，无评论级要求；issue body 即全部要求 | ✅ 明确 |
| 基准时效 | 无 superseded ADR 约束（ADR-0009 旧复合 key 条款已被 #131 修订节经 ADR-0010 取代，issue 遵循现行规则）；唯 ADR-0015 状态为「提议」（见 OBS-1） | ✅（带 OBS-1 提示） |

**结论：前置门禁通过（clear）。Issue #269 可进入验收契约（SA1 设计）阶段；OBS-2 的 fatal `committed:false` 落位必须在契约中显式裁决，OBS-1 的 ADR 版本锚定建议随设计一并备案。**

---

## 5. 基线证据

- Issue #269 body/labels/state：`gh issue view 269`（author welltop-jim-wang，created 2026-09-08，`in-progress`）
- Issue #269 comments：`gh api repos/welltop-jim-wang/nomicore/issues/269/comments` → 0 条
- Blocker #267：CLOSED @2026-09-10T21:53:04Z（`ci-passed`）；PR #296 合入 commit `0b06050`（本 worktree HEAD）
- 父 PR #158：OPEN（未 merge）
- 决策集：`CONTEXT.md`（173 行全读）；`docs/adr/0001`–`0015`（0008/0009/0010/0011/0012/0014/0015 重点全文，其余状态头扫描，无 superseded 标记）
- 骨架：`packages/namespace-api/src/rest.ts`（179 行）、`src/create-namespace.ts`、`AGENTS.md`（包级）
- 相邻在途：#268（4xx/422 形状/limits）、#270（server 集成验收，ready-for-agent）——范围不相交

*本报告为 SA8 唯一产出；未修改任何仓库文件（报告自身除外）。*
