# 设计 — task_issue-334（形状预算 T1：载体投影读取三参化与截断省略）

- **Role**：SA1（mabf-sa1），dispatch `sa-200d93bd-a79c-4ad8-82b7-12a74636a6ff`，phase design，iteration 0
- **Issue**：welltop-jim-wang/nomicore #334（parent PR #332 / ADR-0024；tracking issue #331）
- **输入**：任务简报 `wiki/raw/task_issue-334.md`（零评论）；SA8 冲突报告 `wiki/raw/task_issue-334_conflict_report.md`（verdict **clear**）；SA8 决策摘录 `wiki/raw/task_issue-334_relevant_decisions.md`；SA6 验收契约 `wiki/raw/task_issue-334_sa6_contract.md`（verdict **approve**）；ADR-0024（accepted，直接治理）；源码与既有测试锚（锚点见 §2）
- **产物**：本文件。本轮只做设计，不实现、不写验收测试、不提交
- **结论摘要**：采纳 SA6 §12.4/§12.5 已钉死的全部口径（零偏移），落成一份可直接实现的设计：**双结果类型 + 重载**（`ReadLogicalValueResult` 逐字不动 + 新 `ReadLogicalValueAtPathBudgetResult`）、**G0 → options 校验 → N0 → N1 → P1** 定序与 `READ_OPTIONS_INVALID` 失败分支、**单源贯通式预算递归**（`budget === null` 门控保证无 options 路径逐字节不变）。无阻塞。

---

## 1. 任务类型、目标与非目标

**任务类型**：Feature（能力缺口）——SA6 §0 已裁决非 Bug 根因修复。缺口 = 三参公共面 + 预算递归 + 截断事实通道在 HEAD 上整体不存在。

**目标**（简报 What-to-build，逐点对 ADR-0024 决策 1/2/3/6）：

1. `readLogicalValueAtPath(doc, path, options?)` 三参公共形态（`options` 类型层非可选、运行时容缺席/显式 `undefined` ≡ 无 options）；
2. `depth` / `maxChildrenPerNode` 预算在投影递归内生效——未展开分支零物化（不 `get`/不 `descriptor.value` 读值、不递归，只做类型分类与子槽计数读）；
3. 截断省略为值内唯一截断形态（键省略；depth/width 同形态）；`depth: 0` 骨架读（目标折叠为同形空容器 + 至多单条 depth 条目）；终态目标预算 no-op；
4. 截断事实（`path`/`kind`/`omitted`，`omitted` = 直接子项数）随预算读成功结果恒在场返回（`truncated` + `truncations`）；
5. options 为封闭形状，非法值（负数/非整数/非有限数/非对象/未知键/非 plain 宿主/accessor 键）响亮拒绝进新失败分支 `READ_OPTIONS_INVALID`；
6. 无 options 时行为逐字节不变（成功恰两键、失败单码 `PATH_NOT_ALLOWED`、投影输出深等）。

**非目标**（SA6 §1 范围裁定 + SA8 §2 范围纪律）：

- runtime `readData` 五键修订（决策 4，T2）；`resolveSchemaAtPath` 三参化与投影包装（决策 5，T3）；`DeepOptional` 类型面（决策 7，T4）；registry 文档负控正则与 docs/integration 形状注记（T5）；
- ADR-0008/0016 镜像修订节、CONTEXT「载体投影读取」词条补句（SA8 N-1/N-2，非阻塞 docs 债，非 T1 义务）；
- 字节预算、`maxTotalNodes`、条目携带子键列表、L2 `depthPerPath` 透传（ADR-0024 开放问题，v1 划出）；
- wire/协议/persistence/写路径/ValueSchema 零接触。

## 2. 当前行为与证据锚点（SA1 亲自核对）

| # | 事实 | 锚点 |
|---|---|---|
| 1 | 公共签名双参 `(doc, path)`，结果联合两态（`{ok:true,value}` \| `{ok:false,code:'PATH_NOT_ALLOWED',path,message?}`） | `packages/doc-runtime/src/read.ts:44-46,53-56` |
| 2 | 编排 = G0 形态守卫（`read.ts:60-62`）→ N0 `probeRoot`（`:65-68`，惰性建 ROOT）→ N1 导航循环（`:72-121`）→ P1 `projectValue`（`:123-127`）；全程顶层 try/catch = E100（`:128-134`） | `read.ts:57-135` |
| 3 | 投影双递归：`projectValue`（Yjs 容器分支 `projectYMap:367-377` / `projectYArray:380-390`）+ `copyPlainStrict`（plain 域，non-finite/数组 undefined/嵌套 Yjs/非 plain 原型响亮失败，`:404-445`）——ADR-0024 决策 6 点名的两条路径；**无预算形参、无条件提前返回** | `read.ts:340-445` |
| 4 | 失败构造 `notAllowed`：path 新鲜回显副本（Proxy 敌意经 `safeSpreadPath:155-162` 收编回退 `[]`）；成功 `okUndefined()` 恰两键 | `read.ts:146-148,183-185` |
| 5 | 公共出口仅导出 `readLogicalValueAtPath` 值 + `ReadLogicalValueResult` 类型 | `packages/doc-runtime/src/index.ts:12-13` |
| 6 | 跨包单源派生：`type ReadLogicalValueFailure = Extract<ReadLogicalValueResult, { ok: false }>` → 进 `NamespaceRuntimeReadDataResult`；runtime `readData` 以 2 参调用并失败短路 | `packages/namespace-runtime/src/runtime.ts:119,484-486` |
| 7 | 键空间/段纪律助手在库：`readableOwnDataValue`（descriptor 读、零 accessor 执行，`read.ts:289-299`）、`readableArrayElement`（`:305-320`）、`isPlainRecord`（原型链级 plain 判据，`:213-228`）、`isNonNegInt`（`:190-192`） | 同左 |
| 8 | 预算面全仓零命中（`maxChildrenPerNode`/`READ_OPTIONS_INVALID`/`truncations`/`TruncationEntry`/`DeepOptional` 全仓 `*.ts` grep 0 hits）——全新落地面 | SA6 §4 基线形状事实；SA1 复核 grep 一致 |
| 9 | 冻结回归锚在库且全绿（HEAD 基线 24 文件/374 tests + tsc exit 0）：`read-logical-value-at-path-schema-independent.test.ts`（33）、`…guards.test.ts`（39）、`public-surface-guard.test.ts`（3）、类型锚 `…schema-independent.test-d.ts`（4）、`public-surface-type-guard.test-d.ts` | SA6 §4；测试文件在 `packages/doc-runtime/test/` |
| 10 | 测试入口：根 `vitest.config.ts` include `packages/*/test/**/*.test.ts`；typecheck include `packages/*/test/**/*.test-d.ts`（`tsconfig.typecheck.json`） | `vitest.config.ts` |
| 11 | 运行时/类型缺口实证：第三参 TS2554 ×2 + 运行时静默忽略（预算无操作、非法 options 静默接受、成功面恒两键、poison 哨兵必红） | SA6 §5.1/§5.2（probe 已清理，§16） |
| 12 | 载体计数事实：`Y.Map.size`/`keys()` 计入 undefined 值键（size=3 实证）；plain object `Object.keys` 含 accessor 键但投影不产出；现行 2 参拒绝路径会惰性建 ROOT（fresh doc `share.has('ROOT')` false → true） | SA6 §5.3 |

**状态机视角**：现读路径无持久状态机——同步纯函数、零模块级可变态（`read.ts` 头注 INV-R9/R10）、读取只观察调用瞬间已提交的 live Y.Doc（ADR-0008）。本设计不引入任何状态。

## 3. 能力缺口（根因链承接）

Feature 缺口链（SA6 §8，SA1 复核认可，无与源码矛盾处）：

1. 类型层：公共签名无第三参（事实 #1，TS2554 实证）；
2. 运行时：第三参被 JS 语义静默丢弃——预算零效果（SA6 §5.2 A2/B1/B2）；
3. 无 options 校验分支——非法值全部静默接受（SA6 §5.2 B3）；
4. 无截断事实通道——带 options 成功面仍恰两键；
5. **最深缺口**：`projectYMap`/`projectYArray`/`copyPlainStrict` 对每个子项无条件 `get`/`descriptor.value` + 递归（`read.ts:367-390,404-445`）——「未展开分支零物化」不可达；且无「raw 直接子项数」读取通道，`omitted` 口径无处产出；
6. 放大因素：不传预算时成本 O(目标子树)（ADR-0024 背景）；T2 组合面需要本切片提供截断事实。

## 4. Owner 要求落实

| Comment ID | Updated at | Requirement | Design section |
|---|---|---|---|

（任务简报 §Comments：REST 读评论成功、**零评论**（comment IDs: none）——无 Owner override 需要应用。全部需求来自 Issue 正文 AC1–AC5 + ADR-0024（accepted）。）

## 5. 复现和根因承接

| 上游事实 | 证据位置 | 设计响应 |
|---|---|---|
| 能力缺口运行时 + 类型层双面实证，3 次重复 sha256 一致 | SA6 §5/§7 | §7/§8 设计直击缺口 5（递归贯通预算 + 子槽数读取通道）与缺口 1–4（签名/校验/通道） |
| 基线全绿（doc-runtime 374 tests + tsc exit 0；冻结读锚 75 tests） | SA6 §4 | §7.4 兼容策略以既有锚为逐字节回归基座；ALLOW LIST 不含任何既有锚 |
| `Y.Map.size` 计入 undefined 值键（size=3 实证） | SA6 §5.3 X6 | §7.3 raw 计数口径：`omitted`（depth）= raw 直接子槽数（Y.Map `size` / Y.Array `length` / plain array `length` / plain object own enumerable **data** 键数） |
| 现行失败读会惰性建 ROOT（fresh doc `share.has('ROOT')` false→true） | SA6 §5.3 | §7.2 V2 零 doc 触碰锚有判别力：非法 options 在 N0 之前短路 → `share.has('ROOT')` 保持 false |
| 零物化哨兵今日必红（poison/sparse/detached/Y.Text 在预算边界应绕过却仍全量失败） | SA6 §5.2 A2、§9 X4 | §7.3 折叠/裁减边界禁值读与递归（B8）；§10 验收 S19/S20/S21 |
| 10k Y.Array 全量读 ~3ms；规模断言为形状断言非计时 | SA6 §7 | §10 S22（无计时门禁） |
| 现行 2 参调用全部在库（runtime.ts:484 等）；3 参调用无法编译（TS2554） | 事实 #6、SA6 §5.1 | §9 调用方影响矩阵：现存调用方零改动 |

上游事实与源码矛盾：**未发现**（SA1 逐项核对 `read.ts`/`index.ts`/`runtime.ts`/`vitest.config.ts` 与 SA6 引用一致）。

## 6. SA8 约束落实

| 决议或义务 | 设计位置 | 处理方式 | 是否需要设计后冲突复查 |
|---|---|---|---|
| §4 冻结面：无 options 两键成功形态 / 缺席吸收 / 零 throw / `PATH_NOT_ALLOWED` 码域 / 终态语义 / 值域纪律 / ValueSchema 不扩展 / 公共面经 index.ts + surface guard / 越界零接触 | §7.4、§7.5、§11、§12 F1–F14 对应落点 | 逐项不变：2 参重载返回型 = 未改动联合；新码只进 budget 联合；index.ts 仅加类型导出；runtime/registry/wire 零 diff | 是（汇总，见 §14） |
| §8 D-1：doc-runtime 结果联合如何携带截断事实（三约束：AC2 可组合 / 无 options 逐字不变 / 新失败分支不借路径码） | §7.1（决议 A） | 双结果类型 + 重载，逐字采纳 SA6 §12.4 | 是（公共 API 面） |
| §8 D-2：options 校验失败边界（定序、零 throw/E100 覆盖、失败分支字段构成） | §7.2（决议 B） | G0 → options 校验 → N0 → N1 → P1；校验总函数绝不外抛；`{ok:false,code:'READ_OPTIONS_INVALID',path,message}` 逐字采纳 SA6 §12.5 V1–V6 | 是（新失败语义） |
| §8 D-3：实现后按 §4 冻结面逐项复查 | §10 E6/E7 | 设计验收映射预留证据位（`git diff --stat` 仅允许文件等） | 是（实现后） |
| §8 N-1/N-2（ADR-0008/0016 镜像节、CONTEXT 词条补句） | §11 DENY LIST + §13 | 非 T1 义务，明确禁改，登记为 follow-up | 否（docs 债已登记） |
| §10 requiresConflictRecheck=true | §14 | 设计维持 **true** | 是 |

SA8 裁决分布（implements-existing-decision ×5、no-conflict ×9、hard-conflict ×0）与本设计无触碰面冲突；ADR-0016 L74 / ADR-0008 L27 的修订前原文张力已由 ADR-0024 显式修订登记消解（SA8 §3），本设计按修订后决策集执行。

## 7. 设计决策与主要备选方案

四个核心决议（A–D），每个附否决备选。**全部与 SA6 §12.4/§12.5/§12.11 R1–R8/§12.3 B1–B15 零偏移**；本设计补充的是实现粒度（结构、参数线程、伪代码、字段构造点）。

### 7.1 决议 A：公共预算结果联合 = 双结果类型 + 重载（D-1 落形）

`read.ts` 新增三个类型（形状逐字采纳 SA6 §12.1）：

```ts
/** 预算读 options（封闭形状；exactOptionalPropertyTypes 下显式 depth:undefined 是编译错误，
 *  运行时按「键在场、值 undefined ≡ 缺席」容忍——R1/H11 口径）。 */
export interface ReadLogicalValueAtPathOptions {
  depth?: number;               // ≥0 有限整数；-0 ≡ 0（H10）
  maxChildrenPerNode?: number;  // ≥0 有限整数；-0 ≡ 0
}

/** 截断清单条目（ROOT 基绝对路径，与 path 实参同基）。 */
export interface ReadLogicalValueTruncationEntry {
  path: readonly (string | number)[];
  kind: 'depth' | 'width';
  omitted: number;              // ≥1；depth = 被折容器 raw 直接子项数；width = rawTotal - K
}

/** 三参（预算）读结果联合。 */
export type ReadLogicalValueAtPathBudgetResult =
  | { ok: true; value: unknown; truncated: boolean;
      truncations: readonly ReadLogicalValueTruncationEntry[] }
  | { ok: false; code: 'PATH_NOT_ALLOWED'; path: readonly (string | number)[]; message?: string }
  | { ok: false; code: 'READ_OPTIONS_INVALID'; path: readonly (string | number)[]; message: string };

// ReadLogicalValueResult 成员与语义逐字不变（T1 只加不改）——现状 read.ts:44-46 原样保留。
```

公共函数以**两条重载声明 + 一条实现签名**落形：

```ts
export function readLogicalValueAtPath(
  doc: Y.Doc, path: readonly (string | number)[],
): ReadLogicalValueResult;
export function readLogicalValueAtPath(
  doc: Y.Doc, path: readonly (string | number)[],
  options: ReadLogicalValueAtPathOptions,           // 形参非可选（T1-2/T1-5）
): ReadLogicalValueAtPathBudgetResult;
export function readLogicalValueAtPath(
  doc: Y.Doc, path: readonly (string | number)[],
  options?: ReadLogicalValueAtPathOptions,          // 实现签名：运行时容缺席/显式 undefined ≡ 无 options（R1）
): ReadLogicalValueResult | ReadLogicalValueAtPathBudgetResult;
```

类型面后果（全部满足 SA6 T1-1…T1-8）：

- 2 参调用静态返回型**恰为** `ReadLogicalValueResult`（重载 1；2 参不可能落重载 2——后者要求 3 参，T1-3）；
- 3 参合法对象调用静态返回型**恰为** `ReadLogicalValueAtPathBudgetResult`（重载 2）；
- 显式 `undefined` 第三参：`undefined` 不可赋给 `ReadLogicalValueAtPathOptions`（对象接口，strict 下不接受 undefined）且不匹配重载 1 → 编译错误（T1-5）；运行时经实现签名 `options?: …` 按「无 options」处理（S23）；
- 封闭形状：`{bogus:1}`（excess property）、`{depth:'1'}`、`{maxChildrenPerNode:null}`、`[]`（weak-type TS2559：与全可选目标零公共属性）、`42`、`null` 均编译错误（T1-4）；`{}`、`{depth:0}`、`{depth:-0}`、`{maxChildrenPerNode:0}` 合法；
- `runtime.ts:119` 的 `Extract<ReadLogicalValueResult,{ok:false}>` **输入类型未变** → `NamespaceRuntimeReadDataResult` 公共失败联合自动保持原状（T1 跨包零授权改动——SA6 §10 点名的决定性理由）。

预算读成功面**恰四键** `{ok, value, truncated, truncations}`（与 NC-6 的「无 options 恰两键」成对照；键序不承诺，断言用 hasOwn/键集合）。失败面：`PATH_NOT_ALLOWED` 成员沿用现行构造器产出（同一对象形状合法属两联合）；`READ_OPTIONS_INVALID` 成员见 §7.2 V5。

**否决备选**（SA6 §12.12，SA1 认可并补充实现侧理由）：

| 备选 | 否决理由 |
|---|---|
| 单联合加宽 `ReadLogicalValueResult`（新码 + 新成功成员） | 2 参静态型含不可能码；经 `runtime.ts:119` Extract 泄漏进 runtime 公共联合（跨包越界）；迫使 `schema-independent.test.ts:81-83`、`guards.test.ts:29-31`、`runtime-readdata-schema-projection-red.test.ts` 结构性别名全部改动（违反 F13） |
| 截断通道条件在场（有截断才带键） | 违反 ADR-0024 决策 3「恒在场」与 CONTEXT _Avoid_；消费方须靠 `in` 猜形状（S7/S15 锚） |
| 嵌套单键 `truncation:{truncated,entries}` | 与 T2 决策 4 词汇（`truncated`/`truncations` 平键）分叉，组合面多一层翻译 |
| 判别式「options 在场由运行时嗅探」无重载（单签名可选参） | 单签名 `options?` 下 2 参调用静态型含 budget 成员（含不可能的 `READ_OPTIONS_INVALID`），等于变相单联合加宽，泄漏同上 |

### 7.2 决议 B：options 校验失败边界与定序（D-2 落形）

**定序（V1，钉死）**：`G0 path 形态守卫 → options 校验 → N0 probeRoot → N1 导航 → P1 预算投影`。

- G0 优先：`read(doc, null, {depth:-1})` → `PATH_NOT_ALLOWED`（现行 G0 守卫锚不漂移，`read.ts:60-62` 前置不动）；
- options 校验插在 G0 早退之后、`probeRoot` 之前（最小 diff 位）；
- 两者都在 doc 触碰之前 → 非法 options 零 doc 触碰（V2）：新 doc `share.has('ROOT') === false`、既有 doc `update` 事件计数 +0（事实 #12 保证该锚对现行路径有判别力）。

**校验总函数**（`read.ts` 内部新增，非导出）：

```ts
type ValidatedBudget = { depth: number; maxChildrenPerNode: number };  // 见 §7.3 归一化
function validateReadOptions(raw: unknown):
  { ok: true; budget: ValidatedBudget } | { ok: false; msg: string }
```

判定序（内部序非契约——单错、message 仅为诊断）：

1. `raw === undefined` → 调用方不处理（缺席/显式 undefined 由实现签名短路，见 §7.4，不进本函数）；
2. 宿主判定：`typeof raw !== 'object' || raw === null || Array.isArray(raw)` → 非法；`Object.getPrototypeOf(raw)` ∉ {`Object.prototype`, `null`} → 非法（**严格宿主判据**：数组 / `new Date()` / `new Map()` / 类实例 / `Object.create({depth:1})` 自定义原型全拒——SA6 §12.2 R7。注意这与数据载体侧 `isPlainRecord`（`read.ts:213-228`，容忍 plain 中继原型链）**刻意不同**：options 是调用方控制面输入，封得更紧；数据 plain 判据是既有冻结面不动）；
3. 键空间枚举：`Object.keys(raw)`（own enumerable string 键；symbol/非 enumerable/继承键天然忽略——R8，D5 同源）；逐键 `Object.getOwnPropertyDescriptor`：
   - accessor（`get`/`set` 在场）→ 非法，**绝不执行**（descriptor 读本身零副作用，INV-R4 同源）；
   - 键 ∉ {`depth`, `maxChildrenPerNode`} → 非法（未知键，含值为 `undefined` 的未知键）；
   - 值 `=== undefined` → 该轴视为缺席（键在场值 undefined ≡ 缺席，§12.2「合法空对象」行）；
   - 否则必须 `typeof === 'number' && Number.isInteger && Number.isFinite && >= 0` → 任一不满足即非法（负数/非整数/`NaN`/`±Infinity`/`'0'`/`null`/`{}`/`1n`/`true`）；`-0` 全判真 → 合法 ≡ `0`（H10）；`2**53` 量级合法；
4. 归一化产出 `ValidatedBudget`（§7.3）。

**零 throw / 零副作用（V3）**：校验总函数体整体包内层 try/catch——`Object.keys`/`getOwnPropertyDescriptor`/`getPrototypeOf` 触发 Proxy trap 抛（`ownKeys`/`getOwnPropertyDescriptor`/`getPrototypeOf` trap 等）一律收编为 `{ok:false}`（策略 A，绝不外抛）；全程零 getter/setter 执行、零 options 变异（只读探测）。

**失败分支字段（V5）**：

```ts
function optionsInvalid(path: unknown, message: string): ReadLogicalValueAtPathBudgetResult {
  return { ok: false, code: 'READ_OPTIONS_INVALID', path: safeSpreadPath(path), message };
}
```

- `path` = path 实参**新鲜回显副本**（非数组 → `[]`；Proxy 敌意 → `safeSpreadPath` 收编）——与 `PATH_NOT_ALLOWED` 的 `path` 回显纪律及 E100 先例一致（`read.ts:146-148`；R5）；
- `message` 恒非空 string（诊断字段，非契约；建议携带违规键名/实际类型，措辞不锁定）；
- **不得**携带 `value`/`truncated`/`truncations`；
- 码字面量 `READ_OPTIONS_INVALID` 稳定；`code !== 'PATH_NOT_ALLOWED'`、不借 `RUNTIME_READ_DISABLED`（V6）。

**E100 兜底（V4）**：顶层 try/catch（E100，`read.ts:128-134`）原样保留，预算读路径同样被其覆盖；但 options 域缺陷**不得**经 E100 或 `PATH_NOT_ALLOWED` 出现（校验在 N0 前短路且自身零外抛，两通道不相交）。E100 在预算读下的返回仍是 `PATH_NOT_ALLOWED` 成员（DOCRT-E100 前缀 message）——budget 联合含该成员，形状合法；E100 只表示内部 bug。

**否决备选**：校验放 N0 之后（违反 V1/V2，且 ROOT 惰性创建破坏零触碰锚）；非法 options 借 `PATH_NOT_ALLOWED`/外抛（违反 F5/F4 与 ADR-0024 决策 1）；校验后置到投影递归内（同一 violation 会随导航深浅漂移，定序不可锚）。

### 7.3 决议 C：单源贯通式预算递归（零物化投影）

**结构原则（F10）**：预算**贯通**既有 `projectValue`/`projectYMap`/`projectYArray`/`copyPlainStrict` 双递归——不旁路、不复制第二条投影路径（ADR-0024 决策 6「不新增第二条读路径」、`read.ts` 头注 D6）。

**上下文线程**：四个投影函数签名各加三个尾参（仅 `read.ts` 内部，公共面无感知）：

```ts
interface ProjectionCtx {
  budget: ValidatedBudget | null;          // null = 无 options（legacy 模式）
  truncations: ReadLogicalValueTruncationEntry[];  // 调用级新鲜累加器（legacy 模式恒空、零写入）
}
// projectValue(v, ctx, d, p) / projectYMap(m, ctx, d, p) / projectYArray(a, ctx, d, p)
// / copyPlainStrict(v, loc, ctx, d, p)
//   d = v 的剩余可展开容器层数；p = v 的 ROOT 基绝对路径（两者仅在 ctx.budget !== null 时使用）
```

**归一化**：`ValidatedBudget = { depth: number; maxChildrenPerNode: number }`，缺席轴以 `Number.POSITIVE_INFINITY` 填充（`Infinity - 1 === Infinity`、`rawTotal > Infinity` 恒 false——depth/width 判定统一为纯算术，无双轴分支）。`Infinity` 只作内部哨兵，永不外泄（校验已拒非有限输入）。入口初值：`d₀ = budget.depth`，`p₀ = safeSpreadPath(path)`（目标节点自身即第一层容器，B1）。

**容器节点预算算法**（进入任一容器分支时，仅 budget 模式）：

```text
containerBudget(v, d, p):                       # v 已按载体分类为容器
  (rawTotal, slotSeq) = rawSlots(v)             # 见下表；零值读取、零 accessor 执行
  if d === 0:                                   # depth 耗尽（finite budget 才可能）
    if rawTotal >= 1: ctx.truncations.push({ path: p, kind: 'depth', omitted: rawTotal })
    return 同形空容器（{} / []，proto = Object.prototype）   # B3：不再记 width 条目；B4：空容器不记条目
  kept = min(rawTotal, budget.maxChildrenPerNode)
  if rawTotal > kept: ctx.truncations.push({ path: p, kind: 'width', omitted: rawTotal - kept })
  out = 同形新容器
  for slot in slotSeq 的前 kept 个槽位:          # 超出前缀的槽位一律不读（B8）
    child = 读该槽位（仅保留槽位允许 get/descriptor.value）
    if child 被吸收（Y.Map/plain obj 键值 undefined）: continue   # E1 不变；槽位仍占保留额度（B7）
    r = 递归投影(child, ctx, d - 1, [...p, slotKey])              # 容器子项耗一层；终态子项忽略 d（B1）
    if r 失败: 透传失败（fail-fast，与现行一致）
    out[slotKey] = r.v（putKey 四真 / push）
  return out
```

**raw 子槽数据源（B5/B8，钉死）**：

| 载体 | rawTotal | 槽位序列 | 允许的读 |
|---|---|---|---|
| `Y.Map` | `m.size`（O(1)，含 undefined 值键——事实 #12） | `m.keys()` 迭代器（插入序，**不承诺稳定**），取前 kept 后即断 | 前 kept 键 `m.get(k)`；其余零 `get` |
| `Y.Array` | `a.length` | 下标 `0..rawTotal-1` | 前 kept 下标 `a.get(i)`；其余零 `get` |
| plain array | `arr.length`（含空洞，S20） | 下标序 | 前 kept 下标 `readableArrayElement`；其余零 descriptor 读 |
| plain object | own enumerable **data** 键数（`Object.keys` + descriptor 过滤 accessor；undefined 值键**计入**——与 Y.Map raw 口径对齐，B5） | 该 data 键序列（`Object.keys` 序） | 前 kept 键 `readableOwnDataValue`；其余零值读 |

**折叠/裁减判定只按「是否容器」与 raw 子槽数**（B15）：容器 = `Y.Map` / `Y.Array` / plain array / `isPlainRecord` 命中的 plain object。**detached 判别不前置到折叠判定**——被折/被裁子项即便内含不可表示值、`Y.Text`、detached 载体也不在折叠处失败（S19 ④ / S20 ③）；只有被**展开/保留并物化**时才走现行响亮失败分支（`projectValue` 的 detached 守卫 `read.ts:341-345`、`copyPlainStrict` 的 non-finite/嵌套 Yjs/非 plain 原型分支原样生效，S21/NC-2）。

**终态与违规节点**：标量 / `Y.XmlFragment`（语义字符串）/ 被保留时的 `Y.Text`、未知 shared、nonPlainObject、值域违规——预算一律 no-op，走现行投影分支（B2；终态目标任何 depth/width 原样返回；被保留的不可表示值仍响亮失败——「no-op」指预算不改变终态行为，不是洗白值域）。**未被展开的终态/违规子项零接触**（零物化的组成部分）。

**条目路径构造**：`p` 为每层递归新鲜数组（`[...p, slotKey]`），创建后不变异、不跨调用共享；节点至多记一条条目（B3/B11）→ 条目 `path` 直接持有该层 `p`，天然满足 S27 新鲜性/身份互异与 B14 `(path,kind)` 唯一。条目顺序 = 遍历序，**不承诺稳定**（R6——测试按 `(path,kind)` 多重集断言）。

**不变量（B14）**：`truncated === (truncations.length > 0)`；条目 `omitted ≥ 1`（depth 条目仅 rawTotal ≥ 1 时记录；width 条目仅 rawTotal > K 时记录）。

**递归深度备注**：无 depth 预算的循环引用 plain 结构（`a.self = a`）与现行一致走 RangeError → E100（`read.ts` 头注 D10）；带 depth 预算时循环在层数边界被折叠 → 成功返回——这是预算的自然结果（折叠先于无限递归），非冻结面破坏（legacy 无 options 行为逐字节不变）。深层链式（数万层）栈行为属环境敏感观察项，不进门禁（SA6 §7/S22 注）。

**否决备选**：

| 备选 | 否决理由 |
|---|---|
| 先全量物化再裁剪 | 零物化哨兵必红（S19/S20；ADR-0024 验收节明文；契约禁止手法 1） |
| 复制一套平行的预算投影函数族 | 违反 F10「不新增第二条读路径」；两套递归漂移风险；冻结锚无法保护共享语义 |
| `omitted` 统计后代总数 | 需遍历被截子树，直接违背零物化（决策 1/3；S24 显式反证） |
| 在 `D:0` 子项位用 `{}`/`[]` 占位表达省略 | 决策 2 明文禁止（目标自身唯一例外）；S26 断言 `Object.hasOwn(value, cutKey) === false` |
| 折叠判定前置 detached/值域检查 | S19 ④/S20 ③ 必红（折叠处不允许触碰子项内部） |
| 宽度裁减先投影后删键 | 保留槽位外的子项仍被 `get`/递归（违反 B8）——裁减必须发生在槽位枚举层 |

### 7.4 决议 D：兼容策略（无 options 逐字节不变）

**运行时模式判别**：实现签名第三参 `options?: …`；`options === undefined`（缺席或显式 undefined，R1/S23）→ legacy 模式（`ctx.budget === null`）；否则进 §7.2 校验，合法 → budget 模式，非法 → `READ_OPTIONS_INVALID`。**无第三态**。

**legacy 逐字节不变的手段**（三重）：

1. **门控**：`projectValue`/`projectYMap`/`projectYArray`/`copyPlainStrict` 内新增逻辑全部以 `ctx.budget !== null` 为前置条件；legacy 模式下不构造 `p` 数组、不写 `truncations`、不做槽位预计数（容器循环结构保持现行「逐 keys/下标全量递归」原样）——控制流与输出和 HEAD 逐字节一致（新增形参不改变行为）；
2. **成功面构造模式化**：`okUndefined()` 与 P1 终点成功构造改为按 `ctx.budget` 分支——legacy 恰 `{ok, value}` 两键（F1/NC-6），budget 恰四键；失败构造 `notAllowed` 不变（形状同时合法属两联合）；
3. **静态面零变化**：`ReadLogicalValueResult` 成员逐字不动 → `runtime.ts:119` Extract 派生自动保持 → runtime/registry 公共类型与行为零 diff（F11）。

**既有调用方零改动**：现存全部调用为 2 参（3 参在 HEAD 不可编译——TS2554 实证），重载 1 精确承接；既有 5 个锚测试文件不改不改断言（F13）。

**公共导出面（F9/T1-6/T1-7）**：`index.ts` 仅加法：

```ts
export type {
  ReadLogicalValueAtPathOptions,
  ReadLogicalValueTruncationEntry,
  ReadLogicalValueAtPathBudgetResult,
} from './read.js';
```

零新增值导出（`public-surface-guard.test.ts` 原样绿——它只断言值导出面）；类型名目入 `public-surface-type-guard.test-d.ts` 加法导入锚。

**否决备选**：以 `Infinity` 预算统一两模式（无 `null` 门控）——观测面确实等价（4 键 face 差异另需模式位），但 legacy 热路径凭空承担槽位计数与路径数组分配，且「逐字节不变」的论证从「结构上门控关闭」退化为「数值上恰好无操作」，回归论证弱化——不取。

## 8. 接口、状态机与数据流

### 8.1 公共接口变化总表

| 名目 | 变化 | 导出面 |
|---|---|---|
| `readLogicalValueAtPath` | 加两条重载声明（2 参 → `ReadLogicalValueResult`；3 参必选 options → `ReadLogicalValueAtPathBudgetResult`）；实现签名内部化第三参 | 值导出不变（index.ts:12 原样） |
| `ReadLogicalValueResult` | **零变化** | index.ts:13 原样 |
| `ReadLogicalValueAtPathOptions` / `ReadLogicalValueTruncationEntry` / `ReadLogicalValueAtPathBudgetResult` | 新增类型（§7.1 形状） | index.ts 加法 `export type` |

内部（`read.ts` 非导出）新增：`validateReadOptions`、`ProjectionCtx`、`ValidatedBudget`、`optionsInvalid`、`containerBudget` 槽位枚举助手（如 `plainDataSlotKeys`）；`okUndefined`/P1 成功构造改 ctx 感知；`read.ts` 模块头注补预算语义段（D-预算/B1–B15 词汇，沿用现行头注风格）。

### 8.2 编排状态机（无持久状态；单次调用的阶段序）

```text
try {
  G0  path 非数组 → PATH_NOT_ALLOWED（现行锚不漂移）
  OPT options !== undefined → validateReadOptions：
        非法 → READ_OPTIONS_INVALID（零 doc 触碰，V1/V2/V3）
        合法 → ctx = { budget: 归一化, truncations: [] }
        缺席 → ctx = { budget: null, truncations: [] }
  N0  probeRoot（现行原样；ROOT 非 Y.Map → PATH_NOT_ALLOWED）
  N1  导航循环（现行原样——预算盲，B13：段纪律/载体分类/失败分类/缺席吸收不受 options 影响；
      吸收早退经 okUndefined(ctx) 按 2 键/4 键出）
  P1  projectValue(cur, ctx, d₀ = ctx.budget?.depth ?? ∞, p₀ = safeSpreadPath(path))
        legacy：与 HEAD 逐字节一致
        budget：§7.3 容器预算算法；失败 fail-fast 透传
      成功 → ctx.budget === null ? {ok,value} : {ok,value,truncated,truncations}
} catch (err) { E100 → notAllowed(path, 'DOCRT-E100: …')（现行原样；两联合共有该成员形状，V4） }
```

### 8.3 数据流路线

| 路线 | 触发者与输入 | 写入或创建点 | 转换与边界 | 存储或传输 | 读取或投影点 | 可观察结果 | 错误与清理 | 验收锚 |
|---|---|---|---|---|---|---|---|---|
| R1 无 options 读（不变） | 调用方 2 参 `(doc, path)` | 无写入（INV-R9：零写零事件；N0 缺席惰性建空 ROOT 为现行既有行为） | G0→N0→N1→P1 现行链 | 无（进程内同步纯函数，无缓存/memo/订阅） | `projectValue`/`copyPlainStrict` 全量投影 | 恰两键成功 / `PATH_NOT_ALLOWED` | E100 兜底；无清理责任 | S1/NC-3/NC-6、既有 75 tests |
| R2 预算读（新） | 调用方 3 参 `(doc, path, options)` | 调用级新鲜对象：`ctx.truncations` 数组、每层 `p` 路径数组、条目对象、输出容器（putKey 四真，不 freeze） | 校验（零 doc 触碰）→ 导航（预算盲）→ 预算投影（槽位前缀保留 + 层数折叠；被折/被裁槽位零值读零递归） | 无（同上；全部调用局部，调用结束即可回收，无模块级驻留） | 同一 `projectValue`/`copyPlainStrict` 贯通递归 | 恰四键成功（`truncated === truncations.length>0`）/ `PATH_NOT_ALLOWED` / `READ_OPTIONS_INVALID` | fail-fast 单错透传；E100 兜底；无清理责任 | S2–S27、NC-1/2/4/5/7 |
| R3 非法 options（新） | 调用方 3 参，options 违规 | 仅失败结果对象（path 新鲜副本） | G0 后、N0 前短路；探测全程零副作用零外抛 | 无 | 无投影发生 | `READ_OPTIONS_INVALID` + path 回显 + 非空 message；doc `share.has('ROOT')` 不变 | 无清理（本来零触碰） | §12.2 矩阵、V2/V3 守卫测试 |
| R4 下游组合（T2，非本切片） | runtime `readData` | — | 消费 `value`+`truncated`+`truncations` 机械组合五键 | — | — | — | — | SA6 §12.4 表 1 行 1 |

跨模块/跨进程/跨持久化边界：**无新增**。本切片不产生任何存储、网络、缓存或生命周期数据；唯一「创建」是调用局部的返回值与截断条目（F14：清单随调用新鲜构造，模块级零可变态）。

## 9. 错误、恢复、并发与幂等 + 调用方影响

**错误面汇总**：

| 失败类别 | 码 | path | 触发点 | 零 throw |
|---|---|---|---|---|
| 路径/载体缺陷（现行全部类别：段型不符、空洞、终态下钻、detached、值域违规、敌意 path） | `PATH_NOT_ALLOWED` | 新鲜回显 | G0/N0/N1/P1（与 HEAD 一致；预算不掩盖——NC-4） | 是（E100 兜底） |
| options 域缺陷 | `READ_OPTIONS_INVALID` | 新鲜回显（非数组 → `[]`） | 仅 OPT 阶段（N0 前） | 是（校验内层 try 收编） |
| 内部 bug | `PATH_NOT_ALLOWED` + `DOCRT-E100` message | `safeSpreadPath` | 顶层 catch | 是 |

**恢复/重试**：同步纯读，无重试语义；调用方可修正 options 后原地重试（确定性：同 doc 状态 + 同输入 → 深等结果）。

**并发与幂等**：无共享可变态（INV-R9/R10 延续：`truncations` 为调用局部）；并发调用互不干扰；重复调用深等、身份互异（S27）；读取只观察调用瞬间已提交 live Y.Doc（ADR-0008），无订阅无回调。

**资源所有权**：返回 value/条目/path 数组全部归调用方所有（可变、与 live doc 解耦、不 freeze——F7/S21）；doc 零写零事件（INV-R9），N0 惰性建 ROOT 为现行既有行为（仅合法读路径，非法 options 路径零触碰）。

**调用方影响矩阵**：

| 调用方 | 当前处理 | 设计后处理 | 所需改动 | 证据 |
|---|---|---|---|---|
| `packages/namespace-runtime/src/runtime.ts:484` `readData`（唯一直接生产消费方） | 2 参调用；失败短路；成功恰三键组合 | 静态型与运行时行为逐字节不变（重载 1 精确承接；Extract 输入未变） | **零改动** | runtime.ts:119,484-486；SA6 §10 跨包耦合点 |
| registry lease `readData` 透传（间接） | 透传 runtime 面 | 不变 | 零改动 | ADR-0024 决策 6（registry 原样透传） |
| doc-runtime 既有测试 5 锚（schema-independent/guards/public-surface-guard/两个 test-d） | 2 参断言 | 原样全绿（不改断言，F13） | **禁止改动**（DENY LIST） | 事实 #9 |
| namespace-runtime 负控 `runtime-readdata-schema-projection-control.test.ts` | 「成功恰两键」负控 | 原样绿（2 参路径未动） | 零改动 | 该文件头注 §1 |
| 其他 doc-runtime 内部引用（sa7-fatal、transaction-fatal、create-initial-document、xml-attr-quote 测试） | 2 参调用 | 不变 | 零改动 | grep 清单（§2 事实 #6 同源） |
| T2 runtime 组合面（未来） | — | 机械消费 budget 四键成功面 | 后续切片 | SA6 §12.4 表 |
| L2 工具（仓外） | — | 范围外 | — | ADR-0024 开放问题 |

无未覆盖调用方：全仓 `readLogicalValueAtPath` 引用已枚举（§2 事实 #6 grep + vfsl/src/index.ts:86 为注释）。

## 10. 验收与验证映射

设计不写测试；下列为实施阶段必须成立的证据映射（SA6 §12 场景编号沿用；E1–E10 为 SA6 §12.10 完成判据）。

| 需求或风险 | 现有证据 | 所需行为测试或动态场景 | 预期观察 |
|---|---|---|---|
| AC1 预算递归截断省略结果正确（depth/width 各形态、depth:0 骨架、终态 no-op） | 无（缺口，SA6 §5.2） | `read-logical-value-at-path-shape-budget.test.ts`：S2–S15、S24、S25（F-CANON 夹具） | 值形状/条目 `(path,kind,omitted)` 多重集逐条相等；S24 显式 `omitted !== 后代总数` |
| AC2 截断事实随结果返回可供 runtime 组合 | 无 | S2/S4/S7/S14（`truncated`/`truncations` 恒在场；S7 空清单仍为数组） | budget 成功恰四键；`truncated === (truncations.length>0)` |
| AC3 零物化哨兵 | 缺口实证（poison 今日必红） | S19（depth）/S20（width）/S21 反证/NC-1/NC-2/NC-7 | 预算读 `ok:true`；预算覆盖到 poison 时 `PATH_NOT_ALLOWED`；退化实现（先物化再裁剪）红 |
| AC4 缺席吸收 + 敌意 path 纪律 + 非法 options 新分支 | 既有 75 tests（吸收/敌意）；非法分支缺失 | S16/S17/S18 + `…shape-budget-guards.test.ts`：§12.2 校验矩阵全类别 + V2（`share.has('ROOT')`/update 计数）+ V3（options 前后深等、accessor 副作用计数 0、Proxy trap 收编） | 吸收 = 4 键成功 value undefined；路径缺陷仍 `PATH_NOT_ALLOWED` + 回显；非法 options 全部 `READ_OPTIONS_INVALID`、零 throw |
| AC5 无 options 逐字节回归 + 全套门禁 | 基线 374 绿 | 既有 5 锚**不修改**全绿（NC-3/NC-6）+ S1/S23 + E6/E7/E8（`git diff --stat` 仅允许文件、index.ts 仅类型导出、doc-runtime tsc exit 0、root `pnpm typecheck`/`pnpm test`） | 2 参恰两键；显式 undefined ≡ 缺席；越界零 diff |
| 类型面（T1-1…T1-8） | 类型锚 4 tests 在库 | `…shape-budget.test-d.ts` TD1–TD6 + `public-surface-type-guard.test-d.ts` 加法导入锚 | 重载解析、封闭形状负例、显式 undefined 拒绝、新名目可导入 |
| 规模形状（不计时） | 10k 夹具可行（~3ms） | S22 | `value.length===5`/omitted 9995 等；无计时断言 |
| 隔离/新鲜/幂等 | — | S27 | 深等但身份互异；突变返回值/实参不影响后续读 |
| 变异敏感 | — | E5 m1–m6（施加变异 → 红 → 还原 → 绿，逐条记录） | 忽略 options/先物化后裁/后代计数/条件在场/`truncated` 恒 false/借路径码——各自被对应锚击杀 |
| 红→绿节奏 | SA6 §13 | E1（HEAD 红根因 = TS2554 + 目标行为断言）→ E2（全绿）→ E3（NC-1…NC-7） | 红必须是缺口本身，非环境错误 |

runner 事实：根 `vitest.config.ts` include/typecheck include 均覆盖拟新增路径（SA6 §14 已实证临时探针被发现后删除）；无需配置改动。

## 11. 文件范围

### ALLOW LIST

| 路径 | 预期改动 | 原因 |
|---|---|---|
| `packages/doc-runtime/src/read.ts` | 新类型 ×3（§7.1）；两条重载声明 + 实现签名；`validateReadOptions`/`optionsInvalid`/`ProjectionCtx`/槽位枚举助手；`projectValue`/`projectYMap`/`projectYArray`/`copyPlainStrict` 加 ctx/d/p 尾参与 budget 门控；`okUndefined`/成功构造 ctx 感知；模块头注补预算段 | 全部设计落点（SA6 §10 允许面第一行） |
| `packages/doc-runtime/src/index.ts` | 加法 `export type { ReadLogicalValueAtPathOptions, ReadLogicalValueTruncationEntry, ReadLogicalValueAtPathBudgetResult }` | 公共面纪律 F9/T1-6（仅经 index.ts；零新值导出 T1-7） |
| `packages/doc-runtime/test/read-logical-value-at-path-shape-budget.test.ts`（新） | S1–S27 行为验收 | SA6 §12.9 |
| `packages/doc-runtime/test/read-logical-value-at-path-shape-budget.test-d.ts`（新） | TD1–TD6 类型验收 | SA6 §12.9 |
| `packages/doc-runtime/test/read-logical-value-at-path-shape-budget-guards.test.ts`（新） | §12.2 校验矩阵 + V2/V3 零触碰/零副作用 + 敌意 options | SA6 §12.9 |
| `packages/doc-runtime/test/public-surface-type-guard.test-d.ts` | **仅加法**：3 个新类型名目导入锚 | SA6 §12.9/T1-6 |

### DENY LIST

| 路径 | 与任务的关系 | 禁止修改原因 |
|---|---|---|
| `packages/doc-runtime/test/read-logical-value-at-path-schema-independent.test.ts` / `…test-d.ts` / `read-logical-value-at-path-guards.test.ts` / `public-surface-guard.test.ts` | 冻结回归锚 | F13/E4：无选项逐字节锚，不得修改且须全绿 |
| `packages/namespace-runtime/src/runtime.ts`（含 :119 Extract、:484 调用） | 唯一直接消费方 | F11：readData 三键形状/失败联合属 T2；零 diff 是跨包兼容证据 |
| `packages/namespace-runtime/**`、`packages/namespace-registry/**` 其余 | T2/T5 面 | 范围纪律（SA8 §2） |
| `packages/vfsl/**`、`packages/vfsl-protocol/**` | T3/T4 面（`resolveSchemaAtPath`/`DeepOptional`） | 同上；预算面全仓零命中为全新落地面 |
| `packages/doc-runtime/src/carrier.ts` / `extract.ts` / `materialize.ts` / `mutation.ts` / `replace.ts` / `fatal.ts` / `create-initial-document.ts` / `schema-replace.ts` | 只读非目标模块；`probeRoot`/`carrierOf` 原样消费 | 本设计零载体判定变化（分类读复用现状） |
| `docs/adr/0008-*`、`docs/adr/0016-*`、`docs/adr/0024-*`、`CONTEXT.md`、`docs/integration/**` | SA8 N-1/N-2 docs 债、T5 注记 | 非阻塞 docs 收口票/T 系列末切片，非 T1 义务（登记 §13） |
| `docs/protocols/**`、wire/复制面 | 零接触 | ADR-0024 影响包不含协议面 |
| 根 `vitest.config.ts` / `tsconfig*.json` / `package.json` | runner/构建配置 | 测试入口已实证覆盖新路径，零配置改动（SA6 §14） |

## 12. 风险、回滚和残余问题

**高风险路径与缓解**：

| 风险 | 等级 | 缓解 |
|---|---|---|
| legacy 路径逐字节回归（最高优先不变量） | 高 | §7.4 三重手段（null 门控/构造模式化/静态零变化）+ 既有 75 tests 冻结锚 + NC-3/NC-6 + E4；实现须保持现行语句原样、新增逻辑全部前置门控 |
| 跨包类型泄漏（`READ_OPTIONS_INVALID` 漏进 runtime 公共联合） | 高 | 决议 A 结构性排除（新码只进 budget 联合；`ReadLogicalValueResult` 逐字不动）；E6/E7 diff 证据 + runtime 负控原样绿 |
| 零物化被「保留槽位外仍 `get`」隐性破坏（如先取 `entries()` 再切片） | 高 | §7.3 槽位表钉死「前 kept 后断」；S19/S20 哨兵 + E5 m1/m2 变异击杀 |
| raw 计数口径混入投影键数（吸收/accessor 干扰） | 中 | B5 槽位表逐载体钉死；S12（Y.Map 现场序派生）/S24（直接 ≠ 后代）锚定 |
| Y.Map 键序不稳定导致测试脆断 | 中 | 契约不承诺序（R6/ADR 决策 1）：Y.Map 前缀期望由现场 `keys()` 派生（S12）；条目按多重集断言 |
| plain object 计数需 O(slots) descriptor 枚举（K 很小时仍线性于键数） | 低 | B8 明文允许子槽计数读（无值读/无递归）；预算承诺是零物化非零枚举；行为级断言不计时 |
| 循环引用 plain 结构 + depth 预算下成功返回（与 legacy E100 不同） | 低 | 预算的自然结果，非冻结面破坏（无 options 路径不变）；设计 §7.3 已成文 |
| message 措辞被误当契约 | 低 | V5 明示非契约字段；测试不断言精确文本 |

**回滚**：单切片加法——revert `read.ts` + `index.ts` 即恢复 HEAD 行为；新测试文件为加法可随之回退；无数据/协议/持久化迁移，无兼容层残留。

**任务内必要条件**（不得伪装为 follow-up）：AC1–AC5 全部证据（§10 表）+ E1–E10 + `packages/doc-runtime/AGENTS.md` 义务（root `pnpm typecheck` / `pnpm test`，公共类型变更时）。

**残余问题 / follow-up（明确非本任务）**：

1. T2：runtime `readData` 五键组合 + lease 透传（决策 4）；
2. T3：`resolveSchemaAtPath` 三参化 + 投影包装 + 两通道对齐（决策 5）；
3. T4：`DeepOptional` 协议类型面（决策 7）；
4. T5：registry 文档负控正则 + `docs/integration`「恰三键」注记修订；
5. N-1/N-2：ADR-0008/0016 镜像修订节、CONTEXT「载体投影读取」词条补三参句（docs 收口票）；
6. L2 `depthPerPath` 透传（ADR-0024 开放问题，范围外跟进）；
7. 发布：`@nomicore/doc-runtime` minor bump 随 T 系列收口统一处理（ADR-0024 决策 4 破坏面论据；T1 本身为纯加法，无破坏面）。

## 13. 评审修订映射

`wiki/raw/task_issue-334_sa2_review.md` 不存在（本 dispatch iteration 0，尚无评审输入）——无适用 finding。后续评审意见到达时按 dispatch 修订并在此表登记映射。

## 14. 是否需要设计后 ADR 冲突复查

**requiresConflictRecheck = true**。理由：

1. **公共 API 加性扩展**：`readLogicalValueAtPath` 签名三参化 + 新导出类型面 ×3（SA8 §10 判据「公共 API 变化」命中）；
2. **新失败语义分支**：`READ_OPTIONS_INVALID` 码 + 失败字段构成 + 定序（判据「新的失败语义」命中）；
3. SA8 §10 与 SA6 §15 均已置 true 并点名「设计产出后应运行 design 复查；实现触碰公共读取面后按 §4 冻结面逐项复查」（D-3）。

本设计**未偏离**任何已钉死口径：SA6 §12.11 R1–R8、§12.3 B1–B15、§12.5 V1–V6、§12.1 T1-1…T1-8 全部逐条采纳（映射见 §7 各小节与 §10）；设计粒度补充（Infinity 归一化、ctx 尾参线程、严格宿主判据与 `isPlainRecord` 的刻意分野、`p` 数组所有权不变式）均为实现手段，不改变任何契约可观测行为，不触碰 ADR 冻结面。实现后仍须按 SA8 §4 冻结面逐项复查（E6/E7）。

—— 设计结束 ——