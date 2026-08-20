# SA1 设计 — vfs3.assets 全链路端到端编排测试（issue #32，Phase 0 收官）

- 任务类型：功能开发（Feature）——**纯测试票**（简报边界：「预期为纯测试票：不改 `packages/vfsl/src/`」）
- Worktree：`/home/wangjian/nomicore-fix-issue-32`（branch `fix/issue-32-on-adr-union-representation`，stacked on #17，base `705575b` 已含 validateSnapshot）
- 契约来源：简报 `wiki/raw/task_vfsl-assets-fullchain-e2e.md` + SA6 Phase 1 红灯测试记录（同文件末节）+ `docs/vfsl/v1-spec.md` §3/§10 + ADR 0003 + `CONTEXT.md` 术语
- SA1 设计依据：SA6 已落地的红灯测试 `packages/vfsl/test/vfsl-assets-fullchain-e2e.test.ts`（16 用例 / 4 describe，首跑 16/16 绿，全量 341/341，`pnpm typecheck` exit 0）
- R2 修订依据：SA2 R1 攻击评审 `wiki/raw/task_vfsl-assets-fullchain-e2e_sa2_review.md`（reject：攻击点 1 MEDIUM + 2/3 LOW）

## 修订记录

| 轮次 | 日期 | SA2 判决 | 修订摘要 |
|---|---|---|---|
| R1 | 2026-08-20 | reject（1 MEDIUM + 2 LOW） | 首版（commit `515d56e`） |
| R2 | 2026-08-20 | 待复审 | 按 SA2 三攻击点修订：§2.5 面 8 距离算术修正为 [1,5,7] + 补计数口径（攻击点 1）；§3 补面 5 与 #21:399 同构标注（攻击点 2）；§2.6 补非空断言豁免声明（攻击点 3，选项 (b)）；§8 假设 1 补实测命令与输出（SA2 建议）。**测试文件、断言、生产代码零改动** |

## §0. 结论速览

| 项 | 定论 |
|---|---|
| 唯一交付物 | `packages/vfsl/test/vfsl-assets-fullchain-e2e.test.ts`——单 fixture 驱动 parse → evaluate → validateSnapshot 三层串联的编排验收锚 |
| 生产代码改动 | **零**（不触 `packages/vfsl/src/`；Hard Gate #9 无需 bump 版本） |
| SA6 测试 vs 六项 AC 审计 | **全覆盖、零缺口、零偏离**（§4 对照表；SA1 逐条独立复核） |
| 全链路串联缺陷筛查 | **未暴露任何实现缺陷**（§5；简报「如串联暴露缺陷须回报总控」路径未触发） |
| fixture §10 对齐（AC5） | SA1 设计期实测 diff：仓内 **9 处整份 fixture 副本全部与 §10 逐字一致**（仅 TS 源码转义层差异），零修正 |
| 契约改动 / 协议假设 | 无契约改动（§9 声明式）；4 条工具链与转义假设全部附实测/源码/既有测试依据（§8） |
| SA3 实现半径 | 验收锚已绿且与设计一致——SA3 的实现职责收敛为「保持现状过 SA4/SA7」；R2 修订将 SA2 三攻击点全部以**设计文档**闭环，测试文件与断言**零改动**（见「SA2 反馈逐条回应」） |

## §1. 需求推演（Feature 切入点）

### 1.1 三层公共接缝现状（编排的地基）

Phase 0 已冻结三个公共导出（`packages/vfsl/src/index.ts:52-60` 接缝导出 + ADR 0003 §1 + issue #21 设计）：

```
parseVfsl(text)                      → { ok: true; module } | { ok: false; issues }  （#9，解析相位）
evaluate(module)                     → { ok: true; derived } | { ok: false; issues }  （#20，求值相位，ADR 0003 §1）
validateSnapshot(derived, snapshot)  → { ok: true } | { ok: false, issues }           （#21，校验相位）
```

三层均为同步、纯函数、不抛错（崩溃边界统一转 E100 结构化 issue）。派生 schema
（`src/derived.ts:69-84`）是 evaluate 与 validateSnapshot 之间的纯数据契约：
`aliases`（按名引用表）/ `structure`（root 包裹的结构树）/ `values`（值 schema）/
`index`（语法路径 → 条目）/ `aliasDocs` / `fieldDocs` / `markerDocs`（docs 三表，
#30 落地）。

**缺口**：三层各有单点测试（`parse-vfsl*.test.ts` ×9 / `evaluate-*.test.ts` ×3 /
`validate-snapshot*.test.ts` ×2），但「同一段文本驱动三层串联」的编排证据不存在
——没有任何测试同时消费 `parse 的 module → evaluate 的 derived → validateSnapshot
的判决`。这正是本票的切入点：**串联本身就是被验收的契约**（任何一层回归、任何
两层接缝错位即红灯）。

### 1.2 核心设计决策：单 fixture 驱动的链式证据结构

**决策 D1——链式传递，非独立构造**。编排测试的唯一证据结构是：

```ts
function chainDerived(): { module; derived } {
  const parsed = parseVfsl(FIXTURE);        // 第 1 层：同一段 §10 文本
  expect(parsed.ok).toBe(true);             //   分层失败即红灯锚点（前置断言）
  const evaluated = evaluate(parsed.module); // 第 2 层：消费第 1 层的 module
  expect(evaluated.ok).toBe(true);
  return { module: parsed.module, derived: evaluated.derived };
}
// 第 3 层：validateSnapshot(derived, snapshot)——消费第 2 层的 derived
```

理由：(a) AC6 的「全链路编排」语义要求 evaluate 的输入**就是** parse 的产出、
validateSnapshot 的输入**就是** evaluate 的产出——若三层各自 `parseVfsl(FIXTURE)`
独立构造，则退化为三个并排单点，串联证据消失；(b) 前置 `expect(ok)` + 不可达
throw 的写法让「前置层失败」以显式红灯呈现（含 issues JSON），而非把 undefined
漏给下游产生误导性失败。

**决策 D2——独立新文件，不并入既有文件**。`vfsl-assets-fullchain-e2e.test.ts`
独立成文件：(a) #9 / #21 既有文件各有自己的 AC 结构与 describe 组织，并入即
污染其语义边界；(b) 独立文件使「全链路」这一验收面在测试报告里有可见的一等
条目（Phase 0 收官演示的展示位）；(c) vitest 按文件收集，失败定位直达编排层。

**决策 D3——只锚可观测输出，不读源码**。全部断言锚公共接缝的返回值形状
（结果联合、派生 schema 数据形状、issue 的 message/path），不 import 内部件、
不 grep 源码文本。这与 #20/#21/#30 既有测试的断言纪律一致（SA6 文件头声明同款）。

### 1.3 交付物性质与实现半径

本票被验收的「待实现物」是编排验收锚本身（纯测试票）。SA6 Phase 1 已将其落地
并首跑全绿（简报末节实测记录：单文件 16/16、全量 341/341、typecheck exit 0）。
红灯语义非伪红：断言锚定的全部契约面（path 段数组精确、「联合成员 i/N」定位、
判别式缓存、docs 三表、终态节点形态）任一回归即失败——「首跑即绿」是三层实现
已齐备的自然结果，不是断言弱化的结果（§4 逐条审计 + §5 源码依据表佐证）。

由此 SA3 的实现半径：**保持测试文件现状**（无生产代码可写）。SA2 R1 攻击评审
reject 三点（距离算术口径 / 同构标注 / 断言纪律豁免），R2 已全部以**设计文档
修订**闭环——测试文件、断言、生产代码零改动（见「SA2 反馈逐条回应」）；SA3
无需任何调整动作。

## §2. 测试架构设计

### 2.1 fixture 常量与 §10 对齐纪律（AC5）

fixture 以规格 `docs/vfsl/v1-spec.md` §10 为真相源，在测试中以 TS 模板字面量
承载。**转义链路**（三级，每级都是契约）：

```
§10 规格文本      `Pattern<"^[A-Za-z0-9_\\-]{1,64}$">`   （markdown 代码块原文，两个字符：\ \）
  → TS 模板字面量  源码须写 `\\\\`（四个反斜杠），运行时字符串还原为 `\\`
  → VFSL 词法解码  字符串字面量内 `\\` 解码为 `\`（§2 注记 6），Pattern 实参 = `^[A-Za-z0-9_\-]{1,64}$`
```

- 派生 `index` 条目携带的 `keyPattern` 是**解码后**正则字符串
  `^[A-Za-z0-9_\-]{1,64}$`（JS 字符串含单个反斜杠），测试以常量
  `ASSET_ID_REGEX = '^[A-Za-z0-9_\\-]{1,64}$'`（TS 转义后同值）断言——与
  `evaluate-derived-schema.test.ts` 同款先例。
- **SA1 设计期实测**（2026-08-20，非推断）：抽取 §10 代码块与测试运行时文本
  diff，换算 `\\\\ → \\` 后 **29 行逐字一致**（仅模板字面量首尾空白差，运行时
  `.trim()` 消除）；同法核验仓内全部整份副本——`evaluate-derived-schema` /
  `validate-snapshot` / `evaluate-derived-docs-typecls` /
  `evaluate-derived-docs-audit` / `parse-vfsl-containers-markers` /
  `parse-vfsl-cycle-detection`（×2）/ `parse-vfsl-root-convention` 加本文件共
  **9 处全部一致**（`parse-vfsl-jsdoc.test.ts` 仅含注释片段，非整份副本）。
  → 简报「如发现副本与 §10 不一致以 §10 为准修正」条款：**零修正**，既有测试
  文件全部留在 DENY LIST。

### 2.2 合法快照工厂（AC1 内容要求）

```ts
function validSnapshot() {
  return {
    assets: {
      img1:  { kind: 'image', url: '…', width: 800, height: 600, audit: clone(AUDIT) },
      text1: { kind: 'text',  body: '<p>hello</p>', audit: clone(AUDIT) },
      file1: { kind: 'file',  name: 'report.pdf', size: 2048, tags: ['a','b'], audit: clone(AUDIT) },
    },
    attachments: ['note.txt', 'photo.png'],   // YPlainArray 纯值
    audit: clone(AUDIT),                       // 根级 Audit
    keywords: ['asset', 'demo'],               // YLeaf<string>[]（YArray）
    notes: 'optional note',                    // notes?: 可选字段——合法快照故意携带，验证可选字段接受路径
  };
}
```

设计要点：

- **三类资产各一**（image/text/file）——判别联合三分支全走通；每类内嵌 `audit`
  走 `Audit` 别名引用（结构树侧为按名 ref 终态，值 schema 侧穿透），根级 `audit`
  再覆盖一次 ROOT 字段位。
- **每调用返回新对象 + `clone(AUDIT)`**——测试间隔离：校验器对快照只读是 #21
  的实现承诺，但测试不依赖该承诺（任一用例变异快照不得污染其他用例）。
- **在场性先验断言**（`Object.keys(snap.assets)` / `Object.keys(snap)` 的
  `toEqual`）：对测试自己构造的字面量做先验看似冗余，实为**工厂漂移护栏**——
  将来有人编辑 `validSnapshot` 悄悄删字段（如去掉 `notes`），AC1 的「全字段覆盖」
  语义先在先验处红灯，而非静默缩窄覆盖面。
- **正例判决断言 `toEqual({ ok: true })`**（非 `.ok === true`）：精确形状断言
  同时锁住「ok:true 时不得携带 issues 等多余键」——与派生物
  `exactOptionalPropertyTypes` 纪律（`src/derived.ts:13`）同向。

### 2.3 派生 schema 关键节点五锚（AC2）

| # | 锚点 | 断言 | 实现依据（源码行） | 冻结先例（既有测试） |
|---|---|---|---|---|
| A | ROOT map 形态 | `derived.structure` = `{kind:'root'}` 包裹 `{kind:'map'}`；字段声明序 `assets/attachments/audit/notes/keywords`；`notes` `optional:true` | `evaluate.ts:57`（root 包裹 + `getMap` 语义）；`materializeObject` 字段声明序（`evaluate.ts:167-175`） | `evaluate-derived-schema.test.ts` ROOT 锚 |
| B | assets Record 键模式 | `derived.index['ROOT.assets.<key>']` = `{match:'pattern', keyPattern:ASSET_ID_REGEX, node:{kind:'union'}}` | `evaluate.ts:102-118`（解析点③：`childPath = 'ROOT.assets.<key>'`、`indexRow('pattern', kp, valueNode)`、值位 `resolveChain` 落 union）；`derived.ts:61-66`（IndexEntry 形状） | 同上（§7.1 索引行） |
| C | AssetEntity 判别式缓存 | `derived.aliases['AssetEntity']` 为 union，3 成员，`discriminator` = `{field:'kind', byValue:{image:0,text:1,file:2}}` | `evaluate.ts:116-119` + `unionNode`（先建 members 后条件附加）；`derived.ts:17-23`（Discriminator 形状，byValue 值 = 成员声明序） | `evaluate-derived-schema.test.ts` 判别式锚 |
| D | text 成员 body 终态 | 成员 `[1]`（text）的 `body` 字段 `node` `toEqual({kind:'xml-fragment'})`——无实参展开、无 children | `evaluate.ts:130`（`YXmlFragment → {kind:'xml-fragment'}`，实参整体丢弃）；ADR 0003 §5 不透明 | 同上终态锚 |
| E | attachments 终态 | ROOT 字段 `attachments` 的 `node` `toEqual({kind:'plain'})` | `evaluate.ts:134`（`YPlainArray → {kind:'plain'}`，规则 4 不递归）；`Attachments` 经 F4 无子终态内联（`evaluate.ts:89-95`） | 同上 |

锚 C 的 `byValue` 序号（0/1/2 = image/text/file）同时锁定了锚 D 引用的
`members[1]` = text 成员——两锚互证，成员序漂移必双红。

### 2.4 docs 抽查（AC3）

断言 `derived.aliasDocs` 三别名的 JSDoc **逐字原文**（含前导/尾随空格）：

```ts
expect(aliasDocs(derived, 'ROOT')).toEqual([' ROOT：命名空间根文档，assets 键集受 AssetId 的 Pattern 约束 ']);
expect(aliasDocs(derived, 'Audit')).toEqual([' 审计信息：所有写入留痕 ']);
expect(aliasDocs(derived, 'AssetEntity')).toEqual([' 资产实体：按 kind 判别的封闭联合 ']);
```

- 依据：`DerivedSchema.aliasDocs: Record<别名名, string[]>`（`derived.ts:78-79`，
  「VfslAlias.docs 逐字继承」）；取值辅助 `aliasDocs(derived: unknown, name)` 用
  `unknown` + 安全导航（表缺失/键缺失 → null）——红灯以**断言不匹配**呈现而非
  TypeError 中断，与 #30 测试 `slot()` 同款纪律。
- 期望值与 `evaluate-derived-docs-typecls.test.ts:128-134` 既有冻结断言同字面
  （该文件 341 全量绿 = 行为已验证）。

### 2.5 非法快照八面矩阵（AC4）

公共断言辅助：

```ts
function expectIssueAt(result, path) {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.issues.map((i) => i.path)).toContainEqual(path);
}
```

**为什么 `toContainEqual(path)` 而非全列表 `toEqual`**：校验器是全收集语义
（上限 100 条 + 截断标记，#21 设计），一个非法快照常产出多条 issue；AC 要求的
「path 段数组精确」指**该面的 path 数组本身精确**（`['attachments', 1]` 含
number 下标段，不是 `'attachments.1'` 拼接串、不是 `['attachments']` 截短），
`toContainEqual` 以精确数组相等语义锁定之；对完整 issue 列表做 `toEqual` 则
过度冻结输出序与伴生 issue（那是 #21 单点测试的领土，AC6 禁止重复）。

八面矩阵（面 → 快照变异 → 期望 path → 消息锚点）：

| 面 | 变异 | 期望 path 段数组 | 消息/分支锚点 | 源码依据 |
|---|---|---|---|---|
| 1 未知键 | `snap.extraKey = 1` | `['extraKey']` | 封闭对象语义 | `validate.ts:531-578`（validateObject：未知键在 `[...path, k]` emit「封闭对象不接受未声明键」） |
| 2 必填缺失 | `delete snap.attachments` | `['attachments']` | 必填缺席 | 同上（validateObject 必填段：缺席在字段 path emit） |
| 3 值类型错 | `img1.url = 42` | `['assets','img1','url']` | 候选分支 dive 字段级 issue（kind 命中 image 成员，url 类型错） | `validate.ts:426-430`（dive re-base 到联合值 path + 字段名）；`validate.ts:455-463`（scalar 类型不匹配） |
| 4 键 Pattern 违例 | `assets['abc.123'] = 合法 image` | `['assets','abc.123']`（违例键作段） | `Record 键 "abc.123" 不满足 Pattern 正则` | `validate.ts:272-279`（validateKeyPattern 在 `[...path, key]` emit）；`validate.ts:339`（键违规属软判定，不参与候选排除） |
| 5 联合 no-match（缺字段） | `img1 = {kind:'video'}` | `['assets','img1']` | **「联合成员 2/3」**（text 成员失败距离最小） | 见下方距离算术 |
| 6 YPlainArray 子树值错 | `attachments = ['note.txt', 42]` | `['attachments', 1]`（**number 下标段**） | 纯值上下文叶子类型错 | `validate.ts:503`（`[...path, i]`，i 为 number 段——O1 冻结） |
| 7 XML 非良构 | `text1.body = '<p>unclosed'` | `['assets','text1','body']` | 良构性软判定 | `validate.ts:509-514`（xml 值非良构 emit） |
| 8 kind 枚举外（字段齐全） | `img1 = {kind:'video', url, width, height, audit}` | `['assets','img1']` | **「联合成员 1/3」**（image 成员失败距离最小） | 见下方距离算术 |

**距离算术**（面 5/8 的 winner 定论依据——确定性，非巧合；**R2 修订**：计数口径补全，依据 SA2 攻击点 1）：

**计数口径**：距离 = `countIssues` 以计数 sink 跑**完整校验**的全量 issue 数
（`validate.ts:286-306`，计数 sink 下每次 emit +1）——含三类贡献：必填缺失
（「缺少必填字段」，`validate.ts:570-573`）、字段值错（如 enum 值不命中）、
**封闭对象未知键**（「未知字段 …封闭对象不接受未声明键」，`validate.ts:574-580`：
变异快照中不属于该成员声明字段的每个键各计 1）。SA2 探针实证（R1 评审）：面 8
精确变异追加一个全体成员均未声明的键 `zzz:1` 后，image 成员距离 1→2——未知键
计入距离得证。

- 硬矛盾入口：三个成员的 `kind` 均为必填字面量（enum）字段，`kind:'video'`
  值错 → 三成员全部 `contradicts`（`validate.ts:341-348`：必填 enum 字段缺席
  **或值错** = 成员排除）→ 候选集空 → no-match 分支（`validate.ts:431-434`）：
  在联合值 path 发汇总消息（报 argmin 距离成员）+ 对该成员 dive 双输出。
- 面 5 `{kind:'video'}` 距离（**无未知键**——变异唯一键 `kind` 三成员均声明）：
  image = kind 值错 1 + url/width/height/audit 缺 4 = **5**；text = kind 值错
  1 + body/audit 缺 2 = **3**；file = kind 值错 1 + name/size/tags/audit 缺
  4 = **5** → winner = text（声明序 1）→ 「联合成员 **2/3**（距离 3）」。
- 面 8 `{kind:'video', url:'u', width:1, height:1, audit}` 距离（url/width/
  height 对 text/file 成员是**未知键**，各贡献 3）：image = 仅 kind 值错 =
  **1**；text = kind 值错 1 + body 缺 1 + 未知键 url/width/height 3 = **5**；
  file = kind 值错 1 + name/size/tags 缺 3 + 未知键 3 = **7** → **[1,5,7]**，
  winner = image（声明序 0；1 < 5 严格唯一）→ 「联合成员 **1/3**（距离 1）」。
  （R1 版此行漏算未知键误记 [1,2,4]——winner 与冻结断言不受影响，但口径错误：
  text 5 与 file 7 的次序恰由 3 条未知键贡献，若成员字段数接近，漏算足以翻转
  argmin 结果。**预测任何新变异的 winner 必须用本全量口径**，不得只数缺失与
  值错。）
- 平局规则：argmin 严格 `<` 扫描，平局取声明序在前者（`validate.ts:439` 起）
  ——两面的 winner 均严格唯一，不受平局规则影响。
- 面 5 与面 8 共用 `kind:'video'` 但字段完备度不同，正是为把 winner 从 2/3 挪到
  1/3——两面合并会丢掉其中一个定位锚，拆开则「失败距离最小成员」的算术被完整
  演示（收官票的教学价值）。

**path 段类型纪律**：段数组 `Array<string | number>`（`validate.ts:41-44`），
对象键 = string 段、数组下标 = number 段（O1）——面 6 的 `1` 与面 4 的
`'abc.123'`（键名恰含点号也不拆分——段数组零转义）共同钉死这一契约。

### 2.6 断言纪律总表（防御性选择汇总）

| 选择 | 理由 |
|---|---|
| `toEqual({ ok: true })` 精确形状 | 锁 ok 分支无多余键；对齐 exactOptionalPropertyTypes 纪律 |
| `toContainEqual(path)` | 全收集语义下锁「该面 path 数组精确」，不冻结列表序/伴生 issue（AC6 边界） |
| 快照工厂每调用新对象 + `clone(AUDIT)` | 用例间隔离，不依赖校验器只读承诺 |
| 在场性先验 `toEqual`（keys） | 工厂漂移护栏（防未来编辑静默缩窄 AC1 覆盖面） |
| `unknown` + 安全导航取 docs 表 | 红灯以断言不匹配呈现，不以 TypeError 中断 |
| 判别式 byValue 序号与 `members[1]` 互证 | 成员声明序漂移双锚同红 |
| 前置 `expect(ok)` + 不可达 throw（含 issues JSON） | 前置层失败显式红灯，不漏 undefined 给下游 |

**豁免声明（R2，依据 SA2 攻击点 3，修订选项 (b)）**：AC2-3 / AC2-4 两处取值
`derived.aliases['AssetEntity']!`（测试文件 182/190 行，非空断言 + 行内注释
「fixture 保证声明」）**不在**「unknown + 安全导航」纪律覆盖内，为**显式豁免**：

1. **fixture 静态保证**：§10 fixture 是编译期常量字符串，`AssetEntity` 别名必然
   声明——别名表缺失只可能是求值器回归，且该回归同时使 AC2-2（index/union 锚）、
   AC2-5（判别式锚）、AC3（docs 锚）与 #20 既有全量测试（341 的组成部分）大面积
   红——TypeError 呈现的两条用例并非唯一防线。
2. **仍为 loud 失败**：别名缺失时 `entity.kind` 在任何 expect 之前于用例内抛
   TypeError → vitest 报该用例失败，**无静默通过路径**；代价仅为失败可读性
   （无 issues JSON 上下文），对纯测试票可接受。
3. **修订选项 (a)（两处改 `unknown` + 安全导航）经评估不采纳**：SA2 判定
   「(a)/(b) 任一即可闭环」；选 (b) 以保持 R2 修订「测试文件、断言零改动」的
   最小半径（SA2 结论：修订半径极小）。若未来求值器重构使别名表形态不稳，再按
   (a) 补安全导航——ALLOW LIST 的 `[SA6 owned]` 条目已覆盖该调整半径。

## §3. 与既有测试的边界划分（AC6——不重复单点覆盖）

| 领土 | 既有文件 | 本文件**不做**的事 |
|---|---|---|
| 解析行为（#9） | `parse-vfsl*.test.ts` ×9（E 码矩阵、禁用清单、JSDoc 捕获、ROOT 约定、环检测、R3 回归、SA7 补充） | 不构造非法 VFSL 文本、不断言 E3xx 定位锚——只消费「§10 文本 parse ok」这一个前置 |
| 求值/派生物（#20/#30） | `evaluate-derived-schema/-docs-typecls/-docs-audit.test.ts` | 不做全量 aliases/values/index/docs 表遍历对账、不做 JSON 序列化往返——只抽查五锚 + 三别名 docs |
| 校验器单点（#21） | `validate-snapshot.test.ts` / `-sa7.test.ts` | 不重复 ReDoS 预算、100 条截断、判别式缓存透明性（缓存缺失/存在输出全等）、记忆化、平局声明序——八面矩阵每面恰一例，仅为「同一 fixture 下三层串联后校验层按契约拒绝」的证据。**同构标注（R2，SA2 攻击点 2）**：面 5 与 #21 既有用例 `validate-snapshot.test.ts:399-409` **近乎同构**——同 §10 fixture、同 `img1={kind:'video'}` 变异、同「联合成员 2/3」消息锚；本文件**增量 = 链式驱动**（chainDerived 串联产物而非独立构造）**+ path 段数组断言**（#21 版未断言 path）。该面上链系简报 AC4 强制（八面每面至少一例），SA2 复核不构成 AC6 违规；简报 SA6 记录中「2/3 消息锚为从未断言过的新锚点」的失实表述已由总控勘误更正（简报末「总控勘误（2026-08-20，据 SA2 R1 攻击点 2）」块：准确表述为 path 数组断言与面 8 的 1/3 定位系新增锚点，面 5 的 2/3 消息锚与 #21 同构） |
| 编排（**本票**） | `vfsl-assets-fullchain-e2e.test.ts` | ——同一段 §10 文本驱动三层串联 + 跨层接缝断言（module→derived→判决） |

判据：本文件每条断言的输入都源自 `chainDerived()` 的串联产物（或对同一 derived
跑 validateSnapshot）；删去任何一层实现，相应断言无法独立存活——这是「编排」
而非「单点」的操作性定义。

## §4. SA6 红灯测试审计（设计 ↔ 已落地对照）

SA1 逐用例独立复核（非转抄 SA6 自述）：16 用例 ↔ §2 设计锚点对照——

| describe（用例数） | 设计节 | 审计结论 |
|---|---|---|
| AC1 全链路（2） | §1.2 D1 / §2.2 | ✅ 显式三层串联（第 1 条逐层变量传递 + 每层 expect(ok)；第 2 条 chainDerived + 在场性先验 + `toEqual({ok:true})`）——与 D1 链式传递决策一致 |
| AC2 五锚（5） | §2.3 | ✅ 五锚逐一在场，字面与本设计表格逐项相符（root/map 形态、字段序 + optional、index pattern 条目 + keyPattern + union、discriminator byValue 三值、xml-fragment/plain 终态 toEqual 精确形状） |
| AC3 docs（1） | §2.4 | ✅ 三别名逐字断言，字面与 #30 冻结断言一致；unknown 安全取值在场 |
| AC4 八面（8） | §2.5 | ✅ 八面各一例，path 断言与矩阵表逐项相符；面 5/8 的「联合成员 2/3 / 1/3」some(includes) + path toContainEqual 双锚在场；面 6 number 段、面 4 含点键段在场 |

**审计定论：零缺口（简报 AC 1-6 每项都有对应断言）、零偏离（断言字面与本设计
及既有冻结先例一致）、零越界（无 src 触碰、无单点重复）**。16/16 首跑绿的
红灯语义成立：断言锚定的契约面任一回归（path 不精确、判别式缓存缺失、docs
丢失、终态形态偏离）即失败——详见 §5 依据表。

## §5. 实现缺陷筛查结论（简报「如串联暴露缺陷」条款）

简报要求：全链路串联若暴露实现缺陷，按 MABF 流程记录 wiki 并回报总控，不得
静默绕过或删断言。SA1 独立筛查（设计期源码级复核，非仅依赖 SA6 绿灯）：

- 每个 AC2/AC3/AC4 锚点都在实现源码中有明确落点（§2.3/§2.4/§2.5 表末列），
  且绝大多数已被 #20/#21/#30 既有测试冻结（341 全量绿的组成部分）；
- 串联接缝（module→derived 判别联合穿透、derived→validateSnapshot 的 index /
  values / docs 消费）未发现语义错位；
- **定论：未暴露实现缺陷，缺陷记录路径未触发。**

## §6. 工程纪律与运行契约

- 测试跑法：仓库根 `pnpm test`（vitest run）或单文件
  `pnpm vitest run packages/vfsl/test/vfsl-assets-fullchain-e2e.test.ts`；
  类型检查 `pnpm typecheck`（tsc -p packages/vfsl/tsconfig.json）。测试命令
  一律后台独立进程（setsid nohup），禁止前台同步阻塞。
- 纯测试新增不改 `packages/vfsl/src/` → `packages/vfsl/package.json` **无需
  bump**（Hard Gate #9 的纯测试豁免）。
- 每阶段产出立即 worktree 内 git commit；禁止 `git push`、禁止自行建 PR
  （PR 由外部 issue-runner/check.sh 负责）。

## SA2 反馈逐条回应

**R2（2026-08-20）**——SA2 R1 评审 reject（攻击点 1 MEDIUM + 攻击点 2/3 LOW）。
逐条落实如下；三项全部以**设计文档修订**闭环，测试文件、断言、生产代码零改动：

| 要求（SA2 R1） | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| 攻击点 1（MEDIUM）：§2.5 面 8 距离算术漏算封闭对象未知键——text/file 实为 5/7 非 2/4（`validate.ts:575-580` 未知键计入距离）；须改距离为 [1,5,7] 并补计数口径注。面 5 的 [5,3,5] 复核正确无需改 | ✅ | §2.5「距离算术」节 | 面 8 距离修正为 **[1,5,7]**（text = kind 值错 1 + body 缺 1 + 未知键 url/width/height 3；file = 1 + 3 + 3）；新增**计数口径**段：距离 = countIssues 全量 issue 数（`validate.ts:286-306` 计数 sink），含必填缺失 / 值错 / **封闭对象未知键**（`validate.ts:570-580`），并引 SA2 探针实证（`zzz:1` 使距离 1→2）；补「次序对未知键敏感，预测新变异 winner 必须用全量口径」警示；面 5 保持 [5,3,5] 但口径表述统一为「kind 值错 N + 缺 N」自明形式。winner（image）与冻结断言（「联合成员 1/3」）不受影响——断言只锚 winner 定位不锚距离数值，测试零改动 |
| 攻击点 2（LOW）：§3 校验器单点行补注——面 5 与 `validate-snapshot.test.ts:399` 同构、增量 = 链式驱动 + path 数组断言；简报 SA6 记录失实表述呈报总控修正 | ✅ | §3 边界表「校验器单点（#21）」行 | 补**同构标注（R2）**：面 5 与 #21:399-409 同 fixture / 同 `img1={kind:'video'}` 变异 / 同「联合成员 2/3」消息锚；增量 = 链式驱动 + **path 段数组断言**（#21 版未断言 path）；该面上链系简报 AC4 强制，非 AC6 违规。简报失实表述的修正：总控已落地勘误（简报末「总控勘误（2026-08-20，据 SA2 R1 攻击点 2）」块，SA6 原文存档以勘误为准），本设计引用之——非 SA1 可写物，呈报动作由总控完成 |
| 攻击点 3（LOW）：断言纪律不对称——(a) SA3 将两处 `aliases['AssetEntity']!` 改 `unknown` + 安全导航（16/16 须仍绿），或 (b) SA1 在 §2.6 明示豁免理由；任一即可闭环 | ✅（选 b） | §2.6 表后「豁免声明（R2）」 | 选 (b)：AC2-3/4 的非空断言**显式豁免**安全导航纪律，理由三条——①fixture 编译期常量静态保证（别名缺失 = 求值器回归，另有 AC2-2/AC2-5/AC3/#20 全量测试多重防线）；②TypeError 仍 loud 失败，无静默通过路径；③保持 R2 最小修订半径（SA2 结论：测试零改动）。选项 (a) 经评估不采纳的理由与未来触发条件（ALLOW LIST `[SA6 owned]` 已覆盖该调整半径）一并写明 |
| （建议，非攻击点）：§8 假设 1 的命令为转述而非逐字粘贴，建议贴可复制的原始命令与输出摘录，达标「实测验证须贴命令和输出」立法字面 | ✅ | §8 假设 1 行 + 表后命令块 | SA1 于 R2 重跑核验并补录：可复制的 awk/sed/diff 命令（spec §10 抽取边界 497-525、`sed 's/\\\\\\\\/\\\\/g'` 换算、逐副本 diff）+ 9 处整份副本全部 EXACT 29 行的真实输出摘录（各文件模板字面量首尾行号一并贴出） |

## §7. 文件清单（File Scope）

### ALLOW LIST

- `packages/vfsl/test/vfsl-assets-fullchain-e2e.test.ts` — `[SA6 owned]` 新建
  （SA6 Phase 1 已落地，commit `0d9c019`），全链路编排验收锚，本票唯一代码
  交付物。SA3 仅可在 SA2 攻击成立的修订中调整（断言/结构按修订指令），不得
  改断言语义为静默绕过。
- `wiki/raw/task_vfsl-assets-fullchain-e2e*.md` — 任务 wiki 产出族（简报已入库
  `5c8d57c`/`ff7ce42`；本设计文件；后续 SA2/SA4/SA7 评审报告按 MABF 流程追加）。

### DENY LIST

- `packages/vfsl/src/**` — 纯测试票边界（简报明文「不改 `packages/vfsl/src/`」）；
  三层实现已被 #9/#20/#21/#30 冻结。
- `packages/vfsl/package.json` — 无 src 改动，不 bump（Hard Gate #9 豁免）。
- `packages/vfsl/test/parse-vfsl*.test.ts`、`evaluate-*.test.ts`、
  `validate-snapshot*.test.ts`（既有 14 文件）— #9/#20/#21/#30 既有领土；
  SA1 设计期已实测其 fixture 副本与 §10 逐字一致，**零修正需要**。
- `docs/vfsl/v1-spec.md` — §10 是 fixture 真相源，测试向它对齐而非反之。
- `docs/adr/**`、`CONTEXT.md` — 规格与术语，不在工程任务范围。
- `packages/vfsl/tsconfig.json`、根 `package.json` / `pnpm-workspace.yaml` /
  CI 配置 — 无新增依赖与工具链变化。

## §8. 协议假设依据 (Protocol Assumption Evidence)

| # | 假设 | 依据类型 | 依据内容（具体引用） | 风险 |
|---|---|---|---|---|
| 1 | TS 模板字面量转义换算：源码 `\\\\` → 运行时 `\\`，运行时 FIXTURE 与 §10 原文逐字一致 | 设计期实测验证 | SA1 实测（R1 2026-08-20 首测；**R2 同日重跑并贴原始命令与输出**，应 SA2「达标实测验证须贴命令和输出的立法字面」建议）：`awk` 抽取 §10 代码块与各测试 fixture 模板字面量，`sed 's/\\\\\\\\/\\\\/g'` 换算后 `diff`——**9 处整份副本全部逐字一致（29/29 行）**，命令与真实输出摘录见本表下方代码块 | 低 |
| 2 | VFSL 字符串字面量 `\\` 解码为 `\`，`index` 条目 keyPattern = 解码后正则 | 源码引用 + 现有测试引用 | 规格 §2 注记 6；`evaluate-derived-schema.test.ts:24`（「Record 键带 Pattern 约束时 keyPattern 携带解码后正则」）及同文件 ASSET_ID_REGEX 常量先例（全量绿） | 低 |
| 3 | vitest 经仓库根 `pnpm test` 收集 `packages/vfsl/test/*.test.ts` | 设计期实测验证（SA6 Phase 1 记录） | 简报末节：「单文件 Test Files 1 passed / Tests 16 passed；全量 15 passed / 341 passed」——新文件已被收集执行；同目录既有 14 文件同一命令长期收集（先例） | 低 |
| 4 | `pnpm typecheck` 覆盖新测试文件（tsc -p packages/vfsl/tsconfig.json 含 test/） | 设计期实测验证（SA6 Phase 1 记录） | 简报末节：「`pnpm typecheck` —— 通过（exit 0）」；#21/#30 测试文件同为 test/ 下且 typecheck 长期绿（先例） | 低 |

无进程/端口/HTTP/WS/跨 job 生命周期类假设：本设计仅涉及纯测试新增，不启动
服务、不占端口、不依赖 CI runner 状态。

**假设 1 实测命令与输出（R2 补录；2026-08-20 于 worktree 根目录重跑，输出为真实摘录）**：

```bash
# ① 抽取 spec §10 代码块原文（围栏行 496/526 不取，内容 497-525 共 29 行）
awk 'NR>=497 && NR<=525' docs/vfsl/v1-spec.md > /tmp/spec10.txt

# ② 逐副本：抽 FIXTURE/fixture 模板字面量内容（起始行 = `const FIXTURE = \`` 的下一行，
#    结束行 = `` `.trim(); `` 的上一行），sed 把源码 4 字面反斜杠换算为 2，与 §10 diff
#    （sed 模式里 8 个反斜杠 = 匹配 4 字面反斜杠，替换 4 个 = 输出 2 字面反斜杠）
for f in <下表 9 个（文件, 起始行, 结束行）>; do
  awk -v s=$s -v e=$e 'NR>s && NR<e' "$f" | sed 's/\\\\\\\\/\\\\/g' > /tmp/copy.txt
  diff /tmp/spec10.txt /tmp/copy.txt && echo "EXACT 29 lines $f ($s..$e)"
done
```

```text
EXACT  29 lines  packages/vfsl/test/vfsl-assets-fullchain-e2e.test.ts (37..67)
EXACT  29 lines  packages/vfsl/test/evaluate-derived-schema.test.ts (107..137)
EXACT  29 lines  packages/vfsl/test/validate-snapshot.test.ts (46..76)
EXACT  29 lines  packages/vfsl/test/evaluate-derived-docs-typecls.test.ts (38..68)
EXACT  29 lines  packages/vfsl/test/evaluate-derived-docs-audit.test.ts (27..57)
EXACT  29 lines  packages/vfsl/test/parse-vfsl-containers-markers.test.ts (198..228)
EXACT  29 lines  packages/vfsl/test/parse-vfsl-cycle-detection.test.ts (175..205)
EXACT  29 lines  packages/vfsl/test/parse-vfsl-cycle-detection.test.ts (334..364)
EXACT  29 lines  packages/vfsl/test/parse-vfsl-root-convention.test.ts (258..288)
```

（`parse-vfsl-jsdoc.test.ts` 仅含注释片段非整份副本，不在此列——与 §2.1 口径一致。）

## §9. 契约改动连锁审计 (Contract Change Caller Audit)

**无契约改动**：本设计仅涉及纯测试新增——不触 `packages/vfsl/src/` 任何文件，
不改 `parseVfsl` / `evaluate` / `validateSnapshot` 及任何内部函数的签名、返回
类型、throw 行为或错误处理路径；测试文件只作为三公共导出的**消费者**。故无
caller 清单可列（也无 caller 受影响）；SA4 §1.5 比对以本声明为准。
