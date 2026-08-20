# SA4 静态验尸报告 — ROOT 约定实现：E310/E311（Issue #19）

**Date**: 2026-08-19
**Verdict**: **reject**
**评审对象**: SA3 commit `3429ae4`（base `e0c9cb2`，分支 `fix/issue-19-on-adr-union-representation`）
**任务类型**: 功能开发（SA6 红灯 34 + SA1 设计 §12 + SA2 pass 附 2 LOW + 2 INFO）
**Reject 性质**: ⚠️ **窄驳回——仅 commit 构成违规（TASK.md 黑名单），代码与测试本体全部通过全部门禁，修复为 commit 整形、零代码改动**

---

## 0. 审核方法与独立取证总览

SA4 不采信 commit message 与 dispatch log 自述，全部结论以独立取证为准（本轮为 R2 从头验尸，未复用 15:46 被中断轮的任何中间产物）：

| # | 取证项 | 方式 | 结果 |
|---|---|---|---|
| E1 | Scope 比对（§1.1 三步法） | ALLOW LIST 机械抽取 + `git diff --name-only e0c9cb2 3429ae4` + set 比对 + 白名单过滤 | 17/18 文件在 ALLOW ∪ 白名单；**`TASK.md` 黑名单命中** ❌ |
| E2 | BLACKLIST / DENY LIST | 5 pattern 黑名单 + design §12 DENY 7 文件逐一对照 | TASK.md ❌（黑名单）；DENY（index/parser/tokenizer/ir/spec/根 package.json/lockfile）**零侵犯** ✅ |
| E3 | 设计蓝本逐字比对 | shapes.ts / errors.ts / semantic.ts / package.json diff vs 设计 §3.1-§3.3 | 四文件逐字吻合蓝本；semantic.ts 零逻辑改动（删除行全为注释，5 行）；SA2 LOW-2 注释勘误已落实 ✅ |
| E4 | 闭环证明源码锚点核实 | semantic.ts walk / DFS / 聚合 + shapes.ts computeCls 第 2 步实读 | u1（E301 无条件入池）/u2（generic-diag 终判）/u3（未声明名显式入表）/cycle（回边全量收集）四锚点全部属实 ✅ |
| E5 | 判定矩阵根基核实 | localCls / synthesize / nodePos / clsOf 实读 | 六值分类与设计 §2.3 逐行吻合（YPlainArray 根位 scalar、map+container→container、generic-diag→unknown、ref/union 拒收）✅ |
| E6 | 零删除红线 | 基线 vs HEAD 逐文件 `it(` 计数 + `.skip/.only/.todo` 扫描 | 8 存量文件计数 11/33/16/19/79/7/7/8 逐一不变 + 新增 34 = **214**；skip/only/todo 零命中 ✅ |
| E7 | 红灯文件 SA3 零改动 | mtime 取证：`14:51:58`（早于 SA3 派发 15:34 与 commit 15:40） | SA3 未触碰 SA6 owned 文件 ✅ |
| E8 | §10 fixture 三副本逐字比对 | containers ×1 + cycle ×2 vs 红灯 canonical（:247-275）diff | 三副本 fixture 体 29 行逐字一致（spec §10 对照仅差模板字面量 `\\\\`→`\\` 转义口径，SA2 已核）✅ |
| E9 | §1.4 vitest 触发性自检（HG14） | `.github/workflows/ci.yml` + 根 `vitest.config.ts` + 9 文件包归属映射 | CI `test` job（ci.yml:38-39）每 PR 跑 `pnpm test` = `vitest run`；include `packages/*/test/**/*.test.ts` 覆盖全部 9 个 `*.test.ts`（均属 `packages/vfsl/test/`），无 `--filter` 窄化 → **通过** ✅ |
| E10 | §1.5 协议假设复核 | 设计 §8 定性核对 + fuzz 实测项独立复跑（`/tmp/sa4-fuzz-sim.mjs` 逐字复刻 mulberry32+49 记号+`floor(rand()*121)`） | 「无协议级假设」定性正确；**实测项复跑 `length===0` 计 26/3000，与 SA1/SA2 声明精确一致**；TOKENS 无 `ROOT` 记号确认（隐藏反向锁成立）✅ |
| E11 | §1.6 契约改动连锁 | src diff 中 throw/return/async/catch/export 模式扫描 + 全部删除行清单 | 零契约变化：新增代码全在 `collectShapeCandidates` 内 `return candidates` 之前；删除行 5 行全为注释 → 设计 §9「无契约改动」属实 ✅ |
| E12 | §1.7 源码 grep 断言禁令 | 9 个测试文件 `readFileSync` × `toMatch/toContain` 交叉扫描 | 零命中（全部断言经 `parseVfsl` 公共接缝行为断言）✅ |
| E13 | 测试对齐抽查（§6 八文件） | T2-T4 翻转 / G1 追加 / E305 行内特例 / aliasCount+1 / toHaveLength 83 / fuzz 后缀 / FIXTURES 七条 | 全部抽查点与设计 §6 规则吻合（详 §2.1）✅ |
| E14 | 独立复跑 | 后台独立进程（setsid nohup + disown，规范 2026-05-08） | `pnpm typecheck` **EXIT=0**；`pnpm test` **9 文件 214/214 全绿 EXIT=0**（红灯 34/34 + 存量 180 保持）✅ |

计数自洽：`it` 总数 214 = 基线 180（计数逐一不变）+ 红灯 34；`type ROOT = {};` 追加分布 9/39/10/5/44/9/3/16 与设计 §6.8 对齐面吻合（forbidden 44 = 39 pos + 5 语义 neg）；errors.ts 注册表键数实测 **21**；`@nomicore/vfsl` version **0.1.4**、无 `dependencies` 字段。

---

## 1. ❌ REJECT 项（唯一）：TASK.md 黑名单违规

**`verdict: blacklist-violation`（SKILL §1.1 5b，2026-06-13 P0 立法）**

| 项 | 内容 |
|---|---|
| 证据 | `git show 3429ae4 --stat` 第 2 行：`TASK.md \| 28 +-`——commit 显式携带 TASK.md 修改；diff 内容为 issue-runner 运行时文件被本任务复写（issue #8 残留 → #19 内容：AC 清单、`/home/wangjian/nomicore-fix-issue-19` 工作目录、分支名等运行时状态）。复现：`git -C <worktree> diff --name-only e0c9cb2 3429ae4 \| grep -x TASK.md` → 命中 |
| 法规 | BLACKLIST pattern `^TASK\.md$`（issue-runner runtime 文件，不该进 commit）。PR #253（issue #248）同型事故：上一任务 commit 的 TASK.md 被本任务复写后随 PR 携带。2026-06-13 立法明确「抹到即 BLOCK」，不接受 housekeeping 处置（PR #254 教训） |
| 影响 | 若该 commit 经 check.sh 推出 PR，integration 分支将携带与本任务无关的运行时状态文件；下一任务复写时再次产生跨任务 diff 噪声，并可能在 PR review 中掩盖真实改动面。**对 214/214 测试结果与 E310/E311 语义零影响**（该文件不参与构建/测试） |
| 回流目标 | **SA3**（commit 整形，零代码改动）：`git checkout e0c9cb2 -- TASK.md && git commit --amend --no-edit`（或等效 rebase），把 TASK.md 恢复为基线 blob `db2d979` 后整形 commit；其余 17 个文件保持逐字节不动。修复后 SA4 仅复核 commit 构成（diff 文件清单 + TASK.md blob id），不重跑全量验尸 |

**明确不属于本 REJECT 的事项**：wiki/raw/task_vfsl-root-convention*.md 四文件在 diff 内——命中白名单 pattern `^wiki/raw/task_` 且本就是任务产出面（简报 §六），合规。`parse-vfsl-root-convention.test.ts` 首次入库是 SA6 红灯文件的正常首次 commit（SA6 owned，mtime 证据见 E7），合规。

---

## 2. 审核结论

### 2.1 设计一致性：✅ 一致（代码与测试本体零偏离）

- **§3.1 errors.ts**：`E310: '310'` / `E311: '311'` 恰在 E309 之后追加；头注释 19→21 码改写与蓝本一致；注册表键数实测 21，与 spec §4 总表 7+3+11 对应（AC 第 9 条）。
- **§3.2 shapes.ts**：ROOT 完整性块插入位置（既有四条检查循环之后、`return candidates` 之前）、E310 锚硬编码 (1,1)、E311 逐声明体 `clsOf` + `nodePos` 锚、cycle/unknown continue 不裁决——与蓝本逐字一致；`declared`/`cls`/`aliases`/`add`/`clsOf(a.type, cls, declared)`/`nodePos` 在插入点全部在域且签名吻合（防「蓝本照抄但变量不在域」的隐性偏离已专项核实）。`if (c !== 'map')` 与设计 §2.2「c ∈ {scalar,container,mixed} → E311」在六值 Cls 下等价。资源界：E310 一次 Set 查询 + E311 每体一次 O(1) 查表 + 一次 O(n) 别名扫描，T-l 20k 链渐近不变（实测 820ms 内 8 用例通过）。
- **§3.2 配套 + SA2 LOW-2**：semantic.ts 头注释「位置并列在实际文法中不可构造」已修订为「唯一构造位：E305@1:1 × E310@1:1（码号 305<310）」——SA2 攻击点 #2 闭环；**零逻辑改动**（src 全部删除行 5 行均为注释行，机械验证）。
- **§3.3 版本**：0.1.3 → 0.1.4，无 `dependencies` 字段（Hard Gate #9 + 零运行时依赖红线双确认）。
- **§6 存量对齐抽查全吻合**：T2-T4 语义翻转（用例名改写意图 + `ok:false` + `/^VFSL-E310: /` + 1:1，断言强度增加非删除）；T5-T11 G1 追加（含 T10 BOM、T11 双输入）；jsdoc E305 行内插入特例 `'type A = string; type ROOT = {};\n/** 悬空文档注释 */'` 与 §6.6 逐字一致（append 会被 ROOT 吸收挂载的陷阱已正确绕开）；forbidden-matrix `expectOk(..., n)` → `n+1` 抽查 4/4、`expectDistinct` 双侧同变换抽查多组；sa7 `toHaveLength(82)→83` + 行尾注释改写 + fuzz 记号汤固定后缀 `+ '\ntype ROOT = {};'` + FIXTURES 七条全追加 ROOT + **SA2 LOW-1 勘误注释落盘**（「第 1~5 条完整 fixture 确定性 ok:true，第 6/7 条整条 ok:false 贡献负支路」）；cycle AC4 kind 文本 ROOT 行追加（`Root` 与 `ROOT` 并存合法正例口径）。
- **§7 边界裁决**（R-1 前导 `\|` 锚首成员 / R-3 逐体裁决 / R-4 E305 胜出 / R-7 generic-diag 不裁决）：实现行为与裁决全部一致（R-1 经 union.pos=首成员既有机制、R-4 经既有排序比较器 305<310 免改聚合，零 parser 改动）。
- **DENY LIST**：index.ts / parser.ts / tokenizer.ts / ir.ts / v1-spec.md / 根 package.json / pnpm-lock.yaml 零侵犯（E2）。

### 2.2 读写路径一致性：✅ 一致

E310/E311 与既有 E30x 经**同一通道**：`add` → `makeIssue`（冻结前缀）→ `collectShapeCandidates` 返回 → semantic.ts:174 并入同一 `candidates` 池 → :182-184 `(line, column, code)` 聚合取首 → 二态返回。无平行数据源、无绕过聚合的旁路；ok:true 路径的 IR 构造零改动。

### 2.3 静默失败：✅ 无

ok:true 逃逸狩猎（本任务最重攻击线，独立于 SA2 重打）：

- 新块全路径枚举：缺 ROOT → E310 必入池；ROOT 在场且 clsOf ∈ {scalar,container,mixed} → E311 必入池；map → 通过（正例意图）；**cycle/unknown → 不裁决**——闭环证明的四个源码锚点全部实读核实：未声明 ref 无条件 E301（walk 不短路）、generic-diag 无条件终判 E100/E301、`computeCls` 第 2 步把全部被引用未声明名显式入表（u3 兜底不可达）、环 ⇔ DFS 遇灰回边全量推 E106。补充攻击：`type ROOT = A; type A = A | { x: string };`（环分量 eff 移除后合成为 map，E311 通过）——A 自环必产 E106 在池，模块仍拒，与 SA2 死火 #1 结论一致。**无逃逸路径**。
- 空模块可达性：`parseVfsl('')` 无早退直达语义相位（红灯锁定用例已绿）。

### 2.4 降级方案：✅ 安全

E311 对 cycle/unknown 的不裁决是**真分层**而非降级：该条件下池内必有更根本的 E106/E301/终判候选承载错误身份（§2.3 闭环），模块不会被静默放行。与 E304/E309 既有纪律同构，非为缺陷兜底。

### 2.5 极端条件攻击：✅ 安全

- BOM 前缀 + 无 ROOT → E310@1:1（锚硬编码，BOM 剥离不占列）——存量 T10 已覆盖双形态。
- `root`/`Root`/`rOOT` 变体 → 普通别名，E310 照发（`declared.has('ROOT')` 精确匹配）；`Root`+`ROOT` 并存 → 合法（cycle AC4 文本锁定）。
- 重复 ROOT（E302 场景）：存在性满足不产 E310；每体独立 E311，min-position 裁定（红灯 E302@1:33 锁定用例用 map 体）。
- `type ROOT = YMap<string>;` → E311 不触发（map 形）+ E304 同位胜出（304<311）——设计 §4.2 第 4 行的行为落实，语义分层正确。
- 混合联合 ROOT（scalar+container）→ mixed → E311，与 E309 同位时 309<311 胜出——同上分层。
- `type ROOT = A | string; type A = A;` → cycle 分量 eff 移除 → synthesize='scalar' → E311@首成员 + E106 在池，双候选聚合裁定，无逃逸。
- 20k 链 + ROOT：线性扫描一次，无新递归/分配热点（T-l 实测绿）。

### 2.6 错误处理链路：✅ 完整

新块无 if/else 缺口：两分支（缺 ROOT / ROOT 在场）各有着落；`clsOf` 纯查表无 throw 风险（ref/union 的 localCls throw 是内部不变量，clsOf 先行分流，本次调用面不可达）；`makeIssue` 前缀通道冻结延续。顶层兜底 catch（index.ts）语义不变，无新增可达性。

### 2.7 架构评估：✅ 可行

实现落在设计指定的 shapes.ts 单点，零 parser/tokenizer/IR 改动，零 `// FIXME`/临时补丁/绕行，聚合机制零改动（E310@1:1 并列争议经既有码号兜底消化）。无退回 SA1 信号。

### 2.8 过度设计：✅ 精简

shapes.ts +24 逻辑行（含注释 +29）实现规格强制的两项检查；无新抽象层、无不可能边界防御、变更半径 = 设计 ALLOW LIST 精确范围（除 TASK.md 违规项）。

### 2.9 门禁专项（SKILL 立法项）

| 门禁 | 结论 |
|---|---|
| §1.1 Scope Creep | ❌ **blacklist-violation（TASK.md）**——本报告唯一 REJECT 源；scope creep 本身（白名单过滤后）同为此文件 |
| §1.3 E2E spec 触发 | N/A——全仓零 `*.spec.ts`（find 实测），仅 vitest `*.test.ts` |
| §1.4 vitest 触发性（HG14） | ✅ **通过**——9 个 `*.test.ts` 全部位于 `packages/vfsl/test/`，CI（ci.yml `test` job，`pull_request` + `push: main` 双触发）每 PR 跑 `pnpm test` → `vitest run`，根 vitest.config `include: ['packages/*/test/**/*.test.ts']` 全覆盖、无 filter 窄化 |
| §1.5 协议假设 | ✅ 通过——设计 §8 章节在，「无协议级假设」定性正确（纯解析器逻辑）；唯一实测项（fuzz 种子 20260819）SA4 复跑 **26/3000 精确复现**，无「应该/通常」类无据推断 |
| §1.6 契约连锁 | ✅ 通过——零契约变化（E11），caller 审计免触发；`parseVfsl` 签名/返回形状/前缀只增不改（E310/E311 为「增」） |
| §1.7 源码 grep 断言 | ✅ 通过——9 测试文件零 `readFileSync`×`toMatch/toContain` 反模式；红灯测试全部经 `expectIssueAt`/`expectSingleIssue`/`expectOk` 行为断言 |
| 零删除红线（红线 4） | ✅——基线 `it` 计数逐文件不变，skip/only/todo 零命中；T2-T4 为语义翻转（SA2 裁定合规），非删除 |

---

## 3. 动态审核重点（交 SA7）

> 前置：SA3 完成 TASK.md commit 整形后，SA7 动态验证以整形后 commit 为对象（TASK.md 修复不影响任何运行时行为，E14 复跑证据对整形后 commit 依然有效——SA7 仍须自行重跑）。

1. **红灯转绿 + 触发证据**（HG14）：`pnpm vitest run packages/vfsl/test/parse-vfsl-root-convention.test.ts` → 34/34；报告须含「vitest 触发证据」段落（引用 CI `pnpm test` 输出或本地等价命令实录）。
2. **全量 + typecheck**：`pnpm test` → 214/214、EXIT=0；`pnpm typecheck` EXIT=0（SA4 已独立复跑通过，SA7 复核）。
3. **零删除核对**：`it(` 计数 per 文件 vs 基线表；`grep -rn '\.skip\|\.only\|\.todo' packages/vfsl/test/` 零命中。
4. **注册表 + 版本**：errors.ts 键数 21 ↔ spec §4 总表逐码；version 0.1.4、无 dependencies。
5. **R-4 探针（SA2 INFO-3 落实位）**：`parseVfsl('/** x */')` → E305@1:1（非 E310，码号 305<310 并列胜出）；对照 `parseVfsl('/** x */\ntype ROOT = {};')` → ok:true（doc 挂载 ROOT，E305 消失）。此项无冻结用例，SA7 临时探针实录两行输出即可。
6. **fuzz 确定性复核**：两 fuzz 用例 okTrue/okFalse 双支路触达，并登记实测 `okTrue` 计数（预期记号汤 ≥26、fixture 变异 ≥5，两源合计；断言口径仍为 > 0）——SA2 LOW-1 勘误的运行时佐证。
7. **TASK.md 修复确认**：`git diff --name-only <base> HEAD` 不含 TASK.md（或 TASK.md blob == `db2d979`）；`git log --stat` 确认整形 commit 携带的原 17 文件内容与 3429ae4 逐字节一致。

---

**Verdict**: **reject**（窄驳回：`verdict: blacklist-violation`，TASK.md 进 commit——SA3 commit 整形后复审，仅复核 commit 构成；代码、测试、门禁全部通过，独立复跑 tsc EXIT=0 + 214/214 EXIT=0）

---

## R3 窄复审（commit 构成复核）— 2026-08-19

**评审对象**: SA3 整形后 commit `5764401`（parent 实测 = `e0c9cb2`，HEAD）。
**复审范围**: R2 §1 回流目标自定——「修复后 SA4 仅复核 commit 构成（diff 文件清单 + TASK.md blob id），不重跑全量验尸」。本轮严格按此执行，未重跑 E1–E14。

### R3 复审证据（C1–C5）

| # | 取证项 | 方式 | 结果 |
|---|---|---|---|
| C1 | 新 commit 构成 | `git diff --name-only e0c9cb2 5764401` + `git rev-parse 5764401^` | **17 文件**（3429ae4 为 18 = 17 + TASK.md）；parent = `e0c9cb2` ✅ |
| C1b | 黑名单复扫 | 5 pattern 对 17 文件清单 | `TASK.md` **不在 diff**；package-lock/yarn.lock/.DS_Store/.bak 零命中 ✅ |
| C2 | TASK.md blob 三方对照 | `git rev-parse 5764401:TASK.md e0c9cb2:TASK.md` | 双双 = `db2d979d3bfe6aca82af25a8d936d5e1a1201f2c`——精确恢复为 R2 处方指定的基线 blob ✅ |
| C3 | 旧 commit 对照 | `git diff --name-only e0c9cb2 3429ae4` | 18 文件，与 R2 验尸对象一致 ✅ |
| C4 | 17 文件逐字节一致 | 清单 set 比对 + 逐文件 `git rev-parse 5764401:<f>` vs `3429ae4:<f>` | set 完全一致（= 旧 18 减 TASK.md）；**17/17 blob id 全等**（4 src + 8 存量 test + 红灯 test + package.json + 4 wiki/raw），FAIL=0 ✅ |
| C5 | 工作区残留 | `git diff e0c9cb2 -- TASK.md` | 0 行——TASK.md 无未整形残留 ✅（工作区仅 dispatch.md 运行时追加与本报告 untracked，均为任务档案白名单面，不在 commit 内） |

### R3 复审判定

1. **R2 唯一 REJECT 项已消除**：TASK.md 移出 commit，且 blob 恢复为基线 `db2d979`（`checkout e0c9cb2 -- TASK.md + amend` 处方被精确执行）。黑名单其余 pattern 复扫零命中，无新增违规面。
2. **R2 全量验尸结论经 blob 等价性携带有效**：R2 E1–E14 的证据锚定对象是文件内容（blob），C4 证明 17 文件与 R2 验尸时逐字节一致，故 E1–E14（含 tsc EXIT=0 + 9 文件 214/214 + 全部门禁）对 `5764401` 全部成立，无需重跑。总控独立复验（tsc=0 + 214/214 + 排除 TASK.md 后 3429ae4..5764401 零差异）与本轮 C1–C5 互洽。
3. SA7 动态验证对象更新为 `5764401`：§3 清单第 7 条（TASK.md 修复确认）已由本轮 C1–C5 静态闭环，SA7 仍须自行重跑第 1–6 条并附触发证据。

**Verdict**: **pass**（R3 窄复审通过：R2 唯一驳回项 TASK.md 已整形移出且基线 blob 精确恢复，17 文件与 R2 验尸对象逐字节 blob 全等，R2 全部门禁结论经 blob 等价携带至 `5764401`；SA4 静态验尸闭环，交 SA7 动态验证 §3 第 1–6 条）
