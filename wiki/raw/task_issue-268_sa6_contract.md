# SA6 诊断与验收契约报告 — issue #268：REST create 请求形状校验、资源 limits 与 4xx/422 错误契约

> 阶段：acceptance-contract（Feature 能力缺口红灯固化，iteration 0）。
> 前置：SA8 冲突门禁 `clear`（`wiki/raw/task_issue-268_conflict_report.md`，0 冲突）。
> Issue comments REST snapshot：**空（`[]`）**——无 Owner 追加要求、无评论锚定义务。
> 结论：能力缺口已实证。HEAD `0b06050`（#267 骨架）只有成功路径与 role gate；
> 49 个新增契约用例 + 8 个支撑/负控绿锚（合计 57 个新用例，全包 92 用例）已固化为
> **可执行红灯契约**：`3 failed | 5 passed (8 files)`、`44 failed | 48 passed`（3/3 复跑
> 逐位一致）。红灯只来自「step 3/4/5 + limits + problem shape 未实现」这一能力缺口
> （非法请求当前 201 或 rejection）。同一契约在临时「未来绿灯模拟件」下 **92/92 全绿**
> （可满足性），18 例定点变异 **全部被目标断言捕获**（敏感性），模拟件已清理。
> Verdict：**`approve`**（详见 §17）。

## 0. 交付物

| 文件 | 内容 | 状态 |
|---|---|---|
| `packages/namespace-api/test/rest-validation-harness.ts` | #268 契约共享 fixture/harness：problem shape 运行时校验器、Request 构造器（raw/流式/无 body）、深层 raw body、UTF-8 byte 助手、14 类失败 scenario 矩阵（失败链一律 poison registry，仅 `root-invalid` 用真实 Registry）。非 `*.test.ts`，不被 vitest 收集 | 新增 |
| `packages/namespace-api/test/rest-create-request-validation-contract.test.ts` | HTTP/media 层 + JSON 处理 + 顶层形状 + 400/415/422 映射（18 用例，15 红） | 新增（红灯） |
| `packages/namespace-api/test/rest-create-limits-contract.test.ts` | limits 构造门 + 七项默认值 + Partial 覆盖 + 413 + 迭代 depth/nodes/数字检查（23 用例，21 红） | 新增（红灯） |
| `packages/namespace-api/test/rest-create-problem-contract.test.ts` | problem shape 键集/类型、code 稳定性与 14 类可分性、403/405 形状升级、422 issues 受控（8 用例，全红） | 新增（红灯） |
| `packages/namespace-api/test/rest-create-validation-support.test.ts` | 契约支撑负控/绿锚：平台 JSON 语义、Request/深层 body fixture、VFSL 窄接口、Registry 领域判定与门禁、poison 自证（8 用例，恒绿） | 新增（绿） |
| `wiki/raw/task_issue-268_sa6_contract.md` | 本报告 | 新增 |

**零生产实现改动**（`git status` 仅新增上述 5 个 test 文件 + 本报告；`packages/namespace-api/src/` 与 HEAD 逐字节一致，
sha256 见 §16）。无 commit/push/PR；临时「未来绿灯模拟件」与诊断探针已删除（§16）。

## 1. Task type and inputs

- **任务类型：Feature**（在 #267 骨架上叠加 ADR 0015 step 3–5 的入站校验、资源 limits 与
  4xx/422 错误契约；不是 Bug 修复）。因此本契约证明**能力缺口**并固化目标行为，不虚构根因。
- 输入（固定位置）：
  - 任务简报 `wiki/raw/task_issue-268.md`（issue #268，State: open，updated 2026-09-10T22:21:45Z；
    Parent = PR #158 `docs/rest-namespace-create`；Blocked by #267；What to build 五节 + AC 五条）；
  - 派发记录 `wiki/raw/task_268_dispatch.md`（唯一上游 SA8 phase 记录：conflict-gate iter 0，
    Issue comments REST snapshot: none (`[]`)）；
  - SA8 冲突门禁报告 `wiki/raw/task_issue-268_conflict_report.md`（verdict `clear`；15 项要求 +
    5 条 AC 全 no-conflict；观察项 O-1..O-5；冻结面与 seam 实证表）；
  - governing 决策：`docs/adr/0015-vertical-rest-namespace-create.md`（状态：提议）
    L63–75 / L94–115 / L146–174 / L192–208；`docs/adr/0009`（Registry 窄 issue 面）；
    根 `CONTEXT.md`；`packages/namespace-api/AGENTS.md`（本包边界与验证入口）；
  - 上游代码事实：`packages/namespace-api/src/rest.ts`（#267 骨架，limits 为预留未消费构造面）、
    `src/create-namespace.ts`（最小读取 + 形状机械提取 + derive + Registry.create 成功路径）、
    `packages/vfsl` 公共 `deriveSchemaIdentity`（#266）、`packages/namespace-registry` 公共
    `NamespaceRegistry.create` 窄结果（`NAMESPACE_SCHEMA_INVALID`/`NAMESPACE_ROOT_INVALID` 带 issues）。
- 缺失输入说明：`wiki/raw/task_issue-268_relevant_decisions.md` 不存在；本报告以 SA8 门禁报告的
  ADR 逐条对照与 seam 实证表替代决策摘录，未阻塞任何断言。
- 仓库基线：HEAD `0b06050`（`fix(#267): REST router 骨架… (#296)`），branch `mabf/issue-268`；
  本契约落盘前 `packages/namespace-api/test` 既有 4 文件 35/35 绿。

## 2. Owner comment mapping

| Owner 输入 | 内容 | 契约落实 |
|---|---|---|
| Issue comments REST snapshot | **空（`[]`）**（dispatch log 记 `comments=none`；§14 复核 `gh issue view 268 --json comments` 返回 `[]`） | 无 Owner 追加要求 / 评论 ID 可映射；验收口径 = 简报五节 + AC1–AC5 + ADR 0015 对应条款 |
| 简报 What to build（HTTP/媒体层） | owner 安全文法 + path 禁止 percent-encoding；不接受 query；Content-Type 415 语义；Content-Encoding 只接受缺失/`identity` | §12.2 第 1–3 行（`rest-create-request-validation-contract.test.ts`） |
| 简报 What to build（JSON/形状） | 有界读取 → 严格 UTF-8 → 平台 JSON；last-key-wins；malformed 无源码位置；顶层恰两键；空 schemaText 交领域 | §12.2 第 4–6 行 |
| 简报 What to build（limits） | 七项默认值；Partial 覆盖；未知键/越界 TypeError；`maxSchemaTextBytes ≤ maxBodyBytes`；413；迭代检查；`-0` 无额外语义 | §12.2 第 7–8 行（`rest-create-limits-contract.test.ts`） |
| 简报 What to build（错误契约） | 固定 problem shape；稳定 code 分支；受控可序列化 issue；不泄露 schema/root；`issuesTruncated` | §12.2 第 9 行（`rest-create-problem-contract.test.ts`） |
| 简报 AC1–AC5 | 状态映射 / limits 门 / 迭代实现 / problem 安全 / 平台语义 | §12.2（覆盖 5/5） |

## 3. SA8 constraints（本契约的落实）

| SA8 门禁结论 | 本契约落实 | 证据 |
|---|---|---|
| 门禁 `clear`、0 冲突；15 项要求与 ADR 0015 逐条/逐值对齐 | 契约断言全部锚定 ADR 原文语义（状态、默认数值、键集、body/schemaText/depth/nodes/issues 上限、问题形状要求） | §12.2 映射表 |
| 固定执行顺序 step 1→2→3→4→5→6→7（L148–153）不可 reorder | 契约用 poison registry 证明 owner/query/media/encoding/body/形状/limits/schema 失败全部**零 Registry 触达**；用 trapped Request 证明 step 3 失败**零 body 读取** | §6、§9 E3 |
| O-2 `Request.signal` 归属未决（简报警未列 signal） | **契约不断言 signal**；登记为设计裁决点（§15） | — |
| O-3 owner 文法复用路径未决（`isMinimalSafeString` 未从 Registry 公共面导出） | 契约只断言可经 Web Request 观测的行为：path 内 percent-encoding → 400；合法 owner 不误伤。不锁定复用方式 | §12.1 注、§15 |
| O-5 Registry 窄 issue 面已具（`NAMESPACE_SCHEMA_INVALID`/`NAMESPACE_ROOT_INVALID` 带 issues，与 `NAMESPACE_CREATE_INVALID_INPUT` 分立） | 契约要求 422 issues 受控映射（code/message/可选 line/column 或 path、byte 上限、截断标记），不锁具体 issue code 词表 | `rest-create-problem-contract.test.ts` |
| O-1 ADR 0015 状态仍「提议」、O-4 术语卫生 | 非 SA6 权限范围，登记给总控（§15） | — |
| 冻结验收套件不得为迁就实现而改 | 既有 4 文件（#267 契约）**零改动**，新增文件与原契约同向；模拟件下既有 35 用例仍全绿 | §13.2 |

## 4. Environment and baseline

- 运行环境：node `v24.13.0`、pnpm `10.28.2`、vitest `3.2.7`、TypeScript `5.9.3`；
  `pnpm install --prefer-offline` 全量复用本地 store（65 包，无网络）。
- 测试入口（仓库真实入口）：根 `package.json` `test = NODE_OPTIONS=--conditions=nomicore-source
  vitest run --typecheck`；根 `vitest.config.ts` `include: ['packages/*/test/**/*.test.ts', …]`；
  `@nomicore/*` 经 alias 指向各包 `src/index.ts` / `src/testing.ts`。
- 工作树基线：契约落盘前既有 `packages/namespace-api/test` 4 文件 **35/35 绿**；
  本次新增 5 文件后全包 8 文件 92 用例。
- 生产实现未动：`packages/namespace-api/src/{rest,create-namespace,index}.ts` 与 HEAD 逐字节一致
  （§16 哈希）；根 `pnpm typecheck` exit 0。

## 5. Positive reproduction（Feature 能力缺口：目标断言红灯）

命令（仓库真实入口）：

```
NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run packages/namespace-api/test
# 等价入口（含 --typecheck，与根 pnpm test 同款参数）
NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run --typecheck packages/namespace-api/test
```

实测红灯基线（exit=1）：

```
 Test Files  3 failed | 5 passed (8)
      Tests  44 failed | 48 passed (92)
Type Errors  no errors
```

红灯分布（新增文件）：

| 文件 | 用例 | 红 | 绿 |
|---|---:|---:|---:|
| `rest-create-request-validation-contract.test.ts` | 18 | 15 | 3（合法 owner 201 / 接受 media 201 / 恰两键 201） |
| `rest-create-limits-contract.test.ts` | 23 | 21 | 2（`-0` 与 0 同 201 / 默认范围内合法 201） |
| `rest-create-problem-contract.test.ts` | 8 | 8 | 0 |
| `rest-create-validation-support.test.ts` | 8 | 0 | 8（恒绿锚） |
| 既有 #267 文件（4） | 35 | 0 | 35（未回归） |

失败模式（能力缺口，非环境/fixture 错误）：

- **非法 owner / query / Content-Type / Content-Encoding**：HEAD 直接创建成功（201）——
  step 3 缺失，`rest.ts` 只做 route/method/role gate；
- **空 body / malformed JSON / 请求形状 / 数字范围**：HEAD 以 `rejection` 结算
  （`SyntaxError` 或 `unmapped request shape（400 映射延后）`）——step 4/5 缺失；
- **413 系列**：HEAD 无 limits 执行——超限输入被平台 JSON 解析后送入 Registry（201、
  领域 422 或 rejection）；
- **422 领域**：HEAD 以 `unmapped VFSL issues（422 映射延后）` /
  `unmapped registry issue: NAMESPACE_ROOT_INVALID` rejection；
- **problem shape / code 稳定与可分**：HEAD 的 403/405 body 只有 `{code}`（无 `message`），
  4xx/422 无 Response——形状/稳定性/可分性断言全部无法成立。

`Type Errors: no errors` 且支撑/负控 8/8 绿、既有 35/35 绿，证明红灯不来自依赖、fixture、
Persistence/VFSL/Registry 既有能力或测试入口。

## 6. Negative control（相近负控，恒绿）

1. **支撑绿锚文件** `rest-create-validation-support.test.ts`（不调用 router，只消费 harness
   的 fixture/常量与真实公共接口，8/8 绿）：
   - 平台语义：`last-key-wins`、`-0` 可解析、malformed JSON 平台报错携带 `position/line/column`
     （正是 REST 必须收敛掉的信息）；
   - fixture：percent-encoding 在 `URL.pathname` 保持 raw、流式 Request 无 Content-Length 且字节可读、
     空 body 可构造；
   - VFSL：合法文本派生 `sc1-`；非法文本 issues 携带 line/column（422 映射的真实来源）；
   - Registry：ROOT 领域非法 → `NAMESPACE_ROOT_INVALID` 且 issues 带 path；深层嵌套 / 数组 /
     `-0` / `MAX_SAFE_INTEGER` / 256 KiB 注释文本本身可被领域接纳（413/400 期望纯属 REST 策略）；
   - 门禁：非有限数在 Registry 输入快照即 `NAMESPACE_CREATE_INVALID_INPUT`（REST 必须先查数字范围，
     否则落入安全 500 路径而非 400）；
   - poison registry 自证（任何成员调用即 throw）。
2. **契约文件内的成功路径负控（红灯基线下即绿）**：合法 owner → 201；`application/json` 及
   `charset=utf-8` 形式 → 201；恰两键合法形状 → 201；默认 limits 内合法请求 → 201；`-0` 与 `0`
   → 201。证明失败类别断言不是「恒红」。
3. **既有 #267 套件 35/35 恒绿**（同一入口、同一次运行）——新增契约未把旧行为改红。
4. **变异矩阵 `none` 对照**：不施加任何变异 → 92/92 绿（模拟件下）。

## 7. Stability, scale and timing

- **红灯稳定性**：同一命令连续 3 次 → `3 failed | 5 passed (8 files)` / `44 failed | 48 passed`
  逐次逐位一致（exit=1）。
- **绿灯可满足性稳定性**：模拟件存在时全包 92/92 绿（含 `--typecheck` 入口，`Type Errors no errors`）；
  变异矩阵 19 次运行（`none` + 18 变异）结果确定、无抖动。
- **时序/规模**：全套 <3s；无 sleep、无轮询等待。规模 fixture 均为确定构造：
  4 MiB±1 body、256 KiB±1 schemaText（注释填充、语义等价）、120,000 元素数组、
  100/32/10/3 层嵌套、50,000 层深嵌套 raw body、70×1100 字符字段名（issues 总预算）、
  1,500 字符未知名引用（单条 message 上限）。
- **无竞态/无共享状态**：每个用例自建 registry/fixture 并 `finally` shutdown/dispose/cleanup；
  poison registry 无状态；契约不依赖并发与吞吐。

## 8. Capability gap（替代 Bug 根因链）

| Step | Fact | Evidence | Confidence |
|---|---|---|---|
| 症状 | 新增 42 用例中 44 断言红灯（3 文件） | §5 实测输出，3/3 复跑一致 | 确证 |
| 直接故障点 | `rest.ts` 构造时只浅复制 `limits`（L147–153：`Object.freeze({...limits})`），不解析/不校验/不执行；`handle` 只做 route/method/role gate（L155–176） | 源码符号 + 探针输出（`{maxBoddyBytes:10}` 构造成功；percent-owner/query/text-plain/gzip → 201） | 确证 |
| 第二故障点 | `create-namespace.ts` 用 `request.json()` 最小读取（L36，无 byte 上限/无严格 UTF-8/无 signal）；顶层形状只做机械提取后 rejection（L37–45）；`derive` 失败与 Registry 窄 issue 均 rejection（L48、L62） | 探针：malformed JSON rejection 带 `position 20 (line 1 column 21)`；空 body → `SyntaxError`；`Nope1`/`{` → rejection | 确证 |
| 触发条件 | 任何非成功入站请求（非法 owner/query/media/encoding/空 body/malformed/形状/数字超限/规模超限/schema 或 ROOT invalid） | 14 类 scenario 矩阵 | 确证 |
| 最深根因 | ADR 0015 step 3–5（owner/query/media/encoding 检查、有界读取、形状与资源检查）与 §资源限制/§错误契约 **尚未实现**；#267 骨架的 AGENTS.md L15–16 明文把「request shape validation、limits enforcement、problem shape」划为后续 ticket | `packages/namespace-api/AGENTS.md` L15–16、`src/rest.ts` L15–20 注释、SA8 §可行性核验表 | 确证 |
| 放大因素 | Registry 已能表达 `NAMESPACE_SCHEMA_INVALID`/`NAMESPACE_ROOT_INVALID`（带 issues）与 `NAMESPACE_CREATE_INVALID_INPUT` 分立，422/500 映射的结构前提已具备，缺口纯粹在 REST 入站层 | support 绿锚（Registry 锚 3 例） | 确证 |
| 未证实假设 | H5–H9 契约假设（problem 键集、code 可分性口径、REST issue 形状、边界语义、数字策略） | §12.1 | 待 SA1/SA2 仲裁（不阻塞红灯） |
| 排除项 | 环境/依赖、fixture、Request 构造、平台 JSON、VFSL 窄接口、Registry/Persistence、测试入口 | §11 | 确证 |

结论：这是 **Feature 能力缺口**，不是缺陷回归；红灯方向正确且只落在本票目标面。

## 9. Causal experiments

### E1 可满足性（绿灯模拟，唯一变量 = 入站校验/limits/problem 契约是否存在）

- 方法：把按 ADR 0015 最简形状的临时实现放回 `packages/namespace-api/src/`
  （`rest.ts` + `create-namespace.ts` 自标注「临时诊断件，跑完即删」），**测试文件字节不变**。
- 结果：`Test Files 8 passed (8)` / `Tests 92 passed (92)` / `Type Errors: no errors`
  （含既有 #267 的 35 用例——无回归）。
- 推论：红/绿唯一差异 = 入站校验/limits/problem 契约实现是否存在 ⇒ 红灯因果归因于能力缺口，
  契约**可满足**且不与既有骨架行为冲突。
- 实现口径：problem `{code,message,issues?,issuesTruncated?}`；413/415/400/422 状态映射；
  有界读取（Content-Length 提前拒绝 + stream byte 上限）；严格 UTF-8；平台 JSON；
  显式栈迭代 depth/nodes/数字检查；issue 数量/单条/总 byte 预算与截断标记。
- 清理：模拟件哈希 `rest.ts 3892c636…`、`create-namespace.ts bfc3308a…`；运行后
  `git checkout -- packages/namespace-api/src` 恢复，与 HEAD 逐字节一致（§16）。

### E2 断言敏感性（定点变异矩阵，18 例 + none 对照）

探针：对模拟件做定点文本替换（`old` 必须恰好出现 1 次，杜绝静默错变异），逐例重跑全包 92 用例。

| # | 变异（对 ADR/简报条款的反证） | 被捕获断言 | 失败数 |
|---|---|---|---|
| M1 | 去掉 owner percent-encoding 检查 | owner 400 + problem 矩阵/scenario + trapped 零消费 | 6 |
| M2 | 关闭 query 拒绝 | query 400 + 矩阵/scenario | 5 |
| M3 | 关闭 Content-Type 门 | media 415 + 矩阵/scenario + trapped 零消费 | 6 |
| M4 | 关闭 Content-Encoding 门 | encoding 415 + 矩阵/scenario + trapped 零消费 | 6 |
| M5 | 去掉 stream byte 上限（保留 Content-Length 提前拒绝） | 流式 413 + body 默认/覆盖 413（固定长度路径由提前拒绝兜底，流式用例是判别点） | 7 |
| M6 | 去掉 depth 检查 | 默认 depth 64 + depth 覆盖 + Partial 默认保留 | 7 |
| M7 | 去掉 nodes 检查 | 默认 100k + nodes 覆盖 | 6 |
| M8 | 去掉不安全/非有限数字检查 | AC3 深嵌套数字 + number-range scenario | 5 |
| M9 | **迭代遍历改为递归遍历**（语义相同） | 恰 1 例：AC3「50,000 层 + 高 limits 下数字检查仍终结」⇒ 递归实现栈溢出 | 1 |
| M10 | 不执行单条 message byte 上限 | 默认 1024 + 16-byte 覆盖 + 总预算连带 | 3 |
| M11 | 不执行 issues 数量上限 | 默认 100 + `maxIssues:2` 覆盖 | 2 |
| M12 | 不设 `issuesTruncated` | 4 处截断断言（默认/覆盖 × 数量/总 byte） | 4 |
| M13 | 不执行 schemaText byte 上限 | 默认 256 KiB 边界 + UTF-8 byte 计数覆盖 | 6 |
| M14 | 去掉 `maxSchemaTextBytes ≤ maxBodyBytes` 不变量 | 构造门跨字段用例 | 1 |
| M15 | 忽略未知 limits 键 | 未知键 TypeError 用例 | 1 |
| M16 | 顶层形状放宽为「≥2 键」 | 多余键形状用例 | 1 |
| M17 | malformed JSON 透传平台报错（含 position/line/column） | 2 处「不返回源码位置」断言 | 2 |
| M18 | 422 issues 丢弃 line/column/path 定位 | 2 处 issue 定位断言 + problem 契约 | 3 |
| — | 无变异（对照） | —（92/92 绿） | 0 |

- 每例都被**目标断言**捕获，失败集合与因果预期一致；无「变异后仍全绿」的断言盲区。
- 敏感度覆盖：HTTP 状态/头/形状（M1–M4、M16）、字节/结构上限（M5–M7、M10–M13）、
  数字与迭代实现（M8、M9）、构造门不变量（M14、M15）、信息卫生（M17、M18）、
  截断语义（M12）。变异日志：`/tmp/sa6-268-mutation-*.log`、矩阵汇总
  `/tmp/sa6-268-mutation-matrix.txt`（worktree 之外，非交付物）。

### E3 边界未被 mock；观测纪律与平台边界

- **不 mock 被测 seam**：请求全部走真实 `Request` → `createRestRouter().handle()`；
  `root-invalid` 用真实 MemoryPersistence + 真实 Registry testing 入口；其余失败链一律
  `createPoisonRegistry()`（任何成员被调用即 throw），把「零 Registry 触达」变成可观测断言；
  `trappedBodyRequest` 把「step 3 失败零 body 读取」变成可观测断言。
- **平台边界实证（fixture 修正记录）**：`new URL(...)` 会把 `%2E%2E`/`%2e` 归一化为 dot-segment
  并从 canonical path 消失（`/v1/owners/%2E%2E/namespaces` → `/v1/namespaces`，route 不匹配）。
  契约因此改用 `%61lice`/`a%20b`/`a%2Fb`/`a%5Cb`/`a%2e`/`%25` 等保持 raw 的编码形态；
  dot-segment 归一化属平台语义，不作为 owner 文法断言。
- **空 body × 缺 Content-Type 的次序**：step 3 先于 step 4，故「缺 Content-Type + 空 body」应 415。
  契约把空 body 用例固定为「带 `application/json` 的 null body / 空流」，避免与 415 次序语义混淆。
- **不使用源码字符串断言**：全部断言观察运行时 HTTP 状态/头/JSON body 形状/值；support 文件的
  平台/接口锚也只调用真实公共接口（不 grep 源码）。

## 10. Impact surface

- 新增测试面：`packages/namespace-api/test/` 新增 5 文件（1 harness + 4 测试）。
  **零生产实现改动**（`git status` 证据；`src/` 哈希与 HEAD 一致）。
- 既有公共面零修改：`@nomicore/vfsl`（只消费 `deriveSchemaIdentity`）、`@nomicore/namespace-registry`
  （只消费公共 `create`/`open`/lease 与 testing 入口）、`@nomicore/persistence`（Memory/File adapter）。
- 实现落地（SA3）后预期变化：新增 4 个测试文件从 3 红转绿；既有 4 文件恒绿；
  `rest.ts` 需把预留 `limits` 面升级为「解析/校验/冻结 + 执行」，`create-namespace.ts` 需把
  最小读取/rejection 升级为有界读取 + 形状/资源检查 + problem Response（加法，不 reorder）。
- 本票不断言（后续 ticket / 设计裁决）：503 `REGISTRY_NOT_ACCEPTING`、500 三族
  （`NAMESPACE_CREATE_FAILED`/`OUTCOME_UNKNOWN`/`INTERNAL_ERROR`）与 `NAMESPACE_CREATE_INVALID_INPUT`
  安全 500、observer 事件契约、`Request.signal` 归属（§15）。

## 11. Ruled-out hypotheses

| 假设 | 排除证据 |
|---|---|
| 红灯由依赖缺失/别名解析导致 | `pnpm install --prefer-offline` 完成；support 8/8 绿；`--typecheck` 入口 `Type Errors no errors`；根 `pnpm typecheck` exit 0 |
| 红灯由 fixture/Request 构造缺陷导致 | support 文件亲证 percent-encoding raw、流式 body、空 body、深层 raw body 均可构造且字节可预期；§9 E1 同一 fixture 在模拟件下全绿 |
| 红灯由 VFSL/Registry/Persistence 能力不足导致 | support 绿锚亲证 derive 的 ok/issue 两面、Registry 的 201/422/输入门禁三分、128-bit 受控随机源与 lease 生命周期在 HEAD 可用 |
| 红灯由超时/flake/竞态导致 | 3/3 复跑逐位一致；全套 <3s；无 sleep/轮询；每用例 finally 收尾 |
| 伪绿（临时模拟件残留） | 模拟件已删除；`git status` 仅测试文件与报告；`src/` 与 HEAD 哈希一致；红灯复跑 3/3 |
| 伪红（测试自身写错期望） | §9 E1 模拟件下 92/92 绿（含契约全部断言）；§9 E2 18 例变异全部定向捕获 |
| 源码字符串/正则断言替代行为验证 | 全部断言观察运行时行为；support 锚只调用真实公共接口；唯一读文件的是既有 `rest-public-seam-wiring.test.ts`（#267 接线锚，本票未改） |
| skip/only/todo/env override/吞错制造伪结果 | `grep -nE '\.(only|skip|todo)\(|process\.env' packages/namespace-api/test/*.ts` → 无命中；无 `--conditions` 之外的 env 注入；无吞错/软化断言 |

## 12. Acceptance contract and test paths

### 12.1 契约假设（PROPOSAL，待 SA1/SA2 仲裁；若设计另有裁决须回写测试并走修订轮）

- **H5（problem shape）**：错误 response 恒为 JSON object，键集 ⊆
  `{code, message, issues, issuesTruncated}`；`code`/`message` 必选且分别为稳定
  `UPPER_SNAKE` 字符串与非空字符串；`issues` 存在时必须是数组；`issuesTruncated` 存在时为 boolean，
  且 `true` 仅在确实截断时出现。
  *依据*：ADR L164–165「固定 problem shape」「客户端只按稳定 code 分支」；403/405 的现状
  `{code}` 属骨架临时值（SA8 §可行性核验），升级为 problem shape 是加法。
- **H6（code 可分性）**：**14 类失败各自给出互异的稳定 code**（同输入重复请求一致；同一类别不同
  输入一致）。**具体 code 词表归设计**（契约只锁可分/稳定/格式），但 403 `INSTANCE_ROLE_FORBIDDEN`
  与 405 `METHOD_NOT_ALLOWED` 为冻结/在树 code，逐字保持。
  *依据*：ADR L165「客户端只按稳定 code 分支」；message 明确「不保证逐字稳定」，因此类别可分性
  只能由 code 承载。
- **H7（REST issue）**：`issues[i]` 为 object，键集 ⊆ `{code, message, line, column, path}`；
  `code` 稳定 UPPER_SNAKE；`message` 非空且 UTF-8 bytes ≤ 有效 `maxIssueMessageBytes`；
  `line`/`column` 成对为正整数；`path` 为 `(string|number)[]`；两者互斥；422 至少一条 issue 保留
  定位信息（line/column 或 path）；response 不出现 schema/root 片段。
  *依据*：ADR L165 的 issue 形状（「稳定 code、可选 line/column 或 path、有 UTF-8 byte 上限的
  安全 message；不返回 schema/root 片段」）。「至少一条保留定位」是本契约的收紧提案（见 §15）。
- **H8（limit 边界与构造门）**：limit 为有效值的**排他上限**（≤ 上限接受、> 上限 413；
  body 恰 4 MiB、schemaText 恰 262144 UTF-8 bytes 均不得 413）；schemaText 按 **UTF-8 bytes**
  计（非 UTF-16 length）；`limits` 每项须为正安全整数，未知键与越界值构造时普通 `TypeError`；
  跨字段不变量 `maxSchemaTextBytes ≤ maxBodyBytes` 按 **合并默认后的有效值**判定。
  *依据*：ADR L103–113 数值与「构造时 TypeError」；「以 UTF-8 bytes 计算」；跨字段「不得大于」；
  §15 记录有效值合并读法的裁决点。
- **H9（数字策略）**：解析后所有数字须有限；`Number.isInteger(n) && !Number.isSafeInteger(n)`
  → 400（数字范围）；`-0` 无额外语义（与 0 同样走通）；检查迭代执行，深嵌套不触发 RangeError。
  *依据*：ADR L115「迭代检查 depth、nodes 和不安全整数」「REST 不为 `-0` 建立额外语义」+
  L169「400：…数字范围」。

### 12.2 AC → 断言映射

| 简报 AC / 条款 | 断言（行为级） | 测试文件 |
|---|---|---|
| AC1 非法 owner → 400 | `%61lice`/`a%20b`/`a%2Fb`/`a%5Cb`/`a%2e`/`%25` → 400 + problem shape；poison registry 零触达；合法 owner（`alice`/`a.b`/`alice-1`/`owner_2`）→ 201 | request-validation |
| AC1 query → 400 | `?page=1`/`?a=1&b=2`/`?dryRun=true` → 400；零 Registry 触达 | request-validation |
| AC1 媒体类型 → 415 | 缺失 / `text/plain` / `text/json` / `application/json-patch+json` / `charset=utf-16` / 额外参数 → 415；接受 `application/json`、`; charset=utf-8`（含无空格与大小写变体）→ 201；`gzip`/`br`/`deflate`/`compress` → 415；step 3 失败零 body 读取（trapped）+ 零 Registry 触达 | request-validation |
| AC1 空 body / malformed / 形状 / 数字范围 → 400 | null body 与空流 → 400；5 种 malformed → 400 且无 position/line/column 泄漏、无 issues；数组/scalar/null/多余键/缺键/非 string → 400；恰两键 → 201；重复 key last-key-wins 正反两向；`9007199254740993` 与 `1e400` → 400 | request-validation / limits |
| AC1 schema / ROOT invalid → 422 | `type ROOT = {`、未知名引用、缺 ROOT、空串、ROOT 非 map 形 → 422（derive 失败，零 Registry 触达）；ROOT `{}`/类型不匹配/显式 null → 422（真实 Registry）；issues 非空且保留定位；不泄露 schema/root 哨兵 | request-validation |
| AC2 默认 limits 生效 | body 4 MiB±1；schemaText 262144 接受/262145 → 413；depth 100 → 413（10 → 201）；nodes 120k → 413（3 → 201）；101 条底层 issue → ≤100 且 `issuesTruncated:true`；1,500 字符未知名引用 message ≤ 1024 bytes；70×1100 字段总 message ≤ 64 KiB 且截断 | limits |
| AC2 Partial 覆盖 + TypeError | 七键 × {0, -1, 1.5, NaN, ∞, 2^53} → TypeError；未知键（含 typo）→ TypeError；`maxSchemaTextBytes > maxBodyBytes` → TypeError、相等允许；`{}`/undefined 可构造；body/schemaText/depth/nodes/issues/message/total 覆盖各自夹紧；UTF-8 bytes 计数（6×CJK=18 > 16 → 413）；Partial 不重置其它默认值；流式 body 无 Content-Length 仍 413 | limits |
| AC3 迭代实现 | 50,000 层深嵌套 + 高 depth/nodes 上限下，最深处的 `1e400` 与 `9007199254740993` 均稳定 400（无 RangeError/栈溢出）；深度/节点检查以 margin 断言避开计数约定（嵌套 3 接受 / 32 拒绝；3 元素接受 / 40 拒绝） | limits |
| AC4 problem shape / issues 安全 / 截断 | 14 类失败键集/类型/code 模式；code 两次运行一致且 14 类两两互异；403 与 405 同 problem shape（冻结 code 保持、`Allow: POST` 保持）；422 issues 形状 + 至少一条定位；非截断 422 不带 `issuesTruncated:true`；malformed 无源码位置 | problem |
| AC5 平台语义 | last-key-wins 正反两向；`-0` 与 0 同 201；malformed 无源码位置（400/AC5 用例 + problem 契约 string 叶子扫描） | request-validation / limits / problem |
| ADR §JSON 处理（有界/严格 UTF-8/平台解析） | 有界读取（stream 无 Content-Length 仍 413）；严格 UTF-8/平台 JSON 由实现路径承担（support 锚证明平台语义输入面） | limits / support |
| ADR §执行顺序（step 3/4 先于 Registry） | poison registry 零触达覆盖 14 类中的 13 类；root-invalid 才触达真实 Registry | problem |

### 12.3 测试路径

```
packages/namespace-api/test/rest-validation-harness.ts                      （fixture，非测试）
packages/namespace-api/test/rest-create-request-validation-contract.test.ts
packages/namespace-api/test/rest-create-limits-contract.test.ts
packages/namespace-api/test/rest-create-problem-contract.test.ts
packages/namespace-api/test/rest-create-validation-support.test.ts          （负控/绿锚）
```

## 13. Red/green or baseline evidence

### 13.1 最终红灯基线（生产实现 = HEAD，测试为最终字节）

```
$ NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run packages/namespace-api/test
 Test Files  3 failed | 5 passed (8)
      Tests  44 failed | 48 passed (92)
Type Errors  no errors
# 3 次复跑逐位一致；exit=1
```

### 13.2 可满足性绿灯锚（临时模拟件，测试字节不变）

```
 Test Files  8 passed (8)
      Tests  92 passed (92)
Type Errors  no errors
```

### 13.3 变异矩阵（模拟件 + 最终测试字节）

`none 92/92 绿`；M1..M18 分别 6/5/6/6/7/7/6/5/1/3/2/4/6/1/1/1/2/3 例红，
全部为 §9 E2 表列目标断言；无「变异后仍全绿」的断言。

### 13.4 最终测试文件哈希（sha256）

```
3e3d30571ce6c16226d2ea0ab3b472b882ff89b5d492998d5b106009eab029f8  rest-validation-harness.ts
52fc9ad99cec0f2b71ddcc4f7b83b094b97999cf4afad200bd3fd5ab1cc5fcf9  rest-create-request-validation-contract.test.ts
a82b0733887cf4ab844060bc6e1b08b4347d6ab5a2dd0fcf533fdda0d27fe2ba  rest-create-limits-contract.test.ts
fb23dcd9baaa6a5c035927061e51efa3eba82915f6cb0deb1947057193766bef  rest-create-problem-contract.test.ts
fa031c3fc2173405f153c5da50b7abc00a2bc1d51f0cc87c8276986919115e0a  rest-create-validation-support.test.ts
```

红灯、绿灯、变异三组证据均在上述最终字节上复跑。

## 14. Runner trigger evidence

- 发现性（根配置 include `packages/*/test/**/*.test.ts`）：

```
$ NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest list --filesOnly packages/namespace-api
packages/namespace-api/test/rest-contract-support.test.ts
packages/namespace-api/test/rest-create-hub-contract.test.ts
packages/namespace-api/test/rest-create-limits-contract.test.ts
packages/namespace-api/test/rest-create-problem-contract.test.ts
packages/namespace-api/test/rest-create-request-validation-contract.test.ts
packages/namespace-api/test/rest-create-validation-support.test.ts
packages/namespace-api/test/rest-public-seam-wiring.test.ts
packages/namespace-api/test/rest-role-gate-routing-contract.test.ts
```

- `rest-validation-harness.ts` 未被收集（fixture 身份正确）。
- 仓库真实入口触发（含 `--typecheck`，与根 `pnpm test` 同款参数）：红灯 44 failed | 48 passed /
  `Type Errors no errors`；模拟件下 92 passed / `Type Errors no errors`。
- 根 `pnpm typecheck`：exit 0（全 15 个 tsconfig 链）。
- Issue comments 复核：

```
$ gh issue view 268 --json comments
{"comments":[]}
```

- 无 skip/only/todo；无 env override（`--conditions=nomicore-source` 是仓库既有条件）；
  无吞错/软化断言；无 `nohup`/`setsid`/PID/轮询 marker。

## 15. Unknowns and blockers

- **SA1 裁决点（非阻塞）**：
  1. **problem 键集**（H5）：本契约按「必选 `code`/`message` + 可选 `issues`/`issuesTruncated`、
     未知键禁止」固化；若设计另有顶层键（如 `status`/`title`），须走修订轮同步。
  2. **code 词表与粒度**（H6）：契约只要求「14 类两两互异 + 稳定 + UPPER_SNAKE」，
     不锁具体名字；设计需给出词表并说明 `METHOD_NOT_ALLOWED`/`INSTANCE_ROLE_FORBIDDEN` 保持。
  3. **422 issue 定位保留**（H7）：ADR 措辞为「可选 line/column 或 path」，契约收紧为
     「至少一条 issue 保留定位」——若设计裁决允许完全压平，须回写该断言。
  4. **跨字段不变量读法**（H8）：契约按「合并默认后的有效值」判定
     （故 `{maxBodyBytes: 64}` 这种会让默认 schemaText 越界的 Partial 应 TypeError）；
     契约用例只覆盖「两者显式给出且越界/相等」的形态，避免绑定该读法以外的形态。
     若设计采用「只校验显式给出的键」，须补充/回写边界用例。
  5. **数字策略**（H9）：契约把「非有限 → 400」「整数且非 safe → 400」「`-0` 放行」固化；
     若设计把大浮点（如 `1e308`）视为可接受，须补充用例说明。
- **`Request.signal`（SA8 O-2）**：简报警不含 signal；本契约不断言「中断后 Registry 零触达」。
  归属（#268 有界读取一并落，或后续票）由 SA1 裁决。
- **切片边界（SA8 O-2）**：503 `REGISTRY_NOT_ACCEPTING`、500 三族与
  `NAMESPACE_CREATE_INVALID_INPUT` 安全 500、observer 事件契约（FR-4）不在本契约内。
- **owner 文法的可观测面**：经 `URL.pathname` 后，非 percent 的 owner 违规
  （控制字符、`/`、`\`、`.`/`..`）不可达（被 URL 归一化或以 percent 形态出现），
  故契约只断言 percent-encoding 400 与合法 owner 不误伤；「复用 Registry 既有文法」（SA8 O-3）
  的路径归设计。
- **文档卫生（SA8 O-1/O-4）**：ADR 0015 仍为「提议」；`problem shape`/`issuesTruncated`/`REST issue`
  术语未进 `CONTEXT.md`。非 SA6 权限，登记给总控/实施票。
- 无阻塞红灯契约建立的环境或事实缺口。

## 16. Temporary diagnostics cleanup

| 临时件 | 处理 | 证据 |
|---|---|---|
| `packages/namespace-api/src/rest.ts`（未来绿灯模拟 router） | **已恢复 HEAD 版本** | 模拟件删除前 sha256 `3892c6362e871bb0a3d20a3a669da44217d30dda756054aa1cdd352ba3419345`；恢复后 `d90c5c56586641bdf46f1462e85431e19bebd8e03b45f0c56bbc2df859001cd5`（与 HEAD 一致） |
| `packages/namespace-api/src/create-namespace.ts`（模拟校验编排） | **已恢复 HEAD 版本** | 模拟件删除前 `bfc3308a35ea48b9554a7b8f0742afb7dc13c9bf5a648423e7d47d3bce1614c4`；恢复后 `ccc240a22c789c74a765b3330d4be56bfc29720bb254294b6f03711d80a31a7c` |
| `packages/namespace-api/src/index.ts` | 未改动 | `ad207d00ed97e01bb0caaf9189036cc074863c96e6174b568a7fba1f77b2c462`（前后一致） |
| `packages/namespace-api/.sa6-probe/probe2–5.ts`（行为/issue/计时探针） | **已删除** | `find packages/namespace-api -maxdepth 1 -name '.sa6-probe'` 无结果 |
| `.scratch/sa6-268/{probe.ts}` 与 `.scratch/sa6-268b/{mutate.py}`（探针与变异运行器） | **已删除** | `.scratch/` 仅剩既有 `vfsl-v1-parser/spec.md`（tracked，未改） |
| 变异日志（19 份）与备份 | 仅存在于 worktree 之外 `/tmp/sa6-268-*` | `git status --porcelain` 无相关条目 |

清理后复核：`git status --porcelain` 仅新增 5 个测试文件 + 本报告（+ 派发前既有的 3 个
`wiki/raw/task_*` 未跟踪输入）；`packages/namespace-api/src/` 三个文件与 HEAD 逐字节一致；
红灯基线 3/3 复跑一致；无后台服务/进程残留（未启动任何服务；测试全部同步收尾）。

## 17. Verdict

**`approve`**

- 能力缺口可信且因果闭合：14 类失败场景矩阵在 HEAD 上 44 断言红灯（201 或 rejection，
  非环境/fixture 错误），唯一变量实验（同一测试字节 + 有/无入站校验实现）给出红→绿对照
  （模拟件下 92/92 全绿，含既有 #267 35 用例无回归）。
- 契约可执行且被仓库真实入口发现（`vitest list` + `--typecheck` 入口 + 根 `pnpm typecheck`）。
- 断言敏感：18 例定点变异全部被目标断言捕获（含「迭代 vs 递归」的 AC3 定点变异仅命中
  深层数字用例），无变异盲区；相近负控（support 8/8、成功路径负控、既有 35/35）恒绿。
- 红灯只落在本票目标面（step 3–5 + limits + problem shape），3/3 复跑稳定，无伪红/伪绿。
- 临时诊断件（模拟件、探针、变异脚本）已全部清理并留哈希/恢复证据。
- 设计裁决点（H5–H9、signal 归属、code 词表）已显式登记，不阻塞设计进入。
