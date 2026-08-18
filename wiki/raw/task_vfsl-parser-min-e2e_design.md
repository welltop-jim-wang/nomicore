# SA1 设计文档 — Parser 最小端到端：别名 / 原始类型 / 封闭对象 / 可选 / 字面量联合

> 任务：task_vfsl-parser-min-e2e ｜ Issue #5 ｜ 类型：功能开发（greenfield）
> 设计者：SA1 ｜ 日期：2026-08-18 ｜ 状态：**R2（第二轮修订，逐条落实 SA2 R1 reject：1 HIGH + 3 MEDIUM + 5 LOW）**
> R2 修订标注形如【R2 · SA2 #N】；新增 §15（深嵌套防御与「不抛错」契约达成）、§16（R2 红灯测试构想）与文末「R2 修订记录」。章节结构保持不变，既有章节按标注就地修订。
> Worktree：`/home/wangjian/nomicore-fix-issue-5`（分支 `fix/issue-5-on-refactor-docs-add-mabf-multi-repo-monito`）

**设计输入**（已全文阅读）：

| 输入 | 角色 |
|---|---|
| `docs/vfsl/v1-spec.md`（frozen） | v1 方言唯一规范来源：§2 EBNF + 10 注记、§3 标记语义、§4 19 错误码 + 判定顺序 + 分相位、§5 注释、§6 大小写、§9 未冻结项 |
| `wiki/raw/20260818-prd-vfsl-v1.md` | PRD 归档：公共接缝 `parseVfsl(text)` 冻结；只测外部行为；零运行时依赖 |
| `packages/vfsl/test/parse-vfsl.test.ts`（11 例）+ `parse-vfsl-errors.test.ts`（19 例） | SA6 红灯契约（已实测红灯：`(0, parseVfsl) is not a function`） |
| `CONTEXT.md`、`docs/adr/0001`、`docs/adr/0002` | 术语与架构红线（纯引擎仓库、authority 出范围、无机器标签） |
| `git show b709dbe`（历史剥离实现） | 仅结构参考，偏差不采纳（见 §11） |

---

## §1 任务定位与设计承诺

### 1.1 交付物

`@nomicore/vfsl` 包内实现唯一公共入口：

```ts
parseVfsl(text: string): { ok: true; module: VfslModule } | { ok: false; issues: VfslIssue[] }
```

- 返回形状按 PRD #3 冻结，**不增不改**；`ok: false` 时 `issues` 恰含 1 条（v1「首个错误即失败」）。
- 每条 issue：`{ message, line, column }`，line/column 均 1 起、column 按 Unicode 码点计、行分隔 `\n`（`\r\n` 的 `\r` 不占列）。
- message 冻结前缀 `VFSL-E<三位编号>: `（规格 §4 错误码传递通道），正文措辞不冻结。
- **零运行时依赖**：`packages/vfsl/package.json` 不引入任何 `dependencies`（结构性字段不动；【R3 · SA4 R-3】`version` patch 位除外——MABF HG9 强制授权，见 §12 与文末 R3 记录）。
- 纯函数：无副作用、无 I/O、无 Date/random——确定性输出，为按内容哈希的编译缓存（PRD story 9）预留前提。**【R2 · SA2 #9】该立论自带边界条件**：缓存 key 必须绑定 **parser 语义版本/里程碑**（文本哈希 + 语义里程碑标识），不能仅用文本哈希——§8 的增量交付制造「同文本跨里程碑不同 IR」的窗口（`/** */` 忽略→挂载 docs；悬空注释 ok:true→E305），未绑版本的旧缓存被命中会导致 docs 静默丢失或行为滞后（ADR-0001 明言引擎运行时依赖内容哈希编译缓存）。#5 不实现缓存，此为设计立论应自带的边界条件，非本切片代码事项。

### 1.2 切片承诺（本设计的核心不变量）

**切片内构造，全语义**：类型别名、五个原始类型、封闭对象字面量、`?:` 可选属性、字面量联合（字符串 / 数字）——这五类构造在 v1 规格下的**全部**可适用条款（语法、错误、行列锚点、引用解析时机）都在本切片兑现，不留「切片内构造的某条 v1 语义延后」的暗坑。由此推出 E308（对象字段重名）**必须**在本切片实现（见 §9），尽管 SA6 未写红灯用例。

**切片外构造，二分策略**：v1 规格内合法、但本切片未实现的构造（`T[]`、`Record<K,V>`、`string & Pattern<...>`、六标记、JSDoc 挂载），按「是否参与类型推导」二分处理（完整策略与理由见 §8）：

- 参与推导的语法位构造 → **拒绝**，落 E100 catch-all，message 明示「v1 合法构造、本切片未实现」；
- 不参与推导的 trivia 位构造（`/** */` 文档注释）→ **按忽略型 trivia 处理**，不报错、不挂载。

**无破坏性返工承诺**：#6~#9 扩展 parser 时只做**加法**——tokenizer 记号全集 Day 1 即齐备（§4.2）、parser 的 PrimaryType 分发表留扩展位、IR 以 `kind` 判别联合预留全部 v1 节点种类（§7.3）、语义相位检查器按错误码分文件分函数（§6）。#5 拒绝掉的 v1 合法文本在对应 issue 落地后转为 `ok: true`；#5 接受的 trivia 位文本在 JSDoc issue 落地后增加挂载与 E305 检查——两者都是「未实现 → 实现」的单向收敛，不翻转任何已交付行为。

### 1.3 明确不做（与简报对齐）

- 不实现：`T[]` / `Record<K,V>` / `string & Pattern<...>` / 六标记的解析与 IR 节点；`/** */` 原文捕获与挂载；E304 / E305 / E306 / E307 / E309 检查。
- 不动：信封解析与方言路由（规格 §7 出范围）、求值器、任何 `apps/` 代码。
- 不引入：任何 runtime 依赖、任何构建产物（`exports` 直指 `src/index.ts`，沿用现状）。

---

## §2 🗄️【R2 · SA2 #4】前置上报（已闭合，转历史记录）：SA6 红灯测试两处恒红断言

> **R2 状态标注（2026-08-18）**：本节判定的两处缺陷已由 SA6 于 **21:33–21:38** 按本节处方完成修正并落库（sa6fix **rc=0**，`.mabf-bg/sa6fix.done` 时间戳 **2026-08-18 21:38:27**，SA1 修订期亲验；`parse-vfsl-errors.test.ts:160` 现为 `toBe(23)`、`:178` 输入已含 `\n`，均经 SA1 重读测试文件确认；简报已追加「SA6 R2 修正记录」）。**本节自此转为历史记录，不再是下游判读依据。**
>
> **R2 判读基准（取代下文「处置路由」第 2 条的将来时表述）**：SA3 修绿后 `pnpm test` 必须 **30/30 全绿**；E302 / E106 任一失败**一律按实现缺陷打回，不得引用本节豁免**。SA2 #4 指出的反向风险（实现真有锚点 bug 被当作「已知缺陷」放过）由本基准显式封死。
>
> **核算更正（SA2 #4 / SA6 R2 记录指出，SA1 复测确认）**：下文缺陷 A 中「再入 `A` 位于 line 1, col 33」系按 `{ b: B}`（无空格）版本手敲核算；实际文件字节为 `{ b: B };`（`B` 与 `}` 间有一空格），再入 `A` 实为 **col 34**（复测：`'type A = { b: B }; type B = { a: A };'.indexOf('A', 30) + 1 === 34`）。差 1 不影响缺陷判定本身（单行输入 line 恒 1，`line:2` 恒红），但确认「逐字核算」存在手敲转录误差——R2 起所有锚点一律脚本核算。

（以下为 R1 原文，作为缺陷判定的历史证据保留；两处最小修法均已执行。）

**SA3 在这两处用例修绿之前，本设计明确禁止为实现迁就缺陷锚点。** 按 PR #254 立法，测试断言的修正权在 SA6；SA3 只可改测试基础设施，不可改断言。以下证据均为设计期逐字核算（非口算）。

### 缺陷 A：E106 互引用用例断言 `line: 2`，但输入是单行字符串——任何正确实现都不可能通过

`packages/vfsl/test/parse-vfsl-errors.test.ts:177-182`（字节级复核：字符串字面量内无 `\n`，物理单行）：

```ts
const issue = expectSingleIssue(parseVfsl('type A = { b: B }; type B = { a: A };'));
expectCode(issue, '106');
expect(issue.line).toBe(2);      // ← 单行输入的行列基准下 line 恒为 1
expect(issue.column).toBe(15);
```

- 规格锚点（§4 总表）：E106 锚**再入引用记号**。该输入中再入引用 `A`（第二个 `A`）实际位于 **line 1, col 33**。【R2 更正：实为 **col 34**——`B` 与 `}` 间有一空格，见上方核算更正；不影响本缺陷判定】
- 期望值 `line 2, col 15` 与「补上缺失换行后的预期输入」**精确**吻合：
  `'type A = { b: B };\ntype B = { a: A };'` → 第二行 `type B = { a: A };` 中再入 `A` 恰在 col 15（实测：`"type B = { a: A };".lastIndexOf("A")+1 === 15` → true）。
- 结论：SA6 按两行输入核算了锚点，写入字符串时漏了 `\n`。该用例对任何正确实现**恒红**。
- **最小修法（SA6 执行）**：输入字符串补 `\n`：`parseVfsl('type A = { b: B };\ntype B = { a: A };')`。断言值不动。

### 缺陷 B：E302 用例断言 `column: 18`，但规格锚「重复的声明名」位于 col 23

`packages/vfsl/test/parse-vfsl-errors.test.ts:156-161`：

```ts
const issue = expectSingleIssue(parseVfsl('type A = string; type A = number;'));
expectCode(issue, '302');
expect(issue.line).toBe(1);
expect(issue.column).toBe(18);   // ← col 18 是第二个 `type` 关键字，不是声明名
```

逐字核算（脚本实测，见 §5.6 核算表）：

```
16:; 17:(space) 18:t 19:y 20:p 21:e 22:(space) 23:A 24:(space) 25:= …
```

- 规格锚点（§4 总表）：E302 锚「**重复的声明名**」= 第二个 `A` = **col 23**；col 18 是第二个 `type` 关键字。
- 旁证（SA6 自己的锚点实践）：同文件 E303 用例 `type string = number;` 断言 col 6 = 声明名 `string` 记号（而非 col 1 的 `type` 关键字）——「锚声明名 = 名字记号」在 SA6 测试内部是自洽的，E302 的 col 18 与之矛盾。
- 若为实现迁就 col 18（锚到 `type` 关键字），将违反冻结规格的 E302 锚点条款（规格 §8「错误码稳定」），SA4 静态比对规格即会打回。
- **最小修法（SA6 执行）**：`expect(issue.column).toBe(18)` → `expect(issue.column).toBe(23)`。输入不动。

### 处置路由

1. 本设计按**规格正确**锚点实现（E302 → 重复声明名记号；E106 → 再入引用记号），其余 28 个用例可正常修绿。
2. 请总控将上述两处最小修正派给 SA6（两处均只动一行）。修正落库前，`pnpm test` 将恒余 2 个失败用例，此为**测试缺陷所致，不是实现缺陷**——SA7 动态验证时以本节为判读依据。【R2：本条已执行完毕（21:38 落库）；将来时表述作废，判读以上方「R2 判读基准」为准——30/30 全绿，本节不提供豁免】

---

## §3 总体架构：分层与两相位数据流

### 3.1 模块布局（`packages/vfsl/src/`，6 个文件，均新建/重写空壳）

```
src/
  index.ts      公共入口：parseVfsl 编排（tokenize → parse → semantic）+ 公共类型再导出
  errors.ts     错误码注册表 + VfslIssue 构造（前缀格式化 VFSL-E%03d: ）
  tokenizer.ts  词法层：text → Token[]（含延迟错误记号）；BOM 剥离；行列基准
  parser.ts     语法层：Token[] → 内部 AST（带位置）；递归下降；判定顺序 1~7 映射
  semantic.ts   引用/语义层：E301/E302/E106/E308 检查 + min-position 聚合 + AST → IR
  ir.ts         IR 公共类型定义（VfslModule / VfslType / …）
```

分层与公共契约的关系：**只有 `index.ts` 的导出面是公共契约**；tokenizer/parser/semantic 的内部形状（Token、AST）不导出为契约（deep import 因 `exports` 字段限制本就不可达）。SA6 测试只 import `../src/index.js`，与本分层一致。

### 3.2 数据流与相位模型

```
text ──tokenizer──▶ Token[]（含 ≤1 个延迟错误记号，文本序）
     ──parser────▶ SyntaxPhase 结果：AST ｜ 首个语法相位 issue（throw 内部异常承载）
     ──semantic──▶ 语义相位 issue 全集（E301/E302/E106/E308 + 判定顺序第 6 条延迟分支）
                   → 按 (line, column, 错误码数值) 取最小 → 唯一 issue
     ──toIR─────▶ VfslModule（可 JSON 序列化、确定性）
```

相位语义严格对齐规格 §4「错误数量与恢复策略」：

| 相位 | 覆盖错误码 | 失败策略 |
|---|---|---|
| 词法 + 语法（同一 fail-fast 相位） | E100~E105、E201~E203、声明名位 E303（判定顺序第 7 条） | **文本序首个遇到处即时失败**（实现机制见 §4.1 延迟错误记号） |
| 引用 / 语义 | E106、E301、E302、E304~E309（本切片实现 E308） | 仅当模块全量解析成功才进入；**相位内取文本位置最前的一处** |

相位优先于位置：语法相位任一错误（哪怕位置靠后）先于一切语义相位错误。例：`type A = Foo; type string = number;`——E301（Foo，col 10）与 E303（string，col 20）并存时报 **E303**：解析到第二个声明名即失败，模块从未全量解析成功，语义相位不进入。

**【R2 · SA2 #1】资源界（详见 §15）**：语法相位带嵌套深度预算（`MAX_OBJECT_DEPTH = 100`，超限 → E100 资源上限口径、锚预算耗尽处 `{` 记号）；语义相位 E106 DFS 以**显式栈迭代**实现（别名链深度对调用栈免疫）；`parseVfsl` 顶层设 never-expected 兜底 catch。「不抛错」契约**由构造达成，不弱化措辞**——三选一决策与完整论证见 §15.1。

### 3.3 内部错误通道（非公共契约）

语法相位错误以内部异常 `VfslSyntaxError extends Error { issue: VfslIssue }` 从 parser 抛出、在 `parseVfsl` 顶层 catch 转为 `{ ok: false, issues: [issue] }`。选择 throw 而非 result-union：单错误模型下控制流最简；该类型不导出，不构成接缝。【R2 · SA2 #1】顶层 catch 分两层：`VfslSyntaxError`（设计通道）之上再兜一层 `catch (err)`，未预期异常转 E100「内部错误」issue（§15.4——最终防线而非设计路径，命中即实现缺陷，SA4/SA7 不得视为通过）。

---

## §4 Tokenizer 设计

### 4.1 关键机制：延迟错误记号（deferred error token）

词法错误（E201/E202/E203/未知字符 E100）**不在 tokenize 时立即抛出**，而是产出一个 `kind: 'error'` 的记号（携带错误码、消息、位置），随后**停止词法**（该记号必为最后一个）。parser 单向左到右消费记号流，**任何位置读到 error 记号即以该码失败**——包括模块尾部的 trivia 扫描。

为什么必须延迟而不是「先全量 tokenize、遇错即抛」：语法相位要求**文本序**首个错误胜出。反例 `type A = ( "abc`：`(`（col 10，E100）在未闭合字符串（col 12，E201）**之前**。若 tokenize 阶段直接抛 E201，就违反了「在遇到处即时失败」的文本序语义。延迟记号使记号流保持文本序，parser 先消费到 `(` 记号 → E100@col 10 正确胜出。词法停在首个词法错误处不影响正确性：parser 永远不会跳过 error 记号去消费其后的内容。

### 4.2 记号全集（Day 1 即为 v1 全量，为 #6~#9 铺路）

| 类别 | 内容 | 说明 |
|---|---|---|
| 单字符标点 | `{ } ( ) [ ] < > , ; : ? \| & =` | `(` `)` `[ ] < > & ?` 本切片文法用不到，但**必须**作为记号存在：E102 锚 `<`、E103 锚 `extends`、E104 锚 `[`、E100（括号分组 / 未实现构造）都需要它们作为锚点记号 |
| 标识符 | `Ident`：`[A-Za-z][A-Za-z0-9_]*`（ASCII 冻结） | **统一 Ident + 后置查表**设计（规格判定顺序第 7 条明确 bless 两种设计等价）；保留名分类在 parser 查表：`type Record Pattern string number boolean null unknown any extends interface YMap YArray YPlainArray YLeaf YXmlFragment` |
| 字符串字面量 | `"…"`，仅 `\"` `\\` 两个转义；解码后作为记号值 | 跨行 / EOF 未闭合 → E201（锚起始 `"`）；其余 `\x` → E202（锚**反斜杠**记号） |
| 数字字面量 | `[0-9]+`，无符号十进制整数 | 记号值 = 数值（`007` 规范化为 7，见 §7.3）；【R2 · SA2 #2】`Number.isFinite(数值)` 为假（超双精度，如 400 位数字）→ parser 字面量分支 E100 锚该记号（判定线与论证见 §7.3） |
| trivia（不产出记号） | 空白、`//` 行注释、`/* */` 块注释、`/** */` 文档注释 | 文档注释本切片按忽略型 trivia（§8）；块/文档注释未闭合 → E203（锚起始 `/*`） |
| 错误记号 | `kind: 'error'`，见 §4.1 | 未知字符（`$`、`-`、`.`、非 ASCII 等）→ E100「未知记号」 |

历史实现偏差不采纳（本设计 §11）：`$` 允许作标识符起始（违反规格 §4「`$` 不在 v1 标识符字符集」）。

### 4.3 行列基准

- 逐 **Unicode 码点**推进 column（`for..of` / `codePointAt`，防 CJK 代理对计 2 列）。
- `\n`：line+1、column 重置 1。`\r`：**永不占列**；`\r\n` 中与 `\n` 合并为一次换行；孤立 `\r` 按空白 trivia 处理（不换行、不进位）——规格只冻结 `\r\n` 行为，孤立 `\r` 属未冻结边角，此选择写入设计以固化确定性（与历史实现的「孤立 `\r` 触发换行」不同，不采纳）。
- tab 按 1 列（码点口径）。
- BOM（§9.2）：text 首个码点为 U+FEFF 时剥离后起算——BOM 不占 line 1 任何列。**文本中部**的 U+FEFF 不是 BOM：按未知字符 → E100。
- EOF 记号位置 = 扫描结束位（空文本为 `(1,1)`，保证 ≥1）。

### 4.4 词法细节冻结点

- 行注释至 `\n` 终结；文本 EOF 结束而无换行时**视同 eol**（注记 10，合法）。
- 块注释与文档注释的区分（`/*` 后紧接 `*` 即文档注释；`/**/`、`/***/` 是块注释）本切片**无需区分**——两者同为忽略型 trivia，仅 E203 判定共享；区分逻辑留给 JSDoc issue。
- 字符串内转义逐字扫描：遇 `\` 先看下一字符——`"` 或 `\` 合法解码，其余（含行终止、EOF）→ E202 锚该反斜杠。E202 先于 E201 暴露（反斜杠在 EOF 之前被遇到，符合文本序）。
- 注释内部 `*/` 首现即闭合（不嵌套）；扫描到 EOF 未闭合 → E203 锚注释起始 `/*`。

---

## §5 Parser 设计（递归下降 + 判定顺序映射）

### 5.1 内部 AST（带位置，不导出）

```ts
// 每个 AST 节点携带 pos: { line, column }（记号起点），为 #6~#9 的 E304/E309 锚点预留
type AstType =
  | { kind: 'primitive'; name: 'string'|'number'|'boolean'|'null'|'unknown'; pos: Pos }
  | { kind: 'literal'; value: string | number; pos: Pos }
  | { kind: 'ref'; name: string; pos: Pos }                 // TypeRef（E301/E106 锚点）
  | { kind: 'generic-diag'; name: string; namePos: Pos; ltPos: Pos }  // 判定顺序第 6 条延迟构造，见 §5.4
  | { kind: 'object'; fields: AstField[]; pos: Pos }
  | { kind: 'union'; members: AstType[]; pos: Pos };
type AstField  = { name: string; namePos: Pos; optional: boolean; type: AstType };
type AstAlias = { name: string; namePos: Pos; type: AstType; declIndex: number };
```

### 5.2 分发伪代码（判定顺序 1→7 逐条映射）

```text
parseModule:
  loop:
    skip 到下一记号（读到 error 记号 → 即以其码失败；EOF → 结束）
    记号 = Ident 'type'      → parseTypeAlias
    记号 = Ident 'interface' → E105（判定顺序第 1 条：模块层前导 interface；锚该记号）
    其他                      → E100（模块层意外记号；锚该记号）

parseTypeAlias:                                     # 已消费 'type'
  name ← Ident；非 Ident → E100（锚实际记号 / EOF 位）
  name ∈ 保留名集合  → E303（第 7 条；锚声明名记号，即时判定——语法相位）
  下一记号 = '<'      → E102（第 2 条；锚 '<' 记号）
  下一记号 ≠ '='      → E100（锚实际记号）
  type ← parseTypeExpr
  下一记号 ≠ ';'      → E100（缺终止分号；锚实际记号 / EOF 位）

parseTypeExpr = parseUnionType:
  可选消费前导 '|'（注记 2）
  members ← [ parsePostfixType ]
  while 下一记号 = '|': 消费；members.push(parsePostfixType)
  members.length === 1 → 直接返回该成员（单成员联合坍缩，§7.3）
  否则返回 { kind:'union', members }（成员按源序）

parsePostfixType:                                   # 完整 v1 的 ArrayType 位
  t ← parsePrimaryType
  while 下一记号 = '[':
    → E100「数组类型后缀 [] 属 v1 合法构造、本切片未实现」（锚 '[' 记号）
    # 不消费循环——首个错误即败
  返回 t

parsePrimaryType:  # 判定顺序在此分派；「类型位置」语境
  记号 = '{'    → parseObjectType
  记号 = Ident:
    'interface' → E105（第 1 条：类型位置遇 interface）
    'extends'   → E103（第 3 条；锚该记号）
    'any'       → E101（第 5 条；锚该记号）
    'Record' 或六标记标准拼写:
        后随 '<' → E100「v1 合法构造、本切片未实现」（锚该标识符记号；§8）
        无 '<'   → E100（第 7 条：裸引用保留名；锚该记号）
    'type' / 'Pattern':
        'Pattern' 且后随 '<' → E100（第 7 条：脱离 string& 语境；锚 'Pattern'）
        否则（如 'type' 出现在类型位置）→ E100（第 7 条；锚该记号）
    五原始类型名:
        后随 '<' → E100（第 7 条：保留名后随 '<'；锚**该原始类型名记号**——非 '<'）
        否则     → { kind:'primitive' }
    其他 Ident:
        后随 '<' → generic-diag 构造（§5.4，延迟到语义相位终判）
        否则     → { kind:'ref' }（含 'true'/'false'——注记 8：普通 Ident，未声明即 E301）
  记号 = 字符串/数字字面量 → { kind:'literal' }
  记号 = '('    → E100（注记 5：括号分组不在子集；锚 '('）
  其他 / EOF    → E100（类型位缺记号，如 `{ a?: }` 锚 '}'；EOF 锚 EOF 位）

parseObjectType:                                    # 已消费 '{'
  skip；'}' → { kind:'object', fields: [] }（空对象，注记 3）
  loop:
    field.name ← Ident
      记号 = '['  → E104（第 4 条：字段名位遇 '['；锚 '['）
      Ident 且 name ∈ 保留名集合 → E100（【R2 · SA2 #3】字段名位保留名，keyword-token
                                  读法；锚该保留名记号——立场与论证见 §5.5 注）
      非 Ident   → E100（锚实际记号）
    可选 '?' → optional = true（其后必须有 ':'，否则 E100）
    期望 ':'，否则 E100
    field.type ← parseTypeExpr
    记号 = ';' 或 ',' → 消费，继续下一字段（尾分隔符合法：循环顶遇 '}' 即闭合）
    记号 = '}'        → 闭合（末字段无分隔符合法）
    其他              → E100（缺字段分隔符；锚实际记号）
```

**类型表达式的续位分派**（完整 TypeExpr 消费后的 peek，`parsePostfixType` 内已覆盖 `[`）：

```text
  记号 = '&'（【R2 · SA2 #6】四案例锚点细化）:
    前一 primary 为 primitive 'string'：
      前瞻 Ident 'Pattern' + 后随 '<'
        → E100「string & Pattern<…> 属 v1 合法构造、本切片未实现」（锚 '&'——切片边界
          选择，§8 既有；随 #7 落地转 ok:true，锚点随之消亡，无翻转风险）
      前瞻 Ident 'Pattern' + 非 '<'（如 string & Pattern;）
        → E100（第 7 条：「Pattern 脱离 string & Pattern<…> 语境」；锚 **'Pattern' 记号**——
          R1 原锚 '&' 废弃，改对齐第 7 条文义读法；全 v1 终态同锚，非切片差异）
      前瞻其他 Ident / 非记号
        → E100「交叉类型仅允许 string & Pattern<…>」（锚 '&'——未冻结角落的确定性选择，
          §4.3 孤立 \r 先例同款登记）
    前一 primary ≠ primitive 'string'（如 number & Pattern<"x">）
      → E100「交叉类型仅允许 string & Pattern<…>」（锚 '&'——未冻结角落的确定性选择，
        登记同上）
  记号 = 'extends' → E103（第 3 条；锚该记号）
  记号 ∈ { ';', ',', '}', EOF } → TypeExpr 正常终结（由调用方校验）
```

### §5.3 判定顺序映射核对表（设计自检，SA2 复核点）

| 规格判定顺序条款 | 本设计落点 | 红灯用例 |
|---|---|---|
| 1. interface（模块层 / 类型位置）→ E105 | parseModule / parsePrimaryType | ✅ `interface A {}` → (1,1) |
| 2. 声明名后 `<` → E102 | parseTypeAlias | ✅ `type Box<T> = …` → (1,9) |
| 3. 类型位置 extends → E103 | parsePrimaryType / 续位分派 | ✅ `type T = A extends B ? C : D;` → (1,12) |
| 4. 字段名位 `[` → E104 | parseObjectType | ✅ `type T = { [K in Keys]: V };` → (1,12) |
| 5. 类型位置 any → E101 | parsePrimaryType | ✅ `type A = any;` → (1,10) |
| 6. `<` 前标识符非 Record/非标记拼写/非保留名 → 未声明 E301 ／ 已声明 E100@`<` | generic-diag 构造（§5.4），语义相位终判 | 无直接用例（同机器由 E301 用例覆盖一半） |
| 7. 保留名错位 → E100；声明名位保留名 → E303（即时）；【R2 · SA2 #3】字段名位保留名 → E100 | parsePrimaryType 各分支 / parseTypeAlias / parseObjectType（字段名位） | ✅ `type T = string<number>;` → (1,10)；✅ `type string = number;` → (1,6)；字段名位无红灯用例（§16 T6 构想） |

「多处特征命中取文本位置最前、并列取条款次序」：递归下降天然按文本序消费记号，每条款在**其特征记号被读到时**才判定，因此文本序优先自动成立；同位置并列（如同一记号同时是 `any` 与其他）在文法上不可构造，不单独设机制。

### 5.4 generic-diag 构造（判定顺序第 6 条的延迟终判）

非保留名 Ident 后随 `<`（如 `Foo<...>`、`yleaf<...>`）：文法不可推导，但**错误码依赖「已声明 / 未声明」终判，规格明确该终判在模块全量解析后进行**。实现：

1. 语法相位：消费该 Ident，进入**平衡角括号扫描**（depth 计数，只认 `<`/`>` 单字符记号；遇 depth 归零的 `>` 结束；EOF 未闭合 → E100 锚 `<`——语法相位即败）。**【R2 · SA2 #7】扫描中任何位置读到 error 记号 → 即以其码失败**（§4.1 普适规则「任何位置读到 error 记号即以该码失败」对扫描循环的显式延伸——禁止「只数角括号、越过词法错误直奔 EOF」的吞错实现；文本序语义要求词法错误在到达 EOF 前已被遇到即报）。反例（红灯构想 §16 T9）：`type A = Foo<$>;`——tokenizer 停在 `$`（error 记号）；吞错实现将以 EOF 未闭合结案 E100 锚 `<`，正确行为是 E100 锚 `$`。产出 `{ kind:'generic-diag', name, namePos, ltPos }` 节点，**不产出任何 IR 等价物**。
2. 语义相位：`name` 未声明 → **E301 锚 namePos**（引用记号）；已声明 → **E100 锚 ltPos**（`<` 记号——规格第 6 条第二分支的显式锚点，注意与 E301 分支锚点不同）。
3. 不变量：generic-diag 节点**永远**产生语义相位 issue（二选一），不可能进入 `ok: true` 的模块——避免「泛型实参被静默接受」。

### 5.5 结构性 E100（catch-all）锚点口径

| 场景 | 锚点 |
|---|---|
| 括号分组 `(`（注记 5） | `(` 记号（红灯实测 (1,10)） |
| 负数 / 小数字面量 `-1`（注记 7） | `-` 未知字符记号（红灯实测 (1,10)） |
| 保留名后随 `<`（第 7 条） | **保留名记号本身**（红灯实测 `string<number>` → (1,10)，锚 `string` 非 `<`） |
| 别名缺终止分号（注记 4） | 违反期望的记号；EOF → EOF 位（未冻结，仅需 ≥1） |
| 可选属性缺类型注解 `{ a?: }` | 类型位实际记号（`}`）；未冻结 |
| 缺字段分隔符 / 缺 ':' / 模块层杂记号 | 违反期望的记号 |
| 记号内部 trivia `str/**/ing`（注记 9） | 后一个记号（`ing`）——「不可推导」由意外记号暴露 |
| 未知字符（`$`、非 ASCII 等） | 该字符（E100「未知记号」） |
| 【R2 · SA2 #3】字段名位保留名（`{ type: string }`、`{ any: number }`、`{ Record: string }` 等 16 名全集） | **该保留名记号**（E100） |
| 【R2 · SA2 #6】`string & Pattern;`（无 `<`） | **`Pattern` 记号**（E100，第 7 条「脱离语境」读法；R1 锚 `&` 废弃） |
| 【R2 · SA2 #6】`number & Pattern<"x">` / `string & Foo` 等其余 `&` 续位 | `&` 记号（E100；未冻结角落的确定性选择，已登记） |
| 【R2 · SA2 #2】超双精度数字字面量（`Number.isFinite` 为假） | 该数字记号（E100「超出可序列化数值域」——恰合 E100 冻结锚「构造起点记号」，§7.3） |
| 【R2 · SA2 #1】嵌套深度超预算（第 101 层 `{` 被读到） | 预算耗尽处的 `{` 记号（E100「实现资源上限」口径；未冻结角落的确定性选择，§15.2） |
| 【R2 · SA2 #7】generic-diag 扫描中的 error 记号（`Foo<$>`） | 该 error 记号（`$`@14——实测：`<`@13、`$`@14；**SA2 构想中 col 13/col 10 两数有误，以自测数为准**） |

**【R2 · SA2 #3】字段名位保留名 → E100 的立场论证**（规格未冻结角落：判定顺序第 7 条的等价保证明文限定于非保留名标识符，其枚举仅覆盖类型位 / 声明名位——本角落两种 tokenizer 读法分歧，设计必须显式择一）：

1. **择 keyword-token 读法**（保留名记号在字段名位不作名字用 → E100 锚该记号），与第 7 条对类型位（E100）与声明名位（E303）的处理**同族**——三个 Ident 期望位（模块声明名、类型位、字段名位）对保留名的行为由此完全一致。
2. **行为翻转风险最小**：规格未来若冻结此角落，文义上最可能的冻结值即本读法（与第 7 条既有实例一致）；「接受」读法一旦发布，未来冻结将翻转已发布行为。
3. **接受读法的代价**：`{ type: string }` 类模式永久合法，后续所有阶段（JSDoc 挂载、标记 issue）须永远为保留名字段特判；且与 `type T = type;`（E100）「同文不同判」，割裂。
4. **变体拼写不受影响**：`yleaf` 等非保留名（规格 §6），作字段名合法（红灯构想 §16 T7 正例）。
5. 现有 SA6 30 用例无保留名字段，零冲突（已核对两份测试原文）。

### 5.6 红灯锚点逐字核算表（设计期脚本实测，非口算）

18 个带精确行列断言的用例全部按「1 起列、`\n` 行分隔、码点列」逐字核算：

| # | 输入（运行时字面量） | 断言锚 | 核算结果 |
|---|---|---|---|
| 1 | `type A = ( string \| number );` | (1,10) | ✅ `(`@10 |
| 2 | `type A = -1;` | (1,10) | ✅ `-`@10 |
| 3 | `type T = string<number>;` | (1,10) | ✅ `string`@10 |
| 4 | `type A = any;` | (1,10) | ✅ `any`@10 |
| 5 | `type Box<T> = { value: T };` | (1,9) | ✅ `<`@9 |
| 6 | `type T = A extends B ? C : D;` | (1,12) | ✅ `extends`@12 |
| 7 | `type T = { [K in Keys]: V };` | (1,12) | ✅ `[`@12 |
| 8 | `interface A {}` | (1,1) | ✅ `interface`@1 |
| 9 | `type A = "abc` | (1,10) | ✅ `"`@10 |
| 10 | `type A = "a\b";`（字面反斜杠） | (1,12) | ✅ `\`@12 |
| 11 | `type A = string; /* foo` | (1,18) | ✅ `/*`@18 |
| 12 | `type A = Foo;` | (1,10) | ✅ `Foo`@10 |
| 13 | `type A = string;\n\ntype B = Foo;` | (3,10) | ✅ `Foo`@L3C10 |
| 14 | `type A = string; type A = number;` | (1,23)【R2：断言已由 18 修正为 23，21:38 落库】 | ✅ 重复声明名 `A`@23；R1 时点断言 18（第二个 `type` 关键字）恒红，已由 SA6 修正（§2 历史记录） |
| 15 | `type string = number;` | (1,6) | ✅ `string`@6 |
| 16 | `type A = { x: A };` | (1,15) | ✅ 再入 `A`@15 |
| 17 | `type A = { b: B };\ntype B = { a: A };`（【R2】修正后两行输入，21:38 落库） | (2,15) | ✅ 再入 `A`@L2C15；R1 时点该用例为单行输入（再入 `A`@L1C**34**，R1 误核 33，§2 更正）恒红，已由 SA6 修正（§2 历史记录） |
| 18 | 其余 11 个幸福路径 + 1 个 E100 前缀-only | — | ✅ 设计行为直接覆盖 |

（核算命令：对每个输入按字符逐位编号验证目标记号列号；R1 时点两条 ❌ 的判定证据见 §2 历史记录——两断言已于 2026-08-18 21:38 由 SA6 修正落库，本表按修正后测试现状标记 ✅。R2 起新增锚点一律脚本核算，§16 同。）

---

## §6 语义相位设计（模块全量解析成功后运行）

### 6.1 四项检查（全量收集，不做短路）

| 检查 | 算法 | 锚点 |
|---|---|---|
| E302 重复声明 | 按名分组；每个**第二次及以后**出现产出 issue | 该重复声明的声明名记号 |
| E301 未知名 | 遍历所有别名体；每个 `ref` 节点 `name ∉ 声明名集合` → issue（声明集合 = 全模块全部声明名的并集，前向引用天然合法） | 该引用记号 |
| E106 引用图成环 | 别名引用图（边 = 各声明体内的全部 `ref` 出现，按源序）；DFS 三色标记，声明序为根序、源序为邻接序；**遇灰点回边 → 记录候选后继续遍历（不短路）——全部回边进入 §6.2 候选池参与 min-position 聚合**【R2 · SA2 #5：堵「首个回边即止」实现错报文本序靠后者；反例见 §15.3】；**DFS 以显式栈迭代实现**【R2 · SA2 #1：别名链深度对调用栈免疫，§15.3】；消息携带环路径（`A → B → A` 格式） | 胜出（文本位置最前）回边的**再入引用记号** |
| E308 字段重名 | 逐 ObjectType（含嵌套、联合成员内的对象）首见集合；重复字段名 → issue | 重复字段名记号 |

确定性：根序 = 声明序、邻接序 = 源序、遍历序固定 → 同输入同输出（哈希缓存前提）。同名多声明（E302 场景）的引用边取**全部声明体并集**（未冻结角落的确定性选择）；实际报错由 min-position 聚合决定，绝大多数布局下 E302 声明名先于体内引用出现。

### 6.2 聚合规则（「相位内取文本位置最前」的实现）

```text
candidates = [E302×n, E301×n, E106×n, E308×n, generic-diag 终判×n]
issue = minBy(candidates, (line, column, 错误码数值))   # 位置并列时按码号升序
return { ok: false, issues: [issue] }                   # 恰 1 条
```

位置并列在实际文法中不可构造（不同检查的锚点落在不同记号种类上），码号序仅为确定性兜底。

### 6.3 AST → IR 映射

仅当 candidates 为空：剥离全部 `pos`、坍缩单成员联合、`generic-diag` 不可能出现（必产 issue）。产出 `VfslModule`（§7）。

---

## §7 IR 形状与公共类型

### 7.1 类型定义（`src/ir.ts`，由 `index.ts` 再导出）

```ts
/** PRD #3 冻结接缝的错误侧。 */
export interface VfslIssue { message: string; line: number; column: number }

export interface VfslModule { kind: 'vfsl-module'; aliases: VfslAlias[] }
export interface VfslAlias  { kind: 'alias'; name: string; type: VfslType }
export interface VfslField  { kind: 'field'; name: string; optional: boolean; type: VfslType }

export type VfslType =
  | { kind: 'primitive'; name: 'string' | 'number' | 'boolean' | 'null' | 'unknown' }
  | { kind: 'literal'; value: string | number }   // JSON 天然区分 "80" 与 80
  | { kind: 'ref'; name: string }
  | { kind: 'object'; fields: VfslField[] }
  | { kind: 'union'; members: VfslType[] };

export type ParseVfslResult =
  | { ok: true; module: VfslModule }
  | { ok: false; issues: VfslIssue[] };
```

**【R2 · SA2 #8】归属澄清**：`ir.ts` **仅含类型**；`parseVfsl` 的实现与导出在 `index.ts`（§3.1）。R1 此代码块内的 `export function parseVfsl(…);` 声明仅为公共面示意，已移除——无函数体的函数声明不是合法 TS，SA3 不得在 ir.ts 写签名无体声明（typecheck 必败），也不得误解其归属。

类型再导出满足 `verbatimModuleSyntax`（`export type { … }`）。SA6 测试将 module 断言为 `unknown`——类型化导出与其赋值兼容（`VfslModule` ⊂ `unknown`），接缝形状不变。

### 7.2 迷你 fixture 的 IR 示例（SA3 实现对照）

```jsonc
// type Mode = "fast" | "safe";  type Server = { host: Host; count?: Count; info: { label: string } }; …
{
  "kind": "vfsl-module",
  "aliases": [
    { "kind": "alias", "name": "Mode", "type": { "kind": "union", "members": [
      { "kind": "literal", "value": "fast" }, { "kind": "literal", "value": "safe" } ] } },
    { "kind": "alias", "name": "Port", "type": { "kind": "union", "members": [
      { "kind": "literal", "value": 80 }, { "kind": "literal", "value": 443 } ] } },
    { "kind": "alias", "name": "Host",  "type": { "kind": "primitive", "name": "string" } },
    // … Count/IsTls/Empty/Meta 同构 …
    { "kind": "alias", "name": "Server", "type": { "kind": "object", "fields": [
      { "kind": "field", "name": "host",  "optional": false, "type": { "kind": "ref", "name": "Host" } },
      { "kind": "field", "name": "count", "optional": true,  "type": { "kind": "ref", "name": "Count" } },
      { "kind": "field", "name": "info",  "optional": false, "type": { "kind": "object", "fields": [
        { "kind": "field", "name": "label", "optional": false,
          "type": { "kind": "primitive", "name": "string" } } ] } }
    ] } }
  ]
}
```

SA6 断言核对：`toBeTypeOf('object')` ✅；`JSON.parse(JSON.stringify(m))` 深等 ✅（纯数据、无 Map/Set/undefined 载荷）；序列化串含全部 8 个别名名 ✅（`aliases[].name`）。

### 7.3 设计理由与扩展点

- **`kind` 判别联合**：字符串判别式对 JSON 往返、穷尽 switch、后续求值器分发都友好。#6~#9 的扩展 = 追加 union 成员（`array` / `record` / `pattern` / `ymap` / …）——纯加法。
- **有序数组而非名→节点映射**：保留声明序（确定性哈希）；`ok: true` 蕴含名字唯一（E302 已拒绝重复），键控形状无额外收益。
- **IR 不携带行列**：位置是诊断信息，进 IR 会让内容哈希对排版敏感（同一 schema 换缩进 → 不同哈希，违背缓存立论）；锚点信息保留在内部 AST，语义相位消费。
- **坍缩单成员联合**：`| "a"`（注记 2 前导管道单成员）→ literal 本体。联合单元 = 自身，语义无损；规范化提升「语义等价文本 → 等价 IR → 等价哈希」。
- **字面量值解码 / 数值化**：字符串记号值 = 转义解码后文本（`\"`→`"`）；数字 = 数值（`007` → 7——记号原文不进 IR，语义规范化）。
- **【R2 · SA2 #2】数字字面量值域 = IEEE-754 双精度，超域即 E100**：PRD 冻结「IR 可 JSON 序列化」（内容哈希缓存的前提）⇒ IR 数值域即 JSON 数值域（双精度）。判定线机械化：**`Number.isFinite(Number(记号原文))` 为假（超双精度整数字面量，如 400 位数字）→ E100**，锚该数字记号（恰合 E100 冻结锚「构造起点记号」），消息如实标注「超出可序列化数值域（双精度上限 ≈1.8e308），非方言判定」。**实测依据**（SA1 设计期复测，与 SA2 一致）：`Number('1'+'0'.repeat(400))` = `Infinity`；`JSON.stringify(Infinity)` = `"null"`——若进 IR 则往返静默损坏，直接违反可序列化目标；`1e308` 有限且往返无损（`JSON.parse(JSON.stringify(1e308)) === 1e308`）。**有限值维持双精度规范化**（含精度损失：`100000000000000000001` → `100000000000000000000`）——与 `007` → 7 同族口径，§7.3 既有「值语义规范化」的自然延伸，判定线两侧行为均有定义。**否决「以字符串承载原文」**（IR 的 `value: string | number` 类型上容纳，但语义上否决）：IR 中 `value` 的 JSON 类型（string vs number）是字面量种类的判别器；超范围数字改携字符串将 (i) 与字符串字面量发生 **IR 碰撞**（不同文本 → 相同 IR → 相同内容哈希，破坏「文本→IR」的确定性映射下界）；(ii) 对未来求值器**说谎**——该成员将错误匹配字符串运行时值，而任何 JSON 运行时值都不可能等于该整数（JSON 无法表达 Infinity 级整数）。类型谎言比响亮拒绝危险；该构造虽切片内且可从文法推导，其拒绝本质是**实现值域边界**（同 §15.2 资源上限的法理：规格冻结方言语义，无从冻结实现值域），消息如实分开口径。红灯构想 §16 T4–T5。
- **JSDoc 挂载扩展点**：未来各节点追加 `docs: string[]`（原文数组，连续文档注释按序）——纯加法，不破坏现有断言（JSON 往返对新增字段稳定）。

---

## §8 切片边界策略（SA2 主攻点，本设计的核心防御）

**判定原则：构造是否参与类型推导。** 参与推导而未实现 → 无法产出正确 IR 且无法运行其专属语义检查 → 必须拒绝（E100，消息如实区分「v1 合法但未实现」与「真越界」）；不参与推导（trivia）→ 忽略无损（只可能少捕获，不可能错接受/错拒绝切片内文本）。

| 切片外构造（v1 合法） | #5 行为 | 错误码 | 锚点 | 消息口径 | #6~#9 落地后 |
|---|---|---|---|---|---|
| `T[]` 数组后缀 | 拒绝 | E100 | `[` | 「v1 合法构造、本切片未实现」 | `ok:true`，IR 增 `array` |
| `Record<K,V>`（`Record`+`<`） | 拒绝 | E100 | `Record` 记号 | 同上 | `ok:true` + E306 引入 |
| `string & Pattern<"…">`（完整形态） | 拒绝 | E100 | `&` | 同上 | `ok:true`，IR 增 `pattern` |
| 六标记 + `<`（`YMap<…>` 等） | 拒绝 | E100 | 标记记号 | 同上 | `ok:true` + E304/E307/E309 引入 |
| `/** */` 文档注释 | **忽略**（trivia） | —（不报错） | — | — | IR 增 `docs` 挂载 + E305 |
| 裸标记 / 裸 `Record` / 裸 `Pattern`（无 `<`） | 拒绝 | E100（第 7 条：裸保留名） | 该保留名记号 | 「真越界」——**与全 v1 行为一致，非切片差异** | 不变 |
| 标记大小写变体（`yleaf` 等）未声明 | 拒绝 | E301（规格 §6：变体 = 未知名） | 引用记号 | 与全 v1 一致 | 不变 |

**为什么 E100 是唯一合法的拒绝码**：

1. 规格 19 码条件已冻结（规格 §8「错误码稳定」）；「尚未实现」不是任何已冻结码的条件。为它新造码（如 E4xx）= **发明规格外错误**——简报明令禁止，且实现状态不属于方言条件，规格 §8 只增不改通道也不适用。
2. E100 的条件「不可从 §2 文法推导」在增量交付期（#5→#9）读作「不可从**已实现**的 §2 子集推导」：随每个 issue 落地，该读法单调收敛到冻结全称——#9 完成时 E100 条件与规格逐字重合，期间不存在已发布行为的翻转。
3. 消息正文措辞**不冻结**（规格 §4 明示），因此 message 中如实写明「v1 合法构造、本切片未实现、待后续 issue」合法且必要——它把「暂时拒绝」与「永久非法」在人类可读层面分开，防止使用者误判方言边界。

**为什么文档注释走忽略而不是 E100**：若拒绝 `/** */`，则任何「切片内语法 + 标准注释」的合法文本（如 `/** 说明 */ type A = string;`）都会失败——直接违反 §1.2 切片承诺（切片内构造全语义：注释是任意记号边界的合法 trivia，注记 9）。而忽略的代价仅是 `/** 悬空 */` 在 #5 暂回 `ok:true`（全 v1 为 E305）——「未实现检查 → 实现」的单向收紧，与 `T[]` 同类，无返工。

**为什么不把切片外构造解析成不透明 IR 节点并 `ok:true`**：假接受比真拒绝危险。`type T = YMap<string>;` 全 v1 是 E304（实参非对象形），不透明节点方案会回 `ok:true`——对非法文本的静默放行无法靠后续 issue「收紧」，因为 `ok:true` 的 IR 已可能被消费/缓存；而「v1 合法文本被暂时拒绝」是透明、自愈的（消息言明，后续 issue 放行）。

---

## §9 错误码实现范围清单

### 本切片实现（14 个）

| 码 | 实现位 | SA6 红灯 | 备注 |
|---|---|---|---|
| E100 | parser catch-all + tokenizer 未知字符 | ✅ 5 用例 | 【R2】消息口径扩为**三态**：真越界 / 切片未实现（§8）/ 实现资源与值域上限（深度预算 §15.2、超双精度 §7.3——后两态均如实标注「非方言判定」，法理论证见各自章节） |
| E101 / E102 / E103 / E104 / E105 | 判定顺序 5/2/3/4/1 | ✅ 各 1 | |
| E201 / E202 / E203 | tokenizer 延迟错误记号 | ✅ 各 1 | |
| E301 | 语义相位（含 `true`/`false`/标记变体按未知名，注记 8 + §6） | ✅ 2 | |
| E302 / E303 | 语义相位 / 语法相位即时 | ✅ 各 1（E302 断言缺陷见 §2） | |
| E106 | DFS 三色 | ✅ 2（互引用断言缺陷见 §2） | |
| **E308** | 语义相位 | ⚠️ **SA6 未写用例** | 封闭对象是切片内构造，重名字段使封闭键空间二义（`{a:string; a:number}` 的键 `a` 映射两类型）——按 §1.2「切片内构造全语义」**必须**实现。SA3 照常实现；建议 SA6 后续补 1 正 1 负用例（非阻塞） |

### 明确延后（5 个，均因「切片内不存在可触发的构造」）

| 码 | 依赖构造 | 延后理由 |
|---|---|---|
| E304 / E307 / E309 | 六标记 / 数组 / Record | 切片内无标记与数组语法，无从违反实参形状 / 纯值上下文 / 混合联合 |
| E305 | `/** */` 挂载 | 文档注释按 trivia 忽略（§8），悬空判定与挂载机制随 JSDoc issue 一并交付 |
| E306 | `Record` | 同 E304 类 |

---

## §10 SA3 实现注意（TDD 与类型严格模式）

1. **修绿顺序建议**：`errors.ts` → `tokenizer.ts`（自测：对 §5.6 输入手工核对记号序列与位置）→ `parser.ts`（先幸福路径 11 例）→ `semantic.ts`（错误 19 例）→ `pnpm typecheck`。**【R2 · SA2 #4】验收判读：`pnpm test` 30/30 全绿**——§2 两处缺陷断言已由 SA6 于 2026-08-18 21:38 修正落库，E302/E106 任一失败按实现缺陷打回，不得引用 §2 豁免（§2 R2 判读基准）。
2. **TS 严格模式陷阱**（`tsconfig.base.json` 全开）：
   - `noUncheckedIndexedAccess`：token 数组游标访问须显式 undefined 处理（用 `peek()`/`next()` 封装，返回 `Token | undefined`）；
   - `exactOptionalPropertyTypes`：IR 字段一律必填（`optional: boolean` 而非 `optional?: boolean`）；
   - `verbatimModuleSyntax`：类型导入/再导出用 `import type` / `export type`；
   - `isolatedModules` + `type: "module"`：内部相对导入带 `.js` 后缀（与 SA6 测试的 `'../src/index.js'` 同口径）。
3. **验证命令**（根目录）：`pnpm test`（vitest run，include 覆盖 `packages/*/test/**`）；`pnpm typecheck`（tsc -p packages/vfsl）。本仓库**无** `scripts/test-lock.sh`，不得引用。
4. **公共面纪律**：`index.ts` 只导出 `parseVfsl` 与 §7.1 类型；不得导出 tokenize/parse/semantic 内部件（内部结构非公共契约，PRD 冻结）。
5. **零依赖纪律**：不新增任何 import 自第三方包；`package.json` / lockfile 的 `exports` / 依赖 / scripts / 结构性字段不动。【R3 · SA4 R-3】唯一例外：`version` patch 位 bump 系 MABF HG9 强制项（总控派发指令授权，非 SA3 可选动作）——见 §12 与文末 R3 记录。
6. **锚点纪律（R2 重申；缺陷断言已修正，本条纪律不变）**：E302 锚重复声明名记号（非 `type` 关键字——修正后测试断言 col 23）；E106 锚再入引用记号（修正后两行输入，断言 (2,15)）。实现按规格锚点直接满足两用例，禁止任何「迁就锚点」的偏移实现。
7. **【R2 · SA2 #1】深度预算**：`parser.ts` 顶部模块内常量 `const MAX_OBJECT_DEPTH = 100`（不导出、不进公共面）；`parseObjectType` 入口 `depth++`，超限即抛 `VfslSyntaxError`（E100 资源上限口径，锚当前 `{` 记号），正常出口 `depth--`。**v1 生命周期内不得调升/调降该常量**（§15.2 行为稳定承诺；如需变更须回总控走设计修订）。
8. **【R2 · SA2 #1】迭代 DFS**：`semantic.ts` 的 E106 三色 DFS 用显式栈（数组 + 灰/黑标记集合）实现，**禁止函数递归跟链**（别名链长度无界）；回边全量收集进候选池（§6.1）。E301/E308 与 AST→IR 的树遍历可保持递归（深度 ≤ 预算，已界定）。
9. **【R2 · SA2 #1】顶层兜底**：`index.ts` 的 `parseVfsl` 在 `VfslSyntaxError` catch 之外再兜 `catch (err)` → E100「内部错误（意外异常）」issue（§15.4）。该路径命中 = 实现缺陷，SA4 静态评审与 SA7 动态验证均不得视为通过。
10. **【R2 · SA2 #2】字面量值域**：parser 字面量分支对数字记号做 `Number.isFinite` 检查，假值 → E100 锚该记号（§7.3）；tokenizer 记号值按双精度数值携带。
11. **【R2 · SA2 #3】字段名保留名**：`parseObjectType` 字段名位查保留名集合（16 名，§4.2）→ E100 锚该记号（§5.2/§5.5）；变体拼写（`yleaf` 等）是普通 Ident，作字段名合法。

---

## §11 历史参考实现（b709dbe）采纳与拒绝清单

| 项 | 处置 | 理由 |
|---|---|---|
| tokenize → parse → semantic → IR 四段分层 | ✅ 采纳（同构） | 与冻结规格的相位模型天然对齐 |
| 递归下降 + 判定特征前置映射专属码 | ✅ 采纳（思路） | 规格 §4 判定顺序的规范性要求 |
| `isIdentStart` 允许 `$` 与 `_` 起始 | ❌ 拒绝 | 违反 §4：标识符 ASCII 字母起始，`$` 不在 v1 字符集（`type A$B` 应 E100） |
| 孤立 `\r` 触发换行 | ❌ 拒绝 | 规格只冻结 `\n` 行分隔与 `\r\n` 的 `\r` 不占列；孤立 `\r` 按空白不换行（§4.3） |
| 字符串字面量保留原文不反转义 | ❌ 拒绝（改为解码值） | IR 值语义应即用（Pattern 正则实参、错误回带）；解码口径见 §7.3 |
| 整体搬运 / cherry-pick | ❌ 禁止（简报明令） | 该实现早于 v1 冻结（无 19 码体系 / 无判定顺序 / 判定锚点未对齐），以冻结规格为准 |

---

## SA2 反馈逐条回应

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| #1（HIGH）深嵌套爆栈 ×「不抛错」契约：三选一显式落章并论证 | ✅ | **§15（新增）**、§3.2、§3.3、§6.1、§10.7–9、§12、§14 | 决策 = (a) 语法相位深度预算 `MAX_OBJECT_DEPTH=100`（E100 资源口径 + 锚预算耗尽处 `{`）+ (b) 局部采纳于语义相位（E106 显式栈迭代 DFS，别名链不设预算）+ (c) 否决（§14 措辞不弱化，由构造达成）；顶层兜底 catch 为最终防线；E100 合规性三点论证见 §15.2；实测基线自建（爆栈 2912 层、JSON.stringify 上限 ≈4456——后者证伪「纯迭代化」路线） |
| #2（MEDIUM）超双精度字面量的 IR 载荷决策 | ✅ | §7.3、§4.2、§5.5、§9、§16 T4–T5 | **E100 拒绝**（锚数字记号，恰合 E100 冻结锚「构造起点记号」）；判定线 `Number.isFinite(Number(原文))`；有限值维持双精度规范化（`007→7` 同族）；否决字符串承载的双理由（IR 碰撞破坏哈希确定性、对求值器说谎）；实测 Infinity→`"null"` 复现 |
| #3（MEDIUM）字段名位保留名的错误码立场 | ✅ | §5.2、§5.5（含论证注）、§9、§16 T6–T7 | **E100 锚该保留名记号**（keyword-token 读法）：与第 7 条对类型位/声明名位（E303）处理同族；规格若未来冻结此角落翻转风险最小；变体拼写（`yleaf`）合法；现有 30 用例零冲突 |
| #4（MEDIUM）§2 转历史记录 + col 更正 + §5.6/§12 同步 | ✅ | §2（闭合横幅 + R2 判读基准 + 核算更正）、§5.6 行 14/17（❌→✅）、§10.1/§10.6、§12 | 落库时间戳（21:38:27 rc=0 亲验）；判读基准改为「30/30 全绿，E302/E106 失败按实现缺陷处理，不得引用 §2 豁免」；col 33→34 更正（脚本复测）；调度日志 row 3 实已闭合（亲验），row 5 随本轮交付闭合 |
| #5（LOW）E106 全量收集落到行 | ✅ | §6.1 E106 行、§15.3、§16 T8 | 「记录候选后继续遍历（不短路），全部回边进候选池参与 min-position 聚合」+ 迭代 DFS；SA2 反例锚点自算复核（胜者 (2,15)） |
| #6（LOW）`&` 族锚点口径 | ✅ | §5.2 续位分派（四案例重写）、§5.5、§16 T10–T12 | 无 `<` 的 `string & Pattern;` 改锚 **`Pattern` 记号**（第 7 条读法，R1 锚 `&` 废弃）；`number & Pattern<"x">` / `string & Foo` 锚 `&` 显式登记为未冻结角落确定性选择 |
| #7（LOW）generic-diag 扫描不吞词法错误 | ✅ | §5.4、§16 T9 | 「扫描中任何位置读到 error 记号 → 即以其码失败」写入伪代码（§4.1 普适规则的显式延伸）；**事实更正**：`Foo<$>` 的 `$`@14 / `<`@13（自测），SA2 构想的 13/10 两数有误 |
| #8（LOW）§7.1 代码块归属 | ✅ | §7.1 | 函数声明移出 ir.ts 代码块；标注「ir.ts 仅类型，parseVfsl 实现与导出在 index.ts」 |
| #9（LOW）内容哈希缓存绑定语义版本 | ✅ | §1.1 | 缓存 key 须绑 parser 语义里程碑（同文本跨里程碑不同 IR 的窗口由 §8 增量交付制造）；#5 不实现缓存，属立论自带边界 |

（逐条详细对应与一致性自检见文末「R2 修订记录」。）

---

## §12. 文件清单（File Scope）

### ALLOW LIST

- `packages/vfsl/src/index.ts` — 修改（空壳 `export {}` → 公共入口编排 + 类型再导出，约 30 行；【R2】+顶层兜底 catch（§15.4），约 40 行）
- `packages/vfsl/src/errors.ts` — 新建（错误码注册表 + VfslIssue 构造与前缀格式化，约 40 行；【R2】E100 三态口径消息构造，约 45 行）
- `packages/vfsl/src/tokenizer.ts` — 新建（记号全集 + trivia + 延迟错误记号 + BOM/行列基准，约 160 行）
- `packages/vfsl/src/parser.ts` — 新建（内部 AST + 递归下降 + 判定顺序映射 + generic-diag，约 220 行；【R2 · SA2 #1/#2/#3/#6】+深度预算守卫、字段名保留名分支、超双精度字面量检查、`&` 族锚点细化（§5.2/§5.5/§7.3/§15.2），约 250 行）
- `packages/vfsl/src/semantic.ts` — 新建（E301/E302/E106/E308 + min-position 聚合 + AST→IR，约 140 行；【R2 · SA2 #1/#5】E106 改显式栈迭代 DFS + 回边全量收集（§6.1/§15.3），约 170 行）
- `packages/vfsl/src/ir.ts` — 新建（IR 公共类型定义，约 40 行；【R2 · SA2 #8】仅类型，无函数）
- `packages/vfsl/test/parse-vfsl.test.ts` — `[SA6 owned]` SA6 红灯测试；SA3 仅可改测试基础设施，不可改断言
- `packages/vfsl/test/parse-vfsl-errors.test.ts` — `[SA6 owned]` 同上；【R2 · SA2 #4】§2 两处缺陷断言已由 SA6 修正落库（2026-08-18 21:38，sa6fix rc=0）——现状即验收契约，30/30 全绿为判读基准。§16 所列 R2 新增红灯构想如需补测，亦由 SA6 拥有（SA3 不得自写断言来覆盖 §16 行为）
- `packages/vfsl/package.json` — 【R3 修订追加 · SA4 R-3】**仅限 `version` patch 位一行**（0.1.0 → 0.1.1；`git show 1664b8d -- packages/vfsl/package.json` 确认系该 commit 对此文件的唯一改动）：MABF 流水线 HG9（改过代码的模块必须 bump patch 版本）× 总控派发指令（`.mabf-bg/sa3-dispatch.sh` 原文「完成后 bump packages/vfsl 版本 patch 位」）。其余字段（`exports` / `dependencies` / `devDependencies` / `scripts` / `name` / `private` / `type`）不在本授权内，仍受下方 DENY 约束

### DENY LIST

- `docs/vfsl/v1-spec.md` — 冻结规格，任何 SA 不得动
- `packages/vfsl/package.json` 的**结构性字段**（`exports` / `dependencies` / `devDependencies` / `scripts` / `name` / `private` / `type` 等）— 零运行时依赖约束的载体，`exports` 直指 `src/index.ts` 维持现状，禁动。【R3 · SA4 R-3】原条目（R2 定稿）为「整文件禁动」，现收窄：`version` patch 位 bump 按 MABF HG9 强制授权豁免（总控派发指令），同步列入 ALLOW LIST——R2 定稿时未预见 HG9 与整文件 DENY 的交集，护栏过宽系设计侧责任，非 SA3 越权（详见文末 R3 记录）
- `packages/vfsl/tsconfig.json`、`tsconfig.base.json`、`vitest.config.ts`、根 `package.json` — 配置已满足任务（include/脚本/严格模式齐备），禁动
- `pnpm-lock.yaml`、`pnpm-workspace.yaml` — 无新增依赖，禁动
- `wiki/raw/20260818-prd-vfsl-v1.md`、`CONTEXT.md`、`docs/adr/**`、`docs/vfsl/**`（除上） — 文档输入，禁动
- `apps/**`、`tests/**`、`.github/**` — 与本任务无关

---

## §13. 协议假设依据 (Protocol Assumption Evidence)

**无协议级假设**：本设计是纯函数库（零运行时依赖、无网络 / 端口 / 进程生命周期 / 跨 job 资源 / 第三方库行为假设），仅涉及进程内字符串→数据的变换。最接近的两项均非协议假设且已有行为依据：

| 项 | 定性 | 依据 |
|---|---|---|
| IR 的 JSON 序列化往返 | JS 语言内建行为，非外部协议 | SA6 红灯测试 `parse-vfsl.test.ts:63-65` 已以此为断言锚（`JSON.parse(JSON.stringify())` 深等） |
| vitest include 覆盖 `packages/vfsl/test/**` | 仓库既有配置 | 根 `vitest.config.ts` include `'packages/*/test/**/*.test.ts'`（已读源确认）；SA6 红灯实测 30 用例被收集执行 |

---

## §14. 契约改动连锁审计 (Contract Change Caller Audit)

**无既有契约改动**：本设计不修改任何既有函数的签名 / 返回类型 / 抛错行为——`packages/vfsl/src/index.ts` 现状为空壳 `export {}`，无既有消费者。全部产出为**新增**（新公共函数 + 新类型），属「新增函数」豁免类；为供 SA4 §1.5 比对，新接缝的现有消费方列示如下：

### 新增函数

| 函数 | 文件 | 契约 |
|---|---|---|
| `parseVfsl` | `packages/vfsl/src/index.ts`（新建导出） | `(text: string) → { ok: true; module } \| { ok: false; issues }`，同步、纯函数、**不抛错（无例外）**：任意输入——含对抗性深嵌套、超长模块、超双精度字面量——错误均仅经返回值传递。【R2 · SA2 #1】该承诺**由构造达成而非措辞豁免**（语法相位深度预算 §15.2 + 语义相位迭代 DFS §15.3 + 顶层兜底 §15.4），不弱化为「对常规输入不抛错」 |

### 新接缝消费方清单

| 消费方 | 文件:行号 | 是否 await | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---|---|---|---|---|
| 幸福路径红灯测试 | `packages/vfsl/test/parse-vfsl.test.ts:15`（import）、`:69` 起调用 | N/A（同步） | 不需要（契约不抛错） | N/A | 无需处置 |
| 错误红灯测试 | `packages/vfsl/test/parse-vfsl-errors.test.ts:14`（import）、`:52` 起调用 | N/A（同步） | 不需要 | N/A | 无需处置 |

（后续 issue 的求值器 / 引擎层消费方尚不存在；`parseVfsl` 的「不抛错」契约即为其集成安全边界——契约的达成机制与边界论证见 §15。）

---

## §15.【R2 新增 · SA2 #1（HIGH）】深嵌套爆栈防御与「不抛错」契约的达成

### 15.0 问题与实测基线（SA1 设计期自建，非转抄）

SA2 攻击：解析主循环为 4 函数互递归（parseUnionType→parsePostfixType→parsePrimaryType→parseObjectType），语义相位 DFS 亦递归——深嵌套输入以 `RangeError` 击穿 §14「不抛错」承诺。SA1 修订期以同构模拟独立复测（node，2026-08-18）：

| 项 | 实测值 | 对设计的含义 |
|---|---|---|
| 4 函数互递归爆栈深度 | **2912 层**（SA2 测得 3129，同量级；本设计取保守值 2912 为基线。栈边界随调用上下文漂移，该值仅作余量论证，不构成契约） | 约 6KB 对抗输入（`{a:`×2912 + `string` + `}`×2912）即可令递归实现抛异常 |
| `JSON.stringify` 深度上限 | **≈4456 层**（二分实测；边界非确定——4457 亦可成功，栈余量随上下文漂移；跨引擎/版本不稳定，仅作余量论证） | **关键推论：纯迭代化（选项 b）单独不成立**——IR 深度 = 输入嵌套深度，无界；即使 parser 全迭代，深 IR 令 SA6 的 `JSON.parse(JSON.stringify(m))` 往返断言自身爆栈。「IR 可序列化」的承诺本身就蕴含 IR 深度上界，**深度预算不可避免** |
| `Number('1'+'0'.repeat(400))` | `Infinity`；`JSON.stringify({v:Infinity})` → `{"v":null}` | 超 IR 值域，见 §7.3（SA2 #2） |

由此，真正的设计自由度不是「要不要上界」，而是**预算配在哪个相位、以什么通道失败、哪些递归根本不需要预算**。

### 15.1 三选一决策（SA2 要求显式落章并论证）

| 选项 | 内容 | 裁决 | 理由 |
|---|---|---|---|
| (a) 显式深度预算 + 定义好的失败路径 | parser 递归保留，`parseObjectType` 入口加深度守卫，超限走结构化错误（E100 资源上限口径） | ✅ **采纳（语法相位骨架）** | (1) 预算同时保护**递归栈与序列化**两个资源界（15.0 第二行推论）；(2) 递归下降结构（§5.2 全部伪代码）原样保留，无改写回归面；(3) 失败路径响亮、确定、可测 |
| (b) parser 与 DFS 全迭代化 + 文档化序列化侧深度限制 | 显式栈改写全部递归 | ⚠️ **部分采纳（仅语义相位 DFS）** | 语法相位不采纳：预算已界定其递归栈，迭代化 = 高复杂度、零增量保证（序列化侧仍需预算，见 15.0）。语义相位采纳：别名链（`type A1 = A0; … × N`）**深度无界而 IR 浅**（`ref` 按名引用，任一别名 IR 深度 ≈3，序列化安全）——对链长设预算会拒绝**合法且可序列化**的模块，属不必要拒绝；迭代 DFS 显式栈（堆分配）零成本消除该递归，故采纳（15.3） |
| (c) 保持递归、§14 弱化为「对常规输入不抛错」 | 文档化限制 | ❌ **否决** | (1)「常规输入」不可判定、CI 不可证伪，对消费方无约束力；(2) ADR-0001 要求引擎运行时解析**任意**方言文本，parser 位于 namespace 创建防线（网络面），弱化后的契约在对抗输入面前等于没有契约；(3) 静默 RangeError = 把资源耗尽伪装成进程级崩溃而非结构化错误——规格 §9「不得做静默决定」纪律的反面；(4) 参照系：tsc 对深嵌套类型即栈溢出且无结构化报错，本设计应优于该基线而非与之对齐 |

**净决策：(a) 为骨架 + (b) 局部应用于语义相位 DFS + §14 承诺保持绝对（不弱化）——契约由构造达成，不由措辞豁免。**

### 15.2 深度预算（语法相位）

- **常量**：`MAX_OBJECT_DEPTH = 100`（`parser.ts` 顶部模块内常量，不导出、不进公共面）。计数对象 = `parseObjectType` 的**进入次数**——它是唯一使 `parseTypeExpr` 递归的入口（联合成员在 `parseUnionType` 的 while 循环内逐个解析逐个返回，不叠栈深；字面量 / 原始 / ref 是叶子；generic-diag 平衡扫描是循环不递归）。栈深 ∝ 对象嵌套深度，预算即完全保护。
- **超限行为**：第 101 层 `{` 被读到时 → E100，消息三态口径：「**嵌套深度超过实现上限 100（实现资源上限，非方言判定；该文本可从 v1 文法推导）**」。锚点 = **预算耗尽处的 `{` 记号**（登记为未冻结角落的确定性选择，§4.3 孤立 `\r` 先例同款——规格未 contemplate 资源上限，无从冻结其锚点）。
- **余量核算**（15.0 保守基线）：
  - 递归栈：100 层 × ~4–5 帧 ≈ 500 帧 ≪ 2912（**≥5.8× 余量**；宿主 worker 线程栈更小的场景仍有数倍余量）；
  - 序列化：100 个 schema 嵌套层 × ~4 JSON 层（object→fields→field→type）≈ 400 ≪ 4456（**≥11× 余量**）——SA6 往返断言与未来消费者（求值器递归遍历 IR）均在安全域；
  - 现实 schema 嵌套 <30 层（参考 fixture ≈3 层），合法文本触碰上限的概率可忽略；预算边界行为本身有正例 / 负例红灯锚定（§16 T1/T3）。
- **为什么借道 E100 不构成「发明规格外错误」**（SA2 要求的论证）：
  1. **规格冻结的是方言语义**（text → accept/reject 的判定条件），栈深 / 内存 / 值域属**实现资源域**，不在任何条款的规范范围内——规格无从「冻结无限深」，正如它无从冻结输入字节数上限。为资源界选择失败通道是实现必答之问，不是新增方言条件。
  2. PRD 冻结的接缝无独立 code 字段、消息正文不冻结 → **E100 是唯一结构化通道**；借道 E100 + 消息如实标注「实现资源上限、非方言判定」，把「方言性拒绝」与「资源性拒绝」在人类可读层分开——与 §8 切片边界双口径消息**同一纪律**。差异须明示：切片拒绝随 #6~#9 单调收敛到 ok:true；资源上限**v1 生命周期内固定、不调升**（写入本节作为实现承诺），杜绝已发布行为翻转（规格 §8 稳定性精神）。
  3. 该拒绝**响亮而非静默**：`ok:false` + 明确消息 + 确定性锚点，调用方与测试立即可见——不是 `if (!x) return fallback` 式伪降级。
- **变更纪律**：调升 / 调降 `MAX_OBJECT_DEPTH` 均属公共行为变更，须回总控走设计修订，SA3 不得自行改常量（§10.7）。

### 15.3 语义相位迭代化（别名链不设预算）

- E106 三色 DFS 改为**显式栈迭代**（灰 = 在栈中标记、黑 = 完成标记；邻接序 = 各声明体 `ref` 源序，根序 = 声明序）。显式栈在堆上，深度 = 引用链长，与调用栈无关：`type A0 = string; … type A20000 = A19999;` 合法模块 `ok:true`（每别名 IR 深度 ≈3，宽而不深，序列化安全；红灯构想 §16 T2）。
- **E106 回边全量收集**（【R2 · SA2 #5】）：遇灰点回边 → 记录候选后**继续遍历，不短路**；全部回边进入 §6.2 候选池参与 min-position 聚合。SA2 反例（SA1 复核锚点）：`type A = { r: C };\ntype B = { b: B };\ntype C = { c: C };`——声明序根 A 先触发 (3,15) 的 C 自环回边；继续遍历后根 B 触发 (2,15) 的 B 再入回边；min-position 胜者 = **(2,15)**。短路实现（首个回边即止）将错报 (3,15)，违反规格「相位内取文本位置最前」。（注：全量收集下胜者与根序无关——两回边均入池，min-position 定胜；根序仅保证遍历本身的确定性。）
- E301 / E302 / E308 与 AST→IR 的树遍历保持递归：遍历深度 ≤ `MAX_OBJECT_DEPTH`（预算已界），无独立栈风险，迭代化无收益。

### 15.4 顶层兜底 catch（最终防线，非设计路径）

`parseVfsl` 顶层在 `VfslSyntaxError` 的 catch 之外再兜一层 `catch (err)`：转为 `{ ok:false, issues:[{ message: 'VFSL-E100: 内部错误（意外异常）: ' + String(err?.message ?? err), line: 1, column: 1 }] }`。

- **定性：崩溃边界转化，不是虚假降级**。SKILL「拒绝虚假降级」禁止的是「正常路径缺陷静默 fallback 到可用状态」；此处 (i) 不返回 `ok:true`、不吞细节（错误文本进 message，响亮可见）；(ii) 任何测试命中该消息 = 实现缺陷，SA4 静态评审与 SA7 动态验证均不得视为通过（写入 §10.9 判读）；(iii) 它是网络面集成边界（ADR-0001：parser 位于 namespace 创建防线）把进程级崩溃转为结构化错误的最后一道闸——设计路径永不依赖它（15.2/15.3 已消除全部已知爆栈源），它只兜「设计未预见的实现 bug」。
- **确定性影响**：`ok:true` 路径不经过该 catch，哈希缓存所依赖的确定性不受影响；错误路径 message 可含环境细节，不参与哈希。
- line/column 取 (1,1) 仅为满足接缝形状（≥1 的数），无定位语义，消息正文已言明性质。

### 15.5 §14 契约的最终表述

「同步、纯函数、**不抛错（无例外）**：任意输入——含对抗性深嵌套、超长模块、超双精度字面量——均经返回值传递错误。达成机制 = 语法相位深度预算（15.2）+ 语义相位迭代 DFS（15.3）+ 顶层兜底（15.4）。」

---

## §16.【R2 新增】红灯测试构想（供 SA6 后续补测；非本切片阻塞项）

全部经 `parseVfsl` 公共入口断言（PRD Testing Decisions）。行列值均为 SA1 修订期脚本核算（1 起列、`\n` 行分隔、Unicode 码点列；构造方式与 SA6 R2 记录同款——字符串从字面量构造，零手敲锚点）。断言风格沿用现有用例（`expectSingleIssue` / 前缀断言不锁全文）。

| # | 对应攻击点 | 输入 | 期望 | 锚点（核算值） |
|---|---|---|---|---|
| T1 | #1 深嵌套不抛 | `'type A = ' + '{a:'.repeat(N) + 'string' + '}'.repeat(N) + ';'`，N ∈ {1000, 5000, 20000} | `ok:false`，E100 前缀，消息含「实现上限」字样；**不得抛 RangeError**（契约下任何 throw 即用例失败，`expect(() => …).not.toThrow()` 可并列加护） | **(1,310)，与 N 无关**——预算在第 101 层 `{` 即触发：`type A = ` 占 col 1–9，`{a:`×100 占 col 10–309，第 101 个 `{`@310 |
| T2 | #1 别名链不抛 | `'type A0 = string;'` + `'type A' + i + ' = A' + (i-1) + ';'`×20000 | `ok:true`（链无环、全部已声明）；不抛；`module.aliases.length === 20001` | — |
| T3 | #1 预算边界正例 | T1 构造 N=100 | `ok:true`；往返深等（IR 深度 ≈100 schema 层 ≈400 JSON 层，安全域内） | — |
| T4 | #2 超双精度 | `'type T = 1' + '0'.repeat(400) + ';'` | `ok:false`，E100，消息含「数值域/双精度」字样 | 数字记号 **(1,10)**（`1`@10——恰合 E100 冻结锚「构造起点记号」） |
| T5 | #2 有限大数正例 | `'type T = 1' + '0'.repeat(308) + ';'`（= 1e308，有限） | `ok:true`；`JSON.parse(JSON.stringify(m))` 深等；该字面量 IR `value === 1e308` | — |
| T6 | #3 字段名保留名 | `type T = { type: string };`、`type T = { any: number };`、`type T = { Record: string };` | 各 `ok:false`，E100 | 保留名记号（`type`@**12**；`any`@12；`Record`@12——`type T = { ` 占 col 1–11） |
| T7 | #3 变体正例 | `type T = { yleaf: string };` | `ok:true`（`yleaf` 非保留名，规格 §6；IR 含字段 `yleaf`） | — |
| T8 | #5 E106 多环取文本最前 | `type A = { r: C };\ntype B = { b: B };\ntype C = { c: C };` | E106，锚 **(2,15)** 非 (3,15)（两回边均收集：B 再入 (2,15)、C 自环 (3,15)，min-position 胜者 line 2） | (2,15)（`type B = { b: B };` 中再入 `B`@15） |
| T9 | #7 扫描不吞词法错误 | `type A = Foo<$>;` | E100 前缀；**column 14（`$`）而非 13（`<`）** | 实测：`<`@13、`$`@14。**事实更正：SA2 评审构想所写「col 13（`$`）/ col 10（`<`）」两数有误，以本表自测数为准**（`type A = Foo<$>;` 逐字编号：F@10 o11 o12 <13 $14） |
| T10 | #6 `&` 无 `<` | `type T = string & Pattern;` | E100 | **`Pattern`@(1,19)**（`string` 占 10–15，`&`@17，`Pattern`@19——R2 改锚，R1 的 `&`@17 废弃） |
| T11 | #6 `&` 完整形态（切片外） | `type T = string & Pattern<"a">;` | E100（切片未实现口径，§8） | `&`@**(1,17)**（§8 既有选择，随 #7 落地转 `ok:true`） |
| T12 | #6 非 string 左元 | `type T = number & Pattern<"x">;` | E100 | `&`@**(1,17)**（未冻结角落登记选择，§5.2） |
| T13 | R1 §9 附议（E308 补测） | `type T = { a: string; a: number };` ／ `type T = { a: string; b: number };` | 负例 E308；正例 `ok:true` | 负例锚第二个 `a`@**(1,23)**（`{ a: string; ` 占 10–22） |

归属：以上均为 `[SA6 owned]` 用例构想（§12）；SA3 不得自写断言覆盖本表行为——实现照设计落地，测试由 SA6 补。

---

## R2 修订记录（2026-08-18，逐条对应 SA2 R1 reject 攻击点）

SA2 verdict：reject（1 HIGH + 3 MEDIUM + 5 LOW；核心架构经攻击成立，修订均为增补）。本轮在不推翻 §3 分层 / §4 延迟错误记号 / §5 判定顺序映射 / §7 IR / §8 切片边界策略的前提下逐条落实；SA2 攻击点编号沿用其评审报告。

### #1（HIGH）深嵌套爆栈 ×「不抛错」契约 → §15（新增章节）

- **三选一决策显式落章**（§15.1）：(a) 采纳为语法相位骨架——`MAX_OBJECT_DEPTH = 100` + E100 资源上限口径 + 锚预算耗尽处 `{` 记号；(b) 局部采纳于语义相位——E106 显式栈迭代 DFS，别名链**不设预算**（设预算会拒绝合法且可序列化的模块：链深无界而 IR 浅）；(c) 否决——「常规输入」不可判定、网络面集成边界不容弱化、静默 RangeError 违反「不做静默决定」纪律。
- **§14 措辞不收敛**：保持「不抛错（无例外）」，改由构造达成（预算 + 迭代 + 顶层兜底），并新增 never-expected 兜底 catch（§15.4——崩溃边界转化，命中即实现缺陷，非虚假降级：不返回 ok:true、错误文本进 message、SA4/SA7 不得视为通过）。
- **E100 合规性论证**（§15.2 三点）：规格冻结方言语义而非实现资源域；E100 是唯一结构化通道（无独立 code 字段、消息正文不冻结）且口径如实分开；资源上限 v1 生命周期固定不上调（与切片拒绝的单调收敛显式区分，杜绝行为翻转）。
- **实测基线自建**：互递归爆栈 **2912 层**（SA2 测 3129，取保守值）；**JSON.stringify 深度上限 ≈4456**（SA2 未测此项）——它证伪了「纯迭代化」路线（深 IR 令 SA6 往返断言自身爆栈），是三选一裁决的关键新证据。余量：栈 ≥5.8×、序列化 ≥11×。
- 联动修订：§3.2（资源界摘要）、§3.3（双层 catch）、§6.1（迭代 DFS + 全量收集）、§10.7–9（SA3 实现注意）、§12（行数估算）、§14（契约行）。红灯构想 T1–T3。

### #2（MEDIUM）超双精度字面量 → §7.3（扩写）、§4.2、§5.5、§9

- **决策：E100 拒绝**，锚数字记号（与 E100 冻结锚「构造起点记号」恰好吻合——比深度锚点更干净）；判定线 `Number.isFinite(Number(原文))`，机械化、确定性。
- **有限值维持双精度规范化**（含精度损失，`007→7` 同族延伸）；实测复核：400 位数字 → `Infinity`、`JSON.stringify` → `"null"`（SA2 断言复现）；1e308 有限且往返无损。
- **否决字符串承载的两条硬理由**：`value` 的 JSON 类型是字面量种类判别器——改携字符串会 (i) 与字符串字面量 IR 碰撞（不同文本→相同 IR→相同内容哈希）；(ii) 对求值器说谎（错误匹配字符串运行时值，而任何 JSON 值不可能等于该整数）。红灯构想 T4–T5。

### #3（MEDIUM）字段名位保留名 → §5.2、§5.5（含论证注）、§9

- **决策：E100 锚该保留名记号**（keyword-token 读法）。论证五点（§5.5 注）：与第 7 条对类型位 / 声名位（E303）处理同族；规格未来冻结此角落时翻转风险最小；接受读法迫使后续阶段永久特判且与 `type T = type;` 同文不同判；变体拼写不受影响；现有 30 用例零冲突。红灯构想 T6–T7。

### #4（MEDIUM）§2 状态撕裂 → §2（转历史）、§5.6、§10、§12

- §2 标注「已闭合，转历史记录」+ 落库时间戳（sa6fix 2026-08-18 21:38:27 rc=0，`.mabf-bg/sa6fix.done` 亲验；测试文件两处现状重读确认）。
- **判读基准改写**：「SA3 修绿后 30/30 必须全绿；E302/E106 失败一律按实现缺陷处理，不得引用 §2 豁免」——封死 SA2 指出的反向风险（真锚点 bug 被当「已知缺陷」放过）。§10.1 / §10.6 同步。
- **col 33→34 更正**（§2 横幅 + §5.6 行 17）：`B` 与 `}` 间空格致 R1 手敲核算差 1，脚本复测确认；R2 起锚点一律脚本核算。
- §5.6 行 14/17 按修正后测试现状 ❌→✅；§12 errors 测试条目从「待修正」改为「已落库，现状即验收契约」。
- 调度日志：row 3（SA6 修正）经亲验**已闭合**（完成时间 21:38——SA2 评审撰写时的 (pending) 已过时）；row 5（本轮 SA1 R2 修订）随本文交付，提请总控闭合。

### #5（LOW）E106 全量收集 → §6.1、§15.3、§16 T8

表头「全量收集」落实到行：「记录候选后继续遍历（不短路），全部回边进入候选池参与 min-position 聚合」；SA2 反例锚点自算复核（胜者 (2,15)，两回边 (2,15)/(3,15) 均入池）；并注明全量收集下胜者与根序无关。

### #6（LOW）`&` 族锚点 → §5.2（续位分派四案例重写）、§5.5、§16 T10–T12

无 `<` 的 `string & Pattern;` **改锚 `Pattern` 记号**（对齐判定顺序第 7 条「脱离语境」文义读法；R1 的「锚 `&`、消息口径即终态」表述废弃）；`number & Pattern<"x">` 与 `string & Foo` 锚 `&` **显式登记为未冻结角落的确定性选择**（§4.3 孤立 `\r` 先例同款，不再以终态口径书写）；切片未实现的完整形态 `string & Pattern<"a">` 维持锚 `&`（§8 既有选择，随 #7 落地消亡，无翻转风险）。

### #7（LOW）generic-diag 扫描吞词法错误 → §5.4、§16 T9

伪代码显式补「扫描中任何位置读到 error 记号 → 即以其码失败」（§4.1 普适规则的显式延伸）。**事实更正（反向）**：`type A = Foo<$>;` 的 `$`@**14**、`<`@**13**（逐字编号：F@10 o11 o12 <13 $14）——SA2 评审红灯构想所写「column 13（`$`）而非 column 10（`<`）」两数均有误（其 13 为本设计的 `<` 位、10 为 `F` 位）。本设计以自测数为准（与 SA2 在 #4 指出 SA1 col 33→34 同类的手敲转录误差，双向警示：锚点必须脚本核算）。

### #8（LOW）§7.1 代码块归属 → §7.1

`export function parseVfsl(…);` 声明移出 ir.ts 代码块；显式标注「ir.ts 仅类型；parseVfsl 实现与导出在 index.ts（§3.1）」；禁止 SA3 在 ir.ts 写签名无体声明（typecheck 必败）。

### #9（LOW）内容哈希缓存版本绑定 → §1.1

缓存 key 必须绑定 parser 语义版本/里程碑（文本哈希 + 里程碑标识）——§8 增量交付制造「同文本跨里程碑不同 IR」窗口（`/** */` 忽略→挂载；悬空注释 ok:true→E305），未绑版本旧缓存命中致 docs 静默丢失或行为滞后。#5 不实现缓存；属设计立论（确定性→缓存）应自带的边界条件。

### 一致性自检（SKILL 修订协议要求）

- 「恒红」检索：仅存于 §2 历史记录与 §5.6 历史标注（均已标注 R2 状态），无将来时指挥残留 ✓
- 死引用：R1 两处「§7.4」（§4.2 数字字面量行、§5.2 单成员联合坍缩注）均已改「§7.3」（R1 笔误，§7 无 7.4 节）✓
- 锚 `&` 场景：§5.2 续位四案例、§5.5 表、§8 表（完整形态锚 `&` 保留且理由自洽——切片选择随 #7 消亡）三处口径一致 ✓
- §10 判读与 §2 R2 判读基准一致（30/30 全绿）✓
- ALLOW LIST 只增不删：全部条目就地标注 R2 追加理由，无删除；SA6 owned 测试文件未入 DENY ✓
- 契约审计（§14）：caller 清单不变——公共面无新增消费方；行为收紧仅发生在原 `ok:true` 的病态输入（深嵌套 >100 层、超双精度、字段名保留名），现有 30 用例均不触碰（已逐一核对输入）✓
- 协议假设（§13）：R2 新增机制（深度预算 / 迭代 DFS / 兜底 catch / isFinite 判定）均为进程内纯计算，无新增协议级假设；实测数字（2912 / 4456 / Infinity）已在 §15.0 / §7.3 附命令级依据 ✓

---

## R3 修订记录（2026-08-18，SA4 R1 静态评审 reject → 总控裁决：仅 R-3 需设计侧处置）

SA4 R1 verdict：reject（R-1 / R-2 / R-3 三项，均局部小修，SA4 自评不触及架构、无需退回 SA1 重设计）。总控裁决（dispatch log row 10）：R-1 / R-2 回流 SA3 修实现（设计正确），R-3 走 SA4 修法 (b)——「SA1 走设计修订显式扩展允许范围并说明理由，不得由 SA3 事后追认」。本记录与 SA4 报告 §七「回流目标汇总」**逐项对应**：

| SA4 回流项 | 回流目标 | 设计侧判定 | 本轮动作 |
|---|---|---|---|
| R-1 星面字符列漂移（`tokenizer.ts:100-103` / `:114-137` 两注释扫描循环按 UTF-16 码元推进） | SA3 | **实现偏离设计，设计本身正确**：§4.3 明文「逐 Unicode 码点推进 column（for..of / codePointAt，**防 CJK 代理对计 2 列**）」——设计点名要防的正是此缺陷类，实现漏在两个注释扫描器（主循环 / ident / number / string 分支均正确）。修法即回到设计口径：与同文件 ident/number/string 分支同款 `codePointAt` 推进（`i += c > 0xffff ? 2 : 1; column += 1`） | **无需设计变更**；SA7 回归坐标经本 R3 脚本复核（`[...s]` 码点展开计数，非转抄 SA4 数字）：`/*😀*/ type A = -1;` → **(1,16)**、`type A = string //😀`（EOF 无换行）→ **(1,20)**、双星面 `/*😀😀*/` → **17**、BMP 对照 `/*中*/` → **16**，四数与 SA4 动态取证逐项吻合 ✓ |
| R-2 重复声明（E302 场景）引用图边取「最后一次声明体」（`semantic.ts:88-95` 覆盖）而非并集 | SA3 | **实现偏离设计，设计本身正确**：§6.1 冻结「同名多声明（E302 场景）的引用边取**全部声明体并集**（未冻结角落的确定性选择）」，且经 SA2 R2 复核通过——SA3 不得静默改读法。修法即回到设计口径：graph 按名累积（`[…(graph.get(name) ?? []), …edges]` 或 Map 聚合） | **无需设计变更**；SA7 回归坐标经本 R3 脚本复核：`type A = { a: A }; type A = string;` → 并集口径 **E106@(1,15)**（实现现报 E302@(1,25) 系覆盖所致）、互环版三行输入 → **E106@(3,15)**、单声明自环对照 → **E106@(1,15)**，三数与 SA4 动态取证逐项吻合 ✓ |
| R-3 `packages/vfsl/package.json` version 0.1.0 → 0.1.1（commit `1664b8d`） | SA1（本记录） | **设计护栏过宽，非 SA3 越权**：SA3 的 bump 系执行总控派发指令（`.mabf-bg/sa3-dispatch.sh` 原文「完成后 bump packages/vfsl 版本 patch 位」），即 MABF 流水线 HG9（改过代码的模块必须 bump patch 版本；同 gate 的仓库内先例引用：`wiki/raw/task_vfsl-v1-spec.md:46`「版本号 bump（Hard Gate #9）」）的强制项。R2 定稿的 §12 将该文件**整文件**列入 DENY、§10.5 写「package.json / lockfile 不动」，未预见 HG9 与整文件 DENY 的交集——冲突根源在设计侧，收窄责任在 SA1（本记录），不在 SA3 | §1.1 / §10.5 / §12 三处同步收窄：**DENY LIST 适用范围收窄为 `exports` / 依赖 / scripts / 结构性字段**；`version` patch 位 bump 按 MABF HG9 强制授权豁免，并列入 ALLOW LIST（【R3 修订追加 · SA4 R-3】条目）。取修法 (b)（设计授权保留 bump）而非 (a)（revert 一行，SA4 推荐项）：总控已在派发层确立「实现 commit 须 bump」约定，revert 会使后续每个切片都重演一次 DENY 冲突再走豁免；且 SA4 实质影响评估确认 bump 无害（零运行时依赖未破坏——无 `dependencies` 字段、devDependencies 未动、`exports` 直指 `src/index.ts` 维持现状；`private: true` 无发布消费面；全仓无版本号读取方） |
| T14 / E308 / T1–T13 补测 | SA6 | 非阻塞积压：§16 红灯构想已备（T1–T13 行为已由 SA4 动态代验通过）；dispatch row 9 已并行派发 SA6 R3 回归用例（red-first） | 无设计侧动作（§16 构想即为 SA6 补测的契约源） |
| SA4 报告 §六动态审核清单 | SA7 | 交付 SA7 执行；其中第 1/2 条（R-1 / R-2 修复后回归）的断言坐标即本表前两行——已由本 R3 逐项脚本复核 | 无设计侧动作 |

### 授权边界的精确表述（防再犯）

- **豁免是单向的**：仅 `version` 字段的 **patch 位** bump（HG9 强制），不授权 minor / major 跳位，不授权触碰该文件其余任何字段——`exports` 直指 `src/index.ts`、`dependencies` 为 null、devDependencies 仅 typescript/vitest 的现状仍由收窄后的 DENY 护栏保护。
- **豁免是流水线级的**：HG9 授权来自 MABF 总控派发，非 SA1 可自行扩大——未来任何 DENY 条目与流水线 Hard Gate 冲突时，处置路径同本记录：总控裁决 → SA1 设计显式收窄并留痕（SA4 修法 (b) 立法精神），不得由实现侧事后追认。
- **SA4 比对口径**：`packages/vfsl/package.json` 现同时出现在 ALLOW（`version` patch 位，【R3 修订追加】条目）与 DENY（结构性字段，收窄后条目）——按 SKILL「ALLOW / DENY 分别提取」语义，actual diff 中该文件仅含 version 一行改动 → 落在 ALLOW 授权内，非 scope creep。

### 一致性自检（SKILL 修订协议要求）

- 「package.json 不动」类表述检索：§1.1（已加 R3 例外标注）、§10.5（已收窄）、§12 DENY（已收窄）三处口径一致，无残留「整文件禁动」表述 ✓
- ALLOW LIST 只增不删：R3 仅追加 `packages/vfsl/package.json` 条目（带 SA4 R-3 编号理由），既有条目零改动；DENY 收窄为就地标注（【R3】marker 保留原条目语义可追溯），未静默重写历史 ✓
- R-1 / R-2 引用条款核对：§4.3「逐 Unicode 码点推进 column（防 CJK 代理对计 2 列）」、§6.1「全部声明体并集」均为原文逐字引用，非转述 ✓
- SA7 回归坐标：全部经本 R3 脚本复核（16 / 17 / 20 / 16 与 (1,15) / (1,25) / (3,15)），与 SA4 动态取证逐项吻合 ✓
- 本轮未触及 §3~§11 任何行为条款（R-1 / R-2 经确认设计正确，无需变更）；修订均为授权范围增补，§13 协议假设 / §14 契约审计均不受影响（version 字段无行为语义）✓
