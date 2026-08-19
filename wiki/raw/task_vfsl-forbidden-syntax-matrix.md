# 任务简报 — Parser 禁止语法负例矩阵（Issue #8）

> Worktree: `/home/wangjian/nomicore-fix-issue-8`
> 分支: `fix/issue-8-on-refactor-docs-add-mabf-multi-repo-monito`
> 任务类型: **功能开发**（流程：SA6 验收测试 → SA1 设计 → SA2 评审 → SA3 编码 → SA4 静态 → SA7 动态）
> 前序: Issue #5（最小端到端 parser）、#6（容器与标记类型）、#7（JSDoc 原文捕获）均已交付合入
> run_id: `issue-8-1787099094-17586`

## 一、任务目标（来自 Issue #8）

v1 方言子集的越界语法逐项拒绝并给出结构化错误：`any`、自定义泛型、条件类型、mapped type、interface 继承。每项配一对用例——负例（越界写法，断言拒绝）与正例（最接近的合法写法，断言接受），证明拒绝是精确的而非一刀切。覆盖矩阵以测试体呈现。

五类禁止构造对应 v1-spec §4 禁止清单的专属错误码：

| 禁止构造 | 违反示例 | 错误码 | 定位锚 |
| --- | --- | --- | --- |
| any 类型 | `type T = any;` | VFSL-E101 | `any` 记号起点 |
| 自定义泛型 | `type Box<T> = { value: T };` | VFSL-E102 | 泛型参数表 `<` 起点 |
| 条件类型 | `type T = A extends B ? C : D;` | VFSL-E103 | `extends` 记号起点 |
| mapped type | `type T = { [K in Keys]: V };` | VFSL-E104 | `[` 起点 |
| interface 继承（声明族整族冻结，含无 `extends` 形态） | `interface A extends B {}` | VFSL-E105 | `interface` 记号起点 |

注：E106（递归/循环引用）不在本任务五类矩阵内，属引用相位，勿混入语法相位矩阵。

## 二、Acceptance Criteria（全部满足才算完成）

- [ ] 五类禁止语法各有负例测试：`ok: false` 且错误含行列与可定位信息（断言错误码前缀 + 锚点记号的 line/column，按 v1-spec §4「错误判定顺序」的锚点规定）
- [ ] 每个负例配套一个「最接近的合法写法」正例通过（`ok: true`），证明拒绝是精确的而非一刀切
- [ ] 矩阵覆盖情况可在测试报告中逐项指认（测试命名/组织需让 vitest 报告输出能逐项对应到矩阵单元格，如负例/正例成对且类别可辨识）

## 三、权威输入（必读）

| 输入 | 角色 |
|---|---|
| `docs/vfsl/v1-spec.md` | v1 方言唯一规范来源（frozen）：§2 EBNF、§4 禁止清单 + 错误判定顺序（规范性，7 条逐条自上而下）+ 分相位、§6 大小写契约 |
| `packages/vfsl/src/`（parser.ts / tokenizer.ts / errors.ts / ir.ts / semantic.ts / index.ts） | 现状代码。E101~E105 专属码映射已在 #5 落地（见 parser.ts 判定顺序注释与 err 调用），本任务在其上扩展矩阵 |
| `packages/vfsl/test/parse-vfsl-errors.test.ts` | #5 交付的异常输入红灯契约（现全绿），其中 82~110 行已有 E101~E105 各一条单点负例。本任务的矩阵是**成对扩展**（负例多维变体 + 正例配对），不得破坏现有绿灯 |
| `packages/vfsl/test/` 其余 5 个测试文件 | #5/#6/#7 交付的契约（现全绿），不得破坏 |
| `wiki/raw/task_vfsl-parser-min-e2e_design.md` | #5 设计：tokenizer 记号全集 Day 1 齐备（`interface` / `extends` / `any` 等作为锚点记号必须产出）、切片外构造拒绝策略 |
| `CONTEXT.md` | 术语规范（方言、标记类型、封闭对象等） |
| `docs/adr/0001-vfsl-single-source-of-truth.md`、`docs/adr/0002-nomicore-is-a-rewrite-authority-out-of-scope.md` | 已有架构决策，不得违反 |
| `wiki/raw/20260818-prd-vfsl-v1.md` | PRD 归档：公共接缝 `parseVfsl(text)` 冻结、零运行时依赖 |

## 四、现状与差距（客观陈述，不含设计）

1. **parser 已有专属码**：E101~E105 的判定顺序映射在 #5 已实现（parser.ts 多处 `this.err(ErrCode.E10x, ...)`），但每类只有 #5 红灯契约里的一条单点负例（`parse-vfsl-errors.test.ts:82-110`）。
2. **本任务的增量**：每类禁止构造的负例矩阵（多维变体：不同嵌套位置、不同形态——如 interface 无 `extends` 形态、别名声明位 vs 类型位置的泛型 `<`、对象字段嵌套位的 `any`/条件类型/mapped type 等）+ 每个负例配对正例。若矩阵变体暴露 parser 现有实现的判定漏洞（如锚点错、码错、误拒正例），需修 parser。
3. **矩阵可指认性**：AC 第 3 条要求测试报告（vitest 输出）能逐项指认矩阵覆盖——测试文件的组织与命名是交付物的一部分。
4. **公共接缝冻结**：`parseVfsl(text)` 返回形状不得改（PRD 冻结）。

## 五、边界与纪律

- 修改 `packages/vfsl/src/**` 的模块必须 bump `packages/vfsl/package.json` patch 版本（当前 `0.1.2`）。
- 不破坏现有全绿测试；`pnpm typecheck`（tsc -p packages/vfsl/tsconfig.json）与 `pnpm test`（vitest run）必须全绿。
- 测试命令一律后台独立进程执行（`setsid nohup ... & disown`）。
- 术语遵循 `CONTEXT.md`；引用规范条目时给出 v1-spec 章节号。
- 本仓库无 `scripts/test-lock.sh`；测试命令以根 `package.json` scripts 为准。

---

## 六、SA6 测试记录（2026-08-19）

### 6.1 测试设计与矩阵组织

新增测试文件：`packages/vfsl/test/parse-vfsl-forbidden-matrix.test.ts`（76 个测试）。

矩阵组织（AC 第 3 条可指认性）：
- describe 名 = 错误码类别（`E101 — any 类型禁止矩阵` 等），it 名 = `<码>-<单元格编号>-<neg|pos> <形态描述>`；
- `neg` = 负例（断言 ok: false + 错误码前缀 + 锚点 line/column 精确值，按 v1-spec §4 判定顺序锚点规定）；
- `pos` = 与负例配对的「最接近合法写法」（断言 ok: true + 解析出的声明数，防「静默截断为 ok」伪绿）。

矩阵单元格分布（共 38 个单元格，负例/正例成对）：

| 类别 | 单元格 | 负例变体 | 配对正例（最接近合法写法） |
| --- | --- | --- | --- |
| E101 any（§4 判定顺序第 5 条，锚 `any`） | 01~08 | 顶层 / 对象字段嵌套 / 数组元素 `any[]` / 联合成员 / 标记实参 `YLeaf<any>` / Record 值位 / 大小写变体 `Any`（→E301，非 E101）/ 纯值上下文 `YPlainArray<any>` | `unknown`（§2 原始类型）同位置替换；`Any` 声明为普通别名后引用 |
| E102 自定义泛型（第 2 条锚 `<` + 第 6 条终判） | 01~08 | 单参 / 多参 / 约束 `<T extends string>`（位置最前 `<` 优先于 E103）/ 默认值 / 空白 / 跨行 `type Box\n<T>` / 类型位置调用位未声明 `Foo<Bar>`（→E301 锚引用记号）/ 调用位已声明 `Box<string>`（→E100 锚 `<`） | 去掉参数表的普通别名；无实参裸引用；字段引用已声明别名 |
| E103 条件类型（第 3 条，锚 `extends`） | 01~07 | 顶层 / 字段嵌套 / 带数组后缀 / 联合成员位 / 标记实参 `YArray<...>` / Record 值位 / PatternType 后联合成员位 | 条件拆为显式联合（`C \| D`、`C[] \| D[]`），C/D 预先声明 |
| E104 mapped type（第 4 条，锚 `[`） | 01~08 | 顶层 / 嵌套对象 / 混普通字段 / 标记实参 `YMap<{...}>` / 对象数组元素位 / readonly 修饰符形态（`[` 不在字段名 Ident 期望位 → **E100** 锚 `[`，非 E104）/ 多层嵌套 / 联合成员内对象 | `Record<K, V>` 键值映射 / 普通对象字段替代；`readonly` 作普通字段名合法 |
| E105 interface 声明族（第 1 条，锚 `interface`，整族冻结） | 01~07 | 无 extends / 带 extends / 多继承 / 混模块（合法别名后，锚 2:1）/ 类型位置（字段类型位）/ 带成员方法 / 大小写变体 `Interface`（→E301，非 E105） | `type A = {};` / `type A = B;`（引用父形状）/ 对象字面量合并字段 / 类型位置引用已声明别名 |

关键契约锚点（全部按 v1-spec §4 判定顺序推导，非按实现反推）：
- E101-07 / E105-07 大小写变体 → E301（§6 大小写契约：变体拼写非保留名，未声明即未知名）；
- E102-06/07 类型位置泛型调用 → 第 6 条终判（未声明 E301 锚引用记号 / 已声明 E100 锚 `<`），证明 E102 专属码只给声明位参数表；
- E104-06 readonly 修饰符形态 → E100（第 4 条字面条件不命中——`[` 不在字段名 Ident 期望位），证明 mapped type 拒绝是精确的、不越权收编其他越界形态。

### 6.2 红灯验证结果（两轮，必须执行）

**第一轮**（62 个矩阵测试）：`pnpm test`（vitest run）7 文件 147 测试**全绿**，exit 0。
**第二轮**（扩充至 76 个矩阵测试，补大小写变体 / 跨行 / 深层嵌套 / PatternType 后条件类型等精确性单元格）：7 文件 161 测试**全绿**，exit 0。

运行方式：后台独立进程（`setsid nohup bash -c 'pnpm test > /tmp/sa6.log 2>&1; echo $? > /tmp/sa6-exit' < /dev/null & disown`），日志见 /tmp/sa6.log。

### 6.3 ⛔ 中断门禁声明（SKILL.md 2026-05-11 立法，A.2 分支适用）

**SA6 无法制造红灯：两轮尝试（每轮扩充矩阵覆盖）后，禁止语法负例矩阵测试（76 个，含全部负例变体与正例配对）全部绿灯，无任何断言失败。**

具体尝试与结论：
1. 第一轮 62 测试（五类 × 顶层/嵌套/标记实参/Record 值位/联合成员等维度 + 每负例配对正例）→ 全绿；
2. 第二轮扩充 14 测试（大小写变体 Any/Interface、跨行泛型 `<`、多层嵌套 mapped、PatternType 后条件类型、纯值上下文 any、readonly 修饰符形态）→ 仍全绿；
3. 每轮均为真实运行时行为断言（parseVfsl 输出驱动，锚点行列手工按规范推导后写入期望），非源码 grep、非跳过、非软兜底——绿灯即 parser 行为与 v1-spec §4 判定顺序一致。

**结论：验收标准 AC-1/AC-2/AC-3 在当前实现上已全部成立**——#5 交付的判定顺序映射（parser.ts `parseIdentType`/`parseTypeAlias`/`parseObjectType`/`parseModule` 各 `this.err(ErrCode.E10x, ...)`）与通用递归已覆盖本任务全部矩阵变体，且锚点行列与规范逐项一致；配对正例无一被误拒。按门禁规则：「验收测试写出来就是绿的，说明功能已存在或需求描述有误」——本任务增量（矩阵扩展）在行为层面已存在，无需 SA3 修改 parser；建议总控中断流水线向 Jim 报告，由 Jim 决定是否收尾（如仅补文档/版本号）或调整任务范围。
