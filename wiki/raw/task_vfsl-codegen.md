# 任务简报 — 功能开发：投影生成器 @nomicore/vfsl-codegen（Issue #26 / F2）

- **任务类型**: feature（ADR 0005 票拆分 F2：生成器，blocked by #20 + #25/#37——两者已合入基点 0be8c11）
- **Worktree**: /home/wangjian/nomicore-fix-issue-26
- **分支**: fix/issue-26-on-adr-vfsl-protocol（基点 0be8c11，无本地提交）
- **Parent**: PR #23
- **run_id**: issue-26-1787217317-8348

## 背景

ADR 0005 冻结投影生成管线：F1（#37，已合入）落地 SchemaSource 接缝与 `.vfsl` 脚手架
文件格式；#29（已合入）补齐派生 schema 携带 docs（aliasDocs/fieldDocs/markerDocs 三槽）。
本票 F2 落地**生成器**：吃 `evaluate` 的派生 schema，发射类型别名 + `declare module`
增广文件，并建立「生成物入仓 + CI regen-diff」的保鲜机制。F2 是 G（domains/vfs3-assets
dogfood，票 #27）的前置。

## 工作内容（ADR 0005 §3/§4 + issue #26 body）

实现 `@nomicore/vfsl-codegen` 生成器包：

1. **输入契约**：生成器是 `evaluate` 派生 schema 的纯发射器（不直接吃 IR——物化折叠、
   联合三分类、判别式检测只计算一次，单一真相）；同时作为 SchemaSource 消费方，
   首动作 = 方言断言（ADR 0005 §1）；
2. **类型映射表**（ADR 0004 + 设计文档 §8.3）：
   - `Record` → `Record<string, …>`；
   - 标记类型 → kind（`YMap`→map / `YArray`→array / `YPlainArray`→plain 终态 /
     `YLeaf`→leaf / `YXmlFragment`→xml-fragment）；
   - `Pattern` → string；`YXmlFragment` → string；
   - ref → 别名引用（不内联展开，ADR 0003 §4）；
   - 数组 → `Record<\`${number}\`, …>` 子树（下标段可解析，ADR 0004 D1）；
   - docs → TSDoc 注释（依赖 #29 的派生 schema docs 三槽）；
   - 判别式 → 判别联合（可窄化的 TS discriminated union；联合键空间 = 成员键集并集，
     成员独有字段 read → `T | undefined` 宽度，ADR 0004 D2）；
   - 增广载体形态参照 `packages/vfsl-protocol/test/vfsl-protocol-projection.test-d.ts`
     顶部手写迷你增广（`declare module '@nomicore/vfsl-protocol' { interface VfslPathMap … }`，
     值为 `PathSchema<…, kind>` 树）；
3. **生成文件头注**：`GENERATED … DO NOT EDIT` + 源文本哈希；
4. **CLI**：`pnpm generate`（全量重新生成 + 写盘）/ `pnpm generate --check`
   （重新生成 → diff 为空，否则退出非零）；
5. **CI regen-diff**：`generate --check` 接入 `.github/workflows/ci.yml`，
   源漂移与生成器漂移双抓（纯哈希比对抓不了后者——必须全量重新生成再 diff）。

## Acceptance criteria（issue #26）

- [ ] 映射表逐行有发射断言（含 `YPlainArray` 终态、联合 `T | undefined` 宽度）
- [ ] docs 出现在生成的 TSDoc 上（依赖 #20/#29 派生 schema 携带 docs）
- [ ] 判别式联合发射为可窄化的 TS 判别联合
- [ ] `generate --check` 对过期生成物退出非零；CI 接入
- [ ] 零运行时依赖纪律不适用于本包但依赖最小化

## 核心参考文档

- `docs/adr/0005-projection-generation-pipeline.md` — §3 生成器输入契约、§4 生成物入仓
  + CI regen-diff（本票冻结契约）、§5 领域包位置（domains/ 归票 G）
- `docs/adr/0004-vfsl-protocol-type-projection.md` — D1–D5（映射表、联合宽度、
  协议包纯类型边界、路径无 ROOT 前缀）
- `docs/adr/0003-evaluator-derived-schema.md` — 派生 schema 契约、按名引用
- `docs/vfsl/v1-spec.md` — v1 方言规格（标记类型语义、纯值上下文）
- `CONTEXT.md` — 术语规范（派生 schema/求值器/信封/方言用词以此为准）

## 仓库事实（SA 共用）

- **公共接缝现状**（基点 0be8c11，`packages/vfsl/src/index.ts`）：
  - `parseVfsl(text)` / `evaluate(module)` / `validateSnapshot(derived, snapshot)`；
  - F1 接缝（#37）：`FileSchemaSource`（扫描 `domains/*/`，构造入参 = 包含 domains/
    的根目录）、`assertVfslDialect({lang,version})`、`SchemaSourceError`
    （kind: 'missing-directive' | 'dialect-mismatch' | 'unknown-id'）；
  - 类型导出：`DerivedSchema`（aliases/structure/values/index/aliasDocs/fieldDocs/
    markerDocs 七槽）、`StructureNode`、`ValueSchema`、`SchemaSource`、`SchemaEnvelope`
    等（见 `packages/vfsl/src/derived.ts` / `schemasource.ts`）。
- **派生 schema docs 三槽**（#29 已合入）：`aliasDocs`（别名级，含 ROOT）、`fieldDocs`
  （字段语法路径，`<member N>`/`<key>`/`<item>` 合成段）、`markerDocs`（标记所处
  语法路径）——TSDoc 发射的输入。
- **协议包**（`packages/vfsl-protocol`，0.1.0）：`PathSchema<Value, Kind>` /
  `PathAt` / `PathValue` / `PathKind` / `VfslTypedAccess` / **`VfslPathMap`**（空接口，
  由 `declare module '@nomicore/vfsl-protocol'` 增广；顶层键 = ROOT 的字段，路径无
  `ROOT` 前缀，D5）。
- **既有增广样例**：`packages/vfsl-protocol/test/vfsl-protocol-projection.test-d.ts`
  顶部手写迷你 `VfslPathMap` 增广（生成物形状的活样板）。
- **测试装置**：根 `vitest.config.ts` —— include `packages/*/test/**/*.test.ts`；
  typecheck include `packages/*/test/**/*.test-d.ts`，tsconfig 指向
  `./packages/vfsl-protocol/tsconfig.json`（新包 test-d 接线由 SA1 设计定夺）。
- **测试命令**：根目录 `pnpm test`（vitest run --typecheck）；`pnpm typecheck`
  （tsc -p 两个包的 tsconfig）。新包入 `pnpm-workspace.yaml`（现 packages/* + apps/*）。
- **CI**：`.github/workflows/ci.yml` —— install → typecheck → test →
  Domain scaffolds check（F1 AC5；TODO(#27) 注记 domains/ 首领域归票 G）。
- **版本**：`packages/vfsl` 0.1.8、`packages/vfsl-protocol` 0.1.0；新包
  `@nomicore/vfsl-codegen` 从 0.1.0 起版；改动既有包须 bump patch（Hard Gate 9）。
- **domains/ 现状**：不存在（F1 设计明确「不种首个领域文件」；G 票职责）。F2 的
  生成物锚定策略（测试 fixture vs 仓内首个生成文件）由 SA1 设计定夺，不得越权替 G
  种植业务领域。
- **环境**：本会话 shell 可用（node v24.13.0 / pnpm 10.28.2，gitdir 可写）。

## 纪律

- TDD：先写红测试再改代码；SA3 不得在测试契约锚定前动生产代码
- 本地测试红必须修，禁止屏蔽/跳过/排除测试
- **TASK.md 是调度器写入的工作区文件，不得进入分支 commit**；`.mabf-bg/` 同纪律
- 改动模块 bump patch 版本（Hard Gate 9）
- wiki/raw/ 产出文件必须随分支 commit
- **不得执行 `git push` / `gh pr create`**（发布由 supervisor / check.sh 负责）

## 流水线路由说明（总控记录）

issue #26 未标记 Task Type → 总控判定：新增能力（生成器包）→ **feature**。按
SKILL routing 表 feature = SA6→SA1→SA2→SA3→SA4→SA7；但本任务完成事务明确要求
全链 SA5→SA6→SA1→SA2→SA3→SA4→SA7，且 F2 声明 blocked by #20/#25——前置依赖成立性
与缺口分析确有 SA5 职能空间（依赖已合入的实证 + 生成器缺口的复现），故 **SA5 以
「前置依赖核验 + 缺口分析」角色入链**，产出照常落
`wiki/raw/20260820-bug-vfsl-codegen.md`。

---

## SA6 红灯测试记录（测试契约锚定 —— 验收测试红灯）

**节点**：feature → SA6 验收测试锚定。**产出**：`packages/vfsl-codegen/test/` 下 4 文件
（3 运行时/CLI 红 + 1 typecheck 参照绿）。**不触碰** `packages/vfsl` 与 `packages/vfsl-protocol`
生产代码（`git status` 未改动，见 Evidence）。

### 1. 契约定形（SA3 实现的唯一行为锚点）

**生成器公共导出**（SA1/SA3 按此落包；函数名/签名以本契约为准，SA1 可微调命名但不得改
可观测语义）：

- `import { generateProjection } from '@nomicore/vfsl-codegen'`；
- `generateProjection(derived: DerivedSchema, opts?: { sourceText?: string }): string` ——
  纯发射器，输入 `evaluate` 的派生 schema（不吃 IR/不吃 .vfsl 原文，ADR 0005 §3；SA5 锚点 1），
  返回生成 TS 文本；`opts.sourceText` 用于头注源哈希（ADR 0005 §4，AC4 头注）。
- **输入形状冻结**：SA3 不得改 derive 三槽/docs——它们是 #20/#29 已冻结公共面（SA5 实证）。

**发射物体貌（t0）**：
- 头注 `GENERATED … DO NOT EDIT` + 源文本哈希（`generate-discriminated-emission.test.ts`）；
- `declare module '@nomicore/vfsl-protocol' { interface VfslPathMap { … } }` 增广；
  顶层键 = ROOT 字段、无 ROOT 前缀（D5）；
- 映射表断言见 `generate-mapping-table.test.ts`：
  - `YMap`→`PathSchema<Record<…­>, 'map'>`；`YLeaf`→`PathSchema<T,'leaf'>`；
    `YXmlFragment`→`PathSchema<string,'xml-fragment'>`（不透明终态）；
  - 裸 `T[]` / `YArray`→`PathSchema<Record<\`${number}\`, 元素子表>,'array'>`（D1 下标可解析）；
  - **`YPlainArray`→`PathSchema<V[], 'plain'>` 纯值终态**（无 `Record<number,子树>`，D1 禁令）；
  - `Record<Pattern 键,…>`→`Record<string, 值位子树>`（键含 Pattern→string）；
  - ref→别名引用、不内联展开（ADR 0003 §4）；
- **docs 三槽 → TSDoc**（AC2）：`aliasDocs[别名名]`（含 `'ROOT'`）逐字进生成注释
  （fixture：`根文档说明`/`实体的判别联合`/`Id：Pattern 键约束`）；
- **判别式联合**（AC3）：有 `discriminator` 的 union 节点发射为可窄化 TS 判别联合——
  精确字面量判别字段 `kind`、成员互异、联合键空间 = 成员键集并集、
  成员独有字段 read → `T | undefined`（文案级字段在场断言在 emission 测试）。

### 2. 测试选址与 typecheck/runtime 分工

| 文件 | 装置 | 锚定 |
|---|---|---|
| `generate-mapping-table.test.ts` | 运行时 `*.test.ts` | AC1 映射表逐行 + AC2 docs→TSDoc |
| `generate-discriminated-emission.test.ts` | 运行时 `*.test.ts` | AC3 文案级（判别联合形状）+ 头注/哈希/determinism |
| `generate-discriminated-narrow.test-d.ts` | typecheck `*.test-d.ts` | AC3 **编译级窄化** + D2 `T|undefined` 宽度（read） |
| `generate-cli-check.test.ts` | 运行时 `*.test.ts`（spawnSync） | AC4 `generate`/`generate --check` 退出码 |

- 选址：`packages/vfsl-codegen/test/`，被根 `vitest.config.ts` include
  `packages/*/test/**/*.test.ts` 与 typecheck `…/*.test-d.ts` 自动覆盖（无需新接线）。
- **职责**：AC3「可窄化」是编译期行为 → 由 `*.test-d.ts`（vitest typecheck，`expectTypeOf`
  断言）承担；运行时 `*.test.ts` 断言发射文案确为该可窄化形状。AC1 的 `T|undefined` 宽度
  属类型投影行为 → 由 test-d 以 `read` 投影断言；AC3 文案以 emission 断言。
- **跨包导入**：`@nomicore/vfsl` 以相对路径 `../../vfsl/src/index.js` 导入（既有先例），
  避免依赖新包未接线的 workspace 软链；唯一软件包名导入 = `@nomicore/vfsl-codegen`
  （被测导出），使其 module-not-found 即为红灯根因。

### 3. 红证据（红灯必须真实·非语法/转译伪红）

```text
$ pnpm test                          # 待生成器落地前
Test Files  3 failed | 21 passed (24)
     Tests  3 failed | 382 passed (385)
Type Errors  no errors
exit code 1

[Failed Suites 2]  module-not-found（被测导出不存在）：
  packages/vfsl-codegen/test/generate-mapping-table.test.ts
  packages/vfsl-codegen/test/generate-discriminated-emission.test.ts
  Error: Cannot find package '@nomicore/vfsl-codegen' imported from …/generate-*.test.ts
[Failed Tests 3]（被测 CLI 不存在 → `pnpm generate` 254 ≠ 0）：
  generate-cli-check.test.ts 三断言 expected 254 to be +0
[TS 参照 绿] generate-discriminated-narrow.test-d.ts (6 tests)：发射目标确可窄化
```

- 红灯根因 = `@nomicore/vfsl-codegen` **不存在**（被测导出/CLI 缺失），非语法/转译错误
  （Type Errors no errors）。
- 既有测试全量保持 376 绿（21 passed 文件含全部先绿文件）；ES6 基线未破坏。
- `generate-discriminated-narrow.test-d.ts` 当前**绿**：属「发射目标参照系」——手写嵌入
  生成器应产出的判别联合增广（复刻 vfsl-protocol-projection.test-d.ts 顶部活样板），
  `expectTypeOf` 断言该形状确为可窄化判别联合（AC3）+ `read` 成员独有字段为 `T | undefined`
  （AC1/D2）。生成器实现后，运行时 emission 测试会验证生成器**真发出**该形状；本文件保
  证发射目标本身编得过且可窄化。此绿是**故意的参照绿**，非伪绿。
- 增量红证明：SA3 实现导出后依赖本契约转绿；`pnpm test` 全绿即红线清空。

### 4. 交付 SA1 的开放点（红测试已锚但设计待定）

1. **生成器函数签名**：`generateProjection(derived, opts?)` 为契约假设（SA5 锚点 1），
   SA1 可改函数名/参数形态，但必须保持「吃 DerivedSchema、返回发射文本、手注 sourceText
   哈希」可观测语义不动；
2. **CLI 目标目录机制**：本红测试用 `pnpm generate --domains <dir>`（临时 hermetic fixture
   指向），因 F2 不种 `domains/`（归票 G）。`--domains` 为契约提议，SA1 可换 flag/positional，
   但必须保留：`generate` 存在且退 0、`generate --check` 对过期生成物退非零、对新鲜退 0；
3. **test-d 接线**：SA5 锚点 7 指出的新包 test-d tsconfig 开放点——本文件经根 vitest typecheck
   （vfsl-protocol tsconfig）已可跑（Type Errors no errors），SA1 不必新增 tsc 接线；
4. **CI regen-diff 步骤**：AC4「CI 接入」为工作流文件改动，归 SA3/SA4 落地并以其证据为准
   （本红测试不 grep `.github/workflows/ci.yml`——源码/配置 grep 禁令）；`generate --check`
   的退出码语义已由 `generate-cli-check.test.ts` 锚定。

### 5. 环境残清

`git status --short` 仅 `packages/vfsl-codegen/test/`（新增测试）+ `.mabf-bg/`/`wiki/raw/`
调度器文件；`packages/vfsl`、`packages/vfsl-protocol` 零改动。诊断脚手已删。

- **[SA6 owned] R2：异议 #1 正则修复** —— `generate-mapping-table.test.ts` 三处（tags/items/
  entityList 数组载体断言）正则按要求对齐设计 §9.2 修订稿，补回模板字面量键开头反引号
  （`Record<`${number}`, …>`，原正则 `Record<${number}` 缺反引号永不可匹配合法 D1 发射物）；
  断言语义/数量不变、仅正则文本、smoke 复跑确认失败模式仍为
  `Cannot find package '@nomicore/vfsl-codegen'` module-not-found 真红（见 .mabf-bg/sa6-r2-mapping.log）。
- **[SA6 owned] R3：SA2 攻击点 #7 同类缺陷修复** —— `generate-mapping-table.test.ts` L115
  内联负例正则 `/attachments\s*:\s*PathSchema<Record<\$\{number\}/`（`.toBe(false)`）同样缺
  开头反引号、对合法 TS 永不命中、负例恒过检测力为零；修订为
  `/attachments\s*:\s*PathSchema<Record</`（去掉 `\$\{number\}` 段，无需模板键）。断言意图
  零改动（plain 终态禁令：不得以 `Record<` 为值的任何形态出现）、仅改该正则文本；亲跑
  复跑确认失败模式仍为 module-not-found 真红（见 .mabf-bg/sa6-r3-mapping.log）。
- **[SA6 owned] R4：总控路由 SA2 R2 建议 A+C 契约增补（程序验证可靠，裁决采纳）** ——
  ① 建议 A（钉死 §3.2 规则 0·值侧 ref 优先）：`generate-mapping-table.test.ts` fixture
  增 `leafRef: Id;`、`metaRef: YMap<Meta>;` 与 `type Meta = YMap<{ m: YLeaf<number> }>;`，
  新增断言 `leafRef → PathSchema<Id, 'leaf'>`（leaf,ref 别名引用）、
  `metaRef → PathSchema<Meta, 'map'>`（已解析 map,ref 判别性用例——字面按结构侧必内联挂）、
  段② `export type Meta = { 'm': PathSchema<number, 'leaf'> };`（对象字面量形）；
  既有断言零改动（实测派生形状：leafRef 结构=leaf/值=ref Id；metaRef 结构=已解析
  map/值=ref Meta，与设计 §10 行 10 一致）。② 建议 C（§3.2.1 ROOT 范围限界升契约）：
  `generate-discriminated-emission.test.ts` 新增——联合形 ROOT
  （`type ROOT = | { a: YLeaf<string> } | { b: YLeaf<number> };`，实测 parse+evaluate ok、
  structure=root→union）经 generateProjection 抛 `/ROOT 形态不支持/`
  （UnsupportedRootShapeError 消息前缀）。亲跑两文件确认失败模式仍为 module-not-found
  真红（见 .mabf-bg/sa6-r4-run.log）。
- **[SA6 owned] R5：总控路由设计 §9.2.2 建议 D/E/F 契约增补（R3 设计；实现 008e34c 早于 R3）** ——
  ① **建议 D（ref→ROOT 按需具名发射，裁决 (b)）**：`generate-discriminated-emission.test.ts`
  新增 describe——fixture `type ROOT = YMap<{ a: YLeaf<string> }>; type Node = YMap<{ r: ROOT }>;`
  断言不抛 + `/export type ROOT\s*=/`（段②按需具名声明）+ `/['"]r['"]\s*:\s*PathSchema<ROOT,\s*'map'>/`
  （引用位按名引用）。② **建议 E（optional 剥壳，规则 1）**：`generate-mapping-table.test.ts`
  新增 describe——fixture `type ROOT = YMap<{ title?: YLeaf<string>; meta?: Meta }>;`（Meta 自备）
  断言 not.toThrow（无假 desync）+ `/title\?:\s*PathSchema<string,\s*'leaf'>/`（键后单 ?）+
  `not.toMatch(/title\?\?/)`（禁双 ?）+ `/meta\?:\s*PathSchema<Meta,\s*'map'>/`（规则 0 穿透
  optional 包装）。③ **建议 F（union 同形裁决）**：emission 测试新增 describe——同形
  `u: YArray<YLeaf<string>> | YArray<YLeaf<number>>` → 联合 kind 精确 `'array'`（尾参断言，
  形状逐字依设计）；异形 `A | B`（map 别名 | array 别名）→ `toThrow(/联合成员结构 kind 异形/)`
  （UnsupportedUnionKindError 消息前缀）。亲跑（见 .mabf-bg/sa6-r5-run.log）：
  **红证据 = 建议 D 真红**——`Test Files 1 failed | 1 passed (2)`、`Tests 1 failed | 21 passed (22)`、
  exit 1；失败断言 `/export type ROOT\s*=/`（实现输出仅 `export type Node = { 'r': PathSchema<ROOT, 'map'> };`
  + 接口内 `a: …`，缺段② ROOT 具名声明——引用位已按名但按需具名声明未落地，实现行为不符的真红）。
  **如实记录：建议 E/F 对当前实现为绿**（探针核实为真绿非断言弱化：实现已输出
  `title?: PathSchema<string,'leaf'>`/`meta?: PathSchema<Meta,'map'>` 与同形联合尾参 `'array'`、
  异形抛 `/联合成员结构 kind 异形/`——008e34c 已具备 E/F 规则，D 为唯一缺口）。既有断言零改动。
- **[SA6 owned] R5 纠偏：建议 D 裁决由 (b) 翻转 (a)（总控裁决通知）** —— 裁决来源：
  设计 R3 定稿 §3.4 处置段 + §1.1 D5 决策行精化（总控定夺 (a) 案，纠正前稿 (b) 按需具名发射）：
  ref 目标为 ROOT（值侧 ref 目标 / kindOf 链 / 段② 走查任一抵达）→
  `UnsupportedRootReferenceError` 命名化 loud throw（消息前缀「ROOT 不可被引用」，
  CLI → exit 2，与 §3.2.1 Record/联合 ROOT 限界同一诚实策略，保 D5 单一载体语义；
  SA3 侧为新增拦截补丁）。处置：`generate-discriminated-emission.test.ts` 的
  `§3.4 R3 — ref→ROOT` describe 块**整块翻转**为 (a) 案断言——fixture 不变
  （`type ROOT = YMap<{ a: YLeaf<string> }>; type Node = YMap<{ r: ROOT }>;`），断言改为
  `expect(() => generateProjection(result.derived)).toThrow(/ROOT 不可被引用/)`，
  describe/it 标题与注释同步改为「(a) 命名化 loud 拒绝」口径。E（optional 剥壳）与
  F（联合 kind 同形裁决）两块与 R3 定稿一致**零改动**，其余断言零改动。亲跑
  （见 .mabf-bg/sa6-r5-fix.log）：**D 块失败模式 = 「未抛出预期错误」类红灯**——
  `AssertionError: expected [Function] to throw an error`（008e34c 实现尚无 ROOT 引用拦截、
  generateProjection 不抛）；`Test Files 1 failed (1)`、`Tests 1 failed | 8 passed (9)`、
  exit 1；**F 块（同形 + 异形）与 C 块及既有断言全绿**（如实记录）。
