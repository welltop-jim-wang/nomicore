# SA1 设计 — 修补：派生 schema 携带 docs + typeCls 签名收敛（Issue #29）

> R2 修订（2026-08-19；R1 经 SA2 评审 **reject**，评审报告 `task_vfsl-derived-docs-typecls_sa2_review.md`）。
> 任务类型 bugfix（PR #28 评审修补票：契约缺口落地 + 调用惯例收敛）。
> 输入：任务简报 `task_vfsl-derived-docs-typecls.md`、SA5 报告 `20260819-bug-vfsl-derived-docs-typecls.md`、
> SA6 红灯 `packages/vfsl/test/evaluate-derived-docs-typecls.test.ts`（8 断言，红灯为真）、SA2 R1 攻击点 #1–#4。
> 本设计不写代码；SA3 按本文件实现。R2 为局部手术：三表承载定形（§2）、路径文法（§3.2）、typeCls 方案（§5）、
> §6 裁决均为 SA2 独立确认项，**零改动**；改动集中于 §4.5 对账表补漏、§3.3/§3.4/§4.1/§7 三锚守卫、
> §5.2/§2.1 措辞修正（逐条回应见表「SA2 反馈逐条回应」）。

## §0. 结论速览

| # | 裁定 | 章节 |
|---|---|---|
| 1 | docs 三锚以 **DerivedSchema 三个新增顶层必填槽位**承载：`aliasDocs` / `fieldDocs` / `markerDocs`（**确认 SA6 红灯定形，不改形**；SA5 开放问题「别名级承载位置」就此定形） | §2 |
| 2 | 收集实现为**独立一遍 IR 全子树遍历** `collectDocs`，不在 SA5 所列五个构造点逐点缝补 | §3–§4 |
| 3 | docs 表键有自己的**路径文法**：每别名自成根、`<member N>` 定位联合成员内部、标记实参按物化语义分流（YMap/YXmlFragment/YLeaf 透明、YArray/YPlainArray 入 `<item>`）；同路径嵌套标记按源序串联 | §3 |
| 4 | `typeCls` 收敛为 `Resolver` 方法（闭包委托内部自由函数，自由函数去 export），全部调用点改 `ctx.R.typeCls(t)` | §5 |
| 5 | 观察项（判别式放宽到 ref 成员）**不纳入本票**——无红灯锚点的派生 JSON 变更，违反 TDD 纪律 | §6 |
| 6 | 存量 253 全绿零风险论证 + fixture 全量对账表（SA3 实现后自检用） | §4.4 / §7 |

---

## §1. 缺口推演（Bug 根因复述与定性）

**主缺口（契约断流）**：IR 三锚位（`VfslAlias.docs` ir.ts:26、`VfslField.docs` ir.ts:36、marker `.docs` ir.ts:55，均必填、无注释为空数组——IR §7.2 纪律）已正确捕获 docs，但派生侧是「类型无槽 + 构造点不读」的双侧缺口（SA5 Investigation：`derived.ts:26-78` 类型族无任何 docs 字段；`evaluate.ts` 六个构造点全部不读 IR docs）。下游 F2（TSDoc 发射）、Phase 4（AI namespace card）无数据可读。

**定性**：docs 携带决策（issue 正文称 ADR 0005 §3，该 ADR 未入库，权威内容 = 简报「工作内容 1」）形成于 #20 发布之后，PR #28（`40c1be0`）落地时契约不存在——**新增契约未落地，非回归、非实现偏差**。本设计不臆造 ADR 0005 内容，以简报为唯一权威。

**次缺口（惯例发散）**：`typeCls(t, cls, bodies)` 以自由函数从 `resolve.ts:129` 导出，`evaluate.ts:106/:140` 解包 `Resolver` 的 `cls`/`bodies` 传参；同一 Resolver 上的 `resolveChain` 已是方法形态（`resolve.ts:52`）。零行为影响，纯调用惯例不一致。

**根因层结论**：这不是「某个构造点漏读」的单点遗漏，而是派生 schema 类型族（ADR 0003 冻结形状）整体没有 docs 的容身之处。因此修法是**类型族扩展 + 一遍完整收集**，而不是在六个构造点上加参数——逐点缝补会把 docs 语义焊进两条已有各自路径文法的遍历（结构树物化 / 值映射），见 §3.1 的展开论证。

---

## §2. docs 承载位置定形（SA5 Fix direction ① 开放问题 → SA1 裁定）

### 2.1 为什么是三个顶层表，而不是节点内联 docs 键

SA5 Fix direction ① 提出三锚加必填 `docs: string[]`，并指出别名级承载位置需 SA1 定形（`DerivedSchema.aliases` 条目是 `StructureNode`，其自身无别名槽）。SA6 红灯契约已定形为三个顶层表，SA1 **逐断言模拟推演后确认此形**（对账见 §4.4），理由有三：

1. **存量精确 `toEqual` 不可触碰（AC5 硬约束）**。既有 `evaluate-derived-schema.test.ts` 对派生节点形状做了逐键精确断言：
   - 终态节点：`:326` `toEqual({ kind: 'xml-fragment' })`、`:355` `toEqual({ kind: 'leaf' })`；
   - MapField：`:431-437` baseline members 精确到 `{name, optional, node}` 三键；
   - ValueSchema/ValueField：`:356-359` `values['ROOT']` 精确对象、`:534-540` `values['Audit']` 精确对象。

   在 `StructureNode` / `MapField` / `ValueSchema` / `ValueField` 上加**必填** docs 键即违约这批锚（`toEqual` 严格匹配多余键），253 全绿不保。可选键（`docs?`）虽不破 `toEqual`，但违反 IR §7.2 同款必填纪律（AC1 明文「无注释为空数组，与 IR 纪律一致」）且引入 `exactOptionalPropertyTypes` 条件展开的构造复杂度——两头不讨好。
2. **别名级 docs 本就需要表**：`aliases` 条目是 `StructureNode`，ROOT 入口的 `{kind:'root'}`、终态 `{kind:'leaf'}` 均无别名槽可挂；顶层 `Record<别名名, string[]>` 是唯一不加节点形状的承载。
3. **内容哈希纪律友好**：三表是纯新增顶层键，`DerivedSchema` 既有四键（`aliases`/`structure`/`values`/`index`）的序列化形状逐字节不变——**为未来的 F2 编译缓存等潜在消费者**保持旧形状序列化前缀稳定：新版本产出仅在尾部追加三个键（构造时按固定顺序放在既有键之后，见 §4.2）。（R2 口径修正，SA2 攻击点 #4：仓内**现存无**任何对 derived 做内容哈希/编译缓存的消费方——grep 全仓已核；本条是面向未来的前缀稳定性设计承诺，非既存事实。）

### 2.2 三表契约（与红灯测试头注释逐字一致）

| 槽位 | 键 | 值语义 |
|---|---|---|
| `aliasDocs: Record<string, string[]>` | 别名名（含 ROOT；**每别名一项**，含无人引用的惰性积木别名） | `VfslAlias.docs` 逐字继承；无 doc 为空数组（必填键） |
| `fieldDocs: Record<string, string[]>` | 字段语法路径（文法见 §3） | `VfslField.docs` 逐字继承；Record 值位合成字段 `<key>` 恒空数组（IR 的 record 节点无 docs 槽，无可继承）；无 doc 为空数组 |
| `markerDocs: Record<string, string[]>` | 标记所处语法路径 | `marker.docs` 逐字继承；无 doc 为空数组；同路径嵌套标记串联（§3.3） |

三表均为 `DerivedSchema` 的**必填**键（`exactOptionalPropertyTypes` 纪律下不用可选键）；空模块语义下表存在但可为空对象（合法模块恒有 ROOT，故 `aliasDocs` 至少一项）。

**值树（`values`/`ValueField`）不加 docs 槽**：字段位文档由 `fieldDocs` 一表承载、按路径寻址，天然服务两棵树（结构树与值 schema 的字段位是同一语法位置）；在 `ValueField` 上重复承载会引入两处一致性义务，无消费者需求支撑。

---

## §3. docs 路径文法（三表之键）

### 3.1 为什么独立一遍遍历（不沿五个构造点缝补）

SA5 列出的断流构造点分属两条遍历：结构树物化（`structureOf`/`materializeObject`/marker 分支/`terminalOf`）与值映射（`valueOf`）。在这两条遍历里缝 docs 有三个不可解的错配：

1. **路径文法不同构**。index 的文法是「ROOT 前缀 + 停止集」：别名表物化一律 `path=null` 不立行（evaluate.ts:52 注释），联合成员不立行（§7.2 union 停，evaluate.ts:108）。而 docs 需要**每别名自成根**（红灯断言 `fieldDocs['Box.item']`、`fieldDocs['Entity.<member 0>.kind']` 均非 ROOT 前缀）且**必须深入联合成员内部**（`<member N>` 段）。把这套文法塞进 `structureOf` 要么污染 index 构造，要么需要第二套 path 参数并行穿线。
2. **覆盖域不同**。结构树按折叠规则**有意丢弃子树**：YPlainArray 整个子树 → `plain` 终态（不递归）、YXmlFragment 实参整体丢弃（ADR 0003 §5）、全标量联合 → `leaf`（成员细节只进值树）。而 docs 的覆盖域是 **IR 全子树**——ADR 0003 §5 明言「实参字段为文档性质」，YXmlFragment 实参内的字段**恰以被文档化为存在目的**；纯值上下文内的字段同样是作者写下的文档。沿结构树遍历会在这些位置结构性丢数据，违反「逐字继承无丢失」。
3. **ROOT 双走查重复**。`evaluate` 对 ROOT 走两遍（别名表物化 path=null + 结构入口 'ROOT' 前缀），沿构造点发条目会重复落键。

故设计为**独立函数 `collectDocs(module)`**：对每个别名的 IR 类型树做一遍纯遍历，与 `structureOf`/`valueOf` 零耦合、零改动（`evaluate.ts` 既有函数一行不动，只在主流程插入一次调用并入返回值）。爆炸半径最小，且 docs 语义自成一节可独立评审。

### 3.2 路径文法规则表

设当前节点类型为 `t`、其所在位置的路径为 `P`（别名树根的 `P` = 别名名）：

| `t.kind` | 子位置路径 | 发条目 | 依据 |
|---|---|---|---|
| `object` | 字段 `f` → `` `${P}.${f.name}` `` | `fieldDocs[该路径] = f.docs`；随后以该路径递归 `f.type` | 红灯 `ROOT.notes` / `Box.item` / `Entity.<member 0>.kind` |
| `union` | 成员 `i` → `` `${P}.<member ${i}>` ``（i = 成员声明序，0 起） | 无自身条目；成员各自递归 | 红灯「`<member N>` 段 = 成员声明序，0 起」 |
| `array`（裸 `T[]`） | 元素 → `` `${P}.<item>` `` | 无自身条目；元素递归 | 与 index 的 `<item>` 段同构（evaluate.ts:175） |
| `record` | 键位与值位 → `` `${P}.<key>` `` | `fieldDocs[该路径] = []`（合成字段，恒空）；键位、值位均以该路径递归 | 红灯 `ROOT.assets.<key>`；IR record 节点无 docs 槽 |
| `marker: YMap` | 实参 → `P`（**透明**） | `markerDocs[P] += t.docs`（串联语义见 §3.3） | 红灯 `markerDocs['ROOT']`/`['Audit']`（别名体根）与字段位 `ROOT.notes`；与 `materializeMapForm` 的 path 直传同构（evaluate.ts:147） |
| `marker: YArray` | 实参 → `` `${P}.<item>` `` | `markerDocs[P] += t.docs`；实参按元素位递归 | 与 `arrayNode` 的 `<item>` 同构（evaluate.ts:117/:175）；红灯 `AssetEntity.<member 2>.tags` |
| `marker: YPlainArray` | 实参 → `` `${P}.<item>` `` | `markerDocs[P] += t.docs`；实参按元素位递归（**不因结构树丢弃而停走**） | 元素语义与 YArray 一致；红灯 `markerDocs['Attachments']`（别名体根） |
| `marker: YXmlFragment` | 实参 → `P`（**透明**） | `markerDocs[P] += t.docs`；实参递归 | ADR 0003 §5「实参字段为文档性质」——实参对象字段以 `P.f` 入 `fieldDocs` |
| `marker: YLeaf` | 实参 → `P`（**透明**） | `markerDocs[P] += t.docs`；实参递归 | 与 `valueOf` 的 YLeaf 透明递归同构（evaluate.ts:303）；E304 保证实参恒标量形，递归不产条目（全量性防御） |
| `ref` | —（终态） | **不穿越**：目标别名的子树在其自身别名树遍历中发条目 | ADR 0003 §4 按名引用不内联展开；O(文本规模)；无环（E106） |
| `primitive` / `literal` / `pattern` | —（终态） | 无 | — |

**文法性质**：
- 键段与字段名无碰撞：字段名是标识符（不含 `.` / `<` / 空格），合成段 `<key>`/`<item>`/`<member N>` 不可作字段名——与 index 已依赖的同一性质。
- **每别名树是树遍历**：每个 IR 节点恰在一个路径被访问一次，字段条目路径必唯一（对象内字段名唯一由文法/E308 保证）；唯一可能共享路径的是透明链上的多个标记（§3.3）。
- ref 不穿越 ⇒ 同一被多处方引用的别名（菱形链）条目恰发一次；遍历总量 O(文本规模)，与 ADR 0003 §4「派生物大小恒为 O(文本规模)」同纪律。

### 3.3 同路径嵌套标记的串联策略（显式定形）

透明语义下多个标记可共享同一路径，仅发生于**标记直接套标记**的实参链：

- `YMap<YMap<{…}>>`（E304 允许：YMap 实参 map 形，YMap 即 map 形）——两标记同键 `P`；
- `YMap<YXmlFragment<{…}>>`、`YLeaf<YLeaf<string>>`（E304 允许：YLeaf 实参标量形，YLeaf<string> 即标量形）等同理；
- 常见形不碰撞：`YArray<YLeaf<string>>`（YArray 实参入 `<item>`）、`YMap<{f: YMap<…>}>`（内层在字段位 `P.f`）。

**策略：按源序串联（外层标记在前）**——`markerDocs[P]` 为该透明链上各标记 `docs` 依记号出现序的拼接：

```
appendDocs(table, key, docs):
  if (!Array.isArray(docs)) throw new TypeError(`docs 槽缺失或非数组（手造 IR）：${key}`)   // §3.4 三锚统一守卫（R2）
  table[key] = [...(table[key] ?? []), ...docs]
```

理由：(a) 无丢失（逐字继承纪律——丢弃任一标记的 docs 即静默数据损失）；(b) 确定（源文本序，内容哈希稳定）；(c) 单标记位（一切既有测试与 fixture 形态）退化为该标记自身 docs，与红灯断言逐一相合。红灯契约不含嵌套标记形，本节为补全契约空白的 SA1 定形；如 SA2/总控对串联序另有裁定，仅改 `appendDocs` 的串联行一处（守卫行不动）。

注意 parser 侧机制（parser.ts:431-434 `claimDocs` 直通回收）：**任意标记记号处**（含嵌套实参位）都可为该标记挂 docs，故碰撞形在文法内真实可达，策略必须定形、不可回避。

### 3.4 合法输入下的键位唯一性与防御边界

- `collectDocs` 不做任何 null/undefined 降级。IR 类型声明 `docs` 为必填；**三锚（alias / field / marker）统一经守卫助手写入**（§4.1 `put` / `appendDocs`，R2——SA2 攻击点 #2：R1 版 alias/field 锚为普通赋值，`undefined` 静默落表且 `JSON.stringify` 丢键；marker 锚非数组真值（如字符串 `'foo'`）被 `[...'foo']` 字符级静默展开，两缺陷均堵死）：手造 IR 缺 docs（`undefined`）或 docs 非数组 → `Array.isArray` 守卫抛 TypeError → 落入 `evaluate` 既有顶层 catch 收编为 E100（evaluate.ts:62-65）——与 `resolveChain(undefined)` 抛 TypeError 同款 loud 边界（§2.2「手造 IR」承诺），无静默降级。守卫粒度 = 数组性（`Array.isArray`）；数组**元素**类型不做运行时逐元素校验（TS 类型层职责，与仓内既有边界粒度一致——`resolveChain` 亦只守 `undefined` 不元素校验）。**禁止**把守卫改写为静默规范化（`docs ?? []`）——那是把 loud 边界换成静默降级，方向相反（SA2 R1 明令）。
- Record 键位递归：合法模块键位恒 string 形（E306：primitive/pattern/ref 终态），递归不产条目；保留递归是为手造 IR 下不走查不全即静默通过——违反必产生 loud 错误而非漏报。

---

## §4. 收集算法与红灯对账

### 4.1 伪代码（落点：`evaluate.ts` 新增，~58 行；R2 较 R1 +3——`put` 助手与 `Array.isArray` 双守卫，SA2 攻击点 #2）

```ts
// —— docs 三表收集（ADR 0005 §3 落地；IR 全子树一遍遍历，ref 终态不展开）——

interface DocsTables {
  aliasDocs: Record<string, string[]>;
  fieldDocs: Record<string, string[]>;
  markerDocs: Record<string, string[]>;
}

/** 手造 IR loud 边界守卫（§3.4）：三锚统一写入入口——缺失/非数组抛 TypeError（→ E100），禁止静默规范化。 */
function put(table: Record<string, string[]>, key: string, docs: string[]): void {
  if (!Array.isArray(docs)) throw new TypeError(`docs 槽缺失或非数组（手造 IR）：${key}`);
  table[key] = docs;                             // 单值位：逐字引用（见 4.2 纯度注）
}

function appendDocs(table: Record<string, string[]>, key: string, docs: string[]): void {
  if (!Array.isArray(docs)) throw new TypeError(`docs 槽缺失或非数组（手造 IR）：${key}`);
  table[key] = [...(table[key] ?? []), ...docs]; // §3.3 源序串联
}

function collectDocs(module: VfslModule): DocsTables {
  const tables: DocsTables = { aliasDocs: {}, fieldDocs: {}, markerDocs: {} };
  for (const a of module.aliases) {              // 声明序 → 表插入序（确定性，同 aliases 表）
    put(tables.aliasDocs, a.name, a.docs);       // 三锚统一守卫入口（§3.4，R2）
    walkDocs(a.type, a.name, tables);
  }
  return tables;
}

function walkDocs(t: VfslType, path: string, tables: DocsTables): void {
  switch (t.kind) {
    case 'ref': case 'primitive': case 'literal': case 'pattern':
      return;                                     // 终态：不穿越 ref（ADR 0003 §4）
    case 'object':
      for (const f of t.fields) {
        const p = `${path}.${f.name}`;
        put(tables.fieldDocs, p, f.docs);        // 三锚统一守卫入口（§3.4，R2）
        walkDocs(f.type, p, tables);
      }
      return;
    case 'union':
      t.members.forEach((m, i) => walkDocs(m, `${path}.<member ${i}>`, tables));
      return;
    case 'array':
      walkDocs(t.element, `${path}.<item>`, tables);
      return;
    case 'record': {
      const p = `${path}.<key>`;                  // 合成字段：IR record 无 docs 槽 → 恒空数组
      put(tables.fieldDocs, p, []);               // 字面量 [] 恒过守卫；走统一入口保持同形（R2）
      walkDocs(t.key, p, tables);
      walkDocs(t.value, p, tables);
      return;
    }
    case 'marker': {
      appendDocs(tables.markerDocs, path, t.docs);          // §3.3 串联（守卫同 §3.4，R2）
      const argPath = (t.marker === 'YArray' || t.marker === 'YPlainArray')
        ? `${path}.<item>` : path;                          // YMap/YXmlFragment/YLeaf 透明
      walkDocs(t.arg, argPath, tables);
      return;
    }
  }
}
```

### 4.2 主流程接入（`evaluate` 内，+3 行）

```ts
    const values: Record<string, ValueSchema> = {};
    for (const a of module.aliases) values[a.name] = valueOf(a.type, ctx);
    const docs = collectDocs(module);            // 新增：独立一遍，位于 try 内（异常 → E100）
    return { ok: true, derived: { aliases, structure: rootNode, values, index,
                                   aliasDocs: docs.aliasDocs,
                                   fieldDocs: docs.fieldDocs,
                                   markerDocs: docs.markerDocs } };
```

- **键序**：三个新键按 `aliasDocs` → `fieldDocs` → `markerDocs` 固定顺序排在既有四键之后——同输入同输出（内容哈希确定性），旧形状的前缀字节不变（§2.1 理由 3）。
- **纯度注**：单标记位直接引用 IR 的 docs 数组（「逐字继承」的字面形态；与 index 条目 node 与树内节点共享对象引用的既有显式设计选择同纪律，derived.ts:9-13 不可变契约以类型 JSDoc 声明承载）；串联位必然新建数组。两种形态对 JSON 序列化与 `toEqual` 无差别。

### 4.3 递归深度界

`walkDocs` 递归深度 = IR 类型嵌套深度，受解析层 `MAX_TYPE_NESTING` 上限保护（parser.ts:436-441 同一界已在保护 `structureOf`/`valueOf` 的递归）；联合成员恒非内联联合（文法，resolve.ts:143 注释）、ref 不穿越，故深度严格 ≤ 解析期已付费的界。求值期无需新增迭代化（与既有 `structureOf`/`valueOf` 同款论证，ADR 0003 落地评审已接受该形态）。

### 4.4 红灯断言逐条对账（SA1 模拟推演，非转引）

对 `evaluate-derived-docs-typecls.test.ts` 全部 8 断言，按 §3.2 规则表手工走查两个模块（FIXTURE = 规格 §10；SYNTH = 测试内合成模块）：

| # | 红灯断言 | 命中规则 | 推演结果 |
|---|---|---|---|
| 1 | AC6：`for (a of module.aliases)` 每别名 `aliasDocs[a.name] === a.docs`；具名锚 ROOT/Audit/AssetId（**两项**，连续 doc 按出现序——文件首个悬空 doc 归相邻下一声明 AssetId，spec:418）/AssetEntity/Attachments | 别名树根遍历 | 5 别名各一项，逐字引用 IR 数组 ✓（AssetId 两项为 IR 捕获事实，jsdoc 测试已绿） |
| 2 | AC1+AC2：`fieldDocs['ROOT.notes'] === [' @semantic 可选说明字段 ']` 且与 IR `notes.docs` 逐字一致 | object 字段位 | ROOT 别名树：YMap 透明 → object 透明于 'ROOT' → notes 字段位 `ROOT.notes` ✓ |
| 3 | AC1：`fieldDocs['ROOT.assets']`/`['ROOT.assets.<key>']`/`['ROOT.keywords']`、`markerDocs['ROOT']`/`['Audit']`/`['ROOT.notes']`/`['AssetEntity.<member 2>.tags']` 全部 `=== []` | record 合成 / 别名体根标记 / 字段位标记 / union 成员序 | 逐一走查成立 ✓（`<member 2>` = 第三成员 file，其 `tags: YArray<…>` 标记在字段位） |
| 4 | AC2（SYNTH 全量）：`Entity.<member 0>.kind=[' 变体标记 ']`、`<member 0>.url=[' 图片地址 ']`、`<member 1>.kind=[]`、`<member 1>.body=[' 正文 ']`、`<member 1>.body.paragraphs=[' 段落 ']`（**标记实参内字段位**）、`Box.item=[]`、`ROOT.e/b/n`、`aliasDocs` 三项、`markerDocs['Box']=[' 容器标记 ']`（**别名体根标记**）、`['ROOT.n']=[' 内层标记 ']`、其余空数组锚 | 全规则联立 | 逐项走查成立 ✓（paragraphs 键 = YMap 实参透明：body 字段位 → YMap 透明 → paragraphs 字段位直接拼 `Entity.<member 1>.body.paragraphs`） |
| 5 | AC3：JSON 往返 `toEqual` 全等 + 三表往返后仍在 | 三表纯 string[]/普通对象 | ✓（无函数/undefined；键序无关 `toEqual`） |
| 6 | AC4：`mod.typeCls === undefined` | §5 去 export | ✓ |
| 7 | AC4：`typeof R.typeCls === 'function'` | §5 接口+构造 | ✓ |
| 8 | AC4：`R.typeCls(S)==='scalar'`（字面量联合折叠）、`(M)==='map'`、`(U)==='map'`（ref 成员+内联对象混合 fold）、`(ROOT)==='map'` | §5 语义不变（闭包委托原函数） | ✓（fold 规则不变：全 scalar→scalar；map+map→map） |

**红灯即缺口的实现面**：现状三表缺失 → `slot()` 返回 null → 断言 1-5 以 `expected null to deeply equal …` 失败；`typeCls` 仍自由导出 → 断言 6-8 失败。SA3 实现后 8 条全转绿，转绿路径上**无需修改本测试文件任何断言**。

### 4.5 fixture 全量对账表（SA3 实现后自检；与红灯文本同源逐字）

**FIXTURE（规格 §10）——`aliasDocs`（5 项）**：

| 键 | 值 |
|---|---|
| `AssetId` | `[' vfs3.assets — 依据 issue #9 描述还原（原设计文档缺位） ', ' 资产 ID：键约束由 Pattern 定义，禁 "." 与 "|" ']` |
| `Audit` | `[' 审计信息：所有写入留痕 ']` |
| `AssetEntity` | `[' 资产实体：按 kind 判别的封闭联合 ']` |
| `Attachments` | `[' 附件：与 Yjs 同步无关的纯值数组 ']` |
| `ROOT` | `[' ROOT：命名空间根文档，assets 键集受 AssetId 的 Pattern 约束 ']` |

**FIXTURE——`fieldDocs`（22 项，值全为 `[]` 除 notes）**：
`Audit.createdBy`、`Audit.createdAt`；
`AssetEntity.<member 0>.{kind,url,width,height,audit}`（5）、`AssetEntity.<member 1>.{kind,body,audit}`（3）、`AssetEntity.<member 1>.body.paragraphs`（1，YXmlFragment 实参透明）、`AssetEntity.<member 2>.{kind,name,size,tags,audit}`（5）；
`ROOT.assets`、`ROOT.assets.<key>`（合成）、`ROOT.attachments`、`ROOT.audit`、`ROOT.notes`（= `[' @semantic 可选说明字段 ']`，全表唯一非空）、`ROOT.keywords`（6）。

**FIXTURE——`markerDocs`（18 项，值全为 `[]`；R2 修正——SA2 攻击点 #1：R1 表 15 项在 member 2 处截断，漏 `name`/`size`/`tags.<item>` 三键；SA1 已按 §3.2 规则表对 fixture 独立重走查确认 member 2 与 member 0 同为五字段容器形，无规则差异，R1 属走查疏漏）**：
`Audit`（YMap 体根）、`Audit.createdBy`、`Audit.createdAt`（YLeaf×2）；
`AssetEntity.<member 0>.{url,width,height}`（YLeaf×3）、`AssetEntity.<member 1>.body`（YXmlFragment）、`AssetEntity.<member 1>.body.paragraphs`（YArray）、`AssetEntity.<member 1>.body.paragraphs.<item>`（YLeaf）、`AssetEntity.<member 2>.name`（YLeaf）、`AssetEntity.<member 2>.size`（YLeaf）、`AssetEntity.<member 2>.tags`（YArray）、`AssetEntity.<member 2>.tags.<item>`（YArray 元素位 YLeaf）；
`Attachments`（YPlainArray 体根）、`Attachments.<item>`（YLeaf）；
`ROOT`（YMap 体根）、`ROOT.notes`（YLeaf）、`ROOT.keywords.<item>`（裸 `T[]` 元素位 YLeaf）。

**SYNTH——全量（3 / 9 / 7）**：
`aliasDocs`（3 项）：`Entity=[' 联合实体 ']`、`Box=[' 单例容器 ']`、`ROOT=[]`；
`fieldDocs`（9 项）：`Entity.<member 0>.kind=[' 变体标记 ']`、`Entity.<member 0>.url=[' 图片地址 ']`、`Entity.<member 1>.kind=[]`、`Entity.<member 1>.body=[' 正文 ']`、`Entity.<member 1>.body.paragraphs=[' 段落 ']`、`Box.item=[]`、`ROOT.e=[' 根字段 ']`、`ROOT.b=[]`、`ROOT.n=[' 包内字段 ']`；
`markerDocs`（7 项）：`Box=[' 容器标记 ']`、`ROOT.n=[' 内层标记 ']`、`Box.item=[]`、`Entity.<member 0>.url=[]`、`Entity.<member 1>.body=[]`、`Entity.<member 1>.body.paragraphs=[]`、`Entity.<member 1>.body.paragraphs.<item>=[]`。

**排序全键集对账字面量（R2 升级——SA2 攻击点 #1：计数清点拦不住「计数对而键集错」，本次事故即此形态；SA3 自检 / SA7 补充断言直接以 `[...Object.keys(x)].sort()` 与下方字面量做 `toEqual` 全键集 diff，JS 默认字典序）**：

```js
// 求值 FIXTURE 后（键数 5 / 22 / 18）：
expect([...Object.keys(derived.aliasDocs)].sort()).toEqual([
  'AssetEntity', 'AssetId', 'Attachments', 'Audit', 'ROOT']);
expect([...Object.keys(derived.fieldDocs)].sort()).toEqual([
  'AssetEntity.<member 0>.audit', 'AssetEntity.<member 0>.height', 'AssetEntity.<member 0>.kind',
  'AssetEntity.<member 0>.url', 'AssetEntity.<member 0>.width',
  'AssetEntity.<member 1>.audit', 'AssetEntity.<member 1>.body', 'AssetEntity.<member 1>.body.paragraphs',
  'AssetEntity.<member 1>.kind',
  'AssetEntity.<member 2>.audit', 'AssetEntity.<member 2>.kind', 'AssetEntity.<member 2>.name',
  'AssetEntity.<member 2>.size', 'AssetEntity.<member 2>.tags',
  'Audit.createdAt', 'Audit.createdBy',
  'ROOT.assets', 'ROOT.assets.<key>', 'ROOT.attachments', 'ROOT.audit', 'ROOT.keywords', 'ROOT.notes']);
expect([...Object.keys(derived.markerDocs)].sort()).toEqual([
  'AssetEntity.<member 0>.height', 'AssetEntity.<member 0>.url', 'AssetEntity.<member 0>.width',
  'AssetEntity.<member 1>.body', 'AssetEntity.<member 1>.body.paragraphs',
  'AssetEntity.<member 1>.body.paragraphs.<item>',
  'AssetEntity.<member 2>.name', 'AssetEntity.<member 2>.size', 'AssetEntity.<member 2>.tags',
  'AssetEntity.<member 2>.tags.<item>',
  'Attachments', 'Attachments.<item>', 'Audit', 'Audit.createdAt', 'Audit.createdBy',
  'ROOT', 'ROOT.keywords.<item>', 'ROOT.notes']);
// 附性质断言（结构性封死「漏走某个标记位」类缺陷）：遍历 IR 统计 marker 节点总数 N（fixture 为零碰撞模块），
// 断言 Object.keys(derived.markerDocs).length === N；aliasDocs 键数恒 = module.aliases.length。
```

（排序注：`Audit.createdAt` < `Audit.createdBy`——第 8 字符 `'A'`(0x41) < `'B'`(0x42)；`AssetEntity` < `AssetId`——第 6 字符 `'E'`(0x45) < `'I'`(0x49)。字面量须按此序，勿按声明序手排。）

---

## §5. typeCls 签名收敛（Standards 轴）

### 5.1 改动形态（`resolve.ts`，~10 行）

```ts
/** 解析器能力面（结构树物化与值树映射共用的查询通道）。 */
export interface Resolver {
  bodies: Map<string, VfslType>;
  cls: Map<string, Cls>;
  /** 沿 ref 链迭代取终形（重入/缺席 → Internal；undefined → TypeError）。 */
  resolveChain(t: VfslType | undefined): VfslType;
  /** 任意类型查询 Cls（ref 查表；union 折叠；其余 localCls）——方法形态（issue #29 收敛）。 */
  typeCls(t: VfslType): Cls;
}

export function buildResolver(module: VfslModule): Resolver {
  // ……bodies 构造不变……
  const cls = computeCls(bodies);
  return {
    bodies,
    cls,
    resolveChain: (t) => resolveChain(t, bodies),
    typeCls: (t) => typeCls(t, cls, bodies),   // 闭包委托（沿 resolveChain 先例，resolve.ts:52）
  };
}

// 自由函数去 export（模块内私有；方法委托目标；内部递归 :144 不变）
function typeCls(t: VfslType, cls: Map<string, Cls>, bodies: Map<string, VfslType>): Cls { /* 原体不变 */ }
```

- **语义零变化**：方法体是原自由函数的闭包委托，`fold`/`localCls`/memo 查表逻辑一字不动；内部递归（resolve.ts:144）仍走私有函数。
- **不收窄 `bodies`/`cls` 成员暴露**：本票只增方法（有红灯锚），不做无锚点的接口减法——后续 validateSnapshot 票可能消费这两张表，届时再议。模块头注释「三个能力」措辞随方法化同步微调（注释级改动）。

### 5.2 调用点更新（`evaluate.ts`，2 处）

- `evaluate.ts:20` import 行去掉 `typeCls`：`import { buildResolver, InternalError } from './resolve.js';`
- `evaluate.ts:21` 类型导入行同步去 `Cls`（R2——SA2 攻击点 #3：两调用点方法化后 evaluate.ts 不再引用 `Cls`；tsconfig.base.json 无 `noUnusedLocals`、typecheck 不拦，属整洁性同步而非门禁要求，`verbatimModuleSyntax` 下保留合法但未用）：`import type { Resolver } from './resolve.js';`
- `evaluate.ts:106`：`typeCls(t, ctx.R.cls, ctx.R.bodies)` → `ctx.R.typeCls(t)`；
- `evaluate.ts:140`：`typeCls(r, ctx.R.cls, ctx.R.bodies)` → `ctx.R.typeCls(r)`。

全部调用点清单见 §11 caller 审计表（grep 全仓核实：源内仅此两处 + 内部递归一处，无测试引用旧签名）。

---

## §6. 观察项裁决：判别式放宽到 ref 成员 —— **不纳入本票**

SA5 评估其技术可行（对每成员 `resolveChain` 取终形后按同一 (a)(b)(c) 判据处理）。SA1 裁决不纳入，理由：

1. **无红灯锚点的可观测输出变更，违反本票 TDD 纪律**。判别式虽是非契约缓存（ADR 0003 §3：缺失/存在不改变消费者可观测**行为**），但 `discriminator` 键本身在派生 JSON 内——放宽即改变 ref 成员联合（如 `type E = A | B` 具互异字面量字段）的派生产物与内容哈希。SA6 红灯 8 断言无一锚定此行为；简报纪律「无法复现的缺口不盲修」同构适用于「无锚点的新行为不盲加」——加上即游离于验收之外。
2. **存量面存在反向敏感锚**。`evaluate-derived-schema.test.ts:444/:451` 断言特定联合**不得**携带 `discriminator` 键（`hasOwnProperty` 精确检查）。放宽逻辑若不慎波及判据边界（如经 ref 解析后首成员字段序的取序变化），将触碰这批锚——为无票面义务的收益引入 253 全绿风险。
3. **Scope 纪律**：本票是「契约缺口落地 + 惯例收敛」修补票；混入行为性（哪怕缓存级）变更是 SKILL 文件清单立法所防的典型扩散（issue #176 事故形态）。

**落地约束（给 SA4 的 diff 级护栏）**：`evaluate.ts` 的 `detectDiscriminator`（evaluate.ts:220-257）与 `unionNode`（:215-218）**零改动**——`evaluate.ts` 在 ALLOW LIST 内是文件级许可，本节为其声明改动级边界（见 §8 改动清单）。放宽需求登记为后续观察项（建议随 F2 生成器票评估——TSDoc 判别联合发射时消费者立场才明确，届时先立红灯）。

---

## §7. 兼容性与资源界影响评估

| 维度 | 评估 |
|---|---|
| 存量 253 全绿 | 三表为**纯新增顶层键**：既有断言全部锚在子对象/子树（`aliases['X']`、`values['X']`、`index['…']`、终态/字段精确 `toEqual`），无对 `derived` 顶层键集的穷尽断言（仅 `Object.keys(derived.aliases)`，:485）；同输入两次求值全等断言（:279）两侧同步新增仍全等；JSON 往返断言（:284）三表为纯数据。typeCls 两调用点形态变更对求值结果零影响（语义不变）。**SA5 Evidence 3 基线 253 绿 + 本设计零触碰既有断言 ⇒ 全绿保持** |
| AC5（新断言零改存量形状） | 新槽全部在顶层，`StructureNode`/`MapField`/`ValueSchema`/`ValueField`/`IndexEntry` 形状零改动（§2.1 理由 1 的锚逐一保持） |
| JSON 序列化往返 | 三表值域 `string[]`、键 `string`——纯数据、无函数/undefined/Symbol；往返无损（红灯断言 5） |
| 内容哈希纪律 | 键序固定（声明序遍历 + 固定拼接顺序）；同输入同输出；无行列 |
| O(文本规模) | `collectDocs` 每别名树一遍、ref 终态不穿越——访问节点数 = IR 节点数，无展开爆炸（ADR 0003 §4 同论证）；新增开销与既有 `structureOf`+`valueOf` 两遍同阶 |
| 递归安全 | 深度 ≤ 解析层 `MAX_TYPE_NESTING` 已付费界（§4.3） |
| 公共 API 面 | `index.ts` 零改动：无新导出符号；`DerivedSchema` 经既有 `export type` 透传，形状加必填键（构造方仅 `evaluate` 一处，见 §11） |
| 手造 IR 边界 | docs 缺失/非数组 → 三锚统一守卫（§4.1 `put`/`appendDocs`；R2 修复 R1 版「alias/field 锚 `undefined` 静默落表、`JSON.stringify` 丢键」与「marker 锚非数组真值字符级展开」两缺陷——SA2 攻击点 #2）→ TypeError → 顶层 catch → E100（与既有 `resolveChain(undefined)` 同款 loud 边界，无静默降级） |
| 版本 | `packages/vfsl` 0.1.5 → **0.1.6**（Hard Gate 9：改动该包须 bump patch） |

---

## §8. 实现改动清单（文件 × 改动点 × 行数估算）

| 文件 | 改动 | 行数估算 |
|---|---|---|
| `packages/vfsl/src/derived.ts` | `DerivedSchema` 增三必填槽位声明 + JSDoc（类型文件，仅类型） | +10 |
| `packages/vfsl/src/evaluate.ts` | ① 新增 `DocsTables`/`put`/`appendDocs`/`collectDocs`/`walkDocs`（含 §3.4 三锚 `Array.isArray` 守卫，R2）；② `evaluate` 主流程接入并并入返回值；③ :20 import 行去 `typeCls` + :21 类型导入行去 `Cls`（R2，SA2 #3）；④ :106/:140 两调用点改方法形态。**`detectDiscriminator`/`unionNode` 零改动（§6 护栏）** | +63 / 改 4 |
| `packages/vfsl/src/resolve.ts` | `Resolver` 接口增 `typeCls` 方法声明；`buildResolver` 构造闭包（提 `const cls = computeCls(bodies)`）；`typeCls` 去 `export`；模块头注释能力计数措辞微调 | +8 / 改 3 |
| `packages/vfsl/package.json` | `version` 0.1.5 → 0.1.6 | 1 |

**验证路径**（SA3/SA7 用）：`pnpm exec vitest run packages/vfsl/test/evaluate-derived-docs-typecls.test.ts` → 8 绿；根目录 `pnpm test` → 261 绿（253 存量 + 8 新增）；`pnpm typecheck` → 无新增错误。长脚本一律 `setsid nohup` 后台跑（简报纪律）。

**SA7 动态补充方向**（R2 登记；源自 SA2 R1 评审「红灯测试思路」#1–#3，为攻击点 #1/#2 的验证闭环。SA7 如落地为测试文件，文件名固定 `packages/vfsl/test/evaluate-derived-docs-audit.test.ts`——ALLOW LIST 已列 R2 追加条目；不落地则该条空转，SA4 warning 容忍）：

1. **排序全键集对账**：§4.5 排序字面量三断言（拦「计数对而键集错」——R1 事故形态）+ 性质断言「零碰撞模块 `Object.keys(markerDocs).length` === IR marker 节点总数」（结构性封死漏走标记位）；
2. **手造 IR 三例 E100**：不经 `parseVfsl` 直接构造 module——(a) 某别名 `docs: undefined as any`；(b) 某字段 `docs: undefined as any`；(c) 某标记 `docs: 'foo' as any`（非数组）。每例断言 `result.ok === false` 且 `issues[0].message` 以 `VFSL-E100` 冻结前缀开头；附正向对照（合法 FIXTURE 求值仍 `ok:true`，防守卫误伤正常路径）；
3. **无 `undefined` 值性质断言**：FIXTURE/SYNTH 的 derived 全树遍历，任何层级不出现 `undefined` 值（补 JSON 往返 `toEqual` 对对象内 undefined 键不敏感的盲区——R1 版 alias/field 锚静默 undefined 即此盲区形态）。

SA7 mutation 跑全量 261（聚合类突变可能只被前序回归锚定，单文件跑会漏杀）；§6 护栏（`detectDiscriminator`/`unionNode` 零改动）同时作为 SA7 的 diff 级不动点核对项。

---

## SA2 反馈逐条回应（R1 → R2）

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| #1（HIGH）：§4.5 FIXTURE `markerDocs` 表漏 3 键（`AssetEntity.<member 2>.name`/`.size`/`.tags.<item>`），真值 **18** 项非 15；「22 / 15」清点指令同步错；建议升级为排序全键集 diff | ✅ | §4.5 | markerDocs 表补 3 键、15 → **18**（SA1 按 §3.2 规则表独立重走查 fixture 确认：member 2 与 member 0 同为五字段容器形，R1 属走查截断）；自检指令由计数清点升级为 **排序全键集 `toEqual` diff**，并给出三表排序字面量（5 / 22 / 18）+「marker 节点计数 = 键数」性质断言；SYNTH 节补 3 / 9 / 7 计数；§8 登记为 SA7 动态补充方向 #1 |
| #2（MEDIUM）：§3.4/§7 承诺的「缺 docs/形状异常 → E100」仅 marker 锚成立——alias/field 锚 `undefined` 静默落表（JSON 丢键）、非数组真值（`'foo'`）被字符级展开；须三锚统一守卫，**禁止**静默规范化 | ✅ | §3.3 / §3.4 / §4.1 / §7 | §4.1 新增 `put`（守卫+赋值）与 `appendDocs`（守卫+串联），alias/field/record 合成位三处写入全部改经 `put`、marker 经 `appendDocs`——`Array.isArray` 不满足即抛 TypeError → E100，三锚真实闭环；§3.3 `append` 伪码同步带守卫；§3.4 重写（含守卫粒度声明：数组性，元素类型不逐项运行时校验）；§7「手造 IR 边界」行同步。**未采** `docs ?? []` 静默规范化（SA2 明令禁止方向，§3.4 内显式记禁令）；§8 登记 SA7 补充方向 #2（手造 IR 三例 E100 + 正向对照）与 #3（无 undefined 性质断言，补 `toEqual` 盲区） |
| #3（LOW）：typeCls 方法化后 `evaluate.ts:21` 的 `Cls` 成未用导入（tsconfig 无 `noUnusedLocals` 不拦，整洁问题），§5.2 应补一句 | ✅ | §5.2 | 新增 `evaluate.ts:21` 条目：`import type { Resolver, Cls }` → `import type { Resolver }`（已核 tsconfig.base.json 仅 `verbatimModuleSyntax`、无 `noUnusedLocals`——不构成门禁，纯整洁性同步）；§8 改动清单③同步 |
| #4（LOW）：§2.1 理由 3 把「假设性未来缓存」表述为既存事实（仓内无 derived 内容哈希消费方） | ✅ | §2.1 理由 3 | 措辞改为「**为未来的 F2 编译缓存等潜在消费者**保持旧形状序列化前缀稳定」，并显式注明仓内现存无此消费方（grep 全仓已核）——前缀稳定性设计本身不变，仅口径修正 |

**R2 追加项**（非 SA2 四点之内，属 ALLOW 只增扩展）：`packages/vfsl/test/evaluate-derived-docs-audit.test.ts` `[SA7 owned]` ALLOW 条目 + §8「SA7 动态补充方向」——均转录自 SA2 R1 评审「红灯测试思路」#1–#3，为攻击点 #1/#2 提供验证闭环；不触及任何 SA2 已确认骨架（§2 定形、§3.2 文法、§5 方案、§6 裁决、§8–§9 清单主体均原样）。

---

## §9. 文件清单（File Scope）

### ALLOW LIST

- `packages/vfsl/src/derived.ts` — 修改，`DerivedSchema` 增三必填 docs 槽位类型声明（§2.2，+10 行）
- `packages/vfsl/src/evaluate.ts` — 修改，`collectDocs`/`walkDocs` 新增 + 主流程接入 + typeCls 两调用点方法化（§4/§5.2，+60/改 3）；**改动级护栏：`detectDiscriminator`/`unionNode` 零改动（§6）**
- `packages/vfsl/src/resolve.ts` — 修改，`Resolver` 增 `typeCls` 方法 + 构造闭包 + 自由函数去 export（§5.1，+8/改 3）
- `packages/vfsl/package.json` — 修改，0.1.5 → 0.1.6（Hard Gate 9 版本 bump）
- `packages/vfsl/test/evaluate-derived-docs-typecls.test.ts` — `[SA6 owned]` 红灯/验收测试（已建，8 断言）。SA3 实现转绿过程中**不改断言逻辑**；如需测试基础设施调整须经总控协调后进行
- `packages/vfsl/test/evaluate-derived-docs-audit.test.ts` — `[SA7 owned]` **R2 追加**（SA2 R1 攻击点 #1/#2 验证闭环）：SA7 可选补充验证，承载 §8「SA7 动态补充方向」——排序全键集对账 + 手造 IR E100 三例 + 无 `undefined` 性质断言。SA7 不落地则本条空转（SA4 warning 容忍）；SA3 不得以此文件替代红灯 8 断言的转绿义务

### DENY LIST

- `packages/vfsl/src/ir.ts` — IR 三锚位已是必填 docs（IR §7.2 纪律已落地，ir.ts:26 注释所引），本票不动 IR
- `packages/vfsl/src/index.ts` — 公共面零变化（无新导出；`DerivedSchema` 经既有 `export type` 透传）
- `packages/vfsl/src/tokenizer.ts` / `parser.ts` / `semantic.ts` / `shapes.ts` — 解析层无缺口（SA5 Evidence 1：IR 捕获正常），零改动
- `packages/vfsl/src/errors.ts` — 无新错误码（复用 E100 既有边界）
- `packages/vfsl/test/` 其余 10 个存量测试文件 — AC5：存量 253 断言零改动（含 `evaluate-derived-schema.test.ts` 的全部形状锚）
- `docs/vfsl/v1-spec.md` / `docs/adr/**` — 规格/ADR 修订不在本票（ADR 0005 入库与否是 owner 决策；简报已裁定其内容以简报为唯一权威，建议后续单独立票登记）
- `wiki/raw/**` — 总控/SA 共享文档；`TASK.md` 为调度器工作区文件，不得进入分支 commit（简报纪律）

## §10. 协议假设依据 (Protocol Assumption Evidence)

**无协议级假设**：本设计仅涉及纯代码/类型层改动——TS 类型声明扩展、求值器纯函数内新增一遍 IR 遍历、内部件方法化——不涉及 HTTP/WS 端点行为、端口/进程生命周期、跨 job 资源假设或第三方库行为假设。既有 `evaluate` 的「不抛错 + E100 收编」崩溃边界（源码引用：evaluate.ts:62-65）是本设计依赖的唯一运行时行为，属源码可核事实而非假设。

## §11. 契约改动连锁审计 (Contract Change Caller Audit)

### 改动函数 / 类型

| 函数/类型 | 文件 | 改动前契约 | 改动后契约 |
|---|---|---|---|
| `typeCls`（自由函数导出） | `packages/vfsl/src/resolve.ts:129` | `export function typeCls(t, cls, bodies): Cls`——模块级导出，调用方解包两张表 | **去 export**（模块内私有）；Resolver 增方法 `typeCls(t): Cls`（闭包委托，语义/返回值/抛错行为逐字不变——同步、非 async、无新增 throw 路径） |
| `Resolver`（接口） | `packages/vfsl/src/resolve.ts:30` | 三成员（bodies/cls/resolveChain） | 增 `typeCls` 方法成员（纯增量） |
| `DerivedSchema`（公共导出类型） | `packages/vfsl/src/derived.ts:69` | 四键 | 增三必填键 `aliasDocs`/`fieldDocs`/`markerDocs`（纯增量；唯一构造方是 `evaluate`） |

### Caller 清单

| Caller | 文件:行号 | 是否 await | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---|---|---|---|---|
| `typeCls` 调用点 ① | `packages/vfsl/src/evaluate.ts:106`（structureOf union 分支） | N/A（同步） | ❌ 裸调用 | ✅ `evaluate` 顶层 try → E100（evaluate.ts:62-65） | 改 `ctx.R.typeCls(t)`（§5.2）；异常路径不变 |
| `typeCls` 调用点 ② | `packages/vfsl/src/evaluate.ts:140`（materializeMapForm E304 守卫） | N/A（同步） | ❌ 裸调用（throw InternalError 属既有正常路径） | ✅ 同上 | 改 `ctx.R.typeCls(r)`（§5.2） |
| `typeCls` 内部递归 | `packages/vfsl/src/resolve.ts:144`（union 成员 fold） | N/A | N/A（私有函数自递归） | 经调用点①②汇入顶层 | **不改**（私有函数签名未变） |
| `DerivedSchema` 构造方 | `packages/vfsl/src/evaluate.ts:61`（全仓唯一构造点，grep 核实） | N/A | ✅ 构造位于顶层 try 内 | ✅ 同上 | 本设计 §4.2 并入三表 |
| `DerivedSchema` 类型消费方 | `packages/vfsl/src/index.ts:36`（`export type` 透传）；两个测试文件以**自有局部结构类型**标注（evaluate-derived-schema.test.ts:90 / evaluate-derived-docs-typecls.test.ts 经 `unknown` 收窄），只读不构造 | N/A | N/A | N/A | 零改动：结构类型只读加键不破坏可赋值性；无任何外部 implementor |
| `evaluate` 公共导出消费方 | 全仓 grep：仅上述两个测试文件 | N/A | N/A | N/A | 返回值纯加键，既有断言无顶层穷尽（§7 行 1） |

### 风险评估

- **遗漏 caller 的代价**：`typeCls` 若有未列调用点将编译失败（去 export 后私有）——typecheck 即拦截，无运行时风险；`DerivedSchema` 加必填键若有未列构造点同样编译失败。二者均属「编译期自愈」型契约变更。
- **抓全方法**：`grep -rn "typeCls" --include="*.ts" packages/`（本次设计期已跑，输出 = §5.2 两调用点 + 定义/递归 + 红灯测试断言，无其他）；`DerivedSchema` 消费面 grep 输出见设计期记录（derived.ts/index.ts/evaluate.ts + 两测试局部类型）。

---

*R2 设计期自测记录（本轮增量）：§4.5 markerDocs 18 键由 SA1 按 §3.2 规则表对 fixture（spec §10 与红灯测试内嵌文本已比对逐字同源）独立重走查，member 2 五字段（kind/name/size/tags/audit）与 member 0（kind/url/width/height/audit）逐一核对无截断；fieldDocs 22 / SYNTH 3-9-7 同法复算。排序字面量按 JS 默认字典序逐键排定，两处易错序显式留注（`createdAt` < `createdBy`、`AssetEntity` < `AssetId`）。源码行号复核：evaluate.ts:20/:21 import 行、:62-65 顶层 catch、resolve.ts:129/:144、detectDiscriminator evaluate.ts:220、tsconfig.base.json:12（`verbatimModuleSyntax`，无 `noUnusedLocals`）、index.ts 无 resolve 透传。存量计数复跑 `grep -cE "^\s*(it|test)\("`（253 存量 + 8 红灯 = 261）。R1 期自测记录：红灯断言逐条走查（§4.4）、typeCls/DerivedSchema 消费面 grep 全仓核实（§11）。*
