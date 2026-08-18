# SA4 静态验尸报告 — parseVfsl 最小端到端（issue #5）

**Date**: 2026-08-18
**评审对象**: commit `1664b8d`（13 文件，+2410/−6）— `packages/vfsl/src` 六文件实现 + 全量 diff
**评审输入**: 冻结规格 `docs/vfsl/v1-spec.md`、SA1 设计 R2 定稿、SA2 R2 评审（verdict=pass）、
SA6 两份测试（R2 修正后现状）、`.github/workflows/ci.yml`、根配置（vitest/tsconfig/package.json）、
`.mabf-bg/` 流程日志。
**评审方法**: 全量源码通读（六文件 1067 行 + 测试 329 行）逐条对照规格 §2/§4 与设计 §3~§16；
对抗性输入经独立进程动态取证（tsc 编译至 /tmp 后 node 驱动，脚本不入 worktree）；
验收命令按 2026-05-08 立法后台独立进程执行。

---

## 一、审核结论（八项总表）

| # | 维度 | 结论 |
|---|---|---|
| 1 | 设计一致性 | ⚠️ **两处偏离**：R-2（E302 角落引用图边覆盖 vs 设计 §6.1 冻结的并集）；R-3（package.json 越 DENY 护栏）。核心架构（分层/延迟错误记号/判定顺序映射/IR/切片边界/深度预算）全部落地无偏差 |
| 2 | 读写路径一致性 | ✅ 纯函数单向数据流（text→Token→AST→IR→返回值），无状态分叉 |
| 3 | 静默失败 | ✅ 未发现。所有路径收敛到 `ok:true`(IR) 或 `ok:false`(恰 1 条 issue)；generic-diag 必产语义相位 issue；`/** */` 忽略系设计 §8 切片策略 |
| 4 | 降级方案 | ✅ 安全。顶层兜底 catch（§15.4）按设计落地：不返回 ok:true、错误文本进 message、`err instanceof Error` 严格模式适配（R2-2 ✅）；D4 实测 null 入参不抛、结构化返回 |
| 5 | 极端攻击 | ❌ **发现 1 项可静态确认缺陷**（R-1：星面字符列漂移，违反冻结规格 §4 码点列）；深嵌套/超长链/超双精度/空文本/BOM/CRLF/孤立 \r 全部实测安全 |
| 6 | 错误处理 | ⚠️ 缺口即 R-1（错误锚列在特定输入下错报 +N）；其余完整 |
| 7 | 架构评估 | ✅ 可行。无退回 SA1 信号（无 FIXME、无绕行、无超范围重构） |
| 8 | 过度设计 | ✅ 精简。六文件结构=设计 §3.1；行数（250/409/179）对估算（160/250/170）超出部分为文档注释，无发明抽象 |

## 二、门禁专项

### §1.1 文件清单 Scope Creep Guard

- 实际 diff（`1664b8d^..1664b8d`）13 文件；经白名单（`wiki/raw/task_`）过滤后 creep 集为空——**但辅助命令有已知粗粒度**：它把 design 全文反引号路径都抽入 allow 集，**DENY LIST 章节里的路径也被误抽**。按 SKILL 第一步语义（ALLOW/DENY 分别提取）人工核对：`packages/vfsl/package.json` 在 §12 DENY LIST（"禁动"）**且出现在 actual** → **R-3 命中**（详见 REJECT 清单）。
- BLACKLIST（package-lock/yarn.lock/.DS_Store/TASK.md/*.bak）扫描：零命中 ✅（工作区未跟踪的 `TASK.md`/`.mabf-bg/` 未进 commit）。
- 测试文件入 commit 属预期（design §12 `[SA6 owned]` 条目在 ALLOW LIST；内容与 SA6 R2 修正现状一致：`:160` = `toBe(23)`、`:178` 输入含 `\n`，30 用例无增删）。

### §1.3 E2E spec runner 触发性

**不适用**：本任务无 `*.spec.ts` 文件（仅 `*.test.ts`，走 §1.4）。

### §1.4 vitest 触发性自检（2026-06-15 立法；总控点名必查）

**结论：✅ 接通，无 CI 黑洞。**

| 链路环节 | 证据 |
|---|---|
| 新增测试文件 | `packages/vfsl/test/parse-vfsl.test.ts`（11 例）、`packages/vfsl/test/parse-vfsl-errors.test.ts`（19 例） |
| 所在 package | `@nomicore/vfsl`（`packages/vfsl/package.json`） |
| CI workflow | `.github/workflows/ci.yml` 是仓库唯一 workflow；`test` job（push:main + 全部 PR，matrix node 20/24）第 39 行 `run: pnpm test` |
| 根 script | `package.json` `"test": "vitest run"`（根级全仓运行，无 --filter） |
| vitest include | 根 `vitest.config.ts`：`'packages/*/test/**/*.test.ts'` → **两文件均命中** |
| typecheck 侧 | ci.yml 第 36 行 `pnpm typecheck` → `tsc -p packages/vfsl/tsconfig.json`，其 `include` 含 `test/**/*.ts` → 测试文件同时受类型检查覆盖 |
| 动态旁证 | 本轮后台独立进程 `vitest run` 实际收集执行 2 文件 30 用例 |

### §1.5 协议假设审查

设计 §13 声明"无协议级假设"——**与实现相符**（纯进程内计算，零运行时依赖：`dependencies` 为 null，devDependencies 仅 typescript/vitest）。两项依据（JSON 往返断言、vitest include）本轮均独立复核成立。无"应该/通常"类无据推断。✅

### §1.6 契约改动连锁审查

无既有契约改动：`parseVfsl` 为全新导出（原 index.ts 空壳），`git grep` 确认 `apps/`、`tests/`、其他 packages 无任何消费方。新接缝同步纯函数、内部全路径被 index.ts 顶层 try/catch 包住（index.ts:32-52），无 await/Promise → 不存在 unhandled rejection 面。三层防御矩阵：不适用（无既有 caller）。✅

### §1.7 源码 GREP 断言禁令

两份测试无 `readFileSync`、无对源码字符串的 `toMatch/toContain` 断言；全部断言经 `parseVfsl` 运行时行为（返回形状/错误码前缀/行列/IR 序列化）。`toMatch` 仅用于 issue.message 的冻结前缀（规格 §4 断言锚的正当用法）。✅

## 三、SA2 R2 移交项消解复核

| 移交项 | 要求 | 复核结论 |
|---|---|---|
| **R2-1**（LOW） | 深度计数按 §10.7 权威读法（当前嵌套深度），SA4 核对正常出口回退 | ✅ **消解**：parser.ts:87-88 注释明示权威读法；parser.ts:345 入口 `depth += 1`、parser.ts:405-407 `finally { this.depth -= 1 }`（throw 路径亦回退）。动态判别：150 个浅层对象 `ok:true`（累计读法必红）、N∈{1000,5000,20000} 深嵌套 E100@(1,310) 不抛、N=100 边界 `ok:true` 且 JSON 往返深等 |
| **R2-2**（nit） | 兜底 catch 的 `unknown` 严格模式适配 | ✅ **消解**：index.ts:46 `err instanceof Error ? err.message : String(err)`（未照抄设计伪代码的字面 `err?.message`） |
| R1 #8 复核 | ir.ts 无签名无体声明 | ✅ ir.ts 仅类型（45 行，零函数）；`parseVfsl` 实现与导出在 index.ts |
| SA6 T14 判别用例 | 建议补测 | ⚠️ **未落库**（测试仍 30 例）——SA6 非阻塞积压，非 SA3 缺陷；本轮已由 SA4 动态代验（行为正确）。移交 SA6/SA7 |

## 四、REJECT 清单（3 项，均可静态确认 + 已动态取证）

### R-1【规格符合性】注释内星面字符（non-BMP）列计数按 UTF-16 码元而非码点 → 后续锚点列漂移

- **位置**：`packages/vfsl/src/tokenizer.ts:100-103`（行注释扫描）与 `tokenizer.ts:114-137`（块注释扫描 else 分支）——两处以 `text[i]`（码元）推进且 `i += 1; column += 1`；主循环/标识符/数字/字符串分支均正确用 `codePointAt`。
- **违反条款**：冻结规格 §4「column 按 Unicode 码点计（自行首累加）」；设计 §4.3 明文「逐 Unicode 码点推进 column（for..of / codePointAt，**防 CJK 代理对计 2 列**）」——设计点名要防的正是此缺陷类，实现漏在两个注释扫描器。
- **动态证据**（独立进程，码点位经 `[...s].indexOf` 脚本核算）：
  - `/*😀*/ type A = -1;` → E100 锚 `-` 报 **(1,17)**，码点正确值 **(1,16)**（+1/星面字符）；
  - `/*😀😀*/ type A = -1;` → 报 **19** vs 正确 **17**（漂移按个数累积）；
  - `type A = string //😀`（EOF 无换行）→ EOF 锚报 **21** vs 正确 **20**（行注释路径）；
  - 对照组：`/*中*/ type A = -1;` → **16** ✅（BMP 不受影响——差异仅星面字符）；换行后重置 ✅；星面字符自身作未知字符锚 **10** ✅（主循环正确）；字符串内星面 ✅（A4）。
- **影响**：含 emoji / 扩展区汉字（CJK Ext-B+）注释的同行后续任何错误锚（含 EOF 锚）列号偏大；违反冻结规格的可观测输出。SA6 30 用例无星面字符 → 现有测试不可暴露（红灯黑洞同 issue #180 形态）。
- **修法（回流 SA3）**：两个注释扫描循环改按 `codePointAt` 推进（与同文件 ident/number/string 分支同款 `i += c > 0xffff ? 2 : 1; column += 1`）。一处共性小修，无架构影响。

### R-2【设计偏离】重复声明（E302 场景）的引用图边取「最后一次声明体」而非设计 §6.1 冻结的「全部声明体并集」

- **位置**：`packages/vfsl/src/semantic.ts:88-95`——`for (const a of aliases) { …; graph.set(a.name, edges); }` 后声明**覆盖**先声明。
- **违反条款**：设计 §6.1「同名多声明（E302 场景）的引用边取**全部声明体并集**（未冻结角落的确定性选择）」。规格未冻结此角落，但 SA1 已显式冻结并集、SA2 R2 复核通过——SA3 不得静默改读法（SKILL §1.2：危险简化；静默决定违反规格 §9 纪律精神）。
- **动态证据**：
  - `type A = { a: A }; type A = string;` → 实现 **E302@(1,25)**；并集口径应为 **E106@(1,15)**（前体自环回边位置更前，min-position 胜出）；
  - `type A = { b: B }; type A = string; type B = { a: A };` → 实现 **E302@(1,25)**；并集口径应 **E106@(3,15)**；
  - 对照组：单声明自环 `type A = { a: A };` → E106@(1,15) ✅（排除"实现没有 E106"的替代解释，确认系覆盖所致）。
- **影响**：E302 输入的错误身份（码 + 锚点）与设计冻结行为不同（公共接缝可观测）。日常布局（设计自注"绝大多数 E302 声明名先于体内引用"）不触发，但构造性输入可触发。
- **修法（回流 SA3）**：`graph` 构建改为按名累积（`graph.set(name, […(graph.get(name) ?? []), …edges])` 或 Map<string, edges[]> 聚合），一处局部修改。

### R-3【护栏越界】`packages/vfsl/package.json` 被 commit 修改（version 0.1.0 → 0.1.1），该文件在 SA1 §12 DENY LIST（"禁动"），且 §10.5 明文「package.json / lockfile 不动」

- **证据**：`git show 1664b8d -- packages/vfsl/package.json`：`- "version": "0.1.0"` / `+ "version": "0.1.1"`；commit message 自述「@nomicore/vfsl bump 0.1.0 → 0.1.1」。
- **实质影响评估（如实）**：零运行时依赖约束**未破坏**（无 `dependencies` 字段、devDependencies 未动、`exports` 直指 `src/index.ts` 维持现状）；包为 `private: true` 无发布消费面；全仓无版本号读取方。属**程序性违规而非实质违规**。
- **但按 SKILL §1.1 第四步立法**：DENY LIST 文件出现在 actual → REJECT，"不接受'已经测试过了'作为接受越界的理由"。设计对版本策略唯一相关条款（§1.1 R2 #9）明言缓存版本绑定「非本切片代码事项」——SA3 无设计授权自行 bump。
- **修法（回流 SA3，二选一）**：(a) revert 该行（推荐——最小变更，设计本就判定"无需改动"）；(b) 若团队确立"实现 commit 须 bump"的约定，须 SA1 走设计修订显式扩展允许范围并说明理由，不得由 SA3 事后追认。

## 五、实现质量正面清单（经攻击成立，供 SA7 复用）

- **验收命令实测（后台独立进程）**：`pnpm test` **30/30 全绿**（2 文件）、`pnpm typecheck` **0 错**——与总控亲验及 SA2 R2 判读基准一致；E302/E106 修正后锚点用例通过，无 §2 豁免引用。
- **设计 §16 红灯构想 T1–T13 全组实测通过**（SA6 未落库，SA4 代验）：T1 深嵌套三档不抛且 E100@(1,310) 与 N 无关；T2 两万别名链 ok:true（20001 别名）；T3 N=100 边界 ok + 往返深等；T4 400 位数字 E100@(1,10)；T5 1e308 ok 且 value 精确；T6 字段名保留名 ×3 E100@12；T7 `yleaf` 合法；T8 多环胜者 (2,15) 非 (3,15)（回边全量收集成立）；T9 `Foo<$>` E100@14 非 13（扫描不吞词法错误）；T10 `Pattern`@19 / T11-T12 `&`@17；T13 E308@(1,23) + 正例 ok。
- **判定顺序 1~7 映射**逐条与规格文义核对一致（含 E303 即时判定、相位优先于位置的 D1 实测、文本序 `(` E100 先于 E201 的 D2 实测、嵌套 E308 min-position 的 D3 实测）。
- **词法细节**：BOM 剥离不占列、中部 U+FEFF → E100@7、`\r\n` 合并换行 `\r` 不占列、孤立 `\r` 不换行不进位、`str/**/ing` 锚后继记号 `ing`@17、`007`→7 值规范化、`true`/`false` 按注记 8 落 E301、行注释 EOF 视同 eol——全部实测符合。
- **「不抛错」契约由构造达成**：深度预算（finally 回退）+ 迭代 DFS（两万链实测）+ 顶层兜底（null 入参结构化返回）；generic-diag 到 IR 的 throw 不可达（必产候选）。

## 六、动态审核重点（交 SA7）

1. **R-1 修复后的星面字符回归**：`/*😀*/ type A = -1;` 断言 (1,16)；`type A = string //😀` EOF 锚断言 (1,20)；双星面累积断言 17；BMP 对照 16。（若 SA3 已修，此组为验收；未修则红。）
2. **R-2 修复后的 E302 角落回归**：`type A = { a: A }; type A = string;` 断言 E106@(1,15)；互环版断言 E106@(3,15)；单声明自环对照 E106@(1,15)。
3. **CI 触发证据摘录**：`gh run view --log` 确认 PR CI 的 `Test` step 实际收集执行 `packages/vfsl/test/` 两文件 30 用例（§1.4 静态结论的动态确认；node 20/24 双矩阵）。
4. **T1 三档深嵌套 + T14**（SA2 移交建议维持）：`expect(...).not.toThrow()` 并列加护；T14 若 SA6 已落库则以测试为准。
5. **兜底 catch 零命中确认**：全部用例 message 无「内部错误（意外异常）」前缀正文（§10.9 判读——命中即实现缺陷）。

## 七、回流目标汇总

| 项 | 回流 | 动作 |
|---|---|---|
| R-1 星面列漂移 | **SA3** | tokenizer 两个注释扫描循环改码点推进（局部小修） |
| R-2 图边并集 | **SA3** | semantic.ts graph 构建改按名累积（局部小修） |
| R-3 package.json | **SA3**（revert）或 SA1（设计修订授权） | 一行 revert（推荐）/ 设计显式扩展 |
| T14/E308/T1–T13 补测 | SA6 | 非阻塞积压（行为已由 SA4 代验通过） |
| 本报告 §六 | SA7 | 动态验证清单 |

三项 REJECT 均为局部小修（合计 ≤10 行变更），不触及架构与公共接缝形状——**无需退回 SA1 重设计**；修复后 SA4 复审仅聚焦 R-1/R-2/R-3 三点回归。

---

**Verdict: reject**

---

# SA4 R2 复审报告（R3 回流处置复核轮）

**Date**: 2026-08-18
**评审对象**: commit `01a67e3`（6 文件，+321/−7；其中 src 增量 2 文件 +7/−3）+ R-3 设计侧处置（SA1 R3 增补，同 commit 落库）
**评审输入**: R1 报告（本文前文，保留原文）、冻结规格 `docs/vfsl/v1-spec.md`、SA1 设计（R3 增补后）、
SA6 R3 回归测试 `parse-vfsl-r3-regression.test.ts`（7 用例）及 dispatch R3 记录、`.mabf-bg/sa3-dispatch.sh` 派发原文。
**复审范围**（按总控派发）: R-1/R-2/R-3 三点回归确认 + 对修复代码的增量攻击（是否引入新问题）+ §1.4 vitest 触发性结论复核。
**评审方法**: 修复 diff 逐行静态推演 + 增量攻击 24 用例独立动态取证（期望坐标全部由 `[...str]` 码点展开程序化推导，
杜绝 SA1/SA2/SA4-R1 三方都踩过的手敲转录误差）+ 红灯真实性独立复现（临时 worktree，不入库）；
全部命令按 2026-05-08 立法后台独立进程执行。

## 一、R1 三项 REJECT 处置逐项复核

### R-1 星面字符列漂移 → ✅ 已修复（回归确认 + 增量攻击均通过）

- **修复形态**（tokenizer.ts:100-104 行注释 / :135-139 块注释 else 分支）：改 `codePointAt` 码点推进
  （`i += c > 0xffff ? 2 : 1; column += 1`），与同文件 ident/number/string 分支同款——**与 R1 建议修法逐字一致**，
  无夹带改动（src 增量全 diff 仅此 2 文件 7+/3−）。
- **静态推演确认修复完备**：全 tokenizer 复扫，码元推进点仅剩安全位——空白/`\n`/`\r`/标点均为 ASCII 单码元；
  `*/` 检测读码元 `*`(0x2A) 与代理对区（≥0xD800）无碰撞；行注释循环条件的 `\n`/`\r` 码元比较不误匹配代理对。
- **增量攻击 12 例全过**（A1–A12，独立进程实测，SA4 自建攻击集，不与 SA6 7 例重叠）：
  - R1 原证据组独立复验：`/*😀*/`→(1,16)、双星面→(1,17)、行注释 EOF→(1,20)、BMP 对照→(1,16)；
  - **修复代码新攻击面**：孤立高/低代理对（`\uD800`/`\uDFFF`，`codePointAt` 返回值 ≤0xFFFF → 单步推进，
    无死循环无越界，各计 1 列）✅；星面后紧邻 `*/` 闭合 ✅；`**/` 星号串闭合 ✅；块注释内换行 + 星面（列重置）✅；
    行注释星面 + `\r\n` 合并换行 ✅；星面末尾恰 EOF（游标无越界）✅；未闭合块注释尾星面 E203 锚 `/*` 不变 ✅。
- **结论**：缺陷消除，且修复未在注释扫描器引入新行为差异。

### R-2 E302 并集图边 → ✅ 已修复（回归确认 + 增量攻击均通过）

- **修复形态**（semantic.ts:96）：`graph.set(a.name, [...(graph.get(a.name) ?? []), ...edges])`——按名累积，
  与设计 §6.1 及 R1 建议修法一致；`edges` 每轮新鲜声明（:89），无跨声明污染；并集序=源序（先声明体在前）。
- **增量攻击 8 例全过**（B1–B8）：三重声明（两自环全入池，min-position 胜者在前体 E106@(1,15)）✅；
  双自环并集 ✅；互环判别输入 E106@(2,15) ✅；E301 与重复共存时码位先胜 ✅；两万别名链 ok:true 无性能塌陷 ✅。
- **⚠️ R1 证据更正（如实记录）**：R1 §四 R-2 第二条动态证据「`type A = { b: B }; type A = string; type B = { a: A };`
  → 并集口径应 E106@(3,15)」**有误**——单行输入不可能产出 line 3，且经本轮 B4 实测：该字面输入在并集口径下
  仍为 **E302@(1,25)**（回边 `A`@(1,52) 晚于 E302 锚），与 last-wins 输出相同，不具判别力。SA6 R3 记录的偏差分析
  正确，其重构的判别输入（互环对置于重复声明之前 → E106@(2,15)）经本轮独立复验成立。**R-2 缺陷判定本身不受影响**
  （判别输入下 last-wins 错报 E302@(3,6)、并集正确报 E106@(2,15)，偏离设计 §6.1 成立）。
- **微观特性记录（非缺陷）**：并集展开在「同名 K 次重复声明且每声明带边」的病态输入下有 O(K²) 拷贝——
  实测 K=20000：1439ms / 堆 44MB / 输出正确 E302@(3,6)，有界无崩溃，与 20k 链既有资源口径同量级；
  如未来需优化可改 get-or-create-push（O(K)），本轮不构成回流项。

### R-3 package.json 越 DENY → ✅ 处置合规（总控裁决修法 (b)：设计授权保留 bump）

按 R1 修法 (b) 路径（「SA1 走设计修订显式扩展允许范围并说明理由」）逐项核验授权链真实性：

| 核验点 | 证据 | 结果 |
|---|---|---|
| 总控派发指令确实存在 | `.mabf-bg/sa3-dispatch.sh:7` 原文「完成后 bump packages/vfsl 版本 patch 位，git commit…」 | ✅ SA3 系执行指令，非自选动作 |
| HG9 流水线先例 | `wiki/raw/task_vfsl-v1-spec.md:46`「版本号 bump（Hard Gate #9）」 | ✅ 引用属实 |
| 设计三处收窄留痕 | 设计 §1.1（R3 例外标注）/ §10.5（收窄为结构性字段）/ §12 DENY（收窄 + 【R3】marker）+ 文末 R3 记录表 | ✅ 就地收窄可追溯，非静默重写 |
| ALLOW LIST 增补 | §12 新增条目【R3 修订追加 · SA4 R-3】仅限 version patch 位一行 | ✅ |
| **授权边界 = 实际 diff** | `git diff 1c60e69 HEAD -- packages/vfsl/package.json` 恰为 `-0.1.0/+0.1.1` 一行；无 dependencies、devDependencies/exports/scripts 未动 | ✅ 未越豁免边界 |
| 实质约束未破坏 | 当前 package.json：无 `dependencies` 字段、devDeps 仅 typescript/vitest、`exports` 直指 `src/index.ts`、`private: true` | ✅ |

处置路径符合 R1 立法精神（设计显式授权留痕，非实现侧事后追认）；豁免单向性（仅 patch 位）与流水线级授权边界
（未来 DENY×Hard Gate 冲突同路径处置）已在设计 R3 记录成文。**R-3 闭合。**

## 二、修复代码增量攻击总结（是否引入新问题）

- **24/24 攻击用例通过**（A1–A12 / B1–B8 / C1–C4，含 4 例 R1 已验行为回归护栏：BMP 对照、孤立 `\r`、
  字符串内星面、两万链）。未发现修复引入的新缺陷。
- **修复半径**：src 2 文件 +7/−3 行，无架构触碰、无公共接缝形状变化、无新 import、无 FIXME/绕行。
- **红灯真实性独立复现**（SA6 R3 记录的复核）：临时 worktree 检出 `1664b8d`（未修复 src）+ 拷入
  SA6 r3 回归测试后 `pnpm test` → **5 failed | 32 passed (37)**，exit 1——失败面（R1-a/b/c 列漂移 +
  R2-a/b E302 误报）与 SA6 记录逐项一致。**证明 7 用例回归锚真实咬合未修复代码，非空洞测试**，
  同时反证 SA3 未弱化断言（弱化则未修复态亦绿）。worktree 已清理，未污染仓库。
- **验收命令实测**（后台独立进程）：`pnpm test` **37/37 全绿**（3 文件：11+19+7）、`pnpm typecheck` **0 错**——
  与总控亲验一致。

## 三、门禁复检

### §1.1 Scope Creep Guard（对 01a67e3 增量 + base..HEAD 全量）

- 形式化比对（base=`1c60e69`，actual 15 文件）：BLACKLIST 零命中；wiki 白名单过滤后，
  `packages/vfsl/package.json` 经 R3 增补落入 ALLOW（version 一行在授权内）；src 五文件均在 ALLOW。
- **唯一残差**：`packages/vfsl/test/parse-vfsl-r3-regression.test.ts` 不在 ALLOW LIST 字面条目中
  （设计全文 0 次提及该文件名）。**判定：授权链成立，非 scope creep，记 LOW 记账缺口**——
  授权依据：dispatch row 9（总控 22:37 派发 SA6 R3 回归用例轮）+ 设计 R3 记录回流表明载
  「dispatch row 9 已并行派发 SA6 R3 回归用例（red-first）」+ §12 既有原则「如需补测，亦由 SA6 拥有」。
  文件为纯测试、落 SA6 拥有域、红灯真实性已验。**建议（非阻塞）**：SA1 下次触碰设计时将
  `packages/vfsl/test/` 下 SA6 拥有条目泛化为 glob（或将该文件名补入 ALLOW LIST），消除记账粒度差。
- DENY 全量复扫：`.github/`、`vitest.config.ts`、根 `package.json`、`tsconfig.base.json`、
  `packages/vfsl/tsconfig.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`docs/`、PRD 归档、
  `CONTEXT.md`、`apps/`、`tests/` base..HEAD 零改动 ✅。

### §1.4 vitest 触发性自检（总控点名复检项）—— ✅ 结论维持：接通，无 CI 黑洞

| 链路环节 | 证据 |
|---|---|
| 新增测试文件 | `packages/vfsl/test/parse-vfsl-r3-regression.test.ts`（7 例）——所在目录与既有两文件相同 |
| vitest include | 根 `vitest.config.ts` `'packages/*/test/**/*.test.ts'` → **命中**（本轮实测 vitest 实际收集 3 文件 37 用例） |
| CI workflow | `.github/workflows/ci.yml` 为唯一 workflow 且 base..HEAD 零改动；`Test` job（push:main + 全部 PR，node 20/24）根级 `pnpm test`，无 --filter → 全仓收集 |
| typecheck 侧 | `pnpm typecheck` → `tsc -p packages/vfsl/tsconfig.json`，include 含 `test/**/*.ts` → 新文件同受类型检查（实测 0 错） |
| 触发性增量风险 | 无：无新 workspace package、无新配置、无 runner 改动 |

### 其余门禁

- §1.3 E2E spec：不适用（无 `*.spec.ts`）。
- §1.5 协议假设：修复为进程内纯计算，无新增协议级假设；设计 R3 记录自检同口径 ✅。
- §1.6 契约连锁：`parseVfsl` 契约（形状/同步/不抛错）未变，无新增 caller，三层防御矩阵维持不适用 ✅。
- §1.7 源码 GREP 断言禁令：SA6 新文件无 `readFileSync`、无对源码字符串断言，全部经 `parseVfsl` 运行时行为；
  `toMatch` 仅用于 message 冻结前缀（正当用法）✅；红灯复现另行证明断言判别力（见 §二）。

## 四、动态审核重点（交 SA7，R2 修订版）

1. **CI 触发证据摘录**（R1 §六.3 维持）：`gh run view --log` 确认 PR CI `Test` step 实际收集执行
   3 文件 37 用例（node 20/24 双矩阵）——§1.4 静态结论的动态确认。
2. **R-1/R-2 修复回归**：已由落库测试 `parse-vfsl-r3-regression.test.ts`（7 例）承担，SA7 验 CI 绿即可；
   SA4 附加攻击集（A3/A4 孤立代理对等 24 例）行为已本轮实测通过，无需 SA7 重跑。
3. **兜底 catch 零命中确认**（R1 §六.5 维持）：全部用例 message 无「内部错误（意外异常）」前缀正文。
4. **R-2 微观特性**（新增，低优先）：若 SA7 做资源压力项，可附带观测重复声明数极大的输入耗时
   （SA4 实测 20k 重复 = 1.4s，有界）；非验收项。

## 五、残留事项（均非阻塞）

| 项 | 归属 | 说明 |
|---|---|---|
| ALLOW LIST 记账缺口（r3-regression 文件名字面缺席） | SA1（下次设计触碰时） | 见 §三 §1.1；授权链已成立，纯记账 |
| T14 / E308 / T1–T13 补测积压 | SA6 | 维持 R1 判定（行为已由 SA4 两轮代验通过） |
| §四清单 | SA7 | 动态验证 |

## 六、R2 结论

R1 三项 REJECT 全部处置到位：R-1/R-2 修复正确且经 24 例增量攻击未引入新问题，红灯回归锚真实咬合；
R-3 经总控裁决 + SA1 设计显式收窄留痕，授权边界与实际 diff 逐字相符。验收 37/37 绿 + tsc 0 亲验复现。
唯一新增发现为 LOW 级记账缺口（不构成越界）。无退回 SA1 信号，无新回流项。

---

**Verdict: pass**
