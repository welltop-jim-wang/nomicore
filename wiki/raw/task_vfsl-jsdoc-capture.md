# 任务简报 — Parser JSDoc 原文捕获（`/** */` 挂载 IR）

- **Issue**: #7
- **任务类型**: 功能开发（feature，在既有 `@nomicore/vfsl` parser 上扩展）
- **分支**: fix/issue-7-on-refactor-docs-add-mabf-multi-repo-monito
- **依赖**: #5（Parser 最小端到端，已交付为 PR #12 合入本分支 HEAD `4e7dfe2`）
- **上游 PRD**: issue #3（归档于 `wiki/raw/20260818-prd-vfsl-v1.md`）
- **路线图位置**: parser 系列第二刀（#5 最小端到端 ✅ → **#7 本任务 JSDoc 捕获** → #6 容器与标记类型 → #8 禁止语法负例矩阵 → #9 环检测与 fixture 全量解析）

## 目标（What to build）

`/** */` 文档注释**原文捕获**（逐字保留，含内部 `*`、缩进、换行与 `@tag` 行）并挂载到
**相邻声明性 IR 节点**——三类挂载位置：**类型别名**（声明处）、**属性**（对象字段处）、
**标记类型**（Marker 记号处）。`//` 行注释与 `/* */` 块注释**忽略**（无 IR 节点，不破坏
相邻挂载）。标签**不做结构化解析**——本方言无机器标签，全部文档性质（ADR-0001），
`@tag` 内容原样保留在捕获原文中，不解析、不校验、不告警。

规格唯一规范来源：`docs/vfsl/v1-spec.md` §5 注释规则（三态处理表、忽略/捕获边界、
挂载规则、E305）+ §2 EBNF `DocComment` 与注记 9（注释是词法级 trivia）+ §4 E203/E305。

## 验收标准（Acceptance Criteria — 全部满足才可 complete，逐字来自 issue #7）

1. `/** */` 原文完整保留（含换行与 `@tag` 行）并挂载到正确节点，**经公共入口
   `parseVfsl` 断言**（不测 tokenizer / 内部 AST）。
2. `//` 与 `/* */` 注释不影响解析结果：有无比对 **IR 一致**。
3. **属性、类型别名、标记类型三处挂载位置都有正例覆盖**。

## 现状实测证据（总控 vite-node 探针，2026-08-18，本分支 HEAD）

| 输入 | 当前输出 | 判读 |
| --- | --- | --- |
| `/** doc */ type A = string;` | `ok:true`，IR 无任何 doc 字段 | 🔴 doc 被静默丢弃（AC1 红灯现状） |
| `type A = { /** d */ b: string };` | `ok:true`，IR 无 doc 字段 | 🔴 同上（属性位） |
| `type A = string; /** tail */` | `ok:true`，静默吞掉 | 🔴 规格要求 E305（悬空文档注释） |
| `/* x */ type A = string;` | `ok:true`，块注释忽略 | 🟢 已符合 §5（AC2 基础已在） |
| `type A = YMap<string>;` | `ok:false` E100「YMap<…> 属 v1 合法构造、本切片未实现（待后续 issue 落地）」（`parser.ts:290`） | ⚠️ 标记类型语法未落地 → AC3 标记挂载正例的**范围矛盾**（见开放问题 1） |

既有测试基线：`packages/vfsl/test/` 三文件 37 用例全绿（issue #5 交付），其中已有
「行注释 / 块注释散布可解析」「未闭合块注释 E203」用例。IR 现状（`src/ir.ts`）：
`VfslAlias { kind, name, type }` / `VfslField { kind, name, optional, type }` /
`VfslType` 判别联合（primitive / literal / ref / object / union），**无任何 doc 载荷、
无 marker 节点**。包版本 `0.1.1`。

## 必读输入（按序）

1. `docs/vfsl/v1-spec.md` §5 注释规则（372~407 行）——挂载规则、边界特例、E305；
   §2 EBNF `DocComment`（61 行）+ 注记 9（90~100 行：注释是 trivia、不出现在任何
   产生式右部、E203 锚起始 `/*`）；§4 错误码总表 E203 / E305 行 + 判定顺序 +
   分相位规则（E305/E308 **不在**「模块全量解析后判定」清单内——注意这一细节）。
2. `wiki/raw/20260818-prd-vfsl-v1.md` — PRD #35 行（注释处理需求原文）、#37 行
   （**IR 必须可序列化、可哈希；具体形状由实现自定，通过公共接缝观察**）、
   #8/#11 行（IR 消费者故事：求值器与 AI 消费者依赖 doc 原文挂载）。
3. `CONTEXT.md` — 术语表（标记类型大小写是契约、语义层、方言等用词以此为准）。
4. `docs/adr/0001-vfsl-single-source-of-truth.md` — 语义层**不设机器标签**，全部
   JSDoc 标签为文档性质；`/** */` 挂载是「单一真相源不容丢失」的组成部分。
5. `packages/vfsl/src/` — tokenizer.ts / parser.ts / semantic.ts / ir.ts / index.ts
   现状；`parser.ts:63`（保留名集合含六标记）、`parser.ts:290`（标记/Record 切片外
   拒绝逻辑）。
6. `docs/vfsl/v1-spec.md` 附录 fixture（474~507 行）——**挂载正例的规格级样本**：
   文件首两条连续 doc（`/** vfs3.assets — … */` + `/** 资产 ID：… */`）**同挂**
   `AssetId`；`/** @semantic 可选说明字段 */` 挂属性 `notes?`。（fixture 全量解析是
   issue #9 的验收，**不是本任务**——其中 Pattern / Record / 容器语法本切片不接受。）

## 设计必须回答的开放问题（SA1 职责，SA2 将攻击这些点）

1. **标记类型挂载与 issue #6 的切片边界（本任务最大范围裁决）**：AC3 要求标记类型
   处挂载有正例，但 `YMap<…>` 当前 E100 拒绝（`parser.ts:290` 自注「待后续 issue
   落地」），裸 `YMap` 亦 E100（判定顺序第 7 条）。而测试只测公共入口（PRD Testing
   Decisions）→ 标记挂载正例**必须**让至少一种标记构造通过解析。设计必须显式回答：
   本任务是否纳入**最小标记语法接受**（grammar 进、IR 出 marker 节点），其边界画在
   哪里——§3 的语义约束（E304 形状 / E307 纯值上下文 / E309 混合联合）**必须留给
   #6**，不得提前偷做；同时 IR marker 节点形状必须让 #6 能无破坏性扩展（参考 #5
   简报同名条款的立法精神：不得让后续 issue 需要破坏性返工）。若设计选择不纳入
   标记语法，必须给出 AC3 可满足的替代路径的规格依据；无法自洽 → 标记为需用户裁决。
2. **IR 挂载形状**：doc 载荷放哪个字段、叫什么名；单条 string 还是 string[]（规格
   「连续多个文档注释按出现顺序全部挂载到同一后续节点」→ 有序集合）；无 doc 时该
   字段的形态（注意仓库风格：`exactOptionalPropertyTypes` 下 `VfslField.optional` 用
   必填 boolean 而非可选属性——设计需说明选择及对 JSON 序列化 / 内容哈希 / 既有
   37 用例断言的零破坏性）；marker 节点上挂载与 alias / field 的形状一致性。
3. **E305 判定与相位**：悬空（`/** */` 后直到模块末尾无可挂载节点）锚「注释起始」；
   中间位形态（如 `type A = /** d */ string;`——doc 后随记号不是声明性节点）行为
   如何定义：是 E305、E100 还是其他？规格 §5「紧随其后（中间仅允许空白与忽略型
   注释）」的相邻性判定需精确定义；E305 与「首错即败」「判定顺序」的相互作用；
   E305 在词法 / 语法 / 语义哪一相位报告（注意它不在 §4「模块全量解析后判定」
   清单内，与 E301/E304/E306/E307/E309 不同）。
4. **tokenizer / parser 分层**：DocComment 的词法分类（`/**` 开头即文档注释；
   **特例 `/**/` 与 `/***/` 是块注释不是文档注释**；不嵌套、首个 `*/` 终结；未闭合
   → E203 锚起始 `/*`）；doc token 如何传递到挂载点（trivia 通道设计）；`//` 与
   `/* */` 作为「忽略型注释」出现在 doc 与目标节点之间**不破坏**相邻性（AC2 与挂载
   规则的交汇处）。
5. **范围外清单**：`T[]` / `Record<K,V>` / `string & Pattern<…>` 容器语法仍属 #6；
   JSDoc 标签的结构化解析属语义层（本方言无机器标签，ADR-0001）；fixture 全量解析
   属 #9；禁止语法负例矩阵属 #8。设计需列出本任务**不实现**的错误码清单及理由
   （如 E304/E306/E307/E309 留 #6），并确认 E203 既有行为对新 doc 形态的覆盖
   （`/**` 未闭合）。
6. **版本 bump**：SA3 改动 `@nomicore/vfsl` → `package.json` version `0.1.1` →
   `0.1.2`（硬门禁 9）。

## 约束

- **零运行时依赖**：`packages/vfsl/package.json` 不得引入 runtime dependencies。
- **公共接缝冻结**：`parseVfsl(text)` 返回形状 `{ ok: true, module } | { ok: false,
  issues }` 按冻结口径不变；IR 具体形状是实现自由度（PRD #37），经公共接缝观察。
- **测试只测外部行为**：全部用例经 `parseVfsl` 断言输入→输出；测试文件放
  `packages/vfsl/test/**/*.test.ts`（根 `vitest.config.ts` include 已覆盖）。
- 根 `package.json` scripts：`pnpm typecheck`（tsc -p packages/vfsl/tsconfig.json）、
  `pnpm test`（vitest run）。本仓库**没有** `scripts/test-lock.sh`，不要引用它。
- TS 严格模式全开（`tsconfig.base.json`：strict、noUncheckedIndexedAccess、
  exactOptionalPropertyTypes 等）。
- 既有 37 用例（issue #5 交付）**不得删改既有断言**来腾地方；新增行为用新文件或
  新 describe 承载（允许在既有文件内追加 describe，但不改既有用例语义）。

## 流程

功能开发路由：SA6（验收测试，红灯先行）→ SA1（设计）→ SA2（攻击评审）→ SA3
（TDD 编码修绿）→ SA4（静态验尸）→ SA7（动态验证）→ 收尾。SA5 仅 Bug 修复任务，
本任务不适用。

---

## SA6 红灯测试记录（2026-08-19）

### 测试文件

- `packages/vfsl/test/parse-vfsl-jsdoc.test.ts`（新文件，7 用例；既有 37 用例未改动）

### 需求拆解与测试设计

断言一律经公共入口 `parseVfsl`；doc 原文按「`/**` 与注释结束界定符之间的逐字
文本」断言（含内部 `*`、缩进、换行、`@tag` 行——§5 三态处理表）；挂载锚定
「目标节点子树内逐字可见、兄弟节点内不可见」——不锁定 doc 载荷字段名与集合
形状（PRD #37 实现自由度）：SA3 选单条 string、string[]、字段叫什么名均可满足；
多条顺序用 `indexOf` 先后断言，对 array / 拼接 string 两种形状均成立。

| # | 用例 | 锚点 | 当前状态 |
| --- | --- | --- | --- |
| 1 | 连续两条 doc（多行，含内部 `*`/缩进/换行/`@since v1` 标签行）逐字同挂 AssetId、按出现顺序，不挂相邻别名 Other | AC1 + AC3 别名位（附录 AssetId 样本结构） | 🔴 doc 静默丢弃 |
| 2 | `/** @semantic 可选说明字段 */` 逐字挂字段 notes，不挂同对象 keywords | AC3 属性位（附录 notes? 样本） | 🔴 同上 |
| 3 | `type Audit = /** 审计信息：… */ YMap<{ createdBy: string; }>;` doc 挂 Marker 记号处（类型子树内） | AC3 标记位；`YMap<{…}>` 语法本切片须接受（§3 形状约束 E304 留 #6） | 🔴 `YMap<…>` E100 |
| 4 | `type A = string;\n/** 悬空 */` → `VFSL-E305`，锚注释起始（line 2, column 1） | §5 挂载规则 + §4 错误码表 | 🔴 静默吞掉 ok:true |
| 5 | `/** doc */ // 行注释\n/* 块注释 */ type A = string;` doc 仍挂 A | §5 挂载规则（中间仅允许空白与忽略型注释）∩ AC2 | 🔴 同上 |
| 6 | 行/块注释散布 vs 无注释 → IR 深等 | AC2 有无比对 | 🟢 基础已在 |
| 7 | `/**/` 与 `/***/` 是块注释非文档注释 → IR 深等 | §5 忽略与捕获边界 | 🟢 基础已在（tokenizer 现状天然满足） |

设计压力点说明（供 SA1）：

- 用例 3 的存在即 AC3 对「最小标记语法接受」的压力点：SA1 设计必须显式回答
  开放问题 1（纳入最小标记语法、IR 出 marker 节点，或给出 AC3 可满足的替代
  路径规格依据；无法自洽 → 需用户裁决）。fixture 选 `YMap<{ createdBy: string; }>`：
  对象实参在 full-v1 下 E304 亦通过，对 #6 无破坏性；未引入第二个标记，
  保持本任务最小语法面。
- 用例 4 只锚「模块末尾悬空」这一规格已冻结形态；中间位形态
  （`type A = /** d */ string;`）规格未冻结（开放问题 3），未写测试、留给 SA1 定义。
- 用例 7 是 tokenizer 分层改动（开放问题 4）的关键回归锁：doc 分类落地后
  `/**/` / `/***/` 必须仍按块注释忽略。
- doc 原文按 body 断言（不含开闭界定符）：SA3 若保留完整原文含界定符，
  `toContain` 仍通过——双向兼容，不锁定该细节。

### 红灯运行结果（2026-08-19，vitest v3.2.7）

命令：`pnpm exec vitest run packages/vfsl/test/parse-vfsl-jsdoc.test.ts`

结果：**7 tests | 5 failed | 2 passed**（exit 1）——5 条契约用例全红，2 条 AC2
基础回归锁全绿（与简报探针判读一致）。测试文件经根 vitest.config.ts include
正常收集。

关键失败证据（真实断言输出摘录）：

- 用例 1/2/5：`expected '{"kind":"alias","name":"AssetId","type":{...}}' to contain '<doc 原文>'`——IR 无 doc 载荷，原文被静默丢弃
- 用例 3：`expectOk` 处 `expected false to be true`（`ok: false`，`YMap<…>` E100「属 v1 合法构造、本切片未实现」）
- 用例 4：`expected true to be false`（`ok: true`，悬空 doc 被静默吞掉，E305 未实现）

### SA6 回炉记录（2026-08-19，SA2 R2 流程门 N1 — 用例 1 断言机制修正）

**触发**：设计文档 §7.4 登记（SA2 #1 CRITICAL）。用例 1 原始断言
`expect(JSON.stringify(...)).toContain(DOC_ASSET_1)` 对任何合规实现均不可满足——
`DOC_ASSET_1` 含真实换行符、`DOC_ASSET_2` 含真实双引号，`JSON.stringify` 必然把
换行转义为 `\n` 两字符、引号转义为 `\"`，原始形态子串在序列化输出中**结构上不可能
存在**。该缺陷对 PRD #37 允许的全部 IR 形状（string[] / 拼接 string / 任意字段名）
同样成立，SA3 将被结构性卡死或被迫违规改断言（§7.4 后果链）。

**修正内容（方向 (b)，仅用例 1 的五条断言比对口径）**：断言 `JSON.stringify` 的
**转义形**（`JSON.stringify(DOC).slice(1, -1)`）：

```ts
const e1 = JSON.stringify(DOC_ASSET_1).slice(1, -1); // 含 `\n` 的转义形
const e2 = JSON.stringify(DOC_ASSET_2).slice(1, -1); // 含 `\"` 的转义形
expect(assetId).toContain(e1);
expect(assetId).toContain(e2);
expect(assetId.indexOf(e1)).toBeLessThan(assetId.indexOf(e2)); // 出现顺序
expect(other).not.toContain(e1); // 兄弟别名不可见
expect(other).not.toContain(e2);
```

授权边界（§7.4）：**被测输入文本（`text` 模板、`DOC_ASSET_1`/`DOC_ASSET_2` 常量）与
其余六条用例一律未动**；SA3 仍不可改任何断言。

**修正后红灯运行**（vitest v3.2.7，命令同前）：

```text
Test Files  1 failed (1)
     Tests  5 failed | 2 passed (7)
```

用例 1 失败形态变化：锚点移至 `:83:21`（第一条 `toContain(e1)`），Expected 已呈
转义形——`expected '{"kind":"alias","name":"AssetId","typ…' to contain
'\n * vfs3.assets — 依据 issue #9 描述还原（原…'`。红因正确归位：**doc 被静默丢弃**，
不再是断言机制结构性不可满足（§7.4 判别力核对三维度：多行逐字/出现顺序/兄弟不可见
全部保留，doc 丢失时 toContain 失败 + 顺序判假，红态保持）。

**可满足性探针**（node，合规 IR 模拟 `docs: [D1, D2]` 就位，对照设计 §7.4 probe1）：

```text
[esc] toContain e1: true | toContain e2: true
[esc] 顺序 indexOf: 42 < 113 = true
[esc] 兄弟不可见: true true
[红态判别力] doc 丢失: toContain 失败 = true | 顺序判假 = true
```

→ 修正后断言对合规实现全绿、对现状实现全红，判别力双向保持。SA3 修绿前置条件
（设计 §9.2：用例 1 修正回炉完成）已满足；修正落地前 43/44 是合法中间态，SA3 不得
自行改断言。
