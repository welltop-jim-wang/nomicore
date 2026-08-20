# [Bug] 生成物编译级三项缺陷：N1 缺协议 import 行（TS2304/TS2664）、N2 零别名域 script 退化遮蔽协议模块（TS2305）、N3 别名碰撞无守卫（TS2315/TS2314）—— Issue #45

**Status**: analyzed | **Date**: 2026-08-21
**Severity**: high（N1/N2 阻塞 G 票 #27 消费接线——生成物纳入任何 typecheck program 即红，且 N2 反向毒化同 program 全部协议消费方；N3 为静默产出不可编译物的缺失守卫）
**Type**: new-feature-defect (broke at: `008e34c`——F2 生成器首发即有，非回归；本 worktree 基点 `5907dc3`（PR #46 merge）上三项全部仍然存活)
**Layer**: script（构建期生成器 `@nomicore/vfsl-codegen` 及其编译期 TS 产物；无运行时面）

## Symptoms

前序证据（SA7 报告 §一·6/§二/§四）在本 worktree（基点 `5907dc3`，PR #46 已含）**全部独立复现确认**。三项症状均为「生成物原样不可编译 / 毒化 program」，当前仓内零 `domains/` 故 408 测试全绿不可见（与 SA7 判定一致：显影时刻 = G 票把 `domains/*/generated.ts` 纳入 typecheck program）：

1. **N1（缺 import 行）**：生成物段②（`export type <别名> = …`）与段③（`declare module '@nomicore/vfsl-protocol'` 增广体）均引用 `PathSchema<…>`，但**全文无任何 import**。孤立 program `tsc --noEmit` → **TS2304**（Cannot find name 'PathSchema'）×每个引用位 + **TS2664**（Invalid module name in augmentation——program 内无任何文件 import 该模块，增广目标不在 program）。
2. **N2（零别名域 script 退化）**：零别名域（aliases 表仅 `ROOT`）的生成物段②为空 → 文件无 top-level import/export → TS 视为 **script 而非 module** → 其 `declare module '@nomicore/vfsl-protocol'` 退化为**整体环境模块声明（非增广）**，**遮蔽同 program 内 paths 解析到的真实协议模块**——他文件 `import { PathAt }` → **TS2305**（has no exported member），即一个最小合法域的生成物能让整个 program 里所有协议消费方变红。
3. **N3（别名碰撞无守卫）**：域内声明 `type PathSchema = YMap<{ x: YLeaf<string> }>;`（解析层合法——VFSL 保留名仅 ROOT 与标记类型，`PathSchema` 不在其列）→ 生成物自碰撞：段② `export type PathSchema = { 'x': PathSchema<string, 'leaf'> };` → **TS2315**（Type 'PathSchema' is not generic——体内名字解析到正被声明的非泛型本地别名）+ 段③ `x: PathSchema<PathSchema, 'map'>;` → **TS2314**（requires 2 type argument(s)）。生成器与 CLI **均无守卫、均 exit 0 静默产出**（本 worktree CLI 实测）。

## Reproduction

环境：worktree `/home/wangjian/nomicore-fix-issue-45`，分支基点 `5907dc3`；node v24.13.0 / pnpm 10.28.2 / tsx（仓内 node_modules/.bin）/ tsc 5.9（仓内 typescript）。全部探针在 `/tmp/sa5-i45/` hermetic 目录，**仓内零写入**（`git status` 仅调度器 wiki 文件，`git diff` 空）。

### 步骤 1 — 函数级生成（tsx 直驱 `generateProjection`，`/tmp/sa5-i45/dump.mjs`）

三个最小 fixture（`.vfsl` 头部三键指令 + 模块体）经 `parseVfsl → evaluate → generateProjection(derived, { sourceText })` 落盘 `/tmp/sa5-i45/gen/`：

| fixture | 模块体 | aliases 键 | 产物关键形态 |
|---|---|---|---|
| `n1-alias` | `type ROOT = YMap<{ label: YLeaf<string>; box: Box }>; type Box = YMap<{ n: YLeaf<number> }>;` | `["ROOT","Box"]` | 段② `export type Box = { 'n': PathSchema<number, 'leaf'> };` + 段③ `label/box: PathSchema<…>`；`importLine=false`、`exportStmt=true` |
| `n2-zero-alias` | `type ROOT = { label: string };` | `["ROOT"]` | 段② 空；仅头注 + 增广体 `label: PathSchema<string, 'leaf'>`；`importLine=false`、**`exportStmt=false`（script 形态）** |
| `n3-collision` | `type ROOT = YMap<{ x: PathSchema }>; type PathSchema = YMap<{ x: YLeaf<string> }>;` | `["ROOT","PathSchema"]` | 段② `export type PathSchema = { 'x': PathSchema<string, 'leaf'> };`（自碰撞）+ 段③ `x: PathSchema<PathSchema, 'map'>;` |

三个产物均无 import 行（`/^import /m` 零命中）——N1 缺陷在发射器输出层直接可见。

### 步骤 2 — tsc 干跑（5 个 program，`/tmp/sa5-i45/progs/p*/tsconfig.json`）

tsconfig 统一：`noEmit + strict + moduleResolution:'bundler' + module:'esnext' + types:[]` + `paths` 把 `@nomicore/vfsl-protocol` 指向仓内 `packages/vfsl-protocol/src/index.ts`；`consumer.ts` = `import { PathAt, VfslKind } from '@nomicore/vfsl-protocol'; export type K = VfslKind;`。

| program | files | exit | tsc 输出（逐字） |
|---|---|---|---|
| **p1（N1 复现）** | `n1-alias.generated.ts`（孤立） | **2** | `(9,26): TS2304: Cannot find name 'PathSchema'.`（段② Box 行）；`(11,16): TS2664: Invalid module name in augmentation, module '@nomicore/vfsl-protocol' cannot be found.`；`(14,12)`/`(15,10): TS2304`（段③ label/box 行） |
| **p1-fixed（N1 治愈对照）** | `n1-alias.fixed.ts`（= 生成物前置一行 `import type { PathSchema } from '@nomicore/vfsl-protocol';`） | **0** | 无输出——import 行一贴，孤立 program 即编译通过 |
| **p2（N2 复现）** | `n2-zero-alias.generated.ts` + `consumer.ts` | **2** | 生成物 `(11,12): TS2304`（增广体内 PathSchema）；**consumer `(1,10): TS2305: Module '"@nomicore/vfsl-protocol"' has no exported member 'PathAt'.` + `(1,18): TS2305 … 'VfslKind'`——script 形整体声明遮蔽真实协议模块，消费方被他文件毒化** |
| **p2-fixed（N2 双愈对照）** | `n2-zero-alias.fixed.ts` + `consumer.ts` | **0** | 无输出——同一行 import 使文件成 module → `declare module` 恢复增广语义 → 消费方 PathAt/VfslKind 正常解析 |
| **p3（N3 复现）** | `n3-collision.generated.ts` + `consumer.ts`（consumer 使增广目标入 program，隔离出纯碰撞码） | **2** | `(8,33): TS2315: Type 'PathSchema' is not generic.`（段②体内名解析到本地非泛型别名）；`(12,19): TS2314: Generic type 'PathSchema<Value, Kind>' requires 2 type argument(s).`（段③首实参位） |

### 步骤 3 — CLI 端到端（真实触发路径）

`/tmp/sa5-i45/cli/domains/{collide,zerodom}/schema.vfsl`（目录名 = id base，满足 idBase 约定）：

```bash
pnpm generate --domains /tmp/sa5-i45/cli          # → exit 0（两域均成功写出 generated.ts）
pnpm generate --check --domains /tmp/sa5-i45/cli  # → exit 0（新鲜度校验对内容缺陷天然失明）
```

- **碰撞域（N3）：CLI 今日 exit 0 静默产出不可编译生成物**——守卫缺失的端到端实证；`--check` 亦 0（regen-diff 只抓漂移，不抓内容缺陷）。
- 零别名域（N2 形态）经真实 CLI 路径产出 script 形生成物。
- CLI 产物与函数级探针产物 `diff` **逐字节一致**（`--exit 0` 双连）——发射器确定性核对通过，函数级与 CLI 级是同一缺陷的同一输出。

## Investigation

阅读（Step 1+2 共 7 文件 + 3 组 grep）：任务简报 `task_vfsl-codegen-hardening.md`、决议摘编 `_relevant_decisions.md`、前序证据 `task_vfsl-codegen_sa7_report.md`（§一·6/§二/§四）、`20260820-bug-vfsl-codegen.md`（确认为 #26 缺口分析、不覆盖本票三项 → 无可复用报告）、`packages/vfsl-codegen/src/emitter.ts`、`src/header.ts`、`src/index.ts`；grep 协议导出面 / SchemaSource 指令语法 / CLI 测试 fixture 头部。

### 数据流（缺陷链路）

```
domains/<d>/schema.vfsl
  → FileSchemaSource.load（信封四键）→ assertVfslDialect（方言断言）
  → parseVfsl → evaluate（派生 schema 七槽）
  → generateProjection（emitter.ts:96）           ←──── 三项缺陷全部位于此发射函数
      L123  buildHeader(...)                       ← header.ts:35 纯注释块，无 import
      L126-129 段②：for (Object.keys(derived.aliases)) 跳过 ROOT → emitAlias
      L132-140 段③：declare module '@nomicore/vfsl-protocol' { interface VfslPathMap … }
  → domains/<d>/generated.ts（入仓，CI regen-diff 保鲜）
  → [G 票消费接线时刻] 纳入 typecheck program → 症状显影
```

### 三项触发条件（本 worktree 实测钉死）

| 缺陷 | 触发条件 | 实证 program |
|---|---|---|
| N1 | **任意域**：生成物引用 `PathSchema`（= 有 ≥1 个 ROOT 字段或 ≥1 个别名——实际上所有合法域）且 program 内无其他文件 import 协议 → TS2304+TS2664；即使他文件 import 协议（SA7 F2b），段② TS2304 仍在（模块作用域名解析不豁免） | p1 |
| N2 | **零别名域**（aliases 仅 `ROOT`，ADR-0003 最小合法域形态）的生成物与协议消费方**同 program** → 消费方 TS2305 + 生成物自身 TS2304 | p2 |
| N3 | 域别名名 ∈ 协议导出面（12 名，见 Root Cause）→ 生成物自碰撞 TS2315/TS2314；**生成器/CLI 全链无守卫 exit 0** | p3 + CLI 探针 |

### 过程自纠

首轮 tsc 干跑因 `files` 相对路径解析（相对 tsconfig 所在目录）报 TS6053×5——我方探针脚手架错误，改绝对路径后全部命中；缺陷本体零假阳性。

## Root Cause

三项缺陷同源：**`generateProjection`（`packages/vfsl-codegen/src/emitter.ts:96-142`）的发射清单只有头注 + 段② + 段③，两处位点共同缺失协议接线与守卫**：

1. **N1 — 发射清单缺 import 行**：`emitter.ts:122-141` 组装 `lines` 仅 `buildHeader()`（L123；`header.ts:35-46` 返回纯注释块）、段②别名声明（L126-129，`emitAlias` L148-160 经 `emitNode` L190 发射 `PathSchema<…, '…'>`）、段③增广（L132-140，`emitInterfaceMember` 同样经 `emitNode` 引用 `PathSchema`）。全文无任何 `import type { PathSchema } from '@nomicore/vfsl-protocol'` 发射位点 → 名字引用无绑定（TS2304）且增广目标模块不入 program（TS2664）。缺口属**设计层假设**：设计文档 §3.9 冻结样板本就无 import（样板 test-d 的增广机制前提「文件自 import 协议」未在生成契约中复刻——SA7 N1 对照，本次静态+动态双确认）。
2. **N2 — N1 与段②循环的复合后果**：段②循环 `for (const name of Object.keys(derived.aliases)) { if (name === 'ROOT') continue; … }`（`emitter.ts:126-129`）在零别名域发射零条 `export` → 叠加 N1 无 import → 文件无任何 top-level import/export → script；script 内 `declare module '<Specifier>' {}`（L132）按 TS 语义是**整体环境模块声明**（非增广），对 program 内 paths 解析的同名真实模块形成遮蔽 → 他文件 TS2305。**N1 的 import 行恒定发射即顺带治愈**（文件恒为 module；p2-fixed exit 0 实证）。
3. **N3 — 段②发射无保留名守卫**：`emitAlias`（`emitter.ts:148-160`）对 `Object.keys(derived.aliases)` 的每个名字无条件 `export type ${name} = …`；别名名与协议包导出面的碰撞无人检查。协议导出面实测 12 名（`packages/vfsl-protocol/src/index.ts` grep）：`VfslKind / PathSchema / UnknownPath / RootSchema / PathAt / VfslValueOf / PathValue / PathKind / PathPatchValue / PathElementValue / VfslTypedAccess / VfslPathMap`。解析层对这 12 名零保留（VFSL 保留名仅 `ROOT` + 标记类型 `YMap/YArray/YPlainArray/YLeaf/YXmlFragment/Pattern`——n3 fixture `parsed.ok === true` 实证）→ 碰撞名一路绿灯直达发射。注意与 N1 修复的相互作用：补 import 行后碰撞域还会新增「import 绑定 vs 本地 export」重复标识符形态——守卫独立必要，不能靠 import 方案吸收。

回归性：`git log -- packages/vfsl-codegen/src/emitter.ts` 仅 `008e34c`（F2 首发）+ `9cd33d2`（R3 返修，未触发射清单）——缺陷自首发即有，非回归。

**Fix direction**（供 SA1 设计参考，不展开实现方案）：
① N1+N2 同票双愈：`generateProjection` 恒定发射一行 `import type { PathSchema } from '@nomicore/vfsl-protocol';`（头注之后、段② 之前，任意域含零别名域），双愈已在本次复现中以最小补丁形态实证（p1-fixed / p2-fixed 均 exit 0）；既有契约测试为子串/正则/确定性断言（见锚点建议 3 实测核对），补行预计零既有断言破坏，AC-2 为纯增量锚定。
② N3 独立错误码守卫：段②发射前对别名名 × 协议导出面（上述 12 名，以协议包实测导出为准）做碰撞检查，命中即以**独立错误码**命名化响亮失败（与 `UnsupportedRootShapeError`/`UnsupportedRootReferenceError`/`UnsupportedUnionKindError` 同构、但新码独立），CLI 顶层 catch → 结构化 stderr + exit 2；不依赖 G 票命名规约（Owner 裁定 2）。
③ 附带（AC-4）：`emitter.ts` 三处**消息串**尾「由总控开后续票登记」在 L39/L58/L76（L50 为文档注释非消息，按 AC-4「三处」字面不在其列，是否顺带同步归 SA3）。

## Evidence

全部命令于本 worktree 基点 `5907dc3` 实测执行；产物在 `/tmp/sa5-i45/`（hermetic，仓内零写入）。

- **E1 函数级生成**：`./node_modules/.bin/tsx /tmp/sa5-i45/dump.mjs` →
  `[n1-alias] aliases=["ROOT","Box"] importLine=false exportStmt=true`、
  `[n2-zero-alias] aliases=["ROOT"] importLine=false exportStmt=false`、
  `[n3-collision] aliases=["ROOT","PathSchema"] importLine=false exportStmt=true`（三产物全文见 Reproduction 步骤 1 表）。
- **E2 N1 复现/治愈**：`tsc -p /tmp/sa5-i45/progs/p1` → exit 2（TS2304 ×3 + TS2664 ×1，行号 9/11/14/15）；`tsc -p …/p1-fixed` → **exit 0**。
- **E3 N2 复现/双愈**：`tsc -p …/p2` → exit 2（生成物 TS2304 + **consumer TS2305 ×2：'PathAt'、'VfslKind'**）；`tsc -p …/p2-fixed` → **exit 0**（消费方恢复解析——遮蔽由 script 形态解除）。
- **E4 N3 复现**：`tsc -p …/p3` → exit 2（`(8,33) TS2315` + `(12,19) TS2314`）。
- **E5 CLI 端到端无守卫**：`pnpm generate --domains /tmp/sa5-i45/cli` → **exit 0**（碰撞域 `domains/collide/generated.ts` 385B 静默产出）；`pnpm generate --check --domains /tmp/sa5-i45/cli` → **exit 0**（新鲜度对内容缺陷失明）。
- **E6 确定性核对**：`diff gen/n3-collision.generated.ts cli/domains/collide/generated.ts` 与 n2 同款 diff → 均 exit 0（函数级 = CLI 级逐字节）。
- **E7 根因位点**：`emitter.ts:122-141`（发射清单无 import 位点）、`emitter.ts:126-129`（段②循环，零别名域发零 export）、`emitter.ts:148-160`（`emitAlias` 无保留名守卫）、`emitter.ts:190`（`PathSchema<…>` 引用发射）、`header.ts:35-46`（头注纯注释块）；协议导出面 12 名（`grep '^export' packages/vfsl-protocol/src/index.ts`）。
- **E8 回归性**：`git log --oneline -- packages/vfsl-codegen/src/emitter.ts` = `9cd33d2`、`008e34c`（首发即有）；AC-4 尾串位 L39/L58/L76（grep）。
- **E9 现场清洁**：全程未添加任何诊断日志（分析走 /tmp 探针，源码零接触）；`git status --short` 仅调度器暂存的 4 个 wiki 文件，`git diff --stat` 空。

## 给后续 SA 的锚点建议（实测钉死的事实）

1. **N1+N2 修复的最小形态**：一行 `import type { PathSchema } from '@nomicore/vfsl-protocol';` 置于头注空行之后、段②之前——p1-fixed/p2-fixed 双 exit 0 即为绿灯形态样板（AC-1 断言可锚定「任意域（含零别名）生成物首非注释行 = 该 import」+「孤立 program tsc 可编译」）。
2. **N3 守卫对象域**：12 名清单以 `packages/vfsl-protocol/src/index.ts` 实测导出为准（勿凭 ADR-0004 D3 文字回忆——实测含 `RootSchema/VfslValueOf/PathPatchValue/PathElementValue` 等 D3 未逐一列全者）；`PathAt` 等泛型名同样要拦（本次以 `PathSchema` 实证，机制对 12 名一视同仁）。测试可复用本报告 n3 fixture（解析层放行 + 生成层应独立错误码拒绝）。
3. **既有测试冲击面（断言风格实测核对，非推测）**：`generate-mapping-table.test.ts` 16 处断言全为 `toContain`/正则/`toBe(parsed.ok)` 子串形；`generate-discriminated-emission.test.ts` 28 处全为 `toMatch` 正则 + 确定性 `expect(emit()).toBe(out)`（同输入自相等，不受补行影响）——**两文件补 import 行均预计零既有断言破坏**，AC-2 锚定为纯增量（新增 import 行恒定存在断言 + 孤立可编译断言）；`generate-discriminated-narrow.test-d.ts` 未读，SA6/SA3 自查。
