# ADR 0024：readData 形状预算——depth/width 截断省略与截断清单

日期：2026-09-12（设计冻结：tracking issue #331）
状态：已接受（影响包 `@nomicore/doc-runtime`、`@nomicore/namespace-runtime`、`@nomicore/namespace-registry`、`@nomicore/vfsl`、`@nomicore/vfsl-protocol`）

## 背景

`readData(path)` 现契约返回目标路径下**整棵子树**的 detached 深拷贝：值通道（载体投影读取）+ 语义 schema 投影通道双份、同步执行、零缓存，成本 `O(path + 目标子树)`（ADR-0008「读取能力」节：非空 path 只转换目标子树）。当子树很大时这产生系统性的过度获取：

- **程序化消费方**：只想看某任务的状态与发布事实，却连带拉回上限 200 条的工作记录（`workRecordLimit = 200`）与全量 append-only 历史；
- **枚举场景**：「这个 Record 下有哪些键」没有受控手段——整读后靠调用方字节闸兜底，截断后只剩 JSON 文本前缀预览，连完整键列表都拿不到；
- **进程开销**：截断若只发生在调用方一侧（如 L2 会话级工具的事后字节裁剪），物化开销已经花掉——精简必须发生在投影递归内部，未展开分支应零物化成本。

### 与 ADR-0016 的张力

ADR-0016 拒绝过 `readData` 参数化（opt-in schema 投影），理由是「接口分叉、结果形状随参数变化」。本 ADR 必须正面处理这一张力，见「对既有 ADR 的修订」节：预算参数不是 schema opt-in——schema 通道仍 always-on，参数只约束**值与投影的形状**，且新形状字段恒在场、自描述。

## 决策

### 1. API 与参数语义

```ts
readData(path, options?: { depth?: number; maxChildrenPerNode?: number })
```

- **`depth`**（≥ 0，整数）：自目标节点向下允许**展开**的容器层数。容器（Y.Map / Y.Array / plain object / plain array）各计一层；标量与 `Y.XmlFragment`（语义字符串）是终态。`depth: 0` = 纯骨架读——目标容器自身折叠为同形空容器 + 单条 depth 截断项（readData 的 value 键恒在场，目标节点不能省略自身）。
- **`maxChildrenPerNode`**（≥ 0，整数）：每个被展开节点最多保留前 K 个子项。数组按下标天然稳定；映射按键的插入序——**不承诺稳定，这不是分页 API**，只是护栏。
- 预算在载体投影递归内生效：未展开分支零物化成本（成本从 `O(目标子树)` 收敛到 `O(实际返回部分)`）。
- **不传 options = 完整投影**：逐字节现行为，零截断。
- **非法 options**（负数、非整数、非有限数、非对象、**含未知多余键**——options 是封闭形状，与 VFSL 封闭对象纪律同精神）：响亮拒绝，新稳定失败码 `READ_OPTIONS_INVALID`（同步、不抛；不借用路径失败码或生命周期失败码——预算缺陷不是路径缺陷）。
- **终态目标的预算是 no-op**：目标为标量或 `Y.XmlFragment`（语义字符串）时任何 depth 值都原样返回（终态无展开可言）；width 同理不适用。

### 2. 截断省略（值内唯一截断形态）

depth 耗尽与 width 超限触发**同一种**值内形态：被裁子项的键不出现在返回值中。消费端观感等同 `undefined`——语义是「这次没取，可再访问补全」，不是「数据为空」。消歧规则：

- 键缺席 **且不在** 截断清单 = 真缺席（既有缺席吸收语义不变）；
- 键缺席 **且在** 清单 = 被裁。

值域纪律不动摇：输出端 undefined 值键省略的吸收纪律（ADR-0008 缺席语义条款；实现词汇 E1）保持——不引入「键在、值 undefined」第三态；不引入魔法哨兵对象（与合法数据不可区分）；不引入同形空占位 `{}` / `[]`（暗示「数据为空」，且对必填字段的静态类型撒谎）。**唯一例外**：`depth: 0` 时目标节点自身以同形空容器呈现（readData 的 value 键恒在场，目标节点不能省略自身）——该例外是「目标节点」的呈现规则，不是子项占位的复活。

### 3. 截断清单

预算读成功结果中**恒在场**的截断事实通道（无截断时为空清单）。每条：

| 字段 | 语义 |
|---|---|
| `path` | 被裁位置，与 readData 实参同基（自 ROOT 起算） |
| `kind` | `'depth'`（层数耗尽）/ `'width'`（子项超限） |
| `omitted` | 省略计数 |

- **depth 条目的 `path` 尾段即被裁键名**——键名的唯一在场位置（值内已省略），枚举不丢键名；
- **width 条目**只在父路径记一条，不逐键罗列；
- **`omitted` 语义（钉死）**：depth 条目 = 被截容器的**直接子项数**（Y.Map `size` / Y.Array `length`，O(1)）；width 条目 = 超出保留数的子项数。**不是后代总数**——统计后代必须遍历被截子树，直接违背「未展开分支零物化成本」（决策 1）；
- 条目**不携带**被截容器内部的子键列表（看下一层结构 = 下一轮浅读或 schema 投影截断节点的职责）；
- 清单规模由预算间接约束（≈ 展开节点数 × width，与返回值同量级），不需要独立护栏。

### 4. 结果形状（破坏性修订）

成功分支恒定键集（恰三键 → 恒五键）：

```ts
{ ok: true; value: unknown; schema: ReadDataSchemaProjection | null;
  truncated: boolean; truncations: TruncationsEntry[] }
```

`truncated` 与 `truncations` 恒在场（空清单也是空数组）——形状唯一、无「缺席 = 无截断」隐式约定。失败分支（路径失败 / 生命周期停接纳）形状不动、不带这些键（读在到达投影前失败，无值可截）。

既有「恰三键」形状锚、深等断言与 docs/integration 形状注记全线修订。破坏面论据：各影响包**已发布于 npm**（`@nomicore/namespace-runtime` 0.1.12、`@nomicore/doc-runtime` 0.1.13、`@nomicore/namespace-registry` 0.1.10、`@nomicore/vfsl-protocol` 0.1.4、`@nomicore/vfsl` 0.2.4），但均处 **0.x**——按语义版本惯例 0.x 不承诺跨 minor 稳定，破坏性修订随 minor bump 发布；已知消费方可枚举（仓内测试与 DSH 部署链），无未知外部消费方承诺需要兑现。

### 5. 语义 schema 投影同 depth 裁剪

- 值语义子树（valueSchema）与值同 depth 截断；**别名传递闭包随展开层收缩**（只含展开层引用到的别名）；`docs` / `aliasDocs` 注释切片对被裁路径省略（**延伸决定**：超出 spec 字面的合理推论，已回写 tracking issue）；
- **width 对投影无操作**（投影是类型级、路径键控，无实例键——与数据量无关、与类型复杂度相关）；
- `schema: null` 的单义（无 active schema / 路径偏离 / 静态失败）与 always-on 精神不变。

**截断节点选型（钉死）：投影层包装，不扩展 ValueSchema 语义联合。** ADR-0003 冻结的 ValueSchema 是 9-kind 封闭语义联合，描述「数据应是什么形状」；截断是「这次读返回了多少」的**传输形态**，不是值语义——塞进 ValueSchema 需修订 ADR-0003 冻结面且污染语义层。落地：投影契约（`ReadDataSchemaProjection`，`@nomicore/vfsl` 公共面）的 `valueSchema` 字段类型在预算读下为**投影包装联合**——成员值位可出现截断标记，标记**携带成员级类型线索**（成员的 ref 名优先，无 ref 名时给容器 kind），使消费方在截断处仍可盲拼下一轮路径；无预算读恒为纯 `ValueSchema`，形状零变化。该包装是投影通道自构造的派生形态，不是值域哨兵。

**投影通道公共面（钉死）：解析入口加法三参化。** `resolveSchemaAtPath(derived, path, options?)`（`@nomicore/vfsl` 公共 API）——可选、加法、无 options 行为逐字节不变；预算在解析递归内生效，valueSchema 截断、别名闭包收集、docs/aliasDocs 切片三者在同一次遍历内同步收缩。不采用 namespace-runtime 层对完整投影的事后裁剪：闭包与切片依赖「先裁后收集」的正确顺序，事后裁剪需三遍后处理且易与「截断下沉递归」的总体原则漂移。此为 ADR-0016「解析语义」签名条款的显式修订（见修订节）。

**两通道截断位置对齐（计层规则，契约级承诺）。** 值通道数数据载体层（Y.Map / Y.Array / plain object / plain array 各一层）；类型树**同构计层**——discriminated union / literal union **透明**（不计层，与 resolver「任一成员出现即存在」的匹配语义一致），**ref 为终态边界**（截断标记落在 ref 处，携带 ref 名）。同一预算下，值截断位置与投影截断标记一一对应——消费方依赖两通道一致，错位即契约违约。

动机：预算读的「省」必须在值与投影两通道同时成立——否则 `readData([])` 级别的全量类型口径会把省下的量从投影通道吃回去；同时截断标记携带的类型线索保住「被截处是什么类型」的口径（ADR-0016「读 = 值 + 语义」的动机不降级）。

### 6. 公共面归属

预算是 schema 无关的投影概念，属 ADR-0008 读域：载体投影读取公共面扩展为三参形态 `readLogicalValueAtPath(doc, path, options?)`，projection 递归（Yjs 容器递归与 plain 域拷贝两条路径）携带预算；runtime `readData` 组合值与投影两通道的同预算截断；registry lease 原样透传。不新增第二条读路径。

### 7. 类型面

- **无 options 调用**：保持 `PathAt` 完整子树承诺（编译期权威不降级）；
- **带 options 调用**：静态类型为 `DeepOptional<PathAt<…>>`——通用递归映射类型（对象 → 全字段可选并递归；数组 → 元素递归；标量 → 原样），进协议类型面与 `PathAt` 并列导出，**零 per-schema 生成**；
- typed 纪律（typed-access 文档同步）：需要静态类型完整性的读不传预算；预算读的值一律可选访问。
- **判别联合附注**：`DeepOptional` 对判别字段**不豁免**（如实反映「width 可裁任何字段」）；可选化判别字段的 narrowing 兼容性由 type-level 测试锚定，TS 不容时退路为「判别字段保持必选」——由 test-d 红灯触发，不在本 ADR 预先承诺。
- **预算读不是写前完整快照**：预算读的值不得作为写前完整快照使用；mutation 构造必须显式，不从截断值隐式继承字段——typed-access 纪律文档同步锚定。

## 对既有 ADR 的修订

- **ADR-0008**：读语义由「目标子树**完整**深拷贝」修订为「预算内投影 + 截断清单」——不传预算 = 完整投影（既有语义作为默认保留）；投影递归成本界由「目标子树」改为「实际返回部分」（不传预算时两者等价；**延伸决定**，已回写 tracking issue）。
- **ADR-0016**（四处显式登记，不静默矛盾）：
  1. 参数面条款：预算参数**不是**该 ADR 拒绝的 schema opt-in——schema 通道仍 always-on，无「schema 有无」开关；新形状字段恒在场、自描述，不存在「结果形状随参数分叉」。
  2. 「分层与兼容面」`readLogicalValueAtPath(doc, path)` 签名与语义不变条款：签名加法扩展为三参（`options?`），**无 options 时签名与语义逐字不变**。
  3. 「解析语义」`resolveSchemaAtPath(derived, path)` 签名：加法扩展第三参 `options?`，无 options 行为不变（决策 5 选型）。
  4. Consequences 成本句 `O(path × N + schema 子树)`：随投影同 depth 裁剪修订为 `O(path + 实际展开的值部分 + 展开层引用的类型闭包与注释切片)`。
- **文档负控**：`packages/namespace-registry/test/readdata-docs-adr0016-contract-fixture.ts` 的 `readDataOptionUsages` 正则（`readdata-docs-adr0016-sync-control.test.ts` 锚定）由「禁一切带参用法」改为「只禁 schema opt-in 形态、放行预算形态」。

## 备选（已否决）

- **L2 工具层事后裁剪**：省 token 不省物化——树很大时必须在深拷贝时精简，截断必须下沉到投影递归。
- **同形空占位 `{}` / `[]`**：暗示「数据为空」；对必填字段的静态类型撒谎（类型承诺成员在场，空壳没有）。
- **值内魔法哨兵对象**（`$truncated` 等）：与合法数据（乃至敌意 raw 写入）不可区分，读方无法可靠识别。
- **字面「键在、值 undefined」**：破坏输出端吸收纪律（E1），JSON 序列化即蒸发，只有 `in` 检查能区分——为一个序列化即失真的形态改纪律不值；「键省略」在消费端观感逐点等价。
- **预算读静态类型 `unknown`**：丢掉全部结构感知与在场标量的精确类型，过保守；`DeepOptional` 以一个通用映射类型的代价保住了两者。
- **schema 投影不裁**：类型级口径与数据量无关但与类型复杂度相关，ROOT 级预算读会带出全量口径，把预算省下的量从投影通道吃回去。
- **扩展 ValueSchema 语义联合**（`kind: 'truncated'` 进 ADR-0003 的 9-kind 冻结面）：语义层描述「数据应是什么形状」，截断是读传输形态——混层且需修订 ADR-0003 冻结面；采用投影层包装替代（决策 5）。
- **namespace-runtime 层事后裁剪投影**：别名闭包与 docs/aliasDocs 切片依赖「先裁后收集」顺序，事后裁剪需三遍后处理，与「截断下沉递归」总体原则漂移；采用解析入口三参化替代（决策 5）。
- **`maxTotalNodes` 总量护栏**：depth × width 乘积效应真实存在，但第一版三参数互相纠缠——记 open question，文档警示乘积效应。
- **schema opt-in（`readData(path, { schema: true })`）**：ADR-0016 已拒，本 ADR 不复活——预算与 schema 有无正交。

## 验收

- **主接缝（runtime `readData`）**：五键恒形、depth/width 截断省略、清单条目（path 尾段键名 / omitted 计数 / 恒在场空数组）、`depth: 0` 骨架、`READ_OPTIONS_INVALID`（含未知键）、无 options 逐字节现行为回归锚、schema 同 depth 裁剪 + 截断标记 + 别名闭包收缩、`schema: null` 语义不变——红绿契约 + 负控，同 issue #273 打法；
- **`omitted` 计数语义**：depth 条目 = 直接子项数（非后代总数）、width 条目 = 超限子项数——显式断言（fixture 直接子项数 ≠ 后代总数）；
- **零物化行为哨兵（主动机回归保护）**：被截子树内埋投影不可表示值（non-finite number / 稀疏数组空洞）——预算读必须 `ok: true`（递归未触及）；「先全量物化再裁剪」的退化实现会触发 `PATH_NOT_ALLOWED` 而变红。行为级断言，不依赖性能基准；
- **width 对投影无操作**：仅触发 width 的预算读，其 schema 投影与同路径无预算读的投影逐字节相等；
- **载体单元（doc-runtime 公共面）**：预算递归截断省略结果、缺席吸收纪律不破、敌意 path 零 throw、终态目标预算 no-op；
- **类型面（type-level）**：无 options 保持 `PathAt` 承诺、预算读全字段可选、在场标量保精确类型、数组元素递归；
- **文档负控**：正则修订（只禁 schema opt-in、放行预算）、形状注记（恰三键 → 恒五键）同步、**typed-access 纪律条款**（「静态完整性需求不传预算；预算读一律可选访问」）纳入作用域文档锚定；
- registry lease 透传断言（既有 registry 测试延伸）；
- 影响包全套门禁 + root `pnpm typecheck` / `pnpm test`；发布随各包 minor bump。

## 开放问题

- **字节级预算**：序列化期才精确可知，运行时递归中只能估算——当前归调用方字节闸（L2 工具层）；若未来运行时侧出现实测需求，需研究递归中的字节估算与超限语义，单独评估。
- `maxTotalNodes`（总量护栏）：待实测出现「预算合法但总量失控」案例再评估；
- 截断条目携带被截容器内部子键列表：v1 明确不带，待枚举进阶需求实证；
- L2 会话级只读工具（mabf-nomicore-read）的 `depthPerPath` 透传：实现落地后的范围外跟进。
