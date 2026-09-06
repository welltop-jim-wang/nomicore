# Issue #226 — 本地 E2E 构建/依赖前置缺陷修复报告（实现 R1，dispatch sa-b678ff13）

- 任务：Issue #226（bugfix）— `wiki/raw/task_issue-226.md`（AC1–AC5；Parent PR #142）
- 触发：Controller 亲跑验收复现 6 个失败——`apps/yjs-server/test/diagnostic-replay-host-lifecycle-red.test.ts` E1–E5 与 `diagnostic-replay-host-lifecycle-sa7.test.ts` D8 均报
  `ERR_MODULE_NOT_FOUND: apps/yjs-server/node_modules/@nomicore/ws-replication/dist/index.js` 而无法启动；
  #226 registry 契约 13/13 已绿、root typecheck 已绿。
- Worktree：`/home/wangjian/nomicore-fix-issue-226`（branch `mabf/issue-226`，HEAD `45a22f0`，#226 实现全集未提交态）
- 本轮执行：SA3 implementation R1（dispatch `sa-b678ff13`，Host child = 本会话 47c628f3）；2026-09-06 13:45 CST 完成
- 范围铁律：保留 #226 已有实现与版本策略；绝不跳过/屏蔽/弱化任何测试；零生产代码改动；无 push/PR。

## 1. 根因（亲测复现 + 代码证据链）

1. 两个 E2E 文件以真实进程方式启动 Host：`spawn(<repo>/node_modules/.bin/tsx, [apps/yjs-server/src/main.ts, …], { env: { ...process.env } })`。
   子进程为独立 Node/tsx 进程，**不享受** vitest 的 alias 映射（`vitest.config.ts` 把 `@nomicore/*` 指到 `packages/*/src/index.ts`）。
2. `apps/yjs-server/src/index.ts` 经 `@nomicore/ws-replication` 导入 workspace 包；pnpm 以 symlink 链接到
   `packages/ws-replication`，其 `package.json` `exports["."]` 为
   `{ "nomicore-source": "./src/index.ts", "types": "./dist/index.d.ts", "import": "./dist/index.js" }`。
3. 根 `package.json` 的权威 `test` 脚本带 `NODE_OPTIONS=--conditions=nomicore-source`：命中 exports 首个
   `nomicore-source` 条件 → 子进程经 tsx 直接加载 workspace 包 TS 源码 → **无需 dist**。
4. 不带该 env 的调用方式（如裸 `pnpm exec vitest run`）→ 子进程按 `import` → `./dist/index.js` 解析；
   `dist/` 为 `.gitignore` 的发布产物、**`pnpm install` 不生成**（workspace 无 prepare/postinstall 钩子），
   当前不存在 → Node ESM 抛 `ERR_MODULE_NOT_FOUND` → 进程启动即退 → E1–E5/D8 全数无法启动。
5. 复现（修复前，本报告亲跑）：`pnpm exec vitest run --typecheck <两文件>` →
   `2 failed (2)` / `5 failed`(red E1–E5) + stderr
   `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/apps/yjs-server/node_modules/@nomicore/ws-replication/dist/index.js' imported from …/apps/yjs-server/src/index.ts`。
6. 该脆弱性 #155 时代即被登记（`task_expose-diagnostic-replay-host-lifecycle_sa4_review.md`：裸跑
   ERR_MODULE_NOT_FOUND 为「运行方式错误（spawn 子进程依赖该 export condition 解析 workspace 源码）」），
   但只在测试文件 spawn env 层面依赖外层规范 env，未在源上消除 → 任何不经根脚本 env 的验收运行都会撞上。

## 2. 修复（两文件、纯测试脚手架，各一处 env 钉扎）

在 `diagnostic-replay-host-lifecycle-red.test.ts` 与 `diagnostic-replay-host-lifecycle-sa7.test.ts` 的
`spawnApp` 启动子进程时钉住仓库规范 export condition（等价于根 `test` 脚本 env，行为逐字节一致）：

```ts
const SPAWN_NODE_OPTIONS = (() => {
  const existing = process.env.NODE_OPTIONS ?? '';
  return existing.includes('conditions=nomicore-source')
    ? existing
    : `${existing} --conditions=nomicore-source`.trim();
})();
// spawn 处：env: { ...process.env, NODE_OPTIONS: SPAWN_NODE_OPTIONS }
```

语义：

- 规范 env 下（`pnpm test`，NODE_OPTIONS 已含该 flag）→ `SPAWN_NODE_OPTIONS === process.env.NODE_OPTIONS`，
  **零变化**（修复前 bash-41/bash-52 同构 28/28 证明）。
- 裸 `vitest run` / 任何无该 env 的调用 → 子进程补上 flag，与规范运行一致解析 workspace TS 源码。
- 不改断言、不改时序锚、不改 spawn 的进程/协议/参数；无 skip/无过滤/无预算放宽。
- 两文件内其余进程原语（stdin NDJSON 控制通道、stdout 事件解析、SIGTERM 收口）零触碰。

## 3. 验证（全部后台 Job、真实退出码；顺序执行避免自致负载）

| # | 命令（模式） | Job | 结果 |
|---|---|---|---|
| 1 | 裸跑（修复前失败模式）：`pnpm exec vitest run --typecheck <两文件>` | bash-51 | **28 passed (28)**（red 22 含 E1–E5、sa7 6 含 D8），Type Errors no errors，EXIT=0 |
| 2 | 规范 env：`pnpm test <两文件>` | bash-52 | **28 passed (28)**，Type Errors no errors，EXIT=0（与修复前规范运行同构，证明零行为变化） |
| 3 | #226 焦点：#226 契约 `registry-issue-226-red`（13）+ 守卫 `registry-surface`（12） | bash-53 | **25 passed (25)**，EXIT=0 |
| 4 | 模块回归：`pnpm test apps/yjs-server/test --testTimeout=30000`（全 19 套件，含全部进程级 E2E） | bash-54 | **Test Files 19 passed (19)；Tests 114 passed (114)**，Type Errors no errors，EXIT=0 |
| 5 | `pnpm typecheck`（14 tsconfig 串联，含 apps/yjs-server src+test） | bash-55 | **EXIT=0**，零类型错误 |
| 6 | `git diff --check` | 即时 | EXIT=0（无空白错误） |

关键证据（bash-51，裸跑修复后）：

```text
✓ apps/yjs-server/test/diagnostic-replay-host-lifecycle-red.test.ts (22 tests)
  ✓ … > E1 启用从 namespace 创建起 … 8532ms
  ✓ … > E2 ROOT/SCHEMA 变更链记录 … 7269ms
  ✓ … > E3 Host 停机有界且日志完好：SIGTERM 干净退出 … 7263ms
  ✓ … > E4 日志故障隔离 … 7044ms
  ✓ … > E5 hub 重启 … 16920ms
✓ apps/yjs-server/test/diagnostic-replay-host-lifecycle-sa7.test.ts (6 tests)
  ✓ … > D8 健康事件面 + D1 无泛滥 … 7269ms
Test Files  2 passed (2)
     Tests  28 passed (28)
Type Errors  no errors
```

即：**修复前该模式 E1–E5/D8 全灭（进程无法启动）→ 修复后同一模式 28/28 全部真实运行通过**；
断言、时序锚、进程协议均未被触碰。

## 4. 合规确认

- 零生产代码改动（`packages/`、`apps/yjs-server/src/` 未动）；零 package.json / lockfile 改动。
- **版本策略保留**：registry 0.1.8 / yjs-server 0.1.3 为 #226 实现轮既有 bump；本修复仅改
  `apps/yjs-server/test/` 下两个测试文件的 spawn env（发布产物不受影响），不再叠加 bump。
- 测试零弱化：无 skip/无 disable/无过滤器/无断言修改/无预算放宽；E2E 依旧真实 spawn Host 进程跑全链路。
- 修复后 #226 registry 契约（13/13）、守卫（12/12）、yjs-server 全模块（114/114）、根 typecheck（0 错）全绿。
- 未执行 git add/commit/push/PR（收尾属 Controller/runner 职责）。
- 本会话按委派指令执行（dispatch sa-b678ff13）；启动时曾以总控工具查询任务身份一次
  （`mabf_runner_start_task` 返回 already-active / `mabf_runner_inspect_task` 只读），零状态变更、未产生新派发。

## 5. 非阻断观察（登记，不扩大本轮范围）

- yjs-server 其余进程级套件（hub-restart-static-target-red、stdin-error-chain-red、
  lifecycle-watchdog-red、phase5-mgmt-verbs-sa7、phase5-three-instance-acceptance-red、
  smoke-skeleton-red 等）沿用同一 `env: { ...process.env }` 依赖规范 env 的模式；规范 `pnpm test`
  下全部绿（本报告 bash-54 19/19 全模块证明）。若未来要求「任意调用方式均可裸跑」，可参照本修复
  逐文件钉住 condition（本次验收仅涉及本报告两文件，未扩大改动面）。

## 6. 结构化结果

verdict `clear`（无设计/契约冲突；实现层前置修复）；artifactPaths 见 structured_output。
