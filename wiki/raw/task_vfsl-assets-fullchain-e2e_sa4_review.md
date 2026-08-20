# SA4 静态验尸报告 — vfs3.assets 全链路端到端编排测试（issue #32）

**Date**: 2026-08-20（R1: reject → R2: pass）
**Verdict**: **pass**（R2 复核解除 R1 唯一阻断项：总控回滚 commit `8e511ae` 已将 `TASK.md` 精确还原至基线 blob 并退出分支 diff，BLACKLIST 复扫 0/5 命中。R1 技术面结论全部维持。下方 R1 正文为存档原样保留，最终 verdict 以本行为准——复核证据见文末 R2 节）

- 审核对象：SA3 实现半径（保持现状，commit `840c66f`/`7857fed`）+ 交付物 `packages/vfsl/test/vfsl-assets-fullchain-e2e.test.ts`（SA6 落地，commit `0d9c019`，298 行 / 16 用例 / 4 describe）
- 输入：任务简报（含 SA6 记录与总控勘误）、SA1 设计 R2（`3b64e63`）、SA2 R2 pass verdict（`00ea05f`）、SA3 实现记录（`840c66f`）
- 审查基线：`origin/adr/union-representation`（merge-base `705575b`，`git config mabf.basebranch`）
- 方法：全新视角静态验尸——非转抄 SA1/SA2/SA3 自述；SA4 独立复跑全部验收命令、独立复做 fixture 逐字 diff、`vitest list` 实际收集性验证、commit 级文件半径取证

---

## 🚨 阻断项：BLACKLIST 命中 `TASK.md`（verdict: blacklist-violation）

**SKILL §1.1 5b 反向 BLACKLIST（P0，PR #253/#254 复盘立法）**：`^TASK\.md$`——issue-runner runtime 文件，一旦出现在 diff 里即 REJECT，不论是否在 ALLOW LIST。

### 可复现证据

```bash
$ git diff --name-only origin/adr/union-representation HEAD
TASK.md                                                  ← BLACKLIST 命中
packages/vfsl/test/vfsl-assets-fullchain-e2e.test.ts     ← ALLOW ✓
wiki/raw/task_vfsl-assets-fullchain-e2e*.md  （×5）       ← ALLOW/白名单 ✓

$ git log --oneline origin/adr/union-representation..HEAD -- TASK.md
5c8d43c chore(wiki): issue #32 任务简报与派遣日志入库 / add issue #32 task brief and dispatch log
```

- 引入 commit：`5c8d43c`——**总控侧简报入库 commit**（非 SA3/SA6 产物；SA3 两个 commit 仅触 wiki，SA6 commit 仅触测试文件 + wiki，文件半径全部干净）。
- diff 内容：TASK.md 从上一任务（issue #8，基线 commit `340425d` 经 PR #2 落入）的 runtime 内容复写为 issue #32 的任务描述（44 行）——**与 PR #253 事故完全同型**：「issue-runner runtime 文件被上一个任务 commit 后被这个任务复写」。
- 模式背离实证：上一票 #21（分支 `fix/issue-21-on-adr-union-representation`，squash `705575b`）**没有**提交任何 TASK.md 改写（`git log ... -- TASK.md` 为空）——本管道不提交 TASK.md 复写是既有惯例，本票是这条线上首个破例。
- runner 不剥 runtime 文件的实证：#21 的 PR 曾把 `.scratch-spec-20.md`（根级草稿文件）原样带进 squash `705575b`——外部 issue-runner/check.sh **不做** runtime 文件剥离，本票 PR 若不清理，TASK.md 复写必进 PR diff。

### 影响

- PR 污染：外部 runner 建 PR 后，diff 将携带 44 行 runtime 文件复写（与本票工程内容无关的噪音）；若 PR 合入 `adr/union-representation`，过期任务残留（issue #32 runtime 文本）沉淀入分支线，复刻 `.scratch-spec-20.md` 先例——残留只增不减。

### 回流目标与修复（→ 总控，非 SA3）

TASK.md 的引入者是总控自己的简报 commit，SA1/SA3/SA6 均无权限也无必要动它（回流目标按 SKILL 惯例为 SA1/SA3/SA6，但本项的 commit 属主是总控，故回流总控执行）：

```bash
git checkout origin/adr/union-representation -- TASK.md
git commit -m "chore: 回滚 TASK.md runtime 复写（SA4 blacklist 门禁，PR #253 立法）"
```

- 副作用说明：checkout 会把 worktree 的 TASK.md 一并还原为基线内容——该文件是 issue-runner runtime 物料，内容已完整存档于简报 `wiki/raw/task_vfsl-assets-fullchain-e2e.md` 与 `5c8d43c` 历史，无信息丢失。
- **不接受**以「SA1 扩展 ALLOW LIST」合法化：BLACKLIST 立法明文「不论是否在 ALLOW LIST」，ALLOW LIST 扩展不适用。
- 修复后复核：SA4 重跑 `git diff --name-only <base> HEAD | grep -E '^TASK\.md$'` 为空即解除阻断——其余维度本报告已全部 pass，无需重审。

---

## §1.4 vitest 触发性自检（结论节：**PASS——package 已接通 CI**）

本票新增 `*.test.ts`（`packages/vfsl/test/vfsl-assets-fullchain-e2e.test.ts`，workspace package **`@nomicore/vfsl`**），按 2026-06-15 立法执行静态触发性门禁：

| 检查项 | 证据（SA4 独立取证，非转抄） | 结论 |
|---|---|---|
| workflow 存在与触发面 | `.github/workflows/ci.yml`：`on: push: [main]` + `pull_request`（全 PR 触发）；job `test`（matrix node 20/24） | ✓ PR 建立即触发 |
| vitest 调用范围 | job 步骤 `pnpm test` → 根 `package.json` scripts `"test": "vitest run"`——**根级裸调用，无 `--filter`/`--project` 收窄**，凡根 config include 者全收集 | ✓ 无过滤黑洞 |
| 根 config include | `vitest.config.ts`（仓内唯一 vitest config，`packages/vfsl` 无自有 config）：`include: ['packages/*/test/**/*.test.ts']`——覆盖 `packages/vfsl/test/**` | ✓ 模式命中 |
| **实际收集性（执行证据）** | SA4 实跑 `npx vitest list packages/vfsl/test/vfsl-assets-fullchain-e2e.test.ts`——**16 用例全部枚举**（AC1×2 / AC2×5 / AC3×1 / AC4×8，describe 标题逐条可见） | ✓ 非仅 config 推断 |
| typecheck 覆盖 | job 步骤 `pnpm typecheck` → `tsc -p packages/vfsl/tsconfig.json`，其 `include: ["src/**/*.ts", "test/**/*.ts"]` 含新文件 | ✓ |
| 全量绿复现 | SA4 后台独立进程复跑：单文件 **16/16**、全量 **15 files / 341 tests passed**、typecheck **exit 0** | ✓ 与 SA6/SA1/SA2/SA3 四方记录逐值一致 |

**判定：`ok`——未触发 `vitest-package-not-triggered`**。本仓 CI 为根级单 job 结构（无 per-package `--filter`），issue #289 事故的「workspace package 被 filter 漏掉」形态在此结构下不成立，收集性由根 include + 实跑双重证实。design 无需补「vitest runner 触发性」小节；SA7 动态侧须按 SKILL 联动条款从 `gh run view --log` 摘录本文件 16 用例的运行证据（见文末动态审核重点 #1）。

（§1.3 E2E spec 触发性：diff 无任何 `*.spec\.ts`，门禁不适用。）

---

## 审核结论（SKILL 九项 + 门禁族）

1. **设计一致性（§1.1/§1.2）**：⚠️→❌ **文件清单一处 BLACKLIST 违例**（`TASK.md`，见阻断项）。其余全部一致：
   - ALLOW LIST 覆盖精确：交付物测试文件 + `wiki/raw/task_vfsl-assets-fullchain-e2e*.md` 产出族，无其他普通越界（creep 集合经白名单过滤后仅 TASK.md）；
   - DENY LIST 零触碰：`packages/vfsl/src/**` 全分支 diff 文件数 = 0；`package.json`/既有 14 测试文件/`docs/`/`CONTEXT.md`/tsconfig/根配置全部未动；
   - BLACKLIST 其余四类（package-lock.json / yarn.lock / .DS_Store / *.bak）零命中；
   - 设计偏离：**零**——测试文件逐锚核对设计 §2.3 五锚（A root/map 形态+字段序+optional、B index pattern 条目+`ASSET_ID_REGEX`+union、C 判别式 `{field:'kind',byValue:{image:0,text:1,file:2}}`+3 成员、D `members[1].body = {kind:'xml-fragment'}` 终态、E attachments `{kind:'plain'}` 终态）、§2.4 docs 三别名逐字、§2.5 八面矩阵逐面、D1 链式传递（`chainDerived` 逐层消费 + 前置 `expect(ok)` + 不可达 throw 含 issues JSON）、D2 独立文件、D3 只锚可观测输出——与 SA1 R2 定稿逐项相符；非空断言豁免两处实测就在 **182/190 行**（与设计 §2.6 豁免声明所引行号一致）；SA3「保持现状」半径与设计 §0/§1.3 的定义完全兑现（SA3 commit 仅 wiki）。
2. **读写路径一致性（§2）**：✅ 一致——无数据源分叉。唯一「数据源」是 §10 fixture 文本：每用例 `chainDerived()` 内 parse 的 module **就是** evaluate 的输入、evaluate 的 derived **就是** validateSnapshot 的输入（AC1 首条更是显式逐层变量传递），无任何一层旁路自构。
3. **静默失败（§3）**：✅ 无——每个 `if (!result.ok)` 收窄守卫前均有 `expect(result.ok).toBe(false)` 先行红灯；两处前置 throw 均**不可达**（expect 已先行）且携带 issues JSON 上下文；无「三无」路径（每条断言的可观测输出即 vitest pass/fail）。
4. **降级方案（§4）**：✅ 无降级——纯同步终态断言，无 fallback、无 catch 吞错、无 try/around；「不应发生」throw 是 TS 收窄辅助非降级策略（SA2 R1 同判，SA4 复核维持）。
5. **极端攻击（§5）**：✅ 安全——输入全为编译期字面量（FIXTURE 常量 / validSnapshot 工厂），无动态输入面；无并发竞争（被测三层同步纯函数）；用例隔离完备（每用例新 `chainDerived()` + `validSnapshot()` 新对象 + `clone(AUDIT)` JSON 深拷贝，不依赖校验器只读承诺）；`Object.keys` 在场性先验构成工厂漂移护栏（未来删字段先在先验红灯，不静默缩窄 AC1 覆盖面）。未发现可静态确认的漏洞。
6. **错误处理（§6）**：✅ 完整——全部分支（结果联合 ok/!ok 两侧）都有对应断言；`expectIssueAt` 先锁 `ok:false` 再断 path；AC4-5/8 的消息锚（`some(includes('联合成员 2/3' / '1/3'))`）+ path `toContainEqual` 双锚在场。
7. **架构评估（§7）**：✅ 可行——零代码半径的收官票，无绕过架构约束的补丁/FIXME，无越模块触碰，无退回 SA1 信号。
8. **过度设计（§8）**：✅ 精简——298 行对 6 条 AC（收官演示票的教学/展示价值在简报明文范围内）；辅助仅 5 个最小函数（clone/validSnapshot/chainDerived/expectIssueAt/aliasDocs），无投机抽象、无不可能边界防御、无超半径触碰。

### 门禁族补充结论

- **§1.5 协议假设**：✅ PASS——design §8 章节在场，4 条假设零「应该/通常/预计」类无据推断；SA4 独立复跑核验：①假设 1 转义链路——python3 独立脚本（自动探测模板字面量边界，不用 SA1 行表）重做 `\\\\→\\` 换算 diff，spec §10（内容 497-525，围栏 496/526 实测 ```` ```vfsl ```` / ` ``` `）对 8 个文件 9 处整份副本（含 cycle-detection ×2：176-204 / 335-363）**全部 EXACT 29/29 行**，行区间与 SA1 §8 表逐项一致；②假设 2 锚点在场（`v1-spec.md:81-83` 注记 6 `\\`→`\` 双写规则 + `evaluate-derived-schema.test.ts:24` 头注「keyPattern 携带解码后正则」）；③④假设 3/4 由本报告开头 SA4 复跑（341/341、exit 0）与 `vitest list` 实跑直接再证实。
- **§1.6 契约改动连锁**：✅ 无契约改动（N/A）——全分支 `packages/vfsl/src/` diff = 0，`parseVfsl`/`evaluate`/`validateSnapshot` 及一切内部函数签名/throw/return 行为零改动；测试文件仅 import `../src/index.js` 公共导出（`:31-33`），是纯消费者。design §9 声明与实际相符，无 caller 清单可审。
- **§1.7 源码 grep 断言禁令**：✅ PASS——对 diff 内全部测试文件扫描：`readFileSync(` 零出现、`toMatch(`/`toContain(` 零出现；文件头 `:23-24` 明文「不读取源码、不 grep 文本形状」与实现相符。全部断言锚运行时返回值（结果联合 / 派生物数据形状 / issue 的 message+path），无文本形状伪测试。

---

## 动态审核重点（交 SA7）

1. **CI 触发证据（§1.4 联动，必检）**：外部 issue-runner 建 PR 后，从 `gh run view <pr-ci-run> --log` 摘录 `test` job 的 vitest 输出，确认 `vfsl-assets-fullchain-e2e.test.ts` 的 16 用例在 CI（node 20 与 24 两个 matrix 腿）真实运行且通过——本报告的接通性结论是静态 + 本地实跑，CI 侧日志由 SA7 摘录存证。
2. **PR diff 卫生（阻断项闭环验证，必检）**：`gh pr diff` 确认 **TASK.md 不在 PR diff 中**（前提：总控已执行回滚 commit）。若届时 TASK.md 仍在，动态侧直接红牌上报。
3. **（可选）CI 环境绿灯**：本地 341/341 已由 SA4 复现；SA7 可顺带核对 CI 全量数与本地面一致（vitest 版本/平台差异导致的漂移面在本票为零依赖新增下预期不存在）。

---

## 结论

本票**技术交付物本身全维度 pass**：测试文件与 SA1 R2 设计逐锚一致、断言全部锚定可观测运行时行为、fixture 与 spec §10 逐字对齐（SA4 独立复证 9/9 EXACT）、vitest/CI 触发性接通（16 用例实跑收集 + 根 config 覆盖 + typecheck include 覆盖）、本地验收绿灯四方记录一致并由 SA4 第五次复现（16/16、341/341、exit 0）。

**唯一阻断项是流程性的**：总控简报 commit `5c8d43c` 把 issue-runner runtime 文件 `TASK.md` 的复写带进了分支 diff，机械命中 SKILL §1.1 5b P0 BLACKLIST（PR #253 同型事故，且本线 #21 票既有惯例是不提交该复写、`.scratch-spec-20.md` 先例证明 runner 不做剥离）。按立法该类命中不接受 ALLOW LIST 扩展豁免，唯一解法是回滚。

**Verdict: reject（blacklist-violation）**——回流目标**总控**（非 SA3）：执行一条 `git checkout origin/adr/union-representation -- TASK.md` 回滚 commit 即解除；SA3 实现半径（保持现状）本身零问题、零动作。回滚落地后 SA4 复核仅剩单条 diff 检查，预期翻绿为 pass，SA7 动态验证可按上节清单并行准备。

> ↑ R1 阶段性 verdict 存档（2026-08-20 12:17 前）。总控已执行回滚，R2 复核翻绿为 **pass**，见下节。

---

## R2 复核（2026-08-20，回滚落地后 → verdict 翻绿）

**触发**：总控按 R1 处方执行 `git checkout origin/adr/union-representation -- TASK.md` 回滚 → commit `8e511ae`（12:17:03 +0800）。R1 报告预设复核路径为「单条 diff 检查 + blacklist 复扫」，其余技术维度 R1 已全 pass、无需重审——本节按该预设执行，全部证据为 SA4 独立取证。

### 复核证据

| # | 检查项 | 证据 | 结论 |
|---|---|---|---|
| ① | TASK.md 退出分支 diff | `git diff --name-only origin/adr/union-representation HEAD` = 7 文件：交付物 `packages/vfsl/test/vfsl-assets-fullchain-e2e.test.ts` ×1 + `wiki/raw/task_vfsl-assets-fullchain-e2e*.md` ×6；`grep -E '^TASK\.md$'` 零命中（R1 时为 8 文件含 TASK.md） | ✓ 阻断解除 |
| ② | blob 级还原精确性 | `git rev-parse HEAD:TASK.md` = `db2d979…` ≡ `origin/adr/union-representation:TASK.md` = `db2d979…`（**字节级同一 blob**，非近似还原）；worktree 对基线 diff 为空（无未提交漂移，净零复归） | ✓ |
| ③ | BLACKLIST 全量复扫 | SKILL §1.1 5b 五模式（`package-lock.json` / `yarn.lock` / `.DS_Store` / `^TASK\.md$` / 根级 `*.bak`）× 全部 7 diff 文件 = **0/5 命中** | ✓ 无新违例 |
| ④ | 回滚半径纯净 | `8e511ae` `--stat` 仅 TASK.md 单文件（+10/−13），无夹带改动；R1 review commit `433ec57` 之后全分支仅此一条 commit | ✓ |
| ⑤ | 分支余量半径 | 剩余 7 文件 = R1 已裁定的 ALLOW（交付物测试文件）/ 白名单（`^wiki/raw/task_` 产出族）集合，与 R1 审核时逐文件一致，零漂移、零新增 creep | ✓ |

### R2 判定

1. R1 唯一阻断项 `blacklist-violation` 闭环：TASK.md 引入（`5c8d43c`）与回滚（`8e511ae`）在分支上净零，最终 PR diff 不再携带该 runtime 文件。
2. R1 技术面全部结论（九项审核 + §1.4 vitest 触发性 / §1.5 协议假设 / §1.6 契约连锁 / §1.7 源码 grep 禁令）**原样维持**——回滚 commit 仅触 TASK.md，未触碰任何被审对象。
3. 动态审核重点更新：#2（PR diff 卫生）的前置条件「回滚落地」已满足，SA7 仍须 `gh pr diff` 终验 TASK.md 不在 PR diff（防 runner 侧重注入）；#1（CI 16 用例触发证据）、#3（CI 全量数核对）不变。

**Final Verdict: pass** —— 静态验尸闭环，SA7 可进入动态验证。

---

## R3 终态规范化（2026-08-20）

总控硬门禁自检脚本以正则 `^\*?\*?Verdict[:：]` 提取本报告终态，R2 节 `Final Verdict: pass` 写法不被识别（提取到的末条命中回落至 R1 的 `reject`）。本行为 R2 终态的机器可读重述，评审内容零改动：

**Verdict: pass**
