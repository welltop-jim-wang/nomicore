# SA4 静态验尸报告 — SchemaSource 接缝与脚手架文件格式（Issue #25 / F1）

**Date**: 2026-08-20
**Verdict**: **pass**（**R2 终态**，2026-08-20：R1 唯一阻塞项 F1 已由 fix commit `a64f282` 按契约真实消除，经 R2 复审以错误码级运行时证据确认，全量复跑零回归；新增 F5 残留面 LOW 备案 → SA1。R1 reject 结论与 F2–F4 备案保留于正文，R2 复审节见文末。）

**被审对象**: worktree `/home/wangjian/nomicore-fix-issue-25` 分支 commit `6097691`（基点 `55a55c0`，恰 11 文件）。
**评审输入**: SA1 设计 R2 终稿、SA2 评审 R2 终态（pass，含 I1/I2 备案）、任务简报（含 SA6 R2 真红灯记录）。
**方法**: 逐行静态审读 `packages/vfsl/src/schemasource.ts`（476 行）+ 两个测试文件 + 4 个配置 diff；ALLOW/DENY set 比对；SA6 会话日志取证（三处编辑的 old→new）；并按 SA2 先例以 /tmp 独立探针**直接驱动真实实现**（node 24 type-strip import `src/schemasource.ts`，零 worktree 改动）实跑 43 场景（SA2 52 场景要点复验 + SA4 增量攻击面）；typecheck + 全量 vitest 后台独立进程亲跑（退出码留证）。

---

## 0. 亲跑验证记录（SA4 独立进程，退出码留证）

| # | 命令 | 结果 | 退出码 |
|---|------|------|-------|
| V1 | `pnpm typecheck` | 0 错误 | **0** |
| V2 | `pnpm exec vitest run`（全量） | **Test Files 17 passed (17) · Tests 356 passed (356)** | **0** |
| V3 | `pnpm exec vitest run packages/vfsl/test/DOES-NOT-EXIST.test.ts --passWithNoTests=false`（独立复跑 SA1 §10 / SA2 T1 声明） | `No test files found, exiting with code 1` | **1**（盲区消除成立） |
| V4 | SA4 探针 `/tmp/sa4-probe/probe.mts`（真实实现 43 场景，后台 setsid 进程） | `TOTAL 43 \| PASS 41 \| FAIL 2`（2 FAIL = F1，见下） | 1 |

日志：`/tmp/sa4-verify.log`（V1/V2）、`/tmp/sa4-flag.log`（V3）、`/tmp/sa4-probe.log`（V4）。/tmp 易失，关键输出已全文贴入本报告相应章节。

全量口径与简报预期一致（17 文件 / 356 用例 = 既有 342 + SA6 13 全绿 + scaffold 2）。12 红转绿成立，存量零回归成立。

---

## 1. 发现清单（分级）

### F1 【HIGH · 阻塞 · 回流 SA3】前导 trivia 区终止规则在「块注释与代码同行混排」下失守 → 代码行之后的伪指令仍被识别（身份劫持面）

**设计冻结语义**（设计 §3.1，R2 未改）：指令只在「空白行 / `//` 行注释 / **完整** `/* */` 块注释」组成的极大前缀内识别，**遇首个不属于上述三者的行（即首行代码）即停**；「代码行之后的 `// @id:` 不识别——防止模块正文散文注释劫持身份声明」。实现自己的文件头注释（`schemasource.ts:17-19`）与 `parseHeaderDirectives` 的 JSDoc（:211-214）均逐字复述了这条承诺。

**实现缺陷**（`packages/vfsl/src/schemasource.ts:231-236` 与 :222-227）：

```ts
if (BLOCK_COMMENT_RE.test(line)) {      // /^\s*\/\*/  —— 行首是块注释即命中
  if (!line.includes('*/')) {
    inBlockComment = true;
  }
  continue;                             // ← 无论该行 `*/` 之后还有什么，整行按 trivia 跳过
}
```

两类失守形状：

1. `/* note */ type ROOT = {};` —— 行首是块注释、行内含 `*/` → 整行被当 trivia 跳过，**扫描不终止**；
2. 跨行块注释的闭合行 `*/ type ROOT = {};` —— :223-224 检测到 `*/` 即关闸 `continue`，**忽略闭合符之后的代码**，下一行回到指令识别模式。

**可复现证据**（探针 S1a/S1b，驱动真实公共 API，2026-08-20 亲跑）：

```
fixture domains/x/schema.vfsl:
  // @lang: vfsl
  // @version: 1
  /* note */ type ROOT = {};     ← 首行代码（块注释只是行前缀）
  // @id: evil@1                 ← 设计：头部区已结束，不识别
  type ROOT2 = {};

load('evil@1') → RESOLVED(evil@1)      ← FAIL S1a：伪指令劫持成功，返回完整信封
（S1b 同构：/* ↵ */ type ROOT = {}; ↵ // @id: evil2@1 → load('evil2@1') → RESOLVED）
```

**影响**：

- 正文代码之后的注释行可提供/污染身份声明（`@id`/`@lang`/`@version` 三键皆同路）——击穿设计自 declared 的反劫持目标与「拿错文件当场报错」纪律；
- 现实形状举例：脚手架正文里保留一行注释掉的旧指令（`// @id: legacy@1`），若其前存在块注释前缀代码行 → 与真头构成**重复键** → 整个文件被 missing-directive 误拒（list() 一坏全拒放大为 CI 红）；或真 `@id` 缺失时注册成旧 id；
- 现状仓内 `domains/` 不存在 → 无现实数据损害；SA6 13 用例无此形状 → 无锚点破坏（全量 356 仍绿）。

**修复要求（SA3，最小变更）**：行内块注释闭合（含单行 `/* … */` 与闭合行 `*/`）之后，若最后一个 `*/` 之后仍残留非空白内容，则该行按「首行代码」处理——终止前导区扫描（既不再识别指令、也不再继续 trivia 前缀）。修复后 F1 两形状均应落 missing-directive（三键不全）。修复不触及任何既有绿灯（可复跑本报告 V4 探针 + 全量 vitest 验证）。

### F2 【LOW · 备案 → SA1】设计 §3.2 行模式 regex 与自身注脚矛盾（值含冒号），实现取注脚一侧

设计冻结 regex `/^\s*\/\/\s*@(\w+)\s*:\s*(.*?)\s*$/` 允许值含冒号（`@lang: vfsl:x` → 值 `vfsl:x` → dialect-mismatch），同行注脚却写「恰一个冒号」。实现取 `([^:]*?)`（`schemasource.ts:198`）执行注脚语义：值含冒号的行不匹配 → 按散文忽略。探针 OBSV S2：`@id: a:b@1` → unknown-id（设计字面 regex 下会登记）。SA3 的选择可辩护，但规格二义须 SA1 裁决写死（一行文字）。不阻塞。

### F3 【LOW · 备案 → SA1】空值 `@id` 不计入重复键

`schemasource.ts:242-247`：仅「值非空」的出现进 `counts`。`@id: good@1` + `@id:`（空）→ 不触发 duplicate，文件照常入册（探针 OBSV S3：RESOLVED(good@1)）。与设计「空值=缺失（语义上不存在）」的读法自洽，但设计未明示空出现是否计入重复——备案，建议 SA1 补一句。不阻塞。

### F4 【LOW · 备案】符号链接散放文件对 strays 不可见

顶层 `domains/foo.vfsl` 若为符号链接：`d.isFile()` 为 false（不跟随，I1 同款原则）→ 既不入册、也不触发 stray reject（`schemasource.ts:316-318`）。与 I1「不跟随符号链接」方向一致，设计未冻结该角落；备案即可。不阻塞。

---

## 2. R2 冻结语义逐条落地核查（对照设计逐节）

| 设计条款 | 实现/证据 | 结论 |
|---|---|---|
| §3.1 前导 trivia 区边界（空行/行注释/完整块注释极大前缀，遇首行代码即停） | `parseHeaderDirectives` :217-257；纯块注释行、跨行块、未闭合块、代码后行注释均正确（探针 S4/S7 官方套件 + SA2 B 系列）；**唯独「块注释+代码同行混排」失守** | ⚠️ **F1** |
| §3.2 三键大小写敏感/空值=缺失/未知键容忍/重复键响亮（消息含键名+出现数） | :198-256；`CONTRACT_KEYS` 精确匹配；duplicate 消息「@id 出现 2 次」；空值不入表 | ✅（F2/F3 两处规格二义备案） |
| §3.2 version：`/^\d+$/`→Number；非数字/负数/前导零/全角 | :377 `Number` else `NaN`；探针 S12a-e：`01`→1、`abc`/`-1`/400 位 9 串/`2` 全部 dialect-mismatch | ✅ |
| §3.2 BOM（U+FEFF 属 `\s`）/ CRLF（`\s*$` 吸收 `\r`） | 探针 S13：BOM+CRLF 首行指令容忍、text 原文直通 | ✅ |
| §4.1 扫描深度恰 1+1、sort 确定性、`.` 开头两层排除、深层排除、非 .vfsl 忽略、无 .vfsl 目录不报错 | `scanDomains` :284-321；探针 S9a/b（.bak 目录与 .hidden.vfsl 排除）、S17a（`test/fixtures/deep.vfsl` 不入册——dogfood 防混入） | ✅ |
| §4.2 条目数组 + 一级首胜 + list 重复保留 + Map 禁用 | entries 数组 :299-315；load 首胜循环 :143-156；list 派生 :181-186；探针 S6a（load 取排序首 domains/a/ 内容）、S6b（list 含两个 `dup@1`） | ✅ |
| §4.2 入册资格=「@id 恰一次且非空」；重复 @id → 不入册，x@1→missing、y@1/z@1→unknown | `declaredIdOf` :404-410；探针 S10a/b | ✅ |
| §4.2 二级决策树四分支（R2 #2）：目录空→unknown；健康同 base→unknown 附实际 id；有损坏无健康→missing 首个损坏；全完好异 base→unknown 附实际 id | `resolveViaDirFallback` :437-476；`isComplete` :394-401（不含方言有效性）；探针 S5a/b/c（foo@2 + 无关损坏 → unknown-id 附 foo@1——R1 错分类已修正）、S4a（broken.id → missing-directive 核心锚点）、S14b（foo@01 → unknown 附 foo@1） | ✅ |
| §4.2 base 单段校验（R2 #5）：含 `/`/`\`、恰为 `.`/`..`/空串 → unknown-id，零 FS 访问 | load 早出 :129-137 + `isSingleSegment` :422-430（在 `scanDomains` 之前）；探针 S7a/b 七形状全拒、`secret/decoy.vfsl` 诱饵不可达 | ✅ |
| §4.3 构造零 I/O、每次现扫无缓存 | :112-115 仅记 root；load/list 均 `await scanDomains` | ✅ |
| §4.4 list 一坏全拒 + strays 整体 reject（原生 Error 含路径 + ADR 提示）；load 不受散放影响 | :172-187；探针 S8a-d | ✅ |
| §4.5 ENOENT→合法空集；ENOTDIR/EACCES 原样冒泡 | :287-294 唯一 catch 是 ENOENT；探针 S11a-d（root=文件 → list/load 均 reject 原生 ENOTDIR，绝不 resolve 空集/静默 unknown-id） | ✅ |
| §5 方言断言双层：层 1 信封组装点内建 + 层 2 独立导出；单点实现 | `assertVfslDialect` :93-103；`validateHeader` :379 内建调用；index.ts 值导出 | ✅ |
| §2.2 公共面：3 值导出 + 4 类型导出，既有导出零变动 | index.ts diff 纯追加（`FileSchemaSource, assertVfslDialect, SchemaSourceError` + 4 type） | ✅ |
| §6.1 AC5：scaffold 测试（经接缝消费 + fileURLToPath 三级上溯 + 空集 notice + 断言助手锚点）+ ci.yml 显式步骤带 `--passWithNoTests=false` | `domains-scaffold.test.ts:35`（`fileURLToPath(new URL('../../..', import.meta.url))`）；ci.yml 步骤逐字符合；V3 独立复跑 flag 行为（不存在文件 exit 1） | ✅ |
| §7 版本 0.1.7→0.1.8 + devD `@types/node@^20` + lock 同步 | package.json diff；pnpm-lock 仅增 `@types/node@20.19.43` + `undici-types@6.21.0` + vitest/vite peer 后缀（自动生成痕迹，无夹带） | ✅ |

---

## 3. 专项门禁

### 3.1 [SA6 owned] 修复核查 —— **通过**（三处改动确认纯类型层，13 用例断言语义零变化）

证据链（四重独立来源）：

1. **SA3 会话日志**（`.mabf-bg/sa3.log`）：对 `schemasource-seam.test.ts` 的写类工具调用**恰 3 次**，全为 Edit（无 Write 整文件覆写；另一次 Write 是新建 domains-scaffold.test.ts，属 SA3 本职）；
2. **三处编辑内容**：
   - :62（函数签名）：fixture 返回类型补 `files: Record<'assets' | 'audit', { id: string; rel: string; body: string }>`；
   - :106（return 语句）：`files as unknown as { id: string; rel: string; body: string }`（SA6 原文，已在 sa6r2.log 中原文找到）→ `files as Record<'assets' | 'audit', …>`——cast 对运行时透明；
   - :246（broken.all 用例）：日志完整可见 old=`await expect(promise).rejects.toMatchObject({ kind: 'schema-source' } as unknown);` → new=同句去 ` as unknown`——纯 cast 移除，断言对象逐字节不变；
3. **13 用例 + 6 describe 标题**：与 SA6 红灯日志（`.mabf-bg/sa6-r2-red.log`，R2 真红灯证据）**逐字一致**（程序化比对 13/13 OK、describe 序列一致）；
4. **红灯日志代码帧重建**：从 vitest 失败帧恢复原始文件 60 行（原行号），在 committed 文件 +4 行偏移处**逐字一致**（+4 = 三处编辑净增行数，348→352 行，算术自洽）——断言体（fixture 调用、load id、expectStructuredReject 的 code 参数）零变化。

旁证：SA6 原头注释「v1-spec §1 注记 9/10」的错引（设计 §8.3 R2 #11c，改与不改均不阻塞）**保持未改**——反向印证 SA3 未做约定外的任何顺手改动。typecheck 0 错（V1）证实两处类型缺陷清零。

### 3.2 源码 GREP 断言禁令 —— **通过**

两个测试文件无 `readFileSync`/读源码文本行为；全部 `toContain` 均针对**运行时结果**（list() 返回的 id 数组 :159-160、`JSON.stringify(parseVfsl(...).module)` :321、load() 信封 text :335-337）。无伪测试。

### 3.3 SA2 I1 把关（目录判据）—— **通过**

`scanDomains` 用 `readdir(…, { withFileTypes: true })` + `d.isDirectory()`（:288/:296），第二层 `f.isFile()`（:303）；**无**「逐名 readdir + 吞 ENOTDIR 跳过」惯用法（唯一 catch 在 domains 根、只放行 ENOENT、其余 rethrow :289-294）。探针 S15 动态证实：`domains/link -> realdir` 符号链接目录不入册（I1 要求逐字落地，文件层 symlink 亦同款不跟随）。

### 3.4 ALLOW/DENY 范围核查 —— **通过**

- `git show --stat 6097691` 恰 **11 个文件**，与设计 §12 ALLOW LIST 11 项**一一对应**（8 代码/配置 + 3 wiki/raw）；
- DENY 逐一 `git diff 55a55c0 6097691 --name-only -- <path>` 证空：12 个引擎内部件（tokenizer/parser/semantic/ir/derived/evaluate/validate/resolve/shapes/pattern/xml/errors.ts）→ **0**；`packages/vfsl/tsconfig.json`、`tsconfig.base.json`、`vitest.config.ts`、`pnpm-workspace.yaml` → **0**；`domains`、`docs`、`tests/acceptance` → **0**；
- 黑名单（skill §1.1 5b）：`package-lock.json`/`yarn.lock`/`*.bak`/`TASK.md` → **0**；`TASK.md`、`.mabf-bg/`、`.mabf-git/` 均未入 commit（工作树中的改动为调度器运行时文件，未提交）；
- `pnpm-lock.yaml` diff 内容纯净（见 §2 末行）。

### 3.5 CI 触发性（skill §1.3/§1.4）—— **通过**

两个新测试文件均落在 vitest include `packages/*/test/**/*.test.ts`（`vitest.config.ts:5`）内 → ci.yml `Test` 步骤（`pnpm test`）自动跑到；`Domain scaffolds check` 显式步骤双保险，且带 `--passWithNoTests=false`（V3 独立复证防删除盲区）。无 spec 文件新增。

### 3.6 契约改动连锁（skill §1.6）—— **N/A（纯增量）**

index.ts 既有导出（parseVfsl/evaluate/validateSnapshot 及类型）逐字未动，diff 纯追加；无任何既有函数签名/throw/return 契约变化，无 caller 迁移面。

---

## 4. 审核结论（skill 模板）

1. **设计一致性**：⚠️ 偏离 1 项——**F1**（§3.1 前导区终止规则，HIGH，阻塞）；另 F2/F3 规格二义备案 SA1、F4 边界备案。其余 §2–§7 全部条款逐条落地（§2 表）。
2. **读写路径一致性**：✅ 纯库无 UI/store；scan→readFile 同一路径供 load/list，信封 text 直通无变换（S17c）。
3. **静默失败**：✅ 无（三码均结构化响亮；ENOENT 空集是设计内合法态非降级；散放/一坏全拒均响亮）。F4 符号链接散放不可见为唯一角落，已备案。
4. **降级方案**：✅ 安全——ENOTDIR 冒泡而非静默空集（S11b-d 亲证，SA2 #1 的 R2 修订真实落地）；无兜底路径。
5. **极端攻击**：❌ 发现 1 项（F1 劫持面，已列处置：REJECT 回流 SA3）；其余攻击面（穿越七形状、超长 id、空串 id、BOM/CRLF、version 四边界、并发、隐藏/深层/符号链接、ENOENT/ENOTDIR）探针 41 项全过。
6. **错误处理**：✅ 完整——每个失败路径有结构化错误（kind/code/id/path）或原生冒泡，消息含诊断上下文（实际声明 id、路径、缺失键、出现数）。
7. **架构评估**：✅ 可行——两级寻址/条目数组/双层断言/现扫无缓存按设计成立；无需退回 SA1。
8. **过度设计**：✅ 精简——476 行（设计预估 ~260）超出部分为 R2 新增规则（决策树/strays/单段校验/重复键）+ 高密度中文文档注释，复杂度可逐一追溯到冻结条款，无多余抽象层。

---

## 5. 动态审核重点（交 SA7）

1. **[F1 修复后回归]**：SA3 修复 F1 后复跑 `/tmp/sa4-probe/probe.mts` 形状的劫持场景（S1a/S1b 两形状应落 missing-directive）+ 全量 vitest（17 文件应保持全绿、356 用例数量不变——修复不新增用例则 356 不变）。
2. **CI 活链路**：GitHub Actions matrix（node 20/24）上 `Domain scaffolds check` 步骤真实执行、exit 0，且日志可见空集 notice（F1 期 domains/ 不存在）。
3. **readdir d_type**：CI runner 文件系统（ext4/overlayfs）对 `withFileTypes` 返回真实类型（I1 依赖 `isDirectory()`/`isFile()` 非 DT_UNKNOWN）。
4. **扫描竞态**：`scanDomains` 两次 readdir 之间子目录被删 → 第二次 readdir 的原生 ENOENT 冒泡（环境级，§4.5 语义内）——确认无消费方将其误当 unknown-id 处理。
5. **非 UTF-8 文件**（低优先）：非法 UTF-8 字节经 utf8 读入替换为 U+FFFD，「text 逐字节一致」对这类文件静默失真（设计 §3.2 固有：文件按 utf8 读入）——如需硬保证属后续票（读 buffer 校验或响亮拒绝）。

---

## 6. Verdict 说明

**reject**，回流目标 **SA3**（唯一阻塞项 F1；`packages/vfsl/src/schemasource.ts` `parseHeaderDirectives` 边界修正，~5 行）。

- 不需 SA1 重设计（架构与全部结构决策成立，R2 冻结语义除 F1 外逐条落地且有运行时证据）；
- 不需 SA6 动作（13 用例零变化已证；F1 场景不在锚点集内，若 SA3 愿意可为 F1 补一条红灯用例，属可选加固非义务）；
- 修复后复审聚焦点：parseHeaderDirectives diff + 本报告 V4 探针复跑 + 全量 vitest；其余门禁（ALLOW/DENY、[SA6 owned]、I1、CI 触发性）已定格通过，复审不重开。

附：SA4 探针全文输出（V4，2026-08-20 亲跑）——

```
FAIL S1a 块注释前缀代码行后伪指令不劫持（设计 §3.1） :: 实得 RESOLVED(evil@1)
FAIL S1b 块注释闭合+尾随代码行后伪指令不劫持 :: 实得 RESOLVED(evil2@1)
OBSV S2 值含冒号 @id: a:b@1 → unknown-id（设计字面 regex 会登记、注脚要求恰一冒号——备案项）
OBSV S3 @id 非空+空重复 → RESOLVED(good@1)（设计未冻结空值是否计入重复——备案项）
PASS S4a broken.id → missing-directive（核心锚点）
PASS S4b 未知 id → unknown-id
PASS S5a foo@2（健康 foo@1 + 无关损坏）→ unknown-id
PASS S5b 消息附实际声明 foo@1
PASS S5c foo@1 一级命中不受损文件影响
PASS S6a 重复 id load 首胜（排序首 domains/a/）
PASS S6b list 重复保留
PASS S7a ../secret@1 → unknown-id（诱饵不可达）
PASS S7b "..@1" → unknown-id
PASS S7b ".@1" → unknown-id
PASS S7b "@1" → unknown-id
PASS S7b "a/b@1" → unknown-id
PASS S7b "a\\b@1" → unknown-id
PASS S7b "foo/..@1" → unknown-id
PASS S8a 散放 → list() 整体 reject（原生 Error）
PASS S8b 消息含散放路径与 ADR 提示
PASS S8c 散放 id load → unknown-id
PASS S8d 散放不阻塞正常 id load
PASS S9a 隐藏目录/文件不入 list
PASS S9b 隐藏目录 id → unknown-id
PASS S10a load(x@1) → missing-directive
PASS S10b load(y@1) → unknown-id（冻结落点）
PASS S11a domains/ 缺失 → list() = []（合法空集）
PASS S11b root=文件 → list() reject（非空集）
PASS S11c 错误码为 ENOTDIR 原样冒泡
PASS S11d root=文件 → load() 也 reject（非静默 unknown-id）
PASS S12a version 01 → 1（前导零容忍）
PASS S12b version abc → dialect-mismatch
PASS S12c version -1 → dialect-mismatch
PASS S12d version 超大数 → dialect-mismatch
PASS S12e version 2 → dialect-mismatch
PASS S13 BOM+CRLF 首行指令容忍 + text 原文直通
PASS S14a 无后缀 id load("plain") 一级命中
PASS S14b foo@01 → unknown-id 附 foo@1
PASS S14c 空串 id → unknown-id
PASS S14d 超长 id → unknown-id
PASS S15 符号链接目录不跟随不入册（I1）
PASS S16 并发 load/list 无撕裂
PASS S17a 深层 .vfsl 不入册
PASS S17b 信封恰四键
PASS S17c text 逐字节一致

TOTAL 43 | PASS 41 | FAIL 2
```

---

## R2 复审（fix commit `a64f282`）

**Date**: 2026-08-20
**R2 Verdict**: **pass**（F1 真实消除、全量复跑零回归；新发现 F5 残留面 LOW 备案 → SA1，不阻塞）
**被审对象**: `a64f282`（`6097691..a64f282` 仅 `packages/vfsl/src/schemasource.ts`，+16/−3；对基点 `55a55c0` 累计仍恰 11 文件 = ALLOW LIST，无范围蔓延）。
**方法**: `git show a64f282` 逐行审读 + 修复后函数全文复读；/tmp 独立探针 `probe2.mts` 18 场景直驱真实实现（node 24 type-strip import，零 worktree 改动）；typecheck + 全量 vitest 后台独立进程复跑（退出码留证）。

### 1. F1 修复真实消除确认 —— 成立

修复与 R1 定形语义逐字一致：新增助手 `hasCodeAfterBlockClose`（`schemasource.ts:202-205`，`lastIndexOf('*/')+2` 之后 `/\S/` 判「最后一个 `*/` 之后残留非空白」）；单行块注释分支（:240-248）与跨行闭合分支（:228-236）均在 `includes('*/')` 守卫内接入，命中即 `break` 终止前导区，函数 JSDoc 同步改写。探针实测（R1 原形状原 fixture）：

- **A1（=R1 S1a）** `/* note */ type ROOT = {};` 之后 `// @id: evil@1` → `load('evil@1')` = **missing-directive**——恰为 R1 §F1 的精确预期落点（该文件三键不全 → 目录内损坏、无健康同 base 声明 → 决策树分支 3），劫持死；
- **A2（=R1 S1b）** 跨行闭合行 `*/ type ROOT = {};` 之后伪指令 → **missing-directive**；
- **A3** `list()` 一坏全拒，消息 `头部缺少指令: @id（…/domains/evil/schema.vfsl）`（含缺失键 + 文件路径）；
- **D1/D2** CRLF / BOM 变体同形状同样消除（`\r` 与 U+FEFF 均属 `\s`，不遮蔽残留判定）。

与总控亲验口径合并说明：总控 fixture 下 `load('evil@1')` → unknown-id、本探针 fixture 下 → missing-directive——差异纯由 fixture 状态决定（该目录是否存在完整健康头声明他 id → 决策树分支 4 vs 分支 3），两者皆为非 RESOLVED（劫持死），与 §4.2 决策树一致，无矛盾。

### 2. 修复无新漏洞（增量审查）

| 审查点 | 结论 |
|---|---|
| `lastIndexOf` 返回 −1 脚枪（此时 slice(1) 会错切） | 两被调点均在 `includes('*/')` 守卫内（:229/:241-242）→ lastIndexOf ≥ 0，路径不可达 |
| 纯注释行保持 trivia | 探针 B1（`/* note */` 单行）、B2（跨行块）→ RESOLVED，未误终止；空白行/行注释分支未被触碰 |
| 同行多块注释 `/* a */ /* b */` | lastIndexOf 取最后闭合符 → 纯注释行不终止（B4 RESOLVED）；尾随代码形状（`… /* b */ code`）最后闭合符后含 ` code` → 静态推演正确终止 |
| 终止行之前的真指令 | B3：真头三键收齐后遇终止行 → RESOLVED(h3@1)；终止后伪 `@id` 不再入 counts → R1 影响栏所列「重复键误拒放大（list 一坏全拒）」形状同步消除 |
| 保守终止方向 | 闭合行尾随行注释 `*/ // note` 按「非空白内容」计 → 终止（C3：仅存在于其后的 `@id` 落 missing-directive，响亮非静默）——fail-closed，与 R1 契约措辞（「非空白内容」）一致 |
| 信封完整性 | B6：恰四键（id/lang/text/version）+ text 逐字节一致 |
| 变更半径 | diff 全部落在 `parseHeaderDirectives` 两分支 + 助手 + JSDoc；`scanDomains`/`load`/`list`/决策树/`index.ts` 零改动 |

**新发现 F5【LOW · 备案 → SA1】夹心代码行仍按 trivia**：一行同时以 `/*` 起始、以 `*/` 收尾且代码夹于两块注释之间时，lastIndexOf 落在最后闭合符、其后无残留 → 不终止，其后 `// @id:` 仍被识别。探针实测：C1 `/* a */ type X /* b */` → RESOLVED(sandwich@1)；C2 闭合行 `*/ code /* tail */` → RESOLVED(sandwich2@1)；二者入册且可见于 list()。与设计 §3.1 字面语义（「遇首个不属于三类 trivia 的行即停」）在该角落仍有偏差，但**恰为 R1 修复契约（「最后一个 `*/` 之后」）的字面落地**——属 R1 定形对冻结语义的欠 specifying，非实现偏离修复契约。触发需一行内「块注释起 + 代码 + 块注释收」的做作形状（F1 两形状是自然写法，此形状不是）；`domains/` 现不存在，无现实数据影响。建议 SA1 一句话裁决：明示接受现语义（则实现合格），或收紧为「剥离全部块注释跨度后残留非空白」——`/\S/.test(line.replace(/\/\*[\s\S]*?\*\//g, ''))`；注意**不可**改为「首个闭合符之后」，否则 B4 纯多块注释行会被误终止（引入过度终止回归）。不阻塞。

### 3. 全量复跑（后台独立进程，退出码留证）

| # | 命令 | 结果 | 退出码 |
|---|------|------|-------|
| V5 | `pnpm typecheck` | 0 错误 | **0** |
| V6 | `pnpm exec vitest run` | **Test Files 17 passed (17) · Tests 356 passed (356)** | **0** |
| V7 | 探针 `/tmp/sa4-probe/probe2.mts`（18 场景直驱真实实现） | **PASS 16 / FAIL 2**（2 FAIL = F5 残留面实测取证，见 §2） | 1 |

日志：`/tmp/sa4-r2-suite.log`（V5/V6）、`/tmp/sa4-r2-probe.log`（V7）。用例数 356 与 R1 完全一致——a64f282 零测试文件改动，锚点零变化，符合 R1 §6 预告（修复不新增用例则 356 不变）。

### 4. 其余门禁顺手复核（R1 已定格项零回归）

- **ALLOW/DENY**：`git diff --name-only 6097691 a64f282` = 仅 `packages/vfsl/src/schemasource.ts`（ALLOW LIST 内）；对基点 `55a55c0` 累计仍恰 11 文件；DENY 清单与黑名单无新触；
- **[SA6 owned]**：a64f282 零测试文件改动 → 13 用例断言锚点原样（356 全绿佐证）；
- **I1 / CI 触发性 / 契约连锁**：diff 不及 `scanDomains`、workflow yml、`index.ts` → 结构性不可回归。

### 5. R2 Verdict：**pass**

R1 唯一阻塞项 F1 按契约真实消除，且有错误码级运行时证据（非 RESOLVED 且落点与预测逐码一致）；全量零回归；新增 F5 为 LOW 规格角落备案 SA1（与 F2/F3/F4 同待遇），不构成阻塞。SA7 动态验证清单（R1 §5）第 1 项（F1 修复后回归）可勾销；其余各项（CI 活链路、readdir d_type、扫描竞态、非 UTF-8）仍有效。
