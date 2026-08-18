# SA7 动态验证报告 — parseVfsl 最小端到端（issue #5）

**Date**: 2026-08-18
**验证对象**: commits `1664b8d`（SA3 实现）+ `01a67e3`（SA4 R-1/R-2 修复），分支 `fix/issue-5-on-refactor-docs-add-mabf-multi-repo-monito`
**验证输入**: SA4 R2 复审报告（verdict=pass）§四动态审核清单、任务简报 SA6 记录、SA6 三份落库测试（37 用例）
**验证方法**: 全部命令按 2026-05-08 立法后台独立进程（`setsid nohup`）执行；SA7 独立驱动探针
（`tsc` 编译至 `/tmp/sa7-verify/`，脚本不入 worktree——SA4 同款方法）直打公共接缝 `parseVfsl`，
**期望锚点全部由探针脚本内 Unicode 码点展开（`[...str]`）程序化推导，零手敲转录**。
本任务为纯进程内 parser（零运行时依赖、无服务/端口）——按 SA7 CLAUDE.md「不得盲用 `fuser -k`
清场」未做端口释放（无所需端口）。
**环境**: node v24.13.0 / pnpm 10.28.2 / vitest 3.2.7 / tsc 5.9.3（本地 node 版本命中 CI 矩阵 20/24 的 24 腿）

---

## Step 0 — SA4 verdict 校对（2026-06-13 立法）

```
[SA7 Step 0 结论]
SA4 verdict: pass（R2 复审，sa4_review.md 末行 **Verdict: pass**；
              R1 三项 reject 已经 01a67e3 处置并复审闭合）
操作: 进 Step 1
```

## Step 1 — 验收命令实测（后台独立进程，exit code 亲验）

```text
$ pnpm test          # setsid nohup 后台独立进程，/tmp/sa7-test.log
> nomicore@0.1.0 test /home/wangjian/nomicore-fix-issue-5
> vitest run

 RUN  v3.2.7 /home/wangjian/nomicore-fix-issue-5

 ✓ packages/vfsl/test/parse-vfsl-r3-regression.test.ts (7 tests) 8ms
 ✓ packages/vfsl/test/parse-vfsl-errors.test.ts (19 tests) 10ms
 ✓ packages/vfsl/test/parse-vfsl.test.ts (11 tests) 6ms

 Test Files  3 passed (3)
      Tests  37 passed (37)
TEST_EXIT=0

$ pnpm typecheck     # 同款后台独立进程，/tmp/sa7-tc.log
> nomicore@0.1.0 typecheck /home/wangjian/nomicore-fix-issue-5
> tsc -p packages/vfsl/tsconfig.json
TYPECHECK_EXIT=0（0 错误，零输出）
```

```
[SA7 Step 1 结论]
SA6 验收测试（红灯先行 → SA3 修绿）: 🟢 GREEN — 3 文件 37/37，typecheck 0 错
操作: 进入 Step 2
```

## Step 2 — SA4 动态审核清单逐项验证

> 双通道策略：(a) 落库测试随 37/37 全绿（vitest 实跑）；(b) SA7 独立探针不经测试断言、
> 直驱编译产物（`/tmp/sa7-verify/js/src/index.js`）复核同一行为——防「测试与实现共享同一
> 误读」。探针总结 **PASS=20 / FAIL=0**（/tmp/sa7-probe.log）。

### 1. R-1 星面字符（non-BMP 码点列）回归 → ✅ 通过

落库通道：`parse-vfsl-r3-regression.test.ts` 4 用例（describe「R3 R-1」）随 37/37 绿。
独立探针通道（期望列由 `[...str].indexOf('-')+1` 等码点展开程序化推导）：

| # | 输入 | 期望（码点推导） | 实际 | 结果 |
|---|---|---|---|---|
| 1a | `/*😀*/ type A = -1;` | E100@(1,16) | (1,16)，`VFSL-E100: 未知记号: -` | ✅ |
| 1b | `/*😀😀*/ type A = -1;` | E100@(1,17)（双星面累积） | (1,17) | ✅ |
| 1c | `type A = string //😀`（EOF 无换行） | E100@(1,20)（= 码点长 19+1） | (1,20) | ✅ |
| 1d | `/*中*/ type A = -1;`（BMP 对照） | E100@(1,16)（**必须不漂移**） | (1,16) | ✅ |
| 1e | `/*𠀀*/ type A = -1;`（U+20000，CJK Ext-B——SA4 清单外附加护栏） | E100@(1,16) | (1,16) | ✅ |
| 1f | `/*😀*/\ntype A = -1;`（附加护栏：漂移不得跨行泄漏） | E100@(2,10) | (2,10) | ✅ |

**结论**：tokenizer 两个注释扫描器（SA4 定位 tokenizer.ts:100-104 / :135-139）修复后按码点
推进成立；缺陷消除且未引入新行为差异。

### 2. R-2 E302 并集图边回归 → ✅ 通过

落库通道：`parse-vfsl-r3-regression.test.ts` 3 用例（describe「R3 R-2」）随 37/37 绿。
独立探针通道（互环版取自落库测试原文，锚 `A` 列由码点展开推导）：

| # | 输入 | 期望 | 实际 | 结果 |
|---|---|---|---|---|
| 2a | `type A = { a: A }; type A = string;` | E106@(1,15)（前体自环回边 min-position 胜出） | (1,15)，`VFSL-E106: 循环引用: A → A` | ✅ |
| 2b | `type A = { b: B };\ntype B = { a: A };\ntype A = string;`（判别输入） | E106@(2,15)（并集回边先于 E302 胜出） | (2,15) | ✅ |
| 2c | `type A = { a: A };`（单声明自环对照） | E106@(1,15) | (1,15) | ✅ |

**结论**：semantic.ts:96 按名累积（并集）成立；last-wins 缺陷消除（若仍在，2a 应误报
E302@(1,25)、2b 应误报 E302@(3,6)——均未出现）。

### 3. T1 深嵌套三档 + 深度计数判别 → ✅ 通过

构造：`'type A = ' + '{a:'.repeat(N) + 'null' + '}'.repeat(N) + ';'`；期望锚 = 第 101 个
`{` 的码点列（程序化计数 = 310，即预算 100 超限位）。

| 检查 | 实际 | 结果 |
|---|---|---|
| N=1000 / 5000 / 20000 各档 | 均不抛、单 issue `E100@(1,310)`；三档锚列 **[310,310,310] 与 N 无关**；耗时 2/3/7ms | ✅ |
| N=100 边界 | `ok:true` 且 `JSON.parse(JSON.stringify(module))` 与 module 深等（往返无损） | ✅ |
| 150 个浅层对象顺序声明 | `ok:true`（当前嵌套深度读法；若误按累计读法必红） | ✅ |
| 两万别名链（`type A0=string; … type A20000=A19999;`） | `ok:true`，114ms（迭代 DFS 不栈爆） | ✅ |

### 4. 兜底 catch 零命中 → ✅ 通过（判读标记 `VFSL-E100: 内部错误（意外异常）`，index.ts:46）

| 通道 | 语料 | 结果 |
|---|---|---|
| 4a 落库测试语料全量回放 | 从三份测试文件提取全部 `parseVfsl('…')` 字面量输入 **36 条**（仅提取输入重驱运行时，非对源码文本断言），逐条重驱编译产物 | 零逃逸异常、**零兜底命中**、返回形状合规（ok:true/module 或 ok:false/issues 且行列 1 起） ✅ |
| 4b SA7 自建对抗边界集 | 43 条（空串/纯空白/BOM/未闭合注释与字符串/非法转义/1e308/400 位数字/007/-0/孤立代理对 `\uD800`·`\uDFFF`/`\r\n`·孤立 `\r`/残缺记号/E101~E106 构造/切片外构造等） | 零逃逸异常、零兜底命中、形状合规 ✅ |
| 4c 契约外入参 | `parseVfsl(null)` / `parseVfsl(undefined)` | 不抛、结构化返回 `E100 内部错误（意外异常）@(1,1)`——**经兜底 catch 转化属设计 §15.4 预期路径**（崩溃边界转化，SA4 D4 同判），不计入零命中违规（§10.9 判读对象为字符串用例语料） ✅ |

补充论证：37 用例中凡断言具体错误码前缀（非 E100）或精确锚点者，若实现意外走兜底必红
（兜底消息码位固定 E100、锚固定 (1,1)）；37/37 绿 + 4a 全量回放双确认。

### 5. R-2 微观资源项（SA4 R2 §四.4，低优先非验收） → 观测记录

`type A = { x: A };` × 20000（同名 K 次重复声明且每声明带边，并集累积最坏形态）：
**耗时 1420ms / heapUsed 84MB / 输出 E106@(1,15)（首个回边 min-position，正确）/ 单 issue /
零兜底**——与 SA4 实测（1439ms / 44MB）同量级，有界无崩溃。维持 SA4 判定：不构成回流项。

### 6. E2E spec 触发门禁（Step 3，2026-06-09 立法） → 不适用

全仓 `find -name '*.spec.ts'`（排除 node_modules）= **0 个文件**。本任务只有 `*.test.ts`
（vitest），走下节 Step 4 门禁。

---

## vitest 触发证据 (verdict 升级 — 2026-06-15 立法)

### CI 侧如实说明（不得伪造 CI 日志）

```text
$ gh run list --branch fix/issue-5-on-refactor-docs-add-mabf-multi-repo-monito --limit 5
（空输出，EXIT=0）
$ gh pr list --head fix/issue-5-on-refactor-docs-add-mabf-multi-repo-monito
（空输出，EXIT=0）
```

该分支**尚无任何 GitHub Actions run、尚无 PR**——PR 由外部 check.sh 流程在 SA 链收尾后创建，
SA7 无 push/建 PR 职责（CLAUDE.md 边界）。故 CI runner 侧的动态日志**本轮不可得**，
`✓ 触发且通过（CI）`分类留待 PR 建立后的流水线确认，不以静态推断冒充。

### 证据采用：workflow 静态接线 + 本地全量运行

| 链路环节 | 证据（SA7 本轮亲验，非转抄） |
|---|---|
| 新增 `*.test.ts` | `packages/vfsl/test/parse-vfsl.test.ts`（11）、`parse-vfsl-errors.test.ts`（19）、`parse-vfsl-r3-regression.test.ts`（7）——`find` 全仓枚举确认仅此 3 个测试文件 |
| 所在 workspace package | **`@nomicore/vfsl`**（`packages/vfsl/package.json` name 字段）——全仓唯一 workspace package（`ls packages/* apps/*`：apps/ 不存在） |
| vitest include | 根 `vitest.config.ts:5` `'packages/*/test/**/*.test.ts'` → 3 文件全部命中 |
| 根 script | 根 `package.json` `"test": "vitest run"`（无 --filter，根级全仓收集） |
| CI workflow 静态接线 | `.github/workflows/ci.yml` 为全仓唯一 workflow；`test` job 触发于 `push: main` + 全部 `pull_request`（ci.yml:3-7），矩阵 node **[20, 24]**（ci.yml:18），步骤 `pnpm install --frozen-lockfile`（:33）→ `pnpm typecheck`（:36）→ **`pnpm test`（:39）**。PR 一旦建立，`pull_request` 触发即覆盖 3 文件（include 无包过滤，无 CI 黑洞路径） |
| typecheck 侧 | `packages/vfsl/tsconfig.json` include 含 `test/**/*.ts` → 3 文件同受类型检查（本轮 tsc 0 错） |
| **本地运行动态确认** | 本机 node v24.13.0（命中矩阵 24 腿）`pnpm test`（后台独立进程）实际收集执行 **3 文件 37 用例，全绿**：`Test Files 3 passed (3)` / `Tests 37 passed (37)`，逐文件 `✓ packages/vfsl/test/…(N tests)` 摘录见 Step 1 |

| Workspace Package | CI Step Name | 触发结果 | 证据 |
|---|---|---|---|
| `@nomicore/vfsl` | `Test`（`pnpm test`，node 20/24 矩阵） | ⏳ CI run 待 PR 建立（本轮无 run 可查，如实说明）；**本地等价命令全绿** | `Test Files 3 passed (3)` / `Tests 37 passed (37)`（本地 vitest 3.2.7 / node 24） |

**verdict**: ✅ all-vitest-packages-triggered（静态接线完整 + 本地实跑收集执行全量测试文件；
CI runner 侧日志留待 PR 建立后由总控/收尾关确认——非 `vitest-package-not-triggered` 形态，
不存在「测试文件不在 runner 收集范围」的黑洞路径）

---

## 产物与边界说明

- **未新增测试文件**：SA4 R2 §四清单的 R-1/R-2 回归已由 SA6 落库
  `parse-vfsl-r3-regression.test.ts`（7 用例）持久承担；T1/T14/T2 级深嵌套与长链项按 SA4 R2
  §五归属 **SA6 积压**（非阻塞），SA7 本轮以独立探针完成动态验证（证据如上），不越 SA6
  拥有域落新文件（亦避免重复 SA4 §三已指出的 ALLOW LIST 记账粒度缺口）。
- **未修改任何业务代码**（`src/` 零触碰）；探针与压力脚本均在 `/tmp/sa7-verify/`，不入 worktree。
- 工作区遗留（`TASK.md`、`.mabf-bg/`、wiki 两文件改动）系总控/前序 SA 流程产物，SA7 未触碰。

## 总结

SA4 R2 §四动态审核清单全部验证通过：R-1 星面码点列回归（6 独立断言 + 落库 4 用例）、
R-2 E302 并集回归（3 独立断言 + 落库 3 用例）、T1 深嵌套三档 + 深度计数判别 + 两万链、
兜底 catch 零命中（36 条语料回放 + 43 条对抗边界，零命中零逃逸）、R-2 资源微观项有界。
验收命令 37/37 绿 + typecheck 0 错（后台独立进程亲验）。CI 侧无 run 可查已如实说明，
以静态接线 + 本地全量运行为证据，未伪造任何 CI 日志。未发现新缺陷，无回流项。

---

**Verdict: pass**
