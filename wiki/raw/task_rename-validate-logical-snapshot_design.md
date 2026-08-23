# SA1 架构设计 — validateSnapshot → validateLogicalSnapshot 全仓一次性更名（Issue #71 / ADR-0007）

> **R2 修订版**：落实 SA2 R1 全部 4 攻击点（`.scratch*` 裁决 + G 门白名单化 / §4.2(b) 整 bullet 替换单元 + 锚文本纪律 / 探针显式单跑 / §1 证据命令修正），逐条映射见 §9。
> 任务类型：refactor（深度重构·纯更名迁移）。阶段：Phase 2。
> 依据链：ADR-0007「逻辑层」条款（唯一权威）+ CONTEXT.md 术语条目（规范名/`_Avoid_`）+ 任务简报（含 SA6 Phase 1 红灯契约记录）+ `_relevant_decisions.md`（SA8 前置门禁）。
> 红灯基线：`packages/vfsl/test/validate-logical-snapshot.test.ts` 29/29 红（AC1 新名缺失 / AC2 旧名仍在 / 27 条行为回归因 `validate is not a function` 失败）。
> 红绿对照基线：共享断言集以旧名跑 27/27 绿（greencheck，已删）——断言集精确描述既有行为，SA3 更名后以新名转绿即「零回归」的行为证明。

---

## §0. 任务快照

| 维度 | 冻结值 |
|---|---|
| 改动性质 | **纯名称迁移**：公共导出 `validateSnapshot` → `validateLogicalSnapshot`，同步迁移全仓符号引用、注释、活文档行文与导出面；**零行为改动** |
| 硬禁令 | 不保留 deprecated alias（ADR-0007 明文 + AC2 红灯守卫） |
| 行为基线 | 值语义、issues 形状（`ValidateIssue`：message+path）、资源预算（100 条上限+截断 / Pattern 4M 步钳制 / 2×10⁸ 全局工作预算）、纯函数、零写入——全部逐字节不变 |
| 不变量来源 | ADR-0007 §逻辑层 + ADR-0003 §1（接缝清单，名称经 ADR-0007 修订）+ ADR-0006 §校验面（范围语义与名称正交） |
| 基线 commit | `ee3643c`（PR #70 head）；SA6 Phase 1 产物已 staged 未提交 |

---

## §1. 旧名全仓分布地图（grep 实证，2026-08-22 于 worktree 实测）

> **口径注记（R2）**：命中总数随流程产物（本任务前缀的 wiki/raw 文件、评审报告）动态漂移——设计时点 369，SA2 评审时点 407（排 node_modules/.git）。**完备性以本节逐文件清单为准，不以总数为准**；门禁形态为 §6 G1 白名单式全仓 `git grep`（只搜跟踪文件，无 dot 目录/新路径盲区——R1 正向枚举式 grep 恰在 `.scratch*` 上暴露了结构性盲区）。

`grep -rn "validateSnapshot"`（排 node_modules/.git）命中按处置域分四类：

### 域 A — 符号引用域（必须迁移，本设计核心）

| 文件 | 引用形态 | 位置（实测行号） |
|---|---|---|
| `packages/vfsl/src/validate.ts` | **函数定义** `export function validateSnapshot(derived, snapshot)` | L642 |
| `packages/vfsl/src/index.ts` | **重导出** `export { validateSnapshot } from './validate.js'` | L73 |
| `packages/vfsl/test/validate-snapshot.test.ts` | named import + 约 70 处调用 + describe/it 标题 | L28 起全文 |
| `packages/vfsl/test/validate-snapshot-sa7.test.ts` | named import + 12 处调用（10 `it` + 1 `it.each` 展开） | L8 起全文 |
| `packages/vfsl/test/validate-patch.test.ts` | named import + 2 处调用（L329/L516 等价性对照） | L45 |
| `packages/vfsl/test/validate-patch-sa7.test.ts` | named import + 3 处调用（L59/L68/L87） | L31 |
| `packages/vfsl/test/docscope-guards.test.ts` | named import + 2 处调用（L92 冻结条目 ≡ 新鲜 derived） | L11 |
| `packages/vfsl/test/vfsl-assets-fullchain-e2e.test.ts` | named import + 10 处调用 | L32 |

**生产代码 caller 数 = 0**（src/ 内除定义与重导出外无调用点——`validate-patch.ts` 只调内部 `validateSubtree`；实测 `grep -rn "validateSnapshot(" packages/vfsl/src/` 命中仅 `validate.ts:642` 定义行与 `index.ts:14` 注释行，SA2 R1 独立复核同向）。其余包（vfsl-protocol / vfsl-codegen / persistence / dsh-persistence）、`apps/`、`domains/`、`tests/` 全部零命中——下游消费面尚未存在，迁移半径封闭在本包。

### 域 B — 注释域（随文件迁移，同属必改）

| 文件 | 位置 | 内容摘要 |
|---|---|---|
| `src/validate.ts` | L4 / L70 / L591 / L633-641 / L648 | 头注「validateSnapshot 是值 schema 的解释器」/ createCtx 注释 / interpret JSDoc / 函数 JSDoc（D3 重写）/ validateSubtree JSDoc |
| `src/index.ts` | L3 / L14 / L23 / L35 / L78 | 头注 issue 注记 / 公共接缝清单行 / validatePatch 行 / 编排行 / 数组写入校验行 |
| `src/resolve.ts` | L5 | 「后续 validateSnapshot 票复用」 |
| `src/validate-patch.ts` | L18 / L564 | 「与 validateSnapshot 同款」（E100 path 纪律引用） |
| `test/evaluate-derived-schema.test.ts` | L593 | it 标题「计算属 validateSnapshot 消费」 |
| 域 A 各测试文件 | 头注与 describe/it 标题 | 随符号机械替换覆盖 |

### 域 C — 活文档域（必须迁移）

| 文件 | 位置 | 性质 |
|---|---|---|
| `README.md` | L61 / L65 / L90 | 当前引擎能力清单 / 公共接缝不变量 / 路线图 |
| `apps/README.md` | L7 | Phase 0 完成条件描述 |
| `docs/vfsl/v1-spec.md` | L20 / L199 / L480 | 引擎能力分工 / 语义层归属 ×2 |

### 域 D — 历史档案域（**不迁移**，见 D5/D6/D8/D10 论证）

| 文件 | 命中 | 豁免理由 |
|---|---|---|
| `docs/adr/0003` L8/L14、`docs/adr/0006` L73 | 3 | ADR 不可变决策记录（D5） |
| `docs/adr/0007` L8/L14 | 2 | 更名决策本体，两名并陈是记录的构成部分（D5） |
| `wiki/prd/0060` L31、`wiki/raw/**`（约 30 文件）、`TASK.md` L15 | 多 | 任务 mandate 与流水线审计轨迹（D5） |
| `.scratch/vfsl-v1-parser/spec.md` L3/L18/L48/L59 | 4 | **R2 裁定豁免（D10）**：git 跟踪的 dated 工作草稿（PR #17 时代）——`wiki/raw/20260818-prd-vfsl-v1.md`（PRD 定稿，D5 豁免）的前身，4 处旧名句式与定稿 L7/L22/L52/L63 逐字同源；迁移草稿而豁免定稿将使同一句文在 draft→final 间名称分叉，破坏草稿作为「当时所写」忠实快照的审计一致性 |
| `.scratch-spec-20.md` L18 | 1 | **R2 裁定豁免（D10）**：同族——issue #20 简报 `wiki/raw/task_vfsl-evaluator.md`（D5 豁免）的 dated 草稿，L18 与简报 L28 逐字同源，同理不迁移 |
| `CONTEXT.md` L49 | 1 | 术语契约的 `_Avoid_` 条目——旧名在此出现恰是执行机制（D8） |
| `test/validate-logical-snapshot.test.ts` L4/L10/L26/L33-34 | 5 | SA6 红灯探针本体 + 头注方法论叙述（D6，断言零改动） |
| `test/validate-logical-snapshot.contract.ts` L4/L23 | 2 | SA6 共享断言集头注方法论叙述（D6，简报明示「无需迁移」） |

> 域 D 补注：`.scratch-review-spec.md` 亦被 git 跟踪但零旧名命中（实测），无需裁决处置。scratch 三文件全部列入 §10 DENY LIST（R2 追加）。

---

## §2. 影响推演（Refactor 三问）

### 2.1 推翻什么假设

唯一被推翻的假设是**命名语义**：「`validateSnapshot` 可被理解为校验 live Yjs 文档」（ADR-0007 背景判词——「名称容易误导」）。更名把「logical ROOT snapshot（普通 JSON）」写进标识符本身。**除此之外无任何假设被推翻**：解释器算法、资源账本、崩溃边界、零写入纯函数契约、`ValidateIssue` 形状、ROOT 保留名语义全部原样。

### 2.2 保留什么行为（零回归面，SA7 动态验证对照）

1. 签名 `(derived: DerivedSchema, snapshot: unknown) => ValidateResult` 逐字不变（仅函数名 token 变化）；
2. 函数体 `return interpret(derived.values, derived.values['ROOT'], snapshot)` **逐字节不动**；
3. 一切 issue 消息字面量不含函数名（实测核验：validate.ts 无任何字符串字面量含 `validateSnapshot`）——更名对消息域零影响，逐字节等价由构造保证；
4. 27 条共享行为断言（issues 语义 / 资源预算 / 纯函数 / 零写入 / E100 / 截断边界）+ 35（validate-snapshot）+ 10+each（sa7）+ 36（validate-patch）+ 6（docscope-guards）+ 16（fullchain）既有绿基座全绿。

### 2.3 迁移风险点（→ §7 风险登记册）

- 漏改静态 import → typecheck TS2305 兜底；漏改注释 → grep 门兜底；
- 顺手加 alias → AC2 红灯兜底（`toBeUndefined` 断言是守卫，有牙）；
- 顺手改行为/消息 → 禁令 D1 + 65+ 既有测试兜底；
- 误触 SA6 冻结文件 / wiki 历史档案 → DENY LIST 兜底；
- 文件名处置引发冻结文件 stale 引用 → D4 裁定不改文件名（论证见下）。

---

## §3. 设计决策冻结表

| # | 决策 | 内容 | 依据 |
|---|---|---|---|
| **D1** | 更名半径最小化 | 只允许三类改动：①符号 token 替换（`validateSnapshot` → `validateLogicalSnapshot` 全字匹配）；②`validate.ts:642` JSDoc 重写为 D3 逐字文本；③D5/D6 裁定外的注释/活文档行文同步。函数体、`interpret`、`validateSubtree`、一切消息字面量**逐字节不动**。局部变量名（如 `viaSnapshot`）**不改**——不在验收符号域，改动徒增 diff | 零行为回归承诺（AC2）；「深度重构」的正确形态是机械迁移而非顺手改造 |
| **D2** | 不留 alias | 禁止 `export { validateLogicalSnapshot as validateSnapshot }` 及任何形式的兼容绑定 | ADR-0007「不保留兼容 alias」明文；AC2 红灯是守卫 |
| **D3** | JSDoc 载体边界逐字文本 | `validate.ts:642` 函数 JSDoc 整块替换为 §4.1 逐字文本（logical JSON / 不接受 Y.Doc·Y.Map·Y.Array / 不验证载体 / ADR-0007 更名注记，**不提旧名**） | AC3；旧名不出现在 src 是 §6 G1 门的要求 |
| **D4** | **不改任何文件名** | `validate-snapshot.test.ts` / `validate-snapshot-sa7.test.ts` 保留原名（内容迁移）；src 文件名本就不含旧名 | 三重论证：①简报迁移提示未给目标文件名，且把无需更名的 `validate-patch.test.ts`/`docscope-guards`/`fullchain-e2e` 并列——「机械更名」指符号非路径；②SA6 冻结文件 `validate-logical-snapshot.contract.ts:46` 以 `validate-snapshot.test.ts` 为活指针（fixture 同源注记），重命名将迫使触碰冻结文件或留下更刺眼的 stale 指针；③AC1/AC2 验收对象是模块导出与调用方（符号），路径名不在验收域。**已知可接受残留**：两个 kebab-case 路径名，属历史 provenance 标记，不误导任何 Yjs 语义（见 §7 R-yes） |
| **D5** | 历史档案不迁移 | `docs/adr/**`、`wiki/**`（prd+raw）、`TASK.md` 不改写 | ①ADR 纪律：决策记录不可变，ADR-0007 L14 本身必须两名并陈（「`validateSnapshot` 直接更名为 `validateLogicalSnapshot`」）——docs/adr 零命中在逻辑上不可达，除非销毁决策记录；②ADR-0007 已全局修订 ADR-0003 措辞的效力（后法优于前法），无需回头改写前法正文；③wiki/raw 是各票 dated 审计产物（如 issue #21 的 SA2 评审记录评审的正是当时名为 validateSnapshot 的设计），改写即伪造审计轨迹；④TASK.md/wiki-prd 是本任务 mandate 文本，「现有 validateSnapshot 直接更名」删掉旧名则 mandate 不可读。SA8 前置门禁已把这一定夺权交给 SA1/SA2，本设计行使其并给出完整论证 |
| **D6** | SA6 双文件零改动 | `validate-logical-snapshot.test.ts`（断言零改动，简报明示）与 `validate-logical-snapshot.contract.ts`（「无需迁移」，简报明示）一个字符都不动。contract.ts 头注 L4/L23 的旧名是**方法论叙述**（描述「把既有行为固化为断言集、以旧名绿验证明精确性」这一 Phase 1 方法），非活引用 | 简报 SA3 迁移提示两条明文；Phase 1 契约冻结 |
| **D7** | 版本 bump 0.1.10 → 0.2.0 | `packages/vfsl/package.json` version 字段单行改动 | 删除公共导出 = semver 破坏性变更，0.x 惯例 minor bump；包 `private: true` 无发布风险，bump 是纪律信号（先例：公共面变更伴随版本纪律，Hard Gate #9 体系） |
| **D8** | CONTEXT.md 不动 | 术语条目已是终态：规范名 `validateLogicalSnapshot` + `_Avoid_: validateSnapshot`。`_Avoid_` 条目必须含旧名——这是术语契约的执行机制，不是残留 | CONTEXT.md L47-49 实测；relevant_decisions §术语 |
| **D9** | 单提交原子迁移 | 全部改动（§4 全清单 + §10 ALLOW）一次 commit 落地；commit 前本地四重门（§6 G1–G4）全过 | 更名迁移不存在有意义的中间态；分步提交会制造 typecheck 破损窗口 |
| **D10**（R2 追加） | `.scratch*` 双文件豁免 | `.scratch/vfsl-v1-parser/spec.md`（4 处）与 `.scratch-spec-20.md`（1 处）git 跟踪旧名**不迁移**，并入域 D 同族；三 scratch 文件进 DENY LIST | ①draft→final 保真：两文件是 `wiki/raw/20260818-prd-vfsl-v1.md` 与 `wiki/raw/task_vfsl-evaluator.md`（均 D5 豁免的 dated 定稿）的工作草稿，旧名句式逐字同源——迁草稿不迁定稿将使同一句文名称分叉，草稿丧失「当时所写」快照性质；②语义性：scratch 按命名约定即非活文档，现行 API 认知源是 README/docs/vfsl/CONTEXT.md（全迁移）；③半径纪律：改 2 个死草稿零读者收益（SA2 R1 攻击点 1 的两选项中取豁免支） |
| **D11**（R2 追加） | G 门白名单化 | 废弃 R1 正向枚举式 G1/G2（结构性盲区：glob 展开跳过 dot 条目，漏 `.scratch*`），改为**单一白名单式全仓门**（§6 G1：`git grep` + 集中豁免 pathspec，覆盖代码+活文档一个命令）+ **G2 静态指纹门**（`"整份 JSON 快照校验"` 句式零命中，防 §4.2(b) 孤儿续行——该措辞是旧 L15-17 的独有指纹，新文本不含） | SA2 R1 攻击点 1+2：白名单集中可审计、天然无 dot/新路径盲区；git grep 只搜跟踪文件，与 PR diff 同域 |
| **D12**（R2 追加） | SA6 探针显式单跑 | SA3 自验与 SA7 报告均须执行 `pnpm exec vitest run packages/vfsl/test/validate-logical-snapshot.test.ts --passWithNoTests=false` 并断言 `Test Files 1 passed / Tests 29 passed`；全量 `pnpm test` 后另确认运行清单含该文件 | SA2 R1 攻击点 3：vitest 全局 `passWithNoTests: true`，探针文件被删/漏跑时全量与 CI 均静默假绿；仓内已有同威胁模型先例（CI 对 persistence-contract / domains-scaffold 两步显式 `--passWithNoTests=false`，注「防测试文件被删后静默假绿」）。改 CI 超出 ALLOW LIST，故纪律落在自验+SA7 证据要求 |
| **D13**（R2 追加） | 锚文本定位纪律 | 全设计替换指令以**锚文本**定位、行号仅作参考；§4.1(b) JSDoc 块 9 行 → 16 行替换后 validate.ts 后续锚行号整体 **+7**（L642 def → L649、L648 → L655 等）；§4.2(b) bullet 4 行 → 5 行替换后 index.ts 后续锚行号整体 **+1**（L23→L24、L35→L36、L73→L74、L78→L79） | SA2 R1 攻击点 2 放大器：块替换引发行号漂移，按行号顺序执行将用到失效锚 |

---

## §4. 逐文件改动规格

### 4.1 `packages/vfsl/src/validate.ts`（核心改动点）

**(a) L642 函数定义行**：

```ts
// 改动前
export function validateSnapshot(derived: DerivedSchema, snapshot: unknown): ValidateResult {
// 改动后
export function validateLogicalSnapshot(derived: DerivedSchema, snapshot: unknown): ValidateResult {
```

**函数体（锚文本 `return interpret(derived.values, derived.values['ROOT'], snapshot);`，当前 L643）逐字节不动。**

**(b) 函数 JSDoc 整块替换（锚文本：起 `/**` + `公共导出（issue #21）`，止 `不静默产出 ok:true。` + ` */`；当前位于 L633-641，共 9 行 → 16 行，替换后本文件后续行号整体 +7，见 D13）**（D3 逐字文本，SA3 照抄）：

```ts
/**
 * 公共导出（issue #21；issue #71 / ADR-0007 更名）：逻辑快照校验——值 schema 树
 * 解释器，对整份快照跑一遍。
 *
 * 载体边界（issue #71 / ADR-0007）：输入 `snapshot` 是普通 JSON **logical ROOT
 * snapshot**（ROOT 命名空间的完整逻辑值，纯 JSON 数据）；**不接受** Y.Doc /
 * Y.Map / Y.Array 等 live Yjs 载体，也**不验证** Yjs 载体形态——载体结构校验属
 * ADR-0007 的 Yjs Runtime 层（extractYjsSnapshot / materializeRoot 域），与逻辑
 * 值语义正交。不保留兼容 alias。
 *
 * 同步、纯函数、不抛错；不修改 `derived` 与 `snapshot`（纯数据只读遍历）；结果纯
 * JSON 值（JSON 往返全等）；编译一次、校验多次（一切中间态调用局部，不落模块级
 * 缓存）。前置条件：`derived` 须为 `evaluate` 的 ok:true 产物；篡改数据（删判别式
 * 键是测试合法操作——缓存非契约；造环/删别名属手造垃圾）落入 loud E100 边界，
 * 不静默产出 ok:true。
 */
```

> 注：新 JSDoc **不出现旧名**（更名史实由 ADR-0007 与 wiki 承载）——保 G1 门全零。

**(c) 注释域 4 处机械替换**（锚行当前 L4 头注 / L70 createCtx 注释 / L591 interpret JSDoc / L648 validateSubtree JSDoc；若 (b) 已先执行，后两处漂移至 L598/L655——一律以锚文本定位，D13）：`validateSnapshot` → `validateLogicalSnapshot` 全字替换，语句结构不动。

### 4.2 `packages/vfsl/src/index.ts`

**(a) L73 导出行**：

```ts
// 改动前
export { validateSnapshot } from './validate.js';
// 改动后
export { validateLogicalSnapshot } from './validate.js';
```

**(b) 公共接缝清单条目——替换 L14-17 的整个 4 行 bullet（不是只换 L14 一行！L15-17 续行不含旧名 token，G1 门不可见，只换 L14 会留下双门皆盲的孤儿续行，SA2 R1 攻击点 2）。锚文本：起 ` * - \`validateSnapshot(derived, snapshot)\``，止 `崩溃边界同款 E100）。`。替换后本文件后续行号整体 +1（L23→L24、L35→L36、L73→L74、L78→L79——一律以锚文本定位，D13）**：

改动前（当前 L14-17 原文，SA3 对照删除边界）：

```
 * - `validateSnapshot(derived, snapshot)` → `{ ok: true } | { ok: false, issues }`
 *   ——整份 JSON 快照校验（issue #21 设计 §2/§3）：值 schema 树解释器，全收集
 *   （上限 100 条 + 截断标记）；Pattern 走包内 NFA 子集模拟（ReDoS 防护，零运行时
 *   依赖）；同步、纯函数、不抛错（崩溃边界同款 E100）。
```

改动后（5 行整块）：

```
 * - `validateLogicalSnapshot(derived, snapshot)` → `{ ok: true } | { ok: false, issues }`
 *   ——逻辑快照校验（issue #21 设计 §2/§3；issue #71 / ADR-0007 更名）：值 schema
 *   树解释器，输入为普通 JSON logical ROOT snapshot（不接受 Y.Doc/Y.Map/Y.Array
 *   等 live Yjs 载体）；全收集（上限 100 条 + 截断标记）；Pattern 走包内 NFA 子集
 *   模拟（ReDoS 防护，零运行时依赖）；同步、纯函数、不抛错（崩溃边界同款 E100）。
```

守卫：新文本不含 `"整份 JSON 快照校验"` 句式——§6 G2 静态指纹门断言该串在 index.ts 零命中，孤儿续行必被抓获。

**(c) 注释域 4 处机械替换**（锚行当前 L3 / L23 / L35 / L78；(b) 执行后漂移为 L3 / L24 / L36 / L79——以锚文本定位，D13）：L3 头注 issue 注记改「issue #21（#71 更名）：validateLogicalSnapshot」；其余 3 处全字替换。

### 4.3 `packages/vfsl/src/resolve.ts` + `packages/vfsl/src/validate-patch.ts`

纯注释域：resolve.ts L5（「后续 validateSnapshot 票复用」→「后续逻辑快照校验接缝（issue #21）复用」，或全字替换，二选一以全字替换为默认）；validate-patch.ts L18 / L564 全字替换。

### 4.4 测试文件（7 个，内容迁移、不改文件名——D4）

统一规则：`validateSnapshot` → `validateLogicalSnapshot` **全字机械替换**（import 语句、调用点、describe/it 标题、头注注释一并覆盖）；不重排、不改断言逻辑、不改局部变量名：

| 文件 | 涉及 |
|---|---|
| `test/validate-snapshot.test.ts` | L28 import + 全文（35 `it`） |
| `test/validate-snapshot-sa7.test.ts` | L8 import + 全文（10 `it` + 1 `it.each`） |
| `test/validate-patch.test.ts` | L45 import + L329/L516 调用 + 头注/标题注释 |
| `test/validate-patch-sa7.test.ts` | L31 import + L59/L68/L87 调用 + 注释 |
| `test/docscope-guards.test.ts` | L11 import + L88 标题 + L92 调用 ×2 |
| `test/vfsl-assets-fullchain-e2e.test.ts` | L32 import + 10 处调用 + 注释 |
| `test/evaluate-derived-schema.test.ts` | 仅 L593 it 标题注释 1 处 |

**SA6 双文件零改动**（D6）：`validate-logical-snapshot.test.ts` / `validate-logical-snapshot.contract.ts`。

### 4.5 活文档（3 文件 7 处）

| 文件:行 | 改法 |
|---|---|
| `README.md:61` | 「`validateSnapshot`（整份 JSON 快照校验）」→「`validateLogicalSnapshot`（逻辑快照校验：普通 JSON logical ROOT snapshot，不接受 live Yjs 载体）」 |
| `README.md:65` | 接缝清单全字替换 |
| `README.md:90` | 路线图全字替换 |
| `apps/README.md:7` | 全字替换 |
| `docs/vfsl/v1-spec.md:20/199/480` | 全字替换（语义层归属引用，语义不变） |

### 4.6 `packages/vfsl/package.json`

`"version": "0.1.10"` → `"0.2.0"`（D7）。exports 字段（`.` → `./src/index.ts`）不含符号名，不动。

---

## §5. 红灯对账（29 红 → 绿机制）

SA6 红灯文件 `validate-logical-snapshot.test.ts` 的 29 条失败与 SA3 改动的因果：

| 红灯组 | 失败原因（当前） | 转绿机制 |
|---|---|---|
| AC1（1 条）`typeof validateLogicalSnapshot === 'function'` | index.ts 未导出新名 | §4.2(a) 导出行替换 → 命名空间取成员拿到函数 |
| AC2（1 条）`validateSnapshot toBeUndefined` | 旧名仍在导出 | §4.2(a) 同时移除旧名绑定；**不新增任何 alias**（D2） |
| 行为回归（27 条）`validate is not a function` | 新名缺失导致 `registerBehaviorRegression(undefined as any)` | 新名可用后共享断言集以新名执行既有解释器——greencheck 已证同断言集对当前实现 27/27 绿，更名不动行为 → 逐条转绿 |

断言零改动（简报明示）：该文件用命名空间动态取成员（无静态旧名 import），更名后自然通过——SA3 不得触碰该文件。

---

## §6. 验证门（SA3 自验 + SA7 动态 + SA4 静态共用；R2 重构：G1 白名单化 + G2 静态指纹 + G3 探针单跑）

```bash
# G1 全仓符号门（白名单式，D11——取代 R1 正向枚举式 G1/G2；git grep 只搜跟踪文件，无 dot/新路径盲区）
git grep -n "validateSnapshot" -- \
  ':!wiki' ':!docs/adr' ':!TASK.md' ':!CONTEXT.md' \
  ':!.scratch' ':!.scratch*' \
  ':!packages/vfsl/test/validate-logical-snapshot.test.ts' \
  ':!packages/vfsl/test/validate-logical-snapshot.contract.ts'
# 期望：零输出（exit 1）。
# 设计期实测基线（迁移前，2026-08-22）：14 文件 / 148 行 = §1 域 A+B+C 迁移全集
# 逐文件：validate.ts 5 / index.ts 6 / resolve.ts 1 / validate-patch.ts 2 /
#   validate-snapshot.test.ts 74 / validate-snapshot-sa7 11 / validate-patch.test.ts 13 /
#   validate-patch-sa7 8 / docscope-guards 3 / fullchain-e2e 17 / evaluate-derived-schema 1 /
#   README.md 3 / apps/README.md 1 / v1-spec.md 3
# （scratch 双文件、wiki、docs/adr、TASK.md、CONTEXT.md、SA6 双文件全部正确落入豁免侧——实测验证）

# G2 静态指纹门（D11——防 §4.2(b) 孤儿续行；该句式是旧 L15 独有指纹，新文本不含）
grep -n "整份 JSON 快照校验" packages/vfsl/src/index.ts
# 期望：零输出（exit 1）

# G3a SA6 探针显式单跑（D12——堵 passWithNoTests 静默假绿；SA3 自验与 SA7 报告均须贴证据）
pnpm exec vitest run packages/vfsl/test/validate-logical-snapshot.test.ts --passWithNoTests=false
# 期望：Test Files 1 passed (1) / Tests 29 passed (29)——文件被删/漏收集则 exit 1 响亮失败

# G3b 全量测试 + 类型（根仓既有入口；跑后确认运行清单含探针文件）
pnpm test        # vitest run --typecheck：29/29 新绿 + 既有全套全绿，运行清单含 validate-logical-snapshot.test.ts
pnpm typecheck   # 五包 tsc 全过

# G4 CI
# .github/workflows/ci.yml node:[20,24] matrix 全绿（AC4）
```

---

## §7. 风险登记册

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| R1 | 漏改某个静态 import | 中 | typecheck TS2305 必红；G1 grep 兜底注释域 |
| R2 | 顺手加 deprecated alias | 高（违 ADR-0007） | D2 禁令；AC2 `toBeUndefined` 红灯是活守卫 |
| R3 | 顺手改行为/消息字面量 | 高（违零回归） | D1 半径冻结；65+ 既有绿基座 + 27 条共享断言兜底；消息域实测不含函数名 |
| R4 | JSDoc/注释引入旧名 | 低 | D3 逐字文本不含旧名；G1 门兜底 |
| R5 | 误触 SA6 冻结文件或 wiki 历史 | 中 | D5/D6 + DENY LIST；SA4 diff 比对 |
| R6 | 版本 bump 遗漏 | 低 | D7 + ALLOW LIST 明示 |
| R7 | 误改文件名引发冻结文件 stale 指针 | 中 | D4 裁定不改文件名，从源头消除 |
| R8（R2 追加） | SA6 探针文件被删/漏收集 → `passWithNoTests: true` 下全量与 CI 静默假绿 | 高（验收链伪绿） | D12：G3a 显式单跑 `--passWithNoTests=false` + 29 passed 断言 + G3b 运行清单确认；CI 先例（persistence-contract / domains-scaffold）同威胁模型已用同款纪律 |
| R9（R2 追加） | §4.2(b) 只换 L14 单行 → L15-17 孤儿续行（不含旧名 token，G1 盲区） | 高（烂头注不可见） | §4.2(b) 明确整 bullet 4→5 行替换 + 附旧原文对照；G2 静态指纹门（`"整份 JSON 快照校验"` 零命中）专抓此形态 |
| R-yes | 已知可接受残留：`validate-snapshot.test.ts` / `validate-snapshot-sa7.test.ts` 两个路径名（kebab-case）+ contract.ts:46 活指针 + sa7 文件头注 L5 的历史注记 | 低（记录在案） | 路径名不承载 Yjs 误导语义（AC 关切的是「校验 live Yjs 文档」的误导，路径不构成 API 语义）；若 SA2 裁定必须改，属 R 修订显式扩展 ALLOW LIST + 解除 contract.ts 冻结的单点修订，不得顺手为之 |

**并发/一致性**：纯函数、无共享可变态、无 I/O——天然线程安全；更名不引入任何时序。

---

## §8. SA3 执行指令（顺序即依赖；**全程锚文本定位、行号仅参考——D13**）

> 行号漂移声明（R2）：§4.1(b) JSDoc 块替换（9→16 行）后 validate.ts 后续锚 +7；§4.2(b) bullet 替换（4→5 行）后 index.ts 后续锚 +1。本节行号为**改动前基线值**，每步执行后以锚文本重定位后续目标。

1. `src/validate.ts`：函数 JSDoc 整块替换（锚 `公共导出（issue #21）`，9→16 行，§4.1(b) 逐字）+ def 行改名（锚 `export function validateSnapshot(`，基线 L642）+ 4 处注释替换（锚文本定位）；
2. `src/index.ts`：**L14-17 整个 bullet 4→5 行替换**（锚起 `` * - `validateSnapshot(derived, snapshot)` ``，§4.2(b) 含旧原文对照）+ L73 导出行替换（锚 `export { validateSnapshot }`）+ 4 处注释替换；
3. `src/resolve.ts` L5、`src/validate-patch.ts` L18/L564 注释替换；
4. 7 个测试文件全字机械替换（§4.4 表）；
5. 活文档 3 文件 7 处（§4.5 表）；
6. `packages/vfsl/package.json` version → `0.2.0`；
7. 自验：G1（白名单全仓门）→ G2（静态指纹门）→ G3a（探针显式单跑，贴 29 passed 证据）→ G3b（全量 + typecheck，确认运行清单含探针）四步全过；
8. 单 commit（D9）落地，消息建议 `refactor(vfsl)!: rename validateSnapshot to validateLogicalSnapshot (ADR-0007, #71)`。

**禁令复述**：不加 alias（D2）；不动函数体与任何消息字面量（D1）；不动 SA6 双文件（D6）；不动 docs/adr、wiki/**、TASK.md、CONTEXT.md、`.scratch*`（D5/D8/D10）；不改任何文件名（D4）；局部变量名不改（D1）；index.ts 接缝条目必须整 bullet 替换、禁止只换单行（D13/R9）。

---

## §9. SA2 反馈逐条回应

R2 修订（2026-08-22）——SA2 R1 四攻击点全部落实，无「承认但不改」条目：

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| ①（MAJOR）`.scratch*` 双文件 git 跟踪旧名未裁决 + G1/G2 盲区 → 显式裁决 + 门升级白名单式全仓 git grep | ✅ | §1 域 D 新增 2 行 + 域 D 补注；§3 新增 **D10**（豁免裁定：draft→final 同源保真论证）/ **D11**（门白名单化）；§6 G1 整体重写；§10 DENY LIST 追加 scratch 三文件 | 裁决取**豁免支**：两文件是 D5 豁免定稿（`20260818-prd-vfsl-v1.md` / `task_vfsl-evaluator.md`）的 dated 草稿、旧名句式逐字同源（L3/L18/L48/L59 ↔ 定稿 L7/L22/L52/L63；L18 ↔ L28）——迁草稿不迁定稿将使 draft→final 名称分叉；G1 改为单一白名单式 `git grep` + 集中豁免 pathspec（双 pathspec `':!.scratch' ':!.scratch*'` 显式覆盖目录与顶层文件），**设计期实测**：迁移前基线 14 文件/148 行恰为迁移全集，scratch/wiki/adr/SA6 双文件全部正确落入豁免侧（命令与逐文件计数写入 §6） |
| ②（MAJOR）§4.2(b) 替换单元歧义（L14 单行 vs L14-17 四行 bullet）→ 明确整条目替换 + 附旧原文 + 锚文本纪律 + 行号漂移 | ✅ | §4.2(b) 整段重写（「替换 L14-17 的整个 4 行 bullet」+ 改动前 4 行原文 + 改动后 5 行 + G2 守卫注记）；§4.1(b)/(c)、§4.2(c) 补锚文本与漂移值；§3 新增 **D13**；§8 头部漂移声明 + 步骤 1/2 改锚文本定位；§6 新增 G2 静态指纹门；§7 新增 R9 | 替换单元显式化为 4 行 → 5 行整 bullet（含锚文本起止）；全设计统一「锚文本定位、行号仅参考」纪律；漂移量化（按落盘文本实数校准）：validate.ts +7（JSDoc 9→16 行）/ index.ts +1（bullet 4→5 行）；G2 指纹门（`"整份 JSON 快照校验"` 零命中）使孤儿续行从「双门不可见」变为「必被抓获」——新 §4.2(b) 文本已验证不含该指纹串 |
| ③（MEDIUM）G3 增加探针显式单跑 + 29 passed 证据（防 passWithNoTests 静默） | ✅ | §6 新增 **G3a**（`pnpm exec vitest run … --passWithNoTests=false` → 断言 `Test Files 1 passed / Tests 29 passed`）；G3b 要求运行清单确认含探针文件；§3 新增 **D12**；§7 新增 R8；§8 步骤 7 改为 G1→G2→G3a→G3b 四步 | 复用仓内同威胁模型先例（CI persistence-contract / domains-scaffold 两步 `--passWithNoTests=false`）；改 CI 超出 ALLOW LIST，故纪律落 SA3 自验 + SA7 报告证据要求（D12 明文） |
| ④（MINOR）§1 证据命令缺 `-r` 不可重跑 | ✅ | §1 域 A 注记 | 改为 `grep -rn "validateSnapshot(" packages/vfsl/src/` 并写明命中集（仅 validate.ts:642 定义行 + index.ts:14 注释行），与 §12 git grep 命令同向可复核；另按 SA2 备注在 §1 头部加「总数随流程产物漂移，以逐文件清单为准」口径注记 |

---

## §10. 文件清单（File Scope）

### ALLOW LIST（本任务允许改动的文件；base = `ee3643c`，含 Phase 1 已 staged 产物）

**生产/测试/文档迁移（SA3 执行，§4 全规格）**
- `packages/vfsl/src/validate.ts` — 修改：def 行 + JSDoc 重写 + 4 处注释（≈15 行）
- `packages/vfsl/src/index.ts` — 修改：导出行 + 接缝行 + 4 处注释（≈10 行）
- `packages/vfsl/src/resolve.ts` — 修改：1 处注释
- `packages/vfsl/src/validate-patch.ts` — 修改：2 处注释
- `packages/vfsl/test/validate-snapshot.test.ts` — 修改：import + 全文符号替换（**不改文件名**，D4）
- `packages/vfsl/test/validate-snapshot-sa7.test.ts` — 修改：同上（不改文件名）
- `packages/vfsl/test/validate-patch.test.ts` — 修改：import + 2 调用 + 注释
- `packages/vfsl/test/validate-patch-sa7.test.ts` — 修改：import + 3 调用 + 注释
- `packages/vfsl/test/docscope-guards.test.ts` — 修改：import + 2 调用 + 标题
- `packages/vfsl/test/vfsl-assets-fullchain-e2e.test.ts` — 修改：import + 10 调用 + 注释
- `packages/vfsl/test/evaluate-derived-schema.test.ts` — 修改：仅 1 处 it 标题注释
- `packages/vfsl/package.json` — 修改：version 0.1.10 → 0.2.0（D7）
- `README.md` — 修改：3 处（L61/L65/L90）
- `apps/README.md` — 修改：1 处（L7）
- `docs/vfsl/v1-spec.md` — 修改：3 处（L20/L199/L480）

**SA6 owned（Phase 1 已落盘 staged，随本任务入库；本票内零改动——冻结于 D6/简报）**
- `packages/vfsl/test/validate-logical-snapshot.test.ts` — `[SA6 owned]` 红灯验收锚（29 条），已 staged 原样入库；本票任何 SA 不得改其断言（SA3/SA7 均无测试基础设施改动需求）
- `packages/vfsl/test/validate-logical-snapshot.contract.ts` — `[SA6 owned]` 共享行为断言集（27 条注册器），已 staged 原样入库，本票零改动；非 `*.test.ts` 不被 vitest 收集（`vitest.config.ts` include 实读核实）

**流程产物（pipeline-owned，各 SA 按相位落盘）**
- `wiki/raw/task_rename-validate-logical-snapshot.md`（简报，staged）
- `wiki/raw/task_rename-validate-logical-snapshot_relevant_decisions.md`（staged）
- `wiki/raw/task_rename-validate-logical-snapshot_conflict_report.md`（staged）
- `wiki/raw/task_rename-validate-logical-snapshot_dispatch.md`（staged）
- `wiki/raw/task_rename-validate-logical-snapshot_design.md`（本文件）
- 后续：`_sa2_review*.md` / `_sa4_review.md` / `_sa7_report.md` 等本任务前缀的评审产物

### DENY LIST（本任务任何 SA 不准动）
- `docs/adr/**` — 不可变决策记录（D5）
- `wiki/prd/**`、`wiki/raw/` 既有历史文件（非本任务前缀） — 审计轨迹（D5）
- `TASK.md` — mandate 副本（D5）
- `CONTEXT.md` — 术语契约已终态（D8）
- `.scratch/**`（含 `vfsl-v1-parser/spec.md`）、`.scratch-spec-20.md`、`.scratch-review-spec.md` — **R2 追加（D10）**：git 跟踪的 dated 工作草稿，域 D 豁免不迁移（draft→final 保真）；SA4 比对时此三文件不得出现在 actual diff
- `packages/vfsl/src/evaluate.ts` / `parser.ts` / `semantic.ts` / `tokenizer.ts` / `envelope.ts` / `schemasource.ts` / `derived.ts` / `ir.ts` / `pattern.ts` / `xml.ts` / `errors.ts` / `shapes.ts` — 本任务零接触（无旧名命中，实读核实）
- `packages/vfsl-protocol/**` / `packages/vfsl-codegen/**` / `packages/persistence/**` / `packages/dsh-persistence/**` — 零旧名命中（grep 实证），零接触
- `.github/workflows/ci.yml` / `vitest.config.ts` / `tsconfig*.json` / 根 `package.json` — 基础设施零接触（R2 注：D12 探针单跑纪律落自验/SA7 证据，不改 CI——CI 改动超出本任务半径）
- `domains/**` / `tests/**` — 零旧名命中，零接触

---

## §11. 协议假设依据 (Protocol Assumption Evidence)

**无协议级假设**：本设计仅涉及纯代码符号更名、注释/文档行文与版本号字段——不含 HTTP/WS 端点预期、端口/进程时序、跨进程资源生命周期、第三方库行为假设。

附注（工具链事实，非协议假设）：vitest 收集规则 `include: ['packages/*/test/**/*.test.ts', ...]` 与 `test: vitest run --typecheck`、`typecheck` 五包 tsc 链、CI `node:[20,24]` matrix——均于设计期实读文件核实（`vitest.config.ts` / 根 `package.json` scripts / `.github/workflows/ci.yml:18`），且因 D4 不改文件名，收集规则对本任务无敏感性。

---

## §12. 契约改动连锁审计 (Contract Change Caller Audit)

### 改动函数

| 函数 | 文件 | 改动前契约 | 改动后契约 |
|---|---|---|---|
| `validateSnapshot` → `validateLogicalSnapshot` | `packages/vfsl/src/validate.ts:642` | `(derived: DerivedSchema, snapshot: unknown) => ValidateResult`，同步纯函数不抛错 | **逐字同签名**，仅绑定名变更；无 throw/return/异步性/可空性变化 |

### Caller 清单（符号引用全集，grep 实证；生产 caller = 0，全部为导出面 + 测试面）

| Caller | 文件:行号 | 是否 await | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---|---|---|---|---|
| 包重导出 | `packages/vfsl/src/index.ts:73` | N/A（同步） | N/A | N/A | §4.2(a) 导出行替换——唯一生产面引用 |
| 行为测试 | `test/validate-snapshot.test.ts:28` import，全文约 70 调用 | 否（同步） | 否（不抛错契约） | N/A | §4.4 全字替换 |
| 补充测试 | `test/validate-snapshot-sa7.test.ts:8`，12 调用 | 否 | 否 | N/A | 同上 |
| 等价对照 | `test/validate-patch.test.ts:45`，L329/L516 | 否 | 否 | N/A | 同上 |
| 等价对照 | `test/validate-patch-sa7.test.ts:31`，L59/L68/L87 | 否 | 否 | N/A | 同上 |
| 缓存冻结对照 | `test/docscope-guards.test.ts:11`，L92 ×2 | 否 | 否 | N/A | 同上 |
| 全链编排 | `test/vfsl-assets-fullchain-e2e.test.ts:32`，10 调用 | 否 | 否 | N/A | 同上 |
| 动态探针（非静态 import） | `test/validate-logical-snapshot.test.ts:26` | 否 | 否 | N/A | **零改动**：命名空间取成员断言 `toBeUndefined`——探针存续依赖的恰是旧名消失（D6） |
| 注释域 | validate.ts L4/L70/L591/L648；index.ts L3/L14/L23/L35/L78；resolve.ts L5；validate-patch.ts L18/L564；evaluate-derived-schema.test.ts L593 | N/A | N/A | N/A | 全字替换（§4） |

### 风险评估

- **本改动类别**：名称绑定变更（删旧名导出 + 增新名导出），非 §1.5 五类行为性契约变化（无 return→throw、无 async 化、无 catch 语义变化、无可空性翻转）。
- **遗漏 caller 的代价**：静态 import 遗漏 → `tsc` TS2305 编译红 + vitest 加载失败——**必然显性失败，不存在静默漏网路径**（这是纯更名相对行为改动的结构性安全优势）。
- **抓全 caller 的方法**（SA4 复核用）：`git grep -n "\bvalidateSnapshot\b" -- 'packages/**/*.ts' 'apps/**' 'domains/**' 'tests/**'` → 除定义行、SA6 双文件白名单外应零命中。
- **半径结论**：caller 总数（符号级 8 文件）< 10，半径封闭于单包测试面 + 单行重导出——符合「契约变更应限制半径」纪律，无需反思改用新建函数方案（本任务 mandate 即更名）。
