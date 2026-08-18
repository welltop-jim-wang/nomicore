# 设计文档 — [PRD] VFSL v1 方言 Parser

- **Worktree**: `/home/wangjian/nomicore-refactor-prd-vfsl-v1--parser`
- **Branch**: `refactor/prd-vfsl-v1--parser`
- **任务类型**: 功能开发 (Feature) — greenfield `@nomicore/vfsl` parser
- **Slug**: `prd-vfsl-v1-parser`
- **Issue**: #3
- **设计者**: SA1
- **版本**: R2（SA2 破壁 verdict=needs-redesign 后修订；R1 原文就地保留以可审计，R2 改动以「R2 修订」标注）
- **红灯基线**: SA6 已落 4 套件（`packages/vfsl/test/parse-vfsl.{happy-path,forbidden,cycle-detection,jsdoc}.test.ts`），全因 `@nomicore/vfsl` 公共接缝缺失而 fail。本设计的目标是让 SA3 据此实现使红灯变绿。
- **R2 修订摘要**: 闭合 SA2 全部 10 个攻击点。CRITICAL 攻击点 1（green-bar 编排）以**经验证**的路径 A（根 `package.json` + `scripts/test-lock.sh` 前置 `pnpm --filter @nomicore/vfsl run build`）替换 R1 死代码建议，验证证据见 §16。攻击点 2–5 闭合 §4.2/§9/§2.5 的契约缝隙；攻击点 6–9 增强错误模型与健壮性；攻击点 10 记录已知限制。逐条回应见 §18。

---

## §0. 设计目标与不可改契约

为 `@nomicore/vfsl` 设计 parser 完整实现方案。输入一段按 v1 方言冻结子集书写的 VFSL 文本，输出**可序列化、可哈希的 IR**，或**精确到行列的结构化错误**。

### 0.1 公共测试接缝（契约，SA3 不得改）

```
parseVfsl(text: string)
  → { ok: true;  module: ModuleIR }
  | { ok: false; issues: Issue[] }

interface Issue {
  message: string   // 非空
  line: number      // 1-indexed，落在源文本行内 [1, lineCount]
  column: number    // 1-indexed，落在该行内 [1, lineText.length + 1]
}
```

- 函数名 `parseVfsl`、参数 `text: string`、返回判别联合的形状——**冻结**。
- `module`（`ModuleIR`）与 `Issue` 的字段名（`message`/`line`/`column`）——**冻结**。
- `ModuleIR` 的内部形状不构成公共契约（SA6 测试用形状无关 helper 观察），但本设计给出推荐形状，SA3 可微调键名，**前提是红灯测试全部转绿且不破坏 §0.1 判别联合与 Issue 三字段**。
- 包 `packages/vfsl/package.json` 的 `exports`/`main`/`types` 指向 `dist`——**冻结**（SA6 已定）。SA3 须 `tsc` 产出 `dist` 使 `@nomicore/vfsl` 可被测试 import（见 §13）。

### 0.2 非功能硬约束

| 约束 | 说明 |
|---|---|
| 零运行时依赖 | `src/` 不得 import yjs / 网络 / 存储 / node:crypto。仅用 TypeScript 标准库。哈希能力由「IR 是纯 JSON 数据」天然满足（见 §5.3），不引入 crypto。 |
| 纯函数 | `parseVfsl` 无副作用、确定性：同一输入两次解析结果 `toEqual`（红灯已锚定）。不得读环境变量、不得读文件、不得用 `Date.now()`/`Math.random()`。 |
| 可序列化 | `JSON.parse(JSON.stringify(module))` 深等于 `module`（红灯已锚定）。→ IR **不得出现** `undefined` / 函数 / `Symbol` / `Map` / `Date`。可选语义用 `boolean` 表达，缺文档用 `null` 表达。 |
| 可哈希 | IR 是纯 JSON 树 → 可经规范序列化（稳定 key 序）后 SHA。本任务不产出哈希字段（编译缓存 out of scope），仅保证「可哈希性」。 |

---

## §1. 架构总览（四阶段流水线）

```
parseVfsl(text)
  │
  ├─ 1. Tokenize   text → Token[]（含 DocComment token；// 与 /* */ 丢弃但记录位置）
  │                   收集词法 issue（未闭合块注释、未终止字符串）
  │
  ├─ 2. Parse      Token[] → AST（类型别名表 + 类型表达式树）
  │                   递归下降；v1 子集外构造 → 结构化 issue（禁止清单）
  │                   DocComment token 挂载到相邻 alias/field 节点
  │
  ├─ 3. Semantic   AST → alias 引用图 → 环检测（DFS 三色）+ 未知引用检查
  │                   成环或引用未声明别名 → 结构化 issue
  │
  └─ 4. Build IR   AST → ModuleIR（纯 JSON 数据，doc 原文已挂载）
  │
  └─ issues.length === 0 ? { ok:true, module } : { ok:false, issues }
```

**错误聚合策略**：四个阶段均可向 `issues: Issue[]` 追加。词法/语法/禁止/语义错误**尽量多收集**（best-effort resync），但任一 issue 存在即返回 `{ ok:false, issues }`，不返回 `module`。红灯测试只断言 `issues.length >= 1` 且每条满足形状，故多收集是安全的；单条也满足。

**阶段依赖**：阶段 3（环检测）依赖阶段 2 产出的别名表。若阶段 2 已有致命语法错误导致别名表不完整，阶段 3 仍对已解析出的别名跑（图更小，不会误报），结果与语法 issue 合并返回。

---

## §2. Tokenizer 设计

### 2.1 Token 形状

```ts
interface Token {
  type: TokenType
  value: string       // 原文片段（标识符名 / 字面量原文 / 标点）
  line: number        // 1-indexed 起始行
  column: number      // 1-indexed 起始列
}

type TokenType =
  | 'identifier'      // 字母/$/_ 起始，含字母/数字/$/_（含 type/string/YMap 等关键字，由 parser 按值分派）
  | 'string'          // 双引号字符串字面量，value 为去外引号后的内容（保留转义原文，见 §2.3）
  | 'number'          // 数字字面量
  | 'punct'           // { } [ ] ( ) < > ; , : ? = | & . 
  | 'doc'             // /** */ 原文（含外层 /** */，value 为去掉首尾 /** */ 的正文，见 §2.4）
  | 'eof'
```

> 注：`//` 与 `/* */`（非 doc）**不产出 token**，tokenizer 直接跳过，但其文本**不进入任何 IR 字段**（红灯 jsdoc 套件断言其内容不得出现在 IR）。只有 `/** */` 产出 `doc` token。

### 2.2 位置追踪

逐字符扫描，维护 `line`（遇 `\n` +1）与 `column`（遇 `\n` 重置为 1，否则 +1）。每个 token 记录**起始**位置。错误 issue 锚定到相关 token 的起始 line/column。

`expectIssueShape`（红灯 helper）校验 `line ∈ [1, lineCount]`、`column ∈ [1, lineText.length + 1]`（`lineCount` 与 `lineText` 取自 `text.split('\n')`），故所有 issue 必须指向源文本内合法位置——token 起始位置天然满足。

**R2 修订（攻击点 6）— CRLF 与 EOF 锚点规范**：

- **CRLF 处理**：tokenizer 扫描时**跳过 `\r`**（即遇 `\r\n` 视作 `\n`，遇单独 `\r` 也视作换行），`\r` **不推进 column**。等价于在扫描前对输入归一化 `\r\n`→`\n`、`\r`→`\n`，但为保留原始行计数一致性，实现选择「扫描时 `\r` 仅触发换行语义、不计数 column」。如此 `type A = any;\r\n` 下 `any` 的 column 与纯 `\n` 输入一致，issue.column 不因 `\r` 越界。**v1 声明同时支持 `\n` 与 `\r\n` 行尾**。
- **EOF token 位置规则**：EOF token 的位置 = 扫描结束位置，即 `(line, column)`，其中 `line` = 已计行数（最后一个 `\n` 之后的行号）、`column` = `max(1, lastLine.length + 1)`。两例落 `expectIssueShape` 范围内：
  - 文件 `type A = { x: string`（未闭合 `}`，无尾换行）→ `split('\n')` = `['type A = { x: string']`，lineCount=1，lastLine.length=19 → EOF at `(1, 20)`，column 20 ∈ [1, 20] ✅。
  - 文件 `type A = any;\n`（尾换行）→ `split('\n')` = `['type A = any;', '']`，lineCount=2，line 2 = `''`（length 0）→ EOF at `(2, 1)`，column 1 ∈ [1, 1] ✅。
- **行列精度声称下调**：红灯仅对 `any` 一例断言 `line === 3`（§9.17），其余负例只走 `expectIssueShape` 的**范围**校验。故「精确到行列」中，**line 精确到 token 起始行（契约，红灯 any 例锁定）、column 落源内合法范围（契约，expectIssueShape 锁定）；精确 column 值属实现质量而非公共契约**（见 §12 标注）。

### 2.3 字符串字面量与正则转义

VFSL 字符串用双引号。`value` 保留**字面原文**（含转义反斜杠），不做反转义。例：源码 `"^[a-z0-9]+(\\.[a-z0-9]+)*$"` → token value = `^[a-z0-9]+(\\.[a-z0-9]+)*$`（保留双反斜杠）。

红灯 happy-path 断言 `collectStrings(name)` 包含 `^[a-z0-9]+(\\.[a-z0-9]+)*$`（双反斜杠），故 tokenizer **不得**把 `\\.` 还原成 `\.`——保留原文。fixture 的 `^[a-z0-9][a-z0-9-]*$`（无转义）原样保留。

词法规则：
- 遇 `"` 进入字符串，扫描到下一个未转义 `"`（`\` 转义下一字符，`\"` 不闭合）。
- 未到闭合 `"` 先遇 `\n` 或 EOF → 未终止字符串 → 词法 issue（锚定到 `"` 起始位置），best-effort 在 `\n`/EOF 处闭合继续。

### 2.4 注释三分法

| 输入 | 产出 | 处理 |
|---|---|---|
| `// ...` | 无 token | 跳到 `\n`（不含 `\n`）。文本不存储。 |
| `/* ... */`（非 `/**`） | 无 token | 跳到 `*/`。文本不存储。 |
| `/** ... */` | `doc` token | value = 去掉首尾 `/**` `*/` 的正文（保留内部换行与 `@tag`），记录位置。 |

判定顺序：遇 `/` 后看下一字符——`/`→行注释；`*` 再看下一字符——`*`→doc（`/**`），否则块注释。

**未闭合块注释**：`/*` 或 `/**` 进入后到 EOF 未遇 `*/` → 词法 issue，锚定到注释**起始 `/*` 位置**（红灯 forbidden 套件 `type A = { x: string } /* 未闭合` 单行，`/*` 在该行内，column 合法）。

**R2 修订（攻击点 10）— doc 正文含 `*/` 提前闭合（已知限制）**：doc token 扫描遇**首个 `*/`** 即闭合。若 doc 正文内出现 `*/`（如 `/** doc with */ inside */`），doc 在首个 `*/` 处截断，其后 `inside */` 作为普通源码 token 流入后续解析——与 TS JSDoc 行为一致。**v1 接受此限制**：doc 正文不得包含 `*/` 序列。当前 fixture `vfs3-assets.vfsl` 与红灯正例的 doc 正文均不含 `*/`（已核对，安全）。此为已知限制，非红灯覆盖项；未来若需支持，走方言扩展。

### 2.5 doc token 的挂载时机

doc token 进入主流，但**不被 `skipTrivia` 跳过**。Parser 在解析「可挂载节点」（类型别名声明 / 对象字段）前调用 `consumeLeadingDoc()`：

```ts
function consumeLeadingDoc(): string | null {
  let doc: string | null = null
  while (true) {
    skipTrivia()                    // 跳空白 + // + /* */，不跳 doc
    if (peek().type === 'doc') {
      doc = next().value            // 多个 doc 连续时后者覆盖前者（most-recent-wins）
      continue
    }
    break
  }
  return doc
}
```

挂载规则：
- **类型别名级**：`consumeLeadingDoc()` 在 `type` 关键字前调用 → 挂到 `TypeAliasIR.doc`。
- **字段级**：对象字面量解析每个字段前调用 → 挂到 `FieldIR.doc`。
- doc 后跟空白/被忽略注释再跟 doc → most-recent-wins（连续 doc 取最后一个）。
- doc 未跟可挂载节点（如文件末尾游离 doc、两个 doc 间无声明）→ 丢弃，不进 IR。
- 红灯 jsdoc「相邻节点不错位」：`/** 文档一 */ type A... \n\n /** 文档二 */ type B...`——doc 一挂 A、doc 二挂 B，因每个 doc 紧跟各自的 `type` 声明被独立消费，不串挂。✅

**R2 修订（攻击点 5）— 非 leading 位置 `/** */` 处置（v1 声明：leading-position-only 挂载）**：

R1 §2.5 规定 doc token「进入主流但**不被 `skipTrivia` 跳过**」，未覆盖 trailing/inline doc（如 `name: string /** doc */;`、`a: string; /** 中间 doc */ b: number`、字段间游离 doc）。若 parser 在期待分隔符/`}` 处撞上 `doc` token 会触发 resync/误报。R2 闭合如下：

- **挂载语义冻结为 leading-position-only**：doc 仅在「可挂载节点的 leading 位置」经 `consumeLeadingDoc()` 消费时挂载。出现在**非 leading 位置**的 `doc` token（trailing 于类型后、字段之间、`}` 之前等）一律视为 **trivia 丢弃**，不挂载、不报错。
- **实现规则**：在所有「期待分隔符/结构边界」（`;`/`,`/`}`/`)`/`|`/`&`/`=`/EOF）的解析点，调用一个 `skipTriviaAndDoc()` 辅助——它跳过空白、`//`、`/* */` **以及 `doc` token**（丢弃其值）。即：
  ```ts
  function skipTriviaAndDoc(): void {
    while (true) {
      skipWhitespace()
      const t = peek()
      if (t.type === 'lineComment' || t.type === 'blockComment' || t.type === 'doc') { next(); continue }
      break
    }
  }
  ```
  （`//`/`/* */` 在 tokenizer 已不产 token，此处等价于只额外丢弃 `doc`。）
- **后果**：`type A = { name: string /** doc */ }` → doc 被 `skipTriviaAndDoc` 丢弃，`name` 字段无 doc，`ok:true`（不崩溃、不误报）。`type A = { a: string; /** 中间 doc */ b: number }` → 中间 doc 丢弃，`b` 字段正常解析。这是 **v1 声明的限制**（doc 不支持 trailing 挂载），不是虚假降级——v1 明确只支持 leading doc，trailing doc 是「不支持→忽略」的合法路径，非 bug 静默。
- **`consumeLeadingDoc` 与 `skipTriviaAndDoc` 不冲突**：`consumeLeadingDoc` 在挂载点主动消费 leading doc（在调用 `skipTrivia` 后抢在结构 token 前取走 doc）；`skipTriviaAndDoc` 仅在非挂载的结构位置清场。两者职责正交。

---

## §3. v1 语法子集形式文法（冻结）

```
Module        := (TypeAlias)*                         // 仅 type 别名；interface 整体拒绝（§9.6）
TypeAlias     := DocComment? 'type' Identifier GenericParams? '=' Type Semi?
GenericParams := '<' Identifier (',' Identifier)* '>'  // → 禁止（自定义泛型，§9.2）
Semi          := ';'
Type          := UnionType
UnionType     := IntersectionType ('|' IntersectionType)*
Intersection  := ArrayType ('&' ArrayType)?             // 仅 'string & Pattern<"lit">' 合法（§9.7）
ArrayType     := PrimaryType ('[' ']')*                  // T[]；PrimaryType 起始即 '[' → 元组禁止（§9.11）
PrimaryType   := Primitive | Literal | ObjectType | RecordType | MarkerType | TypeRef | '(' Type ')'
Primitive     := 'string' | 'number' | 'boolean' | 'null' | 'unknown'   // 'any'/'symbol' 禁止（§9.1,§9.9）
Literal       := String | Number | 'true' | 'false'
ObjectType    := '{' (Field (Sep Sep?)* )? '}'
Sep           := ';' | ','
Field         := DocComment? FieldKey '?'? ':' Type
FieldKey      := Identifier | String                    // 键名（允许字符串字面量键名）
                | IndexSignature | MappedType           // 两者禁止（§9.4,§9.10）
IndexSignature:= '[' Identifier ':' Type ']'            // → 禁止
MappedType    := '[' Identifier 'in' Type ']'           // → 禁止
RecordType    := 'Record' '<' Type ',' Type '>'         // arity 必须为 2（§9.8）
MarkerType    := MarkerName ('<' MarkerArg? '>')?       // 大小写敏感（§6）；arg 规则见 §6
MarkerName    := 'YMap' | 'YArray' | 'YPlainArray' | 'YLeaf' | 'YXmlFragment' | 'Pattern'
MarkerArg     := Type | String                          // Pattern 仅 String（§9.7）
TypeRef       := Identifier                             // 必须解析到已声明别名，否则未知引用（§10.2）
                | Identifier '<' ... '>'                // 非 Record/Marker 的泛型应用 → 禁止（§9.2）
```

### 3.1 宽容点（避免过度拒绝）

- 类型别名后 `;` **可选**（红灯 `type Asset = { name: string }` 无分号；fixture 无尾分号）。
- 对象字段分隔符 `;` 与 `,` 均可，尾分隔符可选。
- 键名允许 Identifier 或字符串字面量（`"a-key": string`，TS 一致）。
- `true`/`false`/数字字面量类型允许（TS 字面量类型一致性；红灯未负例化）。
- 括号类型 `(T)` 允许（低风险，TS 一致）。

---

## §4. 解析器（递归下降）要点

### 4.1 类型表达式解析优先级

`Type → Union → Intersection → Array → Primary`，按文法自顶向下。`|` 左结合，`&` 仅允许 0 或 1 次。

### 4.2 标识符分派

`identifier` token 的语义由其值在上下文中决定。**R2 修订（攻击点 2、4）**：补齐 `true`/`false` 字面量分派、`Record` 不跟 `<`、MarkerName 不跟 `<>` 的处置，消除 R1 分派表遗漏导致的「`type A = { flag: true }` 被误报未知引用」「`Record` 无 `<>` 落入 TypeRef」等契约缝隙。

| 上下文 | 值 / 后继 | 分派 | 说明 |
|---|---|---|---|
| PrimaryType | `string`/`number`/`boolean`/`null`/`unknown` | Primitive | 五原始类型 |
| PrimaryType | `any`/`symbol` | **禁止**（§9.1,§9.9） | 越界原始类型 |
| PrimaryType | `true`/`false`（identifier 值） | **Literal(boolean)**（攻击点 2） | 在 TypeRef 之前匹配；`true`/`false` 是 identifier token（字母起始），必须显式分派为布尔字面量，不得落入「其他 Identifier→TypeRef」。优先级：Primitive > `true`/`false` Literal > MarkerName > `Record` > TypeRef。 |
| PrimaryType | `Record` 后跟 `<` | RecordType | §9.8 校验 arity=2 |
| PrimaryType | `Record` **不跟** `<`（攻击点 4a） | **禁止**：`Record` 必须带 `<...>`（§9.14） | `Record` 既非 MarkerName（不在六者之列）也非合法 TypeRef（v1 保留字）。锚定 `Record`，issue「Record 必须带类型参数: Record<K, V>」。不落入 TypeRef→未知引用。 |
| PrimaryType | MarkerName（六者精确匹配，大小写敏感）后跟 `<...>` | MarkerType | §6 校验 arg arity/类型 |
| PrimaryType | MarkerName **不跟** `<`（攻击点 4b） | MarkerType（argument=null） | 仍构造 marker 节点，交由 §6 arity 强制判定：`YMap`/`YArray`/`YPlainArray` 0 参→§6 报错；`YLeaf`/`YXmlFragment` 0 参→**合法**（防过度拒绝）。文法 `('<' MarkerArg? '>')?` 的可选 `<>` 即为此。 |
| PrimaryType | `Record`/MarkerName 外的 Identifier 后跟 `<` | **禁止**（自定义泛型应用，§9.2） | 如 `Box<T>`、`ymap<{}>` |
| PrimaryType | 其他 Identifier（无 `<`，非 `true`/`false`） | TypeRef（别名引用） | §10.2 未知引用检查 |
| 声明 | `type` | 进入 TypeAlias | |
| 声明 | `interface` | **禁止**（§9.6） | |

**数字字面量（攻击点 2）**：tokenizer 对数字产出 `number` token（**非 identifier**），PrimaryType 解析遇 `number` token 直接构造 `Literal(number)`，不经上表 identifier 分派。故 `type A = { code: 1 | 2 }` 中 `1`/`2` 直接为 literal，无「未知引用」风险。tokenizer 须确认 `1`/`2` 产 `number` token（数字起始），而非误归 identifier。

大小写敏感：`ymap` 不匹配 `YMap` → 落入 TypeRef → 后续 `<{}` 触发自定义泛型应用禁止（§9.2）或未知引用。红灯 forbidden `type A = { m: ymap<{}> }` 被拒。✅

### 4.3 错误恢复（resync）

遇禁止/语法错误后：
- 类型表达式内：记录 issue，跳过到当前字段结束（`;`/`,`/`}`）或 `>` 配对，继续解析后续字段，尽量多收集。
- 顶层声明内：记录 issue，resync 到下一个顶层 `type`/`interface`/EOF。
- 恢复不追求完美，只为多收集 issue；红灯不要求精确 issue 数。

**R2 修订（攻击点 9）— 嵌套泛型 `>` 配对 resync**：类型表达式内 resync 采用**尖括号深度计数**，避免深度嵌套（如 `YMap<Record<string, YArray<A>>>`）错误后误吞过多 token 或误锚点后续 issue：

```ts
function resyncTypeExpr(): void {
  let depth = 0
  while (true) {
    const t = peek()
    if (t.type === 'eof') break
    if (t.type === 'punct' && t.value === '<') { depth++; next(); continue }
    if (t.type === 'punct' && t.value === '>') {
      if (depth > 0) { depth--; next(); continue }   // 配对内的 > 消耗
      else break                                      // depth=0 的 > 是外层泛型闭合，停在此
    }
    if (depth === 0 && (t.value === ';' || t.value === ',' || t.value === '}')) break  // 字段边界
    next()
  }
}
```

规则：resync 跳过到「首个 depth=0 的 `>`」（外层泛型闭合）或「字段边界（`;`/`,`/`}`）」或 EOF，二者先到为准。深度计数确保 `YMap<Record<string, YArray<>>>`（最内层缺参）报错后不会越过外层 `>>>` 吞掉后续字段。**已知限制**：极复杂错误后 resync 可能牺牲后续 issue 精度（红灯不要求精确 issue 数，可接受）。

---

## §5. AST / IR 形状（可序列化、可哈希、doc 挂载）

### 5.1 推荐 IR（SA3 可微调键名，但须满足红灯 helper 的形状无关断言）

```ts
// ── 模块 ──
interface ModuleIR {
  declarations: TypeAliasIR[]
}

// ── 类型别名 ──
interface TypeAliasIR {
  kind: 'alias'
  name: string                 // 'Asset'
  doc: string | null           // /** */ 原文（去首尾定界符），无则 null
  type: TypeIR
  line: number
  column: number
}

// ── 对象字段 ──
interface FieldIR {
  kind: 'field'
  name: string                 // 'name' / 'kind' / ...
  optional: boolean            // ?: → true；必填 → false（始终携带 boolean，不用 undefined）
  doc: string | null           // 字段级 /** */ 原文
  type: TypeIR
  line: number
  column: number
}

// ── 类型表达式（判别联合）──
type TypeIR =
  | { kind: 'primitive'; name: 'string' | 'number' | 'boolean' | 'null' | 'unknown' }
  | { kind: 'literal'; value: string | number | boolean }
  | { kind: 'union'; members: TypeIR[] }
  | { kind: 'array'; element: TypeIR }                       // T[]
  | { kind: 'record'; key: TypeIR; value: TypeIR }           // Record<K,V>
  | { kind: 'intersection'; left: TypeIR; right: TypeIR }    // 仅 string & Pattern<"lit">
  | { kind: 'object'; fields: FieldIR[] }
  | { kind: 'ref'; name: string }                            // 别名引用
  | { kind: 'marker'; name: MarkerName; argument: TypeIR | string | null }
// MarkerName = 'YMap' | 'YArray' | 'YPlainArray' | 'YLeaf' | 'YXmlFragment' | 'Pattern'
//   - YMap/YArray/YPlainArray: argument = TypeIR（元素/值类型）
//   - Pattern: argument = string（正则原文）
//   - YLeaf/YXmlFragment: argument = null
```

### 5.2 为什么这个形状满足红灯 helper

红灯 helper（`collectNodes`/`nodeByName`/`collectStrings`）深度遍历对象树，断言语义事实。本形状的对应关系：

| 红灯断言 | IR 保证 |
|---|---|
| `nodeByName(module, 'Asset')` defined | `TypeAliasIR.name === 'Asset'`（helper 先匹配 `.name`） |
| `nodeByName(alias, 'name')` defined（字段） | `FieldIR.name === 'name'` |
| `collectStrings(idField)` 含 `'string'` | primitive 节点 `{kind:'primitive', name:'string'}` → helper 收集 key `name` 与 value `'string'` |
| `collectStrings(kindField)` 含 `'file'`/`'dir'` | literal 节点 `{kind:'literal', value:'file'}` → 收集 value |
| `collectStrings(nameField)` 含正则原文 | Pattern marker `{kind:'marker', name:'Pattern', argument:'^[a-z]+$'}` → 收集 argument |
| `collectStrings(node)` 含 `'YMap'`/`'YArray'`/... | marker 节点 `name` 字段值即标记名 |
| `collectNodes(subtitle).some(n => n.optional === true)` | `FieldIR.optional === true` |
| `collectStrings(module)` 含 doc 原文 | alias/field 的 `doc` 字段值（string）被收集 |
| doc 不串挂 | 每 doc 独立挂到相邻节点（§2.5） |
| `//` / `/* */` 内容不进 IR | tokenizer 不存储其文本（§2.4） |
| `JSON.parse(JSON.stringify(module))` 深等 | IR 全是 plain data，无 `undefined`/函数/Symbol（§5.3） |
| `parseVfsl(t) === parseVfsl(t)` | 纯函数 + 确定性（§11） |

### 5.3 可序列化/可哈希的硬规则（SA3 必须遵守）

1. **禁用 `undefined`**：可选用 `boolean`，缺值用 `null`，缺文档用 `null`，marker 无参用 `null`。
2. **禁用** 函数属性、`Symbol`、`Map`/`Set`、`Date`、`bigint`。
3. 字段顺序固定（构造时按解析顺序 push），保证 `JSON.stringify` 稳定 → 天然可哈希。
4. 规范哈希（未来编译缓存用）：`sha256(canonicalJsonify(module))`，`canonicalJsonify` 对对象 key 排序输出。本任务不实现，仅保证可行性。

### 5.4 位置信息入 IR

`TypeAliasIR` / `FieldIR` 携带 `line`/`column`（number），供未来求值器/路径索引/错误回带使用。位置是纯数字，不破坏可序列化性。type 表达式内部节点不强制携带位置（错误已在解析期报告）。

---

## §6. 六标记类型契约（大小写敏感）

| 标记 | 类型参数 | 参数类型 | 语义 |
|---|---|---|---|
| `YMap` | 必须 1 个 | TypeIR（通常对象字面量） | Yjs Map 物化，值为给定结构 |
| `YArray` | 必须 1 个 | TypeIR（元素类型） | Yjs Array 物化 |
| `YPlainArray` | 必须 1 个 | TypeIR（元素类型） | 普通（非物化）数组 |
| `YLeaf` | 必须 0 个 | — | Yjs 叶子节点 |
| `YXmlFragment` | 必须 0 个 | — | Yjs XML 片段 |
| `Pattern` | 必须 1 个 | string 字面量（正则原文） | 字符串/键约束，仅在 `string & Pattern<"lit">` 中使用 |

**大小写是契约**：匹配六者必须精确大小写。`ymap`/`yarray` 等不匹配 → 落入 TypeRef → 触发未知引用或自定义泛型应用禁止（§4.2、§9.2）。红灯 `ymap<{}>` 被拒。✅

**arg arity 强制**（防御性契约，与标记语义一致）：
- `YMap`/`YArray`/`YPlainArray`：恰好 1 个参数，否则结构化错误。
- `Pattern`：恰好 1 个 string 字面量参数；非 string（如 `Pattern<123>`）→ 错误（§9.7）；0 个或 >1 个 → 错误。
- `YLeaf`/`YXmlFragment`：0 个参数；带参 → 错误。

> 设计依据：v1 标记语义冻结，「只增不改」。参数 arity 是标记语义的一部分，现在冻结为契约。若未来需无参 `YMap`，走方言扩展（v1.1），不改 v1。这与 SA6 红灯一致（fixture 用 `YMap<{...}>`、`YArray<string>`、`YPlainArray<number>`、`YLeaf`、`YXmlFragment`）。

---

## §7. 注释处理总表

| 注释 | tokenizer | 是否进 IR | 挂载目标 |
|---|---|---|---|
| `// ...` | 跳过，无 token | 否 | — |
| `/* ... */` | 跳过，无 token | 否 | — |
| `/** ... */` | `doc` token（正文去定界符） | 是（原文 string） | 相邻 alias / field 节点的 `doc` 字段 |

doc 挂载规则见 §2.5。标签的结构化解析（`@tag`）**延后到语义层任务**，本方言 doc 全部文档性质——IR 只存原文 string，不解析标签。未识别 `@tag` 不产生 warn（那是语义层职责；parser 层不读标签内容，无「未识别」概念）。

---

## §8. 错误模型

### 8.1 Issue 结构

`{ message: string; line: number; column: number }`。`message` 非空描述性中文/英文。`line`/`column` 1-indexed，锚定到触发构造的 token 起始位置（合法源内位置，满足 `expectIssueShape`）。

### 8.2 多 issue 聚合

四阶段均向 `issues[]` 追加，best-effort resync 多收集。返回时 `issues.length >= 1` 即 `{ ok:false, issues }`。红灯只断言「至少 1 条 + 形状」，不锁定精确条数与 message 文本。

### 8.3 错误分类与锚点

| 类别 | 阶段 | 锚点 |
|---|---|---|
| 未闭合块注释 | 词法 | `/*` 起始位置 |
| 未终止字符串 | 词法 | `"` 起始位置 |
| 越界类型（any/symbol/泛型/条件/映射/索引/元组/interface/交叉/Pattern 参/Record 参/小写标记/独立 Pattern/Record 无 `<>`） | 语法 | 触发 token 起始位置（见 §9 表） |
| 语法结构错误（缺 `:`/`}`/`>` 等） | 语法 | 缺失处的 token |
| 别名引用成环 | 语义 | 闭合环的回边所在别名声明行（§10.1） |
| 未知类型引用 | 语义 | 引用 token 位置 |

---

## §9. 禁止清单逐项检测策略（越界即错）

| # | 禁止项 | 检测点 | 锚点 token | 红灯用例 |
|---|---|---|---|---|
| 9.1 | `any` | PrimaryType 分派遇 `any` | `any` | `type A = any;`（line 3 精确） |
| 9.2 | 自定义泛型 | (a) 别名声明后遇 `<`（TypeParam）；(b) TypeRef（非 Record/Marker）后遇 `<` | `<` 或标识符 | `type Box<T> = { value: T };`、`ymap<{}>` |
| 9.3 | 条件类型 | 类型表达式解析后遇 `extends` | `extends` | `string extends number ? "yes" : "no";` |
| 9.4 | mapped type | 对象字段遇 `[` Identifier `in` | `[` | `{ [K in "a" \| "b"]: string };` |
| 9.5 | interface 继承 | 顶层遇 `interface` 关键字（v1 仅 type 别名，interface 整体出子集；extends 进一步显式禁止） | `interface` | `interface Child extends Parent { name: string }` |
| 9.6 | （同上）interface 整体 | 同 9.5 | `interface` | — |
| 9.7 | 非 Pattern 交叉 / Pattern 参非 string | Intersection 解析：仅允许 `string & Pattern<StringLit>`；左非 `string`、右非 Pattern、Pattern 参非 string 字面量、`&` 多于 1 次 → 错误 | `&` 或 Pattern 参 | `string & number;`、`string & Pattern<123>;` |
| 9.8 | Record 参数数量 | `Record<...>` 类型参数 ≠ 2 | `Record` 或 `<` | `Record<string>;` |
| 9.9 | `symbol`（原始类型负） | PrimaryType 分派遇 `symbol` | `symbol` | `{ x: symbol };` |
| 9.10 | 索引签名 | 对象字段遇 `[` Identifier `:`（与 mapped 的 `in` 区分） | `[` | `{ [key: string]: number };` |
| 9.11 | 元组 `[T]` | PrimaryType 起始即 `[`（`T[]` 是后缀，前导 `[` 即元组） | `[` | `{ x: [string] };` |
| 9.12 | 标记大小写 | 见 §6；非精确匹配落入 TypeRef → 9.2 或未知引用 | 标识符 | `ymap<{}>` |
| 9.13 | `Record` 无 `<>`（攻击点 4a） | PrimaryType 分派遇 `Record` 但后继非 `<` | `Record` | `type A = { x: Record }`、`type A = Record` |
| 9.14 | 独立 Pattern 用法（攻击点 3） | marker 节点 `name==='Pattern'` 且**不在合法 intersection 上下文** | `Pattern` token | `type A = Pattern<"^a+$">`、`{ x: Pattern<"^a+$"> }`、`Pattern<"a"> & string`（Pattern 在左）、`string \| Pattern<"a">`（Pattern 在 union） |

> 9.5/9.6 说明：v1 冻结子集声明形式**仅 `type` 别名**（TASK.md Implementation Decisions 第一条与「v1 语法子集」）。`interface` 不在子集内，故整体拒绝；`extends` 是禁止清单显式项，二者叠加。SA2 若质疑过度拒绝，依据是 v1 子集只列 type 别名——这不是降级，是子集边界。

### 9.15 独立 Pattern 检测细则（攻击点 3，闭合 §6 契约）

§6 声称 `Pattern`「仅在 `string & Pattern<"lit">` 中使用」，但 R1 §3 文法 `MarkerType := MarkerName ('<' MarkerArg? '>')?` 允许 `Pattern<"a">` 作为独立 PrimaryType 静默通过（§9.7 仅在 Intersection 上下文检测）。R2 增补**独立 Pattern 检测点**：

- **合法上下文（唯一）**：Pattern 节点是某 `intersection` 节点的 `right`，且该 intersection 的 `left === { kind:'primitive', name:'string' }`。即 `string & Pattern<"lit">`。
- **非法上下文**：Pattern 节点出现在任何其他位置——独立 PrimaryType（`type A = Pattern<"a">`）、字段类型直接为 Pattern（`{ x: Pattern<"a"> }`）、intersection 的 left（`Pattern<"a"> & string`）、union 成员（`string | Pattern<"a">`）、array/record/marker 参数内部等。
- **检测时机**：阶段 2 解析产 AST 后、阶段 3 之前，遍历类型表达式树，对每个 `name==='Pattern'` 的 marker 节点判定其父上下文；非法则 issue「Pattern 仅可在 string & Pattern<"lit"> 中使用」，锚定到 Pattern token 起始位置。
- **防过度拒绝**：合法的 `string & Pattern<"^a+$">`（已在红灯 happy-path）不报。红灯 `type A = { x: string & Pattern<"^a+$"> }` → ok:true ✅；`type A = Pattern<"^a+$">` → ok:false，issue 形状合法 ✅。

### 9.16 Record 无 `<>` 与 marker 0 参处置（攻击点 4，闭合 §4.2）

- **`Record` 无 `<>`**（9.13 表项）：`Record` 是 v1 保留字（唯一合法用法 `Record<K,V>`），既非 MarkerName 也非合法别名引用。分派遇 `Record` 不跟 `<` → 直接报「Record 必须带类型参数: Record<K, V>」，锚定 `Record`，**不**落入 TypeRef→未知引用（避免泛泛错误信息）。resync 后继续。
- **MarkerName 0 参**（§4.2/§6）：`YMap`/`YArray`/`YPlainArray` 不跟 `<>` → 构造 0 参 marker → §6 arity 报「YMap 必须带 1 个类型参数」；`YLeaf`/`YXmlFragment` 不跟 `<>` → 构造 0 参 marker → **合法**（§6 契约 0 参）。红灯 `type A = { leaf: YLeaf }` → ok:true ✅；`type A = { m: YMap }` → ok:false ✅。

### 9.17 any 行号精确保证（line 契约，对应 9.1）

红灯 `// 前置行注释一\n// 前置行注释二\ntype A = any;` 断言 `issues.some(i => i.line === 3)`。tokenizer 逐行计行（`\n` +1），`any` 在第 3 行 → token.line=3 → issue.line=3。✅ 前置 `//` 注释不影响行计数（它们占行但不产 token，行号仍递增）。

---

## §10. 环检测算法

### 10.1 别名引用图与 DFS 三色

**节点**：所有已声明类型别名名。  
**边** A → B：别名 A 的类型表达式（递归展开对象字段 / 数组 / Record 两参 / 联合成员 / 交集（Pattern 无别名引用）/ marker 参数）中引用了别名 B。

```ts
// 伪代码
const WHITE = 0, GRAY = 1, BLACK = 2
const color = new Map<string, number>()   // 默认 WHITE
const decl  = new Map<string, { line, column }>()  // 别名声明位置
const edges = new Map<string, Set<string>>()       // A → {B...}，由 collectRefs(type) 递归提取

function collectRefs(t: TypeIR, out: Set<string>): void {
  switch (t.kind) {
    case 'ref': out.add(t.name); break
    case 'array': collectRefs(t.element, out); break
    case 'record': collectRefs(t.key, out); collectRefs(t.value, out); break
    case 'union': t.members.forEach(m => collectRefs(m, out)); break
    case 'intersection': collectRefs(t.left, out); collectRefs(t.right, out); break
    case 'object': t.fields.forEach(f => collectRefs(f.type, out)); break
    case 'marker':
      if (typeof t.argument === 'object' && t.argument !== null) collectRefs(t.argument, out)
      break
    // primitive / literal：无引用
  }
}

function dfs(a: string): void {
  color.set(a, GRAY)
  for (const b of edges.get(a) ?? []) {
    if (!decl.has(b)) continue        // 未知引用由 §10.2 单独报，不计入环
    const c = color.get(b) ?? WHITE
    if (c === GRAY) {
      // 回边 a→b：b 在当前 DFS 栈上 → 成环
      issues.push({ message: `循环引用的类型别名: ${a} → ${b}`, line: decl.get(a)!.line, column: decl.get(a)!.column })
    } else if (c === WHITE) {
      dfs(b)
    }
  }
  color.set(a, BLACK)
}

for (const a of decl.keys())
  if ((color.get(a) ?? WHITE) === WHITE) dfs(a)
```

### 10.2 未知引用检查

`collectRefs` 收集到的名字若不在 `decl`（且非 primitive/marker/Record，这些在解析期已分派，不会进 ref 节点）→ 未知类型引用 → issue 锚定到 ref token 位置。

> 注：解析期 primitive/marker/Record 已识别，TypeRef 节点只剩「用户别名」。故 ref 名不在 decl 即未声明 → 报错。这是正确性要求（IR 不得引用未定义类型），非过度拒绝。

**R2 修订（攻击点 7）— 语法错误级联伪未知引用的门控**：若阶段 2 已产生**致命语法/禁止类 issue**（任何 §9 越界或语法结构错误），则某些别名声明可能因 resync 未登记进 `decl`，导致所有引用该别名的 ref 被误报「未知引用」——这是语法错误的**级联伪报**，淹没真实错误、降低信噪比。门控策略：

- 阶段 3 入口判定 `hasSyntaxIssue = issues.some(i => i.category === 'syntax' || i.category === 'forbidden')`。`category` 是**解析期内部标签**（issue 构造 helper 附带，仅用于阶段间判定），**返回前剥离**——最终 `{ok:false, issues}` 的每条 issue 严格只有 `message`/`line`/`column` 三字段（§0.1 冻结，不得新增公共字段）。
- **若 `hasSyntaxIssue` 为真**：**跳过未知引用检查**（§10.2），仅保留**环检测**（§10.1，环检测对 decl 不完整不敏感——未知引用的边 `!decl.has(b)` 已被 `continue` 跳过，不会误报环）。并在返回的 issues 列表**追加一条提示 issue**：「检测到语法错误，语义检查（未知引用）已跳过，结果不完整」，锚定到 `(1,1)`（文件头，合法位置）。
- **若 `hasSyntaxIssue` 为假**（语法干净）：未知引用检查正常执行。
- 对 `ok=false` 判定无影响（语法 issue 已使 ok=false）；仅提升错误信息信噪比。这不是虚假降级——是显式声明「语义检查在语法错误前提下不完整」，loud 标注，不静默。

### 10.3 红灯用例验证

| 用例 | 图 | 结果 | 锚点 |
|---|---|---|---|
| `type A = A;` | A→A（自环） | 环，issue at A 行 | dfs(A): A GRAY, edge A→A, A is GRAY → 报 A 行 ✅ |
| `type A = { x: A }` | A→A（经字段） | 环 | collectRefs 含 A ✅ |
| `type A = B;\ntype B = A;` | A→B, B→A | 环，issue at line 1 或 2 | dfs(A)→dfs(B): B GRAY, edge B→A, A GRAY → 报 B 行(line 2)；∈{1,2} ✅ |
| `type A = { b: B };\ntype B = { a: A };` | A→B, B→A | 环 | 同上 ✅ |
| `type A = B;\ntype B = { x: string }` | A→B, B→{} | 无环 | dfs(A)→dfs(B): B 无出边, BLACK；A BLACK；合法 ✅ |

**前向引用合法**：v1 允许别名引用后声明的别名（只要不成环）。解析期不要求「先声明后引用」——别名表在整段 parse 完后建立，再跑环检测。这保证 `type A = B; type B = {...}` 合法。✅

### 10.4 去重

同一环可能从多个起点发现。按「环上成员集合」去重，每环报一条 issue（锚定回边所在别名）。红灯只需 `>=1`，去重避免噪声。

---

## §11. parseVfsl 纯函数契约

```ts
export function parseVfsl(text: string): ParseResult
```

- **无副作用**：不读环境/文件/网络，不修改入参，不写全局。
- **确定性**：不依赖 `Date.now()`/`Math.random()`/`process.*`；同一 `text` 两次调用 `toEqual`。
- **零运行时依赖**：`src/` 仅 import 自身模块与 TS 标准类型。`devDependencies`（typescript/vitest）不进 dist 运行时。
- **不抛异常**：所有错误转为 `{ ok:false, issues }`。tokenizer/parser 内部不 throw 到调用方（best-effort：即便内部 invariant 被违反也兜底返回 issues，而非崩）。

> 拒绝虚假降级（SKILL §4 立法）：parse 失败必须 loud 返回 `{ ok:false, issues }`，**不得**静默返回空 module 或部分 module。ok=true 当且仅当 `issues.length === 0` 且解析完整。

---

## §12. 与红灯测试对齐矩阵

### 12.1 happy-path 套件

| 红灯用例 | 设计保证 |
|---|---|
| 导出 parseVfsl 函数 | §0.1、§11；`src/index.ts` re-export |
| 类型别名进 module | §5.1 TypeAliasIR.name |
| 封闭对象 + 五原始类型 | §3 Primitive；§5.1 primitive.name 携带类型名 |
| `?:` 可选标记 | §5.1 FieldIR.optional |
| 字面量联合两成员 | §5.1 union.members / literal.value |
| `T[]` | §5.1 array.element |
| `Record<K,V>` 两参 | §5.1 record.key/value |
| `string & Pattern<"正则">` 正则原文 | §5.1 intersection + marker.argument（保留转义原文 §2.3） |
| `//` 与 `/* */` 忽略 | §2.4 不产 token |
| 六标记大小写契约 | §6 |
| fixture 全量解析 | §3 文法覆盖 fixture 全部构造 |
| IR JSON 往返 | §5.3 无 undefined/函数/Symbol |
| 纯函数确定性 | §11 |

### 12.2 forbidden 套件

逐项见 §9 表。每项保证 `{ ok:false, issues:[{message,line,column}] }`，line/column 落源内。

### 12.3 cycle-detection 套件

见 §10.3。自环/经字段自递归/互引用/经字段互引用 → 拒绝；前向无环 → 合法。

### 12.4 jsdoc 套件

见 §2.5、§7。别名级/字段级/标记类型字段级 doc 挂载；`/* */` 与 `//` 不进 IR；相邻不串挂。

### 12.5 行列精度标注（R2 修订，攻击点 6）

红灯对 issue 位置的断言分两层：
- **契约层**（红灯锁定）：`any` 例 `line === 3`（§9.17）；所有负例 `expectIssueShape` 校验 `line ∈ [1,lineCount]`、`column ∈ [1,lineText.length+1]`。
- **实现质量层**（非契约）：精确 column 值、CRLF 下 column 一致性、EOF 锚点——设计在 §2.2 给出规范并自证落范围，但红灯未锁定精确值。SA3 实现须满足契约层（必），实现质量层按 §2.2 规范（应）。「精确到行列」一语的**契约含义**=line 精确到 token 起始行 + column 落源内合法范围。

---

## §13. 实现模块结构建议（SA3，非公共契约）

内部文件布局由 SA3 自定，推荐：

```
packages/vfsl/src/
  index.ts        — export { parseVfsl } + re-export 公开类型（ParseResult/Issue/ModuleIR）
  types.ts        — Token / TypeIR / FieldIR / TypeAliasIR / ModuleIR / Issue / ParseResult 类型
  tokenizer.ts    — tokenize(text): { tokens, issues }
  parser.ts       — Parser 类：递归下降，产 AST + 消费 doc token
  semantic.ts     — collectRefs / dfs 环检测 / 未知引用检查
  ir.ts           — AST → ModuleIR（或 parser 直接产 IR，二选一）
  errors.ts       — issue 构造 helper（统一 line/column 锚定）
```

### 13.1 构建与测试运行（关键）— R2 修订（攻击点 1，CRITICAL）

**R1 缺陷复盘**：R1 §13.1 建议「把 `packages/vfsl/package.json` 的 `test` 脚本改为 `tsc -p tsconfig.json && vitest run`」以「确保 CI/`pnpm test` 自动构建」。**此假设为假**：根 `package.json` `scripts.test` 与 `scripts/test-lock.sh` 两处入口硬编码为 `pnpm --filter @nomicore/vfsl exec vitest run`，而 **`pnpm exec <cmd>` 直接运行 `node_modules/.bin/<cmd>` 二进制，不触发包的 `test` 生命周期脚本**（已实测验证，见 §16）。故包 `test` 脚本里的 `tsc` 前置是**死代码**，`pnpm test` / `bash scripts/test-lock.sh` 仍以 `exec vitest run` 跑、dist 不构建 → `@nomicore/vfsl` 解析到不存在的 `dist/index.js` → 4 套件在 import 阶段失败，与当前红灯状态完全相同。设计自行冻结的边界（根 `package.json` / `test-lock.sh` / `vitest.config.ts` / `exports`→dist）在 R1 内**无任何一条**能让 `pnpm test` 自动构建 dist。

**R2 选定路径（路径 A，已实测验证）**：解冻并改写两个测试入口脚本，前置 `pnpm --filter @nomicore/vfsl run build`。`exports`→dist 与 `vitest.config.ts` 保持冻结。

```jsonc
// 根 package.json（scripts 段，R2 改）
{
  "scripts": {
    "test": "pnpm --filter @nomicore/vfsl run build && pnpm --filter @nomicore/vfsl exec vitest run",
    "test:vfsl": "pnpm --filter @nomicore/vfsl run build && pnpm --filter @nomicore/vfsl exec vitest run"
  }
}
```

```bash
# scripts/test-lock.sh（R2 改：在 exec vitest 行前加 build 前置）
pnpm --filter @nomicore/vfsl run build && pnpm --filter @nomicore/vfsl exec vitest run
```

**包 `packages/vfsl/package.json` 不再改 `scripts.test`**（R1 的 `tsc` 前置为 exec 下死代码，R2 撤销；`scripts.test` 维持 `"vitest run"`，供包目录内手动 `pnpm run test` 用，无害）。`exports`/`main`/`types`/`files` 一律不动（公共接缝不变）。

**为何不用路径 B（包 `test` 脚本加 `tsc` + 根入口改 `run test`）**：路径 B 亦可行（`pnpm run test` 会执行 `scripts.test` body），但需同时改 3 处（包 test 脚本 + 根 scripts + test-lock.sh），且把构建职责塞进包 test 脚本语义混杂。路径 A 把构建显式前置在入口、构建与测试职责分离、改动面更小（仅 2 处入口），且**已端到端实测**（见 §16），故选 A。

**SA3 落地后验证**（SA4 gate 测试）：
```bash
rm -rf packages/vfsl/dist && pnpm test                          # 期望 exit 0、4 套件全绿
rm -rf packages/vfsl/dist && bash scripts/test-lock.sh          # 期望 exit 0、4 套件全绿
rm -rf packages/vfsl/dist && pnpm --filter @nomicore/vfsl run build && pnpm test   # 手动 build 路径仍可用，全绿
```

> 备选（不采用）：vitest.config 加 `resolve.alias` 把 `@nomicore/vfsl` 指向 `src/index.ts` 免构建——但 SA6 已冻结 vitest.config，且 exports→dist 是既定公共接缝。**走 build 路径 A**，不改 vitest.config，不改 exports。

### 13.2 TS 严格性

根 tsconfig `strict: true`、`moduleResolution: Bundler`、`module: ESNext`。SA3 实现须通过 strict 编译（无 `any`、无隐式 any、null 严格）。判别联合用 `kind` 字段 narrow。

---

## §14. 边界条件与防御性清单

| 场景 | 处理 |
|---|---|
| 空输入 `''` | `{ ok:true, module:{ declarations:[] } }` |
| 仅注释 | 同空输入（declarations 空） |
| 顶层非 `type`/`interface` token | 语法 issue（resync 到下一 type/EOF） |
| 重复别名声明 `type A=...; type A=...` | loud issue「重复声明」锚定第二处；`decl` 保留**首次**声明（§14.1），不静默覆盖、不静默合并 |
| 嵌套对象（字段类型为对象字面量） | 文法允许 PrimaryType→ObjectType 递归；IR object.fields 嵌套 |
| `Record` 的 K/V 为别名引用 | collectRefs 收集（参与环检测） |
| marker 参数为别名引用 `YArray<Asset>` | collectRefs 收集（参与环检测） |
| doc 内含 `*/` | tokenizer `/** */` 扫到首个 `*/` 闭合；doc 正文内出现 `*/` 会提前闭合——与 TS JSDoc 一致，接受此限制 |
| 转义引号 `"a\"b"` | §2.3 `\` 转义下一字符，`\"` 不闭合 |
| 数字字面量类型 `1 \| 2` | 允许（literal.value=number） |
| `unknown` 与 `any` 区别 | `unknown` 合法 primitive；`any` 禁止 |

### 14.1 重复别名声明的处置（loud，非降级）

`type A = {...}; type A = {...}` → 第二个声明触发 issue「重复的类型别名声明: A」，锚定到第二个 `A`。不静默覆盖、不静默合并。这是正确性要求，非降级。

**R2 修订（攻击点 8）— `decl` map 保留策略**：重复声明时，环检测/ref 解析用的 `decl` map（§10.1 `decl: Map<name, {line,column}>` 与别名类型表达式表）**保留首次声明**，第二处仅产 loud issue（锚定第二处）。理由：
- **保留 first** → ref 解析与环检测锚点稳定（始终指向首次声明的类型表达式与行号），不受第二处影响。
- 若保留 last，则第一处的类型表达式在 ref 解析时丢失，可能使环检测锚点行号漂移到第二处，与 issue「重复声明锚定第二处」语义混淆。
- 故：`decl.set(name, ...)` 仅在 `!decl.has(name)` 时写入；第二处命中已存在 key → push 重复声明 issue，不覆盖。红灯 `type A = { x: string }; type A = { y: number }` → ok:false，issue 含「重复声明: A」锚定第二个 A；ref 解析以第一个 A（`{x:string}`）为准。

---

## §15. 文件清单（File Scope）

### ALLOW LIST

- `packages/vfsl/src/index.ts` — 修改，导出 `parseVfsl` 公共接缝 + re-export 公开类型（当前为 `export {}` 占位）
- `packages/vfsl/src/types.ts` — 新建，Token/IR/Issue/ParseResult 类型定义
- `packages/vfsl/src/tokenizer.ts` — 新建，词法分析
- `packages/vfsl/src/parser.ts` — 新建，递归下降语法分析 + doc 挂载
- `packages/vfsl/src/semantic.ts` — 新建，环检测 + 未知引用检查
- `packages/vfsl/src/ir.ts` — 新建，AST→ModuleIR 构建（SA3 可并入 parser.ts）
- `packages/vfsl/src/errors.ts` — 新建，issue 构造 helper
- `packages/vfsl/test/parse-vfsl.happy-path.test.ts` — `[SA6 owned]` 红灯测试。SA3 可改测试基础设施（build hook/fixture 路径）但不准改断言逻辑
- `packages/vfsl/test/parse-vfsl.forbidden.test.ts` — `[SA6 owned]`，同上
- `packages/vfsl/test/parse-vfsl.cycle-detection.test.ts` — `[SA6 owned]`，同上
- `packages/vfsl/test/parse-vfsl.jsdoc.test.ts` — `[SA6 owned]`，同上
- `packages/vfsl/test/helpers.ts` — `[SA6 owned]`，SA3 不改断言 helper
- `packages/vfsl/test/fixtures/vfs3-assets.vfsl` — `[SA6 owned]`，SA3 不改 fixture
- `packages/vfsl/package.json` — **R2 修订：本文件最终不修改**。R1 曾建议改 `scripts.test` 加 `tsc` 前置，SA2 攻击点 1 证伪其为 `exec` 下死代码，R2 撤销该建议；`scripts.test` 维持 `"vitest run"`、`exports`/`main`/`types`/`files` 一律不动（公共接缝不变）。（保留本条以可审计 R1→R2 变更；SA4 比对时 actual 不含本文件改动属预期，warning 可接受。）
- `packages/vfsl/tsconfig.json` — 可微调（如需 `composite`/路径），保持 `outDir=dist`/`rootDir=src`/`declaration`
- `package.json`（根）— **R2 修订追加（SA2 攻击点 1）**，修改 `scripts.test` 与 `scripts.test:vfsl` 为 `pnpm --filter @nomicore/vfsl run build && pnpm --filter @nomicore/vfsl exec vitest run`（前置构建步，使 `pnpm test` 自动产出 dist）。原 DENY 解除。仅改 scripts 段，不动其他字段。
- `scripts/test-lock.sh` — **R2 修订追加（SA2 攻击点 1）**，在 `pnpm --filter @nomicore/vfsl exec vitest run` 行前加 `pnpm --filter @nomicore/vfsl run build &&` 前置（同步根入口，使 `bash scripts/test-lock.sh` 自动产出 dist）。策略声明段同步补充「构建前置」说明。原 DENY 解除。

### DENY LIST

- `packages/vfsl/vitest.config.ts` — 测试基础设施冻结（SA6 已定 include/environment；不改 resolve.alias）
- `pnpm-workspace.yaml` — workspace 配置冻结
- `tsconfig.json`（根）— 根 TS 基础配置
- `TASK.md` / `LICENSE` / `.gitignore` — 仓库基线
- `wiki/**` — 文档（本 design.md 由 SA1 维护，其余不动）
- `packages/vfsl/dist/**` — 构建产物，不入版本控制（.gitignore 应已忽略；SA3 勿手 commit）

---

## §16. 协议假设依据 (Protocol Assumption Evidence)

**R2 修订（攻击点 1，CRITICAL）**：本任务含一类协议级假设——**测试入口脚本的 pnpm 语义**（`pnpm exec` vs `pnpm run` 是否触发包 `test` 生命周期脚本、是否产出 dist）。SA2 指出 R1 §13.1 在此点为无据推断。R2 在设计期**实测验证**全部假设，命令与输出如下（cwd = worktree 根，pnpm 11.1.3，deps 已安装，`packages/vfsl/src/index.ts` 为 SA6 占位 `export {}`）：

| # | 假设 | 依据类型 | 依据内容（实测命令 + 输出） | 风险等级 |
|---|---|---|---|---|
| P1 | `pnpm --filter @nomicore/vfsl exec vitest run` **不触发**包 `test` 脚本、**不构建** dist | 设计期实测验证 | `rm -rf packages/vfsl/dist && pnpm --filter @nomicore/vfsl exec vitest run` → 4 套件全 fail（`Failed to resolve entry for package "@nomicore/vfsl"`），`ls packages/vfsl/dist` → `No such file or directory`。**证伪 R1「改包 test 脚本即可自动构建」**。 | 高（R1 据此错判） |
| P2 | `pnpm --filter @nomicore/vfsl run build` 产出 `dist/index.js` | 设计期实测验证 | `pnpm --filter @nomicore/vfsl run build` → `$ tsc -p tsconfig.json`，`ls packages/vfsl/dist` → `index.d.ts index.d.ts.map index.js`。 | 低 |
| P3 | build 后 `exec vitest run` 的 import 解析成功（测试因 parseVfsl 未实现而 fail，非 import fail） | 设计期实测验证 | build 后 `pnpm --filter @nomicore/vfsl exec vitest run` → `Test Files 4 failed (4), Tests 37 failed (37)`（37 个测试实际运行并断言失败，**无** `Failed to resolve entry`）。对比 P1 的「no tests / import 阶段 fail」，证明 import 缺口已闭合。 | 低 |
| P4 | 路径 A 组合命令 `run build && exec vitest run` 从干净 dist 端到端工作 | 设计期实测验证 | `rm -rf packages/vfsl/dist && pnpm --filter @nomicore/vfsl run build && pnpm --filter @nomicore/vfsl exec vitest run` → build 产出 dist、vitest 运行 37 测试（fail on 断言，SA3 实现后转绿），`ls packages/vfsl/dist/index.js` 存在。 | 低 |
| P5 | `pnpm run test` 执行 `scripts.test` body 字面值，不隐式 build | 设计期实测验证 | `rm -rf packages/vfsl/dist && pnpm --filter @nomicore/vfsl run test`（当前 `scripts.test="vitest run"`）→ 输出 `$ vitest run`、import fail、`ls packages/vfsl/dist` → 不存在。证明 `run test` 按 body 字面执行，无隐式 build——故路径 B 需把 `tsc` 写进 body 才有效。 | 中（佐证 exec/run 语义差） |
| P6 | `tsc` 能把 `src` 编译到 `dist` | 源码引用 + 官方行为 | `packages/vfsl/tsconfig.json` 配 `outDir=dist`/`rootDir=src`/`declaration`；P2 实测 `tsc -p tsconfig.json` 产出 dist。TypeScript 官方行为。 | 低 |
| P7 | vitest 经 package.json `exports` 解析 `@nomicore/vfsl` 到 `dist` | 现有测试引用（红灯反向佐证） | SA6 红灯证据：dist 缺失 → `Failed to resolve entry for package "@nomicore/vfsl"`；P3 反向佐证：dist 存在 → import 成功。解析目标确为 `dist/index.js`。 | 低 |

**结论**：R2 选定路径 A（根 `package.json` + `scripts/test-lock.sh` 前置 `pnpm --filter @nomicore/vfsl run build`）已由 P1–P4 端到端实测验证。`exports`→dist 与 `vitest.config.ts` 保持冻结，未引入新协议假设。无 HTTP/WS/端口/进程生命周期/CI runner 资源假设。

---

## §17. 契约改动连锁审计 (Contract Change Caller Audit)

无 API 契约改动：本设计仅涉及**新增函数与新增包源码**。`parseVfsl` 是全新公共 API（greenfield），不存在既有 caller。SA6 红灯测试是首个 caller，其调用形态已由红灯固定为 `parseVfsl(text)` → 判别联合，本设计严格遵从，不改其签名/返回形状。

**R2 修订（攻击点 1）脚本变更说明**：R2 改动根 `package.json` `scripts.test`/`scripts.test:vfsl` 与 `scripts/test-lock.sh`（前置 `run build`），以及撤销 R1 对包 `scripts.test` 的 `tsc` 前置建议。**这些属脚本/编排变更，非 API 契约变更**——不改变任何函数签名/返回类型/throw 语义/sync-async，无 caller 连锁。`parseVfsl` 仍为 `text:string → ParseResult` 纯函数。无既有函数从 `return X` 改 `throw`、无 sync→async、无 catch 块语义变更。故无 caller 审计表（SKILL §1.5 N/A，本节声明即可）。

---

## §18. SA2 反馈逐条回应

> R2 修订针对 SA2 `needs-redesign` 评审的 10 个攻击点逐条落实。每条均给出**实质改动**（非「承认但不改」）。

| # | SA2 攻击点 | 严重度 | 是否落实 | 修订位置 | 修订内容摘要 |
|---|---|:---:|:--:|---|---|
| 1 | green-bar 编排：`pnpm exec` 不触发包 `test` 脚本，R1 的 `tsc` 前置为死代码，dist 永不构建 | CRITICAL | ✅ | §13.1、§15、§16、§17 | 撤销 R1「改包 test 脚本」建议（exec 下死代码）；改走**路径 A**：根 `package.json` `scripts.test`/`test:vfsl` 与 `scripts/test-lock.sh` 前置 `pnpm --filter @nomicore/vfsl run build &&`，两文件移出 DENY 入 ALLOW（标注 SA2 攻击点 1）。§16 贴出 P1–P5 实测证据（`exec` 不构建 dist、`run build` 产出 dist、组合命令端到端、`run test` 语义差），不再下无据推断。 |
| 2 | `true`/`false`/数字字面量类型：§3 文法允许但 §4.2 分派表遗漏，`type A={flag:true}` 被误报未知引用 | MEDIUM | ✅ | §4.2 | 分派表补 `true`/`false` → Literal(boolean) 行，优先级在 TypeRef 之前（Primitive > true/false > MarkerName > Record > TypeRef）；数字字面量由 tokenizer 产 `number` token 直接构造 Literal(number)，不经 identifier 分派。 |
| 3 | 独立 Pattern<"a">（非 intersection）被静默接受，违反 §6 契约 | MEDIUM | ✅ | §9（9.14 表项 + §9.15 细则）、§8.3 | 新增检测点 9.14/§9.15：marker `name==='Pattern'` 且不在合法 intersection 上下文（父非 `{kind:'intersection',left:{kind:'primitive',name:'string'}}` 的 right）→ 结构化错误，锚定 Pattern token。合法 `string & Pattern<"^a+$">` 不报（防过度拒绝）。 |
| 4 | `Record`/MarkerName 不跟 `<` 的分派未定义 | MEDIUM | ✅ | §4.2、§9（9.13 表项 + §9.16 细则） | §4.2 补两行：(a) `Record` 不跟 `<` → 禁止（9.13），锚定 `Record`，不落入 TypeRef；(b) MarkerName 不跟 `<>` → 仍构造 marker（argument=null），交 §6 arity 判定（YMap/YArray/YPlainArray 0 参→错；YLeaf/YXmlFragment 0 参→合法）。§9.16 细则展开。 |
| 5 | 非 leading 位置 `/** */` 致硬语法错误（skipTrivia 不跳 doc token） | MEDIUM | ✅ | §2.5 | v1 声明 **leading-position-only 挂载**：非 leading 位置 doc token 经 `skipTriviaAndDoc()` 丢弃（不挂载、不报错）。trailing/inline doc 静默丢弃是 v1 声明限制（非虚假降级）。`consumeLeadingDoc` 与 `skipTriviaAndDoc` 职责正交。 |
| 6 | 行列精度声称与红灯覆盖不匹配；CRLF/EOF 锚点未规范 | MEDIUM | ✅ | §2.2、§12 | §2.2 规范：CRLF 扫描时 `\r` 不推进 column（v1 支持 `\n`/`\r\n`）；EOF token 位置 = `(line, max(1,lastLine.length+1))`，两例落 expectIssueShape 范围（含证明）；「精确到行列」下调为 line 精确（契约）/column 落范围（契约）/精确 column 实现质量（非契约）。 |
| 7 | 语法错误级联为伪未知引用 | LOW | ✅ | §10.2 | 阶段 3 入口判定 `hasSyntaxIssue`（内部 category 标签，返回前剥离）；为真则跳过未知引用检查、仅留环检测，并追加「语义检查已跳过，结果不完整」提示 issue（锚定 (1,1)）。对 ok=false 无影响，提升信噪比。 |
| 8 | 重复别名声明的 decl map 保留策略未定 | LOW | ✅ | §14.1、§14 表 | 明确 `decl` 保留**首次**声明（`!decl.has(name)` 才写入），第二处仅 loud issue 锚定第二处；ref 解析/环检测以首次为准，锚点稳定。 |
| 9 | 嵌套泛型 resync 的 `>` 配对未细化 | LOW | ✅ | §4.3 | 给出尖括号深度计数 resync 伪代码：跳到首个 depth=0 的 `>` 或字段边界或 EOF。已知限制：极复杂错误后可能牺牲后续精度（红灯不要求精确 issue 数）。 |
| 10 | doc 内 `*/` 提前闭合的 fixture 一致性 | LOW | ✅（记录） | §2.4 | §2.4 显式标注：doc 遇首个 `*/` 闭合，正文含 `*/` 会提前闭合（与 TS JSDoc 一致），v1 接受此限制；已核对 fixture 与红灯正例 doc 无 `*/`，安全。非红灯覆盖项。 |

**自检**：无「承认但不改」条目；每条均在对应章节有伪代码/规则/表格的实质改动。无自相矛盾（§4.2 分派优先级与 §9 检测点一致；§2.5 doc 处置与 §7 注释总表一致；§13.1 路径 A 与 §15 ALLOW/DENY、§16 证据一致）。

---

## §19. 自检一致性声明

- 全文 `parseVfsl` 签名与返回形状与 §0.1、红灯 helper `ParseOutcome` 一致。
- IR 形状（§5.1）与红灯 helper 断言对应（§5.2 表）逐条核对。
- 禁止清单（§9）覆盖红灯 forbidden 套件全部用例 + 覆盖矩阵负例；R2 补 9.13（Record 无 `<>`）/9.14（独立 Pattern）+ §9.15/§9.16 细则。
- 环检测（§10）覆盖红灯 cycle 套件全部 5 用例（含前向合法）；§10.2 增语法错误级联门控（攻击点 7）。
- doc 挂载（§2.5/§7）覆盖红灯 jsdoc 套件全部 5 用例；§2.5 增非 leading doc 丢弃规则（攻击点 5）。
- §4.2 分派表 R2 补 `true`/`false`/`Record 无 <>`/MarkerName 0 参（攻击点 2、4），与 §9 检测点优先级一致。
- §13.1 green-bar 编排改为路径 A（攻击点 1），与 §15 ALLOW/DENY、§16 实测证据、§17 契约审计一致；`exports`→dist 与 `vitest.config.ts` 保持冻结。
- ALLOW LIST 含全部 SA6 owned 测试文件并标 `[SA6 owned]`；DENY LIST 不含测试文件；R2 将根 `package.json`/`scripts/test-lock.sh` 移出 DENY 入 ALLOW（标注 SA2 攻击点 1）。
- 无 `Date.now()`/`Math.random()`/`process.*` 依赖（§11）。
- 零运行时依赖（§0.2、§11），不引入 crypto（§5.3）。
- R2 无「承认但不改」条目；SA2 全部 10 攻击点在 §18 逐条落实。

— SA1，R2 完稿，交 SA2 复审。
