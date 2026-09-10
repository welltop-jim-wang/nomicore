# SA3 Implementation Report

> issue #267「REST router 骨架：Hub create 成功路径 + Peer role gate + Lease 生命周期」。
> 任务 worktree：`/home/wangjian/nomicore-fix-issue-267`（branch `mabf/issue-267`，基线 HEAD `8fa85d2`）。
> dispatch：`sa-43c82ef9-bf5f-4513-9fd4-d46abd8ced50`（mabf-sa3，implementation，iteration 0）。
> Issue comments REST snapshot：空（`[]`）——无 Owner 追加要求、无 override 授权。

## Inputs consumed

| 输入（固定位置） | 状态 | 用途 |
|---|---|---|
| `wiki/raw/task_issue-267.md`（任务简报，AC1–AC6） | 已读 | 范围与非目标、验收口径 |
| `wiki/raw/task_issue-267_design.md`（SA1 设计，`approve` 前置：SA8 `clear`） | 已读 | ALLOW/DENY、D1–D9、§8 伪码、§12 验证命令 |
| `wiki/raw/task_issue-267_sa2_review.md`（SA2，verdict `approve`；0 BLOCKER / 0 MAJOR / 4 MINOR F-M1–F-M4） | 已读 | MINOR 修订落实（dispatch 明确要求） |
| `wiki/raw/task_issue-267_sa6_contract.md`（SA6，verdict `approve`；35 用例红灯契约 + §13.4 哈希） | 已读 | 红灯契约、断言面、验证入口 |
| `wiki/raw/task_issue-267_conflict_report.md`（SA8 前置门禁 `clear`；冻结面 9 项；B-1/B-2/B-3） | 已读 | 边界条件落实 |
| `wiki/raw/task_issue-267_design_conflict_report.md`（SA8 设计后复审 `clear`；`requiresConflictRecheck: false`；A-1/A-2） | 已读 | 修订不重开冲突门的依据 |
| `wiki/raw/task_issue-267_relevant_decisions.md`（ADR 0015/0009/0010/0012/0006 + CONTEXT.md 摘录） | 已读 | 条款逐字核对 |
| `packages/namespace-api/test/*`（5 文件，SA6 契约；sha256 与 SA6 §13.4 逐位一致） | 已读、未改 | 红灯契约与 harness 契约面 |
| `docs/adr/0015-vertical-rest-namespace-create.md`、上游 `packages/vfsl|namespace-registry` 公共面、根 `package.json`/`tsconfig.base.json`/`vitest.config.ts`/`.github/workflows/ci.yml` | 已读 | 实施与门禁核对 |

## Existing worktree reconciliation

- 无既有 `wiki/raw/task_issue-267_sa3_impl.md`（首次实现轮），无既有实现待修订。
- 实施前 `packages/namespace-api/` 仅 5 个 test 面文件（SA6 交付），无 `package.json`、无 `src/`、无 `AGENTS.md`/`README.md`；SA6 的临时绿灯模拟件已在 SA6 §16 清理（复核：不存在）。
- 5 个契约测试文件 sha256 与 SA6 §13.4 逐位一致（实施前后各校验一次）——**零测试字节改动**；实现后复跑绿灯即「同一冻结契约转绿」。
- 上游 13 个既有包、`docs/**`、`CONTEXT.md`、`vitest.config.ts`、`apps/**`、`domains/**`、`scripts/**`、`.github/**` 零改动（`git status` 证据）。

## Changed paths

| Path | Design section | Change |
|---|---|---|
| `packages/namespace-api/package.json` | §7 D1（manifest；SA3 范围注记见 D1） | 新建：exports `.` + `./rest` 三条件；deps `@nomicore/namespace-registry`/`@nomicore/vfsl`；devDeps `@types/node`/`typescript`/`vitest` + `@nomicore/persistence`（test-only，见 Deviations-1） |
| `packages/namespace-api/tsconfig.json` | §7 D1 | 新建：extends 根 base、include `src/**/*.ts` |
| `packages/namespace-api/src/rest.ts` | §8.2/§8.3、D2/D3/D4/D7/D8/D9 | 新建：冻结路由匹配器、method gate（405 + `Allow: POST`）、role gate（403 + `INSTANCE_ROLE_FORBIDDEN`）、构造读取/校验/复制/冻结（普通 `TypeError`）、判别结果与公共类型 |
| `packages/namespace-api/src/create-namespace.ts` | §8.4、D5/D6 | 新建（**包内私有**，不进 exports）：最小 body 读取 → 机械提取 → `deriveSchemaIdentity` → 四键 SCHEMA envelope → `Registry.create({owner,schema,root})` → release 前复制 frozen DTO → 恰一次 `await lease.release()`（失败吞、不重试）→ 201（不设 `Location`）；未映射结局 fail-loud rejection |
| `packages/namespace-api/src/index.ts` | §7 D1 | 新建：re-export `./rest.js` 公共面（不导出私有编排） |
| `packages/namespace-api/AGENTS.md` | §11 ALLOW（SA8 §8-4、SA6 §15） | 新建：包契约（Host 无关普通 Module、公共面、编排私有、构造冻结 + TypeError、B-1 role 单真相、B-3 固定顺序、未映射结局 = rejection、延后切片、验证门） |
| `packages/namespace-api/README.md` | §11 ALLOW（SA2 F-M4） | 新建：包契约摘要 + 公共 API + Lease 语义 + 延后范围 + 验证入口（13/13 既有包 README 惯例补全） |
| `package.json`（根） | §7 D1 接线配套、R3 | `scripts.typecheck` 链在 namespace-registry 后插入 `tsc -p packages/namespace-api/tsconfig.json`（链 14 → 15 项） |
| `pnpm-lock.yaml` | §7 D1 接线配套、R3 | `pnpm install` 再生成：新增 `packages/namespace-api` importer（workspace links + 4 devDeps） |
| `wiki/raw/task_issue-267_design.md` | §14 + D1 | 落实 SA2 F-M1–F-M4 文字修订 + D1 实现轮范围注记（见下节）；零设计语义变更 |
| `wiki/raw/task_issue-267_sa3_impl.md` | 本报告 | 新建 |

## SA2 Finding落实

| Finding ID | Severity | Implementation | Result |
|---|---|---|---|
| F-M1 | MINOR | 设计 §2 锚点 8：「逐一列出 13 个 tsconfig」→「13 个包 + 1 个 app（14 项 tsconfig）」；§11 AGENTS 行：「12 包惯例」→「13 个既有包惯例」 | 数字与根 `package.json`/目录普查一致 |
| F-M2 | MINOR | 设计 §8.5 数据流表与 §12 映射表：role suite「后 6 用例」→「后 5 用例（3 route/method + 2 构造门）」；7 + 3 + 2 = 12 | 分组计数之和 = 12，总数 35 不变 |
| F-M3 | MINOR | 设计 §2 锚点 11 改用 `@types/node` web-globals 全局声明 + 根 `pnpm typecheck` 链为 operative 证据（并注明 vitest `--typecheck` include 仅 `*.test-d.ts`）；§12「类型面干净」行同步 | 不再以空证据支撑全局可解析性；根链实测覆盖 `packages/namespace-api/src/**` 且 exit 0 |
| F-M4 | MINOR | 采纳「方案 A」：新建 `packages/namespace-api/README.md`，并把它显式加入设计 §11 ALLOW LIST 行 | ALLOW 与决定一致，实现无范围外文件 |

SA2 的 BLOCKER/MAJOR 为空（verdict `approve`），无 BLOCKER/MAJOR 落实项。SA2 §14 非阻断观察 1（D5 fail-loud 语义无契约断言）已按其建议写入包 `AGENTS.md`（「Unmapped outcomes … reject `handle` — this skeleton never invents HTTP error mappings」），使 FR-3 有显式替换点、SA4/SA7 有对照锚。

SA8 边界条件落实（B-1/B-2/B-3 与冻结面）：

| 约束 | 实现 |
|---|---|
| B-1 role 单真相 | `RestRouterOptions.role: InstanceRole` 只从 `@nomicore/namespace-registry` 公共 re-export 导入；包内零 role 默认值、零环境变量/第二配置源；AGENTS.md + `rest.ts` JSDoc 写明值须由 composition root 从 Instance service 注入（本票无 composition root 消费者） |
| B-2 observer 构造面 | `metricsObserver`/`diagnosticObserver` 必选；缺失/非函数 → 普通 `TypeError`；零参 `() => void` 签名；本票零事件发射 |
| B-3 固定顺序 | path 匹配 → method gate → role gate → owner 捕获 → body 读取 → 派生 → create → DTO 复制 → 恰一次 release → 201；Peer 分支在 role gate 前零 owner 解码/零 body 成员调用/零 Registry 触达（契约 poison registry + trapped body 用例亲证） |
| 冻结面 201 / `sc1-` / 403 code / 405 + Allow / Registry·Lease 零修改 / replication-disabled | 201 恰两键 + schema 三键、不设 `location`；只消费 `deriveSchemaIdentity` 不重算；`INSTANCE_ROLE_FORBIDDEN` 逐字；`allow: 'POST'` 恰值；只调用 `create`/`namespaceId`/`release`；REST 不触 META/复制身份 |

## File scope check

| Changed path | ALLOW entry | Purpose |
|---|---|---|
| `packages/namespace-api/package.json` | §11 ALLOW 第 1 行（§7 D1 manifest） | 公共 seam 接线锚（`./rest` → `src/rest.ts`）+ 依赖声明 |
| `packages/namespace-api/tsconfig.json` | §11 ALLOW 第 2 行 | 包源码类型门 |
| `packages/namespace-api/src/rest.ts` | §11 ALLOW 第 3 行 | 公共 router 面（契约 import 目标 H3） |
| `packages/namespace-api/src/create-namespace.ts` | §11 ALLOW 第 4 行 | 包内私有 create 编排（ADR L18 结构化落点） |
| `packages/namespace-api/src/index.ts` | §11 ALLOW 第 5 行 | 包 `.` 入口惯例 |
| `packages/namespace-api/AGENTS.md` | §11 ALLOW 第 6 行 | 包契约（SA8 §8-4 / SA6 §15 明示随包建立） |
| `packages/namespace-api/README.md` | §11 ALLOW 第 7 行（SA3 依 F-M4 新增行） | 13/13 既有包 README 惯例补全 |
| `package.json`（根） | §11 ALLOW 第 8 行 | `scripts.typecheck` 链 +1（逐步列出惯例） |
| `pnpm-lock.yaml` | §11 ALLOW 第 9 行 | CI 五处 `--frozen-lockfile` 可安装性 |
| `wiki/raw/task_issue-267_design.md` | §11 ALLOW 末行（本设计文档）+ dispatch 指令 | SA2 F-M1–F-M4 修订映射与文字更正 |
| `wiki/raw/task_issue-267_sa3_impl.md` | 技能固定产物（实现报告） | 本报告 |

无 DENY LIST 路径改动：`packages/namespace-api/test/*`（sha256 未变）、上游 13 包、`docs/adr/*`、`CONTEXT.md`、`vitest.config.ts`、`docs/**`、`apps/**`、`domains/**`、`scripts/**`、`.github/**` 全部零改动。

## Verification

| # | Command | Result | Evidence |
|---|---|---|---|
| 1 | `pnpm install` | exit 0（新增 importer，无网络下载） | `pnpm-lock.yaml` +22 行：`packages/namespace-api` importer；`packages/namespace-api/node_modules/@nomicore/{namespace-registry,vfsl,persistence}` 链接就位 |
| 2 | `pnpm install --frozen-lockfile`（CI 五处同款） | exit 0 / `Lockfile is up to date` | CI 安装门可满足（R3 闭合） |
| 3 | `NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run --typecheck packages/namespace-api/test`（SA6 入口） | **exit 0；Test Files 4 passed (4)；Tests 35 passed (35)；Type Errors no errors** | 红灯基线 `3 failed \| 1 passed`（SA6 §13.1）→ 全绿；5 次复跑逐次一致（02:25:10 / 02:26:17 / 02:27:01 / 02:27:54 / 02:28:53） |
| 4 | `pnpm --filter @nomicore/namespace-api run typecheck` | exit 0 | `tsc -p tsconfig.json`，受影响的包级类型门零错误 |
| 5 | `pnpm typecheck`（根链，14→15 项，含 `packages/namespace-api/tsconfig.json`） | exit 0 | 全部 15 项（13 包 + namespace-api + 1 app）逐项通过 |
| 6 | `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run --typecheck.only --passWithNoTests=false`（CI typecheck 作业同款） | exit 0；Test Files 23 passed；Tests 136 passed；Errors 0 | 首跑曾红：2 个 Unhandled Source Error（`Cannot find module '@nomicore/persistence'` / `'@nomicore/persistence/testing'`，`rest-contract-harness.ts:29/30`）→ 依 Deviations-1 修复后转绿 |
| 7 | 基线对照（临时移出 `src/` + `package.json` + 包级 `node_modules/`，恢复后已还原） | 同入口 **exit 1；Errors 23**（含 2 个 persistence 解析错误 + `../src/rest.js` 等） | 证明 6 的红是本票实现前既有缺口/能力缺口，而非误导出的伪绿；修复后 0 errors |
| 8 | 契约测试字节复核：`sha256sum packages/namespace-api/test/*.ts` | 与 SA6 §13.4 五组哈希逐位一致 | `0549f11b…`(harness)、`b812b38b…`(support)、`181449a0…`(hub)、`e61a23eb…`(wiring)、`1010b616…`(role) —— 零测试改动 |
| 9 | `git status --porcelain --untracked-files=all` | 仅上表 changed paths | 无 `dist/`、无 `tsconfig.build.json`、无临时诊断件；`packages/namespace-api/node_modules/` 被 `.gitignore` 的 `node_modules/` 命中 |

红灯转绿范围（6 个原红灯点全绿）：2 个行为 suite（模块缺失构造性红灯）、1 个接线锚（`package.json` 缺失）、`Type Errors no errors`；支撑/file suite 5/5 恒绿。

## Deferred verification

1. **仓库全量测试与 CI 裁决**：按 SA3 职责边界未运行全仓 `pnpm test`；本票实测入口 = SA6 契约 suite（35/35）+ CI typecheck 入口。test 分片作业参数（`--typecheck.enabled=false` + `scripts/ci-test-shard.mjs` 磁盘枚举）自动纳入新契约文件（SA2 §9 已核），留待 SA4/SA7 与 CI。
2. **packaging 作业（`pnpm pack:local && publish:verify`）**：未运行（非设计 §12 指定命令，且 `scripts/**` 属 DENY LIST）。新包未登记进 `scripts/package-catalog.mjs` 的静态 `publishPackages` 列表 → 本票不打包/不发布 `@nomicore/namespace-api`；该作业只遍历静态目录，故不受影响。**follow-up 登记（Controller）**：发布目录登记属打包/发布流程，需要在 release 相关票中显式决定（`scripts/**` 本票不可触）。
3. **SA4/SA7 评审、真实环境验收、CI 动态裁决**：非 SA3 职责。
4. **后续切片（设计 FR-1/FR-3/FR-4/FR-5）**：请求形状校验 + limits + `Request.signal`；Registry 失败映射 + problem shape + issues 截断；observer 事件契约；server composition root（role 自 Instance service 注入的 B-1 消费者侧闭环）。本票按设计只做成功路径与 role gate。
5. **ADR 0015「提议 → 已接受」状态翻转**：Controller 收官清单（FR-2；DENY LIST 禁止实现链自行翻转，未触）。

## Deviations or blockers

1. **新增 `@nomicore/persistence` devDependency（范围内 manifest 细节；零公共设计变更）**：SA6 harness 静态 import `@nomicore/persistence` 与 `@nomicore/persistence/testing`，而 `tsconfig.typecheck.json` include `packages/*/test/**/*.ts`——新包落 manifest 后 CI typecheck 作业（`--typecheck.only`）要求该 import 在包内可解析。首跑 CI 入口红（2 个 Unhandled Source Error）；基线对照（移出 `src`/`package.json`/包级 `node_modules`）同入口 23 errors，证明该缺口在实现前已存在（SA6 只报过滤入口 `Type errors: no errors`，未覆盖该作业口径）。修复 = 在 `devDependencies` 增列 `@nomicore/persistence: workspace:*`（test-only；镜像 `packages/ws-replication` 的 devDependency 先例）；`dependencies` 与运行时常量面不变，exports 不变。已在设计 §7 D1 追加 SA3 范围注记（不改变设计语义）。
2. **设计文档修订由 SA3 执行（dispatch 明确指令）**：仅文字/计数精度（F-M1/F-M2/F-M3）、ALLOW 行补全（F-M4）与 §14 映射；D1 注记见上。未改动任何设计行为条款、冻结面或 ALLOW/DENY 边界。
3. **无阻塞项**：无需修改 ALLOW 外路径、未改变公共设计、未违反 ADR；红灯契约（SA6 测试字节）零改动。

## Suggested commit message

```
feat(#267): REST namespace create 骨架——Hub 201 成功路径 + Peer role gate + Lease 编排

- 新建 @nomicore/namespace-api：./rest 暴露 Host 无关 createRestRouter（Request → Response
  + 判别结果）；create 编排 src/create-namespace.ts 保持包内私有
- Hub：raw path → method（405 + Allow: POST）→ role gate → 派生 sc1- 身份 → 四键 SCHEMA
  envelope → Registry.create({owner,schema,root}) → release 前复制 frozen DTO → 恰一次
  await lease.release()（失败仍 201）→ 201 恰含 namespaceId + schema{lang,version,id}，无 Location
- Peer：匹配 method/raw path 后、解析 owner/读取 body 前 403 + INSTANCE_ROLE_FORBIDDEN
- 构造读取/校验/复制/冻结；配置错误普通 TypeError；两个同步 void observer 必须显式注入
- 未映射结局一律 fail-loud rejection（FR-1/FR-3/FR-4 后续叠加）；新建 namespace 默认
  replication-disabled（零新增行为）
- 接线：根 pnpm typecheck 链 +1；pnpm-lock.yaml 再生成（--frozen-lockfile 可安装）
- 落实 SA2 F-M1–F-M4（设计文字勘误 + README 惯例补全）

SA6 契约：35/35 绿（原 3 failed | 1 passed）；包/根 typecheck 与 CI typecheck 入口全绿。
```
