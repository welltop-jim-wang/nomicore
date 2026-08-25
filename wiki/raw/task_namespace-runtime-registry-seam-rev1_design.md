# 设计文档 — namespace-runtime Registry seam 边界审计强化 + 白名单收窄（issue #109 Round 2 修订轮，R1 修订版）

- **任务类型**：功能开发修订轮（测试加固）——共享审计 helper 落地 + 既有 AC5 弱审计迁移删除 + 白名单收窄；**零生产 `src/` 语义变更**（简报设计方向约束 5）
- **Worktree**：`/home/wangjian/nomicore-fix-issue-109`（Branch `fix/issue-109-on-docs-namespace-registry`，Round 1 PR #116 已 ci-passed，HEAD=0a4d460）
- **修订历史**：R0 初版（2026-08-25）→ **R1**（2026-08-25，按 SA2 R0 攻击评审 verdict: reject 修订——报告 `wiki/raw/task_namespace-runtime-registry-seam-rev1_sa2_review.md`，必修项 #1 CRITICAL / #2 HIGH / #3 HIGH / #5 MEDIUM 全部落实，见文末「SA2 反馈逐条回应」）。**R1 修订只改本设计文档：19 it 与 fixture 树零变化，红灯语义保持「helper 缺席」（SA2 结语确认）。**
- **设计输入**：
  - 修订简报 `wiki/raw/task_namespace-runtime-registry-seam-rev1.md`（评审反馈 1【阻塞】/反馈 2【中】+ RAC1–RAC3 + §SA6 红灯锚定记录 = helper 契约与 19 it）；
  - SA8 相关决议 `wiki/raw/task_namespace-runtime-registry-seam_relevant_decisions.md`（ADR 约束基准 + Round 1 设计后复审 N1–N8）；
  - SA8 冲突报告 `wiki/raw/task_namespace-runtime-registry-seam-rev1_conflict_report.md`（verdict: `clear`；注 1「白名单收窄的单向边界：下界 {testing, test, __tests__, fixtures, mock} + `.test.`/`.spec.` 文件名，SA1 只可扩充」）；
  - **SA2 R0 攻击评审报告 `…_rev1_sa2_review.md`（verdict: reject；攻击点 #1 CRITICAL relPath 基准错配 / #2 HIGH src 子树扫描面盲区 / #3 HIGH E1 无锚定 / #4 E2 裁决保留 / #5 P7 缺口 / #6 #7 非阻塞）**；
  - SA6 红灯资产：`packages/namespace-runtime/test/runtime-registry-internal-seam-rev1.test.ts`（19 it，未暂存已在盘）+ `test/fixtures/registry-seam-audit-rev1/{repo,bypass}/…`（磁盘实测 19 文件，简报记 17——以磁盘为准，见 §1 F9）。
- **ADR 约束基准（冻结，不得改写）**：ADR 0009 §模块与 Cordis service 第 18 行「Registry 通过 `@nomicore/namespace-runtime/internal` 唯一导出的 `createNamespaceRuntimeForRegistry` 构造生产 Runtime；主 entry 不公开生产 Runtime 构造器。**模块边界测试限制该 internal subpath 只能由 Registry 生产代码消费**」——首句授权的生产构造通道必须在门禁下**可达**（R1 §D-D 方案 A 的裁决依据，SA2 #1）；§公共 Interface「测试 seam 只位于受控 testing subpath」→ testing 载体属非生产代码，不在白名单（冲突报告张力 2 裁定）。ADR 0008 全部 Runtime 语义与公共面经「src 零改动」结构性保持（冲突报告 ADR 0008 行）。

---

## §1. 现状核对（设计期实测，2026-08-25，worktree HEAD 0a4d460；F5/F14–F16 为 R1 新增/重编）

| # | 事实 | 核对方式 |
|---|---|---|
| F1 | 共享审计 helper `test/helpers/registry-seam-audit.ts` **缺席**：rev1 测试对其 import 在 vitest 运行时（`Cannot find module './helpers/registry-seam-audit'`，exit 1）与聚合 tsc（`TS2307` ×2，行 52/53）双通道红——探针目标缺席 = 本轮红灯语义（R1 保持不变） | read 简报 §SA6 锚定记录 + read rev1 测试 L49–53 |
| F2 | 既有 `runtime-registry-internal-seam.test.ts` 全文件恰 **8 it**：AC1/AC6 ×3（L102/117/125）、AC2 ×1（L145）、AC4 ×1（L194）、**AC5 ×3（L374/379/388，describe 块 L316–395）**。简报「其余锚点（8 it）」按磁盘实测应理解为**全文件 8 it 基线**：AC5 占 3，删除后余 **5 it 必须保持绿** | `grep -n "describe(\|  it(" 该文件 |
| F3 | AC5 块外的 fs/path/url 符号使用**仅** `readFileSync`（L106，读 package.json）；`existsSync/readdirSync/statSync/path.*/fileURLToPath` 全部只出现在 AC5 块内（L317/354–369）→ 删除块后 L32–34 import 必须收窄（tsc 未开 noUnusedLocals，不收窄不报错，但按最小残留纪律收窄） | `grep -n` 全文件符号使用（见 §3 D-E 精确 diff） |
| F4 | 旧 AC5 审计的弱点（= 评审反馈 1 的事实基础）：`importRe` 只匹配 `from '<specifier>'` 与 `import('<specifier>')` 两形态；扩展名仅 `.ts/.tsx/.mts/.cts`；白名单 `startsWith('packages/namespace-registry/src/')` 无任何目录/文件名排除 | read 该文件 L322–372 |
| F5 | **旧 AC5 的 relPath 基准与谓词前缀是对齐的**（Round 1 已正确的行为，R0 曾静默回退，R1 恢复并保持）：L317 `REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))`（= 仓根）+ L363 `path.relative(REPO_ROOT, full)`——walk 从三目录起扫（L367–370 `existsSync` 过滤）但 relPath 相对**仓根**，未来 Registry 生产消费方 relPath 带 `packages/` 顶层段，谓词前缀可达 | read L317/363/367–370 + SA2 评审实测基线（L317/370 校对） |
| F6 | 生产扫描域（packages/domains/apps，剔除 test/tests/__tests__/docs/wiki/node_modules/.git/.mabf-bg/dist/coverage + package.json/README.md）实测 **69 文件、全部 `.ts`**——`.js/.jsx/.mjs/.cjs` 生产文件为零 → 扩展名前瞻覆盖的价值由 fixture 探针兑现（RAC1），不依赖仓内存量 | `find packages domains apps … \| sed 's/.*\.//' \| sort \| uniq -c` → `69 ts` |
| F7 | 生产树对 `@nomicore/namespace-runtime/internal` 的消费面 = **零**：全仓 grep 仅命中 `README.md:9`（.md 非审计扩展名 + SKIP_FILES 双重不可达）与 `src/internal.ts:2` 的 **JSDoc 注释**（AST 天然不采注释；且该文件不 import 该 specifier）→ helper 落地后真实全仓门禁（violators 空）保持绿 | `git grep -n "namespace-runtime/internal" -- packages domains apps \| grep -v /test/` |
| F8 | 生产树 `.ts` 中 `require(` 调用 = **零**；`.require(` 属性访问形态亦零命中（SA2 `git grep -nE "\.\s*require\s*\("` 复核）→ require 形态识别不会使现存文件意外变红，属性访问 require 今日零暴露（R1 入残差，见 §D-B） | `git grep -n "require(" -- 'packages/*/src' 'domains/*/*.ts' 'apps'` |
| F9 | fixture 树磁盘实测 **19 文件**（简报记 17，属简报笔误，以磁盘为准）：`bypass/` 11（8 绕过形态载体 + 3 控制组）、`repo/` 8（Registry 生产正例 ×2、非生产反例 ×5、非 Registry 负例 ×1）；根目录名 `repo`/`bypass` 不命中任何剪枝段；树内无 package.json；**树内无 test/tests/__tests__ 目录**（条件化剪枝对 fixture 行为零影响）。fixture 位于 `packages/namespace-runtime/test/fixtures/…` → 真实全仓扫描 walk 到包级 `test` 目录名即整目录跳过，天然隔离 | `find …/fixtures/registry-seam-audit-rev1 -type f \| sort` + 逐文件 read |
| F10 | `packages/namespace-runtime/package.json` 现状：version `0.1.6`，exports 恰 `['.', './internal']`（Round 1 已落地），devDependencies 含 `typescript@^5.9.3`、`@types/node@^20` → 本轮该文件**唯一**改动是 version patch bump 0.1.6 → 0.1.7 | read 该文件 |
| F11 | TS compiler API 在仓内测试域有**两个现行绿先例**：`packages/vfsl-codegen/test/tsc-helper.ts`（`createRequire` 装载 + `typeof import('typescript')` 定型）与 `domains/vfs3-assets/test/vfs3-assets-tsdoc.test.ts:34`（**直接 `import ts from 'typescript'`**，经聚合 tsc + vitest 双通道现行绿）→ helper 采用后者的直接 import 形态，同一 tsconfig 链（tsconfig.typecheck.json extends tsconfig.base.json）已验证可编译可运行 | read 两文件 + SA6 锚定记录「聚合 typecheck 现状仅 2 条 TS2307」证明该链路现行绿 |
| F12 | 门禁链路 glob 覆盖：vitest include `packages/*/test/**/*.test.ts`（helper 非 `*.test.ts` 不被当测试跑；`registry.test.tsx`/`registry.spec.tsx` fixture 亦不被拾取——include 不含 `.tsx`）；聚合 tsc include `packages/*/test/**/*.ts` 覆盖 helper（.ts）与 fixture .ts（SA6 记录的 2 条 TS2307 恰证明覆盖），`*.ts` glob 不拾取 `.tsx/.cts/.js/...` fixture；逐包 `pnpm typecheck` 的 namespace-runtime tsconfig include 仅 `src/**/*.ts`（helper 不入逐包 tsc——与 `persistence/test/memory-testkit.ts` 等既有 helper 惯例一致） | read vitest.config.ts / tsconfig.typecheck.json / packages/namespace-runtime/tsconfig.json |
| F13 | tsconfig.base.json 严格键影响 helper 实现类型细节：`strict` + `noUncheckedIndexedAccess`（`node.arguments[0]` 视为可能 undefined，须经谓词参数收窄）+ `exactOptionalPropertyTypes`（`ExportDeclaration.moduleSpecifier` 按 `Expression | undefined` 判空）+ `verbatimModuleSyntax`（类型导入必须 `import type`；typescript 按先例 F11 用默认 import） | read tsconfig.base.json |
| F14 | **relPath 三方案对照（R1 复核，SA2 #1 同款实测）**：`path.relative('/repo/packages', '/repo/packages/namespace-registry/src/registry.ts')` = `namespace-registry/src/registry.ts`（`packages/` 顶层段被扫描根吸收 → 谓词① 前缀永假 → 默认门禁 allow 集结构性为空）；`path.relative('/repo', 同文件)` = `packages/namespace-registry/src/registry.ts`（带顶层段 → 谓词可达）→ **方案 A（单根 REPO_ROOT）是「relPath 相对扫描根」统一语义下基准对齐的唯一结构** | `node -e "path.relative(…)"` 三方案对照（命令与输出在案） |
| F15 | **test/tests/__tests__ 目录分布（R1 复核，SA2 #2 同款实测）**：仓内此三类目录恰 8 个，全部在包级（`packages/*/test` ×7、`domains/vfs3-assets/test` ×1），**无一在 `src/` 子树内** → 条件化剪枝（src 子树内不剪枝）今日扫描面零变化、门禁保持绿、fixture 隔离不受影响 | `find packages domains apps -type d \( -name test -o -name tests -o -name __tests__ \)` + `/src/(test\|tests\|__tests__)` 过滤零命中 |
| F16 | `apps/` 目录存在但仅含 `README.md`（SKIP_FILES）→ 方案 A 顶层白名单按名进入、目录内零审计文件；`apps` 未来缺席亦由按名过滤天然处理（缺席名不出现在 readdir 结果，无需 existsSync） | `ls apps` |

## §2. 需求推演（修订轮切入面）

**要解决的问题**：ADR 0009 第 18 行把「internal subpath 只能由 Registry 生产代码消费」定为模块边界测试义务，但现行 AC5 审计存在两类执行缺口——

1. **识别面缺口（反馈 1，阻塞）**：文本正则只认 `from '…'` 与字面量 `import('…')`。副作用导入 `import '…'`、`require()`、`import = require()`、以及 `.js/.jsx/.mjs/.cjs` 载体整体漏检——非 Registry 生产代码可以合法语法消费 internal subpath 而门禁仍绿。**这等于 ADR 0009 第 18 行未被履行**（冲突报告张力 1 裁定原文）。
2. **白名单过宽（反馈 2，中）**：`startsWith('packages/namespace-registry/src/')` 无条件放行整个 src 树——未来的 `src/testing/`（ADR 0009 §公共 Interface 点名的非生产 testing subpath 载体）、`src/__tests__/`、`src/fixtures/`、`*.test.ts` 都会被视为合法消费者。

**架构切入点**：把审计从「某个测试文件内嵌的 80 行弱正则」升格为**共享审计资产** `test/helpers/registry-seam-audit.ts`——

- **AST 全形态识别**（评审偏好「优先使用 AST」）：TS compiler API 语法树遍历，天然免疫注释/字符串字面量误报（rev1 控制组锚定），一次覆盖反馈 1 点名的全部消费形态与全部载体扩展名；
- **白名单收窄谓词**独立成纯函数 `isWhitelistedConsumer`，正反例矩阵 + fixture 树运行时集成双重锚定；
- **探针与真实门禁共用同一实现，且 relPath 基准同构**（简报设计方向约束 1 + SA2 #1 修复）：`auditInternalSubpathImporters(roots?)` 缺省模式 = 单根仓根 + 顶层白名单（方案 A，§D-D），fixture 探针根 = 显式 roots——两种模式下 relPath 一律**相对各自扫描根**，且默认门禁下 `packages/**` 文件的 relPath 与 fixture `repo/` 根下同路径文件的 relPath **逐字符同构**（均带 `packages/` 顶层段，F14）→ 探针证明的谓词语义 = 真实门禁实际生效的谓词语义，「探针证明 = 门禁行为」的等价性有结构保证（R0 三根方案曾使该主张在默认门禁下失效，SA2 深挖第 3 点；R1 已修复）。

**为什么不继续文本扫描**：全覆盖正则需枚举 `import 'x'` / `import type x from` / `export * from` / `export {} from` / `export = require` / `import x = require` / `require` / `import(` × 注释免疫 × 字符串免疫——每一项都是独立误报/漏报源，且无法自证完备。AST 把「什么是模块说明符边」交给 TypeScript 语法定义（仓内 `typescript@^5.9.3` 既有 devDependency，零新依赖），识别面 = 语法节点类别枚举，可被逐形态探针证明（RAC1 的 9 个形态 it 正是这个证明义务）。

**为什么不放进 `src/`**：审计器是测试基础设施，不是包公共面——放 `src/` 会进入主 entry 依赖图、被逐包 tsc/exports 面牵连，违反约束 5（src 零改动）。`test/helpers/` 是仓内既有惯例（F11/F12：`persistence/test/memory-testkit.ts`、`vfsl-codegen/test/tsc-helper.ts`）。

## §3. 设计决策

### D-A. helper 落位与导出面：`packages/namespace-runtime/test/helpers/registry-seam-audit.ts`（新建）

**导出面恰契约三键**（SA6 §helper 契约冻结；与被审计对象同款纪律——审计器自身也不搞多余导出面）：

```ts
export interface RegistrySeamAuditResult { prodFiles: number; importers: string[]; violators: string[] }
export function auditInternalSubpathImporters(roots?: readonly string[]): RegistrySeamAuditResult
export function isWhitelistedConsumer(relPath: string): boolean
```

- `prodFiles`：被审计的生产候选文件总数（跨全部 roots 累计；防空扫锚点——`>0` 才证明扫描真实发生）。
- `importers`：检测到消费 internal specifier 的文件，**相对各自扫描根**的 POSIX 路径（`path.relative(root, file)` 再 `\` → `/` 归一化）。**默认模式扫描根 = 仓根 REPO_ROOT（方案 A，§D-D）**：真实门禁下未来消费方 relPath = `packages/namespace-registry/src/registry.ts`（带顶层段，谓词①可达）；fixture 探针根为 `repo/`、`bypass/` → relPath 分别形如 `packages/namespace-registry/src/registry.ts`、`side-effect-import.ts`，与 rev1 测试常量逐字对齐，且 `repo/` 正例与默认门禁基准**同构**（F14、P7）。
- `violators = importers.filter(p => !isWhitelistedConsumer(p))`（契约字面）。
- 模块内部常量与函数（`collectAuditedFiles` / `consumesInternalSpecifier` / SKIP 集合等）一律**模块私有**，不导出——未来若需复用再走显式契约演进。
- **零 vitest 依赖**：仅 `node:fs` / `node:path` / `node:url` + `typescript`（devDependency，`@types/node` 已在）→ helper 是纯 Node 模块，任何 runner 可用，亦不被 vitest 当测试收集（F12）。
- import 形态（F11 先例，现行绿；R1 起 `existsSync` 不再需要——默认模式无目录存在性过滤，§D-D 规则 1）：

```ts
import ts from 'typescript';                              // 先例：vfs3-assets-tsdoc.test.ts:34
import { readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
```

- 仓库根推导（先例：旧 AC5 块 L317 同款语义，层级 helpers→test→包→packages→仓根）：

```ts
const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
```

### D-B. 消费形态识别：TS compiler API AST **五形态**（反馈 1 的直接实现；SA6 冻结契约的精确面）

**识别器 = 纯谓词**（对单文件：是否消费 `@nomicore/namespace-runtime/internal`），伪代码（SA3 实现基准；类型细节按 F13 严格键）。**R1：删除 R0 的防御性扩充 E1（属性访问 `.require` callee）——SA2 #3 裁决「超冻结契约的能力必须伴随锚定，否则不许进」；识别面回到且仅回到 SA6 冻结五形态。**

```ts
const INTERNAL_SPECIFIER = '@nomicore/namespace-runtime/internal';

function consumesInternalSpecifier(sourceText: string, fileName: string): boolean {
  const sf = ts.createSourceFile(
    fileName, sourceText, ts.ScriptTarget.Latest,
    /*setParentNodes*/ false,                    // 只下行遍历，不用父链
    ts.getScriptKindFromFileName(fileName),      // .tsx/.jsx→JSX、.ts/.mts/.cts→TS、.js/.mjs/.cjs→JS
  );
  let found = false;
  const isInternal = (e: ts.Expression | undefined): boolean =>
    e !== undefined && ts.isStringLiteral(e) && e.text === INTERNAL_SPECIFIER;

  const visit = (node: ts.Node): void => {
    if (found) return;                                          // 命中即短路（纯谓词，无副作用）
    if (ts.isImportDeclaration(node)) {
      // 形态①：全部静态 import——含副作用导入（importClause === null）、
      // 具名/默认/命名空间导入、import type（模块图边即边界事实，不区分类型/值）
      if (isInternal(node.moduleSpecifier)) found = true;
    } else if (ts.isExportDeclaration(node)) {
      // 形态②：再导出——export * from / export {…} from / export * as ns from
      // （export {…} 无 moduleSpecifier，自然不命中；exactOptionalPropertyTypes 下按 undefined 判空）
      if (isInternal(node.moduleSpecifier)) found = true;
    } else if (ts.isImportEqualsDeclaration(node)) {
      // 形态③：import x = require('…')（ImportEqualsDeclaration + ExternalModuleReference；
      // import x = A.B.C 的内部命名空间形态无字符串说明符，自然不命中）
      if (ts.isExternalModuleReference(node.moduleReference)
        && isInternal(node.moduleReference.expression)) found = true;
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        // 形态④：动态 import('…')（import.meta 是 MetaProperty，不进此分支）
        if (node.arguments.length > 0 && isInternal(node.arguments[0])) found = true;
      } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        // 形态⑤：require('…')——callee 为 Identifier 'require'（精确名匹配）；
        // 递归遍历使其与语法位置无关（变量初始化 / export = require(…) / 回调内 / 条件分支内一律命中）
        if (node.arguments.length > 0 && isInternal(node.arguments[0])) found = true;
      }
    }
    if (!found) node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return found;
}
```

**逐形态 × fixture 载体核对**（RAC1 的 9 个形态 it 的可满足性论证；每一识别形态均有探锚——「声称 = 证明」的对称结构）：

| 形态 | fixture 载体 | 命中节点 | 断言 |
|---|---|---|---|
| 副作用导入 | `bypass/side-effect-import.ts` | ①（importClause null） | 检测+违规 |
| 再导出 | `bypass/re-export.ts`（`export * from`） | ② | 检测+违规 |
| `require()` | `bypass/carrier-require.cjs` | ⑤（Identifier callee） | 检测+违规 |
| `import = require()` | `bypass/import-equals.cts` | ③ | 检测+违规 |
| 动态 `import()` | `bypass/dynamic-import.ts` | ④ | 检测+违规 |
| `.js` 载体 | `bypass/carrier.js`（ESM 再导出） | ②（JS scriptKind） | 检测+违规 |
| `.jsx` 载体 | `bypass/carrier.jsx`（副作用导入 + JSX） | ①（JSX languageVariant） | 检测+违规 |
| `.mjs` 载体 | `bypass/carrier.mjs`（动态 import） | ④ | 检测+违规 |
| 控制组 ×3 | `comment-only.ts` / `string-literal.ts` / `other-specifier.ts` | 注释非节点；裸字符串字面量不在说明符位；`@nomicore/persistence` 说明符不等于 INTERNAL | **不得**检测 |

**明确的残差（不识别，如实声明；SA2 #7 确认此声明纪律合格）**：

1. **属性访问 require**（R1 自 E1 降级登记）：callee 为属性访问的 require 调用——`module.require('…')`、`this.require('…')`、`x.require('…')`。今日零暴露（F8：生产树 `.require(` 零命中、`.cjs` 生产文件为零），且该通道只在 CJS 模块作用域可达。未来若真出现 `.cjs` 生产载体，走 **SA6 契约演进**补形态 + fixture（`bypass/carrier-module-require.cjs`）+ it（SA2 #3 给出的有锚定扩展路径）。
2. **`require.resolve('…')`**（callee 是 PropertyAccess `require.resolve`，name ≠ `require`）：模块解析不是消费，语义上**本就不应**判消费——非缺陷，设计意图。
3. **计算式说明符**：`import(varName)` / `require(buildPath())`——非字符串字面量首参不命中。
4. **`eval` / `Function` 构造**内的字符串代码。
5. **经允许包的传递再导出**（如未来 Registry 把 factory 再导出到其公共 entry）——那是 Registry 包自身导出面纪律，属切片 5/6 的验收域（SA8 届时按 ADR 0009 L18 复审）。

静态 import 图审计的天花板即语法可静态观测的说明符边；本轮门禁目标是架构纪律（防误用），不是对抗性代码。RAC1 未要求覆盖以上形态，设计不虚假宣称覆盖（后续轮不得把残差静默当作已覆盖——SA2 #7 纪律条款）。

### D-C. 白名单收窄谓词 `isWhitelistedConsumer`（反馈 2 的直接实现）

```ts
const REGISTRY_SRC_PREFIX = 'packages/namespace-registry/src/';      // ADR-0009 前瞻前缀（Registry 包尚未存在）
// 冲突报告注 1 下界（SA1 只可扩充，不得缩减/放宽）：
const NON_PROD_SEGMENTS = new Set(['testing', 'test', '__tests__', 'fixtures', 'mock']);
const TEST_FILENAME_RE = /\.(?:test|spec)\./;

export function isWhitelistedConsumer(relPath: string): boolean {
  const p = relPath.replace(/\\/g, '/');                 // Windows 分隔符归一（先例：旧谓词 L323）
  if (!p.startsWith(REGISTRY_SRC_PREFIX)) return false;  // ① 仅 Registry 生产前缀（大小写敏感，精确段）
  const segments = p.split('/');
  // ② 路径段级非生产目录拒绝——扩充 E2（SA2 #4 裁决保留）：段比较大小写不敏感
  //    （防 Mock/、Test/ 大小写变体；Windows FS 大小写不敏感，审计跨平台一致性要求支持；
  //    精确段相等，无子串误伤：testing-utils ≠ testing、mockery ≠ mock）
  if (segments.some((seg) => NON_PROD_SEGMENTS.has(seg.toLowerCase()))) return false;
  // ③ 文件名级测试文件拒绝：含 .test. / .spec.（如 registry.test.tsx、manager.spec.ts）
  const base = segments[segments.length - 1] ?? '';
  return !TEST_FILENAME_RE.test(base);
}
```

**段检查覆盖全路径等价性说明**：能通过 ① 的路径，其前三段被前缀结构固定为 `packages/namespace-registry/src`（均不在拒绝集），故「全路径段检查」与「前缀后段检查」行为等价，取更简单的全路径实现。

**谓词矩阵核对**（rev1 矩阵 4 it + 集成 3 it 的逐条可满足性）：

| 输入 | 判定 | 命中规则 |
|---|---|---|
| `packages/namespace-registry/src/registry.ts` / `src/index.ts` | ✅ allow | ①②③全过 |
| `packages/namespace-registry/src/lease/manager.ts` / `src/lease/deep/manager.ts` | ✅ allow | 生产子目录任意深度放行 |
| `src/testing/registry.test.ts` | ❌ deny | ②（testing）+ ③（.test.）双理由 |
| `src/test/case.ts` / `src/__tests__/case.ts` | ❌ deny | ②（谓词面拒绝——扫描面可见性见 §D-D 条件化剪枝） |
| `src/lease/fixtures/seed.ts` / `src/lease/mock/registry-mock.ts` | ❌ deny | ②（非生产目录不限于顶层） |
| `src/registry.test.ts` / `src/registry.spec.ts` / `src/lease/manager.test.ts` / `manager.spec.ts` | ❌ deny | ③（不论目录位置） |
| `packages/namespace-registry/test/seam.test.ts` | ❌ deny | ①（包根 test/ 不在前缀内） |
| `packages/persistence/src/index.ts`、`packages/namespace-runtime/src/internal.ts`、`packages/namespace-runtime/src/index.ts` | ❌ deny | ①（其他包生产代码 / 本包自己也不行——生产工厂保留包内） |
| `domains/vfs3-assets/src/schema.ts`、`apps/web/src/index.ts` | ❌ deny | ① |
| `packages/namespace-registry/src2/index.ts` | ❌ deny | ①（`src2/` 前缀不匹配——startsWith 按完整段边界） |
| fixture 集成正例 `repo/…src/registry.ts`、`src/lease/manager.ts` | 检测到 + **非** violator | ①②③全过；relPath 与默认门禁基准同构（F14/P7） |
| fixture 集成反例 `src/testing/case.ts`、`src/fixtures/seed.ts`、`src/mock/registry-mock.ts`、`src/registry.test.tsx`、`src/registry.spec.tsx` | 检测到 + violator | ②③ |
| fixture 集成负例 `packages/persistence/src/store.ts` | 检测到 + violator | ① |
| `bypass/*` 全部（relPath 不以 `packages/` 开头） | 检测到 + violator | ① |

**E2 保留声明（SA2 #4 裁决）**：与被删除的 E1 不同类——E2 是纯函数内字符串变换（`toLowerCase`），行为完全确定、零运行时 API 假设、方向单调收紧（deny 面扩大）、跨平台语义合理（Windows FS 大小写不敏感）；矩阵全部小写 → 19 it 零影响；今日真实门禁零影响（仓内无大小写变体段，SA2 实测）。无锚定状态如实声明：后续轮若走 SA6 契约演进，顺带补 `src/Test/case.ts` deny 断言锚定（本轮不强制，SA2 #4）。

**拒绝虚假降级自查**：谓词对「应放行的生产路径」不存在任何静默吞路径——三条规则全部是确定性字符串判定，无 `?? fallback`、无 try/catch 吞错；`base ?? ''` 仅是 `noUncheckedIndexedAccess` 下的类型收窄（`p.split('/')` 末段必存在，`?? ''` 使 `TEST_FILENAME_RE.test('')` 恒 false 亦不改变语义）。

### D-D. walk 规则：方案 A 单根基准 + 条件化剪枝（SA2 #1/#2 的直接实现；SA6 冻结契约的扫描面落位）

```ts
const AUDITED_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
// 方案 A（SA2 #1）：默认门禁的顶层目录白名单——walk 从仓根起，仅进入此三顶层目录，
// 其余顶层条目（wiki/docs/.git/node_modules/REPORT.md/…）在扫描根层剪枝。
const TOP_LEVEL_SCAN_DIRS = new Set(['packages', 'domains', 'apps']);
// 无条件剪枝目录（任何深度；依赖目录与文档目录排除）
const ALWAYS_SKIP_DIRS = new Set(['node_modules', '.git', '.mabf-bg', 'dist', 'coverage', 'docs', 'wiki']);
// 条件剪枝目录（SA2 #2）：test/tests/__tests__ 仅在 src 子树外剪枝——src 子树内照常扫描，
// 由谓词 NON_PROD_SEGMENTS deny 兜底（「存在该消费 → 检测 + 判违规」对非生产目录段完整成立）
const SRC_CONDITIONAL_SKIP_DIRS = new Set(['test', 'tests', '__tests__']);
const SKIP_FILES = new Set(['package.json', 'README.md']);

function isAuditedFile(name: string): boolean {
  if (/\.d\.[cm]?ts$/.test(name)) return false;            // 声明文件不是运行时消费载体（排 .d.ts/.d.mts/.d.cts）
  return AUDITED_EXTENSIONS.has(path.extname(name));
}

function collectAuditedFiles(root: string, filterTopLevel: boolean): string[] {
  const out: string[] = [];
  const walk = (dir: string, atScanRoot: boolean, inSrc: boolean): void => {
    for (const name of [...readdirSync(dir)].sort()) {     // 排序 → 扫描顺序确定（红/绿 diff 可复现）
      if (SKIP_FILES.has(name)) continue;
      // 顶层白名单仅在默认模式（filterTopLevel=true）且当前层为扫描根时生效；
      // fixture 显式根（repo/、bypass/）不受此过滤（bypass/ 根下文件直挂，必须照常审计）
      if (atScanRoot && filterTopLevel && !TOP_LEVEL_SCAN_DIRS.has(name)) continue;
      if (ALWAYS_SKIP_DIRS.has(name)) continue;
      const full = path.join(dir, name);
      const isDir = statSync(full).isDirectory();
      if (isDir) {
        // 条件剪枝（SA2 #2）：包级 test 树剪枝保持（fixture 隔离）；父链含 src 段则不剪枝
        if (SRC_CONDITIONAL_SKIP_DIRS.has(name) && !inSrc) continue;
        walk(full, false, inSrc || name === 'src');
      } else if (isAuditedFile(name)) {
        out.push(full);
      }
    }
  };
  walk(root, true, false);
  return out;
}

export function auditInternalSubpathImporters(roots?: readonly string[]): RegistrySeamAuditResult {
  // 方案 A（SA2 #1）：默认 = 单根 REPO_ROOT + 顶层目录白名单——relPath 统一相对扫描根，
  // 默认门禁下 packages/** 文件的 relPath 带 packages/ 顶层段 → 谓词前缀可达（P7），
  // ADR 0009 L18 首句授权的 Registry 生产构造路径在门禁下可达（R0 三根方案的 CRITICAL 缺陷已修复）
  const isDefaultMode = roots === undefined;
  const scanRoots: string[] = isDefaultMode ? [REPO_ROOT] : [...roots];
  let prodFiles = 0;
  const importers: string[] = [];
  for (const root of scanRoots) {
    for (const file of collectAuditedFiles(root, isDefaultMode)) {
      prodFiles += 1;
      if (consumesInternalSpecifier(readFileSync(file, 'utf8'), file)) {
        importers.push(path.relative(root, file).replace(/\\/g, '/'));
      }
    }
  }
  const violators = importers.filter((p) => !isWhitelistedConsumer(p));   // 契约字面
  return { prodFiles, importers, violators };
}
```

关键语义决策（每条均有依据）：

1. **方案 A：默认扫描根 = 单根 REPO_ROOT + 顶层白名单（SA2 #1 推荐方案，R1 采纳）**。机理（F14）：在「relPath 相对各自扫描根」的统一契约语义下，R0 三根方案使 `packages/` 顶层段被扫描根吸收 → 谓词① 前缀永假 → 默认门禁 allow 集合结构性为空 → ADR 0009 L18 首句授权的 Registry 生产构造路径不可达，且切片 5/6 落地时门禁必假红并被诊断文案误诊为「边界破坏」（失败信号语义污染，SA2 深挖第 4 点）。方案 A 恢复与旧 AC5（F5：`path.relative(REPO_ROOT, full)`）同款的**基准-前缀对齐**，同时完整保持统一语义（默认根 = REPO_ROOT 也是一种扫描根，fixture 显式根行为逐字节不变）；扫描面与三根方案**逐文件等价**（顶层白名单即三根的按名等价物，今日 69 文件不变，F6）；`existsSync` 过滤删除（缺席顶层名天然不出现在 readdir 结果，F16；全部白名单顶层缺席的退化场景由防空扫 it 兜底变红）。
2. **条件化剪枝：`test/tests/__tests__` 仅在 src 子树外剪枝（SA2 #2）**。R0 的无条件剪枝使 `src/{test,tests,__tests__}/**` 不入扫描面 → 消费不被检测 → 门禁绿 = **fail-open 漏检**，与谓词面明文拒绝这三段（rev1 矩阵 L182–183）自相矛盾，也违反本设计自身原则（非生产目录的可见性必须由扫描面保证、可裁性由谓词面裁决——testing/fixtures/mock 三段正是按此原则从剪枝集移出的，R0 未把同一原则应用于冲突三段）。条件化后：src 子树内照常扫描 + 谓词 deny 兜底 = fail-closed；今日扫描面零变化（F15：8 个此类目录全在包级、src 子树零命中）；fixture 隔离不受影响（fixture 位于 `packages/namespace-runtime/test/`，父链不含 `src` 段，F9/F15 交叉验证）。`inSrc` 判定 = 父链含**精确** `src` 段（`src2` 不触发，与谓词前缀的精确段语义一致）。
3. **显式 roots 不做存在性过滤**（响亮失败，拒绝虚假降级立法；R0 规则保持）：fixture 根路径写错（如目录改名）→ `readdirSync` 直接抛 ENOENT → 探针 it 红。若静默 `existsSync` 过滤显式 roots，会得到「空扫描假绿」——这正是防空扫断言要防的反面。
4. **包级 `test` 目录整树剪枝保持**：真实全仓扫描走 `packages/` → 遇包级 `test` 目录名（不在 src 子树）即跳过 → `packages/namespace-runtime/test/`（rev1 测试 + fixture 树 + helper 自身）天然不入真实门禁——fixture 隔离（冲突报告张力 3）与「审计器不审计自己」都由这一条结构性成立。
5. **`fixtures`/`mock`/`testing` 目录不在任何剪枝集，`*.test.*` 文件不在扫描面排除**（R0 规则保持，R1 明确扩展至条件化的三段）：它们必须在**扫描面**内（RAC2 集成反例要求这些文件被检测为 importer）、只在**谓词面**被拒——扫描面跳过它们会造成「非生产目录消费不可见」的盲区。
6. **`statSync` 跟随符号链接**（与旧实现 L357 逐字同语义，零行为漂移）；扫描树内无符号链接环（今日实测成立；环防护 = `lstatSync` 或递归深度上限，SA2 #6 裁定留待后续轮，非阻塞）。
7. **无缓存**：每次调用全新扫描（rev1 真实门禁 it 调用 ×2 + fixture ×1）。规模 = 69 文件 × `ts.createSourceFile`（仅语法层，无 program/无类型检查）→ 亚秒级，无需缓存换取状态污染风险。
8. **解析容错**：`ts.createSourceFile` 对语法错误文件产出恢复 AST 而不抛（真实仓文件经 tsc 门禁本就语法清洁；fixture 语法全部合法）。文件不可读 → `readFileSync` 抛错（响亮）。

**RN4 契约文本同步知会项（SA2 #2 要求设计明文登记）**：本节方案 A 单根语义与条件化剪枝，属 SA8 已裁定的「扫描面/跳过集合策略 = 审计设计自由」（SA2 评审转述为 RN4）；简报 §SA6 helper 契约的「目录跳过」「roots 缺省」两行的**文本表述**需由总控知会 SA6 同步为 R1 语义（行为契约不变：扫描面今日逐文件等价、relPath 仍相对各自扫描根、探针行为零变化）。**本轮 19 it 与 fixture 树零变化（SA2 结语确认），SA1 不改简报/SA6 资产。**

### D-E. 既有 `runtime-registry-internal-seam.test.ts` 的 AC5 块迁移（删除，非保留委托）

**决策：整块删除 L316–395（含 describe 与 3 it），AC5' 由 rev1 文件承载。** 该文件 diff 恰四处：

1. 删除 AC5 describe 块（L316–395，弱正则审计零残留——简报 SA3 落地清单 2 的硬要求）；
2. L32 收窄：`import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';` → `import { readFileSync } from 'node:fs';`（L106 仍用）；
3. 删除 L33 `import * as path from 'node:path';` 与 L34 `import { fileURLToPath } from 'node:url';`（AC5 外零使用，F3）；
4. 头注两处 AC5 提法改指向（≤4 行文字，零断言改动）：L2 块清单 `AC1/AC2/AC4/AC5/AC6` → `AC1/AC2/AC4/AC6`；L22–23 的 AC5 实现句后注一行「（Round 2 强化后 AC5 审计迁移至 `runtime-registry-internal-seam-rev1.test.ts` + `test/helpers/registry-seam-audit.ts`）」。

**删除而非保留委托的理由**：

- rev1 文件对旧 AC5 三 it 是**严格超集——R1 起含基准维度**：防空扫（rev1 L218–221 真实侧 prodFiles>0 ≔ 旧 L374–377）＋ 真实门禁 violators 空（rev1 L223–232 ≔ 旧 L388–395，断言消息同款）＋ 谓词自检（rev1 矩阵 4 it + 集成 3 it ⊃ 旧 L379–386 的 6 断言）＋ **relPath 基准**（方案 A 后 helper 与旧实现同为 `path.relative(仓根, file)`——R0 三根方案曾在「未来合法消费放行」维度上劣于旧实现（旧放行 → 新假红，SA2 深挖第 2 点），R1 已修复并以此为先决条件恢复超集声明）；
- 保留旧块只产生对同一全仓树的重复扫描（69 文件 × 冗余 N 次）与两处门禁漂移面；
- 简报明文「迁移/删除」二选一，删除是弱实现零残留的最强形式；
- 该文件其余 5 it（AC1/AC6 ×3、AC2 ×1、AC4 ×1）与全部断言**逐字不动**（约束 7；F2 的 8 it 基线口径）。

### D-F. `package.json` 单点改动：version patch bump

`packages/namespace-runtime/package.json`：`"version": "0.1.6"` → `"0.1.7"`（硬门禁 #9：本包含 test 改动必 bump）。**该文件唯一 diff**——exports 键集、dependencies、devDependencies、private、type 全部零改动（F10）。

### D-G. RAC × 设计承载 × 19 it 覆盖矩阵

| RAC | 设计承载 | rev1 锚点 it（已落盘） |
|---|---|---|
| RAC1 全形态捕获 | §D-B **五形态**（R1：E1 已删，属性访问 require 入残差）/ §D-D 扩展名与扫描面（含条件化剪枝） | RAC1 describe 10 it：8 形态 it（副作用/再导出/require/import=/动态/.js/.jsx/.mjs）+ 控制组 it（反误报）+ 防空扫 it（fixture 侧 prodFiles>0） |
| RAC1 真实门禁保持绿 | §D-D 方案 A 默认门禁（单根 + 顶层白名单）/ §D-A relPath 基准与谓词前缀对齐（P7）/ F6–F8 零消费面证据 | 真实门禁 describe 2 it（prodFiles>0 + violators 空） |
| RAC2 白名单收窄 | §D-C 谓词（下界 + E2 保留） | RAC2 集成 3 it（正例合规 / 反例违规 / 负例违规）+ 矩阵 4 it（allow / 非生产目录 deny / 文件名 deny / 非 Registry 与边界 deny） |
| RAC3 全量绿 | §D-H 验证路径 | 总控亲验（简报 AC 映射表） |

19 it 合计 = 10 + 2 + 3 + 4（与简报「9 探针/控制组 + 防空扫 + 3 集成 + 4 矩阵 + 2 真实门禁」逐项对账一致）。

### D-H. 验证路径（SA3 交卷门禁）

```bash
cd /home/wangjian/nomicore-fix-issue-109
pnpm exec vitest run packages/namespace-runtime/test/runtime-registry-internal-seam-rev1.test.ts   # 19/19 绿（红灯→绿灯）
pnpm exec vitest run packages/namespace-runtime/test/runtime-registry-internal-seam.test.ts        # 5/5 绿（AC5 块删除后）
pnpm test                                  # vitest run --typecheck 全量绿
pnpm typecheck                             # 7 包 tsc 绿
pnpm exec tsc -p tsconfig.typecheck.json --noEmit   # 聚合：rev1 的 2 条 TS2307 消失，零新增错误
```

**真实门禁变红处置协议**（简报 SA3 落地清单 4，设计再冻结）：实现后 RAC1 真实门禁 it 若红 = 仓内存在弱审计漏检形态的真实消费方——**停止并回禀总控**，不得以收窄识别形态、放宽谓词或扩大剪枝集合的方式绕过（约束 5 的测试侧对偶）。R1 基准修复（方案 A）后，「红」的病因语义单一化：不再存在「基准错配」假红分支（SA2 错误处理审查确认该缺口随 #1 修复自然消除）——红即真实违规消费方。**前瞻验收锚（设计边界，P7 的实测兑现点）**：切片 5/6 首个真实 Registry 生产消费方落地当轮，真实门禁 it（violators=[]）必须保持绿——绿即 P7 兑现，红即基准回退信号。

## §4. 风险与边界条件分析

| # | 风险/边界 | 分析与处置 |
|---|---|---|
| R1 | 探针实现 ≠ 门禁实现（审计器自身一致性裂缝） | §D-A 单一实现双输入（roots 参数化）+ **基准同构**（方案 A：默认门禁与 fixture `repo/` 根下 relPath 逐字符同构，F14/P7——R0 三根方案曾使该主张失效（SA2 深挖第 3 点），R1 修复）；rev1 beforeAll（fixture roots）与真实门禁 it（缺省 roots）调同一函数 |
| R2 | AST 识别面退化为「换个姿势的文本匹配」 | 识别 = 语法节点类别枚举（§D-B 五形态），零正则参与说明符判定；控制组 it 锚定注释/字符串免疫；每一识别形态均有 fixture 探锚（声称 = 证明） |
| R3 | 真实门禁意外变红 | F6–F8 设计期实测：生产树 69 文件全 .ts、internal specifier 消费面零、require() 与 `.require(` 零 → 绿是实测外推，非假设；变红处置协议见 §D-H（R1 后红 = 真实违规，单一病因语义） |
| R4 | fixture 树泄漏进真实门禁（假红） | §D-D 规则 2/4：包级 `test` 目录名（不在 src 子树）整树剪枝；fixture 物理位于 `packages/namespace-runtime/test/fixtures/` 下（F9）；条件化剪枝不影响该隔离（fixture 路径父链不含 `src` 段，F15 交叉验证） |
| R5 | fixture 根路径漂移（目录改名/移动）→ 探针静默空扫假绿 | §D-D 规则 3：显式 roots 不过滤存在性 → ENOENT 响亮红；fixture 侧防空扫 it（prodFiles>0）第二层兜底 |
| R6 | 白名单收窄误伤未来 Registry 生产代码（假红阻塞切片 5/6） | **R1 以方案 A 为先决条件重写本缓解声明**（R0 版在默认门禁基准下为假——SA2 深挖第 2 点）：① 谓词三规则全部确定性，生产子目录任意深度放行（矩阵 allow 例 `lease/deep/`），拒绝集精确段/文件名匹配无子串误伤（`testing-utils`≠`testing`）；② **默认门禁 relPath 基准与谓词前缀对齐（P7）**——未来 `packages/namespace-registry/src/**` 消费方 relPath 带 `packages/` 顶层段、谓词①可达 allow（R0 三根方案的「allow 集结构性为空」缺陷已消除，F14）；③ fixture `repo/` 正例与真实门禁基准同构（等价性有锚）；④ 前瞻验收锚 = 切片 5/6 首个消费方落地当轮真实门禁 it 保持绿（§D-H） |
| R7 | 审计器性能拖慢 `pnpm test` | 69 文件 × 仅语法层 createSourceFile，亚秒级 ×3 次调用；无缓存设计换取零状态污染（§D-D 规则 7） |
| R8 | 删除 AC5 块破坏旧文件其余断言 | F3：fs/path/url 符号在 AC5 外仅 readFileSync@106；5 it 与断言逐字不动（§D-E diff 恰四处） |
| R9 | helper 被误当测试收集 / 漏出类型检查 | F12：vitest include `*.test.ts` 不匹配 helper；聚合 tsc include `packages/*/test/**/*.ts` 覆盖 helper——SA6 记录的 TS2307 ×2 即覆盖证据（helper 落地后消解） |
| R10 | verbatimModuleSyntax/严格键下 helper 编译失败 | F11 先例（`import ts from 'typescript'` 现行绿于同一 tsconfig 链）；F13 类型细节（undefined 收窄/exactOptional）已在伪代码落位 |
| R11 | SA6 资产被实现轮顺手改动（19 it 契约漂移） | rev1 测试 + fixture 树列 ALLOW 且标 `[SA6 owned]`；SA3 仅实现 helper + D-E/D-F 两处授权 diff；SA4 按 ALLOW LIST 比对 |
| R12 | 残差漏检形态被利用（属性访问 require / 计算式说明符 / eval / 传递再导出） | §D-B 残差清单五条如实声明 + 各自归属（属性访问 require：今日零暴露，未来走 SA6 契约演进补形态+探针；传递再导出属 Registry 包导出面纪律，切片 5/6 按 L18 复审）——不虚假宣称覆盖；后续轮不得静默当作已覆盖（SA2 #7 纪律） |
| R13 | `import type { X } from 'internal'` 被判消费（是否过严） | 判消费是设计意图：模块图边即边界事实（internal 零类型导出，类型导入本就解析失败）；与旧正则行为一致（`from '…'` 不分类型/值），零语义漂移 |
| R14 | 版本纪律遗漏 | §D-F 单点 bump 0.1.6→0.1.7，与 helper/测试 Diff 同一提交 |
| R15 | 条件化剪枝/方案 A 与 SA6 契约文本漂移 | §D-D RN4 知会项：行为契约不变（扫描面今日逐文件等价、relPath 仍相对各自扫描根、探针零变化），文本表述由总控知会 SA6 同步；本轮 19 it / fixture / 红灯语义零变化（SA2 结语确认） |

## §5. 文件清单（File Scope）

### ALLOW LIST

- `packages/namespace-runtime/test/helpers/registry-seam-audit.ts` — **新建**，共享审计 helper：AST 五形态识别 + 白名单收窄谓词 + 方案 A 单根基准/条件化剪枝 walk（§D-A/§D-B/§D-C/§D-D，约 130–160 行含 JSDoc；导出面恰契约三键）
- `packages/namespace-runtime/test/runtime-registry-internal-seam.test.ts` — **修改**，diff 恰四处：删 AC5 describe 块（L316–395）+ import 收窄（L32）+ 删 L33–34 + 头注 AC5 提法改指向（§D-E）；其余 5 it 与断言逐字不动
- `packages/namespace-runtime/package.json` — **修改**，唯一 diff：version 0.1.6 → 0.1.7（§D-F，硬门禁 #9）
- `packages/namespace-runtime/test/runtime-registry-internal-seam-rev1.test.ts` — `[SA6 owned]` 红灯契约（已落盘，19 it）；SA3 不得改断言/结构，仅允许测试基础设施级修复
- `packages/namespace-runtime/test/fixtures/registry-seam-audit-rev1/**`（磁盘实测 19 文件，简报记 17 以磁盘为准）— `[SA6 owned]` 探针 fixture 树（已落盘）；冻结不改
- `wiki/raw/task_namespace-runtime-registry-seam-rev1_design.md` — `[SA1 owned]` 本设计文档（R1 修订版）
- `wiki/raw/task_namespace-runtime-registry-seam-rev1.md`、`…_rev1_conflict_report.md`、`…_rev1_dispatch.md`、`…_rev1_sa2_review.md` — `[总控/SA8/SA2 owned]` 已在盘
- `REPORT.md` — `[总控 owned]` 任务报告（已修改态，随实现轮一并更新）

### DENY LIST

- `packages/namespace-runtime/src/**`（含 `internal.ts`/`index.ts`/`runtime.ts` 全部语义层）— 约束 5：本轮**零生产 src 改动**；发现必须动 src 即停止回禀
- `packages/namespace-runtime/test/` 其余全部存量测试文件（`runtime-acceptance-exports-audit.test.ts`、`runtime-registry-internal-type-guard.test-d.ts`、`runtime-registry-internal-sa7-dynamic.test.ts` 等 20+ 文件）— 约束 7：存量锚点零破坏；共享 Y.Doc/Persistence fixture 的提取（评审非阻塞建议）**本轮明确不做**，留待后续轮
- `packages/namespace-runtime/test/fixtures/` 下 rev1 之外的任何新增 fixture — 探针资产冻结；新形态探针（如 `src/__tests__` 集成探针、属性访问 require 载体）须走 SA6 契约演进
- `packages/namespace-runtime/tsconfig.json`、根 `tsconfig.base.json`/`tsconfig.typecheck.json`、`vitest.config.ts` — include globs 已覆盖 helper（F12），零配置改动
- `packages/namespace-runtime/README.md` — Round 1 已对齐，本轮无文档语义变更
- `packages/namespace-registry/**` — 切片 5/6 交付物，不预建（白名单前瞻空集）
- `packages/{persistence,doc-runtime,vfsl,vfsl-protocol,vfsl-codegen,dsh-persistence}/**`、`domains/**`、`apps/**` — 无关面零改动
- `docs/adr/**`、`CONTEXT.md` — ADR 语料冻结

## §6. 协议假设依据 (Protocol Assumption Evidence)

| # | 假设 | 依据类型 | 依据内容（具体引用） | 风险等级 |
|---|---|---|---|---|
| P1 | TS compiler API 语法节点行为：`import 'x'`＝无 importClause 的 ImportDeclaration；`export … from` ＝带 moduleSpecifier 的 ExportDeclaration；`import x = require('x')` ＝ ImportEqualsDeclaration + ExternalModuleReference；`import('x')` ＝ ImportKeyword callee 的 CallExpression；`.tsx/.jsx` 需 JSX scriptKind | 设计期实测验证（仓内） | SA6 绿灯可满足性验证（简报 §SA6 锚定记录）：临时 AST 实现挂载契约路径后 `Test Files 1 passed / Tests 19 passed / Type Errors no errors`——§D-B 逐形态 × 逐载体核对表全部经该真实运行覆盖；`ts.getScriptKindFromFileName`/`createSourceFile` 为 TS 公开稳定 API（仓内 `packages/vfsl-codegen/test/tsc-helper.ts` 既有编译器 API 消费先例） | 低 |
| P2 | helper 的 `import ts from 'typescript'` 在 vitest 运行时 + 聚合 tsc 双通道可用 | 现有测试引用 | `domains/vfs3-assets/test/vfs3-assets-tsdoc.test.ts:34` 同款 import，现行全绿（`pnpm test`/聚合 tsc 均含该文件）；`typescript@^5.9.3` 为本包 devDependency（F10/F11） | 低 |
| P3 | vitest 不把 `test/helpers/*.ts` 当测试收集；`registry.test.tsx`/`registry.spec.tsx` fixture 不被拾取 | 源码引用 + 仓内惯例 | `vitest.config.ts` include 恰 `packages/*/test/**/*.test.ts`（无 `.tsx`）；非 `*.test.*` helper 惯例先例：`persistence/test/memory-testkit.ts`、`vfsl-codegen/test/tsc-helper.ts`（简报现状事实亦载） | 低 |
| P4 | 聚合 tsc 覆盖 helper 且其 import 消解唯缺 helper 文件本身 | 设计期实测验证（仓内） | SA6 记录：聚合 tsc 现状红恰为 rev1 测试 L52/L53 的 2 条 TS2307（`Cannot find module './helpers/registry-seam-audit'`）——证明该 include 链已在检查此目录且解析路径正确；helper 落地后同命令零错误（P1 验证运行含 `Type Errors no errors`） | 低 |
| P5 | helper 落地后真实全仓门禁保持绿（violators 空 + prodFiles>0） | 设计期实测验证（仓内） | F6/F7/F8：生产扫描域 69 文件全 .ts、internal specifier 生产消费面零（仅 README 文本与 src/internal.ts 注释，二者均不可达/非消费）、生产 .ts 中 require() 与 `.require(` 零；P1 的 19/19 验证运行即含真实门禁 2 it 绿 | 低 |
| P6 | fixture 探针根 relPath 基准（相对各自根）与 rev1 常量逐字对齐 | 设计期实测验证（仓内） | P1 验证运行中 RAC1/RAC2 全部 `toContain` 断言绿（fixture 相对路径常量 × 扫描结果全对齐，简报：「fixture 路径/relPath 基准/矩阵断言全部正确」） | 低 |
| **P7** | **默认门禁 relPath 基准与谓词前缀基准对齐：未来 `packages/namespace-registry/src/**` 生产消费方的 relPath 带 `packages/` 顶层段，谓词①可达 allow（SA2 #5 要求增补——R0 的 P1–P6 全部验证「今日零消费前提下的行为」，无一覆盖 allow 路径可达性）** | 机理论证 + 等价性实测依据 + 前瞻验收锚 | ① 方案 A：默认扫描根唯一 = REPO_ROOT → `path.relative(REPO_ROOT, file)` 对 packages/** 恒带顶层段（F14 实测：`/repo` 基准 → `packages/namespace-registry/src/registry.ts`；三根方案实测剥离段、前缀永假）；② fixture `repo/` 显式根下同路径文件的 relPath 与默认门禁下**逐字符相同**——探针正例（检测到且非 violator，rev1 集成正例 it）即真实门禁基准的等价性证明（SA2 深挖第 6 点）；③ 旧 AC5 基准同款（F5：`path.relative(REPO_ROOT, full)`，Round 1 已正确，R1 恢复）；④ **前瞻验收锚**：切片 5/6 首个真实 Registry 生产消费方落地当轮，真实门禁 it（violators=[]）必须保持绿——该时点绿灯即 P7 的实测兑现，红即基准回退信号（§D-H） | 低 |

其余（条件化剪枝的今日等价性、包级剪枝隔离、bump 纪律、glob 覆盖）为纯代码/配置事实（F9/F15/F16/F12），不属协议级假设。

## §7. 契约改动连锁审计 (Contract Change Caller Audit)

**无生产契约改动**：本设计仅涉及【新增测试域 helper + 删除某测试文件内局部 describe 块 + 配置 version bump】——`src/**` 全部函数的签名、返回类型、throw 路径、同步性逐字不动（约束 5；ADR 0008/0009 冻结面零触碰）。

新增面与被删面的 caller 审计：

### 改动函数

| 函数/符号 | 文件 | 改动前契约 | 改动后契约 |
|---|---|---|---|
| `auditInternalSubpathImporters` / `isWhitelistedConsumer` / `RegistrySeamAuditResult` | `packages/namespace-runtime/test/helpers/registry-seam-audit.ts`（新建） | 不存在 | 新增（SA6 冻结契约三键；无生产 caller；缺省 roots = 单根仓根 + 顶层白名单——方案 A） |
| 旧 AC5 局部函数 `auditInternalSubpathImporters` / `isWhitelistedConsumer`（describe 块内 const/function） | `runtime-registry-internal-seam.test.ts` L322–372 | 块内局部，无块外 caller | 随 describe 块删除（零涟漪） |
| `package.json` `version` | `packages/namespace-runtime/package.json` | `0.1.6` | `0.1.7`（元数据；exports/依赖零改动，解析行为不变） |

### Caller 清单（新 helper 的全部消费方）

| Caller | 文件:行号 | 是否 await | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---|---|---|---|---|
| fixture 探针扫描 | `runtime-registry-internal-seam-rev1.test.ts:92`（beforeAll） | 否（同步调用） | ❌ 裸调用（同步） | vitest 测试级错误报告 | 预期行为：helper 抛错（如 fixture 根缺失）→ 测试红（响亮，见 §D-D 规则 3）——不需 catch |
| 真实门禁 it | 同文件 `:219`（防空扫） | 否 | ❌ | 同上 | 同上 |
| 真实门禁 it | 同文件 `:227`（violators 断言） | 否 | ❌ | 同上 | 同上 |

三个 caller 均为同步测试断言点，无 async 时序、无错误吞没问题；helper 唯一 throw 路径 = 文件系统 IO 错误（fixture 根缺失/文件不可读），设计意图即测试红。

## §8. 评审反馈逐条落实映射（本轮驱动反馈 → 设计承载）

| 反馈/要求 | 是否落实 | 设计位置 | 落实摘要 |
|---|:--:|---|---|
| 反馈 1【阻塞】副作用导入漏检 | ✅ | §D-B 形态① | ImportDeclaration 无 importClause 亦命中；fixture `side-effect-import.ts` it 锚定 |
| 反馈 1【阻塞】再导出漏检 | ✅ | §D-B 形态② | ExportDeclaration moduleSpecifier；`re-export.ts` + `.js` 载体 it 锚定 |
| 反馈 1【阻塞】require()/import=require() 漏检 | ✅ | §D-B 形态③⑤ | ImportEqualsDeclaration + require CallExpression（递归位置无关）；`.cjs`/`.cts` 载体 it 锚定 |
| 反馈 1【阻塞】.js/.jsx/.mjs/.cjs 生产文件漏检 | ✅ | §D-D 扩展名集合 | 八扩展名 + `.d.*ts` 排除；`.js`/`.jsx`/`.mjs` 载体 it 锚定（仓内暂无此类文件，价值由探针兑现，F6） |
| 反馈 1【阻塞】优先 AST / 全形态 + 违规探针 | ✅ | §D-A/§D-B/§D-G | TS compiler API 单一实现双输入且基准同构（R1 方案 A）；9 形态/控制组 it + 2 真实门禁 it |
| 反馈 2【中】白名单排除 testing/test/__tests__/fixtures 等 + 正反例 | ✅ | §D-C | 谓词三规则（前缀/段拒绝含 mock/文件名拒绝）；矩阵 4 it + 集成 3 it（正例 2 / 反例 5 / 负例 1）；`src/{test,tests,__tests__}` 的**扫描面可见性**由 §D-D 条件化剪枝保证（R1，SA2 #2） |
| 反馈 2【中】「或收窄到具体生产模块」路径未取 | ✅（显式裁定） | §D-C | 保持 `src/` 前缀前瞻 + 段/文件名排除（简报设计方向约束 3 指定形态；Registry 包未建，枚举具体模块会阻塞切片 5/6 演进） |
| 非阻塞建议：两动态测试共享 fixture 提取 | ✅（显式不做） | §5 DENY | 本轮可选项不做：触碰 SA7 动态测试资产无 RAC 背书，风险 > 收益，留待后续轮 |
| RAC1/RAC2/RAC3 | ✅ | §D-G/§D-H | 覆盖矩阵 + SA3 交卷门禁命令组 + 前瞻验收锚（P7） |

## SA2 反馈逐条回应（R1 修订登记，按 SKILL §SA2 反馈修订协议）

| SA2 要求（R0 评审编号） | 是否落实 | 修订位置 | 修订内容摘要 |
|---|:--:|---|---|
| #1 CRITICAL：relPath 基准错配——默认门禁 allow 集结构性为空；按方案 A（或论证更优的等价方案）修订 | ✅（采纳方案 A） | §D-A（relPath 基准/import 行）、§D-D（规则 1 + `TOP_LEVEL_SCAN_DIRS` + existsSync 删除）、§2（双输入基准同构主张）、§4-R1/R6、§6-P7、§D-E（超集声明的基准维度）、F5/F14/F16、§D-H（红病因单一化注） | 默认扫描根改单根 REPO_ROOT + walk 顶层目录白名单 {packages,domains,apps}（其余顶层剪枝）；relPath 统一相对扫描根 → 默认门禁 relPath 带 `packages/` 顶层段、谓词①可达；扫描面与三根方案逐文件等价（今日 69 文件不变）；existsSync 过滤删除（F16：按名过滤天然处理缺席）；R6 缓解声明以修复后基准重写；P7 增补（含前瞻验收锚）；§D-E「严格超集」补基准维度对齐声明（R0 曾退化，SA2 深挖第 2 点） |
| #2 HIGH：src/{test,tests,__tests__} 扫描面盲区——跳过规则条件化 | ✅ | §D-D（`SRC_CONDITIONAL_SKIP_DIRS` + `inSrc` 递归传递 + 规则 2/5）、§4-R4/R15、§8（反馈 2 行补扫描面可见性）、F9/F15、§D-D RN4 知会项 | 三段名仅在 src 子树外剪枝（包级 test 树隔离与 fixture 隔离保持）；src 子树内照常扫描、谓词 deny 兜底 → fail-closed；今日扫描面零变化（F15 实测 8 目录全在包级、src 子树零命中）；fixture 行为零影响（树内无此类目录，F9）；RN4 契约文本同步知会项明文登记（总控知会 SA6，本轮 19 it/fixture 零变化） |
| #3 HIGH：E1 删除回 SA6 冻结五形态（不接受无锚定保留） | ✅ | §D-B（形态⑤仅 Identifier callee；E1 分支与边界声明段删除；残差清单第 1 条新增「属性访问 require」）、§D-G（RAC1 承载改「五形态」）、§4-R12、F8 | 识别面回到且仅回到冻结五形态；「属性访问 require（module.require/this.require）」如实入残差（今日零暴露：`.require(` 生产树零命中 + .cjs 生产文件为零）；未来出现 .cjs 载体时走 SA6 契约演进补形态+fixture+it（SA2 给出的有锚定扩展路径） |
| #4 裁决：E2 保留（可接受） | ✅（维持，零改动） | §D-C（E2 保留声明段） | 大小写不敏感段拒绝保持；SA2 裁决理由（确定性纯函数/单调收紧/跨平台合理/今日零影响）已并入声明；后续轮契约演进顺带补 `src/Test/case.ts` deny 锚（不强制） |
| #5 MEDIUM：§6 增补 P7（默认门禁 allow 路径可达性） | ✅ | §6-P7 | 四重依据：方案 A 机理（F14 实测）+ fixture `repo/` 正例与真实门禁基准逐字符同构（等价性证明）+ 旧 AC5 基准同款（F5）+ 前瞻验收锚（切片 5/6 首个消费方落地当轮真实门禁 it 保持绿，§D-H） |
| #6 LOW 非阻塞：符号链接环（断言非机制） | 登记不改 | §D-D 规则 6 | 维持 `statSync` 同旧语义（零漂移）；环防护（`lstatSync`/深度上限）按 SA2 裁定留待后续轮，本轮不阻塞 |
| #7 LOW 确认项：残差宣称边界合格 | ✅（纪律已知悉） | §D-B 残差清单 | R1 残差清单扩至五条（含降级登记的属性访问 require）；后续轮不得把残差静默当作已覆盖；传递再导出防线在切片 5/6 Registry 包导出面验收域，届时 SA8 按 L18 复审 |

**R1 预置退让点更新**：R0 预置的 E1 退让点已执行（SA2 #3 裁决）；E2 保留（SA2 #4 裁决），若后续轮判定应回下界，删 `.toLowerCase()` 一处即回。R1 新增设计自由点（方案 A 顶层白名单、条件化剪枝、P7 前瞻验收锚）均零触碰 19 it 与 fixture 树（SA2 评审实测核对 + R1 复核 F14/F15 在案），红灯语义保持「helper 缺席」。
