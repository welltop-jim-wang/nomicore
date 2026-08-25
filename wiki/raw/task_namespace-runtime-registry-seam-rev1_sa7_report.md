# SA7 动态验证报告 — issue #109 Round 2 修订轮（registry-seam 审计强化）

**Date**: 2026-08-25
**Verdict**: **pass**（本地动态验证域全绿 + 注错反演证明门禁非纸面绿；CI 侧 vitest 触发证据 **blocked-on-publish**——SA3 commit `8b8dcfd` 尚未 push，属 Host 发布职责，见「vitest 触发证据」段）
**被验对象**: SA3 commit `8b8dcfd`（HEAD，worktree `/home/wangjian/nomicore-fix-issue-109`）——共享审计 helper + 白名单收窄 + 旧 AC5 弱正则块删除 + SA6 资产（19 it 探针 + 19 文件 fixture 树）
**验证基线**: SA4 verdict **pass**（`task_namespace-runtime-registry-seam-rev1_sa4_review.md` L4）+ 其「动态审核重点」4 项清单
**执行环境**: Node v24.13.0 / pnpm 10.28.2 / vitest 3.2.7；全部测试按 2026-05-08 立法以 `setsid nohup` 独立后台进程执行（本任务为纯文件系统/AST 测试，无端口/服务面，无需 fuser 清场；日志留痕 `/tmp/sa7-*.log`）

---

## [SA7 Step 0 结论]

SA4 verdict: **pass**（sa4_review.md L4 原文 `**Verdict**: **pass**`）
操作: 进 Step 1+（SA4 已过关，SA7 独立动态验证）

## 一、rev1 19 it 探针活链路（Run A）🟢

```bash
$ pnpm exec vitest run packages/namespace-runtime/test/runtime-registry-internal-seam-rev1.test.ts \
    packages/namespace-runtime/test/runtime-registry-internal-seam.test.ts --typecheck
 ✓ packages/namespace-runtime/test/runtime-registry-internal-seam.test.ts (5 tests) 431ms
 ✓ packages/namespace-runtime/test/runtime-registry-internal-seam-rev1.test.ts (19 tests) 398ms
 Test Files  2 passed (2)
      Tests  24 passed (24)
Type Errors  no errors
（exit 0；Node 24.13.0 独立进程）
```

- rev1 19/19 绿 = 10 RAC1 探针（8 绕过形态 + 控制组 + 防空扫）+ 3 RAC2 集成 + 4 谓词矩阵 + 2 真实门禁，fixture 树活链路全部命中。
- seam 5/5 绿 = AC1/AC6（3 it：exports 键集 / 运行时导出面 / 零 seam 泄漏）+ AC2（1）+ AC4（1）——旧 AC5 弱正则块（3 it）已随 8b8dcfd 删除，存留锚点零破坏（逐 it 标题核对）。

## 二、注错反演——真实全仓门禁非纸面绿（核心证据）🔴→🟢

**方法**：向真实生产树临时注入 3 个 `[SA7-DIAG]` 违规文件（全部为**新增未跟踪文件**，零修改既有生产代码），驱动默认 roots 门禁，预期变红；随后删除并复跑，预期复绿、工作树零残留。

注入形态（三个探针覆盖三个独立判定轴）：

| 注入文件 | 形态 | 判定轴 |
|---|---|---|
| `packages/persistence/src/sa7-probe-violation.ts` | 副作用导入 `import '@nomicore/namespace-runtime/internal'` | RAC1 形态① + 非 Registry 路径 deny |
| `packages/persistence/src/sa7-probe-carrier.js` | `require('@nomicore/namespace-runtime/internal')` | RAC1 形态⑤ + **.js 生产载体**（真实树，非 fixture） |
| `packages/namespace-registry/src/testing/sa7-probe-case.ts` | 具名导入于 Registry 前缀下 `testing/` | RAC2 非生产目录段收窄（真实树） |

**证据 1（helper 直驱，tsx）**：

```
[SA7-DIAG] prodFiles=72          ← 基线 69（=SA4 P5）+ 注入 3，扫描真实发生
[SA7-DIAG] importers=["packages/namespace-registry/src/testing/sa7-probe-case.ts",
  "packages/persistence/src/sa7-probe-carrier.js","packages/persistence/src/sa7-probe-violation.ts"]
[SA7-DIAG] violators=[同上 3 项]  ← 全部检出且全部判违规
```

**证据 2（vitest 门禁 it 本身变红）**：

```
× RAC1 真实全仓门禁 … > 真实全仓：internal subpath 的生产代码消费方 ⊆ 白名单（violators 为空）
→ AssertionError: internal subpath 只允许 Registry 生产代码消费；违规消费方：
  packages/namespace-registry/src/testing/sa7-probe-case.ts,
  packages/persistence/src/sa7-probe-carrier.js,
  packages/persistence/src/sa7-probe-violation.ts: expected [ …(3) ] to deeply equal []
 Tests  1 failed | 18 passed (19)   （exit 1）
```

**证据 3（清理复绿 + 零残留）**：删除 3 文件（含空目录 `namespace-registry/src/testing` 递归清除）后：
- `git status --short` = 回到注入前原状（仅既有 `M REPORT.md` / `M …_dispatch.md` / `?? …_sa4_review.md` 三项，`git ls-files --others packages/` 空）；
- 复跑 rev1：`Tests 19 passed (19)` / `Type Errors no errors` / exit 0。

**结论**：门禁在真实仓（默认 roots = 仓根 + 顶层白名单 {packages,domains,apps}、relPath 带 `packages/` 顶层段使谓词可达——P7 活链路）下逐形态真实判红，fixture 探针与真实门禁共用同一实现且互相独立（注入期间 18 个 fixture 侧 it 保持绿）。**非纸面绿成立。**

## 三、全量 pnpm test（Run B）🟢

```
 Test Files  97 passed (97)
      Tests  1166 passed (1166)
Type Errors  no errors
   Duration  97.24s   （exit 0）
```

与 SA4 P3 存档值（97 文件/1166 tests）逐值一致；rev1/seam 计入其中（97 = 96 存量 + rev1；1166 含 rev1 19 + seam 5）。

## 四、typecheck 双面（Run C）🟢

| 面 | 命令 | 结果 |
|---|---|---|
| C1 逐包（CI `Typecheck` step 同款） | `pnpm typecheck`（7 包 tsc 链） | exit 0 零输出 |
| C2 聚合（RAC3） | `pnpm exec tsc -p tsconfig.typecheck.json --noEmit` | exit 0 零输出（含 helper 类型面，TS2307×2 消解） |

## 五、四附加门禁（Run D，CI step 逐一本地复跑）🟢

| CI Step | 命令 | 结果 |
|---|---|---|
| Persistence contracts | `pnpm exec vitest run packages/persistence/test/persistence-contract.test.ts --typecheck --passWithNoTests=false` | Test Files 1 passed / Tests 7 passed / exit 0 |
| Domain scaffolds check | `pnpm exec vitest run packages/vfsl/test/domains-scaffold.test.ts --passWithNoTests=false` | 1 passed / 2 passed / exit 0 |
| Materialize root tests | `pnpm exec vitest run packages/doc-runtime/test/materialize-root.test.ts --typecheck --passWithNoTests=false` | 1 passed / 59 passed / exit 0 |
| Generated projection freshness | `pnpm generate --check` | exit 0（全量重生成逐字节 diff 零漂移） |

## 六、SA4 动态审核重点逐条回复

| # | SA4 重点 | SA7 动态结论 |
|---|---|---|
| 1 | vitest 触发证据（CI Node 20/24 双腿） | **blocked-on-publish**：`8b8dcfd` 未 push（`origin/fix/issue-109-on-docs-namespace-registry` = `0a4d460`），CI run 不存在 → 见下段专述，非 `vitest-package-not-triggered` 判红（run 尚未发生，触发面已被 SA4 §1.4 静态证明 + 本地活链路替代覆盖） |
| 2 | `import ts from 'typescript'` + `import.meta.url` 跨 Node 版 | Node 24 腿：本报告全部运行即活证据（helper 为新增消费点，24/24 + 97/1166 全绿）。Node 20 腿本地不可得（本机仅 v24.13.0 与 v18.19.1，后者低于 engines `>=20` 不构成合法代理）；**同款 import 链先例** `domains/vfs3-assets/test/vfs3-assets-tsdoc.test.ts` 在 Round 1 CI run 32847873290 **Node 20 与 Node 24 两腿日志均实跑绿**（见下段摘录），vitest 变换链对该 import 形态的跨版本行为有真实 CI 先例；rev1 自身 Node 20 腿待 push 后 CI 兑现 |
| 3 | 真实门禁前瞻锚（切片 5/6） | 本轮 `真实全仓 violators=[]` it 绿（Run A/B 双确认）；注错反演证明该 it 对生产树新增消费**真实敏感**（红/绿双向闭环）——切片 5/6 落地首个真实 Registry 消费方时，此 it 即 P7 实测兑现点，锚点有效非摆设 |
| 4 | （可选）别名 require 规避暴露面 | 活探针（/tmp 树，仓外零足迹）：`require('…')` 检出 ✓；`const req = require; req('…')` 与 `module.require('…')` **漏检** —— 与 SA4 发现 #3 一致，属性访问族已入设计 §D-B 残差清单，别名赋值族建议 SA1 后续轮补登（对抗性场景，非本轮义务，不阻塞） |

## vitest 触发证据（2026-06-15 立法）—— ⚠ blocked-on-publish

**事实链（gh 实测）**：
- 本地 HEAD = `8b8dcfd`，`origin/fix/issue-109-on-docs-namespace-registry` = `0a4d460` → SA3 修订 commit **未 push**（发布属 Host，SA7 不 push）。
- PR #116（OPEN，headRef = 本分支）唯一 CI run `32847873290`（pull_request 事件，head_sha `0a4d460`，2026-08-25T12:29，`test (20)`/`test (24)` 双腿 SUCCESS）——该 run 时间上先于 `8b8dcfd` 存在，**结构上不可能**包含 rev1 测试文件（其 `Test` step 日志中 seam 文件为 `(8 tests)` = Round 1 形态）。

**Round 1 run 双腿 log 摘录（先例证据，证明矩阵腿格式与 import 链跨版本）**：

```
test (20) job 97801701946: ✓ domains/vfs3-assets/test/vfs3-assets-tsdoc.test.ts (6 tests) 48ms
                                 Test Files 100 passed (100) / Tests 1184 passed (1184)   ← 合并基（含 clock）
test (24) job 97801701652: ✓ domains/vfs3-assets/test/vfs3-assets-tsdoc.test.ts (6 tests) 40ms
                                 Test Files 100 passed (100) / Tests 1184 passed (1184)
```

| Workspace Package / 文件 | CI Step | 触发结果 | 说明 |
|---|---|---|---|
| namespace-runtime（含 `runtime-registry-internal-seam-rev1.test.ts`） | Test (`pnpm test`，无 filter) | ⚠ blocked（commit 未 push，run 不存在） | SA4 §1.4 静态证明 include 命中 + 本地 24/24 活链路绿；push 后 CI 必然收集（vitest 无 filter 全仓跑） |

**push 后复核清单（交总控/Host）**：

```bash
gh run list --branch fix/issue-109-on-docs-namespace-registry --limit 2
# 取新 run id 后双腿各摘：
gh api repos/welltop-jim-wang/nomicore/actions/jobs/<job-id>/logs | grep -aE "seam-rev1|Test Files|Tests  "
# 预期双腿均出现：✓ packages/namespace-runtime/test/runtime-registry-internal-seam-rev1.test.ts (19 tests)
```

**verdict**: ⚠ blocked-on-publish（非 ❌ vitest-package-not-triggered——不存在「应在 runner 列表而缺席」的 run；触发面经静态 + 本地双面证明）

## 环境事实与前瞻风险（交总控）

1. **PR 基线已前移（合并基差异）**：`origin/docs/namespace-registry`（`a73136d`）较 merge-base `3451eca` 新增 `packages/clock`（含 4 个测试文件）且根 `package.json` typecheck 链增第 8 包——CI pull_request 检出合并基，故 Round 1 run 的 Typecheck step 已是 8 包、全量为 100 文件/1184 tests（本地分支面为 7 包/97 文件/1166）。**逐文件比对：基线前移改动与 `0a4d460..8b8dcfd` diff 零交集**（comm -12 空输出）→ push 后合并基 CI 预计无冲突自动合并，clock 包测试与本轮改动无交互。
2. 本机无 Node 20（v18.19.1 低于 engines 不合法）→ Node 20 腿只能由 CI 兑现（同款 import 链先例已在 Round 1 双腿绿，风险低）。
3. 聚合 typecheck 面（C2）仍非 CI step（SA4 发现 #4 同观察）——属仓级既有属性，后续轮评估，非本轮 ALLOW。

## 结论

- RAC1（逐形态捕获）：fixture 探针 19/19 活链路绿 + **真实树注错反演 3/3 判红**（副作用导入 / `.js` 载体 require / `src/testing/` 收窄三轴独立验证）。
- RAC2（白名单收窄）：谓词矩阵 + 集成探针绿 + 真实树 `testing/` 段 deny 反演红。
- RAC3（全量门禁）：`pnpm test` 97/1166 + 逐包 typecheck + 聚合 tsc + 四附加门禁全绿；CI 双腿证据 blocked-on-publish（事实链 + 复核清单已交）。
- **SA7 verdict: pass**（本地动态验证域）；CI 兑现义务随发布移交 Host，附可执行复核清单。

## 复核命令存档（全部可重现，日志 /tmp/sa7-*.log）

```bash
cd /home/wangjian/nomicore-fix-issue-109
pnpm exec vitest run packages/namespace-runtime/test/runtime-registry-internal-seam-rev1.test.ts \
  packages/namespace-runtime/test/runtime-registry-internal-seam.test.ts --typecheck   # 24/24, exit 0
# 注错反演（红）：在 packages/persistence/src 注入副作用导入/.js require、packages/namespace-registry/src/testing/
#   注入具名导入 → 同命令 exit 1，violators 列 3 项；删除后复跑 exit 0（见 §二）
pnpm test                                   # 97/1166, exit 0
pnpm typecheck                              # exit 0
pnpm exec tsc -p tsconfig.typecheck.json --noEmit   # exit 0
pnpm exec vitest run packages/persistence/test/persistence-contract.test.ts --typecheck --passWithNoTests=false
pnpm exec vitest run packages/vfsl/test/domains-scaffold.test.ts --passWithNoTests=false
pnpm exec vitest run packages/doc-runtime/test/materialize-root.test.ts --typecheck --passWithNoTests=false
pnpm generate --check                       # exit 0
git rev-parse HEAD                          # 8b8dcfd（未 push：origin 分支 = 0a4d460）
```
