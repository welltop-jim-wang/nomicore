# SA6 诊断与验收契约报告 — issue #269：REST create 的 Registry 失败语义、取消边界与双 observer 契约

> 阶段：acceptance-contract（Feature 能力缺口固化 + 可执行验收契约，iteration 0）。
> 派发：`sa-c486d932-d70d-4a61-9dd2-4059bb57b06f`（mabf-sa6，iteration 0）。
> 前置：SA8 冲突门禁 `clear`（0 冲突 / 3 提示级观察）。
> Issue comments REST snapshot：**空（`[]`）**——无 Owner 追加要求、无 override 授权。
> 结论：能力缺口已实证并固化为可执行契约——当前 HEAD 的 REST 骨架对 #269 全部目标
> 分支（503/500 四类、abort、observer 事件）一律以 rejection 结算且零事件发射；
> 新增 29 个契约用例后红灯 `17 failed | 47 passed (64)`（3/3 复跑逐位一致，`Type Errors:
> no errors`），同一契约在临时「未来绿灯模拟件」下 **64/64 全绿**（可满足性），14 组
> 定点变异（1 对照 + 13 变异）**全部被目标断言捕获**，模拟件已清理并留哈希/还原证据。
> Verdict：**`approve`**（详见 §17）。

## 0. 交付物

| 文件 | 内容 | 状态 |
|---|---|---|
| `packages/namespace-api/test/rest-failure-contract-harness.ts` | #269 契约共享 fixture/探针：observer 记录器（`(...args) => void` 形态，兼容零参与事件化两种签名）、结算/有界 race、probe registry（create/release 门 + 结果值注入 + unknown throw）、零触达探针、真实 fatal 注入（committed false/true）、operational-failure persistence、mid-read abort 流式 Request。非 `*.test.ts`，不被收集 | 新增 |
| `packages/namespace-api/test/rest-registry-failure-mapping-contract.test.ts` | 失败映射契约：503 / 500 `NAMESPACE_CREATE_FAILED` / 500 `NAMESPACE_CREATE_OUTCOME_UNKNOWN` / 500 `INTERNAL_ERROR`（fatal `committed:false`、unknown exception、两类内部契约违例）+ 2 例相近负控（9 用例，7 红 2 绿） | 新增（红灯） |
| `packages/namespace-api/test/rest-abort-boundary-contract.test.ts` | 取消边界契约：pre-abort、mid-read abort、与 #268 共享 seam 的 abort/413 交互裁决、create 在途 abort 不取消、release 在途 abort 仍等待（5 用例，全红） | 新增（红灯） |
| `packages/namespace-api/test/rest-observer-contract.test.ts` | 双 observer 契约：显式注入门（绿）、metrics 低基数事件与敏感字段隔离、diagnostic 三类 kind + exact cause、observer throw 隔离、全分支矩阵扫描（6 用例，5 红 1 绿） | 新增（红灯） |
| `packages/namespace-api/test/rest-failure-contract-support.test.ts` | 支撑/负控绿锚：真实 Registry 产出四类故障事实 + Node abort 运行时事实 + 探针判别力（9 用例，恒绿） | 新增（绿） |
| `wiki/raw/task_issue-269_sa6_contract.md` | 本报告 | 新增 |

无生产实现改动（临时绿灯模拟件已还原，见 §16）；无 commit/push/PR；无其他 SA 调度。

## 1. Task type and inputs

- **任务类型：Feature**（在 #267 已交付的 REST 骨架上叠加 ADR 0015 的 Registry 失败映射、
  取消语义与 observability；不是 Bug 修复）。因此本契约证明**能力缺口**并固化目标行为，
  不虚构 Bug 根因。
- 输入（固定位置 + 实际可得性，诚实记录）：
  - 任务简报 `wiki/raw/task_issue-269.md`（issue #269，State: open，updated 2026-09-10T22:21:52Z；
    Parent = PR #158；Blocked by #267；What to build 三段 + AC1–AC6）；
  - 派发记录 `wiki/raw/task_issue-269_dispatch.md`（唯一上游 SA8 phase 记录：conflict-gate
    iter 0，Issue comments REST snapshot `[]`）；
  - **SA8 报告实际位于 `artifacts/sa8-conflict-report-issue-269.md`**（verdict `clear`、
    15/15 一致、0 冲突、OBS-1/2/3 三条提示；其中 OBS-2 明确把 fatal `committed:false`
    落位交给本契约钉死）。固定位置 `wiki/raw/task_issue-269_conflict_report.md` **不存在**；
    `wiki/raw/task_issue-269_relevant_decisions.md` **不存在**（本报告 §3 的决策锚定由
    ADR 文本 + 逐字比对自行完成，未沿用缺失摘录）；
  - 既有 SA6 报告/测试：`wiki/raw/task_issue-269_sa6_contract.md` 不存在；
    `packages/namespace-api/test/` 既有 5 文件为 #267 冻结契约（35 用例，基线全绿），
    本票只新增文件、不改其字节。
- governing 决策（**修订锚定**见 §3.1）：`docs/adr/0015-vertical-rest-namespace-create.md`
  （状态：提议）；`docs/adr/0009`（已接受，含 #131/#134/#228 修订节）、`docs/adr/0010`
  （已接受，Namespace identity L28）、`docs/adr/0012`（已接受）；根 `CONTEXT.md`。
- 上游代码事实：`packages/namespace-api/src/rest.ts`（179 行，骨架）、`src/create-namespace.ts`
  （81 行，成功路径 + unmapped rejection）、`packages/namespace-registry` 公共
  `CreateNamespaceResult` / `CreateNamespaceIssue` / `NamespaceRegistryFatalError`
  （operation/phase/committed/cause）与 testing 注入面（`createDocumentFactory` /
  `runtimeFactory` / `randomBytes`）、`@nomicore/persistence` 的 `DocCreateOperationalError`。

## 2. Owner comment mapping

| Owner 输入 | 内容 | 契约落实 |
|---|---|---|
| Issue #269 comments REST snapshot | **空（`[]`）** | 无 Owner 追加要求/override 可映射；验收口径 = issue body 的 What to build + AC1–AC6 |
| 失败映射 F1–F4 | 503 / 500 `NAMESPACE_CREATE_FAILED` / 500 `NAMESPACE_CREATE_OUTCOME_UNKNOWN` / 500 `INTERNAL_ERROR`；`NAMESPACE_CREATE_INVALID_INPUT` 与 `NAMESPACE_ALREADY_EXISTS` 视为内部契约违例→安全 500 + diagnostic；REST 不返回 `NAMESPACE_ALREADY_EXISTS` | `rest-registry-failure-mapping-contract.test.ts`（B1–B7）；§3.2 OBS-2 缺口裁决见 §12.2 R1 |
| 取消边界 C1–C2 | body 读取尊重 `Request.signal`、中断后 Registry 零触达；调用 Registry 后不传播取消，等待 settle 并 release | `rest-abort-boundary-contract.test.ts`（C1–C5） |
| Observability O-1–O-3 | 两个同步 void observer 强制显式注入；observer throw 隔离；metrics 低基数无敏感字段；diagnostic 三类事件、不带 schema/root/完整 issues | `rest-observer-contract.test.ts`（D1–D6） |
| AC1–AC6 | 逐条映射见 §12.3（覆盖 6/6） | 三个红灯契约文件 + 支撑绿锚 |

## 3. SA8 constraints（本契约的落实）

| SA8 结论 | 本契约落实 | 证据 |
|---|---|---|
| F1 `REGISTRY_NOT_ACCEPTING` → 503（零提交、可重试） | 真实 Registry `shutdown()` 后 create 窄拒绝 → 503 + 逐字 code；metrics `unavailable`；零 diagnostic | B1；support §1 |
| F2 typed operational failure → 500 `NAMESPACE_CREATE_FAILED`（committed:false） | 真实 `DocCreateOperationalError`（提交前 typed 运营失败）→ 500 + 逐字 code；metrics `failed`；零 diagnostic（非三类事件） | B2；support §2 |
| F3 Registry fatal 且 `committed:true` → 500 `NAMESPACE_CREATE_OUTCOME_UNKNOWN`（不得自动重试） | 真实 `runtime-construction` fatal（已提交事实可由另一 registry open 读回）→ 500 + 逐字 code；diagnostic `registry-fatal` + exact cause | B3；support §4；D5(a) |
| F4 unknown exception / 内部契约违例 → 500 `INTERNAL_ERROR` + diagnostic | 真实 fatal `committed:false`、注入 unknown throw、注入 `NAMESPACE_CREATE_INVALID_INPUT` / `NAMESPACE_ALREADY_EXISTS` → 均 500 `INTERNAL_ERROR` + diagnostic | B4–B7；D5(b)(c)(d) |
| C1 body 读取尊重 signal、中断后 Registry 零触达 | pre-abort 与 mid-read abort 两路：零触达探针 `invocations === []`、有界 rejection、metrics `aborted` | C1/C2；support §5（平台事实） |
| C2 调用 Registry 后不传播取消、等待 settle 并 release | create 在途 / release 在途 abort → 仍 201、release 恰一次、lease released、metrics `succeeded` | C3/C4 |
| O-1 两 observer 强制显式注入、throw 隔离、不改 HTTP 结果 | 显式注入门（TypeError）；四分支（201/503/500/release-failure）下双 observer 同 throw 结果不变 | D1/D3 |
| O-2 metrics 低基数、无 owner/namespaceId/issues/schema/root/cause | 全分支矩阵逐事件键白名单 + outcome 词表 + operation 常量 + 哨兵串/`ns-` id 泄漏扫描 | D2/D6 |
| O-3 diagnostic 仅三类、可带 exact cause、不得带 schema/root/完整 issues | 四类诊断事件 kind ∈ 三类 + `cause` 引用相等 + schema/root/`issues` 缺失扫描 | D4/D5/D6 |
| **OBS-1 ADR-0015 仍为「提议」** | §3.1 显式锚定 ADR 修订（HEAD + blob + sha256 + 状态 + 父 PR）；若 0015 正式接受前被修订，本契约须重新过门禁 | §3.1 |
| **OBS-2 fatal `committed:false` 映射未落位** | **本契约钉死：→ 500 `INTERNAL_ERROR`**（裁决 R1，§12.2），并以「同一注入形状、仅 committed 事实为变量」的 B3/B4 对照锁定 | B3 vs B4；§9 M1/M2 |
| **OBS-3 与 #268 共享 body 读取段** | §12.4 声明 ownership 边界 + **abort 优先于 413 的可执行裁决**（C5：pre-aborted + `limits.maxBodyBytes` 超限 → aborted，不是 413） | C5；§12.4 |

### 3.1 ADR revision anchor（dispatch 明确要求）

- Worktree HEAD：**`0b06050d9518c66ef166751064c95ed9557c9532`**（`fix(#267): REST router 骨架…(#296)`，
  2026-09-11 05:51:35 +0800），branch `mabf/issue-269`。
- 主锚定 `docs/adr/0015-vertical-rest-namespace-create.md`：git blob
  `64daa16a43ef2718f7f8d692f77a82ac7517e341`，sha256
  `3a75f99b85c6bbba54086359bc71df52d94aaecb3f44d5212d0f98421082d148`，
  **状态：提议（L4）**，父 PR #158 `docs/rest-namespace-create` 仍 OPEN。
- 关联决策：`docs/adr/0009`（blob `5853a4b77326765e9abe21fecd106666b0101380`，sha256
  `10850c17feba732e96581044bdb0dec1e6172cc7a842678574ae67b5df4651ad`，已接受 + #131/#134/#228
  修订节）、`docs/adr/0010`（blob `464d1204bfd33eb2073b6c7c03292daffb77dd62`，Namespace identity
  L28）、`docs/adr/0012`（blob `0c4b95059a2426154d6267ebb5a1788b6d49ffcb`）。
- **契约有效期**：以上修订为唯一锚。ADR-0015 现文 L175–L190 是本契约逐条断言来源；
  若 0015 在正式接受（或修订）时改变这些条款，本契约必须走修订轮 + SA8 复审——
  实现方不得以「设计另判」直接改测试（沿用 #267 §12.1 的冻结纪律）。

## 4. Environment and baseline

- 运行环境：node `v24.13.0`、pnpm `10.28.2`、vitest `3.2.7`、TypeScript `5.9.3`。
  本 worktree 初始**无 `node_modules`**；`pnpm install --offline --frozen-lockfile`
  复用本机 store（65 包，exit 0；仅 esbuild postinstall 被 pnpm 默认跳过警告，vitest 实测可用）。
- 测试入口（仓库真实入口，与根 `pnpm test` 同款参数）：
  `NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run --typecheck packages/namespace-api/test`
  （根 `package.json` `test = … vitest run --typecheck`；根 `vitest.config.ts`
  `include: ['packages/*/test/**/*.test.ts', …]`；`maxWorkers: 1`）。
- **改动前基线**：#267 契约 4 文件 35/35 绿（`Test Files 4 passed (4)`）。
- 改动后基线（本票最终测试字节）：8 文件、64 用例、`3 failed | 5 passed`、
  `17 failed | 47 passed`、`Type Errors: no errors`；`tsc -p tsconfig.typecheck.json
  --noEmit`（含全部 packages 的 src+test）**0 error**；`tsc -p
  packages/namespace-api/tsconfig.json` OK。
- 生产源码保持 pristine：`rest.ts` sha256 `d90c5c56…`、`create-namespace.ts` sha256
  `ccc240a2…`（与改动前逐字一致，见 §16）。

## 5. Positive reproduction（Feature 能力缺口：目标断言红灯）

命令（最终字节，连续 3 次逐位一致）：

```
$ NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run --typecheck packages/namespace-api/test
 Test Files  3 failed | 5 passed (8)
      Tests  17 failed | 47 passed (64)
Type Errors  no errors
# exit=1；3/3 复跑一致（red-final-1/2/3）
```

17 个红灯与失败原因（全部落在本票目标断言，且失败信息为契约语义而非环境噪声）：

| 红灯 | 目标分支 | 首批失败原因（真实输出） |
|---|---|---|
| B1 | 503 | `期望匹配 Response，实际 handle rejection：unmapped registry issue: REGISTRY_NOT_ACCEPTING` |
| B2 | 500 FAILED | `…unmapped registry issue: NAMESPACE_CREATE_FAILED` |
| B3 | 500 OUTCOME_UNKNOWN | `…handle rejection：NamespaceRegistryFatalError … runtime-construction（committed=true）` |
| B4 | 500 INTERNAL_ERROR（fatal false） | `…NamespaceRegistryFatalError … create-document-internal（committed=false）` |
| B5/B6 | 内部契约违例 | `…unmapped registry issue: NAMESPACE_CREATE_INVALID_INPUT / NAMESPACE_ALREADY_EXISTS` |
| B7 | unknown exception | `…handle rejection：Error: sa6-269 unknown exception sentinel` |
| C1/C5 | pre-abort | 零触达断言红：`expected [ 'create' ] to deeply equal []`（骨架读了 body 并真的调用了 Registry） |
| C2 | mid-read abort | `结算超时：handle 在期限内未 resolve/reject: expected 'timeout' to be 'rejected'`（悬挂） |
| C3/C4 | 接纳后取消 | `expected [] to deeply equal [ 'succeeded' ]`（201 与 release 已正确，**缺 metrics 事件**——不伪称红） |
| D2/D4/D5 | observer 事件 | `expected [] to have a length of 1 but got +0` |
| D3 | observer throw 隔离 | 503 分支仍 rejection：`unmapped registry issue: REGISTRY_NOT_ACCEPTING` |
| D6 | 跨分支矩阵 | 零触达断言 + 事件计数（能力缺口复合） |

红灯原因归类（`red-final-1.log` 聚合）：8 例「期望匹配 Response 实得 rejection」（四类 Registry
结局未映射）；3 例 metrics 事件缺失；3 例 Registry 被触达（abort 未观察）；2 例 metrics
`['succeeded']` 缺失；1 例 abort 悬挂。

## 6. Negative control（相近负控，恒绿）

1. **支撑/负控文件** `rest-failure-contract-support.test.ts`（不 import router，红灯基线下 9/9 绿）：
   真实 Registry 四类故障事实（NOT_ACCEPTING / operational FAILED / fatal committed:false /
   fatal committed:true + 已提交 namespace 可被另一 registry open 读回）；Node abort 运行时
   事实（pre-aborted + 完整 body → `request.json()` resolve；mid-read abort 不自行结算）；
   探针判别力（recorder 捕获实参、零触达探针记录调用并 throw、probe wrapper 委派真实成功路径）。
2. **同文件负控 2 例**（红灯基线下绿）：真实 Registry 正常 create 仍 201（同一构造路径，
   失败断言非恒真）；未匹配 route → `matched:false`、405 → `Allow: POST` 且零 Registry 调用。
3. **变异矩阵 M0 对照**：不施加变异的绿灯模拟件 → 29/29 绿（探针链本身不产生红）。
4. **B3/B4 互为对照**：同一注入形状（fatal）、唯一变量 committed 事实 → 期望不同 500 code；
   M1/M2 两个方向变异分别只打中对应断言（§9 E2）。

## 7. Stability, scale and timing

- **红灯稳定性**：同一命令连续 3 次 → `3 failed | 5 passed (8)`、`17 failed | 47 passed (64)`、
  `Type Errors: no errors` 逐次一致（§13.1）。
- **绿灯可满足性稳定性**：临时模拟件下整包 8/8 文件、64/64 绿；变异矩阵 14 次运行（M0+13）
  结果确定、无抖动。
- **时序/规模条件**：全套红灯跑 ~4.6–5.2s；无 sleep；C2 的 2s 是「有界结算」上限——基线
  实现真的悬挂（证明必须显式 race signal），绿灯实现 ~ms 级结算；C3/C4 用 create/release
  门 promise + `setImmediate` 自旋（5s/2s 上限），不是固定 sleep；MemoryPersistence fixture
  全部 `finally` shutdown + dispose，mid-read 流经 `controller.error()` 清理。
- **无竞态/无规模依赖**：本票单请求顺序语义；abort 时序用 pull 计数与 release 计数锚定
  「读取已开始 / release 已开始」，避免先到竞态。

## 8. Capability gap（替代 Bug 根因链）

| Step | Fact | Evidence | Confidence |
|---|---|---|---|
| 症状 | #269 全部目标分支无 HTTP 映射：503/500 四类均以 `handle` rejection 结算；abort 不中止读取；observer 零发射 | 17 红灯（§5）；`rest.ts` L15–20 头注 + 包 AGENTS.md deferral 清单 | 高 |
| 直接故障点 | `orchestrateCreateNamespace` 对 `!created.ok` 抛内部 `Error`、对 fatal/unknown 无 catch；`request.json()` 直接读取、不观察 `Request.signal`；observer 只在构造期校验、无事件调用点 | `src/create-namespace.ts` L36/L47/L61–63/L71–75；`src/rest.ts` L44–47/L53–55/L186 | 高 |
| 触发条件 | Hub create 路径上 Registry 返回窄 issue 或 reject fatals；请求带 AbortSignal；任一分支需要 metrics/diagnostic | 红灯用例（B1–B7/C1–C5/D2–D6） | 高 |
| 深层缺口 | 本票是 #267 显式延后的「Registry 失败映射、signal、observer 事件契约」增量（骨架按纯加法预留）；无映射 = 无 503/500 语义，无 signal = abort 时仍触达 Registry，无事件 = observability 面不存在 | `packages/namespace-api/AGENTS.md`「Deferred to later tickets」；`README.md` L21 | 高 |
| 放大因素 | Node 24 的 `Request.signal` 不使进行中的 body 读自行失败（pre-aborted 完整 body 仍 resolve；mid-read 悬挂）——实现不能依赖平台，必须显式观察 signal；否则 abort 语义在真实 server 下完全失效 | support §5 运行时事实（本机实测）；C2 悬挂 | 高 |
| 未证实假设 | 无（本报告不对未来 server listener/HTTP 状态码做断言） | — | — |
| 排除项 | 非环境/fixture/超时/入口错误：支撑 9/9 绿、`Type Errors: no errors`、四类故障输入均为真实 Registry 产物、M0 对照绿 | §4/§6/§13 | 高 |

## 9. Causal experiments

### E1 可满足性（绿灯模拟，因果对照：唯一变量 = 语义实现是否存在）

在 `src/rest.ts` / `src/create-namespace.ts` 放入自标注「临时诊断件」的最小语义实现
（abort-aware body 读 + 四类失败映射 + 双 observer 事件 + throw 隔离；observer 参数
类型事件化），测试字节**不变**：

```
 Test Files  8 passed (8)
      Tests  64 passed (64)   # #267 legacy 35 + #269 新增 29
Type Errors  no errors
```

随即还原 pristine（§16 哈希证据）。红→绿唯一变量是「本票目标语义是否存在」。

### E2 断言敏感性（定点变异矩阵，14 组）

工作树之外 `/tmp/sa6-269-evidence/run-mutations.mjs`（不属交付树）：M0 对照 + M1–M13，
逐条注入 → 跑 4 个 #269 文件（29 用例）→ JSON reporter 解析失败用例名 → 还原。

| 变异 | 语义偏差 | 被捕获断言 | failed |
|---|---|---|---|
| M0 | 无变异对照 | — | 0/29 |
| M1 | fatal `committed:false` → 500 `NAMESPACE_CREATE_FAILED` | B4（§12.2 R1 裁决） | 1 |
| M2 | fatal `committed:true` → 500 `INTERNAL_ERROR` | B3 + D3 | 2 |
| M3 | 内部契约违例 → 500 `NAMESPACE_CREATE_FAILED` | B5 + B6 | 2 |
| M4 | 内部契约违例不上报 diagnostic | B5 + B6 + D5(d) | 3 |
| M5 | unknown exception → 500 `NAMESPACE_CREATE_FAILED` | B7 | 1 |
| M6 | 去掉 pre-abort 同步判断（依赖平台读） | C1 + C5 + D6 | 3 |
| M7 | 去掉读取×signal race（mid-read 悬挂） | C2（有界结算） | 1 |
| M8 | 接纳后仍传播取消（不等待 settle/release） | C3 | 1 |
| M9 | metrics 事件携带 namespaceId | D2 + D6 | 2 |
| M10 | diagnostic 丢 exact cause、改带 issues 数组 | D5(d) + D6 + B5 + B6 | 4 |
| M11 | metrics observer throw 不被隔离 | D3 | 1 |
| M12 | release failure 不上报 diagnostic | D4 | 1 |
| M13 | 503 分支 outcome 误记 `failed` | B1 + D6 | 2 |

无「变异后仍全绿」的断言；每条变异至少打中一个**目标**断言，且 M0 证明探针链自身不产生红。
（M8 仅 C3 捕获符合时序：C4 的 abort 发生在 release 已开始、M8 检查点之后。）

### E3 边界未被 mock；观测纪律

- 真实边界：HTTP 侧是标准 Web `Request → Response`；Registry 侧 503 / FAILED / 两类 fatal
  全部由**真实** `NamespaceRegistry` + MemoryPersistence + Registry testing 注入面产生
  （support 文件独立证明）。
- 仅在真实管线**结构上不可能**确定性产生的结果上做公共接口注入：`NAMESPACE_CREATE_INVALID_INPUT` /
  `NAMESPACE_ALREADY_EXISTS`（REST 自行构造合法输入，正常路径不产生）与 unknown throw。
  注入点是 `NamespaceRegistry` 公共成员（ADR 0015 §测试决策指定的 seam），不是被测故障
  （故障在 REST 映射）；probe wrapper 全程委派真实 registry 并在 support 中证明。
- 无源码字符串/正则替代断言；全部断言为 HTTP 状态/形状/值、Registry 公共 seam 输入/结算、
  observer 实参对象、lease 可观察状态。

## 10. Impact surface

- 交付面仅测试 + 报告：5 个新文件（4 `*.test.ts` + 1 harness）+ 本报告；生产源码零改动
  （§16 哈希还原证据）。
- 契约钉死的未来实现面（供 SA1 设计/SA3 实施）：
  `RestRouterOptions.metricsObserver/diagnosticObserver` 的事件化签名（参数收窄仍兼容零参
  调用方）；`orchestrateCreateNamespace` 的失败映射/abort/事件发射；response problem shape
  的 `code` 契约（`{code, message?}` 最小面，完整 4xx 形状归 #268）。
- 不影响 #267 已冻结行为：legacy 35 用例在红灯基线与绿灯模拟下均绿；固定顺序
  route → method → role → owner → body → derive → create → DTO → release → response 不被重排。

## 11. Ruled-out hypotheses

| 假设 | 判定 | 依据 |
|---|---|---|
| 红灯来自环境/依赖缺失 | 排除 | `pnpm install --offline` 后 legacy 35/35 绿；`Type Errors: no errors`；两个 tsc 入口 0 error |
| 红灯来自 fixture 写错（注入的不是真实故障） | 排除 | 支撑文件 9/9 绿：四类故障均为真实 Registry 产物（含 committed:true 的提交事实可 open 读回） |
| 红灯来自测试入口/收集错误 | 排除 | `vitest list --filesOnly` 收集 8 个 `*.test.ts`（harness 未收集）；真实入口 `--typecheck` 可触发 |
| 红灯来自超时/竞态抖动 | 排除 | 3/3 复跑逐位一致；时序锚为 pull/release 计数而非 sleep；C2 的 2s 是「悬挂」断言本身（M7 证明其判别力） |
| 骨架已有 abort 处理（零触达本就成立） | 排除 | C1/C5 红灯显示 Registry 真被调用（`['create']`）；平台读不会因 signal 失败（support §5） |
| 503/500 映射可通过 rejection 表达 | 排除 | issue AC1 要求 HTTP 状态 + 稳定 code + committed 语义；`handle` 判别结果是唯一 HTTP seam |
| `NAMESPACE_ALREADY_EXISTS` 属正常公开结局 | 排除 | ADR 0015 L180 + ADR 0010 L28：namespaceId 由 Registry 内部生成，普通 REST create 不应返回它 → 内部契约违例 |
| 本票需要实现 #268 的 4xx/422/limits | 排除 | §12.4 ownership 边界；C5 只冻结 abort 与 413 的交互裁决 |

## 12. Acceptance contract and test paths

### 12.1 接口/事件形状提案（PROPOSAL，待 SA1/SA2 仲裁；若设计另有裁决须回写测试并走修订轮）

- **H-M（metrics 事件）**：`metricsObserver(event)` 单对象单实参；键集 ⊆
  `{operation, outcome, code, status}`；`operation` 为同一 router 恒定的非空 string；
  `outcome ∈ {succeeded, rejected, unavailable, failed, aborted}`；`code` 非空 string；
  `status` number；**非 2xx 结算的 `code` 必须等于 response body 的稳定 code**；
  2xx 的 `code` 可省略；abort 无 status。
- **H-D（diagnostic 事件）**：`diagnosticObserver(event)` 单对象单实参；`kind ∈
  {registry-fatal, unknown-exception, lease-release-failure}`；`cause` 必须为 exact cause
  **对象引用**；`operation/phase/committed/namespaceId/owner` 可选（出现时必须诚实：
  committed/phase 取自 branded fatal，owner 为本请求已验证 owner，namespaceId 命中
  `^ns-[0-9a-f]{32}$`）。ADR L178 把「unknown exception」与「内部契约违例」归入同一 500 类，
  故内部契约违例使用 `unknown-exception` kind。
- **H-A（abort 结算）**：body 读取阶段 abort 以 **`handle` rejection** 结算（不伪造 HTTP
  Response）；有界（有限时间内 settle）；唯一分类面是 metrics `outcome:'aborted'`。
- 兼容性：两个 observer 参数类型的事件化（增加参数）不破坏既有零参调用方（#267 契约
  的 `(): void => {}` no-op 仍可赋给 `(event) => void`）；测试用 `(...args) => void`
  记录器对两种签名都合法。

### 12.2 契约裁决（SA8 OBS-2 缺口 + 交互边界，本契约钉死）

- **R1（dispatch 明确要求）fatal `committed:false` → 500 `INTERNAL_ERROR`**。理由：
  `NAMESPACE_CREATE_FAILED` 按 ADR 0015 L176 / ADR 0009 L81 专属 **typed operational
  failure**（fatal 不经公开窄 issue 通道）；`NAMESPACE_CREATE_OUTCOME_UNKNOWN` 专属
  `committed:true`；提交前 branded fatal（`create-document-internal` /
  `namespace-id-generation` / `lifecycle-slot-internal` / persistence pre-commit fatal）
  是内部服务故障，落 L178 的残留类 `INTERNAL_ERROR`。该裁决由 B4 正向锁定 + B2/B3 反向
  排除（同一断言点同时反断言 `≠ NAMESPACE_CREATE_FAILED`、`≠ …OUTCOME_UNKNOWN`）。
- **R2（abort 结算）**：body 读取阶段 abort → `handle` rejection + 有界 + Registry 零触达 +
  metrics `aborted` + 零 diagnostic（H-A）；不得以 2xx/5xx Response 伪装结局。
- **R3（#268 共享 seam 交互）**：同一请求 abort 与超限（413）条件同时成立时 **abort 优先**
  （读取阶段入口先观察 signal；超限检查不得抢在 abort 前产出 413）；该裁决由 C5 可执行锁定，
  在 #269 单独合入时即绿、在 #268 合入后必须保持绿。
- **R4（诊断归类）**：`NAMESPACE_CREATE_INVALID_INPUT` / `NAMESPACE_ALREADY_EXISTS` 的
  diagnostic 事件使用 `unknown-exception` kind（ADR L178 同类分组），携带 exact cause
  （注入的窄 issue 对象引用），不携带完整 validation issues。

### 12.3 AC → 断言映射

| 简报 AC | 断言（行为级） | 测试 |
|---|---|---|
| AC1 503 / 500 三分支按 Registry 结果类型精确映射，committed 语义正确 | 真实 shutdown → 503 + `REGISTRY_NOT_ACCEPTING`；真实 `DocCreateOperationalError` → 500 `NAMESPACE_CREATE_FAILED`；真实 fatal `committed:true` → 500 `NAMESPACE_CREATE_OUTCOME_UNKNOWN`；真实 fatal `committed:false` → 500 `INTERNAL_ERROR`（R1）；unknown throw → 500 `INTERNAL_ERROR`；每例 `content-type: application/json`、body 无 owner/schema/root/issue message 泄漏、metrics 恰一事件且 code 与 body 一致 | mapping B1–B4/B7 |
| AC2 `NAMESPACE_CREATE_INVALID_INPUT` / `NAMESPACE_ALREADY_EXISTS` → 安全 500 + diagnostic | 两注入码均 500 `INTERNAL_ERROR`；response 不含 issue message；diagnostic 恰一事件、exact cause 引用相等、kind `unknown-exception` | mapping B5/B6 |
| AC3 body 读取中断时 Registry 零触达；接纳后中断不取消 create，等待 settle 并 release | pre-abort / mid-read：零触达探针 `invocations===[]`、有界 rejection、metrics `aborted`、零 diagnostic；create 在途 abort → 201 + release 恰一次 + metrics `succeeded`；release 在途 abort → 201 + release 恰一次 + lease released；C5：abort 优先于 413 | abort C1–C5 |
| AC4 两 observer 强制显式注入；metrics 低基数无敏感；diagnostic 仅三类且不带 schema/root/完整 issues | 缺任一 observer → TypeError（显式 no-op 可构造）；全分支矩阵逐事件键白名单/outcome 词表/operation 常量/无哨兵串无 `ns-` id；diagnostic kind ∈ 三类、exact cause、无 schema/root、无 `issues` | observer D1/D2/D4/D5/D6 |
| AC5 observer throw 不改变 HTTP 结果 | 双 observer 同 throw 下 201 / 503 / 500 `OUTCOME_UNKNOWN` / release-failure 201 均不变 | observer D3 |
| AC6 测试覆盖 not accepting / operational failure / fatal committed 二分 / 中断语义 / observer 隔离 | 三文件 29 用例（7+5+5 红 + M0 对照绿锚；支撑 9 绿） | 见 §12.5 |

### 12.4 与 #268 的交互边界（SA8 OBS-3；不重复实现、不相互改写）

- **共享 body 读取段（step 4）**：形状/owner/query/Content-Type/Encoding/limits/413/415/400/
  422 与完整 problem shape 归 **#268**；`Request.signal` 中断与 503/500 结局族归 **#269**。
- 两票结局族不相交（#268 = 4xx/422；#269 = 503/500），无顺序硬依赖；#269 的实现必须以
  **纯加法**接入同一读取段，不得 reorder 冻结顺序（#267 B-3）。
- **唯一重叠语义由本契约裁决**：abort 与超限同现时 abort 优先（R3 / C5），避免两票合入时
  一方把另一方结局改写。
- `NAMESPACE_SCHEMA_INVALID` / `NAMESPACE_ROOT_INVALID`（Registry 窄 issue → 422）**不在
  本契约断言面**；#269 只断言上一段列举的结局族。
- 本契约对 403/405 分支不断言「必须有 metrics 事件」，只在事件出现时做低基数/无泄漏合规
  扫描（D6），避免把 #267/#268 的事件存在性提前锁死。

### 12.5 测试路径

```
packages/namespace-api/test/rest-failure-contract-harness.ts                 （fixture，非测试）
packages/namespace-api/test/rest-registry-failure-mapping-contract.test.ts   （9 用例）
packages/namespace-api/test/rest-abort-boundary-contract.test.ts             （5 用例）
packages/namespace-api/test/rest-observer-contract.test.ts                   （6 用例）
packages/namespace-api/test/rest-failure-contract-support.test.ts            （9 用例，恒绿锚）
```

## 13. Red/green or baseline evidence

### 13.1 最终红灯基线（最终测试字节，清理模拟件后）

```
$ NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run --typecheck packages/namespace-api/test
 Test Files  3 failed | 5 passed (8)
      Tests  17 failed | 47 passed (64)
Type Errors  no errors
# 3 次复跑逐位一致（duration 4.64s / 4.65s / 5.22s）；exit=1
```

红灯点：`rest-registry-failure-mapping-contract.test.ts`（7/9）、
`rest-abort-boundary-contract.test.ts`（5/5）、`rest-observer-contract.test.ts`（5/6）；
绿点：#267 legacy 4 文件 35/35、本票支撑 9/9、mapping 负控 2/2、observer D1 1/1。

### 13.2 可满足性绿灯锚（临时模拟件，测试字节不变）

```
 Test Files  8 passed (8)
      Tests  64 passed (64)
Type Errors  no errors
```

### 13.3 变异矩阵（最终测试字节复跑）

M0 对照 0 红；M1–M13 分别 1/2/2/3/1/3/1/1/2/4/1/1/2 例红，全部为 §9 E2 表列目标断言；
无「变异后仍全绿」。明细 `/tmp/sa6-269-evidence/mutation-summary.json`（不进交付树）。

### 13.4 最终测试文件哈希（sha256）

```
14062b3dacae633b98b2e6b684a7c2d0f8e1a9a05065185269a44e3ee50013e0  rest-failure-contract-harness.ts
9f9688abbe11cc20618fb2becf80a37da097504298e0cf540090c1b84cc3b57e  rest-failure-contract-support.test.ts
14465a4032ec36b0059d19a7b0ebe2cc59c1f56d00c7c578cecf670d9e8d695c  rest-registry-failure-mapping-contract.test.ts
2f298a8e23afbd29d243f64efe22a76ee84d5911deee7b52370954bb607345d2  rest-abort-boundary-contract.test.ts
dbf8778aecd36d059f424acfc075fe189b4b50cfcbd8f091c12c2bdeb91b3dfa  rest-observer-contract.test.ts
```

红灯、绿灯、变异三组证据均在上述最终字节上复跑；#267 既有 5 个测试文件字节未动。

## 14. Runner trigger evidence

- 发现性（根配置 `include: ['packages/*/test/**/*.test.ts', …]`）：

```
$ NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest list --filesOnly packages/namespace-api
packages/namespace-api/test/rest-abort-boundary-contract.test.ts
packages/namespace-api/test/rest-contract-support.test.ts
packages/namespace-api/test/rest-create-hub-contract.test.ts
packages/namespace-api/test/rest-failure-contract-support.test.ts
packages/namespace-api/test/rest-observer-contract.test.ts
packages/namespace-api/test/rest-public-seam-wiring.test.ts
packages/namespace-api/test/rest-registry-failure-mapping-contract.test.ts
packages/namespace-api/test/rest-role-gate-routing-contract.test.ts
```

- `rest-failure-contract-harness.ts` 未被收集（fixture 身份正确）。
- 仓库真实入口触发（含 `--typecheck`，与根 `pnpm test` 同款参数）：§13.1 红线 + §13.2 绿线。
- 类型门：`node_modules/.bin/tsc -p tsconfig.typecheck.json --noEmit`（覆盖全部
  `packages/*/test/**/*.ts`）→ **0 error**；`node_modules/.bin/tsc -p
  packages/namespace-api/tsconfig.json` → OK。
- 无 skip/only/todo；无 env override（`--conditions=nomicore-source` 是仓库 `pnpm test`
  既有条件，非契约专用开关）；无吞错/软化断言。

## 15. Unknowns and blockers

- **形状提案待仲裁**：§12.1 的 H-M/H-D/H-A 与 §12.2 的 R1–R4 是本契约的裁决/提案；SA1
  设计与 SA2 评审如另有裁决，必须走**修订轮**回写测试与本报告（实现方不得改契约以迁就
  实现——沿用 `packages/namespace-api/AGENTS.md`「frozen acceptance contract」纪律）。
  风险最高的两条：abort 结算形状（rejection vs 某 Response）与 fatal `committed:false`
  的 code 落位（R1）。
- **ADR-0015 仍为「提议」**（SA8 OBS-1）：本契约锚在 HEAD `0b06050` 的 0015 修订
  （§3.1）；若 0015 在正式接受/修订时改变 L175–L190，须重新过 SA8 门禁 + 修订本契约。
- **SA8 报告不在固定路径**、`task_issue-269_relevant_decisions.md` 缺失：本报告按实际
  可得产物工作（§1）；不影响诊断可信度，但登记给总控/后续阶段对齐文件布局。
- **metrics 成功事件的 `code`**：契约只要求「出现时必须是 string、与 body code 一致（若
  body 有）」；成功码的具体取值（如 `CREATED`）留给设计，不在断言面。
- **#268 的 4xx/422 与 limits**：本契约按 §12.4 划界，不断言、不阻塞；C5 只冻结 abort
  与 413 的优先关系。
- 无阻塞红灯契约建立的环境或事实缺口；无未决复现（红灯 3/3 稳定）。

## 16. Temporary diagnostics cleanup

| 临时件 | 处理 | 证据 |
|---|---|---|
| `packages/namespace-api/src/create-namespace.ts`（未来绿灯模拟，自标注临时） | **已还原 pristine** | 模拟件 sha256 `fed955b61af588603bb0748ec671b098a4abf0e55febb13252c48d2a3e64a389`；pristine sha256 `ccc240a22c789c74a765b3330d4be56bfc29720bb254294b6f03711d80a31a7c`，`diff` 逐字一致 |
| `packages/namespace-api/src/rest.ts`（模拟件 observer 事件化） | **已还原 pristine** | 模拟件 sha256 `509ab2ae59b8570e496831e894da722a2796f464a7a94288f209819d498f9469`；pristine sha256 `d90c5c56586641bdf46f1462e85431e19bebd8e03b45f0c56bbc2df859001cd5`，`diff` 逐字一致 |
| 变异 runner / 绿灯副本 / 各轮日志（`run-mutations.mjs`、`*.green`、`red-final-*.log`、`mutation-summary.json`） | 仅存在于 worktree 之外 `/tmp/sa6-269-evidence/`，**不进交付树** | `git status --porcelain` 无相关条目 |

清理后复核：`git status` 仅 5 个新增测试文件（+ 任务既有 untracked 输入）；生产源码
sha256 与改动前一致；红灯基线 3/3 复跑一致；无 `nohup`/`setsid`/PID/轮询 marker；无后台
服务残留（fixture 全部 `finally` 收尾；find 检索到的临时进程仅为本轮 vitest/tsc 前台命令）。

## 17. Verdict

**`approve`**

- 能力缺口可信且因果闭合：唯一变量实验（同一测试字节 + 有/无目标语义）给出红→绿对照
  （17 红 → 64/64 绿）；13 组定点变异全部被目标断言捕获 + M0 对照绿；相近负控恒绿。
- 契约可执行且被仓库真实入口发现（`vitest list` + `--typecheck` 入口 + 两份 tsc 0 error）。
- 红灯只落在本票目标面（缺失的失败映射、signal 观察与 observer 事件），失败信息均为契约
  语义；`Type Errors: no errors`；无伪红/伪绿。
- SA8 OBS-1/2/3 全部落实：ADR 修订锚定（§3.1）、fatal `committed:false` 落位裁决（R1/B4）、
  #268 共享 seam 边界与 abort/413 裁决（§12.4/C5）。
- 临时诊断件已清理并留哈希/还原证据；工作树交回测试面 + 本报告。
