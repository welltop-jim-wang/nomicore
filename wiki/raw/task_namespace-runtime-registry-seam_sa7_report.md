# SA7 动态验证报告 — namespace-runtime Registry 专用受限生产构造 seam（issue #109）

**Date**: 2026-08-25
**Verdict**: **pass**
**被验对象**: SA3 实现 commit `b233ea4`（worktree `/home/wangjian/nomicore-fix-issue-109`，branch `fix/issue-109-on-docs-namespace-registry`）+ SA7 补充性破坏测试（本报告 §5 新增 1 文件 4 it）
**输入**: 任务简报 / SA4 静态审核报告（verdict: pass，含「动态审核重点」3 条）/ SA6 红灯测试 2 文件 11 it
**执行环境**: 本地 Node v24.13.0（/usr/local/bin/node；仓内另一 node 为 18.19.1，低于 engines `>=20` 不可用于复现 matrix）；pnpm 10.28.2；gh 已登录（welltop-jim-wang）

---

## 0. Step 0/Step 1 结论

```
[SA7 Step 0 结论]
SA4 verdict: pass（sa4_review.md 顶部 Verdict 行原文：「**Verdict**: **pass**」）
操作: 进 Step 1

[SA7 Step 1 结论]
SA6 红灯: 🟢 GREEN（修绿达成）
操作: 进入 Step 2
```

Step 1 实跑（目标运行，2026-08-25 19:58）：

```
$ npx vitest run packages/namespace-runtime/test/runtime-registry-internal-seam.test.ts \
    packages/namespace-runtime/test/runtime-registry-internal-type-guard.test-d.ts

 ✓ packages/namespace-runtime/test/runtime-registry-internal-seam.test.ts (8 tests) 792ms
 ✓  TS  packages/namespace-runtime/test/runtime-registry-internal-type-guard.test-d.ts (3 tests)

 Test Files  2 passed (2)
      Tests  11 passed (11)
Type Errors  no errors
[exit 0]
```

## 1. 验证证据总表（全部真实运行，2026-08-25 19:58–20:10）

| # | 门禁（对应 CI `test` job step） | 命令 | 结果（实跑摘录） |
|---|---|---|---|
| D1 | SA6 红灯→绿灯复核 | `npx vitest run …/runtime-registry-internal-seam.test.ts …/runtime-registry-internal-type-guard.test-d.ts` | `Test Files 2 passed (2); Tests 11 passed (11); Type Errors no errors`，exit 0 |
| D2 | SA7 补充破坏测试（§5） | `npx vitest run …/runtime-registry-internal-sa7-dynamic.test.ts` | `Test Files 1 passed (1); Tests 4 passed (4)`，exit 0 |
| D3 | Test（全量 vitest） | `pnpm test` | `Test Files 96 passed (96); Tests 1150 passed (1150); Type Errors no errors`，exit 0 |
| G0 | Install dependencies | `pnpm install --frozen-lockfile` | `Done in 397ms`，exit 0（lockfile 与 0.1.5→0.1.6 bump 一致，无漂移） |
| G1 | Persistence contracts | `pnpm exec vitest run packages/persistence/test/persistence-contract.test.ts --typecheck --passWithNoTests=false` | `Test Files 1 passed (1); Tests 7 passed (7)`，exit 0 |
| G2 | Domain scaffolds check | `pnpm exec vitest run packages/vfsl/test/domains-scaffold.test.ts --passWithNoTests=false` | `Test Files 1 passed (1); Tests 2 passed (2)`，exit 0 |
| G3 | Materialize root tests | `pnpm exec vitest run packages/doc-runtime/test/materialize-root.test.ts --typecheck --passWithNoTests=false` | `Test Files 1 passed (1); Tests 59 passed (59)`，exit 0 |
| G4 | Generated projection freshness (regen-diff) | `pnpm generate --check` | exit 0（全量重生成与仓内生成物逐字节一致；git status 零残留） |
| G5 | Typecheck（逐包 tsc×7） | `pnpm typecheck` | exit 0 |
| G6 | 聚合类型面（含 SA7 新测试文件） | `pnpm exec tsc -p tsconfig.typecheck.json --noEmit` | exit 0 |

测试执行规范遵守情况：全部测试命令以后台独立进程执行（非 ACP session 内同步阻塞）；本任务为纯包级 vitest 面，无端口/服务占用（`fuser` 清场不适用），未盲杀任何进程。

## 2. SA4「动态审核重点」逐条闭环

### 重点 1：CI Node 20/24 双版本运行（P3 剩余面）——**本地半闭环 + CI 腿待推送（环境事实，移交总控）**

- **Node 24 腿（本地实跑闭环）**：上表 D1–D6/G0–G6 全部命令在本机 Node v24.13.0 下 exit 0——exports subpath 解析、包自引用、`--frozen-lockfile`、全量 vitest、四附加门禁在 Node 24 上全部真跑通过。
- **Node 20 腿（不可本地复现）**：本机唯一另一 Node 为 18.19.1（`/usr/bin/node`），低于仓 engines `>=20`，无法合规复现 Node 20。此为环境限制，非实现缺陷。
- **CI 现状（gh 实查，2026-08-25 20:05）**：commit `b233ea4`（full sha `b233ea4f2989b56e49f5ada7f5233d504ff6e77f`）**未推送**（`git status -sb`：branch ahead 1；远端无 `origin/fix/issue-109-on-docs-namespace-registry`）；`gh run list --limit 15 --json headSha` 逐一比对：无任何 run 的 headSha 等于本 commit；本分支无 PR（`gh pr list --head fix/issue-109-on-docs-namespace-registry` → `[]`）。父 PR #105 最新 CI run 32841894945 的 head 为 `a73136d`（早于/不含本 commit），其 test (20)/test (24) 均 SUCCESS 但**不构成本 commit 的证据**。
- **移交**：SA7 不负责 push/建 PR。总控推送后按以下命令摘录动态半环证据（对应 SA4 §1.4 静态半环）：

```bash
gh run list --branch fix/issue-109-on-docs-namespace-registry --limit 3
gh run view <run-id> --log --job="test (20)" 2>&1 | grep -E "runtime-registry-internal-seam.test.ts \(8 tests\)|runtime-registry-internal-type-guard.test-d.ts \(3 tests\)|Test Files.*passed|Generated projection freshness|Domain scaffolds|Materialize root|Persistence contracts" | head -20
# job="test (24)" 同款再跑一遍
```

### 重点 2：「pnpm generate --check 等四附加 CI 门禁」实跑闭环——**✅ 四门禁全绿（上表 G1–G4）**

- G1 Persistence contracts 7/7、G2 Domain scaffolds 2/2、G3 Materialize root 59/59、G4 regen-diff 零漂移，四者 exit 0——与 SA2 #5 静态判定「与本改动零交集」一致：本任务 diff 不触 domains/codegen/persistence/doc-runtime，门禁全绿属预期且实测确认无意外连锁。
- 附加复核：G0 `--frozen-lockfile` 安装 exit 0（确认版本 bump 不破坏 CI 安装步）；G5/G6 双类型面 exit 0。

### 重点 3：AC5 审计正则加固（裸 import / require / 非 TS 扩展名盲区）——**N/A（前瞻项，非本 ticket 验收面）**

SA4 已明确该项责任在切片 5/6（落地 Registry 前）。SA7 本轮未触碰该面，无新证据需求。

## 3. internal factory 产物的活链路行为（SA4 重点之行为面）

活链路通道：全部经真实 package specifier `@nomicore/namespace-runtime/internal` 动态 `import()`（与未来 Registry 生产消费方同一通道，非包内相对通道）。

### 3.1 SA6 套件活链路复跑（D1，全绿）

AC1/AC6（exports 键集恰 `['.','./internal']`、值导出恰一键、零 seam 泄漏）、AC2（compile spy 零调用 + 永不 resolve 的 p0Gate 零消费 + fault 哨兵零效果，P0 以真实 vfsl 编译结算 ready）、AC4 全链（构造即读→P0 队首→FIFO notify 严格按序 [1,2]→status 七键/十键面→close 同步 closing/同一 Promise/幂等/停接纳→跨实例落盘 n=20）、AC5（import 图审计 + 谓词自检 + 防空扫）——11/11 绿，与 SA4 E1 一致。

### 3.2 SA7 补充性破坏测试（新增文件，D2，4/4 绿）

文件：`packages/namespace-runtime/test/runtime-registry-internal-sa7-dynamic.test.ts`（4 it，全部经 internal specifier 活链路；AC5 审计的 SKIP_DIRS 含 `test`，本文件不构成边界违规）：

| # | 破坏性探测 | 实跑结果 |
|---|---|---|
| P1 | **V1 形状守卫透传 + INV-N4 零副作用**：`factory(null, notify)` → 同步 `TypeError`（`/seam 输入缺少 handle/`）；`factory(handle, 'not-a-function')` → 同步 `TypeError`（`/input\.notifyDirty 若提供必须是 function/`）；两次 throw 后 handle 仍 `ready`，随后正确构造→读 1→写 7→读 7→close→`released` 全链成立 | 🟢 4 断言组全过——throw 前置于入队、所有权未被错误消费、无残留队列副作用 |
| P2 | **V2 状态门透传 + 独占租约不可复活**：runtime close() 释放 handle 后，对同一 released handle 经 internal factory 二次构造 → 同步 loud `/HANDLE_NOT_USABLE/` 且 message 含 `/released/` | 🟢 通过——released 租约上无法建立第二个 Runtime/sequencer（ADR-0009 独占语义运行时半环） |
| P3 | **无缺省绑定降级**：`factory(handle, undefined)`（绕类型面的 JS 调用）构造可成立、读取正常，但 `mutateRoot` → `ok:false`，issue message 同时含 `RUNTIME_WRITE_DISABLED` 与 `notifyDirty 未绑定` | 🟢 通过——不存在「提交成功但永无 dirty 登记」的静默 no-op 持久化（SA4 §4「零降级」判定的行为锚） |
| P4 | **深导入绕行阻断**：运行时拼接 specifier 动态 `import('@nomicore/namespace-runtime' + '/src/internal.js')` → rejects（exports map 无 `./src/*` 子路径） | 🟢 通过——`./internal` 是唯一通道，SA4 §5 攻击面表的动态复核成立 |

### 3.3 全量回归（D3）

`pnpm test`：**Test Files 96 passed (96)；Tests 1150 passed (1150)；Type Errors no errors**，exit 0——补充测试与既有 95 文件零冲突（SA4 E3 为 95/1146，差值恰为本轮新增 1 文件 4 it）。

### 3.4 验证过程红→绿迭代记录（测试自身缺陷，非产品缺陷）

补充测试首版两处测试编写缺陷，均已修复后达标（记录以证验证回路真实）：

1. 字面量 `import('@nomicore/namespace-runtime/src/internal.js')` 被 vite transform 期静态解析 → 收集期炸整个文件（`resolveDeepImport` 栈）——改为运行时拼接 specifier，探针落回运行期 `rejects`。
2. `wr.issues[0].message` 触发 `noUncheckedIndexedAccess` TypeCheckError（tsconfig.typecheck.json 的 include 覆盖 `packages/*/test/**/*.ts`，.test.ts 也在类型检查项目内）→ 全量 run 曾 `Tests 1150 passed` 但 EXIT=1——改为 `issue?.message` 判空单读捕获后，全量 exit 0。

## 4. vitest 触发证据（verdict 升级 — 2026-06-15 立法）

**CI Run**: 待总控推送后生成（本 commit 未推送，见 §2 重点 1；下方为**本地全量实跑** `/tmp/sa7-full-test2.log` 原文摘录——本地实跑与 CI 同命令 `pnpm test`（根 `package.json` → `vitest run --typecheck`，include `packages/*/test/**/*.test.ts` + typecheck `*.test-d.ts`，无包过滤））：

```
$ pnpm test
 Test Files  96 passed (96)
      Tests  1150 passed (1150)
Type Errors  no errors

 ✓  TS  packages/namespace-runtime/test/runtime-registry-internal-type-guard.test-d.ts (3 tests)
 ✓ packages/namespace-runtime/test/runtime-registry-internal-seam.test.ts (8 tests) 212ms
 ✓ packages/namespace-runtime/test/runtime-registry-internal-sa7-dynamic.test.ts (4 tests) 60ms
 ✓ packages/namespace-runtime/test/runtime-acceptance-exports-audit.test.ts (4 tests) 4ms
```

| Workspace Package | 收集通道 | 触发结果 | 命中行摘录 |
|---|---|---|---|
| namespace-runtime（设计新增 `runtime-registry-internal-seam.test.ts`） | 根级 `pnpm test` include | ✓ 8 tests passed | `✓ packages/namespace-runtime/test/runtime-registry-internal-seam.test.ts (8 tests)` |
| namespace-runtime（设计新增 `runtime-registry-internal-type-guard.test-d.ts`） | typecheck include | ✓ 3 tests passed | `✓ TS packages/namespace-runtime/test/runtime-registry-internal-type-guard.test-d.ts (3 tests)` |
| namespace-runtime（演进 `runtime-acceptance-exports-audit.test.ts`） | 根级 include | ✓ 4 tests passed | `✓ packages/namespace-runtime/test/runtime-acceptance-exports-audit.test.ts (4 tests)` |
| namespace-runtime（SA7 补充 `runtime-registry-internal-sa7-dynamic.test.ts`） | 根级 include | ✓ 4 tests passed | `✓ packages/namespace-runtime/test/runtime-registry-internal-sa7-dynamic.test.ts (4 tests)` |

**verdict**: ✅ all-vitest-packages-triggered（本地实跑证据；三设计测试文件 + SA7 补充文件全部被根级 vitest 收集且全绿，不存在「测试存在但从未被触发」黑洞）。CI runner log 侧的同一证据按 §2 重点 1 移交总控推送后摘录——当前 CI 无机会触发的原因是 commit 未推送（环境事实），非 workflow 配置缺口（SA4 §1.4 静态门禁已确认 `test` job 的 `pnpm test` 覆盖该包且无包过滤）。

## 5. 产出清单

| 产物 | 位置 | 说明 |
|---|---|---|
| SA7 补充性破坏测试 | `packages/namespace-runtime/test/runtime-registry-internal-sa7-dynamic.test.ts` | 4 it（P1–P4，见 §3.2）；未提交，随本报告由总控收编 |
| 动态验证报告 | `wiki/raw/task_namespace-runtime-registry-seam_sa7_report.md` | 本文件 |

生产代码零改动（`git status`：仅 wiki 产物 + 上述测试文件）。

## 6. 结论

**Verdict: pass**

- SA4 verdict=pass 前置满足；SA6 红灯 11/11 修绿达成（Step 1 🟢）。
- SA4 动态审核重点 1（CI 双版本）：Node 24 腿本地全量实跑闭环；Node 20 腿受环境限制（本机无合规 Node 20）+ commit 未推送 → CI 腿移交总控（§2 给出推送后摘录命令），不构成本轮 fail 依据。
- SA4 动态审核重点 2（四附加门禁）：Persistence contracts / Domain scaffolds / Materialize root / generate --check 四门禁本地实跑全绿（G1–G4 exit 0），另附 frozen-lockfile 安装与双类型面复核全绿。
- internal factory 产物活链路：SA6 11/11 + SA7 补充 4/4 + 全量 96 文件 1150 用例零回归；四条破坏性探测（形状守卫透传/零副作用、released 租约不可复活、无缺省绑定 loud 拒绝、深导入阻断）全部实测通过。
- vitest 触发性：三设计测试文件 + 补充文件在根级全量 run 中全部命中且绿（§4 原文摘录）。
- 未发现任何需要在 SA3 侧修复的动态缺陷；无阻塞项；CI 观测（Node 20/24 matrix log 摘录）为唯一移交事项。
