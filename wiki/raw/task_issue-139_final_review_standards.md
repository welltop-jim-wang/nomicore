# Issue #139 最终审查 — 规范轴（Standards axis）

- 审查者：独立最终审查（规范轴），不承继任何前序 SA 结论，逐文件重查
- worktree：`/home/wangjian/nomicore-fix-issue-139`（branch `fix/issue-139-on-docs-phase-5-websocket-replication`）
- 基线：`git diff d911025...HEAD`（d911025 已确认是 HEAD 祖先；4 个提交：199be62 feat / 758c3c4 docs / 4d9fff5 fix / 381b9fd fix；24 文件 +4035/-6）
- 审查日期：2026-06-19（本 worktree 会话）

## 1. 验证命令与结果（只读）

| 命令 | 结果 |
|---|---|
| `git diff --check d911025...HEAD` | exit 0，无空白错误 |
| `pnpm typecheck`（root，含 `tsc -p apps/yjs-server/tsconfig.json`） | exit 0 |
| `npx vitest run apps/yjs-server`（全 7 文件并行） | 35 用例，首次 33/35、复跑 30/35——失败均为环境级 `spawn EAGAIN` / node `uv_thread_create` 断言（子进程 exit 134）/ `tsx: Cannot fork`，失败集合两次不同 |
| `npx vitest run apps/yjs-server/test/smoke-skeleton-red.test.ts`、`... hub-restart-static-target-red.test.ts ... stdin-error-chain-red.test.ts`（重文件逐/串行） | 全部通过（3/3、1/1、4/4） |
| `pnpm test`（root 全仓 + typecheck） | **190 文件 / 2149 用例全部通过，0 type error**（含 app 全部 35 用例并行通过） |

结论：app 套件与全仓契约测试在本环境可全绿；并行重跑时偶现的失败全部锚定在沙箱线程/进程配额（EAGAIN、exit 134），非代码缺陷（见发现 M2）。

## 2. 逐规范条文核对记录

### 2.1 根 `AGENTS.md`

| 条文 | 核对结果 |
|---|---|
| L19 改 `apps/` 前读最近嵌套 `AGENTS.md` | 本次 diff 新增 `apps/yjs-server/AGENTS.md`（应用获得框架级命令/部署规则时按 `apps/AGENTS.md` L13 要求补齐）✓ |
| L27 第三方插件宿主：用 Cordis plugin-factory 组合、遵循 `docs/integration/cordis-plugin-hosting.md`、不依赖动态 pluginId / `cordis_define` | `app.ts` boot 序 = clock fiber → `new TimerService(ctx)` → persistence fiber → registry fiber，与 hosting 文档 L51-73 生产挂载序逐项一致；hub/peer 插件用 `{inject, apply}` + `ctx.effect` 有序 disposer，同 `createNamespaceRegistryPlugin` 工厂形态（hub-plugin.ts:46-74、peer-plugin.ts:41-71）；全文件无动态 pluginId / `cordis_define` 依赖 ✓ |
| L29-31 worktree 一律在仓库本地 `.worktrees/` | **diff 外事项**：本 worktree 位于主仓旁（`/home/wangjian/nomicore-fix-issue-139`），由流水线 host 创建。不属本次代码 diff，记为 O1 移交 host |
| L21-23 schema authoring / 域文档 | 未触及 `domains/`、`docs/adr/` ✓ |

### 2.2 `apps/AGENTS.md`

| 条文 | 核对结果 |
|---|---|
| L9 只消费包公共导出 | 逐一比对 4 个被消费包 `src/index.ts` 导出面：`createSystemClockPlugin`/`requireClock`、`createFilePersistencePlugin`/`createMemoryPersistencePlugin`、`createNamespaceRegistryPlugin`/`requireNomicoreRegistry`/`NamespaceLease`/`NamespaceRegistry`、`createHubReplication`/`createPeerReplication` 及全部 type 导入均在公共白名单内；零 `@nomicore/*/testing`、零包内 subpath、零 dsh-persistence ✓ |
| L10 一条已校验变更路径 + 一个授权决策点 | WS 写入经 ws-replication 包 → registry；控制通道 `verify-write` 经 `lease.mutateRoot`（app.ts:529-531）；hub 授权唯一决策点 = `authorize` 回调（app.ts:224-232）✓ |
| L11 每 namespace 独立 schema/runtime 作用域；未知方言 loud | config.ts:308-319 provision schema 强制 `lang:'vfsl'` 精确形状，违规启动期 loud；方言校验交由 registry 核心契约 ✓ |
| L12 适配选择/环境配置/日志/停机编排留在应用边缘 | config 校验、NDJSON sink、root lock、信号处理全在 app 层；包内无进程级 I/O ✓ |
| L13 应用获得框架级命令时补 app-local `AGENTS.md` | 已新增 `apps/yjs-server/AGENTS.md` ✓ |
| L17 Verification：应用自查 + root typecheck/test 全绿 | root `package.json` typecheck 链已追加 `tsc -p apps/yjs-server/tsconfig.json`；`vitest.config.ts` include 追加 `apps/*/test/**/*.test.ts`；本机全绿（§1）✓ |

### 2.3 `apps/yjs-server/AGENTS.md`

| 条文 | 核对结果 |
|---|---|
| L13 只用公共导出，无内部 subpath/测试接缝/DSH profile | 同 2.2 第一行，src 与 test 双侧核对（test 仅 import `@nomicore/{clock,persistence,namespace-registry}` 公共名 + `@nomicore/yjs-server` 自身动态 import）✓ |
| L15 一进程一静态角色，绝不同时 | config.ts:544-569：role 必填无缺省；hub 带.peer 块拒；peer 带.hub 块拒；backoff 为 hub 拒 ✓ |
| L16-18 授权绑定先于任何网络端点接纳；适配层零凭据预检（verifyToken 恰一次、在包内 accept 路径） | bootHub：直引条目启动即绑定（app.ts:204-215）→ provision 条目在 provision 时刻绑定（app.ts:299-309）→ 全部完成后才 `startHubWsServer`（app.ts:254）；ws-server.ts:145-154 只做 Bearer **提取**（`extractBearer`）后透传 `accept(transport,{token})`，与包公共签名 `accept(transport, request?: HubUpgradeRequest)` 匹配；无任何 token 校验逻辑 ✓ |
| L19-21 单一拆卸链 replication drain → registry shutdown → persistence dispose → timer/clock teardown；绝不二次并发拆卸 | performStop（app.ts:371-413）严格该序；`stop()` single-flight（app.ts:364-369）；fiber 级 `ctx.effect` disposer 与显式 close/stop 幂等复入（hub-plugin.ts:65-69 注明 closeTail 单飞）✓ |
| L21-22 stdout 严格 NDJSON 事件面；stdin 每行恰一回执、进程不因控制输入退出 | `createStdoutEventSink` 每事件一行 JSON（lifecycle.ts:18-22）；人读错误走 stderr；`handleControlLine` 对畸形输入/未知 op 均结构化回执（app.ts:418-440）；main.ts:143-156 捕获回执路径异常仍回执不退出 ✓ |
| L23-24 file 持久化取 `<rootDir>/.nomicore-lock.json`（wx 独占）；干净停机释放；共享活跃 root 拒绝 | lifecycle.ts:60-99 `wx` 创建、pid 存活冲突 loud（区分同实例/异实例文案）、stale 覆盖、EACCES/EPERM loud；main.ts:181-188 启动先取锁、shutdown/reload 停旧后释放 ✓ |
| L28-29 Verification（app typecheck + 套件） | 全绿（§1）✓ |

### 2.4 `.editorconfig`

| 键 | 核对结果 |
|---|---|
| charset utf-8 / end_of_line lf | 新文件无 CR（`git diff --check` 过）；中文注释按 repo 惯例 UTF-8 ✓ |
| insert_final_newline | 全部 24 个 diff 文件逐一 `tail -c1` 验证均以换行结尾 ✓ |
| indent_style space / indent_size 2 | 人工精读全部 src/test；`grep -P "\t"` 零命中（无 tab）；2 空格缩进 ✓ |
| trim_trailing_whitespace | `git diff --check` exit 0 ✓ |

### 2.5 仓库既有代码风格/架构惯例（对照 packages/ 同构做法）

| 维度 | 既有惯例 | 本 diff | 结果 |
|---|---|---|---|
| 注释语言 | 中文 doc 注释为主（clock/contract.ts、namespace-registry/index.ts、ws-replication 等），错误消息英文 | 同构 | ✓ |
| 语句分号 | 主导带分号（ws-replication 2210 / vfsl 2158 / namespace-registry 987 行；仅 clock 不带） | 带分号 | ✓ |
| 公共入口导出形态 | `export {}` 值 + `export type {}` 白名单（ws-replication/index.ts） | index.ts 同构（值+type 具名导出） | ✓ |
| 插件工厂形态 | `{inject:[...], apply(ctx){...ctx.effect}}`（namespace-registry/plugin.ts:178-197） | hub/peer 插件同构 | ✓ |
| 包内相对导入后缀 | **全部 `.js` 后缀**（src 323 处、test 39 处，`.ts` 后缀 0 处） | 全部 `.ts` 后缀 + 全仓唯一 `allowImportingTsExtensions` | ✗ 见 M1 |
| package.json 形态 | name/version/private/type:module/exports/scripts/依赖 workspace:*、devDeps typescript+vitest+@types/node | 同构（version 0.1.0 新包初始，同 dsh-persistence 0.2.0/doc-runtime 起步惯例） | ✓ |
| 测试布局 | `<pkg>/test/*.test.ts`，root vitest include 收编 | `apps/yjs-server/test/*.test.ts` + include 增量收编 | ✓ |
| 提交信息 | conventional commits + scope + issue 引用 + 双语 | 同构（4/4d9fff5 体内有一行冗余，见 N4） | ✓ |
| 锁文件 | pnpm-lock 与 package.json 同步 | ws 8.21.3 / @types/ws 8.18.1 / cordis 4.0.1 与声明一致，importer 段完整 | ✓ |
| 目录布局 | 文档入 `docs/integration/`（既有 cordis-plugin-hosting.md） | hub-peer-deployment.md 同目录 | ✓ |

## 3. 发现列表

严重级定义：blocker=违反规范明文且必须返工；major=明确违规/契约风险但可局部修复；minor=一致性/可维护性问题；nit=瑕疵。

### M1（minor）相对导入后缀偏离全仓惯例
- **证据**：`apps/yjs-server/src/index.ts:11`（`from './config.ts'`，src 全部文件同式）；`apps/yjs-server/tsconfig.json:4`（`allowImportingTsExtensions: true`，全仓唯一启用点）。packages/* 的 src 与 test 相对导入 100% 用 `.js` 后缀（323+39 处，`.ts` 后缀 0 处）。
- **判定**：无任何 AGENTS.md/editorconfig 条文禁止 `.ts` 后缀，且 tsx 直跑 `src/main.ts` 下该选择可运行（typecheck/测试全绿）；但作为 monorepo 内第 12 个 workspace，与既有 11 个包的既定惯例不一致，属于风格分歧而非违规。不阻断。

### M2（minor）真进程测试套件在受限环境并行重跑偶发资源耗尽失败
- **证据**：`npx vitest run apps/yjs-server`（7 文件并行）在本沙箱两次结果 33/35、30/35，失败均伴随 `spawn ... EAGAIN`、node `uv_thread_create` 断言（子进程 exit 134）、`tsx: Cannot fork`（如 smoke-skeleton-red、stdin-error-chain-red、hub-restart-static-target-red 的用例）；同批文件串行运行及 root `pnpm test`（190/2149）全绿。
- **判定**：失败为环境进程/线程配额耗尽，非代码缺陷、非规范违规；但套件每个文件并行 spawn 多个 tsx/node 子进程（stdin-error-chain-red.test.ts 还含 2×CPU 燃烧进程），对低 ulimit 的 CI runner 有复现风险。记录在案供 CI 观测，不阻断。

### N1（nit）instanceId 文法常量在 app.ts 内联重复
- **证据**：`apps/yjs-server/src/app.ts:576` 内联 `/^[a-z][a-z0-9-]{0,62}$/`，而 `config.ts:24` 已导出 `INSTANCE_ID_PATTERN`（app.ts 同文件已从 './config.ts' 导入 `NAMESPACE_ID_PATTERN`）。文法演进时存在双定义点漂移风险。

### N2（nit）控制通道内部异常复用 `unknown-op` 稳定码
- **证据**：`main.ts:153` 对回执路径的意外异常回 `{event:'reply', ok:false, code:'unknown-op', message:...}`；部署文档（hub-peer-deployment.md:128-129）将 `unknown-op` 语义定义为「角色不适用动词」。每行恰一回执的硬约束未被破坏（✓），但内部错误借用该码与文档语义有轻微混淆。

### N3（nit）部署文档未声明 `verify-write` 的 `path`≡`set` 约束
- **证据**：`app.ts:499-502` 要求 `path` 若提供必须与 `set` 完全相等（否则 `invalid-op-args`）；`docs/integration/hub-peer-deployment.md:121` 动词表只列参数名未提该约束。

### N4（nit）提交 4d9fff5 信息体内残留重复主题行
- **证据**：`git log 4d9fff5 -1` 正文第二行为孤立的 `/ fix(apps/yjs-server): reject duplicate token values loudly, ...`（疑似编辑残留）。仅提交卫生问题。

### O1（观察，diff 外）worktree 位置偏离根 AGENTS.md §Git worktrees
- 根 AGENTS.md 要求 worktree 建在仓库本地 `.worktrees/`；本 worktree `/home/wangjian/nomicore-fix-issue-139` 位于主仓之旁，与同主机另一 worktree（`nomicore-refactor-pubtest-lifecycle--203356`）同样模式。该位置由 MABF host（任务指派）决定，不在本次审查的代码 diff 内，移交 host 知悉，不计入 diff 发现。

## 4. 结论

- 逐条核对 5 个规范源（根/apps/yjs-server 三层 AGENTS.md、.editorconfig、packages 同构惯例）：**全部明文条文符合**；`git diff --check`、root typecheck、app 套件、全仓 2149 用例均绿。
- 发现计数：**blocker 0 / major 0 / minor 2 / nit 4**（另有 1 条 diff 外观察 O1）。
- 无阻断项：M1/M2 为一致性与环境可复现性记录，N1-N4 为瑕疵级。

Verdict: pass
