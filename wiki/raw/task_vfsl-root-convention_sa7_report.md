# SA7 动态验证报告 — ROOT 约定实现：E310/E311（Issue #19）

**Date**: 2026-08-19
**验证对象**: SA3 整形后 commit `5764401`（parent `e0c9cb2`，分支 `fix/issue-19-on-adr-union-representation`，HEAD 实测一致）
**前置**: SA4 R3 窄复审 pass（R2 唯一驳回项 TASK.md 已整形闭环）——SA7 在 SA4 pass 基础上独立动态验证
**任务类型**: 功能开发（无 SA5）

---

## 0. 执行摘要

SA4 §3 动态审核重点第 1–6 条全部自行重跑并附触发证据，第 7 条（TASK.md 修复确认）按总控指示由 SA4 R3 C1–C5 静态闭环、无需重跑。**六条全部通过**：红灯 34/34 转绿、全量 9 文件 214/214 + typecheck EXIT=0、零删除红线零触碰、注册表 21 码与规格 §4 逐码全等 + 版本 0.1.4 零运行时依赖、R-4 探针 E305@1:1 胜出（非 E310）、fuzz 双支路触达且 okTrue 实测计数登记（记号汤 28 ≥ 26、fixture 变异 48 ≥ 5）。

执行方式：全部测试命令按 2026-05-08 规范起独立后台进程（`setsid nohup` + `disown` + 轮询），vitest 一律从 worktree 根目录运行（不带 `--root`，避免 include 失配空跑）。本套件为纯解析器 vitest，不占用任何服务端口——按 SA7 CLAUDE.md「不得盲用 `fuser -k` 清场」未做端口清场。临时探针（`packages/vfsl/test/sa7-probe-temp.test.ts`）取证完毕已删除，工作区恢复清洁（`git status` 仅任务档案面：dispatch.md / sa4_review.md / `.mabf-bg/`，与 SA4 C5 取证一致）；零业务代码改动、零永久测试新增（SA4 §3 第 5 条明示 R-4 探针为临时实录口径）。

---

## 1. Step 0 — SA4 判定校对

SA4 报告 `task_vfsl-root-convention_sa4_review.md` 含两轮判定：R2（行 4）reject（窄驳回：TASK.md 黑名单），R3 窄复审（文件末条，行 154）**pass**。以时间靠后的 R3 为准，且 R3 明示「SA7 动态验证对象更新为 `5764401`」。实测 `git rev-parse HEAD` = `57644010b446…` ✓。进入动态验证。

## 2. Step 1 — SA6 红灯转绿（SA4 §3 第 1 条前半）

命令（worktree 根）：`pnpm vitest run packages/vfsl/test/parse-vfsl-root-convention.test.ts`（独立后台进程）

```
 ✓ packages/vfsl/test/parse-vfsl-root-convention.test.ts (34 tests) 16ms

 Test Files  1 passed (1)
      Tests  34 passed (34)
```

EXIT=0。SA6 红灯文件（基线 21 failed | 13 passed）**34/34 全绿**——21 个 E310/E311 反例断言全部转绿，13 个锁定用例（正例契约锚 + E302/E301 既有语义）保持绿，与简报 §8.2 红灯构成精确镜像。

## 3. Step 2 — SA4 §3 清单逐条重跑

### 3.1 第 1 条：红灯 34/34 + 触发证据 ✅

见 §2。触发证据段（HG14）见 §5——红灯文件在 9 文件全量中真实运行且全绿。

### 3.2 第 2 条：全量 + typecheck ✅

命令（worktree 根，独立后台进程）：`pnpm test`、`pnpm typecheck`

```
 Test Files  9 passed (9)
      Tests  214 passed (214)
```

- `pnpm test`：**9 文件 214/214 全绿，EXIT=0**（逐文件见 §5 表）
- `pnpm typecheck`（= `tsc -p packages/vfsl/tsconfig.json`）：**EXIT=0**，零输出零报错
- 取证过程一次工具面波折（非项目问题）：typecheck 首次并行起进程时因 shell `&` 优先级（`cd X && cmd1 & cmd2 &` 中 `&` 作用于整个 `cd && cmd1` 列表）落在 agent 目录报 `ERR_PNPM_NO_PKG_MANIFEST`；agent 目录核实零污染，以显式 `bash -c 'cd <worktree> && …'` 重跑即 EXIT=0。全量测试进程自始在 worktree 正确运行，未受影响。

### 3.3 第 3 条：零删除核对 ✅

机械 `it(` 计数，基线 commit `e0c9cb2` 与 HEAD `5764401` 逐文件对照（`git show` 基线版 vs 工作区版）：

| 文件 | base `it(` | head `it(` | 判定 |
|---|---|---|---|
| parse-vfsl.test.ts | 11 | 11 | 不变 |
| parse-vfsl-containers-markers.test.ts | 33 | 33 | 不变 |
| parse-vfsl-cycle-detection.test.ts | 16 | 16 | 不变 |
| parse-vfsl-errors.test.ts | 19 | 19 | 不变 |
| parse-vfsl-forbidden-matrix.test.ts | 79 | 79 | 不变 |
| parse-vfsl-jsdoc.test.ts | 7 | 7 | 不变 |
| parse-vfsl-r3-regression.test.ts | 7 | 7 | 不变 |
| parse-vfsl-sa7-supplementary.test.ts | 8 | 8 | 不变 |
| parse-vfsl-root-convention.test.ts | —（新增） | 34 | SA6 红灯正常在库 |

合计 180 + 34 = **214**，与 vitest 实测精确一致。`test(` 计数基线/HEAD 双双为 0（无隐藏 `test(` 形式用例）。`grep -rn '\.skip\|\.only\|\.todo' packages/vfsl/test/` **零命中**（grep EXIT=1）。零删除红线零触碰。

### 3.4 第 4 条：注册表 21 码 + 版本 ✅

- `errors.ts` ErrCode 注册表机械抽取：**21 键**（E100–E106 ×7 + E201–E203 ×3 + E301–E311 ×11）；`E310: '310'` / `E311: '311'` 恰在 `E309` 之后追加（errors.ts:31-32），头注释同步改写为 21 码口径（errors.ts:10）。
- 与 `docs/vfsl/v1-spec.md` 全文唯一码集合做 set 比对：spec 侧 21 码，**diff 逐码全等（21 ↔ 21 一一对应，零差集）**——AC 第 9 条闭环。
- `packages/vfsl/package.json`：`"version": "0.1.4"`（0.1.3 → 0.1.4 bump，Hard Gate #9）；`"dependencies"` 字段**不存在**（grep 计数 0，仅 devDependencies: typescript/vitest）——零运行时依赖红线保持。

### 3.5 第 5 条：R-4 探针（SA2 INFO-3 落实位）✅

临时探针（vitest，经公共接缝 `parseVfsl`，跑毕即删）实录两行输出：

```
[SA7-PROBE-1] parseVfsl("/** x */") => {"ok":false,"issues":[{"message":"VFSL-E305: 悬空文档注释：未紧邻可挂载的声明性节点（类型别名 / 属性 / 标记类型），且不相邻即不再挂载","line":1,"column":1}]}

[SA7-PROBE-2] parseVfsl("/** x */\ntype ROOT = {};") => {"ok":true,"module":{"kind":"vfsl-module","aliases":[{"kind":"alias","name":"ROOT","docs":[" x "],"type":{"kind":"object","fields":[]}}]}}
```

- 探针 1：悬空注释模块（无 ROOT）→ **E305@1:1**，非 E310——同位 (1,1) 并列争议经既有码号比较器 305 < 310 裁定 E305 胜出，与设计 §4.2 聚合规则一致。
- 探针 2（对照）：悬空注释 + `type ROOT = {}` → **ok:true**，doc（`" x "`）挂载到 ROOT 别名、E305 消失、ROOT 为 map 形通过——两条行为互为镜像，E305/E310 交互分层正确。

### 3.6 第 6 条：fuzz 确定性复核 + okTrue 实测计数 ✅

探针逐字复刻 `parse-vfsl-sa7-supplementary.test.ts` 的 fuzz 机制（mulberry32 / pickFrom / TOKENS 49 记号 / FIXTURES 7 条 + 固定后缀 `\ntype ROOT = {};` / `floor(rand()*121)`），双源计数实录：

```
[SA7-PROBE-3] 记号汤 okTrue=28 okFalse=2972 total=3000 (length===0 空汤 26 次)
[SA7-PROBE-4] fixture 变异 okTrue=48 okFalse=3567 total=3615
```

- **记号汤**（seed 20260819）：okTrue **28** ≥ 预期 26（其中空汤 `length===0` 恰 26 次，与 SA1/SA2/SA4 E10 声明精确一致；另 2 次为随机汤恰落合法输入）；okFalse 2972 > 0。**双支路触达** ✓。
- **fixture 变异/截断**（seed 62026081）：okTrue **48** ≥ 预期 5（7 条全前缀截断含 7 个完整 fixture，第 1–5 条确定性 ok:true 即 SA2 LOW-1 勘误口径的 ≥5 保底，另含 43 次变异/截断恰落合法）；okFalse 3567 > 0，total 3615 = 3000 变异 + 615 前缀。**双支路触达** ✓。
- 固定种子复跑计数稳定可复现；正式套件内两条 fuzz 用例断言（okTrue/okFalse 均 > 0、无抛异常、二态 union、E100 兜底通道不可达）已含于 214/214 全绿中。SA2 LOW-1 勘误（「≥5 完整 fixture 确定性 ok:true，6/7 条整条 ok:false 贡献负支路」）获运行时佐证。

### 3.7 第 7 条：TASK.md 修复确认 — 静态闭环（不重跑）

按总控指示由 SA4 R3 C1–C5 闭环：commit `5764401` diff 17 文件不含 TASK.md，TASK.md blob = 基线 `db2d979…` 精确恢复，17 文件与 R2 验尸对象逐字节 blob 全等。SA7 侧旁证：本轮 `git status` 工作区无 TASK.md 改动面。

---

## 4. 破坏性/补充性测试新增

无永久新增。SA4 §3 第 5 条明示 R-4 探针为「临时探针实录两行输出即可」口径，第 6 条为计数登记口径；R-4/R-4 对照行为已分别被 jsdoc 既有特例（`'type A = string; type ROOT = {};\n/** 悬空文档注释 */'`，SA4 E13 抽查核实）与红灯正例覆盖冻结。临时探针文件已删除，工作区零残留。

## 5. vitest 触发证据（HG14 — 2026-06-15 立法）

CI 现状：分支 `fix/issue-19-on-adr-union-representation` 尚未推送（`git ls-remote origin` 无该 ref，本地 ahead 1）——push、PR、CI 触发按简报 §七.1 全部由外部 `check.sh` 负责，SA7 不做任何远程操作、不宣称 CI 状态。故按 SA4 §3 第 1 条授权采用**本地等价命令实录**（CI `test` job 同命令 `pnpm test` = `vitest run`，ci.yml:38-39，SA4 E9 已核 include `packages/*/test/**/*.test.ts` 全覆盖无窄化；check.sh 推送后 CI 侧触发证据由总控跟踪补录）。

命令（worktree 根，独立后台进程）：`pnpm test`，**EXIT=0**

```
 Test Files  9 passed (9)
      Tests  214 passed (214)
```

Workspace package 归属（唯一业务包 `@nomicore/vfsl` = `packages/vfsl`，根 `nomicore@0.1.0` 仅 workspace 容器）：

| Workspace Package | 测试文件（vitest 实录 ✓） | 触发结果 | log 摘录 |
|---|---|---|---|
| @nomicore/vfsl（packages/vfsl） | parse-vfsl-sa7-supplementary.test.ts | ✓ 8 tests passed | ` ✓ packages/vfsl/test/parse-vfsl-sa7-supplementary.test.ts (8 tests) 718ms` |
| @nomicore/vfsl（packages/vfsl） | parse-vfsl-forbidden-matrix.test.ts | ✓ 79 tests passed | ` ✓ packages/vfsl/test/parse-vfsl-forbidden-matrix.test.ts (79 tests) 25ms` |
| @nomicore/vfsl（packages/vfsl） | parse-vfsl-containers-markers.test.ts | ✓ 33 tests passed | ` ✓ packages/vfsl/test/parse-vfsl-containers-markers.test.ts (33 tests) 23ms` |
| @nomicore/vfsl（packages/vfsl） | parse-vfsl-cycle-detection.test.ts | ✓ 16 tests passed | ` ✓ packages/vfsl/test/parse-vfsl-cycle-detection.test.ts (16 tests) 17ms` |
| @nomicore/vfsl（packages/vfsl） | parse-vfsl-errors.test.ts | ✓ 19 tests passed | ` ✓ packages/vfsl/test/parse-vfsl-errors.test.ts (19 tests) 11ms` |
| @nomicore/vfsl（packages/vfsl） | **parse-vfsl-root-convention.test.ts（SA6 红灯）** | ✓ 34 tests passed | ` ✓ packages/vfsl/test/parse-vfsl-root-convention.test.ts (34 tests) 20ms` |
| @nomicore/vfsl（packages/vfsl） | parse-vfsl-r3-regression.test.ts | ✓ 7 tests passed | ` ✓ packages/vfsl/test/parse-vfsl-r3-regression.test.ts (7 tests) 10ms` |
| @nomicore/vfsl（packages/vfsl） | parse-vfsl.test.ts | ✓ 11 tests passed | ` ✓ packages/vfsl/test/parse-vfsl.test.ts (11 tests) 14ms` |
| @nomicore/vfsl（packages/vfsl） | parse-vfsl-jsdoc.test.ts | ✓ 7 tests passed | ` ✓ packages/vfsl/test/parse-vfsl-jsdoc.test.ts (7 tests) 10ms` |

**触发结论**: ✅ all-vitest-packages-triggered — SA1/SA6 设计面全部 9 个 `*.test.ts`（均属 `packages/vfsl`）在 `vitest run` 下真实运行、全绿、零 skip；含本任务新增红灯文件 34 用例。

---

## 6. 环境阻塞与移交事项（交总控）

1. **CI 侧 HG14 触发证据待补录**：分支未推送，无 CI run。`check.sh` 推送建 PR 后，`test` job（`pnpm test`）的 `Test Files  9 passed (9)` 行可与本报告 §5 本地实录互为印证——属流程时序，非验证阻塞。
2. 工作区遗留任务档案面（dispatch.md 追加、sa4_review.md、本报告、`.mabf-bg/`）均为 wiki/运行时白名单面，不在 commit 内，无整形需求。

---

**Verdict**: **pass**（SA4 §3 第 1–6 条独立重跑全过：红灯 34/34 转绿 + 全量 214/214 + typecheck EXIT=0 + 零删除零触碰 + 21 码逐码全等 + 0.1.4 零依赖 + R-4 探针 E305@1:1 胜出 + fuzz 双支路触达计数登记；第 7 条 SA4 R3 静态闭环；HG14 本地等价触发证据在案，CI 侧由 check.sh 补录）
