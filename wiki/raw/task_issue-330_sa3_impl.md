# SA3 Implementation Report

- 派发：`sa-fd978a1a-21af-48bb-b258-38d77a024a64`（role `mabf-sa3`，phase `implementation`，iteration 0）
- Worktree：`/home/wangjian/nomicore-fix-issue-330`（branch `mabf/issue-330`，HEAD `83581b3`）
- 任务：Issue #330「nomicore 服务表面 getter 化：冻结服务可被 Proxy 包装消费（ADR 0023 落地）」
- 结论：机械变换完成；SA6 红灯契约 18/18 函数成员访问由 `THROW:TypeError` 转 `ACCESS_OK`（`status`×2 既有绿灯未回归）；三包 typecheck、root `pnpm typecheck`、root `pnpm test`（341 文件 / 3596 用例）、`pnpm pack:local`（三 tgz + dist 访问器形态）全绿。

## Inputs consumed

| 输入 | 路径 | 采用 |
|---|---|---|
| 任务简报（Issue 正文 AC1–AC8；`Comments` 空） | `wiki/raw/task_issue-330.md` | 全部 AC；Owner 评论无 |
| 最新批准设计（SA1） | `wiki/raw/task_issue-330_design.md` | §7.2 逐服务机械变换规格、R1–R6、§7.3 稳定闭包、§7.4 姿态、§7.6 三新测试、§7.7 AC4 审计分支、§11 ALLOW/DENY、§12.3 验证门、§15 冻结面复查 |
| SA2 设计评审 | `wiki/raw/task_issue-330_sa2_review.md` | verdict `approve`；无 BLOCKER/MAJOR；MINOR O1/O2/O3 |
| SA6 验收契约 + 红证据 | `wiki/raw/task_issue-330_sa6_contract.md`、`wiki/raw/task_issue-330_sa6_red_probe.log` | §12.2 逐成员契约、§12.3 helper/三重对照纪律、§12.4 姿态断言块、§12.5 测试路径、§12.6 门禁 |
| SA8 决议摘录 / 冲突报告 | `wiki/raw/task_issue-330_relevant_decisions.md`、`wiki/raw/task_issue-330_conflict_report.md` | verdict `clear`；`requiresConflictRecheck=true`；Frozen surfaces 1–10 |
| 母法 | `docs/adr/0023-proxy-consumable-frozen-service-surfaces.md` | L45–62 决策、L64–74 姿态、L78 实现注意、L90–93 验收 |
| 模块约束 | `packages/clock/AGENTS.md`、`packages/namespace-registry/AGENTS.md`、`packages/ws-replication/AGENTS.md` | 包门禁与导出/生命周期边界 |
| Owner 评论 REST | 派发说明 + 简报空节 + SA6 §2 + SA8 §1 一致记录 | `[]`——无 owner 要求、无 comment ID/时间戳可应用 |

## Existing worktree reconciliation

- 开工时 `git status --short` 仅 6 个 `wiki/raw/task_issue-330*` 未跟踪产物（brief / conflict_report / design / relevant_decisions / sa2_review / sa6_contract / sa6_red_probe.log），跟踪文件零改动；无既有 `task_issue-330_sa3_impl.md`、无未提交实现需要修订。
- HEAD 现状与设计 §2.1 五服务形态表逐点一致（实读核对：`registry.ts` 七成员 data、`plugin.ts` hub/peer `status` 已是 getter、`system.ts`/`manual.ts` data）——设计与 SA6 锚点无需修订。
- SA6 基线可直接复跑：依赖已安装，`NODE_OPTIONS=--conditions=nomicore-source` 下跨包解析走源码，无需构建。

## Changed paths

| Path | Design section | Change |
|---|---|---|
| `packages/clock/src/system.ts` | §7.2 S4 | 新增模块级稳定闭包 `nowImpl`；`systemClock` 字面量 `now` 由数据属性改 `get now() { return nowImpl }`；`Object.freeze` 保留 |
| `packages/clock/src/manual.ts` | §7.2 S5 | `createManualClock` 工厂作用域提升 `now`/`set`/`advance` 三个稳定闭包（捕获本实例 `current`）；字面量三成员改 getter，成员序 now/set/advance 保持 |
| `packages/ws-replication/src/plugin.ts` | §7.2 S2/S3 | Hub：`requestReauth` 提为 `apply` 作用域命名闭包，`requestReauth`/`stop` 改 getter（`status` getter 与 `stop` const 不动）。Peer：`addTarget`/`removeTarget`/`notifyAuthChanged`/`waitForLive` 四闭包提升，五函数成员改 getter 并保持成员序；`waitForLive` 体逐字平移 |
| `packages/namespace-registry/src/registry.ts` | §7.2 S1 | `createRegistryInternal` 内 `runShutdown` 之后、`const registry` 之前提升 `open`/`create`/`importReplica`/`resetReplica`/`deleteNamespace`/`getStatus`/`shutdown` 七个稳定闭包；registry 字面量七成员改 getter，成员序保持；`shutdown` 保持**非 async** 函数表达式 |
| `packages/clock/test/clock-guard-proxy-consumption.test.ts` | §7.6、SA6 §12.5 | 新增：包内 guard-proxy helper + 敏感性正控 + 诚实 Proxy 负控 + `systemClock`/`ManualClock` 全成员访问/调用/错误语义透传 + 稳定闭包 + 姿态断言组 |
| `packages/namespace-registry/test/registry-guard-proxy-consumption.test.ts` | §7.6、SA6 §12.5 | 新增：真实 Cordis 组合（对齐 `registry-plugin.test.ts` 测试 22）取 `nomicoreRegistry`，7 成员访问/调用直通 + `shutdown` 同缓存 Promise + 姿态组 |
| `packages/ws-replication/test/ws-replication-guard-proxy-consumption.test.ts` | §7.6、SA6 §12.5 | 新增：对齐 `ws-replication-plugin.test.ts` `dependencies()` seam；Hub `status`/`requestReauth`/`stop` + Peer 全六成员；`waitForLive` 用注入 timer + `stop()` 触发 settle（无真实 sleep） |
| `wiki/raw/task_issue-330_sa3_impl.md` | 技能规程 | 本实现报告（非 ALLOW 实现路径，技能强制交付物） |
| `wiki/raw/task_issue-330_sa3_red.log`、`..._green.log`、`..._root-test.log`、`..._pack-local.log` | 技能规程 | 红/绿与门禁原始输出证据（非 ALLOW 实现路径，零源码影响） |

## SA2 Finding落实

| Finding ID | Implementation | Result |
|---|---|---|
| BLOCKER / MAJOR | 无（SA2 verdict `approve`，§13 明示无 BLOCKER/MAJOR） | 无需修订 |
| O1（MINOR）：设计 §7.2 S3 `waitForLive` 注解笔误 `Promise<void =>` | 按 SA2 建议处置：以源码现行为准，实现为 `const waitForLive = (namespaceId: string): Promise<void> => new Promise<void>((resolve, reject) => {`（体逐字平移） | 已落实；`pnpm typecheck` 与包 typecheck 绿 |
| O2（MINOR）：行号锚点小漂移（`clock-contract.test.ts` ~L108–110、`clonePlainData` L763–768） | 无需动作；README 引用与实现均按实际源码定位 | 无影响 |
| O3（备注）：`pack:local` 入口为 `scripts/build-local-packages.mjs` | 无需动作；实现未触碰 `scripts/**` | 无影响 |

## AC4 审计结论（设计 §7.7 要求写入实现记录）

- 命令：`grep -rn "\bwritable\b" packages/clock packages/namespace-registry packages/ws-replication --include="*.ts" | grep -v writableLength`
- 结果：三包恰 2 处命中——`packages/namespace-registry/src/types.ts:518`（文档注释词 `writable gate`）、`packages/namespace-registry/src/registry.ts:766`（`clonePlainData` 数据载荷快照 `writable: false`，非服务成员）。**三包不存在针对服务成员的 `writable === false` 数据属性形态断言** → AC4 走「审计结论记录在案」分支，不新增/改写既有形态断言。
- 既有形态断言为 `packages/clock/test/clock-contract.test.ts` 的 `Object.keys(systemClock) === ['now']` + `Object.isFrozen`（约 L70–73）与 ManualClock 键面 `['now','set','advance']` + `Object.isFrozen`（约 L109–113）；访问器形态下两项保持绿灯（root `pnpm test` 全绿实证），本实现未修改这些文件。
- `clonePlainData`（`registry.ts` L763–772）为文件内子范围 DENY：本实现 diff 在 `registry.ts` 的 hunk 仅位于 L2179–2290（工厂末段），L763–772 零触碰。`namespace-runtime` `copyFrozen`、`create-diagnostic.ts` `NOOP_DIAG`、`ws-replication/src/testing.ts` `decorateLease`、`instance`/`persistence`、`apps/**`、`domains/**` 均零改动。

## File scope check

| Changed path | ALLOW entry | Purpose |
|---|---|---|
| `packages/clock/src/system.ts` | ALLOW 表第 1 行（§7.2 S4） | `nowImpl` 模块级提升 + `systemClock` getter 化 |
| `packages/clock/src/manual.ts` | ALLOW 表第 2 行（§7.2 S5） | 工厂作用域闭包提升 + `ManualClock` getter 化 |
| `packages/ws-replication/src/plugin.ts` | ALLOW 表第 3 行（§7.2 S2/S3） | hub/peer 服务表面 getter 化；接口区块 L35–56 与 `status` getter、`stop` const 零改动 |
| `packages/namespace-registry/src/registry.ts` | ALLOW 表第 4 行（§7.2 S1） | registry 七方法闭包提升 + getter 化；文件内子范围 DENY（L763–772）未触碰 |
| `packages/clock/test/clock-guard-proxy-consumption.test.ts` | ALLOW 表第 5 行 | 新增回归（AC3/AC5/AC6） |
| `packages/namespace-registry/test/registry-guard-proxy-consumption.test.ts` | ALLOW 表第 6 行 | 新增回归（AC1/AC5/AC6） |
| `packages/ws-replication/test/ws-replication-guard-proxy-consumption.test.ts` | ALLOW 表第 7 行 | 新增回归（AC2/AC5/AC6） |
| `wiki/raw/task_issue-330_sa3_impl.md` 及 4 个 `task_issue-330_sa3_*.log` | 设计 ALLOW 之外的技能强制产物 | 实现报告与验证原始证据；零源码/配置影响，不进包/构建面 |

- 未触碰任何 DENY 路径；未新建共享测试设施（helper 三份包内复制，逐字同款 SA6 §12.3）；未改 `vitest.config.ts`/CI/`scripts/**`/三包 `package.json`；`git status` 跟踪改动恰为 4 个 ALLOW 源文件。

## Verification

| Command | Result | Evidence |
|---|---|---|
| `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run --typecheck <三新测试文件> --passWithNoTests=false`（**改造前 HEAD 红捕获**） | exit 1；3 文件 / 8 用例全红；18/18 函数成员 `THROW:TypeError`（clock 1+1+3+3、registry 7、hub 2、peer 5），hub/peer `status` 2/2 `ACCESS_OK` | `wiki/raw/task_issue-330_sa3_red.log` |
| 同上命令（改造后） | exit 0；**3 文件 / 8 用例通过**；`Type Errors no errors` | `wiki/raw/task_issue-330_sa3_green.log` |
| `pnpm --filter @nomicore/clock typecheck` | exit 0 | 终端输出；见下 Deviations 的迭代说明 |
| `pnpm --filter @nomicore/namespace-registry typecheck` | exit 0 | 终端输出 |
| `pnpm --filter @nomicore/ws-replication typecheck` | exit 0 | 终端输出 |
| `pnpm typecheck`（root，14 tsc project） | exit 0（无输出） | 终端输出 |
| `NODE_OPTIONS=--conditions=nomicore-source pnpm exec tsc -p tsconfig.typecheck.json` | exit 0（vitest typecheck 程序面，含全部 `packages/*/test/**/*.ts`） | 终端输出 |
| `pnpm test`（root `vitest run --typecheck`） | exit 0；**341 文件 / 3596 用例通过**；`Type Errors no errors` | `wiki/raw/task_issue-330_sa3_root-test.log` |
| `pnpm pack:local` | exit 0；14 tgz 产出，含 `nomicore-clock-0.1.0.tgz`、`nomicore-namespace-registry-0.1.10.tgz`、`nomicore-ws-replication-0.1.5.tgz`；`manifest.json` 无 diff | `wiki/raw/task_issue-330_sa3_pack-local.log` |
| dist 访问器形态核验（AC8） | `packages/*/dist` 保留 getter 语法：`get now() { return nowImpl; }`、`get now/set/advance()`、hub `get requestReauth/stop()`、peer `get addTarget/removeTarget/notifyAuthChanged/waitForLive/stop()`、registry 七 getter（target ES2022 无 downlevel 变形） | `packages/*/dist/**` grep（构建产物，gitignore） |
| tarball 内容核验 | `package/dist/` 在包内（`tar -tzf nomicore-clock-0.1.0.tgz`） | 终端输出 |

### 冻结面复查（设计 §15 / SA8 §5 逐项）

| # | 项 | 结论 | 证据 |
|---|---|---|---|
| 1 | Cordis service 名（4 名）零变化 | 保持 | `NOMICORE_REGISTRY_SERVICE='nomicoreRegistry'`、hub/peer 常量、`CLOCK_SERVICE='clock'` 未在 diff 中 |
| 2 | 五接口 TS 类型面零 diff | 保持 | diff 仅 4 文件且 hunk 位于工厂/`apply` 末段；`types.ts`/`contract.ts` 零改动，`plugin.ts` 接口区块 L35–56、`manual.ts` `ManualClock` L17–20 未触碰；root typecheck + `tsc -p tsconfig.typecheck.json` 绿 |
| 3 | `Object.freeze` 保留；赋值/重定义仍拒；getter 返回同一稳定闭包 | 保持 | 三新文件姿态断言组（`set === undefined`、`configurable===false`、赋值/`defineProperty` 抛 `TypeError`）+ `service.m === service.m` 断言 |
| 4 | 键面/枚举性 | 保持 | 新测试 `Object.keys` 断言；既有 `clock-contract.test.ts` 键面/isFrozen 断言在 root 全绿 |
| 5 | 方法体/状态机一行不动；`shutdown` 非 async、exact-same-Promise；hub/peer `stop` 缓存 Promise | 保持 | diff 逐 hunk 复核（仅声明形态变化）；`registry.ts` L2262–2264 注释与 `shutdownPromise` 逻辑随体平移；新测试 `p.shutdown()===first`、`p.stop()===first`、`p.shutdown()===p.shutdown()` |
| 6 | teardown reverse-yield 次序 | 保持 | `ctx.effect` 块（hub L438–445 / peer L540–545 原区间）未在 diff 中 |
| 7 | Registry issue/status 信封与冻结常量不变 | 保持 | 未触碰常量区；新增测试 `getStatus()` 同引用 + `{state:'running'\|'stopped'}` |
| 8 | `clonePlainData`/`copyFrozen` `writable:false` 未被误伤 | 保持 | `registry.ts` diff hunk 仅 L2179+；`namespace-runtime` 零改动 |
| 9 | `ManualClock` 仅经 `@nomicore/clock/testing`；无新建共享测试设施 | 保持 | `index.ts`/`testing.ts` 零改动；三 helper 包内复制（每文件约 10 行） |
| 10 | wire 协议零触碰 | 保持 | 改动为进程内服务构造面；`docs/protocols/**`、帧/状态机零改动 |

## Deferred verification

1. **仓外联动（AC8 后半，非本票 SA3 义务）**：DSH 侧 `nomicore-host` 用新 tarball 重建、revision 切换 live reload、回退 DSH fork 沙箱守卫——`pnpm pack:local` 已交付可构建产物，仓外动作由 Controller/DSH 侧执行。
2. **DSH 沙箱对任意冻结服务的一般性缺陷**（ADR 0023 残留节）：host 侧议题，不在本仓。
3. **全仓回归与最终动态验证**：SA3 已按设计 §12.3 跑 root `pnpm test`（341 文件 / 3596 用例）与 `pnpm pack:local`；真实环境验收/CI 裁决仍属后续角色。
4. **未来新增对象字面量服务的 getter 构造纪律**：ADR 0023 冻结为 code review 纪律；lint 规则化是独立改进（非本票必要条件）。

## Deviations or blockers

- **无阻塞、无设计偏离**。全部改动落在 ALLOW LIST 内，DENY LIST 零触碰。
- 实现过程一次自纠（不影响交付面）：首轮 root `pnpm test` 中 3596 用例全绿，但 vitest 类型程序报出 6 条 `Unhandled Source Error`（registry 新测试以 `{}`/`undefined` 直穿公共 typed 签名）。已在测试内以受控显式转换（`{} as CreateNamespaceInput`、`Parameters<NamespaceRegistry['importReplica']>[2|3]`）表达「运行时敌意输入穿过静态边界」，重跑 root `pnpm test` exit 0；断言强度与运行时行为不变。
- 一处测试断言范围澄清（非契约弱化）：peer `status` getter 每次访问返回**新的快照对象**（既有设计语义，`ConnectionState`/`getNamespaceState` 投影），因此稳定闭包断言 `service.m === service.m` 仅适用于**函数成员**（设计 §7.3.1 的「方法闭包」语义）；`status` 仍以访问不抛 + 深比较直通 + 姿态断言覆盖（hub 同款）。`status` 实现本身零改动。
- 红捕获与设计/SA6 预期完全一致：18/18 函数成员 `THROW:TypeError`、`status`×2 已绿；无契约自身矛盾，无需 `reject`。

## Suggested commit message

```
fix(#330): nomicore 服务表面 getter 化——冻结服务可被 Proxy 包装消费（ADR 0023）

- namespace-registry: nomicoreRegistry 七方法提稳定闭包，字面量改访问器属性
- ws-replication: hub requestReauth/stop 与 peer 五函数成员同款改造（status 不动）
- clock: systemClock 模块级 nowImpl；ManualClock 工厂作用域三闭包
- 新增三款包内 guard-proxy 合法消费回归（三重对照 + 姿态 + 稳定闭包）
- Object.freeze 与公共 TS 类型面零变化；方法体/状态机/teardown 次序一行不动

Refs: ADR 0023, issue #330
```
