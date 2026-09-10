# SA3 Implementation Report — issue #268

> 任务：REST create 请求形状校验、资源 limits 与 4xx/422 problem 契约（Feature，在 #267 骨架上叠加
> ADR 0015 step 3–5 + §资源限制 + §错误契约）。
> 基线：branch `mabf/issue-268`，HEAD `0b06050`（#267 骨架，#296 已合）。
> 设计：`wiki/raw/task_issue-268_design.md`（iteration 1，评审修订版，SA2 verdict `approve`）。
> 验收契约：`wiki/raw/task_issue-268_sa6_contract.md`（verdict `approve`，冻结 5 文件，44 红灯）。
> Issue comments REST snapshot：**空 `[]`**（无 Owner 追加要求 / 无评论 ID 义务）。

## Inputs consumed

| 输入 | 用途 |
|---|---|
| `wiki/raw/task_issue-268.md` | 简报 What to build 五节 + AC1–AC5（验收口径） |
| `wiki/raw/task_issue-268_design.md` | 唯一实施依据（D1–D13、§8 数据流/顺序、§10 ALLOW/DENY、§12 验收映射、§14 修订映射） |
| `wiki/raw/task_issue-268_sa2_review.md` | F1/F2 已落实核验 + M-1..M-5/N-1/N-2 观察 |
| `wiki/raw/task_issue-268_sa6_contract.md` | 冻结契约 5 文件与红/绿/变异基线、哈希（§13.4）、§15 未决边界 |
| `wiki/raw/task_issue-268_conflict_report.md` | SA8 `clear` 门禁与 O-1..O-5 裁决点 |
| `docs/adr/0015-vertical-rest-namespace-create.md` L63–75/L94–115/L146–174/L180/L192–208 | 规格原文（默认 limits 数值、顺序、错误映射切分） |
| `packages/namespace-api/{README.md,AGENTS.md,package.json,tsconfig.json}`、根 `AGENTS.md`/`docs/AGENTS.md`/`CONTEXT.md` | 模块契约、文档同步义务（D13）、术语卫生（O-4） |
| 冻结测试（#268 五文件 + #267 五文件） | 逐用例核对精确期望（problem 键集/状态映射/预算边界/成功路径） |
| `packages/vfsl`、`packages/namespace-registry` 公共面（只读） | `deriveSchemaIdentity` issue 形状、`CreateNamespaceIssue` 判别式 code、`ValidateIssue` path 形状 |

## Existing worktree reconciliation

- 本轮开工时 `git status` 无已修改的跟踪文件；唯一未跟踪项为 SA6 冻结契约 5 文件 + wiki 产物。
  **不存在**既有 `wiki/raw/task_issue-268_sa3_impl.md`、也不存在未提交实现——无需 reconcile。
- 冻结契约文件哈希与 SA6 §13.4 逐字节一致（见 §Verification），实现全程零改动它们。
- 无临时探针/模拟件残留在 worktree：本轮探针脚本仅存在于 `/tmp/sa3-268/`（worktree 之外）。

## Changed paths

| Path | Design section | Change |
|---|---|---|
| `packages/namespace-api/src/rest.ts`（M） | D4、D7、D9、D10、§8.1/§8.2 step 3、D13 头注 | limits 构造门（对象形状 → 未知键 → 正安全整数 → 合并默认 + 跨字段不变量 → 冻结）；step 3a/3b/3c/3d（owner `%` + 文法镜像、query、Content-Type、Content-Encoding）；403/405 升级为 problem shape（405 保持 `Allow: POST`）；有效 limits 下传编排；头注「切片边界」收窄为剩余未映射族 |
| `packages/namespace-api/src/create-namespace.ts`（M） | D8、D9、D11、D12、§8.2 step 4–7 | step 4 有界读取 + 严格 UTF-8 + 平台 JSON；step 5a 形状 / 5b schemaText UTF-8 bytes / 5c 迭代 DFS；step 6 derive 失败 → 422；step 7 按 code 分叉（SCHEMA/ROOT_INVALID → 422，其余维持 rejection）；私有签名扩展 `+有效 limits`；step 8–10 逐行不变 |
| `packages/namespace-api/src/request-body.ts`（A） | D6、D9、D11、D12、§8.2 step 4/5 | **新增**包内私有模块：Content-Length 提前拒绝 + stream 始终 byte 上限 + `Request.signal`（读前检查 / 期间 once 监听 / abort → best-effort cancel → 固定 message + cause 的 rejection / 读毕移除监听）；严格 UTF-8（`{fatal:true}`）；顶层形状检查；显式栈迭代 depth/nodes/数字检查 |
| `packages/namespace-api/src/rest-problem.ts`（A） | D1、D2、D3、D9、§8.3 | **新增**包内私有模块：17 个稳定 code 与固定文案；固定 problem Response 构造器（键集受控、`issuesTruncated` 仅在截断时输出）；422 issue 映射（来源族 code、line/column 或 path verbatim、防御式形状降级、单条/总量 byte 预算与截断、UTF-8 codepoint 安全截断 + `?` 兜底） |
| `packages/namespace-api/test/rest-create-body-read.test.ts`（A） | D6、D12、§10 ALLOW、§12（F2 行） | **新增** body 读取阶段行为套件 4 用例：① 读取期间 / 读前已 aborted → rejection（固定 message + cause）+ 零 Registry 触达；② 接纳后 abort 不传播（releaseGate 观测：create settle、release 恰一次、仍 201）；③ 两组流式非法 UTF-8 bytes → 400 `INVALID_BODY_ENCODING` + problem shape + 零 Registry 触达；④ 与 `MALFORMED_JSON` 可分 |
| `packages/namespace-api/README.md`（M） | D13（F1） | Public API 节增补 limits 构造门与 4xx/422 problem 契约；Deferred scope 节移除已落地项与「未映射结局一律 rejection」「body 读取暂未设上限」，保留 503/500 族与 observer 事件，受信环境前提改述为 authentication/authorization 边界 |
| `packages/namespace-api/AGENTS.md`（M） | D13（F1） | 边界清单：新增 problem shape/错误映射条目与模块私有性；unmapped-outcomes 收窄为 abort/Registry fatal/503/500 族；deferred 清单更新；**显式校正尾句**「because body reads are not yet bounded」→ 读取已受 `maxBodyBytes` 有界 |
| `CONTEXT.md`（M） | D13 / SA8 O-4 | 加法增补 3 条术语：`problem shape`、`REST issue`、`issuesTruncated`（含 _Avoid_ 行） |

（M = modified，A = added；`wiki/raw/task_issue-268_sa3_impl.md` 本报告为第 10 个改动路径。）

## SA2 Finding落实

| Finding ID | 严重度 | 实现 | 结果 |
|---|---|---|---|
| SA2-268-F1（README 契约同步缺席文件范围） | MAJOR | `README.md` Public API/Deferred scope 与 `AGENTS.md` 边界清单按 D13 逐条修订；`src/rest.ts` 头注同批收窄 | **已落实**：失效陈述（「只做成功路径与 role gate」「一律 rejection/不发明任何 HTTP 错误 Response」「body 读取暂未设上限」）全部消失；仍 deferred 项明确保留 |
| SA2-268-F2（严格 UTF-8 / `INVALID_BODY_ENCODING` 零可执行验收） | MAJOR | 新测试文件 ③④：`[0x22,0xFF,0x22]` 与截断三字节序列 → 400 `INVALID_BODY_ENCODING` + problem shape + poison registry；与 `MALFORMED_JSON` code 互异 | **已落实**：定点变异 M-A（丢 `fatal:true`）与 M-B（并入 `MALFORMED_JSON`）均使该文件转红（见 §Verification） |
| M-1（引文行号） | MINOR | 设计级修订，无代码动作 | 无需实现 |
| M-2（超限 cancel 语义） | MINOR | `request-body.ts` 超限分支 `reader.cancel().catch(() => {})` 不 await，413 恒定产生 | 已落实 |
| M-3（Content-Type 参数 OWS） | MINOR | `isSupportedContentType` 参数名/`=`/值两侧 trim；`charset = utf-8` 接受 | 已落实（探针实证 3 形态 → 201） |
| M-4（limits plain-object 判定） | MINOR | 只判 `typeof === 'object' && !Array.isArray`；own keys 为空的类实例等价 `{}` → 全默认 | 维持设计，未追加 prototype 判定 |
| M-5（`NAMESPACE_INVALID_IDENTITY` 兜底） | MINOR | `registry.create` 未列 code 落入 `unmapped registry issue: <code>` rejection | 已落实 |
| N-1（AGENTS.md 固定顺序清单） | 观察 | 相对次序未被插入的 step 3 破坏，按 N-1 判断不构成必改项 → 未改该行 | 判断维持 |
| N-2（OWS 规则措辞/可选加固） | 观察 | 未把 `charset = utf-8` 用例加入新测试文件：新文件内容严格对齐 ALLOW LIST 列出的 ④ 场景；该形态以 worktree 外探针实证（201） | 记录不处理理由（非设计必需） |

## File scope check

| Changed path | ALLOW entry | Purpose |
|---|---|---|
| `packages/namespace-api/src/rest.ts` | ALLOW 行 1 | limits 构造门 + step 3 + 403/405 problem 化 + 头注收窄 |
| `packages/namespace-api/src/create-namespace.ts` | ALLOW 行 2 | step 4/5 升级 + step 6/7 映射（rejection→Response 纯加法） |
| `packages/namespace-api/src/request-body.ts` | ALLOW 行 3（新增私有模块） | 有界读取/严格 UTF-8/迭代检查载体 |
| `packages/namespace-api/src/rest-problem.ts` | ALLOW 行 4（新增私有模块） | code 词表/problem 构造器/issue 映射单一定义点 |
| `packages/namespace-api/test/rest-create-body-read.test.ts` | ALLOW 行 5（新增测试） | D6/D12 可执行验收（4 场景） |
| `packages/namespace-api/README.md` | ALLOW 行 6 | D13 规范性文档同步 |
| `packages/namespace-api/AGENTS.md` | ALLOW 行 7 | D13 模块契约同步（含尾句校正） |
| `CONTEXT.md` | ALLOW 行 8 | SA8 O-4 术语加法 |
| `wiki/raw/task_issue-268_sa3_impl.md` | ALLOW 行 9（实现报告） | 本报告 |

DENY LIST 零触碰（逐项实证）：冻结契约 5 文件 sha256 与 SA6 §13.4 逐字节一致；#267 四文件 +
`rest-contract-harness.ts` 零 diff；`src/index.ts` 与 `package.json` 零 diff；`packages/namespace-registry/**`、
`packages/vfsl/**`、`docs/adr/**`、`apps/**`、`domains/**` 零 diff（见 §Verification 的 `git status` 证据）。

## Verification

| Command | Result | Evidence |
|---|---|---|
| 基线（实现前）`NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run packages/namespace-api/test` | red：`3 failed \| 5 passed (8 files)`、`44 failed \| 48 passed (92)` | 与 SA6 §13.1 基线逐位一致（本机复跑） |
| `NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run --typecheck packages/namespace-api/test` | **green：`9 passed (9 files)`、`96 passed (96)`、`Type Errors no errors`** | 冻结 92（44 红→绿 + 48 恒绿）+ 新文件 4/4 绿；exit 0 |
| `pnpm typecheck`（根 15 个 tsconfig 链） | exit 0，无输出 | 覆盖 `packages/namespace-api/tsconfig.json`（src）与 apps/yjs-server |
| 冻结契约哈希核对 | 5/5 与 SA6 §13.4 逐字节一致 | `sha256sum`：`3e3d3057…`、`52fc9ad9…`、`a82b0733…`、`fb23dcd9…`、`fa031c3f…` |
| DENY 面核对 | `src/index.ts` `ad207d00…`（= SA6 §16 值）、`package.json` 零 diff、`packages/{namespace-registry,vfsl}` 零 diff、`docs/adr/**` 零 diff | `git status --porcelain` + `git diff --stat`（仅 §Changed paths 的 9 行） |
| 变异 M-A：`TextDecoder('utf-8', {fatal:true})` → `TextDecoder('utf-8')` | 新文件 1 红（场景③：`INVALID_BODY_ENCODING` → `INVALID_REQUEST_SHAPE`/`MALFORMED_JSON`） | `/tmp/sa3-268`（worktree 外） |
| 变异 M-B：解码失败 code 改为 `MALFORMED_JSON` | 新文件 2 红（场景③④） | 同上 |
| 变异 M-C：移除 abort 监听 | 新文件 1 红（场景①：读取挂起 → 超时，即不产生 rejection） | `--testTimeout=1500` |
| 变异 M-D：移除读前 `signal.aborted` 检查 | 新文件 1 红（场景①(b)：读前已 aborted 不立即结算） | 同上 |
| 探针（worktree 外，非交付物）：D10 OWS 三形态 → 201；裸 `?` → 201；`a%2eb` owner → 400 `INVALID_OWNER`；非标准 Request（无 `signal`）→ 201 | 与设计 D6/D10 逐条一致 | `/tmp/sa3-268/probe3.mts` |
| 探针（worktree 外，非交付物）：stub registry `NAMESPACE_SCHEMA_INVALID` → 422 `SCHEMA_INVALID` + `SCHEMA_ISSUE`/line+column；`NAMESPACE_ROOT_INVALID` → 422 `ROOT_INVALID` + `ROOT_ISSUE`/path；`NAMESPACE_CREATE_INVALID_INPUT` → rejection | 与 D8 分叉表逐条一致 | `/tmp/sa3-268/probe4.mts` |
| 纪律扫描 | `grep -nE '\.(only\|skip\|todo)\(\|process\.env'` 对全部 src 与新测试文件 → 无命中 | 无 skip/only/env override/吞错；实现无 env override、无静默 fallback |

## Deferred verification

- SA3 按技能范围**不承担**：全仓 vitest、最终动态验收、真实环境/CI 裁决、PR 创建。受影响包外的
  回归由 SA4/SA7 按其范围执行。
- 冻结契约未覆盖、本实现已探针实证但未固化为测试的语义：D10 的参数 OWS 形态（N-2 记录为可选加固）、
  D6 的非标准 Request（`signal === undefined`）防御分支、D8 的 Registry `NAMESPACE_SCHEMA_INVALID`
  分支（实践不可达）。
- 后续票（设计 FU-1..FU-4）：503/500 族与 abort 的 server 侧 HTTP 处置、observer 事件契约（FR-4）、
  ADR 0015 状态翻「已接受」（父 PR #158）、Registry owner 文法若演进时的镜像统一导出决策。

## Deviations or blockers

- **无阻塞、无设计偏离**。实现严格落在 ALLOW LIST 内，公共面零变化（`RestRouterLimits`/
  `RestRouterOptions` 形状、`src/index.ts`、`package.json` exports 均未动）。
- 两处实现期判断（均在设计授权范围内、已记录）：
  1. `ResolvedRestRouterLimits` 类型声明在包私有 `create-namespace.ts`（消费点），由 `rest.ts`
     以 `import type` 引用——避免向公共 `./rest` 面新增导出类型；构造门本身仍按 D9 位于 `rest.ts`。
  2. UTF-8 byte 工具（`utf8ByteLength`/`truncateToUtf8Bytes`）落在 `rest-problem.ts`（无依赖叶子）
     供 `create-namespace.ts` 与 issue 预算共用，保持模块依赖无环（rest-problem ← request-body ←
     create-namespace ← rest）。
- 观察（非本票动作）：设计 §12 把「strict UTF-8 的 fatal 丢失/类合并」判给新测试文件场景③④；
  变异实证 M-A（fatal 丢失）只被场景③捕获——场景④原设计断言为「与 `MALFORMED_JSON` 互异」，
  在 fatal 丢失时非法字节会退化为 `INVALID_REQUEST_SHAPE`，仍与 `MALFORMED_JSON` 互异故不红。
  为使场景④自足，已在其中显式断言 `encodingProblem.body.code === 'INVALID_BODY_ENCODING'`
  （**收紧断言**，未弱化任何 SA6 冻结断言、未改变验收语义）。

## Suggested commit message

```
fix(#268): REST create 入站校验、资源 limits 与 4xx/422 problem 契约

- rest.ts：limits 构造门（未知键/越界值/跨字段不变量 → TypeError）；step 3 owner
  percent-encoding + 文法镜像 / query / Content-Type / Content-Encoding；403/405
  升级为固定 problem shape（405 保持 Allow: POST）
- create-namespace.ts：step 4 有界读取 + 严格 UTF-8 + 平台 JSON；step 5 形状与
  迭代 depth/nodes/数字检查；step 6/7 schema 与 ROOT 映射 422（其余维持 rejection）
- 新增包内私有 request-body.ts（有界读取/Request.signal/严格 UTF-8/迭代 DFS）与
  rest-problem.ts（稳定 code 词表、problem 构造器、REST issue 映射与预算/截断）
- test：新增 rest-create-body-read.test.ts（abort rejection、接纳后取消不传播、
  非法 UTF-8 → INVALID_BODY_ENCODING、与 MALFORMED_JSON 可分）；冻结契约零改动
- docs：README/AGENTS 同步落地行为（移除失效的 deferred/无上限陈述）、CONTEXT
  增补 problem shape/REST issue/issuesTruncated 术语

验证：packages/namespace-api vitest --typecheck 96/96 绿（原 44 红转绿 + 35 旧用例恒绿）；
根 pnpm typecheck exit 0；冻结 SA6 五文件 sha256 与契约报告一致。
```
