# SA7 动态验证报告 — doc-runtime：复用 detached builder 并原子替换 ROOT 内容（issue #88）

**Date**: 2026-08-23（Phase 3，SA3 commit `bbf4e5a` 后；branch `fix/issue-88-on-docs-namespace-runtime`）
**Verdict**: **pass**（SA4 pass 基础上独立动态验证：SA6 红灯转绿 + SA4 三条动态审核重点全部闭合；F-2 对抗边界活链路双 Node 复证与 SA4 结论一致（非本任务引入、普通 JSON 输入不可达）；未发现 SA4 静态结论之外的任何缺陷。CI 动态触发证据因分支未 push 无 run 可查——按 materialize-root-rev2 SA7 先例以本地同命令双 Node 证据替代，CI 面 deferred 至 push 后 runner 核验，不构成阻塞）

**被验对象**: commit `bbf4e5a`（8 文件：package.json + src 6 + test 1；base `origin/docs/namespace-runtime` = 74b9cfd）
**验证环境**: 本机 ubuntu / Node **v24.13.0**（系统默认）+ Node **v20.20.2**（`n` 安装至 `/tmp/sa7/n`，不触碰系统默认）/ yjs 13.6.32（lockfile）+ 13.6.30（漂移 scratch）
**验证方法**: 全部命令独立进程（`setsid nohup ... & disown`），一次性对抗探针跑毕即删（源码备份 `/tmp/sa7/sa7-f2-probe.test.ts.bak`，仓内零残留——`git status` packages/ 干净已核）

---

## Step 0 — SA4 verdict 校对

SA4 报告顶部（第 4 行）：**`Verdict: pass`** → SA7 进入动态验证（不上发不下发：本报告仅在 SA4 pass 基础上独立给出结论，未发现可下调事项）。

## Step 1 — SA6 红灯测试运行

- 文件：`packages/doc-runtime/test/replace-root-content.test.ts`（13 用例 / G1–G7）
- 命令（独立进程）：`pnpm exec vitest run packages/doc-runtime/test/replace-root-content.test.ts`（日志 `/tmp/sa7/step1.log`，exit code 文件 `/tmp/sa7/step1-exit`=0）
- 结果：

  ```
  ✓ packages/doc-runtime/test/replace-root-content.test.ts (13 tests) 31ms
  Test Files  1 passed (1)
       Tests  13 passed (13)
  Type Errors  no errors
  ```

**[SA7 Step 1 结论] SA6 红灯: 🟢 GREEN（13/13，exit 0）→ 进入 Step 2。**（红灯基线见简报：13 failed / `replaceRootContent is not a function`，本轮全绿即实现闭环。）

---

## Step 2 — SA4 动态审核重点逐条验证

### 必做 #1 — F-2「①→② 稳定化双读发散」活链路复核（Node 24 + Node 20 各一）✅

一次性对抗探针（vitest 临时文件 `packages/doc-runtime/test/sa7-f2-probe.test.ts`，跑毕即删），4 用例：

| 用例 | 断言面 | Node 24.13.0 | Node 20.20.2 |
|---|---|---|---|
| P-1 发散前提 | hostile Proxy 第 1 次 ownKeys `['title','count']` vs 第 2 次 `['title']` | ✓ | ✓ |
| P-2 替换入口暴露 | `replaceRootContent(derived, proxy, doc)` → `toEqual({ok:true})`；ROOT toJSON 键集仅 `['title']`（必填 `count` 静默丢失）；`extractYjsSnapshot` 读回 → `validateLogicalSnapshot` `ok:false`（读回快照无法通过逻辑校验） | ✓ | ✓ |
| P-3 基线入口同款 | 同向量 `materializeRoot`（fresh doc + fresh proxy）→ 同 `{ok:true}`；两 doc ROOT `toJSON()` 全等（产物 JSON 全等）；基线入口同样丢 `count` | ✓ | ✓ |
| P-4 普通 JSON 不可达 | (a) `JSON.parse(JSON.stringify(proxy))`（REST/持久化通道）→ prototype === Object.prototype 的 plain object（trap 无法存活穿越 JSON 通道）；(b) plain object 10 轮交替 `Object.keys`/`JSON.stringify` 视图恒同；(c) 同一 plain 快照两次直跑管线（validate→replace→读回）产物全等且 `count` 不丢 | ✓ | ✓ |

- Node 24 日志：`/tmp/sa7/f2-n24.log`（`Tests 4 passed (4)`，exit 0）；Node 20 日志：`/tmp/sa7/f2-n20.log`（`Tests 4 passed (4)`，exit 0，`NODE=v20.20.2`）
- **结论**：与 SA4 F-2 定性**逐项一致**——① 校验视图与 ②③ 构造视图稳定化发散仅在对抗性 TOCTOU 输入（自造 hostile Proxy 直传）下可达；`replaceRootContent` 与 `materializeRoot` 两入口行为同款、产物 JSON 全等（基线 #74 血统既有暴露，**非本任务引入**，活链路实证）；经 JSON 序列化通道（REST/持久化反序列化产物）到达的快照恒为无 trap plain object，该向量**不可达**。修它需动共享管线两入口（超 #88 范围），维持 SA4 处置：非阻塞、回流 SA1 知识面登记。

### 必做 #2 — Node 20/24 双版本全量 test + typecheck（本地替代证据）✅

> **CI 证据状态**：分支 `fix/issue-88-on-docs-namespace-runtime` **未 push**（`git ls-remote origin` 无此分支；本地 ahead 1）→ 无 PR、无 CI run（`gh run list --branch fix/issue-88-on-docs-namespace-runtime` 空）。SA7 不负责 push/建 PR，故以**本地同命令双 Node 证据**替代（materialize-root-rev2 SA7 先例同款处置）；CI 动态证据待 push 后 runner 核验（见「遗留移交」）。

与 CI `ci.yml` Test/Typecheck step 同命令（`pnpm test` = `vitest run --typecheck`；`pnpm typecheck` = 六包 tsc）：

| 命令 | Node 24.13.0 | Node 20.20.2 | 日志 |
|---|---|---|---|
| `pnpm test` | `Test Files 66 passed (66)` / `Tests 940 passed (940)` / `Type Errors no errors`，exit 0（148.5s） | `Test Files 66 passed (66)` / `Tests 940 passed (940)` / `Type Errors no errors`，exit 0（133.6s） | `/tmp/sa7/full-n24.log` / `/tmp/sa7/full-n20.log` |
| `pnpm typecheck` | 六包 tsc exit 0 | 六包 tsc exit 0 | 同上（尾部 exit 文件 0） |

**vitest 触发行**（两日志均含，Test job `pnpm test` 收集执行面）：

```
✓ packages/doc-runtime/test/replace-root-content.test.ts (13 tests) 48ms   ← Node 24
✓ packages/doc-runtime/test/replace-root-content.test.ts (13 tests) 55ms   ← Node 20
```

940 = 派发基线 927 + 本任务 13（与 SA4 独立复跑一致）。

### 必做 #3 — yjs 浮动版本漂移抽查 ✅

1. **CI 面锚定（漂移在 CI 不可能发生）**：`ci.yml` Install 步骤为 `pnpm install --frozen-lockfile`；`pnpm-lock.yaml` 解析 yjs 恰 `yjs@13.6.32`（`resolution: sha512-lfiJIIC…`，全仓唯一版本条目）——frozen lockfile 下 CI install 的 yjs **恒为 13.6.32**，与设计协议假设锚定版本一致，SA4 所述「若非 13.6.32」条件分支在现行 CI 配置下不成立。
2. **漂移分支动态抽查（13.6.30 = `^13.6.30` 区间下界）**：worktree 快照拷贝至 `/tmp/sa7/drift`（排除 node_modules/.git），根 package.json 注入 `pnpm.overrides: { yjs: '13.6.30' }`，`pnpm install --no-frozen-lockfile` exit 0（scratch `node_modules/.pnpm/yjs@13.6.30/package.json` version 实核 13.6.30），随后：
   - `pnpm exec vitest run packages/doc-runtime/test/replace-root-content.test.ts` → **13/13 绿，exit 0**（含 G1「恰 1 update / `toBe` identity / `not.toBe` ×3 旧子失效」与 G7「未闭合外层事务 → throw DOCRT-E202 零写入」）；
   - `pnpm exec vitest run packages/doc-runtime`（整包 15 文件）→ **228/228 绿，exit 0**（materialize/extract/read 全家 + 本任务 13）。
   - 日志 `/tmp/sa7/drift.log`。
3. 注：npm registry 实查 `^13.6.30` 区间现存版本仅 {13.6.30, 13.6.31, 13.6.32}——13.6.32 即上界（lockfile 锚定版），13.6.30 即下界，抽查覆盖区间端点。

**结论**：G1/G7（及整包行为面）在 yjs 13.6.30 与 13.6.32 双版本下均绿；设计全部协议假设（RA-1~RA-9 锚定 13.6.32 实测）在区间内无版本敏感漂移。

---

## Step 3 — E2E spec 触发证据

**N/A**：本任务无新增/改动 `*.spec.ts`（SA4 §1.3 静态门禁同判 N/A；实现 diff 恰 8 文件均在 `packages/doc-runtime` 与根 package.json，无 E2E 面）。

## Step 4 — vitest 触发证据（verdict 升级 — 2026-06-15 立法 / 硬门禁 #14）

> 触发条件命中：本任务含新增 `*.test.ts`（`packages/doc-runtime/test/replace-root-content.test.ts`）。CI Run URL **无**——分支未 push、无 PR、无 run（见必做 #2 状态注明）；下表为本地同命令证据（`pnpm test` 与 CI Test step 同命令），CI 动态证据 deferred 至 push 后 runner 核验。

| Workspace Package | CI Step Name | 触发结果 | log 摘录 |
|---|---|---|---|
| `@nomicore/doc-runtime`（packages/doc-runtime） | Test（`pnpm test` = `vitest run --typecheck`；静态面 SA4 §1.4 已核 include glob `packages/*/test/**/*.test.ts` 覆盖本文件） | ✓ 本地 13 tests passed（Node 20/24 双版本；CI 触发待 run） | `✓ packages/doc-runtime/test/replace-root-content.test.ts (13 tests)` + `Test Files 66 passed (66)` / `Tests 940 passed (940)` |

**本地判定：✅ all-vitest-packages-triggered（本地证据，Node 20/24 双版本）；CI 动态证据待 push 后 runner 核验。**

---

## 遗留移交（非本实现缺陷）

| # | 项 | 状态 | 移交对象 |
|---|---|---|---|
| O-S7-1 | CI 动态触发证据（Test job `replace-root-content.test.ts` 执行行 + Typecheck/Test 双 Node 矩阵绿 + CI 实装 yjs 版本）——分支 push、PR 建立后产生 | 流程性 deferred（本轮无 run 可查：`git ls-remote` 无分支 / `gh pr list` 无 PR / `gh run list` 空，证据链三重已核） | 总控 runner（push 后核验并在 dispatch log 记录；本地同命令双 Node 全绿已先行垫底） |
| O-S7-2 | F-2「① 校验视图 vs ② 构造视图稳定化发散（对抗性输入专属）」共享管线已知边界登记 | 本轮活链路双 Node 复证与 SA4 定性一致（非本任务引入、普通 JSON 不可达、两入口同款）；建议知识面登记措辞沿用 SA4 F-2 处置节 | SA1（回流登记）；若未来裁决要堵：构造完成后对 entries 键集与 ① 视图重验一次（两入口同步改，超 #88 范围） |

## 环境与清场记录

- 全部命令独立进程（`setsid nohup bash -c '...' & disown`，exit code 落盘 `/tmp/sa7/*-exit`）；无本地服务/端口占用（`fuser -k 8000/tcp 8081/tcp 3005/tcp` 预清场仅防御性执行，vitest 单测无端口需求）；无未知进程残留。
- Node 20 经 `N_PREFIX=/tmp/sa7/n n 20` 安装于 `/tmp/sa7/n`（系统默认 Node 24 未动，`n ls` 系统面仍 24.13.0/25.6.0）。
- 一次性探针已从 worktree 删除（`git status` packages/ 零残留；源码备份 `/tmp/sa7/sa7-f2-probe.test.ts.bak`）；漂移 scratch 位于 `/tmp/sa7/drift`（worktree 零接触）。

## Verdict 论证

1. **SA4 pass 前提遵守**：SA4 verdict pass → 本报告仅在 pass 基础上独立验证；未发现任何可独立成立的 fail 事项。
2. **SA6 契约全兑现（活链路）**：13/13 绿（Node 20/24 双版本全量 940/940 亦绿）——AC-1~AC-7 + G1–G7 冻结锚全过。
3. **SA4 三条动态审核重点全闭合**：F-2 复证一致（含普通 JSON 不可达性实证）、双 Node 全量绿（本地替代 + CI deferred 注明）、yjs 漂移抽查双端点绿（CI frozen-lockfile 锚定 13.6.32）。
4. **唯一遗留为流程性**（分支未 push → CI run 不存在），非实现缺陷；本地同命令双 Node 证据已垫底，CI 面按 rev2 先例 deferred 给 runner。

**Verdict: pass**
