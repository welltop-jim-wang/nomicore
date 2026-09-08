# ADR 0016：readData 语义 schema 投影

日期：2026-09-09
状态：已接受

## 背景与动机

`readData(path)` 当前在成功时只返回路径对应的普通逻辑值（ADR 0008 冻结形状 `{ ok: true, value }`）。对 agent 类消费者来说，光获取数据并不足以正确解读数据：值 `3` 是库存数量还是价格、`'cn'` 是否属于某个字面量枚举、某个字段允许什么取值——这些语义都在 schema 里，而不在值里。如果能随读取同步获取带语义的 schema（值约束 + 文档注释），agent 才能真正正确理解数据；对于读取后要修改数据的场景，也需要同一份 schema 来支撑合法 mutation 的构造。

本决策升级 `readData` 成功分支：在返回值的同时，同步返回该路径的语义 schema 投影。读取本身保持 schema 无关（ADR 0008 不变），schema 投影是 namespace-runtime 层在成功读之上的受控附加。

## 决策

### 结果形状

`readData` 成功分支变为：

```ts
{ ok: true; value: unknown; schema: ReadDataSchemaProjection | null }
```

- `schema` 为 `null` 覆盖三种情形：无 active schema（preparing / unavailable / fatal / 未知方言只读）；路径偏离 schema（raw 复制可绕过 VFSL 校验产生 schema 外数据，ADR 0010 明示例外）；静态解析失败（见下）。三种情形不区分——读契约只承诺"有就给"，不承诺缺席原因分类；`null` 不是读的失败，读的 `ok` 恒真。
- 失败分支不变：`PATH_NOT_ALLOWED`（路径/载体缺陷）、`RUNTIME_READ_DISABLED`（lifecycle≠ready）、lease released issue 各自走原有通道。
- 路径合法但值缺席（`value` 显式为 `undefined`）时 schema 照常返回：schema 是路径键控的，不是值键控的。
- 空路径 `[]` 返回 ROOT 的值 schema 投影。

### 投影体

```ts
interface ReadDataSchemaProjection {
  /** 路径终点的值语义子树（ref 按名保留，不内联展开——ADR 0003 §4 同款纪律）。 */
  readonly valueSchema: ValueSchema;
  /** 传递闭包内被 valueSchema 引用到的别名（自包含、递归安全、JSON 可序列化）。 */
  readonly aliases: Record<string, ValueSchema>;
  /** fieldDocs/markerDocs 的相关切片：脊柱、终端子树后代、闭包别名内部的注释。 */
  readonly docs: Record<string, readonly string[]>;
  /** aliasDocs 的相关切片（按别名名）。 */
  readonly aliasDocs: Record<string, readonly string[]>;
}
```

`docs`/`aliasDocs` 的键规约与 `DerivedSchema` 文档三表完全同构：§3 绝对语法路径 + `'<item>'/'<key>'/'<member N>'` 合成段文法，别名以别名名锚定。子项语义不引入新结构——它就是派生 schema 既有 docs 表按读取相关性的投影切片；消费者读路径 P 时，脊柱注释 = 沿 P 的键，终端子项注释 = P 之下的键，别名内部注释 = 别名名锚定的键。

载体结构树（`StructureNode`）不进入载荷：YMap/YArray/ROOT 是实现词汇，不进入普通 namespace 消费接口（CONTEXT.md），且 mutateData 调用方不需要选载体。

### 解析语义

`@nomicore/vfsl` 新增公开 API：

```ts
resolveSchemaAtPath(
  derived: DerivedSchema,
  path: readonly (string | number)[],
): ResolveSchemaAtPathResult
// { ok: true, ...projection }
// | { ok: false, code: 'SCHEMA_PATH_NOT_FOUND', path }   // 无任何候选接纳该段
// | { ok: false, code: 'SCHEMA_PATH_INVALID', path }     // 非数组/野段形状守卫
```

- **union 静态 any-member 扩展**：逐段游走时并集展开为候选集，"任一成员接纳即放行"——与写侧路径守卫 `drillStep`（validate-patch，ADR 0003 §3.3 规则 1）语义同构。同一个路径在写守卫里合法 ⟺ 在读投影里可解析。终点命中多个候选时合成 `{ kind: 'union', members }` 节点（合成 union 无判别式缓存，仍是合法 ValueSchema 形状）。
- 解析**与实际值无关**：值缺席时照常解析；不使用判别式缓存按值收窄（避免读投影与写守卫语义分叉）。
- Record `'<key>'` 字段带 `keyPattern` 时用正则实测该段，不匹配 → `SCHEMA_PATH_NOT_FOUND`（fail-closed）。
- `optional` 包装在游走中透明展开，在返回子树中原样保留——"可缺席"是值语义的一部分。
- `ref` 目标缺失（畸形派生物）沿 validate-patch 先例抛 `InternalError`：可信域契约，不进结果联合。
- 解析器纯函数、同步、零 memo、结果联合拒绝——符合 vfsl 包边界。

### 交付纪律

- **always-on**：每次成功读都返回 schema 投影，无 opt-in 开关。"读 = 值 + 语义"是契约本身；opt-in 会把升级退化成消费者必须知晓的隐藏能力，并使结果形状随参数分叉。
- **每次读深拷贝投影**：公共面只暴露 detached 投影（namespace-runtime 边界）——`activeTools.derived` 的活引用绝不递出，调用方 mutation 不得交叉污染 runtime 的活 schema。深拷贝沿 `value` 同款纪律：可变普通副本、不冻结、零缓存。成本为每次读 O(path × N + schema 子树)，如实记录在案；将来若 profiling 证明是瓶颈，按 schema generation 缓存是加法演进。

### 分层与兼容面

- `@nomicore/doc-runtime` 不动：读取保持 schema 无关（ADR 0008），`readLogicalValueAtPath(doc, path)` 签名与语义不变。
- `@nomicore/namespace-runtime` 组合两者：成功读 = `readLogicalValueAtPath` 的值 + `resolveSchemaAtPath` 的投影深拷贝；`schemaState ≠ 'ready'` 或无 activeTools 时 `schema: null`；`NamespaceRuntimeReadDataResult` 成功分支按上文重定型。
- `@nomicore/namespace-registry` 仅类型别名跟随（`NamespaceLeaseReadDataResult`），lease 行为零变化。
- 诊断变更日志不涉及读面；ReplicationSession raw 读面（可信域）不变；typed-access 投影与 codegen 加法兼容（adapter 可忽略新字段，亦可在其后消费）。

## 考虑的备选

- **opt-in（`readData(path, { schema: true })`）**：省默认成本，但接口分叉、结果形状随参数变化，且与"agent 默认需要语义"的动机相悖。拒绝。
- **判别式 + 实际值收窄 union**：解析更精确，但耦合数据、值缺席时退化、与写侧路径守卫语义分叉。拒绝——同构性是更值钱的性质。
- **内联展开所有 ref**：消费者最省事，但递归别名（如 `type Node = { next: YMap<Node> | null }`）导致无限展开，必须引入循环检测与截断语义。拒绝——ref 按名保留 + 传递闭包别名表递归安全且自包含。
- **扁平 `docs: string[]`（仅脊柱）**：最简单，但表达不了终点子树内部子项的语义归属（哪条注释属于子树里哪个位置）。拒绝——改用与 DerivedSchema 三表同构的路径寻址切片。
- **注释内联包装树（`{ node, docs }` 递归）**：语义精确贴位，但引入一套取代 ValueSchema 冻结形状的新递归契约，ref/别名也需包装版。拒绝。
- **载荷含载体结构树**：见「投影体」节——实现词汇不进消费面。拒绝。
- **schema 子通道结果联合（带稳定码区分三种缺席情形）**：诊断价值真实存在，但读契约 v1 只承诺"有就给"；`null` 的单义性对 agent 消费者更友好。将来若出现按缺席原因分支的真实消费者，加 `schemaIssue` 摘要是加法演进。

## Consequences

- 本 ADR **修订 ADR 0008 的 D8 封口**：「active schema tools（module/derived）内部保留，永不进任何公共面」改为——`derived` 只经 readData 语义 schema 投影的受控只读深拷贝进入公共面；`module` 与 validator 仍永不进入公共面。
- 读结果成功分支形状变更（SA6 冻结形状的有意演进）：仓库内对读结果做 `toEqual` 全等断言的测试需要更新；`toMatchObject` 断言加法兼容。
- 每次成功读增加 O(path × N + schema 子树) 的解析与深拷贝成本。
- CONTEXT.md 更新「Data」词条并新增「语义 schema 投影」词条。

## 取代关系

修订 ADR 0008「P0 与 active schema」节中 D8 封口句（见 Consequences 第一条）。ADR 0008 的其余决策——schema 无关读取、单 write sequencer、读取保留不变量、失败通道——继续有效。ADR 0003 的派生 schema 形状与 ADR 0010 的 raw 复制例外不变。
