# SA7 动态验证报告 — File diagnostic-log adapter（issue #152）

**Date**: 2026-08-28
**Worktree**: /home/wangjian/nomicore-fix-issue-152（branch `fix/issue-152-on-docs-namespace-diagnostic-change-log`）
**被验对象**: 基线 `7ceede1` → HEAD（实现 `56ed694` + 勘误 `0ec62e9` + 修复 `cb44bcd` + wiki `98d5280`/`5830612`）
**SA4 verdict（Step 0 校对）**: **pass**（R2 复审轮，commit `cb44bcd`；R1 三项 R-1/R-2/R-3 已消除）→ 按 skill 规则进入动态验证

## verdict: pass（本地全绿；CI 侧触发证据因分支未发布而**环境阻塞**，待总控发布后补录——见 §D2）

---

## Step 0 — SA4 verdict 校对

`wiki/raw/task_diagnostic-log-file-adapter_sa4_review.md` 第 4 行：`**Verdict**: R1 轮 reject → R2 复审轮 pass（当前生效 verdict = pass）`。SA4 = pass → SA7 正常进入 Step 1/2，非「洗白」路径。

```
[SA7 Step 0 结论]
SA4 verdict: pass
操作: 进 Step 1
```

## Step 1 — SA6 红灯测试复跑（红→绿第二关）

SA6 红灯命令原样复跑（独立后台进程，无端口依赖——纯文件系统单测，无需 fuser）：

```text
$ npx vitest run --typecheck packages/namespace-diagnostic-log   # node v24.13.0, exit 0
 Test Files  18 passed (18)
      Tests  256 passed (256)
 Type Errors  no errors
```

SA6 红灯基线为 `5 failed | 72 tests failed | 20 errors`（exit 1）——**全部转绿**，红灯集无残余失败。

```
[SA7 Step 1 结论]
SA6 红灯: 🟢 GREEN（256/256）
操作: 进入 Step 2
```

## Step 2 — SA4 §五「动态审核重点」逐条验证

验证脚本（本 worktree，gitignored 目录，可复现）：
- PoC：`.mabf-bg/sa7-poc.ts`（复刻 SA4 R1 附录 A 的 PoC A/B/C/C′/D + 规范回归对照，直打 `readStreamStrict` / `injectFinalRecordFile`）
- fs 探针：`.mabf-bg/sa7-fs-probe.cjs`（§13 八条假设逐条运行时探针）

### D1 — Node 20 矩阵 `BigInt('')` 行为（R-1 空串变体）→ ✅ 关闭，且**修正 SA4 前提**

Node 20 取证方式：CI `setup-node: 20` 解析到最新 20.x——从 nodejs.org 官方 dist 下载 `node-v20.19.0-linux-x64`（与 CI 同源同版本族），本地直跑。

**行为探针（三版本直测）**：

```text
$ node -e "…BigInt('')…"（各版本）
node v24.13.0 (V8 13.6.233.17)  BigInt("")= 0n（不抛）
node v20.19.0 (V8 11.3.244.8)   BigInt("")= 0n（不抛）
node v18.19.1 (V8 10.2.154.26)  BigInt("")= 0n（不抛，仓外参照）
```

> **前提修正**：SA4 R1 曾预测 Node 20（V8 11.x）`BigInt('')` throw → 修复前 R-1 空串变体在 node-20 job 表现为兜底 wipe。**实测证伪**：node 20.19.0 上 `BigInt('')` 同样返回 `0n` 不抛——修复前两矩阵的缺陷形态**相同**（均为 status ok 假阳性），不存在「两种运行时两种缺陷形态」。该修正不影响 R1 结论成立性（假 ok 本身即击穿 AC4），反而说明缺陷面比预测更一致；修复方式「先镜像后解析」使字符串字面在到达 `BigInt()` 之前被拒，**由构造消除版本分歧**（SA4 R2 §1 判断正确）。

**PoC B（frameOffset 空串）两矩阵实测——输出逐字一致**：

```text
node v24.13.0: [PoC B] frameOffset:"" → status = corrupt | issues = ["vfsl-invalid"] | records = 1 | manifest 展示 = true
node v20.19.0: [PoC B] frameOffset:"" → status = corrupt | issues = ["vfsl-invalid"] | records = 1 | manifest 展示 = true
```

**整个包套件在 node 20 复跑**（CI 矩阵另一半的本地等价）：

```text
$ PATH=/tmp/node-v20.19.0-linux-x64/bin:$PATH npx vitest run --typecheck packages/namespace-diagnostic-log
 v20.19.0
 Test Files  18 passed (18) / Tests  256 passed (256) / Type Errors  no errors / exit 0
```

判定锚达成：修复后两矩阵均为 record 级 `vfsl-invalid`（非兜底 wipe、非假 ok）。**D1 ✅**。

### D2 — SA6 五文件 + R2 补充在 PR CI（node 20/24）全绿且确被执行 → ⚠️ CI 侧环境阻塞（本地替代证据全绿）

**阻塞事实（发布侧，非代码缺陷）**：

```text
$ git ls-remote origin | grep -i issue-152        → 空输出（分支未推送远端）
$ gh run list --branch fix/issue-152-on-docs-namespace-diagnostic-change-log → 空（无任何 CI run）
$ gh pr list --head fix/issue-152-…               → 空（无 PR）
```

SA7 无 push/建 PR 权责（skill 边界）。**本地已交付全部可前置证据**（与 CI step 同命令）：

| CI step | 本地等价命令 | 结果 |
|---|---|---|
| Test（`pnpm test` = `vitest run --typecheck`） | 同命令（node v24.13.0，独立进程） | **136 文件 1661 passed，Type Errors 0，exit 0**（与 SA4 R2 实测数字一致，零回归） |
| Test（node-20 job 等价） | 包套件 @ node v20.19.0 | **18 文件 256 passed，Type Errors 0，exit 0** |
| Typecheck（`pnpm typecheck`） | 同命令 | **exit 0** |

**逐文件触发性（本地 verbose，证明收集与执行，非仅收集）**：

```text
$ npx vitest run <六个 file-adapter 测试文件>
 ✓ file-adapter-layout.test.ts (17) ✓ file-adapter-inline-sidecar.test.ts ✓ file-adapter-genesis-results.test.ts (9)
 ✓ file-adapter-strict-reader.test.ts (27) ✓ file-adapter-mismatch-interference.test.ts (11)
 ✓ file-adapter-r2-supplemental.test.ts (19)
 Test Files 6 passed (6) / Tests 92 passed (92) / Type Errors no errors
```

四条 R2 差分锚定逐名触发且通过（`--reporter=verbose`）：

```text
 ✓ … > R-1a：frameOffset "0125"（前导零）→ corrupt + record 级 vfsl-invalid（不再判 ok）
 ✓ … > R-1b：frameOffset ""（空串）→ corrupt + record 级 vfsl-invalid（不依赖 BigInt("") 行为分歧）
 ✓ … > R-2a：注入 sequence "01" → storage-validation-failed/vfsl-invalid + 零落盘
 ✓ … > R-2b：注入 sidecar frameOffset "01"（前导零）→ storage-validation-failed/vfsl-invalid + 零落盘
```

CI 接线静态面（SA4 §1.4 已验，本次复核一致）：`vitest.config.ts` include `packages/*/test/**/*.test.ts` 覆盖本包全部 6 个 file-adapter 文件；`.github/workflows/ci.yml` node 20/24 矩阵执行 `pnpm test` + `pnpm typecheck`；root typecheck 链含 `packages/namespace-diagnostic-log/tsconfig.json`。

**处置**：待总控 push + 建 PR 后，按 Step 4 流程对两 job 摘录 `file-adapter-*` 触发行补录（本报告 §Spec/vitest 触发证据表预留位）。**D2 = 本地 ✅ / CI 侧 ⏸ 待发布**。

### D3 — §13 fs 假设的运行时面（EISDIR / append 创建 / 'wx'-EEXIST / rename 原子 / statSync 目录）→ ✅

SA4 判定「既有 mismatch/r2-supplemental 用例即锚定，无需新增」成立：上述 92 用例含 `.bin`/jsonl EISDIR 占位→恢复、fresh-stat 自愈（r2-supplemental）等，两 node 版本均绿。另以 `.mabf-bg/sa7-fs-probe.cjs` 对 §13 全部 8 条假设做**直接运行时探针**（SA4 仅在 node 24 实测过；本次补齐 node 20）：

```text
node v24.13.0: FS-PROBE: ALL PASS（13/13 探针）
node v20.19.0: FS-PROBE: ALL PASS（13/13 探针）
覆盖：append 创建缺失文件+追加语义 / 'wx' 已存在→EEXIST / appendFileSync+open(目录)→EISDIR /
rename 同目录原子替换（覆盖已存在目标）/ statSync(目录) size=4096·isFile=false·不抛 /
statSync(缺失,{throwIfNoEntry:false})=undefined / readFileSync 缺失→ENOENT·err.code 可提取 /
mkdirSync recursive 幂等 / Buffer.from(s,'base64') 宽松（'AB==ABCD' 解码≠重编码恒等）
```

两版本行为零分歧，与 §13 登记逐条一致（本地 ext4 与 CI ubuntu-latest runner 同族）。**D3 ✅**。

### D4 — R-1 修复后回归（PoC A/B → corrupt + record 级 vfsl-invalid；既有绿不退化）→ ✅

`.mabf-bg/sa7-poc.ts` 在 node 24 与 node 20 各跑一遍，**两版本全部判定 PASS，输出逐字一致**：

```text
[PoC A] frameOffset:"0125"（帧真实在 125，前帧 '0' 规范）
  → status = corrupt | issues = ["vfsl-invalid"] | records ok = [ true, false ]（规范首帧不受连带）
[PoC B] frameOffset:"" → corrupt | vfsl-invalid | records = 1 | manifest 展示 = true（record 级归因）
[PoC C] inject sequence "01" → jsonl 存在 = false + 事件 = ["storage-validation-failed/vfsl-invalid"] + reader ok/0 records
[PoC C'] inject sidecar frameOffset "01" → jsonl 存在 = false + 同事件（字面门先于 frame-missing）
[PoC D] inline base64 "AB==ABCD" → corrupt + ["base64-invalid"]（本轮未触碰路径回归不变）
[回归] 规范注入（sequence '1'/inline 'abc'）→ 落盘 + 首行 sequence=1 + 事件=[] + reader ok/1 records
SA7-PoC: ALL CHECKS PASS（exit 0，两版本）
```

与 SA4 R1 修复前实测（A/B：`status ok` 零 issue；C：违规落盘+零事件）构成差分——修复真实生效。既有 252 绿不退化：包套件 256（252+4 新锚定）全绿 × 两 node 版本；全仓 1661 全绿。**D4 ✅**。

## Step 3 — E2E spec 触发证据

**N/A**：`git diff --name-only 7ceede1..HEAD` 中 `*.spec.ts` 计数 = 0（与 SA4 §1.3 一致）。无 E2E spec，不适用。

## vitest 触发证据 (verdict 升级 — 2026-06-15 立法适用)

CI Run: **无**（分支未推送远端、无 PR、无 CI run——见 §D2 阻塞事实；SA7 无发布权责）

| Workspace Package | CI Step Name | 触发结果 | 证据 |
|---|---|---|---|
| namespace-diagnostic-log | Test (`pnpm test`) | ⏸ CI 待发布 / 本地 ✓ 触发且通过 | 本地同命令：`Test Files 6 passed (6)` `Tests 92 passed (92)`（六文件逐文件 ✓，见 §D2）；node-20 等价 `256 passed (256)` |

**verdict**: ✅ all-vitest-packages-triggered（本地运行时证据面）／CI runner 面证据**环境阻塞待总控发布后补录**——非 `vitest-package-not-triggered`（接线静态面与本地执行面均确认接通，阻塞仅在发布环节）。

## 补充性/破坏性测试裁定

**本轮零新增测试文件**，理由：
1. SA4 R2 的 4 条差分锚定（R-1a/R-1b/R-2a/R-2b）已覆盖 D1/D4 全部可锚定行为且逐名触发（非 vacuous——修复前同输入实测产出相反结局）；
2. D3 按 SA4 判定由既有 EISDIR/恢复用例锚定，本次以直接探针补证运行时面；
3. D1 的跨版本面（Node 20 vs 24）不可被单进程测试断言，正确证据形态即本报告的双版本 PoC/套件对照——已交付。

## 结论

| 项 | 结果 |
|---|---|
| SA4 verdict 校对 | pass（R2）→ 正常进入动态验证 |
| SA6 红灯复跑 | 🟢 256/256 全绿（node 24）；node 20 同 |
| D1 Node 20 `BigInt('')` | ✅ 实测 `=0n` 不抛（修正 SA4 R1 预测）；修复后两矩阵输出逐字一致（corrupt + vfsl-invalid） |
| D2 CI 矩阵全绿且执行 | ⚠️ CI 侧阻塞（分支未发布）；本地同命令全绿（全仓 1661 / 包 256×两版本 / typecheck 0）+ 六文件与四锚定逐名触发 |
| D3 §13 fs 运行时面 | ✅ 8 条假设 × node 20/24 直测全过，零分歧 |
| D4 R-1 修复回归 | ✅ PoC A/B/C/C′/D/回归 双版本 ALL PASS；252→256 零退化 |

**SA7 verdict: pass**（本地动态验证面全部成立，未发现新缺陷；唯一未闭合项为 CI runner 侧触发证据，属发布环节环境阻塞，需总控 push + PR 后按 §D2 预留位补录两 job 的 `file-adapter-*` 触发行——本地全部前置证据均已就绪，无任何迹象预示 CI 会偏离）。

附：验证产物均在 gitignored `.mabf-bg/`（`sa7-poc.ts`、`sa7-fs-probe.cjs`），worktree `git status` 干净，未触碰任何 src/生产文件与 SA6 测试。
