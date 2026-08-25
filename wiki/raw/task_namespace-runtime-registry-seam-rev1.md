# 修订任务简报（Round 2）— namespace-runtime Registry seam 边界审计强化 + 白名单收窄（issue #109）

- **Issue**: #109（welltop-jim-wang/nomicore）
- **Round**: 2（review 后修订轮；Round 1 PR #116 已 ci-passed）
- **run_id**: issue-109-1787654016-3408414
- **Branch**: fix/issue-109-on-docs-namespace-registry（base: docs/namespace-registry）
- **Worktree**: /home/wangjian/nomicore-fix-issue-109
- **任务类型**: 功能开发修订轮（测试加固：边界门禁强化，无生产 src 语义变更预期）
- **Round 1 基线**: HEAD = 0a4d460；任务简报 `wiki/raw/task_namespace-runtime-registry-seam.md`；AC checklist `task_namespace-runtime-registry-seam_ac_checklist.md`

## 评审反馈（原文，逐条处理基准）

### 反馈 1【阻塞】模块边界审计存在绕过路径

`packages/namespace-runtime/test/runtime-registry-internal-seam.test.ts` 当前只匹配 `from '…'` 与字面量 `import('…')`，并且只扫描 `.ts/.tsx/.mts/.cts`。以下合法消费方式会漏检：

- 副作用导入：`import '@nomicore/namespace-runtime/internal'`
- 再导出：`export … from '@nomicore/namespace-runtime/internal'`
- `require()` / `import = require()`
- `.js/.jsx/.mjs/.cjs` 生产文件

这意味着非 Registry 生产代码可以消费 internal subpath 而测试仍通过，不满足 AC5「模块边界测试证明仅 NamespaceRegistry 生产代码可消费 internal subpath」及 ADR 0009 第 18 行。

**修订要求**：优先使用 AST 或仓库依赖图做审计；若继续文本扫描，必须覆盖全部导入/再导出语法和生产代码扩展名，并增加违规 fixture/探针，证明每种绕过方式都会使门禁变红。

### 反馈 2【中优先级】Registry 生产代码白名单过宽

当前白名单无条件允许整个 `packages/namespace-registry/src/`，会把未来的 `src/testing/`、`src/__tests__/`、fixture 等非生产代码也视为合法消费者。

**修订要求**：明确生产代码边界，排除 testing/test/__tests__/fixtures 等目录，或收窄到允许消费该 subpath 的具体 Registry 生产模块；同时添加正反例测试。

### 非阻塞建议（本轮可选）

两个新增动态测试文件（`runtime-registry-internal-seam.test.ts` 与 `runtime-registry-internal-sa7-dynamic.test.ts`）重复了 Y.Doc/Persistence/factory loader/cleanup fixture，可后续提取共享 helper。**本轮可选**，不做不阻断。

## 验收条件（修订轮 AC）

- **RAC1**：反馈 1 列举的全部绕过形式（副作用导入 / 再导出 / `require()` / `import = require()` / `.js/.jsx/.mjs/.cjs` 生产文件承载的任意消费形态）均被边界门禁捕获——每种形式都有探针测试证明「存在该消费 → 审计判违规」；
- **RAC2**：只有明确的 NamespaceRegistry 生产模块可消费 internal subpath——白名单排除 testing/test/__tests__/fixtures 等非生产目录，正反例测试齐备；
- **RAC3**：全量 `pnpm test`（vitest run --typecheck）+ `pnpm typecheck`（7 包 tsc）+ 聚合 `pnpm exec tsc -p tsconfig.typecheck.json --noEmit` 全绿；Node 20/24 CI 继续通过（发布归 Host）。

## 现状事实（总控核实，2026-08-25，HEAD=0a4d460）

- 被修订文件：`packages/namespace-runtime/test/runtime-registry-internal-seam.test.ts` 的 AC5 describe 块（316–395 行）：
  - `importRe` 只匹配 `from '<specifier>'` 与 `import('<specifier>')` 两种形态；
  - walk 只收 `.ts/.tsx/.mts/.cts`（且排 `.d.ts`）；
  - 白名单谓词 `isWhitelistedConsumer` = `p.startsWith('packages/namespace-registry/src/')`，无目录排除；
  - 既有三 it：防空扫（prodFiles>0）、白名单谓词自检（allow/deny 各例）、消费方 ⊆ 白名单。
- Registry 包（`@nomicore/namespace-registry`）**尚未存在**（Phase 4 切片 5/6 才落地）——白名单必须保持前瞻，但「生产代码边界」现在就要定义清楚。
- `typescript@^5.9.3` 是 `@nomicore/namespace-runtime` 的 devDependency → TS compiler API（`ts.createSourceFile` AST 遍历）在测试内可直接使用，**零新依赖**；AST 方案天然覆盖：ImportDeclaration（含副作用导入）、ExportDeclaration moduleSpecifier（再导出）、`require(...)` CallExpression、ImportEqualsDeclaration（`import = require()`）、动态 `import(...)`，且不受注释/字符串字面量误报干扰。
- 仓内 `packages/`、`domains/`、`apps/` 当前**无** `.js/.jsx/.mjs/.cjs` 生产文件 → 扩展名覆盖是前瞻门禁，其价值必须由探针 fixture 证明。
- 审计 walk 跳过名为 `test/tests/__tests__/docs/wiki/node_modules/.git/.mabf-bg/dist/coverage` 的目录 → 违规 fixture 放在 `packages/namespace-runtime/test/` 下即可与真实全仓扫描天然隔离（不会被真实门禁误判）。
- test 目录下非 `*.test.ts` 的 helper 是既有惯例（`persistence/test/memory-testkit.ts`、`vfsl-codegen/test/tsc-helper.ts`）；vitest 只拾取 `*.test.*`/`*.spec.*`，helper 不会被当测试跑。
- 根测试命令：`pnpm test`（vitest run --typecheck，覆盖 `packages/*/test/**` 与 `domains/*/test/**`，含 `*.test-d.ts`）；`pnpm typecheck` 逐包 tsc；聚合 `pnpm exec tsc -p tsconfig.typecheck.json --noEmit`。

## 设计方向约束（评审偏好 + 总控裁定）

1. **AST 优先**（评审原文「优先使用 AST 或仓库依赖图」）：用 TS compiler API 做消费形态识别，不再叠加正则。审计逻辑抽成 test 下可复用 helper（如 `test/helpers/`），真实全仓审计与探针共用同一份实现——探针针对该 helper 的小根目录/fixture 树断言，证明每种绕过形态都会被判违规。
2. **探针设计纪律**：每种反馈 1 列举的绕过形态至少一个违规 fixture（含 `.js/.cjs/.mjs` 载体），另设正例（白名单内 Registry 生产模块的消费）与负例（非 Registry 消费 → 判违规）控制组。fixture 必须位于真实扫描跳过的目录（`test/` 下）。
3. **白名单收窄**：保持 `packages/namespace-registry/src/` 前缀前瞻放行，但排除路径段命中 test/testing/__tests__/fixtures/mock 等非生产目录及 `*.test.*`/`*.spec.*` 文件名的文件；正反例测试锚定该谓词。具体目录名清单由 SA1 设计定稿（须覆盖反馈点名的 testing/test/__tests__/fixtures）。
4. **ADR 一致性**：ADR 0009 第 18 行「模块边界测试限制该 internal subpath 只能由 Registry 生产代码消费」是裁决基准；Registry 的 testing subpath（ADR 0009 §公共 Interface「测试 seam 只位于受控 testing subpath」）属非生产代码，不在白名单内。
5. **不改动生产语义**：`src/` 零改动预期；若实现中发现必须动 src，立即停止并回禀总控。
6. **版本纪律**：修改 `packages/namespace-runtime`（含 test）→ `package.json` patch bump（0.1.6 → 0.1.7，硬门禁 #9）。
7. **存量断言零破坏**：AC1–AC4/AC6 既有锚点（导出面、注入面零效果、P0/FIFO/close 全链、type-guard）不得被本轮改动破坏；`runtime-acceptance-exports-audit.test.ts` 等存量验收不动。
8. **wiki 纪律**：全部产出落 `wiki/raw/task_namespace-runtime-registry-seam-rev1_*.md` 并随代码 commit；`.mabf-bg/**` 不入仓。

## AC → 修订锚点映射（SA6 红灯锚定基准）

| RAC | 锚点 | 形态 |
|---|---|---|
| RAC1 | 审计 helper 对 fixture 树逐形态探针：side-effect import / re-export / require() / import = require() / dynamic import() / .js/.jsx/.mjs/.cjs 载体 → 全部判违规；真实全仓审计仍绿（当前仓内无非白名单消费方）+ 防空扫断言保留 | 探针 it × N + 真实门禁 it |
| RAC2 | 白名单谓词正反例：`src/registry.ts`、`src/<生产子目录>/*.ts` 放行；`src/testing/**`、`src/__tests__/**`、`src/**/fixtures/**`、`*.test.ts`、`*.spec.ts` 拒绝；非 Registry 路径拒绝 | 谓词 it（allow/deny 矩阵） |
| RAC3 | 全量 pnpm test + pnpm typecheck + 聚合 tsc 全绿 | 总控亲验 |

## SA6 红灯锚定记录（2026-08-25，Phase 1）

### 产出文件（均随代码 commit）

| 文件 | 角色 |
|---|---|
| `packages/namespace-runtime/test/runtime-registry-internal-seam-rev1.test.ts` | RAC1/RAC2 红灯契约（19 it：9 探针/控制组 + 防空扫(探针侧) + 3 RAC2 集成 + 4 谓词矩阵 + 2 真实门禁） |
| `packages/namespace-runtime/test/fixtures/registry-seam-audit-rev1/{repo,bypass}/…` | 探针 fixture 树（17 文件；位于 test/ 跳过域；不持有 package.json，避免污染包内自引用解析） |

### helper 契约（探针锚定对象；SA1 设计以此为基，SA3 实现）

路径：`packages/namespace-runtime/test/helpers/registry-seam-audit.ts`（简报设计方向约束 1「如 test/helpers/」）。

```ts
interface RegistrySeamAuditResult { prodFiles: number; importers: string[]; violators: string[] }
function auditInternalSubpathImporters(roots?: readonly string[]): RegistrySeamAuditResult;
function isWhitelistedConsumer(relPath: string): boolean;
```

- roots 缺省 = **单根仓根 REPO_ROOT + walk 顶层目录白名单 {packages, domains, apps}**（R1 方案 A：其余顶层条目在扫描根层剪枝；无 existsSync 过滤——缺席顶层名天然不出现在 readdir 结果）；`importers` 仍为相对**各自扫描根**的 POSIX 路径——默认门禁下 `packages/**` 文件 relPath 带 `packages/` 顶层段、谓词前缀可达，与 fixture `repo/` 根下同路径文件**逐字符同构**（fixture 探针根 = 显式 roots `repo/`、`bypass/`：不做顶层目录白名单过滤、不做存在性过滤、路径错写即响亮失败）。
- 扩展名集合：`.ts/.tsx/.mts/.cts/.js/.jsx/.mjs/.cjs`（排 `.d.ts`）；目录跳过（**条件化，R1 同步**）：node_modules/.git/.mabf-bg/dist/coverage/docs/wiki 无条件剪枝；**test/tests/__tests__ 仅在 src 子树外剪枝**——包级 `test` 树整树跳过（= fixture 隔离），src 子树内照常扫描 + 谓词 deny 兜底（fail-closed）；文件跳过：package.json、README.md。

> **R1 同步（SA2 放行前置项，RN4）**：上两行契约文本已按 R1 设计（`task_namespace-runtime-registry-seam-rev1_design.md` §D-D，方案 A + 条件化剪枝）同步；**行为契约不变**——扫描面今日逐文件等价（69 文件不变）、relPath 仍相对各自扫描根、19 it 测试文件与 fixture 树零变化、红灯语义保持「helper 缺席」。
- 消费形态识别（禁止只匹配 `from '…'`/`import('…')` 文本）：ImportDeclaration（含无绑定副作用导入）、ExportDeclaration moduleSpecifier（再导出）、CallExpression `require('…')`、ImportEqualsDeclaration（`import = require`）、CallExpression `import('…')`（动态）。
- `violators = importers.filter(p => !isWhitelistedConsumer(p))`；`isWhitelistedConsumer` = 前缀 `packages/namespace-registry/src/` 且路径段不含 {testing, test, __tests__, fixtures, mock}（下界，SA1 只可扩充）+ 文件名不含 `.test.`/`.spec.`。

### 红灯证据（真实运行）

```
$ pnpm exec vitest run packages/namespace-runtime/test/runtime-registry-internal-seam-rev1.test.ts
Test Files  1 failed (1)  /  Tests  no tests
Error: Cannot find module './helpers/registry-seam-audit' imported from
  …/runtime-registry-internal-seam-rev1.test.ts … Does the file exist?
（exit 1）
```

红灯语义 = 探针目标缺席（共享审计 helper 尚不存在，当前审计仍是既有 seam 测试内嵌的弱正则/弱白名单实现）。

### 绿灯可满足性验证（temporary，已清除）

临时参考实现（AST + 白名单收窄谓词，与契约逐条一致）挂载到契约路径后：

```
$ pnpm exec vitest run packages/namespace-runtime/test/runtime-registry-internal-seam-rev1.test.ts
Test Files  1 passed (1)  /  Tests  19 passed (19)  /  Type Errors  no errors
```

即契约可满足：fixture 路径/relPath 基准/矩阵断言全部正确，真实全仓门禁在正确实现下保持绿（violators 空 + prodFiles>0）。验证后临时实现已删除，repo 恢复「helper 缺席」原始红灯状态。

### 聚合 typecheck 现状（红 = 仅预期锚点）

```
$ pnpm exec tsc -p tsconfig.typecheck.json --noEmit
…/runtime-registry-internal-seam-rev1.test.ts(52,8): error TS2307: Cannot find module './helpers/registry-seam-audit'
…/runtime-registry-internal-seam-rev1.test.ts(53,46): error TS2307: Cannot find module './helpers/registry-seam-audit'
```

仅上述 2 条 TS2307（= 探针目标缺席）；全部 fixture `.ts` 在此命令下类型清洁（`src/internal` 命名导入经包内自引用解析通过；`**/*.ts` glob 不拾取 `.tsx/.mts/.cts/.js/.jsx/.mjs/.cjs` fixture，vitest 只拾取 `*.test.ts`，因此 `registry.test.tsx`/`registry.spec.tsx` 不会被当作测试收集）。

### SA3 落地清单（红→绿义务）

1. 按上文 helper 契约在 `packages/namespace-runtime/test/helpers/registry-seam-audit.ts` 实现（AST 优先；仅用既有 devDependency typescript@^5.9.3，零新依赖）。
2. 迁移/删除既有 `runtime-registry-internal-seam.test.ts` AC5 describe 块（316–395 行）——弱正则审计不得残留；该文件其余 AC1/AC2/AC4/AC6 锚点（8 it，基线绿灯）不得破坏。
3. 版本纪律：本包（含 test）已改 → `package.json` patch bump 0.1.6 → 0.1.7（硬门禁 #9；SA6 不代改 package.json，由实现轮执行）。
4. 实现后 RAC1 真实门禁必须保持绿；若变红 = 真实仓内存在弱审计漏检形态的真实消费方（如 `require()` 或 `.js` 载体）——先回禀总控，不得以放宽审计绕过（约束 5：src 零改动）。
5. 白名单下界不可缩：{testing, test, __tests__, fixtures, mock} + `.test.`/`.spec.` 文件名（冲突报告注 1 单向边界）；SA1 只可扩充。
