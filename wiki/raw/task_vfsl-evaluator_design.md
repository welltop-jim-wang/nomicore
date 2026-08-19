# SA1 设计 — 求值器核心：evaluate 公共导出与派生 schema（issue #20）

- **Worktree**: `/home/wangjian/nomicore-fix-issue-20`（branch `fix/issue-20-on-adr-union-representation`）
- **任务类型**: 功能开发（Feature）
- **修订轮次**: R2（2026-08-19）——响应 SA2 reject 评审 #1 CRITICAL + #2~#4 MAJOR + #5~#7，另含 R2 自寻漏洞 #8（SA2 未列、test.ts:581 必红锚点）。逐条回应表与修订记录见文末
- **输入契约**: `wiki/raw/task_vfsl-evaluator.md`（简报）+ `packages/vfsl/test/evaluate-derived-schema.test.ts`（SA6 红灯，37 条）+ `docs/adr/0003-evaluator-derived-schema.md`（四决策，不得违反）+ `docs/vfsl/v1-spec.md` §2/§3/§10 + `wiki/raw/task_vfsl-evaluator_sa2_review.md`（R2 修订指令源）
- **现状基线**: `pnpm typecheck` 恰两条红（TS2305 缺 `evaluate` 导出 + parseOk 处级联 TS2322）；`pnpm vitest run packages/vfsl/test/evaluate-derived-schema.test.ts` 37 条全红（`evaluate is not a function`），既有 216 条 parse 测试全绿
- **术语**: 以 `CONTEXT.md` 词汇表为准（求值器 / 派生 schema / 结构树 / 值 schema / 路径索引 / ROOT / 标记类型）

---

## §1. 需求推演（Feature 切入点）

### 1.1 现有边界

- 解析层（tokenizer/parser/semantic/shapes）已冻结：`parseVfsl(text) → { ok, module | issues }`，产出 IR（`VfslModule`，纯数据、无行列）。#19 已合入 E310/E311（ROOT 存在性 + map 形），**求值器的全部形状前提在解析层已收口**。
- `index.ts` 当前唯一函数导出 `parseVfsl` + IR 类型族。ADR 0003 §1 把 `evaluate` 立为**第二公共导出**。
- `evaluate` 的输入是 **IR**（`VfslModule`），不是文本、不是 AST——AST 带位置且不出 `parseVfsl` 进程内边界，`shapes.ts` 的 clsOf/memo 体系构建在 AST 上，**不能直接复用其代码**，只能复用其算法模式（ADR 0003 §4 原文「复用 shapes.ts 的 clsOf/memo 模式」）。

### 1.2 数据流定位

```
文本 --parseVfsl--> IR(VfslModule) --evaluate--> 派生 schema(DerivedSchema)
                                              结构树 + 值 schema + 路径索引 + 别名表
```

- 求值 = **纯函数**：IR → 派生物。无 IO、无时钟、无随机；同输入两次调用输出结构全等（AC 断言）。
- 派生物的四个消费者（后续票）：validateSnapshot（值树 + 判别式 + no-match 接缝）、路径下钻守卫（结构树 + 索引 + ref 穿透）、AI namespace card、编译缓存（内容哈希 = JSON 序列化纪律的直接动机）。

### 1.3 本设计的四个自由度（测试契约未钉死、须显式决策）

测试契约类型冻结了节点 kind 集合与字段形状，但四处映射规则测试未完全覆盖，本设计显式决策（SA2 攻击点预埋；F4 为 R2 新增）：

| # | 自由度 | 决策 | 依据 |
|---|---|---|---|
| F1 | `YMap<T>` 实参为**联合**时结构树如何表示 | **union 节点透传**（成员按各自形状物化，**结构形** ref 成员保持 ref 终态），**不做**键空间合并成单 map | O(文本规模) 论证（§8.2）+ any-of 下钻语义与「键空间 = 各成员键集之并集」等价（spec §3 YMap：未被任何成员声明的键拒绝 = any-of 存在性）；合并式表示在链式 `YMap<Z_{n-1} \| {a_n}>` 下派生物退化 O(text²)，且同名字段跨成员归并引入无测试锚点的歧义政策 |
| F2 | `Record<K,V>` 在**值 schema** 中的表示 | `object` 变体 + 字段 `{ name: '<key>', value: V 的值 schema }` + **可选扩展属性 `keyPattern?`**（K 解析为 Pattern 时携带解码后正则） | 值语义需要键约束（未来 validateSnapshot 校验 Record 值的键）；类型层与测试契约可赋值兼容（§2.3 论证）；`<key>` 名与索引段约定共享 |
| F3 | 判别式缓存的**附加条件与字段选定规则** | 仅当联合**全体成员为内联对象字面量**（IR `kind:'object'` 直达），且存在公共非可选字面量字段、值两两互异；**多候选时取首成员字段声明序中最先满足者**（R2 钉死，SA2 #3） | ADR 0003 §3 定性缓存为「非契约缓存，缺失/存在不改变可观测行为」——保守附加条件把行为风险压到零；fixture（全部内联成员）命中，两负例不命中；确定性选定规则见 §5.2（跨版本内容哈希稳定） |
| F4 | 字段位 ref 的**链终点为无子终态**（plain / leaf / xml-fragment）时是否内联 | **内联**：`resolveChain` 终点为无子终态 → 直接产出该终态节点（O(1) 复制）；终点为结构形（map / array / union）→ 保持 `{kind:'ref', name}` 按名引用 | **R2 新增（自寻漏洞 #8，SA2 未列）**：三条测试锚点联立强制——test.ts:581 `resolvePath('ROOT.attachments')` 必须 `'plain'`（ref→YPlainArray 别名），test.ts:553-555 `index['ROOT.audit'].node` 必须 ref（ref→YMap 别名），test.ts:497-501 菱形 l/r 必须 ref（ref→对象别名）；`walkFrom` 终态原样返回（test.ts:221，`i >= segments.length` 先于 ref 穿透分支）→ 「字段位 ref 一律终态」与「一律解析」都必红，唯一一致解 = 按链终点形状分流。语义对齐 spec §3「判定在别名解析后进行，沿别名链取最终形状」；规模上无子终态无子树，每出现位 +O(1)，O(文本规模) 保持（§8.2）；ADR 0003 §4 按名引用主线不受侵蚀（结构形仍按名，菱形 2^N 不炸） |

---

## §2. 公共接缝与类型族冻结

### 2.1 新文件 `src/derived.ts`（类型族，冻结形状）

```ts
/** 判别式缓存（非契约缓存，ADR 0003 §3）。 */
export interface Discriminator {
  field: string;                          // 判别字段名
  byValue: Record<string, number>;        // String(字面量值) → 成员序号（声明序插入）
}

/** 结构树节点（Yjs 物化语义；ref / leaf / plain / xml-fragment 为终态）。 */
export type StructureNode =
  | { kind: 'root'; node: StructureNode }                       // ROOT 入口（仅 structure 与 index['ROOT'] 出现）
  | { kind: 'map'; fields: MapField[] }                         // Y.Map 封闭键空间（字段声明序）
  | { kind: 'array'; element: StructureNode }                   // Y.Array
  | { kind: 'xml-fragment' }                                    // 不透明终态（ADR 0003 §5）
  | { kind: 'leaf' }                                            // 原生叶子值（标量形物化）
  | { kind: 'plain' }                                           // YPlainArray 子树纯值上下文终态
  | { kind: 'union'; members: StructureNode[]; discriminator?: Discriminator }
  | { kind: 'ref'; name: string };                              // 按名引用，不内联展开（ADR 0003 §4）

export interface MapField {
  name: string;                        // Record 的动态键段固定名 '<key>'
  optional: boolean;
  node: StructureNode;
}

/** 值 schema（值类型语义，与结构树正交）。 */
export type ValueSchema =
  | { kind: 'object'; fields: ValueField[]; keyPattern?: string }   // keyPattern 仅 Record 物化位携带（决策 F2）
  | { kind: 'array'; element: ValueSchema }
  | { kind: 'xml' }
  | { kind: 'union'; members: ValueSchema[]; discriminator?: Discriminator }
  | { kind: 'enum'; values: Array<string | number> }               // 字面量（联合）→ 枚举，声明序
  | { kind: 'pattern'; regex: string }
  | { kind: 'scalar'; type: 'string' | 'number' | 'boolean' | 'null' | 'unknown' }
  | { kind: 'optional'; value: ValueSchema }                        // 仅对象字段 ?: 包装
  | { kind: 'ref'; name: string };

export interface ValueField {
  name: string;
  value: ValueSchema;
}

/** 路径索引条目。 */
export interface IndexEntry {
  match: 'exact' | 'pattern';
  keyPattern?: string;                // 仅 Record 键段 '<key>' 且 K 解析为 Pattern 时携带
  node: StructureNode;
}

/** 派生 schema（求值器产出；纯数据、可 JSON 序列化、无行列——内容哈希纪律）。
 *  不可变契约（R2，SA2 #7）：派生物对消费者不可变——index 条目 node 与树内节点为
 *  同一对象引用（O(文本规模) 的显式设计选择），突变 index['ROOT'].node 会交叉污染
 *  structure。v1 以类型 JSDoc + 本设计文档声明承载，不 Object.freeze（评估见 §8.3）。 */
export interface DerivedSchema {
  aliases: Record<string, StructureNode>;   // 别名表：IR 同构（ref 不展开，含 ROOT）
  structure: StructureNode;                 // 入口：root 节点包裹 ROOT 的 map 物化
  values: Record<string, ValueSchema>;      // 每别名的值语义
  index: Record<string, IndexEntry>;        // ROOT 起 '.' 连接的语法路径 → 条目
}

export type EvaluateResult =
  | { ok: true; derived: DerivedSchema }
  | { ok: false; issues: VfslIssue[] };
```

### 2.2 `evaluate` 签名（第二公共导出）

```ts
export function evaluate(module: VfslModule): EvaluateResult;
```

- 同步、纯函数、**不抛错**：任何内部异常经顶层 catch 转为 `{ ok: false, issues: [makeIssue(ErrCode.E100, …内部错误（意外异常）: <detail>, 1, 1)] }`——与 `parseVfsl` 的 §15.4 崩溃边界**逐项同款**（R2，SA2 #5）：`detail = err instanceof Error ? err.message : String(err)` 镜像 index.ts:46 的 instanceof 守卫（内部若 throw 非 Error，`.message` 直取会得到 `'undefined'`，丢错误信息）；issue 经 `makeIssue`（errors.ts）构造，保证 `VFSL-E100:` 冻结前缀与 parseVfsl 侧一致。结构化 E100 非虚假降级：该路径命中 = 实现缺陷，不得视为通过。
- issues 形状复用 `VfslIssue`（ADR 0003 后果节）。求值期失败模式当前为空集（ROOT 检查在解析层；按名引用使展开无引擎级预算）——`ok:false` 分支是前向兼容接缝，调用方从第一天写 ok 检查。
- **前置条件（公共契约注释写明）**：`module` 须为 `parseVfsl` 的 `ok:true` 产物。手工构造的 IR（含环、未声明名、非 map 形 ROOT）落入 §9 的 loud 内部错误边界，不静默产出垃圾派生物。
- **前置检查不做形状校验**：不校验 `module.kind` / 字段完整性——畸形输入在解构时抛 TypeError，被顶层 catch 收编为 E100。不为「不可能输入」写防御分支（虚假降级禁令）。

### 2.3 类型可赋值性论证（typecheck 必须由红转绿且不再新增错误）

测试文件以本地类型 `EvaluateResult` 作注解接收 `evaluate(...)` 返回值（test.ts:157 等），要求**我的导出类型结构上可赋值**给测试契约类型：

- `StructureNode` / `MapField` / `Discriminator` / `IndexEntry` / 顶层容器：与测试契约逐字段一致。
- `ValueSchema` 的 `object` 变体多出可选属性 `keyPattern?: string`（决策 F2）。TS 宽度子类型：非字面赋位下额外属性不影响可赋值性（excess property check 仅作用于对象字面量），`{ kind:'object'; fields; keyPattern? }` → `{ kind:'object'; fields }` 成立。**未新增任何 kind**——新增 `record` kind 会破坏判别联合可赋值性，故 Record 必须落在既有 kind 内（F2 的直接约束来源）。
- `exactOptionalPropertyTypes: true` 纪律（tsconfig.base 已开）：**禁止写 `discriminator: undefined` / `keyPattern: undefined`**。未附加时整个键不得存在——红灯负例用 `hasOwnProperty` 断言键缺席（test.ts:442/449），且 `toEqual` 对显式 undefined 键敏感。构造方式：条件展开 `...(d ? { discriminator: d } : {})` 或先建基对象再赋值。

---

## §3. 求值主流程与共享解析器

### 3.1 新文件 `src/resolve.ts`（包内共享解析器，ADR 0003 §4）

求值期一切「沿别名链取最终形状」的动作集中于此模块（内部件，不进公共面；后续 validateSnapshot 票复用）。三个能力：

```
（1）bodies: Map<string, VfslType>          // 别名名 → 身体（module.aliases 一次展开；E302 保证名唯一）
                                            //   构造期维护 seen 名集合：遇重名 → throw Internal
                                            //   （R2，SA2 #4：ok 模块不可能——E302 已挡；手造 IR 可能。
                                            //     不做 Set 检查则后者静默覆盖前者，产出 ok:true 垃圾派生物，
                                            //     是 I1~I6 中唯一无 loud 处置的缺口——一个 Set 检查补全）
（2）resolveChain(t): VfslType              // 迭代循环：t 为 ref 则取 bodies[name] 续走，直到非 ref
                                            //   重入检测（in-flight 名集合）→ throw Internal（E106 不变量，§9）
（3）computeCls(bodies): Map<string, Cls>   // Cls = 'scalar' | 'map' | 'container'（IR 侧三桶折叠）
```

`computeCls` 为**名字级 memo 帧栈迭代**（`shapes.ts computeStrForm` 第二步同款：memo-on-completion，E106 保证纯 DAG）：

```
局部归类 localCls(t)（不接受 ref/union——查询位经 typeCls）：
  primitive | literal | pattern            → 'scalar'
  object | record                          → 'map'
  array                                    → 'container'
  marker: YMap→'map'; YArray|YXmlFragment→'container'; YLeaf|YPlainArray→'scalar'
    （YPlainArray 上下文无关按标量形——spec §3 标记成员形状归类，与 shapes.ts localCls 逐行对齐；
      localCls 对标记实参不下降——镜像 shapes.ts localCls，computeCls 不进入 YPlainArray 子树）

typeCls(t)：
  ref    → computeCls 表查询（名不在 bodies → throw Internal，E301 不变量）
  union  → fold(members.map(typeCls))      // 成员恒非内联联合（文法），ref 成员查表（深度 = 图直径，非嵌套深度）
  其余   → localCls(t)

fold(values)（镜像 shapes.ts synthesize 的 ok 模块可达子集）：
  全 scalar                    → 'scalar'
  无 scalar，全 map            → 'map'
  无 scalar，含 container      → 'container'
  scalar 与 map/container 并存 → throw Internal（E309 不变量：**非纯值全域**的混合联合已被解析层拒绝）
```

#### E309 安全论证链：三防线（R2，SA2 #2）

fold 的 Internal throw 在 ok 模块上输入为空集，依赖**三条**防线叠加——R1 只隐含了第一条的一半，此处显式立论：

| # | 防线 | 层 | 依据（可定位） |
|---|---|---|---|
| D1 | **E309 在非纯值全域拒绝混合联合**（非仅「同步上下文」的某个子集）——模块级 walk 收集一切 `kind === 'union'` 且 `!inPV` 的节点做桶级扫描；`inPV` 旗标**仅在 YPlainArray 文本实参子树内置真** | 解析层 | `shapes.ts:660-667`（`walkModule(a.type, false, …)` 起点 + `t.kind === 'union' && !inPV` 收集条件）、`shapes.ts:44-67`（walkModule 仅 YPlainArray 分支置真 inPV）、`shapes.ts:691`（逐联合 checkE309）；spec §3「同步物化上下文」= 非纯值全域 |
| D2 | **structureOf 对 YPlainArray 不递归**（折叠规则 4：整个实参子树 `{kind:'plain'}` 终态）——纯值上下文内**合法的**混合联合（如 `YPlainArray<string \| {a:number}>`，D1 不裁决）永不到达 structureOf 的 union 行，typeCls/fold 不被查询 | 求值器 | §4.1 marker YPlainArray 行；对应红线：`items` 字段断言 `{kind:'plain'}`（SA2 复审红线构思 #2） |
| D3 | **valueOf 不做桶折叠**——值树 union 行只区分「全字面量 → enum」与「否则 union 节点」，不咨询 typeCls/fold；纯值上下文联合在值树侧按成员结构直映（scalar / object 并存的 members 合法） | 求值器 | §6 union 行；对应红灯：`values['ROOT']` 中 items 为 `array(union members:[scalar, object])`（两树正交断言） |

D1 收窄措辞的修正：R1 §3.1/§9 写「同步上下文混合联合已被解析层拒绝」，**比实际检查范围窄**——shapes.ts 的收集条件是全域 walk 加 `!inPV` 过滤，即**非 PV 全域**（对象字段 / 数组元素 / Record 值位 / 标记实参 / 别名身体全部在内），不存在「某些同步位不受检」的读法空间。SA3 实现时以本表为准。

### 3.2 主流程（新文件 `src/evaluate.ts`）

```
function evaluate(module: VfslModule): EvaluateResult {
  try {
    const R = buildResolver(module);              // §3.1 三能力
    const index: Record<string, IndexEntry> = {}; // 索引行在 ROOT 物化遍历中就地填充（§7）
    const aliases: Record<string, StructureNode> = {};
    for (const a of module.aliases)               // IR 声明序 → 表插入序（确定性；Object.keys 断言依赖）
      aliases[a.name] = structureOf(a.type, R, null);
    const rootNode: StructureNode = { kind: 'root', node: structureOf(R.resolveChain(ROOT 身体), R, 'ROOT') };
    index['ROOT'] = { match: 'exact', node: rootNode };
    const values: Record<string, ValueSchema> = {};
    for (const a of module.aliases) values[a.name] = valueOf(a.type, R);
    return { ok: true, derived: { aliases, structure: rootNode, values, index } };
  } catch (err) {
    // §2.2 崩溃边界（R2，SA2 #5）：instanceof 守卫镜像 index.ts:46 parseVfsl 同款；
    // makeIssue 保证 'VFSL-E100:' 冻结前缀构造一致（errors.ts）
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, issues: [makeIssue(ErrCode.E100, `内部错误（意外异常）: ${detail}`, 1, 1)] };
  }
}
```

- `ROOT 身体 = aliases.find(a => a.name === 'ROOT').type`；缺席（手造 IR）→ `resolveChain(undefined)` 抛 TypeError → 顶层 catch 收编（E310 已保证合法模块必有）。
- `structure` 与 `aliases['ROOT']` 的关系是本设计的关键不对称，显式钉死：
  - `aliases['ROOT'] = structureOf(ROOT 身体, path=null)`——**IR 同构**：身体是结构形 ref 则 `{ kind:'ref', name }`（菱形测试 `aliases` 含 17 项、ROOT 项为 ref A0；身体链终点为无子终态时按 F4 内联）；
  - `structure.node = structureOf(resolveChain(ROOT 身体), path='ROOT')`——**入口解析**：沿 ref 链走到首个非 ref 类型再物化（菱形测试 `root.node` 为 A0 的 map 物化，字段 l/r 为 ref A1 终态）。三个解析点（ROOT 链 / YMap 实参链 / Record 值位链）见 §4.2。

---

## §4. 结构树物化规则

### 4.1 折叠规则全景表（`structureOf(t, R, path)`）

| IR 类型 | StructureNode | 说明 |
|---|---|---|
| `primitive` / `literal` / `pattern` | `{ kind:'leaf' }` | 标量形物化 |
| `ref` | 按链终点分流（决策 F4，R2）：`r = resolveChain(t)`；r 为无子终态物化形（plain / leaf / xml-fragment）→ 直接产出该终态节点；否则 `{ kind:'ref', name }` | **结构形 ref 终态不展开**（例外 = §4.2 三解析点）；**无子终态 ref 内联**——每出现位 O(1) 复制，O(文本规模) 保持，且恢复查询期可见性（`walkFrom` 终态原样返回不穿透，见 F4 依据）。判别实现：`r.kind === 'marker' && r.marker === 'YPlainArray'` → plain；`r.kind === 'marker' && r.marker === 'YXmlFragment'` → xml-fragment；`r.kind ∈ {primitive, literal, pattern}` 或 `r.kind === 'marker' && r.marker === 'YLeaf'` → leaf；其余（object / record / array / union / marker YMap / marker YArray）→ ref 终态 |
| `object` | `map(fields)` | 规则 1 正：裸对象 → map；字段声明序（E308 保证无重名） |
| `array` | `array(structureOf(element))` | 规则 2 正：裸 `T[]` → array |
| `record` | `map([{ name:'<key>', optional:false, node: structureOf(resolveChain(value), R, …) }])` | Record 默认物化 Y.Map（spec §3 表第 3 行）；**值位先沿 ref 链取终形再物化 = §4.2 解析点③（R2，SA2 #1）**——spec §3 表第 5 行明文联合三分类「适用于字段类型、数组元素、Record 值位与标记实参」，紧随段落直以 fixture 为例：「`Record<AssetId, AssetEntity>` 即此——`AssetEntity` 的每个联合成员按其对象形状物化为 Y.Map」。`<key>` 为固定段名（标识符文法不含 `<`，与真实字段名无碰撞） |
| `union`（全标量形：`typeCls === 'scalar'`） | `{ kind:'leaf' }` | **规则 3**：全标量联合 → 原生叶子；成员细节入值 schema 枚举（两树正交） |
| `union`（其余） | `{ kind:'union', members, discriminator? }` | 分支列表（any-of）；成员按各自规则物化（内联对象 → map、**结构形** ref → ref 终态——ok 模块中 union 节点内 ref 成员恒为容器形：纯值形成员使联合全标量、已被规则 3 折叠为 leaf，内联分支实际不可达）；判别式见 §5 |
| `marker YMap` | `materializeMapForm(arg)`（§4.2 解析点②） | 显式 Y.Map 物化 |
| `marker YArray` | `array(structureOf(arg))` | 元素可为任意形（含联合 → 按上两行折叠） |
| `marker YXmlFragment` | `{ kind:'xml-fragment' }` | 不透明终态；实参**整体丢弃**（ADR 0003 §5：实参字段为文档性质） |
| `marker YLeaf` | `{ kind:'leaf' }` | 实参形状已由 E304 保证标量 |
| `marker YPlainArray` | `{ kind:'plain' }` | **规则 4**：整个实参子树纯值上下文终态，**不递归**（子树内裸对象/裸数组/混合联合不再物化——四规则反例断言的落点；E309 三防线 D2，§3.1） |

### 4.2 三个解析点 + 无子终态内联（ref 在结构树中的全部非按名位；R2 修订）

R1 表述「唯二非终态位」漏了 Record 值位（SA2 #1 CRITICAL）与无子终态内联（R2 自寻 #8）。结构树中 ref 的处置共四类，全部枚举于此——**除此之外不存在第五种 ref 行为**，SA3 实现以本节为唯一权威：

**解析点① — ROOT 入口**（§3.2 已给出）：`resolveChain(ROOT 身体)` 后物化。合法落点（E311 已收口为 map 形）：`object` → map；`record` → map+`<key>`（值位走解析点③）；`marker YMap` → 解析点②；`union`（全 map 形）→ union 节点（`root.node.kind === 'union'`，成员为 map/ref——any-of 下钻语义，无测试但契约自洽）。Record 形 ROOT（E311 允许）即经此入口落 §4.1 record 行：`type ROOT = Record<string, Audit>` → `root.node` 为 map、`ROOT.<key>` 索引行在场、node 为 Audit 的 map 物化（SA2 复审红线构思 #1 第三条）。

**解析点② — YMap 实参**：

```
materializeMapForm(arg):
  r = resolveChain(arg)                    // 迭代，沿 ref 链到非 ref
  switch r.kind:
    'object'  → map(r.fields 逐字段物化)     // fixture: Audit / ROOT
    'record'  → map([{ '<key>', false, structureOf(resolveChain(r.value)) }])
                                            // R2：值位解析（解析点③，与 record 行同规则——
                                            // 本分支是 R1 的同源漏洞点，随 #1 一并修复）
    'union'   → unionNode(r)                // 决策 F1：透传，成员物化、结构形 ref 成员保持 ref 终态
    'marker YMap' → materializeMapForm(r.arg)   // 嵌套 YMap<YMap<…>>（嵌套深度 ≤ MAX_TYPE_NESTING=100）
    其他 → throw Internal（E304 不变量：YMap 实参必为 map 形）
```

**解析点③ — Record 值位**（R2 新立，SA2 #1）：

```
record 行物化值位时：
  v = resolveChain(r.value)                // 迭代，沿 ref 链到非 ref——一律解析，非「联合特判」
  structureOf(v) 按全景表落行：
    object        → map（增量反例锚：Record<string, Audit> → node.kind === 'map'，字段 x 在场，
                    SA2 复审红线构思 #1 第二条——钉死「一律解析」而非「仅联合解析」）
    record        → 递归同规则（值位再走解析点③）
    union         → 全标量形 → leaf（规则 3）；否则 unionNode（fixture 锚：Record<AssetId, AssetEntity>
                    → node.kind === 'union'，三成员各为 map，test.ts:559/576/599-602）
    marker        → 按标记行（YMap → 解析点②；YPlainArray → plain；YXmlFragment → xml-fragment；…）
    primitive / literal / pattern → leaf（Record<string, number> 之类标量值位）
  // 落行集合对 ok 模块封闭：混合联合值位已被 E309 拒绝（§3.1 D1，Record 值位属非 PV 全域）；
  // 标量形与容器形各按本表落行，无 Internal 路径新增（marker YArray 值位 → array 行，合法）
```

**无子终态内联（决策 F4，R2 自寻 #8）**：ref 行（§4.1）按 `resolveChain` 终点分流——终点为无子终态（plain / leaf / xml-fragment）时直接产出终态节点，结构形保持按名 ref。三条测试锚点联立的强制解（推导见 §1.3 F4 依据列）：

| 锚点 | 断言 | 对 ref 行为的约束 |
|---|---|---|
| test.ts:581 | `resolvePath('ROOT.attachments')?.kind === 'plain'`（`attachments: Attachments`，ref → YPlainArray） | 无子终态 ref **必须内联**（`walkFrom` 终态原样返回，ref 不穿透） |
| test.ts:553-555 | `index['ROOT.audit'].node` 为 `{kind:'ref', name:'Audit'}`（ref → YMap，结构形） | 结构形 ref **必须按名** |
| test.ts:497-501 | 菱形 `root.node.fields` l/r 为 `{kind:'ref', name:'A1'}`（ref → 对象，结构形） | 结构形 ref **必须按名**（且不可整体解析——菱形 2^N 界） |

「字段位 ref 一律终态」与「字段位 ref 一律解析」各必红一条；唯一全绿解 = 按链终点形状分流。该规则统一适用于 structureOf 的一切 ref 到达位（对象字段 / 数组元素 / 别名身体），不限于字段位——一致性与拼写无关性（`attachments: Attachments` 与 `attachments: YPlainArray<…>` 产出同形节点）是其语义依据；O(1) 复制是其规模依据。

**两树在 Record 值位的不对称（R2 显式声明，SA2 #1 修订要求 3）**：结构树侧 Record 值位**解析**（本节解析点③，测试契约要求）；值 schema 侧 Record 值位**仍 ref 终态**（§6「永不解析 ref」原则不动——`values` 有自己的别名表支撑穿透）。SA3 不得在值树侧画蛇添足（解析 values 的 record 值），也不得漏做结构侧。

除上述四类处置（①②③ + 无子终态内联）外，**一切结构形 ref 均为按名终态**——这是 O(文本规模) 的充分条件（§8.2 论证）。

### 4.3 物化递归的栈安全

`structureOf` 只沿 IR 类型嵌套递归（对象字段 / 数组元素 / 标记实参 / 联合成员），深度受解析层 `MAX_TYPE_NESTING = 100` 硬预算约束（parser.ts:24）；结构形 ref 按名终态不引起递归，无子终态 ref 内联（F4）经 `resolveChain` 迭代取终点后产出无子节点、亦不引入递归。**ref 链的任意长度**（`type A1 = A2; … ` 百万级线性链，每行嵌套深度 1，不触发解析层预算）由 `resolveChain` 的迭代循环吸收。两界叠加：递归栈深 O(100)，链遍历 O(链长) 无栈增长。

---

## §5. 联合：分支列表与判别式缓存（ADR 0003 §3）

### 5.1 分支列表基础表示

- `{ kind:'union', members }`，成员声明序、**完整子树**（no-match 诊断「失败距离最小成员」+「联合成员 i/N」的数据基础——编号即数组下标 +1，N 即长度；本票只预置数据，距离计算属 validateSnapshot 消费）。
- 匹配语义 any-of、路径存在性 = 任一成员存在——引擎侧不写匹配代码（本票无匹配行为），该语义由**表示本身**（分支列表 + 查询期遍历，测试 `walkFrom` 的 union 分支即消费者范例）承载。

### 5.2 判别式检测（决策 F3：保守附加 + 确定性字段选定）

```
detectDiscriminator(union IR t): Discriminator | 无
  条件（全部满足才附加，否则整个键缺席）：
  (a) ∀ member: member.kind === 'object'          // 仅内联对象字面量成员；ref / 标记成员 → 不附加
  (b) 字段名 F 满足: ∀ member: fields 含 F 且 optional === false 且 F.type.kind === 'literal'
  (c) 各成员 F 的字面量值两两互异
  字段选定规则（R2 钉死，SA2 #3——多候选确定性）：
    候选按「首成员字段声明序」逐一遍历（E308 保证首成员字段无重名 → 序确定），
    取**最先同时满足 (b)+(c) 的 F**；遍历完毕无 → 不附加。
  产物: { field: F, byValue: { [String(v_0)]: 0, [String(v_1)]: 1, … } }
        // 键 = String(字面量)（JSON 对象键天然字符串化；fixture 判别字段为字符串字面量）
        // 插入序 = 成员声明序（fixture 断言 Object.keys(byValue) === ['image','text','file']）
```

- (b) 要求 `optional === false`：可选字段不保证在场，作判别跳转键不可靠（保守收窄，无测试反例）。
- **多候选选定规则的必要性（R2，SA2 #3）**：联合同时存在多个满足 (b)+(c) 的字段（如各成员都带 `kind` 与 `status` 字面量字段）时，R1 未定义选哪个 F。§8.3 的确定性纪律只保证「同一实现两次求值相等」，不保证**跨实现版本稳定**——派生物是编译缓存的缓存值（§1.2），`discriminator.field` 选择漂移 → 内容哈希漂移 → 缓存伪 miss。「首成员字段声明序最先满足者」是纯语法判据（不依赖遍历序、对象键序等实现细节），一经冻结永不漂移。锚点：`{kind:"a"; status:"x"} | {kind:"b"; status:"y"}` → `field === 'kind'`、`byValue = {a:0, b:1}`（取 status 则红，SA2 复审红线构思 #3）。
- **byValue 键的消费纪律（R2，SA2 #6）**：键恒为 `String(字面量)`——`{kind:1}|{kind:2}` 的键为 `'1'/'2'`，无法反推字面量原始类型（值树侧 enum values 保真为 number）。序号跳转是 byValue 的**唯一用途**；后续 validateSnapshot 票从键重建期望值即踩坑，须以值树 enum 或运行时值 `String(运行时值)` 同键化后查表，**不得从键反推值类型**。
- 附加位置：**结构树 union 节点与值 schema union 节点同附加**（同一 `Discriminator` 对象；两树成员同为声明序，`byValue[idx]` 在两树下标一致——红灯一致性断言即验证此性质）。
- **边界义务（缓存仅附加）**：`members` 的构造完全不感知判别式（先建 members，后条件附加 discriminator）——「有缓存联合的 members 与无缓存基线全等」由构造顺序保证，非事后修补。缓存的缺失/存在不改变任何可观测行为：本票中 evaluate 的全部输出除 `discriminator` 键自身外均与检测无关。

### 5.3 与红灯断言的对账

- fixture `AssetEntity`：三内联对象成员、公共非可选字面量字段 `kind`（"image"/"text"/"file" 两两互异）→ `{ field:'kind', byValue:{ image:0, text:1, file:2 } }` ✓（test.ts:402）。
- 一致性断言：`byValue['image']=0` → `values.members[0]` 为 object、其 `kind` 字段值 = `{ kind:'enum', values:['image'] }`（单字面量 → 单元枚举，§6 映射）✓（test.ts:405-421）。
- 负例 `{a:string}|{b:number}`：无公共字段 → 键缺席 ✓；`{kind:"a"}|{kind:"a"}`：值不互异 → 键缺席 ✓（hasOwnProperty 断言，§2.3 的 exactOptionalPropertyTypes 纪律即为此服务）。

---

## §6. 值 schema 映射（`valueOf(t, R)`）

**原则：IR 同态，永不解析 ref**（值树中 ref **一律** `{ kind:'ref', name }` 终态——含 Record 值位、含无子终态目标；`values` 有自己的全量别名表 `values[name]`，穿透由消费者查表完成）。与结构树侧的三个解析点 + 无子终态内联（§4.2）形成**正交对照**——两树在 Record 值位的**不对称是显式设计**（R2 声明，SA2 #1 修订要求 3）：结构树解析（测试契约要求索引/下钻可达），值树不解析（值语义按名引用即完备）。递归深度同样受 `MAX_TYPE_NESTING` 约束。

| IR 类型 | ValueSchema | 说明 |
|---|---|---|
| `primitive` | `{ kind:'scalar', type: name }` | |
| `literal` | `{ kind:'enum', values: [value] }` | 单字面量 → 单元枚举（判别一致性断言依赖） |
| `pattern` | `{ kind:'pattern', regex }` | 解码后原文（IR 已是解码态；fixture AssetId 正则与 `ASSET_ID_REGEX` 逐字符相等） |
| `ref` | `{ kind:'ref', name }` | 不展开 |
| `object` | `{ kind:'object', fields }`；字段可选时 `value = { kind:'optional', value: valueOf(f.type) }`，否则直接 `valueOf(f.type)` | `?:` 的值语义表达；非可选字段**不包** optional（`values['Audit']` 的 toEqual 精确断言要求无多余包装） |
| `array` | `{ kind:'array', element: valueOf(element) }` | |
| `record` | `{ kind:'object', fields: [{ name:'<key>', value: valueOf(value) }], keyPattern? }`（决策 F2；`keyPattern = keyPatternOf(key)`，见下） | |
| `union` | 全成员 `literal` → `{ kind:'enum', values }`（声明序）；否则 `{ kind:'union', members, discriminator? }`（§5.2 同源附加） | 枚举折叠只认**全字面量**；`80 \| string` 之类标量混合联合 → union 节点（结构树侧因全标量折叠为 leaf——两树正交的直接例证） |
| `marker YMap` | `valueOf(arg)` | 物化标记在值语义透明 |
| `marker YArray` / `YPlainArray` | `{ kind:'array', element: valueOf(arg) }` | 纯值数组在值语义就是 JSON 数组 |
| `marker YLeaf` | `valueOf(arg)` | 叶子标记透明（`YLeaf<string>` → `scalar string`） |
| `marker YXmlFragment` | `{ kind:'xml' }` | JSON 快照值为 XML 字符串（ADR 0003 §5） |

```
keyPatternOf(keyType):
  r = resolveChain(keyType)
  r.kind === 'pattern'            → r.regex        // fixture: ref AssetId → pattern → 正则
  r.kind === 'primitive'（string）→ 省略键          // 无约束键
  其他                            → throw Internal（E306 不变量：键必为 string 形）
```

- 索引条目与值树共用 `keyPatternOf`（同一 `R`，同一结果）——`index['ROOT.assets.<key>'].keyPattern` 与 `values['ROOT'].fields[assets].keyPattern` 同源。
- **docs 全部不入派生物**（测试契约类型无 docs 槽位；JSDoc 语义留在 IR，`@tag` 属语义层——ADR 0001 主题）。

---

## §7. 路径索引构建

### 7.1 构建方式：ROOT 物化遍历就地填充

索引行**只在 `path ≠ null` 的遍历中产生**——即 `structure.node` 的物化遍历（§3.2）；别名表物化一律 `path = null` 不产行。这从构造上保证「索引键不枚举 ref 穿透路径」（ref 字段是终态，其目标内部的路径永不获得 path 上下文）——菱形链 2^N 展开在索引侧不可能发生。

```
遍历中物化节点时（path 非空）：
  map 字段 f     → index[path + '.' + f.name] = { match:'exact', node: f.node }
  array          → index[path + '.<item>']    = { match:'pattern', node: element }
  record '<key>' → index[path + '.<key>']     = { match:'pattern', keyPattern: keyPatternOf(r.key), node: 值位解析产物节点 }
```

（`f.node` / `element` / 值位节点 = 先构造节点对象、后挂索引行——行内 node 与树内节点**同一对象引用**，JSON 序列化各出现一次，规模论证见 §8。record 行的 node = §4.2 解析点③的物化产物——R1 写「value 节点」未言明解析，与 §7.3 对账一念之差即 SA2 #1 的根源，R2 起两处文本同源：**规则表（§4.1 record 行）、物化伪代码（§4.2 ③）、索引行（本节）、对账（§7.3）四处于同一节点**。字段位 f.node 按决策 F4 可能为内联无子终态（如 fixture 的 attachments → plain）。）

### 7.2 下钻与停止集

| 节点 | 下钻 | 索引行 |
|---|---|---|
| `root` / `map` / `array` | 继续（字段名 / `<item>` / `<key>` 段） | 产生 |
| `ref` | **停**（穿透是查询期能力：索引 + 别名表 + 消费者遍历，测试 `resolvePath`/`walkFrom` 即最小消费者） | 无 |
| `union` | **停**（成员内部路径经 any-of 查询期遍历；索引行会有跨成员同路径歧义——`ROOT.assets.<key>.audit` 三成员皆有，无歧义-free 归并政策，不立行） | 无 |
| `leaf` / `plain` / `xml-fragment` | **停**（终态） | 无 |

### 7.3 fixture 索引全量对账（SA3 实现后自检用；R2 与规则文本同源对齐）

`ROOT`(exact, root) / `ROOT.assets`(exact, map) / `ROOT.assets.<key>`(pattern, keyPattern=ASSET_ID_REGEX, **node=union**——解析点③产物，三成员各为 map，与 §4.1 record 行 / §4.2 ③ / §7.1 同一节点) / `ROOT.attachments`(exact, **node=plain**——R2 修正：R1 误写 ref；按决策 F4 内联 `Attachments`（YPlainArray 链终点），test.ts:581 `resolvePath('ROOT.attachments')` 断言 `'plain'`，ref 终态必红) / `ROOT.audit`(exact, **node=ref Audit**——结构形（YMap）按名，test.ts:553-555) / `ROOT.notes`(exact, leaf) / `ROOT.keywords`(exact, array) / `ROOT.keywords.<item>`(pattern, leaf)——共 8 行，覆盖红灯全部索引断言与 `resolvePath` 穿透查询（`ROOT.audit.createdBy` 经 n=2 前缀命中 + 剩余段 ref 穿透；`ROOT.assets.<key>.width` 经 union any-of 命中 file→…→image 成员；不存在路径两例 → null）。

---

## §8. 资源界：O(文本规模) 与确定性

### 8.1 菱形测试的精确对账（N=15）

- **别名表**：17 项（ROOT=ref A0、A0..A14=map{l,r→ref}、A15=map{v→leaf}）。
- **structure**：root → A0 的 map 物化（解析点①，与 `aliases['A0']` 同构的第二个副本）。
- **索引**：3 行（ROOT / ROOT.l / ROOT.r——l、r 为 ref 终态即停）。断言 ≤ 3×(N+2)=51 ✓。
- **序列化计数**：`"kind":"map"` ≈ 17（别名 16 + structure 1）< 200 ✓；`"kind":"ref"` = 结构 2 + 索引 2 + 别名表 31（ROOT 1 + A0..A14 各 2）= 35 < 200 ✓；总长 < 50KB（实际数 KB）✓。

### 8.2 O(文本规模) 一般论证

派生物 = 别名表（每别名身体一次物化）+ structure（ROOT 链终点的**一个**身体物化）+ 值树（每别名一次）+ 索引（ROOT 可达语法路径，每路径一行）。增量复制只发生在三类位，前两类每次复制对应**文本中的一个出现位**，第三类每出现位 O(1)：

1. ROOT 链终点身体被物化两次（structure + 自身别名条目）——+1 份常数复制；
2. `YMap<ref X>`（含嵌套 `YMap<YMap<ref>>`）实参链终点身体被内联进取出现位的物化——每个文本出现位 +1 份；
3. **Record 值位 `Record<K, ref X>`**（R2 补，SA2 #1 修订要求 2）：值位解析（§4.2 ③）把链终点身体内联进取出现位的物化——与 YMap 实参同型论证，每个文本出现位 +1 份（值位嵌套 Record 亦然，每层对应一个文本出现位）；
4. **无子终态 ref 内联**（决策 F4，R2）：每出现位复制一个**无子**节点（plain / leaf / xml-fragment）——+O(1)，不引入子树复制。

除这四条外结构形 ref 全为按名终态，故总规模 ≤ 3×(文本中类型出现位总数) + O(出现位数) = O(文本规模)。**反例排除**（决策 F1 的动机）：若 YMap 联合实参做键空间合并，`type Z_n = YMap<Z_{n-1} | {a_n}>` 链（文本 O(N) 行）会因逐级内联上一级全部字段使派生物退化为 O(N²)，违反 ADR 0003 §4「派生物大小恒为 O(文本规模)」；透传表示下 Z_n 的实参联合成员 `ref Z_{n-1}` 保持终态，规模线性。菱形测试对账（§8.1）不受第 3/4 条影响——菱形文本无 Record、无无子终态 ref（A0..A15 全为结构形），计数不变。

### 8.3 确定性与纯度

- 无 `Date.now` / `Math.random` / 全局可变状态；表与索引的插入序全部由 IR 声明序与遍历序决定——同模块两次求值 JSON 序列化逐字节相等（AC 纯函数断言的强形式）。
- **跨版本确定性（R2，SA2 #3）**：确定性的强形式不止「同一实现两次相等」——派生物是编译缓存的缓存值（§1.2），一切影响输出的选择必须是**纯语法判据**且一经冻结永不漂移。本设计的选择点冻结清单：判别字段 = 首成员字段声明序最先满足 (b)+(c) 者（§5.2）；`<key>`/`<item>` 段名固定（§4.1/§7.1）；解析点闭合 = §4.2 四类处置；byValue 插入序 = 成员声明序。实现版本升级不得改写这些判据——改写即内容哈希漂移 + 缓存伪 miss，须按破坏性变更走版本协商。
- 不变更输入 `module`（只读遍历）。
- **不可变契约与 Object.freeze 评估（R2，SA2 #7）**：派生物对消费者不可变（§2.1 JSDoc 已声明；索引行 node 与树内节点共享引用，突变交叉污染）。v1 **不**做 `Object.freeze`：深冻结 = 每次求值额外一遍全树遍历（O(派生物) 常数代价，热路径无收益——纯函数契约已保证生产者不变异）；TS 类型层无法表达「deep readonly」而不破坏与测试契约类型的结构可赋值性（§2.3 的判别联合逐字段一致要求）。纪律由文档 + JSDoc 承载，违规突变的诊断责任在消费者侧；若后续票出现真实突变事故，再评估冻结（成本已在此记录）。

---

## §9. 防御性设计：不变量与 loud 边界（虚假降级禁令审查）

对 ok-module 成立、求值器**依赖**的不变量（全部由解析层保证，重访 = 解析层缺陷或手造 IR）：

| # | 不变量 | 保证方 | 违反时的处置（一律 loud，无静默降级） |
|---|---|---|---|
| I1 | 引用图无环 | E106 | `resolveChain` / `computeCls` 帧重入 → throw Internal → 顶层 catch → `ok:false` E100 |
| I2 | 一切 ref 名已声明 | E301 | 表查询缺席 → throw Internal → 同上 |
| I3 | **非纯值全域**联合非混合（对象字段 / 数组元素 / Record 值位 / 标记实参 / 别名身体全域；`inPV` 旗标仅 YPlainArray 子树置真——shapes.ts:660-667） | E309 | `fold` 遇 scalar+容器并存 → throw Internal → 同上。安全论证链 = 三防线叠加（§3.1 D1 解析层全域拒绝 / D2 structureOf 不入 YPlainArray 子树 / D3 valueOf 无桶折叠）——R2 前措辞「同步上下文」窄于实际检查范围，已修正（SA2 #2） |
| I4 | YMap/YXmlFragment 实参 map 形、YLeaf 实参标量形 | E304 | `materializeMapForm` 落到非 map 形 → throw Internal → 同上 |
| I5 | Record 键 string 形 | E306 | `keyPatternOf` 落到非 string/pattern → throw Internal → 同上 |
| I6 | ROOT 存在且 map 形、别名名唯一、对象字段无重名 | E310/E311/E302/E308 | ROOT 缺席/畸形 → TypeError/显式 Internal → 同上；**重名 → bodies 构造期 seen 集合命中 → throw Internal（R2 补，SA2 #4——R1 此格唯一无 loud 处置路径：静默后者覆盖产出 ok:true 垃圾派生物，违反 §2.2 自我声明）**；字段重名 → 物化产出重复 MapField 不可达（E308 已挡） |

判定依据（SKILL 立法）：「在功能完备的系统里这个条件应该总是为 true 吗？」——是（解析层已收口），故**不设计 fallback**。E100 崩溃边界与 `parseVfsl` §15.4 同款：错误文本进 message、行 1 列 1、`ok:false`——可观测、可测试、不伪装成功。

---

## §10. 实现文件与版本

| 文件 | 动作 | 内容 |
|---|---|---|
| `packages/vfsl/src/derived.ts` | 新建 | §2.1 类型族（仅类型，无实现——沿 ir.ts「仅含类型」先例） |
| `packages/vfsl/src/resolve.ts` | 新建 | §3.1 共享解析器（bodies / resolveChain / computeCls + Internal 错误类型） |
| `packages/vfsl/src/evaluate.ts` | 新建 | §3.2 主流程 + §4 物化 + §5 判别式 + §6 值树 + §7 索引（预估 ≤ 320 行）。import `makeIssue`/`ErrCode` 自 `./errors.js`（**零修改引用**——E100 前缀构造与 parseVfsl 同源，R2 SA2 #5） |
| `packages/vfsl/src/index.ts` | 修改 | `import { evaluate }` + `export function`…——实际直接 `export { evaluate } from './evaluate.js'` 与 `export type { … } from './derived.js'`；头注释更新「第二公共导出」（改动 ≤ 15 行） |
| `packages/vfsl/package.json` | 修改 | `version: 0.1.4 → 0.1.5`（简报：改码须 bump patch） |

内部件不导出到公共面（沿 index.ts 既有纪律：tokenizer/parser/semantic 均不导出）；公共面新增 = `evaluate` + §2.1 全部类型。

## §11. 验收标准 ↔ 红灯测试 ↔ 设计章节映射

| 验收标准 | 测试 describe | 设计依据 |
|---|---|---|
| evaluate 结果联合形状 / JSON 往返 / 纯函数 / 无行列 | ADR 0003 §1 接缝（5 条） | §2.2、§8.3、§2.1（类型无行列字段） |
| 结构树八形态 + §10 fixture 全量 | 结构树节点全形态（4 条） | §4.1 全景表；fixture 对账 §7.3 |
| 物化折叠四规则正反 | 物化折叠四规则（8 条） | §4.1（规则 1/2/3/4 行 + YPlainArray 不递归） |
| 判别式缓存边界 | 联合：分支列表与判别式缓存（6 条） | §5 |
| ref 不展开 / 菱形 O(文本) | ref 按名引用不内联展开（3 条） | §3.2 不对称、§4.2 终态原则、§8.1/8.2 |
| 值 schema 枚举/Pattern/optional | 值 schema（4 条） | §6 表 |
| 路径索引可查 / ref 穿透 / Record 键模式 | 路径索引（4 条） | §7 |
| no-match 诊断接缝 | no-match 诊断接缝（2 条） | §5.1 |
| §10 fixture 含 ROOT 全量求值 | 各 describe 复用 | §7.3 对账 |
| （R2）Record 值位 union / `ROOT.attachments` plain / `ROOT.audit` ref 三锚 | 路径索引 describe（test.ts:553-555/559/576/581） | §4.2 解析点③ + 决策 F4（内联/按名分流）；§7.3 对账 |
| （R2）SA2 复审红线构思增量锚（Record 值位非联合解析 / Record 形 ROOT / PV 混合联合 / 判别多候选 / 重名手造 IR） | 待 SA6 按 SA2 评审「红线测试思路」补入（SA6 owned） | §4.2 ③（一律解析）、§3.1 三防线 D2/D3、§5.2 选定规则、§3.1（1）重名 Internal |

---

## §12. 文件清单（File Scope）

### ALLOW LIST
- `packages/vfsl/src/derived.ts` — 新建，派生 schema 类型族（§2.1，公共契约冻结形状）
- `packages/vfsl/src/resolve.ts` — 新建，包内共享解析器（§3.1；ADR 0003 §4「解析动作由包内共享解析器完成」的落地位）
- `packages/vfsl/src/evaluate.ts` — 新建，求值器实现（§3.2~§7，预估 ≤ 300 行）
- `packages/vfsl/src/index.ts` — 修改，第二公共导出 `evaluate` + 类型族 re-export + 头注释（≤ 15 行）
- `packages/vfsl/package.json` — 修改，版本 0.1.4 → 0.1.5（1 行）
- `packages/vfsl/test/evaluate-derived-schema.test.ts` — `[SA6 owned]` 红灯验收测试（已存在，SA6 Phase 1 交付）。SA3 不得改断言逻辑；仅允许测试基础设施级修正且须在 PR 说明

### DENY LIST
- `packages/vfsl/src/parser.ts` / `tokenizer.ts` / `semantic.ts` / `shapes.ts` — 解析层已冻结，本任务零改动（evaluate 只消费 IR）
- `packages/vfsl/src/ir.ts` / `errors.ts` — IR 与错误注册表是已冻结公共契约，本任务不动（R2 澄清：`errors.ts` 的 `makeIssue`/`ErrCode` 被 `evaluate.ts` **import 引用**但不修改——SA2 #5 要求的前缀同源构造即由此达成，不构成文件改动）
- `packages/vfsl/test/parse-*.test.ts` — 既有 216 条 parse 测试（9 文件），本任务不动
- `docs/adr/**` / `docs/vfsl/**` — ADR 0003 与 v1-spec 已冻结；派生 schema 形状即本设计文档的冻结对象，规格侧无增改需求
- `packages/vfsl/tsconfig.json` / 根 `tsconfig.base.json` / `pnpm-workspace.yaml` — 编译与工作区配置不动

## §13. 协议假设依据 (Protocol Assumption Evidence)

无协议级假设：本设计仅涉及纯函数库代码与类型定义（新增 TS 模块 + 公共导出），不包含 HTTP/WS 端点行为、端口/进程生命周期、跨进程资源假设或第三方库行为假设。测试命令（`pnpm test` / `pnpm typecheck` / `pnpm vitest run <file>`）均为仓库既有脚本，简报与红灯记录已给出真实运行证据（37 failed | 216 passed；typecheck 两条预期红）。

## §14. 契约改动连锁审计 (Contract Change Caller Audit)

无契约改动：本设计仅涉及**新增公共导出**（`evaluate` 函数 + `derived.ts` 类型族）与版本号 bump——不修改任何既有函数的签名、返回类型、throw 行为或同步性（`parseVfsl` 及全部内部件零改动）。

新增函数无存量 caller；仓内首个消费者为 SA6 红灯测试 `packages/vfsl/test/evaluate-derived-schema.test.ts`（import 自 `../src/index.js`）。下游 caller（validateSnapshot / 编译缓存 / AI card）属后续票，将以 `evaluate` 的结果联合为契约消费方——`ok` 判别检查从第一天强制（ADR 0003 §1 前向兼容设计）。

---

## SA2 反馈逐条回应（R2，2026-08-19）

评审源：`wiki/raw/task_vfsl-evaluator_sa2_review.md`（verdict: reject；#1 CRITICAL + #2~#4 MAJOR + #5 MINOR + #6/#7 NOTE）。

| # | 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|---|---|:--:|---|---|
| #1 (CRITICAL) | Record 值位物化漏 ref 解析：立第三解析点（resolveChain 后物化），同步修订 §8.2 与「唯二例外」表述；两树不对称显式声明；§7.3/§4.1/§7.1 文本对齐 | ✅ | §4.1 record 行、§4.2（重写为「三个解析点 + 无子终态内联」；解析点③伪代码含 object/record/union/marker/标量全部落行 + 非「联合特判」反例锚）、§4.2 末「两树在 Record 值位的不对称」段、§6 原则行、§7.1 record 行（node = 解析点③产物 + 四处同源声明）、§7.3 对账（node=union 与规则表同源）、§8.2 复制点第 3 条 | record 行改为 `structureOf(resolveChain(value))`；materializeMapForm 的 record 分支同源修复；「唯二」全文消灭；O(文本规模) 论证补 Record 值位每出现位 +1 份（菱形对账不受影响——菱形文本无 Record）；值树仍 ref 终态（`values` 自带别名表穿透），防 SA3 两侧画蛇添足/漏做 |
| #2 (MAJOR) | E309 措辞「同步上下文」窄于实际检查范围（非 PV 全域，shapes.ts:667）；fold throw 实际依赖三条防线，设计只隐含第一条的一半 | ✅ | §3.1 fold 注释（「非纯值全域」）、§3.1 新增「E309 安全论证链：三防线」表（D1 解析层全域 / D2 structureOf 不入 YPlainArray / D3 valueOf 无桶折叠，各行附可定位依据与对应红灯锚）、§9 I3 行（范围改写 + 三防线引用）、§4.1 YPlainArray 行（补 D2 引用）、§3.1 localCls 注释（computeCls 不入 YPlainArray 子树的镜像说明） | D1 依据 = shapes.ts:660-667/44-67/691 逐行引用；D2/D3 为求值器侧显式立论，配 SA2 红线构思 #2 的测试锚 |
| #3 (MAJOR) | 判别式多候选字段选择规则缺失；跨版本漂移 → 内容哈希漂移 → 缓存伪 miss | ✅ | §5.2（选定规则入伪代码：首成员字段声明序最先满足 (b)+(c) 者；E308 保证序确定）、§5.2 新增「多候选选定规则的必要性」段（含 `{kind,status}` 锚点：field='kind'、byValue={a:0,b:1}）、§8.3 新增「跨版本确定性」段（选择点冻结清单）、§1.3 F3 行 | 纯语法判据一经冻结永不漂移；改写即破坏性变更走版本协商 |
| #4 (MAJOR) | 重名手造 IR 静默后者覆盖，产出 ok:true 垃圾派生物；I1~I6 唯一无 loud 处置路径 | ✅ | §3.1（1）bodies 构造（seen 名集合，重名 → throw Internal）、§9 I6 处置列（「重名 → Internal」补全） | 一个 Set 检查；对齐 SA2 红线构思 #4（evaluate 双 ROOT 手造 → ok:false 且 message 含 VFSL-E100） |
| #5 (MINOR) | 顶层 catch 直取 `.message` 非 Error 丢信息；应镜像 instanceof 守卫 + 复用 makeIssue | ✅ | §2.2（「逐项同款」重写：`err instanceof Error ? err.message : String(err)` 镜像 index.ts:46 + makeIssue 前缀同源）、§3.2 catch 伪代码重写、§10 evaluate.ts 行（import makeIssue/ErrCode 自 errors.js，零修改引用）、§12 DENY LIST errors.ts 澄清 | 非 Error throw 的 message 不再变 `'undefined'`；`VFSL-E100:` 前缀构造与 parseVfsl 同源 |
| #6 (NOTE) | byValue 键 `String(1)='1'` 无法反推字面量原始类型，后续票消费会踩坑 | ✅ | §5.2 新增「byValue 键的消费纪律」段（键恒 String(字面量)；序号跳转是唯一用途；不得从键反推值类型；值树 enum values 保真） | 文档级消费纪律，validateSnapshot 票的输入契约 |
| #7 (NOTE) | 索引行与树共享对象引用，突变交叉污染；不可变约定未声明 | ✅ | §2.1 DerivedSchema JSDoc（不可变契约 + 共享引用警示）、§8.3 新增「不可变契约与 Object.freeze 评估」段（v1 文档纪律；深冻结代价与 TS deep-readonly 破坏可赋值性的评估结论；后续出事故再冻结） | 显式冻结决策 + 成本记录 |
| #8 (R2 自寻，SA2 未列) | test.ts:581 `resolvePath('ROOT.attachments')` 期望 `'plain'`——R1 设计（字段位 ref 一律终态）与 SA2 #1 修复（Record 值位解析）均不覆盖，必红；与 test.ts:553-555（audit 必须 ref）、test.ts:497-501（菱形 l/r 必须 ref）联立，唯一一致解 = 按链终点形状分流 | ✅ | §1.3 F4 行（新增第四自由度：无子终态 ref 内联，含三条锚点联立推导）、§4.1 ref 行（判别实现逐 kind 列出）、§4.2「无子终态内联」段（三锚点表 + 适用范围 + 语义/规模依据）、§4.2 末尾（四类 ref 处置闭合枚举）、§7.1（f.node 可为内联终态）、§7.3（attachments 行修正为 plain）、§8.2 复制点第 4 条（每出现位 +O(1)）、§3.2 不对称 bullet（无子终态身体按 F4 内联） | 发现路径：R2 修订前对 37 条断言逐条模拟复核（`walkFrom` 终态原样返回语义，test.ts:221 `i >= segments.length` 先于 ref 穿透），确认「一律终态」与「一律解析」各必红一条；已以可执行模拟验证三种策略的实际输出（A ref 终态→FAIL / B 终态内联→PASS / C 无行+树 ref→FAIL）。**SA3 若按 SA2 #1 字面修复而漏此项，37 条中恰 1 条（test.ts:581）永红** |

## R2 修订记录（2026-08-19）

- **修订性质**：实质修订。§4.1 record 行与 ref 行、§4.2 全节、§3.1（1）/fold/三防线、§3.2 catch 伪代码、§5.2 选定规则与消费纪律、§6 原则行、§7.1 record 行、§7.3 对账、§8.2 复制点清单、§8.3 跨版本确定性与不可变评估、§9 I3/I6、§10、§11、§12 的伪代码/规则文本均按攻击点改写，非注释式承认。
- **关键设计变更**（对照 R1）：
  1. Record 值位立为解析点③（spec §3 表第 5 行 + fixture 段落引据），materializeMapForm record 分支同源修复；
  2. ref 行按链终点分流（F4）：无子终态（plain/leaf/xml-fragment）内联、结构形按名——R2 自寻发现，SA2 评审未列，test.ts:581 的强制解；
  3. E309 安全论证链三防线显式化（D1/D2/D3），措辞由「同步上下文」修正为「非纯值全域」；
  4. 判别字段选定规则钉死为纯语法判据（首成员字段声明序最先满足者），纳入跨版本冻结清单；
  5. bodies 重名 loud 化（Internal），补全 I6 处置缺口；
  6. E100 构造与 parseVfsl 逐项同款（instanceof 守卫 + makeIssue）；
  7. byValue 键消费纪律与派生物不可变契约成文。
- **不变项**：四决策对齐 ADR 0003 不变；类型族形状（§2.1）不变（测试契约冻结）；ALLOW/DENY LIST 只澄清不增删（无新文件）；§13 无协议级假设、§14 无契约改动的判定不变。
- **自检**：已全文检索矛盾模式——「唯二」「两个解析点」「同步上下文混合」「value 节点」等 R1 表述全部消灭或改写；§4.1/§4.2/§6/§7.1/§7.3 五处 Record 值位表述同源；§8.2 复制点计数与 §8.1 菱形对账（计数不变）一致；F1/F2/F3 结论不受 F4 影响（fixture/负例/一致性断言复核）。
- **对 SA3 的实现指令排序**：§4.2 是唯一权威节（四类 ref 处置闭合枚举）；任何「联合特判」「字段位特判」实现均违反本设计。
