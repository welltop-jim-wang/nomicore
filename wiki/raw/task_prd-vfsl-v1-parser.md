# Task Brief — [PRD] VFSL v1 方言定义与 Parser

- **Worktree 绝对路径**: /home/wangjian/nomicore-refactor-prd-vfsl-v1--parser
- **Branch**: refactor/prd-vfsl-v1--parser
- **任务类型**: 功能开发 (Feature) — 全新 `@nomicore/vfsl` parser 包，greenfield
- **Slug**: prd-vfsl-v1-parser
- **Issue**: #3
- **说明**: 仓库为 greenfield（仅 LICENSE/.gitignore/TASK.md）。无 CONTEXT.md、无 docs/adr、无 design 文档、无 packages/、无 test-lock.sh。TASK.md 是唯一真相源，已包含完整 v1 方言冻结规范。SA 需自建项目骨架（pnpm workspace / packages/vfsl / vitest / tsconfig / scripts/test-lock.sh）。
- **公共测试接缝（契约，不可改）**: `parseVfsl(text)` → `{ ok: true, module }` 或 `{ ok: false, issues: [{ message, line, column }] }`。模块 `@nomicore/vfsl` 位于 `packages/vfsl`，零运行时依赖。
- **run_id**: issue-3-1787047199-2395
- **恢复说明 (2026-08-18)**: 前一回合 SA6 已完成红灯测试骨架与 4 个测试套件并通过红灯验证（4 suite 全因 `@nomicore/vfsl` 公共接缝缺失而 fail，exit 1），但因 supervisor 中断、worktree 被回收且 SA6 未 commit，全部产物丢失。本回合从 Phase 1 重新派发 SA6。SA6 应避免重复踩 esbuild 坑：vitest 自带 esbuild 依赖，无需 `pnpm exec esbuild`；不要在 pnpm-workspace.yaml 写非标准 `allowBuilds` 字段。

---

# MABF Task: [PRD] VFSL v1 方言定义与 Parser

## Issue #3

## Problem Statement

设计文档《yjs-server Namespace Schema 自描述体系》的解药是一段 VFSL 文本作为 schema 的单一真相源——但今天这段文本无法被机器解释：方言 v1 只存在于散文里，没有可执行的语法定义，也没有任何代码能把 `__schema__` 信封里的文本变成机器可处理的结构。nomicore 作为全新重写的 yjs-server（ADR-0002），其引擎的第一块基石就是 parser：文本不可解释，后续的求值器、路径索引、`validateSnapshot` 与服务端全部无从谈起。

## Solution

交付 `@nomicore/vfsl` 的 parser：输入一段 VFSL 文本（按本 spec 冻结的 v1 方言子集书写），输出可序列化的 IR，或精确到行列的结构化错误。v1 方言随本 spec 一并冻结——语法子集、六个标记类型（大小写是契约）、禁止清单、禁递归、JSDoc 原文捕获。方言一经发布只增不改；对历史文本的解释永远以文本自述的方言版本为准。

## User Stories

1. 作为 schema 作者，我想用熟悉的 TypeScript 语法（类型别名、对象字面量、联合）书写 schema，这样零学习成本。
2. 作为 schema 作者，我想用 `YMap` / `YArray` / `YPlainArray` / `YLeaf` / `YXmlFragment` 标记 Yjs 物化语义，这样结构与值语义正交表达、互不污染。
3. 作为 schema 作者，我想用 `string & Pattern<"正则">` 表达字符串与键约束，这样旧体系里硬编码在 handler 的 name 禁 `.` / `|` 检查消失。
4. 作为 schema 作者，我想用字面量联合表达枚举与判别字段，这样 "profile 按 kind 判别" 成为内建能力而不是摊平妥协。
5. 作为 schema 作者，我想在 `/** */` 里写自由语义描述与 `@tag`，这样语义随 schema 文本走、校验错误信息将来可以回带语义。
6. 作为 schema 作者，我写了越界语法（`any`、自定义泛型、条件类型等）时想得到精确到行列的错误，这样能立即定位修复，而不是面对"差不多"的猜测。
7. 作为 schema 作者，我写出循环引用的类型别名时想被明确拒绝，这样我确信文档结构是非递归的。
8. 作为引擎开发者，我想消费稳定的 IR（`/** */` 原文已挂载到相应节点），这样求值器、路径索引、`validateSnapshot` 可以在纯数据上独立开发。
9. 作为引擎开发者，我想 parse 是纯函数（无副作用、确定性），这样编译产物可以按内容哈希缓存。
10. 作为服务端开发者（Phase 2），我想在创建 namespace 时调用 parser 拒绝不合法的 schema 文本，这样"schema + 初始 data 校验通过才建"的创建契约有第一道防线。
11. 作为 AI 消费者，我想从 IR 拿到字段的语义描述原文，这样我能解释数据而不是猜。
12. 作为引擎开发者，我想未识别的 `@tag` 只产生 warn 不失败，这样语义层词汇可以自由演进而不破坏解析。
13. 作为引擎开发者，我想 v1 方言冻结后引擎只增不改，这样一年前的旧 doc 永远可以用今天的代码解释。

## Implementation Decisions

- 模块：`@nomicore/vfsl`（`packages/vfsl`），零运行时依赖——不依赖 yjs、网络、存储。
- 唯一公共测试接缝：`parseVfsl(text)` → `{ ok: true, module }` 或 `{ ok: false, issues: [{ message, line, column }] }`。tokenizer 与 AST 内部形状不构成公共契约。
- v1 语法子集（冻结）：类型别名；封闭对象字面量类型（未声明字段拒绝的语义基础）；`?:` 可选属性；原始类型 `string` / `number` / `boolean` / `null` / `unknown`；字面量联合；`T[]`；`Record<K, V>`；`string & Pattern<"正则">`（唯一允许的交叉类型）；注释。
- 标记类型六个，大小写是契约：`YMap`、`YArray`、`YPlainArray`、`YLeaf`、`YXmlFragment`、`Pattern`。
- 注释处理：`//` 与 `/* */` 忽略；`/** */` 原文捕获并挂载到相邻 IR 节点（类型别名 / 属性 / 标记类型处）。标签的结构化解析延后到语义层任务——本方言无机器标签，全部文档性质（ADR-0001）。
- 禁止清单（越界即错误）：`any`、自定义泛型、条件类型、mapped type、interface 继承、递归 / 循环引用的类型别名（别名引用图成环 → 错误）。
- IR 必须可序列化、可哈希（编译缓存的前提）；具体形状由实现自定，通过公共接缝观察。
- 信封形状属于 v1 定义的一部分（`{ lang: "vfsl", version: 1, id, text }`），但 parser 只消费 `text`；信封解析与方言路由（未知方言只读）是后续引擎任务。
- 本仓库是纯引擎仓库：代码库不含 schema 文本，测试 fixture 除外（ADR-0001）。

## Testing Decisions

- 只测外部行为：全部测试经由 `parseVfsl` 公共入口断言输入→输出；不测 tokenizer / 内部 AST 的实现细节。
- 正例 fixture：设计文档 §4 的 `vfs3.assets` 文本全量解析为 IR。
- 覆盖矩阵：v1 每个语法特性至少一正一负；禁止清单逐项负例，断言结构化错误含行列信息。
- 环检测负例：自引用与互引用环都要拒绝。
- JSDoc 用例：`/** */` 原文挂载到正确的节点。
- 先例：仓库暂无测试基线，本任务以 vitest 建立。

## Out of Scope

- 求值器（结构树 / 值 schema 派生）、路径索引、`validateSnapshot`、编译缓存
- 信封解析与方言路由（未知方言 loud-fail 只读）
- JSDoc 标签的结构化解析（语义层任务；本方言无机器标签）
- yjs-server 服务端：WS / REST、存储、同步协议、namespace 生命周期与创建事务
- authority / 不变式体系（ADR-0002 完全出范围）
- 编译期类型投影（已随 `vfsl-protocol` 移除，ADR-0001）
- schema 升级 / 迁移（Phase 3，仅记路线）
- 开放问题（不阻塞本任务，Phase 2 前必须关闭）：写入强制等级（服务器唯一写入者 vs 允许原始 update）；API 面划分（REST 管理面 + WS 数据面 vs 全 WS）

## Further Notes

- 路线图：parser（本 spec）→ 求值器 → 路径索引 → `validateSnapshot` →（Phase 2）schema 数据面服务端 →（Phase 3）数据化与迁移 →（Phase 4）AI 友好层。
- 术语以仓库 `CONTEXT.md` 为准；架构决策见 `docs/adr/0001`（单一真相源、纯引擎仓库）、`docs/adr/0002`（全新重写、authority 出范围）。

## Referenced Documents



## Working Directory

/home/wangjian/nomicore-refactor-prd-vfsl-v1--parser

## Review Feedback (from closed PRs)


## Issue Comments (decisions & context)


## Branch

refactor/prd-vfsl-v1--parser

---

# SA6 红灯测试记录（2026-08-18 R2）

## 一、骨架布局（greenfield 自建）

```
package.json                根 workspace（scripts.test = pnpm --filter @nomicore/vfsl exec vitest run）
pnpm-workspace.yaml         packages: [packages/*] + allowBuilds.esbuild: true（pnpm 11.1 原生机制）
tsconfig.json               根 TS 基础配置
scripts/test-lock.sh        测试策略锁：vitest / node 环境 / 无端口 / 无外部服务
packages/vfsl/
  package.json              @nomicore/vfsl，exports→dist，devDeps: typescript/vitest + workspace:* 自引用
  tsconfig.json             extends 根配置，outDir=dist
  vitest.config.ts          单包测试配置（include: test/**/*.test.ts，environment: node）
  src/index.ts              SA6 占位：不导出任何公共 API（parseVfsl 属 SA3）
  test/helpers.ts           形状无关 IR 观察工具（collectNodes/nodeByName/collectStrings/expectIssueShape）
  test/fixtures/vfs3-assets.vfsl   设计文档 §4 正例 fixture（原文不在仓库，按冻结 v1 方言重构）
```

## 二、测试设计（4 套件，全部经 parseVfsl 公共入口断言输入→输出）

| 套件 | 文件 | 覆盖 |
|---|---|---|
| 1 正例矩阵 | parse-vfsl.happy-path.test.ts | 接缝存在；类型别名；封闭对象字面量+五种原始类型；?: 可选；字面量联合；T[]；Record<K,V>；string & Pattern；// 与 /* */ 注释忽略；六标记类型 YMap/YArray/YPlainArray/YLeaf/YXmlFragment/Pattern（大小写是契约）；vfs3.assets fixture 全量解析；IR 可 JSON 序列化往返；纯函数确定性 |
| 2 禁止清单 | parse-vfsl.forbidden.test.ts | any（含行号精确断言：前置注释后 any 在第 3 行）；自定义泛型；条件类型；mapped type；interface 继承；非 Pattern 交叉 string & number；Pattern<123>；Record<string> 少参；小写 ymap（大小写契约）；索引签名（封闭对象负例）；symbol（原始类型负例）；元组 [string]（T[] 负例）；未闭合 /* 注释 |
| 3 环检测 | parse-vfsl.cycle-detection.test.ts | 自引用 type A = A；经对象字段自递归；互引用环 A↔B；经对象字段互引用环；无环前向引用合法（防过度拒绝） |
| 4 JSDoc | parse-vfsl.jsdoc.test.ts | /** */ 原文挂别名节点；挂属性节点；挂标记类型属性节点；/* */ 与 // 内容不得进入 IR；相邻节点不错位（文档一↔A、文档二↔B 互不串挂） |

断言原则：IR 具体形状由 SA3 自定，测试用形状无关 helper 锚定语义事实（别名/字段/类型/字面量/正则/文档出现在正确子树）；负例统一断言 `{ ok:false, issues:[{message,line,column}] }`，message 非空、line/column 为源文本行内合法整数。

## 三、红灯验证（真实失败证据）

命令（cwd=worktree 根）：
```bash
pnpm install
pnpm --filter @nomicore/vfsl exec vitest run
```

结果：**4 套件全因 @nomicore/vfsl 公共接缝缺失而 fail，exit 1**。

```
⎯⎯⎯⎯⎯⎯ Failed Suites 4 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  test/parse-vfsl.cycle-detection.test.ts
 FAIL  test/parse-vfsl.forbidden.test.ts
 FAIL  test/parse-vfsl.jsdoc.test.ts
Error: Failed to resolve entry for package "@nomicore/vfsl". The package may have incorrect main/module/exports specified in its package.json.
  Plugin: vite:import-analysis
  File: .../packages/vfsl/test/parse-vfsl.cycle-detection.test.ts:8:26
  2  |  import { readFileSync } from "node:fs";
     |  import { parseVfsl } from "@nomicore/vfsl";
     |                             ^
 FAIL  test/parse-vfsl.happy-path.test.ts
Error: Failed to resolve entry for package "@nomicore/vfsl". ...（同上）

 Test Files  4 failed (4)
      Tests  no tests
   Duration  352ms
[ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL] Command failed with exit code 1: vitest run
```

红因锚定：`src/index.ts` 占位不导出 parseVfsl，包入口 dist 不存在 → 4 套件全部在 import 阶段失败，缺口被精确锚定。测试文件自身 transform 成功、无语法错误，非伪红。

## 四、备注（给后续 SA）

- **pnpm 11.1.3 机制变化**：package.json 的 `pnpm.onlyBuiltDependencies` 已被忽略（WARN）；esbuild postinstall 用 pnpm-workspace.yaml 的 `allowBuilds: { esbuild: true }`（pnpm 11.1 原生字段，install 时自动生成模板）解决。不要再写 package.json pnpm 字段。
- **workspace 自引用**：根无依赖 @nomicore/vfsl 时 pnpm 11 不生成根 symlink；包内 devDeps 加 `"@nomicore/vfsl": "workspace:*"` 使测试能以包名 import。
- **vitest 配置位置**：放 packages/vfsl/vitest.config.ts（cwd=包目录时 include 相对包目录生效）；根配置会导致 include 相对 cwd 解析失效（"No test files found" 伪失败，已排除）。
- **vfs3.assets fixture**：设计文档 §4 原文不在本仓库，fixture 为依据冻结 v1 方言与简报描述的重构，含全部六标记 + Pattern 键约束 + 字面量判别 + 可选字段 + JSDoc。
- 实现（SA3）落地 parseVfsl 后需 `pnpm --filter @nomicore/vfsl run build`（tsc → dist）或以其他方式使 exports 可解析，测试方转绿。
