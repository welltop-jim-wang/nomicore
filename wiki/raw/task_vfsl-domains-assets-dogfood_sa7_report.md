# SA7 动态验证报告 — domains/vfs3-assets 领域包 dogfood（issue #27，票 G）

- **Date**: 2026-08-21
- **任务类型**: 功能开发（Feature）—— 无 SA5 报告
- **run_id**: issue-27-1787257582-2987666
- **验证环境**: worktree `/home/wangjian/nomicore-fix-issue-27`（commit `7c49901` + SA6 staged 接线/测试），pnpm v10.28.2
- **执行方式**: 全部测试/命令走后台独立进程（`setsid nohup … & disown`），零前台阻塞；日志落 `/tmp/sa7-*.log`，退出码落 `/tmp/sa7-*-exit(s)`

## verdict: pass

---

## Step 0 — SA4 verdict 校对

`task_vfsl-domains-assets-dogfood_sa4_review.md:4` → `**Verdict**: **pass**` ✓ → 进 Step 1。

```
[SA7 Step 0 结论]
SA4 verdict: pass
操作: 进 Step 1
```

---

## Step 1 — SA6 红灯测试复跑（不读文档，先跑测试）

SA6 在案三红灯（任务简报 §SA6 红灯运行证据）逐条复跑：

| SA6 红灯锚 | 红灯态（2026-08-21 SA6） | SA7 复跑（2026-08-21） | 结果 |
|---|---|---|---|
| `pnpm exec vitest run domains/vfs3-assets --typecheck` | exit 1，3 文件全红 TS2307（包不存在） | **exit 0**：`Test Files 3 passed (3)` / `Tests 31 passed (31)` / `Type Errors no errors`（migration 6 + projection 19 + tsdoc 6） | 🟢 |
| `pnpm test`（全量） | 失败仅领域 3 文件，其余 27 文件绿 | **exit 0**：`Test Files 30 passed (30)` / `Tests 452 passed (452)` / `Type Errors no errors` | 🟢 |
| `pnpm generate --check`（无 flag） | exit 2「零领域集…请加 --allow-empty-domains」 | **exit 0**（种包后 regen-diff 空） | 🟢 |

```
[SA7 Step 1 结论]
SA6 红灯: 🟢 GREEN（三锚全转绿，真红→真绿，非伪绿——SA6 曾实测临时种包 452/452 绿后拆除，
本批绿灯运行于 SA3 正式 commit 7c49901 的产出之上，哈希见 Step 2-6 复绿证据）
操作: 进入 Step 2
```

---

## Step 2 — SA4 动态审核重点逐条兑现

### 重点 1：CI regen-diff（无 flag）exit 0 + Domain scaffolds check 实质化 ✅

**前提说明（证据口径）**：本分支尚未 push/发 PR——`gh pr list --head fix/issue-27-on-adr-vfsl-protocol` = `[]`，`gh run list --branch …` = 空，**无远端 CI run 可摘**。SA7 按 ci.yml 原文命令在 worktree 本地逐步复现 CI 五步骤（同一 shell 序列，后台进程，日志 `/tmp/sa7-ci-pipeline.log`），退出码序列 `0 0 0 0`（typecheck / test / scaffold / regen-diff）。远端 CI run 证据留待发布后由总控/Runner 的 CI 到绿流程兜底（`gh pr checks`）。

- **flag 摘除实核**：`grep -c "allow-empty-domains" .github/workflows/ci.yml` = **0**；ci.yml:50-51 现为
  `- name: Generated projection freshness (regen-diff)` / `run: pnpm generate --check`（无 flag），两处 TODO(#27) 已清。
- **regen-diff 本地复现**：`pnpm generate --check` → `tsx packages/vfsl-codegen/src/cli.ts --check` → **exit 0**（diff 空）。
- **Domain scaffolds check 实质化**：`pnpm exec vitest run packages/vfsl/test/domains-scaffold.test.ts --passWithNoTests=false` → **exit 0**，`Test Files 1 passed (1)` / `Tests 2 passed (2)`——种包后第一臂经 FileSchemaSource 接缝 `list()` 命中 `vfs3-assets@1` 并 `load` + `parseVfsl` 真校验（非空集 vacuous pass）。**实质化的动态反证见重点 4/6（探针 A/D）**：清空 domains/ → 回到「0 domain schemas found」notice 态；改一字节方言头 → 该臂**当场红**（dialect-mismatch）。check 在两种语义态间正确切换 = 非空转实锤。

### 重点 2：vitest 触发证据（1.4 动态确认）✅

`pnpm test`（= `vitest run --typecheck`，单根 config 全仓扫描，无 --filter 盲区）后台复跑输出摘录：

```
✓  TS  domains/vfs3-assets/test/vfs3-assets-migration.test-d.ts (6 tests)
✓  TS  domains/vfs3-assets/test/vfs3-assets-projection.test-d.ts (19 tests)
✓     domains/vfs3-assets/test/vfs3-assets-tsdoc.test.ts (6 tests)
…
Test Files  30 passed (30)
     Tests  452 passed (452)
Type Errors  no errors
```

领域三文件 31 tests 真跑真绿（非「存在但未触发」）；另以 SA6 原命令 `pnpm exec vitest run domains/vfs3-assets --typecheck` 独立复跑二次确认（exit 0，31/31）。完整每包清单见文末「vitest 触发证据」段落。

### 重点 3：frozen-lockfile 安装证据 ✅

- `pnpm install --frozen-lockfile` → **exit 0**：`Scope: all 5 workspace projects`（原 4 + 新领域包 = 5）/ `Lockfile is up to date, resolution step is skipped` / `Done in 389ms using pnpm v10.28.2`。
- **lockfile 与 package.json 一致性**：`pnpm-lock.yaml:21-34` `domains/vfs3-assets` importer 四项 devDeps 与 `domains/vfs3-assets/package.json` 逐项吻合——`@nomicore/vfsl: workspace:* → link:../../packages/vfsl`、`@nomicore/vfsl-protocol: workspace:* → link:../../packages/vfsl-protocol`、`typescript: ^5.9.3 → 5.9.3`、`vitest: ^3.2.4 → 3.2.7`。`--frozen-lockfile` 本身 exit 0 即「lockfile 与 manifest 一致」的机器证明（不一致时 pnpm 直接 ERR_PNPM_OUTDATED_LOCKFILE 拒装）。

### 重点 4：回归掩蔽防护反向探针（探针 A）✅

操作（可逆，`mv` 移出/移回）：

```bash
mv domains/vfs3-assets /tmp/sa7-probe-vfs3-assets   # domains/ 留空目录
pnpm generate --check                                # → GENEXIT=2
```

stderr 原文摘录：

```
vfsl-codegen: 零领域集：domains/ 不存在或为空——若 G 尚未落地属预期，请加 --allow-empty-domains；若非预期请检查 --domains 路径
 ELIFECYCLE  Command failed with exit code 2.
```

**摘旗后零领域 = 响亮 exit 2 在在场**——domains/ 被误删/改名时 CI regen-diff 步骤将红到底，回归掩蔽防护成立。同态下 scaffold check 复跑 = pass + 显式 notice「[domains-scaffold] 0 domain schemas found…」（设计内空集语义，F1 期形态，非静默——notice 落 CI 日志）。

还原与复绿：`mv /tmp/sa7-probe-vfs3-assets domains/vfs3-assets` → `pnpm generate --check` → **exit 0**。

### 重点 5：SA2 放行条件闭环确认 ✅

`gh api repos/welltop-jim-wang/nomicore/issues/comments/5362799602` 实查存在：

- **位置**：issue #46（`issue_url: …/issues/46`），id `5362799602`，created_at `2026-08-20T22:28:33Z`
- **标题**：「[issue #27 SA2 放行条件登记 · 规格轴 follow-up]」
- **登记内容三件套在案**：① §10 fixture 增补一条标记位 JSDoc；② 同步两份 §10 逐字副本（#32 vfsl-assets-fullchain-e2e / #21 validate-snapshot）；③ follow-up 落地时标记臂升级**位置感知断言** + 防空转守门。含回退方案 (b) 实测背景说明。

SA2 MEDIUM#1 的「合并前登记」放行条件 = **已闭环**，AC5 标记锚 emitter 侧证据缺口有登记号兜底，非无限期悬空。

### 重点 6：补充性/破坏性动态验证（探针 B/C/D，全部可逆 + 复绿）✅

| 探针 | 操作（均 1 字节） | 期望 | 实测 | 还原后复绿 |
|---|---|---|---|---|
| **B 源漂移** | schema.vfsl:31 `notes` → `notez`（sha256 `82e98fa1…` → `329e0c64…`） | `generate --check` 非 0 | **exit 1**：「--check 失败 — 生成物过期（diff 非空）：…/generated.ts」 | `git checkout` 还原（sha256 回到 `82e98fa1…93c69`）→ exit 0 ✓ |
| **C 生成物漂移** | generated.ts:10 注释 `vfs3.assets` → `vfs3.assetz` | `generate --check` 非 0 | **exit 1**：同响亮消息（全量重生成 diff 双抓在场） | 还原（sha256 回到钉死值 `fbe181f3…65ea`）→ exit 0 ✓ |
| **D 方言损坏** | schema.vfsl:1 `@lang: vfsl` → `yfsl` | scaffold 红 + generate 非 0 | scaffold **exit 1**（`Tests 1 failed \| 1 passed`，dialect-mismatch 当场红——实质化铁证）；generate **exit 2**（`SchemaSourceError [dialect-mismatch]: … id=vfs3-assets@1 path=…` 结构化响亮失败） | 还原 → scaffold exit 0 + generate exit 0 ✓ |

**全探针还原后终态复绿**（后台独立进程，`/tmp/sa7-final-regreen.log`）：

```
pnpm test            → exit 0 — Test Files 30 passed (30) / Tests 452 passed (452) / Type Errors no errors
pnpm generate --check → exit 0
Domain scaffolds check → exit 0 — Tests 2 passed (2)
```

`git diff --stat -- domains/vfs3-assets/` = 空（schema.vfsl / generated.ts 逐字节回到 commit 态，双 sha256 钉死值复核吻合）；worktree git status 与 SA7 开工前一致（仅 SA6 staged 三测试 + 接线三件 + wiki）。

### 重点 6 附：SA4 交办第 6 条（证据卫生存档）✅

知悉并存档：SA1 附录 C.5「7 个类型错误」计数不可复现（正确读数 = /tmp/wt-c 干净对照 **4 文件 / 32 失败**，SA4 已复核）；`/tmp/wt-b` 已被陈旧 install 污染——**SA7 本次全部探针均在 worktree 本体做可逆操作 + git 还原，未触碰 /tmp/wt-b**；C.5 措辞订正留后续票（LOW）。

---

## vitest 触发证据 (verdict 升级 — 2026-06-15)

CI Run: **不适用（分支未发布，无远端 run）**——证据为 worktree 本地按 ci.yml:39 原命令 `pnpm test` 的后台进程复跑（exit 0），日志 `/tmp/sa7-ci-pipeline.log`。远端 run 触发确认留待发布后 CI 到绿流程。

| Workspace Package | CI Step Name | 触发结果 | log 摘录 |
|---|---|---|---|
| domains/vfs3-assets | Test (`pnpm test`) | ✓ 3 files / 31 tests passed | `Test Files 3 passed (3) / Tests 31 passed (31)`（独立复跑：`vitest run domains/vfs3-assets --typecheck` exit 0） |
| packages/vfsl | Test (`pnpm test`) | ✓ 17 files / 356 tests passed | `✓ packages/vfsl/test/parse-vfsl-forbidden-matrix.test.ts (79 tests)` 等 17 文件全 ✓ |
| packages/vfsl-codegen | Test (`pnpm test`) | ✓ 7 files / 45 tests passed | `✓ packages/vfsl-codegen/test/generate-mapping-table.test.ts (13 tests)` 等 7 文件全 ✓ |
| packages/vfsl-protocol | Test (`pnpm test`) | ✓ 3 files / 20 tests passed | `✓ TS packages/vfsl-protocol/test/vfsl-protocol-projection.test-d.ts (16 tests)` 等 3 文件全 ✓ |

**每包测试文件清单**（`pnpm test` 单次全量输出抽取，30 文件 / 452 tests = 31+356+45+20 ✓）：

- **domains/vfs3-assets（3 文件 / 31）**：vfs3-assets-migration.test-d.ts(6)、vfs3-assets-projection.test-d.ts(19)、vfs3-assets-tsdoc.test.ts(6)
- **packages/vfsl（17 文件 / 356）**：validate-snapshot-sa7.test.ts(14)、parse-vfsl-sa7-supplementary.test.ts(8)、validate-snapshot.test.ts(35)、vfsl-assets-fullchain-e2e.test.ts(16)、evaluate-derived-schema.test.ts(37)、parse-vfsl-forbidden-matrix.test.ts(79)、schemasource-seam.test.ts(13)、parse-vfsl-containers-markers.test.ts(33)、evaluate-derived-docs-audit.test.ts(15)、parse-vfsl-root-convention.test.ts(36)、parse-vfsl-cycle-detection.test.ts(16)、parse-vfsl-jsdoc.test.ts(7)、evaluate-derived-docs-typecls.test.ts(8)、parse-vfsl-errors.test.ts(19)、parse-vfsl.test.ts(11)、domains-scaffold.test.ts(2)、parse-vfsl-r3-regression.test.ts(7)
- **packages/vfsl-codegen（7 文件 / 45）**：generate-discriminated-narrow.test-d.ts(6)、generate-cli-check.test.ts(3)、generate-protocol-import.test.ts(5)、generate-alias-collision-guard.test.ts(4)、generate-error-message-tail.test.ts(4)、generate-mapping-table.test.ts(13)、generate-discriminated-emission.test.ts(10)
- **packages/vfsl-protocol（3 文件 / 20）**：vfsl-protocol-empty-fail-closed.test-d.ts(3)、vfsl-protocol-projection.test-d.ts(16)、vfsl-protocol-empty-module.test.ts(1)

**verdict**: ✅ **all-vitest-packages-triggered**（4/4 workspace package 真跑真绿；领域三文件 31 tests 在列非「存在未触发」；静态接线 + 动态运行双重在场）

## Spec 触发证据 (verdict 升级 — 2026-06-09)

**不适用**：本任务 SA1 design 无新增/改动 `*.spec.ts`（纯 vitest 任务）。机器复核：`git diff --name-only origin/adr/vfsl-protocol...HEAD | grep '\.spec\.ts$'` = 空；`git ls-files 'domains/vfs3-assets/**' | grep '\.spec\.ts$'` = 空；仓内 E2E 形态为 vitest 全链测试（`vfsl-assets-fullchain-e2e.test.ts`，非 Playwright spec）。SA4 review §3 同标「1.3 E2E spec 自检：不适用」。

**verdict**: ⚪ not-applicable（无 spec 可触发，不构成 FAIL 事由）

---

## 结论

SA4 六条动态重点全数兑现：① regen-diff（无 flag）exit 0 + scaffold 实质化（含探针 D 动态反证）✓；② vitest 触发证据 30/452 全绿、领域三文件 31 tests 在列 ✓；③ frozen-lockfile exit 0 + lockfile/manifest 逐项一致 ✓；④ 反向探针：空 domains → exit 2 响亮失败、还原复绿 ✓；⑤ SA2 放行条件已登记（#46 comment-5362799602，gh 实查）✓；⑥ 三类一字节破坏探针（源漂移/生成物漂移/方言损坏）全部被现行门禁抓住（exit 1/1/2），全部可逆还原且终态 452/452 + regen-diff + scaffold 三重复绿 ✓。SA6 三红灯锚全部真转绿。无 REJECT 事由。

**最终 verdict: pass** — 建议总控进入发布流程（push + PR）；远端 CI run 的 regen-diff / vitest / frozen-lockfile 触发摘录由发布后 CI 到绿流程兜底复核。

verdict: pass — 最终结论（SA4 交办 6 条全兑现 + 破坏探针全被抓 + 还原复绿）
