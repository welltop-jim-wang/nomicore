# SA6 红灯报告 — Issue #139（`apps/yjs-server` composition root，Phase 5 切片 9）

- **日期**：2026-08-30
- **基线**：`wiki/raw/task_issue-139_design.md`（READY R2）+ `wiki/raw/task_issue-139_sa2_review_r3.md`（PASS；3 项 advisory 已吸收）
- **工位**：`/home/wangjian/nomicore-fix-issue-139`（worktree，branch `fix/issue-139-on-docs-phase-5-websocket-replication`）
- **结论**：**红灯成立（26 failed / 5 files；全部失败原因 = 应用包与应用 CLI 尚不存在）**；未写任何生产代码、未 commit。

## 0. 范围与取舍（最小必要契约）

按总控指令只固化「最小必要的验收契约」：严格配置（含 localOwner/静态角色/重启语义）、公共组合 seam、peer 恢复控制语义、骨架冒烟/停机预期 API。取舍如下：

| 设计 §5 计划 | 本文档落点 | 取舍理由 |
|---|---|---|
| T1 `app-config-red.test.ts` | ✅ 全量（19 用例） | AC1 核心：角色必填、instanceId/port 文法、未知键 TypeError、role×字段交叉（含 hub 顶层 `backoff` 拒）、peer hub.url/hubInstanceId/token、target nsId 文法/重复、file 缺 rootDir、authorization 双形式（`namespaceId`/`provisionId` 恰一、直引必填 `ownerUserId`、provision 形式禁 `ownerUserId`、悬空 `provisionId` 拒、`(peerInstanceId, nsId)` 重复对拒）、合法配置深冻结 |
| T2 `ws-transport-red.test.ts` | ❌ 未写 | `ws` 传输适配为 SA7 活链路/适配器验证域；非「app 不存在」红锚（`ws` 库本身已存在，该测当前可能绿，污染红灯基线） |
| T3 `hub-peer-smoke-red.test.ts` | ✅ 骨架 `smoke-skeleton-red.test.ts`（3 用例） | AC2/AC5/AC7：`provisioned→listening(实际 port)→ready` 事件序（port 0 ephemeral）、peer 静态 target 认证 + `verify-write`→hub `read` 收敛、SIGTERM 双进程 exit 0、同 rootDir 干净停机后重启（锁随停机删除，R1 #5）且 durable 回读、共享活跃 root 第二实例 loud 拒（AC2）。SIGHUP 换装/错 token 拒等重型步骤留待 T6/SA7 |
| T4 `third-party-composition-red.test.ts` | ✅（2 用例：公共包组装 + 应用公共入口暴露） | AC6：只 import `@nomicore/*` 公共入口 + cordis，复刻 hosting 最小装配（clock→TimerService→persistence→registry→create→enableReplication→openReplicationSession）；文件零 app 内部 specifier（SA4 可静态比对 import 清单） |
| T5 `ordered-shutdown-red.test.ts` | ✅（2 用例） | AC4 骨架：进程内 memory persistence，`createNomicoreApp`→`stop()`，NDJSON 停机序 `replication-drained→registry-stopped→persistence-disposed→app-stopped` 严格递增、`stop()` 幂等、端口释放后可重建 |
| T6 `hub-restart-static-target-red.test.ts` | ✅（1 用例，按 R2 版） | AC1/AC3 恢复语义：hub v1 播种 → v2 直引授权 → peer 静态 targets → live 基线 → hub SIGTERM → `goaway-received`(`SERVER_SHUTTING_DOWN`) → `connection-state-changed`(to=`blocked`) → 同 rootDir 重启 → **负例静默窗口**（blocked 零自动重拨）→ stdin `notify-auth-changed` → 回执 `connectionState` 离开 blocked → 有界收敛（verify-write/read）。SA2 R3 advisory 已吸收：静默窗口不要求 `connection-backoff-scheduled` 之外的事件，本实现断言 zero redial 事件 |
| T7 `stdin-error-chain-red.test.ts` | ❌ 未写 | 错误链路为 SA7 验证域；非最小必要（多数形状已被 T1/T6 间接锚定）。若 SA4/总控要求可下一轮补 |

## 1. 产出文件（全部在 `apps/yjs-server/test/`，测试专用）

```text
apps/yjs-server/test/app-config-red.test.ts              # T1（19 用例）
apps/yjs-server/test/third-party-composition-red.test.ts # T4（2 用例）
apps/yjs-server/test/ordered-shutdown-red.test.ts        # T5（2 用例）
apps/yjs-server/test/smoke-skeleton-red.test.ts          # T3 骨架（3 用例）
apps/yjs-server/test/hub-restart-static-target-red.test.ts # T6（1 用例）
```

测试独立（各自内联 spawn/NDJSON/waitFor 助手，无共享模块）；全部锚定**可观察运行时行为**（解析抛错、深冻结、子进程 NDJSON 事件、stdin 回执、exit code、进程存活/退出），**零源码 grep/字符串形状断言**。

### 测试发现配置（唯一配置改动，为运行 app 测试所必需）

按设计 §5 基建注并受总控「test-discovery configuration ONLY if necessary」许可：根 `vitest.config.ts` `test.include` 追加 `'apps/*/test/**/*.test.ts'`（该行属设计 ALLOW LIST 既定改动，SA3 实现期保留即可）：

```diff
-    include: ['packages/*/test/**/*.test.ts', 'domains/*/test/**/*.test.ts'],
+    include: ['packages/*/test/**/*.test.ts', 'domains/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
```

根 `package.json` 未动（typecheck 脚本追加 app tsconfig 属 SA3 实现期 ALLOW LIST，非测试运行所需）。

## 2. 红灯运行

### 2.1 命令（后台独立进程，按项目测试执行纪律）

```bash
# 前置：释放测试端口（本套测试用 ephemeral/自由端口，端口冲突防护仍执行）
fuser -k 8000/tcp 8081/tcp 3005/tcp 2>/dev/null; sleep 2

# 依赖安装（worktree 初始无 node_modules；仅安装既有 workspace 依赖，锁文件零变更）
pnpm install --prefer-offline

# 定向红灯命令（后台独立进程执行；--no-typecheck：app 测试为 .test.ts，不进 typecheck include）
setsid nohup bash -c \
  './node_modules/.bin/vitest run apps/yjs-server/test --no-typecheck 2>&1; echo EXIT=$? > /tmp/sa6-139-exit' \
  > /tmp/sa6-139.log 2>&1 < /dev/null & disown
```

### 2.2 真实红灯证据（2026-08-30 实测，`/tmp/sa6-139.log` / 退出码 `EXIT=1`）

```text
 Test Files  5 failed (5)
      Tests  26 failed (26)
   Duration  727ms (transform 98ms, setup 0ms, collect 147ms, tests 669ms)
```

逐文件失败根因（全部 = 应用实现不存在，非测试语法/发现配置错误）：

| 文件 | 结果 | 失败证据（原文摘录） |
|---|---|---|
| `app-config-red.test.ts` | 20/20 failed | `→ Cannot find package '@nomicore/yjs-server' imported from '.../apps/yjs-server/test/app-config-red.test.ts'`（每个用例，运行期动态 import） |
| `hub-restart-static-target-red.test.ts` | 1/1 failed | `→ process exited with code 1 before hub v1 provisioned` + stderr `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../apps/yjs-server/src/main.ts'`（tsx spawn 即刻失败——CLI 未实现） |
| `ordered-shutdown-red.test.ts` | 2/2 failed | `→ Cannot find package '@nomicore/yjs-server' imported from '.../ordered-shutdown-red.test.ts'` |
| `smoke-skeleton-red.test.ts` | 3/3 failed | 三个用例均 `→ process exited with code 1 before …` + 同一 `ERR_MODULE_NOT_FOUND: .../src/main.ts` |
| `third-party-composition-red.test.ts` | 文件收集失败 | `→ Cannot find package '@deepseek-ai/cordis' imported from '.../third-party-composition-red.test.ts'`（**归因说明**：app 包 manifest（含 `@deepseek-ai/cordis` 等 deps 的 `apps/yjs-server/package.json`）尚未创建，pnpm 不提升非根 deps，故 apps/ 下静态 import 不可解析——红根因仍是「app 包 (含依赖接线) 不存在」，属设计 ALLOW LIST 的 app 骨架；SA3 建成 manifest + `pnpm install` 后该文件可收集，届时红锚收敛为「应用公共入口 `@nomicore/yjs-server` 尚不存在」（T4 第 2 用例），公共包组装用例（第 1 用例）应转绿） |

对 SA3 的意图声明：实现 `apps/yjs-server/{package.json,src/**}` + 根 `vitest.config.ts` 该行后，上述失败应依次消失：
- T1/T5：`@nomicore/yjs-server`（`src/index.ts` 公共入口）实现 `parseAppConfig`/`createNomicoreApp` 后转绿；
- T3/T6：`src/main.ts` CLI（`--config`，stdout NDJSON 事件面 + stdin NDJSON 控制通道 + SIGTERM 有序停机 + `.nomicore-lock.json` 守卫）实现后按断言链转绿；
- T4：app 包 manifest 建好后，公共包组装用例转绿 + 应用入口暴露用例随 `src/index.ts` 转绿。

## 3. 边界声明

- 零 `packages/**`、零 `src/**` 生产代码改动；`vitest.config.ts` 唯一修改（测试发现，1 行）；未 commit（`git status` 仅 `M vitest.config.ts` + `?? apps/yjs-server/` + `?? wiki/raw/task_issue-139_sa6_red.md`）。
- 未新增测试包/端口依赖（测试全部 ephemeral/运行时自由端口），本 repo 无 `scripts/test-lock.sh`，无需通知测试策略。
- 实现后不扩张：动态验证/压力/时序/互通/fuzz 属 SA7；若 SA4/SA7 指出本契约缺陷，按其指定最小范围修正 fixture 或断言。
- 中断门禁自查：红灯原因 = 应用不存在（module-not-found / tsx spawn ENOENT），非「测试写错但实现正确」；若实现后仍未绿属 SA3 问题，非 SA6 复现失败。
