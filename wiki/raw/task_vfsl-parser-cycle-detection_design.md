# SA1 设计 — Parser 环检测与 §4 fixture 全量解析（Issue #9）· 验证型交付

> **任务类型**: 功能开发（受控恢复后转入**验证型交付路径**，简报 §十裁决 2026-08-19 09:20）
> **run_id**: `issue-9-1787100197-15896` ｜ **Worktree**: `/home/wangjian/nomicore-fix-issue-9` ｜ 分支 `fix/issue-9-on-refactor-docs-add-mabf-multi-repo-monito`
> **基线**: b076d41 零 diff + 本地 2 commit（SA6 验收测试 + 中断/恢复裁决档案）；`pnpm typecheck` EXIT=0、`pnpm test` 7 文件 99/99（85 基线 + 14 新增，SA6 与总控两次独立实跑）
> **交付物（简报 §十，总控已裁定；修订 1 经 SA2 攻击点 2 + 总控 dispatch 授权扩为 +2 用例）**: ① `packages/vfsl/test/parse-vfsl-cycle-detection.test.ts`（SA6 已归档 14 条**断言零改动** + 修订 1 新增规格 2 条（§3.1，SA3 落地）= **16 条** AC 回归锁，落地后全量 **101/101**）② HG9 bump `packages/vfsl` `0.1.2 → 0.1.3`（SA3 执行）。**无产品代码改动——这是 #9 的 AC 已被 #6/#7 交付的实现满足的必然结果，验证证据本身即 #9 的交付物。**
> **修订 1（2026-08-19）**: 落实 SA2 R1 reject 8 项攻击点（1 CRITICAL + 2 HIGH + 5 MEDIUM/LOW），逐条回应见文末表；修订期新增实测自测见 §2.4。

---

## §1 任务定位：验证型交付的设计语义

### 1.1 为什么本设计不包含产品改动方案

规则 3 中断（简报 §九）+ supervisor 受控恢复（简报 §十）已由总控复核成立：四条 AC 的验收测试在零产品 diff 基线上**写出来即全绿**。SA1 若再设计「E106 环检测算法」「fixture 解析器」的**实现**方案，等于对已交付且被 99/99 绿锁定的 `semantic.ts`/`parser.ts` 设计一遍已存在的代码——产出不可落地（SA3 无处实施）、且诱导 SA3/SA4 对零 diff 伪造「实现评审」，直接违反 HG12 verdict 真实性。因此本设计的对象是：**验证证据本身**——它的覆盖面、锚定强度、残余缺口与交付事务。

### 1.2 TDD 红绿循环不适用声明（简报 §十指令项）

TDD 的红绿循环（红灯 → 实现 → 绿灯）前提是存在待实现的产品行为。本交付产品代码零改动，红灯阶段**结构性不存在**：SA6 的 14 条验收测试在写完当刻（零产品 diff）即为绿（首轮 3 失败为 SA6 自身 helper 缺陷——未穿透 marker 包裹层，修正 helper 后通过，产品代码零改动；见 dispatch log 中断记录）。**替代证据标准**（本设计 §4/§6 立法，SA7 执行）：

| TDD 原证据 | 替代证据 | 承载者 |
|---|---|---|
| 红灯证明测试能失败 | **mutation 矩阵核验**：§4 全量 20 条**静态推演** + §6.2 **抽样实跑 7 条 MU**（覆盖 §4 全部结论类型——必红/联合锚定/预期不红，且 E106 主链、边源链、fixture·JSDoc 链、聚合链各至少一点；修订 1 措辞修正：原「逐点注入、逐点观测」与 §6.2 抽样交付不一致，属虚标，已消除——SA2 攻击点 3）。未抽样条的锚定性由静态推演承载 | SA7 |
| 实现使红转绿 | 基线事实：零产品 diff 下 99/99 绿（SA6 + 总控两次独立实跑记录） | 已归档（简报 §八/§九） |
| 回归不破坏 | 全量 `pnpm test` + `pnpm typecheck` 于交付 commit 复跑 | SA7 |
| AC 满足性 | 子行为全枚举 × 用例映射（§3），无「未锚定的 AC 子行为」暗仓 | SA1 本设计 |

### 1.3 设计承诺

1. **不扩权**：不新增产品代码改动项。测试文件以 SA6 已归档 14 条为准**不改其断言**；修订 1 经 SA2 攻击点 2 + 总控 dispatch 授权走预授权路径**追加 2 条用例**（规格 §3.1 由本设计冻结、SA3 编码阶段落地、本轮不动测试文件本身）——此为 §10 ALLOW 内最小增量，非扩权。
2. **诚实登记残余**：§5 逐条列出 16 条（14 归档 + 2 修订 1）+ 85 基线联合锚定后仍存活的 mutation 面，按风险分级并裁定接受/强化/关闭，不做「全覆盖」的虚假声明。
3. **交付事务闭环**：HG9 bump 值、SA4 静态核对项、SA7 动态协议、完成标准（§6~§9）。

---

## §2 证据链与 SA1 设计期自测（全部实跑，非口算）

### 2.1 基线事实（继承自 SA6 记录 + 总控独立复核，简报 §八/§九）

| 事实 | 证据 |
|---|---|
| 14/14 新验收测试绿 | SA6 实跑 `pnpm vitest run packages/vfsl/test/parse-vfsl-cycle-detection.test.ts` → 1 file/14 passed，EXIT=0 |
| 全量 99/99 绿 | SA6 `pnpm test` → 7 files/99 passed；总控独立复跑同结果，无 skip |
| typecheck 绿 | 双方 `pnpm typecheck` EXIT=0 |
| 产品零改动 | 总控 `git diff` 证 `packages/vfsl/src/` 零改动 |

> **修订 1 注记**：上表为 SA6/总控归档事实（14 条/99，历史时点）。修订 1 追加的 2 条用例（§3.1）由 SA3 落地后须复现**三绿**：单文件 16/16、全量 7 文件 **101/101**、`pnpm typecheck` EXIT=0（§9 SA3 行；SA7 于交付 commit 终验）。下文凡前瞻性计数（SA4 复核范围、SA7 标准回归、HG14 证据、完成标准）均按 16 条/101 表述；凡归档史实（SA6 首轮记录、§八/§九裁决）保留原始 14/99 并以此注记区分。

### 2.2 SA1 自测探针（2026-08-19，脚本 `/tmp/sa1-issue9-verify.mjs`，只读 worktree）

| # | 核对项 | 结论 |
|---|---|---|
| P1 | **fixture 三源逐字比对**：spec §10 ```vfsl 块 ↔ SA6 测试内两处 fixture 副本 ↔ #6 既有 fixture 用例 | **三源 IDENTICAL**（byte 级；SA6 文件内 AC3/AC4 两副本亦互相逐字同一）——「fixture 逐字复刻」声明成立。**比对方法注记（修订 1，SA2 攻击点 8）**：三处副本分属不同转义层——SA6 源码模板字面量内 `\\\\`（四反斜杠）↔ spec 源 `\\`（双反斜杠），**必须先求值模板字面量、对求值后字符串逐字节 diff**；源码层直接 diff 必假阴性 |
| P2 | **7 个 E106 行列锚点逐位核算**（1 起行、`\n` 分隔、Unicode 码点列；§2.3 表） | 7/7 ✓——期望行列上的字符恰为再入引用记号 `A`，与 spec §4「line/column 为检测到再入的引用记号」语义一致 |
| P3 | **fixture census** | 文档注释 `/**` 恰 **7** 条；别名声明序 `AssetId→Audit→AssetEntity→Attachments→AssetsDoc`；六标记词法位全出现（YMap 1、YArray 1、YPlainArray 1、YXmlFragment 1、YLeaf 12、Pattern 代码位 1 + 注释内提及 2） |
| P4 | **挂载目标独立推演**（每条 doc → 其后首个声明性节点） | 7/7 与 spec §5 挂载表逐行一致（两条同挂 `alias:AssetId`；`@semantic` → `field:notes?`） |
| P5 | **SA6 断言常量与 fixture 原文比对** | `DOC_FIXTURE/ASSET_ID/AUDIT/ASSET_ENTITY/ATTACHMENTS/ASSETSDOC/NOTES` 七常量 7/7 逐字命中 fixture doc 原文（含首尾空格——「逐字保留」的断言侧锚点成立） |
| P6 | **Pattern 双写解码** | fixture 源字节 `\\-`（1 处双反斜杠）→ 解码 `\-`（单）；SA6 `toBe` 断言值与解码期望一致（§2 注记 6 契约） |
| P7 | **HG9 bump 先例** | `git log -L 3,3:packages/vfsl/package.json`：`0.1.0→0.1.1→0.1.2` 每任务一次 patch bump，无例外 |

### 2.3 E106 锚点逐位核算表（P2 明细；探针输出原文摘录）

| 用例 | 输入（`\n` 为真换行） | 断言锚 | 核算 | 上下文 |
|---|---|---|---|---|
| AC1-1 容器包裹 | `type A = { x: A[] };` | (1,15) | ✓ `A` | `= { x: A[] }` |
| AC1-2 多行 | `type A = {\n  x: A;\n};` | (2,6) | ✓ `A` | `  x: A;` |
| AC1-3 标记实参 | `type A = YArray<A>;` | (1,17) | ✓ `A` | `YArray<A>;` |
| AC2-1 标记传递环 | `type A = YArray<B>;\ntype B = YMap<{ a: A }>;` | (2,20) | ✓ `A` | `p<{ a: A };` |
| AC2-2 三节点环 | `…\ntype C = { a: A };` | (3,15) | ✓ `A` | `= { a: A };` |
| AC2-3 纯别名链 | `type A = B;\ntype B = A;` | (2,10) | ✓ `A` | `pe B = A;` |
| AC2-4 Record 值位 | `type A = Record<string, B>;\ntype B = { a: A };` | (2,15) | ✓ `A` | `= { a: A };` |

环路径消息四断言（`A → B → A` / `A → B → C → A`）与 `semantic.ts:163` 的 `[...stack.slice(startIdx).map(f=>f.name), ref.name].join(' → ')` 构造静态一致：AC2 各输入的 DFS 回边闭合序恰为断言路径（推演过程见 §4 M2 行）。

### 2.4 修订 1 新增自测（2026-08-19，/tmp 副本探针，worktree 零触碰）

> 方法：`cp -r packages/vfsl/src /tmp/sa1-r2-probe/<变体>` → `sed` 单点注入突变 → 副本内 import 说明符 `.js`→`.ts` 改写 → `node --experimental-transform-types`（node v24.13.0 内建 TS 变换）驱动 `parseVfsl` 实跑。跑毕副本删除，worktree `git diff` 为空自证。目的：① 对 SA2 R1 报告的实测结论逐项独立复核（修订必须以实测为准，实测本身先复测）；② 新增 2 用例（§3.1）的断言锚与相关突变的失效模式在落地前自测闭合；③ MU-3/MU-11 两个注入配方的可执行性验证（SA2 攻击点 3/6 要求 SA1 定位注入点）。

| # | 核对项 | 结果 |
|---|---|---|
| P8 | 新#15 输入 `type A = Record<A, string>;`（pristine） | `VFSL-E106: 循环引用: A → A` **@(1,17)** ✓ 与 SA2 实测逐字一致（列核算：`Record<` 后键位 `A` 在第 17 码点列——t1 y2 p3 e4 ␣5 A6 ␣7 =8 ␣9 R10 e11 c12 o13 r14 d15 <16 A17） |
| P9 | 新#16 输入 `type A = { x: B };\ntype B = A \| { y: string };`（pristine） | `VFSL-E106: 循环引用: A → B → A` **@(2,10)** ✓ 与 SA2 实测逐字一致（t1 y2 p3 e4 ␣5 B6 ␣7 =8 ␣9 A10）；AC2-1 对照 (2,20) 亦与既有用例锚一致，证探针忠实 |
| P10 | walk 删 `record.key` 下降（semantic.ts:54 单点突变） | 新#15 输入 → **`ok:true` 静默放行**。**证伪 §5 残余 R2 原文「码归属漂到 E306、拒绝保持」**：E306 对环键为 ⊥ 不裁决（shapes.ts:379 环名预填 ⊥ + `checkE306:573` 仅 `=== false` 入池），E106 边一消失候选池即空。失效模式与 union 位同族——「环拒绝行为静默丢失」，比原 R2 定性**更重**；新#15 的 `expectSingleIssue`（期望 ok:false）对此必红，锚定有效且价值高于原评估 |
| P11 | walk 删 `union.members` 下降（semantic.ts:48 单点突变） | 新#16 输入 → **`ok:true` 静默放行** ✓ 与 SA2 论断一致；对照：新#15/AC1-1 输出不变（该突变不影响非联合位环） |
| P12 | MU-11 配方实跑（tokenizer.ts:176 `text.slice(open + 3, close)` 加 `.trim()`） | doc 产出 `["hello doc"]`（丢首尾空格）——AC3#3 七常量 `toEqual`（P5 已证含首尾空格）必红；**注入点定位 + 配方可执行性双重验证** |
| P13 | MU-3 配方实跑（semantic.ts:164 `ref.pos` → `root.namePos`，SA2 攻击点 6 建议的等价注入） | 编译且运行：AC2-1 锚漂至 **(1,6)**（root=A 声明名位）→ `expectIssueAt(…,2,20)` 必红 ✓；`root` 属 :146 循环、作用域覆盖 :164；原配方 `a.namePos` 的 `a` 属 :96/:128 **已结束的独立循环**、在 :164 确已出作用域（SA2 判定成立） |
| P14 | MU-5 正确配方（:160 改 `gray.has(ref.name) \|\| black.has(ref.name)`）对新增 2 用例与 AC1-1 的作用 | 输出全部不变（真环经灰命中，码/锚/消息原样）→ +2 后新文件期望观测收敛为「7 红/9 绿」（AC3×4+AC4×3 红；AC1×3+AC2×6 绿）——SA2 实测基于 14 条文件（7 红/7 绿），外推到 16 条的缺口由本探针闭合 |
| P15 | MU-19 配方（:183 比较器全反转）对单候选输入的作用 | 新#15/新#16/AC1-1 输出不变（单候选无竞争）→ 「16 条全绿」期望自洽（竞争仅存在于 r3/sa7s 多候选文本——SA2 实测其红） |

---

## §3 子行为全枚举 × 16 用例映射（简报 §十指令主项；修订 1 扩 2 条）

> 枚举来源：spec §4「递归与循环引用检测」+ §4 错误模型条款 + §10 fixture 覆盖声明 + §5 挂载规则/挂载表 + PRD #3 测试决策。映射目标：**新 16 条**（`parse-vfsl-cycle-detection.test.ts` = 已归档 14 条 + 修订 1 §3.1 新增 2 条，下称 **新#n**）与**前序基线**（errors= `parse-vfsl-errors.test.ts`、cm= `parse-vfsl-containers-markers.test.ts`、jd= `parse-vfsl-jsdoc.test.ts`、r3= `parse-vfsl-r3-regression.test.ts`、sa7s= `parse-vfsl-sa7-supplementary.test.ts`、e2e= `parse-vfsl.test.ts`）。

### 组 A — E106 环检测语义（spec §4 × AC1/AC2）

| # | 子行为 | 规格依据 | 锚定位置 | 裁定 |
|---|---|---|---|---|
| A1 | 自引用·字段位裸引用 `type A = { x: A }` → E106 | §4 示例 | errors:170（E106@(1,15)） | 前序覆盖 |
| A2 | 自引用·**经容器包裹** `type A = { x: A[] }`（§4 明示形态） | §4「含经容器包裹的」 | **新#1** E106@(1,15) | 本任务锚定 |
| A3 | 自引用·多行形态，锚 line≥2 再入记号 | §4 定位锚 | **新#2** E106@(2,6) | 本任务锚定 |
| A4 | 自引用·**标记实参** `type A = YArray<A>`（引用边来自 Marker 实参） | §4 边源枚举 | **新#3** E106@(1,17) | 本任务锚定 |
| A5 | 互引用·两节点对象字段位 | §4 示例 | errors:177 | 前序覆盖 |
| A6 | 互引用·**经标记传递**两节点环 | §4 边源枚举 | **新#4** E106@(2,20) | 本任务锚定 |
| A7 | 互引用·**三节点环**完整路径 | §4「消息含环路径」 | **新#5** `A → B → C → A` | 本任务锚定 |
| A8 | **纯别名链环**（无容器包裹，边界） | §4 推演 | **新#6** E106@(2,10) | 本任务锚定 |
| A9 | 互引用·**Record 值位**成环 | §4 边源枚举 | **新#7** E106@(2,15) | 本任务锚定 |
| A19 | 自引用·**Record 键位**环 `type A = Record<A, string>` → E106，消息含自环路径 `A → A` | §4 边源枚举（`v1-spec.md:333`「引用边来自字段类型、Marker 实参、Record 键 / 值、数组元素、联合成员」——**修订 1 补锚，SA2 攻击点 2**） | **新#15** E106@(1,17) + `toContain('A → A')` | 本任务锚定（修订 1；实测绿，§2.4 P8） |
| A20 | 互引用·**联合成员位**环 `type A = { x: B }; type B = A \| { y: string };` → E106，消息含 `A → B → A` | §4 边源枚举（`v1-spec.md:333` 同上——**修订 1 补锚，SA2 攻击点 2**） | **新#16** E106@(2,10) + `toContain('A → B → A')` | 本任务锚定（修订 1；实测绿，§2.4 P9） |
| A10 | **环路径进消息**（互引用形态；#6/#7 未锚定） | §4「消息携带环路径」 | **新#4/#5/#6/#7/#15/#16 六处** `toContain`（新#15 兼锚**自环**路径 `A → A`，§5 残余 R1 由本修订关闭） | 本任务锚定（增量） |
| A11 | 锚点 = **再入引用记号**行列（1 起、`\n` 分隔、码点列） | §4 定位锚 | 新 **9 例** `expectIssueAt` + errors×2 | 双层锚定 |
| A12 | issues **恰含 1 条**（v1 单错误模型） | §4 错误数量 | `expectSingleIssue`×**9** + 全基线同 helper | 双层锚定 |
| A13 | message 冻结前缀 `VFSL-E106: ` | §4 传递通道 | `expectCode`×**9** + errors×2 | 双层锚定 |
| A14 | **相位后置**（全量解析成功才进入）+ min-position 聚合 + 多回边全量入池 | §4 分相位规则 | r3:85/90（重复声明并集回边 min-position）、sa7s T-R4-1/2（容器介导环身份归还 E106 不误报 E304）、r3:95（单声明对照） | 前序覆盖（#6 交付） |
| A15 | 前向引用合法不误伤（声明序无关） | §4 解析时机 | e2e:128 前向引用 ok 用例（正例）+ **新#6**（负例）构成对偶 | 前序+本任务 |
| A16 | **无环共享引用（DAG）不误报**（「成环即拒绝」的逆命题约束） | §4 | **fixture 本身**：`Audit` 被 AssetEntity 三成员 + AssetsDoc 多处共享引用、全模块 `ok:true` → 新#8~#11 `expectOk`×4 + 新#12/#13 | 本任务锚定（经 fixture；论证见 §4 M5） |
| A17 | 深链/大图**栈安全**（迭代三色 DFS） | #6 设计 §15.3 | sa7s T-l 20k 裸引用链 ok:true | 前序覆盖 |
| A18 | 环成员未声明 → E301 而非 E106（图节点 = 已声明名） | §4「未知名 = E301」 | errors:142（直接位）+ cm:320/326（变体拼写位） | 前序覆盖（部分位；残余 R4） |

### 组 B — §10 fixture 全量解析（× AC3）

| # | 子行为 | 规格依据 | 锚定位置 | 裁定 |
|---|---|---|---|---|
| B1 | 五别名齐全**按声明序** | §10 | **新#8** `toEqual(['AssetId','Audit','AssetEntity','Attachments','AssetsDoc'])` | 本任务锚定 |
| B2 | **六标记全入 IR**，含嵌套位（`tags: YArray<YLeaf<string>>`、`keywords: YLeaf<string>[]` 元素位、`YPlainArray<YLeaf<string>>` 嵌套） | §10 覆盖声明 | **新#9** 逐标记 kind/marker/arg 断言（六标记各至少一处结构化断言） | 本任务锚定 |
| B3 | Pattern 实参**双写解码**为正则原文 `^[A-Za-z0-9_\-]{1,64}$` | §2 注记 6 | **新#9** `regex` toBe + cm fixture 用例（`jsonContainsString`） | 双层锚定 |
| B4 | **七条 JSDoc 原文逐字挂载到正确节点**（AC3 后半句——#6 fixture 用例未锚的部分，简报 §三已点名） | §5 挂载表（七行） | **新#10**：六别名锚位 `toEqual` 逐字 + 顺序 + 属性锚位 + 无泄漏 | 本任务锚定（增量） |
| B5 | 连续两条 doc 按出现序同挂 `AssetId` | §5 挂载规则 | **新#10** `[DOC_FIXTURE, DOC_ASSET_ID]` + jd 连续两条用例（不同输入文本） | 双层锚定 |
| B6 | 属性锚位挂 `notes?` + **同对象其他字段 docs 恒空数组**（无泄漏；#7 §7.2 必填契约） | §5 + #7 契约 | **新#10** 循环断言 assets/attachments/audit/keywords `toEqual([])` + jd 属性位用例 | 双层锚定 |
| B7 | 判别联合三成员 kind 字面量 `["image","text","file"]` | §10 | **新#11** `toEqual(['image','text','file'])` | 本任务锚定 |
| B8 | `Record<AssetId, AssetEntity>` 键/值**经 ref 引用不折叠** | #6 契约「键约束原样入 IR」 | **新#11** `toEqual({kind:'ref',…})` ×2 + cm Record 用例 | 双层锚定 |
| B9 | `notes?` optional 标志 | §2 `?:` | **新#10** `optional === true` | 本任务锚定 |
| B10 | fixture 整体 `ok:true`（E301/304/306/307/309 全不触发——「语义检查全部通过」） | §10 尾段 | **新#8~#11** `expectOk`×4 + **新#12/#13** | 本任务锚定 |
| B11 | JSDoc **标记锚位**（三锚位之一） | §5 | jd:109（`type Audit = /**…*/ YMap<…>` 挂标记处） | **显式裁定**：fixture 内无此形态（P4 census 证实七条 doc 全落别名/属性位），非 #9 缺口，前序已锚 |
| B12 | E305 悬空 doc | §5 | jd:121 | 前序覆盖（#7 范围，非 #9 AC） |

### 组 C — 序列化与确定性（× AC4，PRD「可序列化、可哈希」）

| # | 子行为 | 规格依据 | 锚定位置 | 裁定 |
|---|---|---|---|---|
| C1 | fixture IR **JSON 往返无损** | PRD #3 | **新#12** `JSON.parse(JSON.stringify(m)) ≡ m` + cm fixture 用例 | 双层锚定 |
| C2 | **确定性**：同文本两次独立解析序列化逐字符相同（#6 未锚定——本任务增量） | PRD「可哈希」的进程内前提 | **新#13** `JSON.stringify(a) === JSON.stringify(b)` | 本任务锚定 |
| C3 | **全 kind 覆盖**（primitive/literal/ref/object/union/array/record/marker/pattern 九种）IR 往返 | PRD | **新#14**（9 行合成文本，九 kind 全出现） | 本任务锚定 |
| C4 | 跨进程/跨版本哈希稳定 | — | — | **显式裁定：不做**。单进程 vitest 无法锚定跨进程观测面；AC4 文义 = 「可 JSON 序列化」，其内容哈希前提由 C2（进程内确定性）+ 规格体系（§8 只增不改、IR 不携带行列——`ir.ts` 头注设计承诺）共同承载。引入跨进程断言属扩权 |

### 组 D — 交付面（非 AC、必裁事项）

| # | 事项 | 裁定 |
|---|---|---|
| D1 | HG9 版本 bump | `0.1.2 → 0.1.3`（§7） |
| D2 | 基线 85 + 新 16 = 101 全绿不破坏（SA3 落地 §3.1 后） | SA7 于交付 commit 复跑全量 + typecheck（§6） |
| D3 | 零运行时依赖红线 | `packages/vfsl/package.json` 仅动 `version` 字段一行，`devDependencies` 不动（§10 ALLOW 收窄到字段级） |
| D4 | 产品 src 零改动 | SA4 静态核对 `git diff` 交付范围（§9）；SA7 mutation 为**未提交的暂态实验**，矩阵跑完即还原并以 `git diff` 清零证明（§6 硬门禁） |

**映射结论（修订 1 重述）**：issue #9 四条 AC 的全部子行为（A1~A20、B1~B12、C1~C4、D1~D4）**无未处置项**——或由本任务 **16 条**锚定（其中 13 项为 #6/#7 既有用例未锚的增量：A2/A3/A4/A6/A7/A8/A9/A10/A16/B4/C2 + 修订 1 新增 **A19/A20**），或由前序基线锚定，或显式裁定不做（B11 fixture 无形态、C4 不可测）。spec §4 边源枚举（`v1-spec.md:333`）的五个边源位现**全部有负例锚定**：字段类型（A1/A5）、Marker 实参（A4/A6）、Record 值（A9）、**Record 键（A19）**、**联合成员（A20）**、数组元素（A2/A10 经容器族）。修订 1 前版本「无未处置项」的结论因 A19/A20 缺位而**过载**（SA2 攻击点 2 指出：值位入表为一等子行为而键位不入，属设计自身标准自相矛盾）——本版以两用例实锚后，该结论方告成立。

### 3.1 修订 1 新增用例规格（新#15/新#16 — SA2 攻击点 2 授权，SA3 编码阶段落地）

> **授权链**：SA2 R1 攻击点 2（HIGH）要求补两用例 → 总控 dispatch（2026-08-19）明确「规格与断言期望（含行列锚）由 SA1 在设计中写明，SA3 在编码阶段落地，本轮不改测试文件本身」。两例在零产品 diff 基线上**实测均绿**（SA2 实测 + SA1 §2.4 P8/P9 独立复核，双方输出逐字一致）——属「已实现未锚定」，与验证型交付自洽（非功能缺口、不触发产品改动）。
>
> **编号与落位约定**：既有 14 条沿用设计序号新#1~新#14（与文件物理顺序无关）；新增两条记**新#15/新#16**。物理落位：`AC2 — 互引用环` describe 内、第 4 个 it（Record 值位）之后**依序追加**两个 it 块；除追加外既有内容零改动（含既有 14 条断言）。允许同步在文件头注释「本文件新增：」清单追加「Record 键位环 / 联合成员位环」二词（注释行同步，非断言改动）。

```ts
it('Record 键位自引用环：type A = Record<A, string>; → E106（边源 = Record 键），锚再入引用记号 (1,17)，消息含 A → A', () => {
  const issue = expectSingleIssue(parseVfsl('type A = Record<A, string>;'));
  expectIssueAt(issue, '106', 1, 17);
  expect(issue.message).toContain('A → A');
});

it('联合成员位互引用环：type A = { x: B }; type B = A | { y: string }; → E106（边源 = 联合成员），锚再入引用记号 (2,10)，消息含 A → B → A', () => {
  const issue = expectSingleIssue(parseVfsl('type A = { x: B };\ntype B = A | { y: string };'));
  expectIssueAt(issue, '106', 2, 10);
  expect(issue.message).toContain('A → B → A');
});
```

**断言依据**（全部实测，§2.4 P8/P9）：键位再入引用 `A` 位于第 1 行第 17 码点列、联合再入引用 `A` 位于第 2 行第 10 码点列（逐位核算见 §2.4）；断言形态与文件既有 helper（`expectSingleIssue`/`expectIssueAt`）及 AC2 既有用例风格一致。

**两例锚定的突变面**：walk `record.key`（semantic.ts:54）/ `union.members`（:48）分支删除 → `ok:true` 静默放行 → `expectSingleIssue` 红（§2.4 P10/P11 实测）；MU-1/MU-2/MU-3/MU-5/MU-19 对两例的期望观测见 §4 M1/M2/M3/M5/M19 与 §6.2 对应行（P13/P14/P15 探针闭合）。

**对 SA2 建议的一处证据更正（不断言偏离）**：SA2 攻击点 2 为新#15 拟题「（E106/E306 同位码序裁定）」——§2.4 P10 实测证伪该理由：环键的 E306 候选**不入池**（shapes.ts 环名预填 ⊥、`checkE306` 仅 `=== false` 入池），E106 边消失后输出为 `ok:true` 而非 E306，同位码序 `106<306` 在本输入上不触发（semantic.ts:21-22 注释：位置并列在实际文法中不可构造，码号序仅为确定性兜底）。断言与 SA2 建议逐字一致，仅标题不携带被证伪的理由注记；同理 §5 残余 R2 原文的「漂 E306」机制表述一并更正（见 §5）。

**落地验收（SA3）**：追加后三绿——单文件 16/16 绿 + 全量 7 文件 101/101 绿 + `pnpm typecheck` EXIT=0，记录入 dispatch log。

---

## §4 锚定强度论证（防假绿）—— mutation 矩阵静态推演

> 方法：对 #9 可观测行为依赖的实现点逐一设想**破坏性突变**，静态推演哪些断言必然红灯。分三类结论：**16 条内必红**（新文件独立锚定）、**联合锚定**（须 16 条 + 前序基线一起才红——SA7 核验须跑全量的依据）、**存活**（诚实登记入 §5 残余）。行号以本基线 `packages/vfsl/src/semantic.ts` 为准（修订 1 已对全部引用行号重新读码核对，见 §2.4）。

| # | 突变点 | 观测面变化 | 新 16 条 | 前序基线 | 结论 |
|---|---|---|---|---|---|
| M1 | 删除 E106 候选入池（`semantic.ts:164` push 移除） | 环文本 `ok:true` | AC1×3 + AC2×**6** 全红（`expectSingleIssue` 期望 ok:false；含新#15/#16） | errors E106×2、r3×3 红 | 16 条内必红 |
| M2 | 环路径消息丢弃/置空（`:163` path 构造改 `''`） | 消息失去 `X → Y → X` | AC2×**6** 红（`toContain`，含新#15 `A → A`/新#16）；AC1×3 **不红**（只锚码+位） | 不红（前序无消息路径断言） | 16 条内必红（互引用**与自引用键位**形态）；自引用 AC1 形态存活（预期内，SA2 独立复核 MU-2 实测同判）——原「残余 R1」**已由新#15 关闭**（自环路径消息现可红） |
| M3 | 锚点漂移（`:164` `ref.pos` → `root.namePos`——修订 1 定稿配方，原 `a.namePos` 的 `a` 已出作用域属编译错，SA2 攻击点 6；§2.4 P13 实跑验证锚漂至 root 声明名位） | 行列错位 | AC1×3 + AC2×**6** 全红（**9 例** `expectIssueAt` 精确 (line,col)；新#15/(1,17)、新#16/(2,10) 亦锚） | errors×2 红 | 16 条内必红 |
| M4 | 回边识别删除（`:160` gray 判定移除） | 同 M1（环漏检） | 同 M1 | 同 M1 | 16 条内必红 |
| M5 | **DAG 误报**（**修订 1 修正注入配方**：`:160` 回边判定改 `if (gray.has(ref.name) \|\| black.has(ref.name))`——灰∪黑皆判环。**原配方「`:166` `!black.has(ref.name)` 改 `true`（等价 gray∪black 皆环）」作废**：该等价不成立——:166 条件改 true 的语义是「黑节点重入**再遍历**」（push 新 frame 重新走整棵子树）而非「黑节点判环」，SA2 /tmp 实测致 sa7s 20k 链 O(n²) 重遍历、全量 180s+ 挂起被杀，预言观测不可达） | 无环共享引用被拒（黑节点引用误产 E106 候选；遍历结构不变，无重入） | **fixture 全解析失败**：根序 AssetId→Audit→AssetEntity，Audit 先完成（black），AssetEntity 首个 `audit: Audit` 边命中合并集 → E106 → `ok:false` → **AC3×4 + AC4×3 全红（7 红）**——AC4#3 的合成文本 `Root→Nested` 黑共享引用同样误报（修订 1 按 SA2 实测补齐计数）；AC1×3 + AC2×6（含新#15/#16——真环经灰命中，输出不变，§2.4 P14）9 绿 | cm fixture 用例**×5** + sa7s **T-l** + e2e **迷你 fixture×1** 红（SA2 R1 实测：全量恰 14 红/85 绿） | 16 条内必红（7 红/9 绿）——**fixture 不仅是正例，同时是 A16（DAG 不误报）的锚**：Audit 三重共享引用 + AssetsDoc 复引用使任何「已访问即环」类突变必然爆雷 |
| M6 | 相位前移（`:84` `declared` 改增量集合，等价于逐声明即判） | 前向引用链环报 E301 | AC2-3 红（`type A = B;\ntype B = A;` 中 B 后向声明 → E301 替代 E106，`expectCode('106')` 失败） | e2e 前向引用 ok 用例红 | 16 条内必红 |
| M7 | walk 边源逐分支删除（`semantic.ts:44-59`，修订 1 补行号）：`object.fields`(:45) / `union.members`(:48) / `array.element`(:51) / `record.key`(:54) / `record.value`(:55) / `marker.arg`(:58) | 对应位置环边漏检——**修订 1 实测澄清（§2.4 P10/P11）：record.key / union.members 删除的失效模式是 `ok:true` 静默放行环（拒绝行为丢失），并非「码漂 E306」** | AC1-1（fields+element 双依赖）、AC1-2（fields）、AC2-2/3（fields）、AC2-4（fields+record.value）、AC1-3（marker.arg）、AC2-1（marker.arg+fields）、**新#15（record.key：ok:true → expectSingleIssue 红）**、**新#16（union.members：同左）**——**六类分支删除各有至少一例红，spec §4 边源枚举五位全锚（§3 映射结论）** | errors E106×2（fields 位）红 | 16 条内必红；**残余 R2/R7 由新#15/#16 关闭（修订 1）** |
| M8 | JSDoc 捕获丢弃（docs 恒 `[]`；**注入点 parser.ts:157**——`claimDocs` 的 `return this.dangling.splice(…).map((d) => d.body)` 改 `return []`，修订 1 补注，SA2 攻击点 3） | IR 无 doc 载荷 | AC3#3 红（6 组 `toEqual` 非空期望） | jd 全套红 | 16 条内必红 |
| M9 | 连续 doc 顺序颠倒（出现序 → 逆序） | `[DOC_ASSET_ID, DOC_FIXTURE]` | AC3#3 红（数组序恰反） | jd 连续两条用例红 | 16 条内必红 |
| M10 | JSDoc 泄漏（doc 挂到同对象全部字段/相邻别名） | 兄弟节点 docs 非空 | AC3#3 无泄漏循环红（4 字段 `toEqual([])`）+ 相邻别名组红 | jd 属性位用例红 | 16 条内必红 |
| M11 | doc 非逐字（trim/归一化空白；**注入点 tokenizer.ts:176**——`pending.push({ body: text.slice(open + 3, close), … })` 的 body 加 `.trim()`，修订 1 定位并实跑验证 §2.4 P12；选为 §6.2 抽样代表 MU-11） | 原文首尾空格丢失 | AC3#3 红——七常量**含首尾空格**（P5），`toEqual` 逐字节比对 | jd 逐字用例红 | 16 条内必红 |
| M12 | Pattern 解码改保留双反斜杠（或丢解码） | regex ≠ 注记 6 原文 | AC3#2 红（`toBe` 精确串） | cm fixture 用例红 | 16 条内必红 |
| M13 | marker 折叠/arg 丢失（`:225` record、toIRType marker 分支） | 嵌套结构缺失 | AC3#2 红（YPlainArray<YLeaf<string>> 三层断言、tags/keywords 嵌套位断言） | cm 对应用例红 | 16 条内必红 |
| M14 | Record 键/值折叠为解析体（ref 消失） | `{kind:'ref'}` 不成立 | AC3#4 红（`toEqual({kind:'ref',name:'AssetId'})` ×2） | cm Record 用例红 | 16 条内必红 |
| M15 | 联合坍缩/成员丢失 | members ≠ 3 / kinds 错 | AC3#4 红（`toHaveLength(3)` + kinds `toEqual`） | — | 16 条内必红 |
| M16 | optional 丢失（恒 false） | `notes.optional` 错 | AC3#3 红 | — | 16 条内必红 |
| M17 | IR 混入非 JSON 值（RegExp 实例/Map/undefined-洞） | 序列化往返丢值 | AC4#1/#3 红（roundtrip `toEqual`） | cm/jd roundtrip 红 | 16 条内必红 |
| M18 | 确定性破坏（跨调用可变态/记忆化污染） | 两次解析序列化不同 | AC4#2 红（字符串全等比对） | — | 16 条内必红（进程内观测面） |
| M19 | min-position 聚合改取末候选（**修订 1 行号修正**：排序 `semantic.ts:182-184`、**比较器 `:183`**、取首 `candidates[0]` **`:185`**——原引 `:234-237` 实为 toIRType 尾部/空行，SA7 按原行号寻点必落空，SA2 攻击点 4） | 多候选文本报错位置漂移 | **16 条不红**——AC1/AC2 各输入均恰 1 条回边，无竞争（§2.4 P15：新#15/#16 单候选输出不变） | **r3:85/90 红（×2）+ sa7s×5 红（T-R2-4/R2-5/R3-2/R4-1/R4-2）**——SA2 R1 实测，强于原「仅 r3」预言 | **联合锚定**——SA7 mutation 核验必须跑全量（§6 规程据此立法） |
| M20 | IR 重新携带 pos（`ir.ts` 承诺回退） | 序列化多出 line/column 字段 | **16 条不红**（roundtrip 仍无损、确定性仍成立）；`toEqual` 比对不锁键集（vitest `toEqual` 忽略 undefined 但不忽略多余定义键——序列化往返后 pos 键仍在，两侧同构，故通过） | 全基线不红 | **存活 → 残余 R3**（裁定：非 AC4 违约——AC4 文义「可 JSON 序列化」不排斥附加字段；内容哈希按**文本**索引，同文本同 IR 仍成立；pos 剥离属 #5 设计承诺的内部纪律，由代码评审守护） |

**静态推演的四点结论（修订 1 更新）**：

1. **E106 主链（检测/锚点/路径/相位/DAG 不误报/六个边源位）与 fixture 主链（五别名/六标记/七 doc/判别联合/Record/序列化）每一环都有 16 条内的直接红灯**——测试不是「碰巧绿」：SA6 首轮 3 失败（helper 未穿透 marker 包裹层）也旁证断言真实执行；新#15/#16 的锚定性另经 §2.4 P10/P11 突变探针在落地前预验。
2. **两处必须依赖前序基线**：M19（多候选聚合）由 r3 回归锚定、A17（栈安全）由 sa7s T-l 锚定。这决定了 §6 SA7 规程「每个 mutation 跑全量 `pnpm test`」而非只跑新文件——否则 M19 类突变会伪报「全红」。
3. **残余台账收敛（修订 1）**：原三处存活中的两处——§5 残余 R1（自引用路径消息）与 R2/R7（边源键位/联合位）——经新#15/#16 实锚**关闭**；余 §5 R3（pos 剥离，M20）及 R4/R5/R6 按原裁定登记，不以「理论覆盖」话术掩盖。
4. **推演错误要登记（修订 1 新增）**：本矩阵两处静态推演曾出错并被实测纠正——M5 注入配方的等价性错误（SA2 /tmp 实测证伪，见 M5 行作废理由）、M19 行号引用错误（实际 `:182-185`）；连同 §5 R2 的机制表述错误（P10 证伪）。已逐处改写并留作废理由，不静默覆盖——静态推演的置信度以其可被实测证伪并更正为前提。

---

## §5 残余清单（联合锚定后仍存活的 mutation 面）

| # | 残余 | 风险 | 裁定 |
|---|---|---|---|
| R1 | 自引用环路径消息 `A → A` 无断言（AC1×3 只锚码+位；`semantic.ts:163` 对自环产出 `stack.slice(0)+ref` = `A → A`，静态推演正确但无测试锚） | — | **已关闭（修订 1）**：新#15 `toContain('A → A')` 直接锚自环路径构造（SA2 攻击点 2 顺带关闭）；原备选「AC1 任一例追加 toContain」不再需要，未采用 |
| R2 | Record **键位**环无负例 | — | **已关闭（修订 1）**：新#15 锚定。**机制表述更正**：原行称「键位环必伴 E306 候选同记号位，码序 106<306 胜出；突变仅使码归属漂到 E306、拒绝保持」——§2.4 P10 实测**证伪**：E306 对环键为 ⊥ 不裁决（shapes.ts:379 环名预填 ⊥、`checkE306:573` 仅 `=== false` 入池），walk 删 record.key 后输出为 **`ok:true` 静默放行**（候选池为空），「拒绝契约在任何突变下保持」不成立；SA2 报告同处附注的「E106/E306 同位码序裁定」亦不触发（semantic.ts:21-22：位置并列在实际文法中不可构造，码序仅确定性兜底）。实际风险**高于**原「低」评级——与 R7 同属「环拒绝行为静默丢失」家族，现由新#15 实锚关闭 |
| R3 | IR pos 剥离无断言（M20） | 低：非 AC 违约（§4 裁定） | 接受，登记为实现纪律（`ir.ts` 头注承诺），由 SA4 静态读码核对 |
| R4 | 联合成员位/Record 键位的 E301 未知名无用例（E301 已锚：直接位 errors:142、多行位 :148、变体拼写位 cm:320/326） | 低：E301 属 #5/#6 范围，#9 的环用例全部用已声明名 | 接受（#5 范围，非 #9 AC） |
| R5 | 语法相位错误与 E106 同文的相位优先级（语法错即时报、不进语义相位）无组合负例 | 低：#5 相位模型承载（errors 全套语法位用例即时报）；#9 的 E106 用例全部「全量解析成功后进入」，与该模型正交 | 接受（前序模型的通用属性，非 #9 特有行为） |
| R6 | 「16 条全绿即关闭 #9」的充分性——测试本身错了怎么办 | 中：SA2 主攻击面 | 由 §2 自测（fixture 三源同一、锚点逐位、常量逐字、挂载推演 + §2.4 修订期突变探针）+ §4 矩阵 + SA7 mutation 实跑三层压制；测试文件以 SA6 已归档 commit `6178994` 为准（14 条）+ §3.1 冻结规格（+2 条，SA3 逐字落地），SA4 逐行复核断言与 AC 的对应及落地与规格的一致性 |
| R7 | walk `union.members` 分支删除无红灯（联合位环/E301 均无用例；fixture 无环不受影响，IR 由 toIRType 独立 switch 构造不受 walk 影响） | — | **已关闭（修订 1）**：新#16 锚定。SA2 论断「union.members 删除 → `ok:true` 静默放行环（`type A = { x: B }; type B = A \| { y: string };` 环不可达、无兜底检查）」经 §2.4 P11 探针实测**证实**；原 R7「低风险：形状语义不静默」的辩解未覆盖「**环拒绝行为本身**静默丢失」——SA2 攻击点 2 指出正确，风险定性据此升级后由实锚关闭。原「SA7 可选加跑 M7-union」升格为 §6.2 抽样正选 MU-7（与 record.key 位一并覆盖边源链动态核验） |

---

## §6 SA7 动态验证协议（替代 TDD 红灯的实跑证据，SA7 执行）

> 原则：mutation 是**未提交暂态实验**，逐个原子化（注入 → 实跑 → 还原 → 清零自证），交付分支最终零产品 diff。全部命令在 worktree 根执行、按 SA7 CLAUDE.md 后台独立进程惯例留日志。

### 6.1 标准回归（必跑，SA3 落地 §3.1 两用例之后的交付态）

```bash
pnpm typecheck                    # EXIT=0
pnpm test                         # 7 files / 101 passed（85 基线 + 16 新，含新#15/#16），EXIT=0
```

### 6.2 mutation 核验矩阵（抽样实跑 7 条，修订 1 扩充——覆盖 §4 全部结论类型与各锚定链：E106 主链 MU-1/2/3/5、边源链 MU-7、fixture·JSDoc 链 MU-11、聚合联合链 MU-19）

| 代号 | 注入（文件:行） | 还原 | 期望观测 |
|---|---|---|---|
| MU-1 | `semantic.ts:164` E106 push 整行注释 | `git checkout -- packages/vfsl/src/` | **新 16 条中 9 红**（AC1×3 + AC2×6，含新#15/#16）+ errors/r3 E106 族红——单文件跑可见，全量红名单以 SA7 实跑为准 |
| MU-2 | `:163` path 构造改 `'循环引用'`（丢路径） | 同上 | **AC2×6 红**（`toContain` 失败，含新#15 `A → A`/新#16）、AC1×3 绿——原「§5 R1 残余」关闭后的直接实证（预期内不红仅剩 AC1×3，如实登记） |
| MU-3 | `:164` `ref.pos` 改 `root.namePos`（**修订 1 定稿配方**：原 `a.namePos` 的 `a` 属 :96/:128 已结束的独立循环、在 :164 出作用域，照抄必编译错——SA2 攻击点 6；`root` 属 :146 循环、作用域覆盖 :164；§2.4 P13 实跑验证） | 同上 | **9 例 `expectIssueAt` 全红**（锚漂至 root 声明名位，如 AC2-1 → (1,6)、新#15 → (1,6)） |
| MU-5 | **`:160` 回边判定改 `if (gray.has(ref.name) \|\| black.has(ref.name))`（修订 1 修正注入点与配方——SA2 攻击点 1 CRITICAL）**。原配方「`:166` `!black.has(ref.name)` 改 `true`」**作废**：其语义是黑节点重入**再遍历**（push 新 frame 重走子树）而非黑节点判环，SA2 /tmp 实测致 sa7s 20k 链 O(n²) 重遍历、**全量 180s+ 挂起被杀**，原期望观测不可达 | 同上 | **新文件 7 红/9 绿**：AC3×4 + AC4×3 红（fixture 与 AC4#3 合成文本的 DAG 共享引用误报 E106 → ok:false）；AC1×3 + AC2×6 绿（含新#15/#16，真环经灰命中输出不变——§2.4 P14）。**全量：新 7 + 基线 cm×5 + sa7s T-l + e2e 迷你 fixture×1 = 14 红/其余绿**（SA2 R1 实测；SA7 逐条比对，以实跑为准） |
| MU-7 | `:54` `walk(t.key, visit);` 整行删除（record.key 边源；修订 1 新增抽样——边源链代表，SA2 攻击点 2） | 同上 | **新#15 红**（输入 `ok:true`，`expectSingleIssue` 抛出——环拒绝静默丢失，§2.4 P10 探针证实）；其余 15 绿；基线预判不红（85 基线无 Record 键位负例——§3 组 D 审计 + SA2 R1 同判），若与实跑不符以实跑为准（HG12） |
| MU-11 | `tokenizer.ts:176` body 切片加 `.trim()`（`text.slice(open + 3, close).trim()`——doc 非逐字；修订 1 新增抽样——fixture·JSDoc 链代表，注入点 SA1 定位并实跑验证 §2.4 P12，SA2 攻击点 3） | 同上 | **AC3#3 红**（七常量含首尾空格的逐字 `toEqual`）+ 全量 jd 基线逐字用例红 |
| MU-19 | **`:183`** 排序比较器反转（y-x 全反转；**修订 1 行号修正**：原引 `:236` 落空——排序 `:182-184`/比较器 `:183`/取首 `:185`，SA2 攻击点 4） | 同上 | **单跑新文件 16 条全绿；全量 `pnpm test` 时 r3×2 + sa7s×5 红（T-R2-4/R2-5/R3-2/R4-1/R4-2，SA2 R1 实测）**——联合锚定实证（SA7 须同时报告两种跑法的差异，此为本矩阵的关键证据点） |

规程硬门禁：
1. **墙钟超时政策（修订 1 新增，SA2 攻击点 1）**：每个注入的全量跑必须带外层墙钟——`timeout 300 pnpm test`（GNU coreutils `timeout` 本机实测可用 v9.4；300s 依据：未突变全量 SA6/总控两次实跑均为常规分钟级内完成，突变后超此限即属异常行为）。**超时 = 「FAIL-挂起」**：如实记入 SA7 报告（含注入代号与墙钟值）→ 立即还原 → `git diff` 清零自证后继续下一注入；**不得**将挂起计为「全绿」、不得省略不报、不得无限延长墙钟重试至「跑完为止」。历史教训即 MU-5 原配方（:166 改 true）——SA2 R1 实测 180s+ 不完成被杀；修正配方机制上不再重遍历，若任何注入仍复现挂起，「FAIL-挂起」记录本身就是有效观测。
2. 每个注入后**必须跑全量** `pnpm test`（不能只跑新文件——MU-19 的教训写入规程）；
3. 每个还原后立即 `git diff --name-only -- packages/vfsl/src/` 输出为空方可进入下一个；
4. 矩阵终了：`git status --short` 下 `packages/vfsl/src/` 零残留 + 6.1 标准回归复跑全绿；
5. 全部注入/还原/输出记入 SA7 报告（含每步 EXIT 码与墙钟值）——HG12：观测与报告一致，MU-2/MU-7 的「预期内不红/单红」照实写；**期望栏所引 SA2 R1 实测数据与本设计 §2.4 探针数据均为预登记参照，实跑不符时以 SA7 实测为准并如实报告**（SA2 报告尾部约定）。

### 6.3 HG14 vitest 触发证据

本设计含 `*.test.ts` 交付 → SA4 review 须含「1.4 vitest 触发性自检」结论、SA7 report 须含「vitest 触发证据」段落（实际运行输出：文件被 vitest 收集执行、**16 条**计数可见——SA3 落地 §3.1 后）。

---

## §7 HG9 版本 bump 裁定

- **值**：`packages/vfsl/package.json` `version: "0.1.2" → "0.1.3"`（patch）。执行者 SA3（简报 §十）。
- **依据**：① #5/#6/#7 先例每任务恰好一次 patch bump（P7：`0.1.0→0.1.1→0.1.2`，无跳级无例外）；② 本次包内改动 = 新增测试文件（包内容变更、无 API/行为变更）——patch 语义精确匹配；③ 简报 §五明文「测试文件属包内改动」须 bump。
- **范围收窄**：仅 `version` 一行；`devDependencies`/`exports`/`scripts` 不动（D3 零运行时依赖红线）。`pnpm-lock.yaml` 不记录 workspace 包自身版本，无需联动变更——SA7 的标准回归 `pnpm test`（§6.1）即同时证实 bump 无 lockfile/工具链副作用；若 CI/check.sh 另有要求，以总控裁决为准。
- **先例口径注记（修订 1，SA2 攻击点 7）**：P7 的「每任务一次 patch bump，无例外」指 **bump 动作**每任务恰一次，非「每任务必产生新版本值」——#6/#7 为平行分支，各自 bump 至同值 `0.1.2`，merge 时保留一处；故版本值序列仅 3 个（0.1.0/0.1.1/0.1.2）而任务数 4（含 scaffold）。SA3/SA4 不应将先例误读为「每任务必产生新版本值」。本任务 bump `0.1.2 → 0.1.3`（SA2 复核裁定正确，无争议）不受该口径影响。

## §8 风险与完成标准

| 风险 | 等级 | 缓解 |
|---|---|---|
| 测试假绿（SA2 主攻击面） | 中 | §4 矩阵 + §6 MU 实跑 + §2 逐位自测三层；SA6 首轮 3 失败史证断言活性；新#15/#16 另经 §2.4 P10/P11 突变探针预验 |
| **MU 注入导致测试套件挂起（无限等待）** | 中（修订 1 新增） | §6.2 硬门禁 1 墙钟超时政策（`timeout 300`；FAIL-挂起如实入报告并还原，不计全绿、不省略、不无限重试）；MU-5 配方已修正为 :160 单条件改写，机制上不再产生黑节点重遍历 |
| SA7 mutation 实验污染交付分支 | 中 | §6 原子化规程 + 双重清零门禁（逐注入清零 + 终局 `git status`/标准回归） |
| SA3 落地 §3.1 偏离冻结规格 | 低（修订 1 新增） | 规格含逐字代码块与行列锚；SA4 复核「落地 ↔ §3.1 一致」；断言零偏离、仅允许注释行同步二词 |
| 「test-only 不足以关闭 #9」的定性争议 | 低 | 简报 §十已由 supervisor 裁定验证型交付路径；SA2 R1 裁定「修复攻击点 2/3 后 test-only 关闭成立的前提（台账完整 + 锚定经验证）已满足」；本设计 §3 映射表即「#9 子行为 ↔ 证据」的完整台账，供 Jim 事后审阅 |
| 版本 bump 引发 lockfile/CI 意外 | 低 | §7 范围收窄 + 先例一致；发布与 CI 由外部 check.sh 承担（红线 1） |

**完成标准**（全部满足）：
1. 分支 diff = ① 新测试文件（14 条归档 + 2 条 §3.1 落地）② `packages/vfsl/package.json` version 一行 ③ wiki 档案（design/review/report/dispatch）；`packages/vfsl/src/` 零 diff；
2. `pnpm typecheck` EXIT=0；`pnpm test` **101/101** EXIT=0（SA3 落地后三绿在案，SA7 于最终 commit 实跑终验）；
3. SA7 mutation 矩阵（7 条）实跑完成且观测与 §4/§6.2 修订后推演一致（MU-2/MU-7 的预期内不红/单红如实登记；期望栏引用的 SA2 实测与 §2.4 探针数据不符时以 SA7 实测为准并说明差异）；零「FAIL-挂起」或挂起已按 §6.2 硬门禁 1 如实处置；
4. SA4 静态：ALLOW 比对零 scope-creep + 「1.4 vitest 触发性自检」结论 + §3.1 落地一致性复核；SA7「vitest 触发证据」段落（16 条计数可见）；
5. 各报告 verdict 行格式合规（`**Verdict**: pass` 且为最后一条）。

## §9 对后续 SA 的交付要求摘要

| SA | 要求 |
|---|---|
| SA2 | 复审（R1 reject 后）：按其报告尾部约定**仅核对修订点与新增 2 用例的实跑三绿记录**，不再全面重攻。攻击面存档（简报 §十）：假绿、未覆盖子行为、test-only 足否关闭 #9、bump 值正确性、证据链有效性 |
| SA3 | ① bump version 0.1.2→0.1.3（§7）；② 按 **§3.1 冻结规格**在 SA6 owned 测试文件追加新#15/新#16 两用例（SA2 攻击点 2 + 总控 dispatch 授权；逐字落地，不改既有 14 条断言，允许头注释「本文件新增：」清单同步二词）；③ 三绿复跑（单文件 16/16 + 全量 101/101 + typecheck EXIT=0）记录入 dispatch log。不得触碰 `src/` |
| SA4 | ① ALLOW/DENY 比对（§10，含 +2 用例授权注记）；② 逐行复核 **16 条**断言 ↔ §3 映射；②b **落地 ↔ §3.1 规格逐字一致性**复核；③ 「1.4 vitest 触发性自检」（16 条计数）；④ 读码核对残余 R3（IR 无 pos）；⑤ 对照 §6.2 预登记的 SA7 观测期望（含墙钟超时政策在册） |
| SA7 | §6 全协议（标准回归 101/101 + mutation 矩阵 7 条含 MU-7/MU-11 + 墙钟超时政策 + 清零门禁 + HG14 证据） |

---

## SA2 反馈逐条回应

> SA2 R1 评审（2026-08-19，verdict: reject）共 8 项攻击点（1 CRITICAL + 2 HIGH + 5 MEDIUM/LOW）+ 边界重申。逐条回应如下；历轮回应只增不删。

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|---|---|---|---|
| 攻击点 1（CRITICAL）：MU-5 注入配方实证错误（原「:166 改 true」≠「gray∪black 皆环」，实为黑节点重入再遍历，/tmp 实测全量挂起；正确注入点 :160）；§6.2 无超时政策；M5 期望观测计数不足 | ✅ | §4 M5、§6.2 MU-5 + 硬门禁 1、§8 风险表、§2.4 P14 | 注入配方改为 `:160` `if (gray.has(ref.name) \|\| black.has(ref.name))`，原配方**作废并留作废理由**（重入再遍历 O(n²)，SA2 实测 180s+ 被杀）；期望观测按 SA2 实测更新：新文件 AC3×4+AC4×3 红（**含 AC4#3**）+ AC1×3/AC2×6 绿，全量 14 红（cm×5 + sa7s T-l + e2e×1）——+2 用例的绿经 §2.4 P14 探针外推闭合；新增墙钟超时政策（`timeout 300`，FAIL-挂起如实入报告并还原，不计全绿不省略不无限重试） |
| 攻击点 2（HIGH）：Record 键位/联合成员位两边源零锚定，§3「无未处置项」过载；R7「形状语义不静默」辩解未覆盖「环拒绝行为静默丢失」 | ✅ | §3 组 A（A19/A20）、§3.1、§4 M7、§5 R1/R2/R7、§10 ALLOW、§2.4 P8–P11 | 新#15/新#16 两用例**完整规格**（逐字代码块 + 行列锚 (1,17)/(2,10) + 消息断言，SA2 实测与 SA1 §2.4 P8/P9 独立复核逐字一致），SA3 编码阶段落地、本轮不动测试文件；§5 残余 R1/R2/R7 改判**已关闭**；映射结论重述（spec :333 五边源位全锚）；R7 风险定性按 SA2 指出升级（「环拒绝行为静默丢失」——P11 探针证实）。**一处证据更正（非断言偏离）**：SA2 为新#15 拟题的「E106/E306 同位码序裁定」理由经 P10 实测证伪（环键 E306 候选 ⊥ 不入池，删 E106 边后输出 ok:true 而非 E306；码序并列为实际文法不可构造的兜底）——断言与 SA2 建议逐字一致，标题不携带被证伪理由，§3.1/§5 R2 留更正记录 |
| 攻击点 3（HIGH）：§1.2「逐点」承诺与 §6.2 抽样交付不一致；fixture/JSDoc 链零动态核验；M8~M16 多数无注入点 | ✅ | §1.2 表行 1、§4 M8/M11、§6.2 MU-11 + 标题、§2.4 P12 | §1.2 改为「§4 全量静态推演 + §6.2 抽样实跑 7 条（覆盖全部结论类型 + 四条锚定链各一点）」消除虚标；新增 **MU-11**（`tokenizer.ts:176` body 加 `.trim()`，注入点 SA1 定位并实跑验证 P12）入抽样矩阵，期望 AC3#3 红 + jd 逐字用例红；M8 注入点（`parser.ts:157` claimDocs return）同步补注；边源链另以 MU-7 入抽样（见攻击点 2 行） |
| 攻击点 4（MEDIUM）：MU-19/M19 行号错误（实际排序 :182-184、比较器 :183、取值 :185；:234-237 为 toIRType 尾部）；期望观测可补 sa7s×5 | ✅ | §4 M19、§6.2 MU-19 | 行号改为 `:183`（比较器）/`:185`（取首）/`:182-184`（排序），原 `:236`/`234-237` 作废；期望观测补记 r3×2 + **sa7s×5（T-R2-4/R2-5/R3-2/R4-1/R4-2）**（SA2 实测，强于原「仅 r3」预言） |
| 攻击点 5（MEDIUM）：M5 预言计数不足（AC4#3 亦红、基线红名单细化） | ✅ | §4 M5、§6.2 MU-5 | 与攻击点 1 一并按实测更新：AC4×3 全红（#3 合成文本 Root→Nested 黑共享引用误报）+ 基线 cm×5 + sa7s T-l + e2e 迷你 fixture |
| 攻击点 6（LOW）：MU-3 原配方 `a.namePos` 中 `a` 已出作用域、编译错 | ✅ | §6.2 MU-3、§4 M3、§2.4 P13 | 配方定稿为 `root.namePos`（:146 循环作用域覆盖 :164），实跑验证锚漂 (1,6) → `expectIssueAt` 必红；原配方的编译错判定留档 |
| 攻击点 7（LOW）：P7 先例未注 #6/#7 平行分支同值碰撞 | ✅ | §7 | 补注：bump **动作**每任务一次 ≠ 每任务新版本值；#6/#7 平行分支各 bump 至 0.1.2（merge 保留一处），版本值 3 个 vs 任务数 4（含 scaffold）；bump 0.1.3 裁定维持（SA2 复核正确） |
| 攻击点 8（LOW）：P1 三源比对未记载「求值模板字面量后比对」方法 | ✅ | §2.2 P1 | 补注转义层（SA6 源 `\\\\` ↔ spec 源 `\\`）与「求值后逐字节 diff」方法，防 SA4 复核假阴性 |
| 边界重申（评审 §5）：计数全文一致性（14→16）、+2 用例三绿重跑、期望栏实测数据以 SA7 实跑为准、不触碰 src/不改既有 14 条断言 | ✅ | 全文 + §2.1 注记、§3.1 落地验收、§6.2 硬门禁 5、§8 完成标准、§9 | 前瞻性计数统一 16 条/101（归档史实保留 14/99 并以 §2.1 注记区分；简报 §八/§九为总控档案，SA1 不改写）；SA3 落地三绿入 §9 与完成标准 2；§6.2 硬门禁 5 明文「SA2 实测与 §2.4 探针数据为预登记参照，以 SA7 实测为准（HG12）」；§10 DENY 的 src/ 全量红线与既有 14 条断言零改动保持不变 |

---

## §10. 文件清单（File Scope）

### ALLOW LIST

- `packages/vfsl/test/parse-vfsl-cycle-detection.test.ts` — `[SA6 owned]` 16 条 AC 验收测试（交付物①：14 条已归档于 commit `6178994` **断言零改动** + 修订 1 新增 2 条）。**修订 1 显式扩展（SA2 攻击点 2 + 总控 dispatch 2026-08-19 授权）**：SA3 按 **§3.1 冻结规格**在该文件 AC2 describe 追加新#15/新#16 两个 it 块（逐字落地，含文件头注释「本文件新增：」清单同步「Record 键位环 / 联合成员位环」二词）——仅此两块，既有 14 条断言零改动；SA3 之外任何 SA 不得改断言逻辑
- `packages/vfsl/package.json` — 修改，**仅 `version` 字段一行**（`0.1.2→0.1.3`，HG9，SA3 执行，交付物②）
- `wiki/raw/task_vfsl-parser-cycle-detection_design.md` — 本设计文档（SA1）
- `wiki/raw/task_vfsl-parser-cycle-detection_sa2_review.md` — SA2 评审档案（SA2）
- `wiki/raw/task_vfsl-parser-cycle-detection_sa4_review.md` — SA4 静态验尸档案（SA4）
- `wiki/raw/task_vfsl-parser-cycle-detection_sa7_report.md` — SA7 动态验证档案（SA7）
- `wiki/raw/task_vfsl-parser-cycle-detection_dispatch.md` — 派遣日志（总控维护）
- `.mabf-done` / `.mabf-bg/*` — 流程事务标记（仅总控，于完成事务时）

### DENY LIST

- `packages/vfsl/src/**`（tokenizer/parser/semantic/ir/errors/shapes/index 全部 7 文件）— **零产品改动是本交付的定义性属性**（简报 §十）。注意：SA7 的 §6 mutation 是未提交暂态实验（注入即还原、`git diff` 清零自证），**永不进入交付 diff**——此为预登记，非 DENY 解除
- `packages/vfsl/test/parse-vfsl.test.ts`、`parse-vfsl-errors.test.ts`、`parse-vfsl-jsdoc.test.ts`、`parse-vfsl-containers-markers.test.ts`、`parse-vfsl-r3-regression.test.ts`、`parse-vfsl-sa7-supplementary.test.ts` — 基线 85 用例所在 6 文件，任何 SA 不改（85 基线不破坏红线；SA7 探针如需临时测试文件，沿用 #7 先例：新建 `sa7-temp-*.test.ts` 跑完即删 + typecheck 复跑坐实零残留，不入交付）
- `docs/vfsl/v1-spec.md` — 冻结规格（§8 只增不改；fixture 逐字复刻的权威源）
- `CONTEXT.md`、`docs/adr/**` — 术语与架构决策，不动
- `packages/vfsl/package.json` 的 `dependencies`/`devDependencies`/`exports`/`scripts` 字段 — 零运行时依赖红线与接缝稳定（字段级收窄，version 行除外）
- `pnpm-lock.yaml` — workspace 包自身版本不入 lockfile（§7）；如工具链强制重生成，报总控裁决后再动

---

## §11. 协议假设依据 (Protocol Assumption Evidence)

本设计无网络/端口/进程生命周期类协议假设（纯进程内 parser 任务）。以下为**工具链行为假设**及依据：

| 假设 | 依据类型 | 依据内容 | 风险 |
|---|---|---|---|
| `pnpm test` = `vitest run`、`pnpm typecheck` = `tsc -p packages/vfsl/tsconfig.json` | 源码引用 | 根 `package.json` scripts（SA1 实读） | 无 |
| `pnpm vitest run packages/vfsl/test/<file>` 可单文件运行 | 设计期实测（第三方，已归档） | SA6 实跑记录（简报 §八：该命令形态 EXIT=0 输出 14 passed）；SA7 沿用同一形态 | 低 |
| vitest 收集 `packages/vfsl/test/*.test.ts` | 现有测试引用 | 7 文件 99 用例现跑记录（SA6 + 总控两次） | 无 |
| mutation 注入可被 `git checkout -- packages/vfsl/src/` 完全还原 | 源码引用 | worktree 为 git 管理且 src/ 基线零 diff（总控 §九复核）；#7 SA7 已有「临时改动即还原 + 复跑坐实零残留」同类先例 | 低 |
| 外层 `timeout` 墙钟可用（`timeout 300 pnpm test` 形态，超时杀进程退出） | 设计期实测 | `timeout --version` → GNU coreutils 9.4（本机 Linux 实跑，2026-08-19）；coreutils 标准语义：到限发 TERM、命令以非零退出 | 低 |
| `git diff --name-only origin/<base> HEAD` 为 SA4 比对形态 | 流程引用 | SA4 SKILL §File Scope（本仓库 base = `origin/refactor/docs-add-mabf-multi-repo-monitoring-note-synthetic`，简报 §三） | 无 |

## §12. 契约改动连锁审计 (Contract Change Caller Audit)

**无契约改动**：本交付不新增/不修改任何函数签名、返回类型、throw 行为或模块导出——产品源码零 diff（§10 DENY）。唯一产品包变更为 `package.json` `version` 字符串字面量（非代码契约；`@nomicore/vfsl` 无运行时消费者——纯引擎仓库内唯一业务包，PRD #3）。公共接缝 `parseVfsl(text)` 形状、issues 字段形状、错误码前缀格式均按 #5 冻结契约**原样延续**（简报 §七红线 2），本设计未提议任何变更，故无 caller 清单可列。
