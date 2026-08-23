# SA7 动态验证报告（rev2 · Phase 3 · AC-R2-4 mutation proof）

- **Date**: 2026-08-22
- **Runner**: SA7（Dynamic Verifier）
- **run_id**: issue-75-rev-1787397220
- **被验对象**: worktree HEAD `0f0b470`（SA3 rev2 实现：`arbitrateUnion` 包内纯函数 seam + 惰性 generator `memberOutcomes` + 0.1.4 bump）+ SA4 裁量落地的 H-d 负锁 `packages/doc-runtime/test/read-logical-value-at-path-rev2-inv14-negative.test-d.ts`（工作树未提交，本轮零触碰）
- **执行基准**: 设计 `wiki/raw/task_read-logical-value-at-path_rev2_design.md` §3.3（D21 mutation proof 协议，normative）；SA4 动态审核重点清单 4 条
- **Verdict**: **pass**

---

## Step 0：SA4 verdict 校对（2026-06-13 立法）

`wiki/raw/task_read-logical-value-at-path_rev2_sa4_review.md` L8：**`Verdict: pass`** ✅ → 进动态验证。

```
[SA7 Step 0 结论]
SA4 verdict: pass
操作: 进 Step 1
```

## Step 1：SA6 红灯测试检查

rev2 红灯锚定测试（SA6 commit `7f77384`：`read-logical-value-at-path-rev2-union-arbitration-pure.test.ts` 六行表）在 SA3 实现后应已转绿。Phase 0 基线与 Phase 2 复跑两次全量中该文件均 `6 tests ✓`（见 §1/§7 触发证据）→ **🟢 GREEN**，进入清单驱动验证。

```
[SA7 Step 1 结论]
SA6 红灯: 🟢 GREEN（rev2 pure 6/6 两次全量确认）
操作: 进入 Step 2/3/4
```

---

## Phase 0：基线全量绿（设计 §3.3.3 Phase 0）

后台独立进程（`setsid nohup` + 退出码文件，非 ACP 内同步阻塞），worktree HEAD = `0f0b470`：

| 命令 | 结果 |
|---|---|
| `pnpm test`（= `vitest run --typecheck`，root） | **EXIT=0；`Test Files 61 passed (61)`；`Tests 836 passed (836)`；`Type Errors no errors`；Duration 43.74s** |

与 SA4 §7 独立复跑（61/836）逐字一致（H-d 落地后口径）。

## Phase 0.5：还原基线确立——**路径 P**（设计 §3.3.3，R1 修订双路径）

| 检查 | 实测 |
|---|---|
| `git status --porcelain packages/doc-runtime/src/read.ts`（前置） | **空输出**（seam 实现已先行 commit 于 `0f0b470` ⟹ 路径 P 成立，`git checkout` 可安全还原） |
| `sha256sum packages/doc-runtime/src/read.ts`（基线哈希，路径 Q 式双保险快照） | `c00571419ff28348b928d6602cd5aa51ee1f10830f8b857510f1e07f51b41022` |
| 非破坏性快照 | `cp` → `/tmp/sa7-rev2/read.baseline.ts`（全程保留） |

---

## AC-R2-4 mutation proof（§3.3.3 全协议；核心义务 #1）

四变异体（M-A/M-C 必做 + M-B/M-D 裁量执行）逐一独立走完「施加 → 红 → 对照 → 还原 → 复绿」。所有运行均后台独立进程。**预期红以 §3.3.2 矩阵为基线；实测与矩阵冲突时按 §3.3.1 矩阵基线注先复查变异形态再定性。**

### M-A「首 missing 即返回」（必做，owner 指认变异体）

**施加**（变异点 = seam 内规则 2 记账行，单行 diff）：

```diff
-    if (o.kind === 'missing') sawMissing = true; // D17 规则 2：missing 不胜出、继续后序成员
+    if (o.kind === 'missing') return o; // 变异 M-A（临时，验证后必须还原）：记账继续 → 立即返回（rev1 前旧策略语义）
```

（保留 `let sawMissing` 声明与三目收尾——该形态下 missing 即返回 ⟹ `sawMissing` 恒 false ⟹ 收尾行为与 §3.3.1 变异代码 `return { kind: 'reject' }` **完全等价**，且无 unused 噪声。）

**红（RUN1：`pnpm vitest run …rev2-union-arbitration-pure.test.ts`，EXIT=1）**——红集合 = **{1, 3, 5}**，与矩阵逐行一致：

| 六行表 | 实测 | 失败断言原文 |
|---|---|---|
| 行 1 `[missing, value("v")]` | 🔴 | `expected 'missing' to be 'value'`（结果断言，@pure.test.ts:72:20）|
| 行 2 `[value("v"), missing]` | 🟢 | — |
| 行 3 `[missing, reject]` | 🔴 | `expected [ +0 ] to deeply equal [ +0, 1 ]`（拉动断言）|
| 行 4 `[reject, missing]` | 🟢 | — |
| 行 5 `[missing, missing]` | 🔴 | `expected [ +0 ] to deeply equal [ +0, 1 ]`（拉动断言）|
| 行 6 `[reject, reject]` | 🟢 | — |

**行 1 双红判定**（矩阵「结果断言且拉动断言双红」）：vitest 单 it 内首断言失败即中止，拉动断言（pure.test.ts:76）未执行到；但其必然失败有双重实证——(a) 变异实际产出 `pulled=[0]≠[0,1]`（行 3/5 同变异下拉动断言实测红，同一 trackedOutcomes 机制）；(b) 行 1 Received `'missing'` 证明仲裁在首 missing 即返回、从未拉动第 2 成员（否则 value `'v'` 胜出）。两断言在该变异下均必然失败 = 矩阵双红语义成立。

**对照（判别力仅由新增测试提供——owner P1 / AC-R2-3 的兑付实证）**：

- RUN2：`pnpm vitest run …rev1-union-arbitration.test.ts` → **EXIT=0，18/18 全绿**（R1/R2/R3 行为一致性锁 + R4/R5 组全绿——正是 owner 指认「退回旧逻辑仍全绿」的三组，实测复核成立）；
- RUN3：`pnpm vitest run packages/doc-runtime/` → `Test Files 1 failed | 11 passed (12)`、`Tests 3 failed | 129 passed (132)`——**唯一红文件 = rev2 pure（3 failed = 行 1/3/5）**；其余 11 文件全绿（`rev1-union-arbitration (18 tests) 26ms ✓`、`rev1-hardening (7 tests) 29ms ✓`、主套件 20 ✓、supplementary 28 ✓、extract×5 ✓）。

**还原**：`git checkout -- packages/doc-runtime/src/read.ts` → `git status --porcelain …read.ts` **空** ✅ + `sha256sum` = 基线 `c0057141…41022` 逐字节相等 ✅。
**复绿**：rev2 pure 单文件 → `1 passed (1) / 6 passed (6)`，EXIT=0 ✅。

### M-C「Array.from 物化」（必做，D20 惰性契约唯一动态杀伤证据）

**施加**（函数体首行物化，§3.3.1 定义）：

```diff
 export function arbitrateUnion(outcomes: Iterable<NavOutcome>): NavOutcome {
+  const arr = Array.from(outcomes); // 变异 M-C（临时，验证后必须还原）：物化破坏短路惰性
   let sawMissing = false;
-  for (const o of outcomes) {
+  for (const o of arr) {
```

**红（RUN1，EXIT=1）**——红集合 = **{2}**，与矩阵精确一致：

| 六行表 | 实测 | 失败断言原文 |
|---|---|---|
| 行 1 | 🟢 | — |
| 行 2 `[value("v"), missing]` | 🔴 | `expected [ +0, 1 ] to deeply equal [ +0 ]`（**拉动断言**；该 it 前两个结果断言 `r.kind==='value'`、`r.value==='v'` 已通过才执行到第三断言——「**物化只毁惰性不毁结果**」的双断言语义逐字验证，D20/SA8 注记 R2-2 攻击面的直接锚）|
| 行 3/4/5/6 | 🟢 | —（无 value 短路场景全量拉动 `[0,1]`，物化后仍 `[0,1]`）|

**对照**：RUN2 rev1-arbitration → **EXIT=0 全绿**；RUN3 全包 → `1 failed | 11 passed (12)`、`1 failed | 131 passed (132)`——唯一红 = 行 2（物化在合法输入上公共面观测等价，矩阵「结果不变，仅成本/惰性违例」实证）。

**还原**：porcelain 复空 ✅ + sha256 = 基线 ✅。**复绿**：rev2 pure 6/6，EXIT=0 ✅。

### M-B「首 reject 即返回」（可选，裁量执行；R1 勘误后矩阵红集合 {3,4,6}）

**施加**：循环内追加一行 `if (o.kind === 'reject') return o;`（§3.3.1 定义逐字）。

**红（RUN1，EXIT=1）**——rev2 红集合 = **{3, 4, 6}**，与 R1 勘误后矩阵**精确一致**：行 3 🔴 结果红（第 2 项 reject 即返回 ≠ 期望 missing；拉动 `[0,1]` 同期望）；行 4 🔴 结果+拉动双红（首项即返回）；行 6 🔴 拉动红（`[0]≠[0,1]`；结果碰巧同 reject）；行 1/2/5 🟢。

**公共面对照（RUN2/RUN3）与矩阵基线注处置**：RUN2 rev1-arbitration EXIT=1，11/18 红（**R4 组 4 例全红，含矩阵点名的 R4-3** ✅；另有 R1/R2 真缺席对照、R3 三条、R5 两条）；RUN3 全包 18 failed = rev2 3 + rev1-arbitration 11 + hardening 4（**H-b** ✅ 矩阵点名、H-a 中段缺席、H-c-2 ✅ 矩阵「R4-3 同理」域、H-c-3）。**按 §3.3.1 矩阵基线注逐行复查**：变异形态施加正确（diff 与定义逐字一致）；实测红集合 ⊇ 矩阵预测（矩阵公共面列为代表性标注非穷尽）——机理一致无矛盾：M-B 破坏「reject 落空继续」规则，所有依赖 mixed/reject-continue 语义的绿灯锁（真缺席对照、越界对照、嵌套上浮）均红，**多层防御实证**。rev2 六行表红集合（矩阵核心预测）精确一致，不构成冲突。

**还原**：porcelain 复空 ✅ + sha256 = 基线 ✅。**复绿**：rev2 pure + rev1-arbitration + hardening 三文件 → `3 passed (3) / 31 passed (31)`，EXIT=0 ✅（覆盖 M-B 杀伤的全部本包文件）。

### M-D「missing 不记账视同 reject」（可选，裁量执行；矩阵红集合 {3,4,5}）

**施加**（§3.3.1 定义：记账行改 `continue` 且删 sawMissing 收尾分支）：

```diff
 export function arbitrateUnion(outcomes: Iterable<NavOutcome>): NavOutcome {
-  let sawMissing = false;
   for (const o of outcomes) {
     if (o.kind === 'value') return o; // D17 规则 1
-    if (o.kind === 'missing') sawMissing = true; // D17 规则 2
+    if (o.kind === 'missing') continue; // 变异 M-D（临时，验证后必须还原）：missing 不记账、视同 reject
   }
-  return sawMissing ? { kind: 'missing' } : { kind: 'reject' };
+  return { kind: 'reject' }; // 变异 M-D：删 sawMissing 收尾分支（全 missing 误判 reject）
 }
```

**红（RUN1，EXIT=1）**——rev2 红集合 = **{3, 4, 5}**，与矩阵**精确一致**：三行全为**结果断言红**（耗尽收尾 `reject` ≠ 期望 `missing`）；拉动断言 `[0,1]` 仍绿（`continue` 继续迭代，不破坏拉动集）——与矩阵 M-D 行（结果红、无拉动红）逐格吻合。行 1/2/6 🟢。

**公共面对照**：RUN2 EXIT=1，8/18 红（**R4 组 4 例全红** ✅ 矩阵点名；R1/R2 真缺席对照、R3 两条越界红）；10 绿含 R5 组 4 条（reject-continue 未被此变异触碰，方向判别正确）。RUN3 全包 15 failed = rev2 3 + rev1-arbitration 8 + hardening 3（**H-b** ✅、**H-c-2** ✅、H-a）+ supplementary 1（SUP-1）。同 M-B 定性：矩阵代表点 ⊆ 实测超集、方向一致（全 missing/含 missing → 误判 `PATH_NOT_ALLOWED ≠ undefined`）。

**还原**：porcelain 复空 ✅ + sha256 = 基线 ✅。

### mutation proof 汇总矩阵（实测 vs §3.3.2 基线）

| 变异体 | 必做 | rev2 实测红集合 | §3.3.2 矩阵预期 | 判定 | 公共面（rev1 R1-R5/H-a/H-b/H-c/SUP/主套件）实测 |
|---|---|---|---|---|---|
| M-A 首 missing 即返回 | ✅ | **{1,3,5}**（行 1 结果红+语义拉动双红；行 3/5 拉动红） | {1,3,5}，行 1 双红 | ✅ 逐行一致 | **全 🟢**（rev1-arbitration 18/18 + 全包其余 11 文件）——判别力仅由新增测试提供 |
| M-C Array.from 物化 | ✅ | **{2}**（拉动红；结果断言仍绿） | {2} 拉动红 | ✅ 精确一致 | 全 🟢（1 failed=行 2 本身；物化观测等价实证） |
| M-B 首 reject 即返回 | 裁量 | **{3,4,6}**（行 3 结果红；行 4 双红；行 6 拉动红） | {3,4,6}（R1 勘误） | ✅ 精确一致 | R4 组全红 + H-b/H-a/H-c-2/H-c-3 + 真缺席/越界对照（⊇ 矩阵代表点 H-b/R4-3；矩阵基线注复查：形态正确、机理一致、多层防御） |
| M-D missing 不记账 | 裁量 | **{3,4,5}**（三行结果红；拉动绿） | {3,4,5} | ✅ 精确一致 | R4 组全红 + H-b/H-c-2/H-a + SUP-1（⊇ 矩阵代表点；定性同上） |

**owner 首行要求兑付（AC-R2-2 首行语义 × AC-R2-4）**：M-A 下行 1 双红——前序成员已产 missing 后，仲裁**结果**（应继续由后序真实 value 胜出）与**拉动证据**（应继续拉动第 2 成员）双双判别；同时 R1/R2/R3（18 用例）与全包其余 11 文件在该变异下全绿——rev1 R1/R2/R3 缺失的变异判别力由 rev2 纯仲裁测试补齐且**仅由其提供**，owner 合并阻塞项（PR #83 二轮 Review P1）就此闭环。

**还原纪律验收（SA8 注记 R2-3 / 设计 §3.3.3 纪律条款）**：四变异体各自还原后 `git status --porcelain packages/doc-runtime/src/read.ts` 均复空、`sha256sum` 均等于 Phase 0.5 基线 `c00571419ff28348b928d6602cd5aa51ee1f10830f8b857510f1e07f51b41022`（路径 P 验收 + 路径 Q 哈希双保险）；变异全程零 commit/stage（工作树最终 porcelain 中 doc-runtime 仅剩 SA4 落地的 H-d 负锁 untracked 文件，HEAD 恒为 `0f0b470`）——**变异态零泄漏**。

---

## H-a memo 性能护栏时序记录（SA4 动态审核重点 #3 / 核心义务 #2）

方法：临时诊断探针 `[SA7-DIAG]`（`packages/doc-runtime/test/sa7-h-a-timing-probe.test.ts`，**跑毕即删**，最终 porcelain 确认不在场）逐字复刻 hardening H-a fixture（`optionalChainFixture(26)` + `buildChainDoc(24, false)` + 路径 `['e', x×25, 't1']`），采样 5 次 elapsed：

```
[SA7-DIAG] H-a elapsed samples(ms)=[0.82,0.17,0.16,0.18,0.17] min=0.16 median=0.17 max=0.82 阈值=2000
```

**时序基准（留档）**：min **0.16ms** / median **0.17ms** / max **0.82ms**（护栏阈 2000ms；JIT 首次 0.82ms 热身后稳定 ~0.17ms）。

**结论**：seam 抽取（generator 帧切换 + iterator 协议，每成员 O(1) 常数因子）下的 26 层链中段 optional 缺席成本仍低于护栏阈值 **3 个数量级以上**——value-first 试探面成本上界不受 seam 抽取影响（memo 摊销健全、D13 挂点未破坏，设计 §3.2.2 论证 5/6 的动态复核）。全量运行中 hardening H-a 用例（`<2s` 断言）Phase 0 与 Phase 2 两次均绿。

---

## vitest 触发证据段（硬门禁 #14 动态半边 / 核心义务 #3；本任务无 `*.spec.ts`，§1.3 E2E 门禁不适用）

本任务含新增 `*.test.ts`（rev2 pure）与新增 `*.test-d.ts`（H-d 负锁）→ 门禁适用。本地全量运行（Phase 0 与 Phase 2 两次，root `pnpm test` = `vitest run --typecheck`，无 filter 全 workspace 触发）中的执行证据行摘录：

| Workspace Package | 通道 | 触发结果 | log 摘录（Phase 0 @ `/tmp/sa7-rev2/phase0.log`；Phase 2 @ `/tmp/sa7-rev2/phase2.log`） |
|---|---|---|---|
| `@nomicore/doc-runtime`（packages/doc-runtime） | 运行时 | ✓ 6 tests passed | L93：`✓ packages/doc-runtime/test/read-logical-value-at-path-rev2-union-arbitration-pure.test.ts (6 tests) 8ms`（Phase 2 复现：L13，9ms） |
| `@nomicore/doc-runtime`（packages/doc-runtime） | typecheck | ✓ 2 tests passed | L12：`✓  TS  packages/doc-runtime/test/read-logical-value-at-path-rev2-inv14-negative.test-d.ts (2 tests)`（Phase 2 复现：L16） |

两次全量汇总（首尾一致性）：Phase 0 `Test Files 61 passed (61) / Tests 836 passed (836) / Type Errors no errors`；Phase 2 `61/836` 同。**CI 远端注记**：本修订轮尚未 push（收尾由总控执行），远端 run 证据待 push 后由总控/后续流程按同口径摘录；本地全量为 CI 同命令（`pnpm test`）的超集执行，`vitest-package-not-triggered` 在本地通道不成立。

---

## 还原态静态门禁反证 + Phase 2 全量复绿（设计 §3.3.3 Phase 2 兜底）

**§3.2.3 四命令**（还原态 worktree 复跑，M-A/M-C/M-D 不在场的静态反证）：

| # | 命令 | 预期 | 实测 |
|---|---|---|---|
| 1 | 三 span 注释剥离后 `grep -nE 'Array\.from\|\.map\(\|\[\.\.\.'` | 零命中（exit=1） | **exit=1 零命中** ✅（物化变异不在场） |
| 2 | `grep -cE 'function\*[[:space:]]+memberOutcomes'` | 恰 1 | **1**（L313）✅ |
| 3 | `grep -n 'memberOutcomes'` | 恰 2 行 | **L313 定义 + L408 直接实参调用** ✅ |
| 4 | `grep -c 'let sawMissing'` | 恰 1 | **1**（M-D 已还原）✅ |

**Phase 2 全量复绿（最后兜底）**：`pnpm test` 后台独立进程 → **EXIT=0；`Test Files 61 passed (61)`；`Tests 836 passed (836)`；`Type Errors no errors`；Duration 43.06s**——任何残留变异均会在此暴露；数字与 Phase 0 基线逐字一致。

**最终工作树状态**：HEAD = `0f0b470`（未动）；`git status --porcelain packages/doc-runtime/` 仅 `?? packages/doc-runtime/test/read-logical-value-at-path-rev2-inv14-negative.test-d.ts`（SA4 落地的 H-d 负锁，收尾 commit 应包含——SA4 §处置说明）；read.ts sha256 = 基线；临时探针已删。

---

## verdict

**pass** — 理由：

1. **AC-R2-4 mutation proof 全协议闭环**（§3.3.3 normative）：M-A/M-C 必做 + M-B/M-D 裁量共四变异体，逐体独立走完「施加 → 红 → 对照 → 还原 → 复绿」；rev2 六行表实测红集合与 §3.3.2 矩阵**四体全部精确/逐行一致**（含 M-A 行 1 双红、M-C「只毁惰性不毁结果」双断言语义）；对照事实（R1/R2/R3 18 用例 + 全包其余 11 文件在 M-A/M-C 下全绿）实证**判别力仅由新增测试提供**——owner 二轮 Review 合并阻塞项兑付。
2. **还原双路径验收全过**：每变异体还原后 porcelain 复空 + sha256 逐字节等于基线；变异零 commit/零泄漏；Phase 2 全量 61/836 复绿 + §3.2.3 四命令还原态全过。
3. **H-a 时序基准留档**：26 层链中段缺席 median 0.17ms / max 0.82ms（阈 2000ms）——seam 抽取不影响 value-first 试探面成本上界。
4. **vitest 触发证据**（硬门禁 #14 动态半边）：rev2 两测试文件在两次全量中确证执行（pure 6 tests 运行时通道 + inv14-negative 2 tests typecheck 通道）。
5. AC-R2-5 前半句动态侧复核：Phase 0/Phase 2 两次全量 61 文件/836 用例全绿（rev1 五组绿灯锁 + H-a/H-b/H-c + SUP + 全仓其余）。

**SA7 变更清单**（不触生产代码）：① 本报告（唯一持久产物）；② 临时探针 `sa7-h-a-timing-probe.test.ts` 已删除（零残留）；③ read.ts 经四轮施加/还原，最终态与基线逐字节一致（sha256 验收）。无新增永久测试——rev2 判别力锚点已由 SA6（pure 六行表）与 SA4（H-d 负锁）落地，本轮无缺口需补测。
