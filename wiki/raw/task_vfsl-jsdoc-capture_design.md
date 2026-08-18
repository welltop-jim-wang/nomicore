# SA1 设计文档 — Parser JSDoc 原文捕获（`/** */` 挂载 IR）+ 最小标记语法接受

> 任务：task_vfsl-jsdoc-capture ｜ Issue #7 ｜ 类型：功能开发（在既有 `@nomicore/vfsl` 上扩展）
> 设计者：SA1 ｜ 日期：2026-08-19 ｜ 状态：**R2（按 SA2 reject 评审修订；修订标注形如【R2 · SA2 #N】，逐条回应见 §16）**
> Worktree：`/home/wangjian/nomicore-fix-issue-7`（分支 `fix/issue-7-on-refactor-docs-add-mabf-multi-repo-monito`）

**设计输入**（已全文阅读）：

| 输入 | 角色 |
|---|---|
| `docs/vfsl/v1-spec.md`（frozen） | 唯一规范来源：§5 注释规则、§2 EBNF `DocComment` + 注记 9/10、§4 错误码总表 E203/E305 + 判定顺序 + 分相位、附录 §10 fixture 挂载样本 |
| `wiki/raw/20260818-prd-vfsl-v1.md` | PRD 归档：#35 注释处理需求、#37 IR 可序列化/可哈希/形状实现自由度、#8/#11 IR 消费者故事 |
| `packages/vfsl/test/parse-vfsl-jsdoc.test.ts`（7 用例，SA6，5 红 2 绿） | 红灯契约锚点；**R2 登记：用例 1 断言机制有测试基建缺陷，需 SA6 回炉修正（§7.4）** |
| `packages/vfsl/src/`（index/tokenizer/parser/semantic/ir/errors，6 文件） | 现状实现（#5 交付，37 用例基线）；行号引用以 R2 重读为准 |
| `packages/vfsl/test/`（parse-vfsl 11 例 / errors 19 例 / r3-regression 7 例） | 既有断言零破坏性核对（逐文件重读：无 IR 精确形状断言、无 `/**` 输入用例、**无任何深度预算行为断言**——`grep -rn "repeat(\|实现上限\|资源上限" test/*.test.ts` 零命中，R2 实证） |
| `CONTEXT.md`、`docs/adr/0001` | 术语（标记类型大小写是契约）与架构红线（无机器标签、单一真相源不容丢失） |
| `wiki/raw/task_vfsl-parser-min-e2e_design.md`（#5 设计 R3） | 分层先例、§7.3「JSDoc 挂载扩展点：`docs: string[]`」预留承诺、§8 切片边界策略、**§15.2 深度预算立法（R2 §4.6 对齐其余量标准：栈 ≥5×、序列化 ≥10×）** |
| `wiki/raw/task_vfsl-jsdoc-capture_sa2_review.md`（R1 评审，verdict: reject） | R2 修订指令来源：7 攻击点逐条落实（§16 回应表） |

**R2 设计期实测**（SA2 评审「协议假设依据审查」节明令「修订轮须补实测」；探针命令与完整输出见各引用节）：

| 探针 | 结果 | 用途 |
|---|---|---|
| probe1（node）：SA6 用例 1 断言机制复现 + 修正方向验证 | 原始形态三条断言 `false/false/false`；转义形全过 | §7.4 |
| probe2（node）：marker 五函数互递归环同构模拟 | 极简帧 60415 层爆栈（仅证无界）；保守基线取 SA2 同法实测 **2343 层** | §4.6 |
| probe3（node）：`JSON.stringify` 深度上限二分 | 4466；保守值取 #5 R2 基线 **4456** | §4.6 |
| probe4（node）：全部数值锚点按码点列核算 | T3 候选 (1,24)、T11 (1,17)、T12 (1,6)、T13 (1,12)、T14 第 101 个 YMap (1,510) | §5/§10 |

---

## §1 任务定位与最大范围裁决（开放问题 1 — SA2 主攻点）

### 1.1 交付物（两部分，一体交付）

1. **`/** */` 文档注释原文捕获与挂载**：tokenizer 区分文档注释与块注释（含 `/**/` / `/***/` 特例）；doc 原文（`/**` 与终结 `*/` 之间的逐字文本）经 trivia 通道传递，挂载到三类相邻声明性 IR 节点（类型别名 / 属性 / 标记类型）；悬空 doc → **E305**（语义相位新增）。
2. **最小标记语法接受**：grammar 层接受 EBNF `Marker` 产生式全集——五个 Y-标记
   （`YMap` / `YArray` / `YPlainArray` / `YLeaf` / `YXmlFragment`）的 `Ident '<' TypeExpr '>'`
   形态，IR 产出 `marker` 节点。**不带任何 §3 语义约束**（E304 形状 / E307 纯值 /
   E309 混合联合全部留给 #6）。**【R2 · SA2 #2】marker 递归环带统一深度预算（§4.6）。**

两部分不可分割的原因：AC3 要求「标记类型处挂载有正例」，而测试只测公共入口
`parseVfsl`（PRD Testing Decisions）→ 标记挂载正例**必须**让至少一种标记构造通过
解析。SA6 用例 3（`type Audit = /** 审计信息 */ YMap<{ createdBy: string; }>;` 期望
`ok:true` 且 doc 在类型子树内）已经把裁决固化成红灯：不纳入标记语法，AC3 无满足路径。

### 1.2 裁决：为什么是「五个标记全接受」而非「只接受 YMap」

| 方案 | 评估 |
|---|---|
| 只接受 `YMap<…>`（测试唯一用到的标记） | ❌ 人为特例：parser 现状对六标记名走同一分派集合（`parser.ts:288` `v === 'Record' \|\| MARKER_NAMES.has(v)`），拆出 YMap 单独放行 = 为一个 issue 制造不对称行为面；#6 落地其余四个标记时是「E100 → ok:true」的行为翻转（方向合法但完全可避免）＋拆掉特例代码 |
| **五个 Y-标记统一接受（本设计）** | ✅ EBNF `Marker` 产生式本来就是五选一的统一规则（`v1-spec.md:49-53`），一条代码路径、零特例；语义约束一个不做，与 #6 的边界干净正交 |
| 连 `Record<K,V>` / `string & Pattern<…>` / `T[]` 一起接受 | ❌ 越界：这些是 `RecordType` / `PatternType` / `ArrayType` 产生式，属 #6 的「容器与标记类型」主线（其 E306 键约束、pattern 解码、数组 IR 形状都要一并设计），简报开放问题 5 明令排除 |

**行为变化表**（本切片对切片外构造的处理，#5 §8 策略的增量更新）：

| 构造 | #5 行为 | **#7 行为（本设计）** | #6 落地后 |
|---|---|---|---|
| `YMap<…>` 等五标记 + `<` | E100「本切片未实现」 | **`ok:true`，IR `marker` 节点**（无形状检查） | 增 E304/E307/E309 语义检查（合法文本不受影响） |
| **五标记嵌套深度 > 100**【R2 · SA2 #2】 | —（构造本身 E100） | **E100 资源上限口径（§4.6 统一深度预算，锚第 101 个标记 Ident 记号）** | 不变（实现上限，v1 生命周期固定） |
| `Record<K,V>` | E100 | E100（不变） | `ok:true` + E306 |
| `string & Pattern<"…">` | E100 | E100（不变） | `ok:true`，IR 增 `pattern` |
| `T[]` 后缀 | E100 | E100（不变） | `ok:true`，IR 增 `array` |
| 裸 `YMap`（无 `<`） | E100（判定顺序第 7 条） | E100（不变，全 v1 终态） | 不变 |
| `/** */` 文档注释 | 忽略（trivia） | **原文捕获 + 挂载 + E305** | 不变（挂载语义已终态） |

「未实现 → 实现」的单向收敛承诺（#5 §1.2）延续：本切片新增的 `ok:true` 面
（五标记）在 #6 只可能被 E304/E307/E309 **收紧**非法形状、不翻转合法文本——
这是路线图的既定方向（同 #5 的 `/** */` 忽略 → 本切片 E305 收紧），非本设计引入的风险。

### 1.3 明确不做（与简报「范围外清单」对齐）

- **不实现**：E304（标记实参形状）、E306（Record 键）、E307（纯值上下文）、E309（混合联合）——全部留 #6；`T[]` / `Record` / `Pattern` 语法；JSDoc `@tag` 结构化解析（ADR-0001：无机器标签，原文保留即终点）；fixture 全量解析（#9）；禁止语法负例矩阵（#8）。
- **不动**：公共接缝 `parseVfsl(text)` 返回形状（PRD #3 冻结口径）；信封解析；`apps/**`。

---

## §2 总体架构：doc 的 trivia 通道（开放问题 4）

### 2.1 分层决策：doc 作为「挂靠在下一真实记号上的侧通道载荷」

```
text ──tokenizer──▶ Token[]（不变：单向流、文本序、延迟错误记号）
                      + 新增：每个 Token 可携带 leadDocs: DocLead[]
                      （紧邻其前的全部 doc，按出现顺序；忽略型注释不占位）
     ──parser────▶ 挂载分派：三个挂载锚位的记号被消费时，其 leadDocs 经
                  claimDocs() 回收上树；其余一切被 next() 消费的记号
                  → 统一记入 dangling 候选（E305）【R2 · SA2 #3：集中式记账】
     ──semantic──▶ E305 候选并入既有 min-position 聚合池；walk 扩展穿透 marker.type
     ──toIR─────▶ VfslAlias.docs / VfslField.docs / marker.docs
```

**为什么 doc 不作为独立 token 进主流**：parser 全部前瞻判定
（`peekPunct('<')`、`peekPunct('}')`、判定顺序第 6/7 条的「后随 `<`」检查等）
以「下一记号」为输入；若 doc 占据主流记号位，每个判定点都要先跳过 doc，
`YMap /** d */ <string>` 这类合法 trivia 位移（注记 9：注释可出现于任意记号边界）
将系统性破坏既有判定逻辑——遗漏一处即产生错误码/锚点回归。侧通道让主流记号流
**与 #5 完全同构**，全部既有判定逻辑零改动。

**「紧随其后（中间仅允许空白与忽略型注释）」的相邻性由构造达成**：空白与
`//`、`/* */` 在 tokenizer 即被丢弃（不产出任何记号），因此「token 流相邻」
⇔「文本相邻 modulo 空白 + 忽略型注释」——规格 §5 挂载规则的相邻性判定不需要
任何专门代码（SA6 用例 5 `/** doc */ // 行注释\n/* 块注释 */ type A` 由构造通过）。

**连续多条 doc**：tokenizer 用 pending 数组累积连续 doc（忽略型注释不中断累积），
一并挂靠同一后续记号，顺序保持出现序（SA6 用例 1）。

### 2.2 DocLead 形状（tokenizer 内部，不导出）

```ts
interface DocLead {
  /** 原文：`/**` 与终结 `*/` 之间的逐字文本（含内部 `*`、缩进、换行、@tag 行） */
  body: string;
  /** E305 锚点：注释起始 `/*` 的行列（规格 §4 总表 E305 行「注释起始」） */
  line: number;
  column: number;
}
```

EOF 记号接收文本尾部仍 pending 的 doc（模块末尾悬空的载体，SA6 用例 4）。

---

## §3 Tokenizer 设计

### 3.1 doc 分类判定（机械规则）

进入既有块注释扫描分支（`tokenizer.ts:107`）后，`/*` 扫描保持现状（首个 `*/`
终结、不嵌套、行/列按码点推进、未闭合 → E203 锚起始 `/*`）。**分类在找到
终结符之后**进行——未闭合路径与 E203 完全不变（开放问题 5 的 E203 覆盖确认：
`/**` 未闭合走的正是这条既有路径，红灯用例 `parse-vfsl-errors.test.ts:133` 持续锚定）。

设注释文本为 `text[open .. close+1]`（`open` = `/*` 起点，`close` = 终结 `*/` 的 `*` 下标）：

```
if text[open+2] !== '*'        → 块注释（忽略，现状）
else if close === open+2       → `/**/`  特例：块注释（空内容），规格 §5
else if close === open+3       → `/***/` 特例：块注释（单星内容），规格 §5
else                           → 文档注释：DocLead { body: text.slice(open+3, close),
                                              line/column = open 处行列 }
```

- `/**/`（4 字符）：`text[open+2]='*'` 且首个 `*/` 恰在 open+2 —— 规格明文特例。
- `/***/`（5 字符）：`text[open+2]='*'`，首个 `*/` 在 open+3（`text[open+3]='*'` 与
  `text[open+4]='/'` 组成终结符）—— 规格明文特例（「单星内容」的块注释）。
- 一般 doc `/** abc */`：body = `" abc "`（`/**` 之后、`*/` 之前，逐字）。
  SA6 用例 1 的 `DOC_ASSET_1 = '\n * vfs3.assets — …\n * @since v1 …\n'` 构造为
  `/**${DOC_ASSET_1}*/` → body === DOC_ASSET_1，逐字往返。
- `/** a */ b */`：首个 `*/` 终结，body = `" a "`（不嵌套，现状语义）。

**body 是原 text 的码元切片（`text.slice`）**：内部 `\r\n`、tab、non-BMP 全部
逐字保留（§5「逐字保留，含内部 `*` 与缩进」；注记 10：注释 char 含行终止）。
注意 body 内的行列推进仍由既有扫描循环按码点维护（R-1 星面字符回归的四用例
不受影响——doc 只是同一循环多记了一个切片）。

### 3.2 leadDocs 挂靠

```text
tokenize:
  pending: DocLead[] = []
  （块注释特例 / 行注释 / 空白：现状，不触碰 pending）
  doc 注释闭合 → pending.push(DocLead)
  产出任一真实记号（ident/string/number/punct/error/eof）时：
    若 pending 非空 → token.leadDocs = pending（同一数组引用，按出现序），pending = []
```

- error 记号同样接收 pending（该记号被读到即以词法码失败，挂载 moot——不丢失、
  不崩坏，docTotal 不变量见 §4.5 对此的会计处理）。
- `Token` 接口新增可选字段 `leadDocs?: DocLead[]`（加法，既有消费者
  `parser.ts` 的全部 `t.kind`/`t.value` 访问不受影响）。

### 3.3 判定依据（协议假设立法的类比适用——本节为行为依据，非协议假设）

| 声明 | 依据 |
|---|---|
| `/**/` / `/***/` 是块注释 | 规格 §5「忽略与捕获的边界」原文（`v1-spec.md:382-384`）；SA6 用例 7 双绿即现状 tokenizer 满足，本设计分类规则是现状行为的显式化 |
| 未闭合 `/**` → E203 锚起始 `/*` | 规格 §4 总表 E203 行 + 注记 9；既有红灯 `parse-vfsl-errors.test.ts:133-138`（`/* foo` → E203@(1,18)）持续锚定 |
| doc 内部行列按码点推进 | #5 R3 R-1 立法 + `parse-vfsl-r3-regression.test.ts` 四用例（本设计不改扫描循环的推进逻辑，仅加切片记录） |

---

## §4 Parser 设计：挂载分派 + 最小标记语法 + 深度预算

### 4.1 AST 扩展（内部，不导出）

```ts
type AstType =
  | … 既有五成员不变 …
  | { kind: 'marker'; name: 'YMap'|'YArray'|'YPlainArray'|'YLeaf'|'YXmlFragment';
      type: AstType; pos: Pos; docs: string[] };

interface AstField  { …; docs: string[] }   // 加法
interface AstAlias  { …; docs: string[] }   // 加法
```

（pos 保留在 marker 节点：#6 的 E304 锚点是「标记记号」，预留与 #5 §5.1 同理。）

### 4.2 挂载分派规则【R2 · SA2 #3：重写为集中式记账立法】

**R2 立法：dangling 记账统一在 `next()` 内执行；M1/M2/M3 锚位在消费时回收（claim）；
EOF 在 parseModule 循环出口显式记账。** R1 的「分散式枚举消费点」被 SA2 #3 击穿——
枚举漏掉 `parseUnionType` 的两处 `|` 记号消费点（`parser.ts:194` 前导 `\|`、
`parser.ts:198` 成员间 `\|`），按枚举实现的分散式记账会把本应报 **E305** 的
`type A = string /** d */ \| number;` 报成 **E100 内部错误**（docTotal 不变量触发）。
集中式把正确性从「枚举完备」转移到「单一收口点」：任何被 `next()` 消费的记号，
其 leadDocs 默认入 dangling，**枚举不可能再漏**——消费点枚举降级为 SA4 静态核对的
参考表（不再是实现依据）。

```ts
// Parser 实例字段（新增）
private dangling: DocLead[] = [];    // E305 候选（DocLead 自带锚点行列）
private depositedByLast = 0;         // 最近一次 next() 记入 dangling 的条数
private claimed = 0;                 // 已回收上树条数（docTotal 核对用，§4.5）

private next(): Token | undefined {
  const t = this.tokens[this.index];
  if (t === undefined) return undefined;
  this.index += 1;
  if (t.kind === 'error') throw this.errFromToken(t);   // error 记号：读到即抛，不记账
  this.depositedByLast = t.leadDocs?.length ?? 0;       // 每次消费重置
  if (this.depositedByLast > 0) this.dangling.push(...t.leadDocs!);
  return t;
}

/** 挂载锚位专用：回收「刚消费记号」存入 dangling 的 leadDocs（取出 body 数组）。 */
private claimDocs(): string[] {
  const n = this.depositedByLast;
  this.depositedByLast = 0;
  this.claimed += n;
  return this.dangling.splice(this.dangling.length - n, n).map((d) => d.body);
}
```

**同步性约束**（SA4 静态核对锚点）：`claimDocs()` 必须在锚位记号被 `next()` 消费
之后、**任何下一次 `next()` 之前**调用（否则 `depositedByLast` 已被后续消费重置）。
因此回收一律紧跟消费点，且 `claimDocs()` 全 parser 恰三个调用点（M1/M2/M3）。

**三锚位（穷尽）——携带 leadDocs 的记号被消费时的处置**：

| # | 消费点 | 判定 | 回收位置（紧跟消费，同步性约束内） |
|---|---|---|---|
| M1 | `parseModule` 循环顶 peek Ident `type` → next() | 模块层声明起点 | `const docs = this.claimDocs()` 紧跟 `this.next()`（现状 `parser.ts:150`），传入 `parseTypeAlias(declIndex, docs)` → `AstAlias.docs` |
| M2 | `parseObjectType` 字段名位 next() 得 Ident | 属性声明起点 | `const docs = this.claimDocs()` 紧跟 `const nameTok = this.next()`（现状 `parser.ts:361`），`fields.push` 时上 `AstField.docs` |
| M3 | `parseIdentType` marker 分支（Ident 已由 `parsePrimaryType` 顶部的 next() 消费） | 标记记号起点 | marker 分支顶 `const docs = this.claimDocs()`——`parsePrimaryType` 的 `case 'ident': return this.parseIdentType(tok)` 直通进入，**中间零次 next()**，`depositedByLast` 未被重置（同步性成立） |

**EOF 位**：`parseModule` 循环出口 peek 到 eof 记号时显式记账（把 eof.leadDocs
并入 dangling）后 break——EOF 是正常返回路径上**唯一**不经 `next()` 消费的记号
（`parser.ts:147` 现状是 peek 后 break）。SA6 用例 4（模块末尾悬空）由此覆盖。

**核对参考表**（SA4 用；实现依据是上面的集中式规则，本表仅作 next() 调用点盘点）——
现状 + 本设计的 `next()` 全部调用点，其消费记号 leadDocs 的归宿：

| 调用点（现状行号） | 记号 | leadDocs 归宿 |
|---|---|---|
| parseModule `parser.ts:150` | `type` | **M1 回收** |
| parseModule 循环出口（peek eof） | EOF | **显式记账 → dangling**（用例 4 / 空模块） |
| parseTypeAlias `:164 / :177 / :179` | 声明名 / `=` / `;` | dangling（`type /** d */ A = string;` → E305，§5.3 / T12） |
| parseUnionType `:194 / :198` | 前导 `\|` / 成员间 `\|` | dangling（**R2 补全——R1 漏列，SA2 #3**；`type A = string /** d */ \| number;` → E305，T11） |
| parsePrimaryType `:246` | 全部主类型记号 | ident-marker → **M3 回收**；其余（`{`、`(`、字面量、primitive/ref/generic-diag 名 ident、EOF）→ dangling（中间位形态 §5.2 / T1） |
| parseIdentType marker 分支（本设计新增） | `<` / `>` | dangling（`YMap /** d */ <string>` → E305，§5.3） |
| parseObjectType `:356 / :361 / :378 / :384 / :387 / :393` | 空对象 `}` / 字段名 / `?` / `:` / 分隔符 `;``,` / 闭 `}` | 字段名 → **M2 回收**；其余 → dangling（`{ a: string; /** d */ }` 不跨 `}` → E305，T2；空对象 `{ /** d */ }` → E305，T13） |
| parseGenericDiag `:324 / :328` | `<` / 平衡扫描全部记号 | dangling |

peek 但未消费即抛错的路径（`[` → E100 切片未实现、`&` 族、`interface` → E105、
error 记号）：语法相位即抛，被 peek 的记号未消费、其 leadDocs 不进任何账——
parseModule 已抛，不变量不运行，E305 无从浮出（分相位规则的正确归宿，§5.1），
无需专门处置。

### 4.3 最小标记语法（EBNF `Marker` 产生式的 parser 落地）【R2 · SA2 #2：含深度守卫】

`parseIdentType`（`parser.ts:277`）的 marker 分支改造：

```text
v ∈ MARKER_NAMES:
  peekPunct('<') 为真：
    docs ← claimDocs()                        # M3 回收（同步性见 §4.2；无 doc 时为空数组）
    depth += 1                                # §4.6 统一类型嵌套深度预算
    depth > MAX_TYPE_DEPTH →
      E100「嵌套深度超过实现上限 100（实现资源上限，非方言判定；该文本可从 v1 文法推导）」
      锚 = 本标记 Ident 记号 tok（§4.6 锚点定义；抛出即全线 unwind，无需回退）
    try:
      消费 '<'
      arg ← parseTypeExpr()                   # 完整 TypeExpr：联合 / 嵌套对象 / 嵌套 marker
      下一记号 ≠ '>' → E100「标记实参缺右尖括号 '>'」（锚实际记号；EOF 锚 EOF 位）
      消费 '>'
      返回 { kind:'marker', name:v, type:arg, pos:posOf(tok), docs }
    finally: depth -= 1                       # 正常出口深度回退（parseObjectType 同款）
  否则 → E100「裸引用保留名」（判定顺序第 7 条，现状不变）
```

递归下降的自然覆盖（无需专门代码）：

- **嵌套 marker**：`YArray<YMap<{…}>>` —— 内层 marker 消费自己的 `<…>`（含一个
  `>`），外层见到最后一个 `>`。联合解析在 `>` 处自然停止（`>` 不是 `|`）。
- **marker 实参内的引用/对象/联合**：`YMap<{ a: B } | { c: D }>` 正常递归。
- **未闭合**：`type A = YMap<` → parseTypeExpr → parsePrimaryType 在 EOF → 既有
  E100「类型位置缺记号（文件末尾）」。
- **`[]` 后缀在实参内**：`YMap<string[]>` → parsePostfixType 既有 E100（#6 领地，
  不变）。
- **generic-diag 不受影响**：marker 名是保留名，走 marker 分支，永不落入第 6 条
  的 generic-diag 构造（`parser.ts:309` 的非保留名前置条件不变）。

### 4.4 E305 的悬空候选传递

`parseModule` 返回值从 `AstAlias[]` 扩展为内部结构（不导出，非公共契约）：

```ts
interface ParseResult { aliases: AstAlias[]; dangling: Array<{ line: number; column: number }> }
```

`index.ts` 编排改为 `const { aliases, dangling } = parseModule(tokens)` →
`analyze(aliases, dangling)`。语义相位把每条 dangling 记为 E305 候选（§6）。

### 4.5 docTotal 不变量（loud assert——静默丢失在构造上不可能）【R2 · SA2 #3：集中式会计重述】

**立法背景**：本 issue 的存在理由就是「doc 被静默丢弃」（简报现状实测证据三行
🔴 全是静默吞掉）。因此「任何一条 doc 既未挂载也未记为悬空」必须是被构造排除的
缺陷类，而不是靠小心。

**集中式记账下的会计**（R2）：

```text
parser 构造时：docTotal = Σ tokens[i].leadDocs?.length（全量记号一次算好）
parseModule 正常返回前：assert this.claimed + this.dangling.length === docTotal
  违反 → throw new Error('internal: doc 记账不平衡')
       → index.ts 顶层兜底 catch → E100「内部错误（意外异常）」
```

- **由构造成立的论证**：正常返回路径上，全部记号恰被消费一次（parseModule 循环
  扫到 EOF；嵌套解析器的所有非抛错路径都把记号经 `next()` 消费），唯一例外 EOF
  在循环出口显式记账（§4.2）——每个 leadDoc 要么被 `next()` 记入 dangling、要么
  被 M1/M2/M3 的 `claimDocs()` 回收（splice 移出 dangling），**不存在第三种去向**。
  assert 是构造性保证之外的防线（#5 §15.4 同款定性：崩溃边界转化，命中即实现缺陷，
  SA4/SA7 不得视为通过）。
- **词法 error 记号路径的会计一致性**：`next()` 对 error 记号先抛后不记账；现状
  tokenize 在产出 error 记号后 `break scan` 并补 EOF（`tokenizer.ts:141-144` /
  `:250` 实证）——error 记号存在 ⇒ parseModule 必抛（模块层循环顶读到即抛
  `parser.ts:148` / 类型位读到即抛）⇒ 不变量检查不运行。不变量只在正常返回路径
  上执行，且在该路径上永远可达且平衡。

### 4.6 marker 嵌套资源界——统一类型嵌套深度预算【R2 新增 · SA2 #2（HIGH）】

**问题**：§4.3 引入 marker 分支后，`parseIdentType →(marker) parseTypeExpr →
parseUnionType → parsePostfixType → parsePrimaryType → parseIdentType` 成为新的
**五函数互递归环**——#5 §15.2 完备性论证的关键前提「parseObjectType 是唯一使
parseTypeExpr 递归的入口」（`parser.ts:9-11` 头注释原文）就此为假。`Marker` 产生式
天然递归（`Marker = Ident '<' TypeExpr '>'`），`type A = ` + `YMap<`×N + `string` +
`>`×N + `;` 可从文法推导——SA2 同构模拟实测 **≈2343 层爆栈，对应输入仅 ≈11.7KB**。
爆栈 → RangeError → `index.ts` 顶层兜底 → E100「内部错误（意外异常）」——而 #5 §15.4
与本设计 §4.5 均明文定性「该路径命中 = 实现缺陷」：SA7 深嵌套探针（T14）将确定性
命中被设计自己定义为缺陷的路径。次生问题：即便 parser 迭代化，IR 深度 = marker
嵌套深度，`JSON.stringify` 深度上限实测 ≈4456（#5 R2；R2 复测 4466）——预算不可避免
（#5 R2 已论证「序列化上限证伪纯迭代化路线」）。

**实测基线**（R2 设计期，probe2/probe3；方法对齐 #5 R2「同构模拟 + 取保守值」）：

| 项 | 测值 | 采用 |
|---|---|---|
| marker 五函数环爆栈深度 | SA2 同法实测 ≈2343 层；SA1 R2 极简帧同构模拟 60415 层（帧载荷远小于真实 parser 函数，仅证明无界性） | **保守基线 2343 层** |
| 对象环爆栈深度（对照） | #5 R2：SA1 2912 / SA2 3129 | 保守 2912（#5 既定基线，不动） |
| `JSON.stringify` 深度上限 | #5 R2 ≈4456；R2 复测 4466 | **保守 4456** |

**决策：统一计数器**（对象 `{` 与 marker 入口共用一个深度预算），否决独立
`MAX_MARKER_DEPTH`：

| 方案 | 评估 |
|---|---|
| **统一预算（采纳）** | 一个不变量（「使 parseTypeExpr 递归的入口必先 depth+1、出口 -1」，入口恰两个：parseObjectType 与 marker 分支），一处守卫模式（与 `parseObjectType` 现状逐字同构），SA4 静态核对面最小；最坏 IR JSON 深度仍由对象嵌套主导（每对象 schema 层 ≈4 JSON 层 vs marker ≈2），序列化余量与 #5 完全相同（见下） |
| 独立 `MAX_MARKER_DEPTH`（否决） | (1) **序列化余量违标**：两预算可同时到顶——100 对象 + 100 marker 交错嵌套（`YMap<{ a: YMap<{ …` 型）= 200 schema 层 → ≈100×4 + 100×2 = 600 JSON 层 → 4456/600 ≈ **7.4× < 10× 违标**；为守标准须压低其一——压对象预算 = 改变 #5 已冻结的「100 层对象 ok:true」行为面（#5 §16 T3 构想的 N=100 正例；T15 将锁死该行为），压 marker 预算则两上限不对称且无规格依据；(2) 完备性论证要覆盖两个计数器的全部进出点，SA4 核对面翻倍；(3) v1 现实 schema（fixture ≈3 层）两个方向都触不到预算，独立预算零用户可见收益 |

**机制**（与 `parseObjectType` 的既有守卫逐字同构，§4.3 伪代码）：

```text
常量：MAX_TYPE_DEPTH = 100   —— 由 MAX_OBJECT_DEPTH 更名（纯重构：值不变、
      守卫位置不变（对象入口原样）、仅语义扩为「类型嵌套总深度」）
承诺：#5 §15.2「v1 生命周期内不得调升/调降」对更名后的常量原样延续；
      变更须回总控走设计修订（SA3 不得自行改值）
超限：E100，消息沿用 #5 §15.2 三态口径原文：
      「嵌套深度超过实现上限 100（实现资源上限，非方言判定；该文本可从 v1 文法推导）」
锚点：预算耗尽处的标记 Ident 记号（第 101 个 YMap/YArray/… 记号）
```

**锚点依据**：与既有「锚预算耗尽处 `{` 记号」同构——预算在第 N+1 个构造**入口**
触发，锚该构造的起点记号；marker 构造的起点记号 = 标记 Ident（其 `<` 是实参开口，
在文本序上更靠后）——取 Ident 恰合 E100 冻结锚「构造起点记号」且满足「文本序首个
错误胜出」的锚位最小性。

**余量复算**（对齐 #5 R2 标准：栈 ≥5×、序列化 ≥10×；帧数 × 层数口径）：

- **栈**：每 marker 嵌套层 = 5 帧（parseIdentType / parseTypeExpr / parseUnionType /
  parsePostfixType / parsePrimaryType）。统一预算下最坏 100 层 ≈ 500 帧；保守爆栈
  基线 2343 层（marker 环）≈ 11715 帧 → 余量 **2343/100 = 23.4×**（对象环 2912/100
  = 29.1×，取更保守的 marker 环口径）✓ ≥5×
- **序列化**：统一预算封顶**总**嵌套 100 层，最坏 IR JSON 深度 = 100 对象层 × ≈4
  JSON 层（object→fields→field→type，#5 口径）≈ 400 ≪ 4456 → 余量 **11.1×**
  （marker 层 ≈2 JSON 层只会更浅；交错嵌套的总层数被同一预算封死，不可能出现
  400+200 的独立预算最坏组合）✓ ≥10×
- **现实面**：fixture ≈3 层，合法文本触碰上限概率可忽略；预算边界行为由 T14（marker
  双侧）/ T15（对象双侧）红灯上锁。

**头注释递归环声明更新**（SA3 执行，SA2 #2(c)）：`parser.ts:9-11` 改写为——
「资源界（#5 §15.2 → #7 R2 §4.6）：使 parseTypeExpr 递归的入口有**两个**——
parseObjectType（`{`）与 parseIdentType 的 marker 分支（五标记 `<`）——共用统一
类型嵌套深度预算 `MAX_TYPE_DEPTH = 100`（原 MAX_OBJECT_DEPTH 更名，值与 v1 承诺
不变）；联合成员在 while 循环内逐个解析即返回不叠栈、字面量/原始/ref 是叶子、
generic-diag 平衡扫描是循环；超限 → E100 资源上限口径，锚预算耗尽处构造起点记号
（`{` / 标记 Ident）。v1 生命周期内不得调升/调降。」

**既有测试零冲突实证**：`grep -rn "repeat(\|实现上限\|资源上限" packages/vfsl/test/*.test.ts`
零命中——#5 §16 T1/T3 深度探针为构想**未落库**，测试库无任何深度预算行为断言；
既有 37 + SA6 7 用例输入无任何标记拼写（SA2 R1 已 grep 实证）——更名与统一不触碰
任何既有断言。T14/T15 把预算双侧行为补上红灯锁（§10）。

---

## §5 E305 判定与相位（开放问题 3）

### 5.1 相位裁决：语义相位（模块全量解析成功后，min-position 聚合）

规格 §4「错误数量与恢复策略」（`v1-spec.md:270-272`）：词法/语法相位
（E100~E105、E201~E203、声明名位 E303）在遇到处即时失败；「仅当模块**全量解析
成功**，才进入引用/语义相位（E106 与 E301 / E302 / **E304~E309**）」——E305 在
E304~E309 区间记法内，属语义相位。

简报提示的「E305 不在『模块全量解析后判定』清单内」指向的是 `v1-spec.md:329`
的另一份清单：「该**解析时机**条款同样适用于 E301 / E304 / E306 / E307 / E309」
——该条款说的是**别名解析与声明顺序无关**（需要跨别名终判）的错误。E305 与
E302 / E308 同被排除，因为它们**逐位置即可判定、不依赖别名解析**——这决定
E305 在语义相位内是平凡收集的候选（不需要声明名集合），**不改变它所在的相位**。

**仓库先例**：E302（重复声明）与 E308（字段重名）同样不在 `v1-spec.md:329`
清单内、同样逐位置可判定，且同样以语义相位候选实现于 `semantic.ts`（#5 交付，
经 SA2 R2 / SA4 / SA7 三层评审通过）。E305 沿用同一模式——两份清单各归其位，
无矛盾。

可观察差异示例（相位选择的判别输入，与 §10 T3/T4 完全对齐；锚点经 probe4
码点核算）：`type A = Foo; type B = /** d */ string;` —— E301（Foo）@(1,10) 与
E305 候选@(1,24)【R2 · SA2 #4：R1 误写 (1,28)——28 是 `d` 的列，doc 起始 `/` 在
第 24 列】并存：语义相位内 min-position 胜出 → **E301@(1,10)**。若（错误地）把
E305 放在语法相位即时失败，将报 E305@(1,24)——违反「相位内取文本位置最前」的
既有聚合语义。另一例：`type A = /** d */ string; type B = any;` —— 语法相位在
`any` 即时失败（E101@(1,36)），模块未全量解析 → E305 候选 (1,10) 不浮出 →
**E101 胜出**（相位优先于位置，#5 §3.2 既有原则）。

### 5.2 相邻性判定：严格相邻（挂不上 = 悬空 = E305）

挂载条件 = doc 挂靠的下一真实记号是**其语境中的声明性起点**（M1/M2/M3 三锚位）。
否则该 doc 悬空 → E305。推论：

- **中间位形态** `type A = /** d */ string;`：doc 挂靠 `string` 记号，非 marker →
  E305 锚 doc 起始（本设计显式冻结此未冻结角落——规格 §5「紧随其后（中间仅允许
  空白与忽略型注释）」的文义读法：`string` 不是声明性节点，挂载失败；而「若直到
  模块末尾都没有可挂载节点」在严格相邻下自然成立——挂载失败 ⇒ 永不再有挂载机会）。
- **对象内尾位** `{ a: string; /** d */ }`：doc 挂靠 `}` → 悬空 E305（**不**跨
  `}` 挂到下一个别名——`}` 不是「空白与忽略型注释」，相邻性已断；跨界挂载对
  作者语义是更大的背叛）。
- **模块末尾** `type A = string;\n/** 悬空 */`：EOF 携带 doc → E305 锚 (2,1)
  （SA6 用例 4 的冻结形态）。
- **多条连续悬空**：逐条各为候选（各自锚自己的起始），min-position 取最前者。

**为什么不选「向前扫描到下一个可挂载节点」**：会把 `{ a: string; /** d */ }`
的 doc 挂到后续无关别名上——比丢弃更危险的错挂（作者语义被安到别人身上）；
且与「紧随其后」的冻结文义冲突。严格相邻 + 响亮拒绝（E305）是「单一真相源不容
丢失」（§5 挂载规则原文）在未冻结角落上的最小忠实读法。

### 5.3 挂载与判定的完整示例表

| 输入 | 行为 | 依据 |
|---|---|---|
| `/** d1 */ /** d2 */ type A = string;` | `A.docs = [d1, d2]`（出现序） | §5 连续同挂 |
| `type A = string; /** d */ type B = number;` | `B.docs = [d]` | M1 |
| `{ /** d */ notes?: string }` | `notes.docs = [d]` | M2 |
| `type Audit = /** d */ YMap<{ createdBy: string; }>;` | marker 节点 `docs=[d]`（别名 Audit 自身 docs=[]），类型子树内可见 | M3（SA6 用例 3） |
| `YMap<{ /** d */ createdBy: string }>` | 字段 createdBy 挂载（marker 实参内的对象字段位，M2 递归适用） | M2 |
| **`type /** d */ A = string;``**【R2 · SA2 #6a】 | **E305 锚 (1,6)**——doc 挂靠声明名记号 `A`；M1 锚的是 `type` 关键字记号，声明名位不是挂载锚位（「挂载到别名声明处」的直觉在此形态不成立） | §4.2 核对表 / T12 |
| **`type T = { /** d */ };``**【R2 · SA2 #6b】 | **E305 锚 (1,12)**——空对象早退路径消费的 `}` 记号携带 doc，非声明性起点（不跨 `}` 挂后续、不静默吞） | §4.2 核对表 / T13 |
| `type A = /** d */ string;` | **E305** 锚 (1,10) | §5.2 中间位 |
| `type A = /** d */ { x: string };` | **E305**（`{` 非声明性起点） | §5.2 |
| `YMap /** d */ <string>` | **E305**（doc 挂靠 `<`；不在标记**记号**之前） | §5.2；注记 9（trivia 合法位）与挂载位（记号前）正交 |
| `type A = Foo \| /** d */ number;` | **E305**（联合第二成员前，非 marker） | §5.2 |
| `type A = string /** d */ \| number;` | **E305 锚 (1,17)**——doc 挂靠成员间 `\|` 记号【R2 · SA2 #3：R1 示例表漏此形态，与 §4.2 枚举同源缺口】 | §4.2 核对表 / T11 |
| `/** d */`（空模块仅一条 doc） | **E305** 锚 (1,1) | §5.2（EOF 载体） |

---

## §6 语义相位设计

### 6.1 `analyze(aliases, dangling)` 的增量

1. **E305 候选**：`for (const d of dangling) candidates.push(candidate(makeIssue(ErrCode.E305,
   '悬空文档注释：未紧邻可挂载的声明性节点（类型别名 / 属性 / 标记类型），且不相邻即不再挂载',
   d.line, d.column), 305))`。【R2 · SA2 #5：措辞由 R1 的「其后无可挂载的声明性节点」
   改为「未紧邻」口径——严格相邻语义下，`type A = /** d */ string; type B = number;`
   的 doc 之后模块内明明存在可挂载节点 B（只是不相邻），R1 措辞对此类输入事实性
   不成立，会误导排障者。前缀 `VFSL-E305: ` 是冻结项，正文措辞不冻结（规格 §4）。】
   与既有候选共用 §6.2（#5 设计）min-position 聚合——`(line, column, 错误码数值)`
   最小者胜出。E305 锚「注释起始」由 DocLead 自带。
2. **walk 扩展**（E301 / E106 边收集 / generic-diag 终判 / E308 共用遍历）：
   ```ts
   else if (t.kind === 'marker') { walk(t.type, visit); }
   ```
   ——marker 实参内的 `ref` 进 E301 检查与 E106 引用图边（规格 §4「递归与循环引用
   检测」：引用边来自「Marker 实参」明文列举）；实参内对象进 E308。
   例：`type A = YMap<{ a: A }>` → E106 自环；`type A = YMap<{ b: B }>`（B 未声明）
   → E301。
3. **E304/E307/E309 不做**：#6 领地。本切片 `YMap<string>`、`YPlainArray<YMap<…>>`、
   `{a:string} | number` 内含 marker 的组合一律按语法结果接受（§1.2 行为表）。

### 6.2 AST → IR（`toIR` / `toIRType` 增量）

```ts
alias  → { kind:'alias', name, docs: a.docs, type: toIRType(a.type) }
field  → { kind:'field', name, optional, docs: f.docs, type: toIRType(f.type) }
marker → { kind:'marker', name: t.name, docs: t.docs, type: toIRType(t.type) }
```

属性插入顺序固定如上（kind → name → [optional] → docs → type）——`JSON.stringify`
按插入序输出，序列化形确定（内容哈希前提；#5 §7.3 同款考虑）。

---

## §7 IR 形状（开放问题 2）

### 7.1 类型定义增量（`ir.ts`）

```ts
export interface VfslAlias { kind: 'alias'; name: string; docs: string[]; type: VfslType }
export interface VfslField { kind: 'field'; name: string; optional: boolean; docs: string[]; type: VfslType }

export type VfslType =
  | … 既有五成员不变 …
  | { kind: 'marker'; name: 'YMap' | 'YArray' | 'YPlainArray' | 'YLeaf' | 'YXmlFragment';
      docs: string[]; type: VfslType };
```

### 7.2 设计决策与理由

| 决策 | 理由 |
|---|---|
| 字段名 `docs` | **#5 设计 §7.3 已公开预留的扩展点名**（「未来各节点追加 `docs: string[]`（原文数组，连续文档注释按序）」）——沿用即兑现既有承诺，避免两份设计文档对同一扩展点使用两个名字 |
| `string[]`（有序集合）而非单条拼接 string | 规格 §5「连续多个文档注释**按出现顺序**全部挂载到同一后续节点」→ 顺序是有冻结语义的维度；数组保序、消费者可区分条目。SA6 用例 1 的 `indexOf` 先后断言对数组天然成立（对拼接 string 也成立，但数组不需要人为定界符，无歧义） |
| **必填**（无 doc 时 `docs: []`），不用 `docs?: string[]` | (1) 仓库风格先例：`exactOptionalPropertyTypes` 下 `VfslField.optional` 用必填 boolean（`ir.ts:31` 自注）；(2) 可选字段在 TS 严格模式下带来 `{docs: undefined}` 赋值陷阱与 JSON 往返的键存在性歧义；(3) 形状固定 ⇒ 序列化确定 ⇒ 内容哈希稳定 |
| 只挂三类节点（alias / field / marker），不给 primitive/ref/object/union 挂 | 规格 §5 挂载位置**穷尽列举三类**；doc 挂在非声明节点前是 E305 而非新挂载位（§5.2）——扩大挂载面 = 发明规格外行为 |
| marker 用单节点 + `name` 字段（五个拼写原样），不拆五个 kind | (1) 先例：`primitive` 同构（一个 kind + 固定枚举 name）；(2) EBNF `Marker` 产生式五选一统一，五个成员的 IR 结构（name + 实参 + docs）完全同构；(3) name 保留源拼写（`YMap`）——CONTEXT.md「大小写是契约」，IR 对源文本诚实，#6 的形状分类直接 switch name，无需反向大小写映射 |
| `name` 无碰撞风险 | `ref.name` 不可能是五个标记拼写（保留名不可作别名声明，E303 已拒绝） |

### 7.3 零破坏性核对（既有 37 用例 + SA6 7 用例）

- **既有用例**：已逐文件重读三份测试——无 IR 精确形状断言（`toEqual` 仅用于
  「有无比对」两个新形状互比、JSON 往返自等），无 `/**` 输入。所有输入不含 doc
  → 全部 `docs: []`，`toContain` / 往返 / 互比全部不受影响。
- **SA6 用例 2/3/5**（doc 原文无控制字符、无引号）：`JSON.stringify` 后
  `toContain(docBody)` 可满足——序列化不改变这些原文的可匹配性。**SA6 用例 1
  （原文含换行与引号）的序列化断言机制不可满足，见 §7.4 登记——其「修绿」以
  SA6 回炉修正断言为前置条件。**【R2 · SA2 #1：R1 此处「✅」为未推演断言机制的
  错误验证，已更正】** 用例 6/7 互比两侧均 `docs: []`（`/**/` `/***/` 是块注释）✅；
  用例 4 E305 前缀 + (2,1) ✅。
- **JSON 序列化**：docs 是 string[]（纯数据），`expectJsonRoundTrip` 深等 ✅
  （IR 深度受 §4.6 预算界定，最坏 ≈400 JSON 层 ≪ 4456）。
- **内容哈希**：既有文本的 IR 序列化形变化（新增 `"docs":[]`）→ 哈希变化。这由
  #5 §1.1 已登记的边界条件覆盖（缓存 key 必须绑语义里程碑，不能仅文本哈希）；
  本任务版本 bump 0.1.2 即里程碑标识。

### 7.4 SA6 用例 1 断言机制缺陷登记与处置【R2 新增 · SA2 #1（CRITICAL）】

**缺陷**：SA6 用例 1（`parse-vfsl-jsdoc.test.ts:70-85`）断言
`expect(JSON.stringify(aliasNode(module,'AssetId'))).toContain(DOC_ASSET_1)`。
`DOC_ASSET_1` 含**真实换行符**（`'\n * vfs3.assets — …\n'`）、`DOC_ASSET_2` 含
**真实双引号**（`禁 "." 与 "|"`）。`JSON.stringify` 必然把换行转义为 `\n` 两字符、
引号转义为 `\"`——序列化输出**结构上不可能包含**原始换行/引号子串。该缺陷对
PRD #37 允许的全部 IR 形状（string[] / 拼接 string / 任意字段名）同样不可满足
（除非破坏「逐字保留」本身）；不含控制字符/引号的 `DOC_FIELD`（用例 2/3/5 形态）
不受影响。

**R2 实测证据**（probe1，模拟合规 IR `docs: [D1, D2]`）：

```text
[现状断言] raw toContain D1 = false        ← 序列化转义击穿
[现状断言] raw toContain D2 = false
[现状断言] raw indexOf order = false       ← indexOf 双 -1，-1 < -1 为假
[修正(b)] esc toContain D1 = true | D2 = true
[修正(b)] esc indexOf order = true
[修正(b)] 兄弟不可见 = true true
[修正(b)] 拼接 string 形状 = true          ← 对 PRD #37 形状自由度兼容
[修正(b)] 含界定符存储 = true              ← 双向兼容（简报记录的口径）
[修正(b)] doc 丢失红态 = toContain 失败: true | order 判假: true   ← 红态判别力保持
```

**后果链**：SA3 在 TDD 修绿阶段被结构性卡死（§12 明令 SA6 owned 不可改断言），
或被迫违规改测试——验收契约「44/44 全绿」永不可达（§9.2/§10 的用例 1 🟢 预测
同步作废，已更正）。

**处置路径（流程授权：红灯测试回炉一轮，SA6 拥有执行，设计定方向）**：

- **选定方向 (b)：保留序列化断言，断言 `JSON.stringify` 的转义形**
  （`JSON.stringify(DOC).slice(1, -1)`）。修正后断言：

  ```ts
  const e1 = JSON.stringify(DOC_ASSET_1).slice(1, -1);   // '\n * vfs3.assets — …' 的转义形
  const e2 = JSON.stringify(DOC_ASSET_2).slice(1, -1);   // 含 \" 的转义形
  expect(assetId).toContain(e1);
  expect(assetId).toContain(e2);
  expect(assetId.indexOf(e1)).toBeLessThan(assetId.indexOf(e2));   // 出现顺序
  expect(other).not.toContain(e1);                                 // 兄弟别名不可见
  expect(other).not.toContain(e2);
  ```

- **不选方向 (a)（类型化取出 `docs[0]` 后 `toBe`）的理由**：(1) 与测试文件自述
  契约直接冲突——文件头与简报 SA6 记录均声明「不锁定 doc 载荷字段名与集合形状
  （PRD #37 实现自由度）」，`docs[0]` 必须知晓字段名且锁定数组形状；(2) 丢失
  「双向兼容」（SA3 若保留含界定符的完整原文，`toBe(body)` 失败，而 (b) 实测通过）；
  (3) (b) 是断言侧的机械变换，**被测文本的换行/引号形态原样保留**（SA2 红线 #1
  的硬要求：删的是断言的序列化比对方式，不是被测原文）。
- **判别力核对**（三维度全保留）：多行原文逐字（含 `\n`、内部 `*`、`@since` 行）
  由 e1/e2 toContain 锚定；出现顺序由转义形 indexOf 锚定（doc 丢失时双 -1 →
  判假 → 保持红）；兄弟不可见由 `other` 断言锚定。修正前先红（现状 doc 丢弃）、
  SA3 落地后转绿。
- **授权边界**：仅用例 1 的断言机制（五条断言的比对口径）可改；被测输入文本、
  doc 原文常量、其余六条用例一律不动；SA3 仍不可改任何断言。修正由 SA6 执行
  （其测试文件其所有权），修正记录回写简报 SA6 节。

---

## §8 错误码实现范围清单（开放问题 5）

### 本任务新增实现（1 个）

| 码 | 实现位 | SA6 红灯 | 锚点 |
|---|---|---|---|
| **E305** | parser 悬空记账 → semantic 候选池 | ✅ 用例 4（@(2,1)） | 注释起始（DocLead.line/column） |

### 明确延后（4 个，全部留 #6）

| 码 | 依赖构造 | 延后理由 |
|---|---|---|
| E304（标记实参形状） | 五标记实参的形状分类 | 简报明令「必须留给 #6，不得提前偷做」；本切片 marker 实参接受任意 TypeExpr |
| E306（Record 键） | `Record<K,V>` 语法 | Record 语法仍 E100（#6） |
| E307（纯值上下文） | `YPlainArray` 子树语义 | 同 E304：需 §3 三分类 machinery，#6 主线 |
| E309（混合联合） | 联合成员形状分类 | 同上 |

### E203 对新 doc 形态的覆盖确认

`/** …` 未闭合走既有块注释扫描的 `!closed` 分支（`tokenizer.ts:141-144`）→
E203 锚起始 `/*`——doc 分类只在**找到终结符之后**进行（§3.1），未闭合路径与
#5 完全一致。既有红灯 `parse-vfsl-errors.test.ts:133`（`/* foo` → E203@(1,18)）
持续锚定；`/**` 前缀的同路径行为由同一代码分支保证（SA6 未写专用用例，§10 构想 T5）。

---

## §9 SA3 实现注意（TDD 与类型严格模式）

1. **修绿顺序建议**：`errors.ts`（+E305 一行；**同步更新注册表注释**：14 个 →
   15 个、延后清单由「E304~E307/E309」改为「E304/E306/E307/E309」——区间记法
   E304~E307 已含 E305，不再成立【R2 · SA2 #7】）→ `ir.ts`（类型增量）→
   `tokenizer.ts`（doc 分类 + leadDocs）→ `parser.ts`（AST + 集中式记账/claim +
   marker 语法 + **深度守卫与 MAX_TYPE_DEPTH 更名 + 头注释递归环声明更新**【R2 ·
   SA2 #2】+ dangling + docTotal 不变量）→ `semantic.ts`（walk 扩展 + E305 候选 +
   toIR）→ `index.ts`（parseModule 返回形状适配）→ `pnpm typecheck` → `pnpm test`。
2. **验收判读**：`pnpm test` 44/44 全绿（37 既有 + 7 SA6）——**前置条件：SA6 用例 1
   断言修正（§7.4）已回炉完成**；修正落地前 43/44（用例 1 保持红）是合法中间态，
   SA3 不得为凑全绿自行改断言【R2 · SA2 #1】。
3. **TS 严格模式**：沿用 #5 §10.2 全部纪律（`noUncheckedIndexedAccess` /
   `exactOptionalPropertyTypes` / `verbatimModuleSyntax` / `.js` 后缀 import）。
   `leadDocs?: DocLead[]` 读取一律 `tok.leadDocs ?? []`。
4. **零运行时依赖**：不引入任何 import；`package.json` 仅动 `version`（§15）。
5. **禁止事项**：不得为修绿改任何既有断言（37 用例语义不动；SA6 用例 1 的修正由
   SA6 按回炉授权执行，非 SA3）；不得给 E305 之外的新位置发明挂载；不得实现
   E304/E307/E309 的任何子集（#6 领地，偷做 = SA4 scope creep）；**不得调升/调降
   `MAX_TYPE_DEPTH`**（§4.6 承诺；变更须回总控走设计修订）。
6. **tokenizer doc 扫描的行列推进**：复用既有循环体（含 `c > 0xffff ? 2 : 1` 码点
   推进），只加 `body` 切片记录——R3 R-1 星面回归四用例是本改动的直接回归锚。
7. **docTotal 不变量**：`parseModule` 返回前执行；throw 普通 `Error`（非
   VfslSyntaxError）→ 走 index.ts 顶层兜底 → E100「内部错误」。命中即缺陷。
8. **深度预算**【R2 · SA2 #2】：`MAX_OBJECT_DEPTH` → `MAX_TYPE_DEPTH` 是纯更名
   （值 100 不变、对象入口守卫原样）；marker 分支守卫与 `parseObjectType` 逐字
   同构（`depth += 1` → 超限抛 → `try/finally` 回退）；两个入口共用 `this.depth`
   字段。SA4 静态核对锚点：「使 parseTypeExpr 递归的入口恰两个，均已守卫」。

---

## §10 SA6 用例对照 + 补测构想（非阻塞）

| SA6 用例 | 本设计落点 | 预期修绿后 |
|---|---|---|
| 1 连续两条 doc 同挂 AssetId | §3.2 pending 累积 + M1；**断言机制需 SA6 回炉修正（§7.4 方向 (b)）** | 🟡 **待 SA6 修正断言后修绿**（修正前红态合法，§9.2）【R2 · SA2 #1】 |
| 2 属性位 notes | M2 | 🟢 |
| 3 标记位 YMap + doc 在类型子树 | §4.3 marker 语法 + M3 | 🟢 |
| 4 悬空 E305@(2,1) | EOF 载体 + §6.1 候选 | 🟢 |
| 5 忽略型注释不破坏相邻 | §2.1 构造达成 | 🟢 |
| 6 有无比对 IR 一致 | docs:[] 两侧一致 | 🟢（已绿） |
| 7 `/**/` `/***/` 边界 | §3.1 特例 | 🟢（已绿） |

补测构想（供 SA6，`[SA6 owned]`；全部数值锚点经 probe4 脚本按码点列核算——#5 R2
「锚点一律脚本核算」立法，探针命令与输出见设计过程记录）：

| # | 输入 | 期望 | 锚点 |
|---|---|---|---|
| T1 | `type A = /** d */ string;` | E305 | (1,10) |
| T2 | `type T = { a: string; /** d */ };` | E305（对象内尾位，不跨 `}` 挂后续别名） | (1,23) |
| T3 | `type A = Foo; type B = /** d */ string;` | **E301 胜出**（相位内 min-position；E305 候选在 (1,24) 落选） | E301@(1,10) |
| T4 | `type A = /** d */ string; type B = any;` | **E101 胜出**（相位优先于位置；E305 候选 (1,10) 因模块未全量解析不浮出） | E101@(1,36) |
| T5 | `type A = string; /** d` | E203（未闭合 doc） | (1,18) |
| T6 | `type A = YMap<YMap<{ x: string }>>;` | ok:true（嵌套 marker 递归） | — |
| T7 | `type A = YMap<{ a: A }>;` | E106（marker 实参内引用图边） | 再入 `A`@(1,20) |
| T8 | `type A = YMap<string` | E100（EOF 缺记号，既有消息族） | EOF 位 |
| T9 | `type A = /** d1 */ /** d2 */ YMap<string>;` | marker.docs=[d1,d2] 且 ok:true（marker 位连续 doc） | — |
| T10 | `type Audit = YMap<{ createdBy: string; }>; type X = YMap<Audit>;` | ok:true（本切片无 E304；#6 后收紧为 E304——行为翻转已登记 §1.2） | — |
| **T11**【R2 · SA2 #3】 | `type A = string /** d */ \| number;` | E305（doc 挂靠成员间 `\|` 记号；分散式漏记账实现必报 E100 内部错误或静默吞——两种错误实现均必红） | (1,17) |
| **T12**【R2 · SA2 #6a】 | `type /** d */ A = string;` | E305（doc 挂靠声明名记号；错挂到别名 A 的实现必红） | (1,6) |
| **T13**【R2 · SA2 #6b】 | `type T = { /** d */ };` | E305（空对象早退路径的 `}` 记号；跨 `}` 挂后续声明或静默吞的实现必红） | (1,12) |
| **T14**【R2 · SA2 #2】 | `'type A = ' + 'YMap<'.repeat(N) + 'string' + '>'.repeat(N) + ';'`，N ∈ {100, 5000, 20000} | N=100：ok:true + JSON 往返深等（预算内 100 ≤ MAX_TYPE_DEPTH；IR ≈100×2 JSON 层，安全域）。N=5000/20000：`expect(() => parseVfsl(text)).not.toThrow()`；ok:false 恰 1 条，`/^VFSL-E100: 嵌套深度超过实现上限 100/`；**禁止**命中「内部错误（意外异常）」消息体 | (1,510)，与 N 无关（预算在第 101 个标记 Ident 触发：`type A = ` 占 col 1–9，`YMap<`×100 占 col 10–509） |
| **T15**【R2 · SA2 #2】 | `'type A = ' + '{a:'.repeat(N) + 'string' + '}'.repeat(N) + ';'`，N ∈ {100, 101} | N=100：ok:true + 往返（统一预算不改变对象侧冻结行为）；N=101：E100 资源上限（#5 §16 T1/T3 构想未落库——grep 实证；R2 触及预算机制，正/负双侧上锁防更名漂移） | N=101 → (1,310)（`{a:`×100 占 col 10–309，第 101 个 `{`@310） |

既有回归面（修订轮后必须复跑）：44 用例 + r3-regression 星面字符四用例（doc body
切片不改变扫描循环推进）+ `parse-vfsl-errors.test.ts:133`（E203 未闭合锚点）。

---

## §11 与 #6 的接口契约（无破坏性扩展承诺）

| #6 将做的事 | 本设计提供的支撑 | 是否破坏性 |
|---|---|---|
| E304 形状检查 | marker AST 节点带 `pos`（标记记号锚点预留）；IR marker 带 `name` + 完整实参子树 | 否：`ok:true → ok:false` 仅发生在 #6 判非法的文本（路线图既定收紧方向） |
| E307 纯值 / E309 混合联合 | walk 已穿透 marker.type（引用图边就位）；IR 子树完整可分类 | 否 |
| `Record` / `T[]` / `Pattern` 语法 + IR 节点 | VfslType 判别联合加法扩展位（#5 §7.3 承诺延续） | 否 |
| marker 实参形状沿别名链解析 | `ref` 节点按名引用（IR 不内联展开），别名链解析 machinery 与 IR 无耦合 | 否 |
| #6 在 marker 子树上的形状分类 / 语义遍历【R2 · SA2 #2】 | marker 子树深度受统一预算界定（≤100 schema 层），#6 的递归遍历与分类栈安全；预算口径已冻结（§4.6），#6 不需也不应再设第二预算 | 否 |

---

## §12. 文件清单（File Scope）

### ALLOW LIST

- `packages/vfsl/src/tokenizer.ts` — 修改：doc 分类（含 `/**/` `/***/` 特例）+ `leadDocs` 侧通道（DocLead 接口 + pending 挂靠），约 +45 行（§3）
- `packages/vfsl/src/parser.ts` — 修改：AST 增 marker/docs（§4.1）、**集中式 dangling 记账 + claimDocs 三锚位回收 + EOF 记账位**（§4.2【R2 · SA2 #3】）、marker 语法分支含深度守卫（§4.3/§4.6【R2 · SA2 #2】）、`MAX_OBJECT_DEPTH` → `MAX_TYPE_DEPTH` 更名 + 头注释递归环声明更新、parseModule 返回形状 + docTotal 不变量（§4.4/§4.5），约 +110 行【R2：R1 估 +90，深度守卫/集中记账/更名追加 ≈20 行】
- `packages/vfsl/src/semantic.ts` — 修改：`analyze(aliases, dangling)` 签名 + E305 候选（§6.1 措辞按 R2）+ walk 穿透 marker + toIR 三处 docs/marker（§6），约 +30 行
- `packages/vfsl/src/ir.ts` — 修改：`docs: string[]` 上 VfslAlias/VfslField + `marker` 判别成员（§7.1），约 +10 行
- `packages/vfsl/src/errors.ts` — 修改：ErrCode 注册表 + `E305: '305'` 一行；**同步更新注册表注释：数量 14 → 15、延后清单改写为「E304/E306/E307/E309 延后」**（现状 `errors.ts:10` 注释「14 个，E304~E307/E309 延后」——区间记法 E304~E307 含 E305，实现 E305 后不再成立）【R2 · SA2 #7】
- `packages/vfsl/src/index.ts` — 修改：`parseModule` 新返回形状的解构 + `analyze` 第二参传递（编排适配，约 3 行；公共导出面不变）
- `packages/vfsl/package.json` — **仅限 `version` patch 位一行**（0.1.1 → 0.1.2）：硬门禁 9 强制项，#5 R3 已确立的授权边界（结构性字段仍在 DENY）
- `packages/vfsl/test/parse-vfsl-jsdoc.test.ts` — `[SA6 owned]` SA6 红灯测试（7 用例已落库，现状即验收契约）。**【R2 · SA2 #1】授权例外：用例 1 的断言机制由 SA6 按回炉授权修正（§7.4 方向 (b)，仅断言比对口径，被测文本与其余六用例不动）；T11~T15 构想如需补测，由 SA6 拥有**。SA3 仅可改测试基础设施，不可改断言
- `packages/vfsl/test/parse-vfsl.test.ts` / `parse-vfsl-errors.test.ts` / `parse-vfsl-r3-regression.test.ts` — `[SA6 owned]` 既有 37 用例：本设计零改动零破坏（§7.3）；列此仅为 SA4 比对完备性（预期 actual diff 不含这三文件）

### DENY LIST

- `docs/vfsl/v1-spec.md` — 冻结规格，任何 SA 不得动
- `packages/vfsl/package.json` 的**结构性字段**（`exports` / `dependencies` / `devDependencies` / `scripts` / `name` / `private` / `type`）— 零运行时依赖约束的载体（#5 R3 既定边界；`version` patch 位按硬门禁 9 豁免，见 ALLOW）
- `packages/vfsl/tsconfig.json`、`tsconfig.base.json`、根 `vitest.config.ts`、根 `package.json` — 配置已满足任务，禁动
- `pnpm-lock.yaml`、`pnpm-workspace.yaml` — 无新增依赖，禁动
- `wiki/raw/20260818-prd-vfsl-v1.md`、`CONTEXT.md`、`docs/adr/**` — 文档输入，禁动
- `apps/**`、`tests/**`、`.github/**` — 与本任务无关

---

## §13. 协议假设依据 (Protocol Assumption Evidence)

**无协议级假设**：本设计是进程内纯函数库的增量（零运行时依赖、无网络/端口/
进程生命周期/跨 job 资源/第三方库行为假设）。最接近的各项均非协议假设且已有
行为依据（含 R2 补充实测——SA2 评审指出 R1「验证行为存在纸面化倾向，修订轮须
补实测」，以下逐项落据）：

| 项 | 定性 | 依据 |
|---|---|---|
| `JSON.stringify` 按属性插入序输出（§6.2 序列化确定性） | JS 语言内建行为 | 现有测试已依赖同型行为（`parse-vfsl.test.ts:63-65` JSON 往返深等）；插入序是 ECMAScript 规范化的 `JSON.stringify` 语义（OrdinaryOwnPropertyKeys 先整数键后字符串插入序——docs 数组与既有字段均非整数键） |
| **`JSON.stringify` 对控制字符/引号的转义**（`\n` → 两字符 `\n`、`"` → `\"`，§7.4 断言机制的根据） | JS 语言内建行为 | **R2 实测（probe1，输出附 §7.4）**：模拟合规 IR 上原始形态 `toContain` 三断言全 false、转义形全 true；ECMAScript QuoteJSONString 抽象操作 |
| doc body 的 `text.slice` 码元切片保留代理对/`\r\n` 逐字 | JS 内建字符串语义 | 规格 §5「逐字保留」+ 注记 10；SA6 用例 1 的断言即按此口径构造（红灯文件 `:66-68`） |
| **marker 五函数互递归环无界（RangeError 可达）**（§4.6 预算必要性） | node 运行时栈行为 | **R2 实测（probe2）**：极简帧同构模拟 60415 层爆栈（仅证无界）；保守基线取 SA2 同法实测 ≈2343 层（真实帧载荷更大，#5 R2 同款「取保守值」方法） |
| **`JSON.stringify` 深度上限 ≈4456**（§4.6 序列化余量分母） | node 运行时行为 | #5 R2 二分实测 ≈4456；**R2 复测（probe3）4466**，取保守值 4456；边界随上下文漂移，仅作余量论证不构成契约 |

---

## §14. 契约改动连锁审计 (Contract Change Caller Audit)

**公共契约无改动**：`parseVfsl(text)` 的签名、返回形状、不抛错承诺、导出类型名
全部不变（PRD #3 冻结口径；`VfslType` 判别联合**新增成员**属加法扩展，#5 §7.3
已预告的扩展方式，既有消费者穷尽 switch 的地方为零——测试以 `unknown` 消费）。
**R2 无新增公共契约改动。**

内部函数签名有改动（均非导出面，`index.ts` 的再导出不包含它们），逐个审计：

### 改动函数

| 函数 | 文件 | 改动前契约 | 改动后契约 |
|---|---|---|---|
| `parseModule` | `packages/vfsl/src/parser.ts:81` | `(tokens: Token[]) → AstAlias[]` | `(tokens: Token[]) → { aliases, dangling }`（内部结构，§4.4） |
| `parseTypeAlias` | `packages/vfsl/src/parser.ts:163` | `(declIndex: number) → AstAlias` | `(declIndex: number, docs: string[]) → AstAlias`（M1 挂载入参【R2 · SA2 #3】） |
| `analyze` | `packages/vfsl/src/semantic.ts:40` | `(aliases: AstAlias[]) → ParseVfslResult` | `(aliases: AstAlias[], dangling: {line,column}[]) → ParseVfslResult` |
| `tokenize` | `packages/vfsl/src/tokenizer.ts:49` | `→ Token[]` | `→ Token[]`（**不变**；Token 接口加可选 `leadDocs?` 字段，加法） |

（`next` / `claimDocs` / `accountEof` 为 Parser private 方法的新增/内改，无外部
消费者，不构成契约改动。）

### Caller 清单（`git grep -n "parseModule\|parseTypeAlias\|analyze\|tokenize" -- 'packages/vfsl/**/*.ts'` 全量核对）

| Caller | 文件:行号 | 是否 await | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---|---|---|---|---|
| `parseVfsl`（tokenize 调用） | `packages/vfsl/src/index.ts:33` | N/A（同步） | ✅ 外层 try（整个编排体） | ✅ `catch (err)` 兜底（#5 §15.4） | 返回形状不变，零改动 |
| `parseVfsl`（parseModule 调用） | `packages/vfsl/src/index.ts:34` | N/A | ✅ 同上 | ✅ 同上 | 改为解构 `const { aliases, dangling } = parseModule(tokens)`（§9 第 1 条修绿顺序） |
| `parseVfsl`（analyze 调用） | `packages/vfsl/src/index.ts:35` | N/A | ✅ 同上 | ✅ 同上 | 传第二参 `dangling` |
| `parseModule`（parseTypeAlias 调用） | `packages/vfsl/src/parser.ts:151` | N/A | 外层为 index.ts 顶层 try | ✅ 同上 | 传 M1 回收的 docs（§4.2）【R2 新增行】 |
| 三个既有测试文件 + SA6 测试 | `test/*.test.ts`（仅 import `parseVfsl`） | N/A | 不需要（契约不抛错） | N/A | 零改动（公共面不变） |

风险评估：无未捕获 throw 路径新增（docTotal 不变量 throw 普通 Error → 顶层
兜底 catch 已覆盖，转 E100 内部错误——#5 §15.4 既定通道；深度守卫 throw
VfslSyntaxError → 既有通道）；deep import 因 `exports` 字段限制不可达，内部签名
改动无外部消费者。

---

## §15. 版本 bump

`packages/vfsl/package.json` `version`: `0.1.1` → `0.1.2`（硬门禁 9；#5 R3 确立的
patch 位授权边界，SA3 执行，仅此一行）。该 bump 同时充当语义里程碑标识（§7.3
内容哈希边界条件的落点）。

---

## §16. SA2 反馈逐条回应（R1 → R2 修订汇总）

| SA2 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| #1（CRITICAL）：SA6 用例 1 断言机制对任何合规实现不可满足——登记缺陷 + 给处置路径（SA6 回炉修正，方向 (a)/(b) 二选一写明）+ §10 用例 1 行更正 + §9.2 补前置条件 | ✅ | **§7.4（新增）**、§7.3、§9.2、§10 用例 1 行、§12 ALLOW LIST 授权例外 | 缺陷登记含 R2 实测复现（probe1：原始形态三断言全灭）；选定方向 **(b) 转义形**并给出修正后断言伪代码 + 三条否决 (a) 的理由（PRD #37 形状自由度 / 双向兼容 / 只动断言不动被测文本）+ 红绿判别力核对；§10 用例 1 行改「待 SA6 修正断言后修绿」；§9.2 写明 43/44 合法中间态与 SA3 禁改断言 |
| #2（HIGH）：marker 递归环无守卫，打破 #5 §15.2 完备性前提——补资源界（预算形态二选一 + 余量复算 + 锚点 + 行为承诺）+ 头注释声明更新 + §12/§9 同步 | ✅ | **§4.6（新增）**、§4.3、§1.1/§1.2 行为表、§9.1/9.5/9.8、§11、§12 parser.ts、§13、§10 T14/T15 | 决策**统一计数器**（MAX_OBJECT_DEPTH → MAX_TYPE_DEPTH = 100 更名，值与 v1 承诺不变），否决独立 MAX_MARKER_DEPTH（序列化余量 7.4× < 10× 违标 + 守标准须压对象预算破坏 #5 冻结行为）；余量复算：栈 23.4×（保守基线 2343 层，probe2 无界性实测）/ 序列化 11.1×（4456/400）；超限 = E100 三态口径消息原文沿用，锚第 101 个标记 Ident 记号（与「锚预算耗尽处 `{`」同构 + 构造起点记号依据）；头注释递归环声明改写文本给出；既有测试零冲突 grep 实证；T14（N=100/5000/20000 三档，禁「内部错误」消息体）/ T15（对象双侧回归锁）入构想 |
| #3（MEDIUM）：§4.2 悬空记账枚举漏 `parseUnionType` 两处 `\|` 消费点——补全枚举或立法集中式记账（二选一写明）+ T11 入构想 | ✅ | **§4.2（重写）**、§4.5、§2.1 图、§10 T11、§5.3 示例表 | **立法集中式记账**（SA2 建议的更强方案）：dangling 统一在 `next()` 内执行 + claimDocs 三锚位同步回收 + EOF 显式记账位，枚举降级为 SA4 核对参考表并补全两处 `\|`（parser.ts:194/198）；同步性约束 + claim 调用点恰三处作为静态核对锚点；T11 `type A = string /** d */ \| number;` → E305@(1,17) 入构想 |
| #4（LOW）：§5.1 锚点 (1,28) 应为 (1,24)；与 §10 T3/T4 对齐 | ✅ | §5.1 | (1,28) → **(1,24)**（并注明 28 是 `d` 的列）；两例锚点标注与 T3/T4 逐一对齐（T3 E301@(1,10)/候选 (1,24)；T4 E101@(1,36)/候选 (1,10)）；probe4 复算 |
| #5（LOW）：E305 消息措辞与严格相邻语义矛盾 | ✅ | §6.1 | 改为「悬空文档注释：未紧邻可挂载的声明性节点（类型别名 / 属性 / 标记类型），且不相邻即不再挂载」（SA2 建议措辞），并保留前缀冻结说明 |
| #6（LOW）：§5.3 缺 `type /** d */ A` 与 `{ /** d */ }` 两形态的示例与测试 | ✅ | §5.3（+2 行）、§10 T12/T13 | 两形态显式入示例表（E305@(1,6) / E305@(1,12)，含「为何不是挂 A」的机制说明）；T12/T13 入构想（锚点 probe4 核算，判别力说明保留） |
| #7（NIT）：§12 errors.ts 行补注册表注释同步 | ✅ | §9.1、§12 errors.ts 行 | 补「数量 14 → 15、延后清单 E304~E307/E309 → E304/E306/E307/E309」（区间记法含 E305 不再成立） |
| 红线 #1：SA6 用例 1 修正须保三判别维度 + 换行/引号形态保留 | ✅ | §7.4 | 判别力核对（三维度逐条）+「被测文本形态不动」写入授权边界 |
| 红线 #2：marker 深嵌套探针三档 + ok:true 档过 JSON 往返 + 禁「内部错误」消息体 | ✅ | §10 T14 | N=100 ok:true + 往返（预算值满足双余量的复算在 §4.6）；5000/20000 not.toThrow + E100 前缀 + (1,510) |
| 红线 #3~#5：T11/T12/T13 构想 | ✅ | §10 | 同 #3/#6 落实 |
| 红线 #6：T3/T4 锚点修正后沿用 | ✅ | §5.1、§10 | 锚点经 probe4 复算（T3 候选 (1,24)、T4 E101@(1,36)） |
| 红线 #7：既有回归面复跑（44 用例 + 星面四用例 + E203 锚点） | ✅ | §10 末段 | 显式列复跑清单 |

