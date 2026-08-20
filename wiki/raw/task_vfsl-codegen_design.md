# 设计 — 功能开发：投影生成器 `@nomicore/vfsl-codegen`（Issue #26 / F2 / ADR 0005）

- **任务**: feature（生成器包 + CLI + CI regen-diff 保鲜）
- **Worktree**: /home/wangjian/nomicore-fix-issue-26（基点 0be8c11，分支 fix/issue-26-on-adr-vfsl-protocol）
- **设计角色**: SA1（本文档为唯一产出；不含生产代码）
- **契约锚点**: SA6 四红灯测试（`packages/vfsl-codegen/test/`）+ ADR 0005 §3/§4/§5 + ADR 0004 D1–D5 + ADR 0003 §4 + 前序票设计 `wiki/raw/task_vfsl-protocol_design.md`（canonical 发射格式先例）
- **验证声明**: 本设计中所有「协议级假设」均有设计期实测证据（见 §10）；发射格式 v3 已用脚本对全部可满足断言逐条机器验证（见 §3.9）。
- **修订记录**: **R2**（SA2 reject 修订，逐条回应表见文末）——落实攻击点 #1（CRITICAL：§3.2 值侧 ref 优先规则）、#2（ROOT 形态范围限界）、#3（idBase 约定归属 + G 票交接）、#4（空领域集阶段门 `--allow-empty-domains`）、#5（@types/node）、#6（SchemaSourceError → exit 2）、#8（GENERATOR_VERSION 自同步 + SA7 watch-item）；并采纳 SA2 红线测试建议为 SA6 契约增补建议（§9.2.2）。宏观决策（格式 v3 / §7 接线 / tsx 载体 / 依赖纪律框架）经 SA2 独立复验成立，本轮不动。

---

## §1. 契约对账（以 SA6 契约定形为锚）

### 1.1 逐条采纳（无异议部分）

| SA6 契约条款 | 设计采纳 | 依据 |
|---|---|---|
| `generateProjection(derived: DerivedSchema, opts?: { sourceText?: string }): string` 纯发射器 | **原签名原命名采纳**（开放点 1：SA1 可改名但不必） | 测试以该名 import；可观测语义 = 吃派生 schema、返回文本、sourceText 进头注哈希 |
| `declare module '@nomicore/vfsl-protocol' { interface VfslPathMap { … } }` 增广载体 | 采纳 | ADR 0005 §4；样板 = `vfsl-protocol-projection.test-d.ts` 顶部活样板 |
| 顶层键 = ROOT 的字段、路径无 `ROOT` 前缀（D5） | 采纳；ROOT 默认不作为具名别名发射（其 map 字段直接成为接口成员）；**R3 精化**：被引用时（ADR 0003 §2 ROOT-as-积木）→ `UnsupportedRootReferenceError` 响亮拒绝（§3.4 R3 处置段，总控定夺 (a) 案）——路径无 `ROOT` 前缀的核心语义与负例正则安全性（`ROOT:` 成员形与 `ROOT =` 声明形均永不出现、正则恒不命中）均不变 | 测试负例 `not.toMatch(/^\s*['"]?ROOT['"]?\s*:/m)` |
| `YMap`→`'map'`、`YArray`/裸 `T[]`→`'array'` + `Record<\`${number}\`, 子表>`（D1）、`YPlainArray`→`'plain'` 纯值终态（无下钻子树）、`YLeaf`→`'leaf'`、`YXmlFragment`→`'xml-fragment'` string 终态 | 采纳（逐行算法见 §3） | ADR 0004 D1；attachments 双断言（正例 + 禁止 `Record<\`${number}\`` 负例） |
| `Record<Pattern 键,…>`→`Record<string, 值位子树>` | 采纳 | byId 双正则 |
| ref→别名引用、不内联展开 | 采纳，落为**具名类型别名声明 + 引用位点 `PathSchema<别名, kind>` 包装**（见 §3.4；**R2：引用位的权威判定依据 = 值侧 ref**，见 §3.2 规则 0——内联展开无法支持自引用别名，且 byId 正则强制引用位以 `PathSchema<` 开头） | ADR 0003 §4；byId 正则 `Record<string,\s*PathSchema<` |
| docs 三槽 → TSDoc | 采纳（aliasDocs 全 fixture 断言；fieldDocs/markerDocs 按 walkDocs 文法镜像查找，见 §3.7） | AC2 |
| 判别式联合 → 可窄化 TS 判别联合 | 采纳；**发射器不写 `\| undefined`**——read 宽度由协议包 `PathValue` 的联合合并规则产生（发射物成员形状 = narrow test-d 参照样板逐成员字面量判别） | ADR 0004 D2；narrow test-d 参照 |
| CLI `--domains <dir>` flag | **采纳 SA6 提议形态**（开放点 2：flag 名与位置参数皆可，从测试用例） | `generate-cli-check.test.ts` 三处 `--domains` |
| `generate` 退 0 / `--check` 新鲜退 0 / 过期退非零 | 采纳，退出码语义见 §5.4 | AC4 |
| CI 步骤归 SA3/SA4 落地 | 采纳；本设计给出步骤定义（§6），SA3 落地 | 开放点 4 |

### 1.2 异议（显式列出，须总控/SA6 裁决后 SA3 才能全绿）

**异议 #1（P0，阻塞转绿）——`generate-mapping-table.test.ts` 三条正则断言对任何合法 TS 的 D1 发射物结构性不可满足。**

涉及断言（文件行号）：
- L102 `tags` 正则 `/tags\s*:\s*PathSchema<Record<\$\{number\}[^,]*,\s*['"]array['"]\s*>/`
- L107 `items` 正则（同形）
- L133 `entityList` 正则 `/entityList\s*:\s*PathSchema<Record<\$\{number\},/`

两层不可满足证明（设计期实测，脚本 `/tmp/probe2.mjs`、`/tmp/probe3.mjs` 对正则原文逐字节提取后验证）：
1. **反引号缺失**：正则在 `Record<` 之后要求**立即**出现 `${number}`；而合法 TS 的模板字面量类型键必须在 `${number}` 前有开头反引号（`` Record<`${number}`, …> ``）。`Record<${number}`（无反引号）是 TS 语法错误。同一文件 L100 的 `toContain('Record<`${number}`')`（字符串形式、带双侧反引号）与 it() 标题 `'… PathSchema<Record<\`${number}\`, element>, \'array\'>'`（带转义反引号）证明作者知道正确格式——三条正则在转写时丢掉了反引号。
2. **`[^,]*` 逗点盲区**（tags/items 附加一层）：元素子表 `PathSchema<string, 'leaf'>` 内含逗号，`[^,]*` 在元素的首个逗号处截断，故即便补上反引号，该正则仍要求 Record 的 K-V 逗号后**紧跟** `'array'>`——即 Record 值类型 = 字面量 `'array'`，语义错误。

**结论与出路**：这是测试正则转写 bug，非契约语义变更——被测意图（it 标题 + 简报映射表行 + `toContain`）与 §3 的 v3 格式完全一致。处置：**由 SA6 修订这三条断言**（SA6 owned 文件，断言语义不变、正则对齐 v3 格式），建议修订稿见 §9.2。SA1/SA3 不得为迁就坏正则而发射语义错误的类型（违反 D1「下标段可解析、值类型精确」，G 票 dogfood 即崩）。

> **R2 状态更新**：SA6 修订**已落地**（SA2 评审报告 §附注 + 本设计 R2 期间 `grep` 复核：L102/L107/L133 已与 §9.2 建议稿逐字一致）——异议 #1 处置闭环。SA2 评审另附观察 #7：L115 内联负例正则（`.toBe(false)` 位）同缺反引号、对合法 TS 恒不命中（负例恒过、检测力为零，当前无害——孪生正例 L113 已覆盖 plain 终态语义）；已并入 §9.2.2 的 SA6 顺手修订建议。

**异议 #2（P1，阻塞 AC3 的真实性）——`generate-discriminated-narrow.test-d.ts` 当前是「空转绿」，typecheck 从未真正编译它。**

SA6 记录 §4 开放点 3 断言「本文件经根 vitest typecheck（vfsl-protocol tsconfig）已可跑（Type Errors no errors）」。实测推翻「已可跑」的语义（§10 探针 D/E）：
- 同一故意类型错误（`expectTypeOf<number>().toEqualTypeOf<string>()`）放在 `packages/vfsl-protocol/test/`（typecheck tsconfig 项目 include 内）→ vitest 报 1 failed；
- 放在 `packages/vfsl-codegen/test/`（项目外）→ **1 passed、Type Errors no errors**（空转绿）。

根因：根 `vitest.config.ts` 的 `typecheck.tsconfig: './packages/vfsl-protocol/tsconfig.json'`，其 include 仅 `["src/**/*.ts", "test/**/*.ts"]`（相对 vfsl-protocol 包）——codegen 的 test-d 不在项目内，tsc 从不编译它。**若不接线，AC3「编译级窄化」没有任何真实检查**。处置：§7 接线方案（根 `tsconfig.typecheck.json` + vitest typecheck 重指）。接线后该文件从空转绿变为真编译——其参照样板复刻自已验证的 `vfsl-protocol-projection.test-d.ts` 模式，预期保持绿；若真编译下转红，属测试 bug 上升为 SA6 异议，SA3 不得改断言（见 §9.1）。

**异议 #3（观察，无需改动）——发射格式被断言双重锁定，SA3 无格式自由度。**
- emission 测试 L72-73 `['"]kind['"]\s*:\s*PathSchema<['"]image['"]…` 强制**联合成员对象字面量的键带引号**；
- mapping 测试 `fieldKind('label','leaf')` 正则 `label\s*:\s*PathSchema<` 强制**接口成员键不带引号**（带引号时 `'label':` 的闭引号截断匹配）。

v3 格式同时满足两者（§3.5 规则）。列此异议意在告知 SA3：格式是契约推导物，不得自行调整引号/排版风格。

---

## §2. 包结构（`@nomicore/vfsl-codegen` 0.1.0）

```
packages/vfsl-codegen/
  package.json          # name=@nomicore/vfsl-codegen, version=0.1.0, private, type=module
                        # exports: { ".": "./src/index.ts" }   ← 与兄弟包同构（类型级自引用入口）
                        # dependencies: { "@nomicore/vfsl": "workspace:*" }        ← CLI 运行时（parse/evaluate/FileSchemaSource/assertVfslDialect）
                        # devDependencies: { "@nomicore/vfsl-protocol": "workspace:*",  ← test-d 类型解析（探针 B 证明无链接则 TS2307）
                        #                     "@types/node": "^20",                      ← R2/SA2 #5：src 用 node:crypto/fs/process（与 vfsl 同版对齐；兄弟包正确先例是 vfsl 而非 protocol）
                        #                     "typescript": "^5.9.3", "vitest": "^3.2.4" }  ← 与兄弟包同版
  tsconfig.json         # { "extends": "../../tsconfig.base.json", "include": ["src/**/*.ts", "test/**/*.ts"] }
  src/
    index.ts            # 公共导出面（唯一）：export { generateProjection }; export type { GenerateProjectionOptions }
    emitter.ts          # 核心纯发射器：structure+values 并行走查 → PathSchema 类型文本（§3）
    valuetype.ts        # 纯值上下文投影：ValueSchema → TS 值类型文本（plain/leaf/enum/pattern/ref，§3.6）
    docs.ts             # walkDocs 文法镜像的语法路径构造 + 三槽 docs → TSDoc 块（§3.7）
    header.ts           # GENERATED 头注 + sha256 源文本哈希（§4；node:crypto，零外部依赖）
    collect.ts          # CLI 编排纯函数：FileSchemaSource 消费 + 方言断言 + parse/evaluate + 产出 {outPath, text}[]
    cli.ts              # 参数解析（--domains <root> 默认 cwd、--check）+ 写盘/全量重生成 diff + 退出码
  test/                 # SA6 已种 4 文件（[SA6 owned]；SA3 不改断言逻辑）
```

**裁决记录**：
- **无 `bin` 字段**：根脚本直接 `tsx packages/vfsl-codegen/src/cli.ts`（§5.2），私有 monorepo 包不需要可执行入口的打包形态。
- **公共导出面最小化**：仅 `generateProjection`（+ 选项类型）。CLI 内部函数不导出——被测面与契约面重合，杜绝 scope creep。
- **src 内对 `@nomicore/vfsl` 用包名导入**（`import { FileSchemaSource } from '@nomicore/vfsl'`），经 workspace 链接解析（机制已实证，§10）。测试文件维持 SA6 的相对路径导入 `../../vfsl/src/index.js` 不动（既有先例 + 隔离未接线风险）。
- **不种 `domains/`**：F2 不创建任何领域文件（G 票 #27 职责）。CLI 在仓内运行时 domains/ 不存在 → 空领域集语义（§5.5）。

---

## §3. 映射表发射算法（核心纯发射器）

### 3.0 输入输出

`generateProjection(derived: DerivedSchema, opts?: { sourceText?: string }): string` —— 纯函数：同输入逐字节同输出（测试断言 `emit() === emit()`，CI regen-diff 的前提）。输入是 `evaluate` 的派生 schema 七槽（**SA3 不得改输入形状**——#20/#29 已冻结）。`opts.sourceText` 仅用于头注哈希；缺失时头注写 `Source hash: sha256:<未提供>`（仍确定性）。

### 3.1 发射物总体结构（单域文件，四段）

```ts
/* ① GENERATED 头注（§4） */

/* ② 具名别名声明（声明序；ROOT 除外——ROOT 不可被引用，引用链抵达即 UnsupportedRootReferenceError，R3，§3.4 处置段）——每别名一个：
   /** <aliasDocs[name] 逐行> *\/
   export type <AliasName> = <别名内部类型发射>;      */

/* ③ 增广载体 */
declare module '@nomicore/vfsl-protocol' {
  /** <aliasDocs['ROOT'] 逐行> *\/        ← 根级 doc 作接口 TSDoc
  interface VfslPathMap {
    <ROOT map 字段（声明序）——接口成员发射，§3.5>
  }
}
```

文件因 `export type` 成为 module——别名类型不泄漏全局（多域生成文件同名别名零冲突）；`declare module` 增广在文件被纳入编译时生效（消费方 tsconfig include 覆盖即生效，与 test-d 增广同机制）。

### 3.2 结构树 × 值树并行走查（唯一算法骨架）

派生 schema 的物化语义在 `structure`/`aliases`（七槽前四），值语义在 `values`——**叶子/纯值的 TS 类型只能从值树取**（结构树叶节点无类型信息）。发射器对两棵树做并行走查。

> **两树不对称是求值器冻结契约，走查不是同形对照**（R2，SA2 #1）：`packages/vfsl/src/evaluate.ts` 文件头 L15-16 明文——「结构树侧 Record 值位解析（索引/下钻可达）；值 schema 侧 Record 值位仍 ref 终态（`values` 有自己的全量别名表支撑穿透）」；结构侧 ref 仅在四个解析点展开（同文件 L8-13：ROOT 入口 / YMap 实参 / Record 值位 / 无子终态内联），其余结构形 ref 为按名终态。故**同一位点上结构侧可能是已解析终形而值侧仍是 `ref`**（五类合法配对实测见 §10 行 10）。**引用位发射的权威判定依据 = 值侧**（§3.4）。

```
emitNode(node: StructureNode, value: ValueSchema, path: string): string

【规则 0 · 值侧 ref 优先（R2，SA2 #1）】emitNode 首查值侧：
  value.kind === 'ref' → 一律发射
      PathSchema<别名名, kindOf(别名名)>
  不论结构侧为何（ref 终态、或经求值器解析点①–④产出的已解析终形——两形同义，
  不属失配）。kindOf(别名名) = 沿 aliases 表取结构节点（条目本身若为 ref 则沿别名链
  解析，遇环 → throw——纵深防御，正常输入不可达：E106 已在解析层拒绝一切别名环，SA2 实测七形态全拒；R3，SA2 R2-4），按 kind 映射：map→'map'、union→同形裁决（成员结构 kind 全员同形 →
  该 kind；异形 → UnsupportedUnionKindError，§3.2 union 行，R3）、array→'array'、
  plain→'plain'、leaf→'leaf'、xml-fragment→'xml-fragment'。
  ref 目标为 ROOT（ADR 0003 §2「ROOT 可被其他别名引用」，六形态合法、实测全谱见
      §10 行 12）→ 命名化 loud throw UnsupportedRootReferenceError（消息前缀
      「ROOT 不可被引用」；CLI 顶层 catch → exit 2 + 登记后续票，与 §3.2.1 同构；
      裁决与 D5 关系论证见 §3.4 R3 处置段）。别名名为 ROOT 时（值侧 ref 目标 /
      kindOf 链解析 / 段② 走查任一抵达 ROOT）一律转本错误——ROOT 仅作入口根，
      不作引用目标（R3，SA2 R2-1，总控定夺 (a) 案）
```

```
【规则 1 · 字段成员位先行剥离 optional 包装（R3，SA2 R2-2）】**optional 字段**的值侧
为 optional 包装（**非 optional 字段不包装**——总控勘误，SA2 R3 复审路由 2 措辞纠偏：
SA2 实测非 optional 字段 `a: YLeaf<string>` 值侧为裸形 `scalar`；ValueSchema 冻结 kind 'optional'「仅对象字段 ?: 包装」，v1
方言 ?: 一等特性——SA2 实测：`label?: string` → 结构 `label?:leaf`、值 `opt(scalar)`；
`m?: Record<…>` → 值 `opt(obj{…})`）。发射器在字段位**按 kind 条件剥壳**（opt → 内层值），
把字段值递给 emitNode / 规则 0 判定**之前**完成：emitNode 恒收剥壳后的值。可选性不在值位表达，以
**键后 `?`** 表达（§3.5），权威源 = 结构侧 MapField.optional（与值侧 optional 同源于
IR f.optional、恒同步——禁止双侧各判一次，双判 = 双 `?`「title??:」非法 TS）。冻结
契约限定 optional 仅出现在对象字段成员位 → 字段位剥壳即全覆盖。由此规则 0 的首查
`value.kind === 'ref'` 与配对表「配对值 kind」列**永不遇 'optional'**——optional 不是
失配守卫的输入，也不是配对表的行。
```

| 结构 kind | 配对值 kind | 发射 |
|---|---|---|
| `map`（封闭字段） | `object`（fields） | `PathSchema<{ '字段': <emitNode>; … }, 'map'>` |
| `map`（动态键：fields 恰一 `'<key>'`） | `object`（带 keyPattern + `'<key>'` 字段） | `PathSchema<Record<string, <emitNode(值位)>>, 'map'>`（Pattern 键 → string） |
| `array` | `array` | `PathSchema<Record<\`${number}\`, <emitNode(元素)>>, 'array'>`（裸 `T[]` 与 `YArray` 同形，D1） |
| `plain`（终态，无子树） | `array`（或嵌套值形态） | `PathSchema<<值投影 V>[], 'plain'>`（V = valuetype 投影；**无** `Record<\`${number}\`>` 子树——下钻即 UnknownPath，D1 终态禁令） |
| `union` | `union` | `PathSchema<<成员发射> \| <成员发射>, <联合 kind>>`（成员声明序；成员 = 各成员位按本表行独立走查——map×object / array×array / (X,ref) 规则 0 等，不预设成员恒 map，R3）。**联合 kind 裁决（R3，SA2 R2-3）**：成员结构 kind 全员同形 → 发射该 kind（union(array\|array) → `'array'`、union(map\|map) → `'map'`）；异形（array\|map 混合、ref 链解析后异形——E309 只拒标量×容器，此类输入合法存在）→ 命名化 `UnsupportedUnionKindError` loud 拒绝（CLI exit 2 + 登记后续票；`VfslKind` 五值词汇表无联合 kind，不存在诚实单值）——**禁止默认 `'map'`**。消息模板：`UnsupportedUnionKindError: 联合成员结构 kind 异形（F2 仅支持全员同形联合；得到 <k1\|k2\|…>）——异形联合需协议层 PathKind 联合语义，由总控开后续票登记`（观察 2：原 `<后续票>` 占位符落为登记说明，§5.3）。**SA3 对齐（R3；总控勘误，SA2 R3 复审路由 1②）**：实现（commit 008e34c）已落地的是 **inline/段② 路径**的同形裁决——emitter.ts `UnsupportedUnionKindError` + unionKind；**kindOf 引用位路径当时未落地**（kindOfAlias 终点把 union 无条件映射 `'map'`，SA2 R3-3 探针实锤 `u: PathSchema<U,'map'>` 误标）——随 SA3 R2 返修（commit 9cd33d2）补齐，本文对齐（非反向追改实现）；SA6 契约断言已落（R5/F 测试块：同形 `'array'` + 异形 toThrow；R6 增补按名引用位锚点 `/u\s*:\s*PathSchema<U,\s*'array'>/`） |
| `leaf` | `scalar`/`enum`/`pattern`/scalar-union | `PathSchema<<值投影>, 'leaf'>`（可空叶 = 值侧标量联合 → `T \| null`） |
| `xml-fragment`（终态） | `xml` | `PathSchema<string, 'xml-fragment'>`（内层结构丢弃——不透明终态，ADR 0003 §5） |
| `ref` | `ref` | `PathSchema<<AliasName>, <kindOf(别名)>>`（§3.4） |
| **任意 X**（ref 终态或已解析终形） | **`ref`** | **规则 0 优先命中**：`PathSchema<<AliasName>, <kindOf(别名)>>`——值侧 ref 位结构侧可为 union（Record 值位解析，如 byId）/ map（YMap 实参解析）/ leaf（别名链终态内联）/ array 元素位 / plain / xml-fragment，均同义（R2，实测五类配对见 §10 行 10） |
| `root` | — | 入口：剥壳取内层 **map（封闭字段）**，其字段进接口成员（D5）；**R3（SA2 R2-1，总控定夺 (a) 案）：ROOT 仅作入口根、不作引用目标——引用链（值侧 ref 目标 / kindOf 链 / 段② 走查）抵达 ROOT → `UnsupportedRootReferenceError`（§3.4 R3 处置段）**；内层非封闭 map/union → §3.2.1 ROOT 范围限界 |

**结构/值失配 = 响亮失败**（拒绝虚假降级）：**仅在两侧均非 ref 时**，`emitNode` 遇到 kind 组合不在上表（如 `leaf`×`object`）→ `throw new Error('structure/value desync at ' + path)`。这是求值器契约破坏的正常路径缺陷，绝不静默降级。**未知 kind**（未来方言演进）同理 throw。值侧 ref 位**永不失配**（规则 0 全覆盖——「loud 错对象」比静默更糟，R2 教训）。optional kind 经规则 1 在字段成员位先行剥壳，emitNode **永不遇 optional kind**——optional 既非失配守卫的输入、亦非配对表的行（R3，SA2 R2-2）。

#### 3.2.1 ROOT 形态范围限界（R2，SA2 #2）

ADR 0003 §2 规定 ROOT 必须 map 形，合法形态四种：**裸对象 / `YMap` / `Record` / 全 map 形联合**。四种形态在 F2 的处置（不允许任何合法输入处于未定义状态）：

| ROOT 形态 | F2 处置 | 依据 |
|---|---|---|
| 裸对象 / `YMap`（封闭字段） | **支持**：接口成员 = 字段（§3.1/§3.5），全部红灯测试即此形态 | v3 格式已验证（§3.9） |
| `Record` 形（动态键；实测 structure = `map` 恰一 `'<key>'` 字段，§10 行 11） | **不支持** → `UnsupportedRootShapeError`（命名化；CLI 捕获 → exit 2） | 顶层动态键在接口成员形态下**无诚实承载**：索引签名 `[k: string]: …` 与多域增广合并冲突（TS 要求全部成员满足索引签名——第二域落地即编译错误）；字面 `'<key>'` 成员则只解析字面路径段（静默语义错误 = 虚假降级）。需协议层 D5 扩展，登记后续票 |
| 全 map 形联合（实测 structure = `union`，§10 行 11） | **不支持** → `UnsupportedRootShapeError`（同上） | 成员键集并集作顶层成员会**丢失 D2 read 宽度**：接口成员 `a: PathSchema<string,'leaf'>` 直接读出 `string`，而联合 ROOT 下 `a` 是成员独有键、read 应为 `string \| undefined`——该宽度由协议 `PathValue` 在**穿越 union 节点**时合成，而顶层是接口（map 本体）非 union 节点，机制不可达。需协议层扩展，登记后续票 |

错误消息（可断言）：`UnsupportedRootShapeError: ROOT 形态不支持（F2 仅支持封闭 map 形：裸对象/YMap；得到 <实际形态>）——Record/联合形 ROOT 需协议层顶层动态键/成员并集语义，由总控开后续票登记`（观察 2：原 `<后续票>` 占位符落为登记说明，§5.3；SA3 已实现消息尾为「见后续票」，路由 SA3 时同步本尾串）。G 票 #27 种植领域时若用 Record/联合 ROOT 将得到响亮拒绝（而非静默错发射）——交接注记见 §5.3。

### 3.3 数组与纯值终态（D1 的两条边）

- `array`：元素子表 = 元素节点的 `emitNode`（完整 PathSchema 树）——下标段可解析、值类型精确。例：`tags: YLeaf<string>[]` → ``tags: PathSchema<Record<`${number}`, PathSchema<string, 'leaf'>>, 'array'>``。
- `plain`：结构侧是**终态**（`{kind:'plain'}` 无子树）；值侧给元素值语义 → 值投影数组。例：`attachments: YPlainArray<YLeaf<string>>` → `attachments: PathSchema<string[], 'plain'>`。终态禁令由发射结构天然保证（值投影永不产生 `Record<\`${number}\`>`）。

### 3.4 ref → 具名别名 + 引用位包装（不内联展开）

- **每个具名别名在段 ② 发射一次（ROOT 除外——ROOT 不可被引用，R3 见下处置段）**：`export type <Name> = <内部类型>`，内部类型 = 该别名根节点**去掉 `PathSchema<…, kind>` 外壳**后的内容（成员联合 / 字段对象 / 值投影）。
- **引用位**（值侧 `ref`，规则 0）：`PathSchema<<Name>, <kindOf(别名结构)>>`——kind 由别名结构节点 kind 映射（map→`'map'`、union→同形裁决：成员结构 kind 全员同形 → 该 kind，异形 → `UnsupportedUnionKindError`〔R3，SA2 R2-3，§3.2 union 行〕、array→`'array'`、plain→`'plain'`、leaf→`'leaf'`、xml-fragment→`'xml-fragment'`；别名名为 ROOT → `UnsupportedRootReferenceError` loud throw〔R3，SA2 R2-1，见下处置段〕）。**权威判定依据 = 值侧**（R2）：值侧 `ref` 即引用位，即使结构侧已被求值器解析为终形（实测：`metaRef: YMap<Meta>` 的结构侧是已解析 map `{m: leaf}`、值侧仍 `ref Meta` → 仍发射 `PathSchema<Meta, 'map'>` 不内联，§10 行 10）。
- **ref 目标为 ROOT 的处置（R3，SA2 R2-1；裁决 = (a) 命名化 loud 拒绝——总控定夺，不采纳 (b) 按需具名发射）**：ADR 0003 §2 明文「`ROOT` 可被其他别名引用（既当根又当积木，合法）」，六种触发形态实测全谱：字段位 / 别名链 / 数组元素 / Record 值位（纯规则 0 位——结构侧经解析点③内联、仅值侧暴露 `ref:ROOT`）/ YMap 实参（纯规则 0 位，解析点②）/ 直引；YPlainArray 实参为 E307 解析层拒绝、不触发（证据 §10 行 12）。**枚举补遗（总控勘误，SA2 R3 复审路由 2 / R3-1）**：第七种合法触发形态 = **联合成员位（独立别名内）**——`type U = A | ROOT; type X = YMap<{ u: U }>` → `U=union(ref(A)|ref(ROOT))`（注意：ROOT 自身字段内联 `A|ROOT` 与 ROOT 直自引均被 E106 环检拒绝，独立别名 U 内则合法）；三检查点按位点设防而非按形态枚举（联合成员发射走 emitNode 值侧 ref 分支 = 检查点①，成员结构 kind 解析经 kindOf 链 = 检查点②），处置安全性不受影响。R1/R2 的「ROOT 除外」只跳过段② ROOT 声明、不拦截引用链——这些合法输入的生成物引用未声明名 `ROOT` → 下游编译 TS2304 静默破碎、regen-diff 全绿掩盖。**R3 规则：值侧 ref 目标为 ROOT、kindOf 链解析抵达 ROOT、或段② 走查遇目标为 ROOT 的别名——任一命中 → `throw new UnsupportedRootReferenceError(path)`（命名化，与 §3.2.1 `UnsupportedRootShapeError` 同构）；CLI 顶层 catch → 结构化 stderr + exit 2；被引用 ROOT 的协议层扩展登记后续票（观察 2，§5.3）**。消息模板（可断言）：`UnsupportedRootReferenceError: ROOT 不可被引用（F2 仅支持 ROOT 作入口根——顶层键 = ROOT 的字段；引用位 <path> 抵达 ROOT）——被引用 ROOT 需协议层引用目标语义，由总控开后续票登记`。**选 (a) 的理由（一句）**：与 §3.2.1 Record/联合 ROOT 限界同一诚实策略——协议层扩展前响亮拒绝优于静默破碎或破例具名 ROOT；破例发射 `export type ROOT` 会让同一 map 在接口成员与具名声明两处出现，动摇 D5「顶层键 = ROOT 字段」的单一载体语义（接口成员为顶层唯一载体）；负例正则 `/^\s*['\"]?ROOT['\"]?\s*:/m` 在本方案下恒不命中（`ROOT:` 成员形与 `ROOT =` 声明形均永不出现），正则安全不再是论证负担。**实现与测试现状对齐（总控路由参考）**：SA3 实现（008e34c）段② 现为「ROOT 除外」跳过（`if (name === 'ROOT') continue`）且未拦截引用链——本处置为**新增拦截补丁**（发射器三检查点 + CLI catch 行），非既有行为微调；SA6 已按前稿 (b) 裁决落了建议 D 断言（`R5/D` 测试块——断言 `export type ROOT` 在场），须随本裁决翻转为 `toThrow(/ROOT 不可被引用/)`（§9.2.2 建议 D 稿）；既有红灯 fixture 零 ref→ROOT 用例（SA2 已核），补丁对现行断言零扰动。
- **为什么必须具名而非内联**：(a) **（R3 改述，SA2 R2-4）**解析层 E106 已保证别名图无环（SA2 实测七种环形态全拒：直接自引/字段位/经数组元素/经 YArray 实参/经 Record 值位/经 YMap 实参/间接 A→B→A）——自引用别名（`type A = YMap<{ next: A }>`）属正常输入**不可达**；具名引用的必要性来自 (b)(c) 与 (X,ref) 配对（规则 0 的别名引用位），不依赖环可达性（「内联发射会无限递归」仅在环可达的假设下成立，保留为纵深防御余量）；(b) byId 正则 `Record<string,\s*PathSchema<` 强制引用位以 `PathSchema<` 开头（裸别名名不匹配）；(c) aliasDocs 的「独立发射位」语义（测试断言 `'实体的判别联合'` doc 在场）。
- **别名声明序** = derived.aliases 键序（JS 对象插入序 = 源声明序，确定性）。**未在结构中引用的别名也发射**（fixture 的 `Id`：独立声明 `export type Id = string;` 承载其 aliasDocs——AC2 断言 `'Id：Pattern 键约束'` 在场的落点）。

### 3.5 键的引号规则（契约推导，异议 #3）

- **接口成员**（`VfslPathMap` 增广体）：键为合法 TS identifier 时不加引号（`label: …`）；非 identifier（如 `my-field`）时加引号。→ 满足 mapping 测试 `fieldKind` 正则族。
- **对象字面量成员**（联合成员、匿名 map 内层）：**一律加引号**（`'kind': PathSchema<'image', 'leaf'>`）。→ 满足 emission 测试 `['"]kind['"]` 正则族；同时是总量规则（任意字段名零检查发射）。
- 可选字段（`MapField.optional`）：键后 `?`（`'field'?: …` / `field?: …`）。

### 3.6 纯值投影（`valuetype.ts`，plain/leaf 值位专用）

```
projectValue(v: ValueSchema): string
  scalar  → 'string' | 'number' | 'boolean' | 'null' | 'unknown'
  enum    → 字面量联合（声明序）：'a' | 'b' | 1 | 2（字符串值单引号）
  pattern → 'string'（Pattern → string 映射）
  xml     → 'string'
  array   → <projectValue(元素)>[]            ← 仅纯值上下文
  object  → { '字段': <projectValue>; … }（封闭）；Record → Record<string, …>
  union   → <成员> | <成员>（声明序）
  optional→ <projectValue(内层)>（可选性在字段位以 ?: 表达）
  ref     → 被引别名**值投影的内联展开**；展开途中遇同一 ref 环 → throw ValueContextCycleError（纯值自引用是方言病理，响亮拒绝；结构侧 ref 环经具名别名天然安全；**纵深防御，正常输入不可达**——E106 已在解析层拒绝一切别名环〔SA2 实测七形态全拒〕，本守卫兜未来方言演进；R3，SA2 R2-4）
```

### 3.7 docs 三槽 → TSDoc（`docs.ts`）

查找键 = 语法路径，**文法逐字镜像 `evaluate.ts` 的 `walkDocs`**（设计期 grep 实证，`packages/vfsl/src/evaluate.ts:360-397`）：
- 别名体走查以**别名名为根**（L360 `walkDocs(a.type, a.name, …)`；ROOT 同理以 `'ROOT'` 为根）——发射器对每个别名发射时以别名名起路径；
- 字段 → `${path}.${字段名}`；Record 值位 → `${path}.<key>`；数组元素 → `${path}.<item>`；联合成员 → `${path}.<member ${i}>`（成员内字段续接）；
- 标记实参：`YArray`/`YPlainArray` 实参入 `<item>` 段（L396），`YMap`/`YXmlFragment`/`YLeaf` 实参路径透明（同 path）。

发射规则：
- `aliasDocs[name]`（含 `'ROOT'`）→ 段 ② 别名声明 / 段 ③ 接口的 TSDoc 块（每条 doc 一行，逐字——测试断言 `根文档说明`/`实体的判别联合`/`Id：Pattern 键约束` 原文在场）；
- `fieldDocs[语法路径]` → 对应成员位的 TSDoc 块（接口成员 / 对象字面量成员前）；
- `markerDocs[语法路径]` → 对应节点位的 TSDoc 块；
- 空数组槽不发射注释；所有块 `/** … */` 配平（测试断言 opens ≤ closes）。

### 3.8 判别式联合（AC3）

有 `discriminator` 的 union：成员按声明序发射为对象字面量联合；判别字段按**精确字面量** leaf 发射（值侧 enum 单值 → `'image'`）。**发射器不合成 `| undefined`**——D2 的 read 宽度是协议包 `PathValue` 对「联合键空间 = 成员键集并集」的类型合并结果（narrow test-d 参照样板即此形状）。无 discriminator 的 union：同形状联合发射（成员互异字段天然只在所属成员出现）。

### 3.9 发射样例（SA6 mapping fixture 的期望输出；已机器验证）

```ts
/**
 * GENERATED FILE — DO NOT EDIT.
 * Generator: @nomicore/vfsl-codegen@0.1.0
 * Source hash: sha256:<64 hex>
 * Regenerate with: pnpm generate
 */

/** 实体的判别联合 */
export type Entity =
  | { 'kind': PathSchema<'image', 'leaf'>; 'url': PathSchema<string, 'leaf'> }
  | { 'kind': PathSchema<'text', 'leaf'>; 'richBody': PathSchema<string, 'leaf'>; 'title': PathSchema<string, 'leaf'> };

/** Id：Pattern 键约束 */
export type Id = string;

declare module '@nomicore/vfsl-protocol' {
  /**
   * 根文档说明
   */
  interface VfslPathMap {
    label: PathSchema<string, 'leaf'>;
    tags: PathSchema<Record<`${number}`, PathSchema<string, 'leaf'>>, 'array'>;
    meta: PathSchema<{ 'count': PathSchema<number, 'leaf'> }, 'map'>;
    items: PathSchema<Record<`${number}`, PathSchema<string, 'leaf'>>, 'array'>;
    attachments: PathSchema<string[], 'plain'>;
    rich: PathSchema<string, 'xml-fragment'>;
    entityList: PathSchema<Record<`${number}`, PathSchema<Entity, 'map'>>, 'array'>;
    byId: PathSchema<Record<string, PathSchema<Entity, 'map'>>, 'map'>;
  }
}
```

**机器验证记录**（探针 `/tmp/probe3.mjs`，正则从测试文件逐字节提取后构造）：上述格式对 mapping 测试 **23 条断言中 20 条** PASS（11 条 `toMatch` 正则中 8 过 3 挂——挂的即异议 #1 坏正则；`fieldKind`×2、ROOT 负例、`toContain`×4、aliasDocs×3、TSDoc 配平全过）；emission 测试 **12 条断言**（9 条正则机器验证 PASS；`/hash/i` 由头注格式 `Source hash:` 满足、2 条 determinism 由 §4 纯函数性保证）。此样例即 SA3 的逐字节验收基准（fixture 头注哈希除外）。

> **R2 算法-样例桥接说明**（SA2 #1 的裁决落点）：R1 版样例只验证了输出文本，未验证**算法**能产出它。R2 补上：样例中 `byId: PathSchema<Record<string, PathSchema<Entity, 'map'>>, 'map'>` 的值位 `PathSchema<Entity, 'map'>` 恰是**规则 0（值侧 ref 优先）**对该位的产出——实测 byId 值位（结构=已解析 union，值=`ref Entity`）经规则 0 发射 `PathSchema<Entity, kindOf(Entity)='map'>`，与样例逐字一致（§10 行 10）。规则 0 是样例文本的算法来源，不再是悬空断言。同规则下的两个追加期望发射（SA6 契约增补建议，§9.2.2）：`leafRef: Id`（结构=leaf，值=`ref Id`）→ `leafRef: PathSchema<Id, 'leaf'>`；`metaRef: YMap<Meta>`（结构=已解析 map，值=`ref Meta`）→ `metaRef: PathSchema<Meta, 'map'>`。

---

## §4. 头注与哈希

```ts
/**
 * GENERATED FILE — DO NOT EDIT.
 * Generator: @nomicore/vfsl-codegen@0.1.0
 * Source hash: sha256:<64 位小写十六进制>
 * Regenerate with: pnpm generate
 */
```

- **哈希算法**：sha256（`node:crypto` 内建，零外部依赖），对 `opts.sourceText` 的 UTF-8 字节流计算，64 位小写 hex 全长输出（不做截断——免碰撞论证）。
- **`Generator` 行版本 = 运行时自同步（R2，SA2 #8a）**：`header.ts` 在首次调用时惰性读取**本包自己的 package.json**（`readFileSync(new URL('../package.json', import.meta.url))`）取 `version` 字段并缓存——版本 bump 后头注**自动**随之变化，regen-diff 自动报警，消除「手工同步 GENERATOR_VERSION 常量」这一漏报失败模式（SA2 指出：常量漏同步时头注对版本说谎且 diff 为空）。读/解析失败 → 命名化 loud throw（绝不静默回退旧值或硬编码值）。**守卫扩界（R3，SA2 R2-5）：`version` 须为非空 string**（`typeof version === 'string' && version !== ''`）——缺失/非串/空串 → 同一命名化 loud throw；否则头注静默输出 `@nomicore/vfsl-codegen@undefined`，对版本说谎且 regen-diff 不报警，正是本守卫要消除的失败模式残余。保留的纪律项：**不得**以任何理由把版本改回硬编码常量；`import.meta.url` 相对解析在本仓两种执行载体（tsx / vitest）下均指向 `packages/vfsl-codegen/package.json`（机制同 §10 行 3 的绝对路径导入，已实证）。
- **确定性**：头注无时间戳、无路径、无环境变量；同（输入, 包版本）→ 逐字节同输出。生成器版本变化 → 头注变 → regen-diff 抓到（正确的生成器漂移检测语义）。
- **测试锚点**：`/GENERATED/`、`/DO NOT EDIT/`、`/hash/i` 三断言 + 两次调用逐字节一致（emission 测试）。
- **哈希的角色**：诊断信息（人看 diff 知道源变了）；**保鲜判定不依赖哈希**——`--check` 是全量重生成 + 逐字节 diff（§5.4），纯哈希比对抓不到生成器逻辑漂移（简报明令禁止的方案）。

---

## §5. CLI（`pnpm generate` / `pnpm generate --check`）

### 5.1 根脚本接线（root `package.json`）

```json
"scripts": {
  "generate": "tsx packages/vfsl-codegen/src/cli.ts",
  …
}
```

pnpm 把脚本名后的参数原样转发给脚本（设计期实证：`pnpm test __no_such_filter__ --passWithNoTests=false` → 参数到达 vitest，exit=1）→ `pnpm generate --check --domains <dir>` = `tsx …/cli.ts --check --domains <dir>`。

### 5.2 执行载体裁决：tsx（根 devDependency）

候选裁决（SA5 锚点 8 开放点）：

| 候选 | 裁决 | 理由 |
|---|---|---|
| **tsx**（`tsx@^4` root devDep） | **采纳** | CI matrix 含 node 20（`ci.yml` L18）排除原生 strip-types（≥22.6）；esbuild 已在依赖树（vitest→vite→esbuild@0.28.2，边际依赖成本≈tsx+get-tsconfig）；**设计期实测**：`pnpm dlx tsx` 成功执行「`.js` 后缀 TS 相对导入 + 仓内 vfsl 真源（parseVfsl/evaluate/FileSchemaSource/assertVfslDialect 全部加载且 evaluate 跑通）」 |
| `node --experimental-strip-types` | 否决 | node 20 无原生 TS 支持；且不做 `.js`→`.ts` 说明符改写 |
| tsc 出 dist | 否决 | dist JS 的 `@nomicore/vfsl` 导入解析到 `exports: "./src/index.ts"`（TS 源）→ node 20 无法执行；级联要求编译 vfsl 并改其 exports——改动面失控 |
| vite-node / 手写 loader | 否决 | vite-node bin 非根直接依赖（需额外声明，与 tsx 等价但非标准 CLI 形态）；手写 loader 是自造轮子风险 |

> **CLI 启动精简要求（R2，SA2 #8b → §9.4 watch-item）**：`generate-cli-check.test.ts` 每 it 串行 spawn 2 次 `pnpm`+tsx（vitest 默认 5s/it 超时）。cli.ts 必须：模块级零重活（无顶层 await/大对象构造）、参数解析与错误早出先行、`@nomicore/vfsl` 全量导入（tsx 现场转译）是主要启动成本——不得再叠加（如禁止启动时做多余 readdir 预扫）。

### 5.3 CLI 流程（`collect.ts` + `cli.ts`）

```
1. 解析参数：--domains <root>（默认 process.cwd()）、--check、--allow-empty-domains
2. source = new FileSchemaSource(root)            ← F1 接缝消费（简报工作内容 1）
3. ids = await source.list()                      ← 空集 → 阶段门（§5.5，R2/SA2 #4）
4. 对每个 id：
   env = await source.load(id)                    ← text 经接缝取得（不自行 readFile .vfsl）
   assertVfslDialect(env)                         ← 首动作 = 方言断言（ADR 0005 §1）
   parsed = parseVfsl(env.text)；!ok → exit 2（issues 全文进 stderr）
   result = evaluate(parsed.module)；!ok → exit 2
   text = generateProjection(result.derived, { sourceText: env.text })
          （ROOT 形态超界 → UnsupportedRootShapeError → 捕获 → exit 2，§3.2.1；
            ref→ROOT → UnsupportedRootReferenceError → 捕获 → exit 2，§3.4 R3 处置段；
            异形联合 → UnsupportedUnionKindError → 捕获 → exit 2，§3.2 union 行，R3）
   outPath = <root>/domains/<idBase>/generated.ts
             idBase = id 剥离 `@<digits>` 后缀（见下「F2 施加的约定」）
5. 冲突检查：多个 id 映射同一 outPath → exit 2（响亮，v1 一域一 schema 约定）
6. --check：全量重生成后与盘上文件逐字节 diff（+ 盘上 domains/**/generated.ts 孤儿检测）
   任何 diff/缺失/孤儿 → stderr 逐文件报告 + exit 1；全新鲜 → exit 0
   无 --check：写盘（含建目录）→ exit 0（幂等：同输入重写同字节）
7. cli.ts 顶层 catch（R2，SA2 #6）：
   SchemaSourceError（list/load/方言断言抛出）与 ENOTDIR/EACCES 等接缝冒泡错误
   → 结构化 stderr（code + message + id/path 上下文）+ exit 2
   ——§5.4 表承诺的「方言断言失败 → 2」由此兑现（不捕获则 node 未处理
   rejection 实际退 1，违背承诺）
```

**输出位置依据**：ADR 0005 §5 明文「`domains/` = 业务 schema 包（schema.vfsl + **generated.ts** + 挂载点 + dogfood 测试）」→ 生成物 = `<domainDir>/generated.ts`。

**idBase = 目录名是 F2 施加的约定（R2，SA2 #3——非 F1 既有）**：F1 两级寻址的一级 = 头部 `@id` 精确入册（权威），二级 `@<digits>` 剥离后按目录名匹配只是**诊断回退**且显式容忍目录名与 @id 背离（load 仍可用）；`SchemaSource` 接缝不暴露来源目录（信封仅 lang/version/id/text），CLI 只能从 id 推导 outPath——这是**接缝限制下 F2 的自设不变式**。约定破坏（`domains/<idBase>/` 目录不存在）→ exit 2，诊断消息**写明规则本体**：`id base 必须等于领域目录名（domains/<idBase>/generated.ts 才是生成位）：id '<id>' → base '<idBase>'，但目录 '<root>/domains/<idBase>/' 不存在`——不静默建错目录。

> **G 票 #27 交接注记（R2，SA2 #3iii）**：本约定要求 G 种植领域时 **`@id` 头与目录名同 base**。ADR 0005 §2 示例头 `@id: vfs3.assets@1`（点号）与简报预告的 G 票目录 `domains/vfs3-assets/`（连字符）**已知冲突**——由 G 票定夺一侧（改 @id 或改目录名）；F2 CLI 对冲突的行为是响亮 exit 2 而非猜测。Record/联合形 ROOT 的范围限界（§3.2.1）同样约束 G 的 ROOT 形态选型。**（R3 增补，SA2 观察 1/2）多域顶层键合并冲突**：多域生成文件的 `VfslPathMap` 接口增广在消费方合并——两域同名顶层键不同类型 → TS2717（D5 单接口载体机制使然，非 F2 可修）；G 落地多域时须定夺顶层键命名规约（或协议层扩展归后续票）。**协议层扩展登记路径（观察 2 定稿）**：Record/联合/**被引用** ROOT（§3.2.1 + §3.4 R3 处置段 (a) 案拒绝面）与异形联合（§3.2 union 行）的协议层扩展**由总控开后续票登记**（收尾时开 GitHub follow-up issue 承接；gh issue list 已核对：当前无实票，#27 是 G dogfood 非协议扩展票）；错误消息模板中原 `<后续票>` 占位符**已落为「由总控开后续票登记」的说明**（§3.2.1 / §3.2 union 行 / §3.4 R2-1 三处统一），票号存在后直接替换为 #N。**（总控登记闭环，2026-08-20 收尾）**：协议层扩展后续票 = **#44**（Record/联合/被引用 ROOT + 异形联合 PathKind 语义）；生成物编译级加固后续票 = **#45**（SA7 N1 缺 import/N2 零别名域 script 退化/N3 别名碰撞守卫 + EACCES 归并注记 + emitter.ts 三处消息尾「见 #44」顺手替换项——总控裁决不在 F2 评审双清后为此单开返修轮，随 #45 或其他 codegen 触码时机一并做）。

### 5.4 退出码语义（AC4；R2 补 #4 阶段门与 #6 错误映射行）

| 场景 | 退出码 |
|---|---|
| `generate` 写盘成功（领域集非空） | 0 |
| `generate --check`：全量重生成与盘上一致（新鲜，领域集非空） | 0 |
| `generate --check`：diff 非空 / 生成物缺失 / 孤儿生成物 | 1（非零，√ AC4「源漂移或生成器漂移」双抓） |
| **零领域集**（`list()` = `[]`：domains/ 不存在、为空、或 `--domains` 路径打错——三者接缝层不可区分，F1 将 ENOENT 设计为合法空集） | 无 `--allow-empty-domains` → **2**（消息说明两可能成因 + flag 用法）；带 flag → 0（显式接受空集） |
| 硬错误：`SchemaSourceError`（方言断言失败 / missing-directive / unknown-id）/ ENOTDIR / EACCES / parse/evaluate 失败 / `UnsupportedRootShapeError` / `UnsupportedRootReferenceError`（R3，§3.4 ref→ROOT 拦截）/ `UnsupportedUnionKindError`（R3，§3.2 union 行）/ id→目录不存在 / 同目录多 id | 2（cli.ts 顶层 catch 结构化 stderr，§5.3 步骤 7） |

### 5.5 空领域集阶段门（R2，SA2 #4）

R1 版「空集 → exit 0」有两个盲区：(a) **post-G**：domains/ 被误删/改名/子模块未挂载 → `--check` vacuous pass 退 0，CI regen-diff 全绿掩盖总回归；(b) **当下即存**：`--domains /typo/path` → F1 `scanDomains` 将 ENOENT 设计为合法空集（`schemasource.ts` L294-305 明文「`domains/` 缺失（ENOENT）→ 合法空集」）→ 静默退 0，调用方无法察觉路径错误。

**修订后语义**：`generate` 与 `--check` 遇零领域集时，除非显式传 `--allow-empty-domains` 否则 **exit 2** + stderr 说明（「零领域集：domains/ 不存在或为空——若 G 尚未落地属预期，请加 --allow-empty-domains；若非预期请检查 --domains 路径」）。CI 步骤在 F2 阶段带该 flag + TODO(#27)（G 落地时移除，届时零集重新变为响亮失败，§6）。SA6 既有 CLI 测试的 hermetic fixture 均含一个领域，不受影响（SA2 评审已核）。**不采纳**「明文接受 post-G 盲区」的备选——阶段门以一个 flag 的成本同时闭合两个盲区。

### 5.6 不越权

F2 不种任何 `domains/` 内容（简报明令；G 票 #27）。CLI 测试用 hermetic 临时目录 fixture（SA6 已锚），不依赖仓内领域。

---

## §6. CI regen-diff（`.github/workflows/ci.yml`）

在既有 `Domain scaffolds check` 步骤后追加：

```yaml
      # AC4（ADR 0005 §4）：全量重新生成 → 与仓内生成物逐字节 diff。
      # 源漂移（schema 改了没重新生成）与生成器漂移（codegen 逻辑变了）双抓——
      # 纯哈希比对抓不到后者，故必须全量重生成再 diff。
      # --allow-empty-domains：F2 阶段 domains/ 尚无领域（G 票 #27 职责）的显式阶段门——
      # 零领域集是 vacuous pass 而非静默通过；G 落地时移除本 flag，届时零集重新
      # 变为响亮失败（防 domains/ 被误删/改名后的回归掩蔽）。
      # TODO(#27)：G 票种植首领域后移除 --allow-empty-domains。
      - name: Generated projection freshness (regen-diff)
        run: pnpm generate --check --allow-empty-domains
```

设计要点：
- **双抓机制**：`--check` = 全量重生成 + 逐字节 diff（§5.4）。源漂移 → 重新生成内容 ≠ 盘上（含头注哈希变化）；生成器漂移 → 同源重生成内容 ≠ 盘上（纯哈希比对在此盲区——简报明令禁止）。
- **前置既有保障**：`pnpm test`（CI 已有步骤）内含 `generate-cli-check.test.ts`——regen-diff 的**机制**（退出码、幂等、漂移检测）在 G 落地前即被 CI 实测；本步骤补充的是**仓内生成物**的保鲜（G 后转为实质校验）。
- matrix（node 20/24）两 job 都跑该步骤——tsx 载体在两版本均可用（§5.2）。

---

## §7. test-d 接线（根 `vitest.config.ts` typecheck）

### 7.1 现状缺陷（异议 #2 的实证）

根 `vitest.config.ts` typecheck 配置：`tsconfig: './packages/vfsl-protocol/tsconfig.json'`（include 仅 vfsl-protocol 的 src+test）。vitest typecheck 只对**落在 tsconfig 项目内**的文件真正编译并归因类型错误；项目外文件仅收集测试名 → 空转绿（探针 D/E：故意类型错误在项目内被抓、在 `packages/vfsl-codegen/test/` 空转通过）。后果：`generate-discriminated-narrow.test-d.ts`（AC3 编译级窄化的唯一载体）当前**零真实检查**。

### 7.2 接线方案

1. **新建根 `tsconfig.typecheck.json`**：
   ```json
   { "extends": "./tsconfig.base.json", "include": ["packages/*/src/**/*.ts", "packages/*/test/**/*.ts"] }
   ```
2. **根 `vitest.config.ts`**：`typecheck.tsconfig: './tsconfig.typecheck.json'`（include 两行不动——vitest 侧筛选与 tsconfig 项目解耦）。
3. **根 `package.json` typecheck 脚本**追加第三包：`tsc -p packages/vfsl/tsconfig.json && tsc -p packages/vfsl-protocol/tsconfig.json && tsc -p packages/vfsl-codegen/tsconfig.json`。

### 7.3 共存安全（合并 typecheck 项目的副作用审计）

单一 program 下多文件 `declare module '@nomicore/vfsl-protocol'` 增广会发生**接口合并**——这是既有文件已显式认知并防御的机制（`vfsl-protocol-empty-fail-closed.test-d.ts` 文件头注释 L8-12 明文记载增广泄漏风险，并已改用本地 `LocalEmptyMap` 锚定空表语义，不依赖「未增广 VfslPathMap 为空」）。合并后：
- empty-fail-closed：`LocalEmptyMap` 本地接口，免疫 ✓；
- projection test-d：断言按具体键路径（`PathAt<Map, ['tree',…]>`），新增无关键 `entityList` 不影响 ✓；
- narrow test-d（codegen）：其增广为 `entityList` 键——进入合并 program 后**首次被真正编译**，参照样板复刻自 projection test-d 已验证模式，预期绿；若转红即 SA6 异议上升，SA3 不改断言。

### 7.4 解析链（接线后各导入的落点）

| 导入 | 从 | 解析途径 | 证据 |
|---|---|---|---|
| `'@nomicore/vfsl-protocol'` | codegen test-d | `packages/vfsl-codegen/node_modules/@nomicore/vfsl-protocol`（devDep `workspace:*` 软链）→ exports → `src/index.ts` | workspace 链接机制实测（§10）；无链接则 TS2307（探针 B） |
| `'@nomicore/vfsl-codegen'` | codegen .test.ts（运行时+类型） | 包**自引用**（package.json `name` + `exports`）| 既有先例：`vfsl-protocol-empty-module.test.ts` 按名导入本包，绿 |
| `'../../vfsl/src/index.js'` | codegen .test.ts | 相对路径 + bundler 解析 `.js`→`.ts` | SA6 既有选型（既有先例） |
| `'vitest'` | 全部 | codegen devDep（兄弟包同版） | 兄弟包先例 |

---

## §8. 依赖与版本纪律（AC5）

| 项 | 裁决 |
|---|---|
| 新包 `@nomicore/vfsl-codegen` | **0.1.0** 起版（简报明令） |
| 新包运行时依赖 | 仅 `@nomicore/vfsl: workspace:*`（CLI 需 parse/evaluate/FileSchemaSource/assertVfslDialect）；发射器本身仅用 node 内建（`node:crypto`）——**零第三方运行时依赖** |
| 新包 devDependencies | `@nomicore/vfsl-protocol: workspace:*`（test-d 类型解析必需）+ **`@types/node: ^20`**（R2/SA2 #5：src 含 `node:crypto`/`node:fs`/`process` 的 node API——当前 typecheck 靠 vitest→vite d.ts 的 `/// <reference types="node" />` 传递链成立属**隐性依赖**（vitest/vite 升级或纯 src 编译即 TS2307）；显式声明消除之。兄弟包正确先例 = vfsl（唯一有 node API src 的包声明 `@types/node: ^20`，protocol 无 node API 才不声明））+ `typescript@^5.9.3` + `vitest@^3.2.4`（兄弟包同版对齐） |
| 根 devDependencies | **+`tsx@^4`**（CLI 执行载体，§5.2；esbuild 复用既有树，唯一实质新增包） |
| 既有包 `@nomicore/vfsl`（0.1.8）/ `@nomicore/vfsl-protocol`（0.1.0） | **零改动、零 bump**（本设计不触碰其任何文件——Hard Gate 9 无触发条件） |
| 根 `package.json`（nomicore 0.1.0, private） | scripts 三处增量（generate / typecheck / devDeps）+ tsx；**不 bump**（私有聚合根，非发布模块；版本纪律作用于 workspace 包） |
| `pnpm-lock.yaml` | 随 `pnpm install` 更新（tsx + 两条 workspace 链）——ALLOW LIST 收录 |

依赖最小化结论：全仓实质新增**一个**直接依赖（tsx），且其重依赖 esbuild 已在树内；新包自身零第三方依赖。

---

## §9. 转绿路径（四红灯文件逐文件）

### 9.1 逐文件落点

| 文件 | 红因 | 转绿落点 | 依赖 |
|---|---|---|---|
| `generate-mapping-table.test.ts` | `Cannot find package '@nomicore/vfsl-codegen'` | 包落地 + §3 v3 发射（含 R2 规则 0——**byId 值位正是 (union, ref) 配对，缺规则 0 则失配守卫 throw、永红**，SA2 #1）→ 全断言绿（SA6 正则修订已落地，R2 复核 L102/L107/L133 与 §9.2 逐字一致） | 无（异议 #1 已闭环） |
| `generate-discriminated-emission.test.ts` | 同上（module-not-found） | 包落地 + §3/§4 → 全 9 断言绿（已机器验证，§3.9） | 无 |
| `generate-discriminated-narrow.test-d.ts` | 现为**空转绿**（异议 #2） | §7 接线后变为真编译；**SA2 V3 已端到端模拟实证 6/6 真编译绿 + 既有两 test-d 零回归**（R2 采信为实证，非推测）。若真编译转红 → 上升 SA6 异议，SA3 **不得改断言** | §7 接线 |
| `generate-cli-check.test.ts` | `pnpm generate` 不存在（254） | 根 script + tsx + `src/cli.ts` + FileSchemaSource 消费链 → 三断言绿（退出码语义 §5.4；hermetic fixture 含一领域，不触 §5.5 阶段门） | §5 |

### 9.2 SA6 正则修订建议稿（异议 #1 处置；SA6 owned 文件，断言意图不变）

> **R2 状态：已落地**——SA6 修订与本节建议稿逐字一致（SA2 评审 §附注确认 + R2 `grep` 复核 L102/L107/L133）。本节保留作为处置记录。

```ts
// L102（tags）——原：/tags\s*:\s*PathSchema<Record<\$\{number\}[^,]*,\s*['"]array['"]\s*>/
expect(out).toMatch(/tags\s*:\s*PathSchema<Record<`\$\{number}`,\s*PathSchema<string,\s*'leaf'>\s*>,\s*'array'\s*>/);
// L107（items）——同形（items 替换 tags）
expect(out).toMatch(/items\s*:\s*PathSchema<Record<`\$\{number}`,\s*PathSchema<string,\s*'leaf'>\s*>,\s*'array'\s*>/);
// L133（entityList）——原：/entityList\s*:\s*PathSchema<Record<\$\{number\},/
expect(out).toMatch(/entityList\s*:\s*PathSchema<Record<`\$\{number}`,\s*PathSchema<Entity,\s*'map'>/);
```

修订原则：补回模板键反引号 + 按 §3.9 已验证的 v3 精确形状收紧（比原正则更强——原意图「array 载体 + 下标键 + 元素子表」全保留）。注意 tags/items 正则的 `'leaf'>\s*>` 对应「元素闭合 `>` + Record 闭合 `>`」两个括号（v3 紧排为 `>>`）。

#### 9.2.2 SA6 契约增补建议（R2 建议 A/B/C + R3 增补 D/E/F；**需总控路由 SA6 的契约变更**，非 SA1/SA3 可自行动）

**建议 A —— 钉死值侧 ref 优先规则的两个发射断言**（SA2 红线建议 1，针对攻击点 #1 的回归锚）：mapping fixture 增两个字段并各配一条断言：

```ts
// fixture 增：leafRef: Id;  metaRef: YMap<Meta>;（配 type Meta = YMap<{ m: YLeaf<number> }>;）
expect(out).toMatch(/leafRef\s*:\s*PathSchema<Id,\s*'leaf'>/);   // (leaf, ref) → 别名引用而非内联
expect(out).toMatch(/metaRef\s*:\s*PathSchema<Meta,\s*'map'>/);  // (已解析 map, ref) → 仍别名引用（规则 0 的核心位）
```

期望发射已实测推导（§10 行 10 探针同源）：`leafRef: PathSchema<Id, 'leaf'>`、`metaRef: PathSchema<Meta, 'map'>`。metaRef 位是规则 0 的**判别性用例**——结构侧已被求值器解析为 `{m: leaf}` 终形，字面按结构侧发射会内联 map，只有值侧优先规则产出别名引用。

**建议 B —— L115 负例正则顺手修**（SA2 观察 #7）：`/attachments\s*:\s*PathSchema<Record<\$\{number\}/` 缺反引号、对合法 TS 恒不命中（负例恒过、检测力为零；当前无害因孪生正例 L113 已覆盖 plain 语义）。顺手修订为 `/attachments\s*:\s*PathSchema<Record</`（无需模板键——负例只需「attachments 位出现 Record 载体即违终态禁令」）。

**建议 C —— 范围限界可断言性**（SA2 红线建议 2 的 b 案配套，可选）：emission 测试补一条——对联合 ROOT fixture（`type ROOT = | { a: YLeaf<string> } | { b: YLeaf<number> };`）断言 `generateProjection` 抛 `UnsupportedRootShapeError`（`expect(() => generateProjection(...)).toThrow(/ROOT 形态不支持/)`），把 §3.2.1 的范围限界从设计文本升为契约。

**建议 D —— ref→ROOT 响亮拒绝契约（R3，SA2 R2-1；(a) 案配套——总控定夺，需总控路由 SA6）**：hermetic fixture `type ROOT = YMap<{ a: YLeaf<string> }>; type Node = YMap<{ r: ROOT }>;` → 断言 `generateProjection` 抛命名化错误（消息前缀「ROOT 不可被引用」）+ CLI 层 exit 2/stderr：

```ts
expect(() => generateProjection(result.derived, { sourceText: FIXTURE }))
  .toThrow(/ROOT 不可被引用/);   // (a) 案：UnsupportedRootReferenceError（§3.4 R3 处置段消息模板）
// CLI 层（generate-cli-check.test.ts 同机制）：spawn `pnpm generate` → status 2 + stderr 含「ROOT 不可被引用」
```

前缀即 §3.4 R3 处置段消息模板的可断言锚（与建议 C 的 `/ROOT 形态不支持/`、建议 F 的 `/联合成员结构 kind 异形/` 同一标准）；fixture 取字段位代表位——其余五形态（别名链/数组元素/Record 值位/YMap 实参/直引）走同一错误路径（§10 行 12）。**路由注意（R3）**：SA6 前稿已按 (b) 裁决落了本建议断言（`R5/D` 测试块——断言 `export type ROOT` 在场 + 引用位按名引用），须随总控 (a) 裁决**整块翻转**为上述 toThrow 断言；SA3 侧需新增拦截补丁（§3.4「实现与测试现状对齐」注记）——断言随裁决成形，禁止无锚状态。

**建议 E —— optional 剥壳契约（R3，SA2 R2-2，需总控路由 SA6）**：hermetic fixture `type ROOT = YMap<{ title?: YLeaf<string>; meta?: Meta }>; type Meta = YMap<{ m: YLeaf<number> }>;` → 断言：

```ts
expect(() => generateProjection(...)).not.toThrow();              // 无假 desync（规则 1 剥壳）
expect(out).toMatch(/title\?:\s*PathSchema<string,\s*'leaf'>/);   // 键后单 ?，接口成员位（§3.5）
expect(out).not.toMatch(/title\?\?/);                             // 禁双 ?（双侧各判一次的病征）
expect(out).toMatch(/meta\?:\s*PathSchema<Meta,\s*'map'>/);       // 规则 0 穿透 optional 包装命中 ref
```

**建议 F —— 联合 kind 同形裁决契约（R3，SA2 R2-3，需总控路由 SA6）**：同形 fixture `type ROOT = YMap<{ u: YArray<YLeaf<string>> | YArray<YLeaf<number>> }>;` → 断言联合 kind = `'array'`（成员结构 kind 全员 array，非默认 `'map'`）：

```ts
expect(out).toMatch(/u\s*:\s*PathSchema<Record<`\$\{number}`,\s*PathSchema<string,\s*'leaf'>\s*>\s*\|\s*Record<`\$\{number}`,\s*PathSchema<number,\s*'leaf'>\s*>,\s*'array'>/);
```

（形状依 §3.2 union 行 + array 行推导：成员 = 去外壳的 `Record<`${number}`, …>`；SA6 落地时可按实际紧排微调空白——断言锚是尾参 `'array'` 而非 `'map'`。）异形联合 fixture（`type A = YMap<{ x: YLeaf<string> }>; type B = YArray<YLeaf<number>>; type ROOT = YMap<{ u: A | B }>;`）→ `expect(() => generateProjection(...)).toThrow(/联合成员结构 kind 异形/)`（`UnsupportedUnionKindError`，§3.2 union 行 R3）。

### 9.3 落地顺序（总控调度参考；R2 更新）

1. ~~总控/SA6 裁决异议 #1 → SA6 修订 3 正则~~ **已完成**（R2 复核）；若总控采纳 §9.2.2 建议 A/B/C（R2）与 D/E/F（R3）→ 路由 SA6 增补（契约变更，须在 SA3 实现前或同步落地——红灯契约晚于 SA3 落地则锚定失效）；
2. SA3 按 §2/§3（含规则 0 与 §3.2.1）/§4/§5（含 §5.5 阶段门与步骤 7 错误映射）落包 + §5.1 根脚本 + §7 接线 + §6 CI 步骤（带 `--allow-empty-domains`）+ `pnpm install`（tsx + @types/node + workspace 链入 lockfile）；
3. `pnpm test`（含 --typecheck）全绿 + `pnpm typecheck` 三包绿 + `pnpm generate --check --allow-empty-domains` exit 0（F2 阶段态）；
4. SA4 静态评审（§12 ALLOW/DENY 比对 + §10/§11 抽查 + SA2 红线建议 5：`tsc --noEmit` 仅 src 的 program 编译通过验 @types/node 显式化）→ SA7 动态验证（含 §9.4 watch-items）。

### 9.4 SA7 动态验证 watch-items（R2 登记）

1. **CLI 启动耗时**（SA2 #8b）：`generate-cli-check.test.ts` 每 it 串行 spawn 2 次 `pnpm`+tsx，vitest 默认 5s/it 超时——慢 CI 上有余量风险。SA7 实测单次 `pnpm generate` 耗时；若逼近超时，处置方向 = CI runner 性能/`testTimeout` 配置（**属测试基础设施，SA3 可调；不得改断言**），而非给 CLI 加缓存（破坏「每次现扫恒新鲜」语义）。
2. **`--allow-empty-domains` 阶段门实测**：零领域集下无 flag → exit 2（stderr 两成因说明）；带 flag → exit 0（§5.5）；G 落地后移除 flag 的回归（届时属 G 票验收）。
3. **idBase 约定诊断消息**：`@id` 与目录名背离的 hermetic fixture → exit 2 + stderr 含规则本体（SA2 红线建议 3）。
4. **ROOT 范围限界**：Record/联合 ROOT fixture → exit 2 + `UnsupportedRootShapeError` 消息（§3.2.1；若总控采纳建议 C，此项已有契约断言兜底）。
5. **ref→ROOT 拦截（R3，SA2 R2-1）**：字段位 fixture（`type Node = YMap<{ r: ROOT }>`）→ exit 2 + `UnsupportedRootReferenceError` 消息前缀「ROOT 不可被引用」（§3.4 R3 处置段；若总控路由建议 D，此项已有契约断言兜底——SA3 拦截补丁落地后验）。

---

## §10. 协议假设依据 (Protocol Assumption Evidence)

| # | 假设 | 依据类型 | 依据内容（设计期实测命令 + 结果） | 风险 |
|---|---|---|---|---|
| 1 | vitest typecheck 仅对 tsconfig 项目内文件真实编译并归因错误 | 设计期实测 | 探针：故意类型错误 `expectTypeOf<number>().toEqualTypeOf<string>()`——置于 `packages/vfsl-protocol/test/` → `1 failed`；置于 `packages/vfsl-codegen/test/` → `1 passed, Type Errors no errors`（空转绿实锤） | 低（直接决定 §7） |
| 2 | 独立 tsc 下 codegen test-d 的 `'@nomicore/vfsl-protocol'` 导入无链接不可解析 | 设计期实测 | `tsc --noEmit … packages/vfsl-codegen/test/generate-discriminated-narrow.test-d.ts` → TS2307 ×7 + TS2664 | 低（devDep workspace 链解之） |
| 3 | tsx 可执行「`.js` 后缀 TS 相对导入 + 仓内 vfsl TS 源」 | 设计期实测 | `pnpm dlx tsx /tmp/probe-tsx/a.ts`（`import './b.js'`→b.ts；绝对路径导入 vfsl `src/index.js`）→ 输出 `helper: helper-ok \| parseVfsl: function \| evaluate ok: true \| FileSchemaSource: function \| assertVfslDialect: function`，exit 0 | 低 |
| 4 | pnpm 对 `workspace:*` 依赖在依赖方包内建 node_modules 软链，且 tsx 经软链+exports 解析 TS 入口 | 设计期实测 | /tmp 微型 workspace 实测：`packages/b/node_modules/@t/a -> ../../../a`（symlink）；`tsx run.ts` 导入 b（b 导入 @t/a）→ `tsx+workspace: a-ok-b` | 低 |
| 5 | pnpm 将脚本名后参数转发给脚本本体 | 设计期实测 | `pnpm test __no_such_filter__ --passWithNoTests=false` → 参数到达 vitest（无匹配文件报错），`ELIFECYCLE Test failed` | 低 |
| 6 | pnpm 向调用方传播脚本退出码（非零上浮） | 设计期实测 + 既有测试证据 | 干净探针 `pnpm test … >/dev/null 2>&1; echo $?` → `exit=1`；SA6 红证据：缺失脚本时 spawnSync 测得 `pnpm generate` status=254 | 低 |
| 7 | 根 vitest typecheck 换根 tsconfig 后，多文件 `declare module` 增广合并不破坏既有 test-d | 源码引用 | `packages/vfsl-protocol/test/vfsl-protocol-empty-fail-closed.test-d.ts` L8-12 文件头注释：已显式认知「同一 typecheck program 内增广泄漏」，改用本地 `LocalEmptyMap` 免疫；projection test-d 断言均为键路径特异 | 低 |
| 8 | tsx 在 node 20 可用（CI matrix 下界） | 官方文档 | tsx v4 engines 要求 node ≥18（`pnpm dlx tsx --version` 实测 v4.23.12 运行于 node v24.13.0）；CI matrix node 20 > 18 | 低（SA3 落地后 CI matrix 即端到端验证） |
| 9 | 发射格式 v3 满足全部可满足断言 | 设计期实测 | `/tmp/probe3.mjs`：正则从测试文件逐字节提取 → v3 样例对 mapping 11 正则中 8 条 + 辅助断言全过、emission 9 正则全过 PASS；3 FAIL 均为异议 #1 坏正则（结构不可满足证明见 §1.2） | 低（SA3 验收基准） |
| 10 | **两树不对称：五类合法 (结构已解析, 值 ref) 配对真实存在**（R2，SA2 #1 复现） | 设计期实测 + 源码引用 | tsx 探针对真实 `evaluate` dump：① `byId: Record<Id, Entity>` 值位（结构=`union`〔Entity 已解析〕，值=`ref Entity`）——mapping fixture 自带位；② `leafRef: Id`（leaf, ref）；③ `Ent[]`/`YArray<Ent>` 元素位（leaf, ref）；④ `metaRef: YMap<Meta>`（结构=**已解析 map** `{m:leaf}`，值=`ref Meta`——判别性用例）；⑤ `p: Plain`（plain, ref）。佐证：`evaluate.ts` 文件头 L15-16 明文两树不对称 | 低（规则 0 直接依据） |
| 11 | **ROOT 形态结构形状**（R2，SA2 #2 复现） | 设计期实测 | tsx 探针：联合 ROOT（`type ROOT = \| { a: YLeaf<string> } \| { b: YLeaf<number> };`）parse+evaluate ok，structure = `root → union`；Record ROOT（`type ROOT = Record<Id, E>;`）structure = `root → map` 恰一 `'<key>'` 字段。两种合法形态均无「封闭 map 字段 → 接口成员」路径 → §3.2.1 范围限界的输入面实证 | 低 |
| 12 | **ref→ROOT 六形态合法触发面**（R3，SA2 R2-1） | SA2 R2 评审实测（评审 §C 探针 `reftoroot.mjs`/`rootref-map.mjs`）+ 源码引用（ADR 0003 §2） | 六种 ref-to-ROOT 形态（字段位/别名链/数组元素/Record 值位/YMap 实参/直引）parse+evaluate 全 OK、值树全部含 `ref:ROOT`（Record 值位/YMap 实参为纯规则 0 位）；第七形态 = **联合成员位（独立别名内）** `type U = A | ROOT` → `values.U.<member 1>=ref:ROOT`（SA2 R3-1 枚举补遗，总控勘误；ROOT 字段内联 `A|ROOT` 与直自引被 E106 拒，独立别名内合法）；YPlainArray 实参被 E307 拒——(a) 案 loud 拒绝的输入面全谱依据；(a) 裁决下 `export type ROOT` 声明形永不出现，负例正则 `/^\s*['\"]?ROOT['\"]?\s*:/m` 恒不命中（正则安全不再是论证负担） | 低（§3.4 R3 处置段直接依据） |

---

## §11. 契约改动连锁审计 (Contract Change Caller Audit)

**无契约改动**：本设计仅涉及【新增包 / 新增根 scripts / 新增 CI 步骤 / 新增根 tsconfig / 重指 vitest typecheck tsconfig】，不修改任何既有函数的签名、返回类型、throw 路径或错误语义；`packages/vfsl` 与 `packages/vfsl-protocol` 零文件改动。

- `generateProjection` 为**新建**函数（无既有 caller）；唯一消费方 = 新测试 + 新 CLI（本设计内定义）。
- 根 `package.json` scripts 变更属**纯增量**（`generate` 为新键；`typecheck` 追加一段 tsc 调用——其 caller 为人类/CI，追加不改变既有两包检查行为）。
- 根 `vitest.config.ts` `typecheck.tsconfig` 重指：影响面 = typecheck 编译范围（从 vfsl-protocol 单包扩为全包）——§7.3 已审计既有 test-d 共存安全（LocalEmptyMap 免疫 + 键路径特异断言）；runtime include 不变。
- `--check` 退出码非零路径是**新 CLI 的自身契约**（AC4 要求），无既有 caller。

---

## §12. 文件清单（File Scope）

### ALLOW LIST

> R2 注记：本轮修订全部落在既有 ALLOW 项内（§3.2.1/§4/§5 修订 → emitter.ts/header.ts/cli.ts/collect.ts；§5.5/§6 → ci.yml；§2/§8 → package.json；§9.2.2 → 既有 SA6 测试文件条目）——与 SA2 评审「§12 完备性」结论一致，**无需扩容**。清单只增不删纪律下无新增项。

> R3 注记（SA2 R2 verdict: reject → 七项手术式修订）：全部落点仍在既有 ALLOW 项内——§3.2 规则 0/规则 1/union 行/root 行、§3.4 R3 处置段与论据改述、§3.6 标注 → `emitter.ts`/`valuetype.ts`；§4 守卫扩界 → `header.ts`；§5.3/§5.4 错误映射与 G 注记 → `cli.ts`/`collect.ts`；§9.2.2 建议 D/E/F → 既有 `[SA6 owned]` 测试文件条目——**无需扩容**（清单只增不删纪律下无新增项）。

- `packages/vfsl-codegen/package.json` — 新建，包定义（§2：name/version/exports/deps + @types/node）
- `packages/vfsl-codegen/tsconfig.json` — 新建，包编译单元（extends base + include src/test）
- `packages/vfsl-codegen/src/index.ts` — 新建，公共导出面（generateProjection）
- `packages/vfsl-codegen/src/emitter.ts` — 新建，§3 并行走查发射器（约 200 行）
- `packages/vfsl-codegen/src/valuetype.ts` — 新建，§3.6 纯值投影（约 80 行）
- `packages/vfsl-codegen/src/docs.ts` — 新建，§3.7 三槽 docs → TSDoc（约 90 行）
- `packages/vfsl-codegen/src/header.ts` — 新建，§4 头注 + sha256（约 30 行）
- `packages/vfsl-codegen/src/collect.ts` — 新建，§5.3 CLI 编排纯函数（约 80 行）
- `packages/vfsl-codegen/src/cli.ts` — 新建，§5 参数解析/写盘/diff/退出码（约 90 行）
- `packages/vfsl-codegen/test/generate-mapping-table.test.ts` — `[SA6 owned]` 验收红灯测试；异议 #1 的 3 正则修订仅由 SA6 执行（§9.2），SA3 不改断言
- `packages/vfsl-codegen/test/generate-discriminated-emission.test.ts` — `[SA6 owned]` 验收红灯测试，任何 SA 不改
- `packages/vfsl-codegen/test/generate-discriminated-narrow.test-d.ts` — `[SA6 owned]` 验收 type-d 测试，任何 SA 不改
- `packages/vfsl-codegen/test/generate-cli-check.test.ts` — `[SA6 owned]` 验收 CLI 测试，任何 SA 不改
- `package.json`（根） — 修改，三处增量：+`generate` script（§5.1）、`typecheck` 追加 codegen（§7.2）、devDeps +`tsx`（§5.2）
- `pnpm-lock.yaml` — 修改，`pnpm install` 副产物（tsx + 2 workspace 链）
- `vitest.config.ts` — 修改，`typecheck.tsconfig` 重指 `./tsconfig.typecheck.json`（§7.2，1 行）
- `tsconfig.typecheck.json` — 新建，根 typecheck 项目（§7.2，4 行）
- `.github/workflows/ci.yml` — 修改，追加 regen-diff 步骤（§6，约 8 行含注释）
- `wiki/raw/task_vfsl-codegen_design.md` — 本设计文档

### DENY LIST

- `packages/vfsl/src/**` — 既有包生产代码，本任务零改动（无 bump 依据，§8）
- `packages/vfsl-protocol/src/**` — 同上
- `packages/vfsl/test/**`、`packages/vfsl-protocol/test/**` — 既有包测试，不动（含 empty-fail-closed 的 LocalEmptyMap 机制）
- `packages/vfsl/package.json`、`packages/vfsl-protocol/package.json` — 版本与导出面冻结（0.1.8 / 0.1.0 不 bump）
- `domains/**` — G 票 #27 职责；F2 明令不种首个领域（§5.6）
- `docs/adr/**` — ADR 冻结文本
- `pnpm-workspace.yaml` — `packages/*` glob 已覆盖新包，无需改动
- `tsconfig.base.json` — 编译选项基线不动
- `TASK.md`、`.mabf-bg/**` — 调度器工作区文件（不入分支 commit）

---

## SA2 反馈逐条回应（R2 修订汇总）

评审报告：`wiki/raw/task_vfsl-codegen_sa2_review.md`（verdict: reject，根因 = 攻击点 #1）。修订原则：宏观决策（v3 格式/§7 接线/tsx/依赖框架）经 SA2 复验成立不动；全部必修项逐条落实，伪代码/流程/表格实质修改而非加注承认。

| # | 严重度 | SA2 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|---|---|---|---|---|---|
| 1 | CRITICAL | §3.2 增补值侧 ref 优先规则 + 失配守卫仅限两侧均非 ref + 表加 (X, ref) 行 | ✅ | §3.2 规则 0 + 配对表新增行 + 守卫段重写；§3.4/§1.1/§3.9 联动 | emitNode 首查值侧：`value.kind === 'ref'` → 一律 `PathSchema<别名名, kindOf(别名名)>`（结构侧 ref 终态或已解析终形两形同义不属失配；kindOf 沿别名链解析+环守卫）；守卫改为仅两侧均非 ref 的非法组合 throw；§3.9 补「算法-样例桥接」——byId 值位 (union, ref) 经规则 0 产出样例文本逐字一致，样例不再是悬空断言；§10 行 10 以 tsx 探针实测五类配对（含 metaRef 判别性用例：结构侧已解析 map、值侧仍 ref） |
| 2 | HIGH | 联合 ROOT 处置二选一明文写入，不允许未提及 | ✅（b 案，且对 Record 形同样限界并给超出 SA2 建议范围的论证） | 新增 §3.2.1 | ROOT 四种合法形态（ADR 0003 §2）逐形态处置表：裸对象/YMap 支持；Record 形与全 map 形联合 → 命名化 `UnsupportedRootShapeError`（CLI → exit 2）+ 登记后续票。**对 Record 形偏离 SA2 (b) 案字面（SA2 列其为支持面）的显式论证**：索引签名与多域增广合并冲突（TS 全成员须满足索引签名）+ 字面 `'<key>'` 成员只解析字面路径段 = 虚假降级；联合形则丢失 D2 read 宽度（顶层是接口非 union 节点，`PathValue` 补 undefined 机制不可达）——两种形态均需协议层扩展，F2 响亮拒绝。§10 行 11 实测两种形态的 structure 形状；§5.3 加 G 票 ROOT 形态交接注记 |
| 3 | MEDIUM | idBase 约定改标「F2 施加」；诊断消息写明规则本体；G 票交接注记 | ✅ | §5.3「F2 施加的约定」段 + 诊断消息模板 + G 票交接注记 | 删除「依托 F1 脚手架约定」错误归属（F1 一级 = @id 权威、目录名仅诊断回退且容忍背离）；明文「接缝限制下 F2 的自设不变式」；exit 2 消息含规则本体全文；交接注记写明 ADR 0005 §2 示例 `vfs3.assets@1`（点号）vs G 目录 `vfs3-assets`（连字符）已知冲突由 G 定夺一侧 |
| 4 | MEDIUM | 空领域集阶段门（--allow-empty-domains）或明文接受盲区 | ✅（采纳阶段门，明文拒绝「接受盲区」备选） | §5.4 表新增行 + §5.5 重写 + §6 CI flag | `generate`/`--check` 零领域集：无 flag → exit 2（消息覆盖两成因：G 未落地 vs 路径打错——F1 将 ENOENT 设计为合法空集、接缝层不可区分，引 `schemasource.ts` L294-305）；带 flag → 0；CI 步骤带 flag + TODO(#27)（G 落地移除，届时零集复为响亮失败）；SA6 hermetic fixture 含一领域不受影响 |
| 5 | MEDIUM | devDependencies 增补 @types/node ^20 | ✅ | §2 包定义注释 + §8 表 | 与 vfsl（唯一有 node API src 的兄弟包）同版对齐；§8 记录隐性依赖链（vitest→vite d.ts `/// <reference types="node" />` 传递）及消除理由；§9.3 步骤 4 给 SA4 的行为断言锚（纯 src program tsc 通过） |
| 6 | MINOR | cli.ts 顶层捕获 SchemaSourceError → 结构化 stderr + exit 2 | ✅ | §5.3 步骤 7 + §5.4 表硬错误行 | 顶层 catch 覆盖 SchemaSourceError（list/load/方言断言）与 ENOTDIR/EACCES 冒泡错误 → code+message+上下文进 stderr + exit 2；§5.4 表明示「不捕获则实际退 1 违背承诺」的兑现路径 |
| 7 | MINOR（观察，SA6 侧） | L115 负例正则同缺反引号，转 SA6 知悉 | ✅（转入 SA6 建议） | §1.2 R2 状态更新 + §9.2.2 建议B | 负例恒过、检测力为零的定性 + 顺手修订稿（`/attachments\s*:\s*PathSchema<Record</`，无需模板键）；设计本身无需改动 |
| 8 | MINOR | (a) 版本 bump 同步 GENERATOR_VERSION checklist；(b) CLI 启动精简 + SA7 watch-item | ✅（(a) 以更强方案落实） | §4「运行时自同步」段 + §5.2 启动精简注 + §9.4 watch-item 1 | (a) 超越 checklist 的结构性解：header.ts 惰性读取本包 package.json version（import.meta.url 相对解析，失败 loud throw）——bump 后头注自动变、regen-diff 自动报警，消除手工同步失败模式；保留纪律项「不得回退硬编码常量」；(b) 模块级零重活/参数解析先行/不叠加启动期 I/O 的实现要求 + SA7 watch-item（5s/it 串行双 spawn 风险与处置边界：可调 testTimeout 基础设施、不得改断言、不得加缓存破坏现扫语义） |
| 红线建议 | SA6 侧 | 补 leafRef/metaRef 发射断言 fixture 钉死规则 0（SA1 定夺是否纳入 SA6 契约增补建议） | ✅（采纳为建议） | §9.2.2 建议A/B/C | 采纳并扩展为三条：A=leafRef/metaRef 断言（期望发射经 §10 行 10 探针实测推导，metaRef 为规则 0 判别性用例）；B=L115 负例顺手修；C=联合 ROOT 范围限界的 toThrow 断言（可选）。全部显式标注「需总控路由 SA6 的契约变更」，非 SA1/SA3 可自行动 |

**一致性自检（修订后全文扫描）**：规则 0 的引用一致性——§1.1（ref 行）、§3.2（规则 0 + 表行 + 守卫）、§3.4（权威判定依据）、§3.9（桥接说明）、§9.1（byId 转绿落点）、§9.2.2（建议A）、§10 行 10 全部指向同一定义；「同形并行走查」旧措辞已全文清除（§3.2 引言重写为不对称前提）；§5.5 阶段门与 §5.4 表、§6 CI flag、§9.3 步骤 3 四处口径一致（均 `--allow-empty-domains`）；§3.2.1 范围限界与 §5.3 流程步骤 4（UnsupportedRootShapeError 捕获）、§5.4 硬错误行、§9.4 watch-item 4 口径一致；ALLOW LIST 无扩容与 SA2 §12 评审结论一致。

## SA2 反馈逐条回应（R3 修订汇总）

评审报告：`wiki/raw/task_vfsl-codegen_sa2_review.md`（R2 最终 verdict: reject，根因 = R2-1/R2-2「合法输入 × 骨架无路径 × 红灯零覆盖」两增量缺口 + R2-3 设计级一行处置 + R2-4/R2-5/观察 1-2）。修订原则：SA2 已复验成立的全部宏观决策（格式 v3 / §7 接线 / tsx 载体 / 阶段门 / 版本自同步 / 规则 0 本体 / §3.2.1 限界）零改动；七个必修项逐条落实，规则/表格/守卫实质修改而非加注承认。**R2-1 裁决由总控定夺为 (a) 命名化 loud 拒绝**（本表 R2-1 行与全文据此定形——前稿曾采 (b) 按需具名发射，本轮纠正；建议 D 断言随裁决翻转、SA3 拦截补丁随裁决路由）。

| # | 严重度 | SA2 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|---|---|---|---|---|---|
| R2-1 | HIGH | ref 目标为 ROOT 二选一明文（(a) loud throw / (b) 按需具名发射 + D5 关系论证），不允许未提及 | ✅（裁决 = (a) 命名化 loud 拒绝——总控定夺，纠正前稿 (b)） | §3.4 R3 处置段（主落点）+ §3.2 规则 0 补行 + §3.2 root 行 + §1.1 D5 决策行精化 + §5.3 步骤 4/§5.4 硬错误行 + §9.2.2 建议 D + §10 行 12 + §9.4 watch-item 5 | 六形态全谱列明（含 Record 值位/YMap 实参两个纯规则 0 位；YPlainArray E307 不触发）；引用链（值侧 ref 目标 / kindOf 链 / 段② 走查）任一抵达 ROOT → `UnsupportedRootReferenceError`（消息前缀「ROOT 不可被引用」）→ CLI 顶层 catch → exit 2 + 登记后续票，与 §3.2.1 同构；理由 = 与 Record/联合 ROOT 限界同一诚实策略——协议层扩展前响亮拒绝优于静默破碎或破例具名 ROOT（保 D5「顶层键=ROOT 字段」单一载体语义）；**路由后果**：SA3（008e34c）现为「ROOT 除外」跳过未拦截（新增拦截补丁）+ SA6 前稿 R5/D 测试块须由 (b) 断言翻转为 toThrow |
| R2-2 | MEDIUM | optional 剥壳骨架规则 + 「永不遇 optional kind」声明 | ✅ | §3.2 新增规则 1 + 失配守卫段补声明 + §9.2.2 建议 E | 字段成员位先行剥壳（emitNode 恒收剥壳后值）；可选性以键后 `?` 表达，权威源 = MapField.optional（与值侧同源 IR f.optional 恒同步，禁双侧各判一次 = 双 `?`）；冻结契约限定 optional 仅字段位 → 剥壳即全覆盖；规则 0 首查与配对表值 kind 列永不遇 'optional'（非守卫输入、非表行）——消除 (leaf,opt) 假 desync 与 (ref,opt(ref)) 未定义行为 |
| R2-3 | MEDIUM-LOW | union 行同形裁决 + kindOf 同步 + 禁止默认 'map' | ✅ | §3.2 union 行（含消息模板）+ 规则 0 kindOf 映射 + §3.4 kindOf 映射 + §5.3 步骤 4 + §5.4 硬错误行 + §9.2.2 建议 F | 成员结构 kind 全员同形 → 发射该 kind；异形 → `UnsupportedUnionKindError`（命名化 loud，CLI exit 2 + 登记后续票）；union 行成员发射泛化（各成员按配对表行独立走查，不预设恒 map）；三处 kindOf 映射 + CLI 两处错误映射口径同步。**SA3 实现已按此落地（总控勘误，SA2 R3 复审路由 1②）**：inline/段② 路径随 commit 008e34c 落地（emitter.ts `UnsupportedUnionKindError` + unionKind 同形裁决）；**kindOf 引用位路径当时未落地**（kindOfAlias 终点把 union 无条件映射 `'map'`，SA2 R3-3 探针实锤误标）——随 SA3 R2 返修（commit 9cd33d2）补齐，本文对齐；SA6 契约断言已落（R5/F：同形 `'array'` + 异形 toThrow；R6 增补按名引用位锚点 `/u\s*:\s*PathSchema<U,\s*'array'>/`）；消息尾与观察 2 统一为「由总控开后续票登记」（随 9cd33d2 同步） |
| R2-4 | MINOR | 论据 (a) 改述 + 两处环守卫标注纵深防御 | ✅ | §3.4 论据 (a) 改述 + §3.2 规则 0 环守卫 + §3.6 ValueContextCycleError | (a) 改述为「E106 已保证别名图无环（七形态实测全拒），自引用属正常输入不可达；必要性来自 (b)(c) 与 (X,ref) 配对」；kindOf 环守卫与 ValueContextCycleError 均标「纵深防御，正常输入不可达（兜未来方言演进）」 |
| R2-5 | MINOR | version 须为非空 string 守卫 | ✅ | §4 版本自同步段 | 守卫扩界：读/解析失败或 version 缺失/非串/空串（`typeof version === 'string' && version !== ''`）→ 同一命名化 loud throw（否则 `@undefined` 对版本说谎且 regen-diff 不报警——本守卫要消除的失败模式残余） |
| 观察 1 | LOW（G 交接） | 多域 VfslPathMap 接口成员同名键 TS2717 交接 G | ✅ | §5.3 G 票交接注记 | 增行：两域同名顶层键不同类型 → TS2717（D5 单接口载体机制使然，非 F2 可修）；G 落地多域时须定夺顶层键命名规约或协议层扩展 |
| 观察 2 | LOW | Record/联合/被引用 ROOT 协议层扩展登记路径明文 + `<后续票>` 占位符落为该说明 | ✅ | §5.3 G 票交接注记 + §3.2.1/§3.2 union 行/§3.4 R3 处置段三处消息模板 | 增行：Record/联合/**被引用** ROOT（(a) 案新增第三族）与异形联合的协议层扩展**由总控开后续票登记**（收尾开 GitHub follow-up issue 承接；gh issue list 已核对无实票，#27 是 G dogfood）；三处错误消息模板的 `<后续票>` 占位符**已落为「由总控开后续票登记」**（票号存在后替换为 #N；SA3 已实现消息尾「见后续票」待路由同步） |
| 建议 D | SA6 侧 | ref→ROOT 红线断言（评审 D 节 1；断言随 R2-1 裁决成形） | ✅（采纳为建议；(a) 案配套） | §9.2.2 建议D | fixture `Node = YMap<{ r: ROOT }>` → `toThrow(/ROOT 不可被引用/)` + CLI exit 2/stderr 断言；**需总控路由 SA6**——前稿 R5/D 测试块按 (b) 落地，须整块翻转 |
| 建议 E | SA6 侧 | optional 剥壳红线断言（评审 D 节 2） | ✅（采纳为建议；已落地 R5/E） | §9.2.2 建议E | fixture `title?: YLeaf<string>; meta?: Meta` → 不抛（无假 desync）+ 键后单 `?` + 规则 0 穿透 optional 命中 ref；需总控路由 SA6 |
| 建议 F | SA6 侧 | 联合 kind 同形裁决红线断言（评审 D 节 3） | ✅（采纳为建议；已落地 R5/F） | §9.2.2 建议F | 同形 fixture → 尾参 `'array'`（禁默认 'map'）；异形 fixture → `toThrow(/联合成员结构 kind 异形/)`；需总控路由 SA6 |

**一致性自检（R3 修订后全文扫描）**：ROOT 处置单一权威定义 = §3.4 R3 处置段（(a) 案）——§1.1（D5 决策行精化）、§3.2（规则 0 补行 + root 行）、§5.3 步骤 4、§5.4 硬错误行、§9.4 watch-item 5、§9.2.2（建议 D）、§10（行 12）七处引用均指向它，「按需具名发射/(b)」措辞已全文清除（§3.4 首条恢复「ROOT 除外——ROOT 不可被引用」并升级为可断言拦截）；optional 剥壳单一权威 = §3.2 规则 1——规则 0/配对表/失配守卫/§3.5（键后 `?`）/建议 E 口径一致（MapField.optional 唯一权威源，无双 `?` 路径）；联合 kind 裁决三处 kindOf 映射（§3.2 规则 0、§3.2 union 行、§3.4）+ §5.3 步骤 4 + §5.4 硬错误行 + 建议 F 口径一致（异形 → UnsupportedUnionKindError，无残留 union→'map' 无条件映射；SA3 落地对齐——inline/段② 路径随 008e34c、kindOf 引用位路径随 R2 返修 9cd33d2〔总控勘误，SA2 R3 复审路由 1②〕）；「纵深防御（正常输入不可达）」两处标注（规则 0 环守卫、§3.6）与 §3.4 论据 (a) 改述互证；`<后续票>` 占位符三处（§3.2.1 消息、§3.2 union 行消息、§3.4 R2-1 消息）均落为「由总控开后续票登记」，由 §5.3 G 注记的登记路径（总控收尾开 GitHub follow-up issue）承接；建议 D/E/F 均标注「需总控路由 SA6」（D 已按 (a) 裁决改写，SA6 前稿 R5/D 测试块须翻转）；ALLOW LIST 无扩容（全部落既有项，SA6 测试文件仍 `[SA6 owned]`）。

> **R3 修订已完成**（SA2 R2 verdict: reject → 七项手术式修订 + 建议 D/E/F 全落实；R2-1 裁决 = (a) 命名化 loud 拒绝〔总控定夺，纠正前稿 (b)——SA3 拦截补丁与 SA6 建议 D 翻转待总控路由〕；逐项落点见上「SA2 反馈逐条回应（R3 修订汇总）」表）
