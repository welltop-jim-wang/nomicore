# 独立审查报告 — Issue #226 SA3 R1「本地 E2E 前置修复」（implementation-review）

- 被审对象：`wiki/raw/task_issue-226_local_e2e_prereq_fix.md`（SA3 R1，dispatch `sa-b678ff13`）及其落地改动
  （两份 lifecycle E2E 测试文件的 spawn env 钉扎）
- 审查范围（委派指令）：① R1 修复是否真实解决 local E2E 前置；② 是否弱化任何断言/时序/协议；
  ③ 是否引入环境掩盖；④ 当前 #226 实现全集是否仍符合 ADR 与版本策略
- Worktree：`/home/wangjian/nomicore-fix-issue-226`（branch `mabf/issue-226`，HEAD `45a22f0`，#226 实现全集未提交态）
- 输入产物（全部亲读）：任务简报 `task_issue-226.md`、R1 报告、`task_issue-226_sa3_impl.md`（R0）、
  `task_issue-226_impl_conflict_recheck.md`（SA8 clear）、`task_issue-226_final_verify.md`（独立动态终验 approve）、
  `task_issue-226_design_conflict_report.md`（SA8 C1–C3/N1–N5）、`task_issue-226_red_contract_rev1.md`、
  `task_issue-226_dispatch.md`；ADR-0011/0012 关键条款原文回查
- 审查方式：全部独立重验——git diff 逐 hunk 亲读、与 R0 时代 diff 基线精确比对、根因机制级复现（不触文件）、
  三段测试链后台 Job 亲跑（bash-56 / bash-57 A·B·C）、生产锚点亲读（diag-pump.ts 全文、index.ts 导出面、
  src 调度原语 grep、版本 bump 惯例回查）
- 时间：2026-09-06（本地）；零生产/测试代码改动（本会话唯一写入 = 本文件）

## Verdict

**approve**（`requiresConflictRecheck: false`）

R1 修复真实、最小、因果闭环；未弱化任何断言/时序/协议；未引入环境掩盖；#226 实现全集经独立复查
维持 ADR-0011/0012（含 2026-08-28 amendment）合规与版本策略合规。

## 1. R1 增量精确性（delta = 且仅 = 两处 env 钉扎）

工作区全部改动处于未提交态，无法用 git 直接切分 R0/R1，故用三条独立证据闭环：

1. **diff 基线比对**：R0 时代经 SA8 impl recheck 与 final_verify（13:26 stash pop 后）双双固化的
   `git diff --stat` 基线 = 9 文件 **400+/143−**；当前 = 9 文件 **434+/145−**。差值 **+34/−2** 恰为
   两处 env 钉扎块（注释 + `SPAWN_NODE_OPTIONS` 常量 + spawn env 一行改写），逐 hunk 亲读无其他内容。
2. **mtime 链**：两测试文件 13:34（R1 编辑窗口）；两个 package.json 13:10（= final_verify §3 stash
   push/pop 的恢复时刻，内容 diff 仅版本行，与 R0 声明一致）；未跟踪的 `diag-pump.ts`（10:55）与
   `registry-issue-226-red.test.ts`（10:24）停留在 R0 上午，未被 R1 触碰。
3. **前序产物归属**：diff 中其余测试改动全部有早于 R1 的授权记载——C1 重写 = 契约修订轮 rev1 R3
   （SA8 design-conflict C3 裁决：冻结锚把缺陷 A 行为断言为期望，与简报 AC1 正面冲突）；E1/E3 到达
   poll = R0 §7「落后面」修订（SA8 C3 同类，12:54 impl recheck clear 覆盖）；D8 到达 poll = SA2
   attack review §5.1 预授权执行。final_verify bash-41（13:26，R1 之前）同两文件 28/28 绿亦证明
   断言形状在 R1 前已定型。

⇒ R1 实际改动 = 两文件各一处 spawn env 钉扎（`NODE_OPTIONS: SPAWN_NODE_OPTIONS`），与 R1 报告声明一致。

## 2. 根因与修复的因果独立复现（机制级，零文件改动）

| 步骤 | 亲测命令 | 结果 |
|---|---|---|
| dist 缺席 | `ls apps/yjs-server/node_modules/@nomicore/ws-replication/dist` | 不存在（gitignored 发布产物，`pnpm install` 不生成） |
| exports 形状 | `packages/ws-replication/package.json` | `"nomicore-source": "./src/index.ts"` 首位、`"import": "./dist/index.js"` 兜底 |
| 修复前形态（= 旧 spawn env） | `env -u NODE_OPTIONS tsx src/main.ts` | **`ERR_MODULE_NOT_FOUND …/@nomicore/ws-replication/dist/index.js imported from …/src/index.ts`** —— 与 Controller 复现的 6 失败逐字同因（E1–E5/D8 子进程启动即退） |
| 修复后形态（= 新 spawn env） | `env NODE_OPTIONS=--conditions=nomicore-source tsx -e "import('@nomicore/ws-replication')"` | **RESOLVED-OK**（经 tsx 加载 workspace TS 源码） |
| 规范入口同构 | 根 `package.json` `test` 脚本 | 本就 `NODE_OPTIONS=--conditions=nomicore-source vitest run --typecheck` —— 钉扎 = 把规范 env 语义延伸到子进程，不依赖外层调用方式 |

注：裸 `node`（非 tsx）即使带 condition 也在 `src/hub-connection.js`（TS extensionless）失败——
E2E 子进程本就经 `TSX_BIN` 启动，该事实只说明 source-condition 路径依赖 tsx 加载器（R1 前后均为如此，
非本次引入的依赖）。

## 3. 无弱化 / 无掩盖分析

- **R1 增量只改子进程 env**：tsx bin、`main.ts` 参数、stdio 三管道、stdin NDJSON 控制通道、stdout
  事件解析、SIGTERM 收口全部未动；无 skip/disable/过滤器/预算放宽/断言修改。
- **覆盖完整**：两文件各仅一处 `spawn(`（亲 grep），即被钉扎的 `spawnApp`——不存在逃逸修复的子进程。
- **不能掩盖失败**：两文件中 `dist/index` 仅出现在 R1 注释里，无任何断言依赖 dist/（全 repo 测试对
  dist 的引用仅 clock/codec 两份包契约守卫，与本修复无交互）。子进程仍须真实启动、走全链路协议、
  过全部断言——实现若回归，E1–E5/D8 照样红。钉扎与根 `test` 脚本 env 逐字节等价（canonical env 下
  `includes` 命中 → 原样透传，零变化）。
- **无 env 门控**：两文件 `process.env` 触点仅 helper 与 spawn env 两处；测试行为不随 env 分叉。
- **前序时序修订非弱化**（非 R1 增量，一并复核）：三处到达 poll 均为「等待语义事实到达（5s 界、
  撕裂读重试）后再执行原断言」，断言本体零改动且保留在 poll 之后（E1 的 current.json/单流/锚、E3 的
  30s 界 + exit 0、D8 的 strict 读面）；C1 新锚比旧锚更严（B 必须以 NS_B 归属落可读 attempt 记录 +
  全程零 unattributed 丢弃 + A 干净面 + replay complete 保持），旧锚冻结的是缺陷行为本身（SA8 C3）。
- 非阻断 nit：helper 的 `existing.includes('conditions=nomicore-source')` 子串判在假想的更长同名前缀
  condition（如 `nomicore-source-x`）下会误判已含——本 repo canonical env 恒为精确串，不可达，仅登记。

## 4. 亲跑验证（全部后台 Job、真实退出码、顺序执行）

| # | 模式 | Job | 结果 |
|---|---|---|---|
| 1 | **裸跑**（Controller 复现失败的原样调用）：`pnpm exec vitest run --typecheck <两文件>` | bash-56 | **28 passed (28)**（red 22 含 E1–E5 真实进程级、sa7 6 含 D8），Type Errors no errors，EXIT=0，60.29s |
| 2 | **规范 env**：`pnpm test <两文件>` | bash-57 SEG-A | **28 passed (28)**，Type Errors no errors，EXIT=0 —— 与裸跑同构，证明 canonical 路径零行为变化 |
| 3 | **#226 契约 + 守卫**：`registry-issue-226-red`（13）+ `registry-surface`（12，含 R4 注释面） | bash-57 SEG-B | **25 passed (25)**，EXIT=0 |
| 4 | **yjs-server 全模块**（19 套件，含全部进程级 E2E）`--testTimeout=30000` | bash-57 SEG-C | **19 files / 114 passed (114)**，Type Errors no errors，EXIT=0 |

修复前该裸跑模式子进程全灭（§2 机制级复现）→ 修复后同模式 28/28 真实运行通过。

## 5. #226 实现全集 ADR / 版本策略复查（维持合规）

- **diag-pump.ts 全文亲读 × ADR 逐条**：per-ns 有界 256 / drop-newest 保序（ADR-0011「队列溢出可丢弃」；
  dropped-count 上报为「应尽力」措辞，SA8 N1 已裁定可接受并登记）、drain 逐任务 try/catch 全程非抛
  （ADR-0011 L20「不得改变业务结果」/ emitter seam 非抛）、per-ns 单飞 + 排空后 Map 位释放、调度只在
  入队点（O(1)）、与 shutdown 零耦合不等待（ADR-0011 L129「不得无限等待日志 sink」）、不引入第二业务
  排序机构（只序诊断投递）。调用点搬移 = ADR-0012 2026-08-28 amendment **L250 明文授权的选项 (a)**
  （只移调用点到 sequencer slot 外；adapter 每 record 同步单条 append 语义一字未动，非 L252 writer-queue
  切片）。
- **被拒 create genesis-less 流**：ADR-0012 L22「genesis 未成功写入时 stream 仍可记录诊断事实，但不得
  声称完整重放」直接授权；C1 锚不要求 B 的 replay complete（SA8 N4 边界保持）。
- **setImmediate 唯一性**：src 全树裸调用唯一命中 `diag-pump.ts:137`，与 R4 守卫注释契约一致；守卫
  套件 12/12 绿（本轮 SEG-B 亲证）。
- **Runtime 包零生产改动**：diff 面 9 文件不含 `packages/namespace-runtime/**` ✓。
- **版本策略**：仓库惯例（#159 → diagnostic-log 0.1.0→0.1.1、#155 → registry 0.1.6→0.1.7 等均对被改
  publishable 包做 patch bump）；R0 的 registry 0.1.7→0.1.8 / yjs-server 0.1.2→0.1.3 是该惯例的一步
  延续；lockfile 全 `workspace:*` 无需变更（final_verify §4 亲核）。**R1 仅改测试脚手架，发布产物零
  影响，不叠加 bump 是正确执行**。
- **审查链完整**：SA2 approve → rev1 契约 + SA8 recheck clear → SA3 R0 → SA8 impl-conflict recheck
  **clear**（12:54，含 E1/E3/D8 修订与版本 bump 面）→ 独立动态终验 **approve**（13:26，含 stash 回退
  红态复现 12F|1P → 恢复后 13/13）→ Controller 亲跑 → R1。本轮在其上叠加独立重跑（§4）全绿。

## 6. 非阻断观察（登记，不构成本轮阻断）

1. helper 子串判定的理论假阳性面（§3 nit）——不可达，仅记录。
2. yjs-server 其余进程级套件（hub-restart-static-target-red、stdin-error-chain-red、lifecycle-watchdog-red、
   phase5-* 等）沿用 `env: { ...process.env }` 依赖规范 env，裸调用方式下同类脆弱性仍在——SA3 R1 §5
   已登记，属后续可选统一面，本票范围外（本轮 SEG-C 证明规范 `pnpm test` 下 19/19 全绿）。
3. worktree 根 `REPORT.md` 仍为 #155 遗留（final_verify §6.1 两度登记）——Controller 写 #226 完成事务前
   必须整体改写；非 R1 缺陷。

## 7. 本轮边界

零生产代码改动、零测试改动、零 git 状态变更（`git stash list` 空、diff 面与被审态一致）；唯一写入 =
本文件；全部测试经后台 Job 独立进程真实退出码。结构化结果：verdict `approve`、
`requiresConflictRecheck: false`，artifactPaths 见 structured_output。
