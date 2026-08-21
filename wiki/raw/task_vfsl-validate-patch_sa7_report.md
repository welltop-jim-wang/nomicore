# SA7 动态验证报告

**Date**: 2026-08-21
**Target**: SA3 实现 commit `0bfdaed`（HEAD，base `901726f`）——`packages/vfsl/src/validate-patch.ts` + `validate.ts`/`resolve.ts`/`index.ts` + `test/validate-patch.test.ts`（SA6 owned 36 例）
**Verifier**: SA7（Dynamic Verifier，实跑验证）
**Verdict**: **pass**

---

## 0. Step 0——SA4 verdict 校对

`wiki/raw/task_vfsl-validate-patch_sa4_review.md` 顶部：`Verdict: pass`（附 1 项 LOW 回流 + 3 INFO）→ 本 SA7 进入动态验证。SA4 verdict 非 pass 时 SA7 不得 mark pass——本票满足前置。

> **注**：SA4 回流的 F-1（LOW，子树内部 E100 path）已由 SA1 于 15:12 完成 **R3 裁定**（设计文档 R3 修订，纯文档）：**子树解释器内部 E100 的 issue path = 边界前缀**（D18 收窄为「validatePatch 自身顶层 E100 = []；子树内部 E100 = 边界前缀」），SA3 零改码（实现均匀 rebase 已是该行为）。本报告 §3.2 给出该裁定的运行时对账证据。

## 1. Step 1——SA6 红灯测试转绿（第二关）

命令（后台独立进程）：`npx vitest run packages/vfsl/test/validate-patch.test.ts --reporter=verbose`

```
Test Files  1 passed (1)
      Tests  36 passed (36)
Type Errors  no errors
   Duration  1.15s
exit=0
```

**结论：🟢 GREEN（36/36）**——Phase 1 的 36 红灯全数转绿，无部分转绿、无 skip。本任务为纯引擎层（vitest 单元测试），无 yjs-server/Next.js 服务面，无端口占用。

## 2. 零回归门禁（65 例绿基座 + 全仓）

- `pnpm test`（根级 vitest 单配置全量，`vitest run --typecheck`）：

```
 Test Files  31 passed (31)
      Tests  488 passed (488)
Type Errors  no errors
   Duration  30.54s
exit=0
```

与总控 `.mabf-bg/phase3-verify.log`（488/488 + tsc exit=0）**逐字互证**。validate-snapshot（35）+ validate-snapshot-sa7（14）+ fullchain-e2e（16）= 65 例绿基座零回归（包含于 488 内）。

- `pnpm typecheck`（三包 tsc）：`exit=0`。
- `pnpm generate --check`（regen-diff，SA4 动态重点 #4）：`exit=0`，生成物新鲜；跑后 `git status` 仅余 wiki 档案与 SA7 新增测试文件（生成物零漂移）。

## 3. SA4「动态审核重点」逐条验证

### 3.1 重点 #1——CI vitest 触发证据（Hard Gate #14）

**CI 侧结构性不可得**：commit `0bfdaed` 不在任何远端 ref（`git branch -r --contains 0bfdaed` 空、`git ls-remote origin fix/issue-53-on-phase-2-engine-gaps` 空）——分支未 push，PR CI 不可能包含本 commit（PR #51 head = `phase-2-engine-gaps` 基线分支，其 CI 最新 run 为 2026-08-21T02:57，早于本 commit）。SA7 无 push/建 PR 权限（职责边界），CI run log 证据留待总控 push 后落位。

**静态接线复核（SA4 §0.2 结论独立复核成立）**：
- 根 `vitest.config.ts` `include: ['packages/*/test/**/*.test.ts', …]`——单配置、无 per-package 排除、无 projects 分片；`packages/vfsl/test/validate-patch.test.ts` 与新增 `validate-patch-sa7.test.ts` 均匹配。
- 根 `package.json` `"test": "vitest run --typecheck"`——全量跑，无 `--filter`/`--project`。
- `.github/workflows/ci.yml` `test` job（matrix Node 20/24）`Test` 步骤 = `pnpm test`，无 `continue-on-error`、无路径过滤；本次 diff 未触碰 `.github/**`/`vitest.config.ts`/根 `package.json`。

**本地动态等价证据（根级单配置全量跑，与 CI `pnpm test` 同命令同配置）**——`/tmp/sa7-fullsuite.log`（基线，HEAD 无 SA7 增量时）：

```
 ✓ packages/vfsl/test/validate-patch.test.ts (36 tests) 81ms
 Test Files  31 passed (31)
      Tests  488 passed (488)
Type Errors  no errors
exit=0
```

workspace package：**`@nomicore/vfsl`**（`packages/vfsl/package.json`，version 0.1.9 已 bump，Hard Gate #9 亲核）。基线全量跑中该包测试文件真实进入 runner 并全绿——**非黑洞**。分类：✓ 本地全量触发且通过；CI run 待 push（非 `vitest-package-not-triggered`——后者指 CI 已跑而包未出现，本票 CI 尚未跑）。

### 3.2 重点 #2——F-1 复现对账（已按 R3 裁定闭合）

探针（tsx 只读脚本，经公共面导入）：篡改派生物使**边界之下**值树含自环 ref（`type P2 = { d: string }; type ROOT = { p: { d: P2 } }` + `values['P2'] = {kind:'ref',name:'P2'}`），`validatePatch(d, {p:{d:{d:'x'}}}, ['p'], {d:{d:'y'}})`：

```
message = VFSL-E100: 内部错误（意外异常）: 值树引用环: P2
path    = ["p"]
```

- 与 SA4 §5 F-1 实测**逐字一致**；与 SA1 **R3 裁定**（子树内部 E100 = 边界前缀，D18 收窄版）**吻合**——实现零改码即契约行为，闭环。
- 相位可区分性对照：守卫相位 E100（structure 缺 root）→ `path=[]`；规整/初始化相位（删 `values['ROOT']`）→ `path=[]`（D18 原域语义不变）。
- 该行为已锚定为永久测试（`validate-patch-sa7.test.ts` describe「E100 path 相位区分」3 例）。

### 3.3 重点 #3——WorkBudgetExceeded 穿透 validateSubtree（运行时量级实证）

构造 A（Record × 120 成员联合，与 validate-snapshot-sa7 同 fixture 家族，经 validatePatch 新键写入触发规则 2 边界重建）：

| 输入 | 结果 | 耗时 |
|---|---|---|
| 100k 键 × 120 成员（预算内对照） | `ok:false`，恰 **101 条**（100 真实 + 截断标记含 truncated）——不误伤 | 3.8s |
| 900k 键 × 120 成员（≈2.2×10⁸ 单位 > 2×10⁸） | `ok:false`，**恰 1 条** `校验工作预算耗尽（全局已执行 <N> 工作单位，上限 200000000）：无法在预算内完成整份校验`，N > 2×10⁸；**path=`['m']`（相对 [] 经 finish rebase 边界前缀，D5 绝对路径）**；消息不含 VFSL-E100/truncat/Pattern（三重可区分） | 25.6s |

预算语义经 `validateSubtree`（与 validateSnapshot 同一 `interpret()`）完整穿透到 patch 面，且单条 issue 携带 rebase 前缀——SA4 重点 #3 的两点预期均实证成立，已锚定为永久测试 2 例。

**独立探针复证**（tsx，与永久测试同一构造）：`issues[0].message = 校验工作预算耗尽（全局已执行 200000001 工作单位，上限 200000000）：无法在预算内完成整份校验`、`path = ["m"]`、非 E100、单条——与 vitest 断言逐字一致（探针耗时 401.9s 系与两次全量跑并发争 CPU 的膨胀值；vitest 单测计时 25.6s 为代表值）。备选构造（120k×800 码元 pattern 数组下标替换）实测预算内 207ms ok:true——量级不足，构造 A（Record×120 成员联合）为预算穿透正典 fixture。

### 3.4 重点 #4——regen-diff

见 §2：`pnpm generate --check` exit=0（本票零 codegen 关联，CI 步骤兜底成立）。

## 4. SA2 红线 fixture 家族动态复证（R2 冻结①–⑥）

SA7 独立探针（tsx，44 项断言，不采信 SA4 结论）：**42 OK / 2 处探针预期错误（均经设计冻结文本对账确认为探针侧误读，修正后复跑 6/6 过）——0 实现缺陷**。

| 冻结条款 | 探针结果（关键证据） |
|---|---|
| D13/R2①（F1 HIGH） | `type P={d:string}; type ROOT={p:P;po?:P}`：`['p','d']` 写入 ok:true（无假 E100）且与 validateSnapshot 同重建值 issue 全等；`['po','d']`（在场基座，optional(ref) 归一化）ok:true + 全等；optional 终段整值写（缺席基座）ok:true（D10）；optional 中间段缺席 → 行 11 loud 拒（冻结②在场检查）；**双层 ref 链 `type A=B; type B={d:string}`**（SA2 R2 明邀 fixture）深层写 ok:true + 坏值全等；**ROOT 身体 ref `type ROOT=M`** 顶层字段写 ok:true |
| D14/R2②（F2 MEDIUM） | `{assets:42}` 写 `['assets','k']` → 恰 1 issue、path=`['assets','k']`、行 11 措辞（需要 plain object，实际 number）；`{profile:42}` 写 `['profile','displayName']` 同拒——**spread 塌缩静默 ok:true 实测清零** |
| D15/R2③（F3 MEDIUM） | 12 层 union-of-ref 链（T12=T11\|{…} 递归）+ 61 段路径 → 同步返回、2ms、恰 1 issue（O(L×N) 界成立，无 O(M^L) 爆炸） |
| D16/R2④（F4 LOW） | `m: A\|B`（A=map、B=string[]）混合联合：`['m',0]`/`['m','x']` 各自放行、`['m',1.5]` 恰 1 issue 按数组形消息（`数组位置需要整数 number 下标段，收到 number`）+ path=`['m',1.5]` |
| D17/R2⑤（F5 LOW） | `validateAppendToArray(d,{items:42},['items'],1)` → path=`['items']`（参数原样）+ 行 12 措辞（实际 number）；目标缺失 → 实际 undefined |
| D18/R2⑥（F6 LOW） | 删 `values['ROOT']` → E100 且 path=`[]`（见 §3.2 相位表） |
| §3.3 规则 1>4 | 穿透 union append：file1（有 tags）ok:true；坏元素 → path=`['assets','file1','tags',1]`（重建后下标）；img1（无 tags 成员）→ loud 拒 |
| D2/D3 + 规则 2 | insert index=len 过 / index=len+1 拒 path=`['items',3]`；delete [0,len-1] 过 / =len 拒；Record 新键合法 ok:true / 坏值拒 path=`['r','newKey']`（Record 位重建） |

**探针预期修正记录（防后续误报，非实现缺陷）**：
1. optional 字段**中间段**下钻于缺席基座（`['po','d']`、base 无 `po`）→ 行 11 拒绝是**设计冻结行为**（R2②在场检查），非 F1 红线 fixture 的放行场景（该 fixture 前提是 `po` 在场）；D10「缺席基座 ok:true」限**终段**整值写。
2. 行 5 措辞 `收到 <实况>` 的 `<实况>` 按矩阵惯例 = jsonTypeOf（`收到 number`），非字面值 `1.5`。

## 5. SA7 补充测试（新增永久资产）

**新增文件**：`packages/vfsl/test/validate-patch-sa7.test.ts`（22 例，9 组 describe）——编码 §3.3/§4 全部红线 fixture 家族 + F-1 相位区分 + 预算穿透。独立运行：

```
Test Files  1 passed (1)
      Tests  22 passed (22)
exit=0
```

**scope 声明**：本文件为 SA7 职责内新增（skill「补充性测试」产出，先例 `validate-snapshot-sa7.test.ts`/`parse-vfsl-sa7-supplementary.test.ts`）；**零修改既有测试文件**（设计 §8 DENY「既有测试文件改即违约」的锚定不受影响）、零修改生产代码、无 `[SA7-DIAG]` 残留。断言全部锚定运行时行为（结果形状/issue 内容/path 段数组/与 validateSnapshot 等价性），不读源码不 grep。

**含 SA7 增量后的全仓终跑**：

```
 Test Files  32 passed (32)
      Tests  510 passed (510)   ← 488 基线 + 22 SA7 补充
Type Errors  no errors
exit=0
tsc_exit=0
```

（摘录自 `/tmp/sa7-final-fullsuite.log`；含预算穿透 2 例后套件 Duration 48.80s（tests 合计 106.88s 并行），与 validate-snapshot-sa7 既有 22.6s 预算测试同量级，CI 可承受。）

## 6. vitest 触发证据（Hard Gate #14，verdict 升级段）

CI Run: **不可得**——commit `0bfdaed` 未 push 至任何远端 ref（证据见 §3.1：`git ls-remote` 空、PR #51 head 为基线分支），SA7 无 push 权限。CI log 摘录留待总控 push 后补（预期 `test (20)`/`test (24)` 两 job 的 `pnpm test` 步骤日志出现下表行）。

| Workspace Package | CI Step Name | 触发结果 | log 摘录 |
|---|---|---|---|
| @nomicore/vfsl | Test（`pnpm test`，Node 20/24 matrix 无 filter） | ✓ 本地全量触发且通过（CI 待 push） | `✓ packages/vfsl/test/validate-patch.test.ts (36 tests) 81ms` / `Test Files  31 passed (31)` / `Tests  488 passed (488)`（本地同命令 `pnpm test`，/tmp/sa7-fullsuite.log） |

**verdict**: ⚠ all-vitest-packages-triggered **本地实证成立**；CI run 级证据结构性不可得（未 push，非 `vitest-package-not-triggered`）——静态接线（include 匹配 + 全量跑 + CI 无 filter）经 SA7 独立复核与 SA4 §0.2 一致，push 后由 CI 兜底。

## 7. 验证证据汇总（命令 + 结果）

| 命令（均后台独立进程） | 结果 |
|---|---|
| `npx vitest run packages/vfsl/test/validate-patch.test.ts --reporter=verbose` | 36/36 passed，Type Errors no errors，exit=0 |
| `pnpm test`（基线全量） | 31 文件 488/488 passed，Type Errors no errors，exit=0 |
| `pnpm typecheck` | 三包 tsc exit=0 |
| `pnpm generate --check` | exit=0（生成物新鲜，git status 零生成物漂移） |
| SA7 快探针（tsx，38 断言）+ 修正探针（6 断言） | 44 项合计 42 OK / 2 探针预期错误（对账设计冻结文本后修正，0 实现缺陷） |
| SA7 慢探针（tsx，预算穿透三构造） | A：900k 键单条预算 issue（work=200000001，path=['m']，非 E100）；B：pattern 数组 207ms 预算内 ok:true（量级不足，弃用）；C：半量对照 ok:true |
| `npx vitest run packages/vfsl/test/validate-patch-sa7.test.ts`（新增 22 例） | 22/22 passed，exit=0 |
| `pnpm test`（含 SA7 增量终跑）+ `pnpm typecheck` | 32 文件 510/510 passed，exit=0，tsc_exit=0 |
| `git ls-remote origin fix/issue-53-on-phase-2-engine-gaps` / `git branch -r --contains 0bfdaed` | 均空（commit 未上远端——CI 证据不可得的原因） |

## 8. 结论

1. **SA6 36 红灯全数转绿**（Step 1 🟢）；65 例绿基座零回归；全仓 488/488 基线 + 含 SA7 补充 510/510 全绿，tsc exit=0，regen-diff exit=0。
2. **SA4 四条动态审核重点全部闭合**：① vitest 触发——本地全量实证 + 静态接线复核，CI run 待 push（结构性不可得，非实现缺陷）；② F-1——实测与 SA4 观察及 SA1 R3 裁定三方一致；③ 预算穿透——单条 issue + rebase 前缀实证并永久锚定；④ regen-diff 绿。
3. **SA2 红线 fixture 家族独立断言零实现缺陷**（44 项：42 OK + 2 探针误读修正；含 SA2 明邀的双层 ref 链 fixture），已记录防后续误报。
4. 无环境阻塞项；唯一待办在总控侧（push 触发 CI 后补 `gh run view --log` 摘录）。

**Verdict: pass**
