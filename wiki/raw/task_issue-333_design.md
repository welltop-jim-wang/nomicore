# 实现设计 — issue #333（T0：readData 成功分支形状断言 helper 化 prefactor）

- 任务类型：**Refactor（纯测试重构，零行为变化、零产品代码/公共类型变化）**
- 上游契约：`wiki/raw/task_issue-333_sa6_contract.md`（verdict = approve，§12 契约条款 C1a/C1b/C2.1–C2.4/C3a–C3c）
- Issue：#333（Parent = PR #332 / ADR-0024-readdata-shape-budget）
- 仓库 / HEAD：`welltop-jim-wang/nomicore` @ `ba11f32`；worktree `/home/wangjian/nomicore-fix-issue-333`
- 设计角色：SA1（本文件）；无前序设计文件（首轮，原位新建）

---

## 1. 任务类型、目标与非目标

**目标**

1. 把 runtime 与 registry 两个测试树中 readData 成功分支「恰三键」形状的全部断言（SA6 实测 **27 处**：family A 深等字面量 24 处 + family B 整键集字面量 3 处）改写为经**统一共享 helper 模块**表达。
2. 把 SA6 盘点的 **9 处非断言形状制造点**（测试替身 `readData` 返回值）一并收敛为同一模块的**集中化形状构造**（AC1 括号条款「或等价的集中化形状构造」；SA6 §5/§15 留给设计显式确认——本设计确认收敛，理由见 §7.2）。
3. 断言语义零变化：改写前后对同一实现的判定一致，全套门禁绿（AC2 / C2.1–C2.4）。
4. 收敛门 `readdata-shape-assertion-consolidation-gate.test.ts` 从 2 红 / 18 绿 转 **20/20 绿**（C1a/C1b 归零）。
5. 使 T3（ADR-0024 决策 4：成功分支恰三键 → 恒五键）的破坏性形状修订**集中在一个 helper 模块**内完成。

**非目标**

- 不改任何 `packages/*/src/**`、`domains/**`、`apps/**`、`docs/**`、`package.json`（AC3 / C3a）。
- 不改任何公共类型导出面、wire/协议、持久化语义（`NamespaceRuntimeReadDataResult`、`ReadDataSchemaProjection` 等类型原样使用，仅 import）。
- 不改 ADR-0024 的文档负控正则与 docs/integration 形状注记（属 T3）。
- 不引入五键形状、不预演 T3 行为（T0 只做形状知识的集中化，三键语义原样保留）。
- 不动 doc-runtime 两键成功分支 `{ ok, value }`（ADR-0016 分层语义，SA6 §11 H4 已排除在作用域外）。
- 不动 `runtime-readdata-schema-projection-control.test.ts` 的加法兼容断言（`toMatchObject`/分字段——刻意保留的新旧形状双绿负控，C2.4）。

## 2. 当前行为与证据锚点

| # | 事实 | 锚点 |
|---|---|---|
| B1 | readData 成功分支恰三键 `{ ok: true, value, schema }`；`value` 键恒在场（值缺席为显式 `undefined`）；`schema` 为 `ReadDataSchemaProjection \| null`；失败分支不带 `schema` 键 | `packages/namespace-runtime/src/runtime.ts:474-487`（L486 成功字面量）；类型 `NamespaceRuntimeReadDataResult`（`runtime.ts:126-129`）；ADR-0016 |
| B2 | 27 处断言把该形状字面写死：family A 24 处（全部为正向 `toEqual`，无 `toStrictEqual`/取反），family B 3 处（`Object.keys(r).sort()` 深等三元素字符串数组） | SA6 契约 §5 分布表 + 附录 file:line 清单；本设计 §12 附表逐点核对 |
| B3 | 9 处形状制造点：5 个 typed stub 类（`ObservableRuntime`/`CountingRuntime`，`implements NamespaceRuntime`）+ `makeRuntime` 工厂默认 + 2 个内联 override + `makeMarkerRuntime`（返回 `any`） | `registry-idle.test.ts:242`、`registry-sa7-concurrency.test.ts:168`、`registry-sa7-hostile.test.ts:166`、`registry-sa7-rev1.test.ts:211`、`registry-shutdown.test.ts:190`、`registry-open.test.ts:184/804/858`、`registry-create.test.ts:381` |
| B4 | 两树无任何共享形状 helper（AST + grep 双证）；跨包测试相对 import 先例存在（runtime test → registry test 方向） | SA6 §8 步骤 4；`registry-phase5-bootstrap-reset-red.test.ts:75` 等 4 处 `import { waitDurableSnapshot } from '../../namespace-runtime/test/durable-snapshot-wait.js'` |
| B5 | 测试树类型检查入口：root `pnpm test` = `vitest run --typecheck`，typecheck 程序 `tsconfig.typecheck.json` include `packages/*/test/**/*.ts`（即新增 helper 与改写文件都进类型检查）；包级 `pnpm typecheck` 只覆盖 `src/**`（不受本任务影响） | `package.json` scripts、`vitest.config.ts`、`tsconfig.typecheck.json`、`packages/namespace-runtime/tsconfig.json` |
| B6 | SA6 验收仪器已在树（未跟踪）：AST 扫描器 + 收敛门（20 tests，当前 2 红/18 绿）。family A 命中条件 = 深等方法实参为含 `ok:true` 字面 + `schema` 键的对象字面量；family B 命中条件 = 实参为恰三元素字符串数组字面量且主语含 `Object.keys`/`Reflect.ownKeys`。**实参为标识符/构造调用/CallExpression 时不命中**（负样本 5/6 明示放行） | `packages/namespace-runtime/test/helpers/readdata-shape-assertion-scan.ts` L14-41/132-195；gate 负样本 L154-159 |
| B7 | 基线全绿：聚焦 14 文件 189 tests、type-d 3 文件 5 tests、root typecheck exit 0、全量 338 文件/3588 tests | SA6 契约 §4/§13/§13.1 |

## 3. 根因或能力缺口

（承接 SA6 §8，不重复复现）最深根因：两个测试树**缺少「成功形状」的单点断言/构造面**——27 处断言各自字面写死恰三键形状，9 处替身/工厂各自重造形状（7 类 stub）。后果：ADR-0024 决策 4 的五键破坏性修订（ADR-0024 L60/L69「既有『恰三键』形状锚、深等断言……全线修订」）将击穿全部 36 处（SA6 M1/M2 实测 24 处被独立击穿，其余同文件同测试体/同字面量同源敏感）。T0 的交付即补上这个单点面：**一个共享 helper 模块、三个职责分明的导出**（断言 / 键集断言 / 形状构造）。

## 4. Owner 要求落实

| Comment ID | Updated at | Requirement | Design section |
|---|---|---|---|
| （无适用评论） | — | dispatch 记录：REST comment read 返回空数组；SA6 契约 §2 同证 | 无映射项；本设计仅承接 Issue 正文 AC1–AC3 与 SA6 契约 |

## 5. 复现和根因承接

| 上游事实 | 证据位置 | 设计响应 |
|---|---|---|
| 结构性缺口稳定复现：27 处断言字面写死（family A 24 / family B 3），门 2 红/18 绿，5/5 确定性 | SA6 §5/§7/§13-E5 | §8 逐点改写表（27/27 收敛）；改写形态按 §8.3 门兼容证明选取 |
| family B 与 family A 同属 T3 击穿半径（M1a `red:102` 红、M1b `docs-sync:143` 红） | SA6 §9 M1/§11 H5 | **确认 C1b 纳入硬门**（设计裁定不放宽）：family B 3 处经 `expectReadDataOkKeys` 收敛（§8.2） |
| 9 处形状制造点为报告项、非门项；是否收敛留给设计 | SA6 §5/§15 | **设计裁定：收敛**（§7.2），经 `readDataOk` 构造；门不受影响（C1 只约束断言） |
| M1（生产 `runtime.ts:486` 追加两键）→ 5+1 tests 红；M2（替身追加两键）→ 19 tests 红 | SA6 §9 | 改写后敏感性保持的机制性论证（§7.3 反伪绿不变量 + §11 验收映射 C2.3） |
| S1 收敛模拟：`shapedOk` 构造调用 + 共享常量过门，计数 24→21、3→2，自控全绿 | SA6 §9 S1 | 证明「helper/构造形态」可过门；本设计形态与之同族且更严（标识符实参，§8.3） |
| 反向边界：`projection-control` 加法兼容断言、`red` 的 `readOk` 窄接口与分字段断言不得降级 | SA6 §10/§12 C2.4 | DENY LIST 明列（§10.2）；改写表只动列出的 27 行 + 9 处构造 |
| 全仓对照：三键成功形状断言只在 runtime/registry 两树；doc-runtime 两键不命中 | SA6 §5/§11 H4 | 作用域即两树（同门 `SHAPE_ASSERTION_SCOPE`）；helper 只服务两树 |

## 6. SA8 约束落实

SA8 产物（`task_issue-333_relevant_decisions.md` / `_conflict_report.md`）**不存在**（SA6 §1/§3 同证）。按下述替代权威推导：

| 决议或义务 | 设计位置 | 处理方式 | 是否需要设计后冲突复查 |
|---|---|---|---|
| ADR-0016（成功分支恰三键现状契约） | §8.2 helper 语义 | T0 逐点保留三键全等语义（`toStrictEqual` 三键期望）；不引入任何新键 | 否（不修订决策，仅锚定现状） |
| ADR-0024 决策 4（恰三键 → 恒五键，破坏面全线修订） | §7/§8.5 T3 演化钩子 | T0 是该修订的前置 reducer：把 36 处形状知识集中到一个模块；五键本体属 T3，本任务零预演 | 否（执行已决策事项的前置，不改决策） |
| `packages/namespace-runtime/AGENTS.md`（公共面只暴露 detached 投影；测试 seam 不外泄） | §10 文件范围 | 只动 `test/**`；helper 为测试树内部模块，不进 `src/`、不进公共导出面 | 否 |
| `packages/namespace-registry/AGENTS.md`（公共 API 只经 `src/index.ts`；test 控制留在 testing 面） | §10 文件范围 | 不动 registry `src/**` 与 `testing.ts`；registry 测试经既有跨包相对 import 先例消费 runtime 测试 helper（B4 先例 ×4） | 否 |
| SA6 契约 C1–C3（验收条款） | §11 验收映射 | 全量承接（含 C2.3 突变重跑、C3a 范围门、C3b 锚） | 否 |

## 7. 设计决策与主要备选方案

### 7.1 选定方案：单一 helper 模块 + 三导出（断言/键集/构造 两面分离）

新模块 **`packages/namespace-runtime/test/helpers/readdata-ok-shape.ts`**（非 `.test.ts`，vitest 不收集——同 `readdata-schema-projection-fixture.ts`、`durable-snapshot-wait.ts` 先例）：

```ts
/**
 * issue #333（T0）：readData 成功分支「恰三键」形状的统一断言/构造面。
 *
 * 形状权威：ADR-0016（{ ok: true, value, schema }，value 键恒在场、缺席为显式
 * undefined；schema 为 ReadDataSchemaProjection | null）；T3（ADR-0024 决策 4）
 * 将在本模块内把形状修订为恒五键——所有调用站点不感知键集。
 *
 * ★ 反伪绿不变量（SA6 契约 C2.3 的结构前提）：`expectReadDataOk` 不得以任何方式
 *   从 `readDataOk` 派生其期望对象（反之亦然）。二者必须各自独立内联构造形状：
 *   替身/生产任一侧的形状突变（M1/M2）只应改变 actual 一侧，才能被断言面击穿。
 *   把两者合并为单一构造函数会让 M2 突变同时改写 actual 与 expected → 伪绿。
 */
import { expect } from 'vitest';
import type { ReadDataSchemaProjection } from '@nomicore/vfsl';

/** 成功分支恰三键键集（字母序——与既有键集断言的 .sort() 语义一致）。 */
export const READDATA_OK_KEYS = ['ok', 'schema', 'value'] as const;

/** 成功分支恰三键形状——`NamespaceRuntimeReadDataResult` 成功成员的精确同构
 *  （保持 typed stub 的 TS2322 类型锁：T3 接口加键时 stub 在此编译失败）。 */
export interface ReadDataOkShape {
  readonly ok: true;
  readonly value: unknown;
  readonly schema: ReadDataSchemaProjection | null;
}

/** 生产者侧：测试替身/工厂构造 readData 成功返回值（每次新鲜普通对象）。 */
export function readDataOk(value: unknown, schema: ReadDataSchemaProjection | null): ReadDataOkShape {
  const shape: ReadDataOkShape = { ok: true, value, schema };
  return shape;
}

/** 断言侧（family A 替换）：恰三键全等断言——多一键/少一键/ok 非真/value 或
 *  schema 不深等即失败；期望值独立内联构造（见文件头反伪绿不变量）。 */
export function expectReadDataOk(
  actual: unknown,
  expected: { value: unknown; schema: ReadDataSchemaProjection | null },
): void {
  const expectedShape: ReadDataOkShape = { ok: true, value: expected.value, schema: expected.schema };
  expect(actual).toStrictEqual(expectedShape);
}

/** 键集侧（family B 替换）：恰三键整键集断言（只断键集，不比较值）。 */
export function expectReadDataOkKeys(actual: object): void {
  expect(Object.keys(actual).sort()).toStrictEqual(READDATA_OK_KEYS);
}
```

要点：

- **实参用标识符 / 非深等调用形态**，三处均不触发门（§8.3 逐条证明）；helper 模块自身会出现在扫描器的**生产者报告清单**（2 处内联字面量）——这是报告项、非门项，且恰使 T3 的形状修改点对仪器可见。
- 断言面用 `toStrictEqual`（而非沿用原 `toEqual`）：三键键集、显式 `undefined` 的 `value` 键在场、原型/类型一致性都被真实断言（fail loud）；对当前实现的判定与 `toEqual` 逐点一致（§8.4 等价论证），严格性只增不减（C2.2「严格性不降」）。
- `expectReadDataOk` 期望参数用对象形态 `{ value, schema }`：调用站点自文档、与被替换字面量一一对应，显式 `undefined` 用例（hostile-guard L61）在站点可读。
- 键集常量独立定义，**不 import** SA6 扫描器的 `SUCCESS_SHAPE_KEYS`：验收仪器与持久测试基建分层（仪器可在 T0 后退役/演化，helper 不能依赖它）。

### 7.2 决策一：9 处形状制造点一并收敛（是）

理由：

1. **Issue 目的条款**「使后续 T3 的五键破坏性修订集中在一处完成，而不是百处散改」：T3 时替身必须同步返回五键（否则 registry 行为断言被更新后的 helper 击穿），若替身形状仍散在 7 个文件 9 处，T3 仍需逐处改——集中化目的落空。
2. **AC1 括号条款**「（或等价的集中化形状构造）」正是对构造侧的授权；SA6 §10 已把 9 处列入允许改动面（「可选 9 处形状制造点」）、§15 明示「若设计决定不收敛，门不阻塞」——即设计有权决定，本设计决定收敛。
3. **M2 敏感性可完整保留**：收敛后 M2 突变点从 9 处字面量变为 `readDataOk` 一处函数体；断言面期望独立构造（§7.1 不变量），actual（替身）变五键而 expected 仍三键 → 同类断言点照常变红，且 SA5 的 M2 重跑从「改 5 个文件」简化为「改 1 行」。
4. 改动机械且零行为差异：`readDataOk(v, s)` 每次返回新鲜普通对象 `{ ok: true, value: v, schema: s }`，与被替换字面量逐键等同；typed stub 的类型锁经 `ReadDataOkShape` 精确返回类型保留（B3 的 D7 注释随改写更新指向共享构造）。

代价与控制：变更集扩大 2 个只含制造点的文件（`registry-sa7-concurrency.test.ts`、`registry-shutdown.test.ts`）——均在 SA6 §10 允许面内，且 §11 验证映射把这两个套件加入必跑清单。

### 7.3 决策二：断言面与构造面必须是两个函数（反伪绿结构）

若断言期望与替身构造共用一个构造函数（`expect(x).toStrictEqual(readDataOk(v, s))` 且替身也 `return readDataOk(...)`），则 C2.3 的 M2（替身追加两键）只能落在共享构造函数上——actual 与 expected 同时变五键，断言全绿 = **伪绿，验收拒绝**。因此本设计：

- 断言面 `expectReadDataOk` 内部**独立内联**构造期望（hoisted 标识符过门）；
- 构造面 `readDataOk` 只服务生产者；
- 不变量写入模块头注（§7.1 代码块原文），由 SA5 的 C2.3 重跑强制执行。

### 7.4 主要备选方案（未选择，含原因）

| 备选 | 形态 | 未选择原因 |
|---|---|---|
| A1 构造函数单导出（断言站点 `expect(x).toStrictEqual(readDataOk(v,s))` + 替身同用） | 单函数 | 与 7.2/7.3 冲突：一旦替身收敛且共用构造，M2 必然伪绿（C2.3 拒绝）；且匹配器选择仍散在各站点，T3 的「一处」不完整。门负样本虽放行该形态，但形态合法 ≠ 契约可满足 |
| A2 仅断言 helper、9 处制造点不动 | 两面之一 | T3 仍需改 7 文件 9 处替身；issue 目的（集中一处）对构造侧落空；SA6 已精确盘点 9 处供本设计确认收敛 |
| A3 结构化分字段 helper（`ok===true` + 键集 + 分字段 deep-equal） | 无形状构造 | 判定粒度/失败消息形态偏离原「单一深等」语义，逐点等价论证更弱；其「期望与构造天然解耦」的优点已由两面分离达成 |
| A4 helper 放 registry 测试树或根 `tests/` | 位置 | readData 契约属 namespace-runtime（ADR-0016、类型导出于该包）；runtime→registry 方向的跨包测试 import 先例已存在（B4）；根 `tests/` 不在 vitest include 语义内且无先例 |
| A5 逐站点 hoisted 期望对象（各文件自建 `const expected = {...}`） | 无共享模块 | 形状知识仍散在 10 个文件，T3 逐处改——与 issue 目的正面冲突 |

### 7.5 决策三：family B 纳入（确认 C1b，不放宽）

SA6 §12 C1b 留了「若 SA8/设计裁定其不属于 T0，需显式决策放宽」的口子。本设计**确认纳入**：M1 已证 `red:102` 与 `docs-sync:143/154` 与 family A 同在 T3 五键击穿半径（键集字面量在五键下必红）；留散处则 T3 仍需逐处改键集字面量，违背「集中在一处」。3 处经 `expectReadDataOkKeys` 收敛；语义为「只断恰三键键集」（`Object.keys().sort()` 深等常量），与原断言逐点一致（字符串数组 `toStrictEqual` ≡ `toEqual`）。

## 8. 接口、状态机和数据流

### 8.1 调用站点改写规范

**runtime 侧 import**（2 个断言文件）：

```ts
import { expectReadDataOk, expectReadDataOkKeys } from './helpers/readdata-ok-shape.js';
```

**registry 侧 import**（8 个文件，相对路径先例同 B4）：

```ts
import { expectReadDataOk, expectReadDataOkKeys, readDataOk } from
  '../../namespace-runtime/test/helpers/readdata-ok-shape.js';
// 各文件按实际使用裁剪导出名；verbatimModuleSyntax 下类型导入一律 import type
```

**family A 统一改写式**（24 处）：

```ts
// 前
expect(<subject>).toEqual({ ok: true, value: <V>, schema: <S> });
// 后
expectReadDataOk(<subject>, { value: <V>, schema: <S> });
```

- `<subject>`/`<V>`/`<S>` 原样保留（含 hostile-guard L69 的四键投影体字面量、L61 的显式 `value: undefined`）；行尾原有注释保留。
- 唯一非 `{ ok, value, schema:null }` 形态的 L69：`expectReadDataOk(r, { value: 3, schema: { valueSchema: { kind: 'scalar', type: 'number' }, aliases: {}, docs: {}, aliasDocs: {} } })`——字面量经上下文类型直接可赋给 `ReadDataSchemaProjection`（`ValueSchema` 的 scalar 成员，`packages/vfsl/src/derived.ts:52`）。
- L61 后随的 `expect('schema' in (r as ...)).toBe(true)` 与 L69 后随的 `Object.isFrozen` 抽检**原样保留**（非 family A，不在收敛面内）。

**family B 统一改写式**（3 处）：

```ts
// 前
expect(Object.keys(<subject>).sort()).toEqual(['ok', 'schema', 'value']);
// 后
expectReadDataOkKeys(<subject>);
```

- `docs-sync-control` L143/154：同测试体内其余断言（`r1.ok` 检查、分字段值断言、`JSON.stringify(r1)).toContain('"schema"')`、投影体四键键集）**全部原样保留**。
- `red:102`：后续 `expect(r.schema).toBeDefined()` 等分字段断言与本文件的 `readOk` 窄接口、`oracle`、`PROJ` **全部原样保留**（C2.4）。

**生产者统一改写式**（9 处）：

```ts
// 类 stub（×5：registry-idle:242、sa7-concurrency:168、sa7-hostile:166、sa7-rev1:211、shutdown:190）
readData() {
  // typed stub（D7）：无 activeTools → schema:null 是诚实语义（缺键即 TS2322 类型锁——
  // 锁随形状移入 readData-ok-shape 的 ReadDataOkShape 精确返回类型）
  return readDataOk(this.marker, null);
}
// 工厂默认（registry-open:184）
readData: overrides.readData ?? (() => readDataOk('runtime-value', null)),
// 内联 override（registry-open:804/858）
readData: () => readDataOk('still-readable', null)   // / readDataOk('pre-p0-value', null)
// makeMarkerRuntime（registry-create:381，返回 any）
readData: () => readDataOk(marker, null),
```

### 8.2 断言语义契约（与 C2.2 逐条对应）

| C2.2 条款 | helper 实现 | 说明 |
|---|---|---|
| 1 `ok === true` | `toStrictEqual` 期望 `ok: true` | `ok:false`/`ok` 缺席即红 |
| 2 恰三键（多一键失败，T3 五键必击中） | 三键期望对象全等 | `toStrictEqual` 严查键集；无 `toMatchObject`/子集匹配 |
| 3 `value` 深等（含显式 `undefined` 键在场用例） | `value: expected.value` 写入期望对象（键恒在场） | `toStrictEqual` 检查 undefined 值键的在场性；real 实现恒写键（B1）→ 判定不变 |
| 4 `schema` 深等（`null` 与四键投影体） | 同上 | 23 处 `null` + 1 处投影体 |
| 5 `ok:false` 结果必须失败 | 全等失败（diff 显示 ok 分支差异） | 无静默通过路径 |

### 8.3 门兼容证明（新形态 vs 扫描器规则）

| 新形态 | family A 规则 | family B 规则 | 结论 |
|---|---|---|---|
| 站点 `expectReadDataOk(x, { value, schema })` | 非 `expect(...).<深等方法>` 调用（callee 是 Identifier）——扫描器只在深等 CallExpression 上判 | 同左 | 不命中 |
| helper 内 `expect(actual).toStrictEqual(expectedShape)` | 实参是 Identifier 非对象字面量 → `readObjectShape` null | 实参非数组字面量 → null | 不命中 |
| 站点 `expectReadDataOkKeys(r)` | 同第一行 | 同第一行 | 不命中 |
| helper 内 `expect(Object.keys(actual).sort()).toStrictEqual(READDATA_OK_KEYS)` | 主语含 `Object.keys` 但实参非对象字面量 | 实参是 Identifier 非三元素字符串数组字面量 | 不命中（双保险） |
| 生产者 `readDataOk(v, s)`（站点无字面量） | 不适用（生产者扫描为报告项） | 不适用 | 报告项从 9 处分散 → helper 模块内 2 处（`readDataOk`/`expectReadDataOk` 各一） |

与 SA6 §9 S1 的模拟结论一致（构造调用/共享常量过门），且本设计形态均为标识符实参，比 S1 的 CallExpression 实参更远离命中边界。门内 20 用例（含 7 正/8 负样本自控）不受树内文件增删影响：作用域覆盖断言下界 80（现 109，+1 helper 文件），4 个锚文件路径不变（内容改写不影响在场断言）。

### 8.4 `toStrictEqual` 替换 `toEqual` 的逐点等价论证

`toStrictEqual` 与 `toEqual` 的判定差异仅在：① undefined 值键的在场性；② 对象原型/类型（class）一致性；③稀疏数组与类型不 coercion 差异。逐点核对 24 处：

- 期望值类型：23 处 `{ value: <string|number>, schema: null }`、1 处 `{ value: 3, schema: <四键普通对象字面量> }`；actual 侧为 runtime/stub 构造的普通对象字面量（runtime.ts:486；§8.1 生产者），无 class 实例、无稀疏数组、无原型分歧 → ②③ 无差异。
- ① 仅作用于 hostile-guard L61（期望 `value: undefined`）：real 实现显式写键（B1）→ 两侧键均在场 → 判定相同（绿）。若某实现漏写 `value` 键，新形态红而旧 `toEqual` 绿——这正是 C2.2.3 要求的 fail loud（不变量缺失不得静默），非行为变化。
- 3 处 family B：字符串有序数组，`toStrictEqual` ≡ `toEqual`。

结论：对当前实现（及任何满足 B1 不变量的实现）改写前后判定一致；严格性只对「违反恰三键不变量的实现」增加（C2.2 明确要求的方向）。若实现/验证阶段发现某站点存在未预期原型差异（现有证据无），允许的设计内回退是把 helper 内匹配器降为 `toEqual`（仍满足 C2.2 全部五条——`toEqual` 同样严查多余键），**不允许**回退到 `toMatchObject` 或改站点局部匹配器；该回退须在实现报告中记录证据。

### 8.5 T3 演化钩子（非本任务交付，仅供后续引用）

T3 落地时只改本模块 + 各站点期望值语义（键集不感知）：`ReadDataOkShape` 与两个构造体加 `truncated`/`truncations`（`readDataOk` 带默认值、`expectReadDataOk` 期望参数加可选覆盖）、`READDATA_OK_KEYS` 扩五键；`expectReadDataOkKeys` 随之断五键。9 处替身站点与 24 处断言站点的**调用式不变**。SA6 §15 已记：T3 引入的四/五键字面量会被本门 family A 判红（family A 不限键数），family B 的三元素匹配届时需随 T3 扩展仪器——属 T3 作用域。

### 8.6 数据流路线

**无运行时数据流变化。** 依据：本任务不改任何 `src/**`，readData 的创建/读取/投影路径（runtime.ts:474-487）逐字节不变；改变的只有测试进程内的期望对象构造点与断言点：

| 路线 | 触发者与输入 | 写入或创建点 | 转换与边界 | 存储或传输 | 读取或投影点 | 可观察结果 | 错误与清理 | 验收锚点 |
|---|---|---|---|---|---|---|---|---|
| 断言期望（仅测试进程内存） | `expectReadDataOk(actual, {value, schema})` 调用 | helper 内联构造 `expectedShape`（新鲜普通对象） | 无跨模块/进程/持久化边界 | 无（vitest 进程内即弃） | `toStrictEqual` 单次比较 | 绿/红 + vitest diff（失败帧指向 helper，测试名定位站点） | 失败即 throw，由 vitest 捕获报告；无清理责任 | C2.1 套件全绿；C2.3 M1 红 |
| 替身形状构造（仅测试进程内存） | stub `readData()` / 工厂默认 / override | `readDataOk(v, s)` 返回新鲜普通对象 | 替身→registry→lease.readData 透传（既有路径不变） | 无 | 既有断言/registry 逻辑 | 与改写前逐键等同（§7.2） | 无 | C2.1 套件全绿；C2.3 M2 红 |
| 键集断言（仅测试进程内存） | `expectReadDataOkKeys(actual)` | 无构造（常量比较） | 无 | 无 | `Object.keys().sort()` 深等 | 绿/红 | 同断言期望行 | C2.1；C2.3 M1 红（red:102、docs-sync:143） |

## 9. 错误、恢复、并发和幂等

- **失败语义**：helper 失败 = vitest `toStrictEqual` 断言失败（throw + diff）。无吞错、无 fallback、无 try/catch；不改任何生产错误通道。
- **恢复/回滚**：纯测试树变更，单提交 revert 即完全回滚（门回到 2 红/18 绿的结构性缺口态）；无迁移、无持久化状态。
- **并发**：全部改写点为同步断言/同步构造，不涉计时器、IO、微任务排空语义；各测试文件原有并发原语（deferred gate、scheduler.advanceBy）不动。
- **幂等**：`readDataOk` 每次调用返回新鲜对象（无共享可变状态）；helper 无副作用。重复运行确定性成立。
- **路由豁免**：不需要 skip/only/todo/env override；门条款以「清单必须为空」表达（SA6 §12.3 已定，T0 不新增豁免）。

## 10. 文件范围

### 10.1 ALLOW LIST

| 路径 | 预期改动 | 原因 |
|---|---|---|
| `packages/namespace-runtime/test/helpers/readdata-ok-shape.ts` | **新增**共享 helper 模块（§7.1 全文） | AC1 统一断言/集中化构造面；两树共用的单点 |
| `packages/namespace-runtime/test/runtime-readdata-hostile-path-guard.test.ts` | 4 处 family A 改写（L38/53/61/69）+ import 行 | C1a |
| `packages/namespace-runtime/test/runtime-readdata-schema-projection-red.test.ts` | **仅** 1 处 family B 改写（L102）+ import 行；`readOk`/`oracle`/`PROJ`/分字段断言不动 | C1b + C2.4 |
| `packages/namespace-registry/test/readdata-docs-adr0016-sync-control.test.ts` | 2 处 family B 改写（L143/154）+ import 行；其余断言不动 | C1b + C2.4 |
| `packages/namespace-registry/test/registry-idle.test.ts` | 11 处 family A 改写（L480/505/536/616/712/765/801/908/972/1056/1095）+ 生产者 L242 + import 行 | C1a + §7.2 |
| `packages/namespace-registry/test/registry-create.test.ts` | 3 处 family A 改写（L517/1769/1770）+ 生产者 L381 + import 行 | C1a + §7.2 |
| `packages/namespace-registry/test/registry-open.test.ts` | 2 处 family A 改写（L816/880）+ 生产者 L184/804/858 + import 行 | C1a + §7.2 |
| `packages/namespace-registry/test/registry-sa7-rev1.test.ts` | 3 处 family A 改写（L547/624/687）+ 生产者 L211 + import 行 | C1a + §7.2 |
| `packages/namespace-registry/test/registry-sa7-hostile.test.ts` | 1 处 family A 改写（L423）+ 生产者 L166 + import 行 | C1a + §7.2 |
| `packages/namespace-registry/test/registry-sa7-concurrency.test.ts` | 生产者 L168 + import 行（无断言点） | §7.2（T3 集中化） |
| `packages/namespace-registry/test/registry-shutdown.test.ts` | 生产者 L190 + import 行（无断言点） | §7.2（T3 集中化） |

（SA6 的门 + 扫描器两文件已在树；T0 实现不修改它们。）

### 10.2 DENY LIST

| 路径 | 与任务的关系 | 禁止修改原因 |
|---|---|---|
| `packages/namespace-runtime/src/**`、`packages/namespace-registry/src/**` 及其余 `packages/*/src/**` | readData 实现/公共类型所在 | AC3/C3a：零产品代码/公共类型变化；`runtime.ts:486` 是 M1 突变探针的施加点，T0 必须保持 pristine |
| `packages/namespace-runtime/test/readdata-shape-assertion-consolidation-gate.test.ts`、`packages/namespace-runtime/test/helpers/readdata-shape-assertion-scan.ts` | SA6 验收仪器 | 门须因字面量消失而转绿，不得因改门而转绿（自证陷阱）；仪器属 SA6 交付面 |
| `packages/namespace-runtime/test/runtime-readdata-schema-projection-control.test.ts` | 加法兼容负控（`toMatchObject`/分字段） | C2.4：刻意保留新旧形状双绿；改写为全等会反向收紧并在 T3 被击穿 |
| `packages/*/test/*.test-d.ts`（`runtime-data-interface`、`runtime-readdata-schema-red`、`registry-readdata-schema-red`） | C3b 类型面锚 | 本任务无类型面变化；锚必须原样绿 |
| `docs/**`、`domains/**`、`apps/**`、各 `package.json` | 文档/schema/依赖面 | AC3/C3a；ADR-0024 文档负控正则属 T3 |
| `packages/doc-runtime/**` | 两键成功分支（ADR-0016 分层） | SA6 §11 H4：不在作用域，改写会破坏分层语义 |
| 其余 runtime/registry 测试文件（含 `readdata-docs-adr0016-sync-red.test.ts`、`readdata-docs-adr0016-contract-fixture.ts`、`readdata-schema-projection-fixture.ts`、`durable-snapshot-wait.ts`） | 无 family A/B/制造点命中 | SA6 全仓扫描已证无命中（§5）；无谓扩散变更集 |

## 11. 验收与验证映射

| 需求或风险 | 现有证据 | 所需行为测试或动态场景 | 预期观察 |
|---|---|---|---|
| AC1/C1a family A 归零 | 门红清单 24 处（SA6 §13-E5） | `npx vitest run --no-typecheck readdata-shape-assertion-consolidation`（T0 后） | 门 family A 用例绿；失败消息清单为空 |
| AC1/C1b family B 归零 | 门红清单 3 处 | 同上 | 门 family B 用例绿 |
| AC1 全量收敛（含 9 制造点） | SA6 §5 生产者盘点 | 生产者扫描输出（报告项）：站点字面量 9→0，helper 模块内 2 | 报告清单只含 `readdata-ok-shape.ts` 两处 |
| AC2/C2.1 行为零变化 | 基线 14 文件/189 tests 绿（SA6 §4） | 同命令重跑 C2.1 十文件 **+** `registry-sa7-concurrency`、`registry-shutdown` 两套件（制造点文件） | 全绿；改写前后判定一致 |
| C2.2 helper 判定语义 | §8.2/§8.4 论证 | C2.1 套件内显式 `undefined` 用例（hostile L61）、四键投影体用例（L69）、`ok:false` 用例（既有失败分支断言） | 三类用例均维持原判定 |
| C2.3 突变敏感性保持（反伪绿） | SA6 §9 M1（5+1 红）/M2（19 红） | SA5 重跑：M1 = `runtime.ts:486` 追加 `truncated:false, truncations:[]` 后跑 hostile-guard + red + docs-sync-control，再还原；M2 = `readDataOk` 函数体返回值追加同两键后跑 registry 五文件，再还原 | M1：hostile-guard 4 tests + red 1 test + docs-sync 1 test 红（键集/全等均击穿）；M2：≥19 tests 红（registry-idle 11、open 2、create 2、sa7-hostile 1、sa7-rev1 3 同类点）。**任一不红 = helper 被削弱，验收拒绝** |
| C2.4 反向边界 | 负控文件现状绿 | `projection-control` 套件重跑；diff 审查确认未改 | 绿；文件零 diff |
| AC3/C3a 零生产/公共类型变化 | SA6 §13-E6 先证 | `git diff --name-only <base>...HEAD \| grep -vE '^packages/(namespace-runtime\|namespace-registry)/test/'` 与 `git diff --name-only <base>...HEAD -- 'packages/*/src' 'domains' 'apps' 'docs'` | 两命令输出均为空 |
| AC3/C3b 公共面/类型面锚 | 基线绿（SA6 §4） | `runtime-public-surface-ownership`、`runtime-acceptance-exports-audit`、`runtime-registry-internal-seam`、`registry-surface` + `npx vitest run --typecheck`（3 个 test-d） | 全绿、`Type Errors: no errors` |
| AC3/C3c root 门禁 | 基线 exit 0（338/3588） | `pnpm typecheck`；`pnpm test` | 双绿（含门 20/20）；基线 338 文件不含门 → T0 后文件数 +0（门已在树）、tests +20 全绿 |
| 仪器自控不回归 | 门内 7 正/8 负样本绿 | 门运行自带 | 自控 18 用例绿 |

## 12. 风险、回滚和残余问题

| 风险 | 等级 | 缓解 |
|---|---|---|
| helper 内断言/构造耦合（`expectReadDataOk` 复用 `readDataOk`）导致 M2 伪绿 | 高（契约级） | 模块头注不变量（§7.1）+ C2.3 强制重跑（§11）；代码评审点 |
| `toStrictEqual` 收紧暴露未知原型/undefined 差异 | 低（§8.4 已逐点排除） | C2.1 重跑即捕获；设计内回退路径：helper 匹配器降 `toEqual`（仍满足 C2.2），须记录证据；禁止 `toMatchObject` |
| typed stub 类型锁弱化 | 低 | `readDataOk` 返回**精确** `ReadDataOkShape`（非联合、非 any）；T3 接口加键时 stub TS2322 编译失败 = 锁保留 |
| 改写时误动 C2.4 保护面（control 文件、red 的分字段结构） | 中 | DENY LIST + 逐行改写表（§8.1）；评审对照 SA6 附录 file:line |
| 遗漏站点（改写不全门仍红）或越界改写（误伤 toMatchObject 等） | 低 | 门/扫描器自动判定；family A 定义不含 `toMatchObject`，越界改写会被 C2.1 打红 |
| 门负样本假设漂移（新增测试文件被纳入扫描） | 低 | 作用域随 include 语义扩张是 AC1 期望行为（SA6 §7 边界） |

**任务内解决项**：27 断言 + 9 制造点全量收敛（无遗留）。
**明确 follow-up（不属本任务）**：T3 五键修订（改 helper 模块本体 + 门 family B 仪器扩展 + ADR-0024 文档负控正则）；T3 后 `readdata-shape-assertion-scan.ts` 对五键键集字面量的检测缺口（SA6 §15 已记）。

## 13. 评审修订映射

`wiki/raw/task_issue-333_sa2_review.md` 不存在（首轮设计，iteration 0）——无适用 finding。后续出现评审输入时按 skill 步骤 10 增补本节并原位修订全文。

## 14. 是否需要设计后 ADR 冲突复查

**不需要（`requiresConflictRecheck: false`）。** 理由：本设计零公共 API/协议/wire/schema/持久化/状态机语义变化；不触碰任何 ADR 冻结面；不修订任何既有决策（ADR-0016 现状被逐点保留，ADR-0024 决策 4 被执行前置准备而非改写）；不引入新生命周期所有权或失败语义（纯测试树内断言/构造收敛）。SA8 产物缺失已按 §6 以 ADR 原文 + 模块 AGENTS.md 边界替代锚定。

---

## 附：27 + 9 逐点改写清单（实现对照表；行号 = SA6 附录，改写后行号随 import 插入偏移）

| 文件:行 | 家族 | 前（摘要） | 后 |
|---|---|---|---|
| registry-idle:480/505/536/616/712/765/801/908/972/1056/1095 | A×11 | `expect(leaseN.readData(['x'])).toEqual({ ok: true, value: 'R1'\|'R2', schema: null })` | `expectReadDataOk(leaseN.readData(['x']), { value: 'R1'\|'R2', schema: null })` |
| runtime-hostile-path-guard:38/53 | A×2 | `expect(r).toEqual({ ok: true, value: 3, schema: null })` | `expectReadDataOk(r, { value: 3, schema: null })` |
| runtime-hostile-path-guard:61 | A×1 | `expect(r).toEqual({ ok: true, value: undefined, schema: null })` | `expectReadDataOk(r, { value: undefined, schema: null })`（后随 `'schema' in r` 断言保留） |
| runtime-hostile-path-guard:69 | A×1 | `expect(r).toEqual({ ok:true, value:3, schema:{ valueSchema:…, aliases:{}, docs:{}, aliasDocs:{} } })` | `expectReadDataOk(r, { value: 3, schema: { valueSchema: { kind: 'scalar', type: 'number' }, aliases: {}, docs: {}, aliasDocs: {} } })`（后随 `Object.isFrozen` 抽检保留） |
| registry-create:517/1769/1770 | A×3 | 同式（'MARKER_FACTORY' / 'RUNTIME_MARKER_9f'×2） | 同式改写 |
| registry-sa7-rev1:547/624/687 | A×3 | 同式（'R2'） | 同式改写 |
| registry-open:816/880 | A×2 | 同式（'still-readable' / 'pre-p0-value'） | 同式改写 |
| registry-sa7-hostile:423 | A×1 | 同式（'R-H3'） | 同式改写 |
| readdata-docs-adr0016-sync-control:143/154 | B×2 | `expect(Object.keys(r1\|r2).sort()).toEqual(['ok','schema','value'])` | `expectReadDataOkKeys(r1)` / `expectReadDataOkKeys(r2)` |
| runtime-readdata-schema-projection-red:102 | B×1 | `expect(Object.keys(r).sort()).toEqual(['ok','schema','value'])` | `expectReadDataOkKeys(r)` |
| registry-idle:242；sa7-concurrency:168；sa7-hostile:166；sa7-rev1:211；shutdown:190 | 生产者×5 | `return { ok: true as const, value: this.marker, schema: null }` | `return readDataOk(this.marker, null)`（D7 注释更新为指向共享构造的类型锁） |
| registry-open:184 | 生产者×1 | `overrides.readData ?? (() => ({ ok: true, value: 'runtime-value', schema: null }))` | `overrides.readData ?? (() => readDataOk('runtime-value', null))` |
| registry-open:804/858 | 生产者×2 | 内联 override 字面量（'still-readable'/'pre-p0-value'） | `readDataOk('still-readable', null)` / `readDataOk('pre-p0-value', null)` |
| registry-create:381 | 生产者×1 | `readData: () => ({ ok: true, value: marker, schema: null })` | `readData: () => readDataOk(marker, null)` |
