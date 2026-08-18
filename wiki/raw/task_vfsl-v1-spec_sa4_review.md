# SA4 静态验尸报告 — VFSL v1 方言规格文档（issue #4）

**Date**: 2026-08-18
**被审对象**: commit `5145885`（交付物 `docs/vfsl/v1-spec.md` + `tests/` 验收机制 + `wiki/raw` 档案）
**Base**: `main`（`7317237`）
**Worktree**: `/home/wangjian/nomicore-refactor-vfsl-v1-`

---

## 0. 审查方法与证据等级

本任务为文档交付（无运行时）。SA4 以可复现命令取证，全部关键结论均有独立进程实跑输出支撑（按 SKILL 测试执行规范 `setsid nohup` 起独立进程）：

| 证据 | 命令 | 结果 |
|---|---|---|
| 验收默认路径 | `python3 tests/acceptance/vfsl_spec_acceptance.py` | GREEN 21/21，exit=0 |
| exemplar 绿路径 | `… --spec tests/acceptance/exemplar/spec-exemplar-v1.md` | GREEN 21/21，exit=0 |
| §4.1 基线副本 | `awk '/^````markdown$/{flag=1;next} /^````$/{flag=0} flag' wiki/raw/task_vfsl-v1-spec_design.md > 副本` 后 `--spec 副本` | GREEN 21/21，exit=0，输出与设计 §5 A″ 留档**逐字符一致** |
| 变异判别力 | 17 个变异体（§3.2）逐个 `--spec` | 全部 exit=1，精确命中预期检查组 |
| 逐字一致性 | `diff <(awk 提取基线) docs/vfsl/v1-spec.md` | 零差异（17527 字符 / 31140 字节均相等，`b == d` 为 True） |
| Scope Guard | `git diff --name-only main HEAD` + BLACKLIST/DENY 正则 | **1 项 BLACKLIST 命中**（§4），DENY 零触碰 |

---

## 1. 审核结论（SKILL 验尸清单八项）

1. **设计一致性**：✅ 一致。交付物与 SA1 R3 设计 §4.1 基线**逐字一致**（攻击面 2，§3.1）；SA2 R2-2 N1~N5 全部兑现（攻击面 3，§3.3）；design §6 ALLOW/DENY 与 actual diff 比对除 TASK.md 外全部落位（§4）。
2. **读写路径一致性**：N/A（纯文档交付，无数据源；与 SA2 R2-4 同判）。
3. **静默失败**：N/A（无运行时路径）。规格文本自身的「静默决定」审查已由 SA2 两轮覆盖，SA4 复核 N1~N5 落点无一缺失（§3.3）。
4. **降级方案**：✅ 安全。规格 §9 的四项「实现自由度」均为显式成文的边界决定（BOM 剥离不报错等），非掩盖性降级；与 SA2 R2-4 结论一致。
5. **极端攻击**：✅ 未发现新漏洞。规格 19 错误码、判定顺序 7 条 + 分相位、三分类（含标记归类）经 SA4 对 N1~N5 触发例逐条推演均有唯一答案（§3.3）。
6. **错误处理**：✅ 完整。错误码总表 E100~E106 / E201~E203 / E301~E309 计 19 行，与正文「错误码共 19 个」计数一致；传递通道（message 前缀 `VFSL-E<编号>: `）成文。
7. **架构评估**：✅ 可行。文档即产品，验收机制（结构解析而非源码 grep）与任务形态匹配。
8. **过度设计**：✅ 精简。交付物为设计基线逐字成文，SA3 未自行增删一字；验收脚本零依赖纯 stdlib。

---

## 2. 五个重点攻击面结论（总控指定）

### 攻击面 1：SA6 验收脚本断言是否被弱化 — **未弱化** ✅

git 历史仅一个 SA3 commit（SA6 两文件与交付物同 commit 入库），无法用版本历史直接分离 SA6 原版。SA4 按 SA2 R2-0 附注指定的方法——**以任务简报「SA6 红灯契约锚定记录」为最终比对基准**——做了三重独立比对：

1. **代码 vs 锚定记录机器契约表（逐条）**：脚本 `tests/acceptance/vfsl_spec_acceptance.py` 的每个检查组与锚定记录表格逐项对照——章节关键字与六标记标题完全相等（G2，`h["text"] == m`）；三列语义表表头三关键词 + PATCH 列枚举 `^(可下钻|部分下钻|不可下钻)` + 三列非空（G7）；EBNF tokenize + 递归下降结构校验（G4）；LHS 十生产式 `REQUIRED_LHS` 与终元 `REQUIRED_TERMINALS + 六标记 + "?"`（G5/G6）；禁止清单六项正则 + `code.startswith("VFSL-")` + 行列正则（G8/G9）；注释规则 12 关键词含「机器」（G10）；大小写六拼写 +「未知名」（G11）；信封四字段 + 只消费/方言路由/出范围（G12）；只增不改 + 自述（G13）；附录溯源三关键词（G14）；fixture 词法扫描含 Y 大写变体判失败（G15/G16，`fixture_problems`）——**断言数量（G1~G16，G7 展开 ×6 = 21 项）与严度（每处正则/枚举/前缀检查）均与锚定记录一致，无一处放宽**。
2. **行为 vs SA3 交付前留档**：SA1 在 SA3 交付前三次实跑（设计 §5 A/A′/A″）与 SA6 锚定记录的输出格式/明细文本已留档。当前脚本对 §4.1 基线副本的实跑输出与设计 §5 A″（R3，17527 字符）**逐字符一致**（含 `[PASS] G1 … — ../../../tmp/… 存在（17527 字符）` 的相对路径细节与 21 项 detail 文本）；exemplar 绿路径 21/21、红灯形态（文档缺失时 16 项、`[FAIL] G1 … 规格文档缺失: docs/vfsl/v1-spec.md`）亦与锚定记录一致。若 SA3 曾改动任何断言或输出字符串，此逐字符一致不可能保持。
3. **判别力 vs 锚定记录变异**：SA6 原版变异（删 `### Pattern` 章节 + 删 `UnionType` 生产式）在当前脚本上复现出**同形结果**——exit=1，精确报 `G2 缺少标记类型章节（Pattern）`、`G7 标记语义定义·Pattern`、`G5 缺少生产式: UnionType`。

**结论**：SA3 未触碰 SA6 产权文件（design §6 ALLOW LIST 标注 `[SA6 owned] 不改`，比对证实）。

### 攻击面 2：v1-spec.md 与 SA1 §4.1 逐字一致性 — **完全一致** ✅

用设计 §5 A″ 原文提供的提取命令（四反引号 ` ````markdown ` 围栏 awk 提取）抽取 R3 基线，与交付物 diff：**零差异**。字符数 17527（与设计/SA2 复核口径一致；磁盘 31140 为 UTF-8 字节数，SA2 R2-0 已同口径说明）。`python3 -c 'b == d'` 逐字符比对为 `True`。

### 攻击面 3：SA2 R2-2 N1~N5 落点兑现 — **5/5 全部兑现** ✅

SA2 授权「并入后不再送 SA2 复审，SA4 复核时按 R2-2 核对落点」。逐条核对结果（行号为交付物 `docs/vfsl/v1-spec.md` 行号）：

| # | SA2 要求 | 交付物落点 | 判定 |
|---|---|---|---|
| N1 | 判定顺序增补统一归属；`type type` 唯一答案；tokenizer 政策成文 | §4 判定顺序第 7 条（L308-315）：裸标记/`Record`/`Pattern` 引用、保留名后随 `<`、类型位 `type` → E100 锚该记号；声明名位保留名 → E303（`type type = string;` 与 `type any = string;` 同归）；「E301 仅适用于非保留名的标识符记号」；第 2/6 条加「保留名不适用」旁注（L297-298、L302-303）；「keyword 记号 vs 统一 Ident + 后置查表两种设计产出相同错误码与锚点」（L314-315）；E303 行与保留名段交叉一致（L348、L360-361） | ✅ |
| N2 | 三分类补标记归类；YPlainArray 写死一种 | §3「标记成员的形状归类」段（L149-155）：YMap/YArray/YXmlFragment → 容器形；YLeaf/Pattern → 标量形；**YPlainArray 同步物化上下文按标量形**；两触发例各给唯一答案（`M \| { y: number }` 全容器形合法；`YPlainArray<{a: string}> \| string` 全标量形非 E309） | ✅ |
| N3 | 单错误改分相位表述 | §4「错误数量与恢复策略」（L266-272）：词法/语法相位**遇到处即时失败即报**；仅全量解析成功才进引用/语义相位（E106 与 E301/E302/E304~E309），相位内取文本位置最前；判定顺序末段相位限定旁注（L317-319）——`type A = B; type C = (` 现有唯一答案（报 E100） | ✅ |
| N4 | `char` 双语义 + EOF 视同 eol | §2 语法注记 10（L94-99）：StringLiteral 的 char **不含行终止**；注释产生式的 char **含行终止**；EOF 无换行**视同 eol** 终结行注释（合法，不报错）——三要素齐备，且 EBNF 围栏块未动（注记在围栏外，符合设计「围栏块零改动」声明） | ✅ |
| N5 | 「任一成员未声明的键」→「未被任何成员声明的键」 | §3 YMap 小节（L195-197）：「键空间为各成员字段键集之**并集**（封闭）——**未被任何成员声明的键**不属于该联合的键空间」，全文无「任一成员未声明的键」残句 | ✅ |

### 攻击面 4：Hard Gate #9 版本 bump — **确认不适用** ✅

`find . -name package.json`（排除 .git）零命中——本仓库无 package.json、无版本可 bump，门禁不适用（与任务简报「边界与纪律」预判一致）。同时确认：`scripts/` 目录不存在（SA6 锚定记录「无需新增」成立——验收机制零端口、零测试包）。

### 攻击面 5：DENY LIST 零触碰 — **确认** ✅

`git diff --name-only main HEAD` 共 9 个文件，对 design §6 DENY LIST 全部正则比对：
- `docs/adr/**`、`packages/**`、`src/**`、`apps/**`、`node_modules/**`、`scripts/test-lock.sh`、`LICENSE`、`.gitignore`、`.mabf-bg/**` —— **零命中**；
- `tests/**` 仅 SA6 两文件，无第三文件；
- `.mabf-bg/` 保持 untracked 未提交 ✅。

但 ALLOW 侧发现 1 项 BLACKLIST 违规，见 §4。

---

## 3. 交付物内容质量抽查（补充）

### 3.1 AC 对照（issue #4 五条验收标准）

| AC | 证据 | 判定 |
|---|---|---|
| #1 EBNF 覆盖 PRD 全部允许语法 + fixture 构造 | PRD #3 Implementation Decisions 语法子集九要素（类型别名/封闭对象/`?:`/五原始类型/字面量联合/`T[]`/`Record`/`string & Pattern`/注释）逐项映射到 EBNF 生产式（L38-64）；fixture 侧由 G15/G16 两侧配对机械化（完整推导归 issue #5，符合 SA6 机制形态声明） | ✅ |
| #2 六标记语义定义 | 六个 `### <标记>` 章节（标题与标记名完全相等），各含三列表（Yjs 物化含义/写入粒度/PATCH 可否下钻） | ✅ |
| #3 禁止清单 + 结构化错误（含行列） | 六项逐行（L276-283），错误类型全为 VFSL- 前缀码，行列列非空（line/column） | ✅ |
| #4 注释规则成文 | §5 三态表 + 忽略/捕获边界（`/**/` 特例、不嵌套、E203）+ 挂载三类目标 + 7 行挂载示例表 + E305 悬空拒绝 | ✅ |
| #5 大小写契约 | §6 精确拼写 + 变体「未知名」报错 + 不纳入保留名立场（与 §4 保留名集合交叉一致） | ✅ |

### 3.2 变异判别力测试（17 变异体，全部在 /tmp 副本上，交付物未动）

| 变异 | 预期 | 实际 | |
|---|---|---|---|
| M1 删 `### Pattern` 整章 | G2+G7 | exit=1，G2+G7(Pattern) FAIL | ✅ |
| M2 EBNF 删 `UnionType` 生产式 | G5 | exit=1，G5 FAIL | ✅ |
| M3 EBNF 生产式删终止符 `;` | G4 | exit=1，G4 FAIL（第47行: 意外的符号 "="） | ✅ |
| M4 YMap 表 PATCH 列改「视情况」 | G7 | exit=1，G7(YMap) FAIL | ✅ |
| M5 错误码去 `VFSL-` 前缀 | G9 | exit=1，G9 FAIL | ✅ |
| M6 §5 删「机器」 | G10 | exit=1，G10 FAIL | ✅ |
| M7 §6 删「未知名」 | G11 | exit=1，G11 FAIL | ✅ |
| M8 信封 `"version": 2` | G12 | exit=1，G12 FAIL | ✅ |
| M9 删「只增不改」 | G13 | exit=1，G13 FAIL | ✅ |
| M10 附录删「issue #9」 | G14 | exit=1，G14 FAIL | ✅ |
| M11 fixture 引入 `YLEaf` | G16 | exit=1，G16 FAIL（精确报变体清单） | ✅ |
| M12a/M12b fixture 块缺失/移出附录 | G15 | exit=1，G15 两种失败模式分别报出 | ✅ |
| M13 删 mapped type 行 | G8 | exit=1，G8 FAIL | ✅ |
| M14 fixture 删 `Record<` 行 | G16 | exit=1，G16 FAIL | ✅ |
| M15 EBNF 删 `unknown` 终元 | G6 | exit=1，G6 FAIL | ✅ |
| M16 fixture 删全部 JSDoc | G16 | exit=1，G16 FAIL | ✅ |

**结论**：G2~G16 每个检查组均具备判别力，断言非恒绿、非摆设；与 SA6 锚定记录「绿路径与判别力验证」结论互证。

### 3.3 源码 GREP 断言禁令（SKILL §1.7）

验收脚本对交付物做**结构解析**（EBNF 真实 tokenize + 递归下降校验；fixture 词法扫描：注释剥离、JSDoc 原文捕获、记号与相邻符号配对；表格按列位/枚举校验），不读取任何「被测代码」做字符串形状断言——SA6 docstring 声明与实现相符。**合规** ✅。

---

## 4. REJECT 项（唯一阻塞）

### R-1【BLOCK】`TASK.md` 进入 commit — blacklist-violation

- **证据**（可复现）：
  ```
  $ git -C /home/wangjian/nomicore-refactor-vfsl-v1- diff --name-only main HEAD
  TASK.md            ← 命中 BLACKLIST 模式 ^TASK\.md$
  docs/vfsl/v1-spec.md
  …（其余 7 个文件全部落位 ALLOW LIST）
  $ grep -E '^TASK\.md$' /tmp/sa4-actual-files.txt
  TASK.md
  ```
- **规则**：SKILL §1.1 步骤 5b 反向 BLACKLIST（2026-06-13 P0 立法，PR #253 复盘）：`^TASK\.md$`——「issue-runner runtime 文件，不该进 commit」——**「一旦出现在 diff 里就 REJECT，不论是否在 ALLOW LIST」**，抹到即 BLOCK。
- **影响**：① runtime 任务卡（含 run_id、Working Directory 等机器字段）混入交付历史；② 本仓库后续即接 issue #5~#9，届时 issue-runner 复写 TASK.md 会在本分支产生伪 diff / 污染下一任务的 diff 审查——正是 PR #253 事故模式的复现条件；③ `.gitignore` 仅忽略 `.dsh/`，TASK.md 无忽略规则，commit 后将长期滞留。
- **对 SA1 ALLOW LIST 的说明**：design §6 把 `TASK.md` 列入 ALLOW LIST（「总控任务卡（已在工作区，**不改**）」）。BLACKLIST 立法明文「不论是否在 ALLOW LIST」优先，且「不改」的意图是"不动该文件"，`git add` 使其首次进入版本历史本身即属写入。此项**附注回流 SA1**：后续设计的 ALLOW LIST 不应收录 runtime 文件（非阻塞，SA1 知悉即可）。
- **回流目标**：**SA3**。修复动作：`git rm --cached TASK.md && git commit --amend`（交付物与验收机制零改动；不涉及 push，本任务未推送）。
- **修复后复核口径**：SA3 修复仅需 SA4 复核 diff 中 `TASK.md` 消失且其余 8 文件与 `5145885` 内容一致——本报告 §1~§3 的全部内容面结论（逐字一致、N1~N5、GREEN 21/21、判别力、DENY 零触碰）对修复后 commit 继续有效，无需重审内容。

---

## 5. 次要观察（不阻塞，如实记录）

- **O-1**：G9 对禁止清单表头的校验是数据行位置索引（`row[2]`/`row[3]`），未显式断言四列表头文字——SA6 原版设计即如此（比对已锁定脚本未动），锚定以列位实现。供 issue #5 测试设计参考。
- **O-2**：G7 每标记语义表只要求 ≥1 行合规数据行（不校验全表行数）——同属 SA6 原版设计，非弱化。
- **O-3**：TASK.md 工作区原版无 git 历史基准可比对；其内容与 issue #4 任务卡自洽，无篡改迹象。
- **O-4**：`wiki/raw/task_vfsl-v1-spec_dispatch.md` 工作区未提交改动为总控运行时派单记录（第 8 行，SA4 派单），不属 SA3 commit、不属越界。

---

## 6. 动态审核重点（交 SA7）

本任务为纯文档交付、零运行时、零依赖——**无 SA7 动态验证项**。唯一后续验证点属下游任务职责：EBNF → fixture 的完整推导由 issue #5 parser 实现时以 `vfs3.assets` 正例回归（规格附录已自含 fixture，SA2 R2-5 红灯思路已列输入清单）。

---

## 7. 裁决理由

内容面**全绿**：交付物与 SA1 R3 基线逐字一致；SA6 验收脚本三重比对确认未被弱化；N1~N5 全部兑现；实跑 GREEN 21/21；17 变异体判别力全部分辨；DENY LIST 零触碰；Hard Gate #9 不适用。SA3 的成文执行忠实且克制（一字未增删）。

但 `TASK.md` 进入 commit 精确命中 P0 反向 BLACKLIST——该立法无豁免条款、明确「不论是否在 ALLOW LIST」，且其防护场景（issue-runner runtime 文件被 commit 后遭下一任务复写）在本仓库即将连续开工 issue #5~#9 的现实下必然触发。按立法，SA4 不得以内容面质量覆盖此 BLOCK。

修复成本极小（一条 git 命令），修复后按 §4 R-1 给出的复核口径直接放行。

**Verdict（R1，已被 §8 R2 终审取代）**: reject

---

## 8. R2 复核（修复后终审，2026-08-18）

**被审对象**: commit `c1fc25b`（`5145885` 经 R1 §4 指定动作 `git rm --cached TASK.md && git commit --amend` 而来）
**复核范围**: R-1 修复验证 + 验收脚本抽跑 + §1~§3 内容面结论延续性确认（按 R1 §4 预设口径，内容无需重审）。本节为最终裁决节。

### 8.1 R-1 修复验证（git 证据）

| # | 复核项 | 命令 | 结果 |
|---|---|---|---|
| 1 | TASK.md 已移出 diff | `git diff --name-only main HEAD` | 恰 8 文件，无 TASK.md ✅ |
| 2 | 8 文件与原 commit 字节级一致 | `git diff 5145885 HEAD`（全量） | **仅 TASK.md 一项**（deleted file mode），其余 8 文件零差异 ✅ |
| 3 | 真 amend、无夹带 | `git rev-parse 5145885^` 与 `c1fc25b^` 同为 `7317237`；reflog 记录 `commit (amend)` | ✅ |
| 4 | BLACKLIST 全组复扫（P0 正则） | 8 文件对 `package-lock.json$ / yarn.lock$ / .DS_Store$ / ^TASK.md$ / ^[^/]*\.bak$` | 零命中 ✅ |
| 5 | 交付物工作区 clean | `git status --short` | 8 文件无改动（唯一 `M` 为 `wiki/raw/task_vfsl-v1-spec_dispatch.md`，R1 O-4 已判总控运行时派单记录，不属 SA3 commit） ✅ |

修复后 8 文件清单（与 R1 §1/§2 结论的 ALLOW 落位一致，TASK.md 移除后**全部落位、无例外**）：`docs/vfsl/v1-spec.md`、`tests/acceptance/exemplar/spec-exemplar-v1.md`、`tests/acceptance/vfsl_spec_acceptance.py`、`wiki/raw/20260818-prd-vfsl-v1.md`、`wiki/raw/task_vfsl-v1-spec.md`、`wiki/raw/task_vfsl-v1-spec_design.md`、`wiki/raw/task_vfsl-v1-spec_dispatch.md`、`wiki/raw/task_vfsl-v1-spec_sa2_review.md`。

TASK.md 现为 **untracked 工作区文件**（`git rm --cached` 的预期行为：仅移出 index、保留磁盘）：不进 commit、不出现在 diff——PR #253 事故模式（issue-runner 复写产生伪 diff / 污染下一任务审查）的触发条件已消除。R1 §4 附注回流 SA1（ALLOW LIST 不应收录 runtime 文件）继续有效，非阻塞。

### 8.2 验收脚本实跑（独立进程，SKILL 测试执行规范）

```
python3 tests/acceptance/vfsl_spec_acceptance.py   # setsid nohup 独立进程
exit code = 0
[PASS] ×21，[FAIL] ×0
尾行: GREEN（验收通过）: 21/21 项全部通过
```

与 R1 §0 证据第 1 行同口径（GREEN 21/21，exit=0），复确认脚本与规格文档在修复后 commit 上行为不变。

### 8.3 §1~§3 内容面结论延续性

**论证基点**：`git diff 5145885 c1fc25b` 仅含 TASK.md 删除 → 8 个交付文件在 `c1fc25b` 树中的内容与 `5145885` **字节级相同**；且 8.1 #5 确认工作区与 HEAD 一致 → R1 基于该内容产生的全部内容面结论对 `c1fc25b` 原样成立：

- **§1 八项验尸**：逐字一致性、N1~N5 触发例推演、错误码计数等均针对未变内容 → 延续 ✅；Scope 比对由「除 TASK.md 外全部落位」升级为「全部落位」。
- **§2 五攻击面**：攻击面 1（SA6 脚本三重比对）、2（逐字一致 17527 字符）、3（N1~N5 落点及行号锚）对象为未变文件内容 → 延续 ✅；攻击面 4（Hard Gate #9）与 5（DENY 零触碰）的检查对象是新 diff 的严格子集（9 文件 − TASK.md）→ 结论只会更强，不会失效 ✅。
- **§3 质量抽查**：AC #1~#5 对照、17 变异体判别力、源码 grep 断言禁令合规，均针对未变内容 → 延续 ✅。

### 8.4 新问题扫描

- amend 未改 commit message（仍为 `feat(docs): 交付 VFSL v1 方言规格文档 — issue #4`），父节点唯一且相同，无夹带 commit、无后续新 commit。
- 无新增 creep：untracked 三项为 `.mabf-bg/`（design DENY 要求保持 untracked，✅）、`TASK.md`（runtime 文件回归 untracked 本位）、本报告自身（`wiki/raw/task_*` 白名单范畴）。
- 未发现新阻塞项，无新增次要观察。

### 8.5 R2 终审理由

R1 §7 的 reject 有且仅有一个理由（R-1 命中 P0 BLACKLIST）。该缺陷已按 R1 §4 指定动作精确修复且证据闭合（8.1）；内容面全绿经字节级同一性 + 实跑复确认完整延续（8.2/8.3）；无新问题（8.4）。按 R1 §4 预设备注「修复后按复核口径直接放行」执行终审。

**Verdict（R2，已被 §9 R3 终审取代）**: pass

---

## 9. R3 复核（SA7 F-1 修复后终审，2026-08-18）

**被审对象**: commit `1599241`（`c1fc25b` 经 SA7 §5.5 方案 A 修复后 amend 而来；amend 链 `5145885` → `c1fc25b` → `1599241`，父节点同为 `7317237`，reflog 三条 `commit (amend)` 记录在案）
**评审输入**: SA7 `wiki/raw/task_vfsl-v1-spec_sa7_report.md` §5（F-1 fail-needs-fix）与 §5.5 修复建议（方案 A）+ §5.5 修复后复核口径 ①②③ + 总控 R3 派单五项职责
**复核范围**: F-1 修复落点核对 + true/false 错误码唯一性 + 交付物/基线逐字一致 + 验收抽跑 + Scope 复扫。本节为最终裁决节。

### 9.1 修复落点核对（SA7 §5.5 方案 A，四处段落级消歧）

`git diff c1fc25b 1599241 -- docs/vfsl/v1-spec.md` 恰 4 个 hunk，逐处与 SA7 §5.5 方案 A 比对：

| # | SA7 方案 A 要求 | 交付物落点（现行行号） | 实文 | 判定 |
|---|---|---|---|---|
| 1 | L117 注释改为 `// VFSL-E301：true/false 未声明（布尔字面量不进入 LiteralType，注记 8；按未知名报错）` | 微示例 D（L119） | 与方案 A 建议文本**逐字相同** | ✅ |
| 2 | L336 E100 行删去「布尔字面量联合」 | 错误码总表 E100 行（L339） | 已删，其余条件（括号分组、负数/小数、裸 Pattern、判定顺序第 7 条、未知记号）原样保留，E100 catch-all 性质不变 | ✅ |
| 3 | （§5.2 加重项要求收敛）两种 tokenizer 读法等价保证补完备边界 | 判定顺序第 7 条尾注（L317-320） | 新增「keyword 记号的分类以保留名集合（§4）为完备边界——集合之外不存在被分类为 keyword 的标识符（`true`/`false` 即属此类…）：两种 tokenizer 设计对非保留名标识符一律按普通 Ident 读法处理，错误码与锚点一致」——精确堵上 SA7 指出的「等价保证只对保留名成立」豁口 | ✅ |
| 4 | 可在注记 8 补「true/false 词法上是 Ident：未声明引用按 E301，亦可被声明为普通别名（与 §6 yleaf 同构）」 | §2 注记 8（L85-89） | 增补句与建议同义成文（`**VFSL-E301**` 加粗 + §6 同构引用） | ✅ |

**设计基线侧同步**（同一 commit 内，均落 ALLOW LIST 文件）：§3 D6 决定撤销 true/false 的 E100 归属（注明 R3 修复轮修订及 `null` 不涉越界的理由）；§4 基线头更新为「R3 修复轮基线（现行版，17816 字符）」并保留 R1/R2/R3 历史字符数记录；§4.1 基线镜像四处同款消歧；§5 新增 A‴ 留档（提取命令 + 21 项 PASS 明细 + exit=0）+ 文首「R3 修复轮修订记录」。方案 B（保留名路线）未采用——保留名集合仍 16 项穷举、不含 `true`/`false`，与方案 A 立场自洽。

### 9.2 true/false 错误码唯一性（SA7 复核口径②，两种 tokenizer 读法推演）

对 `type D = true | false;` 在全部规范性条款下逐条推演：

- **文法（§2）**：`true`/`false` 匹配 `Ident = letter { letter \| digit \| "_" }`（ASCII 冻结）→ `TypeRef = Ident` → 可推导为两个 TypeRef 的联合（SA7 V3 推导器实证的 AST 不因修复改变——修复未动 EBNF 围栏块）；
- **判定顺序（§4）第 1~5 条**：无 `interface`/声明名后 `<`/`extends`/字段名位 `[`/`any`，均不命中；**第 6 条**：文无 `<`，不适用；**第 7 条**：要求保留名记号——新增尾注明文保留名集合是 keyword 分类的完备边界，`true`/`false` 在集合外 → 非保留名记号，不命中；
- **保留名集合**：16 项穷举（`type`…`YXmlFragment`）不含 `true`/`false`；
- **E301 条款**：非保留名标识符、模块全量解析后未声明 → **E301**（锚引用记号；相位内取文本位置最前 → 首个未声明引用 `true`）；
- **注记 8（新增）**：明文「未声明引用按 VFSL-E301」；
- **§6 先例**：`yleaf` 同构条款原样有效（`type yleaf = string;` 合法声明 / 未声明引用 E301）——`type true = string;` 同理为合法别名声明（非保留名，不落 E303）。

**两种 tokenizer 读法收敛**：keyword 记号设计——`true`/`false` 在保留名集合完备边界之外，不被分类为 keyword，一律按普通 Ident 读法（尾注明文）；统一 Ident + 后置查表设计——Ident 记号查表得非保留名、未声明。两读法**同码（E301）同锚（`true` 引用记号）**。SA7 §5.2「tokenizer 设计选择翻转错误码」的加重项已由第 7 条尾注消解。

**残句扫描**：`grep -n 'true\|false'` 全文仅 6 处——L19/L462 为信封 JSON 的 `ok: true/false`（非类型语法）、L85-89 注记 8、L119 微示例 D、L319 尾注；**无任何残留 E100 归属**。微示例 A/B/C 的 E100/E100/E202 标注与总表仍一致（E100 行删项不影响其余构造）。`null` 未入注记 8 新句是精确而非遗漏：`null` 是 PrimitiveType 终元（类型位合法），与 `true`/`false`（仅经 TypeRef 入文法）性质不同，设计 D6 修订已分别说明。

### 9.3 交付物与设计基线逐字一致（A‴ 提取命令复跑）

按设计 §5 A‴ 原文提取命令（四反引号围栏 awk）独立复跑：

```
$ awk '/^````markdown$/{flag=1;next} /^````$/{flag=0} flag' \
    wiki/raw/task_vfsl-v1-spec_design.md > /tmp/vfsl-spec-check-r3fix/v1-spec-r3fix.md
基线副本与 docs/vfsl/v1-spec.md：17816 字符 / 31694 字节均相等；cmp 零差异（exit=0）；
python3 逐字符比对 b == d → True
```

与 R2 §8 攻击面 2 同口径（当时 17527 字符）；17816 与设计 §4 基线头、A‴ 留档、commit message 三处声明一致。

### 9.4 验收抽跑（SA7 复核口径①，独立进程双路径）

按 SKILL 测试执行规范 `setsid nohup` 独立进程：

| 路径 | 结果 |
|---|---|
| 默认 `python3 tests/acceptance/vfsl_spec_acceptance.py` | `[PASS] ×21`（G1 报 `docs/vfsl/v1-spec.md 存在（17816 字符）`），尾行 `GREEN（验收通过）: 21/21 项全部通过`，**exit=0** ✅ |
| A‴ 基线副本 `--spec /tmp/vfsl-spec-check-r3fix/v1-spec-r3fix.md`（cwd=tests/acceptance 复现留档相对路径） | `[PASS] ×21`，尾行 GREEN 21/21，**exit=0** ✅；21 条 [PASS] 明细与设计 §5 A‴ 留档**逐字一致**（含 G1 相对路径细节；留档省略 `====` 装饰分隔线系 A′/A″ 既有记录惯例，非新增偏差） |

与 SA7 预判吻合（§5.5：两案均不触碰 G1~G16 扫描面）。SA6 验收脚本自 `5145885` 起三轮 commit 字节级零改动（`git diff 5145885 1599241 -- tests/` 为空），R1 §3.2 十七变异体 + SA7 V2 八变异体的判别力结论继续有效，无需重跑。

### 9.5 Scope 复扫

| # | 复核项 | 结果 |
|---|---|---|
| 1 | `git diff --name-only main HEAD` | 恰 8 文件（与 R2 §8.1 清单相同），**无 TASK.md**（仅 untracked 于工作区） ✅ |
| 2 | BLACKLIST P0 正则组（package-lock/yarn.lock/.DS_Store/^TASK.md$/*.bak） | 零命中 ✅ |
| 3 | DENY LIST（docs/adr、packages、src、apps、node_modules、scripts/test-lock.sh、LICENSE、.gitignore、.mabf-bg/**） | 零触碰；tests/** 仍仅 SA6 两文件 ✅ |
| 4 | 修复 commit 改动面 | `c1fc25b → 1599241` 仅 2 文件（交付物 + design.md），均在 ALLOW LIST，无新增文件 ✅ |
| 5 | SA6 产权文件 | 三轮 commit（5145885/c1fc25b/1599241）间 `tests/` 零 diff ✅ |
| 6 | 工作区状态 | 8 个交付文件对 HEAD clean；`M dispatch.md` 为总控运行时派单记录（第 8~13 行，含本次 R3 派单，R1 O-4 同判）；untracked `.mabf-bg/`（DENY 要求保持 untracked ✅）、`TASK.md`（runtime 本位）、SA4/SA7 报告（`wiki/raw/task_` 白名单范畴） ✅ |

### 9.6 新问题扫描

- **无新阻塞、无新次要观察**。四处消歧均为段落/列表项级增补与措辞替换，无新增标题、无新增表格、EBNF 围栏块零改动（与 A‴ 声明一致，diff 佐证）。
- 修复时机合规：§8「只增不改」约束不限制首次发布前修订（SA7 §5.4-4 同判）；E100 行删项是**纠正**而非弱化——布尔字面量联合本就可推导，从未真正落入 E100 的「不可推导」条件。
- 修复未替 SA1 越权改语义：方案 A 即 SA7 §5.5 转录的 SA1 可选立场（与 §6 yleaf 先例对齐），且设计文档同步 D6 决定修订与修订记录——实质语义变更回 SA1 落档的纪律得到遵守。

### 9.7 R3 终审理由

SA7 F-1 是 R2 终审 pass 后由动态验证独立发现的唯一阻塞项（true/false 错误码归属矛盾 + tokenizer 读法翻转豁口）。该缺陷已按 SA7 §5.5 方案 A 精确修复：四处落点逐处核对吻合（9.1）；`type D = true | false;` 在文法、判定顺序、保留名集合、E301、注记 8、§6 全部规范性条款下唯一答案 **E301**（锚 `true` 引用记号），两种成文 tokenizer 读法收敛同码同锚（9.2）；交付物与设计基线 A‴ 口径逐字一致（9.3）；验收双路径独立进程实跑 GREEN 21/21 exit=0（9.4）；Scope/BOTTOM 线全部干净、SA6 产权零触碰（9.5）；无新问题（9.6）。SA7 §5.5 复核口径 ①②③ 全部满足。

**Verdict**: pass
