# SA7 动态验证报告 — Parser 容器与标记类型（Issue #6）

**Date**: 2026-08-19
**Worktree**: `/home/wangjian/nomicore-fix-issue-6`（分支 `fix/issue-6-on-refactor-docs-add-mabf-multi-repo-monito`，SA3 commit `49e90a2`，基线 `4e7dfe2`）
**验证输入**: 任务简报（§七 SA6 红灯记录）｜SA4 静态验尸报告「动态审核重点」清单（4 条）｜SA1 设计 §11 登记的 SA7 动态验证位｜SA6 红跑原始日志 `/tmp/sa6-red-run.log`
**执行规范**: 全部测试命令经 `setsid nohup` 独立后台进程运行、轮询取果（ACP session 内零同步阻塞，共三轮全量）。本任务为进程内纯函数库测试、不占用任何端口——按 SA7 CLAUDE.md 端口约束（精确识别归属、不盲用 `fuser -k` 清场），未执行无端口的端口清场。

---

## Step 0 — SA4 verdict 校对（2026-06-13 立法）

```
[SA7 Step 0 结论]
SA4 verdict: pass（sa4_review.md 末行 **Verdict**: pass）
操作: 进 Step 1
```

## Step 1 — SA6 红灯测试运行（第二关）

- 测试文件：`packages/vfsl/test/parse-vfsl-containers-markers.test.ts`（33 条）
- 本地全量 `pnpm test`（独立后台进程，SA3 交付状态基线轮）→ exit 0：

```
 ✓ packages/vfsl/test/parse-vfsl-containers-markers.test.ts (33 tests) 37ms
 ✓ packages/vfsl/test/parse-vfsl-errors.test.ts (19 tests) 11ms
 ✓ packages/vfsl/test/parse-vfsl-r3-regression.test.ts (7 tests) 7ms
 ✓ packages/vfsl/test/parse-vfsl.test.ts (11 tests) 7ms
 Test Files  4 passed (4)
      Tests  70 passed (70)
```

```
[SA7 Step 1 结论]
SA6 红灯: 🟢 GREEN（简报 §7.4 的 25 条红灯全数转绿；8 条绿锁与 #5 既有 37 条零破坏）
操作: 进入 Step 2
```

## Step 2 — SA4「动态审核重点」清单逐条验证

### 重点 1 — vitest 触发证据（Hard Gate #14）→ ✅ 通过

按总控指令：**PR 由外部 check.sh 创建、CI 跟踪属 issue-runner 职责**，SA7 不轮询 CI；本项以本地全量独立进程运行的实际收集执行输出为证据（详见文末「vitest 触发证据」段）——SA3 交付基线 4 文件 70 用例全绿 + `pnpm typecheck` 0 错误；SA7 补充测试加入后复跑 5 文件 78 用例全绿 + typecheck 仍 0 错误。SA4 登记的 ci.yml（node 20/24 双矩阵）实测记录属 issue-runner 跟踪面，非 SA7 本轮可达面。

### 重点 2 — CI 环境资源界复核 → ✅ 本地实测记录（CI 实测归 issue-runner）

对设计 §11 登记的 SA7 资源界验证位逐条实测（vitest verbose reporter 对永久测试套逐条计时，与 CI 同管线；本地 node v24.13.0）：

| 用例（设计登记位） | 本地实测 | 设计 R4 期登记参考 | 对 vitest 默认 5s 超时边际 |
|---|---|---|---|
| T-l 20k 裸引用链 + Record 键（§11.1） | 656ms（首轮 482ms / 全量轮 668ms，三次同量级） | ~330ms | ≈7.6× |
| T-R2-4 k=40 E302 双体链（§11.3） | 5ms | ~4ms | >1000× |
| T-R2-5 k=21 同构链 + `<1s` 断言（§11.3） | 2ms（断言实际通过） | 1.6ms | — |

方法说明（如实记录）：原计划以 `/tmp` Node type-stripping 探针计时，因源码 `.js` 后缀 specifier 无法被 Node ESM 解析（`ERR_MODULE_NOT_FOUND: tokenizer.js`）放弃；改由 vitest verbose reporter 从永久测试套逐条实测——证据贴 CI 真实命令管线，效力不弱于独立探针。CI runner 实测耗时留 issue-runner 记录；本地最慢用例 656ms 对 5s 默认超时边际 ≈7.6×，且三次运行稳定同量级。

### 重点 3 — fuzz 烟雾（可选加固）→ ✅ 已固化为永久补充测试

新增 `packages/vfsl/test/parse-vfsl-sa7-supplementary.test.ts` 的 fuzz 段（确定性种子 PRNG mulberry32，无 Math.random/Date，可复现）：

- **记号汤 3000 组**（0..120 记号随机拼接，字母表含六标记精确拼写 + `yleaf`/`YLEaf`/`ymap`/`YMAP` 变体 + 字面量 + 结构符 + 空白 + 中文字符）；
- **fixture 变异 3000 组**（截断/删字符/插字符/片段复制 1..3 步）+ **7 个合法 fixture 的全部前缀截断**（系统性覆盖 EOF/残缺输入面）；
- 断言：`parseVfsl` 永不抛异常；返回恒为 PRD #3 冻结二态 union；`ok:true` 支 module JSON 无损往返；`ok:false` 支 issues 非空、message 匹配 `/^VFSL-E\d{3}: /`、line/column 整数且 ≥1；**顶层兜底通道（`VFSL-E…: 内部错误`，index.ts 最终防线）不可达**——命中即实现缺陷；两侧支路均须真实触达（防全落一侧的空转烟雾）。
- 结果：全绿（389ms / 440ms），无一条抛异常、无一条触达兜底通道。

### 重点 4 — 外部对照（对应 SA4 LOW-3）→ ✅ 比对通过

SA6 红跑原始日志可得：`/tmp/sa6-red-run.log`（2026-08-18 23:29，`Test Files 1 failed | 3 passed (4)` / `Tests 25 failed | 45 passed (70)`，与简报 §7.4 逐字一致）。程序化比对（标题集 diff）：

- 25 条失败用例标题 **25/25 全部存在于现测试文件**（唯一显示差异为源码字面量 `\\d` 与运行时标题 `\d` 的转义假象，已逐条人工核实为同一条）；
- 8 条绿锁（AC3 五个 E100 反例、YLEaf E301、变体可声明为普通别名、裸标记 E100）全部在场；
- 现文件 `it()` 总数 33，与简报 §7.1 登记一致。

结论：SA3 未弱化/改名/删除任何 SA6 断言——LOW-3（单 commit 压缩无法用 git 历史分辨）的旁证补强完成。

---

## SA7 补充测试（本任务新增产物）

**文件**: `packages/vfsl/test/parse-vfsl-sa7-supplementary.test.ts`（8 条用例，全绿）：

| # | 用例 | 来源登记位 | 断言要点 |
|---|---|---|---|
| 1 | T-l 20k 裸引用链 + Record 键 | 设计 §11.1 / SA2 #7 | `ok:true` + IR JSON 往返（栈安全回归，无 RangeError/挂起） |
| 2 | T-R2-4 k=40 E302 双体深链（82 行） | 设计 §11.3 / SA2 N3 | 有限时间返回 `ok:false` 单一 issue `E302@(2,6)` |
| 3 | T-R2-5 k=21 同构链 | 设计 §11.3 | 同码同位 + 耗时 `<1s` 断言（防大输入凑巧线性） |
| 4 | T-R3-2 声明序不变性（2/3 行互换） | 设计 §11.4 / SA2 M2 | 两模块同报 `E304@YMap@(1,10)` 且消息全文一致 |
| 5 | T-R4-1 容器介导环 | 设计 §11.4 / SA2 R4-1 | 错误身份归还 `E106@A@(2,15)`，不误报 E304@YMap |
| 6 | T-R4-2 容器介导环 + 环外嵌套 ref | 设计 §11.4 | 同上（D 不入分量池） |
| 7 | fuzz 记号汤 3000 组 | SA4 动态重点 #3 | 见 Step 2 重点 3 |
| 8 | fuzz 变异/截断 3000 组 + 全前缀 | SA4 动态重点 #3 | 同上 |

过程如实记录：首版触发仓库严格模式（`noUncheckedIndexedAccess`）14 个 tsc 错误（索引访问 `T | undefined`），已按既有测试同款受检模式修复（`pickFrom` 受检取元素）；修复后最终轮全绿。断言锚点全部按 Unicode 码点口径与设计 §11 红线表逐位核对（E302@(2,6)、E304@(1,10)、E106@(2,15) 等）。

**改动面与红线自查**:

- 仅新增上述测试文件与本报告；未触碰 `src/` 生产代码（SA3 职责）、未改动 4 个既有测试文件、未动 tokenizer.ts/index.ts/v1-spec.md/配置文件。
- 零运行时依赖红线：测试仅 import vitest 与 `../src/index.js`，`packages/vfsl/package.json` 未动。
- 版本号（HG9）：本任务变更窗口内 SA3 已 bump `0.1.1 → 0.1.2`（commit `49e90a2`），SA7 仅增测试文件、随同一 PR 交付，不再二次 bump。
- 测试内无 `readFileSync`、无源码文本形状断言（SA4 §1.7 禁令延续），全部经 `parseVfsl` 运行时行为。

## Step 3 — E2E spec 触发证据

不适用：本任务无任何 `*.spec.ts`（SA4 §三.1 同结论，vitest `*.test.ts` 是唯一测试形态）。

---

## vitest 触发证据 (verdict 升级 — 2026-06-15)

CI Run: N/A——PR 由外部 check.sh 创建、CI 跟踪属 issue-runner 职责（总控指令，SA/总控均不轮询 CI）。本段以**本地后台独立进程全量运行的实际收集执行输出**为证据摘录（Hard Gate #14 本地动态门禁口径）。

| Workspace Package | 验证命令（本地独立进程） | 触发结果 | log 摘录 |
|---|---|---|---|
| `@nomicore/vfsl` | `pnpm test`（= 仓库根 `vitest run`，include `packages/*/test/**/*.test.ts`）——SA3 交付基线 | ✓ Test Files 4 passed (4)，Tests 70 passed (70) | 4 个测试文件名逐一收集执行（见下原文） |
| `@nomicore/vfsl` | `pnpm test`——SA7 补充测试加入后（最终轮） | ✓ Test Files 5 passed (5)，Tests 78 passed (78) | 5 个测试文件名逐一收集执行（见下原文） |
| `@nomicore/vfsl` | `pnpm typecheck`（= `tsc -p packages/vfsl/tsconfig.json`） | ✓ 0 错误（exit 0，两轮均验） | `tsc` 无输出退出 0 |

基线轮原文摘录（SA3 交付状态，4 文件 70 用例）：

```
 ✓ packages/vfsl/test/parse-vfsl-containers-markers.test.ts (33 tests) 37ms
 ✓ packages/vfsl/test/parse-vfsl-errors.test.ts (19 tests) 11ms
 ✓ packages/vfsl/test/parse-vfsl-r3-regression.test.ts (7 tests) 7ms
 ✓ packages/vfsl/test/parse-vfsl.test.ts (11 tests) 7ms
 Test Files  4 passed (4)
      Tests  70 passed (70)
```

最终轮原文摘录（SA7 补充测试加入后，5 文件 78 用例）：

```
 ✓ packages/vfsl/test/parse-vfsl-sa7-supplementary.test.ts (8 tests) 1482ms
 ✓ packages/vfsl/test/parse-vfsl-containers-markers.test.ts (33 tests) 21ms
 ✓ packages/vfsl/test/parse-vfsl-errors.test.ts (19 tests) 13ms
 ✓ packages/vfsl/test/parse-vfsl.test.ts (11 tests) 8ms
 ✓ packages/vfsl/test/parse-vfsl-r3-regression.test.ts (7 tests) 8ms
 Test Files  5 passed (5)
      Tests  78 passed (78)
```

**verdict**: ✅ all-vitest-packages-triggered（唯一 workspace package `@nomicore/vfsl` 的全部 `*.test.ts`——基线 4 个、补充后 5 个——均被 `vitest run` 实际收集执行且全绿；typecheck 双轮 0 错误）

---

## 审核结论

1. SA6 红灯转绿：✅ 70/70（25 红全转绿、8 绿锁与 #5 37 条零破坏）
2. SA4 动态审核重点 4 条：✅ 全过（vitest 触发证据本地兑现 / 资源界本地实测 7.6×~1000× 边际 / fuzz 烟雾 6000+ 随机组 + 全前缀截断零抛错零兜底 / SA6 红跑日志外部对照 25/25 一致）
3. 补充测试：✅ 8 条全绿（设计 §11 SA7 动态验证位 + fuzz 固化，锚点逐位核对）
4. SA4 三项 LOW 发现：LOW-1（设计文档示例不可达，回流 SA1）与 LOW-2（声明序报告位漂移系登记行为）无行为面影响、与本轮无关；LOW-3 已由外部对照补强闭合
5. 独立发现的 fail：无——SA7 未发现 SA4 pass 基础上的新缺陷

**Verdict**: pass
