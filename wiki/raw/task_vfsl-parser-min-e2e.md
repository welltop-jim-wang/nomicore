# 任务简报 — Parser 最小端到端：别名 / 原始类型 / 封闭对象 / 可选 / 字面量联合

- **Issue**: #5
- **任务类型**: 功能开发（feature，greenfield）
- **分支**: fix/issue-5-on-refactor-docs-add-mabf-multi-repo-monito
- **依赖**: #4（VFSL v1 方言规格，已交付为 `docs/vfsl/v1-spec.md`，状态 frozen）
- **上游 PRD**: issue #3（归档于 `wiki/raw/20260818-prd-vfsl-v1.md`）

## 目标（What to build）

`parseVfsl` 单一公共入口首次跑通：输入按 v1 方言规格（#4）书写的迷你 schema——类型别名、
`string` / `number` / `boolean` / `null` / `unknown` 原始类型、封闭对象字面量类型、`?:` 可选
属性、字面量联合——输出可序列化的 IR；非法输入返回结构化错误（`{ message, line, column }`
列表）。tokenizer 等内部结构不构成公共契约。零运行时依赖（不引入 yjs / 网络 / 存储）。

## 验收标准（Acceptance Criteria — 全部满足才可 complete）

1. 迷你 fixture（覆盖上述全部构造：类型别名、五个原始类型、封闭对象、`?:` 可选属性、
   字面量联合）解析为 IR，测试经公共入口 `parseVfsl` 断言（不测 tokenizer / 内部 AST）。
2. 语法错误返回 `ok: false` 与 issues 数组，每条含行列（line/column 均 1 起）与信息
   （message 形如 `VFSL-E<编号>: <人类可读消息>`，见规格 §4「错误码传递通道」）。
3. 包内零运行时依赖；测试以 vitest 建立（PRD #3 Testing Decisions）。

## 必读输入（按序）

1. `docs/vfsl/v1-spec.md` — v1 方言唯一规范来源（frozen）：§2 语法子集 EBNF 与 10 条语法
   注记、§4 结构化错误模型（19 个错误码、错误判定顺序、分相位报告、首错即败）、
   §9 实现自由度与未冻结项。
2. `wiki/raw/20260818-prd-vfsl-v1.md` — PRD 归档：公共接缝 `parseVfsl(text)` →
   `{ ok: true, module } | { ok: false, issues }` 已冻结；Testing Decisions（只测外部行为）。
3. `CONTEXT.md` — 术语表（方言 / 信封 / 封闭对象 等用词以此为准）。
4. `docs/adr/0001-*.md`、`docs/adr/0002-*.md` — 不得违反的架构决策（纯引擎仓库、authority
   出范围、语义层无机器标签）。
5. `packages/vfsl/` — 现状骨架（`src/index.ts` 为空壳 export，待实现）。

## 设计必须回答的开放问题（SA1 职责，SA2 将攻击这些点）

- **切片边界**：本任务只实现最小构造集（别名 / 原始类型 / 封闭对象 / 可选 / 字面量联合）。
  输入中出现 v1 规格内、但本切片外的构造（`T[]`、`Record<K,V>`、`string & Pattern<...>`、
  六个标记类型、JSDoc 挂载）时行为如何定义？错误码选取必须与规格 §4 的判定顺序一致，
  不得发明规格外错误；同时不得让后续 issue（#6~#9 扩展 parser）需要破坏性返工。
- **IR 形状**：`module` 的具体形状是 PRD 留给实现的自由度——需可序列化（JSON-serializable）、
  为后续求值器（结构树 / 值 schema 派生）留出可扩展空间，并定义本切片内每种构造的映射。
- **错误码实现范围**：本切片内哪些错误码必须可达/正确（至少 E100 catch-all 与切片内构造
  相关的语法 / 词法 / 引用错误），哪些明确留到后续 issue —— 设计需给出清单与理由。
- **模块布局**：tokenizer / parser / semantic 等内部分层（内部结构不构成公共契约，但需说明
  分层与测试边界）；`@nomicore/vfsl` 包的导出面。

## 约束

- **零运行时依赖**：`packages/vfsl/package.json` 不得引入 runtime dependencies（devDependencies
  的 typescript/vitest 已有即可）。
- **公共接缝冻结**：`parseVfsl(text)` 的返回形状按 PRD #3，不得增改。
- **测试只测外部行为**：全部用例经 `parseVfsl` 断言输入→输出（PRD Testing Decisions）。
- 测试文件放 `packages/vfsl/test/**/*.test.ts`（根 `vitest.config.ts` 的 include 已覆盖）。
- 根 `package.json` scripts：`pnpm typecheck`（tsc -p packages/vfsl/tsconfig.json）、
  `pnpm test`（vitest run）。本仓库**没有** `scripts/test-lock.sh`，不要引用它。
- TS 严格模式全开（`tsconfig.base.json`：strict、noUncheckedIndexedAccess、
  exactOptionalPropertyTypes 等）。

## 历史参考（谨慎使用）

远端分支 `origin/refactor/prd-vfsl-v1--parser`（commit `b709dbe`）含一版被剥离的旧 parser
实现（当时 PRD 讨论未定稿，main 以 `c0f6dfc` 剥离）。该实现**早于** v1 规格冻结，与
`docs/vfsl/v1-spec.md` 存在偏差（规格此后新增 19 错误码体系与判定顺序等条款）。只可作
参考（`git show b709dbe:packages/vfsl/src/parser.ts` 等），**不得**整体照搬或 cherry-pick；
一切以冻结规格为准。

## 流程

功能开发路由：SA6（验收测试，红灯先行）→ SA1（设计）→ SA2（攻击评审）→ SA3（TDD 编码
修绿）→ SA4（静态验尸）→ SA7（动态验证）→ 收尾。SA5 仅 Bug 修复任务，本任务不适用。

---

## SA6 红灯测试记录（2026-08-18，红灯已验证）

### 测试文件

| 文件 | 内容 | 用例数 |
| --- | --- | --- |
| `packages/vfsl/test/parse-vfsl.test.ts` | 幸福路径（迷你 fixture）+ 边界条件 | 11 |
| `packages/vfsl/test/parse-vfsl-errors.test.ts` | 异常输入：结构化错误（E100~E106 / E201~E203 / E301~E303） | 19 |

全部用例经公共入口 `parseVfsl` 断言输入→输出（PRD #3 Testing Decisions：只测外部行为，
不测 tokenizer / 内部 AST）。IR 形状不预锁（`module` 断言仅锚定：object、JSON 序列化往返
无损、序列化输出含全部别名名），给 SA1 设计留自由度。

### 覆盖矩阵（构造 → 正例 / 负例）

| 切片构造 | 正例 | 负例（错误码） |
| --- | --- | --- |
| 类型别名 | fixture 全部 8 个别名；前向引用；空模块；仅注释文本 | 缺终止分号 E100；重复声明 E302；保留名作别名名 E303 |
| 原始类型 string/number/boolean/null/unknown | fixture（`Host`/`Count`/`IsTls`/`Empty`/`Meta` + 字段位使用） | `any` E101；`string<number>` 保留名后随 `<` E100 |
| 封闭对象字面量 | `Server`（含嵌套对象 `info`）；空对象 `{}`；分隔符 `;`/`,` 混合与尾分隔符 | mapped type E104；`{ a?: }` 缺类型 E100；自引用 E106；互引用 E106 |
| `?:` 可选属性 | `count?`/`isTls?`（字段位、含别名引用） | `{ a?: }` 缺类型注解 E100 |
| 字面量联合 | 字符串联合 `"fast" | "safe"`；数字联合 `80 | 443`；前导 `\|` | 括号分组 E100；负数字面量 E100；未闭合字符串 E201；非法转义 E202 |
| 词法 trivia | 行注释 / 块注释散布；纯空白；紧凑与分散写法均可解析；BOM 剥离 | 未闭合块注释 E203 |
| 语法越界（切片外禁止项，负例） | — | 自定义泛型 E102；条件类型 E103；interface E105；未知名引用 E301（含多行行列基准） |

### 断言锚点（不锁实现措辞）

- 每条 issue 断言字段形状 `{ message, line, column }`、line/column 均 1 起、
  issues 恰含 1 条（§4「首个错误即失败」）。
- message 仅断言冻结前缀 `VFSL-E<编号>: `（§4 错误码传递通道），不锁消息全文。
- 行列精确锚点按规格 §4 错误码总表逐字核算（如 `type A = Foo;` → E301 锚 `Foo`
  line 1 col 10；`type A = { x: A };` → E106 锚再入引用 line 1 col 15）。
- 锚点未冻结处（EOF 缺分号、`{ a?: }` 的缺失记号位）只断言前缀与行列 ≥1。

### 🔴 红灯运行结果（2026-08-18 21:15，真实执行）

```text
$ pnpm test        # vitest run
EXIT=1
Test Files  2 failed (2)
     Tests  30 failed (30)
失败原因：TypeError: (0 , parseVfsl) is not a function
  —— packages/vfsl/src/index.ts 为空壳（export {}），公共入口 parseVfsl 未实现。

$ pnpm typecheck   # tsc -p packages/vfsl/tsconfig.json
EXIT=2
error TS2305: Module '"../src/index.js"' has no exported member 'parseVfsl'.（×2 文件）
```

红灯形态符合预期：唯一失败原因即「公共入口不存在」，无其他类型错误；SA3 实现
`parseVfsl` 后测试即定义验收契约。无端口 / 服务依赖，零运行时依赖约束不受影响。

---

## SA6 R2 修正记录（2026-08-18，总控派发）

按 SA1 设计文档 §2（两处与冻结规格矛盾的恒红断言，总控已独立核算确认）修正
`packages/vfsl/test/parse-vfsl-errors.test.ts`。本次为【R2 修正轮】：只做两处断言修正，
不新增用例、不改其他任何断言。

### R2-1 缺陷A：E106 互引用用例输入补 `\n`（第 178 行）

```diff
-    const issue = expectSingleIssue(parseVfsl('type A = { b: B }; type B = { a: A };'));
+    const issue = expectSingleIssue(parseVfsl('type A = { b: B };\ntype B = { a: A };'));
```

断言值不动：`expect(issue.line).toBe(2)`、`expect(issue.column).toBe(15)`。

### R2-2 缺陷B：E302 列断言 18 → 23（第 160 行）

```diff
-    expect(issue.column).toBe(18);
+    expect(issue.column).toBe(23);
```

输入不动（`'type A = string; type A = number;'`）。

### 逐字符核算证据（node 脚本实测，15 项检查全部通过）

核算方式：字符串字面量一律**从文件提取**（新输入 ← 修正后测试文件第 178 行；
旧输入 ← 由新输入反向还原 `';\n'` → `'; '`），零手敲复制；按「1 起列、`\n` 行分隔、
Unicode 码点列」逐字符编号。

- **缺陷A 修正后输入**逐字编号：
  `1:t 2:y 3:p 4:e 5:␣ 6:A 7:␣ 8:= 9:␣ 10:{ 11:␣ 12:b 13:: 14:␣ 15:B 16:␣ 17:} 18:; 19:\n 20:t … 34:A 35:␣ 36:} 37:;`
  → 第 2 行 `type B = { a: A };` 中再入引用 `A` 位于 **(2, 15)**，与断言 `line:2 / col:15` 精确吻合。
- **缺陷A 修正前输入**（物理单行，无 `\n`）：全部 `A` 位于 line 1（col 6 / col 34）
  → 断言 `line:2` 在任何正确实现下恒不可达（恒红根源确认）。
  - 注：设计文档 §2 记再入 `A` 为 col 33，系按「`{ b: B }` 无尾随空格」核算；实际文件
    字节为 `{ b: B };`（`B` 与 `}` 之间有一个空格），实测 col 34。差 1 不影响结论
    （单行输入 line 恒 1，`line:2` 恒红）。
- **缺陷B 输入**逐字编号（未改动）：
  `… 16:; 17:␣ 18:t 19:y 20:p 21:e 22:␣ 23:A 24:␣ 25:= …`
  → 重复的声明名（第二个 `A`）位于 **col 23**，与 `toBe(23)` 吻合；col 18 是第二个
  `type` 关键字的起始（旧断言 `toBe(18)` 锚的是关键字，与规格「锚重复声明名」矛盾）。
  与同文件 E303 用例「锚声明名记号」口径自洽（`type string = number;` → col 6 旁证通过）。
- **范围审计**：修正前后文件 diff 恰为 2 处改动（第 160 行 `toBe(18)`→`toBe(23)`；
  第 178 行输入补 `\n`），无其他任何改动（`packages/vfsl/test/` 为未跟踪目录，
  以会话 Read 记录重建原始文件后逐字节 diff 审计）。

### 修正后红灯复核（2026-08-18 21:37，后台独立进程实测）

```text
$ pnpm test        # vitest run（setsid nohup 后台独立进程）
TEST_EXIT=1
Test Files  2 failed (2)
     Tests  30 failed (30)
失败原因：TypeError: (0 , parseVfsl) is not a function
  —— packages/vfsl/src/index.ts 为空壳（export {}），公共入口 parseVfsl 未实现。
```

修正后整体仍为红灯（`parseVfsl` 未实现，属预期）；两处修正属测试侧缺陷修复——两处
用例随 30 例一并失败于同一 TypeError（公共入口缺失），无任何断言级失败，说明修正后
用例在实现侧的行为契约可被 SA3 正常满足：SA3 修绿后 E106 / E302 两用例将按规格锚点
通过，不再恒红。
