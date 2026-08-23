# SA7 动态验证报告 — rev1 硬化实现（readLogicalValueAtPath union value-first 仲裁）

**Date**: 2026-08-22
**Verdict**: **pass**
**被验对象**: SA3 实现 commit `c4c2c73`（read.ts NavOutcome 三态 + union value-first 仲裁 + doc-runtime 0.1.3）+ SA4 护栏 commit `ec98e45`（hardening 测试 3 例）
**SA4 静态验尸**: `wiki/raw/task_read-logical-value-at-path_rev1_sa4_review.md` — **verdict: pass**（Step 0 校对通过，本报告在其基础上独立动态验证）
**验证基线**: worktree HEAD `ec98e45`（branch `fix/issue-75-on-docs-doc-runtime-validation`）

---

## Step 0 — SA4 verdict 校对

- SA4 报告顶部第 4 行：`**Verdict**: **pass**` → 允许进入动态验证。

## Step 1 — SA6 红灯测试

**N/A**：本任务为纯 vitest 单测包（doc-runtime），diff 无任何 `*.spec.ts` / E2E 接线；SA6 红灯测试不存在，替代为下述 vitest 全量触发（§vitest 触发证据）。

---

## Step 2 — SA4「动态审核重点」4 项逐条验证

### 重点 #1 CI 触发证据（硬门禁 #14 动态半边）— ⚠ 环境阻塞（rev1 未 push），本地全量触发证据替代

**阻塞事实（精确归属）**：

- 本地 HEAD = `ec98e45`（含 rev1 两 commit `c4c2c73`/`ec98e45`）；`origin/fix/issue-75-on-docs-doc-runtime-validation` = `8eed7f4`（rev1 前基线）——`git branch -r --contains c4c2c73` / `--contains ec98e45` 均为空，**rev1 commits 尚未 push**（push 属 runner 职责，SA7 不越权）。
- 分支最新 CI run `32565381747`（2026-08-22T09:36Z，conclusion: success）headSha = `8eed7f4` = **rev1 前基线**——该 run 的测试日志结构性不可能含两个 rev1 测试文件。
- 另：`gh run view 32565381747 --log --job=<id>` 对两矩阵 job 均返回空输出（exit 0、无日志行）——该 run 的逐行日志经 API 不可取得；但 job 步骤元数据可取得（见下）。

**CI 接线可达部分（动态）**：`gh api .../actions/jobs/97013151234` 确认双矩阵 job `test (20)` / `test (24)` 各含步骤 `Typecheck`（#6）与 `Test`（#7，09:36:43→09:38:34，~111s）均 conclusion: success——`pnpm test`（root `vitest run --typecheck`，include 通配 `packages/*/test/**/*.test.ts` 覆盖 `packages/doc-runtime/test/**`）在 CI 真实执行且通过；rev1 前基线（58 文件 821 例）绿。

**本地全量触发证据（替代，按既有先例标注「环境阻塞待 runner push 后复核」）**：

```
$ pnpm test   # worktree HEAD ec98e45，探针还原后、H-c 追加前
 ✓ packages/doc-runtime/test/read-logical-value-at-path-rev1-union-arbitration.test.ts (18 tests) 23ms
 ✓ packages/doc-runtime/test/read-logical-value-at-path-rev1-hardening.test.ts (3 tests) 10ms
 Test Files  59 passed (59)
      Tests  824 passed (824)
 Type Errors  no errors
 exit 0
```

两个 rev1 文件在 root 级全量触发列表内**逐文件出现**（18 tests / 3 tests，计数与 SA4 声明一致）。**待 runner push rev1 commits 后，CI 双矩阵 job 的 `Test` 步骤日志应出现同两行 + `Test Files 59 passed` / `Tests 828 passed`**（824 + 本报告 H-c 追加 4 例，见重点 #3）。

### 重点 #4 全量基线对账 — ✅ 精确吻合

- SA4 §4 对账口径：合并后全仓 58/821 + 1 文件 3 例 = **59 文件 / 824 例**。
- 本轮本地实测（H-c 追加前）：`pnpm test` → **59 文件 / 824 例全绿 exit 0** —— 与 SA4 对账**逐位吻合，无测试丢失**。
- 本轮产物 H-c 追加 4 例后终态：**59 文件 / 828 例全绿 exit 0**（见 §产物），后续对账以此为准。

### 重点 #2 H-a 红侧量级抽验（SA4 标注可选）— ✅ 已实证，红灯真实触发

受控探针（worktree 内临时禁用 `resolveLive` 的 memo 命中 early-return（read.ts:287-288，模拟 memoB 丢失），跑单文件后立即 `git checkout` 还原）：

```
$ npx vitest run .../read-logical-value-at-path-rev1-hardening.test.ts --testTimeout=180000   # memo 命中禁用
 ❯ ...rev1-hardening.test.ts (3 tests | 1 failed) 7882ms
   ✓ H-b 绿灯锁：mixed missing+reject 反序 … 4ms
   × H-a 成本护栏 … 中段缺席：live 嵌 x×24 后缺 x … 7876ms
     → expected 7871.430623 to be less than 2000
   ✓ H-a 成本护栏 … 正向对照 … 1ms
 VITEST-EXIT:1
```

- **红灯形态**：恰 1 例红（中段缺席用例），断言 `elapsed < 2000ms` 失败于 **7871ms ≈ 2^24 次成员试探**（~0.46μs/次）——量级与 SA4 修正 1 的「缺口置第 25 层 → 2^24 级回潮红灯才真实触发」预言**定量吻合**（若按 SA2 原案缺口第 13 层仅 2^12 ≈ 4×10³ 次试探，毫秒级不转红——修正必要性得证）。
- **旁证**：正向对照（成员 0 直达真值、无回潮路径）与 H-b 在无 memo 下仍绿——红灯精确锚定 D17 新增试探面的 memo 摊销，无误伤。
- **还原验证**：`git checkout -- packages/doc-runtime/src/read.ts` 后 md5 与原版逐字节一致（`535b37e6…`）、`git diff --stat -- packages/` = 0 行；复跑 hardening 3/3 绿 exit 0。生产代码零残留。

### 重点 #3 H-b/mixed 与嵌套 union 在 vitest 上下文复现 — ✅ 对偶复跑绿 + 发现并补齐嵌套 union 库内缺口（H-c）

**(a) R4-3 + H-b 对偶复跑（同断言集）**：

```
$ npx vitest run .../rev1-union-arbitration.test.ts .../rev1-hardening.test.ts -t "mixed"
 ✓ ...rev1-union-arbitration.test.ts (18 tests | 17 skipped) 6ms   ← R4-3：{foo?}|{bar}（missing 先）
 ✓ ...rev1-hardening.test.ts (3 tests | 2 skipped) 6ms             ← H-b：{bar}|{foo?}（reject 先）
 Tests  2 passed | 19 skipped (21)   exit 0
```

两向均 missing 胜 → `ok:true` + value 键显式存在且 undefined——「循环遇 reject 提前终止」与「见 reject 即整体 reject」两类漂移的对偶检测力在 vitest 上下文确认在位。

**(b) 嵌套 union —— 发现：测试库内无 union 直接嵌 union 的行为锚**（grep `嵌套` 于 `packages/doc-runtime/test/`：命中全为嵌套容器/嵌套 Y.Map 语义；SA4 §3 的嵌套 union 5 例为 tsx 探针、未入库）。tsx 临时探针（worktree 零改动，用后即删）四形态实测与 SA4 静态声明逐条吻合后，固化为补充测试 **H-c-1..H-c-4** 追加入 hardening 文件（SA4/SA7 owned、设计 §8.1 ALLOW LIST 内文件，不新开文件）：

| 用例 | 形态 | 探针实测 | vitest 锚 |
|---|---|---|---|
| H-c-1 | 子 union 产 value → 外层首 value 胜 | `{"ok":true,"value":"v"}` | ✓ 7/7 绿 |
| H-c-2 | 子 union mixed（missing）+ 外层 reject → missing 上浮胜 | `{"ok":true}` + value 键显式 undefined | ✓ |
| H-c-3 | 子 union 全 reject 不短路外层循环 → 后序成员 value 胜 | `{"ok":true,"value":"v"}` | ✓ |
| H-c-4 | 全员 reject → PATH_NOT_ALLOWED（message 逐字） | `{"ok":false,"code":"PATH_NOT_ALLOWED",…}` | ✓ |

追加后 `npx vitest run .../rev1-hardening.test.ts` → **7 tests passed（3 原有 + 4 H-c）**，Type Errors: no errors；全仓终态 59 文件 / 828 例全绿 exit 0。

---

## Step 3 — E2E spec 触发证据

**N/A**：本任务 diff 无 `*.spec.ts`（纯 vitest 单测包），SA4 §1.3 同裁定。

## vitest 触发证据 (verdict 升级 — 2026-06-15 / 硬门禁 #14)

**CI Run**: https://github.com/welltop-jim-wang/nomicore/actions/runs/32565381747（**⚠ 该 run headSha=8eed7f4 为 rev1 前基线，且其逐行日志经 `gh run view --log` 不可取得——环境阻塞，待 runner push rev1 commits 后复核**）

| Workspace Package | CI Step Name | 触发结果 | 证据摘录 |
|---|---|---|---|
| @nomicore/doc-runtime | Test (`pnpm test`，job `test (20)` id 97013151234 / `test (24)` id 97013151158) | ⚠ 环境阻塞待 runner push 后复核（CI 接线动态确认：两 job `Test` 步骤 #7 均执行且 success，~111s） | job API：`{"name":"test (20)","steps":[…,{"name":"Test","conclusion":"success",…}]}`；run headSha `8eed7f4` ≠ rev1 |
| @nomicore/doc-runtime | （本地替代证据）`pnpm test` @ HEAD `ec98e45` | ✓ Test Files 59 passed (59) / Tests 824 passed (824)（H-c 追加前）→ 828 passed（追加后），exit 0 | `✓ packages/doc-runtime/test/read-logical-value-at-path-rev1-union-arbitration.test.ts (18 tests)`、`✓ packages/doc-runtime/test/read-logical-value-at-path-rev1-hardening.test.ts (3 tests)`（追加后 `(7 tests)`）、`Type Errors  no errors` |

**verdict**: ⚠ **vitest-package-triggered（本地全量实证）+ CI 侧环境阻塞待 runner push 后复核**——非 `vitest-package-not-triggered`：触发接线经 root `vitest.config.ts` 通配（静态）+ CI Test 步骤执行（动态）+ 本地全量逐文件触发行（替代）三重确认；阻塞原因唯一且明确（rev1 commits 未 push），无测试丢失。

---

## 极端攻击补充（技能 §5 精神下的增量动态面）

- **memo 三态哨兵安全性**（H-a 红侧探针的副产品）：禁用 memo 命中后 H-b/mixed 用例仍 4ms 绿——三态 outcome 对象作 memo 值不引入行为差异；恢复后全绿。
- **H-c-4 reject 形态锁**：嵌套全员 reject → `code:'PATH_NOT_ALLOWED'` + `path:['x','a']` + message 措辞 `路径无法在 live 数据上解析（不变量外输入）`（与修订前逐字一致，D6 冻结确认）。

---

## 产物

| 产物 | 位置 | 说明 |
|---|---|---|
| 动态验证报告（本文件） | `wiki/raw/task_read-logical-value-at-path_rev1_sa7_report.md` | 总控 |
| 补充测试 H-c（嵌套 union 三态上浮 4 例） | `packages/doc-runtime/test/read-logical-value-at-path-rev1-hardening.test.ts`（追加 describe 块，3→7 例） | CI、后续 SA4 |

生产代码零改动（探针已还原并 md5 验证）；临时探针脚本/备份均已删除。

---

## 结论

SA4 交验的 4 项动态重点全部落地：#1 CI 侧因 rev1 未 push 属环境阻塞（阻塞原因与复核条件已明确标注，本地全量逐文件触发证据替代）；#4 全量基线 59/824 与 SA4 对账精确吻合；#2 H-a 红灯侧定量实证（7871ms > 2s，恰 1 例红、无误伤、还原零残留）；#3 R4-3+H-b 对偶 vitest 复跑绿，并独立发现嵌套 union 库内行为锚缺口、以 H-c 4 例补齐（全绿）。SA7 未发现任何 fail 证据；观测等价护栏（120→124 例）与全量 828 例全绿。

**Verdict = pass（CI 触发证据一项环境阻塞待 runner push 后复核，非实现缺陷）。**
