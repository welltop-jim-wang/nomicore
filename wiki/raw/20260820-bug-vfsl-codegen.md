# [Bug/缺口分析] F2 投影生成器 @nomicore/vfsl-codegen——前置依赖核验通过 + 生成器缺口全量复现（issue #26）

**Status**: analyzed | **Date**: 2026-08-20
**Severity**: high（F2 缺口阻塞整条投影生成管线价值兑现：无生成器 → 无生成物 → G 票 dogfood 无法开工）
**Type**: new-feature-defect（声明式缺口：F2 从未实现，非回归——基点 0be8c11 上零 codegen 痕迹）
**Layer**: architecture（新包 + CLI 接线 + CI 步骤 + 生成物锚定，跨 packages/ 根配置 与 .github/）

> 角色说明：issue #26 为 feature 票（F2 生成器），本报告按总控路由以「前置依赖核验 + 缺口分析」
> 职能产出（任务简报 §流水线路由说明）。核心结论分两部分：**(A) 两个前置依赖已在基点
> 0be8c11 实证可用**（blocked-by 解除，F2 可开工）；**(B) 生成器缺口全量复现**（五件套全缺）。

## Symptoms

任务简报声明 issue #26（F2 生成器）blocked by #20（#29 补 docs）与 #25（#37 F1 接缝）。
需核实的两面：

1. **前置依赖是否真的就绪**：`evaluate` 派生 schema 七槽（含 docs 三槽）与
   `FileSchemaSource`/`assertVfslDialect`/`SchemaSourceError` 接缝在基点 0be8c11 是否
   实际可用（声明合入 ≠ 接缝可消费）；
2. **生成器缺口是否如声明**：仓库是否确实无 `@nomicore/vfsl-codegen` 包、无任何生成物、
   无 `pnpm generate` / `generate --check` 命令、CI 无 regen-diff 步骤。

## Reproduction

环境：worktree `/home/wangjian/nomicore-fix-issue-26`，分支 `fix/issue-26-on-adr-vfsl-protocol`，
基点 0be8c11（无本地提交），node v24.13.0 / pnpm 10.28.2。

### (A) 前置依赖实证——临时诊断测试（已还原）

方法：在 `packages/vfsl/test/` 下临时创建 `sa5-diag-dependency-verify.test.ts`
（带 `[SA5-DIAG]` 标记，14 条断言全部锚定 `packages/vfsl/src/index.ts` 公共导出面的
可观测输出，不读内部实现），运行后删除、`git status` 确认现场干净。

```bash
pnpm exec vitest run packages/vfsl/test/sa5-diag-dependency-verify.test.ts
# → Test Files 1 passed (1) | Tests 14 passed (14) | Type Errors no errors
```

**(a) #20/#29：evaluate 派生 schema 七槽 + docs 三槽**

自构造 .vfsl fixture（别名/字段/标记三锚位 JSDoc + kind 判别联合 + Record<Pattern 键,…>
+ YMap/YArray/YLeaf/YPlainArray/YXmlFragment 全标记类型 + 裸 T[] 数组），链路
`parseVfsl(text) → evaluate(module) → 逐槽检查`，实测输出：

```
[SA5-DIAG] 七槽 = ["aliasDocs","aliases","fieldDocs","index","markerDocs","structure","values"]
[SA5-DIAG] aliasDocs = {"EntryId":[" SA5 核验 fixture：键约束别名文档 "],
  "Entry":[" SA5 核验 fixture：判别联合别名文档 "],
  "Meta":[" SA5 核验 fixture：纯值数组终态别名文档 "],
  "Box":[" SA5 核验 fixture：标记位文档载体 "],
  "ROOT":[" SA5 核验 fixture：根别名文档 "]}
[SA5-DIAG] fieldDocs 键集 = ["Box.n","Entry.<member 0>.body","Entry.<member 0>.body.words",
  "Entry.<member 0>.kind","Entry.<member 1>.kind","Entry.<member 1>.url","ROOT.box",
  "ROOT.entries","ROOT.entries.<key>","ROOT.label","ROOT.meta","ROOT.tags"]
[SA5-DIAG] markerDocs 键集 = ["Box","Box.n","Entry.<member 0>.body",
  "Entry.<member 0>.body.words","Entry.<member 0>.body.words.<item>","Entry.<member 1>.url",
  "Meta","Meta.<item>","ROOT","ROOT.label","ROOT.tags.<item>"]
[SA5-DIAG] Entry discriminator = {"field":"kind","byValue":{"note":0,"link":1}}
[SA5-DIAG] index 键集 = ["ROOT","ROOT.box","ROOT.entries","ROOT.entries.<key>","ROOT.label",
  "ROOT.meta","ROOT.tags","ROOT.tags.<item>"]
[SA5-DIAG] StructureNode kinds = ["array","leaf","map","plain","ref","root","union","xml-fragment"]
```

逐项断言全过（要点）：

- **七槽恰形**：`Object.keys(derived).sort()` 精确等于上述七键（ADR 0003 契约形状）；
- **aliasDocs**：别名级 JSDoc 逐字携带（含 ROOT；无 doc 的表项为空数组，必填键而非条件展开）；
- **fieldDocs**：字段级 JSDoc 逐字携带——命名字段路径（`ROOT.label`）、联合成员内字段
  （`Entry.<member 0>.kind/body`、`Entry.<member 1>.url`，成员序 0 起）、Record 值位合成段
  （`ROOT.entries.<key>`，恒空数组——IR record 无 docs 槽）；
- **markerDocs**：标记级 JSDoc 逐字携带——别名体标记位（`Box`）、字段类型标记位（`Box.n`）；
- **判别联合**：`structure.aliases['Entry']` 与 `values['Entry']` **双槽**均携带
  `discriminator = { field: 'kind', byValue: { note: 0, link: 1 } }`（byValue 键 =
  String(字面量)，值 = 成员声明序）；
- **index**：`Record<Pattern 键,…>` 的 `ROOT.entries.<key>` 条目 `match: 'pattern'` +
  `keyPattern: '^[a-z]{1,8}$'`（解码后正则）；`values['EntryId'] = { kind: 'pattern',
  regex: '^[a-z]{1,8}$' }`；
- **全部八种 StructureNode kind** 均可产出（root/map/array/xml-fragment/leaf/plain/union/ref
  ——ref 按名引用不内联，ADR 0003 §4）；
- **JSON 序列化往返无损**（含 docs 三槽——纯数据纪律成立）。

**(b) #25/#37：FileSchemaSource / assertVfslDialect / SchemaSourceError**

临时目录（`mkdtemp`）种 `.vfsl` 头部指令文件实测，输出：

```
[SA5-DIAG] 信封四键 = ["id","lang","text","version"] ；text→evaluate ok
[SA5-DIAG] list = ["sa5.extra","sa5.demo"]
[SA5-DIAG] unknown-id 错误 = {"kind":"schema-source","code":"unknown-id","id":"no.such.id"}
[SA5-DIAG] missing-directive：load(broken@0) 与 list() 均结构化拒绝
[SA5-DIAG] dialect-mismatch：load(odd.id) 含 path，list() 同样拒绝
[SA5-DIAG] assertVfslDialect：vfsl/1 通过；vfsl/2 与 json/1 均 dialect-mismatch
```

逐项断言全过（要点）：

- **load**：`new FileSchemaSource(root).load('sa5.demo')`（root = 包含 `domains/` 的根目录，
  扫描 `domains/<domain>/*.vfsl` 深度恰 1+1）→ 信封**恰四键**
  `{ lang: 'vfsl', version: 1, id, text }`，text = 文件原文逐字（含头部指令注释）；
  **信封 text 可直接 `parseVfsl` + `evaluate`**（行注释 = 词法 trivia）——生成器
  「load → 断言 → parse → evaluate」全链零文本变换，接缝自洽；
- **list**：返回按序声明的 id（序 = 目录名 sort → 文件名 sort，确定性）；`domains/` 缺失
  （ENOENT）= 合法空集；任一文件损坏 → 整体 reject（一坏全拒，CI 可见性根基）；
- **三码结构化错误**：`unknown-id`（无文件声明该 id；含 id 上下文）、`missing-directive`
  （损坏头部经 `id@<digits>` 目录名诊断回退指认，含 path）、`dialect-mismatch`
  （`@lang: json` → 层 1 内建断言拒绝，含 path）——`SchemaSourceError instanceof Error`，
  `name/kind/code` 可枚举，`rejects.toMatchObject({ kind, code })` 直接可见；
- **assertVfslDialect**（消费方首动作，ADR 0005 §1）：`{lang:'vfsl',version:1}` 通过；
  `vfsl/2`、`json/1` 均抛 `SchemaSourceError('dialect-mismatch')`（带 id 上下文）。

### (B) 生成器缺口复现——仓内静态证据

```bash
ls packages/                          # → vfsl  vfsl-protocol（无 vfsl-codegen）
grep -rn 'vfsl-codegen' --include='*.json' --include='*.yaml' --include='*.yml' \
  --include='*.ts' packages/ apps/ package.json pnpm-workspace.yaml pnpm-lock.yaml
                                      # → (零命中)
grep -rln 'GENERATED'  --include='*.ts' packages/ apps/ domains   # → (零命中)
grep -rln 'DO NOT EDIT' --include='*.ts' packages/ apps/ domains  # → (零命中)
find . -name '*.generated.ts' -not -path './node_modules/*'       # → (零命中)
ls domains                            # → domains/ 目录不存在
# 根 package.json scripts = {"test":"vitest run --typecheck","test:watch":"vitest",
#   "typecheck":"tsc -p packages/vfsl/tsconfig.json && tsc -p packages/vfsl-protocol/tsconfig.json"}
grep -n 'name:\|run:' .github/workflows/ci.yml
                                      # → Install pnpm / Install Node / Install dependencies
                                      #   / Typecheck / Test / Domain scaffolds check（无 regen-diff）
git log --oneline | grep -i codegen   # → (零 codegen 提交)
```

**缺口清单（五件套全缺）**：

| # | 缺口 | 证据 | ADR 0005 契约出处 |
|---|------|------|------------------|
| G1 | 无 `@nomicore/vfsl-codegen` 包 | `packages/` 仅 vfsl/vfsl-protocol；全仓零命中 | §后果「生成器包：@nomicore/vfsl-codegen」 |
| G2 | 无任何生成物（零 `.generated.ts`、零 `GENERATED`/`DO NOT EDIT` 头注、无 `domains/`） | grep/find 零命中；domains/ 不存在 | §4「生成文件入仓，头注 GENERATED … DO NOT EDIT + 源文本哈希」 |
| G3 | 无 `pnpm generate` / `generate --check` 命令 | 根与各包 scripts 均无 generate | §4「CI generate --check：全量重新生成 → diff 为空」 |
| G4 | CI 无 regen-diff 步骤 | ci.yml 六步中无 generate/regen | §4「源漂移与生成器逻辑漂移双抓」 |
| G5 | 历史零 codegen 提交（从未实现，非回归） | git log 零命中 | §后果票拆分 F2 |

## Investigation

阅读（Step 1+2，共 9 个文件）：

1. `wiki/raw/task_vfsl-codegen.md`（任务简报）——核验目标与缺口口径；
2. `packages/vfsl/src/index.ts`——公共导出面：`parseVfsl`/`evaluate`/`validateSnapshot`
   + F1 三件套 `FileSchemaSource`/`assertVfslDialect`/`SchemaSourceError` + 类型导出
   `DerivedSchema` 等（公共面与简报「仓库事实」逐字一致）；
3. `packages/vfsl/src/derived.ts`——`DerivedSchema` 七槽类型形状（docs 三槽 JSDoc 明示
   键文法：`<member N>`/`<key>`/`<item>` 合成段）；
4. `packages/vfsl/src/schemasource.ts`——F1 接缝实现（头部指令解析、两级寻址、三码
   错误树、方言断言双层防御）；
5. `packages/vfsl/test/evaluate-derived-docs-typecls.test.ts`（fixture 语法样例来源）；
6. `packages/vfsl/test/vfsl-assets-fullchain-e2e.test.ts`（§10 fixture 与全链编排先例）；
7. `docs/adr/0005-projection-generation-pipeline.md` §3/§4/§5——生成器输入契约与保鲜
   机制（冻结契约）；
8. `packages/vfsl-protocol/test/vfsl-protocol-projection.test-d.ts` 顶部——手写迷你
   `VfslPathMap` 增广（生成物形状活样板）；
9. `.github/workflows/ci.yml` + 根/包 `package.json`、`pnpm-workspace.yaml`（bash 读取）。

数据流追踪（Step 3，经诊断测试驱动真实代码路径）：

```
.vfsl 文本（含 JSDoc + 判别联合）
  → parseVfsl（行注释 trivia；头部指令注释可直接过）
  → evaluate（IR → 派生 schema：物化折叠/联合三分类/判别式检测，docs 三槽逐字继承）
  → [F2 应消费点] 生成器（缺）→ 类型别名 + declare module 增广（缺）→ CI regen-diff（缺）
```

断点位置：派生 schema 之后整条发射管线不存在——这不是某行代码的缺陷，而是 F2 票
**整体未实现**（G5：历史零提交佐证）。前置数据（docs/判别式/接缝）在断点上游全部就绪。

### 过程中的两次自纠（SA6 写红测试的防坑要点）

初次运行 14 断言中 2 条失败，均为**我方预期写错**（非依赖缺陷），实测纠正后全绿：

1. **markerDocs 键形**：裸 `T[]` 数组的元素标记路径是 `ROOT.tags.<item>`（`<item>`
   合成段），字段路径 `ROOT.tags` 本身**无** markerDocs 条目（裸数组无标记 token）；
   `YPlainArray`/`YArray` 实参入 `<item>` 段（`Meta.<item>`），`YMap`/`YXmlFragment`/
   `YLeaf` 实参透明（路径不变）——`evaluate.ts` walkDocs 规则的运行时实证；
2. **list() 顺序** = 目录名 sort → **文件名** sort（同目录下 `extra.vfsl` < `schema.vfsl`
   → `sa5.extra` 先于 `sa5.demo`），非 id 字典序。

## Root Cause

**F2 生成器从未实现**：基点 0be8c11（HEAD = #37「SchemaSource 接缝与脚手架文件格式
（F1）」）上，`@nomicore/vfsl-codegen` 包、生成物、CLI 命令、CI regen-diff 步骤、生成物
锚定物五件套全部不存在（G1–G5）。同时**两个前置依赖实证就绪**：#20/#29 的派生 schema
七槽（docs 三槽逐字携带、判别式双槽携带、index 模式键、八种结构节点、JSON 往返无损）
与 #25/#37 的 SchemaSource 接缝（信封恰四键、text 零变换可解析、三码结构化错误、方言
断言）均以公共导出面实测可用——issue #26 的 blocked-by **已解除**，无环境性/依赖性阻塞。

**Fix direction**（供 SA1 设计参考，不展开实现方案）：

按 ADR 0005 §3/§4 落地 `@nomicore/vfsl-codegen`（起版 0.1.0，`pnpm-workspace.yaml`
`packages/*` 已自动覆盖）：输入 = `evaluate` 派生 schema（纯发射器，不碰 IR）+ 首动作
`assertVfslDialect`；发射类型别名 + `declare module '@nomicore/vfsl-protocol'` 增广
（载体形态照 `vfsl-protocol-projection.test-d.ts` 顶部迷你增广）；docs 三槽 → TSDoc；
判别式 → 可窄化判别联合（成员独有字段 `T | undefined`，D2）；数组 → `Record<\`${number}\`,…>`
（D1）；ref 按名引用不内联；头注 `GENERATED … DO NOT EDIT` + 源文本哈希；CLI
`pnpm generate` / `generate --check` 接根 package.json scripts；CI 在 Test 后加
regen-diff 步骤（全量重新生成再 diff，双抓源漂移与生成器漂移）。架构设计细节（生成物
锚定策略、CLI 执行载体、新包 test-d 接线）归 SA1。

## Evidence

**E1 前置依赖 (a) 实测**：`pnpm exec vitest run …sa5-diag-dependency-verify.test.ts`
→ `Tests 14 passed (14)`，`[SA5-DIAG]` 输出见 Reproduction (A)(a)（七槽/三 docs 槽
键集与逐字内容/discriminator/index/八 kind/JSON 往返）。

**E2 前置依赖 (b) 实测**：同上运行，输出见 Reproduction (A)(b)（信封四键/
list 序/三码错误/方言断言）；信封 text 经 `parseVfsl → evaluate` 得
`aliasDocs['ROOT'] = [' SA5 核验 demo 领域：根别名文档 ']`（头部指令注释零障碍）。

**E3 缺口静态证据**：Reproduction (B) 全部命令输出（G1–G5）。

**E4 git 基点**：`git log --oneline -5` 首条 = `0be8c11 SchemaSource 接缝与脚手架文件格式
（F1）(#37)`；工作区无本地提交（`git status` 仅未跟踪的调度器文件 TASK.md 与任务简报）。

**E5 现场清理**：临时诊断测试已删除，`git diff --stat` 空、`git status` 仅剩
`?? TASK.md`、`?? wiki/raw/task_vfsl-codegen.md`、`?? wiki/raw/task_vfsl-codegen_dispatch.md`
（均为调度器写入的工作区文件，纪律明示不入分支 commit）。

**E6 全量基线**：`pnpm test`（vitest run --typecheck）于基点 0be8c11 全绿——
`Test Files 20 passed (20)`、`Tests 376 passed (376)`、`Type Errors no errors`
（含 `domains-scaffold.test.ts` AC5 空集 notice：「0 domain schemas found（domains/
不存在或为空——G 票落地后此处自然非空）」——再次佐证 G2 缺口）。

## 给 SA6 的锚点建议（红测试锚定输入）

以下均为本报告实测钉死的事实，SA6 红测试可直接以此为契约（红灯 = 生成器不存在/
发射不符；绿灯后不得改变这些输入形状——它们是 #20/#29、#25/#37 已冻结的公共面）：

1. **输入构造**：`const parsed = parseVfsl(text); parsed.ok === true` →
   `evaluate(parsed.module).derived`——生成器函数签名应吃 `DerivedSchema`（+ 信封/源
   文本哈希输入），不吃 IR、不吃 .vfsl 原文（ADR 0005 §3）；
2. **docs 三槽键形**（红测试断言 TSDoc 发射时的查表键，别写错）：
   - `aliasDocs[别名名]`（含 `'ROOT'`）；
   - `fieldDocs[语法路径]`：联合成员内字段 = `别名.<member N>.字段`（N 从 0 起）；
     Record 值位 = `…<key>`（恒空数组）；`<item>` 不出现在 fieldDocs（数组元素位无字段）；
   - `markerDocs[标记语法路径]`：裸 T[] 与 YArray/YPlainArray 实参入 `<item>` 段；
     YMap/YXmlFragment/YLEaf 实参路径透明；
3. **判别联合**：判别式只在 `kind === 'union'` 节点的 `discriminator`
   （`{ field, byValue }`，byValue 值 = 成员序）上读取；structure 与 values 双槽同形；
4. **Record 模式键**：`index['ROOT.<字段>.<key>'].match === 'pattern'` +
   `keyPattern`（解码后正则；`values[键别名] = { kind: 'pattern', regex }`）——
   `Record<string, …>` 发射的查键点；
5. **SchemaSource 消费姿势**：`new FileSchemaSource(repoRoot)`（root = 含 `domains/`
   的根目录）→ `load(id)` 信封恰四键 → `assertVfslDialect(envelope)` 首动作 →
   `parseVfsl(envelope.text)` 零变换；错误断言用
   `rejects.toMatchObject({ kind: 'schema-source', code })` 三码；
6. **发射载体样板**：`packages/vfsl-protocol/test/vfsl-protocol-projection.test-d.ts`
   顶部手写迷你增广（`declare module '@nomicore/vfsl-protocol' { interface VfslPathMap … }`，
   值为 `PathSchema<…, kind>` 树；kind 词汇 `'map'|'array'|'xml-fragment'|'leaf'|'plain'`；
   数组 `Record<\`${number}\`,子树>`；YPlainArray 终态 `PathSchema<V[], 'plain'>`）；
   顶层键 = ROOT 的字段、路径无 `ROOT` 前缀（D5）；
7. **仓库接线事实**（红测试落点）：根 `vitest.config.ts` include
   `packages/*/test/**/*.test.ts` 已自动覆盖新包 `test/`；typecheck include
   `packages/*/test/**/*.test-d.ts` 但 tsconfig 指向 `packages/vfsl-protocol/tsconfig.json`
   ——新包 test-d 接线是 SA1 待钉死的开放点；根 scripts 现仅 test/test:watch/typecheck
   （`generate` 尚不存在——`pnpm generate --check` 退出非零的「命令不存在」形态也是
   可锚定的红面，但建议锚定「命令存在且对过期生成物退非零」的终态契约）；
8. **CLI 执行载体注意**：仓库零构建产物（`@nomicore/vfsl` exports 直指 `./src/index.ts`），
   源码内部相对导入带 `.js` 后缀（ESM TS 风格）——`pnpm generate` 如何在不引入重依赖的
   前提下执行 TS（tsc 出 dist / tsx / 其他）归 SA1 定夺，SA6 红测试应锚 CLI 可观测
   行为（退出码/diff 输出）而非执行载体。

**SA1 待定夺的开放点**（本报告只列事实不代设计）：生成物锚定策略（测试 fixture vs
仓内首个生成文件——`domains/` 现不存在，F1 明确不种首领域，归票 G，F2 不得越权种植
业务领域）；CLI 执行载体；新包 test-d tsconfig 接线；既有包零改动（若 F2 只新增包 +
根 scripts + CI，则 vfsl 0.1.8 / vfsl-protocol 0.1.0 无需 bump——Hard Gate 9 仅在改动
既有包时触发）。
