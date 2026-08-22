# SA2 攻击评审报告

**Date（R1）**: 2026-08-22 · **Verdict（R1）**: reject（4 攻击点，SA1 需修订设计）
**Date（R2）**: 2026-08-22 · **Verdict（R2）**: **pass**（附 1 项非阻塞编辑更正，见 R2-N1；SA3 可放行）

- 被审对象：`wiki/raw/task_rename-validate-logical-snapshot_design.md`（R1 为 §0–§12 初版；R2 为 414 行修订版，新增 D10–D13 + G1 白名单化 + G2 指纹门 + G3a 探针单跑）
- 基准：`_relevant_decisions.md`（ADR 条款 + D1–D9 摘述）+ 任务简报（SA6 Phase 1 记录）+ SA8 verdict `clear`
- R2 复审范围（R1 报告约定）：**仅复审 4 攻击点的修订落点 + 修订新引入内容**；设计核心 D1–D9 已在 R1 实证未破，不重开

---

# R2 复审（收敛范围复审记录）

## R2 攻击点修订核验表（R1 四点逐项）

| R1# | 修订落点（SA1 声明） | 独立实证结果 | 裁决 |
|---|---|---|---|
| ① MAJOR：`.scratch*` 未裁决 + 门盲区 | D10 豁免裁定 + D11 门白名单化 + §1 域 D 两行 + 补注 + §6 G1 重写 + §10 DENY 追加 | **全落实且声明为真**：(a) 新 G1 门命令**原样重跑** → `14 文件 / 148 行`，与 §6 注记的逐文件基线**逐一吻合**（74/17/13/11/8/6/5/3/3/3/2/1/1/1）；豁免侧实测正确收纳 scratch 双文件、wiki、docs/adr、TASK.md、CONTEXT.md、SA6 双文件（双 pathspec `':!.scratch'` `':!.scratch*'` 覆盖目录+顶层文件，实测有效）。(b) D10「draft→final 逐字同源」声明**逐行验证为真**：`spec.md` L3/L18/L48/L59 与 PRD `20260818-prd-vfsl-v1.md` L7/L22/L52/L63 字节一致；`.scratch-spec-20.md` L18 与 `task_vfsl-evaluator.md` L28 字节一致——「迁草稿不迁定稿将使 draft→final 名称分叉」的豁免论证有事实根基，与 D5 审计轨迹纪律同构。(c) `.scratch-review-spec.md` 零旧名命中（R1 已证）。(d) scratch 三文件入 §10 DENY LIST ✓ | **通过** |
| ② MAJOR：§4.2(b) 替换单元歧义 | 整 bullet 4→5 行替换 + 旧原文对照 + D13 锚文本纪律/漂移量化 + G2 指纹门 + R9 | **全落实且声明为真**：(a) §4.2(b) 引用的改动前 L14-17 原文与 `index.ts` 实际内容**逐字节吻合**（含前导 ` * `）；新 5 行块不含旧名 token、不含指纹串。(b) 替换单元显式化：「不是只换 L14 一行！」+ 锚文本起止。(c) 漂移算术复核：index.ts bullet 4→5 → +1（L23→24/L35→36/L73→74/L78→79 ✓）；validate.ts JSDoc 9→16 → +7（L642→649/L648→655/L591→598 ✓，§4.1(b)/D13/§9 三处一致）。(d) 锚文本唯一性实测：`公共导出（issue #21）` 在 validate.ts 恰 1 处（L634，块 L633-641 共 9 行实测）；bullet 起锚 `` * - `validateSnapshot(derived, snapshot)` `` 在 index.ts 恰 1 处（L14）。(e) G2 指纹门有效：「整份 JSON 快照校验」当前在 index.ts 恰 1 处（L15，即孤儿续行本体）→ 迁移后零输出断言有效；指纹串仓内其余分布（README:61 已被 §4.5 显式整括号替换；validate.ts:2/634 与 validate-snapshot.test.ts:2 属描述性中文或整块替换域）均不在 G2 范围且不构成残留风险——G2 范围收敛于 index.ts 是刻意且充分的孤儿检测器 | **通过**（附 R2-N1 笔误更正） |
| ③ MEDIUM：探针存在性无守卫 | D12 + G3a/G3b + R8 + §8 步骤 7 四步门 | **全落实且命令实测有效**：G3a 命令原样重跑（迁移前）→ `Test Files 1 failed (1) / Tests 29 failed (29)`、**exit 1**——语法有效、`--passWithNoTests=false` 被接受（与 CI persistence-contract / domains-scaffold 先例同款）；「文件被删/漏收集 → exit 1 响亮失败」机制成立。纪律落点（SA3 自验 + SA7 报告证据，不改 CI）与 ALLOW/DENY 边界自洽（§10 基础设施条目 R2 注） | **通过** |
| ④ MINOR：§1 坏命令 | §1 域 A 注记改为 `grep -rn` + 命中集写明 | 落实：新表述「命中仅 `validate.ts:642` 定义行与 `index.ts:14` 注释行」与 R1 独立复核结果一致，可重跑；另按 R1 备注加「总数随流程产物漂移，以逐文件清单为准」口径注记 ✓ | **通过** |

§9 回应表核验：四条全 ✅、修订位置具体可查、无「承认但不改」条目 ✓。

## R2 新引入内容攻击（修订 delta 的全新视角扫描）

| # | 攻击面 | 结果 |
|---|---|---|
| R2-A1 | 新 G1 门自身盲区（git grep 只搜跟踪文件） | **非漏洞**：untracked 文件本就不在仓内；staged 文件在 index 中被搜到且 wiki/SA6 已 pathspec 豁免（实测验证）。git grep 与 PR diff 同域，形态优于 R1 的正向枚举 |
| R2-A2 | G2 指纹门误报面（指纹串迁移后残留于其他位置导致门失效/误判） | **无残留风险**：仓内指纹串分布全量盘点（见核验表②e）——迁移后 index.ts 内该串的唯一可能来源就是孤儿续行，门精确 |
| R2-N1 | **§8 步骤 1 内部矛盾（非阻塞笔误）**：写作「9→17 行」，与 §4.1(b)/D13/§9 的「9→16 行、+7」矛盾 | 实测裁决：新 JSDoc 块逐行清点为 **16 行**（`/**`…` */`），旧块 9 行——**§4.1(b)/D13 正确，§8 步骤 1 的「17」系 off-by-one 笔误**。不构成执行风险（§8 头部已声明「行号仅参考、以锚文本重定位」+ §4.1(b) 逐字块为权威），但须更正以免 SA3 困惑。**要求：SA1 在派工 SA3 前将 §8 步骤 1 的「9→17 行」更正为「9→16 行」（单字符级编辑，不涉任何决策变化；本评审不因此扣留放行）** |
| R2-A3 | D13 漂移值传播一致性（§4.1(c)/§4.2(c)/§8 头部三处漂移声明互相矛盾？） | 复核一致：validate.ts +7（L591→598/L648→655 ✓）、index.ts +1（L3 不变/L23→24/L35→36/L78→79 ✓）；唯 R2-N1 单点笔误 |
| R2-A4 | D10 豁免是否构成新的 ADR/CONTEXT 冲突 | 无：scratch 草稿不属任何 ADR 条款管辖面；与 D5「历史档案不迁移」同构同向（SA8 前置门禁授予的裁量范围内） |

## R2 红线测试思路（增量）

R1 四条红线全部已被设计内化为门/纪律（G1 白名单门、G2 指纹门、G3a 单跑、§1 可重跑命令）——无需另立红灯。SA7/SA4 执行时按 §6 四门 + §8 步骤 7 逐门贴证据即可；唯一附加要求：SA7 报告须同时贴 **G1 门零输出（exit 1）** 与 **G3a `Tests 29 passed (29)`** 两条输出的原文。

## R2 结论

**Verdict: pass。** R1 四攻击点全部有效落实且关键声明经独立实证为真（G1 基线 14 文件/148 行实测吻合、D10 同源逐字验证、旧原文/锚文本/漂移算术全对、G3a 命令实测有效）；修订 delta 未引入新漏洞。附 1 项非阻塞编辑更正（R2-N1：§8 步骤 1「9→17」→「9→16」），由总控转达 SA1 在 SA3 派工前顺手更正，不需 R3。设计放行，SA3 可执行。

---

# R1 评审记录（2026-08-22，Verdict: reject——审计轨迹保全）

- 被审对象：`wiki/raw/task_rename-validate-logical-snapshot_design.md`（SA1 设计 R1，§0–§12）
- 评审方法：全新视角，对设计全部可检验声明逐条实证复核（命令与结果见附录），再按 refactor 任务类型做行为丢失/迁移窗口/门有效性攻击

## R1 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议（可执行修订要求） |
|---|--------|--------|---------|------|
| 1 | **MAJOR** | §1 分布地图完备性 + §6 G1/G2 门盲区 | **git 跟踪文件含旧名但完全未裁决**：`.scratch/vfsl-v1-parser/spec.md`（4 处）与 `.scratch-spec-20.md`（1 处）被 git 跟踪（`git ls-files` 证实；`.gitignore` 仅忽略 `.mabf-bg/`），共 5 处 `validateSnapshot`。设计通篇零次提及 `scratch`（grep 实证）——不在域 A/B/C/D 任何一域；G1（`packages/*/src packages/*/test domains tests apps`）与 G2（`README.md apps/README.md docs/vfsl docs/agents docs/phases`）路径均不覆盖。后果：迁移完成后 5 处旧名残留在跟踪文件里，**双门全绿**；AC「全仓调用方、测试和文档完成迁移」存在未裁决残留；§1「全仓 369 处按处置域分四类」的完备性声明被证伪。根因推测：SA1 的「全仓」grep 用 glob 展开跳过了 dot 条目（这正暴露正向枚举式 grep 的结构性风险） | ① 显式裁决两文件：豁免（列入域 D，理由：dated 工作草稿，性质近历史档案）**或**迁移（并入 §4.5），二选一写进 §1/§3；② G 门形态升级为**白名单式全仓门**（覆盖代码+活文档一个命令）：`git grep -n "validateSnapshot" -- ':!wiki' ':!docs/adr' ':!TASK.md' ':!CONTEXT.md' ':!.scratch*' ':!packages/vfsl/test/validate-logical-snapshot*'` 期望零输出——白名单集中可审计，天然无 dot/新路径盲区 |
| 2 | **MAJOR** | §4.2(b)/§8 步骤 2 替换单元歧义 | 现仓库 `index.ts` 的接缝条目是**跨 L14-17 的 4 行 bullet**（L14 符号行 + L15-17 三行续行）；设计字面指令是「**L14 公共接缝清单行**——替换为」+ 6 行新块。若 SA3 字面只替换 L14 一行：L15-17 成为悬挂孤儿续行（内容与新块重复、bullet 破碎）——且 **L15-17 不含旧名 token，G1/G2 双门均不可见**，无任何守卫能抓住这份烂头注。放大器：§4.1(b) 的 JSDoc 整块替换会使后续行号整体漂移，§8 若按行号顺序执行将用到失效行号 | ① §4.2(b) 明确「替换 L14-17 **整个 bullet 条目**（4 行 → 5 行）」并附改动前 4 行原文（SA3 对照删除边界）；② 全设计统一纪律：**替换以锚文本定位、行号仅作参考**，并在 §8 显式声明行号漂移量化 |
| 3 | **MEDIUM** | §6 G3 / 探针存在性守卫 | SA6 红灯探针 `validate-logical-snapshot.test.ts` 是 AC1/AC2 唯一活守卫，但其**存在性无任何守卫**：若文件被删/漏跑，`pnpm test`（vitest 全局 `passWithNoTests: true`）与 CI 均静默通过；G1 白名单里的路径消失也不报警（`grep -v` 对不存在路径是 no-op）。仓内已有**同威胁模型的先例**：CI 为 persistence-contract 与 domains-scaffold 两步显式加 `--passWithNoTests=false` 并注释「防测试文件被删后静默假绿」——本设计未复用该纪律 | §6 G3 增加显式步骤（SA3 自验与 SA7 报告均须贴证据）：`pnpm exec vitest run packages/vfsl/test/validate-logical-snapshot.test.ts --passWithNoTests=false` → 断言 `Test Files 1 passed / Tests 29 passed`；全量 `pnpm test` 后另确认运行清单含该文件 |
| 4 | **MINOR** | §1 证据命令不可复现 | 域 A 注记「实测 `grep -n "validateSnapshot(" packages/vfsl/src/` 零命中」——该命令对目录无 `-r`，实跑 exit 2 + stderr「Is a directory」、stdout 为空，形式上像「零命中」但**不可重跑出该结论**。结论本身（生产 caller = 0）经我用 `grep -rn` 复核为**真**（仅 `validate.ts:642` 定义行 + `index.ts:14` 注释行命中），但依据链内嵌坏命令违反「依据可被 SA4 验证」纪律 | 把 §1 该句改为可重跑形式（直接引用 §12 已有的 `git grep` 或 `grep -rn` + 排除定义行） |

**R1 备注（不计漏洞）**：

- 命中总数 369（设计时点）vs 今日实测 407（排 node_modules/.git）——差额来自 Phase 2 自指 wiki 产物增补，属口径漂移非缺陷；建议 SA1 在 §1 标注「总数随流程产物漂移，以逐文件清单为准」（→ R2 已落实为 §1 口径注记）。
- kebab 路径引用与 D4 自洽性验证通过：`contract.ts:46`、`validate-snapshot-sa7.test.ts:5`、`validate-patch.test.ts:64` 三处路径级引用因 D4 不改文件名而全部保持有效——D4 论证被加固而非削弱。

## R1 已验证为真的设计声明（D1–D9 核心未破，R2 未重开）

1. **逐行清单零误差**：validate.ts L4/70/591/642/648、index.ts L3/14/23/35/73/78、resolve.ts L5、validate-patch.ts L18/564、README L61/65/90、apps/README L7、v1-spec L20/199/480、evaluate-derived-schema.test.ts L593——`grep -n` 逐文件复核全部命中且无多余。
2. **红灯基线复现**：`npx vitest run packages/vfsl/test/validate-logical-snapshot.test.ts` → **29 failed (29)**，Type Errors no errors。
3. **typecheck 基线绿**：`pnpm typecheck` exit 0（vfsl tsconfig `include: ["src/**/*.ts", "test/**/*.ts"]` 已含 SA6 双文件，staged 状态下五包 tsc 全过）。
4. **生产 caller = 0**：`grep -rn "validateSnapshot(" packages/vfsl/src/` 仅定义行与 index 注释。
5. **消息域零影响**：validate.ts 全部 5 处命中均为注释/定义行，无字符串字面量含旧名。
6. **探针机制**：命名空间取成员（无静态旧名 import）、AC2 `toBeUndefined` 真模块级锚、`registerBehaviorRegression` 以新名执行。
7. **contract.ts 不被收集**：vitest `include` 仅 `*.test.ts`。
8. **D7 bump 与 CI 无冲突**：`pnpm-lock.yaml` 零处 `0.1.10`、下游均 `workspace:*`——`pnpm install --frozen-lockfile` 不受版本字段影响。
9. **CI 事实**：node `[20, 24]` matrix 恰在 L18；`pnpm generate --check` 与更名零交集。
10. **ADR 合规**（独立复核与 SA8 同向）：D2 不留 alias、D1 行为/消息/形状冻结、D5 ADR 不可变、D8 `_Avoid_` 执行机制——未发现任何 ADR 条款违反。
11. **并发/一致性**：纯函数、无共享可变态、无 I/O——无竞态/死锁/缓存撕裂面。
12. **迁移窗口**：D9 单提交原子迁移，无中间破损态、git revert 可整体回滚。

## R1 协议假设依据审查

§11 章节存在 ✓，「无协议级假设」**成立**（纯符号更名）；附注工具链事实逐条实证为真；唯 §1 内嵌坏命令（攻击点 4）。

## R1 错误处理链路审查

纯更名无新交互链路：无新静默失败面（不抛错契约保持）；错误状态闭环/降级路径不适用；虚假降级未发现。真正漏洞形态在**验证门自身的静默失败**——门的路径盲区（攻击点 1）与探针存在性缺口（攻击点 3）构成迁移验收链路的两条伪绿路径（→ R2 已分别以 G1 白名单化与 G3a 显式单跑堵死）。

## R1 红灯测试思路

1. **漏洞 1 红灯**：SA4 复核命令改全仓 `git grep` + 白名单过滤，断言残余集合 ⊆ 豁免清单（→ R2 内化为 §6 G1）。
2. **漏洞 2 红灯**：① SA4 对 `index.ts` 头注 diff 逐行对账；② 静态指纹断言 `grep -n "整份 JSON 快照校验" packages/vfsl/src/index.ts` 期望零命中（→ R2 内化为 §6 G2）。
3. **漏洞 3 红灯**：SA7 显式 `--passWithNoTests=false` 单跑探针，断言 `Test Files 1 passed / Tests 29 passed`；并附全量 `pnpm test` 运行清单证明该文件在跑（→ R2 内化为 §6 G3a/G3b）。
4. **漏洞 4 红灯**：SA4 抽查设计证据命令可重跑性（→ R2 已落实于 §1）。

---

## 附：实证证据摘录（R1 + R2，worktree `/home/wangjian/nomicore-fix-issue-71`，基线 `ee3643c` + staged 产物）

### R2 新增证据（2026-08-22）

```text
# 攻击点①修订：新 G1 门原样重跑（迁移前基线）
git grep -n "validateSnapshot" -- ':!wiki' ':!docs/adr' ':!TASK.md' ':!CONTEXT.md' \
  ':!.scratch' ':!.scratch*' ':!packages/vfsl/test/validate-logical-snapshot.test.ts' \
  ':!packages/vfsl/test/validate-logical-snapshot.contract.ts'
→ 14 文件 / 148 行；逐文件：validate-snapshot.test.ts 74 / fullchain-e2e 17 /
  validate-patch.test.ts 13 / validate-snapshot-sa7 11 / validate-patch-sa7 8 /
  index.ts 6 / validate.ts 5 / README.md 3 / docscope-guards 3 / v1-spec 3 /
  validate-patch.ts 2 / evaluate-derived 1 / resolve.ts 1 / apps/README.md 1
  ——与设计 §6 注记基线逐一吻合；scratch/wiki/adr/TASK/CONTEXT/SA6 全落豁免侧

# 攻击点①修订：D10「逐字同源」核验（草稿行 vs 定稿行 → 字节一致）
sed -n '3p;18p;48p;59p' .scratch/vfsl-v1-parser/spec.md
  ≡ sed -n '7p;22p;52p;63p' wiki/raw/20260818-prd-vfsl-v1.md   （四行全等）
sed -n '18p' .scratch-spec-20.md ≡ sed -n '28p' wiki/raw/task_vfsl-evaluator.md

# 攻击点②修订：旧原文对照 + 锚文本唯一性 + 块行数实测
sed -n '14,17p' packages/vfsl/src/index.ts → 与 §4.2(b) 改动前引用逐字节吻合（含前导 " * "）
grep -c "公共导出" packages/vfsl/src/validate.ts → 1（L634；块 L633-641 实测 9 行）
grep -n '\* - `validateSnapshot(derived, snapshot)`' packages/vfsl/src/index.ts → 恰 L14
sed -n '141,156p' design.md | wc -l → 16（新 JSDoc 块 16 行 → +7 漂移正确；§8「9→17」为笔误）

# 指纹串仓内分布盘点（G2 门精确性依据）
grep -rn "整份 JSON 快照校验" --include="*.ts" --include="*.md" . →
  README.md:61（§4.5 显式整括号替换）/ validate.ts:2（描述性中文，非 token 域）/
  validate.ts:634（旧 JSDoc，D3 整块替换域）/ index.ts:15（孤儿本体，G2 目标）/
  validate-snapshot.test.ts:2（token 全文替换域）——迁移后 index.ts 内唯一可能残留源即孤儿续行

# 攻击点③修订：G3a 命令实测（迁移前红灯）
pnpm exec vitest run packages/vfsl/test/validate-logical-snapshot.test.ts --passWithNoTests=false
→ Test Files 1 failed (1) / Tests 29 failed (29) / exit 1（命令有效，假绿不可能）
```

### R1 证据（2026-08-22）

```text
npx vitest run packages/vfsl/test/validate-logical-snapshot.test.ts → 29 failed (29)
pnpm typecheck → exit 0
git ls-files | grep -E "^\.scratch|scratch-spec" → .scratch-review-spec.md / .scratch-spec-20.md / .scratch/vfsl-v1-parser/spec.md
grep -rc validateSnapshot → .scratch/vfsl-v1-parser/spec.md:4、.scratch-spec-20.md:1
grep -n "scratch" design(R1).md → 零命中
grep -n "validateSnapshot(" packages/vfsl/src/ → exit 2「Is a directory」（R1 坏命令实证）
grep -rn "validateSnapshot(" packages/vfsl/src/ → validate.ts:642 + index.ts:14
grep -n validateSnapshot packages/vfsl/src/index.ts → 3,14,23,35,73,78（L15-17 无 token）
vitest.config.ts → passWithNoTests: true；ci.yml → 两步 --passWithNoTests=false 先例
grep -n "0\.1\.10" pnpm-lock.yaml → 零命中
```
