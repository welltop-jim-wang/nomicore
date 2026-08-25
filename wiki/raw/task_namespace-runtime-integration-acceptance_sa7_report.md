# SA7 动态验证报告 — namespace-runtime 全链集成验收与阶段收口（issue #93）

- **Date**: 2026-08-25
- **Verdict**: **pass**
- **验证对象**: commit `2cf4879`（交付物本体）+ `2d5cd8e`（dispatch log 更新，wiki-only）；diff base = `73811cd`
- **验证环境**: 干净克隆 `/tmp/sa7-clean-93`（`git clone --branch fix/issue-93-on-docs-namespace-runtime --single-branch` @ `2d5cd8e`，与 worktree 工作树状态解耦——worktree 现存未提交改动仅为 wiki 档案两文件，零代码差异）+ 全新 `pnpm install --frozen-lockfile`（EXIT=0，557ms，pnpm store 缓存离线命中）
- **工具链**: pnpm 10.28.2 / vitest 3.2.7 / Node **v24.13.0**（`/usr/local/bin/node`）与 Node **v20.20.2**（`/home/wangjian/.n20/bin/node`）双版本
- **方法**: 全部测试命令独立进程（`setsid nohup … & disown` + 轮询 exit 文件）；本轮测试面零端口绑定（`grep -rlE '\.listen\(|createServer' packages/*/test/` 为空），无需 fuser 清场，亦无未知进程被杀（harness 自身 esbuild 服务 PID 603046 精确识别归属后保留）

---

## Step 0 — SA4 verdict 校对

`wiki/raw/task_namespace-runtime-integration-acceptance_sa4_review.md` L4：**`Verdict: pass`** → 进入 Step 1。

```
[SA7 Step 0 结论]
SA4 verdict: pass
操作: 进 Step 1
```

## Step 1 — SA6 三验收测试（干净环境实跑）

命令（干净克隆，Node 24）：

```bash
cd /tmp/sa7-clean-93 && pnpm exec vitest run packages/namespace-runtime/test/runtime-acceptance-*.test.ts
```

结果（`/tmp/sa7-acc.log`，EXIT=0）：

```
 ✓ packages/namespace-runtime/test/runtime-acceptance-exports-audit.test.ts (3 tests) 8ms
 ✓ packages/namespace-runtime/test/runtime-acceptance-degraded-two-adapter.test.ts (2 tests) 276ms
 ✓ packages/namespace-runtime/test/runtime-acceptance-fullchain.test.ts (3 tests) 349ms

 Test Files  3 passed (3)
      Tests  8 passed (8)
Type Errors  no errors
```

Node 20（v20.20.2）重复同命令：**同样 3 files / 8 tests 全绿，EXIT=0**（`/tmp/sa7-n20-acc.log`）。

```
[SA7 Step 1 结论]
SA6 红灯: 🟢 GREEN（干净环境双 Node 版本 8/8）
操作: 进入 Step 2
```

## Step 2 — §5 静态核对协议独立复跑（六组断言，base=73811cd，干净克隆）

| 断言组 | 命令 → 实测 | 判定 |
|---|---|---|
| 1 词汇收口（4 式） | ADR8 `RUNTIME_READ_DISABLED`=**1**（≥1）；CONTEXT.md 同码=**1**（≥1）；ADR8 `RUNTIME_WRITE_DISABLED`=**2**（≥2）；ADR8 `NSRT-CLOSE-RELEASE-FAILED`=**1**（≥1） | ✅ 4/4 |
| 2 追加式修订（3 式） | `git diff 73811cd -- docs/adr/0008-*.md \| grep -c '^-[^-]'`=**0**；ADR 0001–0007 触碰集=**空**；`docs/adr/` 变更集=**仅 0008 一个文件** | ✅ 3/3 |
| 3 卫生（2 式） | `git ls-files \| grep -cx '\.mabf-done'`=**0**；`git check-ignore .mabf-done`→exit 0（clone 与 worktree 均）；`git check-ignore .mabf`→worktree（目录存在）exit 0，干净 clone（目录不存在）需目录路径形 `.mabf/foo`→exit 0 | ✅（见下方注记） |
| 4 全绿（动态核心） | 见下节「§5 断言 4 动态执行记录」 | ✅ |
| 5 变更面 | `git diff 73811cd --name-only \| sort` = **恰 14 文件**（CONTEXT.md / ADR8 / .gitignore / .mabf-done 删除 / 3 验收测试 / 7 wiki 档案）——与 SA4 记录逐行一致，无越界 | ✅ |
| 6 穷尽性（3 式） | src 单引号码提取=**恰 13 码**，与期望 13 码 `comm` 双向差集**均为空**；ADR8 `released/disposed`=**1**（≥1）；CONTEXT `getStatus`=**1**（≥1） | ✅ 3/3 |

**断言 3 注记（环境差异，非缺陷）**：干净克隆中 `.mabf/` 目录不存在时，git 将裸路径 `.mabf` 按文件推断，目录型 pattern `.mabf/` 不命中（exit 1）；以目录内路径 `.mabf/foo` 检验即命中（`.gitignore:10:.mabf/`，exit 0）。worktree 中目录存在时裸路径直接命中。两行 ignore 规则（`.gitignore` L9/L10）确已随 2cf4879 入库且生效——断言实质成立。

### §5 断言 4 动态执行记录（干净环境）

| 命令 | Node | 结果（exit 码） |
|---|---|---|
| `pnpm test` | v24.13.0 | **`Test Files  90 passed (90)` / `Tests  1101 passed (1101)` / `Type Errors  no errors`**（EXIT=0，65.92s）——与 SA6 记录、设计 §5 期望逐字相符（87+3=90、1093+8=1101 算术自洽） |
| `pnpm typecheck` | v24.13.0 | **EXIT=0**（七包 tsc：vfsl/vfsl-protocol/vfsl-codegen/persistence/dsh-persistence/doc-runtime/namespace-runtime 零错误输出） |
| `pnpm test` | v20.20.2 | **`Test Files  90 passed (90)` / `Tests  1101 passed (1101)` / `Type Errors  no errors`**（EXIT=0） |
| `pnpm typecheck` | v20.20.2 | **EXIT=0**（链式于上，总体 EXIT=0） |

## SA4「动态审核重点」三条逐条核销

| # | SA4 要求 | SA7 动态证据 | 状态 |
|---|---|---|---|
| 1 | CI matrix Node 20 与 24 两格全绿（六步） | **本地对等复现全部六步**：Node 24 = typecheck + test（90/1101）+ persistence-contract（1 file/7 tests）+ domains-scaffold（1/2）+ materialize-root（1/59）+ regen-diff `pnpm generate --check` 全 EXIT=0（`/tmp/sa7-cisteps.log`）；Node 20 = test（90/1101）+ typecheck + 三验收测试全 EXIT=0。**GitHub Actions ubuntu-latest 真实 run 待 PR 建立**（`gh pr list --head fix/…` = `[]`，ci.yml `push` 仅 `main`、`pull_request` 任意——本分支 CI 需 PR 触发；SA7 职责不含 push/建 PR） | 本地闭环 ✅ / CI 观察期移交 Host |
| 2 | FilePersistence 真实磁盘用例可重复性（ENOTDIR 占位注入 + mkdtemp crash-restart） | 跨 4 次独立进程运行全绿：Node 24 单独跑（276/349ms）+ Node 24 全仓（310/344ms）+ Node 20 单独跑（293/345ms）+ Node 20 全仓（310/384ms）——真实 fs 语义（mkdir ENOTDIR、跨实例 loadDoc 恢复）在本机文件系统上确定性可重复 | ✅（runner 文件系统最终由 CI 期证） |
| 3 | exports-audit 跨 Node 版本键序稳定性 | `Object.keys(publicEntry).sort()` 断言在 v20.20.2 与 v24.13.0 双版本均绿（3/3 tests）——断言已 `.sort()`，实测双版本一致 | ✅ |

## vitest 触发证据（Hard Gate #14 — 2026-06-15 立法）

**触发条件成立**：SA1 设计 R2 §7 ALLOW LIST 含 3 个新增 `*.test.ts`（`runtime-acceptance-{fullchain,degraded-two-adapter,exports-audit}.test.ts`，`[SA6 owned]`）。

**CI Run**: 无——当前分支无 PR（`gh pr list` = `[]`），SA7 不 push/不建 PR；按下发指示以**本地全仓运行**为触发证据，GitHub CI run 证据留 Host 观察期补录。CI 静态面：`.github/workflows/ci.yml` test job（`pull_request` 触发、matrix node [20,24]、step `Test: pnpm test` = 根 `vitest run --typecheck`，`vitest.config.ts` include `packages/*/test/**/*.test.ts`）收集范围覆盖三个新文件，无孤儿测试。

全仓 `pnpm test` 运行输出（Node 24，`/tmp/sa7-fulltest.log`；Node 20 同数）：

```
 Test Files  90 passed (90)
      Tests  1101 passed (1101)
Type Errors  no errors
```

| Workspace Package | CI Step Name | 触发结果 | log 摘录 |
|---|---|---|---|
| namespace-runtime | Test（`pnpm test`，根 vitest 收集） | ✓ **20/20 包内测试文件全部触发且通过**（18 运行时 lane + 2 TS typecheck lane） | `Test Files  90 passed (90)`；`✓ packages/namespace-runtime/test/runtime-acceptance-fullchain.test.ts (3 tests)`、`✓ …degraded-two-adapter.test.ts (2 tests)`、`✓ …exports-audit.test.ts (3 tests)`、`✓  TS  …runtime-close-lifecycle-type-guard.test-d.ts (3 tests)`、`✓  TS  …runtime-replace-schema-type-guard.test-d.ts (1 test)` |
| 其余包（同 run 内对照） | 同上 | ✓ 70 文件全绿 | doc-runtime 17+2TS / vfsl 26 / persistence 9 / vfsl-codegen 6+1TS / vfsl-protocol 1+2TS / dsh-persistence 3 / domains/vfs3-assets 1+2TS（81 运行时 + 9 TS = 90） |

计数口径：18 个 `✓ packages/namespace-runtime/test/` 行（`grep -c`）+ 2 个 `✓  TS  packages/namespace-runtime` 行；三个新验收文件均在列。

**verdict**: ✅ all-vitest-packages-triggered（namespace-runtime 包 vitest 被全仓运行真实触发；CI runner 侧触发由 ci.yml 静态面 + Host 观察期补证）

**Step 3（E2E spec 门禁）**: N/A——本任务设计无任何 `*.spec.ts` 新增/改动。

## 补充核验

- **生产代码冻结属实**：断言 5 变更面 14 文件中 `packages/namespace-runtime/src/` 零文件；干净克隆（纯 HEAD）与 worktree 测试结果一致，排除「worktree 脏状态撑绿」可能。
- **无伪造红灯/绿灯**：SA6 记录「首次运行即绿（存量能力）」与 SA7 干净环境复跑一致；SA6 记录的两处 fixture 调试史不涉及实现改动（src 冻结自证）。
- **进程/端口卫生**：全部 5 个后台任务（install/acc/fulltest/tc/cisteps）均正常收敛（exit 文件 12:39–12:42 全 EXIT=0）；结束态无 vitest/tsc/pnpm 残留进程；`/tmp` 中 08-21 至 08-24 的旧 `sa7-*-exit` 文件属前序任务轮次，已按时间戳区分，未误读。
- **Node 20 来源**：`/home/wangjian/.n20/bin/node`（v20.20.2，满足根 package.json `engines.node >=20`）；本机 `/usr/bin/node` 为 v18.19.1（低于 engines 下限，未用作证据）。

## 最终判定

**Verdict: pass**

- SA4 pass 基础上独立动态验证未发现任何 fail：干净环境（全新克隆+全新安装）下 SA6 三验收测试 8/8 绿（双 Node 版本）、§5 六组断言全过（含动态断言 4 的 90/1101 + 七包 tsc 双 Node 全绿）、SA4 三条动态审核重点本地全部核销。
- 唯一开放项为 **GitHub Actions 真实 run（Node 20/24 两格、ubuntu-latest）**——需 PR 建立后触发，属 Host CI 观察期职责（SA4 报告同此界定），不构成本轮 fail 依据；本地已以同版本双 Node + 全六步 CI 对等复现将风险压到最低。
